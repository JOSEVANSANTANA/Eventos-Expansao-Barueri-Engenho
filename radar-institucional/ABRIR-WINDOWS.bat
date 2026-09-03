@echo off
setlocal
title Radar Institucional
cd /d "%~dp0"

echo.
echo   ================================================
echo    RADAR INSTITUCIONAL
echo   ================================================
echo.
echo   Procurando o Python...
echo.

rem Cada candidato e EXECUTADO antes de ser aceito, nao apenas encontrado.
rem O Windows 10 e 11 instalam um atalho falso chamado python.exe que so abre a
rem Microsoft Store: o "where python" acha, o script segue em frente e nada roda.
rem O py.exe (Python Launcher, que vem com o instalador do python.org) e testado
rem primeiro porque nunca e um atalho falso.
set "PY="

py -3 -c "import sys" >nul 2>nul
if not errorlevel 1 set "PY=py -3"

if not defined PY (
  python -c "import sys" >nul 2>nul
  if not errorlevel 1 set "PY=python"
)

if not defined PY (
  python3 -c "import sys" >nul 2>nul
  if not errorlevel 1 set "PY=python3"
)

if not defined PY (
  echo   Python nao encontrado neste computador.
  echo.
  echo   Duas opcoes:
  echo.
  echo     1^) Instale o Python em https://python.org/downloads
  echo        Na primeira tela do instalador, MARQUE a caixa
  echo        "Add python.exe to PATH" antes de clicar em Install.
  echo        Depois feche esta janela e abra este arquivo de novo.
  echo.
  echo     2^) Ou use o Radar-Institucional-STANDALONE.html
  echo        Duplo clique, sem instalar nada. Funciona quase tudo -
  echo        so o coletor de manchetes precisa do servidor.
  echo.
  pause
  exit /b 1
)

echo   Python encontrado: %PY%
echo.
echo   NAO FECHE ESTA JANELA enquanto estiver usando.
echo   Ctrl+C encerra. O navegador abre sozinho quando estiver pronto.
echo.

rem O servidor abre o navegador sozinho, depois de conferir que a porta responde.
%PY% servidor.py 8080

echo.
echo   O servidor encerrou.
pause
