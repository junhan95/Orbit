import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { scanMemoryThreat } from '@/lib/memory';
import { SKILL_LIMITS, upsertSkill, type SkillScope } from '@/lib/skills';

type Row = {
  id: string; scope: SkillScope; projectId: string | null; projectName: string | null; name: string; description: string; body: string;
  createdBy: string; uses: number; createdAt: number; updatedAt: number;
};

/** GET /api/skills?projectId= — 전역 스킬 + (projectId 가 있으면) 그 프로젝트 스킬. 없으면 전부. */
export async function GET(request: Request) {
  const user = getCurrentUser();
  const projectId = new URL(request.url).searchParams.get('projectId');
  const db = getDatabase();
  const rows = await db.prepare(`SELECT s.id, s.scope, s.project_id AS projectId, p.name AS projectName, s.name, s.description, s.body,
        s.created_by AS createdBy, s.uses, s.created_at AS createdAt, s.updated_at AS updatedAt
      FROM skills s LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.user_id = ? ${projectId ? "AND (s.scope = 'global' OR s.project_id = ?)" : ''}
      ORDER BY s.scope DESC, s.uses DESC, s.name ASC`)
    .bind(user.userId, ...(projectId ? [projectId] : [])).all<Row>();
  return Response.json({ skills: rows.results, limits: SKILL_LIMITS });
}

/** POST /api/skills { name, description, body, scope?, projectId? } — 사람이 직접 스킬 작성 (같은 이름이면 갱신) */
export async function POST(request: Request) {
  const user = getCurrentUser();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  const scope: SkillScope = body.scope === 'global' ? 'global' : 'project';
  if (!name || name.length > SKILL_LIMITS.name) return Response.json({ error: `이름은 1~${SKILL_LIMITS.name}자로 입력해 주세요.` }, { status: 400 });
  if (!description || description.length > SKILL_LIMITS.description) return Response.json({ error: `설명은 1~${SKILL_LIMITS.description}자로 입력해 주세요.` }, { status: 400 });
  if (!text || text.length > SKILL_LIMITS.body) return Response.json({ error: `본문은 1~${SKILL_LIMITS.body}자로 입력해 주세요.` }, { status: 400 });
  const threat = scanMemoryThreat(`${name}\n${description}\n${text}`);
  if (threat) return Response.json({ error: `저장이 거부되었습니다: ${threat}` }, { status: 400 });

  const db = getDatabase();
  let projectId: string | null = null;
  if (scope === 'project') {
    if (typeof body.projectId !== 'string' || !body.projectId) return Response.json({ error: 'project 스코프에는 projectId 가 필요합니다.' }, { status: 400 });
    const owned = await db.prepare('SELECT id FROM projects WHERE user_id = ? AND id = ?').bind(user.userId, body.projectId).first<{ id: string }>();
    if (!owned) return Response.json({ error: '존재하지 않는 프로젝트입니다.' }, { status: 400 });
    projectId = body.projectId;
  }

  const outcome = await upsertSkill(db, { userId: user.userId, scope, projectId, name, description, body: text, actor: 'user' });
  if ('error' in outcome) return Response.json({ error: outcome.error }, { status: 400 });
  return Response.json(outcome, { status: outcome.action === 'created' ? 201 : 200 });
}
