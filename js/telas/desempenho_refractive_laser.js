/**
 * ============================================================================
 * TELA: Desempenho · Refractive Laser
 *
 * Conceito: TAXA SOBRE PROCEDIMENTOS (aluguel do aparelho Refractive Laser)
 *   Proprietária: Dra. Maria Regina Catai Chalita
 *
 *   7 procedimentos elegíveis, agrupados em 2 grandes regras:
 *
 *   EXAMES (A, B) → valor FIXO por linha (ignora QTD)
 *     A. Ceratoscopia          Conv R$ 28,72 / Part R$ 62,50
 *     B. Paquimetria           Conv R$ 23,40 / Part R$ 62,50
 *
 *   CIRÚRGICOS (C, D, E, F, G):
 *     - Convênio: VAL_CIRUR_CONV × QTD_efetiva  (mono=1 / bi=2)
 *     - Particular: PCT_CIRUR_PART × PRODUZIDO da linha
 *
 *   QTD efetiva: se nome do procedimento contém "BINOCULAR" → 2
 *               (independente da coluna QUANTIDADE);
 *               caso contrário usa a coluna QUANTIDADE.
 *
 * Filtros:
 *   - PROCEDIMENTO ∈ lista canônica de sinônimos (mapeada em SINONIMOS_RL)
 *   - PAPEL em (MEDICO, CIRURGIAO) — ignora SOLICITANTE/MEDICO DE LAUDO/INDICANTE
 *   - Vínculo do executante: INTERNO ou HIBRIDO (configurável)
 *
 *   Cada linha elegível paga sua taxa individualmente — a Dra. Maria Regina
 *   recebe a soma de todas as taxas, independente do médico que executou.
 * ============================================================================
 */

