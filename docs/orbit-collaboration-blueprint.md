# Orbit 협업 알고리즘 — Hermes Agent 와 AI-Native SDLC 플레이북에서 가져온 것, 그리고 앞으로

작성일 2026-09-05 · 브랜치 `feat/claude-migration` (`1ed7511` 기준)
참고 문서: `docs/hermes-analysis.md`(Hermes 분석), `docs/ai-native-sdlc-review.md`(플레이북 검토), `docs/ui-handoff-recall.md`(UI 인수인계 §1~§14), `docs/db-migrations.md`, `evals/README.md`

---

## 0. 한 장 요약

Orbit 은 두 참조 모델을 한 구조로 합쳤습니다.

- **Hermes Agent** 에서는 "에이전트가 무엇을 기억하고 어떻게 이어서 일하는가"를 가져왔습니다 — 4층 기억(선언적·에피소드·작업·절차)과 칸반 워커의 컨텍스트 핸드오프, 구조화된 완료 보고, 서킷브레이커.
- **AI-Native SDLC 플레이북** 에서는 "사람이 어디에서만 개입하고 나머지는 어떻게 스스로 도는가"를 가져왔습니다 — 산출물 체인, 권고(Skill)/결정(Hook)의 거버넌스 층, 검증 근거가 붙은 완료, 다른 에이전트의 검토, 연속 eval, 관제 밴드로 닫히는 루프.

두 원칙이 만나는 지점은 하나입니다: **에이전트는 기억을 갖고 스스로 검증하며 일하고, 사람의 판단은 루프 위에서 승인·거절·분류만 한다.**

```
 목표 ──▶ 계획 분해 ──▶ 카드(대기) ──▶ 실행 ──▶ 검토 열 ──▶ 사람 승인
            (제안→apply)     │            │  ▲         │
                             │   댓글=지시 │  │ 검토자   │ 관제 밴드 → 진단 카드
                             ▼            ▼  │ 댓글     ▼
                        서킷브레이커   complete_task     evals (회귀)
                        승인 대기 큐    + proof
     기억(user/project/agent) · 회상(FTS5) · 압축 요약 · 스킬 ─── 모든 실행·대화에 주입
```

---

## 1. Hermes Agent 에서 가져온 것

| Hermes 개념 | Orbit 구현 | 위치 |
|---|---|---|
| **선언적 기억** (MEMORY.md / USER.md, 문자 예산, 동결 스냅샷, 백그라운드 리뷰) | `memories` 테이블, user 1,400 / project 2,200 / agent 1,500자 예산, 턴 시작 시 동결, 예산 초과 시 현재 엔트리를 돌려주며 거부, project 스코프는 에이전트가 쓰면 `pending`(승인 게이트), 실행 후·대화 10턴마다 Haiku 리뷰(전사 200자 미만이면 건너뜀), 위협 스캔(인젝션·비밀값·보이지 않는 유니코드) | `lib/memory.ts`, `lib/memory-review.ts`, `/api/memory` |
| **에피소드 회상** (FTS5 BM25 + trigram, 임베딩 없음, 세션 검색에 LLM 미사용) | `recall_docs` + `recall_fts`(external-content FTS5), 한글 바이그램 컬럼으로 2자 한국어 매칭, 1위만 본문+이웃, 총 8K 상한, 실행·대화당 **3회 상한** | `lib/recall.ts`, `/api/recall` |
| **작업 기억 압축** (아카이브 + 복구 포인터) | `chat_summaries` — 요약 이후 메시지 24개 초과 시 최근 12개만 원문, 나머지는 Haiku 요약(3,000자 예산)으로 흡수. 원문은 지우지 않고 `compacted=1` 로 검색 유지, 요약 자체도 색인 | `lib/compaction.ts` |
| **절차적 기억** (skills, 점진적 공개) | `skills` 테이블(global/project), 프롬프트에는 이름+언제 쓰는지만, `use_skill` 로 본문 읽기, `save_skill` 실행당 1개 | `lib/skills.ts`, `/api/skills` |
| **워커 컨텍스트 핸드오프** (build_worker_context) | 프로젝트·이전 시도 10건·검토 완료 형제 업무 8건·카드 본문/하위 작업/댓글·기억·스킬 인덱스를 시스템 프롬프트에 조립 | `app/api/agents/run/route.ts`, `lib/run-loop.ts` |
| **kanban_complete** (구조화 보고) | `complete_task(status, summary, blocked_reason, next_actions, proof)` — 본문은 이 툴을 부른 턴의 텍스트 | run 라우트 |
| **blocked 카드 + 댓글로 해제** | `tasks.blocked_reason`, 사람 댓글은 "지시"로 최우선, 실행 결과는 에이전트 댓글로 자동 기록 | `lib/run-loop.ts` |
| **서킷브레이커** | 사람 개입 없이 연속 3회 실패·막힘 → 409, 사용자 댓글이 리셋, `force` 로 무시 | `lib/run-loop.ts` |
| **planner** (목표 → 카드) | `POST /api/projects/:id/plan` 제안 → 사람이 수정 → `apply` 로 카드+하위 작업 생성 | `lib/planner.ts` |
| 프롬프트 캐싱 | system 블록 + 마지막 user 블록 `cache_control` — 검증에서 48% 절감 | `lib/claude.ts` |

