import { env } from 'cloudflare:workers';

/** Anthropic Messages API 기본 모델. ANTHROPIC_MODEL 환경변수로 덮어쓸 수 있습니다. */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';

export function getDatabase(): D1Database {
  if (!env.DB) throw new Error('Cloudflare D1 binding `DB` is unavailable.');
  return env.DB;
}

/** 기억 리뷰·요약 같은 보조 호출용 저가 모델. ANTHROPIC_REVIEW_MODEL 로 바꿀 수 있습니다. */
export const DEFAULT_REVIEW_MODEL = 'claude-haiku-4-5';

export function getRuntimeConfig() {
  return {
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL,
    reviewModel: env.ANTHROPIC_REVIEW_MODEL || DEFAULT_REVIEW_MODEL,
  };
}
