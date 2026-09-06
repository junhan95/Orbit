# orbitcrew 로컬 에이전트 제거
$ErrorActionPreference = 'SilentlyContinue'
$Dir = Join-Path $env:LOCALAPPDATA 'orbitcrew'
$Shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'orbitcrew-agent.lnk'
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*orbitcrew-agent.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item -Path $Shortcut -Force
Remove-Item -Path $Dir -Recurse -Force
Write-Host 'orbitcrew 로컬 에이전트를 제거했습니다.'
