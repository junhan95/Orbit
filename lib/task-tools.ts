/**
 * 에이전트가 보드를 직접 조작하는 도구들.
 *
 *  - create_task   : 후속 업무를 카드로 만들고 담당 에이전트를 지정
 *  - define_field  : 이 프로젝트에 커스텀 필드 정의를 추가 (Asana '사용자 지정 필드')
 *  - set_field     : 태스크의 커스텀 필드 값을 기입
 *
 * 실행 1회당 생성량에 상한을 둬서 에이전트가 보드를 채워버리지 않게 합니다.
 */
import type { ToolDefinition } from '@/lib/claude';
import { FIELD_TYPES, isFieldType, normalizeFieldValue, parseFieldRow, type ProjectField } from '@/lib/fields';
import { recallDocUpsert } from '@/lib/recall';

const DAY = 86_400_000;
export const MAX_CREATED_TASKS = 5;
export const MAX_CREATED_FIELDS = 5;

type FieldRow = { id: string; projectId: string; name: string; type: string; options: string; showOnCard: number; position: number; createdBy: string };

export const CREATE_TASK_TOOL: ToolDefinition = {
  name: 'create_task',
  description: [
    '이번 작업에서 드러난 후속 업무를 보드에 카드로 만듭니다. 지금 당장 당신이 해야 하는 일이 아니라,',
    '별도로 다뤄야 하는 독립된 업무일 때만 쓰세요. 같은 내용을 중복해 만들지 말고,',
    `한 번의 실행에서 최대 ${MAX_CREATED_TASKS}개까지만 만들 수 있습니다.`,
    '적임자를 알면 owner 에 그 에이전트 이름을 넣고, 모르면 비워 두세요.',
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '업무 제목. 무엇을 끝내야 하는지가 드러나게 (1~100자)' },
      description: { type: 'string', description: '맡을 사람이 이것만 읽고 시작할 수 있는 배경과 완료 조건' },
      owner: { type: 'string', description: '담당 에이전트 이름. 모르면 생략하면 기본 에이전트에게 갑니다.' },
      label: { type: 'string', description: "분류 태그 (예: '리서치', '개발', 'QA')" },
      due_in_days: { type: 'number', description: '오늘부터 며칠 뒤가 마감인지. 정하기 어려우면 생략하세요.' },
    },
    required: ['title'],
  },
};

export const DEFINE_FIELD_TOOL: ToolDefinition = {
  name: 'define_field',
  description: [
    '이 프로젝트의 모든 업무 카드가 공유하는 커스텀 필드를 정의합니다.',
    "업무를 추적하는 데 반복적으로 필요한 정보일 때만 만드세요 (예: '리스크 등급', '검증 상태').",
    '한 번 쓰고 말 메모는 필드가 아니라 요약에 적으세요.',
    `한 번의 실행에서 최대 ${MAX_CREATED_FIELDS}개까지 만들 수 있고, 같은 이름이 이미 있으면 그 필드를 그대로 씁니다.`,
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '필드 이름 (1~40자)' },
      type: { type: 'string', enum: [...FIELD_TYPES], description: 'text=자유 입력, number=숫자, date=YYYY-MM-DD, select=옵션 중 택1, checkbox=예/아니오' },
      options: { type: 'array', items: { type: 'string' }, description: "type='select' 일 때의 선택지 (2~20개)" },
      show_on_card: { type: 'boolean', description: '보드 카드에 배지로 보일지. 한눈에 봐야 하는 값이면 true.' },
    },
    required: ['name', 'type'],
  },
};

export const SET_FIELD_TOOL: ToolDefinition = {
  name: 'set_field',
  description: [
    '커스텀 필드에 값을 기입합니다. 필드가 없으면 먼저 define_field 로 만드세요.',
    '기본 대상은 지금 실행 중인 업무이고, create_task 로 만든 업무에 적으려면 task_id 를 함께 주세요.',
    "값을 지우려면 빈 문자열을 보내세요. select 필드는 정의된 옵션 중 하나여야 합니다.",
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      field_name: { type: 'string', description: '필드 이름' },
      value: { type: 'string', description: '기입할 값. checkbox 는 "1"(예) 또는 ""(아니오).' },
      task_id: { type: 'string', description: 'create_task 가 돌려준 업무 id. 생략하면 지금 실행 중인 업무.' },
    },
    required: ['field_name', 'value'],
  },
};

export const TASK_TOOLS: ToolDefinition[] = [CREATE_TASK_TOOL, DEFINE_FIELD_TOOL, SET_FIELD_TOOL];
export const TASK_TOOL_NAMES = new Set(TASK_TOOLS.map((tool) => tool.name));

