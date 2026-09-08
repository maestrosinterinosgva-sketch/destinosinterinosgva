@echo off
chcp 65001 > nul
title Servidor Local - Buscador de Puestos Docentes
color 0e

echo =======================================================================
echo   INICIANDO APLICACION WEB DE DESTINOS Y PUESTOS OFERTADOS
echo =======================================================================
echo.
echo Abriendo navegador en http://localhost:8080...
echo.
start "" "http://localhost:8080"
python -m http.server 8080
pause
