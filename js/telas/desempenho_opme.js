/**
 * ============================================================================
 * TELA: Desempenho · OPME
 *
 * Interface dividida em dois painéis sincronizados:
 *   - ESQUERDA: Relatório QVIS — itens OPME elegíveis (filtro por termos)
 *   - DIREITA:  Produção QVIS  — itens OPME elegíveis (filtro por termos)
 *
 * Regras principais:
 *   • Filtro AUTOMÁTICO: só aparecem OPMEs cujo "produto"/"procedimento"
 *     contenha algum dos termos elegíveis
 *     (default: ANTIGLAUCOMATOSA, ISTENT, VALVULA, AHMED, PRESERFLO, MP3) — sempre com classificação OPME.
 *   • Filtro de BUSCA é GLOBAL (afeta os dois lados ao mesmo tempo).
 *   • Repasse = valor do OPME × pct (geral 10%, ou específica por médico).
 *   • Pago é por ADMISSÃO inteira (sincroniza os dois lados em verde).
 * ============================================================================
 */
App.telas['desempenho-opme'] = (function () {
  'use strict';

  const escapeHTML = (s) => (s == null ? '' : String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  const fmt = (n, dec = 2) => Utilidades.formatarNumero(Number(n) || 0, dec);

  function norm(s) {
    if (!s) return '';
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  }
  function formatarData(iso) {
    if (!iso) return '—';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
  }
  const MESES_EXTENSO = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  function formatarMesExtenso(yyyyMm) {
    if (!yyyyMm) return '—';
    const m = String(yyyyMm).match(/^(\d{4})-(\d{2})/);
    if (!m) return yyyyMm;
    const idx = parseInt(m[2], 10) - 1;
    if (idx < 0 || idx > 11) return yyyyMm;
    return `${MESES_EXTENSO[idx]}/${m[1]}`;
  }
  function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Retorna { meses: ['01'..'12'], anos: ['2026', ...] } a partir dos meses
   * de PAGAMENTO (= mês do relatório) — não da data da admissão.
   * O usuário pensa em "relatório de Abril" como mes_pagamento, não competencia.
   */
  /**
   * Retorna { meses: ['01'..'12'], anos: ['2026', ...] } com base nos meses
   * encontrados nas duas bases:
   *   - linhas_qvis.mes_pagamento (mês do relatório QVIS)
   *   - linhas_producao.competencia (mês de realização do procedimento)
   */
  let _mesesAnosCache = null, _mesesAnosKey = '';
  function listarMesesEAnos() {
    // V663: também era um scan LIKE das DUAS tabelas gigantes a cada render —
    // cacheado pelo mesmo carimbo das bases (invalida só em reimportação)
    const chaveMA = _carimboBases();
    if (_mesesAnosCache && _mesesAnosKey === chaveMA) return _mesesAnosCache;
    const meses = new Set();
    const anos = new Set();
    try {
      const q = Banco.query(`
        SELECT DISTINCT mes_pagamento AS m
          FROM linhas_qvis
         WHERE classificacao_produto LIKE '%OPME%'
           AND mes_pagamento IS NOT NULL AND mes_pagamento <> ''
        UNION
        SELECT DISTINCT competencia AS m
          FROM linhas_producao
         WHERE classificacao_produto LIKE '%OPME%'
           AND competencia IS NOT NULL AND competencia <> ''
      `);
      for (const r of q) if (r.m) {
        const mat = String(r.m).match(/^(\d{4})-(\d{2})/);
        if (mat) { anos.add(mat[1]); meses.add(mat[2]); }
      }
    } catch (e) { /* ignore */ }
    const r = {
      meses: Array.from(meses).sort(),
      anos:  Array.from(anos).sort().reverse(),
    };
    _mesesAnosCache = r; _mesesAnosKey = chaveMA;   // V663
    return r;
  }

  /**
   * Lista procedimentos distintos do QVIS (campo `procedimento`) que casam
   * com um termo macro (ANEL/ISTENT/VALVULA). Usado pelo dropdown no header
   * do Relatório QVIS — onde o usuário pode excluir procedimentos individuais.
   */
  function listarProcedimentosDoTermoQvis(termo) {
    const termoUp = String(termo).toUpperCase();
    try {
      const result = Banco.query(`
        SELECT DISTINCT procedimento AS p
          FROM linhas_qvis
         WHERE classificacao_produto LIKE '%OPME%'
           AND UPPER(procedimento) LIKE ?
           AND procedimento IS NOT NULL AND procedimento <> ''
         ORDER BY procedimento
         LIMIT 200
      `, [`%${termoUp}%`]);
      return result.map(r => r.p).filter(Boolean);
    } catch (e) { console.warn(e); return []; }
  }

  /**
   * Lista produtos distintos da Produção que casam com os termos elegíveis
   * (após filtros de OPME, termos, mes/ano). Usado pelo dropdown "Produtos"
   * no header da Produção QVIS — onde o usuário escolhe individualmente
   * quais produtos quer ver ou esconder.
   */
  function listarProdutosProducao(termosAtivos, mes, ano) {
    try {
      // V663: deriva do MESMO scan cacheado do carregarProducao (sem novo
      // SELECT DISTINCT com LIKE na tabela gigante a cada render)
      const termosBusca = (termosAtivos || []).concat(extrasProducaoAtivos());
      let linhas = _scanProducao(termosBusca, extrasLivres());
      linhas = filtroCompetencia(linhas, mes, ano);
      const set = new Set();
      for (const r of linhas) if (r.produto) set.add(r.produto);
      const excluidos = listarProdutosExcluidos();
      const result = Array.from(set).filter(p => !excluidos.has(p));
      result.sort();
      return result;
    } catch (e) { console.warn(e); return []; }
  }

  /** Lista produtos distintos da base que casam com um termo macro. */
  function listarProdutosDoTermo(termo) {
    const termoUp = String(termo).toUpperCase();
    const produtos = new Set();
    try {
      const a = Banco.query(`
        SELECT DISTINCT produto AS p
          FROM linhas_producao
         WHERE classificacao_produto LIKE '%OPME%'
           AND UPPER(produto) LIKE ?
           AND produto IS NOT NULL AND produto <> ''
         ORDER BY produto
         LIMIT 200
      `, [`%${termoUp}%`]);
      for (const r of a) if (r.p) produtos.add(r.p);
    } catch (e) { /* ignore */ }
    try {
      const b = Banco.query(`
        SELECT DISTINCT procedimento AS p
          FROM linhas_qvis
         WHERE classificacao_produto LIKE '%OPME%'
           AND UPPER(procedimento) LIKE ?
           AND procedimento IS NOT NULL AND procedimento <> ''
         ORDER BY procedimento
         LIMIT 200
      `, [`%${termoUp}%`]);
      for (const r of b) if (r.p) produtos.add(r.p);
    } catch (e) { /* ignore */ }
    return Array.from(produtos).sort();
  }

  // ──────────────────────────────────────────────────────────────────────
  // CONFIG: lê/escreve config_opme, opme_termos_elegiveis, opme_regra_medico
  // ──────────────────────────────────────────────────────────────────────

  function lerConfig() {
    const cfg = { pctGeral: 10, respeitarMedico: true, termos: [], regrasMedico: new Map() };
    try {
      const r = Banco.queryUnica(`SELECT valor FROM config_opme WHERE chave = 'PCT_GERAL'`);
      if (r) cfg.pctGeral = Number(r.valor) || 10;
    } catch (e) { /* ignore */ }
    try {
      const rm = Banco.queryUnica(`SELECT valor FROM config_opme WHERE chave = 'RESPEITAR_REGRA_MEDICO'`);
      if (rm) cfg.respeitarMedico = String(rm.valor) !== '0';
    } catch (e) { /* ignore */ }
    try {
      cfg.termos = Banco.query(`SELECT termo, ativo, pct FROM opme_termos_elegiveis ORDER BY termo`);
    } catch (e) { cfg.termos = []; }
    // V663: regra por PRODUTO e por PAPEL — switches nascem DESLIGADOS
    cfg.regraProdutoAtiva = false; cfg.regraPapelAtiva = false;
    cfg.regrasProduto = new Map(); cfg.regrasPapel = new Map();
    cfg.regrasProdutoRows = []; cfg.regrasPapelRows = [];
    try {
      const fp = Banco.queryUnica(`SELECT valor FROM config_opme WHERE chave = 'REGRA_PRODUTO_ATIVA'`);
      cfg.regraProdutoAtiva = !!fp && String(fp.valor) === '1';
      const fpp = Banco.queryUnica(`SELECT valor FROM config_opme WHERE chave = 'REGRA_PAPEL_ATIVA'`);
      cfg.regraPapelAtiva = !!fpp && String(fpp.valor) === '1';
      cfg.regrasProdutoRows = Banco.query(`SELECT produto_normalizado, produto_exibicao, pct FROM opme_regra_produto ORDER BY produto_exibicao`) || [];
      for (const r of cfg.regrasProdutoRows) cfg.regrasProduto.set(r.produto_normalizado, r);
      cfg.regrasPapelRows = Banco.query(`SELECT papel_normalizado, papel_exibicao, produto_normalizado, produto_exibicao, pct FROM opme_regra_papel ORDER BY papel_exibicao, produto_exibicao`) || [];
      // V665: chave papel|produto ('' no produto = qualquer produto)
      for (const r of cfg.regrasPapelRows) cfg.regrasPapel.set(`${r.papel_normalizado}|${r.produto_normalizado || ''}`, Number(r.pct));
    } catch (e) { /* tabelas novas podem não existir em banco antigo */ }
    try {
      const linhas = Banco.query(`
        SELECT nome_normalizado, nome_exibicao, pct
          FROM opme_regra_medico ORDER BY nome_exibicao
      `);
      cfg.regrasMedicoRows = linhas;   // todas as linhas cruas (p/ exibir/remover na UI)
      // Mapa keado pela CHAVE CANÔNICA do médico (de-para) → a regra vale pra
      // todas as grafias do mesmo médico, não só a grafia cadastrada.
      for (const l of linhas) cfg.regrasMedico.set(chaveMedicoCanonica(l.nome_exibicao), l);
    } catch (e) { /* ignore */ }
    return cfg;
  }

  async function salvarPctGeral(pct) {
    Banco.executar(`INSERT INTO config_opme (chave, valor) VALUES ('PCT_GERAL', ?)
      ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`, [String(Number(pct).toFixed(2))]);   // V664: via executar (Linha do Tempo)
    await Banco.salvar();
  }

  // % de repasse por OPME (termo). pct vazio/null → volta a usar a regra geral.
  async function salvarPctTermo(termo, pct) {
    const vazio = (pct === '' || pct === null || pct === undefined || isNaN(Number(pct)));
    Banco.executar(`UPDATE opme_termos_elegiveis SET pct = ? WHERE termo = ?`, [vazio ? null : Number(pct), termo]);
    await Banco.salvar();
  }

  // Flag: quando um OPME tem % próprio E o médico tem regra, quem vence?
  // true (1) = a regra do médico prevalece; false (0) = o % do OPME prevalece.
  async function salvarRespeitarMedico(respeita) {
    Banco.executar(`INSERT INTO config_opme (chave, valor) VALUES ('RESPEITAR_REGRA_MEDICO', ?)
      ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`, [respeita ? '1' : '0']);
    await Banco.salvar();
  }

  async function toggleTermoAtivo(termo, ativo) {
    Banco.executar(`UPDATE opme_termos_elegiveis SET ativo = ? WHERE termo = ?`, [ativo ? 1 : 0, termo]);
    await Banco.salvar();
  }
  async function adicionarTermo(termo) {
    const t = norm(termo);
    if (!t) return false;
    Banco.executar(`INSERT OR IGNORE INTO opme_termos_elegiveis (termo, ativo) VALUES (?, 1)`, [t]);
    await Banco.salvar();
    return true;
  }
  async function removerTermo(termo) {
    Banco.executar(`DELETE FROM opme_termos_elegiveis WHERE termo = ?`, [termo]);
    await Banco.salvar();
  }

  // ── V661: produtos ADICIONADOS da Produção QVIS (termos extras de busca) ──
  // Só o painel Produção usa; busca "contém" no nome do produto (classif. OPME).
  function listarExtrasProducao() {
    try { return Banco.query(`SELECT termo, ativo FROM opme_producao_extras ORDER BY termo`) || []; } catch (e) { return []; }
  }
  /** V874: os PRODUTOS ADICIONADOS ficam isentos da trava de palavra inteira */
  function extrasLivres() {
    return new Set(extrasProducaoAtivos().map(norm));
  }
  function extrasProducaoAtivos() {
    try { return (Banco.query(`SELECT termo FROM opme_producao_extras WHERE ativo = 1 ORDER BY termo`) || []).map(r => r.termo); } catch (e) { return []; }
  }
  async function adicionarExtraProducao(termo) {
    const t = norm(termo);
    if (!t) return false;
    Banco.executar(`INSERT OR IGNORE INTO opme_producao_extras (termo, ativo) VALUES (?, 1)`, [t]);
    await Banco.salvar();
    return true;
  }
  async function toggleExtraProducao(termo) {
    Banco.executar(`UPDATE opme_producao_extras SET ativo = 1 - ativo WHERE termo = ?`, [termo]);
    await Banco.salvar();
  }
  async function removerExtraProducao(termo) {
    Banco.executar(`DELETE FROM opme_producao_extras WHERE termo = ?`, [termo]);
    await Banco.salvar();
  }

  // ── V663: regra específica por PRODUTO / por PAPEL (switch, nasce inativa) ──
  async function salvarFlagConfigOpme(chave, ligada) {
    Banco.executar(`INSERT INTO config_opme (chave, valor) VALUES (?, ?)
                    ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`, [chave, ligada ? '1' : '0']);
    await Banco.salvar();
  }
  async function adicionarRegraProduto(produto, pct) {
    const p = String(produto || '').trim();
    if (!p) return false;
    Banco.executar(`INSERT INTO opme_regra_produto (produto_normalizado, produto_exibicao, pct) VALUES (?,?,?)
                    ON CONFLICT(produto_normalizado) DO UPDATE SET produto_exibicao = excluded.produto_exibicao, pct = excluded.pct`,
                   [norm(p), p, Number(pct) || 0]);
    await Banco.salvar();
    return true;
  }
  async function removerRegraProduto(produtoNorm) {
    Banco.executar(`DELETE FROM opme_regra_produto WHERE produto_normalizado = ?`, [produtoNorm]);
    await Banco.salvar();
  }
  async function adicionarRegraPapel(papel, pct, produto) {
    const p = String(papel || '').trim();
    if (!p) return false;
    const prod = String(produto || '').trim();   // V665: '' = qualquer produto
    Banco.executar(`INSERT INTO opme_regra_papel (papel_normalizado, papel_exibicao, produto_normalizado, produto_exibicao, pct) VALUES (?,?,?,?,?)
                    ON CONFLICT(papel_normalizado, produto_normalizado) DO UPDATE SET
                      papel_exibicao = excluded.papel_exibicao,
                      produto_exibicao = excluded.produto_exibicao,
                      pct = excluded.pct`,
                   [norm(p), p, prod ? norm(prod) : '', prod || null, Number(pct) || 0]);
    await Banco.salvar();
    return true;
  }
  async function removerRegraPapel(papelNorm, produtoNorm) {
    Banco.executar(`DELETE FROM opme_regra_papel WHERE papel_normalizado = ? AND produto_normalizado = ?`, [papelNorm, produtoNorm || '']);
    await Banco.salvar();
  }
  /** V663: papéis distintos do QVIS OPME (do scan cacheado — sem novo SQL). */
  function listarPapeisOpme(termosAtivos) {
    try {
      const set = new Set();
      for (const l of carregarQvis(termosAtivos || listarTermosAtivos(), '', '') || []) {
        const p = String(l.papel || '').trim();
        if (p) set.add(p);
      }
      return Array.from(set).sort();
    } catch (e) { return []; }
  }

  async function adicionarRegraMedico(nomeExibicao, pct) {
    const nomeNorm = norm(nomeExibicao);
    if (!nomeNorm) return;
    Banco.executar(`INSERT INTO opme_regra_medico (nome_normalizado, nome_exibicao, pct)
      VALUES (?, ?, ?)
      ON CONFLICT(nome_normalizado) DO UPDATE SET
        nome_exibicao = excluded.nome_exibicao,
        pct = excluded.pct`, [nomeNorm, nomeExibicao, Number(pct) || 0]);
    await Banco.salvar();
  }
  async function removerRegraMedico(nomeNormalizado) {
    Banco.executar(`DELETE FROM opme_regra_medico WHERE nome_normalizado = ?`, [nomeNormalizado]);
    await Banco.salvar();
  }

  // ── VALOR FIXO DE OPME (subfaturamento) — por convênio + curinga ──────
  // Cadastro (convênio, padrão de busca → valor fixo). Em qualquer linha NÃO
  // particular cujo produto CONTENHA o padrão, se o produzido for MENOR que o
  // valor fixo, a base do repasse vira o valor fixo (só sobe). Casamento por
  // convênio: entrada com convênio casa só esse convênio; convênio vazio =
  // CURINGA (qualquer convênio). Desempate: convênio-específico vence o
  // curinga; no mesmo nível, padrão mais longo (mais específico) vence.
  let _vfCache = null;
  let _vfVer = -1;
  function carregarValoresFixos() {
    try {
      return Banco.query(`SELECT id, convenio, padrao, valor_fixo, ativo FROM opme_valor_fixo ORDER BY convenio, LENGTH(padrao) DESC, padrao`);
    } catch (e) { return []; }
  }
  function valoresFixosAtivos() {
    const ver = (typeof Banco !== 'undefined' ? (Banco._versao || 0) : 0);
    if (_vfCache === null || _vfVer !== ver) { _vfCache = carregarValoresFixos(); _vfVer = ver; }
    return _vfCache.filter(v => Number(v.ativo));
  }
  function invalidarValoresFixos() { _vfCache = null; }

  /** Convênios distintos da base QVIS (pro seletor do cadastro). */
  function listarConveniosQvis() {
    try {
      return Banco.query(`SELECT DISTINCT convenio AS c FROM linhas_qvis WHERE convenio IS NOT NULL AND TRIM(convenio) <> '' ORDER BY convenio`).map(r => r.c);
    } catch (e) { return []; }
  }

  /** Termos de um padrão (separados por '|' — ou por espaço, p/ dados legados). */
  function termosDoPadrao(padrao) {
    const s = String(padrao || '').trim();
    if (!s) return [];
    const parts = s.indexOf('|') >= 0 ? s.split('|') : s.split(/\s+/);
    return parts.map(t => t.trim()).filter(Boolean);
  }

  /** Casa (convênio + produto). O padrão é MULTI-TERMO (como o LIO): exige que
   *  TODOS os termos estejam contidos no nome do OPME (lógica E), robusto a
   *  hífen/separador. Específico vence curinga; depois mais termos; depois mais longo. */
  function casarValorFixo(produto, convenioLinha) {
    const p = norm(produto || '');
    if (!p) return null;
    const cv = norm(convenioLinha || '');
    let melhor = null, melhorConv = -1, melhorTok = -1, melhorLen = -1;
    for (const vf of valoresFixosAtivos()) {
      const tokens = termosDoPadrao(vf.padrao).map(t => norm(t)).filter(Boolean);
      if (!tokens.length) continue;
      if (!tokens.every(t => p.indexOf(t) >= 0)) continue;   // TODOS os termos precisam estar no nome
      const convCad = norm(vf.convenio || '');
      let nivel;
      if (!convCad) nivel = 0;                       // curinga (qualquer convênio)
      else if (cv && convCad === cv) nivel = 1;      // convênio específico que bate
      else continue;                                 // convênio específico que NÃO bate → ignora
      const nTok = tokens.length;
      const len = tokens.join('').length;
      if (nivel > melhorConv
          || (nivel === melhorConv && nTok > melhorTok)
          || (nivel === melhorConv && nTok === melhorTok && len > melhorLen)) {
        melhor = vf; melhorConv = nivel; melhorTok = nTok; melhorLen = len;
      }
    }
    return melhor ? { valor: Number(melhor.valor_fixo) || 0, padrao: melhor.padrao, convenio: melhor.convenio } : null;
  }

  // ── V661: escolha por LINHA entre valor AJUSTADO (fixo) e valor REAL ──────
  // Persistida em opme_usar_real (chave admissao|produtoNorm) — vale na tela,
  // nos totais e no consolidado (todos passam por baseComValorFixo).
  let _usarRealCache = null, _usarRealCacheV = -1;
  /**
   * ══ V897: O AJUSTE É SUGERIDO, NÃO AUTOMÁTICO ════════════════════════════
   *
   * Pedido do usuário: a linha do Relatório QVIS mostra o VALOR REAL, com a
   * sugestão "ajustar" quando há valor fixado casando. Só ao CLICAR o valor
   * ajustado passa a valer (e o repasse acompanha). A decisão fica gravada
   * por linha (admissão|produto) em opme_ajuste_aceito, e o clique no
   * "ajustado" desfaz. A tabela antiga opme_usar_real ficou obsoleta: o real
   * agora é o padrão de todo mundo.
   */
  function usarRealSet() {
    const v = (window.Banco && Banco._versao) || 0;
    if (_usarRealCache && _usarRealCacheV === v) return _usarRealCache;
    const s = new Set();
    try { (Banco.query(`SELECT chave FROM opme_ajuste_aceito`) || []).forEach(r => s.add(r.chave)); } catch (e) {}
    _usarRealCache = s; _usarRealCacheV = v;
    return s;
  }
  function chaveUsarReal(adm, produto) {
    return `${String(adm || '').trim()}|${norm(produto || '')}`;
  }
  async function toggleUsarReal(adm, produto) {
    const k = chaveUsarReal(adm, produto);
    if (!k || k === '|') return false;
    try {
      if (usarRealSet().has(k)) Banco.executar(`DELETE FROM opme_ajuste_aceito WHERE chave = ?`, [k]);
      else Banco.executar(`INSERT OR IGNORE INTO opme_ajuste_aceito (chave) VALUES (?)`, [k]);
      _usarRealCache = null;
      Banco.salvarDebounced();
      return true;
    } catch (e) { console.warn('[OPME] toggleUsarReal:', e); return false; }
  }

  /** Base efetiva: se NÃO for particular e houver valor fixo casado (>0), usa o valor
   *  fixo — independente de o relatório ter vindo maior ou menor.
   *  V661: com `adm` informado e a linha marcada pra usar o VALOR REAL, a base
   *  volta a ser o produzido (usandoReal=true; `fixo` guarda o valor fixado). */
  function baseComValorFixo(produto, produzido, convenioLinha, ehParticular, adm) {
    const prod = Number(produzido) || 0;
    if (ehParticular) return { base: prod, ajustado: false, padrao: null, original: prod };
    const m = casarValorFixo(produto, convenioLinha);
    if (m && m.valor > 0) {
      // V897: o fixado só vale DEPOIS do aceite da linha; antes é sugestão
      const aceito = adm != null && usarRealSet().has(chaveUsarReal(adm, produto));
      if (aceito) {
        return { base: m.valor, ajustado: true, usandoReal: false, fixo: m.valor, padrao: m.padrao, convenio: m.convenio, original: prod };
      }
      return { base: prod, ajustado: true, usandoReal: true, sugerido: true, fixo: m.valor, padrao: m.padrao, convenio: m.convenio, original: prod };
    }
    return { base: prod, ajustado: false, padrao: null, original: prod };
  }

  async function adicionarValorFixo(convenio, padraoRaw, valor) {
    const termos = termosDoPadrao(padraoRaw);
    if (!termos.length) return false;
    const c = String(convenio || '').trim();
    Banco.executar(`INSERT INTO opme_valor_fixo (convenio, padrao, valor_fixo, ativo) VALUES (?, ?, ?, 1)`, [c, termos.join('|'), Number(valor) || 0]);
    await Banco.salvar(); invalidarValoresFixos(); return true;
  }
  // campo ∈ { 'padrao', 'valor_fixo' } — whitelist (sem injeção)
  async function atualizarValorFixoCampo(id, campo, valor) {
    if (campo !== 'padrao' && campo !== 'valor_fixo') return;
    const v = campo === 'valor_fixo' ? (Number(valor) || 0) : String(valor || '').trim();
    if (campo === 'padrao' && !v) return;
    Banco.executar(`UPDATE opme_valor_fixo SET ${campo} = ? WHERE id = ?`, [v, Number(id)]);
    await Banco.salvar(); invalidarValoresFixos();
  }
  async function removerValorFixo(id) {
    Banco.executar(`DELETE FROM opme_valor_fixo WHERE id = ?`, [Number(id)]);
    await Banco.salvar(); invalidarValoresFixos();
  }
  // ── Termos (chips) de um valor fixo — gravados em 'padrao' separados por '|' ──
  function termosDoVFId(id) {
    try { const r = Banco.queryUnica(`SELECT padrao FROM opme_valor_fixo WHERE id = ?`, [Number(id)]); return r ? termosDoPadrao(r.padrao) : []; }
    catch (e) { return []; }
  }
  async function setTermosVF(id, termosArr) {
    const termos = (termosArr || []).map(t => String(t || '').trim()).filter(Boolean);
    if (!termos.length) { await removerValorFixo(id); return; }   // sem termos → remove o cadastro
    const stmt = Banco.db.prepare(`UPDATE opme_valor_fixo SET padrao = ? WHERE id = ?`);
    try { stmt.run([termos.join('|'), Number(id)]); } finally { stmt.free(); }
    await Banco.salvar(); invalidarValoresFixos();
  }
  async function adicionarTermoVF(id, termo) {
    const t = String(termo || '').trim();
    if (!t) return false;
    const termos = termosDoVFId(id); termos.push(t);
    await setTermosVF(id, termos); return true;
  }
  async function editarTermoVF(id, indice, novoTermo) {
    const termos = termosDoVFId(id);
    if (indice < 0 || indice >= termos.length) return;
    termos[indice] = String(novoTermo || '').trim();
    await setTermosVF(id, termos);
  }
  async function removerTermoVF(id, indice) {
    const termos = termosDoVFId(id);
    if (indice < 0 || indice >= termos.length) return;
    termos.splice(indice, 1);
    await setTermosVF(id, termos);
  }

  /** Retorna Set com nomes de produtos excluídos. */
  function listarProdutosExcluidos() {
    const s = new Set();
    try {
      const linhas = Banco.query(`SELECT produto FROM opme_produtos_excluidos`);
      for (const l of linhas) if (l.produto) s.add(l.produto);
    } catch (e) { /* ignore */ }
    return s;
  }
  async function excluirProduto(produto) {
    if (!produto) return;
    const stmt = Banco.db.prepare(`
      INSERT OR IGNORE INTO opme_produtos_excluidos (produto, excluido_em)
      VALUES (?, CURRENT_TIMESTAMP)
    `);
    try { stmt.run([produto]); } finally { stmt.free(); }
    await Banco.salvar();
  }
  async function restaurarProduto(produto) {
    if (!produto) return;
    const stmt = Banco.db.prepare(`DELETE FROM opme_produtos_excluidos WHERE produto = ?`);
    try { stmt.run([produto]); } finally { stmt.free(); }
    await Banco.salvar();
  }
  // V492: variantes em LOTE — todos os INSERT/DELETE primeiro e UM único
  // Banco.salvar() ao final (mesmo padrão de criarEvsEmLote). As funções
  // unitárias acima continuam existindo pros cliques individuais.
  async function excluirProdutosEmLote(produtos) {
    const lista = (produtos || []).filter(Boolean);
    if (lista.length === 0) return;
    const stmt = Banco.db.prepare(`
      INSERT OR IGNORE INTO opme_produtos_excluidos (produto, excluido_em)
      VALUES (?, CURRENT_TIMESTAMP)
    `);
    try { for (const p of lista) stmt.run([p]); } finally { stmt.free(); }
    await Banco.salvar();
  }
  async function restaurarProdutosEmLote(produtos) {
    const lista = (produtos || []).filter(Boolean);
    if (lista.length === 0) return;
    const stmt = Banco.db.prepare(`DELETE FROM opme_produtos_excluidos WHERE produto = ?`);
    try { for (const p of lista) stmt.run([p]); } finally { stmt.free(); }
    await Banco.salvar();
  }

  // ──────────────────────────────────────────────────────────────────────
  // DADOS
  // ──────────────────────────────────────────────────────────────────────

  /** Cláusula SQL "(col LIKE %t1% OR col LIKE %t2%...)" com bind seguro. */
  function clausulaLikeOr(termos, colunas) {
    if (!termos || termos.length === 0) return { sql: '0', params: [] };
    const partes = [];
    const params = [];
    for (const termo of termos) {
      for (const col of colunas) {
        partes.push(`UPPER(${col}) LIKE ?`);
        params.push(`%${String(termo).toUpperCase()}%`);
      }
    }
    return { sql: '(' + partes.join(' OR ') + ')', params };
  }

  /**
   * ══ V874: TERMO CURTO CASA POR PALAVRA INTEIRA ═══════════════════════════
   *
   * O casamento de termo elegível sempre foi "contém". Funciona bem para nomes
   * longos (ANTIGLAUCOMATOSA, PRESERFLO), mas quebra nos curtos: com o termo
   * COLA — pedido do usuário (V873) —
   * "contém" pega COLAGENO e COLANGIO, materiais que não têm nada a ver, e o
   * repasse sairia inventado.
   *
   * Agora termo com menos de 5 letras (COLA, MP3) exige aparecer como PALAVRA
   * INTEIRA; de 5 letras para cima nada muda, segue o "contém" de sempre. É a
   * mesma trava, agora nas duas telas.
   *
   * Os PRODUTOS ADICIONADOS da Produção (⚙ Ajustes) ficam de fora da trava:
   * ali o usuário digita um trecho de nome para procurar, e a busca é "contém"
   * por definição.
   *
   * O SQL continua com o LIKE de sempre — ele é o filtro grosso (barato e
   * cacheado); a trava é aplicada em cima do resultado.
   */
  const _palavrasOpme = (s) => norm(s).replace(/[^A-Z0-9]+/g, ' ').split(' ').filter(Boolean);
  function termoCasaProduto(termo, texto, exigirPalavra) {
    const t = norm(termo), p = norm(texto);
    if (!t || !p) return false;
    if (exigirPalavra === false || t.length >= 5) return p.indexOf(t) >= 0;
    return _palavrasOpme(p).indexOf(t) >= 0;
  }
  /** alguma das grafias casa o texto? `livres` = termos isentos da trava */
  function casaAlgumTermo(texto, termos, livres) {
    for (const t of (termos || [])) {
      const livre = !!(livres && livres.has(norm(t)));
      if (termoCasaProduto(t, texto, !livre)) return true;
    }
    return false;
  }

  /**
   * Filtra QVIS pelo MÊS DO RELATÓRIO (mes_pagamento), não pela competência
   * da data da admissão. "Abril" = relatório QVIS de Abril (mes_pagamento=2026-04).
   */
  function filtroQvisPorMesPagamento(linhas, mes, ano) {
    if (!mes && !ano) return linhas;
    return linhas.filter(l => {
      const mp = String(l.mes_pagamento || '');
      const m = mp.match(/^(\d{4})-(\d{2})/);
      if (!m) return false;
      if (ano && m[1] !== ano) return false;
      if (mes && m[2] !== mes) return false;
      return true;
    });
  }

  /** Compatibilidade: filtro por competencia (data_admissao YYYY-MM). */
  function filtroCompetencia(linhas, mes, ano) {
    if (!mes && !ano) return linhas;
    return linhas.filter(l => {
      const comp = String(l.competencia || '');
      const m = comp.match(/^(\d{4})-(\d{2})/);
      if (!m) return false;
      if (ano && m[1] !== ano) return false;
      if (mes && m[2] !== mes) return false;
      return true;
    });
  }

  /** Retorna lista de strings com os termos ativos (ANEL, ISTENT, etc). */
  function listarTermosAtivos() {
    const cfg = lerConfig();
    return cfg.termos.filter(t => t.ativo).map(t => t.termo);
  }

  // ════════════════════════════════════════════════════════════════════
  // SUBSTITUIÇÃO DE MÉDICO (redirecionamento de repasse)
  // ════════════════════════════════════════════════════════════════════

  /** Chave da substituição: admissao + codigo_relatorio + papel (papel '' se nulo) */
  function chaveSubs(admissao, codRel, papel) {
    return `${String(admissao || '').trim()}|${String(codRel || '').trim()}|${String(papel || '').trim()}`;
  }

  /** Carrega todas as substituições — Map<chave, {nome_substituto, nome_original, nome_normalizado}> */
  function carregarTodasSubstituicoes() {
    const m = new Map();
    try {
      const linhas = Banco.query(`SELECT * FROM opme_substituicao_medico`);
      for (const l of linhas) {
        m.set(chaveSubs(l.admissao, l.codigo_relatorio, l.papel), l);
      }
    } catch (e) { console.warn(e); }
    return m;
  }

  /** Aplica substituição de médico — grava no banco. */
  async function substituirMedico(admissao, codRel, papel, nomeOriginal, nomeSubstituto) {
    const stmt = Banco.db.prepare(`
      INSERT OR REPLACE INTO opme_substituicao_medico
        (admissao, codigo_relatorio, papel, nome_original, nome_substituto, nome_normalizado, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    try {
      stmt.run([
        String(admissao || '').trim(),
        String(codRel || '').trim(),
        String(papel || '').trim(),
        nomeOriginal || '',
        nomeSubstituto,
        normalizarNomeMed(nomeSubstituto),
      ]);
    } finally { stmt.free(); }
    await Banco.salvar();
  }

  /** Remove substituição (restaura o médico original). */
  async function restaurarMedicoOriginal(admissao, codRel, papel) {
    const stmt = Banco.db.prepare(`
      DELETE FROM opme_substituicao_medico
       WHERE admissao = ? AND codigo_relatorio = ? AND papel = ?
    `);
    try {
      stmt.run([
        String(admissao || '').trim(),
        String(codRel || '').trim(),
        String(papel || '').trim(),
      ]);
    } finally { stmt.free(); }
    await Banco.salvar();
  }

  /**
   * Retorna lista de médicos sugeridos (nomes distintos do QVIS + nomes com
   * regra específica cadastrada). Usado pelo modal de substituição.
   */
  function listarMedicosSugeridos() {
    const set = new Set();
    try {
      const linhas = Banco.query(`
        SELECT DISTINCT nome_profissional AS n
          FROM linhas_qvis
         WHERE nome_profissional IS NOT NULL AND nome_profissional <> ''
        UNION
        SELECT DISTINCT cirurgiao AS n
          FROM linhas_producao
         WHERE cirurgiao IS NOT NULL AND cirurgiao <> ''
        UNION
        SELECT DISTINCT nome_exibicao AS n
          FROM opme_regra_medico
         WHERE nome_exibicao IS NOT NULL AND nome_exibicao <> ''
      `);
      for (const r of linhas) if (r.n) set.add(r.n.trim());
    } catch (e) { console.warn(e); }
    // Canoniza pelo de-para (nome oficial) e deduplica
    const canon = new Set();
    for (const raw of set) { const r = resolverMedicoCanonico(raw); if (r.nome) canon.add(r.nome); }
    return Array.from(canon).sort();
  }

  // ════════════════════════════════════════════════════════════════════
  // EV — REPASSE ANTECIPADO (ESPAÇO VERDE)
  // ════════════════════════════════════════════════════════════════════

  /** Retorna o registro EV de uma admissão, se existir. */
  function getEvDeAdmissao(admissao) {
    try {
      const r = Banco.queryUnica(`
        SELECT * FROM opme_repasse_antecipado WHERE admissao = ?
      `, [String(admissao).trim()]);
      return r || null;
    } catch (e) { console.warn(e); return null; }
  }

  /** Mapa de todos os EVs (admissao → registro). Carregado em cada render. */
  function carregarTodosEvs() {
    const porAdmissao = new Map();
    try {
      const linhas = Banco.query(`SELECT * FROM opme_repasse_antecipado`);
      for (const l of linhas) {
        if (l.admissao) porAdmissao.set(String(l.admissao).trim(), l);
      }
    } catch (e) { console.warn(e); }
    return porAdmissao;
  }

  /** Lista EVs de uma competência específica (YYYY-MM). */
  function listarEvsDaCompetencia(competencia) {
    try {
      return Banco.query(`
        SELECT * FROM opme_repasse_antecipado WHERE competencia = ?
        ORDER BY data_admissao DESC, admissao
      `, [String(competencia).trim()]) || [];
    } catch (e) { console.warn(e); return []; }
  }

  /**
   * Cria UMA cópia EV de uma admissão da Produção pro Relatório QVIS.
   * Pega os dados da linha de Produção e calcula o repasse com base no
   * `valor` produzido, aplicando regra do médico se houver ou PCT_GERAL.
   */
  async function criarEv(linhaProducao, competencia) {
    const cfg = lerConfig();
    const pct = pctParaMedico(linhaProducao.cirurgiao, cfg, linhaProducao.produto || linhaProducao.procedimento || '');
    const produzido = Number(linhaProducao.valor) || 0;
    const repasse = produzido * (pct / 100);

    // Tenta derivar o codigo_relatorio da competência (qvis_snapshot_stats)
    let codigoRel = null;
    try {
      const r = Banco.queryUnica(`
        SELECT codigo_relatorio FROM qvis_snapshot_stats
         WHERE mes_pagamento = ? AND codigo_relatorio IS NOT NULL AND codigo_relatorio <> ''
         ORDER BY (CASE WHEN origem='CONVENIO' THEN 0 ELSE 1 END) LIMIT 1
      `, [competencia]);
      codigoRel = r?.codigo_relatorio || null;
    } catch (e) {}
    if (!codigoRel) codigoRel = `EV-${competencia}`;

    const stmt = Banco.db.prepare(`
      INSERT OR REPLACE INTO opme_repasse_antecipado
        (admissao, competencia, data_admissao, paciente, procedimento, convenio,
         nome_profissional, nome_normalizado, quantidade, produzido,
         pct_aplicado, repasse_calculado, origem_codigo_relatorio, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    try {
      stmt.run([
        String(linhaProducao.cod_admissao).trim(),
        competencia,
        linhaProducao.data_admissao || null,
        linhaProducao.paciente || '',
        linhaProducao.produto || linhaProducao.procedimento_principal || '',
        linhaProducao.convenio || null,
        linhaProducao.cirurgiao || linhaProducao.medico || '',
        normalizarNomeMed(linhaProducao.cirurgiao || linhaProducao.medico || ''),
        linhaProducao.quantidade || 1,
        produzido,
        pct,
        repasse,
        codigoRel,
      ]);
    } finally { stmt.free(); }
  }

  /** Cria EV em lote a partir de uma lista de admissões da Produção. */
  async function criarEvsEmLote(linhasProducao, competencia) {
    // V899: o EV é 1 por admissão (chave única + INSERT OR REPLACE). Se o
    // lote trouxer 2+ linhas da MESMA admissão, sem esta guarda valeria a
    // ÚLTIMA — e a irmã a R$ 0 (desdobramento do material) apagaria a linha
    // com valor. Em duplicidade, fica a de MAIOR valor produzido.
    const porAdm = new Map();
    for (const lp of linhasProducao) {
      const a = String(lp.cod_admissao || '').trim();
      const atual = porAdm.get(a);
      if (!atual || (Number(lp.valor) || 0) > (Number(atual.valor) || 0)) {
        porAdm.set(a, lp);
      }
    }
    for (const lp of porAdm.values()) {
      await criarEv(lp, competencia);
    }
    await Banco.salvar();
  }

  /** Remove o EV de uma admissão (desfaz a marcação). */
  async function removerEv(admissao) {
    const stmt = Banco.db.prepare(`DELETE FROM opme_repasse_antecipado WHERE admissao = ?`);
    try { stmt.run([String(admissao).trim()]); }
    finally { stmt.free(); }
    await Banco.salvar();
  }

  /** % personalizada do OPME (termo ATIVO com pct definido) que casa o produto.
   *  Retorna o número, ou null se nenhum termo com pct casar. Empate → termo mais longo. */
  function pctDoTermo(produto, cfg) {
    const p = norm(produto || '');
    if (!p) return null;
    let achado = null, achadoLen = -1;
    for (const t of (cfg.termos || [])) {
      if (!t.ativo) continue;
      if (t.pct === null || t.pct === undefined || t.pct === '') continue;
      const tn = norm(t.termo);
      if (!tn || !termoCasaProduto(tn, p)) continue;   // V874: curto = palavra inteira
      if (tn.length > achadoLen) { achado = t; achadoLen = tn.length; }
    }
    return achado ? Number(achado.pct) : null;
  }

  /** Decide o % de repasse de uma linha → { pct, origem }. Precedência:
   *   recebido≤0 tratado fora. Aqui: médico-rule × OPME-% × geral.
   *   Empate médico×OPME resolvido pelo switch cfg.respeitarMedico
   *   (true = médico vence; false = OPME vence). */
  function decidirPct(nomeRaw, produto, cfg, papel) {
    // V663: regra específica por PRODUTO (switch nos Ajustes; nasce INATIVA).
    // É a mais específica de todas — quando ativa e o produto casa, vence tudo.
    if (cfg.regraProdutoAtiva && cfg.regrasProduto && cfg.regrasProduto.size) {
      const rp = cfg.regrasProduto.get(norm(produto || ''));
      if (rp) return { pct: Number(rp.pct) || 0, origem: 'produto' };
    }
    const nm = chaveMedicoCanonica(nomeRaw || '');
    const temMedico = !!(nm && cfg.regrasMedico && cfg.regrasMedico.has && cfg.regrasMedico.has(nm));
    const pctTermo = pctDoTermo(produto, cfg);
    const temTermo = pctTermo !== null;
    const pctMedico = temMedico ? Number(cfg.regrasMedico.get(nm).pct) : null;
    if (temMedico && temTermo) {
      return cfg.respeitarMedico
        ? { pct: pctMedico, origem: 'medico' }
        : { pct: pctTermo, origem: 'opme' };
    }
    if (temMedico) return { pct: pctMedico, origem: 'medico' };
    if (temTermo)  return { pct: pctTermo, origem: 'opme' };
    // V663/V665: regra por PAPEL (switch; nasce INATIVA) — vale quando nada
    // mais específico casou. Com PRODUTO informado no cadastro, a regra vale
    // só pra aquele produto (e vence a do papel sem produto).
    if (cfg.regraPapelAtiva && papel && cfg.regrasPapel && cfg.regrasPapel.size) {
      const pk = norm(papel);
      const espec = cfg.regrasPapel.get(`${pk}|${norm(produto || '')}`);
      if (espec != null) return { pct: Number(espec) || 0, origem: 'papel' };
      const qualquer = cfg.regrasPapel.get(`${pk}|`);
      if (qualquer != null) return { pct: Number(qualquer) || 0, origem: 'papel' };
    }
    return { pct: Number(cfg.pctGeral) || 10, origem: 'geral' };
  }

  /** Retorna pct (%) que se aplica a um médico+produto (regra/OPME/geral). */
  function pctParaMedico(nomeMedico, cfg, produto, papel) {
    return decidirPct(nomeMedico, produto || '', cfg, papel || '').pct;
  }

  /** Normaliza nome (UPPER + sem acentos) — wrapper local usando Utilidades */
  function normalizarNomeMed(nome) {
    if (typeof Utilidades !== 'undefined' && Utilidades.normalizar) {
      return Utilidades.normalizar(nome);
    }
    // Fallback se Utilidades não estiver carregado
    return String(nome || '').toUpperCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // ── DE-PARA DE NOMES — canoniza o médico (igual aos outros módulos) ──────
  // Resolve qualquer grafia para o médico canônico, em 3 níveis:
  //   1) VÍNCULO explícito  → medicos.nome_oficial OU sinonimos_medico
  //   2) SIMILARIDADE       → mesma heurística do De-Para (sugerirMedico):
  //                           palavras em comum (≥2 ou todas se ≤2) e score ≥ .5
  //   3) CRU                → nenhum match: usa o próprio nome normalizado
  // Cache montado 1x por render (invalidado no topo de _renderOpme).
  let _deParaCache = null;
  let _deParaVer = -1;
  function invalidarDePara() { _deParaCache = null; }
  function prepararDePara() {
    const ver = (typeof Banco !== 'undefined' ? (Banco._versao || 0) : 0);
    if (_deParaCache && _deParaVer === ver) return _deParaCache;
    const cadMap = new Map();   // chaveNorm -> { key, nome }
    const medicosPrep = [];     // p/ fuzzy: { set:Set(palavras), n, med:{key,nome} }
    try {
      const meds = Banco.query(`SELECT nome_oficial FROM medicos WHERE nome_oficial IS NOT NULL AND nome_oficial <> ''`);
      for (const m of meds) {
        const nome = m.nome_oficial;
        const key = normalizarNomeMed(nome);
        if (!key) continue;
        const med = { key, nome };
        cadMap.set(key, med);
        const palavras = key.split(/\s+/).filter(p => p.length > 1);
        medicosPrep.push({ set: new Set(palavras), n: palavras.length, med });
      }
    } catch (e) { /* ignore */ }
    try {
      const sins = Banco.query(`
        SELECT s.grafia, s.grafia_normalizada AS gn, m.nome_oficial AS nome
          FROM sinonimos_medico s JOIN medicos m ON m.id = s.medico_id
         WHERE m.nome_oficial IS NOT NULL AND m.nome_oficial <> ''
      `);
      for (const s of sins) {
        const med = { key: normalizarNomeMed(s.nome), nome: s.nome };
        if (s.gn) cadMap.set(s.gn, med);
        const k2 = normalizarNomeMed(s.grafia);
        if (k2) cadMap.set(k2, med);
      }
    } catch (e) { /* ignore */ }
    _deParaCache = { cadMap, medicosPrep };
    _deParaVer = (typeof Banco !== 'undefined' ? (Banco._versao || 0) : 0);
    return _deParaCache;
  }
  /** Resolve uma grafia → { key, nome, via }. via ∈ vinculo|similaridade|cru|vazio. */
  let _canonMemo = new Map(), _canonMemoVer = -1;
  function resolverMedicoCanonico(nomeRaw) {
    // V663: memoiza por grafia — o fuzzy (score sobre TODOS os médicos) rodava
    // de novo pra cada linha/render com o mesmo nome.
    const ver = (typeof Banco !== 'undefined' ? (Banco._versao || 0) : 0);
    if (_canonMemoVer !== ver) { _canonMemo = new Map(); _canonMemoVer = ver; }
    const memoK = String(nomeRaw || '').trim();
    const hit = _canonMemo.get(memoK);
    if (hit) return hit;
    const out = _resolverMedicoCanonicoCalc(memoK);
    _canonMemo.set(memoK, out);
    return out;
  }
  function _resolverMedicoCanonicoCalc(nomeRaw) {
    const raw = String(nomeRaw || '').trim();
    const n = normalizarNomeMed(raw);
    if (!n) return { key: '', nome: '', via: 'vazio' };
    const { cadMap, medicosPrep } = prepararDePara();
    if (cadMap.has(n)) { const m = cadMap.get(n); return { key: m.key, nome: m.nome, via: 'vinculo' }; }
    // SIMILARIDADE — mesma heurística do De-Para de Nomes (sugerirMedico)
    const palavras = n.split(/\s+/).filter(p => p.length > 1);
    if (palavras.length) {
      const minComuns = palavras.length <= 2 ? palavras.length : 2;
      let melhor = null, melhorScore = 0;
      for (const mp of medicosPrep) {
        if (!mp.n) continue;
        let comuns = 0;
        for (const p of palavras) if (mp.set.has(p)) comuns++;
        if (comuns < minComuns) continue;
        const maior = palavras.length > mp.n ? palavras.length : mp.n;
        const score = comuns / maior;
        if (score < 0.5) continue;
        if (score > melhorScore) { melhorScore = score; melhor = mp.med; }
      }
      if (melhor) return { key: melhor.key, nome: melhor.nome, via: 'similaridade' };
    }
    return { key: n, nome: raw, via: 'cru' };
  }
  /** Chave canônica do médico (p/ casar a regra de %). */
  function chaveMedicoCanonica(nome) { return resolverMedicoCanonico(nome).key; }

  // ── V663: CACHE DE CARGA das duas bases (a maior dor de performance) ──────
  // carregarQvis/carregarProducao faziam um SCAN COMPLETO com LIKE das tabelas
  // gigantes (centenas de milhares/1M+ linhas) a CADA render — e os cards
  // LM/LY/YTD repetiam o scan pra até 26 competências, refeito a cada tecla
  // digitada nos filtros. O SQL NÃO depende do mês (o corte por mês é JS,
  // depois), então o resultado do scan é cacheado e só invalida quando as
  // BASES realmente mudam (reimportação) — detectado por um carimbo barato
  // (COUNT + MAX(id)), não pelo Banco._versao (que bumpa em qualquer marcação).
  let _stampBases = '', _stampBasesVer = -1;
  function _carimboBases() {
    const ver = (typeof Banco !== 'undefined' ? (Banco._versao || 0) : 0);
    if (_stampBasesVer === ver) return _stampBases;
    let s;
    try {
      const q = Banco.queryUnica(`SELECT COUNT(*) AS c, COALESCE(MAX(id),0) AS m FROM linhas_qvis`);
      const p = Banco.queryUnica(`SELECT COUNT(*) AS c, COALESCE(MAX(id),0) AS m FROM linhas_producao`);
      s = `${q.c}|${q.m}|${p.c}|${p.m}`;
    } catch (e) { s = 'v' + ver; }
    _stampBases = s; _stampBasesVer = ver;
    return s;
  }
  let _qvisScanCache = null, _qvisScanKey = '';
  let _prodScanCache = null, _prodScanKey = '';
  function _scanProducao(termosBusca, livres) {
    const chave = _carimboBases() + '|' + (termosBusca || []).join('§');
    if (_prodScanCache && _prodScanKey === chave) return _prodScanCache;
    const { sql, params } = clausulaLikeOr(termosBusca || [], ['produto']);
    let linhas = Banco.query(`
      SELECT id, competencia, cod_admissao, data_admissao, paciente,
             procedimento_principal, produto, quantidade, valor,
             convenio, tipo_recebimento, classificacao_produto,
             unidade, medico, cirurgiao
        FROM linhas_producao
       WHERE classificacao_produto LIKE '%OPME%'
         AND ${sql}
       ORDER BY data_admissao DESC, cod_admissao
    `, params) || [];
    // V874: mesma trava do QVIS. Os PRODUTOS ADICIONADOS (⚙ Ajustes) vêm em
    // `livres` e ficam de fora dela — ali o usuário digita um trecho de nome
    // para procurar, e essa busca é "contém" por definição.
    linhas = linhas.filter(l => casaAlgumTermo(l.produto, termosBusca, livres));
    _prodScanCache = linhas; _prodScanKey = chave;
    return linhas;
  }

  function carregarQvis(termosAtivos, mes, ano) {
    try {
      // V663: o scan pesado roda 1× e fica em cache (chave: bases + termos)
      const chave = _carimboBases() + '|' + (termosAtivos || []).join('§');
      let linhas;
      if (_qvisScanCache && _qvisScanKey === chave) {
        linhas = _qvisScanCache;
      } else {
        const { sql, params } = clausulaLikeOr(termosAtivos, ['lq.procedimento']);
        linhas = Banco.query(`
          SELECT lq.id, lq.competencia, lq.admissao, lq.data_admissao, lq.paciente,
                 lq.procedimento, lq.quantidade, lq.produzido, lq.recebido, lq.repassado,
                 lq.convenio, lq.tipo_recebimento, lq.classificacao_produto,
                 lq.unidade_atendimento, lq.nome_profissional, lq.papel,
                 lq.origem, lq.mes_pagamento,
                 ss.codigo_relatorio AS codigo_relatorio,
                 0 AS eh_ev
            FROM linhas_qvis lq
            LEFT JOIN qvis_snapshot_stats ss
              ON ss.origem = lq.origem AND ss.mes_pagamento = lq.mes_pagamento
           WHERE lq.classificacao_produto LIKE '%OPME%'
             AND ${sql}
           ORDER BY lq.data_admissao DESC, lq.admissao, lq.papel
        `, params) || [];
        _qvisScanCache = linhas; _qvisScanKey = chave;
      }
      // V874: o LIKE do SQL é o filtro grosso; aqui cai o que só casou por
      // dentro de outra palavra (COLA em COLAGENO)
      linhas = linhas.filter(l => casaAlgumTermo(l.procedimento, termosAtivos));
      linhas = filtroQvisPorMesPagamento(linhas, mes, ano);
      const excluidos = listarProdutosExcluidos();
      if (excluidos.size > 0) linhas = linhas.filter(l => !excluidos.has(l.procedimento));

      // EVs do mês filtrado — só inclui se há filtro de mês/ano definido
      if (mes && ano) {
        const competencia = `${ano}-${mes}`;
        const evs = listarEvsDaCompetencia(competencia);
        const evsAdaptados = evs.map(ev => ({
          id: `ev-${ev.admissao}`,
          competencia: ev.competencia,
          admissao: ev.admissao,
          data_admissao: ev.data_admissao,
          paciente: ev.paciente,
          procedimento: ev.procedimento,
          quantidade: ev.quantidade,
          produzido: ev.produzido,
          recebido: ev.produzido,  // EV: trata produzido = recebido pro cálculo
          repassado: ev.repasse_calculado,
          convenio: ev.convenio || null,
          tipo_recebimento: null,
          classificacao_produto: 'OPME',
          unidade_atendimento: null,
          nome_profissional: ev.nome_profissional,
          papel: 'CIRURGIAO',
          origem: 'EV',
          mes_pagamento: ev.competencia,
          codigo_relatorio: ev.origem_codigo_relatorio,
          eh_ev: 1,
          ev_pct: ev.pct_aplicado,
        }));
        linhas = [...evsAdaptados, ...linhas];
      }
      return linhas;
    } catch (e) { console.warn(e); return []; }
  }

  /**
   * Produção: filtra pela coluna PRODUTO (não procedimento_principal),
   * com classificacao_produto OPME + termos elegíveis (ISTENT/ANEL/VALVULA).
   * Filtro de mês/ano usa a `competencia` da Produção — independente do QVIS.
   *
   * Cada base tem sua perspectiva temporal e seu campo-chave:
   *   - QVIS:     filtro em `procedimento`, mês = mes_pagamento
   *   - Produção: filtro em `produto`,      mês = competencia
   */
  function carregarProducao(termosAtivos, mes, ano) {
    try {
      // V661: além dos termos elegíveis, busca os PRODUTOS ADICIONADOS (⚙ Ajustes)
      const termosBusca = (termosAtivos || []).concat(extrasProducaoAtivos());
      // V663: o scan pesado roda 1× e fica em cache (chave: bases + termos)
      let linhas = _scanProducao(termosBusca, extrasLivres());
      linhas = filtroCompetencia(linhas, mes, ano);
      // Filtro: produtos excluídos globalmente (painel de Ajustes)
      const excluidos = listarProdutosExcluidos();
      if (excluidos.size > 0) {
        linhas = linhas.filter(l => !excluidos.has(l.produto));
      }
      // Filtro: produtos ocultos via dropdown da UI (apenas Produção)
      const ocultos = (window.__opme && window.__opme.produtosOcultos) || new Set();
      if (ocultos.size > 0) {
        linhas = linhas.filter(l => !ocultos.has(l.produto));
      }
      return linhas;
    } catch (e) { console.warn(e); return []; }
  }

  /**
   * Retorna pagamentos indexados de duas formas:
   *   - porChave: Map<"admissao|codigo_relatorio", {data, obs, codigo_relatorio, competencia}>
   *   - porAdmissao: Map<admissao, Set<codigo_relatorio>>  (pra detectar duplicidade)
   *
   * Duplicidade = mesma admissão tem pagamentos em codigo_relatorio diferentes.
   */
  function carregarPagamentos() {
    const porChave = new Map();
    const porAdmissao = new Map();
    try {
      const linhas = Banco.query(`
        SELECT admissao, codigo_relatorio, competencia, data_admissao,
               data_pagamento, observacao
          FROM opme_pagamentos
      `);
      for (const l of linhas) {
        const adm = String(l.admissao || '').trim();
        const codRel = String(l.codigo_relatorio || '').trim();
        if (!adm || !codRel) continue;
        const chave = `${adm}|${codRel}`;
        porChave.set(chave, {
          data: l.data_pagamento,
          obs:  l.observacao || '',
          codigo_relatorio: codRel,
          competencia: l.competencia || '',
          data_admissao: l.data_admissao || '',
        });
        if (!porAdmissao.has(adm)) porAdmissao.set(adm, new Set());
        porAdmissao.get(adm).add(codRel);
      }
    } catch (e) { console.warn(e); }
    return { porChave, porAdmissao };
  }

  /** Lista médicos (profissionais) distintos que aparecem em OPME no QVIS. */
  function listarMedicosOpme(termosAtivos) {
    try {
      const { sql, params } = clausulaLikeOr(termosAtivos, ['procedimento']);
      // V874: o `procedimento` entra no SELECT só para a trava de palavra
      // inteira poder conferir cada linha (o de-para abaixo já deduplica)
      const linhas = (Banco.query(`
        SELECT DISTINCT nome_profissional, nome_normalizado, procedimento
          FROM linhas_qvis
         WHERE classificacao_produto LIKE '%OPME%'
           AND nome_profissional IS NOT NULL AND nome_profissional <> ''
           AND ${sql}
         ORDER BY nome_profissional
      `, params) || []).filter(l => casaAlgumTermo(l.procedimento, termosAtivos));
      // Canoniza pelo de-para (nome oficial) e deduplica
      const vistos = new Set();
      const out = [];
      for (const l of linhas) {
        const r = resolverMedicoCanonico(l.nome_profissional);
        const nome = r.nome || l.nome_profissional;
        const key = r.key || normalizarNomeMed(nome);
        if (!key || vistos.has(key)) continue;
        vistos.add(key);
        out.push({ nome_profissional: nome, nome_normalizado: key });
      }
      out.sort((a, b) => a.nome_profissional.localeCompare(b.nome_profissional, 'pt-BR'));
      return out;
    } catch (e) { return []; }
  }

  /**
   * Aplica a regra de % apropriada (específica do médico OU geral) e retorna
   * o repasse. Se `recebido` é zero, o repasse é forçado a zero — não
   * aplicamos % sobre material que o convênio ainda não pagou.
   */
  function calcularRepasse(valor, recebido, nomeProfissional, cfg, produto, papel) {
    const v = Number(valor) || 0;
    const rec = Number(recebido);
    // Se recebido foi informado e é zero → não tem repasse (ATLAS não recebeu)
    if (!isNaN(rec) && rec <= 0) {
      return { repasse: 0, pct: 0, pctOrigem: 'zerado', recebidoZero: true };
    }
    if (v <= 0) return { repasse: 0, pct: 0, pctOrigem: null, recebidoZero: false };
    const d = decidirPct(nomeProfissional, produto || '', cfg, papel || '');
    return { repasse: v * d.pct / 100, pct: d.pct, pctOrigem: d.origem, recebidoZero: false };
  }

  /**
   * Marca a admissão como paga no relatório identificado por codigo_relatorio.
   * A data de pagamento é SEMPRE a data corrente do sistema (não pede do
   * usuário). Guarda também competencia e data_admissao para auditoria.
   */
  async function marcarPago(admissao, codigoRelatorio, competencia, dataAdmissao, obs = '') {
    if (!admissao || !codigoRelatorio) return;
    const stmt = Banco.db.prepare(`
      INSERT INTO opme_pagamentos
        (admissao, codigo_relatorio, competencia, data_admissao, data_pagamento, observacao, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(admissao, codigo_relatorio) DO UPDATE SET
        data_pagamento = excluded.data_pagamento,
        observacao = excluded.observacao
    `);
    try {
      stmt.run([
        String(admissao).trim(),
        String(codigoRelatorio).trim(),
        competencia || null,
        dataAdmissao || null,
        hojeISO(),     // ← data atual automática
        obs,
      ]);
    } finally { stmt.free(); }
    await Banco.salvar();
  }
  async function desmarcarPago(admissao, codigoRelatorio) {
    const stmt = Banco.db.prepare(`
      DELETE FROM opme_pagamentos WHERE admissao = ? AND codigo_relatorio = ?
    `);
    try {
      stmt.run([String(admissao).trim(), String(codigoRelatorio).trim()]);
    } finally { stmt.free(); }
    await Banco.salvar();
  }

  // ──────────────────────────────────────────────────────────────────────
  // BUSCA / FILTRO
  // ──────────────────────────────────────────────────────────────────────

  // V720: campoFiltro/montarComboFiltro sairam — filtros na fileira 20C (renderBarraFiltros20C)

  /** Valores distintos (trim, sem vazios, dedup acento/caixa-insensível), ordenados. */
  function distinctOrd(arr) {
    const seen = new Set(); const out = [];
    for (const x of arr) {
      const v = String(x == null ? '' : x).trim();
      if (!v) continue;
      const k = norm(v);
      if (seen.has(k)) continue;
      seen.add(k); out.push(v);
    }
    out.sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return out;
  }

  function filtrarPorCampos(linhas, st, ladoEsq) {
    // V922: filtros MULTI — cada campo aceita N itens marcados (UNIÃO)
    const FM = Utilidades.filtroMulti;
    const fas = FM.sel(st.filtroAdmissao).map(norm);
    const fms = FM.sel(st.filtroMedico).map(norm);
    const fcs = FM.sel(st.filtroConvenio).map(norm);
    const fps = FM.sel(st.filtroPaciente).map(norm);
    if (!fas.length && !fms.length && !fcs.length && !fps.length) return linhas;
    return linhas.filter(l => {
      const adm  = ladoEsq ? l.admissao : l.cod_admissao;
      const med  = ladoEsq ? l.nome_profissional : (l.cirurgiao || l.medico);
      const conv = l.convenio;
      const pac  = l.paciente;
      if (fas.length && !(adm && fas.some(fa => norm(adm).includes(fa)))) return false;
      if (fms.length) {   // V662: casa pela grafia crua OU pelo nome canônico do de-para
        const cru = med ? norm(med) : '';
        const canon = med ? norm((resolverMedicoCanonico(med) || {}).nome || '') : '';
        if (!fms.some(fm => cru.includes(fm) || (canon && canon.includes(fm)))) return false;
      }
      if (fcs.length && !(conv && fcs.some(fc => norm(conv).includes(fc)))) return false;
      if (fps.length && !(pac && fps.some(fp => norm(pac).includes(fp)))) return false;
      return true;
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────

  // V492: cache dos totais YTD/LM/LY em escopo de MÓDULO — antes vivia no
  // escopo da função da tela e morria a cada re-entrada/re-render. Map chaveado
  // pela assinatura completa (filtros + produtosOcultos + Banco._versao):
  // qualquer gravação no banco muda Banco._versao e invalida automaticamente.
  const _totaisCacheOpme = new Map();
  const _TOTAIS_CACHE_MAX = 30; // V492: cap pra não crescer sem limite

  // ──────────────────────────────────────────────────────────────────────
  // V132.46: RESULTADO PRO MÓDULO RELATÓRIOS — só linhas FLAGADAS COMO PAGO
  // (admissao+codigo_relatorio presente em opme_pagamentos). Reproduz a mesma
  // lógica de cálculo da matriz (EV, substituição, duplicidade) por fidelidade.
  // ──────────────────────────────────────────────────────────────────────
  function resultadoPagosRelatorio(competencia) {
    const ano = competencia ? String(competencia).slice(0, 4) : '';
    const mes = competencia ? String(competencia).slice(5, 7) : '';
    const cfg = lerConfig();
    let linhas = [];
    try { linhas = carregarQvis(listarTermosAtivos(), mes, ano) || []; }
    catch (e) { console.error('[OPME] resultadoPagosRelatorio carregarQvis:', e); return []; }
    const { porChave, porAdmissao } = carregarPagamentos();
    const subsPorChave = carregarTodasSubstituicoes();
    const evsPorAdmissao = carregarTodosEvs();

    const out = [];
    for (const l of linhas) {
      const adm = String(l.admissao || '').trim();
      const ehEv = !!l.eh_ev;
      const codRelOficial = String(l.codigo_relatorio || '').trim();
      const fallbackRel = (!codRelOficial && l.origem && l.mes_pagamento)
        ? `${(l.origem === 'PARTICULAR') ? 'PART' : (l.origem === 'EV' ? 'EV' : 'CONV')}-${l.mes_pagamento}`
        : '';
      const codRel = codRelOficial || fallbackRel;
      const chave = `${adm}|${codRel}`;
      const pago = codRel ? porChave.get(chave) : null;
      if (!pago) continue;                       // ← SÓ O QUE FOR FLAGADO COMO PAGO

      const papel = String(l.papel || '').trim();
      const subs = subsPorChave.get(chaveSubs(adm, codRel, papel));
      const nomeEfetivo = subs ? subs.nome_substituto : (l.nome_profissional || '');
      const evDessaAdm = evsPorAdmissao.get(adm);
      const bloqueadaPorEv = !!evDessaAdm && !ehEv && (evDessaAdm.competencia !== l.mes_pagamento);
      const todosRel = porAdmissao.get(adm) || new Set();
      const duplicidade = todosRel.size > 1;

      const ehPartCons = String(l.origem || '').toUpperCase() === 'PARTICULAR'
        || String(l.tipo_recebimento || '').toUpperCase().indexOf('PART') >= 0;
      const fix = baseComValorFixo(l.procedimento, l.produzido, l.convenio, ehPartCons, adm);   // V661
      let calc;
      if (bloqueadaPorEv) {
        const fixEv = baseComValorFixo(evDessaAdm.procedimento, evDessaAdm.produzido, evDessaAdm.convenio, false, adm);
        let rep = Number(evDessaAdm.repasse_calculado) || 0;
        if (fixEv.ajustado && fixEv.original > 0) rep *= fixEv.base / fixEv.original;
        calc = { repasse: rep };
      }
      else if (duplicidade) calc = { repasse: 0 };
      else if (ehEv && !subs) {
        let rep = Number(l.repassado) || 0;
        if (fix.ajustado && fix.original > 0) rep *= fix.base / fix.original;
        calc = { repasse: rep };
      }
      else if (ehEv && subs) calc = { repasse: fix.base * (pctParaMedico(nomeEfetivo, cfg, l.procedimento || '', papel) / 100) };
      else calc = calcularRepasse(fix.base, l.recebido, nomeEfetivo, cfg, l.procedimento || '', papel);

      const valor = Number(calc.repasse) || 0;
      if (valor <= 0) continue;                  // só linhas com valor

      const ehPart = String(l.origem || '').toUpperCase() === 'PARTICULAR'
        || String(l.tipo_recebimento || '').toUpperCase().indexOf('PART') >= 0;
      const origem = ehPart ? 'PARTICULAR' : 'CONVÊNIO';
      const convenio = ehPart ? 'PARTICULAR' : (l.convenio || '');
      out.push({
        status: 'Desempenho', modulo: 'OPME', admissao: adm, data_admissao: l.data_admissao || '',
        /**
         * V875: a linha ia para o Consolidado SEM descrição. No Consolidado
         * ela saía como "— —": o material era pago,
         * mas ninguém conseguia dizer QUAL material. Pior: o mesmo OPME
         * continuava listado em "Não pago nesta admissão", zerado, porque a
         * comparação é pelo NOME do procedimento e não havia nome nenhum.
         */
        descricao: l.procedimento || '',
        papel: papel || 'CIRURGIAO', profissional: nomeEfetivo,
        origem, convenio, competencia: l.competencia || competencia, valor,
        produzido: ehPart ? (Number(l.produzido) || 0) : 0, _fichProd: ehPart,   // V251: OPME part. = % do produzido
      });
    }
    return out;
  }

  if (typeof window !== 'undefined') {
    window.AtlasOPME = window.AtlasOPME || {};
    window.AtlasOPME.resultadoPagosRelatorio = resultadoPagosRelatorio;
    // V874: as duas varreduras e a régua de termo entram no _interno para o
    // teste de regressão conferir o casamento sem depender da tela montada
    window.AtlasOPME._interno = {
      termoCasaProduto, casaAlgumTermo, listarTermosAtivos, pctDoTermo,
      carregarQvis, carregarProducao, lerConfig,
      // V875: a base com o valor fixo de subfaturamento (regra DESTE módulo)
      baseComValorFixo,
    };
  }

  return function () {
    if (window.__opme === undefined) {
      window.__opme = {
        filtroAdmissao: '',
        filtroMedico: '',
        filtroConvenio: '',
        filtroPaciente: '',
        ocultarPagas: false,
        ajustesAberto: false,
        testeAberto: false,
        infoAberto: false,
        vfEditandoTermo: null,      // { id, indice } do chip de termo em edição
        vfAdicionandoTermo: null,   // id do valor fixo com input de "novo termo" ativo
        mes: null,
        ano: null,
        produtosOcultos: new Set(),
        dropdownAberto: null,
        qvisFolderAberto: false,    // pasta única (esquerda) que agrupa os macros do QVIS
        // Proporção do painel esquerdo (20–80%). null = 50/50 default.
        larguraEsqPercent: (() => {
          try {
            const v = parseFloat(localStorage.getItem('opme.larguraEsqPercent'));
            return (Number.isFinite(v) && v >= 20 && v <= 80) ? v : null;
          } catch (e) { return null; }
        })(),
      };
    }
    if (!(window.__opme.produtosOcultos instanceof Set)) {
      window.__opme.produtosOcultos = new Set(window.__opme.produtosOcultos || []);
    }

    let _opmeMontou = false;
    // V493: Map<admissão, tr[]> do hover-sync — construído UMA vez por render
    // (lazy, no 1º mouseover) em vez de 2 querySelectorAll por evento de mouse.
    // Invalidado (null) sempre que as linhas das tabelas são reconstruídas.
    let _hoverRowsOpme = null;
    // Wrapper: a 1ª render (montagem) já é coberta pela tela de loading do
    // navegarPara; os filtros/re-renders mostram o loading durante a travada.
    function renderizar() {
      if (!_opmeMontou) { _opmeMontou = true; return _renderOpme(); }
      return Utilidades.comLoading(_renderOpme, 'Carregando…', { semFundo: true });
    }

    renderizar();

    function _renderOpme() {
      const state = window.__opme;
      garantirEstilosOpme();
      const cfg = lerConfig();
      const termosAtivos = cfg.termos.filter(t => t.ativo).map(t => t.termo);

      // V493: carga + filtragem extraídas pra _prepararDadosOpme — MESMA lógica
      // compartilhada com renderParcialFiltros (caminho incremental), sem duplicação.
      const { qvis, prod, pagamentos, qvisFiltrado, prodFiltrado, pagasEsq, pagasDir,
              evsPorAdmissao, subsPorChave } = _prepararDadosOpme(state, termosAtivos);
      _hoverRowsOpme = null; // V493: DOM será refeito → invalida o mapa do hover-sync

      // Totais dos cards (Produzido/Repasse/Quantidade + LM/LY/YTD)
      const totais = calcularTotaisOpme(cfg, state);

      // Opções dos comboboxes de filtro (valores distintos do que está carregado)
      _montarOpcoesFiltro(state, qvis, prod);

      document.getElementById('conteudo').innerHTML = `
        <div class="page-content">
          ${renderHeader(state, termosAtivos)}
          ${renderCardsOpme(totais)}
          ${renderPainelAjustes(cfg, termosAtivos)}
          ${renderPainelTeste()}

          <div class="opme-grid" id="opme-grid">
            ${renderPainel({
              lado: 'esq',
              titulo: 'Relatório QVIS',
              icone: '📋',
              total: qvis.length,
              visiveis: qvisFiltrado.length,
              pagas: pagasEsq.size,
              tabela: renderTabelaQvis(qvisFiltrado, pagamentos, cfg, evsPorAdmissao, subsPorChave),
              temFiltro: _temFiltroEsq(state), // V493: expressão extraída (compartilhada c/ renderParcialFiltros)
              cfgTermos: cfg.termos,
            })}

            <div class="opme-resize-divisor" id="opme-resize-grip"
                 title="Arraste para ajustar a largura dos painéis (clique-duplo para resetar 50/50)">
              <div class="opme-divisor-grip">
                <span class="opme-divisor-dots">⋮</span>
              </div>
            </div>

            ${renderPainel({
              lado: 'dir',
              titulo: 'Produção QVIS',
              icone: '📊',
              total: prod.length,
              visiveis: prodFiltrado.length,
              pagas: pagasDir.size,
              tabela: renderTabelaProd(prodFiltrado, pagamentos, cfg, evsPorAdmissao),
              temFiltro: _temFiltroDir(state), // V493: expressão extraída (compartilhada c/ renderParcialFiltros)
              produtosProducao: listarProdutosProducao(termosAtivos, state.mes, state.ano),
            })}
          </div>
        </div>
        ${state.larguraEsqPercent ? `<style>
          .opme-painel[data-lado="esq"] { flex: 0 0 calc(${state.larguraEsqPercent}% - 8px) !important; }
          .opme-painel[data-lado="dir"] { flex: 1 1 0 !important; }
        </style>` : ''}
      `;

      bindEventos(cfg, termosAtivos);
    }

    // ── V493: DADOS COMPARTILHADOS render completo × incremental ─────────
    // Carga + filtragem + sets de pagas — era inline no _renderOpme; extraído
    // pra ser usado TAMBÉM pelo renderParcialFiltros sem duplicar lógica.
    function _prepararDadosOpme(state, termosAtivos) {
      const qvis = carregarQvis(termosAtivos, state.mes, state.ano);
      const prod = carregarProducao(termosAtivos, state.mes, state.ano);
      const pagamentos = carregarPagamentos();
      const { porChave, porAdmissao } = pagamentos;

      const qvisFiltrado = filtrarPorCampos(qvis, state, true)
        .filter(l => {
          if (!state.ocultarPagas) return true;
          const codRel = String(l.codigo_relatorio || '').trim();
          if (!codRel) return true;
          const chave = `${String(l.admissao || '').trim()}|${codRel}`;
          return !porChave.has(chave);
        });
      const prodFiltrado = filtrarPorCampos(prod, state, false)
        .filter(l => {
          if (!state.ocultarPagas) return true;
          const adm = String(l.cod_admissao || '').trim();
          return !porAdmissao.has(adm);
        });

      const pagasEsq = new Set();
      for (const l of qvis) {
        const codRel = String(l.codigo_relatorio || '').trim();
        if (!codRel) continue;
        const chave = `${String(l.admissao || '').trim()}|${codRel}`;
        if (porChave.has(chave)) pagasEsq.add(chave);
      }
      const pagasDir = new Set();
      for (const l of prod) {
        const adm = String(l.cod_admissao || '').trim();
        if (adm && porAdmissao.has(adm)) pagasDir.add(adm);
      }

      // EVs por admissão (todas as competências) — usado pra detectar
      // bloqueio "já pago antecipadamente" em outros meses
      const evsPorAdmissao = carregarTodosEvs();
      // Substituições de médico (admissao + cod_rel + papel → novo nome)
      const subsPorChave = carregarTodasSubstituicoes();

      return { qvis, prod, pagamentos, qvisFiltrado, prodFiltrado,
               pagasEsq, pagasDir, evsPorAdmissao, subsPorChave };
    }

    // V493: flags "filtro ativo" dos painéis (antes inline no _renderOpme)
    function _temFiltroEsq(state) {
      const FM = Utilidades.filtroMulti;   // V922
      return !!(FM.ativo(state.filtroAdmissao) || FM.ativo(state.filtroMedico)
                || FM.ativo(state.filtroConvenio) || FM.ativo(state.filtroPaciente)
                || state.ocultarPagas);
    }
    function _temFiltroDir(state) {
      return _temFiltroEsq(state) || state.produtosOcultos.size > 0;
    }

    // ── V493: RENDER INCREMENTAL ─────────────────────────────────────────
    // Atualiza SÓ as regiões que mudam com filtro de texto / checkbox de pago:
    // corpo das duas tabelas, cards de totais, contadores e badges "pagas" —
    // usando as MESMAS funções de template do render completo. Não recria
    // header/inputs (o foco do filtro fica intacto) nem re-executa bindEventos
    // (os listeners das linhas são DELEGADOS no #opme-grid e sobrevivem).
    // opts.preservarScroll: mantém o scrollTop das tabelas (caminho do checkbox).
    function renderParcialFiltros(opts) {
      const state = window.__opme;
      const scrollEsq = document.getElementById('opme-tabela-scroll-esq');
      const scrollDir = document.getElementById('opme-tabela-scroll-dir');
      const cardsEl = document.getElementById('opme-cards');
      // Regiões não montadas (markup antigo/tela recém-criada) → render completo
      if (!scrollEsq || !scrollDir || !cardsEl) { renderizar(); return; }

      const cfg = lerConfig();
      const termosAtivos = cfg.termos.filter(t => t.ativo).map(t => t.termo);
      const d = _prepararDadosOpme(state, termosAtivos);
      _montarOpcoesFiltro(state, d.qvis, d.prod);   // V724: listas da barra 20C acompanham o período

      const topoEsq = scrollEsq.scrollTop;
      const topoDir = scrollDir.scrollTop;
      scrollEsq.innerHTML = renderTabelaQvis(d.qvisFiltrado, d.pagamentos, cfg, d.evsPorAdmissao, d.subsPorChave);
      scrollDir.innerHTML = renderTabelaProd(d.prodFiltrado, d.pagamentos, cfg, d.evsPorAdmissao);
      if (opts && opts.preservarScroll) {
        scrollEsq.scrollTop = topoEsq;
        scrollDir.scrollTop = topoDir;
      }
      _hoverRowsOpme = null; // linhas trocaram → invalida o mapa do hover-sync

      // Cards de totais (cache V492 já invalida sozinho via Banco._versao)
      const htmlCards = renderCardsOpme(calcularTotaisOpme(cfg, state));
      if (htmlCards) cardsEl.outerHTML = htmlCards;

      // Contadores "X de Y" + tags oculta/filtro + badges "N pagas"
      const metaEsq = document.getElementById('opme-painel-meta-esq');
      if (metaEsq) metaEsq.outerHTML = renderPainelMeta('esq', d.qvis.length, d.qvisFiltrado.length, _temFiltroEsq(state));
      const metaDir = document.getElementById('opme-painel-meta-dir');
      if (metaDir) metaDir.outerHTML = renderPainelMeta('dir', d.prod.length, d.prodFiltrado.length, _temFiltroDir(state));
      const badgeEsq = document.getElementById('opme-badge-pago-esq');
      if (badgeEsq) badgeEsq.outerHTML = renderBadgePago('esq', d.pagasEsq.size);
      const badgeDir = document.getElementById('opme-badge-pago-dir');
      if (badgeDir) badgeDir.outerHTML = renderBadgePago('dir', d.pagasDir.size);
    }

    // ── HEADER ───────────────────────────────────────────────────────────
    // ── TOTAIS (cards) ─────────────────────────────────────────────────────
    // Produzido Total (Produção, TUDO) · Repasse Total (QVIS, só PAGOS) ·
    // Quantidade (admissões DISTINTAS: pagas / produzidas). Comparativos:
    // LM (mês anterior), LY (mesmo mês, ano-1) e YTD (acumulado jan→mês vs o
    // mesmo acumulado do ano anterior, em %). Respeita os 4 filtros de texto.
    // Usa analisarLinhaQvis pra o repasse bater com as linhas exibidas.
    // V492: cache movido pro Map de escopo de módulo (_totaisCacheOpme) — o
    // antigo `var _totaisCache` local guardava UMA entrada e morria a cada
    // re-entrada na tela; digitar num filtro evictava tudo e forçava re-scan
    // de até ~14 meses de SQL + fuzzy matching.
    function calcularTotaisOpme(cfg, st) {
      const _ver = (typeof Banco !== 'undefined' ? (Banco._versao || 0) : 0);
      // V492: produtosOcultos entra na assinatura — carregarProducao filtra por
      // eles, então ocultar produto muda os totais (bug: cards não atualizavam).
      const _oc = st.produtosOcultos && st.produtosOcultos.size
        ? Array.from(st.produtosOcultos).sort().join(',') : '';
      const _FMsig = (f) => Utilidades.filtroMulti.sel(f).join('§');   // V922
      const _sig = [st.mes || '', st.ano || '', _FMsig(st.filtroAdmissao), _FMsig(st.filtroMedico),
                    _FMsig(st.filtroConvenio), _FMsig(st.filtroPaciente), _oc, _ver].join('|');
      if (_totaisCacheOpme.has(_sig)) return _totaisCacheOpme.get(_sig);
      const _val = _calcTotaisOpme(cfg, st);
      if (_totaisCacheOpme.size >= _TOTAIS_CACHE_MAX) {
        _totaisCacheOpme.delete(_totaisCacheOpme.keys().next().value); // V492: descarta o mais antigo
      }
      _totaisCacheOpme.set(_sig, _val);
      return _val;
    }
    function _calcTotaisOpme(cfg, st) {
      const termos = cfg.termos.filter(t => t.ativo).map(t => t.termo);
      const ctx = {
        pagamentos: carregarPagamentos(),
        cfg,
        evsPorAdmissao: carregarTodosEvs(),
        subsPorChave: carregarTodasSubstituicoes(),
      };
      function somar(qvis, prod) {
        qvis = filtrarPorCampos(qvis || [], st, true);
        prod = filtrarPorCampos(prod || [], st, false);
        let repasse = 0; const admRep = new Set();
        let glosaValor = 0; const admGlosa = new Set(); const procGlosaVisto = new Set();
        for (const l of qvis) {
          const a = analisarLinhaQvis(l, ctx);
          if (a.ehPago) { repasse += (a.calc.repasse || 0); if (a.adm) admRep.add(a.adm); }
          // GLOSA: recebido <= 0 (null→0), exceto EV e Particular; 1× por admissão+procedimento
          const ehPart = String(l.origem || '').toUpperCase() === 'PARTICULAR'
            || String(l.tipo_recebimento || '').toUpperCase().indexOf('PART') >= 0;
          if (!l.eh_ev && !ehPart && (Number(l.recebido) || 0) <= 0) {
            const admG = String(l.admissao || '').trim();
            if (admG) admGlosa.add(admG);
            const keyG = `${admG}|${String(l.procedimento || '').trim()}`;
            if (!procGlosaVisto.has(keyG)) { procGlosaVisto.add(keyG); glosaValor += Number(l.produzido) || 0; }
          }
        }
        let produzido = 0; const admProd = new Set();
        for (const l of prod) {
          produzido += (Number(l.valor) || 0);
          const ap = String(l.cod_admissao || '').trim();
          if (ap) admProd.add(ap);
        }
        return { repasse, produzido, admRep, admProd, glosaValor, admGlosa };
      }
      const cache = new Map();
      function mes(m, a) {
        const mm = String(m).padStart(2, '0');
        const aa = String(a);
        const key = `${aa}-${mm}`;
        if (cache.has(key)) return cache.get(key);
        let q = [], p = [];
        try { q = carregarQvis(termos, mm, aa) || []; } catch (e) {}
        try { p = carregarProducao(termos, mm, aa) || []; } catch (e) {}
        const r = somar(q, p);
        cache.set(key, r);
        return r;
      }
      const pack = s => ({ repasse: s.repasse, produzido: s.produzido, qtdRep: s.admRep.size, qtdProd: s.admProd.size, glosaValor: s.glosaValor, glosaQtd: s.admGlosa.size });
      function acumular(ate, ano) {
        let repasse = 0, produzido = 0, glosaValor = 0;
        const admRep = new Set(), admProd = new Set(), admGlosa = new Set();
        for (let i = 1; i <= ate; i++) {
          const s = mes(i, ano);
          repasse += s.repasse; produzido += s.produzido; glosaValor += s.glosaValor;
          s.admRep.forEach(x => admRep.add(x));
          s.admProd.forEach(x => admProd.add(x));
          s.admGlosa.forEach(x => admGlosa.add(x));
        }
        return { repasse, produzido, qtdRep: admRep.size, qtdProd: admProd.size, glosaValor, glosaQtd: admGlosa.size };
      }

      const mesSel = st.mes ? parseInt(st.mes, 10) : null;
      const anoSel = st.ano ? parseInt(st.ano, 10) : null;

      let atual;
      if (mesSel && anoSel) {
        atual = pack(mes(mesSel, anoSel));
      } else {
        let q = [], p = [];
        try { q = carregarQvis(termos, st.mes || '', st.ano || '') || []; } catch (e) {}
        try { p = carregarProducao(termos, st.mes || '', st.ano || '') || []; } catch (e) {}
        atual = pack(somar(q, p));
      }

      // Comparativos só com mês+ano específicos.
      if (!mesSel || !anoSel) return { atual, lm: null, ly: null, ytdA: null, ytdL: null };

      const lmMes = mesSel === 1 ? 12 : mesSel - 1;
      const lmAno = mesSel === 1 ? anoSel - 1 : anoSel;
      return {
        atual,
        lm: pack(mes(lmMes, lmAno)),
        ly: pack(mes(mesSel, anoSel - 1)),
        ytdA: acumular(mesSel, anoSel),
        ytdL: acumular(mesSel, anoSel - 1),
      };
    }

    function renderCardsOpme(totais) {
      if (!totais) return '';
      const t = totais;
      const badge = (atual, comp) => {
        if (comp === null || comp === undefined) return `<span class="opme-card-comp-vazio">—</span>`;
        if (!comp) {
          if ((atual || 0) > 0) return `<span class="opme-card-comp-badge opme-card-comp-up">↑ novo</span>`;
          return `<span class="opme-card-comp-igual">↔ 0,0%</span>`;
        }
        const pct = ((atual - comp) / comp) * 100;
        if (Math.abs(pct) < 0.05) return `<span class="opme-card-comp-igual">↔ 0,0%</span>`;
        const up = pct > 0;
        return `<span class="opme-card-comp-badge ${up ? 'opme-card-comp-up' : 'opme-card-comp-down'}">${up ? '↑' : '↓'} ${fmt(Math.abs(pct), 1)}%</span>`;
      };
      const linha = (lbl, a, c) => `<div class="opme-card-comp-linha"><span class="opme-card-comp-lbl">${lbl}</span>${badge(a, c)}</div>`;
      const comps = (metric) => {
        if (!t.lm) return linha('vs LM', null, null) + linha('vs LY', null, null) + linha('YTD', null, null);
        return linha('vs LM', t.atual[metric], t.lm[metric])
             + linha('vs LY', t.atual[metric], t.ly[metric])
             + linha('YTD',   t.ytdA[metric], t.ytdL[metric]);
      };
      return `
        <div class="opme-cards" id="opme-cards">
          <div class="opme-card opme-card-prod">
            <div class="opme-card-titulo">Produzido Total</div>
            <div class="opme-card-valor mono">R$ ${fmt(t.atual.produzido, 2)}</div>
            <div class="opme-card-comp">${comps('produzido')}</div>
          </div>
          <div class="opme-card opme-card-repasse">
            <div class="opme-card-titulo">Repasse Total</div>
            <div class="opme-card-valor mono">R$ ${fmt(t.atual.repasse, 2)}</div>
            <div class="opme-card-comp">${comps('repasse')}</div>
          </div>
          <div class="opme-card opme-card-qtd">
            <div class="opme-card-titulo">Quantidade</div>
            <div class="opme-card-qtd-dupla">
              <div class="opme-card-qtd-bloco">
                <div class="opme-card-qtd-rotulo">Repassada</div>
                <div class="opme-card-valor-mini mono">${fmt(t.atual.qtdRep, 0)}</div>
                <div class="opme-card-comp">${comps('qtdRep')}</div>
              </div>
              <div class="opme-card-qtd-sep"></div>
              <div class="opme-card-qtd-bloco">
                <div class="opme-card-qtd-rotulo">Produzida</div>
                <div class="opme-card-valor-mini mono">${fmt(t.atual.qtdProd, 0)}</div>
                <div class="opme-card-comp">${comps('qtdProd')}</div>
              </div>
            </div>
          </div>
          <div class="opme-card opme-card-glosas">
            <div class="opme-card-titulo">Glosas</div>
            <div class="opme-card-qtd-dupla">
              <div class="opme-card-qtd-bloco">
                <div class="opme-card-qtd-rotulo">Valor</div>
                <div class="opme-card-valor-mini mono" title="Produção das linhas com recebido = 0">R$ ${fmt(t.atual.glosaValor, 2)}</div>
                <div class="opme-card-comp">${comps('glosaValor')}</div>
              </div>
              <div class="opme-card-qtd-sep"></div>
              <div class="opme-card-qtd-bloco">
                <div class="opme-card-qtd-rotulo">Admissões</div>
                <div class="opme-card-valor-mini mono">${fmt(t.atual.glosaQtd, 0)}</div>
                <div class="opme-card-comp">${comps('glosaQtd')}</div>
              </div>
            </div>
          </div>
        </div>`;
    }

    // ── V720: fileira de filtros 20C (handoff Claude Design) ─────────────
    // UMA peça branca com as 6 células (Mês · Ano · Admissão · Médico ·
    // Convênio · Paciente) separadas por hairline; célula com filtro ativo
    // ganha fundo azul-claro + tile tintado + valor 700. Médico/Convênio/
    // Paciente usam o painel de busca por digitação do padrão 12C da VG
    // (busca sem acento/caixa, iniciais no médico, contagem no rodapé).
    // (funções declaradas — hoisted: o 1º render roda antes das consts do topo)
    function _sb20Ic(nome) {
      return {
        calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
        clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        alignleft: '<line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/>',
        userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
        card: '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
        user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
        check: '<polyline points="20 6 9 17 4 12"/>',
        chev: '<polyline points="6 9 12 15 18 9"/>',
      }[nome] || '';
    }
    function _sb20Svg(d, px, sw) {
      return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    }
    function _sb20SemAcento(s) {
      return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }
    function _sb20Iniciais(nome) {
      const p = String(nome || '').split(/\s+/).filter(w => w.length >= 3);
      return ((p[0] || ' ')[0] + ((p[1] || ' ')[0] || '')).toUpperCase().trim() || '–';
    }

    function renderBarraFiltros20C(state) {
      const aberto = state.sbAberto;
      const cel = (id, rotulo, valor, icone, flex, vazio = 'Todos') => {
        const ativo = !!valor;
        const estaAberta = aberto === id;
        return `
          <div class="opme-sb-celwrap" style="flex:${flex}">
            <button type="button" class="opme-sb-cel ${ativo ? 'ativo' : ''} ${estaAberta ? 'aberta' : ''}"
                    data-sb-cel="${id}" data-sb-vazio="${vazio}" role="combobox" aria-expanded="${estaAberta ? 'true' : 'false'}" aria-haspopup="listbox">
              <span class="opme-sb-tile">${_sb20Svg(_sb20Ic(icone), 14, 2.1)}</span>
              <span class="opme-sb-tx">
                <span class="opme-sb-rot">${rotulo}</span>
                <span class="opme-sb-val">${escapeHTML(valor || vazio)}</span>
              </span>
              <span class="opme-sb-chev">${_sb20Svg(_sb20Ic('chev'), 10, 2.8)}</span>
            </button>
            ${estaAberta ? painel20C(id, state) : ''}
          </div>`;
      };
      const mesLabel = state.mes ? (MESES_EXTENSO[parseInt(state.mes, 10) - 1] || state.mes) : '';
      // V922: rótulo dos filtros multi ("N selecionados")
      const rotMulti = (f) => Utilidades.filtroMulti.ativo(f) ? Utilidades.filtroMulti.rotulo(f) : '';
      return `
        <div class="opme-filtros-bar opme-sb" id="opme-sb">
          ${cel('mes', 'Mês', mesLabel, 'calendar', 0.8)}
          ${cel('ano', 'Ano', state.ano || '', 'clock', 0.75)}
          ${cel('admissao', 'Admissão', rotMulti(state.filtroAdmissao), 'alignleft', 1.05, 'Todas')}
          ${cel('medico', 'Médico', rotMulti(state.filtroMedico), 'userplus', 1.35)}
          ${cel('convenio', 'Convênio', rotMulti(state.filtroConvenio), 'card', 1.3)}
          ${cel('paciente', 'Paciente', rotMulti(state.filtroPaciente), 'user', 1.3)}
        </div>`;
    }

    /** Opções dos filtros da barra 20C (valores distintos do carregado).
     *  V724: extraída do _renderOpme — o caminho incremental também chama,
     *  senão trocar mês/ano deixava as listas velhas. */
    function _montarOpcoesFiltro(state, qvis, prod) {
      state._opcoesFiltro = {
        admissao: distinctOrd([...qvis.map(l => l.admissao), ...prod.map(l => l.cod_admissao)]),
        medico:   (() => {   // V662: unifica grafias pelo de-para — um nome por médico (igual ao Relatórios)
          const vistos = new Map();
          for (const nome of [...qvis.map(l => l.nome_profissional), ...prod.map(l => l.cirurgiao || l.medico)]) {
            const raw = String(nome || '').trim();
            if (!raw) continue;
            const r = resolverMedicoCanonico(raw);
            const k = r.key || norm(raw);
            if (!vistos.has(k)) vistos.set(k, r.nome || raw);
          }
          return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        })(),
        convenio: distinctOrd([...qvis.map(l => l.convenio), ...prod.map(l => l.convenio)]),
        paciente: distinctOrd([...qvis.map(l => l.paciente), ...prod.map(l => l.paciente)]),
      };
    }

    /** V724: markup do PAINEL de uma célula — usado pelo render completo e
     *  pela abertura LOCAL (sem re-render) no clique da célula. */
    function painel20C(id, state) {
      const { meses, anos } = listarMesesEAnos();
      const opc = state._opcoesFiltro || {};
      const item = (val, rotulo, sel, chip) => `
        <div class="opme-sb-it ${sel ? 'sel' : ''} ${val === '' ? 'opme-sb-it-todos' : ''}" data-sb-item data-val="${escapeHTML(val)}" data-busca="${escapeHTML(_sb20SemAcento(rotulo))}" role="option" aria-selected="${sel ? 'true' : 'false'}">
          ${chip ? `<span class="opme-sb-chip">${escapeHTML(_sb20Iniciais(rotulo))}</span>` : ''}
          <span class="opme-sb-it-nome">${escapeHTML(rotulo)}</span>
          ${sel ? `<span class="opme-sb-ck">${_sb20Svg(_sb20Ic('check'), 14, 2.5)}</span>` : ''}
        </div>`;
      const painelLista = (cel, opcoes, valAtual, { busca = false, chips = false, todosRotulo = 'Todos' } = {}) => `
        <div class="opme-sb-painel" data-sb-painel="${cel}">
          ${busca ? `
            <div class="opme-sb-buscabox">
              <span class="opme-sb-busca-ic">${_sb20Svg(_sb20Ic('search'), 15, 2.1)}</span>
              <input type="text" class="opme-sb-busca" data-sb-busca placeholder="Digite pra buscar" autocomplete="off">
            </div>` : ''}
          <div class="opme-sb-lista" role="listbox">
            ${item('', todosRotulo, !valAtual)}
            ${opcoes.map(o => item(o, o, valAtual === o, chips)).join('')}
          </div>
          ${busca ? `<div class="opme-sb-rodape" data-sb-contagem>${opcoes.length} opç${opcoes.length === 1 ? 'ão' : 'ões'}</div>` : ''}
        </div>`;
      if (id === 'mes') return painelLista('mes', meses.map(m => MESES_EXTENSO[parseInt(m, 10) - 1] || m), state.mes ? (MESES_EXTENSO[parseInt(state.mes, 10) - 1] || state.mes) : '');
      if (id === 'ano') return painelLista('ano', anos, state.ano || '');
      // V922: combos MULTI — checkbox por item, marcados no topo, busca sempre
      const FM = Utilidades.filtroMulti;
      const painelMulti = (cel, opcoes, f, extra = {}) => {
        const sel = FM.sel(f);
        const marcadas = opcoes.filter(o => sel.includes(String(o)));
        const demais = opcoes.filter(o => !sel.includes(String(o)));
        return `
        <div class="opme-sb-painel" data-sb-painel="${cel}" data-sb-multi="1">
          <div class="opme-sb-buscabox">
            <span class="opme-sb-busca-ic">${_sb20Svg(_sb20Ic('search'), 15, 2.1)}</span>
            <input type="text" class="opme-sb-busca" data-sb-busca placeholder="Digite pra buscar" autocomplete="off">
          </div>
          <div class="opme-sb-lista" role="listbox">
            ${item('', extra.todosRotulo || 'Todos', sel.length === 0)}
            ${[...marcadas, ...demais].slice(0, 400).map(o => item(o, o, sel.includes(String(o)), extra.chips)).join('')}
          </div>
          <div class="opme-sb-rodape" data-sb-contagem>${sel.length ? `${sel.length} selecionado${sel.length === 1 ? '' : 's'} · ` : ''}${opcoes.length} opç${opcoes.length === 1 ? 'ão' : 'ões'}</div>
        </div>`;
      };
      if (id === 'medico') return painelMulti('medico', opc.medico || [], state.filtroMedico, { chips: true });
      if (id === 'convenio') return painelMulti('convenio', opc.convenio || [], state.filtroConvenio);
      if (id === 'paciente') return painelMulti('paciente', opc.paciente || [], state.filtroPaciente);
      // admissão: entrada numérica + lista (V922: lista em multi; Enter adiciona o digitado)
      const selAdm = FM.sel(state.filtroAdmissao);
      const admOpcoes = opc.admissao || [];
      const admMarcadas = admOpcoes.filter(o => selAdm.includes(String(o)));
      const admDemais = admOpcoes.filter(o => !selAdm.includes(String(o)));
      return `
        <div class="opme-sb-painel opme-sb-painel-adm" data-sb-painel="admissao" data-sb-multi="1">
          <div class="opme-sb-buscabox">
            <span class="opme-sb-busca-ic">${_sb20Svg(_sb20Ic('alignleft'), 15, 2.1)}</span>
            <input type="text" class="opme-sb-busca" data-sb-adm inputmode="numeric" placeholder="Nº da admissão + Enter" autocomplete="off">
          </div>
          <div class="opme-sb-lista" role="listbox">
            ${item('', 'Todas', selAdm.length === 0)}
            ${[...admMarcadas, ...admDemais].slice(0, 200).map(o => item(o, o, selAdm.includes(String(o)))).join('')}
          </div>
          <div class="opme-sb-rodape" data-sb-contagem>${selAdm.length ? `${selAdm.length} selecionada${selAdm.length === 1 ? '' : 's'} · ` : ''}${admOpcoes.length} admissões</div>
        </div>`;
    }

    function bindBarraFiltros20C() {
      const sb = document.getElementById('opme-sb');
      if (!sb) return;
      const state = window.__opme;

      // ── V724: tudo ORGÂNICO — abrir/fechar painel é DOM local (zero
      // re-render) e aplicar filtro usa o caminho INCREMENTAL
      // (renderParcialFiltros: só tabelas/cards/contadores, scroll preservado,
      // header intacto) — sem o overlay "Carregando…" nem o salto do rebuild.
      const fecharPainelLocal = () => {
        sb.querySelectorAll('.opme-sb-painel').forEach(p => p.remove());
        sb.querySelectorAll('.opme-sb-cel.aberta').forEach(c => { c.classList.remove('aberta'); c.setAttribute('aria-expanded', 'false'); });
        state.sbAberto = null;
      };
      // atualiza SÓ o visual das células (valor + estado ativo), no lugar
      const atualizarCels = () => {
        const FM = Utilidades.filtroMulti;   // V922
        const rot = (f) => FM.ativo(f) ? FM.rotulo(f) : '';
        const vals = {
          mes: state.mes ? (MESES_EXTENSO[parseInt(state.mes, 10) - 1] || state.mes) : '',
          ano: state.ano || '',
          admissao: rot(state.filtroAdmissao),
          medico: rot(state.filtroMedico),
          convenio: rot(state.filtroConvenio),
          paciente: rot(state.filtroPaciente),
        };
        sb.querySelectorAll('[data-sb-cel]').forEach(btn => {
          const id = btn.dataset.sbCel;
          const v = vals[id];
          btn.classList.toggle('ativo', !!v);
          btn.querySelector('.opme-sb-val').textContent = v || btn.dataset.sbVazio || 'Todos';
        });
      };
      const aplicar = (celId, val) => {
        const campoMulti = celId === 'admissao' ? 'filtroAdmissao'
          : celId === 'medico' ? 'filtroMedico'
          : celId === 'convenio' ? 'filtroConvenio'
          : celId === 'paciente' ? 'filtroPaciente' : null;
        if (celId === 'mes') {
          const idx = MESES_EXTENSO.findIndex(m => m === val);
          state.mes = (val && idx >= 0) ? String(idx + 1).padStart(2, '0') : null;
        } else if (celId === 'ano') state.ano = val || null;
        else if (campoMulti) {
          // V922: alterna o item (união) e re-abre o painel marcado
          const FM = Utilidades.filtroMulti;
          const buscaEl = sb.querySelector('[data-sb-busca]');
          state._sbBusca = buscaEl ? buscaEl.value : '';
          state[campoMulti] = val === '' ? [] : FM.toggle(state[campoMulti], val);
        }
        const manterAberto = campoMulti ? state.sbAberto : null;
        fecharPainelLocal();
        atualizarCels();
        renderParcialFiltros({ preservarScroll: true });
        if (manterAberto) {
          state.sbAberto = manterAberto;
          const btnCel = sb.querySelector(`[data-sb-cel="${manterAberto}"]`);
          if (btnCel) {
            btnCel.classList.add('aberta');
            btnCel.setAttribute('aria-expanded', 'true');
            btnCel.parentElement.insertAdjacentHTML('beforeend', painel20C(manterAberto, state));
            wireInputsPainel();
          }
        }
        // o botão "✚ Repasse antecipado" depende de mês+ano — atualiza no lugar
        const btnEv = document.getElementById('opme-btn-ev');
        if (btnEv) {
          const pode = !!(state.mes && state.ano);
          btnEv.disabled = !pode;
          btnEv.classList.toggle('is-disabled', !pode);
        }
      };
      const wireInputsPainel = () => {
        const busca = sb.querySelector('[data-sb-busca]');
        if (busca) {
          setTimeout(() => busca.focus(), 0);
          const filtrar = () => {
            const q = _sb20SemAcento(busca.value);
            const painel = busca.closest('.opme-sb-painel');
            let n = 0;
            painel.querySelectorAll('[data-sb-item]').forEach(el => {
              // V922: itens MARCADOS ficam sempre visíveis
              const mostra = el.classList.contains('opme-sb-it-todos') || el.classList.contains('sel') || !q || (el.dataset.busca || '').includes(q);
              el.style.display = mostra ? '' : 'none';
              if (mostra && !el.classList.contains('opme-sb-it-todos')) n++;
            });
            const cont = painel.querySelector('[data-sb-contagem]');
            if (cont) cont.textContent = `${n} opç${n === 1 ? 'ão' : 'ões'}`;
          };
          busca.addEventListener('input', filtrar);
          if (state._sbBusca) { busca.value = state._sbBusca; filtrar(); }   // V922
        }
        const adm = sb.querySelector('[data-sb-adm]');
        if (adm) {
          setTimeout(() => adm.focus(), 0);
          if (state._sbBusca) adm.value = state._sbBusca;   // V922
          adm.addEventListener('input', () => {
            const so = adm.value.replace(/\D+/g, '');
            if (so !== adm.value) adm.value = so;
            const painel = adm.closest('.opme-sb-painel');
            let n = 0;
            painel.querySelectorAll('[data-sb-item]').forEach(el => {
              const mostra = el.classList.contains('opme-sb-it-todos') || !so || (el.dataset.val || '').includes(so);
              el.style.display = mostra ? '' : 'none';
              if (mostra && !el.classList.contains('opme-sb-it-todos')) n++;
            });
            const cont = painel.querySelector('[data-sb-contagem]');
            if (cont) cont.textContent = `${n} admissões`;
          });
          adm.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); aplicar('admissao', adm.value.trim()); }
          });
        }
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
        btn.parentElement.insertAdjacentHTML('beforeend', painel20C(id, state));
        wireInputsPainel();
      };
      // V922: o painel pode vir aberto do template (re-render após marcar)
      if (state.sbAberto && sb.querySelector('.opme-sb-painel')) wireInputsPainel();
      sb.addEventListener('click', (e) => {
        const it = e.target.closest('[data-sb-item]');
        if (it) {
          e.stopPropagation();
          aplicar(it.closest('[data-sb-painel]').dataset.sbPainel, it.dataset.val);
          return;
        }
        const celBtn = e.target.closest('[data-sb-cel]');
        if (celBtn) { e.stopPropagation(); abrirPainelLocal(celBtn.dataset.sbCel); return; }
        e.stopPropagation();   // clique dentro do painel não fecha
      });
      // teclado: ↑↓ navegam a lista visível, Enter escolhe
      sb.addEventListener('keydown', (e) => {
        if (!state.sbAberto) return;
        const painel = sb.querySelector('.opme-sb-painel');
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
      // Esc fecha; clique fora fecha — LOCAL, sem re-render (handler único)
      if (window.__opmeSbFechar) {
        document.removeEventListener('click', window.__opmeSbFechar);
        document.removeEventListener('keydown', window.__opmeSbEsc);
      }
      const fecharFora = (e) => {
        if (App.telaAtual !== 'desempenho-opme') return;
        if (state.sbAberto && !e.target.closest('#opme-sb')) fecharPainelLocal();
      };
      const escFecha = (e) => { if (e.key === 'Escape' && state.sbAberto) fecharPainelLocal(); };
      window.__opmeSbFechar = fecharFora;
      window.__opmeSbEsc = escFecha;
      document.addEventListener('click', fecharFora);
      document.addEventListener('keydown', escFecha);
      // painel já aberto no markup (render completo com sbAberto setado)
      if (state.sbAberto) wireInputsPainel();
    }

    function renderHeader(state, termosAtivos) {
      const semTermos = termosAtivos.length === 0;
      return `
        <header class="page-header opme-header">
          <div>
            <div class="fic-titulo-wrap">
              <h2>OPME</h2>
            </div>
            ${semTermos ? `<div class="subtitle"><strong style="color: #B87A5A">⚠ Nenhum termo OPME ativo. Configure em ⚙ Ajustes.</strong></div>` : ''}
          </div>
          <div style="display: flex; gap: 8px; align-items: flex-start">
            <div class="atlas-vis-wrap">
              <button class="btn ${state.ocultarPagas ? 'btn-primary' : ''}" id="opme-btn-visualizacao" title="Modo de exibição">👁 Visualização ▾</button>
              ${state.menuVisaoAberto ? `
                <div class="atlas-vis-menu" id="opme-menu-visao">
                  <button class="atlas-vis-item ${state.ocultarPagas ? 'ativo' : ''}" id="opme-vis-ocultar-pagas">
                    <span class="atlas-vis-ico"><i class="ti ti-eye-off"></i></span>
                    <span class="atlas-vis-txt"><strong>Ocultar pagas</strong><small>Esconde admissões já pagas</small></span>
                  </button>
                </div>
              ` : ''}
            </div>
            <button class="btn" id="opme-btn-exportar">⬇ Exportar</button>
            <button class="btn ${state.testeAberto ? 'btn-primary' : ''}" id="opme-btn-teste">
              🧪 Teste
            </button>
            <button class="btn ${state.ajustesAberto ? 'btn-primary' : ''}" id="opme-btn-ajustes">
              ⚙ Ajustes
            </button>
          </div>
        </header>
        ${renderBarraFiltros20C(state)}
      `;
    }

    // ── PAINEL DE TESTE (simulador de repasse) ──────────────────────────
    // Monta uma "admissão fictícia" e roda EXATAMENTE as mesmas funções de
    // produção (casarValorFixo / baseComValorFixo / calcularRepasse), mostrando
    // passo a passo cada regra. Nada é gravado no banco.
    function renderPainelTeste() {
      const state = window.__opme;
      if (!state.testeAberto) return '';
      return `
        <div class="opme-teste-overlay" id="opme-teste-overlay"></div>
        <div class="opme-teste-modal" role="dialog" aria-modal="true">
          <div class="opme-teste-modal-head">
            <h3 class="opme-teste-modal-tit">🧪 Teste — Simular repasse OPME</h3>
            <button class="opme-teste-close-modal" id="opme-teste-close-modal" title="Fechar">✕</button>
          </div>
          <div class="opme-teste-body">
            <p class="opme-ajustes-help">
              Monte uma admissão fictícia e veja, <strong>passo a passo</strong>, como as regras
              (elegibilidade por termo, valor fixo por convênio, % do médico/geral, recebido ≤ 0)
              seriam aplicadas. <em>Nada é gravado no banco.</em>
            </p>
            <div class="opme-teste-form">
              <label class="opme-teste-campo opme-teste-campo-wide">
                <span>Produto / procedimento</span>
                <input type="text" id="opme-teste-produto" placeholder="ex: ISTENT INFINITE TRABECULAR MICROBYPASS..." autocomplete="off">
              </label>
              <div class="opme-teste-campo">
                <span>Convênio <small>(ou PARTICULAR)</small></span>
                ${comboTesteHTML('opme-teste-convenio', '— convênio —')}
              </div>
              <div class="opme-teste-campo">
                <span>Médico <small>(opcional — testa % por médico)</small></span>
                ${comboTesteHTML('opme-teste-medico', '— médico —')}
              </div>
              <label class="opme-teste-campo">
                <span>Valor produzido</span>
                <div class="opme-teste-valor-wrap"><span class="opme-vf-cifrao">R$</span><input type="number" id="opme-teste-produzido" placeholder="0,00" step="0.01" min="0"></div>
              </label>
              <label class="opme-teste-campo">
                <span>Valor recebido <small>(em branco = não informado)</small></span>
                <div class="opme-teste-valor-wrap"><span class="opme-vf-cifrao">R$</span><input type="number" id="opme-teste-recebido" placeholder="—" step="0.01"></div>
              </label>
            </div>
            <div class="opme-teste-acoes">
              <button class="btn btn-primary" id="opme-teste-simular">▶ Simular</button>
            </div>
            <div class="opme-teste-resultado" id="opme-teste-resultado"></div>
          </div>
        </div>
      `;
    }

    /** Markup de um combobox custom (substitui o datalist nativo, que não é estilizável). */
    function comboTesteHTML(id, placeholder) {
      return `
        <div class="opme-combo" data-combo="${id}">
          <input type="text" id="${id}" class="opme-combo-input" placeholder="${placeholder}" autocomplete="off">
          <button type="button" class="opme-combo-clear" tabindex="-1" title="Limpar" style="display:none">✕</button>
          <button type="button" class="opme-combo-arrow" tabindex="-1" aria-label="Abrir lista">▾</button>
          <div class="opme-combo-dropdown" hidden></div>
        </div>`;
    }

    /** Liga o comportamento de um combobox custom (abrir/filtrar/selecionar). */
    function montarComboTeste(inputId, opcoes) {
      const input = document.getElementById(inputId);
      if (!input) return;
      const combo = input.closest('.opme-combo');
      if (!combo) return;
      const dd = combo.querySelector('.opme-combo-dropdown');
      const arrow = combo.querySelector('.opme-combo-arrow');
      const clearBtn = combo.querySelector('.opme-combo-clear');
      const MAX = 200;
      const desenhar = (filtro) => {
        const f = norm(filtro || '');
        const lista = f ? opcoes.filter(o => norm(o).indexOf(f) >= 0) : opcoes;
        const corte = lista.slice(0, MAX);
        dd.innerHTML = corte.length
          ? corte.map(o => `<div class="opme-combo-opt${norm(o) === norm(input.value) ? ' sel' : ''}" data-val="${escapeHTML(o)}">${escapeHTML(o)}</div>`).join('')
            + (lista.length > MAX ? `<div class="opme-combo-vazio">+${lista.length - MAX} resultados — refine a busca</div>` : '')
          : `<div class="opme-combo-vazio">Nenhum resultado</div>`;
      };
      const abrir = () => { desenhar(input.value); dd.hidden = false; arrow.classList.add('aberto'); };
      const fechar = () => { dd.hidden = true; arrow.classList.remove('aberto'); };
      const refreshClear = () => { if (clearBtn) clearBtn.style.display = input.value ? 'flex' : 'none'; };
      input.addEventListener('focus', abrir);
      input.addEventListener('input', () => { desenhar(input.value); dd.hidden = false; arrow.classList.add('aberto'); refreshClear(); });
      arrow.addEventListener('mousedown', (e) => { e.preventDefault(); if (dd.hidden) { abrir(); input.focus(); } else { fechar(); } });
      if (clearBtn) clearBtn.addEventListener('mousedown', (e) => { e.preventDefault(); input.value = ''; refreshClear(); desenhar(''); input.focus(); });
      dd.addEventListener('mousedown', (e) => {
        const opt = e.target.closest('.opme-combo-opt');
        if (!opt) return;
        e.preventDefault();
        input.value = opt.dataset.val || '';
        refreshClear();
        fechar();
      });
      refreshClear();
    }

    /** Roda a simulação e devolve o HTML do passo a passo + repasse final. */
    function simularTeste({ produto, convenio, ehParticular, produzido, recebido, medico }) {
      const cfg = lerConfig();
      const termosAtivos = listarTermosAtivos();
      const excluidos = listarProdutosExcluidos();
      const pNorm = norm(produto || '');
      const prod = Number(produzido) || 0;
      const recInformado = !(recebido === '' || recebido === null || recebido === undefined || isNaN(Number(recebido)));
      const rec = recInformado ? Number(recebido) : NaN;

      // ── Passo 1: elegibilidade por termo ──
      const termoCasado = termosAtivos.find(t => pNorm && pNorm.indexOf(norm(t)) >= 0) || null;
      const estaExcluido = excluidos && excluidos.has && excluidos.has((produto || '').trim());
      const elegivel = !!termoCasado && !estaExcluido;
      let p1 = '';
      if (!produto || !produto.trim()) {
        p1 = `<div class="opme-teste-linha opme-teste-warn">Informe um produto/procedimento.</div>`;
      } else {
        p1 = `<div class="opme-teste-linha ${termoCasado ? 'ok' : 'no'}">
                ${termoCasado ? `✓ casou o termo elegível <b>${escapeHTML(termoCasado)}</b>` : '✗ nenhum termo elegível encontrado no nome'}
              </div>`
            + (estaExcluido ? `<div class="opme-teste-linha no">⚠ este produto está na lista de <b>excluídos</b> → não elegível</div>` : '')
            + `<div class="opme-teste-linha ${elegivel ? 'ok' : 'no'}"><b>${elegivel ? 'Elegível ✓' : 'Não elegível ✗'}</b></div>`
            + `<div class="opme-teste-nota">O teste assume classificação <b>OPME</b> (não verificável só pelo nome). Os passos abaixo rodam mesmo se não elegível, pra você inspecionar.</div>`;
      }

      // ── Passo 2: valor fixo (base produzida) ──
      const matched = ehParticular ? null : casarValorFixo(produto, convenio);
      const baseInfo = baseComValorFixo(produto, prod, convenio, ehParticular);
      let p2 = '';
      if (ehParticular) {
        p2 = `<div class="opme-teste-linha">Convênio <b>PARTICULAR</b> → valor fixo <b>não se aplica</b>.</div>
              <div class="opme-teste-linha">Base = produzido = <b>R$ ${fmt(prod, 2)}</b></div>`;
      } else if (baseInfo.ajustado && matched) {
        p2 = `<div class="opme-teste-linha ok">✓ casou valor fixo · padrão <b>"${escapeHTML((baseInfo.padrao || '').replace(/\|/g, ' '))}"</b> · convênio <b>${baseInfo.convenio ? escapeHTML(baseInfo.convenio) : 'curinga (qualquer)'}</b></div>
              <div class="opme-teste-linha">Produzido do relatório: R$ ${fmt(prod, 2)} · valor fixado sugerido: <b>R$ ${fmt(baseInfo.fixo, 2)}</b></div>
              <div class="opme-teste-nota">V897: o fixado só passa a valer depois do clique em <b>ajustar</b> na linha do Relatório QVIS — até lá a base é o valor real.</div>`;
      } else {
        p2 = `<div class="opme-teste-linha">Nenhum valor fixo casou${convenio ? ` para o convênio "${escapeHTML(convenio)}"` : ''}.</div>
              <div class="opme-teste-linha">Base = produzido = <b>R$ ${fmt(prod, 2)}</b></div>`;
      }

      // ── Passo 3: % e repasse ──
      const rep = calcularRepasse(baseInfo.base, rec, medico, cfg, produto);
      // Transparência: como o médico foi resolvido pelo de-para
      const temMedico = !!(medico && medico.trim());
      const resol = temMedico ? resolverMedicoCanonico(medico) : null;
      let notaMed = '';
      if (temMedico) {
        if (resol.via === 'vinculo') notaMed = `<div class="opme-teste-nota">Médico resolvido pelo de-para (vínculo) → <b>${escapeHTML(resol.nome)}</b>.</div>`;
        else if (resol.via === 'similaridade') notaMed = `<div class="opme-teste-nota">Médico resolvido por <b>similaridade</b> → <b>${escapeHTML(resol.nome)}</b> <i>(não vinculado no De-Para)</i>.</div>`;
        else notaMed = `<div class="opme-teste-nota">Médico <b>não encontrado</b> no de-para → usando o nome digitado.</div>`;
      }
      let p3 = '';
      if (rep.recebidoZero) {
        p3 = `<div class="opme-teste-linha no">Recebido informado = R$ ${fmt(rec, 2)} ≤ 0 → <b>repasse ZERADO</b> (ATLAS não recebeu).</div>` + notaMed;
      } else if (baseInfo.base <= 0) {
        p3 = `<div class="opme-teste-linha no">Base ≤ 0 → repasse R$ 0,00.</div>`;
      } else {
        const origem = rep.pctOrigem === 'medico'
          ? `regra do médico <b>${escapeHTML(resol ? resol.nome : (medico || ''))}</b>`
          : (rep.pctOrigem === 'opme'
              ? `<b>% próprio do OPME</b> (regra do material)`
              : `<b>PCT_GERAL</b> (nenhuma regra para este médico)`);
        p3 = notaMed
            + `<div class="opme-teste-linha">% aplicado: ${origem} = <b>${rep.pct}%</b></div>
              <div class="opme-teste-linha">Repasse = R$ ${fmt(baseInfo.base, 2)} × ${rep.pct}% = <b>R$ ${fmt(rep.repasse, 2)}</b></div>`;
        if (!recInformado) {
          p3 += `<div class="opme-teste-nota">Recebido não informado → a regra "recebido ≤ 0 zera" não foi aplicada.</div>`;
        }
      }

      return `
        <div class="opme-teste-passo"><div class="opme-teste-passo-tit">1 · Elegibilidade</div>${p1}</div>
        <div class="opme-teste-passo"><div class="opme-teste-passo-tit">2 · Valor fixo (base produzida)</div>${p2}</div>
        <div class="opme-teste-passo"><div class="opme-teste-passo-tit">3 · % e repasse</div>${p3}</div>
        <div class="opme-teste-final">Repasse final: <span>R$ ${fmt(rep.repasse, 2)}</span></div>
      `;
    }

    // ── PAINEL DE AJUSTES ───────────────────────────────────────────────
    function renderPainelAjustes(cfg, termosAtivos) {
      const state = window.__opme;
      if (!state.ajustesAberto) return '';
      const medicos = listarMedicosOpme(termosAtivos);
      const regrasArr = cfg.regrasMedicoRows || Array.from(cfg.regrasMedico.values());
      const valoresFixosArr = carregarValoresFixos();
      const conveniosQvis = listarConveniosQvis();
      const vfGrupos = {};
      for (const v of valoresFixosArr) { const k = v.convenio || ''; (vfGrupos[k] = vfGrupos[k] || []).push(v); }
      const vfChaves = Object.keys(vfGrupos).sort((a, b) => (a === '' ? 1 : (b === '' ? -1 : a.localeCompare(b))));
      return `
        <div class="opme-ajustes-overlay" id="opme-ajustes-overlay"></div>
        <div class="opme-ajustes-modal" role="dialog" aria-modal="true">
          <div class="opme-ajustes-modal-head">
            <h3 class="opme-ajustes-modal-tit">⚙ Ajustes — OPME</h3>
            <button class="opme-ajustes-close-modal" id="opme-ajustes-close-modal" title="Fechar ajustes">✕</button>
          </div>
          <div class="opme-ajustes-body">
        <div class="opme-ajustes">
          <div class="opme-aj-pct-col"><!-- V665: coluna A explícita — a seção de
               produtos adicionados quebrava o auto-posicionamento do grid -->
          <div class="opme-ajustes-secao">
            <h4>OPMEs Elegíveis</h4>
            <p class="opme-ajustes-help">
              Filtram ambas as bases. Clique em <strong>▾</strong> para ver os produtos
              capturados por cada termo (busca <em>contém</em>, case-insensitive).
            </p>
            <div class="opme-categorias-lista">
              ${cfg.termos.map(t => renderCategoriaMacro(t, cfg)).join('')}
            </div>
            <div class="opme-add-termo">
              <input type="text" id="opme-novo-termo"
                     placeholder="Adicionar termo (ex: BIOPSIA)..."
                     maxlength="60">
              <button class="btn" id="opme-btn-add-termo">+ Adicionar</button>
            </div>
            <div class="opme-switch-respeita">
              <label class="opme-switch" title="Decide o empate entre o % do OPME e a regra específica do médico">
                <input type="checkbox" id="opme-chk-respeita-medico" ${cfg.respeitarMedico ? 'checked' : ''}>
                <span class="opme-switch-slider"></span>
              </label>
              <span class="opme-switch-txt">
                Quando um OPME tem % próprio, <b>respeitar a regra específica do médico</b>
                <small>Ligado: a regra do médico vence o % do OPME · Desligado: o % do OPME vence.</small>
              </span>
            </div>
          </div>

          <!-- V661: produtos ADICIONADOS que só a PRODUÇÃO QVIS busca -->
          <div class="opme-ajustes-secao">
            <h4>Produtos adicionados — Produção QVIS</h4>
            <p class="opme-ajustes-help">
              Termos <strong>extras</strong> que o painel <strong>Produção QVIS</strong> passa a buscar,
              além dos OPMEs elegíveis acima (busca <em>contém</em> no nome do produto, dentro da
              classificação OPME). Não afetam o Relatório QVIS. Clique num termo pra ativar/desativar.
            </p>
            <div class="opme-extras-lista">
              ${(() => {
                const extras = listarExtrasProducao();
                return extras.length === 0
                  ? `<small class="opme-ajustes-help">Nenhum produto adicionado ainda.</small>`
                  : extras.map(x => `
                    <span class="opme-extra-chip ${x.ativo ? '' : 'opme-extra-off'}">
                      <button class="opme-extra-toggle" data-extra-termo="${escapeHTML(x.termo)}"
                              title="${x.ativo ? 'Ativo — clique pra desativar' : 'Inativo — clique pra reativar'}">${escapeHTML(x.termo)}</button>
                      <button class="opme-extra-rm" data-extra-rm="${escapeHTML(x.termo)}" title="Remover da lista">✕</button>
                    </span>`).join('');
              })()}
            </div>
            <div class="opme-add-termo opme-add-extra-wrap">
              <div class="opme-extra-ac-wrap">
                <input type="text" id="opme-novo-extra"
                       placeholder="Digite pra pesquisar os produtos da Produção..."
                       autocomplete="off" maxlength="80">
                <div class="opme-extra-sug" id="opme-extra-sug" hidden></div>
              </div>
              <button class="btn" id="opme-btn-add-extra">+ Adicionar</button>
            </div>
          </div>
          </div><!-- /coluna A (V665) -->

          <div class="opme-aj-pct-col">
          <div class="opme-ajustes-secao">
            <h4>Regra geral (% sobre valor do material)</h4>
            <div class="opme-pct-geral">
              <input type="number" id="opme-pct-geral"
                     step="0.01" min="0" max="100"
                     value="${cfg.pctGeral.toFixed(2)}">
              <span class="opme-pct-suffix">%</span>
              <small class="opme-pct-help">
                Aplicada quando o médico da linha não tem regra específica abaixo.
              </small>
            </div>
          </div>

          <div class="opme-ajustes-secao">
            <h4>Regras específicas por médico</h4>
            <p class="opme-ajustes-help">Sobrescreve a regra geral para o profissional selecionado.</p>

            <div class="opme-nova-regra">
              <select id="opme-novo-medico" class="opme-select">
                <option value="">— escolha um médico —</option>
                ${medicos.map(m => `
                  <option value="${escapeHTML(m.nome_profissional)}">${escapeHTML(CodigoMedico.exibir(m.nome_profissional))}</option>
                `).join('')}
              </select>
              <input type="number" id="opme-nova-pct" placeholder="%" step="0.01" min="0" max="100">
              <button class="btn" id="opme-btn-add-regra">+ Adicionar regra</button>
            </div>

            ${regrasArr.length === 0 ? `
              <div class="opme-regras-vazio">Nenhuma regra específica cadastrada — todos os médicos usam a regra geral (${cfg.pctGeral.toFixed(2)}%).</div>
            ` : `
              <ul class="opme-regras-lista">
                ${regrasArr.map(r => `
                  <li class="opme-regra-item">
                    <span class="opme-regra-nome">${escapeHTML(CodigoMedico.exibir(resolverMedicoCanonico(r.nome_exibicao).nome || r.nome_exibicao))}</span>
                    <span class="opme-regra-pct mono">${fmt(r.pct, 2)}%</span>
                    <button class="opme-regra-remover"
                            data-nome-norm="${escapeHTML(r.nome_normalizado)}"
                            title="Remover regra">✕</button>
                  </li>
                `).join('')}
              </ul>
            `}
          </div>

          <!-- V663: regra específica por PRODUTO (switch — nasce inativa) -->
          <div class="opme-ajustes-secao ${cfg.regraProdutoAtiva ? '' : 'opme-secao-inativa'}">
            <h4>Regras específicas por produto
              <label class="opme-switch" style="float:right" title="Liga/desliga a aplicação das regras por produto no cálculo">
                <input type="checkbox" id="opme-chk-regra-produto" ${cfg.regraProdutoAtiva ? 'checked' : ''}>
                <span class="opme-switch-slider"></span>
              </label>
            </h4>
            <p class="opme-ajustes-help">
              % por <strong>produto específico</strong> (nome exato). Quando <strong>ligada</strong>, é a regra mais
              específica de todas — vence médico, % do OPME e papel. ${cfg.regraProdutoAtiva ? '' : '<strong>Desligada: cadastros ficam guardados sem afetar o cálculo.</strong>'}
            </p>
            <div class="opme-nova-regra">
              <div class="opme-extra-ac-wrap">
                <input type="text" id="opme-novo-regra-produto" placeholder="Digite pra pesquisar o produto..." autocomplete="off" maxlength="120">
                <div class="opme-extra-sug" id="opme-regra-produto-sug" hidden></div>
              </div>
              <input type="number" id="opme-nova-pct-produto" placeholder="%" step="0.01" min="0" max="100">
              <button class="btn" id="opme-btn-add-regra-produto">+ Adicionar</button>
            </div>
            ${(cfg.regrasProdutoRows || []).length === 0 ? `
              <div class="opme-regras-vazio">Nenhuma regra por produto cadastrada.</div>
            ` : `
              <ul class="opme-regras-lista">
                ${cfg.regrasProdutoRows.map(r => `
                  <li class="opme-regra-item">
                    <span class="opme-regra-nome">${escapeHTML(r.produto_exibicao)}</span>
                    <span class="opme-regra-pct mono">${fmt(r.pct, 2)}%</span>
                    <button class="opme-regra-remover" data-regra-produto-rm="${escapeHTML(r.produto_normalizado)}" title="Remover regra">✕</button>
                  </li>`).join('')}
              </ul>
            `}
          </div>

          <!-- V663: regra específica por PAPEL (switch — nasce inativa) -->
          <div class="opme-ajustes-secao ${cfg.regraPapelAtiva ? '' : 'opme-secao-inativa'}">
            <h4>Regras específicas por papel
              <label class="opme-switch" style="float:right" title="Liga/desliga a aplicação das regras por papel no cálculo">
                <input type="checkbox" id="opme-chk-regra-papel" ${cfg.regraPapelAtiva ? 'checked' : ''}>
                <span class="opme-switch-slider"></span>
              </label>
            </h4>
            <p class="opme-ajustes-help">
              % por <strong>papel</strong> da linha do QVIS (ex.: CIRURGIAO). Quando <strong>ligada</strong>, vale
              quando nada mais específico casou (produto, médico ou % do OPME) — vence só a regra geral.
              ${cfg.regraPapelAtiva ? '' : '<strong>Desligada: cadastros ficam guardados sem afetar o cálculo.</strong>'}
            </p>
            <div class="opme-nova-regra">
              <select id="opme-novo-regra-papel" class="opme-select">
                <option value="">— escolha um papel —</option>
                ${listarPapeisOpme(termosAtivos).map(p => `<option value="${escapeHTML(p)}">${escapeHTML(p)}</option>`).join('')}
              </select>
              <input type="number" id="opme-nova-pct-papel" placeholder="%" step="0.01" min="0" max="100">
              <button class="btn" id="opme-btn-add-regra-papel">+ Adicionar</button>
            </div>
            <div class="opme-nova-regra" style="margin-top:6px;">
              <div class="opme-extra-ac-wrap">
                <input type="text" id="opme-regra-papel-prod" placeholder="Produto (opcional — vazio = qualquer produto)..." autocomplete="off" maxlength="120">
                <div class="opme-extra-sug" id="opme-regra-papel-prod-sug" hidden></div>
              </div>
            </div>
            ${(cfg.regrasPapelRows || []).length === 0 ? `
              <div class="opme-regras-vazio">Nenhuma regra por papel cadastrada.</div>
            ` : `
              <ul class="opme-regras-lista">
                ${cfg.regrasPapelRows.map(r => `
                  <li class="opme-regra-item">
                    <span class="opme-regra-nome">${escapeHTML(r.papel_exibicao)}<small style="display:block;color:var(--ink-faint);">${r.produto_exibicao ? escapeHTML(r.produto_exibicao) : 'qualquer produto'}</small></span>
                    <span class="opme-regra-pct mono">${fmt(r.pct, 2)}%</span>
                    <button class="opme-regra-remover" data-regra-papel-rm="${escapeHTML(r.papel_normalizado)}" data-regra-papel-prod="${escapeHTML(r.produto_normalizado || '')}" title="Remover regra">✕</button>
                  </li>`).join('')}
              </ul>
            `}
          </div>
          </div>

          <div class="opme-ajustes-secao opme-vf-secao">
            <h4>Valor fixo de OPME — por convênio</h4>
            <p class="opme-ajustes-help">
              Cadastre por <strong>convênio</strong> (ou <strong>Qualquer convênio</strong> como curinga) o <strong>valor do produzido</strong> correto e o <strong>padrão de busca</strong> em <strong>termos</strong> (chips). O nome do OPME precisa conter <em>todos</em> os termos pra casar. Quando casar, o repasse usa o valor cadastrado — independente do que veio no relatório. Particular fica de fora. Desempate: convênio específico vence o curinga; depois, mais termos.
            </p>
            <div class="opme-vf-nova">
              <select id="opme-vf-novo-convenio" class="opme-select" title="Convênio">
                <option value="">— Qualquer convênio —</option>
                ${conveniosQvis.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('')}
              </select>
              <input type="text" id="opme-vf-novo-padrao" placeholder="1º termo (ex: ISTENT)..." maxlength="60">
              <div class="opme-vf-valor-wrap">
                <span class="opme-vf-cifrao">R$</span>
                <input type="number" id="opme-vf-novo-valor" class="mono" placeholder="0,00" step="0.01" min="0">
              </div>
              <button class="btn" id="opme-vf-btn-add">+ Adicionar</button>
            </div>
            ${valoresFixosArr.length === 0 ? `
              <div class="opme-regras-vazio">Nenhum valor fixo cadastrado.</div>
            ` : vfChaves.map(ch => `
              <div class="opme-vf-grupo">
                <div class="opme-vf-grupo-tit">${ch === '' ? '<em>Qualquer convênio (curinga)</em>' : escapeHTML(ch)}</div>
                <table class="opme-vf-tabela">
                  <thead>
                    <tr>
                      <th class="opme-vf-th-valor">Valor produzido</th>
                      <th>Padrão de busca</th>
                      <th class="opme-vf-th-acao"></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${vfGrupos[ch].map(v => `
                      <tr>
                        <td class="opme-vf-td-valor">
                          <div class="opme-vf-valor-wrap">
                            <span class="opme-vf-cifrao">R$</span>
                            <input type="number" class="opme-vf-valor mono" data-id="${v.id}" data-campo="valor_fixo"
                                   value="${Number(v.valor_fixo).toFixed(2)}" step="0.01" min="0">
                          </div>
                        </td>
                        <td class="opme-vf-td-padrao">
                          <div class="opme-vf-chips">
                            ${termosDoPadrao(v.padrao).map((termo, i) => {
                              const emEdicao = state.vfEditandoTermo && state.vfEditandoTermo.id === v.id && state.vfEditandoTermo.indice === i;
                              if (emEdicao) {
                                return `<input type="text" class="opme-vf-termo-edit" data-id="${v.id}" data-indice="${i}" value="${escapeHTML(termo)}" maxlength="60">`;
                              }
                              return `<span class="opme-vf-chip">
                                        <span class="opme-vf-chip-txt" data-id="${v.id}" data-indice="${i}" title="Clique pra editar este termo">${escapeHTML(termo)}</span>
                                        <button class="opme-vf-chip-x" data-id="${v.id}" data-indice="${i}" title="Remover termo">✕</button>
                                      </span>`;
                            }).join('')}
                            ${state.vfAdicionandoTermo === v.id
                              ? `<input type="text" class="opme-vf-termo-novo" data-id="${v.id}" placeholder="Novo termo..." maxlength="60">`
                              : `<button class="opme-vf-chip-add" data-id="${v.id}" title="Adicionar termo (todos os termos precisam casar)">+ Adicionar termo</button>`}
                          </div>
                        </td>
                        <td class="opme-vf-td-acao">
                          <button class="opme-vf-remover" data-id="${v.id}" title="Remover este valor fixo">✕</button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `).join('')}
          </div>
        </div>
          </div>
        </div>
      `;
    }

    /**
     * Renderiza UM card de categoria macro (ISTENT/VALVULA/ANEL/etc),
     * com checkbox de ativação + botão expand pra mostrar os produtos
     * específicos da base que casam com o termo.
     */
    function renderCategoriaMacro(termo, cfg) {
      const state = window.__opme;
      state.macrosExpandidas = state.macrosExpandidas || {};
      const expandido = !!state.macrosExpandidas[termo.termo];
      const produtos = expandido ? listarProdutosDoTermo(termo.termo) : [];
      const excluidos = expandido ? listarProdutosExcluidos() : new Set();
      // Conta produtos ATIVOS (não excluídos) — pra mostrar no header
      const totalProdutos = produtos.length;
      const ativos = produtos.filter(p => !excluidos.has(p)).length;
      const totalExcluidos = totalProdutos - ativos;
      const pctGeralTxt = cfg ? fmt(cfg.pctGeral, 2) : '';
      const temPct = termo.pct !== null && termo.pct !== undefined && termo.pct !== '';
      return `
        <div class="opme-macro ${termo.ativo ? 'is-ativo' : 'is-inativo'} ${expandido ? 'is-expandido' : ''}"
             data-termo="${escapeHTML(termo.termo)}">
          <div class="opme-macro-head">
            <label class="opme-macro-toggle" title="Ativar/desativar este termo no filtro">
              <input type="checkbox" class="opme-termo-chk"
                     data-termo="${escapeHTML(termo.termo)}"
                     ${termo.ativo ? 'checked' : ''}>
              <span class="opme-macro-nome">${escapeHTML(termo.termo)}</span>
            </label>
            <div class="opme-macro-pct ${temPct ? 'tem-pct' : ''}"
                 title="% de repasse deste OPME (vazio = usa a regra geral ${pctGeralTxt}%)">
              <input type="number" class="opme-termo-pct"
                     data-termo="${escapeHTML(termo.termo)}"
                     value="${temPct ? termo.pct : ''}"
                     placeholder="${pctGeralTxt}"
                     step="0.01" min="0" max="100">
              <span class="opme-macro-pct-sufixo">%</span>
            </div>
            <button class="opme-macro-drilldown"
                    data-termo="${escapeHTML(termo.termo)}"
                    title="${expandido ? 'Recolher' : 'Ver produtos capturados'}">
              ${expandido ? '▴' : '▾'}
            </button>
          </div>
          ${expandido ? `
            <div class="opme-macro-drill">
              ${produtos.length === 0 ? `
                <div class="opme-macro-vazio">Nenhum produto na base contém "${escapeHTML(termo.termo)}".</div>
              ` : `
                <div class="opme-macro-info">
                  ${totalProdutos} produto${totalProdutos > 1 ? 's' : ''} capturado${totalProdutos > 1 ? 's' : ''}
                  ${totalExcluidos > 0 ? `<span class="opme-macro-info-tag">${totalExcluidos} exclu${totalExcluidos > 1 ? 'ídos' : 'ído'}</span>` : ''}
                </div>
                <ul class="opme-macro-produtos">
                  ${produtos.map(p => {
                    const ex = excluidos.has(p);
                    return `<li class="opme-produto ${ex ? 'is-excluido' : ''}">
                      <span class="opme-produto-nome">${escapeHTML(p)}</span>
                      ${ex
                        ? `<button class="opme-produto-restaurar" data-produto="${escapeHTML(p)}" title="Restaurar este produto à elegibilidade">↺</button>`
                        : `<button class="opme-produto-excluir" data-produto="${escapeHTML(p)}" title="Excluir este produto da elegibilidade">✕</button>`}
                    </li>`;
                  }).join('')}
                </ul>
              `}
            </div>
          ` : ''}
        </div>
      `;
    }

    // ── PAINEL DE TABELA ────────────────────────────────────────────────
    // V493: fragmentos do cabeçalho do painel com ids ESTÁVEIS — usados pelo
    // render completo (renderPainel) E pelo renderParcialFiltros (incremental).
    // O wrapper usa display:contents pra não alterar o layout flex do título.
    function renderPainelMeta(lado, total, visiveis, temFiltro) {
      const filtroAtivo = temFiltro
        ? `<span class="opme-tag-filtro" title="Há filtro ativo">⚙ filtro ativo</span>`
        : '';
      const labelOcultas = (total - visiveis) > 0
        ? `<span class="opme-ocultas-tag">${total - visiveis} oculta${(total - visiveis) > 1 ? 's' : ''}</span>`
        : '';
      return `<span id="opme-painel-meta-${lado}" style="display:contents"><span class="opme-painel-contador" title="Visíveis / total">
                ${visiveis} <small>de ${total}</small>
              </span>
              ${labelOcultas}
              ${filtroAtivo}</span>`;
    }
    function renderBadgePago(lado, pagas) {
      return `<span class="opme-badge-pago" id="opme-badge-pago-${lado}">${pagas} paga${pagas !== 1 ? 's' : ''}</span>`;
    }

    function renderPainel({ lado, titulo, icone, total, visiveis, pagas, tabela, temFiltro, cfgTermos, produtosProducao }) {
      let filtroHeader = '';
      if (lado === 'esq') {
        // Relatório QVIS: UMA pasta única ("📂 Termos: N") que agrupa os macros
        // elegíveis ATIVOS (igual ao botão-pasta "Produtos" da Produção). Ao abrir,
        // lista os macros; cada macro expande inline a sua lista de procedimentos
        // pra desmarcar (excluir) individualmente.
        filtroHeader = renderQvisFolder(cfgTermos);
      } else {
        // Produção: 1 dropdown único com todos os produtos
        const state = window.__opme;
        const totalProds  = (produtosProducao || []).length;
        const ocultosCount = Array.from(state.produtosOcultos)
          .filter(p => (produtosProducao || []).includes(p)).length;
        const visiveisCount = totalProds - ocultosCount;
        const labelBotao = totalProds === 0
          ? 'Sem produtos'
          : (ocultosCount === 0
              ? `Produtos: ${totalProds}`
              : `Produtos: ${visiveisCount} de ${totalProds}`);
        const indicadorFiltro = ocultosCount > 0
          ? `<span class="opme-prod-indicador">${ocultosCount} oc.</span>`
          : '';
        const aberto = state.dropdownAberto === 'producao';

        // Botão "Repasse antecipado" — só faz sentido com mês filtrado
        const podeAbrirEv = !!(state.mes && state.ano);
        const tooltipEv = podeAbrirEv
          ? 'Selecionar admissões da Produção pra criar repasse antecipado (EV) no Relatório QVIS'
          : 'Filtre um mês primeiro para habilitar';
        filtroHeader = `
          <button class="opme-btn-ev ${podeAbrirEv ? '' : 'is-disabled'}"
                  id="opme-btn-ev"
                  type="button"
                  ${podeAbrirEv ? '' : 'disabled'}
                  title="${tooltipEv}">
            ✚ Repasse antecipado
          </button>
          <div class="opme-prod-dropdown-wrap" data-tipo="producao">
            <button class="opme-prod-dropdown-btn ${ocultosCount > 0 ? 'is-filtrado' : ''}"
                    id="opme-btn-prod-dropdown"
                    type="button"
                    title="Selecionar produtos a exibir">
              📂 ${labelBotao} ${indicadorFiltro} <span class="opme-prod-seta">${aberto ? '▴' : '▾'}</span>
            </button>
            ${aberto ? renderProdDropdown(produtosProducao || []) : ''}
          </div>
        `;
      }

      return `
        <div class="opme-painel" data-lado="${lado}">
          <div class="opme-painel-head">
            <div class="opme-painel-titulo">
              <span class="opme-painel-icone">${icone}</span>
              <h3>${titulo}</h3>
              ${renderPainelMeta(lado, total, visiveis, temFiltro)}
            </div>
            <div class="opme-painel-chips-wrap">
              ${filtroHeader}
              ${renderBadgePago(lado, pagas)}
            </div>
          </div>
          <div class="opme-tabela-scroll" id="opme-tabela-scroll-${lado}">${tabela}</div>
        </div>
      `;
    }

    /**
     * Renderiza UM dropdown macro do Relatório QVIS (ex: ANEL/ISTENT/VALVULA).
     * O botão mostra o nome do macro + indicador de quantos procedimentos
     * estão excluídos. Click abre popover com checkboxes individuais.
     */
    function renderDropdownMacroQvis(termo) {
      const state = window.__opme;
      const aberto = state.dropdownAberto === `macro-${termo}`;
      const procedimentos = listarProcedimentosDoTermoQvis(termo);
      const excluidos = listarProdutosExcluidos();
      const totalExcluidos = procedimentos.filter(p => excluidos.has(p)).length;
      const indicador = totalExcluidos > 0
        ? `<span class="opme-prod-indicador">${totalExcluidos} oc.</span>`
        : '';
      return `
        <div class="opme-prod-dropdown-wrap" data-tipo="macro" data-termo="${escapeHTML(termo)}">
          <button class="opme-macro-dropdown-btn ${totalExcluidos > 0 ? 'is-filtrado' : ''}"
                  data-termo="${escapeHTML(termo)}"
                  type="button"
                  title="Ver e excluir procedimentos do macro ${escapeHTML(termo)}">
            ${escapeHTML(termo)} ${indicador} <span class="opme-prod-seta">${aberto ? '▴' : '▾'}</span>
          </button>
          ${aberto ? renderProdutosMacroQvisPopover(termo, procedimentos, excluidos) : ''}
        </div>
      `;
    }

    /** Popover do dropdown macro com os procedimentos pra excluir. */
    function renderProdutosMacroQvisPopover(termo, procedimentos, excluidos) {
      const totalOcultos = procedimentos.filter(p => excluidos.has(p)).length;
      const visiveis = procedimentos.length - totalOcultos;
      return `
        <div class="opme-prod-dropdown-popover" data-termo="${escapeHTML(termo)}">
          <div class="opme-prod-popover-head">
            <strong>Procedimentos ${escapeHTML(termo)}</strong>
            <div class="opme-prod-popover-acoes">
              <button class="opme-prod-popover-link opme-macro-todos"
                      data-termo="${escapeHTML(termo)}">Selecionar todos</button>
              <span>·</span>
              <button class="opme-prod-popover-link opme-macro-nenhum"
                      data-termo="${escapeHTML(termo)}">Limpar</button>
            </div>
          </div>
          <div class="opme-prod-popover-lista">
            ${procedimentos.length === 0 ? `
              <div class="opme-prod-popover-vazio">Nenhum procedimento ${escapeHTML(termo)} no QVIS.</div>
            ` : procedimentos.map(p => {
              const excluido = excluidos.has(p);
              return `<label class="opme-prod-popover-item">
                <input type="checkbox" class="opme-macro-chk"
                       data-produto="${escapeHTML(p)}"
                       data-termo="${escapeHTML(termo)}"
                       ${excluido ? '' : 'checked'}>
                <span class="${excluido ? 'opme-prod-popover-tachado' : ''}">${escapeHTML(p)}</span>
              </label>`;
            }).join('')}
          </div>
          <div class="opme-prod-popover-footer">
            <small>${visiveis} de ${procedimentos.length} elegíveis · exclusão é global (afeta os 2 lados)</small>
          </div>
        </div>
      `;
    }

    /**
     * PASTA ÚNICA do Relatório QVIS (espelha o botão "📂 Produtos" da Produção).
     * Botão "📂 Termos: N" → abre popover com os macros elegíveis ATIVOS empilhados.
     * Cada macro, ao ser clicado, expande inline a sua lista de procedimentos.
     * Estado da pasta = state.qvisFolderAberto (independente do state.dropdownAberto,
     * que controla qual macro está expandido — assim abrir um macro NÃO fecha a pasta).
     */
    function renderQvisFolder(cfgTermos) {
      const state = window.__opme;
      const termosAtivos = (cfgTermos || []).filter(t => t.ativo);
      const aberto = state.qvisFolderAberto;
      // V492: consulta cada LIKE por termo e a tabela de excluídos UMA vez por
      // render e repassa ao popover (antes: botão E popover consultavam tudo de novo).
      const excluidos = listarProdutosExcluidos();
      const procsPorTermo = new Map();
      termosAtivos.forEach(t => procsPorTermo.set(t.termo, listarProcedimentosDoTermoQvis(t.termo)));
      let totalExcl = 0;
      termosAtivos.forEach(t => {
        procsPorTermo.get(t.termo).forEach(p => { if (excluidos.has(p)) totalExcl++; });
      });
      const indicador = totalExcl > 0
        ? `<span class="opme-prod-indicador">${totalExcl} oc.</span>`
        : '';
      const label = termosAtivos.length === 0
        ? 'Sem termos'
        : `Termos: ${termosAtivos.length}`;
      return `
        <div class="opme-prod-dropdown-wrap" data-tipo="qvis-folder">
          <button class="opme-prod-dropdown-btn ${totalExcl > 0 ? 'is-filtrado' : ''}"
                  id="opme-btn-qvis-folder"
                  type="button"
                  title="Termos elegíveis do Relatório QVIS">
            📂 ${label} ${indicador} <span class="opme-prod-seta">${aberto ? '▴' : '▾'}</span>
          </button>
          ${aberto ? renderQvisFolderPopover(termosAtivos, procsPorTermo, excluidos) : ''}
        </div>
      `;
    }

    /** Popover da pasta: lista vertical dos macros (acordeão).
     *  V492: recebe procsPorTermo/excluidos pré-consultados pelo renderQvisFolder. */
    function renderQvisFolderPopover(termosAtivos, procsPorTermo, excluidos) {
      const state = window.__opme;
      excluidos = excluidos || listarProdutosExcluidos(); // V492: fallback defensivo
      return `
        <div class="opme-prod-dropdown-popover opme-qvis-folder-popover" id="opme-qvis-folder-popover">
          <div class="opme-prod-popover-head">
            <strong>Termos elegíveis</strong>
          </div>
          <div class="opme-qvis-folder-lista">
            ${termosAtivos.length === 0 ? `
              <div class="opme-prod-popover-vazio">Nenhum termo elegível ativo.</div>
            ` : termosAtivos.map(t => {
              const termo = t.termo;
              // V492: usa o resultado já consultado (evita repetir o LIKE por termo)
              const procedimentos = (procsPorTermo && procsPorTermo.get(termo)) || listarProcedimentosDoTermoQvis(termo);
              const totalExcluidos = procedimentos.filter(p => excluidos.has(p)).length;
              const indicador = totalExcluidos > 0
                ? `<span class="opme-prod-indicador">${totalExcluidos} oc.</span>`
                : '';
              const aberto = state.dropdownAberto === `macro-${termo}`;
              return `
                <div class="opme-qvis-folder-item" data-termo="${escapeHTML(termo)}">
                  <button class="opme-macro-dropdown-btn opme-qvis-folder-macro-btn ${totalExcluidos > 0 ? 'is-filtrado' : ''}"
                          data-termo="${escapeHTML(termo)}"
                          type="button"
                          title="Ver e excluir procedimentos do macro ${escapeHTML(termo)}">
                    ${escapeHTML(termo)} ${indicador} <span class="opme-prod-seta">${aberto ? '▴' : '▾'}</span>
                  </button>
                  ${aberto ? renderMacroProcedimentosInline(termo, procedimentos, excluidos) : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    /** Lista de procedimentos de um macro, expandida INLINE dentro da pasta (acordeão). */
    function renderMacroProcedimentosInline(termo, procedimentos, excluidos) {
      const totalOcultos = procedimentos.filter(p => excluidos.has(p)).length;
      const visiveis = procedimentos.length - totalOcultos;
      return `
        <div class="opme-qvis-folder-sub">
          <div class="opme-prod-popover-acoes opme-qvis-folder-acoes">
            <button class="opme-prod-popover-link opme-macro-todos"
                    data-termo="${escapeHTML(termo)}">Selecionar todos</button>
            <span>·</span>
            <button class="opme-prod-popover-link opme-macro-nenhum"
                    data-termo="${escapeHTML(termo)}">Limpar</button>
          </div>
          <div class="opme-prod-popover-lista">
            ${procedimentos.length === 0 ? `
              <div class="opme-prod-popover-vazio">Nenhum procedimento ${escapeHTML(termo)} no QVIS.</div>
            ` : procedimentos.map(p => {
              const excluido = excluidos.has(p);
              return `<label class="opme-prod-popover-item">
                <input type="checkbox" class="opme-macro-chk"
                       data-produto="${escapeHTML(p)}"
                       data-termo="${escapeHTML(termo)}"
                       ${excluido ? '' : 'checked'}>
                <span class="${excluido ? 'opme-prod-popover-tachado' : ''}">${escapeHTML(p)}</span>
              </label>`;
            }).join('')}
          </div>
          <div class="opme-prod-popover-footer">
            <small>${visiveis} de ${procedimentos.length} elegíveis · exclusão é global (afeta os 2 lados)</small>
          </div>
        </div>
      `;
    }

    /**
     * Renderiza o conteúdo do dropdown de produtos (popover absoluto).
     * Lista checkboxes pra cada produto distinto da Produção.
     */
    function renderProdDropdown(produtos) {
      const state = window.__opme;
      const totalOcultos = produtos.filter(p => state.produtosOcultos.has(p)).length;
      return `
        <div class="opme-prod-dropdown-popover" id="opme-prod-popover">
          <div class="opme-prod-popover-head">
            <strong>Selecione os produtos a exibir</strong>
            <div class="opme-prod-popover-acoes">
              <button class="opme-prod-popover-link" id="opme-prod-todos">Selecionar todos</button>
              <span>·</span>
              <button class="opme-prod-popover-link" id="opme-prod-nenhum">Limpar</button>
            </div>
          </div>
          <div class="opme-prod-popover-lista">
            ${produtos.length === 0 ? `
              <div class="opme-prod-popover-vazio">Nenhum produto disponível com os filtros atuais.</div>
            ` : produtos.map(p => {
              const oculto = state.produtosOcultos.has(p);
              return `<label class="opme-prod-popover-item">
                <input type="checkbox" class="opme-prod-popover-chk"
                       data-produto="${escapeHTML(p)}"
                       ${oculto ? '' : 'checked'}>
                <span class="${oculto ? 'opme-prod-popover-tachado' : ''}">${escapeHTML(p)}</span>
              </label>`;
            }).join('')}
          </div>
          <div class="opme-prod-popover-footer">
            <small>${produtos.length - totalOcultos} de ${produtos.length} visíveis</small>
          </div>
        </div>
      `;
    }

    function renderTabelaQvis(linhas, pagamentos, cfg, evsPorAdmissao, subsPorChave) {
      if (linhas.length === 0) {
        return `<div class="opme-vazio">Nenhuma linha OPME no Relatório QVIS para os filtros atuais.</div>`;
      }
      return `
        <table class="opme-tabela">
          <thead>
            <tr>
              <th class="opme-col-status">Pago</th>
              <th>Data</th>
              <th>Admissão</th>
              <th>Paciente</th>
              <th>Procedimento</th>
              <th>Médico</th>
              <th class="num">Qtd</th>
              <th class="num" title="Produzido original do relatório QVIS (antes do valor fixo)">Valor real</th>
              <th class="num">Valor</th>
              <th class="num">Repasse</th>
            </tr>
          </thead>
          <tbody>
            ${linhas.map(l => renderLinhaQvis(l, pagamentos, cfg, evsPorAdmissao, subsPorChave)).join('')}
          </tbody>
        </table>
      `;
    }

    // Deriva TUDO de uma linha QVIS (flags + valor fixo + repasse calculado).
    // FONTE ÚNICA de cálculo: usada pelo render E pelos totais dos cards, pra a
    // soma do card bater exatamente com a soma das linhas exibidas.
    function analisarLinhaQvis(l, ctx) {
      const { pagamentos, cfg, evsPorAdmissao, subsPorChave } = ctx;
      const { porChave, porAdmissao } = pagamentos;
      const adm = String(l.admissao || '').trim();
      const ehEv = !!l.eh_ev;

      // BLOQUEIO POR EV: se essa admissão tem um registro EV em OUTRA competência
      // (não nessa linha), a linha vem desabilitada — já foi paga antecipadamente.
      const evDessaAdm = evsPorAdmissao ? evsPorAdmissao.get(adm) : null;
      const bloqueadaPorEv = !!evDessaAdm && !ehEv && (evDessaAdm.competencia !== l.mes_pagamento);

      // Identificador do relatório
      const codRelOficial = String(l.codigo_relatorio || '').trim();
      const fallbackRel = (!codRelOficial && l.origem && l.mes_pagamento)
        ? `${(l.origem === 'PARTICULAR') ? 'PART' : (l.origem === 'EV' ? 'EV' : 'CONV')}-${l.mes_pagamento}`
        : '';
      const codRel = codRelOficial || fallbackRel;
      const semCodigoOficial = !codRelOficial && !!fallbackRel;
      const semCodigoRelatorio = !codRel;

      // SUBSTITUIÇÃO DE MÉDICO
      const papel = String(l.papel || '').trim();
      const subsChave = chaveSubs(adm, codRel, papel);
      const subs = subsPorChave ? subsPorChave.get(subsChave) : null;
      const nomeOriginal = l.nome_profissional || '';
      const nomeMedicoEfetivo = subs ? subs.nome_substituto : nomeOriginal;
      const foiSubstituido = !!subs;

      const chave = `${adm}|${codRel}`;
      const pago = codRel ? porChave.get(chave) : null;
      const ehPago = !!pago;
      const recebidoZero = Number(l.recebido) <= 0;

      const todosRelatoriosPagos = porAdmissao.get(adm) || new Set();
      const duplicidade = ehPago && todosRelatoriosPagos.size > 1;

      const classes = [];
      if (ehEv)                     classes.push('opme-linha-ev');
      if (bloqueadaPorEv)           classes.push('opme-linha-bloqueada-ev');
      if (duplicidade)              classes.push('opme-linha-paga-outro');
      else if (ehPago)              classes.push('opme-linha-paga');
      else if (recebidoZero && !ehEv && !bloqueadaPorEv) classes.push('opme-linha-recebido-zero');

      // VALOR FIXO (subfaturamento): base efetiva da linha (e do EV, quando bloqueada)
      const ehPartLinha = String(l.origem || '').toUpperCase() === 'PARTICULAR'
        || String(l.tipo_recebimento || '').toUpperCase().indexOf('PART') >= 0;
      const fix = baseComValorFixo(l.procedimento, l.produzido, l.convenio, ehPartLinha, adm);   // V661

      // CÁLCULO DO REPASSE — usa nome do médico EFETIVO (substituto se houver)
      let calc;
      if (bloqueadaPorEv) {
        const fixEv = baseComValorFixo(evDessaAdm.procedimento, evDessaAdm.produzido, evDessaAdm.convenio, false, adm);
        let rep = Number(evDessaAdm.repasse_calculado) || 0;
        if (fixEv.ajustado && fixEv.original > 0) rep *= fixEv.base / fixEv.original;
        calc = { repasse: rep, pct: Number(evDessaAdm.pct_aplicado) || 0, pctOrigem: 'ev', recebidoZero: false };
      } else if (duplicidade) {
        calc = { repasse: 0, pct: 0, pctOrigem: 'verificar', recebidoZero: false };
      } else if (ehEv && !foiSubstituido) {
        let rep = Number(l.repassado) || 0;
        if (fix.ajustado && fix.original > 0) rep *= fix.base / fix.original;
        calc = { repasse: rep, pct: Number(l.ev_pct) || 0, pctOrigem: 'ev', recebidoZero: false };
      } else if (ehEv && foiSubstituido) {
        // EV com médico substituído — recalcula com o pct do novo médico (sobre a base efetiva)
        const pctNovo = pctParaMedico(nomeMedicoEfetivo, cfg, l.procedimento || '', papel);
        calc = { repasse: fix.base * (pctNovo / 100),
                 pct: pctNovo,
                 pctOrigem: cfg.regrasMedico.has(chaveMedicoCanonica(nomeMedicoEfetivo)) ? 'medico' : 'geral',
                 recebidoZero: false };
      } else {
        // Linha QVIS normal — calcula com o médico EFETIVO sobre a base efetiva
        calc = calcularRepasse(fix.base, l.recebido, nomeMedicoEfetivo, cfg, l.procedimento || '', papel);
      }

      return { adm, ehEv, evDessaAdm, bloqueadaPorEv, codRel, semCodigoOficial,
               semCodigoRelatorio, papel, subs, nomeOriginal, nomeMedicoEfetivo,
               foiSubstituido, pago, ehPago, recebidoZero, todosRelatoriosPagos,
               duplicidade, classes, fix, calc };
    }

    function renderLinhaQvis(l, pagamentos, cfg, evsPorAdmissao, subsPorChave) {
      const { adm, ehEv, evDessaAdm, bloqueadaPorEv, codRel, semCodigoOficial,
              semCodigoRelatorio, papel, subs, nomeOriginal, nomeMedicoEfetivo,
              foiSubstituido, pago, ehPago, recebidoZero, todosRelatoriosPagos,
              duplicidade, classes, fix, calc } =
        analisarLinhaQvis(l, { pagamentos, cfg, evsPorAdmissao, subsPorChave });

      const badgePct = bloqueadaPorEv
        ? `<small class="opme-badge-pct opme-badge-ev-bloq" title="Pago antecipadamente em ${escapeHTML(formatarMesExtenso(evDessaAdm.competencia))}">PAGO EV</small>`
        : duplicidade
        ? `<small class="opme-badge-pct opme-badge-verificar" title="Possível duplicidade — repasse suspenso até verificação">VERIFICAR</small>`
        : (calc.recebidoZero
            ? `<small class="opme-badge-pct opme-badge-zerado" title="Recebido R$ 0,00 — sem repasse">SEM REPASSE</small>`
            : (calc.pctOrigem === 'medico'
                ? `<small class="opme-badge-pct opme-badge-medico" title="Regra específica deste médico">${fmt(calc.pct, 2)}%</small>`
                : `<small class="opme-badge-pct opme-badge-geral" title="Regra geral">${fmt(calc.pct, 2)}%</small>`));

      const tooltipPago = bloqueadaPorEv
        ? `🟢 PAGO ANTECIPADAMENTE em ${formatarMesExtenso(evDessaAdm.competencia)} — repasse R$ ${fmt(evDessaAdm.repasse_calculado, 2)}.`
        : semCodigoRelatorio
        ? '⚠ Sem código de relatório — não é possível marcar'
        : (ehPago
            ? (duplicidade
                ? `⚠ DUPLICIDADE — esta admissão está paga em ${todosRelatoriosPagos.size} relatórios.`
                : `Pago em ${formatarData(pago.data)} (relatório ${codRel})`)
            : (semCodigoOficial
                ? `Marcar como pago (relatório sem código oficial — usando ${codRel})`
                : `Marcar como pago (relatório ${codRel})`));

      const tagRecZero = recebidoZero && !ehPago && !ehEv && !bloqueadaPorEv
        ? `<small class="opme-tag-rec-zero" title="Convênio ainda não pagou — sem repasse ao médico">VALOR RECEBIDO ZERADO</small>`
        : '';

      const tagEv = ehEv
        ? `<button class="opme-tag-ev" data-admissao="${escapeHTML(adm)}" title="Espaço Verde — repasse pago antecipadamente em ${escapeHTML(formatarMesExtenso(l.mes_pagamento))}. Clique pra desfazer.">EV</button>`
        : '';

      const seloBloqEv = bloqueadaPorEv
        ? `<div class="opme-selo-ev-bloq" title="Pago antecipadamente em ${escapeHTML(formatarMesExtenso(evDessaAdm.competencia))}">
             🟢 EV ${escapeHTML(formatarMesExtensoCurto(evDessaAdm.competencia))}
           </div>`
        : '';

      // CÉLULA MÉDICO — com botão de troca e nome substituto se houver
      const celulaMedico = `
        <div class="opme-medico-wrap">
          <div class="opme-medico-nome ${foiSubstituido ? 'opme-medico-substituto' : ''}">
            ${escapeHTML(CodigoMedico.exibir(nomeMedicoEfetivo || '—'))}
            <button class="opme-btn-trocar-medico"
                    data-admissao="${escapeHTML(adm)}"
                    data-cod-relatorio="${escapeHTML(codRel)}"
                    data-papel="${escapeHTML(papel)}"
                    data-nome-original="${escapeHTML(nomeOriginal)}"
                    title="${foiSubstituido ? 'Trocar substituto' : 'Trocar médico que vai receber o repasse'}">${foiSubstituido ? '↻' : '↻'}</button>
            ${foiSubstituido ? `
              <button class="opme-btn-restaurar-medico"
                      data-admissao="${escapeHTML(adm)}"
                      data-cod-relatorio="${escapeHTML(codRel)}"
                      data-papel="${escapeHTML(papel)}"
                      title="Restaurar médico original">↺</button>
            ` : ''}
          </div>
          ${foiSubstituido ? `
            <div class="opme-medico-original" title="Médico original do QVIS (substituído)">
              <s>${escapeHTML(nomeOriginal || '—')}</s>
            </div>
          ` : ''}
        </div>
      `;

      return `
        <tr class="${classes.join(' ')}" data-admissao="${escapeHTML(adm)}">
          <td class="opme-col-status">
            <label class="opme-chk-pago" title="${tooltipPago}">
              <input type="checkbox" class="opme-chk-pago-input"
                     data-admissao="${escapeHTML(adm)}"
                     data-cod-relatorio="${escapeHTML(codRel)}"
                     data-data-admissao="${escapeHTML(l.data_admissao || '')}"
                     data-competencia="${escapeHTML(l.competencia || '')}"
                     ${(semCodigoRelatorio || bloqueadaPorEv) ? 'disabled' : ''}
                     ${ehPago ? 'checked' : ''}>
              ${ehPago ? `<small class="opme-data-pgto ${duplicidade ? 'opme-data-pgto-outro' : ''}">${formatarData(pago.data)}</small>` : ''}
              ${duplicidade ? `<button class="opme-tag-outro" data-admissao="${escapeHTML(adm)}" title="Ver detalhes da duplicidade">⚠ verificar</button>` : ''}
              ${semCodigoOficial && !ehPago && !bloqueadaPorEv ? `<small class="opme-tag-sem-cod" title="Snapshot antigo sem código de relatório oficial">sem cód.</small>` : ''}
              ${tagEv}
              ${seloBloqEv}
            </label>
          </td>
          <td class="mono">${formatarData(l.data_admissao)}</td>
          <td class="mono">${escapeHTML(adm || '—')}</td>
          <td>${escapeHTML(l.paciente || '')}</td>
          <td>${escapeHTML(l.procedimento || '')}</td>
          <td>${celulaMedico}</td>
          <td class="num mono">${l.quantidade ?? '—'}</td>
          <td class="num mono opme-col-real">R$ ${fmt(fix.original, 2)}</td>
          <td class="num mono">R$ ${fmt(fix.base, 2)} ${fix.ajustado ? `
            <button class="opme-tag-ajustado ${fix.usandoReal ? 'opme-tag-sugerir' : ''}"
                    data-usar-real-adm="${escapeHTML(adm)}"
                    data-usar-real-prod="${escapeHTML(l.procedimento || '')}"
                    title="${fix.usandoReal
                      ? `Sugestão: existe valor fixado de R$ ${fmt(fix.fixo, 2)} para este material (termos &quot;${escapeHTML(fix.padrao)}&quot;). Clique em AJUSTAR para aplicá-lo — o valor e o repasse passam a usar o fixado.`
                      : `Valor AJUSTADO · relatório R$ ${fmt(fix.original, 2)} → R$ ${fmt(fix.base, 2)} (termos &quot;${escapeHTML(fix.padrao)}&quot;). Clique pra desfazer e voltar ao valor real.`}"
            >${fix.usandoReal ? 'ajustar ↗' : 'ajustado'}</button>` : ''} ${tagRecZero}</td>
          <td class="num mono opme-col-repasse">
            ${duplicidade ? '—' : (calc.recebidoZero ? '—' : 'R$ ' + fmt(calc.repasse, 2))} ${badgePct}
          </td>
        </tr>
      `;
    }

    /** Versão curta do mês: "Abr/26" em vez de "Abril/2026" */
    function formatarMesExtensoCurto(comp) {
      const m = String(comp || '').match(/^(\d{4})-(\d{2})/);
      if (!m) return '';
      const nomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      return `${nomes[parseInt(m[2], 10) - 1]}/${m[1].slice(2)}`;
    }

    function renderTabelaProd(linhas, pagamentos, cfg, evsPorAdmissao) {
      if (linhas.length === 0) {
        return `<div class="opme-vazio">Nenhuma linha OPME na Produção QVIS para os filtros atuais.</div>`;
      }
      return `
        <table class="opme-tabela opme-tabela-prod">
          <thead>
            <tr>
              <th class="opme-col-status">Pago</th>
              <th>Data</th>
              <th>Admissão</th>
              <th>Paciente</th>
              <th>Produto</th>
              <th>Cirurgião</th>
              <th class="num">Qtd</th>
              <th class="num">Valor</th>
              <th class="num" title="Competência em que o repasse antecipado (EV) foi pago no Relatório QVIS">Pago em</th>
              <th class="num" title="Valor do repasse antecipado (EV) pago por este OPME">Valor pago</th>
            </tr>
          </thead>
          <tbody>
            ${linhas.map(l => renderLinhaProd(l, pagamentos, evsPorAdmissao)).join('')}
          </tbody>
        </table>
      `;
    }

    function renderLinhaProd(l, pagamentos, evsPorAdmissao) {
      const { porAdmissao } = pagamentos;
      const adm = String(l.cod_admissao || '').trim();
      const relatoriosDessaAdm = porAdmissao.get(adm) || new Set();
      const ehPago = relatoriosDessaAdm.size > 0;
      const duplicidade = relatoriosDessaAdm.size > 1;
      const nomeRef = l.cirurgiao || l.medico || '';
      // V662: admissão enviada pro Relatório QVIS como EV (repasse antecipado)
      const ev = evsPorAdmissao ? evsPorAdmissao.get(adm) : null;
      const classes = [];
      if (duplicidade)        classes.push('opme-linha-paga-outro');
      else if (ehPago)        classes.push('opme-linha-paga');
      const tooltip = duplicidade
        ? `⚠ DUPLICIDADE — esta admissão está paga em ${relatoriosDessaAdm.size} relatórios`
        : (ehPago ? `Pago (relatório ${Array.from(relatoriosDessaAdm)[0]})` : '');
      return `
        <tr class="${classes.join(' ')}" data-admissao="${escapeHTML(adm)}">
          <td class="opme-col-status">
            <span class="opme-chk-pago opme-chk-readonly" title="${tooltip}">
              ${ehPago
                ? `<span class="opme-chk-marcado-readonly">✓</span>`
                : '<span class="opme-chk-vazio-readonly"></span>'}
              ${duplicidade ? `<button class="opme-tag-outro" data-admissao="${escapeHTML(adm)}" title="Ver detalhes da duplicidade">⚠ verificar</button>` : ''}
            </span>
          </td>
          <td class="mono">${formatarData(l.data_admissao)}</td>
          <td class="mono">${escapeHTML(adm || '—')}</td>
          <td>${escapeHTML(l.paciente || '')}</td>
          <td>${escapeHTML(l.produto || l.procedimento_principal || '')}</td>
          <td>${escapeHTML(nomeRef || '—')}</td>
          <td class="num mono">${l.quantidade ?? '—'}</td>
          <td class="num mono" title="Valor cru da Base Produção (sem ajuste de valor fixo)">R$ ${fmt(Number(l.valor) || 0, 2)}</td>
          <td class="num mono">${ev ? `<span class="opme-ev-pagoem" title="Repasse antecipado (EV) pago nesta competência">${formatarMesExtensoCurto(ev.competencia)}</span>` : '—'}</td>
          <td class="num mono${ev ? ' atlas-rep' : ''}">${ev ? 'R$ ' + fmt(Number(ev.repasse_calculado) || 0, 2) : '—'}</td><!-- V962 -->
        </tr>
      `;
    }

    // ── EVENTOS ─────────────────────────────────────────────────────────
    function bindEventos(cfg, termosAtivos) {
      const state = window.__opme;

      // ── Divisor vertical entre painéis — redimensionar largura ──
      // Arrastar horizontalmente = ajusta proporção. Duplo-clique = 50/50.
      const grip = document.getElementById('opme-resize-grip');
      if (grip) {
        grip.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const grid = document.getElementById('opme-grid');
          if (!grid) return;
          const gridRect = grid.getBoundingClientRect();
          const startX = e.clientX;
          const startPercent = state.larguraEsqPercent || 50;

          // limites: 20% até 80%
          const minPct = 20;
          const maxPct = 80;

          document.body.style.cursor = 'ew-resize';
          document.body.style.userSelect = 'none';
          grip.classList.add('is-dragging');

          let novoPercent = startPercent;
          const onMove = (ev) => {
            const deltaX = ev.clientX - startX;
            const deltaPercent = (deltaX / gridRect.width) * 100;
            novoPercent = Math.max(minPct, Math.min(maxPct, startPercent + deltaPercent));
            const painelEsq = document.querySelector('.opme-painel[data-lado="esq"]');
            const painelDir = document.querySelector('.opme-painel[data-lado="dir"]');
            if (painelEsq && painelDir) {
              painelEsq.style.flex = `0 0 calc(${novoPercent}% - 8px)`;
              painelDir.style.flex = '1 1 0';
            }
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            grip.classList.remove('is-dragging');
            state.larguraEsqPercent = novoPercent;
            try { localStorage.setItem('opme.larguraEsqPercent', String(novoPercent)); } catch (e) {}
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });

        // Clique-duplo: reseta pra 50/50
        grip.addEventListener('dblclick', (e) => {
          e.preventDefault();
          state.larguraEsqPercent = null;
          try { localStorage.removeItem('opme.larguraEsqPercent'); } catch (e) {}
          const painelEsq = document.querySelector('.opme-painel[data-lado="esq"]');
          const painelDir = document.querySelector('.opme-painel[data-lado="dir"]');
          if (painelEsq) painelEsq.style.flex = '';
          if (painelDir) painelDir.style.flex = '';
          Utilidades.toast('Largura dos painéis resetada (50/50)', 'info', 1800);
          renderizar();
        });
      }

      // Toggle ajustes
      const btnAj = document.getElementById('opme-btn-ajustes');
      if (btnAj) btnAj.addEventListener('click', () => {
        state.ajustesAberto = !state.ajustesAberto;
        renderizar();
      });
      // Modal de ajustes: montar no document.body pra escapar do transform do .main
      // (.main tem transform quando o menu fecha → vira containing block do position:fixed,
      //  jogando o modal pro canto. Movendo pro body, o fixed volta a ser relativo à viewport.)
      document.querySelectorAll('body > .opme-ajustes-overlay, body > .opme-ajustes-modal').forEach(el => el.remove());
      // V492: UMA referência por tipo — remove o keydown anterior incondicionalmente
      // (antes, cada renderizar() com modal aberto empilhava um handler novo, e só
      // saía se o usuário apertasse Escape).
      if (window.__opmeEscAjH) { document.removeEventListener('keydown', window.__opmeEscAjH); window.__opmeEscAjH = null; }
      if (state.ajustesAberto) {
        const ovAj = document.querySelector('.opme-ajustes-overlay');
        const mdAj = document.querySelector('.opme-ajustes-modal');
        if (ovAj) document.body.appendChild(ovAj);
        if (mdAj) document.body.appendChild(mdAj);
        const fecharAjustes = () => { state.ajustesAberto = false; renderizar(); };
        if (ovAj) ovAj.addEventListener('click', fecharAjustes);
        const xAj = document.getElementById('opme-ajustes-close-modal');
        if (xAj) xAj.addEventListener('click', fecharAjustes);
        const escAj = (e) => {
          if (App.telaAtual !== 'desempenho-opme') return; // V492: não age fora da tela
          if (e.key === 'Escape') { fecharAjustes(); document.removeEventListener('keydown', escAj); }
        };
        window.__opmeEscAjH = escAj; // V492
        document.addEventListener('keydown', escAj);
      }

      // ── Botão / modal de TESTE (simulador) ──
      const btnTeste = document.getElementById('opme-btn-teste');
      if (btnTeste) btnTeste.addEventListener('click', () => {
        state.testeAberto = !state.testeAberto;
        renderizar();
      });
      const btnExp = document.getElementById('opme-btn-exportar');
      if (btnExp) btnExp.addEventListener('click', abrirSeletorExport);
      // Limpa fantasmas e (se aberto) move overlay+modal pro document.body
      // (mesmo motivo do Ajustes: .main tem transform → containing block do fixed).
      document.querySelectorAll('body > .opme-teste-overlay, body > .opme-teste-modal').forEach(el => el.remove());
      // V492: mesma correção do escAj — remove o handler anterior antes de registrar
      if (window.__opmeEscTH) { document.removeEventListener('keydown', window.__opmeEscTH); window.__opmeEscTH = null; }
      if (state.testeAberto) {
        const ovT = document.querySelector('.opme-teste-overlay');
        const mdT = document.querySelector('.opme-teste-modal');
        if (ovT) document.body.appendChild(ovT);
        if (mdT) document.body.appendChild(mdT);
        const fecharTeste = () => { state.testeAberto = false; renderizar(); };
        if (ovT) ovT.addEventListener('click', fecharTeste);
        const xT = document.getElementById('opme-teste-close-modal');
        if (xT) xT.addEventListener('click', fecharTeste);
        const escT = (e) => {
          if (App.telaAtual !== 'desempenho-opme') return; // V492: não age fora da tela
          if (e.key === 'Escape') { fecharTeste(); document.removeEventListener('keydown', escT); }
        };
        window.__opmeEscTH = escT; // V492
        document.addEventListener('keydown', escT);
        // "Simular" → roda a simulação e injeta o resultado SEM re-render (preserva os campos)
        const btnSim = document.getElementById('opme-teste-simular');
        if (btnSim) btnSim.addEventListener('click', () => {
          const val = id => (document.getElementById(id)?.value || '').trim();
          const convenioRaw = val('opme-teste-convenio');
          const ehParticular = norm(convenioRaw) === 'PARTICULAR';
          const recStr = val('opme-teste-recebido');
          const html = simularTeste({
            produto: val('opme-teste-produto'),
            convenio: ehParticular ? '' : convenioRaw,
            ehParticular,
            produzido: parseFloat(val('opme-teste-produzido').replace(',', '.')) || 0,
            recebido: recStr === '' ? '' : (parseFloat(recStr.replace(',', '.'))),
            medico: val('opme-teste-medico'),
          });
          const out = document.getElementById('opme-teste-resultado');
          if (out) out.innerHTML = html;
        });
        // Comboboxes custom (substituem o datalist nativo) — convênio + médico
        montarComboTeste('opme-teste-convenio', ['PARTICULAR', ...listarConveniosQvis()]);
        montarComboTeste('opme-teste-medico', listarMedicosSugeridos());
        // Fecha dropdowns ao clicar fora de qualquer combo (handler no modal → morre no re-render)
        if (mdT) mdT.addEventListener('mousedown', (e) => {
          mdT.querySelectorAll('.opme-combo').forEach(c => {
            if (!c.contains(e.target)) {
              const dd = c.querySelector('.opme-combo-dropdown');
              const ar = c.querySelector('.opme-combo-arrow');
              if (dd) dd.hidden = true;
              if (ar) ar.classList.remove('aberto');
            }
          });
        });
      }

      // ⓘ Botão informativo: montado de forma CENTRAL pelo decorator do banner
      // (js/app.js) sempre que existe window.AtlasDocs[telaAtual]. Nada a fazer aqui.

      // ── V720: binds da fileira de filtros 20C ──
      bindBarraFiltros20C();

      // Botão "Visualização" (padrão .atlas-vis-*) — menu com "Ocultar pagas"
      const btnVisOpme = document.getElementById('opme-btn-visualizacao');
      if (btnVisOpme) btnVisOpme.addEventListener('click', (e) => {
        e.stopPropagation();
        state.menuVisaoAberto = !state.menuVisaoAberto;
        renderizar();
      });
      const itOcultarPagas = document.getElementById('opme-vis-ocultar-pagas');
      if (itOcultarPagas) itOcultarPagas.addEventListener('click', (e) => {
        e.stopPropagation();
        state.ocultarPagas = !state.ocultarPagas;
        state.menuVisaoAberto = false;
        renderizar();
      });
      // V492: remove o handler anterior incondicionalmente (antes acumulava a cada toggle)
      if (window.__opmeFecharVisH) { document.removeEventListener('click', window.__opmeFecharVisH); window.__opmeFecharVisH = null; }
      if (state.menuVisaoAberto) {
        const fecharVisOpme = (e) => {
          if (App.telaAtual !== 'desempenho-opme') return; // V492: não age fora da tela
          if (!e.target.closest('#opme-menu-visao') && !e.target.closest('#opme-btn-visualizacao')) {
            state.menuVisaoAberto = false;
            document.removeEventListener('click', fecharVisOpme);
            renderizar();
          }
        };
        window.__opmeFecharVisH = fecharVisOpme; // V492
        setTimeout(() => document.addEventListener('click', fecharVisOpme), 0);
      }

      // (V720: Mês/Ano agora vivem nas células da fileira 20C — sem selects)

      // ── Dropdowns macro do QVIS (3 botões: ANEL, ISTENT, VALVULA) ──
      document.querySelectorAll('.opme-macro-dropdown-btn').forEach(b => {
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const termo = b.dataset.termo;
          const chave = `macro-${termo}`;
          state.dropdownAberto = state.dropdownAberto === chave ? null : chave;
          renderizar();
        });
      });

      // Checkbox individual de procedimento (toggle exclusão GLOBAL)
      document.querySelectorAll('.opme-macro-chk').forEach(chk => {
        chk.addEventListener('change', async () => {
          const produto = chk.dataset.produto;
          if (!produto) return;
          if (chk.checked) {
            await restaurarProduto(produto);
          } else {
            await excluirProduto(produto);
          }
          renderizar();
        });
      });

      // "Selecionar todos" do dropdown macro do QVIS
      document.querySelectorAll('.opme-macro-todos').forEach(b => {
        b.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const termo = b.dataset.termo;
          const procedimentos = listarProcedimentosDoTermoQvis(termo);
          const excluidos = listarProdutosExcluidos();
          // V492: lote — antes era 1 Banco.salvar() (export do banco inteiro) POR produto
          await restaurarProdutosEmLote(procedimentos.filter(p => excluidos.has(p)));
          renderizar();
        });
      });

      // "Limpar" do dropdown macro do QVIS (excluir todos do macro)
      document.querySelectorAll('.opme-macro-nenhum').forEach(b => {
        b.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const termo = b.dataset.termo;
          if (!confirm(`Excluir TODOS os procedimentos do macro "${termo}" da elegibilidade?`)) return;
          const procedimentos = listarProcedimentosDoTermoQvis(termo);
          const excluidos = listarProdutosExcluidos();
          // V492: lote — antes era 1 Banco.salvar() (export do banco inteiro) POR produto
          await excluirProdutosEmLote(procedimentos.filter(p => !excluidos.has(p)));
          renderizar();
        });
      });

      // V493: botões "↻ trocar médico" e "↺ restaurar médico" por linha agora
      // são tratados pelo listener DELEGADO no #opme-grid (fim desta função).

      // ── Botão "✚ Repasse antecipado" (EV) ──
      const btnEv = document.getElementById('opme-btn-ev');
      if (btnEv && !btnEv.disabled) {
        btnEv.addEventListener('click', (e) => {
          e.preventDefault();
          abrirModalSelecaoEv();
        });
      }

      // V493: tag "EV" por linha agora é tratada pelo listener DELEGADO no
      // #opme-grid (fim desta função).

      // ── Pasta única do Relatório QVIS (agrupa os macros) ──
      const btnQvisFolder = document.getElementById('opme-btn-qvis-folder');
      if (btnQvisFolder) {
        btnQvisFolder.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const novo = !state.qvisFolderAberto;
          state.qvisFolderAberto = novo;
          // Ao alternar a pasta, fecha qualquer macro/dropdown aberto.
          state.dropdownAberto = null;
          renderizar();
        });
      }

      // ── Dropdown de produtos da Produção ──
      const btnProdDrop = document.getElementById('opme-btn-prod-dropdown');
      if (btnProdDrop) {
        btnProdDrop.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          state.dropdownAberto = state.dropdownAberto === 'producao' ? null : 'producao';
          renderizar();
        });
      }

      // Fecha o popover aberto quando clica fora dele
      // V492: remove o handler anterior incondicionalmente (antes acumulava a cada
      // toggle de checkbox/re-render com dropdown aberto). Atenção ao `true` (capture)
      // — o remove precisa usar as mesmas flags do add.
      if (window.__opmeCloseOutH) { document.removeEventListener('click', window.__opmeCloseOutH, true); window.__opmeCloseOutH = null; }
      if (state.dropdownAberto || state.qvisFolderAberto) {
        const closeOnOutside = (ev) => {
          if (App.telaAtual !== 'desempenho-opme') return; // V492: não age fora da tela
          // Verifica se o click foi dentro de algum popover OU em algum botão de dropdown
          const dentroPopover = ev.target.closest('.opme-prod-dropdown-popover');
          const dentroBotao = ev.target.closest('.opme-prod-dropdown-btn, .opme-macro-dropdown-btn');
          if (!dentroPopover && !dentroBotao) {
            state.dropdownAberto = null;
            state.qvisFolderAberto = false;
            document.removeEventListener('click', closeOnOutside, true);
            renderizar();
          }
        };
        window.__opmeCloseOutH = closeOnOutside; // V492
        setTimeout(() => document.addEventListener('click', closeOnOutside, true), 0);
      }

      // Checkboxes do dropdown de produtos da Produção
      document.querySelectorAll('.opme-prod-popover-chk').forEach(chk => {
        chk.addEventListener('change', () => {
          const produto = chk.dataset.produto;
          if (chk.checked) {
            state.produtosOcultos.delete(produto);
          } else {
            state.produtosOcultos.add(produto);
          }
          renderizar();
        });
      });

      // "Selecionar todos" / "Limpar" do dropdown da Produção
      const btnTodos = document.getElementById('opme-prod-todos');
      if (btnTodos) {
        btnTodos.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          state.produtosOcultos.clear();
          renderizar();
        });
      }
      const btnNenhum = document.getElementById('opme-prod-nenhum');
      if (btnNenhum) {
        btnNenhum.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          document.querySelectorAll('.opme-prod-popover-chk').forEach(chk => {
            if (chk.dataset.produto) state.produtosOcultos.add(chk.dataset.produto);
          });
          renderizar();
        });
      }

      // ── Painel de ajustes ──
      document.querySelectorAll('.opme-termo-chk').forEach(c => {
        c.addEventListener('change', async () => {
          await toggleTermoAtivo(c.dataset.termo, c.checked);
          renderizar();
        });
      });
      document.querySelectorAll('.opme-macro-drilldown').forEach(b => {
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const t = b.dataset.termo;
          state.macrosExpandidas = state.macrosExpandidas || {};
          state.macrosExpandidas[t] = !state.macrosExpandidas[t];
          renderizar();
        });
      });

      // ── % de repasse por OPME (campo no cabeçalho do macro) ──
      document.querySelectorAll('.opme-termo-pct').forEach(inp => {
        inp.addEventListener('click', e => e.stopPropagation());
        inp.addEventListener('change', async () => {
          const termo = inp.dataset.termo;
          const raw = (inp.value || '').trim();
          if (raw !== '') {
            const v = parseFloat(raw.replace(',', '.'));
            if (isNaN(v) || v < 0 || v > 100) {
              Utilidades.toast('% inválido (0-100)', 'error');
              renderizar();
              return;
            }
            await salvarPctTermo(termo, v);
            Utilidades.toast(`✓ ${termo}: ${v.toFixed(2)}%`, 'success', 1600);
          } else {
            await salvarPctTermo(termo, '');   // limpa → volta a usar a regra geral
            Utilidades.toast(`${termo}: volta a usar a regra geral`, 'info', 1800);
          }
          renderizar();
        });
      });

      // ── Switch: respeitar regra específica do médico (empate OPME × médico) ──
      const chkRespeita = document.getElementById('opme-chk-respeita-medico');
      if (chkRespeita) {
        chkRespeita.addEventListener('change', async () => {
          await salvarRespeitarMedico(chkRespeita.checked);
          Utilidades.toast(chkRespeita.checked
            ? 'Empate: a regra do médico vence o % do OPME'
            : 'Empate: o % do OPME vence a regra do médico', 'info', 2400);
          renderizar();
        });
      }

      // ── X em cada produto do drilldown (excluir produto específico) ──
      document.querySelectorAll('.opme-produto-excluir').forEach(b => {
        b.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const produto = b.dataset.produto;
          if (!produto) return;
          await excluirProduto(produto);
          Utilidades.toast(`Produto excluído da elegibilidade`, 'info', 2000);
          renderizar();
        });
      });
      // ── ↺ pra restaurar produto excluído ──
      document.querySelectorAll('.opme-produto-restaurar').forEach(b => {
        b.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const produto = b.dataset.produto;
          if (!produto) return;
          await restaurarProduto(produto);
          Utilidades.toast(`Produto restaurado à elegibilidade`, 'success', 2000);
          renderizar();
        });
      });

      const btnAddTermo = document.getElementById('opme-btn-add-termo');
      if (btnAddTermo) {
        btnAddTermo.addEventListener('click', async () => {
          const inpNovo = document.getElementById('opme-novo-termo');
          const val = (inpNovo.value || '').trim();
          if (!val) { Utilidades.toast('Digite um termo', 'error'); return; }
          await adicionarTermo(val);
          inpNovo.value = '';
          Utilidades.toast(`✓ Termo "${norm(val)}" adicionado`, 'success', 2000);
          renderizar();
        });
      }

      // V661: produtos adicionados da Produção QVIS (⚙ Ajustes)
      const btnAddExtra = document.getElementById('opme-btn-add-extra');
      if (btnAddExtra) {
        btnAddExtra.addEventListener('click', async () => {
          const inp = document.getElementById('opme-novo-extra');
          const val = (inp.value || '').trim();
          if (!val) { Utilidades.toast('Digite o produto (ou parte do nome)', 'error'); return; }
          await adicionarExtraProducao(val);
          inp.value = '';
          Utilidades.toast(`✓ Produto "${norm(val)}" adicionado à busca da Produção`, 'success', 2200);
          renderizar();
        });
      }
      // V662: pesquisa EM TEMPO REAL dos produtos da Produção enquanto digita —
      // clicar numa sugestão adiciona o produto direto à lista.
      const inpExtra = document.getElementById('opme-novo-extra');
      const sugExtra = document.getElementById('opme-extra-sug');
      if (inpExtra && sugExtra) {
        const buscar = () => {
          const q = (inpExtra.value || '').trim();
          if (q.length < 2) { sugExtra.hidden = true; sugExtra.innerHTML = ''; return; }
          let itens = [];
          try {
            itens = (Banco.query(`
              SELECT DISTINCT produto FROM linhas_producao
               WHERE classificacao_produto LIKE '%OPME%'
                 AND produto IS NOT NULL AND produto <> ''
                 AND UPPER(produto) LIKE ?
               ORDER BY produto LIMIT 30`, ['%' + q.toUpperCase() + '%']) || []).map(r => r.produto);
          } catch (e) {}
          if (!itens.length) {
            sugExtra.innerHTML = `<div class="opme-extra-sug-vazio">Nenhum produto OPME da Produção contém "${escapeHTML(q)}" — você ainda pode adicionar o texto como termo.</div>`;
            sugExtra.hidden = false;
            return;
          }
          sugExtra.innerHTML = itens.map(p => `<button class="opme-extra-sug-item" data-extra-sug="${escapeHTML(p)}">${escapeHTML(p)}</button>`).join('');
          sugExtra.hidden = false;
        };
        inpExtra.addEventListener('input', buscar);
        inpExtra.addEventListener('focus', buscar);
        inpExtra.addEventListener('blur', () => setTimeout(() => { if (sugExtra) sugExtra.hidden = true; }, 200));
        // mousedown (antes do blur) pra seleção não morrer com o fechamento
        sugExtra.addEventListener('mousedown', async (e) => {
          const it = e.target.closest('[data-extra-sug]');
          if (!it) return;
          e.preventDefault();
          await adicionarExtraProducao(it.dataset.extraSug);
          Utilidades.toast(`✓ Produto "${norm(it.dataset.extraSug)}" adicionado à busca da Produção`, 'success', 2200);
          renderizar();
        });
      }
      document.querySelectorAll('[data-extra-termo]').forEach(b => {
        b.addEventListener('click', async (e) => {
          e.preventDefault(); e.stopPropagation();
          await toggleExtraProducao(b.dataset.extraTermo);
          renderizar();
        });
      });
      document.querySelectorAll('[data-extra-rm]').forEach(b => {
        b.addEventListener('click', async (e) => {
          e.preventDefault(); e.stopPropagation();
          await removerExtraProducao(b.dataset.extraRm);
          Utilidades.toast('Produto removido da busca da Produção', 'success', 2000);
          renderizar();
        });
      });

      // V663: regras por PRODUTO e por PAPEL (switch + cadastro + remoção)
      const chkRegraProduto = document.getElementById('opme-chk-regra-produto');
      if (chkRegraProduto) chkRegraProduto.addEventListener('change', async () => {
        await salvarFlagConfigOpme('REGRA_PRODUTO_ATIVA', chkRegraProduto.checked);
        Utilidades.toast(chkRegraProduto.checked ? '✓ Regras por PRODUTO ativadas' : 'Regras por PRODUTO desativadas (cadastros preservados)', 'success', 2600);
        renderizar();
      });
      const chkRegraPapel = document.getElementById('opme-chk-regra-papel');
      if (chkRegraPapel) chkRegraPapel.addEventListener('change', async () => {
        await salvarFlagConfigOpme('REGRA_PAPEL_ATIVA', chkRegraPapel.checked);
        Utilidades.toast(chkRegraPapel.checked ? '✓ Regras por PAPEL ativadas' : 'Regras por PAPEL desativadas (cadastros preservados)', 'success', 2600);
        renderizar();
      });
      const btnAddRegraProduto = document.getElementById('opme-btn-add-regra-produto');
      if (btnAddRegraProduto) btnAddRegraProduto.addEventListener('click', async () => {
        const inp = document.getElementById('opme-novo-regra-produto');
        const pct = parseFloat(document.getElementById('opme-nova-pct-produto').value);
        const val = (inp.value || '').trim();
        if (!val) { Utilidades.toast('Escolha o produto', 'error'); return; }
        if (isNaN(pct) || pct < 0 || pct > 100) { Utilidades.toast('% inválido (0-100)', 'error'); return; }
        await adicionarRegraProduto(val, pct);
        Utilidades.toast(`✓ Regra do produto salva (${pct.toFixed(2)}%)`, 'success', 2200);
        renderizar();
      });
      const btnAddRegraPapel = document.getElementById('opme-btn-add-regra-papel');
      if (btnAddRegraPapel) btnAddRegraPapel.addEventListener('click', async () => {
        const sel = document.getElementById('opme-novo-regra-papel');
        const pct = parseFloat(document.getElementById('opme-nova-pct-papel').value);
        if (!sel.value) { Utilidades.toast('Escolha o papel', 'error'); return; }
        if (isNaN(pct) || pct < 0 || pct > 100) { Utilidades.toast('% inválido (0-100)', 'error'); return; }
        const prodPapel = (document.getElementById('opme-regra-papel-prod')?.value || '').trim();   // V665
        await adicionarRegraPapel(sel.value, pct, prodPapel);
        Utilidades.toast(`✓ Regra do papel salva (${pct.toFixed(2)}%${prodPapel ? ' · ' + prodPapel : ''})`, 'success', 2400);
        renderizar();
      });
      document.querySelectorAll('[data-regra-produto-rm]').forEach(b => b.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        await removerRegraProduto(b.dataset.regraProdutoRm);
        renderizar();
      }));
      document.querySelectorAll('[data-regra-papel-rm]').forEach(b => b.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        await removerRegraPapel(b.dataset.regraPapelRm, b.dataset.regraPapelProd || '');
        renderizar();
      }));
      // V665: pesquisa em tempo real do PRODUTO da regra por papel
      const inpPapelProd = document.getElementById('opme-regra-papel-prod');
      const sugPapelProd = document.getElementById('opme-regra-papel-prod-sug');
      if (inpPapelProd && sugPapelProd) {
        const buscarPP = () => {
          const q = norm((inpPapelProd.value || '').trim());
          if (q.length < 2) { sugPapelProd.hidden = true; sugPapelProd.innerHTML = ''; return; }
          const set = new Set();
          try {
            for (const l of carregarQvis(termosAtivos, '', '') || []) {
              const p = String(l.procedimento || '').trim();
              if (p && norm(p).includes(q)) set.add(p);
              if (set.size >= 30) break;
            }
          } catch (e) {}
          const itens = Array.from(set).sort().slice(0, 30);
          sugPapelProd.innerHTML = itens.length
            ? itens.map(p => `<button class="opme-extra-sug-item" data-papel-prod-sug="${escapeHTML(p)}">${escapeHTML(p)}</button>`).join('')
            : `<div class="opme-extra-sug-vazio">Nenhum produto OPME contém "${escapeHTML(inpPapelProd.value.trim())}".</div>`;
          sugPapelProd.hidden = false;
        };
        inpPapelProd.addEventListener('input', buscarPP);
        inpPapelProd.addEventListener('focus', buscarPP);
        inpPapelProd.addEventListener('blur', () => setTimeout(() => { if (sugPapelProd) sugPapelProd.hidden = true; }, 200));
        sugPapelProd.addEventListener('mousedown', (e) => {
          const it = e.target.closest('[data-papel-prod-sug]');
          if (!it) return;
          e.preventDefault();
          inpPapelProd.value = it.dataset.papelProdSug;
          sugPapelProd.hidden = true;
        });
      }
      // pesquisa em tempo real do PRODUTO da regra (QVIS + Produção, subset OPME)
      const inpRegraProd = document.getElementById('opme-novo-regra-produto');
      const sugRegraProd = document.getElementById('opme-regra-produto-sug');
      if (inpRegraProd && sugRegraProd) {
        const buscarRP = () => {
          const q = norm((inpRegraProd.value || '').trim());
          if (q.length < 2) { sugRegraProd.hidden = true; sugRegraProd.innerHTML = ''; return; }
          const set = new Set();
          try {
            for (const l of carregarQvis(termosAtivos, '', '') || []) {
              const p = String(l.procedimento || '').trim();
              if (p && norm(p).includes(q)) set.add(p);
              if (set.size >= 30) break;
            }
            for (const l of _scanProducao(termosAtivos.concat(extrasProducaoAtivos()), extrasLivres()) || []) {
              const p = String(l.produto || '').trim();
              if (p && norm(p).includes(q)) set.add(p);
              if (set.size >= 40) break;
            }
          } catch (e) {}
          const itens = Array.from(set).sort().slice(0, 30);
          sugRegraProd.innerHTML = itens.length
            ? itens.map(p => `<button class="opme-extra-sug-item" data-regra-prod-sug="${escapeHTML(p)}">${escapeHTML(p)}</button>`).join('')
            : `<div class="opme-extra-sug-vazio">Nenhum produto OPME contém "${escapeHTML(inpRegraProd.value.trim())}".</div>`;
          sugRegraProd.hidden = false;
        };
        inpRegraProd.addEventListener('input', buscarRP);
        inpRegraProd.addEventListener('focus', buscarRP);
        inpRegraProd.addEventListener('blur', () => setTimeout(() => { if (sugRegraProd) sugRegraProd.hidden = true; }, 200));
        sugRegraProd.addEventListener('mousedown', (e) => {
          const it = e.target.closest('[data-regra-prod-sug]');
          if (!it) return;
          e.preventDefault();
          inpRegraProd.value = it.dataset.regraProdSug;   // preenche; o % vem antes do + Adicionar
          sugRegraProd.hidden = true;
        });
      }

      // V661: alternar valor AJUSTADO ↔ REAL por linha do Relatório QVIS
      document.querySelectorAll('[data-usar-real-adm]').forEach(b => {
        b.addEventListener('click', async (e) => {
          e.preventDefault(); e.stopPropagation();
          const ok = await toggleUsarReal(b.dataset.usarRealAdm, b.dataset.usarRealProd);
          if (ok) renderizar();
        });
      });

      const pctInp = document.getElementById('opme-pct-geral');
      if (pctInp) {
        pctInp.addEventListener('blur', async () => {
          const v = parseFloat(pctInp.value);
          if (isNaN(v) || v < 0 || v > 100) {
            Utilidades.toast('% inválido (0-100)', 'error');
            pctInp.value = cfg.pctGeral.toFixed(2);
            return;
          }
          await salvarPctGeral(v);
          Utilidades.toast(`✓ Regra geral: ${v.toFixed(2)}%`, 'success', 1800);
          renderizar();
        });
      }

      const btnAddRegra = document.getElementById('opme-btn-add-regra');
      if (btnAddRegra) {
        btnAddRegra.addEventListener('click', async () => {
          const sel = document.getElementById('opme-novo-medico');
          const pct = document.getElementById('opme-nova-pct');
          const nome = sel.value;
          const v = parseFloat(pct.value);
          if (!nome) { Utilidades.toast('Escolha um médico', 'error'); return; }
          if (isNaN(v) || v < 0 || v > 100) { Utilidades.toast('% inválido (0-100)', 'error'); return; }
          await adicionarRegraMedico(nome, v);
          Utilidades.toast(`✓ Regra para ${nome}: ${v.toFixed(2)}%`, 'success', 2200);
          renderizar();
        });
      }

      document.querySelectorAll('.opme-regra-remover').forEach(b => {
        b.addEventListener('click', async () => {
          const nomeNorm = b.dataset.nomeNorm;
          if (confirm('Remover esta regra específica? O médico passará a usar a regra geral.')) {
            await removerRegraMedico(nomeNorm);
            renderizar();
          }
        });
      });

      // ── Valor fixo de OPME (subfaturamento) ──
      const vfBtnAdd = document.getElementById('opme-vf-btn-add');
      if (vfBtnAdd) {
        vfBtnAdd.addEventListener('click', async () => {
          const convInp = document.getElementById('opme-vf-novo-convenio');
          const padInp = document.getElementById('opme-vf-novo-padrao');
          const valInp = document.getElementById('opme-vf-novo-valor');
          const conv = convInp ? convInp.value : '';
          const pad = String(padInp.value || '').trim();
          const val = parseFloat(valInp.value);
          if (!pad) { Utilidades.toast('Informe o padrão de busca', 'error'); return; }
          if (isNaN(val) || val < 0) { Utilidades.toast('Valor inválido', 'error'); return; }
          await adicionarValorFixo(conv, pad, val);
          Utilidades.toast(`✓ ${conv || 'Qualquer convênio'} · "${pad}": R$ ${Utilidades.formatarNumero(val, 2)}`, 'success', 2400);   // V944
          renderizar();
        });
      }
      // valor (R$) editável inline
      document.querySelectorAll('.opme-vf-valor').forEach(inp => {
        inp.addEventListener('change', async () => {
          const v = parseFloat(inp.value);
          if (isNaN(v) || v < 0) { Utilidades.toast('Valor inválido', 'error'); _renderOpme(); return; }
          await atualizarValorFixoCampo(inp.dataset.id, 'valor_fixo', v);
          Utilidades.toast('✓ Valor atualizado', 'success', 1400);
          _renderOpme();
        });
      });
      // remover o cadastro inteiro
      document.querySelectorAll('.opme-vf-remover').forEach(b => {
        b.addEventListener('click', async () => {
          if (confirm('Remover este valor fixo cadastrado?')) { await removerValorFixo(b.dataset.id); _renderOpme(); }
        });
      });
      // remover um termo (chip)
      document.querySelectorAll('.opme-vf-chip-x').forEach(b => {
        b.addEventListener('click', async () => {
          await removerTermoVF(b.dataset.id, parseInt(b.dataset.indice, 10));
          _renderOpme();
        });
      });
      // clicar no texto do chip → editar
      document.querySelectorAll('.opme-vf-chip-txt').forEach(s => {
        s.addEventListener('click', () => {
          state.vfEditandoTermo = { id: Number(s.dataset.id), indice: parseInt(s.dataset.indice, 10) };
          _renderOpme();
        });
      });
      // input de edição de termo (Enter salva, Esc cancela)
      document.querySelectorAll('.opme-vf-termo-edit').forEach(inp => {
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
        const cancelar = () => { state.vfEditandoTermo = null; _renderOpme(); };
        const confirmar = async () => {
          const id = inp.dataset.id, idx = parseInt(inp.dataset.indice, 10);
          state.vfEditandoTermo = null;
          await editarTermoVF(id, idx, inp.value);
          _renderOpme();
        };
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
          if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
        });
        inp.addEventListener('blur', () => { setTimeout(() => { if (state.vfEditandoTermo) confirmar(); }, 150); });
      });
      // "+ Adicionar termo" → input inline
      document.querySelectorAll('.opme-vf-chip-add').forEach(b => {
        b.addEventListener('click', () => { state.vfAdicionandoTermo = Number(b.dataset.id); _renderOpme(); });
      });
      document.querySelectorAll('.opme-vf-termo-novo').forEach(inp => {
        setTimeout(() => inp.focus(), 0);
        const cancelar = () => { state.vfAdicionandoTermo = null; _renderOpme(); };
        const confirmar = async () => {
          const val = inp.value.trim(), id = inp.dataset.id;
          state.vfAdicionandoTermo = null;
          if (val) { await adicionarTermoVF(id, val); Utilidades.toast(`✓ Termo "${val.toUpperCase()}" adicionado`, 'success', 1600); }
          _renderOpme();
        };
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
          if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
        });
        inp.addEventListener('blur', () => { setTimeout(() => { if (state.vfAdicionandoTermo != null) confirmar(); }, 150); });
      });

      // V493: checkbox de pago e badge "⚠ verificar" por linha agora são
      // tratados pelo listener DELEGADO no #opme-grid (fim desta função).

      // ── Sincronização de scroll entre os dois painéis ──
      const scrollEsq = document.querySelector('.opme-painel[data-lado="esq"] .opme-tabela-scroll');
      const scrollDir = document.querySelector('.opme-painel[data-lado="dir"] .opme-tabela-scroll');
      if (scrollEsq && scrollDir) {
        let syncing = false;
        const sync = (src, tgt) => {
          if (syncing) return;
          syncing = true;
          // Sincronização proporcional (% rolado), pra acomodar tabelas de
          // tamanhos diferentes em cada lado.
          const maxSrc = src.scrollHeight - src.clientHeight;
          const maxTgt = tgt.scrollHeight - tgt.clientHeight;
          if (maxSrc > 0 && maxTgt > 0) {
            tgt.scrollTop = (src.scrollTop / maxSrc) * maxTgt;
          }
          requestAnimationFrame(() => { syncing = false; });
        };
        scrollEsq.addEventListener('scroll', () => sync(scrollEsq, scrollDir));
        scrollDir.addEventListener('scroll', () => sync(scrollDir, scrollEsq));
      }

      // ── V493: DELEGAÇÃO DE EVENTOS NO CONTAINER DAS TABELAS ────────────
      // Substitui os listeners POR LINHA (checkbox pago, trocar/restaurar
      // médico, tag EV, badge "⚠ verificar" e hover-sync) por UM listener por
      // tipo no #opme-grid. Além de eliminar centenas de addEventListener por
      // render, sobrevive ao renderParcialFiltros (que só troca o miolo das
      // tabelas), mantendo dataset/ids e comportamentos idênticos.
      const gridDelegado = document.getElementById('opme-grid');
      if (gridDelegado) {
        gridDelegado.addEventListener('click', async (e) => {
          // ── Botão "↻" trocar médico ──
          const bTrocar = e.target.closest('.opme-btn-trocar-medico');
          if (bTrocar) {
            e.preventDefault();
            e.stopPropagation();
            abrirModalTrocarMedico({
              admissao: bTrocar.dataset.admissao,
              codRel: bTrocar.dataset.codRelatorio,
              papel: bTrocar.dataset.papel || '',
              nomeOriginal: bTrocar.dataset.nomeOriginal || '',
            });
            return;
          }

          // ── Botão "↺" restaurar médico original (atalho rápido) ──
          const bRestaurar = e.target.closest('.opme-btn-restaurar-medico');
          if (bRestaurar) {
            e.preventDefault();
            e.stopPropagation();
            const adm = bRestaurar.dataset.admissao;
            if (confirm(`Restaurar o médico original desta linha (admissão ${adm})?`)) {
              await restaurarMedicoOriginal(adm, bRestaurar.dataset.codRelatorio, bRestaurar.dataset.papel || '');
              Utilidades.toast('Médico original restaurado', 'info', 2200);
              renderizar();
            }
            return;
          }

          // ── Tag "EV" nas linhas copiadas (clique pra desfazer) ──
          const tagEv = e.target.closest('.opme-tag-ev');
          if (tagEv) {
            e.preventDefault();
            e.stopPropagation();
            const adm = tagEv.dataset.admissao;
            if (!adm) return;
            if (confirm(`Remover marcação EV (Espaço Verde) da admissão ${adm}?\n\nA cópia será removida do Relatório QVIS, mas a admissão continua intacta na Produção QVIS.`)) {
              await removerEv(adm);
              Utilidades.toast(`Marcação EV removida da admissão ${adm}`, 'info', 2400);
              renderizar();
            }
            return;
          }

          // ── Badge OUTRO clicável → abre modal de detalhes ──
          const tagOutro = e.target.closest('.opme-tag-outro');
          if (tagOutro) {
            e.preventDefault();
            e.stopPropagation();
            const adm = tagOutro.dataset.admissao;
            if (adm) abrirModalPagamentoOutro(adm);
            return;
          }

          // ── Checkbox de pago ──
          const c = e.target.closest('.opme-chk-pago-input');
          if (c) {
            e.preventDefault();
            const adm     = c.dataset.admissao;
            const codRel  = c.dataset.codRelatorio;
            const dataAdm = c.dataset.dataAdmissao;
            const comp    = c.dataset.competencia;
            if (!adm) return;
            if (!codRel) {
              Utilidades.toast('Linha sem código de relatório vinculado', 'error', 2400);
              return;
            }

            if (!c.checked) {
              // Estava marcado e clicou → desmarcar (exige senha do administrador)
              const ok = await pedirSenhaAdm(`Desmarcar a admissão ${adm} (relatório ${codRel}) como paga exige a senha do administrador.`);
              if (ok) {
                await desmarcarPago(adm, codRel);
                Utilidades.toast(`Pagamento removido (relatório ${codRel})`, 'info', 2200);
                // V493: incremental — a gravação no banco fica igual; só o DOM
                // das tabelas/cards/contadores é atualizado (scroll preservado).
                renderParcialFiltros({ preservarScroll: true });
              }
            } else {
              // Tentando marcar — verifica se já há pagamento dessa admissão em
              // OUTRO código de relatório
              const pags = carregarPagamentos();
              const outros = Array.from(pags.porAdmissao.get(adm) || [])
                .filter(r => r !== codRel);
              if (outros.length > 0) {
                // Há pagamento em outro relatório → modal de aviso de duplicidade
                const continuar = await abrirModalAvisoDuplicidade(
                  adm, codRel, outros, pags, dataAdm, comp
                );
                if (!continuar) return;
              }
              // Marca direto com data atual automática
              await marcarPago(adm, codRel, comp, dataAdm, '');
              Utilidades.toast(`✓ Admissão ${adm} marcada como paga`, 'success', 2400);
              // V493: incremental (linha + duplicatas + cards + badges), sem
              // reconstruir a tela toda nem perder a posição do scroll.
              renderParcialFiltros({ preservarScroll: true });
            }
            return;
          }
        });

        // ── V493: hover-sync DELEGADO (mouseover/mouseout) ──
        // Destaca a mesma admissão nos dois painéis. Usa um Map<admissão, tr[]>
        // construído UMA vez por render (lazy) em vez de 2 querySelectorAll por
        // evento de mouse como era no mouseenter/mouseleave por linha.
        const linhasDaAdmissao = (adm) => {
          if (!_hoverRowsOpme) {
            _hoverRowsOpme = new Map();
            gridDelegado.querySelectorAll('.opme-tabela tr[data-admissao]').forEach(tr => {
              const a = tr.dataset.admissao;
              if (!a) return;
              const arr = _hoverRowsOpme.get(a);
              if (arr) arr.push(tr); else _hoverRowsOpme.set(a, [tr]);
            });
          }
          return _hoverRowsOpme.get(adm) || [];
        };
        const trDoEvento = (el) => (el && el.closest) ? el.closest('.opme-tabela tr[data-admissao]') : null;
        gridDelegado.addEventListener('mouseover', (e) => {
          const tr = trDoEvento(e.target);
          if (!tr || !tr.dataset.admissao) return;
          if (trDoEvento(e.relatedTarget) === tr) return; // movimento entre células da MESMA linha
          linhasDaAdmissao(tr.dataset.admissao).forEach(r => r.classList.add('opme-row-sync-hover'));
        });
        gridDelegado.addEventListener('mouseout', (e) => {
          const tr = trDoEvento(e.target);
          if (!tr || !tr.dataset.admissao) return;
          if (trDoEvento(e.relatedTarget) === tr) return; // ainda dentro da MESMA linha
          linhasDaAdmissao(tr.dataset.admissao).forEach(r => r.classList.remove('opme-row-sync-hover'));
        });
      }
    }

    /**
     * Modal de substituição de médico — redireciona quem vai receber o repasse
     * de uma linha QVIS específica (admissao + codigo_relatorio + papel).
     */
    /** Modal estilizado de senha do administrador (NÃO usa prompt nativo).
     *  Resolve true se a senha bater, false se cancelar. Montado no document.body. */
    function pedirSenhaAdm(motivo) {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'opme-modal-overlay';
        overlay.innerHTML = `
          <div class="opme-modal opme-modal-senha">
            <div class="opme-modal-head">
              <h3>🔒 Senha do administrador</h3>
              <button class="opme-modal-fechar" aria-label="Fechar">✕</button>
            </div>
            <div class="opme-modal-body">
              <div class="opme-modal-explica">${escapeHTML(motivo || 'Esta ação exige a senha do administrador.')}</div>
              <div class="opme-modal-campo">
                <label for="opme-senha-input">Senha do administrador</label>
                <input type="password" id="opme-senha-input" autocomplete="current-password" placeholder="••••••••">
              </div>
              <div class="opme-senha-erro" id="opme-senha-erro" hidden>Senha incorreta. Tente novamente.</div>
            </div>
            <div class="opme-modal-footer">
              <span></span>
              <div style="display: flex; gap: 8px">
                <button class="btn" id="opme-senha-cancel">Cancelar</button>
                <button class="btn btn-primary" id="opme-senha-ok">Confirmar</button>
              </div>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('#opme-senha-input');
        const erro = overlay.querySelector('#opme-senha-erro');
        let resolvido = false;
        const fechar = (ok) => {
          if (resolvido) return;
          resolvido = true;
          overlay.remove();
          document.removeEventListener('keydown', esc);
          resolve(!!ok);
        };
        const tentar = async () => {
          const senha = input.value || '';
          let ok = false;
          try { ok = (typeof Auth !== 'undefined' && Auth.verificarSenha) ? await Auth.verificarSenha(senha) : false; }
          catch (e) { ok = false; }
          if (ok) fechar(true);
          else { erro.hidden = false; input.value = ''; input.focus(); }
        };
        overlay.querySelector('.opme-modal-fechar').addEventListener('click', () => fechar(false));
        overlay.querySelector('#opme-senha-cancel').addEventListener('click', () => fechar(false));
        overlay.querySelector('#opme-senha-ok').addEventListener('click', tentar);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(false); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tentar(); } });
        function esc(e) { if (e.key === 'Escape') fechar(false); }
        document.addEventListener('keydown', esc);
        setTimeout(() => input.focus(), 50);
      });
    }

    // ── EXPORTAÇÃO (Glosas / Repasse / Produção) ─────────────────────────
    // 3 arquivos Excel separados, cada um com aba Detalhe (linha a linha) +
    // aba Resumo (por médico). Respeita a competência (state.mes/state.ano)
    // e os mesmos filtros de texto dos cards (filtrarPorCampos). Os números
    // batem com os cards: glosa = recebido<=0 (excl. EV/Particular, 1× por
    // admissão+procedimento, valor=produzido); repasse = analisarLinhaQvis
    // das linhas pagas (calc.repasse); produção = soma de valor da Produção.
    function _r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

    function _ctxExport() {
      return {
        pagamentos: carregarPagamentos(),
        cfg: lerConfig(),
        evsPorAdmissao: carregarTodosEvs(),
        subsPorChave: carregarTodasSubstituicoes(),
      };
    }

    function _dadosExportComp() {
      const state = window.__opme;
      const cfg = lerConfig();
      const termos = cfg.termos.filter(t => t.ativo).map(t => t.termo);
      const qvis = filtrarPorCampos(carregarQvis(termos, state.mes, state.ano) || [], state, true);
      const prod = filtrarPorCampos(carregarProducao(termos, state.mes, state.ano) || [], state, false);
      const comp = (state.mes && state.ano) ? `${state.ano}-${String(state.mes).padStart(2, '0')}` : 'todos';
      return { qvis, prod, comp };
    }

    // V691: dados IDÊNTICOS aos da tela — o MESMO _prepararDadosOpme que monta
    // as duas matrizes (inclusive "Ocultar pagas" e produtos ocultos). A
    // extração vira o espelho 1:1 do que está visível.
    function _dadosMatrizTela() {
      const state = window.__opme;
      const cfg = lerConfig();
      const termosAtivos = cfg.termos.filter(t => t.ativo).map(t => t.termo);
      const d = _prepararDadosOpme(state, termosAtivos);
      const comp = (state.mes && state.ano) ? `${state.ano}-${String(state.mes).padStart(2, '0')}` : 'todos';
      return { ...d, cfg, comp };
    }

    function _resumoPorMedico(porMed, rotuloTotal) {
      const res = [['Médico', 'Qtd admissões', rotuloTotal]];
      let tq = 0, tv = 0;
      [...porMed.entries()].sort((a, b) => b[1].v - a[1].v).forEach(([med, r]) => {
        res.push([med, r.q.size, _r2(r.v)]); tq += r.q.size; tv += r.v;
      });
      res.push(['TOTAL', tq, _r2(tv)]);
      return res;
    }

    function _gerarGlosas(qvis) {
      const det = [['Médico', 'Admissão', 'Paciente', 'Convênio', 'OPME', 'Qtd', 'Produzido', 'Recebido']];
      const visto = new Set(); const porMed = new Map();
      for (const l of qvis) {
        const ehPart = String(l.origem || '').toUpperCase() === 'PARTICULAR'
          || String(l.tipo_recebimento || '').toUpperCase().indexOf('PART') >= 0;
        if (l.eh_ev || ehPart || (Number(l.recebido) || 0) > 0) continue;
        const adm = String(l.admissao || '').trim();
        const key = `${adm}|${String(l.procedimento || '').trim()}`;
        if (visto.has(key)) continue; visto.add(key);
        const v = _r2(l.produzido); const med = l.nome_profissional || '—';
        det.push([med, l.admissao || '', l.paciente || '', l.convenio || '', l.procedimento || '', Number(l.quantidade) || 0, v, _r2(l.recebido)]);
        const r = porMed.get(med) || { q: new Set(), v: 0 }; if (adm) r.q.add(adm); r.v += v; porMed.set(med, r);
      }
      return { det, res: _resumoPorMedico(porMed, 'Total glosado') };
    }

    // V691: extração = a MATRIZ da tela, coluna a coluna e linha a linha.
    // Mesmas colunas do Relatório QVIS (Pago · Data · Admissão · Paciente ·
    // Procedimento · Médico · Qtd · Valor real · Valor · Repasse), mesma ordem
    // das linhas, MESMOS filtros (inclusive "Ocultar pagas") — e as colunas
    // complementares (%/Convênio/Relatório/Substituído de) vêm DEPOIS.
    function _gerarRepasse(d) {
      const ctx = { pagamentos: d.pagamentos, cfg: d.cfg, evsPorAdmissao: d.evsPorAdmissao, subsPorChave: d.subsPorChave };
      const det = [['Pago', 'Data', 'Admissão', 'Paciente', 'Procedimento', 'Médico', 'Qtd', 'Valor real', 'Valor', 'Repasse', '%', 'Convênio', 'Relatório', 'Substituído de']];
      const porMed = new Map();
      let tReal = 0, tBase = 0, tRep = 0;
      for (const l of d.qvisFiltrado) {
        let a; try { a = analisarLinhaQvis(l, ctx); } catch (e) { continue; }
        if (!a) continue;
        // a célula "Pago" da tela (checkbox + selos) vira texto
        const pagoTxt = a.bloqueadaPorEv ? `PAGO EV (${a.evDessaAdm ? formatarMesExtensoCurto(a.evDessaAdm.competencia) : ''})`
          : a.ehEv ? 'EV — pago antecipado'
          : a.duplicidade ? `PAGO — VERIFICAR (${a.todosRelatoriosPagos.size} relatórios)`
          : a.ehPago ? `PAGO ${formatarData(a.pago.data)}`
          : (a.calc && a.calc.recebidoZero) ? 'RECEBIDO ZERADO'
          : '';
        const rep = _r2(a.calc && a.calc.repasse);
        const med = a.nomeMedicoEfetivo || l.nome_profissional || '—';
        det.push([pagoTxt, l.data_admissao ? formatarData(l.data_admissao) : '', l.admissao || '', l.paciente || '',
          l.procedimento || '', med, Number(l.quantidade) || 0,
          _r2(a.fix && a.fix.original), _r2(a.fix && a.fix.base), rep,
          Number(a.calc && a.calc.pct) || 0, l.convenio || '', a.codRel || '',
          a.foiSubstituido ? (a.nomeOriginal || '') : '']);
        tReal += _r2(a.fix && a.fix.original); tBase += _r2(a.fix && a.fix.base); tRep += rep;
        const adm = String(a.adm || l.admissao || '').trim();
        const r = porMed.get(med) || { q: new Set(), pago: 0, ev: 0, aguarda: 0 };
        if (adm) r.q.add(adm);
        if (a.bloqueadaPorEv || a.ehEv) r.ev += rep;
        else if (a.duplicidade) { /* suspenso até verificação — não soma */ }
        else if (a.ehPago) r.pago += rep;
        else if (!(a.calc && a.calc.recebidoZero)) r.aguarda += rep;
        porMed.set(med, r);
      }
      det.push(['TOTAL', '', '', '', '', '', '', _r2(tReal), _r2(tBase), _r2(tRep), '', '', '', '']);
      const res = [['Médico', 'Qtd admissões', 'Repassado (PAGO)', 'EV antecipado', 'Aguardando pagamento']];
      let tq = 0, tp = 0, te = 0, ta = 0;
      [...porMed.entries()].sort((x, y) => (y[1].pago + y[1].ev + y[1].aguarda) - (x[1].pago + x[1].ev + x[1].aguarda)).forEach(([med, r]) => {
        res.push([med, r.q.size, _r2(r.pago), _r2(r.ev), _r2(r.aguarda)]);
        tq += r.q.size; tp += r.pago; te += r.ev; ta += r.aguarda;
      });
      res.push(['TOTAL', tq, _r2(tp), _r2(te), _r2(ta)]);
      return { det, res };
    }

    // V691: espelho da matriz da PRODUÇÃO (lado direito) — mesmas colunas
    // (Pago · Data · Admissão · Paciente · Produto · Cirurgião · Qtd · Valor ·
    // Pago em · Valor pago), mesmas linhas e filtros da tela.
    function _gerarProducao(d) {
      const { porAdmissao } = d.pagamentos;
      const det = [['Pago', 'Data', 'Admissão', 'Paciente', 'Produto', 'Cirurgião', 'Qtd', 'Valor', 'Pago em', 'Valor pago', 'Convênio']];
      const porMed = new Map();
      let tVal = 0;
      for (const l of d.prodFiltrado) {
        const adm = String(l.cod_admissao || '').trim();
        const rels = porAdmissao.get(adm) || new Set();
        const pagoTxt = rels.size > 1 ? `PAGO — VERIFICAR (${rels.size} relatórios)` : (rels.size ? 'PAGO' : '');
        const ev = d.evsPorAdmissao ? d.evsPorAdmissao.get(adm) : null;
        const med = l.cirurgiao || l.medico || '—';
        const v = _r2(l.valor);
        det.push([pagoTxt, l.data_admissao ? formatarData(l.data_admissao) : '', adm, l.paciente || '',
          l.produto || l.procedimento_principal || '', med, Number(l.quantidade) || 0, v,
          ev ? formatarMesExtensoCurto(ev.competencia) : '', ev ? _r2(ev.repasse_calculado) : '', l.convenio || '']);
        tVal += v;
        const r = porMed.get(med) || { q: new Set(), v: 0 }; if (adm) r.q.add(adm); r.v += v; porMed.set(med, r);
      }
      det.push(['TOTAL', '', '', '', '', '', '', _r2(tVal), '', '', '']);
      return { det, res: _resumoPorMedico(porMed, 'Total produzido') };
    }

    function exportarOpme(tipo) {
      if (typeof XLSX === 'undefined') { console.warn('[OPME] XLSX não carregado'); return; }
      let pacote, nome, comp;
      if (tipo === 'glosas') {
        const dg = _dadosExportComp();
        pacote = _gerarGlosas(dg.qvis); nome = 'Glosas'; comp = dg.comp;
      } else if (tipo === 'repasse' || tipo === 'producao') {
        // V691: repasse/produção saem do MESMO pipeline da tela (matriz 1:1)
        const d = _dadosMatrizTela();
        comp = d.comp;
        if (tipo === 'repasse') { pacote = _gerarRepasse(d); nome = 'Repasse'; }
        else { pacote = _gerarProducao(d); nome = 'Producao'; }
      }
      else return;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pacote.det), 'Detalhe');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pacote.res), 'Resumo');
      XLSX.writeFile(wb, `OPME_${nome}_${comp}.xlsx`);
    }

    // V716: saiu o modal em grade — menu no padrão da ferramenta (modelo LIO,
    // Utilidades.abrirMenuExportar). Cada arquivo sai com abas Detalhe+Resumo;
    // Repasse e Produção são o espelho 1:1 das matrizes da tela.
    function abrirSeletorExport() {
      const state = window.__opme;
      const compTxt = (state.mes && state.ano)
        ? `${MESES_EXTENSO[parseInt(state.mes, 10) - 1] || state.mes}/${state.ano}`
        : 'todos os meses';
      const btn = document.getElementById('opme-btn-exportar');
      Utilidades.abrirMenuExportar(btn, [
        { icone: '⚠', titulo: 'Glosas', sub: 'Recebido ≤ 0 (Convênio/SUS)', tom: 'vermelho',
          onClick: () => exportarOpme('glosas') },
        { icone: '$', titulo: 'Repasse', sub: 'A matriz do Relatório QVIS, tal como está na tela',
          onClick: () => exportarOpme('repasse') },
        { icone: '▤', titulo: 'Produção', sub: 'A matriz da Produção, tal como está na tela', tom: 'conv',
          onClick: () => exportarOpme('producao') },
        'sep',
        { icone: '⊞', titulo: 'Os três', sub: `Baixa os 3 arquivos (${compTxt}) — abas Detalhe + Resumo`, tom: 'verde',
          onClick: () => { exportarOpme('glosas'); exportarOpme('repasse'); exportarOpme('producao'); } },
      ]);
    }

    function abrirModalTrocarMedico(dados) {
      const { admissao, codRel, papel, nomeOriginal } = dados;
      const cfg = lerConfig();
      const subsAtual = Banco.queryUnica(`
        SELECT * FROM opme_substituicao_medico
         WHERE admissao = ? AND codigo_relatorio = ? AND papel = ?
      `, [admissao, codRel, papel]);
      const nomeAtual = subsAtual ? subsAtual.nome_substituto : nomeOriginal;

      const sugeridos = listarMedicosSugeridos();
      const overlay = document.createElement('div');
      overlay.className = 'opme-modal-overlay';
      overlay.innerHTML = `
        <div class="opme-modal opme-modal-trocar-medico">
          <div class="opme-modal-head">
            <h3>↻ Trocar médico do repasse</h3>
            <button class="opme-modal-fechar" aria-label="Fechar">✕</button>
          </div>
          <div class="opme-modal-body">
            <div class="opme-modal-trocar-info">
              <div class="opme-modal-trocar-row">
                <span class="opme-modal-label">Admissão</span>
                <span class="mono">${escapeHTML(admissao)}</span>
              </div>
              <div class="opme-modal-trocar-row">
                <span class="opme-modal-label">Relatório</span>
                <span class="mono">${escapeHTML(codRel)}</span>
              </div>
              <div class="opme-modal-trocar-row">
                <span class="opme-modal-label">Papel</span>
                <span>${escapeHTML(papel || '—')}</span>
              </div>
              <div class="opme-modal-trocar-row">
                <span class="opme-modal-label">Médico atual</span>
                <strong>${escapeHTML(nomeAtual || '—')}</strong>
              </div>
              ${subsAtual ? `
                <div class="opme-modal-trocar-row" style="color: var(--ink-faint); font-size: 11px">
                  <span class="opme-modal-label">Original</span>
                  <s>${escapeHTML(nomeOriginal || '—')}</s>
                </div>
              ` : ''}
            </div>

            <div class="opme-modal-explica">
              O repasse será redirecionado pro médico escolhido. O cálculo do %
              passa a usar a regra específica desse médico (se houver) ou a
              regra geral. A alteração vale apenas pra esta linha.
            </div>

            <div class="opme-modal-campo">
              <label for="opme-trocar-input">Buscar ou digitar nome</label>
              <input type="text" id="opme-trocar-input" autocomplete="off"
                     placeholder="Digite ou escolha da lista abaixo..."
                     value="">
            </div>

            <div class="opme-modal-medicos-lista" id="opme-medicos-lista">
              ${sugeridos.length === 0
                ? '<div class="opme-prod-popover-vazio">Nenhum médico cadastrado ainda.</div>'
                : sugeridos.map(nm => {
                    const norm = chaveMedicoCanonica(nm);
                    const temRegra = cfg.regrasMedico.has && cfg.regrasMedico.has(norm);
                    const pct = temRegra ? cfg.regrasMedico.get(norm).pct : cfg.pctGeral;
                    const tagRegra = temRegra
                      ? `<span class="opme-medicos-tag-regra">${fmt(pct, 2)}%</span>`
                      : `<span class="opme-medicos-tag-geral">geral ${fmt(pct, 2)}%</span>`;
                    return `<button class="opme-medico-opcao" data-nome="${escapeHTML(nm)}">
                      <span class="opme-medico-opcao-nome">${escapeHTML(CodigoMedico.exibir(nm))}</span>
                      ${tagRegra}
                    </button>`;
                  }).join('')
              }
            </div>
          </div>
          <div class="opme-modal-footer">
            ${subsAtual ? `<button class="btn opme-modal-desfazer" id="opme-trocar-restaurar">↺ Restaurar original</button>` : '<span></span>'}
            <div style="display: flex; gap: 8px">
              <button class="btn" id="opme-trocar-cancel">Cancelar</button>
              <button class="btn btn-primary" id="opme-trocar-ok" disabled>Aplicar substituição</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const fechar = () => overlay.remove();
      overlay.querySelector('.opme-modal-fechar').addEventListener('click', fechar);
      overlay.querySelector('#opme-trocar-cancel').addEventListener('click', fechar);
      overlay.addEventListener('click', e => { if (e.target === overlay) fechar(); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', esc); }
      });

      const input = overlay.querySelector('#opme-trocar-input');
      const btnOk = overlay.querySelector('#opme-trocar-ok');
      const lista = overlay.querySelector('#opme-medicos-lista');
      input.focus();

      const atualizarBtnOk = () => {
        const valor = input.value.trim();
        btnOk.disabled = !valor || valor === nomeAtual;
      };
      input.addEventListener('input', () => {
        atualizarBtnOk();
        // Filtra a lista
        const termo = normalizarNomeMed(input.value);
        lista.querySelectorAll('.opme-medico-opcao').forEach(b => {
          const nm = b.dataset.nome;
          b.style.display = (!termo || normalizarNomeMed(nm).includes(termo)) ? '' : 'none';
        });
      });

      // Click numa opção da lista preenche o input
      lista.querySelectorAll('.opme-medico-opcao').forEach(b => {
        b.addEventListener('click', () => {
          input.value = b.dataset.nome;
          atualizarBtnOk();
        });
      });

      btnOk.addEventListener('click', async () => {
        const novoNome = input.value.trim();
        if (!novoNome) return;
        await substituirMedico(admissao, codRel, papel, nomeOriginal, novoNome);
        fechar();
        Utilidades.toast(`✓ Repasse redirecionado para ${novoNome}`, 'success', 2400);
        renderizar();
      });

      const btnRest = overlay.querySelector('#opme-trocar-restaurar');
      if (btnRest) {
        btnRest.addEventListener('click', async () => {
          await restaurarMedicoOriginal(admissao, codRel, papel);
          fechar();
          Utilidades.toast(`Médico original restaurado`, 'info', 2200);
          renderizar();
        });
      }
    }

    /**
     * Modal de seleção de EVs (Espaço Verde — repasse antecipado).
     * Lista todas as admissões da Produção QVIS do mês filtrado e
     * permite marcar via checkbox quais devem ser COPIADAS pro Relatório
     * QVIS como repasse antecipado.
     */
    function abrirModalSelecaoEv() {
      const state = window.__opme;
      if (!state.mes || !state.ano) {
        Utilidades.toast('Filtre um mês e ano primeiro', 'error', 2400);
        return;
      }
      const competencia = `${state.ano}-${state.mes}`;
      const cfg = lerConfig();
      const termosAtivos = listarTermosAtivos();
      const linhasProducao = carregarProducao(termosAtivos, state.mes, state.ano);

      // Filtrar admissões que JÁ têm EV (não pode duplicar)
      const evsExistentes = carregarTodosEvs();
      const elegiveis = linhasProducao.filter(lp =>
        !evsExistentes.has(String(lp.cod_admissao || '').trim())
      );
      const jaEv = linhasProducao.length - elegiveis.length;

      if (elegiveis.length === 0) {
        const msg = jaEv > 0
          ? `Todas as ${linhasProducao.length} admissões da Produção QVIS de ${formatarMesExtenso(competencia)} já estão marcadas como EV.`
          : `Nenhuma admissão OPME na Produção QVIS de ${formatarMesExtenso(competencia)}.`;
        Utilidades.toast(msg, 'info', 3000);
        return;
      }

      // V899: quantas linhas de Produção cada admissão tem entre as elegíveis
      const linhasPorAdm = new Map();
      for (const lp of elegiveis) {
        const a = String(lp.cod_admissao || '').trim();
        linhasPorAdm.set(a, (linhasPorAdm.get(a) || 0) + 1);
      }

      const overlay = document.createElement('div');
      overlay.className = 'opme-modal-overlay';
      overlay.innerHTML = `
        <div class="opme-modal opme-modal-ev">
          <div class="opme-modal-head opme-modal-head-ev">
            <h3>✚ Repasse Antecipado (EV — Espaço Verde)</h3>
            <button class="opme-modal-fechar" aria-label="Fechar">✕</button>
          </div>
          <div class="opme-modal-body">
            <div class="opme-modal-ev-info">
              <strong>Competência:</strong> ${formatarMesExtenso(competencia)} ·
              <strong>Admissões elegíveis:</strong> ${linhasPorAdm.size}${linhasPorAdm.size !== elegiveis.length ? ` (${elegiveis.length} OPMEs)` : ''}
              ${jaEv > 0 ? ` · <span style="color: #8A4F2A">${jaEv} já marcadas como EV (ocultadas)</span>` : ''}
            </div>
            <div class="opme-modal-ev-explica">
              Marque as admissões que foram <strong>pagas antes do recebimento</strong> do convênio.
              Cada admissão marcada vira uma cópia no Relatório QVIS deste mês com tag <strong>EV</strong>
              em amarelo ouro. O cálculo do repasse usa o valor produzido × % do médico (regra específica
              ou geral). A admissão na Produção QVIS não é alterada.
            </div>

            <div class="opme-modal-ev-acoes">
              <button class="opme-prod-popover-link" id="opme-ev-todos">Selecionar todos</button>
              <span>·</span>
              <button class="opme-prod-popover-link" id="opme-ev-nenhum">Limpar seleção</button>
              <span class="opme-modal-ev-contador" id="opme-ev-contador">0 selecionadas</span>
            </div>

            <div class="opme-modal-ev-lista">
              ${elegiveis.map((lp, idx) => {
                const adm = String(lp.cod_admissao || '').trim();
                const nomeMed = lp.cirurgiao || lp.medico || '';
                const pct = pctParaMedico(nomeMed, cfg);
                const valor = Number(lp.valor) || 0;
                const repasse = valor * (pct / 100);
                /* V899: a mesma admissão pode ter VÁRIOS OPMEs na Produção
                   (ex.: o SERVIÇO com valor e o material a R$ 0). Cada linha
                   é um candidato próprio — o EV é 1 por admissão, então
                   marcar uma linha desmarca a irmã, e a que fica marcada é
                   EXATAMENTE a que vira o EV. */
                const irmas = (linhasPorAdm.get(adm) || 1) - 1;
                return `
                  <label class="opme-modal-ev-item">
                    <input type="checkbox" class="opme-modal-ev-chk" data-admissao="${escapeHTML(adm)}" data-idx="${idx}">
                    <div class="opme-modal-ev-item-info">
                      <div class="opme-modal-ev-item-linha1">
                        <span class="mono opme-modal-ev-data">${formatarData(lp.data_admissao)}</span>
                        <span class="mono opme-modal-ev-adm">${escapeHTML(adm)}</span>
                        <strong>${escapeHTML(lp.paciente || '—')}</strong>
                      </div>
                      <div class="opme-modal-ev-item-linha2">
                        <span class="opme-modal-ev-produto">${escapeHTML(lp.produto || '—')}</span>
                        <span class="opme-modal-ev-medico">${escapeHTML(nomeMed || '—')}</span>
                        ${irmas > 0 ? `<span class="opme-modal-ev-multi" title="Esta admissão tem ${irmas + 1} OPMEs na Produção. O EV é um só por admissão: marque a linha do OPME certo — é o VALOR dela que vai pro Relatório QVIS.">+${irmas} OPME nesta admissão — marque a linha certa</span>` : ''}
                      </div>
                      <div class="opme-modal-ev-item-linha3">
                        <span>Valor: <strong class="mono">R$ ${fmt(valor, 2)}</strong></span>
                        <span>%: <strong>${fmt(pct, 2)}%</strong></span>
                        <span>Repasse: <strong class="mono atlas-rep">R$ ${fmt(repasse, 2)}</strong></span><!-- V962 -->
                      </div>
                    </div>
                  </label>
                `;
              }).join('')}
            </div>
          </div>
          <div class="opme-modal-footer">
            <button class="btn" id="opme-modal-cancel">Cancelar</button>
            <button class="btn btn-primary" id="opme-modal-ok" disabled>Criar cópias no Relatório QVIS</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const fechar = () => overlay.remove();
      overlay.querySelector('.opme-modal-fechar').addEventListener('click', fechar);
      overlay.querySelector('#opme-modal-cancel').addEventListener('click', fechar);
      overlay.addEventListener('click', e => { if (e.target === overlay) fechar(); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', esc); }
      });

      const contador = overlay.querySelector('#opme-ev-contador');
      const btnOk = overlay.querySelector('#opme-modal-ok');
      const atualizarContador = () => {
        const sel = overlay.querySelectorAll('.opme-modal-ev-chk:checked').length;
        contador.textContent = `${sel} selecionada${sel !== 1 ? 's' : ''}`;
        btnOk.disabled = sel === 0;
      };

      overlay.querySelectorAll('.opme-modal-ev-chk').forEach(chk => {
        chk.addEventListener('change', () => {
          // V899: o EV é 1 por admissão — marcar uma linha desmarca a irmã
          // (mesma admissão), pra ficar EXPLÍCITO qual valor vira o EV.
          if (chk.checked) {
            overlay.querySelectorAll(
              `.opme-modal-ev-chk[data-admissao="${CSS.escape(chk.dataset.admissao)}"]:checked`
            ).forEach(outra => { if (outra !== chk) outra.checked = false; });
          }
          atualizarContador();
        });
      });
      overlay.querySelector('#opme-ev-todos').addEventListener('click', () => {
        // V899: nas admissões com mais de um OPME, o "todos" marca a linha de
        // MAIOR valor (a irmã a R$ 0 costuma ser o desdobramento do material)
        const melhorPorAdm = new Map();
        elegiveis.forEach((lp, idx) => {
          const a = String(lp.cod_admissao || '').trim();
          const atual = melhorPorAdm.get(a);
          if (!atual || (Number(lp.valor) || 0) > (Number(atual.valor) || 0)) {
            melhorPorAdm.set(a, { idx, valor: Number(lp.valor) || 0 });
          }
        });
        const marcar = new Set([...melhorPorAdm.values()].map(m => m.idx));
        overlay.querySelectorAll('.opme-modal-ev-chk').forEach(c => {
          c.checked = marcar.has(Number(c.dataset.idx));
        });
        atualizarContador();
      });
      overlay.querySelector('#opme-ev-nenhum').addEventListener('click', () => {
        overlay.querySelectorAll('.opme-modal-ev-chk').forEach(c => c.checked = false);
        atualizarContador();
      });

      btnOk.addEventListener('click', async () => {
        /* V899: o EV nasce da LINHA marcada, não da admissão. Antes, marcar
           qualquer linha levava TODAS as linhas da admissão pro lote, e o
           INSERT OR REPLACE (admissão é chave única) deixava valer a ÚLTIMA
           — numa admissão com o serviço a R$ 14.175 e o material a R$ 0,
           escolher o com valor gravava o EV zerado. */
        const aCriar = [...overlay.querySelectorAll('.opme-modal-ev-chk:checked')]
          .map(c => elegiveis[Number(c.dataset.idx)])
          .filter(Boolean);
        if (aCriar.length === 0) return;
        btnOk.disabled = true;
        btnOk.textContent = 'Criando...';
        try {
          await criarEvsEmLote(aCriar, competencia);
          fechar();
          Utilidades.toast(`✓ ${aCriar.length} admissões copiadas como EV em ${formatarMesExtenso(competencia)}`, 'success', 2800);
          renderizar();
        } catch (e) {
          console.error(e);
          Utilidades.toast(`Erro ao criar EVs: ${e.message}`, 'error', 3000);
          btnOk.disabled = false;
          btnOk.textContent = 'Criar cópias no Relatório QVIS';
        }
      });
    }

    /**
     * Modal de DETALHES quando o usuário clica em VERIFICAR (duplicidade
     * confirmada — admissão tem pagamentos em 2+ codigo_relatorio).
     * Permite remover cada pagamento individualmente.
     */
    function abrirModalPagamentoOutro(admissao) {
      let pagamentos = [];
      let linha = null;
      try {
        pagamentos = Banco.query(`
          SELECT admissao, codigo_relatorio, competencia, data_admissao,
                 data_pagamento, observacao, criado_em
            FROM opme_pagamentos WHERE admissao = ?
           ORDER BY criado_em
        `, [String(admissao).trim()]) || [];
      } catch (e) { console.warn(e); }
      try {
        linha = Banco.queryUnica(`
          SELECT admissao, competencia, paciente, procedimento,
                 nome_profissional, produzido, recebido, repassado, data_admissao
            FROM linhas_qvis
           WHERE admissao = ?
             AND classificacao_produto LIKE '%OPME%'
           ORDER BY id DESC LIMIT 1
        `, [String(admissao).trim()]);
      } catch (e) { console.warn(e); }

      if (pagamentos.length === 0) {
        Utilidades.toast('Detalhes do pagamento não encontrados', 'error');
        return;
      }

      const overlay = document.createElement('div');
      overlay.className = 'opme-modal-overlay opme-modal-overlay-outro';
      overlay.innerHTML = `
        <div class="opme-modal opme-modal-outro">
          <div class="opme-modal-head opme-modal-head-outro">
            <h3>⚠ Duplicidade — Verificar</h3>
            <button class="opme-modal-fechar" aria-label="Fechar">✕</button>
          </div>
          <div class="opme-modal-body">
            <div class="opme-modal-adm">
              <span class="opme-modal-label">Admissão</span>
              <span class="opme-modal-valor mono">${escapeHTML(admissao)}</span>
            </div>
            <div class="opme-modal-adm">
              <span class="opme-modal-label">Data da admissão</span>
              <span class="opme-modal-valor mono">${escapeHTML(formatarData(linha?.data_admissao || pagamentos[0]?.data_admissao))}</span>
            </div>

            ${linha ? `
              <div class="opme-modal-paciente">
                <span class="opme-modal-label">Paciente</span>
                <strong>${escapeHTML(linha.paciente || '—')}</strong>
                <small>${escapeHTML(linha.procedimento || '')}</small>
              </div>
            ` : ''}

            <div class="opme-modal-alerta-outro">
              Esta admissão tem <strong>${pagamentos.length} pagamentos</strong>
              registrados em relatórios diferentes. Confira abaixo e remova os que
              estiverem incorretos.
              <br><br>
              <strong>⚠ Repasse suspenso</strong> em todas as linhas dessa admissão até
              que a duplicidade seja resolvida.
            </div>

            <div>
              <span class="opme-modal-label" style="display: block; margin-bottom: 6px">Pagamentos registrados:</span>
              <ul class="opme-dup-lista">
                ${pagamentos.map(p => `
                  <li class="opme-dup-item">
                    <div class="opme-dup-info">
                      <strong>Relatório ${escapeHTML(p.codigo_relatorio || '—')}</strong>
                      <small>Competência: <span class="mono">${escapeHTML(formatarMesExtenso(p.competencia))}</span></small>
                      <small>Pago em: <span class="mono">${formatarData(p.data_pagamento)}</span></small>
                      ${p.observacao ? `<small>Obs: ${escapeHTML(p.observacao)}</small>` : ''}
                    </div>
                    <button class="btn opme-modal-desfazer opme-dup-remover" data-cod-rel="${escapeHTML(p.codigo_relatorio)}">
                      ↶ Remover
                    </button>
                  </li>
                `).join('')}
              </ul>
            </div>

            ${linha ? `
              <div class="opme-modal-valores">
                <div class="opme-modal-valor-item">
                  <span class="opme-modal-label">Produzido</span>
                  <strong class="mono">R$ ${fmt(linha.produzido, 2)}</strong>
                </div>
                <div class="opme-modal-valor-item">
                  <span class="opme-modal-label">Repassado</span>
                  <strong class="mono">R$ ${fmt(linha.repassado, 2)}</strong>
                </div>
              </div>
            ` : ''}
          </div>
          <div class="opme-modal-footer">
            <button class="btn btn-primary" id="opme-modal-fechar-outro">Fechar</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const fechar = () => overlay.remove();
      overlay.querySelector('.opme-modal-fechar').addEventListener('click', fechar);
      overlay.querySelector('#opme-modal-fechar-outro').addEventListener('click', fechar);
      overlay.addEventListener('click', e => { if (e.target === overlay) fechar(); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', esc); }
      });

      overlay.querySelectorAll('.opme-dup-remover').forEach(btn => {
        btn.addEventListener('click', async () => {
          const codRel = btn.dataset.codRel;
          const ok = await pedirSenhaAdm(`Remover o pagamento do relatório ${codRel} exige a senha do administrador.`);
          if (ok) {
            await desmarcarPago(admissao, codRel);
            fechar();
            Utilidades.toast(`Pagamento do relatório ${codRel} removido`, 'info', 2400);
            renderizar();
          }
        });
      });
    }

    /**
     * Aviso DIDÁTICO antes de marcar: se a admissão já está paga em outro
     * código de relatório, mostra alerta de duplicidade e pede confirmação.
     */
    function abrirModalAvisoDuplicidade(admissao, codRelNovo, outrosCodRel, pagamentos, dataAdm, comp) {
      return new Promise(resolve => {
        const itensPag = outrosCodRel.map(cr => {
          const p = pagamentos.porChave.get(`${admissao}|${cr}`);
          if (!p) return '';
          const compTxt = p.competencia ? formatarMesExtenso(p.competencia) : '—';
          return `<li>
            <strong>Relatório ${escapeHTML(cr)}</strong>
            <small> · ${escapeHTML(compTxt)} · pago em ${escapeHTML(formatarData(p.data))}</small>
          </li>`;
        }).join('');

        const overlay = document.createElement('div');
        overlay.className = 'opme-modal-overlay opme-modal-overlay-outro';
        overlay.innerHTML = `
          <div class="opme-modal opme-modal-outro">
            <div class="opme-modal-head opme-modal-head-outro">
              <h3>⚠ Possível duplicidade</h3>
              <button class="opme-modal-fechar" aria-label="Fechar">✕</button>
            </div>
            <div class="opme-modal-body">
              <div class="opme-modal-adm">
                <span class="opme-modal-label">Admissão</span>
                <span class="opme-modal-valor mono">${escapeHTML(admissao)}</span>
              </div>
              <div class="opme-modal-adm">
                <span class="opme-modal-label">Data da admissão</span>
                <span class="opme-modal-valor mono">${escapeHTML(formatarData(dataAdm))}</span>
              </div>
              <div class="opme-modal-alerta-outro">
                Esta admissão <strong>já foi paga</strong> em outro(s) relatório(s):
                <ul style="margin: 6px 0 0 14px; padding: 0; font-size: 11.5px; line-height: 1.6">
                  ${itensPag}
                </ul>
              </div>
              <div class="opme-modal-comparativo">
                <div class="opme-modal-comp-bloco opme-modal-comp-pago">
                  <div class="opme-modal-comp-titulo">Relatórios já pagos:</div>
                  <div class="opme-modal-comp-mes mono">${escapeHTML(outrosCodRel.join(', '))}</div>
                </div>
                <div class="opme-modal-comp-seta">⇆</div>
                <div class="opme-modal-comp-bloco opme-modal-comp-atual">
                  <div class="opme-modal-comp-titulo">Você quer marcar:</div>
                  <div class="opme-modal-comp-mes mono">Relatório ${escapeHTML(codRelNovo)}</div>
                  <div class="opme-modal-comp-sub">${escapeHTML(formatarMesExtenso(comp))}</div>
                </div>
              </div>
              <div class="opme-modal-alerta-outro">
                Se confirmar, esta linha será marcada como paga (data atual)
                <strong>e todas as linhas dessa admissão ficarão sinalizadas
                em vermelho com a tag VERIFICAR</strong>. Nenhum repasse será
                calculado até que você esclareça a duplicidade.
              </div>
            </div>
            <div class="opme-modal-footer">
              <button class="btn" id="opme-mdup-cancel">Cancelar — não marcar</button>
              <button class="btn opme-modal-desfazer" id="opme-mdup-ok">Confirmar mesmo assim</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
        const fechar = (ok) => { overlay.remove(); resolve(!!ok); };
        overlay.querySelector('.opme-modal-fechar').addEventListener('click', () => fechar(false));
        overlay.querySelector('#opme-mdup-cancel').addEventListener('click', () => fechar(false));
        overlay.querySelector('#opme-mdup-ok').addEventListener('click', () => fechar(true));
        overlay.addEventListener('click', e => { if (e.target === overlay) fechar(false); });
        document.addEventListener('keydown', function esc(e) {
          if (e.key === 'Escape') { fechar(false); document.removeEventListener('keydown', esc); }
        });
      });
    }

    function abrirModalMarcarPago(admissao, codigoRelatorio) {
      // OBSOLETO: agora o pagamento é gravado direto pelo bind do checkbox
      // com data atual automática (V37). Função mantida vazia caso algo
      // antigo ainda referencie.
      return Promise.resolve(false);
    }

    function garantirEstilosOpme() {
      if (document.getElementById('opme-estilos')) return;
      const css = getStyles().replace(/^[\s\S]*?<style>/, '').replace(/<\/style>[\s\S]*$/, '');
      const el = document.createElement('style');
      el.id = 'opme-estilos';
      el.textContent = css;
      document.head.appendChild(el);
    }

    function getStyles() {
      return `
        <style>
          /* ── Valor fixo de OPME (subfaturamento) ── */
          .opme-vf-nova { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
          .opme-vf-nova > input[type="text"] { flex: 1 1 180px; min-width: 140px; }
          .opme-vf-nova #opme-vf-novo-convenio { flex: 1 1 160px; min-width: 130px; }
          .opme-vf-grupo { margin-top: 10px; }
          .opme-vf-grupo-tit {
            font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
            color: var(--primary, #06283A); opacity: .85; margin-bottom: 5px; padding-bottom: 3px;
            border-bottom: 1px dashed var(--border, #DDE7E3);
          }
          .opme-vf-grupo-tit em { font-style: italic; opacity: .7; text-transform: none; letter-spacing: 0; }
          .opme-vf-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
          .opme-vf-item { display: flex; align-items: center; gap: 8px; }
          .opme-vf-item .opme-vf-padrao { flex: 1 1 auto; min-width: 120px; }
          /* Chips de termos do padrão (estilo igual ao módulo LIO) */
          .opme-vf-chips { flex: 1 1 auto; min-width: 120px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
          .opme-vf-chip {
            display: inline-flex; align-items: center; gap: 3px;
            background: rgba(30, 187, 215,.10); color: var(--primary, #06283A);
            padding: 3px 3px 3px 8px; border-radius: 4px;
            font-size: 11px; font-weight: 600; letter-spacing: .02em;
            border: 1px solid rgba(30, 187, 215,.30); white-space: nowrap;
            transition: background-color 150ms, border-color 150ms;
          }
          .opme-vf-chip:hover { background: rgba(30, 187, 215,.18); border-color: rgba(30, 187, 215,.5); }
          .opme-vf-chip-txt { cursor: text; padding: 0 2px; }
          .opme-vf-chip-txt:hover { text-decoration: underline dotted; }
          .opme-vf-chip-x {
            background: transparent; border: none; color: var(--primary, #06283A);
            cursor: pointer; padding: 0 4px; font-size: 10px; line-height: 1;
            border-radius: 3px; opacity: .55;
            transition: background-color 120ms, color 120ms, opacity 120ms;
          }
          .opme-vf-chip-x:hover { background: rgba(192,57,43,.15); color: var(--danger, #C0392B); opacity: 1; }
          .opme-vf-termo-edit, .opme-vf-termo-novo {
            padding: 3px 8px; font-size: 11px; font-weight: 600; font-family: inherit;
            background: var(--surface, #fff); border: 1px solid #1EBBD7; border-radius: 4px;
            outline: none; color: var(--ink, #06283A); text-transform: uppercase;
            letter-spacing: .02em; min-width: 100px; max-width: 200px;
            box-shadow: 0 0 0 2px rgba(30, 187, 215,.15);
          }
          .opme-vf-chip-add {
            background: transparent; border: 1px dashed var(--border, #D9D2C5);
            color: var(--ink-faint, #8A8270); padding: 3px 9px; border-radius: 4px;
            font-size: 11px; font-weight: 500; font-family: inherit; cursor: pointer;
            white-space: nowrap; transition: background-color 150ms, border-color 150ms, color 150ms;
          }
          .opme-vf-chip-add:hover { border-color: #1EBBD7; border-style: solid; color: var(--primary, #005073); background: rgba(30, 187, 215,.08); }
          /* Tabela de valores fixos (cabeçalho escuro, igual ao LIO) */
          .opme-vf-tabela { width: 100%; border-collapse: collapse; margin-top: 4px; }
          .opme-vf-tabela thead th {
            background: var(--primary, #06283A); color: #fff;
            text-align: left; font-size: 10px; font-weight: 700; letter-spacing: .04em;
            text-transform: uppercase; padding: 7px 10px; white-space: nowrap;
          }
          .opme-vf-tabela thead th:first-child { border-top-left-radius: 6px; }
          .opme-vf-tabela thead th:last-child { border-top-right-radius: 6px; }
          .opme-vf-tabela tbody td { padding: 7px 10px; border-bottom: 1px solid var(--border, #E6E0D5); vertical-align: middle; }
          .opme-vf-tabela tbody tr:last-child td { border-bottom: none; }
          .opme-vf-th-valor, .opme-vf-td-valor { width: 1%; white-space: nowrap; }
          .opme-vf-th-acao, .opme-vf-td-acao { width: 1%; text-align: center; }
          .opme-vf-td-padrao { width: 100%; }
          .opme-vf-valor-wrap { display: inline-flex; align-items: center; gap: 4px; }
          .opme-vf-cifrao { opacity: .55; font-size: 12px; }
          .opme-vf-valor, #opme-vf-novo-valor { width: 110px; text-align: right; }

          /* V375: form de nova entrada (Valor Fixo) — controles UNIFORMES.
             Antes: select 11px custom · input texto nativo do browser · input valor
             em fonte mono (Geist Mono) · botão .btn 13px/padding grande → tudo
             com fonte/altura diferentes. Agora todos: Inter Tight (inherit), 12px,
             34px de altura, mesma borda/raio/fundo. Escopo só no .opme-vf-nova
             (NÃO afeta a tabela de valores cadastrados abaixo). */
          .opme-vf-nova .opme-select,
          .opme-vf-nova > input[type="text"],
          .opme-vf-nova .opme-vf-valor-wrap,
          .opme-vf-nova .btn {
            height: 34px;
            box-sizing: border-box;
            font-family: inherit;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: var(--bg-elevated);
            color: var(--ink);
          }
          .opme-vf-nova .opme-select,
          .opme-vf-nova > input[type="text"],
          .opme-vf-nova .opme-vf-valor-wrap {
            padding: 0 12px;
            outline: none;
            transition: border-color 150ms, box-shadow 150ms;
          }
          .opme-vf-nova .opme-select:focus,
          .opme-vf-nova > input[type="text"]:focus,
          .opme-vf-nova .opme-vf-valor-wrap:focus-within {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(0, 80, 115,0.08);
          }
          .opme-vf-nova .opme-vf-valor-wrap { gap: 5px; }
          .opme-vf-nova .opme-vf-cifrao { font-size: 12px; font-weight: 600; opacity: .5; }
          .opme-vf-nova #opme-vf-novo-valor {
            height: auto; border: none; background: transparent; outline: none;
            font-family: inherit; font-size: 12px; font-weight: 500;
            width: 88px; text-align: right; padding: 0;
          }
          .opme-vf-nova .btn { padding: 0 16px; font-weight: 600; cursor: pointer; white-space: nowrap; }
          .opme-vf-nova .btn:hover { background: var(--bg-sunken); border-color: var(--border-strong); }
          .opme-vf-remover {
            border: none; background: transparent; color: var(--danger, #C0392B);
            cursor: pointer; font-size: 14px; line-height: 1; padding: 4px 6px; border-radius: 6px;
          }
          .opme-vf-remover:hover { background: rgba(192,57,43,.12); }
          .opme-tag-ajustado {
            display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 6px;
            background: rgba(184,150,90,.18); color: var(--accent, #B8965A);
            font-size: 10px; font-weight: 700; letter-spacing: .3px; vertical-align: middle; cursor: help;
          }
          /* V661: a tag virou BOTÃO — clique alterna ajustado ↔ real por linha */
          button.opme-tag-ajustado {
            border: 1px solid rgba(184,150,90,.45); cursor: pointer; font-family: inherit;
          }
          button.opme-tag-ajustado:hover { filter: brightness(0.92); }
          /* V897: sugestão pendente — o clique é o convite ("ajustar ↗") */
          .opme-tag-sugerir {
            background: rgba(184,134,74,.16) !important; color: #8A5E18 !important;
            border-color: rgba(184,134,74,.55) !important;
          }
          .opme-tag-usando-real {
            background: rgba(16,125,172,.14) !important; color: #107DAC !important;
            border-color: rgba(16,125,172,.45) !important;
          }
          .opme-col-real { color: var(--ink-soft); }
          /* V661: chips dos produtos adicionados da Produção (⚙ Ajustes) */
          .opme-extras-lista { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 10px; }
          .opme-extra-chip {
            display: inline-flex; align-items: center; gap: 2px;
            border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
            background: var(--bg-elevated);
          }
          .opme-extra-chip .opme-extra-toggle {
            border: none; background: transparent; cursor: pointer; padding: 4px 4px 4px 10px;
            font-size: 11px; font-weight: 700; color: var(--primary, #005073); font-family: inherit;
          }
          .opme-extra-chip.opme-extra-off .opme-extra-toggle { color: var(--ink-faint); text-decoration: line-through; }
          .opme-extra-chip .opme-extra-rm {
            border: none; background: transparent; cursor: pointer; padding: 4px 8px 4px 2px;
            font-size: 10px; color: var(--ink-faint);
          }
          .opme-extra-chip .opme-extra-rm:hover { color: #C0392B; }
          /* V662: pesquisa em tempo real dos produtos da Produção */
          .opme-add-extra-wrap { position: relative; }
          .opme-extra-ac-wrap { position: relative; flex: 1; }
          .opme-extra-ac-wrap input { width: 100%; box-sizing: border-box; }
          .opme-extra-sug {
            position: absolute; top: calc(100% + 4px); left: 0; right: 0;
            max-height: 260px; overflow-y: auto; z-index: 10001;
            background: var(--bg-elevated); border: 1px solid var(--border);
            border-radius: 8px; box-shadow: 0 10px 26px rgba(0,0,0,0.20);
            display: flex; flex-direction: column;
          }
          .opme-extra-sug-item {
            border: none; background: transparent; cursor: pointer; text-align: left;
            padding: 8px 12px; font-size: 12px; color: var(--ink); font-family: inherit;
          }
          .opme-extra-sug-item:hover { background: rgba(16,125,172,0.08); color: #107DAC; }
          .opme-extra-sug-vazio { padding: 10px 12px; font-size: 11.5px; color: var(--ink-faint); }
          .opme-ev-pagoem {
            display: inline-block; padding: 1px 7px; border-radius: 9px;
            font-size: 10px; font-weight: 700;
            background: rgba(16,125,172,0.12); color: #107DAC;
          }
          /* V663: seções de regra com switch desligado ficam esmaecidas
             (o cadastro continua acessível — só não afeta o cálculo) */
          .opme-secao-inativa > *:not(h4) { opacity: .55; }
          .opme-secao-inativa h4 { color: var(--ink-faint); }
          .opme-ajustes-secao h4 .opme-switch { margin-top: -2px; }
          /* Barra de filtros no header — TODOS os controles com altura
             uniforme de 32px para look coeso. */
          /* ── V720: fileira de filtros 20C (handoff Claude Design) ──
             UMA peça branca com 6 células separadas por hairline; célula com
             filtro aplicado ganha fundo azul-claro + tile tintado + valor 700.
             Sem a régua horizontal antiga: a própria peça delimita a zona. */
          .opme-sb {
            margin-bottom: 14px;   /* V731: respiro antes dos cards */
            position: relative; z-index: 30;
            display: flex; align-items: stretch;
            margin-top: 10px; padding: 6px;
            background: #fff;
            border: 1px solid #e2ebf2;
            border-radius: 12px;
            box-shadow: 0 1px 2px rgba(20,50,80,.04), 0 10px 26px -20px rgba(20,50,80,.26);
            flex-wrap: wrap;
          }
          .opme-sb-celwrap { position: relative; min-width: 150px; display: flex; }
          .opme-sb-celwrap:not(:last-child) .opme-sb-cel { border-right: 1px solid #eef3f7; }
          .opme-sb-cel {
            flex: 1; min-width: 0;
            display: flex; align-items: center; gap: 9px;
            padding: 9px 12px; border: none; border-radius: 9px;
            background: transparent; cursor: pointer;
            font-family: inherit; text-align: left;
            transition: background-color 120ms;
          }
          .opme-sb-cel:hover, .opme-sb-cel.ativo, .opme-sb-cel.aberta { background: #f4fafd; }
          .opme-sb-cel:focus-visible { outline: 2px solid #2f8fc4; outline-offset: 2px; }
          .opme-sb-tile {
            width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
            background: #f0f5f9; color: #5b6c7c;
          }
          .opme-sb-cel.ativo .opme-sb-tile, .opme-sb-cel.aberta .opme-sb-tile { background: #dbeef8; color: #1c6fa8; }
          .opme-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
          .opme-sb-rot {
            font-size: 10px; font-weight: 700; text-transform: uppercase;
            letter-spacing: .09em; color: #5b6c7c; white-space: nowrap;
          }
          .opme-sb-val {
            font-size: 13px; font-weight: 500; color: #4f6274;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          }
          .opme-sb-cel.ativo .opme-sb-val { font-weight: 700; color: #14384f; }
          .opme-sb-chev { color: #7d8fa0; flex-shrink: 0; display: flex; transition: transform 140ms; }
          .opme-sb-cel.aberta .opme-sb-chev { transform: rotate(180deg); }

          /* painel ancorado na célula, por cima dos cards */
          .opme-sb-painel {
            position: absolute; top: 100%; left: 0; margin-top: 6px; z-index: 40;
            min-width: 100%; width: max-content; max-width: 340px;
            background: #fff; border: 1px solid #dfe8f0; border-radius: 12px;
            box-shadow: 0 18px 44px -14px rgba(15,37,68,.42);
            overflow: hidden;
          }
          .opme-sb-buscabox {
            display: flex; align-items: center; gap: 8px;
            padding: 11px 12px 10px; border-bottom: 1px solid #edf2f6;
          }
          .opme-sb-buscabox .opme-sb-busca-ic { color: #6b7d8e; display: flex; }
          .opme-sb-busca {
            flex: 1; height: 30px; border: 1px solid #dfe8f0; border-radius: 8px;
            background: #f7fafc; padding: 0 10px; font-size: 13px;
            font-family: inherit; color: #14384f; outline: none;
          }
          .opme-sb-busca::placeholder { color: #9aabb8; }
          .opme-sb-busca:focus { border-color: #2f8fc4; }
          .opme-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; }
          .opme-sb-lista::-webkit-scrollbar { width: 8px; }
          .opme-sb-lista::-webkit-scrollbar-track { background: #f2f6f9; }
          .opme-sb-lista::-webkit-scrollbar-thumb { background: #c3d5e2; border-radius: 4px; }
          .opme-sb-it {
            display: flex; align-items: center; gap: 10px;
            height: 38px; padding: 0 8px; border-radius: 8px; cursor: pointer;
            font-size: 13px; color: #14384f;
          }
          .opme-sb-it:hover, .opme-sb-it.foco { background: #f2f7fb; }
          .opme-sb-it.sel { background: #eaf4fb; font-weight: 700; }
          .opme-sb-it-todos { font-weight: 700; }
          .opme-sb-it-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .opme-sb-ck { color: #1c6fa8; display: flex; }
          .opme-sb-chip {
            width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
            background: #eaf4fb; color: #1c6fa8; font-size: 9.5px; font-weight: 700;
          }
          .opme-sb-rodape {
            padding: 7px 12px; border-top: 1px solid #edf2f6;
            font-size: 10.5px; font-weight: 600; color: #7d8fa0;
          }
          @media (max-width: 1280px) { .opme-sb-celwrap { flex-basis: 32%; } }
          @media (max-width: 900px)  { .opme-sb-celwrap { flex-basis: 48%; } }
          .opme-header { position: relative; z-index: 5; }
          .opme-filtro-combo {
            min-width: 0; position: relative;
            display: flex; align-items: center;
            height: 38px; padding: 0 8px 0 12px;
            background: var(--bg-elevated);
            border: 1.5px solid var(--border); border-radius: 12px;
            transition: border-color 150ms, box-shadow 150ms;
          }
          .opme-filtro-combo:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(30, 187, 215,.16); }
          .opme-dd-pre {
            flex: none; font-size: 11.5px; color: var(--ink-faint); white-space: nowrap;
          }
          .opme-dd-divr {
            flex: none; width: 1px; height: 18px; background: var(--border); margin: 0 9px;
          }
          .opme-filtro-combo .opme-combo-input {
            flex: 1; min-width: 0; height: auto;
            border: none; background: transparent; box-shadow: none;
            border-radius: 0; padding: 0; font-size: 12.5px;
          }
          .opme-filtro-combo .opme-combo-input:focus { border: none; box-shadow: none; }
          .opme-filtro-combo .opme-combo-clear {
            position: static; transform: none; flex: none; margin-left: 4px;
          }
          .opme-filtro-combo .opme-combo-arrow {
            position: static; transform: none; flex: none; font-size: 16px; margin-left: 2px;
          }
          .opme-filtro-combo .opme-combo-arrow.aberto { transform: rotate(180deg); }
          .opme-filtro-combo .opme-combo-dropdown { border-radius: 12px; padding: 6px; }
          .opme-filtro-combo .opme-combo-opt { border-radius: 9px; padding: 10px 12px; }
          .opme-filtro-combo .opme-combo-opt:hover { background: rgba(30, 187, 215,.14); color: var(--primary); }
          .opme-cards {
            display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 8px; margin: 8px 0 12px; width: 100%; box-sizing: border-box;
          }
          @media (max-width: 900px) { .opme-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
          @media (max-width: 520px) { .opme-cards { grid-template-columns: minmax(0, 1fr); } }
          .opme-card {
            border-radius: 11px; padding: 10px 13px; position: relative; overflow: hidden;
            min-height: 86px; min-width: 0; box-sizing: border-box;
            display: flex; flex-direction: column; gap: 2px;
          }
          .opme-card-titulo {
            font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
            margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          }
          .opme-card-sub { font-weight: 600; }
          .opme-card-valor {
            font-size: 20px; font-weight: 800; line-height: 1.1; letter-spacing: -0.01em;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
          }
          .opme-card-comp { margin-top: auto; display: flex; flex-direction: column; gap: 3px; font-size: 9px; }
          .opme-card-comp-linha { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
          .opme-card-comp-lbl { font-weight: 600; }
          .opme-card-comp-badge { font-weight: 700; padding: 0 1px; white-space: nowrap; }
          /* card Quantidade/Glosas: dois blocos, mesma linguagem */
          .opme-card-qtd-dupla { display: flex; gap: 10px; flex: 1; margin-top: 1px; }
          .opme-card-qtd-bloco { flex: 1; min-width: 0; display: flex; flex-direction: column; }
          .opme-card-qtd-sep { width: 1px; background: var(--border, #DEE3E1); }
          .opme-card-qtd-rotulo { font-size: 8.5px; text-transform: uppercase; letter-spacing: .05em; font-weight: 700; margin-bottom: 2px; color: #0F6E56; }
          .opme-card-valor-mini { font-size: 17px; font-weight: 800; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .opme-card-glosas .opme-card-valor-mini { font-size: 15px; }
          /* Valor da glosa precisa de mais espaço que "Admissões" (nº curto) — evita corte do R$ */
          .opme-card-glosas .opme-card-qtd-bloco:first-child { flex: 1.8; }
          .opme-card-glosas .opme-card-qtd-bloco:last-child  { flex: 1; }
          /* Glosas em VERMELHO (algo não recebido) — vence o override global preto */
          .main .opme-card.opme-card-glosas .opme-card-valor-mini { color: #C0392B !important; }
          .opme-card-glosas .opme-card-qtd-rotulo { color: #C0392B; }
          /* V718: título dos cards totalizadores em #06283A (a regra global de
             cards pintava #0F6E56 com !important — este override vence por vir
             depois no cascade). */
          .main .opme-card .opme-card-titulo { color: #06283A !important; }
          /* V718: card de GLOSAS com a mesma moldura do card de glosa da VISÃO
             GERAL (V712): a linha azul #1EBBD7 em volta vira o terroso #c0563f.
             Só a coloração da moldura — estrutura intacta. */
          .main .opme-card.opme-card-glosas {
            box-shadow:
              -4px -3px 0 0 #c0563f,
              -4px -3px 10px rgba(192, 86, 63, 0.28),
              0 8px 18px rgba(0, 58, 84, 0.13) !important;
          }
          .opme-chk-ocultar {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            font-weight: 600;
            color: var(--ink-soft);
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
            padding: 0 12px;
            height: 32px;
            border-radius: 6px;
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            box-sizing: border-box;
          }
          .opme-chk-ocultar:hover { background: var(--bg-sunken); }
          .opme-chk-ocultar input {
            width: 13px; height: 13px;
            accent-color: var(--primary);
            cursor: pointer; margin: 0;
          }

          /* Botão Ajustes — mesma altura dos outros controles */
          #opme-btn-ajustes {
            height: 32px;
            padding: 0 14px;
            font-size: 12px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            white-space: nowrap;
            box-sizing: border-box;
          }
          .opme-chk-ocultar input {
            width: 13px; height: 13px;
            accent-color: var(--primary);
            cursor: pointer; margin: 0;
          }

          /* MODAL DE AJUSTES (mesmo padrão do módulo LIO) */
          .opme-ajustes-overlay {
            position: fixed; inset: 0;
            background: rgba(0,0,0,.45);
             
            z-index: 1000;
          }
          .opme-ajustes-modal {
            position: fixed; top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            width: 92vw; max-width: 1180px; max-height: 88vh;
            background: var(--bg-elevated); border: 1px solid var(--border);
            border-radius: 14px; z-index: 1001;
            display: flex; flex-direction: column; overflow: hidden;
            box-shadow: 0 30px 80px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.05) inset;
          }
          .opme-ajustes-modal-head {
            flex-shrink: 0; position: relative;
            padding: 15px 22px; border-bottom: 1px solid var(--border);
            background: var(--bg-elevated);
          }
          .opme-ajustes-modal-tit {
            margin: 0; font-size: 14px; font-weight: 700;
            text-transform: uppercase; letter-spacing: .05em; color: var(--primary);
          }
          .opme-ajustes-close-modal {
            position: absolute; top: 11px; right: 14px;
            width: 32px; height: 32px; border-radius: 50%;
            background: var(--bg-sunken); border: 1px solid var(--border);
            color: var(--ink-soft); font-size: 16px; cursor: pointer;
            display: inline-flex; align-items: center; justify-content: center;
            transition: background-color 150ms, color 150ms, border-color 150ms;
          }
          .opme-ajustes-close-modal:hover { background: #1EBBD7; color: #fff; border-color: #1EBBD7; }
          .opme-ajustes-body { flex: 1; overflow-y: auto; padding: 18px 22px 22px; }
          @media (max-width: 980px) {
            .opme-ajustes-modal { width: 96vw; max-height: 92vh; }
          }

          /* ── MODAL DE TESTE (simulador de repasse) ── */
          .opme-teste-overlay {
            position: fixed; inset: 0;
            background: rgba(0,0,0,.45);
             
            z-index: 1000;
          }
          .opme-teste-modal {
            position: fixed; top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            width: 92vw; max-width: 640px; max-height: 88vh;
            background: var(--bg-elevated); border: 1px solid var(--border);
            border-radius: 14px; z-index: 1001;
            display: flex; flex-direction: column; overflow: hidden;
            box-shadow: 0 30px 80px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.05) inset;
          }
          .opme-teste-modal-head {
            flex-shrink: 0; position: relative;
            padding: 15px 22px; border-bottom: 1px solid var(--border);
            background: var(--bg-elevated);
          }
          .opme-teste-modal-tit {
            margin: 0; font-size: 14px; font-weight: 700;
            text-transform: uppercase; letter-spacing: .05em; color: var(--primary);
          }
          .opme-teste-close-modal {
            position: absolute; top: 11px; right: 14px;
            width: 32px; height: 32px; border-radius: 50%;
            background: var(--bg-sunken); border: 1px solid var(--border);
            color: var(--ink-soft); font-size: 16px; cursor: pointer;
            display: inline-flex; align-items: center; justify-content: center;
            transition: background-color 150ms, color 150ms, border-color 150ms;
          }
          .opme-teste-close-modal:hover { background: #1EBBD7; color: #fff; border-color: #1EBBD7; }
          .opme-teste-body { flex: 1; overflow-y: auto; padding: 16px 22px 22px; }
          .opme-teste-form {
            display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; margin: 14px 0 4px;
          }
          .opme-teste-campo { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
          .opme-teste-campo-wide { grid-column: 1 / -1; }
          .opme-teste-campo > span {
            font-size: 11px; font-weight: 700; letter-spacing: .03em;
            color: var(--ink-soft); text-transform: uppercase;
          }
          .opme-teste-campo > span small { font-weight: 500; text-transform: none; opacity: .7; letter-spacing: 0; }
          .opme-teste-campo > input,
          .opme-teste-valor-wrap {
            height: 36px; box-sizing: border-box;
            font-family: inherit; font-size: 13px; font-weight: 500;
            border: 1px solid var(--border); border-radius: 8px;
            background: var(--bg-elevated); color: var(--ink);
            padding: 0 12px; outline: none;
            transition: border-color 150ms, box-shadow 150ms;
          }
          .opme-teste-campo > input:focus,
          .opme-teste-valor-wrap:focus-within {
            border-color: var(--primary); box-shadow: 0 0 0 3px rgba(0, 80, 115,0.08);
          }
          .opme-teste-valor-wrap { display: inline-flex; align-items: center; gap: 5px; }
          .opme-teste-valor-wrap input {
            border: none; background: transparent; outline: none; height: auto; padding: 0;
            width: 100%; font-family: inherit; font-size: 13px; font-weight: 500; text-align: right; color: var(--ink);
          }
          /* ── COMBOBOX CUSTOM (substitui o datalist nativo, não-estilizável) ── */
          .opme-combo { position: relative; }
          .opme-combo-input {
            width: 100%; height: 36px; box-sizing: border-box;
            font-family: inherit; font-size: 13px; font-weight: 500;
            border: 1px solid var(--border); border-radius: 8px;
            background: var(--bg-elevated); color: var(--ink);
            padding: 0 52px 0 12px; outline: none;
            transition: border-color 150ms, box-shadow 150ms;
          }
          .opme-combo-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(0, 80, 115,0.08); }
          .opme-combo-arrow {
            position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
            width: 24px; height: 24px; border: none; background: transparent;
            color: var(--ink-faint); cursor: pointer; font-size: 11px; font-weight: 700;
            display: flex; align-items: center; justify-content: center; border-radius: 5px;
            transition: background-color 150ms, color 150ms, transform 150ms;
          }
          .opme-combo-arrow:hover { background: var(--bg-sunken); color: var(--primary); }
          .opme-combo-arrow.aberto { transform: translateY(-50%) rotate(180deg); color: var(--primary); }
          .opme-combo-clear {
            position: absolute; right: 32px; top: 50%; transform: translateY(-50%);
            width: 18px; height: 18px; border: none; background: var(--bg-sunken);
            color: var(--ink-faint); cursor: pointer; font-size: 10px; border-radius: 50%;
            align-items: center; justify-content: center;
            transition: background-color 150ms, color 150ms;
          }
          .opme-combo-clear:hover { background: #B0413A; color: #fff; }
          .opme-combo-dropdown {
            position: absolute; top: calc(100% + 4px); left: 0; right: 0;
            z-index: 30; background: var(--bg-elevated);
            border: 1px solid var(--border); border-radius: 8px;
            box-shadow: 0 12px 30px rgba(20,68,61,0.18), 0 2px 6px rgba(20,68,61,0.08);
            max-height: 240px; overflow-y: auto; padding: 4px; font-size: 12.5px;
            animation: opme-pop-in 150ms ease-out;
          }
          .opme-combo-opt {
            padding: 8px 11px; cursor: pointer; border-radius: 5px; color: var(--ink);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500;
            transition: background 100ms, color 100ms;
          }
          .opme-combo-opt:hover { background: var(--bg-sunken); color: var(--primary); }
          .opme-combo-opt.sel { background: rgba(30, 187, 215,.14); color: var(--primary); font-weight: 700; }
          .opme-combo-vazio { padding: 10px; text-align: center; font-size: 11px; color: var(--ink-faint); font-style: italic; }
          .opme-combo-dropdown::-webkit-scrollbar { width: 8px; }
          .opme-combo-dropdown::-webkit-scrollbar-track { background: transparent; }
          .opme-combo-dropdown::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
          .opme-combo-dropdown::-webkit-scrollbar-thumb:hover { background: var(--accent); }
          .opme-teste-acoes { margin: 14px 0 2px; display: flex; justify-content: flex-end; }
          .opme-teste-resultado { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
          .opme-teste-resultado:empty { display: none; }
          .opme-teste-passo {
            border: 1px solid var(--border); border-radius: 10px;
            background: var(--bg-sunken); padding: 10px 14px;
          }
          .opme-teste-passo-tit {
            font-size: 10.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
            color: var(--primary); margin-bottom: 6px;
          }
          .opme-teste-linha { font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; }
          .opme-teste-linha.ok { color: var(--primary, #005073); }
          .opme-teste-linha.no { color: #B0413A; }
          .opme-teste-linha.opme-teste-warn { color: #B0413A; font-weight: 600; }
          .opme-teste-nota { font-size: 11px; color: var(--ink-faint); font-style: italic; margin-top: 4px; line-height: 1.45; }
          .opme-teste-final {
            margin-top: 4px; padding: 12px 16px;
            background: var(--primary); color: #F1F7F7;
            border-radius: 10px; font-size: 13px; font-weight: 700;
            display: flex; align-items: center; justify-content: space-between;
          }
          .opme-teste-final span { font-size: 18px; font-weight: 800; font-family: var(--font-mono, monospace); }
          @media (max-width: 620px) {
            .opme-teste-form { grid-template-columns: 1fr; }
            .opme-teste-modal { width: 96vw; max-height: 92vh; }
          }

          /* PAINEL DE AJUSTES (dentro do modal) — 2 colunas em cima,
             tabela de Valor Fixo ocupando a largura inteira embaixo */
          .opme-ajustes {
            display: grid;
            grid-template-columns: minmax(300px, 1fr) minmax(300px, 1fr);
            gap: 18px 28px;
            align-items: start;
          }
          .opme-aj-pct-col { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
          .opme-vf-secao { grid-column: 1 / -1; }
          @media (max-width: 1100px) {
            .opme-ajustes { grid-template-columns: 1fr; }
          }
          .opme-ajustes-secao h4 {
            margin: 0 0 4px;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--primary);
          }
          .opme-ajustes-help {
            margin: 0 0 10px;
            font-size: 11px;
            color: var(--ink-faint);
            line-height: 1.4;
          }

          /* CATEGORIAS MACRO (chips compactos com drilldown) */
          .opme-categorias-lista {
            display: flex;
            flex-wrap: wrap;
            align-items: flex-start;
            gap: 8px;
            margin-bottom: 10px;
          }
          .opme-macro {
            border: 1px solid var(--border);
            border-radius: 999px;
            background: var(--bg-elevated);
            overflow: hidden;
            transition: border-color 120ms, border-radius 180ms;
          }
          .opme-macro.is-ativo {
            border-color: var(--primary);
            background: var(--primary);
            color: #F1F7F7;
          }
          .opme-macro.is-inativo {
            opacity: 0.55;
            background: var(--bg-sunken);
          }
          .opme-macro.is-expandido {
            border-radius: 12px;
            min-width: 240px;
            flex-basis: 240px;
          }
          .opme-macro-head {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px 6px 4px 12px;
          }
          .opme-macro-toggle {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            cursor: pointer;
            font-weight: 700;
            letter-spacing: 0.06em;
            user-select: none;
          }
          .opme-macro-toggle input {
            width: 13px; height: 13px;
            accent-color: var(--accent);
            cursor: pointer;
            margin: 0;
            flex-shrink: 0;
          }
          .opme-macro-nome {
            font-size: 12px;
            text-transform: uppercase;
            white-space: nowrap;
          }
          /* Campo de % por OPME no cabeçalho do macro */
          .opme-macro-pct {
            display: inline-flex; align-items: center; gap: 1px;
            margin-left: 2px; height: 22px;
            padding: 0 7px 0 4px; border-radius: 999px;
            background: rgba(255,255,255,0.16);
          }
          .opme-macro.is-inativo .opme-macro-pct { background: rgba(0,0,0,0.05); }
          .opme-macro-pct input {
            width: 34px; border: none; background: transparent; outline: none;
            color: inherit; font-family: inherit; font-size: 11px; font-weight: 700;
            text-align: right; -moz-appearance: textfield;
          }
          .opme-macro-pct input::-webkit-outer-spin-button,
          .opme-macro-pct input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
          .opme-macro-pct input::placeholder { color: inherit; opacity: .45; font-weight: 500; }
          .opme-macro-pct-sufixo { font-size: 10px; font-weight: 700; opacity: .7; }
          .opme-macro-pct.tem-pct { background: rgba(30, 187, 215,0.30); box-shadow: 0 0 0 1px rgba(30, 187, 215,0.55) inset; }
          .opme-macro.is-ativo .opme-macro-pct.tem-pct { background: rgba(255,255,255,0.30); }
          /* Switch: respeitar regra do médico */
          .opme-switch-respeita {
            display: flex; align-items: flex-start; gap: 10px;
            margin-top: 12px; padding: 10px 12px;
            background: var(--bg-sunken); border: 1px solid var(--border); border-radius: 10px;
          }
          .opme-switch { position: relative; display: inline-block; width: 38px; height: 22px; flex-shrink: 0; cursor: pointer; }
          .opme-switch input { opacity: 0; width: 0; height: 0; }
          .opme-switch-slider {
            position: absolute; inset: 0; background: var(--border-strong, #c9c2b4);
            border-radius: 999px; transition: background-color 160ms;
          }
          .opme-switch-slider::before {
            content: ''; position: absolute; height: 16px; width: 16px; left: 3px; top: 3px;
            background: #fff; border-radius: 50%; transition: transform 160ms; box-shadow: 0 1px 3px rgba(0,0,0,.25);
          }
          .opme-switch input:checked + .opme-switch-slider { background: var(--primary); }
          .opme-switch input:checked + .opme-switch-slider::before { transform: translateX(16px); }
          .opme-switch-txt { font-size: 12px; color: var(--ink-soft); line-height: 1.45; }
          .opme-switch-txt small { display: block; font-size: 11px; color: var(--ink-faint); margin-top: 2px; }
          /* X vem IMEDIATAMENTE depois do nome (sem margin extra) */
          .opme-macro-remover {
            background: rgba(255, 255, 255, 0.15);
            border: 1.5px solid rgba(255, 255, 255, 0.0);
            color: inherit;
            cursor: pointer;
            font-size: 11px;
            font-weight: 800;
            line-height: 1;
            width: 20px; height: 20px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            opacity: 0.85;
            flex-shrink: 0;
            transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
            margin-left: 4px;
          }
          .opme-macro.is-inativo .opme-macro-remover { background: rgba(0,0,0,0.10); }
          .opme-macro-remover:hover {
            background: #C62828;
            color: #FFFFFF;
            border-color: #FFFFFF;
            transform: scale(1.08);
            opacity: 1;
          }
          /* ▾ é empurrado pro final do chip */
          .opme-macro-drilldown {
            background: rgba(255,255,255,0.12);
            border: none;
            color: inherit;
            cursor: pointer;
            font-size: 10px;
            line-height: 1;
            width: 20px; height: 20px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            opacity: 0.7;
            flex-shrink: 0;
            margin-left: 12px;
            transition: background 120ms, opacity 120ms;
          }
          .opme-macro.is-inativo .opme-macro-drilldown { background: rgba(0,0,0,0.08); }
          .opme-macro-drilldown:hover { opacity: 1; background: rgba(255,255,255,0.25); }
          .opme-macro.is-inativo .opme-macro-drilldown:hover { background: rgba(0,0,0,0.18); }
          .opme-macro.is-expandido .opme-macro-drilldown {
            margin-left: auto;  /* quando expandido, ocupa todo o espaço sobrado */
          }
          .opme-macro-drill {
            padding: 10px 14px;
            background: var(--bg-elevated);
            border-top: 1px solid var(--border);
            max-height: 220px;
            overflow-y: auto;
            color: var(--ink);
          }
          .opme-macro.is-ativo .opme-macro-drill {
            color: var(--ink);
          }
          .opme-macro-info {
            font-size: 10px;
            color: var(--ink-faint);
            margin-bottom: 4px;
            font-weight: 600;
          }
          .opme-macro-vazio {
            font-size: 11px;
            color: var(--ink-faint);
            font-style: italic;
            text-align: center;
            padding: 6px;
          }
          .opme-macro-produtos {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 3px;
          }
          .opme-produto {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 6px 4px 8px;
            background: var(--bg-sunken);
            border-radius: 4px;
            line-height: 1.3;
            transition: background 120ms;
          }
          .opme-produto:hover { background: rgba(0, 80, 115, 0.06); }
          .opme-produto-nome {
            flex: 1;
            font-size: 10.5px;
            color: var(--ink-soft);
            font-family: var(--font-body);
            word-break: keep-all;
          }
          .opme-produto.is-excluido {
            opacity: 0.55;
            background: var(--bg-elevated);
            border: 1px dashed var(--border);
          }
          .opme-produto.is-excluido .opme-produto-nome {
            text-decoration: line-through;
            color: var(--ink-faint);
          }
          .opme-produto-excluir,
          .opme-produto-restaurar {
            border: none;
            background: transparent;
            cursor: pointer;
            font-size: 11px;
            font-weight: 800;
            line-height: 1;
            width: 20px; height: 20px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: var(--ink-faint);
            flex-shrink: 0;
            transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
          }
          .opme-produto-excluir:hover {
            background: #C62828;
            color: #FFFFFF;
            transform: scale(1.08);
          }
          .opme-produto-restaurar {
            color: #0A7A5A;
            background: rgba(46, 125, 50, 0.10);
            font-size: 12px;
          }
          .opme-produto-restaurar:hover {
            background: #0A7A5A;
            color: #FFFFFF;
            transform: scale(1.08);
          }

          /* Tag de contador de excluídos no header do drilldown */
          .opme-macro-info-tag {
            display: inline-block;
            margin-left: 6px;
            padding: 0 6px;
            background: rgba(155, 58, 58, 0.12);
            color: #9B3A3A;
            font-size: 9px;
            font-weight: 800;
            letter-spacing: 0.04em;
            border-radius: 8px;
            text-transform: uppercase;
            vertical-align: middle;
          }
          .opme-add-termo {
            display: flex; gap: 6px;
          }
          .opme-add-termo input {
            flex: 1;
            padding: 5px 10px;
            font-size: 11px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--bg-elevated);
            outline: none;
            font-family: inherit;
          }
          .opme-add-termo input:focus { border-color: var(--primary); }
          .opme-add-termo .btn {
            padding: 4px 12px; font-size: 11px;
          }

          /* PCT geral */
          .opme-pct-geral {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
          }
          .opme-pct-geral input {
            width: 80px;
            padding: 6px 10px;
            font-size: 14px;
            font-weight: 700;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--bg-elevated);
            color: var(--primary);
            outline: none;
            text-align: right;
          }
          .opme-pct-geral input:focus { border-color: var(--primary); }
          .opme-pct-suffix {
            font-weight: 700;
            color: var(--primary);
            font-size: 14px;
          }
          .opme-pct-help {
            display: block;
            margin-top: 6px;
            font-size: 10px;
            color: var(--ink-faint);
            line-height: 1.4;
            width: 100%;
          }

          /* Regras específicas */
          .opme-nova-regra {
            display: flex;
            gap: 6px;
            margin-bottom: 10px;
            align-items: center;
            flex-wrap: wrap;
          }
          .opme-select {
            flex: 1;
            min-width: 180px;
            padding: 5px 10px;
            font-size: 11px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--bg-elevated);
            outline: none;
            font-family: inherit;
          }
          .opme-nova-regra input[type="number"] {
            width: 70px;
            padding: 5px 10px;
            font-size: 11px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--bg-elevated);
            outline: none;
            text-align: right;
            font-family: inherit;
          }
          .opme-nova-regra .btn {
            padding: 4px 12px; font-size: 11px;
          }
          .opme-regras-vazio {
            font-size: 11px;
            color: var(--ink-faint);
            font-style: italic;
            padding: 8px 10px;
            background: var(--bg-sunken);
            border-radius: 6px;
          }
          .opme-regras-lista {
            list-style: none;
            margin: 0; padding: 0;
            display: flex; flex-direction: column;
            gap: 4px;
          }
          .opme-regra-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 6px 10px;
            background: var(--bg-sunken);
            border-radius: 6px;
            font-size: 11px;
          }
          .opme-regra-nome { flex: 1; font-weight: 600; }
          .opme-regra-pct {
            font-weight: 700; color: var(--primary);
            background: var(--bg-elevated);
            padding: 1px 8px;
            border-radius: 10px;
          }
          .opme-regra-remover {
            border: none;
            background: transparent;
            color: var(--ink-faint);
            cursor: pointer;
            font-size: 12px;
            padding: 2px 6px;
            border-radius: 3px;
          }
          .opme-regra-remover:hover { color: var(--danger); background: rgba(155,58,58,0.08); }

          /* GRID DOS PAINÉIS */
          .opme-grid {
            display: flex;
            gap: 0;
            margin-top: 8px;
            align-items: stretch;
          }
          .opme-painel[data-lado="esq"] {
            flex: 1 1 0;
            min-width: 280px;
            margin-right: 4px;
          }
          .opme-painel[data-lado="dir"] {
            flex: 1 1 0;
            min-width: 280px;
            margin-left: 4px;
          }
          @media (max-width: 1100px) {
            .opme-grid {
              flex-direction: column;
              gap: 12px;
            }
            .opme-painel[data-lado="esq"],
            .opme-painel[data-lado="dir"] {
              margin: 0;
              flex: 1 1 auto !important;  /* anula style inline em telas estreitas */
            }
            .opme-resize-divisor { display: none; }
          }

          /* DIVISOR VERTICAL — fica entre os 2 painéis, arrastável p/ ajustar
             a largura. Duplo-clique reseta 50/50. */
          .opme-resize-divisor {
            flex: 0 0 8px;
            cursor: ew-resize;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 150ms;
            border-radius: 4px;
            user-select: none;
          }
          .opme-resize-divisor:hover {
            background: rgba(24, 154, 211, 0.15);  /* accent suave */
          }
          .opme-resize-divisor.is-dragging {
            background: rgba(24, 154, 211, 0.30);
          }
          .opme-divisor-grip {
            width: 6px;
            height: 64px;
            border-radius: 3px;
            background: var(--border);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
          }
          .opme-resize-divisor:hover .opme-divisor-grip {
            background: var(--accent);
            height: 80px;
            box-shadow: 0 2px 8px rgba(24, 154, 211, 0.30);
          }
          .opme-resize-divisor.is-dragging .opme-divisor-grip {
            background: var(--accent);
            height: 90px;
          }
          .opme-divisor-dots {
            color: rgba(255, 255, 255, 0.85);
            font-size: 16px;
            font-weight: 900;
            letter-spacing: -2px;
            line-height: 0.5;
            transform: scaleY(0.8);
            opacity: 0;
            transition: opacity 150ms;
          }
          .opme-resize-divisor:hover .opme-divisor-dots,
          .opme-resize-divisor.is-dragging .opme-divisor-dots {
            opacity: 1;
          }

          .opme-painel {
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 10px;
            display: flex;
            flex-direction: column;
            /* altura fixa do painel — escala com a viewport mas tem limites
               pra evitar painéis gigantes em telas grandes ou minúsculos em
               telas pequenas. SEM overflow:hidden — popovers do header
               precisam transbordar. Border-radius nos elementos internos. */
            height: clamp(420px, 62vh, 640px);
          }
          .opme-painel-head {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border);
            background: var(--bg-sunken);
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
            border-radius: 10px 10px 0 0;
            /* Mantém position relative no head pra que popovers absolute
               se posicionem em relação a ele se necessário. */
          }
          .opme-painel-titulo {
            display: flex; align-items: center;
            gap: 10px; flex-wrap: wrap;
            /* ocupa a linha inteira do head → os controles (.opme-painel-chips-wrap)
               sempre quebram pra 2ª linha nos DOIS painéis, deixando os cabeçalhos
               cinza com a MESMA altura (padrão de 2 linhas, = altura da Produção). */
            flex: 1 1 100%;
          }
          .opme-painel-chips-wrap {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
          }
          /* DROPDOWNS MACRO DO QVIS (3 botões: ANEL/ISTENT/VALVULA) */
          .opme-qvis-dropdowns {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
          }
          .opme-macro-dropdown-btn {
            padding: 4px 12px;
            border-radius: 999px;
            border: 1px solid var(--primary);
            background: var(--primary);
            color: #F1F7F7;
            font-size: 10.5px;
            font-weight: 700;
            cursor: pointer;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
            font-family: inherit;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            white-space: nowrap;
            line-height: 1.4;
          }
          .opme-macro-dropdown-btn.is-filtrado {
            background: #8A4F2A;
            border-color: #8A4F2A;
          }
          .opme-macro-dropdown-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 6px rgba(0, 80, 115, 0.25);
          }

          /* DROPDOWN DE PRODUTOS (Produção QVIS) */
          .opme-prod-dropdown-wrap {
            position: relative;
          }
          /* V719: pílula SÓLIDA azul-escura (--primary, texto branco) SEMPRE —
             o layout do botão "📂 Termos" filtrado, agora padrão dos dois
             lados (Termos do Relatório QVIS e Produtos da Produção). */
          .opme-prod-dropdown-btn {
            padding: 4px 12px;
            border-radius: 999px;
            border: 1px solid var(--primary);
            background: var(--primary);
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            letter-spacing: 0.03em;
            color: #F1F7F7;
            transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
            font-family: inherit;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            white-space: nowrap;
            line-height: 1.4;
          }
          .opme-prod-dropdown-btn.is-filtrado {
            background: var(--primary);
            color: #F1F7F7;
            border-color: var(--primary);
          }
          .opme-prod-dropdown-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 6px rgba(0, 80, 115, 0.18);
          }
          .opme-prod-seta {
            font-size: 8px;
            opacity: 0.7;
          }
          .opme-prod-indicador {
            background: rgba(255,255,255,0.25);
            padding: 1px 6px;
            border-radius: 8px;
            font-size: 9px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }
          /* V719: botão sempre escuro — o badge "N oc." usa o estilo claro
             padrão (rgba branca) em qualquer estado. */

          .opme-prod-dropdown-popover {
            position: absolute;
            top: calc(100% + 6px);
            right: 0;
            min-width: 380px;
            max-width: 480px;
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 8px;
            box-shadow: 0 12px 32px rgba(0,0,0,0.22);
            z-index: 9999;
            overflow: hidden;
            animation: opme-pop-in 150ms;
          }
          @keyframes opme-pop-in {
            from { opacity: 0; transform: translateY(-4px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .opme-prod-popover-head {
            padding: 10px 14px;
            border-bottom: 1px solid var(--border);
            background: var(--bg-sunken);
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
          }
          .opme-prod-popover-head strong {
            font-size: 11px;
            color: var(--primary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          .opme-prod-popover-acoes {
            display: flex;
            gap: 4px;
            align-items: center;
            font-size: 10px;
            color: var(--ink-faint);
          }
          .opme-prod-popover-link {
            border: none;
            background: transparent;
            color: var(--primary);
            cursor: pointer;
            font-size: 10.5px;
            font-weight: 700;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: inherit;
          }
          .opme-prod-popover-link:hover {
            background: rgba(0, 80, 115, 0.08);
          }
          .opme-prod-popover-lista {
            max-height: 320px;
            overflow-y: auto;
            padding: 6px;
          }
          .opme-prod-popover-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            color: var(--ink-soft);
            line-height: 1.3;
            user-select: none;
            transition: background 100ms;
          }
          .opme-prod-popover-item:hover {
            background: var(--bg-sunken);
          }
          .opme-prod-popover-item input {
            width: 14px; height: 14px;
            accent-color: var(--primary);
            cursor: pointer;
            margin: 0;
            flex-shrink: 0;
          }
          .opme-prod-popover-tachado {
            text-decoration: line-through;
            opacity: 0.55;
          }
          .opme-prod-popover-vazio {
            padding: 16px 10px;
            text-align: center;
            color: var(--ink-faint);
            font-style: italic;
            font-size: 11px;
          }
          .opme-prod-popover-footer {
            padding: 6px 14px;
            border-top: 1px solid var(--border);
            background: var(--bg-sunken);
            text-align: right;
            font-size: 10px;
            color: var(--ink-faint);
            font-weight: 600;
          }

          /* PASTA ÚNICA do Relatório QVIS (agrupa os macros — acordeão) */
          /* V660: o botão "Termos" fica no painel ESQUERDO — com o right:0
             herdado do botão Produtos (painel direito), o popover crescia pra
             esquerda e ficava POR BAIXO do menu lateral, cortado. Ancorado à
             esquerda do botão, cresce pra direita, sempre dentro da tela. */
          .opme-qvis-folder-popover {
            left: 0;
            right: auto;
            min-width: 320px;
            max-width: min(460px, calc(100vw - 130px));
          }
          .opme-qvis-folder-lista {
            max-height: 440px;
            overflow-y: auto;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .opme-qvis-folder-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .opme-qvis-folder-macro-btn {
            align-self: flex-start;
          }
          .opme-qvis-folder-sub {
            border: 1px solid var(--border);
            border-radius: 8px;
            background: var(--bg-elevated);
            overflow: hidden;
            margin-left: 6px;
          }
          .opme-qvis-folder-acoes {
            padding: 8px 12px;
            border-bottom: 1px solid var(--border);
            background: var(--bg-sunken);
            justify-content: flex-start;
          }

          /* CHIPS dos termos (Relatório QVIS) — mantém estilo da V40 */
          .opme-header-chips {
            display: flex;
            gap: 5px;
            flex-wrap: wrap;
          }
          .opme-filtro-chip {
            padding: 3px 10px;
            border-radius: 999px;
            border: 1px solid var(--border);
            background: var(--bg-elevated);
            font-size: 10.5px;
            font-weight: 700;
            cursor: pointer;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
            font-family: inherit;
            color: var(--ink-soft);
            white-space: nowrap;
            line-height: 1.4;
          }
          .opme-filtro-chip.is-on {
            background: var(--primary);
            color: #F1F7F7;
            border-color: var(--primary);
          }
          .opme-filtro-chip.is-off {
            text-decoration: line-through;
            opacity: 0.7;
          }
          .opme-filtro-chip:hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 6px rgba(0, 80, 115, 0.18);
          }
          .opme-filtro-chip.is-off:hover {
            opacity: 1;
            text-decoration: none;
          }
          .opme-painel-titulo h3 {
            margin: 0;
            font-size: 15px;
            font-weight: 700;
            color: var(--primary);
          }
          .opme-painel-icone { font-size: 16px; }
          .opme-painel-contador {
            font-family: var(--font-display, serif);
            font-size: 17px;
            font-weight: 700;
            color: var(--ink);
          }
          .opme-painel-contador small {
            font-family: var(--font-body);
            font-size: 11px;
            font-weight: 500;
            color: var(--ink-faint);
            margin-left: 2px;
          }
          .opme-ocultas-tag {
            display: inline-block;
            margin-left: 4px;
            padding: 1px 7px;
            background: rgba(184, 122, 90, 0.15);
            color: #8A4F2A;
            font-size: 10px;
            font-weight: 700;
            border-radius: 10px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }
          .opme-tag-filtro {
            display: inline-block;
            margin-left: 4px;
            padding: 1px 8px;
            background: var(--primary-soft);
            color: var(--primary);
            font-size: 10px;
            font-weight: 700;
            border-radius: 10px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }
          .opme-badge-pago {
            background: #0A7A5A;
            color: #FFFFFF;
            font-size: 11px;
            font-weight: 700;
            padding: 3px 9px;
            border-radius: 10px;
          }

          /* Tabela — preenche o espaço restante do painel (que tem altura
             fixa via clamp). flex:1 + min-height:0 garantem que o scroll
             funcione corretamente dentro do flex container. */
          .opme-tabela-scroll {
            overflow: auto;
            flex: 1;
            min-height: 0;
            border-radius: 0 0 10px 10px;
          }
          .opme-vazio {
            padding: 30px 20px;
            text-align: center;
            color: var(--ink-faint);
            font-style: italic;
            font-size: 13px;
          }
          .opme-tabela {
            width: 100%;
            min-width: 760px;  /* força scroll horizontal quando painel é estreito */
            border-collapse: collapse;
            font-size: 10.5px;
          }
          .opme-tabela th {
            position: sticky;
            top: 0;
            background: var(--bg-sunken);
            padding: 6px 8px;
            text-align: left;
            font-size: 9px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--ink-soft);
            border-bottom: 1px solid var(--border);
            white-space: nowrap;
            z-index: 1;
          }
          .opme-tabela th.num,
          .opme-tabela td.num { text-align: right; }
          .opme-tabela th.opme-col-status,
          .opme-tabela td.opme-col-status {
            width: 60px;
            text-align: center;
            padding-left: 4px;
            padding-right: 4px;
            white-space: nowrap;
          }
          .opme-tabela td {
            padding: 4px 8px;
            border-bottom: 1px solid var(--border);
            vertical-align: middle;
            white-space: nowrap;
          }
          /* Paciente e Procedimento/Produto: largura mínima pra não ficar
             vertical demais; só quebra entre palavras inteiras. */
          .opme-tabela td:nth-child(4),
          .opme-tabela td:nth-child(5) {
            white-space: normal;
            word-break: keep-all;
            font-size: 10px;
            line-height: 1.3;
            min-width: 150px;
          }
          .opme-tabela tr:hover td { background: rgba(0, 80, 115, 0.03); }

          /* SINC HOVER */
          .opme-tabela tr.opme-row-sync-hover td {
            background: rgba(24, 154, 211, 0.10) !important;
          }
          .opme-tabela tr.opme-row-sync-hover.opme-linha-paga td {
            background: #D6EBD8 !important;
          }
          .opme-tabela tr.opme-row-sync-hover.opme-linha-paga-outro td {
            background: #FFDADC !important;
          }
          .opme-tabela tr.opme-row-sync-hover.opme-linha-recebido-zero td {
            background: #FFF6D5 !important;
          }

          .opme-col-repasse {
            font-weight: 700;
            color: var(--accent);
          }
          .opme-badge-pct {
            display: inline-block;
            font-family: var(--font-body);
            font-size: 9px;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 3px;
            margin-left: 4px;
            vertical-align: middle;
          }
          .opme-badge-geral  { background: var(--bg-sunken);            color: var(--ink-soft); }
          .opme-badge-medico { background: rgba(24, 154, 211,0.18);        color: #005073; }

          /* Checkbox pago */
          .opme-chk-pago {
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            gap: 1px;
            cursor: pointer;
            line-height: 1;
          }
          .opme-chk-pago input {
            width: 16px; height: 16px;
            accent-color: #0A7A5A;
            cursor: pointer; margin: 0;
          }
          .opme-chk-pago input:disabled {
            cursor: not-allowed;
            opacity: 0.4;
          }
          /* Indicador readonly da Produção (não clicável) */
          .opme-chk-readonly { cursor: default; }
          .opme-chk-marcado-readonly {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
            background: #0A7A5A;
            color: white;
            font-size: 11px;
            font-weight: 900;
            border-radius: 3px;
          }
          .opme-chk-vazio-readonly {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 1.5px solid var(--border);
            border-radius: 3px;
            background: var(--bg-elevated);
          }
          .opme-data-pgto {
            font-family: var(--font-body);
            font-size: 9px;
            color: #1B5E20;
            font-weight: 700;
            letter-spacing: 0.02em;
          }

          /* Linha paga */
          .opme-linha-paga td { background: #E8F5E9 !important; }
          .opme-linha-paga:hover td { background: #D6EBD8 !important; }
          .opme-linha-paga td:first-child {
            border-left: 3px solid #0A7A5A;
          }

          /* ===== TROCA DE MÉDICO (redirecionamento de repasse) ===== */
          .opme-medico-wrap {
            display: flex;
            flex-direction: column;
            gap: 1px;
            line-height: 1.3;
          }
          .opme-medico-nome {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-wrap: wrap;
          }
          .opme-medico-substituto {
            color: var(--accent);
            font-weight: 700;
          }
          .opme-medico-original {
            font-size: 9px;
            color: var(--ink-faint);
            font-style: italic;
            opacity: 0.75;
          }
          .opme-btn-trocar-medico,
          .opme-btn-restaurar-medico {
            border: none;
            background: transparent;
            color: var(--ink-faint);
            cursor: pointer;
            font-size: 12px;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 3px;
            transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
            line-height: 1;
            opacity: 0.55;
          }
          .opme-btn-trocar-medico:hover {
            background: rgba(24, 154, 211, 0.18);
            color: var(--accent);
            opacity: 1;
            transform: scale(1.15);
          }
          .opme-btn-restaurar-medico {
            color: #8A4F2A;
          }
          .opme-btn-restaurar-medico:hover {
            background: rgba(138, 79, 42, 0.15);
            opacity: 1;
            transform: scale(1.15);
          }
          tr:hover .opme-btn-trocar-medico,
          tr:hover .opme-btn-restaurar-medico { opacity: 0.85; }

          /* Modal de troca de médico */
          .opme-modal-trocar-medico {
            max-width: 560px !important;
            width: 92%;
          }
          .opme-modal-trocar-info {
            background: var(--bg-sunken);
            border: 1px solid var(--border);
            padding: 10px 14px;
            border-radius: 6px;
            font-size: 11.5px;
            margin-bottom: 12px;
          }
          .opme-modal-trocar-row {
            display: grid;
            grid-template-columns: 100px 1fr;
            gap: 8px;
            padding: 2px 0;
            align-items: center;
          }
          .opme-modal-explica {
            font-size: 11px;
            color: var(--ink-soft);
            line-height: 1.55;
            padding: 0 4px;
            margin-bottom: 12px;
            font-style: italic;
          }
          #opme-trocar-input {
            width: 100%;
            padding: 8px 12px;
            font-size: 12px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--bg-elevated);
            color: var(--ink);
            outline: none;
            font-family: inherit;
            box-sizing: border-box;
          }
          #opme-trocar-input:focus { border-color: var(--primary); }
          .opme-modal-medicos-lista {
            max-height: 280px;
            overflow-y: auto;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--bg-elevated);
            margin-top: 8px;
          }
          .opme-medico-opcao {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            width: 100%;
            padding: 8px 12px;
            border: none;
            background: transparent;
            text-align: left;
            cursor: pointer;
            font-family: inherit;
            font-size: 11.5px;
            color: var(--ink);
            border-bottom: 1px solid var(--border);
            transition: background 100ms;
          }
          .opme-medico-opcao:last-child { border-bottom: none; }
          .opme-medico-opcao:hover { background: var(--bg-sunken); }
          .opme-medico-opcao-nome { font-weight: 600; }
          .opme-medicos-tag-regra {
            background: rgba(0, 80, 115, 0.15);
            color: var(--primary);
            padding: 2px 8px;
            border-radius: 999px;
            font-size: 9.5px;
            font-weight: 700;
            letter-spacing: 0.04em;
          }
          .opme-medicos-tag-geral {
            background: rgba(24, 154, 211, 0.18);
            color: #005073;
            padding: 2px 8px;
            border-radius: 999px;
            font-size: 9.5px;
            font-weight: 700;
            letter-spacing: 0.04em;
          }

          /* ===== EV (Espaço Verde) — repasse antecipado ===== */
          /* Linha EV no Relatório QVIS: fundo azul claro */
          .opme-linha-ev td { background: #E3F2FD !important; }
          .opme-linha-ev:hover td { background: #D0E5F8 !important; }
          .opme-linha-ev td:first-child {
            border-left: 3px solid #1976D2;
          }
          /* Linha PAGA + EV (cópia EV depois marcada como paga manualmente) */
          .opme-linha-ev.opme-linha-paga td { background: #E1F0E5 !important; }
          .opme-linha-ev.opme-linha-paga td:first-child {
            border-left: 3px solid #1976D2;
          }

          /* Tag EV — amarelo ouro */
          .opme-tag-ev {
            display: inline-block;
            font-size: 9px;
            font-weight: 900;
            letter-spacing: 0.06em;
            color: #5C3D00;
            background: #FFD54F;
            border: 1px solid #C49000;
            padding: 2px 7px;
            border-radius: 3px;
            margin-top: 2px;
            line-height: 1;
            text-transform: uppercase;
            cursor: pointer;
            font-family: inherit;
            transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
          }
          .opme-tag-ev:hover {
            background: #FFC107;
            box-shadow: 0 2px 6px rgba(196, 144, 0, 0.35);
            transform: translateY(-1px);
          }

          /* Linha BLOQUEADA por EV (admissão já paga antecipadamente em outro mês) */
          .opme-linha-bloqueada-ev td {
            background: #F5F5F5 !important;
            color: #888 !important;
            opacity: 0.85;
          }
          .opme-linha-bloqueada-ev:hover td { background: #ECECEC !important; }
          .opme-linha-bloqueada-ev td:first-child {
            border-left: 3px solid #FFD54F;
          }
          .opme-selo-ev-bloq {
            display: inline-block;
            font-size: 8.5px;
            font-weight: 800;
            letter-spacing: 0.04em;
            color: #5C3D00;
            background: rgba(255, 213, 79, 0.45);
            border: 1px solid #C49000;
            padding: 1px 6px;
            border-radius: 3px;
            margin-top: 2px;
            line-height: 1.3;
            text-transform: uppercase;
            white-space: nowrap;
          }
          .opme-badge-ev-bloq {
            background: rgba(255, 213, 79, 0.45) !important;
            color: #5C3D00 !important;
            border: 1px solid #C49000 !important;
          }

          /* Botão "Repasse antecipado" no header da Produção */
          /* V719: como o botão "+ SANTO" da Visão Geral — pílula SÓLIDA
             dourada #B8965A com texto branco (v718 era só contornada). */
          .opme-btn-ev {
            padding: 4px 12px;
            border-radius: 999px;
            border: 1px solid #B8965A;
            background: #B8965A;
            color: #fff;
            font-size: 10.5px;
            font-weight: 800;
            cursor: pointer;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
            font-family: inherit;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            white-space: nowrap;
            line-height: 1.4;
          }
          .opme-btn-ev:hover {
            transform: translateY(-1px);
            box-shadow: 0 3px 8px rgba(184, 150, 90, 0.35);
            background: #9A7B45;
            border-color: #9A7B45;
            color: #fff;
          }
          .opme-btn-ev.is-disabled,
          .opme-btn-ev:disabled {
            background: var(--bg-sunken);
            color: var(--ink-faint);
            border-color: var(--border);
            cursor: not-allowed;
            opacity: 0.55;
          }
          .opme-btn-ev.is-disabled:hover {
            transform: none;
            box-shadow: none;
          }

          /* Modal de seleção EV */
          .opme-modal-ev {
            max-width: 780px !important;
            width: 92%;
          }
          .opme-modal-head-ev {
            background: linear-gradient(135deg, #FFE082 0%, #FFD54F 100%);
          }
          .opme-modal-head-ev h3 {
            color: #5C3D00 !important;
          }
          .opme-modal-head-ev .opme-modal-fechar {
            color: #5C3D00 !important;
          }
          .opme-modal-ev-info {
            background: var(--bg-sunken);
            border: 1px solid var(--border);
            border-left: 4px solid #FFD54F;
            padding: 10px 14px;
            border-radius: 6px;
            font-size: 12px;
            color: var(--ink);
            margin-bottom: 10px;
          }
          .opme-modal-ev-explica {
            font-size: 11px;
            color: var(--ink-soft);
            line-height: 1.55;
            padding: 0 4px;
            margin-bottom: 12px;
          }
          .opme-modal-ev-acoes {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 8px;
            font-size: 10.5px;
            color: var(--ink-faint);
          }
          .opme-modal-ev-contador {
            margin-left: auto;
            font-size: 11px;
            font-weight: 700;
            color: var(--primary);
          }
          .opme-modal-ev-lista {
            max-height: 380px;
            overflow-y: auto;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--bg-elevated);
          }
          .opme-modal-ev-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 10px 14px;
            border-bottom: 1px solid var(--border);
            cursor: pointer;
            user-select: none;
            transition: background 100ms;
          }
          .opme-modal-ev-item:last-child { border-bottom: none; }
          .opme-modal-ev-item:hover { background: var(--bg-sunken); }
          .opme-modal-ev-item input {
            width: 16px; height: 16px;
            accent-color: var(--primary);
            cursor: pointer;
            margin: 2px 0 0;
            flex-shrink: 0;
          }
          .opme-modal-ev-item:has(input:checked) {
            background: rgba(255, 213, 79, 0.22);
          }
          .opme-modal-ev-item-info {
            flex: 1;
            min-width: 0;
          }
          .opme-modal-ev-item-linha1 {
            display: flex;
            gap: 10px;
            align-items: baseline;
            font-size: 12px;
            margin-bottom: 3px;
            flex-wrap: wrap;
          }
          .opme-modal-ev-data { color: var(--ink-soft); font-weight: 600; }
          .opme-modal-ev-adm  { color: var(--accent); font-weight: 700; }
          .opme-modal-ev-item-linha2 {
            display: flex;
            gap: 12px;
            font-size: 10.5px;
            color: var(--ink-soft);
            margin-bottom: 3px;
          }
          .opme-modal-ev-produto { font-weight: 600; }
          .opme-modal-ev-medico { color: var(--ink-faint); font-style: italic; }
          .opme-modal-ev-multi {
            font-size: 10px;
            font-weight: 700;
            color: #8A4F2A;
            background: #FDF3E3;
            border: 1px solid #EAD9BE;
            border-radius: 999px;
            padding: 1px 8px;
            white-space: nowrap;
          }
          .opme-modal-ev-item-linha3 {
            display: flex;
            gap: 18px;
            font-size: 10.5px;
            color: var(--ink-faint);
            padding-top: 2px;
          }

          /* Linha paga em OUTRO MÊS — possível duplicidade (apenas no QVIS) */
          .opme-linha-paga-outro td { background: #FFEBEE !important; }
          .opme-linha-paga-outro:hover td { background: #FFDADC !important; }
          .opme-linha-paga-outro td:first-child {
            border-left: 3px solid #C62828;
          }
          .opme-data-pgto-outro { color: #C62828 !important; }
          .opme-tag-outro {
            display: inline-block;
            font-size: 8.5px;
            font-weight: 800;
            letter-spacing: 0.04em;
            color: #FFFFFF;
            background: #C62828;
            padding: 2px 6px;
            border: 1px solid #C62828;
            border-radius: 3px;
            margin-top: 1px;
            line-height: 1;
            text-transform: uppercase;
            cursor: pointer;
            font-family: inherit;
            transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
          }
          .opme-tag-outro:hover {
            background: #8B1515;
            border-color: #FFFFFF;
            transform: scale(1.08);
            box-shadow: 0 2px 6px rgba(198,40,40,0.35);
          }

          /* Linha RECEBIDO ZERADO — convênio não pagou, sem repasse ao médico */
          .opme-linha-recebido-zero td { background: #FFF8DD !important; }
          .opme-linha-recebido-zero:hover td { background: #FFF1B8 !important; }
          .opme-linha-recebido-zero td:first-child {
            border-left: 3px solid #C68A00;
          }
          .opme-tag-rec-zero {
            display: inline-block;
            font-size: 8.5px;
            font-weight: 800;
            letter-spacing: 0.04em;
            color: #003A54;
            background: rgba(198, 138, 0, 0.18);
            padding: 1px 6px;
            border-radius: 3px;
            margin-left: 6px;
            line-height: 1.4;
            text-transform: uppercase;
            vertical-align: middle;
            white-space: nowrap;
          }
          .opme-tag-sem-cod {
            display: inline-block;
            font-size: 8px;
            font-weight: 800;
            letter-spacing: 0.03em;
            color: #003A54;
            background: rgba(198, 138, 0, 0.18);
            padding: 1px 5px;
            border-radius: 3px;
            margin-top: 1px;
            line-height: 1;
            text-transform: uppercase;
          }
          .opme-badge-zerado {
            display: inline-block;
            font-size: 9px;
            font-weight: 800;
            padding: 1px 5px;
            border-radius: 3px;
            margin-left: 4px;
            vertical-align: middle;
            color: #003A54;
            background: rgba(198, 138, 0, 0.22);
            letter-spacing: 0.02em;
          }
          .opme-badge-verificar {
            display: inline-block;
            font-size: 9px;
            font-weight: 800;
            padding: 1px 5px;
            border-radius: 3px;
            margin-left: 4px;
            vertical-align: middle;
            color: #FFFFFF;
            background: #C62828;
            letter-spacing: 0.04em;
          }

          /* Lista de pagamentos no modal de duplicidade */
          .opme-dup-lista {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .opme-dup-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 8px 12px;
            background: #FFEBEE;
            border: 1px solid rgba(198, 40, 40, 0.3);
            border-radius: 6px;
          }
          .opme-dup-info {
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex: 1;
            min-width: 0;
          }
          .opme-dup-info strong {
            font-size: 13px;
            color: #8B1515;
          }
          .opme-dup-info small {
            font-size: 11px;
            color: var(--ink-soft);
          }
          .opme-dup-remover {
            white-space: nowrap;
            font-size: 11px !important;
            padding: 4px 10px !important;
          }

          /* Modal */
          .opme-modal-overlay {
            position: fixed; inset: 0;
            background: rgba(0, 80, 115, 0.4);
            
            z-index: 1000;
            display: flex; align-items: center; justify-content: center;
            padding: 20px;
          }
          .opme-modal {
            background: var(--bg-elevated);
            border-radius: 12px;
            max-width: 460px;
            width: 100%;
            box-shadow: 0 16px 48px rgba(0,0,0,0.25);
            overflow: hidden;
            animation: opme-fade-in 200ms;
          }
          @keyframes opme-fade-in {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .opme-modal-head {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 14px 18px;
            border-bottom: 1px solid var(--border);
            background: linear-gradient(135deg, #E8F5E9 0%, #C8E6C9 100%);
          }
          .opme-modal-head h3 {
            margin: 0; font-size: 16px; font-weight: 700; color: #1B5E20;
          }
          .opme-modal-fechar {
            background: rgba(255,255,255,0.6);
            border: 1px solid rgba(0,0,0,0.1);
            border-radius: 6px;
            width: 26px; height: 26px;
            cursor: pointer; color: #1B5E20;
            font-size: 13px;
          }
          .opme-modal-fechar:hover { background: white; }
          .opme-modal-body {
            padding: 16px 18px;
            display: flex; flex-direction: column; gap: 12px;
          }
          .opme-modal-senha { max-width: 440px; }
          .opme-senha-erro {
            font-size: 12px; font-weight: 600;
            color: #B0413A;
            background: rgba(176,65,58,0.08);
            border: 1px solid rgba(176,65,58,0.25);
            border-radius: 8px; padding: 8px 12px;
            margin-top: -2px;
          }
          .opme-modal-adm {
            display: flex; justify-content: space-between; align-items: center;
            padding: 8px 12px;
            background: var(--bg-sunken);
            border-radius: 6px;
          }
          .opme-modal-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-weight: 700;
            color: var(--ink-soft);
          }
          .opme-modal-valor {
            font-size: 14px; font-weight: 700; color: var(--primary);
          }
          .opme-modal-campo {
            display: flex; flex-direction: column; gap: 4px;
          }
          .opme-modal-campo label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-weight: 700;
            color: var(--ink-soft);
          }
          .opme-modal-campo input {
            padding: 8px 10px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--bg-elevated);
            color: var(--ink);
            font-size: 13px;
            outline: none;
            font-family: inherit;
          }
          .opme-modal-campo input:focus { border-color: var(--primary); }
          .opme-modal-info {
            font-size: 11px;
            color: var(--ink-soft);
            padding: 8px 12px;
            background: #E8F5E9;
            border-left: 3px solid #0A7A5A;
            border-radius: 4px;
            line-height: 1.45;
          }
          .opme-modal-footer {
            padding: 12px 18px;
            border-top: 1px solid var(--border);
            display: flex; justify-content: flex-end; gap: 8px;
            background: var(--bg-sunken);
          }

          /* V716: seletor de export agora é o menu padrão central (.atlas-menu-exp) */

          /* MODAL "PAGO EM OUTRO REPASSE" — variante de alerta vermelho */
          .opme-modal-overlay-outro {
            background: rgba(155, 30, 30, 0.32);
          }
          .opme-modal-outro {
            max-width: 540px;
          }
          .opme-modal-head-outro {
            background: linear-gradient(135deg, #FFEBEE 0%, #FFCDD2 100%) !important;
          }
          .opme-modal-head-outro h3 {
            color: #8B1515 !important;
          }
          .opme-modal-head-outro .opme-modal-fechar {
            color: #8B1515;
          }

          .opme-modal-paciente {
            padding: 8px 12px;
            background: var(--bg-sunken);
            border-radius: 6px;
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          .opme-modal-paciente strong {
            font-size: 13px;
            color: var(--ink);
          }
          .opme-modal-paciente small {
            font-size: 11px;
            color: var(--ink-faint);
          }

          .opme-modal-comparativo {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            gap: 8px;
            align-items: stretch;
            margin-top: 4px;
          }
          .opme-modal-comp-bloco {
            padding: 10px 12px;
            border-radius: 8px;
            text-align: center;
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .opme-modal-comp-atual {
            background: rgba(0, 80, 115, 0.07);
            border: 1px solid var(--primary);
          }
          .opme-modal-comp-pago {
            background: #FFEBEE;
            border: 1px solid #C62828;
          }
          .opme-modal-comp-titulo {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--ink-soft);
          }
          .opme-modal-comp-pago .opme-modal-comp-titulo {
            color: #8B1515;
          }
          .opme-modal-comp-mes {
            font-family: var(--font-display, serif);
            font-size: 17px;
            font-weight: 700;
            color: var(--primary);
            letter-spacing: 0.02em;
          }
          .opme-modal-comp-pago .opme-modal-comp-mes {
            color: #8B1515;
          }
          .opme-modal-comp-sub {
            font-size: 10.5px;
            color: var(--ink-faint);
            line-height: 1.3;
          }
          .opme-modal-comp-seta {
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            font-weight: 700;
            color: var(--ink-faint);
          }

          .opme-modal-obs-bloco {
            padding: 8px 12px;
            background: var(--bg-sunken);
            border-radius: 6px;
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .opme-modal-obs-texto {
            font-size: 13px;
            color: var(--ink);
            line-height: 1.4;
          }
          .opme-modal-obs-vazia .opme-modal-obs-texto {
            color: var(--ink-faint);
            font-size: 11.5px;
          }

          .opme-modal-valores {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }
          .opme-modal-valor-item {
            padding: 8px 12px;
            background: var(--bg-sunken);
            border-radius: 6px;
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          .opme-modal-valor-item strong {
            font-size: 14px;
            color: var(--primary);
          }

          .opme-modal-alerta-outro {
            padding: 10px 14px;
            background: #FFEBEE;
            border-left: 3px solid #C62828;
            border-radius: 4px;
            font-size: 11.5px;
            color: #8B1515;
            line-height: 1.5;
          }
          .opme-modal-desfazer {
            color: #8B1515 !important;
            border-color: #C62828 !important;
          }
          .opme-modal-desfazer:hover {
            background: rgba(198, 40, 40, 0.08) !important;
          }
        </style>
      `;
    }
  };
})();
