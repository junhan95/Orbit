/**
 * 기억 리뷰 패스 — Hermes background_review 의 축소판.
 * 실행/대화가 끝난 뒤, 같은 대화를 저가 모델에게 보여주고 "기억에 남길 것이 있나"만 묻습니다.
 * 쓸 수 있는 툴은 memory 하나뿐이라(툴 화이트리스트) 리뷰가 작업을 이어가 버리는 일이 없습니다.
 * 응답을 막지 않도록 waitUntil 로 백그라운드에서 돌립니다.
 */
import { waitUntil } from 'cloudflare:workers';
import { runClaudeAgent, type ClaudeCredential, type ClaudeMessage, messageText } from './claude';
import { MEMORY_REVIEW_PROMPT, MEMORY_TOOL, executeMemoryTool } from './memory';
import { usageInsert } from './usage';

const REVIEW_MAX_ITERATIONS = 3;
const REVIEW_MAX_TOKENS = 800;
/** 리뷰에 넣는 대화 전사의 상한 (앞부분을 잘라 최근 쪽을 남깁니다) */
const TRANSCRIPT_MAX_CHARS = 24_000;

/** 응답을 보낸 뒤에도 계속 도는 작업. 요청 컨텍스트가 없으면(테스트 등) 그냥 진행합니다. */
export function runInBackground(task: () => Promise<unknown>): void {
  const promise = task().catch((error) => { console.error('[background]', error instanceof Error ? error.message : error); });
  try { waitUntil(promise); } catch { /* waitUntil 을 쓸 수 없는 컨텍스트 — promise 는 이미 시작됨 */ }
}

export type MemoryReviewParams = {
  db: D1Database;
  userId: string;
  apiKey: ClaudeCredential;
  model: string;
  /** 원래 실행/대화의 시스템 프롬프트 (기억 블록 포함) — 같은 맥락에서 판단하게 합니다 */
  system: string;
  transcript: ClaudeMessage[];
  projectId: string | null;
  agentId: string | null;
  agentName: string;
  /** usage_events.ref_id 로 남길 원본(실행 id 또는 메시지 id) */
  refId: string;
};

/** 이보다 짧은 어시스턴트 발화만 있으면 리뷰를 건너뜁니다 (잘린 실행에서 제목만 보고 지어내는 것을 막습니다) */
const MIN_ASSISTANT_CHARS = 200;

export async function runMemoryReview(params: MemoryReviewParams): Promise<{ saved: boolean; toolCalls: number; skipped?: string }> {
  const assistantChars = params.transcript.filter((message) => message.role === 'assistant').reduce((sum, message) => sum + messageText(message.content).trim().length, 0);
  if (assistantChars < MIN_ASSISTANT_CHARS) return { saved: false, toolCalls: 0, skipped: '리뷰할 내용이 너무 적음' };
  const trimmed = trimTranscript(params.transcript);
  const failures = { count: 0 };
  const result = await runClaudeAgent({
    apiKey: params.apiKey,
    model: params.model,
    system: params.system,
    messages: [...trimmed, { role: 'user', content: MEMORY_REVIEW_PROMPT }],
    maxTokens: REVIEW_MAX_TOKENS,
    maxIterations: REVIEW_MAX_ITERATIONS,
    tools: [MEMORY_TOOL],
    executeTool: (name, input) => {
      if (name !== 'memory') throw new Error('이 리뷰에서는 memory 툴만 쓸 수 있습니다.');
      return executeMemoryTool(params.db, input, {
        userId: params.userId, projectId: params.projectId, agentId: params.agentId, actor: params.agentName, failures,
      });
    },
  });
  await usageInsert(params.db, {
    userId: params.userId, kind: 'memory_review', result,
    refId: params.refId, projectId: params.projectId, agentName: params.agentName,
  }).run();
  const saved = result.toolCalls.some((call) => call.name === 'memory' && call.ok);
  return { saved, toolCalls: result.toolCalls.length };
}

function trimTranscript(transcript: ClaudeMessage[]): ClaudeMessage[] {
  // 첨부가 붙은 메시지는 블록 배열이라, 여기서는 글자만 뽑아 다룹니다 (기억 리뷰는 텍스트만 봅니다).
  const flat = transcript.map((message) => ({ role: message.role, content: messageText(message.content) }));
  let total = flat.reduce((sum, message) => sum + message.content.length, 0);
  const kept = flat.slice();
  while (kept.length > 2 && total > TRANSCRIPT_MAX_CHARS) {
    total -= kept[0].content.length;
    kept.shift();
  }
  return kept.map((message) => message.content.length > TRANSCRIPT_MAX_CHARS
    ? { ...message, content: `${message.content.slice(0, TRANSCRIPT_MAX_CHARS)}…` }
    : message);
}
