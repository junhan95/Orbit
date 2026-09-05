/**
 * 선언적 기억 — Hermes 의 MEMORY.md / USER.md 를 D1 로 옮긴 것.
 *
 * 설계 원칙 (docs/hermes-analysis.md §2, §7 3단계):
 * - 항상 주입되는 기억은 작게(문자 예산), 에이전트가 직접 큐레이션한다.
 * - 예산이 넘치면 자동으로 자르지 않는다. 현재 엔트리 전체를 돌려주며 거부해 모델이 정리하게 한다.
 * - 배치는 원자적으로: 작업 목록을 작업 사본에 적용하고 최종 상태만 검사, 하나라도 실패하면 아무것도 쓰지 않는다.
 * - 프롬프트 인젝션·시크릿·보이지 않는 유니코드는 저장 전에 거부한다.
 * - 턴당 실패 3회를 넘기면 "그만 시도하라"는 종료 응답을 돌려 루프를 끊는다.
 * - 스코프는 셋: user(사용자 프로필) / project(프로젝트 공유, 승인 게이트) / agent(에이전트 개인 노트).
 *   여러 에이전트가 같은 스코프에 쓰면 서로의 엔트리를 증폭하므로 project 는 사람이 승인해야 반영된다.
 */
import type { ToolDefinition, ToolInput } from './claude';
import { logGate } from './gates';
import { atomicBatch, isPreconditionError } from './atomic';

export type MemoryScope = 'user' | 'project' | 'agent';
export type MemoryStatus = 'active' | 'pending';

export type MemoryEntry = {
  id: string; scope: MemoryScope; scopeId: string | null; content: string;
  status: MemoryStatus; createdBy: string; createdAt: number; updatedAt: number;
};

export const MEMORY_LIMITS: Record<MemoryScope, number> = { user: 1_400, project: 2_200, agent: 1_500 };
export const MEMORY_SCOPE_LABELS: Record<MemoryScope, string> = { user: '사용자 프로필', project: '프로젝트 기억', agent: '에이전트 노트' };
const ENTRY_DELIMITER = '\n§\n';
const MAX_FAILURES_PER_TURN = 3;

// ── 위협 스캔 (Hermes tools/threat_patterns.py 의 strict 스코프를 축약) ────────────────
const THREAT_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /ignore (all |the )?(previous|prior|above|earlier) (instructions|rules|prompts?)/i, reason: '프롬프트 인젝션 문구' },
  { pattern: /(이전|앞의|위의|기존)\s*(지시|규칙|명령)(을|를)?\s*(무시|잊)/, reason: '프롬프트 인젝션 문구' },
  { pattern: /you are now|from now on you (are|will)|new instructions?:/i, reason: '역할 탈취 문구' },
  { pattern: /(sk-ant-|sk-proj-|sk-)[A-Za-z0-9_-]{16,}/, reason: 'API 키로 보이는 문자열' },
  { pattern: /AKIA[0-9A-Z]{16}/, reason: 'AWS 액세스 키로 보이는 문자열' },
  { pattern: /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/, reason: 'GitHub 토큰으로 보이는 문자열' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, reason: '개인 키' },
  { pattern: /(password|passwd|비밀번호)\s*[:=]\s*\S{6,}/i, reason: '비밀번호로 보이는 값' },
  { pattern: /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/, reason: '보이지 않는 유니코드 문자' },
];

export function scanMemoryThreat(content: string): string | null {
  for (const { pattern, reason } of THREAT_PATTERNS) {
    if (pattern.test(content)) return reason;
  }
  return null;
}

// ── 읽기 / 렌더링 ───────────────────────────────────────────────────────────────
type Row = { id: string; scope: MemoryScope; scope_id: string | null; content: string; status: MemoryStatus; created_by: string; created_at: number; updated_at: number };

