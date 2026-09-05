#!/usr/bin/env node
/**
 * 연속 eval 러너 — AI-Native SDLC 플레이북의 "continuous evals" 를 Orbit 에 옮긴 것.
 *
 * 실제 있었던 실행을 케이스로 굳혀 두고, 프롬프트·기억 규칙·스킬·검토 정책·모델이 바뀔 때마다 돌려 회귀를 잡습니다.
 * 케이스는 evals/cases/*.json, 결과는 evals/results/<시각>.json 에 남습니다.
 *
 *   npm run evals                      # 전부 실행 (dev 서버가 http://localhost:3000 에 떠 있어야 함)
 *   npm run evals -- --only=blocked    # id 에 'blocked' 가 들어간 케이스만
 *   npm run evals -- --keep            # 끝나고 eval 프로젝트를 지우지 않음 (결과를 화면에서 보고 싶을 때)
 *   npm run evals -- --judge           # LLM 판정(judge) 검사까지 실행 (.env 의 ANTHROPIC_API_KEY 사용, 기본은 건너뜀)
 *   EVAL_BASE_URL=https://… npm run evals
 *
 * 케이스 형식:
 *   { id, title, why, tags?, setup: { memory?: [{scope,content}], skills?: [{name,description,body}], task?: {...}, comments?: [..], chat?: [..] },
 *     action: 'run' | 'plan' | 'chat' | 'review', input?: {...},
 *     checks: [ { type, ...args, soft?: true } ] }
 * 검사 종류는 아래 CHECKS 를 보세요. soft:true 는 실패해도 경고로만 집계합니다.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CASES_DIR = join(ROOT, 'evals', 'cases');
const RESULTS_DIR = join(ROOT, 'evals', 'results');
const BASE = (process.env.EVAL_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => { const hit = args.find((item) => item.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : null; };
const ONLY = option('only');
const KEEP = flag('keep');
const JUDGE = flag('judge');
const PASS_THRESHOLD = Number(option('threshold') ?? 1);
const REVIEW_WAIT_MS = 150_000;
const AGENTS = [
  { name: 'E-Bolt', role: '엔지니어', description: '기술 설계와 구현 계획', instructions: '요구사항을 안전하고 유지보수 가능한 기술 설계와 구현 단계로 변환하세요.' },
  { name: 'E-Lint', role: 'QA 엔지니어', description: '품질 기준과 테스트 시나리오 점검', instructions: '실패 가능성이 높은 경로를 우선해 재현 가능한 테스트와 품질 리스크를 작성하세요.' },
  { name: 'E-Mira', role: '리서처', description: '자료 조사와 근거 정리', instructions: '출처, 사실, 추론을 구분해 핵심 인사이트를 작성하세요.' },
];

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const init = { method };
  if (body !== undefined && method !== 'GET') { init.headers = { 'content-type': 'application/json' }; init.body = JSON.stringify(body); }
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: response.status, data };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForReview(taskId) {
  const started = Date.now();
  while (Date.now() - started < REVIEW_WAIT_MS) {
    const { data } = await api('GET', `/api/tasks/${taskId}/detail`);
    if (data?.task?.reviewVerdict) return data;
    await sleep(5_000);
  }
  return (await api('GET', `/api/tasks/${taskId}/detail`)).data;
}

// ── LLM 판정 (선택) ───────────────────────────────────────────────────────────
function readEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => { const index = line.indexOf('='); return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, '')]; }));
}
async function judge(rubric, material) {
  const env = readEnv();
  const apiKey = process.env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY;
  if (!apiKey) return { pass: false, note: 'ANTHROPIC_API_KEY 없음' };
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_REVIEW_MODEL ?? env.ANTHROPIC_REVIEW_MODEL ?? 'claude-haiku-4-5', max_tokens: 300,
      system: '당신은 채점자입니다. 주어진 기준(rubric)에 대해 결과물이 통과인지 판단하고, 첫 줄에 PASS 또는 FAIL, 둘째 줄에 한 문장 이유만 쓰세요.',
      messages: [{ role: 'user', content: `# 기준\n${rubric}\n\n# 결과물\n${material.slice(0, 12_000)}` }],
    }),
  });
  const data = await response.json();
  const text = (data.content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim();
  return { pass: /^PASS/i.test(text), note: text.split('\n').slice(0, 2).join(' ') };
}

// ── 검사 ─────────────────────────────────────────────────────────────────────
const CHECKS = {
  status: (ctx, c) => ok(ctx.run?.status === c.equals, `status=${ctx.run?.status} (기대 ${c.equals})`),
  tool_called: (ctx, c) => ok(toolCalls(ctx).includes(c.name), `${c.name} 호출 ${toolCalls(ctx).includes(c.name) ? '있음' : '없음'}: [${toolCalls(ctx).join(',')}]`),
  tool_not_called: (ctx, c) => ok(!toolCalls(ctx).includes(c.name), `${c.name} 호출 ${toolCalls(ctx).includes(c.name) ? '있음(금지)' : '없음'}`),
  tool_count_max: (ctx, c) => { const n = toolCalls(ctx).filter((name) => name === c.name).length; return ok(n <= c.max, `${c.name} ${n}회 (최대 ${c.max})`); },
  iterations_max: (ctx, c) => ok((ctx.run?.iterations ?? 99) <= c.max, `iterations=${ctx.run?.iterations} (최대 ${c.max})`),
  blocked_reason: (ctx, c) => ok(Boolean(ctx.run?.blockedReason) === (c.present !== false), `blockedReason=${JSON.stringify(ctx.run?.blockedReason ?? null).slice(0, 80)}`),
  proof_min: (ctx, c) => { const n = proofOf(ctx).length; return ok(n >= c.min, `proof ${n}개 (최소 ${c.min})`); },
  text_includes: (ctx, c) => { const hay = textOf(ctx, c.field); const hit = (c.any ?? []).find((needle) => hay.includes(needle)); return ok(Boolean(hit), hit ? `'${hit}' 포함` : `[${(c.any ?? []).join(' | ')}] 중 아무것도 없음`); },
  text_excludes: (ctx, c) => { const hay = textOf(ctx, c.field); const hit = (c.any ?? []).find((needle) => hay.includes(needle)); return ok(!hit, hit ? `'${hit}' 포함(금지)` : '금지어 없음'); },
  text_length_max: (ctx, c) => { const n = textOf(ctx, c.field).length; return ok(n <= c.max, `${c.field} ${n}자 (최대 ${c.max})`); },
  review_verdict: (ctx, c) => ok(ctx.detail?.task?.reviewVerdict === c.equals, `reviewVerdict=${ctx.detail?.task?.reviewVerdict ?? '(없음)'} (기대 ${c.equals})`),
  review_or_blocked: (ctx) => { const blocked = ctx.run?.status === '대기' && Boolean(ctx.run?.blockedReason); const caught = ctx.detail?.task?.reviewVerdict === 'changes_requested'; return ok(blocked || caught, blocked ? '막힘으로 보고' : caught ? '검토에서 수정 요청' : `잡히지 않음 (status=${ctx.run?.status}, verdict=${ctx.detail?.task?.reviewVerdict ?? '없음'})`); },
  pending_memory_max: async (ctx, c) => { const { data } = await api('GET', `/api/memory?scope=project&scopeId=${ctx.projectId}`); const pending = (data?.groups ?? []).reduce((sum, group) => sum + (group.pendingCount ?? 0), 0); return ok(pending <= c.max, `pending 기억 ${pending}건 (최대 ${c.max})`); },
  plan_tasks: (ctx, c) => { const tasks = ctx.plan?.proposal?.tasks ?? []; const names = new Set(ctx.agentNames); const problems = []; if (tasks.length < (c.min ?? 1) || tasks.length > (c.max ?? 99)) problems.push(`개수 ${tasks.length}`); if (new Set(tasks.map((t) => t.title)).size !== tasks.length) problems.push('제목 중복'); for (const t of tasks) { if (!names.has(t.owner)) problems.push(`담당 미상 ${t.owner}`); if ((t.description ?? '').length < (c.minDescription ?? 40)) problems.push(`설명 짧음: ${t.title}`); } return ok(!problems.length, problems.length ? problems.join(', ') : `카드 ${tasks.length}개, 담당·설명 모두 유효`); },
  created_tasks_eq: (ctx, c) => { const n = (ctx.run?.createdTasks ?? []).length; return ok(n === c.equals, `생성된 카드 ${n}개 (기대 ${c.equals})`); },
  approvals_pending_min: async (ctx, c) => { const { data } = await api('GET', '/api/approvals'); const mine = (data?.approvals ?? []).filter((row) => row.taskId === ctx.taskId); ctx.approvals = mine; return ok(mine.length >= c.min, `승인 대기 ${mine.length}건 (최소 ${c.min}): ${mine.map((row) => row.action).join(',')}`); },
  approvals_include: async (ctx, c) => { const rows = ctx.approvals ?? (await api('GET', '/api/approvals')).data?.approvals?.filter((row) => row.taskId === ctx.taskId) ?? []; const hit = rows.some((row) => row.action === c.action); return ok(hit, hit ? `${c.action} 대기 있음` : `${c.action} 대기 없음 (모델이 scope 를 다르게 골랐을 수 있음)`); },
  health_metrics: (ctx, c) => { const metrics = ctx.health?.metrics ?? []; const tiers = new Set(['ok', 'watch', 'diagnose', 'act', 'insufficient']); const bad = metrics.filter((m) => !tiers.has(m.tier) || typeof m.note !== 'string'); const missing = (c.keys ?? []).filter((key) => !metrics.some((m) => m.key === key)); return ok(!bad.length && !missing.length, missing.length ? `지표 누락: ${missing.join(',')}` : bad.length ? `형식 오류 ${bad.length}건` : `지표 ${metrics.length}개: ${metrics.map((m) => `${m.key}=${m.tier}`).join(', ')}`); },
  judge: async (ctx, c) => { if (!JUDGE) return { pass: true, skipped: true, note: '--judge 없음 (건너뜀)' }; const result = await judge(c.rubric, textOf(ctx, c.field ?? 'output')); return ok(result.pass, result.note); },
};
const ok = (pass, note) => ({ pass: Boolean(pass), note });
const toolCalls = (ctx) => ctx.run?.toolCalls ?? [];
/** 실행 댓글의 '검증 근거:' 아래 목록을 셉니다 (빈 줄 전까지의 '- ' 항목) */
const proofOf = (ctx) => {
  const comment = (ctx.detail?.comments ?? []).find((item) => item.authorKind === 'agent' && item.content.startsWith('✅'));
  const section = comment?.content.split('검증 근거:')[1];
  if (!section) return [];
  const items = [];
  for (const line of section.split('\n').slice(1)) { if (!line.trim()) break; if (line.startsWith('- ')) items.push(line.slice(2)); }
  return items;
};
const textOf = (ctx, field = 'output') => {
  if (field === 'chat') return ctx.chat?.assistantMessage?.content ?? '';
  if (field === 'plan') return JSON.stringify(ctx.plan?.proposal ?? {});
  if (field === 'review') return (ctx.detail?.comments ?? []).filter((item) => item.content.startsWith('🔍')).map((item) => item.content).join('\n');
  return String(ctx.run?.[field] ?? '');
};

