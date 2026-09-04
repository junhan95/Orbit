import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';

const colors = ['#6651f2', '#ff7557', '#16a98c', '#3478f6', '#7559ff'];

export async function POST(request: Request) {
  const user = getCurrentUser();
  const body = await request.json().catch(() => null) as { name?: unknown; role?: unknown; description?: unknown } | null;
  if (typeof body?.name !== 'string' || !body.name.trim() || typeof body.role !== 'string' || !body.role.trim()) {
    return Response.json({ error: '에이전트 이름과 역할을 입력해 주세요.' }, { status: 400 });
  }

  const db = getDatabase();
  const name = body.name.trim().slice(0, 40);
  // 업무의 owner 를 이름으로 참조하므로 이름은 사용자 안에서 유일해야 합니다.
  const duplicate = await db.prepare('SELECT id FROM agents WHERE user_id = ? AND name = ? LIMIT 1').bind(user.userId, name).first<{ id: string }>();
  if (duplicate) return Response.json({ error: '같은 이름의 에이전트가 이미 있습니다.' }, { status: 409 });

  const id = crypto.randomUUID();
  const role = body.role.trim().slice(0, 60);
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 240) : '';
  const color = colors[Math.floor(Math.random() * colors.length)];
  const instructions = `${role} 역할을 맡습니다. 사용자의 목표를 확인하고 구체적이며 실행 가능한 결과를 한국어로 작성하세요.`;

  await db.prepare('INSERT INTO agents (id, user_id, name, role, description, instructions, color, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, user.userId, name, role, description, instructions, color, 0, Date.now()).run();
  return Response.json({ agent: { id, name, role, description, instructions, color, isDefault: 0 } }, { status: 201 });
}
