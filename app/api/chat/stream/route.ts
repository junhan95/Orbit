import { getCurrentUser } from '@/app/auth';
import { getDatabase, getRuntimeConfig } from '@/db';
import { MEMORY_REVIEW_EVERY, chatMessageIndex, prepareChatTurn, type ChatContext } from '@/lib/chat-agent';
import type { ManagerEvent } from '@/lib/manager-tools';
import { streamClaudeAgent } from '@/lib/claude';
import { compactConversation, shouldCompact } from '@/lib/compaction';
import { runInBackground, runMemoryReview } from '@/lib/memory-review';
import { resolveAgentModel } from '@/lib/models';
import { usageInsert } from '@/lib/usage';

type ChatRow = { id: string; role: 'user' | 'assistant'; content: string; createdAt: number };

const MAX_ITERATIONS = 4;
/** 매니저는 대화 중에도 채용·위임·검토를 하므로 반복 여유를 더 줍니다 */
const MANAGER_MAX_ITERATIONS = 14;
const MAX_FOLDER_CONTEXT = 60_000;

/**
 * 대화 스트리밍 엔드포인트. /api/chat 과 같은 헬퍼(prepareChatTurn)를 써서 회상·기억·압축 요약이 동일하게 적용됩니다.
 * 응답은 NDJSON( 한 줄에 JSON 하나 )으로 내려갑니다.
 *   {"type":"user","message":{...}}      – 저장된 사용자 메시지
 *   {"type":"tool","name":"recall_history"} – 툴 호출 시작 (선택적으로 "과거 기록 검색 중…" 표시)
 *   {"type":"manager","kind":"recruited","agent":"Uri","role":"UX 리서처"}          – 팀원 합류
 *   {"type":"manager","kind":"delegate_start","agent":"Uri","title":"..."}          – 위임 시작 (하위 실행 진행 중)
 *   {"type":"manager","kind":"delegate_done","agent":"Uri","outcome":"completed"}   – 위임 결과 도착
 *   {"type":"delta","text":"..."}        – 토큰 조각
 *   {"type":"done","message":{...}}      – 저장된 최종 답변
 *   {"type":"error","error":"..."}       – 오류
 */
