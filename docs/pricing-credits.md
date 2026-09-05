# 크레딧 충전 요금제 명세 (초안)

작성일 2026-09-05. 사용자 결정 사항을 바탕으로 한 구현 전 명세입니다. 법·세무 항목은 세무사·법무 확인이 필요합니다.

## 0. 결정 사항 요약

| 항목 | 결정 |
|---|---|
| 통화 · PG | 원화, 토스페이먼츠 |
| 크레딧 단위 | 1 크레딧 = 10원 (부가세 포함 소비자가) |
| 무료 체험 | 가입 시 300 크레딧 (3,000원 상당) |
| 단가 배수 | Anthropic 공개 단가 × 1.8 (확정. 처음 1.5 에서 마진 실효치가 낮아 상향 — 1.2 참고) |
| BYOK | 유지. 본인 키가 등록된 사용자는 계속 무료(키 우선) |
| 광고 · 개인 월구독 | 없음 |

## 1. 요금 구조

### 1.1 단가표 (모델별, 100만 토큰당 크레딧)

계산식: `크레딧 = USD 단가 × 배수(1.8) × 환율(원/USD) ÷ 10`. 환율은 서버 설정값 `CREDIT_FX_RATE` 로 두고 아래 표는 **1,400원/USD 가정**입니다. 환율·단가가 바뀌면 `lib/pricing.ts` 의 `MODEL_PRICES` 와 설정값만 바꾸면 되고 표는 자동 생성해야 합니다(하드코딩 금지).

| 모델 | 입력 | 출력 | 캐시 쓰기 | 캐시 읽기 |
|---|---:|---:|---:|---:|
| claude-fable-5-1 | 2,520 | 12,600 | 3,150 | 63 |
| claude-opus-5 | 1,260 | 6,300 | 1,575 | 126 |
| claude-sonnet-5 | 504 | 2,520 | 630 | 50.4 |
| claude-sonnet-4-5 | 756 | 3,780 | 945 | 75.6 |
| claude-haiku-4-5 | 252 | 1,260 | 315 | 25.2 |
| 웹 검색 (1회) | 2.52 | | | |

감이 오도록 환산하면(검산 완료): Sonnet 5 로 입력 3,000 + 출력 800 토큰짜리 대화 한 턴 ≈ 3.5 크레딧(35원). 하위 에이전트를 여럿 돌리는 매니저 실행 1회는 보통 5만~20만 토큰(입력 8 : 출력 2 가정) → Sonnet 5 기준 약 45~180 크레딧, Haiku 4.5 기준 약 23~90 크레딧. **무료 300 크레딧은 Sonnet 대화 85여 턴 또는 매니저 실행 1.5~6회 분량**으로, 매니저가 팀을 꾸려 일하는 핵심 장면을 몇 차례 경험하기에 충분합니다. 체험 크레딧을 Haiku 전용으로 제한하면 분량이 두 배가 되지만, 300 크레딧이면 Sonnet 까지 열어 두는 것도 무리가 없습니다(1.4 참고).

### 1.2 마진 실효치와 배수 결정

표시 배수에서 부가세(10%)와 PG 수수료(약 3.5% 가정)를 빼면 실수령 배수는 `배수 ÷ 1.1 × 0.965` 입니다. "마진 40%" 는 기준을 무엇으로 잡느냐에 따라 필요한 배수가 달라집니다.

| 표시 배수 | 실수령 배수 | 결제총액 대비 마진 | 공급가(부가세 제외) 대비 마진 | 원가 대비 이익률 |
|---:|---:|---:|---:|---:|
| 1.5 | 1.32 | 21% | 24% | 32% |
| 1.6 | 1.40 | 25% | 29% | 40% |
| **1.8** | **1.58** | **32%** | **37%** | **58%** |
| 1.9 | 1.67 | 35% | 40% | 67% |
| 2.0 | 1.75 | 38% | 43% | 75% |
| 2.1 | 1.84 | 40% | 46% | 84% |

