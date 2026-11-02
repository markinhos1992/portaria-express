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

:: Bloqueia envio enquanto qualquer referência antiga à chave existir no histórico
git log --all --format=%%H -G "AIza" -- index.html 2>nul | findstr /r /c:"." >nul
if not errorlevel 1 (
    echo ❌ Publicação bloqueada: uma credencial antiga ainda aparece no histórico do Git.
    echo    Revogue a chave e limpe o histórico antes de enviar qualquer atualização.
    echo.
    pause
    exit /b 1
)

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

:: Verifica Node.js e gera a versão de produção antes de publicar
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js não encontrado. Instale a versão LTS em https://nodejs.org/
    pause
    exit /b
)
echo 🔧 Instalando dependências e compilando o site...
call npm ci
if %errorlevel% neq 0 (
    echo ❌ Falha ao instalar as dependências. Nenhum envio foi feito.
    pause
    exit /b
)
call npm run build
if %errorlevel% neq 0 (
    echo ❌ A compilação falhou. Nenhum envio foi feito.
    pause
    exit /b
)

:: Adiciona, commita e envia
echo 📤 Enviando atualização para o GitHub...
echo.

git add index.html README.md package.json package-lock.json vite.config.js .gitignore .github src supabase docs atualizar.bat configurar_primeira_vez.bat

git diff --cached --quiet
if %errorlevel% equ 0 (
    echo ℹ️ Não há mudanças para enviar.
    pause
    exit /b 0
)

set DATA=%date% %time%
git commit -m "Atualização do sistema — %DATA%"

git push origin main

if %errorlevel% equ 0 (
    echo.
    echo ╔══════════════════════════════════════════╗
    echo ║   ✅ SITE ATUALIZADO COM SUCESSO!         ║
    echo ║                                          ║
    echo ║   Acesse em alguns minutos:              ║
    echo ║   https://markinhos1992.github.io/       ║
    echo ║   portaria-express/                      ║
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
