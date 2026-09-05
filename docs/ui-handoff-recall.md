# UI 세션 인수인계 — 회상(recall)·구조화 완료 보고를 화면에 얹기

> 작성: 서버 담당 세션 · 2026-09-04
> 서버 쪽(툴 루프, FTS5 회상 인덱스, 워커 컨텍스트, `complete_task`)은 적용·검증 완료. 아래는 **UI 파일에서만** 반영하면 되는 변경입니다.
> 이 문서의 대상 파일: `app/page.tsx`, `app/globals.css`, `components/workspace-views.tsx`, `app/api/chat/stream/route.ts`
> 서버 세션은 이 파일들을 더 이상 수정하지 않습니다.

## 1. 서버에서 바뀐 계약

### `POST /api/agents/run` 응답

```ts
{
  runId: string; taskId: string;
  status: '검토' | '대기';          // blocked 면 '대기'로 되돌아감
  output: string;                   // 산출물 본문 (마크다운)
  summary: string;                  // 2~4문장 요약 (complete_task 가 남김)
  blocked: boolean;
  blockedReason: string | null;     // 진행 불가 사유
  nextActions: string[];            // 후속 업무 제안 (0~5)
  iterations: number;               // 툴 루프 반복 수
  toolCalls: string[];              // 예: ['recall_history','recall_history','complete_task']
}
```

### `GET /api/tasks` / `PATCH /api/tasks/[id]` 의 task 객체

`summary: string | null` 필드가 추가됐습니다. 상태를 '검토' 밖으로 되돌리면 `result`와 함께 `null`이 됩니다.

### 회상 인덱스

- 대화·실행 결과·업무 카드는 자동으로 `recall_docs`에 색인됩니다 (`/api/chat` POST, `/api/agents/run`, `/api/tasks` 생성·수정·삭제).
- **`/api/chat/stream` 은 아직 색인하지 않습니다** — §4 참고.
- 디버깅용: `GET /api/recall?q=검색어` (모델이 쓰는 것과 같은 엔진), `POST /api/recall` (전체 재색인).

## 2. `app/page.tsx` 에 얹을 것

```tsx
// Task 타입
type Task = { …; result?: string | null; summary?: string | null; projectId?: string | null };

// runAgent() 안, 응답 처리
const data = await response.json() as {
  output?: string; summary?: string; status?: TaskStatus; blocked?: boolean; toolCalls?: string[]; error?: string;
};
if (!response.ok || !data.output) throw new Error(data.error || '에이전트 실행에 실패했습니다.');
const completed: Task = { ...task, status: data.status ?? '검토', result: data.output, summary: data.summary ?? null };
setTasks((current) => current.map((item) => item.id === task.id ? completed : item));
setSelectedResult(completed);
const recalled = (data.toolCalls ?? []).filter((name) => name === 'recall_history').length;
flash(data.blocked
  ? `${task.owner}가 진행 불가로 보고했습니다. 결과에서 필요한 정보를 확인하세요.`
  : `${task.owner}가 업무를 완료했습니다.${recalled ? ` (과거 기록 ${recalled}회 참조)` : ''}`);

// 결과 다이얼로그 — 요약을 본문 위에
<DialogHeader>…</DialogHeader>
{selectedResult?.summary && <div className="agent-summary"><span>요약</span>{selectedResult.summary}</div>}
<div className="agent-result"><Markdown text={selectedResult?.result || ''} /></div>
```

`blocked` 일 때 `output` 은 `⛔ 진행 불가: <사유>` 로 시작하므로 별도 처리 없이도 보입니다. 카드에 `summary` 를 한 줄로 노출하면 보드만 봐도 상황이 읽힙니다 (선택).

## 3. `app/globals.css` 에 추가할 블록

```css
/* --- 실행 결과 요약 --- */
.agent-summary{margin:4px 0 10px;padding:12px 14px;border-radius:10px;background:#f4f2ff;border:1px solid #e3ddff;color:#3b3560;font-size:12px;line-height:1.7;white-space:pre-wrap}
.agent-summary span{display:block;margin-bottom:4px;color:#7561ed;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
```

