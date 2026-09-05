import { describe, expect, it } from 'vitest';
import {
  CHARGE_TIERS, DEFAULT_CREDIT_CONFIG, chargeGrant, creditRateFor, creditRateTable, creditsToMc, formatCredits,
  isTrialAllowedModel, krwToMc, mcToKrw, usageToMc, usdToMc,
} from '@/lib/credits-pricing';

const cfg = { markup: 1.8, fxRate: 1400 };

describe('크레딧 단가 (lib/credits-pricing.ts)', () => {
  it('1 크레딧 = 10원, 1,000 밀리크레딧', () => {
    expect(creditsToMc(300)).toBe(300_000);
    expect(mcToKrw(300_000)).toBe(3_000);
    expect(krwToMc(5_000)).toBe(500_000);
  });

  it('USD → 크레딧: 단가 × 1.8 × 1400 ÷ 10', () => {
    // Sonnet 5 입력 $2/1M → 504 크레딧/1M
    expect(usdToMc(2, cfg)).toBe(504_000);
    expect(DEFAULT_CREDIT_CONFIG).toEqual(cfg);
  });

  it('단가표는 MODEL_PRICES 를 따라 자동 계산 (명세 §1.1 표와 일치)', () => {
    const sonnet = creditRateFor('claude-sonnet-5', cfg);
    expect(sonnet.known).toBe(true);
    expect(sonnet.rate).toEqual({ input: 504, output: 2520, cacheWrite: 630, cacheRead: 50.4 });
    expect(creditRateFor('claude-haiku-4-5-20251001', cfg).rate.input).toBe(252);
    const table = creditRateTable(cfg);
    expect(table.models.map((m) => m.model)).toContain('claude-fable-5-1');
    expect(table.webSearchPerCall).toBeCloseTo(2.52, 6);
  });

  it('사용량 → 밀리크레딧: Sonnet 대화 한 턴(입력 3,000·출력 800) ≈ 3.5 크레딧', () => {
    const mc = usageToMc('claude-sonnet-5', { inputTokens: 3000, outputTokens: 800, cacheCreationTokens: 0, cacheReadTokens: 0, webSearchRequests: 0 }, cfg);
    expect(mc).toBe(3_528);
    expect(formatCredits(mc)).toBe('3.5');
    expect(formatCredits(300_000)).toBe('300');
  });

  it('충전 단위와 보너스(출시 시 꺼짐)', () => {
    expect(CHARGE_TIERS[0]).toEqual({ krw: 5_000, credits: 500, bonusPct: 0 });
    expect(chargeGrant(30_000)).toEqual({ creditsMc: 3_000_000, bonusMc: 0 });
    expect(chargeGrant(7_000)).toBeNull();
  });

  it('체험 크레딧으로 쓸 수 있는 모델', () => {
    expect(isTrialAllowedModel('claude-haiku-4-5')).toBe(true);
    expect(isTrialAllowedModel('claude-sonnet-5-20260101')).toBe(true);
    expect(isTrialAllowedModel('claude-sonnet-4-5')).toBe(false);
    expect(isTrialAllowedModel('claude-fable-5-1')).toBe(false);
  });
});
