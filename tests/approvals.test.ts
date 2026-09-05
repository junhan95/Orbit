import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { gateCreateTask, listApprovals, resolveApproval } from '@/lib/approvals';
import { executeSkillTool } from '@/lib/skills';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  sqlite.exec("CREATE TABLE projects (id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");
  for (const migration of ['0012_skills', '0016_gate_events', '0017_approvals', '0021_credits', '0022_runtime_safety']) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${migration}.sql`, import.meta.url), 'utf8'));
  }
  function prepare(sql: string) {
    let values: SQLInputValue[] = [];
    return {
      bind(...args: SQLInputValue[]) { values = args; return this; },
      async run() { return sqlite.prepare(sql).run(...values); },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    };
  }
  const db = { prepare, async batch(statements: ReturnType<typeof prepare>[]) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  const context = { db, userId: 'u', projectId: 'p', actor: 'E-Bolt', taskId: 't', runId: 'r', saves: { count: 0, names: [] as string[] } };
  return { sqlite, db, context };
}

const skill = { name: '후속 카드 쪼개기', description: '후속 업무를 작은 카드로 나눕니다.', body: '1. 목표 확인\n2. 단계 분리\n3. 결과 확인', scope: 'global' };

describe('승인 게이트', () => {
  it('범위가 누락되거나 잘못되면 project로 자동 저장하지 않는다', async () => {
    const { sqlite, context } = setup();
    for (const scope of [undefined, null, 'GLOBAL', '']) {
      const saved = await executeSkillTool('save_skill', { ...skill, scope }, context);
      expect(saved.error).toBeTypeOf('string');
    }
    expect(sqlite.prepare('SELECT * FROM skills').all()).toHaveLength(0);
    expect(sqlite.prepare('SELECT * FROM approvals').all()).toHaveLength(0);
    expect(context.saves.count).toBe(0);
  });

  it('카드 5회 요청은 3회만 통과하고, 나머지 2회와 전역 스킬은 승인 전까지 보류한다', async () => {
    const { sqlite, db, context } = setup();
    const counter = { created: 0 };
    for (let i = 0; i < 5; i++) {
      const result = await gateCreateTask(db, 'u', { ...context, input: { title: `온보딩 ${i + 1}` }, counter });
      if (i < 3) expect(result).toBeNull();
      else expect(result?.pending_approval).toBeTypeOf('string');
    }
    const saved = await executeSkillTool('save_skill', skill, context);
    expect(saved.pending_approval).toBeTypeOf('string');
    const pending = await listApprovals(db, 'u');
    expect(pending.map((row) => row.action).sort()).toEqual(['create_task', 'create_task', 'save_global_skill']);
    expect(pending.every((row) => row.taskId === 't' && row.runId === 'r')).toBe(true);
    expect(sqlite.prepare('SELECT * FROM skills').all()).toHaveLength(0);
    expect(await listApprovals(db, 'other-user')).toEqual([]);
    const approved = await resolveApproval(db, 'u', String(saved.pending_approval), 'approve');
    expect(approved.ok).toBe(true);
    expect(sqlite.prepare('SELECT scope FROM skills').all()).toEqual([{ scope: 'global' }]);
    expect((await resolveApproval(db, 'u', String(saved.pending_approval), 'approve')).ok).toBe(false);
  });

  it('에이전트 이름이 user 여도 전역 스킬 승인 게이트를 우회하지 못한다', async () => {
    const { sqlite, context } = setup();
    const saved = await executeSkillTool('save_skill', skill, { ...context, actor: 'user' });
    expect(saved.pending_approval).toBeTypeOf('string');
    expect(sqlite.prepare('SELECT * FROM skills').all()).toHaveLength(0);
  });

  it('프로젝트 스킬은 즉시 저장하며 거절된 전역 스킬은 저장하지 않는다', async () => {
    const { sqlite, db, context } = setup();
    const saved = await executeSkillTool('save_skill', skill, context);
    expect((await resolveApproval(db, 'u', String(saved.pending_approval), 'reject')).ok).toBe(true);
    expect(sqlite.prepare('SELECT * FROM skills').all()).toHaveLength(0);
    const local = await executeSkillTool('save_skill', { ...skill, scope: 'project' }, { ...context, saves: { count: 0, names: [] } });
    expect(local.action).toBe('created');
    expect(sqlite.prepare('SELECT scope, project_id FROM skills').all()).toEqual([{ scope: 'project', project_id: 'p' }]);
  });
});
