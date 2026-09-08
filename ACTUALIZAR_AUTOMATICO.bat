@echo off
chcp 65001 > nul
title Bot Comprobador de Puestos Ofertados - Conselleria GVA
color 0b

echo =======================================================================
echo   BOT AUTONOMO DE PUESTOS OFERTADOS - CONSELLERIA DE EDUCACION
echo =======================================================================
echo.
echo Comprobando si Conselleria ha publicado un nuevo listado de puestos...
echo.

python bot_auto_actualizador.py

echo.
echo =======================================================================
echo Proceso terminado.
echo =======================================================================
pause
