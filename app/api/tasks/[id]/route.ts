import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { isTaskStatus } from '@/lib/due';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

type TaskRow = {
  id: string; title: string; label: string; owner: string; status: string;
  due: number | null; accent: string; result: string | null; projectId: string | null;
};

const SELECT_TASK = 'SELECT id, title, label, owner, status, due, accent, result, project_id AS projectId FROM tasks WHERE id = ? AND user_id = ?';

export async function PATCH(request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });

  const db = getDatabase();
  const existing = await db.prepare(SELECT_TASK).bind(id, user.userId).first<TaskRow>();
  if (!existing) return Response.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 });

  const columns: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 100) {
      return Response.json({ error: '업무 이름은 1~100자로 입력해 주세요.' }, { status: 400 });
    }
    columns.push('title = ?'); values.push(body.title.trim());
  }
  if (body.status !== undefined) {
    if (!isTaskStatus(body.status)) return Response.json({ error: '업무 상태가 올바르지 않습니다.' }, { status: 400 });
    columns.push('status = ?'); values.push(body.status);
  }
  if (body.label !== undefined) {
    if (typeof body.label !== 'string' || !body.label.trim()) return Response.json({ error: '분류를 입력해 주세요.' }, { status: 400 });
    columns.push('label = ?'); values.push(body.label.trim().slice(0, 20));
  }
  if (body.due !== undefined) {
    if (body.due !== null && (typeof body.due !== 'number' || !Number.isFinite(body.due))) {
      return Response.json({ error: '마감일 형식이 올바르지 않습니다.' }, { status: 400 });
    }
    columns.push('due = ?'); values.push(body.due === null ? null : Math.trunc(body.due as number));
  }
  if (body.owner !== undefined) {
    if (typeof body.owner !== 'string' || !body.owner.trim()) return Response.json({ error: '담당 에이전트를 지정해 주세요.' }, { status: 400 });
    const agent = await db.prepare('SELECT name, color FROM agents WHERE user_id = ? AND name = ? LIMIT 1').bind(user.userId, body.owner.trim()).first<{ name: string; color: string }>();
    if (!agent) return Response.json({ error: '존재하지 않는 에이전트입니다.' }, { status: 400 });
    columns.push('owner = ?'); values.push(agent.name);
    columns.push('accent = ?'); values.push(agent.color);
  }
  if (body.projectId !== undefined) {
    if (body.projectId !== null && typeof body.projectId !== 'string') {
      return Response.json({ error: '프로젝트 값이 올바르지 않습니다.' }, { status: 400 });
    }
    if (typeof body.projectId === 'string') {
      const owned = await db.prepare('SELECT id FROM projects WHERE user_id = ? AND id = ?').bind(user.userId, body.projectId).first<{ id: string }>();
      if (!owned) return Response.json({ error: '존재하지 않는 프로젝트입니다.' }, { status: 400 });
    }
    columns.push('project_id = ?'); values.push(body.projectId as string | null);
  }
  // 상태를 '검토' 밖으로 되돌리면 이전 실행 결과는 지웁니다.
  if (body.status !== undefined && body.status !== '검토' && existing.result) {
    columns.push('result = ?'); values.push(null);
  }

  if (!columns.length) return Response.json({ error: '변경할 항목이 없습니다.' }, { status: 400 });

  columns.push('updated_at = ?'); values.push(Date.now());
  await db.prepare(`UPDATE tasks SET ${columns.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values, id, user.userId).run();

  const task = await db.prepare(SELECT_TASK).bind(id, user.userId).first<TaskRow>();
  return Response.json({ task });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const db = getDatabase();
  const existing = await db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').bind(id, user.userId).first<{ id: string }>();
  if (!existing) return Response.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 });
  // agent_runs 는 FK ON DELETE CASCADE 로 함께 정리됩니다.
  await db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').bind(id, user.userId).run();
  return Response.json({ id });
}
