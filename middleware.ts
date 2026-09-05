import { type NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/db';
import { SESSION_COOKIE, authMode, findSessionUser } from '@/lib/auth';

/**
 * 로그인 게이트.
 *
 * - 로컬 모드: 아무것도 하지 않습니다 (예전과 동일).
 * - OAuth 모드:
 *     /landing, /login, /api/auth/*  → 공개
 *     /login 에 이미 로그인한 채로 오면 → /
 *     그 외 페이지에 세션 없음 → /login,  API 에 세션 없음 → 401
 *     세션이 있으면 x-orbit-* 헤더로 사용자를 실어 보냅니다 (app/auth.ts 가 읽음).
 *
 * 들어온 요청의 x-orbit-* 는 먼저 지웁니다 — 바깥에서 꽂아 넣은 값을 믿지 않기 위해서입니다.
 */
const FORWARDED = ['x-orbit-uid', 'x-orbit-name', 'x-orbit-email', 'x-orbit-avatar'];

export async function middleware(request: NextRequest) {
  if (authMode() === 'local') return NextResponse.next();

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const isPublic = pathname === '/landing' || pathname === '/login' || pathname.startsWith('/api/auth/');

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await findSessionUser(getDatabase(), token) : null;

  if (pathname === '/login' && user) return NextResponse.redirect(new URL('/', request.url));
  if (isPublic) return NextResponse.next();

  if (!user) {
    if (isApi) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    const login = new URL('/login', request.url);
    if (pathname !== '/') login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }

  const forwarded = new Headers(request.headers);
  for (const name of FORWARDED) forwarded.delete(name);
  forwarded.set('x-orbit-uid', user.userId);
  forwarded.set('x-orbit-name', encodeURIComponent(user.displayName));
  forwarded.set('x-orbit-email', encodeURIComponent(user.email));
  if (user.avatarUrl) forwarded.set('x-orbit-avatar', encodeURIComponent(user.avatarUrl));
  return NextResponse.next({ request: { headers: forwarded } });
}

/** 정적 자산·Vite 내부 경로는 건드리지 않도록 앱 경로만 명시합니다. */
export const config = {
  matcher: ['/', '/login', '/landing', '/api/:path*'],
};