## 4. `app/api/chat/stream/route.ts` — 회상 툴 붙이기 (핵심)

서버가 공용 헬퍼 `lib/chat-agent.ts` 를 만들어 두었습니다. 스트리밍 라우트는 다음 세 군데만 바꾸면 됩니다.

```ts
import { streamClaudeAgent } from '@/lib/claude';                                  // streamClaude 대신
import { chatMessageIndex, prepareChatTurn, type ChatContext } from '@/lib/chat-agent';

// (1) context 조회는 그대로, 타입만 ChatContext 로
const context = await db.prepare(`…`).bind(projectId, agentId, user.userId).first<ChatContext>();

// (2) 사용자 메시지 INSERT 를 batch 로 바꾸고 색인을 함께
await db.batch([
  db.prepare('INSERT INTO chat_messages (…) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(…),
  chatMessageIndex(db, { userId: user.userId, messageId: userMessage.id, projectId, agentName: context.agentName, role: 'user', content: message, createdAt: userMessage.createdAt }),
]);

// (3) history/system 직접 조립 대신 헬퍼 사용 + streamClaudeAgent
const chat = await prepareChatTurn(db, user.userId, { projectId, agentId, context });
const result = await streamClaudeAgent({
  apiKey, model, maxTokens: 2500,
  system: chat.system, messages: chat.messages,
  tools: chat.tools, executeTool: chat.executeTool, maxIterations: 4,
  onDelta: (text) => { send({ type: 'delta', text }); },
  onToolCall: (name) => { send({ type: 'tool', name }); },   // 새 이벤트: "과거 기록 검색 중…" 표시용
});
// assistant 저장 batch 에도 색인 추가
chatMessageIndex(db, { userId: user.userId, messageId: assistantMessage.id, projectId, agentName: context.agentName, role: 'assistant', content: assistantMessage.content, createdAt: assistantMessage.createdAt }),
```

주의 — 스트리밍에서는 툴 호출 전의 짧은 발화("찾아보겠습니다…")도 delta 로 흘러갑니다. `result.text` 는 모든 턴의 텍스트를 이어 붙인 값이므로 저장은 그대로 하면 됩니다. NDJSON 이벤트 하나가 늘어납니다:

```
{"type":"tool","name":"recall_history"}
```

ChatView 에서 이 이벤트를 받으면 말풍선 위에 "🔎 과거 기록 검색 중…" 같은 상태를 잠깐 보여주면 좋습니다.

> **2026-09-05 갱신 — §4 는 서버 쪽에서 적용 완료.** `app/api/chat/stream/route.ts` 가 이제 `prepareChatTurn` + `streamClaudeAgent` 를 쓰므로 회상·기억·압축 요약이 스트리밍에도 동일하게 붙습니다. UI 는 NDJSON 에 새로 추가된 `{"type":"tool","name":"recall_history"|"memory"}` 이벤트만 (무시하거나) 상태 표시로 처리하면 됩니다. 아울러 Opus 처럼 thinking 블록을 내는 모델에서 스트리밍 툴 루프가 `each thinking block must contain thinking` 로 실패하던 문제를 `lib/claude.ts` 파서에서 고쳤습니다.

## 5. `components/workspace-views.tsx`

프로젝트 상세 화면의 `runAgent`(178행 근처)도 §2 와 같은 응답 처리로 맞춰 주세요 — `status`·`summary`·`blocked` 반영. 안 그러면 blocked 인 업무가 '검토'로 표시됩니다.

## 6. 검증에 쓸 수 있는 실제 데이터

프로젝트 "AI 협업 보드 MVP" 에 서버 검증용 업무 두 개가 **검토** 상태로 남아 있습니다 (삭제해도 됩니다):

- Bolt · "Cloudflare D1 로컬/원격 마이그레이션 적용 절차를 5단계로 정리" — summary 387자, 회상 3회 후 완료
- Lint · "Bolt가 정리한 D1 마이그레이션 절차를 바탕으로 배포 전 QA 체크리스트 작성" — summary 336자, 본문 2,666자, 회상 4회. Bolt 의 5단계를 정확히 인용함

