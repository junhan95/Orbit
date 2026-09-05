'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bot, BriefcaseBusiness, Check, ChevronRight, CirclePlus, Clock3, Cpu, EllipsisVertical, Flag, FolderKanban, LayoutGrid, List, ListChecks, LoaderCircle, MessageSquare, Pencil, Play, Plus, Send, Settings2, ShieldCheck, Sparkles, Trash2, UserRound, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Markdown } from '@/components/markdown';
import { PRIORITIES, type Priority, byPriority, toPriority } from '@/lib/priority';
import { TASK_STATUSES, type TaskStatus } from '@/lib/task-status';
import { FIELD_TYPES, FIELD_TYPE_LABELS, type FieldType, type ProjectField } from '@/lib/fields';
import {
  type FolderLinkState, type FsDirHandle, type ProjectFolder,
  buildProjectFolderContext, ensureReadPermission, fetchProjectFolders, forgetHandle, getHandle,
  inspectFolder, pickDirectory, saveHandle, scanDirectory, supportsFolderPicker,
} from '@/lib/folder-access';
import { AGENT_MODELS, agentModelLabel } from '@/lib/models';

export type WorkspaceSection = '프로젝트' | '에이전트' | '대화' | '설정' | '계정';

/** 중요도 배지 색. 높음만 눈에 띄게 하고 나머지는 조용하게 둡니다. */
const PRIORITY_CLASS: Record<Priority, string> = { 높음: 'high', 중간: 'mid', 낮음: 'low' };
type Project = { id: string; name: string; description: string; color: string; status: string; taskCount: number; agentCount: number; folderCount?: number };
type Agent = {
  id: string; name: string; role: string; description: string; instructions: string; model: string | null; color: string; isDefault: number;
  // 에이전트는 프로젝트에 귀속되고, 그중 한 명이 그 프로젝트의 매니저입니다.
  projectId?: string | null; isManager?: number; roleKey?: string | null;
};
type Assignment = { projectId: string; agentId: string };
type ProjectTask = { id: string; title: string; label: string; owner: string; status: string; priority: string; accent: string; result: string | null; description?: string; projectId: string | null };
type FieldValueRow = { taskId: string; fieldId: string; value: string };
type TaskCounts = { taskId: string; subtasks: number; doneSubtasks: number; comments: number };
type Subtask = { id: string; title: string; done: number; owner: string | null; position: number };
type TaskComment = { id: string; author: string; authorKind: string; content: string; createdAt: number };
type TaskRun = { id: string; outcome: string | null; summary: string | null; startedAt: number; completedAt: number | null };
type TaskDetail = {
  task: ProjectTask & { description: string; summary: string | null };
  fields: ProjectField[];
  values: Record<string, string>;
  subtasks: Subtask[];
  comments: TaskComment[];
  runs: TaskRun[];
};
type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: number };

