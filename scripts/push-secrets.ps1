# 운영 Worker 시크릿 등록 — .env 의 값을 읽어 wrangler secret put 으로 넣습니다 (값을 화면에 출력하지 않음).
# 실행: powershell -ExecutionPolicy Bypass -File scripts/push-secrets.ps1  (먼저 npm run build && node scripts/deploy.mjs config)
#   TOSS_SECRET_KEY    : 토스 승인·취소 API (베타 기간에는 테스트 키 test_sk_…)
#   ANTHROPIC_API_KEY  : 운영자 키 — 키를 등록하지 않은 사용자의 크레딧 경로 전용
$ErrorActionPreference = 'Stop'
$config = 'dist/server/wrangler.deploy.json'
if (-not (Test-Path $config)) { throw "$config 가 없습니다. 먼저 npm run build 와 node scripts/deploy.mjs config 를 실행하세요." }
$env = Get-Content .env | Where-Object { $_ -match '^\s*[A-Z_]+=' } | ForEach-Object {
  $k, $v = $_ -split '=', 2; @{ Key = $k.Trim(); Value = $v.Trim().Trim('"') }
}
foreach ($name in @('TOSS_SECRET_KEY', 'ANTHROPIC_API_KEY')) {
  $entry = $env | Where-Object { $_.Key -eq $name } | Select-Object -First 1
  if (-not $entry -or -not $entry.Value) { Write-Warning "$name 이 .env 에 없어 건너뜁니다."; continue }
  Write-Host "→ $name 등록 중 (길이 $($entry.Value.Length))"
  $entry.Value | npx wrangler secret put $name --config $config
}
Write-Host "완료. 시크릿을 넣으면 Cloudflare 가 새 버전을 자동 배포합니다. 확인: npx wrangler secret list --config $config"
