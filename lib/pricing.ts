/**
 * Anthropic 공개 단가 (USD / 100만 토큰). 2026년 9월 문서 기준입니다.
 * https://platform.claude.com/docs/en/about-claude/pricing
 *
 * 단가가 바뀌면 이 표만 고치면 사용량 화면 전체에 반영됩니다.
 * 화면에 표시되는 금액은 어디까지나 '추정치'이며 실제 청구액과 다를 수 있습니다.
 */
export type ModelPrice = { input: number; output: number; cacheWrite: number; cacheRead: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

/** 웹 검색 서버 툴: 1,000회당 USD 10 */
export const WEB_SEARCH_PRICE_PER_CALL = 10 / 1000;

const FALLBACK_MODEL = 'claude-sonnet-5';

export type UsageTotals = {
  inputTokens: number; outputTokens: number;
  cacheCreationTokens: number; cacheReadTokens: number;
  webSearchRequests: number;
};

/** 'claude-haiku-4-5-20251001' 처럼 날짜 접미사가 붙어도 접두사로 매칭합니다. */
export function priceFor(model: string): { price: ModelPrice; known: boolean } {
  if (MODEL_PRICES[model]) return { price: MODEL_PRICES[model], known: true };
  const matched = Object.keys(MODEL_PRICES)
    .filter((id) => model.startsWith(id))
    .sort((a, b) => b.length - a.length)[0];
  if (matched) return { price: MODEL_PRICES[matched], known: true };
  return { price: MODEL_PRICES[FALLBACK_MODEL], known: false };
}

export function estimateCostUsd(model: string, usage: UsageTotals): number {
  const { price } = priceFor(model);
  return (
    (usage.inputTokens / 1_000_000) * price.input
    + (usage.outputTokens / 1_000_000) * price.output
    + (usage.cacheCreationTokens / 1_000_000) * price.cacheWrite
    + (usage.cacheReadTokens / 1_000_000) * price.cacheRead
    + usage.webSearchRequests * WEB_SEARCH_PRICE_PER_CALL
  );
}
