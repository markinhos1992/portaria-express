@echo off
chcp 65001 >nul
title Portaria Express — Configuração Inicial

echo.
echo ╔══════════════════════════════════════════╗
echo ║   PORTARIA EXPRESS — CONFIGURAÇÃO        ║
echo ║   Execute este script UMA VEZ só         ║
echo ╚══════════════════════════════════════════╝
echo.

:: Verifica Git
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Git não instalado!
    echo.
    echo 1. Acesse: https://git-scm.com/download/win
    echo 2. Baixe e instale o Git
    echo 3. Reinicie o computador
    echo 4. Execute este script novamente
    echo.
    start https://git-scm.com/download/win
    pause
    exit /b
)

echo ✅ Git encontrado!
echo.

:: Pede nome e email
echo Digite seu nome de usuário do GitHub:
set /p GITHUB_USER="> "

echo.
echo Digite seu email do GitHub:
set /p GITHUB_EMAIL="> "

echo.

:: Configura Git
git config --global user.name "%GITHUB_USER%"
git config --global user.email "%GITHUB_EMAIL%"

:: Vai para a pasta
cd /d "%~dp0"

:: Inicializa repo
if not exist ".git" (
    git init
    git remote add origin https://github.com/markinhos1992/portaria-express.git
    git branch -M main
)

:: Primeiro envio
echo.
echo 📤 Fazendo primeiro envio para o GitHub...
echo.
echo ⚠️  O GitHub vai pedir seu login no navegador.
echo     Faça login quando abrir a janela!
echo.

git add .
git commit -m "Configuração inicial — Portaria Express"
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ╔══════════════════════════════════════════╗
    echo ║   ✅ CONFIGURADO COM SUCESSO!             ║
    echo ║                                          ║
    echo ║   Agora use o arquivo:                   ║
    echo ║   atualizar.bat                          ║
    echo ║   para enviar atualizações!              ║
    echo ╚══════════════════════════════════════════╝
) else (
    echo.
    echo ❌ Erro no envio. Tente:
    echo    1. Verificar conexão com internet
    echo    2. Fazer login no GitHub quando solicitado
    echo    3. Executar como Administrador
)

echo.
pause
