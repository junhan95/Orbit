/**
 * 절차적 기억 — 스킬 (Hermes skills 의 축소판).
 *
 * 기억(memory)이 "무엇이 사실인가"라면 스킬은 "이런 일은 이렇게 한다"입니다.
 * 에이전트가 업무를 끝낸 뒤 같은 종류의 일이 또 올 것 같으면 절차를 스킬로 남기고,
 * 다음 실행에서는 스킬 인덱스(이름+언제 쓰는지)만 프롬프트에 들어가며 필요할 때 use_skill 로 본문을 읽습니다
 * (점진적 공개 — 본문을 전부 넣으면 프롬프트가 금방 비대해집니다).
 *
 * scope: 'global'(이 사용자의 모든 프로젝트) | 'project'(한 프로젝트)
 */
import type { ToolDefinition, ToolInput } from './claude';
import { requestApproval } from './approvals';
import { logGate } from './gates';
import { scanMemoryThreat } from './memory';

export type SkillScope = 'global' | 'project';
export type Skill = {
  id: string; scope: SkillScope; projectId: string | null; name: string; description: string; body: string;
  createdBy: string; uses: number; createdAt: number; updatedAt: number;
};

export const SKILL_LIMITS = { name: 60, description: 200, body: 6_000, perScope: 40 };
/** 한 번의 실행에서 저장/갱신할 수 있는 스킬 수 */
export const MAX_SKILL_SAVES_PER_RUN = 1;

type Row = {
  id: string; scope: SkillScope; projectId: string | null; name: string; description: string; body: string;
  createdBy: string; uses: number; createdAt: number; updatedAt: number;
};
const SELECT = 'SELECT id, scope, project_id AS projectId, name, description, body, created_by AS createdBy, uses, created_at AS createdAt, updated_at AS updatedAt FROM skills';

export async function listSkills(db: D1Database, userId: string, projectId: string | null): Promise<Skill[]> {
  const rows = await db.prepare(`${SELECT} WHERE user_id = ? AND (scope = 'global' OR (scope = 'project' AND project_id = ?)) ORDER BY scope DESC, uses DESC, name ASC`)
    .bind(userId, projectId).all<Row>();
  return rows.results;
}

/** 프롬프트에 넣는 스킬 인덱스 — 이름과 '언제 쓰는지'만 */
export function renderSkillIndex(skills: Skill[]): string {
  if (!skills.length) return '';
  const lines = skills.map((skill) => `- **${skill.name}**${skill.scope === 'project' ? ' (이 프로젝트)' : ''} — ${skill.description}`);
  return [
    '## 사용 가능한 스킬',
    '아래는 이전에 검증된 절차입니다. 지금 업무와 맞는 것이 있으면 추측으로 진행하지 말고 use_skill 로 본문을 읽은 뒤 그 절차를 따르세요.',
    ...lines,
  ].join('\n');
}

export const SKILL_GUIDANCE = [
  '## 스킬 사용 규칙',
  '- 위 스킬 인덱스에 지금 업무와 맞는 항목이 있으면 먼저 use_skill 로 본문을 읽고 따르세요. 절차가 실제와 다르면 save_skill 로 고쳐 두세요.',
  '- 업무를 마친 뒤, 같은 종류의 업무가 다시 올 것 같고 이번에 쓴 절차가 다음에도 통할 것 같으면 save_skill 로 남기세요. 한 번짜리 결과물이나 프로젝트 사실(그건 memory)은 스킬이 아닙니다.',
  '- 스킬 본문은 다른 에이전트가 이것만 읽고 재현할 수 있게: 언제 쓰는지 → 입력 → 단계 → 확인 방법 → 흔한 함정.',
].join('\n');

export const USE_SKILL_TOOL: ToolDefinition = {
  name: 'use_skill',
  description: '스킬 인덱스에 있는 스킬의 본문(절차)을 읽습니다. 지금 업무와 맞는 스킬이 있을 때 먼저 호출하세요.',
  input_schema: {
    type: 'object',
    properties: { name: { type: 'string', description: '스킬 이름 (인덱스에 있는 그대로)' } },
    required: ['name'],
  },
};

