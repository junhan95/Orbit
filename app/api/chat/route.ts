import { getCurrentUser } from '@/app/auth';
import { getDatabase, getRuntimeConfig } from '@/db';
import { callClaude, type ClaudeMessage } from '@/lib/claude';
import { usageInsert } from '@/lib/usage';

type ChatRow = { id: string; role: 'user' | 'assistant'; content: string; createdAt: number };

export async function GET(request: Request) {
  const user = getCurrentUser();
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  const agentId = url.searchParams.get('agentId');
  if (!projectId || !agentId) return Response.json({ messages: [] });
  const messages = await getDatabase()
    .prepare('SELECT id, role, content, created_at AS createdAt FROM chat_messages WHERE user_id = ? AND project_id = ? AND agent_id = ? ORDER BY created_at ASC LIMIT 100')
    .bind(user.userId, projectId, agentId).all<ChatRow>();
  return Response.json({ messages: messages.results });
}

export async function POST(request: Request) {
  const user = getCurrentUser();
  const body = await request.json().catch(() => null) as { projectId?: unknown; agentId?: unknown; message?: unknown } | null;
  if (typeof body?.projectId !== 'string' || typeof body.agentId !== 'string' || typeof body.message !== 'string' || !body.message.trim()) {
    return Response.json({ error: '프로젝트, 에이전트, 메시지가 필요합니다.' }, { status: 400 });
  }
  const message = body.message.trim().slice(0, 4000);
  const db = getDatabase();

  const context = await db.prepare(`SELECT p.name AS projectName, p.description AS projectDescription,
      a.name AS agentName, a.role AS agentRole, a.instructions AS instructions
    FROM projects p
    JOIN project_agents pa ON pa.project_id = p.id AND pa.user_id = p.user_id
    JOIN agents a ON a.id = pa.agent_id AND a.user_id = p.user_id
    WHERE p.id = ? AND a.id = ? AND p.user_id = ?`)
    .bind(body.projectId, body.agentId, user.userId).first<Record<string, string>>();
  if (!context) return Response.json({ error: '이 프로젝트에 배정된 에이전트가 아닙니다.' }, { status: 403 });

  const userMessage: ChatRow = { id: crypto.randomUUID(), role: 'user', content: message, createdAt: Date.now() };
  await db.prepare('INSERT INTO chat_messages (id, user_id, project_id, agent_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(userMessage.id, user.userId, body.projectId, body.agentId, 'user', message, userMessage.createdAt).run();

  const { apiKey, model } = getRuntimeConfig();
  if (!apiKey) {
    return Response.json({ error: 'Claude API 연결이 아직 설정되지 않았습니다. .env 에 ANTHROPIC_API_KEY 를 설정해 주세요.', userMessage }, { status: 503 });
  }

  const history = await db.prepare('SELECT role, content FROM chat_messages WHERE user_id = ? AND project_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT 12')
    .bind(user.userId, body.projectId, body.agentId).all<{ role: string; content: string }>();
  const messages: ClaudeMessage[] = history.results
    .slice()
    .reverse()
    .map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content }));

  const system = [
    `당신은 ${context.agentName}, ${context.agentRole}입니다.`,
    context.instructions,
    `현재 프로젝트: ${context.projectName}`,
    `프로젝트 설명: ${context.projectDescription || '(설명 없음)'}`,
    '답변은 한국어로, 프로젝트 맥락에 맞춰 구체적으로 작성하세요.',
  ].filter(Boolean).join('\n');

  try {
    const result = await callClaude({ apiKey, model, system, messages, maxTokens: 2500 });
    const assistantMessage: ChatRow = { id: crypto.randomUUID(), role: 'assistant', content: result.text, createdAt: Date.now() };
    await db.batch([
      db.prepare('INSERT INTO chat_messages (id, user_id, project_id, agent_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(assistantMessage.id, user.userId, body.projectId, body.agentId, 'assistant', assistantMessage.content, assistantMessage.createdAt),
      usageInsert(db, {
        userId: user.userId, kind: 'chat', result,
        refId: assistantMessage.id, projectId: body.projectId, agentName: context.agentName,
      }),
    ]);
    return Response.json({ userMessage, assistantMessage });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '답변 생성에 실패했습니다.', userMessage }, { status: 502 });
  }
}
