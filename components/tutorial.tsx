'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowRight } from 'lucide-react';
import { usePrefs } from '@/lib/prefs';
import { t } from '@/lib/i18n';
import { readTutorialProgress, saveTutorialProgress } from '@/lib/tutorial-progress';
import { TUTORIAL_SCENARIOS, currentTutorialScenario, startTutorialScenario } from '@/lib/tutorial-scenarios';
import { advanceTutorial, reconcileTutorialProject } from '@/lib/tutorial-flow';

export function tutorialEvent(action: string) {
  const saved = readTutorialProgress();
  if (saved !== null && saved !== 9) saveTutorialProgress(advanceTutorial(saved, action));
  window.dispatchEvent(new CustomEvent('orbit-tutorial', { detail: action }));
}

const STEPS = [
  ['프로젝트로 이동', '왼쪽 프로젝트 메뉴를 클릭하세요. 선택한 실습을 진행할 새 프로젝트를 준비합니다.', '[data-tour="nav-project"]'],
  ['연습할 프로젝트 준비', '프로젝트 만들기를 클릭해 실습용 프로젝트를 새로 만드세요.', '[data-tour="create-project"]'],
  ['프로젝트와 저장 폴더 준비', '이름 → 설명 → 폴더 선택 → 프로젝트 생성 순서로 진행하세요. Tab으로 예시를 입력한 뒤 폴더 선택에서 새 폴더를 만들거나 기존 폴더를 고르세요. 완성한 결과물을 이 폴더에 저장합니다.', '[data-tour="project-name"]'],
  ['대화 메뉴 열기', '왼쪽 대화 메뉴를 클릭하세요. 매니저에게 업무를 맡기면 필요한 팀원을 고용하고 업무를 나눕니다.', '[data-tour="nav-chat"]'],
  ['매니저를 선택하세요', '대화 화면 왼쪽에서 방금 만든 프로젝트를 고르고, 하이라이트된 프로젝트 매니저를 클릭하세요. 선택하면 다음 단계로 이동합니다.', '[data-tour="chat-manager"]'],
  ['AI 팀에 앱 제작 맡기기', '아래 예시를 입력창에 넣고 나에게 맞게 수정하세요. 입력창 옆 보내기 버튼을 직접 누르면 AI가 작업을 시작합니다. 크레딧 또는 연결한 API 사용량이 소모됩니다.', '[data-tour="chat-input"]'],
  ['팀의 작업 진행 확인', '대화의 진행 안내에서 팀원 합류, 업무 위임, 보고 도착을 확인하세요. 왼쪽 업무 목록에서도 진행 상태를 볼 수 있습니다. 매니저의 완료 안내를 기다리세요.', '.message-list'],
  ['완성 앱 저장하고 실행하기', '매니저 답변의 파일로 저장 버튼을 누르고 연결 폴더를 선택해 index.html로 저장하세요. 브라우저에서 파일을 열어 추가·완료·삭제와 새로고침 후 유지를 확인하세요. 파일 열기·편집에서 코드를 수정할 수도 있습니다. 코드가 미완성이라면 매니저에게 완성을 요청하세요.', '.message.assistant:last-of-type'],
  ['다른 작업의 정산 대기', '다른 AI 작업 또는 환불이 정산 중이라 이번 요청을 진행하지 못했습니다. 예시를 반복해서 보내지 마세요. 잠시 후 아래에서 상태를 확인하세요. 이전 요청이 일부 진행되었다면 대화와 업무 결과를 먼저 확인하세요.', '.chat-composer'],
] as const;

