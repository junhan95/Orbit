import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDatabase } from '@/db';

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { name?: unknown; role?: unknown; description?: unknown } | null;
  if (typeof body?.name !== 'string' || !body.name.trim() || typeof body.role !== 'string' || !body.role.trim()) return Response.json({ error: '에이전트 이름과 역할을 입력해 주세요.' }, { status: 400 });
  const id = crypto.randomUUID();
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 240) : '';
  const colors = ['#6651f2', '#ff7557', '#16a98c', '#3478f6', '#7559ff'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const instructions = `${body.role.trim()} 역할을 맡습니다. 사용자의 목표를 확인하고 구체적이며 실행 가능한 결과를 한국어로 작성하세요.`;
  await getDatabase().prepare('INSERT INTO agents (id, user_id, name, role, description, instructions, color, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, user.userId, body.name.trim().slice(0, 40), body.role.trim().slice(0, 60), description, instructions, color, 0, Date.now()).run();
  return Response.json({ agent: { id, name: body.name.trim(), role: body.role.trim(), description, instructions, color, isDefault: 0 } }, { status: 201 });
}