function rowToEntry(row: Row): MemoryEntry {
  return { id: row.id, scope: row.scope, scopeId: row.scope_id, content: row.content, status: row.status, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function listMemories(db: D1Database, userId: string, scope: MemoryScope, scopeId: string | null, includePending = false): Promise<MemoryEntry[]> {
  const rows = await db.prepare(`SELECT id, scope, scope_id, content, status, created_by, created_at, updated_at FROM memories
      WHERE user_id = ? AND scope = ? AND scope_id IS ? ${includePending ? '' : "AND status = 'active'"}
      ORDER BY created_at ASC`)
    .bind(userId, scope, scopeId).all<Row>();
  return rows.results.map(rowToEntry);
}

export function charCount(entries: { content: string }[]): number {
  return entries.map((entry) => entry.content).join(ENTRY_DELIMITER).length;
}

/** Hermes _render_block 과 같은 형식. 헤더에 사용률을 넣어 모델이 남은 용량을 인지하게 합니다. */
export function renderMemoryBlock(scope: MemoryScope, title: string, entries: MemoryEntry[]): string {
  const limit = MEMORY_LIMITS[scope];
  const used = charCount(entries);
  const percent = Math.min(100, Math.round((used / limit) * 100));
  const rule = '═'.repeat(46);
  const body = entries.length ? entries.map((entry) => entry.content).join(ENTRY_DELIMITER) : '(아직 저장된 기억 없음)';
  return `${rule}\n${title} [${percent}% — ${used.toLocaleString()}/${limit.toLocaleString()}자]\n${rule}\n${body}`;
}

export type MemoryScopeSet = {
  user: MemoryEntry[];
  project: { projectId: string; projectName: string; entries: MemoryEntry[] } | null;
  agent: { agentId: string; agentName: string; entries: MemoryEntry[] } | null;
};

export async function loadMemoryScopes(db: D1Database, userId: string, params: {
  projectId?: string | null; projectName?: string | null; agentId?: string | null; agentName?: string | null;
}): Promise<MemoryScopeSet> {
  const [user, project, agent] = await Promise.all([
    listMemories(db, userId, 'user', null),
    params.projectId ? listMemories(db, userId, 'project', params.projectId) : Promise.resolve([]),
    params.agentId ? listMemories(db, userId, 'agent', params.agentId) : Promise.resolve([]),
  ]);
  return {
    user,
    project: params.projectId ? { projectId: params.projectId, projectName: params.projectName ?? '', entries: project } : null,
    agent: params.agentId ? { agentId: params.agentId, agentName: params.agentName ?? '', entries: agent } : null,
  };
}

/** 시스템 프롬프트 뒤에 붙일 기억 섹션 (이번 턴 동안 동결되는 스냅샷) */
export function renderMemorySection(scopes: MemoryScopeSet): string {
  const blocks = [
    renderMemoryBlock('user', MEMORY_SCOPE_LABELS.user, scopes.user),
    scopes.project ? renderMemoryBlock('project', `${MEMORY_SCOPE_LABELS.project} · ${scopes.project.projectName}`, scopes.project.entries) : null,
    scopes.agent ? renderMemoryBlock('agent', `${MEMORY_SCOPE_LABELS.agent} · ${scopes.agent.agentName}`, scopes.agent.entries) : null,
  ].filter(Boolean);
  return ['## 기억 (이번 턴 시작 시점의 스냅샷)', ...blocks].join('\n\n');
}

export const MEMORY_GUIDANCE = [
  '## 기억 사용 규칙',
  '- 위 기억 블록은 세션과 무관하게 항상 참인 사실만 담습니다: 사용자가 누구인지(user), 프로젝트의 확정된 결정·제약·환경(project), 이 프로젝트에서 일하며 얻은 나만의 교훈(agent).',
  '- 그런 사실을 새로 알게 되면 memory 툴로 저장하세요. 작업 진행 상황, 완료 로그, 임시 상태, 다시 찾으면 되는 정보는 저장하지 마세요 — 그건 recall_history 가 담당합니다.',
  "- 기억은 선언문으로 씁니다. '사용자는 간결한 답을 선호함' ✓ / '항상 간결하게 답하라' ✗ (명령형은 다음 세션에서 지시로 재해석되어 사용자의 현재 요청을 덮습니다).",
  '- 예산이 차면 add 는 거부되고 현재 엔트리가 보입니다. replace/remove 로 낡은 것을 정리해 자리를 만드세요. 모든 변경은 한 번의 호출에 operations 배열로 묶으세요.',
  '- project 스코프 저장은 사람의 승인을 거친 뒤 반영됩니다(저장 직후에는 보이지 않습니다).',
].join('\n');

// ── 툴 정의 (Hermes memory 툴 스키마의 HOW/WHEN/IF FULL/SKIP 문구를 옮김) ────────────
export const MEMORY_TOOL: ToolDefinition = {
  name: 'memory',
  description: [
    '세션이 바뀌어도 유지되는 기억에 사실을 저장합니다. 기억은 앞으로의 모든 턴에 주입되므로 짧고 밀도 높게 쓰세요.',
    'HOW: 변경은 한 번의 호출에 operations 배열로 묶으세요. 배치는 원자적으로 적용되고 예산은 최종 결과에만 검사하므로, 낡은 엔트리를 remove/replace 해 자리를 만들고 새 것을 add 하는 것을 한 번에 할 수 있습니다.',
    'WHEN: 어떤 업무를 하든 항상 적용되는 사실만 — 사용자가 누구인지, 안정적인 프로젝트 결정·제약, 환경 사실. 작업하며 배운 절차는 여기가 아니라 결과 본문에 남기세요.',
    'IF FULL: add 가 거부되면 현재 엔트리가 함께 옵니다. 정리와 추가를 한 배치로 다시 보내세요.',
    'SKIP: 사소하거나 뻔한 정보, 다시 찾으면 되는 사실, 원문 덤프, 작업 진행 상황, 완료 로그, 임시 TODO (이런 것은 recall_history 로 찾습니다).',
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['user', 'project', 'agent'], description: 'user = 사용자 프로필, project = 프로젝트 공유 사실(승인 필요), agent = 나의 개인 노트' },
      action: { type: 'string', enum: ['add', 'replace', 'remove'], description: 'operations 를 쓰지 않을 때의 단일 작업' },
      content: { type: 'string', description: 'add/replace 시 저장할 선언문' },
      old_text: { type: 'string', description: 'replace/remove 대상 엔트리를 유일하게 가리키는 부분 문자열' },
      operations: {
        type: 'array',
        description: '여러 변경을 원자적으로 적용. 각 항목 {action, content?, old_text?}',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['add', 'replace', 'remove'] },
            content: { type: 'string' },
            old_text: { type: 'string' },
          },
          required: ['action'],
        },
      },
    },
    required: ['scope'],
  },
};

