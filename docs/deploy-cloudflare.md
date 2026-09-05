# Cloudflare Workers 배포

작성일 2026-09-05 · 대상: `feat/claude-migration` → `main`

앱은 vinext 로 빌드된 Worker + 정적 자산 + D1 입니다. GitHub Pages 의 랜딩과는 별개로, 이 문서는 **앱 본체**를 Cloudflare 계정에 올리는 절차입니다.

## 0. 큰 그림

```
npm run build ─▶ dist/server/wrangler.json (Sites 용, D1 id 자리표시자)
                        │
scripts/deploy.mjs config ─▶ dist/server/wrangler.deploy.json  ← wrangler.deploy.json(이름·D1·vars) 덧씌움
                        │
scripts/migrate.mjs --remote ─▶ 원격 D1 에 저널 순서로 마이그레이션
                        │
wrangler deploy ─▶ https://orbit.<서브도메인>.workers.dev
                        │
wrangler secret put ×4 ─▶ AUTH_SECRET, GOOGLE_CLIENT_SECRET, KEY_ENCRYPTION_SECRET (+ 필요 시 ANTHROPIC_API_KEY)
```

`wrangler.deploy.json` 은 저장소에 커밋합니다(비밀값 없음). 시크릿은 절대 파일에 넣지 않습니다.

## 1. 단계별 절차 (각 단계 끝에 확인)

### 1단계 — Cloudflare 계정·wrangler 로그인
```
npx wrangler login        # 브라우저가 열림 → Allow
npx wrangler whoami       # 계정 이름·ID 가 보이면 OK
```
확인: `whoami` 에 계정이 나오고, 대시보드 Workers & Pages 에 접근됩니다. 무료 플랜이면 됩니다(아래 §3 제한 참고).

### 2단계 — 원격 D1 만들기
```
npx wrangler d1 create orbit
```
출력의 `database_id` 를 복사해 `wrangler.deploy.json` (`wrangler.deploy.example.json` 복사)의 `d1.database_id` 에 넣습니다.
확인: `npx wrangler d1 list` 에 `orbit` 이 보입니다.

### 3단계 — 빌드 + 배포용 설정
```
npm run build
node scripts/deploy.mjs config
```
확인: `dist/server/wrangler.deploy.json` 이 생기고 `name: "orbit"`, 실제 `database_id`, `vars` 가 들어 있습니다.

### 4단계 — 원격 D1 마이그레이션
```
node scripts/deploy.mjs migrate
```
확인: `적용됨 N개, 미적용 0개` 로 끝납니다. (내부적으로 `wrangler d1 execute DB --remote` 를 저널 순서대로 돌립니다.)

원격 상태 확인은 `node scripts/migrate.mjs --status --remote --config=dist/server/wrangler.deploy.json` 으로 합니다(`--check`는 로컬 임시 DB 전용이라 `--remote`와 같이 쓰지 않습니다).

### 5단계 — 첫 배포
```
node scripts/deploy.mjs deploy
```
확인: 출력 마지막의 `https://orbit.<서브도메인>.workers.dev` 를 열면 `/landing` 이 뜹니다. `/` 는 아직 시크릿이 없어 로그인이 실패하는 게 정상입니다.

### 6단계 — 시크릿
```
npx wrangler secret put AUTH_SECRET            --config dist/server/wrangler.deploy.json
npx wrangler secret put GOOGLE_CLIENT_SECRET   --config dist/server/wrangler.deploy.json
npx wrangler secret put KEY_ENCRYPTION_SECRET  --config dist/server/wrangler.deploy.json
```
각각 프롬프트에 값을 붙여 넣습니다. `KEY_ENCRYPTION_SECRET` 은 **로컬 `.env` 와 다른 값을 새로 만들어도 됩니다** — 원격 D1 은 비어 있어 저장된 키가 없습니다. 이후에는 바꾸지 마세요(사용자 키가 전부 복호화 불가).
`ANTHROPIC_API_KEY` 는 OAuth 모드에서 쓰지 않으므로(BYOK) 넣지 않아도 됩니다.
확인: `npx wrangler secret list --config dist/server/wrangler.deploy.json` 에 3개가 보입니다. 시크릿을 넣으면 새 버전이 자동 배포됩니다.

### 7단계 — 구글 리디렉션 URI 추가
구글 콘솔 → 사용자 인증 정보 → `Orbit local` 클라이언트(또는 새 클라이언트 `Orbit prod`):
- 승인된 자바스크립트 원본: `https://orbit.<서브도메인>.workers.dev`
- 승인된 리디렉션 URI: `https://orbit.<서브도메인>.workers.dev/api/auth/callback/google`
확인: 배포 주소의 `/login` → Google → 앱 대시보드까지 갑니다. 첫 로그인이면 API 키 연결 모달이 뜹니다.

