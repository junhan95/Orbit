# 인증·과금 통합 검증과 오류 추적

## 자동 검증

`npx vitest run tests/auth-billing-integration.test.ts`는 실제 vinext 요청 컨텍스트·인증 게이트·OAuth 콜백·세션·API 처리 코드·SQLite를 함께 실행한다. Google, Toss, Anthropic HTTP 응답만 모사한다.

- OAuth state 검증, 보안 세션 쿠키, 체험 크레딧 지급
- 충전 주문과 승인, 중복 승인 시 단일 지급
- 크레딧 모드의 업무 실행과 자동 리뷰, 무료 우선 차감과 예약 반납
- 미사용 유료 크레딧 환불, 중복 환불 시 단일 회수
- 로그아웃·만료 세션·위조 사용자 헤더 차단

공급자 테스트 화면을 통과한 실제 결제 인증까지 이 테스트로 검증했다고 해석하면 안 된다. 실연동 검증은 로그인한 브라우저에서 BETA 표시와 테스트 결제창을 확인하고 최소 충전 → 짧은 AI 실행 → 미사용 유료분 환불 순서로 별도 수행한다. 실제 카드 번호·OTP·키는 테스트 기록에 남기지 않는다.

## 오류 추적

실행·대화·결제·OAuth 콜백의 HTTP 응답은 `x-request-id`를 포함한다. 요청에 UUID 형식의 `x-request-id`를 주면 같은 ID로 상관관계를 유지한다. 이것은 인증 식별자가 아니다. 인증 게이트에서 먼저 거부된 요청과 플랫폼 자체 오류에는 앱의 응답 헤더가 없을 수 있다.

Cloudflare Workers 로그의 JSON 이벤트를 다음 순서로 찾는다.

1. `request.started` / `request.finished`: 경로 템플릿, 상태 코드, 경과 시간
2. `run.started` / `run.finished`: 업무·실행·프로젝트 ID와 종료 사유
3. `provider.response` / `provider.failed`: 공급자 작업명·HTTP 상태·응답 헤더까지의 시간·공급자 요청 ID
4. `background.started` / `background.finished` / `background.failed`: 작업 ID, 원래 요청/실행 맥락, 결과
5. `review.incomplete`, `review.skipped`, `memory_review.truncated`, `compaction.skipped`: 리뷰 제출 실패와 대상 삭제·변경을 구분

로그는 본문·전체 URL·인증 헤더·쿠키·결제 키·오류 원문을 기록하지 않는다. DB 오류는 `db_foreign_key`, `db_precondition`, `db_error`로 분류한다. 결제 주문 ID는 지급·환불 요청끼리의 연결에 사용한다.

`npx wrangler tail --config dist/server/wrangler.deploy.json --format json`으로 실시간 이벤트를 볼 수 있다. 공급자 요청 ID를 찾았다면 해당 공급자 조회와 연결한다. `request.started`조차 없다면 플랫폼 로그의 요청 실패/제한 여부를 확인한다. 시작만 있고 완료가 없다는 사실만으로 원인을 단정하지 않는다.

평가 결과의 `transport`에는 요청별 UUID·HTTP 상태·응답 형식·길이·CF-Ray·경과 시간이 남는다. JSON이 아닌 503이나 네트워크 실패도 `undefined`로 사라지지 않는다. 본문과 쿼리는 증거에서 제외한다.

## 백그라운드 안정화

결과 리뷰는 설명을 따로 생성하지 않고 `submit_review` 하나를 요청한다. 한 번 제출 후 추가 모델 호출을 하지 않는다. 토큰 상한으로 제출하지 못해도 사용량을 기록하고 완료 판정을 만들지 않는다. 결과와 댓글은 최초에 읽은 업무가 그대로 있을 때만 같은 원자적 배치에서 반영한다. 기억·대화 요약도 대상 삭제 이후 저장을 거부한다.

자동 재시도나 결제 재조정 스케줄러는 이번 변경에 포함하지 않았다. 실패한 리뷰는 수동 검토로 재실행한다.

## 2026-09-06 검증 기록

- 테스트 87개, 린트·빌드 통과.
- 실제 Claude 평가 10/10 통과, 경고 0. 결과: `evals/results/2026-09-05-16-30.json`.
- 로컬 Worker 구조화 이벤트 125건, 백그라운드 시작/종료 각각 17건. failed/incomplete/truncated 이벤트 0건. 평가 정리 뒤 늦은 리뷰 1건은 안전하게 skipped 처리.
- 운영 Google 로그인 후 앱 진입 확인. 로컬 설정의 Toss 테스트 키로 실제 조회 API에 연결하여 존재하지 않는 주문에 대한 404 NOT_FOUND_PAYMENT 확인.
- 실제 테스트 결제창 승인·AI 실행·환불은 별도의 브라우저 검증 결과로 보고한다.