Hermes 에서 **의도적으로 가져오지 않은 것**: 임베딩 기반 검색(FTS5 로 충분하고 D1 에서 단순), 스킬 마켓/플러그인 로더, 다중 프로세스 워커 풀(Workers 환경엔 맞지 않음).

## 2. AI-Native SDLC 플레이북에서 가져온 것

| 플레이북 개념 | Orbit 구현 | 위치 |
|---|---|---|
| **산출물 체인** (`intent.md`→`spec.md`→`plan.md`→증거→PR→인시던트→`intent.md`) | 목표 → 계획 제안(사람 검토) → 카드 → 실행(proof) → 검토 댓글 → 사람 승인 → 관제 진단 카드로 재진입. 커밋 체인 대신 `agent_runs.metadata` + `task_comments` + `recall_docs` 가 감사 흔적 | 전체 |
| **완료 = 검증 포함** | `complete_task.proof`(1~5개), 없으면 댓글에 `⚠️ 검증 근거 없음`, 메타데이터 `unverified` | run 라우트 |
| **양방향 검토 / `REVIEW.md`** | 실행이 검토 열에 오르면 **작성자가 아닌 에이전트**(QA 우선)가 버그·스펙·정책·근거 네 패스로 검토, Important/Nit(5개 상한), `tasks.review_verdict`. **발견은 상태를 바꾸지 않고** 승인은 사람. 정책은 `검토 정책` 스킬로 교체 가능 | `lib/reviewer.ts`, `/api/tasks/:id/review` |
| **연속 eval** | `npm run evals` — 실제 있었던 실행 10건을 케이스로, 결정적 검사 + 선택적 LLM 판정, 결과 JSON, 통과율 미달 시 종료 코드 1 | `scripts/evals.mjs`, `evals/` |
| **Hook 결정 로그** | `gate_events` — 서킷브레이커·회상 상한·위협 스캔·승인·관제 검사 결과 | `lib/gates.ts` |
| **관제 밴드 → 진단 재진입** | 다섯 지표(실패·막힘, 근거 없음, 검토 수정 요청, 게이트 차단, 실행당 비용)를 오늘 vs 14일 기준선(±σ)으로 판정, 2σ 이상이면 매니저에게 `진단` 카드(증거 포함), 실행마다 최대 1시간에 한 번 | `lib/health.ts`, `/api/health` |
| **물어보기형 Hook** | `approvals` 큐 — 실행당 카드 4번째부터, 전역 스킬 저장은 사람 승인 후 실행 | `lib/approvals.ts`, `/api/approvals` |
| **Skill(권고) 뒤에 Hook(결정)** | 프롬프트 규칙(권고) 뒤에 서버 게이트(차단/승인) — 예: "검증 없이 완료 금지"(규칙) + 검토자의 근거 패스(결정) | — |
| 마이그레이션 운영 | 저널 기반 러너 `db:migrate:check` 로 빈 DB 전체 적용 검증 → 빌드 → Sites 배포 | `scripts/migrate.mjs` |

플레이북에서 **가져오지 않은 것**: 관리(admin) 설정 계층과 조직 단위 정책 강제(개인 사용 전제), git 중심 산출물(D1 이 진실), Claude Security/Claude Tag 같은 별도 제품 연동.

