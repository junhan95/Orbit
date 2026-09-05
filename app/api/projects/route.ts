import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { MANAGER_ROLE_KEY, managerProfile, uniqueAgentName } from '@/lib/agent-catalog';

const colors = ['#6651f2', '#ff7557', '#16a98c', '#3478f6'];
const MAX_FOLDERS = 8;

type FolderInput = { name: string; pathHint: string; fileCount: number };

/** 새 프로젝트 다이얼로그에서 고른 폴더들. 브라우저가 이름과 파일 수만 보냅니다. */
function parseFolders(raw: unknown): FolderInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const folder = item as { name?: unknown; pathHint?: unknown; fileCount?: unknown };
    if (typeof folder.name !== 'string' || !folder.name.trim()) return [];
    return [{
      name: folder.name.trim().slice(0, 120),
      pathHint: typeof folder.pathHint === 'string' ? folder.pathHint.trim().slice(0, 400) : '',
      fileCount: typeof folder.fileCount === 'number' && Number.isFinite(folder.fileCount) ? Math.max(0, Math.round(folder.fileCount)) : 0,
    }];
  }).slice(0, MAX_FOLDERS);
}

/**
 * 프로젝트 생성.
 * 프로젝트를 만들면 그 프로젝트 전용 '프로젝트 매니저' 한 명만 배정됩니다 (예: 'A 프로젝트 매니저').
 * 나머지 팀원은 사용자가 업무를 지시할 때 매니저가 직무 카탈로그에서 골라 합류시킵니다.
 */
export async function POST(request: Request) {
  const user = getCurrentUser();
  const body = await request.json().catch(() => null) as { name?: unknown; description?: unknown; folders?: unknown } | null;
  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) {
    return Response.json({ error: '프로젝트 이름은 1~80자로 입력해 주세요.' }, { status: 400 });
  }
  const name = body.name.trim();
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 240) : '';
  const folders = parseFolders(body.folders).map((folder) => ({ ...folder, id: crypto.randomUUID() }));

  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = Date.now();
  const color = colors[Math.floor(Math.random() * colors.length)];

  const profile = managerProfile(name);
  const managerId = crypto.randomUUID();
  // 같은 이름의 프로젝트가 이미 있으면 매니저 이름이 겹치므로 뒤에 숫자를 붙입니다.
  const managerLabel = await uniqueAgentName(db, user.userId, profile.name);

  await db.batch([
    db.prepare('INSERT INTO projects (id, user_id, name, description, color, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, user.userId, name, description, color, '진행 중', now, now),
    db.prepare(`INSERT INTO agents (id, user_id, name, role, description, instructions, color, is_default, created_at, project_id, is_manager, role_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?)`)
      .bind(managerId, user.userId, managerLabel, profile.role, profile.description, profile.instructions, profile.color, now, id, MANAGER_ROLE_KEY),
    db.prepare('INSERT OR IGNORE INTO project_agents (project_id, agent_id, user_id, assigned_at) VALUES (?, ?, ?, ?)')
      .bind(id, managerId, user.userId, now),
    ...folders.map((folder, index) => db.prepare('INSERT INTO project_folders (id, project_id, user_id, name, path_hint, file_count, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(folder.id, id, user.userId, folder.name, folder.pathHint, folder.fileCount, now + index)),
  ]);

  return Response.json({
    project: { id, name, description, color, status: '진행 중', taskCount: 0, agentCount: 1, folderCount: folders.length },
    manager: { id: managerId, name: managerLabel, role: profile.role },
    // 브라우저는 이 id 로 디렉터리 핸들을 IndexedDB 에 저장합니다 (보낸 순서 그대로 돌려줍니다).
    folders: folders.map((folder) => ({ id: folder.id, name: folder.name, pathHint: folder.pathHint, fileCount: folder.fileCount })),
  }, { status: 201 });
}
