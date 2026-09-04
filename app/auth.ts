import { env } from 'cloudflare:workers';

export type LocalUser = { userId: string; displayName: string; email: string };

/**
 * 로컬 전용 단일 사용자 모드입니다.
 * 외부 인증 공급자에 의존하지 않고 고정된 userId 로 동작하며,
 * 모든 쿼리의 user_id 스코프는 그대로 유지되므로 나중에 실제 인증을
 * 붙일 때 이 함수만 교체하면 됩니다.
 */
export function getCurrentUser(): LocalUser {
  return {
    userId: env.LOCAL_USER_ID || 'local-user',
    displayName: env.LOCAL_USER_NAME || '로컬 사용자',
    email: env.LOCAL_USER_EMAIL || 'local@orbit.test',
  };
}
