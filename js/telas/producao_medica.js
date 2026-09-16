/**
 * ============================================================================
 * PRODUÇÃO MÉDICA — Balanço por médico (produção + repasse + desempenho)
 * ----------------------------------------------------------------------------
 * Fonte: Produção QVIS (linhas_producao) + Base Tabela (tabela_repasse) +
 *        Desempenho consolidado (AtlasRelatorios.desempenhoLinhas — 12 fichários).
 *
 * Regra (linha a linha) — igual Auditoria/Calcular, colapsada no executante:
 *   • Elegível: Classificação Produto ∈ {filtro} (padrão CONSULTA/EXAME/PROCEDIMENTO).
 *   • Procedimento casado pela coluna PRODUTO com a Base Tabela.
 *   • Executante = Cirurgião; se vazio, Médico (1 dono por linha).
 *   • Recebido ("o todo") = Executante + (Indicante/Solicitante, 1x) + Médico Laudo + Auxiliar.
 *       Convênio → valor fixo; Particular → percentual × Valor R$.
 *   • Produção bruta = Valor R$ (conta mesmo sem Base Tabela → recebido 0).
 *   • SUS: produção conta; repasse 0.
 *
 * Layout (memória primária): cards PROD. TOTAL/CONV/PART/SUS/DESEMPENHO (R$ + % do total),
 *   abas consolidado / produção médica / desempenho (consolidado), botão de filtro de
 *   Classificação Produto (canto sup. dir.) p/ incluir os excluídos e ver o impacto.
 * ============================================================================
 */
