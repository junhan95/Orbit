import { describe, it, expect } from 'vitest';
import { advanceTutorial, reconcileTutorialProject } from '../lib/tutorial-flow';
describe('guided practice progress', () => {
  it('requires a newly submitted message before accepting a reply', () => {
    expect(advanceTutorial(5, 'reply-ready')).toBe(5);
    const waiting = advanceTutorial(5, 'message-sent');
    expect(waiting).toBe(6);
    expect(advanceTutorial(waiting, 'reply-ready')).toBe(7);
  });
  it('keeps failed requests retryable instead of completing the guide', () => {
    expect(advanceTutorial(6, 'message-failed')).toBe(5);
    expect(advanceTutorial(7, 'message-failed')).toBe(5);
    expect(advanceTutorial(5, 'insert-example')).toBe(5);
  });
  it('only leaves project creation on successful creation', () => {
    expect(advanceTutorial(2, 'project-created')).toBe(3);
    expect(advanceTutorial(2, 'message-failed')).toBe(2);
  });
});

it('pauses on billing contention without returning to the example loop', () => {
  expect(advanceTutorial(6, 'billing-busy')).toBe(8);
  expect(advanceTutorial(8, 'message-sent')).toBe(8);
  expect(advanceTutorial(8, 'reply-ready')).toBe(8);
  expect(advanceTutorial(8, 'billing-ready')).toBe(5);
});

it('advances only the manager-selection step on a manager click', () => {
  expect(advanceTutorial(4, 'manager-selected')).toBe(5);
  expect(advanceTutorial(4, 'agent-selected')).toBe(4);
  expect(advanceTutorial(3, 'manager-selected')).toBe(3);
  expect(advanceTutorial(5, 'manager-selected')).toBe(5);
});

it('reconciles stale creation steps with the actual tutorial project', () => {
  const projects = [{ id: 'p', name: '나의 ToDoList 앱' }];
  expect(reconcileTutorialProject(1, projects, null)).toBe(3);
  expect(reconcileTutorialProject(2, [{ id: 'p', name: 'Renamed' }], 'p')).toBe(3);
  expect(reconcileTutorialProject(1, [], 'p')).toBe(1);
  expect(reconcileTutorialProject(1, [{ id: 'q', name: 'Unrelated' }], null)).toBe(1);
  expect(reconcileTutorialProject(6, projects, 'p')).toBe(6);
});
