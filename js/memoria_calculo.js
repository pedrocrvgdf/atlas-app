/*
 * ATLAS — V937: MEMÓRIA DE CÁLCULO por linha da matriz.
 *
 * Passar o mouse sobre o valor de repasse de qualquer linha abre um cartão com
 * o caminho que o motor percorreu até aquele valor.
 *
 * V996 — DOIS TIPOS DE MEMÓRIA, porque são duas perguntas diferentes:
 *
 *   'qvis'        (Calcular · Auditoria) — a linha É uma linha do QVIS.
 *                 A pergunta é "que regra pagou isto?": casamento do
 *                 procedimento, regra que venceu (exceção › perfil › pacote ›
 *                 Base Tabela), a conta, e — quando não pagou — o motivo.
 *
 *   'consolidado' (Relatórios) — a linha é o RESULTADO de um módulo já
 *                 apurado. A pergunta é outra: "de onde veio este valor e por
 *                 qual regra o módulo de origem chegou nele?". O cartão traz a
 *                 regra do módulo, a origem dos dados, o caminho percorrido e
 *                 para onde o valor vai depois.
 *
 * Em ambos, V996 acrescentou: DE ONDE VEM CADA NÚMERO (a procedência de cada
 * campo), O QUE FAZER (a ação concreta quando a linha não pagou) e PARA ONDE
 * VAI (o destino do valor no fluxo do mês) — para que alguém que nunca usou a
 * ferramenta entenda o que aconteceu ali e o que precisa fazer.
 *
 * Uso nas telas:
 *   AtlasMemoria.novaLeva('calc')                        // a cada render
 *   <td ${AtlasMemoria.ref('calc', linha)}>              // memória de QVIS
 *   <td ${AtlasMemoria.ref('rel', linha, 'consolidado')}> // memória de módulo
 * O cartão é montado no document.body (o .main tem transform) e posicionado
 * pelo getBoundingClientRect da célula. Hover mostra; clique FIXA (pra copiar);
 * Esc / clique fora fecha o fixado.
 */
