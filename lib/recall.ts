/**
 * 회상(recall) 인덱스 — Hermes 의 session_search 를 D1 에 옮긴 것.
 *
 * - 대화 메시지·에이전트 실행 결과·업무 카드를 recall_docs 한 테이블에 모으고
 *   external-content FTS5(recall_fts) 로 색인합니다. 동기화는 DB 트리거가 맡습니다.
 * - 한국어: unicode61 은 한글 연속체를 토큰 하나로 보고, trigram 은 2자 단어를 못 잡습니다.
 *   D1 에는 네이티브 토크나이저를 올릴 수 없으므로 한글 바이그램을 앱에서 만들어
 *   content_bigram 컬럼에 넣고 그 컬럼을 함께 색인합니다 (Hermes fts5_cjk 와 같은 발상).
 * - 검색은 LLM 을 부르지 않습니다. 원문 창을 그대로 돌려주고 모델이 읽게 합니다.
 */

export type RecallKind = 'chat' | 'run' | 'task' | 'summary';

export type RecallDocInput = {
  userId: string;
  kind: RecallKind;
  refId: string;
  projectId?: string | null;
  agentName?: string | null;
  role?: string | null;
  title?: string | null;
  content: string;
  createdAt: number;
};

export type RecallHit = {
  id: number;
  kind: RecallKind;
  refId: string;
  projectId: string | null;
  agentName: string | null;
  role: string | null;
  title: string | null;
  createdAt: number;
  snippet: string;
  content?: string;
  neighbors?: { id: number; role: string | null; agentName: string | null; createdAt: number; content: string }[];
};

const HANGUL_RUN = /[가-힣]{2,}/g;
const DOC_MAX_CHARS = 20_000;
const HIT_CONTENT_MAX_CHARS = 1_500;
const NEIGHBOR_MAX_CHARS = 600;
const RESULT_TOTAL_MAX_CHARS = 8_000;

/** 한글 연속체를 겹치는 바이그램으로 풀어 공백으로 잇습니다. "캘린더" → "캘린 린더" */
export function koreanBigrams(text: string): string {
  const out: string[] = [];
  for (const run of text.match(HANGUL_RUN) ?? []) {
    for (let index = 0; index < run.length - 1; index += 1) out.push(run.slice(index, index + 2));
  }
  return out.join(' ');
}

export function recallDocKey(kind: RecallKind, refId: string): string {
  return `${kind}:${refId}`;
}

/** recall_docs upsert statement. db.batch 에 끼워 넣을 수 있게 statement 만 돌려줍니다. */
export function recallDocUpsert(db: D1Database, doc: RecallDocInput) {
  const content = doc.content.slice(0, DOC_MAX_CHARS);
  return db.prepare(`INSERT INTO recall_docs
      (doc_key, user_id, kind, ref_id, project_id, agent_name, role, title, content, content_bigram, active, compacted, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
    ON CONFLICT(doc_key) DO UPDATE SET
      project_id = excluded.project_id, agent_name = excluded.agent_name, role = excluded.role, title = excluded.title,
      content = excluded.content, content_bigram = excluded.content_bigram`)
    .bind(
      recallDocKey(doc.kind, doc.refId), doc.userId, doc.kind, doc.refId,
      doc.projectId ?? null, doc.agentName ?? null, doc.role ?? null, doc.title ?? null,
      content, koreanBigrams(content), doc.createdAt,
    );
}

export function recallDocDelete(db: D1Database, kind: RecallKind, refId: string) {
  return db.prepare('DELETE FROM recall_docs WHERE doc_key = ?').bind(recallDocKey(kind, refId));
}

/**
 * FTS5 질의 조립. Hermes _sanitize_fts5_query 의 규칙을 축약:
 * 2048자 캡, 특수문자 제거, 하이픈/점 포함 토큰은 따옴표로, 매달린 연산자 제거.
 * 한글 토큰은 바이그램 phrase 로 바꿔 content_bigram 컬럼에, 나머지는 content 컬럼에 매칭합니다.
 */
