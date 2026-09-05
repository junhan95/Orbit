import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { resolveApproval } from '@/lib/approvals';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

/** POST /api/approvals/:id { decision: 'approve' | 'reject', reason? } — 승인하면 그 자리에서 카드 생성/스킬 저장 */
export async function POST(request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { decision?: unknown; reason?: unknown } | null;
  if (body?.decision !== 'approve' && body?.decision !== 'reject') {
    return Response.json({ error: "decision 은 'approve' 또는 'reject' 여야 합니다." }, { status: 400 });
  }
  const outcome = await resolveApproval(getDatabase(), user.userId, id, body.decision, typeof body.reason === 'string' ? body.reason : undefined);
  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status ?? 400 });
  return Response.json({ approval: outcome.row, result: outcome.result ?? null });
}
