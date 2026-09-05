import { env } from 'cloudflare:workers';
import { authMode } from '@/lib/auth';
import type { ClaudeBilling, ClaudeCredential, ClaudeUsage } from '@/lib/claude';
import {
  DEFAULT_CREDIT_FX_RATE, DEFAULT_CREDIT_MARKUP, DEFAULT_TRIAL_CREDITS, TRIAL_ALLOWED_MODELS, creditsToMc, formatCredits,
  isTrialAllowedModel, usageToMc, type CreditConfig,
} from '@/lib/credits-pricing';
import { ApiKeyMissingError, apiKeyMissingResponse, loadUserKey } from '@/lib/user-keys';

/**
 * 크레딧 원장·잔액 (서버 전용). 단가 계산은 lib/credits-pricing.ts, 설계는 docs/pricing-credits.md.
 *
 * 원칙
 *   - 잔액은 저장하지 않고 credit_ledger.amount_mc 의 합으로 구합니다. 행은 수정·삭제하지 않고 정정은 adjust 행으로.
 *   - 차감은 promo(무료·보너스) 버킷부터, 그다음 paid. 환불 시 paid 잔액만 보면 됩니다.
 *   - 체험 크레딧은 사용자당 한 번 — DB 의 부분 유니크 인덱스(kind='trial')가 경쟁 상태에서도 중복을 막습니다.
 *
 * 과금 경로
 *   local  : 로컬 단일 사용자 모드(.env 키). 크레딧을 쓰지 않습니다.
 *   byok   : 사용자 본인 키가 등록됨 → 무료. 키가 있으면 언제나 키 우선.
 *   credits: 키 없음 → 크레딧 잔액에서 차감.
 */

export type LedgerKind = 'trial' | 'charge' | 'bonus' | 'usage' | 'refund' | 'adjust';
export type LedgerBucket = 'paid' | 'promo';
export type BillingMode = 'local' | 'byok' | 'credits';

export type CreditBalance = {
  /** 원장 합계 (예약 반영 전) */
  balanceMc: number;
  /** open 상태 가예약 합계 */
  heldMc: number;
  /** 실행에 쓸 수 있는 잔액 = balance − held */
  availableMc: number;
  paidMc: number;
  promoMc: number;
};

export type LedgerEntry = {
  id: string; kind: LedgerKind; bucket: LedgerBucket; amountMc: number;
  refType: string | null; refId: string | null; meta: Record<string, unknown> | null; createdAt: number;
};

export type CreditRuntimeConfig = CreditConfig & { trialCredits: number };

