import { traceRequest } from '@/lib/telemetry';
import { getCurrentUser } from '@/app/auth';
import { getDatabase, getRuntimeConfig } from '@/db';
import { runTask } from '@/lib/run-task';
import { credentialErrorResponse, resolveCredential } from '@/lib/credits';
import type { ClaudeCredential } from '@/lib/claude';

/**
 * POST /api/agents/run { taskId, force?, folderContext? }
 * 실제 실행 로직은 lib/run-task.ts (매니저의 delegate_task 와 같은 코어) 에 있습니다.
 */
async function handlePOST(request: Request) {
  const user = await getCurrentUser();
  const body = await request.json().catch(() => null) as { taskId?: unknown; force?: unknown; folderContext?: unknown } | null;
  if (typeof body?.taskId !== 'string') return Response.json({ error: '실행할 업무가 필요합니다.' }, { status: 400 });

  const { model: fallbackModel } = getRuntimeConfig();
  let apiKey: ClaudeCredential;
  try { apiKey = await resolveCredential(getDatabase(), user.userId); }
  catch (error) { const denied = credentialErrorResponse(error); if (denied) return denied; throw error; }

  const outcome = await runTask({
    db: getDatabase(), userId: user.userId, taskId: body.taskId, apiKey, fallbackModel,
    force: body.force === true,
    folderContext: typeof body.folderContext === 'string' ? body.folderContext : '',
  });
  if (!outcome.ok) return Response.json({ error: outcome.error, ...(outcome.circuitBreaker ? { circuitBreaker: outcome.circuitBreaker } : {}) }, { status: outcome.status });
  const { ok: _ok, ...payload } = outcome;
  return Response.json(payload);
}

export const POST = traceRequest('/api/agents/run', handlePOST);
