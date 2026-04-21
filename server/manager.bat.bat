@echo off
title Matteus-Sub Manager
color 0A
echo ========================================
echo    MATTEUS-SUB - Deep Sea Manager
echo ========================================
echo.
echo [1] Iniciar Servidor
echo [2] Parar Servidor
echo [3] Reiniciar Servidor
echo [4] Abrir App no Navegador
echo [5] Sair
echo.
choice /c 12345 /n /m "Escolha uma opcao: "

if errorlevel 5 exit
if errorlevel 4 start http://localhost:3001 & goto menu
if errorlevel 3 taskkill /F /IM node.exe & timeout /t 2 /nobreak >nul & start /B node server.js & echo Servidor reiniciado! & timeout /t 2 & goto menu
if errorlevel 2 taskkill /F /IM node.exe & echo Servidor parado! & timeout /t 2 & goto menu
if errorlevel 1 start /B node server.js & echo Servidor iniciado! & timeout /t 2 & goto menu

:menu
cls
goto top