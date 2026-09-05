import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { appOrigin } from '@/lib/auth';
import { markFailed } from '@/lib/payments';

/** 토스 failUrl — 사용자가 결제창을 닫았거나 인증에 실패했을 때. 주문만 failed 로 두고 앱으로 돌려보냅니다. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const url = new URL(request.url);
  const origin = appOrigin(request);
  const code = url.searchParams.get('code') ?? '';
  const message = url.searchParams.get('message') ?? '결제가 취소되었습니다.';
  const orderId = url.searchParams.get('orderId');
  if (orderId) await markFailed(getDatabase(), user.userId, orderId, `${code} ${message}`.trim()).catch(() => {});
  const canceled = code === 'PAY_PROCESS_CANCELED' || code === 'USER_CANCEL';
  return Response.redirect(`${origin}/?${new URLSearchParams({ credits: canceled ? 'canceled' : 'error', message }).toString()}`, 303);
}
