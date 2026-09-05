import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { type RecallDocInput, recallDocUpsert, searchRecall } from '@/lib/recall';

/** GET /api/recall?q=… — 화면·디버깅용 검색. 모델이 쓰는 recall_history 와 같은 엔진입니다. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const url = new URL(request.url);
  const query = url.searchParams.get('q')?.trim();
  if (!query) return Response.json({ hits: [] });
  const result = await searchRecall(getDatabase(), {
    userId: user.userId, query,
    projectId: url.searchParams.get('projectId'),
    limit: Number(url.searchParams.get('limit')) || 5,
  });
  return Response.json(result);
}

/**
 * POST /api/recall — 기존 대화·실행·업무를 회상 인덱스에 다시 넣습니다.
 * 마이그레이션 직후 한 번, 또는 인덱스가 어긋났다고 의심될 때 실행합니다.
 */
export async function POST() {
  const user = await getCurrentUser();
  const db = getDatabase();

  const [chats, runs, tasks] = await Promise.all([
    db.prepare(`SELECT m.id, m.role, m.content, m.created_at AS createdAt, m.project_id AS projectId, a.name AS agentName
      FROM chat_messages m LEFT JOIN agents a ON a.id = m.agent_id WHERE m.user_id = ?`).bind(user.userId)
      .all<{ id: string; role: string; content: string; createdAt: number; projectId: string; agentName: string | null }>(),
    db.prepare(`SELECT r.id, r.agent_name AS agentName, r.summary, r.output, r.completed_at AS completedAt, r.started_at AS startedAt,
        t.title, t.label, t.project_id AS projectId
      FROM agent_runs r JOIN tasks t ON t.id = r.task_id WHERE r.user_id = ? AND r.status = 'completed' AND r.output IS NOT NULL`).bind(user.userId)
      .all<{ id: string; agentName: string; summary: string | null; output: string; completedAt: number | null; startedAt: number; title: string; label: string; projectId: string | null }>(),
    db.prepare('SELECT id, title, label, owner, project_id AS projectId, created_at AS createdAt FROM tasks WHERE user_id = ?').bind(user.userId)
      .all<{ id: string; title: string; label: string; owner: string; projectId: string | null; createdAt: number }>(),
  ]);

  const docs: RecallDocInput[] = [
    ...chats.results.map((row) => ({ userId: user.userId, kind: 'chat' as const, refId: row.id, projectId: row.projectId, agentName: row.agentName, role: row.role, content: row.content, createdAt: row.createdAt })),
    ...runs.results.map((row) => ({
      userId: user.userId, kind: 'run' as const, refId: row.id, projectId: row.projectId, agentName: row.agentName, role: 'assistant', title: row.title,
      content: `[${row.agentName} · ${row.label}] ${row.title}\n\n${row.summary ?? ''}\n\n${row.output}`.trim(), createdAt: row.completedAt ?? row.startedAt,
    })),
    ...tasks.results.map((row) => ({ userId: user.userId, kind: 'task' as const, refId: row.id, projectId: row.projectId, agentName: row.owner, title: row.title, content: `[${row.label}] ${row.title} — 담당 ${row.owner}`, createdAt: row.createdAt })),
  ];

  // D1 batch 는 한 번에 너무 많으면 거부되므로 50개씩 끊습니다.
  for (let index = 0; index < docs.length; index += 50) {
    await db.batch(docs.slice(index, index + 50).map((doc) => recallDocUpsert(db, doc)));
  }
  const count = await db.prepare('SELECT COUNT(*) AS n FROM recall_docs WHERE user_id = ?').bind(user.userId).first<{ n: number }>();
  return Response.json({ indexed: docs.length, chats: chats.results.length, runs: runs.results.length, tasks: tasks.results.length, total: count?.n ?? 0 });
}
