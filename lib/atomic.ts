/** A CHECK assertion inside D1 batch keeps the precondition and all effects atomic.
 * Rows are removed in the same transaction; failed batches roll back the assertion too.
 * Conditions must be source-owned SQL; values are bound parameters.
 */
export async function atomicBatch(db: D1Database, condition: string, values: unknown[], statements: D1PreparedStatement[]) {
  const id = crypto.randomUUID();
  return db.batch([
    db.prepare(`INSERT INTO transaction_guards (id, passed) VALUES (?, CASE WHEN (${condition}) THEN 1 ELSE 0 END)`).bind(id, ...values),
    ...statements,
    db.prepare('DELETE FROM transaction_guards WHERE id = ?').bind(id),
  ]);
}

export function isPreconditionError(error: unknown): boolean {
  return error instanceof Error && /transaction_guard_passed/.test(error.message);
}
