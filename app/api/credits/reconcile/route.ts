import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { confirmPayment, getPayment, PaymentError } from '@/lib/payments';

/** Recheck a stored uncertain payment; the client cannot replace its key or amount. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const body = await request.json().catch(() => null) as { paymentId?: unknown } | null;
  if (typeof body?.paymentId !== 'string') return Response.json({ error: '결제 id가 필요합니다.' }, { status: 400 });
  const db = getDatabase();
  const order = await getPayment(db, user.userId, body.paymentId);
  if (!order?.paymentKey) return Response.json({ error: '확인할 결제를 찾을 수 없습니다.' }, { status: 404 });
  try {
    const payment = await confirmPayment(db, user.userId, { orderId: order.id, paymentKey: order.paymentKey, amount: order.amountKrw });
    return Response.json({ payment });
  } catch (error) {
    if (error instanceof PaymentError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