// ── 쓰기 ─────────────────────────────────────────────────────────────────────
type Operation = { action: 'add' | 'replace' | 'remove'; content?: string; old_text?: string };

export type MemoryWriteContext = {
  userId: string;
  projectId?: string | null;
  agentId?: string | null;
  /** 누가 쓰는지 — 에이전트 이름 또는 'user'. project 스코프는 'user' 가 아니면 pending 으로 들어갑니다. */
  actor: string;
  /** 턴당 실패 횟수를 누적하는 카운터 (실행/대화 한 번마다 새 객체) */
  failures?: { count: number };
};

function describeEntries(entries: { content: string }[], scope: MemoryScope) {
  return { current_entries: entries.map((entry) => entry.content), usage: `${charCount(entries)}/${MEMORY_LIMITS[scope]}자` };
}

function findUnique(entries: MemoryEntry[], needle: string): { index: number } | { error: string } {
  const matches = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.content.includes(needle));
  if (matches.length === 1) return { index: matches[0].index };
  if (!matches.length) return { error: `old_text 와 일치하는 엔트리가 없습니다: "${needle.slice(0, 60)}"` };
  return { error: `old_text 가 ${matches.length}개 엔트리에 걸립니다. 더 구체적으로 지정하세요.` };
}

/**
 * memory 툴 실행기. 성공하면 {ok, note}, 실패하면 {error, current_entries, usage}.
 * 실패가 턴당 3회를 넘으면 {done:true} 로 더 시도하지 말라고 알립니다.
 */
