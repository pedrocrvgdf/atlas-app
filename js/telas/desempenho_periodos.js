/**
 * ============================================================================
 * TELA: Fichário Períodos por Unidade
 *
 * Exibe os dados importados da planilha "Repasse Médico - Períodos".
 * - KPIs por mês (linhas, médicos, unidades, total períodos, total R$)
 * - Tabela detalhada com filtros (ano, mês, unidade, médico)
 * - Comparação com mês anterior e ano anterior
 * - Botão de ocultar valores
 * - Exportar Excel
 *
 * Conceito de "mês de referência" (mes_ref): YYYY-MM da planilha mensal.
 * ============================================================================
 */

App.telas['desempenho-periodos'] = function () {

  if (window.__per === undefined) {
    window.__per = {
      anoSelecionado: null,
      mesSelecionado: null,
      filtroUnidade: '',
      filtroNome: '',
      configColunas: null,
      ocultarAberto: false,
      menuVisaoAberto: false,        // dropdown de modo de exibição
      unidadesColapsadas: new Set(),  // Set de nomes de unidades colapsadas
      linhaEditando: null,            // id da linha sendo editada (modal aberto)
      infoAberto: false,              // V128.4: popover info ⓘ
    };
  }

  const COLUNAS_PADRAO = [
    { id: 'medico',         label: 'Médico',         visivel: true, fixa: true  },
    { id: 'unidade',        label: 'Unidade',        visivel: true, fixa: false },
    { id: 'valor_periodo',  label: 'Valor/Período',  visivel: true, fixa: false },
    { id: 'sem1',           label: 'S1',             visivel: true, fixa: false },
    { id: 'sem2',           label: 'S2',             visivel: true, fixa: false },
    { id: 'sem3',           label: 'S3',             visivel: true, fixa: false },
    { id: 'sem4',           label: 'S4',             visivel: true, fixa: false },
    { id: 'sem5',           label: 'S5',             visivel: true, fixa: false },
    { id: 'total_periodos', label: 'Períodos',       visivel: true, fixa: false },
    { id: 'total_valor',    label: 'Total R$',       visivel: true, fixa: false },
  ];
  const STORAGE_KEY_COLS = 'per_colunas_config_v1';

  function carregarConfigColunas() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_COLS);
      if (!raw) return JSON.parse(JSON.stringify(COLUNAS_PADRAO));
      const salvo = JSON.parse(raw);
      return COLUNAS_PADRAO.map(p => {
        const s = salvo.find(x => x.id === p.id);
        return s ? { ...p, label: s.label, visivel: s.visivel !== false } : p;
      });
    } catch (e) { return JSON.parse(JSON.stringify(COLUNAS_PADRAO)); }
  }
  function salvarConfigColunas(cfg) {
    try { localStorage.setItem(STORAGE_KEY_COLS, JSON.stringify(cfg)); }
    catch (e) { console.warn('Falha localStorage:', e.message); }
  }

  function escapeHTML(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHTML(s); }
  function fmt(n, casas = 0) { return Utilidades.formatarNumero(n || 0, casas); }

  /**
   * Converte índice em rótulo de ofuscação: 0→A, 1→B, ..., 25→Z, 26→AA, etc.
   * Usado no modo "Focar em médico" para identificar os demais sem expor nomes.
   */
  function letraOfuscacao(i) {
    let s = '';
    i = Math.max(0, i);
    do {
      s = String.fromCharCode(65 + (i % 26)) + s;
      i = Math.floor(i / 26) - 1;
    } while (i >= 0);
    return s;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Queries
  // ──────────────────────────────────────────────────────────────────────

  function listarMesesDisponiveis() {
    try {
      return Banco.query(`SELECT DISTINCT mes_ref FROM periodos_linhas ORDER BY mes_ref DESC`)
        .map(r => r.mes_ref);
    } catch (e) { return []; }
  }

  function listarUnidades(mes_ref) {
    const set = new Set();
    try {
      (Banco.query(`
        SELECT DISTINCT unidade FROM periodos_linhas
        WHERE mes_ref = ? ORDER BY unidade
      `, [mes_ref]) || []).forEach(r => { if (r.unidade) set.add(r.unidade); });
    } catch (e) { /* */ }
    // inclui também as unidades cadastradas (ativas), pra permitir filtrar por
    // uma unidade mesmo que ela ainda não tenha médico no mês (ex.: MATRIZ).
    try {
      (Banco.query(`SELECT nome FROM unidades WHERE ativo = 1`) || [])
        .forEach(r => { if (r.nome) set.add(r.nome); });
    } catch (e) { /* */ }
    return Array.from(set).sort();
  }

  function carregarLinhas(mes_ref, filtros) {
    if (!mes_ref) return [];
    const where = [`mes_ref = ?`];
    const params = [mes_ref];

    if (filtros) {
      // V922: unidade e nome aceitam VÁRIOS valores (união)
      const FM = Utilidades.filtroMulti;
      const selUni = FM.sel(filtros.unidade);
      if (selUni.length) {
        where.push(`unidade IN (${selUni.map(() => '?').join(',')})`);
        params.push(...selUni);
      }
      const selNome = FM.sel(filtros.nome);
      if (selNome.length) {
        where.push('(' + selNome.map(() => 'UPPER(nome_normalizado) LIKE ?').join(' OR ') + ')');
        selNome.forEach(x => params.push('%' +
          String(Utilidades.normalizar ? Utilidades.normalizar(x) : x).toUpperCase() + '%'));
      }
    }

    return Banco.query(`
      SELECT id, mes_ref, nome_original, nome_normalizado, unidade, valor_periodo,
             sem1, sem2, sem3, sem4, sem5, total_periodos, total_valor
      FROM periodos_linhas
      WHERE ${where.join(' AND ')}
      ORDER BY unidade, nome_original
    `, params);
  }

  function calcularKPIs(linhas) {
    return {
      linhas: linhas.length,
      medicos: new Set(linhas.map(l => l.nome_normalizado)).size,
      unidades: new Set(linhas.map(l => l.unidade)).size,
      total_periodos: linhas.reduce((s, l) => s + (l.total_periodos || 0), 0),
      total_valor: linhas.reduce((s, l) => s + (l.total_valor || 0), 0),
    };
  }

  function mesAnterior(mes_ref) {
    if (!mes_ref) return null;
    const [a, m] = mes_ref.split('-').map(Number);
    const ma = m === 1 ? 12 : m - 1;
    const aa = m === 1 ? a - 1 : a;
    return `${aa}-${String(ma).padStart(2, '0')}`;
  }
  function anoAnterior(mes_ref) {
    if (!mes_ref) return null;
    const [a, m] = mes_ref.split('-').map(Number);
    return `${a - 1}-${String(m).padStart(2, '0')}`;
  }

  function formatarMesLabel(mes_ref) {
    if (!mes_ref) return '—';
    const [ano, mes] = mes_ref.split('-');
    const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${nomes[parseInt(mes) - 1]}/${ano.slice(2)}`;
  }

  // ──────────────────────────────────────────────────────────────────────
  // RENDER PRINCIPAL
  // ──────────────────────────────────────────────────────────────────────

  function renderizar() {
    const meses = listarMesesDisponiveis();

    // Se ainda não tem mês selecionado, pega o mais recente
    if (!window.__per.anoSelecionado && meses.length > 0) {
      const [ano, mes] = meses[0].split('-');
      window.__per.anoSelecionado = ano;
      window.__per.mesSelecionado = mes;
    }

    const mes_ref = window.__per.anoSelecionado && window.__per.mesSelecionado
      ? `${window.__per.anoSelecionado}-${window.__per.mesSelecionado}`
      : null;

    const filtros = {
      unidade: window.__per.filtroUnidade,
      nome: window.__per.filtroNome,
    };

    const linhas = carregarLinhas(mes_ref, filtros);
    const kpis = calcularKPIs(linhas);

    // Comparação LM (mês anterior) e LY (ano anterior)
    const mp = mesAnterior(mes_ref);
    const ya = anoAnterior(mes_ref);
    const linhasLM = mp ? carregarLinhas(mp, {}) : [];
    const linhasLY = ya ? carregarLinhas(ya, {}) : [];
    const kpisLM = linhasLM.length > 0 ? calcularKPIs(linhasLM) : null;
    const kpisLY = linhasLY.length > 0 ? calcularKPIs(linhasLY) : null;

    // YTD (do mesmo ano até este mês)
    let kpisYTD = null;
    if (mes_ref) {
      const [ano, mes] = mes_ref.split('-');
      const linhasYTD = Banco.query(`
        SELECT * FROM periodos_linhas
        WHERE mes_ref >= ? AND mes_ref <= ?
        ORDER BY mes_ref
      `, [`${ano}-01`, mes_ref]);
      kpisYTD = calcularKPIs(linhasYTD);
    }

    const cfg = (window.__per.configColunas = window.__per.configColunas || carregarConfigColunas());

    const html = `
      <div class="page-content per-page">
        ${renderHeader()}
        ${renderFiltros(meses)}
        ${meses.length === 0
          ? renderVazio()
          : `
            ${renderCards(kpis, kpisLM, kpisLY, kpisYTD, mes_ref)}
            ${renderTabela(linhas, mes_ref, cfg)}
            ${renderSnapshots(meses)}
          `}
      </div>
    `;

    // V492: CSS injetado 1x no <head> (antes: <style> re-parseado dentro do innerHTML a cada render)
    Utilidades.garantirEstilos('css-tela-desempenho-periodos', getStyles());
    document.getElementById('conteudo').innerHTML = html;
    bindEventos();
    Utilidades.aplicarMascaraValores();
  }

  // ──────────────────────────────────────────────────────────────────────
  // Header
  // ──────────────────────────────────────────────────────────────────────
  function renderHeader() {
    const modo = Utilidades.modoExibicao();
    const focoNorm = Utilidades.medicoFoco();
    const focoNome = focoNorm ? buscarNomeOriginalMedico(focoNorm) : null;

    let labelVisao = '👁 Visualização';
    if (modo === 'oculto') labelVisao = '<i class="ti ti-eye-off"></i> Ocultos';
    if (modo === 'foco' && focoNome) labelVisao = `🎯 ${focoNome}`;

    return `
      <div class="per-header">
        <div class="per-header-info">
          <div class="fic-titulo-wrap">
            <h1>Períodos</h1>
            <button class="fic-btn-info ${window.__per.infoAberto ? 'fic-btn-info-ativo' : ''}"
                    id="per-btn-info"
                    title="Ver regras do fichário Períodos">ⓘ</button>
          </div>
          ${window.__per.infoAberto ? `
            <div class="fic-popover-info">
              <div class="fic-popover-info-head">
                <strong>Regras Períodos por Unidade</strong>
                <button class="fic-popover-info-close" id="per-info-close">✕</button>
              </div>
              <div class="fic-popover-info-body">
                <p>
                  <strong>Granularidade</strong> · 1 linha = 1 médico em 1 unidade num mês.
                  Chave natural: <code>(mes_ref + nome_normalizado + unidade)</code>.
                </p>
                <p>
                  <strong>Cálculo</strong> · <code>total_valor = valor_periodo × total_periodos</code>.
                  Os períodos são contados por semana (sem1, sem2, sem3, sem4, sem5).
                </p>
                <p>
                  <strong>Importação</strong> · Snapshot mensal — a planilha "Repasse Médico — Períodos"
                  sobrescreve os dados do mes_ref correspondente.
                </p>
                <p>
                  <strong>Comparativos</strong> · A tela compara o mês selecionado com o
                  <em>mês anterior</em> (LM) e o <em>mesmo mês do ano anterior</em> (LY),
                  além do YTD.
                </p>
              </div>
            </div>
          ` : ''}
          <p>Plantões dos médicos por unidade de atendimento</p>
        </div>
        <div class="per-header-acoes">
          <div class="per-menu-wrap">
            <button class="btn-compact ${modo !== 'tudo' ? 'ativo' : ''}" id="btn-per-visualizacao" title="Modo de exibição">
              ${labelVisao} ▾
            </button>
            ${window.__per.menuVisaoAberto ? renderMenuVisao(modo, focoNorm) : ''}
          </div>
          <button class="btn-compact" id="btn-per-colunas">⋮ Colunas</button>
          <button class="btn-compact" id="btn-per-importar">📥 Importar</button>
          <button class="btn-compact btn-compact-primary" id="btn-per-exportar">↓ Excel</button>
        </div>
      </div>
    `;
  }

  /** Busca o nome original do médico a partir do nome normalizado. */
  function buscarNomeOriginalMedico(norm) {
    if (!norm) return null;
    try {
      const r = Banco.queryUnica(
        `SELECT nome_original FROM periodos_linhas WHERE nome_normalizado = ? LIMIT 1`,
        [norm]
      );
      return r?.nome_original || null;
    } catch (e) { return null; }
  }

  /** Menu dropdown de modo de exibição (Tudo · Oculto · Focar em médico) */
  function renderMenuVisao(modo, focoNorm) {
    const mes_ref = window.__per.anoSelecionado && window.__per.mesSelecionado
      ? `${window.__per.anoSelecionado}-${window.__per.mesSelecionado}`
      : null;
    let medicosDisponiveis = [];
    if (mes_ref) {
      try {
        medicosDisponiveis = Banco.query(`
          SELECT DISTINCT nome_normalizado, nome_original
          FROM periodos_linhas
          WHERE mes_ref = ?
          ORDER BY nome_original
        `, [mes_ref]);
      } catch (e) {}
    }

    return `
      <div class="per-menu-visao" id="per-menu-visao">
        <button class="per-menu-item ${modo === 'tudo' ? 'ativo' : ''}" data-modo="tudo">
          <span class="per-menu-ico">👁</span>
          <span class="per-menu-txt">
            <strong>Mostrar tudo</strong>
            <small>Exibição normal</small>
          </span>
        </button>
        <button class="per-menu-item ${modo === 'oculto' ? 'ativo' : ''}" data-modo="oculto">
          <span class="per-menu-ico"><i class="ti ti-eye-off"></i></span>
          <span class="per-menu-txt">
            <strong>Ocultar valores</strong>
            <small>Para compartilhar tela / fotografar</small>
          </span>
        </button>
        <div class="per-menu-sep"></div>
        <div class="per-menu-foco">
          <div class="per-menu-foco-label">
            <span class="per-menu-ico">🎯</span>
            <strong>Focar em médico</strong>
          </div>
          <small style="display:block; padding:0 4px 6px; color: var(--ink-faint); font-size: 10px;">
            Mostra só este médico com nome/valor reais.<br>Demais ficam como "Médico A", "Médico B"...
          </small>
          <select class="per-menu-foco-select" id="per-foco-select">
            <option value="">— selecione —</option>
            ${medicosDisponiveis.map(m =>
              `<option value="${escapeAttr(m.nome_normalizado)}" ${m.nome_normalizado === focoNorm ? 'selected' : ''}>${escapeHTML(CodigoMedico.exibir(m.nome_original))}</option>`
            ).join('')}
          </select>
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Estado vazio (sem importação)
  // ──────────────────────────────────────────────────────────────────────
  function renderVazio() {
    return `
      <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 40px 20px">
        <div style="font-size: 32px; margin-bottom: 12px;">📂</div>
        <div style="color: var(--ink-soft); font-size: 14px; margin-bottom: 16px;">
          Nenhuma planilha de Períodos importada ainda.
        </div>
        <button class="btn btn-primary" id="btn-per-importar-vazio">
          📥 Importar Planilha de Períodos
        </button>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Filtros — fileira de filtros 20C (padrão do LIO/OPME, prefixo per-sb)
  // ──────────────────────────────────────────────────────────────────────
  const MESES_EXTENSO_PER = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  function renderFiltros(meses) {
    if (meses.length === 0) return '';

    const anosMap = new Map();
    for (const m of meses) {
      const [ano, mes] = m.split('-');
      if (!anosMap.has(ano)) anosMap.set(ano, []);
      anosMap.get(ano).push(mes);
    }
    const anos = Array.from(anosMap.keys()).sort().reverse();
    const mesesDoAno = (anosMap.get(window.__per.anoSelecionado) || []).slice().sort();

    const mes_ref = `${window.__per.anoSelecionado}-${window.__per.mesSelecionado}`;
    const unidades = listarUnidades(mes_ref);
    let nomes = [];
    try {
      nomes = (Banco.query(`
        SELECT DISTINCT nome_original FROM periodos_linhas
        WHERE mes_ref = ? ORDER BY nome_original
      `, [mes_ref]) || []).map(r => r.nome_original).filter(Boolean);
    } catch (e) { /* */ }
    const FM = Utilidades.filtroMulti;
    const temFiltros = FM.ativo(window.__per.filtroUnidade) || FM.ativo(window.__per.filtroNome);

    return `
      <div class="per-filtros-bar">
        ${renderBarraFiltrosPer20C({ anos, mesesDoAno, unidades, nomes })}
        ${temFiltros ? `<button class="btn btn-sm" id="per-limpar-filtros">✕ Limpar</button>` : ''}
      </div>
    `;
  }

  // ── fileira de filtros 20C (mesmo padrão do LIO, com as individualidades
  // dos Períodos: Ano · Mês · Unidade · Nome — o Nome é busca por TEXTO
  // LIVRE: o que se digita no campo do painel é o filtro, Enter aplica).
  // Painéis abrem/fecham LOCAL (insertAdjacentHTML — zero re-render).
  function _perSbIc(nome) {
    return {
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
      user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
      check: '<polyline points="20 6 9 17 4 12"/>',
      chev: '<polyline points="6 9 12 15 18 9"/>',
    }[nome] || '';
  }
  function _perSbSvg(d, px, sw) {
    return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  function _perSbSemAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  // V922: rótulo fechado do filtro multi — 1 marcado mostra o nome; N mostra "N selecionados"
  function _perRotMulti(v) {
    const s = Utilidades.filtroMulti.sel(v);
    if (!s.length) return '';
    return s.length === 1 ? s[0] : `${s.length} selecionados`;
  }

  function renderBarraFiltrosPer20C(ctx) {
    // guarda as listas pro painel abrir LOCAL depois, sem recoletar
    window.__per._sbOpcoes = {
      anos: ctx.anos,
      meses: ctx.mesesDoAno,
      unidades: ctx.unidades,
      nomes: ctx.nomes,
    };
    const cel = (id, rotulo, valor, icone, flex, vazio = 'Todos') => {
      const ativo = !!valor;
      const estaAberta = window.__per.sbAberto === id;
      return `
        <div class="per-sb-celwrap" style="flex:${flex}">
          <button type="button" class="per-sb-cel ${ativo ? 'ativo' : ''} ${estaAberta ? 'aberta' : ''}"
                  data-sb-cel="${id}" data-sb-vazio="${vazio}" role="combobox" aria-expanded="${estaAberta ? 'true' : 'false'}" aria-haspopup="listbox">
            <span class="per-sb-tile">${_perSbSvg(_perSbIc(icone), 14, 2.1)}</span>
            <span class="per-sb-tx">
              <span class="per-sb-rot">${rotulo}</span>
              <span class="per-sb-val">${escapeHTML(valor || vazio)}</span>
            </span>
            <span class="per-sb-chev">${_perSbSvg(_perSbIc('chev'), 10, 2.8)}</span>
          </button>
          ${estaAberta ? painelPer20C(id) : ''}
        </div>`;
    };
    const mesLabel = window.__per.mesSelecionado
      ? (MESES_EXTENSO_PER[parseInt(window.__per.mesSelecionado, 10) - 1] || window.__per.mesSelecionado)
      : '';
    return `
      <div class="per-sb" id="per-sb">
        ${cel('ano', 'Ano', window.__per.anoSelecionado || '', 'clock', 0.75)}
        ${cel('mes', 'Mês', mesLabel, 'calendar', 0.8)}
        ${cel('unidade', 'Unidade', _perRotMulti(window.__per.filtroUnidade), 'grid', 1.15, 'Todas')}
        ${cel('nome', 'Nome', _perRotMulti(window.__per.filtroNome), 'user', 1.3)}
      </div>`;
  }

  function painelPer20C(id) {
    const opc = window.__per._sbOpcoes || {};
    const item = (val, rotulo, sel) => `
      <div class="per-sb-it ${sel ? 'sel' : ''} ${val === '' ? 'per-sb-it-todos' : ''}" data-sb-item data-val="${escapeHTML(val)}" data-busca="${escapeHTML(_perSbSemAcento(rotulo))}" role="option" aria-selected="${sel ? 'true' : 'false'}">
        <span class="per-sb-it-nome">${escapeHTML(rotulo)}</span>
        ${sel ? `<span class="per-sb-ck">${_perSbSvg(_perSbIc('check'), 14, 2.5)}</span>` : ''}
      </div>`;
    const painelLista = (cel, itensHtml, { busca = false, valorBusca = '', hint = '', rodape = '' } = {}) => `
      <div class="per-sb-painel" data-sb-painel="${cel}">
        ${busca ? `
          <div class="per-sb-buscabox">
            <span class="per-sb-busca-ic">${_perSbSvg(_perSbIc('search'), 15, 2.1)}</span>
            <input type="text" class="per-sb-busca" data-sb-busca placeholder="${escapeHTML(hint || 'Digite pra buscar')}" value="${escapeAttr(valorBusca)}" autocomplete="off">
          </div>` : ''}
        <div class="per-sb-lista" role="listbox">
          ${itensHtml}
        </div>
        ${rodape ? `<div class="per-sb-rodape" data-sb-contagem>${rodape}</div>` : ''}
      </div>`;
    if (id === 'ano') {
      return painelLista('ano', (opc.anos || []).map(a => item(a, a, a === window.__per.anoSelecionado)).join(''));
    }
    if (id === 'mes') {
      return painelLista('mes', (opc.meses || []).map(m =>
        item(m, MESES_EXTENSO_PER[parseInt(m, 10) - 1] || m, m === window.__per.mesSelecionado)).join(''));
    }
    const FM = Utilidades.filtroMulti;
    if (id === 'unidade') {
      // V922: multi — checkbox + busca; marcadas sobem ao topo; "Todas" limpa
      const selU = FM.sel(window.__per.filtroUnidade);
      const unidades = (opc.unidades || []).slice()
        .sort((a, b) => (FM.marcado(selU, b) ? 1 : 0) - (FM.marcado(selU, a) ? 1 : 0));
      return painelLista('unidade', item('', 'Todas', !selU.length)
        + unidades.map(u => item(u, u, FM.marcado(selU, u))).join(''), {
        busca: true,
        valorBusca: window.__per._sbBusca || '',
        hint: 'Buscar unidade',
        rodape: `${selU.length} selecionada(s) · ${(opc.unidades || []).length} opções`,
      });
    }
    // Nome (V922, multi): marcar N nomes = união; a INDIVIDUALIDADE do texto
    // livre continua — Enter soma o texto digitado como mais um filtro (LIKE).
    const selN = FM.sel(window.__per.filtroNome);
    const nomesBase = opc.nomes || [];
    const extras = selN.filter(x => !nomesBase.includes(x)); // textos livres marcados
    const nomes = nomesBase.slice()
      .sort((a, b) => (FM.marcado(selN, b) ? 1 : 0) - (FM.marcado(selN, a) ? 1 : 0));
    return painelLista('nome', item('', 'Todos', !selN.length)
      + extras.map(n => item(n, n, true)).join('')
      + nomes.slice(0, 400).map(n => item(n, n, FM.marcado(selN, n))).join(''), {
      busca: true,
      valorBusca: window.__per._sbBusca || '',
      hint: 'Digite e Enter aplica',
      rodape: selN.length
        ? `${selN.length} selecionado(s) · Enter soma o texto digitado`
        : 'Enter aplica o texto digitado como filtro',
    });
  }

  function bindBarraFiltrosPer20C() {
    const sb = document.getElementById('per-sb');
    if (!sb) return;
    const fecharPainelLocal = () => {
      sb.querySelectorAll('.per-sb-painel').forEach(p => p.remove());
      sb.querySelectorAll('.per-sb-cel.aberta').forEach(c => { c.classList.remove('aberta'); c.setAttribute('aria-expanded', 'false'); });
      window.__per.sbAberto = null;
    };
    const aplicar = (celId, val) => {
      if (celId === 'ano') {
        window.__per.anoSelecionado = val;
        const meses = listarMesesDisponiveis();
        const desseAno = meses.filter(m => m.startsWith(val));
        if (desseAno.length > 0) window.__per.mesSelecionado = desseAno[0].split('-')[1];
        window.__per.filtroUnidade = '';
      } else if (celId === 'mes') {
        window.__per.mesSelecionado = val;
        window.__per.filtroUnidade = '';
      } else if (celId === 'unidade' || celId === 'nome') {
        // V922: multi — o clique TOGGLA o item e a lista fica ABERTA
        // (sbAberto mantido → o template reabre o painel no re-render;
        // wireInputsPainel do bind restaura a busca digitada)
        const FM = Utilidades.filtroMulti;
        const chave = celId === 'unidade' ? 'filtroUnidade' : 'filtroNome';
        if (!val) window.__per[chave] = [];               // "Todos/Todas" limpa
        else window.__per[chave] = FM.toggle(window.__per[chave], val);
        renderizar();
        return;
      }
      fecharPainelLocal();
      renderizar();
    };
    const wireInputsPainel = () => {
      const busca = sb.querySelector('[data-sb-busca]');
      if (!busca) return;
      setTimeout(() => {
        busca.focus();
        if (busca.value) busca.setSelectionRange(busca.value.length, busca.value.length);
      }, 0);
      const filtrar = () => {
        const q = _perSbSemAcento(busca.value);
        const painel = busca.closest('.per-sb-painel');
        painel.querySelectorAll('[data-sb-item]').forEach(el => {
          const mostra = el.classList.contains('per-sb-it-todos') || el.classList.contains('sel')
            || !q || (el.dataset.busca || '').includes(q);
          el.style.display = mostra ? '' : 'none';
        });
      };
      busca.addEventListener('input', () => {
        window.__per._sbBusca = busca.value;   // V922: sobrevive ao toggle
        filtrar();
      });
      if (busca.value) filtrar();
    };
    const abrirPainelLocal = (id) => {
      const jaAberto = window.__per.sbAberto === id;
      fecharPainelLocal();
      if (jaAberto) return;
      window.__per.sbAberto = id;
      window.__per._sbBusca = '';
      const btn = sb.querySelector(`[data-sb-cel="${id}"]`);
      btn.classList.add('aberta');
      btn.setAttribute('aria-expanded', 'true');
      btn.parentElement.insertAdjacentHTML('beforeend', painelPer20C(id));
      wireInputsPainel();
    };
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
      if (!window.__per.sbAberto) return;
      const painel = sb.querySelector('.per-sb-painel');
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
        if (f) { e.preventDefault(); aplicar(painel.dataset.sbPainel, f.dataset.val); return; }
        // INDIVIDUALIDADE do Nome: sem item focado, Enter SOMA o TEXTO LIVRE
        if (painel.dataset.sbPainel === 'nome') {
          const busca = painel.querySelector('[data-sb-busca]');
          const txt = busca ? busca.value.trim() : '';
          if (txt) { e.preventDefault(); window.__per._sbBusca = ''; aplicar('nome', txt); }
        }
      }
    });
    if (window.__perSbFechar) {
      document.removeEventListener('click', window.__perSbFechar);
      document.removeEventListener('keydown', window.__perSbEsc);
    }
    const fecharFora = (e) => {
      if (App.telaAtual !== 'desempenho-periodos') return;
      if (window.__per.sbAberto && !e.target.closest('#per-sb')) fecharPainelLocal();
    };
    const escFecha = (e) => { if (e.key === 'Escape' && window.__per.sbAberto) fecharPainelLocal(); };
    window.__perSbFechar = fecharFora;
    window.__perSbEsc = escFecha;
    document.addEventListener('click', fecharFora);
    document.addEventListener('keydown', escFecha);
    if (window.__per.sbAberto) wireInputsPainel();
  }

  // ──────────────────────────────────────────────────────────────────────
  // Cards KPI
  // ──────────────────────────────────────────────────────────────────────
  function renderCards(k, kLM, kLY, kYTD, mes_ref) {
    function linhaComp(atual, lm, ly) {
      function p(v) {
        if (v === null || v === undefined || atual === undefined) return '<span class="per-comp-vazio">—</span>';
        const diff = atual - v;
        const pct = v === 0 ? null : (diff / v) * 100;
        if (pct === null) return `<span class="per-comp-vazio">—</span>`;
        const seta = pct > 0 ? '↑' : (pct < 0 ? '↓' : '=');
        const classe = pct > 0 ? 'per-comp-pos' : (pct < 0 ? 'per-comp-neg' : '');
        return `<span class="${classe}">${seta} ${Math.abs(pct).toFixed(1)}%</span>`;
      }
      return `<div class="per-card-comp">LM ${p(lm)}  LY ${p(ly)}</div>`;
    }

    return `
      <div class="per-cards-grid">
        <!-- Card 1: Total Períodos + breakdown -->
        <div class="per-card per-card-verde">
          <div class="per-card-faixa"></div>
          <div class="per-card-titulo">Períodos Trabalhados</div>
          <div class="per-card-valor mono" data-ocultavel>${fmt(k.total_periodos)}</div>
          <div class="per-card-breakdown">
            <div class="per-bd-item">Médicos: <strong data-ocultavel>${k.medicos}</strong></div>
            <div class="per-bd-item">Unidades: <strong data-ocultavel>${k.unidades}</strong></div>
            <!-- V860: a contagem de LINHAS saiu do card — é medida interna da
                 tabela (1 linha = 1 médico numa unidade), não um totalizador -->
          </div>
          ${linhaComp(k.total_periodos, kLM?.total_periodos, kLY?.total_periodos)}
        </div>

        <!-- Card 2: YTD -->
        <div class="per-card per-card-roxo">
          <div class="per-card-faixa"></div>
          <div class="per-card-titulo">Períodos YTD</div>
          <div class="per-card-valor mono" data-ocultavel>${fmt(kYTD?.total_periodos || 0)}</div>
          <div class="per-card-sub">Total YTD: <strong data-ocultavel>R$ ${fmt(kYTD?.total_valor || 0, 0)}</strong></div>
        </div>

        <!-- Card 3: Médicos do mês -->
        <div class="per-card per-card-bege">
          <div class="per-card-faixa"></div>
          <div class="per-card-titulo">Médicos Ativos</div>
          <div class="per-card-valor mono" data-ocultavel>${k.medicos}</div>
          <div class="per-card-sub">Em <span data-ocultavel>${k.unidades}</span> unidade${k.unidades !== 1 ? 's' : ''}</div>
          ${linhaComp(k.medicos, kLM?.medicos, kLY?.medicos)}
        </div>

        <!-- Card 4: Taxa total destaque -->
        <div class="per-card per-card-destaque">
          <div class="per-card-titulo">Total a Pagar · Mês</div>
          <div class="per-card-valor mono" data-ocultavel>R$ ${fmt(k.total_valor, 2)}</div>
          <div class="per-card-sub"><span data-ocultavel>${k.total_periodos}</span> período${k.total_periodos !== 1 ? 's' : ''}</div>
          ${linhaComp(k.total_valor, kLM?.total_valor, kLY?.total_valor)}
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Tabela
  // ──────────────────────────────────────────────────────────────────────
  function renderTabela(linhas, mes_ref, cfgCols) {
    const cols = cfgCols.filter(c => c.visivel);

    // Unidades cadastradas (ativas) que devem aparecer MESMO sem médico.
    // Não injeta quando há busca por médico (aí só faz sentido mostrar quem tem dado).
    const FM = Utilidades.filtroMulti;
    const temBuscaNome = !!(window.__per && FM.ativo(window.__per.filtroNome));
    let unidadesVazias = [];
    if (!temBuscaNome) {
      try {
        const selUni = FM.sel(window.__per.filtroUnidade);
        unidadesVazias = (Banco.query(`SELECT nome FROM unidades WHERE ativo = 1 ORDER BY ordem, nome`) || [])
          .map(u => u.nome)
          .filter(n => !selUni.length || selUni.includes(n));
      } catch (e) { /* */ }
    }

    if (linhas.length === 0 && unidadesVazias.length === 0) {
      return `
        <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 24px">
          <div style="color: var(--ink-faint); font-size: 13px">
            Nenhuma linha encontrada com os filtros atuais.
          </div>
        </div>
      `;
    }

    // ── Mapa de ofuscação para modo FOCO ────────────────────────────────
    // Mesmo médico em várias linhas/unidades recebe o mesmo "Médico X".
    const modoExib = Utilidades.modoExibicao();
    const focoNorm = modoExib === 'foco' ? Utilidades.medicoFoco() : null;
    const mapaOfuscado = new Map();
    if (modoExib === 'foco') {
      let i = 0;
      const ordemMedicos = [];
      for (const l of linhas) {
        if (l.nome_normalizado === focoNorm) continue;
        if (!mapaOfuscado.has(l.nome_normalizado)) {
          const letra = letraOfuscacao(i++);
          mapaOfuscado.set(l.nome_normalizado, `Médico ${letra}`);
          ordemMedicos.push(l.nome_normalizado);
        }
      }
    }
    function mascararLinha(l) {
      return modoExib === 'foco' && l.nome_normalizado !== focoNorm;
    }
    function nomeExibido(l) {
      if (mascararLinha(l)) return mapaOfuscado.get(l.nome_normalizado) || 'Médico ?';
      return l.nome_original;
    }

    // Agrupa por unidade
    const porUnidade = new Map();
    for (const l of linhas) {
      if (!porUnidade.has(l.unidade)) porUnidade.set(l.unidade, []);
      porUnidade.get(l.unidade).push(l);
    }

    // Ordena: unidades cadastradas (na ordem do cadastro) primeiro — incluindo as
    // VAZIAS —, depois quaisquer unidades extras que só existam nos dados.
    let gruposOrdenados;
    if (temBuscaNome) {
      gruposOrdenados = porUnidade;
    } else {
      gruposOrdenados = new Map();
      for (const nome of unidadesVazias) gruposOrdenados.set(nome, porUnidade.get(nome) || []);
      for (const [u, ls] of porUnidade) if (!gruposOrdenados.has(u)) gruposOrdenados.set(u, ls);
    }

    function renderTr(l) {
      const mask = mascararLinha(l);
      // No modo foco, valores dessa linha são ofuscados; nas outras (modo 'oculto') o data-ocultavel cuida
      const attr = mask ? 'data-mascarar data-ocultavel' : 'data-ocultavel';
      const trCls = mask ? ' class="per-linha-mascarada"' : '';
      const tds = cols.map(c => {
        if (c.id === 'medico')         return `<td>${mask ? `<span class="per-medico-ofuscado">${escapeHTML(nomeExibido(l))}</span>` : escapeHTML(CodigoMedico.exibir(l.nome_original))}</td>`;
        if (c.id === 'unidade')        return `<td>${escapeHTML(l.unidade)}</td>`;
        if (c.id === 'valor_periodo')  return `<td class="num mono" ${attr}>R$ ${fmt(l.valor_periodo, 2)}</td>`;
        if (c.id === 'sem1')           return `<td class="num mono" ${attr}>${l.sem1 || '—'}</td>`;
        if (c.id === 'sem2')           return `<td class="num mono" ${attr}>${l.sem2 || '—'}</td>`;
        if (c.id === 'sem3')           return `<td class="num mono" ${attr}>${l.sem3 || '—'}</td>`;
        if (c.id === 'sem4')           return `<td class="num mono" ${attr}>${l.sem4 || '—'}</td>`;
        if (c.id === 'sem5')           return `<td class="num mono" ${attr}>${l.sem5 || '—'}</td>`;
        if (c.id === 'total_periodos') return `<td class="num mono" ${attr} style="font-weight: 700">${l.total_periodos}</td>`;
        if (c.id === 'total_valor')    return `<td class="num mono atlas-rep" ${attr}>R$ ${fmt(l.total_valor, 2)}</td>`;   /* V962: valor de repasse em #46688c */
        return '<td></td>';
      }).join('');
      // Coluna de ações — escondida em linhas mascaradas para não vazar id
      const acoes = mask
        ? `<td class="per-acoes-cell"></td>`
        : `<td class="per-acoes-cell">
            <button class="per-btn-acao" data-acao="editar" data-id="${l.id}" title="Editar linha">✏</button>
            <button class="per-btn-acao per-btn-danger" data-acao="excluir" data-id="${l.id}" title="Excluir linha">🗑</button>
          </td>`;
      return `<tr${trCls}>${tds}${acoes}</tr>`;
    }

    // Cabeçalho de cada unidade (clicável para colapsar)
    function renderGrupo(unidade, linhasUnidade) {
      const colapsado = window.__per.unidadesColapsadas.has(unidade);
      const seta = colapsado ? '▶' : '▼';
      const sumP = linhasUnidade.reduce((s, l) => s + (l.total_periodos || 0), 0);
      const sumV = linhasUnidade.reduce((s, l) => s + (l.total_valor || 0), 0);

      /**
       * V861: a faixa da unidade virou UMA linha flex.
       *
       * Antes eram três blocos com `float: right` disputando a mesma faixa —
       * e float empilha da direita para a esquerda, então a ordem saía
       * invertida em relação ao código e nada assentava no mesmo eixo (o texto
       * tinha 10px com opacidade 0,7; os botões, círculos de 22px).
       *
       * Agora: nome à esquerda; à direita, as ações e depois os números, todos
       * centrados verticalmente. Os ícones vêm ANTES do texto, como na tela que
       * o usuário já conhecia.
       *
       * Os glifos são SVG de traço: o `ti-trash` (fonte de ícones) e o "+"
       * tipográfico assentam em alturas diferentes e não há como alinhá-los um
       * ao outro de forma confiável.
       *
       * Cor (V950): glifo BRANCO sobre pastilha #0B1D33 (o marinho do menu).
       * Antes era dourado #B8965A sobre #1d1f20.
       */
      const svgMais = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
        stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
      const svgLixo = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path
        d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>`;
      const btnAdd = `<button type="button" class="per-grupo-ico per-grupo-add" data-add-unidade="${escapeAttr(unidade)}" title="Adicionar médico a esta unidade" aria-label="Adicionar médico a ${escapeAttr(unidade)}">${svgMais}</button>`;
      const btnDel = `<button type="button" class="per-grupo-ico per-grupo-del" data-del-unidade="${escapeAttr(unidade)}" title="Excluir esta unidade (todos os meses)" aria-label="Excluir a unidade ${escapeAttr(unidade)}">${svgLixo}</button>`;
      const vazia = linhasUnidade.length === 0;
      /**
       * V863: a faixa passou a ser feita de CÉLULAS REAIS, uma por coluna.
       *
       * Na V861 ela era um flex só, com os números empurrados para a direita:
       * o total até caía perto da coluna "Total R$", mas a contagem de períodos
       * flutuava no meio da faixa, sem relação nenhuma com a coluna "Períodos"
       * logo abaixo. Célula a célula, o alinhamento deixa de ser ajuste fino e
       * passa a ser consequência da tabela — cada número nasce na coluna dele.
       *
       * Os botões vão para a coluna de AÇÕES (a última, que já existia vazia),
       * então ficam DEPOIS do valor consolidado sem empurrar nada.
       */
      const tdsGrupo = cols.map((c, i) => {
        if (i === 0) return `<td class="per-grupo-nome">
            <span class="per-grupo-icone">${seta}</span>${escapeHTML(unidade)}
            <span class="per-grupo-med"><span data-ocultavel>${linhasUnidade.length}</span> médico${linhasUnidade.length !== 1 ? 's' : ''}</span>
          </td>`;
        if (c.id === 'total_periodos') return `<td class="num per-grupo-num" data-ocultavel>${sumP}</td>`;
        if (c.id === 'total_valor')    return `<td class="num per-grupo-num atlas-rep" data-ocultavel>R$ ${fmt(sumV, 2)}</td>`;   /* V962 */
        return '<td></td>';
      }).join('');
      return `
        <tr class="per-grupo-header" data-unidade="${escapeAttr(unidade)}">
          ${tdsGrupo}
          <td class="per-grupo-acoes">${btnAdd}${btnDel}</td>
        </tr>
        ${colapsado || vazia ? '' : linhasUnidade.map(renderTr).join('')}
      `;
      // V861: a linha "↳ Subtotal" saiu — os mesmos números estão na faixa acima
    }

    // V861: a linha "Total / <mês>" saiu do rodapé — o total do mês já está nos
    // cards totalizadores, no topo da tela (Períodos Trabalhados e Total a Pagar)

    const ths = cols.map(c => {
      const alinh = ['valor_periodo','sem1','sem2','sem3','sem4','sem5','total_periodos','total_valor'].includes(c.id) ? 'num' : '';
      return `<th class="${alinh}">${escapeHTML(c.label)}</th>`;
    }).join('') + '<th class="per-acoes-col"></th>';

    // Banner indicando que o modo Foco está ativo
    const banner = (modoExib === 'foco' && focoNorm) ? `
      <div class="per-foco-banner">
        <span>🎯 <strong>Modo apresentação ativo</strong> · Mostrando dados de <strong>${escapeHTML(buscarNomeOriginalMedico(focoNorm) || '—')}</strong>. Demais médicos aparecem como "Médico A/B/C...".</span>
        <button class="btn-compact" id="btn-per-sair-foco">✕ Sair do modo foco</button>
      </div>
    ` : '';

    return `
      ${banner}
      <div class="per-tabela-card">
        <table class="per-tabela">
          <thead><tr>${ths}</tr></thead>
          <tbody>
            ${Array.from(gruposOrdenados.entries())
              .map(([u, ls]) => renderGrupo(u, ls))
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Snapshots importados (lista de meses + ações)
  // ──────────────────────────────────────────────────────────────────────
  function renderSnapshots(meses) {
    // Pega stats de cada mês
    let snapshots = [];
    try {
      snapshots = Banco.query(`
        SELECT mes_ref,
               COUNT(*) AS linhas,
               COUNT(DISTINCT nome_normalizado) AS medicos,
               COUNT(DISTINCT unidade) AS unidades,
               SUM(total_periodos) AS total_periodos,
               SUM(total_valor) AS total_valor,
               MAX(importado_em) AS ultima_importacao
        FROM periodos_linhas
        GROUP BY mes_ref
        ORDER BY mes_ref DESC
      `);
    } catch (e) {
      return '';
    }

    const valor_padrao = (() => {
      try {
        const r = Banco.queryUnica(`SELECT valor FROM periodos_config WHERE chave = 'VALOR_PADRAO_PERIODO'`);
        return r ? parseFloat(r.valor) : 700;
      } catch (e) { return 700; }
    })();

    const qtd_especiais = (() => {
      try {
        const r = Banco.queryUnica(`SELECT COUNT(*) AS n FROM periodos_cadastro_valor`);
        return r?.n || 0;
      } catch (e) { return 0; }
    })();

    return `
      <div class="per-snapshots">
        <div class="per-snapshots-header">
          <span>📂 SNAPSHOTS IMPORTADOS</span>
          <span class="per-snapshots-sub">
            Padrão: <strong class="mono">R$ ${fmt(valor_padrao, 2)}</strong>
            · <strong class="mono">${qtd_especiais}</strong> valores especiais cadastrados
          </span>
        </div>

        <div class="per-snapshots-grid">
          ${snapshots.map(s => `
            <div class="per-snap-card">
              <div class="per-snap-cabec">
                <span class="per-snap-mes">${formatarMesLabel(s.mes_ref)}</span>
                <button class="per-snap-acao" data-acao="excluir-snap" data-mes="${s.mes_ref}" title="Excluir importação deste mês">🗑</button>
              </div>
              <div class="per-snap-detalhe">
                <div><strong data-ocultavel>${s.linhas}</strong> linhas · <strong data-ocultavel>${s.medicos}</strong> méd. · <strong data-ocultavel>${s.unidades}</strong> und.</div>
                <div><span data-ocultavel>${fmt(s.total_periodos)}</span> períodos · <strong data-ocultavel>R$ ${fmt(s.total_valor, 2)}</strong></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Popover Mostrar/Ocultar Colunas
  // ──────────────────────────────────────────────────────────────────────
  function renderPopoverOcultar(cfgCols) {
    return `
      <div class="per-popover">
        <div class="per-popover-titulo">Mostrar/Ocultar Colunas</div>
        ${cfgCols.map(c => `
          <label class="per-popover-item">
            <input type="checkbox" data-col="${c.id}" ${c.visivel ? 'checked' : ''} ${c.fixa ? 'disabled' : ''}>
            <span>${escapeHTML(c.label)}</span>
            ${c.fixa ? '<small style="color: var(--ink-faint); font-size: 10px">(fixa)</small>' : ''}
          </label>
        `).join('')}
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Eventos
  // ──────────────────────────────────────────────────────────────────────
  function bindEventos() {
    // fileira de filtros 20C (Ano/Mês/Unidade/Nome viraram células)
    bindBarraFiltrosPer20C();

    const btnLimpar = document.getElementById('per-limpar-filtros');
    if (btnLimpar) btnLimpar.addEventListener('click', () => {
      window.__per.filtroUnidade = '';
      window.__per.filtroNome = '';
      renderizar();
    });

    const btnOcultar = document.getElementById('btn-per-colunas');
    if (btnOcultar) btnOcultar.addEventListener('click', () => {
      window.__per.ocultarAberto = !window.__per.ocultarAberto;
      window.__per.menuVisaoAberto = false;
      renderizar();
    });

    // ⓘ Botão Info (V128.4)
    const btnPerInfo = document.getElementById('per-btn-info');
    if (btnPerInfo) btnPerInfo.addEventListener('click', () => {
      window.__per.infoAberto = !window.__per.infoAberto;
      renderizar();
    });
    const btnPerInfoClose = document.getElementById('per-info-close');
    if (btnPerInfoClose) btnPerInfoClose.addEventListener('click', () => {
      window.__per.infoAberto = false;
      renderizar();
    });

    // Botão dropdown "Visualização"
    const btnVisao = document.getElementById('btn-per-visualizacao');
    if (btnVisao) {
      btnVisao.addEventListener('click', (e) => {
        e.stopPropagation();
        window.__per.menuVisaoAberto = !window.__per.menuVisaoAberto;
        window.__per.ocultarAberto = false;
        renderizar();
      });
    }
    // Itens do menu de visualização
    document.querySelectorAll('#per-menu-visao .per-menu-item').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const modo = b.dataset.modo;
        Utilidades.setModoExibicao(modo);
        window.__per.menuVisaoAberto = false;
        renderizar();
      });
    });
    // Select de médico foco
    const focoSel = document.getElementById('per-foco-select');
    if (focoSel) {
      focoSel.addEventListener('change', (e) => {
        e.stopPropagation();
        const norm = focoSel.value;
        if (norm) {
          Utilidades.setModoExibicao('foco', norm);
        } else {
          Utilidades.setModoExibicao('tudo');
        }
        window.__per.menuVisaoAberto = false;
        renderizar();
      });
      // evita que cliques dentro do menu fechem o popover
      const menuEl = document.getElementById('per-menu-visao');
      if (menuEl) menuEl.addEventListener('click', (e) => e.stopPropagation());
    }
    // Click fora fecha menu
    if (window.__per.menuVisaoAberto) {
      const fecharFora = (e) => {
        if (!e.target.closest('#per-menu-visao') && !e.target.closest('#btn-per-visualizacao')) {
          window.__per.menuVisaoAberto = false;
          document.removeEventListener('click', fecharFora);
          renderizar();
        }
      };
      setTimeout(() => document.addEventListener('click', fecharFora), 0);
    }

    // Botão "Sair do modo foco" no banner
    const btnSairFoco = document.getElementById('btn-per-sair-foco');
    if (btnSairFoco) btnSairFoco.addEventListener('click', () => {
      Utilidades.setModoExibicao('tudo');
      renderizar();
    });

    const btnExp = document.getElementById('btn-per-exportar');
    // V860: abre o menu de extração (o leque flutuante absorve este botão do
    // cabeçalho, e o menu se ancora nele — mesmo caminho do Fellow)
    if (btnExp) btnExp.addEventListener('click', () => abrirMenuExportarPeriodos(btnExp));

    // Botão Importar (no header)
    const btnImp = document.getElementById('btn-per-importar');
    if (btnImp) btnImp.addEventListener('click', () => {
      window.ImportPeriodos.abrirModal(() => renderizar());
    });
    // Botão Importar (no estado vazio)
    const btnImpVazio = document.getElementById('btn-per-importar-vazio');
    if (btnImpVazio) btnImpVazio.addEventListener('click', () => {
      window.ImportPeriodos.abrirModal(() => renderizar());
    });

    // Botões de excluir snapshot
    document.querySelectorAll('[data-acao="excluir-snap"]').forEach(b => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const mes = b.dataset.mes;
        window.ImportPeriodos.excluirMes(mes, () => {
          // Se excluiu o mês selecionado, reseta o filtro
          const mesAtivo = `${window.__per.anoSelecionado}-${window.__per.mesSelecionado}`;
          if (mesAtivo === mes) {
            window.__per.anoSelecionado = null;
            window.__per.mesSelecionado = null;
          }
          renderizar();
        });
      });
    });

    // ───────── Popover "Mostrar/Ocultar Colunas" montado no <body> ─────────
    // (mesmo padrão V362/V363 do Produção Médica, replicado do Fellow). O popover NÃO
    // fica no #conteudo: o decorador do hub observa o #conteudo, remexe no DOM ao remontar
    // o globo e "soltava"/removia o popover — por isso sumia ao clicar num checkbox.
    // Montado direto no <body> (fora do alcance do decorador), position:fixed, colado
    // embaixo do botão COLUNAS (item do leque) que o abriu.

    // (1) Captura, em CAPTURE-PHASE, o rect do COLUNAS REALMENTE clicado (e.isTrusted)
    //     — inclusive o item do leque do globo (.hub-it, que some ao fechar o radial).
    if (!window.__perColAnchorCap) {
      window.__perColAnchorCap = true;
      document.addEventListener('click', (e) => {
        if (!e.isTrusted) return;
        let a = e.target.closest('#btn-per-colunas');
        if (!a) {
          const it = e.target.closest('.hub-it');
          if (it && (it.textContent || '').toLowerCase().includes('coluna')) a = it;
        }
        if (!a) return;
        const r = a.getBoundingClientRect();
        if (r.width) window.__perColAnchor = { left: r.left, bottom: r.bottom };
      }, true);
    }
    // (2) Fecha o popover ao clicar FORA dele (clicar DENTRO — num checkbox — não fecha).
    if (!window.__perColFechaFora) {
      window.__perColFechaFora = true;
      document.addEventListener('click', (e) => {
        if (!window.__per || !window.__per.ocultarAberto) return;
        if (e.target.closest('#per-pop-colunas') || e.target.closest('#btn-per-colunas')
            || e.target.closest('.hub-it') || e.target.closest('#atlas-hub')) return;
        window.__per.ocultarAberto = false;
        const fl = document.getElementById('per-pop-colunas'); if (fl) fl.remove();
        renderizar();
      });
    }
    // (3) Posiciona o popover (FIXED) colado embaixo do COLUNAS, com clamp na viewport.
    function posicionarColPop() {
      const pop = document.getElementById('per-pop-colunas');
      if (!pop) return;
      let a = window.__perColAnchor;
      if (!a) {
        const hub = document.getElementById('atlas-hub');
        if (hub) { const r = hub.getBoundingClientRect(); a = { left: r.left, bottom: r.bottom }; }
      }
      if (!a) a = { left: window.innerWidth - 240, bottom: 80 };
      let left = a.left;
      const maxLeft = window.innerWidth - pop.offsetWidth - 8;
      if (left > maxLeft) left = Math.max(8, maxLeft);
      let top = a.bottom + 6;
      const maxTop = window.innerHeight - pop.offsetHeight - 8;
      if (top > maxTop) top = Math.max(8, maxTop);
      pop.style.left  = left + 'px';
      pop.style.top   = top + 'px';
      pop.style.right = 'auto';
    }
    // (4) Monta/remonta o popover no <body> e binda os checkboxes nele.
    function montarColPopFlutuante() {
      const old = document.getElementById('per-pop-colunas');
      if (old) old.remove();
      if (!window.__per.ocultarAberto) return;
      const cfgC = window.__per.configColunas || carregarConfigColunas();
      const tmp = document.createElement('div');
      tmp.innerHTML = renderPopoverOcultar(cfgC);
      const pop = tmp.firstElementChild;
      if (!pop) return;
      pop.id = 'per-pop-colunas';
      pop.style.position = 'fixed';
      pop.style.zIndex = '9999';
      document.body.appendChild(pop);
      posicionarColPop();
      pop.querySelectorAll('.per-popover-item input').forEach(cb => {
        cb.addEventListener('change', () => {
          const colId = cb.dataset.col;
          const cfg = window.__per.configColunas;
          const col = cfg.find(c => c.id === colId);
          if (col) {
            col.visivel = cb.checked;
            salvarConfigColunas(cfg);
            renderizar();   // re-renderiza a tabela; montarColPopFlutuante re-cria o popover (segue aberto)
          }
        });
      });
    }
    if (!window.__perColRepos) {
      window.__perColRepos = true;
      // V492: listeners globais permanentes — só reposiciona quando a tela Períodos
      // está ativa E o popover de colunas está aberto/montado (senão retorna sem ler layout)
      const reposicionarSeAtivo = () => {
        if (App.telaAtual !== 'desempenho-periodos') return;
        if (!window.__per || !window.__per.ocultarAberto) return;
        if (!document.getElementById('per-pop-colunas')) return;
        posicionarColPop();
      };
      window.addEventListener('scroll', reposicionarSeAtivo, true);
      window.addEventListener('resize', reposicionarSeAtivo);
    }
    montarColPopFlutuante();

    // Colapsar/expandir unidade (clique no header do grupo)
    document.querySelectorAll('.per-grupo-header').forEach(tr => {
      tr.addEventListener('click', () => {
        const unidade = tr.dataset.unidade;
        if (!unidade) return;
        if (window.__per.unidadesColapsadas.has(unidade)) {
          window.__per.unidadesColapsadas.delete(unidade);
        } else {
          window.__per.unidadesColapsadas.add(unidade);
        }
        renderizar();
      });
    });

    // Adicionar médico a uma unidade (botão ➕ médico no header do grupo)
    document.querySelectorAll('[data-add-unidade]').forEach(b => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();   // não colapsa o grupo
        abrirModalEdicao(null, b.dataset.addUnidade || '');
      });
    });

    // Excluir unidade INTEIRA (lançamentos de todos os meses + tira da lista; mantém a linha no cadastro)
    document.querySelectorAll('[data-del-unidade]').forEach(b => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();   // não colapsa o grupo
        const unidade = b.dataset.delUnidade || '';
        if (!unidade) return;
        const info = Banco.queryUnica(
          `SELECT COUNT(*) AS n, COUNT(DISTINCT mes_ref) AS meses, COALESCE(SUM(total_valor), 0) AS total
             FROM periodos_linhas WHERE unidade = ?`, [unidade]
        ) || { n: 0, meses: 0, total: 0 };
        if (!confirm(
          `Excluir a unidade "${unidade}" da lista?\n\n` +
          (info.n > 0
            ? `Vai apagar ${info.n} lançamento(s) em ${info.meses} mês(es) · R$ ${fmt(info.total, 2)}.\n\n`
            : `(Esta unidade não tem lançamentos — só está no cadastro.)\n\n`) +
          `A unidade é mantida no cadastro: se subir de novo numa importação, ela reaparece. Esta ação não pode ser desfeita.`
        )) return;

        // 1) apaga os lançamentos de TODOS os meses
        const d1 = Banco.db.prepare(`DELETE FROM periodos_linhas WHERE unidade = ?`);
        try { d1.run([unidade]); } finally { d1.free(); }
        // 2) desativa no cadastro pra sumir da lista (a linha do cadastro é preservada, ativo = 0)
        const d2 = Banco.db.prepare(`UPDATE unidades SET ativo = 0 WHERE nome = ?`);
        try { d2.run([unidade]); } finally { d2.free(); }
        Banco.salvar().then(() => {
          Utilidades.toast(`Unidade "${unidade}" removida da lista`, 'success');
          renderizar();
        });
      });
    });

    // Editar linha
    document.querySelectorAll('[data-acao="editar"]').forEach(b => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = parseInt(b.dataset.id, 10);
        abrirModalEdicao(id);
      });
    });

    // Excluir linha (com confirmação)
    document.querySelectorAll('[data-acao="excluir"]').forEach(b => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = parseInt(b.dataset.id, 10);
        const linha = Banco.queryUnica(
          `SELECT nome_original, unidade FROM periodos_linhas WHERE id = ?`, [id]
        );
        if (!linha) return;
        if (!confirm(`Excluir a linha de ${linha.nome_original} em ${linha.unidade}?`)) return;

        const stmt = Banco.db.prepare(`DELETE FROM periodos_linhas WHERE id = ?`);
        try { stmt.run([id]); } finally { stmt.free(); }
        Banco.salvar().then(() => {
          Utilidades.toast('Linha excluída', 'success');
          renderizar();
        });
      });
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Modal de Edição
  // ──────────────────────────────────────────────────────────────────────
  function abrirModalEdicao(id, unidadePre) {
    const ehNovo = (id == null);
    let linha;
    if (ehNovo) {
      const mesRef = (window.__per.anoSelecionado && window.__per.mesSelecionado)
        ? `${window.__per.anoSelecionado}-${window.__per.mesSelecionado}` : null;
      if (!mesRef) { Utilidades.toast('Selecione um mês primeiro', 'error'); return; }
      linha = {
        id: null, mes_ref: mesRef, nome_original: '', unidade: unidadePre || '',
        unidade_id: null, valor_periodo: 0, sem1: 0, sem2: 0, sem3: 0, sem4: 0, sem5: 0,
      };
    } else {
      linha = Banco.queryUnica(`
        SELECT id, mes_ref, nome_original, unidade, unidade_id, valor_periodo,
               sem1, sem2, sem3, sem4, sem5
        FROM periodos_linhas WHERE id = ?
      `, [id]);
      if (!linha) {
        Utilidades.toast('Linha não encontrada', 'error');
        return;
      }
    }

    // Carrega lista de unidades cadastradas
    let unidadesCadastradas = [];
    try {
      unidadesCadastradas = Banco.query(`SELECT id, nome FROM unidades WHERE ativo = 1 ORDER BY nome`);
    } catch (e) { /* */ }

    const optionsUnidades = unidadesCadastradas.map(u =>
      `<option value="${escapeAttr(u.nome)}" data-id="${u.id}" ${u.nome === linha.unidade ? 'selected' : ''}>${escapeHTML(u.nome)}</option>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'per-edit-modal-overlay';
    overlay.innerHTML = `
      <div class="per-edit-modal">
        <div class="per-edit-header">
          <span>${ehNovo ? '➕ Adicionar Médico' : '✏ Editar Linha'} · ${formatarMesLabel(linha.mes_ref)}</span>
          <button class="per-edit-fechar" type="button">✕</button>
        </div>
        <div class="per-edit-body">
          <div class="per-edit-form">
            <div class="per-edit-campo">
              <label>Médico</label>
              <input type="text" id="per-edit-medico" value="${escapeAttr(linha.nome_original)}">
            </div>
            <div class="per-edit-campo">
              <label>Unidade</label>
              <select id="per-edit-unidade">${optionsUnidades}</select>
            </div>
            <div class="per-edit-campo">
              <label>Valor por Período (R$)</label>
              <input type="number" id="per-edit-valor" value="${linha.valor_periodo}" step="0.01" min="0">
            </div>
            <div class="per-edit-semanas-grupo">
              <label>Períodos por Semana</label>
              <div class="per-edit-semanas">
                <div><span class="per-edit-sem-label">S1</span><input type="number" id="per-edit-s1" value="${linha.sem1 || 0}" min="0" max="7"></div>
                <div><span class="per-edit-sem-label">S2</span><input type="number" id="per-edit-s2" value="${linha.sem2 || 0}" min="0" max="7"></div>
                <div><span class="per-edit-sem-label">S3</span><input type="number" id="per-edit-s3" value="${linha.sem3 || 0}" min="0" max="7"></div>
                <div><span class="per-edit-sem-label">S4</span><input type="number" id="per-edit-s4" value="${linha.sem4 || 0}" min="0" max="7"></div>
                <div><span class="per-edit-sem-label">S5</span><input type="number" id="per-edit-s5" value="${linha.sem5 || 0}" min="0" max="7"></div>
              </div>
            </div>
            <div class="per-edit-preview" id="per-edit-preview">
              <div class="per-edit-preview-label">Total calculado</div>
              <div class="per-edit-preview-valor">
                <strong id="per-edit-tot-per">0</strong> períodos ·
                <strong id="per-edit-tot-val">R$ 0,00</strong>
              </div>
            </div>
          </div>
        </div>
        <div class="per-edit-footer">
          <button class="btn" id="per-edit-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="per-edit-salvar">${ehNovo ? '✓ Adicionar' : '✓ Salvar Alterações'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Atualiza preview ao mudar inputs
    function atualizarPreview() {
      const s1 = parseInt(document.getElementById('per-edit-s1').value) || 0;
      const s2 = parseInt(document.getElementById('per-edit-s2').value) || 0;
      const s3 = parseInt(document.getElementById('per-edit-s3').value) || 0;
      const s4 = parseInt(document.getElementById('per-edit-s4').value) || 0;
      const s5 = parseInt(document.getElementById('per-edit-s5').value) || 0;
      const valor = parseFloat(document.getElementById('per-edit-valor').value) || 0;
      const totPer = s1 + s2 + s3 + s4 + s5;
      const totVal = totPer * valor;
      document.getElementById('per-edit-tot-per').textContent = totPer;
      document.getElementById('per-edit-tot-val').textContent = `R$ ${fmt(totVal, 2)}`;
    }
    overlay.querySelectorAll('input[type="number"]').forEach(i => i.addEventListener('input', atualizarPreview));
    atualizarPreview();

    const fechar = () => overlay.remove();
    overlay.querySelector('.per-edit-fechar').addEventListener('click', fechar);
    overlay.querySelector('#per-edit-cancelar').addEventListener('click', fechar);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });

    overlay.querySelector('#per-edit-salvar').addEventListener('click', async () => {
      const novoMedico = document.getElementById('per-edit-medico').value.trim();
      const selUnid = document.getElementById('per-edit-unidade');
      const novaUnidade = selUnid.value;
      const novaUnidadeId = parseInt(selUnid.options[selUnid.selectedIndex].dataset.id, 10) || null;
      const novoValor = parseFloat(document.getElementById('per-edit-valor').value) || 0;
      const s1 = parseInt(document.getElementById('per-edit-s1').value) || 0;
      const s2 = parseInt(document.getElementById('per-edit-s2').value) || 0;
      const s3 = parseInt(document.getElementById('per-edit-s3').value) || 0;
      const s4 = parseInt(document.getElementById('per-edit-s4').value) || 0;
      const s5 = parseInt(document.getElementById('per-edit-s5').value) || 0;

      if (!novoMedico) { Utilidades.toast('Médico é obrigatório', 'error'); return; }
      if (!novaUnidade) { Utilidades.toast('Unidade é obrigatória', 'error'); return; }

      const totalPer = s1 + s2 + s3 + s4 + s5;
      const totalVal = totalPer * novoValor;
      const nomeNorm = (novoMedico || '').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

      try {
        if (ehNovo) {
          const stmt = Banco.db.prepare(`
            INSERT INTO periodos_linhas
              (mes_ref, nome_original, nome_normalizado, unidade, unidade_id,
               valor_periodo, sem1, sem2, sem3, sem4, sem5,
               total_periodos, total_valor, origem)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
          `);
          try {
            stmt.run([
              linha.mes_ref, novoMedico, nomeNorm, novaUnidade, novaUnidadeId,
              novoValor, s1, s2, s3, s4, s5,
              totalPer, totalVal,
            ]);
          } finally { stmt.free(); }
        } else {
          const stmt = Banco.db.prepare(`
            UPDATE periodos_linhas SET
              nome_original = ?, nome_normalizado = ?,
              unidade = ?, unidade_id = ?, valor_periodo = ?,
              sem1 = ?, sem2 = ?, sem3 = ?, sem4 = ?, sem5 = ?,
              total_periodos = ?, total_valor = ?
            WHERE id = ?
          `);
          try {
            stmt.run([
              novoMedico, nomeNorm,
              novaUnidade, novaUnidadeId, novoValor,
              s1, s2, s3, s4, s5,
              totalPer, totalVal,
              id,
            ]);
          } finally { stmt.free(); }
        }
        await Banco.salvar();
        Utilidades.toast(ehNovo ? '✓ Médico adicionado' : '✓ Linha atualizada', 'success');
        fechar();
        renderizar();
      } catch (e) {
        console.error(e);
        // Provável violação de UNIQUE(mes_ref, nome_normalizado, unidade)
        if (String(e).includes('UNIQUE')) {
          alert('❌ Já existe uma linha com esse Médico+Unidade neste mês.');
        } else {
          alert(`❌ Erro ao salvar:\n\n${e.message}`);
        }
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Exportar Excel
  // ──────────────────────────────────────────────────────────────────────
  /**
   * V860: extração no PADRÃO DO FELLOW — menu no botão flutuante com dois
   * relatórios (Sintética / Analítica), diálogo de separação em abas e saída
   * ESTILIZADA via ExcelJS (cabeçalho #46688c, subtotais em negrito, moeda).
   * A lib XLSX vendorizada é SheetJS CE e não grava negrito/fundo — por isso a
   * ExcelJS, exatamente como o Fellow faz desde a V735.
   *
   * A individualidade do ficheiro é respeitada: aqui o agrupamento natural é a
   * UNIDADE (é como a tela mostra), as colunas são as de períodos (S1…S5) e a
   * separação em abas oferece Unidade, Médico e Competência.
   */
  const _PER_FMT_MOEDA = '"R$" #,##0.00';
  const _PER_HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF107DAC' } };
  const _PER_HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
  // nome real SEMPRE no export (CodigoMedico.exibir é só de tela — ver codigo_medico.js)
  const _PER_COLS = [
    { id: 'medico',    label: 'Médico',        largura: 32 },
    { id: 'unidade',   label: 'Unidade',       largura: 24 },
    { id: 'valor_per', label: 'Valor/Período', largura: 14, moeda: true },
    { id: 'sem1',      label: 'S1',            largura: 6 },
    { id: 'sem2',      label: 'S2',            largura: 6 },
    { id: 'sem3',      label: 'S3',            largura: 6 },
    { id: 'sem4',      label: 'S4',            largura: 6 },
    { id: 'sem5',      label: 'S5',            largura: 6 },
    { id: 'periodos',  label: 'Períodos',      largura: 10 },
    { id: 'total',     label: 'Total R$',      largura: 14, moeda: true },
  ];

  function _perNomeAba(nome) {
    return String(nome).replace(/[\\\/\?\*\[\]:]/g, '-').slice(0, 31) || 'Períodos';
  }
  function _perFiltrosAtuais() {
    return { unidade: window.__per.filtroUnidade, nome: window.__per.filtroNome };
  }
  function _perMesRef() {
    const st = window.__per;
    return (st.anoSelecionado && st.mesSelecionado) ? `${st.anoSelecionado}-${st.mesSelecionado}` : null;
  }
  function _perCel(c, l) {
    if (c.id === 'medico')    return l.nome_original;
    if (c.id === 'unidade')   return l.unidade;
    if (c.id === 'valor_per') return Number(l.valor_periodo) || 0;
    if (c.id === 'sem1')      return Number(l.sem1) || 0;
    if (c.id === 'sem2')      return Number(l.sem2) || 0;
    if (c.id === 'sem3')      return Number(l.sem3) || 0;
    if (c.id === 'sem4')      return Number(l.sem4) || 0;
    if (c.id === 'sem5')      return Number(l.sem5) || 0;
    if (c.id === 'periodos')  return Number(l.total_periodos) || 0;
    if (c.id === 'total')     return Number(l.total_valor) || 0;
    return '';
  }

  /** Estrutura da matriz aberta (unidade → médicos → subtotal, Total geral). */
  function _perMatrizAoA(linhas, tituloTotal) {
    const cols = _PER_COLS;
    const rows = [cols.map(c => c.label)];
    const porUnidade = new Map();
    for (const l of linhas) {
      const u = l.unidade || '(sem unidade)';
      if (!porUnidade.has(u)) porUnidade.set(u, []);
      porUnidade.get(u).push(l);
    }
    const soma = (ls, f) => ls.reduce((s, l) => s + (Number(f(l)) || 0), 0);
    const agregada = (rotulo, ls) => cols.map(c => {
      if (c.id === 'medico')   return rotulo;
      if (c.id === 'sem1')     return soma(ls, l => l.sem1);
      if (c.id === 'sem2')     return soma(ls, l => l.sem2);
      if (c.id === 'sem3')     return soma(ls, l => l.sem3);
      if (c.id === 'sem4')     return soma(ls, l => l.sem4);
      if (c.id === 'sem5')     return soma(ls, l => l.sem5);
      if (c.id === 'periodos') return soma(ls, l => l.total_periodos);
      if (c.id === 'total')    return soma(ls, l => l.total_valor);
      return '';
    });
    for (const [unidade, ls] of porUnidade.entries()) {
      const nMed = new Set(ls.map(l => l.nome_normalizado)).size;
      const cab = cols.map(() => '');
      cab[0] = `▼ ${unidade} — ${nMed} médico${nMed !== 1 ? 's' : ''}`;
      rows.push(cab);
      ls.forEach(l => rows.push(cols.map(c => _perCel(c, l))));
      rows.push(agregada('↳ Subtotal', ls));
    }
    rows.push(agregada(tituloTotal || 'TOTAL GERAL', linhas));
    return rows;
  }

  /** Subconjuntos conforme a separação escolhida (uma aba cada). */
  function _perSubconjuntos(split, filtros) {
    if (split === 'competencia') {
      const meses = (Banco.query(`SELECT DISTINCT mes_ref FROM periodos_linhas ORDER BY mes_ref`) || [])
        .map(r => r.mes_ref);
      const subs = [];
      for (const m of meses) {
        const ls = carregarLinhas(m, filtros);
        if (ls.length) subs.push({ aba: formatarMesLabel(m).replace('/', '-'), linhas: ls, tituloTotal: `TOTAL ${formatarMesLabel(m)}` });
      }
      return subs;
    }
    const mes_ref = _perMesRef();
    if (!mes_ref) { Utilidades.toast('Selecione um mês primeiro', 'warning'); return null; }
    const linhas = carregarLinhas(mes_ref, filtros);
    if (!linhas.length) return [];
    if (split === 'unidade') {
      return [...new Set(linhas.map(l => l.unidade || '(sem unidade)'))]
        .map(u => ({ aba: u, linhas: linhas.filter(l => (l.unidade || '(sem unidade)') === u), tituloTotal: `TOTAL ${u}` }));
    }
    if (split === 'medico') {
      return [...new Set(linhas.map(l => l.nome_original))]
        .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'))
        .map(n => ({ aba: n, linhas: linhas.filter(l => l.nome_original === n), tituloTotal: `TOTAL ${n}` }));
    }
    return [{ aba: `Períodos ${formatarMesLabel(mes_ref)}`, linhas, tituloTotal: `TOTAL / ${formatarMesLabel(mes_ref)}` }];
  }

  function _perBaixarBuffer(buffer, nomeArquivo) {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArquivo;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function _perPintarCabecalho(ws) {
    const h = ws.getRow(1);
    h.height = 22;
    h.eachCell({ includeEmpty: true }, (c) => {
      c.font = { ..._PER_HEADER_FONT };
      c.fill = { ..._PER_HEADER_FILL };
      c.alignment = { vertical: 'middle' };
    });
  }

  /** Sintética: grupos por unidade + subtotais + Total geral. */
  async function exportarSinteticaPeriodos(subs, nomeArquivo) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ATLAS — Repasse Médico';
    wb.created = new Date();
    for (const sub of subs) {
      const ws = wb.addWorksheet(_perNomeAba(sub.aba), { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = _PER_COLS.map(c => ({
        width: c.largura,
        style: c.moeda ? { numFmt: _PER_FMT_MOEDA } : {},
      }));
      _perMatrizAoA(sub.linhas, sub.tituloTotal).forEach((r, i) => {
        const row = ws.addRow(r);
        if (i === 0) return;
        const rotulo = String(r[0] == null ? '' : r[0]);
        if (rotulo.includes('Subtotal') || /^TOTAL/.test(rotulo) || rotulo.startsWith('▼')) {
          row.font = { bold: true };
        }
      });
      _perPintarCabecalho(ws);
    }
    _perBaixarBuffer(await wb.xlsx.writeBuffer(), nomeArquivo);
  }

  /** Analítica: 1 linha por médico/unidade, pronta para tabela dinâmica. */
  async function exportarAnaliticaPeriodos(subs, nomeArquivo) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ATLAS — Repasse Médico';
    wb.created = new Date();
    for (const sub of subs) {
      const ws = wb.addWorksheet(_perNomeAba(sub.aba), { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = _PER_COLS.map(c => ({
        header: c.label, key: c.id, width: c.largura,
        style: c.moeda ? { numFmt: _PER_FMT_MOEDA } : {},
      }));
      _perPintarCabecalho(ws);
      for (const l of sub.linhas) {
        const obj = {};
        _PER_COLS.forEach(c => { obj[c.id] = _perCel(c, l); });
        ws.addRow(obj);
      }
    }
    _perBaixarBuffer(await wb.xlsx.writeBuffer(), nomeArquivo);
  }

  function exportarExcelPeriodos(tipo, split = 'none') {
    if (typeof ExcelJS === 'undefined') {
      Utilidades.toast('Biblioteca ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return;
    }
    const subs = _perSubconjuntos(split, _perFiltrosAtuais());
    if (subs === null) return;                     // sem mês (toast já saiu)
    if (!subs.length) { Utilidades.toast('Nada para exportar', 'warning'); return; }

    const base = tipo === 'analitica' ? 'Periodos_analitica' : 'Periodos';
    const mes_ref = _perMesRef();
    const sufMes = mes_ref ? formatarMesLabel(mes_ref).replace('/', '_') : '';
    const nomeArquivo =
      split === 'competencia' ? `${base}_por_competencia.xlsx`
      : split === 'unidade'   ? `${base}_por_unidade_${sufMes}.xlsx`
      : split === 'medico'    ? `${base}_por_medico_${sufMes}.xlsx`
      :                         `${base}_${sufMes}.xlsx`;

    const promessa = tipo === 'analitica'
      ? exportarAnaliticaPeriodos(subs, nomeArquivo)
      : exportarSinteticaPeriodos(subs, nomeArquivo);
    promessa
      .then(() => Utilidades.toast(subs.length > 1 ? `✓ Exportado (${subs.length} abas)` : '✓ Exportado', 'success'))
      .catch((e) => { console.error(e); Utilidades.toast('Falha ao exportar: ' + e.message, 'error', 4500); });
  }

  /** Menu do botão flutuante (o leque absorve o botão do cabeçalho). */
  function abrirMenuExportarPeriodos(btn) {
    const mes_ref = _perMesRef();
    const mesLabel = mes_ref ? formatarMesLabel(mes_ref) : 'Selecione um mês';
    Utilidades.abrirMenuExportar(btn, [
      { icone: '⊞', titulo: 'Matriz Sintética', sub: `Grupos por unidade + subtotais + Total geral · ${mesLabel}`,
        onClick: () => abrirOpcoesExtracaoPeriodos('matriz') },
      { icone: '≣', titulo: 'Matriz Analítica', sub: `Flat: 1 linha por médico/unidade, pronta p/ tabela dinâmica · ${mesLabel}`,
        onClick: () => abrirOpcoesExtracaoPeriodos('analitica') },
    ]);
  }

  /** Diálogo de OPÇÕES da extração (vale para os dois relatórios). */
  function abrirOpcoesExtracaoPeriodos(tipo) {
    document.getElementById('per-ext-pop')?.remove();
    const nomeTipo = tipo === 'analitica' ? 'Matriz Analítica' : 'Matriz Sintética';
    const pop = document.createElement('div');
    pop.id = 'per-ext-pop';
    pop.className = 'per-edit-modal-overlay';
    pop.innerHTML = `
      <div class="per-ext-box" role="dialog" aria-modal="true">
        <h4>📥 ${nomeTipo} — opções</h4>
        <p>Como você quer separar o relatório? (as opções valem como filtros de agrupamento em abas)</p>
        ${[
          ['none', 'Tudo junto', 'Uma aba única com o mês selecionado'],
          ['unidade', 'Por Unidade', 'Uma aba por unidade de atendimento'],
          ['medico', 'Por Médico', 'Uma aba por médico'],
          ['competencia', 'Por Competência', 'Uma aba por mês com dados'],
        ].map(([v, t, s], i) => `
          <label class="per-ext-op">
            <input type="radio" name="per-ext-split" value="${v}" ${i === 0 ? 'checked' : ''}>
            <span><strong>${t}</strong><small>${s}</small></span>
          </label>`).join('')}
        <div class="per-ext-acoes">
          <span style="flex:1"></span>
          <button class="btn btn-secondary" id="per-ext-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="per-ext-gerar">Gerar</button>
        </div>
      </div>`;
    document.body.appendChild(pop);
    const fechar = () => pop.remove();
    pop.addEventListener('click', (e) => { if (e.target === pop) fechar(); });
    pop.querySelector('#per-ext-cancelar').addEventListener('click', fechar);
    pop.querySelector('#per-ext-gerar').addEventListener('click', () => {
      const split = (pop.querySelector('input[name="per-ext-split"]:checked') || {}).value || 'none';
      fechar();
      exportarExcelPeriodos(tipo, split);
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Styles
  // ──────────────────────────────────────────────────────────────────────
  // V492: retorna apenas o CSS (sem tag <style>) — injetado 1x via Utilidades.garantirEstilos
  function getStyles() {
    return `
        .per-page { padding: 16px 24px 24px; }

        /* Header */
        .per-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          padding: 8px 0 18px;
          position: relative;
          z-index: 100;            /* eleva acima dos irmãos (filtros, cards) que
                                      criam stacking context próprio via animation */
        }
        .per-header-info h1 { font-size: 26px; margin: 0; color: var(--ink); font-family: var(--serif); font-weight: 800; }
        .per-header-info p { margin: 2px 0 0; color: var(--ink-soft); font-size: 12px; }
        .per-header-acoes { display: flex; gap: 6px; align-items: center; position: relative; z-index: 500; }

        /* Botões compactos do header */
        .btn-compact {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          color: var(--ink);
          padding: 5px 10px;
          font-size: 11px;
          font-weight: 600;
          border-radius: 6px;
          cursor: pointer;
          font-family: inherit;
          line-height: 1.4;
          white-space: nowrap;
          transition: background 0.12s, border-color 0.12s;
        }
        .btn-compact:hover { background: var(--bg-sunken); border-color: var(--ink-soft); }
        .btn-compact.ativo {
          background: var(--primary);
          color: #f2f3f5;
          border-color: var(--primary);
        }
        .btn-compact-primary {
          background: var(--primary);
          color: #f2f3f5;
          border-color: var(--primary);
        }
        .btn-compact-primary:hover { background: #3a5877; border-color: #3a5877; color: #f2f3f5; }

        /* Menu de visualização (dropdown) */
        .per-menu-wrap { position: relative; z-index: 999; }
        .per-menu-visao {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 4px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.12);
          z-index: 1000;
          padding: 6px;
          min-width: 280px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .per-menu-item {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          padding: 8px 10px;
          background: none;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          text-align: left;
          font-family: inherit;
          color: var(--ink);
          width: 100%;
        }
        .per-menu-item:hover { background: var(--bg-sunken); }
        .per-menu-item.ativo {
          background: #eef2f6;
        }
        .per-menu-ico { font-size: 14px; line-height: 1.2; }
        .per-menu-txt { display: flex; flex-direction: column; gap: 2px; }
        .per-menu-txt strong { font-size: 12px; font-weight: 700; color: var(--ink); }
        .per-menu-txt small { font-size: 10px; color: var(--ink-soft); }
        .per-menu-sep { height: 1px; background: var(--border); margin: 4px 6px; }
        .per-menu-foco { padding: 6px 10px; }
        .per-menu-foco-label { display: flex; gap: 10px; align-items: center; margin-bottom: 4px; }
        .per-menu-foco-label strong { font-size: 12px; }
        .per-menu-foco-select {
          width: 100%;
          padding: 5px 8px;
          font-size: 12px;
          border: 1px solid var(--border);
          border-radius: 5px;
          background: white;
          color: var(--ink);
          font-family: inherit;
        }

        /* Linhas mascaradas (modo foco) */
        .per-linha-mascarada td { color: var(--ink-faint); opacity: 0.85; }
        .per-medico-ofuscado {
          font-style: italic;
          color: var(--ink-faint);
          letter-spacing: 0.02em;
        }
        .per-foco-banner {
          background: linear-gradient(90deg, #f2f3f5 0%, #eef2f6 100%);
          border: 1px solid #3f6489;
          border-radius: 8px;
          padding: 8px 14px;
          margin-bottom: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          font-size: 12px;
          color: #4B3814;
        }
        .per-foco-banner strong { color: #3a5877; }

        /* Filtros bar — contêiner da peça 20C (.per-sb) + botão "✕ Limpar";
           a peça é IRMÃ do header e estica de ponta a ponta */
        .per-filtros-bar {
          /* V734: z-index no WRAPPER (stacking context da animação global) —
             o painel abria atrás dos cards */
          position: relative; z-index: 30;
          background: transparent;
          border: none;
          border-radius: 0;
          padding: 0;
          margin-top: 10px;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          width: 100%;
          box-sizing: border-box;
          gap: 6px;
        }
        .per-filtros-bar > .btn { align-self: flex-start; margin-bottom: 8px; }
        .per-secao-label {
          font-size: 11px; font-weight: 700; color: var(--ink-soft);
          letter-spacing: 0.06em; text-transform: uppercase;
          white-space: nowrap;
        }

        /* ── fileira de filtros 20C (padrão do LIO/OPME, prefixo per-sb) ── */
        .per-sb {
          margin-bottom: 14px;   /* respiro antes dos cards */
          position: relative; z-index: 30;
          display: flex; align-items: stretch;
          padding: 6px;
          background: #fff;
          border: 1px solid #eef2f6;
          border-radius: 12px;
          box-shadow: 0 1px 2px rgba(89, 128, 166,.04), 0 10px 26px -20px rgba(89, 128, 166,.26);
          flex-wrap: wrap;
        }
        .per-sb-celwrap { position: relative; min-width: 150px; display: flex; }
        .per-sb-celwrap:not(:last-child) .per-sb-cel { border-right: 1px solid #f7f8fa; }
        .per-sb-cel {
          flex: 1; min-width: 0;
          display: flex; align-items: center; gap: 9px;
          padding: 9px 12px; border: none; border-radius: 9px;
          background: transparent; cursor: pointer;
          font-family: inherit; text-align: left;
          transition: background-color 120ms;
        }
        .per-sb-cel:hover, .per-sb-cel.ativo, .per-sb-cel.aberta { background: #fafbfc; }
        .per-sb-cel:focus-visible { outline: 2px solid #3f6489; outline-offset: 2px; }
        .per-sb-tile {
          width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: #f0f5f9; color: #585d62;
        }
        .per-sb-cel.ativo .per-sb-tile, .per-sb-cel.aberta .per-sb-tile { background: #eef2f6; color: #46688c; }
        .per-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
        .per-sb-rot {
          font-size: 10px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .09em; color: #585d62; white-space: nowrap;
        }
        .per-sb-val {
          font-size: 13px; font-weight: 500; color: #585d62;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .per-sb-cel.ativo .per-sb-val { font-weight: 700; color: #3a5877; }
        .per-sb-chev { color: #8a9096; flex-shrink: 0; display: flex; transition: transform 140ms; }
        .per-sb-cel.aberta .per-sb-chev { transform: rotate(180deg); }

        /* painel ancorado na célula, por cima dos cards */
        .per-sb-painel {
          position: absolute; top: 100%; left: 0; margin-top: 6px; z-index: 40;
          min-width: 100%; width: max-content; max-width: 340px;
          background: #fff; border: 1px solid #eef0f2; border-radius: 12px;
          box-shadow: 0 18px 44px -14px rgba(29, 31, 32,.42);
          overflow: hidden;
        }
        .per-sb-buscabox {
          display: flex; align-items: center; gap: 8px;
          padding: 11px 12px 10px; border-bottom: 1px solid #f7f8fa;
        }
        .per-sb-buscabox .per-sb-busca-ic { color: #6b7d8e; display: flex; }
        .per-sb-busca {
          flex: 1; height: 30px; border: 1px solid #eef0f2; border-radius: 8px;
          background: #fafbfc; padding: 0 10px; font-size: 13px;
          font-family: inherit; color: #3a5877; outline: none;
        }
        .per-sb-busca::placeholder { color: #8a9096; }
        .per-sb-busca:focus { border-color: #3f6489; }
        .per-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; }
        .per-sb-lista::-webkit-scrollbar { width: 8px; }
        .per-sb-lista::-webkit-scrollbar-track { background: #f7f8fa; }
        .per-sb-lista::-webkit-scrollbar-thumb { background: #e4eaf1; border-radius: 4px; }
        .per-sb-it {
          display: flex; align-items: center; gap: 10px;
          height: 38px; padding: 0 8px; border-radius: 8px; cursor: pointer;
          font-size: 13px; color: #3a5877;
        }
        .per-sb-it:hover, .per-sb-it.foco { background: #f7f8fa; }
        .per-sb-it.sel { background: #f7f8fa; font-weight: 700; }
        .per-sb-it-todos { font-weight: 700; }
        .per-sb-it-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .per-sb-ck { color: #46688c; display: flex; }
        .per-sb-rodape {
          padding: 7px 12px; border-top: 1px solid #f7f8fa;
          font-size: 10.5px; font-weight: 600; color: #8a9096;
        }
        @media (max-width: 1280px) { .per-sb-celwrap { flex-basis: 32%; } }
        @media (max-width: 900px)  { .per-sb-celwrap { flex-basis: 48%; } }

        /* Cards KPI */
        .per-cards-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-bottom: 14px;
        }
        @media (max-width: 1100px) { .per-cards-grid { grid-template-columns: repeat(2, 1fr); } }
        .per-card {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 12px 14px;
          position: relative;
          overflow: hidden;
        }
        .per-card-faixa { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
        .per-card-verde   { background: linear-gradient(180deg, #eef2f6 0%, #EDF5F0 100%); }
        .per-card-verde .per-card-faixa { background: #3a5877; }
        .per-card-roxo    { background: linear-gradient(180deg, #EEEAF6 0%, #F5F2FA 100%); }
        .per-card-roxo .per-card-faixa { background: #6B4587; }
        .per-card-bege    { background: linear-gradient(180deg, #F2E8D4 0%, #F8F0DD 100%); }
        .per-card-bege .per-card-faixa { background: #5980a6; }
        .per-card-destaque { background: #3a5877; color: #585d62; }
        .per-card-destaque .per-card-titulo { color: #585d62; }
        .per-card-destaque .per-card-valor { color: #5980a6; }
        .per-card-destaque .per-card-sub { color: #585d62; }

        .per-card-titulo {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #1d1f20; /* V849: título dos cards totalizadores */
          margin-bottom: 4px;
        }
        .per-card-valor { font-size: 24px; font-weight: 800; line-height: 1.1; color: var(--primary); }
        .per-card-breakdown { margin-top: 6px; font-size: 11px; color: var(--ink-soft); line-height: 1.5; }
        .per-bd-item strong { color: var(--ink); font-variant-numeric: tabular-nums; }
        .per-card-sub { font-size: 11px; color: var(--ink-soft); margin-top: 4px; }
        .per-card-sub strong { color: var(--ink); }
        .per-card-comp { font-size: 10px; color: var(--ink-faint); margin-top: 6px; display: flex; gap: 12px; }
        .per-comp-pos { color: var(--success, #1d9e75); font-weight: 600; }
        .per-comp-neg { color: var(--danger, #993556); font-weight: 600; }
        .per-comp-vazio { color: var(--ink-faint); }

        /* Tabela */
        /* V861: o cartão vira a área de rolagem da matriz — é o que permite
           congelar o título das colunas (position: sticky precisa de um
           container que role de verdade; com overflow hidden ele nunca
           gruda). A altura máxima acompanha a janela e some quando a lista é
           curta, então nada muda para quem tem poucas unidades. */
        .per-tabela-card {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: auto;
          max-height: min(64vh, 760px);
        }
        .per-tabela { width: 100%; border-collapse: collapse; font-size: 12px; }
        .per-tabela thead { background: var(--bg-sunken); }
        .per-tabela thead th { position: sticky; top: 0; z-index: 3; background: var(--bg-sunken); }
        .per-tabela th {
          padding: 8px 10px;
          text-align: left;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--ink-soft);
          border-bottom: 1px solid var(--border);
        }
        .per-tabela th.num { text-align: right; }
        .per-tabela td { padding: 6px 10px; border-bottom: 1px solid var(--border); }
        .per-tabela td.num { text-align: right; }
        .per-tabela tbody tr:hover { background: var(--bg-sunken); }

        /* V863: a faixa da unidade é feita de CÉLULAS, uma por coluna — cada
           número nasce alinhado com a coluna dele. O recuo é o mesmo das
           células normais (6px 10px), então nada desloca. */
        .per-grupo-header td {
          background: #f7f8fa;   /* V863 (era #8FABC4) */
          font-weight: 700;
          color: #1d1f20;
          font-size: 11px;
          letter-spacing: 0.04em;
          padding: 5px 10px;
          border-bottom: 1px solid #C7DEEE;
        }
        .per-grupo-header .per-grupo-nome { text-transform: uppercase; }
        .per-grupo-icone { margin-right: 4px; }
        /* contagem de médicos: acompanha o nome, em tom mais leve */
        .per-grupo-med {
          margin-left: 8px; font-weight: 500; font-size: 10px;
          text-transform: none; letter-spacing: 0; color: #47606F;
        }
        .per-grupo-med span {
          font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 700;
        }
        .per-grupo-header .per-grupo-num {
          font-family: var(--font-mono); font-variant-numeric: tabular-nums;
          font-weight: 700; font-size: 11.5px; letter-spacing: 0;
        }
        /* as ações na coluna própria, DEPOIS do valor consolidado */
        .per-grupo-header .per-grupo-acoes { white-space: nowrap; text-align: center; padding: 3px 8px; }

        /* V861/V863: glifo #B8965A sobre pastilha #1d1f20. O dourado direto na
           faixa não se sustenta em contraste (1,16:1 no azul antigo, 2,49:1 no
           claro de agora); sobre o marinho ele vai a 5,5:1. Botões menores
           (18px) para caberem na coluna de ações sem alargá-la. */
        /* V950: pastilha #0B1D33 (marinho do menu) com o glifo BRANCO. Medidas
           pares (20px de círculo, 12px de glifo → 4px de folga de cada lado):
           com 18/11 sobrava 3,5px por lado e o arredondamento de subpixel
           jogava a figura para um dos cantos. line-height 0 tira a caixa de
           texto do botão, que também deslocava o SVG para baixo. */
        .per-grupo-ico {
          width: 20px; height: 20px; flex: none; padding: 0; margin: 0;
          border: none; border-radius: 50%; cursor: pointer; line-height: 0;
          display: inline-flex; align-items: center; justify-content: center;
          vertical-align: middle; box-sizing: border-box;
          background: #0B1D33; color: #FFFFFF;
          transition: background 0.12s ease, color 0.12s ease;
        }
        .per-grupo-ico + .per-grupo-ico { margin-left: 4px; }
        .per-grupo-ico svg { width: 12px; height: 12px; display: block; flex: none; overflow: visible; }
        .per-grupo-add:hover { background: #13304D; }
        .per-grupo-del:hover { background: #7A2B22; color: #FFFFFF; }
        .per-grupo-ico:focus-visible { outline: 2px solid #0B1D33; outline-offset: 2px; }

        /* Popover */
        .per-popover {
          position: absolute;
          right: 24px; top: 70px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px;
          z-index: 100;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          min-width: 180px;
        }
        .per-popover-titulo { font-size: 11px; font-weight: 700; color: var(--ink-soft); padding: 4px 8px 8px; text-transform: uppercase; letter-spacing: 0.06em; }
        .per-popover-item { display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 12px; cursor: pointer; }
        .per-popover-item:hover { background: var(--bg-sunken); border-radius: 4px; }

        /* Snapshots importados */
        .per-snapshots {
          margin-top: 16px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 12px 16px;
        }
        .per-snapshots-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
          font-size: 11px;
          font-weight: 700;
          color: var(--ink-soft);
          letter-spacing: 0.06em;
        }
        .per-snapshots-sub {
          font-weight: 400;
          letter-spacing: 0;
          text-transform: none;
        }
        .per-snapshots-sub strong { color: var(--primary); }
        .per-snapshots-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 8px;
        }
        .per-snap-card {
          background: var(--bg-sunken);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 10px 12px;
        }
        .per-snap-cabec {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }
        .per-snap-mes { font-weight: 700; color: var(--primary); font-size: 13px; }
        .per-snap-acao {
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 12px;
          color: var(--ink-soft);
          padding: 2px 6px;
          border-radius: 4px;
        }
        .per-snap-acao:hover { background: var(--bg-elevated); color: var(--danger, #993556); }
        .per-snap-detalhe { font-size: 11px; color: var(--ink-soft); line-height: 1.6; }
        .per-snap-detalhe strong { color: var(--ink); font-variant-numeric: tabular-nums; }

        /* Grupo header clicável (colapsar) */
        .per-grupo-header { cursor: pointer; user-select: none; }
        /* V920: SEM efeito de hover na linha da UNIDADE (ficava verde) — a
           faixa mantém o azul fixo; as linhas de drill down continuam com o
           hover normal da tabela (pedido do usuário) */
        .per-tabela tbody tr.per-grupo-header:hover { background: transparent; }
        .per-grupo-header:hover td { background: #f7f8fa; }
        .per-grupo-icone {
          margin-right: 6px;
          display: inline-block;
          width: 14px;
          font-size: 10px;
          transition: transform 0.15s;
        }

        /* Coluna de ações */
        .per-acoes-col { width: 70px; }
        .per-acoes-cell { white-space: nowrap; text-align: center; padding: 4px 8px !important; }
        .per-btn-acao {
          border: none;
          background: transparent;
          cursor: pointer;
          padding: 4px 6px;
          border-radius: 4px;
          font-size: 13px;
          color: var(--ink-soft);
          margin: 0 1px;
        }
        .per-btn-acao:hover { background: var(--bg-sunken); color: var(--primary); }
        .per-btn-danger:hover { background: #FCEBEB; color: var(--danger, #993556); }

        /* Botão "+" para adicionar médico (discreto, no header do grupo) */
        /* V861: os antigos .per-grupo-add / .per-grupo-del (float: right,
           fundo transparente, opacidade 0,5) saíram daqui — vinham DEPOIS da
           regra nova no arquivo e a anulavam. O desenho dos dois botões agora
           está em .per-grupo-ico, junto do resto da faixa. */

        /* Modal de edição */
        .per-edit-modal-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
          z-index: 9999;
        }

        /* V860: diálogo de opções da extração (mesmo desenho do Fellow) */
        .per-ext-box {
          background: var(--bg-elevated, #fff); border-radius: 12px; padding: 20px;
          width: 380px; max-width: calc(100vw - 32px); max-height: 84vh; overflow-y: auto;
          box-shadow: 0 18px 44px -14px rgba(29, 31, 32, .42);
        }
        .per-ext-box h4 { margin: 0 0 6px; font-size: 15px; }
        .per-ext-box p { margin: 0 0 14px; font-size: 12px; color: var(--ink-soft); }
        .per-ext-op {
          display: flex; gap: 10px; align-items: flex-start;
          padding: 8px 10px; margin: 2px 0;
          border: 1px solid var(--border); border-radius: 8px;
          cursor: pointer; background: white;
        }
        .per-ext-op:hover { background: var(--bg-sunken); }
        .per-ext-op:has(input:checked) { background: #eef2f6; border-color: #46688c; }
        .per-ext-op input { margin-top: 2px; accent-color: #46688c; }
        .per-ext-op span { display: flex; flex-direction: column; gap: 1px; }
        .per-ext-op strong { font-size: 12px; color: var(--ink); }
        .per-ext-op small { font-size: 10px; color: var(--ink-soft); }
        .per-ext-acoes { display: flex; gap: 8px; align-items: center; margin-top: 14px; }
        .per-edit-modal {
          background: var(--bg-elevated);
          border-radius: 12px;
          width: 480px;
          max-width: 95vw;
          max-height: 90vh;
          display: flex; flex-direction: column;
          box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        }
        .per-edit-header {
          padding: 14px 20px;
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 700;
        }
        .per-edit-fechar {
          background: none; border: none; cursor: pointer;
          font-size: 16px; color: var(--ink-soft);
        }
        .per-edit-body { padding: 20px; overflow-y: auto; }
        .per-edit-form { display: grid; gap: 14px; }
        .per-edit-campo { display: flex; flex-direction: column; gap: 4px; }
        .per-edit-campo label,
        .per-edit-semanas-grupo > label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--ink-soft);
        }
        .per-edit-campo input,
        .per-edit-campo select {
          width: 100%;
          padding: 8px 10px;
          border: 1px solid var(--border);
          border-radius: 6px;
          font-size: 13px;
          background: white;
          color: var(--ink);
          box-sizing: border-box;
        }
        .per-edit-campo input:focus,
        .per-edit-campo select:focus {
          outline: none;
          border-color: var(--primary);
        }

        .per-edit-semanas-grupo { display: flex; flex-direction: column; gap: 6px; }
        .per-edit-semanas {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 8px;
        }
        .per-edit-semanas > div {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        .per-edit-sem-label {
          font-size: 10px;
          font-weight: 700;
          color: var(--ink-soft);
        }
        .per-edit-semanas input {
          width: 100%;
          padding: 6px 4px;
          text-align: center;
          font-family: var(--mono);
          font-weight: 700;
          border: 1px solid var(--border);
          border-radius: 6px;
          box-sizing: border-box;
        }

        .per-edit-preview {
          padding: 10px 14px;
          background: var(--bg-sunken);
          border-radius: 8px;
          border-left: 3px solid var(--accent);
        }
        .per-edit-preview-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--ink-soft);
          font-weight: 700;
          margin-bottom: 2px;
        }
        .per-edit-preview-valor {
          font-size: 14px;
          color: var(--ink);
          font-family: var(--mono);
        }
        .per-edit-preview-valor strong { color: var(--primary); }

        .per-edit-footer {
          padding: 12px 20px;
          border-top: 1px solid var(--border);
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
    `;
  }

  renderizar();
};
