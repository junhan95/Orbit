import { describe, expect, it } from 'vitest';
import { formatRunComment } from '@/lib/run-loop';
import { formatReviewComment } from '@/lib/reviewer';

describe('실행 댓글 formatRunComment()', () => {
  it('완료 + 근거가 있으면 검증 근거 목록', () => {
    const text = formatRunComment({ blocked: false, summary: '인보이스 초안 작성', blockedReason: null, nextActions: ['금액 확인'], createdTasks: [{ title: '송부', owner: 'E-Bolt' }], proof: ['총액 재계산 일치'] });
    expect(text.startsWith('✅ 인보이스 초안 작성')).toBe(true);
    expect(text).toContain('검증 근거:\n- 총액 재계산 일치');
    expect(text).toContain('만든 후속 카드:\n- 송부 → E-Bolt');
    expect(text).toContain('사람이 판단할 것:\n- 금액 확인');
    expect(text).not.toContain('⚠️');
  });

  it('완료인데 근거가 없으면 경고 표시', () => {
    const text = formatRunComment({ blocked: false, summary: '끝', blockedReason: null, nextActions: [], createdTasks: [] });
    expect(text).toContain('⚠️ 검증 근거 없음');
  });

  it('blocked 는 ⛔ 와 사유, 댓글 안내', () => {
    const text = formatRunComment({ blocked: true, summary: '', blockedReason: '계좌 정보 필요', nextActions: [], createdTasks: [] });
    expect(text.startsWith('⛔ 진행 불가 — 계좌 정보 필요')).toBe(true);
    expect(text).toContain('댓글로 남기고 다시 실행');
    expect(text).not.toContain('검증 근거');
  });
});

describe('검토 댓글 formatReviewComment()', () => {
  const base = { reviewer: 'E-Lint', summary: '전반적으로 양호', hiddenNits: 0 };
  it('Important 가 있으면 수정 요청 머리말 + 재실행 안내', () => {
    const text = formatReviewComment({ ...base, verdict: 'changes_requested', findings: [{ severity: 'important', pass: 'proof', message: '근거 없음', location: '결론' }, { severity: 'nit', pass: 'spec', message: '오타' }] });
    expect(text.startsWith('🔍 검토 — 수정 요청 (Important 1 · Nit 1)')).toBe(true);
    expect(text).toContain('Important:\n- [근거] 근거 없음 (결론)');
    expect(text).toContain('Nit:\n- [스펙] 오타');
    expect(text).toContain('다시 실행하면 Important 항목이 지시로 전달됩니다');
  });
  it('Nit 만 있으면 승인 가능, 숨긴 Nit 수 반영', () => {
    const text = formatReviewComment({ ...base, verdict: 'approve', hiddenNits: 2, findings: [{ severity: 'nit', pass: 'bug', message: '변수명' }] });
    expect(text.startsWith('🔍 검토 — 승인 가능 (Important 0 · Nit 3)')).toBe(true);
    expect(text).toContain('- … 외 2건');
    expect(text).not.toContain('다시 실행하면');
  });
});
