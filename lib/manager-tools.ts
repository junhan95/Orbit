/**
 * 프로젝트 매니저 전용 도구.
 *
 *  - recruit_agent : 직무 카탈로그(lib/agent-catalog.ts)에서 필요한 직무를 골라 팀에 합류시킴
 *  - delegate_task : 팀원에게 업무를 맡기고 '그 자리에서' 실행해 보고를 받아옴
 *
 * delegate_task 는 카드만 만드는 게 아니라 하위 에이전트를 실제로 돌립니다.
 * 그래서 매니저 실행 한 번 = 매니저 1회 + 위임한 팀원 수만큼의 실행이며,
 * 폭주를 막으려고 실행당 합류 4명 · 위임 4건으로 상한을 둡니다.
 */
import { AGENT_CATALOG, findCatalogRole, renderCatalog, uniqueAgentName } from '@/lib/agent-catalog';
import type { ToolDefinition } from '@/lib/claude';
import { runTask } from '@/lib/run-task';
import { type Priority, toPriority } from '@/lib/priority';
import { recallDocUpsert } from '@/lib/recall';

export const MAX_RECRUITS = 4;
export const MAX_DELEGATIONS = 4;
/** 매니저에게 돌려주는 하위 결과 본문 길이 상한 */
const REPORT_CLIP = 4_000;

export const RECRUIT_TOOL: ToolDefinition = {
  name: 'recruit_agent',
  description: [
    '이 프로젝트에 필요한 직무의 에이전트를 팀에 합류시킵니다.',
    '업무를 맡길 사람이 팀에 없을 때만 부르세요 — 이미 팀에 있는 직무를 다시 부르면 그 사람을 그대로 돌려줍니다.',
    `한 번의 실행에서 최대 ${MAX_RECRUITS}명까지 합류시킬 수 있습니다.`,
    '아래 role_key 중에서 고르세요:',
    `\n${renderCatalog()}`,
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      role_key: { type: 'string', enum: AGENT_CATALOG.map((role) => role.key), description: '합류시킬 직무의 키' },
      reason: { type: 'string', description: '왜 이 직무가 필요한지 한 문장' },
    },
    required: ['role_key'],
  },
};

export const DELEGATE_TOOL: ToolDefinition = {
  name: 'delegate_task',
  description: [
    '팀원에게 업무를 맡기고 결과 보고를 받습니다. 카드가 보드에 만들어지고 그 자리에서 실행됩니다.',
    'brief 에는 맡을 사람이 이것만 읽고 시작할 수 있도록 배경·요구사항·완료 조건을 충분히 적으세요.',
    '결과는 이 호출의 반환값으로 돌아옵니다 — 받아서 검토한 뒤 사용자에게 보고하세요.',
    `한 번의 실행에서 최대 ${MAX_DELEGATIONS}건까지 위임할 수 있습니다. 같은 일을 두 번 맡기지 마세요.`,
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      agent_name: { type: 'string', description: '팀에 있는 에이전트 이름 (recruit_agent 가 돌려준 이름)' },
      title: { type: 'string', description: '업무 제목 (1~100자)' },
      brief: { type: 'string', description: '배경, 해야 할 일, 완료 조건' },
      label: { type: 'string', description: "분류 태그 (예: '리서치', '마케팅')" },
      priority: { type: 'string', enum: ['높음', '중간', '낮음'], description: "중요도. 목표 달성에 먼저 필요한 일일수록 '높음'. 생략하면 '중간'." },
    },
    required: ['agent_name', 'title', 'brief'],
  },
};

export const MANAGER_TOOLS: ToolDefinition[] = [RECRUIT_TOOL, DELEGATE_TOOL];
export const MANAGER_TOOL_NAMES = new Set(MANAGER_TOOLS.map((tool) => tool.name));

/**
 * 매니저가 일하는 도중 밖으로 흘려보내는 진행 이벤트.
 * 스트리밍 대화가 이걸 받아 "Uri에게 맡김 → Uri 보고 도착" 을 실시간으로 보여줍니다.
 * 위임 한 건은 하위 에이전트 실행이라 수십 초가 걸리므로, 시작과 끝을 따로 알립니다.
 */
export type ManagerEvent =
  | { kind: 'recruited'; agent: string; role: string }
  | { kind: 'delegate_start'; agent: string; role: string; title: string }
  | { kind: 'delegate_done'; agent: string; title: string; taskId: string; outcome: 'completed' | 'blocked'; summary: string };

