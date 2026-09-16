/**
 * ============================================================================
 * TELA: Desempenho · Fracionamento de Injeções Intra-Vítreas
 *
 * Repasse a médicos pelo fracionamento de frascos de injeções de retina
 * (Eylia 2mg, Eylia 8mg). Cada frasco pode ser usado em até 4 aplicações;
 * a líder do centro cirúrgico marca os grupos por COR no relatório mensal.
 *
 * Regra de pagamento (configurável):
 *   Repasse ao médico = FRACIONAMENTO BRUTO − VALOR FIXO RETIDO
 *
 *   - Valor fixo retido pelo ATLAS (procedimento cirúrgico): R$ 418,52
 *   - Repasse ao médico, depende da POSIÇÃO da aplicação no frasco:
 *       1ª: R$ 450  |  2ª: R$ 550  |  3ª: R$ 700  |  4ª: R$ 900
 *   - Frasco compartilhado entre médicos: rateio IGUAL (média truncada
 *     dos valores acima, 2 casas decimais — bate com Excel da líder)
 *   - Particulares: não entram (regra 27% padrão particular).
 *
 * Status desta entrega (Etapa 1):
 *   ✓ Schema (banco.js)
 *   ✓ Tela com painel de Configuração da Regra editável
 *   ✓ Preview ao vivo das duas tabelas (individual + compartilhada)
 *   ⏳ Importador (próxima etapa)
 *   ⏳ Cards/tabela de desempenho (próxima etapa)
 * ============================================================================
 */

