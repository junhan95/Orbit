'use client';
/**
 * 프로젝트 상세 머리의 '결과보기' · '폴더열기'.
 * - 결과보기: 에이전트가 이 브라우저에서 저장한 최신 산출물(lib/project-artifacts)을 새 탭에서 바로 실행합니다 — 목록 창 없이 결과 화면이 뜹니다.
 *   HTML·이미지·PDF 가 아니면(예: research.md) 텍스트 미리보기 창으로 보여 줍니다.
 * - 폴더열기: 사용자 PC 의 로컬 에이전트(lib/local-agent)를 통해 실제 탐색기 창을 엽니다. 에이전트가 없으면 설치 안내를 띄웁니다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, FolderOpen, LoaderCircle, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ensureReadPermission, fetchProjectFolders, getHandle, type FsDirHandle, type ProjectFolder } from '@/lib/folder-access';
import { fileSegments, readLocalFile } from '@/lib/local-files';
import { isBrowserViewable, mimeOf, readArtifacts, subscribeArtifacts, type ProjectArtifact } from '@/lib/project-artifacts';
import { LOCAL_AGENT_INSTALL_COMMAND, isWindowsBrowser, openFolderWithAgent, pingLocalAgent } from '@/lib/local-agent';
import { t, tf } from '@/lib/i18n';

export function useProjectArtifacts(projectId: string): ProjectArtifact[] {
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);
  useEffect(() => {
    const refresh = () => setArtifacts(readArtifacts(projectId));
    refresh();
    return subscribeArtifacts(refresh);
  }, [projectId]);
  return artifacts;
}

async function folderHandle(folderId: string): Promise<FsDirHandle> {
  const handle = await getHandle(folderId);
  if (!handle || !await ensureReadPermission(handle)) throw new Error(t('프로젝트의 작업 폴더에서 이 폴더를 다시 연결해 주세요.'));
  return handle;
}

/** 바이너리까지 그대로 읽습니다 (이미지·PDF 를 새 탭에 띄울 때). */
async function readFile(root: FsDirHandle, path: string): Promise<File> {
  const parts = fileSegments(path);
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  return (await dir.getFileHandle(parts[parts.length - 1])).getFile();
}

/** 산출물을 새 탭에서 엽니다. 팝업 차단을 피하려고 클릭 동기 구간에서 창을 먼저 열고, 파일을 읽은 뒤 주소를 바꿉니다. */
async function openInNewTab(folderId: string, path: string) {
  const tab = window.open('', '_blank');
  try {
    const file = await readFile(await folderHandle(folderId), path);
    const url = URL.createObjectURL(new Blob([await file.arrayBuffer()], { type: mimeOf(path) }));
    if (tab) tab.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) { tab?.close(); throw error; }
}

type Preview = { path: string; text: string };
type Panel = { kind: 'preview'; preview: Preview } | { kind: 'install' } | { kind: 'choose'; folders: ProjectFolder[] } | null;

export function ProjectFileButtons({ projectId, onNotice }: { projectId: string; onNotice: (message: string) => void }) {
  const artifacts = useProjectArtifacts(projectId);
  const [busy, setBusy] = useState<'results' | 'folder' | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  const fail = useCallback((error: unknown, fallback: string) => {
    onNotice(error instanceof Error ? t(error.message) : fallback);
  }, [onNotice]);

  /** 결과보기 — 가장 최근 산출물을 바로 띄웁니다. */
  async function showResult() {
    if (busy) return;
    setBusy('results');
    try {
      const linked = await fetchProjectFolders(projectId);
      const available = artifacts.filter(item => linked.some(folder => folder.id === item.folderId));
      const latest = available[0];
      if (!latest) { onNotice(t('저장된 산출물이 아직 없습니다.')); return; }
      if (isBrowserViewable(latest.path)) { await openInNewTab(latest.folderId, latest.path); return; }
      const text = await readLocalFile(await folderHandle(latest.folderId), latest.path);
      setPanel({ kind: 'preview', preview: { path: latest.path, text } });
    } catch (error) { fail(error, t('파일을 열지 못했습니다.')); }
    finally { setBusy(null); }
  }

  /** 폴더열기 — 로컬 에이전트로 탐색기를 엽니다. */
  async function openFolder(folder?: ProjectFolder) {
    if (busy) return;
    setBusy('folder');
    try {
      const linked = folder ? [folder] : await fetchProjectFolders(projectId);
      if (!linked.length) { onNotice(t('아직 연결한 작업 폴더가 없습니다. 아래 작업 폴더 섹션의 폴더 추가로 먼저 연결해 주세요.')); return; }
      if (linked.length > 1) { setPanel({ kind: 'choose', folders: linked }); return; }
      const target = linked[0];
      if (!await pingLocalAgent()) { setPanel({ kind: 'install' }); return; }
      const result = await openFolderWithAgent(target.id, target.name);
      if (result.ok) { setPanel(null); return; }
      if (result.error === 'canceled') { onNotice(t('폴더 선택을 취소했습니다.')); return; }
      onNotice(tf('탐색기를 열지 못했습니다: {0}', result.error));
    } catch { setPanel({ kind: 'install' }); }
    finally { setBusy(null); }
  }

  return <div className="detail-file-actions">
    <Button variant="outline" disabled={!artifacts.length || busy !== null} onClick={() => void showResult()}
      title={artifacts.length ? undefined : t('에이전트가 작업을 완료하고 파일을 저장하면 열 수 있습니다.')}>
      {busy === 'results' ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} {t('결과보기')}{artifacts.length > 0 && <em className="detail-file-count">{artifacts.length}</em>}
    </Button>
    <Button variant="outline" disabled={busy !== null} onClick={() => void openFolder()}>
      {busy === 'folder' ? <LoaderCircle size={14} className="spin" /> : <FolderOpen size={14} />} {t('폴더열기')}
    </Button>
    <ProjectFilesPanel panel={panel} onClose={() => setPanel(null)} onChoose={(folder) => { setPanel(null); void openFolder(folder); }} />
  </div>;
}