- **확정: 1.8배.** 공급가 기준 약 37%, 결제총액 기준 약 32% 마진로, 환율·무료 크레딧·실패 호출·환불을 흡수한 뒤 30% 안팎이 남는 수준입니다. 배수는 서버 설정값 `CREDIT_MARKUP=1.8` 로 두어 재조정 시 코드 변경 없이 바꿉니다.
- 2배 근처는 단가 공개 시 "직접 키 만드는 게 낫다" 는 반응이 나올 수 있는 경계입니다. 대상이 키 발급·결제수단 등록을 원치 않는 사용자라는 점, 그리고 BYOK 무료 경로가 항상 열려 있다는 점이 방어 논리입니다. 대량 충전 보너스(1.3)로 헤비 유저의 실질 배수를 낮추는 게 배수 자체를 내리는 것보다 낫습니다.
- 초기 3개월 실적(환율·실패율·무료 크레딧 소진율)으로 재조정합니다. 소비자 대상 표시가는 부가세 포함 총액이 원칙이므로 "부가세 별도" 표기는 하지 않습니다.

### 1.3 충전 단위

| 결제금액 | 기본 크레딧 | 보너스 | 총 지급 |
|---:|---:|---:|---:|
| 5,000원 | 500 | — | 500 |
| 10,000원 | 1,000 | — | 1,000 |
| 30,000원 | 3,000 | 5% (150) | 3,150 |
| 50,000원 | 5,000 | 8% (400) | 5,400 |

최소 충전은 5,000원으로 낮게 유지합니다(첫 결제 장벽 = 전환율). 보너스 비율은 설정값으로 두고 시작 시점에는 켜지 않아도 됩니다.

### 1.4 무료 체험 크레딧 (300 크레딧)

남용(계정 여러 개로 반복 수령) 대응으로 다음 제한을 권합니다.

- 무료 크레딧으로 실행 가능한 모델은 haiku-4-5 · sonnet-5 로 한정 (fable/opus 는 유료 잔액이 있을 때만). 300 크레딧이면 남용해도 3,000원어치라 동기가 약함
- 유료 잔액이 0 인 상태에서는 시간당 실행 횟수 제한(예: 매니저 실행 5회/시간)
- 같은 OAuth 계정에는 한 번만 지급, 지급 기록은 원장에 남김
- 남용 판정 시 회수 가능(약관 명시)

카드 등록을 조건으로 거는 방식은 남용은 막지만 전환도 막으므로 초기에는 채택하지 않습니다.

## 2. 결제 연동 (토스페이먼츠)

### 2.1 조사 결과 (2026-09-05, 토스페이먼츠 개발자센터)

- **일반결제(수동 충전)**: 결제창 SDK 로 카드·계좌이체·간편결제 모두 가능. 기본 가맹 계약으로 충분.
- **빌링키 자동결제**: "리스크 검토 및 추가 계약 후 사용" 가능하고, "자동결제는 정기 구독형 서비스에 사용하세요 — 카드사에서 빌링키의 비정기적인 결제를 허용하지 않아서 심사가 어려울 수 있습니다". 자동결제는 신용·체크카드만, 국내 카드만 지원. 결제 스케줄링은 가맹점이 직접 구현.
- **브랜드페이**(자체 간편결제): 카드를 한 번 등록하면 이후 비밀번호(또는 FDS 판단 시 원터치)로 결제. 사용자 개입 없는 자동결제는 "사용이 제한" (고객센터 문의).

즉 **"잔액이 떨어지면 알아서 충전"은 토스 빌링 정책상 심사 통과가 어렵습니다.** 카드 연동은 가능하되 결제 시점이 정기적이어야 합니다.

### 2.2 결정 제안

| 단계 | 방식 | 비고 |
|---|---|---|
| 1단계 (출시) | 결제창 일반결제로 수동 충전 + 잔액 부족 알림(앱 배너·이메일) + 원클릭 재충전 | 추가 계약 없음 |
| 2단계 | "월 정기 충전" 옵션 — 매월 지정일에 지정 금액을 빌링키로 결제 | 정기 구독형이므로 빌링 계약 신청 가능. 월 상한 = 지정 금액 |
| 보류 | 잔액 기준 자동 충전 | 토스 정책상 어려움. 브랜드페이 원터치가 대안이나 고객센터 확인 필요 |

### 2.3 일반결제 흐름 (Cloudflare Workers 기준)

