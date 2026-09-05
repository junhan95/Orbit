import { env } from 'cloudflare:workers';
import { authMode } from '@/lib/auth';
import { decryptSecret, encryptSecret, keyHint, looksLikeAnthropicKey } from '@/lib/user-keys-crypto';

export { keyHint, looksLikeAnthropicKey };

/**
 * 사용자별 Anthropic API 키 (BYOK).
 *
 * Anthropic 정책상 제3자 앱은 사용자의 Claude 구독으로 요청을 보낼 수 없고, 각 사용자가 자기
 * API 키를 쓰며 비용도 본인에게 청구돼야 합니다 (docs/auth-flow.md §1, §6). 그래서:
 *   - OAuth 모드: 실행·대화는 반드시 그 사용자의 키로만 나갑니다. 운영자 키로 대신 보내지 않습니다.
 *   - 로컬 모드: 예전처럼 .env 의 ANTHROPIC_API_KEY 를 쓰고, 그것이 없으면 저장된 키를 씁니다.
 *
 * 저장은 AES-GCM. 마스터 키는 KEY_ENCRYPTION_SECRET(Workers Secret)에서 SHA-256 으로 뽑습니다.
 * DB 가 새어도 시크릿 없이는 복호화할 수 없고, 화면에는 끝 4자만 보여줍니다.
 */

export type UserKeyInfo = { configured: boolean; hint: string | null; updatedAt: number | null };

/** 키가 없어 Claude 를 호출할 수 없을 때. 라우트는 이걸 409 { code: 'no_api_key' } 로 바꿉니다. */
export class ApiKeyMissingError extends Error {
  code = 'no_api_key' as const;
  constructor() { super('Anthropic API 키가 연결되지 않았습니다. 계정 화면에서 본인 키를 연결해 주세요.'); }
}

export function apiKeyMissingResponse(extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: new ApiKeyMissingError().message, code: 'no_api_key', ...extra }, { status: 409 });
}

// ── 암호화 (순수 함수는 lib/user-keys-crypto.ts) ─────────────

function masterSecret(): string {
  const secret = env.KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('KEY_ENCRYPTION_SECRET 환경변수가 없습니다. 사용자 API 키를 저장하려면 32자 이상의 비밀값이 필요합니다.');
  }
  return secret;
}

// ── 검증 ────────────────────────────────────────────────────

/** 가장 싼 인증 호출로 키가 살아 있는지 봅니다 (모델 목록 조회, 토큰 소모 없음). */
export async function verifyAnthropicKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
    if (response.ok) return { ok: true };
    if (response.status === 401) return { ok: false, error: '키가 유효하지 않습니다. Console 에서 다시 확인해 주세요.' };
    if (response.status === 403) return { ok: false, error: '이 키에는 권한이 없습니다. Console 에서 키 권한을 확인해 주세요.' };
    return { ok: false, error: `Anthropic 이 ${response.status} 로 응답했습니다. 잠시 후 다시 시도해 주세요.` };
  } catch {
    return { ok: false, error: 'Anthropic API 에 연결하지 못했습니다. 네트워크를 확인해 주세요.' };
  }
}

// ── 저장·조회 ───────────────────────────────────────────────

type KeyRow = { ciphertext: string; iv: string; key_hint: string; updated_at: number };

export async function saveUserKey(db: D1Database, userId: string, apiKey: string): Promise<UserKeyInfo> {
  const trimmed = apiKey.trim();
  const { ciphertext, iv } = await encryptSecret(masterSecret(), trimmed);
  const now = Date.now();
  const hint = keyHint(trimmed);
  await db.prepare(
    `INSERT INTO user_keys (user_id, ciphertext, iv, key_hint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, key_hint = excluded.key_hint, updated_at = excluded.updated_at`,
  ).bind(userId, ciphertext, iv, hint, now, now).run();
  return { configured: true, hint, updatedAt: now };
}

export async function userKeyInfo(db: D1Database, userId: string): Promise<UserKeyInfo> {
  const row = await db.prepare('SELECT key_hint, updated_at FROM user_keys WHERE user_id = ?').bind(userId).first<Pick<KeyRow, 'key_hint' | 'updated_at'>>();
  return row ? { configured: true, hint: row.key_hint, updatedAt: row.updated_at } : { configured: false, hint: null, updatedAt: null };
}

export async function loadUserKey(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare('SELECT ciphertext, iv FROM user_keys WHERE user_id = ?').bind(userId).first<Pick<KeyRow, 'ciphertext' | 'iv'>>();
  if (!row) return null;
  return decryptSecret(masterSecret(), row.ciphertext, row.iv);
}

export async function deleteUserKey(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM user_keys WHERE user_id = ?').bind(userId).run();
}

/**
 * 이번 요청에서 Claude 를 부를 키.
 * OAuth 모드에서는 사용자 키만, 로컬 모드에서는 .env 키 → 저장된 키 순서입니다. 없으면 ApiKeyMissingError.
 */
export async function resolveApiKey(db: D1Database, userId: string): Promise<string> {
  if (authMode() === 'local' && env.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY;
  const stored = await loadUserKey(db, userId);
  if (stored) return stored;
  throw new ApiKeyMissingError();
}
