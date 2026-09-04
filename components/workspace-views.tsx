'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, BriefcaseBusiness, Check, ChevronRight, CirclePlus, FolderKanban, LoaderCircle, Plus, Send, Settings2, ShieldCheck, Sparkles, UserRound, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';

export type WorkspaceSection = '프로젝트' | '에이전트' | '대화' | '설정' | '계정';
type Project = { id: string; name: string; description: string; color: string; status: string; taskCount: number; agentCount: number };
type Agent = { id: string; name: string; role: string; description: string; instructions: string; color: string; isDefault: number };
type Assignment = { projectId: string; agentId: string };
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
  if (section === '프로젝트') return <ProjectsView projects={projects} agents={agents} onCreated={refresh} onNotice={onNotice} />;
  if (section === '에이전트') return <AgentsView agents={agents} assignments={assignments} onCreated={refresh} onNotice={onNotice} />;
  if (section === '대화') return <ChatView projects={projects} agents={agents} assignments={assignments} onNotice={onNotice} />;
  if (section === '설정') return <SettingsView onNotice={onNotice} />;
  return <AccountView displayName={displayName} email={email} />;
}

function ViewHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="workspace-heading"><div><span className="section-kicker">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function ProjectsView({ projects, agents, onCreated, onNotice }: { projects: Project[]; agents: Agent[]; onCreated: () => Promise<void>; onNotice: (message: string) => void }) {
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [selected, setSelected] = useState<string[]>(agents.filter((agent) => agent.isDefault).map((agent) => agent.id));
  const [saving, setSaving] = useState(false);
  async function createProject() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const response = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description, agentIds: selected }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || '프로젝트를 만들지 못했습니다.');
      setName(''); setDescription(''); await onCreated(); onNotice('새 프로젝트가 생성되었습니다.');
    } catch (error) { onNotice(error instanceof Error ? error.message : '프로젝트를 만들지 못했습니다.'); }
    finally { setSaving(false); }
  }
  const action = <Dialog><DialogTrigger render={<Button className="view-primary" />}><Plus size={16} /> 프로젝트 만들기</DialogTrigger><DialogContent className="create-entity-dialog">
    <DialogHeader><DialogTitle>새 프로젝트</DialogTitle><DialogDescription>목표를 정하고 함께 일할 AI 에이전트를 선택하세요.</DialogDescription></DialogHeader>
    <label className="entity-field"><span>프로젝트 이름</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 신규 서비스 출시" /></label>
    <label className="entity-field"><span>설명</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="달성하려는 목표를 간단히 적어주세요." /></label>
    <fieldset className="agent-picker"><legend>참여 에이전트</legend>{agents.map((agent) => <label key={agent.id}><Checkbox checked={selected.includes(agent.id)} onCheckedChange={(checked) => setSelected((current) => checked ? [...current, agent.id] : current.filter((id) => id !== agent.id))} /><span className="mini-agent" style={{ background: agent.color }}>{agent.name[0]}</span><span><strong>{agent.name}</strong><small>{agent.role}</small></span></label>)}</fieldset>
    <DialogFooter><DialogClose render={<Button variant="outline" />}>취소</DialogClose><DialogClose render={<Button disabled={!name.trim() || saving} onClick={createProject} />}>{saving ? '생성 중' : '프로젝트 생성'}</DialogClose></DialogFooter>
  </DialogContent></Dialog>;
  return <div className="workspace-view"><ViewHeading eyebrow="Projects" title="프로젝트" description="진행 중인 프로젝트와 참여 에이전트를 관리합니다." action={action} />
    <div className="project-grid">{projects.map((project) => <article className="project-card" key={project.id}><div className="project-card-top"><span className="project-symbol" style={{ background: project.color }}><FolderKanban size={20} /></span><span className="project-status"><i />{project.status}</span></div><h2>{project.name}</h2><p>{project.description || '프로젝트 설명이 없습니다.'}</p><div className="project-stats"><span><BriefcaseBusiness size={14} />업무 {project.taskCount}</span><span><Users size={14} />에이전트 {project.agentCount}</span></div><button onClick={() => onNotice(`${project.name} 상세 화면을 준비하고 있어요.`)}>프로젝트 열기 <ChevronRight size={15} /></button></article>)}</div>
    {!projects.length && <div className="entity-empty"><CirclePlus size={30} /><h2>첫 프로젝트를 만들어 보세요</h2><p>목표와 에이전트를 한곳에서 관리할 수 있어요.</p></div>}
  </div>;
}

