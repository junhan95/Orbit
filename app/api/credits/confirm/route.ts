import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { appOrigin } from '@/lib/auth';
import { PaymentError, confirmPayment } from '@/lib/payments';
import { mcToCredits } from '@/lib/credits-pricing';

/**
 * 토스 successUrl. 결제창 인증이 끝나면 브라우저가 ?paymentKey&orderId&amount 를 달고 여기로 옵니다.
 * 서버에서 승인(confirm)까지 마친 뒤 앱으로 돌려보냅니다 — 앱은 ?credits=done 을 보고 안내합니다.
 * 승인은 멱등이라 새로고침해도 두 번 지급되지 않습니다.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const url = new URL(request.url);
  const origin = appOrigin(request);
  const paymentKey = url.searchParams.get('paymentKey') ?? '';
  const orderId = url.searchParams.get('orderId') ?? '';
  const amount = Number(url.searchParams.get('amount'));
  const back = (params: Record<string, string>) => Response.redirect(`${origin}/?${new URLSearchParams(params).toString()}`, 303);

  if (!paymentKey || !orderId || !Number.isFinite(amount)) return back({ credits: 'error', message: '결제 정보가 올바르지 않습니다.' });
  try {
    const payment = await confirmPayment(getDatabase(), user.userId, { paymentKey, orderId, amount });
    return back({ credits: 'done', amount: String(mcToCredits(payment.creditsMc + payment.bonusMc)) });
  } catch (error) {
    const message = error instanceof PaymentError ? error.message : '결제 승인에 실패했습니다.';
    if (!(error instanceof PaymentError)) console.error('[payments] confirm failed', error);
    return back({ credits: 'error', message });
  }
}
