import { getCurrentUser } from '@/app/auth';
import { getDatabase, getRuntimeConfig } from '@/db';
import { callClaude } from '@/lib/claude';
import { formatDue } from '@/lib/due';
import { usageInsert } from '@/lib/usage';

type TaskRow = { id: string; title: string; label: string; owner: string; status: string; due: number | null };

export async function POST(request: Request) {
  const user = getCurrentUser();
  const body = await request.json().catch(() => null) as { taskId?: unknown } | null;
  if (typeof body?.taskId !== 'string') return Response.json({ error: '실행할 업무가 필요합니다.' }, { status: 400 });

  const db = getDatabase();
  const task = await db.prepare('SELECT id, title, label, owner, status, due FROM tasks WHERE id = ? AND user_id = ?')
    .bind(body.taskId, user.userId).first<TaskRow>();
  if (!task) return Response.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 });

  const { apiKey, model } = getRuntimeConfig();
  if (!apiKey) return Response.json({ error: 'Claude API 연결이 아직 설정되지 않았습니다. .env 에 ANTHROPIC_API_KEY 를 설정해 주세요.' }, { status: 503 });

  // 담당 에이전트의 지침이 있으면 시스템 프롬프트에 반영합니다.
  const agent = await db.prepare('SELECT role, instructions FROM agents WHERE user_id = ? AND name = ? LIMIT 1')
    .bind(user.userId, task.owner).first<{ role: string; instructions: string }>();

  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const prompt = [
    `업무: ${task.title}`,
    `분류: ${task.label}`,
    `담당 에이전트: ${task.owner}`,
    `마감: ${formatDue(task.due)}`,
    '',
    '이 업무를 실제로 수행해 주세요. 최신 정보가 필요하면 웹 검색을 사용하고, 결과를 한국어로 작성하세요.',
    '결과는 핵심 결론, 수행 내용, 다음 행동 순으로 간결하게 정리하세요.',
  ].join('\n');
  const system = [
    `당신은 ${task.owner}${agent?.role ? `, ${agent.role}` : ''}라는 프로젝트 실행 에이전트입니다.`,
    agent?.instructions ?? '',
    '사실과 추측을 명확히 구분하고, 곧바로 쓸 수 있는 산출물을 만드세요.',
  ].filter(Boolean).join('\n');

  await db.batch([
    db.prepare('INSERT INTO agent_runs (id, task_id, user_id, agent_name, status, prompt, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(runId, task.id, user.userId, task.owner, 'running', prompt, startedAt),
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind('진행 중', startedAt, task.id, user.userId),
  ]);

  try {
    const result = await callClaude({
      apiKey, model, system,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
      webSearchMaxUses: 3,
    });
    // 출력 한도에 걸려 잘린 경우, 결과가 완결된 것처럼 보이지 않도록 표시합니다.
    const output = result.stopReason === 'max_tokens'
      ? `${result.text}\n\n---\n※ 출력 토큰 한도에 걸려 여기서 끊겼습니다. 더 긴 결과가 필요하면 app/api/agents/run/route.ts 의 maxTokens 를 올리세요.`
      : result.text;
    const completedAt = Date.now();
    await db.batch([
      db.prepare('UPDATE agent_runs SET status = ?, output = ?, response_id = ?, completed_at = ? WHERE id = ? AND user_id = ?')
        .bind('completed', output, result.id, completedAt, runId, user.userId),
      db.prepare('UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind('검토', output, completedAt, task.id, user.userId),
      usageInsert(db, { userId: user.userId, kind: 'agent_run', result, refId: runId, agentName: task.owner }),
    ]);
    return Response.json({ runId, taskId: task.id, status: '검토', output });
  } catch (error) {
    const message = error instanceof Error ? error.message : '에이전트 실행에 실패했습니다.';
    await db.batch([
      db.prepare('UPDATE agent_runs SET status = ?, output = ?, completed_at = ? WHERE id = ? AND user_id = ?')
        .bind('failed', message, Date.now(), runId, user.userId),
      // 실행 전 상태로 되돌려 보드가 '진행 중'에 멈춰 있지 않게 합니다.
      db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(task.status, Date.now(), task.id, user.userId),
    ]);
    return Response.json({ error: message }, { status: 502 });
  }
}
