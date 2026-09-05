/**
 * 프로젝트에 속하지 않은(=쓸 수 없는) 에이전트를 정리합니다.
 *
 * 대상: agents.project_id 가 NULL 이고, project_agents 배정도 없고,
 *       업무/하위작업의 담당자(owner)로도 쓰이지 않는 행.
 * 연결된 project_agents · chat_messages · agent_runs 는 FK ON DELETE CASCADE 로 함께 정리됩니다.
 *
 * 사용법 (로컬 D1 = miniflare sqlite):
 *   node scripts/cleanup-orphan-agents.mjs            # 미리보기만
 *   node scripts/cleanup-orphan-agents.mjs --apply    # 실제 삭제
 *   node scripts/cleanup-orphan-agents.mjs --apply --db <sqlite 경로>
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dbFlag = args.indexOf('--db');

function findLocalDatabase() {
  const dir = path.join(process.cwd(), '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
  const file = readdirSync(dir).filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite').sort()[0];
  if (!file) throw new Error('로컬 D1 데이터베이스를 찾지 못했습니다. --db 로 경로를 지정하세요.');
  return path.join(dir, file);
}

const dbPath = dbFlag !== -1 ? args[dbFlag + 1] : findLocalDatabase();
const db = new DatabaseSync(dbPath);

const orphans = db.prepare(`
  SELECT a.id, a.name, a.role, a.user_id AS userId
  FROM agents a
  WHERE a.project_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM project_agents pa WHERE pa.agent_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.user_id = a.user_id AND t.owner = a.name)
    AND NOT EXISTS (SELECT 1 FROM subtasks s WHERE s.user_id = a.user_id AND s.owner = a.name)
  ORDER BY a.created_at
`).all();

console.log(`데이터베이스: ${dbPath}`);
if (!orphans.length) { console.log('정리할 미지정 에이전트가 없습니다.'); process.exit(0); }

console.log(`미지정 에이전트 ${orphans.length}명:`);
for (const agent of orphans) console.log(`  - ${agent.name} (${agent.role})`);

if (!apply) { console.log('\n미리보기입니다. 실제로 지우려면 --apply 를 붙여 다시 실행하세요.'); process.exit(0); }

db.exec('PRAGMA foreign_keys = ON');
const remove = db.prepare('DELETE FROM agents WHERE id = ?');
for (const agent of orphans) remove.run(agent.id);
console.log(`\n${orphans.length}명을 삭제했습니다.`);
