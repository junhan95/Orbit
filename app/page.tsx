'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowUpRight, Bot, ChartColumn, Check, ChevronRight, Command, Flag, Gauge, LayoutDashboard, ListChecks, LoaderCircle, MessageSquareText, Play, Plus, Search, Settings, Sparkles, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Markdown } from '@/components/markdown';
import { UsageView } from '@/components/usage-view';
import { WorkspaceView, type WorkspaceSection } from '@/components/workspace-views';
import { PRIORITIES, type Priority, byPriority, toPriority } from '@/lib/priority';
import { TASK_STATUSES, type TaskStatus } from '@/lib/task-status';
import { agentState } from '@/lib/agent-state';
import { buildProjectFolderContext } from '@/lib/folder-access';

type Task = {
  id: string; title: string; label: string; owner: string; status: TaskStatus;
  priority: string; accent: string; result?: string | null; projectId?: string | null;
};
type StatsAgent = { id: string; name: string; role: string; color: string; runningCount: number; activeTasks: number; lastRunAt: number | null };
type StatsProject = {
  id: string; name: string; description: string; color: string; status: string;
  taskCount: number; waitingCount: number; doingCount: number; reviewCount: number; progress: number; highCount: number;
};
type Stats = {
  tasks: { total: number; waiting: number; doing: number; review: number; completionRate: number };
  runs: { total: number; completed: number; failed: number; running: number; lastHour: number; avgSeconds: number | null; histogram: number[] };
  projects: StatsProject[];
  focus: StatsProject | null;
  agents: StatsAgent[];
};

/** 중요도 배지 색. 높음만 눈에 띄게 하고 나머지는 조용하게 둡니다. */
const PRIORITY_CLASS: Record<Priority, string> = { 높음: 'high', 중간: 'mid', 낮음: 'low' };

/** 프로젝트 선택기의 '전체' 값. 개별 프로젝트는 id 를 그대로 씁니다. */
const ALL_PROJECTS = 'all';

const NAV_ITEMS = [['대쉬보드', LayoutDashboard], ['프로젝트', ListChecks], ['에이전트', Bot], ['대화', MessageSquareText], ['사용량', ChartColumn]] as const;

type NavSection = '대쉬보드' | '사용량' | WorkspaceSection;

