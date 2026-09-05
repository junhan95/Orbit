import { describe, expect, it } from 'vitest';
import { MIN_BASELINE_DAYS, MIN_CURRENT_SAMPLES, band } from '@/lib/health';

const metric = { key: 'run_failure_rate', label: '실행 실패·막힘 비율', unit: 'ratio', minDelta: 0.25 } as const;
const today = '2026-09-05';

function points(baseline: number[], current?: { value: number; samples: number }) {
  const map = new Map<string, { value: number; samples: number }>();
  baseline.forEach((value, index) => map.set(`2026-08-${String(10 + index).padStart(2, '0')}`, { value, samples: 5 }));
  if (current) map.set(today, current);
  return map;
}

describe('관제 밴드 band()', () => {
  it('기준선이 부족하면 insufficient', () => {
    const report = band(metric, points([0.1, 0.2], { value: 0.9, samples: 5 }), today);
    expect(report.tier).toBe('insufficient');
    expect(report.baselineDays).toBeLessThan(MIN_BASELINE_DAYS);
  });

  it('오늘 표본이 부족하면 ok 로 두고 기록만', () => {
    const report = band(metric, points([0.1, 0.2, 0.15, 0.1], { value: 1, samples: MIN_CURRENT_SAMPLES - 1 }), today);
    expect(report.tier).toBe('ok');
    expect(report.note).toContain('표본 부족');
  });

  it('σ 에 따라 ok → watch → diagnose → act', () => {
    // 기준선 평균 0.2, 모표준편차 0.1
    const baseline = [0.1, 0.3, 0.1, 0.3];
    const tierAt = (value: number) => band(metric, points(baseline, { value, samples: 5 }), today).tier;
    expect(tierAt(0.25)).toBe('ok');        // +0.5σ
    expect(tierAt(0.35)).toBe('watch');     // +1.5σ
    expect(tierAt(0.45)).toBe('diagnose');  // +2.5σ
    expect(tierAt(0.60)).toBe('act');       // +4σ
  });

  it('기준선이 전부 같은 값(σ=0)이면 절대 변화량으로 판정', () => {
    const flat = [0, 0, 0, 0];
    expect(band(metric, points(flat, { value: 0.1, samples: 5 }), today).tier).toBe('ok');
    expect(band(metric, points(flat, { value: 0.5, samples: 5 }), today).tier).toBe('act');
  });

  it('지표가 낮아지는 쪽은 경보를 내지 않는다', () => {
    const report = band(metric, points([0.5, 0.7, 0.5, 0.7], { value: 0, samples: 5 }), today);
    expect(report.tier).toBe('ok');
    expect(report.sigma).toBeLessThan(0);
  });
});
