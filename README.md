# Portaria Express

Aplicação web para registrar encomendas de condomínios, acompanhar retiradas e organizar avisos aos moradores. O projeto está em preparação para pilotos comerciais; a cobrança, o suporte e algumas rotinas de operação ainda precisam ser definidos.

## Recursos

- Cadastro e pesquisa de encomendas e moradores.
- Confirmação de retirada com foto privada armazenada no Supabase Storage.
- Contas por e-mail, recuperação de senha, condomínios separados e convites para a equipe.
- Perfis de administrador e porteiro, com políticas de acesso no banco.
- Atualização em tempo real de novos registros e alterações, filtrada pelo condomínio ativo.
- Importação de moradores por CSV e exportação de relatórios.
- Mensagem de WhatsApp preparada para envio manual pela equipe.
- Leitura assistida de etiquetas com Ollama/Qwen 3.5 quando o serviço local estiver disponível.
- Arquivamento de encomendas sem exclusão automática do histórico.

## Configuração necessária antes do primeiro uso

O código exige Supabase Auth e as tabelas protegidas da migração. A tela de login não possui usuário ou senha de demonstração.

No projeto Supabase conectado ao aplicativo, a migração foi aplicada em 2 de novembro de 2026 e os endereços de retorno do GitHub Pages e do ambiente local foram cadastrados. O teste de isolamento no banco passou com dois usuários e condomínios sintéticos; a transação foi revertida e não deixou dados de teste. Para configurar outro projeto, abra **SQL Editor** e aplique [`supabase/migrations/202611010001_comercial_seguro.sql`](supabase/migrations/202611010001_comercial_seguro.sql); depois, em **Authentication → URL Configuration**, cadastre as URLs exatas de teste e produção.

1. Confirme a configuração de confirmação de e-mail e use o fluxo **Criar conta** para registrar a primeira pessoa administradora.
2. Valide cadastro, confirmação de e-mail, login, recuperação de senha e convite com contas reais antes de cadastrar moradores.
3. Para adicionar a equipe, gere um convite na seção **Usuários**; a pessoa deverá criar conta com o e-mail convidado e aceitar o código.
4. Confirme que o projeto usa o endereço e a chave **publishable** definidos no início de `src/main.jsx`. Chave publishable pode ficar no navegador; nunca coloque chave `secret` ou `service_role` no site.
5. Publique o site em HTTPS depois de concluir os testes de isolamento e as demais verificações do checklist do piloto.

### Dados da versão antiga

A versão anterior guardava contas no navegador e usava uma tabela de encomendas sem separação por condomínio. A nova versão remove automaticamente a lista antiga de contas e senhas locais por segurança; cada pessoa deverá criar uma conta Supabase. A migração mantém as tabelas antigas intactas e não copia dados automaticamente. Antes de migrar registros existentes, exporte moradores e encomendas, confirme a qual condomínio pertencem e faça uma cópia de segurança. Não misture dados de clientes diferentes.

### Ollama local

O modelo padrão é `qwen3.5:4b`. Instale [Ollama](https://ollama.com/download) em cada computador que fará leitura de etiquetas e execute `ollama run qwen3.5:4b`. Se o site for aberto pelo endereço público, permita no Ollama a origem HTTPS exata do site. Cada instalação usa CPU/GPU, memória, espaço e energia desse computador. O modo local não oferece uma IA hospedada para todos os clientes.

Com Ollama, as imagens de etiqueta são analisadas localmente. A foto da retirada é enviada ao bucket privado do Supabase do condomínio e seu prazo de retenção deve ser definido e informado pelo operador do sistema.

## Segurança e privacidade

- As tabelas `portaria_*` usam Supabase Auth e Row Level Security (RLS) para separar os registros por condomínio.
- A migração habilita atualizações em tempo real para encomendas, moradores e auditoria. A tela também sincroniza ao voltar para o navegador e oferece atualização manual; eventos de exclusão não são transmitidos.
- A chave publishable é pública por natureza; a proteção depende das políticas RLS. Nunca use `service_role` no navegador.
- Fotos de retirada usam bucket privado e política de acesso por condomínio. Os registros de encomendas são arquivados, não apagados automaticamente.
- O condomínio precisa definir finalidade, prazo de retenção, responsáveis, avisos de privacidade e procedimento para solicitações dos titulares.
- A migração foi aplicada manualmente ao projeto Supabase conectado; o SQL não é executado automaticamente pelo site. O teste de RLS com usuários sintéticos passou; o fluxo real de autenticação e os convites ainda precisam ser verificados antes do uso comercial.

Consulte [`docs/privacidade-e-operacao.md`](docs/privacidade-e-operacao.md) para a lista de decisões necessárias. O documento é um roteiro operacional e não substitui revisão jurídica.

## Piloto e comercialização

Comece com dois ou três condomínios por 30 dias. Acompanhe tempo de cadastro, avisos efetivamente enviados, retiradas registradas, falhas, treinamento e suporte necessário. Combine por escrito quais dados serão usados e como serão removidos ao encerrar o piloto. Valide disposição de pagamento e custo de suporte antes de anunciar preços.

Planos pagos, cobrança recorrente, emissão fiscal e atendimento com prazo garantido ainda não estão implementados.

## Publicação

O workflow em `.github/workflows/deploy-pages.yml` compila e publica a pasta `dist`. Na primeira configuração, abra **Settings → Pages** no GitHub e selecione **GitHub Actions** como fonte. Antes da publicação, valide o fluxo real de autenticação, confirme que a chave antiga foi removida de todo o histórico público e conclua as verificações do piloto. A chave foi revogada; um commit novo, sozinho, não apaga o segredo dos commits antigos, então o histórico ainda precisa ser reescrito.

O arquivo `atualizar.bat` é um atalho legado para envio direto à branch principal. Antes de usá-lo, revise os arquivos que serão publicados e confirme que o segredo antigo foi revogado.

## Cópia protegida e consulta de emergência

Administradores podem usar Backup e recuperação para exportar moradores, encomendas, todos os eventos de auditoria acessíveis e fotos referenciadas. Limite: 20 MB antes da criptografia. Senha de pelo menos 12 caracteres; AES-GCM e PBKDF2. Guarde senha e arquivo separadamente e teste semanalmente a abertura.

O leitor permite consultar moradores, encomendas e auditoria com busca e paginação. Baixe também o leitor HTML independente para consulta sem internet. Fechar e limpar invalida aberturas pendentes e remove conteúdo e fotos da tela.

A exportação recusa fotos ausentes e compara novamente as tabelas após coletar os comprovantes. Essa verificação detecta alterações concorrentes, mas não equivale a um snapshot transacional do servidor. Gere a cópia durante uma pausa operacional. Para garantias transacionais e volumes maiores, implemente backup administrativo do banco e do armazenamento.

A cópia NÃO inclui contas de autenticação, senhas, configurações do Supabase ou código. O leitor é somente para consulta: restauração em produção exige procedimento administrativo separado, ensaiado primeiro em ambiente isolado. Não há agendamento automático de backups nem exclusão automática por retenção.