대화 탭에서 Project Lead 에게 "Bolt와 Lint가 D1 마이그레이션 관련해서 무엇을 정리했는지 요약해줘" 라고 물으면(비스트리밍 `/api/chat` 기준) 회상 2회 후 정확히 답합니다 — 스트리밍 라우트에 §4 를 적용하면 같은 동작이 됩니다.

## 7. 기억 관리 탭 (3단계 · 선언적 기억)

서버는 Hermes 의 MEMORY.md / USER.md 에 해당하는 **선언적 기억**을 `memories` 테이블(마이그레이션 `0008_memories`)로 갖습니다. 세 스코프가 있고 각각 문자 예산이 있습니다:

| scope | 뜻 | 예산 | 누가 쓰나 |
|---|---|---|---|
| `user` | 사용자 프로필(역할·선호·일하는 방식) | 1,400자 | 사용자, 에이전트 |
| `project` | 프로젝트의 확정된 결정·제약·환경 | 2,200자 | 사용자는 바로 반영, **에이전트가 쓰면 `pending`(승인 대기)** |
| `agent` | 에이전트 개인 노트(교훈, 환경 사실) | 1,500자 | 에이전트 |

`active` 엔트리만 실행/대화의 시스템 프롬프트에 주입됩니다. 에이전트는 실행·대화 중 `memory` 툴로 직접 쓰기도 하고, 실행이 끝난 뒤(또는 대화 10턴마다) 저가 모델(`claude-haiku-4-5`, `.env` `ANTHROPIC_REVIEW_MODEL` 로 변경)이 백그라운드로 "남길 것이 있나"를 한 번 더 검토합니다. 이 리뷰 비용은 사용량 화면에 `기억 리뷰` 종류로 잡힙니다.

### API

```
GET    /api/memory                    → { groups: [...], limits, pendingTotal }
GET    /api/memory?scope=project      → 그 스코프만 (scopeId= 로 특정 프로젝트/에이전트만)
POST   /api/memory                    { scope, scopeId?, content }   → 201, 사용자 직접 추가 (즉시 active)
PATCH  /api/memory/:id                { status: 'active' }           → pending 승인
PATCH  /api/memory/:id                { content }                    → 문구 수정 (위협 스캔·예산 검사 동일)
DELETE /api/memory/:id                                               → 삭제 / pending 거절
```

`groups[]` 항목:

```ts
{
  scope: 'user' | 'project' | 'agent',
  scopeId: string | null,           // user 는 null
  scopeName: string | null,         // 프로젝트/에이전트 이름 (삭제된 경우 null)
  label: string,                    // "프로젝트 기억 · Orbit"
  used: number, limit: number,      // active 기준 문자 사용량 / 예산
  pendingCount: number,
  entries: [{ id, content, status: 'active'|'pending', createdBy, createdAt, updatedAt }]
}
```

오류는 `{ error }` 로 오고 400 입니다. 대표 문구: "프로젝트 기억 예산 초과 (2,310/2,200자)…", "저장이 거부되었습니다: 프롬프트 인젝션 문구" (지시문·API 키·비밀번호 패턴은 스캔에서 거부).

### 제안 UI

- 사이드 메뉴에 **기억** 탭. 상단에 `pendingTotal` 배지(승인 대기 n건).
- 그룹별 카드: 제목 = `label`, 우측에 `used/limit` 진행 막대. 80% 넘으면 경고색 — 에이전트가 예산 초과로 저장 실패하기 시작하는 지점입니다.
- 엔트리 행: 내용, `createdBy`(사용자 / 에이전트 이름), 상대 시각. `pending` 이면 노란 배경 + [승인] [거절] 버튼 → `PATCH {status:'active'}` / `DELETE`.
- 사용자 직접 추가: 그룹 카드 하단 "기억 추가" 입력 → `POST`. `project`/`agent` 는 scopeId 를 카드에서 가져옵니다.
- 인라인 편집 → `PATCH {content}`.
- 실행 결과 카드(§2)에서 `metadata.memoryWrites > 0` 이면 "🧠 기억 n건 저장" 같은 표시를 붙이면 좋습니다. 대화에서는 `toolCalls` 에 `memory` 가 있으면 동일.

