/**
 * 관제 밴드 (AI-Native SDLC 플레이북 Maintain 단계의 control bands).
 *
 * 결정적 코드가 실행 지표를 일 단위로 집계해 롤링 기준선(평균 ± σ)과 비교합니다.
 *   |σ| < 1  ok      → 아무것도 안 함
 *   1σ~2σ    watch   → 기록만
 *   2σ~3σ    diagnose→ 프로젝트 매니저에게 '진단' 카드 생성 (사람이 분류)
 *   ≥3σ      act     → 같은 카드지만 중요도 '높음'
 * 지표 계산에는 모델을 쓰지 않습니다. 카드는 코드가 증거를 모아 만들고, 진단·제안은 카드를 실행할 때 에이전트가 합니다
 * (플레이북: "진단은 intent.md 로 파이프라인에 재진입한다").
 *
 * 스케줄러가 없는 환경이라 실행이 끝날 때마다 백그라운드에서 최대 1시간에 한 번 검사합니다 (maybeRunHealthCheck).
 */
import { estimateCostUsd } from './pricing';
import { gateEventInsert, logGate } from './gates';
import { recallDocUpsert } from './recall';

export const BASELINE_DAYS = 14;
export const MIN_BASELINE_DAYS = 3;
export const MIN_CURRENT_SAMPLES = 3;
export const HEALTH_CHECK_INTERVAL_MS = 60 * 60_000;
const DAY = 86_400_000;
const DIAGNOSIS_LABEL = '진단';

export type MetricKey = 'run_failure_rate' | 'unverified_rate' | 'review_changes_rate' | 'gate_block_rate' | 'cost_per_run';
export type Tier = 'ok' | 'watch' | 'diagnose' | 'act' | 'insufficient';

export type MetricReport = {
  key: MetricKey; label: string; unit: 'ratio' | 'usd';
  current: number | null; currentSamples: number;
  baselineMean: number | null; baselineSd: number | null; baselineDays: number;
  sigma: number | null; tier: Tier;
  /** 사람이 읽는 한 줄 */
  note: string;
};

type DayBucket = { day: string; total: number; bad: number; completed: number; unverified: number };
type ReviewBucket = { day: string; total: number; changes: number };
type GateBucket = { day: string; blocks: number };
type CostRow = { day: string; model: string; requests: number; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; webSearchRequests: number };

const METRICS: { key: MetricKey; label: string; unit: 'ratio' | 'usd'; minDelta: number }[] = [
  { key: 'run_failure_rate', label: '실행 실패·막힘 비율', unit: 'ratio', minDelta: 0.25 },
  { key: 'unverified_rate', label: '검증 근거 없는 완료 비율', unit: 'ratio', minDelta: 0.25 },
  { key: 'review_changes_rate', label: '검토 수정 요청 비율', unit: 'ratio', minDelta: 0.25 },
  { key: 'gate_block_rate', label: '실행당 게이트 차단 비율', unit: 'ratio', minDelta: 0.5 },
  { key: 'cost_per_run', label: '실행당 비용(USD)', unit: 'usd', minDelta: 0.5 },
];

