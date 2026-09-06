'use client';
import { useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { currentTutorialScenario } from '@/lib/tutorial-scenarios';
import { t } from '@/lib/i18n';

function subscribeTutorial(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-tutorial-step'] });
  return () => observer.disconnect();
}
const isProjectTutorial = () => document.body.dataset.tutorialStep === '2';
const serverTutorial = () => false;

export function ProjectTutorialFields({ name, description, onName, onDescription }: {
  name: string; description: string; onName: (value: string) => void; onDescription: (value: string) => void;
}) {
  const tutorial = useSyncExternalStore(subscribeTutorial, isProjectTutorial, serverTutorial);
  const scenario = currentTutorialScenario();
  const [field, setField] = useState('name');
  function complete(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, value: string, set: (value: string) => void, example: string) {
    if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || document.body.dataset.tutorialStep !== '2') return;
    if (!value.trim()) set(t(example));
    // Guide Tab from the description to the output folder picker.
    if (event.currentTarget.dataset.tour === 'project-description') {
      const submit = document.querySelector<HTMLButtonElement>('[data-tour="project-folder"]');
      if (submit && !submit.disabled) { event.preventDefault(); submit.focus(); }
    }
  }
  return <>
    <p className="tutorial-field-hint" aria-live="polite">{field === 'name'
      ? t('1. Tab을 눌러 표시된 프로젝트 이름을 입력하고 설명으로 이동하세요.')
      : t('2. Tab으로 제작 목표를 입력한 뒤 폴더 선택을 누르세요. 선택 창에서 새 폴더를 만들거나 기존 폴더를 고르세요. 선택 후 프로젝트 생성을 누릅니다.')}</p>
    <label className="entity-field"><span>{t('프로젝트 이름')}</span><input data-tour="project-name" value={name} onFocus={() => setField('name')} onChange={(event) => onName(event.target.value)} onKeyDown={(event) => complete(event, name, onName, scenario.name)} placeholder={t(tutorial ? scenario.name : '예: 신규 서비스 출시')} /></label>
    <label className="entity-field"><span>{t('설명')}</span><textarea data-tour="project-description" value={description} onFocus={() => setField('description')} onChange={(event) => onDescription(event.target.value)} onKeyDown={(event) => complete(event, description, onDescription, scenario.description)} rows={tutorial ? 5 : 3} placeholder={t(tutorial ? scenario.description : '달성하려는 목표를 간단히 적어주세요.')} /></label>
  </>;
}
