import { env } from 'cloudflare:workers';
import { getBalance, ledgerInsert } from '@/lib/credits';
import { chargeGrant, mcToCredits } from '@/lib/credits-pricing';

/**
 * 크레딧 충전 결제 — 토스페이먼츠 결제창(주문서형·결제창형 키) 일반결제 (docs/pricing-credits.md §2.3).
 *
 *   1. createOrder      : payments 에 pending 행 (id = orderId). 금액은 CHARGE_TIERS 중 하나만.
 *   2. (브라우저)         : SDK payment.requestPayment → 인증 후 successUrl 로 paymentKey·orderId·amount 가 돌아옴
 *   3. confirmPayment   : 주문 금액과 대조 → POST /v1/payments/confirm (Basic base64(secret:)) → done + 원장 charge(+bonus)
 *   4. refundPayment    : 미사용 유료 잔액이 그 결제분 이상일 때만 전액 취소 → refunded + 원장 refund
 *
 * 같은 orderId 를 두 번 승인해도 원장은 한 번만 붙습니다(상태가 done 이면 그대로 돌려줌).
 * 카드 번호 같은 민감 정보는 저장하지 않고, 승인 응답 원문(raw)만 남깁니다.
 */

const TOSS_API = 'https://api.tosspayments.com/v1';
const PROVIDER = 'toss';

export type PaymentStatus = 'pending' | 'done' | 'failed' | 'canceled' | 'refunded';
export type PaymentRow = {
  id: string; userId: string; provider: string; paymentKey: string | null;
  amountKrw: number; creditsMc: number; bonusMc: number; status: PaymentStatus;
  method: string | null; receiptUrl: string | null; createdAt: number; approvedAt: number | null;
};

type DbRow = {
  id: string; user_id: string; provider: string; payment_key: string | null;
  amount_krw: number; credits_mc: number; bonus_mc: number; status: PaymentStatus;
  method: string | null; receipt_url: string | null; created_at: number; approved_at: number | null;
};

export class PaymentError extends Error {
  constructor(message: string, public status = 400, public code = 'payment_error') { super(message); }
}

export function tossClientKey(): string | null {
  return env.TOSS_CLIENT_KEY || null;
}

function tossAuth(): string {
  const secret = env.TOSS_SECRET_KEY;
  if (!secret) throw new PaymentError('결제가 아직 준비되지 않았습니다 (TOSS_SECRET_KEY 없음).', 503, 'payments_unavailable');
  return `Basic ${btoa(`${secret}:`)}`;
}

/** 결제 기능이 켜져 있는지 — 클라이언트·시크릿 키가 둘 다 있어야 합니다. */
export function paymentsEnabled(): boolean {
  return Boolean(env.TOSS_CLIENT_KEY && env.TOSS_SECRET_KEY);
}

/**
 * 베타 과금 모드 (docs/pricing-credits.md §10) — 토스 테스트 키(test_ck_/test_sk_)로 도는 동안은 결제창이 열려도 실제 청구가 없습니다.
 * 그래서 "베타 사용자는 과금 없이 충전" 이 되고, 대신 사용자당 월 충전 한도(CREDIT_BETA_MONTHLY_CAP, 기본 5,000 크레딧)를 둡니다.
 * live 키로 바꾸는 순간 자동으로 꺼집니다 — 별도 플래그를 두지 않는 이유는 "테스트 키 = 무과금" 이라는 사실과 어긋날 수 없게 하기 위해서입니다.
 */
export function betaBilling(): boolean {
  return paymentsEnabled() && (env.TOSS_CLIENT_KEY ?? '').startsWith('test_');
}

export const DEFAULT_BETA_MONTHLY_CAP_CREDITS = 5_000;

/** 베타 월 한도(마이크로크레딧). 0 으로 설정하면 한도 없음. */
export function betaMonthlyCapMc(): number {
  const raw = env.CREDIT_BETA_MONTHLY_CAP;
  const credits = raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : DEFAULT_BETA_MONTHLY_CAP_CREDITS;
  return Math.max(0, Math.round(credits * 1000));
}

const KST_OFFSET = 9 * 3600 * 1000;

/** 이번 달 시작 시각(ms) — 한국 시간(UTC+9) 기준 1일 0시. 원화 결제·한국 사용자 기준이라 서버 시간대와 무관하게 고정합니다. */
export function monthStartKst(now = Date.now()): number {
  const local = new Date(now + KST_OFFSET);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - KST_OFFSET;
}

/** 다음 달 1일 0시(KST, ms) — 한도가 초기화되는 시각. */
export function nextMonthStartKst(now = Date.now()): number {
  const local = new Date(now + KST_OFFSET);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - KST_OFFSET;
}

export type BetaQuota = { enabled: boolean; capMc: number; usedMc: number; remainingMc: number; resetsAt: number };

