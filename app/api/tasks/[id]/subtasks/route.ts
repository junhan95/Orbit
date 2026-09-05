import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type SubtaskRow = { id: string; title: string; done: number; owner: string | null; position: number };

const MAX_SUBTASKS = 50;
const SELECT_SUBTASKS = 'SELECT id, title, done, owner, position FROM subtasks WHERE user_id = ? AND task_id = ? ORDER BY position ASC, created_at ASC';

async function assertTask(db: D1Database, userId: string, taskId: string) {
  return db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').bind(taskId, userId).first<{ id: string }>();
}

export async function GET(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  const { id } = await context.params;
  const db = getDatabase();
  if (!await assertTask(db, user.userId, id)) return Response.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 });
  const rows = await db.prepare(SELECT_SUBTASKS).bind(user.userId, id).all<SubtaskRow>();
  return Response.json({ subtasks: rows.results });
}

/** POST — { title, owner? } */
export async function POST(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { title?: unknown; owner?: unknown } | null;
  if (typeof body?.title !== 'string' || !body.title.trim() || body.title.trim().length > 120) {
    return Response.json({ error: '하위 작업 이름은 1~120자로 입력해 주세요.' }, { status: 400 });
  }

  const db = getDatabase();
  if (!await assertTask(db, user.userId, id)) return Response.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 });

  const count = await db.prepare('SELECT COUNT(*) AS total FROM subtasks WHERE user_id = ? AND task_id = ?').bind(user.userId, id).first<{ total: number }>();
  if ((count?.total ?? 0) >= MAX_SUBTASKS) return Response.json({ error: `하위 작업은 ${MAX_SUBTASKS}개까지 만들 수 있습니다.` }, { status: 400 });

  let owner: string | null = null;
  if (typeof body.owner === 'string' && body.owner.trim()) {
    const agent = await db.prepare('SELECT name FROM agents WHERE user_id = ? AND name = ? LIMIT 1').bind(user.userId, body.owner.trim()).first<{ name: string }>();
    if (!agent) return Response.json({ error: '존재하지 않는 에이전트입니다.' }, { status: 400 });
    owner = agent.name;
  }

  const subtask: SubtaskRow = { id: crypto.randomUUID(), title: body.title.trim(), done: 0, owner, position: count?.total ?? 0 };
  await db.prepare('INSERT INTO subtasks (id, user_id, task_id, title, done, owner, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(subtask.id, user.userId, id, subtask.title, 0, owner, subtask.position, Date.now()).run();
  return Response.json({ subtask }, { status: 201 });
}

/** PATCH — { subtaskId, done?, title?, owner? } */
export async function PATCH(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { subtaskId?: unknown; done?: unknown; title?: unknown; owner?: unknown } | null;
  if (typeof body?.subtaskId !== 'string') return Response.json({ error: '수정할 하위 작업을 지정해 주세요.' }, { status: 400 });

  const db = getDatabase();
  const existing = await db.prepare('SELECT id FROM subtasks WHERE id = ? AND user_id = ? AND task_id = ?')
    .bind(body.subtaskId, user.userId, id).first<{ id: string }>();
  if (!existing) return Response.json({ error: '하위 작업을 찾을 수 없습니다.' }, { status: 404 });

  const columns: string[] = []; const values: (string | number | null)[] = [];
  if (body.done !== undefined) { columns.push('done = ?'); values.push(body.done ? 1 : 0); }
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) return Response.json({ error: '하위 작업 이름을 입력해 주세요.' }, { status: 400 });
    columns.push('title = ?'); values.push(body.title.trim().slice(0, 120));
  }
  if (body.owner !== undefined) {
    if (body.owner === null || body.owner === '') { columns.push('owner = ?'); values.push(null); }
    else {
      if (typeof body.owner !== 'string') return Response.json({ error: '담당 에이전트가 올바르지 않습니다.' }, { status: 400 });
      const agent = await db.prepare('SELECT name FROM agents WHERE user_id = ? AND name = ? LIMIT 1').bind(user.userId, body.owner.trim()).first<{ name: string }>();
      if (!agent) return Response.json({ error: '존재하지 않는 에이전트입니다.' }, { status: 400 });
      columns.push('owner = ?'); values.push(agent.name);
    }
  }
  if (!columns.length) return Response.json({ error: '변경할 항목이 없습니다.' }, { status: 400 });

  await db.prepare(`UPDATE subtasks SET ${columns.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values, body.subtaskId, user.userId).run();
  const subtask = await db.prepare('SELECT id, title, done, owner, position FROM subtasks WHERE id = ? AND user_id = ?')
    .bind(body.subtaskId, user.userId).first<SubtaskRow>();
  return Response.json({ subtask });
}

/** DELETE /api/tasks/:id/subtasks?subtaskId=... */
export async function DELETE(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  const { id } = await context.params;
  const subtaskId = new URL(request.url).searchParams.get('subtaskId');
  if (!subtaskId) return Response.json({ error: '삭제할 하위 작업을 지정해 주세요.' }, { status: 400 });

  const db = getDatabase();
  const existing = await db.prepare('SELECT id FROM subtasks WHERE id = ? AND user_id = ? AND task_id = ?')
    .bind(subtaskId, user.userId, id).first<{ id: string }>();
  if (!existing) return Response.json({ error: '하위 작업을 찾을 수 없습니다.' }, { status: 404 });

  await db.prepare('DELETE FROM subtasks WHERE id = ? AND user_id = ?').bind(subtaskId, user.userId).run();
  return Response.json({ id: subtaskId });
}
