@echo off
setlocal
chcp 65001 >nul
title TobyFlow Studio - Windows Launcher
cd /d "%~dp0"

echo ===================================================================
echo               TOBYFLOW STUDIO - WINDOWS STANDALONE
echo ===================================================================
echo.

:: 1. Kiem tra Node.js
where node >nul 2>nul
if %errorlevel% neq 0 goto missing_node

:: 2. Kiem tra xem cong 3862 da co ung dung nao chay chua
powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3862/api/status' -TimeoutSec 2; if ($r.app -eq 'tobyflow-studio') { exit 0 }; exit 2 } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 2 goto port_used
if %errorlevel% equ 0 goto open_app

:: 3. Khoi dong server (dung cmd /k de giu lai thong tin loi neu node bi crash)
echo [*] Dang khoi dong may chu TobyFlow Studio tai cong 3862...
start "TobyFlow Studio Server" /min cmd /k "node server.js"

:: Cho server khoi dong trong 3 giay
powershell -NoProfile -Command "Start-Sleep -Seconds 3" >nul 2>&1

:: Kiem tra lai xem server da san sang chua
powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3862/api/status' -TimeoutSec 5; if ($r.app -eq 'tobyflow-studio') { exit 0 }; exit 1 } catch { exit 1 }" >nul 2>&1
if %errorlevel% neq 0 goto failed_server

:open_app
echo [*] May chu da san sang tai http://127.0.0.1:3862
echo [*] Dang mo trinh duyet...

where chrome >nul 2>nul
if %errorlevel% equ 0 (
    start chrome --app="http://127.0.0.1:3862"
) else (
    where msedge >nul 2>nul
    if %errorlevel% equ 0 (
        start msedge --app="http://127.0.0.1:3862"
    ) else (
        start "" "http://127.0.0.1:3862"
    )
)

echo.
echo ===================================================================
echo  TobyFlow Studio dang hoat dong doc lap!
echo  Dia chi truy cap: http://127.0.0.1:3862
echo  Hay giu cua so may chu dang chay trong khi su dung ung dung.
echo ===================================================================
echo.
pause
exit /b 0

:missing_node
echo.
echo [LOI] May tinh cua ban chua cai dat Node.js!
echo Vui long cai dat Node.js (ban LTS) tai https://nodejs.org/ va thu lai.
echo.
pause
exit /b 1

:port_used
echo.
echo [LOI] Cong 3862 dang bi mot ung dung khac chiem dung!
echo Vui long tat ung dung dang chay tren cong 3862 hoac thu lai.
echo.
pause
exit /b 1

:failed_server
echo.
echo [LOI] May chu khong the khoi dong sau 5 giay!
echo Vui long kiem tra cua so may chu thu nho de xem chi tiet loi.
echo Cua so se khong tu thoat de ban co the doc loi.
echo.
pause
exit /b 1
