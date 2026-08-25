@echo off
title Radar Institucional
cd /d "%~dp0"
echo.
echo   ================================================
echo    RADAR INSTITUCIONAL
echo   ================================================
echo.
echo   Iniciando... o navegador abre sozinho em 2 segundos.
echo.
echo   NAO FECHE ESTA JANELA enquanto estiver usando.
echo   Para encerrar, feche esta janela.
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  python servidor.py 8080
  goto fim
)

where py >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  py servidor.py 8080
  goto fim
)

echo   Python nao encontrado neste computador.
echo.
echo   Duas opcoes:
echo     1^) Instale o Python em https://python.org/downloads
echo        ^(marque "Add Python to PATH" na instalacao^)
echo     2^) Ou use o arquivo Radar-Institucional-STANDALONE.html
echo        ^(duplo clique, sem instalar nada^)
echo.
pause

:fim