export async function computeHealth(db: D1Database, userId: string, now = Date.now()): Promise<{ metrics: MetricReport[]; windowFrom: number; windowTo: number }> {
  const since = now - (BASELINE_DAYS + 1) * DAY;
  const [runs, reviews, gates, costs] = await Promise.all([
    db.prepare(`SELECT date(started_at / 1000, 'unixepoch') AS day, COUNT(*) AS total,
        SUM(CASE WHEN outcome IN ('failed','blocked') OR status = 'failed' THEN 1 ELSE 0 END) AS bad,
        SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN outcome = 'completed' AND metadata LIKE '%"unverified":true%' THEN 1 ELSE 0 END) AS unverified
      FROM agent_runs WHERE user_id = ? AND status != 'running' AND started_at >= ? GROUP BY day`).bind(userId, since).all<DayBucket>(),
    db.prepare(`SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS total,
        SUM(CASE WHEN content LIKE '🔍 검토 — 수정 요청%' THEN 1 ELSE 0 END) AS changes
      FROM task_comments WHERE user_id = ? AND author_kind = 'agent' AND content LIKE '🔍 검토 —%' AND created_at >= ? GROUP BY day`).bind(userId, since).all<ReviewBucket>(),
    db.prepare(`SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS blocks
      FROM gate_events WHERE user_id = ? AND decision = 'block' AND created_at >= ? GROUP BY day`).bind(userId, since).all<GateBucket>(),
    db.prepare(`SELECT date(created_at / 1000, 'unixepoch') AS day, model, COUNT(*) AS requests,
        SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens, SUM(cache_creation_tokens) AS cacheCreationTokens,
        SUM(cache_read_tokens) AS cacheReadTokens, SUM(web_search_requests) AS webSearchRequests
      FROM usage_events WHERE user_id = ? AND kind = 'agent_run' AND created_at >= ? GROUP BY day, model`).bind(userId, since).all<CostRow>(),
  ]);

  const today = dayKey(now);
  const runByDay = new Map(runs.results.map((row) => [row.day, row]));
  const reviewByDay = new Map(reviews.results.map((row) => [row.day, row]));
  const gateByDay = new Map(gates.results.map((row) => [row.day, row.blocks]));
  const costByDay = new Map<string, { usd: number; runs: number }>();
  for (const row of costs.results) {
    const bucket = costByDay.get(row.day) ?? { usd: 0, runs: 0 };
    bucket.usd += estimateCostUsd(row.model, row); bucket.runs += row.requests;
    costByDay.set(row.day, bucket);
  }

  // 지표별 (day → { value, samples })
  const series: Record<MetricKey, Map<string, { value: number; samples: number }>> = {
    run_failure_rate: new Map(), unverified_rate: new Map(), review_changes_rate: new Map(), gate_block_rate: new Map(), cost_per_run: new Map(),
  };
  const days = new Set<string>([...runByDay.keys(), ...reviewByDay.keys(), ...gateByDay.keys(), ...costByDay.keys()]);
  for (const day of days) {
    const run = runByDay.get(day);
    if (run && run.total > 0) {
      series.run_failure_rate.set(day, { value: run.bad / run.total, samples: run.total });
      series.gate_block_rate.set(day, { value: (gateByDay.get(day) ?? 0) / run.total, samples: run.total });
      if (run.completed > 0) series.unverified_rate.set(day, { value: run.unverified / run.completed, samples: run.completed });
    }
    const review = reviewByDay.get(day);
    if (review && review.total > 0) series.review_changes_rate.set(day, { value: review.changes / review.total, samples: review.total });
    const cost = costByDay.get(day);
    if (cost && cost.runs > 0) series.cost_per_run.set(day, { value: cost.usd / cost.runs, samples: cost.runs });
  }

  const metrics = METRICS.map((metric) => band(metric, series[metric.key], today));
  return { metrics, windowFrom: since, windowTo: now };
}

export function band(metric: typeof METRICS[number], points: Map<string, { value: number; samples: number }>, today: string): MetricReport {
  const current = points.get(today) ?? null;
  const baseline = [...points.entries()].filter(([day]) => day !== today).map(([, point]) => point.value);
  const base: MetricReport = {
    key: metric.key, label: metric.label, unit: metric.unit,
    current: current?.value ?? null, currentSamples: current?.samples ?? 0,
    baselineMean: null, baselineSd: null, baselineDays: baseline.length, sigma: null, tier: 'insufficient', note: '',
  };
  if (baseline.length < MIN_BASELINE_DAYS) return { ...base, note: `기준선 부족 (${baseline.length}/${MIN_BASELINE_DAYS}일)` };
  const mean = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
  const sd = Math.sqrt(baseline.reduce((sum, value) => sum + (value - mean) ** 2, 0) / baseline.length);
  base.baselineMean = mean; base.baselineSd = sd;
  if (!current || current.samples < MIN_CURRENT_SAMPLES) return { ...base, tier: 'ok', note: `오늘 표본 부족 (${current?.samples ?? 0}/${MIN_CURRENT_SAMPLES})` };
  // 기준선 편차가 0(전부 같은 값)이면 σ 를 못 구하므로 절대 변화량으로 판정합니다.
  const delta = current.value - mean;
  const sigma = sd > 0 ? delta / sd : (Math.abs(delta) >= metric.minDelta * Math.max(mean, metric.unit === 'ratio' ? 1 : mean || 1) ? Math.sign(delta) * 3 : 0);
  const tier: Tier = sigma < 1 ? 'ok' : sigma < 2 ? 'watch' : sigma < 3 ? 'diagnose' : 'act';
  const fmt = (value: number) => (metric.unit === 'usd' ? `$${value.toFixed(3)}` : `${Math.round(value * 100)}%`);
  return { ...base, sigma: Number(sigma.toFixed(2)), tier, note: `오늘 ${fmt(current.value)} (표본 ${current.samples}) · 기준 ${fmt(mean)} ± ${fmt(sd)} · ${sigma >= 0 ? '+' : ''}${sigma.toFixed(1)}σ` };
}

