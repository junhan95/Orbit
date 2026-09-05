import { describe, expect, it } from 'vitest';
import { estimateCostUsd, priceFor } from '@/lib/pricing';
import { COMPACT_TRIGGER, renderChatSummary, shouldCompact } from '@/lib/compaction';
import { renderSkillIndex } from '@/lib/skills';

describe('단가 priceFor() / estimateCostUsd()', () => {
  it('날짜 접미사가 붙은 모델 id 는 접두사로 매칭', () => {
    expect(priceFor('claude-haiku-4-5-20251001')).toEqual({ price: priceFor('claude-haiku-4-5').price, known: true });
    expect(priceFor('claude-sonnet-4-5').price.input).toBe(3);
  });
  it('모르는 모델은 폴백 단가 + known=false', () => {
    expect(priceFor('gpt-99').known).toBe(false);
  });
  it('비용 = 토큰별 단가 합 + 웹 검색', () => {
    const usd = estimateCostUsd('claude-haiku-4-5', { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 2_000_000, webSearchRequests: 10 });
    expect(usd).toBeCloseTo(1 + 0.2 + 0.1, 6);
  });
});

describe('대화 압축 shouldCompact() / renderChatSummary()', () => {
  it('요약 이후 메시지가 트리거를 넘을 때만 true', () => {
    expect(shouldCompact(COMPACT_TRIGGER)).toBe(false);
    expect(shouldCompact(COMPACT_TRIGGER + 1)).toBe(true);
  });
  it('요약이 없으면 빈 문자열, 있으면 recall_history 안내 포함', () => {
    expect(renderChatSummary(null)).toBe('');
    const block = renderChatSummary({ id: 's', content: '지난 합의: EUR 기준', messageCount: 30, coversFrom: 1, coversTo: 2, updatedAt: 3 });
    expect(block).toContain('30개 메시지');
    expect(block).toContain('recall_history');
    expect(block).toContain('지난 합의: EUR 기준');
  });
});

describe('스킬 인덱스 renderSkillIndex()', () => {
  it('비어 있으면 빈 문자열', () => { expect(renderSkillIndex([])).toBe(''); });
  it('이름·설명만 넣고 본문은 넣지 않는다', () => {
    const block = renderSkillIndex([{ id: '1', scope: 'project', projectId: 'p', name: '주간 보고', description: '매주 월요일 보고서', body: '비밀 본문', createdBy: 'E-Bolt', uses: 3, createdAt: 0, updatedAt: 0 }]);
    expect(block).toContain('**주간 보고** (이 프로젝트) — 매주 월요일 보고서');
    expect(block).not.toContain('비밀 본문');
  });
});
