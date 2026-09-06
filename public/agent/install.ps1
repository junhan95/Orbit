# orbitcrew 로컬 에이전트 설치 (Windows)
# 실행:  irm https://app.orbitcrew.ai/agent/install.ps1 | iex
# 하는 일: %LOCALAPPDATA%\orbitcrew 에 에이전트를 받고, 시작 프로그램에 등록한 뒤 바로 띄웁니다.
$ErrorActionPreference = 'Stop'
$Base = 'https://app.orbitcrew.ai/agent'
$Dir = Join-Path $env:LOCALAPPDATA 'orbitcrew'
$Script = Join-Path $Dir 'orbitcrew-agent.ps1'
$Startup = [Environment]::GetFolderPath('Startup')
$Shortcut = Join-Path $Startup 'orbitcrew-agent.lnk'
$PowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$Args = "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Script`""

Write-Host 'orbitcrew 로컬 에이전트를 설치합니다...'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri "$Base/orbitcrew-agent.ps1" -OutFile $Script
Invoke-WebRequest -UseBasicParsing -Uri "$Base/uninstall.ps1" -OutFile (Join-Path $Dir 'uninstall.ps1')

# 시작 프로그램 바로가기 (로그인할 때 자동 실행)
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($Shortcut)
$link.TargetPath = $PowerShell
$link.Arguments = $Args
$link.WorkingDirectory = $Dir
$link.Description = 'orbitcrew 로컬 에이전트 — 앱의 폴더열기를 탐색기로 연결'
$link.Save()

# 이미 떠 있는 예전 인스턴스는 내리고 새로 띄웁니다.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*orbitcrew-agent.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Process -FilePath $PowerShell -ArgumentList $Args -WorkingDirectory $Dir | Out-Null

Start-Sleep -Seconds 2
try {
  $ping = Invoke-RestMethod -Uri 'http://127.0.0.1:47831/ping' -TimeoutSec 5
  Write-Host "설치 완료 (v$($ping.version)). 앱에서 '폴더열기'를 누르면 탐색기가 열립니다. 처음 한 번은 폴더 위치를 묻는 창이 뜹니다."
  Write-Host "제거: powershell -ExecutionPolicy Bypass -File `"$(Join-Path $Dir 'uninstall.ps1')`""
} catch {
  Write-Warning "에이전트가 아직 응답하지 않습니다. 로그: $(Join-Path $Dir 'agent.log')"
}
