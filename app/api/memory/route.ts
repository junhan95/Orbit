import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import {
  MEMORY_LIMITS, MEMORY_SCOPE_LABELS, charCount, executeMemoryTool, type MemoryEntry, type MemoryScope,
} from '@/lib/memory';

const SCOPES: MemoryScope[] = ['user', 'project', 'agent'];
const isScope = (value: unknown): value is MemoryScope => SCOPES.includes(value as MemoryScope);

type Row = {
  id: string; scope: MemoryScope; scopeId: string | null; content: string; status: MemoryEntry['status'];
  createdBy: string; createdAt: number; updatedAt: number; scopeName: string | null;
};

/**
 * GET /api/memory?scope=&scopeId=
 * 스코프를 주면 그 스코프만, 없으면 사용자의 모든 기억을 (pending 포함) 돌려줍니다.
 * UI 의 기억 관리 탭이 그룹별 목록·사용률·승인 대기 배지를 그리는 데 씁니다.
 */
export async function GET(request: Request) {
  const user = getCurrentUser();
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope');
  const scopeId = url.searchParams.get('scopeId');
  if (scope !== null && !isScope(scope)) return Response.json({ error: 'scope 값이 올바르지 않습니다.' }, { status: 400 });

  const db = getDatabase();
  const rows = await db.prepare(`SELECT m.id, m.scope, m.scope_id AS scopeId, m.content, m.status, m.created_by AS createdBy,
        m.created_at AS createdAt, m.updated_at AS updatedAt,
        CASE m.scope WHEN 'project' THEN p.name WHEN 'agent' THEN a.name ELSE NULL END AS scopeName
      FROM memories m
      LEFT JOIN projects p ON m.scope = 'project' AND p.id = m.scope_id
      LEFT JOIN agents a ON m.scope = 'agent' AND a.id = m.scope_id
      WHERE m.user_id = ? ${scope ? 'AND m.scope = ?' : ''} ${scopeId ? 'AND m.scope_id = ?' : ''}
      ORDER BY m.scope, scopeName, m.created_at ASC`)
    .bind(user.userId, ...(scope ? [scope] : []), ...(scopeId ? [scopeId] : []))
    .all<Row>();

  // 스코프(+scopeId)별로 묶고, 사용률은 active 엔트리 기준(주입 예산과 동일 기준)으로 계산합니다.
  const groups = new Map<string, { scope: MemoryScope; scopeId: string | null; scopeName: string | null; entries: Row[] }>();
  for (const row of rows.results) {
    const key = `${row.scope}:${row.scopeId ?? ''}`;
    const group = groups.get(key) ?? { scope: row.scope, scopeId: row.scopeId, scopeName: row.scopeName, entries: [] };
    group.entries.push(row);
    groups.set(key, group);
  }
  const result = [...groups.values()].map((group) => {
    const active = group.entries.filter((entry) => entry.status === 'active');
    return {
      ...group,
      label: group.scope === 'user' ? MEMORY_SCOPE_LABELS.user : `${MEMORY_SCOPE_LABELS[group.scope]} · ${group.scopeName ?? '(삭제됨)'}`,
      used: charCount(active), limit: MEMORY_LIMITS[group.scope],
      pendingCount: group.entries.length - active.length,
    };
  });
  return Response.json({ groups: result, limits: MEMORY_LIMITS, pendingTotal: rows.results.filter((row) => row.status === 'pending').length });
}

/**
 * POST /api/memory  { scope, scopeId?, content }
 * 사람이 직접 기억을 추가합니다. 에이전트와 같은 검사(위협 패턴, 예산, 중복)를 거치되 actor 가 'user' 라 바로 active 로 들어갑니다.
 */
export async function POST(request: Request) {
  const user = getCurrentUser();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !isScope(body.scope)) return Response.json({ error: "scope 는 'user' | 'project' | 'agent' 여야 합니다." }, { status: 400 });
  if (typeof body.content !== 'string' || !body.content.trim()) return Response.json({ error: '내용을 입력해 주세요.' }, { status: 400 });

  const db = getDatabase();
  let projectId: string | null = null;
  let agentId: string | null = null;
  if (body.scope !== 'user') {
    if (typeof body.scopeId !== 'string' || !body.scopeId) return Response.json({ error: `${body.scope} 스코프에는 scopeId 가 필요합니다.` }, { status: 400 });
    const table = body.scope === 'project' ? 'projects' : 'agents';
    const owned = await db.prepare(`SELECT id FROM ${table} WHERE user_id = ? AND id = ?`).bind(user.userId, body.scopeId).first<{ id: string }>();
    if (!owned) return Response.json({ error: body.scope === 'project' ? '존재하지 않는 프로젝트입니다.' : '존재하지 않는 에이전트입니다.' }, { status: 400 });
    if (body.scope === 'project') projectId = body.scopeId; else agentId = body.scopeId;
  }

  const outcome = await executeMemoryTool(db, { scope: body.scope, action: 'add', content: body.content }, {
    userId: user.userId, projectId, agentId, actor: 'user',
  });
  if ('error' in outcome) return Response.json({ error: outcome.error, usage: outcome.usage }, { status: 400 });
  return Response.json(outcome, { status: 201 });
}
