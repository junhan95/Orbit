#!/usr/bin/env node
/**
 * D1 마이그레이션 러너 — drizzle 의 migrator 와 같은 규칙으로 drizzle/ 폴더를 적용합니다.
 *
 *   node scripts/migrate.mjs                 # 로컬 D1(.wrangler/state) 에 미적용분 적용
 *   node scripts/migrate.mjs --remote        # 원격 D1 에 적용 (wrangler login + 실제 database_id 필요)
 *   node scripts/migrate.mjs --check         # 빈 임시 DB 에 0000 부터 전부 적용해 순서·문법 검증 (배포 전 확인용)
 *   node scripts/migrate.mjs --baseline      # 이미 손으로 적용한 DB 에 "전부 적용됨" 기록만 남김 (실행 없음)
 *   node scripts/migrate.mjs --status        # 적용/미적용 목록만 출력
 *
 * 규칙 (drizzle-orm/migrator 와 동일):
 *   - 순서와 대상은 drizzle/meta/_journal.json 의 entries 가 정합니다. 저널에 없는 .sql 은 무시합니다.
 *   - 각 파일은 `--> statement-breakpoint` 로 나뉜 문장들을 순서대로 실행합니다.
 *   - 적용 기록은 __drizzle_migrations(id, hash, created_at) 에 남기고, created_at(= journal.when) 보다
 *     큰 when 을 가진 항목만 새로 적용합니다. 따라서 journal.when 은 반드시 단조 증가해야 합니다.
 *
 * OpenAI Sites 배포: @openai/sites-vite-plugin 이 drizzle/** 를 dist/.openai/drizzle 로 복사하고
 * 플랫폼이 같은 저널을 읽어 원격 D1 에 적용합니다. --check 가 통과하면 배포 시에도 같은 순서로 적용됩니다.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DRIZZLE_DIR = join(ROOT, 'drizzle');
const JOURNAL = join(DRIZZLE_DIR, 'meta', '_journal.json');
const args = new Set(process.argv.slice(2));
const flag = (name) => args.has(`--${name}`);
const option = (name, fallback) => {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const remote = flag('remote');
const check = flag('check');
const baseline = flag('baseline');
const statusOnly = flag('status');
const config = option('config', 'dist/server/wrangler.json');
const binding = option('binding', 'DB');
const persistTo = check ? join(tmpdir(), `orbit-d1-check-${Date.now()}`) : option('persist-to', '.wrangler/state');

if (!existsSync(join(ROOT, config))) {
  console.error(`wrangler 설정을 찾을 수 없습니다: ${config}\n먼저 npm run build 를 실행하거나 --config= 로 지정하세요.`);
  process.exit(2);
}

const journal = JSON.parse(readFileSync(JOURNAL, 'utf8'));
const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
for (let index = 1; index < entries.length; index += 1) {
  if (entries[index].when <= entries[index - 1].when) {
    console.error(`journal.when 이 증가하지 않습니다: ${entries[index - 1].tag}(${entries[index - 1].when}) → ${entries[index].tag}(${entries[index].when})`);
    process.exit(2);
  }
}
for (const entry of entries) {
  if (!existsSync(join(DRIZZLE_DIR, `${entry.tag}.sql`))) {
    console.error(`저널에 있는 파일이 없습니다: drizzle/${entry.tag}.sql`);
    process.exit(2);
  }
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
function wrangler(argv, { json = false } = {}) {
  const full = ['wrangler', 'd1', 'execute', binding, remote ? '--remote' : '--local', '--config', config, ...(remote ? [] : ['--persist-to', persistTo]), ...(json ? ['--json'] : []), ...argv];
  const result = spawnSync(npx, full, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, NO_COLOR: '1' } });
  const stdout = `${result.stdout ?? ''}${json ? '' : result.stderr ?? ''}`.split('\n').filter((line) => !line.startsWith('npm notice')).join('\n');
  if (result.status !== 0) {
    throw new Error(`wrangler 실패 (${full.join(' ')})\n${stdout}\n${result.stderr ?? ''}`);
  }
  return stdout;
}

const SCRATCH = join(tmpdir(), `orbit-migrate-${process.pid}`);
mkdirSync(SCRATCH, { recursive: true });
let scratchSeq = 0;
/** 셸 인용 문제를 피하려고 모든 SQL 은 파일로 넘깁니다 */
function run(sql, { json = false } = {}) {
  const tmp = join(SCRATCH, `${(scratchSeq += 1)}.sql`);
  writeFileSync(tmp, sql, 'utf8');
  return wrangler(['--file', tmp], { json });
}
function query(sql) {
  const out = run(sql, { json: true });
  const start = out.indexOf('[');
  if (start < 0) throw new Error(`wrangler --json 출력을 해석할 수 없습니다:\n${out}`);
  const parsed = JSON.parse(out.slice(start));
  return parsed[0]?.results ?? [];
}

function splitStatements(sql) {
  return sql.split(/-->\s*statement-breakpoint/g).map((chunk) => chunk.trim()).filter(Boolean);
}

function hashOf(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

// 1) 기록 테이블 준비 + 마지막 적용 시각
run('CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric);');
const last = query('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1');
const lastAt = Number(last[0]?.created_at ?? 0);
const pending = entries.filter((entry) => entry.when > lastAt);
const applied = entries.filter((entry) => entry.when <= lastAt);

const target = remote ? '원격 D1' : check ? `임시 DB (${persistTo})` : `로컬 D1 (${persistTo})`;
console.log(`대상: ${target}`);
console.log(`적용됨 ${applied.length}개, 미적용 ${pending.length}개${pending.length ? `: ${pending.map((entry) => entry.tag).join(', ')}` : ''}`);

if (statusOnly) { cleanup(); process.exit(0); }
if (!pending.length) { console.log('적용할 마이그레이션이 없습니다.'); cleanup(); process.exit(0); }

// 2) 적용 (또는 baseline 기록)
try {
  for (const entry of pending) {
    const file = join(DRIZZLE_DIR, `${entry.tag}.sql`);
    const sql = readFileSync(file, 'utf8');
    const statements = baseline ? [] : splitStatements(sql);
    const record = `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${hashOf(sql)}', ${entry.when});`;
    // 한 파일 = 한 번의 wrangler 호출. 문장은 세미콜론으로 이어 붙이고(트리거의 BEGIN…END 도 wrangler 가 올바르게 나눕니다) 기록을 마지막에 붙입니다.
    const body = [...statements.map((statement) => (statement.endsWith(';') ? statement : `${statement};`)), record].join('\n');
    process.stdout.write(`${baseline ? '기록' : '적용'} ${entry.tag} (${statements.length}문장) … `);
    run(body);
    console.log('완료');
  }
  console.log(check ? '검증 통과: 빈 DB 에 전부 적용되었습니다.' : baseline ? '기준선 기록 완료.' : '마이그레이션 완료.');
} catch (error) {
  console.error(`\n실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  cleanup();
}

function cleanup() {
  rmSync(SCRATCH, { recursive: true, force: true });
  if (check) rmSync(persistTo, { recursive: true, force: true });
}
