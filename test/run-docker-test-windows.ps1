# Run ClawRouter tests in Windows Docker container
# NOTE: This requires Windows containers to be enabled in Docker Desktop
# On Windows: Switch to Windows containers via Docker Desktop

Write-Host "🐳 Building Windows Docker test environment..." -ForegroundColor Cyan
docker build -f test/Dockerfile.windows -t clawrouter-test-windows .

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker build failed" -ForegroundColor Red
    exit 1
}

Write-Host "`n🧪 Running model selection tests..." -ForegroundColor Cyan
docker run --rm `
    -v "${PWD}/test/test-model-selection.ps1:C:\test.ps1" `
    clawrouter-test-windows `
    powershell -ExecutionPolicy Bypass -File C:\test.ps1

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Tests failed" -ForegroundColor Red
    exit 1
}

Write-Host "`n✅ Docker tests completed successfully!" -ForegroundColor Green
