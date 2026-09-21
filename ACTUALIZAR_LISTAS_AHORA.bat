@echo off
chcp 65001 > nul
title Buscador de Puestos y Destinos GVA - Actualizador Autonomo
echo ================================================================
echo  COMPROBANDO NUEVAS LISTAS DE PUESTOS EN CONSELLERIA GVA
echo ================================================================
echo.
python bot_auto_actualizador.py
echo.
echo ================================================================
echo  PROCESO FINALIZADO
echo ================================================================
pause
