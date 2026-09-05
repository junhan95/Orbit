import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { MODEL_PRICES, WEB_SEARCH_PRICE_PER_CALL, estimateCostUsd, priceFor } from '@/lib/pricing';

const DAY = 86_400_000;
const ALLOWED_RANGES = [7, 30, 90];

type Row = {
  day: string; model: string; kind: string; agentName: string | null;
  requests: number; inputTokens: number; outputTokens: number;
  cacheCreationTokens: number; cacheReadTokens: number; webSearchRequests: number;
};

type Bucket = {
  requests: number; inputTokens: number; outputTokens: number;
  cacheCreationTokens: number; cacheReadTokens: number; webSearchRequests: number; costUsd: number;
};

const emptyBucket = (): Bucket => ({
  requests: 0, inputTokens: 0, outputTokens: 0,
  cacheCreationTokens: 0, cacheReadTokens: 0, webSearchRequests: 0, costUsd: 0,
});

function add(bucket: Bucket, row: Row, cost: number) {
  bucket.requests += row.requests;
  bucket.inputTokens += row.inputTokens;
  bucket.outputTokens += row.outputTokens;
  bucket.cacheCreationTokens += row.cacheCreationTokens;
  bucket.cacheReadTokens += row.cacheReadTokens;
  bucket.webSearchRequests += row.webSearchRequests;
  bucket.costUsd += cost;
}

export async function GET(request: Request) {
  const user = getCurrentUser();
  const url = new URL(request.url);

  const requestedDays = Number(url.searchParams.get('days'));
  const days = ALLOWED_RANGES.includes(requestedDays) ? requestedDays : 30;
  // 브라우저의 Date#getTimezoneOffset() 값(UTC 기준 분). 날짜 경계를 사용자 로컬 시간으로 맞춥니다.
  const rawOffset = Number(url.searchParams.get('tz'));
  const tzOffsetMinutes = Number.isFinite(rawOffset) && Math.abs(rawOffset) <= 900 ? Math.trunc(rawOffset) : 0;

  const since = Date.now() - days * DAY;
  const rows = await getDatabase().prepare(`SELECT
      date((created_at / 1000) - (? * 60), 'unixepoch') AS day,
      model, kind, agent_name AS agentName,
      COUNT(*) AS requests,
      SUM(input_tokens) AS inputTokens,
      SUM(output_tokens) AS outputTokens,
      SUM(cache_creation_tokens) AS cacheCreationTokens,
      SUM(cache_read_tokens) AS cacheReadTokens,
      SUM(web_search_requests) AS webSearchRequests
    FROM usage_events
    WHERE user_id = ? AND created_at >= ?
    GROUP BY day, model, kind, agentName`)
    .bind(tzOffsetMinutes, user.userId, since).all<Row>();

  const totals = emptyBucket();
  const byDay = new Map<string, Bucket>();
  const byKind = new Map<string, Bucket>();
  const byModel = new Map<string, Bucket>();
  const byAgent = new Map<string, Bucket>();

  for (const row of rows.results) {
    // 비용은 모델마다 단가가 달라 반드시 모델 단위로 계산한 뒤 합칩니다.
    const cost = estimateCostUsd(row.model, row);
    add(totals, row, cost);
    for (const [map, key] of [
      [byDay, row.day], [byKind, row.kind], [byModel, row.model], [byAgent, row.agentName || '(미지정)'],
    ] as const) {
      const bucket = map.get(key) ?? emptyBucket();
      add(bucket, row, cost);
      map.set(key, bucket);
    }
  }

  // 데이터가 없는 날도 0으로 채워 시계열 간격을 일정하게 유지합니다.
  const daily = Array.from({ length: days }, (_, index) => {
    const stamp = new Date(Date.now() - (days - 1 - index) * DAY);
    const local = new Date(stamp.getTime() - tzOffsetMinutes * 60_000);
    const key = local.toISOString().slice(0, 10);
    return { date: key, ...(byDay.get(key) ?? emptyBucket()) };
  });

  const kindLabels: Record<string, string> = { agent_run: '에이전트 실행', chat: '에이전트 대화', memory_review: '기억 리뷰', plan: '계획 수립', compaction: '대화 압축' };
  const toList = <T extends string>(map: Map<string, Bucket>, field: T) =>
    [...map.entries()]
      .map(([key, bucket]) => ({ [field]: key, ...bucket }))
      .sort((a, b) => b.costUsd - a.costUsd);

  return Response.json({
    rangeDays: days,
    totals,
    daily,
    byKind: [...byKind.entries()]
      .map(([kind, bucket]) => ({ kind, label: kindLabels[kind] ?? kind, ...bucket }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byModel: [...byModel.entries()]
      .map(([model, bucket]) => ({ model, priceKnown: priceFor(model).known, ...bucket }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byAgent: toList(byAgent, 'agentName'),
    pricing: {
      webSearchPerCall: WEB_SEARCH_PRICE_PER_CALL,
      models: Object.entries(MODEL_PRICES).map(([model, price]) => ({ model, ...price })),
    },
  });
}
