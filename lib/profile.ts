/**
 * 사용자 프로필.
 *
 * app/auth.ts 의 getCurrentUser() 는 환경변수로 정해지는 "계정"이고,
 * 여기 저장되는 것은 사용자가 화면에서 직접 고친 "표시 정보"입니다.
 * 둘이 겹치는 이름·이메일은 프로필 값이 있으면 그것이 이깁니다.
 *
 * 에이전트 프롬프트에도 들어가므로(renderProfileSection), 값은 짧게 유지합니다.
 */

/** 자유 입력 항목의 글자 수 상한. 프롬프트에 들어가므로 넉넉하되 짧게 잡습니다. */
export const PROFILE_LIMITS = {
  displayName: 60, email: 120, company: 80, department: 80,
  title: 60, phone: 40, bio: 200,
} as const;

/** 아바타는 data URL 문자열로 저장합니다. 256px webp 기준 40KB 안쪽이지만 여유를 둡니다. */
export const AVATAR_MAX_CHARS = 400_000;
/** 화면에서 리사이즈할 한 변 길이 (정사각형). */
export const AVATAR_SIZE = 256;

export type ProfileField = keyof typeof PROFILE_LIMITS;
export const PROFILE_FIELDS = Object.keys(PROFILE_LIMITS) as ProfileField[];

export type UserProfile = Record<ProfileField, string> & { avatar: string };

export const EMPTY_PROFILE: UserProfile = {
  displayName: '', email: '', company: '', department: '',
  title: '', phone: '', bio: '', avatar: '',
};

type ProfileRow = {
  display_name: string | null; email: string | null; company: string | null; department: string | null;
  title: string | null; phone: string | null; bio: string | null; avatar: string | null;
};

function fromRow(row: ProfileRow | null): UserProfile {
  if (!row) return { ...EMPTY_PROFILE };
  return {
    displayName: row.display_name ?? '', email: row.email ?? '', company: row.company ?? '',
    department: row.department ?? '', title: row.title ?? '', phone: row.phone ?? '',
    bio: row.bio ?? '', avatar: row.avatar ?? '',
  };
}

/** 저장된 프로필을 읽습니다. 한 번도 저장한 적이 없으면 빈 프로필입니다. */
export async function loadProfile(db: D1Database, userId: string): Promise<UserProfile> {
  const row = await db
    .prepare('SELECT display_name, email, company, department, title, phone, bio, avatar FROM user_profiles WHERE user_id = ?')
    .bind(userId).first<ProfileRow>();
  return fromRow(row ?? null);
}

/**
 * 들어온 값을 다듬습니다. 알 수 없는 키는 버리고, 문자열이 아닌 값은 무시하고,
 * 공백을 정리한 뒤 상한까지 자릅니다. 실패 대신 조용히 자르는 쪽을 택한 것은
 * 화면에서 이미 maxLength 로 막고 있기 때문입니다.
 */
export function sanitizeProfile(input: unknown): Partial<UserProfile> {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>;
  const patch: Partial<UserProfile> = {};
  for (const field of PROFILE_FIELDS) {
    const value = source[field];
    if (typeof value !== 'string') continue;
    patch[field] = value.trim().slice(0, PROFILE_LIMITS[field]);
  }
  if (typeof source.avatar === 'string') {
    const avatar = source.avatar.trim();
    // 빈 문자열은 "사진 삭제" 입니다. 값이 있으면 이미지 data URL 만 받습니다.
    if (avatar === '') patch.avatar = '';
    else if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar) && avatar.length <= AVATAR_MAX_CHARS) {
      patch.avatar = avatar;
    }
  }
  return patch;
}

/** 프로필을 저장하고 저장된 최종 상태를 돌려줍니다. 넘기지 않은 항목은 그대로 둡니다. */
export async function saveProfile(db: D1Database, userId: string, patch: Partial<UserProfile>): Promise<UserProfile> {
  const current = await loadProfile(db, userId);
  const next: UserProfile = { ...current, ...patch };
  await db.prepare(
    `INSERT INTO user_profiles (user_id, display_name, email, company, department, title, phone, bio, avatar, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       display_name = excluded.display_name, email = excluded.email, company = excluded.company,
       department = excluded.department, title = excluded.title, phone = excluded.phone,
       bio = excluded.bio, avatar = excluded.avatar, updated_at = excluded.updated_at`,
  ).bind(
    userId, next.displayName, next.email, next.company, next.department,
    next.title, next.phone, next.bio, next.avatar, Date.now(),
  ).run();
  return next;
}

/** 소속을 한 줄로. "Frankonia · 영업팀 · 부장" 처럼 있는 것만 이어 붙입니다. */
export function affiliationLine(profile: UserProfile): string {
  return [profile.company, profile.department, profile.title].filter(Boolean).join(' · ');
}

/**
 * 에이전트 프롬프트에 붙일 사용자 소개.
 * 사진은 넣지 않습니다(토큰만 먹고 쓸모가 없습니다). 적을 게 없으면 빈 문자열입니다.
 */
export function renderProfileSection(profile: UserProfile, fallbackName: string): string {
  const name = profile.displayName || fallbackName;
  const lines: string[] = [];
  if (name) lines.push(`- 이름: ${name}`);
  const affiliation = affiliationLine(profile);
  if (affiliation) lines.push(`- 소속: ${affiliation}`);
  if (profile.email) lines.push(`- 이메일: ${profile.email}`);
  if (profile.bio) lines.push(`- 소개: ${profile.bio}`);
  if (lines.length === 0) return '';
  return [
    '## 지금 지시하는 사용자',
    '이 워크스페이스의 주인입니다. 호칭과 보고 눈높이를 여기에 맞추고, 여기 없는 사실은 지어내지 마세요.',
    ...lines,
  ].join('\n');
}
