/**
 * Cloudflare Workers 배포 도우미.
 *
 * `npm run build` 가 만드는 dist/server/wrangler.json 은 Sites 호스팅용이라 Worker 이름이
 * 'sites-project' 이고 D1 id 가 자리표시자입니다. 이 스크립트는 그 파일 위에 실제 값을 덧씌운
 * dist/server/wrangler.deploy.json 을 만들고, 원하는 단계만 실행합니다.
 *
 *   node scripts/deploy.mjs config     배포용 설정만 생성 (wrangler.deploy.json 에서 name / d1 / vars 읽음)
 *   node scripts/deploy.mjs migrate    원격 D1 에 미적용 마이그레이션 적용
 *   node scripts/deploy.mjs deploy     wrangler deploy
 *   node scripts/deploy.mjs all        build → config → migrate → deploy
 *
 * 실제 값은 저장소 루트의 wrangler.deploy.json 에 둡니다 (비밀값 없음 — 시크릿은 wrangler secret put).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const GENERATED = 'dist/server/wrangler.json';
const OUT = 'dist/server/wrangler.deploy.json';
const OVERLAY = 'wrangler.deploy.json';

const step = process.argv[2] ?? 'config';
const sh = (cmd) => { console.log(`\n$ ${cmd}`); execSync(cmd, { stdio: 'inherit' }); };

function makeConfig() {
  if (!existsSync(GENERATED)) throw new Error(`${GENERATED} 가 없습니다. 먼저 npm run build 를 실행하세요.`);
  if (!existsSync(OVERLAY)) throw new Error(`${OVERLAY} 가 없습니다. wrangler.deploy.example.json 을 복사해 채우세요.`);
  const base = JSON.parse(readFileSync(GENERATED, 'utf8'));
  const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
  if (!overlay.d1?.database_id || /^0{8}-/.test(overlay.d1.database_id)) {
    throw new Error('wrangler.deploy.json 의 d1.database_id 가 비어 있습니다. `wrangler d1 create orbit` 결과를 넣으세요.');
  }
  const config = {
    ...base,
    name: overlay.name || 'orbit',
    // 로컬 dev 전용 블록은 배포에 필요 없습니다.
    dev: undefined,
    d1_databases: [{ binding: 'DB', database_name: overlay.d1.database_name || 'orbit', database_id: overlay.d1.database_id }],
    // 비밀이 아닌 설정값. 시크릿(AUTH_SECRET 등)은 여기 넣지 말고 wrangler secret put 으로.
    vars: { ...base.vars, ...overlay.vars },
    ...(overlay.routes ? { routes: overlay.routes } : {}),
    ...(overlay.workers_dev !== undefined ? { workers_dev: overlay.workers_dev } : {}),
  };
  delete config.dev;
  writeFileSync(OUT, JSON.stringify(config, null, 2));
  console.log(`배포용 설정 생성 → ${OUT}  (name=${config.name}, d1=${config.d1_databases[0].database_id.slice(0, 8)}…, vars=${Object.keys(config.vars).join(',') || '없음'})`);
}

switch (step) {
  case 'config': makeConfig(); break;
  case 'migrate': makeConfig(); sh(`node scripts/migrate.mjs --remote --config=${OUT}`); break;
  case 'deploy': makeConfig(); sh(`npx wrangler deploy --config ${OUT}`); break;
  case 'all': sh('npm run build'); makeConfig(); sh(`node scripts/migrate.mjs --remote --config=${OUT}`); sh(`npx wrangler deploy --config ${OUT}`); break;
  default: throw new Error(`알 수 없는 단계: ${step} (config | migrate | deploy | all)`);
}