export function WorkspaceView({ section, displayName, email, onNotice }: { section: WorkspaceSection; displayName: string; email: string; onNotice: (message: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/workspace');
      const data = await response.json() as { projects?: Project[]; agents?: Agent[]; assignments?: Assignment[]; error?: string };
      if (!response.ok) throw new Error(data.error || '워크스페이스를 불러오지 못했습니다.');
      setProjects(data.projects || []); setAgents(data.agents || []); setAssignments(data.assignments || []);
    } catch (error) { onNotice(error instanceof Error ? error.message : '워크스페이스를 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [onNotice]);

  // oxlint-disable-next-line react/react-compiler -- async server hydration is intentional here
  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) return <div className="view-loading"><LoaderCircle className="spin" /><span>워크스페이스를 불러오는 중</span></div>;
  if (section === '프로젝트') return <ProjectsView projects={projects} agents={agents} assignments={assignments} onCreated={refresh} onNotice={onNotice} />;
  if (section === '에이전트') return <AgentsView agents={agents} projects={projects} onCreated={refresh} onNotice={onNotice} />;
  if (section === '대화') return <ChatView projects={projects} agents={agents} assignments={assignments} onNotice={onNotice} onRefresh={refresh} />;
  if (section === '설정') return <SettingsView onNotice={onNotice} />;
  return <AccountView displayName={displayName} email={email} />;
}

function ViewHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="workspace-heading"><div><span className="section-kicker">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

const PROJECT_VIEW_KEY = 'cowork.projects.view';
type ProjectLayout = 'card' | 'list';

// ── 작업 폴더 ───────────────────────────────────────────────────────
// 폴더는 브라우저(File System Access API)로 열고, 서버에는 이름·파일 수만 저장합니다.
// 자세한 배경은 lib/folder-access.ts 주석 참고.
type PendingFolder = { key: string; name: string; fileCount: number; handle: FsDirHandle };
type LinkedFolder = ProjectFolder & { link: FolderLinkState };

/** 폴더 선택기 지원 여부. 서버 렌더와 어긋나지 않게 마운트 후에 확인합니다. */
function useFolderPicker() {
  const [ready, setReady] = useState(false);
  // oxlint-disable-next-line react/react-compiler -- 브라우저 기능 확인은 마운트 후에만 가능합니다.
  useEffect(() => { setReady(supportsFolderPicker()); }, []);
  return ready;
}

function FolderUnsupported() {
  return <p className="folder-hint warn">이 브라우저는 폴더 선택을 지원하지 않습니다. Chrome 또는 Edge 에서 열어 주세요.</p>;
}

function folderStateLabel(folder: LinkedFolder) {
  if (folder.link === 'ready') return `파일 ${folder.fileCount}개 · 이 브라우저에서 읽을 수 있어요`;
  if (folder.link === 'blocked') return '읽기 권한이 꺼져 있어요 — 다시 연결하면 복구됩니다';
  return '이 브라우저에는 연결이 없어요 — 폴더를 다시 골라 주세요';
}

/** 프로젝트 상세의 '작업 폴더' 섹션. 추가 / 다시 연결 / 해제를 담당합니다. */
function ProjectFolders({ projectId, onNotice }: { projectId: string; onNotice: (message: string) => void }) {
  const pickerReady = useFolderPicker();
  const [folders, setFolders] = useState<LinkedFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const rows = await fetchProjectFolders(projectId);
    setFolders(await Promise.all(rows.map(async (folder) => ({ ...folder, link: await inspectFolder(folder.id) }))));
    setLoading(false);
  }, [projectId]);

  // oxlint-disable-next-line react/react-compiler -- 진입 시 한 번 확인합니다.
  useEffect(() => { void load(); }, [load]);

  async function addFolder() {
    if (busy) return;
    setBusy(true);
    try {
      const handle = await pickDirectory();
      if (!handle) return;
      const { files } = await scanDirectory(handle);
      const response = await fetch(`/api/projects/${projectId}/folders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: handle.name, fileCount: files.length }),
      });
      const data = await response.json() as { folder?: ProjectFolder; error?: string };
      if (!response.ok || !data.folder) throw new Error(data.error || '폴더를 연결하지 못했습니다.');
      await saveHandle(data.folder.id, handle);
      await load();
      onNotice(`'${handle.name}' 폴더를 연결했습니다 (파일 ${files.length}개).`);
    } catch (error) { onNotice(error instanceof Error ? error.message : '폴더를 연결하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function relinkFolder(folder: LinkedFolder) {
    if (busy) return;
    setBusy(true);
    try {
      // 권한만 꺼진 경우에는 다시 고를 필요 없이 허용만 받으면 됩니다.
      if (folder.link === 'blocked') {
        const stored = await getHandle(folder.id);
        if (stored && await ensureReadPermission(stored)) { await load(); onNotice('폴더 읽기 권한을 다시 받았습니다.'); return; }
      }
      const handle = await pickDirectory();
      if (!handle) return;
      const { files } = await scanDirectory(handle);
      await saveHandle(folder.id, handle);
      await fetch(`/api/projects/${projectId}/folders/${folder.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: handle.name, fileCount: files.length }),
      });
      await load();
      onNotice(`'${handle.name}' 폴더를 이 브라우저에 다시 연결했습니다.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : '폴더를 다시 연결하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function removeFolder(folder: LinkedFolder) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/folders/${folder.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || '폴더 연결을 해제하지 못했습니다.');
      }
      await forgetHandle(folder.id);
      await load();
      onNotice('폴더 연결을 해제했습니다. 컴퓨터의 파일은 그대로입니다.');
    } catch (error) { onNotice(error instanceof Error ? error.message : '폴더 연결을 해제하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  return <section className="detail-section">
    <div className="folder-section-head">
      <h2>작업 폴더</h2>
      <button className="folder-add" onClick={() => void addFolder()} disabled={!pickerReady || busy}>
        {busy ? <LoaderCircle className="spin" size={14} /> : <CirclePlus size={14} />} 폴더 추가
      </button>
    </div>
    {!pickerReady
      ? <FolderUnsupported />
      : loading
        ? <p className="detail-empty">폴더 연결 상태를 확인하는 중…</p>
        : folders.length
          ? <div className="folder-cards">{folders.map((folder) => <article className={`folder-card ${folder.link}`} key={folder.id}>
              <span className="folder-symbol"><FolderKanban size={16} /></span>
              <div><b>{folder.name}</b><small>{folderStateLabel(folder)}</small></div>
              {folder.link !== 'ready' && <button className="folder-relink" onClick={() => void relinkFolder(folder)} disabled={busy}>다시 연결</button>}
              <button className="folder-remove" onClick={() => void removeFolder(folder)} disabled={busy} aria-label={`${folder.name} 연결 해제`} title="연결 해제"><Trash2 size={14} /></button>
            </article>)}</div>
          : <p className="detail-empty">연결된 폴더가 없습니다. 폴더를 추가하면 에이전트가 업무를 실행할 때 그 안의 파일 목록과 내용을 함께 읽습니다.</p>}
  </section>;
}

function ProjectsView({ projects, agents, assignments, onCreated, onNotice }: { projects: Project[]; agents: Agent[]; assignments: Assignment[]; onCreated: () => Promise<void>; onNotice: (message: string) => void }) {
  const [name, setName] = useState(''); const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  // 새 프로젝트 다이얼로그에서 고른 폴더들. 프로젝트가 만들어진 뒤에 핸들을 저장합니다.
  const [pendingFolders, setPendingFolders] = useState<PendingFolder[]>([]);
  const [folderBusy, setFolderBusy] = useState(false);
  const pickerReady = useFolderPicker();
  const [layout, setLayout] = useState<ProjectLayout>('card');
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [removing, setRemoving] = useState<Project | null>(null);
  const [removeTasks, setRemoveTasks] = useState(false);
  const [busy, setBusy] = useState(false);

  const startRename = useCallback((project: Project) => {
    setEditing(project); setEditName(project.name); setEditDescription(project.description);
  }, []);

  async function renameProject() {
    if (!editing || !editName.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${editing.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), description: editDescription.trim() }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || '프로젝트를 수정하지 못했습니다.');
      setEditing(null); await onCreated(); onNotice('프로젝트 정보를 수정했습니다.');
    } catch (error) { onNotice(error instanceof Error ? error.message : '프로젝트를 수정하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function deleteProject() {
    if (!removing) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${removing.id}${removeTasks ? '?withTasks=1' : ''}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || '프로젝트를 삭제하지 못했습니다.');
      }
      if (openedId === removing.id) setOpenedId(null);
      setRemoving(null); setRemoveTasks(false); await onCreated();
      onNotice(removeTasks ? '프로젝트와 업무를 삭제했습니다.' : '프로젝트를 삭제했습니다. 업무는 남아 있어요.');
    } catch (error) { onNotice(error instanceof Error ? error.message : '프로젝트를 삭제하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  const projectMenu = (project: Project) => <DropdownMenu>
    <DropdownMenuTrigger render={<button className="project-menu" aria-label={`${project.name} 메뉴`} />}><EllipsisVertical size={16} /></DropdownMenuTrigger>
    <DropdownMenuContent className="project-menu-content" align="end">
      <DropdownMenuItem onClick={() => startRename(project)}><Pencil size={14} /> 이름 변경</DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onClick={() => { setRemoveTasks(false); setRemoving(project); }}><Trash2 size={14} /> 프로젝트 삭제</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;

  const projectDialogs = <>
    <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
      <DialogContent className="create-entity-dialog">
        <DialogHeader><DialogTitle>프로젝트 수정</DialogTitle><DialogDescription>이름과 설명을 바꿔도 업무와 대화 기록은 그대로 유지됩니다.</DialogDescription></DialogHeader>
        <label className="entity-field"><span>프로젝트 이름</span><input value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
        <label className="entity-field"><span>설명</span><textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></label>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
          <DialogClose render={<Button disabled={!editName.trim() || busy} onClick={renameProject} />}>{busy ? '저장 중' : '저장'}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
      <DialogContent className="create-entity-dialog">
        <DialogHeader>
          <DialogTitle>{removing?.name} 삭제</DialogTitle>
          <DialogDescription>이 작업은 되돌릴 수 없습니다. 프로젝트에 남은 대화 기록도 함께 삭제됩니다.</DialogDescription>
        </DialogHeader>
        <label className="danger-option">
          <Checkbox checked={removeTasks} onCheckedChange={(checked) => setRemoveTasks(Boolean(checked))} />
          <span><b>업무 {removing?.taskCount ?? 0}건도 함께 삭제</b><small>체크하지 않으면 업무는 남고 프로젝트 연결만 해제됩니다.</small></span>
        </label>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
          <DialogClose render={<Button className="danger-button" disabled={busy} onClick={deleteProject} />}>{busy ? '삭제 중' : '삭제'}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;

  // 마지막으로 고른 보기 방식을 브라우저에 기억해 둡니다.
  useEffect(() => {
    try { const stored = window.localStorage.getItem(PROJECT_VIEW_KEY); if (stored === 'card' || stored === 'list') setLayout(stored); } catch { /* 저장소 접근 불가 시 기본값 유지 */ }
  }, []);
  const changeLayout = useCallback((next: ProjectLayout) => {
    setLayout(next);
    try { window.localStorage.setItem(PROJECT_VIEW_KEY, next); } catch { /* 저장 실패는 무시 */ }
  }, []);
  async function addPendingFolder() {
    if (folderBusy) return;
    setFolderBusy(true);
    try {
      const handle = await pickDirectory();
      if (!handle) return;
      const { files } = await scanDirectory(handle);
      setPendingFolders((current) => current.some((item) => item.name === handle.name)
        ? current
        : [...current, { key: crypto.randomUUID(), name: handle.name, fileCount: files.length, handle }]);
    } catch (error) { onNotice(error instanceof Error ? error.message : '폴더를 읽지 못했습니다.'); }
    finally { setFolderBusy(false); }
  }

  async function createProject() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, folders: pendingFolders.map((folder) => ({ name: folder.name, fileCount: folder.fileCount })) }),
      });
      const data = await response.json() as { manager?: { name: string }; folders?: { id: string }[]; error?: string };
      if (!response.ok) throw new Error(data.error || '프로젝트를 만들지 못했습니다.');
      // 서버가 보낸 순서 = 우리가 보낸 순서. 그 id 로 디렉터리 핸들을 이 브라우저에 저장합니다.
      await Promise.all((data.folders ?? []).map((folder, index) => {
        const pending = pendingFolders[index];
        return pending ? saveHandle(folder.id, pending.handle) : Promise.resolve();
      }));
      const folderCount = pendingFolders.length;
      setName(''); setDescription(''); setPendingFolders([]);
      await onCreated();
      onNotice(`${data.manager?.name ?? '프로젝트 매니저'}가 배정되었습니다${folderCount ? ` · 폴더 ${folderCount}개 연결` : ''}.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : '프로젝트를 만들지 못했습니다.'); }
    finally { setSaving(false); }
  }
  const layoutToggle = <div className="layout-toggle" role="group" aria-label="프로젝트 보기 방식">
    <button className={layout === 'card' ? 'active' : ''} aria-pressed={layout === 'card'} onClick={() => changeLayout('card')} title="카드 보기"><LayoutGrid size={15} /> 카드</button>
    <button className={layout === 'list' ? 'active' : ''} aria-pressed={layout === 'list'} onClick={() => changeLayout('list')} title="리스트 보기"><List size={15} /> 리스트</button>
  </div>;
  const createDialog = <Dialog><DialogTrigger render={<Button className="view-primary" />}><Plus size={16} /> 프로젝트 만들기</DialogTrigger><DialogContent className="create-entity-dialog">
    <DialogHeader><DialogTitle>새 프로젝트</DialogTitle><DialogDescription>목표와 작업 폴더만 정하면 됩니다. 전담 프로젝트 매니저가 배정되고, 필요한 에이전트는 매니저가 합류시킵니다.</DialogDescription></DialogHeader>
    <label className="entity-field"><span>프로젝트 이름</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 신규 서비스 출시" /></label>
    <label className="entity-field"><span>설명</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="달성하려는 목표를 간단히 적어주세요." /></label>
    <div className="folder-picker">
      <div className="folder-picker-head">
        <span>작업 폴더 <em>선택</em></span>
        <button type="button" className="folder-add" onClick={() => void addPendingFolder()} disabled={!pickerReady || folderBusy}>
          {folderBusy ? <LoaderCircle className="spin" size={13} /> : <CirclePlus size={13} />} 폴더 선택
        </button>
      </div>
      {!pickerReady
        ? <FolderUnsupported />
        : pendingFolders.length
          ? <ul className="folder-chips">{pendingFolders.map((folder) => <li key={folder.key}>
              <FolderKanban size={13} /><b>{folder.name}</b><small>파일 {folder.fileCount}</small>
              <button type="button" onClick={() => setPendingFolders((current) => current.filter((item) => item.key !== folder.key))} aria-label={`${folder.name} 제외`} title="제외"><Trash2 size={12} /></button>
            </li>)}</ul>
          : <p className="folder-hint">폴더를 연결하면 에이전트가 업무를 실행할 때 그 안의 파일을 함께 읽습니다. 파일은 이 브라우저에서만 읽히고 서버에는 폴더 이름만 저장됩니다.</p>}
    </div>
    {name.trim() && <p className="manager-preview"><UserRound size={13} /> 배정될 매니저: <b>{name.trim()} 프로젝트 매니저</b></p>}
    <DialogFooter><DialogClose render={<Button variant="outline" />}>취소</DialogClose><DialogClose render={<Button disabled={!name.trim() || saving} onClick={createProject} />}>{saving ? '생성 중' : '프로젝트 생성'}</DialogClose></DialogFooter>
  </DialogContent></Dialog>;
  const action = <div className="view-actions">{projects.length > 0 && layoutToggle}{createDialog}</div>;
  const opened = projects.find((project) => project.id === openedId) || null;
  if (opened) return <>
    <ProjectDetail project={opened} agents={agents} assignments={assignments} onBack={() => setOpenedId(null)} onNotice={onNotice}
      onRename={() => startRename(opened)} onDelete={() => { setRemoveTasks(false); setRemoving(opened); }} />
    {projectDialogs}
  </>;
  return <div className="workspace-view"><ViewHeading eyebrow="Projects" title="프로젝트" description="진행 중인 프로젝트와 참여 에이전트를 관리합니다." action={action} />
    {projects.length > 0 && (layout === 'card'
      ? <div className="project-grid">{projects.map((project) => <article className="project-card is-clickable" key={project.id}><button className="open-overlay" tabIndex={-1} aria-hidden="true" onClick={() => setOpenedId(project.id)} /><div className="project-card-top"><span className="project-symbol" style={{ background: project.color }}><FolderKanban size={20} /></span><span className="project-card-tools"><span className="project-status"><i />{project.status}</span>{projectMenu(project)}</span></div><h2>{project.name}</h2><p>{project.description || '프로젝트 설명이 없습니다.'}</p><div className="project-stats"><span><BriefcaseBusiness size={14} />업무 {project.taskCount}</span><span><Users size={14} />에이전트 {project.agentCount}</span>{Boolean(project.folderCount) && <span><FolderKanban size={14} />폴더 {project.folderCount}</span>}</div><button className="project-card-open" onClick={() => setOpenedId(project.id)} aria-label={`${project.name} 프로젝트 열기`}>프로젝트 열기 <ChevronRight size={15} /></button></article>)}</div>
      : <div className="project-table" role="table" aria-label="프로젝트 목록">
          <div className="project-row head" role="row"><span role="columnheader">프로젝트</span><span role="columnheader">상태</span><span role="columnheader">업무</span><span role="columnheader">에이전트</span><span role="columnheader" /></div>
          {projects.map((project) => <div className="project-row is-clickable" role="row" key={project.id}>
            <button className="open-overlay" tabIndex={-1} aria-hidden="true" onClick={() => setOpenedId(project.id)} />
            <span className="project-row-main" role="cell"><i className="project-dot" style={{ background: project.color }}><FolderKanban size={15} /></i><b>{project.name}</b><small>{project.description || '프로젝트 설명이 없습니다.'}</small></span>
            <span role="cell"><em className="project-status"><i />{project.status}</em></span>
            <span className="project-row-metric" role="cell"><BriefcaseBusiness size={14} />{project.taskCount}</span>
            <span className="project-row-metric" role="cell"><Users size={14} />{project.agentCount}</span>
            <span className="project-row-tools" role="cell"><button className="project-row-open" onClick={() => setOpenedId(project.id)} aria-label={`${project.name} 프로젝트 열기`}>열기 <ChevronRight size={15} /></button>{projectMenu(project)}</span>
          </div>)}
        </div>)}
    {!projects.length && <div className="entity-empty"><CirclePlus size={30} /><h2>첫 프로젝트를 만들어 보세요</h2><p>목표와 에이전트를 한곳에서 관리할 수 있어요.</p></div>}
    {projectDialogs}
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 프로젝트 상세 = Asana 식 TASK 보드
//   · 컬럼 그룹 기준을 담당자 / 상태 / 분류 중에서 고릅니다 (기본: 담당자).
//   · 카드를 누르면 TASK 상세 패널이 열리고, 프로젝트 커스텀 필드를 여기서 채웁니다.
//   · 필드 정의는 프로젝트 단위이며 사용자와 에이전트 양쪽이 만들 수 있습니다.
// ─────────────────────────────────────────────────────────────────────────────

