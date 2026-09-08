@echo off
chcp 65001 > nul
title Asistente para Subir a GitHub
color 0b

echo =======================================================================
echo   🚀 ASISTENTE AUTOMÁTICO PARA SUBIR DESTINOS A GITHUB
echo =======================================================================
echo.
echo Este asistente conectará esta carpeta con tu repositorio de GitHub.
echo.
set /p REPO_URL="Pega la URL de tu repositorio (ej: https://github.com/usuario/destinos.git): "

if "%REPO_URL%"=="" (
    echo.
    echo [-] No has introducido ninguna URL. Operación cancelada.
    pause
    exit /b
)

echo.
echo [*] Inicializando Git...
git init
git branch -M main

echo [*] Añadiendo archivos...
git add .

echo [*] Creando commit inicial...
git commit -m "Inicializar web de destinos docentes con bot automático"

echo [*] Conectando con GitHub...
git remote remove origin 2>nul
git remote add origin %REPO_URL%

echo [*] Subiendo archivos a GitHub...
git push -u origin main

echo.
echo =======================================================================
echo   ¡TODO LISTO!
echo =======================================================================
echo Ahora solo tienes que seguir los pasos de "COMO_SUBIR_A_GITHUB.txt"
echo para activar GitHub Pages y darle permisos al Bot.
echo =======================================================================
pause
