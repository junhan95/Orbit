# orbitcrew 로컬 에이전트 (Windows)
# 브라우저 앱(app.orbitcrew.ai)의 '폴더열기'가 http://127.0.0.1:47831 로 요청하면 실제 탐색기 창을 엽니다.
# - 외부 접속 불가: 루프백(127.0.0.1)에만 묶입니다.
# - 허용 출처(Origin)에서 온 요청만 처리하고, 할 수 있는 일은 '사용자가 직접 고른 폴더를 탐색기로 열기' 뿐입니다.
# - 폴더 id → 실제 경로 매핑은 %LOCALAPPDATA%\orbitcrew\folders.json 에 저장됩니다 (처음 한 번 폴더 선택창이 뜹니다).
$ErrorActionPreference = 'Stop'
$Version = '1.0.0'
$Port = 47831
$Allowed = @('https://app.orbitcrew.ai', 'http://localhost:3000', 'http://127.0.0.1:3000')
$Dir = Join-Path $env:LOCALAPPDATA 'orbitcrew'
$MapFile = Join-Path $Dir 'folders.json'
$LogFile = Join-Path $Dir 'agent.log'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Write-Log($text) { try { Add-Content -Path $LogFile -Value ("{0} {1}" -f (Get-Date -Format 's'), $text) -Encoding UTF8 } catch {} }

function Read-Map {
  if (-not (Test-Path $MapFile)) { return @{} }
  try {
    $obj = Get-Content $MapFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $map = @{}
    foreach ($p in $obj.PSObject.Properties) { $map[$p.Name] = [string]$p.Value }
    return $map
  } catch { return @{} }
}
function Save-Map($map) { ($map | ConvertTo-Json) | Set-Content -Path $MapFile -Encoding UTF8 }

function Select-FolderPath($hint) {
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0; Size = (New-Object System.Drawing.Size(1, 1)) }
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = "orbitcrew: 프로젝트에 연결한 '$hint' 폴더의 실제 위치를 선택하세요"
  $dialog.ShowNewFolderButton = $false
  try {
    $owner.Show(); $owner.Activate()
    if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { return $dialog.SelectedPath }
    return $null
  } finally { $owner.Close(); $owner.Dispose(); $dialog.Dispose() }
}

function Parse-Query($target) {
  $q = @{}
  $i = $target.IndexOf('?')
  if ($i -lt 0) { return $q }
  foreach ($pair in $target.Substring($i + 1) -split '&') {
    if (-not $pair) { continue }
    $kv = $pair -split '=', 2
    $q[[Uri]::UnescapeDataString($kv[0])] = if ($kv.Length -gt 1) { [Uri]::UnescapeDataString($kv[1].Replace('+', ' ')) } else { '' }
  }
  return $q
}

function Send-Response($stream, [int]$status, $body, $origin) {
  $json = if ($null -eq $body) { '' } else { $body | ConvertTo-Json -Compress }
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $reason = switch ($status) { 200 { 'OK' } 204 { 'No Content' } 400 { 'Bad Request' } 403 { 'Forbidden' } 404 { 'Not Found' } default { 'OK' } }
  $head = "HTTP/1.1 $status $reason`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n"
  if ($origin -and ($Allowed -contains $origin)) {
    $head += "Access-Control-Allow-Origin: $origin`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Allow-Methods: GET, OPTIONS`r`nAccess-Control-Allow-Headers: content-type`r`nAccess-Control-Max-Age: 600`r`nVary: Origin`r`n"
  }
  $head += "`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($bytes.Length) { $stream.Write($bytes, 0, $bytes.Length) }
  $stream.Flush()
}

function Handle-Request($method, $target, $origin) {
  $path = $target.Split('?')[0]
  if ($method -eq 'OPTIONS') { return @{ status = 204; body = $null } }
  if ($method -ne 'GET') { return @{ status = 400; body = @{ ok = $false; error = 'GET 만 지원합니다.' } } }
  if ($path -eq '/ping') { return @{ status = 200; body = @{ ok = $true; version = $Version; platform = 'windows' } } }
  if (-not ($Allowed -contains $origin)) { return @{ status = 403; body = @{ ok = $false; error = '허용되지 않은 출처입니다.' } } }
  if ($path -eq '/open') {
    $q = Parse-Query $target
    $id = [string]$q['folder']; $hint = [string]$q['name']
    if ($id -notmatch '^[A-Za-z0-9_-]{1,64}$') { return @{ status = 400; body = @{ ok = $false; error = '폴더 id 가 올바르지 않습니다.' } } }
    if (-not $hint) { $hint = $id }
    $map = Read-Map
    $folder = $map[$id]
    if (-not $folder -or -not (Test-Path -LiteralPath $folder -PathType Container)) {
      $folder = Select-FolderPath $hint
      if (-not $folder) { return @{ status = 200; body = @{ ok = $false; error = 'canceled' } } }
      $map[$id] = $folder; Save-Map $map
    }
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $folder + '"') | Out-Null
    Write-Log "open $id -> $folder"
    return @{ status = 200; body = @{ ok = $true; path = $folder } }
  }
  if ($path -eq '/forget') {
    $q = Parse-Query $target
    $id = [string]$q['folder']
    $map = Read-Map
    if ($map.ContainsKey($id)) { $map.Remove($id); Save-Map $map }
    return @{ status = 200; body = @{ ok = $true } }
  }
  return @{ status = 404; body = @{ ok = $false; error = 'not found' } }
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try { $listener.Start() } catch { Write-Log "포트 $Port 를 열지 못했습니다: $_"; exit 1 }
Write-Log "orbitcrew 로컬 에이전트 v$Version 시작 (127.0.0.1:$Port)"

while ($true) {
  $client = $null
  try {
    $client = $listener.AcceptTcpClient()
    $client.ReceiveTimeout = 3000
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 4096, $true)
    $requestLine = $reader.ReadLine()
    if (-not $requestLine) { continue }
    $headers = @{}
    while ($true) {
      $line = $reader.ReadLine()
      if ($null -eq $line -or $line -eq '') { break }
      $c = $line.IndexOf(':')
      if ($c -gt 0) { $headers[$line.Substring(0, $c).Trim().ToLowerInvariant()] = $line.Substring($c + 1).Trim() }
    }
    $parts = $requestLine -split ' '
    $method = $parts[0]; $target = if ($parts.Length -gt 1) { $parts[1] } else { '/' }
    $origin = [string]$headers['origin']
    $result = Handle-Request $method $target $origin
    Send-Response $stream $result.status $result.body $origin
  } catch {
    Write-Log "요청 처리 오류: $_"
  } finally {
    if ($client) { $client.Close() }
  }
}
