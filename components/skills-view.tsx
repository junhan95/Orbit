'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Check, Globe, LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { t, tf } from '@/lib/i18n';
import './governance.css';

/**
 * 스킬 탭 — 에이전트가 반복 작업의 절차를 저장해 두는 곳 (Hermes 의 skills 디렉터리 개념).
 *   - 실행 중에는 인덱스(이름+설명)만 프롬프트에 들어가고, 필요할 때 use_skill 로 본문을 읽습니다.
 *   - project 스코프는 그 프로젝트 팀만, global 은 모든 프로젝트. 에이전트의 global 저장은 승인함을 거칩니다.
 * 사람은 여기서 직접 쓰고 고치고 지웁니다. 같은 이름으로 저장하면 갱신됩니다.
 */

type Scope = 'global' | 'project';
type Skill = { id: string; scope: Scope; projectId: string | null; projectName: string | null; name: string; description: string; body: string; createdBy: string; uses: number; createdAt: number; updatedAt: number };
type Limits = { name: number; description: number; body: number; perScope: number };
type Draft = { id: string | null; scope: Scope; projectId: string; name: string; description: string; body: string };

const EMPTY: Draft = { id: null, scope: 'project', projectId: '', name: '', description: '', body: '' };

export function SkillsView({ onNotice, onChanged }: { onNotice: (message: string) => void; onChanged?: () => void }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [limits, setLimits] = useState<Limits>({ name: 60, description: 200, body: 6000, perScope: 40 });
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [response, ws] = await Promise.all([fetch('/api/skills'), fetch('/api/workspace')]);
      if (!response.ok) throw new Error();
      const data = await response.json() as { skills: Skill[]; limits: Limits };
      setSkills(data.skills); setLimits(data.limits);
      if (ws.ok) setProjects(((await ws.json() as { projects: { id: string; name: string }[] }).projects) ?? []);
    } catch { onNotice(t('스킬을 불러오지 못했습니다.')); }
    finally { setLoading(false); }
  }, [onNotice]);

  // oxlint-disable-next-line react/react-compiler -- 탭에 들어올 때 한 번 읽습니다
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!draft) return;
    setBusy(draft.id ?? 'new');
    try {
      const json = { headers: { 'content-type': 'application/json' } };
      const response = draft.id
        ? await fetch(`/api/skills/${draft.id}`, { method: 'PATCH', ...json, body: JSON.stringify({ name: draft.name, description: draft.description, body: draft.body }) })
        : await fetch('/api/skills', { method: 'POST', ...json, body: JSON.stringify({ scope: draft.scope, projectId: draft.scope === 'project' ? draft.projectId : undefined, name: draft.name, description: draft.description, body: draft.body }) });
      const data = await response.json().catch(() => ({})) as { error?: string; action?: string };
      if (!response.ok) throw new Error(data.error ?? t('저장하지 못했습니다.'));
      onNotice(draft.id || data.action === 'updated' ? t('스킬을 갱신했습니다.') : t('스킬을 저장했습니다.'));
      setDraft(null);
      await load();
      onChanged?.();
    } catch (error) { onNotice(error instanceof Error ? error.message : t('저장하지 못했습니다.')); }
    finally { setBusy(null); }
  }

  async function remove(skill: Skill) {
    setBusy(skill.id);
    try {
      const response = await fetch(`/api/skills/${skill.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? t('삭제하지 못했습니다.'));
      onNotice(t('스킬을 삭제했습니다.'));
      await load();
      onChanged?.();
    } catch (error) { onNotice(error instanceof Error ? error.message : t('삭제하지 못했습니다.')); }
    finally { setBusy(null); }
  }

  const valid = draft && draft.name.trim() && draft.description.trim() && draft.body.trim()
    && draft.name.length <= limits.name && draft.description.length <= limits.description && draft.body.length <= limits.body
    && (draft.scope === 'global' || draft.projectId);
  const globals = skills.filter((skill) => skill.scope === 'global');
  const byProject = new Map<string, Skill[]>();
  for (const skill of skills.filter((item) => item.scope === 'project')) {
    const key = skill.projectName ?? t('(삭제된 프로젝트)');
    byProject.set(key, [...(byProject.get(key) ?? []), skill]);
  }

  const renderList = (items: Skill[]) => <ul className="gov-list">
    {items.map((skill) => <li className="gov-item" key={skill.id}>
      <div className="gov-item-top">
        <div>
          <b>{skill.scope === 'global' ? <Globe size={12} /> : <BookOpen size={12} />} {skill.name}</b>
          <div className="gov-item-meta">
            <span>{skill.createdBy === 'user' ? t('사람') : skill.createdBy}</span><span>·</span><span>{tf('{0}회 사용', skill.uses)}</span>
          </div>
        </div>
        <div className="gov-item-actions">
          <button className="gov-button ghost" onClick={() => setOpen(open === skill.id ? null : skill.id)}>{open === skill.id ? t('본문 닫기') : t('본문 보기')}</button>
          <button className="gov-button ghost" title={t('수정')} disabled={busy === skill.id} onClick={() => { setOpen(null); setDraft({ id: skill.id, scope: skill.scope, projectId: skill.projectId ?? '', name: skill.name, description: skill.description, body: skill.body }); }}><Pencil size={13} /></button>
          <button className="gov-button ghost" title={t('삭제')} disabled={busy === skill.id} onClick={() => void remove(skill)}>{busy === skill.id ? <LoaderCircle size={13} className="spin" /> : <Trash2 size={13} />}</button>
        </div>
      </div>
      <p className="gov-item-body">{skill.description}</p>
      {open === skill.id && <pre className="gov-item-body gov-mono" style={{ margin: 0 }}>{skill.body}</pre>}
    </li>)}
  </ul>;

  return <section className="workspace-view">
    <div className="workspace-heading">
      <div>
        <span className="section-kicker">{t('반복 절차')}</span>
        <h1>{t('스킬')}</h1>
        <p>{t('에이전트가 같은 일을 다시 할 때 꺼내 쓰는 절차입니다. 실행 중에는 이름과 설명만 보이고, 필요할 때 본문을 읽습니다. 전역 스킬은 모든 프로젝트에 영향을 주므로 에이전트의 저장 요청은 승인함을 거칩니다.')}</p>
      </div>
      <div className="view-actions gov-toolbar">
        <button className="gov-button" onClick={() => void load()} disabled={loading}>{loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} {t('새로고침')}</button>
        <button className="gov-button primary" onClick={() => setDraft({ ...EMPTY, projectId: projects[0]?.id ?? '' })}><Plus size={14} /> {t('스킬 작성')}</button>
      </div>
    </div>

    {draft && <article className="gov-card" style={{ marginBottom: 14 }}>
      <header className="gov-card-head"><h2>{draft.id ? <Pencil size={16} /> : <Plus size={16} />} {draft.id ? t('스킬 수정') : t('스킬 작성')}</h2></header>
      <div className="gov-form">
        {!draft.id && <div className="gov-form-row">
          <select value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value as Scope })}>
            <option value="project">{t('프로젝트 스킬')}</option>
            <option value="global">{t('전역 스킬 (모든 프로젝트)')}</option>
          </select>
          {draft.scope === 'project' && <select value={draft.projectId} onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}>
            <option value="">{t('프로젝트 선택')}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>}
        </div>}
        <input value={draft.name} maxLength={limits.name} placeholder={t('이름 (예: 주간 보고서 작성)')} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <input value={draft.description} maxLength={limits.description} placeholder={t('언제 쓰는 스킬인지 한 줄 (인덱스에 이 문장이 보입니다)')} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        <textarea value={draft.body} maxLength={limits.body} style={{ minHeight: 180 }} placeholder={t('절차. 단계별로, 확인할 것과 흔한 실수를 포함해서.')} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
        <div className="gov-item-actions">
          <button className="gov-button primary" disabled={!valid || busy !== null} onClick={() => void save()}>{busy ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />} {t('저장')}</button>
          <button className="gov-button ghost" onClick={() => setDraft(null)}>{t('취소')}</button>
          <small className="gov-usage">{tf('본문 {0} / {1}자', draft.body.length, limits.body)}</small>
        </div>
      </div>
    </article>}

    {!loading && skills.length === 0 && !draft && <div className="entity-empty"><BookOpen size={34} /><h2>{t('저장된 스킬이 없습니다')}</h2><p>{t('에이전트가 반복될 만한 절차를 발견하면 save_skill 로 남기고, 사람도 여기서 직접 쓸 수 있습니다.')}</p></div>}

    <div className="gov-grid">
      {globals.length > 0 && <article className="gov-card wide">
        <header className="gov-card-head"><h2><Globe size={16} /> {t('전역 스킬')} <em>{tf('{0} / {1}', globals.length, limits.perScope)}</em></h2></header>
        {renderList(globals)}
      </article>}
      {[...byProject.entries()].map(([name, items]) => <article className="gov-card wide" key={name}>
        <header className="gov-card-head"><h2><BookOpen size={16} /> {name} <em>{tf('{0} / {1}', items.length, limits.perScope)}</em></h2></header>
        {renderList(items)}
      </article>)}
    </div>
  </section>;
}
