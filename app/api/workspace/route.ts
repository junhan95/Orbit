import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';

// 기본 에이전트 시드는 두지 않습니다.
// 프로젝트를 만들면 그 프로젝트 전용 매니저가 함께 생기고(app/api/projects/route.ts),
// 나머지 팀원은 매니저가 직무 카탈로그에서 골라 합류시킵니다(lib/manager-tools.ts).
const SELECT_PROJECTS = `SELECT p.id, p.name, p.description, p.color, p.status, p.created_at AS createdAt,
    COUNT(DISTINCT t.id) AS taskCount, COUNT(DISTINCT pa.agent_id) AS agentCount, COUNT(DISTINCT pf.id) AS folderCount
  FROM projects p
  LEFT JOIN tasks t ON t.project_id = p.id AND t.user_id = p.user_id
  LEFT JOIN project_agents pa ON pa.project_id = p.id AND pa.user_id = p.user_id
  LEFT JOIN project_folders pf ON pf.project_id = p.id AND pf.user_id = p.user_id
  WHERE p.user_id = ? GROUP BY p.id ORDER BY p.updated_at DESC`;
const SELECT_AGENTS = `SELECT id, name, role, description, instructions, model, color, is_default AS isDefault,
    project_id AS projectId, is_manager AS isManager, role_key AS roleKey
  FROM agents WHERE user_id = ? ORDER BY is_manager DESC, created_at ASC`;

export async function GET() {
  const user = getCurrentUser();
  const db = getDatabase();
  const projects = await db.prepare(SELECT_PROJECTS).bind(user.userId).all();
  const agents = await db.prepare(SELECT_AGENTS).bind(user.userId).all();

  const assignments = await db.prepare('SELECT project_id AS projectId, agent_id AS agentId FROM project_agents WHERE user_id = ?')
    .bind(user.userId).all();
  return Response.json({ projects: projects.results, agents: agents.results, assignments: assignments.results });
}
