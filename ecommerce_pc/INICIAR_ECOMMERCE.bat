@echo off
rem UN SOLO ARCHIVO: enlaza este PC con ECOMMERCE (la primera vez) y arranca el puente. Déjalo abierto.
title ECOMMERCE - puente con el panel
cd /d "%~dp0"
set "PY="
where python >nul 2>&1 && set "PY=python"
if not defined PY where py >nul 2>&1 && set "PY=py -3"
if not defined PY (
  echo No encuentro Python. Instalalo desde python.org ^(marca "Add Python to PATH"^) y vuelve a abrir este archivo.
  pause
  exit /b 1
)
%PY% puente_ecommerce.py %*
if errorlevel 1 pause
