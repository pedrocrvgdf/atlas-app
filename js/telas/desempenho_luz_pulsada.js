/**
 * ============================================================================
 * TELA: Desempenho · Luz Pulsada
 *
 * Conceito: TAXA SOBRE PROCEDIMENTOS
 *   O aparelho de Luz Pulsada (IRPL) é propriedade da Dra. Fabíola Gavioli.
 *   O hospital paga a ela X% sobre TODA a produção realizada com o aparelho,
 *   independente de quem executa o procedimento.
 *
 * Fonte dos dados: tabela linhas_qvis (relatórios QVIS Convênio + Particular)
 * Filtro:
 *   - PROCEDIMENTO LIKE '%LUZ PULSADA%'
 *   - PAPEL em ('MEDICO', 'CIRURGIAO')  → executante (evita duplicação)
 *   - Vínculo do executante: INTERNO ou HIBRIDO (configurável)
 *
 * Base de cálculo da taxa:
 *   - Particular: PRODUZIDO da linha
 *   - Convênio:   RECEBIDO da linha (só o que entrou de fato)
 * ============================================================================
 */

App.telas['desempenho-luz-pulsada'] = function () {

  // Estado da tela (persiste entre re-renderizações via window.__lp)
  if (window.__lp === undefined) {
    window.__lp = {
      anoSelecionado: null,
      mesSelecionado: null,
      mesPagamentoSelecionado: null,  // null = usa o mais recente automaticamente
      ajustesAberto: false,
      regrasAberto: false,
      ocultarAberto: false,
      filtroCodAdmissao: '',
      filtroCodPaciente: '',
      filtroNomePaciente: '',
      filtroVinculos: new Set(['INTERNO', 'HIBRIDO']),  // default: só IH (regra)
      configColunas: null,
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
  ];
  const STORAGE_KEY_COLS = 'lp_colunas_config_v1';

  // Meses por extenso (fileira de filtros 20C) — declarado ANTES do primeiro
  // renderizar() lá embaixo pra não cair na zona morta temporal (TDZ).
  const MESES_EXTENSO_SB = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  /**
   * Retorna o mês de pagamento ativo (string 'YYYY-MM').
   * Se o usuário selecionou um manualmente, usa ele.
   * Caso contrário, usa o mais recente disponível no banco.
   */
  function obterMesPagamentoAtivo() {
    if (window.__lp.mesPagamentoSelecionado) return window.__lp.mesPagamentoSelecionado;
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
      console.error('Erro Luz Pulsada:', e);
      document.getElementById('conteudo').innerHTML = `
        <div class="page-content">
          <header class="page-header"><h2>Luz Pulsada</h2></header>
          <div class="card" style="background: #FEE; border-color: #D88; padding: 18px">
            <h3 style="margin: 0 0 8px; color: #a15646">⚠ Erro ao renderizar</h3>
            <pre style="font-size: 11px; white-space: pre-wrap; background: white; padding: 12px; border-radius: 8px">${escapeHTML(e.message)}\n\n${escapeHTML(e.stack || '')}</pre>
          </div>
        </div>
      `;
    }
  }

  function _renderizarInterno() {
    if (!window.__lp.configColunas) {
      window.__lp.configColunas = carregarConfigColunas();
    }

    const cfg = carregarConfig();
    const periodos = listarPeriodosLP();

    if (!window.__lp.anoSelecionado && periodos.length > 0) {
      const [ano, mes] = periodos[0].split('-');
      window.__lp.anoSelecionado = ano;
      window.__lp.mesSelecionado = mes;
    }

    const competencia = (window.__lp.anoSelecionado && window.__lp.mesSelecionado)
      ? `${window.__lp.anoSelecionado}-${window.__lp.mesSelecionado}`
      : null;

    const filtros = {
      codAdmissao:  window.__lp.filtroCodAdmissao,
      codPaciente:  window.__lp.filtroCodPaciente,
      nomePaciente: window.__lp.filtroNomePaciente,
    };

    // Carrega admissões do mês com filtros aplicados
    const admissoes = competencia ? carregarAdmissoesLP(competencia, filtros, cfg) : [];

    // KPIs do mês + comparativos LM e LY (mesma lógica do Estrabismo)
    const kpis = calcularKPIs(admissoes, cfg);
    let kpisLM = null, kpisLY = null, kpisYTD = null;
    if (competencia) {
      try {
        const compLM = compMesAnterior(competencia);
        const admLM = carregarAdmissoesLP(compLM, filtros, cfg);
        if (admLM.length > 0) kpisLM = calcularKPIs(admLM, cfg);
      } catch (e) {}
      try {
        const compLY = compAnoAnterior(competencia);
        const admLY = carregarAdmissoesLP(compLY, filtros, cfg);
        if (admLY.length > 0) kpisLY = calcularKPIs(admLY, cfg);
      } catch (e) {}
      try {
        const compsYTD = competenciasAteEsteMes(competencia);
        // V492: cache por mês do YTD — evita reconsultar até ~15 competências a cada
        // render quando nada foi gravado no banco. Chave inclui Banco._versao
        // (invalidada em qualquer gravação) + tudo que afeta o resultado
        // (mês de pagamento, filtros de texto, config de base, vínculos).
        if (!window.__lp._cacheAdmMes || window.__lp._cacheAdmMesVersao !== Banco._versao) {
          window.__lp._cacheAdmMes = new Map();
          window.__lp._cacheAdmMesVersao = Banco._versao;
        }
        const cacheYTD = window.__lp._cacheAdmMes;
        const sufixoChave = '|' + Banco._versao + '|' + obterMesPagamentoAtivo()
          + '|' + JSON.stringify(filtros) + '|' + JSON.stringify(cfg)
          + '|' + Array.from(window.__lp.filtroVinculos).sort().join(',');
        let admYTD = [];
        for (const c of compsYTD) {
          const chave = c + sufixoChave;                       // V492
          let admMes = cacheYTD.get(chave);                    // V492
          if (admMes === undefined) {
            admMes = carregarAdmissoesLP(c, filtros, cfg);
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
    Utilidades.garantirEstilos('css-tela-luz-pulsada', getStyles());

    document.getElementById('conteudo').innerHTML = `
      <div class="page-content lp-page">
        ${renderHeader()}
        ${window.__lp.ajustesAberto ? renderPopoverAjustes(cfg, proprietario) : ''}
        ${window.__lp.regrasAberto ? renderPopoverRegras(cfg) : ''}
        ${window.__lp.ocultarAberto ? renderPopoverOcultar() : ''}
        ${renderFiltros(periodos)}
        ${renderCards(kpis, kpisLM, kpisLY, kpisYTD, cfg, proprietario, competencia)}
        ${renderCardTaxa(kpis, cfg, proprietario, competencia)}
        ${renderTabela(admissoes, competencia)}
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
          <div class="lp-titulo-wrap">
            <h2>Luz Pulsada</h2>
            <button class="lp-btn-info" id="btn-lp-info" title="Regras">ⓘ</button>
          </div>
          <div class="subtitle">Taxa sobre procedimentos · uso de equipamento de propriedade do médico</div>
        </div>
        <div class="lp-header-acoes">
          <div class="atlas-vis-wrap">
            <button class="btn ${Utilidades.valoresOcultos() ? 'ativo' : ''}" id="btn-lp-visualizacao" title="Modo de exibição">
              ${Utilidades.valoresOcultos() ? '<i class="ti ti-eye-off"></i> Ocultos' : '👁 Visualização'} ▾
            </button>
            ${window.__lp.menuVisaoAberto ? `
              <div class="atlas-vis-menu" id="lp-menu-visao">
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
          <button class="btn" id="btn-lp-mostrar-ocultar">⋮ Colunas</button>
          <button class="btn" id="btn-lp-ajustes">⚙ Ajustes</button>
          <button class="btn btn-primary" id="btn-lp-exportar">↓ Exportar Excel</button>
        </div>
      </header>
    `;
  }

  // ==========================================================================
  // FILTROS (mesmo padrão dos outros fichários)
  // ==========================================================================

  function renderFiltros(periodos) {
    // V732: o banner "📅 Mês de Pagamento" SAIU (pedido do usuário — a fileira
    // 20C já cobre os filtros; o mês de pagamento segue automático = snapshot
    // mais recente, via obterMesPagamentoAtivo()).
    const snapshots = Utilidades.listarSnapshots();
    const snapshotBar = '';

    // V734: a fileira 20C aparece mesmo sem procedimentos no mês (mesmo
    // tratamento do Crosslink) — a mensagem fica abaixo da barra.
    if (periodos.length === 0) {
      return `
        ${snapshotBar}
        <div class="lp-filtros-bar">
          ${renderBarraFiltrosLp20C({ anos: [], mesesDoAno: [] })}
        </div>
        <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 30px 20px">
          <div style="color: var(--ink-faint); font-size: 13px">
            ${snapshots.length === 0
              ? 'Nenhum relatório QVIS importado ainda. Vá em <strong>Processamento → Importar QVIS</strong>.'
              : 'Nenhum procedimento de luz pulsada realizado este mês'}
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
    const anoAtual = window.__lp.anoSelecionado;
    const mesesDoAno = (anosMap.get(anoAtual) || []).slice().sort();

    const temFiltros = Utilidades.filtroMulti.ativo(window.__lp.filtroCodAdmissao)
      || Utilidades.filtroMulti.ativo(window.__lp.filtroCodPaciente)
      || Utilidades.filtroMulti.ativo(window.__lp.filtroNomePaciente);

    return `
      ${snapshotBar}
      <div class="lp-filtros-bar">
        ${renderBarraFiltrosLp20C({ anos, mesesDoAno })}
        ${temFiltros ? `<button class="btn btn-pequeno" id="btn-lp-limpar-filtros">✕ Limpar filtros</button>` : ''}
      </div>
    `;
  }

  // ── Fileira de filtros 20C (padrão do LIO/OPME, prefixo lp-sb) ────────────
  // UMA peça branca com células (tile de ícone + rótulo + valor + chevron);
  // painéis ancorados abrem/fecham LOCAL (insertAdjacentHTML, zero re-render);
  // aplicar seta a MESMA chave de estado dos handlers antigos e chama renderizar().
  function _lpSbIc(nome) {
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
  function _lpSbSvg(d, px, sw) {
    return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  function _lpSbSemAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function renderBarraFiltrosLp20C(ctx) {
    // guarda as listas pro painel abrir LOCAL depois, sem recoletar
    window.__lp._sbOpcoes = {
      anos: ctx.anos,
      meses: ctx.mesesDoAno,
      codAdm: carregarOpcoesCombo('cod-adm'),
      codPac: carregarOpcoesCombo('cod-pac'),
      nomePac: carregarOpcoesCombo('nome-pac'),
    };
    const cel = (id, rotulo, valor, icone, flex, vazio = 'Todos') => {
      const ativo = !!valor;
      const estaAberta = window.__lp.sbAberto === id;
      return `
        <div class="lp-sb-celwrap" style="flex:${flex}">
          <button type="button" class="lp-sb-cel ${ativo ? 'ativo' : ''} ${estaAberta ? 'aberta' : ''}"
                  data-sb-cel="${id}" data-sb-vazio="${vazio}" role="combobox" aria-expanded="${estaAberta ? 'true' : 'false'}" aria-haspopup="listbox">
            <span class="lp-sb-tile">${_lpSbSvg(_lpSbIc(icone), 14, 2.1)}</span>
            <span class="lp-sb-tx">
              <span class="lp-sb-rot">${rotulo}</span>
              <span class="lp-sb-val">${escapeHTML(valor || vazio)}</span>
            </span>
            <span class="lp-sb-chev">${_lpSbSvg(_lpSbIc('chev'), 10, 2.8)}</span>
          </button>
          ${estaAberta ? painelLp20C(id) : ''}
        </div>`;
    };
    const mesLabel = window.__lp.mesSelecionado
      ? (MESES_EXTENSO_SB[parseInt(window.__lp.mesSelecionado, 10) - 1] || window.__lp.mesSelecionado)
      : '';
    // V922: rótulo dos filtros multi ("N selecionados")
    const FM = Utilidades.filtroMulti;
    const rotMulti = (f) => FM.ativo(f) ? FM.rotulo(f) : '';
    return `
      <div class="lp-sb" id="lp-sb">
        ${cel('ano', 'Ano', window.__lp.anoSelecionado || '', 'clock', 0.75)}
        ${cel('mes', 'Mês', mesLabel, 'calendar', 0.8)}
        ${cel('cod_adm', 'Cód. Admissão', rotMulti(window.__lp.filtroCodAdmissao), 'alignleft', 1.05)}
        ${cel('cod_pac', 'Cód. Paciente', rotMulti(window.__lp.filtroCodPaciente), 'hash', 1.05)}
        ${cel('nome_pac', 'Nome do Paciente', rotMulti(window.__lp.filtroNomePaciente), 'user', 1.35)}
      </div>`;
  }

  function painelLp20C(id) {
    const opc = window.__lp._sbOpcoes || {};
    const item = (val, rotulo, sel) => `
      <div class="lp-sb-it ${sel ? 'sel' : ''} ${val === '' ? 'lp-sb-it-todos' : ''}" data-sb-item data-val="${escapeAttr(val)}" data-busca="${escapeAttr(_lpSbSemAcento(rotulo))}" role="option" aria-selected="${sel ? 'true' : 'false'}">
        <span class="lp-sb-it-nome">${escapeHTML(rotulo)}</span>
        ${sel ? `<span class="lp-sb-ck">${_lpSbSvg(_lpSbIc('check'), 14, 2.5)}</span>` : ''}
      </div>`;
    // comTodos: Ano/Mês NÃO têm "Todos" — a tela exige uma competência ativa
    // (mesmo comportamento dos <select> antigos, que não tinham opção vazia).
    const painelLista = (cel, opcoes, valAtual, { busca = false, comTodos = true } = {}) => `
      <div class="lp-sb-painel" data-sb-painel="${cel}">
        ${busca ? `
          <div class="lp-sb-buscabox">
            <span class="lp-sb-busca-ic">${_lpSbSvg(_lpSbIc('search'), 15, 2.1)}</span>
            <input type="text" class="lp-sb-busca" data-sb-busca placeholder="Digite pra buscar" autocomplete="off">
          </div>` : ''}
        <div class="lp-sb-lista" role="listbox">
          ${comTodos ? item('', 'Todos', !valAtual) : ''}
          ${opcoes.slice(0, 400).map(o => item(o.v, o.r, valAtual === o.v)).join('')}
        </div>
        ${busca ? `<div class="lp-sb-rodape" data-sb-contagem>${opcoes.length} opç${opcoes.length === 1 ? 'ão' : 'ões'}</div>` : ''}
      </div>`;
    const lisos = arr => (arr || []).map(v => ({ v, r: v }));
    if (id === 'ano') return painelLista('ano', lisos(opc.anos), window.__lp.anoSelecionado || '', { comTodos: false });
    if (id === 'mes') return painelLista('mes', (opc.meses || []).map(m => ({ v: m, r: MESES_EXTENSO_SB[parseInt(m, 10) - 1] || m })), window.__lp.mesSelecionado || '', { comTodos: false });
    // V922: filtros de conteúdo em MULTI — checkbox + busca; marcados no topo
    const FM = Utilidades.filtroMulti;
    const painelMulti = (cel, opcoes, f) => {
      const sel = FM.sel(f);
      const marcadas = opcoes.filter(o => sel.includes(String(o.v)));
      const demais = opcoes.filter(o => !sel.includes(String(o.v)));
      return `
      <div class="lp-sb-painel" data-sb-painel="${cel}" data-sb-multi="1">
        <div class="lp-sb-buscabox">
          <span class="lp-sb-busca-ic">${_lpSbSvg(_lpSbIc('search'), 15, 2.1)}</span>
          <input type="text" class="lp-sb-busca" data-sb-busca placeholder="Digite pra buscar" autocomplete="off">
        </div>
        <div class="lp-sb-lista" role="listbox">
          ${item('', 'Todos', sel.length === 0)}
          ${[...marcadas, ...demais].slice(0, 400).map(o => item(o.v, o.r, sel.includes(String(o.v)))).join('')}
        </div>
        <div class="lp-sb-rodape" data-sb-contagem>${sel.length ? `${sel.length} selecionado${sel.length === 1 ? '' : 's'} · ` : ''}${opcoes.length} opç${opcoes.length === 1 ? 'ão' : 'ões'}</div>
      </div>`;
    };
    if (id === 'cod_adm') return painelMulti('cod_adm', lisos(opc.codAdm), window.__lp.filtroCodAdmissao);
    if (id === 'cod_pac') return painelMulti('cod_pac', lisos(opc.codPac), window.__lp.filtroCodPaciente);
    return painelMulti('nome_pac', lisos(opc.nomePac), window.__lp.filtroNomePaciente);
  }

  function bindBarraFiltrosLp20C() {
    const sb = document.getElementById('lp-sb');
    if (!sb) return;
    const fecharPainelLocal = () => {
      sb.querySelectorAll('.lp-sb-painel').forEach(p => p.remove());
      sb.querySelectorAll('.lp-sb-cel.aberta').forEach(c => { c.classList.remove('aberta'); c.setAttribute('aria-expanded', 'false'); });
      window.__lp.sbAberto = null;
    };
    const aplicar = (celId, val) => {
      // MESMAS chaves de estado + MESMO re-render dos handlers antigos
      // V922: filtros de conteúdo viraram MULTI — alterna e mantém aberto
      const FM = Utilidades.filtroMulti;
      const campoMulti = celId === 'cod_adm' ? 'filtroCodAdmissao'
        : celId === 'cod_pac' ? 'filtroCodPaciente'
        : celId === 'nome_pac' ? 'filtroNomePaciente' : null;
      if (campoMulti) {
        const buscaEl = sb.querySelector('[data-sb-busca]');
        window.__lp._sbBusca = buscaEl ? buscaEl.value : '';
        window.__lp[campoMulti] = val === '' ? [] : FM.toggle(window.__lp[campoMulti], val);
        renderizar();   // sbAberto continua — o painel re-abre marcado
        return;
      }
      window.__lp._sbBusca = '';
      if (celId === 'ano') {
        window.__lp.anoSelecionado = val;
        const periodos = listarPeriodosLP();
        const mesesAno = periodos.filter(p => p.startsWith(val + '-'))
                                 .map(p => p.split('-')[1]).sort();
        window.__lp.mesSelecionado = mesesAno[0] || null;
      } else if (celId === 'mes') {
        window.__lp.mesSelecionado = val;
      }
      window.__lp.sbAberto = null;
      renderizar();
    };
    const wireInputsPainel = () => {
      const busca = sb.querySelector('[data-sb-busca]');
      if (!busca) return;
      setTimeout(() => busca.focus(), 0);
      const filtrar = () => {
        const q = _lpSbSemAcento(busca.value);
        const painel = busca.closest('.lp-sb-painel');
        let n = 0;
        painel.querySelectorAll('[data-sb-item]').forEach(el => {
          // V922: itens MARCADOS ficam sempre visíveis
          const mostra = el.classList.contains('lp-sb-it-todos') || el.classList.contains('sel') || !q || (el.dataset.busca || '').includes(q);
          el.style.display = mostra ? '' : 'none';
          if (mostra && !el.classList.contains('lp-sb-it-todos')) n++;
        });
        const cont = painel.querySelector('[data-sb-contagem]');
        if (cont) cont.textContent = `${n} opç${n === 1 ? 'ão' : 'ões'}`;
      };
      busca.addEventListener('input', filtrar);
      if (window.__lp._sbBusca) { busca.value = window.__lp._sbBusca; filtrar(); }   // V922
    };
    const abrirPainelLocal = (id) => {
      const jaAberto = window.__lp.sbAberto === id;
      fecharPainelLocal();
      window.__lp._sbBusca = '';   // V922: busca não vaza de um painel pro outro
      if (jaAberto) return;
      window.__lp.sbAberto = id;
      const btn = sb.querySelector(`[data-sb-cel="${id}"]`);
      btn.classList.add('aberta');
      btn.setAttribute('aria-expanded', 'true');
      btn.parentElement.insertAdjacentHTML('beforeend', painelLp20C(id));
      wireInputsPainel();
    };
    // V922: o painel pode vir aberto do template (re-render após marcar)
    if (window.__lp.sbAberto && sb.querySelector('.lp-sb-painel')) wireInputsPainel();
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
      if (!window.__lp.sbAberto) return;
      const painel = sb.querySelector('.lp-sb-painel');
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
    if (window.__lpSbFechar) {
      document.removeEventListener('click', window.__lpSbFechar);
      document.removeEventListener('keydown', window.__lpSbEsc);
    }
    const fecharFora = (e) => {
      if (App.telaAtual !== 'desempenho-luz-pulsada') return;
      if (window.__lp.sbAberto && !e.target.closest('#lp-sb')) fecharPainelLocal();
    };
    const escFecha = (e) => { if (e.key === 'Escape' && window.__lp.sbAberto) fecharPainelLocal(); };
    window.__lpSbFechar = fecharFora;
    window.__lpSbEsc = escFecha;
    document.addEventListener('click', fecharFora);
    document.addEventListener('keydown', escFecha);
    if (window.__lp.sbAberto) wireInputsPainel();
  }

  function carregarOpcoesCombo(tipo) {
    if (!window.__lp.anoSelecionado || !window.__lp.mesSelecionado) return [];
    const comp = `${window.__lp.anoSelecionado}-${window.__lp.mesSelecionado}`;
    const mp = obterMesPagamentoAtivo();
    if (!mp) return [];
    const coluna = tipo === 'cod-adm' ? 'admissao'
                 : tipo === 'cod-pac' ? 'cod_paciente'
                 : 'paciente';
    const rows = Banco.query(`
      SELECT DISTINCT ${coluna} AS v
      FROM linhas_qvis
      WHERE procedimento_normalizado LIKE '%LUZ PULSADA%'
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
      if (comp === null || comp === undefined) return '<span class="lp-comp-vazio">—</span>';
      if (!comp) {
        if (atual > 0) return `<span class="lp-comp-up">↑ novo</span>`;
        return `<span class="lp-comp-igual">↔ 0,0%</span>`;
      }
      const pct = ((atual - comp) / comp) * 100;
      if (Math.abs(pct) < 0.05) return `<span class="lp-comp-igual">↔ 0,0%</span>`;
      const cls = pct > 0 ? 'lp-comp-up' : 'lp-comp-down';
      const seta = pct > 0 ? '↑' : '↓';
      return `<span class="${cls}">${seta} ${Utilidades.formatarNumero(Math.abs(pct), 1)}%</span>`;
    };

    const linhaComp = (atual, valLM, valLY) => `
      <div class="lp-card-comp">
        <div class="lp-card-comp-item"><span class="lp-card-comp-lbl">vs LM</span> ${badge(atual, valLM)}</div>
        <div class="lp-card-comp-item"><span class="lp-card-comp-lbl">vs LY</span> ${badge(atual, valLY)}</div>
      </div>
    `;

    const pct = Number(cfg.percentual) || 0;

    return `
      <div class="lp-cards-grid">
        <!-- Card 1: Admissões + breakdown -->
        <div class="lp-card lp-card-verde">
          <div class="lp-card-faixa"></div>
          <div class="lp-card-titulo">Admissões de Luz Pulsada</div>
          <div class="lp-card-valor mono" data-ocultavel>${k.admissoes}</div>
          <div class="lp-card-breakdown">
            <div class="lp-bd-item"><span class="lp-bd-dot" style="background: #3a5877"></span> Convênio: <strong data-ocultavel>${k.admConvenio}</strong></div>
            <div class="lp-bd-item"><span class="lp-bd-dot" style="background: #6B4587"></span> Particular: <strong data-ocultavel>${k.admParticular}</strong></div>
          </div>
          ${linhaComp(k.admissoes, kLM?.admissoes, kLY?.admissoes)}
        </div>

        <!-- Card 2: Produção YTD -->
        <div class="lp-card lp-card-roxo">
          <div class="lp-card-faixa"></div>
          <div class="lp-card-titulo">Produção YTD</div>
          <div class="lp-card-valor mono" data-ocultavel>R$ ${Utilidades.formatarNumero((kYTD?.producao || 0), 2)}</div>
          <div class="lp-card-sub"><span data-ocultavel>${kYTD?.admissoes || 0}</span> adm · Taxa YTD: <strong data-ocultavel>R$ ${Utilidades.formatarNumero((kYTD?.producao || 0) * pct / 100, 0)}</strong></div>
        </div>

        <!-- Card 3: Produção do mês -->
        <div class="lp-card lp-card-bege">
          <div class="lp-card-faixa"></div>
          <div class="lp-card-titulo">Produção · Mês</div>
          <div class="lp-card-valor mono" data-ocultavel>R$ ${Utilidades.formatarNumero(k.producao, 2)}</div>
          ${linhaComp(k.producao, kLM?.producao, kLY?.producao)}
        </div>

        <!-- Card 4: Taxa total (destaque) -->
        <div class="lp-card lp-card-destaque">
          <div class="lp-card-titulo">Taxa da Proprietária · Mês</div>
          <div class="lp-card-valor mono" data-ocultavel>R$ ${Utilidades.formatarNumero(k.taxa, 2)}</div>
          <div class="lp-card-sub">${Utilidades.formatarNumero(pct, 2)}% × <span data-ocultavel>R$ ${Utilidades.formatarNumero(k.producao, 2)}</span></div>
          ${linhaComp(k.taxa, kLM ? kLM.producao * pct / 100 : null, kLY ? kLY.producao * pct / 100 : null)}
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // CARD DESTACADO — Detalhes da Taxa
  // ==========================================================================

  function renderCardTaxa(k, cfg, prop, competencia) {
    if (!competencia) return '';
    const pct = Number(cfg.percentual) || 0;
    const nomeProp = prop ? prop.nome_oficial : '(não configurada)';
    const bases = [];
    if (cfg.baseParticular) bases.push('Particular (PRODUZIDO)');
    if (cfg.baseConvenio)   bases.push('Convênio (RECEBIDO)');
    const labelMes = formatarComp(competencia);

    return `
      <div class="lp-card-taxa">
        <div class="lp-card-taxa-header">
          <span class="lp-card-taxa-icone">🔧</span>
          <span class="lp-card-taxa-titulo">Taxa sobre Procedimentos · Aparelho de Luz Pulsada</span>
        </div>
        <div class="lp-card-taxa-info">
          <div class="lp-info-item">
            <div class="lp-info-label">Proprietária do equipamento</div>
            <div class="lp-info-valor">${escapeHTML(CodigoMedico.exibir(nomeProp))}</div>
          </div>
          <div class="lp-info-item">
            <div class="lp-info-label">Taxa configurada</div>
            <div class="lp-info-valor mono">${Utilidades.formatarNumero(pct, 2)} %</div>
          </div>
          <div class="lp-info-item">
            <div class="lp-info-label">Base de cálculo</div>
            <div class="lp-info-valor" style="font-size: 11px">${bases.join(' + ') || '<em style="color: var(--ink-faint)">nenhuma</em>'}</div>
          </div>
        </div>
        <div class="lp-card-taxa-calc">
          <div class="lp-calc-label">CÁLCULO DA TAXA · ${labelMes}</div>
          <div class="lp-calc-formula mono">
            ${Utilidades.formatarNumero(pct, 2)}% × <span data-ocultavel>R$ ${Utilidades.formatarNumero(k.producao, 2)}</span>
            = <span class="lp-calc-resultado" data-ocultavel>R$ ${Utilidades.formatarNumero(k.taxa, 2)}</span>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // TABELA — admissões elegíveis
  // ==========================================================================

  function renderTabela(admissoes, competencia) {
    if (!competencia) return '';
    if (admissoes.length === 0) {
      return `
        <div class="lp-secao-label" style="margin-top: 22px">Admissões elegíveis</div>
        <div class="card" style="padding: 24px; text-align: center; color: var(--ink-faint)">
          Nenhuma admissão de Luz Pulsada no período (ou todas foram filtradas por vínculo).
        </div>
      `;
    }

    const cols = (window.__lp.configColunas || COLUNAS_PADRAO).filter(c => c.visivel);
    const ths = cols.map(c => {
      const num = (c.id === 'producao') ? 'class="num"' : '';
      return `<th ${num}>${escapeHTML(c.label)}</th>`;
    }).join('');

    // V946: sem a linha "Total / mês" no rodapé — os cards do topo já totalizam

    return `
      <div class="lp-secao-label" style="margin-top: 22px">
        Admissões elegíveis
        <span style="font-weight: 500; text-transform: none; color: var(--ink-faint); margin-left: 6px">· ${admissoes.length} admiss${admissoes.length !== 1 ? 'ões' : 'ão'}</span>
      </div>
      <div class="card" style="padding: 0; overflow: hidden">
        <table class="data-table lp-tabela">
          <thead><tr>${ths}</tr></thead>
          <tbody>
            ${admissoes.map(a => renderLinhaAdmissao(a, cols)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderLinhaAdmissao(a, cols) {
    const proc = String(a.procedimento || '').replace(/^LUZ PULSADA\s*[-–(]?\s*/i, '').replace(/\)$/, '').trim() || a.procedimento;
    const origemBadge = Utilidades.badgeFonte(a.origem);   // V946: tag padrão da ferramenta

    const vinculoBadge = Utilidades.badgeTipoVinculo(a.tipo_vinculo) || '';

    const tds = cols.map(c => {
      if (c.id === 'cod_admissao')  return `<td class="mono">${escapeHTML(a.admissao || '')}</td>`;
      if (c.id === 'data_admissao') return `<td class="mono" style="white-space: nowrap; color: var(--ink-soft)">${Utilidades.formatarDataBR(a.data_admissao)}</td>`;
      if (c.id === 'paciente')      return `<td>${escapeHTML(a.paciente || '—')}</td>`;
      if (c.id === 'procedimento') return `<td title="${escapeAttr(a.procedimento || '')}">${escapeHTML(proc)}</td>`;
      if (c.id === 'medico')       return `<td>
        <div class="lp-medico-nome">${escapeHTML(CodigoMedico.exibir(a.nome_medico_oficial || a.nome_profissional || ''))}</div>
        ${vinculoBadge}
      </td>`;
      if (c.id === 'origem')       return `<td>${origemBadge}</td>`;
      if (c.id === 'producao')     return `<td class="num mono" data-ocultavel style="font-weight: 700; color: #3f6489">R$ ${Utilidades.formatarNumero(a.base_calculo, 2)}</td>`;   // V946
      return '<td></td>';
    }).join('');

    return `<tr>${tds}</tr>`;
  }

  // ==========================================================================
  // CÁLCULOS / DADOS
  // ==========================================================================

  function listarPeriodosLP() {
    try {
      const mp = obterMesPagamentoAtivo();
      if (!mp) return [];
      return Banco.query(`
        SELECT DISTINCT competencia FROM linhas_qvis
        WHERE procedimento_normalizado LIKE '%LUZ PULSADA%'
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
   * Carrega as admissões elegíveis de Luz Pulsada para um período.
   * Aplica todos os filtros: período, texto (combobox), vínculo do executante.
   * Retorna uma lista 1 elemento por admissão, já com:
   *   - base_calculo: produzido (particular) ou recebido (convênio) conforme cfg
   *   - nome_medico_oficial: nome resolvido pelo cadastro (se houver match)
   *   - tipo_vinculo: INTERNO/HIBRIDO/EXTERNO (ou null se não cadastrado)
   */
  function carregarAdmissoesLP(competencia, filtros, cfg) {
    const mp = obterMesPagamentoAtivo();
    if (!mp) return [];
    const where = [
      `procedimento_normalizado LIKE '%LUZ PULSADA%'`,
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
    const tiposPermitidos = window.__lp.filtroVinculos;
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
      Banco.query('SELECT chave, valor FROM config_luz_pulsada').forEach(r => {
        cfg[r.chave] = r.valor;
      });
    } catch (e) {}
    return {
      percentual:     parseFloat(cfg.PERCENTUAL_TAXA || '8.00') || 0,
      proprietarioId: cfg.PROPRIETARIO_MEDICO_ID || '',
      baseParticular: (cfg.BASE_PARTICULAR ?? '1') === '1',
      baseConvenio:   (cfg.BASE_CONVENIO   ?? '1') === '1',
    };
  }

  function obterProprietario(cfg) {
    if (!cfg.proprietarioId) {
      // Sem proprietário configurado: tenta achar a Fabíola Gavioli automaticamente
      try {
        const r = Banco.queryUnica(`
          SELECT id, nome_oficial, tipo_vinculo
          FROM medicos
          WHERE ativo = 1 AND UPPER(nome_oficial) LIKE '%FABIOLA%GAVIOLI%'
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
    const pct = Number(cfg.percentual) || 0;
    k.taxa = k.producao * pct / 100;
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
      <div class="lp-overlay" data-popover="ajustes"></div>
      <div class="lp-popover">
        <div class="lp-popover-header">
          <h3>Ajustes — Luz Pulsada</h3>
          <button class="lp-popover-close" data-popover="ajustes">×</button>
        </div>

        <!-- Bloco 1: Taxa -->
        <div class="lp-aj-bloco">
          <div class="lp-aj-titulo">Taxa sobre procedimentos</div>

          <div class="lp-aj-campo">
            <label class="lp-aj-label">Proprietária do aparelho</label>
            <select class="lp-aj-select" id="lp-aj-proprietario">
              <option value="">— Auto (tenta achar pela Fabíola Gavioli) —</option>
              ${medicos.map(m => `
                <option value="${m.id}" ${String(m.id) === propId ? 'selected' : ''}>
                  ${escapeHTML(CodigoMedico.exibir(m.nome_oficial))}
                </option>
              `).join('')}
            </select>
          </div>

          <div class="lp-aj-campo">
            <label class="lp-aj-label">Percentual da taxa</label>
            <div class="lp-aj-pct">
              <span class="lp-aj-num mono" data-config="PERCENTUAL_TAXA" data-valor="${cfg.percentual}">${Utilidades.formatarNumero(cfg.percentual, 2)}</span>
              <span style="font-weight: 700; color: var(--ink-soft)">%</span>
            </div>
            <div class="lp-aj-help-inline">Clique no número para editar</div>
          </div>

          <div class="lp-aj-campo">
            <label class="lp-aj-label">Base de cálculo</label>
            <div class="lp-aj-base-grid">
              <label class="lp-aj-chk-linha">
                <input type="checkbox" data-base="BASE_PARTICULAR" ${cfg.baseParticular ? 'checked' : ''}>
                <span><strong>Particular</strong> — valor PRODUZIDO</span>
              </label>
              <label class="lp-aj-chk-linha">
                <input type="checkbox" data-base="BASE_CONVENIO" ${cfg.baseConvenio ? 'checked' : ''}>
                <span><strong>Convênio</strong> — valor RECEBIDO (efetivamente pago)</span>
              </label>
            </div>
          </div>
        </div>

        <!-- Bloco 2: Vínculos -->
        <div class="lp-aj-bloco">
          <div class="lp-aj-titulo">Filtrar médicos por tipo de vínculo</div>
          <div class="lp-vinc-grid">
            ${tiposVinc.map(t => `
              <label class="lp-vinc-chk">
                <input type="checkbox" data-vinc="${t}" ${window.__lp.filtroVinculos.has(t) ? 'checked' : ''}>
                ${Utilidades.badgeVinculo(t)}<!-- V960: tag padrão de vínculo -->
              </label>
            `).join('')}
          </div>
          <div class="lp-aj-help">Filtra quais admissões entram no cálculo da taxa.</div>
        </div>
      </div>
    `;
  }

  // V960: vincStyle saiu — a tag de vínculo é a padrão (Utilidades.badgeVinculo)

  function renderPopoverOcultar() {
    const cols = window.__lp.configColunas || COLUNAS_PADRAO;
    return `
      <div class="lp-overlay" data-popover="ocultar"></div>
      <div class="lp-popover">
        <div class="lp-popover-header">
          <h3>Mostrar/Ocultar colunas</h3>
          <button class="lp-popover-close" data-popover="ocultar">×</button>
        </div>
        <div class="lp-aj-bloco">
          <div class="lp-aj-titulo">Tabela principal</div>
          <div class="lp-ocultar-lista">
            ${cols.map(c => `
              <div class="lp-ocultar-linha ${c.fixa ? 'lp-ocultar-fixa' : ''}">
                <label class="lp-ocultar-chk" title="${c.fixa ? 'Coluna fixa' : 'Marcar para mostrar'}">
                  <input type="checkbox"
                         data-col-id="${escapeAttr(c.id)}"
                         data-tipo="visivel"
                         ${c.visivel ? 'checked' : ''}
                         ${c.fixa ? 'disabled' : ''}>
                </label>
                <input type="text" class="lp-ocultar-input"
                       data-col-id="${escapeAttr(c.id)}" data-tipo="label"
                       value="${escapeAttr(c.label)}" placeholder="Nome">
                ${c.fixa ? '<span class="lp-ocultar-fixa-tag">fixa</span>' : ''}
              </div>
            `).join('')}
          </div>
          <div class="lp-ocultar-acoes">
            <button class="btn btn-pequeno" id="btn-lp-ocultar-restaurar">↺ Restaurar padrão</button>
            <span class="lp-aj-help" style="margin: 0">Aplicado automaticamente.</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderPopoverRegras(cfg) {
    return `
      <div class="lp-overlay" data-popover="regras"></div>
      <div class="lp-popover lp-popover-regras">
        <div class="lp-popover-header">
          <h3>Regras — Luz Pulsada</h3>
          <button class="lp-popover-close" data-popover="regras">×</button>
        </div>
        <div class="lp-regras-body">
          <div class="lp-regra-bloco">
            <div class="lp-regra-titulo"><span class="lp-regra-num">1</span> Conceito</div>
            <ul class="lp-regra-lista">
              <li>Esta NÃO é uma comissão por procedimento nem cargo administrativo.</li>
              <li>É uma <strong>taxa de uso/aluguel</strong> do aparelho de Luz Pulsada (IRPL) que pertence à proprietária configurada.</li>
              <li>O hospital paga a taxa sobre toda a produção realizada com o aparelho — independente de quem executou.</li>
            </ul>
          </div>
          <div class="lp-regra-bloco">
            <div class="lp-regra-titulo"><span class="lp-regra-num">2</span> Origem dos dados</div>
            <ul class="lp-regra-lista">
              <li>Linhas vêm dos relatórios <strong>QVIS</strong> (Convênio + Particular).</li>
              <li>Filtro: <code>PROCEDIMENTO LIKE '%LUZ PULSADA%'</code>.</li>
              <li>Apenas papéis <strong>MEDICO ou CIRURGIAO</strong> (executantes) — ignora SOLICITANTE para evitar duplicação.</li>
            </ul>
          </div>
          <div class="lp-regra-bloco">
            <div class="lp-regra-titulo"><span class="lp-regra-num">3</span> Filtro de vínculo</div>
            <ul class="lp-regra-lista">
              <li>Default: apenas executantes <strong>Internos ou Híbridos</strong> (igual regra do Coordenador LC).</li>
              <li>Configurável em ⚙ Ajustes.</li>
            </ul>
          </div>
          <div class="lp-regra-bloco">
            <div class="lp-regra-titulo"><span class="lp-regra-num">4</span> Base de cálculo</div>
            <ul class="lp-regra-lista">
              <li><strong>Particular</strong>: usa <code>PRODUZIDO</code> da linha.</li>
              <li><strong>Convênio</strong>: usa <code>RECEBIDO</code> da linha — só o que entrou de fato no hospital.</li>
              <li>Cada base pode ser ligada/desligada independentemente.</li>
            </ul>
          </div>
          <div class="lp-regra-bloco">
            <div class="lp-regra-titulo"><span class="lp-regra-num">5</span> Cálculo da taxa</div>
            <div class="lp-regra-formula">
              <span class="mono">Taxa = ${Utilidades.formatarNumero(cfg.percentual, 2)}% × Produção elegível total</span>
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
    const btnAj = document.getElementById('btn-lp-ajustes');
    if (btnAj) btnAj.addEventListener('click', () => {
      window.__lp.ajustesAberto = !window.__lp.ajustesAberto;
      window.__lp.regrasAberto = false;
      window.__lp.ocultarAberto = false;
      renderizar();
    });
    const btnInfo = document.getElementById('btn-lp-info');
    if (btnInfo) btnInfo.addEventListener('click', () => {
      window.__lp.regrasAberto = !window.__lp.regrasAberto;
      window.__lp.ajustesAberto = false;
      window.__lp.ocultarAberto = false;
      renderizar();
    });
    const btnOcultar = document.getElementById('btn-lp-mostrar-ocultar');
    if (btnOcultar) btnOcultar.addEventListener('click', () => {
      window.__lp.ocultarAberto = !window.__lp.ocultarAberto;
      window.__lp.ajustesAberto = false;
      window.__lp.regrasAberto = false;
      renderizar();
    });
    // Botão "Visualização" (padrão .atlas-vis-*) — dropdown Mostrar tudo / Ocultar valores
    const btnVisLp = document.getElementById('btn-lp-visualizacao');
    if (btnVisLp) btnVisLp.addEventListener('click', (e) => {
      e.stopPropagation();
      window.__lp.menuVisaoAberto = !window.__lp.menuVisaoAberto;
      renderizar();
    });
    document.querySelectorAll('#lp-menu-visao .atlas-vis-item').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        Utilidades.setModoExibicao(b.dataset.modo);
        window.__lp.menuVisaoAberto = false;
        renderizar();
      });
    });
    // V492: remove SEMPRE o listener do render anterior — antes acumulava: os itens
    // do menu usam stopPropagation, então ao fechar pelo botão/item o handler antigo
    // nunca disparava nem se removia, e cada abertura somava +1 listener global.
    if (window.__lp._fecharVisHandler) {
      document.removeEventListener('click', window.__lp._fecharVisHandler);
      window.__lp._fecharVisHandler = null;
    }
    if (window.__lp.menuVisaoAberto) {
      const fecharVisLp = (e) => {
        if (!e.target.closest('#lp-menu-visao') && !e.target.closest('#btn-lp-visualizacao')) {
          window.__lp.menuVisaoAberto = false;
          document.removeEventListener('click', fecharVisLp);
          if (window.__lp._fecharVisHandler === fecharVisLp) window.__lp._fecharVisHandler = null;  // V492
          renderizar();
        }
      };
      window.__lp._fecharVisHandler = fecharVisLp;  // V492: guarda referência p/ remoção incondicional
      // V492: só registra se ainda for o handler vigente (um re-render síncrono
      // entre o agendamento e o timeout já o descartou)
      setTimeout(() => {
        if (window.__lp._fecharVisHandler === fecharVisLp) {
          document.addEventListener('click', fecharVisLp);
        }
      }, 0);
    }
    const btnExp = document.getElementById('btn-lp-exportar');
    if (btnExp) btnExp.addEventListener('click', () => exportarExcel(cfg));

    // Fechar popovers
    document.querySelectorAll('[data-popover]').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-popover]') !== el) return;
        const p = el.dataset.popover;
        if (p === 'ajustes') window.__lp.ajustesAberto = false;
        if (p === 'regras')  window.__lp.regrasAberto  = false;
        if (p === 'ocultar') window.__lp.ocultarAberto = false;
        renderizar();
      });
    });

    // Filtros — fileira 20C (Ano/Mês/combos viraram células)
    bindBarraFiltrosLp20C();
    // Seletor de snapshot (mês de pagamento)
    const selSnap = document.getElementById('lp-snapshot-select');
    if (selSnap) selSnap.addEventListener('change', () => {
      window.__lp.mesPagamentoSelecionado = selSnap.value;
      // Reset período pra forçar recálculo
      window.__lp.anoSelecionado = null;
      window.__lp.mesSelecionado = null;
      renderizar();
    });

    const btnLimp = document.getElementById('btn-lp-limpar-filtros');
    if (btnLimp) btnLimp.addEventListener('click', () => {
      window.__lp.filtroCodAdmissao = '';
      window.__lp.filtroCodPaciente = '';
      window.__lp.filtroNomePaciente = '';
      renderizar();
    });

    // Ajustes: proprietário (select)
    const selProp = document.getElementById('lp-aj-proprietario');
    if (selProp) selProp.addEventListener('change', async () => {
      await salvarConfig('PROPRIETARIO_MEDICO_ID', selProp.value);
      renderizar();
    });

    // Ajustes: edição inline do percentual
    document.querySelectorAll('.lp-aj-num').forEach(span => {
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
        if (chk.checked) window.__lp.filtroVinculos.add(t);
        else window.__lp.filtroVinculos.delete(t);
        renderizar();
      });
    });

    // Mostrar/Ocultar colunas
    document.querySelectorAll('input[data-col-id]').forEach(el => {
      const tipo = el.dataset.tipo;
      if (tipo === 'visivel') {
        el.addEventListener('change', () => {
          const id = el.dataset.colId;
          const cfgCols = window.__lp.configColunas;
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
          const cfgCols = window.__lp.configColunas;
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
    const btnRest = document.getElementById('btn-lp-ocultar-restaurar');
    if (btnRest) btnRest.addEventListener('click', () => {
      window.__lp.configColunas = JSON.parse(JSON.stringify(COLUNAS_PADRAO));
      salvarConfigColunas(window.__lp.configColunas);
      renderizar();
    });
  }

  async function salvarConfig(chave, valor) {
    try {
      Banco.executar(`
        INSERT INTO config_luz_pulsada (chave, valor) VALUES (?, ?)
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
    input.className = 'lp-aj-num-input mono';
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
    // "1.234,56"→1234.56 · "8,5"→8.5 · "8.5"→8.5 (comportamento p/ negativos mantido: retorna 0)
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
      const comp = `${window.__lp.anoSelecionado}-${window.__lp.mesSelecionado}`;
      const filtros = {
        codAdmissao:  window.__lp.filtroCodAdmissao,
        codPaciente:  window.__lp.filtroCodPaciente,
        nomePaciente: window.__lp.filtroNomePaciente,
      };
      const admissoes = carregarAdmissoesLP(comp, filtros, cfg);
      const total = admissoes.reduce((s, a) => s + (a.base_calculo || 0), 0);
      const taxa = total * (cfg.percentual || 0) / 100;

      const wb = XLSX.utils.book_new();
      const rows = [['Cód. Admissão','Paciente','Procedimento','Médico','Vínculo','Origem','Produção (R$)']];
      for (const a of admissoes) {
        rows.push([
          a.admissao,
          a.paciente || '',
          a.procedimento || '',
          a.nome_medico_oficial || a.nome_profissional || '',
          a.tipo_vinculo || '—',
          Utilidades.rotuloFonte(a.origem),   // V947
          a.base_calculo || 0,
        ]);
      }
      rows.push([]);
      rows.push(['', '', '', '', '', 'TOTAL PRODUÇÃO', total]);
      rows.push(['', '', '', '', '', `TAXA ${Utilidades.formatarNumero(cfg.percentual, 2)}%`, taxa]);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Luz Pulsada');
      XLSX.writeFile(wb, `LuzPulsada_${comp}.xlsx`);
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
        .lp-titulo-wrap { display: flex; align-items: center; gap: 10px; }
        .lp-btn-info {
          width: 28px; height: 28px; border-radius: 50%;
          background: var(--bg-elevated); border: 1px solid var(--border);
          color: #3f6489; font-size: 15px; font-weight: 700;
          cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
          transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        }
        .lp-btn-info:hover { background: #3f6489; color: white; transform: scale(1.08); }
        .lp-header-acoes { display: flex; gap: 8px; }

        /* Filtros */
        .lp-snapshot-bar {
          display: flex; align-items: center; gap: 10px;
          margin: 14px 0 8px; padding: 8px 14px;
          background: linear-gradient(135deg, #f2f3f5, #eef2f6);
          border: 1px solid #eef0f2;   /* V946 */
          border-left: 4px solid #3f6489;
          border-radius: 8px;
        }
        .lp-snapshot-icone { font-size: 14px; }
        .lp-snapshot-label {
          font-size: 11px; font-weight: 700;
          letter-spacing: 0.05em; text-transform: uppercase;
          color: #3a5877;
        }
        .lp-snapshot-select {
          padding: 5px 10px; font-size: 13px; font-weight: 700;
          background: white; border: 1px solid #eef0f2;   /* V946 */
          color: var(--primary); cursor: pointer;
          border-radius: 5px;
        }
        .lp-snapshot-hint {
          font-size: 10px; color: #5980a6; font-style: italic;
          margin-left: auto;
        }
        /* Contêiner da peça 20C (.lp-sb) + botão "✕ Limpar filtros".
           Classe contém "filtro" de propósito: o leque #atlas-hub ignora
           botões dentro de [class*="filtro"]. */
        .lp-filtros-bar {
          display: flex; flex-direction: column; gap: 6px;
          align-items: stretch;   /* a peça 20C estica de ponta a ponta */
          width: 100%; box-sizing: border-box;
          margin: 10px 0 0;
          /* o fade-in-up global (.page-content > *) deixa um transform
             residual (fill-mode both) que vira stacking context em cada
             irmão — sem z-index aqui os cards pintariam POR CIMA do painel */
          position: relative; z-index: 30;
        }
        .lp-filtros-bar > .btn-pequeno { align-self: flex-start; }
        .lp-secao-label {
          font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--ink-soft);
        }

        /* ── Fileira de filtros 20C (padrão do LIO/OPME, prefixo lp-sb) ── */
        .lp-sb {
          margin-top: 0; margin-bottom: 14px;   /* respiro antes dos cards */
          position: relative; z-index: 30;
          display: flex; align-items: stretch;
          padding: 6px;
          background: #fff;
          border: 1px solid #eef2f6;
          border-radius: 12px;
          box-shadow: 0 1px 2px rgba(89, 128, 166,.04), 0 10px 26px -20px rgba(89, 128, 166,.26);
          flex-wrap: wrap;
        }
        .lp-sb-celwrap { position: relative; min-width: 150px; display: flex; }
        .lp-sb-celwrap:not(:last-child) .lp-sb-cel { border-right: 1px solid #f7f8fa; }
        .lp-sb-cel {
          flex: 1; min-width: 0;
          display: flex; align-items: center; gap: 9px;
          padding: 9px 12px; border: none; border-radius: 9px;
          background: transparent; cursor: pointer;
          font-family: inherit; text-align: left;
          transition: background-color 120ms;
        }
        .lp-sb-cel:hover, .lp-sb-cel.ativo, .lp-sb-cel.aberta { background: #fafbfc; }
        .lp-sb-cel:focus-visible { outline: 2px solid #3f6489; outline-offset: 2px; }
        .lp-sb-tile {
          width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: #f0f5f9; color: #585d62;
        }
        .lp-sb-cel.ativo .lp-sb-tile, .lp-sb-cel.aberta .lp-sb-tile { background: #eef2f6; color: #46688c; }
        .lp-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
        .lp-sb-rot {
          font-size: 10px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .09em; color: #585d62; white-space: nowrap;
        }
        .lp-sb-val {
          font-size: 13px; font-weight: 500; color: #585d62;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .lp-sb-cel.ativo .lp-sb-val { font-weight: 700; color: #3a5877; }
        .lp-sb-chev { color: #8a9096; flex-shrink: 0; display: flex; transition: transform 140ms; }
        .lp-sb-cel.aberta .lp-sb-chev { transform: rotate(180deg); }

        /* painel ancorado na célula, por cima dos cards */
        .lp-sb-painel {
          position: absolute; top: 100%; left: 0; margin-top: 6px; z-index: 40;
          min-width: 100%; width: max-content; max-width: 340px;
          background: #fff; border: 1px solid #eef0f2; border-radius: 12px;
          box-shadow: 0 18px 44px -14px rgba(29, 31, 32,.42);
          overflow: hidden;
        }
        .lp-sb-buscabox {
          display: flex; align-items: center; gap: 8px;
          padding: 11px 12px 10px; border-bottom: 1px solid #f7f8fa;
        }
        .lp-sb-buscabox .lp-sb-busca-ic { color: #6b7d8e; display: flex; }
        .lp-sb-busca {
          flex: 1; height: 30px; border: 1px solid #eef0f2; border-radius: 8px;
          background: #fafbfc; padding: 0 10px; font-size: 13px;
          font-family: inherit; color: #3a5877; outline: none;
        }
        .lp-sb-busca::placeholder { color: #8a9096; }
        .lp-sb-busca:focus { border-color: #3f6489; }
        .lp-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; }
        .lp-sb-lista::-webkit-scrollbar { width: 8px; }
        .lp-sb-lista::-webkit-scrollbar-track { background: #f7f8fa; }
        .lp-sb-lista::-webkit-scrollbar-thumb { background: #e4eaf1; border-radius: 4px; }
        .lp-sb-it {
          display: flex; align-items: center; gap: 10px;
          height: 38px; padding: 0 8px; border-radius: 8px; cursor: pointer;
          font-size: 13px; color: #3a5877;
        }
        .lp-sb-it:hover, .lp-sb-it.foco { background: #f7f8fa; }
        .lp-sb-it.sel { background: #f7f8fa; font-weight: 700; }
        .lp-sb-it-todos { font-weight: 700; }
        .lp-sb-it-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lp-sb-ck { color: #46688c; display: flex; }
        .lp-sb-rodape {
          padding: 7px 12px; border-top: 1px solid #f7f8fa;
          font-size: 10.5px; font-weight: 600; color: #8a9096;
        }
        @media (max-width: 1280px) { .lp-sb-celwrap { flex-basis: 32%; } }
        @media (max-width: 900px)  { .lp-sb-celwrap { flex-basis: 48%; } }

        /* Cards KPI compactos */
        .lp-cards-grid {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px;
        }
        @media (max-width: 1000px) { .lp-cards-grid { grid-template-columns: repeat(2, 1fr); } }
        .lp-card {
          position: relative; padding: 12px 14px; border-radius: 10px; overflow: hidden;
          border: 1px solid transparent;
          display: flex; flex-direction: column;
        }
        .lp-card-faixa { position: absolute; top: 0; right: 0; bottom: 0; width: 3px; }
        .lp-card-titulo {
          font-size: 9px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.06em; margin-bottom: 6px;
          color: #1d1f20; /* V849: título dos cards totalizadores (variantes coloridas mantêm a própria) */
        }
        .lp-card-valor { font-size: 20px; font-weight: 800; line-height: 1.1; }
        .lp-card-sub { padding-top: 6px; font-size: 10px; color: var(--ink-soft); line-height: 1.4; }
        .lp-card-verde   { background: linear-gradient(135deg, #E8F1EE, #D4E4DF); border-color: #A8C8C0; }
        .lp-card-verde .lp-card-faixa { background: #5980a6; }
        .lp-card-verde .lp-card-titulo, .lp-card-verde .lp-card-valor { color: #5980a6; }
        .lp-card-roxo    { background: linear-gradient(135deg, #ECE5F2, #DAC8E4); border-color: #C0A8D0; }
        .lp-card-roxo .lp-card-faixa { background: #6B4587; }
        .lp-card-roxo .lp-card-titulo, .lp-card-roxo .lp-card-valor { color: #6B4587; }
        .lp-card-bege    { background: linear-gradient(135deg, #f2f3f5, #eef2f6); border-color: #C8D6D2; }   /* V946 */
        .lp-card-bege .lp-card-faixa { background: #5980a6; }
        .lp-card-bege .lp-card-titulo, .lp-card-bege .lp-card-valor { color: #5980a6; }
        .lp-card-destaque { background: linear-gradient(135deg, #5980a6, #3a5877); border-color: #5980a6; box-shadow: 0 4px 12px rgba(89, 128, 166,.2); }
        .lp-card-destaque .lp-card-titulo { color: #585d62; }
        .lp-card-destaque .lp-card-valor { color: #5980a6; }
        .lp-card-destaque .lp-card-sub { color: #e4eaf1; }

        .lp-card-breakdown {
          padding-top: 6px;
          display: flex; flex-direction: column; gap: 1px;
          font-size: 10px;
        }
        .lp-bd-item { display: flex; align-items: center; gap: 5px; color: var(--ink-soft); }
        .lp-bd-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
        .lp-bd-item strong { color: var(--ink); }

        .lp-card-comp {
          margin-top: 8px; padding-top: 6px;
          border-top: 1px dashed rgba(0,0,0,0.08);
          display: flex; gap: 10px; font-size: 10px;
        }
        .lp-card-comp-item { display: flex; align-items: center; gap: 4px; }
        .lp-card-comp-lbl { color: var(--ink-soft); font-weight: 600; font-size: 9px; white-space: nowrap; }
        .lp-comp-up    { color: #4f8a5b; font-weight: 700; }
        .lp-comp-down  { color: #a15646; font-weight: 700; }
        .lp-comp-igual { color: var(--ink-soft); font-weight: 600; }
        .lp-comp-vazio { color: var(--ink-faint); }
        .lp-card-destaque .lp-card-comp { border-top-color: #585d62; }
        .lp-card-destaque .lp-card-comp-lbl { color: #e4eaf1; }
        .lp-card-destaque .lp-comp-up    { color: #C8F5C0; }
        .lp-card-destaque .lp-comp-down  { color: #F5B5B5; }
        .lp-card-destaque .lp-comp-igual,
        .lp-card-destaque .lp-comp-vazio { color: #e4eaf1; }

        /* Card destacado da Taxa */
        .lp-card-taxa {
          background: linear-gradient(135deg, #f2f3f5 0%, #eef2f6 100%);
          border: 1px solid #eef0f2;   /* V946 */
          border-left: 5px solid #3f6489;
          border-radius: 12px;
          padding: 18px 22px;
          margin-bottom: 18px;
        }
        .lp-card-taxa-header {
          display: flex; align-items: center; gap: 10px; margin-bottom: 14px;
        }
        .lp-card-taxa-icone { font-size: 20px; }
        .lp-card-taxa-titulo {
          font-size: 12px; font-weight: 700; color: #3a5877;
          text-transform: uppercase; letter-spacing: 0.06em;
        }
        .lp-card-taxa-info {
          display: grid; grid-template-columns: 1.8fr 1fr 1.5fr; gap: 18px;
          padding-bottom: 14px;
          border-bottom: 1px solid rgba(212, 190, 126, 0.6);
          margin-bottom: 14px;
        }
        @media (max-width: 800px) { .lp-card-taxa-info { grid-template-columns: 1fr; } }
        .lp-info-label {
          font-size: 9px; color: #5980a6; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;
        }
        .lp-info-valor {
          font-size: 14px; font-weight: 700; color: var(--ink); line-height: 1.3;
        }
        .lp-card-taxa-calc {
          background: #5980a6;
          color: #fafbfc;
          padding: 12px 18px;
          border-radius: 8px;
        }
        .lp-calc-label {
          font-size: 10px; font-weight: 700; color: #3f6489;
          text-transform: uppercase; letter-spacing: 0.06em;
          margin-bottom: 6px;
        }
        .lp-calc-formula {
          font-size: 14px; font-weight: 600; color: #C8D6D2;
        }
        .lp-calc-resultado {
          font-size: 20px; font-weight: 800; color: #C8D6D2;   /* V946 */
          margin-left: 4px;
        }

        /* Tabela */
        .lp-tabela thead th {
          text-transform: none !important;
          letter-spacing: 0 !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          color: var(--ink) !important;
        }
        .lp-medico-nome { font-weight: 600; }
        /* V946: tags de fonte pagadora = padrão global (.atlas-fonte); a linha de total saiu */

        /* Popovers */
        .lp-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 100; }
        .lp-popover {
          position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
          width: 580px; max-width: calc(100vw - 60px);
          max-height: calc(100vh - 120px); overflow-y: auto;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,0.2); z-index: 101;
        }
        .lp-popover-regras { width: 680px; }
        .lp-popover-header {
          padding: 14px 18px; border-bottom: 1px solid var(--border);
          display: flex; justify-content: space-between; align-items: center;
        }
        .lp-popover-header h3 {
          margin: 0; font-family: var(--font-display); font-weight: 500; font-size: 16px;
        }
        .lp-popover-close {
          background: transparent; border: none; font-size: 22px;
          color: var(--ink-soft); cursor: pointer; padding: 0 4px;
        }
        .lp-aj-bloco { padding: 16px 20px; border-bottom: 1px solid var(--border); }
        .lp-aj-bloco:last-child { border-bottom: none; }
        .lp-aj-titulo {
          font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--primary); margin-bottom: 12px;
        }
        .lp-aj-campo { margin-bottom: 14px; }
        .lp-aj-label {
          display: block;
          font-size: 10px; font-weight: 600; color: var(--ink-soft);
          text-transform: uppercase; letter-spacing: 0.05em;
          margin-bottom: 4px;
        }
        .lp-aj-select {
          width: 100%; padding: 8px 10px;
          border: 1px solid var(--border); border-radius: 6px;
          font-size: 13px; font-weight: 500; background: white;
        }
        .lp-aj-pct {
          display: inline-flex; align-items: center; gap: 4px;
          background: var(--bg-sunken); padding: 8px 14px;
          border-radius: 8px; border: 1px solid var(--border);
          font-size: 18px; font-weight: 800; color: var(--primary);
        }
        .lp-aj-num { cursor: pointer; padding: 1px 4px; border-radius: 4px; }
        .lp-aj-num:hover { background: white; }
        .lp-aj-num-input {
          font-family: var(--font-mono); font-size: 18px; font-weight: 800;
          padding: 1px 4px; border: 1px solid var(--accent); border-radius: 4px;
          width: 110px; outline: none;
        }
        .lp-aj-help-inline { font-size: 10px; color: var(--ink-faint); margin-top: 4px; font-style: italic; }
        .lp-aj-base-grid { display: flex; flex-direction: column; gap: 6px; }
        .lp-aj-chk-linha {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px; background: var(--bg-sunken);
          border: 1px solid var(--border); border-radius: 8px;
          cursor: pointer; font-size: 12px;
        }
        .lp-aj-chk-linha:hover { background: white; }

        .lp-vinc-grid { display: flex; gap: 12px; flex-wrap: wrap; }
        .lp-vinc-chk {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 10px; border: 1px solid var(--border); border-radius: 8px;
          cursor: pointer; background: var(--bg-sunken);
        }
        .lp-vinc-chk:hover { background: white; }
        .lp-aj-help { font-size: 10px; color: var(--ink-faint); margin-top: 8px; }

        /* Mostrar/Ocultar */
        .lp-ocultar-lista {
          display: flex; flex-direction: column; gap: 6px;
          background: var(--bg-sunken); padding: 8px; border-radius: 8px;
        }
        .lp-ocultar-linha {
          display: flex; align-items: center; gap: 10px;
          padding: 6px 10px; background: white; border-radius: 6px;
          border: 1px solid var(--border);
        }
        .lp-ocultar-fixa {
          background: rgba(89, 128, 166, 0.04);
          border-color: rgba(89, 128, 166, 0.15);
        }
        .lp-ocultar-chk { display: flex; align-items: center; cursor: pointer; }
        .lp-ocultar-chk input { cursor: pointer; }
        .lp-ocultar-chk input:disabled { cursor: not-allowed; opacity: 0.5; }
        .lp-ocultar-input {
          flex: 1; padding: 4px 8px;
          font-size: 12px; font-weight: 500;
          border: 1px solid transparent; border-radius: 4px;
          background: transparent; font-family: inherit;
        }
        .lp-ocultar-input:hover { border-color: var(--border); }
        .lp-ocultar-input:focus { outline: none; border-color: var(--accent); background: white; }
        .lp-ocultar-fixa-tag {
          font-size: 9px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--ink-faint);
          background: rgba(89, 128, 166, 0.08);
          padding: 2px 7px; border-radius: 4px;
        }
        .lp-ocultar-acoes { margin-top: 12px; display: flex; align-items: center; gap: 12px; }

        /* Regras */
        .lp-regras-body { padding: 4px 0; }
        .lp-regra-bloco { padding: 14px 22px; border-bottom: 1px solid var(--border); }
        .lp-regra-bloco:last-child { border-bottom: none; }
        .lp-regra-titulo {
          display: flex; align-items: center; gap: 10px;
          font-size: 13px; font-weight: 700; color: var(--primary);
          margin-bottom: 10px;
        }
        .lp-regra-num {
          display: inline-flex; align-items: center; justify-content: center;
          width: 22px; height: 22px; background: var(--primary); color: white;
          border-radius: 50%; font-size: 11px; font-weight: 700;
        }
        .lp-regra-lista {
          margin: 0; padding-left: 22px;
          font-size: 12px; color: var(--ink); line-height: 1.65;
        }
        .lp-regra-lista li { margin-bottom: 4px; }
        .lp-regra-lista code {
          background: var(--bg-sunken); padding: 1px 6px;
          border-radius: 3px; font-size: 11px;
        }
        .lp-regra-formula {
          background: var(--bg-sunken); padding: 10px 14px;
          border-left: 3px solid var(--accent); border-radius: 6px;
          font-size: 13px; font-weight: 700; color: var(--primary);
        }
    `;
  }

};
