import { env } from 'cloudflare:workers';

/**
 * 로그인·세션 (서버 전용).
 *
 * 왜 Claude 로그인이 아닌가 — Anthropic 정책(code.claude.com/docs/en/legal-and-compliance,
 * "Authentication and credential use")은 제3자 앱이 Claude.ai 로그인을 제공하거나 사용자의
 * 구독 자격증명으로 요청을 보내는 것을 금지합니다. 그래서 신원은 Google/GitHub OAuth 로 받고,
 * Claude 는 사용자 본인의 API 키로 씁니다. 자세한 흐름은 docs/auth-flow.md.
 *
 * 모드
 *   AUTH_MODE 가 'oauth' 가 아니면 예전 그대로 로컬 단일 사용자입니다(로그인 없음).
 *   OAuth 는 라이브러리 없이 authorization-code 흐름을 그대로 구현했습니다 — Workers 에서
 *   fetch 만 있으면 되고, 의존성이 하나도 늘지 않습니다.
 *
 * 세션
 *   쿠키에는 256비트 난수 토큰만 들어가고, DB 에는 그 SHA-256 만 저장합니다.
 *   DB 가 새어도 쿠키를 만들 수 없고, 로그아웃은 행 삭제라 즉시 무효화됩니다.
 */

export type AuthMode = 'local' | 'oauth';
export type Provider = 'google' | 'github';
export const PROVIDERS: Provider[] = ['google', 'github'];
export const PROVIDER_LABEL: Record<Provider, string> = { google: 'Google', github: 'GitHub' };

export const SESSION_COOKIE = 'orbit_session';
export const STATE_COOKIE = 'orbit_oauth_state';
/** 세션 수명 30일. 쓸 때마다 늘리지는 않습니다 — 단순함이 낫습니다. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** OAuth state 쿠키 수명. 로그인 화면에서 제공자로 갔다 오는 시간이면 충분합니다. */
const STATE_TTL_S = 10 * 60;

export type SessionUser = { userId: string; displayName: string; email: string; avatarUrl: string | null };

export function authMode(): AuthMode {
  return env.AUTH_MODE === 'oauth' ? 'oauth' : 'local';
}

export function isProvider(value: unknown): value is Provider {
  return value === 'google' || value === 'github';
}

/** 클라이언트 ID·시크릿이 둘 다 있는 제공자만 로그인 화면에 보입니다. */
export function configuredProviders(): Provider[] {
  const out: Provider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) out.push('google');
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) out.push('github');
  return out;
}

// ── 난수·해시 ───────────────────────────────────────────────

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return base64url(new Uint8Array(digest));
}

async function hmac(text: string): Promise<string> {
  const secret = env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET 환경변수가 없습니다. OAuth 모드에는 32자 이상의 비밀값이 필요합니다.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))));
}

// ── OAuth state (CSRF 방지) ─────────────────────────────────

/** `provider.nonce.sig` — 서명이 있어 쿠키와 콜백 양쪽에서 위조를 잡습니다. */
export async function makeState(provider: Provider): Promise<string> {
  const nonce = randomToken(16);
  return `${provider}.${nonce}.${await hmac(`${provider}.${nonce}`)}`;
}

export async function verifyState(state: string | null, fromCookie: string | undefined, provider: Provider): Promise<boolean> {
  if (!state || !fromCookie || state !== fromCookie) return false;
  const [p, nonce, sig] = state.split('.');
  if (p !== provider || !nonce || !sig) return false;
  return sig === await hmac(`${p}.${nonce}`);
}

// ── 쿠키 ────────────────────────────────────────────────────

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`, ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function sessionCookie(token: string, secure: boolean): string {
  return cookie(SESSION_COOKIE, token, SESSION_TTL_MS / 1000, secure);
}
export function clearSessionCookie(secure: boolean): string {
  return cookie(SESSION_COOKIE, '', 0, secure);
}
export function stateCookie(state: string, secure: boolean): string {
  return cookie(STATE_COOKIE, state, STATE_TTL_S, secure);
}
export function clearStateCookie(secure: boolean): string {
  return cookie(STATE_COOKIE, '', 0, secure);
}

/** 앱의 공개 주소. APP_URL 이 있으면 그것, 없으면 요청 origin (dev 는 localhost). */
export function appOrigin(request: Request): string {
  return (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
}
export function isSecureOrigin(origin: string): boolean {
  return origin.startsWith('https://');
}

// ── 세션 (D1) ───────────────────────────────────────────────

export async function createSession(db: D1Database, userId: string, userAgent: string | null): Promise<string> {
  const token = randomToken(32);
  const now = Date.now();
  await db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now + SESSION_TTL_MS, userAgent?.slice(0, 200) ?? null).run();
  return token;
}

type SessionRow = { user_id: string; name: string | null; email: string | null; avatar_url: string | null };

/** 쿠키 토큰으로 사용자를 찾습니다. 만료·삭제된 세션은 null. */
export async function findSessionUser(db: D1Database, token: string): Promise<SessionUser | null> {
  const row = await db.prepare(
    `SELECT s.user_id, u.name, u.email, u.avatar_url FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  ).bind(await sha256(token), Date.now()).first<SessionRow>();
  if (!row) return null;
  return { userId: row.user_id, displayName: row.name || row.email || '사용자', email: row.email || '', avatarUrl: row.avatar_url };
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
}

