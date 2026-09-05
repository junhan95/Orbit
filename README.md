# orbitcrew.ai

**AI 에이전트 협업 워크스페이스.** 프로젝트마다 매니저 에이전트 한 명이 붙어, 필요한 직무의 에이전트를 채용하고 업무를 나누고 결과를 검토해 보고합니다. 사람은 상태를 손으로 옮기지 않습니다 — 대화로 지시하고, 루프 위에서 승인·거절만 합니다.

> orbitcrew is an AI agent command center: one manager agent per project recruits specialists, delegates tasks, reviews their reports, and keeps memory across runs. Humans steer by chat and approve at the gates.

**https://orbitcrew.ai** (랜딩) · **https://app.orbitcrew.ai** (앱) — 지금은 **공개 베타**입니다. 베타 기간에는 크레딧 충전이 테스트 결제로 처리되어 실제로 청구되지 않습니다(사용자당 월 5,000 크레딧). 아래 [요금과 베타](#요금과-베타) 참조.

---

## 무엇을 하나

| | |
|---|---|
| **매니저 오케스트레이션** | 프로젝트를 만들면 전용 매니저가 배정됩니다. 지시를 읽고 직무 카탈로그에서 에이전트를 합류시키고(`recruit_agent`), 업무를 맡기고(`delegate_task`), 돌아온 보고를 검토해 사용자에게 정리합니다. |
| **4층 기억** | 사용자·프로젝트·에이전트 스코프의 선언적 기억을 문자 예산 안에서 관리합니다. 턴 시작에 동결되고, 실행 뒤 리뷰가 돌며, 프로젝트 기억은 사람 승인을 거칩니다. |
| **회상** | 지난 실행·대화를 FTS5(BM25 + 한국어 바이그램)로 되찾습니다. 임베딩 없이, 실행당 호출 상한을 두고요. |
| **검증된 완료** | 에이전트는 근거(`proof`)를 붙여야 완료로 보고할 수 있고, 작성자가 아닌 에이전트가 버그·스펙·정책·근거 네 패스로 검토합니다. 승인은 사람이 합니다. |
| **게이트** | 카드 대량 생성·전역 스킬 저장은 승인 큐로, 연속 실패는 서킷브레이커로. 다섯 지표를 14일 기준선과 비교해 밴드를 벗어나면 매니저에게 진단 카드가 올라갑니다. |
| **스킬** | 절차적 기억. 프롬프트에는 이름만 실리고 필요할 때 `use_skill` 로 읽습니다. |

설계 배경과 참조 모델(Hermes Agent, AI-Native SDLC 플레이북)은 [`docs/orbit-collaboration-blueprint.md`](docs/orbit-collaboration-blueprint.md) 에 있습니다.

## 요금과 베타

월 구독은 없습니다. 에이전트 실행 비용은 두 경로 중 하나로 냅니다.

| 경로 | 동작 |
|---|---|
| **크레딧** (기본) | 가입 시 체험 300 크레딧(1 크레딧 = 10원). 호출마다 실측 토큰 × 모델별 단가(Anthropic 공개 단가 × 1.8, 부가세 포함)를 차감하고, 앱의 계정 > 크레딧에서 토스페이먼츠로 충전합니다. 미사용 유료 크레딧은 환불됩니다. 이 경로의 호출은 운영자 키(`ANTHROPIC_API_KEY`)로 나갑니다. |
| **본인 API 키** (BYOK) | 계정 화면에서 본인 Anthropic 키를 연결하면 이후 모든 호출이 그 키로 나가고 크레딧은 차감되지 않습니다. 키는 AES-GCM 으로 암호화 저장됩니다. |

**베타 운영** — 토스 *테스트* 키(`test_ck_…`)로 도는 동안 서버가 자동으로 베타 과금 모드가 됩니다(`lib/payments.ts` `betaBilling()`): 결제창은 열리지만 실제 청구가 없고, 사용자당 월 충전 한도(`CREDIT_BETA_MONTHLY_CAP`, 기본 5,000 크레딧, KST 월초 초기화)가 걸리며, 베타 충전은 원장에 `meta.beta` 로 표시됩니다. 베타 종료 시 남은 베타 크레딧은 소멸합니다(약관 제5조). live 키로 바꾸면 베타 모드는 자동 해제됩니다. 단가·한도·환불 규칙의 원본은 [`docs/pricing-credits.md`](docs/pricing-credits.md) 입니다.

