import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDatabase } from '@/db';

const defaults = [
  ['Project Lead', '프로젝트 매니저', '목표를 구조화하고 일정과 우선순위, 에이전트 협업을 조율합니다.', '프로젝트 목표를 실행 계획으로 나누고 담당자를 배정하며 진행 상황과 위험을 명확하게 보고하세요.', '#6651f2'],
  ['Mira', '리서처', '자료를 조사하고 근거와 인사이트를 정리합니다.', '신뢰할 수 있는 자료를 조사하고 출처, 사실, 추론을 구분해 핵심 인사이트를 작성하세요.', '#7559ff'],
  ['Nori', '프로덕트 디자이너', '사용자 흐름과 제품 요구사항을 설계합니다.', '사용자 문제를 구체화하고 실현 가능한 흐름, 상태, 예외 상황을 설계하세요.', '#ff7557'],
  ['Bolt', '엔지니어', '기술 설계와 구현 계획을 만듭니다.', '요구사항을 안전하고 유지보수 가능한 기술 설계와 구현 단계로 변환하세요.', '#16a98c'],
  ['Lint', 'QA 엔지니어', '품질 기준과 테스트 시나리오를 점검합니다.', '실패 가능성이 높은 경로를 우선해 재현 가능한 테스트와 품질 리스크를 작성하세요.', '#3478f6'],
];

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const db = getDatabase();
  let projects = await db.prepare('SELECT p.id, p.name, p.description, p.color, p.status, p.created_at AS createdAt, COUNT(DISTINCT t.id) AS taskCount, COUNT(DISTINCT pa.agent_id) AS agentCount FROM projects p LEFT JOIN tasks t ON t.project_id = p.id AND t.user_id = p.user_id LEFT JOIN project_agents pa ON pa.project_id = p.id AND pa.user_id = p.user_id WHERE p.user_id = ? GROUP BY p.id ORDER BY p.updated_at DESC').bind(user.userId).all();
  let agents = await db.prepare('SELECT id, name, role, description, instructions, color, is_default AS isDefault FROM agents WHERE user_id = ? ORDER BY is_default DESC, created_at ASC').bind(user.userId).all();

  if (!projects.results.length && !agents.results.length) {
    const now = Date.now();
    const projectId = crypto.randomUUID();
    const agentRows = defaults.map((agent, index) => ({ id: crypto.randomUUID(), agent, index }));
    await db.batch([
      db.prepare('INSERT INTO projects (id, user_id, name, description, color, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(projectId, user.userId, 'AI 협업 보드 MVP', '에이전트가 함께 제품을 설계하고 구현하는 첫 프로젝트', '#6651f2', '진행 중', now, now),
      ...agentRows.map(({ id, agent, index }) => db.prepare('INSERT INTO agents (id, user_id, name, role, description, instructions, color, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, user.userId, ...agent, 1, now + index)),
      ...agentRows.map(({ id, index }) => db.prepare('INSERT INTO project_agents (project_id, agent_id, user_id, assigned_at) VALUES (?, ?, ?, ?)').bind(projectId, id, user.userId, now + index)),
      db.prepare('UPDATE tasks SET project_id = ? WHERE user_id = ? AND project_id IS NULL').bind(projectId, user.userId),
    ]);
    projects = await db.prepare('SELECT p.id, p.name, p.description, p.color, p.status, p.created_at AS createdAt, COUNT(DISTINCT t.id) AS taskCount, COUNT(DISTINCT pa.agent_id) AS agentCount FROM projects p LEFT JOIN tasks t ON t.project_id = p.id AND t.user_id = p.user_id LEFT JOIN project_agents pa ON pa.project_id = p.id AND pa.user_id = p.user_id WHERE p.user_id = ? GROUP BY p.id ORDER BY p.updated_at DESC').bind(user.userId).all();
    agents = await db.prepare('SELECT id, name, role, description, instructions, color, is_default AS isDefault FROM agents WHERE user_id = ? ORDER BY is_default DESC, created_at ASC').bind(user.userId).all();
  }
  const assignments = await db.prepare('SELECT project_id AS projectId, agent_id AS agentId FROM project_agents WHERE user_id = ?').bind(user.userId).all();
  return Response.json({ projects: projects.results, agents: agents.results, assignments: assignments.results });
}
