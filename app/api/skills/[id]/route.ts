import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { scanMemoryThreat } from '@/lib/memory';
import { SKILL_LIMITS } from '@/lib/skills';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

const SELECT = 'SELECT id, scope, project_id AS projectId, name, description, body, created_by AS createdBy, uses, created_at AS createdAt, updated_at AS updatedAt FROM skills WHERE id = ? AND user_id = ?';

/** PATCH /api/skills/:id { name?, description?, body? } */
export async function PATCH(request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });

  const db = getDatabase();
  const existing = await db.prepare(SELECT).bind(id, user.userId).first<{ id: string; name: string; description: string; body: string }>();
  if (!existing) return Response.json({ error: '스킬을 찾을 수 없습니다.' }, { status: 404 });

  const columns: string[] = [];
  const values: (string | number)[] = [];
  const next = { name: existing.name, description: existing.description, body: existing.body };
  for (const field of ['name', 'description', 'body'] as const) {
    if (body[field] === undefined) continue;
    const value = typeof body[field] === 'string' ? (body[field] as string).trim() : '';
    if (!value || value.length > SKILL_LIMITS[field]) return Response.json({ error: `${field} 은 1~${SKILL_LIMITS[field]}자여야 합니다.` }, { status: 400 });
    next[field] = value;
    columns.push(`${field} = ?`); values.push(value);
  }
  if (!columns.length) return Response.json({ error: '변경할 항목이 없습니다.' }, { status: 400 });
  const threat = scanMemoryThreat(`${next.name}\n${next.description}\n${next.body}`);
  if (threat) return Response.json({ error: `저장이 거부되었습니다: ${threat}` }, { status: 400 });

  columns.push('created_by = ?'); values.push('user');
  columns.push('updated_at = ?'); values.push(Date.now());
  await db.prepare(`UPDATE skills SET ${columns.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values, id, user.userId).run();
  const skill = await db.prepare(SELECT).bind(id, user.userId).first();
  return Response.json({ skill });
}

/** DELETE /api/skills/:id */
export async function DELETE(_request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const result = await getDatabase().prepare('DELETE FROM skills WHERE id = ? AND user_id = ?').bind(id, user.userId).run();
  if (!result.meta.changes) return Response.json({ error: '스킬을 찾을 수 없습니다.' }, { status: 404 });
  return Response.json({ id });
}
