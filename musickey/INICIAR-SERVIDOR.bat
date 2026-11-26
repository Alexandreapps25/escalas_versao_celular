@echo off
chcp 65001 >nul
title MusicKey PRO Studio - servidor local
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado.
  echo  Baixe gratis em https://nodejs.org ^(versao LTS^), instale e rode este arquivo de novo.
  echo.
  start https://nodejs.org
  pause
  exit /b
)
node server\server.js --open
pause