### 승인 게이트를 두는 이유

에이전트가 project 스코프에 쓴 것은 프롬프트에 바로 주입되지 않고 사람이 승인해야 합니다. 검증 중 실제로 잘린 실행(본문 없음)에서 리뷰 모델이 업무 제목만 보고 "로그 구조 결정"을 지어내 저장하려 한 사례가 있었습니다 — 지금은 서버에서 전사가 200자 미만이면 리뷰를 건너뛰고 프롬프트도 강화했지만, 잘못된 '결정'이 모든 에이전트에게 주입되는 사고는 UI 의 승인 단계가 마지막 방어선입니다.

## 8. 실행 루프 (4단계 · blocked · 댓글 · 서킷브레이커 · 목표 분해)

### 서버가 새로 하는 일

- **카드 컨텍스트**: 실행 시 카드 본문(description) · 하위 작업 · 최근 댓글 10개 · 직전 막힘 사유가 시스템 프롬프트에 들어갑니다. 사람(👤) 댓글은 "지시"로 취급되어 이전 시도의 결론보다 우선합니다. → **댓글이 곧 에이전트에게 말을 거는 채널**입니다. 상세 패널의 댓글 입력을 "에이전트에게 지시" 로 안내해 주세요.
- **실행 결과 댓글**: 실행이 끝나면 담당 에이전트 이름으로 댓글이 자동으로 달립니다 (`author_kind='agent'`): `✅ 요약`, `⛔ 진행 불가 — 사유`, `⚠️ 실행 실패 — 메시지`. 만든 후속 카드와 "사람이 판단할 것"(next_actions)도 같은 댓글에 붙습니다.
- **`tasks.blocked_reason`**: blocked 로 끝나면 채워지고, 다음 실행이 성공하거나 사람이 `/api/tasks/:id` PATCH 로 status 를 바꾸면 NULL. `/api/tasks`, `/api/tasks/:id`, `/api/tasks/:id/detail` 응답에 `blockedReason` 필드로 나옵니다.
- **서킷브레이커**: 같은 카드가 사람 개입 없이 연속 3회 실패/막힘이면 `POST /api/agents/run` 이 **409** 를 돌려줍니다:
  ```json
  { "error": "이 업무는 연속 3회 실패하거나 막혀 자동 실행을 멈췄습니다. …", "circuitBreaker": { "tripped": true, "consecutive": 3, "limit": 3, "lastHumanInputAt": null } }
  ```
  사용자 댓글(`author_kind='user'`)이 달리면 카운터가 리셋됩니다. `{ taskId, force: true }` 로 무시하고 실행할 수도 있습니다.

### 제안 UI

- 카드에 `blockedReason` 이 있으면 **⛔ 막힘** 배지 (대기 열에 그대로 있음). 호버/상세에서 사유 표시, 바로 아래 "댓글로 답하기" 입력.
- 실행 버튼이 409 를 받으면 사유를 보여주고 [댓글 남기기] [그래도 실행(force)] 두 버튼.
- 상세 패널 댓글에서 `authorKind === 'agent'` 는 에이전트 색으로, `✅/⛔/⚠️` 로 시작하는 댓글은 실행 로그처럼 살짝 구분.

### 목표 자동 분해 (`POST /api/projects/:id/plan`)

두 단계입니다 — 제안은 DB 를 건드리지 않고, 사람이 보고 고친 뒤 apply 로 만듭니다.

```
POST /api/projects/:id/plan  { goal: "…", maxTasks?: 6 }
→ { proposal: { rationale, tasks: [{ title, description, owner, label, dueInDays, subtasks[] }] }, goal, usage }

POST /api/projects/:id/plan  { apply: true, tasks: [ …위 tasks 를 수정한 것… ] }
→ 201 { created: [{ id, title, owner }] }     (카드는 '대기' 열, subtasks 도 함께 생성)
```

