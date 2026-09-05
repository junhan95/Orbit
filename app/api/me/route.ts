import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { authMode } from '@/lib/auth';
import { loadProfile, sanitizeProfile, saveProfile } from '@/lib/profile';

/**
 * 계정 + 프로필.
 *
 * displayName·email 은 화면 여기저기(인사말, 사이드바 이니셜)에서 쓰던 값이라
 * 키를 그대로 두고, 프로필에 값이 있으면 그것을 우선합니다.
 */
export async function GET() {
  const user = await getCurrentUser();
  const profile = await loadProfile(getDatabase(), user.userId);
  return Response.json({
    displayName: profile.displayName || user.displayName,
    email: profile.email || user.email,
    account: { displayName: user.displayName, email: user.email, avatarUrl: user.avatarUrl ?? null },
    authMode: authMode(),
    profile,
  });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: '요청 본문을 읽지 못했습니다.' }, { status: 400 }); }

  const patch = sanitizeProfile(body);
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: '저장할 항목이 없습니다.' }, { status: 400 });
  }

  const profile = await saveProfile(getDatabase(), user.userId, patch);
  return Response.json({
    displayName: profile.displayName || user.displayName,
    email: profile.email || user.email,
    account: { displayName: user.displayName, email: user.email, avatarUrl: user.avatarUrl ?? null },
    authMode: authMode(),
    profile,
  });
}
