/**
 * ============================================================================
 * TELA: Fichário Fellow (plantões diários)
 *
 * 1 linha = 1 plantão (data + fellow + turno). Mesmo fellow pode ter manhã +
 * tarde + noturno no mesmo dia.
 *
 *   Total a Repassar = max(0, valor_complem) + refeição — V900: o complemento
 *   vale só até a meta; acima dela não há desconto (igual à edição de linha).
 *   O excedente segue visível com sinal em qtd/valor_complem (rosa).
 *
 *   Refeição: turno=NOTURNO OU dia ∈ {sáb, dom} → R$ 50.
 *   Turno 'DIA' (V900) = planilha sem turno; refeição só pelo fim de semana.
 *
 * Features (paridade com Períodos V10):
 *  - 4 cards KPI com comparação LM/LY e YTD
 *  - Filtros: ano, mês, fellow, turno, busca por nome (debounce)
 *  - Tabela agrupada por fellow (colapsável), subtotais + total geral
 *  - Linhas FDS com fundo amarelo, complemento negativo em rosa
 *  - Edição inline com modal (Data, Fellow, Turno, QTD) + preview ao vivo
 *  - Excluir linha individual + excluir mês inteiro
 *  - Snapshots por mês
 *  - Botão ocultar valores (LGPD)
 *  - Mostrar/Ocultar colunas (persistido em localStorage)
 *  - Exportar Excel
 * ============================================================================
 */