(function () {
  'use strict';

  const levas = new Map();   // modulo → array de linhas (índice = id no data-mem)
  let _pop = null, _celAtual = null, _fixado = false, _timer = null, _estilo = false;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const moeda = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (p) => ((Number(p) || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + '%';
  const nome = (n) => (window.CodigoMedico && typeof CodigoMedico.exibir === 'function') ? CodigoMedico.exibir(n) : String(n || '');
  const data = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d || ''); };
  const comp = (c) => { const m = /^(\d{4})-(\d{2})/.exec(String(c || '')); return m ? `${m[2]}/${m[1]}` : String(c || ''); };

  /**
   * V996 — A REGRA DE CADA MÓDULO, em uma frase de conta e uma de origem.
   * O Relatórios junta 14 módulos com regras completamente diferentes; quem
   * olha uma linha ali precisa saber POR QUE aquele valor é aquele, sem ter de
   * abrir o módulo de origem. As chaves batem com a coluna MÓDULO.
   */
  const REGRA_MODULO = {
    'REPASSE': {
      conta: 'Base Tabela: valor fixo (Convênio/SUS) ou produzido × % (Particular), por procedimento × papel × fonte.',
      origem: 'Relatório do QVIS do mês, calculado no módulo Calcular e completado na Auditoria.',
      conferir: 'Calcular Repasse › matriz da competência',
    },
    'OPME': {
      conta: 'Valor do material × 10% (ou a % específica do médico). Material subfaturado é corrigido pelo valor fixo do convênio.',
      origem: 'Relatório QVIS (coluna REPASSADO) cruzado com a Produção QVIS.',
      conferir: 'Desempenho › OPME',
    },
    'LIO': {
      conta: 'Executante: base × 18%. Indicante: base × 2,5%, só quando é pessoa diferente. No Convênio a base é o valor de tabela da lente cadastrada; no Particular, o valor cobrado.',
      origem: 'Produção QVIS (linhas OPME do tipo LIO) + cadastro de lentes por convênio.',
      conferir: 'Desempenho › LIO',
    },
    'LIO · ADICIONAL': {
      conta: '(produzido − valor de tabela do padrão) × 50%, quando a diferença é positiva. Só para médico com a especialidade Catarata.',
      origem: 'Admissões particulares do LIO × padrões cadastrados em ⚙ Ajustes → Adicional.',
      conferir: 'Desempenho › LIO › aba Adicional',
    },
    'ESTRABISMO': {
      conta: 'Valor fechado pela lateralidade marcada à mão: unilateral R$ 1.260 ou bilateral R$ 1.680 (Convênio); R$ 300 no SUS, em ambos.',
      origem: 'Produção QVIS (produto contendo ESTRABISMO) + a marcação de 1 ou 2 feita na tela.',
      conferir: 'Desempenho › Estrabismo',
    },
    'LENTES DE CONTATO': {
      conta: 'Execução: valor executado × 18%. Indicação: valor indicado × 9%. Só vínculo Interno ou Híbrido; externo aparece com R$ 0,00.',
      origem: 'Produção QVIS das adaptações de lente de contato.',
      conferir: 'Desempenho › Lentes de Contato',
    },
    'LUZ PULSADA': {
      conta: 'Taxa de uso do aparelho: percentual sobre a base — produzido no Particular, recebido no Convênio. Vai à proprietária do equipamento, não ao executante.',
      origem: 'QVIS (procedimento contendo LUZ PULSADA, papel médico/cirurgião, vínculo IH).',
      conferir: 'Desempenho › Luz Pulsada',
    },
    'CROSSLINK': {
      conta: 'Taxa de uso do aparelho por CONTAGEM: admissões elegíveis × valor fixo (padrão R$ 288,00). O valor faturado não entra na conta.',
      origem: 'QVIS (procedimento contendo CROSSLINK, papel médico/cirurgião, vínculo IH).',
      conferir: 'Desempenho › Crosslink',
    },
    'REFRACTIVE LASER': {
      conta: 'Taxa por linha: exames pagam valor fixo (ignoram a quantidade); cirúrgicos pagam fixo × quantidade no Convênio e percentual × produzido no Particular. "BINOCULAR" no nome força quantidade 2.',
      origem: 'QVIS, pelos sinônimos canônicos dos 7 procedimentos elegíveis.',
      conferir: 'Desempenho › Refractive Laser',
    },
    'FELLOW': {
      conta: 'Por plantão: máx(0, complemento) + refeição. Atender acima da meta não desconta. Refeição de R$ 50 em plantão noturno ou de fim de semana.',
      origem: 'Planilha mensal de plantões dos fellows.',
      conferir: 'Desempenho › Fellow',
    },
    'FRACIONAMENTO': {
      conta: 'Fracionamento bruto − valor fixo retido. O valor sobe conforme a posição no frasco (1ª R$ 450 · 2ª R$ 550 · 3ª R$ 700 · 4ª R$ 900). Frasco dividido entre médicos vai por média truncada.',
      origem: 'Relatório mensal de injeções intravítreas, com os frascos marcados por cor.',
      conferir: 'Desempenho › Fracionamento',
    },
    'CARGOS ADMINISTRATIVOS': {
      conta: 'Valor mensal fixo da TAG do cargo. Médico com exceção cadastrada recebe SÓ a exceção — o fixo não se soma, pra não pagar duas vezes.',
      origem: 'TAGs de cargo do cadastro de Médicos + valor por TAG.',
      conferir: 'Desempenho › Cargos Administrativos',
    },
    'LAUDOS': {
      conta: 'O ATLAS não recalcula: o valor vem pronto da planilha do setor. Linha com "LANÇAR" entra como pendente, com R$ 0,00.',
      origem: 'Planilha PAGAMENTO - LAUDOS (abas Pacote, Impressos e Externo).',
      conferir: 'Desempenho › Laudos',
    },
    'PERÍODOS': {
      conta: 'Total de períodos (soma das semanas 1 a 5) × valor do período — o cadastrado para aquele médico naquela unidade, ou o padrão da casa.',
      origem: 'Planilha Repasse Médico - Períodos.',
      conferir: 'Desempenho › Períodos por Unidade',
    },
    'EXCEÇÃO · PRODUÇÃO': {
      conta: 'Valor da regra de exceção, pago 1× por admissão. A linha equivalente no QVIS fica zerada de propósito, pra não duplicar.',
      origem: 'Regras de exceção com extração via PRODUÇÃO (⚙ Ajustes do Calcular).',
      conferir: 'Calcular Repasse › ⚙ Ajustes › Exceções',
    },
    'GERENCIAL': {
      conta: 'Lançamento manual com sinal: crédito (+) soma, desconto (−) subtrai. Só entra no Consolidado quando está APLICADO.',
      origem: 'Módulo Gerenciais — decisão humana registrada, com descrição.',
      conferir: 'Gerenciais › ajustes da competência',
    },
    'AVULSO': {
      conta: 'Lançamento manual direto no Consolidado. Não tem regra por trás — o valor é o que foi digitado.',
      origem: 'Linha avulsa incluída no próprio Relatórios.',
      conferir: 'Relatórios › linhas avulsas',
    },
  };
  /** Acha a regra do módulo tolerando acento, caixa e variações do rótulo. */
  function regraDoModulo(mod) {
    const k = String(mod || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    for (const chave of Object.keys(REGRA_MODULO)) {
      const ck = chave.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
      if (ck === k) return REGRA_MODULO[chave];
    }
    for (const chave of Object.keys(REGRA_MODULO)) {
      const ck = chave.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
      if (k && (k.indexOf(ck) >= 0 || ck.indexOf(k) >= 0)) return REGRA_MODULO[chave];
    }
    return null;
  }

  function novaLeva(mod) { levas.set(mod, []); }
  /** tipo: 'qvis' (padrão, Calcular/Auditoria) ou 'consolidado' (Relatórios). */
  function ref(mod, linha, tipo) {
    let arr = levas.get(mod);
    if (!arr) { arr = []; levas.set(mod, arr); }
    arr.push({ l: linha, tipo: tipo || 'qvis' });
    return ` data-mem="${mod}:${arr.length - 1}"`;
  }
  function itemDe(cel) {
    const [mod, i] = String(cel.dataset.mem || '').split(':');
    const arr = levas.get(mod);
    return arr ? arr[Number(i)] : null;
  }
  function linhaDe(cel) { const it = itemDe(cel); return it ? it.l : null; }

  // ── monta a memória (estrutura: cabeçalho + seções de {rot, val, tipo}) ──
  function montar(l) {
    const st = l._status || '';
    const pagou = st === 'casou' || (l._ehPacoteDetalhe && Number(l._repasse) > 0);
    const fv = String(l._fonteValor || '');
    const secLinha = [], secRegra = [], secConta = [], secMotivo = [], secAud = [];

    // 1) a linha do QVIS
    secLinha.push(['Admissão', `${esc(l.admissao || '—')}${l.data_admissao ? ' · ' + data(l.data_admissao) : ''}`]);
    secLinha.push(['Profissional', esc(nome(l.nome_profissional)) || '—']);
    secLinha.push(['Papel', esc(l._papelCanon || l.papel || '—') + (l._medicoTipo ? ` <small>(${esc(l._medicoTipo === 'SEM_TIPO' ? 'médico sem tipo' : l._medicoTipo)})</small>` : '')]);
    let procTxt = esc(l.procedimento || '—');
    if (l._procOficial && l._procOficial !== l.procedimento) procTxt += `<br><small>↳ Base Tabela: ${esc(l._procOficial)}</small>`;
    if (l._matchTipo && l._matchTipo !== 'exato') {
      const mt = { sinonimo: 'casou por sinônimo', similar: 'casou por similaridade', tokens: 'casou por palavras-chave' }[l._matchTipo] || l._matchTipo;
      procTxt += `<br><small>${esc(mt)}${l._matchScore != null ? ` (${(Number(l._matchScore) * 100).toFixed(0)}%)` : ''}</small>`;
    } else if (l._matchTipo === 'exato') procTxt += '<br><small>casou exato</small>';
    secLinha.push(['Procedimento', procTxt]);
    secLinha.push(['Fonte pagadora', `${l.origem && window.Utilidades ? Utilidades.badgeFonte(l.origem) : esc(l.origem || '—')}${l.convenio ? ' · ' + esc(l.convenio) : ''}`]);   // V947
    secLinha.push(['Produzido / Recebido', `${moeda(l.produzido)} / ${moeda(l.recebido)}`]);
    if (l._versaoTabela != null && l._versaoTabela !== '') secLinha.push(['Versão da Base Tabela', `v${esc(l._versaoTabela)} <small>(pela data de admissão)</small>`]);

    // 2) regra que venceu + 3) conta
    const temValor = l._regraValor != null, temPct = l._regraPct != null;
    const base = l._basePct != null ? l._basePct : l._valorBase;
    const baseFonte = l._baseFonte || (fv === 'producao' || /\+producao$/.test(fv) ? 'producao' : (fv === 'qvis' ? 'qvis' : null));
    const baseTxt = baseFonte === 'producao' ? 'valor da Produção (QVIS zerado — fallback)' : 'produzido do QVIS';
    const viva = l._regraViva ? ` <span class="mem-alerta">regra da tabela VIVA — a v${esc(l._versaoTabela || '?')} não tinha esta regra</span>` : '';
    const conta = (valorFinal) => {
      if (temValor && !temPct) secConta.push(['Valor fixo', `${moeda(l._regraValor)} → <b>${moeda(valorFinal)}</b>`]);
      else if (temPct) secConta.push(['Percentual', `${moeda(base)} <small>(${baseTxt})</small> × ${pct(l._regraPct)} = <b>${moeda(valorFinal)}</b>`]);
      else if (pagou && Number(l._valorBase) > 0 && Number(l._repasse) > 0 && Math.abs(l._valorBase - l._repasse) > 0.005)
        secConta.push(['Conta (inferida)', `${moeda(l._valorBase)} × ${pct(l._repasse / l._valorBase)} = <b>${moeda(l._repasse)}</b> <small>cálculo salvo antes da v202_937 — recalcule pra ver a regra</small>`]);
      else if (pagou) secConta.push(['Valor', `<b>${moeda(valorFinal)}</b>${l._regraValor == null && l._regraPct == null ? ' <small>cálculo salvo antes da v202_937 — recalcule pra ver a regra</small>' : ''}`]);
    };

    if (l._ehPacoteDetalhe) {
      secRegra.push(['Regra', `<b>Pacote de consulta</b> do convênio ${esc(l._pacoteConvenio || '')} — linha-filha: ${esc(l.procedimento)}`]);
      if (l._paiProcedimento) secRegra.push(['Consulta-mãe', esc(l._paiProcedimento)]);
      if (l._execRealProducao) secRegra.push(['Executante real', 'herdado da coluna MÉDICO da Produção (mapeamento de retina)']);
      conta(l._repasse);
    } else if (l._regraExcecao) {
      const vig = l._excecaoVigencia ? ` · vigente desde ${data(l._excecaoVigencia)}` : '';
      secRegra.push(['Regra', `<b>Exceção por médico</b> (médico + procedimento + papel + fonte)${vig} — sobrepõe a Base Tabela`]);
      if (fv === 'excecao-producao') secRegra.push(['Extração', 'paga via PRODUÇÃO (módulo Exceção · Produção) — a linha do QVIS fica zerada pra não duplicar']);
      else if (fv === 'excecao-anulado' || l._excecaoAnulado) secRegra.push(['Anulação', 'a sobreposição desta combinação paga só os papéis definidos nela — este papel fica zerado']);
      else conta(l._repasse);
    } else if (l._regraPerfil) {
      const pt = String(l._perfilTabela || 'CONVENIO').toUpperCase();
      secRegra.push(['Regra', `<b>Individualidade — Perfil Particular</b> "${esc(l._perfilNome || '')}"${pt === 'VALOR FIXO' ? ' · valor fixo por procedimento' : ` · pago pela tabela ${esc(pt)}${fv === 'perfil-proc' ? ' (override do procedimento)' : ''}`}${viva}`]);
      if (fv === 'perfil-proc-valor-dup') secRegra.push(['Duplicidade', 'valor fixo já pago nesta admissão + procedimento — zerado']);
      else if (pagou) conta(l._repasse);
    } else if (l._regraPacote) {
      const como = fv === 'pacote-consulta-base' ? 'sem valor de consulta cadastrado — valeu a regra da Base Tabela' : 'valor/percentual de consulta do pacote';
      secRegra.push(['Regra', `<b>Pacote de consulta</b> do convênio ${esc(l._pacoteConvenio || '')} — ${como}${viva}`]);
      conta(l._repasse);
    } else if (pagou || st === 'duplicada') {
      secRegra.push(['Regra', `<b>Base Tabela</b> · fonte ${esc(window.Utilidades ? Utilidades.rotuloFonte(l.origem) : (l.origem || ''))} · ${temValor && !temPct ? 'valor fixo' : (temPct ? 'percentual sobre o produzido' : 'regra do procedimento/papel')}${viva}`]);
      conta(st === 'duplicada' ? (l._repasseRegra || 0) : l._repasse);
    }

    // 4) por que não pagou
    if (!pagou) {
      const rot = { glosa: 'Glosa', duplicada: 'Duplicidade', procSemRegra: 'Procedimento novo', semRegraPapel: 'Sem regra', excluidoTipo: 'Excluído', semRemuneracao: 'Não remunerado', pacoteDetalhe: 'Detalhe do pacote' }[st] || 'Não pago';
      secMotivo.push([rot, esc(l._motivo || 'sem repasse nesta linha')]);
      if (st === 'duplicada' && l._competenciaJaPaga) secMotivo.push(['Já pago em', esc(comp(l._competenciaJaPaga))]);
      if (st === 'duplicada' && l._repasseRegra) secMotivo.push(['Valor natural da regra', `${moeda(l._repasseRegra)} <small>(o que pagaria sem a duplicidade)</small>`]);
      if (st === 'glosa') secMotivo.push(['Regra da glosa', 'convênio/SUS com Recebido = R$ 0,00 não gera repasse (Particular não tem glosa)']);
    }

    // 5) ajustes da Auditoria
    if (l._auditPapelTrocado) secAud.push(['Papel corrigido', `${esc(l._auditPapelOriginal || '?')} → <b>${esc(l._papelCanon || l.papel)}</b>`]);
    if (l._auditRenomeado) secAud.push(['Nome corrigido', `${esc(nome(l._auditNomeOriginal))} → <b>${esc(nome(l.nome_profissional))}</b>`]);
    if (l._auditNomePreenchido) secAud.push(['Nome preenchido', 'a linha veio sem profissional — preenchido pela Auditoria']);
    if (l._ehConsultaProducao) secAud.push(['Origem', 'linha trazida da PRODUÇÃO (procedimento pago pela Produção)']);
    else if (l._ehAuditoria && !l._ehPacoteDetalhe) secAud.push(['Origem', `linha criada pela Auditoria${l._auditNotificar ? ' — marcada pra NOTIFICAR' : ''}`]);
    if (l._auditUnidadeRegra) secAud.push(['Ajuste Unidades', `<b>${esc(l._auditUnidadeRegra)}</b>${l._procOriginal ? `<br><small>procedimento do QVIS: ${esc(l._procOriginal)}</small>` : ''}`]);   // V938
    if (l._auditMotivo && l._auditMotivo !== l._auditUnidadeRegra) secAud.push(['Auditoria', esc(l._auditMotivo)]);

    // ── V996: DE ONDE VEM CADA NÚMERO ──────────────────────────────────────
    // Sem isso, o cartão dizia "R$ 450" sem dizer de onde saiu o 450.
    const secOrigem = [];
    secOrigem.push(['Produzido e Recebido', 'do <b>relatório do QVIS</b> importado — valores crus, sem regra aplicada']);
    if (temValor || temPct) {
      secOrigem.push(['Valor / percentual', l._regraExcecao ? 'da <b>regra de exceção</b> cadastrada em ⚙ Ajustes do Calcular'
        : (l._regraPacote || l._ehPacoteDetalhe) ? 'do <b>pacote de convênio</b> cadastrado em ⚙ Ajustes do Calcular'
        : l._regraPerfil ? 'da tabela do <b>perfil Particular</b> cadastrado em ⚙ Ajustes do Calcular'
        : `da <b>BASE TABELA</b>${l._versaoTabela != null && l._versaoTabela !== '' ? ` (versão v${esc(l._versaoTabela)}, escolhida pela data da admissão)` : ''}`]);
    }
    if (baseFonte === 'producao') secOrigem.push(['Base do percentual', 'da <b>Produção QVIS</b> — o produzido do relatório veio zerado e o motor buscou o valor da mesma admissão lá']);
    secOrigem.push(['Procedimento oficial', 'do cadastro de <b>Procedimentos</b> (+ sinônimos), casado com o texto que veio do QVIS']);
    secOrigem.push(['Nome do profissional', 'do <b>cadastro de Médicos</b>, resolvido pelo <b>De-Para de Nomes</b> quando a grafia difere']);

    // ── V996: O QUE FAZER — a ação concreta quando a linha não pagou ────────
    const secAcao = [];
    if (!pagou) {
      const acoes = {
        procSemRegra: ['Cadastrar a regra', 'O procedimento não existe na BASE TABELA. Cadastre-o (dá para fazer pelo botão de cadastro rápido, sem sair da tela) e <b>recalcule a competência</b>. Enquanto isso, é dinheiro fora do cálculo.'],
        semRegraPapel: ['Mapear o papel', 'O papel que veio do QVIS não está no <b>Mapeamento de Papéis</b>, ou a base do percentual ficou zerada. Mapeie o papel e recalcule.'],
        glosa: ['Cobrar, não cadastrar', 'O convênio não pagou este item. Não é erro de cadastro: leve para a <b>cobrança/recurso de glosa</b>. O repasse só existe sobre o que entrou.'],
        duplicada: ['Conferir a duplicidade', 'Esta admissão + procedimento + papel já foi paga em mês anterior. Se o caso for legítimo (uma segunda cirurgia de verdade), trate por <b>regra de exceção</b>.'],
        excluidoTipo: ['Revisar o escopo', 'A classificação deste produto está fora do escopo do cálculo (CONSULTA / EXAME / PROCEDIMENTO). Se ele deveria entrar, ajuste em ⚙ Ajustes → tipos habilitados.'],
        semRemuneracao: ['Nada a fazer', 'A BASE TABELA diz explicitamente que este papel não é remunerado neste procedimento. A linha é omitida de propósito.'],
      };
      const a = acoes[st];
      if (a) secAcao.push(a);
    }

    // ── V996: PARA ONDE ESTE VALOR VAI ─────────────────────────────────────
    const secDestino = [];
    if (pagou) {
      secDestino.push(['No fluxo do mês', 'Calcular → <b>Auditoria</b> (que completa os papéis que faltaram) → <b>Relatórios</b> → total do médico → <b>Controle de Notas</b>, onde vira a conferência da nota fiscal.']);
      secDestino.push(['Este valor muda se…', 'a BASE TABELA for alterada <b>e</b> a competência for recalculada; ou se uma regra de exceção passar a valer para esta combinação.']);
    }

    return { pagou, valor: pagou ? l._repasse : 0, status: st,
      secLinha, secRegra, secConta, secMotivo, secAud, secOrigem, secAcao, secDestino };
  }

  // ═══ V996: MEMÓRIA DO CONSOLIDADO (Relatórios) ═════════════════════════
  // A linha do Relatórios não é uma linha do QVIS: é o RESULTADO de um módulo.
  // A pergunta muda de "que regra pagou isto?" para "de onde veio este valor
  // e por qual regra o módulo de origem chegou nele?".
  function montarConsolidado(l) {
    const valor = Number(l.valor) || 0;
    const pagou = valor !== 0;
    const mod = l.modulo || '';
    const regra = regraDoModulo(mod);
    const secLinha = [], secRegra = [], secOrigem = [], secCaminho = [], secAcao = [], secDestino = [];

    // 1) a linha do consolidado
    secLinha.push(['Módulo de origem', `<b>${esc(mod || '—')}</b>${l.status ? ` <small>(${esc(l.status)})</small>` : ''}`]);
    secLinha.push(['Profissional', esc(nome(l.profissional)) || '—']);
    if (l.papel) secLinha.push(['Papel', esc(l.papel)]);
    // a matriz do Consolidado traz 'data' já formatada; a do fichário traz
    // 'data_admissao' crua — as duas caem aqui
    const dt = l.data || (l.data_admissao ? data(l.data_admissao) : '');
    if (l.admissao || dt) secLinha.push(['Admissão', `${esc(l.admissao || '—')}${dt ? ' · ' + esc(dt) : ''}`]);
    if (l.paciente) secLinha.push(['Paciente', esc(l.paciente)]);
    if (l.origem) secLinha.push(['Fonte pagadora', `${window.Utilidades ? Utilidades.badgeFonte(l.origem) : esc(l.origem)}${l.convenio ? ' · ' + esc(l.convenio) : ''}`]);
    if (l.descricao) secLinha.push(['Descrição', esc(l.descricao)]);
    if (l.especialidade) secLinha.push(['Especialidade', esc(l.especialidade)]);
    if (l.produzido != null && l.produzido !== '') secLinha.push(['Produzido', typeof l.produzido === 'number' ? moeda(l.produzido) : esc(l.produzido)]);
    if (l.vtab) secLinha.push(['Versão da Base Tabela', `${esc(l.vtab)} <small>(escolhida pela data da admissão)</small>`]);

    // 2) a regra do módulo que gerou o valor
    if (regra) {
      secRegra.push(['Como o valor sai', regra.conta]);
      secOrigem.push(['Dados de entrada', regra.origem]);
      secOrigem.push(['Onde conferir linha a linha', `<b>${esc(regra.conferir)}</b>`]);
    } else {
      secRegra.push(['Regra', 'Módulo sem regra descrita aqui — confira no fichário de origem.']);
    }
    if (l._gerencial) secRegra.push(['Atenção', 'Ajuste <b>manual</b>: entrou porque alguém decidiu e o marcou como APLICADO no Gerenciais. Ajuste pendente ou descartado não aparece neste consolidado.']);
    if (l._avulsa) secRegra.push(['Atenção', 'Linha <b>avulsa</b>: digitada direto no Relatórios, sem regra por trás. A descrição é a única explicação da origem.']);
    if (l._medicoReal && l.profissional !== l._medicoReal) secRegra.push(['Destinatário', 'o valor foi <b>redirecionado ao executante</b> porque o indicante não foi informado']);

    // 3) o caminho até aqui
    if (String(mod).toUpperCase() === 'REPASSE') {
      secCaminho.push(['1 · Importação', 'o relatório do QVIS do mês entrou em <b>Importação QVIS</b>']);
      secCaminho.push(['2 · Cálculo', 'o <b>Calcular Repasse</b> cruzou a linha com a BASE TABELA e congelou o resultado no snapshot da competência']);
      secCaminho.push(['3 · Auditoria', 'a <b>Auditoria</b> completou os papéis que o QVIS não trouxe (auxiliar, indicante, solicitante)']);
      secCaminho.push(['4 · Aqui', 'o <b>Relatórios</b> junta tudo num quadro só, por médico']);
    } else if (l._gerencial || l._avulsa) {
      secCaminho.push(['1 · Lançamento', l._gerencial ? 'o ajuste foi criado no <b>Gerenciais</b> e marcado como APLICADO' : 'a linha foi digitada direto no <b>Relatórios</b>']);
      secCaminho.push(['2 · Aqui', 'entra no consolidado do mês e soma (ou subtrai) no total do médico']);
    } else {
      secCaminho.push(['1 · Importação', 'a base do módulo foi importada (QVIS, Produção ou a planilha do setor)']);
      secCaminho.push(['2 · Apuração', `o fichário <b>${esc(mod)}</b> aplicou a regra acima sobre os dados do mês`]);
      secCaminho.push(['3 · Aqui', 'o <b>Relatórios</b> traz o resultado já apurado, sem recalcular nada']);
    }

    // 4) o que fazer
    if (!pagou) {
      secAcao.push(['Valor zerado', `Linha com R$ 0,00 quase sempre é <b>cadastro faltando no módulo de origem</b> (lente sem valor, marcação não feita, laudo pendente) — não um erro do Relatórios. Confira em <b>${esc(regra ? regra.conferir : mod)}</b>.`]);
    }
    secAcao.push(['Se o valor parecer errado', `O Relatórios <b>não calcula</b>: ele reúne. Corrija no módulo de origem (<b>${esc(regra ? regra.conferir : mod)}</b>) e volte aqui.`]);
    if (String(mod).toUpperCase() === 'REPASSE') {
      secAcao.push(['Depois de corrigir', 'mexeu na BASE TABELA? <b>Recalcule a competência</b> — um mês já calculado não se atualiza sozinho.']);
    }

    // 5) destino
    secDestino.push(['Total do médico', 'esta linha soma no total do profissional no mês — é o número que vai para a <b>exportação por médico</b>']);
    secDestino.push(['Conferência da nota', 'esse total é a referência que o <b>Controle de Notas</b> compara com o valor bruto da nota fiscal do médico']);
    secDestino.push(['Fechamento', 'depois da <b>Consolidação de Repasse</b>, a lista de admissões do mês fica congelada sob um código']);

    return { pagou, valor, status: l.status || '', modulo: mod,
      secLinha, secRegra, secOrigem, secCaminho, secAcao, secDestino };
  }

  const _sec = (tit, itens, cls) => (itens && itens.length)
    ? `<div class="mem-sec${cls ? ' ' + cls : ''}"><div class="mem-sec-tit">${tit}</div>${itens.map(([r, v]) => `<div class="mem-it"><span class="mem-rot">${r}</span><span class="mem-val">${v}</span></div>`).join('')}</div>`
    : '';
  const _rodape = () => `<div class="mem-rodape">${_fixado ? 'fixado — Esc ou clique fora fecha' : 'clique no valor pra fixar o cartão'}</div>`;

  /** Memória de uma linha do QVIS (Calcular · Auditoria · linhas "Repasse"). */
  function htmlQvis(l) {
    const m = montar(l);
    const stRot = { casou: 'PAGO', glosa: 'GLOSA', duplicada: 'DUPLICIDADE', procSemRegra: 'NOVO', semRegraPapel: 'SEM REGRA', excluidoTipo: 'EXCLUÍDO', pacoteDetalhe: 'AJUSTES' }[m.status] || String(m.status || '').toUpperCase();
    return `
      <div class="mem-head">
        <div><div class="mem-titulo">Memória de cálculo</div><div class="mem-sub">como o motor chegou neste valor</div></div>
        <div class="mem-valor ${m.pagou ? '' : 'mem-valor-zero'}">${m.pagou ? moeda(m.valor) : '—'}<span class="mem-st mem-st-${m.pagou ? 'ok' : 'nao'}">${esc(stRot)}</span></div>
      </div>
      ${_sec('Linha do QVIS', m.secLinha)}
      ${_sec('Regra aplicada', m.secRegra)}
      ${_sec('Conta', m.secConta)}
      ${_sec('Por que não pagou', m.secMotivo)}
      ${_sec('O que fazer', m.secAcao, 'mem-sec-acao')}
      ${_sec('Ajustes da Auditoria', m.secAud)}
      ${_sec('De onde vem cada número', m.secOrigem)}
      ${_sec('Para onde este valor vai', m.secDestino)}
      ${_rodape()}`;
  }

  /** Memória de uma linha do CONSOLIDADO (Relatórios). */
  function htmlConsolidado(l) {
    // linha do módulo "Repasse": a linha original do QVIS viajou junto, então
    // dá pra mostrar a trilha COMPLETA da regra, igual ao Calcular
    if (l && l._orig) {
      const m = montar(l._orig);
      const c = montarConsolidado(l);
      const stRot = { casou: 'PAGO', glosa: 'GLOSA', duplicada: 'DUPLICIDADE', procSemRegra: 'NOVO', semRegraPapel: 'SEM REGRA', excluidoTipo: 'EXCLUÍDO', pacoteDetalhe: 'AJUSTES' }[m.status] || String(m.status || '').toUpperCase();
      return `
        <div class="mem-head">
          <div><div class="mem-titulo">Memória de cálculo</div><div class="mem-sub">${esc(c.modulo || 'Repasse')} · a regra que gerou este valor</div></div>
          <div class="mem-valor ${m.pagou ? '' : 'mem-valor-zero'}">${m.pagou ? moeda(m.valor) : '—'}<span class="mem-st mem-st-${m.pagou ? 'ok' : 'nao'}">${esc(stRot)}</span></div>
        </div>
        ${_sec('Linha do QVIS', m.secLinha)}
        ${_sec('Regra aplicada', m.secRegra)}
        ${_sec('Conta', m.secConta)}
        ${_sec('Por que não pagou', m.secMotivo)}
        <!-- a ação da linha do QVIS (quando não pagou) + a orientação de onde
             corrigir no módulo de origem, numa seção só -->
        ${_sec('O que fazer', m.secAcao.concat(c.secAcao), 'mem-sec-acao')}
        ${_sec('Ajustes da Auditoria', m.secAud)}
        ${_sec('De onde vem cada número', m.secOrigem)}
        ${_sec('Caminho até aqui', c.secCaminho)}
        ${_sec('Para onde este valor vai', c.secDestino)}
        ${_rodape()}`;
    }
    const c = montarConsolidado(l || {});
    return `
      <div class="mem-head">
        <div><div class="mem-titulo">Memória de cálculo</div><div class="mem-sub">${esc(c.modulo || 'módulo')} · de onde veio este valor</div></div>
        <div class="mem-valor ${c.pagou ? '' : 'mem-valor-zero'}">${moeda(c.valor)}<span class="mem-st mem-st-${c.pagou ? 'ok' : 'nao'}">${esc(String(c.status || '').toUpperCase() || '—')}</span></div>
      </div>
      ${_sec('Linha do consolidado', c.secLinha)}
      ${_sec('Regra do módulo', c.secRegra)}
      ${_sec('De onde vêm os dados', c.secOrigem)}
      ${_sec('Caminho até aqui', c.secCaminho)}
      ${_sec('O que fazer', c.secAcao, 'mem-sec-acao')}
      ${_sec('Para onde este valor vai', c.secDestino)}
      ${_rodape()}`;
  }

  function html(l, tipo) {
    return tipo === 'consolidado' ? htmlConsolidado(l) : htmlQvis(l);
  }

  // ── popover ──
  function estilos() {
    if (_estilo) return; _estilo = true;
    const s = document.createElement('style');
    s.id = 'atlas-memoria-estilos';
    s.textContent = `
      [data-mem] { cursor: help; }
      [data-mem].mem-cel-ativa { background: #f7f8fa !important; box-shadow: inset 0 0 0 1px #9CCBE6; border-radius: 4px; }
      /* V996: o cartão ganhou origem dos dados, o que fazer e o destino do
         valor — em 400px cada frase virava 4 linhas. */
      .atlas-mem-popover { position: fixed; z-index: 4300; width: 460px; max-width: calc(100vw - 20px); max-height: min(78vh, 640px); overflow: hidden auto;
        background: #fff; border-radius: 14px; box-shadow: 0 18px 44px rgba(29, 31, 32,.26), 0 0 0 1px #eef0f2; font-size: 12.5px; color: #3a5877;
        opacity: 0; transform: translateY(4px); transition: opacity .12s ease, transform .12s ease; pointer-events: none; }
      .atlas-mem-popover.aberto { opacity: 1; transform: none; pointer-events: auto; }
      .atlas-mem-popover.fixado { box-shadow: 0 18px 44px rgba(29, 31, 32,.34), 0 0 0 2px #46688c; }
      /* V997: o título do cartão saiu do #1d1f20 chapado para o DEGRADÊ padrão
         do ATLAS (o mesmo dos cabeçalhos de matriz). */
      .mem-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 12px 14px 10px;
        background-image: linear-gradient(90deg, #5980a6 0%, #46688c 34%, #3f6489 68%, #d8e4ef 100%); color: #fff; }
      .mem-titulo { font-weight: 800; font-size: 13px; letter-spacing: .2px; }
      .mem-sub { font-size: 10.5px; color: #9FC3D6; margin-top: 2px; }
      /* V997: o valor do cabeçalho e o selo PAGO saíram do verde-menta
         (#7FE0C0) para o BRANCO; o valor da conta saiu do #0E7A57 para o
         #3f6489, a cor de repasse da ferramenta. */
      .mem-valor { font-family: var(--font-mono, monospace); font-weight: 800; font-size: 16px; text-align: right; white-space: nowrap; color: #FFFFFF; }
      /* V999: o cabeçalho NÃO muda de cor com o status. A linha que não pagou
         trazia o valor em cinza (#C9D6DE) e o selo em âmbar (#F2C08B) — duas
         cores a mais pro mesmo lugar, dependendo do caso. Quem diz que não
         pagou é o TEXTO ("—", "GLOSA", "SEM REGRA"), não a cor. */
      .mem-valor-zero { color: #FFFFFF; }
      .mem-st { display: block; font-family: var(--font-body, inherit); font-size: 9.5px; font-weight: 800; letter-spacing: .6px; margin-top: 3px; }
      .mem-st-ok { color: #FFFFFF; } .mem-st-nao { color: #FFFFFF; }
      .mem-sec { padding: 8px 14px 6px; border-top: 1px solid #EDF2F0; }
      .mem-sec-tit { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: #46688c; margin-bottom: 4px; }
      .mem-it { display: grid; grid-template-columns: 132px 1fr; gap: 8px; padding: 3px 0; line-height: 1.35; }
      .mem-rot { color: #585d62; font-weight: 600; }
      .mem-val { color: #1d1f20; word-break: break-word; }
      .mem-val small { color: #585d62; font-size: 11px; }
      .mem-val b { font-weight: 800; color: #3f6489; }
      .mem-alerta { display: inline-block; margin-top: 3px; padding: 1px 6px; border-radius: 6px; background: #FBF0DA; color: #8A5A1F; font-size: 11px; }
      /* a seção de AÇÃO é a que o usuário precisa ver primeiro quando algo não
         pagou — fundo próprio pra ela saltar no meio do cartão */
      .mem-sec-acao { background: #FFF8EC; border-left: 3px solid #D9A441; }
      .mem-sec-acao .mem-sec-tit { color: #8A5A1F; }
      .mem-rodape { padding: 7px 14px 9px; font-size: 10.5px; color: #8A98A3; border-top: 1px solid #EDF2F0; background: #F8FBFC; }
    `;
    document.head.appendChild(s);
  }

  function posicionar(cel) {
    if (!_pop || !cel) return;
    const r = cel.getBoundingClientRect();
    const W = _pop.offsetWidth || 400, H = _pop.offsetHeight || 300;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = r.left - W - 10;                      // à esquerda da célula (a coluna do repasse é a última)
    if (left < 8) left = Math.min(r.right + 10, vw - W - 8);
    if (left < 8) left = 8;
    let top = r.top - 8;
    if (top + H > vh - 8) top = Math.max(8, vh - H - 8);
    _pop.style.left = left + 'px';
    _pop.style.top = top + 'px';
  }

  function abrir(cel, fixar) {
    const it = itemDe(cel);
    if (!it) return;
    const l = it.l;
    if (fixar === false && _fixado) return;   // hover não mexe num cartão fixado
    estilos();
    if (!_pop) {
      _pop = document.createElement('div');
      _pop.className = 'atlas-mem-popover';
      _pop.addEventListener('mouseenter', () => { clearTimeout(_timer); });
      _pop.addEventListener('mouseleave', () => { if (!_fixado) fechar(); });
      document.body.appendChild(_pop);
    }
    if (_celAtual && _celAtual !== cel) _celAtual.classList.remove('mem-cel-ativa');
    _celAtual = cel; cel.classList.add('mem-cel-ativa');
    if (fixar != null) _fixado = fixar;
    _pop.classList.toggle('fixado', _fixado);
    _pop.innerHTML = html(l, it.tipo);
    _pop.classList.add('aberto');
    posicionar(cel);
  }
  function fechar() {
    clearTimeout(_timer);
    _fixado = false;
    if (_pop) { _pop.classList.remove('aberto', 'fixado'); }
    if (_celAtual) { _celAtual.classList.remove('mem-cel-ativa'); _celAtual = null; }
  }

  document.addEventListener('mouseover', (e) => {
    const cel = e.target.closest && e.target.closest('[data-mem]');
    if (!cel) return;
    if (_fixado) return;
    clearTimeout(_timer);
    _timer = setTimeout(() => abrir(cel, false), 140);
  });
  document.addEventListener('mouseout', (e) => {
    const cel = e.target.closest && e.target.closest('[data-mem]');
    if (!cel || _fixado) return;
    const para = e.relatedTarget;
    if (para && (para === _pop || (_pop && _pop.contains(para)))) return;
    clearTimeout(_timer);
    _timer = setTimeout(() => { if (!_fixado) fechar(); }, 120);
  });
  document.addEventListener('click', (e) => {
    const cel = e.target.closest && e.target.closest('[data-mem]');
    if (cel) {
      clearTimeout(_timer);   // o hover pendente não pode "desfixar" o clique
      if (_fixado && _celAtual === cel) { fechar(); return; }
      abrir(cel, true);
      return;
    }
    if (_pop && _pop.contains(e.target)) return;
    if (_fixado) fechar();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _pop && _pop.classList.contains('aberto')) fechar(); });
  window.addEventListener('scroll', () => { if (_pop && _pop.classList.contains('aberto') && _celAtual) posicionar(_celAtual); }, true);
  window.addEventListener('resize', () => { if (_pop && _pop.classList.contains('aberto') && _celAtual) posicionar(_celAtual); });

  window.AtlasMemoria = { novaLeva, ref, montar, montarConsolidado, regraDoModulo,
    html, abrir, fechar, estilos, _linhaDe: linhaDe, _REGRA_MODULO: REGRA_MODULO };
})();
