/**
 * ============================================================================
 * TELA: Desempenho · Crosslink
 *
 * Conceito: TAXA SOBRE PROCEDIMENTOS (idêntico ao Luz Pulsada, com 2 diferenças)
 *   1) Filtro de procedimento: PROCEDIMENTO LIKE '%CROSSLINK%'
 *   2) Tipo de taxa: VALOR FIXO por procedimento (não percentual)
 *
 * A máquina de Crosslink é propriedade da Dra. Maria Regina Catai Chalita.
 * O hospital paga a ela R$ X (default R$ 288,00) POR cada procedimento de
 * Crosslink realizado — independentemente do médico que executou.
 *
 * Fonte dos dados: tabela linhas_qvis (Convênio + Particular)
 * Filtro de papel: MEDICO ou CIRURGIAO (executantes, ignora SOLICITANTE)
 * Filtro de vínculo: INTERNO ou HIBRIDO (configurável)
 *
 * Cálculo:  Taxa total = (admissões elegíveis) × VALOR_FIXO
 * ============================================================================
 */

App.telas['desempenho-crosslink'] = function () {

  // Meses por extenso (fileira de filtros 20C) — declarado AQUI no topo porque
  // renderizar() roda antes do resto do corpo da função (TDZ em const tardio).
  const MESES_EXT_CL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // Estado da tela
  if (window.__cl === undefined) {
    window.__cl = {
      anoSelecionado: null,
      mesSelecionado: null,
      mesPagamentoSelecionado: null,  // null = usa o mais recente
      ajustesAberto: false,
      regrasAberto: false,
      ocultarAberto: false,
      filtroCodAdmissao: '',
      filtroCodPaciente: '',
      filtroNomePaciente: '',
      filtroVinculos: new Set(['INTERNO', 'HIBRIDO']),
      configColunas: null,
      // Fileira de filtros 20C: qual célula está com o painel aberto (null = nenhuma)
      sbAberto: null,
    };
  }

  // ── Configuração de colunas da tabela principal ─────────────────────────
  const COLUNAS_PADRAO = [
    { id: 'cod_admissao',  label: 'Cód. Admissão', visivel: true, fixa: false },
    { id: 'data_admissao', label: 'Data',          visivel: true, fixa: false },
    { id: 'paciente',      label: 'Paciente',      visivel: true, fixa: true  },
    { id: 'procedimento',  label: 'Procedimento',  visivel: true, fixa: false },
    { id: 'medico',        label: 'Médico (usou aparelho)', visivel: true, fixa: false },
    { id: 'origem',        label: 'Origem',        visivel: true, fixa: false },
    { id: 'producao',      label: 'Produção (R$)', visivel: true, fixa: false },
    { id: 'taxa',          label: 'Taxa (R$)',     visivel: true, fixa: false },
  ];
  const STORAGE_KEY_COLS = 'cl_colunas_config_v1';

  function obterMesPagamentoAtivo() {
    if (window.__cl.mesPagamentoSelecionado) return window.__cl.mesPagamentoSelecionado;
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
    } catch (e) {
      return JSON.parse(JSON.stringify(COLUNAS_PADRAO));
    }
  }
  function salvarConfigColunas(cfg) {
    try { localStorage.setItem(STORAGE_KEY_COLS, JSON.stringify(cfg)); }
    catch (e) { console.warn('Não consegui salvar config de colunas:', e.message); }
  }

  renderizar();

  function renderizar() {
    try { _renderizarInterno(); }
    catch (e) {
      console.error('Erro Crosslink:', e);
      document.getElementById('conteudo').innerHTML = `
        <div class="page-content">
          <header class="page-header"><h2>Crosslink</h2></header>
          <div class="card" style="background: #FEE; border-color: #D88; padding: 18px">
            <h3 style="margin: 0 0 8px; color: #9B3A3A">⚠ Erro ao renderizar</h3>
            <pre style="font-size: 11px; white-space: pre-wrap; background: white; padding: 12px; border-radius: 8px">${escapeHTML(e.message)}\n\n${escapeHTML(e.stack || '')}</pre>
          </div>
        </div>
      `;
    }
  }

  function _renderizarInterno() {
    if (!window.__cl.configColunas) {
      window.__cl.configColunas = carregarConfigColunas();
    }

    const cfg = carregarConfig();
    const periodos = listarPeriodosCL();

    if (!window.__cl.anoSelecionado && periodos.length > 0) {
      const [ano, mes] = periodos[0].split('-');
      window.__cl.anoSelecionado = ano;
      window.__cl.mesSelecionado = mes;
    }

    const competencia = (window.__cl.anoSelecionado && window.__cl.mesSelecionado)
      ? `${window.__cl.anoSelecionado}-${window.__cl.mesSelecionado}`
      : null;

    const filtros = {
      codAdmissao:  window.__cl.filtroCodAdmissao,
      codPaciente:  window.__cl.filtroCodPaciente,
      nomePaciente: window.__cl.filtroNomePaciente,
    };

    // Carrega admissões do mês com filtros aplicados
    const admissoes = competencia ? carregarAdmissoesCL(competencia, filtros, cfg) : [];

    // KPIs do mês + comparativos LM e LY (mesma lógica do Estrabismo)
    const kpis = calcularKPIs(admissoes, cfg);
    let kpisLM = null, kpisLY = null, kpisYTD = null;
    if (competencia) {
      try {
        const compLM = compMesAnterior(competencia);
        const admLM = carregarAdmissoesCL(compLM, filtros, cfg);
        if (admLM.length > 0) kpisLM = calcularKPIs(admLM, cfg);
      } catch (e) {}
      try {
        const compLY = compAnoAnterior(competencia);
        const admLY = carregarAdmissoesCL(compLY, filtros, cfg);
        if (admLY.length > 0) kpisLY = calcularKPIs(admLY, cfg);
      } catch (e) {}
      try {
        const compsYTD = competenciasAteEsteMes(competencia);
        // V492: cache por mês do YTD — evita reconsultar até ~15 competências a cada
        // render quando nada foi gravado no banco. Chave inclui Banco._versao
        // (invalidada em qualquer gravação) + tudo que afeta o resultado
        // (mês de pagamento, filtros de texto, config de base, vínculos).
        if (!window.__cl._cacheAdmMes || window.__cl._cacheAdmMesVersao !== Banco._versao) {
          window.__cl._cacheAdmMes = new Map();
          window.__cl._cacheAdmMesVersao = Banco._versao;
        }
        const cacheYTD = window.__cl._cacheAdmMes;
        const sufixoChave = '|' + Banco._versao + '|' + obterMesPagamentoAtivo()
          + '|' + JSON.stringify(filtros) + '|' + JSON.stringify(cfg)
          + '|' + Array.from(window.__cl.filtroVinculos).sort().join(',');
        let admYTD = [];
        for (const c of compsYTD) {
          const chave = c + sufixoChave;                       // V492
          let admMes = cacheYTD.get(chave);                    // V492
          if (admMes === undefined) {
            admMes = carregarAdmissoesCL(c, filtros, cfg);
            cacheYTD.set(chave, admMes);                       // V492
          }
          admYTD = admYTD.concat(admMes);
        }
        kpisYTD = calcularKPIs(admYTD, cfg);
      } catch (e) {
        console.warn('Erro YTD:', e.message);
      }
    }

    // Dados do proprietário do equipamento
    const proprietario = obterProprietario(cfg);

    // V492: CSS injetado UMA vez no <head> (antes: <style> dentro do innerHTML a cada render)
    Utilidades.garantirEstilos('css-tela-crosslink', getStyles());

    document.getElementById('conteudo').innerHTML = `
      <div class="page-content cl-page">
        ${renderHeader()}
        ${window.__cl.ajustesAberto ? renderPopoverAjustes(cfg, proprietario) : ''}
        ${window.__cl.regrasAberto ? renderPopoverRegras(cfg) : ''}
        ${window.__cl.ocultarAberto ? renderPopoverOcultar() : ''}
        ${renderFiltros(periodos)}
        ${renderCards(kpis, kpisLM, kpisLY, kpisYTD, cfg, proprietario, competencia)}
        ${renderCardTaxa(kpis, cfg, proprietario, competencia)}
        ${renderTabela(admissoes, competencia, cfg)}
      </div>
    `;

    bindEventos(cfg);
  }

  // ==========================================================================
  // HEADER
  // ==========================================================================

  function renderHeader() {
    return `
      <header class="page-header">
        <div>
          <div class="cl-titulo-wrap">
            <h2>Crosslink</h2>
            <button class="cl-btn-info" id="btn-cl-info" title="Regras">ⓘ</button>
          </div>
          <div class="subtitle">Taxa sobre procedimentos · uso de equipamento de propriedade do médico</div>
        </div>
        <div class="cl-header-acoes">
          <div class="atlas-vis-wrap">
            <button class="btn ${Utilidades.valoresOcultos() ? 'ativo' : ''}" id="btn-cl-visualizacao" title="Modo de exibição">
              ${Utilidades.valoresOcultos() ? '<i class="ti ti-eye-off"></i> Ocultos' : '👁 Visualização'} ▾
            </button>
            ${window.__cl.menuVisaoAberto ? `
              <div class="atlas-vis-menu" id="cl-menu-visao">
                <button class="atlas-vis-item ${!Utilidades.valoresOcultos() ? 'ativo' : ''}" data-modo="tudo">
                  <span class="atlas-vis-ico">👁</span>
                  <span class="atlas-vis-txt"><strong>Mostrar tudo</strong><small>Exibição normal</small></span>
                </button>
                <button class="atlas-vis-item ${Utilidades.valoresOcultos() ? 'ativo' : ''}" data-modo="oculto">
                  <span class="atlas-vis-ico"><i class="ti ti-eye-off"></i></span>
                  <span class="atlas-vis-txt"><strong>Ocultar valores</strong><small>Para compartilhar tela / fotografar</small></span>
                </button>
              </div>
            ` : ''}
          </div>
          <button class="btn" id="btn-cl-mostrar-ocultar">⋮ Colunas</button>
          <button class="btn" id="btn-cl-ajustes">⚙ Ajustes</button>
          <button class="btn btn-primary" id="btn-cl-exportar">↓ Exportar Excel</button>
        </div>
      </header>
    `;
  }

  // ==========================================================================
  // FILTROS (mesmo padrão dos outros fichários)
  // ==========================================================================

  function renderFiltros(periodos) {
    // Banner de snapshot (sempre visível se tem dados)
    const snapshots = Utilidades.listarSnapshots();
    const mpAtivo = obterMesPagamentoAtivo();
    const snapshotBar = snapshots.length > 0 ? `
      <div class="cl-snapshot-bar">
        <span class="cl-snapshot-icone">📅</span>
        <span class="cl-snapshot-label">Mês de Pagamento:</span>
        <select class="cl-snapshot-select mono" id="cl-snapshot-select">
          ${snapshots.map(s => `<option value="${s}" ${s === mpAtivo ? 'selected' : ''}>${formatarComp(s)}</option>`).join('')}
        </select>
        ${snapshots.length > 1 ? `<span class="cl-snapshot-hint">${snapshots.length} snapshots disponíveis</span>` : ''}
      </div>
    ` : '';

    // V734: mesmo SEM procedimentos no mês a fileira 20C aparece (o usuário
    // relatava que o filtro "não foi implementado" — na base dele o CL estava
    // vazio e a tela caía no early-return sem a barra). A mensagem fica
    // ABAIXO da barra.
    if (periodos.length === 0) {
      return `
        ${snapshotBar}
        <div class="cl-filtros-bar">
          ${renderBarraFiltrosCl20C([], [])}
        </div>
        <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 30px 20px">
          <div style="color: var(--ink-faint); font-size: 13px">
            ${snapshots.length === 0
              ? 'Nenhum relatório QVIS importado ainda. Vá em <strong>Processamento → Importar QVIS</strong>.'
              : 'Nenhum procedimento de crosslink realizado este mês'}
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
    const anoAtual = window.__cl.anoSelecionado;
    const mesesDoAno = anosMap.get(anoAtual) || [];

    const temFiltros = Utilidades.filtroMulti.ativo(window.__cl.filtroCodAdmissao)
      || Utilidades.filtroMulti.ativo(window.__cl.filtroCodPaciente)
      || Utilidades.filtroMulti.ativo(window.__cl.filtroNomePaciente);

    return `
      ${snapshotBar}
      <div class="cl-filtros-bar">
        ${renderBarraFiltrosCl20C(anos, mesesDoAno.slice().sort())}
        ${temFiltros ? `<button class="btn btn-pequeno" id="btn-cl-limpar-filtros">✕ Limpar filtros</button>` : ''}
      </div>
    `;
  }

  // ── Fileira de filtros 20C (mesmo padrão do LIO/OPME, prefixo cl-sb) ──────
  // Individualidades do CL: Ano · Mês (sempre um mês selecionado — sem visão
  // anual) · Cód. Admissão · Cód. Paciente · Nome do Paciente. Painéis
  // abrem/fecham LOCAL (insertAdjacentHTML — zero re-render); aplicar seta a
  // MESMA chave de state dos handlers antigos e chama renderizar().
  // MESES_EXT_CL: ver topo do arquivo.
  function _clSbIc(nome) {
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
  function _clSbSvg(d, px, sw) {
    return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  function _clSbSemAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function renderBarraFiltrosCl20C(anos, mesesDoAno) {
    // guarda as listas pro painel abrir LOCAL depois, sem recoletar;
    // opções dos combos são carregadas sob demanda em painelCl20C (cache por render)
    window.__cl._sbOpcoes = { anos: anos.slice(), meses: mesesDoAno.slice() };
    const cel = (id, rotulo, valor, icone, flex, vazio = 'Todos') => {
      const ativo = !!valor;
      const estaAberta = window.__cl.sbAberto === id;
      return `
        <div class="cl-sb-celwrap" style="flex:${flex}">
          <button type="button" class="cl-sb-cel ${ativo ? 'ativo' : ''} ${estaAberta ? 'aberta' : ''}"
                  data-sb-cel="${id}" data-sb-vazio="${vazio}" role="combobox" aria-expanded="${estaAberta ? 'true' : 'false'}" aria-haspopup="listbox">
            <span class="cl-sb-tile">${_clSbSvg(_clSbIc(icone), 14, 2.1)}</span>
            <span class="cl-sb-tx">
              <span class="cl-sb-rot">${rotulo}</span>
              <span class="cl-sb-val">${escapeHTML(valor || vazio)}</span>
            </span>
            <span class="cl-sb-chev">${_clSbSvg(_clSbIc('chev'), 10, 2.8)}</span>
          </button>
          ${estaAberta ? painelCl20C(id) : ''}
        </div>`;
    };
    const mesLabel = window.__cl.mesSelecionado
      ? (MESES_EXT_CL[Number(window.__cl.mesSelecionado) - 1] || window.__cl.mesSelecionado)
      : '';
    // V922: rótulo dos filtros multi ("N selecionados")
    const FM = Utilidades.filtroMulti;
    const rotMulti = (f) => FM.ativo(f) ? FM.rotulo(f) : '';
    return `
      <div class="cl-sb" id="cl-sb">
        ${cel('ano', 'Ano', window.__cl.anoSelecionado || '', 'clock', 0.75, '—')}
        ${cel('mes', 'Mês', mesLabel, 'calendar', 0.9, '—')}
        ${cel('cod-adm', 'Cód. Admissão', rotMulti(window.__cl.filtroCodAdmissao), 'alignleft', 1.05)}
        ${cel('cod-pac', 'Cód. Paciente', rotMulti(window.__cl.filtroCodPaciente), 'hash', 1.05)}
        ${cel('nome-pac', 'Nome do Paciente', rotMulti(window.__cl.filtroNomePaciente), 'user', 1.35)}
      </div>`;
  }

  function painelCl20C(id) {
    const opc = window.__cl._sbOpcoes || (window.__cl._sbOpcoes = {});
    const item = (val, rotulo, sel) => `
      <div class="cl-sb-it ${sel ? 'sel' : ''} ${val === '' ? 'cl-sb-it-todos' : ''}" data-sb-item data-val="${escapeAttr(val)}" data-busca="${escapeAttr(_clSbSemAcento(rotulo))}" role="option" aria-selected="${sel ? 'true' : 'false'}">
        <span class="cl-sb-it-nome">${escapeHTML(rotulo)}</span>
        ${sel ? `<span class="cl-sb-ck">${_clSbSvg(_clSbIc('check'), 14, 2.5)}</span>` : ''}
      </div>`;
    const painelLista = (cel, pares, valAtual, { busca = false, todosRotulo = 'Todos', semTodos = false } = {}) => `
      <div class="cl-sb-painel" data-sb-painel="${cel}">
        ${busca ? `
          <div class="cl-sb-buscabox">
            <span class="cl-sb-busca-ic">${_clSbSvg(_clSbIc('search'), 15, 2.1)}</span>
            <input type="text" class="cl-sb-busca" data-sb-busca placeholder="Digite pra buscar" autocomplete="off">
          </div>` : ''}
        <div class="cl-sb-lista" role="listbox">
          ${semTodos ? '' : item('', todosRotulo, !valAtual)}
          ${pares.slice(0, 400).map(p => item(p.v, p.r, valAtual === p.v)).join('')}
        </div>
        ${busca ? `<div class="cl-sb-rodape" data-sb-contagem>${pares.length} opç${pares.length === 1 ? 'ão' : 'ões'}</div>` : ''}
      </div>`;
    if (id === 'ano') {
      // sem "Todos": um ano está sempre selecionado (igual ao select antigo)
      return painelLista('ano', (opc.anos || []).map(a => ({ v: a, r: a })), window.__cl.anoSelecionado || '', { semTodos: true });
    }
    if (id === 'mes') {
      // sem "Todos": o CL não tem visão anual — sempre um mês (igual ao select antigo)
      return painelLista('mes', (opc.meses || []).map(m => ({ v: m, r: MESES_EXT_CL[Number(m) - 1] || m })), window.__cl.mesSelecionado || '', { semTodos: true });
    }
    // Combos de texto: MESMA fonte que o combo antigo usava (carregarOpcoesCombo),
    // carregada sob demanda e cacheada até o próximo render
    if (!opc[id]) opc[id] = carregarOpcoesCombo(id);
    // V922: MULTI — checkbox por item, marcados no topo, busca sempre presente
    const FM = Utilidades.filtroMulti;
    const fAtual = id === 'cod-adm' ? window.__cl.filtroCodAdmissao
                 : id === 'cod-pac' ? window.__cl.filtroCodPaciente
                 : window.__cl.filtroNomePaciente;
    const sel = FM.sel(fAtual);
    const marcadas = opc[id].filter(o => sel.includes(String(o)));
    const demais = opc[id].filter(o => !sel.includes(String(o)));
    return `
      <div class="cl-sb-painel" data-sb-painel="${id}" data-sb-multi="1">
        <div class="cl-sb-buscabox">
          <span class="cl-sb-busca-ic">${_clSbSvg(_clSbIc('search'), 15, 2.1)}</span>
          <input type="text" class="cl-sb-busca" data-sb-busca placeholder="Digite pra buscar" autocomplete="off">
        </div>
        <div class="cl-sb-lista" role="listbox">
          ${item('', 'Todos', sel.length === 0)}
          ${[...marcadas, ...demais].slice(0, 400).map(o => item(o, o, sel.includes(String(o)))).join('')}
        </div>
        <div class="cl-sb-rodape" data-sb-contagem>${sel.length ? `${sel.length} selecionado${sel.length === 1 ? '' : 's'} · ` : ''}${opc[id].length} opç${opc[id].length === 1 ? 'ão' : 'ões'}</div>
      </div>`;
  }

  function bindBarraFiltrosCl20C() {
    const sb = document.getElementById('cl-sb');
    if (!sb) return;
    const fecharPainelLocal = () => {
      sb.querySelectorAll('.cl-sb-painel').forEach(p => p.remove());
      sb.querySelectorAll('.cl-sb-cel.aberta').forEach(c => { c.classList.remove('aberta'); c.setAttribute('aria-expanded', 'false'); });
      window.__cl.sbAberto = null;
    };
    const aplicar = (celId, val) => {
      // MESMAS chaves de state e MESMO re-render dos handlers antigos
      if (celId === 'ano') {
        window.__cl.anoSelecionado = val;
        const periodos = listarPeriodosCL();
        const mesesAno = periodos.filter(p => p.startsWith(val + '-'))
                                 .map(p => p.split('-')[1]).sort();
        window.__cl.mesSelecionado = mesesAno[0] || null;
      } else if (celId === 'mes') {
        window.__cl.mesSelecionado = val;
      } else {
        // V922: combos de texto viraram MULTI — alterna e mantém a lista aberta
        const FM = Utilidades.filtroMulti;
        const campo = celId === 'cod-adm' ? 'filtroCodAdmissao'
          : celId === 'cod-pac' ? 'filtroCodPaciente' : 'filtroNomePaciente';
        const buscaEl = sb.querySelector('[data-sb-busca]');
        window.__cl._sbBusca = buscaEl ? buscaEl.value : '';
        window.__cl[campo] = val === '' ? [] : FM.toggle(window.__cl[campo], val);
        renderizar();   // sbAberto continua — o painel re-abre marcado
        return;
      }
      window.__cl._sbBusca = '';
      window.__cl.sbAberto = null;
      renderizar();
    };
    const wireInputsPainel = () => {
      const busca = sb.querySelector('[data-sb-busca]');
      if (!busca) return;
      setTimeout(() => busca.focus(), 0);
      const filtrar = () => {
        const q = _clSbSemAcento(busca.value);
        const painel = busca.closest('.cl-sb-painel');
        let n = 0;
        painel.querySelectorAll('[data-sb-item]').forEach(el => {
          const mostra = el.classList.contains('cl-sb-it-todos') || el.classList.contains('sel') || !q || (el.dataset.busca || '').includes(q);
          el.style.display = mostra ? '' : 'none';
          if (mostra && !el.classList.contains('cl-sb-it-todos')) n++;
        });
        const cont = painel.querySelector('[data-sb-contagem]');
        if (cont) cont.textContent = `${n} opç${n === 1 ? 'ão' : 'ões'}`;
      };
      busca.addEventListener('input', filtrar);
      if (window.__cl._sbBusca) { busca.value = window.__cl._sbBusca; filtrar(); }   // V922
    };
    const abrirPainelLocal = (id) => {
      const jaAberto = window.__cl.sbAberto === id;
      fecharPainelLocal();
      window.__cl._sbBusca = '';   // V922: busca não vaza de um painel pro outro
      if (jaAberto) return;
      window.__cl.sbAberto = id;
      const btn = sb.querySelector(`[data-sb-cel="${id}"]`);
      btn.classList.add('aberta');
      btn.setAttribute('aria-expanded', 'true');
      btn.parentElement.insertAdjacentHTML('beforeend', painelCl20C(id));
      wireInputsPainel();
    };
    // V922: o painel pode vir aberto do template (re-render após marcar)
    if (window.__cl.sbAberto && sb.querySelector('.cl-sb-painel')) wireInputsPainel();
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
      if (!window.__cl.sbAberto) return;
      const painel = sb.querySelector('.cl-sb-painel');
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
    if (window.__clSbFechar) {
      document.removeEventListener('click', window.__clSbFechar);
      document.removeEventListener('keydown', window.__clSbEsc);
    }
    const fecharFora = (e) => {
      if (App.telaAtual !== 'desempenho-crosslink') return;
      if (window.__cl.sbAberto && !e.target.closest('#cl-sb')) fecharPainelLocal();
    };
    const escFecha = (e) => {
      if (App.telaAtual !== 'desempenho-crosslink') return;
      if (e.key === 'Escape' && window.__cl.sbAberto) fecharPainelLocal();
    };
    window.__clSbFechar = fecharFora;
    window.__clSbEsc = escFecha;
    document.addEventListener('click', fecharFora);
    document.addEventListener('keydown', escFecha);
    if (window.__cl.sbAberto) wireInputsPainel();
  }

  function carregarOpcoesCombo(tipo) {
    if (!window.__cl.anoSelecionado || !window.__cl.mesSelecionado) return [];
    const comp = `${window.__cl.anoSelecionado}-${window.__cl.mesSelecionado}`;
    const mp = obterMesPagamentoAtivo();
    if (!mp) return [];
    const coluna = tipo === 'cod-adm' ? 'admissao'
                 : tipo === 'cod-pac' ? 'cod_paciente'
                 : 'paciente';
    const rows = Banco.query(`
      SELECT DISTINCT ${coluna} AS v
      FROM linhas_qvis
      WHERE procedimento_normalizado LIKE '%CROSSLINK%'
        AND papel IN ('MEDICO', 'CIRURGIAO')
        AND competencia = ?
        AND mes_pagamento = ?
        AND ${coluna} IS NOT NULL AND ${coluna} != ''
      ORDER BY ${coluna}
      LIMIT 500
    `, [comp, mp]);
    return rows.map(r => String(r.v));
  }

  // ==========================================================================
  // CARDS KPI (4)
  // ==========================================================================

  function renderCards(k, kLM, kLY, kYTD, cfg, prop, competencia) {
    if (!competencia) return '';

    const badge = (atual, comp) => {
      if (comp === null || comp === undefined) return '<span class="cl-comp-vazio">—</span>';
      if (!comp) {
        if (atual > 0) return `<span class="cl-comp-up">↑ novo</span>`;
        return `<span class="cl-comp-igual">↔ 0,0%</span>`;
      }
      const pct = ((atual - comp) / comp) * 100;
      if (Math.abs(pct) < 0.05) return `<span class="cl-comp-igual">↔ 0,0%</span>`;
      const cls = pct > 0 ? 'cl-comp-up' : 'cl-comp-down';
      const seta = pct > 0 ? '↑' : '↓';
      return `<span class="${cls}">${seta} ${Utilidades.formatarNumero(Math.abs(pct), 1)}%</span>`;
    };

    const linhaComp = (atual, valLM, valLY) => `
      <div class="cl-card-comp">
        <div class="cl-card-comp-item"><span class="cl-card-comp-lbl">vs LM</span> ${badge(atual, valLM)}</div>
        <div class="cl-card-comp-item"><span class="cl-card-comp-lbl">vs LY</span> ${badge(atual, valLY)}</div>
      </div>
    `;

    const valFixo = Number(cfg.valorFixo) || 0;

    return `
      <div class="cl-cards-grid">
        <!-- Card 1: Admissões + breakdown -->
        <div class="cl-card cl-card-verde">
          <div class="cl-card-faixa"></div>
          <div class="cl-card-titulo">Admissões de Crosslink</div>
          <div class="cl-card-valor mono" data-ocultavel>${k.admissoes}</div>
          <div class="cl-card-breakdown">
            <div class="cl-bd-item"><span class="cl-bd-dot" style="background: #003A54"></span> Convênio: <strong data-ocultavel>${k.admConvenio}</strong></div>
            <div class="cl-bd-item"><span class="cl-bd-dot" style="background: #6B4587"></span> Particular: <strong data-ocultavel>${k.admParticular}</strong></div>
          </div>
          ${linhaComp(k.admissoes, kLM?.admissoes, kLY?.admissoes)}
        </div>

        <!-- Card 2: Admissões YTD -->
        <div class="cl-card cl-card-roxo">
          <div class="cl-card-faixa"></div>
          <div class="cl-card-titulo">Admissões YTD</div>
          <div class="cl-card-valor mono" data-ocultavel>${kYTD?.admissoes || 0}</div>
          <div class="cl-card-sub">Taxa YTD: <strong data-ocultavel>R$ ${Utilidades.formatarNumero((kYTD?.admissoes || 0) * valFixo, 0)}</strong></div>
        </div>

        <!-- Card 3: Produção do mês -->
        <div class="cl-card cl-card-bege">
          <div class="cl-card-faixa"></div>
          <div class="cl-card-titulo">Produção · Mês</div>
          <div class="cl-card-valor mono" data-ocultavel>R$ ${Utilidades.formatarNumero(k.producao, 0)}</div>
          ${linhaComp(k.producao, kLM?.producao, kLY?.producao)}
        </div>

        <!-- Card 4: Taxa total (destaque) — VALOR FIXO × admissões -->
        <div class="cl-card cl-card-destaque">
          <div class="cl-card-titulo">Taxa da Proprietária · Mês</div>
          <div class="cl-card-valor mono" data-ocultavel>R$ ${Utilidades.formatarNumero(k.taxa, 2)}</div>
          <div class="cl-card-sub"><span data-ocultavel>${k.admissoes}</span> × R$ ${Utilidades.formatarNumero(valFixo, 2)}</div>
          ${linhaComp(k.taxa, kLM ? kLM.admissoes * valFixo : null, kLY ? kLY.admissoes * valFixo : null)}
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // CARD DESTACADO — Detalhes da Taxa
  // ==========================================================================

  function renderCardTaxa(k, cfg, prop, competencia) {
    if (!competencia) return '';
    const valFixo = Number(cfg.valorFixo) || 0;
    const nomeProp = prop ? prop.nome_oficial : '(não configurada)';
    const bases = [];
    if (cfg.baseParticular) bases.push('Particular');
    if (cfg.baseConvenio)   bases.push('Convênio');
    const labelMes = formatarComp(competencia);

    return `
      <div class="cl-card-taxa">
        <div class="cl-card-taxa-header">
          <span class="cl-card-taxa-icone">🔧</span>
          <span class="cl-card-taxa-titulo">Taxa sobre Procedimentos · Máquina de Crosslink</span>
        </div>
        <div class="cl-card-taxa-info">
          <div class="cl-info-item">
            <div class="cl-info-label">Proprietária do equipamento</div>
            <div class="cl-info-valor">${escapeHTML(CodigoMedico.exibir(nomeProp))}</div>
          </div>
          <div class="cl-info-item">
            <div class="cl-info-label">Valor fixo por procedimento</div>
            <div class="cl-info-valor mono">R$ ${Utilidades.formatarNumero(valFixo, 2)}</div>
          </div>
          <div class="cl-info-item">
            <div class="cl-info-label">Bases consideradas</div>
            <div class="cl-info-valor" style="font-size: 11px">${bases.join(' + ') || '<em style="color: var(--ink-faint)">nenhuma</em>'}</div>
          </div>
        </div>
        <div class="cl-card-taxa-calc">
          <div class="cl-calc-label">CÁLCULO DA TAXA · ${labelMes}</div>
          <div class="cl-calc-formula mono">
            <span data-ocultavel>${k.admissoes}</span> procedimento${k.admissoes !== 1 ? 's' : ''} × R$ ${Utilidades.formatarNumero(valFixo, 2)}
            = <span class="cl-calc-resultado" data-ocultavel>R$ ${Utilidades.formatarNumero(k.taxa, 2)}</span>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // TABELA — admissões elegíveis
  // ==========================================================================

  function renderTabela(admissoes, competencia, cfg) {
    if (!competencia) return '';
    if (admissoes.length === 0) {
      return `
        <div class="cl-secao-label" style="margin-top: 22px">Admissões elegíveis</div>
        <div class="card" style="padding: 24px; text-align: center; color: var(--ink-faint)">
          Nenhuma admissão de Crosslink no período (ou todas foram filtradas por vínculo).
        </div>
      `;
    }

    const cols = (window.__cl.configColunas || COLUNAS_PADRAO).filter(c => c.visivel);
    const ths = cols.map(c => {
      const num = (c.id === 'producao' || c.id === 'taxa') ? 'class="num"' : '';
      return `<th ${num}>${escapeHTML(c.label)}</th>`;
    }).join('');

    // V970: a linha "Total / mês" da matriz SAIU — os cards totalizadores
    // (Produção · Mês e Taxa da Proprietária · Mês) já cumprem o papel.
    const valFixo = Number(cfg.valorFixo) || 0;

    return `
      <div class="cl-secao-label" style="margin-top: 22px">
        Admissões elegíveis
        <span style="font-weight: 500; text-transform: none; color: var(--ink-faint); margin-left: 6px">· ${admissoes.length} admiss${admissoes.length !== 1 ? 'ões' : 'ão'}</span>
      </div>
      <div class="card" style="padding: 0; overflow: hidden">
        <table class="data-table cl-tabela">
          <thead><tr>${ths}</tr></thead>
          <tbody>
            ${admissoes.map(a => renderLinhaAdmissao(a, cols, valFixo)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderLinhaAdmissao(a, cols, valFixo) {
    const proc = String(a.procedimento || '').replace(/^CROSSLINK\s*[-–(]?\s*/i, '').replace(/\)$/, '').trim() || a.procedimento;
    let origemBadge;
    origemBadge = Utilidades.badgeFonte(a.origem);   // V946: tag padrão da ferramenta

    const vinculoBadge = Utilidades.badgeTipoVinculo(a.tipo_vinculo) || '';

    const tds = cols.map(c => {
      if (c.id === 'cod_admissao')  return `<td class="mono">${escapeHTML(a.admissao || '')}</td>`;
      if (c.id === 'data_admissao') return `<td class="mono" style="white-space: nowrap; color: var(--ink-soft)">${Utilidades.formatarDataBR(a.data_admissao)}</td>`;
      if (c.id === 'paciente')      return `<td>${escapeHTML(a.paciente || '—')}</td>`;
      if (c.id === 'procedimento') return `<td title="${escapeAttr(a.procedimento || '')}">${escapeHTML(proc)}</td>`;
      if (c.id === 'medico')       return `<td>
        <div class="cl-medico-nome">${escapeHTML(CodigoMedico.exibir(a.nome_medico_oficial || a.nome_profissional || ''))}</div>
        ${vinculoBadge}
      </td>`;
      if (c.id === 'origem')       return `<td>${origemBadge}</td>`;
      if (c.id === 'producao')     return `<td class="num mono" data-ocultavel style="font-weight: 700; color: var(--primary)">R$ ${Utilidades.formatarNumero(a.base_calculo, 2)}</td>`;
      if (c.id === 'taxa')         return `<td class="num mono" data-ocultavel style="font-weight: 700; color: var(--accent)">R$ ${Utilidades.formatarNumero(valFixo, 2)}</td>`;
      return '<td></td>';
    }).join('');

    return `<tr>${tds}</tr>`;
  }

  // ==========================================================================
  // CÁLCULOS / DADOS
  // ==========================================================================

  function listarPeriodosCL() {
    try {
      const mp = obterMesPagamentoAtivo();
      if (!mp) return [];
      return Banco.query(`
        SELECT DISTINCT competencia FROM linhas_qvis
        WHERE procedimento_normalizado LIKE '%CROSSLINK%'
          AND papel IN ('MEDICO', 'CIRURGIAO')
          AND mes_pagamento = ?
        ORDER BY competencia DESC
      `, [mp]).map(r => r.competencia);
    } catch (e) {
      console.warn('Tabela linhas_qvis ainda não existe ou está vazia:', e.message);
      return [];
    }
  }

  function compMesAnterior(comp) {
    const [a, m] = comp.split('-').map(Number);
    const mPrev = m === 1 ? 12 : m - 1;
    const aPrev = m === 1 ? a - 1 : a;
    return `${aPrev}-${String(mPrev).padStart(2, '0')}`;
  }
  function compAnoAnterior(comp) {
    const [a, m] = comp.split('-').map(Number);
    return `${a - 1}-${String(m).padStart(2, '0')}`;
  }
  function competenciasAteEsteMes(comp) {
    const [ano, mes] = comp.split('-').map(Number);
    const lista = [];
    for (let i = 1; i <= mes; i++) lista.push(`${ano}-${String(i).padStart(2, '0')}`);
    return lista;
  }
  function formatarComp(comp) {
    if (!comp) return '—';
    const [a, m] = comp.split('-');
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return `${meses[Number(m) - 1] || m}/${a}`;
  }

  /**
   * Carrega as admissões elegíveis de Crosslink para um período.
   * Aplica todos os filtros: período, texto (combobox), vínculo do executante.
   * Retorna uma lista 1 elemento por admissão, já com:
   *   - base_calculo: produzido (particular) ou recebido (convênio) conforme cfg
   *   - nome_medico_oficial: nome resolvido pelo cadastro (se houver match)
   *   - tipo_vinculo: INTERNO/HIBRIDO/EXTERNO (ou null se não cadastrado)
   */
  function carregarAdmissoesCL(competencia, filtros, cfg) {
    const mp = obterMesPagamentoAtivo();
    if (!mp) return [];
    const where = [
      `procedimento_normalizado LIKE '%CROSSLINK%'`,
      `papel IN ('MEDICO', 'CIRURGIAO')`,
      `competencia = ?`,
      `mes_pagamento = ?`,
    ];
    const params = [competencia, mp];

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
      SELECT admissao, paciente, cod_paciente, data_admissao,
             procedimento, nome_profissional, nome_normalizado,
             origem, tipo_recebimento, convenio,
             produzido, recebido
      FROM linhas_qvis
      WHERE ${where.join(' AND ')}
      ORDER BY data_admissao
    `, params);

    if (linhas.length === 0) return [];

    // Resolve médicos via cadastro (medicos + sinonimos)
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

    // Agrupa por admissão (consolida MEDICO + CIRURGIAO se ambos aparecerem)
    const admMap = new Map();
    for (const l of linhas) {
      const cod = String(l.admissao);
      const cad = cadMap.get(l.nome_normalizado);
      const tipo_vinculo = cad ? cad.tipo_vinculo : null;
      const nome_oficial = cad ? cad.nome_oficial : null;

      // Base de cálculo conforme origem
      let base = 0;
      if (l.origem === 'CONVENIO' && cfg.baseConvenio) {
        base = Number(l.recebido) || 0;
      } else if (l.origem === 'PARTICULAR' && cfg.baseParticular) {
        base = Number(l.produzido) || 0;
      }

      if (!admMap.has(cod)) {
        admMap.set(cod, {
          admissao: cod,
          paciente: l.paciente,
          cod_paciente: l.cod_paciente,
          data_admissao: l.data_admissao,
          procedimento: l.procedimento,
          nome_profissional: l.nome_profissional,
          nome_normalizado: l.nome_normalizado,
          nome_medico_oficial: nome_oficial,
          tipo_vinculo,
          origem: l.origem,
          convenio: l.convenio,
          base_calculo: base,
        });
      }
    }

    // Aplica filtro de vínculo (default: só IH)
    const tiposPermitidos = window.__cl.filtroVinculos;
    const resultado = [];
    for (const adm of admMap.values()) {
      const tv = adm.tipo_vinculo || 'EXTERNO';
      if (!tiposPermitidos.has(tv)) continue;
      resultado.push(adm);
    }

    return resultado;
  }

  function carregarConfig() {
    const cfg = {};
    try {
      Banco.query('SELECT chave, valor FROM config_crosslink').forEach(r => {
        cfg[r.chave] = r.valor;
      });
    } catch (e) {}
    return {
      valorFixo:      parseFloat(cfg.VALOR_FIXO || '288.00') || 0,
      proprietarioId: cfg.PROPRIETARIO_MEDICO_ID || '',
      baseParticular: (cfg.BASE_PARTICULAR ?? '1') === '1',
      baseConvenio:   (cfg.BASE_CONVENIO   ?? '1') === '1',
    };
  }

  function obterProprietario(cfg) {
    if (!cfg.proprietarioId) {
      // Sem proprietário configurado: tenta achar a Maria Regina Catai automaticamente
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
      return Banco.queryUnica(`
        SELECT id, nome_oficial, tipo_vinculo
        FROM medicos
        WHERE id = ? AND ativo = 1
      `, [cfg.proprietarioId]);
    } catch (e) { return null; }
  }

  function calcularKPIs(admissoes, cfg) {
    const k = {
      admissoes:    admissoes.length,
      admConvenio:  0,
      admParticular:0,
      producao:     0,
      taxa:         0,
    };
    for (const a of admissoes) {
      if (a.origem === 'CONVENIO')   k.admConvenio++;
      else if (a.origem === 'PARTICULAR') k.admParticular++;
      k.producao += a.base_calculo || 0;
    }
    // Diferença chave do Luz Pulsada: taxa = N admissões × valor fixo
    const valFixo = Number(cfg.valorFixo) || 0;
    k.taxa = k.admissoes * valFixo;
    return k;
  }

  // ==========================================================================
  // POPOVERS
  // ==========================================================================

  function renderPopoverAjustes(cfg, propAtual) {
    // Lista de médicos para o select (ativos)
    const medicos = Banco.query(`
      SELECT id, nome_oficial, tipo_vinculo
      FROM medicos WHERE ativo = 1
      ORDER BY nome_oficial
    `);
    const propId = propAtual ? String(propAtual.id) : '';
    const tiposVinc = ['INTERNO', 'HIBRIDO', 'EXTERNO'];
    const labelVinc = { INTERNO: 'Interno', HIBRIDO: 'Híbrido', EXTERNO: 'Externo' };

    return `
      <div class="cl-overlay" data-popover="ajustes"></div>
      <div class="cl-popover">
        <div class="cl-popover-header">
          <h3>Ajustes — Crosslink</h3>
          <button class="cl-popover-close" data-popover="ajustes">×</button>
        </div>

        <!-- Bloco 1: Taxa -->
        <div class="cl-aj-bloco">
          <div class="cl-aj-titulo">Taxa sobre procedimentos</div>

          <div class="cl-aj-campo">
            <label class="cl-aj-label">Proprietária do aparelho</label>
            <select class="cl-aj-select" id="cl-aj-proprietario">
              <option value="">— Auto (tenta achar pela Fabíola Gavioli) —</option>
              ${medicos.map(m => `
                <option value="${m.id}" ${String(m.id) === propId ? 'selected' : ''}>
                  ${escapeHTML(CodigoMedico.exibir(m.nome_oficial))}
                </option>
              `).join('')}
            </select>
          </div>

          <div class="cl-aj-campo">
            <label class="cl-aj-label">Valor fixo por procedimento</label>
            <div class="cl-aj-pct">
              <span style="font-weight: 700; color: var(--ink-soft)">R$</span>
              <span class="cl-aj-num mono" data-config="VALOR_FIXO" data-valor="${cfg.valorFixo}">${Utilidades.formatarNumero(cfg.valorFixo, 2)}</span>
            </div>
            <div class="cl-aj-help-inline">Clique no número para editar. Padrão: R$ 288,00</div>
          </div>

          <div class="cl-aj-campo">
            <label class="cl-aj-label">Bases consideradas (para contagem)</label>
            <div class="cl-aj-base-grid">
              <label class="cl-aj-chk-linha">
                <input type="checkbox" data-base="BASE_PARTICULAR" ${cfg.baseParticular ? 'checked' : ''}>
                <span><strong>Particular</strong> — incluir admissões particulares</span>
              </label>
              <label class="cl-aj-chk-linha">
                <input type="checkbox" data-base="BASE_CONVENIO" ${cfg.baseConvenio ? 'checked' : ''}>
                <span><strong>Convênio</strong> — incluir admissões de convênio</span>
              </label>
            </div>
          </div>
        </div>

        <!-- Bloco 2: Vínculos -->
        <div class="cl-aj-bloco">
          <div class="cl-aj-titulo">Filtrar médicos por tipo de vínculo</div>
          <div class="cl-vinc-grid">
            ${tiposVinc.map(t => `
              <label class="cl-vinc-chk">
                <input type="checkbox" data-vinc="${t}" ${window.__cl.filtroVinculos.has(t) ? 'checked' : ''}>
                ${Utilidades.badgeVinculo(t)}<!-- V960: tag padrão de vínculo -->
              </label>
            `).join('')}
          </div>
          <div class="cl-aj-help">Filtra quais admissões entram no cálculo da taxa.</div>
        </div>
      </div>
    `;
  }

  // V960: vincStyle saiu — a tag de vínculo é a padrão (Utilidades.badgeVinculo)

  function renderPopoverOcultar() {
    const cols = window.__cl.configColunas || COLUNAS_PADRAO;
    return `
      <div class="cl-overlay" data-popover="ocultar"></div>
      <div class="cl-popover">
        <div class="cl-popover-header">
          <h3>Mostrar/Ocultar colunas</h3>
          <button class="cl-popover-close" data-popover="ocultar">×</button>
        </div>
        <div class="cl-aj-bloco">
          <div class="cl-aj-titulo">Tabela principal</div>
          <div class="cl-ocultar-lista">
            ${cols.map(c => `
              <div class="cl-ocultar-linha ${c.fixa ? 'cl-ocultar-fixa' : ''}">
                <label class="cl-ocultar-chk" title="${c.fixa ? 'Coluna fixa' : 'Marcar para mostrar'}">
                  <input type="checkbox"
                         data-col-id="${escapeAttr(c.id)}"
                         data-tipo="visivel"
                         ${c.visivel ? 'checked' : ''}
                         ${c.fixa ? 'disabled' : ''}>
                </label>
                <input type="text" class="cl-ocultar-input"
                       data-col-id="${escapeAttr(c.id)}" data-tipo="label"
                       value="${escapeAttr(c.label)}" placeholder="Nome">
                ${c.fixa ? '<span class="cl-ocultar-fixa-tag">fixa</span>' : ''}
              </div>
            `).join('')}
          </div>
          <div class="cl-ocultar-acoes">
            <button class="btn btn-pequeno" id="btn-cl-ocultar-restaurar">↺ Restaurar padrão</button>
            <span class="cl-aj-help" style="margin: 0">Aplicado automaticamente.</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderPopoverRegras(cfg) {
    return `
      <div class="cl-overlay" data-popover="regras"></div>
      <div class="cl-popover cl-popover-regras">
        <div class="cl-popover-header">
          <h3>Regras — Crosslink</h3>
          <button class="cl-popover-close" data-popover="regras">×</button>
        </div>
        <div class="cl-regras-body">
          <div class="cl-regra-bloco">
            <div class="cl-regra-titulo"><span class="cl-regra-num">1</span> Conceito</div>
            <ul class="cl-regra-lista">
              <li>Esta NÃO é uma comissão por procedimento nem cargo administrativo.</li>
              <li>É uma <strong>taxa de uso/aluguel</strong> da máquina de Crosslink, que pertence à proprietária configurada.</li>
              <li>O hospital paga a ela um <strong>valor fixo por cada procedimento</strong> realizado — independentemente de quem executou e do valor produzido.</li>
            </ul>
          </div>
          <div class="cl-regra-bloco">
            <div class="cl-regra-titulo"><span class="cl-regra-num">2</span> Origem dos dados</div>
            <ul class="cl-regra-lista">
              <li>Linhas vêm dos relatórios <strong>QVIS</strong> (Convênio + Particular).</li>
              <li>Filtro: <code>PROCEDIMENTO LIKE '%CROSSLINK%'</code>.</li>
              <li>Apenas papéis <strong>MEDICO ou CIRURGIAO</strong> (executantes) — ignora SOLICITANTE para evitar duplicação.</li>
            </ul>
          </div>
          <div class="cl-regra-bloco">
            <div class="cl-regra-titulo"><span class="cl-regra-num">3</span> Filtro de vínculo</div>
            <ul class="cl-regra-lista">
              <li>Default: apenas executantes <strong>Internos ou Híbridos</strong> (igual regras anteriores).</li>
              <li>Configurável em ⚙ Ajustes.</li>
            </ul>
          </div>
          <div class="cl-regra-bloco">
            <div class="cl-regra-titulo"><span class="cl-regra-num">4</span> Bases consideradas</div>
            <ul class="cl-regra-lista">
              <li><strong>Particular</strong>: inclui admissões particulares na contagem.</li>
              <li><strong>Convênio</strong>: inclui admissões de convênio na contagem.</li>
              <li>Como a taxa é fixa por procedimento, a base afeta apenas <em>quais admissões contam</em>, não o valor.</li>
            </ul>
          </div>
          <div class="cl-regra-bloco">
            <div class="cl-regra-titulo"><span class="cl-regra-num">5</span> Cálculo da taxa</div>
            <div class="cl-regra-formula">
              <span class="mono">Taxa = (admissões elegíveis) × R$ ${Utilidades.formatarNumero(cfg.valorFixo, 2)}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // EVENTOS
  // ==========================================================================

  function bindEventos(cfg) {
    // Header
    const btnAj = document.getElementById('btn-cl-ajustes');
    if (btnAj) btnAj.addEventListener('click', () => {
      window.__cl.ajustesAberto = !window.__cl.ajustesAberto;
      window.__cl.regrasAberto = false;
      window.__cl.ocultarAberto = false;
      renderizar();
    });
    const btnInfo = document.getElementById('btn-cl-info');
    if (btnInfo) btnInfo.addEventListener('click', () => {
      window.__cl.regrasAberto = !window.__cl.regrasAberto;
      window.__cl.ajustesAberto = false;
      window.__cl.ocultarAberto = false;
      renderizar();
    });
    const btnOcultar = document.getElementById('btn-cl-mostrar-ocultar');
    if (btnOcultar) btnOcultar.addEventListener('click', () => {
      window.__cl.ocultarAberto = !window.__cl.ocultarAberto;
      window.__cl.ajustesAberto = false;
      window.__cl.regrasAberto = false;
      renderizar();
    });
    // Botão "Visualização" (padrão .atlas-vis-*) — Mostrar tudo / Ocultar valores
    const btnVisCl = document.getElementById('btn-cl-visualizacao');
    if (btnVisCl) btnVisCl.addEventListener('click', (e) => {
      e.stopPropagation();
      window.__cl.menuVisaoAberto = !window.__cl.menuVisaoAberto;
      renderizar();
    });
    document.querySelectorAll('#cl-menu-visao .atlas-vis-item').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        Utilidades.setModoExibicao(b.dataset.modo);
        window.__cl.menuVisaoAberto = false;
        renderizar();
      });
    });
    // V492: remove SEMPRE o listener do render anterior — antes acumulava: os itens
    // do menu usam stopPropagation, então ao fechar pelo botão/item o handler antigo
    // nunca disparava nem se removia, e cada abertura somava +1 listener global.
    if (window.__cl._fecharVisHandler) {
      document.removeEventListener('click', window.__cl._fecharVisHandler);
      window.__cl._fecharVisHandler = null;
    }
    if (window.__cl.menuVisaoAberto) {
      const fecharVisCl = (e) => {
        if (!e.target.closest('#cl-menu-visao') && !e.target.closest('#btn-cl-visualizacao')) {
          window.__cl.menuVisaoAberto = false;
          document.removeEventListener('click', fecharVisCl);
          if (window.__cl._fecharVisHandler === fecharVisCl) window.__cl._fecharVisHandler = null;  // V492
          renderizar();
        }
      };
      window.__cl._fecharVisHandler = fecharVisCl;  // V492: guarda referência p/ remoção incondicional
      // V492: só registra se ainda for o handler vigente (um re-render síncrono
      // entre o agendamento e o timeout já o descartou)
      setTimeout(() => {
        if (window.__cl._fecharVisHandler === fecharVisCl) {
          document.addEventListener('click', fecharVisCl);
        }
      }, 0);
    }
    const btnExp = document.getElementById('btn-cl-exportar');
    if (btnExp) btnExp.addEventListener('click', () => exportarExcel(cfg));

    // Fechar popovers
    document.querySelectorAll('[data-popover]').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-popover]') !== el) return;
        const p = el.dataset.popover;
        if (p === 'ajustes') window.__cl.ajustesAberto = false;
        if (p === 'regras')  window.__cl.regrasAberto  = false;
        if (p === 'ocultar') window.__cl.ocultarAberto = false;
        renderizar();
      });
    });

    // Fileira de filtros 20C (Ano/Mês/combos viraram células)
    bindBarraFiltrosCl20C();
    // Seletor de snapshot (mês de pagamento)
    const selSnap = document.getElementById('cl-snapshot-select');
    if (selSnap) selSnap.addEventListener('change', () => {
      window.__cl.mesPagamentoSelecionado = selSnap.value;
      window.__cl.anoSelecionado = null;
      window.__cl.mesSelecionado = null;
      renderizar();
    });

    const btnLimp = document.getElementById('btn-cl-limpar-filtros');
    if (btnLimp) btnLimp.addEventListener('click', () => {
      window.__cl.filtroCodAdmissao = '';
      window.__cl.filtroCodPaciente = '';
      window.__cl.filtroNomePaciente = '';
      renderizar();
    });

    // Ajustes: proprietário (select)
    const selProp = document.getElementById('cl-aj-proprietario');
    if (selProp) selProp.addEventListener('change', async () => {
      await salvarConfig('PROPRIETARIO_MEDICO_ID', selProp.value);
      renderizar();
    });

    // Ajustes: edição inline do percentual
    document.querySelectorAll('.cl-aj-num').forEach(span => {
      span.addEventListener('click', () => abrirEdicaoValor(span));
    });

    // Ajustes: checkboxes de base e vínculo
    document.querySelectorAll('input[data-base]').forEach(chk => {
      chk.addEventListener('change', async () => {
        await salvarConfig(chk.dataset.base, chk.checked ? '1' : '0');
        renderizar();
      });
    });
    document.querySelectorAll('input[data-vinc]').forEach(chk => {
      chk.addEventListener('change', () => {
        const t = chk.dataset.vinc;
        if (chk.checked) window.__cl.filtroVinculos.add(t);
        else window.__cl.filtroVinculos.delete(t);
        renderizar();
      });
    });

    // Mostrar/Ocultar colunas
    document.querySelectorAll('input[data-col-id]').forEach(el => {
      const tipo = el.dataset.tipo;
      if (tipo === 'visivel') {
        el.addEventListener('change', () => {
          const id = el.dataset.colId;
          const cfgCols = window.__cl.configColunas;
          const col = cfgCols.find(c => c.id === id);
          if (col && !col.fixa) {
            col.visivel = el.checked;
            salvarConfigColunas(cfgCols);
            renderizar();
          }
        });
      } else if (tipo === 'label') {
        let timer = null;
        const aplicar = () => {
          const id = el.dataset.colId;
          const cfgCols = window.__cl.configColunas;
          const col = cfgCols.find(c => c.id === id);
          if (col) {
            const novo = (el.value || '').trim();
            if (novo && novo !== col.label) {
              col.label = novo;
              salvarConfigColunas(cfgCols);
              renderizar();
            }
          }
        };
        el.addEventListener('input', () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(aplicar, 400);
        });
        el.addEventListener('blur', () => { if (timer) clearTimeout(timer); aplicar(); });
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
        });
      }
    });
    const btnRest = document.getElementById('btn-cl-ocultar-restaurar');
    if (btnRest) btnRest.addEventListener('click', () => {
      window.__cl.configColunas = JSON.parse(JSON.stringify(COLUNAS_PADRAO));
      salvarConfigColunas(window.__cl.configColunas);
      renderizar();
    });
  }

  async function salvarConfig(chave, valor) {
    try {
      Banco.executar(`
        INSERT INTO config_crosslink (chave, valor) VALUES (?, ?)
        ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = CURRENT_TIMESTAMP
      `, [chave, String(valor)]);
      // V492: persistência coalescida — o dado já está no banco em memória e nada
      // após este ponto depende do flush no IndexedDB (só re-render).
      Banco.salvarDebounced();
    } catch (e) {
      console.error('Erro ao salvar config:', e);
      Utilidades.toast('Erro: ' + e.message, 'error');
    }
  }

  function abrirEdicaoValor(span) {
    const chave = span.dataset.config;
    const atual = Number(span.dataset.valor) || 0;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cl-aj-num-input mono';
    input.value = Utilidades.formatarNumero(atual, 2);
    span.replaceWith(input);
    input.focus();
    input.select();

    let salvo = false;
    const salvar = async () => {
      if (salvo) return;
      salvo = true;
      const novo = parseValor(input.value);
      if (novo !== atual) {
        await salvarConfig(chave, String(novo));
      }
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
      const comp = `${window.__cl.anoSelecionado}-${window.__cl.mesSelecionado}`;
      const filtros = {
        codAdmissao:  window.__cl.filtroCodAdmissao,
        codPaciente:  window.__cl.filtroCodPaciente,
        nomePaciente: window.__cl.filtroNomePaciente,
      };
      const admissoes = carregarAdmissoesCL(comp, filtros, cfg);
      const total = admissoes.reduce((s, a) => s + (a.base_calculo || 0), 0);
      const valFixo = Number(cfg.valorFixo) || 0;
      const taxa = admissoes.length * valFixo;

      const wb = XLSX.utils.book_new();
      const rows = [['Cód. Admissão','Paciente','Procedimento','Médico','Vínculo','Origem','Produção (R$)','Taxa (R$)']];
      for (const a of admissoes) {
        rows.push([
          a.admissao,
          a.paciente || '',
          a.procedimento || '',
          a.nome_medico_oficial || a.nome_profissional || '',
          a.tipo_vinculo || '—',
          Utilidades.rotuloFonte(a.origem),   // V947
          a.base_calculo || 0,
          valFixo,
        ]);
      }
      rows.push([]);
      rows.push(['', '', '', '', '', 'TOTAL PRODUÇÃO', total, '']);
      rows.push(['', '', '', '', '', `${admissoes.length} adm × R$ ${Utilidades.formatarNumero(valFixo, 2)} = TAXA`, '', taxa]);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Crosslink');
      XLSX.writeFile(wb, `Crosslink_${comp}.xlsx`);
      Utilidades.toast('Excel gerado', 'success');
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
        .cl-titulo-wrap { display: flex; align-items: center; gap: 10px; }
        .cl-btn-info {
          width: 28px; height: 28px; border-radius: 50%;
          background: var(--bg-elevated); border: 1px solid var(--border);
          color: #189AD3; font-size: 15px; font-weight: 700;
          cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
          transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        }
        .cl-btn-info:hover { background: #189AD3; color: white; transform: scale(1.08); }
        .cl-header-acoes { display: flex; gap: 8px; }

        /* Filtros */
        .cl-snapshot-bar {
          display: flex; align-items: center; gap: 10px;
          margin: 14px 0 8px; padding: 8px 14px;
          background: linear-gradient(135deg, #E8F1F7, #DBF0F9);
          border: 1px solid var(--border);   /* V970: era #9FE6C9 */
          border-left: 4px solid #189AD3;
          border-radius: 8px;
        }
        .cl-snapshot-icone { font-size: 14px; }
        .cl-snapshot-label {
          font-size: 11px; font-weight: 700;
          letter-spacing: 0.05em; text-transform: uppercase;
          color: #003A54;
        }
        .cl-snapshot-select {
          padding: 5px 10px; font-size: 13px; font-weight: 700;
          background: white; border: 1px solid var(--border);   /* V970: era #9FE6C9 */
          color: var(--primary); cursor: pointer;
          border-radius: 5px;
        }
        .cl-snapshot-hint {
          font-size: 10px; color: #189AD3; font-style: italic;
          margin-left: auto;
        }
        /* Contêiner da peça 20C (.cl-sb) + botão "✕ Limpar filtros" —
           irmão do header, esticado de ponta a ponta */
        .cl-filtros-bar {
          display: flex; flex-direction: column; gap: 6px;
          align-items: stretch; width: 100%; box-sizing: border-box;
          margin-top: 10px;
          /* a animação de entrada (.page-content > * { transform }) cria um
             stacking context na barra; sem z-index aqui os painéis 20C ficariam
             ABAIXO dos cards (que também viram stacking contexts) */
          position: relative; z-index: 30;
        }
        .cl-filtros-bar > #btn-cl-limpar-filtros { align-self: flex-start; }
        .cl-secao-label {
          font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--ink-soft);
        }

        /* ── Fileira de filtros 20C (padrão do LIO/OPME, prefixo cl-sb) ── */
        .cl-sb {
          margin-bottom: 14px;   /* respiro antes dos cards */
          position: relative; z-index: 30;
          display: flex; align-items: stretch;
          padding: 6px;
          background: #fff;
          border: 1px solid #e2ebf2;
          border-radius: 12px;
          box-shadow: 0 1px 2px rgba(20,50,80,.04), 0 10px 26px -20px rgba(20,50,80,.26);
          flex-wrap: wrap;
        }
        .cl-sb-celwrap { position: relative; min-width: 150px; display: flex; }
        .cl-sb-celwrap:not(:last-child) .cl-sb-cel { border-right: 1px solid #eef3f7; }
        .cl-sb-cel {
          flex: 1; min-width: 0;
          display: flex; align-items: center; gap: 9px;
          padding: 9px 12px; border: none; border-radius: 9px;
          background: transparent; cursor: pointer;
          font-family: inherit; text-align: left;
          transition: background-color 120ms;
        }
        .cl-sb-cel:hover, .cl-sb-cel.ativo, .cl-sb-cel.aberta { background: #f4fafd; }
        .cl-sb-cel:focus-visible { outline: 2px solid #2f8fc4; outline-offset: 2px; }
        .cl-sb-tile {
          width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: #f0f5f9; color: #5b6c7c;
        }
        .cl-sb-cel.ativo .cl-sb-tile, .cl-sb-cel.aberta .cl-sb-tile { background: #dbeef8; color: #1c6fa8; }
        .cl-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
        .cl-sb-rot {
          font-size: 10px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .09em; color: #5b6c7c; white-space: nowrap;
        }
        .cl-sb-val {
          font-size: 13px; font-weight: 500; color: #4f6274;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .cl-sb-cel.ativo .cl-sb-val { font-weight: 700; color: #14384f; }
        .cl-sb-chev { color: #7d8fa0; flex-shrink: 0; display: flex; transition: transform 140ms; }
        .cl-sb-cel.aberta .cl-sb-chev { transform: rotate(180deg); }

        /* painel ancorado na célula, por cima dos cards */
        .cl-sb-painel {
          position: absolute; top: 100%; left: 0; margin-top: 6px; z-index: 40;
          min-width: 100%; width: max-content; max-width: 340px;
          background: #fff; border: 1px solid #dfe8f0; border-radius: 12px;
          box-shadow: 0 18px 44px -14px rgba(15,37,68,.42);
          overflow: hidden;
        }
        .cl-sb-buscabox {
          display: flex; align-items: center; gap: 8px;
          padding: 11px 12px 10px; border-bottom: 1px solid #edf2f6;
        }
        .cl-sb-buscabox .cl-sb-busca-ic { color: #6b7d8e; display: flex; }
        .cl-sb-busca {
          flex: 1; height: 30px; border: 1px solid #dfe8f0; border-radius: 8px;
          background: #f7fafc; padding: 0 10px; font-size: 13px;
          font-family: inherit; color: #14384f; outline: none;
        }
        .cl-sb-busca::placeholder { color: #9aabb8; }
        .cl-sb-busca:focus { border-color: #2f8fc4; }
        .cl-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; }
        .cl-sb-lista::-webkit-scrollbar { width: 8px; }
        .cl-sb-lista::-webkit-scrollbar-track { background: #f2f6f9; }
        .cl-sb-lista::-webkit-scrollbar-thumb { background: #c3d5e2; border-radius: 4px; }
        .cl-sb-it {
          display: flex; align-items: center; gap: 10px;
          height: 38px; padding: 0 8px; border-radius: 8px; cursor: pointer;
          font-size: 13px; color: #14384f;
        }
        .cl-sb-it:hover, .cl-sb-it.foco { background: #f2f7fb; }
        .cl-sb-it.sel { background: #eaf4fb; font-weight: 700; }
        .cl-sb-it-todos { font-weight: 700; }
        .cl-sb-it-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cl-sb-ck { color: #1c6fa8; display: flex; }
        .cl-sb-rodape {
          padding: 7px 12px; border-top: 1px solid #edf2f6;
          font-size: 10.5px; font-weight: 600; color: #7d8fa0;
        }
        @media (max-width: 1280px) { .cl-sb-celwrap { flex-basis: 32%; } }
        @media (max-width: 900px)  { .cl-sb-celwrap { flex-basis: 48%; } }

        /* Cards KPI compactos */
        .cl-cards-grid {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px;
        }
        @media (max-width: 1000px) { .cl-cards-grid { grid-template-columns: repeat(2, 1fr); } }
        .cl-card {
          position: relative; padding: 12px 14px; border-radius: 10px; overflow: hidden;
          border: 1px solid transparent;
          display: flex; flex-direction: column;
        }
        .cl-card-faixa { position: absolute; top: 0; right: 0; bottom: 0; width: 3px; }
        .cl-card-titulo {
          font-size: 9px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.06em; margin-bottom: 6px;
          color: #06283A; /* V849: título dos cards totalizadores (variantes coloridas mantêm a própria) */
        }
        .cl-card-valor { font-size: 20px; font-weight: 800; line-height: 1.1; }
        .cl-card-sub { padding-top: 6px; font-size: 10px; color: var(--ink-soft); line-height: 1.4; }
        .cl-card-verde   { background: linear-gradient(135deg, #E8F1EE, #D4E4DF); border-color: #A8C8C0; }
        .cl-card-verde .cl-card-faixa { background: #189AD3; }
        .cl-card-verde .cl-card-titulo, .cl-card-verde .cl-card-valor { color: #189AD3; }
        .cl-card-roxo    { background: linear-gradient(135deg, #ECE5F2, #DAC8E4); border-color: #C0A8D0; }
        .cl-card-roxo .cl-card-faixa { background: #6B4587; }
        .cl-card-roxo .cl-card-titulo, .cl-card-roxo .cl-card-valor { color: #6B4587; }
        .cl-card-bege    { background: linear-gradient(135deg, #E8F1F7, #CDEBDD); border-color: var(--border); }   /* V970: era #9FE6C9 */
        .cl-card-bege .cl-card-faixa { background: #189AD3; }
        .cl-card-bege .cl-card-titulo, .cl-card-bege .cl-card-valor { color: #189AD3; }
        .cl-card-destaque { background: linear-gradient(135deg, #189AD3, #0C3A2F); border-color: #189AD3; box-shadow: 0 4px 12px rgba(24, 154, 211,.2); }
        .cl-card-destaque .cl-card-titulo { color: #56645E; }
        .cl-card-destaque .cl-card-valor { color: #189AD3; }
        .cl-card-destaque .cl-card-sub { color: #B9D4CB; }

        .cl-card-breakdown {
          padding-top: 6px;
          display: flex; flex-direction: column; gap: 1px;
          font-size: 10px;
        }
        .cl-bd-item { display: flex; align-items: center; gap: 5px; color: var(--ink-soft); }
        .cl-bd-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
        .cl-bd-item strong { color: var(--ink); }

        .cl-card-comp {
          margin-top: 8px; padding-top: 6px;
          border-top: 1px dashed rgba(0,0,0,0.08);
          display: flex; gap: 10px; font-size: 10px;
        }
        .cl-card-comp-item { display: flex; align-items: center; gap: 4px; }
        .cl-card-comp-lbl { color: var(--ink-soft); font-weight: 600; font-size: 9px; white-space: nowrap; }
        .cl-comp-up    { color: #0A7A5A; font-weight: 700; }
        .cl-comp-down  { color: #9B3A3A; font-weight: 700; }
        .cl-comp-igual { color: var(--ink-soft); font-weight: 600; }
        .cl-comp-vazio { color: var(--ink-faint); }
        .cl-card-destaque .cl-card-comp { border-top-color: #56645E; }
        .cl-card-destaque .cl-card-comp-lbl { color: #B9D4CB; }
        .cl-card-destaque .cl-comp-up    { color: #C8F5C0; }
        .cl-card-destaque .cl-comp-down  { color: #F5B5B5; }
        .cl-card-destaque .cl-comp-igual,
        .cl-card-destaque .cl-comp-vazio { color: #B9D4CB; }

        /* Card destacado da Taxa */
        .cl-card-taxa {
          background: linear-gradient(135deg, #E8F1F7 0%, #DBF0F9 100%);
          border: 1px solid var(--border);   /* V970: era #9FE6C9 */
          border-left: 5px solid #189AD3;
          border-radius: 12px;
          padding: 18px 22px;
          margin-bottom: 18px;
        }
        .cl-card-taxa-header {
          display: flex; align-items: center; gap: 10px; margin-bottom: 14px;
        }
        .cl-card-taxa-icone { font-size: 20px; }
        .cl-card-taxa-titulo {
          font-size: 12px; font-weight: 700; color: #003A54;
          text-transform: uppercase; letter-spacing: 0.06em;
        }
        .cl-card-taxa-info {
          display: grid; grid-template-columns: 1.8fr 1fr 1.5fr; gap: 18px;
          padding-bottom: 14px;
          border-bottom: 1px solid rgba(212, 190, 126, 0.6);
          margin-bottom: 14px;
        }
        @media (max-width: 800px) { .cl-card-taxa-info { grid-template-columns: 1fr; } }
        .cl-info-label {
          font-size: 9px; color: #189AD3; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;
        }
        .cl-info-valor {
          font-size: 14px; font-weight: 700; color: var(--ink); line-height: 1.3;
        }
        .cl-card-taxa-calc {
          background: #005073;   /* V971: volta ao escuro (a V970 tinha posto #189AD3 — pedido de reverter) */
          color: #F1F7F7;
          padding: 12px 18px;
          border-radius: 8px;
        }
        .cl-calc-label {
          font-size: 10px; font-weight: 700; color: #189AD3;   /* V971: de volta ao #189AD3 sobre o fundo escuro */
          text-transform: uppercase; letter-spacing: 0.06em;
          margin-bottom: 6px;
        }
        .cl-calc-formula {
          font-size: 14px; font-weight: 600; color: #C8D6D2;
        }
        .cl-calc-resultado {
          font-size: 20px; font-weight: 800; color: #C8D6D2;   /* V970: era #9FE6C9 */
          margin-left: 4px;
        }

        /* Tabela */
        .cl-tabela thead th {
          text-transform: none !important;
          letter-spacing: 0 !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          color: var(--ink) !important;
        }
        .cl-medico-nome { font-weight: 600; }
        .cl-tipo-conv, .cl-tipo-part {
          display: inline-block; padding: 2px 8px;
          font-size: 10px; font-weight: 700; border-radius: 4px;
          letter-spacing: 0.04em; color: white;
        }
        .cl-tipo-conv { background: #003A54; }
        .cl-tipo-part { background: #6B4587; }
        /* V970: a linha Total (.cl-tbody-total) saiu da matriz */

        /* Popovers */
        .cl-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 100; }
        .cl-popover {
          position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
          width: 580px; max-width: calc(100vw - 60px);
          max-height: calc(100vh - 120px); overflow-y: auto;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,0.2); z-index: 101;
        }
        .cl-popover-regras { width: 680px; }
        .cl-popover-header {
          padding: 14px 18px; border-bottom: 1px solid var(--border);
          display: flex; justify-content: space-between; align-items: center;
        }
        .cl-popover-header h3 {
          margin: 0; font-family: var(--font-display); font-weight: 500; font-size: 16px;
        }
        .cl-popover-close {
          background: transparent; border: none; font-size: 22px;
          color: var(--ink-soft); cursor: pointer; padding: 0 4px;
        }
        .cl-aj-bloco { padding: 16px 20px; border-bottom: 1px solid var(--border); }
        .cl-aj-bloco:last-child { border-bottom: none; }
        .cl-aj-titulo {
          font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--primary); margin-bottom: 12px;
        }
        .cl-aj-campo { margin-bottom: 14px; }
        .cl-aj-label {
          display: block;
          font-size: 10px; font-weight: 600; color: var(--ink-soft);
          text-transform: uppercase; letter-spacing: 0.05em;
          margin-bottom: 4px;
        }
        .cl-aj-select {
          width: 100%; padding: 8px 10px;
          border: 1px solid var(--border); border-radius: 6px;
          font-size: 13px; font-weight: 500; background: white;
        }
        .cl-aj-pct {
          display: inline-flex; align-items: center; gap: 4px;
          background: var(--bg-sunken); padding: 8px 14px;
          border-radius: 8px; border: 1px solid var(--border);
          font-size: 18px; font-weight: 800; color: var(--primary);
        }
        .cl-aj-num { cursor: pointer; padding: 1px 4px; border-radius: 4px; }
        .cl-aj-num:hover { background: white; }
        .cl-aj-num-input {
          font-family: var(--font-mono); font-size: 18px; font-weight: 800;
          padding: 1px 4px; border: 1px solid var(--accent); border-radius: 4px;
          width: 110px; outline: none;
        }
        .cl-aj-help-inline { font-size: 10px; color: var(--ink-faint); margin-top: 4px; font-style: italic; }
        .cl-aj-base-grid { display: flex; flex-direction: column; gap: 6px; }
        .cl-aj-chk-linha {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px; background: var(--bg-sunken);
          border: 1px solid var(--border); border-radius: 8px;
          cursor: pointer; font-size: 12px;
        }
        .cl-aj-chk-linha:hover { background: white; }

        .cl-vinc-grid { display: flex; gap: 12px; flex-wrap: wrap; }
        .cl-vinc-chk {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 10px; border: 1px solid var(--border); border-radius: 8px;
          cursor: pointer; background: var(--bg-sunken);
        }
        .cl-vinc-chk:hover { background: white; }
        .cl-aj-help { font-size: 10px; color: var(--ink-faint); margin-top: 8px; }

        /* Mostrar/Ocultar */
        .cl-ocultar-lista {
          display: flex; flex-direction: column; gap: 6px;
          background: var(--bg-sunken); padding: 8px; border-radius: 8px;
        }
        .cl-ocultar-linha {
          display: flex; align-items: center; gap: 10px;
          padding: 6px 10px; background: white; border-radius: 6px;
          border: 1px solid var(--border);
        }
        .cl-ocultar-fixa {
          background: rgba(0, 80, 115, 0.04);
          border-color: rgba(0, 80, 115, 0.15);
        }
        .cl-ocultar-chk { display: flex; align-items: center; cursor: pointer; }
        .cl-ocultar-chk input { cursor: pointer; }
        .cl-ocultar-chk input:disabled { cursor: not-allowed; opacity: 0.5; }
        .cl-ocultar-input {
          flex: 1; padding: 4px 8px;
          font-size: 12px; font-weight: 500;
          border: 1px solid transparent; border-radius: 4px;
          background: transparent; font-family: inherit;
        }
        .cl-ocultar-input:hover { border-color: var(--border); }
        .cl-ocultar-input:focus { outline: none; border-color: var(--accent); background: white; }
        .cl-ocultar-fixa-tag {
          font-size: 9px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--ink-faint);
          background: rgba(0, 80, 115, 0.08);
          padding: 2px 7px; border-radius: 4px;
        }
        .cl-ocultar-acoes { margin-top: 12px; display: flex; align-items: center; gap: 12px; }

        /* Regras */
        .cl-regras-body { padding: 4px 0; }
        .cl-regra-bloco { padding: 14px 22px; border-bottom: 1px solid var(--border); }
        .cl-regra-bloco:last-child { border-bottom: none; }
        .cl-regra-titulo {
          display: flex; align-items: center; gap: 10px;
          font-size: 13px; font-weight: 700; color: var(--primary);
          margin-bottom: 10px;
        }
        .cl-regra-num {
          display: inline-flex; align-items: center; justify-content: center;
          width: 22px; height: 22px; background: var(--primary); color: white;
          border-radius: 50%; font-size: 11px; font-weight: 700;
        }
        .cl-regra-lista {
          margin: 0; padding-left: 22px;
          font-size: 12px; color: var(--ink); line-height: 1.65;
        }
        .cl-regra-lista li { margin-bottom: 4px; }
        .cl-regra-lista code {
          background: var(--bg-sunken); padding: 1px 6px;
          border-radius: 3px; font-size: 11px;
        }
        .cl-regra-formula {
          background: var(--bg-sunken); padding: 10px 14px;
          border-left: 3px solid var(--accent); border-radius: 6px;
          font-size: 13px; font-weight: 700; color: var(--primary);
        }
    `;
  }

};
