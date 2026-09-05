import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { summarizeGates } from '@/lib/gates';
import { computeHealth, raiseDiagnosis } from '@/lib/health';

const DAY = 86_400_000;

/**
 * GET /api/health — 관제 밴드 지표(오늘 vs 14일 기준선)와 최근 7일 게이트 차단 요약, 열린 진단 카드.
 * UI 대시보드가 "실행 건강" 카드를 그리는 데 씁니다.
 */
export async function GET() {
  const user = getCurrentUser();
  const db = getDatabase();
  const [health, gates, diagnoses, lastCheck] = await Promise.all([
    computeHealth(db, user.userId),
    summarizeGates(db, user.userId, Date.now() - 7 * DAY),
    db.prepare(`SELECT id, title, owner, status, project_id AS projectId, created_at AS createdAt FROM tasks
        WHERE user_id = ? AND label = '진단' ORDER BY created_at DESC LIMIT 10`).bind(user.userId).all(),
    db.prepare(`SELECT decision, detail, created_at AS at FROM gate_events WHERE user_id = ? AND gate = 'health_check' ORDER BY created_at DESC LIMIT 1`)
      .bind(user.userId).first<{ decision: string; detail: string | null; at: number }>(),
  ]);
  return Response.json({ ...health, gates, diagnoses: diagnoses.results, lastCheck: lastCheck ?? null });
}

/**
 * POST /api/health { force?: true } — 지금 검사해서 2σ 이상 지표마다 진단 카드를 만듭니다 (24시간 내 중복 없음).
 * 응답: { metrics, raised: [{ key, taskId }], skipped: [{ key, reason }] }
 */
export async function POST() {
  const user = getCurrentUser();
  const db = getDatabase();
  const { metrics } = await computeHealth(db, user.userId);
  const raised: { key: string; taskId: string }[] = [];
  const skipped: { key: string; reason: string }[] = [];
  for (const metric of metrics) {
    if (metric.tier !== 'diagnose' && metric.tier !== 'act') continue;
    const outcome = await raiseDiagnosis(db, user.userId, metric);
    if (outcome.created && outcome.taskId) raised.push({ key: metric.key, taskId: outcome.taskId });
    else skipped.push({ key: metric.key, reason: outcome.reason ?? '이유 미상' });
  }
  return Response.json({ metrics, raised, skipped });
}
