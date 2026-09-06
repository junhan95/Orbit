/** Serial writes keep older checkpoints from overwriting a completed reply. */
export function chatCheckpoint(write: (text: string) => Promise<void>) {
  let pending = Promise.resolve();
  return (text: string) => {
    if (!text.trim()) return pending;
    const next = pending.catch(() => {}).then(() => write(text));
    pending = next;
    // A stream callback cannot await; flush callers still receive the rejection.
    void next.catch(() => {});
    return next;
  };
}
