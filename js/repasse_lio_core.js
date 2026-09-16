/**
 * ============================================================================
 * NÚCLEO DE CÁLCULO LIO — App.repasseLIO  (1 FONTE DA VERDADE)
 *
 * Toda a lógica de cálculo de repasse do fichário LIO vive aqui:
 *   • identificação do OPME cadastrado (match de termos no Produto)
 *   • regra de repasse (VALOR LIO × % executante + % indicante)
 *   • duplicidade Convênio × Particular
 *
 * Tanto a TELA do LIO (desempenho_lio.js) quanto o CALCULAR REPASSE consomem
 * estas funções — assim a regra é definida num lugar só.
 *
 * Carregado ANTES de desempenho_lio.js no index.html.
 * ============================================================================
 */
(function () {
  'use strict';
  window.App = window.App || {};
  const App = window.App;

  const TERMOS_REGRA_LIO = ['LIO', 'SERVICO DE IMPLANTE', 'LENTE INTRA OCULAR'];

  // ── Colunas trocáveis da matriz de Convênio (fonte Produção ↔ QVIS) ────────
  const COLUNAS_MATRIZ_CONV = {
    data: {
      titulo: 'Data', default: 'PRODUCAO',
      fontes: [
        { id: 'PRODUCAO', label: 'Produção', sql: 'lp.data_admissao' },
        { id: 'QVIS',     label: 'QVIS',     sql: 'qvis.data_admissao' }
      ]
    },
    admissao: {
      titulo: 'Admissão', default: 'PRODUCAO',
      fontes: [
        { id: 'PRODUCAO', label: 'Produção', sql: 'lp.cod_admissao' },
        { id: 'QVIS',     label: 'QVIS',     sql: 'qvis.admissao' }
      ]
    },
    paciente: {
      titulo: 'Paciente', default: 'PRODUCAO',
      fontes: [
        { id: 'PRODUCAO', label: 'Produção', sql: 'lp.paciente' },
        { id: 'QVIS',     label: 'QVIS',     sql: 'qvis.paciente' }
      ]
    },
    tipo: {
      titulo: 'Tipo', default: 'QVIS',
      fontes: [
        { id: 'QVIS',     label: 'QVIS · procedimento',     sql: 'qvis.procedimento' },
        { id: 'PRODUCAO', label: 'Produção · tipo_produto', sql: 'lp.tipo_produto' }
      ]
    },
    convenio: {
      titulo: 'Convênio', default: 'QVIS',
      fontes: [
        { id: 'QVIS',     label: 'QVIS',     sql: 'qvis.convenio' },
        { id: 'PRODUCAO', label: 'Produção', sql: 'lp.convenio' }
      ]
    },
    produzido: {
      titulo: 'Produzido', default: 'QVIS',
      fontes: [
        { id: 'QVIS',     label: 'QVIS · SUM(produzido)', sql: 'qvis.produzido' },
        { id: 'PRODUCAO', label: 'Produção · valor',      sql: 'lp.valor' }
      ]
    },
  };

  function lerOrigemColuna(colId) {
    try {
      const r = Banco.query(`SELECT valor FROM config_lio WHERE chave = ?`,
        [`MATRIZ_CONV_COL_${colId.toUpperCase()}`]);
      if (r && r[0] && r[0].valor) return r[0].valor;
    } catch (_) {}
    return COLUNAS_MATRIZ_CONV[colId] ? COLUNAS_MATRIZ_CONV[colId].default : null;
  }
  function obterFonteAtiva(colId) {
    const col = COLUNAS_MATRIZ_CONV[colId];
    if (!col) return null;
    const ativo = lerOrigemColuna(colId);
    return col.fontes.find(f => f.id === ativo) || col.fontes[0];
  }

  // ── Termos de um OPME cadastrado ───────────────────────────────────────────
  function lerTermosDoOpme(opme) {
    if (opme.padrao_customizado != null && String(opme.padrao_customizado).length > 0) {
      return String(opme.padrao_customizado).split('|').map(s => s.trim()).filter(Boolean);
    }
    return String(opme.padrao_busca || '').split(/\s+/).map(s => s.trim()).filter(Boolean);
  }

  // ── Identificação do OPME cadastrado (match de termos) ─────────────────────
  let _cacheConvFlagado = null;
  function resolverConvenioFlagado(convenioLinha) {
    const cu = String(convenioLinha || '').toUpperCase().trim();
    if (!cu) return null;
    if (!_cacheConvFlagado) {
      _cacheConvFlagado = { flagados: [], aliases: [] };
      try {
        _cacheConvFlagado.flagados = Banco.query(`SELECT convenio FROM lio_convenios_flagados`)
          .map(r => r.convenio);
      } catch (_) {}
      try {
        _cacheConvFlagado.aliases = Banco.query(`SELECT convenio_flagado, convenio_qvis FROM lio_convenios_aliases`);
      } catch (_) {}
    }
    for (const f of _cacheConvFlagado.flagados) {
      if (cu.startsWith(String(f).toUpperCase())) return f;
    }
    for (const a of _cacheConvFlagado.aliases) {
      if (String(a.convenio_qvis).toUpperCase() === cu) return a.convenio_flagado;
    }
    return null;
  }

  let _cacheOpmesPorConv = null;
  function carregarOpmesCadastrados() {
    if (_cacheOpmesPorConv) return _cacheOpmesPorConv;
    _cacheOpmesPorConv = new Map();
    try {
      const rows = Banco.query(`SELECT * FROM lio_opme_tabela WHERE ativo = 1`);
      for (const opme of (rows || [])) {
        const conv = opme.convenio || '';
        if (!_cacheOpmesPorConv.has(conv)) _cacheOpmesPorConv.set(conv, []);
        _cacheOpmesPorConv.get(conv).push({
          ...opme,
          _termos: lerTermosDoOpme(opme).map(t => String(t).toUpperCase()).filter(Boolean)
        });
      }
    } catch (e) { console.error('[repasseLIO] carregarOpmesCadastrados:', e); }
    return _cacheOpmesPorConv;
  }

  function identificarOpmeCadastrado(produtoMatriz, convenioLinha) {
    const produtoUpper = String(produtoMatriz || '').toUpperCase();
    if (!produtoUpper) return null;
    const convFlagado = resolverConvenioFlagado(convenioLinha);
    if (!convFlagado) return null;
    const mapa = carregarOpmesCadastrados();
    const opmes = mapa.get(convFlagado) || [];
    if (opmes.length === 0) return null;
    let melhor = null, melhorScore = 0, melhorTermos = [];
    for (const opme of opmes) {
      const termos = opme._termos || [];
      if (termos.length === 0) continue;
      const casados = termos.filter(t => produtoUpper.includes(t));
      if (casados.length >= 2 && casados.length > melhorScore) {
        melhorScore = casados.length; melhor = opme; melhorTermos = casados;
      }
    }
    if (!melhor) return null;
    return { opme: melhor, valorLio: Number(melhor.valor_lio) || 0, score: melhorScore, termosCasados: melhorTermos };
  }

  function limparCaches() { _cacheConvFlagado = null; _cacheOpmesPorConv = null; _cacheLentesAd = null; _cacheCatarata = null; }

  // ── V667: ADICIONAL — repasse extra sobre a diferença acima da tabela ─────
  // LIOs particulares com valor de tabela cadastrado (lio_adicional_tabela):
  // quando o EXECUTANTE (especialidade Catarata no módulo Médicos) cobra
  // ACIMA da tabela, recebe PCT_ADICIONAL % (padrão 50) da diferença.
  // Ex.: PANOPTIX tabela 26.000, cobrado 40.000 → dif 14.000 → repasse 7.000.
  let _cacheLentesAd = null, _cacheCatarata = null;
  const _normAd = (s) => (window.Utilidades && Utilidades.normalizar)
    ? Utilidades.normalizar(s) : String(s || '').toUpperCase().trim();

  /** V672: o ADICIONAL entra no consolidado (Desempenho)? Nasce DESLIGADO —
   *  o repasse está sendo lançado manualmente; ligue na aba quando quiser que
   *  as linhas "LIO · ADICIONAL" passem a compor o consolidado dos Relatórios. */
  function adicionalNoConsolidado() {
    try {
      const r = Banco.query(`SELECT valor FROM config_lio WHERE chave = 'LIO_ADICIONAL_CONSOLIDADO'`);
      return !!(r && r[0] && String(r[0].valor) === '1');
    } catch (_) { return false; }
  }

  function lerPctAdicional() {
    try {
      const r = Banco.query(`SELECT valor FROM config_lio WHERE chave = 'PCT_ADICIONAL'`);
      const p = parseFloat(r && r[0] && r[0].valor);
      if (!isNaN(p) && p >= 0) return p;
    } catch (_) {}
    return 50;
  }

  function lentesAdicional() {
    if (_cacheLentesAd) return _cacheLentesAd;
    let rows = [];
    try { rows = Banco.query(`SELECT id, nome, valor_tabela, ativo FROM lio_adicional_tabela WHERE ativo = 1`) || []; }
    catch (_) {}
    _cacheLentesAd = rows
      .map(r => ({ ...r, _norm: _normAd(r.nome) }))
      .filter(r => r._norm)
      .sort((a, b) => b._norm.length - a._norm.length);   // padrão mais específico vence
    return _cacheLentesAd;
  }

  // V668: o cadastro é um PADRÃO DE BUSCA — "PANOPTIX" casa com TODO produto
  // que contenha PANOPTIX (comparação normalizada: sem acento, caixa alta).
  function identificarLenteAdicional(produto) {
    const pn = _normAd(produto);
    if (!pn) return null;
    for (const le of lentesAdicional()) if (pn.includes(le._norm)) return le;
    return null;
  }

  // V708: TODOS os padrões que casam com o produto (não para no primeiro).
  // O 1º da lista é o mais específico (mesma ordenação do identificar) — é
  // ele que dá o valor de tabela do cálculo; os demais são informativos.
  function identificarLentesAdicional(produto) {
    const pn = _normAd(produto);
    if (!pn) return [];
    return lentesAdicional().filter(le => pn.includes(le._norm));
  }

  /** Grafias (normalizadas) de todos os médicos com a especialidade CATARATA
   *  cadastrada no módulo Médicos — nome oficial + sinônimos. */
  function medicosCatarata() {
    if (_cacheCatarata) return _cacheCatarata;
    const set = new Set();
    try {
      const meds = Banco.query(`
        SELECT m.id, m.nome_oficial, m.nome_normalizado
          FROM medicos m
          JOIN medico_especialidades me ON me.medico_id = m.id
          JOIN especialidades e ON e.id = me.especialidade_id
         WHERE UPPER(TRIM(e.nome)) = 'CATARATA'`) || [];
      const ids = [];
      for (const m of meds) {
        ids.push(Number(m.id));
        if (m.nome_normalizado) set.add(_normAd(m.nome_normalizado));
        if (m.nome_oficial) set.add(_normAd(m.nome_oficial));
      }
      if (ids.length) {
        const sin = Banco.query(
          `SELECT grafia, grafia_normalizada FROM sinonimos_medico WHERE medico_id IN (${ids.join(',')})`) || [];
        for (const s of sin) { const g = _normAd(s.grafia_normalizada || s.grafia); if (g) set.add(g); }
      }
    } catch (e) { console.error('[repasseLIO] medicosCatarata:', e); }
    _cacheCatarata = set;
    return set;
  }

  /** Calcula o adicional de UMA linha particular (null = lente sem cadastro).
   *  V708: `lentes` traz TODOS os padrões que casaram — o cálculo usa o mais
   *  específico (lentes[0] = `lente`), os demais aparecem na coluna. */
  function calcularLinhaAdicional(l, pct) {
    const lentes = identificarLentesAdicional(l.produto);
    if (!lentes.length) return null;
    const lente = lentes[0];
    const cobrado = Number(l.valor) || 0;
    const tabela = Number(lente.valor_tabela) || 0;
    const diferenca = Math.max(0, cobrado - tabela);
    const p = (pct == null) ? lerPctAdicional() : Number(pct);
    return { lente, lentes, valorTabela: tabela, cobrado, diferenca, pct: p, repasse: diferenca * (p / 100) };
  }

  /** Linhas da aba ADICIONAL: LIOs particulares de executantes Catarata com
   *  lente cadastrada — cada linha ganha `_adicional` {lente, valorTabela,
   *  cobrado, diferenca, pct, repasse}. Inclui diferença 0 (auditoria). */
  function montarLinhasAdicional(filtros) {
    const cat = medicosCatarata();
    if (!cat.size || !lentesAdicional().length) return [];
    const pct = lerPctAdicional();
    const out = [];
    for (const l of montarLinhasParticular(filtros)) {
      const exec = String(l.cirurgiao || l.medico || '').trim();
      if (!exec || !cat.has(_normAd(exec))) continue;
      const calc = calcularLinhaAdicional(l, pct);
      if (!calc) continue;
      out.push({ ...l, _adicional: calc });
    }
    return out;
  }

  // ── Regra aplicada (produtos não-excluídos) ────────────────────────────────
  function temRegraAplicada(l, cfg) {
    const tp = String(l.tipo_recebimento || '').toUpperCase();
    const conjunto = tp === 'PARTICULAR' ? cfg.produtosExcluidosPart : cfg.produtosExcluidosConv;
    return !conjunto.has(l.produto || '');
  }

  // ── Cálculo por linha (CONVÊNIO: Valor LIO; PARTICULAR: valor) ──────────────
  function calcularRepasseLinha(l, cfg) {
    const indNorm = (l.indicante || '').trim().toUpperCase();
    const exeNorm = (l.cirurgiao || '').trim().toUpperCase();
    const indDiferente = indNorm && exeNorm && indNorm !== exeNorm;

    if (!temRegraAplicada(l, cfg)) {
      return { repExec: 0, repInd: 0, repTotal: 0, indDiferente, semRegra: true,
        pctExec: cfg.pctExecutante, pctInd: cfg.pctIndicante, valorLio: null, opmeIdentificado: null };
    }

    const ehConvenio = String(l.tipo_recebimento || '').toUpperCase().startsWith('CONV');
    if (ehConvenio) {
      const ident = identificarOpmeCadastrado(l.produto, l.convenio);
      if (!ident) {
        return { repExec: 0, repInd: 0, repTotal: 0, indDiferente, semRegra: true, semOpme: true,
          pctExec: cfg.pctExecutante, pctInd: cfg.pctIndicante, valorLio: null, opmeIdentificado: null };
      }
      const base = ident.valorLio;
      const pagaInd = indDiferente && cfg.pagarIndicante;
      const repExec = base * (cfg.pctExecutante / 100);
      const repInd = pagaInd ? base * (cfg.pctIndicante / 100) : 0;
      return { repExec, repInd, repTotal: repExec + repInd, indDiferente, semRegra: false,
        pctExec: cfg.pctExecutante, pctInd: cfg.pctIndicante, valorLio: base,
        opmeIdentificado: ident.opme, scoreMatch: ident.score, termosCasados: ident.termosCasados || [] };
    }

    const valor = Number(l.valor) || 0;
    const repExec = valor * (cfg.pctExecutante / 100);
    const repInd = indDiferente ? valor * (cfg.pctIndicante / 100) : 0;
    return { repExec, repInd, repTotal: repExec + repInd, indDiferente, semRegra: false,
      pctExec: cfg.pctExecutante, pctInd: cfg.pctIndicante, valorLio: null, opmeIdentificado: null };
  }

  // ── Config de cálculo (pcts, pagarIndicante, produtos excluídos) ───────────
  function lerConfigCalculo() {
    const cfg = {
      pctExecutante: 18, pctIndicante: 2.5, pctConvenio: 18,
      ocultarRepasse: false, pagarIndicante: true,
      produtosExcluidosConv: new Set(), produtosExcluidosPart: new Set(),
    };
    try {
      const rows = Banco.query(`SELECT chave, valor FROM config_lio`);
      const map = new Map();
      for (const r of rows) map.set(r.chave, r.valor);
      const pe = parseFloat(map.get('PCT_EXECUTANTE_GERAL'));
      const pi = parseFloat(map.get('PCT_INDICANTE_GERAL'));
      const pc = parseFloat(map.get('PCT_CONVENIO_GERAL'));
      if (!isNaN(pe)) cfg.pctExecutante = pe;
      if (!isNaN(pi)) cfg.pctIndicante = pi;
      if (!isNaN(pc)) cfg.pctConvenio = pc;
      if (map.get('OCULTAR_REPASSE') === 'true') cfg.ocultarRepasse = true;
      if (map.get('PAGAR_INDICANTE_25') === 'false') cfg.pagarIndicante = false;
    } catch (_) {}
    try {
      const exc = Banco.query(`SELECT produto, tipo_recebimento FROM lio_produtos_excluidos`);
      for (const r of (exc || [])) {
        const tp = String(r.tipo_recebimento || 'CONVENIO').toUpperCase();
        if (tp === 'PARTICULAR') cfg.produtosExcluidosPart.add(r.produto);
        else cfg.produtosExcluidosConv.add(r.produto);
      }
    } catch (_) {}
    return cfg;
  }

  // ── Linhas de teste (entram no cálculo como Convênio) ──────────────────────
  function listarLinhasTeste() {
    try {
      const r = Banco.query(`SELECT * FROM lio_linhas_teste ORDER BY id DESC`);
      return (r || []).map(row => ({
        ...row,
        admissao: row.admissao || '',
        valor: Number(row.produzido) || 0,
        produzido: Number(row.produzido) || 0,
        recebido: Number(row.recebido) || 0,
        cirurgiao: row.executante || '',
        medico: row.executante || '',
        tipo_recebimento: 'CONVÊNIO',
        _teste: true, _testeId: row.id
      }));
    } catch (_) { return []; }
  }

  // ── Admissões desabilitadas por duplicidade (saem do cálculo) ──────────────
  function admissoesDesabilitadas() {
    const set = new Set();
    try {
      const r = Banco.query(`SELECT admissao FROM lio_admissoes_desabilitadas WHERE habilitada = 0`);
      for (const row of (r || [])) set.add(String(row.admissao));
    } catch (_) {}
    return set;
  }

  // ── V918: EXCETO (V645) também no CORE ─────────────────────────────────────
  // Os termos de lio_exceto_termos ("PRESERFLO" etc.) EXCLUEM produtos da
  // classificação LIO. Antes o filtro valia SÓ na matriz da tela — o
  // consolidado/extrações (que passam por este core) continuavam pagando a
  // regra em cima do produto excetuado. Caso real: SERVIÇO - DE IMPLANTE
  // PRESERFLO saindo no relatório mesmo com a exceção cadastrada.
  let _excetoMemo = null, _excetoMemoV = -1;
  const _excetoNorm = (s) => String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
  function excetoTermos() {
    const v = (typeof Banco !== 'undefined' && Banco._versao) || 0;
    if (_excetoMemo && _excetoMemoV === v) return _excetoMemo;
    let t = [];
    try {
      t = (Banco.query(`SELECT termo FROM lio_exceto_termos`) || [])
        .map(r => _excetoNorm(r.termo)).filter(Boolean);
    } catch (_) { /* tabela ainda não existe */ }
    _excetoMemo = t; _excetoMemoV = v;
    return t;
  }
  function aplicarExceto(rows) {
    const termos = excetoTermos();
    if (!termos.length || !rows || !rows.length) return rows || [];
    return rows.filter(l => {
      const prod = _excetoNorm(l.produto);
      if (!prod) return true;
      return !termos.some(t => prod.includes(t));
    });
  }

  // ── Query das linhas PARTICULAR (igual à aba PARTICULAR da tela) ────────────
  // V132.43: PARTICULAR vem direto da Produção (sem JOIN com QVIS, sem flagados).
  function montarLinhasParticular(filtros) {
    filtros = filtros || {};
    const wheres = [
      `classificacao_produto = 'OPME'`,
      `tipo_recebimento = 'PARTICULAR'`,
      `(UPPER(COALESCE(tipo_produto,'')) LIKE '%LIO%'
        OR UPPER(COALESCE(tipo_produto,'')) = 'LENTE INTRA OCULAR'
        OR UPPER(COALESCE(tipo_produto,'')) = 'SERVICO DE LIO')`,
    ];
    if (filtros.ano) wheres.push(`substr(competencia,1,4) = '${filtros.ano}'`);
    if (filtros.mes) wheres.push(`substr(competencia,6,2) = '${filtros.mes}'`);
    const sql = `
      SELECT
        cod_admissao AS admissao, data_admissao, competencia,
        paciente, cod_paciente, tipo_produto, produto, convenio, plano,
        quantidade, valor, indicante, cirurgiao, medico, tipo_recebimento
      FROM linhas_producao
      WHERE ${wheres.join(' AND ')}
      ORDER BY valor DESC, cod_admissao
    `;
    try { return aplicarExceto(Banco.query(sql) || []); }   // V918: EXCETO vale no core
    catch (e) { console.error('[repasseLIO] montarLinhasParticular:', e); return []; }
  }

  // ── Query das linhas de Convênio (igual à da tela, com filtros de competência) ─
  function montarLinhasConvenio(filtros, opts) {
    filtros = filtros || {};
    opts = opts || {};
    let flagados = [];
    try {
      flagados = (Banco.query(`SELECT convenio FROM lio_convenios_flagados`) || [])
        .map(r => r.convenio).filter(Boolean);
    } catch (_) {}
    if (flagados.length === 0) return [];

    // V132.41: o filtro por tipo_recebimento na PRODUÇÃO é opcional. A TELA LIO
    // não o aplica (filtra convênio pelo QVIS); pra reproduzir a tela no módulo
    // Relatórios, passamos opts.incluirTodosTiposReceb = true.
    const wheresProd = [`lp.classificacao_produto = 'OPME'`];
    if (!opts.incluirTodosTiposReceb) wheresProd.push(`lp.tipo_recebimento LIKE 'CONV%'`);
    // V463: alinhado à tela (v456) — a aba CONVÊNIO conta pelo MES_PAGAMENTO do QVIS (mês em que a
    // admissão foi conciliada/importada no relatório), não pela competência da Produção (data da admissão).
    const wheresMesPgto = [];
    if (filtros.ano) wheresMesPgto.push(`substr(mes_pagamento,1,4) = '${filtros.ano}'`);
    if (filtros.mes) wheresMesPgto.push(`substr(mes_pagamento,6,2) = '${filtros.mes}'`);
    const filtroMesPgto = wheresMesPgto.length ? ' AND ' + wheresMesPgto.join(' AND ') : '';

    const escSql = (s) => String(s).replace(/'/g, "''");
    const condicoes = [];
    for (const f of flagados) {
      condicoes.push(`UPPER(COALESCE(convenio,'')) LIKE UPPER('${escSql(f)}') || '%'`);
    }
    let aliases = [];
    try { aliases = Banco.query(`SELECT convenio_qvis FROM lio_convenios_aliases`) || []; } catch (_) {}
    for (const al of aliases) {
      condicoes.push(`UPPER(COALESCE(convenio,'')) = UPPER('${escSql(al.convenio_qvis)}')`);
    }
    const likesFlag = condicoes.length > 0 ? condicoes.join(' OR ') : '1=0';

    const F = {
      data: obterFonteAtiva('data'), admissao: obterFonteAtiva('admissao'),
      paciente: obterFonteAtiva('paciente'), tipo: obterFonteAtiva('tipo'),
      convenio: obterFonteAtiva('convenio'), produzido: obterFonteAtiva('produzido'),
    };
    const sql = `
      SELECT
        ${F.admissao.sql} AS admissao, ${F.data.sql} AS data_admissao,
        qvis.mes_pagamento AS competencia, ${F.paciente.sql} AS paciente,
        ${F.tipo.sql} AS tipo_produto, lp.produto AS produto,
        ${F.convenio.sql} AS convenio, ${F.produzido.sql} AS produzido,
        qvis.recebido AS recebido, ${F.produzido.sql} AS valor,
        lp.indicante AS indicante, lp.cirurgiao AS cirurgiao,
        lp.medico AS medico, lp.tipo_recebimento AS tipo_recebimento
      FROM linhas_producao lp
      INNER JOIN (
        SELECT admissao, MAX(data_admissao) AS data_admissao, MAX(paciente) AS paciente,
               MAX(procedimento) AS procedimento, MAX(convenio) AS convenio,
               MAX(mes_pagamento) AS mes_pagamento,
               SUM(produzido) AS produzido, SUM(recebido) AS recebido
        FROM linhas_qvis
        WHERE UPPER(COALESCE(procedimento,'')) LIKE '%LIO%'
          AND UPPER(COALESCE(procedimento,'')) NOT LIKE '%TAXA DE MEDICO EXTERNO%'
          AND admissao IS NOT NULL AND admissao <> '' AND (${likesFlag})${filtroMesPgto}
        GROUP BY admissao
      ) qvis ON qvis.admissao = lp.cod_admissao
      WHERE ${wheresProd.join(' AND ')}
      ORDER BY ${F.produzido.sql} DESC, lp.cod_admissao
    `;
    try { return aplicarExceto(Banco.query(sql) || []); }   // V918: EXCETO vale no core
    catch (e) { console.error('[repasseLIO] montarLinhasConvenio:', e); return []; }
  }

  /**
   * Função principal: retorna LINHAS DE REPASSE PADRONIZADAS do LIO
   * (formato esperado por App.repasse).
   */
  function calcularRepasses(filtros, opts) {
    limparCaches();
    const cfg = lerConfigCalculo();
    const desab = admissoesDesabilitadas();

    // Linhas reais de Convênio + linhas de teste (filtradas por competência)
    let linhas = montarLinhasConvenio(filtros, opts);
    const teste = listarLinhasTeste().filter(t => {
      if (!filtros || (!filtros.ano && !filtros.mes)) return true;
      const c = String(t.competencia || t.data_admissao || '');
      const ano = c.slice(0, 4), mes = c.slice(5, 7);
      if (filtros.ano && ano && ano !== String(filtros.ano)) return false;
      if (filtros.mes && mes && mes !== String(filtros.mes)) return false;
      return true;
    });
    linhas = linhas.concat(teste);

    const out = [];
    for (const l of linhas) {
      // pula desabilitadas por duplicidade e linhas sem regra/sem OPME
      if (desab.has(String(l.admissao))) continue;
      const calc = calcularRepasseLinha(l, cfg);
      if (calc.semRegra || calc.repTotal <= 0) continue;
      out.push({
        competencia: l.competencia || '',
        admissao: String(l.admissao || ''),
        paciente: l.paciente || '',
        produto: l.produto || '',
        convenio: l.convenio || '',
        origem: 'Convênio',
        executante: l.cirurgiao || l.medico || '',
        indicante: l.indicante || '',
        repasseExecutante: calc.repExec || 0,
        repasseIndicante: calc.repInd || 0,
        valorBase: calc.valorLio || 0,
        _meta: {
          teste: !!l._teste,
          opme: calc.opmeIdentificado ? calc.opmeIdentificado.produto : null,
          termos: calc.termosCasados || [],
          recebido: Number(l.recebido) || 0,
        },
      });
    }
    return out;
  }

  // Namespace público
  App.repasseLIO = {
    TERMOS_REGRA_LIO, COLUNAS_MATRIZ_CONV,
    lerOrigemColuna, obterFonteAtiva, lerTermosDoOpme,
    resolverConvenioFlagado, carregarOpmesCadastrados, identificarOpmeCadastrado,
    limparCaches, temRegraAplicada, calcularRepasseLinha, lerConfigCalculo,
    listarLinhasTeste, montarLinhasConvenio, montarLinhasParticular,
    admissoesDesabilitadas, calcularRepasses,
    // V667: ADICIONAL (diferença acima do valor de tabela, executante Catarata)
    lerPctAdicional, lentesAdicional, identificarLenteAdicional,
    identificarLentesAdicional,   // V708: todos os padrões que casam
    medicosCatarata, calcularLinhaAdicional, montarLinhasAdicional,
    adicionalNoConsolidado,   // V672
  };

  // Registra como provider (se o núcleo já estiver carregado)
  if (App.repasse && typeof App.repasse.registrar === 'function') {
    App.repasse.registrar('lio', {
      nome: 'LIO', icone: '👁',
      calcular: (filtros) => calcularRepasses(filtros),
    });
  }
})();
