@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
title Conectar y Subir Destinos a GitHub
echo =======================================================
echo    🚀 CONECTAR DESTINOS CON TU CUENTA DE GITHUB
echo =======================================================
echo.
cd /d "%~dp0"

set "GIT_EXE=%~dp0tools\git\cmd\git.exe"
if not exist "%GIT_EXE%" (
    where git >nul 2>nul
    if %errorlevel% equ 0 (
        set "GIT_EXE=git"
    ) else (
        echo [ERROR] No se encuentra git.
        pause
        exit /b 1
    )
)

echo Introduce el enlace de tu repositorio de GitHub:
echo (Ejemplo: https://github.com/maestrosinterinosgva-sketch/destinosinterinosgva)
echo.
set /p "REPO_URL=👉 Enlace del repositorio: "
if "!REPO_URL!"=="" (
    echo [!] No has introducido ningún enlace.
    pause
    exit /b 1
)

echo.
echo Introduce tu GitHub Personal Access Token (o pulsa Enter si el repo ya tiene acceso):
set /p "GITHUB_TOKEN=👉 Token (ghp_...): "

set "FINAL_URL=!REPO_URL!"
if not "!GITHUB_TOKEN!"=="" (
    set "CLEAN_URL=!REPO_URL:https://=!"
    set "FINAL_URL=https://!GITHUB_TOKEN!@!CLEAN_URL!"
)

echo.
echo [*] Conectando con GitHub...
"%GIT_EXE%" remote remove origin >nul 2>nul
"%GIT_EXE%" remote add origin !FINAL_URL!
"%GIT_EXE%" branch -M main

echo [*] Subiendo archivos y activando robot de comprobación...
"%GIT_EXE%" push -u origin main --force

if %errorlevel% equ 0 (
    echo.
    echo =======================================================
    echo  🎉 ¡PROYECTO SUBIDO A GITHUB CON ÉXITO!
    echo =======================================================
    echo El robot en la nube ya está activo y revisará la web de
    echo Conselleria automáticamente.
    echo.
    echo Ahora solo falta activar GitHub Pages:
    echo 1. Ve a tu repositorio en GitHub ^> Settings ^> Pages
    echo 2. Elige la rama 'main' y carpeta '/ (root)'
    echo 3. ¡En 1 minuto tendrás tu enlace para compartir por WhatsApp!
) else (
    echo.
    echo [-] Hubo un problema al subir a GitHub. Revisa el enlace o el token.
)

echo.
pause
