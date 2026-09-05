declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_MODEL?: string;
    ANTHROPIC_REVIEW_MODEL?: string;
    LOCAL_USER_ID?: string;
    LOCAL_USER_NAME?: string;
    LOCAL_USER_EMAIL?: string;
    /** 'oauth' 면 로그인 필수, 그 외에는 로컬 단일 사용자 (lib/auth.ts) */
    AUTH_MODE?: string;
    /** OAuth state 서명용 비밀값 (32자 이상) */
    AUTH_SECRET?: string;
    /** 공개 주소. 없으면 요청 origin 을 씁니다 (콜백 URL 계산용) */
    APP_URL?: string;
    /** 랜딩(루트 도메인) 주소. 설정되면 middleware 가 랜딩 호스트와 앱 호스트를 분리합니다. */
    LANDING_URL?: string;
    GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
    GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string;
    /** 사용자 API 키 암호화 마스터 시크릿 (32자 이상). lib/user-keys.ts */
    KEY_ENCRYPTION_SECRET?: string;
    /** 크레딧 단가 배수 (기본 1.8) — Anthropic 공개 단가 × 배수 × 환율 ÷ 10 = 크레딧. lib/credits.ts */
    CREDIT_MARKUP?: string;
    /** 원/USD 환율 (기본 1400). 월 1회 수동 갱신 */
    CREDIT_FX_RATE?: string;
    /** 가입 체험 크레딧 (기본 300) */
    CREDIT_TRIAL_CREDITS?: string;
    /** 토스페이먼츠 클라이언트 키 (결제창 SDK, 브라우저 노출 가능) */
    TOSS_CLIENT_KEY?: string;
    /** 토스페이먼츠 시크릿 키 — 승인(confirm)·취소 API 전용, 서버에서만. 배포는 wrangler secret */
    TOSS_SECRET_KEY?: string;
    /** 베타 운영: 사용자당 월 충전 한도(크레딧, 기본 5000). 토스 테스트 키(test_ck_)로 돌 때만 적용 — lib/payments.ts betaBilling */
    CREDIT_BETA_MONTHLY_CAP?: string;
  }
}
