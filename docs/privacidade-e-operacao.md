# Privacidade, retenção e operação — roteiro para piloto

Este roteiro ajuda a preparar um piloto. Ele não é uma política de privacidade final nem uma conclusão jurídica. Preencha os campos com os responsáveis reais antes de cadastrar moradores.

## Identificação e papéis

- **Empresa/pessoa que fornece o Portaria Express:** `[preencher razão social/nome, CNPJ/CPF e contato]`
- **Condomínio contratante:** `[preencher]`
- **Quem decide as finalidades do tratamento:** confirmar com o condomínio.
- **Quem opera o software e presta suporte:** confirmar no contrato.
- **Canal para pedidos dos titulares:** `[e-mail/canal do controlador]`
- **Contato de segurança/incidentes:** `[e-mail e telefone]`

Os papéis de controlador e operador dependem de quem decide o propósito e os meios do tratamento. Não atribua esses papéis apenas pelo nome do contrato.

## Dados tratados pelo produto

| Dado | Uso no fluxo | Decisão a documentar |
|---|---|---|
| Nome, bloco e apartamento | Identificar destinatário e pacote | Base, finalidade, quem pode consultar |
| Telefone/WhatsApp | Preparar aviso manual | Consentimento/base aplicável e canal de oposição |
| Remetente, transportadora e rastreio | Localizar encomenda | Necessidade de cada campo |
| Conta de acesso e perfil | Autenticar equipe e aplicar permissões | Prazo após desligamento |
| Foto de retirada | Registrar comprovante | Se é realmente necessária; prazo e acesso |
| Logs de auditoria | Investigar alterações e acessos | Prazo, exportação e acesso administrativo |

Evite registrar documentos, dados financeiros ou detalhes pessoais na etiqueta e nas observações. Não use fotos de moradores como imagem de perfil.

## Retenção, exclusão e cópias

Defina por escrito, antes do piloto:

1. Prazo para manter encomendas arquivadas e fotos de retirada.
2. Prazo para remover dados e arquivos após cancelamento do contrato.
3. Como atender correção, acesso, eliminação e demais solicitações do titular.
4. Frequência das cópias de segurança e quem pode restaurá-las.
5. Teste periódico de restauração e registro do resultado.

O aplicativo arquiva encomendas sem apagar automaticamente. A migração cria registros e bucket privados; a limpeza de fotos e o prazo final de retenção ainda precisam de rotina de operação. Não prometa exclusão automática até essa rotina existir e ser testada.

## Checklist do piloto

- A migração foi aplicada manualmente ao projeto Supabase conectado em 2 de novembro de 2026. Antes do piloto comercial, validar RLS em homologação com duas contas de condomínios diferentes.
- Remover contas de porteiros que deixaram a equipe e verificar que perdem acesso.
- Confirmar que usuários comuns não conseguem alterar cadastro de moradores nem consultar outra empresa/condomínio.
- Verificar acesso a fotos: sem sessão não pode abrir; outra conta de condomínio não pode criar URL ou ler a imagem.
- Fazer exportação e restauração antes de inserir dados reais.
- Com duas contas de teste no mesmo condomínio, confirmar que novas encomendas e alterações aparecem em tempo real; confirmar que uma conta de outro condomínio não recebe essas atualizações.
- Excluir um morador em uma sessão e confirmar que a outra sessão atualiza ao recuperar o foco ou usar o botão de atualização.
- Informar à equipe como reportar perda de aparelho, senha exposta, acesso indevido ou envio incorreto de mensagem.
- Registrar responsáveis e plano de comunicação de incidente.
- Revisar o aviso de privacidade e o contrato com profissional qualificado antes da oferta comercial.

## Dependências e limites atuais

- Supabase Auth, migração SQL e políticas RLS precisam estar ativas no projeto antes do primeiro login.
- Convites são gerados como códigos de uso único; o administrador precisa enviá-los por um canal privado. O sistema ainda não envia convites por e-mail.
- O envio de WhatsApp é manual, por link preparado no navegador.
- Ollama roda nos computadores dos clientes; suporte remoto ou IA centralizada não está incluído.
- Cobrança, cancelamento automático, plano comercial e nota fiscal precisam de processo próprio.
