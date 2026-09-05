import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { isFieldType, parseFieldRow, type ProjectField } from '@/lib/fields';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type FieldRow = { id: string; projectId: string; name: string; type: string; options: string; showOnCard: number; position: number; createdBy: string };

const MAX_FIELDS = 20;
const SELECT_FIELDS = `SELECT id, project_id AS projectId, name, type, options, show_on_card AS showOnCard, position, created_by AS createdBy
  FROM project_fields WHERE user_id = ? AND project_id = ? ORDER BY position ASC, created_at ASC`;

async function assertProject(db: D1Database, userId: string, projectId: string) {
  return db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first<{ id: string }>();
}

/**
 * GET /api/projects/:id/fields          → { fields }
 * GET /api/projects/:id/fields?values=1 → { fields, values }  (보드 카드 배지에 씁니다)
 */
export async function GET(request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const db = getDatabase();
  if (!await assertProject(db, user.userId, id)) return Response.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });

  const rows = await db.prepare(SELECT_FIELDS).bind(user.userId, id).all<FieldRow>();
  const fields = rows.results.map(parseFieldRow);

  if (new URL(request.url).searchParams.get('values') !== '1') return Response.json({ fields });

  const [values, counts] = await Promise.all([
    db.prepare(`SELECT v.task_id AS taskId, v.field_id AS fieldId, v.value
      FROM task_field_values v JOIN tasks t ON t.id = v.task_id
      WHERE v.user_id = ? AND t.project_id = ?`).bind(user.userId, id).all<{ taskId: string; fieldId: string; value: string }>(),
    // 보드 카드에 '하위 작업 2/3', '댓글 4' 같은 배지를 그리기 위한 집계입니다.
    db.prepare(`SELECT t.id AS taskId,
        (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtasks,
        (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS doneSubtasks,
        (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comments
      FROM tasks t WHERE t.user_id = ? AND t.project_id = ?`)
      .bind(user.userId, id).all<{ taskId: string; subtasks: number; doneSubtasks: number; comments: number }>(),
  ]);
  return Response.json({ fields, values: values.results, counts: counts.results });
}

/** POST /api/projects/:id/fields — 필드 정의를 추가합니다. { name, type, options?, showOnCard? } */
export async function POST(request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { name?: unknown; type?: unknown; options?: unknown; showOnCard?: unknown } | null;

  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.trim().length > 40) {
    return Response.json({ error: '필드 이름은 1~40자로 입력해 주세요.' }, { status: 400 });
  }
  const type = isFieldType(body.type) ? body.type : 'text';
  const options = Array.isArray(body.options)
    ? body.options.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim().slice(0, 40)).slice(0, 20)
    : [];
  if (type === 'select' && !options.length) return Response.json({ error: '선택 필드는 옵션을 하나 이상 넣어 주세요.' }, { status: 400 });

  const db = getDatabase();
  if (!await assertProject(db, user.userId, id)) return Response.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });

  const name = body.name.trim();
  const duplicate = await db.prepare('SELECT id FROM project_fields WHERE user_id = ? AND project_id = ? AND name = ? LIMIT 1')
    .bind(user.userId, id, name).first<{ id: string }>();
  if (duplicate) return Response.json({ error: '같은 이름의 필드가 이미 있습니다.' }, { status: 409 });

  const count = await db.prepare('SELECT COUNT(*) AS total FROM project_fields WHERE user_id = ? AND project_id = ?')
    .bind(user.userId, id).first<{ total: number }>();
  if ((count?.total ?? 0) >= MAX_FIELDS) return Response.json({ error: `필드는 프로젝트당 ${MAX_FIELDS}개까지 만들 수 있습니다.` }, { status: 400 });

  const field: ProjectField = {
    id: crypto.randomUUID(), projectId: id, name, type, options,
    showOnCard: body.showOnCard ? 1 : 0, position: count?.total ?? 0, createdBy: 'user',
  };
  await db.prepare(`INSERT INTO project_fields (id, user_id, project_id, name, type, options, show_on_card, position, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(field.id, user.userId, id, field.name, field.type, JSON.stringify(field.options), field.showOnCard, field.position, field.createdBy, Date.now()).run();
  return Response.json({ field }, { status: 201 });
}

/** PATCH /api/projects/:id/fields — { fieldId, name?, options?, showOnCard? } */
export async function PATCH(request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { fieldId?: unknown; name?: unknown; options?: unknown; showOnCard?: unknown } | null;
  if (typeof body?.fieldId !== 'string') return Response.json({ error: '수정할 필드를 지정해 주세요.' }, { status: 400 });

  const db = getDatabase();
  const existing = await db.prepare(`SELECT id, project_id AS projectId, name, type, options, show_on_card AS showOnCard, position, created_by AS createdBy
    FROM project_fields WHERE id = ? AND user_id = ? AND project_id = ?`).bind(body.fieldId, user.userId, id).first<FieldRow>();
  if (!existing) return Response.json({ error: '필드를 찾을 수 없습니다.' }, { status: 404 });

  const columns: string[] = []; const values: (string | number)[] = [];
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 40) {
      return Response.json({ error: '필드 이름은 1~40자로 입력해 주세요.' }, { status: 400 });
    }
    columns.push('name = ?'); values.push(body.name.trim());
  }
  if (body.options !== undefined) {
    if (!Array.isArray(body.options)) return Response.json({ error: '옵션 형식이 올바르지 않습니다.' }, { status: 400 });
    const options = body.options.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim().slice(0, 40)).slice(0, 20);
    columns.push('options = ?'); values.push(JSON.stringify(options));
  }
  if (body.showOnCard !== undefined) { columns.push('show_on_card = ?'); values.push(body.showOnCard ? 1 : 0); }
  if (!columns.length) return Response.json({ error: '변경할 항목이 없습니다.' }, { status: 400 });

  await db.prepare(`UPDATE project_fields SET ${columns.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values, body.fieldId, user.userId).run();
  const updated = await db.prepare(`SELECT id, project_id AS projectId, name, type, options, show_on_card AS showOnCard, position, created_by AS createdBy
    FROM project_fields WHERE id = ? AND user_id = ?`).bind(body.fieldId, user.userId).first<FieldRow>();
  return Response.json({ field: updated ? parseFieldRow(updated) : null });
}

/** DELETE /api/projects/:id/fields?fieldId=... — 값도 FK CASCADE 로 함께 지워집니다. */
export async function DELETE(request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const fieldId = new URL(request.url).searchParams.get('fieldId');
  if (!fieldId) return Response.json({ error: '삭제할 필드를 지정해 주세요.' }, { status: 400 });

  const db = getDatabase();
  const existing = await db.prepare('SELECT id FROM project_fields WHERE id = ? AND user_id = ? AND project_id = ?')
    .bind(fieldId, user.userId, id).first<{ id: string }>();
  if (!existing) return Response.json({ error: '필드를 찾을 수 없습니다.' }, { status: 404 });

  await db.batch([
    db.prepare('DELETE FROM task_field_values WHERE field_id = ? AND user_id = ?').bind(fieldId, user.userId),
    db.prepare('DELETE FROM project_fields WHERE id = ? AND user_id = ?').bind(fieldId, user.userId),
  ]);
  return Response.json({ id: fieldId });
}
