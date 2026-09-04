import type { ClaudeResult } from './claude';

export type UsageKind = 'agent_run' | 'chat';

/**
 * Claude 호출 1건의 사용량을 usage_events 에 남기는 prepared statement 를 만듭니다.
 * 호출한 쪽에서 db.batch 에 그대로 끼워 넣을 수 있게 statement 만 돌려줍니다.
 */
export function usageInsert(db: D1Database, params: {
  userId: string;
  kind: UsageKind;
  result: ClaudeResult;
  refId?: string | null;
  projectId?: string | null;
  agentName?: string | null;
}) {
  const { usage } = params.result;
  return db.prepare(`INSERT INTO usage_events
      (id, user_id, kind, model, ref_id, project_id, agent_name,
       input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, web_search_requests, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(), params.userId, params.kind, params.result.model,
      params.refId ?? null, params.projectId ?? null, params.agentName ?? null,
      usage.inputTokens, usage.outputTokens, usage.cacheCreationTokens,
      usage.cacheReadTokens, usage.webSearchRequests, Date.now(),
    );
}