(function () {
  'use strict';
  const App = window.App;

  function normalizar(s) {
    if (s == null) return '';
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function fmtBRL(v) { return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Todas as classificações (a primeira leva é o padrão; o resto é "excluído")
  const CLASS_ALL = [
    ['CONSULTA', 'Consulta'], ['EXAME', 'Exame'], ['PROCEDIMENTO', 'Procedimento'],
    ['OPME', 'OPME'], ['MATERIAL', 'Material'], ['MEDICAMENTO', 'Medicamento'],
    ['TAXA', 'Taxa'], ['GAS', 'Gás'], ['DIARIA', 'Diária']
  ];
  const CLASS_PADRAO = ['CONSULTA', 'EXAME', 'PROCEDIMENTO'];

  // ── V485: filtro por PRODUTO, por card (CONV/PART). Guarda só os OVERRIDES (produtos que o usuário
  //    inverteu vs. o default por classe). Default: incluído se classe ∈ CLASS_PADRAO. incluído = def ⊕ over.
  function pfGarantir() {
    try { Banco.executar(`CREATE TABLE IF NOT EXISTS config_prod_filtro (card TEXT NOT NULL, produto TEXT NOT NULL, PRIMARY KEY(card, produto))`); } catch (e) {}
  }
  let _pfCache = null;
  function pfOverrides() {
    if (_pfCache) return _pfCache;
    pfGarantir();
    const o = { CONV: new Set(), PART: new Set() };
    try {
      (Banco.query(`SELECT card, produto FROM config_prod_filtro`) || []).forEach(r => {
        const c = String(r.card || '').toUpperCase();
        if (o[c]) o[c].add(String(r.produto || ''));   // guardado já normalizado
      });
    } catch (e) {}
    _pfCache = o;
    return o;
  }
  function pfInvalidar() { _pfCache = null; }
  // incluído no card? default (classe ∈ CLASS_PADRAO) XOR override
  function pfInclui(card, classeNorm, produtoRaw, over) {
    const def = CLASS_PADRAO.includes(classeNorm);
    const ov = !!(over[card] && over[card].has(normalizar(produtoRaw)));
    return def !== ov;
  }
  function pfSalvar(card, overSet) {
    pfGarantir();
    try {
      Banco.executar(`DELETE FROM config_prod_filtro WHERE card = ?`, [card]);
      for (const prodNorm of overSet) Banco.executar(`INSERT OR REPLACE INTO config_prod_filtro (card, produto) VALUES (?, ?)`, [card, prodNorm]);
      Banco.salvar();
    } catch (e) { console.error('[producao-medica] pfSalvar', e); }
    pfInvalidar();
  }
  // Produtos distintos (produto + classe) do mês, por origem do card (CONV/PART).
  function pfProdutosDoCard(comp, card) {
    const alvo = card === 'CONV' ? 'CONV' : 'PART';
    const out = [];
    try {
      const rows = Banco.query(`SELECT DISTINCT produto, classificacao_produto FROM linhas_producao
        WHERE competencia = ? AND UPPER(COALESCE(tipo_recebimento,'')) LIKE ?`, [comp, alvo + '%']) || [];
      for (const r of rows) {
        const p = String(r.produto || '').trim();
        if (!p) continue;
        out.push({ produto: p, classe: normalizar(r.classificacao_produto), classeRaw: String(r.classificacao_produto || '—') });
      }
    } catch (e) {}
    return out;
  }

  // V974: por regra, ao ABRIR o módulo a ilha "Vínculo" do botão flutuante vem
  // com Interno + Híbrido marcados e Externo DESMARCADO (o clique nos chips
  // segue alternando enquanto a tela está aberta).
  const TIPOS_INICIAIS = ['INTERNO', 'HIBRIDO'];
  function estado() {
    if (!window.__prodMed) window.__prodMed = {};
    const st = window.__prodMed;
    if (st.competencia === undefined) st.competencia = null;
    if (!st.visao) st.visao = 'contabil';        // V253: 'contabil' | 'gerencial' (switch)
    if (!st.aba) st.aba = 'producao';            // 'consolidado' | 'producao' | 'desempenho'
    if (st.medicoSel === undefined) st.medicoSel = null;
    if (st.busca === undefined) st.busca = '';
    if (!st.medicosSel) st.medicosSel = [];                  // V263: seleção de médicos (combo multi)
    if (st.medComboAberto === undefined) st.medComboAberto = false;
    if (st.buscaAdm === undefined) st.buscaAdm = '';
    if (!st.ord) st.ord = 'prod';
    if (!st.tipos) st.tipos = TIPOS_INICIAIS.slice();   // V974: EXTERNO nasce DESMARCADO
    if (!st.classes) st.classes = CLASS_PADRAO.slice();
    if (st.filtroAberto === undefined) st.filtroAberto = false;
    if (st.impostoAberto === undefined) st.impostoAberto = false;
    if (st.popJustOpened === undefined) st.popJustOpened = false;
    if (st.dados === undefined) st.dados = null;
    if (st.compDDAberto === undefined) st.compDDAberto = false;   // V923: drilldown de competência
    if (st.compDDAnos === undefined) st.compDDAnos = null;        // V923: anos expandidos
    if (st.regrasAberto === undefined) st.regrasAberto = false;   // V923: gaveta de regras
    return st;
  }

  // ── Auxiliares (papéis, base tabela, procedimentos, médicos) ────────────────
  function carregarAux() {
    const papeis = Banco.query(`SELECT id, nome FROM papeis`) || [];
    const idP = {}; for (const p of papeis) idP[normalizar(p.nome)] = p.id;

    const regras = new Map();
    for (const r of (Banco.query(`SELECT procedimento_id, papel_id, fonte_pagadora, valor, percentual FROM tabela_repasse WHERE ativo = 1`) || [])) {
      const fonte = normalizar(r.fonte_pagadora) || 'TODAS';
      if (!regras.has(r.procedimento_id)) regras.set(r.procedimento_id, {});
      const pf = regras.get(r.procedimento_id);
      if (!pf[fonte]) pf[fonte] = {};
      pf[fonte][r.papel_id] = { valor: r.valor, percentual: r.percentual };
    }

    const mapProc = new Map();
    for (const p of (Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM procedimentos`) || [])) {
      if (p.nome_normalizado) mapProc.set(p.nome_normalizado, p.id);
      mapProc.set(normalizar(p.nome_oficial), p.id);
    }

    const mapMed = new Map();
    for (const m of (Banco.query(`SELECT id, nome_oficial, nome_normalizado, tipo_vinculo FROM medicos`) || []))
      mapMed.set(m.nome_normalizado || normalizar(m.nome_oficial), { id: m.id, nome: m.nome_oficial, tipo: m.tipo_vinculo ? normalizar(m.tipo_vinculo) : 'SEM_TIPO' });
    for (const s of (Banco.query(`SELECT s.grafia_normalizada AS g, m.id AS id, m.nome_oficial AS nome, m.tipo_vinculo AS tv FROM sinonimos_medico s JOIN medicos m ON m.id = s.medico_id`) || []))
      if (s.g) mapMed.set(s.g, { id: s.id, nome: s.nome, tipo: s.tv ? normalizar(s.tv) : 'SEM_TIPO' });

    // V274: dados das regras ATLAS adicionais (alinhar Contábil ao Calcular/Auditoria) ──────────
    // (a) Excluído por tipo — TIPOS_HABILITADOS + override manual por médico (calcular_medico_override)
    const TIPOS_DEFAULT = new Set(['INTERNO', 'HIBRIDO', 'EXTERNO']);
    let tiposHab = new Set(TIPOS_DEFAULT);
    try { const r = Banco.query(`SELECT valor FROM config_calcular WHERE chave='TIPOS_HABILITADOS'`); if (r && r[0] && r[0].valor) tiposHab = new Set(String(r[0].valor).split(',').map(x => x.trim()).filter(Boolean)); } catch (_) {}
    const overridesMed = new Map();
    try { (Banco.query(`SELECT nome_normalizado, incluir FROM calcular_medico_override`) || []).forEach(o => overridesMed.set(normalizar(o.nome_normalizado), (o.incluir === 1 || o.incluir === true || String(o.incluir) === '1'))); } catch (_) {}
    // (b) Consulta paga pela Produção — valor FIXO por consulta de convênio (config_consulta_producao)
    let cpAtiva = false; const cpValorPorId = new Map();
    try {
      Banco.executar(`CREATE TABLE IF NOT EXISTS config_consulta_producao (medico_id INTEGER PRIMARY KEY, valor REAL NOT NULL DEFAULT 0)`);
      Banco.executar(`CREATE TABLE IF NOT EXISTS config_consulta_producao_meta (chave TEXT PRIMARY KEY, valor TEXT)`);
      const a = Banco.queryUnica(`SELECT valor FROM config_consulta_producao_meta WHERE chave='ativo'`);
      cpAtiva = !!(a && String(a.valor) === '1');
      if (cpAtiva) (Banco.query(`SELECT medico_id, valor FROM config_consulta_producao`) || []).forEach(c => cpValorPorId.set(c.medico_id, Number(c.valor) || 0));
    } catch (_) {}


    // ── V651: PARIDADE COM O MOTOR PRINCIPAL (Calcular) ─────────────────────
    // (1) VERSÕES da Base Tabela (V563): as regras aplicadas são as CONGELADAS
    //     da versão vigente na DATA DE ADMISSÃO da linha de produção — com a
    //     padrão 1.0 pra datas anteriores a todas as vigências (V636) e a
    //     tabela viva valendo SÓ pra regra nunca publicada em versão alguma (V639).
    let versoesTab = [];
    try {
      if (window.AtlasVersoesTabela && window.AtlasVersoesTabela.garantir())
        versoesTab = Banco.query(`SELECT id, numero, data_vigencia FROM tabela_versoes ORDER BY data_vigencia, id`) || [];
    } catch (_) {}
    const numeroDe = (v) => Number(String(v.numero).replace(',', '.')) || 0;
    const versaoBaseline = versoesTab.length
      ? versoesTab.reduce((a, b) => (numeroDe(b) < numeroDe(a) ? b : a), versoesTab[0]) : null;
    function montarMapaRegras(rows) {
      const m = new Map();
      for (const r of rows) {
        const fonte = normalizar(r.fonte_pagadora) || 'TODAS';
        if (!m.has(r.procedimento_id)) m.set(r.procedimento_id, {});
        const pf = m.get(r.procedimento_id);
        if (!pf[fonte]) pf[fonte] = {};
        if (!pf[fonte][r.papel_id]) pf[fonte][r.papel_id] = { valor: r.valor, percentual: r.percentual };
      }
      return m;
    }
    const _regrasVersaoCache = new Map();
    function regrasDaVersao(vid) {
      let m = _regrasVersaoCache.get(vid);
      if (m) return m;
      let rows = [];
      try {
        rows = Banco.query(
          `SELECT h.procedimento_id, h.papel_id, h.fonte_pagadora, h.valor, h.percentual
             FROM tabela_repasse_hist h
             JOIN procedimentos_hist ph ON ph.versao_id = h.versao_id AND ph.procedimento_id = h.procedimento_id
            WHERE h.versao_id = ? AND h.ativo = 1 AND ph.repassavel = 1`, [vid]) || [];
      } catch (_) {}
      m = montarMapaRegras(rows);
      _regrasVersaoCache.set(vid, m);
      return m;
    }
    let keysPub = null;
    if (versoesTab.length) {
      keysPub = new Set();
      try {
        for (const r of (Banco.query(`SELECT DISTINCT procedimento_id, papel_id, fonte_pagadora FROM tabela_repasse_hist WHERE ativo = 1`) || []))
          keysPub.add(`${r.procedimento_id}|${r.papel_id}|${normalizar(r.fonte_pagadora) || 'TODAS'}`);
      } catch (_) {}
    }
    function versaoDe(dataAdm) {
      if (!versoesTab.length) return null;
      const d = String(dataAdm || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return versoesTab[versoesTab.length - 1];
      let v = null;
      for (const c of versoesTab) { if (c.data_vigencia <= d) v = c; else break; }
      return v || versaoBaseline;
    }

    // (2) EXCEÇÕES por médico (tabela_repasse_excecao) — sobrescrevem a base
    const mapExc = new Map();
    try {
      // V658: extracao='PRODUCAO' → paga pelo canal de Desempenho ("Exceção · Produção");
      // aqui a linha fica ZERADA (nem exceção nem regra geral) pra não duplicar.
      for (const e of (Banco.query(`SELECT medico_id, procedimento_id, papel_id, fonte_pagadora, valor, percentual, UPPER(COALESCE(extracao,'QVIS')) AS extracao FROM tabela_repasse_excecao WHERE ativo = 1`) || []))
        mapExc.set(`${e.medico_id}|${e.procedimento_id}|${e.papel_id}|${normalizar(e.fonte_pagadora || 'TODAS')}`, e);
    } catch (_) {}

    // (3) PACOTES de consulta por convênio (mãe + exames inclusos + filha p/ especialidade)
    const mapPacotes = new Map(), mapAliasPacote = new Map(), mapProcsPacote = new Map();
    const medicosEspPacote = new Set();
    try {
      for (const pk of (Banco.query(`SELECT id, convenio_nome, convenio_label, valor_consulta, percentual_consulta, valor, percentual FROM pacote_convenio WHERE ativo = 1`) || []))
        mapPacotes.set(pk.convenio_nome, pk);
      for (const a of (Banco.query(`SELECT a.alias_nome, p.id, p.convenio_nome, p.convenio_label, p.valor_consulta, p.percentual_consulta, p.valor, p.percentual FROM pacote_alias a JOIN pacote_convenio p ON p.id = a.pacote_id WHERE p.ativo = 1`) || []))
        mapAliasPacote.set(a.alias_nome, a);
      for (const r of (Banco.query(`SELECT pacote_id, procedimento_id FROM pacote_procedimento WHERE ativo = 1`) || [])) {
        if (!mapProcsPacote.has(r.pacote_id)) mapProcsPacote.set(r.pacote_id, new Set());
        mapProcsPacote.get(r.pacote_id).add(r.procedimento_id);
      }
      let espIds = [];
      try {
        const raw = Banco.queryUnica(`SELECT valor FROM config_sistema WHERE chave='PACOTE_CONSULTA_ESPECIALIDADES'`);
        if (raw && raw.valor != null && String(raw.valor).trim() !== '') {
          const arr = JSON.parse(raw.valor);
          if (Array.isArray(arr)) espIds = arr.map(Number).filter(x => x > 0);
        }
      } catch (_) {}
      if (!espIds.length) {
        try {
          const ret = Banco.queryUnica(`SELECT id FROM especialidades WHERE UPPER(TRIM(nome))='RETINA'`);
          if (ret && ret.id != null) espIds = [Number(ret.id)];
        } catch (_) {}
      }
      if (espIds.length) {
        const ph = espIds.map(() => '?').join(',');
        for (const rr of (Banco.query(`SELECT DISTINCT medico_id AS mid FROM medico_especialidades WHERE especialidade_id IN (${ph})`, espIds) || []))
          if (rr.mid != null) medicosEspPacote.add(rr.mid);
      }
    } catch (_) {}

    // (4) PERFIS PARTICULARES (V219/V221/V243) — admissão com perfil ativo é
    //     paga pela tabela do perfil (Convênio por padrão), com overrides por
    //     procedimento (tabela ou valor fixo 1× por admissão+procedimento)
    const perfisAtivos = new Set(), mapPerfilAjuste = new Map(), mapPerfilProcTabela = new Map(), mapPerfilProcValor = new Map();
    try {
      const regraIdToNorm = new Map();
      for (const rp of (Banco.query(`SELECT id, perfil, tabela FROM perfil_regra WHERE ativo = 1`) || [])) {
        const pn = normalizar(rp.perfil);
        const tb = String(rp.tabela || 'CONVENIO').toUpperCase().trim() === 'PARTICULAR' ? 'PARTICULAR' : 'CONVENIO';
        perfisAtivos.add(pn);
        mapPerfilAjuste.set(pn, { perfilNome: rp.perfil, tabela: tb });
        regraIdToNorm.set(rp.id, pn);
      }
      for (const rp of (Banco.query(`SELECT regra_id, procedimento_id, tabela FROM perfil_regra_proc WHERE ativo = 1 AND tabela IS NOT NULL AND TRIM(tabela) <> ''`) || [])) {
        const pn = regraIdToNorm.get(rp.regra_id); if (!pn) continue;
        const tb = String(rp.tabela).toUpperCase().trim() === 'PARTICULAR' ? 'PARTICULAR' : 'CONVENIO';
        if (!mapPerfilProcTabela.has(pn)) mapPerfilProcTabela.set(pn, new Map());
        mapPerfilProcTabela.get(pn).set(rp.procedimento_id, tb);
      }
      for (const rp of (Banco.query(`SELECT regra_id, procedimento_id, valor FROM perfil_regra_proc WHERE ativo = 1 AND valor IS NOT NULL`) || [])) {
        const pn = regraIdToNorm.get(rp.regra_id); if (!pn) continue;
        if (!mapPerfilProcValor.has(pn)) mapPerfilProcValor.set(pn, new Map());
        mapPerfilProcValor.get(pn).set(rp.procedimento_id, Number(rp.valor) || 0);
      }
    } catch (_) {}

    // (5) DUPLICIDADE histórica — isenções (a lista de pagos é por competência, no baseDados)
    const dupExcMed = new Set(), dupExcProc = new Set();
    try {
      for (const d of (Banco.query(`SELECT tipo, chave FROM duplicidade_excecao`) || []))
        (d.tipo === 'medico' ? dupExcMed : dupExcProc).add(normalizar(d.chave));
    } catch (_) {}

    return {
      ID_EXEC: idP['EXECUTANTE'], ID_AUX: idP['AUXILIAR'], ID_LAUDO: idP['MEDICO LAUDO'],
      ID_SOLIC: idP['SOLICITANTE'], ID_INDIC: idP['INDICANTE'], regras, mapProc, mapMed,
      tiposHab, overridesMed, cpAtiva, cpValorPorId,
      // V651
      versaoDe, regrasDaVersao, keysPub,
      mapExc, mapPacotes, mapAliasPacote, mapProcsPacote, medicosEspPacote,
      perfisAtivos, mapPerfilAjuste, mapPerfilProcTabela, mapPerfilProcValor,
      dupExcMed, dupExcProc
    };
  }

  // V274: médicos com Períodos no mês (de-para expandido) — p/ a regra Períodos × Matriz
  const _periodosCache = new Map();
  function medicosPeriodosSet(comp) {
    if (_periodosCache.has(comp)) return _periodosCache.get(comp);
    const set = new Set();
    try {
      const nomesPer = Banco.query(`SELECT DISTINCT nome_normalizado FROM periodos_linhas WHERE mes_ref = ?`, [comp]) || [];
      if (nomesPer.length) {
        const nomeParaId = new Map(); const idParaNomes = new Map();
        const add = (nn, id) => { if (!nn || id == null) return; nomeParaId.set(nn, id); if (!idParaNomes.has(id)) idParaNomes.set(id, []); idParaNomes.get(id).push(nn); };
        try { (Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM medicos`) || []).forEach(m => add(normalizar(m.nome_normalizado || m.nome_oficial), m.id)); } catch (_) {}
        try { (Banco.query(`SELECT grafia, grafia_normalizada, medico_id FROM sinonimos_medico`) || []).forEach(x => add(normalizar(x.grafia_normalizada || x.grafia), x.medico_id)); } catch (_) {}
        for (const row of nomesPer) {
          const nn = normalizar(row.nome_normalizado); if (!nn) continue;
          set.add(nn);
          const id = nomeParaId.get(nn);
          if (id != null && idParaNomes.has(id)) idParaNomes.get(id).forEach(x => set.add(x));
        }
      }
    } catch (e) { console.warn('[producao-medica] medicosPeriodosSet', e); }
    _periodosCache.set(comp, set);
    return set;
  }

  function fonteDaLinha(tipo) {
    const n = normalizar(tipo);
    if (n === 'CONVENIO') return 'CONVENIO';
    if (n === 'PARTICULAR') return 'PARTICULAR';
    if (n === 'SUS') return 'SUS';
    return null;
  }
  function resolverMed(aux, nome) {
    return aux.mapMed.get(normalizar(nome)) || { id: null, nome: String(nome || '—').trim(), tipo: 'SEM_TIPO' };
  }
  function chaveMed(m, nomeRaw) { return m.id != null ? 'id:' + m.id : 'nome:' + normalizar(nomeRaw); }

  // ── Desempenho consolidado (cache por competência) ──────────────────────────
  // V672: chave carimbada com Banco._versao — mudou regra/exceção/bloqueio em
  // qualquer tela, o cache morre sozinho (antes só a reimportação invalidava,
  // e a Produção Médica podia mostrar repasse com regras VELHAS).
  const _desCache = new Map();
  const _cacheDelComp = (mapa, comp) => { for (const k of [...mapa.keys()]) if (String(k).indexOf(comp + '|') === 0) mapa.delete(k); };
  function desempenhoDados(comp, aux) {
    const dKey = comp + '|' + (Banco._versao || 0);
    if (_desCache.has(dKey)) return _desCache.get(dKey);
    if (_desCache.size > 40) _desCache.clear();
    let linhas = [];
    try { if (window.AtlasRelatorios && AtlasRelatorios.desempenhoLinhas) linhas = AtlasRelatorios.desempenhoLinhas(comp) || []; }
    catch (e) { linhas = []; }
    const porMed = new Map(); const modulos = new Set(); const rows = [];
    for (const l of linhas) {
      const v = Number(l.valor) || 0;
      const m = resolverMed(aux, l.profissional);
      const ch = chaveMed(m, l.profissional);
      const tipo = m.tipo || 'SEM_TIPO';
      if (v) {
        if (!porMed.has(ch)) porMed.set(ch, { nome: m.nome, cadastrado: m.id != null, tipo, valor: 0, mod: {} });
        const reg = porMed.get(ch);
        reg.valor += v; reg.mod[l.modulo] = (reg.mod[l.modulo] || 0) + v; modulos.add(l.modulo);
      }
      rows.push(Object.assign({}, l, { _tipo: tipo, _nomeMed: m.nome, _cad: m.id != null }));
    }
    const r = { porMed, modulos: [...modulos].sort(), rows };
    _desCache.set(dKey, r);
    return r;
  }

  // ── Cálculo principal ───────────────────────────────────────────────────────
  // Processa as linhas UMA vez por competência (pesado: SQL + matching). O filtro
  // de classificação depois é só re-soma sobre este cache → toggles ficam instantâneos.
  // ── V486: HÍBRIDO do repasse CONTÁBIL. Linha CLASS_PADRÃO sem regra na Base Tabela → usa o REPASSADO
  //    REAL do QVIS do executante, EXCLUINDO linhas cujo (admissão+médico) tenha fichário no DESEMPENHO
  //    (senão duplicaria). Só afeta a visão Contábil (o gerencial já usa o Consolidado). ──
  function hibFichariosMed(comp, aux) {
    const s = new Set();
    try {
      let linhas = [];
      if (window.AtlasRelatorios && AtlasRelatorios.desempenhoLinhas) linhas = AtlasRelatorios.desempenhoLinhas(comp) || [];
      for (const l of linhas) {
        const adm = normalizar(l.admissao || l.cod_admissao || '');
        const mid = resolverMed(aux, l.profissional || l.nome_profissional || '').id;
        if (adm && mid != null) s.add(adm + '|' + mid);
      }
    } catch (e) {}
    return s;
  }
  function hibQvisRepasse(comp, aux) {
    const m = new Map();
    try {
      const rows = Banco.query(`SELECT admissao, procedimento, procedimento_normalizado, nome_profissional, repassado
                                FROM linhas_qvis WHERE competencia = ?`, [comp]) || [];
      for (const r of rows) {
        const mid = resolverMed(aux, r.nome_profissional || '').id;
        if (mid == null) continue;
        const adm = normalizar(r.admissao || '');
        const proc = normalizar(r.procedimento_normalizado || r.procedimento || '');
        if (!adm || !proc) continue;
        const k = adm + '|' + proc + '|' + mid;
        m.set(k, (m.get(k) || 0) + (Number(r.repassado) || 0));
      }
    } catch (e) {}
    return m;
  }

  const _baseCache = new Map();
  function baseDados(competencia) {
    // V672: carimbo Banco._versao — regra alterada em qualquer tela invalida
    const bKey = competencia + '|' + (Banco._versao || 0);
    if (_baseCache.has(bKey)) return _baseCache.get(bKey);
    if (_baseCache.size > 40) _baseCache.clear();
    const aux = carregarAux();
    const linhas = Banco.query(
      `SELECT id, cod_admissao, data_admissao, produto, procedimento_principal, classificacao_produto, tipo_recebimento,
              convenio, unidade, valor, cirurgiao, medico, indicante, perfil_particular
         FROM linhas_producao WHERE competencia = ?`, [competencia]) || [];
    // V651: pagos em competências ANTERIORES (duplicidade histórica do motor)
    const pagosAnt = new Map();
    try {
      for (const row of (Banco.query(
        `SELECT competencia, cod_admissao, procedimento_norm, papel_id FROM repasse_pagos
          WHERE competencia < ? ORDER BY competencia ASC`, [competencia]) || [])) {
        const k = `${row.cod_admissao}|${row.procedimento_norm}|${row.papel_id}`;
        if (!pagosAnt.has(k)) pagosAnt.set(k, row.competencia);
      }
    } catch (_) {}
    const hibFich = hibFichariosMed(competencia, aux);
    const hibQvis = hibQvisRepasse(competencia, aux);

    // V651: resolutor de regra com VERSÕES (V563/V636/V639) + EXCEÇÕES por médico.
    // A versão vigente na data de admissão manda; a viva só preenche chave
    // (proc+papel+fonte) nunca publicada em versão alguma.
    function regraDe(regrasV, procId, papelId, fonteN) {
      if (procId == null || papelId == null) return null;
      const pega = (m) => {
        const pf = m ? m.get(procId) : null;
        if (!pf) return null;
        return (pf[fonteN] && pf[fonteN][papelId]) || (pf['TODAS'] && pf['TODAS'][papelId]) || null;
      };
      if (regrasV) {
        const rc = pega(regrasV);
        if (rc) return rc;
        const podeViva = (f) => !(aux.keysPub && aux.keysPub.has(`${procId}|${papelId}|${f}`));
        const pfViva = aux.regras.get(procId);
        if (pfViva) {
          if (pfViva[fonteN] && pfViva[fonteN][papelId] && podeViva(fonteN)) return pfViva[fonteN][papelId];
          if (pfViva['TODAS'] && pfViva['TODAS'][papelId] && podeViva('TODAS')) return pfViva['TODAS'][papelId];
        }
        return null;
      }
      return pega(aux.regras);
    }
    function valPapel651(regrasV, procId, papelId, fonteN, medId, produzido) {
      if (papelId == null) return 0;
      let e = null;
      if (medId != null && procId != null) {
        e = aux.mapExc.get(`${medId}|${procId}|${papelId}|${fonteN}`)
         || aux.mapExc.get(`${medId}|${procId}|${papelId}|TODAS`) || null;
      }
      // V658: exceção com extração via PRODUÇÃO — pago pelo Desempenho
      // ("Exceção · Produção"); a linha aqui fica 0 (sem fallback pra regra geral).
      if (e && String(e.extracao || 'QVIS') === 'PRODUCAO') return 0;
      if (!e) e = regraDe(regrasV, procId, papelId, fonteN);
      if (!e) return 0;
      if (e.valor != null) return Number(e.valor) || 0;
      if (e.percentual != null) return (Number(e.percentual) || 0) * produzido;
      return 0;
    }
    function temRegraProc(regrasV, procId, fonteN) {
      if (procId == null) return false;
      if (regrasV && regrasV.has(procId)) return true;
      if (regrasV) {
        // proc fora da versão: a viva só conta se NUNCA publicado (V639)
        const pfViva = aux.regras.get(procId);
        if (!pfViva) return false;
        for (const f of [fonteN, 'TODAS']) {
          const papeis = pfViva[f];
          if (!papeis) continue;
          for (const pid of Object.keys(papeis))
            if (!(aux.keysPub && aux.keysPub.has(`${procId}|${pid}|${f}`))) return true;
        }
        return false;
      }
      return aux.regras.has(procId);
    }

    const itens = [];
    const periodosSet = medicosPeriodosSet(competencia);   // V274
    const vistosPerfilValor = new Set();   // V651: valor fixo do perfil pago 1× por admissão+proc
    const vistosFilhaPacote = new Set();   // V651: filha (exames inclusos) 1× por admissão+pacote
    for (const l of linhas) {
      const fonte = fonteDaLinha(l.tipo_recebimento);
      const execNome = (l.cirurgiao && String(l.cirurgiao).trim()) || (l.medico && String(l.medico).trim()) || '';
      // V654: linha sem fonte/executante continua FORA da matriz (marcada _pulada),
      // mas entra na Extração Contábil 2 com repasse "—".
      const pulada = !fonte || !execNome;
      const produzido = Number(l.valor) || 0;

      const classe = normalizar(l.classificacao_produto);
      const m = resolverMed(aux, execNome);
      const execN = normalizar(execNome);
      const ehConsulta = classe === 'CONSULTA' || normalizar(l.produto || '').includes('CONSULTA');
      // V274 — Excluído por tipo: executante de vínculo NÃO habilitado (ou override=false) não recebe repasse.
      const ov = aux.overridesMed.get(execN);
      const passaTipo = ov === true ? true : ov === false ? false : aux.tiposHab.has(m.tipo || 'SEM_TIPO');

      let todo = 0, rExec = 0, rInd = 0, rAux = 0, rLaudo = 0;
      // V654 (Extração Contábil 2): vtab = versão da tabela usada na regra;
      // marca = '—' (linha que não gera repasse) ou 'SEM REGRA' (proc sem regra na Base)
      let vtab = '—', marca = null;
      // V682: SUS entra no repasse (paga pela tabela SUS da Base) — antes só Conv/Part
      if (pulada || !CLASS_PADRAO.includes(classe) || (fonte !== 'CONVENIO' && fonte !== 'PARTICULAR' && fonte !== 'SUS')) marca = '—';
      // V651: versão da Base Tabela vigente na DATA DE ADMISSÃO desta linha
      const versaoLin = aux.versaoDe ? aux.versaoDe(l.data_admissao) : null;
      const regrasV = versaoLin ? aux.regrasDaVersao(versaoLin.id) : null;
      const admTrim = String(l.cod_admissao || '').trim();
      const indicanteMed = l.indicante ? resolverMed(aux, l.indicante) : null;
      // V651 — duplicidade histórica: papel já pago em competência anterior não conta de novo
      const prodN = normalizar(l.produto || ''), prodN2 = normalizar(l.procedimento_principal || '');
      const dupIsento = aux.dupExcMed.has(execN) || aux.dupExcProc.has(prodN);
      const jaPago = (papelId) => {
        if (dupIsento || !admTrim || papelId == null) return false;
        return pagosAnt.has(`${admTrim}|${prodN}|${papelId}`) || (prodN2 && pagosAnt.has(`${admTrim}|${prodN2}|${papelId}`));
      };
      // V258 (#1): repasse só sobre produção > 0. V261 (#3): só classificações PADRÃO geram repasse — as "excluídas"
      // (OPME, Material, Medicamento, Taxa, Gás, Diária) NÃO geram repasse de produção. A linha continua na produção.
      if (!pulada && passaTipo && produzido > 0 && CLASS_PADRAO.includes(classe) && (fonte === 'CONVENIO' || fonte === 'PARTICULAR' || fonte === 'SUS')) {
        // V651 — PERFIL PARTICULAR: admissão com perfil ativo paga pela tabela
        // do perfil (override por procedimento: tabela ou valor fixo 1×/adm+proc)
        let fonteRegra = fonte, perfilInfo = null, perfilValorFixo = null;
        const perfilN = normalizar(l.perfil_particular || '');
        if (fonte === 'PARTICULAR' && perfilN && aux.perfisAtivos.has(perfilN)) {
          perfilInfo = aux.mapPerfilAjuste.get(perfilN) || { tabela: 'CONVENIO' };
          const procIdPf = aux.mapProc.get(normalizar(l.produto));
          const ovVal = aux.mapPerfilProcValor.get(perfilN) ? aux.mapPerfilProcValor.get(perfilN).get(procIdPf) : null;
          if (ovVal != null && procIdPf != null) perfilValorFixo = Number(ovVal) || 0;
          else {
            const ovTab = aux.mapPerfilProcTabela.get(perfilN) ? aux.mapPerfilProcTabela.get(perfilN).get(procIdPf) : null;
            fonteRegra = ovTab || perfilInfo.tabela || 'CONVENIO';
          }
        }
        // V651 — PACOTE de consulta por convênio (só fonte CONVÊNIO)
        const convN = normalizar(l.convenio || '');
        const pacote = (fonte === 'CONVENIO' && convN)
          ? (aux.mapPacotes.get(convN) || aux.mapAliasPacote.get(convN) || null) : null;
        const procIdLin = aux.mapProc.get(normalizar(l.produto));
        const procsDoPacote = pacote ? aux.mapProcsPacote.get(pacote.id) : null;
        const ehExameDoPacote = !!(pacote && procsDoPacote && procIdLin != null && procsDoPacote.has(procIdLin) && !ehConsulta);

        if (perfilValorFixo != null) {
          // valor fixo do perfil: pago UMA vez por admissão+procedimento
          const kFix = admTrim + '|' + prodN + '|' + perfilN;
          if (!vistosPerfilValor.has(kFix)) { vistosPerfilValor.add(kFix); rExec = perfilValorFixo; todo = rExec; }
        } else if (aux.cpAtiva && fonte === 'CONVENIO' && ehConsulta && m.id != null && aux.cpValorPorId.has(m.id)) {
          // V274 — Consulta paga pela Produção: valor FIXO ao executante (sem indicante/aux/laudo)
          rExec = aux.cpValorPorId.get(m.id) || 0;
          todo = rExec;
        } else if (periodosSet.has(execN) && window.AtlasUnidadesRegras
                   && !AtlasUnidadesRegras.decidir({ unidade: l.unidade, nomeQvis: l.produto, classificacao: l.classificacao_produto, origem: fonte, medicoPeriodos: true }).paga) {
          // V274/V938 — Ajuste Unidades: médico do Períodos não recebe o que está DESMARCADO
          // na tela da Auditoria (padrão: consulta de Convênio fora da Matriz) → todo = 0
        } else if (pacote && ehConsulta) {
          // V651 — PACOTE: consulta-mãe paga o valor do pacote (sem ind/aux/laudo);
          // filha "exames inclusos" 1× por admissão quando o executante tem a especialidade
          if (pacote.valor_consulta != null) rExec = Number(pacote.valor_consulta) || 0;
          else if (pacote.percentual_consulta != null) rExec = (Number(pacote.percentual_consulta) || 0) * produzido;
          else {
            rExec = jaPago(aux.ID_EXEC) ? 0 : valPapel651(regrasV, procIdLin, aux.ID_EXEC, fonteRegra, m.id, produzido);
            vtab = (regrasV && regrasV.has(procIdLin)) ? ('v' + versaoLin.numero) : 'viva';   // V654
          }
          todo = rExec;
          if (m.id != null && aux.medicosEspPacote.has(m.id)) {
            const kF = admTrim + '|' + pacote.id;
            if (!vistosFilhaPacote.has(kF)) {
              vistosFilhaPacote.add(kF);
              const vf = pacote.valor != null ? (Number(pacote.valor) || 0)
                       : (pacote.percentual != null ? (Number(pacote.percentual) || 0) * produzido : 0);
              rExec += vf; todo += vf;
            }
          }
        } else if (ehExameDoPacote) {
          // V651 — exame incluso no pacote: já coberto pela filha (repasse 0)
        } else {
          const procId = procIdLin;
          if (temRegraProc(regrasV, procId, fonteRegra)) {
            rExec = jaPago(aux.ID_EXEC) ? 0 : valPapel651(regrasV, procId, aux.ID_EXEC, fonteRegra, m.id, produzido);
            rAux = jaPago(aux.ID_AUX) ? 0 : valPapel651(regrasV, procId, aux.ID_AUX, fonteRegra, null, produzido);
            rLaudo = jaPago(aux.ID_LAUDO) ? 0 : valPapel651(regrasV, procId, aux.ID_LAUDO, fonteRegra, null, produzido);
            const idMedInd = indicanteMed && indicanteMed.id != null ? indicanteMed.id : null;
            let vInd = jaPago(aux.ID_INDIC) ? 0 : valPapel651(regrasV, procId, aux.ID_INDIC, fonteRegra, idMedInd, produzido);
            if (!vInd) vInd = jaPago(aux.ID_SOLIC) ? 0 : valPapel651(regrasV, procId, aux.ID_SOLIC, fonteRegra, idMedInd, produzido);
            rInd = vInd;
            todo = rExec + rAux + rLaudo + rInd;
            // V654: versão que resolveu a regra — a da data de admissão; 'viva' quando a
            // chave nunca foi publicada em versão alguma (fallback V639) ou não há versões
            vtab = (regrasV && regrasV.has(procId)) ? ('v' + versaoLin.numero) : 'viva';
          } else {
            marca = 'SEM REGRA';   // V654: procedimento sem regra na Base (inclui o híbrido V486)
            if (m.id != null) {
              // V486: HÍBRIDO — sem regra na Base Tabela → usa o REPASSADO REAL do QVIS do executante,
              // desde que (admissão+médico) NÃO tenha fichário no DESEMPENHO (evita duplicar com o card).
              const admN = normalizar(l.cod_admissao || '');
              if (!hibFich.has(admN + '|' + m.id)) {
                const p1 = normalizar(l.produto || ''), p2 = normalizar(l.procedimento_principal || '');
                const v = hibQvis.get(admN + '|' + p1 + '|' + m.id) || hibQvis.get(admN + '|' + p2 + '|' + m.id) || 0;
                if (v > 0) { rExec = v; todo = v; }
              }
            }
          }
        }
      }
      itens.push({
        chave: chaveMed(m, execNome), nome: m.nome, cadastrado: m.id != null, tipo: m.tipo || 'SEM_TIPO',
        classe, fonte, produzido, recebido: todo,
        rExec, rInd, rAux, rLaudo,
        vtab, marca, _pulada: pulada, _lid: l.id,   // V654: Extração Contábil 2
        adm: l.cod_admissao, data: l.data_admissao, proc: l.produto, conv: l.convenio, unidade: l.unidade
      });
    }
    const des = desempenhoDados(competencia, aux);
    const r = { itens, des };
    _baseCache.set(bKey, r);
    return r;
  }

  // V253: GERENCIAL — repasse REAL do mês (Consolidado/snapshot) por médico.
  // Conv/Part pela ORIGEM; Desempenho pelas linhas status='Desempenho'. Respeita filtro de admissão.
  function gerencialPorMedico(competencia, adm) {
    const aux = carregarAux();
    const out = new Map();
    let linhas = [];
    try { if (window.AtlasRelatorios && AtlasRelatorios.linhasConsolidadoComp) linhas = AtlasRelatorios.linhasConsolidadoComp(competencia) || []; }
    catch (e) { console.error('[producao-medica] gerencial:', e); }
    for (const l of linhas) {
      if (adm && String(l.admissao || '').toUpperCase().indexOf(adm) < 0) continue;
      const m = resolverMed(aux, l.profissional);
      const ch = chaveMed(m, l.profissional);
      let r = out.get(ch);
      if (!r) { r = { nome: m.nome, tipo: m.tipo || 'SEM_TIPO', cadastrado: m.id != null, conv: 0, part: 0, sus: 0, des: 0, papeis: {} }; out.set(ch, r); }
      const valor = Number(l.valor) || 0;
      if (String(l.status || '').trim().toUpperCase() === 'DESEMPENHO') { r.des += valor; continue; }
      const o = String(l.origem || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (o.startsWith('CONV')) r.conv += valor;
      else if (o.startsWith('PART')) r.part += valor;
      else if (o.startsWith('SUS')) r.sus += valor;   // V259: SUS pronto (gerencial — repasse real se houver)
      const pap = (String(l.papel || '').trim()) || '—';   // V258 (#4): decomposição gerencial pelo PAPEL do snapshot
      r.papeis[pap] = (r.papeis[pap] || 0) + valor;
      // SUS / outros → repasse ~0, não soma
    }
    return out;
  }

  function calcular(competencia, classesArr, buscaAdm) {
    const base = baseDados(competencia);
    const classes = new Set(classesArr);
    const adm = (buscaAdm || '').trim().toUpperCase();
    const porMedico = new Map();
    function reg(ch, m, cad) {
      if (!porMedico.has(ch)) porMedico.set(ch, {
        nome: m.nome, cadastrado: cad, tipo: m.tipo || 'SEM_TIPO',
        convProd: 0, convReceb: 0, partProd: 0, partReceb: 0, susProd: 0, susReceb: 0,
        rExec: 0, rInd: 0, rAux: 0, rLaudo: 0,        // V258 (#4): decomposição por papel (Contábil)
        desemp: 0, desempMod: {}, papeisG: null, linhas: []
      });
      return porMedico.get(ch);
    }

    const _over = pfOverrides();
    for (const it of base.itens) {
      if (it._pulada) continue;   // V654: linha sem fonte/executante só existe pra Extração Contábil 2
      if (adm && String(it.adm || '').toUpperCase().indexOf(adm) < 0) continue;
      let incl;
      if (it.fonte === 'CONVENIO') incl = pfInclui('CONV', it.classe, it.proc, _over);
      else if (it.fonte === 'PARTICULAR') incl = pfInclui('PART', it.classe, it.proc, _over);
      else incl = classes.has(it.classe);   // SUS: mantém o filtro de Classificação (⚙)
      if (!incl) continue;
      const r = reg(it.chave, it, it.cadastrado);
      if (it.fonte === 'CONVENIO') { r.convProd += it.produzido; r.convReceb += it.recebido; }
      else if (it.fonte === 'PARTICULAR') { r.partProd += it.produzido; r.partReceb += it.recebido; }
      else { r.susProd += it.produzido; r.susReceb += it.recebido; }   // V682: SUS paga pela tabela SUS
      r.rExec += it.rExec || 0; r.rInd += it.rInd || 0; r.rAux += it.rAux || 0; r.rLaudo += it.rLaudo || 0;   // V258 (#4)
      r.linhas.push({ adm: it.adm, data: it.data, proc: it.proc, fonte: it.fonte, conv: it.conv, unidade: it.unidade, produzido: it.produzido, recebido: it.recebido });
    }

    // merge desempenho (não some quando filtrando por admissão — desempenho não é por admissão)
    if (!adm) {
      for (const [ch, d] of base.des.porMed) {
        let r = porMedico.get(ch);
        if (!r) r = reg(ch, { nome: d.nome, tipo: d.tipo }, d.cadastrado);
        r.desemp = d.valor; r.desempMod = d.mod;
        if (!r.cadastrado && d.cadastrado) r.cadastrado = true;
        if (r.tipo === 'SEM_TIPO' && d.tipo && d.tipo !== 'SEM_TIPO') r.tipo = d.tipo;
      }
    }

    // V253: anexa o repasse GERENCIAL (Consolidado) por médico (cria linha se médico só existir no gerencial)
    const ger = gerencialPorMedico(competencia, adm);
    for (const [ch, g] of ger) {
      let r = porMedico.get(ch);
      if (!r) r = reg(ch, { nome: g.nome, tipo: g.tipo }, g.cadastrado);
      r.convRecebG = g.conv; r.partRecebG = g.part; r.susRecebG = g.sus || 0; r.desempG = g.des; r.papeisG = g.papeis || {};   // V258 (#4) + V259 SUS
      if (!r.cadastrado && g.cadastrado) r.cadastrado = true;
      if (r.tipo === 'SEM_TIPO' && g.tipo && g.tipo !== 'SEM_TIPO') r.tipo = g.tipo;
    }

    const lista = [...porMedico.values()].map(r => ({
      ...r,
      convRecebG: r.convRecebG || 0, partRecebG: r.partRecebG || 0, desempG: r.desempG || 0,
      totalProd: r.convProd + r.partProd + r.susProd,
      totalReceb: r.convReceb + r.partReceb + (r.susReceb || 0),   // V682: + SUS
      totalGeral: r.convProd + r.partProd + r.susProd + r.desemp
    }));
    return { lista, desModulos: base.des.modulos, desRows: base.des.rows, _comp: competencia,
             _key: competencia + '|' + classesArr.slice().sort().join(',') + '|' + adm + '|' + (Banco._versao || 0) };   // V672
  }

  function competenciasDisponiveis() {
    return (Banco.query(`SELECT DISTINCT competencia FROM linhas_producao ORDER BY competencia DESC`) || [])
      .map(r => r.competencia).filter(Boolean);
  }
  // ── V271: snapshot CONTÁBIL congelado na consolidação ───────────────────────
  // Ao Consolidar, o Contábil do mês vira um retrato IMUTÁVEL. No mês consolidado,
  // a visão Contábil lê este snapshot; a Gerencial recalcula ao vivo (reflete reimport da produção).
  function mesConsolidado(comp) {
    if (!comp) return false;
    try { const r = Banco.queryUnica(`SELECT codigo FROM consolidacao_mes WHERE competencia = ?`, [comp]); return !!(r && r.codigo); }
    catch (e) { return false; }
  }
  function temSnapContabil(comp) {
    try { const r = Banco.queryUnica(`SELECT 1 AS x FROM pm_contabil_snap WHERE competencia = ?`, [comp]); return !!r; }
    catch (e) { return false; }
  }
  function lerSnapContabil(comp) {
    try {
      const r = Banco.queryUnica(`SELECT dados FROM pm_contabil_snap WHERE competencia = ?`, [comp]);
      if (r && r.dados) { const d = JSON.parse(r.dados); d._key = comp + '|SNAP'; d._congelado = true; return d; }
    } catch (e) { console.error('[producao-medica] lerSnapContabil', e); }
    return null;
  }
  function salvarSnapContabil(comp) {
    if (!comp) return false;
    try {
      _cacheDelComp(_baseCache, comp); _cacheDelComp(_desCache, comp);   // recalcula fresco antes de congelar
      const d = calcular(comp, CLASS_PADRAO.slice(), '');
      const lista = d.lista.map(r => ({
        chave: r.chave, nome: r.nome, tipo: r.tipo, cadastrado: r.cadastrado,
        convProd: r.convProd, partProd: r.partProd, susProd: r.susProd,
        convReceb: r.convReceb, partReceb: r.partReceb, susReceb: r.susReceb || 0,   // V682
        rExec: r.rExec, rInd: r.rInd, rAux: r.rAux, rLaudo: r.rLaudo,
        desemp: r.desemp || 0, desempMod: r.desempMod || null,
        totalProd: r.totalProd, totalReceb: r.totalReceb, totalGeral: r.totalGeral,
        convRecebG: 0, partRecebG: 0, susRecebG: 0, desempG: 0, papeisG: {}, linhas: []   // gerencial = ao vivo; linhas não são lidas
      }));
      const payload = JSON.stringify({ lista, desModulos: d.desModulos || [], desRows: d.desRows || [], _comp: comp });
      Banco.executar(`CREATE TABLE IF NOT EXISTS pm_contabil_snap (competencia TEXT PRIMARY KEY, dados TEXT, congelado_em TEXT)`);
      Banco.executar(`INSERT INTO pm_contabil_snap (competencia, dados, congelado_em) VALUES (?, ?, datetime('now'))
                      ON CONFLICT(competencia) DO UPDATE SET dados = excluded.dados, congelado_em = excluded.congelado_em`, [comp, payload]);
      Banco.salvar();
      return true;
    } catch (e) { console.error('[producao-medica] salvarSnapContabil', e); return false; }
  }
  function removerSnapContabil(comp) {
    try { Banco.executar(`DELETE FROM pm_contabil_snap WHERE competencia = ?`, [comp]); Banco.salvar(); } catch (e) {}
  }
  function invalidarComp(comp) {
    try { if (comp) { _cacheDelComp(_baseCache, comp); _cacheDelComp(_desCache, comp); } else { _baseCache.clear(); _desCache.clear(); } } catch (e) {}
    try { if (window.__prodMed) window.__prodMed.dados = null; } catch (e) {}
  }

  function ensureDados() {
    const st = estado();
    // V271: mês consolidado + Contábil → retrato congelado (imutável). Demais casos = ao vivo.
    if (st.visao === 'contabil' && temSnapContabil(st.competencia)) {   // V272: congelado = existe snapshot (botão Congelar OU consolidação oficial)
      if (st.dados && st.dados._key === (st.competencia + '|SNAP')) return st.dados;
      const snap = lerSnapContabil(st.competencia);
      if (snap) { st.dados = snap; return st.dados; }
    }
    // V672: Banco._versao na chave — regra mudou (Base/exceção/bloqueio), recalcula
    const key = st.competencia + '|' + st.classes.slice().sort().join(',') + '|' + (st.buscaAdm || '').trim().toUpperCase() + '|' + (Banco._versao || 0);
    if (!st.dados || st.dados._key !== key || st.dados._congelado) st.dados = calcular(st.competencia, st.classes, st.buscaAdm);
    return st.dados;
  }
  function rotuloComp(c) {
    if (!c || !/^\d{4}-\d{2}$/.test(c)) return c || '—';
    const [a, m] = c.split('-');
    const meses = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${meses[Number(m)] || m}/${a}`;
  }
  function somaCards(lista) {
    return lista.reduce((a, r) => ({
      conv: a.conv + r.convProd, part: a.part + r.partProd, sus: a.sus + r.susProd,
      desemp: a.desemp + (r.desemp || 0),
      receb: a.receb + (r.convReceb + r.partReceb + (r.susReceb || 0) + (r.desemp || 0)),   // V682: Total = Conv+Part+SUS+Desemp
      convR: a.convR + r.convReceb, partR: a.partR + r.partReceb,
      susR: a.susR + (r.susReceb || 0),   // V682: repasse SUS (tabela SUS da Base)
      // V253 gerencial:
      desempG: a.desempG + (r.desempG || 0),
      recebG: a.recebG + ((r.convRecebG || 0) + (r.partRecebG || 0) + (r.susRecebG || 0) + (r.desempG || 0)),
      convRG: a.convRG + (r.convRecebG || 0), partRG: a.partRG + (r.partRecebG || 0),
      susRG: a.susRG + (r.susRecebG || 0)
    }), { conv: 0, part: 0, sus: 0, desemp: 0, receb: 0, convR: 0, partR: 0, susR: 0, desempG: 0, recebG: 0, convRG: 0, partRG: 0, susRG: 0 });
  }

  // Card RECEITA — receita PURA de produção do mês: soma BRUTA de linhas_producao (todas as classificações,
  // todas as origens), SEM correção de OPME → igual ao PROD TOTAL do mês.
  // (V483 aplicava aqui o "valor fixo por convênio" do OPME; REVERTIDO em V487 a pedido — volta ao bruto.)
  function receitaPuraTotal(comp) {
    try { const r = Banco.query(`SELECT SUM(valor) AS s FROM linhas_producao WHERE competencia = ?`, [comp]); return Number(r && r[0] && r[0].s) || 0; }
    catch (e) { return 0; }
  }
  function consolidadoOficialTotal(comp) {   // total a pagar oficial do mês (Consolidado), sem filtro
    let linhas = [];
    try { if (window.AtlasRelatorios && AtlasRelatorios.linhasConsolidadoComp) linhas = AtlasRelatorios.linhasConsolidadoComp(comp) || []; } catch (e) {}
    return linhas.reduce((acc, l) => acc + (Number(l.valor) || 0), 0);
  }
  function lerImpostoPct(comp) {
    try {
      const r = Banco.queryUnica(`SELECT valor FROM config_sistema WHERE chave='IMPOSTO_PCT_MES'`);
      if (r && r.valor) { const m = JSON.parse(r.valor); const v = Number(m[comp]); return isFinite(v) ? v : 0; }
    } catch (e) {}
    return 0;
  }
  function salvarImpostoPct(comp, pct) {
    try {
      let m = {};
      const r = Banco.queryUnica(`SELECT valor FROM config_sistema WHERE chave='IMPOSTO_PCT_MES'`);
      if (r && r.valor) { try { m = JSON.parse(r.valor) || {}; } catch (_) {} }
      m[comp] = Number(pct) || 0;
      Banco.executar(`CREATE TABLE IF NOT EXISTS config_sistema (chave TEXT PRIMARY KEY, valor TEXT)`);
      Banco.executar(`INSERT INTO config_sistema (chave, valor) VALUES ('IMPOSTO_PCT_MES', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`, [JSON.stringify(m)]);
      Banco.salvar();
      return true;
    } catch (e) { console.error('[producao_medica] salvarImpostoPct', e); return false; }
  }
  function fmtPct1(n) { return (Number(n) || 0).toFixed(1).replace('.', ',') + '%'; }
  // V269: casas decimais do "% sobre PROD" (ajustável, persiste em localStorage; default 2)
  function lerProdDec() { const v = parseInt(localStorage.getItem('atlas_prodpct_dec'), 10); return isFinite(v) ? Math.max(0, Math.min(4, v)) : 2; }
  function salvarProdDec(d) { try { localStorage.setItem('atlas_prodpct_dec', String(Math.max(0, Math.min(4, d | 0)))); } catch (e) {} }
  function fmtPctN(n, dec) { return (Number(n) || 0).toFixed(Math.max(0, Math.min(4, dec | 0))).replace('.', ',') + '%'; }
  function receitaCardHtml(repasseTotal) {
    const st = estado();
    const comp = st.competencia;
    const receita = receitaPuraTotal(comp);
    const pctImp = lerImpostoPct(comp);
    const imposto = receita * pctImp / 100;
    const liquida = receita - imposto;
    const rep = Number(repasseTotal) || 0;                          // V273: Repasse Total do card PROD. TOTAL (visão atual)
    // V448: SANTO Anestesia (valores adicionais da competência) entra SÓ no numerador do "% sobre PROD".
    // O card PROD. TOTAL em R$ NÃO muda (segue Conv+Part+SUS) — pedido confirmado pelo usuário.
    const santoNum = (adicionaisDe(comp) || []).reduce((s, a) => s + (Number(a.valor) || 0), 0);
    const repProd = rep + santoNum;
    const prodPct = liquida > 0 ? (100 * repProd / liquida) : 0;    // V448: % sobre PROD = (Repasse Total + SANTO) ÷ Receita LÍQUIDA
    const pctStr = (Number(pctImp) || 0).toString().replace('.', ',');
    const dec = lerProdDec();
    const prodRed = (prodPct > 23 || prodPct < 21);   // V269: vermelho fora da faixa 21–23%
    return `<div class="pm-receita-card">
      <div class="prc-verde"></div>
      <div class="prc-branco">
        ${(st.dados && st.dados._congelado)
          ? '<span class="pm-congelado pm-congelado-card" title="Contábil congelado — consolidado imutável. Reimportar a produção atualiza só o Gerencial.">🔒</span>'
          : ''}
        <div class="prc-lbl">RECEITA COMPETÊNCIA</div><!-- V975: era "RECEITA PRODUÇÃO TOTAL" (V974) / "RECEITA PROD TOTAL" -->
        <div class="prc-val">R$ ${fmtBRL(receita)}</div>
        <div class="prc-rows">
          <div class="prc-row prc-imp-row"><span class="prc-k">Imposto <b class="prc-imp-pct">${esc(pctStr)}%</b></span><span class="prc-v prc-imp-val">− R$ ${fmtBRL(imposto)}</span></div>
          <div class="prc-row prc-liq"><span class="prc-k">Receita líquida</span><span class="prc-v prc-liq-val">R$ ${fmtBRL(liquida)}</span></div>
          <div class="prc-row prc-visao"><span class="prc-k">${st.visao === 'gerencial' ? 'Gerencial' : 'Contábil'}</span><span class="prc-v prc-visao-val">R$ ${fmtBRL(rep)}</span></div>
          <div class="prc-row"><span class="prc-k">% sobre PROD</span><span class="prc-prod-box" data-prod="${prodPct}"><button class="prc-dec" data-d="-1" title="menos casas decimais">−</button><span class="prc-v prc-prod${prodRed ? ' prc-prod-vermelho' : ''}" title="(Repasse PROD. TOTAL + SANTO Anestesia) ÷ Receita Líquida">${fmtPctN(prodPct, dec)}</span><button class="prc-dec" data-d="1" title="mais casas decimais">+</button><button class="prc-dec" id="pm-pct-comp" title="Comparar a composição do % com o mês anterior — mostra o que faltou ou entrou a mais">⇄</button></span></div>
        </div>
      </div>
    </div>`;
  }

  // ── V673: COMPARATIVO do "% sobre PROD" — mês atual × mês anterior ────────
  // Quebra numerador (Conv/Part/Desempenho POR MÓDULO/SANTO) e denominador
  // (receita, imposto, líquida) dos dois meses lado a lado, marcando o que
  // "não teve mês passado" e o que "sumiu neste mês" — responde na tela por
  // que o % subiu/caiu. Meses consolidados usam o snapshot congelado.
  function mesAnteriorDe(comp) {
    const m = /^(\d{4})-(\d{2})$/.exec(comp || '');
    if (!m) return null;
    let a = Number(m[1]), mm = Number(m[2]) - 1;
    if (mm < 1) { mm = 12; a--; }
    return `${a}-${String(mm).padStart(2, '0')}`;
  }
  function composicaoPct(comp) {
    let d = null;
    if (temSnapContabil(comp)) d = lerSnapContabil(comp);
    if (!d) d = calcular(comp, CLASS_PADRAO.slice(), '');
    const c = somaCards(d.lista || []);
    const porMod = new Map();
    for (const r of (d.desRows || [])) {
      const v = Number(r.valor) || 0;
      if (!v) continue;
      porMod.set(r.modulo || '—', (porMod.get(r.modulo || '—') || 0) + v);
    }
    const santo = (adicionaisDe(comp) || []).reduce((s, a) => s + (Number(a.valor) || 0), 0);
    const receita = receitaPuraTotal(comp);
    const pctImp = lerImpostoPct(comp);
    const imposto = receita * pctImp / 100;
    const liquida = receita - imposto;
    const rep = c.receb;   // Conv + Part + SUS + Desempenho (visão Contábil)
    const pct = liquida > 0 ? (100 * (rep + santo) / liquida) : 0;
    return { receita, pctImp, imposto, liquida, conv: c.convR, part: c.partR, sus: c.susR, desemp: c.desemp, porMod, santo, rep, pct };
  }
  function abrirComparativoPct() {
    const st = estado();
    const compA = st.competencia;
    const compB = mesAnteriorDe(compA);
    Utilidades.comLoading(() => {
      const A = composicaoPct(compA);
      const B = compB ? composicaoPct(compB) : null;
      const dinheiro = (v) => 'R$ ' + fmtBRL(Number(v) || 0);
      const delta = (a, b) => {
        const d = (Number(a) || 0) - (Number(b) || 0);
        if (Math.abs(d) < 0.005) return '<span style="color:var(--ink-faint)">—</span>';
        return `<span style="color:${d > 0 ? '#0E7A57' : '#a15646'}; font-weight:700">${d > 0 ? '+' : '−'} R$ ${fmtBRL(Math.abs(d))}</span>`;
      };
      const tag = (txt, cor, fundo) => `<span style="font-size:10px; font-weight:700; color:${cor}; background:${fundo}; border-radius:999px; padding:1px 7px; margin-left:6px; white-space:nowrap">${txt}</span>`;
      const linha = (rot, va, vb, opts) => {
        const soAgora = (Number(va) || 0) > 0 && !(Number(vb) > 0);
        const sumiu = (Number(vb) || 0) > 0 && !(Number(va) > 0);
        const marca = (opts && opts.semTag) ? '' : soAgora ? tag('não teve mês passado', '#8a5a00', '#fff6e3') : sumiu ? tag('tinha e SUMIU', '#a15646', '#fdeaea') : '';
        return `<tr${(opts && opts.forte) ? ' style="font-weight:700"' : ''}>
          <td style="padding:6px 10px; border-bottom:1px solid var(--border)">${esc(rot)}${marca}</td>
          <td style="padding:6px 10px; border-bottom:1px solid var(--border); text-align:right; font-family:var(--font-mono); white-space:nowrap">${dinheiro(va)}</td>
          <td style="padding:6px 10px; border-bottom:1px solid var(--border); text-align:right; font-family:var(--font-mono); white-space:nowrap">${B ? dinheiro(vb) : '—'}</td>
          <td style="padding:6px 10px; border-bottom:1px solid var(--border); text-align:right; white-space:nowrap">${B ? delta(va, vb) : '—'}</td>
        </tr>`;
      };
      const modulos = [...new Set([...A.porMod.keys(), ...(B ? B.porMod.keys() : [])])]
        .sort((x, y) => Math.max(B ? (B.porMod.get(y) || 0) : 0, A.porMod.get(y) || 0) - Math.max(B ? (B.porMod.get(x) || 0) : 0, A.porMod.get(x) || 0));
      const ppA = A.pct, ppB = B ? B.pct : 0;
      const dpp = ppA - ppB;
      const ov = document.createElement('div');
      ov.id = 'pm-pct-comp-ov';
      ov.style.cssText = 'position:fixed; inset:0; z-index:1000; background:rgba(10,30,26,0.45); display:flex; align-items:center; justify-content:center; padding:20px';
      ov.innerHTML = `
        <div style="background:var(--bg-raised,#fff); border-radius:12px; width:980px; max-width:96vw; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 18px 50px rgba(0,0,0,0.3)">
          <div style="display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid var(--border)">
            <h3 style="margin:0; font-size:15px">⇄ % sobre PROD — ${esc(rotuloComp(compA))} × ${esc(rotuloComp(compB || ''))}</h3>
            <button class="btn" id="pm-pct-comp-x" style="padding:4px 12px">✕ Fechar</button>
          </div>
          <div style="overflow-y:auto; padding:12px 18px">
            <p style="margin:0 0 10px; font-size:12px; color:var(--ink-soft)">
              Visão <strong>Contábil</strong> (mês consolidado usa o retrato congelado). O que estiver marcado
              explica a diferença: módulo que <strong>não teve mês passado</strong> puxa o % pra cima; o que
              <strong>tinha e sumiu</strong> (ex.: pagamento ainda não flagado, SANTO não lançado) puxa pra baixo.
              Receita maior com mais OPME/Material também derruba o % — eles entram na receita, mas não geram repasse.
            </p>
            <table style="width:100%; border-collapse:collapse; font-size:12.5px">
              <thead><tr>
                <th style="text-align:left; padding:6px 10px; border-bottom:2px solid var(--border)">Componente</th>
                <th style="text-align:right; padding:6px 10px; border-bottom:2px solid var(--border)">${esc(rotuloComp(compA))}</th>
                <th style="text-align:right; padding:6px 10px; border-bottom:2px solid var(--border)">${esc(rotuloComp(compB || '—'))}</th>
                <th style="text-align:right; padding:6px 10px; border-bottom:2px solid var(--border)">Δ</th>
              </tr></thead>
              <tbody>
                ${linha('Receita bruta (todas as classes)', A.receita, B && B.receita, { semTag: true })}
                ${linha(`Imposto (${String(A.pctImp).replace('.', ',')}% × ${B ? String(B.pctImp).replace('.', ',') + '%' : '—'})`, A.imposto, B && B.imposto, { semTag: true })}
                ${linha('Receita líquida (denominador)', A.liquida, B && B.liquida, { semTag: true, forte: true })}
                ${linha('Repasse Convênio (contábil)', A.conv, B && B.conv)}
                ${linha('Repasse Particular (contábil)', A.part, B && B.part)}
                ${linha('Repasse SUS (contábil)', A.sus, B && B.sus)}
                ${modulos.map(mod => linha('Desempenho · ' + mod, A.porMod.get(mod) || 0, B ? (B.porMod.get(mod) || 0) : 0)).join('')}
                ${linha('SANTO Anestesia (adicionais)', A.santo, B && B.santo)}
                ${linha('Repasse total (numerador)', A.rep + A.santo, B && (B.rep + B.santo), { semTag: true, forte: true })}
              </tbody>
            </table>
            <div style="display:flex; gap:26px; margin-top:12px; font-size:13px; flex-wrap:wrap">
              <span>% ${esc(rotuloComp(compA))}: <strong style="font-family:var(--font-mono)">${fmtPctN(ppA, 2)}</strong></span>
              ${B ? `<span>% ${esc(rotuloComp(compB))}: <strong style="font-family:var(--font-mono)">${fmtPctN(ppB, 2)}</strong></span>
              <span>Δ: <strong style="font-family:var(--font-mono); color:${dpp >= 0 ? '#0E7A57' : '#a15646'}">${dpp >= 0 ? '+' : '−'}${fmtPctN(Math.abs(dpp), 2).replace('%', '')} p.p.</strong></span>` : ''}
            </div>
          </div>
        </div>`;
      document.body.appendChild(ov);
      ov.querySelector('#pm-pct-comp-x').addEventListener('click', () => ov.remove());
      ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    }, 'Comparando com o mês anterior…', { semFundo: true });
  }

  // ── V674: MÊS A MÊS da PRODUÇÃO MÉDICA (botão flutuante ⇆) ────────────────
  // Mesma visão da matriz "Mês a mês" dos Relatórios, mas com os números da
  // Produção Médica (visão Contábil): médico × competências, com TOTAL GERAL,
  // LM (variação vs mês anterior), ordenação, métrica (Repasse ou Produção) e
  // export Excel. Mês consolidado usa o retrato congelado (instantâneo).
  let _pmmGen = 0;
  // V680: a esteira do Mês a mês segue os RELATÓRIOS DO QVIS (mes_pagamento) —
  // a mesma régua do Mês a mês dos Relatórios. A Produção guarda competências
  // antigas (2024…) sem relatório, que só pesavam o cálculo e poluíam a matriz.
  function pmmComps() {
    let comps = [];
    try {
      comps = (Banco.query(
        `SELECT DISTINCT mes_pagamento AS c FROM linhas_qvis
          WHERE mes_pagamento IS NOT NULL AND TRIM(mes_pagamento) <> ''
          ORDER BY mes_pagamento`) || [])
        .map(r => r.c).filter(c => /^\d{4}-\d{2}$/.test(String(c)));
    } catch (_) {}
    if (!comps.length) comps = competenciasDisponiveis().slice().sort();   // sem QVIS → produção
    return comps;
  }
  function pmmDadosDe(comp, visao) {
    // V675: GERENCIAL vem do Consolidado real — o snapshot congelado zera os
    // campos gerenciais ("gerencial = ao vivo"), então nele só vale o Contábil
    if (visao !== 'gerencial' && temSnapContabil(comp)) { const s = lerSnapContabil(comp); if (s) return s; }
    return calcular(comp, CLASS_PADRAO.slice(), '');
  }
  function pmmValor(r, metrica, visao) {
    if (metrica === 'producao') return (r.convProd || 0) + (r.partProd || 0) + (r.susProd || 0);
    if (visao === 'gerencial') return (r.convRecebG || 0) + (r.partRecebG || 0) + (r.susRecebG || 0) + (r.desempG || 0);   // Consolidado real
    return (r.convReceb || 0) + (r.partReceb || 0) + (r.susReceb || 0) + (r.desemp || 0);   // repasse contábil (V682: + SUS)
  }
  function pmmBadge(v, ant) {
    if (!(ant > 0)) return '';
    const p = ((Number(v) || 0) - ant) / ant * 100;
    if (!isFinite(p) || Math.abs(p) < 0.05) return '';
    const up = p >= 0;
    return `<span class="pmm-lm ${up ? 'pmm-up' : 'pmm-dn'}">${up ? '↑' : '↓'} ${Math.abs(p).toFixed(1).replace('.', ',')}%</span>`;
  }
  function pmmRotulo(c, multiAno) {
    const meses = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const m = meses[Number(String(c).slice(5, 7))] || c;
    return multiAno ? m : m;
  }
  function pmmEstilos() {
    Utilidades.garantirEstilos('css-pm-mesames', `
      .pm-fab-mesames { position: fixed; right: 22px; bottom: 110px; z-index: 120; width: 46px; height: 46px; border-radius: 50%;
        border: 1px solid var(--border); background: var(--primary, #5980a6); color: #fff; font-size: 19px; cursor: pointer;
        box-shadow: 0 6px 18px rgba(89, 128, 166,0.35); display: flex; align-items: center; justify-content: center; }
      .pm-fab-mesames:hover { transform: translateY(-2px); }
      .pmm-ov { position: fixed; inset: 0; z-index: 1000; background: rgba(10,30,26,0.45); display: flex; align-items: center; justify-content: center; padding: 18px; }
      .pmm-painel { background: var(--bg-raised, #fff); border-radius: 14px; width: 96vw; height: 90vh; display: flex; flex-direction: column; box-shadow: 0 18px 60px rgba(0,0,0,0.35); overflow: hidden; }
      .pmm-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 20px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
      .pmm-titulo { font-weight: 800; font-size: 15px; }
      .pmm-sub { font-size: 11.5px; color: var(--ink-faint); margin-top: 2px; }
      .pmm-acoes { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .pmm-acoes label { font-size: 11.5px; color: var(--ink-soft); display: flex; align-items: center; gap: 6px; }
      .pmm-acoes select { padding: 5px 8px; border: 1px solid var(--border); border-radius: 7px; font-size: 12px; }
      .pmm-visao-sw { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; overflow: hidden; }
      .pmm-visao-sw button { border: none; background: var(--bg-sunken, #f3f6f5); color: var(--ink-soft); padding: 6px 14px; font-size: 12px; cursor: pointer; font-weight: 700; }
      .pmm-visao-sw button.on { background: var(--primary, #5980a6); color: #fff; }
      .pmm-visao-sw.pmm-sw-off { opacity: 0.45; pointer-events: none; }
      .pmm-btn { border: 1px solid var(--border); background: var(--bg-sunken, #f3f6f5); border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
      .pmm-x { border: none; background: none; font-size: 22px; cursor: pointer; color: var(--ink-soft); }
      .pmm-corpo { flex: 1; min-height: 0; overflow: auto; padding: 0; }
      /* V675: escala MAIOR — os números estavam pequenos e "quebrando" */
      .pmm-tab { border-collapse: separate; border-spacing: 0; font-size: 14px; min-width: 100%; }
      .pmm-tab th, .pmm-tab td { padding: 9px 16px; border-bottom: 1px solid var(--border); white-space: nowrap; background: var(--bg-raised, #fff); }
      .pmm-tab thead th { position: sticky; top: 0; z-index: 6; background: var(--primary, #5980a6); color: #fff; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
      .pmm-tab thead tr.pmm-tot th { top: 0; background: #0a3d54; font-family: var(--font-mono); font-size: 13px; text-transform: none; }
      /* V976: some a linha escura logo abaixo do TOTAL GERAL (border-bottom
         #3a5877 da regra global de thead) e a 2ª linha do cabeçalho gruda
         EXATAMENTE na altura real da 1ª (era 42px fixos — a 1ª tem ~56px e as
         duas se sobrepunham ao rolar). --pmm-r1 é medida após o render. */
      .pmm-tab thead tr.pmm-tot th { border-bottom: none !important; }
      .pmm-tab thead tr:nth-child(2) th { top: var(--pmm-r1, 56px); }
      .pmm-fixo { position: sticky; left: 0; z-index: 5; text-align: left; max-width: 320px; overflow: hidden; text-overflow: ellipsis; border-right: 1px solid var(--border); }
      .pmm-tab tbody .pmm-fixo { font-weight: 700; }   /* V976: nome do médico em negrito */
      .pmm-tab thead .pmm-fixo { z-index: 8; }
      .pmm-num { text-align: right; font-family: var(--font-mono); }
      .pmm-val { display: block; white-space: nowrap; font-size: 14px; }
      .pmm-lm { display: block; font-size: 11px; font-weight: 700; white-space: nowrap; }
      .pmm-lm-vazio { display: block; font-size: 11px; }
      .pmm-up { color: #0E7A57; }
      .pmm-dn { color: #a15646; }
      .pmm-tab tbody .pmm-col-total { font-weight: 800; background: var(--bg-sunken, #f3f6f5) !important; }
      .pmm-tab thead .pmm-col-total { font-weight: 800; background: #0a3d54; }
      .pmm-tab tbody tr:hover td { background: var(--accent-soft, #e6f1ee); }
      .pmm-load { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; color: var(--ink-faint); font-size: 12.5px; }
      .pmm-rodape { padding: 8px 20px; border-top: 1px solid var(--border); font-size: 11.5px; color: var(--ink-faint); }
    `);
  }
  function abrirPmMesAMes() {
    if (document.getElementById('pmm-ov')) return;
    pmmEstilos();
    const ov = document.createElement('div');
    ov.className = 'pmm-ov';
    ov.id = 'pmm-ov';
    ov.innerHTML = `
      <div class="pmm-painel" role="dialog" aria-modal="true">
        <div class="pmm-head">
          <div>
            <div class="pmm-titulo">⇆ Mês a mês — Produção Médica</div>
            <div class="pmm-sub">Visão Contábil por competência · mês consolidado usa o retrato congelado · LM = variação vs mês anterior</div>
          </div>
          <div class="pmm-acoes">
            <div class="pmm-visao-sw ${(window.__pmmMetrica || 'repasse') === 'producao' ? 'pmm-sw-off' : ''}" id="pmm-visao-sw"
                 title="Contábil = regras da Base aplicadas na produção · Gerencial = repasse REAL do Consolidado">
              <button type="button" data-v="contabil" class="${(window.__pmmVisao || 'contabil') === 'contabil' ? 'on' : ''}">Contábil</button>
              <button type="button" data-v="gerencial" class="${window.__pmmVisao === 'gerencial' ? 'on' : ''}">Gerencial</button>
            </div>
            <label>Métrica
              <select id="pmm-metrica">
                <option value="repasse" ${(window.__pmmMetrica || 'repasse') === 'repasse' ? 'selected' : ''}>Repasse (Conv+Part+Desemp)</option>
                <option value="producao" ${window.__pmmMetrica === 'producao' ? 'selected' : ''}>Produção (Conv+Part+SUS)</option>
              </select>
            </label>
<!-- V976: saiu o seletor "Ordenar" — por regra a ordem é sempre do MAIOR para o menor (empate: A → Z) -->
            <button type="button" class="pmm-btn" id="pmm-export">↓ Exportar Excel</button>
            <button type="button" class="pmm-x" id="pmm-fechar" title="Fechar">×</button>
          </div>
        </div>
        <div class="pmm-corpo" id="pmm-corpo">
          <div class="pmm-load"><div class="atlas-loader"></div><div id="pmm-prog">calculando…</div></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const fechar = () => { document.removeEventListener('keydown', onKey); _pmmGen++; ov.remove(); };
    function onKey(e) { if (e.key === 'Escape') fechar(); }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    ov.querySelector('#pmm-fechar').addEventListener('click', fechar);
    ov.querySelector('#pmm-metrica').addEventListener('change', (e) => {
      window.__pmmMetrica = e.target.value;
      const sw = ov.querySelector('#pmm-visao-sw');
      if (sw) sw.classList.toggle('pmm-sw-off', e.target.value === 'producao');   // visão só vale pro Repasse
      pmmPreencher();
    });
    // V675: switch Contábil ↔ Gerencial (mesmo conceito do switch da tela)
    ov.querySelectorAll('#pmm-visao-sw button').forEach(b => b.addEventListener('click', () => {
      if (window.__pmmVisao === b.dataset.v || (b.dataset.v === 'contabil' && !window.__pmmVisao)) return;
      window.__pmmVisao = b.dataset.v;
      ov.querySelectorAll('#pmm-visao-sw button').forEach(x => x.classList.toggle('on', x === b));
      pmmPreencher();
    }));
    ov.querySelector('#pmm-export').addEventListener('click', () => exportarPmMesAMes());
    pmmPreencher();
  }
  // V684: TODO nome passa pelo de-para na montagem da matriz — o retrato
  // congelado de um mês guarda o nome de ANTES do vínculo (ex.: "FABIOLA
  // MAZARATO" abreviado) e o mês ao vivo mostra o oficial; sem re-resolver,
  // o mesmo médico virava duas linhas. Unifica no NOME OFICIAL do cadastro
  // (o mesmo que sai no módulo de Relatórios).
  let _pmmNomeMapa = null, _pmmNomeV = -1;
  function pmmResolverNome(nome) {
    const v = Banco._versao || 0;
    if (!_pmmNomeMapa || _pmmNomeV !== v) {
      _pmmNomeMapa = new Map();
      try {
        for (const m of (Banco.query(`SELECT nome_oficial, nome_normalizado FROM medicos`) || []))
          _pmmNomeMapa.set(m.nome_normalizado || normalizar(m.nome_oficial), m.nome_oficial);
        for (const s of (Banco.query(`SELECT s.grafia_normalizada AS g, m.nome_oficial AS n FROM sinonimos_medico s JOIN medicos m ON m.id = s.medico_id`) || []))
          if (s.g) _pmmNomeMapa.set(s.g, s.n);
      } catch (_) {}
      _pmmNomeV = v;
    }
    return _pmmNomeMapa.get(normalizar(nome)) || nome;
  }
  const _pmmPorComp = new Map();   // comp|versao|metrica|visao → Map(nome → valor)
  async function pmmColeta(comps, metrica, visao) {
    const out = new Map();
    for (let i = 0; i < comps.length; i++) {
      const c = comps[i];
      const p = document.getElementById('pmm-prog');
      if (p) p.textContent = `calculando ${rotuloComp(c)} (${i + 1}/${comps.length})…`;
      if (Utilidades.aguardarPintura) await Utilidades.aguardarPintura();
      const chave = c + '|' + (Banco._versao || 0) + '|' + metrica + '|' + (visao || 'contabil');
      let m = _pmmPorComp.get(chave);
      if (!m) {
        if (_pmmPorComp.size > 80) _pmmPorComp.clear();
        m = new Map();
        const d = pmmDadosDe(c, visao);
        for (const r of (d.lista || [])) {
          const v = pmmValor(r, metrica, visao);
          if (!v) continue;
          const nome = pmmResolverNome(r.nome);   // V684: unifica no nome oficial (de-para)
          m.set(nome, (m.get(nome) || 0) + v);
        }
        _pmmPorComp.set(chave, m);
      }
      out.set(c, m);
    }
    return out;
  }
  // V976: FONTE ÚNICA das linhas do Mês a mês — a tela e o Excel usam a mesma
  // métrica, a mesma visão (Contábil/Gerencial) e a mesma ORDEM (sempre do
  // MAIOR total para o menor; empate em A → Z).
  async function pmmMontar() {
    const comps = pmmComps();   // esteira: antigo → recente (meses dos relatórios QVIS)
    const metrica = window.__pmmMetrica || 'repasse';
    const visao = metrica === 'repasse' ? (window.__pmmVisao || 'contabil') : 'contabil';
    if (!comps.length) return { comps, metrica, visao, nomes: [], porComp: new Map(), totais: [], totalGeral: 0 };
    const porComp = await pmmColeta(comps, metrica, visao);
    const meds = new Set();
    for (const m of porComp.values()) for (const k of m.keys()) meds.add(k);
    const totLinhaDe = (n) => comps.reduce((s, c) => s + (Number(porComp.get(c).get(n)) || 0), 0);
    const nomes = [...meds].sort((a, b) => (totLinhaDe(b) - totLinhaDe(a)) || a.localeCompare(b, 'pt-BR'));
    const totais = comps.map(c => { let s = 0; for (const v of porComp.get(c).values()) s += v; return s; });
    const totalGeral = totais.reduce((s, v) => s + v, 0);
    return { comps, metrica, visao, nomes, porComp, totais, totalGeral };
  }
  async function pmmPreencher() {
    const gen = ++_pmmGen;
    const corpo = document.getElementById('pmm-corpo');
    if (!corpo) return;
    const { comps, metrica, visao, nomes, porComp, totais, totalGeral } = await pmmMontar();
    if (gen !== _pmmGen) return;   // fechou/trocou no meio
    if (!comps.length) { corpo.innerHTML = `<div class="pmm-load">Sem competências — importe a Produção.</div>`; return; }
    if (!nomes.length) { corpo.innerHTML = `<div class="pmm-load">Nenhum médico com valores nas competências disponíveis.</div>`; return; }
    const cel = (v, badge, extra) => `<td class="pmm-num${extra ? ' ' + extra : ''}"><span class="pmm-val">${v ? 'R$ ' + fmtBRL(v) : '—'}</span>${badge || '<span class="pmm-lm-vazio">&nbsp;</span>'}</td>`;
    const linhas = nomes.map(n => {
      const vals = comps.map(c => Number(porComp.get(c).get(n)) || 0);
      const tot = vals.reduce((s, v) => s + v, 0);
      return `<tr>
        <td class="pmm-fixo" title="${esc(n)}">${esc(n)}</td>
        ${vals.map((v, i) => cel(v, i > 0 ? pmmBadge(v, vals[i - 1]) : '')).join('')}
        ${cel(tot, '', 'pmm-col-total')}
      </tr>`;
    }).join('');
    const multiAno = new Set(comps.map(c => c.slice(0, 4))).size > 1;
    corpo.innerHTML = `
      <table class="pmm-tab">
        <thead>
          <tr class="pmm-tot">
            <th class="pmm-fixo">TOTAL GERAL</th>
            ${comps.map((c, i) => `<th class="pmm-num"><span class="pmm-val">R$ ${fmtBRL(totais[i])}</span>${i > 0 ? pmmBadge(totais[i], totais[i - 1]) : '<span class="pmm-lm-vazio">&nbsp;</span>'}</th>`).join('')}
            <th class="pmm-num pmm-col-total"><span class="pmm-val">R$ ${fmtBRL(totalGeral)}</span><span class="pmm-lm-vazio">&nbsp;</span></th>
          </tr>
          <tr>
            <th class="pmm-fixo">Corpo Clínico</th>
            ${comps.map(c => `<th class="pmm-num">${esc(c.slice(0, 4))}<br>${esc(pmmRotulo(c, multiAno))}</th>`).join('')}
            <th class="pmm-num pmm-col-total">TOTAL</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <div class="pmm-rodape">${nomes.length} médicos · ${comps.length} competências · métrica: ${metrica === 'producao' ? 'Produção (Conv+Part+SUS)' : (visao === 'gerencial' ? 'Repasse GERENCIAL (Consolidado real)' : 'Repasse contábil (Conv+Part+Desempenho)')} · LM = variação vs mês anterior</div>`;
    corpo.scrollLeft = corpo.scrollWidth;   // esteira abre na ponta mais recente
    // V976: a 2ª linha do cabeçalho gruda na altura REAL da 1ª
    const r1 = corpo.querySelector('.pmm-tab thead tr.pmm-tot');
    if (r1) corpo.querySelector('.pmm-tab').style.setProperty('--pmm-r1', Math.round(r1.getBoundingClientRect().height) + 'px');
  }
  async function exportarPmMesAMes() {
    if (typeof ExcelJS === 'undefined') { Utilidades.toast?.('ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return; }
    try {
      // V976: mesmas linhas/ordem da tela (métrica, visão e ordem maior → menor)
      const { comps, metrica, visao, nomes, porComp } = await pmmMontar();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Mês a mês', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
      ws.columns = [{ header: 'Corpo Clínico', key: 'nome', width: 38 }]
        .concat(comps.map(c => ({ header: rotuloComp(c), key: c, width: 14 })))
        .concat([{ header: 'TOTAL', key: 'total', width: 15 }]);
      const head = ws.getRow(1);
      for (let i = 1; i <= ws.columns.length; i++) {
        const cch = head.getCell(i);
        cch.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cch.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF107DAC' } };
      }
      for (const n of nomes) {
        const row = { nome: n }; let tot = 0;
        for (const c of comps) { const v = Number(porComp.get(c).get(n)) || 0; row[c] = v || null; tot += v; }
        row.total = tot;
        const r = ws.addRow(row);
        for (let i = 2; i <= ws.columns.length; i++) r.getCell(i).numFmt = '"R$" #,##0.00';
      }
      const totRow = { nome: 'TOTAL GERAL' }; let tg = 0;
      for (const c of comps) { let s = 0; for (const v of porComp.get(c).values()) s += v; totRow[c] = s; tg += s; }
      totRow.total = tg;
      const rT = ws.addRow(totRow);
      rT.font = { bold: true };
      for (let i = 2; i <= ws.columns.length; i++) rT.getCell(i).numFmt = '"R$" #,##0.00';
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `producao_medica_mes_a_mes_${metrica === 'repasse' ? visao : metrica}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      Utilidades.toast?.('✓ Excel do Mês a mês exportado', 'success', 2600);
    } catch (e) {
      console.error('[producao-medica] export mês a mês:', e);
      Utilidades.toast?.('Erro ao exportar: ' + (e.message || e), 'error', 4500);
    }
  }
  // V679: a entrada oficial é o botão "⇆ Mês a mês" do cabeçalho — o globo
  // flutuante (hub) coleta os botões do cabeçalho sozinho, então o item
  // "Mês a mês" aparece no leque do globo como as demais ações do módulo.
  function pmmGarantirFab() { pmmEstilos(); }

  // ── ENTRADA ─────────────────────────────────────────────────────────────────
  App.telas['producao-medica'] = function () {
    const st = estado();
    st.tipos = TIPOS_INICIAIS.slice();
    const comps = competenciasDisponiveis();
    if (!st.competencia || !comps.includes(st.competencia)) { st.competencia = comps[0] || null; }
    st.dados = null;   // re-agrega do cache base (rápido); caches de base/desempenho persistem na sessão
    st.medicoSel = null; st.filtroAberto = false; st.impostoAberto = false;
    render();
  };

  function render() {
    estilos();
    const st = estado();
    const cont = document.getElementById('conteudo');
    const comps = competenciasDisponiveis();
    if (!st.competencia) {
      cont.innerHTML = `<div class="pm-wrap"><div class="pm-head"><div class="pm-title-group"><h1 class="pm-titulo">Produção Médica</h1></div></div>
        <div class="pm-vazio">Nenhuma Produção QVIS importada ainda. Importe em <strong>Importar PRODUÇÃO</strong> para ver o balanço.</div></div>`;
      return;
    }
    const d = ensureDados();
    const _congelado = !!(d && d._congelado);   // V271: Contábil consolidado/imutável (na visão Contábil)
    const _frozen = temSnapContabil(st.competencia);   // V272: mês tem retrato congelado? (vale p/ o rótulo do botão em qualquer visão)
    const listaTipo = d.lista.filter(r => st.tipos.includes(r.tipo));
    const listaCards = filtrarBusca(listaTipo);   // cards respeitam o filtro de busca também
    const c = somaCards(listaCards);
    const prodTotal = c.conv + c.part + c.sus + c.desemp;
    const prodReal = c.conv + c.part + c.sus;      // PROD TOTAL = Conv+Part+SUS (desempenho não tem produção)
    // V253: cards trocam o repasse conforme o switch (contábil ↔ gerencial)
    const _ger = st.visao === 'gerencial';
    const cRecebTot = _ger ? c.recebG : c.receb;   // Conv+Part+Desemp
    const cConvR = _ger ? c.convRG : c.convR;
    const cPartR = _ger ? c.partRG : c.partR;
    const cDesemp = _ger ? c.desempG : c.desemp;

    const TIPOS = [['INTERNO', 'Interno'], ['HIBRIDO', 'Híbrido'], ['EXTERNO', 'Externo'], ['SEM_TIPO', 'Sem tipo']];
    const chips = TIPOS.map(([k, l]) => `<button class="pm-chip ${st.tipos.includes(k) ? 'on' : ''}" data-tipo="${k}">${l}</button>`).join('');
    // card mostra: produção (R$) + "repasse R$ X · Y%" (Y = repasse/produção da fonte). rep=null → sem linha (Desempenho).
    const card = (lbl, val, rep, base, cls, editCard) => {
      // V974: % entre parênteses, com vírgula e afastado do valor (era "R$ X - Y.Y%")
      const pctRep = rep !== null ? (base ? (100 * rep / base).toFixed(1).replace('.', ',') + '%' : '0,0%') : '';
      // V975: valor do repasse na cor padrão (.atlas-rep) e tudo numa linha só
      const linha = rep !== null ? `Repasse <span class="pm-nw atlas-rep">R$ ${fmtBRL(rep)}</span><span class="pm-nw pm-card-pct">(${pctRep})</span>` : '&nbsp;';
      const clsFull = ((editCard ? 'pm-card-edit ' : '') + (cls || '')).trim();
      let html = Utilidades.cardKPI(lbl, `R$ ${fmtBRL(val)}`, linha, '', clsFull);
      if (editCard) {
        const pencil = `<button type="button" class="pm-prod-edit" data-prod-edit="${editCard}" title="Escolher quais produtos entram neste card"><i class="ti ti-pencil"></i></button>`;
        html = html.replace('<div class="aic-branco">', pencil + '<div class="aic-branco">');
      }
      return html;
    };

    const abas = [['consolidado', 'Consolidado'], ['producao', 'Produção médica'], ['desempenho', 'Desempenho']];
    const navHtml = abas.map(([k, l]) => `<button class="pm-aba ${st.aba === k ? 'on' : ''}" data-aba="${k}">${l}</button>`).join('');

    cont.innerHTML = `
      <div class="pm-wrap">
        <div class="pm-head">
          <div class="pm-title-group"><h1 class="pm-titulo">Produção Médica</h1></div><!-- V896: o cadeado saiu do título — mora no canto do card RECEITA PROD TOTAL -->
          <div class="pm-controles">
            ${switchHtml()}
            <div class="pm-chips atlas-hub-ilha" data-ilha="Vínculo">${chips}</div>
            ${compDropdownHtml(comps)}
            <button class="pm-classif-btn ${st.classes.length !== 3 || !CLASS_PADRAO.every(x => st.classes.includes(x)) ? 'mod' : ''}" id="pm-filtro" title="Filtrar classificação de produto">⚙ Classificação</button>
            <button class="pm-imposto-btn" id="pm-imposto" title="Ajustar o % de imposto de cada mês/ano">⚖ Imposto</button>
            <button class="pm-congelar-btn${_frozen ? ' on' : ''}" id="pm-congelar" title="${_frozen ? 'Descongelar o Contábil deste mês — volta a recalcular ao vivo' : 'Congelar o Contábil deste mês num retrato imutável (a Gerencial continua ao vivo)'}">${_frozen ? '🔓 Descongelar' : '🔒 Congelar'}</button>
            <button class="pm-extrair-btn" id="pm-extrair" title="Extração Contábil - 1: matriz de Produção Médica + Desempenho + consolidado">⬇ Extração Contábil</button>
            <button class="pm-extrair-btn" id="pm-mesames-topo" title="Mês a mês dos médicos — matriz médico × competências (Contábil/Gerencial, Repasse/Produção)">⇆ Mês a mês</button><!-- V679 -->
          </div>
        </div>

        <div class="pm-cards-row">
          ${receitaCardHtml(cRecebTot)}
          <div class="aic-grid aic-grid-mini">
            ${card('Produção Total', prodReal, cRecebTot, prodReal, 'tot')}<!-- V974: nomes por extenso (eram PROD. TOTAL/CONV/PART/SUS) -->
            ${card('Produção Convênio', c.conv, cConvR, c.conv, '', 'CONV')}
            ${card('Produção Particular', c.part, cPartR, c.part, '', 'PART')}
            ${card('Produção SUS', c.sus, _ger ? c.susRG : c.susR, c.sus)}<!-- V682: repasse SUS -->

            ${card('DESEMPENHO', cDesemp, null, 0, 'des')}
          </div>
        </div>

        <!-- V362: popover de filtro/imposto agora é montado no <body> (fora do decorador) -->

        <div class="pm-nav">${navHtml}</div>
        <div id="pm-body"></div>
        ${regrasGavetaHtml()}
      </div>`;

    renderBody(listaTipo, d);
    bindTopo();
    pmmGarantirFab();   // V674: botão flutuante ⇆ Mês a mês
  }

  // ── V923: competência em DRILLDOWN Ano > Mês ──────────────────────────────
  // Cada ANO é um cabeçalho ▸/▾ que expande/colapsa os meses; só o ano da
  // competência selecionada começa expandido. Clicar num mês seleciona (única).
  function compDropdownHtml(comps) {
    const st = estado();
    const aberto = !!st.compDDAberto;
    let pop = '';
    if (aberto) {
      const anos = [], porAno = new Map();
      for (const c of (comps || [])) {
        const a = String(c).slice(0, 4);
        if (!porAno.has(a)) { porAno.set(a, []); anos.push(a); }
        porAno.get(a).push(c);
      }
      const exp = st.compDDAnos || new Set([String(st.competencia || '').slice(0, 4)]);
      pop = `<div class="pm-compdd-pop">` + anos.map(a => {
        const ab = exp.has(a);
        return `<div class="pm-compdd-ano" data-dd-ano="${a}">
            <span class="pm-compdd-seta">${ab ? '▾' : '▸'}</span><span>${a}</span>
            <span class="pm-compdd-n">${porAno.get(a).length} ${porAno.get(a).length === 1 ? 'mês' : 'meses'}</span>
          </div>`
          + (ab ? porAno.get(a).map(c =>
              `<div class="pm-compdd-mes ${c === st.competencia ? 'on' : ''}" data-dd-comp="${c}">${rotuloComp(c)}${c === st.competencia ? ' <span class="pm-compdd-ck">✓</span>' : ''}</div>`).join('') : '');
      }).join('') + `</div>`;
    }
    return `<div class="pm-compdd pm-combo ${aberto ? 'aberto' : ''}" id="pm-compdd"><!-- "pm-combo": o hub flutuante NÃO absorve botões dentro de [class*="combo"] -->
      <button type="button" class="pm-select pm-compdd-btn" id="pm-comp-btn" aria-expanded="${aberto}">
        ${esc(rotuloComp(st.competencia || '') || '—')}<span class="pm-compdd-car">▾</span>
      </button>
      ${pop}
    </div>`;
  }

  // ── V923: gaveta "Regras aplicadas" (visão CONTÁBIL) — botão "‹" fixo na
  // borda direita; a gaveta lista, como checklist, TODAS as regras do motor
  // contábil deste módulo, com o estado do cadastro em azul quando dinâmico.
  function regrasStats(comp) {
    const q1 = (sql) => { try { const r = Banco.queryUnica(sql); return r ? (Number(Object.values(r)[0]) || 0) : 0; } catch (_) { return null; } };
    let tiposHab = 'INTERNO, HIBRIDO, EXTERNO';
    try { const r = Banco.queryUnica(`SELECT valor FROM config_calcular WHERE chave='TIPOS_HABILITADOS'`); if (r && r.valor) tiposHab = String(r.valor); } catch (_) {}
    let cpAtiva = false;
    try { const a = Banco.queryUnica(`SELECT valor FROM config_consulta_producao_meta WHERE chave='ativo'`); cpAtiva = !!(a && String(a.valor) === '1'); } catch (_) {}
    return {
      excecoes: q1(`SELECT COUNT(*) n FROM tabela_repasse_excecao WHERE ativo = 1`),
      excProducao: q1(`SELECT COUNT(*) n FROM tabela_repasse_excecao WHERE ativo = 1 AND UPPER(COALESCE(extracao,'QVIS')) = 'PRODUCAO'`),
      excAnulados: q1(`SELECT COUNT(*) n FROM tabela_repasse_excecao WHERE ativo = 1 AND COALESCE(anular_demais,0) = 1`),
      versoes: q1(`SELECT COUNT(*) n FROM tabela_versoes`),
      pacotes: q1(`SELECT COUNT(*) n FROM pacote_convenio WHERE ativo = 1`),
      perfis: q1(`SELECT COUNT(*) n FROM perfil_regra WHERE ativo = 1`),
      dupIsencoes: q1(`SELECT COUNT(*) n FROM duplicidade_excecao`),
      estrabFixo: q1(`SELECT COUNT(*) n FROM estrabismo_valor_medico`),
      lioExceto: q1(`SELECT COUNT(*) n FROM lio_exceto_termos`),
      congelado: temSnapContabil(comp),
      cpAtiva, tiposHab,
    };
  }
  function regrasGavetaHtml() {
    const st = estado();
    const puxador = `
      <button type="button" class="pm-regras-puxador${st.regrasAberto ? ' aberto' : ''}" id="pm-regras-puxador"
              title="${st.regrasAberto ? 'Fechar' : 'Regras aplicadas (visão Contábil)'}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
             stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>`;
    if (!st.regrasAberto) return puxador;

    const s = regrasStats(st.competencia);
    const dyn = (v, um, varios, zero) => {
      if (v == null) return '';
      const t = v === 0 ? (zero || `nenhum cadastro`) : v === 1 ? um : varios.replace('{n}', v);
      return ` <span class="pm-rg-dyn">— ${t}</span>`;
    };
    const it = (txt) => `<div class="pm-rg-item"><span class="pm-rg-ck">✓</span><span>${txt}</span></div>`;
    const gr = (t) => `<div class="pm-rg-grupo">${t}</div>`;
    const corpo = `
      ${gr('Cards totalizadores — o que cada um mostra e como é calculado')}
      ${it(`<strong>Receita competência</strong>: soma BRUTA do Valor R$ de TODAS as linhas da planilha de PRODUÇÃO da competência (todas as classificações e origens, sem filtro de vínculo/busca). Abaixo: <strong>Imposto</strong> = receita × % do mês (⚖ Imposto); <strong>Receita líquida</strong> = receita − imposto; a linha <strong>Contábil/Gerencial</strong> repete o Repasse do card Produção Total na visão ligada; <strong>% sobre PROD</strong> = (Repasse do card Produção Total + SANTO Anestesia) ÷ Receita líquida — fica vermelho fora da faixa 21–23%.`)}
      ${it(`<strong>Produção Total</strong>: produção (R$) = Convênio + Particular + SUS dos médicos que passam pelos filtros de vínculo (ilha do botão flutuante) e de busca. <strong>Repasse</strong> = repasse Convênio + Particular + SUS + Desempenho desses médicos, na visão ligada (Contábil ou Gerencial). O <strong>(x%)</strong> = Repasse ÷ produção do card.`)}
      ${it(`<strong>Produção Convênio</strong>: produção das linhas de origem CONVÊNIO (classes ⚙ Classificação; produtos do ✎ do card). <strong>Repasse</strong> = valor FIXO da regra da Base por linha (executante + indicante/solicitante + laudo + auxiliar). <strong>(x%)</strong> = Repasse ÷ produção Convênio.`)}
      ${it(`<strong>Produção Particular</strong>: produção das linhas PARTICULAR (mesmos filtros; produtos do ✎ do card). <strong>Repasse</strong> = PERCENTUAL da regra × Valor R$ da linha (ou tabela do Perfil Particular, quando houver). <strong>(x%)</strong> = Repasse ÷ produção Particular.`)}
      ${it(`<strong>Produção SUS</strong>: produção das linhas SUS. <strong>Repasse</strong> = tabela SUS da Base. <strong>(x%)</strong> = Repasse ÷ produção SUS.`)}
      ${it(`<strong>Desempenho</strong>: soma dos 12 fichários do módulo Relatórios (Desempenho) dos médicos filtrados, na visão ligada. Não tem produção própria — entra só no Repasse do card Produção Total.`)}

      ${gr('Fonte & elegibilidade')}
      ${it(`A fonte é a planilha de PRODUÇÃO da competência selecionada (1 linha = 1 item produzido).`)}
      ${it(`Executante = <strong>Cirurgião</strong>; se vazio, <strong>Médico</strong> — 1 dono por linha.`)}
      ${it(`Só <strong>CONSULTA / EXAME / PROCEDIMENTO</strong> geram repasse. OPME, Material, Medicamento, Taxa, Gás e Diária contam produção com repasse 0.`)}
      ${it(`Produção bruta = Valor R$ — conta mesmo sem regra na Base (recebido 0).`)}
      ${it(`SUS: a produção conta e o repasse sai pela tabela SUS da Base.`)}
      ${it(`Repasse só sobre produção &gt; 0.`)}
      ${it(`Linha sem fonte ou sem executante fica FORA da matriz (aparece só na Extração Contábil 2, com repasse "—").`)}

      ${gr('Papéis — "o todo" de cada linha')}
      ${it(`Recebido = <strong>Executante</strong> + (<strong>Indicante</strong> OU <strong>Solicitante</strong>, 1×) + <strong>Médico Laudo</strong> + <strong>Auxiliar</strong>.`)}
      ${it(`Convênio → valor FIXO da regra; Particular → PERCENTUAL × Valor R$.`)}

      ${gr('Base Tabela & versões')}
      ${it(`Vale a VERSÃO da Base vigente na <strong>data de admissão</strong> da linha${dyn(s.versoes, '1 versão publicada', '{n} versões publicadas', 'sem versões — vale a tabela viva')}.`)}
      ${it(`A tabela viva só cobre regra NUNCA publicada em versão alguma.`)}

      ${gr('Exceções (⚙ Ajustes)')}
      ${it(`Exceção por médico + procedimento + papel + fonte SOBREPÕE a regra geral, respeitando a vigência por data de admissão${dyn(s.excecoes, '1 ativa', '{n} ativas', 'nenhuma cadastrada')}.`)}
      ${it(`Exceção com extração "PRODUÇÃO" é paga no canal de Desempenho — aqui a linha fica zerada${dyn(s.excProducao, '1 assim', '{n} assim')}.`)}
      ${it(`Exceção com papéis ANULADOS zera os demais papéis da linha${dyn(s.excAnulados, '1 assim', '{n} assim')}.`)}
      ${it(`Estrabismo: valor FIXO por cirurgia para médico com regra própria (pago no Desempenho)${dyn(s.estrabFixo, '1 médico', '{n} médicos')}.`)}
      ${it(`LIO: termos EXCETO (ex.: PRESERFLO) tiram o produto da regra do LIO${dyn(s.lioExceto, '1 termo', '{n} termos')}.`)}

      ${gr('Individualidades')}
      ${it(`Excluído por tipo: só executante de vínculo habilitado recebe — hoje: <span class="pm-rg-dyn">${esc(s.tiposHab)}</span>; override manual por médico vale mais.`)}
      ${it(`Consulta paga pela Produção: valor FIXO ao executante (sem indicante/auxiliar/laudo) — <span class="pm-rg-dyn">${s.cpAtiva ? 'ATIVA' : 'desligada'}</span>.`)}
      ${it(`Períodos × Matriz: médico do fichário Períodos NÃO recebe consulta de Convênio fora da MATRIZ.`)}
      ${it(`Perfil Particular: admissão com perfil ativo paga pela tabela do perfil (override por procedimento: outra tabela ou valor fixo 1× por admissão+procedimento)${dyn(s.perfis, '1 perfil ativo', '{n} perfis ativos')}.`)}
      ${it(`Pacote de consulta por convênio: a consulta-mãe paga o valor do pacote (sem ind/aux/laudo); a "filha" de exames inclusos paga 1× por admissão quando o executante tem a especialidade; exame incluso fica com repasse 0${dyn(s.pacotes, '1 pacote ativo', '{n} pacotes ativos')}.`)}
      ${it(`Duplicidade histórica: papel já pago em competência ANTERIOR não paga de novo${dyn(s.dupIsencoes, '1 isenção cadastrada', '{n} isenções cadastradas', 'sem isenções')}.`)}
      ${it(`Híbrido sem-regra: procedimento sem regra na Base usa o REPASSADO real do QVIS do executante — exceto quando a admissão+médico tem fichário no Desempenho (não duplica).`)}
      ${it(`Os filtros ⚙ Classificação e o ✎ de produtos dos cards CONV/PART mudam o que compõe os cards.`)}

      ${gr('Desempenho & congelamento')}
      ${it(`Card DESEMPENHO = soma dos 12 fichários do módulo Relatórios; entra no Repasse do card Produção Total, mas NÃO na coluna Repasse da matriz (Conv+Part+SUS).`)}
      ${it(`Mês congelado: a visão Contábil lê o retrato imutável — este mês: <span class="pm-rg-dyn">${s.congelado ? 'CONGELADO 🔒' : 'ao vivo'}</span>.`)}`;

    return puxador + `
      <div class="pm-regras-gaveta" id="pm-regras-gaveta">
        <div class="pm-rg-head">📋 Regras aplicadas
          <span class="pm-rg-sub">Produção Médica · visão CONTÁBIL · ${esc(rotuloComp(st.competencia || '') || '—')}</span>
        </div>
        <div class="pm-rg-corpo">${corpo}</div>
      </div>`;
  }

  // V253: switch Contábil ↔ Gerencial
  function switchHtml() {
    const ger = estado().visao === 'gerencial';
    return `<div class="pm-switch" id="pm-switch" role="button" tabindex="0"
                 title="Alternar visão: Contábil (produção × regras) ↔ Gerencial (repasse real do Consolidado)">
      <span class="pm-sw-lbl ${ger ? '' : 'on'}">Contábil</span>
      <span class="pm-sw-track ${ger ? 'ger' : ''}"><span class="pm-sw-knob"></span></span>
      <span class="pm-sw-lbl ${ger ? 'on' : ''}">Gerencial</span>
    </div>`;
  }

  function popoverFiltro() {
    const st = estado();
    const itens = CLASS_ALL.map(([k, l]) => {
      const on = st.classes.includes(k);
      const padrao = CLASS_PADRAO.includes(k);
      return `<label class="pm-fopt"><input type="checkbox" data-classe="${k}" ${on ? 'checked' : ''}> ${l}${padrao ? '' : ' <span class="pm-fopt-x">excluído</span>'}</label>`;
    }).join('');
    const anim = st.popJustOpened; st.popJustOpened = false;
    return `<div class="pm-fpop${anim ? ' pm-anim' : ''}">
        <div class="pm-fpop-h">Classificações que compõem os cards</div>
        <div class="pm-fpop-b">${itens}</div>
        <div class="pm-fpop-f"><button class="pm-fpadrao" id="pm-fpadrao">só padrão</button></div>
      </div>`;
  }

  // V268: ajuste de imposto por mês/ano (drilldown) — abre pelo botão do globo
  function popoverImposto() {
    const st = estado();
    const anim = st.popJustOpened; st.popJustOpened = false;
    const comps = competenciasDisponiveis();
    const rows = comps.map(c => {
      const pctStr = (Number(lerImpostoPct(c)) || 0).toString().replace('.', ',');
      return `<div class="pm-iprow">
        <span class="pm-iprow-lbl">${rotuloComp(c)}</span>
        <span class="pm-iprow-in"><input class="pm-imp-in2" data-comp="${esc(c)}" value="${esc(pctStr)}" inputmode="decimal" maxlength="6">%</span>
      </div>`;
    }).join('');
    return `<div class="pm-fpop pm-ipop${anim ? ' pm-anim' : ''}">
        <div class="pm-fpop-h">Imposto por mês (% sobre a receita)</div>
        <div class="pm-fpop-b pm-ipop-b">${rows || '<div class="pm-ipop-vazio">Sem competências.</div>'}</div>
      </div>`;
  }

  function renderBody(listaTipo, d) {
    const st = estado();
    const body = document.getElementById('pm-body');
    if (st.medicoSel) { body.innerHTML = detalheHtml(d); bindDetalhe(); return; }
    if (st.aba === 'consolidado') body.innerHTML = producaoHtml(listaTipo, { comDesemp: true });   // V258 (#3): Consolidado = matriz completa (Produção + Desempenho)
    else if (st.aba === 'desempenho') body.innerHTML = desempenhoHtml(listaTipo, d);
    else body.innerHTML = producaoHtml(listaTipo, { comDesemp: false });   // V258 (#2): Produção médica = sem coluna Desempenho
    bindBody();
    pmAjustarCabecalhoFixo();   // V978
  }
  // V978: a 2ª linha do cabeçalho da matriz gruda exatamente onde a 1ª (grupos) termina
  function pmAjustarCabecalhoFixo() {
    document.querySelectorAll('#pm-body .pm-tabela').forEach(tab => {
      const r1 = tab.querySelector('thead tr.pm-th-grp');
      if (r1) tab.style.setProperty('--pm-r1', Math.round(r1.getBoundingClientRect().height) + 'px');
    });
  }

  function ordenar(lista, campo) { return [...lista].sort((a, b) => b[campo] - a[campo]); }
  // V263 (#2): filtro multi-médico via combo de seleção (sem digitar). Vazio = todos.
  function filtrarBusca(lista) {
    const sel = estado().medicosSel || [];
    if (!sel.length) return lista;
    const setSel = new Set(sel);
    return lista.filter(r => setSel.has(r.nome));
  }
  function buscaInput() { return `<input class="pm-busca" id="pm-busca" placeholder="Buscar médico(s) — vírgula p/ comparar…" value="${esc(estado().busca)}">`; }
  // V263: combo de seleção de médicos — multi, com chips; clica p/ adicionar, ✕ p/ remover. Sem checkbox.
  function comboMedicosHtml(listaTipo) {
    const st = estado();
    const sel = st.medicosSel || [];
    const selSet = new Set(sel);
    const MAX_VIS = 2;   // V265: mostra até 2 chips; do 3º em diante vira "+N" (caixa não cresce)
    const vis = sel.slice(0, MAX_VIS);
    const resto = sel.length - vis.length;
    const chips = vis.map(n => `<span class="pm-medchip" title="${esc(n)}">${esc(n)}<i class="pm-medchip-x" data-med="${esc(n)}" title="remover">✕</i></span>`).join('')
      + (resto > 0 ? `<span class="pm-medchip pm-medchip-mais" title="mais ${resto} selecionado(s) — abra a lista para gerenciar">+${resto}</span>` : '');
    const nomes = [...new Set((listaTipo || []).map(r => r.nome))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    // V922: marcados sobem ao topo da lista
    const nomesOrd = nomes.slice().sort((a, b) => (selSet.has(b) ? 1 : 0) - (selSet.has(a) ? 1 : 0));
    const opts = nomesOrd.map(n => `<div class="pm-medopt ${selSet.has(n) ? 'on' : ''}" data-med="${esc(n)}" data-busca="${esc(normalizar(n))}"><span>${esc(n)}</span>${selSet.has(n) ? '<span class="pm-medopt-c">✓</span>' : ''}</div>`).join('');
    return `<div class="pm-medcombo ${st.medComboAberto ? 'aberto' : ''}" id="pm-medcombo">
      <div class="pm-medcombo-box" id="pm-medcombo-box" tabindex="0" title="Selecionar médico(s) para comparar">
        ${chips || '<span class="pm-medcombo-ph">Selecionar médico(s)…</span>'}
        <i class="pm-medcombo-car">▾</i>
      </div>
      ${st.medComboAberto ? `<div class="pm-medcombo-pop">
        ${sel.length ? `<button class="pm-medcombo-limpar" id="pm-medcombo-limpar">✕ limpar seleção (${sel.length})</button>` : ''}
        <div class="pm-medcombo-buscabox"><input type="text" class="pm-medcombo-busca" id="pm-medcombo-busca" placeholder="🔎 Buscar médico…" value="${esc(st.medComboBusca || '')}" autocomplete="off"></div>
        <div class="pm-medcombo-lista">${opts || '<div class="pm-medopt-vazio">Nenhum médico nesta competência.</div>'}</div>
        <div class="pm-medcombo-rodape">${sel.length} selecionado(s) · ${nomes.length} médicos</div>
      </div>` : ''}
    </div>`;
  }
  function buscaAdmInput() { return `<input class="pm-busca pm-busca-adm" id="pm-busca-adm" placeholder="🔎 Filtrar admissão…" value="${esc(estado().buscaAdm)}">`; }
  function tagNC(r) { return r.cadastrado ? '' : ' <span class="pm-tag-nc">não cadastrado</span>'; }

  // ── MATRIZ: produção × repasse por fonte (Conv/Part/SUS) (+ Desempenho se comDesemp) + drilldown ──
  // V258: Produção médica (#2) = SEM Desempenho; Consolidado (#3) = COM Desempenho.
  // V259: coluna SUS sempre (produção; repasse pronto p/ futuro). REPASSE de PROD TOTAL = Conv+Part+SUS (NÃO soma Desempenho).
  function producaoHtml(listaTipo, opts) {
    const st = estado();
    const comDesemp = !!(opts && opts.comDesemp);
    const ger = st.visao === 'gerencial';
    const repDe = (r) => ger
      ? { conv: r.convRecebG || 0, part: r.partRecebG || 0, sus: r.susRecebG || 0, des: r.desempG || 0 }
      : { conv: r.convReceb || 0, part: r.partReceb || 0, sus: r.susReceb || 0, des: r.desemp || 0 };
    const totRep = (r) => { const x = repDe(r); return x.conv + x.part + x.sus; };   // PROD TOTAL repasse: Conv+Part+SUS (sem Desempenho)
    const pct = (rep, prod) => (prod > 0 ? (100 * rep / prod).toFixed(1).replace('.', ',') : '0,0') + '%';
    const listaF = filtrarBusca(listaTipo);
    const lista = [...listaF].sort((a, b) =>
      st.ord === 'rep' ? (totRep(b) - totRep(a)) : (b.totalProd - a.totalProd));

    const linhas = lista.map(r => {
      const x = repDe(r); const rt = x.conv + x.part + x.sus;
      return `
      <tr class="pm-row" data-medico="${esc(r.nome)}">
        <td class="pm-nome">${esc(CodigoMedico.exibir(r.nome))}${tagNC(r)}</td>
        <td class="num pm-strong">${fmtBRL(r.totalProd)}</td><td class="num pm-rep pm-strong">${fmtBRL(rt)}</td><td class="num pm-pct">${pct(rt, r.totalProd)}</td>
        <td class="num">${fmtBRL(r.convProd)}</td><td class="num pm-rep">${fmtBRL(x.conv)}</td><td class="num pm-pct">${pct(x.conv, r.convProd)}</td>
        <td class="num">${fmtBRL(r.partProd)}</td><td class="num pm-rep">${fmtBRL(x.part)}</td><td class="num pm-pct">${pct(x.part, r.partProd)}</td>
        <td class="num">${fmtBRL(r.susProd)}</td><td class="num pm-rep">${fmtBRL(x.sus)}</td><td class="num pm-pct">${pct(x.sus, r.susProd)}</td>
        ${comDesemp ? `<td class="num pm-des">${fmtBRL(x.des)}</td>` : ''}
        <td class="pm-ver">›</td></tr>`;
    }).join('');

    // V258 (#5): totalizadores respeitam TODOS os filtros (inclui a busca de médico)
    const T = listaF.reduce((a, r) => {
      const x = repDe(r);
      a.prodT += r.totalProd; a.prodC += r.convProd; a.prodP += r.partProd; a.prodS += r.susProd;
      a.repC += x.conv; a.repP += x.part; a.repS += x.sus; a.des += x.des;
      a.repT += (x.conv + x.part + x.sus);
      return a;
    }, { prodT: 0, prodC: 0, prodP: 0, prodS: 0, repT: 0, repC: 0, repP: 0, repS: 0, des: 0 });

    // V260: larguras default por coluna (table-layout:fixed → cabe sempre; resize próprio ajusta os <col>)
    const colW = ['210','96','96','50','96','96','50','96','96','50','96','96','50'].concat(comDesemp ? ['96'] : []).concat(['30']);
    const colgroupHtml = '<colgroup>' + colW.map(w => `<col style="width:${w}px">`).join('') + '</colgroup>';
    const nCols = comDesemp ? 15 : 14;
    return `<div class="pm-barra">${comboMedicosHtml(listaTipo)}${buscaAdmInput()}${st.buscaAdm ? `<span class="pm-adm-tag">admissão: ${esc(st.buscaAdm)} ✕</span>` : ''}</div>
      <div class="pm-tabela-wrap"><table class="pm-tabela pm-tabela-pg pm-tabela-fix">${colgroupHtml}
        <thead>
          <tr class="pm-th-grp">
            <th></th>
            <th class="num pm-grp" colspan="3">PROD. TOTAL</th>
            <th class="num pm-grp pm-grp-conv" colspan="3">CONVÊNIO</th>
            <th class="num pm-grp pm-grp-part" colspan="3">PARTICULAR</th>
            <th class="num pm-grp pm-grp-sus" colspan="3">SUS</th>
            ${comDesemp ? `<th class="num pm-grp pm-grp-des">DESEMP.</th>` : ''}<th></th>
          </tr>
          <tr><th>Médico</th>
            <th class="num pm-th-ord" data-ord="prod">Produção${st.ord === 'prod' ? ' ▾' : ''}</th><th class="num pm-th-ord" data-ord="rep">Repasse${st.ord === 'rep' ? ' ▾' : ''}</th><th class="num pm-pct-h">%</th>
            <th class="num">Produção</th><th class="num">Repasse</th><th class="num pm-pct-h">%</th>
            <th class="num">Produção</th><th class="num">Repasse</th><th class="num pm-pct-h">%</th>
            <th class="num">Produção</th><th class="num">Repasse</th><th class="num pm-pct-h">%</th>
            ${comDesemp ? `<th class="num">Repasse</th>` : ''}<th></th></tr>
        </thead>
        <tbody>${linhas || `<tr><td colspan="${nCols}" class="pm-vazio">Nenhum médico nesta competência.</td></tr>`}</tbody>
        <tfoot><tr class="pm-total"><td>TOTAL</td>
          <td class="num pm-strong">${fmtBRL(T.prodT)}</td><td class="num pm-rep pm-strong">${fmtBRL(comDesemp ? T.repT + T.des : T.repT)}</td><td class="num pm-pct">${pct(comDesemp ? T.repT + T.des : T.repT, T.prodT)}</td>
          <td class="num">${fmtBRL(T.prodC)}</td><td class="num pm-rep">${fmtBRL(T.repC)}</td><td class="num pm-pct">${pct(T.repC, T.prodC)}</td>
          <td class="num">${fmtBRL(T.prodP)}</td><td class="num pm-rep">${fmtBRL(T.repP)}</td><td class="num pm-pct">${pct(T.repP, T.prodP)}</td>
          <td class="num">${fmtBRL(T.prodS)}</td><td class="num pm-rep">${fmtBRL(T.repS)}</td><td class="num pm-pct">${pct(T.repS, T.prodS)}</td>
          ${comDesemp ? `<td class="num pm-des">${fmtBRL(T.des)}</td>` : ''}<td></td></tr></tfoot>
      </table></div>
      <div class="pm-rodape">${ger
        ? `Visão <strong>Gerencial</strong>: repasse REAL do mês. Conv/Part/SUS pela origem${comDesemp ? '; Desempenho = fichários (coluna à parte)' : ''}. <strong>Repasse PROD TOTAL = Conv + Part + SUS</strong> (não inclui Desempenho). % = repasse ÷ produção da mesma fonte.`
        : `Visão <strong>Contábil</strong>: produção × Base Tabela — repasse só sobre produção > 0${comDesemp ? '. Desempenho na coluna à parte' : ''}. <strong>Repasse PROD TOTAL = Conv + Part + SUS</strong> (não inclui Desempenho). SUS pago pela <strong>tabela SUS</strong> da Base (V682). % = repasse ÷ produção da mesma fonte.`} · Clique num médico para a <strong>decomposição por papel</strong>.</div>`;
  }

  function somaReceb(lista, qual) { return lista.reduce((s, r) => s + (qual === 'conv' ? r.convReceb : r.partReceb), 0); }

  // ── ABA: Consolidado (matriz da Produção Médica + matriz do Desempenho unificadas) ──
  function consolidadoHtml(listaTipo) {
    const st = estado();
    const lista = [...filtrarBusca(listaTipo)].sort((a, b) => ((b.convReceb + b.partReceb + b.desemp) - (a.convReceb + a.partReceb + a.desemp)));
    const t = somaCards(listaTipo);
    const linhas = lista.map(r => {
      const repProd = r.convReceb + r.partReceb;
      return `
      <tr><td class="pm-nome">${esc(CodigoMedico.exibir(r.nome))}${tagNC(r)}</td>
        <td class="num">${fmtBRL(r.convProd + r.partProd + r.susProd)}</td>
        <td class="num pm-rep">${fmtBRL(r.convReceb)}</td>
        <td class="num pm-rep">${fmtBRL(r.partReceb)}</td>
        <td class="num pm-rep pm-strong">${fmtBRL(repProd)}</td>
        <td class="num pm-des">${fmtBRL(r.desemp)}</td>
        <td class="num pm-rep pm-strong">${fmtBRL(repProd + r.desemp)}</td></tr>`;   /* V963: TOTAL A PAGAR em #46688c */
    }).join('');
    const repProdT = t.convR + t.partR;
    return `<div class="pm-barra">${comboMedicosHtml(listaTipo)}${buscaAdmInput()}${st.buscaAdm ? `<span class="pm-adm-tag">admissão: ${esc(st.buscaAdm)} ✕</span>` : ''}</div>
      <div class="pm-tabela-wrap"><table class="pm-tabela">
        <thead><tr><th>Médico</th><th class="num">Produção</th>
          <th class="num">Rep. Conv.</th><th class="num">Rep. Part.</th><th class="num">Rep. Produção</th>
          <th class="num">Desempenho</th><th class="num">TOTAL A PAGAR</th></tr></thead>
        <tbody>${linhas || `<tr><td colspan="7" class="pm-vazio">Sem dados.</td></tr>`}</tbody>
        <tfoot><tr class="pm-total"><td>TOTAL</td>
          <td class="num">${fmtBRL(t.conv + t.part + t.sus)}</td>
          <td class="num pm-rep">${fmtBRL(t.convR)}</td>
          <td class="num pm-rep">${fmtBRL(t.partR)}</td>
          <td class="num pm-rep pm-strong">${fmtBRL(repProdT)}</td>
          <td class="num pm-des">${fmtBRL(t.desemp)}</td>
          <td class="num pm-rep pm-strong">${fmtBRL(repProdT + t.desemp)}</td></tr></tfoot><!-- V963: TOTAL A PAGAR em #46688c -->
      </table></div>
      <div class="pm-rodape">Consolida as duas matrizes: <strong>Rep. Produção</strong> vem da aba Produção médica (convênio + particular) e <strong>Desempenho</strong> da aba Desempenho (12 fichários). <strong>TOTAL A PAGAR = Rep. Produção + Desempenho</strong>. Desempenho não entra ao filtrar por admissão.</div>`;
  }

  // ── ABA: Desempenho (matriz médico × módulo, do Relatórios) ─────────────────
  function desempenhoHtml(listaTipo, d) {
    const st = estado();
    const tipos = new Set(st.tipos);
    const selN = (st.medicosSel || []).map(n => normalizar(n));   // V263: filtra desempenho pelos médicos selecionados
    let rows = (d.desRows || []).filter(l => tipos.has(l._tipo));
    if (selN.length) rows = rows.filter(l => { const p = normalizar(l.profissional); return selN.some(x => p.includes(x)); });
    rows = [...rows].sort((a, b) => (Number(b.valor) || 0) - (Number(a.valor) || 0));
    const total = rows.reduce((s, l) => s + (Number(l.valor) || 0), 0);
    if (!rows.length) {
      return `<div class="pm-barra">${comboMedicosHtml(listaTipo)}</div>
        <div class="pm-vazio">Sem desempenho nesta competência/filtro. Os 12 fichários do módulo <strong>Relatórios</strong> alimentam esta aba — verifique se foram importados/calculados.</div>`;
    }
    const LIMITE = 1000;
    const body = rows.slice(0, LIMITE).map(l => {
      const ob = l.origem ? Utilidades.badgeFonte(l.origem) : '';   // V947: tag padrão (SUS agora aparece)
      return `<tr>
        <td><span class="pm-tag-des">${esc(l.status || 'Desempenho')}</span></td>
        <td>${esc(l.modulo)}</td>
        <td>${esc(l.admissao || '—')}</td>
        <td>${esc((l.data_admissao || '').toString().slice(0, 10) || '—')}</td>
        <td><span class="pm-tag-papel">${esc(l.papel || '—')}</span></td>
        <td class="pm-nome">${esc(CodigoMedico.exibir(l.profissional || '—'))}</td>
        <td>${esc(l.paciente || '—')}</td>
        <td>${ob}</td>
        <td>${esc(l.convenio || '')}</td>
        <td class="pm-desc">${esc(l.descricao || '')}</td>
        <td class="num pm-rep">${fmtBRL(l.valor)}</td></tr>`;
    }).join('');
    const trunc = rows.length > LIMITE ? `<div class="pm-rodape">Mostrando ${LIMITE} de ${rows.length.toLocaleString('pt-BR')} linhas.</div>` : '';
    return `<div class="pm-barra">${comboMedicosHtml(listaTipo)}
        <span class="pm-resumo-des">Linhas: <strong>${rows.length.toLocaleString('pt-BR')}</strong> · Valor total: <strong class="pm-rep">R$ ${fmtBRL(total)}</strong></span></div>
      <div class="pm-tabela-wrap"><table class="pm-tabela">
        <thead><tr><th>Status</th><th>Módulo</th><th>Admissão</th><th>Data</th><th>Papel</th><th>Profissional</th><th>Paciente</th><th>Origem</th><th>Convênio</th><th>Descrição</th><th class="num">Valor</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>${trunc}
      <div class="pm-rodape">Mesmo formato do módulo Relatórios — consolidado dos 12 fichários de Desempenho (respeita o filtro de tipo de vínculo).</div>`;
  }

  // ── Drilldown: RESUMO POR PAPEL (V258 #4) — 1 linha por papel + total geral; respeita filtros ──
  function detalheHtml(d) {
    const st = estado();
    const reg = d.lista.find(r => r.nome === st.medicoSel);
    if (!reg) { st.medicoSel = null; return producaoHtml(d.lista.filter(r => st.tipos.includes(r.tipo)), { comDesemp: st.aba === 'consolidado' }); }
    const ger = st.visao === 'gerencial';
    const prod = reg.totalProd;

    let papeis;
    if (ger) {
      const pg = reg.papeisG || {};
      papeis = Object.keys(pg).map(k => ({ nome: k, valor: pg[k] }));
    } else {
      papeis = [
        { nome: 'Executante', valor: reg.rExec || 0 },
        { nome: 'Indicante / Solicitante', valor: reg.rInd || 0 },
        { nome: 'Auxiliar', valor: reg.rAux || 0 },
        { nome: 'Médico de Laudo', valor: reg.rLaudo || 0 }
      ];
    }
    papeis = papeis.filter(p => Math.abs(p.valor) > 0.005).sort((a, b) => b.valor - a.valor);
    const totalPap = papeis.reduce((s, p) => s + p.valor, 0);
    const pctP = (v) => (totalPap > 0 ? (100 * v / totalPap).toFixed(1).replace('.', ',') : '0,0') + '%';

    const rows = papeis.map(p => `
      <tr><td><span class="pm-tag-papel">${esc(p.nome)}</span></td>
        <td class="num pm-rep pm-strong">${fmtBRL(p.valor)}</td>
        <td class="num pm-pct">${pctP(p.valor)}</td></tr>`).join('');

    return `
      <div class="pm-dethead">
        <button class="pm-voltar" id="pm-voltar">← voltar</button>
        <div><div class="pm-detnome">${esc(reg.nome)}${tagNC(reg)}</div>
        <div class="pm-sub">${rotuloComp(st.competencia)} · Visão ${ger ? 'Gerencial' : 'Contábil'} · Produção R$ ${fmtBRL(prod)} · Repasse R$ ${fmtBRL(totalPap)}${st.buscaAdm ? ` · admissão: ${esc(st.buscaAdm)}` : ''}</div></div>
      </div>
      <div class="pm-tabela-wrap"><table class="pm-tabela pm-tabela-det">
        <thead><tr><th>Papel</th><th class="num">Repasse</th><th class="num pm-pct-h">% do repasse</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="3" class="pm-vazio">Sem repasse por papel neste filtro.</td></tr>`}</tbody>
        <tfoot><tr class="pm-total"><td>TOTAL</td><td class="num pm-rep pm-strong">${fmtBRL(totalPap)}</td><td class="num pm-pct">${papeis.length ? '100,0%' : '0,0%'}</td></tr></tfoot>
      </table></div>
      <div class="pm-rodape">${ger
        ? 'Decomposição pelo <strong>PAPEL do snapshot</strong> (repasse real do mês). Respeita os filtros ativos (vínculo, classificação, admissão).'
        : 'Decomposição do "todo" pelas <strong>regras da Base Tabela</strong> (valor fixo ou %). A soma dos papéis = repasse Contábil do médico. Respeita os filtros ativos.'}</div>`;
  }

  // ── Bindings ────────────────────────────────────────────────────────────────
  function recompute(fn) { Utilidades.comLoading(() => { fn(); render(); }, 'Carregando…', { semFundo: true }); }

  // ════ EXTRAÇÃO (Excel da matriz Produção Médica + valores adicionais) ════
  function adicionaisDe(comp) {
    try { return Banco.query('SELECT id, beneficiario, descricao, valor FROM pm_valores_adicionais WHERE competencia = ? ORDER BY id', [comp]); }
    catch (e) { return []; }
  }

  function abrirModalExtracao() {
    const st = estado();
    const comp = st.competencia;
    document.getElementById('pm-modal-ext')?.remove();
    const el = document.createElement('div');
    el.id = 'pm-modal-ext';
    el.className = 'pm-ext-overlay';
    document.body.appendChild(el);

    const desenhar = () => {
      const itens = adicionaisDe(comp);
      const totAdd = itens.reduce((s, i) => s + (Number(i.valor) || 0), 0);
      el.innerHTML = `
        <div class="pm-ext-modal">
          <div class="pm-ext-head">
            <h3>Extração Contábil · ${rotuloComp(comp)}</h3>
            <button class="pm-ext-x" id="pm-ext-fechar">✕</button>
          </div>
          <div class="pm-ext-body">
            <p class="pm-ext-info"><strong>Contábil 1</strong> — 2 abas: <strong>Produção Médica</strong> (matriz como está na tela, com SUS, + consolidado no fim — a <strong>CONSOLIDAÇÃO TOTAL é o mesmo número da tela</strong>) e <strong>Desempenho</strong> (detalhe por médico/módulo). Os valores adicionais abaixo saem como <strong>SANTO Anestesia</strong> (linha própria; entram só no % sobre a receita líquida, como na tela).<br>
            <strong>Contábil 2</strong> — o relatório de <strong>PRODUÇÃO linha a linha</strong> com duas colunas no fim: <strong>REPASSE (regra aplicada)</strong> — com <strong>SEM REGRA</strong> quando o procedimento não tem regra na Base — e <strong>V. TABELA</strong> (versão usada na regra).</p>
            <div class="pm-ext-sec">Valores adicionais desta competência (= SANTO Anestesia)</div>
            ${itens.length ? `<table class="pm-ext-tab">
              <thead><tr><th>Beneficiário</th><th>Descrição</th><th class="num">Valor</th><th></th></tr></thead>
              <tbody>${itens.map(i => `<tr>
                <td>${esc(i.beneficiario)}</td><td>${esc(i.descricao || '')}</td>
                <td class="num atlas-rep">R$ ${fmtBRL(i.valor)}</td>
                <td><button class="pm-ext-del" data-id="${i.id}" title="Remover">✕</button></td></tr>`).join('')}
              </tbody>
              <tfoot><tr><td colspan="2"><strong>Total adicionais</strong></td><td class="num atlas-rep"><strong>R$ ${fmtBRL(totAdd)}</strong></td><td></td></tr></tfoot><!-- V963 -->
            </table>` : `<div class="pm-ext-vazio">Nenhum valor adicional lançado. Use o formulário abaixo se precisar (ex.: empresa de serviços anestésicos).</div>`}
            <div class="pm-ext-form">
              <input type="text" id="pm-ext-benef" placeholder="Beneficiário (médico ou empresa)" maxlength="120">
              <input type="text" id="pm-ext-desc" placeholder="Descrição (opcional)" maxlength="160">
              <input type="number" step="0.01" id="pm-ext-valor" placeholder="Valor (R$)">
              <button id="pm-ext-add">+ Adicionar</button>
            </div>
          </div>
          <div class="pm-ext-foot">
            <button class="pm-ext-cancel" id="pm-ext-cancel">Fechar</button>
            <button class="pm-ext-go" id="pm-ext-go2" title="Relatório de PRODUÇÃO linha a linha + coluna do repasse (regra aplicada) + coluna da versão da tabela">⬇ Gerar Extração Contábil - 2</button>
            <button class="pm-ext-go" id="pm-ext-go">⬇ Gerar Extração Contábil - 1</button>
          </div>
        </div>`;

      el.querySelector('#pm-ext-fechar').onclick = () => el.remove();
      el.querySelector('#pm-ext-cancel').onclick = () => el.remove();
      el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
      el.querySelector('#pm-ext-add').onclick = async () => {
        const benef = el.querySelector('#pm-ext-benef').value.trim();
        const desc = el.querySelector('#pm-ext-desc').value.trim();
        const val = parseFloat(el.querySelector('#pm-ext-valor').value);
        if (!benef) { Utilidades.toast?.('Informe o beneficiário (médico ou empresa).', 'error'); return; }
        if (isNaN(val) || val === 0) { Utilidades.toast?.('Informe um valor diferente de zero.', 'error'); return; }
        Banco.executar('INSERT INTO pm_valores_adicionais (competencia, beneficiario, descricao, valor) VALUES (?,?,?,?)', [comp, benef, desc, val]);
        await Banco.salvar();
        desenhar(); render();   // V488: atualiza também o card principal (o % sobre PROD reflete o novo SANTO)
      };
      el.querySelectorAll('.pm-ext-del').forEach(b => b.onclick = async () => {
        Banco.executar('DELETE FROM pm_valores_adicionais WHERE id = ?', [Number(b.dataset.id)]);
        await Banco.salvar();
        desenhar(); render();   // V488: atualiza o card principal (% sobre PROD)
      });
      el.querySelector('#pm-ext-go').onclick = async () => {
        el.querySelector('#pm-ext-go').disabled = true;
        try { await exportarPMExcel(); el.remove(); }
        catch (e) { console.error('[pm] export:', e); Utilidades.toast?.('Falha ao gerar o Excel: ' + e.message, 'error', 5000); el.querySelector('#pm-ext-go').disabled = false; }
      };
      el.querySelector('#pm-ext-go2').onclick = async () => {
        el.querySelector('#pm-ext-go2').disabled = true;
        try { await exportarPMExcel2(); el.remove(); }
        catch (e) { console.error('[pm] export2:', e); Utilidades.toast?.('Falha ao gerar o Excel: ' + e.message, 'error', 5000); el.querySelector('#pm-ext-go2').disabled = false; }
      };
    };
    desenhar();
  }

  async function exportarPMExcel() {
    if (typeof ExcelJS === 'undefined') { Utilidades.toast?.('ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return; }
    const st = estado();
    const comp = st.competencia;
    const d = ensureDados();
    const listaTipo = d.lista.filter(r => st.tipos.includes(r.tipo));
    const lista = ordenar(filtrarBusca(listaTipo), st.ord === 'rep' ? 'totalReceb' : 'totalProd');
    const adds = adicionaisDe(comp);

    const fmtMoney = '"R$" #,##0.00';
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ATLAS — Repasse Médico';
    wb.created = new Date();

    // ═══════════ ABA 1: PRODUÇÃO MÉDICA ═══════════
    const ws = wb.addWorksheet('Produção Médica', {
      properties: { tabColor: { argb: 'FF03624C' } },
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.columns = [
      { header: 'Médico',         key: 'medico', width: 34 },
      { header: 'Conv. Prod.',    key: 'cp', width: 16, style: { numFmt: fmtMoney } },
      { header: 'Conv. Repasse',  key: 'cr', width: 16, style: { numFmt: fmtMoney } },
      { header: 'Part. Prod.',    key: 'pp', width: 16, style: { numFmt: fmtMoney } },
      { header: 'Part. Repasse',  key: 'pr', width: 16, style: { numFmt: fmtMoney } },
      { header: 'SUS Prod.',      key: 'sp', width: 16, style: { numFmt: fmtMoney } },   // V685
      { header: 'SUS Repasse',    key: 'sr', width: 16, style: { numFmt: fmtMoney } },   // V685
      { header: 'Prod. Total',    key: 'tp', width: 16, style: { numFmt: fmtMoney } },
      { header: 'Repasse',        key: 'tr', width: 16, style: { numFmt: fmtMoney } },
      { header: '%',              key: 'pct', width: 9,  style: { numFmt: '0.0"%"' } },
    ];
    const COL_VAL = 9;   // V685: coluna "Repasse" (usada pelo consolidado no fim)
    const headerRow = ws.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell(c => {
      c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF021A1C' } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    lista.forEach(r => {
      const tp = r.convProd + r.partProd + (r.susProd || 0);   // V685: produção total = C+P+SUS (igual à tela)
      ws.addRow({ medico: r.nome, cp: r.convProd, cr: r.convReceb, pp: r.partProd, pr: r.partReceb, sp: r.susProd || 0, sr: r.susReceb || 0, tp, tr: r.totalReceb, pct: tp ? (100 * r.totalReceb / tp) : 0 });
    });
    const tConv = lista.reduce((s, r) => s + r.convProd, 0), tConvR = lista.reduce((s, r) => s + r.convReceb, 0);
    const tPart = lista.reduce((s, r) => s + r.partProd, 0), tPartR = lista.reduce((s, r) => s + r.partReceb, 0);
    const tSus = lista.reduce((s, r) => s + (r.susProd || 0), 0), tSusR = lista.reduce((s, r) => s + (r.susReceb || 0), 0);   // V685
    const tRec = lista.reduce((s, r) => s + r.totalReceb, 0);
    const tProdT = tConv + tPart + tSus;
    const rowT = ws.addRow({ medico: 'TOTAL', cp: tConv, cr: tConvR, pp: tPart, pr: tPartR, sp: tSus, sr: tSusR, tp: tProdT, tr: tRec, pct: tProdT ? (100 * tRec / tProdT) : 0 });
    rowT.eachCell(c => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6EFED' } }; });

    // ── SANTO Anestesia (detalhe dos valores adicionais) ──
    const santo = adds.reduce((s, a) => s + (Number(a.valor) || 0), 0);
    if (adds.length) {
      ws.addRow({});
      const rTit = ws.addRow({ medico: 'SANTO ANESTESIA — valores adicionais' });
      rTit.getCell(1).font = { bold: true, color: { argb: 'FF03624C' } };
      const rHead = ws.addRow({ medico: 'Beneficiário', cp: 'Descrição', tr: 'Valor' });
      rHead.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF021A1C' } }; });
      adds.forEach(a => {
        const r = ws.addRow({ medico: a.beneficiario, cp: a.descricao || '', tr: Number(a.valor) || 0 });
        r.getCell(2).numFmt = '@';
      });
      const rTotA = ws.addRow({ medico: 'Total SANTO Anestesia', tr: santo });
      rTotA.eachCell(c => { c.font = { bold: true }; });
    }

    // ── CONSOLIDADO (no fim da matriz) ──
    // V685: a CONSOLIDAÇÃO TOTAL da extração é o MESMO número da tela
    // (Conv + Part + SUS + Desempenho). O SANTO Anestesia NÃO soma no total —
    // como na tela, ele entra só no "% sobre Receita Líquida".
    const prodTotal   = receitaPuraTotal(comp);
    const impPct      = lerImpostoPct(comp);
    const imposto     = prodTotal * impPct / 100;
    const receitaLiq  = prodTotal - imposto;
    const producaoMed = tConvR + tPartR + tSusR;                  // Repasse Conv+Part+SUS (sem Desempenho)
    const desempTotal = lista.reduce((s, r) => s + (Number(r.desemp) || 0), 0);
    const consolidTot = producaoMed + desempTotal;                // = consolidação total da tela
    const pctConsol   = receitaLiq > 0 ? (100 * (consolidTot + santo) / receitaLiq) : 0;   // % igual ao da tela (SANTO só aqui)

    ws.addRow({});
    const cTit = ws.addRow({ medico: 'CONSOLIDADO' });
    cTit.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF03624C' } };
    const linhaCons = (label, valor, opt) => {
      opt = opt || {};
      const r = ws.addRow({ medico: label, tr: valor });
      r.getCell(COL_VAL).numFmt = fmtMoney;
      const cor = opt.red ? 'FFC0392B' : (opt.verde ? 'FF03624C' : 'FF042222');
      r.getCell(1).font = { bold: !!opt.bold, color: { argb: cor } };
      r.getCell(COL_VAL).font = { bold: !!opt.bold, color: { argb: cor } };
      if (opt.fill) {
        r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDFF2EA' } };
        r.getCell(COL_VAL).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDFF2EA' } };
      }
      return r;
    };
    linhaCons('PROD. TOTAL do mês', prodTotal);
    linhaCons('Imposto (' + impPct.toFixed(1).replace('.', ',') + '%)', imposto, { red: true });
    linhaCons('Receita líquida', receitaLiq, { bold: true });
    ws.addRow({});
    linhaCons('Produção Médica (Conv+Part+SUS)', producaoMed);
    linhaCons('Desempenho', desempTotal);
    linhaCons('CONSOLIDAÇÃO TOTAL', consolidTot, { bold: true, verde: true, fill: true });   // V685: = tela
    linhaCons('SANTO Anestesia (entra só no %)', santo);
    const rPct = ws.addRow({ medico: '% sobre Receita Líquida (com SANTO)', tr: pctConsol });
    rPct.getCell(COL_VAL).numFmt = '0.0"%"';
    rPct.getCell(1).font = { bold: true, color: { argb: 'FF03624C' } };
    rPct.getCell(COL_VAL).font = { bold: true, color: { argb: 'FF03624C' } };
    rPct.getCell(COL_VAL).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDFF2EA' } };

    // ═══════════ ABA 2: DESEMPENHO ═══════════
    const ws2 = wb.addWorksheet('Desempenho', {
      properties: { tabColor: { argb: 'FFB8965A' } },
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws2.columns = [
      { header: 'Médico', key: 'medico', width: 34 },
      { header: 'Módulo', key: 'modulo', width: 26 },
      { header: 'Valor',  key: 'valor', width: 16, style: { numFmt: fmtMoney } },
    ];
    const h2 = ws2.getRow(1);
    h2.height = 24;
    h2.eachCell(c => {
      c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF021A1C' } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    const desLista = lista.filter(r => (Number(r.desemp) || 0) !== 0)
                          .sort((a, b) => (Number(b.desemp) || 0) - (Number(a.desemp) || 0));
    desLista.forEach(r => {
      const mods = r.desempMod || {};
      const keys = Object.keys(mods).sort();
      if (keys.length) keys.forEach(mod => ws2.addRow({ medico: r.nome, modulo: mod, valor: Number(mods[mod]) || 0 }));
      else ws2.addRow({ medico: r.nome, modulo: '—', valor: Number(r.desemp) || 0 });
    });
    if (!desLista.length) ws2.addRow({ medico: 'Sem desempenho nesta competência', modulo: '', valor: 0 });
    const rT2 = ws2.addRow({ medico: 'TOTAL', modulo: '', valor: desempTotal });
    rT2.eachCell(c => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6EFED' } }; });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    a.href = url; a.download = `extracao_contabil_1_${comp}_${ts}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    Utilidades.toast?.(`✓ Extração Contábil - 1 gerada (${lista.length} médico${lista.length === 1 ? '' : 's'} + 2 abas).`, 'success', 4500);
  }

  // ── V654: Extração Contábil 2 — o relatório de PRODUÇÃO linha a linha com
  // duas colunas no fim: REPASSE (regras EXATAMENTE como no Contábil 1 / motor
  // V651) e V. TABELA (versão da Base usada na regra: v1.0/v2.0/viva).
  // "SEM REGRA" quando o procedimento não tem regra na Base (inclui o híbrido
  // V486); "—" quando a linha não gera repasse (classe excluída, SUS, sem
  // executante); zero por regra legítima (duplicidade, Períodos×Matriz,
  // excluído por tipo, exame incluso em pacote) sai como R$ 0.
  async function exportarPMExcel2() {
    if (typeof ExcelJS === 'undefined') { Utilidades.toast?.('ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return; }
    const st = estado();
    const comp = st.competencia;
    _cacheDelComp(_baseCache, comp);            // auditoria: sempre com as regras ATUAIS
    const base = baseDados(comp);
    const porLid = new Map();
    for (const it of base.itens) porLid.set(it._lid, it);
    const rows = Banco.query(`SELECT * FROM linhas_producao WHERE competencia = ? ORDER BY id`, [comp]) || [];
    if (!rows.length) { Utilidades.toast?.('Nenhuma linha de produção nesta competência.', 'error', 4000); return; }

    const fmtMoney = '"R$" #,##0.00';
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ATLAS — Repasse Médico';
    wb.created = new Date();
    const ws = wb.addWorksheet('Produção', {
      properties: { tabColor: { argb: 'FF107DAC' } },
      views: [{ state: 'frozen', ySplit: 2 }],
    });
    // Estrutura EXATAMENTE igual ao relatório de PRODUÇÃO importado (mesmas
    // colunas, mesma ordem, mesmos cabeçalhos) + 2 colunas de auditoria no fim.
    const COLS = [
      ['Cód. Admissão', 'cod_admissao', 14],       ['Data Admissão', 'data_admissao', 13],
      ['Hora Admissão', 'hora_admissao', 11],      ['Status Admissão', 'status_admissao', 16],
      ['Unid. Atendimento', 'unidade', 14],        ['Especialidade', 'especialidade', 16],
      ['Tipo Recebimento', 'tipo_recebimento', 13],['Destino', 'destino', 12],
      ['Classificação Produto', 'classificacao_produto', 15], ['Tipo Produto', 'tipo_produto', 13],
      ['Categoria', 'categoria', 13],              ['Subcategoria', 'subcategoria', 13],
      ['Subespecialidade', 'subespecialidade', 14],['Médico Externo', 'medico_externo', 18],
      ['Cód. Apresentação', 'cod_apresentacao', 13],['Procedimento Principal', 'procedimento_principal', 30],
      ['Produto', 'produto', 34],                  ['Pacote', 'pacote', 14],
      ['Convênio', 'convenio', 16],                ['Plano', 'plano', 12],
      ['Perfil Particular', 'perfil_particular', 15],['Perfil Admissão', 'perfil_admissao', 14],
      ['Caráter Admissão', 'carater_admissao', 14],['Observação Admissão', 'observacao_admissao', 18],
      ['Sala', 'sala', 10],                        ['Profissional Admissão', 'profissional_admissao', 20],
      ['Tipo Paciente', 'tipo_paciente', 12],      ['Cód. Paciente', 'cod_paciente', 12],
      ['Paciente', 'paciente', 26],                ['Data Nascimento', 'data_nascimento', 13],
      ['Idade no Atendimento', 'idade_atendimento', 10], ['Faixa Etária', 'faixa_etaria', 11],
      ['CID Alta', 'cid_alta', 10],                ['Descrição CID', 'descricao_cid', 20],
      ['Qtd.', 'quantidade', 7],                   ['Valor R$', 'valor', 14],
      ['Indicante', 'indicante', 22],              ['Solicitante', 'solicitante', 22],
      ['Consultor', 'consultor', 18],              ['Médico', 'medico', 22],
      ['Cirurgião', 'cirurgiao', 22],              ['Instrumentador', 'instrumentador', 18],
      ['Contatologa', 'contatologa', 16],          ['Ortoptista', 'ortoptista', 16],
      ['Auxiliar SADT', 'auxiliar_sadt', 16],      ['Auxiliar 1', 'auxiliar_1', 18],
      ['Auxiliar 2', 'auxiliar_2', 18],
      ['REPASSE (REGRA APLICADA)', '_repasse', 22],['V. TABELA', '_vtab', 11],
    ];
    ws.columns = COLS.map(([, key, width]) => ({ key, width }));
    const letra = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
    const iQtd = COLS.findIndex(c => c[1] === 'quantidade') + 1;
    const iVal = COLS.findIndex(c => c[1] === 'valor') + 1;
    const iRep = COLS.length - 1, iVtab = COLS.length;
    const priLin = 3, ultLin = rows.length + 2;   // dados: linhas 3..N+2

    // ── Linha 1: TOTALIZADORES no topo (=SUBTOTAL → respeitam o filtro) ──
    const r1 = ws.getRow(1);
    r1.height = 22;
    r1.getCell(1).value = 'TOTAIS (=SUBTOTAL · acompanham o filtro)';
    r1.getCell(iQtd).value  = { formula: `SUBTOTAL(9,${letra(iQtd)}${priLin}:${letra(iQtd)}${ultLin})` };
    r1.getCell(iVal).value  = { formula: `SUBTOTAL(9,${letra(iVal)}${priLin}:${letra(iVal)}${ultLin})` };
    r1.getCell(iRep).value  = { formula: `SUBTOTAL(9,${letra(iRep)}${priLin}:${letra(iRep)}${ultLin})` };
    r1.getCell(iVtab).value = { formula: `COUNTIF(${letra(iRep)}${priLin}:${letra(iRep)}${ultLin},"SEM REGRA")&" SEM REGRA"` };
    r1.getCell(1).font = { bold: true, color: { argb: 'FF107DAC' } };
    r1.getCell(iQtd).font = { bold: true };
    r1.getCell(iVal).font = { bold: true }; r1.getCell(iVal).numFmt = fmtMoney;
    r1.getCell(iRep).font = { bold: true, color: { argb: 'FF107DAC' } }; r1.getCell(iRep).numFmt = fmtMoney;
    r1.getCell(iVtab).font = { bold: true, color: { argb: 'FFC0392B' } };
    r1.getCell(iVtab).alignment = { horizontal: 'center' };

    // ── Linha 2: cabeçalho (fundo #46688c) ──
    const r2 = ws.getRow(2);
    r2.height = 24;
    COLS.forEach(([header], i) => {
      const c = r2.getCell(i + 1);
      c.value = header;
      c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF107DAC' } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    ws.autoFilter = { from: `A2`, to: `${letra(COLS.length)}2` };

    // ── Linhas 3+: dados originais do relatório + repasse/versão no fim ──
    let nSem = 0;
    for (const l of rows) {
      const it = porLid.get(l.id);
      const vtab = it ? (it.vtab || '—') : '—';
      let repasse;
      if (!it || it.marca === '—') repasse = '—';
      else if (it.marca === 'SEM REGRA') { repasse = 'SEM REGRA'; nSem++; }
      else repasse = Number(it.recebido) || 0;
      const obj = {};
      for (const [, key] of COLS) {
        if (key === '_repasse') obj[key] = repasse;
        else if (key === '_vtab') obj[key] = vtab;
        else if (key === 'quantidade' || key === 'valor' || key === 'idade_atendimento')
          obj[key] = l[key] != null && l[key] !== '' ? Number(l[key]) : '';
        else obj[key] = l[key] != null ? l[key] : '';
      }
      const r = ws.addRow(obj);
      if (obj.tipo_recebimento != null) Utilidades.pintarCelulaFonte(r.getCell('tipo_recebimento'), obj.tipo_recebimento);   // V947
      r.getCell(iVal).numFmt = fmtMoney;
      const cRep = r.getCell(iRep), cV = r.getCell(iVtab);
      cV.alignment = { horizontal: 'center' };
      if (typeof repasse === 'number') cRep.numFmt = fmtMoney;
      else if (repasse === 'SEM REGRA') {
        cRep.font = { bold: true, color: { argb: 'FFC0392B' } };
        cRep.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEA' } };
        cRep.alignment = { horizontal: 'center' };
      } else {
        cRep.font = { color: { argb: 'FF9AA5A0' } };
        cRep.alignment = { horizontal: 'center' };
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    a.href = url; a.download = `extracao_contabil_2_${comp}_${ts}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    Utilidades.toast?.(`✓ Extração Contábil - 2 gerada (${rows.length} linha${rows.length === 1 ? '' : 's'}${nSem ? `, ${nSem} SEM REGRA` : ''}).`, 'success', 4500);
  }

  function montarProdFiltroModal() {
    const st = estado();
    const antigo = document.getElementById('pm-prodfiltro-overlay');
    const scrollAnt = antigo ? (antigo.querySelector('.pmpf-lista') || {}).scrollTop || 0 : 0;
    if (antigo) antigo.remove();
    if (!st.prodFiltroCard) return;
    const card = st.prodFiltroCard;
    const lista = st.prodFiltroList || [];
    const busca = normalizar(st.prodFiltroBusca || '');
    const ordem = ['CONSULTA','EXAME','PROCEDIMENTO','OPME','MATERIAL','MEDICAMENTO','TAXA','GAS','DIARIA'];
    const grupos = {};
    for (const it of lista) {
      if (busca && !normalizar(it.produto).includes(busca)) continue;
      (grupos[it.classe] = grupos[it.classe] || []).push(it);
    }
    const chaves = Object.keys(grupos).sort((a,b) => (ordem.indexOf(a)<0?99:ordem.indexOf(a)) - (ordem.indexOf(b)<0?99:ordem.indexOf(b)));
    let gruposHtml = '';
    for (const cl of chaves) {
      const arr = grupos[cl].slice().sort((a,b)=>a.produto.localeCompare(b.produto));
      const marc = arr.filter(x=>x.checked).length;
      gruposHtml += `<div class="pmpf-grupo">
        <div class="pmpf-gh"><span>${esc(arr[0].classeRaw)} <span class="pmpf-gcount">${marc}/${arr.length}</span></span>
          <button type="button" class="pmpf-gtoggle" data-gtoggle="${esc(cl)}">${marc===arr.length?'desmarcar':'marcar'}</button></div>
        ${arr.map(it => `<label class="pmpf-item"><input type="checkbox" data-prod="${esc(it.produto)}" ${it.checked?'checked':''}><span>${esc(it.produto)}</span></label>`).join('')}
      </div>`;
    }
    const totMarc = lista.filter(x=>x.checked).length;
    const ov = document.createElement('div');
    ov.id = 'pm-prodfiltro-overlay';
    ov.innerHTML = `<div class="pmpf-modal" onclick="event.stopPropagation()">
      <div class="pmpf-head">
        <div class="pmpf-tit">Produtos que entram · <strong>PROD. ${esc(card)}</strong></div>
        <div class="pmpf-sub">${totMarc} de ${lista.length} produtos marcados · marque o que deve entrar no cálculo</div>
      </div>
      <div class="pmpf-tools">
        <input type="text" id="pmpf-busca" class="pmpf-busca" placeholder="Buscar produto…" value="${esc(st.prodFiltroBusca||'')}">
        <button type="button" class="pmpf-allbtn" data-all="1">Marcar todos</button>
        <button type="button" class="pmpf-allbtn" data-all="0">Desmarcar todos</button>
      </div>
      <div class="pmpf-lista">${gruposHtml || '<div class="pmpf-vazio">Nenhum produto encontrado.</div>'}</div>
      <div class="pmpf-acoes">
        <button type="button" class="pmpf-cancel" data-pf-cancel>Cancelar</button>
        <button type="button" class="pmpf-salvar" data-pf-salvar>Salvar</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const novaLista = ov.querySelector('.pmpf-lista'); if (novaLista) novaLista.scrollTop = scrollAnt;
    const fechar = () => { st.prodFiltroCard = null; montarProdFiltroModal(); };
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    ov.querySelectorAll('.pmpf-item input').forEach(inp => inp.addEventListener('change', () => {
      const it = lista.find(x => x.produto === inp.dataset.prod); if (it) it.checked = inp.checked; montarProdFiltroModal();
    }));
    ov.querySelectorAll('[data-gtoggle]').forEach(b => b.addEventListener('click', () => {
      const cl=b.dataset.gtoggle;
      const arr=lista.filter(x=>x.classe===cl && (!busca || normalizar(x.produto).includes(busca)));
      const todos=arr.every(x=>x.checked); arr.forEach(x=>x.checked=!todos); montarProdFiltroModal();
    }));
    ov.querySelectorAll('[data-all]').forEach(b => b.addEventListener('click', () => {
      const on=b.dataset.all==='1'; lista.filter(x=>!busca||normalizar(x.produto).includes(busca)).forEach(x=>x.checked=on); montarProdFiltroModal();
    }));
    const bq=document.getElementById('pmpf-busca');
    if (bq) bq.addEventListener('input', () => { st.prodFiltroBusca=bq.value; montarProdFiltroModal(); const e=document.getElementById('pmpf-busca'); if(e){e.focus(); try{e.setSelectionRange(e.value.length,e.value.length);}catch(_){}} });
    ov.querySelector('[data-pf-cancel]').addEventListener('click', fechar);
    ov.querySelector('[data-pf-salvar]').addEventListener('click', () => {
      const over=new Set();
      for (const it of lista) { const def=CLASS_PADRAO.includes(it.classe); if (it.checked!==def) over.add(normalizar(it.produto)); }
      pfSalvar(card, over);
      st.prodFiltroCard=null; montarProdFiltroModal();
      recompute(() => { st.dados=null; _cacheDelComp(_baseCache, st.competencia); });
    });
  }

  function bindTopo() {
    const st = estado();
    // V357: fecha o popover de filtro/imposto ao clicar FORA dele (padrão do dropdown Cadastros).
    // Listener único no document; os botões dão stopPropagation pra não fechar na própria abertura.
    if (!window.__pmFechaFora) {
      window.__pmFechaFora = true;
      document.addEventListener('click', (e) => {
        // V492: listener global permanente — fora da Produção Médica NÃO renderiza (tela fantasma
        // escrevia em #conteudo de outra tela); só remove o popover órfão do <body>, se existir.
        if (App.telaAtual !== 'producao-medica') {
          document.getElementById('pm-pop-flutuante')?.remove();
          return;
        }
        const s = estado();
        if (!s.filtroAberto && !s.impostoAberto) return;
        if (e.target.closest('.pm-fpop') || e.target.closest('#pm-filtro') || e.target.closest('#pm-imposto') || e.target.closest('#atlas-hub')) return;
        const fl = document.getElementById('pm-pop-flutuante'); if (fl) fl.remove();
        s.filtroAberto = false; s.impostoAberto = false; render();
      });
    }
    // V363: captura, no CLIQUE REAL (não-sintético), a posição do botão/item-do-hub que vai abrir
    // o popover. Necessário porque os botões reais ficam display:none (jogados no globo/hub) e o
    // hub dispara alvos[i].click() sinteticamente — sem isso o popover ancora num botão invisível.
    if (!window.__pmAnchorCap) {
      window.__pmAnchorCap = true;
      document.addEventListener('click', (e) => {
        if (!e.isTrusted) return;
        let a = e.target.closest('#pm-filtro, #pm-imposto, .pm-classif-btn, .pm-imposto-btn');
        if (!a && e.target.closest('.hub-it')) a = document.querySelector('#atlas-hub .hub-btn');   // item do hub some ao fechar → ancora no globo persistente
        if (!a) return;
        const r = a.getBoundingClientRect();
        if (r.width) window.__pmAnchor = { left: r.left, bottom: r.bottom };
      }, true);
    }
    // V362: o popover NÃO fica no #conteudo — o decorador do hub observa o #conteudo, remexe no
    // DOM e solta o popover no meio da tela. Ele é montado direto no <body> (fora do alcance do
    // decorador) e posicionado FIXED nas coordenadas do botão correspondente, colado embaixo.
    function posicionarFlutuante() {
      const pop = document.getElementById('pm-pop-flutuante');
      // V492: listeners de scroll (capture) e resize são globais e permanentes — se não há popover
      // montado OU a tela ativa não é a Produção Médica, retorna imediatamente (sem trabalho).
      if (!pop || App.telaAtual !== 'producao-medica') return;
      let a = window.__pmAnchor;   // rect capturado no CLIQUE REAL do botão/item-do-hub que abriu
      if (!a) {
        const s = estado();
        const btn = document.getElementById(s.impostoAberto ? 'pm-imposto' : 'pm-filtro');
        if (btn) { const r = btn.getBoundingClientRect(); if (r.width) a = { left: r.left, bottom: r.bottom }; }
      }
      if (!a) a = { left: window.innerWidth - 320, bottom: 84 };   // fallback: canto sup. direito
      let left = a.left;
      const maxLeft = window.innerWidth - pop.offsetWidth - 8;
      if (left > maxLeft) left = Math.max(8, maxLeft);
      let top = a.bottom + 4;
      const maxTop = window.innerHeight - pop.offsetHeight - 8;
      if (top > maxTop) top = Math.max(8, maxTop);
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
    }
    function montarFlutuante() {
      const old = document.getElementById('pm-pop-flutuante');
      if (old) old.remove();
      const s = estado();
      let html = null;
      if (s.filtroAberto) html = popoverFiltro();
      else if (s.impostoAberto) html = popoverImposto();
      if (!html) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const pop = tmp.firstElementChild;
      if (!pop) return;
      pop.id = 'pm-pop-flutuante';
      document.body.appendChild(pop);
      posicionarFlutuante();
    }
    montarFlutuante();
    if (!window.__pmRepos) {
      window.__pmRepos = true;
      window.addEventListener('scroll', () => posicionarFlutuante(), true);
      window.addEventListener('resize', () => posicionarFlutuante());
    }
    // V923: dropdown de competência em DRILLDOWN Ano > Mês
    const ddBtn = document.getElementById('pm-comp-btn');
    if (ddBtn) ddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      st.compDDAberto = !st.compDDAberto;
      if (st.compDDAberto) st.compDDAnos = new Set([String(st.competencia || '').slice(0, 4)]);
      render();
    });
    document.querySelectorAll('[data-dd-ano]').forEach(el => el.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = el.dataset.ddAno;
      const s = st.compDDAnos || (st.compDDAnos = new Set());
      if (s.has(a)) s.delete(a); else s.add(a);
      render();
    }));
    document.querySelectorAll('[data-dd-comp]').forEach(el => el.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = el.dataset.ddComp;
      st.compDDAberto = false;
      st.prodFiltroCard = null; montarProdFiltroModal();
      recompute(() => { st.competencia = val; st.dados = null; _desCache.clear(); st.medicoSel = null; });
    }));
    if (window.__pmCompDDDoc) document.removeEventListener('click', window.__pmCompDDDoc);
    window.__pmCompDDDoc = (ev) => {
      if (App.telaAtual !== 'producao-medica') return;
      const s2 = estado();
      if (s2.compDDAberto && !ev.target.closest('#pm-compdd')) { s2.compDDAberto = false; render(); }
    };
    document.addEventListener('click', window.__pmCompDDDoc);

    // V923: gaveta "Regras aplicadas" — puxador "‹" fixo na borda direita
    const rgBtn = document.getElementById('pm-regras-puxador');
    if (rgBtn) rgBtn.addEventListener('click', (e) => { e.stopPropagation(); st.regrasAberto = !st.regrasAberto; render(); });
    if (window.__pmRegrasDoc) { document.removeEventListener('click', window.__pmRegrasDoc); document.removeEventListener('keydown', window.__pmRegrasEsc); }
    window.__pmRegrasDoc = (ev) => {
      if (App.telaAtual !== 'producao-medica') return;
      const s2 = estado();
      if (s2.regrasAberto && !ev.target.closest('#pm-regras-gaveta') && !ev.target.closest('#pm-regras-puxador')) { s2.regrasAberto = false; render(); }
    };
    window.__pmRegrasEsc = (ev) => {
      if (ev.key !== 'Escape' || App.telaAtual !== 'producao-medica') return;
      const s2 = estado();
      if (s2.regrasAberto) { s2.regrasAberto = false; render(); }
      else if (s2.compDDAberto) { s2.compDDAberto = false; render(); }
    };
    document.addEventListener('click', window.__pmRegrasDoc);
    document.addEventListener('keydown', window.__pmRegrasEsc);
    // V485: lápis dos cards CONV/PART → abre o modal de "produtos que entram"
    document.querySelectorAll('.pm-prod-edit').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = b.dataset.prodEdit;
      const over = pfOverrides();
      const prods = pfProdutosDoCard(st.competencia, card);
      st.prodFiltroCard = card; st.prodFiltroBusca = '';
      st.prodFiltroList = prods.map(p => ({ produto: p.produto, classe: p.classe, classeRaw: p.classeRaw, checked: pfInclui(card, p.classe, p.produto, over) }));
      montarProdFiltroModal();
    }));
    document.querySelectorAll('.pm-chip').forEach(ch => ch.addEventListener('click', () => {
      const t = ch.dataset.tipo, i = st.tipos.indexOf(t);
      if (i >= 0) { if (st.tipos.length > 1) st.tipos.splice(i, 1); } else st.tipos.push(t);
      render();
    }));
    document.querySelectorAll('.pm-aba').forEach(b => b.addEventListener('click', () => { st.aba = b.dataset.aba; st.medicoSel = null; render(); }));
    const fb = document.getElementById('pm-filtro');
    if (fb) fb.addEventListener('click', (e) => { e.stopPropagation(); st.filtroAberto = !st.filtroAberto; st.impostoAberto = false; st.popJustOpened = st.filtroAberto; render(); });
    const bext = document.getElementById('pm-extrair');
    if (bext) bext.addEventListener('click', abrirModalExtracao);
    // V679: "⇆ Mês a mês" também como botão do CABEÇALHO (o flutuante continua)
    const bmm = document.getElementById('pm-mesames-topo');
    if (bmm) bmm.addEventListener('click', abrirPmMesAMes);
    const sw = document.getElementById('pm-switch');   // V253
    if (sw) {
      const toggle = () => { st.visao = (st.visao === 'gerencial' ? 'contabil' : 'gerencial'); render(); };
      sw.addEventListener('click', toggle);
      sw.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    }
    const bd = document.getElementById('pm-fbackdrop');
    if (bd) bd.addEventListener('click', () => { st.filtroAberto = false; render(); });
    const fok = document.getElementById('pm-fok');
    if (fok) fok.addEventListener('click', () => { st.filtroAberto = false; render(); });
    const fpad = document.getElementById('pm-fpadrao');
    if (fpad) fpad.addEventListener('click', () => { st.classes = CLASS_PADRAO.slice(); st.dados = null; requestAnimationFrame(() => render()); });
    document.querySelectorAll('[data-classe]').forEach(cb => cb.addEventListener('change', () => {
      const k = cb.dataset.classe, i = st.classes.indexOf(k);
      if (cb.checked) { if (i < 0) st.classes.push(k); } else { if (i >= 0) st.classes.splice(i, 1); }
      if (!st.classes.length) st.classes = CLASS_PADRAO.slice();
      st.dados = null; requestAnimationFrame(() => render());   // V360: adia o render p/ o clique terminar de propagar — popover PERMANECE aberto pra marcar várias
    }));
    // V268: botão Imposto (vai pro globo) abre o drilldown por mês/ano
    const ib = document.getElementById('pm-imposto');
    if (ib) ib.addEventListener('click', (e) => { e.stopPropagation(); st.impostoAberto = !st.impostoAberto; st.filtroAberto = false; st.popJustOpened = st.impostoAberto; render(); });
    const ibd = document.getElementById('pm-ibackdrop');
    if (ibd) ibd.addEventListener('click', () => { st.impostoAberto = false; render(); });
    const iok = document.getElementById('pm-iok');
    if (iok) iok.addEventListener('click', () => { st.impostoAberto = false; render(); });
    document.querySelectorAll('.pm-imp-in2').forEach(inp => {
      let t = null;
      inp.addEventListener('input', () => {
        const pct = Number(String(inp.value == null ? '' : inp.value).replace(',', '.')) || 0;
        clearTimeout(t);
        t = setTimeout(() => { salvarImpostoPct(inp.dataset.comp, pct); }, 350);
      });
    });
    // V272: Congelar / Descongelar o Contábil deste mês (retrato imutável; Gerencial segue ao vivo)
    const cong = document.getElementById('pm-congelar');
    if (cong) cong.addEventListener('click', () => {
      const comp = st.competencia;
      if (!comp) return;
      if (temSnapContabil(comp)) {
        if (!confirm('Descongelar o Contábil de ' + rotuloComp(comp) + '?\n\nO retrato congelado será descartado e o Contábil volta a recalcular ao vivo.')) return;
        removerSnapContabil(comp);
        Utilidades.toast?.('Contábil de ' + rotuloComp(comp) + ' descongelado.', 'info', 3000);
      } else {
        if (!confirm('Congelar o Contábil de ' + rotuloComp(comp) + '?\n\nOs números Contábeis viram um retrato imutável. A Gerencial continua ao vivo e reflete reimportações da produção.')) return;
        salvarSnapContabil(comp);
        Utilidades.toast?.('Contábil de ' + rotuloComp(comp) + ' congelado 🔒', 'success', 3500);
      }
      st.dados = null; render();
    });
    // V269: −/+ casas decimais do "% sobre PROD" (ao vivo, persiste; não re-renderiza)
    document.querySelectorAll('.prc-dec').forEach(b => b.addEventListener('click', () => {
      if (!b.dataset.d) return;   // V673: o ⇄ tem handler próprio
      const dec = Math.max(0, Math.min(4, lerProdDec() + Number(b.dataset.d)));
      salvarProdDec(dec);
      const box = document.querySelector('.prc-prod-box');
      const span = box && box.querySelector('.prc-prod');
      if (span && box) span.textContent = fmtPctN(Number(box.dataset.prod) || 0, dec);
    }));
    // V673: ⇄ comparativo do % sobre PROD com o mês anterior
    const bComp = document.getElementById('pm-pct-comp');
    if (bComp) bComp.addEventListener('click', abrirComparativoPct);
  }
  function bindBody() {
    const st = estado();
    // V263: combo de seleção de médicos (multi, sem digitar)
    const comboBox = document.getElementById('pm-medcombo-box');
    if (comboBox) comboBox.addEventListener('click', (e) => { e.stopPropagation(); st.medComboAberto = !st.medComboAberto; if (st.medComboAberto) st.medComboBusca = ''; render(); });
    // V922: busca dentro do combo de médicos — filtra local (marcados sempre visíveis),
    // o texto sobrevive ao marcar/desmarcar (render mantém via st.medComboBusca)
    const mcb = document.getElementById('pm-medcombo-busca');
    if (mcb) {
      const filtrarMed = () => {
        const q = normalizar(mcb.value);
        document.querySelectorAll('.pm-medopt').forEach(op => {
          const mostra = op.classList.contains('on') || !q || (op.dataset.busca || '').includes(q);
          op.style.display = mostra ? '' : 'none';
        });
      };
      mcb.addEventListener('click', (e) => e.stopPropagation());
      mcb.addEventListener('input', () => { st.medComboBusca = mcb.value; filtrarMed(); });
      if (mcb.value) filtrarMed();
      setTimeout(() => { mcb.focus(); if (mcb.value) try { mcb.setSelectionRange(mcb.value.length, mcb.value.length); } catch (_) {} }, 0);
    }
    document.querySelectorAll('.pm-medopt').forEach(op => op.addEventListener('click', (e) => {
      e.stopPropagation();
      const n = op.dataset.med; const arr = st.medicosSel || (st.medicosSel = []);
      const i = arr.indexOf(n);
      if (i >= 0) arr.splice(i, 1); else arr.push(n);
      st.medComboAberto = true;   // mantém aberto pra escolher mais
      render();
    }));
    document.querySelectorAll('.pm-medchip-x').forEach(x => x.addEventListener('click', (e) => {
      e.stopPropagation();
      const arr = st.medicosSel || []; const i = arr.indexOf(x.dataset.med); if (i >= 0) arr.splice(i, 1);
      render();
    }));
    const limpar = document.getElementById('pm-medcombo-limpar');
    if (limpar) limpar.addEventListener('click', (e) => { e.stopPropagation(); st.medicosSel = []; render(); });
    if (window.__pmComboDoc) document.removeEventListener('click', window.__pmComboDoc);
    window.__pmComboDoc = (ev) => {
      // V492: fora da Produção Médica não renderiza (tela fantasma); remove popover órfão e sai.
      if (App.telaAtual !== 'producao-medica') { document.getElementById('pm-pop-flutuante')?.remove(); return; }
      const s2 = estado(); if (s2.medComboAberto && !ev.target.closest('#pm-medcombo')) { s2.medComboAberto = false; render(); }
    };
    document.addEventListener('click', window.__pmComboDoc);
    const adm = document.getElementById('pm-busca-adm');
    if (adm) { let ta = null; adm.addEventListener('input', () => { clearTimeout(ta); const v = adm.value; ta = setTimeout(() => { st.buscaAdm = v; st.dados = null; render(); }, 250); }); }
    const admTag = document.querySelector('.pm-adm-tag');
    if (admTag) admTag.addEventListener('click', () => { st.buscaAdm = ''; st.dados = null; render(); });
    document.querySelectorAll('.pm-th-ord').forEach(th => th.addEventListener('click', () => { st.ord = th.dataset.ord; render(); }));
    document.querySelectorAll('.pm-row').forEach(tr => tr.addEventListener('click', () => { st.medicoSel = tr.dataset.medico; render(); }));
    const tabPg = document.querySelector('#pm-body table.pm-tabela-fix');
    if (tabPg) ativarResizeColgroup(tabPg, 'pm_' + st.aba);
  }

  // V260: resize de coluna que funciona em tabela de cabeçalho AGRUPADO — ajusta os <col> (o
  // resize global V181 falha aqui porque a 1ª linha do thead tem colspan; bloqueamos ele via resizeOn).
  function ativarResizeColgroup(tabela, chaveTela) {
    if (!tabela || tabela.dataset.pmResize) return;
    tabela.dataset.pmResize = '1';
    tabela.dataset.resizeOn = '1';   // impede o decorarResize global de mexer nesta tabela
    const cols = tabela.querySelectorAll('colgroup col');
    const headRows = tabela.querySelectorAll('thead tr');
    const subRow = headRows[headRows.length - 1];           // linha com as colunas individuais
    const ths = subRow ? subRow.querySelectorAll('th') : [];
    if (!cols.length || cols.length !== ths.length) return; // estrutura inesperada → não arrisca
    const chave = 'atlas_pmcolw_' + chaveTela;
    let salvas = {}; try { salvas = JSON.parse(localStorage.getItem(chave) || '{}'); } catch (e) {}
    cols.forEach((c, i) => { if (salvas[i] >= 40) c.style.width = salvas[i] + 'px'; });
    ths.forEach((th, i) => {
      if (getComputedStyle(th).position === 'static') th.style.position = 'relative';
      const alca = document.createElement('span');
      alca.className = 'atlas-col-resize';
      th.appendChild(alca);
      alca.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const startX = e.pageX;
        const startW = cols[i].offsetWidth || th.offsetWidth;
        document.body.classList.add('atlas-redimensionando');
        alca.classList.add('ativa');
        const onMove = (ev) => { cols[i].style.width = Math.max(40, startW + (ev.pageX - startX)) + 'px'; };
        const onUp = () => {
          document.body.classList.remove('atlas-redimensionando');
          alca.classList.remove('ativa');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          try { const a = JSON.parse(localStorage.getItem(chave) || '{}'); a[i] = cols[i].offsetWidth; localStorage.setItem(chave, JSON.stringify(a)); } catch (err) {}
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }
  function bindDetalhe() {
    const st = estado();
    const b = document.getElementById('pm-voltar');
    if (b) b.addEventListener('click', () => { st.medicoSel = null; render(); });
  }

  // ── Estilos (head, 1x) ──────────────────────────────────────────────────────
  function estilos() {
    if (document.getElementById('pm-estilos')) return;
    const s = document.createElement('style'); s.id = 'pm-estilos';
    s.textContent = `
      .pm-wrap { padding: 4px 2px 40px; position: relative; }
      .pm-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
      .pm-title-group { display: inline-flex; align-items: center; }
      .pm-titulo { font-family: var(--font-display,'Inter Tight'),sans-serif; font-size: 26px; color: var(--primary,#5980a6); margin: 6px 0 0; font-weight: 600; }
      .pm-controles { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      .pm-chips { display: inline-flex; gap: 6px; }
      .pm-chip { padding: 7px 12px; border: 1px solid var(--border,#eef0f2); border-radius: 999px; background: #fff; color: var(--ink-soft,#585d62); font-size: 12px; cursor: pointer; }
      .pm-chip:hover { border-color: var(--primary,#5980a6); }
      .pm-chip.on { background: var(--primary,#5980a6); color: #fff; border-color: var(--primary,#5980a6); }
      .pm-select { padding: 9px 12px; border: 1px solid var(--border,#eef0f2); border-radius: 9px; background: #fff; color: var(--ink,#3a5877); font-size: 14px; }

      /* ── V923: competência em drilldown Ano > Mês ── */
      .pm-compdd { position: relative; }
      .pm-compdd-btn { cursor: pointer; display: flex; align-items: center; gap: 8px; min-width: 118px; justify-content: space-between; }
      .pm-compdd.aberto .pm-compdd-btn { border-color: var(--accent,#3f6489); box-shadow: 0 0 0 3px rgba(63, 100, 137,.15); }
      .pm-compdd-car { font-size: 10px; color: var(--ink-faint,#585d62); transition: transform .18s; }
      .pm-compdd.aberto .pm-compdd-car { transform: rotate(180deg); }
      .pm-compdd-pop { position: absolute; top: calc(100% + 4px); right: 0; z-index: 60; min-width: 180px; max-height: 340px;
        overflow-y: auto; background: #fff; border: 1px solid var(--border,#eef0f2); border-radius: 10px;
        box-shadow: 0 10px 26px rgba(29, 31, 32,.16); padding: 4px; }
      .pm-compdd-ano { display: flex; align-items: center; gap: 7px; padding: 8px 10px; font-size: 13px; font-weight: 800;
        color: var(--primary,#5980a6); cursor: pointer; border-radius: 8px; user-select: none; }
      .pm-compdd-ano:hover { background: var(--primary-soft,#eef2f6); }
      .pm-compdd-seta { font-size: 10px; width: 12px; }
      .pm-compdd-n { margin-left: auto; font-size: 10px; font-weight: 600; color: var(--ink-faint,#585d62); }
      .pm-compdd-mes { padding: 7px 10px 7px 30px; font-size: 13px; cursor: pointer; border-radius: 8px;
        color: var(--ink,#3a5877); display: flex; align-items: center; justify-content: space-between; }
      .pm-compdd-mes:hover { background: var(--primary-soft,#eef2f6); }
      .pm-compdd-mes.on { background: #EAF7F1; color: var(--primary,#5980a6); font-weight: 700; }
      .pm-compdd-ck { color: var(--accent,#3f6489); font-weight: 800; }

      /* ── V923: puxador "‹" + gaveta "Regras aplicadas" ── */
      .pm-regras-puxador { position: fixed; right: 0; top: 50%; transform: translateY(-50%); z-index: 905;
        width: 26px; height: 84px; border: none; cursor: pointer; border-radius: 10px 0 0 10px;
        background: linear-gradient(180deg, #46688c, #5980a6); color: #fff;
        display: flex; align-items: center; justify-content: center;
        box-shadow: -3px 3px 10px rgba(29, 31, 32,.28); transition: width .15s, right .2s; }
      .pm-regras-puxador:hover { width: 30px; }
      .pm-regras-puxador.aberto { right: 380px; }
      .pm-regras-puxador.aberto svg { transform: rotate(180deg); }
      .pm-regras-gaveta { position: fixed; right: 0; top: 0; bottom: 0; width: 380px; z-index: 900;
        background: #fff; border-left: 1px solid var(--border,#eef0f2);
        box-shadow: -10px 0 26px rgba(29, 31, 32,.22); display: flex; flex-direction: column;
        animation: pmRgSlide .18s ease-out; }
      @keyframes pmRgSlide { from { transform: translateX(60px); opacity: 0; } to { transform: none; opacity: 1; } }
      .pm-rg-head { background: linear-gradient(90deg, #5980a6, #46688c); color: #fff; padding: 14px 16px;
        font-size: 14px; font-weight: 800; flex: 0 0 auto; }
      .pm-rg-sub { display: block; font-size: 10.5px; font-weight: 500; opacity: .88; margin-top: 3px; }
      .pm-rg-corpo { overflow-y: auto; padding: 10px 14px 20px; flex: 1; }
      .pm-rg-grupo { font-size: 10.5px; font-weight: 800; color: var(--primary,#5980a6); text-transform: uppercase;
        letter-spacing: .5px; margin: 14px 0 4px; border-bottom: 1px solid #EDF2F0; padding-bottom: 4px; }
      .pm-rg-item { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; color: var(--ink,#3a5877);
        padding: 5px 0; line-height: 1.4; }
      .pm-rg-ck { flex: 0 0 auto; width: 15px; height: 15px; border-radius: 4px; background: #EAF7F1;
        color: #0E7A57; font-size: 10px; font-weight: 800; display: flex; align-items: center;
        justify-content: center; margin-top: 2px; }
      .pm-rg-dyn { color: #46688c; font-weight: 700; }
      .pm-classif-btn { padding: 9px 14px; border: 1px solid var(--border,#eef0f2); border-radius: 9px; background: #fff; color: var(--ink,#3a5877); font-size: 13px; cursor: pointer; }
      .pm-extrair-btn { padding: 9px 16px; border: none; border-radius: 9px; background: #5980a6; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 10px rgba(89, 128, 166,.25); }
      .pm-extrair-btn:hover { background: #46688c; }
      .pm-ext-overlay { position: fixed; inset: 0; background: rgba(4,34,34,.45); z-index: 300; display: flex; align-items: center; justify-content: center; padding: 20px; }
      .pm-ext-modal { background: #fff; border-radius: 16px; width: min(640px, 100%); max-height: 86vh; display: flex; flex-direction: column; box-shadow: 0 24px 60px rgba(0,0,0,.35); overflow: hidden; }
      .pm-ext-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background: #3a5877; }
      .pm-ext-head h3 { margin: 0; color: #fafbfc; font-size: 14px; letter-spacing: .04em; }
      .pm-ext-x { border: none; background: transparent; color: #9FB4AE; font-size: 16px; cursor: pointer; }
      .pm-ext-body { padding: 16px 18px; overflow-y: auto; }
      .pm-ext-info { font-size: 12px; color: var(--ink-faint,#585d62); margin: 0 0 12px; }
      .pm-ext-sec { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #0F6E56; margin-bottom: 8px; }
      .pm-ext-tab { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 12px; }
      .pm-ext-tab th { text-align: left; font-size: 10.5px; text-transform: uppercase; color: #0F6E56; border-bottom: 1px solid var(--border,#eef0f2); padding: 6px 8px; }
      .pm-ext-tab td { padding: 7px 8px; border-bottom: 1px solid #EEF2F0; }
      .pm-ext-tab .num, .pm-ext-tab th.num { text-align: right; }
      .pm-ext-del { border: none; background: transparent; color: #a15646; cursor: pointer; font-size: 13px; }
      .pm-ext-vazio { font-size: 12px; color: var(--ink-faint,#585d62); background: #F4F7F6; border-radius: 9px; padding: 12px; margin-bottom: 12px; }
      .pm-ext-form { display: grid; grid-template-columns: 1.3fr 1.3fr .7fr auto; gap: 8px; }
      .pm-ext-form input { padding: 9px 11px; border: 1px solid var(--border,#eef0f2); border-radius: 8px; font-size: 13px; font-family: inherit; }
      .pm-ext-form button { padding: 9px 14px; border: none; border-radius: 8px; background: #46688c; color: #fff; font-weight: 700; cursor: pointer; }
      .pm-ext-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 18px; border-top: 1px solid var(--border,#eef0f2); }
      .pm-ext-cancel { padding: 10px 16px; border: 1px solid var(--border,#eef0f2); border-radius: 9px; background: #fff; cursor: pointer; font-size: 13px; }
      .pm-ext-go { padding: 10px 18px; border: none; border-radius: 9px; background: #5980a6; color: #fff; font-weight: 700; font-size: 13px; cursor: pointer; }
      .pm-ext-go:disabled { opacity: .6; cursor: wait; }
      @media (max-width: 640px) { .pm-ext-form { grid-template-columns: 1fr 1fr; } }
      .pm-classif-btn:hover { border-color: var(--accent,#3f6489); }
      .pm-congelar-btn { padding: 9px 14px; border: 1px solid var(--border,#eef0f2); border-radius: 9px; background: #fff; color: var(--ink,#3a5877); font-size: 13px; cursor: pointer; }
      .pm-congelar-btn:hover { border-color: var(--accent,#3f6489); }
      .pm-congelar-btn.on { background: #eef2f6; color: #0F6E56; border-color: var(--border,#eef0f2); font-weight: 700; }   /* V974: era #cfe3d1 */
      .pm-classif-btn.mod { background: var(--accent,#3f6489); color: #fff; border-color: var(--accent,#3f6489); }

      .pm-cards { display: grid; grid-template-columns: repeat(5,1fr); gap: 12px; margin-bottom: 16px; }
      .pm-card { background: #fff; border: 1px solid var(--border,#eef0f2); border-radius: 12px; padding: 14px 16px; }
      .pm-card.tot { background: var(--primary,#5980a6); border-color: var(--primary,#5980a6); }
      .pm-card.tot .pm-card-l, .pm-card.tot .pm-card-v, .pm-card.tot .pm-card-p { color: #fff; }
      .pm-card.des { border-color: var(--accent,#3f6489); }
      .pm-card-l { font-size: 11px; color: var(--ink-soft,#585d62); letter-spacing: .04em; font-weight: 600; }
      .pm-card-v { font-size: 19px; font-weight: 700; color: var(--primary,#5980a6); margin-top: 4px; }
      .pm-card.des .pm-card-v { color: var(--accent,#3f6489); }
      .pm-card-p { font-size: 11px; color: var(--ink-soft,#585d62); margin-top: 2px; }
      .pm-card-rep { font-size: 12px; font-weight: 600; color: var(--accent,#3f6489); margin-top: 2px; }
      .pm-nw { white-space: nowrap; }
      .pm-card-pct { margin-left: 6px; }   /* V974: "(x%)" afastado do "Repasse R$ …" (V975: 12→6px pra caber numa linha com valores em milhões) */
      /* V975: a linha "Repasse R$ … (x%)" dos mini cards fica numa linha só —
         sai o line-clamp de 2 linhas do .aic-grid-mini .aic-meta (style.css V270);
         os cards ganham largura mínima maior pra caber valores em milhões. */
      .pm-cards-row .aic-grid-mini .aic-meta { display: block; white-space: nowrap; overflow: visible; text-overflow: clip; -webkit-line-clamp: unset; font-size: 8.5px; }   /* V977: 9 → 8.5px */
      /* V977: os 5 cards SEMPRE numa linha ao lado do card Receita (o
         DESEMPENHO caía para uma 2ª linha com o auto-fit de 200px). Grid de
         5 colunas iguais, sem quebra da fileira; em telas mais estreitas a
         linha "Repasse R$ … (x%)" e os paddings encolhem pra caber. */
      .pm-cards-row { flex-wrap: nowrap; }
      .pm-cards-row .aic-grid-mini { grid-template-columns: repeat(5, minmax(0, 1fr)); min-width: 0; gap: 14px 10px; }
      .pm-cards-row .aic-grid-mini .aic-branco { padding: 0 9px; }   /* V975: era 0 11px — folga pra "R$ 12.310.263,37 (48,6%)" numa linha */
      @media (max-width: 1440px) {
        .pm-cards-row .aic-grid-mini { gap: 14px 8px; }
        .pm-cards-row .aic-grid-mini .aic-branco { padding: 0 7px; }
        .pm-cards-row .aic-grid-mini .aic-meta { font-size: 8px; }
        .pm-cards-row .aic-grid-mini .aic-val { font-size: 15px; }
      }
      @media (max-width: 1240px) {
        .pm-cards-row { gap: 10px; }
        .pm-receita-card { flex-basis: 226px; }
        .pm-cards-row .aic-grid-mini { gap: 14px 6px; }
        .pm-cards-row .aic-grid-mini .aic-branco { padding: 0 5px; }
        .pm-cards-row .aic-grid-mini .aic-meta { font-size: 7px; letter-spacing: -0.02em; }
        .pm-cards-row .aic-grid-mini .aic-val { font-size: 13px; }
        .pm-cards-row .aic-grid-mini .aic-lbl { font-size: 8.5px; }
        .pm-card-pct { margin-left: 3px; }
      }
      .pm-cards-row .aic-grid-mini .aic-meta .atlas-rep { font-weight: 700; }
      .pm-card.tot .pm-card-rep { color: #E9D9B8; }
      .pm-cellpct { font-size: 10px; color: var(--ink-soft,#585d62); }

      .pm-nav { display: flex; gap: 4px; border-bottom: 1px solid var(--border,#eef0f2); margin-bottom: 14px; }
      .pm-aba { padding: 10px 16px; border: none; background: none; color: var(--ink-soft,#585d62); font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
      .pm-aba:hover { color: var(--primary,#5980a6); }
      .pm-aba.on { color: var(--primary,#5980a6); font-weight: 600; border-bottom-color: var(--accent,#3f6489); }

      .pm-barra { margin-bottom: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .pm-busca-adm { min-width: 200px; }
      .pm-adm-tag { font-size: 12px; background: var(--accent,#3f6489); color: #fff; border-radius: 999px; padding: 5px 12px; cursor: pointer; font-weight: 600; }
      .pm-resumo-des { font-size: 13px; color: var(--ink-soft,#585d62); margin-left: auto; }
      .pm-tag-des { font-size: 10px; background: #E3EEEA; color: #5980a6; border-radius: 6px; padding: 2px 7px; font-weight: 600; }
      .pm-tag-papel { font-size: 10px; background: #F3E9D6; color: #9A7B3A; border-radius: 6px; padding: 2px 7px; font-weight: 600; }
      .pm-desc { color: var(--ink-soft,#585d62); font-size: 12px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
      .pm-busca { padding: 9px 12px; border: 1px solid var(--border,#eef0f2); border-radius: 9px; background: #fff; font-size: 14px; min-width: 240px; }
      /* V263: combo multi-seleção de médicos (chips + dropdown, sem checkbox) */
      .pm-medcombo { position: relative; min-width: 300px; max-width: 600px; }   /* V266: mais larga p/ o "+N" ficar na mesma linha */
      .pm-medcombo-box { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 40px; max-height: 64px; overflow-y: auto; padding: 6px 30px 6px 10px; border: 1px solid var(--border,#eef0f2); border-radius: 9px; background: #fff; cursor: pointer; }
      .pm-medchip-mais { background: var(--ink-faint,#585d62); color: #fff; padding: 3px 10px; cursor: pointer; }
      .pm-medcombo.aberto .pm-medcombo-box { border-color: var(--accent,#3f6489); box-shadow: 0 0 0 3px rgba(63, 100, 137,.15); }
      .pm-medcombo-ph { color: var(--ink-faint,#585d62); font-size: 14px; }
      .pm-medcombo-car { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--ink-faint,#585d62); font-size: 11px; transition: transform .18s; pointer-events: none; }
      .pm-medcombo.aberto .pm-medcombo-car { transform: translateY(-50%) rotate(180deg); }
      .pm-medchip { display: inline-flex; align-items: center; gap: 6px; background: var(--primary-soft,#eef2f6); color: var(--primary,#5980a6); border-radius: 999px; padding: 3px 7px 3px 11px; font-size: 12px; font-weight: 600; max-width: 195px; white-space: nowrap; overflow: hidden; }
      .pm-medchip-x { cursor: pointer; font-size: 10px; opacity: .65; font-style: normal; }
      .pm-medchip-x:hover { opacity: 1; color: #B23A3A; }
      .pm-medcombo-pop { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 40; background: #fff; border: 1px solid var(--border,#eef0f2); border-radius: 10px; box-shadow: 0 10px 26px rgba(29, 31, 32,.16); overflow: hidden; }
      .pm-medcombo-limpar { width: 100%; border: none; border-bottom: 1px solid #EDF2F0; background: #FBFCFC; color: #B23A3A; font-size: 12px; font-weight: 600; padding: 8px 12px; cursor: pointer; text-align: left; }
      .pm-medcombo-limpar:hover { background: #F4F8F6; }
      .pm-medcombo-buscabox { padding: 8px 10px; border-bottom: 1px solid #EDF2F0; background: #FBFCFC; }
      .pm-medcombo-busca { width: 100%; box-sizing: border-box; padding: 7px 10px; border: 1px solid var(--border,#eef0f2); border-radius: 8px; font-size: 13px; background: #fff; }
      .pm-medcombo-busca:focus { outline: none; border-color: var(--accent,#3f6489); box-shadow: 0 0 0 3px rgba(63, 100, 137,.12); }
      .pm-medcombo-rodape { padding: 6px 12px; border-top: 1px solid #EDF2F0; background: #FBFCFC; color: var(--ink-faint,#585d62); font-size: 11px; }
      .pm-medcombo-lista { max-height: 280px; overflow-y: auto; }
      .pm-medopt { padding: 9px 12px; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--ink,#3a5877); }
      .pm-medopt:hover { background: var(--primary-soft,#eef2f6); }
      .pm-medopt.on { background: #EAF7F1; color: var(--primary,#5980a6); font-weight: 600; }
      .pm-medopt-c { color: var(--accent,#3f6489); font-weight: 700; }
      .pm-medopt-vazio { padding: 12px; color: var(--ink-faint,#585d62); font-size: 13px; }

      /* V975: TÍTULO DAS COLUNAS CONGELADO na rolagem vertical — mesma receita
         do V961 (Lentes de Contato): o .app-shell usa overflow-x:hidden, que o
         torna contêiner de rolagem e anula o sticky; nesta tela vira clip. O
         wrapper da matriz também usa clip (não auto/hidden). O dock de
         importação rola junto com a página para não cobrir o cabeçalho preso. */
      body[data-tela="producao-medica"] .app-shell { overflow-x: clip; }
      body[data-tela="producao-medica"] .import-dock-wrap { position: relative; top: auto; z-index: 3; }
      .pm-tabela-wrap { background: #fff; border: 1px solid var(--border,#eef0f2); border-radius: 12px; overflow: clip; }   /* V975: era auto */
      .pm-tabela thead th { position: sticky; top: 0; z-index: 6; }
      /* V978: some a linha escura abaixo da linha de GRUPO (PROD. TOTAL / CONVÊNIO /
         PARTICULAR / SUS) — era a border-bottom #3a5877 da regra global de thead.
         E a 2ª linha do cabeçalho (Produção / Repasse / %) gruda na altura REAL
         da 1ª ao rolar (--pm-r1 medida após o render), em vez de cobri-la. */
      .pm-tabela thead tr.pm-th-grp th { border-bottom: none !important; }
      .pm-tabela thead tr.pm-th-grp + tr th { top: var(--pm-r1, 0px); }
      .pm-tabela { width: auto; min-width: 100%; border-collapse: collapse; font-size: 13px; }
      /* V260: matriz agrupada com 14/15 colunas — fixed-layout pra TODAS caberem (sem corte da DESEMP); resize próprio mexe nos <col> */
      .pm-tabela.pm-tabela-fix { table-layout: fixed; }
      .pm-tabela.pm-tabela-fix td { overflow: hidden; }   /* só td: o th precisa deixar a alça de resize aparecer */
      .pm-tabela.pm-tabela-fix .pm-nome { text-overflow: ellipsis; }
      .pm-tabela th, .pm-tabela td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #EDE8DD; white-space: nowrap; }
      .pm-tabela thead th { background: var(--primary,#5980a6); color: #fff; font-weight: 600; }
      .pm-tabela td.num, .pm-tabela th.num { text-align: right; font-variant-numeric: tabular-nums; }
      .pm-rep { color: var(--accent,#3f6489); } .pm-des { color: var(--accent,#3f6489); }
      .pm-strong { font-weight: 700; } .pm-pct { color: var(--ink-soft,#585d62); }
      .pm-th-ord { cursor: pointer; user-select: none; } .pm-th-ord:hover { text-decoration: underline; }
      .pm-row { cursor: pointer; } .pm-row:hover { background: #FAF7F0; }
      .pm-nome { font-weight: 600; color: var(--ink,#3a5877); }
      .pm-ver { color: var(--accent,#3f6489); text-align: center; font-size: 18px; }
      .pm-tag-nc { font-size: 10px; background: #F3E9D6; color: #9A7B3A; border-radius: 6px; padding: 2px 6px; font-weight: 600; }
      .pm-total td { background: #FAF7F0; font-weight: 700; border-top: 2px solid var(--border,#eef0f2); }

      /* V254: aba Produção médica — 12 colunas → tabela compacta pra caber em .main (max 1400px); scroll como reserva */
      .pm-tabela.pm-tabela-pg th, .pm-tabela.pm-tabela-pg td { padding: 6px 8px; font-size: 12px; }
      .pm-tabela.pm-tabela-pg .pm-nome { font-size: 12.5px; }
      .pm-tabela.pm-tabela-pg .pm-pct { font-size: 10.5px; padding-left: 2px; padding-right: 6px; color: var(--ink-faint,#6B7A74); font-weight: 500; }
      .pm-tabela.pm-tabela-pg .pm-pct-h { font-size: 10.5px; padding-left: 2px; padding-right: 6px; }
      .pm-tabela.pm-tabela-pg .pm-ver { font-size: 15px; padding: 4px; }
      .pm-tabela.pm-tabela-pg thead tr:last-child th { font-size: 11px; }
      .pm-tabela.pm-tabela-pg thead .pm-th-grp th { font-size: 9.5px; padding: 6px 8px 3px; border-bottom: 2px solid rgba(255,255,255,.18); }
      .pm-tabela.pm-tabela-pg thead .pm-th-grp .pm-grp,
      .pm-tabela.pm-tabela-pg thead .pm-th-grp .pm-grp-des { text-align: center; color: #eef2f6; letter-spacing: .04em; }
      /* separadores sutis no início de cada bloco de fonte (ProdC col5, ProdP col8, Desemp col11) */
      .pm-tabela.pm-tabela-pg td:nth-child(5), .pm-tabela.pm-tabela-pg th:nth-child(5),
      .pm-tabela.pm-tabela-pg td:nth-child(8), .pm-tabela.pm-tabela-pg th:nth-child(8),
      .pm-tabela.pm-tabela-pg td:nth-child(11), .pm-tabela.pm-tabela-pg th:nth-child(11) { border-left: 1px solid #EDE8DD; }

      /* V255: detalhe do médico — Procedimento longo QUEBRA (não empurra a tabela e não corta Valor) */
      .pm-tabela.pm-tabela-det th, .pm-tabela.pm-tabela-det td { padding: 7px 10px; font-size: 12.5px; }
      .pm-tabela.pm-tabela-det .pm-proc { white-space: normal; width: 360px; line-height: 1.35; }
      .pm-tabela.pm-tabela-det .pm-conv-cell { width: 150px; }
      /* V947: .pm-fonte saiu — tag de fonte = global .atlas-fonte */
      .pm-rodape { margin-top: 12px; font-size: 12px; color: var(--ink-soft,#585d62); }
      .pm-vazio { padding: 28px; text-align: center; color: var(--ink-soft,#585d62); }

      .pm-dethead { display: flex; align-items: center; gap: 16px; margin-bottom: 14px; }
      .pm-voltar { background: none; border: 1px solid var(--border,#eef0f2); border-radius: 8px; padding: 7px 12px; color: var(--primary,#5980a6); cursor: pointer; font-size: 13px; }
      .pm-voltar:hover { border-color: var(--primary,#5980a6); }
      .pm-detnome { font-size: 18px; font-weight: 700; color: var(--primary,#5980a6); }
      .pm-sub { font-size: 12px; color: var(--ink-soft,#585d62); margin-top: 2px; }

      .pm-fbackdrop { position: fixed; inset: 0; z-index: 40; }
      .pm-fpop { position: fixed; z-index: 9999; background: var(--bg-elevated,#fff); border: 1px solid var(--border,#eef0f2); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.14); width: 280px; padding: 12px; }
      .pm-fpop-h { font-size: 12px; font-weight: 600; color: var(--ink,#3a5877); margin-bottom: 8px; }
      .pm-fpop-b { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow: auto; }
      .pm-fopt { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink,#3a5877); cursor: pointer; }
      .pm-fopt-x { font-size: 10px; color: #9A7B3A; background: #F3E9D6; border-radius: 5px; padding: 1px 5px; }
      .pm-fpop-f { display: flex; justify-content: space-between; margin-top: 10px; }
      /* V357: filtro/imposto abrem em CASCATA (staggered) — mesmo efeito do dropdown Cadastros (V277).
         A classe .pm-anim é aplicada SÓ na abertura (não a cada clique de checkbox). */
      .pm-fpop { transform-origin: top left; }
      .pm-fpop.pm-anim { animation: pmPopIn 0.20s cubic-bezier(0.22, 1, 0.36, 1) both; }
      @keyframes pmPopIn { from { opacity: 0; transform: translateY(-8px) scale(0.98); } to { opacity: 1; transform: none; } }
      .pm-fpop.pm-anim .pm-fopt, .pm-fpop.pm-anim .pm-iprow { opacity: 0; animation: pmOptIn 0.24s ease forwards; }
      @keyframes pmOptIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
      .pm-fpop.pm-anim .pm-fopt:nth-child(1),  .pm-fpop.pm-anim .pm-iprow:nth-child(1)  { animation-delay: .05s; }
      .pm-fpop.pm-anim .pm-fopt:nth-child(2),  .pm-fpop.pm-anim .pm-iprow:nth-child(2)  { animation-delay: .09s; }
      .pm-fpop.pm-anim .pm-fopt:nth-child(3),  .pm-fpop.pm-anim .pm-iprow:nth-child(3)  { animation-delay: .13s; }
      .pm-fpop.pm-anim .pm-fopt:nth-child(4),  .pm-fpop.pm-anim .pm-iprow:nth-child(4)  { animation-delay: .17s; }
      .pm-fpop.pm-anim .pm-fopt:nth-child(5),  .pm-fpop.pm-anim .pm-iprow:nth-child(5)  { animation-delay: .21s; }
      .pm-fpop.pm-anim .pm-fopt:nth-child(6),  .pm-fpop.pm-anim .pm-iprow:nth-child(6)  { animation-delay: .25s; }
      .pm-fpop.pm-anim .pm-fopt:nth-child(7),  .pm-fpop.pm-anim .pm-iprow:nth-child(7)  { animation-delay: .29s; }
      .pm-fpop.pm-anim .pm-fopt:nth-child(8),  .pm-fpop.pm-anim .pm-iprow:nth-child(8)  { animation-delay: .33s; }
      .pm-fpop.pm-anim .pm-fopt:nth-child(9),  .pm-fpop.pm-anim .pm-iprow:nth-child(9)  { animation-delay: .37s; }
      .pm-fpop.pm-anim .pm-fopt:nth-child(n+10), .pm-fpop.pm-anim .pm-iprow:nth-child(n+10) { animation-delay: .41s; }
      .pm-fpadrao, .pm-fok { border: 1px solid var(--border,#eef0f2); background: #fff; border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
      .pm-fok { background: var(--primary,#5980a6); color: #fff; border-color: var(--primary,#5980a6); }
      /* V268: drilldown de imposto por mês */
      .pm-ipop { width: 268px; }
      .pm-ipop .pm-fpop-f { justify-content: flex-end; }
      .pm-ipop-b { gap: 2px; }
      .pm-iprow { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 4px 2px; border-bottom: 1px solid #F1F5F3; }
      .pm-iprow:last-child { border-bottom: 0; }
      .pm-iprow-lbl { font-size: 12.5px; color: var(--ink,#3a5877); }
      .pm-iprow-in { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; font-weight: 700; color: var(--ink,#3a5877); }
      .pm-imp-in2 { width: 52px; border: 1px solid var(--border,#eef0f2); border-radius: 6px; padding: 3px 6px; font-size: 12.5px; font-weight: 700; color: var(--ink,#3a5877); text-align: right; background: #FBFCFC; font-family: inherit; }
      .pm-imp-in2:focus { outline: none; border-color: var(--accent,#3f6489); box-shadow: 0 0 0 2px rgba(63, 100, 137,.18); background: #fff; }
      .pm-ipop-vazio { font-size: 12px; color: var(--ink-faint,#585d62); padding: 6px 2px; }
      @media (max-width: 1100px) { .pm-cards { grid-template-columns: repeat(3,1fr); } }
      @media (max-width: 640px) { .pm-cards { grid-template-columns: repeat(2,1fr); } }
    `;
    document.head.appendChild(s);
  }

  // V271: API p/ a Consolidação congelar/descongelar o Contábil e p/ a Importação invalidar caches
  // V508: consolidação contábil por partes (prodMed inclui SUS desde V685;
  // total = prodMed + desemp + SANTO — o comparativo da Visão Geral trata o
  // SANTO como parte do repasse). Usa o snapshot CONGELADO da competência
  // quando existir; senão calcula ao vivo (classes padrão).
  const _consTotCacheV508 = new Map();
  // V510: partes separadas (prodMed / desemp / santo) — o comparativo da Visão
  // Geral filtra o Bloco 2 por elas ("Repasse (QVIS)" → prodMed+santo;
  // "Desempenho" → desemp; "Ambos" → total).
  function consolidacaoContabilPartes(comp) {
    const zero = { prodMed: 0, desemp: 0, santo: 0, total: 0 };
    if (!comp) return zero;
    const chave = comp + '|' + (Banco._versao || 0);
    if (_consTotCacheV508.has(chave)) return _consTotCacheV508.get(chave);
    if (_consTotCacheV508.size > 60) _consTotCacheV508.clear();
    const partes = { ...zero };
    try {
      let lista = null;
      if (temSnapContabil(comp)) {
        const s = lerSnapContabil(comp);
        lista = s && s.lista;
      }
      if (!lista) {
        const d = calcular(comp, CLASS_PADRAO.slice(), '');
        lista = (d && d.lista) || [];
      }
      partes.prodMed = lista.reduce((s, r) => s + (Number(r.convReceb) || 0) + (Number(r.partReceb) || 0) + (Number(r.susReceb) || 0), 0);   // V685: inclui o repasse SUS (V682)
      partes.desemp  = lista.reduce((s, r) => s + (Number(r.desemp) || 0), 0);
      partes.santo   = (adicionaisDe(comp) || []).reduce((s, a) => s + (Number(a.valor) || 0), 0);
      partes.total   = partes.prodMed + partes.desemp + partes.santo;
    } catch (e) { console.error('[producao-medica] consolidacaoContabilPartes', e); }
    _consTotCacheV508.set(chave, partes);
    return partes;
  }
  function consolidacaoTotalContabil(comp) {
    return consolidacaoContabilPartes(comp).total;
  }

  // V509: Receita líquida do consolidado contábil = RECEITA PROD TOTAL − imposto
  // do mês (mesma conta das linhas "PROD. TOTAL do mês / Imposto / Receita
  // líquida" deste módulo). Exposta para o comparativo da Visão Geral.
  function receitaLiquidaContabil(comp) {
    if (!comp) return 0;
    try {
      const bruto = receitaPuraTotal(comp);
      const pct = Number(lerImpostoPct(comp)) || 0;
      return bruto - (bruto * pct / 100);
    } catch (e) { console.error('[producao-medica] receitaLiquidaContabil', e); return 0; }
  }

  window.AtlasProducaoMedica = Object.assign(window.AtlasProducaoMedica || {}, {
    snapshotContabil: (comp) => salvarSnapContabil(comp),
    removerSnapContabil: (comp) => removerSnapContabil(comp),
    invalidar: (comp) => invalidarComp(comp),
    consolidacaoTotalContabil: (comp) => consolidacaoTotalContabil(comp),   // V508
    consolidacaoContabilPartes: (comp) => consolidacaoContabilPartes(comp), // V510
    receitaLiquidaContabil: (comp) => receitaLiquidaContabil(comp),         // V509
  });
})();
