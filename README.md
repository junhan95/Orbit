# Orbit

**AI 에이전트 협업 워크스페이스.** 프로젝트마다 매니저 에이전트 한 명이 붙어, 필요한 직무의 에이전트를 채용하고 업무를 나누고 결과를 검토해 보고합니다. 사람은 상태를 손으로 옮기지 않습니다 — 대화로 지시하고, 루프 위에서 승인·거절만 합니다.

> Orbit is an AI agent command center: one manager agent per project recruits specialists, delegates tasks, reviews their reports, and keeps memory across runs. Humans steer by chat and approve at the gates.

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

## 기술 스택

- **런타임** — Cloudflare Workers + D1 (SQLite). [vinext](https://github.com/cloudflare/vinext) 로 Next.js App Router 를 Vite 위에서 돌립니다.
- **UI** — React 19, Tailwind CSS 4, shadcn/ui (base-ui). 디자인 시스템은 [`DESIGN-miro.md`](DESIGN-miro.md), 화면 CSS 는 전부 `--c-*` 시맨틱 토큰만 참조하고 `.dark` 에서 값만 바뀝니다.
- **모델** — Anthropic Claude API. 실행·검토·계획은 기본 모델, 기억 리뷰·요약 같은 보조 호출은 Haiku.
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
ANTHROPIC_API_KEY=            # 필수
ANTHROPIC_MODEL=              # 기본 claude-sonnet-5
ANTHROPIC_REVIEW_MODEL=       # 보조 호출용, 기본 claude-haiku-4-5

# 로그인 (없으면 로컬 단일 사용자 모드 — 로그인 없음)
AUTH_MODE=oauth
AUTH_SECRET=                  # openssl rand -base64 32
APP_URL=                      # 없으면 요청 origin
GOOGLE_CLIENT_ID= / GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID= / GITHUB_CLIENT_SECRET=
KEY_ENCRYPTION_SECRET=        # 사용자 API 키 암호화 마스터 시크릿 (OAuth 모드 필수)

# 로컬 모드 표시 이름
LOCAL_USER_ID= / LOCAL_USER_NAME= / LOCAL_USER_EMAIL=
```

로그인은 Google/GitHub OAuth 입니다. **Claude 계정 로그인은 Anthropic 정책상 제3자 앱에서 허용되지 않아** 신원은 별도 제공자로 받고, Claude 는 로그인 뒤 각 사용자가 **본인 Anthropic API 키**를 연결(BYOK)해 씁니다. 키는 AES-GCM 으로 암호화 저장되고 실행·대화 비용은 키 주인의 Console 에 청구됩니다 — 근거와 흐름은 [`docs/auth-flow.md`](docs/auth-flow.md).

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

## 구조

```
app/                 페이지·API 라우트 (App Router)
  api/agents/run     업무 실행 — 컨텍스트 조립, 툴 루프, 완료 보고
  api/chat           매니저·에이전트와 대화 (스트리밍)
  api/auth           OAuth 로그인·세션·로그아웃
  landing/  login/   랜딩, 로그인 화면
components/          화면 (workspace-views: 프로젝트·에이전트·대화·설정·계정)
lib/                 도메인 로직
  run-task.ts        실행 프롬프트 조립     manager-tools.ts   채용·위임 도구
  memory.ts          기억                   recall.ts          회상(FTS5)
  reviewer.ts        교차 검토              approvals.ts       승인 큐
  health.ts          관제 밴드              skills.ts          스킬
  auth.ts            OAuth·세션             profile.ts         사용자 프로필
  user-keys.ts       사용자 API 키(BYOK)     user-keys-crypto.ts AES-GCM (순수)
db/  drizzle/        스키마, 마이그레이션(0000~)
docs/                설계 문서
evals/  tests/       회귀 eval 케이스, 단위 테스트
proxy.ts             호스트 분리(랜딩/앱) + 로그인 게이트
```

## 문서

- [`docs/orbit-collaboration-blueprint.md`](docs/orbit-collaboration-blueprint.md) — 협업 알고리즘: 무엇을 어디서 가져왔고 어떻게 구현했는지
- [`docs/auth-flow.md`](docs/auth-flow.md) — 접속 흐름, 정책 근거, BYOK 계획
- [`docs/db-migrations.md`](docs/db-migrations.md) — 마이그레이션 운영
- [`docs/deploy-cloudflare.md`](docs/deploy-cloudflare.md) — Cloudflare Workers 배포 절차
- [`docs/hermes-analysis.md`](docs/hermes-analysis.md) · [`docs/ai-native-sdlc-review.md`](docs/ai-native-sdlc-review.md) — 참조 모델 분석
- [`evals/README.md`](evals/README.md) — eval 케이스 작성법

## 상태

활발히 개발 중이며 스키마와 API 가 예고 없이 바뀔 수 있습니다.

## 라이선스

[GNU AGPL-3.0](LICENSE). 이 코드를 수정해 네트워크로 서비스하는 경우에도 소스를 같은 조건으로 공개해야 합니다. © 2026 와이즈쿼리 (WISEQUERY)