export function Tutorial({ onNavigate }: { onNavigate: (section: '프로젝트' | '대화') => void }) {
  const prefs = usePrefs();
  const [scenario, setScenario] = useState<(typeof TUTORIAL_SCENARIOS)[number]>(TUTORIAL_SCENARIOS[0]);
  const [choosing, setChoosing] = useState(false);
  const [step, setVisibleStep] = useState<number | null>(null);
  const setStep = useCallback((next: number | null | ((current: number) => number)) => {
    setVisibleStep(current => {
      const value = typeof next === 'function' ? next(current ?? readTutorialProgress() ?? 0) : next;
      if (value !== null) saveTutorialProgress(value);
      return value;
    });
  }, []);
  useEffect(() => {
    const progress = () => {
      const saved = readTutorialProgress();
      if (saved !== null) setVisibleStep(current => current === null ? null : saved);
    };
    window.addEventListener('orbit-tutorial', progress);
    return () => window.removeEventListener('orbit-tutorial', progress);
  }, []);
  const [jump, setJump] = useState(0);
  useEffect(() => {
    if (step === null || step > 2) return;
    let canceled = false;
    void fetch('/api/workspace').then(async response => {
      if (!response.ok) return;
      const data = await response.json() as { projects?: Array<{ id: string; name: string }> };
      if (canceled) return;
      let trackedId: string | null = null;
      try { trackedId = localStorage.getItem('orbit.tutorial-project'); } catch {}
      const next = reconcileTutorialProject(step, data.projects ?? [], trackedId);
      if (next !== step) setStep(current => reconcileTutorialProject(current, data.projects ?? [], trackedId));
    }).catch(() => {});
    return () => { canceled = true; };
  }, [step, setStep]);

  useEffect(() => {
    if (!jump || step === null || step === 9) return;
    let opened = false;
    const locate = () => {
      const target = document.querySelector<HTMLElement>(STEPS[step][2]) ?? (step === 4 ? document.querySelector<HTMLElement>('[data-tour="chat-project"]') : null);
      if (target && target.getClientRects().length) {
        observer?.disconnect();
        setJump(0);
        target.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        if (step === 0 || step === 1 || step === 3) target.click();
        else {
          const focusTarget = target.matches('input,textarea,button,select') ? target : target.querySelector<HTMLElement>('select,button,input,textarea') ?? target;
          if (!focusTarget.matches('input,textarea,button,select,a')) focusTarget.tabIndex = -1;
          focusTarget.focus({ preventScroll: true });
        }
        return true;
      }
      if (step === 2 && !opened) {
        const create = document.querySelector<HTMLButtonElement>('[data-tour="create-project"]');
        if (create) { opened = true; create.click(); }
      }
      return false;
    };
    const observer = new MutationObserver(locate);
    if (!locate()) {
      observer.observe(document.body, { childList: true, subtree: true });
      onNavigate(step <= 2 ? '프로젝트' : '대화');
    }
    const timeout = window.setTimeout(() => observer.disconnect(), 5000);
    return () => { observer.disconnect(); window.clearTimeout(timeout); };
  }, [jump, step, onNavigate, setStep]);
  const [showExplanation, setShowExplanation] = useState(false);
  const [checking, setChecking] = useState(false);
  const [billingNote, setBillingNote] = useState('');
  async function checkBilling() {
    setChecking(true);
    try {
      const response = await fetch('/api/credits?limit=1');
      if (!response.ok) throw new Error();
      const data = await response.json() as { mode: string; balance: { heldMc: number; availableMc: number } };
      if (data.mode === 'credits' && data.balance.heldMc > 0) setBillingNote(t('아직 정산 중입니다. 다른 작업이 끝난 뒤 다시 확인하세요.'));
      else if (data.mode === 'credits' && data.balance.availableMc <= 0) setBillingNote(t('사용 가능한 크레딧이 없습니다. 계정에서 잔액 또는 API 키를 확인하세요.'));
      else { setBillingNote(''); setStep((current) => current === 8 ? advanceTutorial(current, 'billing-ready') : current); }
    } catch { setBillingNote(t('상태를 확인하지 못했습니다. 잠시 후 다시 확인하세요.')); }
    finally { setChecking(false); }
  }
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (step === null || step === 9) return;
    document.body.dataset.tutorial = 'active';
    document.body.dataset.tutorialStep = String(step);
    let marked: Element | null = null;
    const update = () => {
      const focused = document.activeElement;
      const target = step === 2 && focused?.matches('[data-tour="project-name"],[data-tour="project-description"],[data-tour="project-submit"],[data-tour="project-folder"]') ? focused : document.querySelector(STEPS[step][2]) ?? (step === 4 ? document.querySelector('[data-tour="chat-project"]') : null);
      if (marked !== target) { marked?.classList.remove('tutorial-target'); marked = target; marked?.classList.add('tutorial-target');
        if (step === 4 && marked instanceof HTMLElement) marked.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      setReady(Boolean(document.querySelector('[data-tour="chat-manager"][aria-pressed="true"]')) && Boolean(document.querySelector('[data-tour="chat-input"][data-manager="true"]:not(:disabled)')));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'data-manager', 'aria-pressed'] });
    const click = (event: MouseEvent) => {
      const el = event.target as Element;
      if (step === 0 && el.closest('[data-tour="nav-project"]')) setStep(1);
      if (step === 1 && el.closest('[data-tour="create-project"]')) setStep(2);
      if (step === 3 && el.closest('[data-tour="nav-chat"]')) setStep(4);
    };
    document.addEventListener('click', click);
    document.addEventListener('focusin', update);
    return () => { observer.disconnect(); marked?.classList.remove('tutorial-target'); delete document.body.dataset.tutorial; delete document.body.dataset.tutorialStep; document.removeEventListener('focusin', update); document.removeEventListener('click', click); };
  }, [step, setStep]);
  return <>
    <button className="tutorial-trigger tutorial-label" type="button" hidden={!prefs.showTutorial} aria-label={t('튜토리얼')} title={t('시작 가이드')} onClick={() => {
      if (step !== null) { setStep(null); return; }
      const saved = readTutorialProgress();
      setScenario(currentTutorialScenario());
      const resume = saved ?? 0;
      setStep(resume);
      if (resume > 0 && resume < 9) setJump(value => value + 1);
    }}>{t('튜토리얼')}</button>
    {step !== null && createPortal(<section className="tutorial-coach" aria-label={t(scenario.label)}>
      <header><span>{t(scenario.label)} · {step === 9 ? t('완료') : step === 8 ? t('정산 대기') : `${step + 1} / 8`}</span><button aria-label={t('가이드 종료')} onClick={() => setStep(null)}><X size={18} /></button></header>
      <div aria-live="polite"><h2>{t(step === 9 ? '튜토리얼을 완료했습니다' : step === 5 ? 'AI 팀에 업무 맡기기' : step === 7 ? '결과 확인하기' : STEPS[step][0])}</h2><p>{t(step === 9 ? '이제 매니저에게 새로운 목표를 맡겨 보세요.' : step === 7 ? scenario.result : STEPS[step][1])}</p></div>
      {step === 5 && <><blockquote>{t(scenario.prompt)}</blockquote><button className="tutorial-action" disabled={!ready} onClick={() => tutorialEvent('insert-example')}>{t('예시를 입력창에 넣기')}</button></>}
      {step === 8 && <><output>{billingNote}</output><button className="tutorial-action" disabled={checking} onClick={() => void checkBilling()}>{checking ? t('확인 중') : t('정산 상태 확인')}</button></>}
      {step === 7 && <button className="tutorial-action" onClick={() => setStep(9)}>{t('결과를 확인했어요 · 완료')}</button>}
      {step === 6 && showExplanation && <div id="tutorial-work-explanation" className="tutorial-work-explanation">
        <h3>{t('지금 팀이 하는 일')}</h3>
        <p>{t('매니저가 필요한 팀원을 임명하고 업무를 나눕니다. 진행 안내에서 담당자와 업무를 확인하고, 보고가 도착하면 매니저가 결과를 검토합니다. 중간 답변은 최종 완료 안내가 아닐 수 있습니다.')}</p>
        <h3>{t('추가 업무는 어떻게 지시하나요?')}</h3>
        <p>{t('현재 답변이 끝나 입력창이 활성화되면, 매니저를 선택한 상태에서 추가할 기능이나 수정할 내용을 보내세요. 원하는 결과와 확인 기준을 함께 적으면 좋습니다.')}</p>
        <blockquote>{t(scenario.followup)}</blockquote>
        <h3>{t('결과는 어디에서 확인하나요?')}</h3>
        <p>{t('매니저의 최종 답변에서 결과와 검증 내용을 확인하세요. 왼쪽 업무 목록에서는 각 업무의 진행 상태를 볼 수 있습니다. 추가 승인이 필요하면 승인 모달의 내용을 확인하고 결정하세요.')}</p>
        <p>{t('파일 변경은 승인 요청 모드에서 승인한 뒤 저장되며, 자동 진행 모드에서는 바로 저장됩니다. 대화의 파일별 저장 완료 표시를 확인하세요. 저장 실패가 있으면 안내에 따라 재시도합니다.')}</p>
        <p>{t(scenario.result)}</p>
      </div>}
      {step === 9 && <>
        <button className="tutorial-action" aria-expanded={choosing} onClick={() => setChoosing(value => !value)}>{t('다시 하기')}</button>
        {choosing && <div className="tutorial-work-explanation"><h3>{t('다음 실습을 선택하세요')}</h3>{TUTORIAL_SCENARIOS.map(item => <button key={item.id} className="tutorial-action" style={{ marginTop: 10 }} onClick={() => {
          startTutorialScenario(item.id); setScenario(item); setChoosing(false); setShowExplanation(false); setBillingNote(''); setStep(0); onNavigate('프로젝트');
        }}>{t(item.label)}</button>)}</div>}
      </>}
      <footer className="tutorial-shortcuts">
      {step !== 9 && step !== 6 && <button className="tutorial-jump" onClick={() => setJump((value) => value + 1)}>{t('바로가기')} <ArrowRight size={14} /></button>}
      {step === 6 && <button className="tutorial-jump" aria-expanded={showExplanation} aria-controls="tutorial-work-explanation" onClick={() => setShowExplanation(value => !value)}>{t(showExplanation ? '설명 접기' : '설명보기')}</button>}
      </footer>
    </section>, document.body)}
  </>;
}
export const tutorialExample = () => t(currentTutorialScenario().prompt);
