import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

const MAX_FOLDERS = 8;
const SELECT_FOLDERS = `SELECT id, name, path_hint AS pathHint, file_count AS fileCount, added_at AS addedAt
  FROM project_folders WHERE project_id = ? AND user_id = ? ORDER BY added_at ASC`;

async function assertProject(db: D1Database, projectId: string, userId: string) {
  return db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first<{ id: string }>();
}

/** 프로젝트에 연결된 폴더 목록. 실제 파일 접근 권한은 브라우저가 따로 관리합니다. */
export async function GET(_request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const db = getDatabase();
  if (!await assertProject(db, id, user.userId)) return Response.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });

  const folders = await db.prepare(SELECT_FOLDERS).bind(id, user.userId).all();
  return Response.json({ folders: folders.results });
}

/** 폴더 연결 추가. 브라우저에서 고른 폴더의 이름과 파일 수만 받습니다. */
export async function POST(request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { name?: unknown; pathHint?: unknown; fileCount?: unknown } | null;
  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) {
    return Response.json({ error: '폴더 이름이 올바르지 않습니다.' }, { status: 400 });
  }

  const db = getDatabase();
  if (!await assertProject(db, id, user.userId)) return Response.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });

  const existing = await db.prepare('SELECT COUNT(*) AS count FROM project_folders WHERE project_id = ? AND user_id = ?')
    .bind(id, user.userId).first<{ count: number }>();
  if ((existing?.count ?? 0) >= MAX_FOLDERS) {
    return Response.json({ error: `폴더는 프로젝트당 최대 ${MAX_FOLDERS}개까지 연결할 수 있습니다.` }, { status: 400 });
  }

  const folder = {
    id: crypto.randomUUID(),
    name: body.name.trim(),
    pathHint: typeof body.pathHint === 'string' ? body.pathHint.trim().slice(0, 400) : '',
    fileCount: typeof body.fileCount === 'number' && Number.isFinite(body.fileCount) ? Math.max(0, Math.round(body.fileCount)) : 0,
    addedAt: Date.now(),
  };
  await db.prepare('INSERT INTO project_folders (id, project_id, user_id, name, path_hint, file_count, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(folder.id, id, user.userId, folder.name, folder.pathHint, folder.fileCount, folder.addedAt).run();

  return Response.json({ folder }, { status: 201 });
}
