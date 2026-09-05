import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { authMode } from '@/lib/auth';
import { deleteUserKey, looksLikeAnthropicKey, saveUserKey, userKeyInfo, verifyAnthropicKey } from '@/lib/user-keys';

/**
 * 사용자 Anthropic API 키 (BYOK).
 * GET    → { mode, configured, hint, updatedAt, required }   키 자체는 절대 돌려주지 않습니다.
 *          required 는 "키 없이는 아무것도 못 돌리는" 배포에서만 true — 운영자 키(ANTHROPIC_API_KEY)가 있으면 크레딧 경로가 있으므로 false.
 * PUT    { apiKey } → Anthropic 에 한 번 확인한 뒤 암호화 저장
 * DELETE → 삭제
 */
/** 크레딧 경로(운영자 키)가 없는 OAuth 배포에서만 사용자 키가 필수입니다. */
function keyRequired(): boolean {
  return authMode() === 'oauth' && !env.ANTHROPIC_API_KEY;
}

export async function GET() {
  const user = await getCurrentUser();
  const info = await userKeyInfo(getDatabase(), user.userId);
  const mode = authMode();
  return Response.json({ mode, ...info, required: keyRequired() });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const body = await request.json().catch(() => null) as { apiKey?: unknown } | null;
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!looksLikeAnthropicKey(apiKey)) {
    return Response.json({ error: 'Anthropic API 키 형식이 아닙니다. sk-ant- 로 시작하는 키를 그대로 붙여 넣어 주세요.' }, { status: 400 });
  }
  const check = await verifyAnthropicKey(apiKey);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });
  try {
    const info = await saveUserKey(getDatabase(), user.userId, apiKey);
    return Response.json({ mode: authMode(), ...info, required: keyRequired() });
  } catch (error) {
    // KEY_ENCRYPTION_SECRET 이 없을 때 — 운영자가 고쳐야 하는 문제라 그대로 알립니다.
    return Response.json({ error: error instanceof Error ? error.message : '키를 저장하지 못했습니다.' }, { status: 503 });
  }
}

export async function DELETE() {
  const user = await getCurrentUser();
  await deleteUserKey(getDatabase(), user.userId);
  return Response.json({ mode: authMode(), configured: false, hint: null, updatedAt: null, required: keyRequired() });
}
