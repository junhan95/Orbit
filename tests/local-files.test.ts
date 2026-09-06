import { applyFileRows, type FileRow } from '../lib/ai-file-storage';
import { expect, it } from 'vitest';
import { codeFiles, fileSegments, readLocalFile, saveLocalFile } from '../lib/local-files';
import type { FsDirHandle } from '../lib/folder-access';
function folder(permission: PermissionState = 'granted') {
  const files = new Map<string, string>();
  const root = {
    queryPermission: async () => permission, requestPermission: async () => permission,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!files.has(name)) { if (!options?.create) throw new DOMException('missing', 'NotFoundError'); files.set(name, ''); }
      return { getFile: async () => new File([files.get(name)!], name), createWritable: async () => {
        let draft = ''; return { write: async (text: string) => { draft = text; }, close: async () => { files.set(name, draft); }, abort: async () => {} };
      } };
    },
  } as unknown as FsDirHandle;
  return { root, files };
}
it('creates then reads and modifies a real text payload through the handle interface', async () => {
  const { root, files } = folder();
  await saveLocalFile(root, 'index.html', '<h1>Hello</h1>', null);
  const original = await readLocalFile(root, 'index.html');
  await saveLocalFile(root, 'index.html', '<h1>Updated</h1>', original);
  expect(files.get('index.html')).toBe('<h1>Updated</h1>');
});
it('rejects stale edits and accidental overwrite of an existing file', async () => {
  const { root, files } = folder(); files.set('app.js', 'other edit');
  await expect(saveLocalFile(root, 'app.js', 'overwrite', 'old')).rejects.toThrow();
  await expect(saveLocalFile(root, 'app.js', 'overwrite', null)).rejects.toThrow();
  expect(files.get('app.js')).toBe('other edit');
});
it('does not create a file when write permission is denied', async () => {
  const { root, files } = folder('denied');
  await expect(saveLocalFile(root, 'a.txt', 'hello', null)).rejects.toThrow();
  expect(files.size).toBe(0);
});
it('rejects traversal, absolute paths, secrets and platform aliases', () => {
  for (const name of ['../x', '/x', 'C:/x', 'a/../b', '.env', '.git/config', 'a\\b', 'CON.txt', 'x.key', 'a/b.', 'x:stream']) expect(() => fileSegments(name)).toThrow();
  expect(fileSegments('src/app.js')).toEqual(['src', 'app.js']);
});
it('offers generated code as files without executing it', () => {
  expect(codeFiles('```html\n<h1>Hello</h1>\n```')[0]).toEqual({ name: 'index.html', content: '<h1>Hello</h1>\n' });
  expect(codeFiles('plain text')).toEqual([]);
});

it('queues without approval, saves after approval, and never replays saved rows', async () => {
  const { root, files } = folder();
  const roots = [{ id: 'f', handle: root, originals: new Map<string, string>() }];
  const rows: FileRow[] = [{ change: { folderId: 'f', path: 'index.html', content: 'app' }, status: 'pending' }];
  await applyFileRows(rows, roots, false);
  expect(files.size).toBe(0);
  await applyFileRows(rows, roots, true);
  expect(files.get('index.html')).toBe('app');
  files.set('index.html', 'user edit after save');
  await applyFileRows(rows, roots, true);
  expect(files.get('index.html')).toBe('user edit after save');
});
it('reports partial failure and preserves concurrent edits during automatic saving', async () => {
  const { root, files } = folder(); files.set('old.txt', 'concurrent');
  const rows: FileRow[] = [
    { change: { folderId: 'f', path: 'old.txt', content: 'AI' }, status: 'pending' },
    { change: { folderId: 'f', path: 'new.txt', content: 'new' }, status: 'pending' },
  ];
  await applyFileRows(rows, [{ id: 'f', handle: root, originals: new Map([['old.txt', 'original']]) }], true);
  expect(rows.map(row => row.status)).toEqual(['error', 'saved']);
  expect(files.get('old.txt')).toBe('concurrent');
  expect(files.get('new.txt')).toBe('new');
});
