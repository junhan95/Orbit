'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, Bell, Bot, Check, ChevronDown, Clock3, Command, Gauge, LayoutDashboard, ListChecks, LoaderCircle, LogOut, MessageSquareText, MoreHorizontal, Play, Plus, Search, Settings, Sparkles, WandSparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

type Status = '대기' | '진행 중' | '검토';
type Task = { id: string; title: string; label: string; owner: string; avatar?: string; status: Status; due: string; accent: string; result?: string | null };

const agents = [
  { name: 'Mira', role: '리서치', status: '리서치 정리 중', color: '#7559ff', avatar: 'M' },
  { name: 'Nori', role: '프로덕트', status: '플로우 설계 중', color: '#ff7557', avatar: 'N' },
  { name: 'Bolt', role: '엔지니어링', status: '구현 진행 중', color: '#16a98c', avatar: 'B' },
  { name: 'Lint', role: '품질 검토', status: '대기 중', color: '#3478f6', avatar: 'L' },
];

const columns: Status[] = ['대기', '진행 중', '검토'];

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeNav, setActiveNav] = useState('개요');
  const [filter, setFilter] = useState<'전체' | '내 업무'>('전체');
  const [newTitle, setNewTitle] = useState('');
  const [notice, setNotice] = useState('');
  const [displayName, setDisplayName] = useState('사용자');
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<Task | null>(null);
  const visibleTasks = useMemo(() => filter === '내 업무' ? tasks.filter((task) => task.owner === 'Nori') : tasks, [filter, tasks]);
  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  }, []);

  useEffect(() => {
    Promise.all([fetch('/api/tasks'), fetch('/api/me')])
      .then(async ([taskResponse, meResponse]) => {
        if (!taskResponse.ok) throw new Error('업무를 불러오지 못했습니다.');
        const taskData = await taskResponse.json() as { tasks: Task[] };
        const me = meResponse.ok ? await meResponse.json() as { displayName: string } : null;
        setTasks(taskData.tasks);
        if (me?.displayName) setDisplayName(me.displayName.split('@')[0]);
      })
      .catch((error) => flash(error instanceof Error ? error.message : '데이터를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [flash]);

  useEffect(() => {
    const context = (document as Document & {
      modelContext?: {
        registerTool: (tool: {
          name: string;
          title: string;
          description: string;
          inputSchema: object;
          annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
          execute: (input: unknown) => unknown;
        }, options?: { signal?: AbortSignal }) => void | Promise<void>;
      };
    }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: 'create_project_task',
      title: '프로젝트 업무 만들기',
      description: '새 프로젝트 업무를 만들고 추천 프로덕트 에이전트 Nori에게 배정합니다.',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string', minLength: 1, maxLength: 100 } },
        required: ['title'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const value = input as { title?: unknown };
        if (typeof value?.title !== 'string' || !value.title.trim() || value.title.trim().length > 100) {
          throw new Error('title은 1~100자의 문자열이어야 합니다.');
        }
        const response = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: value.title.trim() }) });
        const data = await response.json() as { task?: Task; error?: string };
        if (!response.ok || !data.task) throw new Error(data.error || '업무를 만들지 못했습니다.');
        const task = data.task;
        setTasks((current) => [...current, task]);
        flash('새 업무가 Nori에게 배정되었습니다.');
        return { id: task.id, title: task.title, owner: task.owner, status: task.status };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [flash]);
  async function createTask() {
    const title = newTitle.trim();
    if (!title) return;
    try {
      const response = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
      const data = await response.json() as { task?: Task; error?: string };
      if (!response.ok || !data.task) throw new Error(data.error || '업무를 만들지 못했습니다.');
      setTasks((current) => [...current, data.task!]);
      setNewTitle('');
      flash('새 업무가 Nori에게 배정되었습니다.');
    } catch (error) { flash(error instanceof Error ? error.message : '업무를 만들지 못했습니다.'); }
  }

  async function runAgent(task: Task) {
    setRunningId(task.id);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: '진행 중' } : item));
    try {
      const response = await fetch('/api/agents/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id }) });
      const data = await response.json() as { output?: string; status?: Status; error?: string };
      if (!response.ok || !data.output) throw new Error(data.error || '에이전트 실행에 실패했습니다.');
      const completed = { ...task, status: '검토' as const, result: data.output };
      setTasks((current) => current.map((item) => item.id === task.id ? completed : item));
      setSelectedResult(completed);
      flash(`${task.owner}가 업무를 완료했습니다.`);
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: task.status } : item));
      flash(error instanceof Error ? error.message : '에이전트 실행에 실패했습니다.');
    } finally { setRunningId(null); }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark" aria-label="Orbit 홈"><Command size={20} strokeWidth={2.5} /></div>
        <nav className="primary-nav" aria-label="주 메뉴">
          {([['개요', LayoutDashboard], ['업무', ListChecks], ['에이전트', Bot], ['대화', MessageSquareText]] as const).map(([label, Icon]) => (
            <button className={activeNav === label ? 'nav-button active' : 'nav-button'} key={label} onClick={() => setActiveNav(label)} aria-label={label} title={label}>
              <Icon size={20} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <button className="nav-button" aria-label="설정" title="설정"><Settings size={20} /><span>설정</span></button>
        {/* oxlint-disable-next-line next/no-html-link-for-pages -- dispatch-owned authentication route requires top-level navigation */}
        <a className="user-avatar" aria-label="로그아웃" title="로그아웃" href="/signout-with-chatgpt?return_to=/"><LogOut size={15} /></a>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="project-switcher">
            <span className="project-logo">O</span>
            <div><span className="eyebrow">워크스페이스</span><button>Orbit 팀 <ChevronDown size={14} /></button></div>
          </div>
          <label className="search-box"><Search size={17} /><input aria-label="검색" placeholder="업무, 에이전트 검색" /><kbd>⌘ K</kbd></label>
          <div className="top-actions">
            <button className="icon-button" aria-label="알림"><Bell size={18} /><span className="notification-dot" /></button>
            <div className="presence-stack" aria-label="접속 중인 팀원 3명"><span>YN</span><span>SK</span><span>+2</span></div>
            <Dialog>
              <DialogTrigger render={<Button className="create-button" />}><Plus size={16} /> 업무 만들기</DialogTrigger>
              <DialogContent className="task-dialog">
                <DialogHeader><DialogTitle>새 업무 만들기</DialogTitle><DialogDescription>업무를 추가하면 가장 적합한 에이전트에게 바로 배정할 수 있어요.</DialogDescription></DialogHeader>
                <label className="dialog-field"><span>업무 이름</span><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="예: 결제 플로우 엣지 케이스 정리" /></label>
                <div className="assignee-preview"><span className="mini-avatar nori">N</span><div><strong>Nori</strong><span>프로덕트 에이전트 · 자동 추천</span></div><Sparkles size={16} /></div>
                <DialogFooter><DialogClose render={<Button variant="outline" />}>취소</DialogClose><DialogClose render={<Button onClick={createTask} disabled={!newTitle.trim()} />}>업무 배정</DialogClose></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div><p className="eyebrow">2026년 9월 4일 · 금요일</p><h1>좋은 오후예요, {displayName}님.</h1><p>{loading ? '저장된 워크스페이스를 불러오는 중이에요.' : `4명의 에이전트가 ${tasks.length}개 업무에서 협업하고 있어요.`}</p></div>
            <fieldset className="view-switch" aria-label="업무 필터">{(['전체', '내 업무'] as const).map((item) => <button className={filter === item ? 'selected' : ''} key={item} onClick={() => setFilter(item)}>{item}</button>)}</fieldset>
          </div>

          <section className="overview-grid" aria-label="오늘의 현황">
            <article className="focus-card">
              <div className="focus-topline"><span><Zap size={14} fill="currentColor" /> 지금 집중할 일</span><button aria-label="더 보기"><MoreHorizontal size={18} /></button></div>
              <h2>AI 협업 보드 MVP 완성</h2><p>에이전트 실행 흐름과 업무 상태가 자연스럽게 연결되는지 확인하세요.</p>
              <div className="progress-row"><span>프로젝트 진행률</span><strong>68%</strong></div><div className="progress-track"><span style={{ width: '68%' }} /></div>
              <div className="focus-footer"><div className="mini-team"><span>M</span><span>N</span><span>B</span></div><span><Clock3 size={14} /> 3일 남음</span><button onClick={() => flash('프로젝트 상세 보기를 준비하고 있어요.')}>프로젝트 열기 <ArrowUpRight size={14} /></button></div>
            </article>

            <article className="pulse-card">
              <div className="card-title"><span className="icon-tile violet"><Activity size={18} /></span><div><p>에이전트 활동</p><strong>현재 3명 작업 중</strong></div><span className="live-pill"><i /> LIVE</span></div>
              <div className="pulse-chart" aria-label="최근 에이전트 활동량 차트">{[32, 52, 40, 71, 58, 84, 66, 93, 78, 64, 88, 74].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
              <div className="pulse-footer"><span>지난 60분</span><strong>42회 실행</strong></div>
            </article>

            <article className="stat-card"><span className="icon-tile orange"><ListChecks size={18} /></span><div><strong>{tasks.length}</strong><span>전체 업무</span></div><em>영구 저장됨</em></article>
            <article className="stat-card"><span className="icon-tile mint"><Check size={18} /></span><div><strong>24</strong><span>완료한 업무</span></div><em>완료율 72%</em></article>
            <article className="stat-card"><span className="icon-tile blue"><Gauge size={18} /></span><div><strong>11.2h</strong><span>절약한 시간</span></div><em>이번 주 기준</em></article>
          </section>

          <section className="main-grid">
            <div className="board-panel">
              <div className="section-header"><div><span className="section-kicker">업무 흐름</span><h2>에이전트 보드</h2></div><button className="text-button">모든 업무 <ArrowUpRight size={15} /></button></div>
              <div className="kanban-board">
                {columns.map((column) => {
                  const columnTasks = visibleTasks.filter((task) => task.status === column);
                  return <div className="kanban-column" key={column}>
                    <div className="column-heading"><span className={`status-dot ${column === '진행 중' ? 'doing' : column === '검토' ? 'review' : ''}`} /><strong>{column}</strong><span>{columnTasks.length}</span></div>
                    <div className="task-stack">{columnTasks.map((task) => <article className="task-card" key={task.id}>
                      <span className="task-label" style={{ color: task.accent, backgroundColor: `${task.accent}14` }}>{task.label}</span><strong>{task.title}</strong>
                      <div className="task-meta"><span className="mini-avatar" style={{ background: task.accent }}>{task.avatar || task.owner[0]}</span><span>{task.owner}</span><span className="task-due"><Clock3 size={13} /> {task.due}</span></div>
                      {task.result ? <button className="run-task result" onClick={() => setSelectedResult(task)}><Check size={13} /> 결과 보기</button> : <button className="run-task" disabled={runningId === task.id} onClick={() => runAgent(task)}>{runningId === task.id ? <LoaderCircle className="spin" size={13} /> : <Play size={13} fill="currentColor" />} {runningId === task.id ? '실행 중' : '에이전트 실행'}</button>}
                    </article>)}{!loading && columnTasks.length === 0 && <div className="empty-column">이 단계의 업무가 없어요.</div>}</div>
                  </div>;
                })}
              </div>
            </div>

            <aside className="agent-panel">
              <div className="section-header"><div><span className="section-kicker">팀</span><h2>에이전트</h2></div><button className="icon-button small" aria-label="에이전트 추가"><Plus size={16} /></button></div>
              <div className="agent-orbit" aria-hidden="true"><span /><span /><i /></div>
              <div className="agent-list">{agents.map((agent, index) => <button className="agent-row" key={agent.name} onClick={() => flash(`${agent.name} 에이전트의 최근 활동을 불러왔어요.`)}>
                <span className="agent-avatar" style={{ background: agent.color }}>{agent.avatar}<i className={index === 3 ? 'idle' : ''} /></span>
                <span className="agent-copy"><strong>{agent.name}<em>{agent.role}</em></strong><small>{agent.status}</small></span><MoreHorizontal size={17} />
              </button>)}</div>
              <button className="agent-cta" onClick={() => flash('팀 성과 리포트를 생성하고 있어요.')}><WandSparkles size={16} /> 팀 성과 요약하기</button>
            </aside>
          </section>
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