export type TaskToolContext = {
  db: D1Database;
  userId: string;
  agentName: string;
  projectId: string | null;
  taskId: string;
};

/** 실행 한 번 동안 에이전트가 만든 것들. 실행 결과 응답에 그대로 실어 보냅니다. */
export type TaskToolLog = {
  createdTasks: Array<{ id: string; title: string; owner: string }>;
  createdFields: Array<{ id: string; name: string; type: string }>;
  setFields: Array<{ taskId: string; field: string; value: string }>;
};

export function createTaskToolLog(): TaskToolLog {
  return { createdTasks: [], createdFields: [], setFields: [] };
}

async function loadFields(context: TaskToolContext): Promise<ProjectField[]> {
  if (!context.projectId) return [];
  const rows = await context.db.prepare(`SELECT id, project_id AS projectId, name, type, options, show_on_card AS showOnCard, position, created_by AS createdBy
    FROM project_fields WHERE user_id = ? AND project_id = ? ORDER BY position ASC, created_at ASC`)
    .bind(context.userId, context.projectId).all<FieldRow>();
  return rows.results.map(parseFieldRow);
}

/** 시스템 프롬프트에 넣을 '이 프로젝트의 필드' 안내문. 없으면 빈 문자열. */
export async function describeFields(context: TaskToolContext): Promise<string> {
  const fields = await loadFields(context);
  if (!fields.length) return '';
  const lines = fields.map((field) => {
    const options = field.type === 'select' && field.options.length ? ` (${field.options.join(' / ')})` : '';
    return `- ${field.name} · ${field.type}${options}`;
  });
  return `## 이 프로젝트의 커스텀 필드\n필요하면 set_field 로 값을 채우세요.\n${lines.join('\n')}`;
}