export const SAVE_SKILL_TOOL: ToolDefinition = {
  name: 'save_skill',
  description: [
    '재사용할 절차를 스킬로 저장하거나(같은 이름이 있으면) 갱신합니다.',
    `한 번의 실행에서 ${MAX_SKILL_SAVES_PER_RUN}개만 저장할 수 있으니 정말 반복될 절차만 남기세요.`,
    "scope='project' 는 이 프로젝트에서만, 'global' 은 모든 프로젝트에서 보입니다. 사용자가 범위를 지정하면 그대로 따르세요. global 저장은 사람의 승인 대기에 들어가며, 승인되기 전에는 저장 완료로 보고하지 마세요.",
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: `스킬 이름 (동사형, ${SKILL_LIMITS.name}자 이내, 예: "D1 마이그레이션 적용")` },
      description: { type: 'string', description: `언제 이 스킬을 쓰는지 한 문장 (${SKILL_LIMITS.description}자 이내). 인덱스에 이 문장만 보입니다.` },
      body: { type: 'string', description: `절차 본문 (마크다운, ${SKILL_LIMITS.body}자 이내): 입력 → 단계 → 확인 → 함정` },
      scope: { type: 'string', enum: ['global', 'project'], description: '필수. 사용자가 지정한 범위를 그대로 전달하세요. global은 사람 승인 후 모든 프로젝트에 저장, project는 현재 프로젝트에 즉시 저장합니다.' },
    },
    required: ['name', 'description', 'body', 'scope'],
  },
};

export type SkillToolContext = {
  db: D1Database; userId: string; projectId: string | null; actor: string;
  /** 실행 한 번 동안의 저장 횟수 (호출자가 실행마다 새 객체) */
  saves: { count: number; names: string[] };
  /** 승인 대기 항목에 남길 출처 (실행에서 호출할 때) */
  taskId?: string | null; runId?: string | null;
};

