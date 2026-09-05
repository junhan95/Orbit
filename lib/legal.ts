/**
 * 법적 고지에 쓰는 사업자 정보와 시행일.
 * 랜딩 푸터, /privacy, /terms 가 함께 읽습니다. 값을 바꾸면 세 곳이 같이 바뀝니다.
 */
export const COMPANY = {
  /** 상호 */
  name: '와이즈쿼리',
  nameEn: 'WISEQUERY',
  /** 대표자 */
  ceo: '박준한',
  ceoEn: 'Junhan Park',
  /** 사업자등록번호 */
  registration: '299-21-00736',
  /** 사업장 소재지 — 도로명까지만 표기 */
  address: '경기도 의왕시 원골로 43',
  addressEn: '43 Wongol-ro, Uiwang-si, Gyeonggi-do, Republic of Korea',
  /** 개인정보 보호책임자 및 문의 */
  email: 'hello@orbitcrew.ai',
  /** 서비스 */
  service: 'Orbit',
  site: 'https://orbitcrew.ai',
  app: 'https://app.orbitcrew.ai',
} as const;

/** 약관·방침 시행일 (YYYY-MM-DD) */
export const LEGAL_EFFECTIVE = '2026-09-05';

export const LEGAL_LINKS = [
  { href: '/privacy', label: '개인정보처리방침', labelEn: 'Privacy Policy' },
  { href: '/terms', label: '서비스 이용약관', labelEn: 'Terms of Service' },
] as const;