const BOARD_GROUPS = ['담당자', '상태', '분류'] as const;
type BoardGroup = (typeof BOARD_GROUPS)[number];
const BOARD_GROUP_KEY = 'cowork.board.group';
const UNASSIGNED = '__none__';

type BoardColumn = { key: string; title: string; subtitle?: string; color?: string; owner?: string; status?: TaskStatus; label?: string; tasks: ProjectTask[] };

function ProjectDetail({ project, agents, assignments, onBack, onNotice, onRename, onDelete }: { project: Project; agents: Agent[]; assignments: Assignment[]; onBack: () => void; onNotice: (message: string) => void; onRename: () => void; onDelete: () => void }) {
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [fields, setFields] = useState<ProjectField[]>([]);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [counts, setCounts] = useState<Record<string, TaskCounts>>({});
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [group, setGroup] = useState<BoardGroup>('담당자');
  // 보드를 다시 읽을 때마다 올라갑니다. 열려 있는 상세 패널도 이 값을 보고 자기 데이터를 새로 읽습니다.
  const [revision, setRevision] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [label, setLabel] = useState('');
  const [priority, setPriority] = useState<Priority>('중간');
  const [createStatus, setCreateStatus] = useState<TaskStatus>('대기');
  const [saving, setSaving] = useState(false);

  const members = useMemo(
    () => agents.filter((agent) => assignments.some((item) => item.projectId === project.id && item.agentId === agent.id)),
    [agents, assignments, project.id],
  );

  // oxlint-disable-next-line react/react-compiler -- 브라우저에서만 읽을 수 있는 저장값입니다.
  useEffect(() => {
    const stored = window.localStorage.getItem(BOARD_GROUP_KEY);
    if (stored && (BOARD_GROUPS as readonly string[]).includes(stored)) setGroup(stored as BoardGroup);
  }, []);

  const changeGroup = useCallback((next: BoardGroup) => {
    setGroup(next);
    try { window.localStorage.setItem(BOARD_GROUP_KEY, next); } catch { /* 저장 실패는 무시합니다. */ }
  }, []);

  const loadTasks = useCallback(async () => {
    const response = await fetch('/api/tasks');
    const data = await response.json() as { tasks?: ProjectTask[]; error?: string };
    if (!response.ok) throw new Error(data.error || '프로젝트 업무를 불러오지 못했습니다.');
    setTasks((data.tasks || []).filter((task) => task.projectId === project.id));
  }, [project.id]);

  const loadFields = useCallback(async () => {
    const response = await fetch(`/api/projects/${project.id}/fields?values=1`);
    const data = await response.json() as { fields?: ProjectField[]; values?: FieldValueRow[]; counts?: TaskCounts[]; error?: string };
    if (!response.ok) throw new Error(data.error || '커스텀 필드를 불러오지 못했습니다.');
    setFields(data.fields || []);
    const next: Record<string, Record<string, string>> = {};
    for (const row of data.values || []) {
      next[row.taskId] ??= {};
      next[row.taskId][row.fieldId] = row.value;
    }
    setValues(next);
    setCounts(Object.fromEntries((data.counts || []).map((row) => [row.taskId, row])));
  }, [project.id]);

  const reload = useCallback(async () => {
    try { await Promise.all([loadTasks(), loadFields()]); setRevision((value) => value + 1); }
    catch (error) { onNotice(error instanceof Error ? error.message : '프로젝트를 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [loadTasks, loadFields, onNotice]);

  // oxlint-disable-next-line react/react-compiler -- 최초 진입 시 한 번만 불러옵니다.
  useEffect(() => { setLoading(true); void reload(); }, [reload]);

  function openCreate(presetOwner?: string, presetLabel?: string, presetStatus?: TaskStatus) {
    setOwner(presetOwner ?? '');
    setLabel(presetLabel ?? '');
    setTitle(''); setPriority('중간');
    setCreateStatus(presetStatus ?? '대기');
    setCreateOpen(true);
  }

  async function createTask() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed, owner: owner || undefined, label: label.trim() || undefined, status: createStatus, priority, projectId: project.id }),
      });
      const data = await response.json() as { task?: ProjectTask; error?: string };
      if (!response.ok || !data.task) throw new Error(data.error || '업무를 만들지 못했습니다.');
      setTasks((current) => [...current, data.task as ProjectTask]);
      setTitle(''); setLabel(''); setPriority('중간');
      onNotice(`새 업무가 ${data.task.owner}에게 배정되었습니다.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : '업무를 만들지 못했습니다.'); }
    finally { setSaving(false); }
  }

  const patchTask = useCallback(async (task: ProjectTask, patch: Record<string, unknown>) => {
    setPendingId(task.id);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, ...patch } as ProjectTask : item));
    try {
      const response = await fetch(`/api/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const data = await response.json() as { task?: ProjectTask; error?: string };
      if (!response.ok || !data.task) throw new Error(data.error || '업무를 수정하지 못했습니다.');
      setTasks((current) => current.map((item) => item.id === task.id ? data.task as ProjectTask : item));
      return data.task;
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === task.id ? task : item));
      onNotice(error instanceof Error ? error.message : '업무를 수정하지 못했습니다.');
      return null;
    } finally { setPendingId(null); }
  }, [onNotice]);

  async function runTask(task: ProjectTask) {
    setRunningId(task.id);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: '진행 중' } : item));
    try {
      // 연결된 폴더가 있으면 브라우저에서 읽어 함께 보냅니다 (서버는 파일시스템에 접근할 수 없습니다).
      const folderContext = await buildProjectFolderContext(project.id);
      const response = await fetch('/api/agents/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id, folderContext }) });
      const data = await response.json() as {
        output?: string; error?: string;
        createdTasks?: Array<{ title: string; owner: string }>; createdFields?: Array<{ name: string }>;
        recruited?: Array<{ name: string; role: string }>; delegated?: Array<{ title: string; agent: string }>;
      };
      if (!response.ok || !data.output) throw new Error(data.error || '에이전트 실행에 실패했습니다.');
      // 에이전트가 카드나 필드를 만들었을 수 있으므로 보드를 통째로 다시 읽습니다.
      await reload();
      setOpenTaskId(task.id);
      const extras = [
        data.recruited?.length ? `에이전트 ${data.recruited.length}명 합류` : '',
        data.delegated?.length ? `업무 ${data.delegated.length}건 위임·완료` : '',
        data.createdTasks?.length ? `업무 ${data.createdTasks.length}개 생성` : '',
        data.createdFields?.length ? `필드 ${data.createdFields.length}개 생성` : '',
      ].filter(Boolean).join(' · ');
      onNotice(`${task.owner}가 업무를 완료했습니다.${extras ? ` (${extras})` : ''}`);
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === task.id ? task : item));
      onNotice(error instanceof Error ? error.message : '에이전트 실행에 실패했습니다.');
    } finally { setRunningId(null); }
  }

  const removeTask = useCallback(async (task: ProjectTask) => {
    const snapshot = tasks;
    setTasks((current) => current.filter((item) => item.id !== task.id));
    try {
      const response = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || '업무를 삭제하지 못했습니다.');
      }
      onNotice('업무를 삭제했습니다.');
    } catch (error) {
      setTasks(snapshot);
      onNotice(error instanceof Error ? error.message : '업무를 삭제하지 못했습니다.');
    }
  }, [tasks, onNotice]);

  const reviewCount = tasks.filter((task) => task.status === '검토').length;
  const progress = tasks.length ? Math.round((reviewCount / tasks.length) * 100) : 0;
  const cardFields = useMemo(() => fields.filter((field) => field.showOnCard), [fields]);

  // 그룹 기준에 따라 컬럼을 만듭니다. 담당자 기준일 때는 업무가 없는 참여 에이전트도 빈 열로 보입니다.
  const columns = useMemo<BoardColumn[]>(() => {
    if (group === '상태') {
      return TASK_STATUSES.map((status) => ({ key: status, title: status, status, tasks: byPriority(tasks.filter((task) => task.status === status)) }));
    }
    if (group === '분류') {
      const labels = Array.from(new Set(tasks.map((task) => task.label))).sort((a, b) => a.localeCompare(b, 'ko'));
      return labels.map((item) => ({ key: item, title: item, label: item, tasks: byPriority(tasks.filter((task) => task.label === item)) }));
    }
    const roster = members.length ? members : agents;
    const known = new Set(roster.map((agent) => agent.name));
    const columnList: BoardColumn[] = roster.map((agent) => ({
      key: agent.id, title: agent.name, subtitle: agent.role, color: agent.color, owner: agent.name,
      tasks: byPriority(tasks.filter((task) => task.owner === agent.name)),
    }));
    const orphans = tasks.filter((task) => !known.has(task.owner));
    if (orphans.length) columnList.push({ key: UNASSIGNED, title: '미배정', subtitle: '프로젝트에 없는 담당자', tasks: byPriority(orphans) });
    return columnList;
  }, [group, tasks, members, agents]);

  const openTask = tasks.find((task) => task.id === openTaskId) ?? null;

  const createDialog = <Dialog open={createOpen} onOpenChange={setCreateOpen}>
    <DialogTrigger render={<Button className="view-primary" onClick={() => openCreate()} />}><Plus size={16} /> 업무 추가</DialogTrigger>
    <DialogContent className="create-entity-dialog">
      <DialogHeader><DialogTitle>{project.name} · 새 업무</DialogTitle><DialogDescription>담당을 비워 두면 프로젝트 매니저가 받아 필요한 에이전트를 합류시키고 나눠 맡깁니다. 중요도가 높을수록 보드 위쪽에 놓이고 에이전트도 먼저 처리합니다.</DialogDescription></DialogHeader>
      <label className="entity-field"><span>업무 이름</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 결제 플로우 엣지 케이스 정리" /></label>
      <div className="entity-row">
        <label className="entity-field"><span>담당 에이전트</span>
          <NativeSelect value={owner} onChange={(event) => setOwner(event.target.value)}>
            <NativeSelectOption value="">프로젝트 매니저에게 (기본)</NativeSelectOption>
            {members.map((agent) => <NativeSelectOption key={agent.id} value={agent.name}>{agent.name} · {agent.role}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <label className="entity-field"><span>분류</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="예: 리서치" /></label>
        <label className="entity-field"><span>중요도</span>
          <NativeSelect value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
            {PRIORITIES.map((option) => <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>)}
          </NativeSelect>
        </label>
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
        <DialogClose render={<Button disabled={!title.trim() || saving} onClick={createTask} />}>{saving ? '배정 중' : '업무 배정'}</DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>;

  return <div className="workspace-view project-detail">
    <button className="detail-back" onClick={onBack}><ArrowLeft size={15} /> 프로젝트 목록</button>
    <div className="workspace-heading">
      <div>
        <span className="section-kicker">Project</span>
        <h1>{project.name}</h1>
        <p>{project.description || '프로젝트 설명이 없습니다.'}</p>
      </div>
      <div className="view-actions">
        <span className="project-status"><i />{project.status}</span>
        {createDialog}
        <DropdownMenu>
          <DropdownMenuTrigger render={<button className="project-menu" aria-label="프로젝트 메뉴" />}><EllipsisVertical size={16} /></DropdownMenuTrigger>
          <DropdownMenuContent className="project-menu-content" align="end">
            <DropdownMenuItem onClick={onRename}><Pencil size={14} /> 이름 변경</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2 size={14} /> 프로젝트 삭제</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <div className="detail-metrics">
      <article><span>전체 업무</span><strong>{tasks.length}</strong></article>
      <article><span>검토 단계</span><strong>{reviewCount}</strong></article>
      <article><span>참여 에이전트</span><strong>{members.length}</strong></article>
      <article className="detail-progress">
        <span>검토 도달률</span><strong>{progress}%</strong>
        <div className="detail-bar"><i style={{ width: `${progress}%` }} /></div>
      </article>
    </div>

    <section className="detail-section board-section">
      <div className="board-toolbar">
        <div className="board-group">
          <LayoutGrid size={14} />
          <span>그룹</span>
          <NativeSelect value={group} onChange={(event) => changeGroup(event.target.value as BoardGroup)} aria-label="보드 그룹 기준">
            {BOARD_GROUPS.map((option) => <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <button className="board-tool" onClick={() => setFieldOpen(true)}>
          <Settings2 size={14} /> 사용자 지정 필드 <em>{fields.length}</em>
        </button>
      </div>

      {loading
        ? <div className="view-loading"><LoaderCircle className="spin" /><span>보드를 불러오는 중</span></div>
        : columns.length
          ? <div className="board-columns">{columns.map((column) => <section className="board-column" key={column.key}>
              <header className="board-column-head">
                {column.color
                  ? <span className="board-column-avatar" style={{ background: column.color }}>{column.title.slice(0, 1)}</span>
                  : <span className="board-column-mark" />}
                <div><b>{column.title}</b>{column.subtitle && <small>{column.subtitle}</small>}</div>
                <em>{column.tasks.length}</em>
              </header>
              <div className="board-column-body">
                {column.tasks.map((task) => <BoardCard
                  key={task.id} task={task} fields={cardFields} values={values[task.id]} counts={counts[task.id]}
                  running={runningId === task.id} pending={pendingId === task.id}
                  onOpen={() => setOpenTaskId(task.id)}
                  onStatus={(status) => void patchTask(task, { status })}
                  onRun={() => void runTask(task)}
                />)}
                <button className="board-add" onClick={() => openCreate(column.owner, column.label, column.status)}>
                  <Plus size={13} /> 작업 추가
                </button>
              </div>
            </section>)}</div>
          : <p className="detail-empty">아직 이 프로젝트에 등록된 업무가 없습니다. 위의 &lsquo;업무 추가&rsquo;로 매니저에게 첫 업무를 맡겨 보세요.</p>}
    </section>

    <ProjectFolders projectId={project.id} onNotice={onNotice} />

    {openTask && <TaskDetailDialog
      task={openTask} project={project} agents={members.length ? members : agents}
      fields={fields} values={values[openTask.id]} reloadKey={revision}
      onClose={() => setOpenTaskId(null)}
      onNotice={onNotice}
      onPatch={(patch) => patchTask(openTask, patch)}
      onDelete={async () => { setOpenTaskId(null); await removeTask(openTask); }}
      onRun={() => void runTask(openTask)}
      running={runningId === openTask.id}
      onManageFields={() => setFieldOpen(true)}
    />}

    <FieldManagerDialog
      open={fieldOpen} onOpenChange={setFieldOpen}
      projectId={project.id} fields={fields} onChanged={reload} onNotice={onNotice}
    />
  </div>;
}

/** 보드 카드. 본체를 누르면 상세가 열리고, 아래 조작부는 클릭이 위로 전파되지 않게 막습니다. */
function BoardCard({ task, fields, values, counts, running, pending, onOpen, onStatus, onRun }: {
  task: ProjectTask; fields: ProjectField[]; values?: Record<string, string>; counts?: TaskCounts;
  running: boolean; pending: boolean; onOpen: () => void; onStatus: (status: TaskStatus) => void; onRun: () => void;
}) {
  const badges = fields
    .map((field) => ({ field, value: values?.[field.id] ?? '' }))
    .filter((item) => item.value);

  return <article className="board-card">
    <button className="board-card-open" onClick={onOpen} aria-label={`${task.title} 상세 열기`}>
      <div className="board-card-top">
        <span className="task-label" style={{ color: task.accent, backgroundColor: `${task.accent}14` }}>{task.label}</span>
        <span className={`board-chip ${task.status === '진행 중' ? 'doing' : task.status === '검토' ? 'review' : ''}`}>{task.status}</span>
      </div>
      <b>{task.title}</b>
      {Boolean(badges.length) && <div className="board-card-fields">
        {badges.map(({ field, value }) => <span className="board-field-badge" key={field.id}>
          <i>{field.name}</i>{field.type === 'checkbox' ? '예' : value}
        </span>)}
      </div>}
      <div className="board-card-meta">
        <span className="mini-avatar" style={{ background: task.accent }}>{task.owner.slice(0, 1)}</span>
        <span>{task.owner}</span>
        <span className={`priority-badge ${PRIORITY_CLASS[toPriority(task.priority)]}`} title={`중요도 ${toPriority(task.priority)}`}><Flag size={11} /> {toPriority(task.priority)}</span>
      </div>
      {Boolean(counts && (counts.subtasks || counts.comments)) && <div className="board-card-counts">
        {Boolean(counts?.subtasks) && <span><ListChecks size={12} /> {counts?.doneSubtasks}/{counts?.subtasks}</span>}
        {Boolean(counts?.comments) && <span><MessageSquare size={12} /> {counts?.comments}</span>}
      </div>}
    </button>
    <div className="detail-task-actions">
      <select className="task-status" aria-label={`${task.title} 상태`} value={task.status} disabled={pending} onChange={(event) => onStatus(event.target.value as TaskStatus)}>
        {TASK_STATUSES.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <button className={task.result ? 'run-task result' : 'run-task'} disabled={running} onClick={task.result ? onOpen : onRun}>
        {running ? <LoaderCircle className="spin" size={13} /> : task.result ? <Check size={13} /> : <Play size={13} fill="currentColor" />}
        {running ? '실행 중' : task.result ? '결과' : '실행'}
      </button>
    </div>
  </article>;
}

/** 커스텀 필드 하나의 입력 위젯. 타입에 맞는 컨트롤을 고릅니다. */
function FieldInput({ field, value, onChange }: { field: ProjectField; value: string; onChange: (next: string) => void }) {
  if (field.type === 'checkbox') {
    return <span className="task-field-check">
      <Checkbox checked={Boolean(value)} aria-label={field.name} onCheckedChange={(checked) => onChange(checked ? '1' : '')} />
      <span>{value ? '예' : '아니오'}</span>
    </span>;
  }
  if (field.type === 'select') {
    return <NativeSelect value={value} onChange={(event) => onChange(event.target.value)}>
      <NativeSelectOption value="">—</NativeSelectOption>
      {field.options.map((option) => <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>)}
    </NativeSelect>;
  }
  return <input
    className="task-field-input"
    type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
    value={value}
    placeholder="—"
    onChange={(event) => onChange(event.target.value)}
  />;
}

/** TASK 상세 패널. Asana 의 작업 상세와 같은 구성입니다. */
function TaskDetailDialog({ task, project, agents, fields, values, running, reloadKey, onClose, onNotice, onPatch, onDelete, onRun, onManageFields }: {
  task: ProjectTask; project: Project; agents: Agent[]; fields: ProjectField[]; values: Record<string, string> | undefined;
  running: boolean; reloadKey: number;
  onClose: () => void; onNotice: (message: string) => void;
  onPatch: (patch: Record<string, unknown>) => Promise<ProjectTask | null>;
  onDelete: () => Promise<void>; onRun: () => void; onManageFields: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [description, setDescription] = useState('');
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/tasks/${task.id}/detail`);
      const data = await response.json() as (TaskDetail & { error?: string });
      if (!response.ok) throw new Error(data.error || '업무 상세를 불러오지 못했습니다.');
      setDetail(data);
      setDescription(data.task.description ?? '');
      setTitleDraft(data.task.title);
    } catch (error) { onNotice(error instanceof Error ? error.message : '업무 상세를 불러오지 못했습니다.'); }
  }, [task.id, onNotice]);

  // oxlint-disable-next-line react/react-compiler -- 패널을 열 때, 그리고 보드가 갱신될 때 다시 읽습니다.
  useEffect(() => { void load(); }, [load, reloadKey]);

  async function saveDetail(patch: { description?: string; values?: Record<string, string> }) {
    try {
      const response = await fetch(`/api/tasks/${task.id}/detail`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || '저장하지 못했습니다.');
      if (patch.description !== undefined) {
        setDetail((current) => current ? { ...current, task: { ...current.task, description: patch.description as string } } : current);
      }
    } catch (error) { onNotice(error instanceof Error ? error.message : '저장하지 못했습니다.'); void load(); }
  }

  function setFieldValue(fieldId: string, next: string) {
    setDetail((current) => current ? { ...current, values: { ...current.values, [fieldId]: next } } : current);
  }

  async function addSubtask() {
    const trimmed = subtaskDraft.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/subtasks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: trimmed }),
      });
      const data = await response.json() as { subtask?: Subtask; error?: string };
      if (!response.ok || !data.subtask) throw new Error(data.error || '하위 작업을 추가하지 못했습니다.');
      setDetail((current) => current ? { ...current, subtasks: [...current.subtasks, data.subtask as Subtask] } : current);
      setSubtaskDraft('');
    } catch (error) { onNotice(error instanceof Error ? error.message : '하위 작업을 추가하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function toggleSubtask(subtask: Subtask, done: boolean) {
    setDetail((current) => current ? { ...current, subtasks: current.subtasks.map((item) => item.id === subtask.id ? { ...item, done: done ? 1 : 0 } : item) } : current);
    const response = await fetch(`/api/tasks/${task.id}/subtasks`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subtaskId: subtask.id, done }),
    });
    if (!response.ok) { onNotice('하위 작업을 수정하지 못했습니다.'); void load(); }
  }

  async function removeSubtask(subtask: Subtask) {
    setDetail((current) => current ? { ...current, subtasks: current.subtasks.filter((item) => item.id !== subtask.id) } : current);
    const response = await fetch(`/api/tasks/${task.id}/subtasks?subtaskId=${subtask.id}`, { method: 'DELETE' });
    if (!response.ok) { onNotice('하위 작업을 삭제하지 못했습니다.'); void load(); }
  }

  async function addComment() {
    const trimmed = commentDraft.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: trimmed }),
      });
      const data = await response.json() as { comment?: TaskComment; error?: string };
      if (!response.ok || !data.comment) throw new Error(data.error || '댓글을 남기지 못했습니다.');
      setDetail((current) => current ? { ...current, comments: [...current.comments, data.comment as TaskComment] } : current);
      setCommentDraft('');
    } catch (error) { onNotice(error instanceof Error ? error.message : '댓글을 남기지 못했습니다.'); }
    finally { setBusy(false); }
  }

  const doneCount = detail?.subtasks.filter((item) => item.done).length ?? 0;

  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="task-detail-dialog">
      <DialogHeader className="task-detail-header">
        <DialogTitle>
          <input
            className="task-detail-title" value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => { const next = titleDraft.trim(); if (next && next !== task.title) void onPatch({ title: next }); }}
            aria-label="업무 이름"
          />
        </DialogTitle>
        <DialogDescription>{project.name} · {task.label}</DialogDescription>
      </DialogHeader>

      <div className="task-detail-body">
        <dl className="task-detail-meta">
          <div><dt><UserRound size={13} /> 담당자</dt><dd>
            <NativeSelect value={task.owner} onChange={(event) => void onPatch({ owner: event.target.value })}>
              {agents.map((agent) => <NativeSelectOption key={agent.id} value={agent.name}>{agent.name} · {agent.role}</NativeSelectOption>)}
            </NativeSelect>
          </dd></div>
          <div><dt><Flag size={13} /> 중요도</dt><dd>
            <NativeSelect value={toPriority(task.priority)} onChange={(event) => void onPatch({ priority: event.target.value })}>
              {PRIORITIES.map((option) => <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>)}
            </NativeSelect>
          </dd></div>
          <div><dt><ShieldCheck size={13} /> 상태</dt><dd>
            <NativeSelect value={task.status} onChange={(event) => void onPatch({ status: event.target.value })}>
              {TASK_STATUSES.map((option) => <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>)}
            </NativeSelect>
          </dd></div>
          <div><dt><BriefcaseBusiness size={13} /> 분류</dt><dd>
            <input className="task-field-input" defaultValue={task.label}
              onBlur={(event) => { const next = event.target.value.trim(); if (next && next !== task.label) void onPatch({ label: next }); }} />
          </dd></div>
        </dl>

        <section className="task-detail-section">
          <header>
            <h3>사용자 지정 필드</h3>
            <button className="task-detail-add" onClick={onManageFields}><Plus size={13} /> 필드 추가</button>
          </header>
          {fields.length
            ? <dl className="task-detail-fields">{fields.map((field) => <div key={field.id}>
                <dt>{field.name}{field.createdBy !== 'user' && <em title={`${field.createdBy} 이(가) 만든 필드`}><Sparkles size={10} /> {field.createdBy}</em>}</dt>
                <dd><FieldInput
                  field={field}
                  value={detail?.values[field.id] ?? values?.[field.id] ?? ''}
                  onChange={(next) => { setFieldValue(field.id, next); void saveDetail({ values: { [field.id]: next } }); }}
                /></dd>
              </div>)}</dl>
            : <p className="detail-empty">아직 필드가 없습니다. 이 프로젝트의 업무가 공통으로 추적할 항목을 만들어 보세요.</p>}
        </section>

        <section className="task-detail-section">
          <header><h3>설명</h3></header>
          <textarea
            className="task-detail-description" value={description} placeholder="이 업무의 배경과 완료 조건을 적어 주세요."
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => { if (description !== (detail?.task.description ?? '')) void saveDetail({ description }); }}
          />
        </section>

        <section className="task-detail-section">
          <header><h3>하위 작업 <em>{doneCount}/{detail?.subtasks.length ?? 0}</em></h3></header>
          <ul className="task-subtasks">
            {detail?.subtasks.map((subtask) => <li key={subtask.id} className={subtask.done ? 'done' : ''}>
              <Checkbox checked={Boolean(subtask.done)} onCheckedChange={(checked) => void toggleSubtask(subtask, Boolean(checked))} />
              <span>{subtask.title}</span>
              {subtask.owner && <b>{subtask.owner}</b>}
              <button onClick={() => void removeSubtask(subtask)} aria-label={`${subtask.title} 삭제`}><Trash2 size={12} /></button>
            </li>)}
          </ul>
          <div className="task-inline-add">
            <input value={subtaskDraft} placeholder="하위 작업 추가" onChange={(event) => setSubtaskDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addSubtask(); } }} />
            <button disabled={!subtaskDraft.trim() || busy} onClick={() => void addSubtask()}><CirclePlus size={14} /></button>
          </div>
        </section>

        {task.result && <section className="task-detail-section">
          <header><h3>{task.owner}의 실행 결과</h3></header>
          <div className="agent-result"><Markdown text={task.result} /></div>
        </section>}

        <section className="task-detail-section">
          <header><h3>댓글</h3></header>
          <ul className="task-comments">
            {detail?.comments.map((comment) => <li key={comment.id}>
              <span className={comment.authorKind === 'agent' ? 'comment-avatar agent' : 'comment-avatar'}>{comment.author.slice(0, 1)}</span>
              <div>
                <b>{comment.author}{comment.authorKind === 'agent' && <em><Bot size={10} /> 에이전트</em>}</b>
                <p>{comment.content}</p>
              </div>
            </li>)}
            {!detail?.comments.length && <li className="detail-empty">아직 댓글이 없습니다.</li>}
          </ul>
          <div className="task-inline-add">
            <input value={commentDraft} placeholder="댓글 추가" onChange={(event) => setCommentDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addComment(); } }} />
            <button disabled={!commentDraft.trim() || busy} onClick={() => void addComment()}><Send size={14} /></button>
          </div>
        </section>
      </div>

      <DialogFooter className="task-detail-footer">
        <button className="task-detail-delete" onClick={() => void onDelete()}><Trash2 size={13} /> 업무 삭제</button>
        <DialogClose render={<Button variant="outline" />}>닫기</DialogClose>
        <Button disabled={running} onClick={onRun}>
          {running ? <LoaderCircle className="spin" size={14} /> : <Play size={14} fill="currentColor" />} {running ? '실행 중' : '에이전트 실행'}
        </Button>
      </DialogFooter>

    </DialogContent>
  </Dialog>;
}

/** 프로젝트 커스텀 필드 정의 관리. 여기서 만든 필드는 모든 업무 상세에 나타납니다. */
function FieldManagerDialog({ open, onOpenChange, projectId, fields, onChanged, onNotice }: {
  open: boolean; onOpenChange: (open: boolean) => void; projectId: string; fields: ProjectField[];
  onChanged: () => Promise<void>; onNotice: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<FieldType>('text');
  const [options, setOptions] = useState('');
  const [showOnCard, setShowOnCard] = useState(false);
  const [saving, setSaving] = useState(false);

  async function createField() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/fields`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), type, showOnCard,
          options: type === 'select' ? options.split(',').map((item) => item.trim()).filter(Boolean) : [],
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || '필드를 만들지 못했습니다.');
      setName(''); setOptions(''); setShowOnCard(false); setType('text');
      await onChanged();
      onNotice('사용자 지정 필드를 추가했습니다.');
    } catch (error) { onNotice(error instanceof Error ? error.message : '필드를 만들지 못했습니다.'); }
    finally { setSaving(false); }
  }

  async function removeField(field: ProjectField) {
    const response = await fetch(`/api/projects/${projectId}/fields?fieldId=${field.id}`, { method: 'DELETE' });
    if (!response.ok) { onNotice('필드를 삭제하지 못했습니다.'); return; }
    await onChanged();
    onNotice(`'${field.name}' 필드를 삭제했습니다.`);
  }

  async function toggleCard(field: ProjectField, next: boolean) {
    const response = await fetch(`/api/projects/${projectId}/fields`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fieldId: field.id, showOnCard: next }),
    });
    if (!response.ok) { onNotice('필드를 수정하지 못했습니다.'); return; }
    await onChanged();
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="create-entity-dialog field-dialog">
      <DialogHeader>
        <DialogTitle>사용자 지정 필드</DialogTitle>
        <DialogDescription>이 프로젝트의 모든 업무가 공유합니다. 에이전트도 실행 중에 필드를 만들 수 있습니다.</DialogDescription>
      </DialogHeader>

      <ul className="field-list">
        {fields.map((field) => <li key={field.id}>
          <div>
            <b>{field.name}</b>
            <small>{FIELD_TYPE_LABELS[field.type]}{field.type === 'select' && field.options.length ? ` · ${field.options.join(' / ')}` : ''}{field.createdBy !== 'user' ? ` · ${field.createdBy} 생성` : ''}</small>
          </div>
          <span className="field-card-toggle" title="보드 카드에 배지로 표시">
            <Switch checked={Boolean(field.showOnCard)} aria-label={`${field.name} 카드 표시`} onCheckedChange={(checked) => void toggleCard(field, Boolean(checked))} />
            <span>카드 표시</span>
          </span>
          <button onClick={() => void removeField(field)} aria-label={`${field.name} 삭제`}><Trash2 size={13} /></button>
        </li>)}
        {!fields.length && <li className="detail-empty">아직 만든 필드가 없습니다.</li>}
      </ul>

      <div className="entity-row">
        <label className="entity-field"><span>필드 이름</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 리스크 등급" /></label>
        <label className="entity-field"><span>유형</span>
          <NativeSelect value={type} onChange={(event) => setType(event.target.value as FieldType)}>
            {FIELD_TYPES.map((option) => <NativeSelectOption key={option} value={option}>{FIELD_TYPE_LABELS[option]}</NativeSelectOption>)}
          </NativeSelect>
        </label>
      </div>
      {type === 'select' && <label className="entity-field"><span>옵션 (쉼표로 구분)</span>
        <input value={options} onChange={(event) => setOptions(event.target.value)} placeholder="높음, 보통, 낮음" />
      </label>}
      <span className="field-card-toggle standalone">
        <Switch checked={showOnCard} aria-label="보드 카드에 배지로 표시" onCheckedChange={(checked) => setShowOnCard(Boolean(checked))} />
        <span>보드 카드에 배지로 표시</span>
      </span>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>닫기</DialogClose>
        <Button disabled={!name.trim() || saving} onClick={() => void createField()}>{saving ? '추가 중' : '필드 추가'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
function AgentsView({ agents, projects, onCreated, onNotice }: { agents: Agent[]; projects: Project[]; onCreated: () => Promise<void>; onNotice: (message: string) => void }) {
  // '에이전트 설정' 다이얼로그 상태. editing 이 있으면 열립니다.
  const [editing, setEditing] = useState<Agent | null>(null);
  const [draft, setDraft] = useState({ model: '', role: '', description: '', instructions: '' });
  const [updating, setUpdating] = useState(false);

  const openSettings = useCallback((agent: Agent) => {
    setEditing(agent);
    setDraft({ model: agent.model ?? '', role: agent.role, description: agent.description, instructions: agent.instructions });
  }, []);

  async function saveAgent() {
    if (!editing || !draft.role.trim() || !draft.instructions.trim()) return;
    setUpdating(true);
    try {
      const response = await fetch('/api/agents', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, model: draft.model, role: draft.role.trim(), description: draft.description.trim(), instructions: draft.instructions.trim() }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || '에이전트를 수정하지 못했습니다.');
      const saved = editing;
      setEditing(null); await onCreated();
      onNotice(`${saved.name} 설정을 저장했습니다.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : '에이전트를 수정하지 못했습니다.'); }
    finally { setUpdating(false); }
  }

  const settingsDialog = <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}>
    <DialogContent className="create-entity-dialog agent-settings-dialog">
      <DialogHeader>
        <DialogTitle>{editing?.name} 설정</DialogTitle>
        <DialogDescription>이 에이전트가 쓸 AI 모델과 역할을 바꿉니다. 이름은 업무 담당자로 참조되고 있어 변경할 수 없습니다.</DialogDescription>
      </DialogHeader>
      <label className="entity-field">
        <span>AI 모델</span>
        <NativeSelect value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}>
          <NativeSelectOption value="">기본 모델 사용 (.env 의 ANTHROPIC_MODEL)</NativeSelectOption>
          {AGENT_MODELS.map((option) => <NativeSelectOption key={option.id} value={option.id}>{option.label} · {option.hint}</NativeSelectOption>)}
        </NativeSelect>
        <small className="entity-hint">업무 실행과 대화 모두 이 모델로 호출합니다. 사용량·비용은 &lsquo;사용량&rsquo; 화면에 모델별로 쌓입니다.</small>
      </label>
      <label className="entity-field"><span>역할</span><input value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))} placeholder="예: 데이터 분석가" /></label>
      <label className="entity-field"><span>역할 설명</span><textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="이 에이전트가 잘해야 하는 일" /></label>
      <label className="entity-field">
        <span>실행 지침</span>
        <textarea className="entity-instructions" value={draft.instructions} onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))} placeholder="이 에이전트가 항상 지켜야 할 작업 방식" />
        <small className="entity-hint">매 실행·대화의 시스템 프롬프트 맨 앞에 그대로 들어갑니다.</small>
      </label>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
        <Button disabled={!draft.role.trim() || !draft.instructions.trim() || updating} onClick={saveAgent}>{updating ? '저장 중' : '설정 저장'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;

  const projectName = (id: string | null | undefined) => projects.find((project) => project.id === id)?.name ?? null;

  return <div className="workspace-view"><ViewHeading eyebrow="Agent Library" title="에이전트" description="프로젝트마다 전담 매니저가 있고, 나머지 팀원은 매니저가 필요할 때 합류시킵니다." />
    {agents.length
      ? <div className="agent-library">{agents.map((agent) => {
          const home = projectName(agent.projectId);
          return <article className={agent.isManager ? 'agent-profile manager' : 'agent-profile'} key={agent.id}>
            <div className="agent-profile-head">
              <span style={{ background: agent.color }}>{agent.name[0]}</span>
              <div><h2>{agent.name}</h2><p>{agent.role}</p></div>
              {Boolean(agent.isManager) && <em><Sparkles size={11} /> 매니저</em>}
            </div>
            <p className="agent-description">{agent.description}</p>
            <div className="agent-model-tag" title={agent.model ? `이 에이전트는 ${agent.model} 로 실행됩니다.` : '.env 의 ANTHROPIC_MODEL 을 그대로 씁니다.'}><Cpu size={12} />{agentModelLabel(agent.model) ?? '기본 모델'}</div>
            <div className="agent-capability"><Check size={13} />{home ? `${home} 소속` : '프로젝트 미지정'}</div>
            <button onClick={() => openSettings(agent)}>에이전트 설정 <ChevronRight size={15} /></button>
          </article>;
        })}</div>
      : <div className="entity-empty"><CirclePlus size={30} /><h2>아직 에이전트가 없어요</h2><p>프로젝트를 만들면 그 프로젝트의 전담 매니저가 함께 생깁니다.</p></div>}
    <div className="agent-template-note"><ShieldCheck size={20} /><div><strong>매니저가 팀을 꾸립니다</strong><p>업무를 지시하면 매니저가 직무 카탈로그(리서처·마케터·엔지니어·데이터 분석가 등)에서 필요한 사람을 합류시키고, 맡기고, 보고를 검토합니다.</p></div></div>
    {settingsDialog}
  </div>;
}

/**
 * 매니저가 대화 중에 팀을 꾸리고 업무를 맡기는 과정을 한 줄씩 쌓아 보여줍니다.
 * 위임 한 건은 하위 에이전트를 실제로 돌리는 것이라 수십 초가 걸려서,
 * 시작(running)과 결과(completed/blocked)를 나눠 표시합니다.
 */
type ManagerStep =
  | { id: string; kind: 'recruited'; agent: string; role: string }
  | { id: string; kind: 'delegate'; agent: string; role: string; title: string; state: 'running' | 'completed' | 'blocked'; summary?: string };

/** 스트리밍 중 표시할 도구별 진행 문구 */
const CHAT_TOOL_LABELS: Record<string, string> = {
  recall_history: '과거 기록을 찾는 중…',
  memory: '기억을 정리하는 중…',
  use_skill: '스킬 문서를 읽는 중…',
  recruit_agent: '필요한 에이전트를 합류시키는 중…',
  delegate_task: '팀원에게 업무를 맡기고 결과를 기다리는 중…',
  create_task: '업무 카드를 만드는 중…',
};

function ChatView({ projects, agents, assignments, onNotice, onRefresh }: { projects: Project[]; agents: Agent[]; assignments: Assignment[]; onNotice: (message: string) => void; onRefresh: () => Promise<void> }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const availableAgents = useMemo(() => agents.filter((agent) => assignments.some((item) => item.projectId === projectId && item.agentId === agent.id)), [agents, assignments, projectId]);
  const [agentId, setAgentId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [toolNote, setToolNote] = useState('');
  const [steps, setSteps] = useState<ManagerStep[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const selectedAgentId = availableAgents.some((agent) => agent.id === agentId) ? agentId : availableAgents[0]?.id || '';
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);

  useEffect(() => { if (!projectId || !selectedAgentId) return; fetch(`/api/chat?projectId=${encodeURIComponent(projectId)}&agentId=${encodeURIComponent(selectedAgentId)}`).then(async (response) => await response.json() as { messages?: ChatMessage[] }).then((data) => setMessages(data.messages || [])).catch(() => setMessages([])); }, [projectId, selectedAgentId]);

  // 사용자가 위로 스크롤해 지난 대화를 보고 있으면 자동 스크롤을 멈춥니다.
  const handleScroll = useCallback(() => {
    const node = listRef.current;
    if (!node) return;
    pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (!pinnedRef.current) return;
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, streamText, sending, steps]);

  useEffect(() => { pinnedRef.current = true; }, [projectId, selectedAgentId]);

  async function sendMessage() {
    const message = draft.trim(); if (!message || !selectedAgentId || sending) return;
    setDraft(''); setSending(true); setStreamText(''); setToolNote(''); setSteps([]); pinnedRef.current = true;
    const optimistic: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content: message, createdAt: Date.now() };
    setMessages((current) => [...current, optimistic]);
    let boardChanged = false;
    try {
      // 연결된 폴더가 있으면 브라우저에서 읽어 함께 보냅니다 (서버는 파일시스템에 접근할 수 없습니다).
      const folderContext = await buildProjectFolderContext(projectId);
      const response = await fetch('/api/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, agentId: selectedAgentId, message, folderContext }) });
      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(failure?.error || '메시지를 보내지 못했습니다.');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamed = '';
      let failure = '';
      const consume = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let event: {
          type?: string; text?: string; error?: string; name?: string; message?: ChatMessage;
          kind?: string; agent?: string; role?: string; title?: string; outcome?: string; summary?: string;
          recruited?: Array<{ name: string; role: string }>; delegated?: Array<{ agent: string; title: string }>; createdTasks?: Array<{ title: string }>;
        };
        try { event = JSON.parse(trimmed) as typeof event; } catch { return; }
        if (event.type === 'user' && event.message) {
          const saved = event.message;
          setMessages((current) => [...current.filter((item) => item.id !== optimistic.id), saved]);
        }
        // 매니저 진행: 합류 → 위임 시작 → 보고 도착 순으로 한 줄씩 쌓입니다.
        if (event.type === 'manager') {
          const agent = event.agent ?? '팀원';
          if (event.kind === 'recruited') {
            setToolNote('');
            setSteps((current) => [...current, { id: `r-${agent}-${current.length}`, kind: 'recruited', agent, role: event.role ?? '' }]);
          }
          if (event.kind === 'delegate_start') {
            setToolNote('');
            setSteps((current) => [...current, {
              id: `d-${agent}-${current.length}`, kind: 'delegate', agent, role: event.role ?? '', title: event.title ?? '', state: 'running',
            }]);
          }
          if (event.kind === 'delegate_done') {
            const state = event.outcome === 'blocked' ? 'blocked' as const : 'completed' as const;
            setSteps((current) => {
              // 같은 담당자의 '진행 중' 항목 중 가장 마지막 것을 결과로 바꿉니다.
              let index = -1;
              for (let i = current.length - 1; i >= 0; i -= 1) {
                const step = current[i];
                if (step.kind === 'delegate' && step.agent === agent && step.state === 'running') { index = i; break; }
              }
              if (index === -1) return current;
              const next = current.slice();
              next[index] = { ...(next[index] as Extract<ManagerStep, { kind: 'delegate' }>), state, summary: event.summary };
              return next;
            });
          }
        }
        if (event.type === 'tool' && event.name) setToolNote(CHAT_TOOL_LABELS[event.name] ?? '도구를 쓰는 중…');
        if (event.type === 'delta' && event.text) {
          streamed += event.text;
          setStreamText(streamed);
          setToolNote('');
        }
        if (event.type === 'done' && event.message) {
          const saved = event.message;
          setMessages((current) => [...current, saved]);
          setStreamText(''); setToolNote('');
          // 매니저가 대화 중에 팀을 꾸리거나 카드를 만들었으면 사이드바·보드를 다시 읽습니다.
          const notes = [
            event.recruited?.length ? `에이전트 ${event.recruited.length}명 합류` : '',
            event.delegated?.length ? `업무 ${event.delegated.length}건 위임·완료` : '',
            event.createdTasks?.length ? `카드 ${event.createdTasks.length}개 생성` : '',
          ].filter(Boolean);
          if (notes.length) { boardChanged = true; onNotice(notes.join(' · ')); }
        }
        if (event.type === 'error') failure = event.error || '답변 생성에 실패했습니다.';
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf('\n');
        while (index !== -1) {
          consume(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
          index = buffer.indexOf('\n');
        }
      }
      if (buffer) consume(buffer);
      if (failure) throw new Error(failure);
      if (boardChanged) await onRefresh();
    }
    catch (error) { onNotice(error instanceof Error ? error.message : '메시지를 보내지 못했습니다.'); }
    finally { setSending(false); setStreamText(''); setToolNote(''); }
  }

  return <div className="workspace-view chat-page"><ViewHeading eyebrow="Agent Chat" title="대화" description="매니저에게 지시하면 대화 중에 팀을 꾸리고 업무를 맡겨 결과까지 가져옵니다." />
    <div className="chat-shell"><aside className="chat-context"><label>프로젝트<NativeSelect value={projectId} onChange={(event) => { setProjectId(event.target.value); setAgentId(''); }}><NativeSelectOption value="">프로젝트 선택</NativeSelectOption>{projects.map((project) => <NativeSelectOption key={project.id} value={project.id}>{project.name}</NativeSelectOption>)}</NativeSelect></label><strong>참여 에이전트</strong>{availableAgents.map((agent) => <button className={selectedAgentId === agent.id ? 'chat-agent active' : 'chat-agent'} key={agent.id} onClick={() => setAgentId(agent.id)}><span style={{ background: agent.color }}>{agent.name[0]}</span><div><b>{agent.name}</b><small>{agent.role}</small></div></button>)}</aside>
      <section className="conversation"><header><span style={{ background: selectedAgent?.color || '#181d26' }}>{selectedAgent?.name[0] || <Bot size={17} />}</span><div><strong>{selectedAgent?.name || '에이전트를 선택하세요'}</strong><small>{selectedAgent?.role || '프로젝트 참여 에이전트'}</small></div><em><i /> 대화 가능</em></header>
        <div className="message-list" ref={listRef} onScroll={handleScroll}>{!messages.length && !streamText && <div className="chat-welcome"><Sparkles size={24} /><h2>{selectedAgent?.name || 'AI 에이전트'}에게 무엇을 맡길까요?</h2><p>{selectedAgent?.isManager
            ? '목표와 원하는 결과물을 알려주면 필요한 에이전트를 합류시켜 맡기고, 결과를 검토해 보고합니다.'
            : '목표, 배경, 원하는 결과물을 알려주면 프로젝트 맥락에 맞춰 답합니다.'}</p></div>}{messages.map((message) => <div className={`message ${message.role}`} key={message.id}><span>{message.role === 'assistant' ? selectedAgent?.name[0] : '나'}</span>{message.role === 'assistant' ? <div className="bubble"><Markdown text={message.content} /></div> : <div className="bubble">{message.content}</div>}</div>)}{Boolean(steps.length) && <div className="manager-trace" aria-live="polite">
          <strong>{sending ? '매니저가 일하는 중' : '이번 답변에서 한 일'}</strong>
          <ol>{steps.map((step) => step.kind === 'recruited'
            ? <li className="done" key={step.id}><UserRound size={12} /><span><b>{step.agent}</b>{step.role ? ` · ${step.role}` : ''} 합류</span></li>
            : <li className={step.state} key={step.id}>
                {step.state === 'running' ? <LoaderCircle className="spin" size={12} /> : step.state === 'blocked' ? <Clock3 size={12} /> : <Check size={12} />}
                <span>
                  {step.state === 'running' ? <><b>{step.agent}</b>에게 맡김 — {step.title}</> : null}
                  {step.state === 'completed' ? <><b>{step.agent}</b> 보고 도착 — {step.summary || step.title}</> : null}
                  {step.state === 'blocked' ? <><b>{step.agent}</b> 진행 불가 — {step.summary || '사유 미기재'}</> : null}
                </span>
              </li>)}</ol>
        </div>}
        {sending && (streamText
          ? <div className="message assistant"><span>{selectedAgent?.name[0]}</span><div className="bubble streaming"><Markdown text={streamText} /><i className="caret" /></div></div>
          : <div className="message assistant"><span>{selectedAgent?.name[0]}</span>{toolNote
              ? <div className="bubble tool-note"><LoaderCircle className="spin" size={13} /> {toolNote}</div>
              : <div className="bubble thinking"><i /><i /><i /></div>}</div>)}<div ref={bottomRef} className="message-anchor" /></div>
        <div className="chat-composer"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={`${selectedAgent?.name || '에이전트'}에게 업무를 지시하세요...`} disabled={!selectedAgentId || sending} /><button onClick={() => void sendMessage()} disabled={!draft.trim() || sending}><Send size={17} /></button><small>Enter 전송 · Shift+Enter 줄바꿈</small></div></section>
    </div>
  </div>;
}

function SettingsView({ onNotice }: { onNotice: (message: string) => void }) {
  const [notifications, setNotifications] = useState(true); const [compact, setCompact] = useState(false); const [autoAssign, setAutoAssign] = useState(true);
  // oxlint-disable-next-line react/react-compiler -- hydrate device-local preferences after mount
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem('orbit-preferences') || '{}') as { notifications?: boolean; compact?: boolean; autoAssign?: boolean }; if (typeof saved.notifications === 'boolean') setNotifications(saved.notifications); if (typeof saved.compact === 'boolean') setCompact(saved.compact); if (typeof saved.autoAssign === 'boolean') setAutoAssign(saved.autoAssign); } catch { /* Keep safe defaults. */ } }, []);
  function saveSettings() { localStorage.setItem('orbit-preferences', JSON.stringify({ notifications, compact, autoAssign })); onNotice('환경 설정이 이 기기에 저장되었습니다.'); }
  return <div className="workspace-view narrow-view"><ViewHeading eyebrow="Preferences" title="환경 설정" description="업무 방식과 알림 기본값을 조정합니다." /><section className="settings-card"><div className="settings-title"><Settings2 size={19} /><div><strong>워크스페이스</strong><p>이 기기의 인터페이스와 자동화 기본값</p></div></div>{[[notifications, setNotifications, '실행 완료 알림', '에이전트가 업무를 마치면 알려줍니다.'], [autoAssign, setAutoAssign, '에이전트 자동 추천', '새 업무에 가장 적합한 역할을 추천합니다.'], [compact, setCompact, '간결한 화면', '카드 간격과 정보를 더 촘촘하게 표시합니다.']].map(([checked, setter, title, description]) => <div className="setting-row" key={title as string}><div><strong>{title as string}</strong><p>{description as string}</p></div><Switch aria-label={title as string} checked={checked as boolean} onCheckedChange={setter as (value: boolean) => void} /></div>)}<Button onClick={saveSettings} className="settings-save">설정 저장</Button></section></div>;
}

function AccountView({ displayName, email }: { displayName: string; email: string }) {
  return <div className="workspace-view narrow-view"><ViewHeading eyebrow="Account" title="계정" description="이 워크스페이스가 어떤 사용자로 동작하는지 확인합니다." /><section className="account-card"><span className="account-avatar"><UserRound size={27} /></span><div><h2>{displayName}</h2><p>{email}</p><em><ShieldCheck size={13} /> 로컬 전용 모드 · 외부 인증 없음</em></div></section><p className="account-note">표시 이름과 이메일은 <code>LOCAL_USER_NAME</code>, <code>LOCAL_USER_EMAIL</code> 환경변수로 바꿀 수 있습니다. 여러 사용자를 지원하려면 <code>app/auth.ts</code>의 <code>getCurrentUser()</code>에 실제 인증을 연결하세요.</p></div>;
}
