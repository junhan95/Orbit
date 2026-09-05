/**
 * 물어보기형 게이트 — 승인 대기 큐 (AI-Native SDLC 플레이북: Hook 은 allow / block / ask).
 *
 * 지금까지의 게이트는 전부 '차단'이었습니다. 여기서는 위험하지만 정당할 수 있는 행동을 막지 않고
 * **사람의 승인을 기다리는 큐**에 넣습니다. 에이전트에게는 "승인 대기에 넣었다"고 알리고 실행은 계속됩니다.
 *
 * 게이트가 걸리는 행동:
 *   - create_task 가 실행당 ASK_TASKS_AFTER 개를 넘을 때 (보드를 채워 버리는 것 방지)
 *   - save_skill scope='global' (모든 프로젝트에 영향)
 * 승인하면 그때 실제로 카드를 만들거나 스킬을 저장합니다. 거절하면 사유와 함께 기록만 남습니다.
 */
import { gateEventInsert } from './gates';
import { recallDocUpsert } from './recall';
import { prepareSkillWrite } from './skills';
import { atomicBatch, isPreconditionError } from './atomic';

export const ASK_TASKS_AFTER = 3;

export type ApprovalAction = 'create_task' | 'save_global_skill';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type ApprovalRequest = {
  action: ApprovalAction;
  actor: string;
  projectId: string | null;
  taskId: string | null;
  runId?: string | null;
  /** 사람이 읽는 한 줄 (목록에 표시) */
  summary: string;
  /** 승인 시 그대로 실행할 데이터 */
  payload: Record<string, unknown>;
};

export type ApprovalRow = {
  id: string; action: ApprovalAction; actor: string; projectId: string | null; taskId: string | null; runId: string | null;
  summary: string; payload: string; status: ApprovalStatus; reason: string | null; createdAt: number; resolvedAt: number | null;
};

const SELECT = 'SELECT id, action, actor, project_id AS projectId, task_id AS taskId, run_id AS runId, summary, payload, status, reason, created_at AS createdAt, resolved_at AS resolvedAt FROM approvals';

export async function requestApproval(db: D1Database, userId: string, request: ApprovalRequest): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT INTO approvals (id, user_id, action, actor, project_id, task_id, run_id, summary, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, userId, request.action, request.actor, request.projectId, request.taskId, request.runId ?? null, request.summary.slice(0, 300), JSON.stringify(request.payload), 'pending', Date.now()),
    gateEventInsert(db, userId, { gate: 'approval', decision: 'ask', projectId: request.projectId, taskId: request.taskId, detail: `${request.action}: ${request.summary}` }),
  ]);
  return { id };
}

export async function listApprovals(db: D1Database, userId: string, status: ApprovalStatus | 'all' = 'pending', limit = 50): Promise<ApprovalRow[]> {
  const rows = await db.prepare(`${SELECT} WHERE user_id = ? ${status === 'all' ? '' : 'AND status = ?'} ORDER BY created_at DESC LIMIT ?`)
    .bind(userId, ...(status === 'all' ? [] : [status]), limit).all<ApprovalRow>();
  return rows.results;
}

/** 승인이면 payload 를 실제로 실행하고, 거절이면 기록만. 이미 처리된 항목은 그대로 돌려줍니다. */
export async function resolveApproval(db: D1Database, userId: string, id: string, decision: 'approve' | 'reject', reason?: string):
  Promise<{ ok: true; row: ApprovalRow; result?: Record<string, unknown> } | { ok: false; error: string; status?: number }> {
  const row = await db.prepare(`${SELECT} WHERE id = ? AND user_id = ?`).bind(id, userId).first<ApprovalRow>();
  if (!row) return { ok: false, error: '승인 항목을 찾을 수 없습니다.', status: 404 };
  if (row.status !== 'pending') return { ok: false, error: `이미 ${row.status === 'approved' ? '승인' : '거절'}된 항목입니다.`, status: 409 };

  const now = Date.now();
  let result: Record<string, unknown> | undefined;
  let statements: D1PreparedStatement[] = [];
  if (decision === 'approve') {
    const payload = safeJson(row.payload);
    try {
      const prepared = row.action === 'create_task' ? await prepareCreateTask(db, userId, row, payload) : await prepareGlobalSkill(db, userId, row, payload);
      result = prepared.result;
      statements = prepared.statements;
    } catch (error) {
      return { ok: false, error: `승인 처리 실패: ${error instanceof Error ? error.message : String(error)}`, status: 502 };
    }
  }
  try {
  await atomicBatch(db, "EXISTS (SELECT 1 FROM approvals WHERE id = ? AND user_id = ? AND status = 'pending')", [id, userId], [
    ...statements,
    db.prepare('UPDATE approvals SET status = ?, reason = ?, resolved_at = ? WHERE id = ? AND user_id = ?')
      .bind(decision === 'approve' ? 'approved' : 'rejected', (reason ?? '').slice(0, 400) || null, now, id, userId),
    gateEventInsert(db, userId, { gate: 'approval', decision: decision === 'approve' ? 'allow' : 'block', projectId: row.projectId, taskId: row.taskId, detail: `${row.action} ${decision}: ${row.summary}` }),
  ]);
  } catch (error) {
    return { ok: false, status: isPreconditionError(error) ? 409 : 502, error: isPreconditionError(error) ? '다른 요청에서 이미 처리한 승인입니다.' : '승인 처리에 실패했습니다. 변경 사항은 취소되었으니 다시 시도하세요.' };
  }
  const updated = await db.prepare(`${SELECT} WHERE id = ? AND user_id = ?`).bind(id, userId).first<ApprovalRow>();
  return { ok: true, row: updated ?? row, result };
}