export type ManagerContext = {
  db: D1Database;
  userId: string;
  apiKey: string;
  fallbackModel: string;
  projectId: string;
  projectName: string;
  projectDescription: string;
  managerName: string;
  /** 지금 실행 중인 매니저 업무 id. 대화에서 위임할 때는 부모 카드가 없어 null 입니다. */
  managerTaskId: string | null;
  /** 브라우저가 읽어 보낸 연결 폴더 스냅샷 (없으면 빈 문자열) */
  folderContext: string;
  /** 진행 이벤트 구독자 (스트리밍 대화용). 없으면 아무 데도 흘리지 않습니다. */
  onEvent?: (event: ManagerEvent) => void;
};

export type ManagerLog = {
  recruited: Array<{ name: string; role: string }>;
  delegated: Array<{ taskId: string; title: string; agent: string; outcome: string; summary: string }>;
};

export function createManagerLog(): ManagerLog {
  return { recruited: [], delegated: [] };
}

type MemberRow = { id: string; name: string; role: string; color: string; instructions: string; model: string | null; roleKey: string | null; isManager: number };

/** 이 프로젝트에 배정된 에이전트들 (매니저 포함) */
export async function loadMembers(db: D1Database, userId: string, projectId: string): Promise<MemberRow[]> {
  const rows = await db.prepare(`SELECT a.id, a.name, a.role, a.color, a.instructions, a.model, a.role_key AS roleKey, a.is_manager AS isManager
      FROM agents a JOIN project_agents pa ON pa.agent_id = a.id AND pa.user_id = a.user_id
      WHERE a.user_id = ? AND pa.project_id = ? ORDER BY a.is_manager DESC, pa.assigned_at ASC`)
    .bind(userId, projectId).all<MemberRow>();
  return rows.results;
}

/** 시스템 프롬프트용 '현재 팀' 섹션 */
export function renderTeam(members: MemberRow[]): string {
  if (!members.length) return '## 현재 팀\n(아직 당신뿐입니다. 필요한 직무는 recruit_agent 로 합류시키세요.)';
  const lines = members.map((member) => `- ${member.name} · ${member.role}${member.isManager ? ' (당신)' : ''}`);
  return `## 현재 팀\n${lines.join('\n')}`;
}

function clip(text: string | null | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}


/**
 * 하위 에이전트 한 명을 실제로 실행합니다.
 * 카드 생성 → 실행 → 카드/실행기록/댓글/사용량/회상 저장까지 끝내고 매니저에게 줄 보고를 돌려줍니다.
 */
