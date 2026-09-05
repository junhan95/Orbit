/**
 * 기존 로컬 D1(sqlite) 레코드의 색상을 DESIGN-airtable.md 팔레트로 바꿉니다.
 * 시드 코드는 이미 새 팔레트를 쓰지만, 먼저 만들어진 행은 옛 보라/청록 색을 그대로 들고 있습니다.
 *
 *   node scripts/recolor-airtable.mjs          # 미리보기
 *   node scripts/recolor-airtable.mjs --apply  # 실제 반영
 *
 * 실행 전에 dev 서버를 멈추세요 (sqlite 잠금).
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const D1_DIR = join(process.cwd(), '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');

// 옛 팔레트 -> Airtable 시그니처 팔레트 (모두 흰 글자가 얹히는 어두운 톤)
const MAP = {
  '#6651f2': '#181d26',
  '#7559ff': '#aa2d00',
  '#ff7557': '#0a2e0e',
  '#f05d3c': '#aa2d00',
  '#16a98c': '#d9a441',
  '#3478f6': '#1a3866',
};
const PALETTE = ['#181d26', '#aa2d00', '#0a2e0e', '#d9a441', '#1a3866'];
const apply = process.argv.includes('--apply');

const file = readdirSync(D1_DIR).find((f) => f.endsWith('.sqlite') && !f.startsWith('metadata'));
if (!file) throw new Error(`D1 파일을 찾지 못했습니다: ${D1_DIR}`);
const db = new DatabaseSync(join(D1_DIR, file));

const TARGETS = [
  { table: 'agents', column: 'color' },
  { table: 'projects', column: 'color' },
  { table: 'tasks', column: 'accent' },
];

let n = 0;
for (const { table, column } of TARGETS) {
  let rows;
  try {
    rows = db.prepare(`SELECT id, ${column} AS c FROM ${table}`).all();
  } catch {
    console.log(`- ${table}: 테이블 없음, 건너뜀`);
    continue;
  }
  for (const row of rows) {
    const cur = String(row.c || '').toLowerCase();
    if (PALETTE.includes(cur)) continue;
    const next = MAP[cur] ?? PALETTE[n % PALETTE.length];
    console.log(`${table}.${column} ${String(row.id)}: ${cur || '(빈값)'} -> ${next}`);
    if (apply) db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(next, row.id);
    n += 1;
  }
}
db.close();
console.log(apply ? `\n${n}건 반영했습니다.` : `\n${n}건이 바뀝니다. 반영하려면 --apply 를 붙여 다시 실행하세요.`);
