import { afterEach, expect, it, vi } from 'vitest';
import { testDatabase } from './d1';
import { runTaskReview } from '@/lib/reviewer';
import { runClaudeAgent } from '@/lib/claude';
import { executeMemoryTool } from '@/lib/memory';
import { compactConversation } from '@/lib/compaction';
vi.mock('@/lib/claude', async (original) => ({ ...await original<typeof import('@/lib/claude')>(), runClaudeAgent: vi.fn() }));
const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => { vi.clearAllMocks(); for (const { sqlite } of databases.splice(0)) sqlite.close(); });
function setup() {
  const database = testDatabase(); databases.push(database);
  database.sqlite.exec("INSERT INTO tasks (id,user_id,title,label,owner,status,priority,accent,result,created_at,updated_at) VALUES ('t','u','test','test','agent','검토','중간','#000','result',0,1)");
  return database;
}
const result = { id: 'r', model: 'test', text: '', stopReason: 'max_tokens', iterations: 1, toolCalls: [], turns: [], usagePerIteration: [], usage: { inputTokens: 10, outputTokens: 3000, cacheCreationTokens: 0, cacheReadTokens: 0, webSearchRequests: 0 } };
it('does not leave orphan memory when a background review outlives its project', async () => {
  const { db, sqlite } = setup();
  const outcome = await executeMemoryTool(db, { scope: 'project', action: 'add', content: '배포 일정은 금요일입니다.' }, { userId: 'u', projectId: 'deleted', actor: 'agent' });
  expect(outcome.code).toBe('memory_target_deleted');
  expect(sqlite.prepare('SELECT * FROM memories').all()).toHaveLength(0);
});
it('skips compaction writes after project deletion but retains provider usage', async () => {
  const { db, sqlite } = setup();
  sqlite.exec("INSERT INTO projects (id,user_id,name,created_at,updated_at) VALUES ('p','u','test',0,0); INSERT INTO agents (id,user_id,name,role,description,instructions,created_at) VALUES ('a','u','agent','test','','',0)");
  for (let i = 1; i <= 26; i++) sqlite.prepare('INSERT INTO chat_messages (id,user_id,project_id,agent_id,role,content,created_at) VALUES (?,?,?,?,?,?,?)').run(String(i), 'u', 'p', 'a', i % 2 ? 'user' : 'assistant', 'text', i);
  vi.mocked(runClaudeAgent).mockImplementation(async () => { sqlite.exec("DELETE FROM projects WHERE id='p'"); return { ...result, text: 'summary' }; });
  expect(await compactConversation({ db, userId: 'u', projectId: 'p', agentId: 'a', agentName: 'agent', apiKey: 'k', model: 'test' })).toHaveProperty('skipped');
  expect(sqlite.prepare('SELECT * FROM chat_summaries').all()).toHaveLength(0);
  expect(sqlite.prepare('SELECT * FROM usage_events').all()).toHaveLength(1);
});
it('records usage when token exhaustion prevents submission without approving the task', async () => {
  const { db, sqlite } = setup();
  vi.mocked(runClaudeAgent).mockResolvedValue(result);
  await expect(runTaskReview({ db, userId: 'u', taskId: 't', apiKey: 'k', model: 'test' })).rejects.toMatchObject({ code: 'review_incomplete' });
  expect(sqlite.prepare('SELECT output_tokens FROM usage_events').get()?.output_tokens).toBe(3000);
  expect(sqlite.prepare('SELECT review_verdict FROM tasks').get()?.review_verdict).toBeNull();
  expect(vi.mocked(runClaudeAgent).mock.calls[0][0]).toMatchObject({ toolChoice: 'submit_review', maxIterations: 1 });
});
it.each(['delete', 'change'])('skips a review whose task is %s during the provider call', async (action) => {
  const { db, sqlite } = setup();
  vi.mocked(runClaudeAgent).mockImplementation(async (options) => {
    sqlite.exec(action === 'delete' ? "DELETE FROM tasks WHERE id='t'" : "UPDATE tasks SET updated_at=2, result='new result' WHERE id='t'");
    await options.executeTool?.('submit_review', { verdict: 'approve', summary: 'checked', findings: [] });
    return result;
  });
  expect(await runTaskReview({ db, userId: 'u', taskId: 't', apiKey: 'k', model: 'test' })).toHaveProperty('skipped');
  expect(sqlite.prepare('SELECT * FROM task_comments').all()).toHaveLength(0);
  expect(sqlite.prepare('SELECT * FROM usage_events').all()).toHaveLength(1);
});