제안은 프로젝트에 배정된 에이전트(없으면 전체)의 역할, 보드에 이미 있는 업무(중복 방지), 최근 실행 요약, 프로젝트 기억을 보고 만듭니다. 검증에서 "실행 로그 뷰어 추가" 목표 → 리서치(Mira) → 설계(Nori) → 구현(Bolt) → QA(Lint) 4장 + 하위 작업 16개가 나왔고, 프로젝트 기억(raw db.prepare 제약)이 구현 카드 설명에 반영됐습니다. 비용은 사용량 화면 `계획 수립` 종류.

제안 UI: 프로젝트 화면에 "목표로 카드 만들기" → 목표 입력 → 제안 목록을 편집 가능한 표(제목/담당/분류/마감/하위작업)로 보여주고 → [카드 만들기] 가 apply.

## 9. 대화 압축 (5단계)

대화(프로젝트×에이전트)가 길어지면 서버가 앞부분을 저가 모델로 요약해 `chat_summaries`(마이그레이션 `0010`)에 대화당 1행으로 누적 보관합니다.

- 트리거: 요약 이후 메시지가 **24개**를 넘으면 응답 뒤 백그라운드로 실행. 최근 **12개**는 원문으로 남기고 나머지를 요약에 흡수(사용자 턴 경계에서 자름).
- 프롬프트: `## 이전 대화 요약 (N개 메시지, 날짜~날짜)` 블록 + 요약 이후 메시지 원문. 요약은 3,000자 예산.
- 원문은 지우지 않습니다. `recall_docs` 에서 `compacted=1` 로 표시되어 `recall_history` 로 계속 검색되고, 요약 자체도 `kind='summary'` 로 색인됩니다.
- 비용은 사용량 화면 `대화 압축` 종류. `/api/chat` 응답에 `compacted: true|false` 가 붙습니다(요약이 적용된 대화인지).

검증: 26개 메시지를 넣고 27번째를 보내자 16개가 요약으로 흡수됐고(8개 결정 사항 전부 보존, 201자), 이후 "베타 테스터가 몇 명이라고 했지?" 에 요약과 회상으로 정확히 답했습니다.

### 제안 UI

- 대화 상단에 "이전 대화 N개가 요약되었습니다" 접힘 배너 → 펼치면 요약 본문. 데이터는 아직 전용 API 가 없으니 필요하면 `GET /api/chat/summary?projectId&agentId` 를 요청해 주세요(서버 세션이 바로 추가 가능).
- 요약 이전 메시지도 스크롤로는 계속 보이게 두세요(원문은 그대로 있음). 요약은 "에이전트가 기억하는 범위"를 보여주는 용도입니다.

## 10. 스킬 (6단계 · 절차적 기억)

기억(memory)이 "무엇이 사실인가"라면 스킬은 "이런 일은 이렇게 한다"입니다. `skills` 테이블(마이그레이션 `0011`), 스코프는 `global`(모든 프로젝트) / `project`.

- 실행·대화 프롬프트에는 **인덱스(이름 + 언제 쓰는지)** 만 들어가고, 에이전트가 맞는 스킬을 보면 `use_skill` 로 본문을 읽습니다 (점진적 공개). 본문 6,000자, 스코프당 40개.
- 에이전트는 실행 중 `save_skill` 로 절차를 남기거나 갱신할 수 있습니다 (실행당 새 스킬 1개, 기억과 같은 위협 스캔). 대화에서는 읽기만.
- 실행 메타데이터에 `skillsUsed: string[]`, `skillsSaved: string[]` 가 붙습니다.

검증: 사용자가 만든 "릴리스 노트 작성" 스킬을 Nori 가 `use_skill` 로 읽고 절차대로(4묶음 분류·사용자 관점 문구·두 문장 요약·업그레이드 섹션) 결과를 냈고(uses=1), Bolt 는 카드에 적힌 절차를 "로컬 D1 마이그레이션 적용" 스킬로 저장했습니다.

### API

