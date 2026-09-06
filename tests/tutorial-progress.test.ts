import { afterEach, expect, it, vi } from 'vitest';
import { readTutorialProgress, saveTutorialProgress } from '../lib/tutorial-progress';
import { currentTutorialScenario, startTutorialScenario, TUTORIAL_SCENARIOS } from '../lib/tutorial-scenarios';
import { reconcileTutorialProject } from '../lib/tutorial-flow';
import { advanceTutorial } from '../lib/tutorial-flow';
afterEach(() => vi.unstubAllGlobals());
it('persists the next required step across closing and remounting', () => {
  const data = new Map<string,string>();
  vi.stubGlobal('localStorage', { getItem: (key:string) => data.get(key) ?? null, setItem: (key:string,value:string) => data.set(key,value) });
  expect(readTutorialProgress()).toBe(null);
  saveTutorialProgress(4);
  saveTutorialProgress(advanceTutorial(readTutorialProgress()!, 'manager-selected'));
  expect(readTutorialProgress()).toBe(5);
  saveTutorialProgress(6);
  saveTutorialProgress(advanceTutorial(readTutorialProgress()!, 'reply-ready'));
  expect(readTutorialProgress()).toBe(7);
  saveTutorialProgress(9);
  expect(readTutorialProgress()).toBe(9);
});
it('rejects corrupt or out-of-range saved progress', () => {
  for(const raw of ['invalid', 'null', '25', '-1', '1.5', '"4"']) {
    vi.stubGlobal('localStorage', { getItem: () => raw });
    expect(readTutorialProgress()).toBe(null);
  }
});

it('starts each new exercise without reusing the completed project and resumes the chosen example', () => {
  const data = new Map<string,string>();
  vi.stubGlobal('localStorage', { getItem: (key:string) => data.get(key) ?? null, setItem: (key:string,value:string) => data.set(key,value) });
  for (const scenario of TUTORIAL_SCENARIOS) {
    saveTutorialProgress(9);
    data.set('orbit.tutorial-project', 'old');
    startTutorialScenario(scenario.id);
    expect(readTutorialProgress()).toBe(0);
    expect(currentTutorialScenario()).toEqual(scenario);
    expect(reconcileTutorialProject(0, [{ id: 'old', name: '나의 ToDoList 앱' }], data.get('orbit.tutorial-project')!)).toBe(0);
    data.set('orbit.tutorial-project', 'new');
    expect(reconcileTutorialProject(2, [{ id: 'new', name: scenario.name }], data.get('orbit.tutorial-project')!)).toBe(3);
    saveTutorialProgress(5);
    expect(currentTutorialScenario().prompt).toBe(scenario.prompt);
    expect(readTutorialProgress()).toBe(5);
  }
});