function AgentsView({ agents, assignments, onCreated, onNotice }: { agents: Agent[]; assignments: Assignment[]; onCreated: () => Promise<void>; onNotice: (message: string) => void }) {
  const [name, setName] = useState(''); const [role, setRole] = useState(''); const [description, setDescription] = useState(''); const [saving, setSaving] = useState(false);
  async function createAgent() {
    if (!name.trim() || !role.trim()) return;
    setSaving(true);
    try { const response = await fetch('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, role, description }) }); const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error || '에이전트를 만들지 못했습니다.'); setName(''); setRole(''); setDescription(''); await onCreated(); onNotice('새 에이전트가 준비되었습니다.'); }
    catch (error) { onNotice(error instanceof Error ? error.message : '에이전트를 만들지 못했습니다.'); } finally { setSaving(false); }
  }
  const action = <Dialog><DialogTrigger render={<Button className="view-primary" />}><Plus size={16} /> 에이전트 만들기</DialogTrigger><DialogContent className="create-entity-dialog"><DialogHeader><DialogTitle>새 AI 에이전트</DialogTitle><DialogDescription>이름과 역할을 바탕으로 기본 실행 지침을 구성합니다.</DialogDescription></DialogHeader><label className="entity-field"><span>이름</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: Atlas" /></label><label className="entity-field"><span>역할</span><input value={role} onChange={(event) => setRole(event.target.value)} placeholder="예: 데이터 분석가" /></label><label className="entity-field"><span>역할 설명</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="이 에이전트가 잘해야 하는 일을 적어주세요." /></label><DialogFooter><DialogClose render={<Button variant="outline" />}>취소</DialogClose><DialogClose render={<Button disabled={!name.trim() || !role.trim() || saving} onClick={createAgent} />}>{saving ? '생성 중' : '에이전트 생성'}</DialogClose></DialogFooter></DialogContent></Dialog>;
  return <div className="workspace-view"><ViewHeading eyebrow="Agent Library" title="에이전트" description="역할별 기본 에이전트를 사용하거나 팀에 맞는 에이전트를 만드세요." action={action} />
    <div className="agent-library">{agents.map((agent) => { const projectCount = new Set(assignments.filter((item) => item.agentId === agent.id).map((item) => item.projectId)).size; return <article className="agent-profile" key={agent.id}><div className="agent-profile-head"><span style={{ background: agent.color }}>{agent.name[0]}</span><div><h2>{agent.name}</h2><p>{agent.role}</p></div>{Boolean(agent.isDefault) && <em><Sparkles size={11} /> 기본</em>}</div><p className="agent-description">{agent.description}</p><div className="agent-capability"><Check size={13} />프로젝트 {projectCount}개에 참여 중</div><button onClick={() => onNotice(`${agent.name}을 프로젝트에 배정할 수 있어요.`)}>에이전트 설정 <ChevronRight size={15} /></button></article>; })}</div>
    <div className="agent-template-note"><ShieldCheck size={20} /><div><strong>검증된 기본 AI 팀</strong><p>프로젝트 매니저, 리서처, 프로덕트 디자이너, 엔지니어, QA 엔지니어가 기본으로 준비되어 있습니다.</p></div></div>
  </div>;
}

function ChatView({ projects, agents, assignments, onNotice }: { projects: Project[]; agents: Agent[]; assignments: Assignment[]; onNotice: (message: string) => void }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const availableAgents = useMemo(() => agents.filter((agent) => assignments.some((item) => item.projectId === projectId && item.agentId === agent.id)), [agents, assignments, projectId]);
  const [agentId, setAgentId] = useState(''); const [messages, setMessages] = useState<ChatMessage[]>([]); const [draft, setDraft] = useState(''); const [sending, setSending] = useState(false);
  const selectedAgentId = availableAgents.some((agent) => agent.id === agentId) ? agentId : availableAgents[0]?.id || '';
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  useEffect(() => { if (!projectId || !selectedAgentId) return; fetch(`/api/chat?projectId=${encodeURIComponent(projectId)}&agentId=${encodeURIComponent(selectedAgentId)}`).then(async (response) => await response.json() as { messages?: ChatMessage[] }).then((data) => setMessages(data.messages || [])).catch(() => setMessages([])); }, [projectId, selectedAgentId]);
  async function sendMessage() {
    const message = draft.trim(); if (!message || !selectedAgentId) return; setDraft(''); setSending(true);
    const optimistic: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content: message, createdAt: Date.now() }; setMessages((current) => [...current, optimistic]);
    try { const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, agentId: selectedAgentId, message }) }); const data = await response.json() as { userMessage?: ChatMessage; assistantMessage?: ChatMessage; error?: string }; if (!response.ok || !data.assistantMessage) throw new Error(data.error || '메시지를 보내지 못했습니다.'); setMessages((current) => [...current.filter((item) => item.id !== optimistic.id), data.userMessage!, data.assistantMessage!]); }
    catch (error) { onNotice(error instanceof Error ? error.message : '메시지를 보내지 못했습니다.'); } finally { setSending(false); }
  }
  return <div className="workspace-view chat-page"><ViewHeading eyebrow="Agent Chat" title="대화" description="프로젝트에 배정된 에이전트를 호출해 업무를 지시하세요." />
    <div className="chat-shell"><aside className="chat-context"><label>프로젝트<NativeSelect value={projectId} onChange={(event) => { setProjectId(event.target.value); setAgentId(''); }}><NativeSelectOption value="">프로젝트 선택</NativeSelectOption>{projects.map((project) => <NativeSelectOption key={project.id} value={project.id}>{project.name}</NativeSelectOption>)}</NativeSelect></label><strong>참여 에이전트</strong>{availableAgents.map((agent) => <button className={selectedAgentId === agent.id ? 'chat-agent active' : 'chat-agent'} key={agent.id} onClick={() => setAgentId(agent.id)}><span style={{ background: agent.color }}>{agent.name[0]}</span><div><b>{agent.name}</b><small>{agent.role}</small></div></button>)}</aside>
      <section className="conversation"><header><span style={{ background: selectedAgent?.color || '#6651f2' }}>{selectedAgent?.name[0] || <Bot size={17} />}</span><div><strong>{selectedAgent?.name || '에이전트를 선택하세요'}</strong><small>{selectedAgent?.role || '프로젝트 참여 에이전트'}</small></div><em><i /> 대화 가능</em></header><div className="message-list">{!messages.length && <div className="chat-welcome"><Sparkles size={24} /><h2>{selectedAgent?.name || 'AI 에이전트'}에게 무엇을 맡길까요?</h2><p>목표, 배경, 원하는 결과물을 알려주면 프로젝트 맥락에 맞춰 답합니다.</p></div>}{messages.map((message) => <div className={`message ${message.role}`} key={message.id}><span>{message.role === 'assistant' ? selectedAgent?.name[0] : '나'}</span><p>{message.content}</p></div>)}{sending && <div className="message assistant"><span>{selectedAgent?.name[0]}</span><p className="thinking"><i /><i /><i /></p></div>}</div><div className="chat-composer"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={`${selectedAgent?.name || '에이전트'}에게 업무를 지시하세요...`} disabled={!selectedAgentId || sending} /><button onClick={sendMessage} disabled={!draft.trim() || sending}><Send size={17} /></button><small>Enter 전송 · Shift+Enter 줄바꿈</small></div></section>
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
