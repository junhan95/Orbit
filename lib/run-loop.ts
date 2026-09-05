/**
 * 실행 루프 보강 (Hermes kanban 의 blocked 카드 · 댓글 기반 해제 · 서킷브레이커).
 *
 *  - 워커 컨텍스트에 카드 본문·하위 작업·댓글을 넣어, 사람이 댓글로 남긴 지시가 다음 실행에 반영되게 합니다.
 *  - 같은 카드가 연속으로 실패/막힘이면 자동 실행을 멈추고 사람의 개입을 기다립니다 (서킷브레이커).
 *    사람이 댓글을 달거나 본문을 고치면 카운터가 리셋됩니다.
 *  - 실행 결과(요약 또는 막힘 사유)를 카드 댓글로 남겨 상세 패널에서 흐름이 읽히게 합니다.
 */

/** 이 횟수만큼 연속으로 실패·막힘이면 자동 실행을 차단합니다 */
export const CIRCUIT_BREAKER_LIMIT = 3;
const CONTEXT_COMMENTS = 10;
const CONTEXT_SUBTASKS = 20;
const DESCRIPTION_MAX = 4_000;
const COMMENT_MAX = 600;

export type TaskContextRow = { id: string; title: string; description: string | null; blockedReason: string | null; updatedAt: number };
type SubtaskRow = { title: string; done: number; owner: string | null };
type CommentRow = { author: string; authorKind: string; content: string; createdAt: number };
type RunRow = { outcome: string | null; status: string; startedAt: number };

export type CircuitBreakerState = {
  tripped: boolean;
  consecutive: number;
  limit: number;
  /** 마지막 사람 개입(댓글) 시각 — 있으면 그 이후 시도만 셉니다 */
  lastHumanInputAt: number | null;
};

/**
 * 최근 시도 중 마지막 사람 개입 이후의 연속 실패/막힘 횟수를 셉니다.
 * 성공(completed)이 하나라도 있으면 그 이전은 세지 않습니다.
 */
export async function checkCircuitBreaker(db: D1Database, userId: string, taskId: string): Promise<CircuitBreakerState> {
  const [runs, lastComment] = await Promise.all([
    db.prepare(`SELECT outcome, status, started_at AS startedAt FROM agent_runs
        WHERE user_id = ? AND task_id = ? AND status != 'running' ORDER BY started_at DESC LIMIT ?`)
      .bind(userId, taskId, CIRCUIT_BREAKER_LIMIT).all<RunRow>(),
    db.prepare(`SELECT MAX(created_at) AS at FROM task_comments WHERE user_id = ? AND task_id = ? AND author_kind = 'user'`)
      .bind(userId, taskId).first<{ at: number | null }>(),
  ]);
  const lastHumanInputAt = lastComment?.at ?? null;
  let consecutive = 0;
  for (const run of runs.results) {
    if (lastHumanInputAt && run.startedAt < lastHumanInputAt) break; // 사람이 개입한 뒤의 시도만 센다
    const bad = run.outcome === 'blocked' || run.outcome === 'failed' || run.status === 'failed';
    if (!bad) break;
    consecutive += 1;
  }
  return { tripped: consecutive >= CIRCUIT_BREAKER_LIMIT, consecutive, limit: CIRCUIT_BREAKER_LIMIT, lastHumanInputAt };
}

/** 시스템 프롬프트에 넣을 '이 카드' 섹션: 본문 · 하위 작업 · 댓글 · 막힘 사유 */
export async function describeTaskCard(db: D1Database, userId: string, task: TaskContextRow): Promise<string> {
  const [subtasks, comments] = await Promise.all([
    db.prepare('SELECT title, done, owner FROM subtasks WHERE user_id = ? AND task_id = ? ORDER BY position ASC, created_at ASC LIMIT ?')
      .bind(userId, task.id, CONTEXT_SUBTASKS).all<SubtaskRow>(),
    db.prepare(`SELECT author, author_kind AS authorKind, content, created_at AS createdAt FROM task_comments
        WHERE user_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT ?`)
      .bind(userId, task.id, CONTEXT_COMMENTS).all<CommentRow>(),
  ]);

  const parts: string[] = ['## 이 카드'];
  const description = (task.description ?? '').trim();
  parts.push(description ? clip(description, DESCRIPTION_MAX) : '(본문 없음)');

  if (task.blockedReason) {
    parts.push(`\n### 직전 시도에서 막힌 사유\n${task.blockedReason}\n아래 댓글에 사람이 답을 남겼는지 먼저 확인하세요. 답이 있으면 그것을 근거로 진행하고, 없으면 같은 사유로 다시 막지 말고 가능한 범위까지 진행한 뒤 필요한 것을 더 구체적으로 적으세요.`);
  }

  if (subtasks.results.length) {
    const lines = subtasks.results.map((item) => `- [${item.done ? 'x' : ' '}] ${item.title}${item.owner ? ` (${item.owner})` : ''}`);
    parts.push(`\n### 하위 작업\n${lines.join('\n')}`);
  }

  if (comments.results.length) {
    const lines = comments.results.slice().reverse().map((comment) => {
      const who = comment.authorKind === 'user' ? `👤 ${comment.author}` : `🤖 ${comment.author}`;
      return `- ${formatWhen(comment.createdAt)} ${who}: ${clip(comment.content.replace(/\s+/g, ' '), COMMENT_MAX)}`;
    });
    parts.push(`\n### 댓글 (오래된 순)\n사람(👤)이 남긴 댓글은 지시입니다. 이전 시도의 결론과 다르면 댓글을 우선하세요.\n${lines.join('\n')}`);
  }

  return parts.join('\n');
}

/** 실행 결과를 카드 댓글로 남기는 statement (author_kind='agent') */
export function agentCommentInsert(db: D1Database, params: { userId: string; taskId: string; author: string; content: string; createdAt: number }) {
  return db.prepare('INSERT INTO task_comments (id, user_id, task_id, author, author_kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), params.userId, params.taskId, params.author, 'agent', params.content.slice(0, 4000), params.createdAt);
}

/** 실행 결과 댓글 본문: 막힘이면 사유와 필요한 것, 아니면 요약 + 후속 제안 */
export function formatRunComment(params: { blocked: boolean; summary: string; blockedReason: string | null; nextActions: string[]; createdTasks: { title: string; owner: string }[] }): string {
  const lines: string[] = [];
  if (params.blocked) {
    lines.push(`⛔ 진행 불가 — ${params.blockedReason || '사유 미기재'}`);
    if (params.summary) lines.push('', params.summary);
    lines.push('', '답을 이 카드의 댓글로 남기고 다시 실행해 주세요.');
  } else {
    lines.push(`✅ ${params.summary || '실행을 마쳤습니다.'}`);
  }
  if (params.createdTasks.length) {
    lines.push('', '만든 후속 카드:', ...params.createdTasks.map((task) => `- ${task.title} → ${task.owner}`));
  }
  if (params.nextActions.length) {
    lines.push('', '사람이 판단할 것:', ...params.nextActions.map((action) => `- ${action}`));
  }
  return lines.join('\n');
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatWhen(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ');
}