App.telas['desempenho-fellow'] = function () {

  if (window.__fel === undefined) {
    window.__fel = {
      anoSelecionado: null,
      mesSelecionado: null,
      filtroFellow: '',
      filtroTurno: '',
      filtroNome: '',
      configColunas: null,
      ocultarAberto: false,
      menuVisaoAberto: false,
      fellowsColapsados: new Set(),
      linhaEditando: null,
      sbAberto: null,                 // V732: célula aberta na fileira de filtros 20C
      infoAberto: false,              // V128.4: popover info ⓘ
    };
  }

  const COLUNAS_PADRAO = [
    { id: 'data',           label: 'Data',           visivel: true, fixa: true  },
    { id: 'fellow',         label: 'Fellow',         visivel: true, fixa: false },
    { id: 'turno',          label: 'Turno',          visivel: true, fixa: false },
    { id: 'qtd_atendim',    label: 'QTD Atendim.',   visivel: true, fixa: false },
    { id: 'qtd_complem',    label: 'QTD Complem.',   visivel: true, fixa: false },
    { id: 'valor_complem',  label: 'Valor Complem.', visivel: true, fixa: false },
    { id: 'refeicao',       label: 'Refeição',       visivel: true, fixa: false },
    { id: 'total_repassar', label: 'Total R$',       visivel: true, fixa: false },
  ];
  const STORAGE_KEY_COLS = 'fel_colunas_config_v1';

  const DOW_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  // V900: 'DIA' = plantão importado sem turno informado (planilha simples).
  // Refeição nele só pelo fim de semana; o ✏ da linha permite trocar o turno.
  const TURNO_LABEL = { 'MANHA': 'Manhã', 'TARDE': 'Tarde', 'NOTURNO': 'Noturno', 'DIA': 'Dia' };
  const MESES_NOMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

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
  function normalizar(s) {
    if (!s) return '';
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  }

  /** Converte índice em rótulo de ofuscação: 0→A, 1→B, ..., 25→Z, 26→AA. */
  function letraOfuscacao(i) {
    let s = '';
    i = Math.max(0, i);
    do {
      s = String.fromCharCode(65 + (i % 26)) + s;
      i = Math.floor(i / 26) - 1;
    } while (i >= 0);
    return s;
  }

  /** Busca o nome original do fellow a partir do nome normalizado. */
  function buscarNomeOriginalFellow(norm) {
    if (!norm) return null;
    try {
      const r = Banco.queryUnica(
        `SELECT fellow_nome FROM fellow_linhas WHERE fellow_norm = ? LIMIT 1`,
        [norm]
      );
      return r?.fellow_nome || null;
    } catch (e) { return null; }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Valores EFETIVOS — aplicam regra do "sem complemento" e override manual
  // ──────────────────────────────────────────────────────────────────────
  // Regra:
  //   - valor_complem_manual NÃO é null  →  usa o override (pode ser qualquer valor, inclusive 0)
  //   - qtd_complem < 0 (atendeu acima da meta) →  "Sem complemento" (vale 0)
  //   - senão → usa o valor_complem calculado normalmente

  function temManual(l)            { return l.valor_complem_manual !== null && l.valor_complem_manual !== undefined; }
  function estaSemComplemento(l)   { return !temManual(l) && l.qtd_complem < 0; }
  function valorComplemEfetivo(l)  {
    if (temManual(l))         return Number(l.valor_complem_manual);
    if (l.qtd_complem < 0)    return 0;                  // "Sem complemento"
    return Number(l.valor_complem) || 0;
  }
  function qtdComplemEfetiva(l)    {
    if (temManual(l))         return null;               // manual: não mostra qtd (é arbitrário)
    if (l.qtd_complem < 0)    return null;               // "Sem complemento"
    return l.qtd_complem;
  }
  function totalEfetivo(l) {
    return valorComplemEfetivo(l) + (Number(l.refeicao) || 0);
  }

  /** 'YYYY-MM-DD' → 'dd/mm' */
  function formatarDataCurta(iso) {
    if (!iso) return '—';
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  }
  /** 'YYYY-MM-DD' → 'dd/mm/yyyy' */
  function formatarDataLonga(iso) {
    if (!iso) return '—';
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
  }

  function formatarMesLabel(mes_ref) {
    if (!mes_ref) return '—';
    const [ano, mes] = mes_ref.split('-');
    const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${nomes[parseInt(mes) - 1]}/${ano.slice(2)}`;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Config / Cadastro
  // ──────────────────────────────────────────────────────────────────────
  function lerConfig() {
    try {
      const rows = Banco.query(`SELECT chave, valor FROM fellow_config`);
      const cfg = { meta: 13, valor_atend: 38, valor_refeicao: 50 };
      for (const r of rows) {
        if (r.chave === 'META_ATENDIMENTOS')     cfg.meta = parseInt(r.valor) || 13;
        if (r.chave === 'VALOR_POR_ATENDIMENTO') cfg.valor_atend = parseFloat(r.valor) || 38;
        if (r.chave === 'VALOR_REFEICAO')        cfg.valor_refeicao = parseFloat(r.valor) || 50;
      }
      return cfg;
    } catch (e) {
      return { meta: 13, valor_atend: 38, valor_refeicao: 50 };
    }
  }

  function listarFellowsCadastrados() {
    try {
      return Banco.query(`
        SELECT id, nome_original, nome_normalizado
        FROM fellow_cadastro WHERE ativo = 1
        ORDER BY nome_original
      `);
    } catch (e) { return []; }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Queries
  // ──────────────────────────────────────────────────────────────────────

  function listarMesesDisponiveis() {
    try {
      return Banco.query(`SELECT DISTINCT mes_ref FROM fellow_linhas ORDER BY mes_ref DESC`)
        .map(r => r.mes_ref);
    } catch (e) { return []; }
  }

  function listarFellowsDoMes(mes_ref) {
    try {
      return Banco.query(`
        SELECT DISTINCT fellow_nome FROM fellow_linhas
        WHERE mes_ref = ? ORDER BY fellow_nome
      `, [mes_ref]).map(r => r.fellow_nome);
    } catch (e) { return []; }
  }

  function carregarLinhas(mes_ref, filtros) {
    if (!mes_ref) return [];
    const where = [`mes_ref = ?`];
    const params = [mes_ref];

    if (filtros) {
      // V922: filtros MULTI — união de igualdades (string legada ou array)
      const _FMsel = Utilidades.filtroMulti.sel;
      const selF = _FMsel(filtros.fellow);
      if (selF.length) { where.push(`fellow_nome IN (${selF.map(() => '?').join(',')})`); params.push(...selF); }
      const selT = _FMsel(filtros.turno);
      if (selT.length) { where.push(`turno IN (${selT.map(() => '?').join(',')})`); params.push(...selT); }
      if (filtros.nome) {
        where.push('UPPER(fellow_norm) LIKE ?');
        params.push('%' + normalizar(filtros.nome) + '%');
      }
    }

    return Banco.query(`
      SELECT id, mes_ref, data_plantao, fellow_nome, fellow_norm, fellow_id, turno,
             qtd_atendim, meta, valor_atendim, valor_refeicao,
             qtd_complem, valor_complem, valor_complem_manual,
             refeicao, total_repassar, dia_semana
      FROM fellow_linhas
      WHERE ${where.join(' AND ')}
      ORDER BY fellow_nome, data_plantao, turno
    `, params);
  }

  function calcularKPIs(linhas) {
    // Usa valores EFETIVOS (com regra "sem complemento" e override manual aplicada)
    return {
      linhas: linhas.length,
      fellows: new Set(linhas.map(l => l.fellow_norm)).size,
      total_atendim: linhas.reduce((s, l) => s + (l.qtd_atendim || 0), 0),
      total_complem: linhas.reduce((s, l) => s + valorComplemEfetivo(l), 0),
      total_refeicao: linhas.reduce((s, l) => s + (l.refeicao || 0), 0),
      total_repassar: linhas.reduce((s, l) => s + totalEfetivo(l), 0),
      plantoes_neg: linhas.filter(l => estaSemComplemento(l)).length,
      plantoes_manual: linhas.filter(l => temManual(l)).length,
      plantoes_refeicao: linhas.filter(l => l.refeicao > 0).length,
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

  // ──────────────────────────────────────────────────────────────────────
  // RENDER PRINCIPAL
  // ──────────────────────────────────────────────────────────────────────

  function renderizar() {
    const meses = listarMesesDisponiveis();

    if (!window.__fel.anoSelecionado && meses.length > 0) {
      const [ano, mes] = meses[0].split('-');
      window.__fel.anoSelecionado = ano;
      window.__fel.mesSelecionado = mes;
    }

    const mes_ref = window.__fel.anoSelecionado && window.__fel.mesSelecionado
      ? `${window.__fel.anoSelecionado}-${window.__fel.mesSelecionado}`
      : null;

    const filtros = {
      fellow: window.__fel.filtroFellow,
      turno: window.__fel.filtroTurno,
      nome: window.__fel.filtroNome,
    };

    const linhas = carregarLinhas(mes_ref, filtros);
    const kpis = calcularKPIs(linhas);

    const mp = mesAnterior(mes_ref);
    const ya = anoAnterior(mes_ref);
    const linhasLM = mp ? carregarLinhas(mp, {}) : [];
    const linhasLY = ya ? carregarLinhas(ya, {}) : [];
    const kpisLM = linhasLM.length > 0 ? calcularKPIs(linhasLM) : null;
    const kpisLY = linhasLY.length > 0 ? calcularKPIs(linhasLY) : null;

    let kpisYTD = null;
    if (mes_ref) {
      const [ano] = mes_ref.split('-');
      const linhasYTD = Banco.query(`
        SELECT qtd_atendim, valor_complem, refeicao, total_repassar, qtd_complem
        FROM fellow_linhas
        WHERE mes_ref >= ? AND mes_ref <= ?
      `, [`${ano}-01`, mes_ref]);
      kpisYTD = calcularKPIs(linhasYTD.map(l => ({
        ...l, fellow_norm: 'YTD',  // não usado nos cálculos abaixo
      })));
    }

    const cfg = (window.__fel.configColunas = window.__fel.configColunas || carregarConfigColunas());

    const html = `
      <div class="page-content fel-page">
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
    Utilidades.garantirEstilos('css-tela-desempenho-fellow', getStyles());
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
    const focoNome = focoNorm ? buscarNomeOriginalFellow(focoNorm) : null;

    let labelVisao = '👁 Visualização';
    if (modo === 'oculto') labelVisao = '<i class="ti ti-eye-off"></i> Ocultos';
    if (modo === 'foco' && focoNome) labelVisao = `🎯 ${focoNome}`;

    return `
      <div class="fel-header">
        <div class="fel-header-info">
          <div class="fic-titulo-wrap">
            <h1>Fellow</h1>
            <button class="fic-btn-info ${window.__fel.infoAberto ? 'fic-btn-info-ativo' : ''}"
                    id="fel-btn-info"
                    title="Ver regras do fichário Fellow">ⓘ</button>
          </div>
          ${window.__fel.infoAberto ? `
            <div class="fic-popover-info">
              <div class="fic-popover-info-head">
                <strong>Regras Fellow</strong>
                <button class="fic-popover-info-close" id="fel-info-close">✕</button>
              </div>
              <div class="fic-popover-info-body">
                <p>
                  <strong>Granularidade</strong> · 1 linha = 1 plantão (<code>data + fellow + turno</code>).
                  Mesmo fellow pode ter manhã + tarde + noturno no mesmo dia.
                </p>
                <p>
                  <strong>Total a Repassar</strong> · quem atende <strong>menos que a meta</strong> recebe o
                  complemento até ela (<code>(meta − qtd) × R$/atend</code>); quem atende a meta ou mais
                  não tem complemento — e <strong>não desconta</strong>. O excedente aparece em rosa,
                  só como informação.
                </p>
                <p>
                  <strong>Refeição</strong> · Concedida quando o turno é <code>NOTURNO</code>
                  <em>ou</em> o dia é sábado/domingo. Valor: <strong>R$ 50</strong>.
                </p>
                <p>
                  <strong>Importação</strong> · Basta a planilha mensal com
                  <code>Data · Médico · Turno · Qtd. Atendimento</code> — o fichário calcula o resto.
                  Se vier sem o turno, os plantões entram como <em>Dia</em> (refeição só pelo fim de
                  semana) e dá para corrigir no ✏ da linha. Cada planilha sobrescreve o
                  <code>mes_ref</code>. Chave única: (mes_ref, data, fellow_norm, turno).
                </p>
              </div>
            </div>
          ` : ''}
          <p>Atendimentos diários · Complemento de meta + refeição</p>
        </div>
        <div class="fel-header-acoes">
          <div class="fel-menu-wrap">
            <button class="btn-compact ${modo !== 'tudo' ? 'ativo' : ''}" id="btn-fel-visualizacao" title="Modo de exibição">
              ${labelVisao} ▾
            </button>
            ${window.__fel.menuVisaoAberto ? renderMenuVisao(modo, focoNorm) : ''}
          </div>
          <!-- V735: ordem do DOM = ordem de leitura do leque (#atlas-hub absorve
               na ordem do DOM; .hub-itens é flex row): Extração · Ajuste · Importação -->
          <button class="btn-compact btn-compact-primary" id="btn-fel-exportar">Extração</button>
          <button class="btn-compact" id="btn-fel-ajuste-matriz">🛠 Ajuste de Matriz</button><!-- V728: absorveu o "⋮ Colunas" -->
          <button class="btn-compact" id="btn-fel-importar">📥 Importar</button>
        </div>
      </div>
    `;
  }

  /** Menu dropdown de modo de exibição (Tudo · Oculto · Focar em fellow) */
  function renderMenuVisao(modo, focoNorm) {
    const mes_ref = window.__fel.anoSelecionado && window.__fel.mesSelecionado
      ? `${window.__fel.anoSelecionado}-${window.__fel.mesSelecionado}`
      : null;
    let fellowsDisponiveis = [];
    if (mes_ref) {
      try {
        fellowsDisponiveis = Banco.query(`
          SELECT DISTINCT fellow_norm, fellow_nome
          FROM fellow_linhas
          WHERE mes_ref = ?
          ORDER BY fellow_nome
        `, [mes_ref]);
      } catch (e) {}
    }

    return `
      <div class="fel-menu-visao" id="fel-menu-visao">
        <button class="fel-menu-item ${modo === 'tudo' ? 'ativo' : ''}" data-modo="tudo">
          <span class="fel-menu-ico">👁</span>
          <span class="fel-menu-txt">
            <strong>Mostrar tudo</strong>
            <small>Exibição normal</small>
          </span>
        </button>
        <button class="fel-menu-item ${modo === 'oculto' ? 'ativo' : ''}" data-modo="oculto">
          <span class="fel-menu-ico"><i class="ti ti-eye-off"></i></span>
          <span class="fel-menu-txt">
            <strong>Ocultar valores</strong>
            <small>Para compartilhar tela / fotografar</small>
          </span>
        </button>
        <div class="fel-menu-sep"></div>
        <div class="fel-menu-foco">
          <div class="fel-menu-foco-label">
            <span class="fel-menu-ico">🎯</span>
            <strong>Focar em fellow</strong>
          </div>
          <small style="display:block; padding:0 4px 6px; color: var(--ink-faint); font-size: 10px;">
            Mostra só este fellow com nome/valor reais.<br>Demais ficam como "Fellow A", "Fellow B"...
          </small>
          <select class="fel-menu-foco-select" id="fel-foco-select">
            <option value="">— selecione —</option>
            ${fellowsDisponiveis.map(f =>
              `<option value="${escapeAttr(f.fellow_norm)}" ${f.fellow_norm === focoNorm ? 'selected' : ''}>${escapeHTML(f.fellow_nome)}</option>`
            ).join('')}
          </select>
        </div>
      </div>
    `;
  }

  function renderVazio() {
    return `
      <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 40px 20px">
        <div style="font-size: 32px; margin-bottom: 12px;">📂</div>
        <div style="color: var(--ink-soft); font-size: 14px; margin-bottom: 16px;">
          Nenhuma planilha de Fellow importada ainda.
        </div>
        <button class="btn btn-primary" id="btn-fel-importar-vazio">
          📥 Importar Planilha de Fellow
        </button>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // V732: fileira de filtros 20C (padrão LIO/OPME, prefixo fel-sb)
  // Células: Ano · Mês · Fellow · Turno. Painéis abrem/fecham LOCAL
  // (insertAdjacentHTML — zero re-render); aplicar seta o MESMO state dos
  // handlers antigos e chama renderizar().
  // ──────────────────────────────────────────────────────────────────────
  function _felSbIc(nome) {
    return {
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
      search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
      check: '<polyline points="20 6 9 17 4 12"/>',
      chev: '<polyline points="6 9 12 15 18 9"/>',
    }[nome] || '';
  }
  function _felSbSvg(d, px, sw) {
    return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  function _felSbSemAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function _felSbIniciais(nome) {
    const p = String(nome || '').split(/\s+/).filter(w => w.length >= 3);
    return ((p[0] || ' ')[0] + ((p[1] || ' ')[0] || '')).toUpperCase().trim() || '–';
  }

  function renderBarraFiltrosFel20C(ctx) {
    // guarda as listas pro painel abrir LOCAL depois, sem recoletar
    window.__fel._sbOpcoes = {
      anos: ctx.anos,
      meses: ctx.mesesDoAno,
      fellows: ctx.fellows,
    };
    const cel = (id, rotulo, valor, icone, flex, vazio = 'Todos') => {
      const ativo = !!valor;
      const estaAberta = window.__fel.sbAberto === id;
      // Turno usa o caractere '◐' no tile (não tem SVG equivalente no set)
      const tile = icone === '◐'
        ? '<span style="font-size:15px;line-height:1" aria-hidden="true">◐</span>'
        : _felSbSvg(_felSbIc(icone), 14, 2.1);
      return `
        <div class="fel-sb-celwrap" style="flex:${flex}">
          <button type="button" class="fel-sb-cel ${ativo ? 'ativo' : ''} ${estaAberta ? 'aberta' : ''}"
                  data-sb-cel="${id}" data-sb-vazio="${vazio}" role="combobox" aria-expanded="${estaAberta ? 'true' : 'false'}" aria-haspopup="listbox">
            <span class="fel-sb-tile">${tile}</span>
            <span class="fel-sb-tx">
              <span class="fel-sb-rot">${rotulo}</span>
              <span class="fel-sb-val">${escapeHTML(valor || vazio)}</span>
            </span>
            <span class="fel-sb-chev">${_felSbSvg(_felSbIc('chev'), 10, 2.8)}</span>
          </button>
          ${estaAberta ? painelFel20C(id) : ''}
        </div>`;
    };
    const mesLabel = window.__fel.mesSelecionado
      ? (MESES_NOMES[Number(window.__fel.mesSelecionado) - 1] || window.__fel.mesSelecionado) : '';
    // V922: rótulos dos filtros multi
    const FM = Utilidades.filtroMulti;
    const rotMulti = (f) => FM.ativo(f) ? FM.rotulo(f) : '';
    const rotMultiTurno = (f) => {
      const sel = FM.sel(f);
      if (!sel.length) return '';
      if (sel.length === 1) return TURNO_LABEL[sel[0]] || sel[0];
      return `${sel.length} selecionados`;
    };
    return `
      <div class="fel-sb" id="fel-sb">
        ${cel('ano', 'Ano', window.__fel.anoSelecionado || '', 'clock', 0.75, '—')}
        ${cel('mes', 'Mês', mesLabel, 'calendar', 0.9, '—')}
        ${cel('fellow', 'Fellow', rotMulti(window.__fel.filtroFellow), 'userplus', 1.5)}
        ${cel('turno', 'Turno', rotMultiTurno(window.__fel.filtroTurno), '◐', 0.9)}
      </div>`;
  }

  function painelFel20C(id) {
    const opc = window.__fel._sbOpcoes || {};
    const item = (val, rotulo, sel, chip) => `
      <div class="fel-sb-it ${sel ? 'sel' : ''} ${val === '' ? 'fel-sb-it-todos' : ''}" data-sb-item data-val="${escapeAttr(val)}" data-busca="${escapeAttr(_felSbSemAcento(rotulo))}" role="option" aria-selected="${sel ? 'true' : 'false'}">
        ${chip ? `<span class="fel-sb-chip">${escapeHTML(_felSbIniciais(rotulo))}</span>` : ''}
        <span class="fel-sb-it-nome">${escapeHTML(rotulo)}</span>
        ${sel ? `<span class="fel-sb-ck">${_felSbSvg(_felSbIc('check'), 14, 2.5)}</span>` : ''}
      </div>`;
    const painelLista = (cel, itensHtml, { busca = false, total = 0 } = {}) => `
      <div class="fel-sb-painel" data-sb-painel="${cel}">
        ${busca ? `
          <div class="fel-sb-buscabox">
            <span class="fel-sb-busca-ic">${_felSbSvg(_felSbIc('search'), 15, 2.1)}</span>
            <input type="text" class="fel-sb-busca" data-sb-busca placeholder="Digite pra buscar" autocomplete="off">
          </div>` : ''}
        <div class="fel-sb-lista" role="listbox">${itensHtml}</div>
        ${busca ? `<div class="fel-sb-rodape" data-sb-contagem>${total} opç${total === 1 ? 'ão' : 'ões'}</div>` : ''}
      </div>`;
    if (id === 'ano') {
      // Ano/Mês são seleções obrigatórias (sempre há um mês ativo) — sem "Todos"
      return painelLista('ano', (opc.anos || []).map(a => item(a, a, a === window.__fel.anoSelecionado)).join(''));
    }
    if (id === 'mes') {
      return painelLista('mes', (opc.meses || []).map(m =>
        item(m, MESES_NOMES[Number(m) - 1] || m, m === window.__fel.mesSelecionado)).join(''));
    }
    const FM = Utilidades.filtroMulti;   // V922: multi com marcados no topo
    if (id === 'fellow') {
      const fellows = opc.fellows || [];
      const sel = FM.sel(window.__fel.filtroFellow);
      const marcadas = fellows.filter(f => sel.includes(String(f)));
      const demais = fellows.filter(f => !sel.includes(String(f)));
      return painelLista('fellow',
        item('', 'Todos', sel.length === 0)
        + [...marcadas, ...demais].slice(0, 400).map(f => item(f, f, sel.includes(String(f)), true)).join(''),
        { busca: true, total: fellows.length });
    }
    // turno — lista curta (V922: multi — pode marcar mais de um turno; com busca)
    const selT = FM.sel(window.__fel.filtroTurno);
    return painelLista('turno',
      item('', 'Todos', selT.length === 0)
      + ['MANHA', 'TARDE', 'NOTURNO', 'DIA'].map(t => item(t, TURNO_LABEL[t], selT.includes(t))).join(''),
      { busca: true, total: 4 });
  }

  function bindBarraFiltrosFel20C() {
    const sb = document.getElementById('fel-sb');
    if (!sb) return;
    const fecharPainelLocal = () => {
      sb.querySelectorAll('.fel-sb-painel').forEach(p => p.remove());
      sb.querySelectorAll('.fel-sb-cel.aberta').forEach(c => { c.classList.remove('aberta'); c.setAttribute('aria-expanded', 'false'); });
      window.__fel.sbAberto = null;
    };
    const aplicar = (celId, val) => {
      // mesmas chaves de state e mesmos efeitos colaterais dos handlers antigos
      if (celId === 'ano') {
        window.__fel.anoSelecionado = val;
        const meses = listarMesesDisponiveis();
        const desseAno = meses.filter(m => m.startsWith(window.__fel.anoSelecionado));
        if (desseAno.length > 0) window.__fel.mesSelecionado = desseAno[0].split('-')[1];
        window.__fel.filtroFellow = '';
      } else if (celId === 'mes') {
        window.__fel.mesSelecionado = val;
        window.__fel.filtroFellow = '';
      } else if (celId === 'fellow' || celId === 'turno') {
        // V922: MULTI — alterna e mantém a lista aberta; "Todos" limpa
        const FM = Utilidades.filtroMulti;
        const campo = celId === 'fellow' ? 'filtroFellow' : 'filtroTurno';
        const buscaEl = sb.querySelector('[data-sb-busca]');
        window.__fel._sbBusca = buscaEl ? buscaEl.value : '';
        window.__fel[campo] = val === '' ? [] : FM.toggle(window.__fel[campo], val);
        renderizar();   // sbAberto continua — o painel re-abre marcado
        return;
      }
      window.__fel._sbBusca = '';
      window.__fel.sbAberto = null;
      renderizar();
    };
    const wireInputsPainel = () => {
      const busca = sb.querySelector('[data-sb-busca]');
      if (!busca) return;
      setTimeout(() => busca.focus(), 0);
      const filtrar = () => {
        const q = _felSbSemAcento(busca.value);
        const painel = busca.closest('.fel-sb-painel');
        let n = 0;
        painel.querySelectorAll('[data-sb-item]').forEach(el => {
          // V922: itens MARCADOS ficam sempre visíveis
          const mostra = el.classList.contains('fel-sb-it-todos') || el.classList.contains('sel') || !q || (el.dataset.busca || '').includes(q);
          el.style.display = mostra ? '' : 'none';
          if (mostra && !el.classList.contains('fel-sb-it-todos')) n++;
        });
        const cont = painel.querySelector('[data-sb-contagem]');
        if (cont) cont.textContent = `${n} opç${n === 1 ? 'ão' : 'ões'}`;
      };
      busca.addEventListener('input', filtrar);
      if (window.__fel._sbBusca) { busca.value = window.__fel._sbBusca; filtrar(); }   // V922
    };
    const abrirPainelLocal = (id) => {
      const jaAberto = window.__fel.sbAberto === id;
      fecharPainelLocal();
      window.__fel._sbBusca = '';   // V922: busca não vaza de um painel pro outro
      if (jaAberto) return;
      window.__fel.sbAberto = id;
      const btn = sb.querySelector(`[data-sb-cel="${id}"]`);
      btn.classList.add('aberta');
      btn.setAttribute('aria-expanded', 'true');
      btn.parentElement.insertAdjacentHTML('beforeend', painelFel20C(id));
      wireInputsPainel();
    };
    // V922: o painel pode vir aberto do template (re-render após marcar)
    if (window.__fel.sbAberto && sb.querySelector('.fel-sb-painel')) wireInputsPainel();
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
      if (!window.__fel.sbAberto) return;
      const painel = sb.querySelector('.fel-sb-painel');
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
    if (window.__felSbFechar) {
      document.removeEventListener('click', window.__felSbFechar);
      document.removeEventListener('keydown', window.__felSbEsc);
    }
    const fecharFora = (e) => {
      if (App.telaAtual !== 'desempenho-fellow') return;
      if (window.__fel && window.__fel.sbAberto && !e.target.closest('#fel-sb')) fecharPainelLocal();
    };
    const escFecha = (e) => { if (e.key === 'Escape' && window.__fel && window.__fel.sbAberto) fecharPainelLocal(); };
    window.__felSbFechar = fecharFora;
    window.__felSbEsc = escFecha;
    document.addEventListener('click', fecharFora);
    document.addEventListener('keydown', escFecha);
    if (window.__fel.sbAberto) wireInputsPainel();
  }

  // ──────────────────────────────────────────────────────────────────────
  // Filtros
  // ──────────────────────────────────────────────────────────────────────
  function renderFiltros(meses) {
    if (meses.length === 0) return '';

    const anosMap = new Map();
    for (const m of meses) {
      const [ano, mes] = m.split('-');
      if (!anosMap.has(ano)) anosMap.set(ano, []);
      anosMap.get(ano).push(mes);
    }
    const anos = Array.from(anosMap.keys()).sort().reverse();
    const anoAtual = window.__fel.anoSelecionado;
    const mesesDoAno = (anosMap.get(anoAtual) || []).slice().sort();

    const mes_ref = `${window.__fel.anoSelecionado}-${window.__fel.mesSelecionado}`;
    const fellowsDoMes = listarFellowsDoMes(mes_ref);
    const temFiltros = Utilidades.filtroMulti.ativo(window.__fel.filtroFellow)
      || Utilidades.filtroMulti.ativo(window.__fel.filtroTurno) || window.__fel.filtroNome;

    // V732: a peça 20C é IRMÃ do header, esticada de ponta a ponta; o botão
    // "✕ Limpar" fica compacto logo abaixo dela (align-self: flex-start)
    return `
      <div class="fel-filtros-bar">
        ${renderBarraFiltrosFel20C({ anos, mesesDoAno, fellows: fellowsDoMes })}
        ${temFiltros ? `<button class="btn btn-sm" id="fel-limpar-filtros">✕ Limpar</button>` : ''}
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Cards KPI
  // ──────────────────────────────────────────────────────────────────────
  function renderCards(k, kLM, kLY, kYTD, mes_ref) {
    function linhaComp(atual, lm, ly) {
      function p(v) {
        if (v === null || v === undefined || atual === undefined) return '<span class="fel-comp-vazio">—</span>';
        const diff = atual - v;
        const pct = v === 0 ? null : (diff / v) * 100;
        if (pct === null) return `<span class="fel-comp-vazio">—</span>`;
        const seta = pct > 0 ? '↑' : (pct < 0 ? '↓' : '=');
        const classe = pct > 0 ? 'fel-comp-pos' : (pct < 0 ? 'fel-comp-neg' : '');
        return `<span class="${classe}">${seta} ${Math.abs(pct).toFixed(1)}%</span>`;
      }
      return `<div class="fel-card-comp">vs LM ${p(lm)}  vs LY ${p(ly)}</div>`;   /* V726: rótulos completos */
    }

    const mediaAtend = k.linhas > 0 ? (k.total_atendim / k.linhas) : 0;

    return `
      <div class="fel-cards-grid">
        <!-- Card 1: Plantões -->
        <div class="fel-card fel-card-verde">
          <div class="fel-card-faixa"></div>
          <div class="fel-card-titulo">Plantões do Mês</div>
          <div class="fel-card-valor mono" data-ocultavel>${fmt(k.linhas)}</div>
          <div class="fel-card-breakdown">
            <div class="fel-bd-item">Fellows: <strong data-ocultavel>${k.fellows}</strong></div>
            <div class="fel-bd-item">Com refeição: <strong data-ocultavel>${k.plantoes_refeicao}</strong></div>
            ${k.plantoes_neg > 0 ? `<div class="fel-bd-item fel-bd-item-neg"><strong>${k.plantoes_neg}</strong> Sem complemento</div>` : ''}<!-- V967: número + texto em vermelho (era #993556 só no texto, número em #46688c) -->
            ${k.plantoes_manual > 0 ? `<div class="fel-bd-item" style="color:#8A6B0F"><strong>${k.plantoes_manual}</strong> manual</div>` : ''}
          </div>
          ${linhaComp(k.linhas, kLM?.linhas, kLY?.linhas)}
        </div>

        <!-- Card 2: YTD -->
        <div class="fel-card fel-card-roxo">
          <div class="fel-card-faixa"></div>
          <div class="fel-card-titulo">Plantões YTD</div>
          <div class="fel-card-valor mono" data-ocultavel>${fmt(kYTD?.linhas || 0)}</div>
          <div class="fel-card-sub">Total YTD: <strong data-ocultavel>R$ ${fmt(kYTD?.total_repassar || 0, 2)}</strong></div>
        </div>

        <!-- Card 3: Atendimentos -->
        <div class="fel-card fel-card-bege">
          <div class="fel-card-faixa"></div>
          <div class="fel-card-titulo">Atendimentos · Mês</div>
          <div class="fel-card-valor mono" data-ocultavel>${fmt(k.total_atendim)}</div>
          <div class="fel-card-sub">Média / plantão: <strong data-ocultavel>${mediaAtend.toFixed(1)}</strong></div>
          ${linhaComp(k.total_atendim, kLM?.total_atendim, kLY?.total_atendim)}
        </div>

        <!-- Card 4: Total destaque -->
        <div class="fel-card fel-card-destaque">
          <div class="fel-card-titulo">Total a Pagar · Mês</div>
          <div class="fel-card-valor mono" data-ocultavel>R$ ${fmt(k.total_repassar, 2)}</div>
          <!-- V736/V737: nomes completos, valores em negrito e Refeição
               EMPILHADA abaixo de Complemento -->
          <div class="fel-card-sub">Complemento: <strong data-ocultavel>R$ ${fmt(k.total_complem, 2)}</strong></div>
          <div class="fel-card-sub">Refeição: <strong data-ocultavel>R$ ${fmt(k.total_refeicao, 2)}</strong></div>
          ${linhaComp(k.total_repassar, kLM?.total_repassar, kLY?.total_repassar)}
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Tabela
  // ──────────────────────────────────────────────────────────────────────
  function renderTabela(linhas, mes_ref, cfgCols) {
    const cols = cfgCols.filter(c => c.visivel);

    if (linhas.length === 0) {
      return `
        <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 24px">
          <div style="color: var(--ink-faint); font-size: 13px">
            Nenhum plantão encontrado com os filtros atuais.
          </div>
        </div>
      `;
    }

    // ── Mapa de ofuscação (modo FOCO) ───────────────────────────────────
    const modoExib = Utilidades.modoExibicao();
    const focoNorm = modoExib === 'foco' ? Utilidades.medicoFoco() : null;
    const mapaOfuscado = new Map();
    if (modoExib === 'foco') {
      let i = 0;
      for (const l of linhas) {
        if (l.fellow_norm === focoNorm) continue;
        if (!mapaOfuscado.has(l.fellow_norm)) {
          mapaOfuscado.set(l.fellow_norm, `Fellow ${letraOfuscacao(i++)}`);
        }
      }
    }
    function mascararLinha(l) {
      return modoExib === 'foco' && l.fellow_norm !== focoNorm;
    }
    function nomeFellowExibido(l) {
      if (mascararLinha(l)) return mapaOfuscado.get(l.fellow_norm) || 'Fellow ?';
      return l.fellow_nome;
    }

    // Agrupa por fellow (usa o nome exibido para que o grupo apareça ofuscado também)
    const porFellow = new Map();
    for (const l of linhas) {
      const key = nomeFellowExibido(l);
      if (!porFellow.has(key)) porFellow.set(key, { linhas: [], mascarado: mascararLinha(l) });
      porFellow.get(key).linhas.push(l);
    }

    const totalAtend = linhas.reduce((s, l) => s + (l.qtd_atendim || 0), 0);
    const totalComplem = linhas.reduce((s, l) => s + valorComplemEfetivo(l), 0);
    const totalRefeicao = linhas.reduce((s, l) => s + (l.refeicao || 0), 0);
    const totalRepassar = linhas.reduce((s, l) => s + totalEfetivo(l), 0);

    const totalCols = cols.length + 1;  // +1 ações

    function classeLinha(l) {
      const fds = (l.dia_semana === 0 || l.dia_semana === 6);
      const semCompl = estaSemComplemento(l);
      const manual = temManual(l);
      let cls = '';
      if (fds) cls += ' fel-linha-fds';
      if (semCompl) cls += ' fel-linha-neg';   // ainda usa o fundo rosa de aviso
      if (manual) cls += ' fel-linha-manual';  // fundo bege/dourado pra manual
      if (mascararLinha(l)) cls += ' fel-linha-mascarada';
      return cls.trim();
    }

    function renderTr(l) {
      const mask = mascararLinha(l);
      const attr = mask ? 'data-mascarar data-ocultavel' : 'data-ocultavel';
      const semCompl = estaSemComplemento(l);
      const manual = temManual(l);
      const vEfetivo = valorComplemEfetivo(l);
      const tEfetivo = totalEfetivo(l);
      const tds = cols.map(c => {
        if (c.id === 'data') {
          return `<td class="mono"><span class="fel-data-dow">${DOW_LABEL[l.dia_semana]}</span> ${formatarDataCurta(l.data_plantao)}</td>`;
        }
        if (c.id === 'fellow')        return `<td>${mask ? `<span class="fel-fellow-ofuscado">${escapeHTML(nomeFellowExibido(l))}</span>` : escapeHTML(CodigoMedico.exibir(l.fellow_nome))}</td>`;
        if (c.id === 'turno')         return `<td><span class="fel-turno-tag fel-turno-${l.turno.toLowerCase()}">${escapeHTML(TURNO_LABEL[l.turno] || l.turno)}</span></td>`;
        if (c.id === 'qtd_atendim')   return `<td class="num mono" ${attr}>${l.qtd_atendim}</td>`;
        if (c.id === 'qtd_complem')   {
          if (manual)      return `<td class="num mono fel-tag-manual-cell" ${attr} title="Override manual">manual</td>`;
          if (semCompl)    return `<td class="num mono" ${attr}>0</td>`;   /* V735: era "—" */
          return `<td class="num mono" ${attr}>${l.qtd_complem}</td>`;
        }
        if (c.id === 'valor_complem') {
          if (manual)      return `<td class="num mono fel-val-manual" ${attr} title="Override manual">R$ ${fmt(vEfetivo, 2)} <span class="fel-tag-manual">manual</span></td>`;
          if (semCompl)    return `<td class="num fel-sem-compl" ${attr}>Sem complemento</td>`;
          return `<td class="num mono" ${attr}>R$ ${fmt(l.valor_complem, 2)}</td>`;
        }
        if (c.id === 'refeicao')      return `<td class="num mono" ${attr}>R$ ${fmt(l.refeicao > 0 ? l.refeicao : 0, 2)}</td>`;   /* V735: era "—" quando 0 */
        if (c.id === 'total_repassar') {
          return `<td class="num mono atlas-rep" ${attr}>R$ ${fmt(tEfetivo, 2)}</td>`;   /* V735 · V962: valor de repasse em #46688c */
        }
        return '<td></td>';
      }).join('');
      const acoes = mask
        ? `<td class="fel-acoes-cell"></td>`
        : `<td class="fel-acoes-cell">
            <button class="fel-btn-acao" data-acao="editar" data-id="${l.id}" title="Editar plantão">✏</button>
            <button class="fel-btn-acao fel-btn-danger" data-acao="excluir" data-id="${l.id}" title="Excluir plantão">🗑</button>
          </td>`;
      return `<tr class="${classeLinha(l)}">${tds}${acoes}</tr>`;
    }

    function renderGrupo(fellowExibido, info) {
      const linhasFellow = info.linhas;
      const grupoMascarado = info.mascarado;
      const colapsado = window.__fel.fellowsColapsados.has(fellowExibido);
      const seta = colapsado ? '▶' : '▼';
      const sumAtend = linhasFellow.reduce((s, l) => s + (l.qtd_atendim || 0), 0);
      const sumComplem = linhasFellow.reduce((s, l) => s + valorComplemEfetivo(l), 0);
      const sumRefeicao = linhasFellow.reduce((s, l) => s + (l.refeicao || 0), 0);
      const sumTotal = linhasFellow.reduce((s, l) => s + totalEfetivo(l), 0);
      const attr = grupoMascarado ? 'data-mascarar data-ocultavel' : 'data-ocultavel';

      /* V735: valores do subtotal em #3f6489 (rótulo "Subtotal" fica na cor
         padrão); saiu o ícone "↳" */
      const tdsSub = cols.map(c => {
        if (c.id === 'data')           return `<td style="font-weight: 600">Subtotal</td>`;
        if (c.id === 'qtd_atendim')    return `<td class="num mono" ${attr} style="font-weight: 700; color: #3f6489">${sumAtend}</td>`;
        if (c.id === 'valor_complem')  return `<td class="num mono" ${attr} style="font-weight: 700; color: #3f6489">R$ ${fmt(sumComplem, 2)}</td>`;
        if (c.id === 'refeicao')       return `<td class="num mono" ${attr} style="font-weight: 700; color: #3f6489">R$ ${fmt(sumRefeicao, 2)}</td>`;
        if (c.id === 'total_repassar') return `<td class="num mono atlas-rep" ${attr}>R$ ${fmt(sumTotal, 2)}</td>`;   /* V962 */
        return '<td></td>';
      }).join('');

      return `
        <tr class="fel-grupo-header" data-fellow="${escapeAttr(fellowExibido)}">
          <td colspan="${totalCols}">
            <span class="fel-grupo-icone">${seta}</span>
            ${grupoMascarado ? `<span class="fel-fellow-ofuscado">${escapeHTML(fellowExibido)}</span>` : escapeHTML(fellowExibido)}
            <button class="fel-grupo-add" data-add-fellow="${escapeAttr(linhasFellow[0] ? linhasFellow[0].fellow_nome : '')}" title="Adicionar dia para este fellow"><span class="fel-add-mais">+</span> dia</button>
            <span class="fel-grupo-info">
              <span ${attr}>${linhasFellow.length}</span> plant${linhasFellow.length !== 1 ? 'ões' : 'ão'}
              · <span ${attr}>${sumAtend}</span> atend.
              · <strong ${attr}>R$ ${fmt(sumTotal, 2)}</strong>
            </span>
          </td>
        </tr>
        ${colapsado ? '' : linhasFellow.map(renderTr).join('')}
        ${colapsado ? '' : `<tr class="fel-subtotal">${tdsSub}<td></td></tr>`}
      `;
    }

    // V728: a linha "TOTAL / mês" no fim da matriz SAIU (os cards
    // totalizadores já cumprem o papel); os SUBTOTAIS por fellow ficam.
    // No Excel exportado o TOTAL continua (lá não há cards).

    const ths = cols.map(c => {
      const alinh = ['qtd_atendim','qtd_complem','valor_complem','refeicao','total_repassar'].includes(c.id) ? 'num' : '';
      return `<th class="${alinh}">${escapeHTML(c.label)}</th>`;
    }).join('') + '<th class="fel-acoes-col"></th>';

    // Banner do modo foco
    const banner = (modoExib === 'foco' && focoNorm) ? `
      <div class="fel-foco-banner">
        <span>🎯 <strong>Modo apresentação ativo</strong> · Mostrando dados de <strong>${escapeHTML(buscarNomeOriginalFellow(focoNorm) || '—')}</strong>. Demais fellows aparecem como "Fellow A/B/C...".</span>
        <button class="btn-compact" id="btn-fel-sair-foco">✕ Sair do modo foco</button>
      </div>
    ` : '';

    return `
      ${banner}
      <div class="fel-tabela-card">
        <table class="fel-tabela">
          <thead><tr>${ths}</tr></thead>
          <tbody>
            ${Array.from(porFellow.entries())
              .map(([f, info]) => renderGrupo(f, info))
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Snapshots
  // ──────────────────────────────────────────────────────────────────────
  function renderSnapshots(meses) {
    let snapshots = [];
    try {
      snapshots = Banco.query(`
        SELECT mes_ref,
               COUNT(*) AS linhas,
               COUNT(DISTINCT fellow_norm) AS fellows,
               SUM(qtd_atendim) AS total_atendim,
               SUM(valor_complem) AS total_complem,
               SUM(refeicao) AS total_refeicao,
               SUM(total_repassar) AS total_repassar,
               MAX(importado_em) AS ultima_importacao
        FROM fellow_linhas
        GROUP BY mes_ref
        ORDER BY mes_ref DESC
      `);
    } catch (e) { return ''; }

    const cfg = lerConfig();
    const qtdCadastrados = (() => {
      try { return Banco.queryUnica(`SELECT COUNT(*) AS n FROM fellow_cadastro WHERE ativo = 1`)?.n || 0; }
      catch (e) { return 0; }
    })();

    return `
      <div class="fel-snapshots">
        <div class="fel-snapshots-header">
          <span>📂 SNAPSHOTS IMPORTADOS</span>
          <span class="fel-snapshots-sub">
            Meta: <strong class="mono">${cfg.meta}</strong>
            · R$/atend: <strong class="mono">R$ ${fmt(cfg.valor_atend, 2)}</strong>
            · Refeição: <strong class="mono">R$ ${fmt(cfg.valor_refeicao, 2)}</strong>
            · <strong class="mono">${qtdCadastrados}</strong> fellows cadastrados
          </span>
        </div>

        <div class="fel-snapshots-grid">
          ${snapshots.map(s => `
            <div class="fel-snap-card">
              <div class="fel-snap-cabec">
                <span class="fel-snap-mes">${formatarMesLabel(s.mes_ref)}</span>
                <button class="fel-snap-acao" data-acao="excluir-snap" data-mes="${s.mes_ref}" title="Excluir todos os plantões deste mês">🗑</button>
              </div>
              <div class="fel-snap-detalhe">
                <div><strong data-ocultavel>${s.linhas}</strong> plantões · <strong data-ocultavel>${s.fellows}</strong> fellows</div>
                <div><span data-ocultavel>${fmt(s.total_atendim)}</span> atend. · <strong data-ocultavel>R$ ${fmt(s.total_repassar, 2)}</strong></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Popover Colunas
  // ──────────────────────────────────────────────────────────────────────
  function renderPopoverOcultar(cfgCols) {
    return `
      <div class="fel-popover">
        <div class="fel-popover-titulo">Mostrar/Ocultar Colunas</div>
        ${cfgCols.map(c => `
          <label class="fel-popover-item">
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
    // V732: fileira de filtros 20C (Ano/Mês/Fellow/Turno viraram células)
    bindBarraFiltrosFel20C();

    const btnLimpar = document.getElementById('fel-limpar-filtros');
    if (btnLimpar) btnLimpar.addEventListener('click', () => {
      window.__fel.filtroFellow = '';
      window.__fel.filtroTurno = '';
      window.__fel.filtroNome = '';
      renderizar();
    });

    const btnCols = document.getElementById('btn-fel-colunas');
    if (btnCols) btnCols.addEventListener('click', () => {
      window.__fel.ocultarAberto = !window.__fel.ocultarAberto;
      window.__fel.menuVisaoAberto = false;
      renderizar();
    });

    // ⓘ Botão Info (V128.4)
    const btnFelInfo = document.getElementById('fel-btn-info');
    if (btnFelInfo) btnFelInfo.addEventListener('click', () => {
      window.__fel.infoAberto = !window.__fel.infoAberto;
      renderizar();
    });
    const btnFelInfoClose = document.getElementById('fel-info-close');
    if (btnFelInfoClose) btnFelInfoClose.addEventListener('click', () => {
      window.__fel.infoAberto = false;
      renderizar();
    });

    // Botão dropdown "Visualização"
    const btnVisao = document.getElementById('btn-fel-visualizacao');
    if (btnVisao) {
      btnVisao.addEventListener('click', (e) => {
        e.stopPropagation();
        window.__fel.menuVisaoAberto = !window.__fel.menuVisaoAberto;
        window.__fel.ocultarAberto = false;
        renderizar();
      });
    }
    document.querySelectorAll('#fel-menu-visao .fel-menu-item').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const modo = b.dataset.modo;
        Utilidades.setModoExibicao(modo);
        window.__fel.menuVisaoAberto = false;
        renderizar();
      });
    });
    const focoSel = document.getElementById('fel-foco-select');
    if (focoSel) {
      focoSel.addEventListener('change', (e) => {
        e.stopPropagation();
        const norm = focoSel.value;
        if (norm) {
          Utilidades.setModoExibicao('foco', norm);
        } else {
          Utilidades.setModoExibicao('tudo');
        }
        window.__fel.menuVisaoAberto = false;
        renderizar();
      });
      const menuEl = document.getElementById('fel-menu-visao');
      if (menuEl) menuEl.addEventListener('click', (e) => e.stopPropagation());
    }
    if (window.__fel.menuVisaoAberto) {
      const fecharFora = (e) => {
        if (!e.target.closest('#fel-menu-visao') && !e.target.closest('#btn-fel-visualizacao')) {
          window.__fel.menuVisaoAberto = false;
          document.removeEventListener('click', fecharFora);
          renderizar();
        }
      };
      setTimeout(() => document.addEventListener('click', fecharFora), 0);
    }
    const btnSairFoco = document.getElementById('btn-fel-sair-foco');
    if (btnSairFoco) btnSairFoco.addEventListener('click', () => {
      Utilidades.setModoExibicao('tudo');
      renderizar();
    });

    // V725: menu padrão da ferramenta (Matriz completa · Por Fellow · Por
    // Turno · Por Competência)
    const btnExp = document.getElementById('btn-fel-exportar');
    if (btnExp) btnExp.addEventListener('click', () => abrirMenuExportarFellow(btnExp));

    // V725: "Ajuste de Matriz" — renomear os títulos das colunas
    const btnAjM = document.getElementById('btn-fel-ajuste-matriz');
    if (btnAjM) btnAjM.addEventListener('click', abrirAjusteMatrizFellow);

    const btnImp = document.getElementById('btn-fel-importar');
    if (btnImp) btnImp.addEventListener('click', () => {
      window.ImportFellow.abrirModal(() => renderizar());
    });
    const btnImpVazio = document.getElementById('btn-fel-importar-vazio');
    if (btnImpVazio) btnImpVazio.addEventListener('click', () => {
      window.ImportFellow.abrirModal(() => renderizar());
    });

    document.querySelectorAll('[data-acao="excluir-snap"]').forEach(b => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const mes = b.dataset.mes;
        window.ImportFellow.excluirMes(mes, () => {
          const mesAtivo = `${window.__fel.anoSelecionado}-${window.__fel.mesSelecionado}`;
          if (mesAtivo === mes) {
            window.__fel.anoSelecionado = null;
            window.__fel.mesSelecionado = null;
          }
          renderizar();
        });
      });
    });

    // ───────── Popover "Mostrar/Ocultar Colunas" montado no <body> ─────────
    // (padrão V362/V363 do Produção Médica). O popover NÃO fica mais no #conteudo:
    // o decorador do hub observa o #conteudo, remexe no DOM ao remontar o globo e
    // "soltava"/removia o popover — era por isso que SUMIA ao clicar num checkbox.
    // Montado direto no <body> (fora do alcance do decorador) e posicionado FIXED,
    // colado embaixo do botão COLUNAS (item do leque) que o abriu.

    // (1) Captura, em CAPTURE-PHASE, o rect do COLUNAS REALMENTE clicado (e.isTrusted)
    //     — inclusive o item do leque do globo (.hub-it, que some ao fechar o radial).
    if (!window.__felColAnchorCap) {
      window.__felColAnchorCap = true;
      document.addEventListener('click', (e) => {
        if (!e.isTrusted) return;
        let a = e.target.closest('#btn-fel-colunas');
        if (!a) {
          const it = e.target.closest('.hub-it');
          if (it && (it.textContent || '').toLowerCase().includes('coluna')) a = it;
        }
        if (!a) return;
        const r = a.getBoundingClientRect();
        if (r.width) window.__felColAnchor = { left: r.left, bottom: r.bottom };
      }, true);
    }
    // (2) Fecha o popover ao clicar FORA dele (clicar DENTRO — num checkbox — não fecha).
    if (!window.__felColFechaFora) {
      window.__felColFechaFora = true;
      document.addEventListener('click', (e) => {
        if (!window.__fel || !window.__fel.ocultarAberto) return;
        if (e.target.closest('#fel-pop-colunas') || e.target.closest('#btn-fel-colunas')
            || e.target.closest('.hub-it') || e.target.closest('#atlas-hub')) return;
        window.__fel.ocultarAberto = false;
        const fl = document.getElementById('fel-pop-colunas'); if (fl) fl.remove();
        renderizar();
      });
    }
    // (3) Posiciona o popover (FIXED) colado embaixo do COLUNAS, com clamp na viewport.
    function posicionarColPop() {
      const pop = document.getElementById('fel-pop-colunas');
      if (!pop) return;
      let a = window.__felColAnchor;
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
      const old = document.getElementById('fel-pop-colunas');
      if (old) old.remove();
      if (!window.__fel.ocultarAberto) return;
      const cfgC = window.__fel.configColunas || carregarConfigColunas();
      const tmp = document.createElement('div');
      tmp.innerHTML = renderPopoverOcultar(cfgC);
      const pop = tmp.firstElementChild;
      if (!pop) return;
      pop.id = 'fel-pop-colunas';
      pop.style.position = 'fixed';
      pop.style.zIndex = '9999';
      document.body.appendChild(pop);
      posicionarColPop();
      pop.querySelectorAll('.fel-popover-item input').forEach(cb => {
        cb.addEventListener('change', () => {
          const colId = cb.dataset.col;
          const cfg = window.__fel.configColunas;
          const col = cfg.find(c => c.id === colId);
          if (col) {
            col.visivel = cb.checked;
            salvarConfigColunas(cfg);
            renderizar();   // re-renderiza a tabela; montarColPopFlutuante re-cria o popover (segue aberto)
          }
        });
      });
    }
    if (!window.__felColRepos) {
      window.__felColRepos = true;
      // V492: listeners globais permanentes — só reposiciona quando a tela Fellow
      // está ativa E o popover de colunas está aberto/montado (senão retorna sem ler layout)
      const reposicionarSeAtivo = () => {
        if (App.telaAtual !== 'desempenho-fellow') return;
        if (!window.__fel || !window.__fel.ocultarAberto) return;
        if (!document.getElementById('fel-pop-colunas')) return;
        posicionarColPop();
      };
      window.addEventListener('scroll', reposicionarSeAtivo, true);
      window.addEventListener('resize', reposicionarSeAtivo);
    }
    montarColPopFlutuante();

    document.querySelectorAll('.fel-grupo-header').forEach(tr => {
      tr.addEventListener('click', () => {
        const fellow = tr.dataset.fellow;
        if (!fellow) return;
        if (window.__fel.fellowsColapsados.has(fellow)) {
          window.__fel.fellowsColapsados.delete(fellow);
        } else {
          window.__fel.fellowsColapsados.add(fellow);
        }
        renderizar();
      });
    });

    document.querySelectorAll('[data-add-fellow]').forEach(b => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        abrirModalEdicao(null, b.dataset.addFellow || '');
      });
    });

    document.querySelectorAll('[data-acao="editar"]').forEach(b => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = parseInt(b.dataset.id, 10);
        abrirModalEdicao(id);
      });
    });

    document.querySelectorAll('[data-acao="excluir"]').forEach(b => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = parseInt(b.dataset.id, 10);
        const linha = Banco.queryUnica(
          `SELECT fellow_nome, data_plantao, turno FROM fellow_linhas WHERE id = ?`, [id]
        );
        if (!linha) return;
        if (!confirm(`Excluir o plantão de ${linha.fellow_nome} em ${formatarDataLonga(linha.data_plantao)} (${TURNO_LABEL[linha.turno] || linha.turno})?`)) return;

        const stmt = Banco.db.prepare(`DELETE FROM fellow_linhas WHERE id = ?`);
        try { stmt.run([id]); } finally { stmt.free(); }
        Banco.salvar().then(() => {
          Utilidades.toast('Plantão excluído', 'success');
          renderizar();
        });
      });
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Modal de Edição
  // ──────────────────────────────────────────────────────────────────────
  function abrirModalEdicao(id, fellowPre) {
    const novo = (id === null || id === undefined);
    let linha;
    if (novo) {
      if (!window.__fel.anoSelecionado || !window.__fel.mesSelecionado) {
        Utilidades.toast('Selecione um mês primeiro', 'warning'); return;
      }
      const cfg = lerConfig();
      const mes_ref = `${window.__fel.anoSelecionado}-${window.__fel.mesSelecionado}`;
      linha = {
        id: null, mes_ref,
        data_plantao: `${mes_ref}-01`,
        fellow_nome: fellowPre || '', fellow_id: null, turno: 'MANHA',
        qtd_atendim: 0, meta: cfg.meta, valor_atendim: cfg.valor_atend, valor_refeicao: cfg.valor_refeicao,
        valor_complem_manual: null,
      };
    } else {
      linha = Banco.queryUnica(`
        SELECT id, mes_ref, data_plantao, fellow_nome, fellow_id, turno,
               qtd_atendim, meta, valor_atendim, valor_refeicao,
               valor_complem_manual
        FROM fellow_linhas WHERE id = ?
      `, [id]);
      if (!linha) { Utilidades.toast('Plantão não encontrado', 'error'); return; }
    }

    const fellowsCadastrados = listarFellowsCadastrados();
    const optionsFellows = (novo ? `<option value="">— selecione —</option>` : '') + fellowsCadastrados.map(f =>
      `<option value="${escapeAttr(f.nome_original)}" data-id="${f.id}" ${f.nome_original === linha.fellow_nome ? 'selected' : ''}>${escapeHTML(f.nome_original)}</option>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'fel-edit-modal-overlay';
    overlay.innerHTML = `
      <div class="fel-edit-modal">
        <div class="fel-edit-header">
          <span>${novo ? '➕ Adicionar Plantão' : '✏ Editar Plantão'} · ${formatarMesLabel(linha.mes_ref)}</span>
          <button class="fel-edit-fechar" type="button">✕</button>
        </div>
        <div class="fel-edit-body">
          <div class="fel-edit-form">
            <div class="fel-edit-campo">
              <label>Data</label>
              <input type="date" id="fel-edit-data" value="${linha.data_plantao}">
              <small id="fel-edit-data-info" style="color: var(--ink-faint); font-size: 11px"></small>
            </div>
            <div class="fel-edit-campo">
              <label>Fellow</label>
              <select id="fel-edit-fellow">${optionsFellows}</select>
            </div>
            <div class="fel-edit-campo">
              <label>Turno</label>
              <select id="fel-edit-turno">
                <option value="MANHA"   ${linha.turno === 'MANHA'   ? 'selected' : ''}>Manhã</option>
                <option value="TARDE"   ${linha.turno === 'TARDE'   ? 'selected' : ''}>Tarde</option>
                <option value="NOTURNO" ${linha.turno === 'NOTURNO' ? 'selected' : ''}>Noturno</option>
                <option value="DIA"     ${linha.turno === 'DIA'     ? 'selected' : ''}>Dia (sem turno)</option>
              </select>
            </div>
            <div class="fel-edit-campo">
              <label>QTD Atendimento</label>
              <input type="number" id="fel-edit-qtd" value="${linha.qtd_atendim}" min="0" max="99">
            </div>
            <div class="fel-edit-preview" id="fel-edit-preview">
              <div class="fel-edit-preview-label">Cálculo automático (Meta = <span class="mono">${linha.meta}</span> · R$/atend = <span class="mono">R$ ${fmt(linha.valor_atendim, 2)}</span> · Refeição = <span class="mono">R$ ${fmt(linha.valor_refeicao, 2)}</span>)</div>
              <div class="fel-edit-preview-detalhes">
                <span>QTD Complem.: <strong id="fel-edit-tot-compl">0</strong></span>
                <span>Valor Complem.: <strong id="fel-edit-tot-vcompl">R$ 0,00</strong></span>
                <span>Refeição: <strong id="fel-edit-tot-ref">R$ 0,00</strong></span>
              </div>
              <div id="fel-edit-aviso-sem-compl" class="fel-edit-aviso-sem" style="display: none">
                ⚠ Atendeu acima da meta — sem complemento automático
              </div>
            </div>

            <div class="fel-edit-campo fel-edit-campo-manual">
              <label>
                Complemento manual <span style="font-weight: 400; color: var(--ink-faint)">(opcional — sobrescreve o automático)</span>
              </label>
              <div class="fel-edit-manual-wrap">
                <span class="fel-edit-manual-rs">R$</span>
                <input type="number" step="0.01" id="fel-edit-manual" value="${linha.valor_complem_manual != null ? linha.valor_complem_manual : ''}" placeholder="deixe vazio para usar o automático">
                <button type="button" class="fel-edit-manual-limpar" id="fel-edit-manual-limpar" title="Remover override">✕</button>
              </div>
              <small class="fel-edit-manual-help">Útil para bonificações ou ajustes pontuais que não vêm da planilha.</small>
            </div>

            <div class="fel-edit-preview-total fel-edit-total-final">
              <span class="fel-edit-total-label">Total efetivo a Repassar:</span>
              <strong id="fel-edit-tot-total">R$ 0,00</strong>
            </div>
          </div>
        </div>
        <div class="fel-edit-footer">
          <button class="btn" id="fel-edit-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="fel-edit-salvar">${novo ? '✓ Adicionar' : '✓ Salvar Alterações'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Preview ao vivo
    function calcular() {
      const dataStr = document.getElementById('fel-edit-data').value;
      const turno = document.getElementById('fel-edit-turno').value;
      const qtd = parseInt(document.getElementById('fel-edit-qtd').value) || 0;
      const manualRaw = document.getElementById('fel-edit-manual').value.trim();
      const manualVal = manualRaw === '' ? null : parseFloat(manualRaw);
      const temMan = manualVal !== null && !isNaN(manualVal);
      const meta = linha.meta;
      const vatend = linha.valor_atendim;
      const vref = linha.valor_refeicao;

      let dow = 0;
      let dataValida = false;
      if (dataStr) {
        const [a, m, d] = dataStr.split('-').map(Number);
        const dt = new Date(a, m - 1, d);
        if (!isNaN(dt.getTime())) {
          dow = dt.getDay();
          dataValida = true;
        }
      }

      const qtdComplem = meta - qtd;                                    // pode ser negativo
      const valorComplemAuto = qtdComplem * vatend;                     // automático (pode ser negativo)
      const refeicao = (turno === 'NOTURNO' || dow === 0 || dow === 6) ? vref : 0;

      // Mostra o cálculo automático
      document.getElementById('fel-edit-tot-compl').textContent = qtdComplem;
      document.getElementById('fel-edit-tot-vcompl').textContent = `R$ ${fmt(valorComplemAuto, 2)}`;
      document.getElementById('fel-edit-tot-ref').textContent = `R$ ${fmt(refeicao, 2)}`;
      document.getElementById('fel-edit-tot-compl').className = qtdComplem < 0 ? 'fel-val-neg' : '';
      document.getElementById('fel-edit-tot-vcompl').className = valorComplemAuto < 0 ? 'fel-val-neg' : '';

      // Aviso "sem complemento"
      const avisoSem = document.getElementById('fel-edit-aviso-sem-compl');
      if (avisoSem) avisoSem.style.display = (qtdComplem < 0 && !temMan) ? 'block' : 'none';

      // Valor efetivo do complemento
      let valorComplemEf;
      if (temMan)                  valorComplemEf = manualVal;
      else if (qtdComplem < 0)     valorComplemEf = 0;          // "sem complemento"
      else                         valorComplemEf = valorComplemAuto;

      const totalEf = valorComplemEf + refeicao;
      const totalEl = document.getElementById('fel-edit-tot-total');
      totalEl.textContent = `R$ ${fmt(totalEf, 2)}`;
      totalEl.className = temMan ? 'fel-val-manual' : '';

      // info do dia da semana
      const info = document.getElementById('fel-edit-data-info');
      if (dataValida) {
        const [aa, mm] = linha.mes_ref.split('-').map(Number);
        const [a, m] = dataStr.split('-').map(Number);
        const foraDoMes = (a !== aa || m !== mm);
        info.textContent = `${DOW_LABEL[dow]}` + (foraDoMes ? ` ⚠ data fora do mês ${formatarMesLabel(linha.mes_ref)}` : '');
        info.style.color = foraDoMes ? '#993556' : 'var(--ink-faint)';
      } else {
        info.textContent = '';
      }
    }
    overlay.querySelectorAll('input, select').forEach(i => i.addEventListener('input', calcular));
    overlay.querySelectorAll('input, select').forEach(i => i.addEventListener('change', calcular));
    calcular();

    const fechar = () => overlay.remove();
    overlay.querySelector('.fel-edit-fechar').addEventListener('click', fechar);
    overlay.querySelector('#fel-edit-cancelar').addEventListener('click', fechar);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });

    // Botão "limpar manual" — reseta o input pra automático
    overlay.querySelector('#fel-edit-manual-limpar').addEventListener('click', () => {
      document.getElementById('fel-edit-manual').value = '';
      calcular();
    });

    overlay.querySelector('#fel-edit-salvar').addEventListener('click', async () => {
      const dataStr = document.getElementById('fel-edit-data').value;
      const selFel = document.getElementById('fel-edit-fellow');
      const novoFellow = selFel.value;
      const novoFellowId = parseInt(selFel.options[selFel.selectedIndex]?.dataset?.id, 10) || null;
      const turno = document.getElementById('fel-edit-turno').value;
      const qtd = parseInt(document.getElementById('fel-edit-qtd').value) || 0;
      const manualRaw = document.getElementById('fel-edit-manual').value.trim();
      const manualVal = manualRaw === '' ? null : parseFloat(manualRaw);

      if (!dataStr) { Utilidades.toast('Data é obrigatória', 'error'); return; }
      if (!novoFellow) { Utilidades.toast('Fellow é obrigatório', 'error'); return; }
      if (!turno) { Utilidades.toast('Turno é obrigatório', 'error'); return; }
      if (manualRaw !== '' && (manualVal === null || isNaN(manualVal))) {
        Utilidades.toast('Complemento manual: valor inválido', 'error'); return;
      }

      const [a, m, d] = dataStr.split('-').map(Number);
      const dt = new Date(a, m - 1, d);
      if (isNaN(dt.getTime())) { Utilidades.toast('Data inválida', 'error'); return; }
      const dow = dt.getDay();

      const novoMesRef = `${a}-${String(m).padStart(2, '0')}`;
      if (!novo && novoMesRef !== linha.mes_ref) {
        if (!confirm(`A data ${formatarDataLonga(dataStr)} está fora do mês ${formatarMesLabel(linha.mes_ref)}.\n\nMover este plantão para ${formatarMesLabel(novoMesRef)}?`)) return;
      }

      const meta = linha.meta;
      const vatend = linha.valor_atendim;
      const vref = linha.valor_refeicao;
      const qtdComplem = meta - qtd;                       // pode ser negativo (preservado)
      const valorComplem = qtdComplem * vatend;            // automático
      const refeicao = (turno === 'NOTURNO' || dow === 0 || dow === 6) ? vref : 0;
      // total_repassar reflete o EFETIVO (com manual ou sem complemento aplicados)
      let valorComplemEf;
      if (manualVal !== null && !isNaN(manualVal)) valorComplemEf = manualVal;
      else if (qtdComplem < 0)                     valorComplemEf = 0;
      else                                          valorComplemEf = valorComplem;
      const total = valorComplemEf + refeicao;
      const fellowNorm = normalizar(novoFellow);

      try {
        if (novo) {
          const stmt = Banco.db.prepare(`
            INSERT INTO fellow_linhas (
              mes_ref, data_plantao, fellow_nome, fellow_norm, fellow_id, turno,
              qtd_atendim, meta, valor_atendim, valor_refeicao,
              qtd_complem, valor_complem, valor_complem_manual, refeicao, total_repassar,
              dia_semana, origem
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
          `);
          try {
            stmt.run([
              novoMesRef, dataStr, novoFellow, fellowNorm, novoFellowId, turno,
              qtd, meta, vatend, vref,
              qtdComplem, valorComplem, manualVal, refeicao, total,
              dow,
            ]);
          } finally { stmt.free(); }
        } else {
          const stmt = Banco.db.prepare(`
            UPDATE fellow_linhas SET
              mes_ref = ?, data_plantao = ?,
              fellow_nome = ?, fellow_norm = ?, fellow_id = ?,
              turno = ?,
              qtd_atendim = ?, qtd_complem = ?,
              valor_complem = ?, valor_complem_manual = ?,
              refeicao = ?, total_repassar = ?,
              dia_semana = ?
            WHERE id = ?
          `);
          try {
            stmt.run([
              novoMesRef, dataStr,
              novoFellow, fellowNorm, novoFellowId,
              turno,
              qtd, qtdComplem,
              valorComplem, manualVal,
              refeicao, total,
              dow,
              id,
            ]);
          } finally { stmt.free(); }
        }
        await Banco.salvar();
        Utilidades.toast(novo ? '✓ Plantão adicionado' : '✓ Plantão atualizado', 'success');
        fechar();
        renderizar();
      } catch (e) {
        console.error(e);
        if (String(e).includes('UNIQUE')) {
          alert('❌ Já existe outro plantão com essa Data + Fellow + Turno neste mês.');
        } else {
          alert(`❌ Erro ao salvar:\n\n${e.message}`);
        }
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Exportar Excel
  // ──────────────────────────────────────────────────────────────────────
  // ── V725/V728 (solicitação usuário Matheus): AJUSTE DE MATRIZ ───────────
  // Modal ÚNICO (montado no <body>, fora do alcance do decorador do hub) que
  // absorveu o antigo "⋮ Colunas": por coluna, o checkbox MOSTRAR/OCULTAR e o
  // campo de RENOMEAR o título. Persiste na config das colunas (localStorage)
  // e vale também pro cabeçalho do Excel exportado.
  function abrirAjusteMatrizFellow() {
    document.getElementById('fel-ajuste-matriz-pop')?.remove();
    const cfg = window.__fel.configColunas || carregarConfigColunas();
    const pop = document.createElement('div');
    pop.id = 'fel-ajuste-matriz-pop';
    pop.className = 'fel-ajm-fundo';
    pop.innerHTML = `
      <div class="fel-ajm-box" role="dialog" aria-modal="true">
        <h4>🛠 Ajuste de Matriz</h4>
        <p>Marque quais colunas aparecem e renomeie os títulos. Os nomes valem também pro cabeçalho do Excel exportado.</p>
        <div class="fel-ajm-head"><span></span><span class="fel-ajm-orig">Nome padrão</span><span style="flex:1; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color: var(--ink-faint)">Título exibido</span></div>
        ${cfg.map((c, i) => {
          const padrao = COLUNAS_PADRAO.find(p => p.id === c.id);
          return `
          <label class="fel-ajm-linha">
            <input type="checkbox" class="fel-ajm-chk" data-col-idx="${i}" ${c.visivel ? 'checked' : ''} ${c.fixa ? 'disabled' : ''} title="${c.fixa ? 'Coluna fixa' : 'Mostrar/ocultar coluna'}">
            <span class="fel-ajm-orig" title="Nome padrão">${escapeHTML(padrao ? padrao.label : c.id)}${c.fixa ? ' <small>(fixa)</small>' : ''}</span>
            <input type="text" class="fel-ajm-inp" data-col-idx="${i}" value="${escapeHTML(c.label)}" maxlength="40">
          </label>`;
        }).join('')}
        <div class="fel-ajm-acoes">
          <button class="btn btn-secondary" id="fel-ajm-restaurar">Restaurar padrão</button>
          <span style="flex:1"></span>
          <button class="btn btn-secondary" id="fel-ajm-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="fel-ajm-salvar">Salvar</button>
        </div>
      </div>`;
    document.body.appendChild(pop);
    const fechar = () => pop.remove();
    pop.addEventListener('click', (e) => { if (e.target === pop) fechar(); });
    pop.querySelector('#fel-ajm-cancelar').addEventListener('click', fechar);
    pop.querySelector('#fel-ajm-restaurar').addEventListener('click', () => {
      pop.querySelectorAll('.fel-ajm-inp').forEach((inp) => {
        const c = cfg[Number(inp.dataset.colIdx)];
        const padrao = COLUNAS_PADRAO.find(p => p.id === c.id);
        inp.value = padrao ? padrao.label : c.label;
      });
      pop.querySelectorAll('.fel-ajm-chk').forEach((chk) => { chk.checked = true; });
    });
    pop.querySelector('#fel-ajm-salvar').addEventListener('click', () => {
      pop.querySelectorAll('.fel-ajm-inp').forEach((inp) => {
        const c = cfg[Number(inp.dataset.colIdx)];
        const v = inp.value.trim();
        if (v) c.label = v;
      });
      pop.querySelectorAll('.fel-ajm-chk').forEach((chk) => {
        const c = cfg[Number(chk.dataset.colIdx)];
        if (!c.fixa) c.visivel = chk.checked;
      });
      window.__fel.configColunas = cfg;
      salvarConfigColunas(cfg);
      fechar();
      Utilidades.toast('✓ Matriz atualizada (colunas e títulos)', 'success', 2500);
      renderizar();
    });
  }

  // ── V725 (solicitação usuário Matheus): EXPORTAÇÃO ──────────────────────
  // O Excel espelha a MATRIZ COM O DRILLDOWN ABERTO: cabeçalho de grupo do
  // fellow, linhas-dia nas colunas VISÍVEIS da tela (com os títulos
  // personalizados do Ajuste de Matriz), subtotal por fellow e Total geral.
  // V737: o menu tem SÓ Matriz Sintética e Matriz Analítica; a separação
  // Por Fellow / Por Turno / Por Competência virou OPÇÃO de ambos (uma aba
  // por subconjunto). Moeda em Contábil "R$" (regra de exportação V708).

  function _felColsExport() {
    const cfg = window.__fel.configColunas || carregarConfigColunas();
    return cfg.filter(c => c.visivel);
  }

  /** Valor de UMA célula da linha-dia, fiel à tela (efetivos + textos). */
  function _felCelExport(c, l) {
    const semCompl = estaSemComplemento(l);
    const manual = temManual(l);
    if (c.id === 'data')           return `${DOW_LABEL[l.dia_semana]} ${formatarDataLonga(l.data_plantao)}`;
    if (c.id === 'fellow')         return l.fellow_nome;
    if (c.id === 'turno')          return TURNO_LABEL[l.turno] || l.turno;
    if (c.id === 'qtd_atendim')    return l.qtd_atendim;
    if (c.id === 'qtd_complem')    return manual ? 'manual' : (semCompl ? 0 : l.qtd_complem);   /* V735: era '—' */
    if (c.id === 'valor_complem')  return semCompl ? 'Sem complemento' : valorComplemEfetivo(l);
    if (c.id === 'refeicao')       return Number(l.refeicao) || 0;
    if (c.id === 'total_repassar') return totalEfetivo(l);
    return '';
  }

  /** Estrutura da matriz aberta (grupo → linhas → subtotal, Total geral). */
  function _felMatrizAoA(linhas, cols, tituloTotal) {
    const rows = [cols.map(c => c.label)];
    const porFellow = new Map();
    for (const l of linhas) {
      if (!porFellow.has(l.fellow_nome)) porFellow.set(l.fellow_nome, []);
      porFellow.get(l.fellow_nome).push(l);
    }
    const sub = (ls, chave) => ls.reduce((s, l) => s + chave(l), 0);
    const linhaAgregada = (rotulo, ls) => cols.map(c => {
      if (c.id === 'data')           return rotulo;
      if (c.id === 'qtd_atendim')    return sub(ls, l => l.qtd_atendim || 0);
      if (c.id === 'valor_complem')  return sub(ls, valorComplemEfetivo);
      if (c.id === 'refeicao')       return sub(ls, l => Number(l.refeicao) || 0);
      if (c.id === 'total_repassar') return sub(ls, totalEfetivo);
      return '';
    });
    for (const [fellow, ls] of porFellow.entries()) {
      const cab = cols.map(() => ''); cab[0] = `▼ ${fellow} — ${ls.length} plant${ls.length !== 1 ? 'ões' : 'ão'}`;
      rows.push(cab);
      ls.forEach(l => rows.push(cols.map(c => _felCelExport(c, l))));
      rows.push(linhaAgregada('↳ Subtotal', ls));
    }
    rows.push(linhaAgregada(tituloTotal || 'TOTAL GERAL', linhas));
    return rows;
  }

  /** Nome de aba válido no Excel (sem \\/?*[]: e máx. 31 chars). */
  function _felNomeAba(nome) {
    return String(nome).replace(/[\\\/\?\*\[\]:]/g, '-').slice(0, 31) || 'Fellow';
  }

  function _felFiltrosAtuais() {
    return {
      fellow: window.__fel.filtroFellow,
      turno: window.__fel.filtroTurno,
      nome: window.__fel.filtroNome,
    };
  }

  // V737: o menu tem SÓ os dois relatórios; "Por Fellow / Por Turno / Por
  // Competência" viraram OPÇÕES de ambos (diálogo de separação em abas,
  // "como se fossem filtros").
  function abrirMenuExportarFellow(btn) {
    const st = window.__fel;
    const mesLabel = (st.anoSelecionado && st.mesSelecionado)
      ? formatarMesLabel(`${st.anoSelecionado}-${st.mesSelecionado}`) : 'Selecione um mês';
    Utilidades.abrirMenuExportar(btn, [
      { icone: '⊞', titulo: 'Matriz Sintética', sub: `Grupos por fellow + subtotais + Total geral · ${mesLabel}`,
        onClick: () => abrirOpcoesExtracaoFellow('matriz') },
      { icone: '≣', titulo: 'Matriz Analítica', sub: `Flat: 1 linha por plantão, pronta p/ tabela dinâmica · ${mesLabel}`,
        onClick: () => abrirOpcoesExtracaoFellow('analitica') },
    ]);
  }

  /** V737: diálogo de OPÇÕES da extração (vale pra Sintética e Analítica):
   *  separar em abas por Fellow / Turno / Competência — ou tudo junto. */
  function abrirOpcoesExtracaoFellow(tipo) {
    document.getElementById('fel-ext-pop')?.remove();
    const nomeTipo = tipo === 'analitica' ? 'Matriz Analítica' : 'Matriz Sintética';
    const pop = document.createElement('div');
    pop.id = 'fel-ext-pop';
    pop.className = 'fel-ajm-fundo';
    pop.innerHTML = `
      <div class="fel-ajm-box" role="dialog" aria-modal="true" style="width: 380px">
        <h4>📥 ${nomeTipo} — opções</h4>
        <p>Como você quer separar o relatório? (as opções valem como filtros de agrupamento em abas)</p>
        ${[
          ['none', 'Tudo junto', 'Uma aba única com o mês selecionado'],
          ['fellow', 'Por Fellow (médico)', 'Uma aba por fellow'],
          ['turno', 'Por Turno', 'Uma aba por turno (Manhã / Tarde / Noturno)'],
          ['competencia', 'Por Competência', 'Uma aba por mês com dados'],
        ].map(([v, t, s], i) => `
          <label class="fel-ext-op">
            <input type="radio" name="fel-ext-split" value="${v}" ${i === 0 ? 'checked' : ''}>
            <span><strong>${t}</strong><small>${s}</small></span>
          </label>`).join('')}
        <div class="fel-ajm-acoes">
          <span style="flex:1"></span>
          <button class="btn btn-secondary" id="fel-ext-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="fel-ext-gerar">Gerar</button>
        </div>
      </div>`;
    document.body.appendChild(pop);
    const fechar = () => pop.remove();
    pop.addEventListener('click', (e) => { if (e.target === pop) fechar(); });
    pop.querySelector('#fel-ext-cancelar').addEventListener('click', fechar);
    pop.querySelector('#fel-ext-gerar').addEventListener('click', () => {
      const split = (pop.querySelector('input[name="fel-ext-split"]:checked') || {}).value || 'none';
      fechar();
      exportarExcelFellow(tipo, split);
    });
  }

  /** V737: monta os SUBCONJUNTOS conforme a separação escolhida.
   *  Retorna [{ aba, linhas, tituloTotal }] — vazio se não houver dados —
   *  ou null quando falta selecionar o mês (já avisa via toast). */
  function _felSubconjuntos(split, filtros) {
    const st = window.__fel;
    const mes_ref = (st.anoSelecionado && st.mesSelecionado) ? `${st.anoSelecionado}-${st.mesSelecionado}` : null;
    if (split === 'competencia') {
      const meses = Banco.query(`SELECT DISTINCT mes_ref FROM fellow_linhas ORDER BY mes_ref`).map(r => r.mes_ref);
      const subs = [];
      for (const m of meses) {
        const ls = carregarLinhas(m, filtros);
        if (ls.length) subs.push({ aba: formatarMesLabel(m).replace('/', '-'), linhas: ls, tituloTotal: `TOTAL ${formatarMesLabel(m)}` });
      }
      return subs;
    }
    if (!mes_ref) { Utilidades.toast('Selecione um mês primeiro', 'warning'); return null; }
    const linhas = carregarLinhas(mes_ref, filtros);
    if (!linhas.length) return [];
    if (split === 'fellow') {
      return [...new Set(linhas.map(l => l.fellow_nome))]
        .map(n => ({ aba: n, linhas: linhas.filter(l => l.fellow_nome === n), tituloTotal: `TOTAL ${n}` }));
    }
    if (split === 'turno') {
      return ['MANHA', 'TARDE', 'NOTURNO']
        .map(t => ({ aba: TURNO_LABEL[t] || t, linhas: linhas.filter(l => l.turno === t), tituloTotal: `TOTAL ${TURNO_LABEL[t] || t}` }))
        .filter(s => s.linhas.length);
    }
    return [{ aba: `Fellow ${formatarMesLabel(mes_ref)}`, linhas, tituloTotal: `TOTAL / ${formatarMesLabel(mes_ref)}` }];
  }

  // ── V735: relatórios ESTILIZADOS (Sintética/Analítica) via ExcelJS ──────
  // A lib XLSX vendorizada é SheetJS CE (não grava negrito/fundo). A ExcelJS
  // 4.4.0 (libs/exceljs.min.js) já é carregada on-demand pelo app (js/app.js,
  // V589: setTimeout de 1,5s após o boot injeta xlsx/exceljs/jszip no <head>).
  const _FEL_FMT_MOEDA = '"R$" #,##0.00';
  const _FEL_HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF107DAC' } };
  const _FEL_HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

  function _felBaixarBuffer(buffer, nomeArquivo) {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArquivo;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  /** Matriz Sintética: estrutura da matriz com drilldown aberto (grupos +
   *  subtotais + Total), TÍTULO em negrito + fundo #46688c e linhas de
   *  SUBTOTAL/TOTAL em negrito. V737: UMA ABA POR SUBCONJUNTO. */
  async function exportarSinteticaFellow(subs, cols, nomeArquivo) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ATLAS — Repasse Médico';
    wb.created = new Date();
    const moedaIds = ['valor_complem', 'refeicao', 'total_repassar'];
    for (const sub of subs) {
      const ws = wb.addWorksheet(_felNomeAba(sub.aba), { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = cols.map(c => ({
        width: c.id === 'fellow' ? 32 : (c.id === 'data' ? 18 : 16),
        style: moedaIds.includes(c.id) ? { numFmt: _FEL_FMT_MOEDA } : {},
      }));
      const rows = _felMatrizAoA(sub.linhas, cols, sub.tituloTotal);
      rows.forEach((r, i) => {
        const row = ws.addRow(r);
        if (i === 0) {
          row.height = 22;
          row.eachCell({ includeEmpty: true }, (c) => {
            c.font = { ..._FEL_HEADER_FONT };
            c.fill = { ..._FEL_HEADER_FILL };
            c.alignment = { vertical: 'middle' };
          });
        } else {
          const rotulo = String(r[0] == null ? '' : r[0]);
          if (rotulo.includes('Subtotal') || /^TOTAL/.test(rotulo)) row.font = { bold: true };
        }
      });
    }
    const buffer = await wb.xlsx.writeBuffer();
    _felBaixarBuffer(buffer, nomeArquivo);
  }

  /** Matriz Analítica: tabela FLAT (1 linha por plantão, sem grupos/subtotais),
   *  valores efetivos + filtros ativos — pronta pra tabela dinâmica.
   *  V737: UMA ABA POR SUBCONJUNTO. */
  async function exportarAnaliticaFellow(subs, nomeArquivo) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ATLAS — Repasse Médico';
    wb.created = new Date();
    for (const sub of subs) {
      const ws = wb.addWorksheet(_felNomeAba(sub.aba), { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = [
        { header: 'Data',                key: 'data',     width: 14 },
        { header: 'Dia',                 key: 'dia',      width: 8 },
        { header: 'Fellow',              key: 'fellow',   width: 32 },
        { header: 'Turno',               key: 'turno',    width: 12 },
        { header: 'Qtd de atendimentos', key: 'qtd_at',   width: 20 },
        { header: 'Qtd Complementos',    key: 'qtd_comp', width: 18 },
        { header: 'Vl. Complementos',    key: 'vl_comp',  width: 18, style: { numFmt: _FEL_FMT_MOEDA } },
        { header: 'Refeição',            key: 'refeicao', width: 14, style: { numFmt: _FEL_FMT_MOEDA } },
        { header: 'Repasse',             key: 'repasse',  width: 14, style: { numFmt: _FEL_FMT_MOEDA } },
      ];
      const h = ws.getRow(1);
      h.height = 22;
      h.eachCell((c) => {
        c.font = { ..._FEL_HEADER_FONT };
        c.fill = { ..._FEL_HEADER_FILL };
        c.alignment = { vertical: 'middle' };
      });
      for (const l of sub.linhas) {
        ws.addRow({
          data: formatarDataLonga(l.data_plantao),
          dia: DOW_LABEL[l.dia_semana],
          fellow: l.fellow_nome,
          turno: TURNO_LABEL[l.turno] || l.turno,
          qtd_at: l.qtd_atendim,
          qtd_comp: temManual(l) ? 'manual' : (estaSemComplemento(l) ? 0 : l.qtd_complem),
          vl_comp: valorComplemEfetivo(l),
          refeicao: Number(l.refeicao) || 0,
          repasse: totalEfetivo(l),
        });
      }
    }
    const buffer = await wb.xlsx.writeBuffer();
    _felBaixarBuffer(buffer, nomeArquivo);
  }

  /** V737: os dois relatórios (Sintética/Analítica) com a separação escolhida
   *  no diálogo de opções — tudo via ExcelJS estilizado, uma aba por
   *  subconjunto. */
  function exportarExcelFellow(tipo, split = 'none') {
    if (typeof ExcelJS === 'undefined') { Utilidades.toast('Biblioteca ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return; }
    const st = window.__fel;
    const filtros = _felFiltrosAtuais();
    const subs = _felSubconjuntos(split, filtros);
    if (subs === null) return;   // sem mês selecionado (toast já emitido)
    if (!subs.length) { Utilidades.toast('Nada para exportar', 'warning'); return; }

    const base = tipo === 'analitica' ? 'Fellow_analitica' : 'Fellow';
    const sufMes = (st.anoSelecionado && st.mesSelecionado)
      ? formatarMesLabel(`${st.anoSelecionado}-${st.mesSelecionado}`).replace('/', '_') : '';
    const nomeArquivo =
      split === 'competencia' ? `${base}_por_competencia.xlsx`
      : split === 'fellow'    ? `${base}_por_medico_${sufMes}.xlsx`
      : split === 'turno'     ? `${base}_por_turno_${sufMes}.xlsx`
      :                         `${base}_${sufMes}.xlsx`;

    const promessa = tipo === 'analitica'
      ? exportarAnaliticaFellow(subs, nomeArquivo)
      : exportarSinteticaFellow(subs, _felColsExport(), nomeArquivo);
    promessa
      .then(() => Utilidades.toast(subs.length > 1 ? `✓ Exportado (${subs.length} abas)` : '✓ Exportado', 'success'))
      .catch((e) => { console.error(e); Utilidades.toast('Falha ao exportar: ' + e.message, 'error', 4500); });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Styles
  // ──────────────────────────────────────────────────────────────────────
  // V492: retorna apenas o CSS (sem tag <style>) — injetado 1x via Utilidades.garantirEstilos
  function getStyles() {
    return `
        .fel-page { padding: 16px 24px 24px; }

        .fel-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          padding: 8px 0 18px;
          position: relative;
          z-index: 100;            /* eleva acima dos irmãos (filtros, cards) */
        }
        .fel-header-info h1 { font-size: 26px; margin: 0; color: var(--ink); font-family: var(--serif); font-weight: 800; }
        .fel-header-info p { margin: 2px 0 0; color: var(--ink-soft); font-size: 12px; }
        .fel-header-acoes { display: flex; gap: 6px; align-items: center; position: relative; z-index: 500; }

        /* Botões compactos — já definidos no global, mas dou um boost p/ Fellow */
        /* Menu visão */
        .fel-menu-wrap { position: relative; z-index: 999; }
        .fel-menu-visao {
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
          display: flex; flex-direction: column; gap: 2px;
        }
        .fel-menu-item {
          display: flex; gap: 10px; align-items: flex-start;
          padding: 8px 10px;
          background: none; border: none; border-radius: 6px;
          cursor: pointer; text-align: left;
          font-family: inherit; color: var(--ink); width: 100%;
        }
        .fel-menu-item:hover { background: var(--bg-sunken); }
        .fel-menu-item.ativo { background: #eef2f6; }
        .fel-menu-ico { font-size: 14px; line-height: 1.2; }
        .fel-menu-txt { display: flex; flex-direction: column; gap: 2px; }
        .fel-menu-txt strong { font-size: 12px; font-weight: 700; color: var(--ink); }
        .fel-menu-txt small { font-size: 10px; color: var(--ink-soft); }
        .fel-menu-sep { height: 1px; background: var(--border); margin: 4px 6px; }
        .fel-menu-foco { padding: 6px 10px; }
        .fel-menu-foco-label { display: flex; gap: 10px; align-items: center; margin-bottom: 4px; }
        .fel-menu-foco-label strong { font-size: 12px; }
        .fel-menu-foco-select {
          width: 100%; padding: 5px 8px; font-size: 12px;
          border: 1px solid var(--border); border-radius: 5px;
          background: white; color: var(--ink); font-family: inherit;
        }
        .fel-linha-mascarada td { color: var(--ink-faint); opacity: 0.85; }
        .fel-fellow-ofuscado { font-style: italic; color: var(--ink-faint); letter-spacing: 0.02em; }
        .fel-foco-banner {
          background: linear-gradient(90deg, #f2f3f5 0%, #eef2f6 100%);
          border: 1px solid #3f6489;
          border-radius: 8px;
          padding: 8px 14px;
          margin-bottom: 8px;
          display: flex; justify-content: space-between; align-items: center;
          gap: 12px; font-size: 12px; color: #4B3814;
        }
        .fel-foco-banner strong { color: #3a5877; }

        /* V732: virou o CONTÊINER da peça 20C (.fel-sb) + botão "✕ Limpar" —
           os selects/combo antigos saíram junto com o grid de controles */
        .fel-filtros-bar {
          background: transparent;
          border: none;
          border-radius: 0;
          padding: 0;
          margin-top: 10px;
          margin-bottom: 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          align-items: stretch;   /* a peça 20C estica de ponta a ponta */
          width: 100%;
          box-sizing: border-box;
          position: relative;
          z-index: 50;
        }
        .fel-filtros-bar > #fel-limpar-filtros { align-self: flex-start; }

        /* ── V732: fileira de filtros 20C (padrão do LIO, prefixo fel-sb) ── */
        .fel-sb {
          position: relative; z-index: 30;
          display: flex; align-items: stretch;
          padding: 6px;
          background: #fff;
          border: 1px solid #eef2f6;
          border-radius: 12px;
          box-shadow: 0 1px 2px rgba(89, 128, 166,.04), 0 10px 26px -20px rgba(89, 128, 166,.26);
          flex-wrap: wrap;
        }
        .fel-sb-celwrap { position: relative; min-width: 150px; display: flex; }
        .fel-sb-celwrap:not(:last-child) .fel-sb-cel { border-right: 1px solid #f7f8fa; }
        .fel-sb-cel {
          flex: 1; min-width: 0;
          display: flex; align-items: center; gap: 9px;
          padding: 9px 12px; border: none; border-radius: 9px;
          background: transparent; cursor: pointer;
          font-family: inherit; text-align: left;
          transition: background-color 120ms;
        }
        .fel-sb-cel:hover, .fel-sb-cel.ativo, .fel-sb-cel.aberta { background: #fafbfc; }
        .fel-sb-cel:focus-visible { outline: 2px solid #3f6489; outline-offset: 2px; }
        .fel-sb-tile {
          width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: #f0f5f9; color: #585d62;
        }
        .fel-sb-cel.ativo .fel-sb-tile, .fel-sb-cel.aberta .fel-sb-tile { background: #eef2f6; color: #46688c; }
        .fel-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
        .fel-sb-rot {
          font-size: 10px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .09em; color: #585d62; white-space: nowrap;
        }
        .fel-sb-val {
          font-size: 13px; font-weight: 500; color: #585d62;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .fel-sb-cel.ativo .fel-sb-val { font-weight: 700; color: #3a5877; }
        .fel-sb-chev { color: #8a9096; flex-shrink: 0; display: flex; transition: transform 140ms; }
        .fel-sb-cel.aberta .fel-sb-chev { transform: rotate(180deg); }

        /* painel ancorado na célula, por cima dos cards */
        .fel-sb-painel {
          position: absolute; top: 100%; left: 0; margin-top: 6px; z-index: 40;
          min-width: 100%; width: max-content; max-width: 340px;
          background: #fff; border: 1px solid #eef0f2; border-radius: 12px;
          box-shadow: 0 18px 44px -14px rgba(29, 31, 32,.42);
          overflow: hidden;
        }
        .fel-sb-buscabox {
          display: flex; align-items: center; gap: 8px;
          padding: 11px 12px 10px; border-bottom: 1px solid #f7f8fa;
        }
        .fel-sb-buscabox .fel-sb-busca-ic { color: #6b7d8e; display: flex; }
        .fel-sb-busca {
          flex: 1; height: 30px; border: 1px solid #eef0f2; border-radius: 8px;
          background: #fafbfc; padding: 0 10px; font-size: 13px;
          font-family: inherit; color: #3a5877; outline: none;
        }
        .fel-sb-busca::placeholder { color: #8a9096; }
        .fel-sb-busca:focus { border-color: #3f6489; }
        .fel-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; }
        .fel-sb-lista::-webkit-scrollbar { width: 8px; }
        .fel-sb-lista::-webkit-scrollbar-track { background: #f7f8fa; }
        .fel-sb-lista::-webkit-scrollbar-thumb { background: #e4eaf1; border-radius: 4px; }
        .fel-sb-it {
          display: flex; align-items: center; gap: 10px;
          height: 38px; padding: 0 8px; border-radius: 8px; cursor: pointer;
          font-size: 13px; color: #3a5877;
        }
        .fel-sb-it:hover, .fel-sb-it.foco { background: #f7f8fa; }
        .fel-sb-it.sel { background: #f7f8fa; font-weight: 700; }
        .fel-sb-it-todos { font-weight: 700; }
        .fel-sb-it-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .fel-sb-ck { color: #46688c; display: flex; }
        .fel-sb-chip {
          width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: #f7f8fa; color: #46688c; font-size: 9.5px; font-weight: 700;
        }
        .fel-sb-rodape {
          padding: 7px 12px; border-top: 1px solid #f7f8fa;
          font-size: 10.5px; font-weight: 600; color: #8a9096;
        }
        @media (max-width: 1280px) { .fel-sb-celwrap { flex-basis: 32%; } }
        @media (max-width: 900px)  { .fel-sb-celwrap { flex-basis: 48%; } }

        /* Cards KPI */
        .fel-cards-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
        @media (max-width: 1100px) { .fel-cards-grid { grid-template-columns: repeat(2, 1fr); } }
        .fel-card { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; position: relative; overflow: hidden; }
        .fel-card-faixa { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
        .fel-card-verde   { background: linear-gradient(180deg, #eef2f6 0%, #EDF5F0 100%); }
        .fel-card-verde .fel-card-faixa { background: #3a5877; }
        .fel-card-roxo    { background: linear-gradient(180deg, #EEEAF6 0%, #F5F2FA 100%); }
        .fel-card-roxo .fel-card-faixa { background: #6B4587; }
        .fel-card-bege    { background: linear-gradient(180deg, #F2E8D4 0%, #F8F0DD 100%); }
        .fel-card-bege .fel-card-faixa { background: #5980a6; }
        .fel-card-destaque { background: #3a5877; color: #585d62; }
        .fel-card-destaque .fel-card-titulo { color: #585d62; }
        .fel-card-destaque .fel-card-valor { color: #5980a6; }
        .fel-card-destaque .fel-card-sub { color: #585d62; }
        .fel-card-destaque .fel-card-sub span { color: #585d62; }

        .fel-card-titulo { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #1d1f20; margin-bottom: 4px; } /* V849: título dos cards totalizadores */
        /* V726: título dos cards totalizadores em #1d1f20 — a regra global de
           cards (style.css, V181) pintava #0F6E56 com !important; este
           override vence por vir depois no cascade. */
        .main .fel-card .fel-card-titulo { color: #1d1f20 !important; }
        .fel-card-valor { font-size: 24px; font-weight: 800; line-height: 1.1; color: var(--primary); }
        .fel-card-breakdown { margin-top: 6px; font-size: 11px; color: var(--ink-soft); line-height: 1.5; }
        /* V735: valores de subtotais/quantidades dos breakdowns em #46688c
           (os "vs LM"/"vs LY" mantêm a condicional verde/vermelho própria) */
        .fel-bd-item strong { color: #46688c; font-variant-numeric: tabular-nums; }
        /* V967: "N Sem complemento" no card Plantões — número E texto em vermelho */
        /* (.main .fel-card … vence a regra global de style.css que pinta o strong
           dos breakdowns em #46688c) */
        .main .fel-card .fel-bd-item-neg, .main .fel-card .fel-bd-item-neg strong { color: #c07a66 !important; }
        .fel-card-sub { font-size: 11px; color: var(--ink-soft); margin-top: 4px; }
        .fel-card-sub strong { color: #46688c; }
        .main .fel-card .fel-card-sub span[data-ocultavel] { color: #46688c; }
        .fel-card-comp { font-size: 10px; color: var(--ink-faint); margin-top: 6px; display: flex; gap: 12px; }
        .fel-comp-pos { color: var(--success, #1d9e75); font-weight: 600; }
        .fel-comp-neg { color: var(--danger, #993556); font-weight: 600; }
        .fel-comp-vazio { color: var(--ink-faint); }

        /* Tabela */
        /* V864: o cartão vira a área de rolagem, que é o que permite congelar o
           título das colunas — a fixação precisa de um container que role de
           verdade, e com overflow hidden ela nunca gruda. A altura
           máxima acompanha a janela e não aparece quando a lista é curta. */
        .fel-tabela-card {
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: 12px; overflow: auto; max-height: min(64vh, 760px);
        }
        .fel-tabela { width: 100%; border-collapse: collapse; font-size: 12px; }
        .fel-tabela thead th { position: sticky; top: 0; z-index: 3; }
        .fel-tabela th {
          padding: 8px 10px;
          text-align: left;
          background: var(--bg-sunken);
          color: var(--ink-soft);
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid var(--border);
        }
        .fel-tabela th.num { text-align: right; }
        .fel-tabela td { padding: 6px 10px; border-bottom: 1px solid var(--border); color: var(--ink); }
        .fel-tabela td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .fel-tabela tr:hover td:not(.fel-grupo-header td) { background: var(--bg-sunken); }

        .fel-data-dow {
          display: inline-block;
          width: 28px;
          font-size: 10px;
          font-weight: 700;
          color: var(--ink-faint);
          text-transform: uppercase;
        }

        .fel-turno-tag {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .fel-turno-manha   { background: #FFF4D6; color: #8A6B0F; }
        .fel-turno-tarde   { background: #FBE1D1; color: #8B3F12; }
        .fel-turno-noturno { background: #DCD9F1; color: #3F2E7A; }
        .fel-turno-dia     { background: #E3EEF3; color: #23576E; }

        .fel-linha-fds td { background: var(--bg-elevated, #FFFFFF); }
        /* V735: linhas "Sem complemento" (.fel-linha-neg) voltaram ao fundo
           normal/zebra padrão (saiu o azul #eef2f6 da V725); as linhas com
           override manual (.fel-linha-manual) MANTÊM o azul #eef2f6. */
        .fel-linha-fds:hover td { background: #eef2f6 !important; }
        .fel-linha-manual td { background: #eef2f6; }
        .fel-linha-manual.fel-linha-fds td { background: #eef2f6; }
        .fel-val-neg { color: var(--ink-faint) !important; font-weight: 600; }
        .fel-val-manual { color: #8A6B0F !important; font-weight: 700; }

        /* V725: modal "Ajuste de Matriz" (renomear títulos das colunas) */
        .fel-ajm-fundo {
          position: fixed; inset: 0; background: rgba(29, 31, 32, .45);
          display: flex; align-items: center; justify-content: center; z-index: 5000;
        }
        .fel-ajm-box {
          background: var(--bg-elevated, #fff); border-radius: 12px; padding: 20px;
          width: 430px; max-width: calc(100vw - 32px); max-height: 84vh; overflow-y: auto;
          box-shadow: 0 18px 44px -14px rgba(29, 31, 32, .42);
        }
        .fel-ajm-box h4 { margin: 0 0 6px; font-size: 15px; }
        .fel-ajm-box p { margin: 0 0 14px; font-size: 12px; color: var(--ink-soft); }
        .fel-ajm-linha { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .fel-ajm-orig {
          flex: 0 0 130px; font-size: 10.5px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .04em; color: var(--ink-faint);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .fel-ajm-inp {
          flex: 1; height: 32px; border: 1px solid var(--border); border-radius: 8px;
          padding: 0 10px; font-size: 13px; font-family: inherit; color: var(--ink);
          background: var(--bg-raised, #fff); outline: none;
        }
        .fel-ajm-inp:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(89, 128, 166, .16); }
        .fel-ajm-acoes { display: flex; gap: 8px; align-items: center; margin-top: 14px; }

        /* V737: diálogo de OPÇÕES da extração (separação em abas) */
        .fel-ext-op {
          display: flex; gap: 10px; align-items: flex-start;
          padding: 8px 10px; margin: 2px 0;
          border: 1px solid var(--border); border-radius: 8px;
          cursor: pointer; background: white;
        }
        .fel-ext-op:hover { background: var(--bg-sunken); }
        .fel-ext-op:has(input:checked) { background: #eef2f6; border-color: #46688c; }
        .fel-ext-op input { margin-top: 2px; accent-color: #46688c; }
        .fel-ext-op span { display: flex; flex-direction: column; gap: 1px; }
        .fel-ext-op strong { font-size: 12px; color: var(--ink); }
        .fel-ext-op small { font-size: 10px; color: var(--ink-soft); }

        /* V735: termo "Sem complemento" em #46688c — o seletor com td vence o
           ".fel-tabela td { color: var(--ink) }" (0,1,1) no cascade */
        .fel-sem-compl, .fel-tabela td.fel-sem-compl {
          font-style: italic;
          color: #3f6489;   /* V965: era #46688c (V735: era var(--ink-faint)) */
          font-size: 11px;
          font-weight: 500;
        }
        .fel-tag-manual {
          display: inline-block;
          padding: 1px 6px;
          margin-left: 4px;
          background: #3f6489;
          color: #FFF;
          border-radius: 8px;
          font-size: 9px;
          font-weight: 700;
          font-family: var(--mono);
          vertical-align: middle;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .fel-tag-manual-cell { font-style: italic; color: #8A6B0F; font-size: 11px; }

        /* Modal: campo de override manual */
        .fel-edit-campo-manual {
          grid-column: 1 / -1;
          padding-top: 4px;
        }
        .fel-edit-manual-wrap {
          display: flex;
          align-items: stretch;
          gap: 4px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: white;
          overflow: hidden;
        }
        .fel-edit-manual-wrap:focus-within { border-color: #3f6489; }
        .fel-edit-manual-rs {
          padding: 8px 10px;
          background: var(--bg-sunken);
          color: var(--ink-soft);
          font-size: 12px;
          font-weight: 600;
          border-right: 1px solid var(--border);
        }
        .fel-edit-manual-wrap input {
          flex: 1;
          border: none !important;
          padding: 8px 10px !important;
          font-variant-numeric: tabular-nums;
          text-align: right;
          font-size: 13px;
          background: transparent !important;
          outline: none;
        }
        .fel-edit-manual-limpar {
          background: none;
          border: none;
          padding: 0 12px;
          cursor: pointer;
          color: var(--ink-faint);
          font-size: 12px;
        }
        .fel-edit-manual-limpar:hover { color: #993556; background: var(--bg-sunken); }
        .fel-edit-manual-help {
          color: var(--ink-faint);
          font-size: 11px;
          margin-top: 4px;
        }
        .fel-edit-aviso-sem {
          margin-top: 8px;
          padding: 6px 10px;
          background: #EBE9E5;
          border-radius: 6px;
          color: var(--ink-soft);
          font-size: 11px;
          font-weight: 500;
        }
        .fel-edit-total-final {
          grid-column: 1 / -1;
          margin-top: 8px;
          padding: 12px;
          background: var(--primary);
          color: #f2f3f5;
          border-radius: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .fel-edit-total-final .fel-edit-total-label { font-size: 12px; font-weight: 600; }
        .fel-edit-total-final strong { font-size: 18px; color: #3f6489; }
        .fel-edit-total-final strong.fel-val-manual { color: #f2f3f5; }
        .fel-edit-total-final strong.fel-val-manual::after { content: ' (manual)'; font-size: 10px; opacity: 0.7; }

        .fel-grupo-header td {
          background: #FFFFFF !important;
          color: var(--primary);
          font-weight: 700;
          font-size: 13px;
          padding: 10px 14px;
          cursor: pointer;
          user-select: none;
        }
        .fel-grupo-header td:hover { background: #F1F4F3 !important; }
        .fel-grupo-icone { display: inline-block; width: 18px; color: #5980a6; font-size: 11px; }   /* V735 */
        .fel-grupo-info { font-weight: 400; color: var(--ink-soft); font-size: 11px; margin-left: 10px; }
        /* V736: o botão VOLTA à cor original (accent) — só o SÍMBOLO "+" fica
           em #5980a6 (o pedido do V735 era apenas o símbolo; o ➕ emoji não
           aceitava cor, virou um span estilizado). */
        .fel-grupo-add {
          margin-left: 10px; padding: 2px 9px; font-family: inherit; font-size: 10.5px; font-weight: 700;
          border: 1px solid var(--accent); border-radius: 999px; background: transparent; color: var(--accent);
          cursor: pointer; vertical-align: middle; transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
        }
        .fel-grupo-add .fel-add-mais { color: #5980a6; font-weight: 800; }
        .fel-grupo-add:hover { background: var(--accent); color: #fff; }
        .fel-grupo-add:hover .fel-add-mais { color: #fff; }
        .fel-grupo-info strong { color: var(--accent); font-weight: 700; }

        .fel-subtotal td {
          background: #eef2f6;   /* V735: era #fafbfc */
          font-size: 11px;
          padding: 6px 10px;
          border-bottom: 2px solid var(--border);
        }

        .fel-total td {
          background: #3a5877;
          color: #f2f3f5;
          padding: 10px 14px;
        }

        /* Ações */
        .fel-acoes-col { width: 64px; }
        .fel-acoes-cell { text-align: right; white-space: nowrap; }
        .fel-btn-acao {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 13px;
          padding: 2px 6px;
          color: var(--ink-soft);
          border-radius: 4px;
        }
        .fel-btn-acao:hover { background: var(--bg-sunken); color: var(--primary); }
        .fel-btn-acao.fel-btn-danger:hover { color: var(--danger, #993556); }

        /* Popover colunas */
        .fel-popover {
          position: absolute;
          top: 90px;
          right: 24px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 12px;
          box-shadow: 0 6px 20px rgba(0,0,0,0.1);
          z-index: 100;
          min-width: 200px;
        }
        .fel-popover-titulo { font-size: 10px; font-weight: 700; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
        .fel-popover-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; cursor: pointer; }

        /* Snapshots */
        .fel-snapshots { margin-top: 16px; }
        .fel-snapshots-header {
          display: flex; justify-content: space-between; align-items: center;
          font-size: 10px; font-weight: 700; color: var(--ink-soft);
          letter-spacing: 0.06em; margin-bottom: 8px;
        }
        .fel-snapshots-sub { font-weight: 400; font-size: 11px; color: var(--ink-faint); text-transform: none; letter-spacing: 0; }
        .fel-snapshots-sub strong { color: var(--ink); }
        .fel-snapshots-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
        .fel-snap-card {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .fel-snap-cabec { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
        .fel-snap-mes { font-weight: 700; color: var(--primary); font-size: 12px; }
        .fel-snap-acao { background: none; border: none; cursor: pointer; font-size: 11px; color: var(--ink-faint); padding: 2px 4px; }
        .fel-snap-acao:hover { color: var(--danger, #993556); }
        .fel-snap-detalhe { font-size: 11px; color: var(--ink-soft); line-height: 1.5; }
        .fel-snap-detalhe strong { color: var(--ink); font-variant-numeric: tabular-nums; }

        /* Modal de Edição */
        .fel-edit-modal-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
          z-index: 9999;
        }
        .fel-edit-modal {
          background: var(--bg-elevated);
          border-radius: 12px;
          width: 540px;
          max-width: 95vw;
          max-height: 90vh;
          display: flex; flex-direction: column;
        }
        .fel-edit-header {
          padding: 14px 20px;
          border-bottom: 1px solid var(--border);
          display: flex; justify-content: space-between; align-items: center;
          font-weight: 700;
        }
        .fel-edit-fechar { background: none; border: none; cursor: pointer; font-size: 16px; color: var(--ink-soft); }
        .fel-edit-body { padding: 20px; overflow-y: auto; }
        .fel-edit-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .fel-edit-campo { display: flex; flex-direction: column; gap: 4px; }
        .fel-edit-campo label { font-size: 10px; font-weight: 700; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.04em; }
        .fel-edit-campo input, .fel-edit-campo select {
          padding: 8px 10px;
          border: 1px solid var(--border);
          border-radius: 6px;
          font-size: 13px;
          font-family: inherit;
        }
        .fel-edit-campo input[type="number"] { font-variant-numeric: tabular-nums; text-align: right; }
        .fel-edit-preview {
          grid-column: 1 / -1;
          padding: 12px;
          background: var(--bg-sunken);
          border-radius: 8px;
          margin-top: 4px;
        }
        .fel-edit-preview-label { font-size: 10px; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
        .fel-edit-preview-detalhes { display: flex; gap: 16px; font-size: 12px; color: var(--ink-soft); margin-bottom: 6px; flex-wrap: wrap; }
        .fel-edit-preview-detalhes strong { color: var(--ink); margin-left: 4px; }
        .fel-edit-preview-total {
          font-size: 14px;
          color: var(--ink);
          font-weight: 600;
          padding-top: 6px;
          border-top: 1px dashed var(--border);
        }
        .fel-edit-preview-total strong { color: var(--accent); font-size: 16px; margin-left: 4px; }
        .fel-edit-footer {
          padding: 12px 20px;
          border-top: 1px solid var(--border);
          display: flex; justify-content: flex-end; gap: 8px;
        }
    `;
  }

  // Render inicial
  renderizar();
};
