import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { env } from './cloudflare-workers';
import { betaQuota, confirmPayment, createOrder, getPayment, markFailed, refundPayment } from '@/lib/payments';
import { CreditBilling, getBalance } from '@/lib/credits';
import { testDatabase } from './d1';
const databases: ReturnType<typeof testDatabase>[] = [];
beforeEach(() => { env.TOSS_CLIENT_KEY = 'test_ck_test'; env.TOSS_SECRET_KEY = 'test_sk_test'; });
afterEach(() => { vi.unstubAllGlobals(); for (const key of Object.keys(env)) delete env[key]; for (const { sqlite } of databases.splice(0)) sqlite.close(); });

async function setup() {
  const database = testDatabase(); databases.push(database);
  const { order } = await createOrder(database.db, 'u', 5000);
  const params = { orderId: order.id, paymentKey: 'pk_test', amount: 5000 };
  const payment = { orderId: order.id, paymentKey: params.paymentKey, totalAmount: 5000, status: 'DONE' };
  return { ...database, order, params, payment };
}

it('releases a definitively refused refund only after verifying the payment is still DONE', async () => {
  const { db, order, params, payment } = await setup();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json(payment)));
  await confirmPayment(db, 'u', params);
  for (let retry = 0; retry < 2; retry++) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ code: 'NOT_CANCELABLE_PAYMENT' }, { status: 403 })).mockResolvedValueOnce(Response.json(payment)));
    await expect(refundPayment(db, 'u', order.id)).rejects.toMatchObject({ code: 'NOT_CANCELABLE_PAYMENT' });
    expect((await getPayment(db, 'u', order.id))?.status).toBe('done');
    const billing = new CreditBilling('k', db, 'u', await getBalance(db, 'u'), { markup: 1.8, fxRate: 1400, trialCredits: 300 });
    await billing.beforeCall();
    await billing.afterCall();
  }
});

it('keeps an unresolved refund in the monthly charge cap', async () => {
  const { db, order, params, payment } = await setup();
  const second = await createOrder(db, 'u', 5000);
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json(payment)));
  await confirmPayment(db, 'u', params);
  env.CREDIT_BETA_MONTHLY_CAP = String(order.creditsMc / 1000);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
  await expect(refundPayment(db, 'u', order.id)).rejects.toThrow();
  expect((await betaQuota(db, 'u')).remainingMc).toBe(0);
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  await expect(confirmPayment(db, 'u', { orderId: second.order.id, paymentKey: 'pk_second', amount: 5000 })).rejects.toMatchObject({ code: 'payment_conflict' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('recovers a confirmation response lost after the provider approved it', async () => {
  const { db, order, params, payment } = await setup();
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(Response.json(payment));
  vi.stubGlobal('fetch', fetchMock);
  expect((await confirmPayment(db, 'u', params)).status).toBe('done');
  expect((await getBalance(db, 'u')).paidMc).toBe(order.creditsMc);
});

it('keeps unknown outcomes recoverable, validates provider identity, and credits once on retry', async () => {
  const { db, sqlite, order, params, payment } = await setup();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
  await expect(confirmPayment(db, 'u', params)).rejects.toThrow();
  expect((await getPayment(db, 'u', order.id))?.status).toBe('confirming');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...payment, orderId: 'different' })));
  await expect(confirmPayment(db, 'u', params)).rejects.toThrow();
  expect((await getBalance(db, 'u')).paidMc).toBe(0);
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json(payment)));
  expect((await confirmPayment(db, 'u', params)).status).toBe('done');
  expect((await confirmPayment(db, 'u', params)).status).toBe('done');
  expect(sqlite.prepare("SELECT * FROM credit_ledger WHERE kind = 'charge'").all()).toHaveLength(1);
});

it('rolls back failed ledger writes and reconciles on the next attempt', async () => {
  const { db, sqlite, order, params, payment } = await setup();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json(payment)));
  sqlite.exec("CREATE TRIGGER fail_charge BEFORE INSERT ON credit_ledger BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
  await expect(confirmPayment(db, 'u', params)).rejects.toThrow();
  expect((await getPayment(db, 'u', order.id))?.status).toBe('confirming');
  sqlite.exec('DROP TRIGGER fail_charge');
  expect((await confirmPayment(db, 'u', params)).status).toBe('done');
  expect((await getBalance(db, 'u')).paidMc).toBe(order.creditsMc);
});

it('reconciles an ambiguous refund without double debiting', async () => {
  const { db, sqlite, order, params, payment } = await setup();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json(payment)));
  await confirmPayment(db, 'u', params);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
  await expect(refundPayment(db, 'u', order.id)).rejects.toThrow();
  expect((await getPayment(db, 'u', order.id))?.status).toBe('refund_pending');
  expect((await getBalance(db, 'u')).availableMc).toBe(0);
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ ...payment, status: 'CANCELED' })));
  expect((await refundPayment(db, 'u', order.id)).status).toBe('refunded');
  expect((await refundPayment(db, 'u', order.id)).status).toBe('refunded');
  expect(sqlite.prepare("SELECT * FROM credit_ledger WHERE kind = 'refund'").all()).toHaveLength(1);
  expect((await getBalance(db, 'u')).balanceMc).toBe(0);
});

it('retries the same idempotent POST when the first attempt never reached the provider', async () => {
  const { db, sqlite, order, params, payment } = await setup();
  sqlite.prepare("UPDATE payments SET status = 'confirming', payment_key = ? WHERE id = ?").run(params.paymentKey, order.id);
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ code: 'NOT_FOUND_PAYMENT' }, { status: 404 })).mockResolvedValueOnce(Response.json(payment));
  vi.stubGlobal('fetch', fetchMock);
  expect((await confirmPayment(db, 'u', params)).status).toBe('done');
  expect(fetchMock.mock.calls[1][1].headers['Idempotency-Key']).toBe(`confirm-${order.id}`);
});

it('allows one concurrent confirmation and ignores a late failure callback', async () => {
  const { db, sqlite, params, payment, order } = await setup();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => { await markFailed(db, 'u', order.id, 'late callback'); return Response.json(payment); }));
  const results = await Promise.allSettled([confirmPayment(db, 'u', params), confirmPayment(db, 'u', params)]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect((await getPayment(db, 'u', order.id))?.status).toBe('done');
  expect(sqlite.prepare("SELECT * FROM credit_ledger WHERE kind = 'charge'").all()).toHaveLength(1);
});

it('does not send a refund while AI is using the same credits', async () => {
  const { db, params, payment, order } = await setup();
  const fetchMock = vi.fn().mockImplementation(async () => Response.json(payment));
  vi.stubGlobal('fetch', fetchMock);
  await confirmPayment(db, 'u', params);
  const billing = new CreditBilling('k', db, 'u', await getBalance(db, 'u'), { markup: 1.8, fxRate: 1400, trialCredits: 300 });
  await billing.beforeCall();
  await expect(refundPayment(db, 'u', order.id)).rejects.toMatchObject({ status: 409 });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect((await getPayment(db, 'u', order.id))?.status).toBe('done');
  await billing.afterCall();
});

it('rejects other users and wrong amounts before contacting the provider', async () => {
  const { db, params } = await setup();
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  await expect(confirmPayment(db, 'other', params)).rejects.toMatchObject({ status: 404 });
  await expect(confirmPayment(db, 'u', { ...params, amount: 1 })).rejects.toMatchObject({ status: 400 });
  expect(fetchMock).not.toHaveBeenCalled();
});
