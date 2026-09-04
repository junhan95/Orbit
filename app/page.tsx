'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowUpRight, Bot, ChartColumn, Check, ChevronRight, Clock3, Command, Gauge, LayoutDashboard, ListChecks, LoaderCircle, MessageSquareText, Play, Plus, Search, Settings, Sparkles, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { UsageView } from '@/components/usage-view';
import { WorkspaceView, type WorkspaceSection } from '@/components/workspace-views';
import { TASK_STATUSES, type TaskStatus, formatDue, isOverdue, toDueTimestamp } from '@/lib/due';

type Task = {
  id: string; title: string; label: string; owner: string; status: TaskStatus;
  due: number | null; accent: string; result?: string | null; projectId?: string | null;
};
type StatsAgent = { id: string; name: string; role: string; color: string; runningCount: number; activeTasks: number; lastRunAt: number | null };
type Stats = {
  tasks: { total: number; waiting: number; doing: number; review: number; completionRate: number };
  runs: { total: number; completed: number; failed: number; running: number; lastHour: number; avgSeconds: number | null; histogram: number[] };
  focus: { id: string; name: string; description: string; color: string; taskCount: number; reviewCount: number; progress: number; nextDue: number | null } | null;
  agents: StatsAgent[];
};

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
  const [query, setQuery] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [newDue, setNewDue] = useState('');
  const [notice, setNotice] = useState('');
  const [displayName, setDisplayName] = useState('사용자');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<Task | null>(null);
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
  const histogramMax = Math.max(1, ...(stats?.runs.histogram ?? [0]));

  const visibleTasks = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (ownerFilter !== '전체' && task.owner !== ownerFilter) return false;
      if (!keyword) return true;
      return `${task.title} ${task.owner} ${task.label}`.toLowerCase().includes(keyword);
    });
  }, [ownerFilter, query, tasks]);

  async function createTask() {
    const title = newTitle.trim();
    if (!title) return;
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, owner: newOwner || undefined, due: newDue ? toDueTimestamp(newDue) : null }),
      });
      const data = await response.json() as { task?: Task; error?: string };
      if (!response.ok || !data.task) throw new Error(data.error || '업무를 만들지 못했습니다.');
      setTasks((current) => [...current, data.task as Task]);
      setNewTitle(''); setNewDue('');
      flash(`새 업무가 ${data.task.owner}에게 배정되었습니다.`);
      void refreshStats();
    } catch (error) { flash(error instanceof Error ? error.message : '업무를 만들지 못했습니다.'); }
  }

  async function runAgent(task: Task) {
    setRunningId(task.id);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: '진행 중' } : item));
    try {
      const response = await fetch('/api/agents/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id }),
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

  async function changeStatus(task: Task, status: TaskStatus) {
    if (status === task.status) return;
    setPendingId(task.id);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status } : item));
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      const data = await response.json() as { task?: Task; error?: string };
      if (!response.ok || !data.task) throw new Error(data.error || '상태를 바꾸지 못했습니다.');
      setTasks((current) => current.map((item) => item.id === task.id ? data.task as Task : item));
      void refreshStats();
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === task.id ? task : item));
      flash(error instanceof Error ? error.message : '상태를 바꾸지 못했습니다.');
    } finally { setPendingId(null); }
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
            <button className={activeNav === label ? 'nav-button active' : 'nav-button'} key={label} onClick={() => setActiveNav(label)} aria-label={label} title={label}>
              <Icon size={20} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <button className={activeNav === '설정' ? 'nav-button active' : 'nav-button'} onClick={() => setActiveNav('설정')} aria-label="설정" title="설정"><Settings size={20} /><span>설정</span></button>
        <button className={activeNav === '계정' ? 'user-avatar active' : 'user-avatar'} onClick={() => setActiveNav('계정')} aria-label="계정" title="계정">{displayName.slice(0, 2).toUpperCase()}</button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="project-switcher">
            <span className="project-logo">O</span>
            <div>
              <span className="eyebrow">워크스페이스</span>
              <button onClick={() => setActiveNav('프로젝트')} title="프로젝트 목록으로 이동">{stats?.focus?.name ?? 'Orbit 워크스페이스'} <ChevronRight size={14} /></button>
            </div>
          </div>
          <label className="search-box">
            <Search size={17} />
            <input ref={searchRef} aria-label="업무 검색" placeholder="업무, 에이전트, 분류 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
            <kbd>⌘ K</kbd>
          </label>
          <div className="top-actions">
            <Dialog>
              <DialogTrigger render={<Button className="create-button" />}><Plus size={16} /> 업무 만들기</DialogTrigger>
              <DialogContent className="task-dialog">
                <DialogHeader><DialogTitle>새 업무 만들기</DialogTitle><DialogDescription>담당 에이전트와 마감일을 지정하면 바로 보드에 올라갑니다.</DialogDescription></DialogHeader>
                <label className="dialog-field"><span>업무 이름</span><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="예: 결제 플로우 엣지 케이스 정리" /></label>
                <div className="dialog-row">
                  <label className="dialog-field"><span>담당 에이전트</span>
                    <select value={newOwner} onChange={(event) => setNewOwner(event.target.value)}>
                      <option value="">자동 배정</option>
                      {agents.map((agent) => <option key={agent.id} value={agent.name}>{agent.name} · {agent.role}</option>)}
                    </select>
                  </label>
                  <label className="dialog-field"><span>마감일</span><input type="date" value={newDue} onChange={(event) => setNewDue(event.target.value)} /></label>
                </div>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
                  <DialogClose render={<Button onClick={createTask} disabled={!newTitle.trim()} />}>업무 배정</DialogClose>
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
              <p>{loading ? '워크스페이스를 불러오는 중이에요.' : `${agents.length}명의 에이전트가 ${stats?.tasks.total ?? tasks.length}개 업무에서 협업하고 있어요.`}</p>
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
              <div className="focus-topline"><span><Zap size={14} fill="currentColor" /> 지금 집중할 프로젝트</span></div>
              {stats?.focus ? <>
                <h2>{stats.focus.name}</h2>
                <p>{stats.focus.description || '프로젝트 설명이 아직 없습니다.'}</p>
                <div className="progress-row"><span>검토 단계 도달률</span><strong>{stats.focus.progress}%</strong></div>
                <div className="progress-track"><span style={{ width: `${stats.focus.progress}%` }} /></div>
                <div className="focus-footer">
                  <div className="mini-team">{agents.slice(0, 3).map((agent) => <span key={agent.id}>{agent.name[0]}</span>)}</div>
                  <span><Clock3 size={14} /> {stats.focus.nextDue ? `가장 이른 마감 ${formatDue(stats.focus.nextDue)}` : '마감 지정 없음'}</span>
                  <button onClick={() => setActiveNav('프로젝트')}>프로젝트 열기 <ArrowUpRight size={14} /></button>
                </div>
              </> : <>
                <h2>아직 프로젝트가 없어요</h2>
                <p>프로젝트를 만들면 진행 상황이 여기에 요약됩니다.</p>
                <div className="focus-footer"><button onClick={() => setActiveNav('프로젝트')}>프로젝트 만들기 <ArrowUpRight size={14} /></button></div>
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
              <div><strong>{stats?.tasks.total ?? tasks.length}</strong><span>전체 업무</span></div>
              <em>대기 {stats?.tasks.waiting ?? 0} · 진행 {stats?.tasks.doing ?? 0}</em>
            </article>
            <article className="stat-card">
              <span className="icon-tile mint"><Check size={18} /></span>
              <div><strong>{stats?.tasks.completionRate ?? 0}%</strong><span>검토 도달률</span></div>
              <em>검토 {stats?.tasks.review ?? 0} / {stats?.tasks.total ?? 0}</em>
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
                <div><span className="section-kicker">업무 흐름</span><h2>에이전트 보드</h2></div>
                <span className="board-count">{visibleTasks.length}건 표시 중</span>
              </div>
              <div className="kanban-board">
                {TASK_STATUSES.map((column) => {
                  const columnTasks = visibleTasks.filter((task) => task.status === column);
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
                          <span className={isOverdue(task.due, task.status) ? 'task-due overdue' : 'task-due'}><Clock3 size={13} /> {formatDue(task.due)}</span>
                        </div>
                        <div className="task-actions">
                          <select className="task-status" aria-label={`${task.title} 상태`} value={task.status} disabled={pendingId === task.id} onChange={(event) => changeStatus(task, event.target.value as TaskStatus)}>
                            {TASK_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                          </select>
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
              </div>
            </div>

            <aside className="agent-panel">
              <div className="section-header">
                <div><span className="section-kicker">팀</span><h2>에이전트</h2></div>
                <button className="icon-button small" aria-label="에이전트 추가" title="에이전트 추가" onClick={() => setActiveNav('에이전트')}><Plus size={16} /></button>
              </div>
              <div className="agent-orbit" aria-hidden="true"><span /><span /><i /></div>
              <div className="agent-list">
                {agents.map((agent) => <button className="agent-row" key={agent.id} onClick={() => setActiveNav('에이전트')}>
                  <span className="agent-avatar" style={{ background: agent.color }}>{agent.name[0]}<i className={agent.runningCount > 0 || agent.activeTasks > 0 ? '' : 'idle'} /></span>
                  <span className="agent-copy"><strong>{agent.name}<em>{agent.role}</em></strong><small>{agentActivity(agent)}</small></span>
                  <ChevronRight size={17} />
                </button>)}
                {!loading && !agents.length && <div className="empty-column">아직 에이전트가 없어요.</div>}
              </div>
              <button className="agent-cta" onClick={() => setActiveNav('대화')}><Sparkles size={16} /> 에이전트와 대화하기</button>
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
          <div className="agent-result">{selectedResult?.result}</div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </main>
  );
}