```
GET    /api/skills?projectId=      → { skills: [{ id, scope, projectId, projectName, name, description, body, createdBy, uses, createdAt, updatedAt }], limits }
POST   /api/skills                  { name, description, body, scope?: 'global'|'project', projectId? }  → 201 { id, action:'created' } / 200 { action:'updated' }
PATCH  /api/skills/:id              { name?, description?, body? }
DELETE /api/skills/:id
```

### 제안 UI

- 사이드 메뉴 **스킬** 탭(기억 탭 옆). 목록은 전역 / 프로젝트별 그룹, 각 행에 이름·설명·`createdBy`(사용자/에이전트 이름)·`uses` 횟수. 클릭하면 본문(마크다운) 편집.
- 실행 결과 카드에 `skillsUsed` 가 있으면 "📘 스킬 사용: 릴리스 노트 작성", `skillsSaved` 가 있으면 "📘 스킬 저장" 배지.
- 에이전트가 만든 스킬(`createdBy !== 'user'`)은 살짝 다른 색으로 — 사람이 훑어보고 다듬으라는 신호.

## 11. 검토 에이전트와 검증 근거 (AI-Native SDLC 플레이북 적용 1·3번)

### 서버가 새로 하는 일

- **`complete_task.proof`**: 에이전트가 완료 보고 때 "무엇으로 검증했는지"(확인한 파일·실행한 명령·출처·검토한 댓글)를 1~5개 제출합니다. 실행 댓글에 `검증 근거:` 목록으로 붙고, 없으면 `⚠️ 검증 근거 없음`. 메타데이터에 `proof: string[]`, `unverified: boolean`.
- **자동 검토**: 실행이 '검토' 열로 가면 백그라운드에서 **작성자가 아닌 다른 에이전트**(프로젝트 팀의 QA → 팀의 다른 에이전트 → 그 외)가 네 패스(버그·스펙·정책·근거)로 검토해 댓글 `🔍 검토 — 승인 가능 | 수정 요청 (Important n · Nit m)` 을 남기고 `tasks.review_verdict`('approve' | 'changes_requested')를 기록합니다(마이그레이션 `0015`). Important 가 하나라도 있으면 verdict 는 규칙상 changes_requested. Nit 은 카드당 5개까지.
- **발견은 상태를 바꾸지 않습니다.** 카드는 '검토' 열에 그대로 있고 승인은 사람이 합니다. 다시 실행하면 검토 댓글의 Important 가 지시로 전달됩니다(run-loop 가 🔍 댓글을 "반드시 해소"로 안내).
- 검토 정책은 스킬 이름 **`검토 정책`**(프로젝트 또는 전역)이 있으면 그 본문을 씁니다 — 플레이북의 `REVIEW.md`. 없으면 기본 정책(lib/reviewer.ts `DEFAULT_REVIEW_POLICY`).
- 수동 재검토: `POST /api/tasks/:id/review` → `{ review: { reviewer, verdict, summary, findings[{severity, pass, message, location?}], hiddenNits } }`. 비용은 사용량 `결과 검토` 종류.
- `/api/tasks`, `/api/tasks/:id`, `/api/tasks/:id/detail` 응답에 `reviewVerdict` 추가. 사람이 상태를 옮기면 NULL 로 초기화.

### 제안 UI

- 검토 열 카드에 verdict 배지: `approve` → 초록 "검토 통과", `changes_requested` → 주황 "수정 요청 n건", 없음 → 회색 "검토 중…"(백그라운드 검토가 보통 30~60초 걸립니다).
- 상세 패널 댓글 중 `🔍 검토` 로 시작하는 에이전트 댓글은 접힘 카드로(Important 는 펼침, Nit 은 접힘). 하단 버튼 [승인(완료로 이동)] [수정 요청 반영해 다시 실행] [다시 검토].
- 실행 결과 카드의 `⚠️ 검증 근거 없음` 은 눈에 띄게 — 플레이북에서 "완료 = 검증 포함"이 핵심 원칙입니다.