async function runWorker(context: ManagerContext, member: MemberRow, params: { title: string; brief: string; label: string; priority: Priority }) {
  const { db, userId } = context;
  const now = Date.now();
  const taskId = crypto.randomUUID();

  // 카드를 만들고, 실행은 /api/agents/run 과 같은 코어(lib/run-task.ts)에 맡깁니다.
  // 그래야 위임 실행에도 기억·회상·스킬·검증 근거·검토·관제·승인 게이트가 똑같이 적용됩니다.
  await db.batch([
    db.prepare(`INSERT INTO tasks (id, user_id, title, label, owner, status, priority, accent, project_id, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(taskId, userId, params.title, params.label, member.name, '진행 중', params.priority, member.color, context.projectId, params.brief, now, now),
    recallDocUpsert(db, {
      userId, kind: 'task', refId: taskId, projectId: context.projectId, agentName: member.name, title: params.title,
      content: `[${params.label}] ${params.title} — 담당 ${member.name} (${context.managerName} 위임)\n${params.brief}`, createdAt: now,
    }),
  ]);

  const outcome = await runTask({
    db, userId, taskId, apiKey: context.apiKey, fallbackModel: context.fallbackModel,
    folderContext: context.folderContext,
    delegatedBy: { managerName: context.managerName, parentTaskId: context.managerTaskId },
  });
  if (!outcome.ok) {
    return { taskId, status: '대기', blocked: true, summary: '', output: '', blockedReason: outcome.error };
  }
  return { taskId, status: outcome.status, blocked: outcome.blocked, summary: outcome.summary, output: outcome.output, blockedReason: outcome.blockedReason };
}

export async function executeManagerTool(
  name: string,
  input: Record<string, unknown>,
  context: ManagerContext,
  log: ManagerLog,
): Promise<unknown> {
  const { db, userId, projectId } = context;

  if (name === 'recruit_agent') {
    if (log.recruited.length >= MAX_RECRUITS) {
      return { ok: false, error: `이번 실행에서는 ${MAX_RECRUITS}명까지만 합류시킬 수 있습니다. 지금 팀으로 진행하세요.` };
    }
    const role = findCatalogRole(input.role_key);
    if (!role) return { ok: false, error: `알 수 없는 직무입니다. 가능한 role_key: ${AGENT_CATALOG.map((item) => item.key).join(', ')}` };

    const existing = await db.prepare(`SELECT a.name, a.role FROM agents a JOIN project_agents pa ON pa.agent_id = a.id AND pa.user_id = a.user_id
        WHERE a.user_id = ? AND pa.project_id = ? AND a.role_key = ? LIMIT 1`)
      .bind(userId, projectId, role.key).first<{ name: string; role: string }>();
    if (existing) return { ok: true, agent_name: existing.name, role: existing.role, note: '이미 팀에 있는 직무라 그대로 씁니다.' };

    const now = Date.now();
    const id = crypto.randomUUID();
    const agentName = await uniqueAgentName(db, userId, role.name);
    await db.batch([
      db.prepare(`INSERT INTO agents (id, user_id, name, role, description, instructions, color, is_default, created_at, project_id, is_manager, role_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?)`)
        .bind(id, userId, agentName, role.role, role.description, role.instructions, role.color, now, projectId, role.key),
      db.prepare('INSERT OR IGNORE INTO project_agents (project_id, agent_id, user_id, assigned_at) VALUES (?, ?, ?, ?)')
        .bind(projectId, id, userId, now),
    ]);
    log.recruited.push({ name: agentName, role: role.role });
    context.onEvent?.({ kind: 'recruited', agent: agentName, role: role.role });
    return { ok: true, agent_name: agentName, role: role.role, note: '팀에 합류했습니다. delegate_task 로 업무를 맡기세요.' };
  }

  if (name === 'delegate_task') {
    if (log.delegated.length >= MAX_DELEGATIONS) {
      return { ok: false, error: `이번 실행에서는 ${MAX_DELEGATIONS}건까지만 위임할 수 있습니다. 남은 것은 보고에 다음 단계로 적으세요.` };
    }
    const agentName = typeof input.agent_name === 'string' ? input.agent_name.trim() : '';
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const brief = typeof input.brief === 'string' ? input.brief.trim() : '';
    if (!title || title.length > 100) return { ok: false, error: 'title 은 1~100자여야 합니다.' };
    if (!brief) return { ok: false, error: 'brief 를 비워 두면 팀원이 무엇을 해야 할지 알 수 없습니다.' };

    const members = await loadMembers(db, userId, projectId);
    const member = members.find((item) => item.name === agentName && !item.isManager);
    if (!member) {
      const names = members.filter((item) => !item.isManager).map((item) => item.name);
      return {
        ok: false,
        error: names.length
          ? `'${agentName}' 는 이 프로젝트 팀에 없습니다. 가능한 팀원: ${names.join(', ')}`
          : '아직 팀원이 없습니다. recruit_agent 로 필요한 직무를 먼저 합류시키세요.',
      };
    }

    const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 20) : member.role.slice(0, 20);
    const priority = toPriority(input.priority);
    // 하위 실행은 수십 초가 걸립니다 — 시작을 먼저 알려 화면이 멈춘 것처럼 보이지 않게 합니다.
    context.onEvent?.({ kind: 'delegate_start', agent: member.name, role: member.role, title });
    const result = await runWorker(context, member, { title, brief: brief.slice(0, 8000), label, priority });
    const outcome = result.blocked ? 'blocked' as const : 'completed' as const;
    log.delegated.push({ taskId: result.taskId, title, agent: member.name, outcome, summary: result.summary });
    context.onEvent?.({
      kind: 'delegate_done', agent: member.name, title, taskId: result.taskId, outcome,
      summary: result.blocked ? (result.blockedReason ?? '사유 미기재') : result.summary,
    });

    return {
      ok: true,
      task_id: result.taskId,
      agent: member.name,
      status: result.blocked ? 'blocked' : 'completed',
      blocked_reason: result.blockedReason,
      summary: result.summary,
      report: clip(result.output, REPORT_CLIP),
      note: result.blocked
        ? '팀원이 진행하지 못했습니다. 지시를 보완해 다시 맡기거나, 사용자에게 무엇이 필요한지 보고하세요.'
        : '팀원의 보고입니다. 검토한 뒤 사용자 보고에 반영하세요.',
    };
  }

  throw new Error(`알 수 없는 툴: ${name}`);
}
