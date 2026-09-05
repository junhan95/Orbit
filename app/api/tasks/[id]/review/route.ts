import { traceRequest } from '@/lib/telemetry';
import { getCurrentUser } from '@/app/auth';
import { getDatabase, getRuntimeConfig } from '@/db';
import { runTaskReview } from '@/lib/reviewer';
import { credentialErrorResponse, resolveCredential } from '@/lib/credits';
import type { ClaudeCredential } from '@/lib/claude';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

/**
 * POST /api/tasks/:id/review — 이 카드의 최근 실행 결과를 다른 에이전트가 검토합니다 (수동 재검토용).
 * 실행이 끝나면 서버가 같은 검토를 백그라운드로 자동 실행하므로, 보통은 사람이 댓글을 달고 다시 검토를 원할 때 씁니다.
 * 응답: { reviewer, verdict: 'approve'|'changes_requested', summary, findings[], hiddenNits }
 */
async function handlePOST(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  const { id } = await context.params;
  const { model } = getRuntimeConfig();
  let apiKey: ClaudeCredential;
  try { apiKey = await resolveCredential(getDatabase(), user.userId); }
  catch (error) { const denied = credentialErrorResponse(error); if (denied) return denied; throw error; }

  try {
    const outcome = await runTaskReview({ db: getDatabase(), userId: user.userId, apiKey, model, taskId: id });
    if ('skipped' in outcome) return Response.json({ error: outcome.skipped }, { status: 400 });
    return Response.json({ review: outcome });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '검토에 실패했습니다.' }, { status: 502 });
  }
}

export const POST = traceRequest('/api/tasks/[id]/review', handlePOST);
