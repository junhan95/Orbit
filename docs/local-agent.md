# 로컬 에이전트 (폴더열기)

브라우저 앱은 보안상 Windows 탐색기를 직접 띄울 수 없습니다. 프로젝트 상세의 **폴더열기**는 사용자 PC 에서 도는 작은 에이전트에게 부탁해 실제 탐색기 창을 엽니다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `public/agent/orbitcrew-agent.ps1` | 에이전트 본체. `127.0.0.1:47831` 에서 HTTP(GET) 를 듣는 PowerShell 스크립트 |
| `public/agent/install.ps1` | 설치. `%LOCALAPPDATA%\orbitcrew` 에 받아 시작 프로그램 바로가기를 만들고 바로 띄움 |
| `public/agent/uninstall.ps1` | 제거 (프로세스 종료·바로가기·폴더 삭제) |
| `lib/local-agent.ts` | 앱 쪽 클라이언트 — `pingLocalAgent()`, `openFolderWithAgent(folderId, name)` |
| `components/project-files.tsx` | 결과보기·폴더열기 버튼, 설치 안내 모달 |

설치 명령 (PowerShell):

```powershell
irm https://app.orbitcrew.ai/agent/install.ps1 | iex
```

## 동작

1. 앱이 `GET /ping` 으로 에이전트 존재를 확인합니다 (1.5초 안에 응답 없으면 설치 안내 모달).
2. `GET /open?folder=<folderId>&name=<폴더명>` 을 보냅니다.
3. 에이전트는 `folders.json` 에서 `folderId → 실제 경로` 를 찾습니다. 없으면(처음이거나 폴더가 옮겨졌으면) PC 에 폴더 선택창을 띄워 사용자에게 한 번 묻고 저장합니다.
4. `explorer.exe "<경로>"` 로 탐색기를 엽니다.

브라우저의 File System Access API 는 절대 경로를 알려 주지 않기 때문에, 실제 위치는 이렇게 에이전트 쪽에서 사용자가 직접 지정합니다.

## 보안 경계

- 루프백(127.0.0.1)에만 바인드 — 다른 기기에서 접근 불가.
- `Origin` 이 `https://app.orbitcrew.ai`, `http://localhost:3000`, `http://127.0.0.1:3000` 인 요청만 처리 (`/ping` 은 예외).
- 할 수 있는 일은 "사용자가 직접 고른 폴더를 탐색기로 열기" 뿐. 파일 읽기·쓰기·삭제 없음.
- Chrome 의 Private Network Access 규칙에 맞춰 `Access-Control-Allow-Private-Network: true` 를 돌려줍니다. 브라우저가 "로컬 네트워크 접근" 을 한 번 물을 수 있습니다.

## 제한

- Windows 전용 (PowerShell 5 이상, 추가 설치 없음). macOS/Linux 는 안내 문구만 표시.
- 포트 47831 이 이미 쓰이면 에이전트가 뜨지 않습니다 — `%LOCALAPPDATA%\orbitcrew\agent.log` 확인.
- 매핑은 PC 단위(`folders.json`)라 다른 PC 에서는 다시 묻습니다.
