import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { managerName, uniqueAgentName } from '@/lib/agent-catalog';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

const PROJECT_STATUSES = ['진행 중', '보류', '완료'] as const;

const SELECT_PROJECT = `SELECT p.id, p.name, p.description, p.color, p.status, p.created_at AS createdAt,
    COUNT(DISTINCT t.id) AS taskCount, COUNT(DISTINCT pa.agent_id) AS agentCount, COUNT(DISTINCT pf.id) AS folderCount
  FROM projects p
  LEFT JOIN tasks t ON t.project_id = p.id AND t.user_id = p.user_id
  LEFT JOIN project_agents pa ON pa.project_id = p.id AND pa.user_id = p.user_id
  LEFT JOIN project_folders pf ON pf.project_id = p.id AND pf.user_id = p.user_id
  WHERE p.id = ? AND p.user_id = ? GROUP BY p.id`;

/** 프로젝트 이름·설명·상태 수정. */
export async function PATCH(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });

  const db = getDatabase();
  const existing = await db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(id, user.userId).first<{ id: string }>();
  if (!existing) return Response.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });

  const columns: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) {
      return Response.json({ error: '프로젝트 이름은 1~80자로 입력해 주세요.' }, { status: 400 });
    }
    columns.push('name = ?'); values.push(body.name.trim());
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') return Response.json({ error: '설명 형식이 올바르지 않습니다.' }, { status: 400 });
    columns.push('description = ?'); values.push(body.description.trim().slice(0, 240));
  }
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !PROJECT_STATUSES.includes(body.status as typeof PROJECT_STATUSES[number])) {
      return Response.json({ error: '프로젝트 상태가 올바르지 않습니다.' }, { status: 400 });
    }
    columns.push('status = ?'); values.push(body.status);
  }
  if (!columns.length) return Response.json({ error: '변경할 항목이 없습니다.' }, { status: 400 });

  columns.push('updated_at = ?'); values.push(Date.now());
  await db.prepare(`UPDATE projects SET ${columns.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values, id, user.userId).run();

  // 매니저 이름은 프로젝트 이름에서 나옵니다 ('A' → 'A 프로젝트 매니저').
  // 프로젝트 이름이 바뀌면 매니저 이름과, 그 이름을 문자열로 참조하는 업무 담당자도 함께 갱신합니다.
  if (typeof body.name === 'string' && body.name.trim()) {
    const manager = await db.prepare('SELECT id, name FROM agents WHERE user_id = ? AND project_id = ? AND is_manager = 1 LIMIT 1')
      .bind(user.userId, id).first<{ id: string; name: string }>();
    if (manager) {
      const nextName = await uniqueAgentName(db, user.userId, managerName(body.name.trim()));
      if (nextName !== manager.name) {
        await db.batch([
          db.prepare('UPDATE agents SET name = ? WHERE id = ? AND user_id = ?').bind(nextName, manager.id, user.userId),
          db.prepare('UPDATE tasks SET owner = ? WHERE user_id = ? AND project_id = ? AND owner = ?').bind(nextName, user.userId, id, manager.name),
          db.prepare('UPDATE subtasks SET owner = ? WHERE user_id = ? AND owner = ?').bind(nextName, user.userId, manager.name),
        ]);
      }
    }
  }

  const project = await db.prepare(SELECT_PROJECT).bind(id, user.userId).first();
  return Response.json({ project });
}

/**
 * 프로젝트 삭제.
 * 기본은 업무를 남겨 두고 프로젝트 연결만 끊습니다(project_id = NULL).
 * ?withTasks=1 이면 이 프로젝트의 업무까지 함께 지웁니다.
 */
export async function DELETE(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  const { id } = await context.params;
  const withTasks = new URL(request.url).searchParams.get('withTasks') === '1';

  const db = getDatabase();
  const existing = await db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(id, user.userId).first<{ id: string }>();
  if (!existing) return Response.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });

  // project_agents / chat_messages / project_folders 는 FK ON DELETE CASCADE 로 함께 정리됩니다.
  // 이 프로젝트 전용 에이전트(매니저 + 매니저가 합류시킨 팀원)는 agents.project_id 가
  // 프로젝트를 참조하므로 프로젝트보다 먼저 지워야 합니다.
  await db.batch([
    withTasks
      ? db.prepare('DELETE FROM tasks WHERE project_id = ? AND user_id = ?').bind(id, user.userId)
      : db.prepare('UPDATE tasks SET project_id = NULL, updated_at = ? WHERE project_id = ? AND user_id = ?').bind(Date.now(), id, user.userId),
    db.prepare('DELETE FROM agents WHERE user_id = ? AND project_id = ?').bind(user.userId, id),
    db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').bind(id, user.userId),
  ]);

  return Response.json({ id, deletedTasks: withTasks });
}
