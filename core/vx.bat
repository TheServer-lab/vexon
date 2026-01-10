@echo off
:: Vexon CLI Wrapper v0.4.1
:: Supports: run, compile, debug, typecheck

IF "%~1"=="" (
    node "C:\Vexon\vexon_cli.js"
    EXIT /B
)

SET ATTR=%~1

:: Check if the first argument is a known subcommand
IF "%ATTR%"=="run" GOTO PASS_THROUGH
IF "%ATTR%"=="compile" GOTO PASS_THROUGH
IF "%ATTR%"=="debug" GOTO PASS_THROUGH
IF "%ATTR%"=="typecheck" GOTO PASS_THROUGH
IF "%ATTR%"=="check" GOTO PASS_THROUGH

:: If no subcommand is detected, default to 'run' for backward compatibility
node "C:\Vexon\vexon_cli.js" run %*
GOTO END

:PASS_THROUGH
node "C:\Vexon\vexon_cli.js" %*

:END
