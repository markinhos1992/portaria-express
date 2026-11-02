# Revisão de segurança e operação — 02/11/2026

## Correções implementadas

- Carregamento de moradores e encomendas em lotes de 500, evitando truncamento silencioso no limite padrão de 1.000. Ordenação estável e erro explícito se uma página falhar ou duplicar registros.
- Exportação CSV protege células com aparência de fórmula, mantém zeros, escapa aspas, usa UTF-8 com BOM e libera o arquivo temporário após o download.
- Importação CSV reconhece observações com várias linhas e aspas escapadas. Rejeita arquivos acima de 2 MB, lotes acima de 500 moradores, cabeçalhos repetidos, dados obrigatórios ausentes, colunas inconsistentes e duplicidades no cadastro. Os dados não são importados parcialmente quando essas validações falham.
- Endereço da IA restrito ao próprio computador, sem credenciais, caminhos ou parâmetros. Fotos não são enviadas para endereços externos configurados no aplicativo.
- Política de conteúdo no HTML restringe scripts, conexões, imagens e formulários. Referências externas recebem política no-referrer e WhatsApp abre sem acesso à janela de origem.
- Fotos de entrada aceitam JPG, PNG e WebP até 10 MB; SVG e arquivos incompatíveis são recusados antes da leitura.
- Protocolo usa UUID criptográfico para reduzir colisões em comparação aos quatro dígitos aleatórios anteriores.
- Ao sair da conta, os dados em memória são limpos e carregamentos anteriores são invalidados. Formulários são remontados ao trocar de condomínio. Operações assíncronas capturam o condomínio de origem e os retornos locais são filtrados por contexto.
- Proteções contra cliques repetidos em gravações e contra duplicação local por atualização em tempo real.
- Dados persistidos pelo banco são usados após a retirada, inclusive a autoria e o horário confirmados pelo servidor.
- Auditoria exibida com eventos mais recentes primeiro. O painel mostra até os 1.000 eventos recentes; não representa a exclusão dos eventos anteriores do banco.
- GitHub Actions passa a executar testes e verificação de vulnerabilidades antes da publicação.

## Banco de dados

Migração 202611020002_integridade_retiradas.sql testada em transação revertida e aplicada ao projeto conectado:

- Recebimento nasce pendente e o banco identifica quem o registrou.
- Identificação, protocolo e dados originais de criação não podem ser trocados.
- Retirada exige comprovante enviado pelo usuário para o caminho desta encomenda e deste condomínio.
- Autor e horário da retirada e do arquivamento são confirmados pelo servidor.
- Retirada confirmada não pode voltar para pendente ou trocar de comprovante.
- Fotos vinculadas a uma retirada não podem ser excluídas diretamente pelo autor do upload.

Migração 202611020003_auditoria_servidor.sql: criação, retirada, arquivamento e mudanças de moradores são auditadas na mesma transação pelo banco. O navegador deixa de ter permissão para inventar eventos de auditoria por INSERT direto.

## Verificação

- Nove testes automatizados: paginação de 1.501 registros, falha intermediária, duplicação de página, proteção CSV, CSV multilinha, destino local da IA, identificação de moradores, telefone WhatsApp e validação de fotos.
- Compilação de produção aprovada; verificação de diferenças sem erro.
- npm audit: zero vulnerabilidades conhecidas no momento da consulta, incluindo dependências de desenvolvimento. Isso não é certificação de segurança.
- Testes SQL com registros temporários: autoria, foto obrigatória, retirada válida, bloqueio de reversão, protocolo imutável, arquivamento e três eventos automáticos de auditoria. Transações revertidas.

## Limites que continuam importantes

A paginação busca todos os registros para processamento na tela; volumes muito grandes ainda exigirão busca, agregação e paginação de interface no servidor, com medição de desempenho. O teste de 1.501 registros é simulado e não é prova de capacidade para milhares de usuários simultâneos.

Backups completos com restauração de fotos, prazos de retenção e descarte automático continuam como configuração de operação a definir. Não foi feita exclusão permanente de registros existentes. Não foram criados planos comerciais nem novos condomínios. Testes com câmera e leitor físicos, recuperação de senha e aceite de convite por segunda conta ainda precisam de validação prática.