// ── 진단 카드 ─────────────────────────────────────────────────────────────────
type RecentBad = { title: string; owner: string; outcome: string | null; summary: string | null; output: string | null; startedAt: number };

/** 기준선을 벗어난 지표를 '진단' 카드로 파이프라인에 재진입시킵니다. 24시간 내 같은 지표 카드가 있으면 만들지 않습니다. */
export async function raiseDiagnosis(db: D1Database, userId: string, metric: MetricReport, now = Date.now()): Promise<{ created: boolean; taskId?: string; reason?: string }> {
  const titlePrefix = `진단: ${metric.label}`;
  const duplicate = await db.prepare(`SELECT id FROM tasks WHERE user_id = ? AND label = ? AND title LIKE ? AND created_at >= ? LIMIT 1`)
    .bind(userId, DIAGNOSIS_LABEL, `${titlePrefix}%`, now - DAY).first<{ id: string }>();
  if (duplicate) return { created: false, reason: '24시간 내 같은 진단 카드 있음' };

  // 최근 24시간에 실행이 가장 많았던 프로젝트와 그 매니저에게 맡깁니다.
  const target = await db.prepare(`SELECT t.project_id AS projectId, COUNT(*) AS runs FROM agent_runs r JOIN tasks t ON t.id = r.task_id
      WHERE r.user_id = ? AND r.started_at >= ? AND t.project_id IS NOT NULL GROUP BY t.project_id ORDER BY runs DESC LIMIT 1`)
    .bind(userId, now - DAY).first<{ projectId: string; runs: number }>();
  if (!target) return { created: false, reason: '최근 24시간 실행이 있는 프로젝트 없음' };
  const manager = await db.prepare(`SELECT name, color FROM agents WHERE user_id = ? AND (project_id = ? OR id IN (SELECT agent_id FROM project_agents WHERE project_id = ? AND user_id = ?))
      ORDER BY is_manager DESC, created_at ASC LIMIT 1`).bind(userId, target.projectId, target.projectId, userId).first<{ name: string; color: string }>();
  if (!manager) return { created: false, reason: '프로젝트에 에이전트 없음' };

  const recent = await db.prepare(`SELECT t.title, t.owner, r.outcome, r.summary, r.output, r.started_at AS startedAt FROM agent_runs r JOIN tasks t ON t.id = r.task_id
      WHERE r.user_id = ? AND r.started_at >= ? AND (r.outcome IN ('failed','blocked') OR r.status = 'failed' OR r.metadata LIKE '%"unverified":true%')
      ORDER BY r.started_at DESC LIMIT 6`).bind(userId, now - DAY).all<RecentBad>();
  const findings = await db.prepare(`SELECT c.content, t.title FROM task_comments c JOIN tasks t ON t.id = c.task_id
      WHERE c.user_id = ? AND c.author_kind = 'agent' AND c.content LIKE '🔍 검토 — 수정 요청%' AND c.created_at >= ? ORDER BY c.created_at DESC LIMIT 4`)
    .bind(userId, now - DAY).all<{ content: string; title: string }>();

  const evidence = [
    `## 관제 밴드 이탈`,
    `- 지표: ${metric.label}`,
    `- ${metric.note}`,
    `- 판정: ${metric.tier === 'act' ? '3σ 이상 (즉시 조치)' : '2σ 이상 (진단 필요)'}`,
    '',
    recent.results.length ? `## 최근 24시간 실패·막힘·근거 없는 완료 (${recent.results.length}건)\n${recent.results.map((run) => `- ${new Date(run.startedAt).toISOString().slice(0, 16).replace('T', ' ')} · ${run.owner} · ${run.title} · ${run.outcome ?? 'failed'}\n  ${(run.summary ?? run.output ?? '').replace(/\s+/g, ' ').slice(0, 240)}`).join('\n')}` : '',
    findings.results.length ? `## 최근 검토 수정 요청 (${findings.results.length}건)\n${findings.results.map((row) => `- ${row.title}: ${row.content.split('\n').slice(0, 2).join(' ').slice(0, 240)}`).join('\n')}` : '',
    '',
    '## 해야 할 일',
    '1. 위 증거에서 공통 원인을 찾으세요 (카드 본문 부족 / 정보 접근 불가 / 프롬프트·스킬 변경 / 특정 에이전트·모델).',
    '2. 원인별로 조치를 제안하고, 사람이 결정해야 할 것과 에이전트가 바로 할 수 있는 것을 나누세요. 바로 할 수 있는 것은 create_task 로 카드를 만드세요.',
    '3. 근거 없는 추측은 금지 — recall_history 로 해당 실행의 원문을 확인하고 proof 에 적으세요.',
  ].filter(Boolean).join('\n');

  const id = crypto.randomUUID();
  const title = `${titlePrefix} ${metric.sigma !== null && metric.sigma >= 0 ? '+' : ''}${metric.sigma?.toFixed(1) ?? '?'}σ`;
  await db.batch([
    db.prepare(`INSERT INTO tasks (id, user_id, title, label, owner, status, priority, accent, project_id, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '대기', ?, ?, ?, ?, ?, ?)`)
      .bind(id, userId, title.slice(0, 100), DIAGNOSIS_LABEL, manager.name, metric.tier === 'act' ? '높음' : '중간', manager.color, target.projectId, evidence.slice(0, 8000), now, now),
    recallDocUpsert(db, { userId, kind: 'task', refId: id, projectId: target.projectId, agentName: manager.name, title, content: `[${DIAGNOSIS_LABEL}] ${title}\n${evidence}`, createdAt: now }),
    gateEventInsert(db, userId, { gate: 'health_check', decision: 'raise', projectId: target.projectId, taskId: id, detail: `${metric.key} ${metric.note}` }),
  ]);
  return { created: true, taskId: id };
}

/** 실행이 끝날 때마다 호출 — 최근 1시간 안에 검사했으면 건너뜁니다 */
export async function maybeRunHealthCheck(db: D1Database, userId: string): Promise<{ checked: boolean; raised: string[] }> {
  const last = await db.prepare(`SELECT created_at AS at FROM gate_events WHERE user_id = ? AND gate = 'health_check' ORDER BY created_at DESC LIMIT 1`)
    .bind(userId).first<{ at: number }>();
  if (last && Date.now() - last.at < HEALTH_CHECK_INTERVAL_MS) return { checked: false, raised: [] };
  const { metrics } = await computeHealth(db, userId);
  const raised: string[] = [];
  for (const metric of metrics) {
    if (metric.tier !== 'diagnose' && metric.tier !== 'act') continue;
    const outcome = await raiseDiagnosis(db, userId, metric);
    if (outcome.created && outcome.taskId) raised.push(outcome.taskId);
  }
  if (!raised.length) logGate(db, userId, { gate: 'health_check', decision: 'noop', detail: metrics.filter((m) => m.tier === 'watch').map((m) => `${m.key} ${m.note}`).join('; ') || 'all ok' });
  return { checked: true, raised };
}

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
