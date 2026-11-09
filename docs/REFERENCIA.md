# PCP MA · Referência do projeto

Documento único de referência do PCP MA (controle de produção da MA Fardamentos): cliente, escopo, perfis, fluxo, requisitos, regras de negócio, decisões, dados, arquitetura, etapas de entrega e estado do código. **Leia este arquivo antes de programar.** Quando o código e este documento divergirem, corrija um dos dois no mesmo trabalho.

- **Fonte dos requisitos:** [documento no claude.ai](https://claude.ai/artifact/EJc3eY1PQqkYAaxm3gLuwc) (RF, RN, RNF e decisões em aberto). Este arquivo o reúne com o contexto, os dados, a arquitetura e o estado do código. Se mudar um requisito, mude nos dois.
- **Tecnologias em detalhe:** [TECNOLOGIAS.md](TECNOLOGIAS.md).
- **Como rodar, testar e medir:** [../README.md](../README.md).
- **Última atualização:** 23/10/2026.

## 1. Cliente e contexto

- **Cliente:** MA Fardamentos (uniformes em geral), Fortaleza/CE. A ideia nasceu de um pedido de Marcelo, da MA.
- **Hoje:** o controle de pedidos é um arquivo HTML que guarda tudo no navegador de **cada aparelho**, sem senha. Cada aparelho tem os próprios dados; para ver o que outro digitou, só levando um arquivo de cópia, à mão.
- **Erros conhecidos do sistema atual** (a corrigir no novo): o número do lote não abre; as peças entregues de pedido de Cliente não entram nos totais; depois das 21h a data do pedido pode sair com um dia a mais.
- **Catálogo atual:** 49 itens, com preço por faixa (10 peças ou mais / menos de 10) e adicionais por peça: patch R$ 7,00, punho R$ 5,00, gola V R$ 2,00. Os preços hoje estão escritos dentro do arquivo antigo.
- **Depois:** sistema online com usuário e senha; cada setor vê só a sua fila; ao concluir, o pedido passa sozinho para o próximo setor até o financeiro e a entrega; a Direção acompanha tudo numa tela só.
- **Valores do projeto** (preço, mensalidade, infraestrutura, titularidade das contas): a definir com o cliente. Não estão neste documento.

## 2. Objetivo e escopo

**Objetivo.** Trocar o arquivo que roda num só aparelho por um sistema online em que cada setor vê só a sua fila, e o pedido passa sozinho de setor em setor até o financeiro e a entrega.

**Entra no escopo**
- Login com usuário e senha, com acesso limitado por perfil.
- Cadastro de clientes, feito uma vez e reaproveitado nos pedidos.
- Abertura de pedido em 4 passos, com orçamento calculado pelo catálogo.
- Fila de trabalho para cada um dos 8 setores de produção.
- Devolução ao Design (recuperação) a partir do Laser e da Conferência.
- Financeiro e entrega dos pedidos de Cliente.
- Quadro da Direção, só de leitura.
- Histórico de cada pedido: quem fez, quando e o que observou.
- Importação dos pedidos do sistema atual.

**Fora do escopo** (não aparece na demonstração nem no plano)
- Nota fiscal, estoque de malha e insumos, compras.
- Envio automático pelo WhatsApp: o sistema só monta a mensagem para copiar.
- Controle de ponto ou produtividade individual.

## 3. Perfis e permissões

São 11 acessos: Atendimento, um para cada um dos 8 setores, Direção e Administrador. A regra é aplicada **no servidor (API)**, não só na tela.

| Perfil | Vê | Faz | Não pode |
|---|---|---|---|
| Atendimento | Todos os pedidos, em que setor cada um está, valores, clientes e recebimentos | Cadastra clientes, abre pedidos, gera orçamento, registra recebimentos, confirma entrega | Concluir ou devolver etapas da produção |
| Setor (Design, Impressão, Batida, Laser, Conferência, Bordado, Costura, Embalagem) | Só os pedidos que estão no seu setor: produtos, grade, especificações, fotos, observações e linha do tempo | Conclui a sua etapa; Laser e Conferência também devolvem ao Design | Ver valores, pagamentos, documento e telefone do cliente, ou pedidos de outros setores |
| Direção | Tudo, incluindo valores e recebimentos | Consulta o quadro, os alertas e a linha do tempo de qualquer pedido; edita produtos e preços; registra recebimentos e comprovantes e confirma entrega (decidido em 05/11/2026) | Abrir ou alterar pedidos, concluir ou devolver etapas |
| Administrador | Tudo | Cria e desativa usuários, edita catálogo e preços; conclui qualquer etapa de produção | — |

O perfil Administrador vem do plano e ainda não existe na demonstração. Os setores veem o nome e a cidade do cliente na ficha; se isso fica assim é a decisão D11.

## 4. Fluxo do pedido

```
Atendimento (abre o pedido, com orçamento e entrada)
  → 1 Design → 2 Impressão → 3 Batida → 4 Laser → 5 Conferência → 6 Bordado* → 7 Costura → 8 Embalagem
                                                     │ Laser e Conferência podem devolver ao Design, com motivo
                                                     ↓ (Recuperação: Design conclui e o pedido volta para a Impressão)
  Embalagem → Feira:   Concluído (termina na Embalagem)
            → Cliente: Financeiro e entrega (cobra o saldo e confirma a entrega) → Concluído (saldo zero e entrega feita)

  * Bordado só existe quando o pedido tem bordado (ou patch). Sem bordado, a Conferência vai direto para a Costura.
```

- O pedido está em **um só lugar por vez**; só o setor onde ele está pode concluí-lo.
- **Impressão** informa a máquina (02, 03 ou 04). **Embalagem** confirma a quantidade final de peças (já vem preenchida com o previsto).
- Pedido de **Feira** não passa pelo financeiro; pedido de **Cliente** só termina com saldo zero e entrega confirmada.
- Semáforo do prazo: vermelho (atrasado), âmbar (hoje, amanhã ou em 2 dias), verde (3 dias ou mais).

## 5. Requisitos funcionais

### Acesso
| ID | Requisito |
|---|---|
| RF-01 | Entrar com usuário e senha e cair direto na área do seu perfil. |
| RF-02 | Mostrar "Acesso restrito" quando alguém abre uma área que não é do seu perfil. |
| RF-03 | Sair ou trocar de usuário a qualquer momento. |
| RF-04 | Administrador cria, edita e desativa usuários, ligando cada um a um perfil e, se for setor, a um setor. |

### Atendimento: início
| ID | Requisito |
|---|---|
| RF-05 | Mostrar 4 indicadores: pedidos em produção (com peças), aguardando pagamento, valor a receber e entregas dos próximos 7 dias. |
| RF-06 | Listar os pedidos em andamento, do mais urgente ao menos, e os concluídos, do mais recente ao mais antigo. |
| RF-07 | Em cada pedido, mostrar o setor atual, quantas etapas faltam, o prazo, o selo de Recuperação e o saldo (Cliente) ou as peças (Feira). |
| RF-08 | Abrir a ficha completa do pedido, com valores e linha do tempo. |

### Novo pedido (4 passos)
| ID | Requisito |
|---|---|
| RF-09 | Passo 1, Cliente: escolher Cliente ou Feira. Cliente: buscar cliente salvo por nome, documento ou cidade, ou cadastrar um novo (nome, CPF/CNPJ, telefone, cidade). Feira: informar a descrição. |
| RF-10 | Passo 2, Produtos: buscar no catálogo, preencher a grade adulto (PP a XG) ou infantil (2 a 14) e marcar adicionais (patch, punho, gola V). Mostrar a faixa de preço, quantas peças faltam para a faixa mais barata e o subtotal. |
| RF-11 | Passo 3, Produção: prioridade, data de entrega com semáforo, bordado, tipo de punho, detalhes, cores e fotos de referência. Mostrar a prévia da rota e a malha do calção tirada dos produtos. |
| RF-12 | Passo 4, Revisão: resumo do pedido, entrada sugerida de 50%, valor recebido, forma de pagamento e comprovante. |
| RF-13 | Validar cada passo antes de avançar e permitir voltar aos passos já feitos sem perder o que foi preenchido. |
| RF-14 | Ao confirmar, numerar o pedido, gravar a entrada (se houver) e enviá-lo para o Design. |

### Orçamento
| ID | Requisito |
|---|---|
| RF-15 | Gerar a folha de orçamento (prévia, antes de confirmar, ou do pedido já aberto) com dados da empresa, do cliente, itens com grade, total, pagamentos e saldo. |
| RF-16 | Imprimir ou salvar o orçamento em PDF. |
| RF-17 | Montar a mensagem do orçamento para o WhatsApp, pronta para copiar. |

### Fila do setor
| ID | Requisito |
|---|---|
| RF-18 | Listar só os pedidos do setor, com número, nome, tipo, prioridade, prazo, peças e selo de Recuperação. |
| RF-19 | Filtrar a fila em Todos, Urgentes e Atrasados, com a contagem de cada um. |
| RF-20 | Abrir a ficha de produção: fotos, produtos com grade, entrega, prioridade, bordado, punho, malha do calção, detalhes e linha do tempo. |
| RF-21 | Concluir a etapa com observação opcional, pedindo a máquina na Impressão e a quantidade final na Embalagem. |
| RF-22 | Pedir confirmação antes de concluir, mostrando o que foi informado e para onde o pedido vai. |
| RF-23 | No Laser e na Conferência, devolver o pedido ao Design com o motivo. |
| RF-24 | Atualizar a fila em todos os aparelhos do setor quando um pedido entra ou sai. Na primeira versão, por consulta automática a cada 20 s e ao voltar para a tela; tempo real fica para depois. |

### Financeiro e entrega
| ID | Requisito |
|---|---|
| RF-25 | Mostrar o recebido no dia, nos últimos 7 dias e no mês, e o total a receber. |
| RF-26 | Listar os pedidos de Cliente que saíram da Embalagem, com total, recebido, saldo, percentual pago e peças embaladas. |
| RF-27 | Registrar recebimento com valor, forma e comprovante. |
| RF-28 | Confirmar a entrega, o que conclui o pedido. |

### Direção
| ID | Requisito |
|---|---|
| RF-29 | Mostrar 6 indicadores: em produção, atrasados, urgentes, peças finalizadas hoje, a receber e recebido no mês. |
| RF-30 | Mostrar o quadro com uma coluna por setor, mais Financeiro e Concluídos hoje, com pedidos e peças em cada uma. |
| RF-31 | Listar em "Atenção" os pedidos atrasados e os em recuperação, com o motivo. |
| RF-32 | Mostrar o gráfico de peças por setor. |
| RF-33 | Abrir a ficha de qualquer pedido em modo leitura, com a linha do tempo completa. |
| RF-34 | Aba **Preços**: quem tem a permissão (Administrador e o Atendimento escolhido) busca os produtos, cria um produto novo (nome, malha, preço de 10 peças ou mais e de menos de 10), altera nome, malha e preços e ativa ou desativa o produto. A mudança vale para os pedidos novos; os pedidos já abertos mantêm o preço do dia. O Administrador dá ou tira a permissão na tela de Usuários. |

## 6. Regras de negócio

### Pedido
| ID | Regra |
|---|---|
| RN-01 | Há dois tipos de pedido: Cliente, que tem cobrança, e Feira, que não tem e termina na Embalagem. |
| RN-02 | O número do pedido é sequencial e dado pelo sistema na confirmação. |
| RN-03 | Pedido de Cliente exige um cliente salvo ou um novo com nome de pelo menos 3 letras. Pedido de Feira exige descrição de pelo menos 3 letras. |
| RN-04 | Todo pedido tem pelo menos 1 produto, e cada produto tem pelo menos 1 peça na grade. |
| RN-05 | A data de entrega é obrigatória e não pode ser anterior a hoje. |
| RN-06 | A prioridade é Normal, Alta ou Urgente; o padrão é Normal. |

### Preço
| ID | Regra |
|---|---|
| RN-07 | O preço unitário vem do catálogo pela faixa do produto: 10 peças ou mais usa o preço menor, menos de 10 usa o maior. Exemplo: camisa adulto helanca custa R$ 30,00 com 10 ou mais e R$ 36,00 com menos. |
| RN-08 | A faixa é contada por produto do pedido, não pelo pedido inteiro. (Pendente de confirmação, D6.) |
| RN-09 | Os adicionais somam ao unitário de todas as peças do produto: patch R$ 7,00, punho R$ 5,00, gola V R$ 2,00. |
| RN-10 | Subtotal = peças × (preço da faixa + adicionais). Total = soma dos subtotais, arredondado em centavos. |
| RN-11 | O catálogo tem 46 produtos (os 49 itens do sistema atual menos os 3 adicionais, que viraram campos). O Administrador e a Direção sempre alteram produtos e preços; no Atendimento, só quem recebeu essa permissão do Administrador. Setor nunca. |
| RN-12 | Pedido de Feira mostra um valor de referência, mas não gera cobrança nem saldo. |

### Coerência do cadastro
| ID | Regra |
|---|---|
| RN-13 | Se algum produto tem patch, o pedido tem bordado e passa pelo setor de Bordado. |
| RN-14 | Se algum produto tem o adicional punho, o tipo de punho não pode ser "Sem punho". |
| RN-15 | A malha do calção é a malha dos produtos de calção, bermuda ou calça do pedido; sem esses produtos, é "Não se aplica". Não é escolhida à parte. |

### Rota de produção
| ID | Regra |
|---|---|
| RN-16 | A ordem é Design, Impressão, Batida, Laser, Conferência, Bordado, Costura, Embalagem. Todo pedido novo começa no Design. |
| RN-17 | Sem bordado, a Conferência vai direto para a Costura. |
| RN-18 | Depois da Embalagem, pedido de Cliente vai para Financeiro e entrega; pedido de Feira é concluído. |
| RN-19 | O pedido está em um só lugar por vez, e só o setor onde ele está pode concluí-lo. |
| RN-20 | A Impressão só conclui informando a máquina: 02, 03 ou 04. |
| RN-21 | A Embalagem só conclui informando a quantidade final, de pelo menos 1, que já vem preenchida com o previsto. Se for diferente, a confirmação mostra o previsto. |
| RN-22 | Toda conclusão pede confirmação antes de mover o pedido. |
| RN-23 | Laser e Conferência podem devolver o pedido ao Design com um motivo de pelo menos 3 letras. O pedido fica marcado como Recuperação até o Design concluir e depois segue a rota normal a partir da Impressão. |

### Pagamento e entrega
| ID | Regra |
|---|---|
| RN-24 | A entrada sugerida é 50% do total e é só referência: o campo vem vazio, e vazio quer dizer que não houve entrada. |
| RN-25 | O valor recebido não pode ser negativo nem passar do total (na entrada) ou do saldo (nos recebimentos). |
| RN-26 | Havendo valor, a forma de pagamento é obrigatória: Pix, Dinheiro, Cartão, Boleto ou Transferência. Nenhuma vem marcada. |
| RN-27 | Valores são lidos no formato brasileiro: "1.500", "1.500,00" e "1500,5" são aceitos; um valor que não dá para entender é recusado. |
| RN-28 | Saldo = total − recebido, nunca negativo. |
| RN-29 | Além da entrada, só se registra recebimento quando o pedido está em Financeiro e entrega. (Pendente de confirmação, D10.) |
| RN-30 | A entrega só é confirmada com saldo zero, e confirmar a entrega conclui o pedido. |
| RN-31 | Todo recebimento tem comprovante. Na demonstração ele é opcional; na versão online é obrigatório. |
| RN-32 | Um recebimento gravado não é editado nem apagado. A forma de corrigir um lançamento errado está em aberto (D2). |

### Prazos e indicadores
| ID | Regra |
|---|---|
| RN-33 | "Hoje" é sempre o dia no horário de Fortaleza, inclusive depois das 21h. |
| RN-34 | Semáforo do prazo: vermelho depois da data de entrega; âmbar no dia, na véspera e a 2 dias; verde com 3 dias ou mais. |
| RN-35 | As filas e listas são ordenadas por prioridade, depois pela data de entrega mais próxima, depois pelo número. |
| RN-36 | Peças finalizadas no dia = soma das quantidades finais informadas pela Embalagem naquele dia, de Cliente e de Feira. Recebido no mês conta desde o dia 1º. |
| RN-37 | Toda ação grava no histórico quem fez, quando, a etapa e o que foi informado (observação, máquina, peças, valor, motivo). |

## 7. Requisitos não funcionais

| ID | Requisito |
|---|---|
| RNF-01 | **Permissão no servidor.** Cada perfil só recebe do servidor os dados que a tabela de perfis permite. Esconder um botão não conta como proteção. |
| RNF-02 | **LGPD.** CPF/CNPJ, telefone e endereço de cliente são dados pessoais: só Atendimento, Direção e Administrador acessam, e o acesso fica registrado. |
| RNF-03 | **Arquivos privados.** Fotos e comprovantes ficam em armazenamento privado. Cada setor abre só as fotos dos pedidos que estão com ele; comprovantes, só Atendimento, Direção e Administrador. |
| RNF-04 | **Duas pessoas no mesmo pedido.** Se duas pessoas tentam mover o mesmo pedido ao mesmo tempo, só a primeira vale; a segunda recebe aviso para atualizar a tela. |
| RNF-05 | **Fila atualizada.** Quando um pedido entra ou sai de uma fila, todos os aparelhos daquele setor atualizam sem recarregar a página: na primeira versão em até 20 s, por consulta automática; tempo real fica para depois. |
| RNF-06 | **Fuso horário.** Datas de pedido, prazos e relatórios usam America/Fortaleza também no servidor. |
| RNF-07 | **Aparelhos.** Funciona em celular, tablet e computador, em navegador atual, sem instalar nada. A fila do setor é pensada para uso no celular, com botões grandes. |
| RNF-08 | **Histórico imutável.** Eventos do histórico e recebimentos só são incluídos, nunca alterados ou apagados pelo sistema. |
| RNF-09 | **Cópia de segurança.** O banco tem cópia automática diária (exige o plano Pro do Supabase; o gratuito não faz backup), e a conta fica no nome da MA. |
| RNF-10 | **Acessibilidade.** Uso por teclado, foco visível, textos para leitor de tela e contraste legível no tema claro e no escuro, como na demonstração. |

## 8. Decisões em aberto com a MA

Cada uma muda regras do documento. A coluna "Enquanto isso" é o que o código assume, e deve ser trocado quando a MA responder.

| ID | Decisão | Antes de | Enquanto isso |
|---|---|---|---|
| D1 | Editar e cancelar pedido: quem corrige tamanho, malha, prazo ou prioridade depois de aberto, e quem cancela | Etapa 1 | Não é possível editar nem cancelar |
| D2 | Corrigir recebimento errado (RN-32): estorno com motivo, quem faz, se a Direção aprova | Etapa 2 | Recebimento não se corrige |
| D3 | Recuperação parcial (RN-23): volta o pedido inteiro ou só as peças com defeito; passa de novo por todos os setores ou volta direto ao setor que devolveu | Etapa 1 | Volta o pedido inteiro ao Design e depois à Impressão |
| D4 | Patch é bordado na MA? (RN-13): se for comprado pronto e só costurado, a regra sai | Etapa 1 | Patch exige bordado |
| D5 | Preço do punho (RN-14): quais tipos de punho cobram os R$ 5,00 | Etapa 2 | Adicional "punho" exige tipo de punho diferente de "Sem punho" |
| D6 | Faixa de preço (RN-08): as 10 peças contam por produto ou pelo pedido inteiro | Etapa 2 | Por produto (comentário aberto no documento) |
| D7 | Adicional em parte das peças (RN-09): por exemplo, patch em só 5 de 20 camisas | Etapa 2 | Vale para todas as peças do produto |
| D8 | Tamanhos: faltam G1 a G3, XGG ou 16 anos | Etapa 1 | Adulto PP a XG; infantil 2 a 14 |
| D9 | Numeração (RN-02): número automático ou o número de lote que a MA já usa | Etapa 1 | Número automático e sequencial |
| D10 | Pagamento durante a produção (RN-29): o cliente pode pagar parte antes de o pedido chegar ao Financeiro | Etapa 2 | Só na abertura e no Financeiro |
| D11 | O que o setor vê do cliente: hoje, nome e cidade; para pessoa física, uma opção é mostrar só o número do pedido | Etapa 1 | Setor vê o nome do cliente (campo `descricao` do pedido); nunca documento nem telefone |
| D12 | Diferença na Embalagem (RN-21): quando faltam peças, se o motivo é obrigatório e quem é avisado | Etapa 1 | Só mostra o previsto na confirmação |
| D13 | Login de quem não tem e-mail: o login é por e-mail; sem caixa de entrada, "esqueci a senha" não chega e o Administrador redefine | Etapa 1 | Login por e-mail |
| D14 | Cores do pedido (RF-11): a demonstração usava as cores só para desenhar a camisa; com fotos reais elas perdem a função. Manter ou tirar | Etapa 1 | Não existe campo de cores |
| D15 | Fotos de referência: quem envia (hoje só Atendimento e Administrador), quantas (6 por pedido) e o tamanho (a tela reduz para 1600 px, até 2 MB) | Etapa 1 | Os limites do código |

## 9. Entrega em etapas

Os prazos das etapas 1 a 4 são **estimativa** e dependem de a MA entregar a tempo o que está na lista abaixo. Soma: cerca de 5 semanas, com as etapas uma depois da outra.

| Etapa | Entrega | Prazo estimado | O que a MA recebe |
|---|---|---|---|
| 0 | Demonstração navegável (entregue em 20/10/2026) | — | Protótipo para clicar e testar, com dados de mentira |
| 1 | Base, login e filas dos setores | cerca de 1 semana | Sistema no ar, usuário e senha por pessoa, fila de cada um dos 8 setores no celular, concluir etapa, devolver ao Design, máquina na Impressão, quantidade na Embalagem, e um cadastro simples de pedido para o Atendimento (cliente, produtos com tamanhos em tabela, prazo, prioridade e fotos) |
| 2 | Orçamento completo e financeiro | cerca de 1 semana | Catálogo e preços que a MA atualiza, preço calculado, orçamento em PDF e mensagem de WhatsApp, recebimentos com comprovante, saldo e entrega |
| 3 | Direção, relatórios e pedidos antigos | cerca de 1 semana | Quadro da Direção e relatórios; pedidos do sistema atual importados (tamanhos escritos à mão conferidos por uma pessoa) |
| 4 | Uso acompanhado e ajustes | 2 semanas | Acompanhamento enquanto os setores usam, orientação curta por perfil, aceite da MA; o arquivo antigo fica só para consulta |

**O que precisamos da MA**

| Item | Para quê | Para quando |
|---|---|---|
| Lista de pessoas por setor | Criar os acessos e saber quantas contas são | Antes da Etapa 1 |
| Titular da conta do sistema (hospedagem e banco) | A conta fica no nome da MA | Antes da Etapa 1 |
| Confirmação da sequência dos setores e do nome "Batida" | A ordem foi passada de memória | Antes da Etapa 1 |
| Aparelhos e internet de cada setor | Saber se há celular, tablet ou computador e Wi-Fi | Antes da Etapa 1 |
| Catálogo e preços atualizados (patch, punho, gola V) | Os preços hoje estão no arquivo antigo (49 itens) | Antes da Etapa 2 |
| Quem cuida de preços, catálogo e acessos depois | Os preços ficam na tabela `produtos`; o Administrador, a Direção e quem o Administrador escolher no Atendimento atualizam pela aba Preços (RN-11). Falta a MA dizer quem | Antes da Etapa 2 |
| Quem cuida do financeiro | Definir quem registra recebimentos e confirma entregas | Antes da Etapa 2 |
| Resposta sobre a Feira (continua sem passar pelo financeiro?) | Hoje termina na Embalagem | Antes da Etapa 2 |
| Arquivo de cópia de segurança do sistema atual | Trazer os pedidos antigos | Antes da Etapa 3 |

**Cuidados do plano de migração**
- Dados de clientes (CPF/CNPJ, telefone, endereço) são dados pessoais: a LGPD vale. Isso pede login de verdade, acesso restrito por perfil e cópias de segurança automáticas. Confirmar os detalhes com o jurídico da MA.
- A permissão precisa ser aplicada no servidor, não só na tela.
- Revisão técnica do login e das permissões por alguém com experiência em programação, antes de liberar para toda a equipe.
- Entrada gradual: rodar alguns dias com duas ou três pessoas em paralelo com o método atual e só então liberar.

## 10. Arquitetura e tecnologias

Resumo; o detalhe, as versões e os cuidados estão em [TECNOLOGIAS.md](TECNOLOGIAS.md).

| Camada | Tecnologia |
|---|---|
| Interface | Vite + React + TypeScript, TanStack Router e Query |
| Regras compartilhadas | Zod, em `packages/shared` |
| API | Hono nos Cloudflare Workers |
| Banco | PostgreSQL no Supabase, acessado pela API via Hyperdrive |
| Login | Supabase Auth (só confirma quem é a pessoa) |
| Arquivos | Cloudflare R2, por dentro da API (ainda não construído) |

Princípios:
1. **Só a API decide o que cada pessoa pode fazer.** O navegador nunca fala com o banco.
2. **Papel e setor vêm da tabela `perfis`**, nunca do token.
3. **RLS ligado e sem acesso para a chave pública** do Supabase em todas as tabelas.
4. **Mover pedido é uma transação** com checagem de etapa e versão (a coluna `versao` evita duas pessoas mexendo ao mesmo tempo).
5. **As mesmas regras na tela e na API**: ficam em `packages/shared`.

## 11. Dados e vocabulário

**Vocabulário fixo** (fica em `packages/shared`; mudar aqui exige mudar lá):
- **Setores, em ordem:** Design, Impressão, Batida, Laser, Conferência, Bordado, Costura, Embalagem.
- **Etapas:** os 8 setores, mais Financeiro e Concluído.
- **Tipos de pedido:** Cliente, Feira.
- **Prioridades:** Normal, Alta, Urgente.
- **Máquinas da Impressão:** 02, 03, 04.
- **Papéis:** atendimento, setor, direcao, admin.
- **Formas de pagamento:** Pix, Dinheiro, Cartão, Boleto, Transferência.
- **Grade adulto:** PP, P, M, G, GG, XG. **Grade infantil:** 2, 4, 6, 8, 10, 12, 14.
- **Tipos de punho:** Sem punho, Punho ribana, Punho na mesma malha, Punho com listra.
- **Adicionais (por peça):** patch R$ 7,00, punho R$ 5,00, gola V R$ 2,00.
- **Malhas usadas no sistema atual:** Helanca, Dry Fit, Dry Fit Plus, Soft Trend, Malha 3D, Sensitive, Piquet, Outra.
- **Catálogo (Etapa 2):** 49 itens, com preço de 10 peças ou mais e de menos de 10; o texto completo está em `PCP_MA_Prototipo_corrigido.html` (constante `CATALOGO_MA`), na pasta acima do projeto. Os 3 últimos itens são os adicionais, que viram campos.

**Convenções de dados**
- Dinheiro em **centavos** (inteiro). Datas de entrega em `AAAA-MM-DD`; "hoje" sempre em America/Fortaleza.
- Todo pedido tem `versao`, que sobe a cada movimentação.
- O histórico guarda quem (`usuario_id`), quando, em que etapa e o que foi informado; só recebe inclusões.
- Tabelas, rotas e arquivos do código: ver a seção 12 e [TECNOLOGIAS.md](TECNOLOGIAS.md).

## 12. Estado da implementação

(Atualize ao final de cada trabalho. Última conferência: 26/10/2026.)

**Situação geral:** Etapa 1 quase completa (login, fila e ficha por setor, indicadores, abas e filtros do Atendimento, concluir etapa, devolver ao Design, novo pedido, fotos de referência e tela de usuários do Administrador) e o **Financeiro e entrega** já feito, com o valor do pedido digitado até o catálogo existir. 290 testes passando (107 de regras, 183 da API). A API e a interface estão **publicadas e rodam contra o Supabase e o Hyperdrive reais** (São Paulo), sem R2: fotos e comprovantes só funcionam depois que o R2 for ativado. Para ver o sistema funcionando sem contas: `npm run dev:local` (README).

**Padrões assumidos no Financeiro (confirmar com a MA):** o Atendimento, a Direção e o Administrador registram recebimentos e confirmam a entrega; "a receber" soma o saldo de todos os pedidos de Cliente em aberto; o recebido do dia, dos 7 dias e do mês usa o horário de Fortaleza; um recebimento não se edita nem se apaga (D2 em aberto).

**Legenda:** Feito = no código e testado. Parcial = parte do requisito. Não feito = ainda não existe.

### Requisitos funcionais

| ID | Estado | Onde / o que falta |
|---|---|---|
| RF-01 | Parcial | `pages/Login.tsx`, `auth.ts`. Falta rodar com o Supabase Auth real |
| RF-02 | Feito | Regra única em `packages/shared/src/permissoes.ts` (`veValores`, `registraPagamentos`), usada pela API e pela tela. A API responde 403; a tela mostra "não faz parte do seu perfil". Cada perfil vê só o seu caminho (protótipo): setor, a fila do setor; atendimento, pedidos, novo pedido, financeiro e orçamento; direção, pedidos e orçamento para ler, financeiro, preços e o quadro (decidido em 05/11/2026, conforme a seção 3); só o administrador gerencia usuários |
| RF-03 | Feito | Botão "Sair" |
| RF-04 | Feito | `pages/Usuarios.tsx`, `usuarios.ts`, `adminAuth.ts`: criar usuário (login e perfil), ativar e desativar, trocar senha, editar nome, papel e setor (`edicaoUsuarioBody`, `mudancasDoUsuario`). Cada edição grava quem mudou, quando, antes e depois em `alteracoes_usuarios` (migração 006, só inclusões), visível em "Alterações". O Administrador não tira de si o papel; sair do Atendimento tira a permissão de preços. O cliente da API de administração do Supabase (`adminSupabase`) só foi testado com respostas simuladas e precisa da chave `service_role` como segredo do Worker |
| RF-05 | Feito | Cinco indicadores no topo de `pages/Fila.tsx` (atendimento e admin): em produção (com peças), aguardando o financeiro, valor a receber, entregas da semana e atrasados |
| RF-06 | Feito | Abas Em andamento e Concluídos (`GET /fila?aba=`); os concluídos mostram os 50 mais recentes |
| RF-07 | Feito | Setor atual, trilha por etapa (Bordado riscado quando não se aplica), etapas feitas e faltantes (`progressoDoPedido`), prazo, selo e motivo da recuperação, peças e o saldo ou "quitado" (valores só para atendimento e admin) |
| RF-08 | Parcial | Ficha em `components/Ficha.tsx` e `GET /lotes/:id`, com bloco de valores e recebimentos na linha do tempo (atendimento, direção e admin). Falta a malha por produto e a do calção (Etapa 2) |
| RF-09 | Feito | `pages/NovoPedido.tsx`, `clientes.ts` |
| RF-10 | Feito | Passo 2 de `pages/NovoPedido.tsx`: busca no catálogo de 46 produtos (tabela `produtos`, migração 002), grade adulta ou infantil conforme o produto, adicionais, faixa de 10 peças por produto (D6), subtotal e total calculados pela API (`pedidos.ts`, `shared/src/orcamento.ts`) e copiados para o item no dia do pedido |
| RF-11 | Parcial | Prioridade, entrega, bordado, punho, detalhes, fotos, prévia da rota e malha do calção (vem dos produtos de calção, bermuda ou calça); as cores perdem a função com fotos reais (decisão D14) |
| RF-12 | Feito | Passo 4: resumo com preços, valor total calculado, entrada sugerida de 50%, forma de pagamento, comprovante e prévia do orçamento |
| RF-13 | Feito | Validação por passo com as mesmas regras do servidor |
| RF-14 | Feito | Numera, grava a entrada e envia ao Design numa transação (`pedidos.ts`) |
| RF-15, RF-17 | Feito | `pages/Orcamento.tsx` (`/orcamento/:id`), `components/FolhaDoOrcamento.tsx`, `components/MensagemWhatsapp.tsx`, rota `GET /lotes/:id/orcamento` (só atendimento e admin). A mensagem do WhatsApp é montada para copiar; nada é enviado. Dados da empresa: só o nome e a cidade até a MA informar CNPJ, telefone e endereço (`FolhaDoOrcamento.tsx`) |
| RF-16 | Feito | Impressão em A4 e salvar como PDF pelo navegador, com a logo da MA (`apps/web/public/logo-ma.png`) |
| RF-18 | Feito | `GET /fila` |
| RF-19 | Feito | Filtros Todos, Urgentes e Atrasados, com contagem (`FILTROS` em `pages/Fila.tsx`) |
| RF-20 | Feito | Ficha com fotos, produtos com malha, grade, especificações, malha do calção e linha do tempo |
| RF-21 | Feito | `concluir.ts`, janela em `pages/Fila.tsx` |
| RF-22 | Feito | Janela de confirmação mostra o que foi informado e o destino |
| RF-23 | Feito | `devolver.ts`, botão na janela de concluir |
| RF-24 | Feito | Consulta a cada 20 s e ao voltar para a aba |
| RF-25 a RF-28 | Feito | `pages/Financeiro.tsx`, `financeiro.ts`, rotas `GET /financeiro`, `POST /lotes/:id/recebimentos`, `POST /lotes/:id/entregar`, comprovantes em `/recebimentos/:id/comprovante`. Atendimento, Direção e Administrador registram; o setor não tem acesso. O comprovante precisa do R2 ativo (ainda não está) |
| RF-29 a RF-32 | Feito | `pages/Quadro.tsx`, `quadro.ts`, regra em `shared/src/quadro.ts`, rota `GET /quadro` (direção e admin): 6 indicadores, uma coluna por setor mais Financeiro e Concluídos hoje, lista "Atenção" e gráfico de peças por setor |
| RF-33 | Feito | A Direção abre a ficha pelo quadro, com a linha do tempo primeiro e os valores |
| RF-34 | Feito | `pages/Precos.tsx`; rotas `GET /precos`, `POST /precos`, `POST /precos/:id` e `POST /usuarios/:id/precos` (só o Administrador dá a permissão). Preços entre R$ 0,01 e R$ 10.000,00 por peça; o preço de 10 peças ou mais não passa o de menos de 10; nome repetido dá 409 |

### Regras de negócio

| ID | Estado | Onde / o que falta |
|---|---|---|
| RN-01 | Feito | `pedidoBody` e `proximaEtapa` |
| RN-02 | Feito | Sequência do banco (`lotes.numero`) |
| RN-03 a RN-06 | Feito | `packages/shared/src/pedido.ts` (e a data em `prazo.ts`), testadas na API e na tela |
| RN-07 a RN-10 | Parcial | Funções de preço em `shared/src/preco.ts`, testadas; ainda não usadas no pedido (Etapa 2) |
| RN-11 | Feito | `packages/shared/src/produto.ts` (`podeGerenciarPrecos`, `produtoBody`), `apps/api/src/precos.ts`, coluna `perfis.gerencia_precos` (migração 003), `pages/Precos.tsx` e botão na tela de Usuários |
| RN-12 | Não feito | Valor de referência da Feira |
| RN-13, RN-14 | Feito | `pedidoBody`; a tela força o bordado quando há patch |
| RN-15 | Não feito | Depende do catálogo |
| RN-16 a RN-23 | Feito | `rota.ts`, `concluir.ts`, `devolver.ts` |
| RN-24 a RN-26, RN-28 a RN-30, RN-32 | Feito | `shared/src/pagamento.ts` (regras e corpos), `apps/api/src/financeiro.ts`; testes em `pagamento.test.ts` e `financeiro.test.ts` |
| RN-27 | Feito | `lerValorEmCentavos` (`shared/src/preco.ts`), usado nos campos de valor da tela |
| RN-31 | Parcial | O comprovante é pedido na tela e marcado como "sem comprovante" quando falta, mas a API não bloqueia o recebimento sem ele: o R2 ainda não está ativo. Passa a ser obrigatório quando o R2 entrar |
| RN-33 a RN-35 | Feito | `diaEmFortaleza`, `semaforoDoPrazo`, ordem da fila |
| RN-36 | Feito | `obterQuadro` (peças da Embalagem no dia, horário de Fortaleza) e `montarQuadro` |
| RN-37 | Feito | O histórico grava quem, quando, etapa, observação, máquina, peças e motivo (cadastro, conclusão, devolução, entrega). Cada recebimento fica na tabela `recebimentos` (valor, forma, quem, quando, comprovante), que o setor nunca vê |

### Requisitos não funcionais

| ID | Estado | Nota |
|---|---|---|
| RNF-01 | Feito | Permissões na API, com testes por perfil |
| RNF-02 | Feito | O setor nunca recebe documento nem telefone (testado). A busca de clientes sai sem telefone e com o CPF mascarado (`mascararDocumento`); a ficha e o orçamento, que entregam os dados completos, gravam em `acessos_dados_pessoais` (migração 004) quem recebeu os dados de qual cliente, logo antes de responder (se o registro falhar, o dado não sai); o banco recusa alterar ou apagar o registro (`acessos.test.ts`). Pedido de exclusão (LGPD art. 18): o Administrador registra na tela LGPD e o sistema mostra a partir de quando pode anonimizar (5 anos a partir de 1º de janeiro do ano seguinte ao pedido mais recente, art. 173 do CTN; constante `PRAZO_DE_GUARDA_ANOS`); a anonimização limpa cadastro, descrição e observações dos pedidos e guarda quem fez (migração 005, `lgpd.test.ts`). CNPJ não entra. Falta (decisão da MA): tela para consultar o registro de acessos, por quanto tempo guardá-lo, e o contador confirmar o prazo de guarda |
| RNF-03 | Parcial | Fotos privadas: só saem da API, com a permissão por setor (`fotos.ts`, testado); o R2 de verdade ainda não foi verificado. Comprovantes ficam para a Etapa 2 |
| RNF-04 | Feito | `versao` e checagem de etapa na gravação; dois cliques testados |
| RNF-05 | Feito | Em até 20 s |
| RNF-06 | Feito | Datas e prazos em Fortaleza |
| RNF-07 | Parcial | Conferido em tela de 375 px, sem rolagem lateral; não testado em aparelhos reais |
| RNF-08 | Parcial | A API não tem rota para alterar nem apagar histórico; o banco em si não bloqueia |
| RNF-09 | Não verificado | Depende do plano Pro do Supabase |
| RNF-10 | Parcial | Esc fecha janelas, o foco vai para dentro e volta, foco visível nas opções; sem armadilha de foco completa e sem teste com leitor de tela |

### Decisões em aberto que o código já assume

D3 (a recuperação volta o pedido inteiro), D4 (patch exige bordado), D8 (grades adulto PP a XG e infantil 2 a 14), D9 (número automático), D11 (o setor vê o nome do cliente, em `descricao`). Quando a MA responder, mudar o código e a tabela da seção 8.

### Dados, rotas e arquivos

- **Tabelas** (`db/schema.sql`): `perfis`, `clientes`, `lotes`, `itens_pedido`, `historico`. RLS ligado e sem acesso para `anon` e `authenticated`.
- **Rotas, tecnologias e comandos:** [TECNOLOGIAS.md](TECNOLOGIAS.md).
- **Regras compartilhadas:** `packages/shared/src` (`rota.ts`, `preco.ts`, `prazo.ts`, `pedido.ts`, `schemas.ts`).

## 13. Convenções de código

- **Idioma:** domínio em português (etapa, setor, lote, pedido, fila); código de infraestrutura em inglês onde o ecossistema pede.
- **Erros da API:** 400 dados inválidos (com lista de campos); 401 sem login ou token inválido; 403 sem permissão; 404 não encontrado; 409 conflito (outra pessoa já mexeu, ou o pedido já passou pelo setor). A mensagem é sempre uma frase clara para o usuário final.
- **Regras novas** entram em `packages/shared` com teste, antes de entrar na tela ou na API.
- **Testes da API** rodam contra Postgres de verdade em memória (PGlite) com o `db/schema.sql` real.
- **Banco:** enquanto nada foi implantado, `db/schema.sql` é editado no lugar. Depois da primeira implantação, toda mudança vira migração.
- **Segredos** nunca entram no repositório (`.dev.vars`, `.env` estão no `.gitignore`).
- **Depois de trocar a versão maior do React:** `npm dedupe` e conferir com `npm ls react` que só existe uma cópia.

## 14. Arquivos da pasta do projeto (fora de `pcp-ma/`)

| Arquivo | O que é | Autoridade |
|---|---|---|
| `Plano versão online do sistema de controle de produção.pdf` | Plano técnico de migração em etapas (15/10/2026) | Contexto e cuidados |
| `02 - Plano simples (se ele quiser ver as etapas).pdf` | Versão para o cliente: fluxo, dia a dia de cada perfil, etapas, o que precisamos da MA (20/10/2026) | Escopo e etapas combinados com a MA |
| `Requisitos e regras de negócio · PCP MA Fardamentos.pdf` | Exportação do documento de requisitos | Cópia; a fonte é o documento no claude.ai |
| `PCP_MA_Comprovantes_Visiveis (1).html` | Sistema atual mais completo (vendas, orçamento, financeiro) | Como o cliente trabalha hoje |
| `PCP_MA_Central_Direcao_Dashboard_Producao_Setor_Dia.html`, `PCP_MA_Recuperacao_Conferencia_e_Laser.html` | Versões anteriores do sistema atual | Só histórico |
| `PCP_MA_Prototipo_corrigido.html` | Cópia local da demonstração publicada, com 6 correções | Referência visual e de comportamento |
| Demonstração publicada ([claude.ai/artifact/LBWuRAoFfeuCkzkiWKTHok](https://claude.ai/artifact/LBWuRAoFfeuCkzkiWKTHok)) | Protótipo para clicar, com dados de mentira | **Só referência visual do front**; não é o código do sistema |

A demonstração foi corrigida (entrada de 50% vazia por padrão, valor com ponto lido certo, patch exige bordado, punho coerente com o adicional, malha do calção vinda dos produtos, confirmação antes de concluir). O que na demonstração era só simulação **não é requisito**: a senha "demo", o desenho da camisa no lugar de foto, o comprovante opcional e o WhatsApp que só copia o texto.

## 15. Decisões tomadas e por quê

| Tema | Decisão | Motivo |
|---|---|---|
| Backend | Hono nos Workers, não NestJS no Render | Tudo na Cloudflare, sem servidor; NestJS seria opção se a equipe o dominasse |
| Login | Supabase Auth, não Clerk nem Better Auth | Já está com o banco, uma conta a menos; login é a parte mais arriscada de construir |
| Arquivos | Cloudflare R2, não Supabase Storage | Regras de acesso num só lugar (a API) |
| Acesso ao banco | Só pela API | Regras testáveis em TypeScript, num lugar só |
| Fila | Consulta a cada 20 s | Mais simples; tempo real entra depois se fizer falta |
| PDF do orçamento | O navegador imprime | Workers não são o lugar para gerar PDF |
| Preparados do banco | Ligados | A Cloudflare recomenda com o Hyperdrive; desligar pode travar consultas |
| Versões | Atualizadas para as atuais (23/10/2026); TypeScript no 5.9 | Auditoria em 0 vulnerabilidades; TypeScript 7 é uma reescrita ainda sem suporte confirmado |
| Planos pagos | Workers pago e Supabase Pro para produção | Gratuito dos Workers limita a 10 ms de CPU; gratuito do Supabase pausa e não faz backup |

## 16. Skills de IA instaladas

Em `.claude/skills/` (raiz do projeto): `frontend-design`, `vercel-react-best-practices` (focada em Next.js e SWR; o projeto usa TanStack Query) e `ui-ux-pro-max` (precisa de Python 3; o `SKILL.md` foi ajustado para rodar `scripts/search.py` a partir da pasta da skill). `frontend-design` e `ui-ux-pro-max` podem sugerir direções de design diferentes: decidir qual manda em caso de conflito.
