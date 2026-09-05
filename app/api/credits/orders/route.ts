import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { appOrigin } from '@/lib/auth';
import { PaymentError, createOrder, paymentsEnabled, tossClientKey } from '@/lib/payments';

/**
 * 충전 주문 생성. 브라우저는 응답값으로 토스 결제창(payment.requestPayment)을 엽니다.
 * POST { krw } → { orderId, amount, orderName, clientKey, customerKey, customerEmail, customerName, successUrl, failUrl }
 * customerKey 는 사용자 id 그대로 — 토스 규칙(영문·숫자·-_=.@, 2~50자)에 맞습니다.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!paymentsEnabled()) return Response.json({ error: '결제가 아직 준비되지 않았습니다.', code: 'payments_unavailable' }, { status: 503 });
  const body = await request.json().catch(() => null) as { krw?: unknown } | null;
  const krw = Number(body?.krw);
  if (!Number.isInteger(krw) || krw <= 0) return Response.json({ error: '충전 금액이 필요합니다.' }, { status: 400 });
  try {
    const { order, orderName } = await createOrder(getDatabase(), user.userId, krw);
    const origin = appOrigin(request);
    return Response.json({
      orderId: order.id, amount: order.amountKrw, orderName,
      clientKey: tossClientKey(),
      customerKey: user.userId.replace(/[^A-Za-z0-9_\-=.@]/g, '_').slice(0, 50),
      customerEmail: user.email || undefined, customerName: user.displayName || undefined,
      successUrl: `${origin}/api/credits/confirm`, failUrl: `${origin}/api/credits/fail`,
    });
  } catch (error) {
    if (error instanceof PaymentError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
