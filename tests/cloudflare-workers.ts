// Test-only runtime binding; no production environment or credentials are loaded.
export const env: Record<string, string | undefined> = {};
const pending: Promise<unknown>[] = [];
export function waitUntil(promise: Promise<unknown>) { pending.push(promise); }
export async function drainBackground() { while (pending.length) await Promise.allSettled(pending.splice(0)); }
