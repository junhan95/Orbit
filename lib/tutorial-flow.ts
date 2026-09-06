export function advanceTutorial(step: number, action: string): number {
  if (step === 4 && action === 'manager-selected') return 5;
  if (step >= 0 && step <= 2 && action === 'project-created') return 3;
  if ((step === 6 || step === 7) && action === 'billing-busy') return 8;
  if (step === 8 && action === 'billing-ready') return 5;
  if (step === 5 && action === 'message-sent') return 6;
  if (step === 6 && action === 'reply-ready') return 7;
  if ((step === 6 || step === 7) && action === 'message-failed') return 5;
  return step;
}

export function reconcileTutorialProject(step: number, projects: Array<{ id: string; name: string }>, trackedId: string | null): number {
  if (step > 2) return step;
  const exists = trackedId ? projects.some(project => project.id === trackedId) : projects.some(project => ['나의 ToDoList 앱', 'My ToDoList app', 'My ToDoList App'].includes(project.name));
  return exists ? 3 : step;
}
