/**
 * 대화에서 에이전트에게 허용할 자율도.
 *
 * 사용자가 대화창 아래에서 고르고, /api/chat/stream 이 그대로 받아
 * 매니저에게 붙일 도구를 정합니다. 값은 이 기기(localStorage)에만 저장됩니다.
 *   auto  — 채용 · 위임 · 카드 생성 모두 허용 (기본)
 *   tasks — 카드 생성만 허용. 채용 · 위임 금지 (매니저가 직접 답합니다)
 *   read  — 아무것도 바꾸지 않고 대화만
 */
export const AUTONOMY_LEVELS = ['auto', 'tasks', 'read'] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

export const DEFAULT_AUTONOMY: Autonomy = 'auto';

export function isAutonomy(value: unknown): value is Autonomy {
  return value === 'auto' || value === 'tasks' || value === 'read';
}

export function toAutonomy(value: unknown): Autonomy {
  return isAutonomy(value) ? value : DEFAULT_AUTONOMY;
}

/** 선택기에 보일 이름. t() 로 번역합니다. */
export const AUTONOMY_LABEL: Record<Autonomy, string> = {
  auto: '자동',
  tasks: '카드만',
  read: '읽기 전용',
};

/** 고를 때 보이는 한 줄 설명. */
export const AUTONOMY_HINT: Record<Autonomy, string> = {
  auto: '매니저가 팀원을 합류시키고 업무를 맡겨 결과까지 가져옵니다.',
  tasks: '업무 카드만 만들 수 있습니다. 합류·위임은 하지 않고 직접 답합니다.',
  read: '보드를 바꾸지 않고 대화만 합니다.',
};