## 3. 검증에서 확인된 것 (실제 실행 기준)

- 회상: Bolt·Lint·Mira 가 형제 업무 요약을 정확히 인용, 한국어 2자어("온보딩") 바이그램 매칭, 상한 4·5번째 호출은 거부 후 정상 종료.
- 기억: 프로젝트 기억(raw `db.prepare` 제약)이 실행 요약에 근거로 등장. 잘린 실행에서 리뷰 모델이 사실을 지어내려던 사고 → 전사 200자 미만 건너뛰기·프롬프트 강화로 재발 방지(eval 05).
- 압축: 26개 메시지 → 16개 흡수, 8개 결정 사항 전부 보존, 이후 질문에 요약+회상으로 정확히 답변.
- 스킬: "릴리스 노트 작성" 스킬을 읽고 절차대로 산출, 에이전트가 새 스킬 저장.
- 실행 루프: 서킷브레이커 409 → 사용자 댓글 → 7초 만에 댓글 지시대로 완료. blocked 사유 저장·댓글.
- 검토: 파일을 못 본 채 completed 로 보고한 결과를 검토자가 스펙·근거·버그 Important 3건으로 잡아 `changes_requested`.
- 관제: 5일 기준선 위에 막힘 5건 → +3σ → 진단 카드 → 매니저가 recall 로 원문 대조해 "5건은 하나의 원인(계정 미확보, 인테이크 문제), 1건은 검증 누락"으로 갈라 후속 카드 4장·필드·스킬·기억 생성.
- 승인 큐: 카드 5장+전역 스킬 지시 → 3장 생성, 2장·스킬 큐 → 승인/거절/중복 409.
- eval: 10/10 통과. 첫 실행이 잡은 실제 회귀: 계획 분해 `max_tokens`(4,000→8,000).

비용: 프롬프트 캐싱으로 실행당 캐시 읽기 비율이 늘어 48% 절감. 보조 호출(기억 리뷰·압축)은 Haiku, 검토·계획은 기본 모델.

## 4. 알려진 제약과 기술 부채

1. **에이전트 참조가 이름 기준**(`tasks.owner`): 다른 세션이 `agents.project_id`·`is_manager`·`role_key` 로 프로젝트 귀속 구조를 도입했으므로 planner·reviewer·approvals 의 조회를 id 기준으로 맞춰야 합니다.
2. **매니저 실행이 `complete_task` 없이 끝나는 경우**: 진단 카드 검증에서 관찰. 매니저 규칙에 마지막 호출 강조 필요(`lib/manager-tools.ts`, 다른 세션 영역).
3. **스케줄러 없음**: 관제 검사는 "실행이 끝날 때" 트리거라 실행이 없으면 검사도 없습니다. Sites 에 cron 이 생기면 `POST /api/health` 를 붙이면 됩니다.
4. **UI 미반영 항목**: 기억 탭(§7), blocked 배지·409 처리(§8), 요약 배너(§9), 스킬 탭(§10), 검토 배지·버튼(§11), 실행 건강 카드·진단 배너(§13), 승인함(§14). 미커밋 UI 파일 3개.
5. **테스트 코드 부재**: 서버 로직은 eval(통합)로만 덮입니다. 순수 함수(`koreanBigrams`, `band`, `parseReview`, `formatRunComment`)는 단위 테스트가 싸게 붙습니다.
6. 잔재: `app/chatgpt-auth.ts`(미사용), `local_seedy` 사용자로 남은 시드 데이터.

## 5. 향후 계획

우선순위는 "사람이 실제로 쓰는 화면에 도달하는 것"과 "안전망을 유지하는 것" 순입니다.

