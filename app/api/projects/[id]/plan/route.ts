import { getCurrentUser } from '@/app/auth';
import { getDatabase, getRuntimeConfig } from '@/db';
import { PLAN_DEFAULT_TASKS, PLAN_MAX_TASKS, proposePlan, type PlannedTask } from '@/lib/planner';
import { ApiKeyMissingError, apiKeyMissingResponse, resolveApiKey } from '@/lib/user-keys';
import { toPriority } from '@/lib/priority';
import { recallDocUpsert } from '@/lib/recall';
import { usageInsert } from '@/lib/usage';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type ProjectRow = { id: string; name: string; description: string };

/**
 * POST /api/projects/:id/plan
 *   { goal, maxTasks? }            → 계획 제안만 (DB 에는 사용량만 기록). 응답: { proposal: { rationale, tasks[] } }
 *   { apply: true, tasks: [...] }  → 검토·수정한 카드 목록을 실제로 생성. 응답: { created: [{ id, title, owner }] }
 * 두 단계로 나눈 이유: 자동 분해 결과를 사람이 한 번 보고 고칠 수 있게 (Hermes 도 planner 산출물은 사람이 승인).
 */
export async function POST(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });

  const db = getDatabase();
  const project = await db.prepare('SELECT id, name, description FROM projects WHERE id = ? AND user_id = ?').bind(id, user.userId).first<ProjectRow>();
  if (!project) return Response.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });

  if (body.apply === true) return applyPlan(db, user.userId, project, body.tasks);

  const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
  if (!goal) return Response.json({ error: '분해할 목표를 적어 주세요.' }, { status: 400 });
  const maxTasks = typeof body.maxTasks === 'number' && Number.isFinite(body.maxTasks)
    ? Math.min(PLAN_MAX_TASKS, Math.max(1, Math.trunc(body.maxTasks)))
    : PLAN_DEFAULT_TASKS;

  const { model } = getRuntimeConfig();
  let apiKey: string;
  try { apiKey = await resolveApiKey(db, user.userId); }
  catch (error) { if (error instanceof ApiKeyMissingError) return apiKeyMissingResponse(); throw error; }

  try {
    const { proposal, result } = await proposePlan({ db, userId: user.userId, apiKey, model, project, goal, maxTasks });
    await usageInsert(db, { userId: user.userId, kind: 'plan', result, refId: project.id, projectId: project.id, agentName: 'Project Lead' }).run();
    return Response.json({ proposal, goal, usage: result.usage });
  } catch (error) {
    const message = error instanceof Error ? error.message : '계획 수립에 실패했습니다.';
    return Response.json({ error: message }, { status: 502 });
  }
}

async function applyPlan(db: D1Database, userId: string, project: ProjectRow, rawTasks: unknown) {
  if (!Array.isArray(rawTasks) || !rawTasks.length) return Response.json({ error: '만들 카드가 없습니다.' }, { status: 400 });
  if (rawTasks.length > PLAN_MAX_TASKS) return Response.json({ error: `카드는 한 번에 ${PLAN_MAX_TASKS}개까지 만들 수 있습니다.` }, { status: 400 });

  const agents = await db.prepare('SELECT name, color FROM agents WHERE user_id = ? ORDER BY is_default DESC, created_at ASC').bind(userId).all<{ name: string; color: string }>();
  if (!agents.results.length) return Response.json({ error: '업무를 맡길 에이전트가 없습니다.' }, { status: 400 });
  const byName = new Map(agents.results.map((agent) => [agent.name, agent]));
  const fallback = agents.results[0];

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  const created: { id: string; title: string; owner: string }[] = [];

  rawTasks.forEach((raw: Partial<PlannedTask>, index: number) => {
    if (!raw || typeof raw !== 'object') return;
    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 100) : '';
    if (!title) return;
    const agent = (typeof raw.owner === 'string' && byName.get(raw.owner.trim())) || fallback;
    const task = {
      id: crypto.randomUUID(),
      title,
      description: typeof raw.description === 'string' ? raw.description.trim().slice(0, 8000) : '',
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 20) : '신규',
      owner: agent.name,
      accent: agent.color,
      priority: toPriority(raw.priority),
      // 같은 순간에 만들어도 보드 순서가 계획 순서와 같도록 created_at 을 1ms 씩 띄웁니다.
      createdAt: now + index,
    };
    statements.push(
      db.prepare(`INSERT INTO tasks (id, user_id, title, label, owner, status, priority, accent, project_id, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(task.id, userId, task.title, task.label, task.owner, '대기', task.priority, task.accent, project.id, task.description, task.createdAt, task.createdAt),
      recallDocUpsert(db, {
        userId, kind: 'task', refId: task.id, projectId: project.id, agentName: task.owner, title: task.title,
        content: `[${task.label}] ${task.title} — 담당 ${task.owner} (계획 분해로 생성)\n${task.description}`, createdAt: task.createdAt,
      }),
    );
    const subtasks = Array.isArray(raw.subtasks) ? raw.subtasks.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 6) : [];
    subtasks.forEach((subtitle, position) => {
      statements.push(db.prepare('INSERT INTO subtasks (id, user_id, task_id, title, done, owner, position, created_at) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)')
        .bind(crypto.randomUUID(), userId, task.id, subtitle.trim().slice(0, 200), position, task.createdAt));
    });
    created.push({ id: task.id, title: task.title, owner: task.owner });
  });

  if (!created.length) return Response.json({ error: '유효한 카드가 없습니다.' }, { status: 400 });
  statements.push(db.prepare('UPDATE projects SET updated_at = ? WHERE id = ? AND user_id = ?').bind(now, project.id, userId));
  await db.batch(statements);
  return Response.json({ created }, { status: 201 });
}
