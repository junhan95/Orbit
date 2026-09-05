import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';

type RouteContext = { params: Promise<{ id: string; folderId: string }> | { id: string; folderId: string } };

/** 폴더 다시 연결 후 이름·파일 수 갱신. */
export async function PATCH(request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id, folderId } = await context.params;
  const body = await request.json().catch(() => null) as { name?: unknown; pathHint?: unknown; fileCount?: unknown } | null;
  if (!body) return Response.json({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });

  const db = getDatabase();
  const existing = await db.prepare('SELECT id FROM project_folders WHERE id = ? AND project_id = ? AND user_id = ?')
    .bind(folderId, id, user.userId).first<{ id: string }>();
  if (!existing) return Response.json({ error: '연결된 폴더를 찾을 수 없습니다.' }, { status: 404 });

  const columns: string[] = [];
  const values: (string | number)[] = [];
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) {
      return Response.json({ error: '폴더 이름이 올바르지 않습니다.' }, { status: 400 });
    }
    columns.push('name = ?'); values.push(body.name.trim());
  }
  if (body.pathHint !== undefined) {
    if (typeof body.pathHint !== 'string') return Response.json({ error: '경로 메모 형식이 올바르지 않습니다.' }, { status: 400 });
    columns.push('path_hint = ?'); values.push(body.pathHint.trim().slice(0, 400));
  }
  if (body.fileCount !== undefined) {
    if (typeof body.fileCount !== 'number' || !Number.isFinite(body.fileCount)) {
      return Response.json({ error: '파일 수가 올바르지 않습니다.' }, { status: 400 });
    }
    columns.push('file_count = ?'); values.push(Math.max(0, Math.round(body.fileCount)));
  }
  if (!columns.length) return Response.json({ error: '변경할 항목이 없습니다.' }, { status: 400 });

  await db.prepare(`UPDATE project_folders SET ${columns.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...values, folderId, user.userId).run();

  const folder = await db.prepare('SELECT id, name, path_hint AS pathHint, file_count AS fileCount, added_at AS addedAt FROM project_folders WHERE id = ? AND user_id = ?')
    .bind(folderId, user.userId).first();
  return Response.json({ folder });
}

/** 폴더 연결 해제. 사용자 컴퓨터의 파일은 건드리지 않습니다. */
export async function DELETE(_request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id, folderId } = await context.params;
  const db = getDatabase();
  const result = await db.prepare('DELETE FROM project_folders WHERE id = ? AND project_id = ? AND user_id = ?')
    .bind(folderId, id, user.userId).run();
  if (!result.meta.changes) return Response.json({ error: '연결된 폴더를 찾을 수 없습니다.' }, { status: 404 });
  return Response.json({ id: folderId });
}
