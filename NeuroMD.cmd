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

if "%~1"=="" (
  set "NEUROMD_FILE=%~dp0demo.md"
) else (
  set "NEUROMD_FILE=%~f1"
)

deno run --allow-read --allow-write="%TEMP%" --allow-net --allow-run=powershell.exe --deny-ffi "%~dp0neuromd.ts" "%NEUROMD_FILE%"
if errorlevel 1 (
  echo.
  echo NeuroMD exited with an error.
  pause
)

endlocal
