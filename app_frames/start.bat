@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Для запуска из исходников установи Node.js 22.14 или новее, затем запусти этот файл снова.
  pause
  exit /b 1
)
if not exist node_modules\electron\dist\electron.exe (
  echo Первый запуск: устанавливаю зависимости. Это может занять несколько минут...
  call npm.cmd ci
  if errorlevel 1 (
    echo Не удалось установить зависимости. Проверь подключение к интернету.
    pause
    exit /b 1
  )
  node -e "require('electron')"
  if errorlevel 1 (
    echo Не удалось загрузить Electron. Проверь подключение к интернету.
    pause
    exit /b 1
  )
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
