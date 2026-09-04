import { env } from 'cloudflare:workers';

/** Anthropic Messages API 기본 모델. ANTHROPIC_MODEL 환경변수로 덮어쓸 수 있습니다. */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';

export function getDatabase(): D1Database {
  if (!env.DB) throw new Error('Cloudflare D1 binding `DB` is unavailable.');
  return env.DB;
}

export function getRuntimeConfig() {
  return { apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL };
}
