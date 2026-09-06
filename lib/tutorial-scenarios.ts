export const TUTORIAL_SCENARIOS = [
  {
    "id": "todo",
    "label": "ToDoList 만들기",
    "name": "나의 ToDoList 앱",
    "description": "팀원을 고용해 할 일 추가·완료·삭제·목록 저장 기능을 index.html로 구현하고 검증합니다.",
    "prompt": "간단한 ToDoList 앱을 만들어 줘. 매니저가 필요한 팀원을 직접 고용하고 구현과 검증 업무를 나눠 진행해 줘. HTML, CSS, JavaScript만 사용하고 외부 라이브러리나 서버 없이 index.html 한 파일로 완성해 줘. 할 일 추가, 완료 표시, 삭제, 새로고침 후 목록 유지 기능을 넣어 줘. 팀 작업이 끝나면 실행 가능한 전체 코드를 하나의 HTML 코드 블록으로 보여 주고, 내가 선택한 폴더에 index.html로 저장해 브라우저에서 여는 방법과 검증 결과를 알려 줘.",
    "result": "저장 완료 표시를 확인한 뒤 index.html을 브라우저로 여세요. 할 일 추가·완료·삭제와 새로고침 후 목록 유지를 확인하세요.",
    "followup": "할 일 수정 기능을 추가하고 기존 기능도 다시 검증해 줘."
  },
  {
    "id": "calculator",
    "label": "간단한 계산기 만들기",
    "name": "나의 계산기",
    "description": "엔지니어와 검증 담당자가 사칙연산 계산기를 index.html 한 파일로 만들고 검증합니다.",
    "prompt": "간단한 계산기를 만들어 줘. 매니저가 엔지니어와 검증 담당자를 직접 고용하고 업무를 나눠 진행해 줘. HTML, CSS, JavaScript만 사용해 index.html 한 파일로 만들고 선택한 폴더에 저장해 줘. 사칙연산, 소수점, 초기화, 키보드 입력을 지원하고 0으로 나눌 때 오류를 안내해 줘. 완성 파일과 실행 방법, 실제로 확인한 검증 결과를 보고해 줘.",
    "result": "저장 완료 후 index.html을 브라우저로 여세요. 2+3=5, 8÷2=4, 소수점 계산, 초기화, 키보드 입력과 0으로 나누기 오류 안내를 확인하세요.",
    "followup": "계산 기록을 보여 주고 기록을 지우는 기능을 추가해 줘. 기존 계산 기능도 검증해 줘."
  },
  {
    "id": "research",
    "label": "자료 리서치",
    "name": "나의 자료 리서치",
    "description": "조사 담당자와 사실 확인 담당자가 공식 출처를 조사하고 비교 자료를 research.md로 정리합니다.",
    "prompt": "개인용 무료 할 일 관리 도구 3개를 조사해 줘. 매니저가 조사 담당자와 사실 확인 담당자를 고용해 업무를 나눠 줘. 공식 사이트를 우선 사용하고 무료 제공 범위, 지원 기기, 장단점을 비교해 줘. 각 주장에 출처 링크와 확인 날짜를 붙이고 확인하지 못한 내용은 명확히 표시해 줘. 웹 검색을 사용할 수 없으면 최신 정보라고 단정하지 말고 제한을 알려 줘. 결과를 research.md로 선택한 폴더에 저장하고 핵심 비교 결과를 대화에 보고해 줘.",
    "result": "research.md 저장 상태와 매니저의 요약을 확인하세요. 출처 링크를 열어 비교 내용과 확인 날짜를 대조하고 확인되지 않은 항목을 점검하세요.",
    "followup": "모바일에서 사용하기 쉬운 도구를 중심으로 비교를 보강해 줘. 추천 근거와 출처를 함께 알려 줘."
  },
  {
    "id": "report",
    "label": "보고서 만들기",
    "name": "나의 주간 보고서",
    "description": "작성 담당자와 검토 담당자가 제공한 메모를 주간 업무 보고서 report.md로 정리합니다.",
    "prompt": "다음 예시 메모로 주간 업무 보고서를 만들어 줘. 매니저가 작성 담당자와 검토 담당자를 직접 고용해 작성과 검토를 나눠 진행해 줘. 메모: 고객 문의 12건 처리, 도움말 문서 초안 작성, 로그인 오류 수정 진행 중, 테스트 계정 부족으로 검증 지연, 다음 주 문서 검토와 오류 재검증 예정. 완료한 일, 진행 중인 일, 문제와 지원 요청, 다음 주 계획 순서로 정리해 줘. 메모에 없는 성과나 수치, 날짜를 만들지 말고 필요한 정보는 미확인으로 표시해 줘. report.md로 선택한 폴더에 저장하고 검토 결과를 대화에 보고해 줘.",
    "result": "report.md 저장 상태를 확인하고 문서를 열어 보세요. 메모의 수치와 진행 상태가 정확한지, 문제·지원 요청·다음 주 계획이 구분되는지 확인하세요.",
    "followup": "이 보고서를 팀 회의에서 읽을 수 있는 1분 요약으로 정리해 줘. 원문에 없는 사실은 추가하지 마."
  }
] as const;
export function currentTutorialScenario() {
  try { return TUTORIAL_SCENARIOS.find(item => item.id === localStorage.getItem("orbit.tutorial-scenario")) ?? TUTORIAL_SCENARIOS[0]; } catch { return TUTORIAL_SCENARIOS[0]; }
}
export function startTutorialScenario(id: string) {
  if (!TUTORIAL_SCENARIOS.some(item => item.id === id)) return;
  localStorage.setItem("orbit.tutorial-scenario", id);
  localStorage.setItem("orbit.tutorial-project", "__new_tutorial_project__");
  localStorage.setItem("orbit.tutorial-progress.v1", "0");
}
