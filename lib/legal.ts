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
  /** 통신판매업 신고번호 (공정위 통신판매사업자 조회 기준, 2018-05-24 신고). 비어 있으면 약관·푸터에 표시 안 함 */
  mailOrderRegistration: '2026-경기의왕-0174' as string,
  /** 사업장 소재지 — 도로명까지만 표기 */
  address: '경기도 의왕시 원골로 43',
  addressEn: '43 Wongol-ro, Uiwang-si, Gyeonggi-do, Republic of Korea',
  /** 개인정보 보호책임자 및 문의 */
  email: 'hello@orbitcrew.ai',
  /** 서비스 */
  service: 'orbitcrew',
  /** 공식 표기 (제목·OG) */
  serviceFull: 'orbitcrew.ai',
  site: 'https://orbitcrew.ai',
  app: 'https://app.orbitcrew.ai',
} as const;

/** 약관·방침 시행일 (YYYY-MM-DD) — 2026-09-05 크레딧·결제 조항 추가 (docs/pricing-credits.md §6) */
export const LEGAL_EFFECTIVE = '2026-09-05';

/** 약관에 적는 크레딧 상수. 단가 배수·체험 크레딧은 lib/credits-pricing.ts 가 원본이고 여기서는 문구용으로만 씁니다. */
export const CREDIT_TERMS = {
  krwPerCredit: 10,
  trialCredits: 300,
  /** 유효기간(년) — 상사채권 소멸시효에 맞춤 */
  validYears: 5,
  /** 단가 변경 고지 기간(일) */
  priceNoticeDays: 30,
  pg: '토스페이먼츠',
  pgEn: 'Toss Payments',
} as const;

export const LEGAL_LINKS = [
  { href: '/privacy', label: '개인정보처리방침', labelEn: 'Privacy Policy' },
  { href: '/terms', label: '서비스 이용약관', labelEn: 'Terms of Service' },
] as const;
