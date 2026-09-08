@echo off
chcp 65001 > nul
title Actualizar Puestos con Nuevo PDF o Enlace Web
color 0a

echo =======================================================================
echo   ACTUALIZAR PUESTOS CON NUEVO ARCHIVO O ENLACE (URL)
echo =======================================================================
echo.
echo Puedes:
echo  1. Arrastrar un archivo PDF a esta ventana y pulsar ENTER.
echo  2. Pegar un enlace (URL directa) de Conselleria y pulsar ENTER.
echo  3. Dejarlo en blanco y pulsar ENTER para procesar el PDF mas reciente.
echo.
set /p TARGET="Introduce archivo o enlace (o pulsa ENTER): "

echo.
if "%TARGET%"=="" (
    python actualizar_puestos.py
) else (
    python actualizar_puestos.py %TARGET%
)

echo.
echo =======================================================================
echo Proceso finalizado. Puedes abrir 'index.html' para ver los datos.
echo =======================================================================
pause