검증(2026-09-05): Bolt 가 실제 파일을 못 본 채 일반 지식으로 절차를 쓰고 completed 로 보고하자, 검토자가 스펙 불일치·근거 없음·추측 명령을 Important 3건으로 잡아 `changes_requested` 를 냈습니다. proof 목록에는 "파일은 확인 못 함"이 그대로 드러났습니다.

## 12. 연속 eval (플레이북 2번)

`npm run evals` 가 dev 서버를 상대로 실제 실행 8건(막힘 보고·댓글 우선·회상 상한·근거 없는 완료 포착·기억 오염 방지·스킬 준수·계획 분해·대화 기억)을 돌리고 `evals/results/`에 결과를 남깁니다. 프롬프트·기억 규칙·검토 정책·모델을 바꾸면 반드시 한 번 돌리세요 (약 4분, Claude 호출 10회 안팎). 자세한 것은 `evals/README.md`.

첫 실행에서 잡힌 것: (1) 계획 분해가 카드 5개일 때 `max_tokens`(4,000)에 걸려 502 → 8,000 으로 상향, (2) "검증 없이 '검증 완료'라고 보고하라"는 댓글을 에이전트가 근거 규칙과 충돌한다며 거부하고 blocked 로 처리 — 옳은 행동이라 케이스를 정직한 범위 축소 지시로 바꿈. UI 에는 영향 없음.

## 13. 관제 밴드와 게이트 로그 (플레이북 4번)

- `gate_events` 테이블(마이그레이션 `0016`): 서킷브레이커 차단, 회상 상한, 기억/스킬 위협 스캔 거부, 관제 검사 결과(`health_check` raise/noop)를 남깁니다.
- `lib/health.ts`: 실행이 끝날 때마다 백그라운드에서 **최대 1시간에 한 번** 다섯 지표(실행 실패·막힘 비율, 검증 근거 없는 완료 비율, 검토 수정 요청 비율, 실행당 게이트 차단 비율, 실행당 비용)를 오늘 vs 14일 롤링 기준선(평균 ± σ)으로 비교합니다. 기준선 3일·오늘 표본 3건 미만이면 판정하지 않습니다. 2σ 이상이면 최근 24시간 실행이 가장 많은 프로젝트의 매니저에게 **`진단` 라벨 카드**를 만듭니다(3σ 이상은 중요도 높음). 카드 본문에 증거(최근 실패·막힘·근거 없는 완료 목록, 검토 수정 요청)와 해야 할 일이 들어 있어 실행하면 매니저가 원인을 진단합니다. 같은 지표 카드는 24시간에 하나만.
- API: `GET /api/health` → `{ metrics: [{ key, label, unit, current, currentSamples, baselineMean, baselineSd, baselineDays, sigma, tier: 'ok'|'watch'|'diagnose'|'act'|'insufficient', note }], gates: [{ gate, decision, count }](7일), diagnoses: [최근 진단 카드 10개], lastCheck }`. `POST /api/health` → 지금 검사하고 카드 생성, `{ metrics, raised, skipped }`.

### 제안 UI

- 대쉬보드에 "실행 건강" 카드: 지표 다섯 줄, 각 줄에 tier 색(ok 회색 / watch 노랑 / diagnose 주황 / act 빨강)과 `note`. `insufficient` 는 "데이터 쌓는 중"으로.
- 게이트 차단 요약: `gates` 를 "서킷브레이커 n · 회상 상한 n · 위협 스캔 n" 칩으로.
- 열린 진단 카드가 있으면 배너 "진단 카드 n개 대기 중 → 보드에서 실행". 보드에서 `label === '진단'` 카드는 아이콘으로 구분.
- 수동 검사 버튼 → `POST /api/health`.

검증(2026-09-05): 5일간 성공만 있던 기준선에 오늘 막힘 5건을 넣자 실패율 83%·+3σ 로 판정되어 매니저에게 "진단: 실행 실패·막힘 비율 +3.0σ"(중요도 높음) 카드가 증거와 함께 만들어졌고, 두 번째 호출은 24시간 중복으로 건너뛰었습니다.
