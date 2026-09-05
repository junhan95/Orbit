/**
 * 프로젝트에 속하지 않은(project_id IS NULL) 업무를 로컬 D1 에서 정리합니다.
 *
 *   node scripts/cleanup-orphan-tasks.mjs          # 무엇이 지워질지만 보여줍니다
 *   node scripts/cleanup-orphan-tasks.mjs --apply  # 실제로 삭제합니다
 *
 * 대쉬보드는 프로젝트 진행 상황과 연동되므로, 프로젝트가 없는 업무는 어디에도 보이지 않는
 * 고아 데이터가 됩니다. (프로젝트를 지울 때 업무를 남기면 이런 행이 생깁니다.)
 * 개발 서버(vinext dev)를 끄고 실행하세요 — 실행 중이면 DB 파일이 잠겨 있을 수 있습니다.
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const D1_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const apply = process.argv.includes('--apply');

const files = readdirSync(D1_DIR).filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
if (!files.length) {
  console.error(`로컬 D1 파일을 찾지 못했습니다: ${D1_DIR}`);
  process.exit(1);
}

for (const file of files) {
  const path = join(D1_DIR, file);
  const db = new DatabaseSync(path);
  const orphans = db.prepare("SELECT id, title, owner, status FROM tasks WHERE project_id IS NULL").all();

  console.log(`\n[${file}] 프로젝트 없는 업무 ${orphans.length}건`);
  for (const task of orphans) console.log(`  - ${String(task.title)} (${String(task.owner)} / ${String(task.status)})`);

  if (apply && orphans.length) {
    const ids = orphans.map((task) => task.id);
    const placeholders = ids.map(() => '?').join(',');
    // recall_docs 는 FTS 트리거가 붙어 있어 DELETE 만으로 인덱스까지 함께 정리됩니다.
    db.prepare(`DELETE FROM recall_docs WHERE kind = 'task' AND ref_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM task_field_values WHERE task_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM subtasks WHERE task_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM task_comments WHERE task_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...ids);
    console.log(`  → ${ids.length}건 삭제 완료`);
  }
  db.close();
}

if (!apply) console.log('\n미리보기입니다. 실제로 지우려면 --apply 를 붙여 다시 실행하세요.');