// ── OAuth 제공자 ────────────────────────────────────────────

export type Identity = { providerId: string; email: string | null; name: string | null; avatarUrl: string | null };

export function redirectUri(origin: string, provider: Provider): string {
  return `${origin}/api/auth/callback/${provider}`;
}

export function authorizeUrl(provider: Provider, state: string, origin: string): string {
  const cb = redirectUri(origin, provider);
  if (provider === 'google') {
    const q = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: cb, response_type: 'code',
      scope: 'openid email profile', state, prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  const q = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID!, redirect_uri: cb, scope: 'read:user user:email', state });
  return `https://github.com/login/oauth/authorize?${q}`;
}

async function exchangeCode(provider: Provider, code: string, origin: string): Promise<string> {
  const cb = redirectUri(origin, provider);
  const url = provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://github.com/login/oauth/access_token';
  const body = new URLSearchParams(provider === 'google'
    ? { code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: cb, grant_type: 'authorization_code' }
    : { code, client_id: env.GITHUB_CLIENT_ID!, client_secret: env.GITHUB_CLIENT_SECRET!, redirect_uri: cb });
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
  const data = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || `${PROVIDER_LABEL[provider]} 토큰 교환에 실패했습니다.`);
  return data.access_token;
}

async function fetchIdentity(provider: Provider, token: string): Promise<Identity> {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'orbit-app' };
  if (provider === 'google') {
    const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers });
    if (!r.ok) throw new Error('Google 프로필을 읽지 못했습니다.');
    const p = await r.json() as { sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
    return { providerId: p.sub, email: p.email_verified === false ? null : p.email ?? null, name: p.name ?? null, avatarUrl: p.picture ?? null };
  }
  const r = await fetch('https://api.github.com/user', { headers });
  if (!r.ok) throw new Error('GitHub 프로필을 읽지 못했습니다.');
  const p = await r.json() as { id: number; login: string; name?: string | null; avatar_url?: string; email?: string | null };
  let email = p.email ?? null;
  if (!email) {
    // 이메일을 비공개로 둔 계정은 /user 에 email 이 없습니다 — 별도 엔드포인트에서 primary+verified 를 찾습니다.
    const er = await fetch('https://api.github.com/user/emails', { headers });
    if (er.ok) {
      const list = await er.json() as { email: string; primary: boolean; verified: boolean }[];
      email = list.find((e) => e.primary && e.verified)?.email ?? list.find((e) => e.verified)?.email ?? null;
    }
  }
  return { providerId: String(p.id), email, name: p.name || p.login, avatarUrl: p.avatar_url ?? null };
}

/** code → 토큰 → 프로필. 콜백 라우트가 부릅니다. */
export async function completeOAuth(provider: Provider, code: string, origin: string): Promise<Identity> {
  return fetchIdentity(provider, await exchangeCode(provider, code, origin));
}

// ── 사용자 upsert ───────────────────────────────────────────

type UserRow = { id: string };

/** 같은 (provider, provider_id) 면 기존 사용자, 아니면 새로 만듭니다. 첫 로그인이 곧 회원가입입니다. */
export async function upsertUser(db: D1Database, provider: Provider, identity: Identity): Promise<{ id: string; isNew: boolean }> {
  const now = Date.now();
  const existing = await db.prepare('SELECT id FROM users WHERE provider = ? AND provider_id = ?').bind(provider, identity.providerId).first<UserRow>();
  if (existing) {
    await db.prepare('UPDATE users SET email = ?, name = ?, avatar_url = ?, last_login_at = ? WHERE id = ?')
      .bind(identity.email, identity.name, identity.avatarUrl, now, existing.id).run();
    return { id: existing.id, isNew: false };
  }
  const id = `u_${randomToken(12)}`;
  await db.prepare('INSERT INTO users (id, provider, provider_id, email, name, avatar_url, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, provider, identity.providerId, identity.email, identity.name, identity.avatarUrl, now, now).run();
  return { id, isNew: true };
}
