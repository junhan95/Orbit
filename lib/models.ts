/**
 * 에이전트가 고를 수 있는 Claude 모델 목록.
 *
 * 여기 있는 id 는 모두 lib/pricing.ts 의 MODEL_PRICES 에 단가가 있어야 사용량 화면의
 * 비용 추정이 맞습니다. 모델을 추가하려면 두 파일을 함께 고치세요.
 *
 * 에이전트의 model 이 비어 있으면(NULL) .env 의 ANTHROPIC_MODEL 을 그대로 씁니다.
 */
import { MODEL_PRICES } from './pricing';

export type AgentModelOption = { id: string; label: string; hint: string };

/** 서버가 기본 모델을 알려주기 전(첫 로딩)에 화면이 쓸 값. db/index.ts 의 DEFAULT_CLAUDE_MODEL 과 맞춰 둡니다. */
export const DEFAULT_MODEL_FALLBACK = 'claude-sonnet-5';

export const AGENT_MODELS: AgentModelOption[] = [
  { id: 'claude-opus-5', label: 'Opus 5', hint: '가장 깊은 추론 · 느리고 비쌉니다' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', hint: '성능과 비용의 균형 · 기본 권장' },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', hint: '이전 세대 균형형' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: '가장 빠르고 저렴 · 단순 업무용' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', hint: '창작·서술 특화' },
];

/** 단가표에 없는 모델을 실수로 올려두면 비용 추정이 틀어지므로 개발 중에 알립니다. */
export const UNPRICED_AGENT_MODELS = AGENT_MODELS.filter((option) => !MODEL_PRICES[option.id]).map((option) => option.id);

export function isAgentModel(value: unknown): value is string {
  return typeof value === 'string' && AGENT_MODELS.some((option) => option.id === value);
}

/** 화면 표시용 짧은 이름. 목록에 없는 값이면 id 를 그대로 돌려줍니다. */
export function agentModelLabel(model: string | null | undefined): string | null {
  if (!model) return null;
  return AGENT_MODELS.find((option) => option.id === model)?.label ?? model;
}

/** 에이전트에 지정된 모델이 있으면 그것을, 없거나 목록에 없는 값이면 환경변수 기본값을 씁니다. */
export function resolveAgentModel(agentModel: string | null | undefined, fallback: string): string {
  return isAgentModel(agentModel) ? agentModel : fallback;
}