App.telas['desempenho-fracionamento'] = (function () {
  'use strict';

  const escapeHTML = (s) => (s == null ? '' : String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

  const fmt = (n, dec = 2) => Utilidades.formatarNumero(Number(n) || 0, dec);

  /** Lê uma config como number, com fallback. */
  function getCfg(chave, fallback) {
    try {
      const r = Banco.queryUnica(
        `SELECT valor FROM config_fracionamento WHERE chave = ?`,
        [chave]
      );
      return r ? Number(r.valor) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  /** Persiste config (UPSERT). */
  async function setCfg(chave, valor) {
    Banco.executar(`
      INSERT INTO config_fracionamento (chave, valor) VALUES (?, ?)
      ON CONFLICT(chave) DO UPDATE SET
        valor = excluded.valor,
        atualizado_em = CURRENT_TIMESTAMP
    `, [chave, String(valor)]);
    await Banco.salvar();
  }

  /** Lê todas as configs da regra de fracionamento. */
  function lerRegra() {
    return {
      // valor_fixo: retido pelo ATLAS (procedimento cirúrgico). DEDUZIDO do bruto.
      valorFixo: getCfg('VALOR_FIXO', 418.52),
      // bruto1..bruto4: FRACIONAMENTO BRUTO que o ATLAS recebe por aplicação,
      // posicionada no frasco INDIVIDUAL. Repasse ao médico = bruto - valorFixo.
      bruto1: getCfg('VALOR_BRUTO_POS1', 868.52),
      bruto2: getCfg('VALOR_BRUTO_POS2', 968.52),
      bruto3: getCfg('VALOR_BRUTO_POS3', 1118.52),
      bruto4: getCfg('VALOR_BRUTO_POS4', 1318.52),
      // brutoCompart2..4: BRUTO quando frasco é COMPARTILHADO entre médicos.
      // Valores independentes (editáveis pelo usuário).
      brutoCompart2: getCfg('VALOR_BRUTO_COMPART_2', 918.52),
      brutoCompart3: getCfg('VALOR_BRUTO_COMPART_3', 985.18),
      brutoCompart4: getCfg('VALOR_BRUTO_COMPART_4', 1068.52),
      // pctParticular: percentual sobre o valor produzido na PRODUÇÃO
      // (procedimento INJECAO INTRA VITREA) pra calcular repasse de particulares.
      pctParticular: getCfg('PCT_PARTICULAR', 27.00),
    };
  }

  /** Defaults oficiais (botão "Restaurar padrão"). */
  const REGRA_PADRAO = {
    valorFixo: 418.52,
    bruto1: 868.52, bruto2: 968.52, bruto3: 1118.52, bruto4: 1318.52,
    brutoCompart2: 918.52, brutoCompart3: 985.18, brutoCompart4: 1068.52,
    pctParticular: 27.00,
  };

  // ──────────────────────────────────────────────────────────────────────
  // AJUSTE DE MATRIZ (padrão do Fellow): config de colunas da matriz de
  // aplicações — id/label/visível, persistida em localStorage. Os títulos
  // personalizados valem na matriz e no cabeçalho do Excel exportado.
  // ──────────────────────────────────────────────────────────────────────
  const FRAC_COLUNAS_PADRAO = [
    { id: 'data',       label: 'Data',        visivel: true, fixa: true  },
    { id: 'admissao',   label: 'Admissão',    visivel: true, fixa: false },
    { id: 'paciente',   label: 'Paciente',    visivel: true, fixa: false },
    { id: 'medico',     label: 'Médico',      visivel: true, fixa: false },
    { id: 'convenio',   label: 'Convênio',    visivel: true, fixa: false },
    { id: 'observacao', label: 'Medicamento', visivel: true, fixa: false },
    { id: 'pos',        label: 'Pos.',        visivel: true, fixa: false },
    { id: 'bruto',      label: 'Bruto',       visivel: true, fixa: false },
    { id: 'fixo',       label: '− Fixo',      visivel: true, fixa: false },
    { id: 'repasse',    label: '= Repasse',   visivel: true, fixa: false },
  ];
  const FRAC_COLS_CFG_KEY  = 'frac_colunas_config_v1';
  const FRAC_COLS_LARG_KEY = 'frac_colunas_larguras_v1';

  function carregarConfigColunasFrac() {
    try {
      const raw = localStorage.getItem(FRAC_COLS_CFG_KEY);
      if (!raw) return JSON.parse(JSON.stringify(FRAC_COLUNAS_PADRAO));
      const salvo = JSON.parse(raw);
      return FRAC_COLUNAS_PADRAO.map(p => {
        const s = Array.isArray(salvo) ? salvo.find(x => x.id === p.id) : null;
        return s ? { ...p, label: (s.label || p.label), visivel: s.visivel !== false } : { ...p };
      });
    } catch (e) { return JSON.parse(JSON.stringify(FRAC_COLUNAS_PADRAO)); }
  }
  function salvarConfigColunasFrac(cfg) {
    try { localStorage.setItem(FRAC_COLS_CFG_KEY, JSON.stringify(cfg)); }
    catch (e) { console.warn('Falha localStorage:', e.message); }
  }

  // ──────────────────────────────────────────────────────────────────────
  // FILEIRA DE FILTROS 20C — helpers puros (mesmo padrão do LIO V727)
  // ──────────────────────────────────────────────────────────────────────
  function _fracSbIc(nome) {
    return {
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      alignleft: '<line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/>',
      userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
      creditcard: '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
      search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
      check: '<polyline points="20 6 9 17 4 12"/>',
      chev: '<polyline points="6 9 12 15 18 9"/>',
    }[nome] || '';
  }
  function _fracSbSvg(d, px, sw) {
    return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  function _fracSbSemAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function _fracSbIniciais(nome) {
    const p = String(nome || '').split(/\s+/).filter(w => w.length >= 3);
    return ((p[0] || ' ')[0] + ((p[1] || ' ')[0] || '')).toUpperCase().trim() || '–';
  }

  /**
   * Calcula o REPASSE LÍQUIDO ao médico para uma aplicação.
   * Repasse = Bruto (que o ATLAS recebe) − Valor fixo (retido pelo ATLAS)
   *
   * @param {object} regra      configuração corrente
   * @param {number} posicao    1..4
   * @param {number} totalApl   2..4 (total de aplicações no frasco)
   * @param {boolean} compart   se o frasco é compartilhado entre médicos
   * @returns {number}          repasse líquido ao médico
   */
  function calcularRepasse(regra, posicao, totalApl, compart) {
    const fixo = Number(regra.valorFixo) || 0;
    const bruto = compart
      ? (Number(regra['brutoCompart' + totalApl]) || 0)
      : (Number(regra['bruto' + posicao]) || 0);
    return bruto - fixo;
  }

  /**
   * V623: RECALCULAR FRACIONAMENTO — reaplica a REGRA ATUAL sobre as aplicações
   * já importadas de TODOS os meses NÃO consolidados (mês consolidado é registro
   * oficial — fica intacto e é listado como pulado).
   *   • Convênio: bruto por posição/cenário do frasco − valor fixo (mesma conta
   *     da importação). Overrides manuais (valor_repasse_manual) são preservados.
   *   • Particular: % Particular atual sobre o produzido já cruzado (QVIS/Produção);
   *     'SEM_VALOR' continua zerado (use ↻ Recalcular particulares pra re-cruzar).
   */
  function recalcularFracionamento() {
    const regra = lerRegra();
    const fixo = Number(regra.valorFixo) || 0;
    const pct = Number(regra.pctParticular) || 0;
    const meses = (Banco.query(`SELECT DISTINCT mes_ref FROM fracionamento_aplicacoes ORDER BY mes_ref`) || [])
      .map(r => r.mes_ref).filter(Boolean);
    const AC = window.AtlasConsolidacao;
    const feitos = [], pulados = [];
    let nConv = 0, nPart = 0, totalRepasse = 0;
    for (const mes of meses) {
      if (AC && AC.estaConsolidado && AC.estaConsolidado(mes)) { pulados.push(mes); continue; }
      const convs = Banco.query(
        `SELECT a.id, a.posicao_no_frasco AS pos, f.total_aplicacoes AS tot, f.compartilhado AS comp
           FROM fracionamento_aplicacoes a
           JOIN fracionamento_frascos f ON f.id = a.frasco_id
          WHERE a.mes_ref = ? AND a.eh_particular = 0`, [mes]) || [];
      for (const c of convs) {
        const bruto = c.comp
          ? (Number(regra['brutoCompart' + c.tot]) || 0)
          : (Number(regra['bruto' + c.pos]) || 0);
        Banco.executar(
          `UPDATE fracionamento_aplicacoes
              SET valor_fracionamento = ?, valor_fixo = ?, valor_repasse = ?
            WHERE id = ?`, [bruto, fixo, bruto - fixo, c.id]);
        totalRepasse += bruto - fixo;
        nConv++;
      }
      const parts = Banco.query(
        `SELECT id, valor_fracionamento AS vf FROM fracionamento_aplicacoes
          WHERE mes_ref = ? AND eh_particular = 1
            AND UPPER(COALESCE(valor_origem,'')) IN ('QVIS','PRODUCAO')`, [mes]) || [];
      for (const p of parts) {
        const rep = (Number(p.vf) || 0) * pct / 100;
        Banco.executar(`UPDATE fracionamento_aplicacoes SET valor_repasse = ? WHERE id = ?`, [rep, p.id]);
        totalRepasse += rep;
        nPart++;
      }
      feitos.push(mes);
    }
    // invalida memos/fotos pra tudo refletir (Relatórios/Dashboard/Visão Geral)
    Banco._versao = (Banco._versao || 0) + 1;
    try { window.AtlasRelatorios && window.AtlasRelatorios.invalidarConsolidado && window.AtlasRelatorios.invalidarConsolidado(); } catch (_) {}
    return { feitos, pulados, nConv, nPart, totalRepasse };
  }

  // ──────────────────────────────────────────────────────────────────────
  // RENDERIZAÇÃO
  // ──────────────────────────────────────────────────────────────────────

  return function () {
    // Estado local
    if (window.__frac === undefined) {
      window.__frac = {
        painelConfigAberto: false,
        infoAberto: false,    // V128.4
        mes_ref: null,        // mês de referência selecionado
        categoria: 'total',   // 'total' | 'convenio' | 'particular'
        medico_id: null,      // null = todos
        ocultarSemValor: false,  // se true, esconde particulares com valor_origem='SEM_VALOR'
      };
    }
    // Fileira de filtros 20C + Ajuste de Matriz — chaves novas (defensivo pra
    // um __frac já existente de uma sessão anterior do módulo)
    if (window.__frac.filtroAdmissao === undefined) window.__frac.filtroAdmissao = '';
    if (window.__frac.filtroConvenio === undefined) window.__frac.filtroConvenio = '';
    if (window.__frac.sbAberto === undefined) window.__frac.sbAberto = null;
    if (!window.__frac.configColunas) window.__frac.configColunas = carregarConfigColunasFrac();

    renderizar();

    // ──────────────────────────────────────────────────────────────────────
    // HELPERS DE QUERY
    // ──────────────────────────────────────────────────────────────────────

    /** Lista meses (mes_ref) que têm aplicações, mais recentes primeiro. */
    function listarMesesComDados() {
      try {
        const r = Banco.query(`
          SELECT DISTINCT mes_ref FROM fracionamento_aplicacoes ORDER BY mes_ref DESC
        `);
        return r.map(x => x.mes_ref);
      } catch (e) { return []; }
    }

    /** Lista médicos que têm aplicações naquele mês (ordenado por nome). */
    function listarMedicosDoMes(mes_ref) {
      if (!mes_ref) return [];
      try {
        return Banco.query(`
          SELECT m.id, m.nome_oficial, m.tipo_vinculo,
                 COUNT(a.id) AS qtd_aplicacoes
            FROM medicos m
            JOIN fracionamento_aplicacoes a ON a.medico_id = m.id
           WHERE a.mes_ref = ?
           GROUP BY m.id, m.nome_oficial, m.tipo_vinculo
           ORDER BY m.nome_oficial
        `, [mes_ref]);
      } catch (e) { return []; }
    }

    /** Opções DISTINCT de admissão do mês (sem vazios), ordenadas. */
    function listarAdmissoesDoMes(mes_ref) {
      if (!mes_ref) return [];
      try {
        return (Banco.query(`
          SELECT DISTINCT admissao FROM fracionamento_aplicacoes
           WHERE mes_ref = ? AND admissao IS NOT NULL AND TRIM(admissao) <> ''
           ORDER BY admissao
        `, [mes_ref]) || []).map(r => String(r.admissao));
      } catch (e) { return []; }
    }

    /** Opções DISTINCT de convênio do mês (sem vazios), ordenadas. */
    function listarConveniosDoMes(mes_ref) {
      if (!mes_ref) return [];
      try {
        return (Banco.query(`
          SELECT DISTINCT convenio FROM fracionamento_aplicacoes
           WHERE mes_ref = ? AND convenio IS NOT NULL AND TRIM(convenio) <> ''
           ORDER BY convenio
        `, [mes_ref]) || []).map(r => String(r.convenio));
      } catch (e) { return []; }
    }

    /**
     * Filtros novos da fileira 20C (Admissão/Convênio) — criteria SQL comum,
     * aplicado em TUDO que a tela mostra (cards, matriz, contagem de ocultas).
     * `prefixo` = alias da tabela na query (ex.: 'a.') ou '' quando não há.
     */
    function criteriaFiltrosNovos(prefixo) {
      const state = window.__frac;
      const p = prefixo || '';
      let sql = '';
      const params = [];
      // V922: filtros MULTI — união de igualdades (string legada ou array)
      const _FMsel = Utilidades.filtroMulti.sel;
      const _selAdm = _FMsel(state.filtroAdmissao);
      if (_selAdm.length) { sql += ` AND ${p}admissao IN (${_selAdm.map(() => '?').join(',')})`; params.push(..._selAdm); }
      const _selConv = _FMsel(state.filtroConvenio);
      if (_selConv.length) { sql += ` AND ${p}convenio IN (${_selConv.map(() => '?').join(',')})`; params.push(..._selConv); }
      return { sql, params };
    }

    /**
     * Obtém contadores e somas faturadas do mês, opcionalmente filtrado
     * por médico (e pelos filtros novos Admissão/Convênio da fileira 20C).
     * Retorna 6 valores:
     *   qtd_convenio, qtd_particular, qtd_total,
     *   valor_convenio, valor_particular, valor_total
     */
    function obterDadosMes(mes_ref, medico_id) {
      if (!mes_ref) {
        return { qtd_convenio: 0, qtd_particular: 0, qtd_total: 0,
                 valor_convenio: 0, valor_particular: 0, valor_total: 0 };
      }
      const filtroMedico = medico_id != null ? ' AND medico_id = ?' : '';
      const params = medico_id != null ? [mes_ref, medico_id] : [mes_ref];
      const fn = criteriaFiltrosNovos('');
      params.push(...fn.params);
      try {
        const r = Banco.queryUnica(`
          SELECT
            COUNT(CASE WHEN eh_particular = 0 THEN 1 END) AS qtd_convenio,
            COUNT(CASE WHEN eh_particular = 1 THEN 1 END) AS qtd_particular,
            COUNT(*) AS qtd_total,
            COALESCE(SUM(CASE WHEN eh_particular = 0
              THEN COALESCE(valor_repasse_manual, valor_repasse) END), 0) AS valor_convenio,
            COALESCE(SUM(CASE WHEN eh_particular = 1
              THEN COALESCE(valor_repasse_manual, valor_repasse) END), 0) AS valor_particular,
            COALESCE(SUM(COALESCE(valor_repasse_manual, valor_repasse)), 0) AS valor_total
          FROM fracionamento_aplicacoes
          WHERE mes_ref = ?${filtroMedico}${fn.sql}
        `, params);
        return {
          qtd_convenio:    r?.qtd_convenio    || 0,
          qtd_particular:  r?.qtd_particular  || 0,
          qtd_total:       r?.qtd_total       || 0,
          valor_convenio:  r?.valor_convenio  || 0,
          valor_particular:r?.valor_particular|| 0,
          valor_total:     r?.valor_total     || 0,
        };
      } catch (e) {
        return { qtd_convenio: 0, qtd_particular: 0, qtd_total: 0,
                 valor_convenio: 0, valor_particular: 0, valor_total: 0 };
      }
    }

    /** Lista aplicações filtradas (paginação opcional via limit). */
    function listarAplicacoes(mes_ref, medico_id, categoria, limit) {
      if (!mes_ref) return [];
      const state = window.__frac;
      let where = ' WHERE a.mes_ref = ?';
      const params = [mes_ref];
      if (medico_id != null) { where += ' AND a.medico_id = ?'; params.push(medico_id); }
      // Filtros novos da fileira 20C (Admissão / Convênio)
      const fn = criteriaFiltrosNovos('a.');
      where += fn.sql;
      params.push(...fn.params);
      if (categoria === 'convenio') where += ' AND a.eh_particular = 0';
      if (categoria === 'particular') where += ' AND a.eh_particular = 1';
      // Ocultar particulares sem valor encontrado, se o checkbox estiver marcado
      if (state.ocultarSemValor) {
        where += ` AND NOT (a.eh_particular = 1 AND COALESCE(a.valor_origem, 'SEM_VALOR') = 'SEM_VALOR')`;
      }
      const limitSql = limit ? ` LIMIT ${parseInt(limit)}` : '';
      try {
        return Banco.query(`
          SELECT a.*, m.nome_oficial AS medico_oficial
            FROM fracionamento_aplicacoes a
            LEFT JOIN medicos m ON m.id = a.medico_id
          ${where}
           ORDER BY a.data_aplicacao, a.id${limitSql}
        `, params);
      } catch (e) { return []; }
    }

    // ──────────────────────────────────────────────────────────────────────
    // HELPERS DE DATA
    // ──────────────────────────────────────────────────────────────────────

    function pad2(n) { return String(n).padStart(2, '0'); }

    /** '2026-04' → '2026-03' */
    function mesAnterior(mes_ref) {
      const [a, m] = mes_ref.split('-').map(Number);
      if (m === 1) return `${a - 1}-12`;
      return `${a}-${pad2(m - 1)}`;
    }

    /** '2026-04' → '2025-04' */
    function mesAnoAnterior(mes_ref) {
      const [a, m] = mes_ref.split('-').map(Number);
      return `${a - 1}-${pad2(m)}`;
    }

    function formatarMes(mes_ref) {
      if (!mes_ref) return '—';
      const [ano, mes] = mes_ref.split('-');
      const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      return `${nomes[parseInt(mes) - 1]}/${ano.slice(2)}`;
    }

    function formatarMesLongo(mes_ref) {
      if (!mes_ref) return '—';
      const [ano, mes] = mes_ref.split('-');
      const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                     'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      return `${nomes[parseInt(mes) - 1]} / ${ano}`;
    }

    function nomeMes(mes_ref) {
      const [, m] = mes_ref.split('-');
      return ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
              'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][parseInt(m) - 1];
    }
    function nomeMesCAPS(mes_ref) {
      const [, m] = mes_ref.split('-');
      return ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
              'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'][parseInt(m) - 1];
    }

    // ──────────────────────────────────────────────────────────────────────
    // EXPORTAÇÃO XLSX
    // ──────────────────────────────────────────────────────────────────────

    /**
     * Exporta o mês de referência em formato compatível com o repasse mensal.
     *
     * Estrutura: 2 abas:
     *   1. "Regra de fracionamento" — snapshot da regra de pagamento atual
     *      (valor fixo + 4 brutos individuais + 3 brutos compartilhados).
     *   2. "Fracionamento_<Mês>" — aplicações de convênio do mês, com SUBTOTAL
     *      no topo e formato monetário nas colunas de valor.
     *
     * Particulares NÃO entram (segue o padrão da líder, que retira
     * particulares manualmente antes do repasse).
     *
     * Respeita o filtro de médico se houver um selecionado.
     *
     * V738: split 'medico' — no padrão do Fellow, o diálogo de opções da
     * extração permite gerar UMA ABA POR MÉDICO (a aba da Regra segue única).
     */
    function exportarMes(mes_ref, medico_id, split = 'none') {
      if (!mes_ref) return;
      if (!window.XLSX) {
        Utilidades.toast('Biblioteca de Excel não carregada', 'error');
        return;
      }

      // 1. Carrega aplicações do mês (sem particulares)
      let sql = `
        SELECT a.admissao, a.data_aplicacao, a.paciente,
               COALESCE(m.nome_oficial, a.medico_nome) AS medico_nome,
               a.convenio, a.observacao,
               a.valor_fracionamento, a.valor_fixo,
               COALESCE(a.valor_repasse_manual, a.valor_repasse) AS valor_repasse
          FROM fracionamento_aplicacoes a
          LEFT JOIN medicos m ON m.id = a.medico_id
         WHERE a.mes_ref = ? AND a.eh_particular = 0
      `;
      const params = [mes_ref];
      if (medico_id != null) { sql += ' AND a.medico_id = ?'; params.push(medico_id); }
      sql += ' ORDER BY a.data_aplicacao, a.id';

      const aplicacoes = Banco.query(sql, params);
      if (aplicacoes.length === 0) {
        Utilidades.toast('Não há aplicações de convênio para exportar', 'error');
        return;
      }

      const regra = lerRegra();
      const tituloAba = `FRACIONAMENTO ${nomeMesCAPS(mes_ref)} ${mes_ref.slice(0, 4)}`;

      // ── Formato monetário (mesmo do arquivo do usuário) ──
      const FMT_MOEDA = '_-"R$"\\ * #,##0.00_-;\\-"R$"\\ * #,##0.00_-;_-"R$"\\ * "-"??_-;_-@_-';
      const FMT_DATA  = 'dd/mm/yyyy';

      // ── ABA 1: Regra de fracionamento ──
      const dadosRegra = [
        ['Regra de Pagamento de Fracionamento'],
        [],
        ['Valor fixo retido pelo ATLAS (procedimento)', regra.valorFixo],
        [],
        ['Frasco INDIVIDUAL — Fracionamento bruto por posição'],
        ['1ª aplicação', regra.bruto1],
        ['2ª aplicação', regra.bruto2],
        ['3ª aplicação', regra.bruto3],
        ['4ª aplicação', regra.bruto4],
        [],
        ['Frasco COMPARTILHADO entre médicos'],
        ['2 aplicações', regra.brutoCompart2],
        ['3 aplicações', regra.brutoCompart3],
        ['4 aplicações', regra.brutoCompart4],
        [],
        ['Repasse ao médico = Fracionamento bruto − Valor fixo'],
      ];
      const wsRegra = XLSX.utils.aoa_to_sheet(dadosRegra);
      wsRegra['!cols'] = [{ wch: 52 }, { wch: 14 }];
      // Aplicar formato monetário nas células de valor
      ['B3', 'B6', 'B7', 'B8', 'B9', 'B12', 'B13', 'B14'].forEach(addr => {
        if (wsRegra[addr]) wsRegra[addr].z = FMT_MOEDA;
      });

      // ── ABA(s) de aplicações ──
      // Títulos personalizados do 🛠 Ajuste de Matriz valem no cabeçalho:
      // se a coluna foi renomeada, usa o nome custom; senão, o padrão do export.
      const cfgCols = window.__frac?.configColunas || carregarConfigColunasFrac();
      const tituloExport = (id, padraoExport) => {
        const c = cfgCols.find(x => x.id === id);
        const p = FRAC_COLUNAS_PADRAO.find(x => x.id === id);
        return (c && p && c.label && c.label !== p.label) ? c.label.toUpperCase() : padraoExport;
      };
      const cabecalho = [
        tituloExport('admissao', 'ADMISSÃO'), tituloExport('data', 'DATA'),
        tituloExport('paciente', 'PACIENTE'), tituloExport('medico', 'MEDICO'),
        tituloExport('convenio', 'CONVENIO'), tituloExport('observacao', 'OBSERVAÇÃO'),
        tituloExport('bruto', 'FRACIONAMENTO'), tituloExport('fixo', 'VALOR FIXO'),
        tituloExport('repasse', 'REPASSE'),
      ];

      /** Monta UMA aba de aplicações (título + SUBTOTAL + cabeçalho + linhas). */
      const montarAbaApl = (apls, titulo) => {
        const linhas = apls.map(a => [
          a.admissao ? (isNaN(Number(a.admissao)) ? a.admissao : Number(a.admissao)) : '',
          parseDataISO(a.data_aplicacao),
          a.paciente || '',
          a.medico_nome || '',
          a.convenio || '',
          a.observacao || '',
          Number(a.valor_fracionamento) || 0,
          Number(a.valor_fixo) || 0,
          Number(a.valor_repasse) || 0,
        ]);
        const ultimaLinha = linhas.length + 2;  // título(L1) + cabeçalho(L2) + N linhas
        const dadosApl = [
          // L1: título + fórmulas SUBTOTAL
          [titulo, null, null, null, null, null,
           { f: `SUBTOTAL(9,G3:G${ultimaLinha})`, t: 'n' },
           { f: `SUBTOTAL(9,H3:H${ultimaLinha})`, t: 'n' },
           { f: `SUBTOTAL(9,I3:I${ultimaLinha})`, t: 'n' }],
          cabecalho,
          ...linhas,
        ];
        const wsApl = XLSX.utils.aoa_to_sheet(dadosApl);
        wsApl['!cols'] = [
          { wch: 12 }, { wch: 11 }, { wch: 38 }, { wch: 22 },
          { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 13 },
        ];
        // Aplicar formatos: monetário em G/H/I + SUBTOTAL na L1; data em B
        for (let r = 1; r <= ultimaLinha; r++) {
          ['G', 'H', 'I'].forEach(col => {
            const addr = col + r;
            if (wsApl[addr] && (typeof wsApl[addr].v === 'number' || wsApl[addr].f)) {
              wsApl[addr].z = FMT_MOEDA;
            }
          });
          const cellB = wsApl['B' + r];
          if (cellB && cellB.v instanceof Date) {
            cellB.z = FMT_DATA;
          }
        }
        // Freeze panes na L2 (cabeçalho fixo ao rolar)
        wsApl['!freeze'] = { ySplit: 2, xSplit: 0, topLeftCell: 'A3', activePane: 'bottomLeft', state: 'frozen' };
        // SheetJS usa '!autofilter' para ativar filtros e '!freeze' não é padrão.
        // Padrão correto:
        wsApl['!autofilter'] = { ref: `A2:I${ultimaLinha}` };
        return wsApl;
      };
      const nomeAbaValido = (nome) => String(nome).replace(/[\\\/\?\*\[\]:]/g, '-').slice(0, 31) || 'Fracionamento';

      // ── Monta workbook ──
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsRegra, 'Regra de fracionamento');
      if (split === 'medico') {
        // V738: uma aba por médico (ordem alfabética), cada uma com o próprio
        // SUBTOTAL — a exibição usa o código quando o médico está mascarado
        const nomes = [...new Set(aplicacoes.map(a => a.medico_nome || 'SEM MÉDICO'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        for (const n of nomes) {
          const apls = aplicacoes.filter(a => (a.medico_nome || 'SEM MÉDICO') === n);
          XLSX.utils.book_append_sheet(wb, montarAbaApl(apls, `${tituloAba} — ${n}`), nomeAbaValido(CodigoMedico.exibir(n)));
        }
      } else {
        XLSX.utils.book_append_sheet(wb, montarAbaApl(aplicacoes, tituloAba), `Fracionamento_${nomeMes(mes_ref)}`);
      }

      // ── Download ──
      const sufixoMedico = medico_id != null ? '_filtrado' : '';
      const sufixoSplit = split === 'medico' ? '_por_medico' : '';
      const nomeArquivo = `Repasse_Fracionamento_${nomeMes(mes_ref)}_${mes_ref.slice(0, 4)}${sufixoSplit}${sufixoMedico}.xlsx`;
      try {
        XLSX.writeFile(wb, nomeArquivo);
        const msg = split === 'medico'
          ? `✓ Exportadas ${aplicacoes.length} aplicações (uma aba por médico)`
          : (medico_id != null
            ? `✓ Exportadas ${aplicacoes.length} aplicações (filtradas por médico)`
            : `✓ Exportadas ${aplicacoes.length} aplicações de convênio`);
        Utilidades.toast(msg, 'success', 4000);
      } catch (e) {
        console.error(e);
        Utilidades.toast('Erro ao gerar arquivo: ' + e.message, 'error');
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // V860: EXTRAÇÃO NO PADRÃO DO FELLOW
    //
    // O botão flutuante passa a abrir um MENU com os dois relatórios
    // estilizados (Sintética / Analítica, via ExcelJS: cabeçalho #107DAC,
    // subtotais em negrito, moeda) — o mesmo desenho do Fellow.
    //
    // A individualidade do ficheiro fica preservada em dois pontos:
    //  · a aba "Regra de fracionamento" acompanha os dois relatórios (é ela
    //    que explica de onde sai cada valor);
    //  · o "Repasse mensal", formato que a líder usa para fechar o mês
    //    (fórmulas SUBTOTAL, máscara de moeda própria, autofiltro), continua
    //    disponível no menu, intacto.
    // ────────────────────────────────────────────────────────────────────
    const _FRAC_FMT_MOEDA = '"R$" #,##0.00';
    const _FRAC_HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF107DAC' } };
    const _FRAC_HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
    const _FRAC_COLS = [
      { id: 'admissao',   label: 'Admissão',      largura: 12 },
      { id: 'data',       label: 'Data',          largura: 12 },
      { id: 'paciente',   label: 'Paciente',      largura: 38 },
      { id: 'medico',     label: 'Médico',        largura: 24 },
      { id: 'convenio',   label: 'Convênio',      largura: 22 },
      { id: 'observacao', label: 'Medicamento',   largura: 20 },
      { id: 'bruto',      label: 'Fracionamento', largura: 15, moeda: true },
      { id: 'fixo',       label: 'Valor fixo',    largura: 13, moeda: true },
      { id: 'repasse',    label: 'Repasse',       largura: 14, moeda: true },
    ];

    function _fracNomeAba(nome) {
      return String(nome).replace(/[\\\/\?\*\[\]:]/g, '-').slice(0, 31) || 'Fracionamento';
    }
    function _fracBaixarBuffer(buffer, nomeArquivo) {
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nomeArquivo;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
    function _fracPintarCabecalho(ws) {
      const h = ws.getRow(1);
      h.height = 22;
      h.eachCell({ includeEmpty: true }, (c) => {
        c.font = { ..._FRAC_HEADER_FONT };
        c.fill = { ..._FRAC_HEADER_FILL };
        c.alignment = { vertical: 'middle' };
      });
    }
    /** Aplicações de convênio do mês (particulares ficam de fora, como sempre). */
    function _fracAplicacoes(mes_ref, medico_id) {
      let sql = `
        SELECT a.admissao, a.data_aplicacao, a.paciente,
               COALESCE(m.nome_oficial, a.medico_nome) AS medico_nome,
               a.convenio, a.observacao,
               a.valor_fracionamento, a.valor_fixo,
               COALESCE(a.valor_repasse_manual, a.valor_repasse) AS valor_repasse
          FROM fracionamento_aplicacoes a
          LEFT JOIN medicos m ON m.id = a.medico_id
         WHERE a.mes_ref = ? AND a.eh_particular = 0`;
      const params = [mes_ref];
      if (medico_id != null) { sql += ' AND a.medico_id = ?'; params.push(medico_id); }
      sql += ' ORDER BY a.data_aplicacao, a.id';
      return Banco.query(sql, params) || [];
    }
    function _fracCel(c, a) {
      if (c.id === 'admissao')   return a.admissao || '';
      if (c.id === 'data')       return formatarDataBR(a.data_aplicacao);
      if (c.id === 'paciente')   return a.paciente || '';
      if (c.id === 'medico')     return a.medico_nome || '';
      if (c.id === 'convenio')   return a.convenio || '';
      if (c.id === 'observacao') return a.observacao || '';
      if (c.id === 'bruto')      return Number(a.valor_fracionamento) || 0;
      if (c.id === 'fixo')       return Number(a.valor_fixo) || 0;
      if (c.id === 'repasse')    return Number(a.valor_repasse) || 0;
      return '';
    }
    /** 'YYYY-MM-DD' → 'DD/MM/AAAA' (o export estilizado leva a data como texto). */
    function formatarDataBR(iso) {
      const d = parseDataISO(iso);
      if (!d) return '';
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
    }
    /** Aba com a REGRA vigente — acompanha os dois relatórios. */
    function _fracAbaRegra(wb) {
      const regra = lerRegra();
      const ws = wb.addWorksheet('Regra de fracionamento');
      ws.columns = [{ width: 52 }, { width: 16, style: { numFmt: _FRAC_FMT_MOEDA } }];
      const titulo = (t) => {
        const r = ws.addRow([t]);
        r.font = { bold: true, color: { argb: 'FF06283A' } };
        return r;
      };
      titulo('Regra de Pagamento de Fracionamento');
      ws.addRow([]);
      ws.addRow(['Valor fixo retido pelo ATLAS (procedimento)', Number(regra.valorFixo) || 0]);
      ws.addRow([]);
      titulo('Frasco INDIVIDUAL — Fracionamento bruto por posição');
      ws.addRow(['1ª aplicação', Number(regra.bruto1) || 0]);
      ws.addRow(['2ª aplicação', Number(regra.bruto2) || 0]);
      ws.addRow(['3ª aplicação', Number(regra.bruto3) || 0]);
      ws.addRow(['4ª aplicação', Number(regra.bruto4) || 0]);
      ws.addRow([]);
      titulo('Frasco COMPARTILHADO entre médicos');
      ws.addRow(['2 aplicações', Number(regra.brutoCompart2) || 0]);
      ws.addRow(['3 aplicações', Number(regra.brutoCompart3) || 0]);
      ws.addRow(['4 aplicações', Number(regra.brutoCompart4) || 0]);
      ws.addRow([]);
      ws.addRow(['Repasse ao médico = Fracionamento bruto − Valor fixo']);
    }
    /** Subconjuntos conforme a separação escolhida (uma aba cada). */
    function _fracSubconjuntos(split, mes_ref, medico_id) {
      const apls = _fracAplicacoes(mes_ref, medico_id);
      if (!apls.length) return [];
      const rotuloMes = `${nomeMesCAPS(mes_ref)} ${mes_ref.slice(0, 4)}`;
      if (split === 'medico') {
        return [...new Set(apls.map(a => a.medico_nome || 'SEM MÉDICO'))]
          .sort((a, b) => a.localeCompare(b, 'pt-BR'))
          .map(n => ({ aba: n, linhas: apls.filter(a => (a.medico_nome || 'SEM MÉDICO') === n),
            tituloTotal: `TOTAL ${n}` }));
      }
      return [{ aba: `Fracionamento_${nomeMes(mes_ref)}`, linhas: apls, tituloTotal: `TOTAL ${rotuloMes}` }];
    }
    /** Sintética: grupos por médico + subtotais + Total geral. */
    function _fracMatrizAoA(apls, tituloTotal) {
      const cols = _FRAC_COLS;
      const rows = [cols.map(c => c.label)];
      const porMedico = new Map();
      for (const a of apls) {
        const m = a.medico_nome || 'SEM MÉDICO';
        if (!porMedico.has(m)) porMedico.set(m, []);
        porMedico.get(m).push(a);
      }
      const soma = (ls, f) => ls.reduce((s, a) => s + (Number(f(a)) || 0), 0);
      const agregada = (rotulo, ls) => cols.map(c => {
        if (c.id === 'admissao') return rotulo;
        if (c.id === 'bruto')    return soma(ls, a => a.valor_fracionamento);
        if (c.id === 'fixo')     return soma(ls, a => a.valor_fixo);
        if (c.id === 'repasse')  return soma(ls, a => a.valor_repasse);
        return '';
      });
      for (const [medico, ls] of porMedico.entries()) {
        const cab = cols.map(() => '');
        cab[0] = `▼ ${medico} — ${ls.length} aplicaç${ls.length !== 1 ? 'ões' : 'ão'}`;
        rows.push(cab);
        ls.forEach(a => rows.push(cols.map(c => _fracCel(c, a))));
        rows.push(agregada('↳ Subtotal', ls));
      }
      rows.push(agregada(tituloTotal || 'TOTAL GERAL', apls));
      return rows;
    }
    async function exportarSinteticaFrac(subs, nomeArquivo) {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'ATLAS — Repasse Médico';
      wb.created = new Date();
      _fracAbaRegra(wb);
      for (const sub of subs) {
        const ws = wb.addWorksheet(_fracNomeAba(sub.aba), { views: [{ state: 'frozen', ySplit: 1 }] });
        ws.columns = _FRAC_COLS.map(c => ({
          width: c.largura, style: c.moeda ? { numFmt: _FRAC_FMT_MOEDA } : {} }));
        _fracMatrizAoA(sub.linhas, sub.tituloTotal).forEach((r, i) => {
          const row = ws.addRow(r);
          if (i === 0) return;
          const rotulo = String(r[0] == null ? '' : r[0]);
          if (rotulo.includes('Subtotal') || /^TOTAL/.test(rotulo) || rotulo.startsWith('▼')) {
            row.font = { bold: true };
          }
        });
        _fracPintarCabecalho(ws);
      }
      _fracBaixarBuffer(await wb.xlsx.writeBuffer(), nomeArquivo);
    }
    async function exportarAnaliticaFrac(subs, nomeArquivo) {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'ATLAS — Repasse Médico';
      wb.created = new Date();
      _fracAbaRegra(wb);
      for (const sub of subs) {
        const ws = wb.addWorksheet(_fracNomeAba(sub.aba), { views: [{ state: 'frozen', ySplit: 1 }] });
        ws.columns = _FRAC_COLS.map(c => ({
          header: c.label, key: c.id, width: c.largura,
          style: c.moeda ? { numFmt: _FRAC_FMT_MOEDA } : {} }));
        _fracPintarCabecalho(ws);
        for (const a of sub.linhas) {
          const obj = {};
          _FRAC_COLS.forEach(c => { obj[c.id] = _fracCel(c, a); });
          ws.addRow(obj);
        }
      }
      _fracBaixarBuffer(await wb.xlsx.writeBuffer(), nomeArquivo);
    }
    function exportarEstilizadoFrac(tipo, split = 'none') {
      const state = window.__frac;
      if (!state.mes_ref) { Utilidades.toast('Selecione um mês primeiro', 'warning'); return; }
      if (typeof ExcelJS === 'undefined') {
        Utilidades.toast('Biblioteca ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return;
      }
      const subs = _fracSubconjuntos(split, state.mes_ref, state.medico_id);
      if (!subs.length) { Utilidades.toast('Não há aplicações de convênio para exportar', 'warning'); return; }
      const base = tipo === 'analitica' ? 'Fracionamento_analitica' : 'Fracionamento';
      const suf = `${nomeMes(state.mes_ref)}_${state.mes_ref.slice(0, 4)}`;
      const nomeArquivo = split === 'medico'
        ? `${base}_por_medico_${suf}.xlsx` : `${base}_${suf}.xlsx`;
      const promessa = tipo === 'analitica'
        ? exportarAnaliticaFrac(subs, nomeArquivo)
        : exportarSinteticaFrac(subs, nomeArquivo);
      promessa
        .then(() => Utilidades.toast(subs.length > 1 ? `✓ Exportado (${subs.length} abas)` : '✓ Exportado', 'success'))
        .catch((e) => { console.error(e); Utilidades.toast('Falha ao exportar: ' + e.message, 'error', 4500); });
    }

    /** Menu do botão flutuante (o leque absorve o botão do cabeçalho). */
    function abrirMenuExportarFrac(btn) {
      const state = window.__frac;
      const mesLabel = state.mes_ref ? `${nomeMesCAPS(state.mes_ref)} ${state.mes_ref.slice(0, 4)}` : 'Selecione um mês';
      Utilidades.abrirMenuExportar(btn, [
        { icone: '⊞', titulo: 'Matriz Sintética', sub: `Grupos por médico + subtotais + Total geral · ${mesLabel}`,
          onClick: () => abrirOpcoesExtracaoFrac('matriz') },
        { icone: '≣', titulo: 'Matriz Analítica', sub: `Flat: 1 linha por aplicação, pronta p/ tabela dinâmica · ${mesLabel}`,
          onClick: () => abrirOpcoesExtracaoFrac('analitica') },
        'sep',
        { icone: '📤', titulo: 'Repasse mensal', tom: 'verde',
          sub: `Formato de fechamento do mês (SUBTOTAL + autofiltro) · ${mesLabel}`,
          onClick: () => abrirOpcoesExtracaoFrac('repasse') },
      ]);
    }

    /** V738: diálogo de OPÇÕES da extração (padrão do Fellow) — separar em
     *  abas por médico, ou tudo junto. V860: serve aos três relatórios. */
    function abrirOpcoesExtracaoFrac(tipo = 'repasse') {
      const state = window.__frac;
      document.getElementById('frac-ext-pop')?.remove();
      const nomeTipo = tipo === 'analitica' ? 'Matriz Analítica'
        : (tipo === 'matriz' ? 'Matriz Sintética' : 'Repasse mensal');
      const pop = document.createElement('div');
      pop.id = 'frac-ext-pop';
      pop.className = 'frac-ajm-fundo';
      pop.innerHTML = `
        <div class="frac-ajm-box" role="dialog" aria-modal="true" style="width: 380px">
          <h4>📤 ${nomeTipo} — opções</h4>
          <p>Como você quer separar o relatório? (as opções valem como filtros de agrupamento em abas)</p>
          ${[
            ['none', 'Tudo junto', 'Uma aba única com as aplicações de convênio do mês'],
            ['medico', 'Por médico', 'Uma aba por médico (cada uma com o próprio subtotal)'],
          ].map(([v, t, s], i) => `
            <label class="frac-ext-op">
              <input type="radio" name="frac-ext-split" value="${v}" ${i === 0 ? 'checked' : ''}>
              <span><strong>${t}</strong><small>${s}</small></span>
            </label>`).join('')}
          <div class="frac-ajm-acoes">
            <span style="flex:1"></span>
            <button class="btn btn-secondary" id="frac-ext-cancelar">Cancelar</button>
            <button class="btn btn-primary" id="frac-ext-gerar">Gerar</button>
          </div>
        </div>`;
      document.body.appendChild(pop);
      const fechar = () => pop.remove();
      pop.addEventListener('click', (e) => { if (e.target === pop) fechar(); });
      pop.querySelector('#frac-ext-cancelar').addEventListener('click', fechar);
      pop.querySelector('#frac-ext-gerar').addEventListener('click', () => {
        const split = (pop.querySelector('input[name="frac-ext-split"]:checked') || {}).value || 'none';
        fechar();
        if (tipo === 'repasse') exportarMes(state.mes_ref, state.medico_id, split);
        else exportarEstilizadoFrac(tipo, split);
      });
    }

    /** 'YYYY-MM-DD' → Date (sem timezone shift). */
    function parseDataISO(iso) {
      if (!iso) return null;
      const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return null;
      return new Date(+m[1], +m[2] - 1, +m[3]);
    }

    // ──────────────────────────────────────────────────────────────────────
    // RENDER PRINCIPAL
    // ──────────────────────────────────────────────────────────────────────

    function renderizar() {
      const state = window.__frac;
      const regra = lerRegra();
      const meses = listarMesesComDados();

      // Se ainda não há dados importados, mostra estado vazio
      if (meses.length === 0) {
        document.getElementById('conteudo').innerHTML = `
          <div class="page-content">
            ${renderHeader(meses)}
            ${renderPainelConfig(regra)}
            ${renderEstadoVazioInicial()}
          </div>
          ${getStyles()}
        `;
        bindEventos();
        return;
      }

      // Garante mes_ref válido (default: último mês importado)
      if (!state.mes_ref || !meses.includes(state.mes_ref)) {
        state.mes_ref = meses[0];
      }

      // Carrega tudo já filtrado pelo médico selecionado
      const dados = obterDadosMes(state.mes_ref, state.medico_id);
      const lm = obterDadosMes(mesAnterior(state.mes_ref), state.medico_id);
      const ly = obterDadosMes(mesAnoAnterior(state.mes_ref), state.medico_id);
      const medicosDoMes = listarMedicosDoMes(state.mes_ref);
      const aplicacoes = listarAplicacoes(state.mes_ref, state.medico_id, state.categoria, 500);

      document.getElementById('conteudo').innerHTML = `
        <div class="page-content">
          ${renderHeader(meses, medicosDoMes)}
          ${renderPainelConfig(regra)}
          ${renderCardsCategoria(dados, lm, ly)}
          ${renderTabela(aplicacoes)}
        </div>
        ${getStyles()}
      `;

      bindEventos();
    }

    function renderHeader(meses, medicosDoMes) {
      const state = window.__frac;
      return `
        <header class="page-header">
          <div>
            <div class="fic-titulo-wrap">
              <h2>Fracionamento</h2>
              <button class="fic-btn-info ${window.__frac.infoAberto ? 'fic-btn-info-ativo' : ''}"
                      id="frac-btn-info"
                      title="Ver regras do fichário Fracionamento">ⓘ</button>
            </div>
            ${window.__frac.infoAberto ? `
              <div class="fic-popover-info">
                <div class="fic-popover-info-head">
                  <strong>Regras Fracionamento</strong>
                  <button class="fic-popover-info-close" id="frac-info-close">✕</button>
                </div>
                <div class="fic-popover-info-body">
                  <p>
                    <strong>Contexto</strong> · Repasse a médicos pelo fracionamento de frascos
                    de injeções de retina (Eylia 2mg, Eylia 8mg). Cada frasco pode ser usado em
                    até <strong>4 aplicações</strong>; a líder do centro cirúrgico marca os grupos por COR
                    no relatório mensal.
                  </p>
                  <p>
                    <strong>Cálculo</strong> · <code>Repasse = Fracionamento Bruto − Valor Fixo Retido</code>
                  </p>
                  <ul>
                    <li><strong>Valor fixo retido pelo ATLAS</strong> (procedimento cirúrgico): <strong>R$ 418,52</strong></li>
                    <li><strong>Repasse por posição</strong> no frasco:
                      <code>1ª = R$ 450</code> · <code>2ª = R$ 550</code> ·
                      <code>3ª = R$ 700</code> · <code>4ª = R$ 900</code></li>
                    <li><strong>Frasco compartilhado</strong>: rateio IGUAL (média truncada em 2 casas — bate com Excel da líder)</li>
                    <li><strong>Particulares</strong>: regra padrão particular <strong>27%</strong> sobre o valor.</li>
                  </ul>
                  <p>
                    Todos os valores são <strong>configuráveis</strong> em ⚙ Ajustes.
                  </p>
                </div>
              </div>
            ` : ''}
            <div class="subtitle">Repasse por fracionamento de frascos de injeções intra-vítreas</div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-start">
            ${state.mes_ref ? `<button class="btn" id="btn-exportar-frac" title="Gera um .xlsx no formato do repasse mensal">📤 Exportar mês</button>` : ''}
            <button class="btn" id="btn-importar-frac">📥 Importar planilha</button>
            ${state.mes_ref ? `<button class="btn" id="btn-recalc-part" title="Recalcula os repasses dos particulares cruzando com a importação QVIS do mês atual">↻ Recalcular particulares</button>` : ''}
            ${state.mes_ref ? `<button class="btn" id="frac-btn-ajuste-matriz" title="Mostrar/ocultar e renomear as colunas da matriz">🛠 Ajuste de Matriz</button>` : ''}
            <button class="btn ${window.__frac.painelConfigAberto ? 'btn-primary' : ''}" id="btn-toggle-config">
              ⚙ Ajustes
            </button>
          </div>
        </header>
        ${meses.length > 0 ? `
          <!-- Fileira de filtros 20C — IRMÃ do header, esticada de ponta a ponta.
               Wrapper com classe contendo "filtro" (o leque #atlas-hub ignora). -->
          <div class="frac-filtros-wrap">
            ${renderBarraFiltrosFrac20C(meses, medicosDoMes || [])}
          </div>
        ` : ''}
      `;
    }

    // ──────────────────────────────────────────────────────────────────────
    // FILEIRA DE FILTROS 20C (padrão do LIO V727, prefixo frac-sb)
    // Células: Mês · Admissão · Médico · Convênio. Painéis abrem/fecham
    // LOCALMENTE (insertAdjacentHTML) — aplicar seta o state e re-renderiza.
    // ──────────────────────────────────────────────────────────────────────

    function renderBarraFiltrosFrac20C(meses, medicosDoMes) {
      const state = window.__frac;
      // guarda as listas pro painel abrir LOCAL depois, sem recoletar
      state._sbOpcoes = {
        meses: meses.map(m => ({ val: m, rotulo: formatarMesLongo(m) })),
        admissao: listarAdmissoesDoMes(state.mes_ref),
        medicos: medicosDoMes.map(m => ({
          val: String(m.id),
          rotulo: `${CodigoMedico.exibir(m.nome_oficial)} · ${m.qtd_aplicacoes}`,
        })),
        convenio: listarConveniosDoMes(state.mes_ref),
      };
      const medSel = medicosDoMes.find(m => m.id === state.medico_id);
      // V922: rótulo dos filtros multi ("N selecionados")
      const rotMulti = (f) => Utilidades.filtroMulti.ativo(f) ? Utilidades.filtroMulti.rotulo(f) : '';
      const cel = (id, rotulo, valor, icone, flex, vazio = 'Todos') => {
        const ativo = !!valor;
        const estaAberta = state.sbAberto === id;
        return `
          <div class="frac-sb-celwrap" style="flex:${flex}">
            <button type="button" class="frac-sb-cel ${ativo ? 'ativo' : ''} ${estaAberta ? 'aberta' : ''}"
                    data-sb-cel="${id}" data-sb-vazio="${vazio}" role="combobox" aria-expanded="${estaAberta ? 'true' : 'false'}" aria-haspopup="listbox">
              <span class="frac-sb-tile">${_fracSbSvg(_fracSbIc(icone), 14, 2.1)}</span>
              <span class="frac-sb-tx">
                <span class="frac-sb-rot">${rotulo}</span>
                <span class="frac-sb-val">${escapeHTML(valor || vazio)}</span>
              </span>
              <span class="frac-sb-chev">${_fracSbSvg(_fracSbIc('chev'), 10, 2.8)}</span>
            </button>
            ${estaAberta ? painelFrac20C(id) : ''}
          </div>`;
      };
      return `
        <div class="frac-sb" id="frac-sb">
          ${cel('mes', 'Mês', state.mes_ref ? formatarMesLongo(state.mes_ref) : '', 'calendar', 1, '—')}
          ${cel('admissao', 'Admissão', rotMulti(state.filtroAdmissao), 'alignleft', 1, 'Todas')}
          ${cel('medico', 'Médico', medSel ? `${CodigoMedico.exibir(medSel.nome_oficial)} · ${medSel.qtd_aplicacoes}` : '', 'userplus', 1.3)}
          ${cel('convenio', 'Convênio', rotMulti(state.filtroConvenio), 'creditcard', 1.1)}
        </div>`;
    }

    function painelFrac20C(id) {
      const state = window.__frac;
      const opc = state._sbOpcoes || {};
      const item = (val, rotulo, sel, chip) => `
        <div class="frac-sb-it ${sel ? 'sel' : ''} ${val === '' ? 'frac-sb-it-todos' : ''}" data-sb-item data-val="${escapeHTML(val)}" data-busca="${escapeHTML(_fracSbSemAcento(rotulo))}" role="option" aria-selected="${sel ? 'true' : 'false'}">
          ${chip ? `<span class="frac-sb-chip">${escapeHTML(_fracSbIniciais(rotulo))}</span>` : ''}
          <span class="frac-sb-it-nome">${escapeHTML(rotulo)}</span>
          ${sel ? `<span class="frac-sb-ck">${_fracSbSvg(_fracSbIc('check'), 14, 2.5)}</span>` : ''}
        </div>`;
      const painelLista = (cel, itens, { busca = false, chips = false, todosRotulo = 'Todos', comTodos = true, hint = '' } = {}) => `
        <div class="frac-sb-painel" data-sb-painel="${cel}">
          ${busca ? `
            <div class="frac-sb-buscabox">
              <span class="frac-sb-busca-ic">${_fracSbSvg(_fracSbIc('search'), 15, 2.1)}</span>
              <input type="text" class="frac-sb-busca" data-sb-busca placeholder="${hint || 'Digite pra buscar'}" autocomplete="off">
            </div>` : ''}
          <div class="frac-sb-lista" role="listbox">
            ${comTodos ? item('', todosRotulo, !itens.some(i => i.sel)) : ''}
            ${itens.slice(0, 400).map(i => item(i.val, i.rotulo, i.sel, chips)).join('')}
          </div>
          ${busca ? `<div class="frac-sb-rodape" data-sb-contagem>${itens.length} opç${itens.length === 1 ? 'ão' : 'ões'}</div>` : ''}
        </div>`;
      if (id === 'mes') {
        // Mês é OBRIGATÓRIO no módulo — lista curta SEM "Todos"
        return painelLista('mes',
          (opc.meses || []).map(m => ({ val: m.val, rotulo: m.rotulo, sel: state.mes_ref === m.val })),
          { comTodos: false });
      }
      if (id === 'admissao') {
        const selA = Utilidades.filtroMulti.sel(state.filtroAdmissao);   // V922
        const its = (opc.admissao || []).map(a => ({ val: a, rotulo: a, sel: selA.includes(String(a)) }));
        its.sort((a, b) => (b.sel ? 1 : 0) - (a.sel ? 1 : 0));
        return painelLista('admissao', its, { busca: true, todosRotulo: 'Todas' });
      }
      if (id === 'medico') {
        return painelLista('medico',
          (opc.medicos || []).map(m => ({ val: m.val, rotulo: m.rotulo, sel: String(state.medico_id) === m.val })),
          { busca: true, chips: true });
      }
      const selC = Utilidades.filtroMulti.sel(state.filtroConvenio);   // V922
      const itsC = (opc.convenio || []).map(c => ({ val: c, rotulo: c, sel: selC.includes(String(c)) }));
      itsC.sort((a, b) => (b.sel ? 1 : 0) - (a.sel ? 1 : 0));
      return painelLista('convenio', itsC, { busca: true });
    }

    function bindBarraFiltrosFrac20C() {
      const state = window.__frac;
      const sb = document.getElementById('frac-sb');
      if (!sb) return;
      const fecharPainelLocal = () => {
        sb.querySelectorAll('.frac-sb-painel').forEach(p => p.remove());
        sb.querySelectorAll('.frac-sb-cel.aberta').forEach(c => { c.classList.remove('aberta'); c.setAttribute('aria-expanded', 'false'); });
        state.sbAberto = null;
      };
      const aplicar = (celId, val) => {
        if (celId === 'mes') {
          if (!val) { fecharPainelLocal(); return; }   // mês é obrigatório
          state.mes_ref = val;
          // filtros dependentes do mês são limpos (mesma semântica do select antigo)
          state.medico_id = null;
          state.filtroAdmissao = '';
          state.filtroConvenio = '';
        } else if (celId === 'medico') {
          state.medico_id = val ? parseInt(val) : null;
        } else if (celId === 'admissao' || celId === 'convenio') {
          // V922: MULTI — alterna e mantém a lista aberta; "Todos" limpa
          const FM = Utilidades.filtroMulti;
          const campo = celId === 'admissao' ? 'filtroAdmissao' : 'filtroConvenio';
          const buscaEl = sb.querySelector('[data-sb-busca]');
          state._sbBusca = buscaEl ? buscaEl.value : '';
          state[campo] = val === '' ? [] : FM.toggle(state[campo], val);
          renderizar();   // sbAberto continua — o painel re-abre marcado
          return;
        }
        state._sbBusca = '';
        state.sbAberto = null;
        renderizar();
      };
      const wireInputsPainel = () => {
        const busca = sb.querySelector('[data-sb-busca]');
        if (!busca) return;
        setTimeout(() => busca.focus(), 0);
        const filtrar = () => {
          const q = _fracSbSemAcento(busca.value);
          const painel = busca.closest('.frac-sb-painel');
          let n = 0;
          painel.querySelectorAll('[data-sb-item]').forEach(el => {
            // V922: itens MARCADOS ficam sempre visíveis
            const mostra = el.classList.contains('frac-sb-it-todos') || el.classList.contains('sel') || !q || (el.dataset.busca || '').includes(q);
            el.style.display = mostra ? '' : 'none';
            if (mostra && !el.classList.contains('frac-sb-it-todos')) n++;
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
        btn.parentElement.insertAdjacentHTML('beforeend', painelFrac20C(id));
        wireInputsPainel();
      };
      // V922: o painel pode vir aberto do template (re-render após marcar)
      if (state.sbAberto && sb.querySelector('.frac-sb-painel')) wireInputsPainel();
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
        const painel = sb.querySelector('.frac-sb-painel');
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
      // Esc / clique-fora fecham (listeners globais únicos, substituídos a cada bind)
      if (window.__fracSbFechar) {
        document.removeEventListener('click', window.__fracSbFechar);
        document.removeEventListener('keydown', window.__fracSbEsc);
      }
      const fecharFora = (e) => {
        if (App.telaAtual !== 'desempenho-fracionamento') return;
        if (state.sbAberto && !e.target.closest('#frac-sb')) fecharPainelLocal();
      };
      const escFecha = (e) => { if (e.key === 'Escape' && state.sbAberto) fecharPainelLocal(); };
      window.__fracSbFechar = fecharFora;
      window.__fracSbEsc = escFecha;
      document.addEventListener('click', fecharFora);
      document.addEventListener('keydown', escFecha);
      if (state.sbAberto) wireInputsPainel();
    }

    function renderEstadoVazioInicial() {
      return `
        <div class="card frac-empty-card">
          <div style="font-size: 48px; opacity: 0.4; margin-bottom: 8px">💉</div>
          <h3 style="margin: 0 0 6px">Nenhum fracionamento importado ainda</h3>
          <p style="color: var(--ink-soft); margin: 0 0 16px; max-width: 540px">
            Importe a planilha de fracionamento que a líder do CC envia, ou ajuste a regra
            de pagamento antes da primeira importação.
          </p>
          <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap">
            <button class="btn btn-primary" id="btn-importar-frac-vazio">📥 Importar planilha</button>
            <button class="btn" id="btn-abrir-config-vazio">⚙ Ver a regra atual</button>
          </div>
        </div>
      `;
    }

    /**
     * Cards de categoria — clicáveis (filtram a tabela e o painel direito).
     * Cada card mostra: label, qtd, R$ faturado, vs LM e vs LY próprios.
     * O comparativo é feito sobre a QTD (sempre tem dado, mesmo p/ particulares).
     */
    function renderCardsCategoria(dados, lm, ly) {
      const state = window.__frac;
      const categorias = [
        { id: 'total',      label: 'Total',      qtd: dados.qtd_total,      valor: dados.valor_total,
          qtdLM: lm.qtd_total,      qtdLY: ly.qtd_total,      classe: 'destaque' },
        { id: 'convenio',   label: 'Convênio',   qtd: dados.qtd_convenio,   valor: dados.valor_convenio,
          qtdLM: lm.qtd_convenio,   qtdLY: ly.qtd_convenio,   classe: 'convenio' },
        { id: 'particular', label: 'Particular', qtd: dados.qtd_particular, valor: dados.valor_particular,
          qtdLM: lm.qtd_particular, qtdLY: ly.qtd_particular, classe: 'aviso' },
      ];

      return `
        <div class="frac-cards-grid">
          ${categorias.map(c => `
            <button
              class="frac-card-cat frac-card-${c.classe} ${state.categoria === c.id ? 'is-selected' : ''}"
              data-categoria="${c.id}"
              title="Clique para filtrar a tabela por ${c.label.toLowerCase()}">
              <div class="frac-card-label">${c.label}</div>
              <div class="frac-card-valor-monetario mono">R$ ${fmt(c.valor, 2)}</div>
              <div class="frac-card-qtd-rotulo">${c.qtd} aplicaç${c.qtd === 1 ? 'ão' : 'ões'}</div>
              <div class="frac-card-comparativos">
                ${renderCompMini('vs LM', c.qtd, c.qtdLM)}
                ${renderCompMini('vs LY', c.qtd, c.qtdLY)}
              </div>
            </button>
          `).join('')}
        </div>
      `;
    }

    /** Comparativo mini para usar dentro dos cards: "vs LM ↑ 8,6%" */
    function renderCompMini(label, atual, anterior) {
      if (anterior == null || anterior === 0) {
        return `
          <div class="frac-card-comp">
            <span class="frac-card-comp-label">${label}</span>
            <span class="frac-card-comp-vazio">—</span>
          </div>
        `;
      }
      const diff = atual - anterior;
      const pct = (diff / anterior) * 100;
      const arrow = Math.abs(pct) < 0.05 ? '·' : (diff > 0 ? '↑' : '↓');
      const classe = Math.abs(pct) < 0.05 ? 'neutro' : (diff > 0 ? 'positivo' : 'negativo');
      return `
        <div class="frac-card-comp">
          <span class="frac-card-comp-label">${label}</span>
          <span class="frac-card-comp-pct frac-card-comp-${classe} mono">${arrow} ${fmt(Math.abs(pct), 1)}%</span>
        </div>
      `;
    }

    /**
    /** Tabela detalhada de aplicações (1 linha por aplicação). */
    function renderTabela(aplicacoes) {
      const state = window.__frac;
      const labelCat = state.categoria === 'convenio' ? 'de convênio'
                     : state.categoria === 'particular' ? 'particulares'
                     : '';
      const totalApl = aplicacoes.length;

      // Conta quantas estão sendo ocultadas pelo filtro (só quando o checkbox está ativo)
      let totalOcultas = 0;
      if (state.ocultarSemValor && state.mes_ref) {
        try {
          const fn = criteriaFiltrosNovos('');
          const params = state.medico_id != null ? [state.mes_ref, state.medico_id] : [state.mes_ref];
          params.push(...fn.params);
          const r = Banco.queryUnica(`
            SELECT COUNT(*) AS n FROM fracionamento_aplicacoes
             WHERE mes_ref = ?
               AND eh_particular = 1
               AND COALESCE(valor_origem, 'SEM_VALOR') = 'SEM_VALOR'
               ${state.medico_id != null ? 'AND medico_id = ?' : ''}
               ${fn.sql}
          `, params);
          totalOcultas = r?.n || 0;
        } catch (e) { /* ignore */ }
      }

      // O checkbox só faz sentido se existem (ou podem existir) particulares
      const podeMostrarCheckbox = state.categoria !== 'convenio';

      if (totalApl === 0 && totalOcultas === 0) {
        return `
          <div class="card" style="text-align: center; padding: 30px; color: var(--ink-soft)">
            Nenhuma aplicação ${labelCat} para os filtros atuais.
          </div>
        `;
      }

      return `
        <div class="frac-tabela-wrap">
          <div class="frac-tabela-head">
            <h3 style="margin: 0; font-size: 14px">
              ${totalApl} aplicaç${totalApl > 1 ? 'ões' : 'ão'} ${labelCat}
              ${state.medico_id != null ? '· filtrado por médico' : ''}
              ${state.ocultarSemValor && totalOcultas > 0 ? `<small class="frac-ocultas-tag">${totalOcultas} oculta${totalOcultas > 1 ? 's' : ''}</small>` : ''}
            </h3>
            ${podeMostrarCheckbox ? `
              <label class="frac-checkbox-ocultar" title="Esconde particulares cuja admissão não foi achada no QVIS nem na Produção">
                <input type="checkbox" id="frac-chk-ocultar-sv" ${state.ocultarSemValor ? 'checked' : ''}>
                <span>Ocultar sem valor</span>
              </label>
            ` : ''}
          </div>
          <div class="frac-tabela-scroll">
            <table class="frac-tabela-aplicacoes">
              <thead>
                <tr>
                  ${colunasVisiveisFrac().map(c => `
                    <th class="${['pos', 'bruto', 'fixo', 'repasse'].includes(c.id) ? 'num' : ''}" data-col="${c.id}">${escapeHTML(c.label)}<span class="frac-col-resize" data-resize-col="${c.id}"></span></th>
                  `).join('')}
                </tr>
              </thead>
              <tbody>
                ${totalApl === 0 ? `
                  <tr><td colspan="${colunasVisiveisFrac().length}" style="text-align: center; padding: 20px; color: var(--ink-soft); font-style: italic">
                    Nenhuma aplicação visível — desmarque "Ocultar sem valor" para ver as ${totalOcultas} ocultas.
                  </td></tr>
                ` : aplicacoes.map(a => renderLinhaAplicacao(a)).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    /** Colunas visíveis segundo a config do Ajuste de Matriz. */
    function colunasVisiveisFrac() {
      const cfg = window.__frac.configColunas || (window.__frac.configColunas = carregarConfigColunasFrac());
      return cfg.filter(c => c.visivel);
    }

    function renderLinhaAplicacao(a) {
      const eh_part = a.eh_particular === 1;
      const repasse_efetivo = a.valor_repasse_manual != null ? a.valor_repasse_manual : a.valor_repasse;
      const tem_override = a.valor_repasse_manual != null;
      const sem_valor = eh_part && (a.valor_origem === 'SEM_VALOR' || ((a.valor_fracionamento || 0) <= 0 && !tem_override));
      // Badge curto da origem ("QVIS" ou "PROD")
      const labelOrigem = a.valor_origem === 'PRODUCAO' ? 'PROD' : a.valor_origem;
      const origemBadge = eh_part && a.valor_origem && a.valor_origem !== 'SEM_VALOR'
        ? `<span class="frac-origem-badge frac-origem-${a.valor_origem.toLowerCase()}" title="Valor produzido vindo de ${a.valor_origem === 'PRODUCAO' ? 'Produção' : 'QVIS'}">${labelOrigem}</span>`
        : '';

      // Colunas dirigidas pela config do Ajuste de Matriz. As 3 monetárias
      // (bruto/fixo/repasse) são sempre contíguas no fim — o "sem valor" das
      // particulares vira um colspan sobre as monetárias VISÍVEIS.
      const MONETARIAS = ['bruto', 'fixo', 'repasse'];
      const cols = colunasVisiveisFrac();
      const outras = cols.filter(c => !MONETARIAS.includes(c.id));
      const monetarias = cols.filter(c => MONETARIAS.includes(c.id));

      const celOutra = (c) => {
        if (c.id === 'data')       return `<td class="mono">${formatarData(a.data_aplicacao)}</td>`;
        if (c.id === 'admissao')   return `<td class="mono">${escapeHTML(a.admissao || '—')}</td>`;
        if (c.id === 'paciente')   return `<td>${escapeHTML(a.paciente || '')}</td>`;
        if (c.id === 'medico')     return `<td>${escapeHTML(CodigoMedico.exibir(a.medico_oficial || a.medico_nome || ''))}</td>`;
        if (c.id === 'convenio')   return `<td>${escapeHTML(a.convenio || '')}</td>`;
        if (c.id === 'observacao') return `<td>${escapeHTML(a.observacao || '')}</td>`;
        if (c.id === 'pos')        return `<td class="num mono">${a.posicao_no_frasco ?? '—'}</td>`;
        return '<td></td>';
      };
      const celMonetaria = (c) => {
        if (c.id === 'bruto') {
          if (eh_part) {
            return `<td class="num mono" title="Valor produzido na admissão (origem: ${a.valor_origem || 'QVIS'})">
              R$ ${fmt(a.valor_fracionamento, 2)} ${origemBadge}
            </td>`;
          }
          return `<td class="num mono">R$ ${fmt(a.valor_fracionamento, 2)}</td>`;
        }
        if (c.id === 'fixo') {
          return eh_part
            ? `<td class="num mono frac-deducao">—</td>`
            : `<td class="num mono frac-deducao">− R$ ${fmt(a.valor_fixo, 2)}</td>`;
        }
        // repasse
        return `<td class="num mono frac-total">
          R$ ${fmt(repasse_efetivo, 2)}
          ${tem_override ? `<small title="Override manual">✎</small>` : ''}
        </td>`;
      };

      const blocoMonetario = monetarias.length === 0 ? '' : (
        (eh_part && sem_valor) ? `
          <td class="num mono" colspan="${monetarias.length}" style="text-align: center">
            <button class="btn-link-detalhes" data-admissao="${escapeHTML(a.admissao || '')}" title="Ver detalhes desta admissão no QVIS e na Produção">
              ⚠ Sem valor · ver detalhes
            </button>
          </td>
        ` : monetarias.map(celMonetaria).join('')
      );

      return `
        <tr class="${eh_part ? 'frac-row-particular' : ''}">
          ${outras.map(celOutra).join('')}
          ${blocoMonetario}
        </tr>
      `;
    }

    /**
     * V-frac: largura de colunas ajustável na matriz — alças de arraste nos
     * th (mesmo mecanismo do LIO V721), persistência em localStorage.
     */
    function setupResizeColunasFrac() {
      const tabela = document.querySelector('.frac-tabela-aplicacoes');
      if (!tabela) return;
      const ler = () => {
        try { return JSON.parse(localStorage.getItem(FRAC_COLS_LARG_KEY) || '{}'); } catch (_) { return {}; }
      };
      const salvar = (l) => { try { localStorage.setItem(FRAC_COLS_LARG_KEY, JSON.stringify(l)); } catch (_) {} };
      const larguras = ler();
      Object.keys(larguras).forEach(idx => {
        const th = tabela.querySelector(`thead th[data-col="${idx}"]`);
        if (th && larguras[idx] >= 40) th.style.width = larguras[idx] + 'px';
      });
      tabela.querySelectorAll('.frac-col-resize').forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault(); e.stopPropagation();
          const idx = handle.dataset.resizeCol;
          const th = handle.parentElement;
          const startX = e.pageX;
          const startWidth = th.offsetWidth;
          document.body.classList.add('frac-redimensionando');
          handle.classList.add('frac-col-resize-ativa');
          const onMove = (ev) => { th.style.width = Math.max(40, startWidth + (ev.pageX - startX)) + 'px'; };
          const onUp = () => {
            document.body.classList.remove('frac-redimensionando');
            handle.classList.remove('frac-col-resize-ativa');
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
     * 🛠 AJUSTE DE MATRIZ (padrão do Fellow V725/V728): modal no <body> com,
     * por coluna, checkbox mostrar/ocultar + nome padrão + input de renomear.
     * Persiste em localStorage; títulos valem na matriz e no export Excel.
     */
    function abrirAjusteMatrizFrac() {
      document.getElementById('frac-ajuste-matriz-pop')?.remove();
      const cfg = window.__frac.configColunas || (window.__frac.configColunas = carregarConfigColunasFrac());
      const pop = document.createElement('div');
      pop.id = 'frac-ajuste-matriz-pop';
      pop.className = 'frac-ajm-fundo';
      pop.innerHTML = `
        <div class="frac-ajm-box" role="dialog" aria-modal="true">
          <h4>🛠 Ajuste de Matriz</h4>
          <p>Marque quais colunas aparecem e renomeie os títulos. Os nomes valem também pro cabeçalho do Excel exportado.</p>
          <div class="frac-ajm-head"><span></span><span class="frac-ajm-orig">Nome padrão</span><span style="flex:1; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color: var(--ink-faint)">Título exibido</span></div>
          ${cfg.map((c, i) => {
            const padrao = FRAC_COLUNAS_PADRAO.find(p => p.id === c.id);
            return `
            <label class="frac-ajm-linha">
              <input type="checkbox" class="frac-ajm-chk" data-col-idx="${i}" ${c.visivel ? 'checked' : ''} ${c.fixa ? 'disabled' : ''} title="${c.fixa ? 'Coluna fixa' : 'Mostrar/ocultar coluna'}">
              <span class="frac-ajm-orig" title="Nome padrão">${escapeHTML(padrao ? padrao.label : c.id)}${c.fixa ? ' <small>(fixa)</small>' : ''}</span>
              <input type="text" class="frac-ajm-inp" data-col-idx="${i}" value="${escapeHTML(c.label)}" maxlength="40">
            </label>`;
          }).join('')}
          <div class="frac-ajm-acoes">
            <button class="btn btn-secondary" id="frac-ajm-restaurar">Restaurar padrão</button>
            <span style="flex:1"></span>
            <button class="btn btn-secondary" id="frac-ajm-cancelar">Cancelar</button>
            <button class="btn btn-primary" id="frac-ajm-salvar">Salvar</button>
          </div>
        </div>`;
      document.body.appendChild(pop);
      const fechar = () => pop.remove();
      pop.addEventListener('click', (e) => { if (e.target === pop) fechar(); });
      pop.querySelector('#frac-ajm-cancelar').addEventListener('click', fechar);
      pop.querySelector('#frac-ajm-restaurar').addEventListener('click', () => {
        pop.querySelectorAll('.frac-ajm-inp').forEach((inp) => {
          const c = cfg[Number(inp.dataset.colIdx)];
          const padrao = FRAC_COLUNAS_PADRAO.find(p => p.id === c.id);
          inp.value = padrao ? padrao.label : c.label;
        });
        pop.querySelectorAll('.frac-ajm-chk').forEach((chk) => { chk.checked = true; });
      });
      pop.querySelector('#frac-ajm-salvar').addEventListener('click', () => {
        pop.querySelectorAll('.frac-ajm-inp').forEach((inp) => {
          const c = cfg[Number(inp.dataset.colIdx)];
          const v = inp.value.trim();
          if (v) c.label = v;
        });
        pop.querySelectorAll('.frac-ajm-chk').forEach((chk) => {
          const c = cfg[Number(chk.dataset.colIdx)];
          if (!c.fixa) c.visivel = chk.checked;
        });
        window.__frac.configColunas = cfg;
        salvarConfigColunasFrac(cfg);
        fechar();
        Utilidades.toast('✓ Matriz atualizada (colunas e títulos)', 'success', 2500);
        renderizar();
      });
    }

    /**
     * Modal de diagnóstico para uma admissão particular sem valor encontrado.
     * Mostra TODAS as linhas dessa admissão no QVIS e na Produção pra o usuário
     * entender por que o cruzamento não trouxe valor.
     */
    function mostrarModalDetalhesAdmissao(admissao) {
      const state = window.__frac;
      const apl = Banco.queryUnica(`
        SELECT a.*, m.nome_oficial AS medico_oficial
          FROM fracionamento_aplicacoes a
          LEFT JOIN medicos m ON m.id = a.medico_id
         WHERE a.mes_ref = ? AND a.admissao = ? AND a.eh_particular = 1
         LIMIT 1
      `, [state.mes_ref, admissao]);
      if (!apl) {
        Utilidades.toast('Admissão não encontrada', 'error');
        return;
      }

      let det = { qvis: [], producao: [] };
      try {
        det = window.ImportFracionamento.buscarDetalhesAdmissao(admissao, state.mes_ref);
      } catch (e) { console.warn(e); }

      const overlay = document.createElement('div');
      overlay.className = 'frac-detalhes-overlay';
      overlay.innerHTML = `
        <div class="frac-detalhes-modal">
          <div class="frac-detalhes-head">
            <div>
              <h3>Diagnóstico — admissão ${escapeHTML(admissao)}</h3>
              <small>Por que essa admissão particular ficou sem valor produzido</small>
            </div>
            <button class="frac-detalhes-fechar" aria-label="Fechar">✕</button>
          </div>

          <div class="frac-detalhes-body">
            <div class="frac-detalhes-info">
              <div><strong>Paciente:</strong> ${escapeHTML(apl.paciente || '—')}</div>
              <div><strong>Data:</strong> ${formatarData(apl.data_aplicacao)}</div>
              <div><strong>Médico:</strong> ${escapeHTML(CodigoMedico.exibir(apl.medico_oficial || apl.medico_nome || '—'))}</div>
              <div><strong>Convênio:</strong> ${escapeHTML(apl.convenio || '—')}</div>
              <div><strong>Medicamento:</strong> ${escapeHTML(apl.observacao || '—')}</div>
            </div>

            <h4>🔍 Busca 1 — QVIS (origem = PARTICULAR)</h4>
            ${det.qvis.length === 0 ? `
              <div class="frac-detalhes-vazio">Nenhuma linha encontrada para esta admissão no QVIS de ${formatarMes(state.mes_ref)}.</div>
            ` : `
              <p class="frac-detalhes-help">Critério: procedimento contém "INJEÇÃO INTRA VÍTREA". Linhas encontradas:</p>
              <table class="frac-detalhes-tabela">
                <thead>
                  <tr>
                    <th>Papel</th>
                    <th>Procedimento</th>
                    <th class="num">Qtd</th>
                    <th class="num">Produzido</th>
                    <th>Recebimento</th>
                  </tr>
                </thead>
                <tbody>
                  ${det.qvis.map(l => {
                    const proc = String(l.procedimento || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                    const matchaFiltro = proc.includes('INJECAO INTRA VITREA');
                    return `<tr class="${matchaFiltro ? 'frac-detalhes-match' : ''}">
                      <td><small>${escapeHTML(l.papel || '—')}</small></td>
                      <td>${escapeHTML(l.procedimento || '')} ${matchaFiltro ? '<small class="frac-tag-match">✓ match</small>' : ''}</td>
                      <td class="num mono">${l.quantidade || 0}</td>
                      <td class="num mono">R$ ${fmt(l.produzido, 2)}</td>
                      <td>${l.tipo_recebimento ? Utilidades.badgeFonte(l.tipo_recebimento) : '—'}</td><!-- V947 -->
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            `}

            <h4>🔍 Busca 2 — Produção (tipo_recebimento = PARTICULAR)</h4>
            ${det.producao.length === 0 ? `
              <div class="frac-detalhes-vazio">Nenhuma linha encontrada para esta admissão na Produção de ${formatarMes(state.mes_ref)}.</div>
            ` : `
              <p class="frac-detalhes-help">Critério: subcategoria contém "INJECAO" ou procedimento contém "INJEÇÃO INTRA VÍTREA". Linhas encontradas:</p>
              <table class="frac-detalhes-tabela">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th>Subcategoria</th>
                    <th>Procedimento</th>
                    <th class="num">Qtd</th>
                    <th class="num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  ${det.producao.map(l => {
                    const subcat = String(l.subcategoria || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                    const proc = String(l.procedimento_principal || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                    const matchaFiltro = subcat.includes('INJECAO') || proc.includes('INJECAO INTRA VITREA');
                    return `<tr class="${matchaFiltro ? 'frac-detalhes-match' : ''}">
                      <td><small>${escapeHTML(l.categoria || '—')}</small></td>
                      <td><small>${escapeHTML(l.subcategoria || '—')}</small></td>
                      <td>${escapeHTML(l.procedimento_principal || '')} ${matchaFiltro ? '<small class="frac-tag-match">✓ match</small>' : ''}</td>
                      <td class="num mono">${l.quantidade || 0}</td>
                      <td class="num mono">R$ ${fmt(l.valor, 2)}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            `}

            <div class="frac-detalhes-conclusao">
              <strong>Resultado:</strong>
              ${(det.qvis.length === 0 && det.producao.length === 0)
                ? 'A admissão não foi encontrada em nenhuma das fontes. Verifique se as importações (QVIS e Produção) do mês foram feitas.'
                : 'Nenhuma das linhas casou com o critério (INJEÇÃO INTRA VÍTREA / subcategoria INJEÇÃO). A admissão pode ser de outro tipo de procedimento, ou a descrição na fonte é diferente do esperado.'}
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const fechar = () => overlay.remove();
      overlay.querySelector('.frac-detalhes-fechar').addEventListener('click', fechar);
      overlay.addEventListener('click', e => { if (e.target === overlay) fechar(); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', esc); }
      });
    }

    function formatarData(iso) {
      if (!iso) return '—';
      const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return iso;
      return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
    }
    function escapeHTML(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }

    function renderPainelConfig(regra) {
      if (!window.__frac.painelConfigAberto) return '';

      const fixo = Number(regra.valorFixo) || 0;

      // Linhas individuais: 1 por posição
      const linhasIndividual = [1, 2, 3, 4].map(pos => {
        const bruto = Number(regra['bruto' + pos]) || 0;
        return { id: 'bruto' + pos, label: pos + 'ª aplicação', bruto, repasse: bruto - fixo };
      });

      // Linhas compartilhado: 1 por cenário (2/3/4 aplicações)
      const linhasCompartilhado = [2, 3, 4].map(n => {
        const bruto = Number(regra['brutoCompart' + n]) || 0;
        return { id: 'brutoCompart' + n, label: n + ' aplicações', bruto, repasse: bruto - fixo };
      });

      return `
        <div class="frac-cfg-overlay" id="frac-cfg-overlay"></div>
        <div class="frac-cfg-modal" id="frac-cfg-modal" role="dialog" aria-modal="true">
        <button class="frac-cfg-fechar" id="btn-cfg-fechar" type="button" aria-label="Fechar">✕</button>
        <div class="card frac-cfg-card">
          <div class="frac-cfg-head">
            <div>
              <h3 class="card-title" style="margin: 0">Regra de pagamento</h3>
              <p class="card-subtitle" style="margin: 4px 0 0">
                <strong>Repasse = Fracionamento bruto − Valor fixo.</strong>
                Clique em qualquer valor para editar — salva ao sair do campo.
              </p>
            </div>
            <div class="frac-cfg-acoes">
              <button class="btn btn-pequeno" id="btn-cfg-sincronizar"
                      title="Recalcula os valores compartilhados como média truncada dos individuais">
                ↻ Sincronizar
              </button>
              <button class="btn btn-pequeno" id="btn-cfg-restaurar"
                      title="Volta aos valores padrão de fábrica">↺ Padrão</button>
              <button class="btn btn-pequeno" id="btn-cfg-recalcular" style="background:var(--primary,#16456B);color:#fff;border-color:transparent"
                      title="Reaplica a regra atual sobre as aplicações já importadas de TODOS os meses ainda não consolidados. Meses consolidados são preservados (registro oficial).">
                ⟳ Recalcular Fracionamento
              </button>
            </div>
          </div>

          <!-- Linha discreta do valor fixo (mesma altura dos demais inputs) -->
          <div class="frac-fixo-linha">
            <label class="frac-fixo-label">Valor fixo:</label>
            <div class="frac-input-wrap frac-input-wrap-md">
              <span class="frac-input-prefix">R$</span>
              <input type="number" step="0.01" min="0"
                     class="frac-input-num frac-input-edit"
                     data-campo="valorFixo"
                     value="${fixo.toFixed(2)}">
            </div>
            <small class="frac-fixo-help">Procedimento cirúrgico — deduzido em toda aplicação fracionada</small>
          </div>

          <!-- Linha do % Particular -->
          <div class="frac-fixo-linha">
            <label class="frac-fixo-label">Particular:</label>
            <div class="frac-input-wrap frac-input-wrap-md">
              <input type="number" step="0.01" min="0" max="100"
                     class="frac-input-num frac-input-edit"
                     data-campo="pctParticular"
                     value="${(Number(regra.pctParticular) || 0).toFixed(2)}">
              <span class="frac-input-prefix frac-input-suffix">%</span>
            </div>
            <small class="frac-fixo-help">
              Percentual sobre o valor produzido (procedimento "INJEÇÃO INTRA VÍTREA") da admissão,
              buscado na importação do QVIS do mesmo mês.
            </small>
          </div>

          <div class="frac-tabelas-grid">

            <div class="frac-tabela-preview">
              <div class="frac-tabela-titulo">📘 Frasco com UM ÚNICO médico</div>
              <table class="frac-preview-table">
                <thead>
                  <tr>
                    <th>Posição</th>
                    <th class="num">Fracionamento bruto</th>
                    <th class="num">− Valor fixo</th>
                    <th class="num">= Repasse</th>
                  </tr>
                </thead>
                <tbody>
                  ${linhasIndividual.map(l => `
                    <tr>
                      <td><strong>${l.label}</strong></td>
                      <td class="num">
                        <div class="frac-input-wrap frac-input-wrap-inline">
                          <span class="frac-input-prefix-mini">R$</span>
                          <input type="number" step="0.01" min="0"
                                 class="frac-input-num frac-input-inline frac-input-edit"
                                 data-campo="${l.id}"
                                 value="${l.bruto.toFixed(2)}">
                        </div>
                      </td>
                      <td class="num mono frac-deducao" data-campo-deducao="${l.id}">− R$ ${fmt(fixo, 2)}</td>
                      <td class="num mono frac-total" data-campo-repasse="${l.id}">R$ ${fmt(l.repasse, 2)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>

            <div class="frac-tabela-preview">
              <div class="frac-tabela-titulo">📕 Frasco COMPARTILHADO entre médicos</div>
              <table class="frac-preview-table">
                <thead>
                  <tr>
                    <th>Cenário</th>
                    <th class="num">Fracionamento bruto</th>
                    <th class="num">− Valor fixo</th>
                    <th class="num">= Repasse</th>
                  </tr>
                </thead>
                <tbody>
                  ${linhasCompartilhado.map(l => `
                    <tr>
                      <td><strong>${l.label}</strong></td>
                      <td class="num">
                        <div class="frac-input-wrap frac-input-wrap-inline">
                          <span class="frac-input-prefix-mini">R$</span>
                          <input type="number" step="0.01" min="0"
                                 class="frac-input-num frac-input-inline frac-input-edit"
                                 data-campo="${l.id}"
                                 value="${l.bruto.toFixed(2)}">
                        </div>
                      </td>
                      <td class="num mono frac-deducao" data-campo-deducao="${l.id}">− R$ ${fmt(fixo, 2)}</td>
                      <td class="num mono frac-total" data-campo-repasse="${l.id}">R$ ${fmt(l.repasse, 2)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              <small class="frac-tabela-nota">
                Editáveis individualmente. Use <strong>↻ Sincronizar</strong> para calcular como média dos brutos individuais (regra original).
              </small>
            </div>

          </div>
        </div>
        </div>
      `;
    }

    // ──────────────────────────────────────────────────────────────────────
    // BIND DE EVENTOS
    // ──────────────────────────────────────────────────────────────────────

    function bindEventos() {
      const state = window.__frac;

      // ── Fileira de filtros 20C (Mês · Admissão · Médico · Convênio) ──
      bindBarraFiltrosFrac20C();

      // ── Cards de categoria (clicáveis) ──
      document.querySelectorAll('.frac-card-cat').forEach(btn => {
        btn.addEventListener('click', () => {
          state.categoria = btn.dataset.categoria;
          renderizar();
        });
      });

      // ── Largura de colunas ajustável na matriz (alças nos th) ──
      setupResizeColunasFrac();

      // ── 🛠 Ajuste de Matriz (modal no <body>) ──
      const btnAjM = document.getElementById('frac-btn-ajuste-matriz');
      if (btnAjM) btnAjM.addEventListener('click', abrirAjusteMatrizFrac);

      const btnToggle = document.getElementById('btn-toggle-config');
      if (btnToggle) {
        btnToggle.addEventListener('click', () => {
          window.__frac.painelConfigAberto = !window.__frac.painelConfigAberto;
          renderizar();
        });
      }

      // V414: Ajustes vira MODAL (pop-up) — move overlay+modal pro document.body
      // (escapa o transform do .main, como no OPME/LIO) e amarra os fechamentos.
      document.querySelectorAll('body > .frac-cfg-overlay, body > .frac-cfg-modal').forEach(el => el.remove());
      if (window.__frac.painelConfigAberto) {
        const cont = document.getElementById('conteudo');
        const ov = cont ? cont.querySelector('.frac-cfg-overlay') : null;
        const md = cont ? cont.querySelector('.frac-cfg-modal') : null;
        if (ov) document.body.appendChild(ov);
        if (md) document.body.appendChild(md);
        const fecharCfg = () => { window.__frac.painelConfigAberto = false; renderizar(); };
        if (ov) ov.addEventListener('click', fecharCfg);
        const btnX = md ? md.querySelector('#btn-cfg-fechar') : null;
        if (btnX) btnX.addEventListener('click', fecharCfg);
        if (!window.__fracEscCfg) {
          window.__fracEscCfg = true;
          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && window.__frac && window.__frac.painelConfigAberto) {
              window.__frac.painelConfigAberto = false; renderizar();
            }
          });
        }
      }

      // ⓘ Botão Info (V128.4)
      const btnFracInfo = document.getElementById('frac-btn-info');
      if (btnFracInfo) btnFracInfo.addEventListener('click', () => {
        window.__frac.infoAberto = !window.__frac.infoAberto;
        renderizar();
      });
      const btnFracInfoClose = document.getElementById('frac-info-close');
      if (btnFracInfoClose) btnFracInfoClose.addEventListener('click', () => {
        window.__frac.infoAberto = false;
        renderizar();
      });

      const btnAbrirVazio = document.getElementById('btn-abrir-config-vazio');
      if (btnAbrirVazio) {
        btnAbrirVazio.addEventListener('click', () => {
          window.__frac.painelConfigAberto = true;
          renderizar();
        });
      }

      // Abrir modal de importação (header e estado vazio)
      const abrirImport = () => {
        if (!window.ImportFracionamento) {
          Utilidades.toast('Módulo de importação não carregado', 'error');
          return;
        }
        window.ImportFracionamento.abrirModal(() => {
          // Callback após importação concluída — re-renderiza pra atualizar contadores
          renderizar();
        });
      };
      const btnImpHeader = document.getElementById('btn-importar-frac');
      if (btnImpHeader) btnImpHeader.addEventListener('click', abrirImport);
      const btnImpVazio = document.getElementById('btn-importar-frac-vazio');
      if (btnImpVazio) btnImpVazio.addEventListener('click', abrirImport);

      // ── Exportar (botão do header, absorvido pelo leque flutuante) ──
      // V860: abre o MENU no padrão do Fellow — Sintética / Analítica
      // estilizadas + o Repasse mensal que a líder já usava
      const btnExp = document.getElementById('btn-exportar-frac');
      if (btnExp) {
        btnExp.addEventListener('click', () => abrirMenuExportarFrac(btnExp));
      }

      // ── Recalcular particulares (cruza com produção do mês) ──
      const btnRecalc = document.getElementById('btn-recalc-part');
      if (btnRecalc) {
        btnRecalc.addEventListener('click', async () => {
          if (!state.mes_ref) return;
          if (!window.ImportFracionamento?.recalcularParticulares) {
            Utilidades.toast('Módulo de importação não carregado', 'error');
            return;
          }
          Utilidades.mostrarLoading('Recalculando particulares...');
          try {
            const r = await window.ImportFracionamento.recalcularParticulares(state.mes_ref);
            Utilidades.esconderLoading();
            if (r.total === 0) {
              Utilidades.toast('Nenhum particular neste mês para recalcular', 'info');
            } else {
              const partes = [];
              if (r.encontrados_qvis > 0)     partes.push(`${r.encontrados_qvis} via QVIS`);
              if (r.encontrados_producao > 0) partes.push(`${r.encontrados_producao} via Produção`);
              if (r.sem_valor > 0)            partes.push(`${r.sem_valor} sem valor`);
              const tipo = r.sem_valor === 0 ? 'success' : 'info';
              Utilidades.toast(
                `${partes.join(' · ')} — repasse total R$ ${Utilidades.formatarNumero(r.total_repasse, 2)}`,
                tipo, 5000
              );
            }
            renderizar();
          } catch (e) {
            Utilidades.esconderLoading();
            console.error(e);
            Utilidades.toast('Erro: ' + e.message, 'error');
          }
        });
      }

      // ── Botões "Ver detalhes" das linhas particulares sem valor ──
      document.querySelectorAll('.btn-link-detalhes').forEach(btn => {
        btn.addEventListener('click', () => {
          const adm = btn.dataset.admissao;
          if (!adm) return;
          mostrarModalDetalhesAdmissao(adm);
        });
      });

      // ── Checkbox "Ocultar sem valor" ──
      const chkOcultar = document.getElementById('frac-chk-ocultar-sv');
      if (chkOcultar) {
        chkOcultar.addEventListener('change', () => {
          state.ocultarSemValor = chkOcultar.checked;
          renderizar();
        });
      }

      // V623: recalcular o fracionamento inteiro (meses NÃO consolidados) com a regra atual
      const btnRecalcTudo = document.getElementById('btn-cfg-recalcular');
      if (btnRecalcTudo) {
        btnRecalcTudo.addEventListener('click', async () => {
          if (!confirm('Recalcular o FRACIONAMENTO com a regra atual?\n\n' +
                       '· Reaplica os valores (brutos, valor fixo e % particular) sobre TODAS as aplicações já importadas.\n' +
                       '· Meses CONSOLIDADOS são preservados (não mudam).\n' +
                       '· Overrides manuais de repasse são mantidos.')) return;
          Utilidades.mostrarLoading?.('Recalculando fracionamento...');
          try {
            const r = recalcularFracionamento();
            await Banco.salvar();
            Utilidades.esconderLoading?.();
            if (!r.feitos.length && !r.pulados.length) {
              Utilidades.toast('Nenhuma aplicação de fracionamento importada ainda.', 'info', 4000);
            } else if (!r.feitos.length) {
              Utilidades.toast(`🔒 Nada recalculado — ${r.pulados.length === 1 ? 'o único mês está' : 'todos os ' + r.pulados.length + ' meses estão'} consolidado${r.pulados.length === 1 ? '' : 's'} (${r.pulados.join(', ')}).`, 'info', 6000);
            } else {
              const extra = r.pulados.length ? ` · 🔒 ${r.pulados.length} mês${r.pulados.length === 1 ? '' : 'es'} consolidado${r.pulados.length === 1 ? '' : 's'} preservado${r.pulados.length === 1 ? '' : 's'} (${r.pulados.join(', ')})` : '';
              Utilidades.toast(`✓ Fracionamento recalculado: ${r.feitos.join(', ')} — ${r.nConv} convênio + ${r.nPart} particular = R$ ${fmt(r.totalRepasse, 2)}${extra}`, 'success', 8000);
            }
            renderizar();
          } catch (e) {
            Utilidades.esconderLoading?.();
            console.error('[fracionamento] recalcular:', e);
            Utilidades.toast('Erro ao recalcular: ' + (e.message || e), 'error', 5000);
          }
        });
      }

      const btnRestaurar = document.getElementById('btn-cfg-restaurar');
      if (btnRestaurar) {
        btnRestaurar.addEventListener('click', async () => {
          if (!confirm('Restaurar TODOS os valores para o padrão de fábrica?\n\n' +
                       '· Valor fixo: R$ 418,52\n' +
                       '· Bruto individual: 868,52 · 968,52 · 1.118,52 · 1.318,52\n' +
                       '· Bruto compartilhado: 918,52 · 985,18 · 1.068,52')) {
            return;
          }
          try {
            for (const [chave, valor] of [
              ['VALOR_FIXO',             REGRA_PADRAO.valorFixo],
              ['VALOR_BRUTO_POS1',       REGRA_PADRAO.bruto1],
              ['VALOR_BRUTO_POS2',       REGRA_PADRAO.bruto2],
              ['VALOR_BRUTO_POS3',       REGRA_PADRAO.bruto3],
              ['VALOR_BRUTO_POS4',       REGRA_PADRAO.bruto4],
              ['VALOR_BRUTO_COMPART_2',  REGRA_PADRAO.brutoCompart2],
              ['VALOR_BRUTO_COMPART_3',  REGRA_PADRAO.brutoCompart3],
              ['VALOR_BRUTO_COMPART_4',  REGRA_PADRAO.brutoCompart4],
              ['PCT_PARTICULAR',         REGRA_PADRAO.pctParticular],
            ]) {
              await setCfg(chave, valor);
            }
            Utilidades.toast('✓ Regra restaurada para os valores padrão', 'success');
            renderizar();
          } catch (e) {
            console.error(e);
            Utilidades.toast('Erro: ' + e.message, 'error');
          }
        });
      }

      // Botão "↻ Sincronizar": recalcula os 3 brutos compartilhados como
      // média truncada dos 4 brutos individuais (regra original do ATLAS).
      const btnSincronizar = document.getElementById('btn-cfg-sincronizar');
      if (btnSincronizar) {
        btnSincronizar.addEventListener('click', async () => {
          const r = lerRegra();
          const brutos = [r.bruto1, r.bruto2, r.bruto3, r.bruto4];
          const novos = {};
          for (const n of [2, 3, 4]) {
            const media = brutos.slice(0, n).reduce((a, b) => a + b, 0) / n;
            novos[n] = Math.floor(media * 100) / 100;
          }
          const msg =
            'Recalcular os 3 brutos compartilhados como média truncada dos brutos individuais?\n\n' +
            `· 2 aplicações:  R$ ${fmt(novos[2], 2)}  (atual: R$ ${fmt(r.brutoCompart2, 2)})\n` +
            `· 3 aplicações:  R$ ${fmt(novos[3], 2)}  (atual: R$ ${fmt(r.brutoCompart3, 2)})\n` +
            `· 4 aplicações:  R$ ${fmt(novos[4], 2)}  (atual: R$ ${fmt(r.brutoCompart4, 2)})`;
          if (!confirm(msg)) return;
          try {
            await setCfg('VALOR_BRUTO_COMPART_2', novos[2]);
            await setCfg('VALOR_BRUTO_COMPART_3', novos[3]);
            await setCfg('VALOR_BRUTO_COMPART_4', novos[4]);
            Utilidades.toast('✓ Brutos compartilhados sincronizados', 'success');
            renderizar();
          } catch (e) {
            console.error(e);
            Utilidades.toast('Erro: ' + e.message, 'error');
          }
        });
      }

      // Edição inline: salva automaticamente ao sair do campo ou ao apertar Enter.
      // Enquanto digita, atualiza só o preview (colunas calculadas) sem perder foco.
      document.querySelectorAll('.frac-input-edit').forEach(inp => {
        // Estado por input pra rastrear o valor original (detectar mudanças)
        const valorOriginal = parseFloat(inp.value);
        let valorAnterior = valorOriginal;

        // Re-render do preview ao digitar (mantém foco)
        inp.addEventListener('input', () => {
          atualizarPreviewDoDOM();
        });

        // Auto-save no blur
        inp.addEventListener('blur', async () => {
          const novo = parseFloat(inp.value);
          if (isNaN(novo) || novo < 0) {
            // valor inválido — restaura o original sem salvar
            inp.value = valorAnterior.toFixed(2);
            atualizarPreviewDoDOM();
            Utilidades.toast('Valor inválido — informe um número ≥ 0', 'error');
            return;
          }
          if (Math.abs(novo - valorAnterior) < 0.001) return;   // sem mudança

          // Normaliza o display (2 casas)
          inp.value = novo.toFixed(2);
          const campo = inp.dataset.campo;
          const chave = campoParaChave(campo);
          try {
            await setCfg(chave, novo);
            valorAnterior = novo;
            Utilidades.toast(`✓ ${labelCampo(campo)} atualizado`, 'success', 1500);
            // Não re-renderiza (mantém foco em outros inputs adjacentes)
          } catch (e) {
            console.error(e);
            Utilidades.toast('Erro ao salvar: ' + e.message, 'error');
            inp.value = valorAnterior.toFixed(2);
          }
        });

        // Enter dispara blur (que salva)
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            inp.blur();
          } else if (e.key === 'Escape') {
            inp.value = valorAnterior.toFixed(2);
            atualizarPreviewDoDOM();
            inp.blur();
          }
        });
      });
    }

    /** Mapeia o data-campo do input para a chave da tabela de config. */
    function campoParaChave(campo) {
      if (campo === 'valorFixo') return 'VALOR_FIXO';
      if (campo === 'pctParticular') return 'PCT_PARTICULAR';
      if (/^bruto[1-4]$/.test(campo)) return 'VALOR_BRUTO_POS' + campo.slice(5);
      if (/^brutoCompart[2-4]$/.test(campo)) return 'VALOR_BRUTO_COMPART_' + campo.slice(12);
      throw new Error('Campo desconhecido: ' + campo);
    }

    /** Label amigável para o toast. */
    function labelCampo(campo) {
      if (campo === 'valorFixo') return 'Valor fixo';
      if (campo === 'pctParticular') return 'Percentual particular';
      if (/^bruto[1-4]$/.test(campo)) return 'Bruto ' + campo.slice(5) + 'ª aplicação';
      if (/^brutoCompart[2-4]$/.test(campo)) return 'Bruto compartilhado ' + campo.slice(12) + ' aplic.';
      return campo;
    }

    /**
     * Atualiza as colunas calculadas (− Valor fixo e = Repasse) lendo os
     * valores ATUAIS dos inputs no DOM. Não persiste — só atualiza visual
     * enquanto o usuário digita.
     */
    function atualizarPreviewDoDOM() {
      const fixoInp = document.querySelector('input[data-campo="valorFixo"]');
      const fixo = fixoInp ? (parseFloat(fixoInp.value) || 0) : 0;

      const campos = ['bruto1', 'bruto2', 'bruto3', 'bruto4',
                      'brutoCompart2', 'brutoCompart3', 'brutoCompart4'];
      for (const campo of campos) {
        const inp = document.querySelector(`input[data-campo="${campo}"]`);
        const bruto = inp ? (parseFloat(inp.value) || 0) : 0;
        const repasse = bruto - fixo;
        const celDeducao = document.querySelector(`[data-campo-deducao="${campo}"]`);
        const celRepasse = document.querySelector(`[data-campo-repasse="${campo}"]`);
        if (celDeducao) celDeducao.textContent = `− R$ ${fmt(fixo, 2)}`;
        if (celRepasse) celRepasse.textContent = `R$ ${fmt(repasse, 2)}`;
      }
    }

    // Helper para contar registros, retorna 0 se a tabela ainda não existir
    function contarSafe(tabela, where = '') {
      try {
        return Banco.contar(tabela, where);
      } catch (e) {
        return 0;
      }
    }
  };

  // ──────────────────────────────────────────────────────────────────────
  // CSS
  // ──────────────────────────────────────────────────────────────────────
  function getStyles() {
    return `
      <style>
        .frac-cfg-card { margin-bottom: 16px; }
        .frac-cfg-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 14px;
          flex-wrap: wrap;
        }
        .frac-cfg-acoes {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        /* Linha discreta do "Valor fixo" — não é uma faixa cheia, é uma linha
           normal com label à esquerda + input médio + ajuda à direita */
        .frac-fixo-linha {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 12px;
          background: var(--bg-sunken);
          border-radius: 6px;
          margin-bottom: 14px;
          flex-wrap: wrap;
        }
        .frac-fixo-label {
          font-size: 13px;
          font-weight: 700;
          color: var(--primary);
          margin: 0;
        }
        .frac-fixo-help {
          font-size: 11px;
          color: var(--ink-faint);
          font-style: italic;
        }

        /* Grid de tabelas (lado a lado em desktop, empilhado em mobile) */
        .frac-tabelas-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        @media (max-width: 900px) {
          .frac-tabelas-grid { grid-template-columns: 1fr; }
        }

        /* Inputs (wrapper) */
        .frac-input-wrap {
          display: inline-flex;
          align-items: stretch;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--bg-elevated);
          overflow: hidden;
          transition: border-color 0.12s, background 0.12s, box-shadow 0.12s;
          width: 140px;       /* tamanho uniforme */
          height: 30px;       /* altura compacta */
        }
        .frac-input-wrap-md { width: 130px; height: 30px; }
        .frac-input-wrap-inline {
          width: 100%;        /* dentro da célula da tabela */
          max-width: 130px;
          height: 28px;
        }
        .frac-input-wrap:hover {
          border-color: var(--accent);
          background: rgba(24, 154, 211, 0.04);
        }
        .frac-input-wrap:focus-within {
          border-color: var(--primary);
          background: rgba(0, 80, 115, 0.04);
          box-shadow: 0 0 0 2px rgba(0, 80, 115, 0.08);
        }
        .frac-input-prefix {
          padding: 0 8px;
          background: var(--bg-sunken);
          color: var(--ink-soft);
          font-size: 11px;
          font-weight: 700;
          border-right: 1px solid var(--border);
          display: flex;
          align-items: center;
        }
        /* Quando aparece à direita do input (sufixo, ex: %) */
        .frac-input-suffix {
          border-right: none;
          border-left: 1px solid var(--border);
        }
        .frac-input-prefix-mini {
          padding: 0 7px;
          background: var(--bg-sunken);
          color: var(--ink-faint);
          font-size: 10px;
          font-weight: 600;
          border-right: 1px solid var(--border);
          display: flex;
          align-items: center;
        }
        .frac-input-num {
          flex: 1;
          width: 100%;
          min-width: 0;
          border: none;
          padding: 0 8px;
          font-family: var(--mono);
          font-size: 12px;
          text-align: right;
          background: transparent;
          color: var(--ink);
          outline: none;
          cursor: text;
          font-weight: 700;
        }
        /* Editável: cor de destaque (dourada) pra sinalizar que pode editar */
        .frac-input-edit { color: var(--accent); }
        /* Inputs dentro da tabela (mais compactos) */
        .frac-input-inline { font-size: 12px; }

        /* Tabelas */
        .frac-tabela-titulo {
          font-size: 12px;
          font-weight: 700;
          color: var(--primary);
          margin-bottom: 6px;
        }
        .frac-preview-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          font-size: 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          overflow: hidden;
        }
        .frac-preview-table th {
          background: var(--bg-sunken);
          padding: 6px 10px;
          text-align: left;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--ink-soft);
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
        }
        .frac-preview-table th.num,
        .frac-preview-table td.num { text-align: right; white-space: nowrap; }
        .frac-preview-table td {
          padding: 6px 10px;
          border-bottom: 1px solid var(--border);
          vertical-align: middle;
        }
        .frac-preview-table tr:last-child td { border-bottom: none; }
        /* V738: valores da coluna "= Repasse" em #107DAC */
        .frac-preview-table .frac-total {
          font-weight: 800;
          color: #107DAC;
          font-family: var(--mono);
        }
        .frac-preview-table .frac-deducao {
          color: #993556;
          font-weight: 500;
        }
        .frac-tabela-nota {
          display: block;
          font-size: 11px;
          color: var(--ink-faint);
          margin-top: 6px;
          font-style: italic;
        }

        .frac-empty-card {
          text-align: center;
          padding: 48px 20px;
        }

        /* ─────────────────────────────────────────────────────────────────
           FILEIRA DE FILTROS 20C (padrão do LIO V727, prefixo frac-sb)
           Wrapper com classe contendo "filtro" (o leque #atlas-hub ignora);
           position:relative + z-index — a animação global .page-content > *
           cria stacking context; sem isso o painel abre atrás dos cards.
           ───────────────────────────────────────────────────────────────── */
        .frac-filtros-wrap {
          position: relative;
          z-index: 30;
          width: 100%;
          margin-top: 10px;
          margin-bottom: 14px;
        }
        .frac-sb {
          position: relative; z-index: 30;
          display: flex; align-items: stretch;
          width: 100%;
          padding: 6px;
          box-sizing: border-box;
          background: #fff;
          border: 1px solid #e2ebf2;
          border-radius: 12px;
          box-shadow: 0 1px 2px rgba(20,50,80,.04), 0 10px 26px -20px rgba(20,50,80,.26);
          flex-wrap: wrap;
        }
        .frac-sb-celwrap { position: relative; min-width: 150px; display: flex; }
        .frac-sb-celwrap:not(:last-child) .frac-sb-cel { border-right: 1px solid #eef3f7; }
        .frac-sb-cel {
          flex: 1; min-width: 0;
          display: flex; align-items: center; gap: 9px;
          padding: 9px 12px; border: none; border-radius: 9px;
          background: transparent; cursor: pointer;
          font-family: inherit; text-align: left;
          transition: background-color 120ms;
        }
        .frac-sb-cel:hover, .frac-sb-cel.ativo, .frac-sb-cel.aberta { background: #f4fafd; }
        .frac-sb-cel:focus-visible { outline: 2px solid #2f8fc4; outline-offset: 2px; }
        .frac-sb-tile {
          width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: #f0f5f9; color: #5b6c7c;
        }
        .frac-sb-cel.ativo .frac-sb-tile, .frac-sb-cel.aberta .frac-sb-tile { background: #dbeef8; color: #1c6fa8; }
        .frac-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
        .frac-sb-rot {
          font-size: 10px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .09em; color: #5b6c7c; white-space: nowrap;
        }
        .frac-sb-val {
          font-size: 13px; font-weight: 500; color: #4f6274;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .frac-sb-cel.ativo .frac-sb-val { font-weight: 700; color: #14384f; }
        .frac-sb-chev { color: #7d8fa0; flex-shrink: 0; display: flex; transition: transform 140ms; }
        .frac-sb-cel.aberta .frac-sb-chev { transform: rotate(180deg); }

        /* painel ancorado na célula, por cima dos cards */
        .frac-sb-painel {
          position: absolute; top: 100%; left: 0; margin-top: 6px; z-index: 40;
          min-width: 100%; width: max-content; max-width: 340px;
          background: #fff; border: 1px solid #dfe8f0; border-radius: 12px;
          box-shadow: 0 18px 44px -14px rgba(15,37,68,.42);
          overflow: hidden;
        }
        .frac-sb-buscabox {
          display: flex; align-items: center; gap: 8px;
          padding: 11px 12px 10px; border-bottom: 1px solid #edf2f6;
        }
        .frac-sb-buscabox .frac-sb-busca-ic { color: #6b7d8e; display: flex; }
        .frac-sb-busca {
          flex: 1; height: 30px; border: 1px solid #dfe8f0; border-radius: 8px;
          background: #f7fafc; padding: 0 10px; font-size: 13px;
          font-family: inherit; color: #14384f; outline: none;
        }
        .frac-sb-busca::placeholder { color: #9aabb8; }
        .frac-sb-busca:focus { border-color: #2f8fc4; }
        .frac-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; }
        .frac-sb-lista::-webkit-scrollbar { width: 8px; }
        .frac-sb-lista::-webkit-scrollbar-track { background: #f2f6f9; }
        .frac-sb-lista::-webkit-scrollbar-thumb { background: #c3d5e2; border-radius: 4px; }
        .frac-sb-it {
          display: flex; align-items: center; gap: 10px;
          height: 38px; padding: 0 8px; border-radius: 8px; cursor: pointer;
          font-size: 13px; color: #14384f;
        }
        .frac-sb-it:hover, .frac-sb-it.foco { background: #f2f7fb; }
        .frac-sb-it.sel { background: #eaf4fb; font-weight: 700; }
        .frac-sb-it-todos { font-weight: 700; }
        .frac-sb-it-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .frac-sb-ck { color: #1c6fa8; display: flex; }
        .frac-sb-chip {
          width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: #eaf4fb; color: #1c6fa8; font-size: 9.5px; font-weight: 700;
        }
        .frac-sb-rodape {
          padding: 7px 12px; border-top: 1px solid #edf2f6;
          font-size: 10.5px; font-weight: 600; color: #7d8fa0;
        }
        @media (max-width: 1100px) { .frac-sb-celwrap { flex-basis: 48%; } }

        /* ─────────────────────────────────────────────────────────────────
           CARDS DE CATEGORIA — paleta inspirada no fichário Lentes de Contato
           Total = verde escuro | Convênio = azul claro | Particular = bege
           ───────────────────────────────────────────────────────────────── */
        .frac-cards-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-bottom: 14px;
        }
        @media (max-width: 700px) {
          .frac-cards-grid { grid-template-columns: 1fr; }
        }
        .frac-card-cat {
          all: unset;
          cursor: pointer;
          padding: 8px 12px;
          border-radius: 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          position: relative;
          border: 1px solid transparent;
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .frac-card-cat:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.10);
        }
        .frac-card-cat.is-selected {
          box-shadow: 0 0 0 2px var(--accent), 0 6px 16px rgba(0, 0, 0, 0.08);
        }
        /* Hierarquia interna (pedido do usuário): R$ em DESTAQUE (número
           grande, como os cards da Visão Geral) e a quantidade menor abaixo. */
        .frac-card-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        /* Título dos cards em #06283A — a regra global V181 ([class*="-label"]
           dentro dos cards listados) pinta #0F6E56 com !important; este
           override vence o empate por vir DEPOIS no cascade (mesmo padrão do
           V718 no OPME). */
        .main .frac-card-cat .frac-card-label { color: #06283A !important; }
        .main .frac-card-cat .frac-card-valor-monetario {
          font-size: 21px;
          font-weight: 800;
          line-height: 1.1;
          color: #06283A !important;
        }
        /* V738: quantidade de aplicações em #107DAC */
        .main .frac-card-cat .frac-card-qtd-rotulo {
          font-size: 11px;
          font-weight: 600;
          color: #107DAC !important;
        }
        /* Linhas de comparativo (vs LM, vs LY) */
        .frac-card-comparativos {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-top: 2px;
          padding-top: 6px;
          border-top: 1px solid rgba(0, 0, 0, 0.08);
        }
        .frac-card-comp {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 10px;
        }
        .frac-card-comp-label { font-weight: 600; }
        .frac-card-comp-pct {
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.7);
        }
        .frac-card-comp-positivo { color: #0A7A5A; }
        .frac-card-comp-negativo { color: #9B3A3A; }
        .frac-card-comp-neutro   { color: var(--ink-soft); }
        .frac-card-comp-vazio    { font-weight: 600; }

        /* ── Paleta CONVÊNIO (azul claro) ────────────────────────────────── */
        .frac-card-convenio {
          background: linear-gradient(135deg, #E1ECF4 0%, #C9DDED 100%);
          border-color: #95B9D6;
        }
        .frac-card-convenio .frac-card-label,
        .frac-card-convenio .frac-card-qtd,
        .frac-card-convenio .frac-card-valor-monetario { color: #2C5C8A; }
        .frac-card-convenio .frac-card-comp-label,
        .frac-card-convenio .frac-card-comp-vazio { color: #2C5C8A; opacity: 0.75; }
        .frac-card-convenio .frac-card-comparativos { border-top-color: rgba(44, 92, 138, 0.18); }

        /* ── Paleta PARTICULAR (bege) ────────────────────────────────────── */
        .frac-card-aviso {
          background: linear-gradient(135deg, #E8F1F7 0%, #CDEBDD 100%);
          border-color: #9FE6C9;
        }
        .frac-card-aviso .frac-card-label,
        .frac-card-aviso .frac-card-qtd,
        .frac-card-aviso .frac-card-valor-monetario { color: #005073; }
        .frac-card-aviso .frac-card-comp-label,
        .frac-card-aviso .frac-card-comp-vazio { color: #005073; opacity: 0.75; }
        .frac-card-aviso .frac-card-comparativos { border-top-color: rgba(138, 107, 44, 0.18); }

        /* ── Paleta TOTAL (verde escuro, destaque) ───────────────────────── */
        .frac-card-destaque {
          background: linear-gradient(135deg, #005073 0%, #0C3A2F 100%);
          border-color: #005073;
          box-shadow: 0 4px 12px rgba(0, 80, 115, 0.2);
        }
        .frac-card-destaque .frac-card-label             { color: #56645E; }
        .frac-card-destaque .frac-card-qtd               { color: #005073; }
        .frac-card-destaque .frac-card-valor-monetario   { color: #005073; }
        .frac-card-destaque .frac-card-comp-label,
        .frac-card-destaque .frac-card-comp-vazio { color: #B9D4CB; }
        .frac-card-destaque .frac-card-comparativos { border-top-color: #56645E; }
        .frac-card-destaque .frac-card-comp-pct { background: rgba(255, 255, 255, 0.92); }
        .frac-card-destaque.is-selected {
          box-shadow: 0 0 0 2px #189AD3, 0 4px 12px rgba(0, 80, 115, 0.3);
        }
        .frac-card-convenio.is-selected {
          box-shadow: 0 0 0 2px #2C5C8A, 0 6px 16px rgba(44, 92, 138, 0.15);
        }
        .frac-card-aviso.is-selected {
          box-shadow: 0 0 0 2px #005073, 0 6px 16px rgba(138, 107, 44, 0.15);
        }

        /* ─────────────────────────────────────────────────────────────────
           TABELA DE APLICAÇÕES
           ───────────────────────────────────────────────────────────────── */
        .frac-tabela-wrap {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
        }
        .frac-tabela-head {
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-sunken);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .frac-tabela-scroll {
          max-height: 60vh;
          overflow: auto;
        }
        .frac-tabela-aplicacoes {
          /* width:auto + min-width:100% — preenche quando cabe e CRESCE no
             arrasto das alças (o wrap rola na horizontal), padrão V257 */
          width: auto;
          min-width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }

        /* ── Alça de redimensionamento de colunas (padrão LIO V721) ──
           th já é sticky — sticky também ancora os absolutes da alça. */
        .frac-col-resize {
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
        .frac-col-resize:hover,
        .frac-col-resize.frac-col-resize-ativa {
          background: linear-gradient(to right, transparent, var(--accent) 50%, transparent);
        }
        .frac-col-resize::after {
          content: '';
          position: absolute;
          right: 2px;
          top: 30%;
          bottom: 30%;
          width: 2px;
          background: rgba(24, 154, 211, 0.35);
          border-radius: 2px;
          transition: background-color 150ms, top 150ms, bottom 150ms;
        }
        .frac-col-resize:hover::after,
        .frac-col-resize.frac-col-resize-ativa::after {
          background: var(--accent);
          top: 15%;
          bottom: 15%;
        }
        body.frac-redimensionando,
        body.frac-redimensionando * {
          cursor: col-resize !important;
          user-select: none !important;
        }

        /* ── 🛠 Ajuste de Matriz (modal no <body>, padrão Fellow .fel-ajm-*) ── */
        .frac-ajm-fundo {
          position: fixed; inset: 0; background: rgba(6, 40, 58, .45);
          display: flex; align-items: center; justify-content: center; z-index: 5000;
        }
        .frac-ajm-box {
          background: var(--bg-elevated, #fff); border-radius: 12px; padding: 20px;
          width: 430px; max-width: calc(100vw - 32px); max-height: 84vh; overflow-y: auto;
          box-shadow: 0 18px 44px -14px rgba(15, 37, 68, .42);
        }
        .frac-ajm-box h4 { margin: 0 0 6px; font-size: 15px; }
        .frac-ajm-box p { margin: 0 0 14px; font-size: 12px; color: var(--ink-soft); }
        .frac-ajm-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
        .frac-ajm-head > span:first-child { width: 14px; }
        .frac-ajm-linha { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .frac-ajm-orig {
          flex: 0 0 130px; font-size: 10.5px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .04em; color: var(--ink-faint);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .frac-ajm-inp {
          flex: 1; height: 32px; border: 1px solid var(--border); border-radius: 8px;
          padding: 0 10px; font-size: 13px; font-family: inherit; color: var(--ink);
          background: var(--bg-raised, #fff); outline: none;
        }
        .frac-ajm-inp:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(30, 187, 215, .16); }
        .frac-ajm-acoes { display: flex; gap: 8px; align-items: center; margin-top: 14px; }

        /* V738: diálogo de OPÇÕES da extração (padrão do Fellow) */
        .frac-ext-op {
          display: flex; gap: 10px; align-items: flex-start;
          padding: 8px 10px; margin: 2px 0;
          border: 1px solid var(--border); border-radius: 8px;
          cursor: pointer; background: white;
        }
        .frac-ext-op:hover { background: var(--bg-sunken); }
        .frac-ext-op:has(input:checked) { background: #E4EEF4; border-color: #107DAC; }
        .frac-ext-op input { margin-top: 2px; accent-color: #107DAC; }
        .frac-ext-op span { display: flex; flex-direction: column; gap: 1px; }
        .frac-ext-op strong { font-size: 12px; color: var(--ink); }
        .frac-ext-op small { font-size: 10px; color: var(--ink-soft); }
        .frac-tabela-aplicacoes th {
          position: sticky; top: 0;
          background: var(--bg-sunken);
          padding: 8px 10px;
          text-align: left;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--ink-soft);
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
        }
        /* V413: backdrop escuro atrás do <thead> — mata a "costura" branca (fundo
           claro do container vazando numa junção sub-pixel entre células sticky). */
        .frac-tabela-aplicacoes thead,
        .frac-tabela-aplicacoes thead tr { background: #021A1C; }
        /* V414: Ajustes como MODAL (pop-up), montado no document.body */
        .frac-cfg-overlay {
          position: fixed; inset: 0; z-index: 9998;
          background: rgba(2, 12, 10, 0.55);
           
          animation: fracCfgFade 120ms ease;
        }
        .frac-cfg-modal {
          position: fixed; z-index: 9999;
          top: 50%; left: 50%; transform: translate(-50%, -50%);
          width: min(940px, calc(100vw - 40px));
          max-height: calc(100vh - 64px); overflow: auto;
          background: var(--bg-elevated); border-radius: 14px;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.38);
          animation: fracCfgIn 140ms ease;
        }
        .frac-cfg-modal .frac-cfg-card {
          margin: 0; border: none; box-shadow: none; border-radius: 14px;
        }
        .frac-cfg-fechar {
          position: absolute; top: 12px; right: 12px; z-index: 1;
          width: 30px; height: 30px; border: none; border-radius: 8px;
          background: var(--bg-sunken); color: var(--ink-soft);
          font-size: 15px; line-height: 1; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background 150ms, color 150ms;
        }
        .frac-cfg-fechar:hover { background: var(--primary); color: #FFFFFF; }
        @keyframes fracCfgFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fracCfgIn {
          from { opacity: 0; transform: translate(-50%, -47%); }
          to   { opacity: 1; transform: translate(-50%, -50%); }
        }
        .frac-tabela-aplicacoes th.num,
        .frac-tabela-aplicacoes td.num { text-align: right; }
        /* V738: valores da coluna "= Repasse" em #107DAC */
        .frac-tabela-aplicacoes td.frac-total {
          color: #107DAC;
          font-weight: 700;
        }
        .frac-tabela-aplicacoes td {
          padding: 6px 10px;
          border-bottom: 1px solid var(--border);
          vertical-align: middle;
          font-size: 12px;
        }
        /* Uniformiza qualquer <small> dentro das células */
        .frac-tabela-aplicacoes td small {
          font-size: 12px;
          font-weight: inherit;
        }
        .frac-tabela-aplicacoes tr:hover td { background: rgba(0, 80, 115, 0.03); }
        .frac-row-particular td { color: var(--ink-soft); }
        .frac-row-particular td:first-child {
          border-left: 2px solid #B87A5A;
        }

        /* Tag de "X ocultas" e checkbox no header da tabela */
        .frac-ocultas-tag {
          display: inline-block;
          margin-left: 8px;
          padding: 1px 7px;
          background: rgba(184, 122, 90, 0.15);
          color: #8A4F2A;
          font-size: 10px;
          font-weight: 700;
          border-radius: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .frac-checkbox-ocultar {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 600;
          color: var(--ink-soft);
          cursor: pointer;
          user-select: none;
          padding: 4px 8px;
          border-radius: 6px;
          transition: background 120ms;
        }
        .frac-checkbox-ocultar:hover { background: rgba(0, 0, 0, 0.04); }
        .frac-checkbox-ocultar input {
          width: 14px;
          height: 14px;
          accent-color: var(--primary);
          cursor: pointer;
          margin: 0;
        }

        /* Botão "Ver detalhes" da admissão sem valor */
        .btn-link-detalhes {
          background: transparent;
          border: 1px solid rgba(184, 122, 90, 0.4);
          color: #B87A5A;
          font-family: inherit;
          font-size: 11px;
          font-style: italic;
          padding: 3px 10px;
          border-radius: 12px;
          cursor: pointer;
          transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
        }
        .btn-link-detalhes:hover {
          background: #B87A5A;
          color: #FFF;
          border-color: #B87A5A;
        }

        /* Badges de origem (QVIS / PRODUCAO) */
        .frac-origem-badge {
          display: inline-block;
          font-family: var(--font-display);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.04em;
          padding: 1px 5px;
          border-radius: 3px;
          margin-left: 4px;
          vertical-align: middle;
          font-style: normal;
        }
        .frac-origem-qvis     { background: #E1ECF4; color: #2C5C8A; }
        .frac-origem-producao { background: #E8F1F7; color: #005073; }

        /* MODAL de detalhes da admissão sem valor */
        .frac-detalhes-overlay {
          position: fixed; inset: 0;
          background: rgba(0, 80, 115, 0.4);
          
          z-index: 1000;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        .frac-detalhes-modal {
          background: var(--bg-elevated);
          border-radius: 12px;
          max-width: 980px;
          width: 100%;
          max-height: 90vh;
          display: flex; flex-direction: column;
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
          overflow: hidden;
        }
        .frac-detalhes-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border);
          background: linear-gradient(135deg, #E8F1F7 0%, #CDEBDD 100%);
        }
        .frac-detalhes-head h3 {
          margin: 0;
          font-size: 17px;
          color: #005073;
          font-weight: 700;
        }
        .frac-detalhes-head small {
          font-size: 12px;
          color: #005073;
          opacity: 0.85;
        }
        .frac-detalhes-fechar {
          background: rgba(255, 255, 255, 0.6);
          border: 1px solid rgba(0, 0, 0, 0.1);
          border-radius: 6px;
          width: 28px; height: 28px;
          cursor: pointer;
          font-size: 14px;
          color: #005073;
        }
        .frac-detalhes-fechar:hover { background: white; }
        .frac-detalhes-body {
          padding: 16px 20px 20px;
          overflow-y: auto;
        }
        .frac-detalhes-body h4 {
          margin: 16px 0 8px;
          font-size: 13px;
          color: var(--primary);
          font-weight: 700;
        }
        .frac-detalhes-body h4:first-of-type { margin-top: 8px; }
        .frac-detalhes-info {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 6px 18px;
          padding: 10px 12px;
          background: var(--bg-sunken);
          border-radius: 6px;
          font-size: 12px;
        }
        .frac-detalhes-info > div { line-height: 1.5; }
        .frac-detalhes-help {
          font-size: 11px;
          color: var(--ink-soft);
          margin: 0 0 6px;
        }
        .frac-detalhes-vazio {
          font-size: 12px;
          font-style: italic;
          color: var(--ink-soft);
          padding: 10px 12px;
          background: var(--bg-sunken);
          border-radius: 6px;
          border-left: 3px solid #B87A5A;
        }
        .frac-detalhes-tabela {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }
        .frac-detalhes-tabela th {
          text-align: left;
          padding: 6px 8px;
          background: var(--bg-sunken);
          font-weight: 700;
          color: var(--ink-soft);
          border-bottom: 1px solid var(--border);
        }
        .frac-detalhes-tabela th.num { text-align: right; }
        .frac-detalhes-tabela td {
          padding: 5px 8px;
          border-bottom: 1px solid var(--border);
        }
        .frac-detalhes-tabela td.num { text-align: right; }
        .frac-detalhes-match td { background: rgba(0, 80, 115, 0.05); }
        .frac-tag-match {
          display: inline-block;
          background: #005073;
          color: #F1F7F7;
          font-size: 9px;
          padding: 1px 5px;
          border-radius: 3px;
          margin-left: 6px;
          font-weight: 700;
        }
        .frac-detalhes-conclusao {
          margin-top: 16px;
          padding: 10px 12px;
          background: #FFF8E1;
          border: 1px solid #E0C97A;
          border-radius: 6px;
          font-size: 12px;
          color: #003A54;
          line-height: 1.45;
        }
      </style>
    `;
  }
})();
