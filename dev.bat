@echo off
rem Start everything: gateway (port 8000) + admin console (port 3000).
rem   dev.bat         start both (in PowerShell type .\dev.bat)
rem   dev.bat seed    start both and fill the console with fake demo traffic
rem (Messages are ASCII on purpose: cmd garbles UTF-8 text depending on the console code page.)
setlocal
cd /d "%~dp0"

where python >nul 2>nul || (echo [error] Python not found. Install it from https://www.python.org & exit /b 1)
where npm >nul 2>nul || (echo [error] Node.js not found. Install the LTS version from https://nodejs.org & exit /b 1)

if not exist .venv\Scripts\python.exe (
  echo Creating Python virtual environment...
  python -m venv .venv || exit /b 1
)
echo Checking Python packages...
.venv\Scripts\python.exe -m pip install -q -r requirements-dev.txt || exit /b 1

if not exist .env copy .env.example .env >nul

if not exist frontend\node_modules (
  echo Installing frontend packages. The first run takes a few minutes...
  pushd frontend
  call npm install || exit /b 1
  popd
)

start "gateway :8000" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --env-file .env --port 8000"
start "console :3000" cmd /k "cd frontend && npm run dev"

if /i "%~1"=="seed" .venv\Scripts\python.exe -X utf8 scripts\seed_demo.py

ping -n 5 127.0.0.1 >nul
if not defined NO_BROWSER start http://localhost:3000/login

echo.
echo Running.  Console: http://localhost:3000   Gateway API docs: http://localhost:8000/docs
echo Login: admin@example.com / test1234 (a fake practice account).
echo To stop, close the two new windows.   How to test: docs\TEST_GUIDE.md
