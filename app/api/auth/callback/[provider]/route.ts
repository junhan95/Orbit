import { getDatabase } from '@/db';
import {
  STATE_COOKIE, appOrigin, authMode, clearStateCookie, completeOAuth, createSession,
  isProvider, isSecureOrigin, parseCookies, sessionCookie, upsertUser, verifyState,
} from '@/lib/auth';
import { loadProfile, saveProfile } from '@/lib/profile';

type RouteContext = { params: Promise<{ provider: string }> | { provider: string } };

/**
 * 제공자에서 돌아오는 자리. code 를 토큰으로 바꾸고 프로필을 읽어 사용자를 만들거나 찾은 뒤
 * 세션 쿠키를 심고 앱으로 보냅니다. 첫 로그인이면 계정 프로필에 이름·이메일을 미리 채워 둡니다.
 */
export async function GET(request: Request, context: RouteContext) {
  const { provider } = await context.params;
  const origin = appOrigin(request);
  const secure = isSecureOrigin(origin);
  const fail = (code: string) => new Response(null, {
    status: 302,
    headers: { Location: `${origin}/login?error=${code}`, 'Set-Cookie': clearStateCookie(secure) },
  });

  if (authMode() !== 'oauth' || !isProvider(provider)) return fail('provider');

  const url = new URL(request.url);
  if (url.searchParams.get('error')) return fail('denied');
  const code = url.searchParams.get('code');
  const cookies = parseCookies(request.headers.get('cookie'));
  if (!code || !(await verifyState(url.searchParams.get('state'), cookies[STATE_COOKIE], provider))) return fail('state');

  try {
    const db = getDatabase();
    const identity = await completeOAuth(provider, code, origin);
    const { id, isNew } = await upsertUser(db, provider, identity);
    if (isNew) {
      // 첫 로그인 = 회원가입. 계정 화면이 비어 보이지 않게 이름·이메일만 미리 채웁니다.
      const current = await loadProfile(db, id);
      if (!current.displayName && !current.email) {
        await saveProfile(db, id, { displayName: identity.name ?? '', email: identity.email ?? '' });
      }
    }
    const token = await createSession(db, id, request.headers.get('user-agent'));
    const headers = new Headers({ Location: `${origin}/${isNew ? '?welcome=1' : ''}` });
    headers.append('Set-Cookie', sessionCookie(token, secure));
    headers.append('Set-Cookie', clearStateCookie(secure));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error('[auth] callback failed', error);
    return fail('exchange');
  }
}
