import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';

const colors = ['#6651f2', '#ff7557', '#16a98c', '#3478f6'];

export async function POST(request: Request) {
  const user = getCurrentUser();
  const body = await request.json().catch(() => null) as { name?: unknown; description?: unknown; agentIds?: unknown } | null;
  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) {
    return Response.json({ error: '프로젝트 이름은 1~80자로 입력해 주세요.' }, { status: 400 });
  }
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 240) : '';
  const agentIds = Array.isArray(body.agentIds)
    ? [...new Set(body.agentIds.filter((id): id is string => typeof id === 'string'))].slice(0, 20)
    : [];

  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = Date.now();
  const color = colors[Math.floor(Math.random() * colors.length)];
  const validAgents = agentIds.length
    ? await db.prepare(`SELECT id FROM agents WHERE user_id = ? AND id IN (${agentIds.map(() => '?').join(',')})`).bind(user.userId, ...agentIds).all<{ id: string }>()
    : { results: [] as { id: string }[] };

  await db.batch([
    db.prepare('INSERT INTO projects (id, user_id, name, description, color, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, user.userId, body.name.trim(), description, color, '진행 중', now, now),
    ...validAgents.results.map((agent, index) => db.prepare('INSERT OR IGNORE INTO project_agents (project_id, agent_id, user_id, assigned_at) VALUES (?, ?, ?, ?)')
      .bind(id, agent.id, user.userId, now + index)),
  ]);

  return Response.json({
    project: { id, name: body.name.trim(), description, color, status: '진행 중', taskCount: 0, agentCount: validAgents.results.length },
  }, { status: 201 });
}
