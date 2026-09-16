/**
 * ATLAS — Visão Geral Executiva · UI
 * Dashboard de produção e repasse: filtros globais (período, médico, módulo),
 * cards (Produção, Repasse, Glosa) com LY/LM, evolução do repasse,
 * Top 10 médicos com drill-down e ranking de impacto por glosa.
 * Dados: window.VGExec. Componentes visuais: padrão AIC / fita-título do app.
 */
App.telas['dashboard'] = function () {
  const D = window.VGExec;
  // V200: garante dados frescos ao abrir o dashboard (Base/Médicos podem ter mudado);
  // dentro da sessão do dashboard o aux fica cacheado entre filtros/drill.
  if (window.__atlasInvalidarAux) window.__atlasInvalidarAux();
  if (D && D._limparCache && !window.__vg) D._limparCache();
  const U = window.Utilidades;
  const oc = !!(window.CodigoMedico && CodigoMedico.ocultando());   // ocultar nomes (mostrar CÓD)?
  function exibirNome(n) { return (window.CodigoMedico && n) ? CodigoMedico.exibir(n) : (n || ''); }
  // V952: botão ⓘ de cada gráfico/ilha/card — abre o doc window.AtlasDocs['vg-…']
  // (js/docs_visao_geral.js) pelo clique declarativo do AtlasInfo (data-atlas-info).
  function infoBtn(id, claro) {
    return `<button type="button" class="atlas-btn-info atlas-btn-info-mini${claro ? ' atlas-btn-info-claro' : ''}"
      data-atlas-info="${id}" data-no-hub title="Como ler: o que é este número, de onde vem e como é calculado"
      aria-label="Como ler este gráfico"><i class="ti ti-info-circle" aria-hidden="true"></i></button>`;
  }

  // estado dos filtros globais (persistido na sessão da tela)
  const st = window.__vg = window.__vg || {
    comp: null, medicoNome: '', modulo: 'TODOS', drillMedico: null,
  };
  const comps = D.competenciasDisponiveis();
  if (!st.comp || !comps.includes(st.comp)) st.comp = comps.length ? comps[0] : null;

  injetarEstilosVG();

  if (!st.comp) {
    document.getElementById('conteudo').innerHTML = `
      <div class="page-content vg-page">
        <header class="page-header"><div><h2>Visão Geral</h2>
        <div class="subtitle">Nenhuma competência com dados — importe Produção ou QVIS pra começar</div></div></header>
      </div>`;
    return;
  }

  document.getElementById('conteudo').innerHTML = `
    <div class="page-content vg-page">
      <header class="page-header vg-header">
        <div class="vg-header-left">
          <div><h2>Visão Geral</h2>
            <div class="subtitle">Dashboard executivo · <strong id="vg-comp-label">${fmtComp(st.comp)}</strong></div>
          </div>
        </div>
        <button id="vg-cod-switch" class="vg-cod-switch${oc ? ' on' : ''}" type="button" data-no-hub
                aria-pressed="${oc ? 'true' : 'false'}"
                title="${oc ? 'Mostrando CÓD — clique para ver os NOMES' : 'Mostrando NOMES — clique para ocultar (mostrar CÓD MDATLAS)'} · só na tela, não afeta exports">
          <i class="ti ti-${oc ? 'eye-off' : 'eye'}"></i>
        </button>
        <button id="vg-lembrete-btn" class="vg-lembrete-btn" type="button"></button>
      </header>
      <div id="vg-linha-tempo"></div><!-- V552: linha do tempo do repasse (1º bloco) -->
      <div id="vg-filtros-sentinela"></div><!-- V935: some do viewport quando a barra "prende" no topo -->
      <div id="vg-filtros"></div><!-- V935: position:sticky — acompanha a rolagem até o fim da página -->
      <div id="vg-cards"><div class="vg-carregando"><div class="atlas-loader"><span></span><span></span><span></span></div><span>Carregando indicadores…</span></div></div>
      <div id="vg-comparativo"></div><!-- V506: comparativo mês a mês -->
      <div class="vg-charts-2col"><!-- V548: 50/50, alturas iguais (design 3A) -->
        <div id="vg-evolucao"></div>
        <section class="vg-gc-bloco" id="vg-glosa-chart"><div class="vg-gc-loading"><span class="vg-cmp-calc">calculando o gráfico de glosa…</span></div></section>
      </div>
      <!-- V872: "Evolução da Glosa Fato" — LARGURA TOTAL, logo abaixo da dupla.
           É irmão do .vg-charts-2col, então nasce alinhado à borda esquerda da
           Evolução do Repasse e à direita do Glosa do mês, sem margem própria. -->
      <section class="vg-gc-bloco vg-gf-bloco" id="vg-glosafato-chart"><div class="vg-gc-loading"><span class="vg-cmp-calc">calculando a evolução da glosa fato…</span></div></section>
      <div id="vg-rankings"></div>
      <div id="vg-especialidades"></div><!-- V931: tabela por categoria (QVIS) -->
      <div id="vg-desemprep"></div><!-- V574: Desempenho × Repasse por médico -->
    </div>`;

  if (window.AtlasLembretes) window.AtlasLembretes.montar('vg-lembrete-btn');
  if (window.AtlasLinhaTempo) window.AtlasLinhaTempo.montar('vg-linha-tempo');   // V552
  _observarFiltroPreso();   // V935: classe .vg-preso quando a barra encosta no topo (sombra + fundo)

  const swCod = document.getElementById('vg-cod-switch');
  if (swCod) swCod.onclick = () => {
    if (window.CodigoMedico) CodigoMedico.alternar();
    App.telas['dashboard']();   // re-renderiza tudo (header + dados) com o novo estado
  };

  // V531: clique no botão de export do card de glosa (delegado — o innerHTML de
  // #vg-cards é recriado a cada filtro; o elemento em si persiste nesta render)
  const cardsEl = document.getElementById('vg-cards');
  if (cardsEl && !cardsEl.__vgGlosaExportBound) {
    cardsEl.__vgGlosaExportBound = true;
    cardsEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vg-glosa-export]');
      if (b) { e.preventDefault(); exportarGlosa(b); return; }
      // V868: alterna a régua da glosa (GLOSA 100% × GLOSA FATO)
      const sw = e.target.closest('[data-vg-glosa-visao]');
      if (sw) {
        e.preventDefault();
        const nova = sw.getAttribute('data-vg-glosa-visao');
        if (nova !== glosaVisao()) {
          st.glosaVisao = nova; renderCards();
          // V953: a matriz "Produção por categoria" segue a mesma régua do card
          if (document.getElementById('vg-esp-tab')) renderCategorias();
        }
      }
    });
  }

  // ── V579: LAZY abaixo da dobra ──────────────────────────────────────────
  // Na abertura, só filtros + cards do mês calculam. Os blocos pesados
  // (comparativo, evolução, glosa, rankings, desempenho×repasse) mostram um
  // aguardando leve e SÓ calculam quando entram na tela (IntersectionObserver),
  // um de cada vez (fila com yield) — a abertura deixa de travar o navegador.
  let __vgFila = Promise.resolve();
  const __vgNaFila = (fn) => {
    __vgFila = __vgFila.then(async () => {
      await U.aguardarPintura();
      try { fn(); } catch (e) { console.error('[vg] bloco lazy:', e); }
    });
  };
  function lazyRender(hostId, fn, rotulo) {
    const el = document.getElementById(hostId);
    if (!el) return;
    el.innerHTML = `<div class="vg-lazy-ph"><span class="vg-cmp-calc">calculando ${rotulo}…</span></div>`;
    if (el.__vgIO) { try { el.__vgIO.disconnect(); } catch (_) {} el.__vgIO = null; }
    if (typeof IntersectionObserver === 'undefined') { __vgNaFila(fn); return; }
    const io = new IntersectionObserver((es) => {
      if (es.some(e => e.isIntersecting)) { io.disconnect(); el.__vgIO = null; __vgNaFila(fn); }
    }, { rootMargin: '260px' });
    el.__vgIO = io;
    io.observe(el);
  }
  function agendarBlocosLazy() {
    lazyRender('vg-comparativo', renderComparativo, 'o comparativo mês a mês');
    lazyRender('vg-evolucao', renderEvolucao, 'a evolução do repasse');
    lazyRender('vg-glosa-chart', renderGlosaChart, 'o gráfico de glosa');
    lazyRender('vg-glosafato-chart', renderGlosaFatoChart, 'a evolução da glosa fato');   // V872
    lazyRender('vg-rankings', renderRankings, 'os rankings de médicos');
    lazyRender('vg-especialidades', renderCategorias, 'a tabela por categoria');   // V931
    lazyRender('vg-desemprep', renderDesempRep, 'o desempenho × repasse');
  }

  // pinta a casca + spinner PRIMEIRO (evita tela branca), só então o trabalho
  // pesado — FATIADO: cada etapa cede a thread ao navegador (assim a barra
  // lateral, ícones e cliques seguem respondendo enquanto o dashboard monta).
  (async () => {
    await U.aguardarPintura();
    renderFiltros();
    await U.aguardarPintura();
    renderCards();            // dispara a auditoria do mês (parte pesada)
    await U.aguardarPintura();
    agendarBlocosLazy();      // V579: o resto calcula quando aparecer na tela
  })();

  // ──────────────────────────────────────────────────────────────────────
  function renderTudo() {
    document.getElementById('vg-comp-label').textContent = fmtComp(st.comp);
    const cards = document.getElementById('vg-cards');
    if (cards) cards.innerHTML = `<div class="vg-carregando"><div class="atlas-loader"><span></span><span></span><span></span></div><span>Atualizando…</span></div>`;
    (async () => {
      await U.aguardarPintura();
      renderFiltros();   // V280: modulosConsolidado() é pesado — roda DEPOIS do spinner pintar
      await U.aguardarPintura();
      renderCards();
      await U.aguardarPintura();
      agendarBlocosLazy();   // V579: blocos visíveis recalculam já; os demais, ao aparecer
    })();
  }

  // ── V506: COMPARATIVO MÊS A MÊS (layout aprovado pelo usuário) ─────────
  // Cada mês num card: Bloco 1 = Repasse ÷ Produção TOTAL (% embaixo);
  // Bloco 2 = Produção MÉDICA ÷ Produção TOTAL (% embaixo). Filtro do
  // repasse: Ambos | Repasse (QVIS) | Desempenho. Últimas 6 competências.
  // Dados: producaoDoMes/mesesComparativo/repasseConsolidado (globais do
  // dashboard.js, com cache por Banco._versao).
  // V508: fontes definidas pelo usuário —
  //   Bloco 1: Repasse (Gerencial) = "Valor total" do CONSOLIDADO do módulo
  //            Relatórios (AtlasRelatorios.linhasConsolidadoComp) ÷ Produção
  //            (total da importação da PRODUÇÃO). Filtro: linhas com status
  //            "Desempenho" vs o restante (Repasse QVIS/ajustes/avulsas).
  //   Bloco 2: Prod. Médica = CONSOLIDAÇÃO TOTAL contábil do módulo Produção
  //            Médica (Produção Médica + Desempenho + SANTO; congelado quando
  //            houver snapshot) ÷ Prod. Total = RECEITA PROD TOTAL (receita
  //            pura da Produção — mesma soma bruta de linhas_producao).
  // V537: repasse consolidado por mês — MESMA fonte do comparativo mês a mês
  // (Consolidado do Relatórios; Desempenho = status 'Desempenho'; QVIS = matriz
  // da auditoria). Cache por comp|versão em window.__vgCmpDados. Reusado pela
  // Evolução do Repasse pra seguir o repasse dos cards do comparativo.
  const _normStVG = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  function dadosRepasseMes(comp) {
    window.__vgCmpDados = window.__vgCmpDados || new Map();
    const chave = comp + '|' + (Banco._versao || 0);
    if (window.__vgCmpDados.has(chave)) return window.__vgCmpDados.get(chave);
    if (window.__vgCmpDados.size > 60) window.__vgCmpDados.clear();
    // V591: FOTO PERSISTENTE por mês (mesmo esquema de fingerprint dos cards).
    // Reabrir a ferramenta não re-roda o motor para meses cujos dados não
    // mudaram — o comparativo/evolução pintam direto da foto; só o mês que
    // mudou (ex.: nova importação) recalcula.
    const foto = D._fotoLer ? D._fotoLer('cmpMes', comp) : null;
    if (foto) { window.__vgCmpDados.set(chave, foto); return foto; }
    const d = { repTotal: 0, repDesemp: 0, repQvis: 0, contabil: null };
    try {
      const linhas = (window.AtlasRelatorios && window.AtlasRelatorios.linhasConsolidadoComp)
        ? (window.AtlasRelatorios.linhasConsolidadoComp(comp) || []) : [];
      for (const l of linhas) {
        const v = Number(l.valor) || 0;
        d.repTotal += v;
        if (_normStVG(l.status) === 'DESEMPENHO') d.repDesemp += v;
      }
    } catch (e) { console.error('[vg] dadosRepasseMes consolidado', e); }
    try {
      const matriz = (window.AtlasAuditoria && window.AtlasAuditoria.matrizDaCompetencia)
        ? (window.AtlasAuditoria.matrizDaCompetencia(comp) || []) : [];
      d.repQvis = matriz.reduce((s, l) => s + (Number(l._repasse) || 0), 0);
    } catch (e) { console.error('[vg] dadosRepasseMes matriz', e); }
    try {
      d.contabil = (window.AtlasProducaoMedica && window.AtlasProducaoMedica.consolidacaoContabilPartes)
        ? window.AtlasProducaoMedica.consolidacaoContabilPartes(comp) : null;
    } catch (_) { d.contabil = null; }
    window.__vgCmpDados.set(chave, d);
    // V591: não fotografa um cálculo degradado (consolidado E contábil falharam)
    if (D._fotoGravar && (d.contabil !== null || d.repTotal !== 0)) D._fotoGravar('cmpMes', comp, d);
    return d;
  }
  // V614: a Consolidação usa os mesmos números (repasse do Calcular via matriz
  // da Auditoria + repasse dos Desempenhos), com a mesma foto persistente
  window.AtlasVGUI = Object.assign(window.AtlasVGUI || {}, { dadosRepasseMes });

  // repasse do mês conforme o chip do comparativo (ambos/qvis/desemp)
  function repasseComparativoMes(comp) {
    const d = dadosRepasseMes(comp);
    return st.cmpFiltro === 'qvis' ? d.repQvis : st.cmpFiltro === 'desemp' ? d.repDesemp : d.repTotal;
  }
  function repasseModoLabel() {
    return st.cmpFiltro === 'qvis' ? 'Repasse (QVIS)' : st.cmpFiltro === 'desemp' ? 'Desempenho' : 'Repasse (Gerencial)';
  }

  // V538: KPIs LM / LY / YTD ─────────────────────────────────────────────
  // LM = vs mês anterior · LY = vs mesmo mês do ano anterior (variação % +
  // valor absoluto entre parênteses, verde se ↑ / vermelho se ↓). YTD =
  // acumulado do ano até o mês (R$).
  const _fmtR$2 = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function _kpiVar(atual, base) {
    if (base == null || base === 0) return null;
    return { pct: ((atual - base) / base) * 100, abs: atual - base };
  }
  function _kpiVarHtml(v) {
    if (!v) return `<span class="vg-kpi-nil">—</span>`;
    const up = v.pct >= 0;
    const cls = up ? 'vg-kpi-up' : 'vg-kpi-down';
    const seta = up ? '↑' : '↓';
    const pct = Math.abs(v.pct).toFixed(1).replace('.', ',');
    const val = (v.abs < 0 ? '-' : '') + 'R$ ' + Math.abs(v.abs).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `<span class="${cls}">${seta} ${pct}% <em>(${val})</em></span>`;
  }
  const _kpiYtdHtml = v => `<span class="vg-kpi-ytd">${_fmtR$2(v)}</span>`;
  const _KPI_NIL = `<span class="vg-kpi-nil">—</span>`;
  // V539: só compara com um período que EXISTE nos dados. Se o mês-base (LM/LY)
  // não foi importado, não há base → mostra "—" (não inventa valor). Evita o
  // caso "LY com valor" quando o ano anterior não tem nada importado.
  function _compsComDados() { return new Set(D.competenciasDisponiveis ? D.competenciasDisponiveis() : []); }
  // competências do MESMO ano, de janeiro até `comp` (inclusive), com dados
  function mesesDoAnoAte(comp) {
    const ano = String(comp).slice(0, 4);
    const todas = (D.competenciasDisponiveis ? D.competenciasDisponiveis() : []) || [];
    return todas.filter(c => String(c).slice(0, 4) === ano && c <= comp).sort();
  }
  // Prod. Médica contábil do mês conforme o chip + toggle +SANTO (mesma regra
  // do card do comparativo — valoresDoCard)
  function prodMedComparativoMes(comp) {
    const c = dadosRepasseMes(comp).contabil;
    if (!c) return 0;
    const santoV = st.cmpSanto ? (c.santo || 0) : 0;
    return st.cmpFiltro === 'desemp' ? c.desemp
         : st.cmpFiltro === 'qvis'   ? (c.prodMed + santoV)
         : (c.prodMed + c.desemp + santoV);
  }

  async function renderComparativo() {
    const el = document.getElementById('vg-comparativo');
    if (!el) return;
    if (typeof producaoDoMes !== 'function') { el.innerHTML = ''; return; }
    if (st.cmpFiltro === undefined) st.cmpFiltro = 'ambos';
    // V653: o card nasce COM o SANTO incluído — mesma composição do relatório
    // extraído da Produção Médica (que soma o SANTO Anestesia no consolidado
    // e no "% sobre PROD"). O botão "+ SANTO" continua lá pra ver sem.
    if (st.cmpSanto === undefined) st.cmpSanto = true;
    // V534: PERF — o comparativo mostra os últimos 6 meses (dado GLOBAL); NÃO
    // depende dos filtros médico/convênio/módulo nem do período. Só muda com a
    // versão do banco, o chip (ambos/qvis/desemp) e o toggle +SANTO. Se a
    // assinatura não mudou e já está pintado, pula o rebuild (evita re-render
    // pesado a cada troca de filtro).
    const sig = `${Banco._versao || 0}|${st.cmpFiltro}|${st.cmpSanto ? 1 : 0}`;
    if (el.dataset.vgCmpSig === sig && el.querySelector('.vg-cmp-grid')) return;
    const meses = (typeof mesesComparativo === 'function' ? mesesComparativo(6) : []);
    if (!meses.length) { el.innerHTML = ''; el.dataset.vgCmpSig = ''; return; }
    el.dataset.vgCmpSig = sig;
    const fmtPct = v => v == null ? '—'
      : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
    const fmtR$ = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // ── dados BARATOS (queries diretas — carregam junto com o layout) ──────
    const baratosDoMes = (comp) => {
      let producao = 0, receitaLiq = null;
      try { producao = producaoDoMes(comp).total; } catch (_) {}
      try {
        receitaLiq = (window.AtlasProducaoMedica && window.AtlasProducaoMedica.receitaLiquidaContabil)
          ? (window.AtlasProducaoMedica.receitaLiquidaContabil(comp) || 0) : producao;
      } catch (_) { receitaLiq = producao; }
      return { producao, receitaLiq };
    };

    // ── dados PESADOS (repasse consolidado + contábil) — helper compartilhado
    //    com a Evolução do Repasse (V537), cache por comp|versão ──────────────
    const pesadosDoMes = dadosRepasseMes;

    // valores exibidos conforme filtro/toggle (a partir dos pesados + baratos)
    const valoresDoCard = (comp, b, d) => {
      const rep = st.cmpFiltro === 'qvis'   ? d.repQvis
                : st.cmpFiltro === 'desemp' ? d.repDesemp
                : d.repTotal;
      const c = d.contabil;
      const santoV = c && st.cmpSanto ? c.santo : 0;
      // V514: Ambos = QVIS + Desempenho; V511: QVIS = parte não-Desempenho
      const prodMed = !c ? 0
        : st.cmpFiltro === 'desemp' ? c.desemp
        : st.cmpFiltro === 'qvis'   ? (c.prodMed + santoV)
        : (c.prodMed + c.desemp + santoV);
      const recLiq = b.receitaLiq != null ? b.receitaLiq : b.producao;
      return {
        rep, prodMed, recLiq,
        pct1: recLiq > 0 ? (rep / recLiq) * 100 : null,
        pct2: recLiq > 0 ? (prodMed / recLiq) * 100 : null,   // V513
      };
    };

    // ── V515: layout COMPLETO de imediato — baratos preenchidos, pesados com
    //    "calculando…"; os cálculos preenchem os campos em segundo plano ─────
    const LOAD = `<span class="vg-cmp-calc">calculando…</span>`;
    const chips = [['ambos', 'Ambos'], ['qvis', 'Repasse (QVIS)'], ['desemp', 'Desempenho']];
    const baratos = new Map(meses.map(comp => [comp, baratosDoMes(comp)]));
    el.innerHTML = `
      <div class="card vg-cmp-secao">
        <div class="vg-cmp-head">
          <div>
            <h3 class="card-title">Comparativo mês a mês${infoBtn('vg-comparativo')}</h3>
            <p class="card-subtitle">Repasse (Gerencial) sobre a Receita líquida · representatividade da Produção Médica · últimas ${meses.length} competências</p>
          </div>
          <div class="vg-cmp-chips">
            ${chips.map(([id, label]) =>
              `<button class="vg-cmp-chip ${st.cmpFiltro === id ? 'on' : ''}" data-vg-cmp-filtro="${id}" data-no-hub>${label}</button>`).join('')}
            <button class="vg-cmp-chip vg-cmp-chip-santo ${st.cmpSanto ? 'on' : ''}" id="vg-cmp-santo" data-no-hub
                    title="Quando ativo, soma a SANTO Anestesia na Prod. Médica">+ SANTO</button>
          </div>
        </div>
        <div class="vg-cmp-grid">
          ${meses.map(comp => {
            const b = baratos.get(comp);
            const recLiq = b.receitaLiq != null ? b.receitaLiq : b.producao;
            return `
            <div class="vg-cmp-card" data-cmp="${comp}">
              <div class="vg-cmp-mes">${fmtComp(comp)}</div>
              <div class="vg-cmp-bloco vg-cmp-bloco-rep">
                <div class="vg-cmp-titulo"><span class="vg-cmp-dot"></span>Repasse ÷ Receita líquida</div>
                <div class="vg-cmp-linha"><span>Repasse</span><strong data-f="rep">${LOAD}</strong></div>
                <div class="vg-cmp-linha"><span>Receita líquida</span><strong>${fmtR$(recLiq)}</strong></div>
                <div class="vg-cmp-pct" data-f="pct1">${LOAD}</div>
                <div class="vg-cmp-kpis">
                  <div class="vg-cmp-kpi"><span class="vg-cmp-kpi-lbl">vs LM</span><span data-f="rep-lm">${LOAD}</span></div>
                  <div class="vg-cmp-kpi"><span class="vg-cmp-kpi-lbl">vs LY</span><span data-f="rep-ly">${LOAD}</span></div>
                  <div class="vg-cmp-kpi"><span class="vg-cmp-kpi-lbl">YTD</span><span data-f="rep-ytd">${LOAD}</span></div>
                </div>
              </div>
              <div class="vg-cmp-bloco vg-cmp-bloco-pm">
                <div class="vg-cmp-titulo"><span class="vg-cmp-dot"></span>Prod. Médica ÷ Receita líquida</div>
                <div class="vg-cmp-linha"><span>Prod. Médica</span><strong data-f="pm">${LOAD}</strong></div>
                <div class="vg-cmp-linha"><span>Receita líquida</span><strong>${fmtR$(recLiq)}</strong></div>
                <div class="vg-cmp-pct" data-f="pct2">${LOAD}</div>
                <div class="vg-cmp-kpis">
                  <div class="vg-cmp-kpi"><span class="vg-cmp-kpi-lbl">vs LM</span><span data-f="pm-lm">${LOAD}</span></div>
                  <div class="vg-cmp-kpi"><span class="vg-cmp-kpi-lbl">vs LY</span><span data-f="pm-ly">${LOAD}</span></div>
                  <div class="vg-cmp-kpi"><span class="vg-cmp-kpi-lbl">YTD</span><span data-f="pm-ytd">${LOAD}</span></div>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;

    // interações disponíveis DESDE JÁ (troca de filtro re-renderiza; meses já
    // calculados vêm do cache instantaneamente, pendentes voltam a "calculando…")
    el.querySelectorAll('[data-vg-cmp-filtro]').forEach(chip => {
      chip.addEventListener('click', () => { st.cmpFiltro = chip.dataset.vgCmpFiltro; renderComparativo(); renderEvolucao(); });   // V537: chip afeta a evolução também
    });
    const btnSanto = el.querySelector('#vg-cmp-santo');
    if (btnSanto) btnSanto.addEventListener('click', () => { st.cmpSanto = !st.cmpSanto; renderComparativo(); });

    // preenche os campos pesados em segundo plano, mês a mês, cedendo a thread
    const geracao = (window.__vgCmpGen = (window.__vgCmpGen || 0) + 1);
    const disp = _compsComDados();   // V539: competências com dados (guard de LM/LY)
    for (const comp of meses) {
      const d = pesadosDoMes(comp);
      if (geracao !== window.__vgCmpGen) return;   // trocou filtro/tela no meio
      const card = el.querySelector(`.vg-cmp-card[data-cmp="${comp}"]`);
      if (card) {
        const v = valoresDoCard(comp, baratos.get(comp), d);
        const setF = (f, html) => { const n = card.querySelector(`[data-f="${f}"]`); if (n) n.innerHTML = html; };
        setF('rep',  fmtR$(v.rep));
        setF('pm',   fmtR$(v.prodMed));
        setF('pct1', fmtPct(v.pct1));
        setF('pct2', fmtPct(v.pct2));
        // V542: KPIs LM/LY/YTD — CADA cálculo pesado (LM/LY/YTD usam meses NÃO
        // cacheados: mês anterior de outro ano, ano anterior, e todo o YTD) cede
        // a thread ANTES, senão o 1º card processado calcula ~todos os meses do
        // ano de uma vez, num bloco síncrono de vários segundos = "NÃO RESPONDENDO".
        const lmC = D.mesAnterior(comp), lyC = D.anoAnterior(comp);
        await U.aguardarPintura(); if (geracao !== window.__vgCmpGen) return;
        setF('rep-lm', disp.has(lmC) ? _kpiVarHtml(_kpiVar(v.rep, repasseComparativoMes(lmC))) : _KPI_NIL);
        setF('pm-lm',  disp.has(lmC) ? _kpiVarHtml(_kpiVar(v.prodMed, prodMedComparativoMes(lmC))) : _KPI_NIL);
        await U.aguardarPintura(); if (geracao !== window.__vgCmpGen) return;
        setF('rep-ly', disp.has(lyC) ? _kpiVarHtml(_kpiVar(v.rep, repasseComparativoMes(lyC))) : _KPI_NIL);
        setF('pm-ly',  disp.has(lyC) ? _kpiVarHtml(_kpiVar(v.prodMed, prodMedComparativoMes(lyC))) : _KPI_NIL);
        let ytdRep = 0, ytdPm = 0;
        for (const m of mesesDoAnoAte(comp)) {
          await U.aguardarPintura(); if (geracao !== window.__vgCmpGen) return;
          ytdRep += repasseComparativoMes(m); ytdPm += prodMedComparativoMes(m);
        }
        setF('rep-ytd', _kpiYtdHtml(ytdRep));
        setF('pm-ytd',  _kpiYtdHtml(ytdPm));
      }
      await U.aguardarPintura();
      if (geracao !== window.__vgCmpGen) return;
    }
  }

  // ── FILTROS GLOBAIS — barra de pesquisa unificada 12C (V688) ────────────
  // Handoff do Claude Design: UMA barra branca segmentada (Período · Médico ·
  // Módulo ATLAS · Convênio), painel dropdown ancorado na célula, busca POR
  // DIGITAÇÃO (sem acento/caixa) no filtro de médicos, teclado ↑↓/Enter/Esc.
  // Como a consulta já refaz sozinha a cada troca, o slot do "Pesquisar" vira
  // o contador de procedimentos do mês; com filtro ativo vira "✕ Limpar
  // filtros" (decisão de produto do próprio handoff — nada de botão morto).
  const uiSB = { aberto: null, busca: '' };   // um único painel aberto por vez
  // V922: filtros médico/módulo/convênio agora aceitam VÁRIOS valores (união).
  // 'TODOS' e vazio são as sentinelas do "sem filtro".
  const _vgSel = (v) => Utilidades.filtroMulti.sel(v).filter(x => x !== 'TODOS');
  const _vgMarc = (v, x) => _vgSel(v).indexOf(String(x)) >= 0;
  const _vgRot = (v, vazio, um) => {
    const s = _vgSel(v);
    if (!s.length) return vazio;
    return s.length === 1 ? (um ? um(s[0]) : s[0]) : `${s.length} selecionados`;
  };
  const _sbSvg = (d, px, sw) => `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const SB_IC = {
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    card: '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    chev: '<polyline points="6 9 12 15 18 9"/>',
  };
  const _sbSemAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function _sbIniciais(nome) {
    const p = String(nome || '').split(/\s+/).filter(w => w.length >= 3);
    return ((p[0] || ' ')[0] + ((p[1] || ' ')[0] || '')).toUpperCase().trim() || '–';
  }
  // contador do slot direito — procedimentos (admissão+proc) do mês, sem filtro
  let _sbQtdCache = {};
  function _sbQtdProcedimentos(comp) {
    const k = comp + '|' + (Banco._versao || 0);
    if (_sbQtdCache[k] == null) {
      if (Object.keys(_sbQtdCache).length > 30) _sbQtdCache = {};
      try {
        const r = Banco.queryUnica(`SELECT COUNT(DISTINCT COALESCE(admissao,'') || '|' || COALESCE(procedimento,'')) AS n
                                      FROM linhas_qvis WHERE mes_pagamento = ?`, [comp]);
        _sbQtdCache[k] = Number(r && r.n) || 0;
      } catch (_) { _sbQtdCache[k] = 0; }
    }
    return _sbQtdCache[k];
  }

  function renderFiltros() {
    const meds = D.medicosLista();
    const mods = D.modulosConsolidado(st.comp);
    const convs = (D.conveniosLista ? D.conveniosLista(st.comp) : []);
    const el = document.getElementById('vg-filtros');
    const compPadrao = comps[comps.length - 1];
    const temFiltro = !!(_vgSel(st.medicoNome).length || _vgSel(st.modulo).length || _vgSel(st.convenio).length);

    const item = (val, rotulo, sel, chip) => `
      <div class="vg-sb-it ${sel ? 'sel' : ''} ${val === '' || val === 'TODOS' ? 'vg-sb-it-todos' : ''}" data-vgsb-item data-val="${esc(val)}" data-busca="${esc(_sbSemAcento(rotulo))}">
        ${chip ? `<span class="vg-sb-chip">${esc(_sbIniciais(rotulo))}</span>` : ''}
        <span class="vg-sb-it-nome">${esc(rotulo)}</span>
        ${sel ? `<span class="vg-sb-ck">${_sbSvg(SB_IC.check, 14, 2.5)}</span>` : ''}
      </div>`;

    const painel = (cel) => {
      if (uiSB.aberto !== cel) return '';
      let corpo = '', busca = '', rodape = '';
      // V922: busca em TODO painel de conteúdo (médico/módulo/convênio)
      const buscaBox = (ph) => `
          <div class="vg-sb-buscabox">
            <span class="vg-sb-busca-ic">${_sbSvg(SB_IC.search, 15, 2.1)}</span>
            <input class="vg-sb-busca" id="vg-sb-busca" placeholder="${ph}" autocomplete="off">
            <button class="vg-sb-busca-x" id="vg-sb-busca-x" style="display:none" title="Limpar">${_sbSvg(SB_IC.x, 11, 2.8)}</button>
          </div>`;
      const topoMarcados = (lista, chave) => lista.slice()
        .sort((a, b) => (_vgMarc(chave, b) ? 1 : 0) - (_vgMarc(chave, a) ? 1 : 0));
      if (cel === 'periodo') {
        corpo = comps.slice().reverse().map(c => item(c, fmtComp(c), c === st.comp)).join('');
      } else if (cel === 'medico') {
        busca = buscaBox('Digite o nome do médico');
        const selMed = _vgSel(st.medicoNome);
        corpo = item('', 'Todos os médicos', !selMed.length) +
                topoMarcados(meds.map(m => m.nome), st.medicoNome)
                  .map(n => item(n, exibirNome(n), _vgMarc(st.medicoNome, n), true)).join('');
        rodape = `
          <div class="vg-sb-rodape">
            <span id="vg-sb-conta">${selMed.length ? `${selMed.length} selecionado${selMed.length === 1 ? '' : 's'} · ` : ''}${meds.length} médico${meds.length === 1 ? '' : 's'} cadastrado${meds.length === 1 ? '' : 's'}</span>
            <span class="vg-sb-dica">↑↓ navega · Enter seleciona</span>
          </div>`;
      } else if (cel === 'modulo') {
        busca = buscaBox('Buscar módulo');
        corpo = item('TODOS', 'Consolidado (todos)', !_vgSel(st.modulo).length) +
                topoMarcados(mods, st.modulo).map(c => item(c, c, _vgMarc(st.modulo, c))).join('');
      } else {
        busca = buscaBox('Buscar convênio');
        corpo = item('', 'Todos os convênios', !_vgSel(st.convenio).length) +
                topoMarcados(convs, st.convenio).map(c => item(c, c, _vgMarc(st.convenio, c))).join('');
      }
      return `
        <div class="vg-sb-painel" data-painel="${cel}">
          ${busca}
          <div class="vg-sb-lista" id="vg-sb-lista">${corpo}<div class="vg-sb-vazio" style="display:none">Nenhum resultado.</div></div>
          ${rodape}
        </div>`;
    };

    const cel = (id, icone, rotulo, valor, ativo, flex) => {
      const aberto = uiSB.aberto === id;
      return `
      <div class="vg-sb-celwrap" style="flex:${flex}">
        <button class="vg-sb-cel ${aberto ? 'aberto' : ''} ${ativo ? 'ativo' : ''}" data-vgsb-cel="${id}" role="combobox" aria-expanded="${aberto}">
          <span class="vg-sb-tile">${_sbSvg(SB_IC[icone], 15, 2.1)}</span>
          <span class="vg-sb-txt"><span class="vg-sb-rot">${rotulo}</span><span class="vg-sb-val">${esc(valor)}</span></span>
          <span class="vg-sb-chev">${_sbSvg(SB_IC.chev, 11, 2.8)}</span>
        </button>
        ${painel(id)}
      </div>`;
    };

    const qtd = _sbQtdProcedimentos(st.comp);
    el.innerHTML = `
      <div class="vg-sb" id="vg-sb">
        ${cel('periodo', 'calendar', 'Período', fmtComp(st.comp), st.comp !== compPadrao, '1')}
        <div class="vg-sb-div"></div>
        ${cel('medico', 'userplus', 'Médico', _vgRot(st.medicoNome, 'Todos os médicos', exibirNome), _vgSel(st.medicoNome).length > 0, '1.6')}
        <div class="vg-sb-div"></div>
        ${cel('modulo', 'grid', 'Módulo ATLAS', _vgRot(st.modulo, 'Todos'), _vgSel(st.modulo).length > 0, '1.15')}<!-- V694: renome S.A.R → ATLAS -->
        <div class="vg-sb-div"></div>
        ${cel('convenio', 'card', 'Convênio', _vgRot(st.convenio, 'Todos'), _vgSel(st.convenio).length > 0, '1')}
        <div class="vg-sb-acao">
          ${temFiltro
            ? `<button class="vg-sb-btn" id="vg-f-limpar">${_sbSvg(SB_IC.x, 15, 2.5)} Limpar filtros</button>`
            : `<div class="vg-sb-conta-slot" title="Procedimentos (admissão + procedimento) do mês no QVIS">${qtd.toLocaleString('pt-BR')} procedimento${qtd === 1 ? '' : 's'}</div>`}
        </div>
      </div>`;

    if (uiSB.aberto) {   // V922: qualquer painel com busca restaura o texto digitado
      const inp = el.querySelector('#vg-sb-busca');
      if (inp) {
        inp.value = uiSB.busca;
        inp.focus();
        if (inp.value) try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (_) {}
        _sbFiltrarLista(el);
      }
    }

    // V521/V688: DELEGAÇÃO no container (#vg-filtros persiste entre re-renders)
    if (!el.__vgFiltrosDelegado) {
      el.__vgFiltrosDelegado = true;
      el.addEventListener('click', (e) => {
        // stopPropagation nos cliques tratados: o re-render troca o DOM no
        // meio do clique e o listener de "clique fora" (document) veria um
        // alvo destacado — fecharia o painel recém-aberto.
        const celBtn = e.target.closest && e.target.closest('[data-vgsb-cel]');
        if (celBtn) {
          e.stopPropagation();
          const id = celBtn.dataset.vgsbCel;
          uiSB.aberto = uiSB.aberto === id ? null : id;   // abre um, fecha o resto
          uiSB.busca = '';
          renderFiltros();
          return;
        }
        const x = e.target.closest && e.target.closest('#vg-sb-busca-x');
        if (x) { e.stopPropagation(); uiSB.busca = ''; const i = el.querySelector('#vg-sb-busca'); if (i) { i.value = ''; i.focus(); } _sbFiltrarLista(el); return; }
        const it = e.target.closest && e.target.closest('[data-vgsb-item]');
        if (it) { e.stopPropagation(); _sbEscolher(it.dataset.val); return; }
        if (e.target.closest && e.target.closest('#vg-f-limpar')) {
          e.stopPropagation();
          st.medicoNome = ''; st.modulo = 'TODOS'; st.convenio = ''; st.drillMedico = null;
          uiSB.aberto = null; uiSB.busca = '';
          renderTudo();
        }
      });
      el.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'vg-sb-busca') { uiSB.busca = e.target.value; _sbFiltrarLista(el); }
      });
      // teclado no DOCUMENT: com painel sem campo de busca (período/módulo/
      // convênio) o foco fica no body e o evento nunca passaria pela barra
      document.addEventListener('keydown', (e) => {
        if (!uiSB.aberto) return;
        if (!document.getElementById('vg-sb')) return;   // saiu da Visão Geral
        if (e.key === 'Escape') { uiSB.aberto = null; uiSB.busca = ''; renderFiltros(); return; }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
        const lista = el.querySelector('#vg-sb-lista');
        if (!lista) return;
        const vis = [...lista.querySelectorAll('[data-vgsb-item]')].filter(x => x.style.display !== 'none');
        if (!vis.length) return;
        e.preventDefault();
        let idx = vis.findIndex(x => x.classList.contains('hl'));
        if (e.key === 'Enter') {
          // sem destaque + busca digitada → Enter escolhe o 1º RESULTADO
          // (não o "Todos os médicos", que fica sempre visível no topo)
          let alvo = idx >= 0 ? vis[idx] : null;
          if (!alvo) {
            const q = _sbSemAcento(uiSB.busca).trim();
            alvo = (q && vis.find(v => !v.classList.contains('vg-sb-it-todos'))) || vis[0];
          }
          _sbEscolher(alvo.dataset.val); return;
        }
        if (idx >= 0) vis[idx].classList.remove('hl');
        idx = e.key === 'ArrowDown' ? Math.min(idx + 1, vis.length - 1) : Math.max(idx - 1, 0);
        vis[idx].classList.add('hl');
        vis[idx].scrollIntoView({ block: 'nearest' });
      });
      // clique fora fecha o painel (um listener só, no documento)
      document.addEventListener('click', (e) => {
        if (!uiSB.aberto) return;
        const barra = document.getElementById('vg-sb');
        if (barra && !barra.contains(e.target)) { uiSB.aberto = null; uiSB.busca = ''; renderFiltros(); }
      });
    }
  }

  function _sbEscolher(val) {
    const cel = uiSB.aberto;
    if (cel === 'periodo') {   // período segue escolha ÚNICA (define o mês)
      uiSB.aberto = null; uiSB.busca = '';
      st.comp = val; st.drillMedico = null;
      renderTudo();
      return;
    }
    // V922: médico/módulo/convênio → o clique TOGGLA o item (união) e o painel
    // FICA ABERTO pra marcar mais; "Todos" limpa. A busca digitada sobrevive
    // (uiSB.busca é restaurada no re-render de renderFiltros).
    const FM = Utilidades.filtroMulti;
    if (cel === 'medico') {
      st.medicoNome = (!val) ? [] : FM.toggle(_vgSel(st.medicoNome), val);
      st.drillMedico = null;
    } else if (cel === 'modulo') {
      st.modulo = (!val || val === 'TODOS') ? [] : FM.toggle(_vgSel(st.modulo), val);
    } else if (cel === 'convenio') {
      st.convenio = (!val) ? [] : FM.toggle(_vgSel(st.convenio), val);
      st.drillMedico = null;
    }
    renderTudo();
  }

  // filtra a lista NO DOM (sem re-render — o input não pode perder o foco);
  // busca sem acento e sem caixa: "fabiola" encontra "Fabíola"
  function _sbFiltrarLista(el) {
    const lista = el.querySelector('#vg-sb-lista');
    if (!lista) return;
    const q = _sbSemAcento(uiSB.busca).trim();
    const x = el.querySelector('#vg-sb-busca-x');
    if (x) x.style.display = q ? '' : 'none';
    let vis = 0, total = 0;
    lista.querySelectorAll('[data-vgsb-item]').forEach(it => {
      it.classList.remove('hl');
      const todos = it.classList.contains('vg-sb-it-todos');
      if (!todos) total++;
      // "Todos" e os MARCADOS ficam sempre visíveis (V922)
      const mostra = todos || it.classList.contains('sel') || !q || it.dataset.busca.indexOf(q) >= 0;
      it.style.display = mostra ? '' : 'none';
      if (mostra && !todos) vis++;
    });
    const vazio = lista.querySelector('.vg-sb-vazio');
    if (vazio) vazio.style.display = vis === 0 && q ? '' : 'none';
    const conta = el.querySelector('#vg-sb-conta');
    if (conta) conta.textContent = q
      ? `${vis} de ${total} médico${total === 1 ? '' : 's'}`
      : `${total} médico${total === 1 ? '' : 's'} cadastrado${total === 1 ? '' : 's'}`;
  }

  // ── CARDS ───────────────────────────────────────────────────────────────
  // V531: exporta o relatório de GLOSA em Excel — QVIS em sua naturalidade
  // (todos os papéis, sem remoção de duplicidade), PRODUZIDO do QVIS e a REGRA
  // DE REPASSE por papel (motor do Calcular). Respeita os filtros do card.
  async function exportarGlosa(btn) {
    if (typeof ExcelJS === 'undefined') {
      U.toast?.('Biblioteca ExcelJS não carregada. Recarregue a página (Ctrl+Shift+R).', 'error', 4500);
      return;
    }
    const f = { medicoNome: st.medicoNome, modulo: st.modulo, convenio: st.convenio || '' };
    if (btn) btn.classList.add('carregando');
    try {
      await U.aguardarPintura();
      const linhas = D.glosaNatural(st.comp, f) || [];
      if (!linhas.length) { U.toast?.('Nada para exportar na glosa deste mês.', 'error', 3500); return; }
      // ordena p/ leitura: admissão, procedimento, produzido desc (executante
      // primeiro), papel — mantém cada procedimento agrupado com seus papéis
      linhas.sort((a, b) =>
        String(a.admissao).localeCompare(String(b.admissao), 'pt-BR', { numeric: true }) ||
        String(a.procedimento).localeCompare(String(b.procedimento), 'pt-BR') ||
        (Number(b.produzido) - Number(a.produzido)) ||
        String(a.papel).localeCompare(String(b.papel), 'pt-BR'));

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(`Glosa ${st.comp}`, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = [
        { header: 'ADMISSAO', key: 'adm', width: 16 },
        { header: 'PROCEDIMENTO', key: 'proc', width: 44 },
        { header: 'CONVÊNIO', key: 'conv', width: 22 },
        { header: 'PAPEL', key: 'papel', width: 18 },
        { header: 'PROFISSIONAL', key: 'nome', width: 32 },
        { header: 'PRODUZIDO', key: 'prod', width: 15 },
        { header: 'REGRA REPASSE', key: 'regra', width: 16 },
      ];
      // V532: estiliza SÓ as células do título (não a linha inteira) — evita a
      // faixa colorida vazar pelas colunas vazias até o fim do relatório
      const head = ws.getRow(1);
      for (let c = 1; c <= ws.columns.length; c++) {
        const cell = head.getCell(c);
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9B3A3A' } };
        cell.alignment = { vertical: 'middle' };
      }
      for (const l of linhas) {
        const row = ws.addRow({
          adm: l.admissao || '', proc: l.procedimento || '', conv: l.convenio || '',
          papel: l.papel || '', nome: l.nome || '',
          prod: Number(l.produzido) || 0, regra: Number(l.regraRepasse) || 0,
        });
        row.getCell('prod').numFmt = 'R$ #,##0.00';
        row.getCell('regra').numFmt = 'R$ #,##0.00';
      }
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      a.href = url;
      a.download = `relatorio_glosa_${st.comp}_${ts}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      U.toast?.(`✓ ${linhas.length} linhas de glosa exportadas.`, 'success', 4000);
    } catch (e) {
      console.error('[VG] exportarGlosa:', e);
      U.toast?.('Erro ao gerar Excel: ' + (e.message || e), 'error', 4500);
    } finally {
      if (btn) btn.classList.remove('carregando');
    }
  }

  function renderCards() {
    const f = { medicoNome: st.medicoNome, modulo: st.modulo, convenio: st.convenio || '' };   // V521
    const fProd = { medicoNome: st.medicoNome, convenio: st.convenio || '' };   // produção: médico + convênio + mês (ignora módulo)
    const lm = D.mesAnterior(st.comp), ly = D.anoAnterior(st.comp);

    // Produção (QVIS — Conv+Part, por mês de pagamento, deduplicada) — independente do módulo
    const prodObj = D.qvisProducao(st.comp, fProd);
    const prod = prodObj.total;
    const prodLM = D.qvisProducao(lm, fProd).total, prodLY = D.qvisProducao(ly, fProd).total;
    const vProdLM = D.variacao(prod, prodLM), vProdLY = D.variacao(prod, prodLY);

    // Repasse (por pagamento) — mês atual respeita filtros; LM/LY usam total
    // rápido do snapshot (comparativo do total geral, sem auditar 2 meses extras)
    const repObj = D.repasseConsolidado(st.comp, f);
    const rep = repObj.total;
    const semFiltro = !_vgSel(st.medicoNome).length && !_vgSel(st.modulo).length && !_vgSel(st.convenio).length;   // V521/V922
    const repLM = semFiltro ? D.repasseTotalRapido(lm) : D.repasseConsolidado(lm, f).total;
    const repLY = semFiltro ? D.repasseTotalRapido(ly) : D.repasseConsolidado(ly, f).total;
    const vRepLM = D.variacao(rep, repLM), vRepLY = D.variacao(rep, repLY);

    // V534: PERF — pinta os cards JÁ com a parte barata da glosa (contagens +
    // produção glosada); o REPASSE PERDIDO (motor, ~400ms) vem em 2º plano e só
    // o card de glosa é repintado, sem travar a troca de filtro.
    const g = D.glosaResumo(st.comp, f, { pularPerda: true });

    document.getElementById('vg-cards').innerHTML = `
      <div class="aic-grid vg-cards-grid">
        ${cardProducao(prod, prodObj, vProdLM, vProdLY)}
        ${cardRepasse(rep, repObj.fatias, vRepLM, vRepLY, prod)}
        ${cardGlosa(g)}
      </div>`;

    // 2º plano: calcula a perda (motor), repinta o card de glosa e preenche os
    // KPIs LM/LY/YTD (V538). Sempre roda (mesmo com perda em cache) pra os KPIs.
    const ger = (window.__vgGlosaGen = (window.__vgGlosaGen || 0) + 1);
    (async () => {
      await U.aguardarPintura();
      let gFull;
      try { gFull = D.glosaResumo(st.comp, f); } catch (_) { return; }
      if (ger !== window.__vgGlosaGen) return;   // filtro/tela mudou no meio
      const grid = document.getElementById('vg-cards');
      const antigo = grid && grid.querySelector('.vg-aic-glosa');
      if (antigo) {
        const tmp = document.createElement('div');
        tmp.innerHTML = cardGlosa(gFull);
        if (tmp.firstElementChild) antigo.replaceWith(tmp.firstElementChild);
      }
      await preencherKpisGlosa(f, gFull, ger);
    })();
  }

  // V538: preenche os KPIs LM/LY/YTD do card de glosa (Prod. Glosada + Repasse
  // Perdido). Cada mês passa pelo motor (cacheado); cede a thread entre eles.
  async function preencherKpisGlosa(f, gFull, ger) {
    const comp = st.comp;
    const set = (k, html) => {
      const e = document.querySelector(`#vg-cards .vg-aic-glosa [data-kpi="${k}"]`);
      if (e) e.innerHTML = html;
    };
    // V868: a coluna da esquerda compara pela régua ATIVA (100% ou FATO)
    const vlrDe = (o) => (glosaVisao() === 'FATO' ? (o.glosaFato || 0) : (o.producaoGlosada || 0));
    const prodA = vlrDe(gFull), perdA = gFull.perdaEstimada || 0;
    const disp = _compsComDados();
    const lmC = D.mesAnterior(comp), lyC = D.anoAnterior(comp);
    // LM (só se o mês anterior tiver dados importados)
    await U.aguardarPintura(); if (ger !== window.__vgGlosaGen) return;
    if (disp.has(lmC)) {
      const lm = D.glosaResumo(lmC, f);
      set('prod-lm', _kpiVarHtml(_kpiVar(prodA, vlrDe(lm))));
      set('rep-lm', _kpiVarHtml(_kpiVar(perdA, lm.perdaEstimada || 0)));
    } else { set('prod-lm', _KPI_NIL); set('rep-lm', _KPI_NIL); }
    // LY (só se o mesmo mês do ano anterior tiver dados importados)
    await U.aguardarPintura(); if (ger !== window.__vgGlosaGen) return;
    if (disp.has(lyC)) {
      const ly = D.glosaResumo(lyC, f);
      set('prod-ly', _kpiVarHtml(_kpiVar(prodA, vlrDe(ly))));
      set('rep-ly', _kpiVarHtml(_kpiVar(perdA, ly.perdaEstimada || 0)));
    } else { set('prod-ly', _KPI_NIL); set('rep-ly', _KPI_NIL); }
    // YTD (acumulado do ano até o mês)
    let ytdProd = 0, ytdPerd = 0;
    for (const m of mesesDoAnoAte(comp)) {
      await U.aguardarPintura(); if (ger !== window.__vgGlosaGen) return;
      const gm = D.glosaResumo(m, f);
      ytdProd += vlrDe(gm);
      ytdPerd += gm.perdaEstimada || 0;
    }
    set('prod-ytd', _kpiYtdHtml(ytdProd));
    set('rep-ytd', _kpiYtdHtml(ytdPerd));
  }

  function cardComp(label, valor, vLM, vLY) {
    const meta = `${badgeVar('vs LM', vLM)} ${badgeVar('vs LY', vLY)}`;
    return U.cardKPI(label, U.formatarMoeda(valor), meta, '', 'vg-aic');
  }

  // card de Produção (QVIS): total + comparativos + 3 fatias (Conv/Part/SUS)
  function cardProducao(total, fatias, vLM, vLY) {
    const tot = total || 1;
    const fatia = (lbl, val) => {
      const pct = (val / tot) * 100;
      return `<div class="vg-fatia">
        <span class="vg-fatia-lbl">${lbl}</span>
        <span class="vg-fatia-val">${U.formatarMoeda(val)}</span>
        <span class="vg-fatia-pct">${pct.toFixed(1).replace('.', ',')}%</span>
      </div>`;
    };
    const meta = `
      <div class="vg-rep-comp">${badgeVar('vs LM', vLM, 'vg-var-lm')} ${badgeVar('vs LY', vLY)}</div>
      <div class="vg-fatias">
        ${fatia('Convênio', fatias.CONVENIO)}
        ${fatia('Particular', fatias.PARTICULAR)}
        ${fatia('SUS', fatias.SUS)}
      </div>`;
    // V920: título renomeado a pedido do usuário
    return U.cardKPI('Produção total - Recebido' + infoBtn('vg-card-producao'), U.formatarMoeda(total), meta, '', 'vg-aic vg-aic-repasse');
  }

  // card de Repasse: total + comparativos + 4 fatias (Conv/Part/SUS/Desempenho)
  // V921: recebe também a PRODUÇÃO RECEBIDA do mesmo recorte — o card mostra
  // Repasse ÷ Produção total - Recebido como % (distante do valor, entre parênteses)
  function cardRepasse(total, fatias, vLM, vLY, prodRecebida) {
    const tot = total || 1;
    const fatia = (lbl, val) => {
      const pct = (val / tot) * 100;
      return `<div class="vg-fatia">
        <span class="vg-fatia-lbl">${lbl}</span>
        <span class="vg-fatia-val">${U.formatarMoeda(val)}</span>
        <span class="vg-fatia-pct">${pct.toFixed(1).replace('.', ',')}%</span>
      </div>`;
    };
    const meta = `
      <div class="vg-rep-comp">${badgeVar('vs LM', vLM, 'vg-var-lm')} ${badgeVar('vs LY', vLY)}</div>
      <div class="vg-fatias">
        ${fatia('Convênio', fatias.CONVENIO)}
        ${fatia('Particular', fatias.PARTICULAR)}
        ${fatia('SUS', fatias.SUS)}
        ${fatia('Desempenho', fatias.DESEMPENHO)}
      </div>`;
    const pctProd = (prodRecebida > 0)
      ? `<span class="vg-rep-pct-prod" title="Repasse Total ÷ Produção total - Recebido">(${
          ((total / prodRecebida) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)</span>`
      : '';
    return U.cardKPI('Repasse Total' + infoBtn('vg-card-repasse'), `${U.formatarMoeda(total)}${pctProd}`, meta, '', 'vg-aic vg-aic-repasse');
  }

  // V518: layout definido pelo usuário — título PROD. TOTAL GLOSADA com o
  // valor da produção sem recebido + % GLOSA PERDIDA (glosada ÷ produção
  // total do mês) junto ao valor; embaixo TOTAL PROCEDIMENTOS e
  // GLOSA — REPASSE PERDIDO (motor completo, V517). Sem textos descritivos.
  // V868: qual régua de glosa está ativa no card ('100' | 'FATO')
  function glosaVisao() { return st.glosaVisao === 'FATO' ? 'FATO' : '100'; }
  /** Chave que alterna as duas réguas — o próprio rótulo do bloco é o botão. */
  function swVisaoHtml() {
    const v = glosaVisao();
    const bt = (chave, rotulo, dica) =>
      `<button type="button" class="vg-glosa-sw${v === chave ? ' vg-glosa-sw-on' : ''}"
               data-vg-glosa-visao="${chave}" data-no-hub title="${dica}"
               aria-pressed="${v === chave}">${rotulo}</button>`;
    return `<span class="vg-glosa-sw-grupo" role="group" aria-label="Como medir a glosa">
      ${bt('100', '100%', 'GLOSA 100% — só o que não recebeu nada (recebido zerado)')}
      ${bt('FATO', 'FATO', 'GLOSA FATO — produzido menos recebido, linha a linha (inclui o pago pela metade)')}
    </span>`;
  }

  // V528: divisão vertical no padrão do card Glosas do OPME — dois blocos
  // uniformes lado a lado: PROD. TOTAL GLOSADA | REPASSE TOTAL GLOSADO.
  function cardGlosa(g) {
    let prodTotalMes = 0;
    try {
      // V521: com filtro de convênio, a PRODUÇÃO TOTAL do % também é filtrada
      prodTotalMes = _vgSel(st.convenio).length
        ? (D.producaoTotal(st.comp, { convenio: st.convenio }) || 0)
        : ((typeof producaoDoMes === 'function') ? (producaoDoMes(st.comp).total || 0) : 0);
    } catch (_) {}
    // V921: % entre PARÊNTESES e mais afastada do valor (pedido do usuário)
    const fmtPctG = (num) => (prodTotalMes > 0 && num != null)
      ? ` <span class="vg-glosa-pct">(${((num / prodTotalMes) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)</span>`
      : '';
    // V519: REPASSE PERDIDO no MESMO formato do destaque — valor + % sobre a
    // PRODUÇÃO TOTAL do mês (mesma fórmula do % da PROD. TOTAL GLOSADA)
    const temPerda = g.perdaEstimada != null && !g.semCalculoPerda;
    const perdaHtml = temPerda
      ? `${U.formatarMoeda(g.perdaEstimada)}${fmtPctG(g.perdaEstimada)}`
      : (g.perdaCalculando ? `<span class="vg-cmp-calc">calculando…</span>` : '—');   // V534
    // V528: dois blocos com separador vertical (padrão card Glosas do OPME)
    // V590: grid com linhas compartilhadas (rótulos numa linha, valores na
    // outra) — o REPASSE TOTAL GLOSADO fica alinhado com a PROD. TOTAL
    // GLOSADA mesmo quando um rótulo quebra em 2 linhas e o outro não.
    /**
     * V868: DUAS VISÕES da glosa, alternadas por um botão.
     *
     *  · GLOSA 100% — a régua de sempre: produzido das linhas que não
     *    receberam NADA (recebido zerado).
     *  · GLOSA FATO — produzido MENOS recebido, linha a linha. Enxerga também o
     *    procedimento pago pela metade, que a régua anterior deixava passar
     *    inteiro. Contém a glosa 100% (recebido 0 → a diferença é o produzido).
     *
     * O REPASSE TOTAL GLOSADO à direita segue medindo só as glosas 100%: o
     * motor calcula o repasse de um procedimento inteiro, e numa glosa parcial
     * não há como saber que fatia se perdeu sem uma regra nova.
     */
    const ehFato = glosaVisao() === 'FATO';
    const vlrGlosa = ehFato ? (g.glosaFato || 0) : (g.producaoGlosada || 0);
    const valor = `
      <div class="vg-glosa-dupla">
        <div class="vg-glosa-rot">${ehFato ? 'GLOSA FATO' : 'GLOSA 100%'}</div>
        <div class="vg-glosa-sep"></div>
        <div class="vg-glosa-rot">REPASSE TOTAL GLOSADO</div>
        <div class="vg-glosa-vlr">${U.formatarMoeda(vlrGlosa)}${fmtPctG(vlrGlosa)}</div>
        <div class="vg-glosa-vlr">${perdaHtml}</div>
      </div>`;
    // V538: KPIs LM/LY/YTD abaixo da divisória — 2 colunas (Prod. Glosada |
    // Repasse Perdido), 3 linhas (LM/LY/YTD). Preenchidos em 2º plano (motor).
    const L = `<span class="vg-cmp-calc">…</span>`;
    const kpiGrid = `
      <div class="vg-glosa-kpis">
        <div class="vg-glosa-kpi-row"><span class="vg-glosa-kpi-lbl">vs LM</span><span class="vg-glosa-kpi-v" data-kpi="prod-lm">${L}</span><span class="vg-glosa-kpi-v" data-kpi="rep-lm">${L}</span></div>
        <div class="vg-glosa-kpi-row"><span class="vg-glosa-kpi-lbl">vs LY</span><span class="vg-glosa-kpi-v" data-kpi="prod-ly">${L}</span><span class="vg-glosa-kpi-v" data-kpi="rep-ly">${L}</span></div>
        <div class="vg-glosa-kpi-row"><span class="vg-glosa-kpi-lbl">YTD</span><span class="vg-glosa-kpi-v" data-kpi="prod-ytd">${L}</span><span class="vg-glosa-kpi-v" data-kpi="rep-ytd">${L}</span></div>
      </div>`;
    // V531: botão slim de export (relatório de glosa em Excel) no canto inferior
    // V868: a contagem acompanha a régua ativa
    const qtdProcs = ehFato ? (g.qtdProcedimentosFato || 0) : (g.qtdProcedimentos || 0);
    const meta = `${kpiGrid}
      <div class="vg-glosa-metabot">
        <span>TOTAL PROCEDIMENTOS: <b>${qtdProcs}</b></span>
        <button type="button" class="vg-glosa-export" data-vg-glosa-export data-no-hub
                title="Exportar relatório de glosa (Excel) — QVIS natural, todos os papéis"><i class="ti ti-file-spreadsheet"></i></button>
      </div>`;
    // V869: o seletor fica no canto superior DIREITO, na linha do título
    return U.cardKPI(`<span>GLOSAS${infoBtn('vg-card-glosa')}</span>${swVisaoHtml()}`, valor, meta, 'glosa', 'vg-aic vg-aic-glosa');
  }

  // V714: extraCls marca o "vs LM" dos cards Produção/Repasse Total (#15a34a)
  /**
   * V863: o RÓTULO sai do alcance da cor do indicador.
   *
   * O badge inteiro era um <span> só, e a regra de cor (.vg-var.comp-up, com
   * !important) pintava tudo — "vs LM" ficava verde junto com o percentual.
   * Ao lado, os indicadores dos outros cards já mostravam o rótulo em cinza e
   * só o valor colorido; eram dois layouts para a mesma informação.
   * Agora o rótulo é um <span> próprio, sempre em #5A7180 (--ink-faint, o mesmo
   * cinza dos outros cards), e a variação de cor fica só no valor.
   */
  function badgeVar(rotulo, v, extraCls) {
    const lbl = `<span class="vg-var-lbl">${rotulo}:</span>`;
    if (!v) return `<span class="vg-var vg-var-nil">${lbl} —</span>`;
    const up = v.pct >= 0;
    const cls = up ? 'comp-up' : 'comp-down';
    const seta = up ? '↑' : '↓';
    const pct = Math.abs(v.pct).toFixed(1).replace('.', ',');
    return `<span class="vg-var ${cls}${extraCls ? ' ' + extraCls : ''}">${lbl} ${seta} ${pct}%</span>`;
  }

  // ── EVOLUÇÃO DO REPASSE (barras) ────────────────────────────────────────
  // V537: segue a MESMA lógica/fonte do Comparativo mês a mês — o repasse é o
  // dos cards do comparativo (chip Ambos/QVIS/Desempenho) — e mostra só os meses
  // de UM ANO (seletor; padrão = ano da competência atual). Global (sem filtro
  // médico/convênio), igual ao comparativo. O cálculo pesado por mês (cacheado)
  // roda em 2º plano, cedendo a thread, pra não travar.
  function renderEvolucao() {
    const el = document.getElementById('vg-evolucao');
    if (!el) return;
    const todasComps = (D.competenciasDisponiveis ? D.competenciasDisponiveis() : []) || [];
    const anos = [...new Set(todasComps.map(c => String(c).slice(0, 4)))].filter(Boolean).sort().reverse();
    if (!anos.length) { el.innerHTML = ''; el.dataset.vgEvoSig = ''; return; }
    if (st.cmpFiltro === undefined) st.cmpFiltro = 'ambos';
    // V653: o card nasce COM o SANTO incluído — mesma composição do relatório
    // extraído da Produção Médica (que soma o SANTO Anestesia no consolidado
    // e no "% sobre PROD"). O botão "+ SANTO" continua lá pra ver sem.
    if (st.cmpSanto === undefined) st.cmpSanto = true;
    if (!st.evoAno || !anos.includes(st.evoAno)) {
      const anoComp = st.comp ? String(st.comp).slice(0, 4) : null;
      st.evoAno = (anoComp && anos.includes(anoComp)) ? anoComp : anos[0];
    }
    // assinatura: versão | chip do comparativo | ano | período (p/ o destaque).
    // Não depende de médico/convênio → não re-renderiza à toa nas trocas de filtro.
    const sig = `${Banco._versao || 0}|${st.cmpFiltro}|${st.evoAno}|${st.comp}`;
    if (el.dataset.vgEvoSig === sig && el.querySelector('.vg-chart')) return;
    el.dataset.vgEvoSig = sig;

    const meses = todasComps.filter(c => String(c).slice(0, 4) === st.evoAno).sort();
    const anoSel = `<select id="vg-evo-ano" class="vg-evo-ano" data-no-hub>${
      anos.map(a => `<option value="${a}" ${a === st.evoAno ? 'selected' : ''}>${a}</option>`).join('')}</select>`;

    // casca imediata (título + seletor de ano) e área do gráfico "calculando…"
    el.innerHTML = `
      <section class="vg-bloco vg-evolucao-bloco">
        <div class="vg-bloco-titulo vg-evo-head">
          <span>Evolução do Repasse <span>· ${repasseModoLabel()} · ${st.evoAno}</span>${infoBtn('vg-evolucao')}</span>
          <label class="vg-evo-ano-lbl">Ano ${anoSel}</label>
        </div>
        <div class="vg-chart-wrap" id="vg-evo-chart">
          <div class="vg-cmp-calc" style="padding:40px 0;text-align:center">calculando…</div>
        </div>
      </section>`;

    const sel = el.querySelector('#vg-evo-ano');
    if (sel) sel.addEventListener('change', () => { st.evoAno = sel.value; renderEvolucao(); });

    if (!meses.length) {
      const wrap = el.querySelector('#vg-evo-chart');
      if (wrap) wrap.innerHTML = `<div class="vg-vazio">Sem repasse em ${st.evoAno}.</div>`;
      return;
    }

    // calcula o repasse de cada mês (pesado, cacheado) cedendo a thread; depois
    // desenha o gráfico de uma vez (o max depende de todos os meses).
    const ger = (window.__vgEvoGen = (window.__vgEvoGen || 0) + 1);
    (async () => {
      const serie = [];
      for (const comp of meses) {
        serie.push({ comp, total: repasseComparativoMes(comp) });
        await U.aguardarPintura();
        if (ger !== window.__vgEvoGen || el.dataset.vgEvoSig !== sig) return;   // mudou no meio
      }
      const wrap = el.querySelector('#vg-evo-chart');
      if (!wrap) return;
      const max = Math.max(...serie.map(s => s.total), 1);
      // V548: proporção mais "alta" — no layout 50/50 o gráfico preenche o card
      // (antes 980×320 ficava achatado numa faixa fina no rodapé)
      const W = 760, H = 520, padL = 62, padB = 46, padT = 26, padR = 16;
      const innerW = W - padL - padR, innerH = H - padT - padB;
      const n = Math.max(serie.length, 1), gap = 14;
      const slot = (innerW - gap * (n - 1)) / n;   // largura do "compartimento" de cada mês
      const bw = slot * 0.62;                        // V544: barra mais fina (era o slot inteiro)
      const barras = serie.map((s, i) => {
        const h = (s.total / max) * innerH;
        const cx = padL + i * (slot + gap) + slot / 2;   // centro do mês (rótulos usam)
        const x = cx - bw / 2;                            // barra centralizada, mais estreita
        const y = padT + innerH - h;
        const atual = s.comp === st.comp;
        return `
          <g class="vg-bar-g" data-comp="${s.comp}">
            <rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h, 1)}" rx="5"
                  class="vg-bar ${atual ? 'vg-bar-atual' : ''}"></rect>
            <text x="${cx}" y="${y - 7}" class="vg-bar-val">${valorCurto(s.total)}</text>
            <text x="${cx}" y="${H - padB + 22}" class="vg-bar-lbl">${fmtCompCurto(s.comp)}</text>
          </g>`;
      }).join('');
      const grades = [0, 0.25, 0.5, 0.75, 1].map(p => {
        const y = padT + innerH - p * innerH;
        return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="vg-grid"></line>
                <text x="${padL - 8}" y="${y + 4}" class="vg-grid-lbl">${valorCurto(max * p)}</text>`;
      }).join('');
      wrap.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" class="vg-chart" preserveAspectRatio="xMidYMid meet">
          ${grades}${barras}
        </svg>`;
      wrap.querySelectorAll('.vg-bar-g').forEach(g => {
        g.style.cursor = 'pointer';
        g.onclick = () => { st.comp = g.dataset.comp; st.drillMedico = null; renderTudo(); };
      });
    })();
  }

  // ── RANKINGS: ilha "Top 10 por Repasse" + ilha "Performance médica" ─────
  // V545: duas ilhas lado a lado (design). Esquerda = Top 10 por repasse (barra
  // proporcional). Direita = Performance médica: barra EMPILHADA do produzido
  // (QVIS) = repasse de fato + glosa + retenções (produzido − glosa − repasse).
  function renderRankings() {
    const f = { medicoNome: st.medicoNome, modulo: st.modulo, convenio: st.convenio || '' };   // V521
    const rep = D.repasseConsolidado(st.comp, f);
    const des = D.desempenhoMedicos(st.comp, f);   // Map<nome, {produzido, glosa}>
    const desByNorm = new Map();
    for (const [nome, d] of des) desByNorm.set(_normStVG(nome), d);

    // universo = médicos com repasse; junta produzido/glosa/repasse por nome
    // V546: repasse da ilha = SÓ do Calcular Repasse (sem Desempenho)
    const medicos = [...rep.porMedico.entries()].map(([nome, repasseTotal]) => {
      const d = desByNorm.get(_normStVG(nome)) || { produzido: 0, glosa: 0, repasse: 0 };
      return {
        nome,
        repasse: repasseTotal,                 // ranking do Top 10 (consolidado completo)
        produzido: d.produzido || 0,
        glosa: d.glosa || 0,
        repasseQvis: d.repasse || 0,           // barra verde da Performance médica
      };
    });
    const top10 = medicos.slice().sort((a, b) => b.repasse - a.repasse).slice(0, 10);
    const totalRep = top10.reduce((s, m) => s + m.repasse, 0) || 1;
    const maxRep = top10.length ? top10[0].repasse : 1;
    // V580: performance = TODOS os médicos elegíveis (não só o top 10),
    // ordenados por produzido; a lista rola verticalmente na altura do Top 10
    const perf = medicos.slice().sort((a, b) => b.produzido - a.produzido);
    const totalProd = perf.reduce((s, m) => s + m.produzido, 0);
    const maxProd = perf.length ? Math.max(...perf.map(m => m.produzido), 1) : 1;

    const pctBR = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
    const rMoeda = v => 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR');

    // ── Ilha 1: Top 10 por Repasse (barra proporcional) ──────────────────
    const rowTop = (m, i) => `
      <div class="vg-il-row" data-medico="${esc(m.nome)}">
        <div class="vg-il-pos vg-il-pos-rank">${i + 1}</div>
        <div class="vg-il-body">
          <div class="vg-il-top"><span class="vg-il-nome" title="${esc(exibirNome(m.nome))}">${esc(exibirNome(m.nome))}</span><span class="vg-il-val vg-il-val-rep">${rMoeda(m.repasse)}</span></div>
          <div class="vg-il-trilho"><div class="vg-il-fill" style="width:${(m.repasse / maxRep) * 100}%"></div></div>
          <div class="vg-il-meta"><span class="vg-il-meta-fraco">${pctBR((m.repasse / totalRep) * 100)} do total</span></div>
        </div>
      </div>`;

    // ── Ilha 2: Performance médica (3 barras) ────────────────────────────
    // V546: PRODUZIDO (azul, regra do card Produção Total) · GLOSA (vermelho,
    // regra do card de glosa) · REPASSE (verde, só Calcular Repasse — sem
    // Desempenho). Como o produzido JÁ CONTÉM a glosa, os três não são uma
    // decomposição: a barra é escalada pela SOMA das três medidas, pra que as
    // três fiquem sempre visíveis e comparáveis entre médicos.
    const somaTri = m => (m.produzido || 0) + (m.glosa || 0) + (m.repasseQvis || 0);
    const maxTri = Math.max(...perf.map(somaTri), 1);
    const rowPerf = (m, i) => {
      const tri = somaTri(m) || 1;
      const wCont = (tri / maxTri) * 100;
      const wPro = (m.produzido / tri) * 100, wGlo = (m.glosa / tri) * 100, wRep = (m.repasseQvis / tri) * 100;
      const p = m.produzido || 1;
      const gloPct = pctBR((m.glosa / p) * 100), repPct = pctBR((m.repasseQvis / p) * 100);
      return `
        <div class="vg-il-row" data-medico="${esc(m.nome)}">
          <div class="vg-il-pos vg-il-pos-neutra">${i + 1}</div>
          <div class="vg-il-body">
            <div class="vg-il-top"><span class="vg-il-nome" title="${esc(exibirNome(m.nome))}">${esc(exibirNome(m.nome))}</span><span class="vg-il-val">${rMoeda(m.produzido)}</span></div>
            <div class="vg-il-stack" style="width:${wCont}%">
              <div class="vg-il-seg vg-il-seg-pro" style="width:${wPro}%"></div>
              <div class="vg-il-seg vg-il-seg-glo" style="width:${wGlo}%"></div>
              <div class="vg-il-seg vg-il-seg-rep" style="width:${wRep}%"></div>
            </div>
            <div class="vg-il-meta vg-il-meta-perf">
              <span><b class="vg-il-c-pro">${rMoeda(m.produzido)}</b> <span class="vg-il-cmp-pro">produzido</span></span>
              <span><b class="vg-il-c-glo">${rMoeda(m.glosa)}</b> <span class="vg-il-cmp-glo">glosa · ${gloPct}</span></span>
              <span><b class="vg-il-c-rep">${rMoeda(m.repasseQvis)}</b> <span class="vg-il-cmp-rep">repasse · ${repPct}</span></span>
            </div>
          </div>
        </div>`;
    };

    const vazio = `<div class="vg-vazio">Sem repasse no período.</div>`;
    document.getElementById('vg-rankings').innerHTML = `
      <div class="vg-ilhas-2col">
        <section class="vg-il-card">
          <div class="vg-il-head">
            <div><div class="vg-il-titulo">Top 10 Médicos por Repasse${infoBtn('vg-top10')}</div><div class="vg-il-sub">Repasse (Gerencial) · ${fmtCompCurto(st.comp)}</div></div>
            <div class="vg-il-tot"><span class="vg-il-tot-lbl">Top 10</span><span class="vg-il-tot-val">${rMoeda(totalRep)}</span></div>
          </div>
          <div class="vg-il-lista">${top10.length ? top10.map(rowTop).join('') : vazio}</div>
        </section>
        <section class="vg-il-card">
          <div class="vg-il-head">
            <div><div class="vg-il-titulo">Performance médica${infoBtn('vg-performance')}</div><div class="vg-il-sub">Produzido (QVIS) · glosa · repasse do Calcular Repasse</div></div>
            <div class="vg-il-tot"><span class="vg-il-tot-lbl">Produzido</span><span class="vg-il-tot-val">${rMoeda(totalProd)}</span></div>
          </div>
          <div class="vg-il-legenda">
            <span><span class="vg-il-mk vg-il-mk-pro"></span>Produzido</span>
            <span><span class="vg-il-mk vg-il-mk-glo"></span>Glosa</span>
            <span><span class="vg-il-mk vg-il-mk-rep"></span>Repasse</span>
            <span class="vg-il-leg-obs">${perf.length} médico${perf.length !== 1 ? 's' : ''} elegíve${perf.length !== 1 ? 'is' : 'l'}</span>
          </div>
          <div class="vg-il-lista vg-il-lista-perf" id="vg-il-lista-perf">${perf.length ? perf.map(rowPerf).join('') : vazio}</div>
        </section>
      </div>
      ${st.drillMedico ? renderDrill(st.drillMedico) : ''}`;

    // V580/V585: a lista da Performance rola verticalmente e o CARD inteiro
    // fica com a MESMA altura do card do Top 10 (desconta cabeçalho/legenda).
    try {
      const cardTop = document.querySelector('#vg-rankings .vg-il-card:first-child');
      const cardPerf = document.querySelectorAll('#vg-rankings .vg-il-card')[1];
      const listaPerf = document.getElementById('vg-il-lista-perf');
      if (cardTop && cardPerf && listaPerf && top10.length) {
        // (altura do card − altura da lista) = cabeçalho + legenda + paddings
        const cromo = cardPerf.offsetHeight - listaPerf.offsetHeight;
        listaPerf.style.maxHeight = Math.max(200, cardTop.offsetHeight - cromo) + 'px';
        listaPerf.style.overflowY = 'auto';
        cardPerf.style.minHeight = cardTop.offsetHeight + 'px';   // lista curta → iguala mesmo assim
        cardPerf.style.boxSizing = 'border-box';
      }
    } catch (_) {}

    document.querySelectorAll('#vg-rankings .vg-il-row[data-medico]').forEach(row => {
      row.style.cursor = 'pointer';
      row.onclick = () => { st.drillMedico = row.dataset.medico; renderRankings(); document.getElementById('vg-drill')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
    });
  }

  // ── V931: TABELA POR CATEGORIA (QVIS → produção) — sem gráfico ────────
  // Categoria | Produzido (QVIS) | Recebido (QVIS) | Glosa | Repasse,
  // com TOTAL e ⇩ extração. Regras no VGExec.categoriasQvis.
  // V935: filtro congelado — a sentinela (1px antes da barra) sai do viewport
  // exatamente quando a barra prende no topo; aí a barra ganha .vg-preso.
  var _ioFiltro = null;   // var (hoisted): o 1º render roda antes desta linha ser alcançada no arquivo
  function _observarFiltroPreso() {
    const sent = document.getElementById('vg-filtros-sentinela');
    const barra = document.getElementById('vg-filtros');
    if (!sent || !barra) return;
    if (_ioFiltro) { try { _ioFiltro.disconnect(); } catch (_) {} _ioFiltro = null; }
    if (typeof IntersectionObserver === 'undefined') return;
    _ioFiltro = new IntersectionObserver(([e]) => {
      const preso = !e.isIntersecting && e.boundingClientRect.top < 0;
      barra.classList.toggle('vg-preso', preso);
    }, { threshold: 0 });
    _ioFiltro.observe(sent);
  }

  const _espAbertas = new Set();   // V934: categorias com o drilldown aberto (sobrevive ao re-render)
  function renderCategorias() {
    const host = document.getElementById('vg-especialidades');
    if (!host) return;
    // V953: a glosa da matriz segue a régua ativa do card GLOSAS (100% / FATO)
    // V955: modo "repasse glosado" — clique na coluna Glosa: a coluna Repasse
    // passa a mostrar quanto DEIXOU de ser repassado por causa da glosa (mesma
    // lógica do REPASSE TOTAL GLOSADO do card), em vermelho. Clique de novo volta.
    const modoPerda = !!st.espPerda;
    const f = { medicoNome: st.medicoNome, convenio: st.convenio || '', glosaVisao: glosaVisao(), perda: modoPerda };
    const d = D.categoriasQvis(st.comp, f);
    const rotGlosa = d.regua === '100' ? 'Glosa 100%' : 'Glosa Fato';
    const rotRep = modoPerda ? 'Repasse glosado' : 'Repasse';
    const moeda = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pct = (v, t) => t > 0 ? ((v / t) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—';
    const T = d.total;
    // V934: drilldown Categoria › Subcategoria — clique na categoria abre/fecha
    // as subcategorias (mesmas colunas; % da sub é sobre a categoria-mãe)
    const celulas = (l, base) => `
        <td class="num">${moeda(l.produzido)}<span class="vg-esp-pct">${pct(l.produzido, base.produzido)}</span></td>
        <td class="num">${moeda(l.recebido)}</td>
        <td class="num vg-esp-td-glosa ${l.glosa > 0 ? 'vg-esp-glosa' : ''}" data-vg-esp-perda title="${modoPerda ? 'Clique para voltar ao repasse' : 'Clique: a coluna Repasse mostra quanto deixou de ser repassado por causa da glosa'}">${moeda(l.glosa)}<span class="vg-esp-pct">${pct(l.glosa, l.produzido)}</span></td>
        ${modoPerda
          ? `<td class="num vg-esp-perdido">${moeda(l.perdido)}<span class="vg-esp-pct">${pct(l.perdido, l.glosa)}</span></td>`
          : `<td class="num vg-esp-rep">${moeda(l.repasse)}<span class="vg-esp-pct">${pct(l.repasse, l.recebido)}</span></td>`}`;
    const linha = (l) => {
      const subs = l.subs || [];
      const temSubs = subs.length > 0;
      const aberta = temSubs && _espAbertas.has(l.categoria);
      return `
      <tr class="vg-esp-cat ${temSubs ? 'vg-esp-cat-dd' : ''} ${aberta ? 'vg-esp-aberta' : ''}" data-cat="${esc(l.categoria)}" ${temSubs ? 'title="Clique para ver as subcategorias"' : ''}>
        <td class="vg-esp-nome"><span class="vg-esp-seta">${temSubs ? (aberta ? '▾' : '▸') : ''}</span>${esc(l.categoria)}<span class="vg-esp-adm">${l.nAdm} adm.${temSubs ? ` · ${subs.length} subcategoria${subs.length === 1 ? '' : 's'}` : ''}</span></td>
        ${celulas(l, T)}
      </tr>
      ${subs.map(s => `
      <tr class="vg-esp-sub" data-cat="${esc(l.categoria)}" ${aberta ? '' : 'hidden'}>
        <td class="vg-esp-nome vg-esp-subnome">${esc(s.subcategoria)}<span class="vg-esp-adm">${s.nAdm} adm.</span></td>
        ${celulas(s, l)}
      </tr>`).join('')}`;
    };
    host.innerHTML = `
      <section class="vg-il-card vg-esp-card">
        <div class="vg-il-head">
          <div><div class="vg-il-titulo">Produção por categoria${infoBtn('vg-categorias')}</div>
            <div class="vg-il-sub">QVIS de ${fmtCompCurto(st.comp)} · a admissão busca a categoria na Produção · clique na categoria para abrir as subcategorias · glosa = a mesma do card GLOSAS (${esc(rotGlosa)}: executante, sem Particular) · ${modoPerda
            ? '<b>Repasse glosado</b> = quanto deixou de ser repassado por causa da glosa (mesma lógica do REPASSE TOTAL GLOSADO do card) · clique na Glosa para voltar ao repasse'
            : 'repasse = Consolidado das admissões do QVIS · clique na Glosa para ver o repasse glosado'}</div></div>
          <div class="vg-esp-acoes">
            <div class="vg-il-tot"><span class="vg-il-tot-lbl">Admissões</span><span class="vg-il-tot-val">${T.nAdm.toLocaleString('pt-BR')}</span></div>
            <button type="button" class="vg-esp-export" id="vg-esp-export" data-no-hub title="Extrair esta tabela em Excel">⇩ Extrair</button>
          </div>
        </div>
        ${d.linhas.length ? `
        <div class="vg-esp-wrap">
          <table class="vg-esp-tab" id="vg-esp-tab">
            <thead><tr>
              <th>Categoria</th><th class="num">Produzido</th><th class="num">Recebido</th><!-- V956: sem o "(QVIS)" -->
              <th class="num vg-esp-th-glosa vg-esp-th-clicavel ${modoPerda ? 'vg-esp-th-on' : ''}" data-vg-esp-perda
                  title="${modoPerda ? 'Clique para voltar ao repasse' : 'Clique: a coluna Repasse mostra quanto deixou de ser repassado por causa da glosa (mesma lógica do REPASSE TOTAL GLOSADO do card)'}">Glosa
                <span class="vg-esp-sw-grupo" role="group" aria-label="Régua da glosa"><!-- V954: a chave 100%/FATO na própria coluna (ligada à do card) -->
                  <button type="button" class="vg-esp-sw${d.regua === '100' ? ' vg-esp-sw-on' : ''}" data-vg-esp-glosa="100" data-no-hub aria-pressed="${d.regua === '100'}" title="GLOSA 100% — só o que não recebeu nada (recebido zerado)">100%</button>
                  <button type="button" class="vg-esp-sw${d.regua === 'FATO' ? ' vg-esp-sw-on' : ''}" data-vg-esp-glosa="FATO" data-no-hub aria-pressed="${d.regua === 'FATO'}" title="GLOSA FATO — produzido menos recebido, linha a linha (inclui o pago pela metade)">FATO</button>
                </span></th><th class="num ${modoPerda ? 'vg-esp-th-perdido' : ''}">${rotRep}</th>
            </tr></thead>
            <tbody>${d.linhas.map(linha).join('')}</tbody>
            <tfoot><tr>
              <td>TOTAL</td><td class="num">${moeda(T.produzido)}</td><td class="num">${moeda(T.recebido)}</td>
              <td class="num">${moeda(T.glosa)}<span class="vg-esp-pct">${pct(T.glosa, T.produzido)}</span></td>
              ${modoPerda
                ? `<td class="num vg-esp-perdido">${moeda(T.perdido)}<span class="vg-esp-pct">${pct(T.perdido, T.glosa)}</span></td>`
                : `<td class="num vg-esp-rep">${moeda(T.repasse)}<span class="vg-esp-pct">${pct(T.repasse, T.recebido)}</span></td>`}<!-- V963: total do repasse em #107DAC -->
            </tr></tfoot>
          </table>
        </div>
        ${d.semCategoria ? `<div class="vg-esp-nota">⚠ ${d.semCategoria} admiss${d.semCategoria === 1 ? 'ão' : 'ões'} do QVIS sem categoria: a admissão não está na produção importada (mês anterior não importado?) ou a coluna CATEGORIA veio vazia no relatório — reimporte a produção com a coluna preenchida (↻ Atualizar).</div>` : ''}` : `<div class="vg-vazio">Sem QVIS no período.</div>`}
      </section>`;
    U.aplicarMascaraValores?.();
    // V954: chave 100%/FATO no cabeçalho da coluna — é a MESMA régua do card
    // GLOSAS (uma régua só no dashboard: card e matriz nunca divergem)
    host.querySelectorAll('[data-vg-esp-glosa]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const nova = b.getAttribute('data-vg-esp-glosa');
        if (nova === glosaVisao()) return;
        st.glosaVisao = nova;
        renderCards();
        renderCategorias();
      };
    });
    // V955: clique na coluna Glosa (cabeçalho ou célula) alterna o modo
    // "repasse glosado" na coluna Repasse (não abre/fecha o drilldown)
    host.querySelectorAll('[data-vg-esp-perda]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('[data-vg-esp-glosa]')) return;   // a chave 100%/FATO tem o próprio clique
        e.stopPropagation();
        st.espPerda = !st.espPerda;
        renderCategorias();
      });
    });
    // V934: clique na categoria abre/fecha as subcategorias
    host.querySelectorAll('.vg-esp-cat-dd').forEach(tr => {
      tr.onclick = () => {
        const cat = tr.dataset.cat;
        const abrir = !_espAbertas.has(cat);
        if (abrir) _espAbertas.add(cat); else _espAbertas.delete(cat);
        tr.classList.toggle('vg-esp-aberta', abrir);
        const seta = tr.querySelector('.vg-esp-seta'); if (seta) seta.textContent = abrir ? '▾' : '▸';
        host.querySelectorAll('.vg-esp-sub').forEach(s => { if (s.dataset.cat === cat) s.hidden = !abrir; });
      };
    });
    const btn = document.getElementById('vg-esp-export');
    if (btn) btn.onclick = async () => {
      if (typeof ExcelJS === 'undefined') { U.toast?.('Biblioteca ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4000); return; }
      try {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'ATLAS — Repasse Médico';
        const ws = wb.addWorksheet('Categorias', { views: [{ state: 'frozen', ySplit: 1 }] });
        const FMT = U.FMT_EXPORT_MOEDA;
        ws.columns = [
          { header: 'CATEGORIA', key: 'esp', width: 30 },
          { header: 'SUBCATEGORIA', key: 'sub', width: 30 },   // V934
          { header: 'ADMISSÕES', key: 'adm', width: 12 },
          { header: 'PRODUZIDO', key: 'produzido', width: 18, style: { numFmt: FMT } },   // V956: sem "(QVIS)"
          { header: 'RECEBIDO', key: 'recebido', width: 18, style: { numFmt: FMT } },
          { header: rotGlosa.toUpperCase(), key: 'glosa', width: 16, style: { numFmt: FMT } },   // V953: régua do card
          { header: 'REPASSE', key: 'repasse', width: 16, style: { numFmt: FMT } },
          ...(modoPerda ? [{ header: 'REPASSE GLOSADO', key: 'perdido', width: 18, style: { numFmt: FMT } }] : []),   // V955
        ];
        const h = ws.getRow(1); h.height = 22;
        h.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF107DAC' } }; c.alignment = { vertical: 'middle', horizontal: 'center' }; });
        // V934: linha da categoria (negrito) seguida das suas subcategorias
        for (const l of d.linhas) {
          const rc = ws.addRow({ esp: String(l.categoria).toUpperCase(), sub: '', adm: l.nAdm, produzido: l.produzido, recebido: l.recebido, glosa: l.glosa, repasse: l.repasse, perdido: l.perdido });
          rc.font = { bold: true };
          for (const s of (l.subs || [])) ws.addRow({ esp: String(l.categoria).toUpperCase(), sub: String(s.subcategoria).toUpperCase(), adm: s.nAdm, produzido: s.produzido, recebido: s.recebido, glosa: s.glosa, repasse: s.repasse, perdido: s.perdido });
        }
        const t = ws.addRow({ esp: 'TOTAL', sub: '', adm: T.nAdm, produzido: T.produzido, recebido: T.recebido, glosa: T.glosa, repasse: T.repasse, perdido: T.perdido });
        t.font = { bold: true };
        const buffer = await wb.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `Categorias_${st.comp}.xlsx`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        U.toast?.(`✓ ${d.linhas.length} categoria(s) extraída(s)`, 'success');
      } catch (e) { console.error(e); U.toast?.('Erro na extração: ' + e.message, 'error', 4000); }
    };
  }

  // ── V574: DESEMPENHO × REPASSE por médico (abaixo dos Top 10) ───────────
  // Esteira horizontal: uma coluna por médico elegível (barra empilhada —
  // Desempenho em azul, Repasse do Calcular Repasse em ciano), com filtro
  // para exibir um único médico. Mesma fonte do consolidado do período.
  function renderDesempRep() {
    const host = document.getElementById('vg-desemprep');
    if (!host) return;
    const f = { medicoNome: st.medicoNome, modulo: st.modulo, convenio: st.convenio || '' };
    const mapa = D.desempRepasseMedicos ? D.desempRepasseMedicos(st.comp, f) : new Map();
    const todos = [...mapa.values()]
      .filter(m => (m.desempenho + m.repasse) > 0)
      .sort((a, b) => (b.desempenho + b.repasse) - (a.desempenho + a.repasse));
    const rMoeda = v => 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR');
    if (!todos.length) {
      host.innerHTML = `
        <section class="vg-dr-card">
          <div class="vg-dr-head"><div><div class="vg-dr-titulo">Desempenho × Repasse por médico${infoBtn('vg-desemprep')}</div><div class="vg-dr-sub">${fmtCompCurto(st.comp)}</div></div></div>
          <div class="vg-vazio">Sem repasse no período.</div>
        </section>`;
      return;
    }
    const sel = st.drMedico && todos.some(m => m.nome === st.drMedico) ? st.drMedico : '';
    const exibidos = sel ? todos.filter(m => m.nome === sel) : todos;

    // V577.1 (handoff 8A — "volume"): barras agrupadas com degradê vertical,
    // brilho na aresta esquerda e sombra projetada colorida; eixo Y fixo fora
    // do scroll; diferença (repasse − desempenho) em PÍLULA sob cada médico.
    const H = 220;                                     // altura do plot (handoff)
    const maior = Math.max(...exibidos.map(m => Math.max(m.desempenho, m.repasse)), 1);
    const alvo = (maior * 1.08) / 4;
    const pow = Math.pow(10, Math.floor(Math.log10(alvo || 1)));
    const step = [1, 2, 5, 10].map(k => k * pow).find(s => s >= alvo) || 10 * pow;
    const topo = step * 4;
    const hDe = (v) => Math.max(v > 0 ? 4 : 0, Math.round((v / topo) * H));
    // V583: sem rótulos no eixo Y (pedido) — ficam só as gridlines
    const gridLins = [4, 3, 2, 1].map(i =>
      `<div class="vg-dr-gridln" style="bottom: ${Math.round((i / 4) * H)}px"></div>`).join('')
      + `<div class="vg-dr-gridln vg-dr-eixolinha" style="bottom: 0"></div>`;
    const col = (m) => {
      // V579: pílula = % que o DESEMPENHO representa do total do repasse
      // (desempenho + repasse) do médico
      const total = m.desempenho + m.repasse;
      const pct = total > 0 ? (m.desempenho / total) * 100 : 0;
      const pctTxt = pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
      const difHtml = `<span class="vg-dr-pill vg-dr-pill-pct" title="O Desempenho representa ${pctTxt} do total (Desempenho + Repasse)">${pctTxt} desempenho</span>`;
      return `
        <div class="vg-dr-grupo" title="${esc(exibirNome(m.nome))}
Desempenho: ${rMoeda(m.desempenho)}
Repasse (Calcular Repasse): ${rMoeda(m.repasse)}
Desempenho no total: ${pctTxt}">
          <div class="vg-dr-barras" style="height: ${H}px">
            <div class="vg-dr-barra-wrap">
              <div class="vg-dr-val vg-dr-val-des">${rMoeda(m.desempenho)}</div>
              <div class="vg-dr-bar vg-dr-bar-des" style="height: ${hDe(m.desempenho)}px"><i class="vg-dr-glow vg-dr-glow-des"></i></div>
            </div>
            <div class="vg-dr-barra-wrap">
              <div class="vg-dr-val vg-dr-val-rep">${rMoeda(m.repasse)}</div>
              <div class="vg-dr-bar vg-dr-bar-rep" style="height: ${hDe(m.repasse)}px"><i class="vg-dr-glow vg-dr-glow-rep"></i></div>
            </div>
          </div>
          <div class="vg-dr-foot">
            <div class="vg-dr-nome">${esc(exibirNome(m.nome))}</div>
            ${difHtml}
          </div>
        </div>`;
    };
    const totalDes = exibidos.reduce((s, m) => s + m.desempenho, 0);
    const totalRep = exibidos.reduce((s, m) => s + m.repasse, 0);
    host.innerHTML = `
      <section class="vg-dr-card">
        <div class="vg-dr-head">
          <div>
            <div class="vg-dr-titulo">Desempenho × Repasse por médico${infoBtn('vg-desemprep')}</div>
            <div class="vg-dr-sub">${todos.length} médico${todos.length !== 1 ? 's' : ''} elegíve${todos.length !== 1 ? 'is' : 'l'} para repasse · ${fmtCompCurto(st.comp)}</div>
          </div>
          <select id="vg-dr-med" class="input" style="width: 240px; flex: none" title="Filtrar um único médico">
            <option value="">Todos os médicos</option>
            ${todos.map(m => `<option value="${esc(m.nome)}" ${m.nome === sel ? 'selected' : ''}>${esc(exibirNome(m.nome))}</option>`).join('')}
          </select>
        </div>
        <div class="vg-dr-leg">
          <span><i class="vg-dr-sw vg-dr-sw-des"></i>Desempenho <b>${rMoeda(totalDes)}</b></span>
          <span><i class="vg-dr-sw vg-dr-sw-rep"></i>Repasse (Calcular Repasse) <b>${rMoeda(totalRep)}</b></span>
        </div>
        <div class="vg-dr-plot">
          <div class="vg-dr-scroller">
            <div class="vg-dr-trilha">
              <div class="vg-dr-gridlayer" style="height: ${H}px">${gridLins}</div>
              <div class="vg-dr-grupos ${exibidos.length === 1 ? 'vg-dr-grupos-um' : ''}">${exibidos.map(col).join('')}</div>
            </div>
          </div>
        </div>
      </section>`;
    const selEl = host.querySelector('#vg-dr-med');
    if (selEl) selEl.addEventListener('change', () => { st.drMedico = selEl.value; renderDesempRep(); });
  }

  // V541/V543: gráfico combo "Glosa do mês × perda do médico" (design 2B) —
  // últimas 12 competências; barra externa = produção glosada, interna = repasse
  // perdido, linha = tendência M/M. Cada mês passa pelo motor (cacheado) → async.
  // Fica ao lado da Evolução; chamado na sequência de montagem (não no rankings,
  // pra não recalcular a cada clique de drill).
  async function renderGlosaChart() {
    const host = document.getElementById('vg-glosa-chart');
    if (!host) return;
    const f = { medicoNome: st.medicoNome, modulo: st.modulo, convenio: st.convenio || '' };
    const ger = (window.__vgGcGen = (window.__vgGcGen || 0) + 1);
    const todas = (D.competenciasDisponiveis ? D.competenciasDisponiveis() : []).slice().sort();
    const meses = todas.slice(-12);
    if (!meses.length) {
      host.innerHTML = `<div class="vg-gc-titulo">Glosa do mês × perda do médico${infoBtn('vg-glosa-chart')}</div><div class="vg-vazio">Sem competências com dados.</div>`;
      return;
    }
    const serie = [];
    for (const m of meses) {
      await U.aguardarPintura(); if (ger !== window.__vgGcGen) return;
      const g = D.glosaResumo(m, f);
      serie.push({ comp: m, prodGlosada: g.producaoGlosada || 0, naoRecebido: g.perdaEstimada || 0 });
    }
    if (ger !== window.__vgGcGen) return;
    host.innerHTML = glosaChartHtml(serie);
    const scroller = host.querySelector('.vg-gc-scroller');
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;   // abre na competência mais recente
  }

  // monta o HTML do gráfico 2B (geometria fiel ao handoff do Claude Design)
  function glosaChartHtml(serie) {
    const PH = 300, colW = 88, gap = 30, pitch = colW + gap;   // passo 118
    const brl = v => 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR');
    const pctf = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
    const maxSerie = Math.max(...serie.map(s => s.prodGlosada), 1);
    let step = Math.ceil((maxSerie * 1.05) / 4 / 10000) * 10000;
    if (step <= 0) step = 10000;
    const max = step * 4;
    const bars = serie.map((s, i) => {
      const hPx = Math.round((s.prodGlosada / max) * PH);
      const pPx = Math.round((s.naoRecebido / max) * PH);
      const cx = 44 + i * pitch, dotY = PH - hPx;
      let momLabel = '—', momColor = '#b6c0c9';
      if (i > 0) {
        const prev = serie[i - 1].prodGlosada;
        if (prev > 0) {
          const v = (s.prodGlosada - prev) / prev * 100;
          momLabel = (v > 0 ? '↑ ' : '↓ ') + pctf(Math.abs(v));
          momColor = v > 0 ? '#c03a3a' : '#15a34a';   // glosa SOBE = vermelho, CAI = verde
        }
      }
      const pct = s.prodGlosada > 0 ? pctf(s.naoRecebido / s.prodGlosada * 100) : '—';
      // V687/V689: rótulos NUNCA se sobrepõem — total e % M/M ficam SEMPRE
      // empilhados acima da barra (flex, um embaixo do outro); o valor perdido
      // fica acima da barra interna e, quando o vão é curto (< 48px, não cabe),
      // sobe pra MESMA pilha. Nada de posição fixa dentro da barra.
      const acima = (hPx - pPx) < 48;
      return { hPx, pPx, cx, dotY, momLabel, momColor, pct, acima, total: brl(s.prodGlosada), perdido: brl(s.naoRecebido), label: fmtCompCurto(s.comp) };
    });
    const trackW = serie.length * colW + (serie.length - 1) * gap;
    const trendPoints = bars.map(b => b.cx + ',' + b.dotY).join(' ');
    const ticks = [4, 3, 2, 1, 0].map(k => ({
      bottom: Math.round((step * k / max) * PH),
      label: k === 0 ? '0' : ((step * k) / 1000).toLocaleString('pt-BR') + ' mil',
    }));
    const sumG = serie.reduce((a, s) => a + s.prodGlosada, 0);
    const sumP = serie.reduce((a, s) => a + s.naoRecebido, 0);
    const totalGlosada = brl(sumG), totalPerdido = brl(sumP);
    const mediaPct = sumG > 0 ? pctf(sumP / sumG * 100) : '—';

    return `
      <div class="vg-gc-head">
        <div>
          <div class="vg-gc-titulo">Glosa do mês × perda do médico${infoBtn('vg-glosa-chart')}</div>
          <div class="vg-gc-sub">Produção glosada e o que o médico deixou de receber · ${serie.length} competências</div>
        </div>
      </div>
      <div class="vg-gc-chips">
        <div class="vg-gc-chip"><span class="vg-gc-chip-lbl">Glosado</span><span class="vg-gc-chip-val">${totalGlosada}</span></div>
        <div class="vg-gc-chip vg-gc-chip-red"><span class="vg-gc-chip-lbl">Não recebido</span><span class="vg-gc-chip-val">${totalPerdido}</span></div>
        <div class="vg-gc-chip"><span class="vg-gc-chip-lbl">Média</span><span class="vg-gc-chip-val">${mediaPct}</span></div>
      </div>
      <div class="vg-gc-legenda">
        <span><span class="vg-gc-mk" style="width:22px;height:11px;background:#e9f1f7;border-radius:3px"></span>Prod. glosada</span>
        <span><span class="vg-gc-mk" style="width:11px;height:11px;background:#e0483f;border-radius:3px"></span>Não recebido</span>
        <span><span class="vg-gc-mk" style="width:22px;height:2px;background:#1c7fb0"></span>Tendência (% M/M)</span>
      </div>
      <div class="vg-gc-plot">
        <div class="vg-gc-yaxis">
          ${ticks.map(t => `<div class="vg-gc-tick" style="bottom:${t.bottom}px">${t.label}</div>`).join('')}
        </div>
        <div class="vg-gc-scroller">
          <div class="vg-gc-track">
            <div class="vg-gc-grid">
              ${ticks.map(t => `<div class="vg-gc-gline" style="bottom:${t.bottom}px"></div>`).join('')}
            </div>
            <div class="vg-gc-cols">
              <svg width="${trackW}" height="${PH}" class="vg-gc-svg">
                <polyline points="${trendPoints}" fill="none" stroke="#1c7fb0" stroke-width="2" stroke-linejoin="round" stroke-opacity="0.85"></polyline>
                ${bars.map(b => `<circle cx="${b.cx}" cy="${b.dotY}" r="4.5" fill="#fff" stroke="#1c7fb0" stroke-width="2"></circle>`).join('')}
              </svg>
              ${bars.map(b => `
                <div class="vg-gc-col">
                  <div class="vg-gc-barext" style="height:${b.hPx}px">
                    <div class="vg-gc-sobre"><!-- V689: total + M/M SEMPRE empilhados acima da barra -->
                      <div class="vg-gc-total">${b.total}</div>
                      <div class="vg-gc-mom" style="color:${b.momColor}">${b.momLabel}</div>
                      ${b.acima ? `<div class="vg-gc-perdido"><span class="vg-gc-perd-val">${b.perdido}</span><span class="vg-gc-perd-pct">${b.pct}</span></div>` : ''}
                    </div>
                    <div class="vg-gc-barint" style="height:${b.pPx}px">
                      ${b.acima ? '' : `<div class="vg-gc-perdido"><span class="vg-gc-perd-val">${b.perdido}</span><span class="vg-gc-perd-pct">${b.pct}</span></div>`}
                    </div>
                  </div>
                </div>`).join('')}
            </div>
            <div class="vg-gc-meses">
              ${bars.map(b => `<div class="vg-gc-mes">${b.label}</div>`).join('')}
            </div>
          </div>
        </div>
      </div>
      <div class="vg-gc-foot">Arraste para o lado para ver as demais competências →</div>`;
  }

  /**
   * ══ V872: EVOLUÇÃO DA GLOSA FATO ══════════════════════════════════════════
   *
   * Terceiro gráfico do dashboard, em LARGURA TOTAL abaixo da dupla "Evolução
   * do Repasse" × "Glosa do mês". Mostra a GLOSA FATO (V868 — produzido menos
   * recebido, linha a linha, que inclui o pago pela metade) mês a mês, no ano
   * escolhido.
   *
   * O eixo traz os DOZE meses do ano, como pedido. Mês sem competência na base
   * NÃO vira ponto zero: zero diria "não houve glosa", quando o que houve foi
   * ausência de dado. Ele aparece no eixo, apagado, e a linha simplesmente
   * pula por cima — nada de degrau falso até o chão.
   *
   * Paleta e tipografia são as que já existem: o vermelho da perda (#e0483f /
   * #c03a3a, do "não recebido" do gráfico ao lado), o azul da tendência
   * (#1c7fb0, o mesmo do 2B), a grade e os rótulos da Evolução do Repasse
   * (.vg-grid / .vg-grid-lbl / .vg-bar-lbl) e a casca do cartão 2B.
   */
  async function renderGlosaFatoChart() {
    const host = document.getElementById('vg-glosafato-chart');
    if (!host) return;
    const todas = (D.competenciasDisponiveis ? D.competenciasDisponiveis() : []) || [];
    const anos = [...new Set(todas.map(c => String(c).slice(0, 4)))].filter(Boolean).sort().reverse();
    if (!anos.length) {
      host.innerHTML = `<div class="vg-gc-titulo">Evolução da Glosa Fato${infoBtn('vg-glosafato')}</div>`
        + `<div class="vg-vazio">Sem competências com dados.</div>`;
      return;
    }
    // ano próprio, com o MESMO padrão do seletor da Evolução do Repasse
    if (!st.gfAno || !anos.includes(st.gfAno)) {
      const anoComp = st.comp ? String(st.comp).slice(0, 4) : null;
      st.gfAno = (anoComp && anos.includes(anoComp)) ? anoComp : anos[0];
    }
    const ano = st.gfAno;
    const f = { medicoNome: st.medicoNome, modulo: st.modulo, convenio: st.convenio || '' };
    const ger = (window.__vgGfGen = (window.__vgGfGen || 0) + 1);

    const anoSel = `<select id="vg-gf-ano" class="vg-evo-ano" data-no-hub>${
      anos.map(a => `<option value="${a}" ${a === ano ? 'selected' : ''}>${a}</option>`).join('')}</select>`;
    const casca = (miolo) => `
      <div class="vg-gc-head">
        <div>
          <div class="vg-gc-titulo">Evolução da Glosa Fato${infoBtn('vg-glosafato')}</div>
          <div class="vg-gc-sub">Produzido − recebido, mês a mês · ${ano}</div>
        </div>
        <label class="vg-evo-ano-lbl">Ano ${anoSel}</label>
      </div>
      ${miolo}`;
    const ligarSeletor = () => {
      const sel = host.querySelector('#vg-gf-ano');
      if (sel) sel.addEventListener('change', () => { st.gfAno = sel.value; renderGlosaFatoChart(); });
    };
    host.innerHTML = casca(`<div class="vg-gc-loading"><span class="vg-cmp-calc">calculando…</span></div>`);
    ligarSeletor();

    // um ponto por mês do ano; só os meses COM competência entram na conta
    const doAno = new Set(todas.filter(c => String(c).slice(0, 4) === ano));
    const serie = [];
    for (let m = 1; m <= 12; m++) {
      const comp = `${ano}-${String(m).padStart(2, '0')}`;
      if (!doAno.has(comp)) { serie.push({ comp, valor: null }); continue; }
      await U.aguardarPintura();
      if (ger !== window.__vgGfGen) return;
      const g = D.glosaResumo(comp, f, { pularPerda: true });   // a perda não entra aqui
      serie.push({ comp, valor: Math.max(0, Number(g.glosaFato) || 0) });
    }
    if (ger !== window.__vgGfGen) return;
    host.innerHTML = casca(glosaFatoChartHtml(serie, ano));
    ligarSeletor();
  }

  /** SVG fluido (viewBox) da Evolução da Glosa Fato — linha + rótulos + tendência */
  function glosaFatoChartHtml(serie, ano) {
    const brl = v => 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR');
    const comDado = serie.filter(s => s.valor != null);
    if (!comDado.length) return `<div class="vg-vazio">Sem glosa apurada em ${ano}.</div>`;

    const W = 1200, H = 400, padL = 78, padR = 26, padT = 46, padB = 44;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const max = Math.max(...comDado.map(s => s.valor), 1);
    const passo = Math.max(1, Math.ceil(max * 1.08 / 4));
    const teto = passo * 4;
    // 12 meses = 11 vãos, com uma folga nas pontas: sem ela o rótulo de janeiro
    // (centrado no ponto) encostava nos números do eixo Y e o de dezembro na
    // borda direita do cartão
    const insetX = 30;
    const xDe = (i) => padL + insetX + ((innerW - insetX * 2) / 11) * i;
    const yDe = (v) => padT + innerH - (v / teto) * innerH;

    const grades = [0, 1, 2, 3, 4].map(k => {
      const y = yDe(passo * k);
      return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="vg-grid"></line>
              <text x="${padL - 10}" y="${y + 4}" class="vg-grid-lbl">${valorCurto(passo * k)}</text>`;
    }).join('');

    /**
     * A linha ATRAVESSA os meses sem competência, ligando um mês apurado ao
     * próximo. Não é o mesmo que traçar zero no meio: zero afirmaria "não
     * houve glosa"; atravessar só diz que entre uma medição e a outra não há
     * medição. (Quebrar a linha a cada buraco deixava meses isolados sem
     * linha nenhuma — o gráfico virava um punhado de pontos soltos.)
     */
    const medidos = serie.map((s, i) => ({ i, v: s.valor })).filter(p => p.v != null);
    const linha = medidos.length < 2 ? ''
      : `<polyline points="${medidos.map(p => `${xDe(p.i)},${yDe(p.v)}`).join(' ')}"
                   fill="none" stroke="#e0483f" stroke-width="2.5"
                   stroke-linejoin="round" stroke-linecap="round"></polyline>`;

    // tendência linear (mínimos quadrados) sobre os meses COM dado
    let tendencia = '';
    const pts = medidos;
    if (pts.length >= 2) {
      const n = pts.length;
      const sx = pts.reduce((a, p) => a + p.i, 0), sy = pts.reduce((a, p) => a + p.v, 0);
      const sxy = pts.reduce((a, p) => a + p.i * p.v, 0), sxx = pts.reduce((a, p) => a + p.i * p.i, 0);
      const den = n * sxx - sx * sx;
      if (den !== 0) {
        const b = (n * sxy - sx * sy) / den, a = (sy - b * sx) / n;
        const i0 = pts[0].i, i1 = pts[pts.length - 1].i;
        const clamp = (v) => Math.min(teto, Math.max(0, v));
        tendencia = `<line x1="${xDe(i0)}" y1="${yDe(clamp(a + b * i0))}"
                           x2="${xDe(i1)}" y2="${yDe(clamp(a + b * i1))}"
                           stroke="#1c7fb0" stroke-width="2" stroke-dasharray="7 5"
                           stroke-opacity=".85" stroke-linecap="round"></line>`;
      }
    }

    const pontos = serie.map((s, i) => {
      const x = xDe(i);
      const lbl = fmtCompCurto(s.comp);
      if (s.valor == null) {
        return `<text x="${x}" y="${H - padB + 22}" class="vg-bar-lbl vg-gf-lbl-vazio">${lbl}</text>`;
      }
      const y = yDe(s.valor);
      return `
        <g class="vg-gf-pt" data-comp="${s.comp}">
          <title>${fmtComp(s.comp)} — Glosa Fato ${brl(s.valor)}</title>
          <circle cx="${x}" cy="${y}" r="14" fill="transparent"></circle>
          <circle cx="${x}" cy="${y}" r="4.5" fill="#fff" stroke="#e0483f" stroke-width="2.5"></circle>
          <text x="${x}" y="${y - 13}" class="vg-gf-val">${valorCurto(s.valor)}</text>
          <text x="${x}" y="${H - padB + 22}" class="vg-bar-lbl">${lbl}</text>
        </g>`;
    }).join('');

    const soma = comDado.reduce((a, s) => a + s.valor, 0);
    const media = soma / comDado.length;
    const pico = comDado.reduce((a, s) => s.valor > a.valor ? s : a, comDado[0]);
    return `
      <div class="vg-gc-chips">
        <div class="vg-gc-chip vg-gc-chip-red"><span class="vg-gc-chip-lbl">Glosa Fato no ano</span><span class="vg-gc-chip-val">${brl(soma)}</span></div>
        <div class="vg-gc-chip"><span class="vg-gc-chip-lbl">Média mensal</span><span class="vg-gc-chip-val">${brl(media)}</span></div>
        <div class="vg-gc-chip"><span class="vg-gc-chip-lbl">Maior mês</span><span class="vg-gc-chip-val">${brl(pico.valor)} · ${fmtCompCurto(pico.comp)}</span></div>
        <div class="vg-gc-chip"><span class="vg-gc-chip-lbl">Meses apurados</span><span class="vg-gc-chip-val">${comDado.length} de 12</span></div>
      </div>
      <div class="vg-gc-legenda">
        <span><span class="vg-gc-mk" style="width:22px;height:2px;background:#e0483f"></span>Glosa Fato</span>
        <span><span class="vg-gc-mk vg-gf-mk-tend"></span>Tendência (linear)</span>
        <span class="vg-gf-nota">Mês sem competência na base fica de fora da linha (não é glosa zero)</span>
      </div>
      <div class="vg-gf-plot">
        <svg viewBox="0 0 ${W} ${H}" class="vg-gf-svg" preserveAspectRatio="xMidYMid meet">
          ${grades}${tendencia}${linha}${pontos}
        </svg>
      </div>`;
  }

  // ── DRILL-DOWN de um médico ─────────────────────────────────────────────
  function renderDrill(nome) {
    const f = { medicoNome: nome, modulo: st.modulo, convenio: st.convenio || '' };   // V521
    const fProd = { medicoNome: nome, convenio: st.convenio || '' };
    const prod = D.producaoTotal(st.comp, fProd);
    const tipos = D.producaoPorTipo(st.comp, fProd);
    const rep = D.repasseConsolidado(st.comp, f);
    const g = D.glosaResumo(st.comp, f, { pularPerda: true });   // V534: só contagens
    const porModulo = [...rep.porModulo.entries()].sort((a, b) => b[1] - a[1]);

    return `
      <section class="vg-bloco vg-drill" id="vg-drill">
        <div class="vg-bloco-titulo">Detalhe · ${esc(exibirNome(nome))}
          <button class="vg-drill-fechar" onclick="window.__vg.drillMedico=null; App.telas['dashboard']();">fechar ✕</button>
        </div>
        <div class="vg-drill-grid">
          <div class="vg-drill-card"><span>Produção (admissão)</span><b>${U.formatarMoeda(prod)}</b>
            <small>Conv ${U.formatarMoeda(tipos.CONVENIO)} · Part ${U.formatarMoeda(tipos.PARTICULAR)} · SUS ${U.formatarMoeda(tipos.SUS)}</small></div>
          <div class="vg-drill-card"><span>Repasse (pagamento)</span><b>${U.formatarMoeda(rep.total)}</b>
            <small>${porModulo.map(([k, v]) => `${k}: ${valorCurto(v)}`).join(' · ') || '—'}</small></div>
          <div class="vg-drill-card vg-drill-glosa"><span>Recebido zerado (QVIS)</span><b>${g.qtdProcedimentos}</b>
            <small>${g.qtdItens} ${g.qtdItens === 1 ? 'item' : 'itens'} · produção ${valorCurto(g.producaoGlosada)}</small></div>
        </div>
      </section>`;
  }

  // ── helpers locais ──────────────────────────────────────────────────────
  function fmtComp(c) {
    if (!c) return '—';
    const [a, m] = c.split('-').map(Number);
    const M = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${M[m - 1]}/${a}`;
  }
  function fmtCompCurto(c) {
    const [a, m] = c.split('-').map(Number);
    const M = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return `${M[m - 1]}/${String(a).slice(2)}`;
  }
  function valorCurto(v) {
    if (v == null || isNaN(v)) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + 'mi';
    if (abs >= 1e3) return (v / 1e3).toFixed(0) + 'k';
    return Math.round(v).toString();
  }
  function nomeCurto(n) {
    if (!n) return '—';
    const partes = n.trim().split(/\s+/);
    if (partes.length <= 2) return n;
    return `${partes[0]} ${partes[partes.length - 1]}`;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
};

// ════════════════════════════════════════════════════════════════════════
function injetarEstilosVG() {
  if (document.getElementById('vg-exec-estilos')) return;
  const s = document.createElement('style');
  s.id = 'vg-exec-estilos';
  s.textContent = `
    .vg-page { max-width: 1180px; }
    /* === V506: Comparativo mês a mês === */
    .vg-cmp-secao { margin: 0 0 18px; }
    .vg-cmp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .vg-cmp-chips { display: flex; gap: 6px; flex: 0 0 auto; }
    .vg-cmp-chip {
      border: 1px solid var(--border); background: var(--bg-elevated); color: var(--ink-soft);
      font: inherit; font-size: 11.5px; font-weight: 600; padding: 6px 12px; border-radius: 999px;
      cursor: pointer; transition: background-color 130ms, color 130ms, border-color 130ms;
    }
    .vg-cmp-chip:hover { border-color: #189AD3; color: #107DAC; }
    .vg-cmp-chip.on { background: #107DAC; border-color: #107DAC; color: #fff; }
    /* V518: % GLOSA PERDIDA ao lado do valor do card de glosa */
    /* V921: % das GLOSAS afastada do valor e entre parênteses.
       V922: MENOR (11px) e com folga reduzida pra caber SEMPRE na mesma linha
       do valor (pedido do usuário — pode diminuir o tamanho, não pode quebrar) */
    .vg-glosa-pct { font-size: 11px; font-weight: 800; color: #9B3A3A; vertical-align: middle; margin-left: 8px; }
    /* V921: % do REPASSE TOTAL ÷ Produção total - Recebido — distante do valor */
    .vg-rep-pct-prod {
      margin-left: 22px; font-size: 15px; font-weight: 800;
      color: var(--ink-soft); vertical-align: middle; letter-spacing: 0;
    }
    /* V528: card de glosa dividido verticalmente em dois blocos uniformes
       (padrão do card Glosas do OPME): PROD. TOTAL GLOSADA | REPASSE TOTAL GLOSADO */
    .vg-aic-glosa .aic-val { white-space: normal; overflow: visible; text-overflow: clip; }
    /* V590: grid 2 linhas × 2 colunas + separador — rótulos e valores dividem
       as mesmas linhas, então os dois blocos ficam sempre alinhados */
    .vg-glosa-dupla { display: grid; grid-template-columns: 1fr 1px 1fr; gap: 3px 12px;
      align-content: end; margin-top: 2px; }
    .vg-glosa-sep { grid-row: 1 / span 2; grid-column: 2; width: 1px; height: 100%;
      background: var(--border, #DEE3E1); }
    .vg-glosa-dupla .vg-glosa-rot { align-self: end; min-width: 0; }
    .vg-glosa-dupla .vg-glosa-vlr { align-self: start; min-width: 0; }
    .vg-glosa-rot { font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #9B3A3A; line-height: 1.3; }
    /* V692: 14px a pedido · V922: valor e % SEMPRE na mesma linha (sem quebrar) */
    .vg-glosa-vlr { font-size: 14px; font-weight: 800; color: #9B3A3A; line-height: 1.25; white-space: nowrap; }
    /* V868: o rótulo do bloco da esquerda É a chave que troca a régua da glosa.
       A opção ativa fica sólida; a outra, apagada — sem virar dois botões
       competindo com o número, que é o que o card mostra. */
    .vg-aic-glosa .aic-lbl { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .vg-glosa-sw-grupo { display: inline-flex; gap: 3px; flex: none; }
    /* V954: chave 100%/FATO no cabeçalho da coluna Glosa da matriz por categoria
       (sobre o degradê do cabeçalho: pílulas translúcidas, a ativa em branco) */
    .vg-esp-th-glosa { white-space: nowrap; }
    /* V955: menor (pílulas de 7.5px, altura ~13px) a pedido do usuário */
    .vg-esp-sw-grupo { display: inline-flex; gap: 2px; margin-left: 5px; vertical-align: middle; }
    .vg-esp-sw {
      border: 1px solid rgba(255,255,255,.55); background: rgba(255,255,255,.14); color: #FFF;
      /* (o atalho "font: … inherit" era inválido e caía no tamanho padrão do botão) */
      font-family: inherit; font-weight: 800; font-size: 7.5px; line-height: 1;
      letter-spacing: .04em; padding: 2px 5px; border-radius: 999px;
      cursor: pointer; text-transform: uppercase; transition: background-color .12s ease, color .12s ease;
    }
    .vg-esp-sw:hover { background: rgba(255,255,255,.28); }
    .vg-esp-sw-on { background: #FFF; color: #14456B; border-color: #FFF; }
    .vg-esp-sw:focus-visible { outline: 2px solid #FFF; outline-offset: 2px; }
    .vg-glosa-sw {
      font: inherit; font-size: 9.5px; font-weight: 800; letter-spacing: .04em;
      text-transform: uppercase; line-height: 1;
      padding: 3px 7px; border-radius: 999px; cursor: pointer;
      border: 1px solid transparent; background: transparent;
      color: #B98D8A; transition: background 120ms, color 120ms, border-color 120ms;
    }
    .vg-glosa-sw:hover { color: #9B3A3A; border-color: #E4C4C0; }
    .vg-glosa-sw-on { background: #9B3A3A; color: #FFF; border-color: #9B3A3A; }
    .vg-glosa-sw-on:hover { color: #FFF; }
    .vg-glosa-sw:focus-visible { outline: 2px solid #9B3A3A; outline-offset: 2px; }
    /* V531: botão slim de export do relatório de glosa (canto inferior direito) */
    .vg-glosa-export { flex: none; width: 26px; height: 26px;
      border-radius: 7px; border: 1px solid #E4C4C0; background: #fff; color: #9B3A3A;
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
      font-size: 14px; line-height: 1; padding: 0;
      transition: background-color 130ms, color 130ms, border-color 130ms, transform 130ms; }
    .vg-glosa-export:hover { background: #9B3A3A; color: #fff; border-color: #9B3A3A; transform: translateY(-1px); }
    .vg-glosa-export.carregando { opacity: .55; pointer-events: none; }
    /* V538: KPIs LM/LY/YTD do card de glosa (2 colunas: Prod. Glosada | Repasse) */
    .vg-glosa-kpis { display: grid; grid-template-columns: auto 1fr 1fr; gap: 3px 10px; margin-top: 8px; align-items: baseline; }
    .vg-glosa-kpi-row { display: contents; }
    .vg-glosa-kpi-lbl { font-size: 9.5px; font-weight: 800; letter-spacing: .04em; color: var(--ink-faint); white-space: nowrap; }   /* V722: "vs LM" sem quebra */
    .vg-glosa-kpi-v { font-size: 11px; font-weight: 700; text-align: right; white-space: nowrap; }
    .vg-glosa-kpi-v em { font-style: normal; font-weight: 600; font-size: 10px; opacity: .9; }
    .vg-kpi-up { color: #15a34a; }     /* V540: tokens do Claude Design */
    .vg-kpi-down { color: #dc2626; }
    .vg-kpi-ytd { color: #24313d; font-weight: 600; }
    .vg-kpi-nil { color: var(--ink-faint); }
    .vg-glosa-metabot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; }
    /* V515: placeholder dos campos que dependem de cálculo pesado */
    .vg-cmp-calc { font-size: 10.5px; font-weight: 600; color: var(--ink-faint); font-style: italic; animation: vgCmpPulse 1.1s ease-in-out infinite; }
    @keyframes vgCmpPulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
    /* V512: toggle "+ SANTO" (âmbar, separado dos chips de filtro) */
    .vg-cmp-chip-santo { margin-left: 8px; }
    .vg-cmp-chip-santo:hover { border-color: #B8965A; color: #8A6840; }
    .vg-cmp-chip-santo.on { background: #B8965A; border-color: #B8965A; color: #fff; }
    /* V509: fileira ÚNICA com scroll horizontal — sem quebrar card pra baixo */
    .vg-cmp-grid {
      display: flex; flex-wrap: nowrap; overflow-x: auto; overscroll-behavior-x: contain;
      gap: 12px; margin-top: 14px; padding-bottom: 6px;
      scrollbar-width: thin; scrollbar-color: rgba(120,140,170,.35) transparent;
    }
    .vg-cmp-grid::-webkit-scrollbar { height: 6px; }
    .vg-cmp-grid::-webkit-scrollbar-thumb { background: rgba(120,140,170,.35); border-radius: 99px; }
    .vg-cmp-grid::-webkit-scrollbar-track { background: transparent; }
    /* V540: Comparativo — layout "Opção 1B" (Claude Design): duas faixas com
       fundo próprio (Repasse azul-claro, Prod. Médica cinza-claro) */
    .vg-cmp-card {
      border: 1px solid #e4e9ee; border-radius: 10px; overflow: hidden; background: #fff;
      display: flex; flex-direction: column; gap: 8px; padding: 8px;
      flex: 0 0 262px; min-width: 262px;
    }
    .vg-cmp-mes { font-size: 16px; font-weight: 700; color: #24313d; padding: 6px 8px 2px; }
    .vg-cmp-bloco { border-radius: 8px; padding: 14px 14px 16px; }
    .vg-cmp-bloco-rep { background: #eaf4fb; }
    .vg-cmp-bloco-pm  { background: #f4f5f6; }
    .vg-cmp-titulo { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; margin-bottom: 10px; }
    .vg-cmp-bloco-rep .vg-cmp-titulo { color: #4d6b80; }
    .vg-cmp-bloco-pm  .vg-cmp-titulo { color: #66717c; }
    .vg-cmp-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .vg-cmp-bloco-rep .vg-cmp-dot { background: #2a8cc0; }
    .vg-cmp-bloco-pm  .vg-cmp-dot { background: #8b98a5; }
    .vg-cmp-linha { display: flex; justify-content: space-between; gap: 8px; font-size: 13.5px; color: #3d4a56; }
    .vg-cmp-linha + .vg-cmp-linha { margin-top: 4px; }
    .vg-cmp-linha strong { font-weight: 700; color: #24313d; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .vg-cmp-pct { margin: 10px 0 4px; font-size: 30px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .vg-cmp-bloco-rep .vg-cmp-pct { color: #1d7ba9; }
    .vg-cmp-bloco-pm  .vg-cmp-pct { color: #46545f; }
    /* V538/V540: KPIs LM/LY/YTD nos blocos do comparativo */
    .vg-cmp-kpis { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; border-top: 1px solid transparent; padding-top: 8px; }
    .vg-cmp-bloco-rep .vg-cmp-kpis { border-top-color: #d6e6f2; }
    .vg-cmp-bloco-pm  .vg-cmp-kpis { border-top-color: #e3e5e7; }
    .vg-cmp-kpi { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
    /* V722: nowrap — o rótulo "vs LM" (V716) quebrava em 2 linhas nos meses
       mais estreitos e desalinhava os blocos azul (Repasse) e cinza (Prod.
       Médica) entre si. */
    .vg-cmp-kpi-lbl { font-weight: 700; white-space: nowrap; flex-shrink: 0; }
    .vg-cmp-bloco-rep .vg-cmp-kpi-lbl { color: #5f7788; }
    .vg-cmp-bloco-pm  .vg-cmp-kpi-lbl { color: #66717c; }
    .vg-cmp-kpi > span:last-child { font-weight: 600; white-space: nowrap; text-align: right; color: #24313d; }
    .vg-cmp-kpi em { font-style: normal; font-weight: 600; }
    /* ── V688: barra de pesquisa unificada 12C (handoff Claude Design) ── */
    .vg-aic .aic-lbl { color: #06283A; }   /* V849: título dos cards totalizadores */   /* rótulo dos cards (PRODUÇÃO TOTAL, REPASSE TOTAL…) */
    /* o container precisa criar o contexto de empilhamento ACIMA dos cards
       (que são position:relative) — senão o painel abre ATRÁS deles */
    /* V935: FILTRO CONGELADO — acompanha a rolagem até o fim da página.
       O .app-shell (style.css) usa overflow-x:hidden, que o torna contêiner de
       rolagem e anula o sticky; na Visão Geral trocamos por clip (recorta igual,
       sem criar rolagem). A barra prende no topo; quando presa (.vg-preso, via
       IntersectionObserver) ganha fundo da página e sombra mais forte. */
    body[data-tela="dashboard"] .app-shell { overflow-x: clip; }
    /* V936: o dock de importação (QVIS | PRODUÇÃO | CADASTROS) também tem sticky
       no style.css e, com o clip, passou a prender por cima do filtro. Na Visão
       Geral ele rola junto com a página — some conforme a rolagem avança. */
    body[data-tela="dashboard"] .import-dock-wrap { position: relative; top: auto; z-index: 3; }
    #vg-filtros { position: sticky; top: 0; z-index: 50; padding-top: 6px; margin-top: -6px; }
    #vg-filtros.vg-preso { background: linear-gradient(to bottom, var(--bg, #F5FAFD) 0%, var(--bg, #F5FAFD) 78%, rgba(245,250,253,0) 100%); padding-bottom: 10px; }
    #vg-filtros.vg-preso .vg-sb { margin-bottom: 0; box-shadow: 0 2px 4px rgba(20,50,80,.06), 0 18px 34px -16px rgba(20,50,80,.35); border-color: #d6e2eb; }
    .vg-sb { display: flex; align-items: stretch; background: #fff; border: 1px solid #e2ebf2; border-radius: 14px;
      padding: 6px; margin: 4px 0 20px; position: relative; z-index: 30;
      box-shadow: 0 1px 2px rgba(20,50,80,.04), 0 10px 28px -20px rgba(20,50,80,.18); }
    .vg-sb-celwrap { position: relative; display: flex; min-width: 0; }
    .vg-sb-div { width: 1px; background: #eef3f7; margin: 6px 0; flex: none; }
    .vg-sb-cel { flex: 1; min-width: 0; display: flex; align-items: center; gap: 11px; padding: 10px 14px;
      border: none; border-radius: 10px; background: transparent; cursor: pointer; font: inherit; text-align: left; }
    .vg-sb-cel:hover, .vg-sb-cel.ativo, .vg-sb-cel.aberto { background: #f4fafd; }
    .vg-sb-cel:focus-visible { outline: 2px solid #2f8fc4; outline-offset: 2px; }
    .vg-sb-tile { width: 30px; height: 30px; flex: none; border-radius: 8px; background: #f0f5f9; color: #5b6c7c;
      display: flex; align-items: center; justify-content: center; }
    .vg-sb-cel.aberto .vg-sb-tile, .vg-sb-cel.ativo .vg-sb-tile { background: #dbeef8; color: #1c6fa8; }
    .vg-sb-txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
    .vg-sb-rot { font-size: 9.5px; font-weight: 700; letter-spacing: .11em; text-transform: uppercase; color: #90a1ae; }
    .vg-sb-cel.aberto .vg-sb-rot { color: #1c6fa8; }
    .vg-sb-val { font-size: 13.5px; font-weight: 700; color: #14384f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vg-sb-chev { flex: none; color: #90a1ae; display: flex; transition: transform .15s; }
    .vg-sb-cel.aberto .vg-sb-chev { color: #1c6fa8; transform: rotate(180deg); }
    .vg-sb-acao { flex: none; display: flex; align-items: center; padding: 0 6px 0 14px; }
    .vg-sb-btn { height: 50px; padding: 0 18px; border: none; border-radius: 10px; background: #1c6fa8; color: #fff;
      font: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 8px;
      box-shadow: 0 6px 16px -8px rgba(28,111,168,.8); white-space: nowrap; }
    .vg-sb-btn:hover { background: #14547f; }
    .vg-sb-conta-slot { height: 50px; display: flex; align-items: center; padding: 0 14px; font-size: 13px;
      font-weight: 700; color: #5b6c7c; white-space: nowrap; font-variant-numeric: tabular-nums; }
    /* painel ancorado na célula (a largura acompanha a célula) */
    .vg-sb-painel { position: absolute; top: 100%; left: 6px; right: 6px; margin-top: 8px; z-index: 40; min-width: 240px;
      background: #fff; border: 1px solid #dfe8f0; border-radius: 12px; overflow: hidden;
      box-shadow: 0 18px 44px -14px rgba(15,37,68,.42); }
    .vg-sb-buscabox { display: flex; align-items: center; gap: 8px; margin: 11px 12px 10px; padding: 0 10px; height: 38px;
      background: #f7fafc; border: 1px solid #dfe8f0; border-radius: 8px; color: #6b7d8e; }
    .vg-sb-painel > .vg-sb-buscabox { box-sizing: border-box; }
    .vg-sb-busca { flex: 1; min-width: 0; border: none; background: none; font: inherit; font-size: 13.5px; color: #14384f; }
    .vg-sb-busca:focus { outline: none; }
    .vg-sb-busca::placeholder { color: #9aabb8; }
    .vg-sb-busca-x { width: 20px; height: 20px; flex: none; border: none; border-radius: 999px; background: #dfe8f0;
      color: #5b6c7c; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
    .vg-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; border-top: 1px solid #edf2f6; }
    .vg-sb-painel > .vg-sb-lista:first-child { border-top: none; }
    .vg-sb-lista::-webkit-scrollbar { width: 8px; }
    .vg-sb-lista::-webkit-scrollbar-track { background: #f2f6f9; }
    .vg-sb-lista::-webkit-scrollbar-thumb { background: #c3d5e2; border-radius: 4px; }
    .vg-sb-it { height: 38px; display: flex; align-items: center; gap: 10px; padding: 0 8px; border-radius: 8px;
      cursor: pointer; font-size: 13.5px; font-weight: 500; color: #14384f; }
    .vg-sb-it:hover, .vg-sb-it.hl { background: #f2f7fb; }
    .vg-sb-it.sel { background: #eaf4fb; }
    .vg-sb-it.sel .vg-sb-it-nome, .vg-sb-it-todos .vg-sb-it-nome { font-weight: 700; }
    .vg-sb-it-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vg-sb-chip { width: 24px; height: 24px; flex: none; border-radius: 999px; background: #eaf4fb; color: #1c6fa8;
      font-size: 9.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; letter-spacing: .02em; }
    .vg-sb-ck { flex: none; color: #1c6fa8; display: flex; }
    .vg-sb-vazio { font-size: 13px; color: #90a1ae; padding: 18px 10px; }
    .vg-sb-rodape { display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 9px 13px; border-top: 1px solid #edf2f6; background: #fbfdfe; font-size: 11.5px; color: #5b6c7c; }
    .vg-sb-dica { font-size: 11px; color: #90a1ae; }
    @media (max-width: 1200px) {
      .vg-sb { flex-wrap: wrap; gap: 2px; }
      .vg-sb-celwrap { flex: 1 1 46% !important; }
      .vg-sb-div { display: none; }
      .vg-sb-acao { width: 100%; padding: 6px; }
      .vg-sb-btn, .vg-sb-conta-slot { width: 100%; justify-content: center; }
      .vg-sb-painel { min-width: 280px; }
    }

    /* cards: 3 colunas de MESMA largura; todos crescem à altura do maior (glosa) */
    .vg-cards-grid { display: grid !important; grid-template-columns: repeat(3, 1fr) !important; gap: 20px !important; margin: 14px 0 34px !important; align-items: stretch; }
    /* V712: cards da VG no MESMO padrão de moldura dos demais módulos (LIO
       etc.) — sombra sólida deslocada ↖ (filete em CIMA e à ESQUERDA) + glow,
       no lugar da faixa interna de 5px só à esquerda (V688). */
    .vg-aic { position: relative !important; height: auto !important; display: flex;
      border-radius: 13px; margin-top: 5px; margin-left: 5px; background: var(--bg-elevated, #fff);
      box-shadow: -4px -3px 10px rgba(30,187,215,.30), 0 8px 18px rgba(0,58,84,.13); }
    /* V888: a Visão Geral tem a MOLDURA PRÓPRIA dela (esta regra), e por isso
       não tinha acompanhado a V887 — a camada de degradê vive na lista global
       do style.css, que não alcança o .vg-aic. Aqui vai o mesmo filete em L:
       3px em cima, 4px à esquerda, no degradê da marca. */
    /* V891: a moldura é a BORDA do card (3px em cima, 4px à esquerda), pintada
       com o degradê pelo border-box — gruda na borda, acompanha o
       arredondamento e afina no canto como a sombra sólida fazia. */
    .vg-aic { background:
        linear-gradient(var(--bg-elevated, #fff) 0 0) padding-box,
        linear-gradient(90deg, #16456b 0%, #1d6d92 34%, #2a9fc4 68%, #4fd3ec 100%) border-box;
      border-style: solid; border-color: transparent; border-width: 3px 0 0 4px; }
    .vg-aic::after { content: none; }
    /* o card de GLOSA não é azul: moldura própria, sem borda em degradê */
    .vg-aic-glosa { background: var(--bg-elevated, #fff); border: none; }
    /* o card de GLOSA não é azul — fica exatamente como está (V887) */
    .vg-aic-glosa { box-shadow: -4px -3px 0 0 #c0563f, -4px -3px 10px rgba(192,86,63,.28), 0 8px 18px rgba(0,58,84,.13); }
    .vg-aic-glosa::after { content: none; }
    .vg-aic .aic-verde { display: none !important; }
    /* V529: conteúdo alinhado ao TOPO (era center) — com a faixa fixa do valor,
       títulos, valores e divisória caem na mesma altura nos três cards */
    .vg-aic .aic-branco { position: relative !important; top: 0 !important; left: 0; right: 0; height: auto !important; width: 100%; padding: 20px 22px 18px !important; display: flex; flex-direction: column; justify-content: flex-start !important; box-sizing: border-box; border-radius: 13px !important; box-shadow: none; }
    /* V529: valores totalizadores alinhados na MESMA altura em todos os cards —
       o valor ancora no rodapé de uma faixa fixa, então a divisória (.aic-meta)
       cai na mesma linha nos três cards (régua de uniformização) */
    .vg-aic .aic-val { font-size: 22px; line-height: 1.2; min-height: 50px; display: flex; align-items: flex-end; }
    .vg-aic-glosa .vg-glosa-dupla { flex: 1; margin-top: 0; }
    .vg-aic .aic-meta { margin-top: 10px; display: flex; gap: 14px; flex-wrap: wrap; }
    .vg-aic-glosa .aic-meta { flex-direction: column; gap: 4px; font-size: 12px; }
    .vg-aic-glosa .aic-meta b { color: var(--ink); }
    .vg-val-sub { font-size: 12px; color: var(--ink-faint); font-weight: 500; }
    .vg-var { font-size: 12px; font-weight: 700; white-space: nowrap; }
    .vg-var-nil { color: var(--ink-faint); font-weight: 500; }
    /* V715: o !important é NECESSÁRIO — o style.css tem uma regra global
       ".main [class*=comp-up] { color:#0A7A5A !important }" (V181) que vencia
       estas cores e mantinha o verde antigo na VG. */
    .vg-var.comp-up { color: #15a34a !important; }   /* V711 (era #0A7A5A) */
    .vg-var.comp-down { color: #A32D2D !important; }
    /* V714: nos cards Produção Total e Repasse Total, o "vs LM" é sempre
       #15a34a (pedido do usuário), subindo ou caindo. */
    .vg-var.vg-var-lm { color: #15a34a !important; }
    /* V863: o rótulo NÃO acompanha a cor do indicador — fica sempre no cinza
       #5A7180, como nos demais cards. Precisa da mesma força das regras acima
       (elas usam !important por causa da regra global do style.css) e de
       especificidade maior, já que aqui o rótulo é filho do badge colorido. */
    .vg-var .vg-var-lbl,
    .vg-var.comp-up .vg-var-lbl,
    .vg-var.comp-down .vg-var-lbl,
    .vg-var.vg-var-lm .vg-var-lbl { color: #5A7180 !important; font-weight: 600; }
    .vg-calc { font-size: 16px; color: var(--ink-faint); font-style: italic; font-weight: 500; }
    .vg-calc-sub { font-size: 11px; color: var(--ink-faint); }
    .vg-glosa-nota { color: var(--ink-faint); font-style: italic; font-size: 11px; }
    /* fatias do card de Repasse */
    .vg-rep-comp { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
    /* V527: só UMA divisória por card (a do valor, padrão .aic-meta) — removida
       a segunda linha que ficava acima da quebra Convênio/Particular/SUS */
    .vg-fatias { display: flex; flex-direction: column; gap: 5px; padding-top: 2px; width: 100%; }
    .vg-fatia { display: grid; grid-template-columns: 1fr auto auto; align-items: baseline; gap: 10px; font-size: 12px; }
    .vg-fatia-lbl { color: var(--ink-faint); font-weight: 600; }
    .vg-fatia-val { color: var(--ink); font-weight: 700; font-variant-numeric: tabular-nums; }
    .vg-fatia-pct { color: var(--ink-faint); font-size: 11px; min-width: 42px; text-align: right; font-variant-numeric: tabular-nums; }
    .vg-glosa-resumo { display: flex; gap: 22px; flex-wrap: wrap; margin-bottom: 14px; }
    .vg-glosa-num { display: flex; flex-direction: column; }
    .vg-glosa-num b { font-size: 26px; color: var(--ink); line-height: 1.1; }
    .vg-glosa-num span { font-size: 11px; color: var(--ink-faint); margin-top: 2px; }
    .vg-glosa-aviso { font-size: 12px; color: var(--ink-faint); font-style: italic; padding: 10px 12px; background: #FAF6EE; border: 1px solid #EBDFC8; border-radius: 9px; }
    .vg-carregando { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 60px 0; color: var(--ink-faint); font-size: 13px; }
    .vg-calc-bloco { color: var(--ink-faint); font-style: italic; font-size: 13px; padding: 18px 4px; }

    /* gráfico de evolução: SEM cartão de fundo branco, só o desenho */
    /* V548 (design 3A): 50/50, alturas iguais, mesma linguagem nos dois cards */
    .vg-charts-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: stretch; margin-bottom: 20px; }
    .vg-charts-2col > * { min-width: 0; height: 100%; }
    @media (max-width: 1100px) { .vg-charts-2col { grid-template-columns: 1fr; } }
    .vg-evolucao-bloco { background: #fff; border: 1px solid #eceff2; border-radius: 16px;
      padding: 22px 24px 18px; margin-bottom: 0; height: 100%; box-sizing: border-box;
      display: flex; flex-direction: column;
      box-shadow: 0 1px 2px rgba(30,45,60,.04), 0 12px 32px -18px rgba(30,45,60,.16); }
    /* o gráfico ocupa a altura livre do card (não fica espremido no rodapé) */
    .vg-evolucao-bloco .vg-chart-wrap { flex: 1; min-height: 0; display: flex; }
    .vg-charts-2col .vg-chart { min-width: 0; width: 100%; height: 100%; }
    .vg-bloco { background: #fff; border: 1px solid var(--border); border-radius: 14px; padding: 18px 20px; margin-bottom: 20px; box-shadow: 0 6px 16px rgba(0, 58, 84,.05); }
    .vg-bloco-titulo { font-size: 14px; font-weight: 800; color: var(--ink); letter-spacing: .01em; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
    .vg-bloco-titulo span { font-weight: 500; color: var(--ink-faint); font-size: 12px; }
    .vg-chart-wrap { width: 100%; overflow-x: auto; }
    .vg-chart { width: 100%; min-width: 680px; height: auto; display: block; }
    /* V537: header da evolução com seletor de ano à direita */
    .vg-evo-head { justify-content: space-between; }
    .vg-evo-ano-lbl { font-size: 12px; font-weight: 600; color: var(--ink-soft); display: inline-flex; align-items: center; gap: 6px; }
    .vg-evo-ano { font: inherit; font-size: 12.5px; font-weight: 700; color: var(--ink); padding: 5px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elevated); cursor: pointer; }
    .vg-evo-ano:focus { outline: none; border-color: #1EBBD7; box-shadow: 0 0 0 3px rgba(30,187,215,.14); }
    .vg-bar { fill: #06283A; transition: fill .15s; }
    .vg-bar-g:hover .vg-bar { fill: #005073; }
    .vg-bar-atual { fill: #1EBBD7 !important; }
    .vg-bar-val { font-size: 11px; fill: var(--ink-faint); text-anchor: middle; font-weight: 600; }
    .vg-bar-lbl { font-size: 11px; fill: var(--ink-faint); text-anchor: middle; }
    .vg-grid { stroke: #EDF1EF; stroke-width: 1; }
    .vg-grid-lbl { font-size: 10px; fill: #9AAAA3; text-anchor: end; }

    /* V545: ilhas "Top 10 por Repasse" + "Performance médica" (design) */
    .vg-ilhas-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; margin-bottom: 20px; }
    .vg-ilhas-2col > * { min-width: 0; }
    @media (max-width: 1100px) { .vg-ilhas-2col { grid-template-columns: 1fr; } }
    /* V931: tabela por especialidade (sem gráfico) */
    .vg-esp-card { margin-bottom: 20px; }
    .vg-esp-acoes { display: flex; align-items: center; gap: 14px; }
    .vg-esp-export { border: 1px solid #DDE7E3; background: #fff; border-radius: 9px; padding: 7px 12px; font-size: 12px; font-weight: 700; color: #005073; cursor: pointer; }
    .vg-esp-export:hover { background: #EAF4FB; border-color: #189AD3; }
    /* V956: sem barra visível no fim da matriz — a rolagem horizontal continua
       funcionando (tela estreita), mas a barra fica invisível; e a alça de
       redimensionar coluna (cabeçalho) não acende em ciano ao passar o mouse */
    .vg-esp-wrap { overflow-x: auto; margin-top: 12px; scrollbar-width: none; }
    .vg-esp-wrap::-webkit-scrollbar { display: none; height: 0; }
    .vg-esp-tab .atlas-col-resize:hover, .vg-esp-tab .atlas-col-resize.ativa { background: transparent; }
    .vg-esp-tab { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .vg-esp-tab th { background: #107DAC; color: #fff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; padding: 9px 12px; text-align: left; white-space: nowrap; }
    .vg-esp-tab th.num, .vg-esp-tab td.num { text-align: right; font-family: var(--font-mono); white-space: nowrap; }
    /* V952: alinhado pelo TOPO — o R$ de todas as células fica na mesma linha,
       mesmo quando só algumas têm o % embaixo (com middle o R$ da célula com %
       subia e o da vizinha sem % ficava centrado, desalinhados). */
    .vg-esp-tab td { padding: 8px 12px; border-bottom: 1px solid #EDF2F0; color: #042222; vertical-align: top; }
    .vg-esp-tab tbody tr:hover td { background: #F4FAFD; }
    .vg-esp-nome { font-weight: 700; color: #06283A; }
    .vg-esp-adm { display: block; font-size: 10.5px; font-weight: 500; color: #56645E; font-family: var(--font-body, inherit); }
    .vg-esp-pct { display: block; font-size: 10.5px; color: #56645E; font-family: var(--font-body, inherit); }
    .vg-esp-glosa { color: #9B3A3A; font-weight: 400; }   /* V956: sem negrito na Glosa */
    .vg-esp-rep { color: #0E7A57; font-weight: 700; }
    /* V955: modo "repasse glosado" — coluna Glosa clicável; a coluna Repasse
       passa a mostrar o repasse perdido, em VERMELHO (linhas, subs e total) */
    .vg-esp-th-clicavel { cursor: pointer; }
    .vg-esp-td-glosa { cursor: pointer; }
    .vg-esp-th-on { text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 2px; }
    .vg-esp-perdido, .vg-esp-sub td.num.vg-esp-perdido { color: #C0392B !important; font-weight: 700; }
    .main .vg-esp-tab tfoot td.vg-esp-perdido, .main .vg-esp-tab tfoot td.vg-esp-perdido * { color: #C0392B !important; }
    /* V934: sem a tarja preta global do style.css (.main table tfoot td) — rodapé claro, só em negrito */
    .main .vg-esp-tab tfoot td, .main .vg-esp-tab tfoot tr:hover td { font-weight: 800; background: #F6F9FB !important; color: #06283A !important; border-top: 2px solid #DDE7E3 !important; border-bottom: none !important; border-color: #DDE7E3 !important; }
    .main .vg-esp-tab tfoot td * { color: #56645E !important; }
    /* V934: drilldown Categoria › Subcategoria */
    .vg-esp-cat-dd { cursor: pointer; }
    .vg-esp-seta { display: inline-block; width: 14px; color: #107DAC; font-size: 11px; }
    .vg-esp-aberta td { background: #F4FAFD; }
    .vg-esp-sub td { background: #FAFCFD; border-bottom: 1px dashed #E4ECE9; }
    .vg-esp-sub .vg-esp-nome { font-weight: 600; color: #2E4A57; padding-left: 34px; font-size: 12px; }
    .vg-esp-sub .vg-esp-adm { font-size: 10px; }
    .vg-esp-sub td.num { font-size: 12px; color: #2E4A57; }
    .vg-esp-sub td.num.vg-esp-glosa { color: #9B3A3A; }
    .vg-esp-sub td.num.vg-esp-rep { color: #0E7A57; }
    .vg-esp-nota { margin-top: 10px; font-size: 11.5px; color: #8A5A1F; background: #FBF0DA; border-radius: 8px; padding: 8px 12px; }
    .vg-il-card { background: #fff; border: 1px solid #eceff2; border-radius: 16px; padding: 22px 24px 18px;
      box-shadow: 0 1px 2px rgba(30,45,60,.04), 0 12px 32px -18px rgba(30,45,60,.16); }
    .vg-il-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 6px; }
    .vg-il-titulo { font-size: 17px; font-weight: 700; color: #1b2733; letter-spacing: -.01em; }
    .vg-il-sub { font-size: 12.5px; color: #8b98a5; margin-top: 3px; }
    .vg-il-tot { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; white-space: nowrap; }
    .vg-il-tot-lbl { font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #94a1ad; }
    .vg-il-tot-val { font-size: 15px; font-weight: 700; color: #1b2733; }
    .vg-il-legenda { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; font-size: 11.5px; color: #7b8794; white-space: nowrap; border-top: 1px solid #eef1f4; border-bottom: 1px solid #eef1f4; padding: 11px 0; margin: 8px 0 2px; }
    .vg-il-legenda > span { display: flex; align-items: center; gap: 7px; }
    .vg-il-mk { width: 10px; height: 10px; border-radius: 2px; flex: none; display: inline-block; }
    /* V546: azul do PRODUZIDO = mesmo gradiente da barra do Top 10 (gráfico ao lado) */
    .vg-il-mk-pro { background: linear-gradient(90deg, #14364a, #3fb6d4); }
    .vg-il-mk-glo { background: #e0483f; } .vg-il-mk-rep { background: #1EBBD7; }   /* V547: ciano */
    .vg-il-leg-obs { margin-left: auto; color: #94a1ad; }
    .vg-il-lista { display: flex; flex-direction: column; }
    /* V580: Performance com TODOS os elegíveis — rola na altura do Top 10 */
    .vg-il-lista-perf { padding-right: 6px; }
    .vg-il-lista-perf::-webkit-scrollbar { width: 8px; }
    .vg-il-lista-perf::-webkit-scrollbar-track { background: #eef2f5; border-radius: 4px; }
    .vg-il-lista-perf::-webkit-scrollbar-thumb { background: #c3d0da; border-radius: 4px; }
    .vg-il-row { display: grid; grid-template-columns: 30px 1fr; gap: 12px; align-items: center; padding: 11px 0; border-bottom: 1px solid #f2f5f7; cursor: pointer; }
    .vg-il-row:last-child { border-bottom: none; }
    .vg-il-row:hover { background: #fafcfd; }
    .vg-il-pos { width: 30px; height: 30px; border-radius: 50%; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex: none; }
    /* V953: a numeração do Top 10 ganhou o MESMO efeito da Performance médica
       (círculo claro #eef2f5, número #52606d) — antes era marinho com branco */
    .vg-il-pos-rank, .vg-il-pos-neutra { background: #eef2f5; color: #52606d; }
    .vg-il-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .vg-il-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .vg-il-nome { font-size: 14px; font-weight: 700; color: #1b2733; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vg-il-val { font-size: 14.5px; font-weight: 700; white-space: nowrap; color: #1b2733; }
    .vg-il-val-rep { color: #1c7fb0; }
    .vg-il-trilho { height: 8px; background: #eef2f5; border-radius: 4px; overflow: hidden; }
    .vg-il-fill { height: 8px; border-radius: 4px; background: linear-gradient(90deg, #14364a, #3fb6d4); }
    .vg-il-meta { font-size: 11.5px; }
    .vg-il-meta-fraco { color: #94a1ad; }
    /* V582: valores grandes (ex.: R$ 399.387 três vezes) quebravam a linha —
       fonte/gaps mais compactos e distribuição pela largura toda */
    .vg-il-meta-perf { display: flex; gap: 6px 12px; flex-wrap: wrap; white-space: nowrap;
      font-size: 11px; justify-content: flex-start; }
    .vg-il-stack { display: flex; height: 14px; border-radius: 4px; overflow: hidden; background: #eef2f5; min-width: 2px; }
    .vg-il-seg { height: 14px; }
    .vg-il-seg-pro { background: linear-gradient(90deg, #14364a, #3fb6d4); }   /* V546: = Top 10 */
    .vg-il-seg-glo { background: #e0483f; } .vg-il-seg-rep { background: #1EBBD7; }   /* V547: ciano */
    .vg-il-c-pro { color: #1c7fb0; font-weight: 700; } .vg-il-cmp-pro { color: #7fb1cd; font-weight: 600; }
    .vg-il-c-glo { color: #c03a3a; font-weight: 700; } .vg-il-cmp-glo { color: #d9908c; font-weight: 600; }
    .vg-il-c-rep { color: #128FA6; font-weight: 700; } .vg-il-cmp-rep { color: #7EC8D8; font-weight: 600; }   /* V547: ciano (texto legível) */

    /* V579: aguardando dos blocos lazy (abaixo da dobra) */
    .vg-lazy-ph { min-height: 240px; display: flex; align-items: center; justify-content: center;
      color: #8b98a5; font-size: 13px; margin-bottom: 20px; }

    /* V577.1: Desempenho × Repasse — handoff 8A "volume" (Claude Design):
       degradê vertical, brilho na aresta esquerda, sombra projetada colorida,
       eixo Y fixo, gridlines, pílula da diferença. Geometria do handoff. */
    .vg-dr-card { background: #fff; border: 1px solid #e4eaef; border-radius: 8px;
      padding: 18px 20px 16px; margin-bottom: 20px;
      box-shadow: 0 1px 2px rgba(16,42,66,.05), 0 12px 28px -20px rgba(16,42,66,.28); }
    .vg-dr-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .vg-dr-titulo { font-size: 16px; font-weight: 700; color: #14384f; letter-spacing: -.005em; }
    .vg-dr-sub { font-size: 12px; color: #90a1ae; margin-top: 3px; }
    .vg-dr-leg { display: flex; gap: 20px; align-items: center; flex-wrap: wrap;
      font-size: 12px; font-weight: 600; color: #14384f;
      padding-bottom: 14px; border-bottom: 1px solid #edf1f4; }
    .vg-dr-leg > span { display: flex; align-items: center; gap: 7px; }
    .vg-dr-leg b { color: #5d7385; font-weight: 700; }
    .vg-dr-sw { width: 11px; height: 11px; border-radius: 2px; flex: none; display: inline-block;
      box-shadow: 0 1px 2px rgba(16,42,66,.25); }
    .vg-dr-sw-des { background: linear-gradient(180deg, #4fd3ec, #1aa9c9); }
    .vg-dr-sw-rep { background: linear-gradient(180deg, #14364a, #3fb6d4); }   /* V582 */
    .vg-dr-plot { display: flex; align-items: flex-start; }
    .vg-dr-eixoy { position: relative; flex: none; width: 56px; margin-top: 24px; }
    .vg-dr-ylbl { position: absolute; right: 10px; font-size: 10.5px; font-weight: 600; color: #a4b2bd;
      transform: translateY(50%); white-space: nowrap; }
    .vg-dr-scroller { overflow-x: auto; overflow-y: hidden; flex: 1; min-width: 0; }
    .vg-dr-scroller::-webkit-scrollbar { height: 8px; }
    .vg-dr-scroller::-webkit-scrollbar-track { background: #eef2f5; border-radius: 4px; }
    .vg-dr-scroller::-webkit-scrollbar-thumb { background: #c3d0da; border-radius: 4px; }
    .vg-dr-trilha { position: relative; width: 100%; min-width: max-content; padding-top: 24px; }
    .vg-dr-gridlayer { position: absolute; top: 24px; left: 0; right: 0; pointer-events: none; }
    .vg-dr-gridln { position: absolute; left: 0; right: 0; border-top: 1px solid #f0f3f6; }
    .vg-dr-grupos { position: relative; display: flex; gap: 40px; align-items: flex-start; padding: 0 14px; }
    .vg-dr-grupos-um { justify-content: center; min-width: 100%; width: 100%; }   /* V579: 1 médico → centralizado */
    .vg-dr-grupo { flex: none; width: 132px; display: flex; flex-direction: column; align-items: center; }
    .vg-dr-barras { display: flex; align-items: flex-end; justify-content: center; gap: 0; width: 100%; }   /* V579: coladas */
    .vg-dr-barra-wrap { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }
    .vg-dr-val { font-size: 10px; font-weight: 700; padding-bottom: 7px; white-space: nowrap; }   /* V584: 10px */
    .vg-dr-val-des { color: #14384f; }
    .vg-dr-val-rep { color: #16456b; }
    .vg-dr-bar { position: relative; width: 54px; transition: filter .12s ease; }
    .vg-dr-bar-des { border-radius: 4px 0 0 0; }
    .vg-dr-bar-rep { border-radius: 0 4px 0 0; }
    .vg-dr-bar-des { background: linear-gradient(180deg, #4fd3ec 0%, #29c0e0 55%, #1aa9c9 100%);
      box-shadow: 0 -1px 0 rgba(255,255,255,.5) inset, 0 10px 18px -10px rgba(26,169,201,.75); }
    .vg-dr-bar-rep { background: linear-gradient(180deg, #14364a, #3fb6d4);   /* V582: = barra do Top 10 */
      box-shadow: 0 -1px 0 rgba(255,255,255,.28) inset, 0 10px 18px -10px rgba(20,54,74,.7); }
    .vg-dr-bar:hover { filter: brightness(1.06); }
    .vg-dr-glow { position: absolute; top: 0; bottom: 0; left: 0; width: 9px; border-radius: 4px 0 0 0; }
    .vg-dr-glow-des { background: linear-gradient(90deg, rgba(255,255,255,.42), rgba(255,255,255,0)); }
    .vg-dr-glow-rep { background: linear-gradient(90deg, rgba(255,255,255,.22), rgba(255,255,255,0)); }
    .vg-dr-eixolinha { border-top-color: #dfe6ec; }
    .vg-dr-foot { width: 132px; padding-top: 11px; margin-top: 0;
      display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .vg-dr-nome { font-size: 12px; font-weight: 700; letter-spacing: .06em; color: #5d7385;
      max-width: 128px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* V583: % sem pílula — texto preto, sem fundo · V584: 10px */
    .vg-dr-pill { font-size: 10px; font-weight: 700; color: #1b2733; white-space: nowrap; }
    .vg-dr-pill-pos { background: #15a34a; }   /* V711 (era #1d8f5f) */
    .vg-dr-pill-neg { background: #c0563f; }
    .vg-dr-pill-zero { background: #a4b2bd; }
    .vg-dr-pill-pct { background: transparent; }   /* V583: sem fundo */

    .vg-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .vg-rank { display: flex; flex-direction: column; gap: 12px; }
    /* V541: Top 10 em DUAS colunas — preenche por coluna (1–5 | 6–10) */
    .vg-rank-2col { display: grid; grid-auto-flow: column; grid-template-rows: repeat(5, auto);
      grid-template-columns: 1fr 1fr; gap: 8px 28px; }
    @media (max-width: 720px) { .vg-rank-2col { grid-auto-flow: row; grid-template-rows: none; grid-template-columns: 1fr; } }
    /* V541: gráfico "Glosa do mês × perda do médico" (design 2B) */
    /* V548 (design 3A): cabeçalho condensado — chips numa faixa única e legenda
       compacta; o plot cresce e os dois cards ficam com a MESMA altura */
    .vg-gc-bloco { background: #fff; border: 1px solid #eceff2; border-radius: 16px;
      padding: 22px 24px 18px; margin-bottom: 0; height: 100%; box-sizing: border-box;
      display: flex; flex-direction: column;
      box-shadow: 0 1px 2px rgba(30,45,60,.04), 0 12px 32px -18px rgba(30,45,60,.16); }
    .vg-gc-loading { padding: 40px 0; text-align: center; }
    /* V872: "Evolução da Glosa Fato" — mesmo cartão do 2B, só que em LARGURA
       TOTAL e com altura própria (fora da grade 50/50, height:100% não vale) */
    .vg-gf-bloco { height: auto; margin-bottom: 20px; }
    .vg-gf-plot { width: 100%; margin-top: 2px; }
    /* fluido: acompanha o container, sem largura mínima nem rolagem lateral */
    .vg-gf-svg { display: block; width: 100%; height: auto; }
    /* auréola branca: o rótulo passa por cima da linha e da tendência sem
       virar borrão quando as duas se cruzam num ponto */
    .vg-gf-val { font-size: 13px; fill: #c03a3a; text-anchor: middle; font-weight: 700;
      paint-order: stroke; stroke: #fff; stroke-width: 3.5px; stroke-linejoin: round; }
    .vg-gf-lbl-vazio { opacity: .45; }
    .vg-gf-pt { cursor: default; }
    .vg-gf-pt:hover .vg-gf-val { fill: #e0483f; }
    .vg-gf-mk-tend { width: 22px; height: 0; border-top: 2px dashed #1c7fb0; }
    .vg-gf-nota { color: #94a1ad; font-size: 11px; }
    .vg-gc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
    .vg-gc-titulo { font-size: 17px; font-weight: 700; color: #1b2733; letter-spacing: -.01em; }
    .vg-gc-sub { font-size: 12.5px; color: #8b98a5; margin-top: 3px; }
    /* faixa única com os 3 totalizadores, separados por divisórias */
    .vg-gc-chips { display: flex; border: 1px solid #e8eef4; border-radius: 10px; overflow: hidden; margin-bottom: 12px; }
    .vg-gc-chip { flex: 1; min-width: 0; background: #fff; padding: 9px 14px; display: flex; flex-direction: column; gap: 1px; }
    .vg-gc-chip + .vg-gc-chip { border-left: 1px solid #e8eef4; }
    .vg-gc-chip-red { background: #fdf7f6; }
    .vg-gc-chip-lbl { font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #94a1ad; white-space: nowrap; }
    .vg-gc-chip-red .vg-gc-chip-lbl { color: #c78d88; }
    .vg-gc-chip-val { font-size: 15px; font-weight: 700; color: #1b2733; white-space: nowrap; }
    .vg-gc-chip-red .vg-gc-chip-val { color: #c03a3a; }
    .vg-gc-legenda { display: flex; gap: 16px; align-items: center; font-size: 11.5px; color: #52606d; flex-wrap: wrap; margin-bottom: 14px; }
    .vg-gc-legenda > span { display: flex; align-items: center; gap: 8px; }
    .vg-gc-mk { display: inline-block; flex: none; }
    .vg-gc-plot { display: flex; align-items: flex-end; gap: 0; flex: 1; }   /* V548: plot cresce */
    .vg-gc-yaxis { width: 76px; height: 300px; position: relative; flex-shrink: 0; margin-bottom: 48px; }
    .vg-gc-tick { position: absolute; right: 12px; transform: translateY(50%); font-size: 11px; font-weight: 600; color: #b6c0c9; white-space: nowrap; }
    .vg-gc-scroller { flex: 1; overflow-x: auto; overflow-y: hidden; padding-top: 88px; scrollbar-width: thin; }   /* V689: folga p/ a pilha completa de rótulos */
    .vg-gc-track { position: relative; min-width: max-content; padding-bottom: 48px; }
    .vg-gc-grid { position: absolute; left: 0; right: 0; bottom: 48px; height: 300px; pointer-events: none; }
    .vg-gc-gline { position: absolute; left: 0; right: 0; border-top: 1px dashed #e8edf2; }
    .vg-gc-cols { display: flex; gap: 30px; align-items: flex-end; height: 300px; position: relative; }
    .vg-gc-svg { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; z-index: 5; }
    .vg-gc-col { width: 88px; flex-shrink: 0; display: flex; justify-content: center; align-items: flex-end; }
    .vg-gc-barext { width: 88px; background: #e9f1f7; border-radius: 6px; position: relative; display: flex; justify-content: center; align-items: flex-end; }
    .vg-gc-total { white-space: nowrap; font-size: 15px; font-weight: 700; color: #1b2733; letter-spacing: -.01em; }
    .vg-gc-mom { white-space: nowrap; font-size: 11.5px; font-weight: 700; }
    .vg-gc-barint { width: 36px; background: #e0483f; border-radius: 5px; position: relative; }
    .vg-gc-perdido { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 8px; display: flex; flex-direction: column; align-items: center; gap: 1px; white-space: nowrap; }
    .vg-gc-perd-val { font-size: 13px; font-weight: 700; color: #c03a3a; }
    .vg-gc-perd-pct { font-size: 11px; font-weight: 700; color: #d9908c; }
    /* V689: rótulos SEM fundo (nada de "ilha branca") — por cima da linha de
       tendência (svg z-5) e com um brilho de texto sutil pra linha não cortar
       os números quando passa por trás */
    .vg-gc-perdido { z-index: 7; }
    .vg-gc-total, .vg-gc-mom, .vg-gc-perd-val, .vg-gc-perd-pct {
      text-shadow: 0 0 3px #fff, 0 0 5px #fff, 0 0 8px #fff; }
    /* V689: pilha acima da barra — total + M/M sempre; o perdido entra quando
       o vão até a barra interna é curto. Flex em coluna = sobreposição impossível. */
    .vg-gc-sobre { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 12px;
      display: flex; flex-direction: column; align-items: center; gap: 2px; white-space: nowrap; z-index: 7; }
    .vg-gc-sobre .vg-gc-perdido { position: static; transform: none; margin: 0; }
    .vg-gc-meses { display: flex; gap: 30px; padding-top: 14px; border-top: 1px solid #e4e9ee; }
    .vg-gc-mes { width: 88px; flex-shrink: 0; text-align: center; font-size: 13px; font-weight: 600; color: #52606d; }
    .vg-gc-foot { font-size: 12px; color: #a6b1bc; padding-left: 76px; margin-top: 4px; }
    .vg-rank-scroll { max-height: 520px; overflow-y: auto; padding-right: 6px; }
    .vg-rank-scroll::-webkit-scrollbar { width: 7px; }
    .vg-rank-scroll::-webkit-scrollbar-thumb { background: #D3DEDA; border-radius: 4px; }
    .vg-rank-row { display: flex; gap: 12px; align-items: center; padding: 4px 6px; border-radius: 9px; transition: background .12s; }
    .vg-rank-row:hover { background: #F5F8F6; }
    .vg-rank-pos { width: 26px; height: 26px; flex: 0 0 26px; border-radius: 50%; background: #06283A; color: #fff; font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
    .vg-pos-glosa { background: #A35A2A; }
    .vg-rank-body { flex: 1; min-width: 0; }
    .vg-rank-top { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
    .vg-rank-nome { font-size: 13px; font-weight: 600; color: var(--ink); line-height: 1.25; }
    .vg-rank-val { font-size: 13px; font-weight: 800; color: #005073; white-space: nowrap; }
    .vg-val-glosa { color: #A35A2A; }
    .vg-rank-barra { height: 6px; background: #EDF1EF; border-radius: 4px; margin: 4px 0 2px; overflow: hidden; }
    .vg-rank-fill { height: 100%; background: linear-gradient(90deg, #005073, #1EBBD7); border-radius: 4px; }
    .vg-fill-glosa { background: linear-gradient(90deg, #A35A2A, #D89A5A); }
    .vg-rank-pct { font-size: 11px; color: var(--ink-faint); }
    .vg-vazio { color: var(--ink-faint); font-size: 13px; padding: 12px 4px; }

    .vg-drill { border-color: #B8965A; box-shadow: 0 6px 18px rgba(184,150,90,.12); }
    .vg-drill-fechar { margin-left: auto; background: none; border: none; color: var(--ink-faint); font-size: 12px; cursor: pointer; }
    .vg-drill-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .vg-drill-card { background: #FAFBFA; border: 1px solid var(--border); border-radius: 11px; padding: 13px 15px; display: flex; flex-direction: column; gap: 3px; }
    .vg-drill-card span { font-size: 11px; color: #000; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }   /* V553 */
    .vg-drill-card b { font-size: 19px; color: var(--ink); }
    .vg-drill-card small { font-size: 11px; color: var(--ink-faint); }
    .vg-drill-glosa b { color: #A35A2A; }

    @media (max-width: 1000px) {
      .vg-cards-grid { grid-template-columns: 1fr; }
      .vg-row-2 { grid-template-columns: 1fr; }
      .vg-drill-grid { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(s);
}
