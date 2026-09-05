import { afterEach, expect, it } from 'vitest';
import { acquireLease, leasedBatch, releaseLease, renewLease } from '@/lib/leases';
import { testDatabase } from './d1';
const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => { for (const { sqlite } of databases.splice(0)) sqlite.close(); });

it('only one request owns a task; an expired owner cannot update or release its successor', async () => {
  const database = testDatabase(); databases.push(database);
  const { db, sqlite } = database;
  const leases = await Promise.all([acquireLease(db, 'task:u:t'), acquireLease(db, 'task:u:t')]);
  expect(leases.filter(Boolean)).toHaveLength(1);
  const first = leases.find((lease) => lease !== null)!;
  await renewLease(db, first);
  sqlite.exec('UPDATE runtime_leases SET expires_at = 0');
  const second = (await acquireLease(db, first.key))!;
  await expect(leasedBatch(db, first, [db.prepare("INSERT INTO gate_events (id,user_id,gate,decision,created_at) VALUES ('bad','u','test','allow',0)")])).rejects.toThrow();
  expect(sqlite.prepare('SELECT * FROM gate_events').all()).toHaveLength(0);
  await releaseLease(db, first);
  expect(await acquireLease(db, first.key)).toBeNull();
  await releaseLease(db, second);
  expect(await acquireLease(db, first.key)).not.toBeNull();
});