export function buildFtsQuery(raw: string, mode: 'and' | 'or' = 'and'): string | null {
  const cleaned = raw.slice(0, 2048).replace(/["'`*()^:{}[\]<>|\\]/g, ' ');
  const tokens = cleaned.split(/\s+/).map((token) => token.trim()).filter(Boolean)
    .filter((token) => !['AND', 'OR', 'NOT', 'NEAR'].includes(token.toUpperCase()));
  if (!tokens.length) return null;

  const bigramPhrases: string[] = [];
  const plainTerms: string[] = [];
  for (const token of tokens) {
    const hangulRuns = token.match(HANGUL_RUN) ?? [];
    const latin = token.replace(/[가-힣]+/g, ' ').trim();
    for (const run of hangulRuns) {
      const grams = koreanBigrams(run);
      if (grams) bigramPhrases.push(`"${grams}"`);
    }
    // 1자 한글 토큰은 바이그램이 없어 검색 신호가 약하므로 버립니다.
    if (latin) {
      for (const part of latin.split(/\s+/).filter(Boolean)) {
        plainTerms.push(/[-.@/]/.test(part) ? `"${part}"` : part);
      }
    }
  }

  const joiner = mode === 'and' ? ' ' : ' OR ';
  const clauses: string[] = [];
  if (bigramPhrases.length) clauses.push(`content_bigram : (${bigramPhrases.join(joiner)})`);
  if (plainTerms.length) clauses.push(`content : (${plainTerms.join(joiner)})`);
  if (!clauses.length) return null;
  return clauses.join(mode === 'and' ? ' AND ' : ' OR ');
}

export type RecallSearchParams = {
  userId: string;
  query: string;
  projectId?: string | null;
  kinds?: RecallKind[];
  limit?: number;
  /** 이미 컨텍스트에 들어 있는 문서는 결과에서 뺍니다 (현재 대화의 최근 메시지 등) */
  excludeDocKeys?: string[];
  /** 1위 결과 주변을 ±window 로 하이드레이션 (chat 만) */
  window?: number;
};

type Row = {
  id: number; kind: RecallKind; ref_id: string; project_id: string | null; agent_name: string | null;
  role: string | null; title: string | null; created_at: number; snippet: string; content: string;
};

export async function searchRecall(db: D1Database, params: RecallSearchParams): Promise<{ hits: RecallHit[]; mode: 'and' | 'or' | 'none' }> {
  const limit = Math.min(10, Math.max(1, params.limit ?? 3));
  const kinds = params.kinds?.length ? params.kinds : (['chat', 'run', 'task', 'summary'] as RecallKind[]);

  for (const mode of ['and', 'or'] as const) {
    const match = buildFtsQuery(params.query, mode);
    if (!match) return { hits: [], mode: 'none' };

    const filters: string[] = ['d.user_id = ?', '(d.active = 1 OR d.compacted = 1)', `d.kind IN (${kinds.map(() => '?').join(',')})`];
    const binds: unknown[] = [match, params.userId, ...kinds];
    if (params.projectId) { filters.push('d.project_id = ?'); binds.push(params.projectId); }
    if (params.excludeDocKeys?.length) {
      filters.push(`d.doc_key NOT IN (${params.excludeDocKeys.map(() => '?').join(',')})`);
      binds.push(...params.excludeDocKeys);
    }
    binds.push(limit * 3);

    const rows = await db.prepare(`SELECT d.id, d.kind, d.ref_id, d.project_id, d.agent_name, d.role, d.title, d.created_at,
        snippet(recall_fts, 0, '>>>', '<<<', '…', 40) AS snippet, d.content
      FROM recall_fts JOIN recall_docs d ON d.id = recall_fts.rowid
      WHERE recall_fts MATCH ? AND ${filters.join(' AND ')}
      ORDER BY rank LIMIT ?`).bind(...binds).all<Row>();

    if (!rows.results.length) continue;

    // 같은 실행/업무가 여러 문서로 잡히지 않게 ref 단위로 중복 제거
    const seen = new Set<string>();
    const hits: RecallHit[] = [];
    for (const row of rows.results) {
      const key = recallDocKey(row.kind, row.ref_id);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        id: row.id, kind: row.kind, refId: row.ref_id, projectId: row.project_id, agentName: row.agent_name,
        role: row.role, title: row.title, createdAt: row.created_at, snippet: row.snippet,
      });
      if (hits.length >= limit) break;
    }

    // adaptive detail: 1위만 본문 + 주변 메시지, 나머지는 스니펫만 (Hermes 와 동일)
    const top = hits[0];
    const topRow = rows.results.find((row) => row.id === top.id);
    if (topRow) top.content = clip(topRow.content, HIT_CONTENT_MAX_CHARS);
    if (top.kind === 'chat') top.neighbors = await chatNeighbors(db, params.userId, top, params.window ?? 5);

    return { hits: capTotal(hits), mode };
  }
  return { hits: [], mode: 'none' };
}

/** 특정 문서 주변을 읽습니다 (scroll). chat 은 같은 대화의 앞뒤 메시지, 그 외는 본문 전체. */
export async function scrollRecall(db: D1Database, userId: string, docId: number, window = 5): Promise<RecallHit | null> {
  const row = await db.prepare('SELECT id, kind, ref_id, project_id, agent_name, role, title, created_at, content, \'\' AS snippet FROM recall_docs WHERE id = ? AND user_id = ?')
    .bind(docId, userId).first<Row>();
  if (!row) return null;
  const hit: RecallHit = {
    id: row.id, kind: row.kind, refId: row.ref_id, projectId: row.project_id, agentName: row.agent_name,
    role: row.role, title: row.title, createdAt: row.created_at, snippet: '', content: clip(row.content, HIT_CONTENT_MAX_CHARS * 2),
  };
  if (hit.kind === 'chat') hit.neighbors = await chatNeighbors(db, userId, hit, Math.min(20, Math.max(1, window)));
  return hit;
}

