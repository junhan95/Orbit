/**
 * 업무 중요도. 마감일 대신 이 값이 우선순위를 정합니다.
 * 보드 정렬(높음 → 중간 → 낮음), 에이전트 실행 프롬프트, 매니저의 업무 위임에 함께 쓰입니다.
 */
export const PRIORITIES = ['높음', '중간', '낮음'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DEFAULT_PRIORITY: Priority = '중간';

export function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);
}

export function toPriority(value: unknown): Priority {
  return isPriority(value) ? value : DEFAULT_PRIORITY;
}

/** 정렬용 순위. 값이 작을수록 먼저 처리해야 하는 업무입니다. */
export function priorityRank(value: string | null | undefined): number {
  const index = (PRIORITIES as readonly string[]).indexOf(value ?? DEFAULT_PRIORITY);
  return index < 0 ? 1 : index;
}

/** 목록·보드를 중요도 순으로 정렬합니다. 같은 중요도면 원래 순서를 지킵니다. */
export function byPriority<T extends { priority?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
}

/** SQL 정렬 조각. 높음 → 중간 → 낮음 순으로 나옵니다. */
export const PRIORITY_ORDER_SQL = "CASE priority WHEN '높음' THEN 0 WHEN '중간' THEN 1 ELSE 2 END";

/** 에이전트에게 중요도의 뜻을 알려 줄 때 쓰는 한 줄 설명. */
export const PRIORITY_HINT: Record<Priority, string> = {
  높음: '가장 먼저 처리해야 하는 업무입니다. 다른 일보다 우선하고, 필요한 만큼 깊이 파고드세요.',
  중간: '평소 기준으로 처리하면 되는 업무입니다.',
  낮음: '급하지 않은 업무입니다. 핵심만 간결하게 처리하고 시간을 과하게 쓰지 마세요.',
};
