@echo off
title Viewer Launcher
cd /d "%~dp0"

start "Viewer - Backend" cmd /k "cd /d ""%~dp0backend"" && python app.py"
start "Viewer - Frontend" cmd /k "cd /d ""%~dp0frontend"" && npm run dev -- --host"

echo.
echo  Viewer is starting...
echo  Local:   http://localhost:5173
echo  Network: check the Frontend window for your PC's IP
echo.
pause