async function chatNeighbors(db: D1Database, userId: string, hit: RecallHit, window: number) {
  const rows = await db.prepare(`SELECT id, role, agent_name, created_at, content FROM recall_docs
      WHERE user_id = ? AND kind = 'chat' AND project_id IS ? AND agent_name IS ? AND id != ?
        AND (active = 1 OR compacted = 1)
      ORDER BY ABS(created_at - ?) ASC LIMIT ?`)
    .bind(userId, hit.projectId, hit.agentName, hit.id, hit.createdAt, window * 2).all<{ id: number; role: string | null; agent_name: string | null; created_at: number; content: string }>();
  return rows.results
    .sort((a, b) => a.created_at - b.created_at)
    .map((row) => ({ id: row.id, role: row.role, agentName: row.agent_name, createdAt: row.created_at, content: clip(row.content, NEIGHBOR_MAX_CHARS) }));
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 전체 응답이 상한을 넘지 않게 뒤쪽 결과부터 본문을 덜어냅니다. */
function capTotal(hits: RecallHit[]): RecallHit[] {
  let total = JSON.stringify(hits).length;
  for (let index = hits.length - 1; index > 0 && total > RESULT_TOTAL_MAX_CHARS; index -= 1) {
    delete hits[index].content;
    delete hits[index].neighbors;
    total = JSON.stringify(hits).length;
  }
  if (total > RESULT_TOTAL_MAX_CHARS && hits[0]?.neighbors) {
    hits[0].neighbors = hits[0].neighbors.slice(0, 4);
  }
  return hits;
}

/** 모델에게 노출할 recall_history 툴 정의 */
export const RECALL_TOOL = {
  name: 'recall_history',
  description: [
    '과거 대화·에이전트 실행 결과·업무 카드를 전문 검색으로 회상합니다.',
    '사용자가 이전 논의를 언급하거나, 같은 프로젝트에서 관련 작업이 있었을 법하면 다시 묻거나 추측하기 전에 먼저 검색하세요.',
    '결과는 실제 저장된 원문(스니펫·본문·앞뒤 메시지)이며 LLM 요약이 아닙니다.',
    'query 로 검색(1위 결과는 본문과 주변까지 포함)하거나, around_id 로 특정 문서 주변을 더 읽을 수 있습니다.',
    '정확한 파일명·식별자는 그대로 쓰고, 한국어는 핵심 명사 2~3개로 검색하는 편이 잘 잡힙니다.',
    '보통 1~2회면 충분합니다. 같은 키워드를 다시 검색하지 말고, 결과가 없으면 없다고 판단하세요. 실행당 호출 상한이 있습니다.',
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '검색어. 핵심 키워드 위주로.' },
      kinds: { type: 'array', items: { type: 'string', enum: ['chat', 'run', 'task', 'summary'] }, description: '검색 범위. 생략하면 전부. summary = 압축된 이전 대화의 요약.' },
      all_projects: { type: 'boolean', description: 'true 면 현재 프로젝트 밖까지 검색합니다. 기본 false.' },
      limit: { type: 'integer', minimum: 1, maximum: 10, description: '기본 3' },
      around_id: { type: 'integer', description: '이 문서 id 주변을 읽습니다(scroll). 검색 결과의 id 를 넣으세요.' },
      window: { type: 'integer', minimum: 1, maximum: 20, description: 'around_id 와 함께. 앞뒤 몇 개를 볼지. 기본 5' },
    },
  },
} as const;

/** recall_history 툴 실행기 */
export async function executeRecallTool(db: D1Database, userId: string, input: Record<string, unknown>, context: { projectId: string | null; excludeDocKeys?: string[] }) {
  if (typeof input.around_id === 'number') {
    const hit = await scrollRecall(db, userId, input.around_id, typeof input.window === 'number' ? input.window : 5);
    return hit ? { mode: 'scroll', hit } : { mode: 'scroll', error: '해당 id 의 문서가 없습니다.' };
  }
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) return { error: 'query 또는 around_id 가 필요합니다.' };
  const kinds = Array.isArray(input.kinds) ? input.kinds.filter((k): k is RecallKind => k === 'chat' || k === 'run' || k === 'task' || k === 'summary') : undefined;
  const result = await searchRecall(db, {
    userId, query, kinds,
    projectId: input.all_projects === true ? null : context.projectId,
    limit: typeof input.limit === 'number' ? input.limit : 3,
    excludeDocKeys: context.excludeDocKeys,
  });
  return {
    mode: 'search', match: result.mode, count: result.hits.length,
    hint: result.hits.length ? '더 읽으려면 around_id 에 id 를 넣어 다시 호출하세요.' : '결과가 없습니다. 다른 키워드로 한 번만 더 시도하거나, 없다고 판단하세요.',
    hits: result.hits,
  };
}
