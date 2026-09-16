/**
 * ============================================================================
 * TELA: Desempenho · Estrabismo
 *
 * Regra de repasse:
 *   - Cirurgia unilateral (qtd = 1)  → R$ 1.260 (convênio) ou R$ 300 (SUS)
 *   - Cirurgia bilateral  (qtd = 2)  → R$ 1.680 (convênio) ou R$ 300 (SUS)
 *
 * O usuário marca, para cada linha de produto contendo "ESTRABISMO" na base
 * de produção, a quantidade aplicável (1 ou 2). A marcação fica salva em
 * `marcacoes_estrabismo` e o valor de repasse é calculado dinamicamente.
 *
 * Identificação de SUS: pelo campo `tipo_recebimento = 'SUS'` da linha.
 *
 * Valores são editáveis no painel ⚙ Ajustes.
 * ============================================================================
 */

App.telas['desempenho-estrabismo'] = function () {

  // Estado da tela
  if (window.__estr === undefined) {
    window.__estr = {
      anoSelecionado: null,
      mesSelecionado: null,
      ajustesAberto: false,
      regrasAberto: false,
      ocultarAberto: false,
      linhasExpandidas: new Set(),  // ids de médicos expandidos
      foiInicializado: false,
      // Filtros de texto (combobox)
      filtroCodAdmissao: '',
      filtroCodPaciente: '',
      filtroNomePaciente: '',
      // Filtros de tipo de vínculo (default: todos ativos)
      filtroVinculos: new Set(['INTERNO', 'HIBRIDO', 'EXTERNO']),
      // Configuração de colunas da tabela principal (nome + visibilidade)
      // Persistente em localStorage via salvarConfigColunas/carregarConfigColunas.
      configColunas: null,  // populado em renderizar
    };
  }

  // Configuração de colunas: id estável + label padrão.
  // O usuário pode renomear ("label") e ocultar ("visivel") via popover.
  const COLUNAS_PADRAO = [
    { id: 'medico',     label: 'Médico (Cirurgião)', visivel: true, fixa: true },
    { id: 'admissoes',  label: 'Admissões',          visivel: true, fixa: false },
    { id: 'produzido',  label: 'Produzido (R$)',     visivel: true, fixa: false },
    { id: 'marcadas',   label: 'Marcadas',           visivel: true, fixa: false },
    { id: 'repasse',    label: 'Repasse',            visivel: true, fixa: false },
  ];
  const STORAGE_KEY_COLS = 'estr_colunas_config_v1';

  // Meses por extenso (fileira de filtros 20C) — declarado ANTES do primeiro
  // renderizar() lá embaixo pra não cair na zona morta temporal (TDZ).
  const MESES_EXTENSO_SB = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  function carregarConfigColunas() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_COLS);
      if (!raw) return JSON.parse(JSON.stringify(COLUNAS_PADRAO));
      const salvo = JSON.parse(raw);
      // Faz merge com COLUNAS_PADRAO para garantir que novas colunas
      // futuras apareçam mesmo se o usuário tiver config antiga
      return COLUNAS_PADRAO.map(p => {
        const s = salvo.find(x => x.id === p.id);
        return s ? { ...p, label: s.label, visivel: s.visivel !== false } : p;
      });
    } catch (e) {
      return JSON.parse(JSON.stringify(COLUNAS_PADRAO));
    }
  }
  function salvarConfigColunas(cfg) {
    try {
      localStorage.setItem(STORAGE_KEY_COLS, JSON.stringify(cfg));
    } catch (e) {
      console.warn('Não consegui salvar config de colunas:', e.message);
    }
  }

  renderizar();

  function renderizar() {
    try {
      _renderizarInterno();
    } catch (e) {
      console.error('Erro Estrabismo:', e);
      document.getElementById('conteudo').innerHTML = `
        <div class="page-content">
          <header class="page-header"><h2>Estrabismo</h2></header>
          <div class="card" style="background: #FEE; border-color: #D88; padding: 18px">
            <h3 style="margin: 0 0 8px; color: #9B3A3A">⚠ Erro ao renderizar</h3>
            <pre style="font-size: 11px; white-space: pre-wrap; background: white; padding: 12px; border-radius: 8px">${escapeHTML(e.message)}\n\n${escapeHTML(e.stack || '')}</pre>
          </div>
        </div>
      `;
    }
  }

  function _renderizarInterno() {
    const cfg = carregarConfig();
    const periodos = listarPeriodosEstrab();

    // Carrega config de colunas (uma vez por sessão, mas pode ser recarregada via popover)
    if (!window.__estr.configColunas) {
      window.__estr.configColunas = carregarConfigColunas();
    }

    if (!window.__estr.anoSelecionado && periodos.length > 0) {
      const [ano, mes] = periodos[0].split('-');
      window.__estr.anoSelecionado = ano;
      window.__estr.mesSelecionado = mes;
    }

    const competencia = (window.__estr.anoSelecionado && window.__estr.mesSelecionado)
      ? `${window.__estr.anoSelecionado}-${window.__estr.mesSelecionado}`
      : null;

    // Filtros de texto (combobox)
    const filtros = {
      codAdmissao:  window.__estr.filtroCodAdmissao,
      codPaciente:  window.__estr.filtroCodPaciente,
      nomePaciente: window.__estr.filtroNomePaciente,
    };

    // ───────────────────────────────────────────────────────────────────
    // Busca linhas + marcações para o mês ATUAL (com filtros aplicados)
    const linhas = competencia ? carregarLinhasEstrabismo(competencia, filtros) : [];
    const marcacoes = competencia ? carregarMarcacoes(competencia) : new Map();

    // Detecta repetições de admissão/paciente em meses anteriores (alerta)
    const repeticoes = competencia ? detectarRepeticoes(linhas, competencia) : new Map();

    // ───────────────────────────────────────────────────────────────────
    // ───────────────────────────────────────────────────────────────────
    // Agrupa por médico ANTES de calcular KPIs (para respeitar TODOS os
    // filtros: período, texto, vínculo). KPIs do mês + comparativos LM/LY
    // são derivados das admissões agrupadas que sobraram após filtrar.
    const porMedico = agruparPorMedico(linhas, marcacoes, cfg, repeticoes);
    const kpis = kpisDePorMedico(porMedico, linhas);

    let kpisLM = null, kpisLY = null, kpisYTD = null;
    if (competencia) {
      const compLM = compMesAnterior(competencia);
      const compLY = compAnoAnterior(competencia);
      // LM
      try {
        const lLM = carregarLinhasEstrabismo(compLM, filtros);
        if (lLM.length > 0) {
          const pmLM = agruparPorMedico(lLM, carregarMarcacoes(compLM), cfg, new Map());
          kpisLM = kpisDePorMedico(pmLM, lLM);
        }
      } catch (e) {}
      // LY
      try {
        const lLY = carregarLinhasEstrabismo(compLY, filtros);
        if (lLY.length > 0) {
          const pmLY = agruparPorMedico(lLY, carregarMarcacoes(compLY), cfg, new Map());
          kpisLY = kpisDePorMedico(pmLY, lLY);
        }
      } catch (e) {}
      // YTD (todas as competências do mesmo ano até este mês)
      try {
        const compsYTD = competenciasAteEsteMes(competencia);
        const marcsYTD = new Map();
        for (const c of compsYTD) {
          const m = carregarMarcacoes(c);
          for (const [k, v] of m) marcsYTD.set(`${c}|${k}`, v);
        }
        const linhasYTD = carregarLinhasEstrabismo(compsYTD, filtros);
        // Para YTD precisa de versão que entenda competencia na chave de marcações
        kpisYTD = calcularKPIsYTD(linhasYTD, marcsYTD, cfg);
      } catch (e) {
        console.warn('Erro ao calcular YTD:', e.message);
      }
    }

    // Na PRIMEIRA renderização (Set vazio), expande TODOS os médicos
    // automaticamente para o usuário ver as caixas de quantidade sem precisar
    // adivinhar. Depois disso, respeita as escolhas do usuário.
    if (window.__estr.linhasExpandidas.size === 0 && !window.__estr.foiInicializado && porMedico.length > 0) {
      porMedico.forEach(m => window.__estr.linhasExpandidas.add(m.id));
      window.__estr.foiInicializado = true;
    }

    // V492: CSS injetado UMA vez no <head> (antes: <style> dentro do innerHTML a cada render)
    Utilidades.garantirEstilos('css-tela-estrabismo', getStyles());

    document.getElementById('conteudo').innerHTML = `
      <div class="page-content estr-page">
        ${renderHeader()}
        ${window.__estr.ajustesAberto ? renderPopoverAjustes(cfg) : ''}
        ${window.__estr.regrasAberto ? renderPopoverRegras(cfg) : ''}
        ${window.__estr.ocultarAberto ? renderPopoverOcultar() : ''}
        ${renderFiltros(periodos)}
        ${renderCards(kpis, kpisLM, kpisLY, kpisYTD, cfg, competencia)}
        ${renderDetalheAdmissao(competencia, filtros)}
        ${renderTabela(porMedico, cfg, competencia)}
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
          <div class="estr-titulo-wrap">
            <h2>Estrabismo</h2>
            <button class="estr-btn-info" id="btn-estr-info" title="Regras de repasse de Estrabismo">ⓘ</button>
          </div>
          <div class="subtitle">Repasse fixo por cirurgia · marque a quantidade (1 ou 2) em cada linha</div>
        </div>
        <div class="estr-header-acoes">
          <button class="btn" id="btn-estr-mostrar-ocultar" title="Mostrar/ocultar colunas e renomear">⋮ Mostrar/Ocultar</button>
          <button class="btn" id="btn-estr-ajustes" title="Editar valores de repasse">⚙ Ajustes</button>
          <button class="btn btn-primary" id="btn-estr-exportar">↓ Exportar Excel <span style="font-size: 9px">▾</span></button>
        </div>
      </header>
    `;
  }

  // ==========================================================================
  // FILTROS
  // ==========================================================================

  function renderFiltros(periodos) {
    if (periodos.length === 0) {
      return `
        <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 30px 20px">
          <div style="color: var(--ink-faint); font-size: 13px">
            Nenhuma cirurgia de estrabismo encontrada na produção.<br>
            <span style="font-size: 11px">Vá em Processamento → Importar PRODUÇÃO para começar.</span>
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
    const anoAtual = window.__estr.anoSelecionado;
    const mesesDoAno = (anosMap.get(anoAtual) || []).slice().sort();

    const temFiltros = Utilidades.filtroMulti.ativo(window.__estr.filtroCodAdmissao)
      || Utilidades.filtroMulti.ativo(window.__estr.filtroCodPaciente)
      || Utilidades.filtroMulti.ativo(window.__estr.filtroNomePaciente);

    return `
      <div class="estr-filtros-bar">
        ${renderBarraFiltrosEstr20C({ anos, mesesDoAno })}
        ${temFiltros ? `
          <button class="btn btn-pequeno" id="btn-estr-limpar-filtros">✕ Limpar filtros</button>
        ` : ''}
      </div>
    `;
  }

  // ── Fileira de filtros 20C (padrão do LIO/OPME, prefixo estr-sb) ──────────
  // UMA peça branca com células (tile de ícone + rótulo + valor + chevron);
  // painéis ancorados abrem/fecham LOCAL (insertAdjacentHTML, zero re-render);
  // aplicar seta a MESMA chave de estado dos handlers antigos e chama renderizar().
  function _estrSbIc(nome) {
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
  function _estrSbSvg(d, px, sw) {
    return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  function _estrSbSemAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function renderBarraFiltrosEstr20C(ctx) {
    // guarda as listas pro painel abrir LOCAL depois, sem recoletar
    window.__estr._sbOpcoes = {
      anos: ctx.anos,
      meses: ctx.mesesDoAno,
      codAdm: carregarOpcoesCombo('cod-adm'),
      codPac: carregarOpcoesCombo('cod-pac'),
      nomePac: carregarOpcoesCombo('nome-pac'),
    };
    const cel = (id, rotulo, valor, icone, flex, vazio = 'Todos') => {
      const ativo = !!valor;
      const estaAberta = window.__estr.sbAberto === id;
      return `
        <div class="estr-sb-celwrap" style="flex:${flex}">
          <button type="button" class="estr-sb-cel ${ativo ? 'ativo' : ''} ${estaAberta ? 'aberta' : ''}"
                  data-sb-cel="${id}" data-sb-vazio="${vazio}" role="combobox" aria-expanded="${estaAberta ? 'true' : 'false'}" aria-haspopup="listbox">
            <span class="estr-sb-tile">${_estrSbSvg(_estrSbIc(icone), 14, 2.1)}</span>
            <span class="estr-sb-tx">
              <span class="estr-sb-rot">${rotulo}</span>
              <span class="estr-sb-val">${escapeHTML(valor || vazio)}</span>
            </span>
            <span class="estr-sb-chev">${_estrSbSvg(_estrSbIc('chev'), 10, 2.8)}</span>
          </button>
          ${estaAberta ? painelEstr20C(id) : ''}
        </div>`;
    };
    const mesLabel = window.__estr.mesSelecionado
      ? (MESES_EXTENSO_SB[parseInt(window.__estr.mesSelecionado, 10) - 1] || window.__estr.mesSelecionado)
      : '';
    // V922: filtros de conteúdo em MULTI — o rótulo mostra "N selecionados"
    const FM = Utilidades.filtroMulti;
    const rotMulti = (f) => FM.ativo(f) ? FM.rotulo(f) : '';
    return `
      <div class="estr-sb" id="estr-sb">
        ${cel('ano', 'Ano', window.__estr.anoSelecionado || '', 'clock', 0.75)}
        ${cel('mes', 'Mês', mesLabel, 'calendar', 0.8)}
        ${cel('cod_adm', 'Cód. Admissão', rotMulti(window.__estr.filtroCodAdmissao), 'alignleft', 1.05)}
        ${cel('cod_pac', 'Cód. Paciente', rotMulti(window.__estr.filtroCodPaciente), 'hash', 1.05)}
        ${cel('nome_pac', 'Nome do Paciente', rotMulti(window.__estr.filtroNomePaciente), 'user', 1.35)}
      </div>`;
  }

  function painelEstr20C(id) {
    const opc = window.__estr._sbOpcoes || {};
    const item = (val, rotulo, sel) => `
      <div class="estr-sb-it ${sel ? 'sel' : ''} ${val === '' ? 'estr-sb-it-todos' : ''}" data-sb-item data-val="${escapeAttr(val)}" data-busca="${escapeAttr(_estrSbSemAcento(rotulo))}" role="option" aria-selected="${sel ? 'true' : 'false'}">
        <span class="estr-sb-it-nome">${escapeHTML(rotulo)}</span>
        ${sel ? `<span class="estr-sb-ck">${_estrSbSvg(_estrSbIc('check'), 14, 2.5)}</span>` : ''}
      </div>`;
    // comTodos: Ano/Mês NÃO têm "Todos" — a tela exige uma competência ativa
    // (mesmo comportamento dos <select> antigos, que não tinham opção vazia).
    const painelLista = (cel, opcoes, valAtual, { busca = false, comTodos = true } = {}) => `
      <div class="estr-sb-painel" data-sb-painel="${cel}">
        ${busca ? `
          <div class="estr-sb-buscabox">
            <span class="estr-sb-busca-ic">${_estrSbSvg(_estrSbIc('search'), 15, 2.1)}</span>
            <input type="text" class="estr-sb-busca" data-sb-busca placeholder="Digite pra buscar" autocomplete="off">
          </div>` : ''}
        <div class="estr-sb-lista" role="listbox">
          ${comTodos ? item('', 'Todos', !valAtual) : ''}
          ${opcoes.slice(0, 400).map(o => item(o.v, o.r, valAtual === o.v)).join('')}
        </div>
        ${busca ? `<div class="estr-sb-rodape" data-sb-contagem>${opcoes.length} opç${opcoes.length === 1 ? 'ão' : 'ões'}</div>` : ''}
      </div>`;
    const lisos = arr => (arr || []).map(v => ({ v, r: v }));
    if (id === 'ano') return painelLista('ano', lisos(opc.anos), window.__estr.anoSelecionado || '', { comTodos: false });
    if (id === 'mes') return painelLista('mes', (opc.meses || []).map(m => ({ v: m, r: MESES_EXTENSO_SB[parseInt(m, 10) - 1] || m })), window.__estr.mesSelecionado || '', { comTodos: false });
    // V922: filtros de conteúdo em MULTI — checkbox + busca; marcados ficam no topo
    const FM = Utilidades.filtroMulti;
    const painelMulti = (cel, opcoes, f) => {
      const sel = FM.sel(f);
      const marcadas = opcoes.filter(o => sel.includes(String(o.v)));
      const demais = opcoes.filter(o => !sel.includes(String(o.v)));
      const lista = [...marcadas, ...demais];
      return `
      <div class="estr-sb-painel" data-sb-painel="${cel}" data-sb-multi="1">
        <div class="estr-sb-buscabox">
          <span class="estr-sb-busca-ic">${_estrSbSvg(_estrSbIc('search'), 15, 2.1)}</span>
          <input type="text" class="estr-sb-busca" data-sb-busca placeholder="Digite pra buscar" autocomplete="off">
        </div>
        <div class="estr-sb-lista" role="listbox">
          ${item('', 'Todos', sel.length === 0)}
          ${lista.slice(0, 400).map(o => item(o.v, o.r, sel.includes(String(o.v)))).join('')}
        </div>
        <div class="estr-sb-rodape" data-sb-contagem>${sel.length ? `${sel.length} selecionado${sel.length === 1 ? '' : 's'} · ` : ''}${opcoes.length} opç${opcoes.length === 1 ? 'ão' : 'ões'}</div>
      </div>`;
    };
    if (id === 'cod_adm') return painelMulti('cod_adm', lisos(opc.codAdm), window.__estr.filtroCodAdmissao);
    if (id === 'cod_pac') return painelMulti('cod_pac', lisos(opc.codPac), window.__estr.filtroCodPaciente);
    return painelMulti('nome_pac', lisos(opc.nomePac), window.__estr.filtroNomePaciente);
  }

  function bindBarraFiltrosEstr20C() {
    const sb = document.getElementById('estr-sb');
    if (!sb) return;
    const fecharPainelLocal = () => {
      sb.querySelectorAll('.estr-sb-painel').forEach(p => p.remove());
      sb.querySelectorAll('.estr-sb-cel.aberta').forEach(c => { c.classList.remove('aberta'); c.setAttribute('aria-expanded', 'false'); });
      window.__estr.sbAberto = null;
    };
    const aplicar = (celId, val) => {
      // MESMAS chaves de estado + MESMO re-render dos handlers antigos
      // V922: filtros de conteúdo viraram MULTI — clicar alterna o item
      // (checkbox) e a lista FICA ABERTA; "Todos" limpa; a busca é preservada.
      const FM = Utilidades.filtroMulti;
      const campoMulti = celId === 'cod_adm' ? 'filtroCodAdmissao'
        : celId === 'cod_pac' ? 'filtroCodPaciente'
        : celId === 'nome_pac' ? 'filtroNomePaciente' : null;
      if (campoMulti) {
        const buscaEl = sb.querySelector('[data-sb-busca]');
        window.__estr._sbBusca = buscaEl ? buscaEl.value : '';
        window.__estr[campoMulti] = val === '' ? [] : FM.toggle(window.__estr[campoMulti], val);
        renderizar();   // sbAberto continua = celId → o painel re-abre marcado
        return;
      }
      window.__estr._sbBusca = '';
      if (celId === 'ano') {
        window.__estr.anoSelecionado = val;
        const periodos = listarPeriodosEstrab();
        const mesesAno = periodos.filter(p => p.startsWith(val + '-'))
                                 .map(p => p.split('-')[1]).sort();
        window.__estr.mesSelecionado = mesesAno[0] || null;
      } else if (celId === 'mes') {
        window.__estr.mesSelecionado = val;
      }
      window.__estr.sbAberto = null;
      renderizar();
    };
    const wireInputsPainel = () => {
      const busca = sb.querySelector('[data-sb-busca]');
      if (!busca) return;
      setTimeout(() => busca.focus(), 0);
      const filtrar = () => {
        const q = _estrSbSemAcento(busca.value);
        const painel = busca.closest('.estr-sb-painel');
        let n = 0;
        painel.querySelectorAll('[data-sb-item]').forEach(el => {
          // V922: itens MARCADOS ficam sempre visíveis (a busca refina o resto)
          const marcado = el.classList.contains('sel');
          const mostra = el.classList.contains('estr-sb-it-todos') || marcado || !q || (el.dataset.busca || '').includes(q);
          el.style.display = mostra ? '' : 'none';
          if (mostra && !el.classList.contains('estr-sb-it-todos')) n++;
        });
        const cont = painel.querySelector('[data-sb-contagem]');
        if (cont) cont.textContent = `${n} opç${n === 1 ? 'ão' : 'ões'}`;
      };
      busca.addEventListener('input', filtrar);
      // V922: o texto digitado sobrevive ao re-render de cada marcação
      if (window.__estr._sbBusca) { busca.value = window.__estr._sbBusca; filtrar(); }
    };
    const abrirPainelLocal = (id) => {
      const jaAberto = window.__estr.sbAberto === id;
      fecharPainelLocal();
      window.__estr._sbBusca = '';   // V922: busca não vaza de um painel pro outro
      if (jaAberto) return;
      window.__estr.sbAberto = id;
      const btn = sb.querySelector(`[data-sb-cel="${id}"]`);
      btn.classList.add('aberta');
      btn.setAttribute('aria-expanded', 'true');
      btn.parentElement.insertAdjacentHTML('beforeend', painelEstr20C(id));
      wireInputsPainel();
    };
    // V922: o painel pode já vir aberto do template (re-render após marcar) —
    // religa a busca e restaura o texto digitado
    if (window.__estr.sbAberto && sb.querySelector('.estr-sb-painel')) wireInputsPainel();
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
      if (!window.__estr.sbAberto) return;
      const painel = sb.querySelector('.estr-sb-painel');
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
    if (window.__estrSbFechar) {
      document.removeEventListener('click', window.__estrSbFechar);
      document.removeEventListener('keydown', window.__estrSbEsc);
    }
    const fecharFora = (e) => {
      if (App.telaAtual !== 'desempenho-estrabismo') return;
      if (window.__estr.sbAberto && !e.target.closest('#estr-sb')) fecharPainelLocal();
    };
    const escFecha = (e) => { if (e.key === 'Escape' && window.__estr.sbAberto) fecharPainelLocal(); };
    window.__estrSbFechar = fecharFora;
    window.__estrSbEsc = escFecha;
    document.addEventListener('click', fecharFora);
    document.addEventListener('keydown', escFecha);
    if (window.__estr.sbAberto) wireInputsPainel();
  }

  /**
   * Carrega valores únicos para o combobox.
   * Restringe ao período ativo e ao filtro de estrabismo (sem TAXA/PACOTE).
   */
  function carregarOpcoesCombo(tipo) {
    if (!window.__estr.anoSelecionado || !window.__estr.mesSelecionado) return [];
    const comp = `${window.__estr.anoSelecionado}-${window.__estr.mesSelecionado}`;
    const coluna = tipo === 'cod-adm' ? 'cod_admissao'
                 : tipo === 'cod-pac' ? 'cod_paciente'
                 : 'paciente';
    const rows = Banco.query(
      `SELECT DISTINCT ${coluna} AS v
       FROM linhas_producao
       WHERE UPPER(COALESCE(produto, '')) LIKE '%ESTRABISMO%'
         AND UPPER(COALESCE(produto, '')) NOT LIKE '%TAXA%'
         AND UPPER(COALESCE(produto, '')) NOT LIKE '%PACOTE%'
         AND competencia = ?
         AND ${coluna} IS NOT NULL AND ${coluna} != ''
       ORDER BY ${coluna}
       LIMIT 500`,
      [comp]
    );
    return rows.map(r => String(r.v));
  }

  // ==========================================================================
  // KPIs (4 cards)
  // ==========================================================================

  function renderCards(k, kLM, kLY, kYTD, cfg, competencia) {
    if (!competencia) return '';

    // Helper para badge de comparativo
    const badge = (atual, comp) => {
      if (comp === null || comp === undefined) return '<span class="estr-comp-vazio">—</span>';
      if (!comp) {
        if (atual > 0) return `<span class="estr-comp-up">↑ novo</span>`;
        return `<span class="estr-comp-igual">↔ 0,0%</span>`;
      }
      const pct = ((atual - comp) / comp) * 100;
      if (Math.abs(pct) < 0.05) return `<span class="estr-comp-igual">↔ 0,0%</span>`;
      const cls = pct > 0 ? 'estr-comp-up' : 'estr-comp-down';
      const seta = pct > 0 ? '↑' : '↓';
      return `<span class="${cls}">${seta} ${Utilidades.formatarNumero(Math.abs(pct), 1)}%</span>`;
    };

    const linhaComp = (atual, valLM, valLY) => `
      <div class="estr-card-comp">
        <div class="estr-card-comp-item"><span class="estr-card-comp-lbl">vs LM</span> ${badge(atual, valLM)}</div>
        <div class="estr-card-comp-item"><span class="estr-card-comp-lbl">vs LY</span> ${badge(atual, valLY)}</div>
      </div>
    `;

    return `
      <div class="estr-cards-grid">
        <!-- Card 1: Admissões + breakdown por tipo -->
        <div class="estr-card estr-card-verde">
          <div class="estr-card-faixa"></div>
          <div class="estr-card-titulo">Admissões de Estrabismo</div>
          <div class="estr-card-valor mono">${k.admissoes}</div>
          <div class="estr-card-breakdown">
            <div class="estr-breakdown-item"><span class="estr-bd-dot" style="background: #003A54"></span> Convênio: <strong>${k.admConvenio}</strong></div>
            <div class="estr-breakdown-item"><span class="estr-bd-dot" style="background: #003A54"></span> SUS: <strong>${k.admSus}</strong></div>
            <div class="estr-breakdown-item"><span class="estr-bd-dot" style="background: #6B4587"></span> Particular: <strong>${k.admParticular}</strong></div>
          </div>
          ${linhaComp(k.admissoes, kLM?.admissoes, kLY?.admissoes)}
        </div>

        <!-- Card 2: Produção YTD -->
        <div class="estr-card estr-card-roxo">
          <div class="estr-card-faixa"></div>
          <div class="estr-card-titulo">Produção YTD</div>
          <div class="estr-card-valor mono">R$ ${Utilidades.formatarNumero((kYTD?.producao || 0), 2)}</div>
          <div class="estr-card-sub">${kYTD?.admissoes || 0} adm · Repasse: <strong>R$ ${Utilidades.formatarNumero((kYTD?.repasse || 0), 2)}</strong></div>
        </div>

        <!-- Card 3: Produção R$ do mês -->
        <div class="estr-card estr-card-bege">
          <div class="estr-card-faixa"></div>
          <div class="estr-card-titulo">Produção · Mês</div>
          <div class="estr-card-valor mono">R$ ${Utilidades.formatarNumero(k.producao, 2)}</div>
          ${linhaComp(k.producao, kLM?.producao, kLY?.producao)}
        </div>

        <!-- Card 4: Repasse Total (destaque) -->
        <div class="estr-card estr-card-destaque">
          <div class="estr-card-titulo">Repasse Total · Mês</div>
          <div class="estr-card-valor mono">R$ ${Utilidades.formatarNumero(k.repasse, 2)}</div>
          <div class="estr-card-sub">${k.marcadas}/${k.admissoes} marcadas</div>
          ${linhaComp(k.repasse, kLM?.repasse, kLY?.repasse)}
        </div>
      </div>
    `;
  }

  function formatarComp(comp) {
    if (!comp) return '—';
    const [a, m] = comp.split('-');
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return `${meses[Number(m) - 1] || m}/${a}`;
  }

  // KPIs para YTD: igual ao calcularKPIs, mas a chave de marcação inclui a
  // competência (porque admissões diferentes em meses diferentes podem
  // coincidir em cod). Pré-construído pelo chamador.
  function calcularKPIsYTD(linhas, marcacoes, cfg) {
    // Mapa cod_admissao+competencia → dados consolidados
    const admMap = new Map();
    for (const l of linhas) {
      const key = `${l.competencia}|${l.cod_admissao}`;
      if (!admMap.has(key)) {
        admMap.set(key, {
          cod: String(l.cod_admissao),
          competencia: l.competencia,
          tipo_receb: l.tipo_receb,
          somaExec: new Map(),   // V914: exec → soma (pro cirurgião principal)
        });
      }
      // V914: acumula por executante — mesmo critério do agrupamento mensal
      const ex = l.exec_cirurgiao || l.exec_medico || '';
      const se = admMap.get(key).somaExec;
      se.set(ex, (se.get(ex) || 0) + (Number(l.valor_producao) || 0));
    }

    // V914: valores fixos por médico + resolvedor nome→medico_id (cadastro + sinônimos)
    const valoresMed = carregarValoresMedico();
    const nomeMedId = new Map();
    if (valoresMed.size > 0) {
      try {
        (Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM medicos WHERE ativo = 1`) || []).forEach(m => {
          nomeMedId.set((m.nome_oficial || '').toUpperCase().trim(), m.id);
          nomeMedId.set(m.nome_normalizado, m.id);
        });
        (Banco.query(`SELECT grafia, grafia_normalizada, medico_id FROM sinonimos_medico`) || []).forEach(s => {
          nomeMedId.set((s.grafia || '').toUpperCase().trim(), s.medico_id);
          nomeMedId.set(s.grafia_normalizada, s.medico_id);
        });
      } catch (e) {}
    }
    const valorFixoDaAdm = (adm) => {
      if (valoresMed.size === 0) return null;
      let nome = '', melhor = -Infinity;
      for (const [n, v] of adm.somaExec) if (v > melhor) { melhor = v; nome = n; }
      const id = nomeMedId.get(String(nome || '').toUpperCase().trim());
      return (id != null && valoresMed.has(id)) ? valoresMed.get(id) : null;
    };

    // Busca produção TOTAL de cada admissão (todas as linhas, qualquer
    // categoria) — a soma reflete o que o hospital faturou na admissão.
    const totaisPorAdm = new Map();   // key = competencia|cod → total
    if (admMap.size > 0) {
      const codsArray = Array.from(new Set(Array.from(admMap.values()).map(a => a.cod)));
      const ph = codsArray.map(() => '?').join(',');
      Banco.query(
        `SELECT cod_admissao, competencia, SUM(COALESCE(valor, 0)) AS total
         FROM linhas_producao
         WHERE cod_admissao IN (${ph})
         GROUP BY cod_admissao, competencia`,
        codsArray
      ).forEach(r => {
        totaisPorAdm.set(`${r.competencia}|${String(r.cod_admissao)}`, Number(r.total) || 0);
      });
    }

    const k = { admissoes: admMap.size, producao: 0, repasse: 0 };
    for (const [key, adm] of admMap) {
      k.producao += totaisPorAdm.get(key) || 0;
      const qtd = marcacoes.get(`${adm.competencia}|${adm.cod}`) || 0;
      if (qtd > 0) {
        const vFixo = valorFixoDaAdm(adm);   // V914
        const eSUS = adm.tipo_receb === 'SUS';
        k.repasse += vFixo != null ? vFixo : valorPorLinha(eSUS, qtd, cfg);
      }
    }
    return k;
  }

  function pct(parte, total) {
    if (!total) return '0';
    return Utilidades.formatarNumero((parte / total) * 100, 1);
  }

  // ==========================================================================
  // TABELA (médicos com drilldown)
  // ==========================================================================

  function renderTabela(porMedico, cfg, competencia) {
    if (!competencia) return '';
    if (porMedico.length === 0) {
      return `
        <div class="card" style="padding: 24px; text-align: center; color: var(--ink-faint)">
          Nenhuma cirurgia de estrabismo no período.
        </div>
      `;
    }

    // V957: a linha "Total / mês" do rodapé saiu — os cards do topo já totalizam
    // Colunas visíveis
    const cols = (window.__estr.configColunas || COLUNAS_PADRAO).filter(c => c.visivel);

    // Renderiza thead dinamicamente
    const ths = [`<th style="width: 36px"></th>`].concat(
      cols.map(c => {
        const num = (c.id !== 'medico') ? 'class="num"' : '';
        return `<th ${num}>${escapeHTML(c.label)}</th>`;
      })
    ).join('');

    return `
      <div class="estr-secao-label" style="margin-top: 22px">
        Detalhamento por médico <span style="font-weight: 500; text-transform: none; color: var(--ink-faint); margin-left: 6px">· ${porMedico.length} médico${porMedico.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="card" style="padding: 0; overflow: hidden">
        <table class="data-table estr-tabela">
          <thead><tr>${ths}</tr></thead>
          <tbody>
            ${porMedico.map(m => renderLinhaMedico(m, cols)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderLinhaMedico(m, cols) {
    const expandido = window.__estr.linhasExpandidas.has(m.id);
    const seta = expandido ? '▾' : '▸';

    // Totalizador de marcações: X/Y, verde quando completo
    const completo = m.qtdMarcadas === m.qtdAdmissoes && m.qtdAdmissoes > 0;
    const classeMarcadas = completo ? 'estr-marcadas-completo' : 'estr-marcadas';
    const checkIcon = completo ? '<span class="estr-check-completo">✓</span> ' : '';

    // Monta TDs conforme colunas visíveis
    const tds = [`<td class="estr-toggle" data-id="${m.id}">${seta}</td>`];
    for (const c of cols) {
      if (c.id === 'medico') {
        tds.push(`<td>
          <div class="estr-medico-nome">${escapeHTML(CodigoMedico.exibir(m.nome))}</div>
          ${Utilidades.badgeTipoVinculo(m.tipo_vinculo) || ''}
          ${m.bloqueadoExc ? `<span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:9px;font-size:9.5px;font-weight:700;background:rgba(192,57,43,0.10);color:#C0392B;border:1px solid rgba(192,57,43,0.45);" title="Bloqueado no fichário de Exceções (Calcular → ⚙ Ajustes → Exceções) — a exceção é quem paga">🚫 bloqueado por exceção</span>` : ''}
          ${(!m.bloqueadoExc && m.valorFixoMed != null) ? `<span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:9px;font-size:9.5px;font-weight:700;background:#FBF0DA;color:#8A5A1F;border:1px solid #E4C98E;" title="V914: regra deste médico no ⚙ Ajustes — cada admissão marcada paga este valor fixo, ignorando qtd 1/2 e convênio/SUS">★ valor fixo R$ ${Utilidades.formatarNumero(m.valorFixoMed, 2)}</span>` : ''}
        </td>`);
      } else if (c.id === 'admissoes') {
        tds.push(`<td class="num mono">${m.qtdAdmissoes}</td>`);
      } else if (c.id === 'produzido') {
        tds.push(`<td class="num mono">R$ ${Utilidades.formatarNumero(m.produzido || 0, 2)}</td>`);
      } else if (c.id === 'marcadas') {
        tds.push(`<td class="num mono">
          <span class="${classeMarcadas}">${checkIcon}${m.qtdMarcadas}/${m.qtdAdmissoes}</span>
        </td>`);
      } else if (c.id === 'repasse') {
        // V962: valor de repasse em #107DAC (.atlas-rep); bloqueado por exceção segue vermelho
        tds.push(`<td class="num mono${m.bloqueadoExc ? '' : ' atlas-rep'}" style="font-weight: 700${m.bloqueadoExc ? '; color: #C0392B' : ''}">${m.bloqueadoExc ? 'R$ 0,00' : 'R$ ' + Utilidades.formatarNumero(m.repasse, 2)}</td>`);
      }
    }

    let html = `
      <tr class="estr-linha-medico ${expandido ? 'estr-linha-exp' : ''}" data-id="${m.id}">
        ${tds.join('')}
      </tr>
    `;
    if (expandido) {
      html += renderDrilldown(m, cols.length + 1);
    }
    return html;
  }

  function renderDrilldown(m, colspanGeral) {
    const span = colspanGeral || 6;
    return `
      <tr class="estr-linha-drilldown">
        <td colspan="${span}" style="padding: 0; background: #FFFFFF"><!-- V957: era o creme #FBF8F0 -->
          <div style="padding: 12px 14px 14px 60px">
            <div class="estr-dd-header">
              <span style="text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; font-weight: 700; color: var(--ink-soft)">
                Admissões (${m.admList.length})
              </span>
            </div>
            <div class="estr-dd-moldura"><!-- V958: contorno #D3E0E9 em volta da tabela de admissões -->
            <table class="estr-dd-tabela">
              <thead>
                <tr>
                  <th>Cód. Admissão</th>
                  <th>Data</th>
                  <th>Paciente</th>
                  <th>Procedimento</th>
                  <th>Tipo</th>
                  <th style="text-align: center">Qtd</th>
                  <th class="num">Repasse</th>
                </tr>
              </thead>
              <tbody>
                ${m.admList.map(renderLinhaAdmissao).join('')}
              </tbody>
            </table>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  function renderLinhaAdmissao(adm) {
    let tipoBadge;
    tipoBadge = Utilidades.badgeFonte(adm.tipo_receb || 'CONVENIO');   // V946: tag padrão da ferramenta

    const repasseTexto = adm.qtdMarcada
      ? `R$ ${Utilidades.formatarNumero(adm.repasse, 2)}`
      : '<span class="estr-sem-marc">—</span>';

    const ehRepetida = !!adm.repeticao;
    const classeRow = ehRepetida ? 'estr-row-repetida' : '';

    let html = `
      <tr class="${classeRow}">
        <td class="mono">${escapeHTML(adm.cod_admissao)}</td>
        <td class="mono" style="white-space: nowrap; color: var(--ink-soft)">${Utilidades.formatarDataBR(adm.data_admissao)}</td>
        <td>${escapeHTML(adm.paciente || '—')}</td>
        <td title="${escapeAttr(adm.produtos.join(' | '))}">${escapeHTML(adm.produtosResumo)}</td>
        <td>${tipoBadge}</td>
        <td style="text-align: center">
          <div class="estr-qtd-radio" data-cod="${escapeAttr(adm.cod_admissao)}">
            <button class="estr-qtd-btn ${adm.qtdMarcada === 0 ? 'estr-qtd-active' : ''}" data-qtd="0" title="Não marcar">—</button>
            <button class="estr-qtd-btn ${adm.qtdMarcada === 1 ? 'estr-qtd-active' : ''}" data-qtd="1">1</button>
            <button class="estr-qtd-btn ${adm.qtdMarcada === 2 ? 'estr-qtd-active' : ''}" data-qtd="2">2</button>
          </div>
        </td>
        <td class="num mono${adm.qtdMarcada ? ' atlas-rep' : ''}" style="font-weight: 700${adm.qtdMarcada ? '' : '; color: var(--ink-faint)'}">${repasseTexto}</td><!-- V962 -->
      </tr>
    `;

    if (ehRepetida) {
      const tipo = adm.repeticao.tipo;
      const compPrev = formatarComp(adm.repeticao.competenciaPrevia);
      const motivo = tipo === 'admissao'
        ? `Esta admissão (${escapeHTML(adm.cod_admissao)}) já aparece em <strong>${compPrev}</strong>`
        : `Este paciente (${escapeHTML(adm.paciente || '—')}) já teve cirurgia de estrabismo em <strong>${compPrev}</strong> (admissão ${escapeHTML(adm.repeticao.codAdmissaoAnt || '—')})`;
      html += `
        <tr class="estr-row-aviso-repetida">
          <td colspan="7">
            <div class="estr-aviso-repetida">
              <span class="estr-aviso-icone">⚠</span>
              <strong>Admissão já paga:</strong> ${motivo}.
              <span class="estr-aviso-sub">Verificar antes de marcar.</span>
            </div>
          </td>
        </tr>
      `;
    }

    return html;
  }

  /**
   * Card de detalhe da admissão filtrada (semelhante ao LC, mas categorizado).
   * Aparece quando há um filtro de Cód. Admissão ativo. Lista TODAS as linhas
   * da admissão, agrupadas em 3 blocos colapsáveis:
   *   - PROCEDIMENTO (Tipo Produto = CIRURGICO (OFTALMO))
   *   - MAT/MED      (MATERIAL DESCARTAVEL, MEDICAMENTO, FIO CIRURGICO, GAS, REST. HOSP.)
   *   - OPME         (PROTESE OU ORTESE, SERVICO DE LIO)
   * Linhas de TAXA / PACOTES / outras ficam fora.
   */
  function renderDetalheAdmissao(competencia, filtros) {
    // V922: o filtro pode ser MULTI — o cartão de detalhe só abre com UMA marcada
    const selAdm = Utilidades.filtroMulti.sel(filtros?.codAdmissao);
    if (!selAdm.length || !competencia) return '';
    if (selAdm.length > 1) {
      return `
        <div class="estr-detalhe-adm estr-detalhe-multi">
          <span style="font-size: 16px">⚠</span>
          <span><strong>${selAdm.length}</strong> admissões marcadas no filtro. Deixe só uma pra ver o detalhe da admissão.</span>
        </div>
      `;
    }
    const fAdm = String(selAdm[0]).trim();

    // Quais admissões batem? Restringe ao set de estrabismo (cirúrgicas).
    const matches = Banco.query(
      `SELECT DISTINCT cod_admissao FROM linhas_producao
       WHERE UPPER(COALESCE(produto, '')) LIKE '%ESTRABISMO%'
         AND UPPER(COALESCE(produto, '')) NOT LIKE '%TAXA%'
         AND UPPER(COALESCE(produto, '')) NOT LIKE '%PACOTE%'
         AND competencia = ? AND UPPER(cod_admissao) LIKE ?
       LIMIT 5`,
      [competencia, '%' + fAdm.toUpperCase() + '%']
    );

    if (matches.length === 0) return '';
    if (matches.length > 1) {
      return `
        <div class="estr-detalhe-adm estr-detalhe-multi">
          <span style="font-size: 16px">⚠</span>
          <span><strong>${matches.length}</strong> admissões correspondem ao filtro "<strong>${escapeHTML(fAdm)}</strong>". Refine para ver detalhes.</span>
        </div>
      `;
    }

    const cod = matches[0].cod_admissao;
    const cabec = Banco.queryUnica(
      `SELECT data_admissao, paciente FROM linhas_producao
       WHERE cod_admissao = ? LIMIT 1`, [cod]
    );

    // TODAS as linhas da admissão
    const todasLinhas = Banco.query(
      `SELECT COALESCE(tipo_produto, '') AS tipo_produto,
              COALESCE(produto, '')      AS produto,
              COALESCE(valor, 0)         AS valor
       FROM linhas_producao
       WHERE cod_admissao = ?
       ORDER BY valor DESC`, [cod]
    );

    // Categoriza
    const blocos = {
      PROCEDIMENTO: { titulo: 'Procedimento', linhas: [], total: 0, icone: '🩺' },
      MATMED:       { titulo: 'MAT/MED',      linhas: [], total: 0, icone: '💊' },
      OPME:         { titulo: 'OPME',         linhas: [], total: 0, icone: '🔧' },
    };
    for (const l of todasLinhas) {
      const tp = (l.tipo_produto || '').toUpperCase().trim();
      let chave = null;
      if (tp === 'CIRURGICO (OFTALMO)') chave = 'PROCEDIMENTO';
      else if (['MATERIAL DESCARTAVEL', 'MEDICAMENTO', 'FIO CIRURGICO', 'GAS', 'REST. HOSP.'].includes(tp)) chave = 'MATMED';
      else if (['PROTESE OU ORTESE', 'SERVICO DE LIO'].includes(tp)) chave = 'OPME';
      if (!chave) continue;  // taxas/pacotes/outros ficam de fora

      // Agrega itens com mesmo nome (mostra "x N" se duplicar)
      const linha = { ...l, qtd: 1 };
      const existente = blocos[chave].linhas.find(x => x.produto === linha.produto);
      if (existente) {
        existente.qtd++;
        existente.valor = (Number(existente.valor) || 0) + (Number(linha.valor) || 0);
      } else {
        blocos[chave].linhas.push(linha);
      }
      blocos[chave].total += Number(l.valor) || 0;
    }

    const totalAdmissao = blocos.PROCEDIMENTO.total + blocos.MATMED.total + blocos.OPME.total;
    const dataBR = cabec?.data_admissao ? formatarDataBR(cabec.data_admissao) : '—';
    const paciente = cabec?.paciente || '—';

    // Estado de expansão (persistente por admissão na sessão)
    if (!window.__estr.blocosExpandidos) window.__estr.blocosExpandidos = new Set();
    const expandidos = window.__estr.blocosExpandidos;

    function renderBloco(chave) {
      const b = blocos[chave];
      const qtdItens = b.linhas.length;
      if (qtdItens === 0) return '';
      const keyExp = `${cod}::${chave}`;
      const aberto = expandidos.has(keyExp);
      const sinal = aberto ? '−' : '+';
      return `
        <div class="estr-bloco-cat">
          <button class="estr-bloco-header" data-bloco="${escapeAttr(keyExp)}">
            <span class="estr-bloco-sinal mono">${sinal}</span>
            <span class="estr-bloco-icone">${b.icone}</span>
            <span class="estr-bloco-titulo">${b.titulo}</span>
            <span class="estr-bloco-resumo">
              <span class="estr-bloco-count">${qtdItens} ${qtdItens === 1 ? 'item' : 'itens'}</span>
              <span class="estr-bloco-total mono">R$ ${Utilidades.formatarNumero(b.total, 2)}</span>
            </span>
          </button>
          ${aberto ? `
            <ul class="estr-bloco-linhas">
              ${b.linhas.map(l => {
                const v = Number(l.valor) || 0;
                const zero = v === 0 ? 'estr-bloco-zero' : '';
                const sufQtd = l.qtd > 1 ? ` <span class="estr-bloco-qtd">×${l.qtd}</span>` : '';
                return `
                  <li>
                    <span class="estr-bloco-nome">${escapeHTML(l.produto)}${sufQtd}</span>
                    <span class="estr-bloco-traco">—</span>
                    <span class="estr-bloco-valor mono ${zero}">R$ ${Utilidades.formatarNumero(v, 2)}</span>
                  </li>
                `;
              }).join('')}
            </ul>
          ` : ''}
        </div>
      `;
    }

    return `
      <div class="estr-detalhe-adm">
        <div class="estr-detalhe-header">
          <span style="font-size: 16px">📋</span>
          <span class="estr-detalhe-titulo">Detalhes da admissão filtrada</span>
        </div>
        <div class="estr-detalhe-resumo">
          <div class="estr-detalhe-campo">
            <div class="estr-detalhe-label">Cód. Admissão</div>
            <div class="estr-detalhe-valor mono">${escapeHTML(String(cod))}</div>
          </div>
          <div class="estr-detalhe-campo">
            <div class="estr-detalhe-label">Paciente</div>
            <div class="estr-detalhe-valor">${escapeHTML(paciente)}</div>
          </div>
          <div class="estr-detalhe-campo">
            <div class="estr-detalhe-label">Data</div>
            <div class="estr-detalhe-valor mono">${dataBR}</div>
          </div>
        </div>

        <div class="estr-blocos-cat">
          ${renderBloco('PROCEDIMENTO')}
          ${renderBloco('MATMED')}
          ${renderBloco('OPME')}
        </div>

        <div class="estr-detalhe-total">
          <span>Total da admissão</span>
          <span class="mono">R$ ${Utilidades.formatarNumero(totalAdmissao, 2)}</span>
        </div>
      </div>
    `;
  }

  function formatarDataBR(d) {
    if (!d) return '—';
    const s = String(d).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return s;
  }

  // ==========================================================================
  // CÁLCULOS / DADOS
  // ==========================================================================

  function listarPeriodosEstrab() {
    return Banco.query(`
      SELECT DISTINCT competencia FROM linhas_producao
      WHERE UPPER(COALESCE(produto, '')) LIKE '%ESTRABISMO%'
        AND UPPER(COALESCE(produto, '')) NOT LIKE '%TAXA%'
        AND UPPER(COALESCE(produto, '')) NOT LIKE '%PACOTE%'
      ORDER BY competencia DESC
    `).map(r => r.competencia);
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
    // Retorna lista de competências do mesmo ano até o mês informado (inclusive)
    const [ano, mes] = comp.split('-').map(Number);
    const lista = [];
    for (let i = 1; i <= mes; i++) lista.push(`${ano}-${String(i).padStart(2, '0')}`);
    return lista;
  }

  /**
   * Para cada admissão (cod_admissao) ou paciente (cod_paciente) do mês atual,
   * descobre se esse mesmo código já apareceu em estrabismo em mês anterior.
   * Retorna um Map: cod_admissao → { tipo, competenciaPrevia, paciente }
   *   - tipo: 'admissao' (mesmo cod_admissao em outro mês — improvável mas possível)
   *           'paciente' (cod_paciente do mesmo paciente em outro mês)
   */
  function detectarRepeticoes(linhasMesAtual, competenciaAtual) {
    const resultado = new Map();
    if (!competenciaAtual || linhasMesAtual.length === 0) return resultado;

    // Coleta cod_admissao e cod_paciente distintos do mês atual
    const codsAdm = new Set();
    const codsPac = new Set();
    const admToPac = new Map();      // cod_adm → cod_pac do mês atual
    for (const l of linhasMesAtual) {
      if (l.cod_admissao) codsAdm.add(String(l.cod_admissao));
      if (l.cod_paciente) codsPac.add(String(l.cod_paciente));
      if (l.cod_admissao && l.cod_paciente) {
        admToPac.set(String(l.cod_admissao), String(l.cod_paciente));
      }
    }

    if (codsAdm.size === 0 && codsPac.size === 0) return resultado;

    // Busca no banco TODAS as admissões anteriores de estrabismo (cirurgia)
    // que tenham:
    //   - cod_admissao em codsAdm  OU
    //   - cod_paciente em codsPac
    // Restringe ao filtro de estrabismo cirúrgico (mesma regra).
    const phAdm = Array.from(codsAdm).map(() => '?').join(',');
    const phPac = Array.from(codsPac).map(() => '?').join(',');
    const condicoes = [];
    const params = [];
    if (codsAdm.size > 0) { condicoes.push(`cod_admissao IN (${phAdm})`); params.push(...codsAdm); }
    if (codsPac.size > 0) { condicoes.push(`cod_paciente IN (${phPac})`); params.push(...codsPac); }
    if (condicoes.length === 0) return resultado;

    const previas = Banco.query(`
      SELECT cod_admissao, cod_paciente, paciente, competencia
      FROM linhas_producao
      WHERE UPPER(COALESCE(produto, '')) LIKE '%ESTRABISMO%'
        AND UPPER(COALESCE(produto, '')) NOT LIKE '%TAXA%'
        AND UPPER(COALESCE(produto, '')) NOT LIKE '%PACOTE%'
        AND competencia < ?
        AND (${condicoes.join(' OR ')})
      ORDER BY competencia DESC
    `, [competenciaAtual, ...params]);

    // Indexa para resposta rápida
    const porCodAdm = new Map();   // cod_adm → competencia anterior mais recente
    const porCodPac = new Map();   // cod_pac → { competencia, paciente, cod_admissao_anterior }
    for (const p of previas) {
      const cAdm = String(p.cod_admissao || '');
      const cPac = String(p.cod_paciente || '');
      if (cAdm && codsAdm.has(cAdm) && !porCodAdm.has(cAdm)) {
        porCodAdm.set(cAdm, { competencia: p.competencia, codAdmissaoAnt: cAdm });
      }
      if (cPac && codsPac.has(cPac) && !porCodPac.has(cPac)) {
        porCodPac.set(cPac, { competencia: p.competencia, paciente: p.paciente, codAdmissaoAnt: cAdm });
      }
    }

    // Constrói o resultado por cod_admissao do mês atual
    for (const codAdm of codsAdm) {
      const porAdm = porCodAdm.get(codAdm);
      const cPac = admToPac.get(codAdm);
      const porPac = cPac ? porCodPac.get(cPac) : null;

      // Prioriza match por código de admissão (mais grave)
      if (porAdm) {
        resultado.set(codAdm, {
          tipo: 'admissao',
          competenciaPrevia: porAdm.competencia,
          codAdmissaoAnt: porAdm.codAdmissaoAnt,
        });
      } else if (porPac && porPac.codAdmissaoAnt !== codAdm) {
        // mesmo paciente em outro mês com cod_admissao diferente
        resultado.set(codAdm, {
          tipo: 'paciente',
          competenciaPrevia: porPac.competencia,
          codAdmissaoAnt: porPac.codAdmissaoAnt,
        });
      }
    }

    return resultado;
  }

  function carregarLinhasEstrabismo(competencias, filtros) {
    // Aceita string única OU array de competências (para YTD/multi-mês)
    const compList = Array.isArray(competencias) ? competencias : [competencias];
    if (compList.length === 0) return [];

    const where = [
      `UPPER(COALESCE(produto, '')) LIKE '%ESTRABISMO%'`,
      `UPPER(COALESCE(produto, '')) NOT LIKE '%TAXA%'`,
      `UPPER(COALESCE(produto, '')) NOT LIKE '%PACOTE%'`,
      `competencia IN (${compList.map(() => '?').join(',')})`,
    ];
    const params = [...compList];

    if (filtros) {
      // V922: filtros MULTI — string (legado) ou array (união de LIKEs)
      const FM = Utilidades.filtroMulti;
      for (const [f, col] of [[filtros.codAdmissao, 'cod_admissao'],
                              [filtros.codPaciente, 'cod_paciente'],
                              [filtros.nomePaciente, 'paciente']]) {
        const cond = FM.sqlLike(f, col, params);
        if (cond) where.push(cond);
      }
    }

    return Banco.query(`
      SELECT cod_admissao,
             COALESCE(paciente, '')      AS paciente,
             COALESCE(cod_paciente, '')  AS cod_paciente,
             COALESCE(data_admissao, '') AS data_admissao,
             COALESCE(produto, '')        AS produto,
             UPPER(TRIM(COALESCE(medico, '')))    AS exec_medico,
             UPPER(TRIM(COALESCE(cirurgiao, ''))) AS exec_cirurgiao,
             UPPER(COALESCE(tipo_recebimento, '')) AS tipo_receb,
             COALESCE(valor, 0) AS valor_producao,
             competencia
      FROM linhas_producao
      WHERE ${where.join(' AND ')}
      ORDER BY cod_admissao, produto
    `, params);
  }

  /**
   * Garante que a tabela `marcacoes_estrabismo` está no formato atual
   * (chave única (cod_admissao, competencia), SEM coluna produto).
   *
   * Em bancos criados na versão anterior (com 'produto' na chave), faz a
   * migração: copia dados para nova tabela com chave correta, descarta a
   * antiga. Idempotente: pode rodar várias vezes sem efeito colateral.
   */
  function garantirTabelaMarcacoes() {
    // V492: DDL (CREATE TABLE/PRAGMA/migração) roda UMA vez por sessão — antes
    // rodava a cada carregarMarcacoes (~15× por render via YTD). Idempotente,
    // então a flag só evita retrabalho; em caso de erro, tenta de novo na próxima.
    if (window.__estrTabelaMarcacoesOk) return;
    try {
      // 1. Cria como deveria ser (se não existir, fica certo de cara)
      Banco.executar(`
        CREATE TABLE IF NOT EXISTS marcacoes_estrabismo (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cod_admissao TEXT NOT NULL,
          competencia TEXT NOT NULL,
          quantidade INTEGER NOT NULL DEFAULT 1,
          atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (cod_admissao, competencia)
        )
      `);

      // 2. Verifica se a tabela tem a coluna 'produto' (versão antiga)
      const colunas = Banco.query(`PRAGMA table_info(marcacoes_estrabismo)`);
      const temProduto = colunas.some(c => c.name === 'produto');
      if (!temProduto) { window.__estrTabelaMarcacoesOk = true; return; }  // já está no formato novo (V492: marca flag)

      // 3. Migra: cria nova, copia dados consolidados (dedupe por adm), troca
      console.log('Migrando tabela marcacoes_estrabismo para novo schema...');
      Banco.executar(`
        CREATE TABLE marcacoes_estrabismo_novo (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cod_admissao TEXT NOT NULL,
          competencia TEXT NOT NULL,
          quantidade INTEGER NOT NULL DEFAULT 1,
          atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (cod_admissao, competencia)
        )
      `);
      // Para cada (cod_admissao, competencia), mantém a MAIOR quantidade marcada
      Banco.executar(`
        INSERT INTO marcacoes_estrabismo_novo (cod_admissao, competencia, quantidade)
        SELECT cod_admissao, competencia, MAX(quantidade)
        FROM marcacoes_estrabismo
        GROUP BY cod_admissao, competencia
      `);
      Banco.executar(`DROP TABLE marcacoes_estrabismo`);
      Banco.executar(`ALTER TABLE marcacoes_estrabismo_novo RENAME TO marcacoes_estrabismo`);
      Banco.executar(`CREATE INDEX IF NOT EXISTS idx_marc_estrab_adm  ON marcacoes_estrabismo(cod_admissao)`);
      Banco.executar(`CREATE INDEX IF NOT EXISTS idx_marc_estrab_comp ON marcacoes_estrabismo(competencia)`);
      window.__estrTabelaMarcacoesOk = true;  // V492
    } catch (e) {
      console.warn('Erro ao garantir tabela marcacoes_estrabismo:', e.message);
    }
  }

  function carregarMarcacoes(competencia) {
    const map = new Map();
    try {
      garantirTabelaMarcacoes();
      Banco.query(
        `SELECT cod_admissao, quantidade FROM marcacoes_estrabismo WHERE competencia = ?`,
        [competencia]
      ).forEach(r => {
        map.set(String(r.cod_admissao), Number(r.quantidade) || 0);
      });
    } catch (e) {
      console.warn('Tabela marcacoes_estrabismo indisponível:', e.message);
    }
    return map;
  }

  function carregarConfig() {
    const cfg = {};
    try {
      Banco.query('SELECT chave, valor FROM config_estrabismo').forEach(r => {
        cfg[r.chave] = Number(r.valor);
      });
    } catch (e) {
      // tabela ainda não existe — usa defaults
    }
    return {
      qtd1Conv: cfg['VALOR_QTD1_CONVENIO'] ?? 1260,
      qtd2Conv: cfg['VALOR_QTD2_CONVENIO'] ?? 1680,
      qtd1Sus:  cfg['VALOR_QTD1_SUS']      ?? 300,
      qtd2Sus:  cfg['VALOR_QTD2_SUS']      ?? 300,
    };
  }

  /**
   * V914: REGRA POR MÉDICO — valor fixo por cirurgia marcada.
   * Quando o médico tem regra, CADA admissão marcada dele paga o valor fixo
   * estabelecido, ignorando qtd 1/2 e convênio/SUS. Persistente no banco.
   */
  function garantirTabelaValorMedico() {
    try {
      Banco.executar(`CREATE TABLE IF NOT EXISTS estrabismo_valor_medico (
        medico_id INTEGER PRIMARY KEY,
        valor_fixo REAL NOT NULL,
        atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
      )`);
    } catch (e) { console.warn('estrabismo_valor_medico:', e.message); }
  }
  function carregarValoresMedico() {
    const map = new Map();   // medico_id → valor_fixo
    try {
      garantirTabelaValorMedico();
      (Banco.query(`SELECT medico_id, valor_fixo FROM estrabismo_valor_medico`) || [])
        .forEach(r => map.set(Number(r.medico_id), Number(r.valor_fixo) || 0));
    } catch (e) {}
    return map;
  }
  function salvarValorMedico(medicoId, valor) {
    try {
      garantirTabelaValorMedico();
      Banco.executar(`INSERT INTO estrabismo_valor_medico (medico_id, valor_fixo)
        VALUES (?, ?)
        ON CONFLICT(medico_id) DO UPDATE SET valor_fixo = excluded.valor_fixo, atualizado_em = CURRENT_TIMESTAMP`,
        [medicoId, valor]);
      Banco.salvar();
      Banco._versao = (Banco._versao || 0) + 1;
      return true;
    } catch (e) { console.error('salvarValorMedico:', e); return false; }
  }
  function removerValorMedico(medicoId) {
    try {
      Banco.executar(`DELETE FROM estrabismo_valor_medico WHERE medico_id = ?`, [medicoId]);
      Banco.salvar();
      Banco._versao = (Banco._versao || 0) + 1;
      return true;
    } catch (e) { console.error('removerValorMedico:', e); return false; }
  }

  function valorPorLinha(eSUS, qtd, cfg) {
    if (!qtd) return 0;
    if (eSUS) return qtd === 1 ? cfg.qtd1Sus : cfg.qtd2Sus;
    return qtd === 1 ? cfg.qtd1Conv : cfg.qtd2Conv;
  }

  /**
   * Calcula os KPIs dos cards a partir dos médicos JÁ FILTRADOS por vínculo.
   * Cada admissão aparece exatamente uma vez (no médico principal).
   *
   * Garante coerência: o que está nos cards = o que está no rodapé da tabela.
   * Respeita TODOS os filtros (período, texto, vínculo) porque já vem agrupado.
   */
  function kpisDePorMedico(porMedico, linhasOriginais) {
    const k = {
      totalLinhas: linhasOriginais ? linhasOriginais.length : 0,
      admissoes: 0,
      admConvenio: 0,
      admSus: 0,
      admParticular: 0,
      marcadas: 0,
      qtd1: 0,
      qtd2: 0,
      producao: 0,   // soma de producao_total das admissões (todas as linhas)
      repasse: 0,
    };
    for (const m of porMedico) {
      for (const adm of m.admList) {
        k.admissoes++;
        const t = (adm.tipo_receb || '').toUpperCase();
        if (t === 'SUS')             k.admSus++;
        else if (t === 'PARTICULAR') k.admParticular++;
        else                         k.admConvenio++;
        k.producao += adm.producao_total || 0;
        if (adm.qtdMarcada > 0) {
          k.marcadas++;
          if (adm.qtdMarcada === 1) k.qtd1++;
          if (adm.qtdMarcada === 2) k.qtd2++;
          k.repasse += adm.repasse || 0;
        }
      }
    }
    return k;
  }

  function calcularKPIs(linhas, marcacoes, cfg) {
    // Constrói mapa de admissão (uma admissão pode ter várias linhas LC,
    // todas com mesmo tipo de recebimento). Aqui só usamos para contar tipo
    // e produção das LINHAS DE ESTRABISMO. A produção total da admissão
    // (todas as linhas de qualquer categoria) é buscada separadamente.
    const admMap = new Map();
    for (const l of linhas) {
      const cod = String(l.cod_admissao);
      if (!admMap.has(cod)) {
        admMap.set(cod, {
          cod,
          tipo_receb: l.tipo_receb,
          valor_estrab: 0,
        });
      }
      admMap.get(cod).valor_estrab += Number(l.valor_producao) || 0;
    }

    // Busca produção TOTAL de cada admissão (soma de TODAS as linhas,
    // qualquer Categoria/Tipo Produto: procedimento + MAT/MED + OPME + taxas + ...)
    const totaisPorAdm = new Map();  // cod_admissao → soma valor total
    if (admMap.size > 0) {
      const codsArray = Array.from(admMap.keys());
      const ph = codsArray.map(() => '?').join(',');
      Banco.query(
        `SELECT cod_admissao, SUM(COALESCE(valor, 0)) AS total
         FROM linhas_producao
         WHERE cod_admissao IN (${ph})
         GROUP BY cod_admissao`,
        codsArray
      ).forEach(r => totaisPorAdm.set(String(r.cod_admissao), Number(r.total) || 0));
    }

    const k = {
      totalLinhas: linhas.length,
      admissoes: admMap.size,
      admConvenio: 0,
      admSus: 0,
      admParticular: 0,
      marcadas: 0,
      qtd1: 0,
      qtd2: 0,
      producao: 0,   // R$ faturado pelo hospital — TOTAL DA ADMISSÃO (todas as linhas)
      repasse: 0,    // R$ repassado ao médico (regra aplicada às admissões marcadas)
    };

    for (const adm of admMap.values()) {
      const t = (adm.tipo_receb || '').toUpperCase();
      if (t === 'SUS') k.admSus++;
      else if (t === 'PARTICULAR') k.admParticular++;
      else k.admConvenio++;
      k.producao += totaisPorAdm.get(adm.cod) || adm.valor_estrab;

      const qtd = marcacoes.get(adm.cod) || 0;
      if (qtd > 0) {
        k.marcadas++;
        if (qtd === 1) k.qtd1++;
        if (qtd === 2) k.qtd2++;
        const eSUS = t === 'SUS';
        k.repasse += valorPorLinha(eSUS, qtd, cfg);
      }
    }
    return k;
  }

  // Agrupa linhas em:
  //   1. médico (cirurgião principal de cada admissão, identificado pela
  //      maior soma de valor de produção das linhas de estrabismo daquela
  //      admissão). Isso evita duplicação quando uma admissão tem 2+
  //      cirurgiões (ex: principal + auxiliar): apenas o principal recebe.
  //   2. admissão dentro do médico (consolida múltiplas linhas em 1)
  // Aplica filtro de tipos de vínculo (interno/híbrido/externo).
  // Anexa flag de repetição em outro mês (passada via mapa repeticoes).
  function agruparPorMedico(linhas, marcacoes, cfg, repeticoes) {
    repeticoes = repeticoes || new Map();
    const tiposPermitidos = window.__estr.filtroVinculos;

    // Carrega cadastro para mapear nomes
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
    } catch (e) { /* ignore */ }

    // ── Passo 1: para cada admissão, descobrir o cirurgião principal ─────
    // Critério: nome de cirurgião com MAIOR soma de valor_producao naquela
    // admissão (entre todas as linhas de estrabismo cirúrgico).
    // Empate → primeiro encontrado (estável pelo loop).
    const principalPorAdm = new Map();   // cod_admissao → nomeUpper executante
    {
      const somaPorAdmExec = new Map();  // cod → Map(execNome → valor)
      for (const l of linhas) {
        const cod = String(l.cod_admissao);
        const exec = l.exec_cirurgiao || l.exec_medico || '';
        if (!somaPorAdmExec.has(cod)) somaPorAdmExec.set(cod, new Map());
        const m = somaPorAdmExec.get(cod);
        m.set(exec, (m.get(exec) || 0) + (Number(l.valor_producao) || 0));
      }
      for (const [cod, mapExec] of somaPorAdmExec) {
        let melhorNome = '';
        let melhorValor = -Infinity;
        for (const [nome, valor] of mapExec) {
          if (valor > melhorValor) { melhorValor = valor; melhorNome = nome; }
        }
        principalPorAdm.set(cod, melhorNome);
      }
    }

    // ── Passo 2: agrupa as linhas no médico principal de cada admissão ──
    const grupos = new Map();
    function getGrupo(nomeUpper) {
      const med = cadMap.get(nomeUpper);
      const id = med ? `m${med.id}` : `_${nomeUpper}`;
      if (!grupos.has(id)) {
        grupos.set(id, {
          id,
          nome: med ? med.nome_oficial : (nomeUpper || '— Sem médico —'),
          tipo_vinculo: med ? med.tipo_vinculo : null,
          admissoes: new Map(),
        });
      }
      return grupos.get(id);
    }

    // Busca produção TOTAL de cada admissão (todas as linhas, qualquer
    // Categoria/Tipo Produto) para alimentar a coluna "Produzido" da tabela.
    const totaisPorAdm = new Map();
    if (linhas.length > 0) {
      const codsArray = Array.from(new Set(linhas.map(l => String(l.cod_admissao))));
      const ph = codsArray.map(() => '?').join(',');
      Banco.query(
        `SELECT cod_admissao, SUM(COALESCE(valor, 0)) AS total
         FROM linhas_producao
         WHERE cod_admissao IN (${ph})
         GROUP BY cod_admissao`,
        codsArray
      ).forEach(r => totaisPorAdm.set(String(r.cod_admissao), Number(r.total) || 0));
    }

    for (const l of linhas) {
      const cod = String(l.cod_admissao);
      const execPrincipal = principalPorAdm.get(cod) || (l.exec_cirurgiao || l.exec_medico || '');
      const grupo = getGrupo(execPrincipal);

      if (!grupo.admissoes.has(cod)) {
        const rep = repeticoes.get(cod);
        grupo.admissoes.set(cod, {
          cod_admissao: cod,
          paciente: l.paciente,
          cod_paciente: l.cod_paciente,
          data_admissao: l.data_admissao,
          tipo_receb: l.tipo_receb,
          produtos: [],
          valor_producao: 0,           // soma só linhas de estrabismo (para detalhe)
          producao_total: totaisPorAdm.get(cod) || 0,  // todas as linhas (admissão inteira)
          qtdMarcada: 0,
          repeticao: rep || null,
        });
      }
      const adm = grupo.admissoes.get(cod);
      adm.produtos.push(l.produto);
      adm.valor_producao += Number(l.valor_producao) || 0;
    }

    // ── Passo 3: aplica marcações e totaliza por médico ─────────────────
    // V658: médicos com o ESTRABISMO bloqueado no fichário de Exceções (Calcular)
    // aparecem ZERADOS aqui — a exceção (valor fixo via Produção) é quem paga.
    const bloqueadosExc = new Set();
    try {
      (Banco.query(`SELECT medico_id FROM excecao_desempenho_bloqueio WHERE ativo = 1 AND modulo = 'estrabismo'`) || [])
        .forEach(r => bloqueadosExc.add(r.medico_id));
    } catch (e) {}
    // V914: valor FIXO por médico — cada admissão marcada paga o valor da regra
    const valoresMed = carregarValoresMedico();
    const resultado = [];
    for (const grupo of grupos.values()) {
      const medIdGrupo = String(grupo.id || '').charAt(0) === 'm' ? parseInt(String(grupo.id).slice(1), 10) : null;
      const ehBloqueado = medIdGrupo != null && bloqueadosExc.has(medIdGrupo);
      const valorFixoMed = medIdGrupo != null && valoresMed.has(medIdGrupo) ? valoresMed.get(medIdGrupo) : null;
      let totalAdm = 0, totalMarcadas = 0, totalQtd = 0, totalRepasse = 0, totalProduzido = 0;
      const admList = [];
      for (const adm of grupo.admissoes.values()) {
        const qtd = marcacoes.get(adm.cod_admissao) || 0;
        const eSUS = adm.tipo_receb === 'SUS';
        const repasse = ehBloqueado ? 0
          : (valorFixoMed != null ? (qtd > 0 ? valorFixoMed : 0) : valorPorLinha(eSUS, qtd, cfg));
        adm.qtdMarcada = qtd;
        adm.repasse = repasse;
        adm.eSUS = eSUS;
        adm.produtosResumo = consolidarProdutos(adm.produtos);
        admList.push(adm);
        totalAdm++;
        totalProduzido += adm.producao_total || 0;
        if (qtd > 0) { totalMarcadas++; totalQtd += qtd; totalRepasse += repasse; }
      }
      admList.sort((a, b) => (b.valor_producao || 0) - (a.valor_producao || 0));
      resultado.push({
        ...grupo,
        admList,
        qtdAdmissoes: totalAdm,
        qtdMarcadas: totalMarcadas,
        qtdTotal: totalQtd,
        repasse: totalRepasse,
        produzido: totalProduzido,
        bloqueadoExc: ehBloqueado,   // V658
        valorFixoMed,                // V914: null = segue a tabela de valores
      });
    }

    const resultadoFiltrado = resultado.filter(m => {
      const tipo = m.tipo_vinculo || 'EXTERNO';
      return tiposPermitidos.has(tipo);
    });

    resultadoFiltrado.sort((a, b) => b.repasse - a.repasse || b.qtdAdmissoes - a.qtdAdmissoes);
    return resultadoFiltrado;
  }

  // Concatena nomes de produtos de uma admissão, removendo o prefixo
  // "ESTRABISMO -" repetido e deduplicando. Ex:
  //   ['ESTRABISMO - CICLO VERTICAL...', 'ESTRABISMO - HORIZONTAL...']
  //   → 'CICLO VERTICAL/TRANSPOSICAO + HORIZONTAL MONOCULAR'
  function consolidarProdutos(produtos) {
    const nomesUnicos = new Set();
    for (const p of produtos) {
      // Remove o prefixo "ESTRABISMO - " (e variações com espaços)
      const limpo = String(p).replace(/^ESTRABISMO\s*[-–]\s*/i, '').trim();
      if (limpo) nomesUnicos.add(limpo);
    }
    return Array.from(nomesUnicos).join(' + ');
  }

  // ==========================================================================
  // POPOVER DE AJUSTES (edita os 4 valores)
  // ==========================================================================

  function renderPopoverAjustes(cfg) {
    const tiposVinc = ['INTERNO', 'HIBRIDO', 'EXTERNO'];
    const labelVinc = { INTERNO: 'Interno', HIBRIDO: 'Híbrido', EXTERNO: 'Externo' };
    return `
      <div class="estr-overlay" data-popover="ajustes"></div>
      <div class="estr-popover">
        <div class="estr-popover-header">
          <h3>Ajustes — Estrabismo</h3>
          <button class="estr-popover-close" data-popover="ajustes">×</button>
        </div>

        <!-- Bloco 1: Valores -->
        <div class="estr-aj-bloco">
          <div class="estr-aj-titulo">Valores de repasse</div>
          <div class="estr-aj-grid">
            <div class="estr-aj-card">
              <div class="estr-aj-card-faixa" style="background: linear-gradient(180deg, #005073, #4A7F77)"></div>
              <div>
                <div class="estr-aj-card-label">Convênio · Qtd 1</div>
                <div class="estr-aj-card-valor">
                  R$ <span class="estr-aj-num mono" data-config="VALOR_QTD1_CONVENIO" data-valor="${cfg.qtd1Conv}">${Utilidades.formatarNumero(cfg.qtd1Conv, 2)}</span>
                </div>
              </div>
            </div>
            <div class="estr-aj-card">
              <div class="estr-aj-card-faixa" style="background: linear-gradient(180deg, #005073, #4A7F77)"></div>
              <div>
                <div class="estr-aj-card-label">Convênio · Qtd 2</div>
                <div class="estr-aj-card-valor">
                  R$ <span class="estr-aj-num mono" data-config="VALOR_QTD2_CONVENIO" data-valor="${cfg.qtd2Conv}">${Utilidades.formatarNumero(cfg.qtd2Conv, 2)}</span>
                </div>
              </div>
            </div>
            <div class="estr-aj-card">
              <div class="estr-aj-card-faixa" style="background: linear-gradient(180deg, #189AD3, #9FE6C9)"></div>
              <div>
                <div class="estr-aj-card-label">SUS · Qtd 1</div>
                <div class="estr-aj-card-valor">
                  R$ <span class="estr-aj-num mono" data-config="VALOR_QTD1_SUS" data-valor="${cfg.qtd1Sus}">${Utilidades.formatarNumero(cfg.qtd1Sus, 2)}</span>
                </div>
              </div>
            </div>
            <div class="estr-aj-card">
              <div class="estr-aj-card-faixa" style="background: linear-gradient(180deg, #189AD3, #9FE6C9)"></div>
              <div>
                <div class="estr-aj-card-label">SUS · Qtd 2</div>
                <div class="estr-aj-card-valor">
                  R$ <span class="estr-aj-num mono" data-config="VALOR_QTD2_SUS" data-valor="${cfg.qtd2Sus}">${Utilidades.formatarNumero(cfg.qtd2Sus, 2)}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="estr-aj-help">Clique nos valores para editar. Salvos automaticamente.</div>
        </div>

        <!-- V914: Bloco — Regra por médico (valor fixo por cirurgia) -->
        ${(() => {
          const valoresMed = carregarValoresMedico();
          let medicos = [];
          try { medicos = Banco.query(`SELECT id, nome_oficial FROM medicos WHERE ativo = 1 ORDER BY nome_oficial`) || []; } catch (e) {}
          const nomeDe = new Map(medicos.map(m => [m.id, m.nome_oficial]));
          const regras = [...valoresMed.entries()]
            .map(([id, v]) => ({ id, v, nome: nomeDe.get(id) || `(médico id ${id})` }))
            .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
          return `
        <div class="estr-aj-bloco">
          <div class="estr-aj-titulo">Regra por médico — valor fixo por cirurgia</div>
          <div class="estr-aj-help" style="margin-top:0;">
            O desempenho de Estrabismo do médico escolhido passa a pagar <strong>este valor fixo em cada
            admissão marcada</strong>, ignorando qtd 1/2 olhos e convênio/SUS. Os demais médicos seguem a
            tabela de valores acima. Vale também no Consolidado dos Relatórios.
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:8px 0;">
            <select id="estr-vm-medico" class="estr-ocultar-input" style="flex:1; min-width:220px;">
              <option value="">— escolha o médico —</option>
              ${medicos.map(m => `<option value="${m.id}">${escapeHTML(CodigoMedico.exibir(m.nome_oficial))}</option>`).join('')}
            </select>
            <span class="mono" style="font-size:12px;">R$</span>
            <input type="text" id="estr-vm-valor" class="estr-ocultar-input mono" placeholder="ex.: 1500,00" style="width:110px;" autocomplete="off">
            <button class="btn btn-pequeno" id="estr-vm-salvar">＋ salvar regra</button>
          </div>
          ${regras.length === 0
            ? `<div class="estr-aj-help">Nenhuma regra por médico — todos seguem a tabela.</div>`
            : `<div>
                ${regras.map(r => `
                  <div style="display:flex; align-items:center; gap:8px; padding:5px 8px; border:1px solid var(--border); border-radius:8px; margin-bottom:5px; background:#FBF0DA;">
                    <strong style="flex:1; font-size:12px;">${escapeHTML(CodigoMedico.exibir(r.nome))}</strong>
                    <span class="mono" style="font-weight:700; color:#8A5A1F;">R$ ${Utilidades.formatarNumero(r.v, 2)} / cirurgia marcada</span>
                    <button class="estr-popover-close" data-vm-remover="${r.id}" title="Remover a regra — o médico volta pra tabela de valores" style="font-size:14px;">×</button>
                  </div>`).join('')}
              </div>`}
        </div>`;
        })()}

        <!-- Bloco 2: Filtros de vínculo -->
        <div class="estr-aj-bloco">
          <div class="estr-aj-titulo">Filtrar médicos por tipo de vínculo</div>
          <div class="estr-vinc-grid">
            ${tiposVinc.map(t => `
              <label class="estr-vinc-chk">
                <input type="checkbox" data-vinc="${t}" ${window.__estr.filtroVinculos.has(t) ? 'checked' : ''}>
                ${Utilidades.badgeVinculo(t)}<!-- V960: tag padrão de vínculo -->
              </label>
            `).join('')}
          </div>
          <div class="estr-aj-help">Médicos sem cadastro são considerados Externos.</div>
        </div>
      </div>
    `;
  }

  // V960: vincStyle saiu — a tag de vínculo é a padrão (Utilidades.badgeVinculo)

  /**
   * Popover de "Mostrar/Ocultar" colunas:
   *   - Lista todas as colunas da tabela principal
   *   - Cada uma com checkbox (visível/oculta) + input (rótulo customizável)
   *   - Coluna 'fixa' (Médico) não pode ser oculta
   *   - Botão "Restaurar padrão" volta aos rótulos originais
   */
  function renderPopoverOcultar() {
    const cols = window.__estr.configColunas || COLUNAS_PADRAO;
    return `
      <div class="estr-overlay" data-popover="ocultar"></div>
      <div class="estr-popover">
        <div class="estr-popover-header">
          <h3>Mostrar/Ocultar colunas</h3>
          <button class="estr-popover-close" data-popover="ocultar">×</button>
        </div>
        <div class="estr-aj-bloco">
          <div class="estr-aj-titulo">Tabela principal</div>
          <div class="estr-ocultar-lista">
            ${cols.map(c => `
              <div class="estr-ocultar-linha ${c.fixa ? 'estr-ocultar-fixa' : ''}">
                <label class="estr-ocultar-chk" title="${c.fixa ? 'Coluna fixa — não pode ser oculta' : 'Marcar para mostrar'}">
                  <input type="checkbox"
                         data-col-id="${escapeAttr(c.id)}"
                         data-tipo="visivel"
                         ${c.visivel ? 'checked' : ''}
                         ${c.fixa ? 'disabled' : ''}>
                </label>
                <input type="text"
                       class="estr-ocultar-input"
                       data-col-id="${escapeAttr(c.id)}"
                       data-tipo="label"
                       value="${escapeAttr(c.label)}"
                       placeholder="Nome da coluna">
                ${c.fixa ? '<span class="estr-ocultar-fixa-tag">fixa</span>' : ''}
              </div>
            `).join('')}
          </div>
          <div class="estr-ocultar-acoes">
            <button class="btn btn-pequeno" id="btn-estr-ocultar-restaurar">↺ Restaurar padrão</button>
            <span class="estr-aj-help" style="margin: 0">Aplicado automaticamente.</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderPopoverRegras(cfg) {
    return `
      <div class="estr-overlay" data-popover="regras"></div>
      <div class="estr-popover estr-popover-regras">
        <div class="estr-popover-header">
          <h3>Regras de Repasse — Estrabismo</h3>
          <button class="estr-popover-close" data-popover="regras">×</button>
        </div>
        <div class="estr-regras-body">
          <div class="estr-regra-bloco">
            <div class="estr-regra-titulo"><span class="estr-regra-num">1</span> Origem dos dados</div>
            <ul class="estr-regra-lista">
              <li>Entram no fichário todas as linhas onde o campo <strong>Produto</strong> contém o termo "ESTRABISMO".</li>
              <li>O médico (cirurgião) é prioritariamente o do campo Cirurgião; se vazio, usa o campo Médico.</li>
            </ul>
          </div>
          <div class="estr-regra-bloco">
            <div class="estr-regra-titulo"><span class="estr-regra-num">2</span> Valores de repasse</div>
            <div class="estr-regras-formulas">
              <div class="estr-regra-formula">
                <div class="estr-regra-formula-label">Convênio · Qtd 1</div>
                <div class="estr-regra-formula-eq mono">R$ ${Utilidades.formatarNumero(cfg.qtd1Conv, 2)}</div>
              </div>
              <div class="estr-regra-formula">
                <div class="estr-regra-formula-label">Convênio · Qtd 2</div>
                <div class="estr-regra-formula-eq mono">R$ ${Utilidades.formatarNumero(cfg.qtd2Conv, 2)}</div>
              </div>
              <div class="estr-regra-formula">
                <div class="estr-regra-formula-label">SUS · Qtd 1 ou 2</div>
                <div class="estr-regra-formula-eq mono">R$ ${Utilidades.formatarNumero(cfg.qtd1Sus, 2)}</div>
              </div>
            </div>
            <div class="estr-regra-help">
              Os valores podem ser ajustados no painel <strong>⚙ Ajustes</strong>.
              Tipo SUS é identificado pelo campo <strong>Tipo Recebimento = SUS</strong> na linha.
            </div>
          </div>
          <div class="estr-regra-bloco">
            <div class="estr-regra-titulo"><span class="estr-regra-num">3</span> Marcação de quantidade</div>
            <ul class="estr-regra-lista">
              <li>Cada linha de produto contendo "ESTRABISMO" deve ser marcada individualmente: <strong>—</strong> (não conta), <strong>1</strong> (unilateral) ou <strong>2</strong> (bilateral).</li>
              <li>A marcação é salva automaticamente e persiste entre sessões.</li>
              <li>Linhas sem marcação não geram repasse (aparecem com "—" no valor).</li>
              <li><strong>Regra por médico (valor fixo)</strong>: no ⚙ Ajustes dá pra estabelecer que o desempenho de um médico específico paga um <strong>valor fixo por admissão marcada</strong>, ignorando qtd 1/2 e convênio/SUS — ele aparece com a etiqueta ★ na matriz.</li>
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
    // Header buttons
    const btnAj = document.getElementById('btn-estr-ajustes');
    if (btnAj) btnAj.addEventListener('click', () => {
      window.__estr.ajustesAberto = !window.__estr.ajustesAberto;
      window.__estr.regrasAberto = false;
      window.__estr.ocultarAberto = false;
      renderizar();
    });
    const btnInfo = document.getElementById('btn-estr-info');
    if (btnInfo) btnInfo.addEventListener('click', () => {
      window.__estr.regrasAberto = !window.__estr.regrasAberto;
      window.__estr.ajustesAberto = false;
      window.__estr.ocultarAberto = false;
      renderizar();
    });
    const btnOcultar = document.getElementById('btn-estr-mostrar-ocultar');
    if (btnOcultar) btnOcultar.addEventListener('click', () => {
      window.__estr.ocultarAberto = !window.__estr.ocultarAberto;
      window.__estr.ajustesAberto = false;
      window.__estr.regrasAberto = false;
      renderizar();
    });
    const btnExp = document.getElementById('btn-estr-exportar');
    if (btnExp) btnExp.addEventListener('click', () => mostrarMenuExportar(btnExp, cfg));

    // Fechar popovers (overlay e botão ×)
    document.querySelectorAll('[data-popover]').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-popover]') !== el) return;
        const p = el.dataset.popover;
        if (p === 'ajustes') window.__estr.ajustesAberto = false;
        if (p === 'regras')  window.__estr.regrasAberto  = false;
        if (p === 'ocultar') window.__estr.ocultarAberto = false;
        renderizar();
      });
    });

    // Mostrar/Ocultar — checkboxes (visibilidade) e inputs (renomear)
    document.querySelectorAll('input[data-col-id]').forEach(el => {
      const tipo = el.dataset.tipo;
      if (tipo === 'visivel') {
        el.addEventListener('change', () => {
          const id = el.dataset.colId;
          const cfgCols = window.__estr.configColunas;
          const col = cfgCols.find(c => c.id === id);
          if (col && !col.fixa) {
            col.visivel = el.checked;
            salvarConfigColunas(cfgCols);
            renderizar();
          }
        });
      } else if (tipo === 'label') {
        // Debounced: salva quando para de digitar (300ms)
        let timer = null;
        const aplicar = () => {
          const id = el.dataset.colId;
          const cfgCols = window.__estr.configColunas;
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
        el.addEventListener('blur', () => {
          if (timer) clearTimeout(timer);
          aplicar();
        });
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
          if (ev.key === 'Escape') { el.value = window.__estr.configColunas.find(c => c.id === el.dataset.colId).label; el.blur(); }
        });
      }
    });

    // Restaurar padrão
    const btnRest = document.getElementById('btn-estr-ocultar-restaurar');
    if (btnRest) btnRest.addEventListener('click', () => {
      window.__estr.configColunas = JSON.parse(JSON.stringify(COLUNAS_PADRAO));
      salvarConfigColunas(window.__estr.configColunas);
      renderizar();
    });

    // Filtros — fileira 20C (Ano/Mês/combos viraram células)
    bindBarraFiltrosEstr20C();

    const btnLimp = document.getElementById('btn-estr-limpar-filtros');
    if (btnLimp) btnLimp.addEventListener('click', () => {
      window.__estr.filtroCodAdmissao = '';
      window.__estr.filtroCodPaciente = '';
      window.__estr.filtroNomePaciente = '';
      renderizar();
    });

    // Toggle drilldown
    document.querySelectorAll('.estr-toggle').forEach(td => {
      td.addEventListener('click', () => {
        const id = td.dataset.id;
        if (window.__estr.linhasExpandidas.has(id)) window.__estr.linhasExpandidas.delete(id);
        else window.__estr.linhasExpandidas.add(id);
        renderizar();
      });
    });

    // Botões de quantidade (—, 1, 2) — salva no banco
    document.querySelectorAll('.estr-qtd-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const wrap = btn.closest('.estr-qtd-radio');
        const cod = wrap.dataset.cod;
        const qtd = Number(btn.dataset.qtd);
        const comp = `${window.__estr.anoSelecionado}-${window.__estr.mesSelecionado}`;
        await salvarMarcacao(cod, comp, qtd);
        renderizar();
      });
    });

    // Edição inline dos valores no painel de Ajustes
    document.querySelectorAll('.estr-aj-num').forEach(span => {
      span.addEventListener('click', () => abrirEdicaoValor(span));
    });

    // V914: regra por médico (valor fixo por cirurgia marcada)
    const btnVmSalvar = document.getElementById('estr-vm-salvar');
    if (btnVmSalvar) btnVmSalvar.addEventListener('click', () => {
      const medId = parseInt((document.getElementById('estr-vm-medico') || {}).value, 10);
      let raw = String((document.getElementById('estr-vm-valor') || {}).value || '').trim().replace(/[R$\s]/g, '');
      if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
      const valor = Number(raw);
      if (!medId) { Utilidades.toast?.('Escolha o médico da regra.', 'error', 2800); return; }
      if (!raw || isNaN(valor) || valor <= 0) { Utilidades.toast?.('Informe um valor fixo válido (ex.: 1500,00).', 'error', 2800); return; }
      if (salvarValorMedico(medId, valor)) {
        Utilidades.toast?.(`✓ Regra salva — cada admissão marcada deste médico paga R$ ${Utilidades.formatarNumero(valor, 2)}.`, 'success', 4500);
        renderizar();
      }
    });
    document.querySelectorAll('[data-vm-remover]').forEach(b => b.addEventListener('click', () => {
      const medId = parseInt(b.dataset.vmRemover, 10);
      if (!medId) return;
      if (!confirm('Remover a regra de valor fixo? O médico volta a seguir a tabela de valores.')) return;
      if (removerValorMedico(medId)) {
        Utilidades.toast?.('✓ Regra removida — o médico segue a tabela de valores.', 'success', 3500);
        renderizar();
      }
    }));

    // Checkboxes de filtro por tipo de vínculo
    document.querySelectorAll('input[data-vinc]').forEach(chk => {
      chk.addEventListener('change', () => {
        const t = chk.dataset.vinc;
        if (chk.checked) window.__estr.filtroVinculos.add(t);
        else window.__estr.filtroVinculos.delete(t);
        renderizar();
      });
    });

    // Botões de expansão dos blocos PROCEDIMENTO/MAT-MED/OPME no card de detalhe
    document.querySelectorAll('.estr-bloco-header').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!window.__estr.blocosExpandidos) window.__estr.blocosExpandidos = new Set();
        const k = btn.dataset.bloco;
        if (window.__estr.blocosExpandidos.has(k)) window.__estr.blocosExpandidos.delete(k);
        else window.__estr.blocosExpandidos.add(k);
        renderizar();
      });
    });
  }

  async function salvarMarcacao(cod, competencia, qtd) {
    try {
      garantirTabelaMarcacoes();
      if (qtd === 0) {
        Banco.executar(
          `DELETE FROM marcacoes_estrabismo WHERE cod_admissao = ? AND competencia = ?`,
          [cod, competencia]
        );
      } else {
        Banco.executar(
          `INSERT INTO marcacoes_estrabismo (cod_admissao, competencia, quantidade)
           VALUES (?, ?, ?)
           ON CONFLICT(cod_admissao, competencia) DO UPDATE SET
             quantidade = excluded.quantidade,
             atualizado_em = CURRENT_TIMESTAMP`,
          [cod, competencia, qtd]
        );
      }
      // V492: persistência coalescida — a marcação já está no banco em memória
      // (o re-render seguinte a enxerga); N cliques de quantidade = 1 export.
      Banco.salvarDebounced();
    } catch (e) {
      console.error('Erro ao salvar marcação:', e);
      Utilidades.toast('Erro: ' + e.message, 'error');
    }
  }

  function abrirEdicaoValor(span) {
    const chave = span.dataset.config;
    const atual = Number(span.dataset.valor) || 0;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'estr-aj-num-input mono';
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
        try {
          Banco.executar(`
            INSERT INTO config_estrabismo (chave, valor) VALUES (?, ?)
            ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = CURRENT_TIMESTAMP
          `, [chave, novo]);
          // V492: persistência coalescida — o valor já está no banco em memória;
          // nada após este ponto depende do flush no IndexedDB.
          Banco.salvarDebounced();
          Utilidades.toast('Valor atualizado', 'success', 1200);
        } catch (e) {
          console.error(e);
        }
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

  // ==========================================================================
  // EXPORTAÇÃO EXCEL
  // ==========================================================================

  // V716: menu no padrão da ferramenta (modelo LIO — Utilidades.abrirMenuExportar)
  function mostrarMenuExportar(btn, cfg) {
    Utilidades.abrirMenuExportar(btn, [
      { icone: '⊞', titulo: 'Relatório Completo', sub: 'Todas as linhas com marcações e cálculos',
        onClick: () => exportar('completo', cfg) },
      { icone: '⚕', titulo: 'Por Médico', sub: '1 aba por médico, todas as linhas',
        onClick: () => exportar('por-medico', cfg) },
    ]);
  }

  function exportar(modo, cfg) {
    try {
      const comp = `${window.__estr.anoSelecionado}-${window.__estr.mesSelecionado}`;
      const filtros = {
        codAdmissao:  window.__estr.filtroCodAdmissao,
        codPaciente:  window.__estr.filtroCodPaciente,
        nomePaciente: window.__estr.filtroNomePaciente,
      };
      const linhas = carregarLinhasEstrabismo(comp, filtros);
      const marcacoes = carregarMarcacoes(comp);
      const porMedico = agruparPorMedico(linhas, marcacoes, cfg);

      const wb = XLSX.utils.book_new();
      if (modo === 'completo') {
        const rows = [['Médico','Cód. Admissão','Paciente','Procedimento','Tipo','Qtd Marcada','Repasse']];
        for (const m of porMedico) {
          for (const adm of m.admList) {
            rows.push([
              m.nome,
              adm.cod_admissao,
              adm.paciente || '',
              adm.produtosResumo,
              adm.tipo_receb === 'SUS' ? 'SUS' : (adm.tipo_receb === 'PARTICULAR' ? 'Particular' : 'Convênio'),
              adm.qtdMarcada || '',
              adm.qtdMarcada ? adm.repasse : ''
            ]);
          }
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Estrabismo');
      } else {
        for (const m of porMedico) {
          const rows = [['Cód. Admissão','Paciente','Procedimento','Tipo','Qtd','Repasse']];
          for (const adm of m.admList) {
            rows.push([
              adm.cod_admissao,
              adm.paciente || '',
              adm.produtosResumo,
              adm.tipo_receb === 'SUS' ? 'SUS' : (adm.tipo_receb === 'PARTICULAR' ? 'Particular' : 'Convênio'),
              adm.qtdMarcada || '',
              adm.qtdMarcada ? adm.repasse : ''
            ]);
          }
          rows.push(['', '', '', 'TOTAL', m.qtdTotal, m.repasse]);
          const ws = XLSX.utils.aoa_to_sheet(rows);
          const aba = String(m.nome).replace(/[:\\\/\?\*\[\]]/g, '').substring(0, 31);
          XLSX.utils.book_append_sheet(wb, ws, aba);
        }
      }
      XLSX.writeFile(wb, `Estrabismo_${comp}.xlsx`);
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
        .estr-titulo-wrap { display: flex; align-items: center; gap: 10px; }
        .estr-btn-info {
          width: 28px; height: 28px; border-radius: 50%;
          background: var(--bg-elevated); border: 1px solid var(--border);
          color: #189AD3; font-size: 15px; font-weight: 700;
          cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
          transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        }
        .estr-btn-info:hover { background: #189AD3; color: white; transform: scale(1.08); }
        .estr-header-acoes { display: flex; gap: 8px; }

        /* Contêiner da peça 20C (.estr-sb) + botão "✕ Limpar filtros".
           Classe contém "filtro" de propósito: o leque #atlas-hub ignora
           botões dentro de [class*="filtro"]. */
        .estr-filtros-bar {
          display: flex; flex-direction: column; gap: 6px;
          align-items: stretch;   /* a peça 20C estica de ponta a ponta */
          width: 100%; box-sizing: border-box;
          margin: 10px 0 0;
          /* o fade-in-up global (.page-content > *) deixa um transform
             residual (fill-mode both) que vira stacking context em cada
             irmão — sem z-index aqui os cards pintariam POR CIMA do painel */
          position: relative; z-index: 30;
        }
        .estr-filtros-bar > .btn-pequeno { align-self: flex-start; }
        .estr-secao-label {
          font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--ink-soft);
        }

        /* ── Fileira de filtros 20C (padrão do LIO/OPME, prefixo estr-sb) ── */
        .estr-sb {
          margin-top: 0; margin-bottom: 14px;   /* respiro antes dos cards */
          position: relative; z-index: 30;
          display: flex; align-items: stretch;
          padding: 6px;
          background: #fff;
          border: 1px solid #e2ebf2;
          border-radius: 12px;
          box-shadow: 0 1px 2px rgba(20,50,80,.04), 0 10px 26px -20px rgba(20,50,80,.26);
          flex-wrap: wrap;
        }
        .estr-sb-celwrap { position: relative; min-width: 150px; display: flex; }
        .estr-sb-celwrap:not(:last-child) .estr-sb-cel { border-right: 1px solid #eef3f7; }
        .estr-sb-cel {
          flex: 1; min-width: 0;
          display: flex; align-items: center; gap: 9px;
          padding: 9px 12px; border: none; border-radius: 9px;
          background: transparent; cursor: pointer;
          font-family: inherit; text-align: left;
          transition: background-color 120ms;
        }
        .estr-sb-cel:hover, .estr-sb-cel.ativo, .estr-sb-cel.aberta { background: #f4fafd; }
        .estr-sb-cel:focus-visible { outline: 2px solid #2f8fc4; outline-offset: 2px; }
        .estr-sb-tile {
          width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: #f0f5f9; color: #5b6c7c;
        }
        .estr-sb-cel.ativo .estr-sb-tile, .estr-sb-cel.aberta .estr-sb-tile { background: #dbeef8; color: #1c6fa8; }
        .estr-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
        .estr-sb-rot {
          font-size: 10px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .09em; color: #5b6c7c; white-space: nowrap;
        }
        .estr-sb-val {
          font-size: 13px; font-weight: 500; color: #4f6274;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .estr-sb-cel.ativo .estr-sb-val { font-weight: 700; color: #14384f; }
        .estr-sb-chev { color: #7d8fa0; flex-shrink: 0; display: flex; transition: transform 140ms; }
        .estr-sb-cel.aberta .estr-sb-chev { transform: rotate(180deg); }

        /* painel ancorado na célula, por cima dos cards */
        .estr-sb-painel {
          position: absolute; top: 100%; left: 0; margin-top: 6px; z-index: 40;
          min-width: 100%; width: max-content; max-width: 340px;
          background: #fff; border: 1px solid #dfe8f0; border-radius: 12px;
          box-shadow: 0 18px 44px -14px rgba(15,37,68,.42);
          overflow: hidden;
        }
        .estr-sb-buscabox {
          display: flex; align-items: center; gap: 8px;
          padding: 11px 12px 10px; border-bottom: 1px solid #edf2f6;
        }
        .estr-sb-buscabox .estr-sb-busca-ic { color: #6b7d8e; display: flex; }
        .estr-sb-busca {
          flex: 1; height: 30px; border: 1px solid #dfe8f0; border-radius: 8px;
          background: #f7fafc; padding: 0 10px; font-size: 13px;
          font-family: inherit; color: #14384f; outline: none;
        }
        .estr-sb-busca::placeholder { color: #9aabb8; }
        .estr-sb-busca:focus { border-color: #2f8fc4; }
        .estr-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; }
        .estr-sb-lista::-webkit-scrollbar { width: 8px; }
        .estr-sb-lista::-webkit-scrollbar-track { background: #f2f6f9; }
        .estr-sb-lista::-webkit-scrollbar-thumb { background: #c3d5e2; border-radius: 4px; }
        .estr-sb-it {
          display: flex; align-items: center; gap: 10px;
          height: 38px; padding: 0 8px; border-radius: 8px; cursor: pointer;
          font-size: 13px; color: #14384f;
        }
        .estr-sb-it:hover, .estr-sb-it.foco { background: #f2f7fb; }
        .estr-sb-it.sel { background: #eaf4fb; font-weight: 700; }
        .estr-sb-it-todos { font-weight: 700; }
        .estr-sb-it-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .estr-sb-ck { color: #1c6fa8; display: flex; }
        .estr-sb-rodape {
          padding: 7px 12px; border-top: 1px solid #edf2f6;
          font-size: 10.5px; font-weight: 600; color: #7d8fa0;
        }
        @media (max-width: 1280px) { .estr-sb-celwrap { flex-basis: 32%; } }
        @media (max-width: 900px)  { .estr-sb-celwrap { flex-basis: 48%; } }

        /* Cards KPI — compactos e alinhados */
        .estr-cards-grid {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px;
        }
        @media (max-width: 1000px) { .estr-cards-grid { grid-template-columns: repeat(2, 1fr); } }
        .estr-card {
          position: relative; padding: 12px 14px; border-radius: 10px; overflow: hidden;
          border: 1px solid transparent;
          display: flex; flex-direction: column;
        }
        .estr-card-faixa { position: absolute; top: 0; right: 0; bottom: 0; width: 3px; }
        .estr-card-titulo {
          font-size: 9px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.06em; margin-bottom: 6px;
          color: #06283A; /* V849: título dos cards totalizadores (variantes coloridas mantêm a própria) */
        }
        .estr-card-valor { font-size: 20px; font-weight: 800; line-height: 1.1; }
        .estr-card-valor-pct { font-size: 12px; font-weight: 600; opacity: 0.7; }
        .estr-card-sub {
          padding-top: 6px;
          font-size: 10px; color: var(--ink-soft); line-height: 1.4;
        }
        .estr-card-verde   { background: linear-gradient(135deg, #E8F1EE, #D4E4DF); border-color: #A8C8C0; }
        .estr-card-verde .estr-card-faixa, .estr-card-verde .estr-card-titulo, .estr-card-verde .estr-card-valor { color: #005073; }
        .estr-card-verde .estr-card-faixa { background: #005073; }
        .estr-card-roxo    { background: linear-gradient(135deg, #ECE5F2, #DAC8E4); border-color: #C0A8D0; }
        .estr-card-roxo .estr-card-faixa { background: #6B4587; }
        .estr-card-roxo .estr-card-titulo, .estr-card-roxo .estr-card-valor { color: #6B4587; }
        .estr-card-bege    { background: linear-gradient(135deg, #E8F1F7, #CDEBDD); border-color: #9FE6C9; }
        .estr-card-bege .estr-card-faixa { background: #005073; }
        .estr-card-bege .estr-card-titulo, .estr-card-bege .estr-card-valor { color: #005073; }
        .estr-card-destaque { background: linear-gradient(135deg, #005073, #0C3A2F); border-color: #005073; box-shadow: 0 4px 12px rgba(0, 80, 115,.2); display: flex; flex-direction: column; }
        .estr-card-destaque .estr-card-titulo { color: #56645E; }
        .estr-card-destaque .estr-card-valor  { color: #005073; }
        .estr-card-destaque .estr-card-sub    { color: #B9D4CB; }

        /* Tabela principal */
        .estr-tabela thead th {
          text-transform: none !important;
          letter-spacing: 0 !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          color: var(--ink) !important;
        }
        .estr-toggle {
          text-align: center; cursor: pointer; color: var(--primary);
          font-weight: 700; user-select: none;
        }
        .estr-toggle:hover { color: var(--accent); }
        /* V732: era o creme #FBF8F0 — agora o AZUL da zebra da aba ADICIONAL
           do LIO (#E4EEF4 = var(--bg-sunken)), padrão da ferramenta. */
        /* V959: a linha do médico tem SEMPRE o fundo #E4EEF4 — aberta ou fechada
           (antes só a expandida .estr-linha-exp ganhava a cor) */
        .estr-linha-medico, .estr-linha-exp { background: #E4EEF4; }
        .estr-medico-nome { font-weight: 600; }
        .estr-linha-drilldown td { border-top: none !important; }

        /* Tabela do drilldown */
        /* V958: moldura #D3E0E9 em volta da tabela (o painel era só branco, sem delimitador) */
        .estr-dd-moldura { border: 1px solid #D3E0E9; border-radius: 8px; overflow: hidden; margin-top: 8px; background: #FFFFFF; }
        .estr-dd-tabela {
          width: 100%; border-collapse: collapse; font-size: 12px;
          background: white;
        }
        .estr-dd-tabela td, .estr-dd-tabela th { border-bottom-color: #D3E0E9; }
        .estr-dd-tabela thead {
          background: var(--bg-sunken);
        }
        .estr-dd-tabela th {
          padding: 8px 10px; text-align: left;
          font-size: 10px; font-weight: 700; color: var(--ink-soft);
          text-transform: uppercase; letter-spacing: 0.04em;
          border-bottom: 1px solid var(--border);
        }
        .estr-dd-tabela td {
          padding: 8px 10px; border-bottom: 1px solid var(--border);
        }
        .estr-dd-tabela tr:last-child td { border-bottom: none; }

        /* Card de detalhe da admissão filtrada */
        .estr-detalhe-adm {
          background: linear-gradient(135deg, #E8F1F7 0%, #DBF0F9 100%);
          border: 1px solid #9FE6C9;
          border-left: 4px solid #189AD3;
          border-radius: 10px;
          padding: 14px 18px;
          margin: 16px 0 10px 0;
        }
        .estr-detalhe-multi {
          background: #FFF8E1;
          border-left-color: #005073;
          font-size: 12px; color: #4A3E1F;
          display: flex; align-items: center; gap: 10px;
        }
        .estr-detalhe-header {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 10px;
        }
        .estr-detalhe-titulo {
          font-size: 11px; font-weight: 700; color: #005073;
          text-transform: uppercase; letter-spacing: 0.05em;
        }
        .estr-detalhe-resumo {
          display: grid; grid-template-columns: 160px 1fr 130px;
          gap: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid #9FE6C9;
          margin-bottom: 12px;
        }
        @media (max-width: 700px) {
          .estr-detalhe-resumo { grid-template-columns: 1fr 1fr; }
        }
        .estr-detalhe-campo { min-width: 0; }
        .estr-detalhe-label {
          font-size: 9px; color: #005073;
          text-transform: uppercase; letter-spacing: 0.05em;
          font-weight: 600; margin-bottom: 3px;
        }
        .estr-detalhe-valor {
          font-size: 13px; font-weight: 700; color: var(--ink);
          line-height: 1.3; word-break: break-word;
        }
        .estr-detalhe-produtos-label {
          font-size: 10px; font-weight: 700; color: #003A54;
          text-transform: uppercase; letter-spacing: 0.06em;
          margin-bottom: 6px;
          display: flex; justify-content: space-between; align-items: center;
        }
        .estr-detalhe-produtos-contagem {
          font-size: 10px; color: #005073;
          font-weight: 500; text-transform: none; letter-spacing: 0;
        }
        .estr-detalhe-produtos {
          list-style: none; padding: 4px; margin: 0 0 10px 0;
          background: rgba(255,255,255,0.5); border-radius: 8px;
        }
        .estr-detalhe-produto {
          display: flex; align-items: baseline; gap: 8px;
          padding: 6px 10px; font-size: 12px;
          border-bottom: 1px dashed rgba(212, 190, 126, 0.5);
        }
        .estr-detalhe-produto:last-child { border-bottom: none; }
        .estr-detalhe-produto-nome { flex: 1; color: var(--ink); line-height: 1.4; }
        .estr-detalhe-produto-traco { color: #189AD3; font-weight: 700; flex-shrink: 0; }
        .estr-detalhe-produto-valor {
          color: var(--primary); font-weight: 700; font-size: 12px;
          flex-shrink: 0; min-width: 100px; text-align: right;
        }
        .estr-detalhe-produto-zero {
          color: var(--ink-faint) !important;
          font-weight: 500 !important;
        }
        .estr-detalhe-total {
          display: flex; justify-content: space-between; align-items: center;
          padding: 8px 14px;
          background: #005073; color: #F1F7F7;
          border-radius: 8px; font-weight: 700; font-size: 12px;
        }
        .estr-detalhe-total .mono { color: #9FE6C9; font-size: 14px; }

        /* Breakdown dentro dos cards (Convênio/SUS/Particular) */
        .estr-card-breakdown {
          padding-top: 6px;
          display: flex; flex-direction: column; gap: 1px;
          font-size: 10px;
        }
        .estr-breakdown-item { display: flex; align-items: center; gap: 5px; color: var(--ink-soft); }
        .estr-bd-dot {
          display: inline-block; width: 5px; height: 5px;
          border-radius: 50%; flex-shrink: 0;
        }
        .estr-breakdown-item strong { color: var(--ink); }

        /* Comparativos vs LM e vs LY (em linha) */
        .estr-card-comp {
          margin-top: 8px; padding-top: 6px;
          border-top: 1px dashed rgba(0,0,0,0.08);
          display: flex; gap: 10px; font-size: 10px;
        }
        .estr-card-comp-item {
          display: flex; align-items: center; gap: 4px;
        }
        .estr-card-comp-lbl { color: var(--ink-soft); font-weight: 600; font-size: 9px; white-space: nowrap; }
        .estr-comp-up    { color: #0A7A5A; font-weight: 700; }
        .estr-comp-down  { color: #9B3A3A; font-weight: 700; }
        .estr-comp-igual { color: var(--ink-soft); font-weight: 600; }
        .estr-comp-vazio { color: var(--ink-faint); }
        /* Card destaque (verde escuro) */
        .estr-card-destaque .estr-card-comp { border-top-color: #56645E; }
        .estr-card-destaque .estr-card-comp-lbl { color: #B9D4CB; }
        .estr-card-destaque .estr-comp-up    { color: #C8F5C0; }
        .estr-card-destaque .estr-comp-down  { color: #F5B5B5; }
        .estr-card-destaque .estr-comp-igual,
        .estr-card-destaque .estr-comp-vazio { color: #B9D4CB; }

        /* Filtros de vínculo no painel Ajustes */
        .estr-vinc-grid {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .estr-vinc-chk {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border: 1px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
          background: var(--bg-sunken);
          transition: background 100ms;
        }
        .estr-vinc-chk:hover { background: white; }
        .estr-vinc-chk input { cursor: pointer; }

        /* Admissão repetida (alerta vermelho) */
        /* V957: sem as barras verticais vermelhas à esquerda das células —
           fica só o fundo vermelho claro (o código em negrito e o aviso ficam) */
        .estr-row-repetida td {
          background: #FFF0F0 !important;
        }
        .estr-row-repetida td:first-child {
          font-weight: 700;
          color: #9B3A3A;
        }
        .estr-row-aviso-repetida td {
          padding: 0 !important;
          background: #FFF0F0 !important;
        }
        .estr-aviso-repetida {
          padding: 6px 14px;
          background: #FFE4E1;
          border-bottom: 1px dashed #C8302B;
          font-size: 11px;
          color: #9B3A3A;
          line-height: 1.5;
        }
        .estr-aviso-icone {
          margin-right: 6px;
          font-weight: 700;
          color: #C8302B;
        }
        .estr-aviso-sub {
          color: #7A4040;
          font-style: italic;
          margin-left: 6px;
        }

        /* Tipo (SUS / Convênio / Particular) */
        .estr-tipo-sus, .estr-tipo-conv, .estr-tipo-part {
          display: inline-block; padding: 1px 7px;
          font-size: 9px; font-weight: 700; border-radius: 3px;
          letter-spacing: 0.05em; color: white;
        }
        .estr-tipo-sus  { background: #003A54; }
        .estr-tipo-conv { background: #003A54; }
        .estr-tipo-part { background: #6B4587; }
        .estr-sem-marc { color: var(--ink-faint); font-style: italic; }

        /* Badge X/Y de marcações na linha do médico */
        .estr-marcadas {
          display: inline-block;
          padding: 3px 10px;
          background: var(--bg-sunken);
          color: var(--ink-soft);
          border-radius: 12px;
          font-size: 11px;
          font-weight: 700;
        }
        .estr-marcadas-completo {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 10px;
          background: linear-gradient(135deg, #005073, #2E8870);
          color: white;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 700;
          box-shadow: 0 1px 3px rgba(30, 92, 80, 0.3);
        }
        .estr-check-completo {
          font-size: 12px;
          line-height: 1;
        }

        /* Radio de quantidade (—/1/2) */
        .estr-qtd-radio {
          display: inline-flex; gap: 2px;
          background: var(--bg-sunken); padding: 2px;
          border-radius: 6px; border: 1px solid var(--border);
        }
        .estr-qtd-btn {
          width: 28px; height: 24px;
          background: transparent; border: none; cursor: pointer;
          font-size: 12px; font-weight: 700; color: var(--ink-soft);
          border-radius: 4px;
        }
        .estr-qtd-btn:hover:not(.estr-qtd-active) { background: white; }
        .estr-qtd-active {
          background: var(--primary); color: white;
        }

        /* Popovers (Ajustes + Regras) */
        .estr-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 100; }
        .estr-popover {
          position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
          width: 580px; max-width: calc(100vw - 60px);
          max-height: calc(100vh - 120px); overflow-y: auto;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,0.2); z-index: 101;
        }
        .estr-popover-regras { width: 680px; }
        .estr-popover-header {
          padding: 14px 18px; border-bottom: 1px solid var(--border);
          display: flex; justify-content: space-between; align-items: center;
        }
        .estr-popover-header h3 {
          margin: 0; font-family: var(--font-display); font-weight: 500; font-size: 16px;
        }
        .estr-popover-close {
          background: transparent; border: none; font-size: 22px;
          color: var(--ink-soft); cursor: pointer; padding: 0 4px;
        }
        .estr-aj-bloco { padding: 16px 18px; }
        .estr-aj-titulo {
          font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--ink-soft); margin-bottom: 12px;
        }
        .estr-aj-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
        }
        .estr-aj-card {
          background: var(--bg-sunken); border: 1px solid var(--border);
          border-radius: 10px; padding: 10px 14px;
          display: flex; align-items: center; gap: 10px;
        }
        .estr-aj-card-faixa { width: 3px; height: 32px; border-radius: 2px; flex-shrink: 0; }
        .estr-aj-card-label {
          font-size: 9px; font-weight: 700; color: var(--ink-soft);
          text-transform: uppercase; letter-spacing: 0.06em;
        }
        .estr-aj-card-valor {
          font-size: 14px; font-weight: 700; margin-top: 4px;
        }
        .estr-aj-num {
          cursor: pointer; padding: 1px 4px; border-radius: 4px;
        }
        .estr-aj-num:hover { background: white; }
        .estr-aj-num-input {
          font-family: var(--font-mono); font-size: 14px; font-weight: 700;
          padding: 1px 4px; border: 1px solid var(--accent); border-radius: 4px;
          width: 110px; outline: none;
        }
        .estr-aj-help {
          font-size: 10px; color: var(--ink-faint); margin-top: 10px;
        }

        /* Regras */
        .estr-regras-body { padding: 4px 0; }
        .estr-regra-bloco { padding: 14px 22px; border-bottom: 1px solid var(--border); }
        .estr-regra-bloco:last-child { border-bottom: none; }
        .estr-regra-titulo {
          display: flex; align-items: center; gap: 10px;
          font-size: 13px; font-weight: 700; color: var(--primary);
          margin-bottom: 10px;
        }
        .estr-regra-num {
          display: inline-flex; align-items: center; justify-content: center;
          width: 22px; height: 22px; background: var(--primary); color: white;
          border-radius: 50%; font-size: 11px; font-weight: 700;
        }
        .estr-regra-lista {
          margin: 0; padding-left: 22px;
          font-size: 12px; color: var(--ink); line-height: 1.65;
        }
        .estr-regra-lista li { margin-bottom: 4px; }
        .estr-regras-formulas {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
          margin-bottom: 8px;
        }
        @media (max-width: 700px) { .estr-regras-formulas { grid-template-columns: 1fr; } }
        .estr-regra-formula {
          background: var(--bg-sunken); padding: 10px 12px;
          border: 1px solid var(--border); border-radius: 8px;
          border-left: 3px solid var(--accent);
        }
        .estr-regra-formula-label {
          font-size: 9px; font-weight: 700; color: var(--ink-soft);
          text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;
        }
        .estr-regra-formula-eq {
          font-size: 13px; color: var(--ink); font-weight: 700;
        }
        .estr-regra-help {
          margin-top: 10px; padding: 8px 12px;
          background: var(--bg-sunken); border-left: 3px solid var(--accent);
          border-radius: 6px; font-size: 11px; color: var(--ink-soft); line-height: 1.5;
        }

        /* V716: menu de exportar agora é o padrão central (.atlas-menu-exp) */

        /* Blocos categorizados no card de detalhe (PROCEDIMENTO/MAT-MED/OPME) */
        .estr-blocos-cat {
          display: flex; flex-direction: column; gap: 6px;
          margin-bottom: 10px;
        }
        .estr-bloco-cat {
          background: rgba(255,255,255,0.6);
          border: 1px solid rgba(24, 154, 211, 0.4);
          border-radius: 8px;
          overflow: hidden;
        }
        .estr-bloco-header {
          width: 100%; display: flex; align-items: center; gap: 10px;
          padding: 8px 12px;
          background: transparent; border: none; cursor: pointer;
          text-align: left;
          font-family: inherit;
        }
        .estr-bloco-header:hover { background: rgba(24, 154, 211, 0.1); }
        .estr-bloco-sinal {
          font-size: 16px; font-weight: 700; color: #005073;
          width: 18px; text-align: center; line-height: 1;
        }
        .estr-bloco-icone { font-size: 13px; }
        .estr-bloco-titulo {
          font-weight: 700; font-size: 11px;
          text-transform: uppercase; letter-spacing: 0.05em;
          color: #003A54;
        }
        .estr-bloco-resumo {
          margin-left: auto; display: flex; align-items: center; gap: 12px;
        }
        .estr-bloco-count {
          font-size: 10px; color: #005073;
          padding: 2px 8px;
          background: rgba(24, 154, 211, 0.15);
          border-radius: 10px;
          font-weight: 600;
        }
        .estr-bloco-total {
          font-size: 12px; font-weight: 700; color: var(--primary);
        }
        .estr-bloco-linhas {
          list-style: none; margin: 0;
          padding: 6px 12px 10px;
          border-top: 1px dashed rgba(24, 154, 211, 0.3);
        }
        .estr-bloco-linhas li {
          display: flex; align-items: baseline; gap: 8px;
          padding: 4px 0; font-size: 12px;
        }
        .estr-bloco-nome { flex: 1; color: var(--ink); line-height: 1.4; }
        .estr-bloco-qtd {
          display: inline-block;
          font-size: 10px; color: var(--accent);
          font-weight: 700;
          background: rgba(24, 154, 211, 0.15);
          padding: 0 5px; border-radius: 3px;
          margin-left: 4px;
        }
        .estr-bloco-traco { color: #189AD3; font-weight: 700; flex-shrink: 0; }
        .estr-bloco-valor {
          color: var(--primary); font-weight: 700; font-size: 12px;
          flex-shrink: 0; min-width: 100px; text-align: right;
        }
        .estr-bloco-zero { color: var(--ink-faint) !important; font-weight: 500 !important; }

        /* V957: a linha de total do rodapé (.estr-tbody-total) saiu — os cards
           do topo já totalizam. Valores numéricos nunca quebram linha. */
        .estr-tabela td.num, .estr-dd-tabela td.num, .estr-dd-tabela th.num { white-space: nowrap; }

        /* Popover Mostrar/Ocultar colunas */
        .estr-ocultar-lista {
          display: flex; flex-direction: column; gap: 6px;
          background: var(--bg-sunken);
          padding: 8px; border-radius: 8px;
        }
        .estr-ocultar-linha {
          display: flex; align-items: center; gap: 10px;
          padding: 6px 10px;
          background: white; border-radius: 6px;
          border: 1px solid var(--border);
        }
        .estr-ocultar-fixa {
          background: rgba(0, 80, 115, 0.04);
          border-color: rgba(0, 80, 115, 0.15);
        }
        .estr-ocultar-chk {
          display: flex; align-items: center;
          cursor: pointer;
        }
        .estr-ocultar-chk input { cursor: pointer; }
        .estr-ocultar-chk input:disabled { cursor: not-allowed; opacity: 0.5; }
        .estr-ocultar-input {
          flex: 1; padding: 4px 8px;
          font-size: 12px; font-weight: 500;
          border: 1px solid transparent; border-radius: 4px;
          background: transparent; color: var(--ink);
          font-family: inherit;
        }
        .estr-ocultar-input:hover { border-color: var(--border); }
        .estr-ocultar-input:focus {
          outline: none;
          border-color: var(--accent);
          background: white;
        }
        .estr-ocultar-fixa-tag {
          font-size: 9px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--ink-faint);
          background: rgba(0, 80, 115, 0.08);
          padding: 2px 7px; border-radius: 4px;
        }
        .estr-ocultar-acoes {
          margin-top: 12px;
          display: flex; align-items: center; gap: 12px;
        }
    `;
  }

};