async function prepareCreateTask(db: D1Database, userId: string, row: ApprovalRow, payload: Record<string, unknown>) {
  const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, 100) : '';
  if (!title) throw new Error('payload 에 title 이 없습니다.');
  const requested = typeof payload.owner === 'string' && payload.owner.trim() ? payload.owner.trim() : null;
  const agent = requested
    ? await db.prepare('SELECT name, color FROM agents WHERE user_id = ? AND name = ? LIMIT 1').bind(userId, requested).first<{ name: string; color: string }>()
    : null;
  // 담당 미지정이면 그 프로젝트의 매니저·팀원을 우선하고, 없을 때만 전체 에이전트 중 첫 번째
  const fallback = agent ?? await db.prepare(`SELECT name, color FROM agents WHERE user_id = ?
      ORDER BY CASE WHEN project_id = ? OR id IN (SELECT agent_id FROM project_agents WHERE project_id = ? AND user_id = ?) THEN 0 ELSE 1 END, is_manager DESC, created_at ASC LIMIT 1`)
    .bind(userId, row.projectId, row.projectId, userId).first<{ name: string; color: string }>();
  if (!fallback) throw new Error('업무를 맡길 에이전트가 없습니다.');
  const now = Date.now();
  const id = crypto.randomUUID();
  const label = typeof payload.label === 'string' && payload.label.trim() ? payload.label.trim().slice(0, 20) : '신규';
  const description = typeof payload.description === 'string' ? payload.description.slice(0, 8000) : '';
  const statements = [
    db.prepare(`INSERT INTO tasks (id, user_id, title, label, owner, status, priority, accent, project_id, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '대기', '중간', ?, ?, ?, ?, ?)`)
      .bind(id, userId, title, label, fallback.name, fallback.color, row.projectId, description, now, now),
    recallDocUpsert(db, { userId, kind: 'task', refId: id, projectId: row.projectId, agentName: fallback.name, title, content: `[${label}] ${title} — 담당 ${fallback.name} (${row.actor} 제안, 사람이 승인)\n${description}`, createdAt: now }),
  ];
  return { statements, result: { taskId: id, owner: fallback.name } };
}

async function prepareGlobalSkill(db: D1Database, userId: string, row: ApprovalRow, payload: Record<string, unknown>) {
  const outcome = await prepareSkillWrite(db, {
    userId, scope: 'global', projectId: null, actor: row.actor,
    name: text(payload.name), description: text(payload.description), body: text(payload.body),
  });
  if ('error' in outcome) throw new Error(outcome.error);
  return { statements: [outcome.statement], result: { skillId: outcome.id, action: outcome.action } };
}

/** 실행 한 번 동안 create_task 요청을 세어, 상한을 넘으면 승인 대기로 돌립니다. run 라우트가 executeTaskTool 앞에 끼웁니다. */
export async function gateCreateTask(db: D1Database, userId: string, params: {
  input: Record<string, unknown>; counter: { created: number }; actor: string; projectId: string | null; taskId: string; runId: string;
}): Promise<Record<string, unknown> | null> {
  params.counter.created += 1;
  if (params.counter.created <= ASK_TASKS_AFTER) return null;
  const title = typeof params.input.title === 'string' ? params.input.title.trim() : '(제목 없음)';
  const { id } = await requestApproval(db, userId, {
    action: 'create_task', actor: params.actor, projectId: params.projectId, taskId: params.taskId, runId: params.runId,
    summary: `${params.actor} 가 후속 카드 추가 요청: ${title}`, payload: params.input,
  });
  return {
    ok: true, pending_approval: id,
    note: `이번 실행에서 카드를 ${ASK_TASKS_AFTER}개 넘게 만들려 해서 이 카드는 사람의 승인 대기에 넣었습니다. 승인되면 보드에 생깁니다. 같은 카드를 다시 요청하지 말고, 남은 후속 업무는 next_actions 에 적으세요.`,
  };
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function safeJson(text: string): Record<string, unknown> {
  try { const parsed = JSON.parse(text) as unknown; return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
