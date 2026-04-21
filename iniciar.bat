@echo off
title Matteus-Sub - App de Controle de Mergulho
echo ==========================================
echo    INICIANDO SISTEMA MATTEUS-SUB
echo ==========================================
echo.

:: Abre o servidor em uma nova janela de terminal para você ver os logs
start "Servidor Matteus-Sub" cmd /k "node server/server.js"

:: Aguarda 3 segundos para o servidor subir
timeout /t 3 /nobreak > nul

:: Abre o navegador no endereço do app
start http://localhost:3001

echo.
echo Tudo pronto! O servidor esta rodando e o site foi aberto.
echo Nao feche a outra janela preta (do servidor) enquanto estiver usando.
echo.
pause
