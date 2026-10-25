@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"

if defined NODE_EXE goto have_node
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if defined NODE_EXE goto have_node
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if defined NODE_EXE goto have_node
if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if defined NODE_EXE goto have_node

echo.
echo Node.js 20+ was not found.
echo Install it from https://nodejs.org/ and run this file again.
echo.
pause
exit /b 1

:have_node
if exist "node_modules\playwright-core\package.json" goto start_app

echo.
echo Installing dependencies, please wait...
set "PNPM_JS=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
if not exist "%PNPM_JS%" goto use_npm
"%NODE_EXE%" "%PNPM_JS%" install --prod
goto check_install

:use_npm
call npm install --omit=dev

:check_install
if errorlevel 1 goto install_failed

:start_app
echo.
echo Starting Xianyu Price Ruler...
echo UI: http://127.0.0.1:7788
echo First query: scan the QR code in the browser window.
echo.
"%NODE_EXE%" server.js
if errorlevel 1 goto run_failed
goto end

:install_failed
echo.
echo Dependency install failed.
echo Please run "npm install" in this folder, then start again.
echo.
pause
exit /b 1

:run_failed
echo.
echo The app exited.
echo If port 7788 is busy, close the old process or use another port.
echo.
pause

:end
endlocal
