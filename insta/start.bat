@echo off
title InstaVault Launcher
cd /d "%~dp0"

echo.
echo  InstaVault
echo  --------
echo  API:  http://localhost:3847
echo  UI:   http://localhost:5180
echo.

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm not found. Install Node.js first.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Installing backend dependencies...
    call npm install
    if errorlevel 1 goto fail
)

if not exist "frontend\node_modules\" (
    echo Installing frontend dependencies...
    cd frontend
    call npm install
    cd ..
    if errorlevel 1 goto fail
)

echo Starting API server...
start "InstaVault API" cmd /k "cd /d "%~dp0" && npm run server"

timeout /t 2 /nobreak >nul

echo Starting UI...
start "InstaVault UI" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo Both windows opened. Open http://localhost:5180 in your browser.
echo Close the API and UI windows to stop.
echo.
pause
exit /b 0

:fail
echo.
echo Startup failed.
pause
exit /b 1