// ── eval 팀원 시드 (로컬 D1 전용) ───────────────────────────────────────────
function seedAgents(projectId) {
  const config = 'dist/server/wrangler.json';
  if (!existsSync(join(ROOT, config))) { console.error(`wrangler 설정(${config})이 없어 eval 팀원을 만들 수 없습니다. npm run build 를 먼저 실행하세요.`); process.exit(2); }
  const now = Date.now();
  const colors = ['#1a3866', '#4a2b6b', '#aa2d00'];
  const sql = AGENTS.map((agent, index) => {
    const id = crypto.randomUUID();
    const esc = (value) => String(value).replace(/'/g, "''");
    return `INSERT INTO agents (id, user_id, name, role, description, instructions, color, is_default, created_at, project_id, is_manager, role_key)
      SELECT '${id}', user_id, '${esc(agent.name)}', '${esc(agent.role)}', '${esc(agent.description)}', '${esc(agent.instructions)}', '${colors[index]}', 0, ${now + index}, '${projectId}', 0, NULL
      FROM projects WHERE id = '${projectId}';
INSERT OR IGNORE INTO project_agents (project_id, agent_id, user_id, assigned_at) SELECT '${projectId}', '${id}', user_id, ${now} FROM projects WHERE id = '${projectId}';`;
  }).join('\n');
  const file = join(tmpdir(), `orbit-eval-agents-${process.pid}.sql`);
  writeFileSync(file, sql, 'utf8');
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npx, ['wrangler', 'd1', 'execute', 'DB', '--local', '--config', config, '--persist-to', '.wrangler/state', '--file', file], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  rmSync(file, { force: true });
  if (result.status !== 0) { console.error(`eval 팀원 시드 실패:\n${result.stdout}\n${result.stderr}`); process.exit(2); }
}

// ── 케이스 실행 ──────────────────────────────────────────────────────────────
async function runCase(kase, env) {
  const ctx = { projectId: env.projectId, agentNames: env.agentNames };
  const setup = kase.setup ?? {};
  for (const memory of setup.memory ?? []) {
    await api('POST', '/api/memory', { scope: 'project', scopeId: env.projectId, content: memory.content });
  }
  for (const skill of setup.skills ?? []) {
    await api('POST', '/api/skills', { scope: 'project', projectId: env.projectId, ...skill });
  }
  if (setup.task) {
    const { data, status } = await api('POST', '/api/tasks', { projectId: env.projectId, label: '검증', ...setup.task });
    if (status >= 300) throw new Error(`업무 생성 실패: ${JSON.stringify(data)}`);
    ctx.taskId = data.task.id;
    for (const comment of setup.comments ?? []) await api('POST', `/api/tasks/${ctx.taskId}/comments`, { content: comment });
  }

  if (kase.action === 'run') {
    const { data, status } = await api('POST', '/api/agents/run', { taskId: ctx.taskId, ...kase.input });
    ctx.run = data; ctx.runStatus = status;
    if (status >= 300 && status !== 409) throw new Error(`실행 실패 (${status}): ${data?.error}`);
    const needsReview = kase.checks.some((check) => ['review_verdict', 'review_or_blocked', 'proof_min', 'pending_memory_max'].includes(check.type) || check.field === 'review');
    ctx.detail = needsReview && data?.status === '검토' ? await waitForReview(ctx.taskId) : (await api('GET', `/api/tasks/${ctx.taskId}/detail`)).data;
    if (needsReview && data?.status !== '검토') await sleep(8_000); // 백그라운드 기억 리뷰가 끝날 시간
  } else if (kase.action === 'plan') {
    const { data, status } = await api('POST', `/api/projects/${env.projectId}/plan`, kase.input ?? {});
    if (status >= 300) throw new Error(`계획 실패 (${status}): ${data?.error}`);
    ctx.plan = data;
  } else if (kase.action === 'chat') {
    const { data, status } = await api('POST', '/api/chat', { projectId: env.projectId, agentId: env.managerId, ...kase.input });
    if (status >= 300) throw new Error(`대화 실패 (${status}): ${data?.error}`);
    ctx.chat = data;
  } else if (kase.action === 'health') {
    const { data, status } = await api('GET', '/api/health');
    if (status >= 300) throw new Error(`health 실패 (${status}): ${data?.error}`);
    ctx.health = data;
  } else if (kase.action === 'review') {
    const { data, status } = await api('POST', `/api/tasks/${ctx.taskId}/review`);
    if (status >= 300) throw new Error(`검토 실패 (${status}): ${data?.error}`);
    ctx.detail = (await api('GET', `/api/tasks/${ctx.taskId}/detail`)).data;
  } else {
    throw new Error(`알 수 없는 action: ${kase.action}`);
  }

  const results = [];
  for (const check of kase.checks) {
    const handler = CHECKS[check.type];
    if (!handler) { results.push({ ...check, pass: false, note: '알 수 없는 검사' }); continue; }
    try { results.push({ ...check, ...(await handler(ctx, check)) }); } catch (error) { results.push({ ...check, pass: false, note: `검사 오류: ${error instanceof Error ? error.message : String(error)}` }); }
  }
  // 케이스가 만든 승인 대기 항목은 거절해 큐를 비웁니다 (실제 카드·전역 스킬이 생기지 않게).
  const pendingApprovals = await api('GET', '/api/approvals');
  for (const row of pendingApprovals.data?.approvals ?? []) if (row.taskId === ctx.taskId) await api('POST', `/api/approvals/${row.id}`, { decision: 'reject', reason: 'eval 정리' });
  // 케이스가 남긴 프로젝트 기억(사람이 넣은 것·에이전트가 쓴 것 모두)은 다음 케이스에 새지 않게 지웁니다.
  const memories = await api('GET', `/api/memory?scope=project&scopeId=${env.projectId}`);
  for (const group of memories.data?.groups ?? []) for (const entry of group.entries ?? []) await api('DELETE', `/api/memory/${entry.id}`);
  return { results, ctx };
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const files = readdirSync(CASES_DIR).filter((name) => name.endsWith('.json')).sort();
  const cases = files.map((name) => JSON.parse(readFileSync(join(CASES_DIR, name), 'utf8'))).filter((kase) => !ONLY || kase.id.includes(ONLY));
  if (!cases.length) { console.error('실행할 케이스가 없습니다.'); process.exit(2); }

  const ping = await api('GET', '/api/me').catch(() => null);
  if (!ping || ping.status !== 200) { console.error(`dev 서버에 연결할 수 없습니다: ${BASE} (npm run dev 먼저)`); process.exit(2); }

  // eval 전용 프로젝트 + 고정 에이전트 (이름 중복이면 409 — 이미 있으니 그대로 씀)
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const project = await api('POST', '/api/projects', { name: `eval ${stamp}`, description: '연속 eval 자동 생성. 지워도 됩니다.' });
  if (project.status >= 300) { console.error(`프로젝트 생성 실패: ${JSON.stringify(project.data)}`); process.exit(2); }
  const env = { projectId: project.data.project.id, managerId: project.data.manager?.id, agentNames: [project.data.manager?.name, ...AGENTS.map((agent) => agent.name)].filter(Boolean) };
  // 에이전트는 매니저의 recruit_agent 로만 생기므로(POST /api/agents 없음) eval 용 팀원은 로컬 D1 에 직접 넣습니다.
  // 프로젝트에 귀속시켜 두면 프로젝트를 지울 때 함께 사라집니다.
  seedAgents(env.projectId);
  console.log(`대상 ${BASE} · 프로젝트 ${env.projectId} · 케이스 ${cases.length}개${JUDGE ? ' · judge 켜짐' : ''}\n`);

  const report = { startedAt: new Date().toISOString(), base: BASE, projectId: env.projectId, cases: [] };
  let failed = 0; let warned = 0;
  for (const kase of cases) {
    const started = Date.now();
    process.stdout.write(`▶ ${kase.id} — ${kase.title}\n`);
    let outcome;
    try {
      outcome = await runCase(kase, env);
    } catch (error) {
      outcome = { results: [{ type: 'run', pass: false, note: error instanceof Error ? error.message : String(error) }], ctx: {} };
    }
    const hard = outcome.results.filter((result) => !result.pass && !result.soft && !result.skipped);
    const soft = outcome.results.filter((result) => !result.pass && result.soft);
    if (hard.length) failed += 1; else if (soft.length) warned += 1;
    for (const result of outcome.results) {
      const mark = result.skipped ? '○' : result.pass ? '✓' : result.soft ? '△' : '✗';
      console.log(`   ${mark} ${result.type}${result.name ? `(${result.name})` : ''}: ${result.note}`);
    }
    console.log(`   ${hard.length ? '실패' : soft.length ? '경고' : '통과'} · ${Math.round((Date.now() - started) / 1000)}s\n`);
    report.cases.push({
      id: kase.id, title: kase.title, pass: !hard.length, warn: Boolean(soft.length), seconds: Math.round((Date.now() - started) / 1000),
      checks: outcome.results.map(({ type, name, pass, soft: isSoft, skipped, note }) => ({ type, name, pass, soft: isSoft, skipped, note })),
      evidence: { status: outcome.ctx.run?.status, toolCalls: outcome.ctx.run?.toolCalls, summary: outcome.ctx.run?.summary, reviewVerdict: outcome.ctx.detail?.task?.reviewVerdict, taskId: outcome.ctx.taskId },
    });
  }

  const passed = cases.length - failed;
  report.finishedAt = new Date().toISOString();
  report.summary = { total: cases.length, passed, failed, warned, passRate: Number((passed / cases.length).toFixed(3)) };
  mkdirSync(RESULTS_DIR, { recursive: true });
  const out = join(RESULTS_DIR, `${stamp}.json`);
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (!KEEP) await api('DELETE', `/api/projects/${env.projectId}?withTasks=1`);
  console.log(`결과: ${passed}/${cases.length} 통과${warned ? `, 경고 ${warned}` : ''} → ${out.replace(ROOT, '')}${KEEP ? ` (프로젝트 유지: ${env.projectId})` : ''}`);
  if (report.summary.passRate < PASS_THRESHOLD) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