/** 이번 달 베타 충전 사용량 — 승인 완료(done)된 결제의 크레딧 합. 환불된 결제는 status 가 바뀌므로 한도에서 빠집니다. */
export async function betaQuota(db: D1Database, userId: string, now = Date.now()): Promise<BetaQuota> {
  const enabled = betaBilling();
  const resetsAt = nextMonthStartKst(now);
  if (!enabled) return { enabled, capMc: 0, usedMc: 0, remainingMc: 0, resetsAt };
  const capMc = betaMonthlyCapMc();
  const row = await db.prepare(
    "SELECT COALESCE(SUM(credits_mc), 0) AS used FROM payments WHERE user_id = ? AND status = 'done' AND approved_at >= ?",
  ).bind(userId, monthStartKst(now)).first<{ used: number }>();
  const usedMc = Number(row?.used ?? 0);
  return { enabled, capMc, usedMc, remainingMc: capMc > 0 ? Math.max(0, capMc - usedMc) : Number.MAX_SAFE_INTEGER, resetsAt };
}

function fromRow(r: DbRow): PaymentRow {
  return {
    id: r.id, userId: r.user_id, provider: r.provider, paymentKey: r.payment_key,
    amountKrw: r.amount_krw, creditsMc: r.credits_mc, bonusMc: r.bonus_mc, status: r.status,
    method: r.method, receiptUrl: r.receipt_url, createdAt: r.created_at, approvedAt: r.approved_at,
  };
}

/** 토스 orderId 규칙: 영문·숫자·-·_ 6~64자. */
function newOrderId(): string {
  return `oc_${crypto.randomUUID().replace(/-/g, '')}`;
}

