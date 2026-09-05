import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { isAgentModel } from '@/lib/models';

// DESIGN-airtable.md 시그니처 팔레트 (흰 글자가 얹히므로 모두 어두운 톤)
const colors = ['#181d26', '#aa2d00', '#0a2e0e', '#d9a441', '#1a3866'];

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
  return Response.json({ agent: { id, name, role, description, instructions, model: null, color, isDefault: 0 } }, { status: 201 });
}

type AgentRow = { id: string; name: string; role: string; description: string; instructions: string; model: string | null; color: string; isDefault: number };

/**
 * 에이전트 설정 수정. 보낸 필드만 바뀝니다 (부분 수정).
 *
 *   { id, model?, role?, description?, instructions? }
 *
 * - model: 목록(lib/models.ts)에 있는 id 만 허용. 빈 문자열이면 NULL 로 되돌려 .env 기본 모델을 씁니다.
 * - name 은 업무의 owner 가 문자열로 참조하고 있어 여기서 바꾸지 않습니다.
 */
export async function PATCH(request: Request) {
  const user = getCurrentUser();
  const body = await request.json().catch(() => null) as
    { id?: unknown; model?: unknown; role?: unknown; description?: unknown; instructions?: unknown } | null;
  if (typeof body?.id !== 'string' || !body.id) {
    return Response.json({ error: '수정할 에이전트를 찾을 수 없습니다.' }, { status: 400 });
  }

  const db = getDatabase();
  const existing = await db.prepare('SELECT id FROM agents WHERE id = ? AND user_id = ? LIMIT 1')
    .bind(body.id, user.userId).first<{ id: string }>();
  if (!existing) return Response.json({ error: '에이전트를 찾을 수 없습니다.' }, { status: 404 });

  const sets: string[] = [];
  const values: (string | null)[] = [];

  if (body.model !== undefined) {
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (model && !isAgentModel(model)) return Response.json({ error: '지원하지 않는 모델입니다.' }, { status: 400 });
    sets.push('model = ?'); values.push(model || null);
  }
  if (body.role !== undefined) {
    if (typeof body.role !== 'string' || !body.role.trim()) return Response.json({ error: '역할은 비울 수 없습니다.' }, { status: 400 });
    sets.push('role = ?'); values.push(body.role.trim().slice(0, 60));
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') return Response.json({ error: '역할 설명 형식이 올바르지 않습니다.' }, { status: 400 });
    sets.push('description = ?'); values.push(body.description.trim().slice(0, 240));
  }
  if (body.instructions !== undefined) {
    if (typeof body.instructions !== 'string' || !body.instructions.trim()) {
      return Response.json({ error: '실행 지침은 비울 수 없습니다.' }, { status: 400 });
    }
    sets.push('instructions = ?'); values.push(body.instructions.trim().slice(0, 4000));
  }
  if (!sets.length) return Response.json({ error: '바뀐 내용이 없습니다.' }, { status: 400 });

  await db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...values, body.id, user.userId).run();

  const agent = await db.prepare('SELECT id, name, role, description, instructions, model, color, is_default AS isDefault FROM agents WHERE id = ? AND user_id = ?')
    .bind(body.id, user.userId).first<AgentRow>();
  return Response.json({ agent });
}
