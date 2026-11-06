@echo off
chcp 65001 >nul
title Ladder Freeze Tag
cd /d "%~dp0"
REM Para ser administrador de la comunidad, quita REM de la linea siguiente y escribe tu alias:
REM set ADMIN_ALIAS=tu_alias
echo Iniciando el sitio... deja esta ventana abierta.
echo Abre http://localhost:3000 en tu navegador.
start "" http://localhost:3000
node server.js
echo.
echo El servidor se detuvo. Si hubo un error, copialo o sacale una captura.
pause
