import { atomicBatch } from './atomic';

export const LEASE_TTL_MS = 5 * 60_000;
export class LeaseLostError extends Error {
  constructor() { super('실행 권한이 만료되었거나 다른 요청으로 넘어갔습니다.'); }
}
export type Lease = { key: string; token: string };
export async function acquireLease(db: D1Database, key: string): Promise<Lease | null> {
  const token = crypto.randomUUID();
  const now = Date.now();
  const row = await db.prepare(`INSERT INTO runtime_leases (resource_key, token, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(resource_key) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
    WHERE runtime_leases.expires_at <= ? RETURNING token`).bind(key, token, now + LEASE_TTL_MS, now).first<{ token: string }>();
  return row ? { key, token } : null;
}
export async function renewLease(db: D1Database, lease: Lease): Promise<void> {
  const now = Date.now();
  const row = await db.prepare('UPDATE runtime_leases SET expires_at = ? WHERE resource_key = ? AND token = ? AND expires_at > ? RETURNING token')
    .bind(now + LEASE_TTL_MS, lease.key, lease.token, now).first();
  if (!row) throw new LeaseLostError();
}
export async function releaseLease(db: D1Database, lease: Lease): Promise<void> {
  await db.prepare('DELETE FROM runtime_leases WHERE resource_key = ? AND token = ?').bind(lease.key, lease.token).run();
}
export function leasedBatch(db: D1Database, lease: Lease, statements: D1PreparedStatement[]) {
  return atomicBatch(db, 'EXISTS (SELECT 1 FROM runtime_leases WHERE resource_key = ? AND token = ? AND expires_at > ?)', [lease.key, lease.token, Date.now()], statements);
}