export async function executeSkillTool(name: string, input: ToolInput, ctx: SkillToolContext): Promise<Record<string, unknown>> {
  const { db, userId } = ctx;

  if (name === 'use_skill') {
    const skillName = typeof input.name === 'string' ? input.name.trim() : '';
    if (!skillName) return { error: 'name 이 필요합니다.' };
    const skill = await db.prepare(`${SELECT} WHERE user_id = ? AND name = ? AND (scope = 'global' OR (scope = 'project' AND project_id = ?)) ORDER BY scope ASC LIMIT 1`)
      .bind(userId, skillName, ctx.projectId).first<Row>();
    if (!skill) {
      const available = await listSkills(db, userId, ctx.projectId);
      return { error: `'${skillName}' 스킬이 없습니다. 사용 가능: ${available.map((item) => item.name).join(', ') || '(없음)'}` };
    }
    await db.prepare('UPDATE skills SET uses = uses + 1 WHERE id = ?').bind(skill.id).run();
    return { ok: true, name: skill.name, description: skill.description, body: skill.body, updated_by: skill.createdBy, updated_at: new Date(skill.updatedAt).toISOString().slice(0, 10) };
  }

  if (name === 'save_skill') {
    const skillName = typeof input.name === 'string' ? input.name.trim().slice(0, SKILL_LIMITS.name) : '';
    const description = typeof input.description === 'string' ? input.description.trim().slice(0, SKILL_LIMITS.description) : '';
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (input.scope !== 'global' && input.scope !== 'project') return { error: "scope는 필수입니다. 사용자의 요청을 확인해 'global' 또는 'project'를 명시하세요. 아직 저장되지 않았습니다." };
    const scope: SkillScope = input.scope;
    if (!skillName || !description || !body) return { error: 'name, description, body 가 모두 필요합니다.' };
    if (body.length > SKILL_LIMITS.body) return { error: `body 가 너무 깁니다 (${body.length}/${SKILL_LIMITS.body}자). 핵심 단계만 남기세요.` };
    if (scope === 'project' && !ctx.projectId) return { error: '이 실행은 프로젝트에 속해 있지 않습니다. scope=global 로 저장하거나 생략하세요.' };
    const threat = scanMemoryThreat(`${skillName}\n${description}\n${body}`);
    if (threat) {
      logGate(db, userId, { gate: 'skill_threat', decision: 'block', projectId: ctx.projectId, detail: `${ctx.actor}: ${threat}` });
      return { error: `저장이 거부되었습니다: ${threat}. 스킬에는 절차만 담고 지시문·비밀값은 넣지 마세요.` };
    }
    // 같은 실행에서 같은 스킬을 다시 고치는 것은 허용, 새 이름은 상한 적용
    if (!ctx.saves.names.includes(skillName) && ctx.saves.count >= MAX_SKILL_SAVES_PER_RUN) {
      return { error: `이번 실행에서는 스킬을 ${MAX_SKILL_SAVES_PER_RUN}개만 저장할 수 있습니다.` };
    }
    // 전역 스킬은 모든 프로젝트에 영향을 주므로 바로 쓰지 않고 사람의 승인을 기다립니다 (물어보기형 게이트).
    // 이 함수는 에이전트 도구 전용입니다. 사람의 저장은 API에서 upsertSkill을 호출합니다.
    // actor는 표시 이름이므로 권한 판단에 사용하지 않습니다.
    if (scope === 'global') {
      const { id } = await requestApproval(db, userId, {
        action: 'save_global_skill', actor: ctx.actor, projectId: ctx.projectId, taskId: ctx.taskId ?? null, runId: ctx.runId ?? null,
        summary: `${ctx.actor} 가 전역 스킬 저장 요청: ${skillName}`, payload: { name: skillName, description, body },
      });
      if (!ctx.saves.names.includes(skillName)) { ctx.saves.count += 1; ctx.saves.names.push(skillName); }
      return { ok: true, pending_approval: id, note: '전역 스킬은 사람이 승인해야 저장됩니다. 승인 대기에 넣었으니 이 호출은 완료되었고 반복하지 마세요.' };
    }
    const outcome = await upsertSkill(db, { userId, scope, projectId: scope === 'project' ? ctx.projectId : null, name: skillName, description, body, actor: ctx.actor });
    if ('error' in outcome) return outcome;
    if (!ctx.saves.names.includes(skillName)) { ctx.saves.count += 1; ctx.saves.names.push(skillName); }
    return { ok: true, id: outcome.id, action: outcome.action, note: `스킬이 ${outcome.action === 'created' ? '저장' : '갱신'}되었습니다. 이 호출은 완료되었으니 반복하지 마세요.` };
  }

  throw new Error(`알 수 없는 툴: ${name}`);
}

/** 이름 기준 upsert (사용자 API 와 툴이 공유). 스코프별 개수 상한을 넘으면 거부. */
export async function upsertSkill(db: D1Database, params: {
  userId: string; scope: SkillScope; projectId: string | null; name: string; description: string; body: string; actor: string;
}): Promise<{ id: string; action: 'created' | 'updated' } | { error: string }> {
  const now = Date.now();
  const existing = await db.prepare('SELECT id FROM skills WHERE user_id = ? AND scope = ? AND project_id IS ? AND name = ? LIMIT 1')
    .bind(params.userId, params.scope, params.projectId, params.name).first<{ id: string }>();
  if (existing) {
    await db.prepare('UPDATE skills SET description = ?, body = ?, created_by = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(params.description, params.body, params.actor, now, existing.id, params.userId).run();
    return { id: existing.id, action: 'updated' };
  }
  const count = await db.prepare('SELECT COUNT(*) AS n FROM skills WHERE user_id = ? AND scope = ? AND project_id IS ?')
    .bind(params.userId, params.scope, params.projectId).first<{ n: number }>();
  if ((count?.n ?? 0) >= SKILL_LIMITS.perScope) {
    return { error: `이 범위의 스킬이 ${SKILL_LIMITS.perScope}개에 도달했습니다. 안 쓰는 스킬을 지운 뒤 저장하세요.` };
  }
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO skills (id, user_id, scope, project_id, name, description, body, created_by, uses, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
    .bind(id, params.userId, params.scope, params.projectId, params.name, params.description, params.body, params.actor, now, now).run();
  return { id, action: 'created' };
}