export async function POST(request: Request) {
  const user = getCurrentUser();
  const body = await request.json().catch(() => null) as { projectId?: unknown; agentId?: unknown; message?: unknown; folderContext?: unknown } | null;
  if (typeof body?.projectId !== 'string' || typeof body.agentId !== 'string' || typeof body.message !== 'string' || !body.message.trim()) {
    return Response.json({ error: '프로젝트, 에이전트, 메시지가 필요합니다.' }, { status: 400 });
  }
  const projectId = body.projectId;
  const agentId = body.agentId;
  const message = body.message.trim().slice(0, 4000);
  const folderContext = typeof body.folderContext === 'string' ? body.folderContext.trim().slice(0, MAX_FOLDER_CONTEXT) : '';
  const db = getDatabase();

  const context = await db.prepare(`SELECT p.name AS projectName, p.description AS projectDescription,
      a.name AS agentName, a.role AS agentRole, a.instructions AS instructions, a.model AS agentModel, a.is_manager AS isManager
    FROM projects p
    JOIN project_agents pa ON pa.project_id = p.id AND pa.user_id = p.user_id
    JOIN agents a ON a.id = pa.agent_id AND a.user_id = p.user_id
    WHERE p.id = ? AND a.id = ? AND p.user_id = ?`)
    .bind(projectId, agentId, user.userId).first<ChatContext & { agentModel: string | null; isManager: number }>();
  if (!context) return Response.json({ error: '이 프로젝트에 배정된 에이전트가 아닙니다.' }, { status: 403 });

  const { apiKey, model: fallbackModel, reviewModel } = getRuntimeConfig();
  const model = resolveAgentModel(context.agentModel, fallbackModel);
  if (!apiKey) {
    return Response.json({ error: 'Claude API 연결이 아직 설정되지 않았습니다. .env 에 ANTHROPIC_API_KEY 를 설정해 주세요.' }, { status: 503 });
  }

  const userMessage: ChatRow = { id: crypto.randomUUID(), role: 'user', content: message, createdAt: Date.now() };
  await db.batch([
    db.prepare('INSERT INTO chat_messages (id, user_id, project_id, agent_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(userMessage.id, user.userId, projectId, agentId, 'user', message, userMessage.createdAt),
    chatMessageIndex(db, { userId: user.userId, messageId: userMessage.id, projectId, agentName: context.agentName, role: 'user', content: message, createdAt: userMessage.createdAt }),
  ]);

  // 매니저의 합류·위임 진행을 스트림으로 흘리기 위한 통로.
  // prepareChatTurn 은 스트림이 열리기 전에 호출되므로, 실제 send 는 나중에 꽂습니다.
  const bridge: { emit?: (event: ManagerEvent) => void } = {};

  const chat = await prepareChatTurn(db, user.userId, {
    projectId, agentId, context,
    // 매니저와의 대화면 채용·위임·카드 생성 도구를 붙입니다.
    manager: context.isManager
      ? { apiKey, fallbackModel, folderContext, onEvent: (event) => bridge.emit?.(event) }
      : null,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      // 매니저 진행 이벤트를 { type: 'manager', kind: 'delegate_start' | ... } 로 흘립니다.
      bridge.emit = (event) => { send({ type: 'manager', ...event }); };
      send({ type: 'user', message: userMessage });
      try {
        const result = await streamClaudeAgent({
          apiKey, model,
          maxTokens: chat.isManager ? 4000 : 2500,
          maxIterations: chat.isManager ? MANAGER_MAX_ITERATIONS : MAX_ITERATIONS,
          system: chat.system, messages: chat.messages, tools: chat.tools, executeTool: chat.executeTool,
          onDelta: (text) => { send({ type: 'delta', text }); },
          onToolCall: (name) => { send({ type: 'tool', name }); },
        });
        if (!result.text) throw new Error('답변을 생성하지 못했습니다.');

        const assistantMessage: ChatRow = { id: crypto.randomUUID(), role: 'assistant', content: result.text, createdAt: Date.now() };
        await db.batch([
          db.prepare('INSERT INTO chat_messages (id, user_id, project_id, agent_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(assistantMessage.id, user.userId, projectId, agentId, 'assistant', assistantMessage.content, assistantMessage.createdAt),
          chatMessageIndex(db, { userId: user.userId, messageId: assistantMessage.id, projectId, agentName: context.agentName, role: 'assistant', content: assistantMessage.content, createdAt: assistantMessage.createdAt }),
          usageInsert(db, { userId: user.userId, kind: 'chat', result, refId: assistantMessage.id, projectId, agentName: context.agentName }),
        ]);
        send({
          type: 'done', message: assistantMessage,
          // 매니저가 대화 중에 팀을 꾸리거나 카드를 만들었으면 UI 가 보드를 다시 읽습니다.
          recruited: chat.managerLog.recruited,
          delegated: chat.managerLog.delegated,
          createdTasks: chat.taskLog.createdTasks,
        });

        // 사용자 메시지 N개마다 기억 리뷰, 요약 이후 메시지가 넘치면 대화 압축 — 둘 다 응답을 막지 않습니다.
        if (chat.userTurnCount > 0 && chat.userTurnCount % MEMORY_REVIEW_EVERY === 0) {
          runInBackground(() => runMemoryReview({
            db, userId: user.userId, apiKey, model: reviewModel, system: chat.system,
            transcript: [...chat.messages, { role: 'assistant', content: result.text }],
            projectId, agentId, agentName: context.agentName, refId: assistantMessage.id,
          }));
        }
        if (shouldCompact(chat.messagesSinceSummary + 1)) {
          runInBackground(() => compactConversation({ db, userId: user.userId, projectId, agentId, agentName: context.agentName, apiKey, model: reviewModel }));
        }
      } catch (error) {
        send({ type: 'error', error: error instanceof Error ? error.message : '답변 생성에 실패했습니다.' });
      } finally {
        bridge.emit = undefined;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