function numberFrom(value: string | undefined, fallback: number, min: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** 배수·환율·체험 크레딧. 환경변수가 없거나 이상하면 기본값 (환율은 월 1회 수동 갱신 — §8). */
export function creditConfig(): CreditRuntimeConfig {
  return {
    markup: numberFrom(env.CREDIT_MARKUP, DEFAULT_CREDIT_MARKUP, 1),
    fxRate: numberFrom(env.CREDIT_FX_RATE, DEFAULT_CREDIT_FX_RATE, 1),
    trialCredits: numberFrom(env.CREDIT_TRIAL_CREDITS, DEFAULT_TRIAL_CREDITS, 0),
  };
}

// ── 잔액 ────────────────────────────────────────────────────

export async function getBalance(db: D1Database, userId: string): Promise<CreditBalance> {
  const [buckets, holds] = await db.batch([
    db.prepare('SELECT bucket, COALESCE(SUM(amount_mc), 0) AS total FROM credit_ledger WHERE user_id = ? GROUP BY bucket').bind(userId),
    db.prepare("SELECT COALESCE(SUM(amount_mc), 0) AS total FROM credit_holds WHERE user_id = ? AND status = 'open'").bind(userId),
  ]);
  let paidMc = 0; let promoMc = 0;
  for (const row of (buckets.results ?? []) as Array<{ bucket: string; total: number }>) {
    if (row.bucket === 'paid') paidMc = Number(row.total) || 0;
    else if (row.bucket === 'promo') promoMc = Number(row.total) || 0;
  }
  const heldMc = Number((holds.results?.[0] as { total?: number } | undefined)?.total) || 0;
  const balanceMc = paidMc + promoMc;
  return { balanceMc, heldMc, availableMc: balanceMc - heldMc, paidMc, promoMc };
}

// ── 원장 기록 ───────────────────────────────────────────────

/**
 * 원장 행 하나를 만드는 prepared statement. usageInsert 처럼 statement 만 돌려주므로
 * 호출한 쪽에서 db.batch 에 사용량 기록과 함께 끼워 넣을 수 있습니다.
 */
export function ledgerInsert(db: D1Database, params: {
  userId: string; kind: LedgerKind; bucket: LedgerBucket; amountMc: number;
  refType?: string | null; refId?: string | null; meta?: Record<string, unknown> | null; id?: string;
}) {
  return db.prepare(
    'INSERT INTO credit_ledger (id, user_id, kind, bucket, amount_mc, ref_type, ref_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    params.id ?? crypto.randomUUID(), params.userId, params.kind, params.bucket, Math.trunc(params.amountMc),
    params.refType ?? null, params.refId ?? null, params.meta ? JSON.stringify(params.meta) : null, Date.now(),
  );
}

/**
 * 가입 체험 크레딧 지급. 이미 받았으면 아무것도 하지 않습니다 (멱등).
 * 로그인 콜백과 잔액 조회 양쪽에서 부르므로, 크레딧 기능 이전에 가입한 사용자도 처음 잔액을 볼 때 받습니다.
 */
export async function grantTrialCredits(db: D1Database, userId: string, config: CreditRuntimeConfig = creditConfig()): Promise<{ granted: boolean; amountMc: number }> {
  const amountMc = creditsToMc(config.trialCredits);
  if (amountMc <= 0) return { granted: false, amountMc: 0 };
  const existing = await db.prepare("SELECT id FROM credit_ledger WHERE user_id = ? AND kind = 'trial' LIMIT 1").bind(userId).first<{ id: string }>();
  if (existing) return { granted: false, amountMc };
  try {
    await ledgerInsert(db, { userId, kind: 'trial', bucket: 'promo', amountMc, refType: 'signup', meta: { credits: config.trialCredits } }).run();
    return { granted: true, amountMc };
  } catch (error) {
    // 동시 요청이 먼저 지급한 경우 — 유니크 인덱스가 막은 것이니 정상입니다.
    if (error instanceof Error && /UNIQUE/i.test(error.message)) return { granted: false, amountMc };
    throw error;
  }
}

export async function listLedger(db: D1Database, userId: string, limit = 50): Promise<LedgerEntry[]> {
  const rows = await db.prepare(
    'SELECT id, kind, bucket, amount_mc, ref_type, ref_id, meta, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
  ).bind(userId, Math.max(1, Math.min(limit, 200))).all<{
    id: string; kind: LedgerKind; bucket: LedgerBucket; amount_mc: number;
    ref_type: string | null; ref_id: string | null; meta: string | null; created_at: number;
  }>();
  return (rows.results ?? []).map((r) => ({
    id: r.id, kind: r.kind, bucket: r.bucket, amountMc: r.amount_mc,
    refType: r.ref_type, refId: r.ref_id, meta: parseMeta(r.meta), createdAt: r.created_at,
  }));
}

function parseMeta(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; }
}

// ── 과금 경로 ───────────────────────────────────────────────

/** 이번 사용자의 Claude 호출이 어느 주머니에서 나가는지. 키가 있으면 언제나 키(byok) 우선입니다. */
export async function billingMode(db: D1Database, userId: string): Promise<BillingMode> {
  if (authMode() === 'local' && env.ANTHROPIC_API_KEY) return 'local';
  const key = await db.prepare('SELECT 1 AS ok FROM user_keys WHERE user_id = ?').bind(userId).first<{ ok: number }>();
  return key ? 'byok' : 'credits';
}

// ── 실행 경로: 자격 증명 + 계량 ───────────────────────────

/** 크레딧이 없어 Claude 를 부를 수 없을 때. 라우트는 402 { code: 'insufficient_credits' } 로 바꿉니다. */
export class InsufficientCreditsError extends Error {
  code = 'insufficient_credits' as const;
  constructor(public availableMc: number) {
    super(`크레딧 잔액이 부족합니다 (남은 크레딧 ${formatCredits(Math.max(0, availableMc))}). 충전하거나 본인 Anthropic API 키를 연결해 주세요.`);
  }
}

export function insufficientCreditsResponse(availableMc: number, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: new InsufficientCreditsError(availableMc).message, code: 'insufficient_credits', availableMc, ...extra }, { status: 402 });
}

