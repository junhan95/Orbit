import { describe, expect, it } from 'vitest';
import { buildFtsQuery, koreanBigrams } from '@/lib/recall';

describe('한글 바이그램 koreanBigrams()', () => {
  it('연속 한글을 겹치는 2글자로 푼다', () => {
    expect(koreanBigrams('캘린더')).toBe('캘린 린더');
    expect(koreanBigrams('캘린더 API 연동')).toBe('캘린 린더 연동');
  });
  it('1글자 한글이나 영문만 있으면 빈 문자열', () => {
    expect(koreanBigrams('a b c')).toBe('');
    expect(koreanBigrams('가')).toBe('');
  });
});

describe('FTS 쿼리 buildFtsQuery()', () => {
  it('한글은 바이그램 구절, 영문은 일반 항으로 나눈다', () => {
    expect(buildFtsQuery('캘린더 API')).toBe('content_bigram : ("캘린 린더") AND content : (API)');
  });
  it('or 모드는 OR 로 잇는다', () => {
    expect(buildFtsQuery('인보이스 견적', 'or')).toBe('content_bigram : ("인보 보이 이스" OR "견적")');
  });
  it('특수문자·예약어만 있으면 null', () => {
    expect(buildFtsQuery('"*(" AND OR')).toBeNull();
    expect(buildFtsQuery('   ')).toBeNull();
  });
  it('점·슬래시가 든 토큰은 구절로 감싼다', () => {
    expect(buildFtsQuery('run-task.ts')).toBe('content : ("run-task.ts")');
  });
});