export async function createOrder(db: D1Database, userId: string, amountKrw: number): Promise<{ order: PaymentRow; orderName: string }> {
  const grant = chargeGrant(amountKrw);
  if (!grant) throw new PaymentError('지원하지 않는 충전 금액입니다.', 400, 'bad_amount');
  const now = Date.now();
  if (betaBilling()) {
    const quota = await betaQuota(db, userId, now);
    if (quota.capMc > 0 && grant.creditsMc > quota.remainingMc) {
      throw new PaymentError(
        `베타 기간에는 한 달에 ${mcToCredits(quota.capMc).toLocaleString('ko-KR')} 크레딧까지 충전할 수 있습니다 (이번 달 남은 한도 ${mcToCredits(quota.remainingMc).toLocaleString('ko-KR')} 크레딧).`,
        429, 'beta_quota_exceeded',
      );
    }
  }
  const id = newOrderId();
  await db.prepare(
    'INSERT INTO payments (id, user_id, provider, amount_krw, credits_mc, bonus_mc, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, userId, PROVIDER, amountKrw, grant.creditsMc, grant.bonusMc, 'pending', now).run();
  const orderName = `orbitcrew 크레딧 ${mcToCredits(grant.creditsMc).toLocaleString('ko-KR')}`;
  return {
    order: { id, userId, provider: PROVIDER, paymentKey: null, amountKrw, creditsMc: grant.creditsMc, bonusMc: grant.bonusMc, status: 'pending', method: null, receiptUrl: null, createdAt: now, approvedAt: null },
    orderName,
  };
}

export async function getPayment(db: D1Database, userId: string, id: string): Promise<PaymentRow | null> {
  const row = await db.prepare('SELECT * FROM payments WHERE id = ? AND user_id = ?').bind(id, userId).first<DbRow>();
  return row ? fromRow(row) : null;
}

export async function listPayments(db: D1Database, userId: string, limit = 20): Promise<PaymentRow[]> {
  const rows = await db.prepare(
    "SELECT * FROM payments WHERE user_id = ? AND status <> 'pending' ORDER BY created_at DESC LIMIT ?",
  ).bind(userId, Math.max(1, Math.min(limit, 100))).all<DbRow>();
  return (rows.results ?? []).map(fromRow);
}

type TossPayment = {
  paymentKey: string; orderId: string; status: string; method?: string; totalAmount?: number;
  approvedAt?: string; receipt?: { url?: string }; easyPay?: { provider?: string }; card?: { issuerCode?: string };
};
type TossError = { code?: string; message?: string };

async function tossPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${TOSS_API}${path}`, {
    method: 'POST',
    headers: { Authorization: tossAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as T & TossError;
  if (!response.ok) throw new PaymentError(data.message || `토스페이먼츠가 ${response.status} 로 응답했습니다.`, 502, data.code || 'toss_error');
  return data;
}

/** 결제수단 표시명: 카드 · 계좌이체 · 간편결제(토스페이 등). */
function methodLabel(payment: TossPayment): string {
  if (payment.easyPay?.provider) return `간편결제 · ${payment.easyPay.provider}`;
  return payment.method ?? '결제';
}

/**
 * successUrl 로 돌아온 값으로 승인. 주문 금액이 다르면 승인하지 않습니다(클라이언트 변조 방지).
 * 이미 done 이면 그대로 돌려줍니다(새로고침·중복 호출).
 */
export async function confirmPayment(db: D1Database, userId: string, params: { paymentKey: string; orderId: string; amount: number }): Promise<PaymentRow> {
  const order = await getPayment(db, userId, params.orderId);
  if (!order) throw new PaymentError('주문을 찾을 수 없습니다.', 404, 'order_not_found');
  if (order.status === 'done') return order;
  if (order.status !== 'pending') throw new PaymentError('이미 끝난 주문입니다.', 409, 'order_closed');
  if (order.amountKrw !== params.amount) throw new PaymentError('결제 금액이 주문과 다릅니다.', 400, 'amount_mismatch');

  let payment: TossPayment;
  try {
    payment = await tossPost<TossPayment>('/payments/confirm', { paymentKey: params.paymentKey, orderId: params.orderId, amount: params.amount });
  } catch (error) {
    await db.prepare('UPDATE payments SET status = ?, raw = ? WHERE id = ? AND user_id = ?')
      .bind('failed', JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), order.id, userId).run();
    throw error;
  }
  if (payment.status !== 'DONE') throw new PaymentError(`결제 상태가 ${payment.status} 입니다.`, 502, 'not_done');

  const approvedAt = payment.approvedAt ? Date.parse(payment.approvedAt) : Date.now();
  const method = methodLabel(payment);
  const statements = [
    db.prepare('UPDATE payments SET status = ?, payment_key = ?, method = ?, receipt_url = ?, raw = ?, approved_at = ? WHERE id = ? AND user_id = ? AND status = ?')
      .bind('done', payment.paymentKey, method, payment.receipt?.url ?? null, JSON.stringify(payment), approvedAt, order.id, userId, 'pending'),
    // beta:true — 테스트 키로 승인된(실청구 없는) 충전. 베타 종료 시 이 표시로 잔여분을 소멸 처리합니다 (docs/pricing-credits.md §10).
    ledgerInsert(db, { userId, kind: 'charge', bucket: 'paid', amountMc: order.creditsMc, refType: 'payment', refId: order.id, meta: { krw: order.amountKrw, method, ...(betaBilling() ? { beta: true } : {}) } }),
  ];
  if (order.bonusMc > 0) {
    statements.push(ledgerInsert(db, { userId, kind: 'bonus', bucket: 'promo', amountMc: order.bonusMc, refType: 'payment', refId: order.id, meta: { krw: order.amountKrw } }));
  }
  await db.batch(statements);
  return { ...order, status: 'done', paymentKey: payment.paymentKey, method, receiptUrl: payment.receipt?.url ?? null, approvedAt };
}

/** failUrl 로 온 실패·취소를 기록만 합니다 (원장 변동 없음). */
export async function markFailed(db: D1Database, userId: string, orderId: string, reason: string): Promise<void> {
  await db.prepare('UPDATE payments SET status = ?, raw = ? WHERE id = ? AND user_id = ? AND status = ?')
    .bind('failed', JSON.stringify({ error: reason }), orderId, userId, 'pending').run();
}

/**
 * 전액 환불. 조건: done 상태이고, 지금 유료 잔액이 그 결제로 받은 크레딧 이상(= 아직 안 씀).
 * 보너스는 회수하지 않고 별도 음수 행으로 되돌립니다(약관: 보너스는 환불 대상 아님, 다만 결제가 취소되면 같이 회수).
 */
export async function refundPayment(db: D1Database, userId: string, id: string, reason = '사용자 요청'): Promise<PaymentRow> {
  const payment = await getPayment(db, userId, id);
  if (!payment) throw new PaymentError('결제를 찾을 수 없습니다.', 404, 'payment_not_found');
  if (payment.status !== 'done' || !payment.paymentKey) throw new PaymentError('환불할 수 있는 결제가 아닙니다.', 409, 'not_refundable');
  const balance = await getBalance(db, userId);
  if (balance.paidMc < payment.creditsMc) {
    throw new PaymentError('이 결제로 받은 크레딧을 이미 일부 사용해 환불할 수 없습니다.', 409, 'credits_used');
  }
  await tossPost(`/payments/${encodeURIComponent(payment.paymentKey)}/cancel`, { cancelReason: reason });
  const statements = [
    db.prepare('UPDATE payments SET status = ? WHERE id = ? AND user_id = ?').bind('refunded', payment.id, userId),
    ledgerInsert(db, { userId, kind: 'refund', bucket: 'paid', amountMc: -payment.creditsMc, refType: 'payment', refId: payment.id, meta: { krw: payment.amountKrw, reason } }),
  ];
  if (payment.bonusMc > 0) {
    statements.push(ledgerInsert(db, { userId, kind: 'refund', bucket: 'promo', amountMc: -Math.min(payment.bonusMc, Math.max(0, balance.promoMc)), refType: 'payment', refId: payment.id, meta: { bonus: true } }));
  }
  await db.batch(statements);
  return { ...payment, status: 'refunded' };
}

/** 화면용: 이 결제를 지금 환불할 수 있는지. */
export function refundable(payment: PaymentRow, paidMc: number): boolean {
  return payment.status === 'done' && paidMc >= payment.creditsMc;
}
