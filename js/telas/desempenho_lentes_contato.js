/**
 * ============================================================================
 * TELA: Desempenho · Lentes de Contato (V2)
 *
 * Implementação completa do prompt de aprimoramento:
 *   1.  Cards KPI padronizados (referência: Admissões Distintas)
 *   2.  Drilldown com 4 sub-cards focados em Repasse
 *   3.  Matriz com 9 colunas (Admissões, Volume, vs LM, vs LY, Produção, TKM,
 *       Repassado, % Repasse) — todas ocultáveis exceto MÉDICO
 *   4.  Painel Ajustes: checkboxes de colunas + radio de TKM
 *   5.  Painel "Mostrar/Ocultar": ocultar R$ Repasse, ocultar R$ Produção,
 *       filtrar por médico
 *   6.  Botão [+] maximizar matriz (oculta menu/header)
 *   7.  Filtro anual ("Todos os meses") — vs LM vira vs AA
 *   8.  CRÍTICO: Produção = só linhas onde médico é executante
 *   9.  Tags [EXE] e [IND] ao lado do nome
 *   10. Filtros Cód. Admissão / Cód. Paciente / Nome Paciente (LIKE cumulativo)
 *   11. Exportação Excel: Matriz | Por Médico (mensal) | Consolidado Anual
 *
 * Regras de inclusão de médicos na matriz:
 *   - Internos/Híbridos: aparecem se tiverem QUALQUER produção/indicação
 *   - Externos: aparecem SE forem indicantes (Repasse R$ 0,00 — informativo)
 *
 * Cálculo de Produção (#8):
 *   - Soma valor APENAS das linhas onde o médico é executante
 *   - Linhas onde ele é só indicante NÃO entram no Produção/Receita
 *
 * Repasse:
 *   - 18% Executante × valor das linhas que executou (só IH)
 *   - 9%  Indicante  × valor das linhas que indicou  (só IH)
 *   - Externos: R$ 0,00 sempre
 * ============================================================================
 */

