export const TUTORIAL_PROGRESS_KEY = 'orbit.tutorial-progress.v1';
export function readTutorialProgress(): number | null {
  try {
    const raw = localStorage.getItem(TUTORIAL_PROGRESS_KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 9 ? value : null;
  } catch { return null; }
}
export function saveTutorialProgress(step: number) {
  try { localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify(step)); } catch { /* Session state still works if storage is unavailable. */ }
}
