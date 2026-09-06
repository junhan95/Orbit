'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Brain, Check, ClipboardList, Inbox, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { t, tf } from '@/lib/i18n';
import './governance.css';

/**
 * 승인함 — 에이전트가 요청했지만 사람이 결정해야 하는 것들을 한 화면에 모읍니다.
 *   - /api/approvals : 실행당 카드 상한 초과분, 전역 스킬 저장 (물어보기형 게이트)
 *   - /api/memory    : 에이전트가 project 스코프에 쓴 기억 (승인돼야 프롬프트에 주입)
 * 승인/거절은 즉시 서버에 반영되고 목록을 다시 읽습니다.
 */

type Approval = {
  id: string; action: 'create_task' | 'save_global_skill'; actor: string; projectId: string | null; taskId: string | null;
  summary: string; payload: Record<string, unknown>; status: string; reason: string | null; createdAt: number; resolvedAt: number | null;
};
type MemoryEntry = { id: string; content: string; status: 'active' | 'pending'; createdBy: string; createdAt: number };
type MemoryGroup = { scope: 'user' | 'project' | 'agent'; scopeId: string | null; label: string; entries: MemoryEntry[]; pendingCount: number };

export type InboxCount = { approvals: number; memories: number; total: number; pendingIds?: string[] };

