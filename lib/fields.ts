/**
 * 프로젝트 커스텀 필드 (Asana 의 '사용자 지정 필드') 공용 정의.
 * 값은 DB 에 항상 문자열로 저장하고, 여기 type 에 맞춰 해석/표시합니다.
 */

export const FIELD_TYPES = ['text', 'number', 'date', 'select', 'checkbox'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: '텍스트',
  number: '숫자',
  date: '날짜',
  select: '선택',
  checkbox: '체크박스',
};

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === 'string' && (FIELD_TYPES as readonly string[]).includes(value);
}

export type ProjectField = {
  id: string;
  projectId: string;
  name: string;
  type: FieldType;
  options: string[];
  showOnCard: number;
  position: number;
  createdBy: string;
};

/** DB 행(options 가 JSON 문자열)을 클라이언트가 쓰는 형태로 바꿉니다. */
export function parseFieldRow(row: {
  id: string; projectId: string; name: string; type: string; options: string;
  showOnCard: number; position: number; createdBy: string;
}): ProjectField {
  let options: string[] = [];
  try {
    const parsed = JSON.parse(row.options) as unknown;
    if (Array.isArray(parsed)) options = parsed.filter((item): item is string => typeof item === 'string');
  } catch { options = []; }
  return {
    id: row.id, projectId: row.projectId, name: row.name,
    type: isFieldType(row.type) ? row.type : 'text',
    options, showOnCard: row.showOnCard ? 1 : 0, position: row.position, createdBy: row.createdBy,
  };
}

/**
 * 저장 전 값 정규화. 타입에 맞지 않으면 null 을 돌려주고 호출부에서 400 을 냅니다.
 * 빈 문자열은 '값 없음'으로 언제나 허용합니다.
 */
export function normalizeFieldValue(field: ProjectField, raw: unknown): string | null {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'boolean') return field.type === 'checkbox' ? (raw ? '1' : '') : null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return field.type === 'number' || field.type === 'date' ? String(raw) : String(raw).slice(0, 200);
  }
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return '';

  switch (field.type) {
    case 'number':
      return Number.isFinite(Number(value)) ? String(Number(value)) : null;
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    case 'checkbox':
      return ['1', 'true', 'yes', 'y', '예', '체크'].includes(value.toLowerCase()) ? '1' : '';
    case 'select':
      // 옵션에 없는 값이면 옵션을 늘리지 않고 거절합니다 (옵션 추가는 필드 수정으로).
      return field.options.includes(value) ? value : null;
    default:
      return value.slice(0, 500);
  }
}

/** 화면 표시용 문자열. */
export function displayFieldValue(field: ProjectField, value: string | undefined): string {
  if (!value) return '—';
  if (field.type === 'checkbox') return value ? '예' : '아니오';
  return value;
}
