declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_MODEL?: string;
    ANTHROPIC_REVIEW_MODEL?: string;
    LOCAL_USER_ID?: string;
    LOCAL_USER_NAME?: string;
    LOCAL_USER_EMAIL?: string;
  }
}
