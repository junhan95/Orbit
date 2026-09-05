import { afterEach, expect, it, vi } from 'vitest';
import { testDatabase } from './d1';
import { runTask } from '@/lib/run-task';
import { runClaudeAgent } from '@/lib/claude';
import { runInBackground } from '@/lib/memory-review';

vi.mock('@/lib/claude', async (original) => ({ ...await original<typeof import('@/lib/claude')>(), runClaudeAgent: vi.fn() }));
vi.mock('@/lib/memory-review', () => ({ runInBackground: vi.fn(), runMemoryReview: vi.fn() }));
const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => { vi.clearAllMocks(); for (const { sqlite } of databases.splice(0)) sqlite.close(); });

function setup() {
  const database = testDatabase(); databases.push(database);
  database.sqlite.exec("INSERT INTO tasks (id,user_id,title,label,owner,status,priority,accent,created_at,updated_at) VALUES ('t','u','test','test','agent','대기','중간','#000',0,0)");
  return { ...database, params: { db: database.db, userId: 'u', taskId: 't', apiKey: 'test', fallbackModel: 'test' } };
}
function response(stopReason: string) {
  return { id: 'r', model: 'test', text: 'partial', stopReason, iterations: 1, toolCalls: [], turns: [], usagePerIteration: [], usage: { inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, webSearchRequests: 0 } };
}

it.each(['insufficient_credits', 'max_iterations', 'max_tokens', 'end_turn'])('does not mark an unreported %s run as completed', async (stopReason) => {
  const { params, sqlite } = setup();
  vi.mocked(runClaudeAgent).mockResolvedValue(response(stopReason));
  const result = await runTask(params);
  expect(result.ok).toBe(true);
  if (result.ok) { expect(result.blocked).toBe(true); expect(result.status).toBe('대기'); expect(result.blockedReason).toBeTruthy(); }
  expect(sqlite.prepare('SELECT outcome FROM agent_runs').get()?.outcome).toBe('blocked');
  // Only the non-model health check is scheduled, not the task/memory review calls.
  expect(runInBackground).toHaveBeenCalledTimes(1);
});

it.each(['end_turn', 'max_tokens'])('rejects a concurrent run and preserves completed report with %s', async (stopReason) => {
  const { params, sqlite } = setup();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let resume!: () => void;
  const wait = new Promise<void>((resolve) => { resume = resolve; });
  vi.mocked(runClaudeAgent).mockImplementation(async (options) => {
    entered(); await wait;
    await options.executeTool?.('complete_task', { status: 'completed', summary: 'done', proof: ['checked'] });
    return response(stopReason);
  });
  const first = runTask(params); await started;
  expect(await runTask(params)).toMatchObject({ ok: false, status: 409 });
  resume();
  expect(await first).toMatchObject({ ok: true, blocked: false });
  expect(runClaudeAgent).toHaveBeenCalledOnce();
  expect(sqlite.prepare('SELECT * FROM runtime_leases').all()).toHaveLength(0);
});

it('does not let an expired run overwrite a newer task result', async () => {
  const { params, sqlite } = setup();
  vi.mocked(runClaudeAgent).mockImplementation(async () => {
    sqlite.exec("UPDATE runtime_leases SET token = 'new-owner'; UPDATE tasks SET result = 'new result', status = '검토' WHERE id = 't'");
    return response('end_turn');
  });
  expect(await runTask(params)).toMatchObject({ ok: false, status: 409 });
  expect(sqlite.prepare("SELECT result FROM tasks WHERE id = 't'").get()?.result).toBe('new result');
});
