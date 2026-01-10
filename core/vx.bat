@echo off
:: Vexon CLI Wrapper v0.4.1
:: Supports: run, compile, debug, typecheck

:: Set the VEXON_HOME environment variable if not set
if "%VEXON_HOME%"=="" set VEXON_HOME=C:\Vexon

:: Check if vexon_cli.js exists
if not exist "%VEXON_HOME%\vexon_cli.js" (
    echo ❌ Vexon not found at %VEXON_HOME%
    echo Please set VEXON_HOME environment variable to the correct path
    exit /b 1
)

IF "%~1"=="" (
    node "%VEXON_HOME%\vexon_cli.js"
    EXIT /B %ERRORLEVEL%
)

SET ATTR=%~1

:: Check if the first argument is a known subcommand
IF "%ATTR%"=="run" GOTO PASS_THROUGH
IF "%ATTR%"=="compile" GOTO PASS_THROUGH
IF "%ATTR%"=="debug" GOTO PASS_THROUGH
IF "%ATTR%"=="typecheck" GOTO PASS_THROUGH
IF "%ATTR%"=="check" GOTO PASS_THROUGH

:: If no subcommand is detected, check if it's a .vx file
echo %ATTR% | findstr /r "\.vx$" >nul
if %ERRORLEVEL% equ 0 (
    :: It's a .vx file, default to 'run'
    node "%VEXON_HOME%\vexon_cli.js" run %*
    EXIT /B %ERRORLEVEL%
)

:: Unknown command
echo Unknown command: %ATTR%
echo.
echo Usage:
echo   vx run ^<file.vx^> [--typecheck]  - Run a program
echo   vx debug ^<file.vx^>              - Debug with breakpoints
echo   vx typecheck ^<file.vx^>          - Type check only
echo   vx compile ^<file.vx^>            - Compile to EXE
echo   vx ^<file.vx^>                    - Run a program (shortcut)
EXIT /B 1

:PASS_THROUGH
node "%VEXON_HOME%\vexon_cli.js" %*
EXIT /B %ERRORLEVEL%
