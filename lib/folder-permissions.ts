export type FolderApproval = 'ask' | 'auto';
const APPROVAL_KEY = 'orbit.ai-change-approval';
// This common preference is independent of folder connections and browser permissions.
// Old folder-specific grants must not become authorization for all folders.
export function folderApproval(): FolderApproval {
  try { return localStorage.getItem(APPROVAL_KEY) === 'auto' ? 'auto' : 'ask'; } catch { return 'ask'; }
}
export function setFolderApproval(approval: FolderApproval) {
  localStorage.setItem(APPROVAL_KEY, approval);
  window.dispatchEvent(new Event("orbit-approval-changed"));
}

export function subscribeFolderApproval(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === APPROVAL_KEY || event.key === null) listener(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener('orbit-approval-changed', listener);
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('orbit-approval-changed', listener); };
}
export function serverFolderApproval(): FolderApproval { return 'ask'; }