function ProjectFilesPanel({ panel, onClose, onChoose }: { panel: Panel; onClose: () => void; onChoose: (folder: ProjectFolder) => void }) {
  const [copied, setCopied] = useState(false);
  const copyCommand = async () => {
    try { await navigator.clipboard.writeText(LOCAL_AGENT_INSTALL_COMMAND); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* 클립보드가 막혀 있으면 사용자가 직접 복사합니다. */ }
  };
  return <Dialog open={panel !== null} onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent className="project-files-dialog">
      {panel?.kind === 'preview' && <>
        <DialogHeader><DialogTitle>{panel.preview.path}</DialogTitle><DialogDescription>{t('브라우저에서 바로 실행할 수 없는 형식이라 내용을 보여 줍니다.')}</DialogDescription></DialogHeader>
        <div className="project-files-preview"><pre>{panel.preview.text}</pre></div>
      </>}
      {panel?.kind === 'choose' && <>
        <DialogHeader><DialogTitle>{t('어느 폴더를 열까요?')}</DialogTitle><DialogDescription>{t('이 프로젝트에 연결한 폴더가 여러 개입니다.')}</DialogDescription></DialogHeader>
        <ul className="project-files-list">
          {panel.folders.map((folder) => <li key={folder.id}><button onClick={() => onChoose(folder)}><FolderOpen size={14} /><span><b>{folder.name}</b><small>{tf('파일 {0}개', folder.fileCount)}</small></span></button></li>)}
        </ul>
      </>}
      {panel?.kind === 'install' && <>
        <DialogHeader><DialogTitle>{t('로컬 에이전트 설치')}</DialogTitle><DialogDescription>{t('브라우저는 탐색기를 직접 열 수 없습니다. 내 PC 에 작은 에이전트를 한 번 설치하면 폴더열기가 실제 탐색기 창을 엽니다.')}</DialogDescription></DialogHeader>
        {isWindowsBrowser()
          ? <ol className="project-files-steps">
            <li>{t('Windows 검색에서 PowerShell 을 열고 아래 명령을 붙여 넣어 실행하세요.')}
              <div className="project-files-command"><code>{LOCAL_AGENT_INSTALL_COMMAND}</code><button onClick={() => void copyCommand()} aria-label={t('명령 복사')}>{copied ? <Check size={14} /> : <Copy size={14} />}</button></div>
            </li>
            <li>{t('설치가 끝나면 다시 폴더열기를 누르세요. 처음 한 번은 연결한 폴더의 실제 위치를 묻는 창이 PC 에 뜹니다.')}</li>
          </ol>
          : <p className="project-files-empty">{t('로컬 에이전트는 현재 Windows 만 지원합니다.')}</p>}
        <p className="project-files-note">{t('에이전트는 내 PC 안(127.0.0.1)에서만 듣고, 이 앱에서 온 요청으로 사용자가 직접 고른 폴더를 탐색기로 여는 일만 합니다.')} <a href="/agent/orbitcrew-agent.ps1" target="_blank" rel="noreferrer"><ExternalLink size={12} /> {t('소스 보기')}</a></p>
      </>}
    </DialogContent>
  </Dialog>;
}
