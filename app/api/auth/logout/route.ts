import { getDatabase } from '@/db';
import { SESSION_COOKIE, appOrigin, authMode, clearSessionCookie, deleteSession, isSecureOrigin, parseCookies } from '@/lib/auth';

/** 세션 행을 지우고 쿠키를 비운 뒤 랜딩으로 보냅니다. <form method="post"> 로도 바로 쓸 수 있습니다. */
export async function POST(request: Request) {
  const origin = appOrigin(request);
  if (authMode() === 'oauth') {
    const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
    if (token) await deleteSession(getDatabase(), token);
  }
  return new Response(null, {
    status: 303,
    headers: { Location: `${origin}/landing`, 'Set-Cookie': clearSessionCookie(isSecureOrigin(origin)) },
  });
}