## 기술 스택

- **런타임** — Cloudflare Workers + D1 (SQLite). [vinext](https://github.com/cloudflare/vinext) 로 Next.js App Router 를 Vite 위에서 돌립니다.
- **UI** — React 19, Tailwind CSS 4, shadcn/ui (base-ui). 디자인 시스템은 [`DESIGN-miro.md`](DESIGN-miro.md), 화면 CSS 는 전부 `--c-*` 시맨틱 토큰만 참조하고 `.dark` 에서 값만 바뀝니다.
- **모델** — Anthropic Claude API. 실행·검토·계획은 기본 모델, 기억 리뷰·요약 같은 보조 호출은 Haiku.
- **결제** — 토스페이먼츠 결제창 v2(일반결제). 카드 정보는 서버를 거치지 않습니다.
- **DB** — Drizzle 스키마 + 저널 기반 마이그레이션 러너(`scripts/migrate.mjs`).

## 시작하기

```bash
# Node 22.13 이상
npm install
cp .env.example .env      # 없으면 아래 환경변수를 직접 만듭니다
npm run db:migrate        # 로컬 D1 에 마이그레이션 적용
npm run dev               # http://localhost:3000
```

`/landing` 이 랜딩, `/` 가 앱입니다.

### 환경변수

```
ANTHROPIC_API_KEY=            # 로컬 모드: 실행 키 / OAuth 모드: 크레딧 경로용 운영자 키
ANTHROPIC_MODEL=              # 기본 claude-sonnet-5
ANTHROPIC_REVIEW_MODEL=       # 보조 호출용, 기본 claude-haiku-4-5

# 로그인 (없으면 로컬 단일 사용자 모드 — 로그인 없음, 크레딧 미사용)
AUTH_MODE=oauth
AUTH_SECRET=                  # openssl rand -base64 32
APP_URL=                      # 없으면 요청 origin
GOOGLE_CLIENT_ID= / GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID= / GITHUB_CLIENT_SECRET=
KEY_ENCRYPTION_SECRET=        # 사용자 API 키 암호화 마스터 시크릿 (OAuth 모드 필수)

# 크레딧 (비우면 기본값)
CREDIT_MARKUP=1.8             # 단가 배수
CREDIT_FX_RATE=1400           # 원/USD, 월 1회 수동 갱신
CREDIT_TRIAL_CREDITS=300      # 가입 체험 크레딧
CREDIT_BETA_MONTHLY_CAP=5000  # 베타 월 충전 한도 (테스트 키일 때만 적용, 0 = 무제한)

# 토스페이먼츠 (API 개별 연동 키. 없으면 충전 버튼 비활성)
TOSS_CLIENT_KEY=              # test_ck_… / live_ck_… — 브라우저 노출 가능
TOSS_SECRET_KEY=              # 서버 전용, 배포에서는 wrangler secret

# 로컬 모드 표시 이름
LOCAL_USER_ID= / LOCAL_USER_NAME= / LOCAL_USER_EMAIL=
```

로그인은 Google/GitHub OAuth 입니다. **Claude 계정 로그인은 Anthropic 정책상 제3자 앱에서 허용되지 않아** 신원은 별도 제공자로 받고, Claude 는 크레딧(운영자 키) 또는 각 사용자의 **본인 Anthropic API 키**(BYOK)로 씁니다 — 근거와 흐름은 [`docs/auth-flow.md`](docs/auth-flow.md).

배포 시크릿(`AUTH_SECRET`·`GOOGLE_CLIENT_SECRET`·`KEY_ENCRYPTION_SECRET`·`TOSS_SECRET_KEY`·`ANTHROPIC_API_KEY`)은 `.env` 에서 읽어 올리는 `scripts/push-secrets.ps1` 로 등록합니다(값은 화면에 출력하지 않음).

### 스크립트

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run check` | lint + 단위 테스트 + 빈 DB 마이그레이션 검증 (배포 전 체크리스트) |
| `npm test` | vitest |
| `npm run evals` | 실제 실행 10건을 케이스로 한 회귀 eval (Claude API 호출, 비용 발생) |
| `npm run db:migrate` / `:check` / `:status` | 마이그레이션 적용 / 빈 DB 전체 적용 검증 / 상태 |
| `npm run build` | 프로덕션 빌드 |
| `npm run deploy` | 빌드 → 배포 설정 → 원격 D1 마이그레이션 → Cloudflare Workers 배포 ([`docs/deploy-cloudflare.md`](docs/deploy-cloudflare.md)) |
| `node scripts/credits-smoke.mjs` | 크레딧 경로 실차감 스모크 (로컬 D1, Anthropic 호출 1회). `--zero` 는 잔액 0 일 때 402 만 확인 |
| `scripts/push-secrets.ps1` | 배포 시크릿 등록 (`.env` → `wrangler secret put`) |

## 구조

```
app/                 페이지·API 라우트 (App Router)
  api/agents/run     업무 실행 — 컨텍스트 조립, 툴 루프, 완료 보고
  api/chat           매니저·에이전트와 대화 (스트리밍)
  api/auth           OAuth 로그인·세션·로그아웃
  api/credits        잔액·내역, 충전 주문/승인/실패/환불 (토스)
  landing/  login/   랜딩, 로그인 화면
  terms/  privacy/   서비스 이용약관, 개인정보처리방침 (한글 본문 + 영문 요약)
components/          화면 (workspace-views: 프로젝트·에이전트·대화·설정·계정)
lib/                 도메인 로직
  run-task.ts        실행 프롬프트 조립     manager-tools.ts   채용·위임 도구
  memory.ts          기억                   recall.ts          회상(FTS5)
  reviewer.ts        교차 검토              approvals.ts       승인 큐
  health.ts          관제 밴드              skills.ts          스킬
  auth.ts            OAuth·세션             profile.ts         사용자 프로필
  user-keys.ts       사용자 API 키(BYOK)     user-keys-crypto.ts AES-GCM (순수)
  credits.ts         크레딧 원장·잔액·계량   credits-pricing.ts 단가 계산 (순수)
  payments.ts        토스 주문·승인·환불·베타 한도   claude.ts  Claude 호출 + 과금 핸들
  legal.ts           사업자·약관 상수        i18n.ts / i18n-en.ts  화면 사전 (한→영)
db/  drizzle/        스키마, 마이그레이션(0000~)
docs/                설계 문서
evals/  tests/       회귀 eval 케이스, 단위 테스트
proxy.ts             호스트 분리(랜딩/앱) + 로그인 게이트
```

## 문서

- [`docs/orbit-collaboration-blueprint.md`](docs/orbit-collaboration-blueprint.md) — 협업 알고리즘: 무엇을 어디서 가져왔고 어떻게 구현했는지
- [`docs/auth-flow.md`](docs/auth-flow.md) — 접속 흐름, 정책 근거, BYOK 계획
- [`docs/pricing-credits.md`](docs/pricing-credits.md) — 크레딧 요금 명세: 단가·충전 단위·결제 흐름·데이터 구조·약관·베타 운영(§10)
- [`docs/db-migrations.md`](docs/db-migrations.md) — 마이그레이션 운영
- [`docs/deploy-cloudflare.md`](docs/deploy-cloudflare.md) — Cloudflare Workers 배포 절차
- [`docs/hermes-analysis.md`](docs/hermes-analysis.md) · [`docs/ai-native-sdlc-review.md`](docs/ai-native-sdlc-review.md) — 참조 모델 분석
- [`evals/README.md`](evals/README.md) — eval 케이스 작성법

## 상태

**공개 베타.** 활발히 개발 중이며 스키마와 API 가 예고 없이 바뀔 수 있습니다. 베타 기간의 충전은 테스트 결제(무과금)이고 남은 베타 크레딧은 베타 종료 시 소멸합니다 — 종료일은 최소 30일 전에 앱과 약관 페이지에 공지합니다. 팀 플랜과 기업 셀프호스팅은 준비 중입니다.

## 라이선스

[GNU AGPL-3.0](LICENSE). 이 코드를 수정해 네트워크로 서비스하는 경우에도 소스를 같은 조건으로 공개해야 합니다. © 2026 와이즈쿼리 (WISEQUERY)