1. 클라이언트: 결제창 v2 SDK 호출 (`orderId` = 서버가 발급한 UUID, `amount`, `orderName`="orbitcrew 크레딧 1,000", `successUrl`/`failUrl`).
2. `successUrl` 로 돌아오면 쿼리의 `paymentKey · orderId · amount` 를 서버에 전달.
3. 서버: `orderId` 로 미리 저장해 둔 주문의 금액과 `amount` 가 일치하는지 검증 → `POST https://api.tosspayments.com/v1/payments/confirm` (Basic auth = base64(`시크릿키:`)) 호출.
4. 승인 응답을 `payments` 에 저장하고 원장에 `charge`(+보너스면 `bonus`) 행 추가. 같은 `orderId` 는 한 번만 처리(멱등).
5. 실패·취소 시 주문 상태만 갱신, 원장에는 기록하지 않음.
6. 환불: `POST /v1/payments/{paymentKey}/cancel` (부분 취소 지원) → 원장에 `refund` 행.

Workers 는 `fetch` 만 쓰므로 Node SDK 없이 REST 로 붙입니다. 시크릿은 `TOSS_SECRET_KEY` 로 `wrangler secret put`. 테스트는 토스 테스트 키(`test_sk_…`)로 로컬·배포 모두 가능.

## 3. 데이터 구조 (D1)

잔액을 한 칸에 숫자로 두고 가감하지 않습니다. 모든 변동을 불변 원장으로 쌓고 잔액은 합계로 구합니다. 내부 단위는 **밀리크레딧(1/1,000 크레딧 = 0.01원)** 정수 — haiku 입력 1,000 토큰이 0.21 크레딧이라 소수가 필요합니다.

```sql
-- 0019_credits.sql (번호는 저널 기준으로 확정)
CREATE TABLE credit_ledger (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,            -- trial | charge | bonus | usage | refund | adjust
  amount_mc   INTEGER NOT NULL,         -- 밀리크레딧, 부호 있음 (usage/refund 는 음수)
  bucket      TEXT NOT NULL,            -- paid | promo  (환불 계산용: promo 부터 차감)
  ref_type    TEXT,                     -- payment | run | admin
  ref_id      TEXT,
  meta        TEXT,                     -- JSON: 모델별 토큰, 환율, 단가 스냅샷
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_credit_ledger_user ON credit_ledger(user_id, created_at);

CREATE TABLE credit_holds (             -- 실행 중 가예약
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  run_id      TEXT NOT NULL UNIQUE,
  amount_mc   INTEGER NOT NULL,
  status      TEXT NOT NULL,            -- open | settled | released
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE payments (
  id            TEXT PRIMARY KEY,       -- = orderId
  user_id       TEXT NOT NULL,
  provider      TEXT NOT NULL,          -- toss
  payment_key   TEXT,
  amount_krw    INTEGER NOT NULL,
  credits_mc    INTEGER NOT NULL,       -- 기본 지급분
  bonus_mc      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,          -- pending | done | failed | canceled | refunded
  method        TEXT,                   -- 카드 | 계좌이체 | 간편결제
  receipt_url   TEXT,
  raw           TEXT,                   -- 승인 응답 JSON
  created_at    INTEGER NOT NULL,
  approved_at   INTEGER
);
```

잔액 정의: `잔액 = Σ credit_ledger.amount_mc`, `사용 가능 잔액 = 잔액 − Σ open holds`. 원장 행은 수정·삭제하지 않고 정정은 `adjust` 행으로.

## 4. 실행 흐름 (예약 → 실측 정산)

매니저 실행은 하위 에이전트가 연쇄로 돌아 비용을 미리 알 수 없으므로 다음 순서를 따릅니다.

1. **경로 선택**: 사용자에게 BYOK 키가 있으면 키로 실행(과금 없음). 없으면 크레딧 경로.
2. **사전 확인**: 예상 상한 `hold = max(최근 10회 실행 평균 × 1.5, 50 크레딧)` 을 계산. 사용 가능 잔액 < hold 면 실행 전에 "잔액 부족" 으로 거절(충전 링크 제시).
3. **가예약**: `credit_holds` 에 `open` 행 생성.
4. **실행 중 계량**: API 호출마다 실제 토큰 × 단가 스냅샷을 누적. 누적치가 사용 가능 잔액(예약 포함)에 도달하면 매니저를 즉시 중단하고 결과에 "잔액 부족으로 중단됨 — 여기까지의 결과" 를 남김. 대화 탭도 같은 규칙.
5. **정산**: 종료 시 `usage` 행(실측 음수, meta 에 모델별 토큰·환율·단가) 추가, hold 는 `settled`. 오류로 끝나도 소모된 토큰은 정산(단, 서버 오류로 응답을 전혀 못 받은 호출은 과금하지 않음).
6. **차감 순서**: promo(무료·보너스) 버킷부터, 그다음 paid. 환불 시 paid 잔액만 계산하면 되도록.

