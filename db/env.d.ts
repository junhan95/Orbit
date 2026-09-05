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
    GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
    GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string;
    /** 사용자 API 키 암호화 마스터 시크릿 (32자 이상). lib/user-keys.ts */
    KEY_ENCRYPTION_SECRET?: string;
  }
}
