/**
 * 목표 자동 분해 (Hermes 의 planner / goal → cards).
 * 프로젝트 목표를 받아 에이전트별로 나눈 업무 카드 초안을 만듭니다. 서버는 제안만 하고, 실제 카드 생성은
 * 사용자가 검토한 뒤 apply 로 따로 요청합니다 (에이전트가 보드를 멋대로 채우지 않게).
 */
import { runClaudeAgent, type ToolDefinition } from './claude';
import { loadMemoryScopes, renderMemorySection } from './memory';
import { type Priority, toPriority } from './priority';

export const PLAN_MAX_TASKS = 10;
export const PLAN_DEFAULT_TASKS = 6;
const EXISTING_TASKS_IN_CONTEXT = 40;
const RECENT_SUMMARIES = 5;

export type PlannedTask = {
  title: string;
  description: string;
  owner: string;
  label: string;
  priority: Priority;
  subtasks: string[];
};

export type PlanProposal = { rationale: string; tasks: PlannedTask[] };

type AgentRow = { name: string; role: string; description: string };
type TaskRow = { title: string; owner: string; status: string; label: string };
type SummaryRow = { title: string; owner: string; summary: string };

const PLAN_TOOL: ToolDefinition = {
  name: 'propose_plan',
  description: '목표를 업무 카드로 분해한 결과를 제출합니다. 반드시 한 번만 호출하세요.',
  input_schema: {
    type: 'object',
    properties: {
      rationale: { type: 'string', description: '왜 이렇게 나눴는지 2~3문장 (순서·의존 관계 포함)' },
      tasks: {
        type: 'array',
        description: '실행 순서대로. 각 카드는 한 에이전트가 한 번의 실행으로 끝낼 수 있는 크기여야 합니다.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '무엇을 끝내야 하는지 드러나는 제목 (1~100자)' },
            description: { type: 'string', description: '맡은 에이전트가 이것만 읽고 시작할 수 있는 배경·입력·완료 조건. 선행 카드가 있으면 "선행: <제목>" 으로 명시.' },
            owner: { type: 'string', description: '담당 에이전트 이름 (주어진 목록 중 하나)' },
            label: { type: 'string', description: "분류 (예: '리서치', '설계', '개발', 'QA', '문서')" },
            priority: { type: 'string', enum: ['높음', '중간', '낮음'], description: "중요도. 목표 달성의 병목이거나 선행 카드일수록 '높음'. 생략하면 '중간'." },
            subtasks: { type: 'array', items: { type: 'string' }, description: '체크리스트 (0~6개). 완료 조건을 쪼갠 것' },
          },
          required: ['title', 'description', 'owner'],
        },
      },
    },
    required: ['rationale', 'tasks'],
  },
};

export type PlanParams = {
  db: D1Database;
  userId: string;
  apiKey: string;
  model: string;
  project: { id: string; name: string; description: string };
  goal: string;
  maxTasks: number;
};