AI 사용량 화면은 지금의 USD 추정치 옆에 크레딧 실차감액을 나란히 보여 주고, BYOK 사용자는 기존대로 추정치만 봅니다.

## 5. 화면·안내

- **계정 > 크레딧**: 잔액(크레딧 + 원화 환산), 충전 버튼, 원장 내역(충전·사용·환불), 영수증 링크, 모델별 단가표.
- **잔액 경고**: 50 크레딧 이하 배너, 10 크레딧 이하 이메일(hello@orbitcrew.ai 발신), 0 이면 실행 버튼 대신 충전 안내.
- **온보딩**: 첫 로그인 안내에 "300 크레딧이 지급되었습니다" + "Claude API 키가 있으면 연결해서 무료 이용" 두 갈래.
- **랜딩 가격 섹션** (3장 카드):
  1. 개인 — 쓴 만큼만: 가입 즉시 300 크레딧, 5,000원부터 충전, 모델별 단가 공개, 각주 "Claude API 키가 있다면 연결해서 무료".
  2. 팀 — 준비 중: 멤버 초대·프로젝트 공유·공용 크레딧. 가격 미정, 대기 명단 등록.
  3. 기업 — 셀프호스팅: 귀사 서버 설치, 자체 키·데이터 외부 반출 없음, AGPL 또는 상용 라이선스, 문의하기.
- 랜딩 첫 문장은 "가입하면 바로 시작, 쓴 만큼만" 으로 바꾸고 "orbitcrew 는 무료(키 필요)" 는 각주로 내림.

## 6. 약관·법·세무 (확인 필요)

- **선불전자지급수단**: 크레딧은 orbitcrew 안에서만 쓰이는 단일 용도이므로 전자금융거래법상 등록 의무가 면제될 가능성이 높음 — 확인 필요.
- **통신판매업 신고**: 유료 판매 시작 전 신고 여부 확인.
- **부가세**: 충전 시점 과세(선수금 처리) vs 사용 시점 과세 — 세무사와 결정. 현금영수증·세금계산서는 토스 결제 영수증으로 갈음 가능한지 확인.
- **약관 추가 조항** (/terms):
  - 크레딧 정의, 1 크레딧 = 10원, 유효기간 5년(또는 무기한)
  - 유료 크레딧 미사용분은 전액 환불(결제 취소 방식, PG 취소 가능 기간 경과 시 계좌 환불). 무료·보너스 크레딧은 환불·양도 불가
  - 단가는 사전 고지 후 변경 가능(고지 기간 예: 14일)
  - 남용·부정 수령 시 크레딧 회수 및 이용 제한
  - 실행 중단(잔액 부족)에 따른 결과 불완전은 서비스 하자가 아님
- **개인정보처리방침**: 결제 정보(토스 결제 키·영수증) 보관 항목·기간 추가. 카드 번호는 저장하지 않음.

## 7. 구현 순서 제안

1. 마이그레이션(원장·홀드·결제) + 잔액 계산 유틸 + 무료 300 크레딧 지급(첫 로그인 훅)
2. 실행 경로 분기(BYOK/크레딧) + 예약·계량·정산 + 잔액 부족 중단
3. 계정 > 크레딧 화면(잔액·내역·단가표)
4. 토스 일반결제 연동(테스트 키) → 실결제 검증 → 환불 API
5. 약관·개인정보처리방침 개정, 랜딩 가격 섹션
6. (이후) 월 정기 충전 — 토스 빌링 계약 신청

## 8. 미결 사항 — 결정됨 (2026-09-05)

- 환율 갱신: 월 1회 수동 (`CREDIT_FX_RATE`)
- 체험 크레딧 모델 제한: haiku-4-5 · sonnet-5 만 허용 (`TRIAL_ALLOWED_MODELS`)
- 보너스: 출시 시 끔 (`CHARGE_BONUS_ENABLED = false`)
- 웹 검색 과금: 내역에는 별도 항목으로 표시, 잔액 차감은 토큰과 합산

## 9. 구현 상태

### 1단계 완료 (2026-09-05)

