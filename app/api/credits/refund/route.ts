import { traceRequest } from '@/lib/telemetry';
import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { PaymentError, refundPayment } from '@/lib/payments';

/** POST { paymentId } → 전액 환불(결제 취소). 아직 쓰지 않은 유료 크레딧만. */
async function handlePOST(request: Request) {
  const user = await getCurrentUser();
  const body = await request.json().catch(() => null) as { paymentId?: unknown } | null;
  if (typeof body?.paymentId !== 'string') return Response.json({ error: '결제 id 가 필요합니다.' }, { status: 400 });
  try {
    const payment = await refundPayment(getDatabase(), user.userId, body.paymentId);
    return Response.json({ payment });
  } catch (error) {
    if (error instanceof PaymentError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

export const POST = traceRequest('/api/credits/refund', handlePOST);
