import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { MEMORY_LIMITS, MEMORY_SCOPE_LABELS, charCount, listMemories, scanMemoryThreat, type MemoryEntry } from '@/lib/memory';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

type Row = {
  id: string; scope: MemoryEntry['scope']; scopeId: string | null; content: string; status: MemoryEntry['status'];
  createdBy: string; createdAt: number; updatedAt: number;
};

const SELECT_MEMORY = `SELECT id, scope, scope_id AS scopeId, content, status, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
  FROM memories WHERE id = ? AND user_id = ?`;

/**
 * PATCH /api/memory/:id  { content?, status? }
 * - status: 'active' 로 바꾸면 에이전트가 남긴 pending 기억을 승인하는 것. (거절은 DELETE)
 * - content: 사람이 문구를 다듬는 경우. 에이전트와 같은 위협 스캔·예산 검사를 거칩니다.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });

  const db = getDatabase();
  const existing = await db.prepare(SELECT_MEMORY).bind(id, user.userId).first<Row>();
  if (!existing) return Response.json({ error: '기억을 찾을 수 없습니다.' }, { status: 404 });

  const columns: string[] = [];
  const values: (string | number)[] = [];
  let nextContent = existing.content;
  let nextStatus = existing.status;

  if (body.content !== undefined) {
    if (typeof body.content !== 'string' || !body.content.trim()) return Response.json({ error: '내용을 입력해 주세요.' }, { status: 400 });
    nextContent = body.content.trim();
    const reason = scanMemoryThreat(nextContent);
    if (reason) return Response.json({ error: `저장이 거부되었습니다: ${reason}` }, { status: 400 });
    columns.push('content = ?'); values.push(nextContent);
  }
  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'pending') return Response.json({ error: "status 는 'active' | 'pending' 이어야 합니다." }, { status: 400 });
    nextStatus = body.status;
    columns.push('status = ?'); values.push(nextStatus);
  }
  if (!columns.length) return Response.json({ error: '변경할 항목이 없습니다.' }, { status: 400 });

  // 승인·수정 결과가 주입 예산(active 기준)을 넘지 않는지 확인합니다.
  if (nextStatus === 'active') {
    const siblings = await listMemories(db, user.userId, existing.scope, existing.scopeId, false);
    const projected = siblings.filter((entry) => entry.id !== id).map((entry) => ({ content: entry.content })).concat([{ content: nextContent }]);
    const used = charCount(projected);
    const limit = MEMORY_LIMITS[existing.scope];
    if (used > limit) {
      return Response.json({ error: `${MEMORY_SCOPE_LABELS[existing.scope]} 예산 초과 (${used}/${limit}자). 다른 엔트리를 정리한 뒤 다시 시도해 주세요.` }, { status: 400 });
    }
  }

  columns.push('updated_at = ?'); values.push(Date.now());
  await db.prepare(`UPDATE memories SET ${columns.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values, id, user.userId).run();
  const memory = await db.prepare(SELECT_MEMORY).bind(id, user.userId).first<Row>();
  return Response.json({ memory });
}

/** DELETE /api/memory/:id — 기억 삭제 (pending 거절도 여기로) */
export async function DELETE(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  const { id } = await context.params;
  const db = getDatabase();
  const result = await db.prepare('DELETE FROM memories WHERE id = ? AND user_id = ?').bind(id, user.userId).run();
  if (!result.meta.changes) return Response.json({ error: '기억을 찾을 수 없습니다.' }, { status: 404 });
  return Response.json({ id });
}
