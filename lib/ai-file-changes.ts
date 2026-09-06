import type { ToolDefinition } from './claude';
import { fileSegments } from './local-files';
export type FileChange = { folderId: string; path: string; content: string };
export const FILE_CHANGE_TOOL: ToolDefinition = {
  name: 'save_project_file',
  description: '사용자가 요청한 산출물을 로컬 작업 폴더에 생성 또는 수정하도록 예약합니다. 전체 파일 내용을 전달하세요. 실제 저장은 답변 완료 후 브라우저에서 승인 설정에 따라 실행됩니다. 저장했다고 주장하지 마세요.',
  input_schema: { type: 'object', properties: { folderId: { type: 'string' }, path: { type: 'string', description: '폴더 기준 상대 경로, 예: index.html' }, content: { type: 'string', description: '생략 없는 전체 파일 내용' } }, required: ['folderId', 'path', 'content'], additionalProperties: false },
};
export function validateFileChange(raw: unknown, folderIds: string[]): FileChange {
  const value = raw as Partial<FileChange> | null;
  if (!value || typeof value.folderId !== 'string' || !folderIds.includes(value.folderId) || typeof value.path !== 'string' || typeof value.content !== 'string') throw new Error('연결된 폴더와 파일 경로, 전체 내용이 필요합니다.');
  fileSegments(value.path);
  if (new TextEncoder().encode(value.content).length > 200_000) throw new Error('파일당 200KB까지 저장할 수 있습니다.');
  return { folderId: value.folderId, path: value.path, content: value.content };
}