| 파일 | 내용 |
|---|---|
| `drizzle/0021_credits.sql` + 저널 | credit_ledger · credit_holds · payments 테이블. trial 은 사용자당 1회(부분 유니크 인덱스) |
| `db/schema.ts` | 위 3개 테이블의 Drizzle 정의 |
| `lib/credits-pricing.ts` | 순수 계산: 단위 상수, USD→밀리크레딧, 단가표 자동 생성, 충전 단위, 체험 허용 모델 |
| `lib/credits.ts` | 서버: 설정(`CREDIT_MARKUP`·`CREDIT_FX_RATE`·`CREDIT_TRIAL_CREDITS`), 잔액 조회, 원장 기록, 체험 지급(멱등), 과금 경로 판정(local/byok/credits) |
| `app/api/credits/route.ts` | GET — 잔액·체험·충전 단위·단가표·내역. 처음 조회 시 체험 크레딧 미지급자에게 지급 |
| `app/api/auth/callback/[provider]/route.ts` | 첫 로그인(가입) 시 체험 크레딧 지급. 실패해도 로그인은 진행 |
| `db/env.d.ts`, `.env.example` | 설정값 3종 |
| `tests/credits.test.ts` | 단가·환산·충전·체험 모델 검사 6건 |

검증: `db:migrate:check` 통과(0000~0021), `tsc` 무오류, `oxlint` 무경고, vitest 13/13, 로컬 D1 적용 후 `/api/credits` 두 번 호출 → 첫 호출에 300 크레딧(3,000원) 지급, 두 번째는 중복 지급 없음 확인.

### 2단계 완료 (2026-09-05) — 실행 경로 분기 · 호출 단위 계량 · 잔액 부족 중단

설계에서 바뀐 점: **가예약(hold) 대신 호출 즉시 차감.** Claude 응답이 올 때마다 실측 토큰을 크레딧으로 환산해 원장에 `usage` 행을 바로 씁니다(ref_type='call'). 실행 도중 죽어도 쓴 만큼은 남고, 병렬 실행이 겹쳐도 초과는 마지막 한 호출분에 그칩니다. `credit_holds` 테이블은 남겨 두되 지금은 쓰지 않습니다(월 정기 충전 등 후속 용도).

| 파일 | 내용 |
|---|---|
| `lib/claude.ts` | `apiKey` 자리에 문자열 대신 `ClaudeBilling` 핸들을 받음(`ClaudeCredential`). 호출 전 `beforeCall`, 응답마다 `onUsage` — stop 이면 툴 결과를 이어 보내지 않고 `stopReason='insufficient_credits'` 로 종료. `resolveModel` 로 체험 전용 사용자의 fable/opus 요청을 sonnet-5 로 바꿈 |
| `lib/credits.ts` | `CreditBilling`(잔액 스냅샷 + 누적 차감 + 호출 단위 원장 기록), `resolveCredential()`(local/byok/credits 분기, 잔액 0 이면 `InsufficientCreditsError`), `credentialErrorResponse()`(409 no_api_key / **402 insufficient_credits**) |
| 라우트 5곳 (agents/run, chat, chat/stream, projects/[id]/plan, tasks/[id]/review) | `resolveApiKey` → `resolveCredential` |
| `lib/run-task.ts` 등 7개 모듈 | `apiKey` 타입만 `ClaudeCredential` 로 — 매니저 → 하위 에이전트 → 리뷰·기억 리뷰·압축까지 같은 핸들이 흘러가 합산 계량됨. run-task 산출물과 대화 답변 끝에 "크레딧 잔액이 부족해 여기서 중단" 안내 |
| `tests/billing-loop.test.ts` | fetch 를 흉내 내어 루프 중단·모델 치환·키 사용·호출 전 차단 4건 |
| `scripts/credits-smoke.mjs` | 로컬 스모크: 사용자 키를 잠시 치워 크레딧 경로로 대화 1회. `--zero` 는 잔액 0 → 402 확인 |

검증: tsc·oxlint(변경 파일) 무오류, vitest 43/43, `db:migrate:check` 통과. 로컬에서 `--zero` 스모크로 402 응답과 잔액 메시지 확인. 실제 차감 스모크는 `.env` 의 `ANTHROPIC_API_KEY`(운영자 키)가 유효하지 않아("API key is invalid") Anthropic 호출 직전까지만 확인됨 — 오류 호출은 과금되지 않는 것도 함께 확인. **유효한 운영자 키를 .env 에 넣고 `node scripts/credits-smoke.mjs` 를 다시 돌리면 원장 차감까지 확인됩니다.**

