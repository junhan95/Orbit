import { MODEL_PRICES, WEB_SEARCH_PRICE_PER_CALL, estimateCostUsd, priceFor, type ModelPrice, type UsageTotals } from './pricing';

/**
 * 크레딧 단가 — 순수 계산만 (D1·환경변수 없음, 테스트 가능). 서버 쪽 원장·잔액은 lib/credits.ts.
 *
 * 규칙 (docs/pricing-credits.md §1)
 *   - 1 크레딧 = 10원 (부가세 포함 소비자가). 내부 단위는 밀리크레딧(1/1,000 크레딧 = 0.01원) 정수.
 *   - 크레딧 단가 = Anthropic 공개 단가(USD) × 배수 × 환율 ÷ 10.  배수·환율은 설정값이고 표는 자동 계산.
 *   - 웹 검색은 토큰과 같은 식으로 환산해 합산 차감하고, 내역에서는 별도 항목으로 보여 줍니다.
 */

export const KRW_PER_CREDIT = 10;
export const MC_PER_CREDIT = 1_000;

/** 설정값이 없을 때의 기본. 운영에서는 CREDIT_MARKUP / CREDIT_FX_RATE / CREDIT_TRIAL_CREDITS 로 덮어씁니다. */
export const DEFAULT_CREDIT_MARKUP = 1.8;
export const DEFAULT_CREDIT_FX_RATE = 1400;
export const DEFAULT_TRIAL_CREDITS = 300;

/** 무료(체험) 크레딧만 있는 사용자가 쓸 수 있는 모델. fable/opus 는 유료 잔액이 있어야 합니다. */
export const TRIAL_ALLOWED_MODELS = ['claude-haiku-4-5', 'claude-sonnet-5'] as const;

export type CreditConfig = { markup: number; fxRate: number };

export const DEFAULT_CREDIT_CONFIG: CreditConfig = { markup: DEFAULT_CREDIT_MARKUP, fxRate: DEFAULT_CREDIT_FX_RATE };

/** 충전 단위. 보너스는 설정으로 켜기 전까지 0 으로 지급됩니다 (§1.3). */
export const CHARGE_TIERS = [
  { krw: 5_000, credits: 500, bonusPct: 0 },
  { krw: 10_000, credits: 1_000, bonusPct: 0 },
  { krw: 30_000, credits: 3_000, bonusPct: 5 },
  { krw: 50_000, credits: 5_000, bonusPct: 8 },
] as const;
export const CHARGE_BONUS_ENABLED = false;

export function creditsToMc(credits: number): number {
  return Math.round(credits * MC_PER_CREDIT);
}

export function mcToCredits(mc: number): number {
  return mc / MC_PER_CREDIT;
}

export function mcToKrw(mc: number): number {
  return (mc / MC_PER_CREDIT) * KRW_PER_CREDIT;
}

/** 원화 결제액 → 기본 지급 밀리크레딧 (10원 = 1 크레딧). */
export function krwToMc(krw: number): number {
  return Math.round((krw / KRW_PER_CREDIT) * MC_PER_CREDIT);
}

/** USD 원가 → 밀리크레딧. 반올림은 여기서 한 번만 합니다. */
export function usdToMc(usd: number, config: CreditConfig = DEFAULT_CREDIT_CONFIG): number {
  return Math.round(((usd * config.markup * config.fxRate) / KRW_PER_CREDIT) * MC_PER_CREDIT);
}

/** Claude 호출 1건의 사용량을 밀리크레딧으로. estimateCostUsd 와 같은 단가표를 쓰므로 둘이 어긋나지 않습니다. */
export function usageToMc(model: string, usage: UsageTotals, config: CreditConfig = DEFAULT_CREDIT_CONFIG): number {
  return usdToMc(estimateCostUsd(model, usage), config);
}

export type CreditRate = { input: number; output: number; cacheWrite: number; cacheRead: number };

/** 모델 하나의 단가 (100만 토큰당 크레딧). 화면 단가표·프롬프트 안내에 씁니다. */
export function creditRateFor(model: string, config: CreditConfig = DEFAULT_CREDIT_CONFIG): { rate: CreditRate; known: boolean } {
  const { price, known } = priceFor(model);
  return { rate: toCreditRate(price, config), known };
}

function toCreditRate(price: ModelPrice, config: CreditConfig): CreditRate {
  const per = (usd: number) => mcToCredits(usdToMc(usd, config));
  return { input: per(price.input), output: per(price.output), cacheWrite: per(price.cacheWrite), cacheRead: per(price.cacheRead) };
}

/** 전체 단가표 — lib/pricing.ts 의 MODEL_PRICES 를 그대로 따르므로 하드코딩된 표가 없습니다. */
export function creditRateTable(config: CreditConfig = DEFAULT_CREDIT_CONFIG): {
  models: Array<{ model: string } & CreditRate>;
  webSearchPerCall: number;
  config: CreditConfig;
} {
  return {
    models: Object.entries(MODEL_PRICES).map(([model, price]) => ({ model, ...toCreditRate(price, config) })),
    webSearchPerCall: mcToCredits(usdToMc(WEB_SEARCH_PRICE_PER_CALL, config)),
    config,
  };
}

/** 충전 단위 하나의 실제 지급량. 보너스가 꺼져 있으면 기본분만. */
export function chargeGrant(krw: number): { creditsMc: number; bonusMc: number } | null {
  const tier = CHARGE_TIERS.find((t) => t.krw === krw);
  if (!tier) return null;
  const creditsMc = creditsToMc(tier.credits);
  const bonusMc = CHARGE_BONUS_ENABLED ? Math.round((creditsMc * tier.bonusPct) / 100) : 0;
  return { creditsMc, bonusMc };
}

/** 무료 크레딧만 있을 때 이 모델을 써도 되는지. 날짜 접미사가 붙은 id 도 접두사로 봅니다. */
export function isTrialAllowedModel(model: string): boolean {
  return TRIAL_ALLOWED_MODELS.some((id) => model === id || model.startsWith(`${id}-`));
}

/** 화면 표시용: 소수 첫째 자리까지, 0.05 미만은 "0". */
export function formatCredits(mc: number): string {
  const credits = mcToCredits(mc);
  const rounded = Math.round(credits * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toLocaleString('ko-KR') : rounded.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
