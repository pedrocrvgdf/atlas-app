/**
 * ============================================================================
 * FICHÁRIO: DESEMPENHO · LAUDOS
 *
 * Apresenta os laudos importados da planilha "PAGAMENTO - LAUDOS" com layout
 * repaginado: KPIs, abas (Pacote/Impressos/Externo), matriz adaptável.
 *
 * Os dados vêm da tabela `laudos` (unificada pelo ImportadorLaudos).
 * ============================================================================
 */

App.telas['desempenho-laudos'] = function () {

  const MESES_EXTENSO = [
    'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
    'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'
  ];

  // ─────────────────────────────────────────────────────────────────────
  // RÓTULOS PERSONALIZÁVEIS — tudo o que aparece como texto na UI pode
  // ser renomeado pela sub-aba "Personalização" do painel de Ajustes.
  // Cada rótulo customizado é gravado em config_laudos com prefixo "ROT_".
  // ─────────────────────────────────────────────────────────────────────
  const LABELS_PADRAO = {
    // Categorias / abas
    aba_PACOTE:   'Pacote',
    aba_IMPRESSO: 'Impressos',
    aba_EXTERNO:  'Externo',
    // Colunas da aba Pacote
    col_pacote_unidade:  'Unidade',
    col_pacote_convenio: 'Convênio',
    col_pacote_medico:   'Médico',
    col_pacote_exame:    'Exame',
    col_pacote_qtd:      'Qtd',
    col_pacote_unit:     'Unit.',
    col_pacote_repasse:  'Repasse',
    // Colunas da aba Impressos
    col_impresso_data:     'Data',
    col_impresso_admissao: 'Admissão',
    col_impresso_paciente: 'Paciente',
    col_impresso_medico:   'Médico',
    col_impresso_exame:    'Exame',
    col_impresso_valor:    'Valor',
    // Colunas da aba Externo (visão agrupada por médico → exame)
    col_externo_medico:     'Médico',
    col_externo_adm_exame:  'Admissão / Exame',
    col_externo_pac_obs:    'Paciente / Observação',
    col_externo_qtd:        'Qtd',
    col_externo_valor:      'Valor',
    // Rótulos de status / regras de classificação
    status_pendente:   'LANÇAR',
    status_particular: 'PARTICULAR',
  };

  // Cache dos rótulos personalizados (lê uma vez por render)
  let __rotulosCache = null;
  function getRot(chave) {
    if (__rotulosCache === null) {
      const cfg = lerConfig();
      __rotulosCache = {};
      for (const k of Object.keys(LABELS_PADRAO)) {
        const custom = cfg['ROT_' + k];
        __rotulosCache[k] = (custom != null && custom !== '') ? custom : LABELS_PADRAO[k];
      }
    }
    return __rotulosCache[chave] || chave;
  }
  function invalidarRotulos() { __rotulosCache = null; }

  const state = (window.__laudos = window.__laudos || {
    mes: '', ano: '',
    aba: 'PACOTE',                   // 'PACOTE' | 'IMPRESSO' | 'EXTERNO'
    filtros: {
      admissao: '', paciente: '', medico: '', exame: '',
    },
    sbAberto: null,                  // V732: célula aberta na fileira de filtros 20C
    ajustesAberto: false,
    ajustesAba: 'VALORES',           // 'VALORES' | 'PENDENTES' | 'PERSONALIZAR' | 'CONFIG'
    drilldownExterno: new Set(),     // chaves "medico|exame" expandidas
    infoAberto: false,               // V128.4: popover info ⓘ
  });
  // Garante que campos novos existam quando state já vem do cache
  if (!state.drilldownExterno) state.drilldownExterno = new Set();
  if (!state.ajustesAba) state.ajustesAba = 'VALORES';
  // Reset da flag de animação: sempre anima na primeira renderização
  // após entrar no fichário (mas não em re-renderizações por filtro/aba)
  state._jaAnimou = false;

  function escapeHTML(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmt(n, casas = 2) {
    return Utilidades.formatarNumero(Number(n) || 0, casas);
  }

  function fmtData(s) {
    if (!s) return '—';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Carrega laudos com base nos filtros do header
  // ───────────────────────────────────────────────────────────────────────
  function listarCompetenciasDisponiveis() {
    const rows = Banco.query(`
      SELECT DISTINCT competencia FROM laudos
      ORDER BY competencia DESC
    `);
    const anos = new Set();
    const meses = new Set();
    for (const r of rows) {
      const [ano, mes] = (r.competencia || '').split('-');
      if (ano) anos.add(ano);
      if (mes) meses.add(mes);
    }
    return {
      anos: Array.from(anos).sort().reverse(),
      meses: Array.from(meses).sort(),
    };
  }

  // V492: cache do SELECT do período — antes o SELECT * do ano inteiro rodava a
  // cada render (inclusive a cada pausa de digitação nos filtros). Chave inclui
  // Banco._versao, então qualquer mudança no banco invalida o cache; os filtros
  // de texto continuam sendo aplicados em memória (aplicarFiltros).
  let _laudosCache = { chave: null, rows: null };
  function carregarLaudos() {
    const chaveCache = (state.ano || '') + '|' + (state.mes || '') + '|' + (Banco._versao || 0);  // V492
    if (_laudosCache.chave === chaveCache) return _laudosCache.rows;  // V492

    const where = [];
    const params = [];

    if (state.mes && state.ano) {
      where.push("competencia = ?");
      params.push(`${state.ano}-${state.mes}`);
    } else if (state.ano) {
      where.push("competencia LIKE ?");
      params.push(`${state.ano}-%`);
    }

    const sql = `
      SELECT * FROM laudos
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY categoria, ordem
    `;
    const rows = Banco.query(sql, params);
    _laudosCache = { chave: chaveCache, rows };  // V492
    return rows;
  }

  function aplicarFiltros(linhas) {
    // V922: filtros MULTI (string legada ou array) — marcar N = UNIÃO
    const f = state.filtros;
    const FM = Utilidades.filtroMulti;
    return linhas.filter(l =>
      FM.casa(f.admissao, l.admissao) && FM.casa(f.paciente, l.paciente)
      && FM.casa(f.medico, l.medico) && FM.casa(f.exame, l.exame));
  }

  // ───────────────────────────────────────────────────────────────────────
  // RENDER PRINCIPAL
  // ───────────────────────────────────────────────────────────────────────
  function renderizar() {
    invalidarRotulos();  // recarrega rótulos custom antes de cada render
    const conteudo = document.getElementById('conteudo');
    if (!conteudo) return;

    // V492: CSS injetado 1x no <head> (antes: <style> re-parseado dentro do innerHTML a cada render)
    Utilidades.garantirEstilos('css-tela-desempenho-laudos', cssLaudos());

    // Sem dados importados? Mostra tela de boas-vindas
    const total = Banco.query('SELECT COUNT(*) AS n FROM laudos')[0]?.n || 0;
    if (total === 0) {
      conteudo.innerHTML = renderTelaVazia();
      bindHandlers();   // V131.62: ativa o botão de importar inline na tela vazia
      return;
    }

    const todos = carregarLaudos();
    const filtrados = aplicarFiltros(todos);
    const linhasAba = filtrados.filter(l => l.categoria === state.aba);

    const kpi = calcularKpis(filtrados);

    conteudo.innerHTML = `
      <div class="laudos-tela">
        ${renderHeader()}
        ${state.ajustesAberto ? renderPainelAjustes() : `
          ${renderKpis(kpi)}
          ${renderAbas(filtrados)}
          ${renderTabela(linhasAba)}
        `}
      </div>
    `;

    bindHandlers();
    if (!state._jaAnimou) {
      aplicarStagger();
      state._jaAnimou = true;
    }
  }

  function aplicarStagger() {
    // Stagger granular: header → cada KPI → cada aba → painel/tabela.
    // Quando o painel de Ajustes está aberto, anima as sub-abas em vez dos KPIs.
    const seletor = state.ajustesAberto
      ? '.laudos-page-header, .laudos-ajustes-painel, .laudos-ajuste-tab'
      : '.laudos-page-header, .laudos-kpi, .laudos-aba, .laudos-painel';
    Utilidades.staggerEntrada(seletor, { delay: 55, duracao: 380, deslocamento: 14 });
  }

  function renderTelaVazia() {
    return `
      <div class="page-content">
        <header class="page-header">
          <div>
            <h2>Laudos</h2>
            <div class="subtitle">Apuração mensal dos pagamentos de laudos</div>
          </div>
        </header>
        <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 60px 20px">
          <div style="font-size: 42px; opacity: 0.4; margin-bottom: 12px">📋</div>
          <h3 style="margin: 0 0 8px">Nenhuma planilha de laudos importada ainda</h3>
          <p class="muted" style="font-size: 13px; margin: 0 0 18px">
            Importe a planilha "PAGAMENTO - LAUDOS - &lt;MÊS&gt;.xlsx" pra começar
          </p>
          <input type="file" id="laudos-input-importar" accept=".xlsx,.xls" style="display:none">
          <button class="btn btn-primary" id="laudos-btn-importar">
            ↑ Importar planilha de laudos
          </button>
        </div>
      </div>
    `;
  }

  // ─── HEADER ───────────────────────────────────────────────────────────
  function renderHeader() {
    const { anos, meses } = listarCompetenciasDisponiveis();
    const filtrosAtivos = Object.values(state.filtros).some(v => Utilidades.filtroMulti.ativo(v));

    // Coleta valores únicos pra cada campo (do dataset filtrado por mês/ano)
    const opcoes = coletarOpcoesDosFiltros();

    return `
      <header class="page-header laudos-page-header">
        <div class="laudos-page-header-esq">
          <div class="laudos-titulo-wrap fic-titulo-wrap">
            <h2 class="laudos-titulo">Laudos</h2>
            <button class="fic-btn-info ${state.infoAberto ? 'fic-btn-info-ativo' : ''}"
                    id="laudos-btn-info"
                    title="Ver regras do fichário Laudos">ⓘ</button>
          </div>
          ${state.infoAberto ? `
            <div class="fic-popover-info">
              <div class="fic-popover-info-head">
                <strong>Regras Laudos</strong>
                <button class="fic-popover-info-close" id="laudos-info-close">✕</button>
              </div>
              <div class="fic-popover-info-body">
                <p>
                  <strong>Origem</strong> · Dados da planilha "PAGAMENTO - LAUDOS - &lt;MÊS&gt;.xlsx".
                  Três categorias unificadas na tabela <code>laudos</code>:
                  <code>PACOTE</code> · <code>IMPRESSO</code> · <code>EXTERNO</code>.
                </p>
                <ul>
                  <li><strong>PACOTE</strong>: laudos cobrados por convênio em pacotes fechados. Campos:
                    Unidade, Convênio, Quantidade, Valor unitário.</li>
                  <li><strong>IMPRESSO</strong>: laudos no impresso individual do médico, vinculados a admissões
                    (Admissão, Paciente, Fluxo, Módulo).</li>
                  <li><strong>EXTERNO</strong>: laudos pagos externamente (drilldown agrupado por médico → exame).
                    Particulares têm flag específica.</li>
                </ul>
                <p>
                  <strong>Tabela mestre</strong> · Valores de referência por exame em
                  <code>laudos_valores</code> (editável em ⚙ Ajustes → Tabela de Preços).
                  A Visão Geral alerta quando o valor importado diverge dessa tabela.
                </p>
                <p>
                  <strong>Pendências</strong> · Linhas onde o valor veio como "LANÇAR" ou vazio
                  ficam marcadas com <code>pendente=1</code> e aparecem na sub-aba
                  "Pendências" do painel Ajustes (não entram no REPASSE TOTAL).
                </p>
                <p>
                  <strong>Personalização</strong> · Em ⚙ Ajustes → 🎨 Personalização, é possível renomear
                  rótulos de colunas, abas e regras visíveis no fichário.
                </p>
              </div>
            </div>
          ` : ''}
        </div>
        <div class="laudos-page-header-dir">
          <input type="file" id="laudos-input-importar" accept=".xlsx,.xls" style="display:none">
          <button class="btn laudos-btn-importar" id="laudos-btn-importar" title="Importar nova planilha de laudos">
            ↑ Importar
          </button>
          <div class="laudos-exportar-wrap">
            <button class="btn laudos-btn-exportar" id="laudos-btn-exportar">↓ Exportar Excel ▾</button>
          </div>
          <button class="btn laudos-btn-ajustes ${state.ajustesAberto ? 'laudos-btn-ajustes-ativo' : ''}" id="laudos-btn-ajustes">
            ⚙ ${state.ajustesAberto ? 'Voltar' : 'Ajustes'}
          </button>
        </div>
      </header>
      <!-- V732: a fileira 20C é IRMÃ do header — estica de ponta a ponta;
           o "✕ Limpar filtros" fica compacto logo abaixo dela -->
      <div class="laudos-filtros-bar">
        ${renderBarraFiltrosLaud20C({ meses, anos, opcoes })}
        ${filtrosAtivos
          ? `<button class="btn-limpar-filtros" id="laudos-btn-limpar">✕ Limpar filtros</button>`
          : ''}
      </div>
    `;
  }

  // Coleta valores únicos pra cada filtro (do dataset filtrado por mês/ano)
  function coletarOpcoesDosFiltros() {
    const todos = carregarLaudos();   // já considera mês/ano
    const adm = new Set(), pac = new Set(), med = new Set(), exa = new Set();
    for (const l of todos) {
      if (l.admissao) adm.add(String(l.admissao));
      if (l.paciente) pac.add(l.paciente);
      if (l.medico)   med.add(l.medico);
      if (l.exame)    exa.add(l.exame);
      else if (l.modulo) exa.add(l.modulo);
    }
    const sort = (s) => Array.from(s).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return { admissao: sort(adm), paciente: sort(pac), medico: sort(med), exame: sort(exa) };
  }

  // V716: menu no padrão da ferramenta (modelo LIO — Utilidades.abrirMenuExportar);
  // saiu o render via state.menuExportarAberto (o popup vive no <body>).
  function abrirMenuExportar(btn) {
    const labelAba = state.aba === 'PACOTE' ? 'Pacote' : state.aba === 'IMPRESSO' ? 'Impressos' : 'Externo';
    const ir = (modo) => setTimeout(() => exportarExcel(modo), 50);
    Utilidades.abrirMenuExportar(btn, [
      { icone: '📄', titulo: `Aba atual (${labelAba})`, sub: 'Só as linhas dessa categoria',
        onClick: () => ir('aba_atual') },
      { icone: '📚', titulo: 'Todas as categorias', sub: 'Pacote + Impressos + Externo em 3 abas',
        onClick: () => ir('todas') },
      'sep',
      { icone: '⚠', titulo: 'Só pendências', sub: 'Linhas marcadas "LANÇAR"', tom: 'vermelho',
        onClick: () => ir('pendentes') },
      { icone: '★', titulo: 'Só particulares', sub: 'Linhas marcadas PARTICULAR', tom: 'part',
        onClick: () => ir('particulares') },
      'sep',
      { icone: '⚕', titulo: 'Uma aba por médico', sub: 'Separa todas as linhas por profissional',
        onClick: () => ir('por_medico') },
    ]);
  }

  // ───────────────────────────────────────────────────────────────────────
  // V732: fileira de filtros 20C (padrão LIO/OPME, prefixo laud-sb)
  // Células: Mês · Ano · Admissão · Paciente · Médico · Exame. Painéis
  // abrem/fecham LOCAL (insertAdjacentHTML — zero re-render); aplicar seta
  // as MESMAS chaves de state dos handlers antigos e chama renderizar().
  // ───────────────────────────────────────────────────────────────────────
  function _laudSbIc(nome) {
    return {
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      alignleft: '<line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/>',
      user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
      search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
      check: '<polyline points="20 6 9 17 4 12"/>',
      chev: '<polyline points="6 9 12 15 18 9"/>',
    }[nome] || '';
  }
  function _laudSbSvg(d, px, sw) {
    return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  function _laudSbSemAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function _laudSbIniciais(nome) {
    const p = String(nome || '').split(/\s+/).filter(w => w.length >= 3);
    return ((p[0] || ' ')[0] + ((p[1] || ' ')[0] || '')).toUpperCase().trim() || '–';
  }

  function renderBarraFiltrosLaud20C(ctx) {
    // guarda as listas pro painel abrir LOCAL depois, sem recoletar
    state._sbOpcoes = {
      meses: ctx.meses, anos: ctx.anos,
      admissao: ctx.opcoes.admissao,
      paciente: ctx.opcoes.paciente,
      medico: ctx.opcoes.medico,
      exame: ctx.opcoes.exame,
    };
    const cel = (id, rotulo, valor, icone, flex, vazio = 'Todos') => {
      const ativo = !!valor;
      const estaAberta = state.sbAberto === id;
      return `
        <div class="laud-sb-celwrap" style="flex:${flex}">
          <button type="button" class="laud-sb-cel ${ativo ? 'ativo' : ''} ${estaAberta ? 'aberta' : ''}"
                  data-sb-cel="${id}" data-sb-vazio="${vazio}" role="combobox" aria-expanded="${estaAberta ? 'true' : 'false'}" aria-haspopup="listbox">
            <span class="laud-sb-tile">${_laudSbSvg(_laudSbIc(icone), 14, 2.1)}</span>
            <span class="laud-sb-tx">
              <span class="laud-sb-rot">${rotulo}</span>
              <span class="laud-sb-val">${escapeHTML(valor || vazio)}</span>
            </span>
            <span class="laud-sb-chev">${_laudSbSvg(_laudSbIc('chev'), 10, 2.8)}</span>
          </button>
          ${estaAberta ? painelLaud20C(id) : ''}
        </div>`;
    };
    const mesLabel = state.mes ? (MESES_EXTENSO[Number(state.mes) - 1] || state.mes) : '';
    // V922: rótulo dos filtros multi ("N selecionados")
    const FM = Utilidades.filtroMulti;
    const rotMulti = (f) => FM.ativo(f) ? FM.rotulo(f) : '';
    return `
      <div class="laud-sb" id="laud-sb">
        ${cel('mes', 'Mês', mesLabel, 'calendar', 0.85)}
        ${cel('ano', 'Ano', state.ano || '', 'clock', 0.75)}
        ${cel('admissao', 'Admissão', rotMulti(state.filtros.admissao), 'alignleft', 1.05, 'Todas')}
        ${cel('paciente', 'Paciente', rotMulti(state.filtros.paciente), 'user', 1.25)}
        ${cel('medico', 'Médico', rotMulti(state.filtros.medico), 'userplus', 1.3)}
        ${cel('exame', 'Exame', rotMulti(state.filtros.exame), 'search', 1.1)}
      </div>`;
  }

  function painelLaud20C(id) {
    const opc = state._sbOpcoes || {};
    const item = (val, rotulo, sel, chip) => `
      <div class="laud-sb-it ${sel ? 'sel' : ''} ${val === '' ? 'laud-sb-it-todos' : ''}" data-sb-item data-val="${escapeHTML(val)}" data-busca="${escapeHTML(_laudSbSemAcento(rotulo))}" role="option" aria-selected="${sel ? 'true' : 'false'}">
        ${chip ? `<span class="laud-sb-chip">${escapeHTML(_laudSbIniciais(rotulo))}</span>` : ''}
        <span class="laud-sb-it-nome">${escapeHTML(rotulo)}</span>
        ${sel ? `<span class="laud-sb-ck">${_laudSbSvg(_laudSbIc('check'), 14, 2.5)}</span>` : ''}
      </div>`;
    const painelLista = (cel, itensHtml, { busca = false, total = 0 } = {}) => `
      <div class="laud-sb-painel" data-sb-painel="${cel}">
        ${busca ? `
          <div class="laud-sb-buscabox">
            <span class="laud-sb-busca-ic">${_laudSbSvg(_laudSbIc('search'), 15, 2.1)}</span>
            <input type="text" class="laud-sb-busca" data-sb-busca placeholder="Digite pra buscar" autocomplete="off">
          </div>` : ''}
        <div class="laud-sb-lista" role="listbox">${itensHtml}</div>
        ${busca ? `<div class="laud-sb-rodape" data-sb-contagem>${total} opç${total === 1 ? 'ão' : 'ões'}</div>` : ''}
      </div>`;
    if (id === 'mes') {
      return painelLista('mes',
        item('', 'Todos', !state.mes)
        + (opc.meses || []).map(m => item(m, MESES_EXTENSO[Number(m) - 1] || m, state.mes === m)).join(''));
    }
    if (id === 'ano') {
      return painelLista('ano',
        item('', 'Todos', !state.ano)
        + (opc.anos || []).map(a => item(a, a, state.ano === a)).join(''));
    }
    // combos com busca (Admissão / Paciente / Médico / Exame)
    const cfgCampo = {
      admissao: { todos: 'Todas', chips: false },
      paciente: { todos: 'Todos', chips: false },
      medico:   { todos: 'Todos', chips: true },
      exame:    { todos: 'Todos', chips: false },
    }[id] || { todos: 'Todos', chips: false };
    const lista = opc[id] || [];
    // V922: MULTI — checkbox por item, marcados no topo, busca sempre presente
    const FM = Utilidades.filtroMulti;
    const sel = FM.sel(state.filtros[id]);
    const marcadas = lista.filter(o => sel.includes(String(o)));
    const demais = lista.filter(o => !sel.includes(String(o)));
    return painelLista(id,
      item('', cfgCampo.todos, sel.length === 0)
      + [...marcadas, ...demais].slice(0, 400).map(o => item(o, o, sel.includes(String(o)), cfgCampo.chips)).join(''),
      { busca: true, total: lista.length });
  }

  function bindBarraFiltrosLaud20C() {
    const sb = document.getElementById('laud-sb');
    if (!sb) return;
    const fecharPainelLocal = () => {
      sb.querySelectorAll('.laud-sb-painel').forEach(p => p.remove());
      sb.querySelectorAll('.laud-sb-cel.aberta').forEach(c => { c.classList.remove('aberta'); c.setAttribute('aria-expanded', 'false'); });
      state.sbAberto = null;
    };
    const aplicar = (celId, val) => {
      // mesmas chaves de state dos handlers antigos (selects/combos)
      // V922: combos viraram MULTI — clique alterna (checkbox) e a lista
      // fica ABERTA; "Todos" limpa; a busca digitada é preservada
      if (celId === 'mes' || celId === 'ano') {
        if (celId === 'mes') state.mes = val || ''; else state.ano = val || '';
        state._sbBusca = '';
        state.sbAberto = null;
        renderizar();
        return;
      }
      const FM = Utilidades.filtroMulti;
      const buscaEl = sb.querySelector('[data-sb-busca]');
      state._sbBusca = buscaEl ? buscaEl.value : '';
      state.filtros[celId] = val === '' ? [] : FM.toggle(state.filtros[celId], val);
      renderizar();   // sbAberto continua — o painel re-abre marcado
    };
    const wireInputsPainel = () => {
      const busca = sb.querySelector('[data-sb-busca]');
      if (!busca) return;
      setTimeout(() => busca.focus(), 0);
      const filtrar = () => {
        const q = _laudSbSemAcento(busca.value);
        const painel = busca.closest('.laud-sb-painel');
        let n = 0;
        painel.querySelectorAll('[data-sb-item]').forEach(el => {
          // V922: itens MARCADOS ficam sempre visíveis
          const mostra = el.classList.contains('laud-sb-it-todos') || el.classList.contains('sel') || !q || (el.dataset.busca || '').includes(q);
          el.style.display = mostra ? '' : 'none';
          if (mostra && !el.classList.contains('laud-sb-it-todos')) n++;
        });
        const cont = painel.querySelector('[data-sb-contagem]');
        if (cont) cont.textContent = `${n} opç${n === 1 ? 'ão' : 'ões'}`;
      };
      busca.addEventListener('input', filtrar);
      if (state._sbBusca) { busca.value = state._sbBusca; filtrar(); }   // V922
    };
    const abrirPainelLocal = (id) => {
      const jaAberto = state.sbAberto === id;
      fecharPainelLocal();
      state._sbBusca = '';   // V922: busca não vaza de um painel pro outro
      if (jaAberto) return;
      state.sbAberto = id;
      const btn = sb.querySelector(`[data-sb-cel="${id}"]`);
      btn.classList.add('aberta');
      btn.setAttribute('aria-expanded', 'true');
      btn.parentElement.insertAdjacentHTML('beforeend', painelLaud20C(id));
      wireInputsPainel();
    };
    // V922: o painel pode vir aberto do template (re-render após marcar)
    if (state.sbAberto && sb.querySelector('.laud-sb-painel')) wireInputsPainel();
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
      if (!state.sbAberto) return;
      const painel = sb.querySelector('.laud-sb-painel');
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
    if (window.__laudSbFechar) {
      document.removeEventListener('click', window.__laudSbFechar);
      document.removeEventListener('keydown', window.__laudSbEsc);
    }
    const fecharFora = (e) => {
      if (App.telaAtual !== 'desempenho-laudos') return;
      if (state.sbAberto && !e.target.closest('#laud-sb')) fecharPainelLocal();
    };
    const escFecha = (e) => { if (e.key === 'Escape' && state.sbAberto) fecharPainelLocal(); };
    window.__laudSbFechar = fecharFora;
    window.__laudSbEsc = escFecha;
    document.addEventListener('click', fecharFora);
    document.addEventListener('keydown', escFecha);
    if (state.sbAberto) wireInputsPainel();
  }

  // ─── KPIs ─────────────────────────────────────────────────────────────
  function calcularKpis(linhas) {
    return {
      total:        linhas.length,
      valor:        linhas.reduce((s, l) => s + (Number(l.valor_repasse) || 0), 0),
      medicos:      new Set(linhas.map(l => l.medico).filter(Boolean)).size,
      pendencias:   linhas.filter(l => l.pendente).length,
      particulares: linhas.filter(l => l.particular).length,
    };
  }

  function renderKpis(k) {
    return `
      <div class="laudos-kpis">
        <div class="laudos-kpi laudos-kpi-verde">
          <div class="laudos-kpi-faixa"></div>
          <div class="laudos-kpi-label">TOTAL DE LAUDOS</div>
          <div class="laudos-kpi-valor">${k.total}</div>
          <div class="laudos-kpi-sub">linhas processadas</div>
        </div>
        <div class="laudos-kpi laudos-kpi-bege">
          <div class="laudos-kpi-faixa"></div>
          <div class="laudos-kpi-label">REPASSE TOTAL</div>
          <div class="laudos-kpi-valor">R$ ${fmt(k.valor)}</div>
          <div class="laudos-kpi-sub">a pagar no período</div>
        </div>
        <div class="laudos-kpi laudos-kpi-roxo">
          <div class="laudos-kpi-faixa"></div>
          <div class="laudos-kpi-label">MÉDICOS</div>
          <div class="laudos-kpi-valor">${k.medicos}</div>
          <div class="laudos-kpi-sub">distintos no período</div>
        </div>
        <div class="laudos-kpi laudos-kpi-destaque">
          <div class="laudos-kpi-faixa"></div>
          <div class="laudos-kpi-label">PENDÊNCIAS</div>
          <div class="laudos-kpi-valor">${k.pendencias}</div>
          <div class="laudos-kpi-sub">${k.pendencias > 0 ? '"LANÇAR" sem valor' : 'tudo lançado ✓'}</div>
        </div>
      </div>
    `;
  }

  // ─── ABAS ─────────────────────────────────────────────────────────────
  function renderAbas(linhas) {
    const cont = {
      PACOTE:   linhas.filter(l => l.categoria === 'PACOTE').length,
      IMPRESSO: linhas.filter(l => l.categoria === 'IMPRESSO').length,
      EXTERNO:  linhas.filter(l => l.categoria === 'EXTERNO').length,
    };

    const aba = (chave, rotulo, bulletCor) => {
      const ativa = state.aba === chave;
      return `
        <button class="laudos-aba ${ativa ? 'laudos-aba-ativa' : ''}" data-aba="${chave}">
          <span class="laudos-aba-bullet" style="background:${bulletCor}"></span>
          <span class="laudos-aba-label">${rotulo}</span>
          <span class="laudos-aba-badge">${cont[chave]}</span>
        </button>
      `;
    };

    return `
      <div class="laudos-abas">
        ${aba('PACOTE',   getRot('aba_PACOTE'),   '#2a5a8c')}
        ${aba('IMPRESSO', getRot('aba_IMPRESSO'), '#143352')}
        ${aba('EXTERNO',  getRot('aba_EXTERNO'),  '#2a5a8c')}
      </div>
    `;
  }

  // ─── TABELA ───────────────────────────────────────────────────────────
  function renderTabela(linhas) {
    if (linhas.length === 0) {
      return `
        <div class="laudos-painel">
          <div class="laudos-painel-head">Nenhuma linha para os filtros atuais nessa categoria.</div>
        </div>
      `;
    }

    const totalValor = linhas.reduce((s, l) => s + (Number(l.valor_repasse) || 0), 0);

    let headerCols, rowFn, colTotalLabel;

    if (state.aba === 'PACOTE') {
      headerCols = `
        <th>${escapeHTML(getRot('col_pacote_unidade'))}</th>
        <th>${escapeHTML(getRot('col_pacote_convenio'))}</th>
        <th>${escapeHTML(getRot('col_pacote_medico'))}</th>
        <th>${escapeHTML(getRot('col_pacote_exame'))}</th>
        <th class="num">${escapeHTML(getRot('col_pacote_qtd'))}</th>
        <th class="num">${escapeHTML(getRot('col_pacote_unit'))}</th>
        <th class="num">${escapeHTML(getRot('col_pacote_repasse'))}</th>
      `;
      colTotalLabel = 6;
      rowFn = l => `
        <tr>
          <td>${escapeHTML(l.unidade || '—')}</td>
          <td>${escapeHTML(l.convenio || '—')}</td>
          <td title="${escapeHTML(CodigoMedico.exibir(l.medico || ''))}">${escapeHTML(CodigoMedico.exibir(l.medico || '—'))}</td>
          <td title="${escapeHTML(l.exame || '')}">${escapeHTML(l.exame || '—')}</td>
          <td class="num mono">${l.quantidade || 1}</td>
          <td class="num mono">R$ ${fmt(l.valor_unitario)}</td>
          <td class="num mono valor-bold">R$ ${fmt(l.valor_repasse)}</td>
        </tr>
      `;
    } else if (state.aba === 'IMPRESSO') {
      headerCols = `
        <th>${escapeHTML(getRot('col_impresso_data'))}</th>
        <th>${escapeHTML(getRot('col_impresso_admissao'))}</th>
        <th>${escapeHTML(getRot('col_impresso_paciente'))}</th>
        <th>${escapeHTML(getRot('col_impresso_medico'))}</th>
        <th>${escapeHTML(getRot('col_impresso_exame'))}</th>
        <th class="num">${escapeHTML(getRot('col_impresso_valor'))}</th>
      `;
      colTotalLabel = 5;
      rowFn = l => {
        const pendente = l.pendente;
        return `
          <tr class="${pendente ? 'laudos-linha-pendente' : ''}">
            <td class="mono">${fmtData(l.data_admissao)}</td>
            <td class="mono">${escapeHTML(l.admissao || '—')}</td>
            <td title="${escapeHTML(l.paciente || '')}">${escapeHTML(l.paciente || '—')}</td>
            <td title="${escapeHTML(CodigoMedico.exibir(l.medico || ''))}">${escapeHTML(CodigoMedico.exibir(l.medico || '—'))}</td>
            <td title="${escapeHTML(l.modulo || '')}">${escapeHTML(l.exame || l.modulo || '—')}</td>
            <td class="num mono ${pendente ? 'valor-pendente' : 'valor-bold'}">
              ${pendente
                ? `<small class="laudos-badge-pendente">${escapeHTML(getRot('status_pendente'))}</small>`
                : `R$ ${fmt(l.valor_repasse)}`}
            </td>
          </tr>
        `;
      };
    } else {  // EXTERNO — visão agrupada por MÉDICO → EXAME com drilldown
      return renderTabelaExterno(linhas);
    }

    return `
      <div class="laudos-painel">
        <div class="laudos-painel-head">
          <strong>${linhas.length}</strong> linha${linhas.length === 1 ? '' : 's'}
        </div>
        <div class="laudos-tabela-scroll">
          <table class="laudos-tabela laudos-tabela-plana"><!-- V968: zebra por posição -->
            <thead><tr>${headerCols}</tr></thead>
            <tbody>${linhas.map(rowFn).join('')}</tbody>
            <tfoot>
              <tr>
                <td colspan="${colTotalLabel}" class="laudos-total-label">Total</td>
                <td class="num mono atlas-rep"><strong>R$ ${fmt(totalValor)}</strong></td><!-- V963 -->
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
  }

  // ─── Visão agrupada do EXTERNO (médico → exame → linhas) ──────────────
  function renderTabelaExterno(linhas) {
    // Agrupa: medico → exame → [linhas]
    const porMedico = {};
    for (const l of linhas) {
      const med = l.medico || '(sem médico)';
      if (!porMedico[med]) porMedico[med] = { total: 0, qtd: 0, exames: {} };
      porMedico[med].total += Number(l.valor_repasse) || 0;
      porMedico[med].qtd++;
      const ex = l.exame || '(sem exame)';
      if (!porMedico[med].exames[ex]) porMedico[med].exames[ex] = { total: 0, qtd: 0, linhas: [] };
      porMedico[med].exames[ex].total += Number(l.valor_repasse) || 0;
      porMedico[med].exames[ex].qtd++;
      porMedico[med].exames[ex].linhas.push(l);
    }

    const medicos = Object.keys(porMedico).sort((a, b) => porMedico[b].total - porMedico[a].total);
    const totalGeral = linhas.reduce((s, l) => s + (Number(l.valor_repasse) || 0), 0);

    const linhasHtml = medicos.map(med => {
      const dadosMed = porMedico[med];
      const exames = Object.keys(dadosMed.exames).sort((a, b) => dadosMed.exames[b].total - dadosMed.exames[a].total);

      const exameLinhas = exames.map((ex, idxEx) => {   // V968: idxEx → zebra por exame (reinicia a cada médico)
        const chave = `${med}|${ex}`;
        const aberto = state.drilldownExterno.has(chave);
        const dadosEx = dadosMed.exames[ex];
        const linhasDet = aberto ? dadosEx.linhas.map(l => `
          <tr class="laudos-ext-detalhe ${l.particular ? 'laudos-linha-particular' : ''}">
            <td colspan="2" style="padding-left:48px"></td>
            <td class="mono">${escapeHTML(l.admissao || '—')}</td>
            <td title="${escapeHTML(l.paciente || '')}">${escapeHTML(l.paciente || '—')}</td>
            <td>${l.particular
              ? Utilidades.badgeFonte('PARTICULAR')
              : (escapeHTML(l.observacao) || '—')}</td><!-- V947: tag padrão -->
            <td class="num mono valor-bold">R$ ${fmt(l.valor_repasse)}</td>
          </tr>
        `).join('') : '';

        return `
          <tr class="laudos-ext-exame-row ${aberto ? 'aberto' : ''} ${idxEx % 2 === 1 ? 'laudos-zebra' : ''}" data-chave="${escapeHTML(chave)}">
            <td style="padding-left:30px">
              <span class="laudos-drill-toggle">${aberto ? '▾' : '▸'}</span>
            </td>
            <td title="${escapeHTML(CodigoMedico.exibir(med))}" class="laudos-ext-nome-medico">↳ ${escapeHTML(CodigoMedico.exibir(med))}</td>
            <td colspan="2" class="laudos-ext-nome-exame">${escapeHTML(ex)}</td>
            <td class="num mono"><span class="laudos-ext-chip-qtd">${dadosEx.qtd}×</span></td>
            <td class="num mono valor-bold">R$ ${fmt(dadosEx.total)}</td>
          </tr>
          ${linhasDet}
        `;
      }).join('');

      return `
        <tr class="laudos-ext-medico-row">
          <td colspan="4">
            <strong>${escapeHTML(med)}</strong>
            <small class="laudos-ext-mini-stats">
              ${dadosMed.qtd} laudo${dadosMed.qtd === 1 ? '' : 's'} ·
              ${exames.length} tipo${exames.length === 1 ? '' : 's'} de exame
            </small>
          </td>
          <td class="num mono atlas-rep"><strong>${dadosMed.qtd}</strong></td><!-- V969: cor padrão do repasse -->
          <td class="num mono atlas-rep"><strong>R$ ${fmt(dadosMed.total)}</strong></td>
        </tr>
        ${exameLinhas}
      `;
    }).join('');

    return `
      <div class="laudos-painel">
        <div class="laudos-painel-head laudos-ext-head">
          <strong>${linhas.length}</strong> linha${linhas.length === 1 ? '' : 's'}
          <span class="laudos-ext-acoes">
            <button class="laudos-ext-btn" id="laudos-ext-expand-all" title="Expandir todos os médicos/exames">
              ⇕ Expandir todos
            </button>
            <button class="laudos-ext-btn" id="laudos-ext-collapse-all" title="Recolher todos">
              ⇕ Recolher
            </button>
          </span>
        </div>
        <div class="laudos-tabela-scroll">
          <table class="laudos-tabela">
            <thead>
              <tr>
                <th style="width:36px"></th>
                <th>${escapeHTML(getRot('col_externo_medico'))}</th>
                <th>${escapeHTML(getRot('col_externo_adm_exame'))}</th>
                <th>${escapeHTML(getRot('col_externo_pac_obs'))}</th>
                <th class="num">${escapeHTML(getRot('col_externo_qtd'))}</th>
                <th class="num">${escapeHTML(getRot('col_externo_valor'))}</th>
              </tr>
            </thead>
            <tbody>${linhasHtml || '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--ink-faint)">Sem dados</td></tr>'}</tbody>
            <!-- V969: a linha Total da aba Externo SAIU (o card totalizador já cumpre o papel) -->
          </table>
        </div>
      </div>
    `;
  }

  // ─── PAINEL DE AJUSTES ────────────────────────────────────────────────
  function renderPainelAjustes() {
    return `
      <div class="laudos-ajustes-painel">
        <div class="laudos-ajustes-tabs">
          ${tabAjuste('VALORES',     '💲 Tabela de Preços')}
          ${tabAjuste('PENDENTES',   '⚠ Pendências')}
          ${tabAjuste('PERSONALIZAR','🎨 Personalização')}
          ${tabAjuste('CONFIG',      '⚙ Configurações')}
        </div>
        <div class="laudos-ajustes-conteudo">
          ${state.ajustesAba === 'VALORES'      ? renderAjustesValores()      : ''}
          ${state.ajustesAba === 'PENDENTES'    ? renderAjustesPendentes()    : ''}
          ${state.ajustesAba === 'PERSONALIZAR' ? renderAjustesPersonalizar() : ''}
          ${state.ajustesAba === 'CONFIG'       ? renderAjustesConfig()       : ''}
        </div>
      </div>
    `;
  }

  function tabAjuste(chave, rotulo) {
    const ativa = state.ajustesAba === chave;
    return `
      <button class="laudos-ajuste-tab ${ativa ? 'ativa' : ''}" data-ajuste-tab="${chave}">
        ${rotulo}
      </button>
    `;
  }

  // Sub-aba: VALORES — editar tabela mestre de preços
  function renderAjustesValores() {
    const valores = Banco.query(`
      SELECT exame, valor_convenio, valor_particular, atualizado_em
      FROM laudos_valores
      ORDER BY exame
    `);

    return `
      <div class="laudos-ajuste-cabecalho">
        <div>
          <h3>Tabela mestre de preços</h3>
          <p class="muted">Valores usados como referência pra cada tipo de exame.
            Edite e clique <strong>Salvar</strong>. A coluna PARTICULAR aplica quando o
            laudo tem observação "PARTICULAR" na aba Externo.</p>
        </div>
        <button class="btn btn-pequeno" id="btn-add-exame">+ Novo exame</button>
      </div>

      <table class="laudos-ajuste-tabela">
        <thead>
          <tr>
            <th>EXAME</th>
            <th class="num">VALOR CONVÊNIO</th>
            <th class="num">VALOR PARTICULAR</th>
            <th>ATUALIZADO EM</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${valores.map(v => `
            <tr data-exame="${escapeHTML(v.exame)}">
              <td>${escapeHTML(v.exame)}</td>
              <td class="num">
                <input type="number" step="0.01" min="0" class="laudos-ajuste-input"
                       data-campo="valor_convenio" value="${v.valor_convenio || 0}">
              </td>
              <td class="num">
                <input type="number" step="0.01" min="0" class="laudos-ajuste-input"
                       data-campo="valor_particular" value="${v.valor_particular || 0}">
              </td>
              <td class="muted" style="font-size:11px">${formatarDataAjuste(v.atualizado_em)}</td>
              <td style="text-align:right">
                <button class="btn-acao-mini btn-salvar-valor" data-exame="${escapeHTML(v.exame)}">💾 Salvar</button>
                <button class="btn-acao-mini btn-acao-perigo btn-excluir-valor" data-exame="${escapeHTML(v.exame)}">✕</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // Sub-aba: PENDENTES — linhas com "LANÇAR"
  function renderAjustesPendentes() {
    const pendentes = Banco.query(`
      SELECT id, competencia, categoria, admissao, data_admissao,
             paciente, medico, exame, modulo
      FROM laudos
      WHERE pendente = 1
      ORDER BY competencia DESC, categoria, admissao
    `);

    // Lista de exames disponíveis pra atribuir
    const exames = Banco.query(`SELECT exame, valor_convenio FROM laudos_valores ORDER BY exame`);

    if (pendentes.length === 0) {
      return `
        <div class="laudos-ajuste-vazio">
          <div style="font-size:42px">✓</div>
          <h3>Nenhuma pendência</h3>
          <p class="muted">Todas as linhas têm valor lançado.</p>
        </div>
      `;
    }

    return `
      <div class="laudos-ajuste-cabecalho">
        <div>
          <h3>Linhas pendentes (LANÇAR)</h3>
          <p class="muted">Essas linhas vieram com "LANÇAR" no lugar do valor.
            Atribua um valor manualmente ou marque como zerado.</p>
        </div>
      </div>

      <table class="laudos-ajuste-tabela">
        <thead>
          <tr>
            <th>COMP</th>
            <th>CATEG</th>
            <th>ADM</th>
            <th>PACIENTE</th>
            <th>MÉDICO</th>
            <th>EXAME</th>
            <th class="num" style="width:140px">VALOR R$</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${pendentes.map(p => `
            <tr data-id="${p.id}">
              <td class="mono" style="font-size:11px">${formatarCompetencia(p.competencia)}</td>
              <td><small class="laudos-tag-cat laudos-tag-${p.categoria.toLowerCase()}">${p.categoria}</small></td>
              <td class="mono" style="font-size:11px">${escapeHTML(p.admissao || '—')}</td>
              <td title="${escapeHTML(p.paciente || '')}">${escapeHTML(p.paciente || '—')}</td>
              <td title="${escapeHTML(CodigoMedico.exibir(p.medico || ''))}">${escapeHTML(CodigoMedico.exibir(p.medico || '—'))}</td>
              <td title="${escapeHTML(p.modulo || p.exame || '')}">
                ${escapeHTML(p.exame || p.modulo || '—')}
              </td>
              <td class="num">
                <input type="number" step="0.01" min="0" class="laudos-ajuste-input"
                       data-campo="valor_repasse" value="">
              </td>
              <td style="text-align:right">
                <button class="btn-acao-mini btn-lancar-pendente" data-id="${p.id}">💾 Lançar</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // Sub-aba: PERSONALIZAR — renomear colunas, abas, status, regras
  function renderAjustesPersonalizar() {
    const cfg = lerConfig();
    const valorAtual = (chave) => {
      const c = cfg['ROT_' + chave];
      return (c != null && c !== '') ? c : '';   // vazio = usa padrão
    };

    const SECOES = [
      {
        titulo: 'Nomes das abas / categorias',
        descricao: 'Como aparece nos botões de aba (Pacote, Impressos, Externo).',
        chaves: [
          ['aba_PACOTE',   'Aba Pacote'],
          ['aba_IMPRESSO', 'Aba Impressos'],
          ['aba_EXTERNO',  'Aba Externo'],
        ],
      },
      {
        titulo: 'Colunas da aba Pacote',
        descricao: 'Cabeçalhos da tabela quando a aba Pacote está selecionada.',
        chaves: [
          ['col_pacote_unidade',  'Coluna "Unidade"'],
          ['col_pacote_convenio', 'Coluna "Convênio"'],
          ['col_pacote_medico',   'Coluna "Médico"'],
          ['col_pacote_exame',    'Coluna "Exame"'],
          ['col_pacote_qtd',      'Coluna "Qtd"'],
          ['col_pacote_unit',     'Coluna "Unit."'],
          ['col_pacote_repasse',  'Coluna "Repasse"'],
        ],
      },
      {
        titulo: 'Colunas da aba Impressos',
        descricao: 'Cabeçalhos da tabela quando a aba Impressos está selecionada.',
        chaves: [
          ['col_impresso_data',     'Coluna "Data"'],
          ['col_impresso_admissao', 'Coluna "Admissão"'],
          ['col_impresso_paciente', 'Coluna "Paciente"'],
          ['col_impresso_medico',   'Coluna "Médico"'],
          ['col_impresso_exame',    'Coluna "Exame"'],
          ['col_impresso_valor',    'Coluna "Valor"'],
        ],
      },
      {
        titulo: 'Colunas da aba Externo',
        descricao: 'Cabeçalhos da tabela agrupada por médico → exame.',
        chaves: [
          ['col_externo_medico',    'Coluna "Médico"'],
          ['col_externo_adm_exame', 'Coluna "Admissão / Exame"'],
          ['col_externo_pac_obs',   'Coluna "Paciente / Observação"'],
          ['col_externo_qtd',       'Coluna "Qtd"'],
          ['col_externo_valor',     'Coluna "Valor"'],
        ],
      },
      {
        titulo: 'Regras de classificação',
        descricao: 'Rótulos que aparecem nas linhas com status especial (LANÇAR, PARTICULAR).',
        chaves: [
          ['status_pendente',   'Badge "LANÇAR" (linhas pendentes)'],
          ['status_particular', 'Badge "PARTICULAR" (linhas particulares)'],
        ],
      },
    ];

    const algumModificado = SECOES.some(s =>
      s.chaves.some(([k]) => (cfg['ROT_' + k] != null && cfg['ROT_' + k] !== ''))
    );

    return `
      <div class="laudos-ajuste-cabecalho">
        <div>
          <h3>Personalização de rótulos</h3>
          <p class="muted">Renomeie como os <strong>cabeçalhos de coluna</strong>, <strong>nomes de abas</strong> e
            <strong>rótulos de regras</strong> aparecem na matriz principal. Deixe vazio pra usar o nome padrão.
            As mudanças aparecem na hora ao salvar.</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-pequeno" id="btn-salvar-todos-rotulos">💾 Salvar tudo</button>
          ${algumModificado
            ? `<button class="btn btn-pequeno btn-perigo" id="btn-restaurar-rotulos">↺ Restaurar padrões</button>`
            : ''}
        </div>
      </div>

      ${SECOES.map(secao => `
        <div class="laudos-pers-secao">
          <div class="laudos-pers-secao-head">
            <h4>${escapeHTML(secao.titulo)}</h4>
            <p class="muted">${escapeHTML(secao.descricao)}</p>
          </div>
          <div class="laudos-pers-grade">
            ${secao.chaves.map(([chave, rotulo]) => `
              <div class="laudos-pers-campo">
                <label>${escapeHTML(rotulo)}</label>
                <div class="laudos-pers-input-wrap">
                  <input type="text"
                         class="laudos-pers-input"
                         data-rot-chave="${escapeHTML(chave)}"
                         value="${escapeHTML(valorAtual(chave))}"
                         placeholder="${escapeHTML(LABELS_PADRAO[chave])}"
                         autocomplete="off">
                  <span class="laudos-pers-padrao" title="Valor padrão">${escapeHTML(LABELS_PADRAO[chave])}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    `;
  }

  // Sub-aba: CONFIG — configurações gerais
  function renderAjustesConfig() {
    const cfg = lerConfig();
    // V131.62: gestão de competências importadas (vinda do antigo módulo "Importar Laudos")
    const comps = Banco.query(`
      SELECT competencia,
             COUNT(*) AS qtd_linhas,
             SUM(CASE WHEN categoria='PACOTE'   THEN 1 ELSE 0 END) AS qtd_pacote,
             SUM(CASE WHEN categoria='IMPRESSO' THEN 1 ELSE 0 END) AS qtd_impresso,
             SUM(CASE WHEN categoria='EXTERNO'  THEN 1 ELSE 0 END) AS qtd_externo,
             SUM(valor_repasse) AS total_valor,
             SUM(pendente) AS qtd_pendentes,
             MAX(importado_em) AS importada_em
        FROM laudos
       GROUP BY competencia
       ORDER BY competencia DESC
    `) || [];
    return `
      <div class="laudos-ajuste-cabecalho">
        <h3>Configurações</h3>
      </div>
      <div class="laudos-config-itens">
        <label class="laudos-config-item">
          <input type="checkbox" id="cfg-ocultar-repasse" ${cfg.OCULTAR_REPASSE === '1' ? 'checked' : ''}>
          <div>
            <strong>Ocultar coluna de Repasse</strong>
            <div class="muted">Esconde a coluna de valores na matriz (útil pra apresentações).</div>
          </div>
        </label>
      </div>

      <!-- V131.62: Competências importadas (substitui o antigo módulo Importar Laudos) -->
      <div class="laudos-config-comps">
        <h4>Planilhas importadas</h4>
        <p class="muted" style="font-size:12px;margin:0 0 10px">
          Cada importação grava os laudos de uma competência. Reimportar a mesma competência substitui os dados.
        </p>
        ${comps.length === 0 ? `
          <div class="muted" style="font-size:12px;font-style:italic">Nenhuma planilha importada ainda.</div>
        ` : `
          <table class="laudos-ajuste-tabela">
            <thead>
              <tr>
                <th>Competência</th>
                <th class="num">Pacote</th>
                <th class="num">Impresso</th>
                <th class="num">Externo</th>
                <th class="num">Total</th>
                <th class="num">Pend.</th>
                <th class="num">Valor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${comps.map(c => `
                <tr>
                  <td style="font-weight:600;font-family:var(--font-mono)">${formatarCompetencia(c.competencia)}</td>
                  <td class="num mono">${c.qtd_pacote}</td>
                  <td class="num mono">${c.qtd_impresso}</td>
                  <td class="num mono">${c.qtd_externo}</td>
                  <td class="num mono"><strong>${c.qtd_linhas}</strong></td>
                  <td class="num mono">${c.qtd_pendentes > 0 ? `<span style="color:#C24A1F;font-weight:700">${c.qtd_pendentes}</span>` : '—'}</td>
                  <td class="num mono atlas-rep"><strong>R$ ${Utilidades.formatarNumero(c.total_valor, 2)}</strong></td><!-- V962 -->
                  <td style="text-align:right">
                    <button class="btn-acao-mini btn-acao-perigo btn-excluir-comp-laudo" data-comp="${c.competencia}" title="Excluir esta competência">✕</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>

      <div class="laudos-zona-perigo">
        <h4>Zona de perigo</h4>
        <p class="muted">Apaga TODOS os laudos do banco (de todas as competências).</p>
        <button class="btn btn-perigo" id="btn-apagar-tudo-laudos">🗑 Apagar todos os laudos</button>
      </div>
    `;
  }

  function lerConfig() {
    const rows = Banco.query('SELECT chave, valor FROM config_laudos');
    const obj = {};
    for (const r of rows) obj[r.chave] = r.valor;
    return obj;
  }

  function formatarCompetencia(comp) {
    if (!comp) return '—';
    const [ano, mes] = comp.split('-');
    const nomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return `${nomes[Number(mes) - 1] || mes}/${ano.slice(2)}`;
  }

  function formatarDataAjuste(iso) {
    if (!iso) return '—';
    const d = new Date(iso.replace(' ', 'T'));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('pt-BR');
  }

  // ─── HANDLERS ─────────────────────────────────────────────────────────
  function bindHandlers() {
    const $ = (id) => document.getElementById(id);

    // V732: fileira de filtros 20C (Mês/Ano/combos viraram células)
    bindBarraFiltrosLaud20C();

    document.querySelectorAll('[data-aba]').forEach(b => {
      b.addEventListener('click', () => {
        state.aba = b.dataset.aba;
        renderizar();
      });
    });

    const btnLimpar = $('laudos-btn-limpar');
    if (btnLimpar) btnLimpar.addEventListener('click', () => {
      state.filtros = { admissao: '', paciente: '', medico: '', exame: '' };
      state.sbAberto = null;
      renderizar();
    });

    // ── BOTÃO AJUSTES ──
    const btnAjustes = $('laudos-btn-ajustes');
    if (btnAjustes) btnAjustes.addEventListener('click', () => {
      state.ajustesAberto = !state.ajustesAberto;
      renderizar();
    });

    // ⓘ Botão Info (V128.4)
    const btnLaudosInfo = $('laudos-btn-info');
    if (btnLaudosInfo) btnLaudosInfo.addEventListener('click', () => {
      state.infoAberto = !state.infoAberto;
      renderizar();
    });
    const btnLaudosInfoClose = $('laudos-info-close');
    if (btnLaudosInfoClose) btnLaudosInfoClose.addEventListener('click', () => {
      state.infoAberto = false;
      renderizar();
    });

    // ── BOTÃO IMPORTAR (inline, sem sair da tela) ──
    const btnImportar = $('laudos-btn-importar');
    const inpImportar = $('laudos-input-importar');
    if (btnImportar && inpImportar) {
      btnImportar.addEventListener('click', () => inpImportar.click());
      inpImportar.addEventListener('change', async (e) => {
        const arquivo = e.target.files[0];
        if (!arquivo) return;
        await importarRelatorioInline(arquivo);
        e.target.value = '';   // permite reimportar o mesmo arquivo
      });
    }

    // ── DROPDOWN EXPORTAR (V716: popup central no padrão LIO) ──
    const btnExp = $('laudos-btn-exportar');
    if (btnExp) {
      btnExp.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirMenuExportar(btnExp);
      });
    }

    // ── DRILLDOWN EXTERNO ──
    document.querySelectorAll('.laudos-ext-exame-row').forEach(tr => {
      tr.addEventListener('click', (e) => {
        // Ignora cliques em links/botões dentro da linha
        if (e.target.closest('button, input, a')) return;
        const chave = tr.dataset.chave;
        if (state.drilldownExterno.has(chave)) {
          state.drilldownExterno.delete(chave);
        } else {
          state.drilldownExterno.add(chave);
        }
        renderizar();
      });
    });

    // Expandir todos
    const btnExpAll = document.getElementById('laudos-ext-expand-all');
    if (btnExpAll) {
      btnExpAll.addEventListener('click', () => {
        document.querySelectorAll('.laudos-ext-exame-row').forEach(tr => {
          if (tr.dataset.chave) state.drilldownExterno.add(tr.dataset.chave);
        });
        renderizar();
      });
    }

    // Recolher todos
    const btnColAll = document.getElementById('laudos-ext-collapse-all');
    if (btnColAll) {
      btnColAll.addEventListener('click', () => {
        state.drilldownExterno.clear();
        renderizar();
      });
    }

    // ── PAINEL DE AJUSTES ──
    document.querySelectorAll('[data-ajuste-tab]').forEach(b => {
      b.addEventListener('click', () => {
        state.ajustesAba = b.dataset.ajusteTab;
        renderizar();
      });
    });

    // Salvar valor da tabela mestre
    document.querySelectorAll('.btn-salvar-valor').forEach(b => {
      b.addEventListener('click', () => salvarValorExame(b.dataset.exame));
    });
    document.querySelectorAll('.btn-excluir-valor').forEach(b => {
      b.addEventListener('click', () => excluirValorExame(b.dataset.exame));
    });
    const btnAddExame = $('btn-add-exame');
    if (btnAddExame) btnAddExame.addEventListener('click', adicionarExame);

    // Lançar valor em linha pendente
    document.querySelectorAll('.btn-lancar-pendente').forEach(b => {
      b.addEventListener('click', () => lancarValorPendente(Number(b.dataset.id)));
    });

    // Config: ocultar repasse
    const cfgOcultar = $('cfg-ocultar-repasse');
    if (cfgOcultar) cfgOcultar.addEventListener('change', (e) => {
      gravarConfig('OCULTAR_REPASSE', e.target.checked ? '1' : '0');
    });

    const btnApagar = $('btn-apagar-tudo-laudos');
    if (btnApagar) btnApagar.addEventListener('click', apagarTodosLaudos);

    // V131.62: excluir uma competência específica de laudos
    document.querySelectorAll('.btn-excluir-comp-laudo').forEach(b => {
      b.addEventListener('click', () => excluirCompetenciaLaudo(b.dataset.comp));
    });

    // ── PERSONALIZAÇÃO — salvar e restaurar rótulos ──
    const btnSalvarRotulos = $('btn-salvar-todos-rotulos');
    if (btnSalvarRotulos) btnSalvarRotulos.addEventListener('click', salvarTodosRotulos);

    const btnRestaurarRotulos = $('btn-restaurar-rotulos');
    if (btnRestaurarRotulos) btnRestaurarRotulos.addEventListener('click', restaurarTodosRotulos);

    // Permite salvar com Enter em qualquer input de personalização
    document.querySelectorAll('.laudos-pers-input').forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          salvarTodosRotulos();
        }
      });
    });
  }

  // ─── AÇÃO — IMPORTAÇÃO INLINE (botão no header) ──────────────────────
  async function importarRelatorioInline(arquivo) {
    // 1) Modal de competência
    const comp = await Utilidades.modalCompetencia({
      nomeArquivo: arquivo.name,
      titulo: '📅 Importar relatório de Laudos',
      aviso: 'Reimportar a mesma competência <strong>substitui</strong> os dados anteriores (não duplica).',
    });
    if (!comp) return;

    // 2) Processamento
    Utilidades.mostrarLoading('Importando laudos...');
    try {
      const rel = await ImportadorLaudos.importar(arquivo, comp);
      Utilidades.esconderLoading();

      const formatCompShort = (c) => {
        const [a, m] = c.split('-');
        const nomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        return `${nomes[Number(m) - 1] || m}/${a}`;
      };

      let aviso = '';
      if (rel.pendencias > 0) aviso += `\n\n⚠ ${rel.pendencias} linha(s) marcadas como pendentes.`;
      if (rel.particulares > 0) aviso += `\n• ${rel.particulares} linha(s) marcadas como PARTICULAR.`;

      alert(
        `✓ Importação concluída!\n\n` +
        `Competência: ${formatCompShort(rel.competencia)}\n\n` +
        `Pacote:    ${rel.por_categoria.PACOTE} laudos\n` +
        `Impressos: ${rel.por_categoria.IMPRESSO} laudos\n` +
        `Externos:  ${rel.por_categoria.EXTERNO} laudos\n\n` +
        `Total: ${rel.total} linhas\n` +
        `Valor total: R$ ${Utilidades.formatarNumero(rel.total_valor, 2)}` +
        aviso
      );

      await Banco.salvar();

      // Após importar, posiciona o fichário na competência recém-importada
      const [a, m] = rel.competencia.split('-');
      state.ano = a;
      state.mes = m;
      state._jaAnimou = false;   // re-anima a entrada com os novos dados
      renderizar();
    } catch (e) {
      Utilidades.esconderLoading();
      console.error(e);
      alert('Erro na importação:\n\n' + e.message);
    }
  }

  // ─── AÇÕES — TABELA DE PREÇOS ─────────────────────────────────────────
  async function salvarValorExame(exame) {
    const linha = document.querySelector(`tr[data-exame="${CSS.escape(exame)}"]`);
    if (!linha) return;
    const conv = Number(linha.querySelector('[data-campo="valor_convenio"]').value) || 0;
    const part = Number(linha.querySelector('[data-campo="valor_particular"]').value) || 0;

    try {
      Banco.executar(`
        UPDATE laudos_valores
        SET valor_convenio = ?, valor_particular = ?, atualizado_em = CURRENT_TIMESTAMP
        WHERE exame = ?
      `, [conv, part, exame]);
      await Banco.salvar();
      Utilidades.toast ? Utilidades.toast(`✓ ${exame} salvo`) : flashTemp(linha);
      renderizar();
    } catch (e) {
      alert('Erro ao salvar: ' + e.message);
    }
  }

  function flashTemp(linha) {
    linha.style.transition = 'background 220ms';
    linha.style.background = '#E1F5EE';
    setTimeout(() => { linha.style.background = ''; }, 800);
  }

  async function excluirValorExame(exame) {
    if (!confirm(`Excluir o exame "${exame}" da tabela mestre?`)) return;
    try {
      Banco.executar(`DELETE FROM laudos_valores WHERE exame = ?`, [exame]);
      await Banco.salvar();
      renderizar();
    } catch (e) {
      alert('Erro ao excluir: ' + e.message);
    }
  }

  async function adicionarExame() {
    const nome = prompt('Nome do novo exame (caixa alta sugerida):');
    if (!nome) return;
    const conv = Number(prompt('Valor convênio (R$):', '0')) || 0;
    const part = Number(prompt('Valor particular (R$):', String(conv))) || conv;
    try {
      Banco.executar(`
        INSERT OR REPLACE INTO laudos_valores (exame, valor_convenio, valor_particular, atualizado_em)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `, [nome.trim().toUpperCase(), conv, part]);
      await Banco.salvar();
      renderizar();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  }

  // ─── AÇÕES — PENDENTES ────────────────────────────────────────────────
  async function lancarValorPendente(id) {
    const linha = document.querySelector(`tr[data-id="${id}"]`);
    if (!linha) return;
    const valorInp = linha.querySelector('[data-campo="valor_repasse"]');
    const valor = Number(valorInp.value);
    if (!Number.isFinite(valor) || valor < 0) {
      alert('Informe um valor válido (≥ 0).');
      return;
    }
    if (!confirm(`Lançar R$ ${Utilidades.formatarNumero(valor, 2)} nesse laudo?\nIsso vai remover a flag de pendência.`)) return;   // V944
    try {
      Banco.executar(`
        UPDATE laudos
        SET valor_repasse = ?, pendente = 0
        WHERE id = ?
      `, [valor, id]);
      await Banco.salvar();
      renderizar();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  }

  // ─── AÇÕES — CONFIG ───────────────────────────────────────────────────
  async function gravarConfig(chave, valor) {
    try {
      Banco.executar(`
        INSERT OR REPLACE INTO config_laudos (chave, valor) VALUES (?, ?)
      `, [chave, valor]);
      await Banco.salvar();
    } catch (e) {
      alert('Erro ao salvar config: ' + e.message);
    }
  }

  // ─── AÇÕES — PERSONALIZAÇÃO DE RÓTULOS ────────────────────────────────
  async function salvarTodosRotulos() {
    const inputs = document.querySelectorAll('.laudos-pers-input');
    if (inputs.length === 0) return;

    try {
      Banco.db.exec('BEGIN');
      inputs.forEach(inp => {
        const chave = inp.dataset.rotChave;
        const valor = inp.value.trim();
        if (valor === '') {
          // Vazio = remove customização (volta pro padrão)
          Banco.executar('DELETE FROM config_laudos WHERE chave = ?', ['ROT_' + chave]);
        } else {
          Banco.executar(`
            INSERT OR REPLACE INTO config_laudos (chave, valor) VALUES (?, ?)
          `, ['ROT_' + chave, valor]);
        }
      });
      Banco.db.exec('COMMIT');
      await Banco.salvar();
      invalidarRotulos();
      renderizar();
      // Feedback visual rápido no botão
      const btn = document.getElementById('btn-salvar-todos-rotulos');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✓ Salvo!';
        btn.style.background = 'rgba(15, 110, 86, 0.12)';
        btn.style.borderColor = '#0F6E56';
        btn.style.color = '#0F6E56';
        setTimeout(() => {
          btn.textContent = orig;
          btn.style.background = '';
          btn.style.borderColor = '';
          btn.style.color = '';
        }, 1400);
      }
    } catch (e) {
      Banco.db.exec('ROLLBACK');
      alert('Erro ao salvar rótulos: ' + e.message);
    }
  }

  async function restaurarTodosRotulos() {
    if (!confirm('Restaurar TODOS os rótulos aos valores padrão?\nIsso vai apagar todas as suas personalizações de nomes.')) return;
    try {
      Banco.executar(`DELETE FROM config_laudos WHERE chave LIKE 'ROT_%'`);
      await Banco.salvar();
      invalidarRotulos();
      renderizar();
    } catch (e) {
      alert('Erro ao restaurar: ' + e.message);
    }
  }

  // V131.62: exclui só a competência escolhida (vindo da gestão na aba Configurações)
  async function excluirCompetenciaLaudo(comp) {
    if (!comp) return;
    if (!confirm(`Excluir TODOS os laudos da competência ${formatarCompetencia(comp)}?\n\nEssa ação não pode ser desfeita.`)) return;
    try {
      Banco.executar('DELETE FROM laudos WHERE competencia = ?', [comp]);
      await Banco.salvar();
      renderizar();
    } catch (e) {
      alert('Erro ao excluir: ' + e.message);
    }
  }

  async function apagarTodosLaudos() {
    const total = Banco.query('SELECT COUNT(*) AS n FROM laudos')[0]?.n || 0;
    if (!confirm(`⚠ ATENÇÃO\n\nIsso vai APAGAR todos os ${total} laudos de TODAS as competências.\n\nEssa ação não pode ser desfeita. Continuar?`)) return;
    if (!confirm(`Tem certeza absoluta? Os dados serão perdidos.`)) return;
    try {
      Banco.executar('DELETE FROM laudos');
      await Banco.salvar();
      state.ajustesAberto = false;
      renderizar();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  }

  // ─── EXPORTAÇÃO EXCEL ─────────────────────────────────────────────────
  function exportarExcel(modo) {
    const todos = carregarLaudos();
    const filtrados = aplicarFiltros(todos);
    const periodo = state.mes && state.ano ? `${state.ano}-${state.mes}` : (state.ano || 'todos');
    const nomeArq = `laudos_${periodo}_${modo}.xlsx`;

    const wb = XLSX.utils.book_new();

    if (modo === 'aba_atual') {
      const linhas = filtrados.filter(l => l.categoria === state.aba);
      _addSheet(wb, capitalizar(state.aba), linhasParaSheet(linhas, state.aba));
    }
    else if (modo === 'todas') {
      _addSheet(wb, 'Pacote',    linhasParaSheet(filtrados.filter(l => l.categoria === 'PACOTE'),   'PACOTE'));
      _addSheet(wb, 'Impressos', linhasParaSheet(filtrados.filter(l => l.categoria === 'IMPRESSO'), 'IMPRESSO'));
      _addSheet(wb, 'Externo',   linhasParaSheet(filtrados.filter(l => l.categoria === 'EXTERNO'),  'EXTERNO'));
    }
    else if (modo === 'pendentes') {
      const linhas = filtrados.filter(l => l.pendente);
      if (linhas.length === 0) { alert('Nenhuma linha pendente nos filtros atuais.'); return; }
      _addSheet(wb, 'Pendências', linhasParaSheet(linhas, 'TUDO'));
    }
    else if (modo === 'particulares') {
      const linhas = filtrados.filter(l => l.particular);
      if (linhas.length === 0) { alert('Nenhuma linha PARTICULAR nos filtros atuais.'); return; }
      _addSheet(wb, 'Particulares', linhasParaSheet(linhas, 'TUDO'));
    }
    else if (modo === 'por_medico') {
      // 1 aba por médico
      const porMed = {};
      for (const l of filtrados) {
        const m = l.medico || '(sem médico)';
        if (!porMed[m]) porMed[m] = [];
        porMed[m].push(l);
      }
      const ordenados = Object.keys(porMed).sort();
      if (ordenados.length === 0) { alert('Sem linhas pra exportar.'); return; }
      for (const m of ordenados) {
        // Nome da aba: limita 31 chars (limite XLSX) e remove caracteres inválidos
        const nomeAba = m.replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31);
        _addSheet(wb, nomeAba, linhasParaSheet(porMed[m], 'TUDO'));
      }
    }

    XLSX.writeFile(wb, nomeArq);
  }

  function capitalizar(s) {
    if (!s) return '';
    return s.charAt(0) + s.slice(1).toLowerCase();
  }

  // Converte linhas em AoA (array de arrays) com cabeçalho apropriado
  function linhasParaSheet(linhas, categoriaForcada) {
    // Se categoria é 'TUDO', usa cabeçalho unificado
    if (categoriaForcada === 'TUDO') {
      const head = ['Competência', 'Categoria', 'Admissão', 'Data', 'Paciente',
                    'Médico', 'Exame', 'Unidade', 'Convênio', 'Qtd', 'Unitário',
                    'Valor Repasse', 'Observação', 'Status'];
      const rows = linhas.map(l => [
        l.competencia, l.categoria,
        l.admissao || '', l.data_admissao || '', l.paciente || '',
        l.medico || '', l.exame || l.modulo || '',
        l.unidade || '', l.convenio || '',
        l.quantidade || 1, l.valor_unitario || '',
        Number(l.valor_repasse) || 0,
        l.observacao || '', l.pendente ? 'LANÇAR' : (l.particular ? 'PARTICULAR' : 'OK')
      ]);
      const total = ['', '', '', '', '', '', '', '', '', '', 'TOTAL:',
        linhas.reduce((s, l) => s + (Number(l.valor_repasse) || 0), 0), '', ''];
      return [head, ...rows, total];
    }

    if (categoriaForcada === 'PACOTE') {
      const head = ['Unidade', 'Convênio', 'Médico', 'Exame', 'Qtd', 'Unitário', 'Repasse'];
      const rows = linhas.map(l => [
        l.unidade || '', l.convenio || '', l.medico || '', l.exame || '',
        l.quantidade || 1, l.valor_unitario || '', Number(l.valor_repasse) || 0
      ]);
      const total = ['', '', '', '', '', 'TOTAL:',
        linhas.reduce((s, l) => s + (Number(l.valor_repasse) || 0), 0)];
      return [head, ...rows, total];
    }

    if (categoriaForcada === 'IMPRESSO') {
      const head = ['Data', 'Admissão', 'Cód. Paciente', 'Paciente', 'Médico', 'Módulo', 'Valor', 'Status'];
      const rows = linhas.map(l => [
        l.data_admissao || '', l.admissao || '', l.cod_paciente || '',
        l.paciente || '', l.medico || '', l.modulo || l.exame || '',
        l.pendente ? 'LANÇAR' : (Number(l.valor_repasse) || 0),
        l.pendente ? 'PENDENTE' : 'OK'
      ]);
      const total = ['', '', '', '', '', 'TOTAL:',
        linhas.filter(l => !l.pendente).reduce((s, l) => s + (Number(l.valor_repasse) || 0), 0), ''];
      return [head, ...rows, total];
    }

    if (categoriaForcada === 'EXTERNO') {
      const head = ['Admissão', 'Paciente', 'Exame', 'Médico', 'Valor', 'Observação'];
      const rows = linhas.map(l => [
        l.admissao || '', l.paciente || '', l.exame || '', l.medico || '',
        Number(l.valor_repasse) || 0, l.observacao || ''
      ]);
      const total = ['', '', '', 'TOTAL:',
        linhas.reduce((s, l) => s + (Number(l.valor_repasse) || 0), 0), ''];
      return [head, ...rows, total];
    }
  }

  function _addSheet(wb, nome, aoa) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Larguras de coluna sugeridas (proporcional ao header)
    if (aoa[0]) {
      ws['!cols'] = aoa[0].map(h => ({ wch: Math.max(12, String(h).length + 2) }));
    }
    XLSX.utils.book_append_sheet(wb, ws, nome);
  }

  // ─── CSS ──────────────────────────────────────────────────────────────
  function cssLaudos() {
    return `
      .laudos-tela {
        position: relative;
        z-index: 1;
        padding: 14px 22px 22px;
      }

      .laudos-page-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 14px;
        margin-bottom: 18px;
        padding-bottom: 0;
        border-bottom: none;
      }
      .laudos-page-header-esq { flex: 1; min-width: 0; }
      .laudos-page-header-dir {
        display: flex; align-items: center; gap: 8px;
      }
      .laudos-titulo-wrap {
        display: flex; align-items: center; gap: 10px;
      }
      .laudos-titulo {
        font-family: var(--font-display);
        font-weight: 500;
        font-size: 26px;
        letter-spacing: 0.02em;
        margin: 0;
        color: var(--ink);
      }

      /* V732: virou o CONTÊINER da peça 20C (.laud-sb) + botão "✕ Limpar
         filtros" — os selects/combos antigos saíram junto com o grid */
      .laudos-filtros-bar {
        display: flex;
        flex-direction: column;
        gap: 6px;
        align-items: stretch;   /* a peça 20C estica de ponta a ponta */
        margin-top: 10px;
        margin-bottom: 14px;    /* respiro antes dos KPIs/tabela */
        width: 100%;
        box-sizing: border-box;
        position: relative;
        z-index: 50;
      }
      .laudos-filtros-bar > .btn-limpar-filtros { align-self: flex-start; }

      /* ── V732: fileira de filtros 20C (padrão do LIO, prefixo laud-sb) ── */
      .laud-sb {
        position: relative; z-index: 30;
        display: flex; align-items: stretch;
        padding: 6px;
        background: #fff;
        border: 1px solid #e4ecf4;
        border-radius: 12px;
        box-shadow: 0 1px 2px rgba(20, 51, 82,.04), 0 10px 26px -20px rgba(20, 51, 82,.26);
        flex-wrap: wrap;
      }
      .laud-sb-celwrap { position: relative; min-width: 150px; display: flex; }
      .laud-sb-celwrap:not(:last-child) .laud-sb-cel { border-right: 1px solid #f0f4f8; }
      .laud-sb-cel {
        flex: 1; min-width: 0;
        display: flex; align-items: center; gap: 9px;
        padding: 9px 12px; border: none; border-radius: 9px;
        background: transparent; cursor: pointer;
        font-family: inherit; text-align: left;
        transition: background-color 120ms;
      }
      .laud-sb-cel:hover, .laud-sb-cel.ativo, .laud-sb-cel.aberta { background: #f6f4ef; }
      .laud-sb-cel:focus-visible { outline: 2px solid #2a5a8c; outline-offset: 2px; }
      .laud-sb-tile {
        width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        background: #f0f5f9; color: #5a6879;
      }
      .laud-sb-cel.ativo .laud-sb-tile, .laud-sb-cel.aberta .laud-sb-tile { background: #e4ecf4; color: #1d4470; }
      .laud-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
      .laud-sb-rot {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .09em; color: #5a6879; white-space: nowrap;
      }
      .laud-sb-val {
        font-size: 13px; font-weight: 500; color: #5a6879;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .laud-sb-cel.ativo .laud-sb-val { font-weight: 700; color: #12304f; }
      .laud-sb-chev { color: #96a2b1; flex-shrink: 0; display: flex; transition: transform 140ms; }
      .laud-sb-cel.aberta .laud-sb-chev { transform: rotate(180deg); }

      /* painel ancorado na célula, por cima dos KPIs */
      .laud-sb-painel {
        position: absolute; top: 100%; left: 0; margin-top: 6px; z-index: 40;
        min-width: 100%; width: max-content; max-width: 340px;
        background: #fff; border: 1px solid #dfe4ea; border-radius: 12px;
        box-shadow: 0 18px 44px -14px rgba(11, 35, 64,.42);
        overflow: hidden;
      }
      .laud-sb-buscabox {
        display: flex; align-items: center; gap: 8px;
        padding: 11px 12px 10px; border-bottom: 1px solid #f0f4f8;
      }
      .laud-sb-buscabox .laud-sb-busca-ic { color: #6b7d8e; display: flex; }
      .laud-sb-busca {
        flex: 1; height: 30px; border: 1px solid #dfe4ea; border-radius: 8px;
        background: #f6f4ef; padding: 0 10px; font-size: 13px;
        font-family: inherit; color: #12304f; outline: none;
      }
      .laud-sb-busca::placeholder { color: #96a2b1; }
      .laud-sb-busca:focus { border-color: #2a5a8c; }
      .laud-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; }
      .laud-sb-lista::-webkit-scrollbar { width: 8px; }
      .laud-sb-lista::-webkit-scrollbar-track { background: #f0f4f8; }
      .laud-sb-lista::-webkit-scrollbar-thumb { background: #c5d5e5; border-radius: 4px; }
      .laud-sb-it {
        display: flex; align-items: center; gap: 10px;
        height: 38px; padding: 0 8px; border-radius: 8px; cursor: pointer;
        font-size: 13px; color: #12304f;
      }
      .laud-sb-it:hover, .laud-sb-it.foco { background: #f0f4f8; }
      .laud-sb-it.sel { background: #f0f4f8; font-weight: 700; }
      .laud-sb-it-todos { font-weight: 700; }
      .laud-sb-it-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .laud-sb-ck { color: #1d4470; display: flex; }
      .laud-sb-chip {
        width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        background: #f0f4f8; color: #1d4470; font-size: 9.5px; font-weight: 700;
      }
      .laud-sb-rodape {
        padding: 7px 12px; border-top: 1px solid #f0f4f8;
        font-size: 10.5px; font-weight: 600; color: #96a2b1;
      }
      @media (max-width: 1280px) { .laud-sb-celwrap { flex-basis: 32%; } }
      @media (max-width: 900px)  { .laud-sb-celwrap { flex-basis: 48%; } }

      .btn-limpar-filtros {
        height: 34px;
        padding: 0 12px;
        background: transparent;
        border: 1px solid var(--border);
        border-radius: 7px;
        font-size: 11.5px;
        color: var(--ink-soft);
        cursor: pointer;
        font-family: inherit;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .btn-limpar-filtros:hover {
        background: rgba(194, 74, 31, 0.06);
        border-color: #C24A1F;
        color: #C24A1F;
      }
      .laudos-btn-exportar {
        height: 34px;
        padding: 0 14px;
        font-size: 12px;
        font-weight: 700;
      }

      .laudos-btn-importar {
        height: 34px;
        padding: 0 14px;
        font-size: 12px;
        font-weight: 700;
        background: var(--primary);
        color: white;
        border: 1px solid var(--primary);
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .laudos-btn-importar:hover {
        background: var(--primary-hover);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(20, 51, 82, 0.20);
      }
      .laudos-btn-importar:active {
        transform: translateY(0);
      }

      .laudos-exportar-wrap {
        position: relative;
        display: inline-block;
      }
      /* V716: menu de exportar agora é o padrão central (.atlas-menu-exp) */

      .laudos-btn-ajustes {
        height: 34px;
        padding: 0 14px;
        font-size: 12px;
        font-weight: 700;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        color: var(--ink);
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .laudos-btn-ajustes:hover {
        background: var(--accent-soft);
        border-color: var(--accent);
      }
      .laudos-btn-ajustes-ativo {
        background: var(--primary);
        color: white;
        border-color: var(--primary);
      }
      .laudos-btn-ajustes-ativo:hover {
        background: var(--primary-hover);
      }

      /* ── KPIs ── */
      .laudos-kpis {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 14px;
        margin-bottom: 14px;
      }
      .laudos-kpi {
        border-radius: 12px;
        padding: 12px 16px;
        position: relative;
        overflow: hidden;
        border: 1px solid transparent;
        height: 100px;
        display: flex;
        flex-direction: column;
        gap: 3px;
        box-sizing: border-box;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .laudos-kpi:hover {
        box-shadow: 0 6px 16px rgba(11, 35, 64,0.14);
        transform: translateY(-2px);
      }
      .laudos-kpi-faixa {
        position: absolute; top: 0; right: 0; bottom: 0; width: 5px;
      }
      .laudos-kpi-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 4px;
        color: #0f1d2e; /* V849: título dos cards totalizadores */
      }
      .laudos-kpi-valor {
        font-size: 24px;
        font-weight: 800;
        line-height: 1.1;
        letter-spacing: -0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .laudos-kpi-sub {
        font-size: 10.5px;
        margin-top: auto;
        font-weight: 600;
      }
      .laudos-kpi-verde {
        background: linear-gradient(135deg, #E1F5EE 0%, #C5E8DC 100%);
        color: #0F6E56;
      }
      .laudos-kpi-verde .laudos-kpi-faixa { background: #143352; }
      .laudos-kpi-verde .laudos-kpi-valor { color: var(--ink); }

      .laudos-kpi-bege {
        background: linear-gradient(135deg, #e4ecf4 0%, #F5D9A6 100%);
        color: #143352;
      }
      .laudos-kpi-bege .laudos-kpi-faixa { background: #2a5a8c; }
      .laudos-kpi-bege .laudos-kpi-valor { color: var(--ink); }

      .laudos-kpi-roxo {
        background: linear-gradient(135deg, #EEEDFE 0%, #D5D2F5 100%);
        color: #3C3489;
      }
      .laudos-kpi-roxo .laudos-kpi-faixa { background: #534AB7; }
      .laudos-kpi-roxo .laudos-kpi-valor { color: var(--ink); }

      .laudos-kpi-destaque {
        background: linear-gradient(135deg, #143352 0%, #0F2925 100%);
        color: #D9B475;
      }
      .laudos-kpi-destaque .laudos-kpi-faixa { background: #2a5a8c; }
      .laudos-kpi-destaque .laudos-kpi-valor { color: #143352; }
      .laudos-kpi-destaque .laudos-kpi-sub { color: #D9B475; }

      /* ── ABAS estilo botão sólido ── */
      .laudos-abas {
        display: flex;
        gap: 8px;
        margin: 0 0 8px 0;
        align-items: center;
      }
      .laudos-aba {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 10px 22px;
        border: 1px solid var(--border);
        background: var(--bg-elevated);
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.05em;
        color: var(--ink-faint);
        border-radius: 8px;
        min-height: 40px;
        transition: background-color 180ms cubic-bezier(0.4, 0, 0.2, 1), color 180ms cubic-bezier(0.4, 0, 0.2, 1), border-color 180ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 180ms cubic-bezier(0.4, 0, 0.2, 1), transform 180ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 1px 2px rgba(11, 35, 64,0.04);
      }
      .laudos-aba:hover:not(.laudos-aba-ativa) {
        background: var(--bg-sunken);
        border-color: var(--accent);
        color: var(--ink);
        transform: translateY(-1px);
      }
      .laudos-aba-ativa {
        background: var(--primary);
        color: white;
        border-color: var(--primary);
        box-shadow: 0 3px 10px rgba(20, 51, 82, 0.28);
      }
      .laudos-aba-bullet {
        width: 9px; height: 9px; border-radius: 50%;
        flex-shrink: 0; opacity: 0.7;
        transition: background-color 180ms, color 180ms, border-color 180ms, box-shadow 180ms, transform 180ms, opacity 180ms;
      }
      .laudos-aba-ativa .laudos-aba-bullet {
        background: var(--accent) !important;
        opacity: 1;
        box-shadow: 0 0 0 3px rgba(255,255,255,0.20);
      }
      .laudos-aba-label { text-transform: uppercase; }
      .laudos-aba-badge {
        background: var(--bg-sunken);
        color: var(--ink-faint);
        font-size: 10.5px;
        padding: 2px 9px;
        border-radius: 999px;
        font-weight: 800;
        font-family: var(--font-mono);
        border: 1px solid var(--border);
      }
      .laudos-aba-ativa .laudos-aba-badge {
        background: rgba(255, 255, 255, 0.22);
        color: white;
        border-color: rgba(255, 255, 255, 0.30);
      }

      /* ── PAINEL e TABELA ── */
      .laudos-painel {
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .laudos-painel-head {
        background: var(--bg-sunken);
        padding: 10px 14px;
        font-size: 12px;
        color: var(--ink-soft);
        border-bottom: 1px solid var(--border);
      }
      .laudos-painel-head strong { color: var(--primary); }

      /* Botões Expandir/Recolher no drilldown EXTERNO */
      .laudos-ext-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .laudos-ext-acoes {
        display: flex;
        gap: 6px;
      }
      .laudos-ext-btn {
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 600;
        color: var(--primary);
        cursor: pointer;
        font-family: inherit;
        letter-spacing: 0.02em;
        transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease, opacity 0.15s ease;
      }
      .laudos-ext-btn:hover {
        background: var(--accent-soft);
        border-color: var(--accent);
        color: var(--primary-hover);
      }

      .laudos-tabela-scroll {
        overflow-y: auto;
        overflow-x: hidden;
        max-height: 60vh;
      }
      .laudos-tabela {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        table-layout: auto;
      }
      .laudos-tela .laudos-tabela thead th {
        background: var(--bg-elevated);
        padding: 12px 14px;
        font-weight: 700;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ink-soft);
        border-bottom: 2px solid var(--border);
        position: sticky;
        top: 0;
        z-index: 2;
        text-align: center !important;
        white-space: nowrap;
      }
      .laudos-tela .laudos-tabela tbody td {
        padding: 11px 14px;
        border-bottom: 1px solid var(--border);
        vertical-align: middle;
        text-align: left !important;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 240px;
      }
      .laudos-tela .laudos-tabela tbody td.num,
      .laudos-tela .laudos-tabela .num {
        text-align: right !important;
      }
      /* V968: zebra PADRÃO da ferramenta (branco + azul var(--bg-sunken) #e4ecf4,
         hover accent-soft — igual ao LIO/V717). Antes era um creme a 45%.
         Nas abas PLANAS (Pacote/Impressos) a zebra é por posição; na aba
         Externo (médico → exame → detalhe) ela é marcada em JS por exame
         (.laudos-zebra), reiniciando a cada médico. */
      .laudos-tabela.laudos-tabela-plana tbody tr:nth-child(even) td,
      .laudos-tabela tbody tr.laudos-zebra td {
        background: var(--bg-sunken, #e4ecf4);
      }
      .laudos-tabela tbody tr:hover td {
        background: var(--accent-soft, #e3efeb) !important;
      }
      .laudos-tabela .mono { font-family: var(--font-mono); font-size: 11.5px; }
      .laudos-tabela .valor-bold { color: var(--primary); font-weight: 700; }
      .laudos-tabela .valor-pendente { color: #C24A1F; }

      /* Linhas com flag PENDENTE */
      .laudos-linha-pendente td {
        background: rgba(194, 74, 31, 0.04) !important;
      }
      .laudos-badge-pendente {
        display: inline-block;
        font-size: 9px;
        font-weight: 800;
        padding: 2px 7px;
        border-radius: 999px;
        background: rgba(194, 74, 31, 0.10);
        color: #C24A1F;
        border: 1px solid rgba(194, 74, 31, 0.35);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      /* Linhas com flag PARTICULAR */
      .laudos-linha-particular td {
        background: rgba(42, 90, 140, 0.05) !important;
      }
      .laudos-badge-particular {
        display: inline-block;
        font-size: 9px;
        font-weight: 800;
        padding: 2px 7px;
        border-radius: 999px;
        background: rgba(42, 90, 140, 0.14);
        color: #143352;
        border: 1px solid rgba(42, 90, 140, 0.40);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .laudos-tabela tfoot td {
        padding: 10px 14px;
        background: var(--bg-sunken);
        border-top: 2px solid var(--border);
        font-size: 11.5px;
        position: sticky;
        bottom: 0;
        white-space: nowrap !important;
      }
      .laudos-total-label {
        text-align: right !important;
        color: var(--ink-soft);
        text-transform: uppercase;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.05em;
      }
      /* V969: no Laudos a linha Total NÃO usa a barra preta global (#071a30,
         style.css V181): fundo branco, rótulo na cor normal e só o valor de
         repasse em #2a5a8c (.atlas-rep). Escopo: só este módulo. */
      .main .laudos-tabela tfoot td,
      .main .laudos-tabela tfoot tr:hover td {
        background: #FFFFFF !important;
        color: var(--ink) !important;
        border-color: var(--border) !important;
        border-top: 2px solid var(--border) !important;
      }
      .main .laudos-tabela tfoot td * { color: var(--ink-soft) !important; }
      .main .laudos-tabela tfoot td.laudos-total-label { color: var(--ink-soft) !important; }
      .main .laudos-tabela tfoot td.atlas-rep,
      .main .laudos-tabela tfoot td.atlas-rep * { color: #2a5a8c !important; }

      /* ───────── DRILLDOWN EXTERNO ───────── */
      .laudos-ext-medico-row td {
        background: #e4ecf4 !important;   /* V968: era o degradê bege #F0EBDF→#E8E0CB */
        border-top: 2px solid var(--accent) !important;
        padding: 13px 14px !important;
        font-size: 13px;
      }
      .laudos-ext-medico-row strong { color: var(--primary); font-size: 14px; }
      /* V969: quantidade e total do médico na cor padrão do repasse (o nome fica) */
      .laudos-ext-medico-row td.atlas-rep strong { color: #2a5a8c; }
      .laudos-ext-mini-stats {
        margin-left: 12px;
        font-size: 11px;
        color: var(--ink-faint);
        font-weight: 500;
      }
      .laudos-ext-exame-row {
        cursor: pointer;
        transition: background 120ms;
      }
      .laudos-ext-exame-row:hover td {
        background: rgba(42, 90, 140, 0.10) !important;
      }
      .laudos-ext-exame-row.aberto td {
        background: var(--accent-soft) !important;
      }
      .laudos-drill-toggle {
        display: inline-block;
        font-size: 13px;
        color: var(--accent);
        font-weight: 800;
        transition: transform 180ms;
      }
      .laudos-ext-nome-medico {
        color: var(--ink-faint);
        font-size: 11px;
      }
      .laudos-ext-nome-exame {
        font-weight: 600;
        color: var(--ink);
      }
      .laudos-ext-chip-qtd {
        background: rgba(42, 90, 140, 0.15);
        color: #2a5a8c;   /* V969: era #143352 — só o texto muda, a pílula fica */
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 10.5px;
        font-weight: 800;
        border: 1px solid rgba(42, 90, 140, 0.35);
      }
      .laudos-ext-detalhe td {
        background: #FFFFFF !important;   /* V968: era o creme rgba(246, 244, 239,.6) */
        font-size: 11px;
        color: var(--ink-soft);
        border-bottom: 1px dashed var(--border) !important;
      }

      /* ───────── PAINEL DE AJUSTES ───────── */
      .laudos-ajustes-painel {
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 12px;
        overflow: hidden;
      }
      .laudos-ajustes-tabs {
        display: flex;
        gap: 0;
        background: var(--bg-sunken);
        border-bottom: 1px solid var(--border);
        padding: 0;
      }
      .laudos-ajuste-tab {
        padding: 14px 22px;
        background: transparent;
        border: none;
        border-bottom: 3px solid transparent;
        cursor: pointer;
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 700;
        color: var(--ink-faint);
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .laudos-ajuste-tab:hover {
        background: var(--bg-elevated);
        color: var(--ink);
      }
      .laudos-ajuste-tab.ativa {
        background: var(--bg-elevated);
        color: var(--primary);
        border-bottom-color: var(--accent);
      }
      .laudos-ajustes-conteudo {
        padding: 20px 24px;
        max-height: 70vh;
        overflow-y: auto;
      }
      .laudos-ajuste-cabecalho {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 18px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--border);
      }
      .laudos-ajuste-cabecalho h3 {
        margin: 0 0 6px;
        font-family: var(--font-display);
        font-weight: 500;
        font-size: 17px;
        color: var(--ink);
      }
      .laudos-ajuste-cabecalho p {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        max-width: 580px;
      }

      .laudos-ajuste-tabela {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .laudos-ajuste-tabela thead th {
        text-align: left;
        font-weight: 700;
        font-size: 10.5px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ink-soft);
        padding: 10px 12px;
        border-bottom: 2px solid var(--border);
        background: var(--bg);
      }
      .laudos-ajuste-tabela thead th.num { text-align: right; }
      .laudos-ajuste-tabela tbody td {
        padding: 8px 12px;
        border-bottom: 1px solid var(--border);
        vertical-align: middle;
      }
      .laudos-ajuste-tabela tbody td.num { text-align: right; }
      .laudos-ajuste-tabela tbody tr:hover td { background: rgba(246, 244, 239, 0.5); }

      .laudos-ajuste-input {
        padding: 6px 10px;
        font-size: 12.5px;
        font-weight: 600;
        border: 1px solid var(--accent);
        border-radius: 6px;
        background: white;
        color: var(--primary);
        outline: none;
        width: 110px;
        text-align: right;
        font-family: var(--font-mono);
      }
      .laudos-ajuste-input:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(20, 51, 82, 0.10);
      }

      .btn-acao-mini {
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 700;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--primary);
        cursor: pointer;
        font-family: inherit;
        margin-left: 4px;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
      }
      .btn-acao-mini:hover {
        background: var(--accent-soft);
        border-color: var(--accent);
      }
      .btn-acao-perigo {
        color: #C24A1F;
      }
      .btn-acao-perigo:hover {
        background: rgba(194, 74, 31, 0.08);
        border-color: #C24A1F;
      }

      .laudos-tag-cat {
        display: inline-block;
        font-size: 9px;
        font-weight: 800;
        padding: 2px 7px;
        border-radius: 999px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .laudos-tag-pacote {
        background: rgba(42, 90, 140, 0.14);
        color: #143352;
        border: 1px solid rgba(42, 90, 140, 0.35);
      }
      .laudos-tag-impresso {
        background: rgba(20, 51, 82, 0.10);
        color: var(--primary);
        border: 1px solid rgba(20, 51, 82, 0.30);
      }
      .laudos-tag-externo {
        background: rgba(83, 74, 183, 0.10);
        color: #3C3489;
        border: 1px solid rgba(83, 74, 183, 0.30);
      }

      .laudos-ajuste-vazio {
        text-align: center;
        padding: 60px 20px;
        color: var(--ink-faint);
      }
      .laudos-ajuste-vazio h3 {
        margin: 12px 0 6px;
        color: var(--primary);
        font-family: var(--font-display);
        font-weight: 500;
      }

      .laudos-config-itens {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 24px;
      }
      .laudos-config-item {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 14px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        cursor: pointer;
      }
      .laudos-config-item input { margin-top: 2px; flex-shrink: 0; }
      .laudos-config-item strong { display: block; margin-bottom: 4px; font-size: 13px; }
      .laudos-config-item .muted { font-size: 11.5px; line-height: 1.5; }

      .laudos-config-comps {
        margin-top: 24px;
      }
      .laudos-config-comps h4 {
        margin: 0 0 4px;
        font-size: 13px;
        color: var(--ink);
      }
      .laudos-zona-perigo {
        margin-top: 30px;
        padding: 16px;
        background: rgba(194, 74, 31, 0.04);
        border: 1px dashed rgba(194, 74, 31, 0.30);
        border-radius: 10px;
      }
      .laudos-zona-perigo h4 {
        margin: 0 0 6px;
        color: #C24A1F;
        font-size: 13px;
      }
      .laudos-zona-perigo p {
        margin: 0 0 12px;
        font-size: 12px;
      }

      /* ───────── PERSONALIZAÇÃO DE RÓTULOS ───────── */
      .laudos-pers-secao {
        margin-top: 22px;
        padding-top: 18px;
        border-top: 1px dashed var(--border);
      }
      .laudos-pers-secao:first-of-type {
        margin-top: 6px;
        padding-top: 0;
        border-top: none;
      }
      .laudos-pers-secao-head {
        margin-bottom: 12px;
      }
      .laudos-pers-secao-head h4 {
        margin: 0 0 4px;
        font-family: var(--font-display);
        font-weight: 500;
        font-size: 14px;
        color: var(--primary);
      }
      .laudos-pers-secao-head p {
        margin: 0;
        font-size: 11.5px;
        line-height: 1.4;
      }
      .laudos-pers-grade {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 12px 18px;
      }
      .laudos-pers-campo {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .laudos-pers-campo label {
        font-size: 11px;
        font-weight: 600;
        color: var(--ink-soft);
      }
      .laudos-pers-input-wrap {
        position: relative;
      }
      .laudos-pers-input {
        width: 100%;
        padding: 7px 11px;
        padding-right: 78px;     /* espaço pro chip do padrão */
        font-size: 12.5px;
        font-weight: 600;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-elevated);
        color: var(--ink);
        outline: none;
        font-family: inherit;
        transition: border-color 150ms, box-shadow 150ms;
        box-sizing: border-box;
      }
      .laudos-pers-input:hover {
        border-color: var(--accent);
      }
      .laudos-pers-input:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(20, 51, 82, 0.12);
      }
      .laudos-pers-padrao {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--ink-faint);
        background: var(--bg-sunken);
        padding: 3px 7px;
        border-radius: 999px;
        border: 1px solid var(--border);
        white-space: nowrap;
        max-width: 70px;
        overflow: hidden;
        text-overflow: ellipsis;
        pointer-events: none;
      }
    `;
  }

  // ───────────────────────────────────────────────────────────────────────
  // BOOTSTRAP
  // ───────────────────────────────────────────────────────────────────────
  if (!state.mes && !state.ano) {
    const { meses, anos } = listarCompetenciasDisponiveis();
    if (anos.length > 0)  state.ano = anos[0];
    if (meses.length > 0) state.mes = meses[meses.length - 1];
  }

  renderizar();
};
