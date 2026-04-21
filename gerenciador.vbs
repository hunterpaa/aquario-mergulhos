Dim shell, fso
Set shell = CreateObject("WScript.Shell")
Set fso   = CreateObject("Scripting.FileSystemObject")

' Mata apenas o processo na porta 3002 (gerenciador anterior), sem afetar outros apps Node
shell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -aon ^| findstr "" :3002 ""') do taskkill /F /PID %a", 0, True
shell.Run "cmd /c timeout /t 1 /nobreak >nul", 0, True

' Inicia o gerenciador a partir da pasta do script
Dim dir
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run "cmd /c cd /d """ & dir & """ && node manager.js", 0, False

' Aguarda o gerenciador subir e abre o painel no browser
shell.Run "cmd /c timeout /t 2 /nobreak >nul", 0, True
shell.Run "http://localhost:3002"
