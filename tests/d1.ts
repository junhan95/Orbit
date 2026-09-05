import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

/** Real SQLite statements and synchronous transaction boundaries, matching D1 batch isolation. */
export function testDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries) sqlite.exec(readFileSync(new URL(`../drizzle/${tag}.sql`, import.meta.url), 'utf8'));
  function prepare(sql: string) {
    let values: SQLInputValue[] = [];
    return {
      bind(...args: SQLInputValue[]) { values = args; return this; },
      execute() {
        const statement = sqlite.prepare(sql);
        const results = statement.all(...values);
        const changes = sqlite.prepare('SELECT changes() AS n').get()?.n;
        return { success: true, results, meta: { changes: Number(changes) } };
      },
      async run() { return this.execute(); },
      async first(column?: string) { const row = sqlite.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
      async all() { return this.execute(); },
    };
  }
  const db = { prepare, async batch(statements: ReturnType<typeof prepare>[]) {
    sqlite.exec('BEGIN');
    try { const results = statements.map((statement) => statement.execute()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  return { sqlite, db };
}
