@echo off
setlocal
title Separador y anonimizador de examenes
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo iniciar la aplicacion.
  echo Revisa el mensaje anterior.
  pause
)
