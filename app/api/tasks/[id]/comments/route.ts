import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type CommentRow = { id: string; author: string; authorKind: string; content: string; createdAt: number };

const SELECT_COMMENTS = 'SELECT id, author, author_kind AS authorKind, content, created_at AS createdAt FROM task_comments WHERE user_id = ? AND task_id = ? ORDER BY created_at ASC';

export async function GET(_request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const db = getDatabase();
  const task = await db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').bind(id, user.userId).first<{ id: string }>();
  if (!task) return Response.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 });
  const rows = await db.prepare(SELECT_COMMENTS).bind(user.userId, id).all<CommentRow>();
  return Response.json({ comments: rows.results });
}

/** POST — { content, author? } author 를 에이전트 이름으로 주면 에이전트 발언으로 기록합니다. */
export async function POST(request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { content?: unknown; author?: unknown } | null;
  if (typeof body?.content !== 'string' || !body.content.trim() || body.content.length > 4000) {
    return Response.json({ error: '댓글은 1~4000자로 입력해 주세요.' }, { status: 400 });
  }

  const db = getDatabase();
  const task = await db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').bind(id, user.userId).first<{ id: string }>();
  if (!task) return Response.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 });

  let author = user.displayName || '나';
  let authorKind = 'user';
  if (typeof body.author === 'string' && body.author.trim()) {
    const agent = await db.prepare('SELECT name FROM agents WHERE user_id = ? AND name = ? LIMIT 1').bind(user.userId, body.author.trim()).first<{ name: string }>();
    if (agent) { author = agent.name; authorKind = 'agent'; }
  }

  const comment: CommentRow = { id: crypto.randomUUID(), author, authorKind, content: body.content.trim(), createdAt: Date.now() };
  await db.prepare('INSERT INTO task_comments (id, user_id, task_id, author, author_kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(comment.id, user.userId, id, comment.author, comment.authorKind, comment.content, comment.createdAt).run();
  return Response.json({ comment }, { status: 201 });
}

/** DELETE /api/tasks/:id/comments?commentId=... */
export async function DELETE(request: Request, context: RouteContext) {
  const user = getCurrentUser();
  const { id } = await context.params;
  const commentId = new URL(request.url).searchParams.get('commentId');
  if (!commentId) return Response.json({ error: '삭제할 댓글을 지정해 주세요.' }, { status: 400 });

  const db = getDatabase();
  const existing = await db.prepare('SELECT id FROM task_comments WHERE id = ? AND user_id = ? AND task_id = ?')
    .bind(commentId, user.userId, id).first<{ id: string }>();
  if (!existing) return Response.json({ error: '댓글을 찾을 수 없습니다.' }, { status: 404 });

  await db.prepare('DELETE FROM task_comments WHERE id = ? AND user_id = ?').bind(commentId, user.userId).run();
  return Response.json({ id: commentId });
}
