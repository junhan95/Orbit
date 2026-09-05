import { env } from 'cloudflare:workers';
import { cookies, headers } from 'next/headers';
import { getDatabase } from '@/db';
import { SESSION_COOKIE, authMode, findSessionUser } from '@/lib/auth';

export type LocalUser = { userId: string; displayName: string; email: string; avatarUrl?: string | null };

/** 로그인이 필요한데 세션이 없을 때. middleware 가 먼저 막으므로 여기까지 오는 일은 드뭅니다. */
export class AuthRequiredError extends Error {
  status = 401;
  constructor() { super('로그인이 필요합니다.'); }
}

/**
 * 지금 요청의 사용자.
 *
 * - AUTH_MODE 가 'oauth' 가 아니면 예전 그대로 환경변수로 정해지는 로컬 단일 사용자입니다.
 * - OAuth 모드에서는 middleware 가 세션을 검증해 x-orbit-* 헤더로 넘겨준 값을 읽습니다(쿼리 없음).
 *   헤더가 없으면(미들웨어를 안 거친 경로) 쿠키로 직접 세션을 찾습니다.
 *
 * 모든 쿼리의 user_id 스코프는 여기서 나온 userId 하나에 걸려 있습니다.
 */
export async function getCurrentUser(): Promise<LocalUser> {
  if (authMode() === 'local') {
    return {
      userId: env.LOCAL_USER_ID || 'local-user',
      displayName: env.LOCAL_USER_NAME || '로컬 사용자',
      email: env.LOCAL_USER_EMAIL || 'local@orbit.test',
      avatarUrl: null,
    };
  }

  const h = await headers();
  const uid = h.get('x-orbit-uid');
  if (uid) {
    return {
      userId: uid,
      displayName: decodeURIComponent(h.get('x-orbit-name') ?? ''),
      email: decodeURIComponent(h.get('x-orbit-email') ?? ''),
      avatarUrl: h.get('x-orbit-avatar') ? decodeURIComponent(h.get('x-orbit-avatar') as string) : null,
    };
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = token ? await findSessionUser(getDatabase(), token) : null;
  if (!user) throw new AuthRequiredError();
  return user;
}
