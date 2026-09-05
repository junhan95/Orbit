import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { normalizeFieldValue, parseFieldRow } from '@/lib/fields';
import { recallDocUpsert } from '@/lib/recall';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type TaskRow = {
  id: string; title: string; label: string; owner: string; status: string; due: number | null;
  accent: string; result: string | null; summary: string | null; description: string; blockedReason: string | null; projectId: string | null;
};
type FieldRow = { id: string; projectId: string; name: string; type: string; options: string; showOnCard: number; position: number; createdBy: string };

const SELECT_TASK = `SELECT id, title, label, owner, status, due, accent, result, summary, description, blocked_reason AS blockedReason, project_id AS projectId
  FROM tasks WHERE id = ? AND user_id = ?`;

/** GET /api/tasks/:id/detail — 상세 패널이 필요한 모든 것을 한 번에 돌려줍니다. */
export async function GET(_request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const db = getDatabase();

  const task = await db.prepare(SELECT_TASK).bind(id, user.userId).first<TaskRow>();
  if (!task) return Response.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 });

  const [fieldRows, valueRows, subtaskRows, commentRows, runRows] = await Promise.all([
    task.projectId
      ? db.prepare(`SELECT id, project_id AS projectId, name, type, options, show_on_card AS showOnCard, position, created_by AS createdBy
          FROM project_fields WHERE user_id = ? AND project_id = ? ORDER BY position ASC, created_at ASC`)
          .bind(user.userId, task.projectId).all<FieldRow>()
      : Promise.resolve({ results: [] as FieldRow[] }),
    db.prepare('SELECT field_id AS fieldId, value FROM task_field_values WHERE user_id = ? AND task_id = ?')
      .bind(user.userId, id).all<{ fieldId: string; value: string }>(),
    db.prepare('SELECT id, title, done, owner, position FROM subtasks WHERE user_id = ? AND task_id = ? ORDER BY position ASC, created_at ASC')
      .bind(user.userId, id).all<{ id: string; title: string; done: number; owner: string | null; position: number }>(),
    db.prepare('SELECT id, author, author_kind AS authorKind, content, created_at AS createdAt FROM task_comments WHERE user_id = ? AND task_id = ? ORDER BY created_at ASC')
      .bind(user.userId, id).all<{ id: string; author: string; authorKind: string; content: string; createdAt: number }>(),
    db.prepare(`SELECT id, outcome, summary, started_at AS startedAt, completed_at AS completedAt
      FROM agent_runs WHERE user_id = ? AND task_id = ? ORDER BY started_at DESC LIMIT 5`)
      .bind(user.userId, id).all<{ id: string; outcome: string | null; summary: string | null; startedAt: number; completedAt: number | null }>(),
  ]);

  return Response.json({
    task,
    fields: fieldRows.results.map(parseFieldRow),
    values: Object.fromEntries(valueRows.results.map((row) => [row.fieldId, row.value])),
    subtasks: subtaskRows.results,
    comments: commentRows.results,
    runs: runRows.results,
  });
}

/**
 * PATCH /api/tasks/:id/detail — 상세 패널에서 바뀌는 것들을 한 번에 저장합니다.
 *   { description?, values?: { [fieldId]: string | number | boolean | null } }
 * 태스크의 title/status/owner/due/label 은 기존 /api/tasks/:id 를 그대로 씁니다.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { description?: unknown; values?: unknown } | null;
  if (!body) return Response.json({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });

  const db = getDatabase();
  const task = await db.prepare(SELECT_TASK).bind(id, user.userId).first<TaskRow>();
  if (!task) return Response.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 });

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];

  if (body.description !== undefined) {
    if (typeof body.description !== 'string' || body.description.length > 8000) {
      return Response.json({ error: '설명은 8000자까지 입력할 수 있습니다.' }, { status: 400 });
    }
    statements.push(db.prepare('UPDATE tasks SET description = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(body.description, now, id, user.userId));
  }

  if (body.values !== undefined) {
    if (typeof body.values !== 'object' || body.values === null || Array.isArray(body.values)) {
      return Response.json({ error: '필드 값 형식이 올바르지 않습니다.' }, { status: 400 });
    }
    if (!task.projectId) return Response.json({ error: '프로젝트에 속하지 않은 업무에는 필드를 쓸 수 없습니다.' }, { status: 400 });

    const fieldRows = await db.prepare(`SELECT id, project_id AS projectId, name, type, options, show_on_card AS showOnCard, position, created_by AS createdBy
      FROM project_fields WHERE user_id = ? AND project_id = ?`).bind(user.userId, task.projectId).all<FieldRow>();
    const fields = new Map(fieldRows.results.map((row) => [row.id, parseFieldRow(row)]));

    for (const [fieldId, raw] of Object.entries(body.values as Record<string, unknown>)) {
      const field = fields.get(fieldId);
      if (!field) return Response.json({ error: '이 프로젝트에 없는 필드입니다.' }, { status: 400 });
      const value = normalizeFieldValue(field, raw);
      if (value === null) return Response.json({ error: `'${field.name}' 필드의 값 형식이 올바르지 않습니다.` }, { status: 400 });
      statements.push(value
        ? db.prepare(`INSERT INTO task_field_values (task_id, field_id, user_id, value, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(task_id, field_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
            .bind(id, fieldId, user.userId, value, now)
        : db.prepare('DELETE FROM task_field_values WHERE task_id = ? AND field_id = ? AND user_id = ?').bind(id, fieldId, user.userId));
    }
  }

  if (!statements.length) return Response.json({ error: '변경할 항목이 없습니다.' }, { status: 400 });
  await db.batch(statements);

  if (body.description !== undefined) {
    await recallDocUpsert(db, {
      userId: user.userId, kind: 'task', refId: task.id, projectId: task.projectId, agentName: task.owner,
      title: task.title, content: `[${task.label}] ${task.title} — 담당 ${task.owner}\n${String(body.description)}`, createdAt: now,
    }).run();
  }
  return Response.json({ ok: true });
}
