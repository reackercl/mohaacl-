@echo off
chcp 65001 >nul
title Ladder Freeze Tag - MODO PRUEBA
cd /d "%~dp0"
set ADMIN_ALIAS=prueba_admin
if not exist data\ladder.db (
  echo Primera vez: se abrira el sitio un momento para crear la base de datos.
  echo Cuando veas el mensaje de que el sitio inicio, CIERRA esta ventana y vuelve a abrir PROBAR.bat
  node server.js
  exit /b
)
node sembrar-prueba.js
echo.
echo ===== CUENTAS DE PRUEBA (clave de todas: prueba1234) =====
echo   Administrador: prueba_admin  -^> abrelo en http://127.0.0.1:3000
echo   Usuario:       prueba_alfa_1  -^> abrelo en http://localhost:3000
echo =========================================================
echo.
start "" http://localhost:3000
start "" http://127.0.0.1:3000
node server.js
pause
