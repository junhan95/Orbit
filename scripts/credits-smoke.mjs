// 크레딧 경로 스모크 테스트 (개발용, 로컬 D1 전용).  실행: node scripts/credits-smoke.mjs [--zero]
//   --zero : 잔액을 0 으로 만든 상태에서 402(insufficient_credits) 응답이 오는지만 확인 (Anthropic 호출 없음)
// 크레딧 경로 실호출. 로컬 D1 에서 사용자의 BYOK 키 행을 잠시 옆으로 치워(user_id 변경) 크레딧 경로로 만들고,
// /api/chat 에 짧은 메시지를 보낸 뒤 원장에 usage 행이 남는지 확인합니다. 끝나면 키 행과 세션을 원래대로 돌립니다.
// (실제 Anthropic 호출 1회 발생 — .env 의 ANTHROPIC_API_KEY 가 운영자 키 역할)
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'orbit-smoke-'));
let seq = 0;
function d1(sql) {
  const file = join(dir, `${(seq += 1)}.sql`);
  writeFileSync(file, sql, 'utf8');
  const r = spawnSync('npx.cmd', ['wrangler', 'd1', 'execute', 'DB', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', '.wrangler/state', '--json', '--file', file], { cwd: ROOT, encoding: 'utf8', shell: true, env: { ...process.env, NO_COLOR: '1' } });
  const out = `${r.stdout}`;
  const start = out.indexOf('[');
  if (r.status !== 0 || start < 0) throw new Error(`wrangler 실패\n${out}\n${r.stderr}`);
  return JSON.parse(out.slice(start))[0]?.results ?? [];
}
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const user = d1('SELECT id, email FROM users ORDER BY created_at LIMIT 1')[0];
const ctx = d1(`SELECT p.id AS projectId, a.id AS agentId, a.name AS agentName FROM projects p JOIN project_agents pa ON pa.project_id = p.id AND pa.user_id = p.user_id JOIN agents a ON a.id = pa.agent_id AND a.user_id = p.user_id WHERE p.user_id = '${user.id}' AND a.is_manager = 0 LIMIT 1`)[0]
  ?? d1(`SELECT p.id AS projectId, a.id AS agentId, a.name AS agentName FROM projects p JOIN project_agents pa ON pa.project_id = p.id AND pa.user_id = p.user_id JOIN agents a ON a.id = pa.agent_id AND a.user_id = p.user_id WHERE p.user_id = '${user.id}' LIMIT 1`)[0];
if (!ctx) { console.log('프로젝트/에이전트가 없어 대화를 보낼 수 없습니다.'); process.exit(2); }

const token = b64url(randomBytes(32));
const sid = b64url(createHash('sha256').update(token).digest());
const now = Date.now();
const PARKED = `__parked__${user.id}`;
d1(`INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES ('${sid}', '${user.id}', ${now}, ${now + 600000}, 'smoke');`);
const hadKey = d1(`SELECT COUNT(*) AS n FROM user_keys WHERE user_id = '${user.id}'`)[0].n > 0;
if (hadKey) d1(`UPDATE user_keys SET user_id = '${PARKED}' WHERE user_id = '${user.id}';`);
const zero = process.argv.includes('--zero');
let adjustId = null;
if (zero) {
  const bal = d1(`SELECT COALESCE(SUM(amount_mc),0) AS mc FROM credit_ledger WHERE user_id = '${user.id}'`)[0].mc;
  adjustId = `smoke-${now}`;
  d1(`INSERT INTO credit_ledger (id, user_id, kind, bucket, amount_mc, ref_type, ref_id, meta, created_at) VALUES ('${adjustId}', '${user.id}', 'adjust', 'promo', ${-bal}, 'smoke', NULL, NULL, ${now});`);
}
try {
  const before = d1(`SELECT COALESCE(SUM(amount_mc),0) AS mc, COUNT(*) AS n FROM credit_ledger WHERE user_id = '${user.id}'`)[0];
  const modeRes = await fetch('http://localhost:3000/api/credits', { headers: { cookie: `orbit_session=${token}` } }).then((r) => r.json());
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST', headers: { cookie: `orbit_session=${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: ctx.projectId, agentId: ctx.agentId, message: '(크레딧 과금 테스트) 한 단어로만 답해 주세요: 안녕' }),
  });
  const body = await res.json().catch(() => null);
  const after = d1(`SELECT COALESCE(SUM(amount_mc),0) AS mc, COUNT(*) AS n FROM credit_ledger WHERE user_id = '${user.id}'`)[0];
  const rows = d1(`SELECT kind, bucket, amount_mc, ref_type, meta FROM credit_ledger WHERE user_id = '${user.id}' AND kind = 'usage' ORDER BY created_at DESC LIMIT 3`);
  console.log(JSON.stringify({ user: user.email, agent: ctx.agentName, modeBefore: modeRes.mode, status: res.status,
    reply: body?.assistantMessage?.content?.slice(0, 80) ?? body?.error, before, after, usageRows: rows }, null, 2));
} finally {
  if (adjustId) d1(`DELETE FROM credit_ledger WHERE id = '${adjustId}';`);
  if (hadKey) d1(`UPDATE user_keys SET user_id = '${user.id}' WHERE user_id = '${PARKED}';`);
  d1(`DELETE FROM sessions WHERE id = '${sid}';`);
  const restored = d1(`SELECT COUNT(*) AS n FROM user_keys WHERE user_id = '${user.id}'`)[0].n;
  console.log(`키 행 복구: ${hadKey ? (restored === 1 ? 'OK' : '실패!') : '해당 없음'}`);
}