export async function executeTaskTool(
  name: string,
  input: Record<string, unknown>,
  context: TaskToolContext,
  log: TaskToolLog,
): Promise<unknown> {
  const { db, userId, projectId, agentName } = context;
  const now = Date.now();

  if (name === 'create_task') {
    if (log.createdTasks.length >= MAX_CREATED_TASKS) {
      return { ok: false, error: `이번 실행에서는 업무를 ${MAX_CREATED_TASKS}개까지만 만들 수 있습니다. 나머지는 complete_task 의 next_actions 에 적으세요.` };
    }
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > 100) return { ok: false, error: 'title 은 1~100자여야 합니다.' };

    // 담당을 비우면 그 프로젝트의 매니저에게 갑니다 — 매니저가 팀을 꾸려 다시 나눠 맡깁니다.
    const requested = typeof input.owner === 'string' && input.owner.trim() ? input.owner.trim() : null;
    const agent = requested
      ? await db.prepare('SELECT name, color FROM agents WHERE user_id = ? AND name = ? LIMIT 1').bind(userId, requested).first<{ name: string; color: string }>()
      : await db.prepare('SELECT name, color FROM agents WHERE user_id = ? AND project_id = ? AND is_manager = 1 LIMIT 1').bind(userId, projectId).first<{ name: string; color: string }>();
    if (!agent) {
      const members = await db.prepare(`SELECT a.name FROM agents a JOIN project_agents pa ON pa.agent_id = a.id AND pa.user_id = a.user_id
          WHERE a.user_id = ? AND pa.project_id = ? ORDER BY a.is_manager DESC, pa.assigned_at ASC`)
        .bind(userId, projectId).all<{ name: string }>();
      return {
        ok: false,
        error: requested
          ? `'${requested}' 라는 에이전트가 없습니다. 이 프로젝트의 팀원: ${members.results.map((row) => row.name).join(', ') || '(없음)'}`
          : '이 프로젝트의 매니저를 찾지 못했습니다. owner 에 팀원 이름을 직접 지정하세요.',
      };
    }

    const dueDays = typeof input.due_in_days === 'number' && Number.isFinite(input.due_in_days) ? Math.trunc(input.due_in_days) : null;
    const task = {
      id: crypto.randomUUID(),
      title,
      description: typeof input.description === 'string' ? input.description.slice(0, 8000) : '',
      label: typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 20) : '신규',
      owner: agent.name,
      accent: agent.color,
      due: dueDays === null ? null : now + dueDays * DAY,
    };

    await db.batch([
      db.prepare(`INSERT INTO tasks (id, user_id, title, label, owner, status, due, accent, project_id, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(task.id, userId, task.title, task.label, task.owner, '대기', task.due, task.accent, projectId, task.description, now, now),
      recallDocUpsert(db, {
        userId, kind: 'task', refId: task.id, projectId, agentName: task.owner, title: task.title,
        content: `[${task.label}] ${task.title} — 담당 ${task.owner} (${agentName} 이(가) 실행 중 생성)\n${task.description}`, createdAt: now,
      }),
    ]);
    log.createdTasks.push({ id: task.id, title: task.title, owner: task.owner });
    return { ok: true, task_id: task.id, owner: task.owner, note: '보드의 대기 열에 카드가 만들어졌습니다.' };
  }

  if (name === 'define_field') {
    if (!projectId) return { ok: false, error: '이 업무는 프로젝트에 속해 있지 않아 필드를 만들 수 없습니다.' };
    if (log.createdFields.length >= MAX_CREATED_FIELDS) {
      return { ok: false, error: `이번 실행에서는 필드를 ${MAX_CREATED_FIELDS}개까지만 만들 수 있습니다.` };
    }
    const fieldName = typeof input.name === 'string' ? input.name.trim() : '';
    if (!fieldName || fieldName.length > 40) return { ok: false, error: 'name 은 1~40자여야 합니다.' };
    if (!isFieldType(input.type)) return { ok: false, error: `type 은 ${FIELD_TYPES.join(', ')} 중 하나여야 합니다.` };

    const existing = await db.prepare('SELECT id, name, type FROM project_fields WHERE user_id = ? AND project_id = ? AND name = ? LIMIT 1')
      .bind(userId, projectId, fieldName).first<{ id: string; name: string; type: string }>();
    if (existing) return { ok: true, field_id: existing.id, name: existing.name, type: existing.type, note: '같은 이름의 필드가 이미 있어 그대로 씁니다.' };

    const options = Array.isArray(input.options)
      ? input.options.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim().slice(0, 40)).slice(0, 20)
      : [];
    if (input.type === 'select' && options.length < 2) return { ok: false, error: "type='select' 이면 options 를 2개 이상 주세요." };

    const count = await db.prepare('SELECT COUNT(*) AS total FROM project_fields WHERE user_id = ? AND project_id = ?')
      .bind(userId, projectId).first<{ total: number }>();
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO project_fields (id, user_id, project_id, name, type, options, show_on_card, position, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, userId, projectId, fieldName, input.type, JSON.stringify(options), input.show_on_card ? 1 : 0, count?.total ?? 0, agentName, now).run();
    log.createdFields.push({ id, name: fieldName, type: input.type });
    return { ok: true, field_id: id, name: fieldName, type: input.type, note: '프로젝트의 모든 업무 상세에 이 필드가 나타납니다.' };
  }

  if (name === 'set_field') {
    if (!projectId) return { ok: false, error: '이 업무는 프로젝트에 속해 있지 않아 필드를 쓸 수 없습니다.' };
    const fieldName = typeof input.field_name === 'string' ? input.field_name.trim() : '';
    const fields = await loadFields(context);
    const field = fields.find((item) => item.name === fieldName);
    if (!field) {
      return { ok: false, error: `'${fieldName}' 필드가 없습니다. define_field 로 먼저 만드세요. 현재 필드: ${fields.map((item) => item.name).join(', ') || '(없음)'}` };
    }

    const targetId = typeof input.task_id === 'string' && input.task_id ? input.task_id : context.taskId;
    const target = await db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ? AND project_id = ?')
      .bind(targetId, userId, projectId).first<{ id: string }>();
    if (!target) return { ok: false, error: '그 업무를 이 프로젝트에서 찾을 수 없습니다.' };

    const value = normalizeFieldValue(field, input.value);
    if (value === null) {
      const hint = field.type === 'select' ? ` 가능한 값: ${field.options.join(' / ')}` : '';
      return { ok: false, error: `'${field.name}' 필드(${field.type})의 값 형식이 올바르지 않습니다.${hint}` };
    }

    await (value
      ? db.prepare(`INSERT INTO task_field_values (task_id, field_id, user_id, value, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(task_id, field_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
          .bind(targetId, field.id, userId, value, now).run()
      : db.prepare('DELETE FROM task_field_values WHERE task_id = ? AND field_id = ? AND user_id = ?').bind(targetId, field.id, userId).run());

    log.setFields.push({ taskId: targetId, field: field.name, value });
    return { ok: true, field: field.name, value: value || null };
  }

  throw new Error(`알 수 없는 툴: ${name}`);
}
