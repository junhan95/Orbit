/**
 * 에이전트 보드에 표시할 "현재 에이전트 상태".
 * 사용자가 직접 지정하는 값이 아니라, 실행 여부와 업무 상태에서 파생됩니다.
 */
export type AgentStateKey = 'running' | 'review' | 'doing' | 'idle';
export type AgentState = { key: AgentStateKey; label: string; hint: string };

type AgentStateInput = { owner: string; status: string; result?: string | null };

export function agentState(task: AgentStateInput, isRunning: boolean): AgentState {
  if (isRunning) return { key: 'running', label: '실행 중', hint: `${task.owner}가 지금 이 업무를 처리하고 있어요.` };
  if (task.status === '검토' || task.result) return { key: 'review', label: '결과 생성됨', hint: `${task.owner}가 결과를 냈고 검토를 기다리는 중이에요.` };
  if (task.status === '진행 중') return { key: 'doing', label: '진행 중', hint: `${task.owner}가 맡아 진행 중인 업무예요.` };
  return { key: 'idle', label: '대기 중', hint: `${task.owner}가 아직 실행하지 않은 업무예요.` };
}