App.telas['desempenho-refractive-laser'] = function () {

  // ──────────────────────────────────────────────────────────────────────
  // CONSTANTES — sinônimos dos procedimentos QVIS → categoria canônica
  // ──────────────────────────────────────────────────────────────────────
  // Cada categoria (A-G) tem uma ou mais grafias possíveis no QVIS.
  // Normalização: UPPER, remove espaços múltiplos.
  // Confirmado com o usuário em 18/05/2026.
  const SINONIMOS_RL = {
    A: {  // Ceratoscopia (EXAME)
      label: 'ORBSCAN Ceratoscopia',
      tipo: 'EXAME',
      sinonimos: ['ORBSCAN /SCANSYS CERATOSCOPIA (MONOCULAR)'],
    },
    B: {  // Paquimetria (EXAME)
      label: 'ORBSCAN Paquimetria',
      tipo: 'EXAME',
      sinonimos: ['ORBSCAN /SCANSYS PAQUIMETRIA (MONOCULAR)'],
    },
    C: {  // Fotoablação PRK (CIRÚRGICO)
      label: 'Fotoablação PRK',
      tipo: 'CIRURGICO',
      sinonimos: [
        'FOTOABLACAO DA SUPERFICIE CONVENCIONAL PRK',
        'PACOTE FOTOABLACAO DE SUPERFICIE CONVENCIONAL PRK',
        'PACOTE FOTOABLACAO DA SUPERFICIE CONVENCIONAL',
      ],
    },
    D: {  // Pacote Delaminação LASIK (CIRÚRGICO)
      label: 'Pacote Delaminação LASIK',
      tipo: 'CIRURGICO',
      sinonimos: [
        'PACOTE DELAMINACAO CORNEANA C/FOTOABLACAO ESTROMAL LASIK',
        'PACOTE DELAMINACAO CORNEANA C/FOTOABLACAO ESTROMAL LASIK BINOCULAR',
        'PACOTE DELAMINACAO CORNEANA C/FOTOABLACAO ESTROMAL LASIK OU PRK (ENF)',
      ],
    },
    E: {  // Cirurgia Refrativa LASIK (CIRÚRGICO)
      label: 'Cirurgia Refrativa LASIK',
      tipo: 'CIRURGICO',
      sinonimos: ['CIRURGIA REFRATIVA PERSONALIZADA (LASIK)'],
    },
    F: {  // Cirurgia Refrativa PRK (CIRÚRGICO)
      label: 'Cirurgia Refrativa PRK',
      tipo: 'CIRURGICO',
      sinonimos: ['CIRURGIA REFRATIVA PERSONALIZADA (PRK)'],
    },
    G: {  // Delaminação LASIK (CIRÚRGICO)
      label: 'Delaminação LASIK',
      tipo: 'CIRURGICO',
      sinonimos: ['DELAMINACAO CORNEANA C/ FOTO. ESTROMAL / LASIK'],
    },
  };

  // Normaliza: UPPER, trim, espaços múltiplos → único espaço
  function normalizar(s) {
    if (s == null) return '';
    return String(s).toUpperCase().trim().replace(/\s+/g, ' ');
  }

  // Constrói mapa: proc_norm → categoria (faz match comparando após normalizar)
  const MAPA_SINONIMOS = (() => {
    const m = new Map();
    for (const [cat, info] of Object.entries(SINONIMOS_RL)) {
      for (const sin of info.sinonimos) {
        m.set(normalizar(sin), cat);
      }
    }
    return m;
  })();

  function categorizar(procedimento) {
    return MAPA_SINONIMOS.get(normalizar(procedimento)) || null;
  }

  const MESES_EXTENSO_RL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // ──────────────────────────────────────────────────────────────────────
  // Estado
  // ──────────────────────────────────────────────────────────────────────
  if (window.__rl === undefined) {
    window.__rl = {
      anoSelecionado: null,
      mesSelecionado: null,
      mesPagamentoSelecionado: null,  // null = usa o mais recente
      ajustesAberto: false,
      regrasAberto: false,
      filtroCodAdmissao: '',
      filtroCodPaciente: '',
      filtroNomePaciente: '',
      filtroCategoria: '',  // '' = todas, ou 'A'/'B'/.../'G'
      filtroVinculos: new Set(['INTERNO', 'HIBRIDO', 'EXTERNO']),
      configColunas: null,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Configuração de colunas da tabela
  // ──────────────────────────────────────────────────────────────────────
  const COLUNAS_PADRAO = [
    { id: 'cod_admissao',  label: 'Cód. Admissão', visivel: true, fixa: false },
    { id: 'data_admissao', label: 'Data',          visivel: true, fixa: false },
    { id: 'paciente',      label: 'Paciente',      visivel: true, fixa: true  },
    { id: 'categoria',     label: 'Categoria',     visivel: true, fixa: false },
    { id: 'procedimento',  label: 'Procedimento',  visivel: true, fixa: false },
    { id: 'medico',        label: 'Executante',    visivel: true, fixa: false },
    { id: 'origem',        label: 'Origem',        visivel: true, fixa: false },
    { id: 'qtd',           label: 'QTD',           visivel: true, fixa: false },
    { id: 'producao',      label: 'Produção (R$)', visivel: true, fixa: false },
    { id: 'regra',         label: 'Regra',         visivel: true, fixa: false },
    { id: 'taxa',          label: 'Taxa (R$)',     visivel: true, fixa: false },
  ];
  const STORAGE_KEY_COLS = 'rl_colunas_config_v1';
  // V739: larguras das colunas (resize) — declarada AQUI em cima: consts após
  // o renderizar() do load ficam em TDZ para sempre (armadilha conhecida).
  const RL_COLS_LARG_KEY = 'rl_colunas_larguras_v1';

  function obterMesPagamentoAtivo() {
    if (window.__rl.mesPagamentoSelecionado) return window.__rl.mesPagamentoSelecionado;
    return Utilidades.obterSnapshotMaisRecente();
  }

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

  renderizar();

  function renderizar() {
    try { _renderizarInterno(); }
    catch (e) {
      console.error('Erro Refractive Laser:', e);
      document.getElementById('conteudo').innerHTML = `
        <div class="page-content">
          <header class="page-header"><h2>Refractive Laser</h2></header>
          <div class="card" style="background: #FEE; border-color: #D88; padding: 18px">
            <h3 style="margin: 0 0 8px; color: #9B3A3A">⚠ Erro ao renderizar</h3>
            <pre style="font-size: 11px; white-space: pre-wrap; background: white; padding: 12px; border-radius: 8px">${escapeHTML(e.message)}\n\n${escapeHTML(e.stack || '')}</pre>
          </div>
        </div>
      `;
    }
  }

  function _renderizarInterno() {
    if (!window.__rl.configColunas) {
      window.__rl.configColunas = carregarConfigColunas();
    }

    const cfg = carregarConfig();
    const periodos = listarPeriodosRL();

    if (!window.__rl.anoSelecionado && periodos.length > 0) {
      const [ano, mes] = periodos[0].split('-');
      window.__rl.anoSelecionado = ano;
      window.__rl.mesSelecionado = mes;
    }

    const competencia = (window.__rl.anoSelecionado && window.__rl.mesSelecionado)
      ? `${window.__rl.anoSelecionado}-${window.__rl.mesSelecionado}`
      : null;

    const filtros = {
      codAdmissao:  window.__rl.filtroCodAdmissao,
      codPaciente:  window.__rl.filtroCodPaciente,
      nomePaciente: window.__rl.filtroNomePaciente,
      categoria:    window.__rl.filtroCategoria,
    };

    const linhas = competencia ? carregarLinhasRL(competencia, filtros, cfg) : [];

    const kpis = calcularKPIs(linhas);
    let kpisLM = null, kpisLY = null, kpisYTD = null;
    if (competencia) {
      try {
        const compLM = compMesAnterior(competencia);
        const lLM = carregarLinhasRL(compLM, filtros, cfg);
        if (lLM.length > 0) kpisLM = calcularKPIs(lLM);
      } catch (e) {}
      try {
        const compLY = compAnoAnterior(competencia);
        const lLY = carregarLinhasRL(compLY, filtros, cfg);
        if (lLY.length > 0) kpisLY = calcularKPIs(lLY);
      } catch (e) {}
      try {
        const compsYTD = competenciasAteEsteMes(competencia);
        // V492: cache por mês do YTD — evita reconsultar até ~15 competências a cada
        // render quando nada foi gravado no banco. Chave inclui Banco._versao
        // (invalidada em qualquer gravação) + tudo que afeta o resultado
        // (mês de pagamento, filtros de texto/categoria, config, vínculos).
        if (!window.__rl._cacheLinhasMes || window.__rl._cacheLinhasMesVersao !== Banco._versao) {
          window.__rl._cacheLinhasMes = new Map();
          window.__rl._cacheLinhasMesVersao = Banco._versao;
        }
        const cacheYTD = window.__rl._cacheLinhasMes;
        const sufixoChave = '|' + Banco._versao + '|' + obterMesPagamentoAtivo()
          + '|' + JSON.stringify(filtros) + '|' + JSON.stringify(cfg)
          + '|' + Array.from(window.__rl.filtroVinculos).sort().join(',');
        let lYTD = [];
        for (const c of compsYTD) {
          const chave = c + sufixoChave;                       // V492
          let linhasMes = cacheYTD.get(chave);                 // V492
          if (linhasMes === undefined) {
            linhasMes = carregarLinhasRL(c, filtros, cfg);
            cacheYTD.set(chave, linhasMes);                    // V492
          }
          lYTD = lYTD.concat(linhasMes);
        }
        kpisYTD = calcularKPIs(lYTD);
      } catch (e) {}
    }

    const proprietario = obterProprietario(cfg);

    // V492: CSS injetado UMA vez no <head> (antes: <style> dentro do innerHTML a cada render)
    Utilidades.garantirEstilos('css-tela-refractive-laser', getStyles());

    document.getElementById('conteudo').innerHTML = `
      <div class="page-content rl-page">
        ${renderHeader()}
<!-- V745: o popover de Ajustes de regras também é montado sob demanda no body -->
        ${window.__rl.regrasAberto  ? renderPopoverRegras(cfg) : ''}
        ${renderFiltros(periodos)}
        ${renderCards(kpis, kpisLM, kpisLY, kpisYTD, cfg, competencia)}
        ${renderCardTaxa(kpis, cfg, proprietario, competencia)}
        ${renderTabela(linhas, competencia)}
      </div>
    `;

    bindEventos(cfg);
    Utilidades.aplicarMascaraValores();
  }

  // ==========================================================================
  // HEADER
  // ==========================================================================
  function renderHeader() {
    return `
      <header class="page-header">
        <div>
          <div class="rl-titulo-wrap">
            <h2>Refractive Laser</h2>
            <button class="rl-btn-info" id="btn-rl-info" title="Regras">ⓘ</button>
          </div>
          <div class="subtitle">Taxa sobre procedimentos · aluguel do aparelho de Refractive Laser</div>
        </div>
        <div class="rl-header-acoes">
          <div class="atlas-vis-wrap">
            <!-- V745: o menu é montado SOB DEMANDA no <body> (abrirMenuVisaoRL),
                 sem re-render da tela — abrir/fechar tem de ser instantâneo. -->
            <button class="btn ${Utilidades.valoresOcultos() ? 'ativo' : ''}" id="btn-rl-visualizacao" title="Modo de exibição">
              ${Utilidades.valoresOcultos() ? '<i class="ti ti-eye-off"></i> Ocultos' : '👁 Visualização'} ▾
            </button>
          </div>
          <button class="btn" id="btn-rl-ajuste-matriz" title="Mostrar/ocultar colunas e renomear os títulos da matriz">🛠 Ajuste de Matriz</button>
          <button class="btn" id="btn-rl-ajustes">⚙ Ajustes de regras</button>
          <button class="btn btn-primary" id="btn-rl-exportar">↓ Exportar</button>
        </div>
      </header>
    `;
  }

  // ==========================================================================
  // FILTROS — fileira de filtros 20C (padrão do LIO/OPME, prefixo rl-sb)
  // ==========================================================================
  function renderFiltros(periodos) {
    // V734: a fileira 20C aparece mesmo sem procedimentos (mesmo tratamento
    // do Crosslink/Luz Pulsada) — a mensagem fica abaixo da barra.
    if (periodos.length === 0) {
      const snapshots = Utilidades.listarSnapshots();
      return `
        <div class="rl-filtros-bar">
          ${renderBarraFiltrosRL20C({ anos: [], mesesDoAno: [] })}
        </div>
        <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 30px 20px">
          <div style="color: var(--ink-faint); font-size: 13px">
            ${snapshots.length === 0
              ? 'Nenhum relatório QVIS importado ainda. Vá em <strong>Processamento → Importar QVIS</strong>.'
              : 'Nenhum procedimento de refractive laser realizado este mês'}
          </div>
        </div>
      `;
    }

    const anosMap = new Map();
    for (const p of periodos) {
      const [ano, mes] = p.split('-');
      if (!anosMap.has(ano)) anosMap.set(ano, []);
      anosMap.get(ano).push(mes);
    }
    const anos = Array.from(anosMap.keys()).sort().reverse();
    const mesesDoAno = (anosMap.get(window.__rl.anoSelecionado) || []).slice().sort();

    const _FMa = Utilidades.filtroMulti.ativo;   // V922
    const temFiltros = _FMa(window.__rl.filtroCodAdmissao) || _FMa(window.__rl.filtroCodPaciente)
                    || _FMa(window.__rl.filtroNomePaciente) || _FMa(window.__rl.filtroCategoria);

    return `
      <div class="rl-filtros-bar">
        ${renderBarraFiltrosRL20C({ anos, mesesDoAno })}
        ${temFiltros ? `<button class="btn btn-pequeno" id="btn-rl-limpar-filtros">✕ Limpar</button>` : ''}
      </div>
    `;
  }

  // ── fileira de filtros 20C (mesmo padrão do LIO, com as individualidades
  // do Refractive Laser: Ano · Mês · Categoria · Cód. Adm. · Nome).
  // Painéis abrem/fecham LOCAL (insertAdjacentHTML — zero re-render).
  function _rlSbIc(nome) {
    return {
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
      alignleft: '<line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/>',
      user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
      check: '<polyline points="20 6 9 17 4 12"/>',
      chev: '<polyline points="6 9 12 15 18 9"/>',
    }[nome] || '';
  }
  function _rlSbSvg(d, px, sw) {
    return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  function _rlSbSemAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function _rlCatRotulo(cat) {
    const info = SINONIMOS_RL[cat];
    return info ? `${cat} · ${info.label}` : (cat || '');
  }

  function renderBarraFiltrosRL20C(ctx) {
    // guarda as listas pro painel abrir LOCAL depois, sem recoletar
    window.__rl._sbOpcoes = {
      anos: ctx.anos,
      meses: ctx.mesesDoAno,
      cats: Object.keys(SINONIMOS_RL),
      codadm: carregarOpcoesCombo('cod-adm'),
      nomepac: carregarOpcoesCombo('nome-pac'),
    };
    const cel = (id, rotulo, valor, icone, flex, vazio = 'Todos') => {
      const ativo = !!valor;
      const estaAberta = window.__rl.sbAberto === id;
      return `
        <div class="rl-sb-celwrap" style="flex:${flex}">
          <button type="button" class="rl-sb-cel ${ativo ? 'ativo' : ''} ${estaAberta ? 'aberta' : ''}"
                  data-sb-cel="${id}" data-sb-vazio="${vazio}" role="combobox" aria-expanded="${estaAberta ? 'true' : 'false'}" aria-haspopup="listbox">
            <span class="rl-sb-tile">${_rlSbSvg(_rlSbIc(icone), 14, 2.1)}</span>
            <span class="rl-sb-tx">
              <span class="rl-sb-rot">${rotulo}</span>
              <span class="rl-sb-val">${escapeHTML(valor || vazio)}</span>
            </span>
            <span class="rl-sb-chev">${_rlSbSvg(_rlSbIc('chev'), 10, 2.8)}</span>
          </button>
          ${estaAberta ? painelRL20C(id) : ''}
        </div>`;
    };
    const mesLabel = window.__rl.mesSelecionado
      ? (MESES_EXTENSO_RL[parseInt(window.__rl.mesSelecionado, 10) - 1] || window.__rl.mesSelecionado)
      : '';
    // V922: rótulos dos filtros multi
    const FM = Utilidades.filtroMulti;
    const rotMulti = (f) => FM.ativo(f) ? FM.rotulo(f) : '';
    const rotMultiCat = (f) => {
      const sel = FM.sel(f);
      if (!sel.length) return '';
      if (sel.length === 1) return _rlCatRotulo(sel[0]);
      return `${sel.length} selecionadas`;
    };
    return `
      <div class="rl-sb" id="rl-sb">
        ${cel('ano', 'Ano', window.__rl.anoSelecionado || '', 'clock', 0.75)}
        ${cel('mes', 'Mês', mesLabel, 'calendar', 0.8)}
        ${cel('cat', 'Categoria', rotMultiCat(window.__rl.filtroCategoria), 'grid', 1.35, 'Todas')}
        ${cel('codadm', 'Cód. Adm.', rotMulti(window.__rl.filtroCodAdmissao), 'alignleft', 1.05)}
        ${cel('nomepac', 'Nome', rotMulti(window.__rl.filtroNomePaciente), 'user', 1.3)}
      </div>`;
  }

  function painelRL20C(id) {
    const opc = window.__rl._sbOpcoes || {};
    const item = (val, rotulo, sel) => `
      <div class="rl-sb-it ${sel ? 'sel' : ''} ${val === '' ? 'rl-sb-it-todos' : ''}" data-sb-item data-val="${escapeHTML(val)}" data-busca="${escapeHTML(_rlSbSemAcento(rotulo))}" role="option" aria-selected="${sel ? 'true' : 'false'}">
        <span class="rl-sb-it-nome">${escapeHTML(rotulo)}</span>
        ${sel ? `<span class="rl-sb-ck">${_rlSbSvg(_rlSbIc('check'), 14, 2.5)}</span>` : ''}
      </div>`;
    const painelLista = (cel, itensHtml, { busca = false, total = 0 } = {}) => `
      <div class="rl-sb-painel" data-sb-painel="${cel}">
        ${busca ? `
          <div class="rl-sb-buscabox">
            <span class="rl-sb-busca-ic">${_rlSbSvg(_rlSbIc('search'), 15, 2.1)}</span>
            <input type="text" class="rl-sb-busca" data-sb-busca placeholder="Digite pra buscar" autocomplete="off">
          </div>` : ''}
        <div class="rl-sb-lista" role="listbox">
          ${itensHtml}
        </div>
        ${busca ? `<div class="rl-sb-rodape" data-sb-contagem>${total} opç${total === 1 ? 'ão' : 'ões'}</div>` : ''}
      </div>`;
    if (id === 'ano') {
      return painelLista('ano', (opc.anos || []).map(a => item(a, a, a === window.__rl.anoSelecionado)).join(''));
    }
    if (id === 'mes') {
      return painelLista('mes', (opc.meses || []).map(m =>
        item(m, MESES_EXTENSO_RL[parseInt(m, 10) - 1] || m, m === window.__rl.mesSelecionado)).join(''));
    }
    const FM = Utilidades.filtroMulti;   // V922: multi + busca em todos
    if (id === 'cat') {
      const sel = FM.sel(window.__rl.filtroCategoria);
      return painelLista('cat', item('', 'Todas', sel.length === 0)
        + (opc.cats || []).map(c => item(c, _rlCatRotulo(c), sel.includes(String(c)))).join(''),
        { busca: true, total: (opc.cats || []).length });
    }
    const lista = (id === 'codadm' ? opc.codadm : opc.nomepac) || [];
    const fAtual = id === 'codadm' ? window.__rl.filtroCodAdmissao : window.__rl.filtroNomePaciente;
    const sel = FM.sel(fAtual);
    const marcadas = lista.filter(o => sel.includes(String(o)));
    const demais = lista.filter(o => !sel.includes(String(o)));
    return painelLista(id, item('', 'Todos', sel.length === 0)
      + [...marcadas, ...demais].slice(0, 400).map(o => item(o, o, sel.includes(String(o)))).join(''), { busca: true, total: lista.length });
  }

  function bindBarraFiltrosRL20C() {
    const sb = document.getElementById('rl-sb');
    if (!sb) return;
    const fecharPainelLocal = () => {
      sb.querySelectorAll('.rl-sb-painel').forEach(p => p.remove());
      sb.querySelectorAll('.rl-sb-cel.aberta').forEach(c => { c.classList.remove('aberta'); c.setAttribute('aria-expanded', 'false'); });
      window.__rl.sbAberto = null;
    };
    const aplicar = (celId, val) => {
      if (celId === 'ano') {
        window.__rl.anoSelecionado = val;
        const periodos = listarPeriodosRL();
        const mesesAno = periodos.filter(p => p.startsWith(val + '-')).map(p => p.split('-')[1]).sort();
        window.__rl.mesSelecionado = mesesAno[0] || null;
      } else if (celId === 'mes') window.__rl.mesSelecionado = val;
      else {
        // V922: MULTI — alterna e mantém a lista aberta; "Todos" limpa
        const FM = Utilidades.filtroMulti;
        const campo = celId === 'cat' ? 'filtroCategoria'
          : celId === 'codadm' ? 'filtroCodAdmissao' : 'filtroNomePaciente';
        const buscaEl = sb.querySelector('[data-sb-busca]');
        window.__rl._sbBusca = buscaEl ? buscaEl.value : '';
        window.__rl[campo] = val === '' ? [] : FM.toggle(window.__rl[campo], val);
        renderizar();   // sbAberto continua — o painel re-abre marcado
        return;
      }
      window.__rl._sbBusca = '';
      fecharPainelLocal();
      renderizar();
    };
    const wireInputsPainel = () => {
      const busca = sb.querySelector('[data-sb-busca]');
      if (!busca) return;
      setTimeout(() => busca.focus(), 0);
      const filtrar = () => {
        const q = _rlSbSemAcento(busca.value);
        const painel = busca.closest('.rl-sb-painel');
        let n = 0;
        painel.querySelectorAll('[data-sb-item]').forEach(el => {
          // V922: itens MARCADOS ficam sempre visíveis
          const mostra = el.classList.contains('rl-sb-it-todos') || el.classList.contains('sel') || !q || (el.dataset.busca || '').includes(q);
          el.style.display = mostra ? '' : 'none';
          if (mostra && !el.classList.contains('rl-sb-it-todos')) n++;
        });
        const cont = painel.querySelector('[data-sb-contagem]');
        if (cont) cont.textContent = `${n} opç${n === 1 ? 'ão' : 'ões'}`;
      };
      busca.addEventListener('input', filtrar);
      if (window.__rl._sbBusca) { busca.value = window.__rl._sbBusca; filtrar(); }   // V922
    };
    const abrirPainelLocal = (id) => {
      const jaAberto = window.__rl.sbAberto === id;
      fecharPainelLocal();
      window.__rl._sbBusca = '';   // V922: busca não vaza de um painel pro outro
      if (jaAberto) return;
      window.__rl.sbAberto = id;
      const btn = sb.querySelector(`[data-sb-cel="${id}"]`);
      btn.classList.add('aberta');
      btn.setAttribute('aria-expanded', 'true');
      btn.parentElement.insertAdjacentHTML('beforeend', painelRL20C(id));
      wireInputsPainel();
    };
    // V922: o painel pode vir aberto do template (re-render após marcar)
    if (window.__rl.sbAberto && sb.querySelector('.rl-sb-painel')) wireInputsPainel();
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
      if (!window.__rl.sbAberto) return;
      const painel = sb.querySelector('.rl-sb-painel');
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
    if (window.__rlSbFechar) {
      document.removeEventListener('click', window.__rlSbFechar);
      document.removeEventListener('keydown', window.__rlSbEsc);
    }
    const fecharFora = (e) => {
      if (App.telaAtual !== 'desempenho-refractive-laser') return;
      if (window.__rl.sbAberto && !e.target.closest('#rl-sb')) fecharPainelLocal();
    };
    const escFecha = (e) => { if (e.key === 'Escape' && window.__rl.sbAberto) fecharPainelLocal(); };
    window.__rlSbFechar = fecharFora;
    window.__rlSbEsc = escFecha;
    document.addEventListener('click', fecharFora);
    document.addEventListener('keydown', escFecha);
    if (window.__rl.sbAberto) wireInputsPainel();
  }

  function carregarOpcoesCombo(tipo) {
    if (!window.__rl.anoSelecionado || !window.__rl.mesSelecionado) return [];
    const mesPagamento = `${window.__rl.anoSelecionado}-${window.__rl.mesSelecionado}`;
    const coluna = tipo === 'cod-adm' ? 'admissao'
                 : tipo === 'cod-pac' ? 'cod_paciente'
                 : 'paciente';

    // Filtra apenas pelas linhas que SERIAM elegíveis (executantes + categoria)
    const procsSql = procListaSQL();

    const rows = Banco.query(`
      SELECT DISTINCT ${coluna} AS v
      FROM linhas_qvis
      WHERE papel IN ('MEDICO', 'CIRURGIAO')
        AND mes_pagamento = ?
        AND ${coluna} IS NOT NULL AND ${coluna} != ''
        AND ${procsSql}
      ORDER BY ${coluna}
      LIMIT 500
    `, [mesPagamento]);
    return rows.map(r => String(r.v));
  }

  // Constrói SQL para filtrar procedimentos elegíveis.
  // Usa LIKE com REPLACE para tolerar espaços múltiplos (já normalizado em JS).
  function procListaSQL() {
    // Lista de procedimentos UPPER com espaços simples = todas as variações
    const todos = Object.values(SINONIMOS_RL).flatMap(info => info.sinonimos);
    // Para o SQL, vamos comparar usando UPPER + REPLACE para normalizar espaços
    // Mas isso fica muito complexo; mais simples: comparar com TRIM/UPPER e
    // re-filtrar em JS depois (volumes baixos: ~600 linhas em 1 ano).
    // Aqui usamos um LIKE largo (genérico) e o JS faz o match exato.
    return `(
      UPPER(procedimento_normalizado) LIKE '%ORBSCAN%'
      OR UPPER(procedimento_normalizado) LIKE '%FOTOABLACAO%'
      OR UPPER(procedimento_normalizado) LIKE '%DELAMINACAO%'
      OR UPPER(procedimento_normalizado) LIKE '%CIRURGIA REFRATIVA%'
    )`;
  }

  // ==========================================================================
  // CARREGAMENTO DE DADOS
  // ==========================================================================
  // Lista TODOS os mes_pagamento que têm procedimentos relacionados a RL.
  // (Antes filtrava por competência, mas o conceito agora é "filtrar por
  // mês de pagamento". O filtro de ano/mês no fichário = mes_pagamento.)
  function listarPeriodosRL() {
    try {
      return Banco.query(`
        SELECT DISTINCT mes_pagamento FROM linhas_qvis
        WHERE papel IN ('MEDICO', 'CIRURGIAO')
          AND mes_pagamento IS NOT NULL AND mes_pagamento != ''
          AND ${procListaSQL()}
        ORDER BY mes_pagamento DESC
      `).map(r => r.mes_pagamento);
    } catch (e) {
      console.warn('Tabela linhas_qvis indisponível:', e.message);
      return [];
    }
  }

  function compMesAnterior(c) {
    const [a, m] = c.split('-').map(Number);
    const mp = m === 1 ? 12 : m - 1;
    const ap = m === 1 ? a - 1 : a;
    return `${ap}-${String(mp).padStart(2, '0')}`;
  }
  function compAnoAnterior(c) {
    const [a, m] = c.split('-').map(Number);
    return `${a - 1}-${String(m).padStart(2, '0')}`;
  }
  function competenciasAteEsteMes(c) {
    const [a, m] = c.split('-').map(Number);
    const r = [];
    for (let i = 1; i <= m; i++) r.push(`${a}-${String(i).padStart(2, '0')}`);
    return r;
  }
  function formatarComp(c) {
    if (!c) return '—';
    const [a, m] = c.split('-');
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return `${meses[Number(m) - 1] || m}/${a}`;
  }

  /**
   * Carrega linhas elegíveis do Refractive Laser para um período.
   * Aplica:
   *   - Filtro de procedimento (sinônimos canônicos via JS, após query SQL ampla)
   *   - Filtros de texto e categoria
   *   - Filtro de vínculo do executante
   *   - Filtro de bases ativas (Conv/Part)
   * Calcula:
   *   - qtd_efetiva (lateralidade — BINOCULAR no nome → 2)
   *   - regra aplicada e taxa
   *   - resolve nome do médico via cadMap
   */
  function carregarLinhasRL(mesPagamento, filtros, cfg) {
    if (!mesPagamento) return [];
    const where = [
      `papel IN ('MEDICO', 'CIRURGIAO')`,
      `mes_pagamento = ?`,
      procListaSQL(),
    ];
    const params = [mesPagamento];

    if (filtros) {
      // V922: filtros MULTI — string (legado) ou array (união de LIKEs)
      const FM = Utilidades.filtroMulti;
      for (const [f, col] of [[filtros.codAdmissao, 'admissao'],
                              [filtros.codPaciente, 'cod_paciente'],
                              [filtros.nomePaciente, 'paciente']]) {
        const cond = FM.sqlLike(f, col, params);
        if (cond) where.push(cond);
      }
    }

    const linhas = Banco.query(`
      SELECT id, admissao, paciente, cod_paciente, data_admissao,
             procedimento, procedimento_normalizado, nome_profissional, nome_normalizado,
             origem, tipo_recebimento, convenio, competencia,
             produzido, recebido, quantidade
      FROM linhas_qvis
      WHERE ${where.join(' AND ')}
      ORDER BY data_admissao, admissao
    `, params);

    // DEBUG: log do diagnóstico
    if (window.__rl_debug !== false) {
      console.group(`🔬 Refractive Laser DEBUG (mes_pagamento=${mesPagamento})`);
      console.log(`SQL retornou ${linhas.length} linhas com proc relacionado a RL`);
      if (linhas.length > 0) {
        const procsUnicos = {};
        const porOrigem = { CONVENIO: 0, PARTICULAR: 0, OUTROS: 0 };
        const porOrigemCat = { CONVENIO: {}, PARTICULAR: {} };
        linhas.forEach(l => {
          const p = l.procedimento_normalizado || l.procedimento || '';
          procsUnicos[p] = (procsUnicos[p] || 0) + 1;
          const o = l.origem || 'OUTROS';
          if (porOrigem[o] !== undefined) porOrigem[o]++;
          else porOrigem.OUTROS++;
        });
        console.log('Procedimentos no SQL (proc_normalizado):', procsUnicos);
        console.log('Por origem:', porOrigem);
        // Amostra de Convênio (se houver)
        const amostraConv = linhas.filter(l => l.origem === 'CONVENIO').slice(0, 5);
        if (amostraConv.length > 0) {
          console.log('Amostra Conv (5 primeiras):', amostraConv.map(l => ({
            adm: l.admissao,
            proc: l.procedimento_normalizado,
            medico: l.nome_normalizado,
            produzido: l.produzido,
            comp: l.competencia,
          })));
        } else {
          console.warn('⚠ NENHUMA linha Convênio retornada do SQL!');
        }
      } else {
        const lqTotal = Banco.queryUnica(`SELECT COUNT(*) AS n FROM linhas_qvis WHERE mes_pagamento = ?`, [mesPagamento]);
        const lqOrbscan = Banco.queryUnica(`SELECT COUNT(*) AS n FROM linhas_qvis WHERE mes_pagamento = ? AND UPPER(procedimento_normalizado) LIKE '%ORBSCAN%'`, [mesPagamento]);
        console.log(`Linhas para (mp=${mesPagamento}): ${lqTotal?.n || 0} total | ${lqOrbscan?.n || 0} com ORBSCAN`);
      }
      console.groupEnd();
    }

    if (linhas.length === 0) return [];

    // Cadastro de médicos para resolver nome + vínculo
    const cadMap = new Map();
    const porId = new Map();  // V492: id → médico, do SELECT já feito (padrão lentes_contato)
    Banco.query(`SELECT id, nome_oficial, nome_normalizado, tipo_vinculo FROM medicos WHERE ativo = 1`)
      .forEach(m => {
        cadMap.set((m.nome_oficial || '').toUpperCase().trim(), m);
        cadMap.set(m.nome_normalizado, m);
        porId.set(m.id, m);  // V492
      });
    try {
      Banco.query(`SELECT s.grafia, s.grafia_normalizada, s.medico_id FROM sinonimos_medico s JOIN medicos m ON m.id = s.medico_id WHERE m.ativo = 1`)
        .forEach(s => {
          const med = porId.get(s.medico_id);  // V492: antes fazia 1 queryUnica POR sinônimo (N+1)
          if (med) {
            cadMap.set((s.grafia || '').toUpperCase().trim(), med);
            cadMap.set(s.grafia_normalizada, med);
          }
        });
    } catch (e) {}

    const tiposPermitidos = window.__rl.filtroVinculos;
    const selCategorias = Utilidades.filtroMulti.sel(filtros && filtros.categoria);   // V922

    // DEBUG: contadores de descarte
    const dbg = {
      semCat: 0, semCatConv: 0, semCatPart: 0,
      baseInativa: 0,
      vincDescartado: 0, vincDescConv: 0, vincDescPart: 0,
      ok: 0, okConv: 0, okPart: 0,
      vincPorTipo: {},  // INTERNO/HIBRIDO/EXTERNO + sem cadastro
    };

    const resultado = [];
    for (const l of linhas) {
      // Match de categoria pela normalização (espaços múltiplos)
      const cat = categorizar(l.procedimento);
      if (!cat) {
        dbg.semCat++;
        if (l.origem === 'CONVENIO') dbg.semCatConv++;
        else if (l.origem === 'PARTICULAR') dbg.semCatPart++;
        continue;
      }
      if (selCategorias.length && !selCategorias.includes(cat)) continue;   // V922: união

      // Bases ativas
      if (l.origem === 'CONVENIO'   && !cfg.baseConvenio)   { dbg.baseInativa++; continue; }
      if (l.origem === 'PARTICULAR' && !cfg.baseParticular) { dbg.baseInativa++; continue; }

      // Resolve médico/vínculo
      const cad = cadMap.get(l.nome_normalizado);
      const tipo_vinculo = cad ? cad.tipo_vinculo : null;
      const nome_oficial = cad ? cad.nome_oficial : null;
      const tv = tipo_vinculo || 'EXTERNO';
      dbg.vincPorTipo[tv] = (dbg.vincPorTipo[tv] || 0) + 1;
      if (!tiposPermitidos.has(tv)) {
        dbg.vincDescartado++;
        if (l.origem === 'CONVENIO') dbg.vincDescConv++;
        else if (l.origem === 'PARTICULAR') dbg.vincDescPart++;
        continue;
      }
      dbg.ok++;
      if (l.origem === 'CONVENIO') dbg.okConv++;
      else if (l.origem === 'PARTICULAR') dbg.okPart++;

      // Calcula qtd_efetiva: usa SEMPRE a coluna QUANTIDADE
      // (Confirmado em 19/05/2026: o QVIS oficial paga conforme QUANTIDADE,
      // independente de o nome conter "BINOCULAR" ou não.)
      const qtdEfet = Number(l.quantidade) || 1;
      const isBinocularNome = false;  // mantido pra compat com renderLinha

      // Calcula taxa conforme regras
      const info = SINONIMOS_RL[cat];
      let taxa = 0;
      let regra = '';
      if (info.tipo === 'EXAME') {
        // Valor fixo (ignora QTD)
        if (l.origem === 'CONVENIO') {
          taxa = cfg[`VAL_${cat}_CONV`] || 0;
          regra = `R$ ${formatarBR(taxa)} (fixo)`;
        } else {
          taxa = cfg[`VAL_${cat}_PART`] || 0;
          regra = `R$ ${formatarBR(taxa)} (fixo)`;
        }
      } else {
        // Cirúrgico
        if (l.origem === 'CONVENIO') {
          const valFixo = qtdEfet === 1 ? cfg.VAL_CIRUR_CONV_QTD1 : cfg.VAL_CIRUR_CONV_QTD2;
          taxa = valFixo;
          regra = `${qtdEfet === 1 ? 'Mono' : 'Bi'} · R$ ${formatarBR(valFixo)}`;
        } else {
          const pct = cfg.PCT_CIRUR_PART;
          const prod = Number(l.produzido) || 0;
          taxa = prod * pct / 100;
          regra = `${formatarBR(pct)}% × R$ ${formatarBR(prod)}`;
        }
      }

      resultado.push({
        id: l.id,
        admissao: String(l.admissao),
        paciente: l.paciente,
        cod_paciente: l.cod_paciente,
        data_admissao: l.data_admissao,
        procedimento: l.procedimento,
        nome_profissional: l.nome_profissional,
        nome_medico_oficial: nome_oficial,
        tipo_vinculo,
        categoria: cat,
        categoria_label: info.label,
        categoria_tipo: info.tipo,
        origem: l.origem,
        convenio: l.convenio,
        produzido: Number(l.produzido) || 0,
        quantidade: Number(l.quantidade) || 1,
        qtd_efetiva: qtdEfet,
        binocular_no_nome: isBinocularNome,
        taxa,
        regra,
      });
    }

    if (window.__rl_debug !== false) {
      console.log(`🔬 RL descartes: ${dbg.ok} OK (Conv:${dbg.okConv} | Part:${dbg.okPart})`);
      console.log(`🔬 RL sem categoria: ${dbg.semCat} (Conv:${dbg.semCatConv} | Part:${dbg.semCatPart})`);
      console.log(`🔬 RL vínculo descartado: ${dbg.vincDescartado} (Conv:${dbg.vincDescConv} | Part:${dbg.vincDescPart})`);
      console.log(`🔬 RL distribuição vínculos:`, dbg.vincPorTipo);
      console.log(`🔬 RL vínculos permitidos:`, Array.from(tiposPermitidos));
      console.log(`🔬 RL bases: Conv=${cfg.baseConvenio}, Part=${cfg.baseParticular}`);
    }

    return resultado;
  }

  function formatarBR(n) { return Utilidades.formatarNumero(n, 2); }

  // ==========================================================================
  // CONFIG E PROPRIETÁRIO
  // ==========================================================================
  function carregarConfig() {
    const c = {};
    try {
      Banco.query('SELECT chave, valor FROM config_refractive_laser').forEach(r => {
        c[r.chave] = r.valor;
      });
    } catch (e) {}
    return {
      proprietarioId: c.PROPRIETARIO_MEDICO_ID || '',
      baseParticular: (c.BASE_PARTICULAR ?? '1') === '1',
      baseConvenio:   (c.BASE_CONVENIO   ?? '1') === '1',
      VAL_A_CONV: parseFloat(c.VAL_A_CONV || '28.72') || 0,
      VAL_A_PART: parseFloat(c.VAL_A_PART || '62.50') || 0,
      VAL_B_CONV: parseFloat(c.VAL_B_CONV || '23.40') || 0,
      VAL_B_PART: parseFloat(c.VAL_B_PART || '62.50') || 0,
      VAL_CIRUR_CONV_QTD1: parseFloat(c.VAL_CIRUR_CONV_QTD1 || '254.65') || 0,
      VAL_CIRUR_CONV_QTD2: parseFloat(c.VAL_CIRUR_CONV_QTD2 || '509.30') || 0,
      PCT_CIRUR_PART:      parseFloat(c.PCT_CIRUR_PART      || '26.50')  || 0,
    };
  }

  function obterProprietario(cfg) {
    if (!cfg.proprietarioId) {
      try {
        const r = Banco.queryUnica(`
          SELECT id, nome_oficial, tipo_vinculo
          FROM medicos
          WHERE ativo = 1 AND UPPER(nome_oficial) LIKE '%MARIA%REGINA%CATAI%'
          LIMIT 1
        `);
        if (r) return r;
      } catch (e) {}
      return null;
    }
    try {
      return Banco.queryUnica(`SELECT id, nome_oficial, tipo_vinculo FROM medicos WHERE id = ? AND ativo = 1`, [cfg.proprietarioId]);
    } catch (e) { return null; }
  }

  // ==========================================================================
  // KPIs
  // ==========================================================================
  function calcularKPIs(linhas) {
    const k = {
      linhas:           linhas.length,
      admissoesDistintas: new Set(linhas.map(l => l.admissao)).size,
      linhasConv:       0,
      linhasPart:       0,
      linhasExame:      0,
      linhasCirur:      0,
      producao:         0,
      taxa:             0,
    };
    for (const l of linhas) {
      if (l.origem === 'CONVENIO')   k.linhasConv++;
      else if (l.origem === 'PARTICULAR') k.linhasPart++;
      if (l.categoria_tipo === 'EXAME')   k.linhasExame++;
      else                                k.linhasCirur++;
      k.producao += l.produzido || 0;
      k.taxa     += l.taxa || 0;
    }
    return k;
  }

  // ==========================================================================
  // CARDS
  // ==========================================================================
  function renderCards(k, kLM, kLY, kYTD, cfg, competencia) {
    if (!competencia) return '';

    const badge = (atual, comp) => {
      if (comp === null || comp === undefined) return '<span class="rl-comp-vazio">—</span>';
      if (!comp) {
        if (atual > 0) return `<span class="rl-comp-up">↑ novo</span>`;
        return `<span class="rl-comp-igual">↔ 0,0%</span>`;
      }
      const pct = ((atual - comp) / comp) * 100;
      if (Math.abs(pct) < 0.05) return `<span class="rl-comp-igual">↔ 0,0%</span>`;
      const cls = pct > 0 ? 'rl-comp-up' : 'rl-comp-down';
      const seta = pct > 0 ? '↑' : '↓';
      return `<span class="${cls}">${seta} ${Utilidades.formatarNumero(Math.abs(pct), 1)}%</span>`;
    };

    const linhaComp = (atual, valLM, valLY) => `
      <div class="rl-card-comp">
        <div class="rl-card-comp-item"><span class="rl-card-comp-lbl">vs LM</span> ${badge(atual, valLM)}</div>
        <div class="rl-card-comp-item"><span class="rl-card-comp-lbl">vs LY</span> ${badge(atual, valLY)}</div>
      </div>
    `;

    return `
      <div class="rl-cards-grid">
        <!-- Card 1: linhas + breakdown -->
        <div class="rl-card rl-card-verde">
          <div class="rl-card-faixa"></div>
          <div class="rl-card-titulo">Procedimentos elegíveis</div>
          <div class="rl-card-valor mono" data-ocultavel>${k.linhas}</div>
          <div class="rl-card-breakdown">
            <div class="rl-bd-item"><span class="rl-bd-dot" style="background: #102d4b"></span> Convênio: <strong data-ocultavel>${k.linhasConv}</strong></div>
            <div class="rl-bd-item"><span class="rl-bd-dot" style="background: #6B4587"></span> Particular: <strong data-ocultavel>${k.linhasPart}</strong></div>
            <div class="rl-bd-item"><span class="rl-bd-dot" style="background: #143352"></span> Exames: <strong data-ocultavel>${k.linhasExame}</strong> · Cirúrgicos: <strong data-ocultavel>${k.linhasCirur}</strong></div>
          </div>
          ${linhaComp(k.linhas, kLM?.linhas, kLY?.linhas)}
        </div>

        <!-- Card 2: linhas YTD -->
        <div class="rl-card rl-card-roxo">
          <div class="rl-card-faixa"></div>
          <div class="rl-card-titulo">Procedimentos YTD</div>
          <div class="rl-card-valor mono" data-ocultavel>${kYTD?.linhas || 0}</div>
          <div class="rl-card-sub"><span data-ocultavel>${kYTD?.admissoesDistintas || 0}</span> admissões · Taxa YTD: <strong data-ocultavel>R$ ${formatarBR(kYTD?.taxa || 0)}</strong></div>
        </div>

        <!-- Card 3: produção do mês -->
        <div class="rl-card rl-card-bege">
          <div class="rl-card-faixa"></div>
          <div class="rl-card-titulo">Produção · Mês</div>
          <div class="rl-card-valor mono" data-ocultavel>R$ ${formatarBR(k.producao)}</div>
          ${linhaComp(k.producao, kLM?.producao, kLY?.producao)}
        </div>

        <!-- Card 4: taxa total destaque -->
        <div class="rl-card rl-card-destaque">
          <div class="rl-card-titulo">Taxa da Proprietária · Mês</div>
          <div class="rl-card-valor mono" data-ocultavel>R$ ${Utilidades.formatarNumero(k.taxa, 2)}</div>
          <div class="rl-card-sub"><span data-ocultavel>${k.linhas}</span> procedimento${k.linhas !== 1 ? 's' : ''} elegível${k.linhas !== 1 ? 'eis' : ''}</div>
          ${linhaComp(k.taxa, kLM?.taxa, kLY?.taxa)}
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // CARD DESTACADO — Detalhes da Taxa
  // ==========================================================================
  function renderCardTaxa(k, cfg, prop, competencia) {
    if (!competencia) return '';
    const nomeProp = prop ? prop.nome_oficial : '(não configurada)';
    const bases = [];
    if (cfg.baseParticular) bases.push('Particular');
    if (cfg.baseConvenio)   bases.push('Convênio');

    return `
      <div class="rl-card-taxa">
        <div class="rl-card-taxa-header">
          <span class="rl-card-taxa-icone">🔧</span>
          <span class="rl-card-taxa-titulo">Taxa sobre Procedimentos · Aparelho Refractive Laser</span>
        </div>
        <div class="rl-card-taxa-info">
          <div class="rl-info-item">
            <div class="rl-info-label">Proprietária do equipamento</div>
            <div class="rl-info-valor">${escapeHTML(CodigoMedico.exibir(nomeProp))}</div>
          </div>
          <div class="rl-info-item">
            <div class="rl-info-label">Bases consideradas</div>
            <div class="rl-info-valor" style="font-size: 11px">${bases.join(' + ') || '<em style="color: var(--ink-faint)">nenhuma</em>'}</div>
          </div>
          <div class="rl-info-item">
            <div class="rl-info-label">Procedimentos elegíveis no mês</div>
            <div class="rl-info-valor mono" data-ocultavel>${k.linhas}</div>
          </div>
        </div>
        <div class="rl-card-taxa-calc">
          <div class="rl-calc-label">TAXA TOTAL · ${formatarComp(competencia)}</div>
          <div class="rl-calc-formula mono">
            Soma de <span data-ocultavel>${k.linhas}</span> taxa${k.linhas !== 1 ? 's' : ''} individuais
            = <span class="rl-calc-resultado" data-ocultavel>R$ ${Utilidades.formatarNumero(k.taxa, 2)}</span>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // TABELA — linhas elegíveis
  // ==========================================================================
  function renderTabela(linhas, competencia) {
    if (!competencia) return '';
    if (linhas.length === 0) {
      return `
        <div class="rl-secao-label" style="margin-top: 22px">Procedimentos elegíveis</div>
        <div class="card" style="padding: 24px; text-align: center; color: var(--ink-faint)">
          Nenhum procedimento elegível no período (ou todos foram filtrados).
        </div>
      `;
    }

    const cols = (window.__rl.configColunas || COLUNAS_PADRAO).filter(c => c.visivel);
    // V739: alça de resize em cada th (mesmo mecanismo do LIO/Fracionamento)
    const ths = cols.map(c => {
      const num = (c.id === 'qtd' || c.id === 'producao' || c.id === 'taxa') ? 'class="num"' : '';
      return `<th ${num} data-col="${escapeAttr(c.id)}">${escapeHTML(c.label)}<span class="rl-col-resize" data-resize-col="${escapeAttr(c.id)}"></span></th>`;
    }).join('');

    // V740: a linha de TOTAL saiu da matriz (os cards totalizadores já fazem
    // essa função). No Excel o total CONTINUA — mesmo critério do Fellow V728.
    return `
      <div class="rl-secao-label" style="margin-top: 22px">
        Procedimentos elegíveis
        <span style="font-weight: 500; text-transform: none; color: var(--ink-faint); margin-left: 6px">· ${linhas.length} linha${linhas.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="card rl-tabela-scroll" style="padding: 0; overflow: auto; max-width: 100%">
        <table class="data-table rl-tabela">
          <thead><tr>${ths}</tr></thead>
          <tbody>
            ${linhas.map(l => renderLinha(l, cols)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderLinha(l, cols) {
    const origemBadge = Utilidades.badgeFonte(l.origem);   // V946: tag padrão da ferramenta

    const vinculoBadge = Utilidades.badgeTipoVinculo(l.tipo_vinculo) || '';

    // Badge de categoria
    const catCor = l.categoria_tipo === 'EXAME' ? '#143352' : '#143352';
    const catBg  = l.categoria_tipo === 'EXAME' ? '#e4ecf4' : '#e4ecf4';

    // QTD: mostrar real + indicador se foi inferida por nome
    const qtdLabel = l.binocular_no_nome
      ? `${l.qtd_efetiva} <span title="QTD = ${l.quantidade} mas nome contém BINOCULAR" style="font-size: 9px; color: var(--ink-faint)">(bino⁕)</span>`
      : `${l.qtd_efetiva}`;

    const tds = cols.map(c => {
      if (c.id === 'cod_admissao')  return `<td class="mono">${escapeHTML(l.admissao)}</td>`;
      if (c.id === 'data_admissao') return `<td class="mono" style="white-space: nowrap; color: var(--ink-soft)">${Utilidades.formatarDataBR(l.data_admissao)}</td>`;
      if (c.id === 'paciente')      return `<td>${escapeHTML(l.paciente || '—')}</td>`;
      if (c.id === 'categoria')    return `<td><span class="rl-cat-badge" style="background:${catBg};color:${catCor}">${l.categoria} · ${escapeHTML(l.categoria_label)}</span></td>`;
      if (c.id === 'procedimento') return `<td style="font-size: 11px" title="${escapeAttr(l.procedimento)}">${escapeHTML(l.procedimento)}</td>`;
      if (c.id === 'medico')       return `<td>
        <div class="rl-medico-nome">${escapeHTML(CodigoMedico.exibir(l.nome_medico_oficial || l.nome_profissional || ''))}</div>
        ${vinculoBadge}
      </td>`;
      if (c.id === 'origem')       return `<td>${origemBadge}</td>`;
      if (c.id === 'qtd')          return `<td class="num mono" data-ocultavel>${qtdLabel}</td>`;
      if (c.id === 'producao')     return `<td class="num mono" data-ocultavel>R$ ${Utilidades.formatarNumero(l.produzido, 2)}</td>`;
      if (c.id === 'regra')        return `<td style="font-size: 10px; color: var(--ink-soft)">${escapeHTML(l.regra)}</td>`;
      if (c.id === 'taxa')         return `<td class="num mono" data-ocultavel style="font-weight: 700; color: var(--accent)">R$ ${Utilidades.formatarNumero(l.taxa, 2)}</td>`;
      return '<td></td>';
    }).join('');

    return `<tr>${tds}</tr>`;
  }

  // ==========================================================================
  // POPOVERS
  // ==========================================================================
  function renderPopoverAjustes(cfg, propAtual) {
    const medicos = Banco.query(`SELECT id, nome_oficial, tipo_vinculo FROM medicos WHERE ativo = 1 ORDER BY nome_oficial`);
    const propId = propAtual ? String(propAtual.id) : '';
    const tiposVinc = ['INTERNO', 'HIBRIDO', 'EXTERNO'];
    const labelVinc = { INTERNO: 'Interno', HIBRIDO: 'Híbrido', EXTERNO: 'Externo' };

    return `
      <div class="rl-overlay" data-popover="ajustes"></div>
      <div class="rl-popover rl-popover-wide">
        <div class="rl-popover-header">
          <h3>Ajustes — Refractive Laser</h3>
          <button class="rl-popover-close" data-popover="ajustes">×</button>
        </div>

        <!-- Proprietária -->
        <div class="rl-aj-bloco">
          <div class="rl-aj-titulo">Proprietária do aparelho</div>
          <select class="rl-aj-select" id="rl-aj-proprietario">
            <option value="">— Auto (Maria Regina Catai) —</option>
            ${medicos.map(m => `
              <option value="${m.id}" ${String(m.id) === propId ? 'selected' : ''}>${escapeHTML(CodigoMedico.exibir(m.nome_oficial))}</option>
            `).join('')}
          </select>
        </div>

        <!-- Bases -->
        <div class="rl-aj-bloco">
          <div class="rl-aj-titulo">Bases consideradas</div>
          <div class="rl-aj-base-grid">
            <label class="rl-aj-chk-linha">
              <input type="checkbox" data-base="BASE_PARTICULAR" ${cfg.baseParticular ? 'checked' : ''}>
              <span><strong>Particular</strong> — usa PRODUZIDO × % (cirúrgicos) ou valor fixo (exames)</span>
            </label>
            <label class="rl-aj-chk-linha">
              <input type="checkbox" data-base="BASE_CONVENIO" ${cfg.baseConvenio ? 'checked' : ''}>
              <span><strong>Convênio</strong> — usa valor fixo (R$ × QTD para cirúrgicos)</span>
            </label>
          </div>
        </div>

        <!-- Valores: EXAMES -->
        <div class="rl-aj-bloco">
          <div class="rl-aj-titulo">EXAMES — valor fixo por linha</div>
          <div class="rl-aj-tabela-valores">
            <div class="rl-aj-row-header"><div></div><div>Convênio (R$)</div><div>Particular (R$)</div></div>
            <div class="rl-aj-row">
              <div><strong>A</strong> · Ceratoscopia</div>
              <div><span class="rl-aj-num mono" data-config="VAL_A_CONV" data-valor="${cfg.VAL_A_CONV}">${formatarBR(cfg.VAL_A_CONV)}</span></div>
              <div><span class="rl-aj-num mono" data-config="VAL_A_PART" data-valor="${cfg.VAL_A_PART}">${formatarBR(cfg.VAL_A_PART)}</span></div>
            </div>
            <div class="rl-aj-row">
              <div><strong>B</strong> · Paquimetria</div>
              <div><span class="rl-aj-num mono" data-config="VAL_B_CONV" data-valor="${cfg.VAL_B_CONV}">${formatarBR(cfg.VAL_B_CONV)}</span></div>
              <div><span class="rl-aj-num mono" data-config="VAL_B_PART" data-valor="${cfg.VAL_B_PART}">${formatarBR(cfg.VAL_B_PART)}</span></div>
            </div>
          </div>
        </div>

        <!-- Valores: CIRÚRGICOS -->
        <div class="rl-aj-bloco">
          <div class="rl-aj-titulo">CIRÚRGICOS (C, D, E, F, G)</div>
          <div class="rl-aj-cir-grid">
            <div class="rl-aj-sub-bloco">
              <div class="rl-aj-sub-label">Convênio — valor por QTD</div>
              <div class="rl-aj-row" style="grid-template-columns: 1fr 1.3fr">
                <div>Monocular (QTD 1)</div>
                <div>R$ <span class="rl-aj-num mono" data-config="VAL_CIRUR_CONV_QTD1" data-valor="${cfg.VAL_CIRUR_CONV_QTD1}">${formatarBR(cfg.VAL_CIRUR_CONV_QTD1)}</span></div>
              </div>
              <div class="rl-aj-row" style="grid-template-columns: 1fr 1.3fr">
                <div>Binocular (QTD 2)</div>
                <div>R$ <span class="rl-aj-num mono" data-config="VAL_CIRUR_CONV_QTD2" data-valor="${cfg.VAL_CIRUR_CONV_QTD2}">${formatarBR(cfg.VAL_CIRUR_CONV_QTD2)}</span></div>
              </div>
            </div>
            <div class="rl-aj-sub-bloco">
              <div class="rl-aj-sub-label">Particular — percentual</div>
              <div class="rl-aj-row" style="grid-template-columns: 1fr 1.3fr">
                <div>% sobre PRODUZIDO</div>
                <div><span class="rl-aj-num mono" data-config="PCT_CIRUR_PART" data-valor="${cfg.PCT_CIRUR_PART}">${formatarBR(cfg.PCT_CIRUR_PART)}</span> %</div>
              </div>
            </div>
          </div>
          <div class="rl-aj-help-inline">Clique em qualquer número para editar.</div>
        </div>

        <!-- Vínculos -->
        <div class="rl-aj-bloco">
          <div class="rl-aj-titulo">Filtrar médicos por tipo de vínculo</div>
          <div class="rl-vinc-grid">
            ${tiposVinc.map(t => `
              <label class="rl-vinc-chk">
                <input type="checkbox" data-vinc="${t}" ${window.__rl.filtroVinculos.has(t) ? 'checked' : ''}>
                ${Utilidades.badgeVinculo(t)}<!-- V960: tag padrão de vínculo -->
              </label>
            `).join('')}
          </div>
          <div class="rl-aj-help">Filtra quais executantes contam na taxa.</div>
        </div>
      </div>
    `;
  }

  // V960: vincStyle saiu — a tag de vínculo é a padrão (Utilidades.badgeVinculo)

  // V739: o popover "Mostrar/Ocultar colunas" foi substituído pelo modal
  // 🛠 Ajuste de Matriz (abrirAjusteMatrizRL), padrão Fellow/Fracionamento.

  function renderPopoverRegras(cfg) {
    return `
      <div class="rl-overlay" data-popover="regras"></div>
      <div class="rl-popover rl-popover-regras">
        <div class="rl-popover-header">
          <h3>Regras — Refractive Laser</h3>
          <button class="rl-popover-close" data-popover="regras">×</button>
        </div>
        <div class="rl-regras-body">
          <div class="rl-regra-bloco">
            <div class="rl-regra-titulo"><span class="rl-regra-num">1</span> Conceito</div>
            <ul class="rl-regra-lista">
              <li>Taxa de uso/aluguel do aparelho Refractive Laser.</li>
              <li>Proprietária do equipamento: <strong>Dra. Maria Regina Catai Chalita</strong> (configurável).</li>
              <li>O hospital paga uma taxa por cada procedimento elegível realizado — independente de quem executou.</li>
            </ul>
          </div>

          <div class="rl-regra-bloco">
            <div class="rl-regra-titulo"><span class="rl-regra-num">2</span> Procedimentos elegíveis</div>
            <div style="font-size: 11px; color: var(--ink-soft); margin-bottom: 8px">
              7 procedimentos canônicos. As várias grafias do QVIS são reconhecidas automaticamente.
            </div>
            <table class="rl-regra-table">
              <thead><tr><th>Cód</th><th>Procedimento</th><th>Tipo</th></tr></thead>
              <tbody>
                ${Object.entries(SINONIMOS_RL).map(([c, info]) => `
                  <tr>
                    <td class="mono">${c}</td>
                    <td>${escapeHTML(info.label)}</td>
                    <td><span class="rl-tipo-mini" style="background:${info.tipo === 'EXAME' ? '#e4ecf4' : '#e4ecf4'};color:${info.tipo === 'EXAME' ? '#143352' : '#143352'}">${info.tipo}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div class="rl-regra-bloco">
            <div class="rl-regra-titulo"><span class="rl-regra-num">3</span> Filtros aplicados</div>
            <ul class="rl-regra-lista">
              <li>PAPEL = MEDICO ou CIRURGIAO (executantes); SOLICITANTE, MEDICO DE LAUDO e INDICANTE não entram.</li>
              <li>Vínculo do executante: <strong>Interno ou Híbrido</strong> (configurável em Ajustes).</li>
              <li>Bases ativas: Convênio e/ou Particular (configurável em Ajustes).</li>
            </ul>
          </div>

          <div class="rl-regra-bloco">
            <div class="rl-regra-titulo"><span class="rl-regra-num">4</span> Regras de cálculo</div>
            <div style="margin: 8px 0">
              <div class="rl-regra-formula">
                <strong>EXAMES (A, B)</strong> — valor FIXO por linha (QTD não influencia)<br>
                <span class="mono" style="font-size: 11px">A · Ceratoscopia: Conv R$ ${formatarBR(cfg.VAL_A_CONV)} · Part R$ ${formatarBR(cfg.VAL_A_PART)}</span><br>
                <span class="mono" style="font-size: 11px">B · Paquimetria: Conv R$ ${formatarBR(cfg.VAL_B_CONV)} · Part R$ ${formatarBR(cfg.VAL_B_PART)}</span>
              </div>
              <div class="rl-regra-formula" style="margin-top: 8px">
                <strong>CIRÚRGICOS (C–G)</strong><br>
                <span class="mono" style="font-size: 11px">Convênio: R$ ${formatarBR(cfg.VAL_CIRUR_CONV_QTD1)} (mono QTD=1) · R$ ${formatarBR(cfg.VAL_CIRUR_CONV_QTD2)} (bi QTD=2)</span><br>
                <span class="mono" style="font-size: 11px">Particular: ${formatarBR(cfg.PCT_CIRUR_PART)}% × PRODUZIDO da linha</span>
              </div>
            </div>
          </div>

          <div class="rl-regra-bloco">
            <div class="rl-regra-titulo"><span class="rl-regra-num">5</span> Lateralidade (QTD efetiva)</div>
            <ul class="rl-regra-lista">
              <li>A QTD é tirada <strong>diretamente da coluna QUANTIDADE</strong> do relatório QVIS.</li>
              <li>QTD = 1 (monocular) → R$ ${formatarBR(cfg.VAL_CIRUR_CONV_QTD1)}</li>
              <li>QTD = 2 (binocular) → R$ ${formatarBR(cfg.VAL_CIRUR_CONV_QTD2)}</li>
              <li>O nome do procedimento (mesmo contendo "BINOCULAR") <strong>não é considerado</strong> — pode haver procedimento com nome "BINOCULAR" mas QUANTIDADE = 1 (mono).</li>
            </ul>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // EVENTOS
  // ==========================================================================
  function bindEventos(cfg) {
    // V745: "Ajustes de regras" abre/fecha LOCALMENTE (sem renderizar()) —
    // o re-render só acontece quando uma regra realmente muda.
    const btnAj = document.getElementById('btn-rl-ajustes');
    if (btnAj) btnAj.addEventListener('click', (e) => {
      e.stopPropagation();
      if (document.getElementById('rl-pop-ajustes')) fecharPopoverAjustesRL();
      else abrirPopoverAjustesRL();
    });
    const btnInfo = document.getElementById('btn-rl-info');
    if (btnInfo) btnInfo.addEventListener('click', () => {
      fecharPaineisRL('regras');                       // V746: um painel por vez
      window.__rl.regrasAberto = !window.__rl.regrasAberto;
      renderizar();
    });
    // V739: "🛠 Ajuste de Matriz" (padrão Fellow/Fracionamento) substitui o
    // popover "⋮ Colunas" — modal com checkbox + renomear por coluna
    const btnAjM = document.getElementById('btn-rl-ajuste-matriz');
    if (btnAjM) btnAjM.addEventListener('click', abrirAjusteMatrizRL);
    // Botão de ocultar valores (visual) — usa toggle global de Utilidades
    // Botão "Visualização" (padrão .atlas-vis-*) — Mostrar tudo / Ocultar valores
    const btnVisRl = document.getElementById('btn-rl-visualizacao');
    if (btnVisRl) btnVisRl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.__rl.menuVisaoAberto) fecharMenuVisaoRL();
      else abrirMenuVisaoRL();
    });
    // V745: menu/popover abrem e fecham LOCALMENTE (sem renderizar()) — aqui
    // só descartamos sobras de um render anterior.
    fecharMenuVisaoRL();
    fecharPopoverAjustesRL();
    vigiarSaidaTelaRL();                               // V746: limpa ao trocar de tela
    const btnExp = document.getElementById('btn-rl-exportar');
    if (btnExp) btnExp.addEventListener('click', () => exportarExcel(cfg));

    document.querySelectorAll('[data-popover]').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-popover]') !== el) return;
        const p = el.dataset.popover;
        if (p === 'ajustes') { fecharPopoverAjustesRL(); return; }   // V745: local
        if (p === 'regras')  window.__rl.regrasAberto  = false;
        renderizar();
      });
    });

    // V732: fileira de filtros 20C (Ano/Mês/Categoria/combos viraram células)
    bindBarraFiltrosRL20C();

    const btnLimp = document.getElementById('btn-rl-limpar-filtros');
    if (btnLimp) btnLimp.addEventListener('click', () => {
      window.__rl.filtroCodAdmissao = '';
      window.__rl.filtroCodPaciente = '';
      window.__rl.filtroNomePaciente = '';
      window.__rl.filtroCategoria = '';
      renderizar();
    });

    // V739: largura de colunas ajustável (alças nos th, persiste)
    setupResizeColunasRL();
  }

  /**
   * V739: largura de colunas ajustável na matriz — alças de arraste nos th
   * (mesmo mecanismo do LIO V721/Fracionamento), persistência em localStorage.
   */
  // ────────────────────────────────────────────────────────────────────────
  // V745: MENU "VISUALIZAÇÃO" e POPOVER "AJUSTES DE REGRAS" — 100% LOCAIS
  // Abrir/fechar NÃO re-renderiza a tela (era a origem do engasgo: cada
  // clique recalculava KPIs, refazia o DOM inteiro e remontava o leque).
  // Ambos são montados sob demanda no <body>, por cima de tudo, e ancorados
  // no que estiver visível: o botão do header ou, quando o leque
  // (#atlas-hub) absorve os botões, a própria fita "Visualização".
  // ────────────────────────────────────────────────────────────────────────

  /**
   * V746: os painéis do módulo são MUTUAMENTE EXCLUSIVOS — abrir um fecha os
   * outros (antes o menu de Visualização ficava por cima do popover de
   * Ajustes, os dois abertos ao mesmo tempo). Também é o que limpa tudo ao
   * sair da tela.
   */
  function fecharPaineisRL(exceto) {
    if (exceto !== 'visao')   fecharMenuVisaoRL();
    if (exceto !== 'ajustes') fecharPopoverAjustesRL();
    if (exceto !== 'matriz')  document.getElementById('rl-ajm-pop')?.remove();
    if (exceto !== 'regras' && window.__rl.regrasAberto) {
      window.__rl.regrasAberto = false;
      document.querySelectorAll('.rl-popover-regras, .rl-overlay[data-popover="regras"]')
        .forEach(n => n.remove());
    }
  }

  /** Some com os painéis portados no <body> quando a tela sai do ar. */
  function vigiarSaidaTelaRL() {
    if (window.__rl._vigiaSaida) return;
    const alvo = document.getElementById('conteudo');
    if (!alvo) return;
    window.__rl._vigiaSaida = new MutationObserver(() => {
      if (!document.querySelector('.rl-page')) {
        fecharPaineisRL();
        window.__rl._vigiaSaida.disconnect();
        window.__rl._vigiaSaida = null;
      }
    });
    window.__rl._vigiaSaida.observe(alvo, { childList: true });
  }

  /** Elemento visível a que o menu deve se colar. */
  function ancoraVisaoRL() {
    const btn = document.getElementById('btn-rl-visualizacao');
    if (btn && btn.offsetParent !== null) return btn;      // header à mostra
    const hub = document.getElementById('atlas-hub');
    if (!hub) return null;
    const fita = [...hub.querySelectorAll('.hub-it')]
      .find(it => /VISUALIZA|OCULTOS/i.test(it.textContent || ''));
    return (fita && Number(getComputedStyle(fita).opacity) > 0.5)
      ? fita : hub.querySelector('.hub-btn');
  }

  /** Cola o menu logo abaixo da âncora, alinhado pela esquerda dela. */
  function posicionarMenuVisaoRL() {
    const menu = document.getElementById('rl-menu-visao');
    const alvo = ancoraVisaoRL();
    if (!menu || !alvo) return;
    const r = alvo.getBoundingClientRect();
    const larg = menu.offsetWidth || 280;
    menu.style.top = Math.round(r.bottom + 8) + 'px';
    if (alvo.classList.contains('hub-btn')) {              // clipe: alinha à direita
      menu.style.left = 'auto';
      menu.style.right = Math.round(Math.max(8, window.innerWidth - r.right)) + 'px';
    } else {
      menu.style.right = 'auto';
      menu.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - larg - 8))) + 'px';
    }
  }

  /** Rótulo/estado do botão (e da fita do leque) após trocar o modo. */
  function atualizarBotaoVisaoRL() {
    const oculto = Utilidades.valoresOcultos();
    const btn = document.getElementById('btn-rl-visualizacao');
    if (btn) {
      btn.classList.toggle('ativo', oculto);
      btn.innerHTML = (oculto ? '<i class="ti ti-eye-off"></i> Ocultos' : '👁 Visualização') + ' ▾';
    }
    const fita = [...document.querySelectorAll('#atlas-hub .hub-it')]
      .find(it => /VISUALIZA|OCULTOS/i.test(it.textContent || ''));
    const rot = fita && fita.querySelector('.hub-it-fita');
    if (rot) rot.textContent = oculto ? 'Ocultos' : 'Visualização';
  }

  function fecharMenuVisaoRL() {
    window.__rl.menuVisaoAberto = false;
    document.querySelectorAll('#rl-menu-visao').forEach(n => n.remove());
    if (window.__rl._fecharVisHandler) {
      document.removeEventListener('click', window.__rl._fecharVisHandler);
      window.__rl._fecharVisHandler = null;
    }
  }

  function abrirMenuVisaoRL() {
    fecharPaineisRL('visao');
    fecharMenuVisaoRL();
    window.__rl.menuVisaoAberto = true;
    const oculto = Utilidades.valoresOcultos();
    const menu = document.createElement('div');
    menu.className = 'atlas-vis-menu';
    menu.id = 'rl-menu-visao';
    menu.dataset.manterLeque = '1';       // leque remonta ABERTO (app.js V743b)
    menu.style.cssText = 'position:fixed; margin-top:0; z-index:3000;';
    menu.innerHTML = `
      <button class="atlas-vis-item ${!oculto ? 'ativo' : ''}" data-modo="tudo">
        <span class="atlas-vis-ico">👁</span>
        <span class="atlas-vis-txt"><strong>Mostrar tudo</strong><small>Exibição normal</small></span>
      </button>
      <button class="atlas-vis-item ${oculto ? 'ativo' : ''}" data-modo="oculto">
        <span class="atlas-vis-ico"><i class="ti ti-eye-off"></i></span>
        <span class="atlas-vis-txt"><strong>Ocultar valores</strong><small>Para compartilhar tela / fotografar</small></span>
      </button>`;
    document.body.appendChild(menu);
    posicionarMenuVisaoRL();

    // Escolher uma opção: aplica a máscara na hora (sem re-render) e recolhe
    // o menu E o leque.
    menu.querySelectorAll('.atlas-vis-item').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        Utilidades.setModoExibicao(b.dataset.modo);
        Utilidades.aplicarMascaraValores();
        atualizarBotaoVisaoRL();
        fecharMenuVisaoRL();
        document.getElementById('atlas-hub')?.classList.remove('aberto');
      });
    });

    // Clique fora: fecha o menu e recolhe o leque.
    const fora = (e) => {
      if (e.target.closest('#rl-menu-visao') || e.target.closest('#btn-rl-visualizacao')) return;
      fecharMenuVisaoRL();
      document.getElementById('atlas-hub')?.classList.remove('aberto');
    };
    window.__rl._fecharVisHandler = fora;
    setTimeout(() => {
      if (window.__rl._fecharVisHandler === fora) document.addEventListener('click', fora);
    }, 0);

    if (!window.__rl._reposBind) {
      window.__rl._reposBind = () => { if (window.__rl.menuVisaoAberto) posicionarMenuVisaoRL(); };
      window.addEventListener('scroll', window.__rl._reposBind, { passive: true, capture: true });
      window.addEventListener('resize', window.__rl._reposBind, { passive: true });
    }
  }

  // ── "Ajustes de regras": mesmo princípio (abre/fecha sem re-render) ──
  function fecharPopoverAjustesRL() {
    window.__rl.ajustesAberto = false;
    document.getElementById('rl-pop-ajustes')?.remove();
    if (window.__rl._fecharAjHandler) {
      document.removeEventListener('click', window.__rl._fecharAjHandler);
      window.__rl._fecharAjHandler = null;
    }
  }

  function abrirPopoverAjustesRL() {
    fecharPaineisRL('ajustes');
    fecharPopoverAjustesRL();
    window.__rl.ajustesAberto = true;
    const cfg = carregarConfig();
    const caixa = document.createElement('div');
    caixa.id = 'rl-pop-ajustes';
    caixa.innerHTML = renderPopoverAjustes(cfg, obterProprietario(cfg));
    document.body.appendChild(caixa);
    bindAjustesRL(caixa);
  }

  /** Handlers do popover de Ajustes (mudança de regra AÍ SIM re-renderiza). */
  function bindAjustesRL(raiz) {
    const refazer = () => {
      renderizar();                                   // dados mudaram: re-render
      if (document.getElementById('rl-pop-ajustes')) abrirPopoverAjustesRL();   // popover atualizado
    };
    raiz.querySelectorAll('[data-popover]').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-popover]') !== el) return;
        fecharPopoverAjustesRL();
      });
    });
    const selProp = raiz.querySelector('#rl-aj-proprietario');
    if (selProp) selProp.addEventListener('change', async () => {
      await salvarConfig('PROPRIETARIO_MEDICO_ID', selProp.value);
      refazer();
    });
    raiz.querySelectorAll('.rl-aj-num').forEach(span => {
      span.addEventListener('click', () => abrirEdicaoValor(span));
    });
    raiz.querySelectorAll('input[data-base]').forEach(chk => {
      chk.addEventListener('change', async () => {
        await salvarConfig(chk.dataset.base, chk.checked ? '1' : '0');
        refazer();
      });
    });
    raiz.querySelectorAll('input[data-vinc]').forEach(chk => {
      chk.addEventListener('change', () => {
        const t = chk.dataset.vinc;
        if (chk.checked) window.__rl.filtroVinculos.add(t);
        else window.__rl.filtroVinculos.delete(t);
        refazer();
      });
    });
  }

  function setupResizeColunasRL() {
    const tabela = document.querySelector('.rl-tabela');
    if (!tabela) return;
    const ler = () => {
      try { return JSON.parse(localStorage.getItem(RL_COLS_LARG_KEY) || '{}'); } catch (_) { return {}; }
    };
    const salvar = (l) => { try { localStorage.setItem(RL_COLS_LARG_KEY, JSON.stringify(l)); } catch (_) {} };
    const larguras = ler();
    Object.keys(larguras).forEach(idx => {
      const th = tabela.querySelector(`thead th[data-col="${idx}"]`);
      if (th && larguras[idx] >= 40) th.style.width = larguras[idx] + 'px';
    });
    tabela.querySelectorAll('.rl-col-resize').forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const idx = handle.dataset.resizeCol;
        const th = handle.parentElement;
        const startX = e.pageX;
        const startWidth = th.offsetWidth;
        document.body.classList.add('rl-redimensionando');
        handle.classList.add('rl-col-resize-ativa');
        const onMove = (ev) => { th.style.width = Math.max(40, startWidth + (ev.pageX - startX)) + 'px'; };
        const onUp = () => {
          document.body.classList.remove('rl-redimensionando');
          handle.classList.remove('rl-col-resize-ativa');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          const l = ler(); l[idx] = th.offsetWidth; salvar(l);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  /**
   * V739: 🛠 AJUSTE DE MATRIZ (padrão do Fellow V725/V728): modal no <body>
   * com, por coluna, checkbox mostrar/ocultar + nome padrão + input de
   * renomear. Persiste em localStorage; títulos valem na matriz e no Excel.
   */
  function abrirAjusteMatrizRL() {
    fecharPaineisRL('matriz');
    document.getElementById('rl-ajm-pop')?.remove();
    const cfg = window.__rl.configColunas || (window.__rl.configColunas = carregarConfigColunas());
    const pop = document.createElement('div');
    pop.id = 'rl-ajm-pop';
    pop.className = 'rl-ajm-fundo';
    pop.innerHTML = `
      <div class="rl-ajm-box" role="dialog" aria-modal="true">
        <h4>🛠 Ajuste de Matriz</h4>
        <p>Marque as colunas visíveis e personalize os títulos — vale na matriz e no cabeçalho do Excel.</p>
        <div class="rl-ajm-head"><span></span><span class="rl-ajm-orig">Nome padrão</span><span style="flex:1; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color: var(--ink-faint)">Título exibido</span></div>
        ${cfg.map((c, i) => {
          const padrao = COLUNAS_PADRAO.find(p => p.id === c.id);
          return `
          <label class="rl-ajm-linha">
            <input type="checkbox" class="rl-ajm-chk" data-col-idx="${i}" ${c.visivel ? 'checked' : ''} ${c.fixa ? 'disabled' : ''} title="${c.fixa ? 'Coluna fixa' : 'Mostrar/ocultar coluna'}">
            <span class="rl-ajm-orig" title="Nome padrão">${escapeHTML(padrao ? padrao.label : c.id)}${c.fixa ? ' <small>(fixa)</small>' : ''}</span>
            <input type="text" class="rl-ajm-inp" data-col-idx="${i}" value="${escapeAttr(c.label)}" maxlength="40">
          </label>`;
        }).join('')}
        <div class="rl-ajm-acoes">
          <button class="btn btn-secondary" id="rl-ajm-restaurar">Restaurar padrão</button>
          <span style="flex:1"></span>
          <button class="btn btn-secondary" id="rl-ajm-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="rl-ajm-salvar">Salvar</button>
        </div>
      </div>`;
    document.body.appendChild(pop);
    const fechar = () => pop.remove();
    pop.addEventListener('click', (e) => { if (e.target === pop) fechar(); });
    pop.querySelector('#rl-ajm-cancelar').addEventListener('click', fechar);
    pop.querySelector('#rl-ajm-restaurar').addEventListener('click', () => {
      pop.querySelectorAll('.rl-ajm-inp').forEach((inp) => {
        const c = cfg[Number(inp.dataset.colIdx)];
        const padrao = COLUNAS_PADRAO.find(p => p.id === c.id);
        inp.value = padrao ? padrao.label : c.label;
      });
      pop.querySelectorAll('.rl-ajm-chk').forEach((chk) => { chk.checked = true; });
    });
    pop.querySelector('#rl-ajm-salvar').addEventListener('click', () => {
      pop.querySelectorAll('.rl-ajm-inp').forEach((inp) => {
        const c = cfg[Number(inp.dataset.colIdx)];
        const v = inp.value.trim();
        if (v) c.label = v;
      });
      pop.querySelectorAll('.rl-ajm-chk').forEach((chk) => {
        const c = cfg[Number(chk.dataset.colIdx)];
        if (!c.fixa) c.visivel = chk.checked;
      });
      window.__rl.configColunas = cfg;
      salvarConfigColunas(cfg);
      fechar();
      Utilidades.toast('✓ Matriz atualizada (colunas e títulos)', 'success', 2500);
      renderizar();
    });
  }

  async function salvarConfig(chave, valor) {
    try {
      Banco.executar(`
        INSERT INTO config_refractive_laser (chave, valor) VALUES (?, ?)
        ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = CURRENT_TIMESTAMP
      `, [chave, String(valor)]);
      // V492: persistência coalescida — o dado já está no banco em memória e nada
      // após este ponto depende do flush no IndexedDB (só re-render).
      Banco.salvarDebounced();
    } catch (e) {
      console.error('Erro salvar config:', e);
      Utilidades.toast('Erro: ' + e.message, 'error');
    }
  }

  function abrirEdicaoValor(span) {
    const chave = span.dataset.config;
    const atual = Number(span.dataset.valor) || 0;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rl-aj-num-input mono';
    input.value = Utilidades.formatarNumero(atual, 2);
    span.replaceWith(input);
    input.focus();
    input.select();

    let salvo = false;
    const salvar = async () => {
      if (salvo) return;
      salvo = true;
      const novo = parseValor(input.value);
      if (novo !== atual) await salvarConfig(chave, String(novo));
      renderizar();
    };
    input.addEventListener('blur', salvar);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { salvo = true; renderizar(); }
    });
  }

  function parseValor(t) {
    if (!t) return 0;
    // V491: só trata ponto como milhar quando HÁ vírgula (antes "8.5" virava 85).
    let s = String(t).trim();
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const limpo = s.replace(/[^\d.-]/g, '');
    const n = parseFloat(limpo);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  // ==========================================================================
  // EXPORTAÇÃO
  // ==========================================================================
  function exportarExcel(cfg) {
    try {
      const comp = `${window.__rl.anoSelecionado}-${window.__rl.mesSelecionado}`;
      const filtros = {
        codAdmissao:  window.__rl.filtroCodAdmissao,
        codPaciente:  window.__rl.filtroCodPaciente,
        nomePaciente: window.__rl.filtroNomePaciente,
        categoria:    window.__rl.filtroCategoria,
      };
      const linhas = carregarLinhasRL(comp, filtros, cfg);
      const totalProd = linhas.reduce((s, l) => s + (l.produzido || 0), 0);
      const totalTaxa = linhas.reduce((s, l) => s + (l.taxa || 0), 0);

      const wb = XLSX.utils.book_new();
      // V739: títulos renomeados no 🛠 Ajuste de Matriz valem no cabeçalho
      const cfgCols = window.__rl.configColunas || carregarConfigColunas();
      const tituloExport = (id, padraoExport) => {
        const c = cfgCols.find(x => x.id === id);
        const p = COLUNAS_PADRAO.find(x => x.id === id);
        return (c && p && c.label && c.label !== p.label) ? c.label : padraoExport;
      };
      const rows = [[
        tituloExport('cod_admissao', 'Cód. Admissão'), tituloExport('paciente', 'Paciente'),
        tituloExport('categoria', 'Categoria'), tituloExport('procedimento', 'Procedimento'),
        tituloExport('medico', 'Executante'), 'Vínculo', tituloExport('origem', 'Origem'),
        tituloExport('qtd', 'QTD'), tituloExport('producao', 'Produção (R$)'),
        tituloExport('regra', 'Regra'), tituloExport('taxa', 'Taxa (R$)'),
      ]];
      for (const l of linhas) {
        rows.push([
          l.admissao, l.paciente || '', l.categoria,
          l.procedimento || '',
          l.nome_medico_oficial || l.nome_profissional || '',
          l.tipo_vinculo || '—',
          Utilidades.rotuloFonte(l.origem),   // V947
          l.qtd_efetiva,
          l.produzido || 0,
          l.regra || '',
          l.taxa || 0,
        ]);
      }
      rows.push([]);
      rows.push(['', '', '', '', '', '', '', '', totalProd, 'TOTAL TAXA', totalTaxa]);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [
        { wch: 14 }, { wch: 34 }, { wch: 12 }, { wch: 38 }, { wch: 26 },
        { wch: 12 }, { wch: 13 }, { wch: 7 }, { wch: 16 }, { wch: 22 }, { wch: 16 },
      ];
      // V741: valores em R$ SEMPRE com 2 casas — formato Contábil "R$"
      // (regra global de exportação V708) nas colunas Produção (8) e Taxa (10)
      Utilidades.aplicarFormatosExport(ws, { moeda: [8, 10] }, 1);
      XLSX.utils.book_append_sheet(wb, ws, 'Refractive Laser');
      XLSX.writeFile(wb, `RefractiveLaser_${comp}.xlsx`);
      Utilidades.toast('✓ Exportado', 'success');
    } catch (e) {
      console.error(e);
      alert('Erro: ' + e.message);
    }
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================
  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHTML(s); }

  // ==========================================================================
  // ESTILOS
  // ==========================================================================
  function getStyles() {
    // V492: retorna só o CSS (sem <style>) — injetado 1x via Utilidades.garantirEstilos
    return `
        .rl-titulo-wrap { display: flex; align-items: center; gap: 10px; }
        .rl-btn-info {
          width: 28px; height: 28px; border-radius: 50%;
          background: var(--bg-elevated); border: 1px solid var(--border);
          color: #2a5a8c; font-size: 15px; font-weight: 700;
          cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
          transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        }
        .rl-btn-info:hover { background: #2a5a8c; color: white; transform: scale(1.08); }
        /* V740: o menu "👁 Visualização" abria ATRÁS dos cards — a animação
           global (.page-content > *) transforma CADA filho direto em stacking
           context, então o z-index do .atlas-vis-wrap não valia contra os
           cards (que vêm depois no DOM). O z-index tem de estar no HEADER,
           que é o filho direto (mesmo padrão do .fel-header). */
        .rl-page > .page-header { position: relative; z-index: 100; }
        .rl-header-acoes { display: flex; gap: 8px; position: relative; z-index: 500; }

        .rl-snapshot-bar {
          display: flex; align-items: center; gap: 10px;
          margin: 14px 0 8px; padding: 8px 14px;
          background: linear-gradient(135deg, #e9edf1, #e4ecf4);
          border: 1px solid #9FE6C9;
          border-left: 4px solid #2a5a8c;
          border-radius: 8px;
        }
        .rl-snapshot-icone { font-size: 14px; }
        .rl-snapshot-label {
          font-size: 11px; font-weight: 700;
          letter-spacing: 0.05em; text-transform: uppercase;
          color: #102d4b;
        }
        .rl-snapshot-select {
          padding: 5px 10px; font-size: 13px; font-weight: 700;
          background: white; border: 1px solid #9FE6C9;
          color: var(--primary); cursor: pointer;
          border-radius: 5px;
        }
        .rl-snapshot-hint {
          font-size: 10px; color: #143352; font-style: italic;
          margin-left: auto;
        }
        /* V732: contêiner da peça 20C (.rl-sb) + botão "✕ Limpar" — a peça é
           IRMÃ do header e estica de ponta a ponta */
        .rl-filtros-bar {
          /* V734: o z-index precisa estar NO WRAPPER (filho direto do
             .page-content, que a animação global transforma em stacking
             context) — na peça interna não adianta e o painel abria atrás
             dos cards. */
          position: relative; z-index: 30;
          display: flex; flex-direction: column; gap: 6px;
          align-items: stretch; width: 100%; box-sizing: border-box;
          margin-top: 10px; padding: 0;
          background: transparent; border: none; border-radius: 0;
        }
        .rl-filtros-bar > .btn { align-self: flex-start; }
        .rl-secao-label {
          font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--ink-soft);
        }

        /* ── V732: fileira de filtros 20C (padrão do LIO/OPME, prefixo rl-sb) ── */
        .rl-sb {
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
        .rl-sb-celwrap { position: relative; min-width: 150px; display: flex; }
        .rl-sb-celwrap:not(:last-child) .rl-sb-cel { border-right: 1px solid #f0f4f8; }
        .rl-sb-cel {
          flex: 1; min-width: 0;
          display: flex; align-items: center; gap: 9px;
          padding: 9px 12px; border: none; border-radius: 9px;
          background: transparent; cursor: pointer;
          font-family: inherit; text-align: left;
          transition: background-color 120ms;
        }
        .rl-sb-cel:hover, .rl-sb-cel.ativo, .rl-sb-cel.aberta { background: #f6f4ef; }
        .rl-sb-cel:focus-visible { outline: 2px solid #2a5a8c; outline-offset: 2px; }
        .rl-sb-tile {
          width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: #f0f5f9; color: #5a6879;
        }
        .rl-sb-cel.ativo .rl-sb-tile, .rl-sb-cel.aberta .rl-sb-tile { background: #e4ecf4; color: #1d4470; }
        .rl-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
        .rl-sb-rot {
          font-size: 10px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .09em; color: #5a6879; white-space: nowrap;
        }
        .rl-sb-val {
          font-size: 13px; font-weight: 500; color: #5a6879;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .rl-sb-cel.ativo .rl-sb-val { font-weight: 700; color: #12304f; }
        .rl-sb-chev { color: #96a2b1; flex-shrink: 0; display: flex; transition: transform 140ms; }
        .rl-sb-cel.aberta .rl-sb-chev { transform: rotate(180deg); }

        /* painel ancorado na célula, por cima dos cards */
        .rl-sb-painel {
          position: absolute; top: 100%; left: 0; margin-top: 6px; z-index: 40;
          min-width: 100%; width: max-content; max-width: 340px;
          background: #fff; border: 1px solid #dfe4ea; border-radius: 12px;
          box-shadow: 0 18px 44px -14px rgba(11, 35, 64,.42);
          overflow: hidden;
        }
        .rl-sb-buscabox {
          display: flex; align-items: center; gap: 8px;
          padding: 11px 12px 10px; border-bottom: 1px solid #f0f4f8;
        }
        .rl-sb-buscabox .rl-sb-busca-ic { color: #6b7d8e; display: flex; }
        .rl-sb-busca {
          flex: 1; height: 30px; border: 1px solid #dfe4ea; border-radius: 8px;
          background: #f6f4ef; padding: 0 10px; font-size: 13px;
          font-family: inherit; color: #12304f; outline: none;
        }
        .rl-sb-busca::placeholder { color: #96a2b1; }
        .rl-sb-busca:focus { border-color: #2a5a8c; }
        .rl-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; }
        .rl-sb-lista::-webkit-scrollbar { width: 8px; }
        .rl-sb-lista::-webkit-scrollbar-track { background: #f0f4f8; }
        .rl-sb-lista::-webkit-scrollbar-thumb { background: #c5d5e5; border-radius: 4px; }
        .rl-sb-it {
          display: flex; align-items: center; gap: 10px;
          height: 38px; padding: 0 8px; border-radius: 8px; cursor: pointer;
          font-size: 13px; color: #12304f;
        }
        .rl-sb-it:hover, .rl-sb-it.foco { background: #f0f4f8; }
        .rl-sb-it.sel { background: #f0f4f8; font-weight: 700; }
        .rl-sb-it-todos { font-weight: 700; }
        .rl-sb-it-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rl-sb-ck { color: #1d4470; display: flex; }
        .rl-sb-rodape {
          padding: 7px 12px; border-top: 1px solid #f0f4f8;
          font-size: 10.5px; font-weight: 600; color: #96a2b1;
        }
        @media (max-width: 1280px) { .rl-sb-celwrap { flex-basis: 32%; } }
        @media (max-width: 900px)  { .rl-sb-celwrap { flex-basis: 48%; } }

        /* Cards */
        .rl-cards-grid {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px;
        }
        @media (max-width: 1000px) { .rl-cards-grid { grid-template-columns: repeat(2, 1fr); } }
        .rl-card {
          position: relative; padding: 12px 14px; border-radius: 10px; overflow: hidden;
          border: 1px solid transparent; display: flex; flex-direction: column;
        }
        .rl-card-faixa { position: absolute; top: 0; right: 0; bottom: 0; width: 3px; }
        .rl-card-titulo {
          font-size: 9px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.06em; margin-bottom: 6px;
        }
        .rl-card-valor { font-size: 20px; font-weight: 800; line-height: 1.1; }
        .rl-card-sub { padding-top: 6px; font-size: 10px; color: var(--ink-soft); line-height: 1.4; }
        /* V739: títulos dos cards totalizadores em #0f1d2e — a regra global
           V181 ([class*="-titulo"]) pinta #0F6E56 com !important; o override
           vence por vir DEPOIS no cascade (mesmo padrão do V718/V732). */
        .main .rl-card .rl-card-titulo { color: #0f1d2e !important; }
        .rl-card-verde   { background: linear-gradient(135deg, #E8F1EE, #D4E4DF); border-color: #A8C8C0; }
        .rl-card-verde .rl-card-faixa { background: #143352; }
        .rl-card-verde .rl-card-valor { color: #143352; }
        .rl-card-roxo    { background: linear-gradient(135deg, #ECE5F2, #DAC8E4); border-color: #C0A8D0; }
        .rl-card-roxo .rl-card-faixa { background: #6B4587; }
        .rl-card-roxo .rl-card-valor { color: #6B4587; }
        .rl-card-bege    { background: linear-gradient(135deg, #e9edf1, #e4ecf4); border-color: #9FE6C9; }
        .rl-card-bege .rl-card-faixa { background: #143352; }
        .rl-card-bege .rl-card-valor { color: #143352; }
        .rl-card-destaque { background: linear-gradient(135deg, #143352, #0b2340); border-color: #143352; box-shadow: 0 4px 12px rgba(20, 51, 82,.2); }
        .rl-card-destaque .rl-card-titulo { color: #5a6879; }
        .rl-card-destaque .rl-card-valor { color: #143352; }
        .rl-card-destaque .rl-card-sub { color: #c5d5e5; }
        .rl-card-breakdown { padding-top: 6px; display: flex; flex-direction: column; gap: 1px; font-size: 10px; }
        .rl-bd-item { display: flex; align-items: center; gap: 5px; color: var(--ink-soft); }
        .rl-bd-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
        .rl-bd-item strong { color: var(--ink); }
        .rl-card-comp {
          margin-top: 8px; padding-top: 6px;
          border-top: 1px dashed rgba(0,0,0,0.08);
          display: flex; gap: 10px; font-size: 10px;
        }
        .rl-card-comp-item { display: flex; align-items: center; gap: 4px; }
        .rl-card-comp-lbl { color: var(--ink-soft); font-weight: 600; font-size: 9px; white-space: nowrap; }
        .rl-comp-up    { color: #0A7A5A; font-weight: 700; }
        .rl-comp-down  { color: #9B3A3A; font-weight: 700; }
        .rl-comp-igual { color: var(--ink-soft); font-weight: 600; }
        .rl-comp-vazio { color: var(--ink-faint); }
        .rl-card-destaque .rl-card-comp { border-top-color: #5a6879; }
        .rl-card-destaque .rl-card-comp-lbl { color: #c5d5e5; }
        .rl-card-destaque .rl-comp-up    { color: #C8F5C0; }
        .rl-card-destaque .rl-comp-down  { color: #F5B5B5; }
        .rl-card-destaque .rl-comp-igual,
        .rl-card-destaque .rl-comp-vazio { color: #c5d5e5; }

        /* Card destacado da Taxa — V739: moldura #9FE6C9 → #1d4470 */
        .rl-card-taxa {
          background: linear-gradient(135deg, #e9edf1 0%, #e4ecf4 100%);
          border: 1px solid #1d4470;
          border-left: 5px solid #2a5a8c;
          border-radius: 12px;
          padding: 18px 22px;
          margin-bottom: 18px;
        }
        .rl-card-taxa-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
        .rl-card-taxa-icone { font-size: 20px; }
        .rl-card-taxa-titulo {
          font-size: 12px; font-weight: 700; color: #102d4b;
          text-transform: uppercase; letter-spacing: 0.06em;
        }
        .rl-card-taxa-info {
          display: grid; grid-template-columns: 1.8fr 1fr 1fr; gap: 18px;
          padding-bottom: 14px;
          border-bottom: 1px solid rgba(212, 190, 126, 0.6);
          margin-bottom: 14px;
        }
        @media (max-width: 800px) { .rl-card-taxa-info { grid-template-columns: 1fr; } }
        .rl-info-label {
          font-size: 9px; color: #143352; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;
        }
        .rl-info-valor { font-size: 14px; font-weight: 700; color: var(--ink); line-height: 1.3; }
        .rl-card-taxa-calc {
          background: #143352; color: #f6f4ef;
          padding: 12px 18px; border-radius: 8px;
        }
        .rl-calc-label {
          font-size: 10px; font-weight: 700; color: #2a5a8c;
          text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px;
        }
        .rl-calc-formula { font-size: 14px; font-weight: 600; color: #C8D6D2; }
        /* V739: valor da taxa total em branco (era #9FE6C9) */
        .rl-calc-resultado { font-size: 20px; font-weight: 800; color: #C8D6D2; margin-left: 4px; }   /* V994: era #FFFFFF */

        /* Tabela */
        .rl-tabela thead th {
          text-transform: none !important;
          letter-spacing: 0 !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          color: var(--ink) !important;
        }
        .rl-tabela tbody td { font-size: 12px; }
        .rl-medico-nome { font-weight: 600; }
        .rl-tipo-conv, .rl-tipo-part {
          display: inline-block; padding: 2px 8px;
          font-size: 10px; font-weight: 700; border-radius: 4px;
          letter-spacing: 0.04em; color: white;
        }
        .rl-tipo-conv { background: #102d4b; }
        .rl-tipo-part { background: #6B4587; }
        .rl-cat-badge {
          display: inline-block; padding: 3px 8px;
          font-size: 10px; font-weight: 700; border-radius: 4px;
          letter-spacing: 0.04em;
        }
        /* V740: o CSS da linha de TOTAL da matriz saiu junto com a linha. */

        /* Popovers */
        .rl-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 100; }
        .rl-popover {
          position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
          width: 620px; max-width: calc(100vw - 60px);
          max-height: calc(100vh - 100px); overflow-y: auto;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,0.2); z-index: 101;
        }
        .rl-popover-wide { width: 720px; }
        .rl-popover-regras { width: 720px; }
        .rl-popover-header {
          padding: 14px 18px; border-bottom: 1px solid var(--border);
          display: flex; justify-content: space-between; align-items: center;
        }
        .rl-popover-header h3 {
          margin: 0; font-family: var(--font-display); font-weight: 500; font-size: 16px;
        }
        .rl-popover-close {
          background: transparent; border: none; font-size: 22px;
          color: var(--ink-soft); cursor: pointer; padding: 0 4px;
        }
        .rl-aj-bloco { padding: 14px 20px; border-bottom: 1px solid var(--border); }
        .rl-aj-bloco:last-child { border-bottom: none; }
        .rl-aj-titulo {
          font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--primary); margin-bottom: 10px;
        }
        .rl-aj-select {
          width: 100%; padding: 8px 10px;
          border: 1px solid var(--border); border-radius: 6px;
          font-size: 13px; font-weight: 500; background: white;
        }
        .rl-aj-base-grid { display: flex; flex-direction: column; gap: 6px; }
        .rl-aj-chk-linha {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px; background: var(--bg-sunken);
          border: 1px solid var(--border); border-radius: 8px;
          cursor: pointer; font-size: 12px;
        }
        .rl-aj-chk-linha:hover { background: white; }

        .rl-aj-tabela-valores { display: flex; flex-direction: column; gap: 4px; }
        .rl-aj-row-header {
          display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 8px;
          font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--ink-soft); padding: 4px 10px; font-weight: 700;
        }
        .rl-aj-row {
          display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 8px;
          padding: 8px 10px; background: var(--bg-sunken);
          border: 1px solid var(--border); border-radius: 6px;
          font-size: 13px; align-items: center;
        }
        .rl-aj-cir-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 700px) { .rl-aj-cir-grid { grid-template-columns: 1fr; } }
        .rl-aj-sub-bloco {
          background: var(--bg-sunken); border: 1px solid var(--border);
          border-radius: 8px; padding: 10px 12px;
        }
        .rl-aj-sub-bloco .rl-aj-row {
          background: white;
          padding: 6px 10px;
          margin-top: 4px;
        }
        .rl-aj-sub-label {
          font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--ink-soft); font-weight: 700; margin-bottom: 4px;
        }
        .rl-aj-num { cursor: pointer; padding: 1px 6px; border-radius: 4px; font-weight: 700; color: var(--primary); }
        .rl-aj-num:hover { background: var(--bg-elevated); outline: 1px solid var(--border); }
        .rl-aj-num-input {
          font-family: var(--font-mono); font-size: 13px; font-weight: 700;
          padding: 1px 6px; border: 1px solid var(--accent); border-radius: 4px;
          width: 90px; outline: none; color: var(--primary);
        }
        .rl-aj-help-inline { font-size: 10px; color: var(--ink-faint); margin-top: 8px; font-style: italic; }
        .rl-aj-help { font-size: 10px; color: var(--ink-faint); margin-top: 8px; }

        .rl-vinc-grid { display: flex; gap: 12px; flex-wrap: wrap; }
        .rl-vinc-chk {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 10px; border: 1px solid var(--border); border-radius: 8px;
          cursor: pointer; background: var(--bg-sunken);
        }
        .rl-vinc-chk:hover { background: white; }

        /* ── V739: alças de resize nas colunas da matriz (padrão LIO/Frac) ── */
        .rl-tabela thead th { position: relative; }
        /* V864: título das colunas congelado. O cartão já rolava na horizontal
           (overflow: auto no inline style); faltava um TETO de altura para ele
           rolar na vertical — sem isso quem rolava era a página, e a fixação
           do cabeçalho não tinha a que grudar. */
        .rl-tabela-scroll { max-height: min(64vh, 760px); }
        .rl-tabela-scroll .rl-tabela thead th {
          position: sticky; top: 0; z-index: 3;
          background: var(--bg-sunken);
        }
        .rl-col-resize {
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          width: 6px;
          cursor: col-resize;
          z-index: 5;
          background: transparent;
          transition: background 150ms;
          user-select: none;
        }
        .rl-col-resize:hover,
        .rl-col-resize.rl-col-resize-ativa {
          background: linear-gradient(to right, transparent, var(--accent) 50%, transparent);
        }
        .rl-col-resize::after {
          content: '';
          position: absolute;
          right: 2px;
          top: 30%;
          bottom: 30%;
          width: 2px;
          background: rgba(42, 90, 140, 0.35);
          border-radius: 2px;
          transition: background-color 150ms, top 150ms, bottom 150ms;
        }
        .rl-col-resize:hover::after,
        .rl-col-resize.rl-col-resize-ativa::after {
          background: var(--accent);
          top: 15%;
          bottom: 15%;
        }
        body.rl-redimensionando,
        body.rl-redimensionando * { cursor: col-resize !important; user-select: none !important; }

        /* ── V739: modal 🛠 Ajuste de Matriz (padrão Fellow/Frac) ── */
        .rl-ajm-fundo {
          position: fixed; inset: 0; z-index: 4000;
          background: rgba(4, 26, 32, 0.45);
          display: flex; align-items: center; justify-content: center;
        }
        .rl-ajm-box {
          background: white; border-radius: 12px;
          width: 460px; max-width: calc(100vw - 40px); max-height: 82vh; overflow: auto;
          padding: 18px 20px;
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.25);
        }
        .rl-ajm-box h4 { margin: 0 0 6px; font-size: 15px; }
        .rl-ajm-box p { margin: 0 0 14px; font-size: 12px; color: var(--ink-soft); }
        .rl-ajm-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
        .rl-ajm-head > span:first-child { width: 14px; }
        .rl-ajm-linha { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .rl-ajm-orig {
          width: 130px; flex-shrink: 0;
          font-size: 11px; color: var(--ink-soft);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .rl-ajm-inp {
          flex: 1; padding: 6px 9px; font-size: 12.5px;
          border: 1px solid var(--border); border-radius: 6px;
          font-family: inherit; color: var(--ink);
        }
        .rl-ajm-inp:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(79, 127, 176, .16); outline: none; }
        .rl-ajm-acoes { display: flex; gap: 8px; align-items: center; margin-top: 14px; }

        /* Regras */
        .rl-regras-body { padding: 4px 0; }
        .rl-regra-bloco { padding: 14px 22px; border-bottom: 1px solid var(--border); }
        .rl-regra-bloco:last-child { border-bottom: none; }
        .rl-regra-titulo {
          display: flex; align-items: center; gap: 10px;
          font-size: 13px; font-weight: 700; color: var(--primary);
          margin-bottom: 10px;
        }
        .rl-regra-num {
          display: inline-flex; align-items: center; justify-content: center;
          width: 22px; height: 22px; background: var(--primary); color: white;
          border-radius: 50%; font-size: 11px; font-weight: 700;
        }
        .rl-regra-lista {
          margin: 0; padding-left: 22px;
          font-size: 12px; color: var(--ink); line-height: 1.65;
        }
        .rl-regra-lista li { margin-bottom: 4px; }
        .rl-regra-lista code {
          background: var(--bg-sunken); padding: 1px 6px;
          border-radius: 3px; font-size: 11px;
        }
        .rl-regra-formula {
          background: var(--bg-sunken); padding: 10px 14px;
          border-left: 3px solid var(--accent); border-radius: 6px;
          font-size: 12px; color: var(--ink); line-height: 1.7;
        }
        .rl-regra-table {
          width: 100%; border-collapse: collapse; font-size: 11px;
        }
        .rl-regra-table th, .rl-regra-table td {
          padding: 6px 10px; text-align: left;
          border-bottom: 1px solid var(--border);
        }
        .rl-regra-table th {
          font-weight: 700; background: var(--bg-sunken);
          font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
        }
        .rl-tipo-mini {
          display: inline-block; padding: 1px 6px;
          font-size: 9px; font-weight: 700; border-radius: 3px;
          letter-spacing: 0.04em;
        }
    `;
  }

};
