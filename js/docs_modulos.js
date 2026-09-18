/*
 * ATLAS — Registro central de documentação dos módulos.
 *
 * Fonte ÚNICA de verdade do conteúdo informativo: alimenta o popover de regras
 * (componente AtlasInfo) e, no futuro, uma eventual exportação das regras.
 *
 * O conteúdo fica em DADOS ESTRUTURADOS (não HTML) — cada módulo tem seções
 * tipadas, o que permite renderizar tanto no popover quanto em outros formatos.
 *
 * Estrutura de uma entrada:
 *   window.AtlasDocs['<id-da-tela>'] = {
 *     titulo: 'OPME',
 *     secoes: [
 *       { titulo: 'Objetivo',  tipo: 'paragrafo',       conteudo: ['texto', ...] },
 *       { titulo: 'Fontes',    tipo: 'lista',           conteudo: ['item', ...] },
 *       { titulo: 'Cálculo',   tipo: 'lista-ordenada',  conteudo: ['passo', ...] },
 *       { titulo: 'Glossário', tipo: 'glossario',       conteudo: [['termo','definição'], ...] },
 *     ]
 *   };
 *
 * Convenção de ênfase: **texto** vira negrito ao renderizar (resto é escapado).
 */
(function () {
  'use strict';
  window.AtlasDocs = window.AtlasDocs || {};

  window.AtlasDocs['desempenho-opme'] = {
    titulo: 'OPME',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'OPME é a sigla de **Órteses, Próteses e Materiais Especiais** — os implantes usados na cirurgia (válvulas, stents, dispositivos de glaucoma). O médico recebe um percentual sobre o material implantado, e este módulo existe para **conferir se esse repasse saiu certo**.',
        'A tela é dividida em **dois painéis lado a lado**: à esquerda o **Relatório QVIS** (a base de pagamento, que já traz a coluna REPASSADO calculada pelo próprio QVIS) e à direita a **Produção QVIS** (a prova de que o procedimento aconteceu, com o valor bruto). Comparar os dois é o trabalho: o que foi produzido, o que foi recebido e o que foi repassado.',
        'O módulo **não recalcula do zero** — ele valida, corrige subfaturamento e sinaliza glosa.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Importe o **Relatório QVIS** e a **Produção QVIS** do mês. Sem as duas bases, um dos painéis fica vazio e a conferência não fecha.',
        'Abra **⚙ Ajustes** e confira os **termos elegíveis** — as palavras que identificam um OPME no nome do produto (AHMED, ISTENT, MP3, PRESERFLO, VÁLVULA…). Se um material novo entrou na casa, cadastre o termo aqui; sem isso ele não aparece no módulo.',
        'Ainda em Ajustes, cadastre os **valores fixos por convênio** dos OPMEs que o relatório traz subfaturados, e as **% específicas por médico** que fogem dos 10% gerais.',
        'Escolha **Mês** e **Ano** no topo.',
        'Percorra o painel da esquerda comparando com o da direita. Use os campos **Admissão · Médico · Convênio · Paciente** — eles filtram os dois painéis ao mesmo tempo.',
        'Confira as **glosas** (recebido = 0): são materiais implantados que o convênio não pagou. Levante a cobrança antes de fechar o mês.',
        'Marque como **pagas** as admissões conferidas. A marcação é por **admissão inteira**, e sincroniza os dois painéis.',
        'Use **Ocultar pagas** para ir limpando a tela e enxergar só o que falta.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**Relatório QVIS** (linhas_qvis) — a base de pagamento. Traz **REPASSADO** já calculado pelo QVIS, que é o valor que vai ao médico.',
        '**Produção QVIS** (linhas_producao) — a base de realização. Traz o valor **produzido** cru, sem nenhuma regra aplicada.',
        '**Termos elegíveis** (⚙ Ajustes) — o vocabulário que decide o que é OPME.',
        '**Valores fixos por convênio** (⚙ Ajustes) — a tabela de preço acertada, usada para corrigir material subfaturado.',
        '**% por médico** (⚙ Ajustes) — quando algum médico tem percentual diferente do geral.',
        '**Linhas EV** — entradas de valor antecipado, injetadas quando há Mês e Ano selecionados.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['1. O que é OPME', 'O produto entra se o nome contém TODOS os termos de\nalgum padrão cadastrado. O casamento ignora acento e\nhífen: "VALVULA DE AHMED" casa com o padrão "AHMED".'],
        ['2. Repasse base', 'repasse = valor do OPME × 10%   (percentual geral)\n\nSe o médico tem % específica cadastrada, ela\nsubstitui os 10%.'],
        ['3. Correção de subfaturamento', 'Havendo valor fixo cadastrado para aquele OPME naquele\nconvênio:\n   valor do OPME = valor fixo\n(vale tanto para corrigir a MENOR quanto a MAIOR)\n\nPlanos Particulares ficam de fora dessa regra.'],
        ['4. Linhas EV', 'repasse EV = repasse × (valor fixo ÷ produzido)\n(a linha antecipada herda o convênio da Produção e é\nescalada pela mesma razão)'],
        ['5. Cards do topo', 'Produzido   = soma da Produção\nRepasse     = soma APENAS das linhas já marcadas como pagas\nQuantidade  = admissões DISTINTAS (repassadas e produzidas)\nGlosas      = linhas com recebido = 0'],
        ['Contagem sem duplicar', 'A mesma admissão + procedimento se repete no QVIS com\nPAPEL diferente (médico, auxiliar…). Por isso cada valor\né contado 1× por admissão+procedimento — nunca somando\ntodas as linhas.']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        '**Produto:** VÁLVULA DE AHMED · convênio X · produzido no relatório R$ 4.000,00 · recebido R$ 4.000,00',
        'O nome contém "AHMED", que é um termo cadastrado → **é OPME elegível**.',
        'Em Ajustes existe **valor fixo de R$ 5.200,00** para esse OPME nesse convênio — o relatório veio subfaturado.',
        'Base corrigida = **R$ 5.200,00**. Percentual geral de 10%, e o médico não tem % própria.',
        '**Repasse = 5.200,00 × 10% = R$ 520,00** (e não R$ 400,00, que seria o valor do relatório cru).',
        'O card **Repasse** só passa a contar esses R$ 520,00 **depois** que a admissão for marcada como paga.'
      ] },

      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Mês / Ano** — atenção à diferença: o **Relatório** é filtrado pelo mês do **relatório de pagamento**; a **Produção**, pelo mês em que o procedimento foi **realizado**. São recortes diferentes de propósito.',
        '**Admissão · Médico · Convênio · Paciente** — quatro campos que filtram os **dois painéis** ao mesmo tempo (busca por trecho, ignorando acento).',
        '**Ocultar pagas** — esconde as linhas das admissões já conferidas.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'O **REPASSADO já vem pronto do QVIS**. Este módulo compara, valida e complementa — ele não é a fonte primária do cálculo.',
        'O painel da **Produção (direita) mostra o valor cru**. Quem aplica a regra de valor fixo é o painel do **Relatório (esquerda)**. Ver números diferentes nos dois lados é o esperado.',
        '**Glosa** aqui é produção com **recebido = 0**; linhas EV e Particular ficam de fora dessa contagem, e recebido nulo é tratado como zero.',
        'Desmarcar uma admissão já paga exige **senha de administrador** — é uma trava contra desfazer conferência por engano.',
        'Material novo sem **termo cadastrado** simplesmente **não aparece** no módulo. Se um OPME sumiu da tela, esse é o primeiro lugar a olhar.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['OPME', 'Órteses, Próteses e Materiais Especiais — o implante usado na cirurgia.'],
        ['EV', 'Entrada de valor: um adiantamento de repasse lançado antes do pagamento do convênio.'],
        ['Glosa', 'Produção com recebido = 0 — o convênio não pagou aquele item.'],
        ['Repassado', 'O valor que vai ao médico, já calculado pelo QVIS.'],
        ['Produzido', 'O valor bruto do procedimento na Produção QVIS.'],
        ['Admissão', 'O atendimento/conta que agrupa os procedimentos de um paciente.'],
        ['Subfaturamento', 'O relatório trouxe o material por um valor menor que o combinado; o valor fixo corrige.'],
        ['Termo elegível', 'A palavra-chave que faz um produto ser reconhecido como OPME.']
      ] }
    ]
  };

  window.AtlasDocs['desempenho-lio'] = {
    titulo: 'LIO',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'LIO é a **lente intraocular** implantada na cirurgia de catarata. Quando o paciente escolhe uma lente premium, há repasse sobre ela — e esse repasse se divide entre **quem operou** (executante) e **quem indicou** o paciente (indicante).',
        'O módulo tem **três abas**, e elas não são variações de tela: são **regras de negócio diferentes**. **Convênio** paga sobre o valor de tabela da lente cadastrada; **Particular** paga sobre o valor efetivamente cobrado; **Adicional** é um bônus sobre o quanto o particular passou do valor de tabela.',
        'É o módulo com mais cadastro por trás. Se a matriz vem vazia ou cheia de "SEM CADASTRO", quase sempre a resposta está em **⚙ Ajustes**, não nos dados.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Importe a **Produção QVIS** do mês (e o Relatório QVIS, que alimenta a aba Convênio).',
        'Abra **⚙ Ajustes** e confira os **percentuais gerais**: executante (padrão **18%**) e indicante (padrão **2,5%**). São eles que mandam no cálculo — não há número fixo no código.',
        'Ainda em Ajustes, **fixe os convênios** que entram na aba Convênio. A aba só lista linhas dos convênios marcados; sem nenhum marcado, ela fica vazia.',
        'Cadastre as **LIOs (OPME) com o valor de tabela por convênio**. Na aba Convênio, a base do repasse é esse valor cadastrado — produto sem cadastro aparece como **SEM CADASTRO** e paga zero.',
        'Se algum produto não deve ser tratado como LIO, use **EXCETO** para excluí-lo pelo termo (ex.: PRESERFLO).',
        'Escolha **Mês** e **Ano** e percorra a matriz. As colunas de Tipo e Produto têm filtro próprio no cabeçalho.',
        'Confira as admissões marcadas como **DUPLICADO** — são casos valorados em Convênio *e* em Particular. Decida qual lado vale e desabilite o outro pelo botão da própria linha.',
        'Para a aba **Adicional**: cadastre os **padrões de busca com valor de tabela** em ⚙ Ajustes → Adicional, confira a matriz e, quando estiver certa, clique em **Enviar** informando a competência — só então ela entra nos Relatórios.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**Produção QVIS** (linhas_producao) — apenas as linhas de classificação **OPME** cujo tipo é LIO, LENTE INTRA OCULAR ou SERVIÇO DE LIO.',
        '**Relatório QVIS** (linhas_qvis) — na aba Convênio, é o que confirma produzido e recebido da admissão.',
        '**Cadastro de LIOs/OPME com valor por convênio** (⚙ Ajustes) — a base do repasse na aba Convênio.',
        '**config_lio** — percentuais de executante e indicante, e a chave que liga ou desliga o pagamento ao indicante.',
        '**lio_convenios_flagados** — quais convênios entram na aba Convênio.',
        '**lio_exceto_termos** — termos que tiram um produto da classificação LIO.',
        '**lio_admissoes_desabilitadas** — admissões retiradas do cálculo por duplicidade.',
        '**Cadastro de Médicos / De-Para de Nomes** — para reconhecer executante e indicante mesmo quando a produção traz nome genérico.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['Quem é executante e quem é indicante', 'executante = cirurgião da linha\nindicante  = médico que indicou\n\nO indicante só recebe quando é DIFERENTE do executante —\nsenão a mesma pessoa seria paga duas vezes.'],
        ['Aba CONVÊNIO — base = valor cadastrado', 'base = valor de tabela da LIO cadastrada para aquele convênio\n\nrepasse executante = base × 18%\nrepasse indicante  = base × 2,5%   (só se indicante ≠ executante\n                                    e o pagamento estiver ligado)\nrepasse total      = executante + indicante\n\nSem LIO cadastrada que case com o produto → SEM CADASTRO,\nrepasse zero.'],
        ['Aba PARTICULAR — base = valor cobrado', 'base = valor da linha na Produção\n\nrepasse executante = base × 18%\nrepasse indicante  = base × 2,5%   (só se indicante ≠ executante)\nrepasse total      = executante + indicante'],
        ['Aba ADICIONAL — bônus sobre o excedente', 'diferença = produzido − valor de tabela do padrão\nse diferença > 0:\n   adicional = diferença × 50%   (percentual configurável)\nsenão: não há adicional\n\nSó paga médico com a especialidade CATARATA no módulo\nMédicos. Os demais aparecem marcados e não recebem.'],
        ['Total da matriz', 'O rodapé soma apenas as admissões HABILITADAS —\nas desabilitadas por duplicidade ficam de fora.']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        '**Convênio** · lente cadastrada com valor de tabela **R$ 6.000,00** · operada pelo Dr. A e indicada pela Dra. B:',
        'Executante = 6.000,00 × 18% = **R$ 1.080,00** · Indicante = 6.000,00 × 2,5% = **R$ 150,00** · **Total R$ 1.230,00**.',
        'Se o Dr. A também fosse o indicante, o indicante não entraria: total seria só **R$ 1.080,00**.',
        '— — —',
        '**Adicional** · padrão PANOPTIX com tabela **R$ 26.000,00**, produzido **R$ 40.000,00**:',
        'Diferença = 40.000 − 26.000 = R$ 14.000,00 → **adicional = 14.000 × 50% = R$ 7.000,00**, pago ao executante, desde que ele tenha a especialidade Catarata.'
      ] },

      { titulo: 'Aba ADICIONAL — detalhes', tipo: 'lista', conteudo: [
        'A matriz é composta pelos **produtos que casam com os padrões** cadastrados em **⚙ Ajustes → Adicional** (ex.: **PANOPTIX** pega todo produto que contenha PANOPTIX), aplicados sobre as admissões da aba **Particular**.',
        'A coluna **Padrão (cadastro)** mostra **todos** os padrões que casaram — o cálculo usa o **mais específico**. A mesma coluna aparece na aba Convênio, ali só como referência.',
        'É um valor **extra**: soma-se ao repasse normal do LIO.',
        'Enquanto não for **enviado**, o adicional é só conferência. O botão **Enviar** registra o **mês de competência** do QVIS a que ele se refere e faz as linhas entrarem nos Relatórios como **"LIO · ADICIONAL"**.'
      ] },

      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Mês / Ano** da realização.',
        '**Admissão · Paciente · Médico (indicante ou executante) · Cód. Paciente**.',
        'Filtros de coluna por **Tipo** e **Produto**, direto no cabeçalho da matriz.',
        'As três **abas** (Convênio · Particular · Adicional) são o filtro mais importante: cada uma é uma regra diferente.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        '**Matriz de Convênio vazia** tem quatro causas possíveis, e o módulo mostra um painel que aponta qual delas foi: não há LIO no QVIS do mês, nenhum convênio foi fixado, não há OPME na produção, ou os filtros/EXCETO zeraram tudo.',
        '**SEM CADASTRO** não é bug: é produto sem LIO cadastrada que case com ele. Sem base, não há como calcular.',
        'Os percentuais são **configuráveis**. Se o valor do mês veio diferente do esperado, confira antes de mais nada se alguém mexeu em ⚙ Ajustes.',
        'Os termos de **EXCETO** valem tanto na matriz quanto nas extrações — um produto excetuado não paga em lugar nenhum.',
        'Nome genérico na produção depende do **De-Para de Nomes** para achar o médico certo.',
        'A aba **Adicional** só vai para o consolidado depois do **Enviar**. Esquecer esse passo significa deixar o bônus de fora do mês.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['LIO', 'Lente intraocular implantada na cirurgia de catarata.'],
        ['Executante', 'O médico que realizou a cirurgia.'],
        ['Indicante', 'O médico que indicou o paciente. Só recebe quando é diferente do executante.'],
        ['OPME', 'Órteses, Próteses e Materiais Especiais — a LIO é um OPME.'],
        ['Valor de tabela', 'O preço cadastrado da lente para aquele convênio; é a base do repasse no Convênio.'],
        ['Adicional', 'Repasse extra: percentual da diferença entre o produzido e o valor de tabela do padrão.'],
        ['Padrão de busca', 'Texto cadastrado que casa com todo produto que o contém (ex.: PANOPTIX).'],
        ['EXCETO', 'Lista de termos que tiram um produto da classificação LIO.'],
        ['Duplicado', 'A mesma admissão valorada em Convênio e em Particular; uma das duas precisa ser desabilitada.']
      ] }
    ]
  };

  window.AtlasDocs['desempenho-estrabismo'] = {
    titulo: 'Estrabismo',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'A cirurgia de estrabismo tem repasse por **valor fechado**, e o valor depende de a cirurgia ter sido feita em **um olho ou nos dois**. O relatório de produção não traz essa informação de forma confiável — por isso o módulo pede que **uma pessoa marque**, linha a linha, se aquela cirurgia foi unilateral (1) ou bilateral (2).',
        'É, portanto, um módulo **semi-manual de propósito**: a máquina lista os candidatos e faz a conta; a decisão sobre lateralidade é humana e fica registrada.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Importe a **Produção QVIS** do mês.',
        'Abra **⚙ Ajustes** e confira os quatro valores da regra (unilateral e bilateral, convênio e SUS). Eles são editáveis — não estão presos no código.',
        'Escolha **Mês** e **Ano**.',
        'Percorra a lista: toda linha de produto que contém **ESTRABISMO** aparece aqui, ainda sem valor.',
        'Para cada linha, **marque 1 (unilateral) ou 2 (bilateral)**. A marcação é gravada na hora e o repasse aparece calculado.',
        'Linha não marcada **não paga**. Antes de fechar o mês, confira se sobrou alguma sem marcação.',
        'Use os filtros de **vínculo** (Interno · Híbrido · Externo) e os campos de admissão/paciente para conferir por grupo.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**Produção QVIS** (linhas_producao) — as linhas cujo produto contém **ESTRABISMO**.',
        '**marcacoes_estrabismo** — a marcação de 1 ou 2 feita na tela; é o que destrava o cálculo.',
        '**Cadastro de Médicos** — para o vínculo (Interno, Híbrido, Externo) e o nome oficial.',
        'O campo **tipo_recebimento** da própria linha é o que identifica **SUS**.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['Valores da regra (padrão, editáveis)', 'CONVÊNIO   unilateral (1) → R$ 1.260,00\n           bilateral  (2) → R$ 1.680,00\n\nSUS        unilateral (1) → R$ 300,00\n           bilateral  (2) → R$ 300,00'],
        ['Repasse da linha', 'se não há marcação  → repasse = 0\nse tipo_recebimento = SUS → usa a coluna SUS\nsenão → usa a coluna CONVÊNIO\n\nrepasse = valor da combinação (fonte × quantidade marcada)'],
        ['Observação sobre o SUS', 'No SUS o valor é o MESMO para 1 ou 2 olhos.\nA marcação continua importante para o registro, mas\nnão muda o valor pago.'],
        ['Total do médico', 'total = soma dos repasses de todas as linhas marcadas\n        daquele médico no mês']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        'Um médico com **3 cirurgias de estrabismo** no mês, todas por convênio:',
        'Duas marcadas como **bilateral (2)** → 2 × R$ 1.680,00 = **R$ 3.360,00**',
        'Uma marcada como **unilateral (1)** → 1 × R$ 1.260,00 = **R$ 1.260,00**',
        '**Total do mês = R$ 4.620,00.**',
        'Se uma quarta cirurgia tivesse ficado **sem marcação**, ela apareceria na lista com repasse zero e o total não a incluiria.'
      ] },

      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Ano / Mês** da realização.',
        '**Cód. Admissão · Cód. Paciente · Nome do Paciente** — busca por trecho, cumulativa.',
        '**Vínculo** — Interno, Híbrido e Externo, ligáveis e desligáveis.',
        'Colunas da matriz configuráveis em **⚙ Ajustes** (nome e visibilidade).'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        '**Sem marcação não há pagamento.** Essa é a causa número um de valor menor que o esperado neste módulo.',
        'A marcação fica **salva no banco** e sobrevive a reimportações da produção — mas se a admissão mudar de código, a marcação antiga não a acompanha.',
        'Mudar os valores em ⚙ Ajustes **recalcula tudo na hora**, inclusive meses anteriores ainda não fechados. Altere com essa consciência.',
        'O módulo lista **todo produto que contenha ESTRABISMO** — inclusive consultas e exames relacionados, se o nome bater. Confira antes de marcar.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Unilateral', 'Cirurgia em um olho. Marcação 1.'],
        ['Bilateral', 'Cirurgia nos dois olhos. Marcação 2.'],
        ['Tipo de recebimento', 'A fonte que paga a conta: convênio, particular ou SUS.'],
        ['Vínculo', 'A relação do médico com a casa: Interno, Híbrido ou Externo.'],
        ['Marcação', 'A escolha de 1 ou 2 feita na tela; é o que libera o cálculo da linha.']
      ] }
    ]
  };

  window.AtlasDocs['desempenho-lentes-contato'] = {
    titulo: 'Lentes de Contato',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'Apura o repasse da adaptação de **lentes de contato**. Como no LIO, o dinheiro se divide entre **quem executou** e **quem indicou** — mas aqui a base é sempre o valor da linha de produção, e os percentuais são fixos da regra: **18% para o executante** e **9% para o indicante**.',
        'A distinção mais importante do módulo é o que conta como **produção do médico**: só entra o que ele **executou**. Uma linha em que ele aparece apenas como indicante gera repasse de indicação, mas **não** engorda a produção dele.',
        'Médicos **externos** aparecem na matriz quando indicaram alguém, mas com repasse **R$ 0,00** — é informação de origem do paciente, não pagamento.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Importe a **Produção QVIS** do mês.',
        'Confira o **Cadastro de Médicos**: o vínculo (Interno, Híbrido, Externo) é o que decide quem recebe e quem só aparece.',
        'Escolha **Ano** e **Mês**. Escolhendo "Todos os meses", a comparação **vs LM** (mês anterior) passa a ser **vs AA** (ano anterior).',
        'Leia os **cards do topo** e abra o **drilldown** para ver os quatro recortes de repasse.',
        'Na matriz, cada médico traz as tags **[EXE]** e **[IND]**, mostrando em que papel ele apareceu no mês.',
        'Use **⚙ Ajustes** para escolher quais das 9 colunas ficam visíveis e qual critério de **TKM** usar.',
        'Use **Mostrar/Ocultar** para esconder valores em reunião (LGPD) ou isolar um médico.',
        'Exporte em **Excel** em um dos três formatos: Matriz, Por Médico (mensal) ou Consolidado Anual.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**Produção QVIS** (linhas_producao) — as linhas de lente de contato do mês, com executante, indicante e valor.',
        '**Cadastro de Médicos** — vínculo e nome oficial; é o que separa quem recebe de quem é só informativo.',
        '**De-Para de Nomes** — resolve as grafias diferentes do mesmo profissional.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['Produção do médico', 'produção = soma do valor das linhas em que ele é EXECUTANTE\n\nLinhas em que ele é apenas indicante NÃO entram\nna produção nem na receita dele.'],
        ['Repasse de execução', 'repasse executante = valor das linhas executadas × 18%\n(só para vínculo INTERNO ou HÍBRIDO)'],
        ['Repasse de indicação', 'repasse indicante = valor das linhas indicadas × 9%\n(só para vínculo INTERNO ou HÍBRIDO)'],
        ['Externos', 'repasse = R$ 0,00 sempre.\nO externo aparece na matriz apenas quando indicou,\ne a linha é informativa.'],
        ['Total do médico', 'total = repasse de execução + repasse de indicação'],
        ['% de repasse (coluna da matriz)', '% repasse = repasse total ÷ produção do médico\n(quanto da produção que ele executou voltou pra ele)'],
        ['TKM', 'TKM = produção ÷ quantidade\nO divisor (admissões ou volume) é escolhido em ⚙ Ajustes.']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        'Dra. A (interna) no mês: **executou R$ 10.000,00** em lentes e **indicou outros R$ 4.000,00** que a Dra. B executou.',
        'Repasse de execução = 10.000,00 × 18% = **R$ 1.800,00**',
        'Repasse de indicação = 4.000,00 × 9% = **R$ 360,00**',
        '**Total da Dra. A = R$ 2.160,00.** A produção dela na matriz é **R$ 10.000,00** — os R$ 4.000,00 indicados são produção da Dra. B.',
        'Se a indicação tivesse vindo de um médico **externo**, ele apareceria na matriz com R$ 0,00 de repasse.'
      ] },

      { titulo: 'As colunas da matriz', tipo: 'glossario', conteudo: [
        ['Admissões', 'Quantos atendimentos distintos o médico teve no mês.'],
        ['Volume', 'Quantidade de itens/lentes.'],
        ['vs LM', 'Comparação com o mês anterior. No modo anual vira vs AA (ano anterior).'],
        ['vs LY', 'Comparação com o mesmo mês do ano passado.'],
        ['Produção', 'Valor executado pelo médico. Não inclui o que ele apenas indicou.'],
        ['TKM', 'Ticket médio: produção dividida pela quantidade escolhida em Ajustes.'],
        ['Repassado', 'O que ele recebe: execução + indicação.'],
        ['% Repasse', 'Repassado dividido pela produção.'],
        ['[EXE] / [IND]', 'Tags que mostram em que papel o médico apareceu no mês.']
      ] },

      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Ano / Mês**, com a opção **Todos os meses** (visão anual).',
        '**Cód. Admissão · Cód. Paciente · Nome do Paciente** — busca por trecho, cumulativa.',
        '**Por médico**, pelo painel Mostrar/Ocultar.',
        '**Colunas visíveis** — todas as 9 podem ser escondidas, menos MÉDICO.',
        '**Ocultar R$** — esconde repasse e/ou produção para apresentar a tela sem expor valores.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'A regra mais confundida: **produção é só o que o médico executou**. Quem esperava ver a indicação somada aí vai achar que faltou dinheiro.',
        '**Externo nunca recebe** neste módulo. Ele aparece porque indicou, e a linha zerada é proposital.',
        'Um médico sem vínculo cadastrado corretamente **pode cair no grupo errado** e deixar de receber. O cadastro de Médicos é pré-requisito.',
        'No modo **Todos os meses**, a coluna de comparação muda de significado — vs LM passa a ser vs AA.',
        'Nomes diferentes do mesmo profissional dividem o resultado em duas linhas até serem unificados no **De-Para de Nomes**.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Executante', 'Quem realizou a adaptação da lente.'],
        ['Indicante', 'Quem encaminhou o paciente.'],
        ['Vínculo', 'Interno, Híbrido ou Externo — definido no cadastro de Médicos.'],
        ['IH', 'Abreviação de Interno/Híbrido: os vínculos que recebem repasse.'],
        ['TKM', 'Ticket médio da produção.'],
        ['LM / LY / AA', 'Mês anterior / mesmo mês do ano passado / ano anterior.']
      ] }
    ]
  };

  window.AtlasDocs['desempenho-luz-pulsada'] = {
    titulo: 'Luz Pulsada',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'O aparelho de **luz pulsada (IRPL)** não é do hospital: pertence a uma médica da casa. O acordo é que o hospital paga a ela um **percentual sobre toda a produção feita com o aparelho** — não importa qual médico executou o procedimento.',
        'Então o raciocínio aqui é diferente dos outros módulos de Desempenho: **não é repasse por produção individual, é aluguel de equipamento**. A matriz por médico existe para mostrar quem usou o aparelho e quanto cada um produziu; o pagamento, no fim, é um só, para a proprietária.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Importe o **QVIS do mês** (Convênio e Particular).',
        'Abra **⚙ Ajustes** e confira o **percentual da taxa**.',
        'Escolha **Ano**, **Mês** e, se precisar, o **mês de pagamento** (por padrão o mais recente).',
        'Confira o card da **taxa total** — é o valor que vai à proprietária do aparelho.',
        'Percorra a matriz para ver quem usou o aparelho. Use o filtro de **vínculo** se quiser incluir ou excluir externos.',
        'Exporte em Excel para anexar ao fechamento.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**linhas_qvis** — os relatórios QVIS de Convênio e Particular.',
        'O recorte é feito por três filtros combinados: procedimento contendo **LUZ PULSADA**, papel **MEDICO** ou **CIRURGIAO**, e vínculo do executante **Interno** ou **Híbrido**.',
        '**Cadastro de Médicos** — para o vínculo do executante.',
        '**Config do módulo** (⚙ Ajustes) — o percentual da taxa.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['1. Quais linhas entram', 'procedimento CONTÉM "LUZ PULSADA"\nE papel ∈ { MEDICO, CIRURGIAO }\nE vínculo do executante ∈ { INTERNO, HIBRIDO }\n\nO filtro de papel evita contar a mesma linha duas vezes\n(solicitante e executante aparecem separados no QVIS).'],
        ['2. Base de cálculo — muda por fonte', 'PARTICULAR → base = PRODUZIDO da linha\nCONVÊNIO   → base = RECEBIDO da linha\n\nNo convênio só entra o que o plano pagou de fato: não faz\nsentido pagar aluguel sobre glosa.'],
        ['3. Taxa da linha', 'taxa da linha = base × percentual configurado'],
        ['4. Taxa total do mês', 'taxa total = soma das taxas de todas as linhas elegíveis\n\nÉ esse o valor devido à proprietária do aparelho.']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        'No mês, o aparelho gerou **R$ 20.000,00 de produção particular** e **R$ 8.000,00 recebidos de convênio** (o convênio produziu R$ 10.000,00, mas glosou R$ 2.000,00).',
        'Base = 20.000,00 (particular, pelo produzido) + 8.000,00 (convênio, pelo recebido) = **R$ 28.000,00**.',
        'Com taxa de **10%**: **taxa total = R$ 2.800,00**.',
        'Os R$ 2.000,00 glosados **não** entram na base — é o efeito prático da regra do recebido no convênio.'
      ] },

      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Ano / Mês** da realização e **mês de pagamento** do relatório.',
        '**Cód. Admissão · Cód. Paciente · Nome do Paciente**.',
        '**Vínculo** — por regra vem com Interno e Híbrido ligados.',
        '**Colunas** visíveis, configuráveis.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'A base **muda conforme a fonte**: produzido no particular, recebido no convênio. Somar tudo pelo produzido dá um número maior e errado.',
        'Só entram os papéis **MEDICO** e **CIRURGIAO**. Incluir solicitante duplicaria a mesma produção.',
        'Quem recebe é a **proprietária do aparelho**, não os médicos que aparecem na matriz. A matriz é informação de uso, não de pagamento.',
        'Procedimento com nome fora do padrão (sem "LUZ PULSADA") simplesmente não é capturado.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['IRPL', 'Intense Regulated Pulsed Light — a tecnologia do aparelho de luz pulsada.'],
        ['Taxa sobre procedimentos', 'O modelo de pagamento pelo uso de um equipamento de terceiro.'],
        ['Produzido', 'O valor bruto do procedimento.'],
        ['Recebido', 'O que o convênio efetivamente pagou.'],
        ['Executante', 'O médico que realizou o procedimento; aqui serve para o recorte, não para o pagamento.']
      ] }
    ]
  };

  window.AtlasDocs['desempenho-crosslink'] = {
    titulo: 'Crosslink',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'Mesma ideia da Luz Pulsada — **taxa pelo uso de um aparelho de terceiro** —, com uma diferença que muda tudo na conta: aqui a taxa é um **valor fixo por procedimento realizado**, não um percentual sobre o faturamento.',
        'Ou seja: **quanto o procedimento custou não importa**. O que conta é **quantos** foram feitos.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Importe o **QVIS do mês** (Convênio e Particular).',
        'Abra **⚙ Ajustes** e confira o **valor fixo por procedimento** (padrão **R$ 288,00**).',
        'Escolha **Ano**, **Mês** e, se precisar, o **mês de pagamento**.',
        'Confira a **contagem de admissões elegíveis** — é ela que multiplica o valor fixo.',
        'Confira a **taxa total** e exporte para o fechamento.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**linhas_qvis** — Convênio e Particular.',
        'Recorte: procedimento contendo **CROSSLINK**, papel **MEDICO** ou **CIRURGIAO** (ignora SOLICITANTE), vínculo do executante **Interno** ou **Híbrido**.',
        '**Cadastro de Médicos** — para o vínculo.',
        '**Config do módulo** (⚙ Ajustes) — o valor fixo.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['1. Quais linhas entram', 'procedimento CONTÉM "CROSSLINK"\nE papel ∈ { MEDICO, CIRURGIAO }\nE vínculo do executante ∈ { INTERNO, HIBRIDO }'],
        ['2. Taxa total', 'taxa total = quantidade de admissões elegíveis × valor fixo\n\nvalor fixo padrão = R$ 288,00 (editável em ⚙ Ajustes)'],
        ['3. O que NÃO entra na conta', 'O valor produzido e o valor recebido não participam do\ncálculo. Um crosslink de R$ 1.000 e um de R$ 5.000 pagam\nexatamente a mesma taxa.']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        'No mês foram realizados **12 procedimentos de crosslink** elegíveis, somando R$ 46.000,00 de produção.',
        'Valor fixo configurado: **R$ 288,00**.',
        '**Taxa total = 12 × 288,00 = R$ 3.456,00.**',
        'Os R$ 46.000,00 de produção **não entram na conta** — servem só como referência na tela.'
      ] },

      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Ano / Mês** e **mês de pagamento**.',
        '**Cód. Admissão · Cód. Paciente · Nome do Paciente**.',
        '**Vínculo** — por regra Interno e Híbrido.',
        '**Colunas** visíveis, configuráveis.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'A conta é por **contagem**, não por valor. Quem espera ver um percentual sobre o faturamento vai estranhar o número.',
        'Se o mesmo crosslink aparecer em duas linhas com papéis diferentes, o filtro de papel evita a dupla contagem — mas vale conferir quando a contagem parecer alta demais.',
        'Mudar o valor fixo em ⚙ Ajustes recalcula todos os meses abertos.',
        'Quem recebe é a **proprietária do aparelho**, não os executantes listados.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Crosslink', 'Procedimento de reticulação do colágeno da córnea, feito em aparelho específico.'],
        ['Valor fixo', 'A taxa paga por procedimento, independente do valor faturado.'],
        ['Admissão elegível', 'O atendimento que passou pelos três filtros: procedimento, papel e vínculo.']
      ] }
    ]
  };

  window.AtlasDocs['desempenho-refractive-laser'] = {
    titulo: 'Refractive Laser',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'Terceiro módulo de **taxa por uso de aparelho**, e o mais elaborado dos três: o Refractive Laser tem **sete procedimentos elegíveis**, e eles não seguem a mesma regra.',
        'Os **exames** pagam um **valor fixo por linha**. Os **cirúrgicos** pagam **valor fixo por olho no convênio** e **percentual sobre o produzido no particular**. Cada linha calcula a sua taxa, e a proprietária do aparelho recebe a soma de todas.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Importe o **QVIS do mês**.',
        'Abra **⚙ Ajustes** e confira os valores: os fixos dos exames (convênio e particular), o fixo cirúrgico de convênio e o percentual cirúrgico de particular.',
        'Escolha **Ano** e **Mês**.',
        'Leia o cartão **TAXA TOTAL** — ele mostra a fórmula em texto: *"Soma de N taxas individuais = R$ …"*.',
        'Percorra a matriz conferindo a **quantidade efetiva** de cada linha (mono = 1, bi = 2). É ela que multiplica o valor nos cirúrgicos de convênio.',
        'Use **🛠 Ajuste de Matriz** para renomear colunas, escondê-las ou restaurar o padrão; a largura das colunas também é ajustável arrastando.',
        'Exporte em Excel.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**linhas_qvis** — Convênio e Particular.',
        'Recorte: o procedimento precisa estar na **lista canônica de sinônimos** do módulo (sete categorias, cada uma com as grafias que o QVIS usa), papel **MEDICO** ou **CIRURGIAO**, vínculo **Interno** ou **Híbrido**.',
        '**Cadastro de Médicos** — para o vínculo.',
        '**Config do módulo** (⚙ Ajustes) — os quatro parâmetros de valor.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['Quantidade efetiva (regra que vale para tudo)', 'se o nome do procedimento contém "BINOCULAR" → qtd = 2\nsenão → qtd = a coluna QUANTIDADE da linha\n\nO nome vence a coluna: binocular é sempre dois olhos.'],
        ['EXAMES — valor fixo por linha', 'Ceratoscopia   convênio R$ 28,72  ·  particular R$ 62,50\nPaquimetria    convênio R$ 23,40  ·  particular R$ 62,50\n\ntaxa = valor fixo   (a quantidade é IGNORADA nos exames)'],
        ['CIRÚRGICOS — convênio', 'taxa = valor fixo cirúrgico × quantidade efetiva'],
        ['CIRÚRGICOS — particular', 'taxa = percentual cirúrgico × PRODUZIDO da linha'],
        ['Taxa total do mês', 'taxa total = soma das taxas individuais de todas as\n             linhas elegíveis']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        '**Uma ceratoscopia de convênio:** taxa = **R$ 28,72**. Se a coluna QUANTIDADE dissesse 2, continuaria R$ 28,72 — exame não multiplica.',
        '**Uma cirurgia binocular de convênio**, com fixo cirúrgico de R$ 150,00: o nome contém BINOCULAR, então qtd = 2 → taxa = 150,00 × 2 = **R$ 300,00**.',
        '**Uma cirurgia particular** de R$ 4.000,00 produzidos, com percentual de 8%: taxa = 4.000,00 × 8% = **R$ 320,00**. Aqui a quantidade não entra: o produzido já reflete os dois olhos.'
      ] },

      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Ano / Mês**.',
        '**Vínculo** do executante.',
        '**Colunas** — nome e visibilidade pelo **🛠 Ajuste de Matriz**; largura arrastável direto no cabeçalho.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'A regra de **BINOCULAR vencer a coluna QUANTIDADE** é a origem mais comum de divergência com quem confere pela planilha.',
        'Exames **ignoram a quantidade**; cirúrgicos de convênio **usam**; cirúrgicos de particular usam o **produzido**. São três comportamentos na mesma tela.',
        'Se um procedimento sumiu da matriz, o motivo quase sempre é grafia nova no QVIS que ainda não está na **lista de sinônimos** do módulo.',
        'Quem recebe a soma é a **proprietária do aparelho**, independentemente de quem executou.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Refractive Laser', 'O aparelho de cirurgia refrativa, de propriedade de uma médica da casa.'],
        ['Quantidade efetiva', 'O número de olhos considerado na linha: 2 se o nome diz binocular, senão o da coluna.'],
        ['Sinônimo canônico', 'A lista que traduz as várias grafias do QVIS para as sete categorias elegíveis.'],
        ['Mono / Bi', 'Um olho / dois olhos.'],
        ['Taxa individual', 'A taxa calculada para uma única linha; a soma delas é a taxa total.']
      ] }
    ]
  };

  window.AtlasDocs['desempenho-fellow'] = {
    titulo: 'Fellow',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'Controla o pagamento dos **plantões dos fellows** (médicos em especialização). Aqui **uma linha é um plantão**: data + fellow + turno. O mesmo fellow pode ter manhã, tarde e noturno no mesmo dia — são três linhas.',
        'O pagamento tem duas partes independentes: o **complemento**, que é quanto o fellow atendeu **a menos** que a meta, e a **refeição**, que é um valor fixo pago em plantão noturno ou de fim de semana.',
        'A regra mais importante e menos óbvia: **atender acima da meta não desconta nada**. O excedente aparece na tela com sinal (em rosa), mas o complemento nunca fica negativo.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Importe a **planilha de plantões** do mês.',
        'Escolha **Ano** e **Mês**.',
        'Confira os **4 cards** do topo, que já trazem comparação com o mês anterior, com o ano anterior e o acumulado do ano.',
        'Percorra a tabela, **agrupada por fellow** e colapsável, com subtotal por fellow e total geral.',
        'Linhas de **fim de semana** vêm com fundo amarelo; **complemento negativo** (atendeu acima da meta) aparece em rosa. Nenhum dos dois é erro.',
        'Precisou corrigir? Clique na linha para abrir a **edição** (data, fellow, turno, quantidade) — o valor recalcula ao vivo enquanto você digita.',
        'Dá para **excluir uma linha** ou **o mês inteiro**, e para tirar um **snapshot** do mês fechado.',
        'Use **ocultar valores** para apresentar a tela sem expor cifras, e **Exportar Excel** para o fechamento.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**fellow_linhas** — uma linha por plantão, vinda da planilha importada: data, fellow, turno, quantidade atendida, meta, valores.',
        'A **meta** e os valores unitários vêm da própria planilha, plantão a plantão.',
        'O **dia da semana** é derivado da data e é o que decide a refeição de fim de semana.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['Total a repassar do plantão', 'total = máx(0, valor do complemento) + refeição'],
        ['Complemento', 'O complemento vale SÓ ATÉ A META.\nAtendeu acima dela → complemento = 0, sem desconto.\n\nO excedente continua visível na quantidade e no valor do\ncomplemento, com sinal, destacado em rosa.'],
        ['Refeição', 'turno = NOTURNO  → R$ 50,00\nou dia ∈ { sábado, domingo } → R$ 50,00\nsenão → R$ 0,00\n\nTurno "DIA" é a planilha que veio sem turno: nesse caso a\nrefeição só entra pelo fim de semana.'],
        ['Subtotal e total', 'subtotal do fellow = soma dos plantões dele no mês\ntotal geral        = soma de todos os fellows']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        '**Plantão de terça, turno manhã**, meta 15, atendeu 10 → faltaram 5 → complemento **R$ 380,00**. Não é noturno nem fim de semana → refeição R$ 0,00. **Total = R$ 380,00.**',
        '**Plantão de sábado, turno manhã**, meta 15, atendeu 20 → atendeu 5 **acima** da meta → complemento = **R$ 0,00** (sem desconto). É sábado → refeição **R$ 50,00**. **Total = R$ 50,00.**',
        'Na tela, esse segundo plantão aparece com fundo amarelo (fim de semana) e o excedente em rosa — mas o total pago é R$ 50,00, nunca negativo.'
      ] },

      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Ano / Mês**.',
        '**Fellow** e **Turno**.',
        '**Busca por nome**, com atraso na digitação para não travar a tela.',
        '**Colunas** visíveis, lembradas entre sessões.',
        '**Ocultar valores** — esconde cifras para apresentação.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'A regra do **máx(0, …)** é a mais confundida: atender acima da meta **não gera desconto**. Quem soma a coluna de complemento com sinal chega a um total menor que o pago.',
        '**Um dia pode ter três linhas** do mesmo fellow (manhã, tarde, noturno). Contar "plantões por dia" e "linhas" dá números diferentes.',
        'Fundo amarelo e texto rosa são **sinalização**, não erro.',
        'Excluir o mês inteiro é irreversível — tire um snapshot antes se houver qualquer dúvida.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Fellow', 'Médico em especialização, que cumpre plantões.'],
        ['Meta', 'A quantidade de atendimentos esperada naquele plantão.'],
        ['Complemento', 'O valor pago pela diferença entre a meta e o que foi atendido, quando atendeu menos.'],
        ['Refeição', 'Valor fixo de R$ 50,00 em plantão noturno ou de fim de semana.'],
        ['Turno DIA', 'Marcação usada quando a planilha veio sem turno definido.'],
        ['Snapshot', 'A fotografia do mês fechado, guardada para consulta posterior.']
      ] }
    ]
  };

  window.AtlasDocs['desempenho-fracionamento'] = {
    titulo: 'Fracionamento',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'Injeções intravítreas de retina vêm em frascos que dão para **até quatro aplicações**. Fracionar o frasco economiza, e parte dessa economia volta ao médico — mas o valor **depende da posição da aplicação dentro do frasco**: a primeira vale menos que a quarta, porque o custo do frasco já foi diluído.',
        'A líder do centro cirúrgico marca no relatório mensal, **por cor**, quais aplicações saíram do mesmo frasco. O módulo lê esses grupos e distribui o valor.',
        'Quando um frasco é dividido entre **médicos diferentes**, ninguém fica com a primeira nem com a quarta: o valor é **rateado igualmente** entre eles.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Receba o relatório mensal com os **grupos marcados por cor** pela líder do centro cirúrgico.',
        'Abra o painel de **Configuração da Regra** e confira os cinco números: o valor retido pelo hospital e os quatro valores por posição.',
        'O painel mostra um **preview ao vivo** das duas tabelas — a do frasco individual e a do frasco compartilhado. Use-o para conferir a regra antes de importar.',
        'Importe o relatório do mês.',
        'Confira os grupos: cada cor é um frasco, e a ordem dentro da cor é a posição da aplicação.',
        'Confira os frascos **compartilhados** entre médicos — são os que usam rateio igual.',
        'Exporte para o fechamento.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        'O **relatório mensal de injeções** preenchido pela líder do centro cirúrgico, com os grupos marcados por cor.',
        '**Configuração da regra** (na própria tela) — o valor retido e os quatro valores por posição, todos editáveis.',
        'Os medicamentos cobertos hoje são os frascos de **Eylia 2mg** e **Eylia 8mg**.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['Regra geral', 'repasse ao médico = fracionamento bruto − valor fixo retido\n\nvalor retido pelo hospital (procedimento cirúrgico):\n   R$ 418,52   (configurável)'],
        ['Valor por posição no frasco', '1ª aplicação → R$ 450,00\n2ª aplicação → R$ 550,00\n3ª aplicação → R$ 700,00\n4ª aplicação → R$ 900,00\n\nSobe porque o custo do frasco já foi coberto pelas\naplicações anteriores.'],
        ['Frasco compartilhado entre médicos', 'Ninguém fica com a 1ª nem com a 4ª:\n\nvalor de cada um = média dos valores das posições usadas,\n                   TRUNCADA em 2 casas decimais\n\nA truncagem (e não o arredondamento) é o que faz o número\nbater com a planilha da líder.'],
        ['Particulares', 'Não entram neste módulo — seguem a regra padrão de\nparticular (27%).']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        '**Frasco individual**, um único médico usou as 4 aplicações: 450 + 550 + 700 + 900 = **R$ 2.600,00** de fracionamento bruto.',
        '— — —',
        '**Frasco compartilhado** entre dois médicos, 4 aplicações (duas de cada):',
        'Média das quatro posições = (450 + 550 + 700 + 900) ÷ 4 = 650,00 → cada aplicação vale **R$ 650,00**, para qualquer um dos dois.',
        'Assim nenhum dos dois é prejudicado por ter entrado "primeiro" no frasco.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'A **posição dentro do frasco** é o que define o valor. Trocar a ordem dos grupos muda o pagamento.',
        'No rateio, o valor é **truncado**, não arredondado — é isso que reproduz a planilha de origem.',
        'A marcação por cor é **manual, na origem**. Grupo marcado errado entra errado aqui.',
        'Mudar os valores na Configuração da Regra afeta todo mês ainda aberto.',
        '**Particulares ficam de fora** deste módulo por definição.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Fracionamento', 'Usar um mesmo frasco em mais de uma aplicação.'],
        ['Posição', 'A ordem da aplicação dentro do frasco: 1ª, 2ª, 3ª ou 4ª.'],
        ['Frasco compartilhado', 'Frasco cujas aplicações foram feitas por médicos diferentes.'],
        ['Rateio igual', 'Divisão do valor pela média das posições, para não privilegiar quem veio antes.'],
        ['Valor retido', 'A parte do fracionamento que fica com o hospital.'],
        ['Intravítrea', 'Injeção aplicada dentro do olho, no tratamento de retina.']
      ] }
    ]
  };

  window.AtlasDocs['desempenho-cargos'] = {
    titulo: 'Cargos Administrativos',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'Alguns médicos exercem **funções administrativas** além da assistencial — direção médica, coordenação, responsabilidade técnica — e recebem um **valor mensal fixo** por isso, independente de produção.',
        'O módulo tem duas camadas. A primeira é o **valor fixo por TAG**: cada cargo é uma etiqueta, e quem tem a etiqueta recebe aquele valor automaticamente. A segunda são as **exceções**: casos em que o médico tem a TAG mas é pago por outra regra (por exemplo, um percentual sobre a produção).',
        'A regra de ouro é evitar pagamento duplo: **médico com exceção NÃO recebe o valor fixo da TAG** — recebe apenas o que a exceção calcular.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Vá ao módulo **Médicos** e atribua as **TAGs de cargo** a quem exerce cada função. Sem TAG, o médico não aparece aqui.',
        'Nesta tela, defina o **valor mensal de cada TAG** nos três cartões do topo.',
        'Cadastre as **exceções** para os casos em que o valor fixo não se aplica.',
        'Escolha o **período** e confira a tabela: cada médico, suas TAGs, a regra aplicada e o valor do mês.',
        'Linhas de médicos **com exceção vêm destacadas** — confira se o valor calculado pela exceção faz sentido.',
        'O valor apurado aqui entra no repasse do mês junto com os demais módulos.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**Cadastro de Médicos** — as TAGs de cargo administrativo de cada profissional.',
        '**Valor por TAG** — definido nesta tela, um valor mensal por cargo.',
        '**Cadastro de exceções** — as regras especiais que substituem o valor fixo.',
        'Para exceções baseadas em produção, a **produção do módulo correspondente** do mês (por exemplo, Lentes de Contato).'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['Caso padrão', 'valor do médico = valor mensal da TAG\n\nÉ um valor fixo: não depende de produção, de plantão\nnem de quantidade.'],
        ['Médico com mais de uma TAG', 'valor = soma dos valores das TAGs que ele tem\n(desde que nenhuma delas caia numa exceção)'],
        ['Médico com exceção', 'valor = APENAS o resultado da regra de exceção\n\nO valor fixo da TAG NÃO é somado — seria pagar duas\nvezes a mesma função.'],
        ['Exemplo de exceção baseada em produção', 'valor = percentual × produção do módulo no mês\n(é o caso da coordenação de Lentes de Contato)']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        '**Dr. A** tem a TAG de Diretor Médico, com valor mensal de **R$ 8.000,00**, e nenhuma exceção → recebe **R$ 8.000,00**.',
        '**Dra. B** tem a TAG de Coordenadora de Lentes de Contato, cujo valor fixo seria R$ 3.000,00, **mas existe exceção** dizendo que ela recebe 5% da produção de LC do mês.',
        'Produção de LC no mês = R$ 80.000,00 → **Dra. B recebe 80.000 × 5% = R$ 4.000,00**, e **não** os R$ 3.000,00 da TAG.',
        'Somar os dois daria R$ 7.000,00 — exatamente o pagamento duplo que a regra existe para impedir.'
      ] },

      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Ano / Mês** — por padrão, a competência mais recente disponível.',
        'A tabela lista todos os médicos com alguma TAG de cargo no período.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'O módulo **não descobre cargos sozinho**: ele depende inteiramente das TAGs atribuídas no cadastro de Médicos.',
        '**Exceção substitui, não soma.** Essa é a regra que evita o pagamento duplo — e a que mais gera dúvida ao conferir.',
        'Valor de TAG é **mensal e fixo**: mudar o valor afeta todos os meses ainda abertos.',
        'Médico que deixou o cargo precisa ter a **TAG removida** no cadastro; senão continua recebendo.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['TAG de cargo', 'A etiqueta que marca a função administrativa do médico no cadastro.'],
        ['DM', 'Direção Médica.'],
        ['CM', 'Coordenação Médica.'],
        ['RT', 'Responsabilidade Técnica.'],
        ['Exceção', 'Regra que substitui o valor fixo da TAG para um médico específico.'],
        ['Valor fixo mensal', 'O pagamento do cargo, que não varia com produção.']
      ] }
    ]
  };

  window.AtlasDocs['desempenho-laudos'] = {
    titulo: 'Laudos',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'Mostra o pagamento dos **laudos de exames**. Diferente dos outros fichários, aqui o ATLAS **não calcula o valor**: ele vem pronto de uma planilha produzida por outro setor ("PAGAMENTO - LAUDOS"). O papel do módulo é **receber, organizar, conferir e somar**.',
        'A planilha tem três realidades distintas, e elas viram as **três abas** da tela: **Pacote** (laudos dentro de um pacote de convênio, com quantidade e valor unitário), **Impressos** (laudos avulsos no prontuário, um valor por laudo) e **Externo** (laudista de fora da casa).',
        'Como o valor é de origem externa, a atenção aqui é de **conferência**: laudo pendente, laudo marcado como particular e reimportação do mesmo mês.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Receba do setor responsável a planilha **PAGAMENTO - LAUDOS - <MÊS>.xlsx**.',
        'Importe o arquivo. O módulo reconhece as abas sozinho, por termos — não é preciso renomear nada na planilha.',
        'Confira a **competência** detectada. Ela sai das datas do arquivo, mas pode ser informada à mão.',
        'Percorra as três abas. Cada uma tem a sua matriz, com efeito zebra e totalizador próprio.',
        'Procure os laudos marcados como **pendentes** — são as linhas em que a planilha trazia "LANÇAR" no lugar do valor. Elas entram com valor zero e precisam de retorno do setor.',
        'Confira também os marcados como **particular** (a planilha traz isso na observação).',
        'Se o setor mandar uma versão corrigida, basta **reimportar a mesma competência**: os dados anteriores são substituídos, sem duplicar.',
        'Use **⚙ Ajustes → Personalização** para renomear abas e colunas conforme o vocabulário da casa.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        'A planilha **PAGAMENTO - LAUDOS**, de outro setor, importada para a tabela **laudos**.',
        'Abas reconhecidas: **PACOTES / LAUDOS PACOTE** → categoria Pacote; **IMPRESSOS / LAUDO NO RES** → categoria Impresso; **MÉDICO LAUDISTA EXTERNO** → categoria Externo.',
        'Abas **VALORES LAUDOS** (tabela de preços) e **TOTAL** (resumo) são ignoradas de propósito.',
        '**config_laudos** — os rótulos personalizados da tela.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['O ATLAS não recalcula', 'O valor do laudo vem PRONTO da planilha de origem.\nO módulo lê, organiza e soma — não aplica percentual\nnem tabela própria.'],
        ['Aba PACOTE', 'A planilha traz quantidade, valor unitário e total.\nO valor gravado é o TOTAL da linha, como veio.'],
        ['Abas IMPRESSO e EXTERNO', 'Um valor por laudo, lido direto da planilha.'],
        ['Laudo pendente', 'A planilha trouxe "LANÇAR" no lugar do valor\n→ valor = 0 e a linha fica marcada como PENDENTE.\n\nEla aparece na matriz, mas não soma nada.'],
        ['Total da aba', 'total = soma dos valores de repasse das linhas da\n        categoria, respeitando os filtros da tela'],
        ['Reimportação', 'Reimportar a MESMA competência apaga os laudos daquele\nmês e insere os novos — não duplica.']
      ] },

      { titulo: 'Tratamentos aplicados na importação', tipo: 'lista', conteudo: [
        'A linha **"Total"** no fim de cada aba é descartada — senão viraria um laudo fantasma.',
        'A coluna **Unidade mesclada** (vazia nas linhas seguintes) é preenchida para baixo, repetindo a última unidade vista.',
        '**"LANÇAR"** no lugar do valor vira laudo **pendente**, com valor zero.',
        'Nomes recebem **corte de espaços** nas pontas ("ANGIOGRAFIA " vira "ANGIOGRAFIA"), para não criar dois exames iguais.',
        'Observação igual a **"PARTICULAR"** marca a linha como particular.',
        'Nada disso altera a planilha de origem — o tratamento é só na leitura.'
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        '**Aba Pacote:** 12 angiografias a R$ 18,00 cada, total R$ 216,00 na planilha → o módulo grava **R$ 216,00**, exatamente como veio.',
        '**Aba Impressos:** 30 laudos avulsos, um valor por linha → o total da aba é a soma dessas 30 linhas.',
        'Se 3 dessas 30 vierem com **"LANÇAR"**, elas aparecem na matriz com **R$ 0,00** e marcadas como pendentes: o total da aba soma as outras 27, e as 3 ficam visíveis para cobrança junto ao setor.'
      ] },

      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Competência** (mês da planilha).',
        '**Abas** Pacote · Impressos · Externo — cada uma com o seu conjunto de colunas.',
        'Filtros de coluna dentro de cada matriz (unidade, convênio, médico, exame).',
        '**⚙ Ajustes → Personalização** — renomeia abas e colunas.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'O valor é **responsabilidade da planilha de origem**. Divergência de valor se resolve com o setor que a produz, não aqui.',
        '**Pendente não é zero de verdade** — é valor que ainda não veio. Fechar o mês com pendentes é deixar dinheiro em aberto.',
        'Reimportar substitui a competência inteira: qualquer ajuste manual feito depois da importação anterior se perde.',
        'Se uma aba não aparecer, o nome dela na planilha provavelmente não contém nenhum dos termos reconhecidos.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Laudo', 'O relatório médico de um exame; é o que se paga aqui.'],
        ['Pacote', 'Laudos incluídos num pacote de convênio, com quantidade e valor unitário.'],
        ['Impressos', 'Laudos avulsos registrados no prontuário.'],
        ['Externo', 'Laudo produzido por médico laudista de fora da casa.'],
        ['Pendente', 'Linha que veio com "LANÇAR" no lugar do valor; entra com zero.'],
        ['Competência', 'O mês a que a planilha se refere.']
      ] }
    ]
  };

  window.AtlasDocs['desempenho-periodos'] = {
    titulo: 'Períodos por Unidade',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'Paga a **presença do médico na unidade**. Um "período" é um turno de trabalho agendado; o médico recebe um valor por período cumprido, e o total do mês é simplesmente **quantos períodos × quanto vale o período**.',
        'A planilha mensal chega organizada por **semanas** (semana 1 a 5), e é assim que o módulo guarda: cada linha é um médico numa unidade, com a contagem de períodos de cada semana e o total.',
        'O valor do período pode ser o **padrão da casa** ou um valor **específico daquele médico naquela unidade** — o cadastro de valores é o que decide.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Confira o **cadastro de valor por período**: o valor padrão da casa e as exceções por médico e unidade.',
        'Importe a planilha **Repasse Médico - Períodos** do mês.',
        'Escolha **Ano** e **Mês** (o mês de referência da planilha).',
        'Leia os **KPIs**: linhas, médicos, unidades, total de períodos e total em R$, com comparação com o mês anterior e com o ano anterior.',
        'Percorra a tabela, **agrupada por unidade** e colapsável, conferindo a contagem semanal.',
        'Precisou corrigir uma linha? Clique nela para abrir a edição.',
        'Use **ocultar valores** para apresentar sem expor cifras e **Exportar Excel** para o fechamento.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**periodos_linhas** — a planilha importada: mês de referência, médico, unidade, valor do período, contagem por semana, total de períodos e total em R$.',
        '**periodos_cadastro_valor** — o valor do período específico de um médico numa unidade.',
        '**periodos_config** — o **valor padrão do período** (parte em R$ 700,00).',
        '**unidades** — o cadastro de unidades, que dá o vínculo da linha.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['Total de períodos da linha', 'total de períodos = sem1 + sem2 + sem3 + sem4 + sem5\n\nCada "sem" é a contagem de períodos naquela semana do mês.'],
        ['Valor do período', 'Se existe cadastro para aquele MÉDICO naquela UNIDADE:\n   valor do período = valor cadastrado\nsenão:\n   valor do período = valor padrão (R$ 700,00, configurável)'],
        ['Total da linha', 'total R$ = total de períodos × valor do período'],
        ['Subtotais', 'subtotal da unidade = soma das linhas daquela unidade\ntotal geral         = soma de todas as unidades']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        'Um médico numa unidade, no mês: **sem1 = 4, sem2 = 4, sem3 = 3, sem4 = 4, sem5 = 1**.',
        'Total de períodos = 4 + 4 + 3 + 4 + 1 = **16**.',
        'Ele não tem valor cadastrado para essa unidade → usa o padrão de **R$ 700,00**.',
        '**Total da linha = 16 × 700,00 = R$ 11.200,00.**',
        'Se houvesse cadastro de R$ 800,00 para ele nessa unidade, o total seria 16 × 800,00 = R$ 12.800,00 — e só nessa unidade; em outra ele voltaria ao padrão.'
      ] },

      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Ano / Mês** de referência.',
        '**Unidade** e **nome do médico**.',
        '**Colunas** visíveis, configuráveis.',
        '**Ocultar valores** — esconde cifras na tela.',
        'Unidades podem ser **colapsadas** individualmente na tabela.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'O cadastro de valor é por **médico + unidade**. O mesmo médico pode ter valores diferentes em unidades diferentes — e é assim de propósito.',
        'Mudar o **valor padrão** altera todo mundo que não tem cadastro específico, em todos os meses ainda abertos.',
        'A **semana 5** existe porque alguns meses têm cinco semanas parciais. Ignorá-la deixa períodos de fora.',
        'Uma unidade que não existe no cadastro entra na linha, mas fica sem vínculo — vale conferir os nomes antes de importar.',
        'O mês de referência é o da **planilha**, não a data em que se importou.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Período', 'Um turno de trabalho agendado do médico na unidade.'],
        ['Mês de referência', 'O mês a que a planilha mensal se refere (formato AAAA-MM).'],
        ['Valor padrão', 'O valor do período usado quando não há cadastro específico.'],
        ['Unidade', 'O local de atendimento: clínica, filial, centro cirúrgico.'],
        ['sem1…sem5', 'A contagem de períodos em cada semana do mês.']
      ] }
    ]
  };

  window.AtlasDocs['calcular'] = {
    titulo: 'Calcular Repasse',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'É o **coração da ferramenta**. Pega cada linha do relatório do **QVIS** do mês e pergunta: *este procedimento, feito por este profissional, neste papel, pago por esta fonte — gera repasse? De quanto?* A resposta vem da **BASE TABELA**, que é o contrato traduzido em regra.',
        'O resultado é uma **matriz linha a linha** com o valor de repasse e o **motivo** de cada decisão. Nada é pago "no escuro": toda linha tem um status que explica por que entrou, por que ficou zerada ou por que nem foi considerada.',
        'Ao final, o cálculo é **congelado num snapshot** da competência. É esse snapshot que a Auditoria, os Relatórios e o Controle de Notas leem — assim o número não muda sozinho quando alguém mexe no cadastro depois.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Antes de tudo, **importe o QVIS do mês** (menu Importar → QVIS). Sem ele não há o que calcular.',
        'Confira a **BASE TABELA**: todo procedimento que você espera pagar precisa ter regra cadastrada para a combinação **procedimento × papel × fonte**. Procedimento sem regra aparece depois como "Procedimento sem regra".',
        'Confira o **Mapeamento de Papéis**: a palavra que o QVIS usa (CIRURGIAO, MEDICO, AUXILIAR…) precisa estar ligada a um papel oficial. Papel não mapeado vira "Sem regra de papel".',
        'Escolha a **competência** (o mês a calcular) no topo da tela.',
        'Clique em **Calcular**. O processamento roda na sua máquina; em bases grandes leva alguns segundos.',
        'Leia os **cards do topo**: total de repasse, quantas linhas casaram, quantas ficaram sem regra, quantas são glosa. Eles são **clicáveis** e filtram a matriz abaixo.',
        'Ataque primeiro a fila de **"Procedimento sem regra"** — cada uma dessas linhas é dinheiro que ficou de fora. Dá para cadastrar a regra sem sair da tela (botão de cadastro rápido).',
        'Use **⚙ Ajustes** para os casos que fogem do padrão: regras de exceção por médico, pacotes de convênio, perfis de Particular e quais tipos de linha entram no escopo.',
        'Quando os números fecharem, vá para a **Auditoria** para conferir por médico e para os **Relatórios** para exportar.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**linhas_qvis** — o relatório do QVIS importado. Traz admissão, paciente, procedimento (como o QVIS escreve), papel, profissional, convênio, **produzido**, **recebido** e a fonte pagadora (**origem**: CONVENIO / PARTICULAR / SUS).',
        '**tabela_repasse** (BASE TABELA) — a regra: para cada **procedimento × papel × fonte**, um **valor fixo** ou um **percentual**.',
        '**procedimentos** + **sinonimos_proc** — o dicionário que traduz a grafia do QVIS para o procedimento oficial.',
        '**mapeamento_papeis** — traduz a palavra de papel do QVIS para o papel oficial da BASE TABELA.',
        '**linhas_producao** (Produção QVIS) — usada como **base alternativa** quando o produzido do QVIS vem zerado, e para descobrir o executante real da linha-filha de pacote.',
        '**Cadastros de ⚙ Ajustes** — regras de exceção, pacotes de convênio, perfis Particular e tipos de linha habilitados.',
        '**repasse_snapshot** — onde o resultado calculado é congelado, uma linha por competência.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['Escopo — o que entra na conta', 'Só entram linhas com classificação de produto em\n  { CONSULTA, EXAME, PROCEDIMENTO }.\nO resto (taxas, diárias, materiais…) é contado como "fora do escopo" e nem é avaliado.'],
        ['Fonte = valor fixo (Convênio e SUS)', 'repasse = valor da BASE TABELA\n(o produzido não entra na conta — o valor é o combinado)'],
        ['Fonte = percentual (típico de Particular)', 'repasse = base × percentual\n\nbase = produzido da linha do QVIS\nse produzido ≤ 0 → base = valor da mesma admissão na PRODUÇÃO\nse ainda assim ≤ 0 → a linha fica "Sem regra de papel"'],
        ['Glosa', 'recebido = 0  →  repasse = 0\n(a linha continua classificada e auditável, mas não paga)'],
        ['Papel não remunerado', 'regra existe mas valor E percentual estão vazios/zerados\n→ a linha é OMITIDA (não é erro: é o combinado de não pagar aquele papel)'],
        ['Total do mês', 'Total de repasse = soma do repasse de todas as linhas com status "casou"']
      ] },

      { titulo: 'Ordem das regras (quem vence quem)', tipo: 'lista-ordenada', conteudo: [
        '**Glosa** — recebido = 0. A linha é classificada (procedimento e papel), mas paga **zero** e não entra em nenhum total.',
        '**Identificar o procedimento**, em três camadas, da mais segura para a mais permissiva: (1) **exato** no nome normalizado; (2) **sinônimo** cadastrado; (3) **similaridade de Levenshtein ≥ 0,88**, que tolera pequenos erros de digitação. Falhou nas três → **Procedimento sem regra**.',
        '**Identificar o papel** pelo mapeamento. Não mapeado → **Sem regra de papel**.',
        '**Duplicidade histórica** — a mesma **admissão + procedimento + papel** já foi paga numa competência anterior. Paga **zero** e é marcada como duplicada, com o mês em que já foi paga.',
        '**Perfil Particular** — se a admissão tem um perfil cadastrado, ela passa a ser paga por **outra tabela** (Convênio, por padrão) em vez da origem real. Cada procedimento pode ter um **valor fixo** próprio (pago 1× por admissão+procedimento) ou trocar a tabela. **HONORÁRIO MÉDICO fica fora** dessa troca.',
        '**Regra de exceção** (médico + procedimento + papel + fonte) — sobrescreve tudo o que vem da BASE TABELA. Busca a fonte específica e, se não achar, a fonte **TODAS**. Respeita a **vigência**: só vale se a data da admissão for igual ou posterior ao início. Se a exceção for de extração **PRODUÇÃO**, o valor é pago 1× por admissão pelo canal do Desempenho e a linha do QVIS paga zero (para não duplicar).',
        '**Pacote de convênio** — só para origem CONVENIO, quando o convênio está cadastrado num pacote (casa por nome **exato**, por **vínculo manual** ou por **prefixo**: "AMIL" cadastrado bate com "AMIL (DF)"). A **linha-mãe** (a consulta) recebe o valor de consulta do pacote; a **linha-filha** (exames inclusos) recebe o valor extra, com o executante real buscado na Produção.',
        '**BASE TABELA** — o fluxo normal, e o caso da imensa maioria das linhas. Se o procedimento é novo e não existe na versão congelada da tabela, cai no **fallback para a tabela viva**, para que um cadastro feito agora já valha.'
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        '**Linha do QVIS:** FACECTOMIA · papel CIRURGIAO · origem CONVENIO · produzido R$ 3.000,00 · recebido R$ 2.700,00',
        'Recebido > 0, então **não é glosa**. O procedimento casou como FACECTOMIA (match exato) e o papel CIRURGIAO casou com EXECUTANTE.',
        'Na BASE TABELA, FACECTOMIA × EXECUTANTE × CONVENIO tem **valor fixo de R$ 450,00**.',
        '**Repasse = R$ 450,00.** O produzido de R$ 3.000,00 não entra na conta — em Convênio vale o valor combinado.',
        '— — —',
        '**Mesma linha, mas origem PARTICULAR**, e a regra dessa fonte é **percentual de 30%**:',
        '**Repasse = 3.000,00 × 0,30 = R$ 900,00.** Aqui o produzido é a base.'
      ] },

      { titulo: 'O que cada status significa', tipo: 'glossario', conteudo: [
        ['Casou', 'A linha achou regra e gerou repasse. É a única fila que entra no total.'],
        ['Procedimento sem regra', 'O procedimento do QVIS não existe na BASE TABELA. Ação: cadastrar a regra — é dinheiro fora do cálculo.'],
        ['Sem regra de papel', 'O papel que veio do QVIS não está no mapeamento, ou a base de cálculo do percentual ficou zerada. Ação: mapear o papel.'],
        ['Glosa', 'Recebido = 0: o convênio não pagou. Repasse zero, mas a linha fica visível para cobrança.'],
        ['Duplicada', 'Admissão + procedimento + papel já pagos em mês anterior. Repasse zero, com o mês de origem registrado.'],
        ['Fora do escopo', 'A linha não é CONSULTA, EXAME nem PROCEDIMENTO. Nem chega a ser avaliada.'],
        ['Sem remuneração', 'Existe regra, mas ela é explicitamente zerada para aquele papel. Omitida de propósito.']
      ] },

      { titulo: 'Filtros da tela', tipo: 'lista', conteudo: [
        '**Competência** — o mês que está sendo calculado.',
        '**Status** — casou, glosa, procedimento sem regra, sem regra de papel, duplicada. Os cards do topo são atalhos para esses filtros.',
        '**Fonte** — Convênio, Particular, SUS ou Perfil.',
        '**Papel** — filtra por papel oficial.',
        '**Admissão · Profissional · Procedimento · Convênio · Especialidade** — cinco campos que aceitam texto livre (busca por trecho, ignorando acento) **ou** marcação de vários valores exatos na lista.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'O match por **similaridade é a última camada**, nunca a primeira. Ele só entra quando o exato e os sinônimos falham — e ainda assim exige 88% de semelhança. Se um procedimento estranho casou, vale conferir o tipo de match na linha.',
        'A mesma linha pode ter **regra diferente por fonte**. Cadastrar só a regra de Convênio não paga o Particular.',
        '**Recalcular sobrescreve o snapshot** daquela competência. Os módulos que leem o snapshot (Auditoria, Relatórios, Controle de Notas) passam a ver o número novo.',
        'Mexer na BASE TABELA **não muda sozinho** um mês já calculado — é preciso recalcular a competência.',
        '**Glosa não é erro de cadastro.** É produção que o convênio não pagou; o lugar de resolver é a cobrança, não a tabela.',
        'Linha **duplicada** é proteção contra pagar duas vezes a mesma admissão em meses diferentes. Se for um caso legítimo, trate por regra de exceção.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['QVIS', 'O sistema de origem. O relatório dele é a base de pagamento do mês.'],
        ['BASE TABELA', 'O cadastro que diz quanto se paga por procedimento × papel × fonte.'],
        ['Papel', 'A função exercida na linha: executante, auxiliar, solicitante, indicante…'],
        ['Fonte pagadora', 'Quem paga: Convênio, Particular ou SUS. Cada uma pode ter regra própria.'],
        ['Produzido', 'O valor bruto do procedimento, como veio do QVIS.'],
        ['Recebido', 'O que o convênio efetivamente pagou. Zero significa glosa.'],
        ['Admissão', 'O atendimento/conta que agrupa os procedimentos de um paciente.'],
        ['Sinônimo', 'Uma grafia alternativa de procedimento já ensinada à ferramenta.'],
        ['Levenshtein', 'Medida de distância entre dois textos; aqui tolera pequenos erros de digitação.'],
        ['Snapshot', 'A fotografia do cálculo de uma competência, congelada para os outros módulos lerem.'],
        ['Competência', 'O mês de referência do cálculo, no formato AAAA-MM.']
      ] }
    ]
  };

  // ── ATLAS v1.3: INSPEÇÃO (admissão + relatório final) ──────────────────
  window.AtlasDocs['inspecao'] = {
    titulo: 'Inspeção',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'É o módulo de **auditoria** do ATLAS. A aba **Admissão** rastreia uma admissão pelas quatro bases — como ela **chega do sistema**, como fica no **Consolidado** da ferramenta, como aparece na **produção analítica** e o que o médico **de fato recebeu** no relatório final — e diz onde ela parou.',
        'A aba **Relatório final** importa os relatórios que os médicos receberam (um arquivo por médico e mês de pagamento, vários de uma vez) e faz a auditoria em lote: confronta o que a ferramenta manda pagar com o que foi pago e lista **o que falta pagar** ao médico.'
      ] },
      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Importe o **relatório do sistema** (Importar Sistema) dos meses auditados e tenha a **Base Tabela** vigente na época — o "deveria" nasce deles.',
        'Na aba **Relatório final**, importe os relatórios dos médicos (.xlsx/.xls/.csv). Médico e competência saem do arquivo; o que faltar é perguntado.',
        'Marque os relatórios (ou nenhum, para todos) e clique em **Auditar**. Meses sem cálculo salvo são calculados na hora, com as regras do Calcular.',
        'Leia o resultado: totais por médico e mês, categorias e a lista item a item. Clique num item para abrir a admissão na aba **Admissão**.',
        'Exporte o Excel (**Falta pagar**, Conforme, Avisos, Resumo) ou mande as admissões com valor faltante para a **pauta**.'
      ] },
      { titulo: 'Categorias do confronto', tipo: 'lista', conteudo: [
        '**Conforme** — deveria = recebido.',
        '**Pago a menor** — recebeu menos que a regra manda: falta a diferença.',
        '**Papel não pago** — a admissão está no relatório final, mas aquele papel (auxiliar, indicante, laudo…) não foi pago.',
        '**Não consta no relatório final** — a admissão foi recebida pelo hospital e calculada, e não aparece no relatório do médico.',
        '**Com regra e sem pagamento** — linha do sistema com regra na Base Tabela e sem pagamento em lugar nenhum.',
        '**Recebido sem lastro / Pago a maior / Glosa / Estorno / Aguardando convênio** — informativos: não somam na cobrança.'
      ] },
      { titulo: 'Regras de leitura do relatório final', tipo: 'lista', conteudo: [
        'Nunca deduplica: a soma das linhas é o valor da nota; linhas repetidas e **negativas (estornos)** contam.',
        '**GLOSA vale zero** no confronto.',
        'Competência = **mês do pagamento** ("Pagamentos liberados entre …", "Competência: …", nome do arquivo).',
        'Layout manual sem coluna de admissão: a admissão é resolvida por **paciente + data** na produção e no sistema.'
      ] },
    ]
  };

  window.AtlasDocs['relatorios'] = {
    titulo: 'Relatórios',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'É a **saída** da ferramenta: onde o mês vira documento. Reúne o **Relatório Repasse** — a matriz consolidada da Auditoria, com as mesmas 9 colunas — e um **fichário por módulo de Desempenho**, todos sob um **único seletor de mês**.',
        'A exportação pode sair **consolidada** (um arquivo com tudo) ou **por médico** (um bloco por profissional, que é o formato que vai para o e-mail do repasse). E é aqui que os **ajustes aplicados do Gerenciais** entram como linhas do Consolidado.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Chegue aqui com as etapas anteriores prontas: **Calcular** → **Auditoria** → **Gerenciais**.',
        'Escolha o **mês** no seletor do topo — ele vale para todos os fichários de uma vez.',
        'Confira o **Relatório Repasse**: é a matriz consolidada, com os ajustes gerenciais aplicados já injetados.',
        'Use os **filtros de coluna** do Consolidado para conferir recortes: cada coluna aceita busca por trecho **ou** marcação de vários valores exatos.',
        'Percorra os **fichários de Desempenho** para conferir cada módulo isoladamente.',
        'Se houver algo fora do fluxo automático, inclua **linhas avulsas** manualmente no consolidado.',
        'Exporte: **consolidado** para o arquivo do mês, **por médico** para o envio individual.',
        'Com o relatório fechado, siga para a **Consolidação de Repasse** e depois para o **Controle de Notas**.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**Auditoria** — a matriz consolidada do mês, já com as linhas-filhas criadas.',
        '**Os fichários de Desempenho** — OPME, LIO, Estrabismo, Lentes de Contato, Luz Pulsada, Crosslink, Refractive Laser, Fellow, Fracionamento, Cargos, Laudos e Períodos.',
        '**Gerenciais** — os ajustes com status **aplicado** no mês, injetados como linhas do Consolidado.',
        '**Linhas avulsas** — lançamentos manuais feitos aqui mesmo.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['Composição do Consolidado', 'Consolidado = matriz da Auditoria do mês\n            + linhas dos fichários de Desempenho\n            + ajustes APLICADOS do Gerenciais\n            + linhas avulsas lançadas aqui'],
        ['Resultado dos fichários', 'Cada fichário entrega quatro colunas:\n   Módulo · Profissional · Competência · Valor\n\nÉ esse formato comum que permite somar módulos com\nregras completamente diferentes.'],
        ['Total do médico no mês', 'total = soma de tudo o que tem o nome dele no Consolidado,\n        em todos os módulos e ajustes'],
        ['O que NÃO entra', 'Ajuste pendente ou descartado do Gerenciais.\nMódulo de Desempenho que o médico tenha bloqueado no\ncadastro de exceções.']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        'No mês, um médico aparece em quatro linhas do Consolidado:',
        '· **Repasse (matriz da Auditoria)** — R$ 9.400,00',
        '· **LIO** — R$ 1.230,00',
        '· **Lentes de Contato** — R$ 2.160,00',
        '· **Ajuste gerencial (desconto de adiantamento)** — − R$ 800,00',
        '**Total do médico no mês = R$ 11.990,00** — e é esse número que a etiqueta do Controle de Notas usa para conferir a nota fiscal dele.'
      ] },

      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Mês** — um só, valendo para todos os fichários.',
        'No Consolidado, **filtro por coluna**: busca por trecho (**contém**) ou **lista de valores exatos** com marcação múltipla.',
        'O **botão flutuante** oferece exportação já respeitando os filtros ativos.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'O Relatórios **não calcula nada**: ele reúne. Número errado aqui quase sempre nasceu no Calcular, na Auditoria ou num fichário.',
        'Ajuste **pendente** no Gerenciais **não aparece** no Consolidado. Se um acerto combinado não está no relatório, confira o status dele.',
        'A exportação **por médico** e a **consolidada** têm o mesmo conteúdo, organizado de forma diferente — não são números diferentes.',
        'Trocar o mês recarrega **todos** os fichários; em base grande isso leva alguns segundos.',
        '**Linha avulsa** é lançamento manual: fica no relatório, mas não tem memória de cálculo por trás. Use a descrição para explicar a origem.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Consolidado', 'A matriz que junta o repasse de todas as fontes do mês.'],
        ['Relatório Repasse', 'A matriz consolidada da Auditoria, com 9 colunas.'],
        ['Fichário', 'O relatório de um módulo específico de Desempenho.'],
        ['Linha avulsa', 'Lançamento manual incluído no consolidado.'],
        ['Exportação por médico', 'O formato individual, usado no envio do repasse.']
      ] }
    ]
  };


  window.AtlasDocs['dashboard'] = {
    titulo: 'Visão Geral',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'É o **painel executivo**: três números que resumem o mês — **Produção**, **Repasse** e **Glosa** — cada um comparado com o mês anterior e com o mesmo mês do ano passado.',
        'A leitura mais importante desta tela é entender que **os três cards não falam da mesma coisa no mesmo recorte de tempo**. Produção é contada pela **data de admissão** (quando o procedimento aconteceu); Repasse, pela **data de pagamento** (quando o dinheiro saiu). São perguntas diferentes, e por isso os números **não batem linha a linha** — nem deveriam.',
        'Cada gráfico e cada ilha da tela tem o seu **próprio ⓘ**, com a explicação de como lê-lo.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Escolha o **mês**.',
        'Leia os três cards principais e as variações **LM** (mês anterior) e **LY** (mesmo mês do ano passado).',
        'Use os filtros de **médico** e **módulo** para recortar.',
        'Clique no **ⓘ de cada gráfico** para entender o que ele mostra antes de tirar conclusões — cada um tem fonte e recorte próprios.',
        'Ao encontrar algo estranho, desça para o módulo de origem: produção estranha se investiga na **Produção Médica**; repasse, no **Calcular** e na **Auditoria**; glosa, no **OPME** e no **Calcular**.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**Produção** = soma de **linhas_producao.valor**, filtrada por **data de admissão**.',
        '**Repasse** = o **consolidado do Relatórios** (matriz da Auditoria + fichários), filtrado por **data de pagamento**.',
        '**Glosa** = linhas de **Convênio/SUS** com recebido ≤ 0, contando **só o papel executante** (MEDICO/CIRURGIAO).',
        'A **perda estimada** da glosa usa a regra da Base Tabela sobre o produzido — o mesmo motor do Calcular.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['Produção do mês', 'produção = soma do valor das linhas de produção\n           cuja DATA DE ADMISSÃO cai no mês'],
        ['Repasse do mês', 'repasse = total do consolidado do Relatórios\n          cuja DATA DE PAGAMENTO cai no mês\n\nRecorte de tempo DIFERENTE do da produção — de propósito.'],
        ['Glosa', 'glosa = linhas de Convênio ou SUS com recebido ≤ 0\n        contando 1× por procedimento\n        e SÓ o papel executante (MEDICO/CIRURGIAO)\n\nSem a trava de papel, a mesma glosa seria contada\nvárias vezes (uma por papel da linha).'],
        ['Perda estimada da glosa', 'perda = regra da Base Tabela aplicada sobre o produzido\n        das linhas glosadas\n\nÉ o repasse que teria existido se o convênio tivesse pago.'],
        ['Comparativos', 'LM = mês imediatamente anterior\nLY = mesmo mês do ano anterior\n\nvariação = (mês atual ÷ mês de comparação) − 1']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        'Julho fecha com **Produção R$ 1.000.000,00** e **Repasse R$ 210.000,00**.',
        'Não conclua que "o repasse é 21% da produção **de julho**": o repasse de julho paga procedimentos que podem ter sido feitos em junho ou maio.',
        'Junho teve produção de R$ 900.000,00 → **LM da produção = +11,1%**.',
        'Julho do ano passado teve R$ 800.000,00 → **LY = +25,0%**.',
        'Para a relação repasse/produção **dentro da mesma competência**, o lugar certo é o card **% sobre PROD** da Produção Médica.'
      ] },

      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Mês** (competência).',
        '**Médico** e **Módulo**.',
        'O escopo é o da unidade desta instalação.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'Produção e Repasse usam **datas diferentes** (admissão × pagamento). Dividir um pelo outro nesta tela dá um indicador enviesado.',
        'A glosa conta **1× por procedimento** e só pelo executante — comparar com uma contagem de linhas do QVIS dará outro número.',
        'A **perda estimada** é uma projeção, não um valor a receber: supõe que a regra da Base Tabela se aplicaria integralmente.',
        'Esta tela é de **leitura**. Nenhuma correção se faz aqui; ela aponta onde olhar.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Produção', 'Tudo que foi produzido no mês, pela data de admissão.'],
        ['Repasse', 'O que foi repassado aos médicos, pela data de pagamento.'],
        ['Glosa', 'Produção de Convênio/SUS com recebido = 0.'],
        ['Perda estimada', 'O repasse que a glosa custou, estimado pela Base Tabela.'],
        ['LM', 'Last Month — o mês imediatamente anterior.'],
        ['LY', 'Last Year — o mesmo mês do ano anterior.']
      ] }
    ]
  };


  window.AtlasDocs['auditoria'] = {
    titulo: 'Auditoria',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'O QVIS registra quem fez o procedimento, mas nem sempre registra **todo mundo que tinha direito a receber por ele**. Falta o auxiliar, falta o indicante, falta o solicitante. Cada ausência dessas é um médico que não recebe.',
        'A Auditoria usa a **BASE TABELA como gabarito**: se a tabela diz que aquele procedimento remunera auxiliar e indicante, e o QVIS só trouxe o cirurgião, o módulo **cria as linhas que faltaram** — marcadas como **ATLAS**, para ficar claro que não vieram do QVIS.',
        'Um ponto importante de arquitetura: o **Calcular é só leitura** aqui. A Auditoria lê o snapshot calculado, aplica as correções e guarda o resultado corrigido **dentro dela**. Nada volta para o Calcular — recalcular não apaga a auditoria, e auditar não muda o cálculo.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Rode o **Calcular Repasse** da competência primeiro. A Auditoria lê o snapshot dele; sem cálculo, não há o que auditar.',
        'Abra a Auditoria e escolha a **competência**.',
        'Percorra as **linhas-filhas ATLAS** criadas — cada uma é um papel que a BASE TABELA exigia e o QVIS não trouxe.',
        'Confira as **notificações**: são os casos em que o módulo identificou a falta mas **não tinha como preencher** (por exemplo, auxiliar exigido num procedimento sem cirurgião registrado). Ele avisa em vez de inventar um nome.',
        'Confira também os **auxiliares renomeados**: quando o auxiliar registrado é diferente do cirurgião daquele procedimento, o módulo passa o valor para o cirurgião, porque é essa a regra da casa.',
        'Use os filtros (com marcação múltipla) para varrer por médico, procedimento ou admissão.',
        'Com a matriz conferida, siga para **Gerenciais** (ajustes manuais) e depois para **Relatórios**.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**repasse_snapshot** — o resultado do Calcular da competência. É a entrada, lida sem ser alterada.',
        '**tabela_repasse** (BASE TABELA) — o gabarito: quais papéis cada procedimento remunera.',
        '**linhas_producao** (Produção QVIS) — de onde saem os nomes de indicante e solicitante, buscados pelo código exato da admissão.',
        'O resultado corrigido é guardado **na própria Auditoria**.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['A chave da auditoria', 'chave = admissão + procedimento\n\nE só onde HÁ repasse: linha de GLOSA é ignorada —\nnão faz sentido completar papéis de algo que não pagou.'],
        ['Detecção do papel faltante', 'papéis exigidos = os que a BASE TABELA remunera para\n                  aquele procedimento\npapéis presentes = os que vieram no QVIS\n\nfaltantes = exigidos − presentes\n→ cada faltante vira uma LINHA-FILHA com status ATLAS'],
        ['Como a linha-filha é preenchida — AUXILIAR', 'nome = o CIRURGIÃO daquele procedimento\n(o valor do auxiliar sempre vai para o cirurgião)\n\nSem cirurgião registrado no procedimento → NOTIFICA.\nO módulo avisa; não inventa nome.'],
        ['Como a linha-filha é preenchida — INDICANTE / SOLICITANTE', 'busca em linhas_producao pelo cod_admissao EXATO:\n   1º) a coluna "indicante"\n   2º) se vazia, a coluna "solicitante"\n\nNada encontrado → NOTIFICA.'],
        ['Auxiliar já presente, mas com nome divergente', 'Se o auxiliar registrado ≠ cirurgião do procedimento\n→ a linha é RENOMEADA para o cirurgião.\n\nÉ a mesma regra de cima, aplicada a uma linha que já existia.'],
        ['Valor da linha-filha', 'O valor sai da BASE TABELA para aquele\nprocedimento × papel × fonte — a mesma regra do Calcular.']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        '**Admissão 12345 · FACECTOMIA.** A BASE TABELA diz que esse procedimento remunera **executante, auxiliar e indicante**.',
        'O QVIS trouxe só o **executante** (Dr. A, R$ 450,00).',
        'A Auditoria cria duas linhas-filhas ATLAS:',
        '· **Auxiliar** → nome = Dr. A (o cirurgião do procedimento), valor da BASE TABELA para auxiliar, por exemplo R$ 90,00.',
        '· **Indicante** → busca na Produção a admissão 12345 e encontra a Dra. B na coluna indicante → linha de R$ 45,00 para ela.',
        'Total da admissão sai de R$ 450,00 para **R$ 585,00**, e agora a Dra. B recebe a indicação que o QVIS tinha perdido.'
      ] },

      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Competência**.',
        '**Médico · Procedimento · Admissão · Convênio**, todos com marcação de vários valores ao mesmo tempo.',
        'Recortes por **status da linha** (veio do QVIS, criada pelo ATLAS, notificada).'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'A Auditoria **depende do Calcular**. Mexeu na BASE TABELA? Recalcule a competência antes de auditar, senão o gabarito e o snapshot ficam desencontrados.',
        'Nada do que a Auditoria faz **volta para o Calcular**. Os dois números convivem de propósito: um é o cru, o outro é o corrigido.',
        '**Notificação não é linha criada.** É um pedido de intervenção humana — o módulo achou a falta mas não tinha nome confiável para usar.',
        'A regra de o **auxiliar ir para o cirurgião** é da casa, não uma inferência. Se o caso for legítimo de outro auxiliar, trate por exceção no Calcular.',
        '**Glosa é ignorada** de propósito: completar papéis de uma linha que não pagou geraria repasse sobre dinheiro que não entrou.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Linha-filha', 'A linha criada pela Auditoria para um papel que faltava no QVIS.'],
        ['Status ATLAS', 'A marca que identifica uma linha criada pela ferramenta, não vinda do QVIS.'],
        ['Gabarito', 'A BASE TABELA usada como referência do que o procedimento deveria remunerar.'],
        ['Notificação', 'Aviso de falta que o módulo não conseguiu preencher sozinho.'],
        ['Completude', 'O quanto o QVIS trouxe de tudo o que deveria ter trazido.'],
        ['Snapshot', 'O resultado congelado do Calcular, que a Auditoria lê sem alterar.']
      ] }
    ]
  };

  window.AtlasDocs['gerenciais'] = {
    titulo: 'Gerenciais',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'Nem tudo cabe em regra automática. Um acerto de mês anterior, um desconto combinado, um crédito pontual, um adiantamento — são decisões humanas que precisam entrar no repasse **sem distorcer o cálculo**.',
        'É para isso que existe o Gerenciais: cada ajuste vira **uma linha no Consolidado do mês**, com crédito (+) ou desconto (−), rastreável e com descrição.',
        'O módulo também é um **portão de qualidade**: só ajustes **aplicados** entram no Consolidado, e a Consolidação de Repasse se recusa a rodar enquanto houver pendente. Isso força a decisão a ser tomada antes do fechamento, não depois.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Crie o ajuste informando **médico**, **descrição**, **valor com sinal** (+ crédito, − desconto) e, se fizer sentido, a **admissão**.',
        'Decida se ele é pontual ou se deve **fixar mensalmente**. Fixado, ele reaparece todo mês a partir do mês de criação, até ser desativado.',
        'Depois de rodar o **Calcular Repasse**, um alerta lista os **pendentes** do mês — recorrentes e pontuais.',
        'Para cada pendente, decida: **aplicar** (entra no Consolidado) ou **descartar** (fica registrado como decidido, mas não entra).',
        'Só quando não sobrar nenhum pendente a **Consolidação de Repasse** libera o fechamento.',
        'Confira no Relatórios: os ajustes aplicados aparecem como linhas do Consolidado do mês.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        'Os ajustes são **cadastrados aqui**, à mão — não vêm de importação.',
        'Cada ajuste guarda: médico, descrição, valor com sinal, admissão (opcional) e a marca de recorrência.',
        'O **status é por mês**: o mesmo ajuste recorrente pode estar aplicado em março e pendente em abril.',
        'O módulo expõe uma interface usada pelo **Calcular** (para o alerta de pendentes) e pelo **Relatórios** (para injetar as linhas aplicadas no Consolidado).'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['O ajuste é uma linha, não uma fórmula', 'valor do ajuste = exatamente o que foi digitado\n\n+ crédito   → soma ao repasse do médico no mês\n− desconto  → subtrai do repasse do médico no mês'],
        ['O que entra no Consolidado', 'Só ajustes com status APLICADO naquele mês.\nPendente e descartado ficam de fora.'],
        ['Recorrência', 'Ajuste "fixado mensalmente" é RECRIADO como pendente a\ncada mês, a partir do mês de criação, até ser desativado.\n\nCada mês tem o seu próprio status — aplicar em um mês não\naplica nos outros.'],
        ['Portão da consolidação', 'A Consolidação de Repasse só roda se:\n   quantidade de ajustes PENDENTES no mês = 0']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        'Um médico teve **R$ 12.000,00** de repasse calculado no mês.',
        'Existe um ajuste de **− R$ 800,00** (desconto de adiantamento) e outro de **+ R$ 300,00** (acerto de glosa recuperada do mês anterior).',
        'Ambos **aplicados** → o Consolidado do mês traz as duas linhas, e o total do médico fica **12.000 − 800 + 300 = R$ 11.500,00**.',
        'Se o de R$ 300,00 ficasse **pendente**, a Consolidação nem rodaria — o portão exige decisão antes do fechamento.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        '**Pendente trava o fechamento.** Isso é proposital: melhor parar e decidir do que consolidar um mês incompleto.',
        '**Descartar não é apagar.** O ajuste fica registrado como decidido — a rastreabilidade se mantém.',
        'Um ajuste **recorrente** continua nascendo todo mês até ser desativado. Acerto que valia só uma vez não deve ser fixado.',
        'O **sinal do valor** é o que define crédito ou desconto. Digitar um desconto sem o menos vira crédito.',
        'A descrição é o que vai aparecer no Consolidado e no relatório do médico — escreva pensando em quem vai ler depois.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Ajuste gerencial', 'Um crédito ou desconto manual, fora da regra automática.'],
        ['Pendente', 'Ajuste criado e ainda não decidido naquele mês.'],
        ['Aplicado', 'Ajuste que entra no Consolidado do mês.'],
        ['Descartado', 'Ajuste decidido como "não entra"; fica registrado.'],
        ['Fixar mensalmente', 'Faz o ajuste reaparecer todo mês até ser desativado.'],
        ['Portão', 'A trava que impede consolidar o mês com ajustes pendentes.']
      ] }
    ]
  };

  window.AtlasDocs['consolidacao'] = {
    titulo: 'Consolidação de Repasse',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'É o **fechamento do mês**. Você informa um **código único** e o módulo **congela a lista de admissões** daquele mês sob esse código. A partir daí, aquele conjunto vira histórico: não muda mais.',
        'E se uma admissão nova aparecer depois — porque o QVIS foi reimportado, porque um lançamento atrasou? Ela **não entra escondida** no que já foi fechado. Vira um **acréscimo**, a ser consolidado de novo sob o mesmo código, de forma visível.',
        'A tela é **leve de propósito**: trabalha sempre por mês, com consultas agregadas direto na base. Ela não remonta a matriz do Relatórios — mostra o **resumo** e permite a **busca pontual** de uma admissão.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Feche antes as etapas anteriores: **Calcular** → **Auditoria** → **Gerenciais**.',
        'Garanta que **não há ajustes pendentes** no Gerenciais. Havendo, a consolidação não libera — esse é o portão.',
        'Escolha o **mês** e informe o **código da consolidação** (único do mês).',
        'Confira o **resumo** de totais antes de confirmar.',
        'Confirme. A lista de admissões daquele mês fica **congelada** sob o código.',
        'Depois disso, use a **busca de admissão** para conferências pontuais.',
        'Se aparecerem admissões novas, elas serão listadas como **acréscimo** — consolide-as novamente sob o mesmo código.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**linhas_qvis** — lidas por mês, com consultas agregadas (o módulo não remonta a matriz do Relatórios).',
        '**consolidacao_mes** — onde o código e a lista congelada de admissões ficam guardados.',
        '**Gerenciais** — consultado apenas para saber se há ajustes pendentes.'
      ] },

      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['Portão de entrada', 'ajustes pendentes no Gerenciais = 0\n→ senão, a consolidação não roda'],
        ['O que é congelado', 'A LISTA DE ADMISSÕES do mês, sob o código informado.\nO congelado fica intacto, mesmo que a base mude depois.'],
        ['Acréscimo', 'admissão que aparece DEPOIS do congelamento\ne não está na lista congelada\n→ entra como ACRÉSCIMO, para ser consolidada de novo\n   sob o MESMO código'],
        ['Totais do resumo', 'Somados direto de linhas_qvis do mês, por consulta\nagregada — rápido mesmo em base grande.']
      ] },

      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        'Em julho foram consolidadas **1.240 admissões** sob o código **2026-07-A**.',
        'Uma semana depois, o QVIS é reimportado e passa a ter **1.247 admissões** no mesmo mês.',
        'As 1.240 originais continuam **intactas**. As **7 novas** aparecem como **acréscimo**, listadas separadamente.',
        'Você as consolida sob o mesmo código **2026-07-A** — e agora o mês tem 1.247 admissões fechadas, com o histórico de que 7 entraram depois.',
        'Nada foi sobrescrito em silêncio: é exatamente isso que a consolidação protege.'
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'O **código é único do mês**. Reaproveitar um código de outro mês confunde o histórico.',
        'Consolidar **não recalcula nada** — ele congela o que já existe. Corrigir cálculo depois de consolidar exige tratar o resultado como acréscimo.',
        'A tela mostra **resumo**, não a matriz. Para conferir linha a linha, o lugar é o Relatórios.',
        'O portão dos ajustes pendentes existe para evitar fechar um mês com decisão financeira em aberto — não contorne, resolva no Gerenciais.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Consolidar', 'Congelar a lista de admissões de um mês sob um código.'],
        ['Código da consolidação', 'O identificador único daquele fechamento mensal.'],
        ['Acréscimo', 'Admissão que apareceu depois do congelamento e precisa ser consolidada de novo.'],
        ['Portão', 'A exigência de não haver ajustes pendentes no Gerenciais.'],
        ['Congelado', 'O conjunto que não muda mais, mesmo que a base seja reimportada.']
      ] }
    ]
  };

  window.AtlasDocs['sistema'] = {
    titulo: 'Sistema',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'É a **manutenção** do ATLAS, com duas abas: **Backup** e **Administração**.',
        'Vale entender um ponto de arquitetura antes de tudo: o ATLAS roda **inteiramente na sua máquina**, sem servidor. Isso é o que protege os dados dos pacientes — nada sai daqui. Mas também significa que **não existe backup automático em nuvem**. O arquivo **.db** que você exporta nesta tela é a sua única rede de segurança.'
      ] },

      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        '**Exporte o .db com frequência** — ao menos ao fim de cada fechamento mensal, e sempre antes de qualquer operação grande (reimportar uma base, restaurar, limpar um mês).',
        'Guarde as cópias com o **mês no nome** e em mais de um lugar.',
        'Para restaurar, importe o **.db** desejado. Lembre: isso **substitui o banco atual por inteiro**.',
        'Na aba **Administração**, ajuste as **permissões** de acesso por módulo.',
        'Troque a **senha do admin** quando necessário — é ela que libera ações sensíveis em outros módulos, como desmarcar um pagamento já conferido.',
        'Consulte o **log local de erros** quando algo se comportar de forma estranha; ele registra o que aconteceu na sua máquina.'
      ] },

      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        'O **banco inteiro** da aplicação: todas as importações, todos os cadastros, todos os cálculos e snapshots.',
        'As **anotações de módulo** (o campo de notas de cada ⓘ) também viajam no backup.',
        'O **log de erros** é local, gravado nesta máquina.'
      ] },

      { titulo: 'O que o backup leva — e o que ele significa', tipo: 'formula', conteudo: [
        ['Conteúdo do .db', 'QVIS e Produção importados\n+ BASE TABELA e todos os cadastros\n+ snapshots de cálculo por competência\n+ auditoria, gerenciais e consolidações\n+ configurações e anotações dos módulos'],
        ['Restauração', 'Importar um .db SUBSTITUI o banco atual por inteiro.\nNão é mesclagem: o que estava aqui é descartado.\n\nPor isso: exporte o atual ANTES de restaurar outro.'],
        ['Sem servidor, sem nuvem', 'Não há cópia remota. Perdeu a máquina sem .db exportado,\nperdeu o histórico.']
      ] },

      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        '**Restaurar substitui tudo.** Exporte o banco atual antes, sempre — inclusive quando tiver certeza.',
        'Backup que mora só na mesma máquina não é backup: se o disco falhar, ele vai junto.',
        'A **senha do admin** protege ações destrutivas em outros módulos. Compartilhá-la anula essa proteção.',
        'As **permissões por módulo** controlam o que cada acesso enxerga — revise quando alguém mudar de função.',
        'Os dados aqui são **sensíveis** (pacientes e valores). O arquivo .db merece o mesmo cuidado de um documento confidencial.'
      ] },

      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Backup (.db)', 'Cópia do banco inteiro num único arquivo.'],
        ['Restauração', 'Importar um .db, substituindo o banco atual.'],
        ['Permissões', 'Quais módulos cada acesso pode abrir.'],
        ['Senha do admin', 'A credencial que libera ações sensíveis nos outros módulos.'],
        ['Log de erros', 'Registro local do que deu errado na aplicação.'],
        ['Offline', 'A ferramenta roda sem servidor; os dados não saem da máquina.']
      ] }
    ]
  };


  window.AtlasDocs['producao-medica'] = {
    titulo: 'Produção Médica',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'Monta o **balanço por médico** do mês: o quanto cada profissional **produziu**, o quanto disso **volta para ele** em repasse, e quanto pesa o **desempenho** dos 12 fichários — tudo num quadro só.',
        'É o módulo que responde à pergunta de gestão: *quanto da receita está indo para repasse?* Por isso ele traz a **Receita competência**, o imposto do mês e o **% sobre produção**, com faixa de alerta.',
        'Diferente do Calcular, aqui a linha é **colapsada no executante**: um dono por linha. O repasse dos outros papéis entra como "o todo" recebido, mas a produção pertence a quem executou.'
      ] },
      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Importe a **Produção** do mês e tenha a **Base Tabela** em dia — é ela que transforma produção em repasse.',
        'Escolha a **competência**.',
        'No **botão flutuante**, confira a ilha **Vínculo**: por regra o **Externo vem desmarcado**. Se o número parecer baixo, esse é o primeiro lugar a olhar.',
        'Informe o **% de imposto** da competência (⚖ Imposto). Sem ele, a Receita líquida fica igual à bruta e o **% sobre PROD** sai distorcido.',
        'Leia os cards na ordem: **Receita competência** → **Produção Total** → os três recortes (Convênio, Particular, SUS) → **Desempenho**.',
        'Escolha a **visão**: **Contábil** (o congelado, que não muda com reimportação) ou **Gerencial** (sempre atualizado). O switch troca só o repasse; a produção é a mesma nas duas.',
        'Use o **⚙ Classificação** para incluir os itens que ficam fora do padrão (OPME, material, taxa) e ver o impacto no total.',
        'Abra o **Mês a mês** no botão flutuante para a série do ano, já ordenada do maior para o menor, e exporte respeitando os filtros da tela.'
      ] },
      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**linhas_producao** (Produção QVIS) — o que foi produzido: valor, produto, classificação, fonte e executante.',
        '**tabela_repasse** (Base Tabela) — a regra que transforma produção em repasse, por procedimento × papel × fonte.',
        '**Desempenho consolidado** — o repasse dos 12 fichários, via Relatórios.',
        '**% de imposto por competência** — informado na própria tela, um por mês.',
        '**Cadastro de Médicos** — o vínculo, que decide quem entra no recorte.'
      ] },
      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['Quem é o dono da linha', 'executante = Cirurgião\nse Cirurgião vazio → executante = Médico\n\nUm dono por linha: a produção inteira é dele.'],
        ['Produção bruta', 'produção = Valor R$ da linha\n\nConta MESMO sem regra na Base Tabela — nesse caso a\nprodução aparece e o recebido fica 0.'],
        ['Recebido ("o todo")', 'recebido = repasse do Executante\n          + repasse do Indicante/Solicitante (1×)\n          + repasse do Médico de Laudo\n          + repasse do Auxiliar\n\nCONVÊNIO   → cada parcela é o valor fixo da Base Tabela\nPARTICULAR → cada parcela é percentual × Valor R$\nSUS        → produção conta; repasse pela tabela SUS'],
        ['Receita competência', 'Receita = soma do Valor R$ de TODAS as linhas de produção\n          da competência — todas as classificações (inclusive\n          OPME, material, taxa), todas as origens, SEM filtro\n          de vínculo, busca ou ✎.\n\nImposto         = Receita × % do mês\nReceita líquida = Receita − Imposto'],
        ['% sobre PROD', '% sobre PROD = (Repasse da Produção Total + adicionais da\n                competência) ÷ Receita líquida\n\nFica VERMELHO fora da faixa de 21% a 23%.'],
        ['% dos cards de recorte', '% do card = repasse do recorte ÷ repasse da Produção Total\n(é o número entre parênteses, ao lado do valor)']
      ] },
      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        'Competência com **Receita de R$ 1.000.000,00** e **imposto de 8%**:',
        'Imposto = 80.000,00 → **Receita líquida = R$ 920.000,00**.',
        'O card Produção Total fecha com **R$ 200.000,00 de repasse**, e há **R$ 6.000,00** de adicionais na competência.',
        '**% sobre PROD = (200.000 + 6.000) ÷ 920.000 = 22,4%** → dentro da faixa 21–23%, então o número fica na cor normal.',
        'Se o imposto não tivesse sido informado, a conta usaria R$ 1.000.000,00 e daria 20,6% — abaixo da faixa, acendendo um alerta falso.'
      ] },
      { titulo: 'Como é calculado', tipo: 'lista-ordenada', conteudo: [
        '**Elegível**: Classificação Produto dentro do filtro (padrão **CONSULTA / EXAME / PROCEDIMENTO**).',
        'O procedimento é casado pela coluna **PRODUTO** com a Base Tabela.',
        '**Executante** = Cirurgião; se vazio, Médico (**1 dono por linha**).',
        '**Recebido** ("o todo") = Executante + Indicante/Solicitante (1×) + Médico Laudo + Auxiliar — **Convênio → valor fixo**, **Particular → percentual × Valor R$**.',
        '**Produção bruta** = Valor R$ (conta mesmo **sem** Base Tabela — nesse caso o recebido é 0).',
        '**SUS**: a produção conta e o repasse sai pela **tabela SUS** da Base (V682).'
      ] },
      { titulo: 'Universo dos cards de produção', tipo: 'lista', conteudo: [
        'Entram as linhas da planilha de **PRODUÇÃO** da competência que têm **fonte** (Tipo Recebimento = CONVÊNIO, PARTICULAR ou SUS) e **executante** (Cirurgião; se vazio, Médico). Linha sem fonte ou sem executante fica fora (só aparece na Extração Contábil 2).',
        'O médico precisa estar com o **vínculo marcado** na ilha **Vínculo** do botão flutuante (Interno / Híbrido / Externo / Sem tipo — por regra o Externo abre desmarcado) e passar pela **busca de médico** (combo) e pela **busca por admissão**.',
        '**Convênio e Particular**: cada produto entra se a classe é padrão (**CONSULTA / EXAME / PROCEDIMENTO**) — invertido produto a produto pelo ✎ do card. **SUS**: entra o que o filtro **⚙ Classificação** marca.',
        '**Visão**: o switch **Contábil ↔ Gerencial** troca só o **Repasse** dos cards — a produção (R$) é a mesma nas duas.'
      ] },
      { titulo: 'Card Receita competência — composição', tipo: 'lista', conteudo: [
        '**Receita** = soma do **Valor R$** de TODAS as linhas de PRODUÇÃO da competência — todas as classificações (inclui OPME, Material, Taxa…), todas as origens, **sem** filtro de vínculo, busca ou ✎.',
        '**Imposto** = Receita × **% do mês** (⚖ Imposto; um % por competência). **Receita líquida** = Receita − Imposto.',
        'Linha **Contábil** (ou **Gerencial**) = o **Repasse do card Produção Total** na visão ligada.',
        '**% sobre PROD** = (Repasse do card Produção Total **+ SANTO Anestesia**, os adicionais da competência) ÷ **Receita líquida**. Fica **vermelho** fora da faixa **21–23%**; − / + mudam as casas decimais; ⇄ compara a composição com o mês anterior.'
      ] },
      { titulo: 'Cards de produção — composição', tipo: 'lista', conteudo: [
        '**Produção Total** — R$ = produção **Convênio + Particular + SUS** (linhas do universo acima). **Repasse** = repasse Convênio + Particular + SUS **+ Desempenho**. **(x%)** = Repasse ÷ Produção do card.',
        '**Produção Convênio** — R$ = Σ Valor R$ das linhas **CONVÊNIO** incluídas. **Repasse (Contábil)** = Σ do "recebido" de cada linha = **Executante** + (**Indicante** ou **Solicitante**, 1×) + **Auxiliar** + **Médico Laudo**, cada papel pela regra da **versão da Base** vigente na **data de admissão** (Convênio → **valor fixo**). **Repasse (Gerencial)** = Σ valor das linhas do **Consolidado** de origem CONVÊNIO (sem as de status Desempenho). **(x%)** = Repasse ÷ Produção Convênio.',
        '**Produção Particular** — R$ = Σ Valor R$ das linhas **PARTICULAR** incluídas. Repasse pela mesma regra de papéis, com Particular → **percentual × Valor R$**; admissão com **Perfil Particular** ativo paga pela tabela do perfil (ou valor fixo 1× por admissão + procedimento). Gerencial = Consolidado, origem PARTICULAR. **(x%)** = Repasse ÷ Produção Particular.',
        '**Produção SUS** — R$ = Σ Valor R$ das linhas **SUS** (classes do ⚙ Classificação). Repasse = **tabela SUS** da Base (mesmos papéis). **(x%)** = Repasse ÷ Produção SUS.',
        '**Desempenho** — Σ do **valor** das linhas dos **12 fichários** do módulo Relatórios (Contábil) ou das linhas do Consolidado com status **Desempenho** (Gerencial), por profissional, respeitando o vínculo e a busca de médico. Não tem produção própria: entra só no **Repasse do card Produção Total**. A busca por **admissão** zera o Desempenho (ele não é por admissão).',
        '**O que zera o repasse de uma linha** (a produção continua contando): classe fora do padrão (OPME, Material, Medicamento, Taxa, Gás, Diária); produzido ≤ 0; executante de vínculo **não habilitado** (Excluído por tipo, salvo override manual); procedimento **sem regra** na Base (híbrido usa o **repassado real do QVIS**, exceto quando a admissão + médico já tem fichário no Desempenho); papel **já pago** em competência anterior (duplicidade histórica); médico do **Períodos** com a unidade **desmarcada** no Ajuste Unidades; exceção com extração **PRODUÇÃO** (paga no Desempenho); exame **incluso** num pacote de convênio.',
        '**O que muda o repasse de uma linha**: **Exceção** por médico + procedimento + papel + fonte (sobrepõe a regra geral); **Pacote de consulta** por convênio (a consulta-mãe paga o valor do pacote, sem indicante/auxiliar/laudo, e a "filha" de exames inclusos paga 1× por admissão quando o executante tem a especialidade); **Consulta paga pela Produção** (valor fixo ao executante, sem os outros papéis).'
      ] },
      { titulo: 'Abas — o que cada matriz mostra', tipo: 'lista', conteudo: [
        '**Produção médica**: 1 linha por médico do universo — **PROD. TOTAL** (Produção = C + P + SUS · **Repasse = C + P + SUS, sem Desempenho** · % = Repasse ÷ Produção) e, para **CONVÊNIO / PARTICULAR / SUS**, Produção · Repasse · %. Ordena por Produção ou Repasse (clique no título). O › abre o drilldown do médico (linhas e resumo por papel).',
        '**Consolidado**: a mesma matriz **+ a coluna DESEMP.** (o Desempenho do médico).',
        '**Desempenho**: as linhas dos 12 fichários (status, módulo, admissão, data, papel, profissional, paciente, origem, convênio, descrição, valor), filtradas pelo vínculo e pelos médicos selecionados.',
        'Os **totalizadores** da matriz respeitam **todos** os filtros (vínculo, médicos, admissão, classificação, ✎).'
      ] },
      { titulo: 'Filtros — o que muda o quê', tipo: 'lista', conteudo: [
        '**⚙ Classificação** (canto sup. dir.): quais classificações de produto entram — padrão CONSULTA / EXAME / PROCEDIMENTO. Vale direto para o **SUS**; para Convênio/Particular manda o ✎ de cada card. Incluir as excluídas (OPME etc.) mostra o impacto na **produção** (o repasse delas segue 0).',
        '**✎ dos cards Convênio / Particular**: inclui ou exclui **produto a produto** (inverte o padrão da classe); vale para o card e para a matriz.',
        '**Ilha Vínculo** (botão flutuante), **combo de médicos** e **busca por admissão**: definem o universo de médicos/linhas dos cards e das matrizes.',
        '**Contábil ↔ Gerencial**: Contábil = regras da Base aplicadas na produção; Gerencial = repasse **real** do Consolidado. Mês **congelado** (🔒): o Contábil lê o retrato imutável.'
      ] },
      { titulo: 'Regras especiais / exceções', tipo: 'lista', conteudo: [
        'A regra é **colapsada no executante** (1 dono por linha) — evita dupla contagem por papel, como na Auditoria/Calcular.',
        'A produção **conta mesmo sem match** na Base Tabela (recebido = 0).',
        '**SUS** entra na produção e o repasse sai pela **tabela SUS** da Base.',
        '**Contábil congelado** (🔒): o consolidado fica imutável — reimportar a produção atualiza só o **Gerencial**.'
      ] },
      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'O **Externo vem desmarcado por regra** na ilha Vínculo. Um total menor que o esperado quase sempre começa aqui.',
        'A **Receita competência ignora os filtros da tela** de propósito — ela é o total do mês, não o recorte. Comparar a Receita com a soma dos cards filtrados não fecha, e não deveria fechar.',
        'Sem o **% de imposto** da competência, a Receita líquida fica igual à bruta e o **% sobre PROD** sai menor que o real.',
        '**Contábil × Gerencial** mostram repasses diferentes de propósito: o contábil é congelado, o gerencial acompanha as reimportações. Confira qual visão está ligada antes de comparar números.',
        'Produção **sem regra na Base Tabela** aparece com repasse zero — é produção real, não erro de importação.',
        'Um médico com nome escrito de duas formas vira **duas linhas** até ser unificado no De-Para de Nomes.'
      ] },
      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Produção bruta', 'Valor R$ produzido, mesmo sem regra na Base Tabela.'],
        ['Executante', 'Dono da linha: Cirurgião ou, se vazio, Médico.'],
        ['Recebido ("o todo")', 'Soma do repasse de todos os papéis da linha.'],
        ['Classificação Produto', 'Tipo do item (Consulta, Exame, Procedimento, OPME…).'],
        ['Desempenho', 'Repasse consolidado dos 12 fichários.'],
        ['Contábil congelado', 'Consolidado imutável; só o Gerencial atualiza depois.']
      ] }
    ]
  };


  // ── V995: telas que ainda não tinham manual (o botão ⓘ aparece sozinho
  //         assim que existe uma entrada aqui) ────────────────────────────
  window.AtlasDocs['importar-qvis'] = {
    titulo: 'Importação QVIS',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'É a **porta de entrada dos dados**. O QVIS é a fonte oficial de pagamento, e todo mês ele gera **dois relatórios**: um de **Convênio** e um de **Particular**. É aqui que eles entram na ferramenta.',
        'Nada funciona antes disso: o Calcular, a Auditoria, os fichários de Desempenho e os Relatórios leem, no fim da cadeia, o que foi importado nesta tela.',
        'A importação é **atômica e por competência**: se um dos arquivos falhar, nenhum é salvo; e reimportar um mês **substitui** aquele mês e aquela origem, em vez de duplicar.'
      ] },
      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Gere no QVIS os dois relatórios do mês: **Convênio** e **Particular**.',
        'Arraste cada arquivo para a área correspondente (ou clique para escolher). O módulo **detecta o tipo pelo conteúdo** — se você trocar as áreas, ele percebe.',
        'Confira a **pré-visualização**: competências encontradas, quantidade de linhas e a lista de **alertas**. É o momento de voltar atrás.',
        'Informe o **mês de pagamento** e o **código do relatório** — é o código que identifica aquele arquivo lá na origem, e o que permite rastrear depois.',
        'Confirme a importação. Os dois arquivos entram juntos, ou nenhum entra.',
        'Confira o **card do snapshot** criado: total de linhas, admissões, profissionais, produzido e recebido, e quantas admissões vieram zeradas.',
        'Precisa conferir se uma admissão específica entrou? Use o **⛛ Filtro** (no botão flutuante) e busque por admissão, paciente, data, procedimento ou profissional.',
        'Errou o mês de pagamento ou o código? Use o **✏** do snapshot para corrigir sem reimportar.'
      ] },
      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        'Os **dois relatórios mensais do QVIS** (Convênio e Particular), em Excel.',
        'Eles alimentam a tabela **linhas_qvis**, que é a base de pagamento de toda a ferramenta.',
        '**qvis_snapshot_stats** — os metadados de cada importação: mês de pagamento, código do relatório e data de pagamento.'
      ] },
      { titulo: 'Como a importação se comporta', tipo: 'formula', conteudo: [
        ['Detecção de origem', 'O tipo (CONVÊNIO ou PARTICULAR) é detectado pelo\nCONTEÚDO do arquivo, não pela área onde foi solto.'],
        ['Substituição por competência + origem', 'Reimportar Maio/2026 apaga APENAS o Maio/2026 daquela\norigem e insere o novo.\n\nOs outros meses e a outra origem ficam intactos.'],
        ['Atomicidade', 'Se um dos dois arquivos falhar, NENHUM é salvo.\nNunca sobra meio mês importado.'],
        ['Normalização', 'Espaços extras das colunas de busca são removidos na\nleitura — senão "DR. JOÃO " e "DR. JOÃO" virariam dois\nprofissionais diferentes.'],
        ['O filtro de linhas', 'Os campos são CUMULATIVOS (E, não OU) e buscam por\ntrecho. A DATA aceita o formato brasileiro (14/07/2026)\ne converte para o formato do banco.\nO resultado mostra as 300 primeiras linhas.']
      ] },
      { titulo: 'Exemplo prático', tipo: 'exemplo', conteudo: [
        'O relatório de Convênio de **setembro** chega com **8.432 linhas** e traz procedimentos de **agosto** e de **setembro**.',
        'Você informa **mês de pagamento = Setembro/2026** e o **código do relatório** que o QVIS deu ao arquivo.',
        'O snapshot criado mostra: 8.432 linhas · 3.180 admissões · 96 profissionais · produzido R$ 4.2 mi · recebido R$ 3.9 mi · **41 admissões com recebido zerado** (as glosas do mês).',
        'Duas semanas depois o QVIS corrige o arquivo e você reimporta: **só o Setembro/2026 de Convênio é apagado e regravado**. O Particular do mesmo mês e todos os outros meses ficam intactos.',
        'Depois disso, **recalcule setembro** — senão o Calcular continua respondendo com os números do arquivo antigo.'
      ] },
      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'Reimportar um mês **substitui** o que havia. Qualquer correção manual feita naquele mês se perde.',
        'O **mês de pagamento** não é a competência: um relatório pago em setembro pode conter procedimentos de agosto. Os dois campos existem e significam coisas diferentes.',
        'Depois de reimportar, **recalcule a competência** — o snapshot do Calcular continua com os números antigos até isso ser feito.',
        'Leia os **alertas da pré-visualização** antes de confirmar; eles apontam competências inesperadas e linhas problemáticas.',
        'O **código do relatório** é o que liga a importação ao arquivo de origem. Preencher com cuidado economiza muito tempo numa conferência futura.'
      ] },
      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['QVIS', 'O sistema de origem; a fonte oficial de pagamento.'],
        ['Origem', 'Convênio ou Particular — o tipo do relatório.'],
        ['Competência', 'O mês em que o procedimento foi realizado.'],
        ['Mês de pagamento', 'O mês do relatório em que ele foi pago.'],
        ['Código do relatório', 'O identificador do arquivo lá na origem.'],
        ['Snapshot', 'O registro de uma importação, com os totais daquele mês e origem.'],
        ['Importação atômica', 'Ou os dois arquivos entram, ou nenhum entra.']
      ] }
    ]
  };

  window.AtlasDocs['importar-producao'] = {
    titulo: 'Importar Produção',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'Importa o **relatório analítico mensal do hospital** — a Produção. Não confunda com a Importação QVIS: o **QVIS é a base de pagamento**; a **Produção é a base de realização**, o registro de que o procedimento aconteceu, com o valor bruto.',
        'A Produção é a fonte de apoio dos módulos de **Desempenho** (LIO, OPME, Lentes de Contato, Estrabismo…), é quem responde quando o QVIS vem com produzido zerado, e é de onde a Auditoria tira o nome do indicante e do solicitante.'
      ] },
      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Gere o **relatório analítico mensal** do hospital em Excel.',
        'Clique em **Importar nova produção** e escolha o arquivo.',
        'Confira a **competência** detectada e os totais importados.',
        'Use o **filtro de ano** para conferir a série já importada e os totalizadores.',
        'Use o **⛛ Filtro** para procurar uma linha específica por admissão, paciente, data ou produto.',
        'Precisa corrigir um mês? Use **Atualizar** naquele mês, em vez de importar de novo pelo botão principal.',
        'Depois de importar, **recalcule** o que depender daquele mês e reabra os módulos de Desempenho.'
      ] },
      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        'O **relatório analítico mensal** do hospital, em Excel.',
        'Alimenta a tabela **linhas_producao**: admissão, data, paciente, produto, classificação, categoria, convênio, tipo de recebimento, quantidade, valor, cirurgião, médico, indicante e solicitante.'
      ] },
      { titulo: 'Para que a Produção é usada', tipo: 'formula', conteudo: [
        ['Base dos fichários de Desempenho', 'LIO, OPME, Estrabismo, Lentes de Contato e os demais\nleem a produção para saber o que foi feito e por quem.'],
        ['Rede de segurança do Calcular', 'Quando a regra é percentual e o PRODUZIDO do QVIS vem\nzerado, o Calcular busca o valor da mesma admissão aqui.'],
        ['Fonte de indicante e solicitante', 'A Auditoria busca nesta base, pelo código EXATO da\nadmissão, o nome do indicante; se vazio, o do solicitante.'],
        ['Executante real da linha-filha de pacote', 'O Calcular usa a produção para descobrir quem de fato\nexecutou os exames inclusos num pacote de convênio.']
      ] },
      { titulo: 'Exemplo prático', tipo: 'exemplo', conteudo: [
        'Uma admissão de catarata aparece na **Produção** com três linhas: a cirurgia (R$ 3.000,00), a lente intraocular (R$ 6.000,00, classificada como OPME) e uma taxa de sala (R$ 400,00).',
        'O **Calcular** só olha a linha da cirurgia — taxa e OPME estão fora do escopo dele.',
        'O **LIO** usa a linha da lente para apurar o repasse de executante e indicante.',
        'A **Produção Médica** soma as três (R$ 9.400,00) na Receita competência, porque ali o recorte é o faturamento inteiro.',
        'A mesma linha importada, portanto, alimenta módulos diferentes com recortes diferentes — e é por isso que os totais deles não são comparáveis entre si.'
      ] },
      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        '**Esta não é a importação do QVIS.** As duas bases convivem e servem a propósitos diferentes; importar uma não substitui a outra.',
        'Os valores daqui são **brutos**, sem regra aplicada. Ver um número diferente do QVIS é o esperado.',
        'Reimportar um mês substitui aquele mês — ajustes manuais anteriores se perdem.',
        'Os módulos de Desempenho leem a produção **na hora**: depois de reimportar, reabra a tela para ver o número novo.',
        'Nome de médico escrito de forma diferente aqui e no cadastro precisa do **De-Para de Nomes** para não dividir o resultado em duas linhas.'
      ] },
      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Produção', 'A base de realização: o que foi feito, com o valor bruto.'],
        ['Classificação Produto', 'O tipo do item: Consulta, Exame, Procedimento, OPME, Material, Taxa…'],
        ['Tipo de recebimento', 'A fonte: Convênio, Particular ou SUS.'],
        ['Indicante / Solicitante', 'Quem encaminhou o paciente; colunas usadas pela Auditoria.'],
        ['Competência', 'O mês de realização a que o relatório se refere.']
      ] }
    ]
  };

  window.AtlasDocs['base-tabela'] = {
    titulo: 'Base Tabela',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'É **o contrato traduzido em regra**. Para cada procedimento, a BASE TABELA diz quanto se paga a cada **papel** (executante, indicante, solicitante, auxiliar, médico de laudo) em cada **fonte** (Convênio e Particular).',
        'Tudo o mais depende disto. O Calcular consulta esta tabela linha a linha; a Auditoria a usa como **gabarito** para descobrir quais papéis o QVIS deixou de trazer. Procedimento que não está aqui simplesmente **não paga** — e aparece no Calcular como "Procedimento sem regra".',
        'A tela foi feita para edição rápida: **clica na célula, digita, sai — está salvo**. Sem formulário, sem botão de confirmar.'
      ] },
      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Na primeira carga, use o **upload do Excel** para popular a tabela de uma vez.',
        'No dia a dia, use a **busca em tempo real** para achar o procedimento.',
        'Para mudar um valor, **clique na célula, digite e saia** — a gravação é automática.',
        'Para um procedimento novo, use **Novo procedimento** e preencha os papéis que ele remunera.',
        'Deixe **vazio ou zerado** o papel que aquele procedimento **não** remunera. Isso não é omissão: é a informação de que ali não se paga, e o Calcular vai tratá-la assim.',
        'Confira as **duas tabelas** (Convênio e Particular) — o mesmo procedimento costuma ter regra diferente em cada fonte.',
        'Depois de qualquer mudança, **recalcule** as competências afetadas: meses já calculados não se atualizam sozinhos.'
      ] },
      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**tabela_repasse** — a regra em si, por procedimento × papel × fonte.',
        '**procedimentos** — o cadastro dos procedimentos oficiais.',
        '**sinonimos_proc** — as grafias alternativas que o QVIS usa para o mesmo procedimento.',
        'A carga inicial vem de um **Excel** com a tabela acertada.'
      ] },
      { titulo: 'Como a regra é lida pelo Calcular', tipo: 'formula', conteudo: [
        ['A chave da regra', 'procedimento × papel × fonte pagadora\n\nA mesma combinação nunca tem duas regras.'],
        ['Valor preenchido', 'repasse = o valor\n(típico de Convênio e SUS: preço combinado)'],
        ['Percentual preenchido', 'repasse = produzido × percentual\n(típico de Particular)'],
        ['Valor E percentual vazios ou zerados', 'A linha é OMITIDA do cálculo: aquele papel NÃO é\nremunerado naquele procedimento.\n\nIsso é diferente de "não existe regra" — é uma regra\nque diz explicitamente para não pagar.'],
        ['Procedimento ausente da tabela', 'O Calcular marca a linha como\n   "Procedimento sem regra"\ne ela não paga nada. É dinheiro fora do cálculo.'],
        ['Papel de gabarito (Auditoria)', 'Os papéis com valor nesta tabela são os que a Auditoria\nvai EXIGIR do QVIS — e criar como linha-filha quando\nestiverem faltando.']
      ] },
      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        '**FACECTOMIA · Convênio:** executante R$ 450,00 · auxiliar R$ 90,00 · indicante R$ 45,00 · solicitante vazio · médico de laudo vazio.',
        'Uma cirurgia dessas paga **R$ 450,00** ao cirurgião e, se o QVIS trouxer os outros papéis (ou a Auditoria os criar), mais R$ 90,00 e R$ 45,00.',
        'Solicitante e médico de laudo **não pagam nada** — e é isso que a célula vazia comunica.',
        '**Mesmo procedimento · Particular:** executante 30% → uma cirurgia de R$ 3.000,00 paga 3.000 × 30% = **R$ 900,00**.'
      ] },
      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'Mudar um valor aqui **não altera um mês já calculado**. É preciso recalcular a competência.',
        'A edição é **salva ao sair da célula** — não há confirmação. Cuidado ao navegar com o teclado.',
        'Cadastrar só o Convênio e esquecer o Particular é a causa mais comum de "o procedimento paga num mês e não paga no outro".',
        'Célula **vazia** e procedimento **inexistente** produzem efeitos diferentes no Calcular: a primeira é "não se paga", a segunda é "não sei o que fazer".',
        'Grafia nova do QVIS deve virar **sinônimo**, não um procedimento novo — senão a mesma cirurgia passa a existir duas vezes.'
      ] },
      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['BASE TABELA', 'O cadastro que diz quanto se paga por procedimento × papel × fonte.'],
        ['Papel', 'A função na linha: executante, indicante, solicitante, auxiliar, médico de laudo.'],
        ['Fonte pagadora', 'Convênio, Particular ou SUS.'],
        ['Valor fixo', 'Repasse direto, sem depender do produzido.'],
        ['Percentual', 'Repasse calculado sobre o produzido.'],
        ['Sinônimo', 'Grafia alternativa de um procedimento já mapeada.'],
        ['Gabarito', 'O uso da tabela pela Auditoria para saber quais papéis exigir.']
      ] }
    ]
  };

  window.AtlasDocs['medicos'] = {
    titulo: 'Médicos',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'É o **cadastro das pessoas**. Cada médico tem um **nome oficial**, um **vínculo** com a casa (Interno, Híbrido ou Externo), **especialidades** e, quando for o caso, **TAGs de cargo administrativo**.',
        'Parece um cadastro simples, mas ele decide muita coisa: o **vínculo** define quem recebe repasse em vários fichários (Lentes de Contato, Luz Pulsada, Crosslink e Refractive Laser só pagam Interno e Híbrido); a **especialidade** libera regras específicas (o Adicional do LIO só paga quem tem Catarata); e as **TAGs** alimentam o módulo de Cargos.',
        'A listagem mostra **uma linha por par médico × especialidade** — um médico com três especialidades aparece três vezes. Não é duplicidade.'
      ] },
      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Na primeira carga, use a **importação de Excel** para trazer o quadro inteiro.',
        'Para cada médico, defina o **vínculo**: Interno, Híbrido ou Externo. Este é o campo de maior impacto.',
        'Atribua as **especialidades**. A edição é inline: dá para ajustar sem sair da lista.',
        'Atribua as **TAGs de cargo** a quem exerce função administrativa — elas são a porta de entrada do módulo Cargos.',
        'Use os **filtros de especialidade** (marcação múltipla) para revisar o quadro por área.',
        'Sempre que um médico entrar, sair ou mudar de função, **atualize aqui primeiro** — os módulos de Desempenho leem este cadastro.'
      ] },
      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**medicos** — nome oficial, nome normalizado, tipo de vínculo e situação (ativo/inativo).',
        '**Especialidades** por médico.',
        '**medico_cargos** — as TAGs administrativas.',
        '**medico_unidades** — o vínculo com as unidades de atendimento.',
        'Carga inicial por **Excel**; manutenção manual na tela.'
      ] },
      { titulo: 'O que cada campo destrava', tipo: 'formula', conteudo: [
        ['Vínculo', 'INTERNO e HÍBRIDO → recebem repasse nos fichários\nEXTERNO           → aparece, mas com repasse R$ 0,00\n                    (informativo: mostra a origem do paciente)\n\nVale para Lentes de Contato, Luz Pulsada, Crosslink e\nRefractive Laser, entre outros.'],
        ['Especialidade', 'Libera regras específicas.\nExemplo: o ADICIONAL do LIO só paga médico com a\nespecialidade CATARATA.'],
        ['TAG de cargo', 'É o que faz o médico aparecer no módulo Cargos\nAdministrativos e receber o valor fixo mensal da função.'],
        ['Listagem', 'Uma linha por par médico × especialidade.\nTrês especialidades = três linhas do mesmo médico.'],
        ['Filtro de especialidade', 'Nenhum marcado  → mostra todos os pares\n1 ou mais       → mostra quem tem AO MENOS UMA das\n                  marcadas (união, não interseção)']
      ] },
      { titulo: 'Exemplo prático', tipo: 'exemplo', conteudo: [
        'A Dra. A é do quadro e faz adaptação de lentes de contato, mas foi cadastrada como **EXTERNO** por engano.',
        'No mês, ela executa **R$ 10.000,00** em lentes. O módulo de Lentes de Contato lista o nome dela — mas com **repasse R$ 0,00**, porque externo não recebe ali.',
        'Nada dá erro, nenhum alerta aparece: o número simplesmente não existe.',
        'Corrigido o vínculo para **INTERNO**, a mesma produção passa a pagar 10.000 × 18% = **R$ 1.800,00**.',
        'É o campo de maior efeito da ferramenta inteira — e o mais silencioso quando está errado.'
      ] },
      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'O **vínculo errado silencia o repasse**. Um médico interno cadastrado como externo aparece na matriz com R$ 0,00 e ninguém percebe até ele reclamar.',
        'Faltando a **especialidade**, regras específicas deixam de valer — o caso clássico é o Adicional do LIO sem Catarata.',
        'A **mesma pessoa cadastrada duas vezes** divide o resultado dela. Se o nome vem diferente da produção, o lugar de resolver é o **De-Para de Nomes**, não um segundo cadastro.',
        'Médico que saiu do cargo precisa ter a **TAG removida**, senão continua recebendo o valor fixo.',
        'Várias linhas do mesmo médico na lista é o **comportamento esperado** (uma por especialidade), não erro.'
      ] },
      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Vínculo', 'A relação do médico com a casa: Interno, Híbrido ou Externo.'],
        ['Interno', 'Médico do quadro; recebe repasse.'],
        ['Híbrido', 'Médico com relação mista; recebe repasse como o interno.'],
        ['Externo', 'Médico de fora; aparece como origem de indicação, sem repasse.'],
        ['Especialidade', 'A área de atuação; libera regras específicas.'],
        ['TAG de cargo', 'A etiqueta de função administrativa (DM, CM, RT).'],
        ['Nome normalizado', 'O nome sem acento e em caixa alta, usado para casar registros.']
      ] }
    ]
  };

  window.AtlasDocs['de-para-nomes'] = {
    titulo: 'De-Para de Nomes',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'O relatório de Produção escreve os nomes do jeito dele — em caixa alta, com abreviação, com ou sem acento. O cadastro de Médicos tem o nome oficial. Quando os dois não batem, **a ferramenta acha que são duas pessoas** e o repasse de um médico se divide em duas linhas.',
        'Este módulo é a ponte: ele lista os nomes que aparecem na Produção e permite **vincular cada um ao médico certo**. Feito o vínculo, tudo o que estava separado se junta.',
        'Ele ainda **sugere sozinho** os vínculos óbvios, comparando os nomes normalizados — e deixa a decisão com você.'
      ] },
      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Depois de cada importação de Produção, clique em **↻ Re-escanear produção** para trazer os nomes novos.',
        'Leia os **4 cards**: total de nomes, quantos já estão vinculados, quantos estão **pendentes** e quantas **sugestões automáticas** existem.',
        'Filtre por **apenas pendentes** — é a fila que importa.',
        'Confira a coluna de **frequência**: o nome que aparece muitas vezes é o que mais impacta o repasse. Comece por ele.',
        'Para cada nome, escolha o médico em **vincular a…**.',
        'Se as sugestões automáticas estiverem corretas, use o botão do rodapé para **aceitar todas de uma vez** — mas confira antes: a sugestão é uma heurística, não uma certeza.',
        'Depois de vincular, reabra os módulos de Desempenho para ver os valores já consolidados na pessoa certa.'
      ] },
      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        'Os **nomes de profissionais do relatório de Produção** (linhas_producao), varridos pelo re-escaneamento.',
        'O **cadastro de Médicos**, que é o destino do vínculo.',
        'A tabela de vínculos, onde cada "de → para" fica guardado.'
      ] },
      { titulo: 'Como a sugestão automática funciona', tipo: 'formula', conteudo: [
        ['Normalização dos dois lados', 'Remove acentos, colapsa espaços e passa para MAIÚSCULAS.\n\n"Willian Fagundes"  →  "WILLIAN FAGUNDES"\n"WILLIAN  FAGUNDES" →  "WILLIAN FAGUNDES"'],
        ['Comparação', 'Nomes normalizados iguais (ou muito próximos) viram\nSUGESTÃO — nunca vínculo automático silencioso.\n\nA decisão continua sendo humana.'],
        ['Efeito do vínculo', 'Todas as linhas da produção com aquele nome passam a\napontar para o médico escolhido.\n\nO repasse que estava dividido em duas linhas vira uma.'],
        ['Frequência', 'Quantas vezes aquele nome aparece na produção.\nÉ o melhor critério de prioridade da fila.']
      ] },
      { titulo: 'Exemplo prático', tipo: 'exemplo', conteudo: [
        'A produção traz **"WILLIAN FAGUNDES PFEILSTICKER"** (caixa alta, como o sistema de origem escreve) em 84 linhas do mês.',
        'O cadastro de Médicos tem **"William Fagundes Pfeilsticker"**.',
        'Sem vínculo, essas 84 linhas ficam órfãs: o repasse delas não aparece junto com o resto do médico, e ninguém recebe um aviso.',
        'O módulo normaliza os dois lados — ambos viram "WILLIAN FAGUNDES PFEILSTICKER" — percebe a coincidência e oferece a **sugestão**.',
        'Aceita a sugestão, as 84 linhas passam a apontar para o cadastro certo e o valor se junta ao restante da produção dele.',
        'A coluna de **frequência** (84) é o que diz que esse vínculo é mais urgente que um de 2 linhas.'
      ] },
      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'Nome pendente **não é erro visível**: o valor simplesmente não aparece junto com o resto do médico. É a falha mais silenciosa da ferramenta.',
        '**Aceitar todas as sugestões sem ler** é arriscado com nomes parecidos (homônimos, pai e filho na mesma casa).',
        'O re-escaneamento precisa ser rodado **depois de cada importação** de produção — nomes novos não aparecem sozinhos.',
        'Vincular ao médico **errado** move o dinheiro de lugar. Confira antes de confirmar.',
        'Este módulo resolve grafia de **nome**; se a pessoa está cadastrada duas vezes em Médicos, o problema é lá.'
      ] },
      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['De-Para', 'A ligação entre o nome do relatório e o médico cadastrado.'],
        ['Pendente', 'Nome da produção ainda sem vínculo.'],
        ['Sugestão automática', 'Vínculo proposto pela comparação dos nomes normalizados.'],
        ['Frequência', 'Quantas vezes o nome aparece na produção.'],
        ['Re-escanear', 'Varrer a produção de novo em busca de nomes ainda não listados.']
      ] }
    ]
  };

  window.AtlasDocs['unidades'] = {
    titulo: 'Unidades',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'Cadastro das **unidades de atendimento** — as clínicas, filiais e centros onde os médicos trabalham. É um cadastro curto, mas ele dá o eixo de leitura para os módulos que organizam a informação por local.',
        'A tela mostra, ao lado de cada unidade, **quantos médicos estão vinculados a ela**.'
      ] },
      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Cadastre cada unidade com o nome **exatamente como ela aparece nas planilhas** que serão importadas — é isso que faz as linhas casarem.',
        'Vincule os médicos às unidades pelo cadastro de **Médicos**.',
        'Confira a contagem de médicos por unidade; uma unidade com zero costuma ser um nome escrito de outra forma.',
        'Desative (em vez de apagar) a unidade que deixou de operar — assim o histórico dos meses anteriores continua íntegro.'
      ] },
      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**unidades** — o cadastro em si: nome e situação (ativa/inativa).',
        '**medico_unidades** — a ligação entre médico e unidade, que alimenta a contagem da tela.',
        'O módulo **Períodos por Unidade** usa este cadastro para vincular cada linha importada à unidade certa.'
      ] },
      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'O **nome precisa casar** com o que vem nas planilhas. Uma diferença de grafia deixa a linha importada sem vínculo de unidade.',
        '**Desativar é melhor que apagar**: apagar uma unidade quebra a leitura dos meses já fechados.',
        'Unidade com **zero médicos** normalmente indica nome divergente, não unidade vazia.'
      ] },
      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Unidade', 'O local de atendimento: clínica, filial ou centro cirúrgico.'],
        ['Vínculo médico × unidade', 'A ligação que diz onde cada profissional atende.'],
        ['Inativa', 'Unidade que não opera mais, mas cujo histórico é preservado.']
      ] }
    ]
  };

  window.AtlasDocs['controle-notas'] = {
    titulo: 'Controle de Notas',
    secoes: [
      { titulo: 'O que este módulo faz', tipo: 'paragrafo', conteudo: [
        'Depois que o repasse é calculado, começa o **ciclo administrativo**: mandar o relatório para o médico, receber a nota fiscal dele, conferir o valor e encaminhar a nota adiante. Este módulo substitui a planilha manual que fazia esse controle.',
        'Por **competência**, há uma linha por médico com **três checks** (relatório enviado, nota recebida, nota encaminhada), os valores da nota e o status especial quando existe (distrato, adiantamento).',
        'A parte mais útil é a **conferência automática**: o módulo lê o PDF da nota — valor bruto, líquido e número — e compara o bruto com o **total do relatório daquele médico na competência**. Bateu ou divergiu, na hora.',
        'E há a **etiqueta da nota**: um cartão pronto, com competência, valor, prazo, dados do tomador e o e-mail de envio, que se copia como imagem e cola direto no corpo do e-mail.'
      ] },
      { titulo: 'Como operar (passo a passo)', tipo: 'passos', conteudo: [
        'Preencha o **cadastro** dos médicos/PJ: nome, razão social, CNPJ, e-mail do médico e do contador. Dá para importar da planilha antiga.',
        'Escolha a **competência**. A lista traz um médico por linha, com os valores do relatório já ao lado.',
        'Abra **✉ Estrutura do e-mail** e configure uma vez: CNPJ do tomador, descrição do serviço, e-mail de envio e o prazo do mês.',
        'Use **Copiar etiqueta** para levar o cartão como imagem, ou **Copiar e-mail completo** para levar corpo + etiqueta.',
        'Marque o check de **relatório enviado**.',
        'Quando a nota chegar, **anexe o PDF**. O módulo lê bruto, líquido e número automaticamente e guarda o arquivo no banco.',
        'Confira o resultado: **bateu** ou **divergiu** em relação ao relatório. Divergiu, resolva antes de seguir.',
        'Marque os checks de **nota recebida** e **nota encaminhada** conforme o ciclo avança.'
      ] },
      { titulo: 'De onde vêm os dados', tipo: 'lista', conteudo: [
        '**notas_cadastro** — os dados fiscais de cada médico/PJ.',
        '**notas_controle** — o ciclo de cada médico em cada competência: checks, valores, status e observação.',
        'O **PDF da nota**, guardado no próprio banco (viaja no backup, não sai da máquina).',
        'O **total do médico na competência**, vindo do consolidado dos **Relatórios** — é a referência da conferência.',
        'A **data de pagamento** do snapshot do QVIS, usada na etiqueta.'
      ] },
      { titulo: 'Memória de cálculo', tipo: 'formula', conteudo: [
        ['Conferência da nota', 'referência = total do médico no consolidado dos\n             Relatórios, naquela competência\n\nbruto da nota == referência  →  BATEU\nbruto da nota != referência  →  DIVERGIU'],
        ['Leitura do PDF', 'O módulo lê a camada de texto do PDF e extrai\n   valor bruto · valor líquido · número da nota\n\nPDF ESCANEADO (imagem, sem camada de texto) não tem\nleitura automática: os campos ficam editáveis à mão e a\nconferência funciona igual.'],
        ['Etiqueta — o que ela mostra', 'competência · valor da nota (o total do relatório)\ndata de pagamento · prazo de envio\ndoutor(a), razão social e CNPJ\ntomador e CNPJ do tomador\ndescrição do serviço · e-mail de envio'],
        ['Etiqueta — como ela é copiada', 'Vai para a área de transferência como IMAGEM (PNG) e\ncomo HTML com a mesma figura, declarando 960 px de\nlargura — assim cola no tamanho certo e em alta\ndefinição em qualquer cliente de e-mail.']
      ] },
      { titulo: 'Exemplo numérico', tipo: 'exemplo', conteudo: [
        'O consolidado dos Relatórios dá **R$ 12.480,35** para a Dra. A na competência de agosto.',
        'A etiqueta enviada a ela traz exatamente esse valor, com o prazo do mês e os dados do tomador.',
        'A nota chega com bruto de **R$ 12.480,35** → **bateu**, e o ciclo segue.',
        'Se viesse **R$ 12.400,00**, o módulo marcaria **divergiu** — e a diferença de R$ 80,35 teria de ser investigada antes de a nota ser encaminhada.'
      ] },
      { titulo: 'Filtros', tipo: 'lista', conteudo: [
        '**Competência**.',
        'Recortes pelos **três checks** (o que falta enviar, receber, encaminhar).',
        'Busca por **médico**.',
        '**Status especial** — distrato, adiantamento e outros.'
      ] },
      { titulo: 'Armadilhas e cuidados', tipo: 'lista', conteudo: [
        'A conferência compara com o **consolidado dos Relatórios**. Se o relatório for reprocessado depois do envio, a referência muda — e a nota que batia pode passar a divergir.',
        '**PDF escaneado não é lido.** Não é falha: não há texto no arquivo. Preencha à mão que a conferência funciona igual.',
        'Qualquer atualização no **cadastro do médico** (CNPJ, razão social) reflete na etiqueta na hora — inclusive nas já copiadas antes, que ficam desatualizadas.',
        'A etiqueta traz **valor e prazo**: conferir os dois antes de disparar o e-mail evita retrabalho com dezenas de médicos.',
        'Os PDFs ficam **no banco**, então entram no backup e podem deixá-lo grande. É o preço de manter tudo offline.'
      ] },
      { titulo: 'Glossário', tipo: 'glossario', conteudo: [
        ['Competência', 'O mês de referência do repasse.'],
        ['Os três checks', 'Relatório enviado · nota recebida · nota encaminhada.'],
        ['Bruto / Líquido', 'O valor da nota antes e depois das retenções.'],
        ['Tomador', 'Quem contrata o serviço — o hospital.'],
        ['Prestador', 'Quem emite a nota — o médico ou a PJ dele.'],
        ['Etiqueta', 'O cartão informativo que se cola no e-mail com os dados da nota.'],
        ['Distrato / Adiantamento', 'Status especiais que explicam por que o ciclo foge do padrão.']
      ] }
    ]
  };

  // ── V699: MÓDULO EXTERNOS ────────────────────────────────────────────────
})();
