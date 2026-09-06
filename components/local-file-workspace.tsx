'use client';
import { useState } from 'react';
import { FolderOpen, Save } from 'lucide-react';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { fetchProjectFolders, getHandle, scanDirectory, ensureReadPermission, type FsDirHandle, type ProjectFolder, type ScannedFile } from '@/lib/folder-access';
import { codeFiles, readLocalFile, saveLocalFile } from '@/lib/local-files';

import { t } from '@/lib/i18n';

export function LocalFileWorkspace({ projectId, initial }: { projectId: string; initial?: { name: string; content: string } }) {
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [folderId, setFolderId] = useState('');
  const [handle, setHandle] = useState<FsDirHandle | null>(null);
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [path, setPath] = useState(initial?.name ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [original, setOriginal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState(false);
  const dirty = original === null ? Boolean(content) : content !== original;
  const discard = () => !dirty || window.confirm(t('저장하지 않은 변경을 버리시겠습니까?'));
  async function show(value: boolean) {
    if (!value) { if (!busy && discard()) setOpen(false); return; }
    setOpen(true); setBusy(true); setNote(''); setFailed(false); setHandle(null); setFolderId(''); setFiles([]);
    setPath(initial?.name ?? ''); setContent(initial?.content ?? ''); setOriginal(null);
    try { setFolders(await fetchProjectFolders(projectId)); } finally { setBusy(false); }
  }
  async function choose(id: string) {
    if (handle && !discard()) return;
    setBusy(true); setNote(''); setFailed(false); setFolderId(id); setHandle(null); setFiles([]); setOriginal(null);
    setContent(initial?.content ?? ''); setPath(initial?.name ?? '');
    try {
      const next = await getHandle(id);
      if (!next || !await ensureReadPermission(next)) throw new Error(t('프로젝트의 작업 폴더에서 이 폴더를 다시 연결해 주세요.'));
      setHandle(next);
      const result = await scanDirectory(next); setFiles(result.files.filter(file => file.readable));
      if (result.truncated) setNote(t('파일 목록이 일부만 표시됩니다. 파일 경로를 직접 입력해 열 수 있습니다.'));
    } catch (error) { setFailed(true); setNote(error instanceof Error ? t(error.message) : t('폴더를 열지 못했습니다.')); }
    finally { setBusy(false); }
  }
  async function read(name: string) {
    if (!handle || !discard()) return;
    setBusy(true); setFailed(false); setNote('');
    try { const text = await readLocalFile(handle, name); setPath(name); setContent(text); setOriginal(text); }
    catch (error) { setFailed(true); setNote(error instanceof Error ? t(error.message) : t('파일을 열지 못했습니다.')); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!handle) return;
    setBusy(true); setFailed(false); setNote('');
    try { await saveLocalFile(handle, path, content, original); setOriginal(content); setNote(t('선택한 폴더에 파일을 저장했습니다.')); setFiles((await scanDirectory(handle)).files.filter(file => file.readable)); }
    catch (error) { setFailed(true); setNote(error instanceof Error ? t(error.message) : t('파일을 저장하지 못했습니다.')); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(value) => void show(value)}>
    <DialogTrigger render={<button aria-label={initial ? `${t('파일로 저장')} · ${initial.name}` : t('파일 열기·편집')} className="local-files-trigger" disabled={!projectId} />}><FolderOpen size={15} /> {initial ? `${t('파일로 저장')} · ${initial.name}` : t('파일 열기·편집')}</DialogTrigger>
    <DialogContent className="local-file-dialog">
      <DialogHeader><DialogTitle>{t('작업 폴더 파일')}</DialogTitle><DialogDescription>{t('연결한 폴더의 텍스트 파일을 읽고 편집하거나 새 파일을 저장합니다. 저장할 때 브라우저에서 쓰기 권한을 요청할 수 있습니다.')}</DialogDescription></DialogHeader>
      <label>{t('저장 폴더')}<select value={folderId} disabled={busy} onChange={(event) => void choose(event.target.value)}><option value="">{t('폴더 선택')}</option>{folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      {!folders.length && <p>{t('프로젝트에서 작업 폴더를 먼저 연결해 주세요. Chrome 또는 Edge에서 사용할 수 있습니다.')}</p>}
      <div className="local-file-grid">
        <nav aria-label={t('파일 목록')}>{files.map(f => <button key={f.path} disabled={busy} onClick={() => void read(f.path)}>{f.path}</button>)}</nav>
        <div className="local-file-editor">
          <label>{t('파일 경로')}<input value={path} disabled={busy || original !== null} onChange={e => setPath(e.target.value)} data-tab-example="index.html" placeholder="index.html" /></label>
          <div className="local-file-actions"><button disabled={busy || !handle || !path} onClick={() => void read(path)}>{t('파일 열기')}</button><button disabled={busy} onClick={() => { if (discard()) { setOriginal(null); setPath(''); setContent(''); } }}>{t('새 파일')}</button></div>
          <div>{initial && original !== null && <button disabled={busy} onClick={() => setContent(initial.content)}>{t('AI 코드로 교체')}</button>}</div><textarea aria-label={t('파일 내용')} spellCheck={false} value={content} disabled={busy || !handle} onChange={e => setContent(e.target.value)} />
        </div>
      </div>
      <output className={failed ? 'local-file-error' : ''}>{note}</output>
      <button className="tutorial-action" disabled={busy || !handle || !path.trim()} onClick={() => void save()}><Save size={15} /> {busy ? t('처리 중') : t('폴더에 저장')}</button>
    </DialogContent>
  </Dialog>;
}
export function SaveCodeFiles({ projectId, message }: { projectId: string; message: string }) {
  return <div className="code-file-actions">{codeFiles(message).map((file, i) => <LocalFileWorkspace key={i} projectId={projectId} initial={file} />)}</div>;
}