export async function executeMemoryTool(db: D1Database, input: ToolInput, ctx: MemoryWriteContext): Promise<Record<string, unknown>> {
  const failures = ctx.failures ?? { count: 0 };
  const fail = (payload: Record<string, unknown>) => {
    failures.count += 1;
    if (failures.count > MAX_FAILURES_PER_TURN) {
      return { done: true, note: '기억 저장 재시도를 멈추세요. 이번 턴에는 기억을 그대로 두고 답변을 이어가세요.' };
    }
    return payload;
  };

  const scope = input.scope;
  if (scope !== 'user' && scope !== 'project' && scope !== 'agent') return fail({ error: "scope 는 'user' | 'project' | 'agent' 여야 합니다." });
  const scopeId = scope === 'user' ? null : scope === 'project' ? (ctx.projectId ?? null) : (ctx.agentId ?? null);
  if (scope !== 'user' && !scopeId) return fail({ error: `이 실행에는 ${scope} 스코프가 없습니다 (프로젝트/에이전트 미지정).` });

  const operations: Operation[] = Array.isArray(input.operations)
    ? (input.operations as Operation[]).filter((op) => op && typeof op === 'object')
    : [{ action: input.action as Operation['action'], content: input.content as string | undefined, old_text: input.old_text as string | undefined }];
  if (!operations.length) return fail({ error: 'action 또는 operations 가 필요합니다.' });

  // 스캔은 디스크를 만지기 전에 전부 — 하나라도 걸리면 배치 전체 거부 (Hermes apply_batch 와 동일)
  for (const op of operations) {
    if ((op.action === 'add' || op.action === 'replace') && typeof op.content === 'string') {
      const reason = scanMemoryThreat(op.content);
      if (reason) {
        logGate(db, ctx.userId, { gate: 'memory_threat', decision: 'block', projectId: ctx.projectId ?? null, detail: `${ctx.actor}: ${reason}` });
        return fail({ error: `저장이 거부되었습니다: ${reason}. 기억에는 사실만 담고 지시문·비밀값은 넣지 마세요.` });
      }
    }
  }

  const current = await listMemories(db, ctx.userId, scope, scopeId, true);
  const active = current.filter((entry) => entry.status === 'active');
  // 작업 사본: active 엔트리 기준으로 적용 (pending 은 사람이 처리)
  const working: MemoryEntry[] = active.map((entry) => ({ ...entry }));
  const inserts: string[] = [];
  const updates: { id: string; content: string }[] = [];
  const deletes: string[] = [];
  const now = Date.now();

  for (const op of operations) {
    if (op.action === 'add') {
      const content = (op.content ?? '').trim();
      if (!content) return fail({ error: 'add 에는 content 가 필요합니다.', ...describeEntries(working, scope) });
      if (working.some((entry) => entry.content === content) || inserts.includes(content)) continue; // 정확 중복은 조용히 무시
      inserts.push(content);
      working.push({ id: `new:${inserts.length}`, scope, scopeId, content, status: 'active', createdBy: ctx.actor, createdAt: now, updatedAt: now });
    } else if (op.action === 'replace' || op.action === 'remove') {
      const needle = (op.old_text ?? '').trim();
      if (!needle) return fail({ error: `${op.action} 에는 old_text 가 필요합니다.`, ...describeEntries(working, scope) });
      const found = findUnique(working, needle);
      if ('error' in found) return fail({ error: found.error, ...describeEntries(working, scope) });
      const target = working[found.index];
      if (op.action === 'remove') {
        working.splice(found.index, 1);
        if (target.id.startsWith('new:')) { const idx = inserts.indexOf(target.content); if (idx >= 0) inserts.splice(idx, 1); } else deletes.push(target.id);
      } else {
        const content = (op.content ?? '').trim();
        if (!content) return fail({ error: 'replace 에는 content 가 필요합니다.', ...describeEntries(working, scope) });
        working[found.index] = { ...target, content, updatedAt: now };
        if (target.id.startsWith('new:')) { const idx = inserts.indexOf(target.content); if (idx >= 0) inserts[idx] = content; } else updates.push({ id: target.id, content });
      }
    } else {
      return fail({ error: `알 수 없는 action: ${String(op.action)}` });
    }
  }

  const limit = MEMORY_LIMITS[scope];
  const finalChars = charCount(working);
  if (finalChars > limit) {
    return fail({
      error: `${MEMORY_SCOPE_LABELS[scope]} 예산 초과 (${finalChars}/${limit}자). 낡거나 겹치는 엔트리를 remove/replace 로 정리한 뒤 한 배치로 다시 보내세요.`,
      ...describeEntries(active, scope),
    });
  }

  // project 스코프에서 에이전트가 쓴 것은 승인 대기 (Hermes write_approval)
  const status: MemoryStatus = scope === 'project' && ctx.actor !== 'user' ? 'pending' : 'active';
  const statements = [
    ...deletes.map((id) => db.prepare('DELETE FROM memories WHERE id = ? AND user_id = ?').bind(id, ctx.userId)),
    ...updates.map((item) => db.prepare('UPDATE memories SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(item.content, now, item.id, ctx.userId)),
    ...inserts.map((content) => db.prepare('INSERT INTO memories (id, user_id, scope, scope_id, content, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), ctx.userId, scope, scopeId, content, status, ctx.actor, now, now)),
  ];
  if (!statements.length) return { ok: true, note: '변경할 것이 없었습니다 (이미 같은 내용이 있습니다). 이 호출은 완료되었으니 반복하지 마세요.' };
  try {
    await atomicBatch(db, `(? IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id = ? AND user_id = ?))
      AND (? IS NULL OR EXISTS (SELECT 1 FROM agents WHERE id = ? AND user_id = ?))`,
    [ctx.projectId ?? null, ctx.projectId ?? null, ctx.userId, ctx.agentId ?? null, ctx.agentId ?? null, ctx.userId], statements);
  } catch (error) {
    if (!isPreconditionError(error)) throw error;
    return fail({ error: '기억을 저장할 프로젝트 또는 에이전트가 삭제되었습니다.', code: 'memory_target_deleted' });
  }

  return {
    ok: true,
    saved: { added: inserts.length, replaced: updates.length, removed: deletes.length, status },
    usage: `${finalChars}/${limit}자`,
    note: status === 'pending'
      ? '저장되었고 사람의 승인을 기다립니다. 이 호출은 완료되었으니 반복하지 마세요.'
      : '저장되었습니다. 이 호출은 완료되었으니 반복하지 마세요.',
  };
}

// ── 리뷰 패스 (Hermes background_review 의 _MEMORY_REVIEW_PROMPT 를 옮김) ────────
export const MEMORY_REVIEW_PROMPT = [
  '위 대화를 검토하고 기억에 남길 것이 있는지 판단하세요.',
  '',
  '초점:',
  '1. 사용자가 자신에 대해 — 역할, 선호, 일하는 방식, 개인적 맥락 — 드러낸 것이 있는가? → scope user',
  '2. 이 프로젝트에 대한 안정적인 사실·결정·제약이 새로 확정됐는가? → scope project',
  '3. 이 프로젝트에서 일하며 다음에도 유효할 교훈이나 환경 사실을 얻었는가? → scope agent',
  '',
  "저장할 만한 것이 있으면 memory 툴로 저장하세요. 없으면 '저장할 것 없음' 이라고만 답하고 멈추세요.",
  '기억은 선언문으로 쓰세요. 일주일 안에 낡을 사실, 작업 진행 상황, 완료 로그, 미해결 실패를 검증된 사실처럼 쓰는 것은 금지입니다.',
  '반드시 위 대화에 실제로 적힌 내용만 저장하세요. 대화가 비어 있거나 잘려 있으면 업무 제목만 보고 내용을 추측해 채우지 말고 저장할 것 없음으로 끝내세요. 에이전트가 제안만 한 것은 결정이 아닙니다.',
  '이 리뷰에서는 memory 툴만 쓸 수 있습니다.',
].join('\n');
