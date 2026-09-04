import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDatabase, getRuntimeConfig } from '@/db';

type OpenAIResponse = { id?: string; output_text?: string; error?: { message?: string } };

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { taskId?: unknown } | null;
  if (typeof body?.taskId !== 'string') return Response.json({ error: '실행할 업무가 필요합니다.' }, { status: 400 });

  const db = getDatabase();
  const task = await db.prepare('SELECT id, title, label, owner, status, due FROM tasks WHERE id = ? AND user_id = ?').bind(body.taskId, user.userId).first<Record<string, string>>();
  if (!task) return Response.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 });
  const { apiKey, model } = getRuntimeConfig();
  if (!apiKey) return Response.json({ error: 'OpenAI API 연결이 아직 설정되지 않았습니다.' }, { status: 503 });

  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const prompt = `업무: ${task.title}\n분류: ${task.label}\n담당 에이전트: ${task.owner}\n마감: ${task.due}\n\n이 업무를 실제로 수행해 주세요. 필요한 경우 웹 검색을 사용하고, 결과를 한국어로 작성하세요. 결과는 핵심 결론, 수행 내용, 다음 행동 순으로 간결하게 정리하세요.`;
  await db.batch([
    db.prepare('INSERT INTO agent_runs (id, task_id, user_id, agent_name, status, prompt, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(runId, task.id, user.userId, task.owner, 'running', prompt, startedAt),
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind('진행 중', startedAt, task.id, user.userId),
  ]);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        instructions: `당신은 ${task.owner}라는 프로젝트 실행 에이전트입니다. 사실과 추측을 구분하고, 실행 가능한 산출물을 만드세요.`,
        input: prompt,
        tools: [{ type: 'web_search' }],
        max_tool_calls: 3,
        max_output_tokens: 1200,
        store: false,
        safety_identifier: await safetyId(user.userId),
      }),
    });
    const data = await response.json() as OpenAIResponse;
    if (!response.ok || !data.output_text) throw new Error(data.error?.message || '에이전트가 결과를 반환하지 못했습니다.');
    const completedAt = Date.now();
    await db.batch([
      db.prepare('UPDATE agent_runs SET status = ?, output = ?, response_id = ?, completed_at = ? WHERE id = ? AND user_id = ?').bind('completed', data.output_text, data.id || null, completedAt, runId, user.userId),
      db.prepare('UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind('검토', data.output_text, completedAt, task.id, user.userId),
    ]);
    return Response.json({ runId, taskId: task.id, status: '검토', output: data.output_text });
  } catch (error) {
    const message = error instanceof Error ? error.message : '에이전트 실행에 실패했습니다.';
    await db.prepare('UPDATE agent_runs SET status = ?, output = ?, completed_at = ? WHERE id = ? AND user_id = ?').bind('failed', message, Date.now(), runId, user.userId).run();
    return Response.json({ error: message }, { status: 502 });
  }
}

async function safetyId(userId: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((value) => value.toString(16).padStart(2, '0')).join('');
}
