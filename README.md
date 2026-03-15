# 📦 Portaria Express

Sistema inteligente de gestão de encomendas para condomínios.

## 🌐 Acesso Online

Após configurar o GitHub Pages, o sistema estará disponível em:  
`https://SEU_USUARIO.github.io/portaria-express`

---

## 🚀 Como publicar no GitHub Pages (passo a passo)

### 1. Criar conta no GitHub
- Acesse [github.com](https://github.com) e crie uma conta gratuita

### 2. Criar repositório
- Clique no botão **"New"** (ou **"+"** no canto superior direito)
- Nome do repositório: `portaria-express`
- Deixe como **Public**
- Clique em **"Create repository"**

### 3. Fazer upload dos arquivos
- Na página do repositório, clique em **"uploading an existing file"**
- Arraste os arquivos `index.html` e `README.md`
- Clique em **"Commit changes"**

### 4. Ativar GitHub Pages
- Vá em **Settings** (aba no topo do repositório)
- No menu lateral, clique em **Pages**
- Em **Source**, selecione **"Deploy from a branch"**
- Em **Branch**, selecione **"main"** e pasta **"/ (root)"**
- Clique em **Save**

### 5. Acessar o site
- Aguarde ~2 minutos
- Acesse: `https://SEU_USUARIO.github.io/portaria-express`

---

## 🔑 Login padrão

| Usuário | Senha  | Perfil |
|---------|--------|--------|
| admin   | 123456 | Admin  |

> ⚠️ **Importante:** Altere a senha do admin após o primeiro acesso em **Usuários**.

---

## ⚙️ Configurar API Key (leitura de etiqueta com IA)

1. Acesse [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Crie uma API Key gratuita do Gemini
3. No sistema, vá em **⚙️ Configurações**
4. Cole a key (começa com `AIza...`) e salve

---

## 🗄️ Banco de dados (Supabase)

O sistema usa o Supabase como banco de dados em nuvem.  
As credenciais já estão configuradas no arquivo `index.html`.

---

## 📱 Funcionalidades

- ✅ Registro de encomendas com câmera e leitura por IA
- ✅ Confirmação de retirada com foto
- ✅ Notificação via WhatsApp
- ✅ Cadastro de moradores
- ✅ Relatórios e exportação CSV
- ✅ Limpeza automática de registros antigos (15 dias)
- ✅ Modo offline com cache local
- ✅ Controle de acesso (Admin / Porteiro)
