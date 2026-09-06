import { expect, it } from 'vitest';
import { chatCheckpoint } from '../lib/chat-checkpoint';
it('serializes partial and final writes so a delayed partial cannot replace the final reply', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saved: string[] = [];
  const checkpoint = chatCheckpoint(async text => { if (text === 'partial') await gate; saved.push(text); });
  const first = checkpoint('partial');
  const final = checkpoint('complete');
  await Promise.resolve();
  expect(saved).toEqual([]);
  release();
  await Promise.all([first, final]);
  expect(saved).toEqual(['partial', 'complete']);
});
it('can save an interrupted reply after an earlier checkpoint write fails', async () => {
  const saved: string[] = [];
  const checkpoint = chatCheckpoint(async text => { if (text === 'fail') throw new Error('db'); saved.push(text); });
  await expect(checkpoint('fail')).rejects.toThrow('db');
  await checkpoint('interrupted reply');
  expect(saved).toEqual(['interrupted reply']);
});
