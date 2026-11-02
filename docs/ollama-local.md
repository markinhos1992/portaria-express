# Conexão do site com Ollama no Windows

O teste em 02/11/2026 confirmou HTTP 403 ao enviar a origem https://markinhos1992.github.io ao Ollama local. O servidor funciona sem essa origem, mas bloqueia o site publicado.

1. Abra no Windows “Editar as variáveis de ambiente da sua conta”.
2. Adicione a variável de usuário OLLAMA_ORIGINS com o valor exato https://markinhos1992.github.io.
3. Encerre o Ollama pelo ícone da bandeja e abra novamente para carregar a variável.
4. No Portaria Express, abra Configurações, selecione qwen3.5:2b e clique em Testar conexão.
5. Se o navegador perguntar sobre rede local, autorize o acesso do site ao Ollama neste computador.

Não use asterisco na lista de origens e mantenha o serviço restrito ao computador local. A autorização vale para a origem inteira do GitHub Pages, não apenas para uma pasta. Para clientes comerciais, prefira um domínio próprio e configure a origem correspondente.

A verificação de conexão tem limite de 10 segundos; a análise tem limite de 90 segundos e é cancelada ao fechar o formulário. O modelo 4B falhou por memória insuficiente neste computador. O 2B respondeu no teste direto, mas todos os campos sugeridos devem ser revisados. A revisão automática bloqueou a mudança da configuração local e reinício do serviço; a variável não foi aplicada pela manutenção.