App.telas['desempenho-lentes-contato'] = function () {

  // ==========================================================================
  // CATÁLOGO DE COLUNAS DA MATRIZ
  // ==========================================================================
  // Declarado AQUI no topo (não no meio do arquivo) porque é acessado por
  // múltiplas funções durante a primeira renderização. `var` ou `const` no
  // meio do escopo dariam TDZ — declaração aqui executa antes de qualquer
  // chamada a renderizar().
  // CATÁLOGO DE COLUNAS — labels são DEFAULTS. O usuário pode renomear
  // qualquer coluna no painel Ajustes (persiste em config_lentes_contato
  // como COL_NAME_<id>). Para restaurar o padrão, basta esvaziar o input.
  const COLUNAS = [
    { id: 'admissoes', label: 'Admissões', num: true,
      get: (m) => Utilidades.formatarNumero(m.admissoes) },
    { id: 'volume', label: 'Volume', num: true,
      get: (m) => Utilidades.formatarNumero(m.volume) },
    { id: 'volumeLM', label: 'Vol vs LM', num: true,
      get: (m, _, ctx) => badgeComparativoMini(m.volume, m.volumeLM) },
    { id: 'volumeLY', label: 'Vol vs LY', num: true,
      get: (m, _, ctx) => badgeComparativoMini(m.volume, m.volumeLY) },
    { id: 'producao', label: 'Produção', num: true,
      get: (m, cfg) => window.__lc.ocultarProducao ? '—' : fmtMoeda(m.producao, cfg.casasMoeda) },
    { id: 'tkm', label: 'Ticket Médio', num: true,
      get: (m, cfg) => window.__lc.ocultarProducao ? '—' : fmtMoeda(m.tkm, cfg.casasMoeda) },
    { id: 'repassado', label: 'Repassado', num: true, dest: true,
      get: (m, cfg) => window.__lc.ocultarRepasse ? '—' : fmtMoeda(m.repassado, cfg.casasMoeda) },
    { id: 'pctRepasse', label: '% Repasse', num: true,
      get: (m, cfg) => window.__lc.ocultarRepasse ? '—' : fmtPct(m.pctRepasse, cfg.casasPct) },
  ];

  /**
   * Retorna o label da coluna (customizado ou padrão).
   * Os nomes customizados vêm de `cfg.colunasNomes[id]` ou caem no padrão.
   */
  function labelColuna(col, cfg) {
    return (cfg.colunasNomes && cfg.colunasNomes[col.id]) || col.label;
  }

  // Meses por extenso (fileira de filtros 20C) — declarado AQUI no topo pelo
  // mesmo motivo do COLUNAS: renderizar() roda antes do resto do corpo (TDZ).
  const MESES_EXT_LC = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // Estado da tela
  if (window.__lc === undefined) {
    window.__lc = {
      anoSelecionado: null,
      mesSelecionado: null,    // null = "Todos os meses" (agregado anual)
      ajustesAberto: false,
      ocultarAberto: false,
      regrasAberto: false,
      admSemValorAberto: false,
      linhasExpandidas: new Set(),
      maximizado: false,
      // Visibilidade de colunas (ID padrão: todas visíveis)
      colunasVisiveis: new Set(['admissoes','volume','volumeLM','volumeLY','producao','tkm','repassado','pctRepasse']),
      // TKM: 'admissao' ou 'volume'
      tkmModo: 'admissao',
      // Ocultar R$
      ocultarRepasse: false,
      ocultarProducao: false,
      // Filtro por médico (Set de ids; vazio = mostrar todos)
      medicosFiltrados: new Set(),
      // Filtros texto
      filtroCodAdmissao: '',
      filtroCodPaciente: '',
      filtroNomePaciente: '',
      // Fileira de filtros 20C: qual célula está com o painel aberto (null = nenhuma)
      sbAberto: null,
    };
  }

  renderizar();

  function renderizar() {
    try {
      _renderizarInterno();
    } catch (e) {
      console.error('Erro Lentes de Contato:', e);
      const conteudo = document.getElementById('conteudo');
      if (conteudo) {
        conteudo.innerHTML = `
          <div class="page-content">
            <header class="page-header"><h2>Lentes de Contato</h2></header>
            <div class="card" style="background: #FEE; border-color: #D88; padding: 18px">
              <h3 style="margin: 0 0 8px; color: #9B3A3A">⚠ Erro ao renderizar</h3>
              <pre style="font-size: 11px; white-space: pre-wrap; background: white; padding: 12px; border-radius: 8px">${escapeHTML(e.message)}\n\n${escapeHTML(e.stack || '')}</pre>
            </div>
          </div>
        `;
      }
    }
  }

  function _renderizarInterno() {
    _existeCompMemo = new Map();  // V492: memoiza existeCompetencia por render (antes re-executava por indicador)
    // V492: CSS injetado 1x no <head> (antes: <style> inteiro re-parseado dentro do innerHTML a cada render)
    Utilidades.garantirEstilos('css-tela-desempenho-lentes-contato', getStyles());
    const cfg = carregarConfig();
    const periodos = listarPeriodos();
    const competenciaAtual = resolverCompetenciaAtual(periodos);

    if (competenciaAtual && !window.__lc.anoSelecionado) {
      const [ano, mes] = competenciaAtual.split('-');
      window.__lc.anoSelecionado = ano;
      window.__lc.mesSelecionado = mes;
    }

    // Calcula contexto (ano isolado ou ano+mês)
    const ctx = construirContexto();

    const indicadores = ctx.temDados ? calcularIndicadores(ctx, cfg) : null;
    const tabela = ctx.temDados ? calcularTabelaMedicos(ctx, cfg) : [];
    const tabelaFiltrada = aplicarFiltrosTexto(tabela, ctx);

    // Classe maximizado controla layout (menu/header escondidos via CSS)
    document.body.classList.toggle('lc-maximizado', window.__lc.maximizado);

    document.getElementById('conteudo').innerHTML = `
      <div class="page-content lc-page ${window.__lc.maximizado ? 'lc-page-maximizada' : ''}">
        ${renderHeader()}
        ${window.__lc.ajustesAberto ? renderPopoverAjustes(cfg) : ''}
        ${window.__lc.ocultarAberto ? renderPopoverOcultar(tabela) : ''}
        ${window.__lc.regrasAberto ? renderPopoverRegras(cfg) : ''}
        ${window.__lc.admSemValorAberto ? renderPopoverAdmSemValor(ctx) : ''}
        ${!window.__lc.maximizado ? renderFiltros(periodos, ctx) : ''}
        ${!window.__lc.maximizado ? renderCards(indicadores, cfg, ctx) : ''}
        ${renderTabela(tabelaFiltrada, ctx, cfg)}
      </div>
    `;

    bindEventos(cfg, tabela, ctx);
  }

  // ==========================================================================
  // CONTEXTO DE PERÍODO
  // ==========================================================================
  // Constrói o contexto de cálculo: competências do período atual, mês anterior
  // (ou ano anterior se for visão anual) e ano anterior do mesmo mês.

  function construirContexto() {
    const ano = window.__lc.anoSelecionado;
    const mes = window.__lc.mesSelecionado;
    const visaoAnual = !mes;  // sem mês = ano inteiro

    let competencias = [];
    let competenciasLM = [];
    let competenciasLY = [];
    let temDados = false;
    let labelComp = '';

    if (ano) {
      if (visaoAnual) {
        // Ano inteiro: aceita qualquer competência YYYY-MM
        competencias = competenciasDoAno(ano);
        competenciasLM = competenciasDoAno(String(Number(ano) - 1)); // "vs AA" = ano anterior inteiro
        competenciasLY = competenciasLM;                              // mesma coisa em visão anual
        labelComp = ano;
      } else {
        // Mês específico
        const comp = `${ano}-${mes}`;
        competencias = [comp];
        competenciasLM = [competenciaMesAnterior(comp)];
        competenciasLY = [competenciaAnoAnterior(comp)];
        labelComp = formatarCompetencia(comp);
      }
      temDados = competencias.some(c => existeCompetencia(c));
    }

    // Filtros de texto que se aplicam tanto a KPIs quanto à matriz.
    // Constrói cláusula SQL adicional (sempre começa com 'AND ...').
    const filtrosTexto = construirFiltrosTextoSQL();

    return {
      ano, mes, visaoAnual,
      competencias, competenciasLM, competenciasLY,
      temDados, labelComp,
      labelComparacao: visaoAnual ? 'vs AA' : 'vs LM',
      labelComparacaoLY: visaoAnual ? 'vs Ano-2' : 'vs LY',
      filtrosTexto,
    };
  }

  /**
   * Constrói cláusula SQL para os filtros de texto ativos (Cód. Admissão,
   * Cód. Paciente, Nome Paciente). Retorna objeto com:
   *   - sql:    string '' ou ' AND xxx AND yyy ...'
   *   - params: [...] valores para os placeholders
   *   - ativo:  boolean (true se há filtros)
   */
  function construirFiltrosTextoSQL() {
    const partes = [];
    const params = [];

    // V922: filtros MULTI — string legada ou array (união de LIKEs)
    const FM = Utilidades.filtroMulti;
    for (const [f, col] of [[window.__lc.filtroCodAdmissao, 'cod_admissao'],
                            [window.__lc.filtroCodPaciente, 'cod_paciente'],
                            [window.__lc.filtroNomePaciente, 'paciente']]) {
      const cond = FM.sqlLike(f, col, params);
      if (cond) partes.push(cond);
    }

    return {
      sql: partes.length > 0 ? ' AND ' + partes.join(' AND ') : '',
      params,
      ativo: partes.length > 0,
    };
  }

  function competenciasDoAno(ano) {
    return Banco.query(
      `SELECT DISTINCT competencia FROM linhas_producao
       WHERE categoria = 'Lentes de Contato' AND competencia LIKE ?
       ORDER BY competencia`,
      [`${ano}-%`]
    ).map(r => r.competencia);
  }

  var _existeCompMemo = null;  // V492: memo por render (resetado no início de _renderizarInterno)
  function existeCompetencia(comp) {
    if (_existeCompMemo && _existeCompMemo.has(comp)) return _existeCompMemo.get(comp);  // V492
    const r = Banco.queryUnica(
      `SELECT 1 FROM linhas_producao WHERE competencia = ? AND categoria = 'Lentes de Contato' LIMIT 1`,
      [comp]
    );
    const existe = !!r;
    if (_existeCompMemo) _existeCompMemo.set(comp, existe);  // V492
    return existe;
  }

  /**
   * Carrega valores distintos para popular os comboboxes.
   * Restringe ao mesmo período ativo no filtro (ano ou ano+mês) para não
   * mostrar opções irrelevantes. Limita resultado para performance.
   *
   * @param tipo 'cod-adm' | 'cod-pac' | 'nome-pac'
   * @return string[] ordenado
   */
  function carregarOpcoesCombo(tipo) {
    const ctx = construirContexto();
    if (!ctx.competencias || ctx.competencias.length === 0) return [];

    const coluna = tipo === 'cod-adm' ? 'cod_admissao'
                 : tipo === 'cod-pac' ? 'cod_paciente'
                 : 'paciente';
    const placeholders = ctx.competencias.map(() => '?').join(',');
    const rows = Banco.query(
      `SELECT DISTINCT ${coluna} AS v
       FROM linhas_producao
       WHERE categoria = 'Lentes de Contato'
         AND competencia IN (${placeholders})
         AND ${coluna} IS NOT NULL AND ${coluna} != ''
       ORDER BY ${coluna}
       LIMIT 1000`,
      ctx.competencias
    );
    return rows.map(r => String(r.v));
  }

  // ==========================================================================
  // HEADER
  // ==========================================================================

  function renderHeader() {
    if (window.__lc.maximizado) {
      // No modo maximizado, barra discreta com período + botão de restaurar
      const ctx = construirContexto();
      return `
        <div class="lc-header-max">
          <div>
            <strong>Lentes de Contato</strong>
            <span style="opacity: 0.7; font-weight: 500; margin-left: 10px; font-size: 12px">
              Período: ${ctx.labelComp || '—'}
            </span>
          </div>
          <button class="btn" id="btn-lc-restaurar" title="Restaurar">−</button>
        </div>
      `;
    }
    return `
      <header class="page-header">
        <div>
          <div class="lc-titulo-wrap">
            <h2>Lentes de Contato</h2>
            <button class="lc-btn-info" id="btn-lc-info" title="Regras de repasse de Lentes de Contato">ⓘ</button>
          </div>
          <div class="subtitle">Dashboard analítico — Categoria "Lentes de Contato" do relatório de produção</div>
        </div>
        <div class="lc-header-acoes">
          <button class="btn ${(window.__lc.ocultarRepasse || window.__lc.ocultarProducao) ? 'btn-primary' : ''}" id="btn-lc-ocultar" title="Modo de exibição">👁 Visualização ▾</button>
          <button class="btn" id="btn-lc-ajustes" title="Ajustes de repasse, colunas e formato">⚙ Ajustes</button>
          <button class="btn btn-primary" id="btn-lc-exportar">↓ Exportar Excel <span style="font-size: 9px">▾</span></button>
        </div>
      </header>
    `;
  }

  // ==========================================================================
  // FILTROS (período + texto)
  // ==========================================================================

  function renderFiltros(periodos, ctx) {
    if (periodos.length === 0 && !ctx.ano) return '';

    const anosMap = new Map();
    for (const p of periodos) {
      const [ano, mes] = p.split('-');
      if (!anosMap.has(ano)) anosMap.set(ano, []);
      anosMap.get(ano).push(mes);
    }
    const anos = Array.from(anosMap.keys()).sort().reverse();
    const anoAtual = window.__lc.anoSelecionado;
    const mesesDoAno = anosMap.get(anoAtual) || [];

    const temFiltrosTexto = Utilidades.filtroMulti.ativo(window.__lc.filtroCodAdmissao)
      || Utilidades.filtroMulti.ativo(window.__lc.filtroCodPaciente)
      || Utilidades.filtroMulti.ativo(window.__lc.filtroNomePaciente);
    const temFiltrosMedicos = window.__lc.medicosFiltrados.size > 0;

    return `
      <div class="lc-filtros-bar">
        ${renderBarraFiltrosLc20C(anos, mesesDoAno.slice().sort())}
        ${(temFiltrosTexto || temFiltrosMedicos) ? `
          <button class="btn btn-pequeno" id="btn-limpar-filtros" title="Limpar todos os filtros">✕ Limpar filtros</button>
        ` : ''}
      </div>
      ${temFiltrosMedicos ? `
        <div class="lc-filtro-medicos-badge">
          <span style="color: var(--accent); font-weight: 700">●</span>
          Filtrando <strong>${window.__lc.medicosFiltrados.size}</strong> médico${window.__lc.medicosFiltrados.size !== 1 ? 's' : ''}
          <button class="lc-badge-x" id="btn-limpar-filtro-medicos">×</button>
        </div>
      ` : ''}
    `;
  }

  // ── Fileira de filtros 20C (mesmo padrão do LIO/OPME, prefixo lc-sb) ──────
  // Individualidades do LC: Ano · Mês (com "Todos os meses" = visão anual) ·
  // Cód. Admissão · Cód. Paciente · Nome do Paciente. Painéis abrem/fecham
  // LOCAL (insertAdjacentHTML — zero re-render); aplicar seta a MESMA chave de
  // state dos handlers antigos e chama renderizar(). MESES_EXT_LC: ver topo.
  function _lcSbIc(nome) {
    return {
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      alignleft: '<line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/>',
      user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
      search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
      check: '<polyline points="20 6 9 17 4 12"/>',
      chev: '<polyline points="6 9 12 15 18 9"/>',
    }[nome] || '';
  }
  function _lcSbSvg(d, px, sw) {
    return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  function _lcSbSemAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function renderBarraFiltrosLc20C(anos, mesesDoAno) {
    // guarda as listas pro painel abrir LOCAL depois, sem recoletar;
    // opções dos combos são carregadas sob demanda em painelLc20C (cache por render)
    window.__lc._sbOpcoes = { anos: anos.slice(), meses: mesesDoAno.slice() };
    const cel = (id, rotulo, valor, icone, flex, vazio = 'Todos') => {
      const ativo = !!valor;
      const estaAberta = window.__lc.sbAberto === id;
      return `
        <div class="lc-sb-celwrap" style="flex:${flex}">
          <button type="button" class="lc-sb-cel ${ativo ? 'ativo' : ''} ${estaAberta ? 'aberta' : ''}"
                  data-sb-cel="${id}" data-sb-vazio="${vazio}" role="combobox" aria-expanded="${estaAberta ? 'true' : 'false'}" aria-haspopup="listbox">
            <span class="lc-sb-tile">${_lcSbSvg(_lcSbIc(icone), 14, 2.1)}</span>
            <span class="lc-sb-tx">
              <span class="lc-sb-rot">${rotulo}</span>
              <span class="lc-sb-val">${escapeHTML(valor || vazio)}</span>
            </span>
            <span class="lc-sb-chev">${_lcSbSvg(_lcSbIc('chev'), 10, 2.8)}</span>
          </button>
          ${estaAberta ? painelLc20C(id) : ''}
        </div>`;
    };
    const mesLabel = window.__lc.mesSelecionado
      ? (MESES_EXT_LC[Number(window.__lc.mesSelecionado) - 1] || window.__lc.mesSelecionado)
      : '';
    // V922: rótulo dos filtros multi ("N selecionados")
    const FM = Utilidades.filtroMulti;
    const rotMulti = (f) => FM.ativo(f) ? FM.rotulo(f) : '';
    return `
      <div class="lc-sb" id="lc-sb">
        ${cel('ano', 'Ano', window.__lc.anoSelecionado || '', 'clock', 0.75, '—')}
        ${cel('mes', 'Mês', mesLabel, 'calendar', 0.9, 'Todos os meses')}
        ${cel('cod-adm', 'Cód. Admissão', rotMulti(window.__lc.filtroCodAdmissao), 'alignleft', 1.05)}
        ${cel('cod-pac', 'Cód. Paciente', rotMulti(window.__lc.filtroCodPaciente), 'hash', 1.05)}
        ${cel('nome-pac', 'Nome do Paciente', rotMulti(window.__lc.filtroNomePaciente), 'user', 1.35)}
      </div>`;
  }

  function painelLc20C(id) {
    const opc = window.__lc._sbOpcoes || (window.__lc._sbOpcoes = {});
    const item = (val, rotulo, sel) => `
      <div class="lc-sb-it ${sel ? 'sel' : ''} ${val === '' ? 'lc-sb-it-todos' : ''}" data-sb-item data-val="${escapeAttr(val)}" data-busca="${escapeAttr(_lcSbSemAcento(rotulo))}" role="option" aria-selected="${sel ? 'true' : 'false'}">
        <span class="lc-sb-it-nome">${escapeHTML(rotulo)}</span>
        ${sel ? `<span class="lc-sb-ck">${_lcSbSvg(_lcSbIc('check'), 14, 2.5)}</span>` : ''}
      </div>`;
    const painelLista = (cel, pares, valAtual, { busca = false, todosRotulo = 'Todos', semTodos = false } = {}) => `
      <div class="lc-sb-painel" data-sb-painel="${cel}">
        ${busca ? `
          <div class="lc-sb-buscabox">
            <span class="lc-sb-busca-ic">${_lcSbSvg(_lcSbIc('search'), 15, 2.1)}</span>
            <input type="text" class="lc-sb-busca" data-sb-busca placeholder="Digite pra buscar" autocomplete="off">
          </div>` : ''}
        <div class="lc-sb-lista" role="listbox">
          ${semTodos ? '' : item('', todosRotulo, !valAtual)}
          ${pares.slice(0, 400).map(p => item(p.v, p.r, valAtual === p.v)).join('')}
        </div>
        ${busca ? `<div class="lc-sb-rodape" data-sb-contagem>${pares.length} opç${pares.length === 1 ? 'ão' : 'ões'}</div>` : ''}
      </div>`;
    if (id === 'ano') {
      // sem "Todos": um ano está sempre selecionado (igual ao select antigo)
      return painelLista('ano', (opc.anos || []).map(a => ({ v: a, r: a })), window.__lc.anoSelecionado || '', { semTodos: true });
    }
    if (id === 'mes') {
      return painelLista('mes', (opc.meses || []).map(m => ({ v: m, r: MESES_EXT_LC[Number(m) - 1] || m })), window.__lc.mesSelecionado || '', { todosRotulo: 'Todos os meses' });
    }
    // Combos de texto: MESMA fonte que o combo antigo usava (carregarOpcoesCombo),
    // carregada sob demanda e cacheada até o próximo render
    if (!opc[id]) opc[id] = carregarOpcoesCombo(id);
    // V922: MULTI — checkbox por item, marcados no topo, busca sempre presente
    const FM = Utilidades.filtroMulti;
    const fAtual = id === 'cod-adm' ? window.__lc.filtroCodAdmissao
                 : id === 'cod-pac' ? window.__lc.filtroCodPaciente
                 : window.__lc.filtroNomePaciente;
    const sel = FM.sel(fAtual);
    const marcadas = opc[id].filter(o => sel.includes(String(o)));
    const demais = opc[id].filter(o => !sel.includes(String(o)));
    return `
      <div class="lc-sb-painel" data-sb-painel="${id}" data-sb-multi="1">
        <div class="lc-sb-buscabox">
          <span class="lc-sb-busca-ic">${_lcSbSvg(_lcSbIc('search'), 15, 2.1)}</span>
          <input type="text" class="lc-sb-busca" data-sb-busca placeholder="Digite pra buscar" autocomplete="off">
        </div>
        <div class="lc-sb-lista" role="listbox">
          ${item('', 'Todos', sel.length === 0)}
          ${[...marcadas, ...demais].slice(0, 400).map(o => item(o, o, sel.includes(String(o)))).join('')}
        </div>
        <div class="lc-sb-rodape" data-sb-contagem>${sel.length ? `${sel.length} selecionado${sel.length === 1 ? '' : 's'} · ` : ''}${opc[id].length} opç${opc[id].length === 1 ? 'ão' : 'ões'}</div>
      </div>`;
  }

  function bindBarraFiltrosLc20C() {
    const sb = document.getElementById('lc-sb');
    if (!sb) return;
    const fecharPainelLocal = () => {
      sb.querySelectorAll('.lc-sb-painel').forEach(p => p.remove());
      sb.querySelectorAll('.lc-sb-cel.aberta').forEach(c => { c.classList.remove('aberta'); c.setAttribute('aria-expanded', 'false'); });
      window.__lc.sbAberto = null;
    };
    const aplicar = (celId, val) => {
      // MESMAS chaves de state e MESMO re-render dos handlers antigos
      if (celId === 'ano') {
        window.__lc.anoSelecionado = val;
        window.__lc.mesSelecionado = null;  // reseta para "Todos" (igual ao select antigo)
      } else if (celId === 'mes') {
        window.__lc.mesSelecionado = val || null;
      } else {
        // V922: combos de texto viraram MULTI — alterna e mantém a lista aberta
        const FM = Utilidades.filtroMulti;
        const campo = celId === 'cod-adm' ? 'filtroCodAdmissao'
          : celId === 'cod-pac' ? 'filtroCodPaciente' : 'filtroNomePaciente';
        const buscaEl = sb.querySelector('[data-sb-busca]');
        window.__lc._sbBusca = buscaEl ? buscaEl.value : '';
        window.__lc[campo] = val === '' ? [] : FM.toggle(window.__lc[campo], val);
        renderizar();   // sbAberto continua — o painel re-abre marcado
        return;
      }
      window.__lc._sbBusca = '';
      window.__lc.sbAberto = null;
      renderizar();
    };
    const wireInputsPainel = () => {
      const busca = sb.querySelector('[data-sb-busca]');
      if (!busca) return;
      setTimeout(() => busca.focus(), 0);
      const filtrar = () => {
        const q = _lcSbSemAcento(busca.value);
        const painel = busca.closest('.lc-sb-painel');
        let n = 0;
        painel.querySelectorAll('[data-sb-item]').forEach(el => {
          // V922: itens MARCADOS ficam sempre visíveis
          const mostra = el.classList.contains('lc-sb-it-todos') || el.classList.contains('sel') || !q || (el.dataset.busca || '').includes(q);
          el.style.display = mostra ? '' : 'none';
          if (mostra && !el.classList.contains('lc-sb-it-todos')) n++;
        });
        const cont = painel.querySelector('[data-sb-contagem]');
        if (cont) cont.textContent = `${n} opç${n === 1 ? 'ão' : 'ões'}`;
      };
      busca.addEventListener('input', filtrar);
      if (window.__lc._sbBusca) { busca.value = window.__lc._sbBusca; filtrar(); }   // V922
    };
    const abrirPainelLocal = (id) => {
      const jaAberto = window.__lc.sbAberto === id;
      fecharPainelLocal();
      window.__lc._sbBusca = '';   // V922: busca não vaza de um painel pro outro
      if (jaAberto) return;
      window.__lc.sbAberto = id;
      const btn = sb.querySelector(`[data-sb-cel="${id}"]`);
      btn.classList.add('aberta');
      btn.setAttribute('aria-expanded', 'true');
      btn.parentElement.insertAdjacentHTML('beforeend', painelLc20C(id));
      wireInputsPainel();
    };
    // V922: o painel pode vir aberto do template (re-render após marcar)
    if (window.__lc.sbAberto && sb.querySelector('.lc-sb-painel')) wireInputsPainel();
    sb.addEventListener('click', (e) => {
      const it = e.target.closest('[data-sb-item]');
      if (it) {
        e.stopPropagation();
        aplicar(it.closest('[data-sb-painel]').dataset.sbPainel, it.dataset.val);
        return;
      }
      const celBtn = e.target.closest('[data-sb-cel]');
      if (celBtn) { e.stopPropagation(); abrirPainelLocal(celBtn.dataset.sbCel); return; }
      e.stopPropagation();
    });
    sb.addEventListener('keydown', (e) => {
      if (!window.__lc.sbAberto) return;
      const painel = sb.querySelector('.lc-sb-painel');
      if (!painel) return;
      const its = [...painel.querySelectorAll('[data-sb-item]')].filter(el => el.style.display !== 'none');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        let i = its.findIndex(x => x.classList.contains('foco'));
        its.forEach(x => x.classList.remove('foco'));
        i = e.key === 'ArrowDown' ? Math.min(its.length - 1, i + 1) : Math.max(0, i - 1);
        if (its[i]) { its[i].classList.add('foco'); its[i].scrollIntoView({ block: 'nearest' }); }
      } else if (e.key === 'Enter') {
        const f = its.find(x => x.classList.contains('foco'));
        if (f) { e.preventDefault(); aplicar(painel.dataset.sbPainel, f.dataset.val); }
      }
    });
    if (window.__lcSbFechar) {
      document.removeEventListener('click', window.__lcSbFechar);
      document.removeEventListener('keydown', window.__lcSbEsc);
    }
    const fecharFora = (e) => {
      if (App.telaAtual !== 'desempenho-lentes-contato') return;
      if (window.__lc.sbAberto && !e.target.closest('#lc-sb')) fecharPainelLocal();
    };
    const escFecha = (e) => {
      if (App.telaAtual !== 'desempenho-lentes-contato') return;
      if (e.key === 'Escape' && window.__lc.sbAberto) fecharPainelLocal();
    };
    window.__lcSbFechar = fecharFora;
    window.__lcSbEsc = escFecha;
    document.addEventListener('click', fecharFora);
    document.addEventListener('keydown', escFecha);
    if (window.__lc.sbAberto) wireInputsPainel();
  }

  function aplicarFiltrosTexto(tabela, ctx) {
    // Os filtros de texto (Cód. Admissão, Cód. Paciente, Nome Paciente) já
    // foram aplicados via SQL em `calcularTabelaMedicos`. Aqui só sobra o
    // filtro por médicos selecionados (checkboxes do popover Mostrar/Ocultar).
    let resultado = tabela;
    if (window.__lc.medicosFiltrados.size > 0) {
      resultado = resultado.filter(m => window.__lc.medicosFiltrados.has(m.id));
    }
    return resultado;
  }

  // ==========================================================================
  // CARDS DE INDICADORES (KPIs)
  // ==========================================================================
  // Padronização: todos os 5 cards têm a mesma estrutura
  //   ┌──────────────┐
  //   │ LABEL SUPERIOR (muted)
  //   │ VALOR PRINCIPAL (bold, destaque)
  //   │ vs LM/AA  ↑12,3%
  //   │ vs LY     ↓2,1%
  //   └──────────────┘
  // Referência: card "Admissões Distintas"

  function renderCards(ind, cfg, ctx) {
    if (!ind) {
      return `
        <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 30px 20px">
          <div style="color: var(--ink-faint); font-size: 13px">
            Nenhuma produção importada ainda.<br>
            <span style="font-size: 11px">Vá em Processamento → Importar PRODUÇÃO para começar.</span>
          </div>
        </div>
      `;
    }

    const valorReceita = window.__lc.ocultarProducao
      ? '—'
      : fmtMoeda(ind.receita.atual, cfg.casasMoeda);
    const valorRepasse = window.__lc.ocultarRepasse
      ? '—'
      : fmtMoeda(ind.repasse.atual, cfg.casasMoeda);

    return `
      <div class="lc-cards-grid">
        ${renderCard({
          titulo: 'Admissões Distintas',
          valor: Utilidades.formatarNumero(ind.admissoes.atual),
          tema: 'verde',
          comparativos: comparativosHtml(ind.admissoes, ctx),
        })}
        ${renderCard({
          titulo: 'Quantidade Total',
          valor: Utilidades.formatarNumero(ind.quantidade.atual),
          tema: 'roxo',
          comparativos: comparativosHtml(ind.quantidade, ctx),
        })}
        ${renderCard({
          titulo: 'Receita',
          valor: valorReceita,
          tema: 'azul',
          comparativos: comparativosHtml(ind.receita, ctx),
        })}
        ${renderCard({
          titulo: 'Admissões Sem Valor',
          valor: `${Utilidades.formatarNumero(ind.admSemValor.atual)} <span class="lc-card-valor-pct">(${fmtPct(ind.pctSemValor.atual, cfg.casasPct)})</span>`,
          tema: 'bege',
          comparativos: comparativosHtml(ind.admSemValor, ctx),
          acao: `<button class="lc-card-acao" id="btn-lc-adm-sv" title="Ver admissões sem valor">📋</button>`,
        })}
        ${renderCard({
          titulo: 'Repasse Total',
          valor: valorRepasse,
          tema: 'destaque',
          comparativos: comparativosHtml(ind.repasse, ctx),
        })}
      </div>
    `;
  }

  function renderCard({ titulo, valor, tema, comparativos, acao }) {
    return `
      <div class="lc-card lc-card-${tema}">
        <div class="lc-card-faixa"></div>
        ${acao ? `<div class="lc-card-acao-wrap">${acao}</div>` : ''}
        <div class="lc-card-titulo">${titulo}</div>
        <div class="lc-card-valor mono">${valor}</div>
        <div class="lc-card-comp">${comparativos}</div>
      </div>
    `;
  }

  function comparativosHtml(dado, ctx, ePontual = false) {
    return `
      <div class="lc-card-comp-linha">
        <span class="lc-card-comp-lbl">${ctx.labelComparacao}</span>
        ${badgeComparativo(dado.atual, dado.lm, ePontual)}
      </div>
      <div class="lc-card-comp-linha">
        <span class="lc-card-comp-lbl">${ctx.labelComparacaoLY}</span>
        ${badgeComparativo(dado.atual, dado.ly, ePontual)}
      </div>
    `;
  }

  function badgeComparativo(atual, comparativo, ePontual = false) {
    if (comparativo === null || comparativo === undefined) {
      return '<span class="lc-card-comp-vazio">—</span>';
    }
    if (ePontual) {
      const diff = (atual || 0) - (comparativo || 0);
      if (Math.abs(diff) < 0.01) return `<span class="lc-card-comp-igual">↔ 0,0 pp</span>`;
      const cls = diff > 0 ? 'lc-card-comp-up' : 'lc-card-comp-down';
      const seta = diff > 0 ? '↑' : '↓';
      return `<span class="lc-card-comp-badge ${cls}">${seta} ${Utilidades.formatarNumero(Math.abs(diff), 1)} pp</span>`;
    }
    if (!comparativo) {
      if (atual > 0) return `<span class="lc-card-comp-badge lc-card-comp-up">↑ novo</span>`;
      return `<span class="lc-card-comp-igual">↔ 0,0%</span>`;
    }
    const pct = ((atual - comparativo) / comparativo) * 100;
    if (Math.abs(pct) < 0.05) return `<span class="lc-card-comp-igual">↔ 0,0%</span>`;
    const cls = pct > 0 ? 'lc-card-comp-up' : 'lc-card-comp-down';
    const seta = pct > 0 ? '↑' : '↓';
    return `<span class="lc-card-comp-badge ${cls}">${seta} ${Utilidades.formatarNumero(Math.abs(pct), 1)}%</span>`;
  }

  // ==========================================================================
  // TABELA (matriz) com 9 colunas
  // ==========================================================================

  // Definição de colunas: ver topo do arquivo (variável COLUNAS).

  function colunasAtivas() {
    return COLUNAS.filter(c => window.__lc.colunasVisiveis.has(c.id));
  }

  function badgeComparativoMini(atual, comp) {
    if (comp === null || comp === undefined) {
      return '<span class="lc-card-comp-vazio">—</span>';
    }
    if (!comp) {
      if (atual > 0) return `<span class="lc-card-comp-badge lc-card-comp-up">↑ novo</span>`;
      return `<span class="lc-card-comp-igual">↔</span>`;
    }
    const pct = ((atual - comp) / comp) * 100;
    if (Math.abs(pct) < 0.05) return `<span class="lc-card-comp-igual">↔ 0,0%</span>`;
    const cls = pct > 0 ? 'lc-card-comp-up' : 'lc-card-comp-down';
    const seta = pct > 0 ? '↑' : '↓';
    return `<span class="lc-card-comp-badge ${cls}">${seta} ${Utilidades.formatarNumero(Math.abs(pct), 1)}%</span>`;
  }

  function renderTabela(linhas, ctx, cfg) {
    if (!ctx.temDados) return '';

    if (linhas.length === 0) {
      return renderDiagnosticoVazio(ctx);
    }

    const cols = colunasAtivas();

    // Totais
    const totais = linhas.reduce((acc, m) => ({
      admissoes: acc.admissoes + (m.admissoes || 0),
      volume:    acc.volume    + (m.volume || 0),
      producao:  acc.producao  + (m.producao || 0),
      repassado: acc.repassado + (m.repassado || 0),
    }), { admissoes: 0, volume: 0, producao: 0, repassado: 0 });
    const tkmTotal = window.__lc.tkmModo === 'admissao'
      ? (totais.admissoes > 0 ? totais.producao / totais.admissoes : 0)
      : (totais.volume    > 0 ? totais.producao / totais.volume    : 0);
    const pctTotal = totais.producao > 0 ? (totais.repassado / totais.producao * 100) : 0;

    return `
      <div class="lc-secao-label lc-secao-matriz-header">
        <div>
          Detalhamento por médico
          <span style="font-size: 10px; color: var(--ink-faint); font-weight: 500; text-transform: none; letter-spacing: 0; margin-left: 6px">
            · ${linhas.length} médico${linhas.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button class="lc-btn-max" id="btn-lc-maximizar" title="${window.__lc.maximizado ? 'Restaurar' : 'Maximizar matriz'}">
          ${window.__lc.maximizado ? '−' : '+'}
        </button>
      </div>
      ${renderDetalheAdmissao(ctx)}
      <div class="card lc-matriz-card" style="padding: 0; overflow: clip"><!-- V961: clip (não hidden) — hidden vira contêiner de rolagem e anula o cabeçalho fixo -->
        <div class="lc-matriz-wrap" style="overflow-x: clip">
          <table class="data-table lc-tabela">
            <thead>
              <tr>
                <th style="width: 36px"></th>
                <th>Médico</th>
                ${cols.map(c => `<th class="${c.num ? 'num' : ''}">${escapeHTML(labelColuna(c, cfg))}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${linhas.map(m => renderLinhaMedico(m, cfg, ctx, cols)).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td></td>
                <td style="font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em">
                  Total ${ctx.labelComp}
                </td>
                ${cols.map(c => renderTotalCell(c, totais, tkmTotal, pctTotal, cfg)).join('')}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
  }

  /**
   * Card de detalhes da admissão quando o usuário filtra por um Cód. Admissão
   * específico. Mostra TODAS as linhas da admissão (qualquer categoria),
   * listando "PRODUTO — R$ VALOR" para cada uma. A soma dos valores aqui
   * deve bater com o que aparece na linha do médico, já que ambos usam as
   * mesmas linhas da base.
   *
   * Retorna '' (nada) quando não há filtro de Cód. Admissão ativo OU quando
   * o filtro bate com múltiplas admissões parcialmente.
   */
  function renderDetalheAdmissao(ctx) {
    // V922: o filtro pode ser MULTI — o detalhe só abre com UMA marcada
    const selAdm = Utilidades.filtroMulti.sel(window.__lc.filtroCodAdmissao);
    if (selAdm.length !== 1) return '';
    const filtroAdm = String(selAdm[0]).trim();

    // Quais admissões batem com o filtro? Procuramos pelas admissões que
    // têm AO MENOS uma linha em categoria 'Lentes de Contato' (pq o filtro
    // só faz sentido nesse contexto), mas as linhas exibidas podem ser de
    // qualquer categoria da mesma admissão.
    const phComps = ctx.competencias.map(() => '?').join(',');
    const matches = Banco.query(
      `SELECT DISTINCT cod_admissao
       FROM linhas_producao
       WHERE categoria = 'Lentes de Contato'
         AND competencia IN (${phComps})
         AND UPPER(cod_admissao) LIKE ?
       LIMIT 5`,
      [...ctx.competencias, '%' + filtroAdm.toUpperCase() + '%']
    );

    if (matches.length === 0) return '';

    // Filtro bate com várias admissões → não detalha (seria muita coisa)
    if (matches.length > 1) {
      return `
        <div class="lc-detalhe-adm lc-detalhe-adm-multi">
          <span class="lc-detalhe-icon">⚠</span>
          <span><strong>${matches.length}</strong> admissões correspondem ao filtro "<strong>${escapeHTML(filtroAdm)}</strong>". Refine para ver os produtos.</span>
        </div>
      `;
    }

    // 1 admissão — pega cabeçalho (1 linha) + TODAS as linhas (qualquer categoria)
    const cod = matches[0].cod_admissao;

    // Cabeçalho (paciente, data) — prioriza linha Exames se houver
    const cabec = Banco.queryUnica(
      `SELECT data_admissao, paciente
       FROM linhas_producao
       WHERE cod_admissao = ? AND categoria = 'Exames'
       LIMIT 1`,
      [cod]
    ) || Banco.queryUnica(
      `SELECT data_admissao, paciente
       FROM linhas_producao
       WHERE cod_admissao = ?
       LIMIT 1`,
      [cod]
    );

    // TODAS as linhas da admissão (qualquer categoria), ordenadas: LC primeiro,
    // depois Exames, depois outras; e por valor desc dentro de cada categoria.
    const linhas = Banco.query(
      `SELECT categoria,
              COALESCE(produto, '') AS produto,
              COALESCE(procedimento_principal, '') AS procedimento_principal,
              COALESCE(valor, 0) AS valor,
              COALESCE(quantidade, 0) AS quantidade
       FROM linhas_producao
       WHERE cod_admissao = ?
       ORDER BY
         CASE categoria
           WHEN 'Lentes de Contato' THEN 1
           WHEN 'Exames' THEN 2
           ELSE 3
         END,
         valor DESC`,
      [cod]
    );

    if (linhas.length === 0) return '';

    // Soma dos valores (= produção total da admissão)
    const total = linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);

    const dataAdm  = cabec?.data_admissao ? formatarDataBR(cabec.data_admissao) : '—';
    const paciente = cabec?.paciente || '—';

    return `
      <div class="lc-detalhe-adm">
        <div class="lc-detalhe-header">
          <span class="lc-detalhe-icon">📋</span>
          <span class="lc-detalhe-titulo">Detalhes da admissão filtrada</span>
        </div>
        <div class="lc-detalhe-resumo">
          <div class="lc-detalhe-campo">
            <div class="lc-detalhe-label">Cód. Admissão</div>
            <div class="lc-detalhe-valor mono">${escapeHTML(String(cod))}</div>
          </div>
          <div class="lc-detalhe-campo">
            <div class="lc-detalhe-label">Paciente</div>
            <div class="lc-detalhe-valor">${escapeHTML(paciente)}</div>
          </div>
          <div class="lc-detalhe-campo">
            <div class="lc-detalhe-label">Data</div>
            <div class="lc-detalhe-valor mono">${dataAdm}</div>
          </div>
        </div>

        <div class="lc-detalhe-produtos-label">
          Produtos & Procedimentos
          <span class="lc-detalhe-produtos-contagem">${linhas.length} ${linhas.length === 1 ? 'linha' : 'linhas'}</span>
        </div>
        <ul class="lc-detalhe-produtos">
          ${linhas.map(l => {
            const nome = l.produto || l.procedimento_principal || '(sem descrição)';
            const valor = Number(l.valor) || 0;
            const corValor = valor > 0 ? '' : 'lc-detalhe-produto-zero';
            return `
              <li class="lc-detalhe-produto">
                <span class="lc-detalhe-produto-nome">${escapeHTML(nome)}</span>
                <span class="lc-detalhe-produto-traco">—</span>
                <span class="lc-detalhe-produto-valor mono ${corValor}">${fmtMoeda(valor, 2)}</span>
              </li>
            `;
          }).join('')}
        </ul>
        <div class="lc-detalhe-total">
          <span>Total da admissão</span>
          <span class="mono">${fmtMoeda(total, 2)}</span>
        </div>
      </div>
    `;
  }

  function formatarDataBR(dataStr) {
    if (!dataStr) return '—';
    // Tenta detectar formato — AAAA-MM-DD ou DD/MM/AAAA
    const s = String(dataStr).trim();
    const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m1) return `${m1[3]}/${m1[2]}/${m1[1]}`;
    return s;
  }

  function renderTotalCell(c, totais, tkmTotal, pctTotal, cfg) {
    const v = (() => {
      switch (c.id) {
        case 'admissoes':  return Utilidades.formatarNumero(totais.admissoes);
        case 'volume':     return Utilidades.formatarNumero(totais.volume);
        case 'volumeLM':   return '';
        case 'volumeLY':   return '';
        case 'producao':   return window.__lc.ocultarProducao ? '—' : fmtMoeda(totais.producao, cfg.casasMoeda);
        case 'tkm':        return window.__lc.ocultarProducao ? '—' : fmtMoeda(tkmTotal, cfg.casasMoeda);
        case 'repassado':  return window.__lc.ocultarRepasse  ? '—' : fmtMoeda(totais.repassado, cfg.casasMoeda);
        case 'pctRepasse': return window.__lc.ocultarRepasse  ? '—' : fmtPct(pctTotal, cfg.casasPct);
        default: return '';
      }
    })();
    const rep = c.id === 'repassado' ? ' atlas-rep' : '';   // V962: valor de repasse em #1d4470
    return `<td class="${c.num ? 'num' : ''} mono${rep}"><strong>${v}</strong></td>`;
  }

  function renderLinhaMedico(m, cfg, ctx, cols) {
    const expandido = window.__lc.linhasExpandidas.has(m.id);
    const seta = expandido ? '▾' : '▸';

    const tags = [];
    if (m.tagExec)  tags.push('<span class="lc-tag-exe" title="Executante">EXE</span>');
    if (m.tagIndic) tags.push('<span class="lc-tag-ind" title="Indicante">IND</span>');

    let html = `
      <tr class="lc-linha-medico ${expandido ? 'lc-linha-expandida' : ''}" data-medico-id="${m.id}">
        <td class="lc-toggle" data-medico-id="${m.id}">${seta}</td>
        <td class="lc-col-medico">
          <div class="lc-col-medico-linha1">
            <span class="lc-col-medico-nome">${escapeHTML(CodigoMedico.exibir(m.nome))}</span>
            ${tags.join('')}
          </div>
          ${Utilidades.badgeTipoVinculo(m.tipo_vinculo) ? `
            <div class="lc-col-medico-linha2">${Utilidades.badgeTipoVinculo(m.tipo_vinculo)}</div>
          ` : ''}
        </td>
        ${cols.map(c => renderCelula(c, m, cfg, ctx)).join('')}
      </tr>
    `;

    if (expandido) {
      html += renderDrilldown(m, cfg, ctx, cols.length + 2);
    }

    return html;
  }

  function renderCelula(c, m, cfg, ctx) {
    const conteudo = c.get(m, cfg, ctx);
    const classes = ['mono'];
    if (c.num) classes.push('num');
    let estilo = '';
    if (c.id === 'repassado') classes.push('atlas-rep');   // V962: valor de repasse em #1d4470
    if (c.id === 'pctRepasse') estilo = 'color: var(--ink-soft); font-weight: 600';
    return `<td class="${classes.join(' ')}" style="${estilo}">${conteudo}</td>`;
  }

  // Drilldown: 4 sub-cards focados em REPASSE
  //   1. Repasse Executante (com vs LM/AA e vs LY)
  //   2. Repasse Indicante (com vs LM/AA e vs LY)
  //   3. Repasse Total vs LM/AA
  //   4. Repasse Total vs LY
  function renderDrilldown(m, cfg, ctx, colspan) {
    const ocultar = window.__lc.ocultarRepasse;
    return `
      <tr class="lc-linha-drilldown">
        <td colspan="${colspan}" style="padding: 14px 18px 18px 60px; background: #f6f4ef">
          <div class="lc-drilldown-grid">

            <div class="lc-drilldown-card lc-dd-exec">
              <div class="lc-drilldown-label">⊳ Repasse Executante</div>
              <div class="lc-drilldown-valor mono">${ocultar ? '—' : fmtMoeda(m.repasseExec, cfg.casasMoeda)}</div>
              ${ocultar ? '' : `
                <div class="lc-drilldown-comp">
                  <div><span class="lc-drilldown-lbl">${ctx.labelComparacao}</span> ${badgeComparativo(m.repasseExec, m.repasseExecLM)}</div>
                  <div><span class="lc-drilldown-lbl">${ctx.labelComparacaoLY}</span> ${badgeComparativo(m.repasseExec, m.repasseExecLY)}</div>
                </div>
              `}
            </div>

            <div class="lc-drilldown-card lc-dd-indic">
              <div class="lc-drilldown-label">⊳ Repasse Indicante</div>
              <div class="lc-drilldown-valor mono">${ocultar ? '—' : fmtMoeda(m.repasseIndic, cfg.casasMoeda)}</div>
              ${ocultar ? '' : `
                <div class="lc-drilldown-comp">
                  <div><span class="lc-drilldown-lbl">${ctx.labelComparacao}</span> ${badgeComparativo(m.repasseIndic, m.repasseIndicLM)}</div>
                  <div><span class="lc-drilldown-lbl">${ctx.labelComparacaoLY}</span> ${badgeComparativo(m.repasseIndic, m.repasseIndicLY)}</div>
                </div>
              `}
            </div>

            <div class="lc-drilldown-card lc-dd-total">
              <div class="lc-drilldown-label">Repasse Total ${ctx.labelComparacao}</div>
              <div class="lc-drilldown-valor mono">${ocultar ? '—' : fmtMoeda(m.repassadoLM, cfg.casasMoeda)}</div>
              ${ocultar ? '' : `
                <div class="lc-drilldown-comp">
                  ${badgeComparativo(m.repassado, m.repassadoLM)}
                </div>
              `}
            </div>

            <div class="lc-drilldown-card lc-dd-total">
              <div class="lc-drilldown-label">Repasse Total ${ctx.labelComparacaoLY}</div>
              <div class="lc-drilldown-valor mono">${ocultar ? '—' : fmtMoeda(m.repassadoLY, cfg.casasMoeda)}</div>
              ${ocultar ? '' : `
                <div class="lc-drilldown-comp">
                  ${badgeComparativo(m.repassado, m.repassadoLY)}
                </div>
              `}
            </div>

          </div>
        </td>
      </tr>
    `;
  }

  // ==========================================================================
  // CÁLCULOS
  // ==========================================================================

  function carregarConfig() {
    const cfg = {};
    Banco.query('SELECT chave, valor FROM config_lentes_contato').forEach(r => {
      cfg[r.chave] = Number(r.valor);
    });

    // Carrega nomes de coluna customizados (de tabela separada de TEXTO).
    // Cria a tabela se ainda não existir (compat com bancos antigos).
    let colunasNomes = {};
    try {
      Banco.executar(`
        CREATE TABLE IF NOT EXISTS config_textos_lentes_contato (
          chave         TEXT PRIMARY KEY,
          valor         TEXT,
          atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      Banco.query(`SELECT chave, valor FROM config_textos_lentes_contato`).forEach(r => {
        // chave = "COL_NAME_<id>" → extrai o id
        if (r.chave && r.chave.startsWith('COL_NAME_') && r.valor) {
          const id = r.chave.substring('COL_NAME_'.length);
          colunasNomes[id] = String(r.valor);
        }
      });
    } catch (e) {
      console.warn('config_textos_lentes_contato indisponível:', e.message);
    }

    return {
      pctExec:    cfg['PERCENTUAL_EXECUTANTE'] ?? 18,
      pctIndic:   cfg['PERCENTUAL_INDICANTE']  ?? 9,
      casasMoeda: Number.isFinite(cfg['CASAS_MOEDA']) ? Math.max(0, Math.min(4, cfg['CASAS_MOEDA'])) : 2,
      casasPct:   Number.isFinite(cfg['CASAS_PCT'])   ? Math.max(0, Math.min(4, cfg['CASAS_PCT']))   : 2,
      colunasNomes,
    };
  }

  function fmtMoeda(valor, casas) {
    const n = Number(valor) || 0;
    return 'R$ ' + Utilidades.formatarNumero(n, casas);
  }
  function fmtPct(valor, casas) {
    const n = Number(valor) || 0;
    return Utilidades.formatarNumero(n, casas) + '%';
  }

  function listarPeriodos() {
    return Banco.query(`
      SELECT DISTINCT competencia FROM linhas_producao
      WHERE categoria = 'Lentes de Contato'
      ORDER BY competencia DESC
    `).map(r => r.competencia);
  }

  function resolverCompetenciaAtual(periodos) {
    if (periodos.length === 0) return null;
    const hoje = new Date();
    const compHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    return periodos.includes(compHoje) ? compHoje : periodos[0];
  }

  function competenciaMesAnterior(comp) {
    const [a, m] = comp.split('-').map(Number);
    const mPrev = m === 1 ? 12 : m - 1;
    const aPrev = m === 1 ? a - 1 : a;
    return `${aPrev}-${String(mPrev).padStart(2, '0')}`;
  }
  function competenciaAnoAnterior(comp) {
    const [a, m] = comp.split('-').map(Number);
    return `${a - 1}-${String(m).padStart(2, '0')}`;
  }

  // Constrói o mapa nome->medico (incluindo sinônimos)
  function montarCadMap() {
    const cadMap = new Map();
    const medicos = Banco.query(`
      SELECT id, nome_oficial, nome_normalizado, tipo_vinculo
      FROM medicos WHERE ativo = 1
    `);
    const porId = new Map();
    medicos.forEach(m => {
      cadMap.set(m.nome_oficial.toUpperCase().trim(), m);
      cadMap.set(m.nome_normalizado, m);
      porId.set(m.id, m);
    });
    try {
      Banco.query(`
        SELECT s.grafia, s.grafia_normalizada, s.medico_id
        FROM sinonimos_medico s
        JOIN medicos m ON m.id = s.medico_id
        WHERE m.ativo = 1
      `).forEach(s => {
        const med = porId.get(s.medico_id);
        if (med) {
          cadMap.set(s.grafia.toUpperCase().trim(), med);
          cadMap.set(s.grafia_normalizada, med);
        }
      });
    } catch (e) { /* tabela pode não existir em bancos antigos */ }
    return cadMap;
  }

  // KPIs agregados (5 cards)
  // V492: antes cada indicador refazia as próprias queries (~30 queries/render):
  // 'receita' e 'repasse' rodavam a MESMA query + loop 2×, 'admSemValor' e
  // 'pctSemValor' repetiam os mesmos 2 COUNTs, e existeCompetencia re-executava
  // por indicador. Agora TODOS os indicadores de um período saem de uma única
  // passada (kpisPeriodo) e o resultado é remontado no mesmo formato
  // { atual, lm, ly } por indicador. Resultado idêntico.
  function calcularIndicadores(ctx, cfg) {
    const atual = kpisPeriodo(ctx.competencias, cfg, ctx.filtrosTexto);
    const lm = (ctx.competenciasLM.length && existeQualquer(ctx.competenciasLM))
      ? kpisPeriodo(ctx.competenciasLM, cfg, ctx.filtrosTexto) : null;
    // Em visão anual competenciasLY === competenciasLM (mesma referência) — reusa o cálculo.
    const ly = (ctx.competenciasLY.length && existeQualquer(ctx.competenciasLY))
      ? (ctx.competenciasLY === ctx.competenciasLM && lm ? lm : kpisPeriodo(ctx.competenciasLY, cfg, ctx.filtrosTexto))
      : null;
    const montar = (ind) => ({
      atual: atual[ind],
      lm:    lm ? lm[ind] : null,
      ly:    ly ? ly[ind] : null,
    });
    return {
      admissoes:    montar('admissoes'),
      quantidade:   montar('quantidade'),
      receita:      montar('receita'),
      admSemValor:  montar('admSemValor'),
      pctSemValor:  montar('pctSemValor'),
      repasse:      montar('repasse'),
    };
  }

  function existeQualquer(comps) {
    if (!comps || comps.length === 0) return false;
    return comps.some(c => existeCompetencia(c));
  }

  /**
   * V492: calcula TODOS os KPIs de um período (1 mês ou 1 ano inteiro) numa
   * única passada. Regras idênticas às do antigo kpiBase:
   *
   * REGRA #8 — Produção/Receita só conta linhas onde há executante interno/híbrido:
   * - admissoes: distinct cod_admissao
   * - quantidade: SUM(quantidade)
   * - receita: SUM(valor) só de linhas onde Médico/Cirurgião é IH (vinculado ou sinônimo)
   * - admSemValor: admissões cujo MAX(valor) = 0 (nenhuma linha LC com valor > 0)
   * - pctSemValor: admSemValor / total de admissões × 100
   * - repasse: 18% executante (só IH) + 9% indicante (só IH)
   *
   * @param filtros { sql, params, ativo } — filtros de texto adicionais
   */
  function kpisPeriodo(comps, cfg, filtros) {
    if (!comps || comps.length === 0) {
      return { admissoes: 0, quantidade: 0, receita: 0, admSemValor: 0, pctSemValor: 0, repasse: 0 };
    }
    const inIH = obterInternosHibridos();
    const filtroSql = filtros?.sql || '';
    const filtroParams = filtros?.params || [];
    const phComps = comps.map(() => '?').join(',');
    const params = [...comps, ...filtroParams];

    // Admissões distintas — também é o "total" usado no pctSemValor
    // (no código antigo era exatamente a mesma query executada 2×).
    const admissoes = Number(Banco.queryUnica(
      `SELECT COUNT(DISTINCT cod_admissao) AS v FROM linhas_producao
       WHERE categoria = 'Lentes de Contato' AND competencia IN (${phComps}) ${filtroSql}`,
      params
    )?.v) || 0;

    const quantidade = Number(Banco.queryUnica(
      `SELECT COALESCE(SUM(quantidade), 0) AS v FROM linhas_producao
       WHERE categoria = 'Lentes de Contato' AND competencia IN (${phComps}) ${filtroSql}`,
      params
    )?.v) || 0;

    // Admissão "sem valor" = nenhuma linha LC dela tem valor > 0
    // (todas as linhas LC = R$ 0). Subquery agrupa por cod_admissao
    // e seleciona apenas as que têm MAX(valor) = 0.
    const admSemValor = Number(Banco.queryUnica(
      `SELECT COUNT(*) AS v FROM (
         SELECT cod_admissao
         FROM linhas_producao
         WHERE categoria = 'Lentes de Contato' AND competencia IN (${phComps}) ${filtroSql}
         GROUP BY cod_admissao
         HAVING MAX(COALESCE(valor, 0)) = 0
       )`,
      params
    )?.v) || 0;
    const pctSemValor = admissoes > 0 ? (admSemValor / admissoes * 100) : 0;

    // Receita e Repasse precisam iterar pelas linhas (regra #8) — 1 leitura + 1 loop
    const linhas = Banco.query(
      `SELECT valor,
              UPPER(TRIM(COALESCE(medico, '')))      AS m,
              UPPER(TRIM(COALESCE(cirurgiao, '')))   AS c,
              UPPER(TRIM(COALESCE(indicante, '')))   AS i,
              UPPER(TRIM(COALESCE(solicitante, '')))AS s
       FROM linhas_producao
       WHERE categoria = 'Lentes de Contato' AND competencia IN (${phComps}) ${filtroSql}`,
      params
    );

    let receita = 0;
    let repasse = 0;
    const fExec = cfg.pctExec / 100;
    const fIndic = cfg.pctIndic / 100;
    for (const l of linhas) {
      const v = Number(l.valor) || 0;
      if (v <= 0) continue;
      const exec = l.m || l.c;
      const indic = l.i || l.s;
      const execEhIH = inIH.has(exec);
      if (execEhIH) receita += v;
      if (execEhIH) repasse += v * fExec;
      if (inIH.has(indic)) repasse += v * fIndic;
    }

    return { admissoes, quantidade, receita, admSemValor, pctSemValor, repasse };
  }

  var _internosHibridosCache = null;
  var _internosHibridosCacheVersao = null;  // V492: invalida o cache quando o banco muda (bug de cache velho)
  function obterInternosHibridos() {
    if (_internosHibridosCache && _internosHibridosCacheVersao === Banco._versao) return _internosHibridosCache;  // V492
    const s = new Set();
    Banco.query(`
      SELECT nome_oficial, nome_normalizado FROM medicos
      WHERE ativo = 1 AND tipo_vinculo IN ('INTERNO', 'HIBRIDO')
    `).forEach(m => {
      s.add(m.nome_oficial.toUpperCase().trim());
      s.add(m.nome_normalizado);
    });
    try {
      Banco.query(`
        SELECT s.grafia, s.grafia_normalizada FROM sinonimos_medico s
        JOIN medicos m ON m.id = s.medico_id
        WHERE m.ativo = 1 AND m.tipo_vinculo IN ('INTERNO', 'HIBRIDO')
      `).forEach(sin => {
        s.add(sin.grafia.toUpperCase().trim());
        s.add(sin.grafia_normalizada);
      });
    } catch (e) { /* ignore */ }
    _internosHibridosCache = s;
    _internosHibridosCacheVersao = Banco._versao;  // V492
    return s;
  }

  // Matriz: 1 linha por médico (Interno/Híbrido ou Externo-indicante)
  function calcularTabelaMedicos(ctx, cfg) {
    // Filtros de texto são aplicados ao período ATUAL para refletir os
    // valores filtrados. Para LM/LY (comparativos), aplicamos os mesmos
    // filtros — assim a comparação fica coerente (ex: "o mesmo paciente
    // mês anterior" se o filtro é por paciente).
    const cadMap = montarCadMap();  // V492: monta 1× e passa (antes: montado 3× — atual/LM/LY)
    const atual = agregarDetalhe(ctx.competencias,   cfg, true,  ctx.filtrosTexto, cadMap);
    const ehLM  = existeQualquer(ctx.competenciasLM) ? agregarDetalhe(ctx.competenciasLM, cfg, false, ctx.filtrosTexto, cadMap) : new Map();
    const ehLY  = existeQualquer(ctx.competenciasLY) ? agregarDetalhe(ctx.competenciasLY, cfg, false, ctx.filtrosTexto, cadMap) : new Map();

    const lista = Array.from(atual.values()).map(m => {
      const tkm = window.__lc.tkmModo === 'admissao'
        ? (m.admissoes > 0 ? m.producao / m.admissoes : 0)
        : (m.volume > 0    ? m.producao / m.volume    : 0);
      const pctRepasse = m.producao > 0 ? (m.repassado / m.producao * 100) : 0;
      return {
        ...m,
        tkm,
        pctRepasse,
        volumeLM:    ehLM.get(m.id)?.volume    ?? null,
        volumeLY:    ehLY.get(m.id)?.volume    ?? null,
        repassadoLM: ehLM.get(m.id)?.repassado ?? null,
        repassadoLY: ehLY.get(m.id)?.repassado ?? null,
        repasseExecLM:  ehLM.get(m.id)?.repasseExec  ?? null,
        repasseExecLY:  ehLY.get(m.id)?.repasseExec  ?? null,
        repasseIndicLM: ehLM.get(m.id)?.repasseIndic ?? null,
        repasseIndicLY: ehLY.get(m.id)?.repasseIndic ?? null,
      };
    });

    // Filtra apenas os relevantes:
    //  - tem produção (executou algo) OU
    //  - tem repasse (recebeu algo) OU
    //  - é externo que apareceu como indicante (mesmo sem repasse)
    return lista
      .filter(m => m.producao > 0 || m.repassado > 0 || m.tagIndic)
      .sort((a, b) => b.repassado - a.repassado);
  }

  /**
   * Agrega detalhes por médico para uma lista de competências.
   * Inclui Internos/Híbridos sempre, e Externos quando aparecem como indicantes.
   *
   * Para cada médico:
   *   admissoes:   distinct cod_admissao das linhas onde ele é executante
   *   volume:      SUM(quantidade) das linhas onde ele é executante
   *   producao:    SUM(valor) das linhas onde ele é executante (#8 crítica)
   *   repasseExec: 18% × producao  (se IH)
   *   repasseIndic: 9% × valor das linhas onde ele é indicante (se IH)
   *   repassado:   repasseExec + repasseIndic (Externos = 0)
   *   tagExec/tagIndic: se apareceu nessas funções
   */
  function agregarDetalhe(comps, cfg, marcarTags, filtros, cadMap) {
    const result = new Map();
    if (!comps || comps.length === 0) return result;
    cadMap = cadMap || montarCadMap();  // V492: recebe o cadMap pronto do chamador (fallback preserva compat)

    function getAcc(nomeUpper) {
      const med = cadMap.get(nomeUpper);
      if (!med) return null;
      if (!result.has(med.id)) {
        result.set(med.id, {
          id: med.id,
          nome: med.nome_oficial,
          tipo_vinculo: med.tipo_vinculo,
          admissoesSet: new Set(),
          admissoes: 0,
          volume: 0,
          producao: 0,
          repasseExec: 0,
          repasseIndic: 0,
          repassado: 0,
          tagExec: false,
          tagIndic: false,
        });
      }
      return result.get(med.id);
    }

    const ehIH = (med) => med && (med.tipo_vinculo === 'INTERNO' || med.tipo_vinculo === 'HIBRIDO');
    const fExec  = cfg.pctExec  / 100;
    const fIndic = cfg.pctIndic / 100;
    const filtroSql = filtros?.sql || '';
    const filtroParams = filtros?.params || [];

    const linhas = Banco.query(
      `SELECT cod_admissao,
              valor,
              COALESCE(quantidade, 0) AS quantidade,
              UPPER(TRIM(COALESCE(medico, '')))      AS m,
              UPPER(TRIM(COALESCE(cirurgiao, '')))   AS c,
              UPPER(TRIM(COALESCE(indicante, '')))   AS i,
              UPPER(TRIM(COALESCE(solicitante, '')))AS s
       FROM linhas_producao
       WHERE categoria = 'Lentes de Contato' AND competencia IN (${comps.map(() => '?').join(',')}) ${filtroSql}`,
      [...comps, ...filtroParams]
    );

    for (const l of linhas) {
      const v = Number(l.valor) || 0;
      const q = Number(l.quantidade) || 0;
      const execNome  = l.m || l.c;
      const indicNome = l.i || l.s;

      const execMed  = cadMap.get(execNome);
      const indicMed = cadMap.get(indicNome);

      // EXECUTANTE — só IH entra
      if (ehIH(execMed)) {
        const acc = getAcc(execNome);
        if (acc) {
          acc.admissoesSet.add(l.cod_admissao);
          acc.volume += q;
          if (v > 0) {
            acc.producao += v;
            acc.repasseExec += v * fExec;
          }
          if (marcarTags) acc.tagExec = true;
        }
      }

      // INDICANTE — IH ganha repasse; Externo aparece com 0
      if (indicMed) {
        const acc = getAcc(indicNome);
        if (acc) {
          if (ehIH(indicMed) && v > 0) {
            acc.repasseIndic += v * fIndic;
          }
          if (marcarTags) acc.tagIndic = true;
        }
      }
    }

    // Finaliza: converte Set em count e soma repassado total
    for (const acc of result.values()) {
      acc.admissoes = acc.admissoesSet.size;
      delete acc.admissoesSet;
      acc.repassado = acc.repasseExec + acc.repasseIndic;
    }
    return result;
  }

  // ==========================================================================
  // DIAGNÓSTICO TABELA VAZIA
  // ==========================================================================

  function renderDiagnosticoVazio(ctx) {
    const qtdCadastradosIH = Number(Banco.queryUnica(
      `SELECT COUNT(*) AS v FROM medicos WHERE ativo = 1 AND tipo_vinculo IN ('INTERNO','HIBRIDO')`
    )?.v) || 0;

    const placeholder = ctx.competencias.map(() => '?').join(',');
    const nomesNoRelatorio = ctx.competencias.length > 0 ? Banco.query(
      `WITH nomes AS (
        SELECT DISTINCT UPPER(TRIM(medico)) AS n FROM linhas_producao
          WHERE competencia IN (${placeholder}) AND categoria = 'Lentes de Contato' AND medico IS NOT NULL AND medico != ''
        UNION
        SELECT DISTINCT UPPER(TRIM(cirurgiao)) AS n FROM linhas_producao
          WHERE competencia IN (${placeholder}) AND categoria = 'Lentes de Contato' AND cirurgiao IS NOT NULL AND cirurgiao != ''
        UNION
        SELECT DISTINCT UPPER(TRIM(indicante)) AS n FROM linhas_producao
          WHERE competencia IN (${placeholder}) AND categoria = 'Lentes de Contato' AND indicante IS NOT NULL AND indicante != ''
        UNION
        SELECT DISTINCT UPPER(TRIM(solicitante)) AS n FROM linhas_producao
          WHERE competencia IN (${placeholder}) AND categoria = 'Lentes de Contato' AND solicitante IS NOT NULL AND solicitante != ''
      ) SELECT n FROM nomes WHERE n IS NOT NULL AND n != '' ORDER BY n`,
      [...ctx.competencias, ...ctx.competencias, ...ctx.competencias, ...ctx.competencias]
    ).map(r => r.n) : [];

    const cadMap = montarCadMap();
    const bateu = [], naoIH = [], naoExiste = [];
    for (const nome of nomesNoRelatorio) {
      const c = cadMap.get(nome);
      if (!c) naoExiste.push(nome);
      else if (c.tipo_vinculo === 'INTERNO' || c.tipo_vinculo === 'HIBRIDO') bateu.push({ nome: c.nome_oficial, tipo: c.tipo_vinculo });
      else naoIH.push({ nome: c.nome_oficial, tipo: c.tipo_vinculo || 'sem tipo' });
    }

    let causa = '', dica = '';
    if (qtdCadastradosIH === 0) {
      causa = 'Não há nenhum médico cadastrado como <strong>Interno</strong> ou <strong>Híbrido</strong>.';
      dica = 'Vá em <strong>Médicos</strong> e marque pelo menos um médico com tipo de vínculo Interno ou Híbrido.';
    } else if (nomesNoRelatorio.length === 0) {
      causa = `Nenhum nome de médico foi encontrado no relatório de LC para ${ctx.labelComp}.`;
      dica = 'Verifique se o relatório de PRODUÇÃO foi importado corretamente.';
    } else if (bateu.length === 0) {
      causa = `${nomesNoRelatorio.length} médico(s) aparecem no relatório, mas <strong>nenhum bate</strong> com cadastrados como Interno/Híbrido.`;
      dica = naoExiste.length > 0
        ? `Use a tela <strong>De-Para de Nomes</strong> (em Cadastros) para vincular os nomes.`
        : `Edite os cadastros para marcar Interno/Híbrido.`;
    }

    return `
      <div class="lc-secao-label lc-secao-matriz-header">
        <div>Detalhamento por médico</div>
      </div>
      <div class="card" style="background: #FFF8E1; border-color: #E0C97A; padding: 18px">
        <h3 style="margin: 0 0 10px; color: #143352; font-family: var(--font-display); font-weight: 500">⚠ Diagnóstico: tabela vazia</h3>
        <p style="font-size: 13px; color: var(--ink); margin: 0 0 14px; line-height: 1.5">${causa}</p>
        ${dica ? `<div style="background: white; padding: 12px 14px; border-radius: 8px; font-size: 12px; color: var(--ink-soft); line-height: 1.5; margin-bottom: 14px"><strong>💡 Como resolver:</strong> ${dica}</div>` : ''}
        ${naoExiste.length > 0 ? `
          <button class="btn btn-primary" id="btn-ir-depara" style="font-size: 12px; padding: 8px 14px">↔ Abrir tela "De-Para de Nomes"</button>
        ` : ''}
      </div>
    `;
  }

  // ==========================================================================
  // POPOVERS (Ajustes e Mostrar/Ocultar)
  // ==========================================================================

  function renderPopoverAjustes(cfg) {
    return `
      <div class="lc-overlay" data-popover="ajustes"></div>
      <div class="lc-popover-ajustes">
        <div class="lc-popover-header">
          <h3>Ajustes</h3>
          <button class="lc-popover-close" data-popover="ajustes">×</button>
        </div>

        <!-- Percentuais -->
        <div class="lc-aj-bloco">
          <div class="lc-aj-titulo">Percentuais</div>
          <div class="lc-aj-pct-cards">
            <div class="lc-aj-pct-card">
              <div class="lc-aj-pct-faixa" style="background: linear-gradient(180deg, #143352, #2a5a8c)"></div>
              <div>
                <div class="lc-aj-pct-label">Executante</div>
                <div class="lc-aj-pct-valor-wrap">
                  <span class="lc-aj-pct-num mono" data-config="PERCENTUAL_EXECUTANTE" data-valor="${cfg.pctExec}">${Utilidades.formatarNumero(cfg.pctExec, 2)}</span>
                  <span class="lc-aj-pct-suf">%</span>
                </div>
              </div>
            </div>
            <div class="lc-aj-pct-card">
              <div class="lc-aj-pct-faixa" style="background: linear-gradient(180deg, #2a5a8c, #9FE6C9)"></div>
              <div>
                <div class="lc-aj-pct-label">Indicante</div>
                <div class="lc-aj-pct-valor-wrap">
                  <span class="lc-aj-pct-num mono" data-config="PERCENTUAL_INDICANTE" data-valor="${cfg.pctIndic}">${Utilidades.formatarNumero(cfg.pctIndic, 2)}</span>
                  <span class="lc-aj-pct-suf">%</span>
                </div>
              </div>
            </div>
          </div>
          <div class="lc-aj-help">Clique nos valores para editar.</div>
        </div>

        <!-- Formato dos números -->
        <div class="lc-aj-bloco">
          <div class="lc-aj-titulo">Formato dos números</div>
          <div class="lc-fmt-linha">
            <div>
              <div class="lc-fmt-label">Valores monetários (R$)</div>
              <div class="lc-fmt-preview mono">Preview: ${fmtMoeda(15111, cfg.casasMoeda)}</div>
            </div>
            <div class="lc-fmt-stepper">
              <button class="lc-fmt-btn" data-fmt="moeda" data-delta="-1" ${cfg.casasMoeda <= 0 ? 'disabled' : ''}>−</button>
              <div class="lc-fmt-num mono">${cfg.casasMoeda}</div>
              <button class="lc-fmt-btn" data-fmt="moeda" data-delta="1" ${cfg.casasMoeda >= 4 ? 'disabled' : ''}>+</button>
            </div>
          </div>
          <div class="lc-fmt-linha">
            <div>
              <div class="lc-fmt-label">Percentuais (%)</div>
              <div class="lc-fmt-preview mono">Preview: ${fmtPct(26.7290, cfg.casasPct)}</div>
            </div>
            <div class="lc-fmt-stepper">
              <button class="lc-fmt-btn" data-fmt="pct" data-delta="-1" ${cfg.casasPct <= 0 ? 'disabled' : ''}>−</button>
              <div class="lc-fmt-num mono">${cfg.casasPct}</div>
              <button class="lc-fmt-btn" data-fmt="pct" data-delta="1" ${cfg.casasPct >= 4 ? 'disabled' : ''}>+</button>
            </div>
          </div>
          <div class="lc-aj-help" style="margin-top: 8px">Entre 0 e 4 casas decimais.</div>
        </div>

        <!-- Colunas visíveis (com nome editável) -->
        <div class="lc-aj-bloco">
          <div class="lc-aj-titulo">Colunas da matriz</div>
          <div class="lc-aj-help" style="margin-bottom: 10px; margin-top: 0">
            Desmarque para ocultar. Edite o nome no campo de texto.
            Esvazie o campo para voltar ao padrão.
          </div>
          <div class="lc-cols-list">
            <div class="lc-col-row lc-col-row-fixa">
              <input type="checkbox" checked disabled class="lc-col-chk">
              <input type="text" value="Médico (fixa)" disabled class="lc-col-name">
              <span class="lc-col-padrao-tag" title="Coluna obrigatória">fixa</span>
            </div>
            ${COLUNAS.map(c => {
              const nomeAtual = (cfg.colunasNomes && cfg.colunasNomes[c.id]) || '';
              const ehCustom = !!nomeAtual;
              return `
                <div class="lc-col-row ${ehCustom ? 'lc-col-row-custom' : ''}">
                  <input type="checkbox" class="lc-col-chk" data-col="${c.id}" ${window.__lc.colunasVisiveis.has(c.id) ? 'checked' : ''}>
                  <input type="text" class="lc-col-name" data-col-name="${c.id}"
                         value="${escapeAttr(nomeAtual)}"
                         placeholder="${escapeAttr(c.label)}"
                         maxlength="40">
                  ${ehCustom ? `<button class="lc-col-reset" data-col-reset="${c.id}" title="Restaurar padrão (${escapeAttr(c.label)})">↺</button>` : `<span class="lc-col-padrao-tag" title="Usando nome padrão">padrão</span>`}
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- TKM (Ticket Médio) -->
        <div class="lc-aj-bloco">
          <div class="lc-aj-titulo">Ticket médio (TKM)</div>
          <label class="lc-radio">
            <input type="radio" name="tkm" value="admissao" ${window.__lc.tkmModo === 'admissao' ? 'checked' : ''}>
            <span><strong>Por admissão</strong> — Produção ÷ Admissões distintas</span>
          </label>
          <label class="lc-radio">
            <input type="radio" name="tkm" value="volume" ${window.__lc.tkmModo === 'volume' ? 'checked' : ''}>
            <span><strong>Por volume</strong> — Produção ÷ Quantidade</span>
          </label>
        </div>

        <div class="lc-aj-bloco" style="background: var(--bg-sunken); border-radius: 8px; margin: 0 18px 14px">
          <div style="font-size: 11px; color: var(--ink-soft); line-height: 1.5">
            <strong>Filtro automático:</strong> todos os procedimentos da Categoria "Lentes de Contato".
          </div>
        </div>
      </div>
    `;
  }

  function renderPopoverOcultar(tabela) {
    const todosMedicos = Array.from(new Map(tabela.map(m => [m.id, m])).values())
      .sort((a, b) => a.nome.localeCompare(b.nome));

    return `
      <div class="lc-overlay" data-popover="ocultar"></div>
      <div class="lc-popover-ocultar">
        <div class="lc-popover-header">
          <h3>Visualização</h3>
          <button class="lc-popover-close" data-popover="ocultar">×</button>
        </div>

        <div class="lc-aj-bloco">
          <div class="lc-aj-titulo">Valores monetários</div>
          <label class="lc-check-row">
            <input type="checkbox" id="chk-ocultar-repasse" ${window.__lc.ocultarRepasse ? 'checked' : ''}>
            <span>Ocultar R$ de <strong>Repasse</strong> (coluna Repassado e drilldown)</span>
          </label>
          <label class="lc-check-row">
            <input type="checkbox" id="chk-ocultar-producao" ${window.__lc.ocultarProducao ? 'checked' : ''}>
            <span>Ocultar R$ de <strong>Produção</strong> (colunas Produção, TKM e KPI Receita)</span>
          </label>
        </div>

        <div class="lc-aj-bloco">
          <div class="lc-aj-titulo-wrap">
            <div class="lc-aj-titulo">Filtrar por médico</div>
            ${window.__lc.medicosFiltrados.size > 0 ? `
              <button class="btn-mini" id="btn-limpar-medicos-pop">Limpar (${window.__lc.medicosFiltrados.size})</button>
            ` : ''}
          </div>
          <input type="text" class="lc-filtro-input" id="lc-busca-medico" placeholder="🔍 Buscar..." style="width: 100%; margin-bottom: 8px">
          <div class="lc-medicos-list" id="lc-medicos-list">
            ${todosMedicos.length === 0 ? `
              <div style="text-align: center; color: var(--ink-faint); padding: 14px; font-size: 11px">Nenhum médico para filtrar.</div>
            ` : todosMedicos.map(m => `
              <label class="lc-medico-item" data-nome-busca="${escapeAttr(m.nome.toLowerCase())}">
                <input type="checkbox" data-medico-id="${m.id}" ${window.__lc.medicosFiltrados.has(m.id) ? 'checked' : ''}>
                <span>${escapeHTML(CodigoMedico.exibir(m.nome))}</span>
                ${Utilidades.badgeTipoVinculo(m.tipo_vinculo) || ''}
              </label>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // POPOVER DE REGRAS DE REPASSE
  // ==========================================================================
  // Documentação analítica das regras de repasse de Lentes de Contato.
  // Aberto pelo botão "ⓘ" ao lado do título da tela.

  /**
   * Popover com a lista das admissões "sem valor" do período ativo:
   * admissões onde TODAS as linhas LC vieram com R$ 0,00.
   *
   * Útil para auditoria — identificar quais admissões não geraram receita
   * (geralmente são retornos/entregas de lentes pagas em meses anteriores).
   */
  function renderPopoverAdmSemValor(ctx) {
    const filtroSql = ctx.filtrosTexto?.sql || '';
    const filtroParams = ctx.filtrosTexto?.params || [];
    const phComps = ctx.competencias.map(() => '?').join(',');

    // Admissões cujo MAX(valor) das linhas LC = 0 — junto com paciente (1x por admissão).
    const linhas = Banco.query(
      `SELECT a.cod_admissao,
              COALESCE(MAX(a.paciente), '—') AS paciente,
              COALESCE(MAX(a.cod_paciente), '') AS cod_paciente
       FROM linhas_producao a
       WHERE a.categoria = 'Lentes de Contato'
         AND a.competencia IN (${phComps}) ${filtroSql}
       GROUP BY a.cod_admissao
       HAVING MAX(COALESCE(a.valor, 0)) = 0
       ORDER BY paciente`,
      [...ctx.competencias, ...filtroParams]
    );

    const total = linhas.length;

    return `
      <div class="lc-overlay" data-popover="adm-sv"></div>
      <div class="lc-popover-adm-sv">
        <div class="lc-popover-header">
          <h3>Admissões sem valor — ${ctx.labelComp}</h3>
          <button class="lc-popover-close" data-popover="adm-sv">×</button>
        </div>
        <div class="lc-aj-bloco" style="border-bottom: none">
          <div class="lc-aj-help" style="margin: 0 0 10px 0">
            ${total === 0
              ? 'Nenhuma admissão sem valor no período.'
              : `<strong>${total}</strong> admiss${total === 1 ? 'ão' : 'ões'} com todas as linhas LC zeradas. Clique numa para filtrar e ver os produtos.`}
          </div>
          ${total > 0 ? `
            <div class="lc-adm-sv-list">
              ${linhas.map(l => `
                <button class="lc-adm-sv-item" data-cod-adm="${escapeAttr(String(l.cod_admissao))}" title="Filtrar por esta admissão">
                  <span class="lc-adm-sv-cod mono">${escapeHTML(String(l.cod_admissao))}</span>
                  <span class="lc-adm-sv-pac">${escapeHTML(l.paciente)}</span>
                </button>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function renderPopoverRegras(cfg) {
    return `
      <div class="lc-overlay" data-popover="regras"></div>
      <div class="lc-popover-regras">
        <div class="lc-popover-header">
          <h3>Regras de Repasse — Lentes de Contato</h3>
          <button class="lc-popover-close" data-popover="regras">×</button>
        </div>

        <div class="lc-regras-body">

          <!-- 1. Origem dos dados -->
          <div class="lc-regra-bloco">
            <div class="lc-regra-titulo">
              <span class="lc-regra-num">1</span>
              Origem dos dados
            </div>
            <ul class="lc-regra-lista">
              <li>Entram no cálculo todas as linhas com <strong>Categoria = "Lentes de Contato"</strong> do relatório de produção.</li>
            </ul>
          </div>

          <!-- 2. Quem entra no repasse -->
          <div class="lc-regra-bloco">
            <div class="lc-regra-titulo">
              <span class="lc-regra-num">2</span>
              Quem recebe repasse
            </div>
            <ul class="lc-regra-lista">
              <li><strong>Internos</strong> e <strong>Híbridos</strong>: recebem repasse como executante e/ou indicante.</li>
              <li><strong>Externos</strong>: <em>não recebem repasse</em>. Aparecem na matriz com R$ 0,00 apenas como informativo, quando forem indicantes.</li>
            </ul>
          </div>

          <!-- 3. Cálculo da Produção (regra crítica) -->
          <div class="lc-regra-bloco">
            <div class="lc-regra-titulo">
              <span class="lc-regra-num">3</span>
              Cálculo da Produção (regra crítica)
            </div>
            <ul class="lc-regra-lista">
              <li>A <strong>Produção</strong> de um médico soma apenas o valor das linhas onde ele é <strong>executante</strong> (Médico ou Cirurgião) e seu vínculo é Interno/Híbrido.</li>
              <li>Linhas onde o médico é <em>apenas indicante</em> <strong>NÃO entram</strong> na sua Produção — evita dupla contagem entre executante e indicante.</li>
            </ul>
          </div>

          <!-- 4. Fórmulas de Repasse -->
          <div class="lc-regra-bloco">
            <div class="lc-regra-titulo">
              <span class="lc-regra-num">4</span>
              Fórmulas de Repasse
            </div>
            <div class="lc-regras-formulas">
              <div class="lc-regra-formula">
                <div class="lc-regra-formula-label">Repasse Executante</div>
                <div class="lc-regra-formula-eq mono">Valor × <strong>${Utilidades.formatarNumero(cfg.pctExec, 2)}%</strong></div>
                <div class="lc-regra-formula-desc">Médico ou Cirurgião (IH) da linha.</div>
              </div>
              <div class="lc-regra-formula">
                <div class="lc-regra-formula-label">Repasse Indicante</div>
                <div class="lc-regra-formula-eq mono">Valor × <strong>${Utilidades.formatarNumero(cfg.pctIndic, 2)}%</strong></div>
                <div class="lc-regra-formula-desc">Indicante ou Solicitante (IH) da linha.</div>
              </div>
              <div class="lc-regra-formula" style="border-color: var(--primary)">
                <div class="lc-regra-formula-label">Repasse Total</div>
                <div class="lc-regra-formula-eq mono">Exec + Indic</div>
                <div class="lc-regra-formula-desc">Soma das duas parcelas.</div>
              </div>
            </div>
            <div class="lc-regra-help">
              Os percentuais podem ser ajustados em <strong>⚙ Ajustes</strong>.
              Externos sempre recebem R$ 0,00.
            </div>
          </div>

          <!-- 5. % Repasse e Admissões sem valor -->
          <div class="lc-regra-bloco">
            <div class="lc-regra-titulo">
              <span class="lc-regra-num">5</span>
              Outros indicadores do dashboard
            </div>
            <ul class="lc-regra-lista">
              <li><strong>% Repasse</strong> = (Repassado ÷ Produção) × 100. Mostra qual fatia da Produção do médico se converte em repasse.</li>
              <li>Tende a ficar próximo de ${Utilidades.formatarNumero(cfg.pctExec, 0)}% quando o médico só executa, e cresce quando ele também indica linhas adicionais.</li>
              <li><strong>Admissões Sem Valor</strong>: quantidade de admissões cujas linhas LC vieram todas com R$ 0,00 (geralmente retornos/entregas de lentes pagas anteriormente). Clique no ícone 📋 do card para ver a lista.</li>
            </ul>
          </div>

        </div>
      </div>
    `;
  }

  // ==========================================================================
  // EVENTOS
  // ==========================================================================

  function bindEventos(cfg, tabela, ctx) {
    // Header — botões principais
    const btnAjustes = document.getElementById('btn-lc-ajustes');
    if (btnAjustes) btnAjustes.addEventListener('click', () => { window.__lc.ajustesAberto = !window.__lc.ajustesAberto; window.__lc.ocultarAberto = false; window.__lc.regrasAberto = false; window.__lc.admSemValorAberto = false; renderizar(); });
    const btnOcultar = document.getElementById('btn-lc-ocultar');
    if (btnOcultar) btnOcultar.addEventListener('click', () => { window.__lc.ocultarAberto = !window.__lc.ocultarAberto; window.__lc.ajustesAberto = false; window.__lc.regrasAberto = false; window.__lc.admSemValorAberto = false; renderizar(); });
    const btnInfo = document.getElementById('btn-lc-info');
    if (btnInfo) btnInfo.addEventListener('click', () => { window.__lc.regrasAberto = !window.__lc.regrasAberto; window.__lc.ajustesAberto = false; window.__lc.ocultarAberto = false; window.__lc.admSemValorAberto = false; renderizar(); });

    // Card "Admissões Sem Valor" — botão 📋 abre popover com a lista
    const btnAdmSv = document.getElementById('btn-lc-adm-sv');
    if (btnAdmSv) btnAdmSv.addEventListener('click', (ev) => {
      ev.stopPropagation();
      window.__lc.admSemValorAberto = !window.__lc.admSemValorAberto;
      window.__lc.ajustesAberto = false;
      window.__lc.ocultarAberto = false;
      window.__lc.regrasAberto = false;
      renderizar();
    });

    // Clique numa admissão da lista → aplica filtro e fecha o popover
    document.querySelectorAll('.lc-adm-sv-item').forEach(btn => {
      btn.addEventListener('click', () => {
        window.__lc.filtroCodAdmissao = btn.dataset.codAdm;
        window.__lc.admSemValorAberto = false;
        renderizar();
      });
    });
    const btnExportar = document.getElementById('btn-lc-exportar');
    if (btnExportar) btnExportar.addEventListener('click', () => mostrarMenuExportar(btnExportar, ctx, cfg));

    const btnMax = document.getElementById('btn-lc-maximizar');
    if (btnMax) btnMax.addEventListener('click', () => { window.__lc.maximizado = true; renderizar(); });
    const btnRestaurar = document.getElementById('btn-lc-restaurar');
    if (btnRestaurar) btnRestaurar.addEventListener('click', () => { window.__lc.maximizado = false; renderizar(); });

    // Fechar popovers
    document.querySelectorAll('[data-popover]').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-popover]') !== el) return;
        const pop = el.dataset.popover;
        if (pop === 'ajustes')  window.__lc.ajustesAberto  = false;
        if (pop === 'ocultar')  window.__lc.ocultarAberto  = false;
        if (pop === 'regras')   window.__lc.regrasAberto   = false;
        if (pop === 'adm-sv')   window.__lc.admSemValorAberto = false;
        renderizar();
      });
    });

    // Edição de %
    document.querySelectorAll('.lc-aj-pct-num').forEach(span => {
      span.addEventListener('click', () => abrirEdicaoPct(span));
    });

    // Steppers de casas decimais
    document.querySelectorAll('.lc-fmt-btn').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        ajustarCasasDecimais(btn.dataset.fmt, Number(btn.dataset.delta));
      });
    });

    // Checkboxes de colunas
    document.querySelectorAll('input[data-col]').forEach(chk => {
      chk.addEventListener('change', () => {
        if (chk.checked) window.__lc.colunasVisiveis.add(chk.dataset.col);
        else window.__lc.colunasVisiveis.delete(chk.dataset.col);
        renderizar();
      });
    });

    // Renomear coluna — salva no blur (perda de foco) ou Enter.
    // Esvaziar o campo restaura o padrão.
    document.querySelectorAll('input[data-col-name]').forEach(inp => {
      const id = inp.dataset.colName;
      const cfg = carregarConfig();
      const valorOriginal = (cfg.colunasNomes && cfg.colunasNomes[id]) || '';
      const salvar = async () => {
        const novo = inp.value.trim();
        if (novo === valorOriginal) return; // sem mudança
        await salvarNomeColuna(id, novo);
        renderizar();
      };
      inp.addEventListener('blur', salvar);
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); inp.value = valorOriginal; inp.blur(); }
      });
    });

    // Botão "↺" — restaura nome padrão da coluna
    document.querySelectorAll('[data-col-reset]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.colReset;
        await salvarNomeColuna(id, '');  // vazio = remove do banco
        renderizar();
      });
    });

    // Radio TKM
    document.querySelectorAll('input[name="tkm"]').forEach(rd => {
      rd.addEventListener('change', () => {
        window.__lc.tkmModo = rd.value;
        renderizar();
      });
    });

    // Ocultar R$
    const chkOR = document.getElementById('chk-ocultar-repasse');
    if (chkOR) chkOR.addEventListener('change', () => { window.__lc.ocultarRepasse = chkOR.checked; renderizar(); });
    const chkOP = document.getElementById('chk-ocultar-producao');
    if (chkOP) chkOP.addEventListener('change', () => { window.__lc.ocultarProducao = chkOP.checked; renderizar(); });

    // Filtro por médico (checkboxes)
    document.querySelectorAll('input[data-medico-id]').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = Number(chk.dataset.medicoId);
        if (chk.checked) window.__lc.medicosFiltrados.add(id);
        else window.__lc.medicosFiltrados.delete(id);
        renderizar();
      });
    });
    const buscaMedico = document.getElementById('lc-busca-medico');
    if (buscaMedico) {
      buscaMedico.addEventListener('input', () => {
        const termo = buscaMedico.value.toLowerCase();
        document.querySelectorAll('.lc-medico-item').forEach(it => {
          const match = !termo || it.dataset.nomeBusca.includes(termo);
          it.style.display = match ? '' : 'none';
        });
      });
    }
    const btnLimparMed = document.getElementById('btn-limpar-medicos-pop');
    if (btnLimparMed) btnLimparMed.addEventListener('click', () => { window.__lc.medicosFiltrados.clear(); renderizar(); });
    const btnLimparMedBadge = document.getElementById('btn-limpar-filtro-medicos');
    if (btnLimparMedBadge) btnLimparMedBadge.addEventListener('click', () => { window.__lc.medicosFiltrados.clear(); renderizar(); });

    // Fileira de filtros 20C (Ano/Mês/combos viraram células)
    bindBarraFiltrosLc20C();

    const btnLimparTudo = document.getElementById('btn-limpar-filtros');
    if (btnLimparTudo) btnLimparTudo.addEventListener('click', () => {
      window.__lc.filtroCodAdmissao = '';
      window.__lc.filtroCodPaciente = '';
      window.__lc.filtroNomePaciente = '';
      window.__lc.medicosFiltrados.clear();
      renderizar();
    });

    // Toggle de linhas expandidas
    document.querySelectorAll('.lc-toggle').forEach(td => {
      td.addEventListener('click', () => {
        const id = Number(td.dataset.medicoId);
        if (window.__lc.linhasExpandidas.has(id)) window.__lc.linhasExpandidas.delete(id);
        else window.__lc.linhasExpandidas.add(id);
        renderizar();
      });
    });

    // Atalho para De-Para
    const btnDepara = document.getElementById('btn-ir-depara');
    if (btnDepara) btnDepara.addEventListener('click', () => App.navegarPara('de-para-nomes'));
  }

  function abrirEdicaoPct(span) {
    const chave = span.dataset.config;
    const atual = Number(span.dataset.valor) || 0;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'lc-aj-pct-num-input mono';
    input.value = atual ? Utilidades.formatarNumero(atual, 2) : '';
    span.replaceWith(input);
    input.focus();
    input.select();
    let salvo = false;
    const salvar = async () => {
      if (salvo) return;
      salvo = true;
      const novo = parseValor(input.value);
      if (novo !== atual) {
        Banco.executar(`UPDATE config_lentes_contato SET valor = ?, atualizado_em = CURRENT_TIMESTAMP WHERE chave = ?`, [novo, chave]);
        Banco.executar(`INSERT OR IGNORE INTO config_lentes_contato (chave, valor) VALUES (?, ?)`, [chave, novo]);
        await Banco.salvar();
        Utilidades.toast('Percentual atualizado', 'success', 1500);
      }
      renderizar();
    };
    input.addEventListener('blur', salvar);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { salvo = true; renderizar(); }
    });
  }

  function parseValor(texto) {
    if (!texto) return 0;
    // V491: só trata ponto como milhar quando HÁ vírgula (antes "8.5" virava 85).
    let s = String(texto).trim();
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const limpo = s.replace(/[^\d.-]/g, '');
    const n = parseFloat(limpo);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  /**
   * Persiste um nome customizado de coluna em config_textos_lentes_contato.
   * Se `novoNome` for vazio, REMOVE a customização (volta ao padrão).
   */
  async function salvarNomeColuna(colId, novoNome) {
    try {
      // Garante que a tabela existe (compat com bancos antigos)
      Banco.executar(`
        CREATE TABLE IF NOT EXISTS config_textos_lentes_contato (
          chave         TEXT PRIMARY KEY,
          valor         TEXT,
          atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      const chave = `COL_NAME_${colId}`;
      if (!novoNome) {
        Banco.executar(`DELETE FROM config_textos_lentes_contato WHERE chave = ?`, [chave]);
      } else {
        Banco.executar(
          `INSERT INTO config_textos_lentes_contato (chave, valor) VALUES (?, ?)
           ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = CURRENT_TIMESTAMP`,
          [chave, novoNome]
        );
      }
      Banco.salvarDebounced();  // V492: coalesce persistência (dado já está no banco em memória; nada depois depende do flush)
    } catch (e) {
      console.error('Erro ao salvar nome de coluna:', e);
      Utilidades.toast('Erro ao salvar: ' + e.message, 'error');
    }
  }

  async function ajustarCasasDecimais(tipo, delta) {    try {
      const cfg = carregarConfig();
      const chave = tipo === 'moeda' ? 'CASAS_MOEDA' : 'CASAS_PCT';
      const atual = tipo === 'moeda' ? cfg.casasMoeda : cfg.casasPct;
      const novo = Math.max(0, Math.min(4, atual + delta));
      if (novo === atual) return;
      Banco.executar(
        `INSERT INTO config_lentes_contato (chave, valor) VALUES (?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = CURRENT_TIMESTAMP`,
        [chave, novo]
      );
      Banco.salvarDebounced();  // V492: coalesce persistência (dado já está no banco em memória)
      renderizar();
    } catch (e) {
      console.error(e);
      Utilidades.toast('Erro: ' + e.message, 'error');
    }
  }

  // ==========================================================================
  // EXPORTAÇÃO EXCEL (3 formatos)
  // ==========================================================================

  // V716: menu no padrão da ferramenta (modelo LIO — Utilidades.abrirMenuExportar)
  function mostrarMenuExportar(btn, ctx, cfg) {
    Utilidades.abrirMenuExportar(btn, [
      { icone: '⊞', titulo: 'Visão da Matriz', sub: 'Tudo que está visível na tela',
        onClick: () => exportarExcel('matriz', ctx, cfg) },
      { icone: '⚕', titulo: 'Por Médico (Mensal)', sub: 'Uma aba por médico, linha por mês',
        onClick: () => exportarExcel('medico', ctx, cfg) },
      { icone: '∑', titulo: 'Consolidado Anual', sub: 'Todos médicos, totais do ano', tom: 'verde',
        onClick: () => exportarExcel('consolidado', ctx, cfg) },
    ]);
  }

  function exportarExcel(modo, ctx, cfg) {
    if (!ctx.temDados) { alert('Sem dados para exportar.'); return; }
    try {
      Utilidades.mostrarLoading('Gerando Excel...');
      if (modo === 'matriz') exportarMatriz(ctx, cfg);
      else if (modo === 'medico') exportarPorMedico(ctx, cfg);
      else if (modo === 'consolidado') exportarConsolidado(ctx, cfg);
      Utilidades.esconderLoading();
      Utilidades.toast('Excel gerado!', 'success');
    } catch (e) {
      Utilidades.esconderLoading();
      console.error(e);
      alert('Erro: ' + e.message);
    }
  }

  function exportarMatriz(ctx, cfg) {
    const tabela = aplicarFiltrosTexto(calcularTabelaMedicos(ctx, cfg), ctx);
    const cols = colunasAtivas();
    const cabecalho = ['Médico', 'Tipo', ...cols.map(c => labelColuna(c, cfg))];
    const linhas = [cabecalho];
    for (const m of tabela) {
      linhas.push([
        m.nome,
        m.tipo_vinculo || '',
        ...cols.map(c => valorCru(c, m, cfg, ctx))
      ]);
    }
    montarWorkbookGenerico('LC_Matriz', linhas, ctx);
  }

  function exportarPorMedico(ctx, cfg) {
    // Forçamos visão anual no exportador (uma aba por médico, linha por mês)
    const ano = ctx.ano;
    const comps = competenciasDoAno(ano);
    const tabelaAnual = calcularTabelaMedicos({ ...ctx, mes: null, visaoAnual: true, competencias: comps, competenciasLM: [], competenciasLY: [], labelComp: ano }, cfg);

    const wb = XLSX.utils.book_new();
    for (const m of tabelaAnual) {
      const linhas = [['MÊS','ADMISSÕES','VOLUME','PRODUÇÃO','TKM','REPASSE EXEC','REPASSE INDIC','REPASSE TOTAL','% REPASSE']];
      let totAdm=0,totVol=0,totProd=0,totRE=0,totRI=0,totR=0;
      for (const comp of comps) {
        const ctxMes = { ...ctx, mes: comp.split('-')[1], visaoAnual: false, competencias: [comp], competenciasLM: [], competenciasLY: [], labelComp: comp };
        const det = agregarDetalhe([comp], cfg, true);
        const acc = det.get(m.id);
        if (!acc) {
          linhas.push([formatarCompetencia(comp), 0, 0, 0, 0, 0, 0, 0, 0]);
          continue;
        }
        const tkm = window.__lc.tkmModo === 'admissao'
          ? (acc.admissoes > 0 ? acc.producao/acc.admissoes : 0)
          : (acc.volume > 0    ? acc.producao/acc.volume    : 0);
        const pct = acc.producao > 0 ? acc.repassado/acc.producao : 0;
        linhas.push([formatarCompetencia(comp), acc.admissoes, acc.volume, acc.producao, tkm, acc.repasseExec, acc.repasseIndic, acc.repassado, pct]);
        totAdm+=acc.admissoes; totVol+=acc.volume; totProd+=acc.producao; totRE+=acc.repasseExec; totRI+=acc.repasseIndic; totR+=acc.repassado;
      }
      const tkmT = window.__lc.tkmModo === 'admissao' ? (totAdm>0?totProd/totAdm:0) : (totVol>0?totProd/totVol:0);
      linhas.push(['TOTAL', totAdm, totVol, totProd, tkmT, totRE, totRI, totR, totProd>0?totR/totProd:0]);

      const ws = XLSX.utils.aoa_to_sheet(linhas);
      const nomeAba = sanitizarNomeAba(m.nome);
      XLSX.utils.book_append_sheet(wb, ws, nomeAba);
    }
    XLSX.writeFile(wb, `LC_PorMedico_${ano}.xlsx`);
  }

  function exportarConsolidado(ctx, cfg) {
    const ano = ctx.ano;
    const comps = competenciasDoAno(ano);
    const det = agregarDetalhe(comps, cfg, true);
    const lista = Array.from(det.values()).filter(m => m.producao > 0 || m.repassado > 0 || m.tagIndic);

    const cabecalho = ['MÉDICO','TIPO','ADMISSÕES','VOLUME','PRODUÇÃO','TKM','REPASSADO EXEC','REPASSADO IND','REPASSADO TOTAL','% REPASSE'];
    const linhas = [cabecalho];
    for (const m of lista.sort((a,b)=>b.repassado-a.repassado)) {
      const tkm = window.__lc.tkmModo === 'admissao'
        ? (m.admissoes > 0 ? m.producao/m.admissoes : 0)
        : (m.volume > 0    ? m.producao/m.volume    : 0);
      const pct = m.producao > 0 ? m.repassado/m.producao : 0;
      linhas.push([m.nome, m.tipo_vinculo || '', m.admissoes, m.volume, m.producao, tkm, m.repasseExec, m.repasseIndic, m.repassado, pct]);
    }
    montarWorkbookGenerico(`LC_Consolidado_${ano}`, linhas, { ...ctx, labelComp: ano });
  }

  function montarWorkbookGenerico(prefixoArquivo, linhas, ctx) {
    const wb = XLSX.utils.book_new();
    // Cabeçalho da planilha (ATLAS, período, data)
    const meta = [
      ['Clínica ATLAS — Lentes de Contato', `Período: ${ctx.labelComp}`],
      [`Gerado em: ${new Date().toLocaleString('pt-BR')}`],
      [],
    ];
    const ws = XLSX.utils.aoa_to_sheet([...meta, ...linhas]);
    XLSX.utils.book_append_sheet(wb, ws, 'Matriz');
    const competenciaStr = (ctx.mes && ctx.ano) ? `${ctx.ano}_${ctx.mes}` : ctx.ano;
    XLSX.writeFile(wb, `${prefixoArquivo}_${competenciaStr}.xlsx`);
  }

  function valorCru(coluna, m, cfg, ctx) {
    switch (coluna.id) {
      case 'admissoes':  return m.admissoes;
      case 'volume':     return m.volume;
      case 'volumeLM':   return m.volumeLM !== null && m.volumeLM > 0 ? (m.volume - m.volumeLM)/m.volumeLM : '';
      case 'volumeLY':   return m.volumeLY !== null && m.volumeLY > 0 ? (m.volume - m.volumeLY)/m.volumeLY : '';
      case 'producao':   return m.producao;
      case 'tkm':        return m.tkm;
      case 'repassado':  return m.repassado;
      case 'pctRepasse': return m.producao > 0 ? m.repassado/m.producao : '';
      default: return '';
    }
  }

  function sanitizarNomeAba(nome) {
    // Excel: máx 31 chars, sem caracteres especiais : \ / ? * [ ]
    return String(nome).replace(/[:\\\/\?\*\[\]]/g, '').substring(0, 31);
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  function formatarCompetencia(comp) {
    if (!comp) return '—';
    const [ano, mes] = comp.split('-');
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return `${meses[Number(mes) - 1] || mes}/${ano}`;
  }
  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHTML(s); }

  // ==========================================================================
  // ESTILOS
  // ==========================================================================

  // V492: retorna apenas o CSS (sem tag <style>) — injetado 1x via Utilidades.garantirEstilos
  function getStyles() {
    return `
        /* Layout maximizado:
         *  - esconde sidebar e remove sua coluna do grid (senão sobra espaço)
         *  - força .main a ocupar 100% da largura (sobrescreve max-width: 1400px)
         */
        body.lc-maximizado .app-shell { grid-template-columns: 1fr !important; }
        body.lc-maximizado .sidebar   { display: none !important; }
        body.lc-maximizado .main      { max-width: none !important; padding: 12px !important; }

        .lc-page-maximizada {}
        .lc-header-max {
          display: flex; justify-content: space-between; align-items: center;
          padding: 8px 14px; background: var(--primary); color: white;
          border-radius: 10px; margin-bottom: 12px;
        }
        .lc-header-max .btn {
          background: white; color: var(--primary); border: none;
          padding: 4px 12px; font-weight: 700; cursor: pointer;
          border-radius: 6px;
        }

        .lc-header-acoes { display: flex; gap: 8px; flex-wrap: wrap; }

        /* Wrapper do título + botão de info */
        .lc-titulo-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .lc-btn-info {
          width: 28px; height: 28px;
          border-radius: 50%;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          color: #2a5a8c;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          display: inline-flex;
          align-items: center; justify-content: center;
          transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
          line-height: 1;
        }
        .lc-btn-info:hover {
          background: #2a5a8c;
          color: white;
          border-color: #2a5a8c;
          transform: scale(1.08);
        }

        /* Filtros */
        /* Contêiner da peça 20C (.lc-sb) + botão "✕ Limpar filtros" —
           irmão do header, esticado de ponta a ponta */
        .lc-filtros-bar {
          display: flex; flex-direction: column; gap: 6px;
          align-items: stretch; width: 100%; box-sizing: border-box;
          margin-top: 10px;
          /* a animação de entrada (.page-content > * { transform }) cria um
             stacking context na barra; sem z-index aqui os painéis 20C ficariam
             ABAIXO dos cards (que também viram stacking contexts) */
          position: relative; z-index: 30;
        }
        .lc-filtros-bar > #btn-limpar-filtros { align-self: flex-start; }

        /* ── Fileira de filtros 20C (padrão do LIO/OPME, prefixo lc-sb) ── */
        .lc-sb {
          margin-bottom: 14px;   /* respiro antes dos cards */
          position: relative; z-index: 30;
          display: flex; align-items: stretch;
          padding: 6px;
          background: #fff;
          border: 1px solid #e4ecf4;
          border-radius: 12px;
          box-shadow: 0 1px 2px rgba(20, 51, 82,.04), 0 10px 26px -20px rgba(20, 51, 82,.26);
          flex-wrap: wrap;
        }
        .lc-sb-celwrap { position: relative; min-width: 150px; display: flex; }
        .lc-sb-celwrap:not(:last-child) .lc-sb-cel { border-right: 1px solid #f0f4f8; }
        .lc-sb-cel {
          flex: 1; min-width: 0;
          display: flex; align-items: center; gap: 9px;
          padding: 9px 12px; border: none; border-radius: 9px;
          background: transparent; cursor: pointer;
          font-family: inherit; text-align: left;
          transition: background-color 120ms;
        }
        .lc-sb-cel:hover, .lc-sb-cel.ativo, .lc-sb-cel.aberta { background: #f6f4ef; }
        .lc-sb-cel:focus-visible { outline: 2px solid #2a5a8c; outline-offset: 2px; }
        .lc-sb-tile {
          width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: #f0f5f9; color: #5a6879;
        }
        .lc-sb-cel.ativo .lc-sb-tile, .lc-sb-cel.aberta .lc-sb-tile { background: #e4ecf4; color: #1d4470; }
        .lc-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
        .lc-sb-rot {
          font-size: 10px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .09em; color: #5a6879; white-space: nowrap;
        }
        .lc-sb-val {
          font-size: 13px; font-weight: 500; color: #5a6879;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .lc-sb-cel.ativo .lc-sb-val { font-weight: 700; color: #12304f; }
        .lc-sb-chev { color: #96a2b1; flex-shrink: 0; display: flex; transition: transform 140ms; }
        .lc-sb-cel.aberta .lc-sb-chev { transform: rotate(180deg); }

        /* painel ancorado na célula, por cima dos cards */
        .lc-sb-painel {
          position: absolute; top: 100%; left: 0; margin-top: 6px; z-index: 40;
          min-width: 100%; width: max-content; max-width: 340px;
          background: #fff; border: 1px solid #dfe4ea; border-radius: 12px;
          box-shadow: 0 18px 44px -14px rgba(11, 35, 64,.42);
          overflow: hidden;
        }
        .lc-sb-buscabox {
          display: flex; align-items: center; gap: 8px;
          padding: 11px 12px 10px; border-bottom: 1px solid #f0f4f8;
        }
        .lc-sb-buscabox .lc-sb-busca-ic { color: #6b7d8e; display: flex; }
        .lc-sb-busca {
          flex: 1; height: 30px; border: 1px solid #dfe4ea; border-radius: 8px;
          background: #f6f4ef; padding: 0 10px; font-size: 13px;
          font-family: inherit; color: #12304f; outline: none;
        }
        .lc-sb-busca::placeholder { color: #96a2b1; }
        .lc-sb-busca:focus { border-color: #2a5a8c; }
        .lc-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; }
        .lc-sb-lista::-webkit-scrollbar { width: 8px; }
        .lc-sb-lista::-webkit-scrollbar-track { background: #f0f4f8; }
        .lc-sb-lista::-webkit-scrollbar-thumb { background: #c5d5e5; border-radius: 4px; }
        .lc-sb-it {
          display: flex; align-items: center; gap: 10px;
          height: 38px; padding: 0 8px; border-radius: 8px; cursor: pointer;
          font-size: 13px; color: #12304f;
        }
        .lc-sb-it:hover, .lc-sb-it.foco { background: #f0f4f8; }
        .lc-sb-it.sel { background: #f0f4f8; font-weight: 700; }
        .lc-sb-it-todos { font-weight: 700; }
        .lc-sb-it-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lc-sb-ck { color: #1d4470; display: flex; }
        .lc-sb-rodape {
          padding: 7px 12px; border-top: 1px solid #f0f4f8;
          font-size: 10.5px; font-weight: 600; color: #96a2b1;
        }
        @media (max-width: 1280px) { .lc-sb-celwrap { flex-basis: 32%; } }
        @media (max-width: 900px)  { .lc-sb-celwrap { flex-basis: 48%; } }
        .lc-secao-label {
          font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--ink-soft);
        }
        .lc-secao-matriz-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-top: 22px; margin-bottom: 10px;
        }
        .lc-btn-max {
          background: var(--bg-elevated); border: 1px solid var(--border);
          padding: 4px 10px; font-size: 14px; font-weight: 700;
          color: var(--primary); cursor: pointer; border-radius: 6px;
        }
        .lc-btn-max:hover { background: var(--bg-sunken); }

        /* Card de detalhe da admissão filtrada */
        .lc-detalhe-adm {
          background: linear-gradient(135deg, #e9edf1 0%, #e4ecf4 100%);
          border: 1px solid #9FE6C9;
          border-left: 4px solid #2a5a8c;
          border-radius: 10px;
          padding: 14px 18px;
          margin-bottom: 10px;
        }
        .lc-detalhe-adm-multi {
          background: #FFF8E1;
          border-left-color: #143352;
          font-size: 12px;
          color: #4A3E1F;
          display: flex; align-items: center; gap: 10px;
        }
        .lc-detalhe-header {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 10px;
        }
        .lc-detalhe-icon { font-size: 16px; }
        .lc-detalhe-titulo {
          font-size: 11px;
          font-weight: 700;
          color: #143352;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .lc-detalhe-resumo {
          display: grid;
          grid-template-columns: 160px 1fr 130px;
          gap: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid #9FE6C9;
          margin-bottom: 12px;
        }
        @media (max-width: 700px) {
          .lc-detalhe-resumo { grid-template-columns: 1fr 1fr; }
        }
        .lc-detalhe-campo { min-width: 0; }
        .lc-detalhe-label {
          font-size: 9px;
          color: #143352;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-weight: 600;
          margin-bottom: 3px;
        }
        .lc-detalhe-valor {
          font-size: 13px;
          font-weight: 700;
          color: var(--ink);
          line-height: 1.3;
          word-break: break-word;
        }
        /* Lista de produtos da admissão */
        .lc-detalhe-produtos-label {
          font-size: 10px;
          font-weight: 700;
          color: #102d4b;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 6px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .lc-detalhe-produtos-contagem {
          font-size: 10px;
          color: #143352;
          font-weight: 500;
          text-transform: none;
          letter-spacing: 0;
        }
        .lc-detalhe-produtos {
          list-style: none;
          padding: 0;
          margin: 0 0 10px 0;
          background: rgba(255,255,255,0.5);
          border-radius: 8px;
          padding: 4px;
        }
        .lc-detalhe-produto {
          display: flex;
          align-items: baseline;
          gap: 8px;
          padding: 6px 10px;
          font-size: 12px;
          border-bottom: 1px dashed rgba(212, 190, 126, 0.5);
        }
        .lc-detalhe-produto:last-child { border-bottom: none; }
        .lc-detalhe-produto-nome {
          flex: 1;
          color: var(--ink);
          line-height: 1.4;
        }
        .lc-detalhe-produto-traco {
          color: #2a5a8c;
          font-weight: 700;
          flex-shrink: 0;
        }
        .lc-detalhe-produto-valor {
          color: var(--primary);
          font-weight: 700;
          font-size: 12px;
          flex-shrink: 0;
          min-width: 100px;
          text-align: right;
        }
        .lc-detalhe-produto-zero {
          color: var(--ink-faint) !important;
          font-weight: 500 !important;
        }
        .lc-detalhe-total {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 14px;
          background: #143352;
          color: #f6f4ef;
          border-radius: 8px;
          font-weight: 700;
          font-size: 12px;
        }
        .lc-detalhe-total .mono {
          color: #9FE6C9;
          font-size: 14px;
        }
        /* ainda usado pela busca de médico no popover Mostrar/Ocultar */
        .lc-filtro-input {
          padding: 6px 10px; font-size: 12px; border: 1px solid var(--border);
          border-radius: 8px; background: var(--bg-elevated); font-weight: 500;
        }
        .lc-filtro-medicos-badge {
          display: inline-flex; align-items: center; gap: 6px;
          background: #e4ecf4; border: 1px solid var(--accent);
          padding: 4px 10px; border-radius: 16px; font-size: 11px;
          margin-bottom: 12px;
        }
        .lc-badge-x {
          background: transparent; border: none; cursor: pointer;
          font-size: 14px; color: var(--ink-soft); padding: 0 2px;
        }

        /* CARDS KPI — padronizados */
        .lc-cards-grid {
          display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 18px;
        }
        @media (max-width: 1200px) { .lc-cards-grid { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 800px)  { .lc-cards-grid { grid-template-columns: repeat(2, 1fr); } }
        .lc-card {
          border-radius: 14px; padding: 18px; position: relative;
          overflow: hidden; border: 1px solid transparent;
          min-height: 130px; display: flex; flex-direction: column;
        }
        .lc-card-faixa { position: absolute; top: 0; right: 0; bottom: 0; width: 5px; }
        .lc-card-titulo {
          font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
          font-weight: 700; margin-bottom: 10px; min-height: 12px;
          color: #0f1d2e; /* V849: título dos cards totalizadores (variantes coloridas mantêm a própria) */
        }
        /* Padronização: TODOS os valores usam mesmo tamanho */
        .lc-card-valor {
          font-size: 26px; font-weight: 800; line-height: 1.1;
          word-break: break-all;
        }
        .lc-card-comp {
          margin-top: auto; padding-top: 12px; display: flex;
          flex-direction: column; gap: 5px; font-size: 10px;
        }
        .lc-card-comp-linha { display: flex; justify-content: space-between; align-items: center; }
        .lc-card-comp-lbl { color: var(--ink-soft); font-weight: 600; }
        /* V920: sem fundo branco nos % (pedido do usuário — Vol vs LM / Vol vs LY) */
        .lc-card-comp-badge { font-weight: 700; background: transparent; padding: 1px 6px; border-radius: 4px; }
        .lc-card-comp-up    { color: #0A7A5A; }
        .lc-card-comp-down  { color: #9B3A3A; }
        .lc-card-comp-igual { color: var(--ink-soft); font-weight: 700; }
        .lc-card-comp-vazio { color: var(--ink-faint); }

        /* Ação no canto superior direito do card (ex: 📋 ver lista) */
        .lc-card-acao-wrap {
          position: absolute;
          top: 8px;
          right: 8px;
          z-index: 2;
        }
        .lc-card-acao {
          background: rgba(255,255,255,0.7);
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: 6px;
          padding: 2px 6px;
          font-size: 11px;
          cursor: pointer;
          transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
        }
        .lc-card-acao:hover {
          background: white;
          transform: scale(1.08);
        }
        /* Sufixo de % no valor do card (ex: '47 (31,1%)') */
        .lc-card-valor-pct {
          font-size: 14px;
          font-weight: 600;
          opacity: 0.7;
          margin-left: 4px;
        }

        /* Popover de admissões sem valor (lista) */
        .lc-popover-adm-sv {
          position: fixed;
          top: 90px;
          left: 50%;
          transform: translateX(-50%);
          width: 540px;
          max-width: calc(100vw - 60px);
          max-height: calc(100vh - 120px);
          overflow-y: auto;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 14px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.2);
          z-index: 101;
        }
        .lc-adm-sv-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
          background: var(--bg-sunken);
          border-radius: 8px;
          padding: 6px;
        }
        .lc-adm-sv-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 12px;
          background: white;
          border: 1px solid transparent;
          border-radius: 6px;
          cursor: pointer;
          text-align: left;
          width: 100%;
          font-family: inherit;
          transition: background-color 100ms, color 100ms, border-color 100ms, box-shadow 100ms, transform 100ms, opacity 100ms;
        }
        .lc-adm-sv-item:hover {
          border-color: var(--accent);
          background: #e4ecf4;
        }
        .lc-adm-sv-cod {
          font-size: 11px;
          font-weight: 700;
          color: var(--primary);
          min-width: 90px;
          flex-shrink: 0;
        }
        .lc-adm-sv-pac {
          font-size: 12px;
          color: var(--ink);
          flex: 1;
        }

        .lc-card-verde    { background: linear-gradient(135deg, #E8F1EE 0%, #D4E4DF 100%); border-color: #A8C8C0; }
        .lc-card-verde .lc-card-faixa  { background: #143352; }
        .lc-card-verde .lc-card-titulo { color: #143352; }
        .lc-card-verde .lc-card-valor  { color: #143352; }
        .lc-card-roxo     { background: linear-gradient(135deg, #ECE5F2 0%, #DAC8E4 100%); border-color: #C0A8D0; }
        .lc-card-roxo .lc-card-faixa  { background: #6B4587; }
        .lc-card-roxo .lc-card-titulo { color: #6B4587; }
        .lc-card-roxo .lc-card-valor  { color: #6B4587; }
        .lc-card-azul     { background: linear-gradient(135deg, #E1ECF4 0%, #C9DDED 100%); border-color: #95B9D6; }
        .lc-card-azul .lc-card-faixa  { background: #2C5C8A; }
        .lc-card-azul .lc-card-titulo { color: #2C5C8A; }
        .lc-card-azul .lc-card-valor  { color: #2C5C8A; }
        .lc-card-bege     { background: linear-gradient(135deg, #e9edf1 0%, #e4ecf4 100%); border-color: #9FE6C9; }
        .lc-card-bege .lc-card-faixa  { background: #143352; }
        .lc-card-bege .lc-card-titulo { color: #143352; }
        .lc-card-bege .lc-card-valor  { color: #143352; }
        .lc-card-destaque { background: linear-gradient(135deg, #143352 0%, #0b2340 100%); border-color: #143352; box-shadow: 0 4px 12px rgba(20, 51, 82,.2); }
        .lc-card-destaque .lc-card-faixa  { display: none; }
        .lc-card-destaque .lc-card-titulo { color: #5a6879; }
        .lc-card-destaque .lc-card-valor  { color: #143352; }
        .lc-card-destaque .lc-card-comp-lbl   { color: #c5d5e5; }
        /* V887: o badge do card destaque perdeu o verde #D8EAD3 — ele usa o
           mesmo fundo branco dos outros cards do módulo. */
        .lc-card-destaque .lc-card-comp-vazio,
        .lc-card-destaque .lc-card-comp-igual { color: #c5d5e5; }

        /* MATRIZ */
        /* MATRIZ */
        /* Sobrescreve o text-transform: uppercase do .data-table th global
         * para que os nomes customizados pelo usuário apareçam exatamente
         * como ele digitou. Mantém visual elegante via peso e cor. */
        .lc-tabela thead th {
          text-transform: none !important;
          letter-spacing: 0 !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          color: var(--ink) !important;
        }
        /* V961: TÍTULO DAS COLUNAS CONGELADO — acompanha a rolagem vertical da
           página. Como na Visão Geral (V935): o .app-shell usa overflow-x:hidden,
           que o torna contêiner de rolagem e anula o sticky; nesta tela vira
           clip. O card e o wrapper da matriz também usam clip (não hidden/auto).
           O dock de importação rola junto com a página (V936) para não cobrir
           o cabeçalho preso. */
        body[data-tela="desempenho-lentes-contato"] .app-shell { overflow-x: clip; }
        body[data-tela="desempenho-lentes-contato"] .import-dock-wrap { position: relative; top: auto; z-index: 3; }
        .lc-tabela thead th { position: sticky; top: 0; z-index: 6; }
        /* V961: linha totalizadora em #e4ecf4 (sobrepõe a tarja escura global do tfoot) */
        .main .lc-tabela tfoot td, .main .lc-tabela tfoot tr:hover td {
          background: #e4ecf4 !important; color: #0f1d2e !important;
          border-color: #dfe4ea !important; border-top: 2px solid #dfe4ea !important;
        }
        .main .lc-tabela tfoot td * { color: #0f1d2e !important; }
        .lc-tabela tbody tr.lc-linha-medico { transition: background 100ms; }
        /* V887: a linha aberta acompanha o novo fundo do drilldown — as duas
           formam um bloco só; deixar o creme aqui brigaria com o azul. */
        .lc-tabela tbody tr.lc-linha-expandida { background: #f6f4ef; }
        .lc-toggle {
          text-align: center; font-weight: 700; font-size: 13px;
          color: var(--primary); cursor: pointer; user-select: none;
        }
        .lc-toggle:hover { color: var(--accent); }
        .lc-col-medico { white-space: nowrap; padding-top: 8px; padding-bottom: 8px; }
        .lc-col-medico-linha1 {
          display: flex; align-items: center; gap: 6px;
        }
        .lc-col-medico-nome {
          font-weight: 600;
          color: var(--ink);
        }
        .lc-col-medico-linha2 {
          margin-top: 4px;
        }
        .lc-tag-exe, .lc-tag-ind {
          display: inline-block;
          padding: 0 5px;
          font-size: 8px;
          font-weight: 800;
          border-radius: 3px;
          letter-spacing: 0.06em;
          vertical-align: middle;
          line-height: 14px;
          height: 14px;
          color: white;
        }
        .lc-tag-exe { background: #102d4b; }
        .lc-tag-ind { background: #102d4b; }
        .lc-linha-drilldown td { border-top: none !important; }
        .lc-drilldown-grid {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
        }
        @media (max-width: 1100px) { .lc-drilldown-grid { grid-template-columns: repeat(2, 1fr); } }
        .lc-drilldown-card {
          background: white; padding: 10px 12px; border-radius: 8px;
          border: 1px solid var(--border);
        }
        .lc-dd-exec  { border-left: 3px solid #143352; }
        .lc-dd-indic { border-left: 3px solid #143352; }
        .lc-dd-total { border-left: 3px solid var(--primary); }
        .lc-drilldown-label {
          font-size: 9px; color: var(--ink-soft); text-transform: uppercase;
          letter-spacing: 0.06em; font-weight: 700; margin-bottom: 4px;
        }
        .lc-drilldown-valor { font-size: 14px; font-weight: 700; color: var(--ink); }
        .lc-drilldown-comp { margin-top: 6px; font-size: 10px; display: flex; flex-direction: column; gap: 3px; }
        .lc-drilldown-lbl { color: var(--ink-soft); font-weight: 600; margin-right: 4px; }

        /* POPOVERS */
        .lc-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 100;
        }
        .lc-popover-ajustes, .lc-popover-ocultar {
          position: fixed; top: 80px; right: 30px;
          width: 440px; max-width: calc(100vw - 60px);
          max-height: calc(100vh - 120px); overflow-y: auto;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: 14px; box-shadow: 0 8px 32px rgba(0,0,0,0.15); z-index: 101;
        }
        /* Popover de regras: ancorado próximo ao topo, abaixo do header */
        .lc-popover-regras {
          position: fixed;
          top: 70px; left: 50%;
          transform: translateX(-50%);
          width: 720px;
          max-width: calc(100vw - 60px);
          max-height: calc(100vh - 100px);
          overflow-y: auto;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 14px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.2);
          z-index: 101;
        }
        .lc-regras-body { padding: 4px 0; }
        .lc-regra-bloco {
          padding: 16px 22px;
          border-bottom: 1px solid var(--border);
        }
        .lc-regra-bloco:last-child { border-bottom: none; }
        .lc-regra-titulo {
          display: flex; align-items: center; gap: 10px;
          font-size: 13px; font-weight: 700;
          color: var(--primary);
          margin-bottom: 10px;
        }
        .lc-regra-num {
          display: inline-flex; align-items: center; justify-content: center;
          width: 22px; height: 22px;
          background: var(--primary); color: white;
          border-radius: 50%; font-size: 11px; font-weight: 700;
          flex-shrink: 0;
        }
        .lc-regra-lista {
          margin: 0; padding-left: 22px;
          font-size: 12px; color: var(--ink); line-height: 1.65;
        }
        .lc-regra-lista li { margin-bottom: 4px; }
        .lc-regra-lista ul { margin-top: 4px; padding-left: 18px; }
        .lc-regra-lista strong { color: var(--ink); font-weight: 700; }
        .lc-regra-lista em { color: var(--accent); font-style: normal; font-weight: 600; }
        .lc-regra-help {
          margin-top: 10px; padding: 8px 12px;
          background: var(--bg-sunken); border-left: 3px solid var(--accent);
          border-radius: 6px; font-size: 11px; color: var(--ink-soft); line-height: 1.5;
        }
        /* Fórmulas (3 caixas) */
        .lc-regras-formulas {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
          margin-bottom: 8px;
        }
        @media (max-width: 700px) {
          .lc-regras-formulas { grid-template-columns: 1fr; }
        }
        .lc-regra-formula {
          background: var(--bg-sunken); padding: 10px 12px;
          border: 1px solid var(--border); border-radius: 8px;
          border-left: 3px solid var(--accent);
        }
        .lc-regra-formula-label {
          font-size: 9px; font-weight: 700; color: var(--ink-soft);
          text-transform: uppercase; letter-spacing: 0.05em;
          margin-bottom: 4px;
        }
        .lc-regra-formula-eq {
          font-size: 12px; color: var(--ink);
          margin-bottom: 4px;
        }
        .lc-regra-formula-eq strong { color: var(--accent); font-size: 13px; }
        .lc-regra-formula-desc {
          font-size: 10px; color: var(--ink-soft); line-height: 1.4;
        }
        /* Tags na documentação */
        .lc-tag-exe-doc, .lc-tag-ind-doc {
          display: inline-block;
          padding: 1px 6px;
          font-size: 9px; font-weight: 800;
          border-radius: 3px; letter-spacing: 0.06em;
          color: white;
        }
        .lc-tag-exe-doc { background: #102d4b; }
        .lc-tag-ind-doc { background: #102d4b; }
        .lc-popover-header {
          padding: 14px 18px; border-bottom: 1px solid var(--border);
          display: flex; justify-content: space-between; align-items: center;
        }
        .lc-popover-header h3 { margin: 0; font-family: var(--font-display); font-weight: 500; font-size: 16px; }
        .lc-popover-close {
          background: transparent; border: none; font-size: 22px;
          color: var(--ink-soft); cursor: pointer; padding: 0 4px;
        }
        .lc-aj-bloco { padding: 14px 18px; border-bottom: 1px solid var(--border); }
        .lc-aj-bloco:last-child { border-bottom: none; }
        .lc-aj-titulo-wrap {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 10px;
        }
        .lc-aj-titulo {
          font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--ink); margin-bottom: 10px;
        }
        .lc-aj-help { font-size: 10px; color: var(--ink-faint); margin-top: 8px; }

        /* % editáveis */
        .lc-aj-pct-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .lc-aj-pct-card {
          background: var(--bg-sunken); border: 1px solid var(--border);
          border-radius: 10px; padding: 10px 12px;
          display: flex; align-items: center; gap: 10px;
        }
        .lc-aj-pct-faixa { width: 3px; height: 28px; border-radius: 2px; flex-shrink: 0; }
        .lc-aj-pct-label {
          font-size: 9px; color: var(--ink-soft); text-transform: uppercase;
          letter-spacing: 0.06em; font-weight: 600; line-height: 1;
        }
        .lc-aj-pct-valor-wrap { display: flex; align-items: baseline; gap: 3px; margin-top: 4px; }
        .lc-aj-pct-num {
          font-size: 18px; font-weight: 700; cursor: pointer;
          padding: 1px 4px; border-radius: 4px;
        }
        .lc-aj-pct-num:hover { background: var(--bg-elevated); }
        .lc-aj-pct-num-input {
          font-family: var(--font-mono); font-size: 18px; font-weight: 700;
          padding: 1px 4px; border: 1px solid var(--accent); border-radius: 4px;
          width: 70px; outline: none;
        }
        .lc-aj-pct-suf { font-size: 11px; color: var(--ink-soft); font-weight: 500; }

        /* Formato dos números */
        .lc-fmt-linha {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 12px; background: var(--bg-sunken);
          border: 1px solid var(--border); border-radius: 10px; margin-bottom: 8px;
        }
        .lc-fmt-label { font-size: 11px; font-weight: 600; color: var(--ink); }
        .lc-fmt-preview { font-size: 11px; color: var(--ink-soft); margin-top: 4px; }
        .lc-fmt-stepper { display: flex; align-items: center; gap: 4px; }
        .lc-fmt-btn {
          width: 26px; height: 26px; border: 1px solid var(--border);
          background: var(--bg-elevated); border-radius: 6px; cursor: pointer;
          font-size: 14px; font-weight: 700; color: var(--primary);
        }
        .lc-fmt-btn:hover:not(:disabled) { background: var(--bg-sunken); }
        .lc-fmt-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .lc-fmt-num { width: 36px; text-align: center; font-size: 13px; font-weight: 700; }

        /* Lista de colunas com rename inline */
        .lc-cols-list { display: flex; flex-direction: column; gap: 4px; }
        .lc-col-row {
          display: flex; align-items: center; gap: 8px;
          padding: 4px 6px; border-radius: 6px;
          transition: background 100ms;
        }
        .lc-col-row:hover { background: var(--bg-sunken); }
        .lc-col-row-fixa { opacity: 0.7; }
        .lc-col-row-custom { background: #e4ecf4; }
        .lc-col-row-custom:hover { background: #e4ecf4; }
        .lc-col-chk { flex-shrink: 0; cursor: pointer; }
        .lc-col-name {
          flex: 1;
          padding: 4px 8px;
          font-size: 12px;
          border: 1px solid transparent;
          background: transparent;
          border-radius: 4px;
          color: var(--ink);
          font-family: var(--font-body, inherit);
        }
        .lc-col-name:hover:not(:disabled) { border-color: var(--border); background: white; }
        .lc-col-name:focus { border-color: var(--accent); background: white; outline: none; }
        .lc-col-name:disabled { color: var(--ink-faint); }
        .lc-col-padrao-tag {
          font-size: 9px; font-weight: 600;
          color: var(--ink-faint); text-transform: uppercase;
          letter-spacing: 0.05em; flex-shrink: 0;
        }
        .lc-col-reset {
          background: var(--accent); color: white;
          border: none; cursor: pointer;
          width: 22px; height: 22px; border-radius: 50%;
          font-size: 12px; font-weight: 700;
          flex-shrink: 0; line-height: 1;
        }
        .lc-col-reset:hover { background: #9b7841; }

        .lc-check-row, .lc-radio {
          display: flex; align-items: center; gap: 8px; font-size: 12px;
          cursor: pointer; padding: 6px 8px; border-radius: 6px;
        }
        .lc-radio:hover { background: var(--bg-sunken); }
        .lc-radio { margin-bottom: 4px; }

        /* Lista de médicos (filtro) */
        .lc-medicos-list {
          max-height: 280px; overflow-y: auto;
          border: 1px solid var(--border); border-radius: 8px;
        }
        .lc-medico-item {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 10px; border-bottom: 1px solid var(--border);
          font-size: 11px; cursor: pointer;
        }
        .lc-medico-item:last-child { border-bottom: none; }
        .lc-medico-item:hover { background: var(--bg-sunken); }

        /* V716: menu de exportar agora é o padrão central (.atlas-menu-exp) */

        .btn-mini {
          padding: 2px 8px; font-size: 10px; font-weight: 600;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: 4px; cursor: pointer; color: var(--ink-soft);
        }
        .btn-mini:hover { background: var(--bg-sunken); }
        .btn-pequeno { padding: 4px 10px; font-size: 11px; font-weight: 600; }
    `;
  }

};