운영 전제: OAuth 모드에서도 이제 `ANTHROPIC_API_KEY`(운영자 키)가 필요합니다 — 크레딧 경로 전용이며 BYOK 사용자는 여전히 본인 키로만 나갑니다. 배포 시 `wrangler secret put ANTHROPIC_API_KEY`.

### 3단계 완료 (2026-09-05) — 계정 화면 · 랜딩 요금 섹션 · 토스 일반결제

| 파일 | 내용 |
|---|---|
| `components/credits-card.tsx` + `credits.css` | 계정 > 크레딧 카드: 잔액(무료/유료), 체험·잔액 경고, 충전 4종 → 토스 결제창(v2 SDK `payment().requestPayment`, method CARD), 모델별 단가표, 결제 목록(영수증·환불), 원장 내역 |
| `lib/payments.ts` | 주문 생성(pending) → `confirmPayment`(금액 대조 → `POST /v1/payments/confirm` → done + 원장 charge/bonus, 멱등) → `refundPayment`(미사용 유료 잔액 ≥ 결제 크레딧일 때만 전액 취소 → refunded + 원장 refund) |
| `app/api/credits/{orders,confirm,fail,refund}` | 주문 생성 / successUrl(서버 승인 후 `?credits=done` 으로 복귀) / failUrl / 환불. `GET /api/credits` 에 `payments`·`checkout.enabled` 추가 |
| `app/page.tsx` | `?credits=done\|canceled\|error` 복귀 토스트 + 계정 화면 이동. 첫 로그인은 키 모달 대신 "300 크레딧 지급" 토스트 |
| `app/api/keys/route.ts` | `required` 는 운영자 키(크레딧 경로)가 없는 배포에서만 true |
| `app/landing/landing-view.tsx` | 요금 섹션(#pricing: 개인/팀/기업) + BM 과 어긋나던 카피 전면 수정(한/영) |
| `.env.example`, `db/env.d.ts` | `TOSS_CLIENT_KEY`(브라우저 노출 가능) / `TOSS_SECRET_KEY`(서버 전용, 배포는 wrangler secret) |

**키 종류 주의**: 결제창 방식(`payment()`)은 토스 개발자센터의 **API 개별 연동 키**(`test_ck_`/`test_sk_`)를 씁니다. 주문서형·결제창형 키(`test_gck_`)는 결제위젯(`widgets()`) 전용이라 `NOT_SUPPORTED_WIDGET_KEY` 로 거부됩니다. API 키 접근 정책(IP 허용 목록)은 Workers 의 아웃바운드 IP 가 고정이 아니라 등록하지 않습니다.

검증(로컬, 테스트 키): 5,000원 충전 → 토스 결제창(카카오페이 테스트) → 승인 → 잔액 300 → 800(유료 500), 결제 목록에 완료·영수증·환불 표시 → 환불 API → 토스 취소 성공, 잔액 300, 유료 0, 결제 refunded, 원장에 refund −500 행. tsc·oxlint·vitest 43/43 통과.

### 다음 단계 (4단계)
운영 반영: `wrangler secret put TOSS_SECRET_KEY` + `wrangler.deploy.json` vars 에 `TOSS_CLIENT_KEY`(테스트 키로 먼저), `ANTHROPIC_API_KEY` 시크릿. 약관(/terms) 크레딧 조항·개인정보처리방침 결제 항목. 토스 라이브 키 전환은 가맹 계약·심사 후. 아직 없는 것: 유료 잔액 0 사용자의 시간당 실행 횟수 제한(§1.4), 잔액 부족 이메일(§5), 계좌이체 결제수단(method TRANSFER 추가만 하면 됨).

## (구) 8. 미결 사항 원문

- 환율 갱신 방식: 고정 설정값을 월 1회 수동 갱신할지, 환율 API 로 일 단위 갱신할지 (단가 변동이 잦으면 사용자 혼란 → 월 1회 권장)
- 무료 크레딧 모델 제한을 둘지 (권장: 둠)
- 보너스 비율을 출시 시점부터 켤지
- 웹 검색 과금을 별도 항목으로 표시할지, 토큰과 합산할지
