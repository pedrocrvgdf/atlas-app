/**
 * V952: "COMO LER" DE CADA GRÁFICO, ILHA E CARD DA VISÃO GERAL.
 *
 * Cada bloco do dashboard ganhou um botão ⓘ (js/telas/visao_geral_ui.js →
 * infoBtn) que abre, no popover do AtlasInfo, o texto registrado aqui:
 * o que o número significa, de onde ele vem, a memória de cálculo passo a
 * passo, quais filtros o afetam e as pegadinhas — escrito para quem NÃO
 * conhece o motor da ferramenta.
 *
 * Formato: o mesmo do js/docs_modulos.js (secoes: paragrafo | lista |
 * lista-ordenada | glossario; **negrito**). `cabecalho` troca o "Regras do
 * módulo" do topo por "Como ler"; `semNotas` esconde o bloco de anotações
 * (que é por módulo, não por gráfico).
 */
(function () {
  'use strict';
  window.AtlasDocs = window.AtlasDocs || {};

  const COMUM_FILTROS = 'Os filtros da barra (**Médico**, **Módulo**, **Convênio**) e o **mês** escolhido valem aqui.';
  const COMPETENCIA = '**Competência** = **mês de pagamento** do relatório QVIS (o mês em que o convênio pagou), não o mês da cirurgia/consulta.';
  const doc = (id, titulo, secoes) => { window.AtlasDocs[id] = { titulo, cabecalho: 'Como ler', semNotas: true, secoes }; };

  // ── Linha do tempo ────────────────────────────────────────────────────
  doc('vg-linha-tempo', 'Linha do tempo', [
    { titulo: 'O que é', tipo: 'paragrafo', conteudo: [
      'Uma faixa de **marcos** (alfinetes) com os acontecimentos que mudam o cálculo do repasse: **mudança de regra**, **entrada** ou **saída de médico**, **contrato/convênio** e **auditoria/glosa**. Serve de memória: quando um número muda de um mês para o outro, aqui você vê o que aconteceu naquela data.'
    ] },
    { titulo: 'De onde vem', tipo: 'lista', conteudo: [
      'Os eventos são **registrados à mão** pela equipe (botão **+ Evento**), com data, categoria, sinal (alta/baixa/neutro) e anexos.',
      'Ficam gravados **só nesta máquina** (tabelas timeline_eventos / timeline_docs) e viajam no backup.'
    ] },
    { titulo: 'Como usar', tipo: 'lista', conteudo: [
      'Clique no alfinete para abrir a **descrição** e os **anexos**; o lápis edita título, data, categoria e ícone.',
      'A **lupa** filtra por título ou mês/ano. A marca **Hoje** separa o que já passou do que está agendado.',
      'A esteira abre pela ponta mais **recente** — arraste para o lado para ver o passado.'
    ] },
    { titulo: 'Atenção', tipo: 'lista', conteudo: [
      'A linha do tempo **não altera nenhum número** do dashboard; é só registro e contexto.'
    ] },
  ]);

  // ── Card: Produção total - Recebido ───────────────────────────────────
  doc('vg-card-producao', 'Produção total - Recebido', [
    { titulo: 'O que é', tipo: 'paragrafo', conteudo: [
      'Quanto o hospital **produziu e faturou** para os pagadores no mês, segundo o relatório **QVIS**. É a base sobre a qual o repasse dos médicos é calculado.'
    ] },
    { titulo: 'De onde vem', tipo: 'lista', conteudo: [
      'Relatório **QVIS** importado, coluna **PRODUZIDO**, do **mês de pagamento** escolhido (a mesma base do módulo Calcular Repasse).',
      COMPETENCIA
    ] },
    { titulo: 'Memória de cálculo', tipo: 'lista-ordenada', conteudo: [
      'Pega todas as linhas do QVIS do mês.',
      'O QVIS **repete** a mesma linha uma vez por **papel** (executante, indicante, auxiliar…) com o **mesmo** produzido. A ferramenta junta as repetições pela chave **origem + admissão + procedimento** e conta o valor **uma vez só**.',
      'Soma o produzido de cada procedimento. As **fatias** separam por origem: **Convênio**, **Particular** e **SUS** (e o % de cada uma sobre o total).',
      '**vs LM** = variação % contra o **mês anterior**; **vs LY** = contra o **mesmo mês do ano anterior**. Só aparece quando aquele mês está importado — senão fica "—".'
    ] },
    { titulo: 'Filtros', tipo: 'lista', conteudo: [
      '**Médico**: a produção do procedimento é atribuída ao **executante** (Médico/Cirurgião) da linha. **Convênio**: pela coluna convênio da linha.',
      'O filtro **Módulo** **não** muda este card (produção não tem módulo).'
    ] },
    { titulo: 'Atenção', tipo: 'lista', conteudo: [
      'É o valor **produzido** (faturado), não o que o convênio efetivamente pagou — a diferença entre os dois é a **glosa** (card ao lado).',
      'Uma admissão sem executante identificado no QVIS **entra no total**, mas some quando você filtra por médico.'
    ] },
  ]);

  // ── Card: Repasse Total ───────────────────────────────────────────────
  doc('vg-card-repasse', 'Repasse Total', [
    { titulo: 'O que é', tipo: 'paragrafo', conteudo: [
      'O total que a ferramenta apurou para **pagar aos médicos** na competência — tudo o que está no **Consolidado** do módulo Relatórios.'
    ] },
    { titulo: 'De onde vem', tipo: 'lista', conteudo: [
      '**Consolidado** do módulo **Relatórios** da competência: linhas do **Calcular Repasse** (QVIS × Base Tabela), **ajustes gerenciais**, **cargos** e os **fichários de desempenho** (LIO, Fellow, Estrabismo, Lentes, Laudos, Períodos, Luz Pulsada…).',
      'Cada linha entra com o seu **valor**, inclusive **descontos** (valores negativos abatem). Só o zero é ignorado.'
    ] },
    { titulo: 'Memória de cálculo', tipo: 'lista-ordenada', conteudo: [
      'Soma o valor de todas as linhas do Consolidado do mês → **Repasse Total**.',
      '**Fatias**: linha com status **Desempenho** vai para a fatia **Desempenho**; as demais vão pela **origem** da linha — **Convênio**, **Particular** ou **SUS** (ajustes sem origem contam como Convênio).',
      'O **% entre parênteses** ao lado do valor = Repasse Total ÷ **Produção total - Recebido** (card à esquerda), no mesmo recorte de filtros.',
      '**vs LM / vs LY**: sem filtro ativo, compara com o **fechamento** do mês (Calcular Repasse gravado + Laudos + Períodos + Fellow); com filtro, recalcula o Consolidado daquele mês com o mesmo filtro.'
    ] },
    { titulo: 'Filtros', tipo: 'lista', conteudo: [ COMUM_FILTROS, '**Médico** = profissional da linha; **Módulo** = fichário/módulo de origem; **Convênio** = convênio da linha.' ] },
    { titulo: 'Atenção', tipo: 'lista', conteudo: [
      'Se o mês ainda não passou pelo **Calcular Repasse** e pela **Auditoria**, o Consolidado está incompleto e o card fica menor do que o real.'
    ] },
  ]);

  // ── Card: GLOSAS ──────────────────────────────────────────────────────
  doc('vg-card-glosa', 'Glosas', [
    { titulo: 'O que é', tipo: 'paragrafo', conteudo: [
      '**Glosa** é a parte do que foi **produzido** que o convênio **não pagou**. O card mede isso de duas formas (a chave **100% / FATO** no canto do card alterna a régua) e, ao lado, quanto **repasse** os médicos **deixaram de receber** por causa dela.'
    ] },
    { titulo: 'De onde vem', tipo: 'lista', conteudo: [
      'Relatório **QVIS** do **mês de pagamento**, colunas **PRODUZIDO** e **RECEBIDO**.',
      'Só linhas do papel **Executante** (Médico/Cirurgião, pelo de-para de papéis do Calcular) — assim cada procedimento conta **uma vez**, sem repetir pelos outros papéis.',
      'Linhas **Particular** ficam de fora (não há glosa de particular).'
    ] },
    { titulo: 'Memória de cálculo', tipo: 'lista-ordenada', conteudo: [
      '**GLOSA 100%** (régua clássica): soma o **produzido** das linhas com **recebido zerado** — só o que não recebeu **nada**.',
      '**GLOSA FATO**: em **cada linha** faz **produzido − recebido**. Diferença **positiva** é glosa (cheia ou **parcial**, o pago pela metade); **negativa** é **crédito** (recebeu mais do que produziu) e **abate** do total; zero não é glosa. Contém a glosa 100%.',
      'O **% entre parênteses** = glosa ÷ **produção total do mês** (planilha de Produção importada; com filtro de convênio, só a produção daquele convênio).',
      '**REPASSE TOTAL GLOSADO**: as linhas glosadas (recebido zerado) passam pelo **motor completo** do Calcular Repasse (regra da Base Tabela, pacote, exceção, duplicidade) e a ferramenta soma o repasse que **cada papel** teria recebido. É o que os médicos **perderam**.',
      '**TOTAL PROCEDIMENTOS** = quantos pares admissão + procedimento entraram na régua ativa.',
      '**vs LM / vs LY / YTD**: variação contra o mês anterior e o mesmo mês do ano anterior, e o **acumulado do ano** até o mês — para a glosa (régua ativa) e para o repasse perdido.'
    ] },
    { titulo: 'Filtros', tipo: 'lista', conteudo: [
      '**Médico** (executante da linha) e **Convênio** valem. **Módulo**: glosa só existe no **Repasse/QVIS** — com outro módulo selecionado o card zera.'
    ] },
    { titulo: 'Atenção', tipo: 'lista', conteudo: [
      'O **repasse perdido** mede só as glosas **100%**: numa glosa **parcial** o motor não sabe que fatia do procedimento se perdeu.',
      'O botão de **planilha** exporta as linhas glosadas **como estão no QVIS** (todos os papéis); o produzido aparece só na linha do executante para a soma bater com o card.'
    ] },
  ]);

  // ── Comparativo mês a mês ─────────────────────────────────────────────
  doc('vg-comparativo', 'Comparativo mês a mês', [
    { titulo: 'O que é', tipo: 'paragrafo', conteudo: [
      'Seis cards, um por competência (as **6 mais recentes**), cada um com dois indicadores: quanto o **repasse** representa da **receita líquida**, e quanto a **Produção Médica** (o custo médico contábil) representa dessa mesma receita.'
    ] },
    { titulo: 'De onde vem', tipo: 'lista', conteudo: [
      '**Repasse (Gerencial)** = Consolidado do módulo **Relatórios**. Os chips mudam o recorte: **Ambos** = tudo; **Repasse (QVIS)** = só a matriz do Calcular Repasse (Auditoria); **Desempenho** = só as linhas com status Desempenho (fichários).',
      '**Receita líquida** = módulo **Produção Médica**: receita bruta da produção do mês **menos o imposto** cadastrado para o mês.',
      '**Prod. Médica** = **consolidação contábil** do módulo Produção Médica: repasse Convênio + Particular + SUS (+ Desempenho, + **SANTO Anestesia** quando o botão **+ SANTO** está ligado). Se o mês foi **congelado** (snapshot contábil), usa o congelado.'
    ] },
    { titulo: 'Memória de cálculo', tipo: 'lista-ordenada', conteudo: [
      'Bloco 1: **Repasse ÷ Receita líquida × 100** → o % grande.',
      'Bloco 2: **Prod. Médica ÷ Receita líquida × 100**.',
      '**vs LM** = variação % (e R$) contra o mês anterior; **vs LY** = contra o mesmo mês do ano anterior; **YTD** = soma de **janeiro até o mês** do card, no mesmo chip.',
      'Os valores pesados chegam em segundo plano ("calculando…") e ficam guardados numa **foto** por mês, refeita só quando o banco muda.'
    ] },
    { titulo: 'Filtros', tipo: 'lista', conteudo: [
      'É uma visão **global**: os filtros **Médico / Módulo / Convênio** da barra **não** mudam este bloco. Só os chips (Ambos / QVIS / Desempenho) e o **+ SANTO**.'
    ] },
    { titulo: 'Atenção', tipo: 'lista', conteudo: [
      'Mês sem imposto cadastrado usa a receita **bruta** como líquida. Mês sem Produção importada mostra receita zero e o % fica "—".'
    ] },
  ]);

  // ── Evolução do Repasse ───────────────────────────────────────────────
  doc('vg-evolucao', 'Evolução do Repasse', [
    { titulo: 'O que é', tipo: 'paragrafo', conteudo: [
      'Barras com o **repasse de cada mês** do ano escolhido. A barra do mês selecionado no dashboard fica destacada; **clicar numa barra** troca o mês de todo o dashboard.'
    ] },
    { titulo: 'De onde vem', tipo: 'lista', conteudo: [
      'O **mesmo número** do card Repasse do **Comparativo mês a mês**, obedecendo ao chip escolhido lá (**Ambos**, **Repasse (QVIS)** ou **Desempenho**) — o título mostra qual está ativo.'
    ] },
    { titulo: 'Memória de cálculo', tipo: 'lista-ordenada', conteudo: [
      'Lista os meses **com dados** do ano do seletor.',
      'Para cada mês soma o Consolidado do Relatórios (ou só a matriz QVIS / só Desempenho, conforme o chip).',
      'A altura da barra é proporcional ao **maior mês** do ano; a grade marca 25 / 50 / 75 / 100 % desse máximo.'
    ] },
    { titulo: 'Filtros', tipo: 'lista', conteudo: [ 'Visão **global**: **não** obedece aos filtros Médico / Módulo / Convênio. Só o **ano** e o chip do comparativo.' ] },
    { titulo: 'Atenção', tipo: 'lista', conteudo: [ 'Mês sem importação **não aparece** (não vira barra zero).' ] },
  ]);

  // ── Glosa do mês × perda do médico ────────────────────────────────────
  doc('vg-glosa-chart', 'Glosa do mês × perda do médico', [
    { titulo: 'O que é', tipo: 'paragrafo', conteudo: [
      'Nas **12 competências** mais recentes: a barra clara é a **produção glosada** do mês e a barra vermelha, dentro dela, é quanto **repasse os médicos deixaram de receber** por causa dessa glosa. A linha azul mostra a **tendência** da glosa de um mês para o outro.'
    ] },
    { titulo: 'De onde vem', tipo: 'lista', conteudo: [
      '**Prod. glosada** = régua **GLOSA 100%** do card Glosas: produzido das linhas do QVIS com **recebido zerado**, papel **Executante**, sem Particular.',
      '**Não recebido** = **REPASSE TOTAL GLOSADO** do card: as linhas glosadas passam pelo motor do Calcular Repasse e soma-se o repasse que cada papel teria.'
    ] },
    { titulo: 'Memória de cálculo', tipo: 'lista-ordenada', conteudo: [
      'Para cada um dos 12 meses calcula a glosa 100% e o repasse perdido (com os filtros ativos).',
      'O **%** dentro da barra = não recebido ÷ glosado do mês.',
      '**↑ / ↓ % M/M** = variação da produção glosada contra o **mês anterior** (sobe = vermelho, cai = verde).',
      'Chips do topo: **Glosado** e **Não recebido** são as somas dos 12 meses; **Média** = soma do não recebido ÷ soma do glosado.'
    ] },
    { titulo: 'Filtros', tipo: 'lista', conteudo: [ COMUM_FILTROS ] },
    { titulo: 'Atenção', tipo: 'lista', conteudo: [
      'Usa a régua **100%** (recebido zerado). A glosa **parcial** aparece no gráfico **Evolução da Glosa Fato**, logo abaixo.',
      'O eixo é dividido em múltiplos de 10 mil; arraste para o lado para ver os meses mais antigos.'
    ] },
  ]);

  // ── Evolução da Glosa Fato ────────────────────────────────────────────
  doc('vg-glosafato', 'Evolução da Glosa Fato', [
    { titulo: 'O que é', tipo: 'paragrafo', conteudo: [
      'A **Glosa Fato** de cada mês do ano escolhido: tudo o que foi produzido e **não foi pago**, inclusive o pago **pela metade**. A linha tracejada é a **tendência** do ano.'
    ] },
    { titulo: 'De onde vem', tipo: 'lista', conteudo: [
      'Régua **GLOSA FATO** do card Glosas: QVIS do mês de pagamento, papel **Executante**, sem Particular, **produzido − recebido** linha a linha (crédito abate).'
    ] },
    { titulo: 'Memória de cálculo', tipo: 'lista-ordenada', conteudo: [
      'Para cada mês do ano **com competência importada**: soma (produzido − recebido) das linhas. Se a soma ficar negativa (mais crédito do que glosa), o ponto mostra **0**.',
      'Mês **sem competência** fica apagado no eixo e **fora da linha** — não é glosa zero, é ausência de dado.',
      '**Tendência** = reta de mínimos quadrados sobre os meses apurados.',
      'Chips: **Glosa Fato no ano** = soma dos meses apurados; **Média mensal** = soma ÷ meses apurados; **Maior mês**; **Meses apurados** de 12.'
    ] },
    { titulo: 'Filtros', tipo: 'lista', conteudo: [ COMUM_FILTROS, 'O **ano** tem seletor próprio.' ] },
  ]);

  // ── Top 10 Médicos por Repasse ────────────────────────────────────────
  doc('vg-top10', 'Top 10 Médicos por Repasse', [
    { titulo: 'O que é', tipo: 'paragrafo', conteudo: [
      'Os **10 médicos com maior repasse** na competência, com a barra proporcional ao 1º colocado. Clicar no médico abre o **detalhe** dele logo abaixo.'
    ] },
    { titulo: 'De onde vem', tipo: 'lista', conteudo: [
      'Consolidado do módulo **Relatórios** (o mesmo do card **Repasse Total**), somado **por profissional** — inclui Calcular Repasse, ajustes, cargos e **fichários de desempenho**.'
    ] },
    { titulo: 'Memória de cálculo', tipo: 'lista-ordenada', conteudo: [
      'Soma o valor de cada linha do Consolidado no nome do profissional (descontos abatem).',
      'Ordena do maior para o menor e fica com os **10 primeiros**.',
      '**% do total** = repasse do médico ÷ **soma dos 10** (não do mês inteiro). O valor no cabeçalho é essa soma dos 10.'
    ] },
    { titulo: 'Filtros', tipo: 'lista', conteudo: [ COMUM_FILTROS ] },
    { titulo: 'Atenção', tipo: 'lista', conteudo: [ 'O nome mostrado pode ser o **código** do médico quando a chave **CÓD/NOME** (olho, no topo) está ligada — só na tela, não nas extrações.' ] },
  ]);

  // ── Performance médica ────────────────────────────────────────────────
  doc('vg-performance', 'Performance médica', [
    { titulo: 'O que é', tipo: 'paragrafo', conteudo: [
      'Para **cada médico com repasse** no mês, três medidas lado a lado: o que ele **produziu** (QVIS), quanto disso foi **glosado** e quanto ele **recebeu de repasse** pelo Calcular Repasse.'
    ] },
    { titulo: 'De onde vem', tipo: 'lista', conteudo: [
      '**Produzido** = a mesma regra do card **Produção total - Recebido** (QVIS deduplicado por origem + admissão + procedimento), atribuído ao **executante**.',
      '**Glosa** = régua **GLOSA 100%** (linhas do executante com recebido zerado, sem Particular).',
      '**Repasse** = só as linhas do **Calcular Repasse** no Consolidado (**sem** os fichários de desempenho).'
    ] },
    { titulo: 'Memória de cálculo', tipo: 'lista-ordenada', conteudo: [
      'Universo = médicos que têm repasse no Consolidado (o mesmo do Top 10), ordenados por **produzido**.',
      'A barra é escalada pela **soma das três medidas** do médico, para as três ficarem sempre visíveis — **não** é uma decomposição (o produzido já contém a glosa).',
      '**glosa · %** = glosa ÷ produzido; **repasse · %** = repasse ÷ produzido.',
      'O total do cabeçalho é a soma do produzido dos médicos listados.'
    ] },
    { titulo: 'Filtros', tipo: 'lista', conteudo: [ COMUM_FILTROS, 'Sem filtro de convênio a ilha usa uma **foto** guardada por mês, refeita quando o banco muda.' ] },
  ]);

  // ── Produção por categoria ────────────────────────────────────────────
  doc('vg-categorias', 'Produção por categoria', [
    { titulo: 'O que é', tipo: 'paragrafo', conteudo: [
      'O QVIS do mês distribuído pelas **categorias da Produção** (Cirurgias, Exames, Consultas, Laser…): quanto foi **produzido**, quanto o convênio **pagou** (recebido), a **glosa** e o **repasse** que foi para os médicos. Clique na categoria para abrir as **subcategorias**.'
    ] },
    { titulo: 'De onde vem', tipo: 'lista', conteudo: [
      '**Produzido** e **Recebido** = relatório **QVIS** do mês de pagamento, deduplicado por origem + admissão + procedimento (as linhas por papel repetem os valores).',
      '**Categoria** = coluna CATEGORIA das linhas de **Produção** da mesma admissão. Com mais de uma categoria na admissão, vale a linha cujo **produto** casa com o procedimento do QVIS; sem casar, a mais frequente. Admissão sem produção importada → **"Sem categoria na produção"**.',
      '**Repasse** = Consolidado do Relatórios, só das **admissões que estão no QVIS** do mês.'
    ] },
    { titulo: 'Memória de cálculo', tipo: 'lista-ordenada', conteudo: [
      'Para cada procedimento do QVIS: acha a categoria (e a subcategoria) da admissão e soma produzido e recebido nela.',
      '**Glosa** = o **mesmo número do card GLOSAS**, distribuído por categoria: só linhas do papel **Executante**, **sem Particular**, na **régua ativa** do card — **100%** (produzido das linhas com recebido zerado) ou **FATO** (produzido − recebido linha a linha; crédito abate). A chave **100% / FATO** está no cabeçalho desta coluna e também no card; é **uma régua só**: trocar num lugar troca no outro, e o **TOTAL** da coluna é sempre o valor do card.',
      '**% ao lado do produzido** = participação da categoria no total (na subcategoria, na categoria-mãe). **% da glosa** = glosa ÷ produzido da linha. **% do repasse** = repasse ÷ recebido da linha.',
      '**Clique na coluna Glosa** (cabeçalho ou célula): a coluna Repasse vira **Repasse glosado**, em vermelho — quanto os médicos **deixaram de receber** por causa da glosa, com a **mesma lógica do REPASSE TOTAL GLOSADO** do card (as linhas com recebido zerado passam pelo motor do Calcular e soma-se o repasse que cada papel teria; só glosas 100%). O TOTAL bate com o card; o % é perdido ÷ glosa. Clique de novo para voltar.',
      'A linha **TOTAL** soma as categorias; **Admissões** conta as admissões distintas do QVIS no recorte.'
    ] },
    { titulo: 'Filtros', tipo: 'lista', conteudo: [ '**Médico** (executante da linha do QVIS) e **Convênio**. O filtro **Módulo** não se aplica.' ] },
    { titulo: 'Atenção', tipo: 'lista', conteudo: [
      '**Produzido** e **Recebido** mostram o QVIS inteiro da categoria (com Particular); a **Glosa** segue o card (sem Particular, só executante). Por isso Produzido − Recebido da linha **não** precisa ser igual à Glosa — a diferença é, em geral, o Particular, que o QVIS traz com recebido zerado sem ser glosa.',
      'Admissões **"Sem categoria"** normalmente indicam produção do mês anterior não importada ou a coluna CATEGORIA vazia — reimporte a produção.',
      '**⇩ Extrair** gera a planilha com categorias e subcategorias.'
    ] },
  ]);

  // ── Desempenho × Repasse por médico ───────────────────────────────────
  doc('vg-desemprep', 'Desempenho × Repasse por médico', [
    { titulo: 'O que é', tipo: 'paragrafo', conteudo: [
      'Para cada médico elegível, duas barras: o que ele recebe pelos **fichários de desempenho** (LIO, Fellow, Estrabismo, Lentes, Laudos, Períodos…) e o que recebe pelo **Calcular Repasse** (QVIS × Base Tabela). A pílula diz **que fatia** do total dele é desempenho.'
    ] },
    { titulo: 'De onde vem', tipo: 'lista', conteudo: [
      'Consolidado do módulo **Relatórios**: linhas com status **Desempenho** → barra **Desempenho**; todas as outras → barra **Repasse**. Descontos (negativos) abatem.'
    ] },
    { titulo: 'Memória de cálculo', tipo: 'lista-ordenada', conteudo: [
      'Soma as linhas do Consolidado por profissional, separando pelo status.',
      'Ordena pela **soma** das duas barras; a escala do eixo é fixada pelo maior valor entre todos.',
      '**Pílula** = desempenho ÷ (desempenho + repasse) × 100.',
      'A legenda mostra as somas de **Desempenho** e **Repasse** dos médicos exibidos; o seletor isola **um** médico.'
    ] },
    { titulo: 'Filtros', tipo: 'lista', conteudo: [ COMUM_FILTROS, 'Sem filtro de convênio usa uma **foto** guardada por mês, refeita quando o banco muda.' ] },
  ]);
})();
