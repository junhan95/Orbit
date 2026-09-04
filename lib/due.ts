/**
 * 마감일 유틸. due 는 epoch milliseconds(정수) 또는 null(일정 미정)입니다.
 * 표시 문자열은 실행 환경의 로컬 타임존 기준으로 계산합니다.
 */
const DAY = 86_400_000;

export const TASK_STATUSES = ['대기', '진행 중', '검토'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

function startOfDay(value: number): number {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatDue(due: number | null | undefined): string {
  if (!due) return '일정 미정';
  const diffDays = Math.round((startOfDay(due) - startOfDay(Date.now())) / DAY);
  if (diffDays === 0) return '오늘';
  if (diffDays === 1) return '내일';
  if (diffDays === -1) return '어제';
  if (diffDays < -1) return `${Math.abs(diffDays)}일 지남`;
  if (diffDays <= 7) return `${diffDays}일 뒤`;
  const target = new Date(due);
  return `${target.getMonth() + 1}월 ${target.getDate()}일`;
}

export function isOverdue(due: number | null | undefined, status: string): boolean {
  return Boolean(due) && (due as number) < startOfDay(Date.now()) && status !== '검토';
}

/** 'YYYY-MM-DD' 형태의 date input 값을 타임스탬프로 변환합니다. */
export function toDueTimestamp(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

/** 타임스탬프를 date input 이 요구하는 'YYYY-MM-DD' 로 변환합니다. */
export function toDueInputValue(due: number | null | undefined): string {
  if (!due) return '';
  const target = new Date(due);
  const month = `${target.getMonth() + 1}`.padStart(2, '0');
  const day = `${target.getDate()}`.padStart(2, '0');
  return `${target.getFullYear()}-${month}-${day}`;
}