/** 사이드바 배지용 — 두 큐의 대기 수를 합칩니다. 실패하면 0. */
export async function fetchInboxCount(): Promise<InboxCount> {
  try {
    const [approvals, memory] = await Promise.all([fetch('/api/approvals'), fetch('/api/memory')]);
    const a = approvals.ok ? await approvals.json() as { pendingCount: number; approvals: Approval[] } : null;
    const m = memory.ok ? await memory.json() as { pendingTotal: number; groups: MemoryGroup[] } : null;
    return { approvals: a?.pendingCount ?? 0, memories: m?.pendingTotal ?? 0, total: (a?.pendingCount ?? 0) + (m?.pendingTotal ?? 0),
      pendingIds: a && m ? [...a.approvals.filter(item => item.status === 'pending').map(item => `approval:${item.id}`), ...m.groups.flatMap(group => group.entries.filter(entry => entry.status === 'pending').map(entry => `memory:${entry.id}`))] : undefined };
  } catch { return { approvals: 0, memories: 0, total: 0 }; }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function formatWhen(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ApprovalsView({ onNotice, onChanged }: { onNotice: (message: string) => void; onChanged?: () => void }) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [history, setHistory] = useState<Approval[]>([]);
  const [memoryGroups, setMemoryGroups] = useState<MemoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, all, memory] = await Promise.all([fetch('/api/approvals'), fetch('/api/approvals?status=all'), fetch('/api/memory')]);
      if (pending.ok) setApprovals((await pending.json() as { approvals: Approval[] }).approvals);
      if (all.ok) setHistory((await all.json() as { approvals: Approval[] }).approvals.filter((row) => row.status !== 'pending').slice(0, 8));
      if (memory.ok) setMemoryGroups((await memory.json() as { groups: MemoryGroup[] }).groups.filter((group) => group.pendingCount > 0));
    } catch {
      onNotice(t('승인함을 불러오지 못했습니다.'));
    } finally { setLoading(false); }
  }, [onNotice]);

  // oxlint-disable-next-line react/react-compiler -- 화면에 들어올 때 한 번 서버에서 읽습니다
  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, decision: 'approve' | 'reject', reason?: string) {
    setBusy(id);
    try {
      const response = await fetch(`/api/approvals/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision, reason }) });
      const data = await response.json() as { error?: string; result?: { taskId?: string; skillId?: string } };
      if (!response.ok) throw new Error(data.error ?? t('처리하지 못했습니다.'));
      onNotice(decision === 'approve'
        ? (data.result?.taskId ? t('카드를 만들었습니다.') : data.result?.skillId ? t('전역 스킬을 저장했습니다.') : t('승인했습니다.'))
        : t('거절했습니다.'));
      setRejecting(null);
      await load();
      onChanged?.();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t('처리하지 못했습니다.'));
    } finally { setBusy(null); }
  }

  async function decideMemory(entry: MemoryEntry, approve: boolean) {
    setBusy(entry.id);
    try {
      const response = approve
        ? await fetch(`/api/memory/${entry.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'active' }) })
        : await fetch(`/api/memory/${entry.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? t('처리하지 못했습니다.'));
      onNotice(approve ? t('기억을 승인했습니다. 다음 작업부터 반영됩니다.') : t('기억을 거절했습니다.'));
      await load();
      onChanged?.();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t('처리하지 못했습니다.'));
    } finally { setBusy(null); }
  }

  const pendingMemories = memoryGroups.flatMap((group) => group.entries.filter((entry) => entry.status === 'pending').map((entry) => ({ group, entry })));
  const total = approvals.length + pendingMemories.length;

  return <section className="workspace-view">
    <div className="workspace-heading">
      <div>
        <span className="section-kicker">{t("사람이 결정할 것")}</span>
        <h1>{t("승인함")}</h1>
        <p>{t("에이전트가 요청했지만 사람의 승인이 필요한 항목입니다. 승인하면 그 자리에서 실행되고, 거절은 사유와 함께 기록됩니다.")}</p>
      </div>
      <div className="view-actions">
        <button className="gov-button" onClick={() => void load()} disabled={loading}>{loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} {t("새로고침")}</button>
      </div>
    </div>

    {!loading && total === 0 && <div className="entity-empty"><Inbox size={34} /><h2>{t("대기 중인 승인이 없습니다")}</h2><p>{t("에이전트가 카드를 3장 넘게 만들거나, 전역 스킬·프로젝트 기억을 저장하려 하면 여기에 쌓입니다.")}</p></div>}

    <div className="gov-grid">
      {approvals.length > 0 && <article className="gov-card wide">
        <header className="gov-card-head">
          <h2><ClipboardList size={16} /> {t("카드·스킬 요청")} <em>{tf('{0}건', approvals.length)}</em></h2>
        </header>
        <ul className="gov-list">
          {approvals.map((row) => {
            const payload = row.payload ?? {};
            const isTask = row.action === 'create_task';
            return <li className="gov-item pending" key={row.id}>
              <div className="gov-item-top">
                <div>
                  <b>{isTask ? <ClipboardList size={12} /> : <BookOpen size={12} />} {isTask ? t("후속 카드 추가") : t("전역 스킬 저장")} — {text(payload.title) || text(payload.name)}</b>
                  <div className="gov-item-meta"><span>{row.actor}</span><span>·</span><span>{formatWhen(row.createdAt)}</span>{typeof payload.owner === 'string' && payload.owner && <><span>·</span><span>{t("담당")} {payload.owner}</span></>}</div>
                </div>
                <span className="gov-chip pending">{t("승인 대기")}</span>
              </div>
              <p className="gov-item-body">{text(payload.description) || text(payload.body)}</p>
              {rejecting?.id === row.id
                ? <div className="gov-form">
                    <input value={rejecting.reason} placeholder={t("거절 사유 (선택)")} onChange={(event) => setRejecting({ id: row.id, reason: event.target.value })}
                      onKeyDown={(event) => { if (event.key === 'Enter') void decide(row.id, 'reject', rejecting.reason); if (event.key === 'Escape') setRejecting(null); }} />
                    <div className="gov-item-actions">
                      <button className="gov-button danger" disabled={busy === row.id} onClick={() => void decide(row.id, 'reject', rejecting.reason)}><X size={13} /> {t("거절 확정")}</button>
                      <button className="gov-button ghost" onClick={() => setRejecting(null)}>{t("취소")}</button>
                    </div>
                  </div>
                : <div className="gov-item-actions">
                    <button className="gov-button ok" disabled={busy === row.id} onClick={() => void decide(row.id, 'approve')}>{busy === row.id ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />} {isTask ? t("승인하고 카드 만들기") : t("승인하고 저장")}</button>
                    <button className="gov-button" disabled={busy === row.id} onClick={() => setRejecting({ id: row.id, reason: '' })}><X size={13} /> {t("거절")}</button>
                  </div>}
            </li>;
          })}
        </ul>
      </article>}

      {pendingMemories.length > 0 && <article className="gov-card wide">
        <header className="gov-card-head">
          <h2><Brain size={16} /> {t("프로젝트 기억 승인")} <em>{tf('{0}건', pendingMemories.length)}</em></h2>
          <p>{t("에이전트가 함께 기억할 정보를 제안했습니다. 승인하면 해당 프로젝트 팀이 다음 작업부터 참고합니다.")}</p>
        </header>
        <ul className="gov-list">
          {pendingMemories.map(({ group, entry }) => <li className="gov-item pending" key={entry.id}>
            <div className="gov-item-top">
              <div>
                <b>{group.label}</b>
                <div className="gov-item-meta"><span>{entry.createdBy}</span><span>·</span><span>{formatWhen(entry.createdAt)}</span></div>
              </div>
              <span className="gov-chip pending">{t("승인 대기")}</span>
            </div>
            <p className="gov-item-body">{entry.content}</p>
            <div className="gov-item-actions">
              <button className="gov-button ok" disabled={busy === entry.id} onClick={() => void decideMemory(entry, true)}><Check size={13} /> {t("사실로 승인")}</button>
              <button className="gov-button" disabled={busy === entry.id} onClick={() => void decideMemory(entry, false)}><X size={13} /> {t("거절(삭제)")}</button>
            </div>
          </li>)}
        </ul>
      </article>}

      {history.length > 0 && <article className="gov-card wide">
        <header className="gov-card-head"><h2>{t("최근 처리")}</h2></header>
        <ul className="gov-list">
          {history.map((row) => <li className="gov-item" key={row.id}>
            <div className="gov-item-top">
              <div>
                <b>{row.summary}</b>
                <div className="gov-item-meta"><span>{row.resolvedAt ? formatWhen(row.resolvedAt) : ''}</span>{row.reason && <><span>·</span><span>{row.reason}</span></>}</div>
              </div>
              <span className={row.status === 'approved' ? 'gov-chip approve' : 'gov-chip blocked'}>{row.status === 'approved' ? t("승인됨") : t("거절됨")}</span>
            </div>
          </li>)}
        </ul>
      </article>}
    </div>
  </section>;
}
