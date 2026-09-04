import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDatabase } from '@/db';

const starters = [
  ['경쟁 제품 핵심 흐름 분석', '리서치', 'Mira', '진행 중', '오늘', '#7559ff'],
  ['온보딩 사용자 여정 설계', '프로덕트', 'Nori', '진행 중', '내일', '#ff7557'],
  ['에이전트 실행 로그 구조화', '개발', 'Bolt', '대기', '9월 8일', '#16a98c'],
  ['프로젝트 권한 정책 검토', '운영', 'Mira', '대기', '9월 9일', '#7559ff'],
  ['모바일 칸반 상호작용 QA', 'QA', 'Lint', '검토', '오늘', '#3478f6'],
];

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const db = getDatabase();
  let result = await db.prepare('SELECT id, title, label, owner, status, due, accent, result FROM tasks WHERE user_id = ? ORDER BY created_at ASC').bind(user.userId).all();
  if (!result.results.length) {
    const now = Date.now();
    await db.batch(starters.map((task, index) => db.prepare('INSERT INTO tasks (id, user_id, title, label, owner, status, due, accent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.userId, ...task, now + index, now + index)));
    result = await db.prepare('SELECT id, title, label, owner, status, due, accent, result FROM tasks WHERE user_id = ? ORDER BY created_at ASC').bind(user.userId).all();
  }
  return Response.json({ tasks: result.results });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { title?: unknown } | null;
  if (typeof body?.title !== 'string' || !body.title.trim() || body.title.trim().length > 100) return Response.json({ error: '업무 이름은 1~100자로 입력해 주세요.' }, { status: 400 });
  const task = { id: crypto.randomUUID(), title: body.title.trim(), label: '신규', owner: 'Nori', status: '대기', due: '일정 미정', accent: '#ff7557', result: null };
  const now = Date.now();
  await getDatabase().prepare('INSERT INTO tasks (id, user_id, title, label, owner, status, due, accent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(task.id, user.userId, task.title, task.label, task.owner, task.status, task.due, task.accent, now, now).run();
  return Response.json({ task }, { status: 201 });
}
