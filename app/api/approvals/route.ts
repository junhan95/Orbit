import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { listApprovals, type ApprovalStatus } from '@/lib/approvals';

/** GET /api/approvals?status=pending|approved|rejected|all — 승인 대기 큐 (기본 pending) */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const raw = new URL(request.url).searchParams.get('status') ?? 'pending';
  const status = (['pending', 'approved', 'rejected', 'all'] as const).includes(raw as ApprovalStatus | 'all') ? (raw as ApprovalStatus | 'all') : 'pending';
  const approvals = await listApprovals(getDatabase(), user.userId, status);
  return Response.json({
    approvals: approvals.map((row) => ({ ...row, payload: safeJson(row.payload) })),
    pendingCount: status === 'pending' ? approvals.length : approvals.filter((row) => row.status === 'pending').length,
  });
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return {}; }
}
