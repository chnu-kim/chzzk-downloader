# PowerShell 래퍼. 구현은 public-scan.mjs 하나다.
# 사용: pwsh scripts/ci/public-scan.ps1 [--all-history]
node "$PSScriptRoot/public-scan.mjs" @args
exit $LASTEXITCODE
