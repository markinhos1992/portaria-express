@echo off
chcp 65001 >nul
title Portaria Express — Atualizar Site

echo.
echo ╔══════════════════════════════════════════╗
echo ║   PORTARIA EXPRESS — ATUALIZAR SITE      ║
echo ╚══════════════════════════════════════════╝
echo.

:: Verifica se o Git está instalado
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Git não encontrado!
    echo.
    echo Instale o Git em: https://git-scm.com/download/win
    echo Depois execute este script novamente.
    echo.
    pause
    exit /b
)

:: Vai para a pasta onde o script está
cd /d "%~dp0"

:: Verifica se já tem repositório Git configurado
if not exist ".git" (
    echo 🔧 Configurando repositório pela primeira vez...
    echo.
    git init
    git remote add origin https://github.com/markinhos1992/portaria-express.git
    git branch -M main
    echo ✅ Repositório configurado!
    echo.
)

:: Verifica se o index.html existe
if not exist "index.html" (
    echo ❌ Arquivo index.html não encontrado nesta pasta!
    echo.
    echo Certifique que o index.html está na mesma pasta que este script.
    echo.
    pause
    exit /b
)

:: Adiciona, commita e envia
echo 📤 Enviando atualização para o GitHub...
echo.

git add index.html
git add README.md 2>nul

set DATA=%date% %time%
git commit -m "Atualização do sistema — %DATA%"

git push origin main

if %errorlevel% equ 0 (
    echo.
    echo ╔══════════════════════════════════════════╗
    echo ║   ✅ SITE ATUALIZADO COM SUCESSO!         ║
    echo ║                                          ║
    echo ║   Acesse em ~1 minuto:                   ║
    echo ║   markinhos1992.github.io/               ║
    echo ║   portaria-express                       ║
    echo ╚══════════════════════════════════════════╝
) else (
    echo.
    echo ❌ Erro ao enviar. Veja as mensagens acima.
    echo.
    echo Possíveis causas:
    echo   1. Você não fez login no Git ainda
    echo   2. Sem conexão com internet
    echo.
    echo Para fazer login, abra o Git Bash e digite:
    echo   git config --global user.name "markinhos1992"
    echo   git config --global user.email "SEU_EMAIL@gmail.com"
)

echo.
pause