export async function proposePlan(params: PlanParams) {
  const { db, userId, project } = params;
  const maxTasks = Math.min(PLAN_MAX_TASKS, Math.max(1, params.maxTasks));

  const [assigned, existing, recent, memory] = await Promise.all([
    db.prepare(`SELECT a.name, a.role, a.description FROM agents a
        JOIN project_agents pa ON pa.agent_id = a.id AND pa.user_id = a.user_id
        WHERE a.user_id = ? AND pa.project_id = ? ORDER BY a.is_default DESC, a.created_at ASC`)
      .bind(userId, project.id).all<AgentRow>(),
    db.prepare('SELECT title, owner, status, label FROM tasks WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(userId, project.id, EXISTING_TASKS_IN_CONTEXT).all<TaskRow>(),
    db.prepare(`SELECT title, owner, summary FROM tasks WHERE user_id = ? AND project_id = ? AND summary IS NOT NULL ORDER BY updated_at DESC LIMIT ?`)
      .bind(userId, project.id, RECENT_SUMMARIES).all<SummaryRow>(),
    loadMemoryScopes(db, userId, { projectId: project.id, projectName: project.name }),
  ]);
  // 프로젝트에 배정된 에이전트가 없으면 전체 에이전트를 후보로 씁니다.
  const agents = assigned.results.length
    ? assigned.results
    : (await db.prepare('SELECT name, role, description FROM agents WHERE user_id = ? ORDER BY is_default DESC, created_at ASC').bind(userId).all<AgentRow>()).results;
  if (!agents.length) throw new Error('업무를 맡길 에이전트가 없습니다. 먼저 에이전트를 만들어 주세요.');

  const system = [
    '당신은 이 프로젝트의 계획 담당(Project Lead)입니다. 목표를 에이전트들이 각자 한 번의 실행으로 끝낼 수 있는 업무 카드로 나눕니다.',
    '',
    '## 원칙',
    `- 카드는 최대 ${maxTasks}개. 적을수록 좋습니다 — 한 카드로 끝날 일을 쪼개지 마세요.`,
    '- 각 카드는 담당 에이전트의 역할에 맞아야 하고, description 만 읽고도 시작할 수 있어야 합니다 (입력·범위·완료 조건).',
    '- 이미 보드에 있는 업무와 겹치는 카드는 만들지 마세요. 필요하면 "기존 카드 X 이후에" 처럼 참조만 하세요.',
    '- 선행 관계가 있으면 실행 순서대로 나열하고 description 에 "선행: <제목>" 을 적으세요.',
    '- 사람이 결정해야 하는 항목은 카드로 만들지 말고 rationale 에 적으세요.',
    '- 결과는 반드시 propose_plan 툴 한 번으로 제출합니다. 다른 말은 하지 마세요.',
    '- 아래 기억 블록(사용자 프로필·프로젝트 기억)은 확정된 사실입니다. 계획은 그 제약 안에서 세우세요.',
    '',
    `## 프로젝트\n이름: ${project.name}\n설명: ${project.description || '(설명 없음)'}`,
    '',
    `## 에이전트\n${agents.map((agent) => `- ${agent.name} · ${agent.role}${agent.description ? ` — ${agent.description}` : ''}`).join('\n')}`,
    existing.results.length
      ? `\n## 보드에 이미 있는 업무\n${existing.results.map((task) => `- [${task.status}] ${task.title} (${task.owner} · ${task.label})`).join('\n')}`
      : '',
    recent.results.length
      ? `\n## 최근 실행 결과 요약\n${recent.results.map((row) => `- ${row.title} (${row.owner}): ${row.summary.slice(0, 300)}`).join('\n')}`
      : '',
    '',
    renderMemorySection(memory),
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');

  const proposal: { value: PlanProposal | null } = { value: null };
  const agentNames = new Set(agents.map((agent) => agent.name));

  const result = await runClaudeAgent({
    apiKey: params.apiKey,
    model: params.model,
    system,
    messages: [{ role: 'user', content: `목표: ${params.goal}\n\n이 목표를 업무 카드로 분해해 propose_plan 으로 제출해 주세요.` }],
    maxTokens: 4000,
    maxIterations: 2,
    tools: [PLAN_TOOL],
    executeTool(name, input) {
      if (name !== 'propose_plan') throw new Error(`알 수 없는 툴: ${name}`);
      const parsed = parseProposal(input, agentNames, agents[0].name, maxTasks);
      if ('error' in parsed) return Promise.resolve({ ok: false, error: parsed.error });
      proposal.value = parsed;
      return Promise.resolve({ ok: true, note: '계획이 접수되었습니다. 더 이상 아무것도 하지 마세요.' });
    },
  });

  if (!proposal.value) throw new Error(`계획을 받지 못했습니다 (${result.stopReason ?? '이유 미상'}). 목표를 더 구체적으로 적어 다시 시도해 주세요.`);
  return { proposal: proposal.value, result };
}

function parseProposal(input: Record<string, unknown>, agentNames: Set<string>, defaultOwner: string, maxTasks: number): PlanProposal | { error: string } {
  if (!Array.isArray(input.tasks) || !input.tasks.length) return { error: 'tasks 가 비어 있습니다.' };
  const tasks: PlannedTask[] = [];
  const seen = new Set<string>();
  for (const raw of input.tasks as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') continue;
    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 100) : '';
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const owner = typeof raw.owner === 'string' && agentNames.has(raw.owner.trim()) ? raw.owner.trim() : defaultOwner;
    tasks.push({
      title,
      description: typeof raw.description === 'string' ? raw.description.trim().slice(0, 8000) : '',
      owner,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 20) : '신규',
      priority: toPriority(raw.priority),
      subtasks: Array.isArray(raw.subtasks)
        ? raw.subtasks.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim().slice(0, 200)).slice(0, 6)
        : [],
    });
    if (tasks.length >= maxTasks) break;
  }
  if (!tasks.length) return { error: '유효한 카드가 없습니다. title 과 owner 를 확인하세요.' };
  return { rationale: typeof input.rationale === 'string' ? input.rationale.trim().slice(0, 2000) : '', tasks };
}
