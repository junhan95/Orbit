/** 업무 상태. 보드의 열 순서이기도 합니다. */
export const TASK_STATUSES = ['대기', '진행 중', '검토'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}
