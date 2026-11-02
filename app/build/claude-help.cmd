@echo off
rem claude-help command line: run src/cli.js with the app's bundled runtime in Node mode
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0Claude Help.exe" "%~dp0resources\app.asar\src\cli.js" %*
endlocal & exit /b %ERRORLEVEL%
