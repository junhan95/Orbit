import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';

const HOUR = 3_600_000;
const BUCKETS = 12;
const BUCKET_MS = HOUR / BUCKETS;

type StatusRow = { status: string; count: number };
type RunSummaryRow = { total: number | null; running: number | null; completed: number | null; failed: number | null; lastHour: number | null; avgMs: number | null };
type RunTickRow = { startedAt: number };
type ProjectRow = {
  id: string; name: string; description: string; color: string; status: string;
  taskCount: number; waitingCount: number; doingCount: number; reviewCount: number; highCount: number;
};
type AgentRow = { id: string; name: string; role: string; color: string; runningCount: number; activeTasks: number; lastRunAt: number | null };

export async function GET() {
  const user = getCurrentUser();
  const db = getDatabase();
  const now = Date.now();
  const since = now - HOUR;

  const [statusRows, runSummary, runTicks, projectRows, agentRows] = await Promise.all([
    // 대쉬보드는 프로젝트에 속한 업무만 셉니다. (프로젝트가 지워져 연결이 끊긴 업무는 집계에서 제외)
    db.prepare('SELECT status, COUNT(*) AS count FROM tasks WHERE user_id = ? AND project_id IS NOT NULL GROUP BY status')
      .bind(user.userId).all<StatusRow>(),
    db.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS lastHour,
        AVG(CASE WHEN status = 'completed' AND completed_at IS NOT NULL THEN completed_at - started_at END) AS avgMs
      FROM agent_runs WHERE user_id = ?`).bind(since, user.userId).first<RunSummaryRow>(),
    db.prepare('SELECT started_at AS startedAt FROM agent_runs WHERE user_id = ? AND started_at >= ?')
      .bind(user.userId, since).all<RunTickRow>(),
    // 프로젝트별 진행 상황 — 대쉬보드의 프로젝트 선택기와 집중 카드가 이 배열을 씁니다.
    db.prepare(`SELECT p.id, p.name, p.description, p.color, p.status,
        COUNT(t.id) AS taskCount,
        SUM(CASE WHEN t.status = '대기' THEN 1 ELSE 0 END) AS waitingCount,
        SUM(CASE WHEN t.status = '진행 중' THEN 1 ELSE 0 END) AS doingCount,
        SUM(CASE WHEN t.status = '검토' THEN 1 ELSE 0 END) AS reviewCount,
        SUM(CASE WHEN t.priority = '높음' AND t.status != '검토' THEN 1 ELSE 0 END) AS highCount
      FROM projects p LEFT JOIN tasks t ON t.project_id = p.id AND t.user_id = p.user_id
      WHERE p.user_id = ? GROUP BY p.id ORDER BY p.updated_at DESC`).bind(user.userId).all<ProjectRow>(),
    db.prepare(`SELECT a.id, a.name, a.role, a.color,
        (SELECT COUNT(*) FROM agent_runs r WHERE r.user_id = a.user_id AND r.agent_name = a.name AND r.status = 'running') AS runningCount,
        (SELECT COUNT(*) FROM tasks t WHERE t.user_id = a.user_id AND t.owner = a.name AND t.status = '진행 중' AND t.project_id IS NOT NULL) AS activeTasks,
        (SELECT MAX(r.started_at) FROM agent_runs r WHERE r.user_id = a.user_id AND r.agent_name = a.name) AS lastRunAt
      FROM agents a WHERE a.user_id = ? ORDER BY a.is_default DESC, a.created_at ASC`).bind(user.userId).all<AgentRow>(),
  ]);

  const byStatus = new Map(statusRows.results.map((row) => [row.status, Number(row.count) || 0]));
  const waiting = byStatus.get('대기') ?? 0;
  const doing = byStatus.get('진행 중') ?? 0;
  const review = byStatus.get('검토') ?? 0;
  const total = waiting + doing + review;

  // 최근 60분을 5분 단위 12칸으로 나눈 실행 횟수 히스토그램
  const histogram: number[] = Array.from({ length: BUCKETS }, () => 0);
  for (const tick of runTicks.results) {
    const index = Math.min(BUCKETS - 1, Math.max(0, Math.floor((tick.startedAt - since) / BUCKET_MS)));
    histogram[index] += 1;
  }

  const avgMs = runSummary?.avgMs ?? null;

  const projects = projectRows.results.map((project) => {
    const taskCount = Number(project.taskCount) || 0;
    const reviewCount = Number(project.reviewCount) || 0;
    return {
      id: project.id, name: project.name, description: project.description, color: project.color, status: project.status,
      taskCount,
      waitingCount: Number(project.waitingCount) || 0,
      doingCount: Number(project.doingCount) || 0,
      reviewCount,
      progress: taskCount ? Math.round((reviewCount / taskCount) * 100) : 0,
      // 아직 끝나지 않은 '높음' 중요도 업무 수 — 대쉬보드가 "지금 먼저 봐야 할 일"로 보여줍니다.
      highCount: Number(project.highCount) || 0,
    };
  });

  return Response.json({
    tasks: {
      total, waiting, doing, review,
      completionRate: total ? Math.round((review / total) * 100) : 0,
    },
    runs: {
      total: Number(runSummary?.total ?? 0),
      completed: Number(runSummary?.completed ?? 0),
      failed: Number(runSummary?.failed ?? 0),
      running: Number(runSummary?.running ?? 0),
      lastHour: Number(runSummary?.lastHour ?? 0),
      avgSeconds: avgMs === null ? null : Math.round(avgMs / 1000),
      histogram,
    },
    projects,
    // 가장 최근에 손댄 프로젝트 = 지금 집중할 프로젝트 (대쉬보드 기본 선택값)
    focus: projects[0] ?? null,
    agents: agentRows.results.map((agent) => ({
      id: agent.id, name: agent.name, role: agent.role, color: agent.color,
      runningCount: Number(agent.runningCount) || 0,
      activeTasks: Number(agent.activeTasks) || 0,
      lastRunAt: agent.lastRunAt ?? null,
    })),
  });
}
