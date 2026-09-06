import { traceRequest } from '@/lib/telemetry';
import { getCurrentUser } from '@/app/auth';
import { getDatabase, getRuntimeConfig } from '@/db';
import { runTask } from '@/lib/run-task';
import { credentialErrorResponse, resolveCredential } from '@/lib/credits';
import type { ClaudeCredential } from '@/lib/claude';
import { reportToManagerChat } from '@/lib/manager-report';
import { traceError } from '@/lib/telemetry';

/**
 * POST /api/agents/run { taskId, force?, folderContext?, reportToManager? }
 * reportToManager 가 true 면 실행이 끝난 뒤 그 프로젝트 매니저의 대화에 '📥 보고' 메시지를 남깁니다 (대화 위임의 백그라운드 실행용).
 * 실제 실행 로직은 lib/run-task.ts (매니저의 delegate_task 와 같은 코어) 에 있습니다.
 */
async function handlePOST(request: Request) {
  const user = await getCurrentUser();
  const body = await request.json().catch(() => null) as { taskId?: unknown; force?: unknown; folderContext?: unknown; reportToManager?: unknown } | null;
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
  let reported: { delivered: boolean; agentId?: string } = { delivered: false };
  if (body.reportToManager === true) {
    try { reported = await reportToManagerChat(getDatabase(), user.userId, body.taskId, outcome); }
    catch (error) { traceError('run.report_failed', error); }
  }
  return Response.json({ ...payload, reported });
}

export const POST = traceRequest('/api/agents/run', handlePOST);
