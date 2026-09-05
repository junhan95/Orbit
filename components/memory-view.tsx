'use client';

import { useCallback, useEffect, useState } from 'react';
import { Brain, Check, LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { t, tf } from '@/lib/i18n';
import './governance.css';

/**
 * 기억 탭 — 에이전트 프롬프트에 주입되는 장기 기억을 사람이 직접 봅니다.
 *   user    : 사용자 프로필 (모든 실행에 주입)
 *   project : 프로젝트 기억 (에이전트가 쓰면 pending → 사람이 승인해야 주입)
 *   agent   : 에이전트 노트 (그 에이전트의 실행에만)
 * 스코프마다 글자 예산이 있어 사용률 막대를 보여 줍니다. 예산을 넘으면 서버가 저장을 거부합니다.
 */

type Scope = 'user' | 'project' | 'agent';
type Entry = { id: string; content: string; status: 'active' | 'pending'; createdBy: string; createdAt: number; updatedAt: number };
type Group = { scope: Scope; scopeId: string | null; scopeName: string | null; label: string; entries: Entry[]; used: number; limit: number; pendingCount: number };
type Workspace = { projects: { id: string; name: string }[]; agents: { id: string; name: string; isManager: number }[] };

const SCOPE_LABEL: Record<Scope, string> = { user: '사용자 프로필', project: '프로젝트 기억', agent: '에이전트 노트' };

export function MemoryView({ onNotice, onChanged }: { onNotice: (message: string) => void; onChanged?: () => void }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [limits, setLimits] = useState<Record<Scope, number>>({ user: 0, project: 0, agent: 0 });
  const [workspace, setWorkspace] = useState<Workspace>({ projects: [], agents: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [adding, setAdding] = useState<{ scope: Scope; scopeId: string; content: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [memory, ws] = await Promise.all([fetch('/api/memory'), fetch('/api/workspace')]);
      if (!memory.ok) throw new Error();
      const data = await memory.json() as { groups: Group[]; limits: Record<Scope, number> };
      setGroups(data.groups); setLimits(data.limits);
      if (ws.ok) {
        const parsed = await ws.json() as Workspace;
        setWorkspace({ projects: parsed.projects ?? [], agents: parsed.agents ?? [] });
      }
    } catch { onNotice(t('기억을 불러오지 못했습니다.')); }
    finally { setLoading(false); }
  }, [onNotice]);

  // oxlint-disable-next-line react/react-compiler -- 탭에 들어올 때 한 번 읽습니다
  useEffect(() => { void load(); }, [load]);

  async function request(id: string, run: () => Promise<Response>, okMessage: string) {
    setBusy(id);
    try {
      const response = await run();
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? t('처리하지 못했습니다.'));
      onNotice(okMessage);
      setEditing(null); setAdding(null);
      await load();
      onChanged?.();
    } catch (error) { onNotice(error instanceof Error ? error.message : t('처리하지 못했습니다.')); }
    finally { setBusy(null); }
  }

  const json = (body: unknown) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const approve = (entry: Entry) => request(entry.id, () => fetch(`/api/memory/${entry.id}`, { method: 'PATCH', ...json({ status: 'active' }) }), t('기억을 승인했습니다. 다음 실행부터 주입됩니다.'));
  const remove = (entry: Entry) => request(entry.id, () => fetch(`/api/memory/${entry.id}`, { method: 'DELETE' }), t('기억을 삭제했습니다.'));
  const saveEdit = () => editing && request(editing.id, () => fetch(`/api/memory/${editing.id}`, { method: 'PATCH', ...json({ content: editing.content }) }), t('기억을 수정했습니다.'));
  const saveNew = () => adding && request('new', () => fetch('/api/memory', { method: 'POST', ...json({ scope: adding.scope, scopeId: adding.scope === 'user' ? undefined : adding.scopeId, content: adding.content }) }), t('기억을 추가했습니다.'));

  // 사용자 프로필은 항상 한 그룹으로 보여 줍니다 (비어 있어도 추가할 수 있게)
  const shown: Group[] = groups.some((group) => group.scope === 'user') ? groups
    : [{ scope: 'user', scopeId: null, scopeName: null, label: SCOPE_LABEL.user, entries: [], used: 0, limit: limits.user, pendingCount: 0 }, ...groups];
  const scopeTargets = adding?.scope === 'project' ? workspace.projects : adding?.scope === 'agent' ? workspace.agents : [];

  return <section className="workspace-view">
    <div className="workspace-heading">
      <div>
        <span className="section-kicker">{t('장기 기억')}</span>
        <h1>{t('기억')}</h1>
        <p>{t('에이전트가 매 실행마다 프롬프트로 받는 사실들입니다. 사용자 프로필은 모두에게, 프로젝트 기억은 그 프로젝트 팀에게, 에이전트 노트는 그 에이전트에게만 주입됩니다.')}</p>
      </div>
      <div className="view-actions gov-toolbar">
        <button className="gov-button" onClick={() => void load()} disabled={loading}>{loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} {t('새로고침')}</button>
        <button className="gov-button primary" onClick={() => setAdding({ scope: 'user', scopeId: '', content: '' })}><Plus size={14} /> {t('기억 추가')}</button>
      </div>
    </div>

    {adding && <article className="gov-card" style={{ marginBottom: 14 }}>
      <header className="gov-card-head"><h2><Plus size={16} /> {t('기억 추가')}</h2></header>
      <div className="gov-form">
        <div className="gov-form-row">
          <select value={adding.scope} onChange={(event) => setAdding({ ...adding, scope: event.target.value as Scope, scopeId: '' })}>
            {(['user', 'project', 'agent'] as Scope[]).map((scope) => <option key={scope} value={scope}>{t(SCOPE_LABEL[scope])}</option>)}
          </select>
          {adding.scope !== 'user' && <select value={adding.scopeId} onChange={(event) => setAdding({ ...adding, scopeId: event.target.value })}>
            <option value="">{adding.scope === 'project' ? t('프로젝트 선택') : t('에이전트 선택')}</option>
            {scopeTargets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
          </select>}
        </div>
        <textarea value={adding.content} placeholder={t('한 줄로 된 확정된 사실. 예) 보고서는 항상 한국어로, 표는 마크다운으로.')} onChange={(event) => setAdding({ ...adding, content: event.target.value })} />
        <div className="gov-item-actions">
          <button className="gov-button primary" disabled={busy === 'new' || !adding.content.trim() || (adding.scope !== 'user' && !adding.scopeId)} onClick={() => void saveNew()}>{busy === 'new' ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />} {t('저장')}</button>
          <button className="gov-button ghost" onClick={() => setAdding(null)}>{t('취소')}</button>
          <small className="gov-usage">{tf('예산 {0}자', limits[adding.scope])}</small>
        </div>
      </div>
    </article>}

    <div className="gov-grid">
      {shown.map((group) => {
        const ratio = group.limit ? group.used / group.limit : 0;
        return <article className="gov-card" key={`${group.scope}:${group.scopeId ?? ''}`}>
          <header className="gov-card-head">
            <div>
              <h2><Brain size={16} /> {group.scope === 'user' ? t(SCOPE_LABEL.user) : `${t(SCOPE_LABEL[group.scope])} · ${group.scopeName ?? t('(삭제됨)')}`}
                {group.pendingCount > 0 && <span className="gov-chip pending">{tf('승인 대기 {0}', group.pendingCount)}</span>}</h2>
              <p>{tf('{0} / {1}자 사용', group.used, group.limit)}</p>
            </div>
            <button className="gov-button ghost" title={t('여기에 추가')} onClick={() => setAdding({ scope: group.scope, scopeId: group.scopeId ?? '', content: '' })}><Plus size={14} /></button>
          </header>
          <div className="gov-bar"><i className={ratio > 0.95 ? 'over' : ratio > 0.8 ? 'warn' : ''} style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
          <ul className="gov-list">
            {group.entries.map((entry) => <li className={entry.status === 'pending' ? 'gov-item pending' : 'gov-item'} key={entry.id}>
              {editing?.id === entry.id
                ? <div className="gov-form">
                    <textarea value={editing.content} onChange={(event) => setEditing({ id: entry.id, content: event.target.value })} />
                    <div className="gov-item-actions">
                      <button className="gov-button primary" disabled={busy === entry.id || !editing.content.trim()} onClick={() => void saveEdit()}><Check size={13} /> {t('저장')}</button>
                      <button className="gov-button ghost" onClick={() => setEditing(null)}>{t('취소')}</button>
                    </div>
                  </div>
                : <>
                    <p className="gov-item-body">{entry.content}</p>
                    <div className="gov-item-top">
                      <div className="gov-item-meta">
                        <span>{entry.createdBy === 'user' ? t('사람') : entry.createdBy}</span>
                        {entry.status === 'pending' && <span className="gov-chip pending">{t('승인 대기')}</span>}
                      </div>
                      <div className="gov-item-actions">
                        {entry.status === 'pending' && <button className="gov-button ok" disabled={busy === entry.id} onClick={() => void approve(entry)}><Check size={13} /> {t('승인')}</button>}
                        <button className="gov-button ghost" disabled={busy === entry.id} onClick={() => setEditing({ id: entry.id, content: entry.content })} title={t('수정')}><Pencil size={13} /></button>
                        <button className="gov-button ghost" disabled={busy === entry.id} onClick={() => void remove(entry)} title={t('삭제')}>{busy === entry.id ? <LoaderCircle size={13} className="spin" /> : <Trash2 size={13} />}</button>
                      </div>
                    </div>
                  </>}
            </li>)}
            {group.entries.length === 0 && <li><p className="gov-empty">{t('아직 기억이 없습니다.')}</p></li>}
          </ul>
        </article>;
      })}
    </div>
    {!loading && shown.length === 1 && shown[0].entries.length === 0 && <p className="gov-empty" style={{ marginTop: 12 }}>
      {t('에이전트가 실행 중 memory 도구로 남기거나, 실행이 끝난 뒤 검토 모델이 대화에서 사실을 뽑아 여기에 채웁니다.')}
    </p>}
  </section>;
}