/** resolveCredential 이 던진 오류를 응답으로. 우리가 아는 오류가 아니면 null (호출한 쪽이 다시 던짐). */
export function credentialErrorResponse(error: unknown, extra: Record<string, unknown> = {}): Response | null {
  if (error instanceof ApiKeyMissingError) return apiKeyMissingResponse(extra);
  if (error instanceof InsufficientCreditsError) return insufficientCreditsResponse(error.availableMc, extra);
  return null;
}

/** 체험 크레딧만 있을 때 허용 모델이 아니면 이 모델로 보냅니다. */
const TRIAL_FALLBACK_MODEL: string = TRIAL_ALLOWED_MODELS[1];

/**
 * 크레딧 경로의 과금 핸들 — lib/claude.ts 가 apiKey 자리에서 받아 호출마다 onUsage 를 부릅니다.
 *
 *   - 잔액 스냅샷은 만들 때 한 번 읽고, 이 핸들을 거친 호출의 실측 차감을 누적해 비교합니다.
 *     같은 요청 안의 매니저 → 하위 에이전트 호출은 모두 같은 핸들을 공유하므로 합산이 맞습니다.
 *   - 호출이 끝날 때마다 원장에 usage 행을 바로 씁니다 (호출 단위, ref = 메시지 id). 실행 도중 죽어도 쓴 만큼은 남습니다.
 *   - 유료 잔액이 없으면(체험만) fable/opus 요청을 허용 모델로 바꿉니다 — 사용량 기록에는 실제 모델이 남습니다.
 */
export class CreditBilling implements ClaudeBilling {
  readonly mode = 'credits' as const;
  usedMc = 0;

  constructor(
    readonly apiKey: string,
    private readonly db: D1Database,
    readonly userId: string,
    private balance: CreditBalance,
    private readonly config: CreditRuntimeConfig,
  ) {}

  get availableMc(): number { return this.balance.availableMc - this.usedMc; }
  get trialOnly(): boolean { return this.balance.paidMc <= 0; }

  resolveModel(model: string): string {
    return this.trialOnly && !isTrialAllowedModel(model) ? TRIAL_FALLBACK_MODEL : model;
  }

  beforeCall(): void {
    if (this.availableMc <= 0) throw new InsufficientCreditsError(this.availableMc);
  }

  async onUsage(model: string, usage: ClaudeUsage): Promise<{ stop: boolean }> {
    const mc = usageToMc(model, usage, this.config);
    this.usedMc += mc;
    if (mc > 0) {
      await ledgerInsert(this.db, {
        userId: this.userId, kind: 'usage', bucket: this.balance.promoMc - this.usedMc >= 0 ? 'promo' : 'paid', amountMc: -mc,
        refType: 'call', meta: {
          model, in: usage.inputTokens, out: usage.outputTokens, cacheWrite: usage.cacheCreationTokens, cacheRead: usage.cacheReadTokens,
          webSearch: usage.webSearchRequests, markup: this.config.markup, fxRate: this.config.fxRate,
        },
      }).run();
    }
    return { stop: this.availableMc <= 0 };
  }

  /** 다시 읽은 잔액으로 스냅샷을 갱신 (백그라운드 작업이 뒤늦게 이 핸들을 쓸 때). */
  async refresh(): Promise<void> {
    this.balance = await getBalance(this.db, this.userId);
    this.usedMc = 0;
  }
}

/**
 * 이번 요청에서 Claude 를 부를 자격 증명.
 *   local   → .env 키 문자열
 *   byok    → 사용자 키 문자열 (키가 있으면 언제나 키 우선, 과금 없음)
 *   credits → CreditBilling (운영자 키 + 계량). 운영자 키(ANTHROPIC_API_KEY)가 없으면 예전처럼 ApiKeyMissingError.
 * 잔액이 0 이하면 실행 전에 InsufficientCreditsError.
 */
export async function resolveCredential(db: D1Database, userId: string): Promise<ClaudeCredential> {
  if (authMode() === 'local' && env.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY;
  const stored = await loadUserKey(db, userId);
  if (stored) return stored;
  const operatorKey = env.ANTHROPIC_API_KEY;
  if (!operatorKey) throw new ApiKeyMissingError();
  const config = creditConfig();
  await grantTrialCredits(db, userId, config);
  const balance = await getBalance(db, userId);
  if (balance.availableMc <= 0) throw new InsufficientCreditsError(balance.availableMc);
  return new CreditBilling(operatorKey, db, userId, balance, config);
}
