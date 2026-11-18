# TobyFlow Studio - PowerShell Launcher
$ErrorActionPreference = "Stop"

Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "               TOBYFLOW STUDIO - WINDOWS STANDALONE               " -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[LỖI] Máy tính chưa có Node.js! Vui lòng tải tại https://nodejs.org/" -ForegroundColor Red
    Pause
    Exit
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Check if port 3862 is already running TobyFlow Studio
try {
    $res = Invoke-RestMethod -Uri "http://127.0.0.1:3862/api/status" -TimeoutSec 2
    if ($res.app -eq "tobyflow-studio") {
        Write-Host "[*] Máy chủ đã đang chạy tại http://127.0.0.1:3862" -ForegroundColor Green
    }
} catch {
    Write-Host "[*] Đang khởi động máy chủ tại cổng 3862..." -ForegroundColor Green
    Start-Process node -ArgumentList "server.js" -WindowStyle Minimized
    Start-Sleep -Seconds 2
}

$AppUrl = "http://127.0.0.1:3862"
if (Get-Command chrome -ErrorAction SilentlyContinue) {
    Start-Process chrome -ArgumentList "--app=$AppUrl"
} elseif (Get-Command msedge -ErrorAction SilentlyContinue) {
    Start-Process msedge -ArgumentList "--app=$AppUrl"
} else {
    Start-Process $AppUrl
}

Write-Host "[*] Ứng dụng đã mở tại $AppUrl" -ForegroundColor Green
Write-Host "[*] Bạn có thể sử dụng hoàn toàn độc lập mà không cần Antigravity." -ForegroundColor Yellow
Write-Host "===================================================================" -ForegroundColor Cyan