### 단계 A — 화면에 닿게 하기 (UI 세션 · 1~2일) — ✅ 완료 (2026-09-05)
- ✅ 승인함(`components/approvals-view.tsx`): 카드·전역 스킬 승인 + 프로젝트 기억 pending 통합, 사이드바 배지(`fetchInboxCount`, 1분 주기).
- ✅ 검토 열(`components/review-panel.tsx`): 카드·상세의 `reviewVerdict`/`blockedReason` 배지, 🔍 댓글 `<details>` 접힘(Important 강조), [실행/수정 반영 재실행] [다시 검토], 서킷브레이커 409 배너 + '그래도 실행'.
- ✅ 대쉬보드 "실행 건강" 카드(`components/health-card.tsx`): 지표 5개 σ 등급 칩, 열린 진단 카드 배너, 7일 게이트 칩, '지금 검사'.
- ✅ 기억·스킬 탭(`components/memory-view.tsx`, `components/skills-view.tsx`): 그룹별 예산 막대, 추가·수정·삭제, pending 승인.
- 보류: 대화 요약 배너(`GET /api/chat/summary` 서버 추가 필요) — 단계 B 로 이관.
- 공통 스타일은 `components/governance.css`(`gov-*`), 색은 `globals.css` 의 `--c-*` 토큰만 사용.

### 단계 B — 구조 정리 (서버 · 1일) — 대부분 완료 (2026-09-05)
- ✅ 대화 요약 배너: `GET /api/chat` 이 `summary`(chat_summaries)를 함께 돌려주고 요약 이후 메시지만 원문으로 보냅니다. ChatView 상단에 접힌 `.chat-summary` 배너.
- ✅ 매니저 규칙 보강: complete_task 의 summary/proof/next_actions 채우는 법과 blocked 조건을 명시 (`lib/run-task.ts`).
- ✅ `app/chatgpt-auth.ts` 삭제 (참조 없음).
- ✅ 단위 테스트 `tests/*.test.ts` 28개 (vitest): 관제 밴드 σ 등급, 기억 위협 스캔, 한글 바이그램·FTS 쿼리, 실행·검토 댓글 포맷, 단가, 압축 트리거, 스킬 인덱스.
  - `npm test` = `vitest run`, `npm run check` = lint → test → `db:migrate:check` (배포 전 체크리스트).
- 보류: `agent_id` 참조 전환 — `tasks.owner`(이름) 를 읽는 곳이 lib/app 에 16개 파일·100여 곳이라 별도 마이그레이션(컬럼 추가 → 이중 기록 → 읽기 전환 → 이름 컬럼 제거) 으로 단계 D 뒤에 진행.

### 단계 C — 배포 (반나절)
- `npm run db:migrate:check` → `npm run build` → Sites 배포. 원격 D1 은 플랫폼이 저널 순서(0000~0017)로 적용.
- 배포 후 첫 주는 관제 밴드 기준선이 쌓이는 기간 — `insufficient` 가 정상. 사용량 화면으로 비용 추이 확인.

### 단계 D — 루프 강화 (필요할 때)
- eval 확장: 검토자의 정확도(잘된 결과를 approve 하는지), 매니저 채용·위임 흐름, 대화 압축 후 사실 보존을 judge 로.
- 진단 카드 자동 실행: 3σ(act)면 매니저 실행까지 자동 — 단 승인 큐를 거치는 행동만 허용.
- 스킬 정리 루프: 사용 횟수 0 인 스킬을 30일 뒤 정리 제안, 검토 정책 스킬 템플릿 제공.
- 관제 지표 추가: 사용자가 검토에서 승인한 비율(에이전트 품질의 최종 지표), 카드당 재실행 횟수.

### 단계 E — 확장 (선택)
- Sites cron 이 생기면 관제·기억 리뷰를 스케줄로 이동.
- 프로젝트 간 지식 공유: 전역 스킬·사용자 기억은 이미 있으니, 프로젝트 요약을 다른 프로젝트 매니저가 회상할 수 있게 `recall` 의 `all_projects` 를 매니저에게만 허용.
- 다중 사용자: `getCurrentUser` 를 Sites 로그인(`oai-authenticated-user-id`)으로 바꾸면 스키마는 그대로 동작(모든 테이블이 `user_id` 로 분리됨).

---

### 부록 — 데이터 모델 한눈에

`projects` · `agents`(project_id, is_manager, role_key) · `project_agents` · `tasks`(priority, description, blocked_reason, review_verdict) · `subtasks` · `task_comments`(사람/에이전트) · `project_fields`/`task_field_values` · `project_folders` · `agent_runs`(outcome, summary, metadata: proof/unverified/toolCalls/skills) · `chat_messages` · `chat_summaries` · `recall_docs`+`recall_fts` · `memories` · `skills` · `gate_events` · `approvals` · `usage_events`(agent_run/chat/memory_review/plan/compaction/review)
