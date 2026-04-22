Dim shell, fso
Set shell = CreateObject("WScript.Shell")
Set fso   = CreateObject("Scripting.FileSystemObject")

' Mata todos os processos node.exe existentes silenciosamente
shell.Run "cmd /c taskkill /F /IM node.exe /T >nul 2>&1", 0, True
shell.Run "cmd /c timeout /t 1 /nobreak >nul", 0, True

' Inicia o gerenciador a partir da pasta do script (sem janela preta)
Dim dir
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run "cmd /c cd /d """ & dir & """ && node manager.js", 0, False

' Aguarda o gerenciador subir e abre o painel no browser
shell.Run "cmd /c timeout /t 2 /nobreak >nul", 0, True
shell.Run "http://localhost:3004"