### 8단계 — 랜딩 연결
```
gh variable set LANDING_APP_URL --body https://orbit.<서브도메인>.workers.dev --repo junhan95/Orbit
gh workflow run pages.yml --repo junhan95/Orbit
```
확인: https://junhan95.github.io/Orbit/ 의 버튼이 배포 주소로 갑니다.

### 이후 배포
코드가 바뀌면 `node scripts/deploy.mjs all` 하나로 빌드 → 설정 → 마이그레이션 → 배포가 돕니다.

## 2. 환경값 정리

| 이름 | 어디에 | 값 |
|---|---|---|
| `AUTH_MODE` | vars (`wrangler.deploy.json`) | `oauth` |
| `APP_URL` | vars | 배포 주소 (https, 끝 슬래시 없이) |
| `GOOGLE_CLIENT_ID` | vars | 구글 클라이언트 ID (비밀 아님) |
| `AUTH_SECRET` | secret | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_SECRET` | secret | 구글 보안 비밀번호 |
| `KEY_ENCRYPTION_SECRET` | secret | `openssl rand -base64 32` — 이후 불변 |
| `ANTHROPIC_API_KEY` | secret (선택) | 로컬 모드로 배포할 때만 |

## 3. 알아둘 것

- **Workers 무료 플랜은 요청당 CPU 10ms** 입니다. Claude 호출은 대부분 대기(I/O)라 CPU 를 거의 안 쓰지만, 긴 에이전트 실행에서 `CPU time limit exceeded` 가 나오면 Workers Paid($5/월, CPU 30초)로 올려야 합니다. D1 무료 한도(하루 5M 읽기)는 개인 사용에 충분합니다.
- `no_bundle: true` + `main: index.js` — vinext 가 이미 번들했으므로 wrangler 는 그대로 올립니다. 정적 자산은 `assets.directory: ../client` (dist/client).
- 로컬 `.env` 는 배포에 올라가지 않습니다. vars 는 `wrangler.deploy.json`, 시크릿은 `wrangler secret`.
- 원격 D1 은 `scripts/migrate.mjs` 가 `__drizzle_migrations` 로 적용 기록을 남기므로 재실행해도 안전합니다.
- 롤백: `npx wrangler rollback --config dist/server/wrangler.deploy.json`.

## 커스텀 도메인 (orbitcrew.ai)

운영 주소는 루트 = 랜딩, `app.` = 앱으로 나눕니다. 둘 다 같은 Worker 하나가 처리하고, `proxy.ts` 가 호스트를 보고 갈라 줍니다.

| 호스트 | 역할 |
|---|---|
| `https://orbitcrew.ai` | 랜딩 (`/` 를 `/landing` 으로 내부 rewrite, `/login`·`/api/*` 는 app. 으로 리디렉션) |
| `https://www.orbitcrew.ai` | 루트로 308 리디렉션 |
| `https://app.orbitcrew.ai` | 앱 (`/landing` 은 루트로 리디렉션 — 로그아웃 후 이동 포함) |

`wrangler.deploy.json`:
```json
"vars": { "APP_URL": "https://app.orbitcrew.ai", "LANDING_URL": "https://orbitcrew.ai" },
"routes": [
  { "pattern": "orbitcrew.ai", "custom_domain": true },
  { "pattern": "www.orbitcrew.ai", "custom_domain": true },
  { "pattern": "app.orbitcrew.ai", "custom_domain": true }
]
```
`deploy` 하면 Cloudflare 가 DNS 레코드(Worker 타입)와 인증서를 자동으로 만듭니다. 도메인을 같은 계정의 Registrar 에서 샀다면 네임서버 설정은 필요 없고, 새 도메인은 위임 반영까지 몇 분~1시간 걸릴 수 있습니다.
`LANDING_URL` 이 없으면(로컬·workers.dev) 예전처럼 한 호스트에서 `/landing` 과 앱을 같이 냅니다.

도메인을 바꾸면 같이 바꿀 곳: 구글 OAuth 의 승인된 원본·리디렉션 URI(`https://app.<도메인>/api/auth/callback/google`), GitHub 저장소 변수 `LANDING_APP_URL`(`https://app.<도메인>`). 확인이 끝나면 `"workers_dev": false` 를 넣어 workers.dev 주소를 닫습니다.
