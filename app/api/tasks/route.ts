import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { isTaskStatus } from '@/lib/due';

const DAY = 86_400_000;

type TaskRow = {
  id: string; title: string; label: string; owner: string; status: string;
  due: number | null; accent: string; result: string | null; projectId: string | null;
};

const SELECT_TASKS = 'SELECT id, title, label, owner, status, due, accent, result, project_id AS projectId FROM tasks WHERE user_id = ? ORDER BY created_at ASC';

// [제목, 분류, 담당, 상태, 마감(오늘 기준 +N일 / null=미정), 색]
const starters: Array<[string, string, string, string, number | null, string]> = [
  ['경쟁 제품 핵심 흐름 분석', '리서치', 'Mira', '진행 중', 0, '#7559ff'],
  ['온보딩 사용자 여정 설계', '프로덕트', 'Nori', '진행 중', 1, '#ff7557'],
  ['에이전트 실행 로그 구조화', '개발', 'Bolt', '대기', 4, '#16a98c'],
  ['프로젝트 권한 정책 검토', '운영', 'Mira', '대기', 5, '#7559ff'],
  ['모바일 칸반 상호작용 QA', 'QA', 'Lint', '검토', 0, '#3478f6'],
];

export async function GET() {
  const user = getCurrentUser();
  const db = getDatabase();
  let result = await db.prepare(SELECT_TASKS).bind(user.userId).all<TaskRow>();

  if (!result.results.length) {
    const now = Date.now();
    // 이미 프로젝트가 있으면 시드 업무를 거기에 붙입니다. (없으면 /api/workspace 시드가 나중에 연결)
    const project = await db.prepare('SELECT id FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1').bind(user.userId).first<{ id: string }>();
    await db.batch(starters.map(([title, label, owner, status, dueOffset, accent], index) =>
      db.prepare('INSERT INTO tasks (id, user_id, title, label, owner, status, due, accent, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), user.userId, title, label, owner, status, dueOffset === null ? null : now + dueOffset * DAY, accent, project?.id ?? null, now + index, now + index)));
    result = await db.prepare(SELECT_TASKS).bind(user.userId).all<TaskRow>();
  }
  return Response.json({ tasks: result.results });
}

export async function POST(request: Request) {
  const user = getCurrentUser();
  const body = await request.json().catch(() => null) as {
    title?: unknown; owner?: unknown; label?: unknown; due?: unknown; status?: unknown; projectId?: unknown;
  } | null;

  if (typeof body?.title !== 'string' || !body.title.trim() || body.title.trim().length > 100) {
    return Response.json({ error: '업무 이름은 1~100자로 입력해 주세요.' }, { status: 400 });
  }
  if (body.due !== undefined && body.due !== null && (typeof body.due !== 'number' || !Number.isFinite(body.due))) {
    return Response.json({ error: '마감일 형식이 올바르지 않습니다.' }, { status: 400 });
  }
  if (body.status !== undefined && !isTaskStatus(body.status)) {
    return Response.json({ error: '업무 상태가 올바르지 않습니다.' }, { status: 400 });
  }

  const db = getDatabase();
  // 담당 에이전트를 지정하면 그 에이전트의 색을 쓰고, 없으면 기본 에이전트로 배정합니다.
  const requestedOwner = typeof body.owner === 'string' && body.owner.trim() ? body.owner.trim() : null;
  const agent = requestedOwner
    ? await db.prepare('SELECT name, color FROM agents WHERE user_id = ? AND name = ? LIMIT 1').bind(user.userId, requestedOwner).first<{ name: string; color: string }>()
    : await db.prepare('SELECT name, color FROM agents WHERE user_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1').bind(user.userId).first<{ name: string; color: string }>();
  if (requestedOwner && !agent) return Response.json({ error: '존재하지 않는 에이전트입니다.' }, { status: 400 });

  let projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null;
  if (projectId) {
    const owned = await db.prepare('SELECT id FROM projects WHERE user_id = ? AND id = ?').bind(user.userId, projectId).first<{ id: string }>();
    if (!owned) return Response.json({ error: '존재하지 않는 프로젝트입니다.' }, { status: 400 });
  } else {
    const fallback = await db.prepare('SELECT id FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1').bind(user.userId).first<{ id: string }>();
    projectId = fallback?.id ?? null;
  }

  const task: TaskRow = {
    id: crypto.randomUUID(),
    title: body.title.trim(),
    label: typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 20) : '신규',
    owner: agent?.name ?? 'Nori',
    status: isTaskStatus(body.status) ? body.status : '대기',
    due: typeof body.due === 'number' ? Math.trunc(body.due) : null,
    accent: agent?.color ?? '#ff7557',
    result: null,
    projectId,
  };

  const now = Date.now();
  await db.prepare('INSERT INTO tasks (id, user_id, title, label, owner, status, due, accent, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(task.id, user.userId, task.title, task.label, task.owner, task.status, task.due, task.accent, task.projectId, now, now)
    .run();
  if (task.projectId) {
    await db.prepare('UPDATE projects SET updated_at = ? WHERE id = ? AND user_id = ?').bind(now, task.projectId, user.userId).run();
  }
  return Response.json({ task }, { status: 201 });
}