function greeting(hour: number) {
  if (hour < 5) return '늦은 밤이네요';
  if (hour < 12) return '좋은 아침이에요';
  if (hour < 18) return '좋은 오후예요';
  return '좋은 저녁이에요';
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}분 ${rest}초` : `${minutes}분`;
}

function formatRelative(timestamp: number) {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}

function agentActivity(agent: StatsAgent) {
  if (agent.runningCount > 0) return '지금 실행 중';
  if (agent.activeTasks > 0) return `진행 중 업무 ${agent.activeTasks}건`;
  if (agent.lastRunAt) return `${formatRelative(agent.lastRunAt)} 실행`;
  return '대기 중';
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeNav, setActiveNav] = useState<NavSection>('대쉬보드');
  const [ownerFilter, setOwnerFilter] = useState('전체');
  const [projectFilter, setProjectFilter] = useState('');
  const [query, setQuery] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newProject, setNewProject] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('중간');
  const [notice, setNotice] = useState('');
  const [displayName, setDisplayName] = useState('사용자');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [clock, setClock] = useState({ today: '', hello: '안녕하세요' });
  const searchRef = useRef<HTMLInputElement>(null);

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const response = await fetch('/api/stats');
      if (!response.ok) return;
      setStats(await response.json() as Stats);
    } catch { /* 통계는 보조 정보라 실패해도 화면을 막지 않습니다. */ }
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const response = await fetch('/api/tasks');
      if (!response.ok) return;
      const data = await response.json() as { tasks: Task[] };
      setTasks(data.tasks);
    } catch { /* 목록 새로고침 실패는 조용히 넘기고 기존 화면을 유지합니다. */ }
  }, []);

  useEffect(() => {
    const now = new Date();
    // oxlint-disable-next-line react/react-compiler -- 서버(UTC)와 브라우저 타임존이 달라 생기는 hydration 불일치를 피하려고 마운트 후에 계산합니다
    setClock({
      today: new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(now),
      hello: greeting(now.getHours()),
    });
  }, []);

  useEffect(() => {
    Promise.all([fetch('/api/tasks'), fetch('/api/me'), fetch('/api/stats')])
      .then(async ([taskResponse, meResponse, statsResponse]) => {
        if (!taskResponse.ok) throw new Error('업무를 불러오지 못했습니다.');
        const taskData = await taskResponse.json() as { tasks: Task[] };
        setTasks(taskData.tasks);
        if (meResponse.ok) {
          const me = await meResponse.json() as { displayName: string; email: string };
          if (me.displayName) setDisplayName(me.displayName.split('@')[0]);
          if (me.email) setEmail(me.email);
        }
        if (statsResponse.ok) setStats(await statsResponse.json() as Stats);
      })
      .catch((error) => flash(error instanceof Error ? error.message : '데이터를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [flash]);

  /** 화면 이동. 대쉬보드로 돌아올 때는 다른 화면에서 만든 프로젝트·업무가 바로 보이도록 다시 읽습니다. */
  const goTo = useCallback((section: NavSection) => {
    setActiveNav(section);
    if (section === '대쉬보드') { void refreshStats(); void refreshTasks(); }
  }, [refreshStats, refreshTasks]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setActiveNav('대쉬보드');
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const agents = stats?.agents ?? [];
  const projects = useMemo(() => stats?.projects ?? [], [stats]);
  const histogramMax = Math.max(1, ...(stats?.runs.histogram ?? [0]));

  // 고른 프로젝트가 없거나(첫 렌더) 삭제되어 사라졌으면 '지금 집중할 프로젝트'(= 가장 최근 프로젝트)로 봅니다.
  const activeProjectId = useMemo(() => {
    if (projectFilter === ALL_PROJECTS) return ALL_PROJECTS;
    if (projectFilter && projects.some((project) => project.id === projectFilter)) return projectFilter;
    return projects[0]?.id ?? ALL_PROJECTS;
  }, [projectFilter, projects]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  // 대쉬보드는 프로젝트에 속한 업무만 다룹니다. 프로젝트를 고르면 그 프로젝트의 업무로 좁힙니다.
  const projectTasks = useMemo(
    () => tasks.filter((task) => Boolean(task.projectId) && (activeProjectId === ALL_PROJECTS || task.projectId === activeProjectId)),
    [activeProjectId, tasks],
  );

  const visibleTasks = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return projectTasks.filter((task) => {
      if (ownerFilter !== '전체' && task.owner !== ownerFilter) return false;
      if (!keyword) return true;
      return `${task.title} ${task.owner} ${task.label}`.toLowerCase().includes(keyword);
    });
  }, [ownerFilter, projectTasks, query]);

  // 통계 카드도 선택한 범위를 따릅니다. (실행 기록은 워크스페이스 전체 기준)
  const scoped = useMemo(() => {
    const waiting = projectTasks.filter((task) => task.status === '대기').length;
    const doing = projectTasks.filter((task) => task.status === '진행 중').length;
    const review = projectTasks.filter((task) => task.status === '검토').length;
    const total = projectTasks.length;
    return { total, waiting, doing, review, completionRate: total ? Math.round((review / total) * 100) : 0 };
  }, [projectTasks]);

  const scopeLabel = selectedProject ? selectedProject.name : '전체 프로젝트';
  // 아직 끝나지 않은 '높음' 중요도 업무 — 지금 먼저 봐야 할 일입니다.
  const highCount = useMemo(
    () => projectTasks.filter((task) => task.status !== '검토' && toPriority(task.priority) === '높음').length,
    [projectTasks],
  );

  async function createTask() {
    const title = newTitle.trim();
    if (!title) return;
    // 업무는 프로젝트 안에서만 삽니다. 다이얼로그에서 고른 프로젝트 → 현재 보고 있는 프로젝트 → 첫 프로젝트 순으로 정합니다.
    const targetProjectId = newProject || (activeProjectId !== ALL_PROJECTS ? activeProjectId : projects[0]?.id);
    if (!targetProjectId) {
      flash('먼저 프로젝트를 만들어 주세요.');
      return;
    }
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 담당은 보내지 않습니다 — 서버가 그 프로젝트의 매니저에게 배정합니다.
        body: JSON.stringify({ title, projectId: targetProjectId, priority: newPriority }),
      });
      const data = await response.json() as { task?: Task; error?: string };
      if (!response.ok || !data.task) throw new Error(data.error || '업무를 만들지 못했습니다.');
      setTasks((current) => [...current, data.task as Task]);
      setNewTitle(''); setNewPriority('중간');
      // 다른 프로젝트에 만들었으면 그 프로젝트로 화면을 옮겨 새 업무가 바로 보이게 합니다.
      if (activeProjectId !== ALL_PROJECTS && targetProjectId !== activeProjectId) setProjectFilter(targetProjectId);
      flash(`새 업무가 ${data.task.owner}에게 배정되었습니다.`);
      void refreshStats();
    } catch (error) { flash(error instanceof Error ? error.message : '업무를 만들지 못했습니다.'); }
  }

  async function runAgent(task: Task) {
    setRunningId(task.id);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: '진행 중' } : item));
    try {
      // 업무가 속한 프로젝트에 폴더가 연결돼 있으면 브라우저에서 읽어 함께 보냅니다.
      const folderContext = await buildProjectFolderContext(task.projectId);
      const response = await fetch('/api/agents/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id, folderContext }),
      });
      const data = await response.json() as { output?: string; error?: string };
      if (!response.ok || !data.output) throw new Error(data.error || '에이전트 실행에 실패했습니다.');
      const completed: Task = { ...task, status: '검토', result: data.output };
      setTasks((current) => current.map((item) => item.id === task.id ? completed : item));
      setSelectedResult(completed);
      flash(`${task.owner}가 업무를 완료했습니다.`);
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: task.status } : item));
      flash(error instanceof Error ? error.message : '에이전트 실행에 실패했습니다.');
    } finally {
      setRunningId(null);
      void refreshStats();
    }
  }

  async function deleteTask(task: Task) {
    const snapshot = tasks;
    setTasks((current) => current.filter((item) => item.id !== task.id));
    try {
      const response = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || '업무를 삭제하지 못했습니다.');
      }
      flash('업무를 삭제했습니다.');
      void refreshStats();
    } catch (error) {
      setTasks(snapshot);
      flash(error instanceof Error ? error.message : '업무를 삭제하지 못했습니다.');
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark" aria-label="Orbit 홈"><Command size={20} strokeWidth={2.5} /></div>
        <nav className="primary-nav" aria-label="주 메뉴">
          {NAV_ITEMS.map(([label, Icon]) => (
            <button className={activeNav === label ? 'nav-button active' : 'nav-button'} key={label} onClick={() => goTo(label)} aria-label={label} title={label}>
              <Icon size={20} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <button className={activeNav === '설정' ? 'nav-button active' : 'nav-button'} onClick={() => goTo('설정')} aria-label="설정" title="설정"><Settings size={20} /><span>설정</span></button>
        <button className={activeNav === '계정' ? 'user-avatar active' : 'user-avatar'} onClick={() => goTo('계정')} aria-label="계정" title="계정">{displayName.slice(0, 2).toUpperCase()}</button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="project-switcher">
            <span className="project-logo">O</span>
            <div>
              <span className="eyebrow">워크스페이스</span>
              <button onClick={() => goTo('프로젝트')} title="프로젝트 목록으로 이동">{stats?.focus?.name ?? 'Orbit 워크스페이스'} <ChevronRight size={14} /></button>
            </div>
          </div>
          <label className="search-box">
            <Search size={17} />
            <input ref={searchRef} aria-label="업무 검색" placeholder="업무, 에이전트, 분류 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
            <kbd>⌘ K</kbd>
          </label>
          <div className="top-actions">
            <Dialog open={createOpen} onOpenChange={(open) => {
              if (open) setNewProject(activeProjectId !== ALL_PROJECTS ? activeProjectId : projects[0]?.id ?? '');
              setCreateOpen(open);
            }}>
              <DialogTrigger render={<Button className="create-button" />}><Plus size={16} /> 업무 만들기</DialogTrigger>
              <DialogContent className="task-dialog">
                <DialogHeader><DialogTitle>새 업무 만들기</DialogTitle><DialogDescription>업무는 프로젝트의 매니저에게 배정됩니다. 중요도가 높을수록 보드 위쪽에 놓이고 에이전트도 먼저 처리합니다.</DialogDescription></DialogHeader>
                {projects.length
                  ? <>
                      <label className="dialog-field"><span>업무 이름</span><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="예: 결제 플로우 엣지 케이스 정리" /></label>
                      <label className="dialog-field"><span>프로젝트</span>
                        <select value={newProject} onChange={(event) => setNewProject(event.target.value)}>
                          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                        </select>
                      </label>
                      <label className="dialog-field"><span>중요도</span>
                        <select value={newPriority} onChange={(event) => setNewPriority(event.target.value as Priority)}>
                          {PRIORITIES.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                    </>
                  : <p className="dialog-hint">아직 프로젝트가 없어요. 프로젝트를 먼저 만들면 그 안에 업무를 배정할 수 있습니다.</p>}
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
                  {projects.length
                    ? <DialogClose render={<Button onClick={createTask} disabled={!newTitle.trim()} />}>업무 배정</DialogClose>
                    : <DialogClose render={<Button onClick={() => goTo('프로젝트')} />}>프로젝트 만들러 가기</DialogClose>}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        <div className="page-content">
          {activeNav === '대쉬보드' ? <>
          <div className="page-heading">
            <div>
              <p className="eyebrow">{clock.today}</p>
              <h1>{clock.hello}, {displayName}님.</h1>
              <p>{loading
                ? '워크스페이스를 불러오는 중이에요.'
                : projects.length
                  ? `${scopeLabel} · ${agents.length}명의 에이전트가 ${scoped.total}개 업무에서 협업하고 있어요.`
                  : '아직 프로젝트가 없어요. 프로젝트를 만들면 여기에 진행 상황이 모입니다.'}</p>
            </div>
            <fieldset className="view-switch" aria-label="담당 에이전트 필터">
              <button className={ownerFilter === '전체' ? 'selected' : ''} onClick={() => setOwnerFilter('전체')}>전체</button>
              {agents.map((agent) => (
                <button className={ownerFilter === agent.name ? 'selected' : ''} key={agent.id} onClick={() => setOwnerFilter(agent.name)}>{agent.name}</button>
              ))}
            </fieldset>
          </div>

          <section className="overview-grid" aria-label="오늘의 현황">
            <article className="focus-card">
              <div className="focus-topline">
                <span><Zap size={14} fill="currentColor" /> 지금 집중할 프로젝트</span>
                {projects.length > 0 && (
                  <select className="focus-project-select" aria-label="프로젝트 선택" value={activeProjectId} onChange={(event) => setProjectFilter(event.target.value)}>
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                    <option value={ALL_PROJECTS}>전체 프로젝트</option>
                  </select>
                )}
              </div>
              {projects.length ? <>
                <h2>{scopeLabel}</h2>
                <p>{selectedProject
                  ? selectedProject.description || '프로젝트 설명이 아직 없습니다.'
                  : `${projects.length}개 프로젝트의 진행 상황을 합쳐서 보고 있어요.`}</p>
                <div className="progress-row"><span>검토 단계 도달률</span><strong>{scoped.completionRate}%</strong></div>
                <div className="progress-track"><span style={{ width: `${scoped.completionRate}%` }} /></div>
                <div className="focus-footer">
                  <div className="mini-team">{agents.slice(0, 3).map((agent) => <span key={agent.id}>{agent.name[0]}</span>)}</div>
                  <span><Flag size={14} /> {highCount ? `먼저 볼 업무 ${highCount}건 (중요도 높음)` : '중요도 높음 업무 없음'}</span>
                  <button onClick={() => goTo('프로젝트')}>프로젝트 열기 <ArrowUpRight size={14} /></button>
                </div>
              </> : <>
                <h2>아직 프로젝트가 없어요</h2>
                <p>프로젝트를 만들면 진행 상황이 여기에 요약됩니다.</p>
                <div className="focus-footer"><button onClick={() => goTo('프로젝트')}>프로젝트 만들기 <ArrowUpRight size={14} /></button></div>
              </>}
            </article>

            <article className="pulse-card">
              <div className="card-title">
                <span className="icon-tile violet"><Activity size={18} /></span>
                <div><p>에이전트 활동</p><strong>{stats?.runs.running ? `${stats.runs.running}건 실행 중` : '실행 중인 작업 없음'}</strong></div>
                {Boolean(stats?.runs.running) && <span className="live-pill"><i /> LIVE</span>}
              </div>
              <div className="pulse-chart" aria-label="최근 60분 에이전트 실행 횟수">
                {(stats?.runs.histogram ?? Array.from({ length: 12 }, () => 0)).map((count, index) => (
                  <i key={index} style={{ height: `${Math.max(6, (count / histogramMax) * 100)}%`, opacity: count ? 1 : 0.35 }} />
                ))}
              </div>
              <div className="pulse-footer"><span>지난 60분</span><strong>{stats?.runs.lastHour ?? 0}회 실행</strong></div>
            </article>

            <article className="stat-card">
              <span className="icon-tile orange"><ListChecks size={18} /></span>
              <div><strong>{scoped.total}</strong><span>{selectedProject ? '이 프로젝트 업무' : '전체 업무'}</span></div>
              <em>대기 {scoped.waiting} · 진행 {scoped.doing}</em>
            </article>
            <article className="stat-card">
              <span className="icon-tile mint"><Check size={18} /></span>
              <div><strong>{scoped.completionRate}%</strong><span>검토 도달률</span></div>
              <em>검토 {scoped.review} / {scoped.total}</em>
            </article>
            <article className="stat-card">
              <span className="icon-tile blue"><Gauge size={18} /></span>
              <div><strong>{formatDuration(stats?.runs.avgSeconds ?? null)}</strong><span>평균 실행 시간</span></div>
              <em>{stats?.runs.completed ?? 0}회 완료{stats?.runs.failed ? ` · ${stats.runs.failed}회 실패` : ''}</em>
            </article>
          </section>

          <section className="main-grid">
            <div className="board-panel">
              <div className="section-header">
                <div><span className="section-kicker">에이전트 상태</span><h2>에이전트 보드</h2><p className="section-note">{scopeLabel}의 업무와 에이전트 실행 상태가 자동으로 반영됩니다.</p></div>
                <span className="board-count">{projectTasks.length ? `${visibleTasks.length}건 표시 중` : '표시할 업무 없음'}</span>
              </div>
              {!loading && !projects.length
                ? <div className="board-empty">
                    <ListChecks size={26} />
                    <strong>아직 프로젝트가 없어요</strong>
                    <p>보드는 프로젝트의 진행 상황을 그대로 보여줍니다. 프로젝트를 만들면 그 안의 업무가 대기 → 진행 중 → 검토 순서로 여기에 표시됩니다.</p>
                    <Button className="board-empty-cta" onClick={() => goTo('프로젝트')}><Plus size={16} /> 프로젝트 만들기</Button>
                  </div>
                : !loading && !projectTasks.length
                ? <div className="board-empty">
                    <ListChecks size={26} />
                    <strong>{selectedProject ? `'${selectedProject.name}'에 아직 업무가 없어요` : '아직 등록된 업무가 없어요'}</strong>
                    <p>에이전트에게 맡길 업무를 만들면 이 보드에 대기 → 진행 중 → 검토 순서로 표시됩니다.</p>
                    <Button className="board-empty-cta" onClick={() => setCreateOpen(true)}><Plus size={16} /> 첫 업무 만들기</Button>
                  </div>
                : <div className="kanban-board">
                {TASK_STATUSES.map((column) => {
                  const columnTasks = byPriority(visibleTasks.filter((task) => task.status === column));
                  return <div className="kanban-column" key={column}>
                    <div className="column-heading"><span className={`status-dot ${column === '진행 중' ? 'doing' : column === '검토' ? 'review' : ''}`} /><strong>{column}</strong><span>{columnTasks.length}</span></div>
                    <div className="task-stack">
                      {columnTasks.map((task) => <article className="task-card" key={task.id}>
                        <div className="task-card-head">
                          <span className="task-label" style={{ color: task.accent, backgroundColor: `${task.accent}14` }}>{task.label}</span>
                          <button className="task-remove" onClick={() => deleteTask(task)} aria-label={`${task.title} 삭제`} title="업무 삭제"><Trash2 size={13} /></button>
                        </div>
                        <strong>{task.title}</strong>
                        <div className="task-meta">
                          <span className="mini-avatar" style={{ background: task.accent }}>{task.owner[0]}</span>
                          <span>{task.owner}</span>
                          <span className={`priority-badge ${PRIORITY_CLASS[toPriority(task.priority)]}`} title={`중요도 ${toPriority(task.priority)}`}><Flag size={11} /> {toPriority(task.priority)}</span>
                        </div>
                        <div className="task-actions">
                          {(() => {
                            const state = agentState(task, runningId === task.id);
                            return <span className={`agent-state ${state.key}`} title={state.hint} aria-label={`${task.owner} 상태: ${state.label}`}>
                              {state.key === 'running' ? <LoaderCircle className="spin" size={12} /> : <i className="agent-state-dot" />}
                              {state.label}
                            </span>;
                          })()}
                          {task.result
                            ? <button className="run-task result" onClick={() => setSelectedResult(task)}><Check size={13} /> 결과</button>
                            : <button className="run-task" disabled={runningId === task.id} onClick={() => runAgent(task)}>
                                {runningId === task.id ? <LoaderCircle className="spin" size={13} /> : <Play size={13} fill="currentColor" />} {runningId === task.id ? '실행 중' : '실행'}
                              </button>}
                        </div>
                      </article>)}
                      {!loading && columnTasks.length === 0 && <div className="empty-column">{query.trim() || ownerFilter !== '전체' ? '조건에 맞는 업무가 없어요.' : '이 단계의 업무가 없어요.'}</div>}
                    </div>
                  </div>;
                })}
              </div>}
            </div>

            <aside className="agent-panel">
              <div className="section-header">
                <div><span className="section-kicker">팀</span><h2>에이전트</h2></div>
                <button className="icon-button small" aria-label="에이전트 추가" title="에이전트 추가" onClick={() => goTo('에이전트')}><Plus size={16} /></button>
              </div>
              <div className="agent-orbit" aria-hidden="true"><span /><span /><i /></div>
              <div className="agent-list">
                {agents.map((agent) => <button className="agent-row" key={agent.id} onClick={() => goTo('에이전트')}>
                  <span className="agent-avatar" style={{ background: agent.color }}>{agent.name[0]}<i className={agent.runningCount > 0 || agent.activeTasks > 0 ? '' : 'idle'} /></span>
                  <span className="agent-copy"><strong>{agent.name}<em>{agent.role}</em></strong><small>{agentActivity(agent)}</small></span>
                  <ChevronRight size={17} />
                </button>)}
                {!loading && !agents.length && <div className="empty-column">아직 에이전트가 없어요.</div>}
              </div>
              <button className="agent-cta" onClick={() => goTo('대화')}><Sparkles size={16} /> 에이전트와 대화하기</button>
            </aside>
          </section>
          </> : activeNav === '사용량'
            ? <UsageView onNotice={flash} />
            : <WorkspaceView section={activeNav} displayName={displayName} email={email} onNotice={flash} />}
        </div>
      </section>

      {notice && <output className="toast"><Check size={16} /> {notice}</output>}

      <Dialog open={Boolean(selectedResult)} onOpenChange={(open) => !open && setSelectedResult(null)}>
        <DialogContent className="result-dialog">
          <DialogHeader><DialogTitle>{selectedResult?.owner}의 실행 결과</DialogTitle><DialogDescription>{selectedResult?.title}</DialogDescription></DialogHeader>
          <div className="agent-result"><Markdown text={selectedResult?.result || ''} /></div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </main>
  );
}
