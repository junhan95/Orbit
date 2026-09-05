/**
 * 사용자 API 키 암호화 — 순수 함수만 (환경변수·DB 없음). lib/user-keys.ts 가 감싸서 씁니다.
 * AES-GCM 256, 마스터 키 = SHA-256(secret). iv 는 12바이트 난수. 모두 base64url.
 */

function b64(bytes: Uint8Array): string {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 16) throw new Error('암호화 시크릿은 16자 이상이어야 합니다.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(secret: string, plain: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(secret), new TextEncoder().encode(plain));
  return { ciphertext: b64(new Uint8Array(data)), iv: b64(iv) };
}

export async function decryptSecret(secret: string, ciphertext: string, iv: string): Promise<string> {
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await deriveKey(secret), unb64(ciphertext));
  return new TextDecoder().decode(data);
}

/** 모양만 봅니다. 실제 유효성은 Anthropic API 로 확인합니다. */
export function looksLikeAnthropicKey(value: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

/** 화면 표시용. 끝 4자만 남깁니다. */
export function keyHint(apiKey: string): string {
  return `sk-ant-…${apiKey.trim().slice(-4)}`;
}
