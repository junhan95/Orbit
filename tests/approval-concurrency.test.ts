import { afterEach, expect, it } from 'vitest';
import { requestApproval, resolveApproval } from '@/lib/approvals';
import { testDatabase } from './d1';

const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => { for (const { sqlite } of databases.splice(0)) sqlite.close(); });

it.each(['approve', 'reject'] as const)('only one concurrent approval/%s decision can resolve an approval', async (secondDecision) => {
  const database = testDatabase(); databases.push(database);
  const { db, sqlite } = database;
  const { id } = await requestApproval(db, 'u', { action: 'save_global_skill', actor: 'agent', projectId: null, taskId: null, summary: 'save', payload: { name: 'steps', description: 'steps', body: '1. check' } });
  const results = await Promise.all([resolveApproval(db, 'u', id, 'approve'), resolveApproval(db, 'u', id, secondDecision)]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  const status = sqlite.prepare('SELECT status FROM approvals WHERE id = ?').get(id)?.status;
  expect(sqlite.prepare('SELECT * FROM skills').all()).toHaveLength(status === 'approved' ? 1 : 0);
});

it('a failed effect leaves approval pending and can be retried', async () => {
  const database = testDatabase(); databases.push(database);
  const { db, sqlite } = database;
  const { id } = await requestApproval(db, 'u', { action: 'save_global_skill', actor: 'agent', projectId: null, taskId: null, summary: 'save', payload: { name: 'steps', description: 'steps', body: '1. check' } });
  sqlite.exec("CREATE TRIGGER fail_skill BEFORE INSERT ON skills BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
  expect((await resolveApproval(db, 'u', id, 'approve')).ok).toBe(false);
  expect(sqlite.prepare('SELECT status FROM approvals WHERE id = ?').get(id)?.status).toBe('pending');
  sqlite.exec('DROP TRIGGER fail_skill');
  expect((await resolveApproval(db, 'u', id, 'approve')).ok).toBe(true);
});
