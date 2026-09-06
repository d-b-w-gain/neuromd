@echo off
setlocal

where deno.exe >nul 2>nul
if errorlevel 1 (
  echo NeuroMD could not find Deno.
  echo Close and reopen Windows Terminal after installing Deno, then try again.
  echo.
  pause
  exit /b 1
)

deno run --allow-read="%~dp0" --allow-run=reg.exe,explorer.exe "%~dp0register.ts"
if errorlevel 1 (
  echo.
  echo NeuroMD registration failed.
  pause
  exit /b 1
)

endlocal

