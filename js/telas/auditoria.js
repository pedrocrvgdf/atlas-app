/**
 * ============================================================================
 * MÓDULO: AUDITORIA
 *
 * Corrige falhas de completude do QVIS usando a BASE TABELA como gabarito.
 * O Cálculo de Repasse é APENAS fonte de extração (read-only): a Auditoria
 * lê o snapshot calculado, aplica as correções e mantém o resultado corrigido
 * AQUI DENTRO — nada volta pro Cálculo.
 *
 * Duas seções internas:
 *   • Cálculo de Repasse — auditoria de papéis faltantes (foco atual)
 *   • Desempenho         — (preparada; fichários de desempenho)
 *
 * Regra central (chave = admissão + procedimento, só onde HÁ repasse):
 *   A BASE TABELA diz quais papéis o procedimento exige. Papel exigido e
 *   ausente no QVIS vira uma LINHA-FILHA (status ATLAS), preenchida assim:
 *     - AUXILIAR  → nome do CIRURGIÃO daquele procedimento (o valor do
 *                   auxiliar sempre vai pro cirurgião). Sem cirurgião no
 *                   procedimento → NOTIFICA (não inventa).
 *     - INDIC/SOLIC → busca em linhas_producao por cod_admissao exata:
 *                   coluna `indicante`; se vazia, coluna `solicitante`.
 *   Além disso: auxiliar presente com profissional divergente do cirurgião
 *   → renomeado pro cirurgião do procedimento.
 *   GLOSA (sem repasse) → ignorada.
 * ============================================================================
 */

App.telas['auditoria'] = function () {
  AuditoriaApp.montar();
};

const AuditoriaApp = (function () {
  'use strict';

  const _normCache = new Map();
  const norm = (t) => {
    const k = (t == null) ? '' : t;
    if (typeof k !== 'string') return Utilidades.normalizar(k);
    let v = _normCache.get(k);
    if (v === undefined) {
      v = Utilidades.normalizar(k);
      if (_normCache.size < 60000) _normCache.set(k, v);
    }
    return v;
  };
  const fmt  = (n) => Utilidades.formatarNumero(Number(n) || 0, 2);
  // V222: fonte EFETIVA da linha p/ a auditoria. Se a linha foi convertida por um
  // Perfil Particular (calcular.js: _regraPerfil + _perfilTabela), a auditoria deve
  // seguir a TABELA do perfil — ex: admissão Particular que passou a pagar como
  // Convênio precisa receber as regras de Convênio (auxiliar exigido, etc.).
  const fonteEfetiva = (l) => {
    if (l && l._regraPerfil && l._perfilTabela) {
      return String(l._perfilTabela).toUpperCase() === 'PARTICULAR' ? 'PARTICULAR' : 'CONVENIO';
    }
    return norm(l && l.origem || '');
  };
  const esc  = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));

  // Estado persistente entre renders
  const state = {
    secao: 'repasse',          // 'repasse' | 'validador' | 'honorario'
    competencia: null,
    resultado: null,           // resultado auditado (cache)
    _auditKey: null,           // V132.11: chave (secao|competencia) do resultado em cache
    _datalists: null,          // V132.11: valores únicos dos comboboxes (memoizados)
    // ── filtros IDÊNTICOS ao relatório de repasse ──
    buscaAdmissao: '',
    buscaProfissional: '',
    buscaProcedimento: '',
    buscaConvenio: '',
    // V903: os drops aceitam 'todos'/'todas', string legada ou ARRAY (multi)
    filtroPapel: 'todos',
    filtroStatus: 'todos',
    filtroFonte: 'todas',
    // V903: itens marcados (checkbox) por combo — vazio = modo "contém"
    multiSel: { admissao: [], profissional: [], procedimento: [], convenio: [] },
    dropAberto: null,          // qual combo/dropdown está aberto
    sbAberto: null,            // V734: célula da fileira 20C com painel aberto ('competencia' | null)
  };

  // ── Caches de apoio ──
  let cachePapeis = null;          // { porId: Map<id,nome>, idExecutante, idAuxiliar, idIndicante, idSolicitante, idLaudo }
  // V132.23: BASE TABELA pré-carregada (2 queries no total, não centenas):
  let baseProcOficial = null;      // Map<nome_oficial, id>
  let baseProcNorm = null;         // Map<norm(nome), id>
  let baseRegras = null;           // Map<`${proc}|${papel}|${fonteN}`, {valor,percentual}>
  let baseExigidos = null;         // Map<`${proc}|${fonteN}`, Set(papelId)>
  let mapProducao = null;          // V132.12: cod normalizado → { papéis da produção } (carregado 1x)
  let mapProducaoQtd = null;       // V132.14: cod normalizado → { qtdMax, qtdCapsulo } (carregado 1x)
  let mapProducaoCat = null;       // V132.22: `${cod}|${competencia}` → Set(categorias norm) (carregado 1x)
  let mapCirurgiaDatas = null;     // V132.31: cod → Set('YYYY-MM-DD' das CIRURGIAS na Produção)
  let palavrasCirurgia = null;     // V132.34: lista de palavras-chave de cirurgia (editável)
  let _qvisUnidadeMap = null;      // id linha_qvis → unidade_atendimento (norm)
  let _periodosCache = { comp: null, set: null };  // competência → Set(nomes norm dos médicos do Períodos)
  // V492: memoização por chave `${competencia}|${Banco._versao}` — qualquer
  // gravação no banco incrementa Banco._versao, invalidando automaticamente.
  let _matrizCache = { key: null, linhas: null };   // V492: resultado de matrizDaCompetencia()
  let _cachesBaseVersao = -1;      // V859: versão do banco refletida nos caches da Base/Produção
  let _validarCache = { key: null, resultado: null }; // V492: resultado de validar()
  // V563: versões da Base Tabela — regras congeladas por data de admissão
  let versoesTab = null;           // lista ordenada por (data_vigencia, id); null = ainda não lida
  let baseRegrasVer = null;        // Map<versao_id, { regras: Map, exigidos: Map }> (lazy)

  // ──────────────────────────────────────────────────────────────────────
  // LEITURA DE APOIO
  // ──────────────────────────────────────────────────────────────────────
  function lerPapeis() {
    if (cachePapeis) return cachePapeis;
    const rows = Banco.query('SELECT id, nome FROM papeis') || [];
    const porId = new Map();
    let idExecutante = null, idAuxiliar = null, idIndicante = null, idSolicitante = null, idLaudo = null;
    for (const r of rows) {
      porId.set(r.id, r.nome);
      const n = norm(r.nome);
      if (n === 'EXECUTANTE') idExecutante = r.id;
      else if (n === 'AUXILIAR') idAuxiliar = r.id;
      else if (n === 'INDICANTE') idIndicante = r.id;
      else if (n === 'SOLICITANTE') idSolicitante = r.id;
      else if (n === 'MEDICO LAUDO') idLaudo = r.id;
    }
    // mapeamento_papeis: texto cru do QVIS (CIRURGIAO, AUXILIAR 1, MEDICO DE LAUDO...) → papel canônico
    const mapQvis = new Map();
    try {
      const mr = Banco.query('SELECT papel_qvis, papel_id FROM mapeamento_papeis') || [];
      for (const m of mr) mapQvis.set(norm(m.papel_qvis), m.papel_id);
    } catch (e) { /* ignora */ }
    cachePapeis = { porId, mapQvis, idExecutante, idAuxiliar, idIndicante, idSolicitante, idLaudo };
    return cachePapeis;
  }

  // Resolve SEMPRE o papel canônico de uma linha (Executante/Auxiliar/Indicante/Solicitante/Médico Laudo)
  function canonNomePapel(linha) {
    const P = lerPapeis();
    if (linha._papelId != null && P.porId.has(linha._papelId)) return P.porId.get(linha._papelId);
    const pid = P.mapQvis.get(norm(linha.papel));
    if (pid != null && P.porId.has(pid)) return P.porId.get(pid);
    return linha.papel || '—';
  }

  // V132.23: pré-carrega procedimentos + tabela_repasse de uma vez (2 queries),
  // eliminando as centenas de queries por-procedimento que pesavam a auditoria.
  function carregarBase() {
    if (baseRegras) return;
    baseProcOficial = new Map();
    baseProcNorm = new Map();
    baseRegras = new Map();
    baseExigidos = new Map();
    try {
      const procs = Banco.query('SELECT id, nome_oficial, nome_normalizado FROM procedimentos') || [];
      for (const p of procs) {
        if (p.nome_oficial) baseProcOficial.set(p.nome_oficial, p.id);
        const nk = norm(p.nome_normalizado || p.nome_oficial);
        if (nk && !baseProcNorm.has(nk)) baseProcNorm.set(nk, p.id);
        const ok = norm(p.nome_oficial);
        if (ok && !baseProcNorm.has(ok)) baseProcNorm.set(ok, p.id);
      }
    } catch (e) { /* ignora */ }
    // V843: as GRAFIAS do de-para também resolvem o procedimento — a linha
    // glosada de um cálculo salvo por versão antiga chega aqui só com o texto
    // cru do QVIS (sem _procOficial), e sem os sinônimos ela ficava sem id.
    try {
      const sins = Banco.query('SELECT procedimento_id, grafia, grafia_normalizada FROM sinonimos_proc') || [];
      for (const s of sins) {
        for (const g of [s.grafia_normalizada, s.grafia]) {
          const k = norm(g);
          if (k && !baseProcNorm.has(k)) baseProcNorm.set(k, s.procedimento_id);
        }
      }
    } catch (e) { /* ignora */ }
    try {
      const regras = Banco.query(
        'SELECT procedimento_id, papel_id, fonte_pagadora, valor, percentual FROM tabela_repasse WHERE ativo = 1'
      ) || [];
      for (const r of regras) {
        const fonteN = norm(r.fonte_pagadora);
        const rk = `${r.procedimento_id}|${r.papel_id}|${fonteN}`;
        if (!baseRegras.has(rk)) baseRegras.set(rk, { valor: r.valor, percentual: r.percentual });
        const tem = (r.valor != null && Number(r.valor) !== 0) || (r.percentual != null && Number(r.percentual) !== 0);
        if (tem) {
          const ek = `${r.procedimento_id}|${fonteN}`;
          let s = baseExigidos.get(ek);
          if (!s) { s = new Set(); baseExigidos.set(ek, s); }
          s.add(r.papel_id);
        }
      }
    } catch (e) { /* ignora */ }
  }

  function procIdDeOficial(nomeOficial) {
    if (!nomeOficial) return null;
    carregarBase();
    const id = baseProcOficial.get(nomeOficial);
    if (id != null) return id;
    const v = baseProcNorm.get(norm(nomeOficial));
    return v == null ? null : v;
  }

  // ── V563: VERSÕES DA BASE TABELA ───────────────────────────────────────
  // As filhas (Indicante/Solicitante/Laudo/Auxiliar) criadas aqui são pagas
  // pela versão da tabela vigente na DATA DA ADMISSÃO do grupo — mesma regra
  // do motor do Calcular. Sem versão publicada → tabela viva (original).
  function montarBaseVersao(vid) {
    const regras = new Map(), exigidos = new Map();
    const rows = Banco.query(
      `SELECT procedimento_id, papel_id, fonte_pagadora, valor, percentual
         FROM tabela_repasse_hist WHERE versao_id = ? AND ativo = 1`, [vid]) || [];
    for (const r of rows) {
      const fonteN = norm(r.fonte_pagadora);
      const rk = `${r.procedimento_id}|${r.papel_id}|${fonteN}`;
      if (!regras.has(rk)) regras.set(rk, { valor: r.valor, percentual: r.percentual });
      const tem = (r.valor != null && Number(r.valor) !== 0) || (r.percentual != null && Number(r.percentual) !== 0);
      if (tem) {
        const ek = `${r.procedimento_id}|${fonteN}`;
        let s = exigidos.get(ek);
        if (!s) { s = new Set(); exigidos.set(ek, s); }
        s.add(r.papel_id);
      }
    }
    return { regras, exigidos };
  }
  // V816: qual VERSÃO vale para uma data de admissão (null = sem versões)
  function versaoDaData(dataAdm) {
    carregarBase();
    if (versoesTab === null) {
      versoesTab = [];
      baseRegrasVer = new Map();
      try {
        if (window.AtlasVersoesTabela && window.AtlasVersoesTabela.garantir()) {
          versoesTab = Banco.query(`SELECT id, numero, data_vigencia FROM tabela_versoes ORDER BY data_vigencia, id`) || [];
        }
      } catch (e) { /* ignora */ }
    }
    if (!versoesTab.length) return null;
    const d = String(dataAdm || '').slice(0, 10);
    let v = versoesTab[versoesTab.length - 1];              // sem data → última publicada
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      // V639: antes de TODAS as vigências → versão de MENOR NÚMERO (1.0, a
      // padrão) — mesma regra do motor do Calcular (V636). Pegar a de vigência
      // mais antiga pagava as filhas (Indicante/Auxiliar/…) com valores da 2.0
      // em admissões anteriores a todas as vigências.
      v = null;
      for (const c of versoesTab) { if (c.data_vigencia <= d) v = c; else break; }
      if (!v) v = versoesTab.reduce((a, b) =>
        (Number(String(b.numero).replace(',', '.')) || 0) < (Number(String(a.numero).replace(',', '.')) || 0) ? b : a, versoesTab[0]);
    }
    return v;
  }
  // resolve {regras, exigidos} para uma data de admissão (lazy por versão)
  function baseDaData(dataAdm) {
    const v = versaoDaData(dataAdm);
    if (!v) return { regras: baseRegras, exigidos: baseExigidos };
    let b = baseRegrasVer.get(v.id);
    if (!b) { b = montarBaseVersao(v.id); baseRegrasVer.set(v.id, b); }
    return b;
  }

  // Papéis que a BASE TABELA exige pra esse procedimento + fonte (com wildcard TODAS).
  // Papel com valor E percentual zerados NÃO é exigido (não tem remuneração).
  // V563: consulta a VERSÃO vigente na data de admissão (dataAdm).
  function papeisExigidos(procId, fonte, dataAdm) {
    const base = baseDaData(dataAdm);
    const fN = norm(fonte);
    const a = base.exigidos.get(`${procId}|${fN}`);
    const b = base.exigidos.get(`${procId}|TODAS`);
    if (!a && !b) return [];
    const out = new Set();
    if (a) for (const x of a) out.add(x);
    if (b) for (const x of b) out.add(x);
    return [...out];
  }

  function regraDe(procId, papelId, fonte, dataAdm) {
    const base = baseDaData(dataAdm);
    const fN = norm(fonte);
    return base.regras.get(`${procId}|${papelId}|${fN}`) || base.regras.get(`${procId}|${papelId}|TODAS`) || null;
  }

  // ── V640: BALANÇO DO ERRO DE VERSÃO ─────────────────────────────────────
  // Quanto foi pago A MAIS enquanto a resolução de vigência caía na versão
  // ERRADA: antes da correção (V636/V639), admissão anterior a TODAS as
  // vigências caía na versão de vigência mais ANTIGA (ex.: a 2.0, publicada
  // com vigência 01/07/2026) em vez da padrão 1.0. Recalcula cada linha da
  // matriz sob as DUAS resoluções e soma a diferença por competência/médico.
  // Estimativa pela regra da Base Tabela linha a linha — exceções por médico
  // e overrides manuais de Honorário ficam de fora (não dependem de versão).
  function regrasVersaoId(vid) {
    let b = baseRegrasVer.get(vid);
    if (!b) { b = montarBaseVersao(vid); baseRegrasVer.set(vid, b); }
    return b;
  }
  function balancoErroVersao(comps) {
    baseDaData('');   // garante versoesTab/baseRegrasVer carregados
    if (!versoesTab || !versoesTab.length) return { semVersoes: true };
    const vs = versoesTab;
    const numeroDe = (v) => Number(String(v.numero).replace(',', '.')) || 0;
    const baseline = vs.reduce((a, b) => numeroDe(b) < numeroDe(a) ? b : a, vs[0]);
    const resolver = (d, antiga) => {
      let v = antiga ? vs[0] : null;   // ANTIGA (bugada): começa na vigência mais antiga
      for (const c of vs) { if (c.data_vigencia <= d) v = c; else break; }
      return v || baseline;            // NOVA (correta): antes de todas → padrão (1.0)
    };
    const regraEm = (vid, procId, papelId, fonteN) => {
      const b = regrasVersaoId(vid);
      return b.regras.get(`${procId}|${papelId}|${fonteN}`) || b.regras.get(`${procId}|${papelId}|TODAS`) || null;
    };
    const valorDe = (r, produzido) => !r ? 0
      : (r.valor != null ? (Number(r.valor) || 0)
      : (r.percentual != null ? (Number(produzido) || 0) * (Number(r.percentual) || 0) : 0));
    const out = { semVersoes: false, porComp: [], detalhe: [], totalGeral: 0, nLinhas: 0 };
    for (const comp of comps) {
      let linhas = [];
      try { linhas = matrizDaCompetencia(comp) || []; } catch (e) { console.warn('[auditoria] erro-versão', comp, e); }
      // A matriz auditada NÃO inclui as linhas "NOVO/sem regra" — mas uma
      // linha que HOJE fica sem regra pode ter sido paga pela versão errada
      // (regra que só existe na 2.0 aplicada antes da vigência). Completa
      // com essas linhas direto do snapshot do cálculo.
      try {
        const sr = Banco.query(`SELECT resultado_json FROM repasse_snapshot WHERE competencia = ? LIMIT 1`, [comp]) || [];
        if (sr[0]) {
          const extras = (JSON.parse(Banco.snapUnpack ? Banco.snapUnpack(sr[0].resultado_json) : sr[0].resultado_json).linhas || [])
            .filter(l => l._status === 'procSemRegra' && l._papelId != null);
          linhas = linhas.concat(extras);
        }
      } catch (e) { /* ignora */ }
      const medMap = new Map();
      let totalComp = 0, nComp = 0;
      for (const l of linhas) {
        if (l._honorarioOverride) continue;
        if (l._status === 'glosa' || l._status === 'excluidoTipo' || l._status === 'duplicada') continue;
        if (l._papelId == null) continue;
        const d = String(l.data_admissao || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
        const vA = resolver(d, true), vN = resolver(d, false);
        if (vA.id === vN.id) continue;   // resolução igual nas duas → sem erro possível
        const procId = procIdDeOficial(l._procOficial || l.procedimento);
        if (procId == null) continue;
        const fonteN = norm(l.origem);
        const valorA = valorDe(regraEm(vA.id, procId, l._papelId, fonteN), l.produzido);
        const valorN = valorDe(regraEm(vN.id, procId, l._papelId, fonteN), l.produzido);
        const dif = valorA - valorN;
        if (Math.abs(dif) < 0.005) continue;
        const nome = String(l.nome_profissional || '').trim() || '(sem profissional)';
        const m = medMap.get(norm(nome)) || { nome, dif: 0, n: 0 };
        m.dif += dif; m.n++;
        medMap.set(norm(nome), m);
        totalComp += dif; nComp++;
        out.detalhe.push({
          comp, admissao: l.admissao || '', data: d, nome,
          papel: l._papelCanon || l.papel || '', proc: l._procOficial || l.procedimento || '',
          convenio: l.convenio || '', vAntiga: 'v' + vA.numero, vNova: 'v' + vN.numero,
          valorA, valorN, dif,
        });
      }
      if (nComp) {
        out.porComp.push({
          comp,
          consolidado: !!(window.AtlasConsolidacao && window.AtlasConsolidacao.estaConsolidado && window.AtlasConsolidacao.estaConsolidado(comp)),
          total: totalComp, n: nComp,
          medicos: [...medMap.values()].sort((a, b) => b.dif - a.dif),
        });
        out.totalGeral += totalComp; out.nLinhas += nComp;
      }
    }
    return out;
  }

  // V132.10: normaliza um código de admissão pra casar QVIS × Produção
  // (Excel grava número → ".0" no fim; pode haver espaços).
  function normAdm(cod) {
    return String(cod == null ? '' : cod).trim().replace(/\.0+$/, '').replace(/\s/g, '');
  }

  // V132.10: pré-carrega TODA a produção UMA VEZ num Map
  // (cod normalizado → { indicante, solicitante }). Antes fazíamos uma query por
  // admissão com REPLACE(...) no WHERE, o que desativava o índice e provocava full
  // scan a cada grupo → o app travava. Agora é 1 query + lookup O(1).
  //
  // REGRA: Indicante/Solicitante é preenchido pela Produção (PROCV pela admissão):
  // pega `indicante`; se vazio, `solicitante`. V132.21: o EXECUTANTE ausente também
  // é preenchido pela Produção (cirurgiao; se vazio, medico).
  // V132.23: carrega a Produção UMA VEZ (1 query) e monta os 3 mapas de uma vez.
  // Antes eram 3 varreduras completas de linhas_producao, recarregadas a cada
  // auditoria — o que deixava o módulo pesado. Agora é 1 scan, cacheado enquanto
  // a tela vive (só recarrega ao reentrar na tela, via montar()).
  // V132.28: NOMES (indicante/solicitante/cirurgião/médico) — usado na ABERTURA
  // pra criar as filhas. Só 4 colunas e o WHERE descarta linhas sem nenhum nome,
  // reduzindo muito o volume devolvido pelo banco. SEM normalização pesada.
  function carregarProducaoNomes() {
    if (mapProducao) return mapProducao;
    const mNomes = new Map();
    try {
      /**
       * V857: leitura em ARRAYS (Banco.queryArrays). São as MESMAS linhas, na
       * MESMA ORDEM — muda só o transporte: sem um objeto JS por linha. Numa
       * base de 1 milhão de linhas de produção isso cai de ~2,6s para ~1,1s,
       * e some a pressão no coletor de lixo. A regra continua a de sempre:
       * vale o PRIMEIRO nome não vazio de cada admissão.
       */
      const { valores } = Banco.queryArrays(
        `SELECT cod_admissao, indicante, solicitante, cirurgiao, medico
           FROM linhas_producao
          WHERE (indicante  IS NOT NULL AND TRIM(indicante)  <> '')
             OR (solicitante IS NOT NULL AND TRIM(solicitante) <> '')
             OR (cirurgiao  IS NOT NULL AND TRIM(cirurgiao)  <> '')
             OR (medico     IS NOT NULL AND TRIM(medico)     <> '')`);
      for (let i = 0; i < valores.length; i++) {
        const v = valores[i];                       // [cod, indicante, solicitante, cirurgiao, medico]
        const k = normAdm(v[0]);
        if (!k) continue;
        let e = mNomes.get(k);
        if (!e) { e = { indicante: '', solicitante: '', cirurgiao: '', medico: '' }; mNomes.set(k, e); }
        if (!e.indicante   && v[1] && String(v[1]).trim()) e.indicante   = String(v[1]).trim();
        if (!e.solicitante && v[2] && String(v[2]).trim()) e.solicitante = String(v[2]).trim();
        if (!e.cirurgiao   && v[3] && String(v[3]).trim()) e.cirurgiao   = String(v[3]).trim();
        if (!e.medico      && v[4] && String(v[4]).trim()) e.medico      = String(v[4]).trim();
      }
    } catch (e) { /* ignora */ }
    mapProducao = mNomes;
    return mapProducao;
  }

  // V132.34: lista de PALAVRAS-CHAVE de cirurgia, controlada pelo usuário (editável
  // num modal). Serve pra reconhecer que "PACOTE FACECTOMIA" e "FACECTOMIA" são a
  // mesma família. Cria a tabela se não existir e semeia com alguns exemplos.
  function carregarPalavrasCirurgia() {
    if (palavrasCirurgia) return palavrasCirurgia;
    let arr = [];
    try {
      Banco.executar(`CREATE TABLE IF NOT EXISTS config_palavras_cirurgia (
        id INTEGER PRIMARY KEY AUTOINCREMENT, palavra TEXT NOT NULL)`);
      const rows = Banco.query(`SELECT palavra FROM config_palavras_cirurgia ORDER BY palavra`) || [];
      arr = rows.map(r => norm(r.palavra)).filter(Boolean);
      if (!arr.length) {
        /**
         * V857: os exemplos ficam só na MEMÓRIA. Antes eles eram gravados e
         * seguidos de Banco.salvar() — uma ESCRITA no meio de um render de
         * leitura, que avançava a versão do banco e derrubava todos os caches,
         * inclusive a matriz auditada (5,4s para refazer, medido em base de 1
         * milhão de linhas). Resultado: a tela vinha lenta de novo na visita
         * seguinte, sem nada ter mudado. A lista real continua sendo a que o
         * usuário edita no modal — lá, sim, a gravação é intencional.
         */
        arr = ['FACECTOMIA', 'CAPSULOTOMIA'];
      }
    } catch (e) { /* ignora */ }
    palavrasCirurgia = arr;
    return palavrasCirurgia;
  }

  // V132.34: palavra-chave de cirurgia que o procedimento CONTÉM (em qualquer
  // posição), conforme a lista. Vazio = não é cirurgia reconhecida na lista.
  function raizCirurgia(procNorm) {
    if (!procNorm) return '';
    const lista = carregarPalavrasCirurgia();
    for (const p of lista) {
      if (procNorm.indexOf(p) >= 0) return p;
    }
    return '';
  }

  // V132.31: extrai só a DATA (YYYY-MM-DD) ignorando hora, pra comparar dias.
  function soData(s) {
    if (!s) return '';
    const str = String(s).trim();
    let m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return str.slice(0, 10);
  }

  // V132.31: datas DISTINTAS de CIRURGIA por admissão (da Produção). O WHERE
  // filtra só categoria "Cirurgias" no banco — traz um subconjunto pequeno e leve.
  // Usado pra saber quantas cirurgias REAIS (em dias distintos) a admissão teve:
  // numa cirurgia, 1 dia = 1 executante; o QVIS às vezes duplica no mesmo dia.
  function carregarCirurgiaDatas() {
    if (mapCirurgiaDatas) return mapCirurgiaDatas;
    const mapa = new Map();
    try {
      const { valores } = Banco.queryArrays(   // V857: mesmas linhas, transporte barato
        `SELECT cod_admissao, data_admissao FROM linhas_producao
          WHERE categoria IS NOT NULL AND UPPER(categoria) LIKE 'CIRURGIA%'`);
      for (let i = 0; i < valores.length; i++) {
        const r = { cod_admissao: valores[i][0], data_admissao: valores[i][1] };
        const k = normAdm(r.cod_admissao);
        if (!k) continue;
        const d = soData(r.data_admissao);
        if (!d) continue;
        let set = mapa.get(k);
        if (!set) { set = new Set(); mapa.set(k, set); }
        set.add(d);
      }
    } catch (e) { /* ignora */ }
    mapCirurgiaDatas = mapa;
    return mapCirurgiaDatas;
  }

  // V132.28: QUANTIDADE + CATEGORIA — usado SÓ no VALIDADOR. Carregado sob demanda
  // (lazy), não na abertura. A detecção de CAPSULOTOMIA usa toUpperCase()+indexOf
  // (muito mais barato que normalizar) e só roda quando a quantidade interessa.
  function carregarProducaoValidador() {
    if (mapProducaoQtd && mapProducaoCat) return;
    const mQtd = new Map();
    const mCat = new Map();
    try {
      const rows = Banco.query(
        `SELECT cod_admissao, competencia, categoria, quantidade,
                procedimento_principal, produto, pacote
           FROM linhas_producao`
      ) || [];
      for (const r of rows) {
        const k = normAdm(r.cod_admissao);
        if (!k) continue;

        const q = Number(r.quantidade) || 0;
        let eq = mQtd.get(k);
        if (!eq) { eq = { qtdMax: 0, qtdCapsulo: 0 }; mQtd.set(k, eq); }
        if (q > eq.qtdMax) eq.qtdMax = q;
        if (q > eq.qtdCapsulo) {
          const txt = `${r.procedimento_principal || ''} ${r.produto || ''} ${r.pacote || ''}`.toUpperCase();
          if (txt.indexOf('CAPSULOTOMIA') >= 0) eq.qtdCapsulo = q;
        }

        const comp = String(r.competencia || '').trim();
        const ck = `${k}|${comp}`;
        let set = mCat.get(ck);
        if (!set) { set = new Set(); mCat.set(ck, set); }
        const cat = norm(r.categoria || '');
        if (cat) set.add(cat);
      }
    } catch (e) { /* ignora */ }
    mapProducaoQtd = mQtd;
    mapProducaoCat = mCat;
  }

  function carregarProducao()    { return carregarProducaoNomes(); }
  function carregarProducaoQtd() { carregarProducaoValidador(); return mapProducaoQtd; }
  function carregarProducaoCat() { carregarProducaoValidador(); return mapProducaoCat; }

  // PROCV da admissão na Produção → { indicante, solicitante }.
  function indicanteSolicitante(admissao) {
    if (!admissao) return { indicante: '', solicitante: '' };
    return carregarProducao().get(normAdm(admissao)) || { indicante: '', solicitante: '' };
  }

  // V132.21: cirurgião (executante) da Produção; se vazio, médico.
  function cirurgiaoProducao(admissao) {
    if (!admissao) return '';
    const p = carregarProducao().get(normAdm(admissao));
    return p ? (p.cirurgiao || p.medico || '') : '';
  }

  // categoria "Cirurgias" de forma flexível (singular/plural, acento, caixa)
  function catEhCirurgia(catNorm) {
    return catNorm && catNorm.startsWith('CIRURGIA');
  }
  // categoria representativa pra exibição (primeira do set)
  function catRepresentativa(set) {
    if (!set || !set.size) return '';
    for (const c of set) if (catEhCirurgia(c)) return c;
    return set.values().next().value || '';
  }
  function tokensNome(s) {
    const stop = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
    return norm(s).split(/\s+/).filter(t => t.length > 2 && !stop.has(t));
  }
  function nomesBatem(a, b) {
    const na = norm(a), nb = norm(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;
    const ta = tokensNome(a), tb = tokensNome(b);
    if (ta.length && tb.length) {
      // primeiro e último nome significativo coincidem
      if (ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1]) return true;
      // pelo menos 2 nomes em comum
      const setB = new Set(tb);
      if (ta.filter(t => setB.has(t)).length >= 2) return true;
    }
    if (Utilidades.similaridade && Utilidades.similaridade(na, nb) >= 0.82) return true;
    return false;
  }

  // Roda as duas conferências sobre o resultado auditado.
  function validar() {
    const res = state.resultado;
    if (!res || !Array.isArray(res.linhas)) return null;
    // V492: memoizado por (competencia | Banco._versao) — antes rodava as três
    // conferências inteiras a cada renderCorpo() (inclusive a cada tecla de filtro).
    const _key = state.competencia + '|' + (Banco._versao || 0);
    if (_validarCache.key === _key) return _validarCache.resultado;
    const linhas = res.linhas;

    // ── 1) Indicante/Solicitante: QVIS × Produção (PROCV flexível) ──
    const divergencias = [];
    let nOk = 0, nSemProd = 0;
    const vistos = new Set();
    for (const l of linhas) {
      const pc = l._papelCanon;
      if (pc !== 'Indicante' && pc !== 'Solicitante') continue;
      if (l._ehAuditoria) continue;   // só linhas vindas do QVIS (não as filhas que nós criamos)
      // V132.26: conferência só para classificação "Procedimento" (não Consulta/Exame)
      if (norm(l.classificacao) !== 'PROCEDIMENTO') continue;
      const adm = l.admissao;
      const chave = `${adm}|${norm(l.nome_profissional)}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const prod = indicanteSolicitante(adm);
      if (!prod.indicante && !prod.solicitante) { nSemProd++; continue; }  // falta produção → ignora
      const nomeQvis = l.nome_profissional || '';
      const bate = nomesBatem(nomeQvis, prod.indicante) || nomesBatem(nomeQvis, prod.solicitante);
      if (bate) { nOk++; }
      else divergencias.push({ admissao: adm, papel: pc, nomeQvis, nomeProd: prod.indicante || prod.solicitante || '', origem: l.origem || '', convenio: l.convenio || '' });
    }

    // ── 2) PROCEDIMENTO abaixo da BASE TABELA ──────────────────────────────
    // Para cada PROCEDIMENTO (admissão+procedimento), o total PAGO (soma dos
    // repasses de todas as linhas: QVIS + filhas ATLAS) deve ser ≥ a soma dos
    // papéis da BASE TABELA do procedimento (Executante + Indicante/Solicitante
    // [só um] + Auxiliar + Médico Laudo) × QUANTIDADE da Produção. Quando o pago
    // fica ABAIXO disso, sinaliza (pode faltar papel/valor ou quantidade não aplicada).
    const Pv = lerPapeis();
    carregarBase();
    const mapQtdBase = carregarProducaoQtd();
    // V815: o esperado sai da VERSÃO da tabela vigente na DATA DA ADMISSÃO —
    // a mesma resolução do motor do Calcular e das filhas (V636/V639). Uma
    // admissão fora da vigência da tabela nova paga a versão da vigência dela;
    // compará-la com a tabela de HOJE acusava (ou escondia) diferença errada.
    function valorPapelBase(regrasVer, procId, papelId, fonteN, produzido) {
      if (papelId == null) return 0;
      const r = regrasVer.get(`${procId}|${papelId}|${fonteN}`) || regrasVer.get(`${procId}|${papelId}|TODAS`);
      if (!r) return 0;
      if (r.valor != null && Number(r.valor) !== 0) return Number(r.valor) || 0;
      if (r.percentual != null && Number(r.percentual) !== 0) return (Number(produzido) || 0) * (Number(r.percentual) || 0);
      return 0;
    }
    function somaBasePapeis(dataAdm, procId, fonteN, produzido) {
      const regrasVer = baseDaData(dataAdm).regras;
      let t = 0;
      t += valorPapelBase(regrasVer, procId, Pv.idExecutante, fonteN, produzido);
      t += valorPapelBase(regrasVer, procId, Pv.idAuxiliar, fonteN, produzido);
      t += valorPapelBase(regrasVer, procId, Pv.idLaudo, fonteN, produzido);
      // Indicante OU Solicitante (são o mesmo papel lógico) → conta só um
      const vInd = valorPapelBase(regrasVer, procId, Pv.idIndicante, fonteN, produzido);
      const vSol = valorPapelBase(regrasVer, procId, Pv.idSolicitante, fonteN, produzido);
      t += Math.max(vInd, vSol);
      return t;
    }
    // reagrupa as linhas auditadas por admissão+procedimento
    // V132.36: ignora PARTICULAR (não tem lógica de papéis da BASE) e GLOSA
    // (não foi pago → comparar com a BASE seria sempre falso-positivo).
    const gAbaixo = new Map();
    for (const l of linhas) {
      if (l._status === 'glosa') continue;
      const fonteL = norm(l.origem || '');
      if (fonteL === 'PARTICULAR') continue;
      const adm = l.admissao || '';
      const pNorm = norm(l.procedimento || '');
      if (!adm || !pNorm) continue;
      const ch = `${adm}||${pNorm}`;
      let e = gAbaixo.get(ch);
      if (!e) {
        e = { admissao: adm, proc: l.procedimento, procOficial: l._procOficial || l.procedimento,
              fonte: String(l.origem || '').toUpperCase(), pago: 0, produzido: 0,
              origem: l.origem || '', convenio: l.convenio || '',
              dataAdm: String(l.data_admissao || '').slice(0, 10) };   // V815
        gAbaixo.set(ch, e);
      }
      e.pago += Number(l._repasse) || 0;
      const prod = Number(l.produzido) || 0;
      if (prod > e.produzido) e.produzido = prod;
      if (!e.convenio && l.convenio) e.convenio = l.convenio;
      if (!e.procOficial && l._procOficial) e.procOficial = l._procOficial;
      if (!e.dataAdm && l.data_admissao) e.dataAdm = String(l.data_admissao).slice(0, 10);   // V815
    }
    const abaixo = [];
    for (const e of gAbaixo.values()) {
      const procId = procIdDeOficial(e.procOficial);
      if (procId == null) continue;
      const fonteN = norm(e.fonte || 'CONVENIO');
      const somaBase = somaBasePapeis(e.dataAdm, procId, fonteN, e.produzido);   // V815
      if (somaBase <= 0) continue;   // procedimento sem valores cadastrados → ignora
      const q = mapQtdBase.get(normAdm(e.admissao));
      const qtd = q && q.qtdMax >= 1 ? q.qtdMax : 1;
      // V132.37: NÃO multiplica a BASE pela quantidade. O esperado é o valor "cheio"
      // de UMA cirurgia (×1). Se o pago vier ×2, é por conta da quantidade 2 (pago
      // > base → ok, não sinaliza). Só sinaliza quem pagou ABAIXO do valor cheio.
      const esperado = somaBase;
      e.somaBase = somaBase; e.qtd = qtd; e.esperado = esperado;
      e.diferenca = esperado - e.pago;
      // tolerância de centavos pra não acusar arredondamento
      if (e.pago + 0.02 < esperado) abaixo.push(e);
    }
    abaixo.sort((a, b) => (b.diferenca - a.diferenca) || String(a.admissao).localeCompare(String(b.admissao)));

    // ── 3) "Procedimento" no QVIS × categoria Cirurgias na Produção (mesmo mês) ──
    const mapCat = carregarProducaoCat();
    const porAdmProc = new Map();
    for (const l of linhas) {
      if (norm(l.classificacao) !== 'PROCEDIMENTO') continue;
      const adm = l.admissao;
      if (porAdmProc.has(adm)) continue;   // uma linha por admissão
      const comp = String(l.competencia || '').trim();
      porAdmProc.set(adm, { admissao: adm, proc: l.procedimento, comp, origem: l.origem || '', convenio: l.convenio || '' });
    }
    const procs = [];
    let nCirurgica = 0, nNaoCirurgica = 0, nProcSemProd = 0;
    for (const e of porAdmProc.values()) {
      const set = mapCat.get(`${normAdm(e.admissao)}|${e.comp}`);
      if (!set || !set.size) { e.situacao = 'sem-prod'; nProcSemProd++; }
      else if (catRepresentativa(set) && catEhCirurgia(catRepresentativa(set))) { e.situacao = 'cirurgica'; e.categoria = catRepresentativa(set); nCirurgica++; }
      else { e.situacao = 'nao-cirurgica'; e.categoria = catRepresentativa(set); nNaoCirurgica++; }
      procs.push(e);
    }
    procs.sort((a, b) => {
      const ordem = { 'cirurgica': 0, 'nao-cirurgica': 1, 'sem-prod': 2 };
      return (ordem[a.situacao] - ordem[b.situacao]) || String(a.admissao).localeCompare(String(b.admissao));
    });

    // V492: guarda no cache memoizado (chave competencia|Banco._versao)
    _validarCache = {
      key: _key,
      resultado: {
        indSol: { divergencias, nOk, nSemProd, nDiverg: divergencias.length },
        abaixo: { lista: abaixo, total: abaixo.length },
        proc: { lista: procs, nCirurgica, nNaoCirurgica, nProcSemProd, total: procs.length },
      },
    };
    return _validarCache.resultado;
  }

  // ──────────────────────────────────────────────────────────────────────
  // NÚCLEO DA AUDITORIA
  // ──────────────────────────────────────────────────────────────────────
  // ── REGRA ATLAS: médico do Períodos não recebe CONSULTA fora da Matriz ──────
  // Mapa id(linha_qvis) → unidade_atendimento normalizada (1 query, cacheado).
  function qvisUnidadeMap() {
    if (_qvisUnidadeMap) return _qvisUnidadeMap;
    const m = new Map();
    try {
      (Banco.query(`SELECT id, unidade_atendimento FROM linhas_qvis`) || []).forEach(r => {
        m.set(r.id, norm(r.unidade_atendimento || ''));
      });
    } catch (e) { /* tabela pode não existir */ }
    _qvisUnidadeMap = m;
    return m;
  }

  // Conjunto de nomes (normalizados) dos médicos que têm Períodos no mês,
  // expandido pelo de-para (nome oficial + sinônimos), pra casar qualquer grafia.
  function setMedicosPeriodos(comp) {
    if (_periodosCache.comp === comp && _periodosCache.set) return _periodosCache.set;
    const set = new Set();
    try {
      const nomesPer = Banco.query(`SELECT DISTINCT nome_normalizado FROM periodos_linhas WHERE mes_ref = ?`, [comp]) || [];
      if (nomesPer.length) {
        // de-para: norm(grafia/oficial) → medico_id  e  medico_id → [norm nomes]
        const nomeParaId = new Map();
        const idParaNomes = new Map();
        const add = (nomeNorm, id) => {
          if (!nomeNorm) return;
          if (id != null) nomeParaId.set(nomeNorm, id);
          if (id != null) {
            if (!idParaNomes.has(id)) idParaNomes.set(id, []);
            idParaNomes.get(id).push(nomeNorm);
          }
        };
        try {
          (Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM medicos`) || []).forEach(m => {
            add(norm(m.nome_normalizado || m.nome_oficial), m.id);
          });
        } catch (e) {}
        try {
          (Banco.query(`SELECT grafia, grafia_normalizada, medico_id FROM sinonimos_medico`) || []).forEach(s => {
            add(norm(s.grafia_normalizada || s.grafia), s.medico_id);
          });
        } catch (e) {}
        for (const row of nomesPer) {
          const nn = norm(row.nome_normalizado);
          if (!nn) continue;
          set.add(nn);                                   // a própria grafia do Períodos
          const id = nomeParaId.get(nn);
          if (id != null && idParaNomes.has(id)) {
            idParaNomes.get(id).forEach(x => set.add(x)); // + todas as grafias do mesmo médico
          }
        }
      }
    } catch (e) { console.warn('[auditoria] setMedicosPeriodos', e); }
    _periodosCache = { comp, set };
    return set;
  }

  // ──────────────────────────────────────────────────────────────────────
  // REGRA ATLAS: CONSULTA paga pela PRODUÇÃO (médicos oftalmopediátricos)
  // Médicos cadastrados aqui têm as consultas de CONVÊNIO pagas pelo que
  // PRODUZIRAM no mês (linhas_producao), e não pelo QVIS. Cada consulta da
  // Produção vira UMA linha (mesmo padrão), valendo o valor cadastrado.
  // As consultas de convênio desses médicos vindas do QVIS são removidas.
  // ──────────────────────────────────────────────────────────────────────
  function cpGarantirTabelas() {
    Banco.executar(`CREATE TABLE IF NOT EXISTS config_consulta_producao (
      medico_id INTEGER PRIMARY KEY, valor REAL NOT NULL DEFAULT 0)`);
    Banco.executar(`CREATE TABLE IF NOT EXISTS config_consulta_producao_meta (
      chave TEXT PRIMARY KEY, valor TEXT)`);
    // V458: procedimentos por produção — cada procedimento = tags (AND) + 1 valor único.
    Banco.executar(`CREATE TABLE IF NOT EXISTS config_proc_producao (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tags TEXT NOT NULL, valor REAL NOT NULL DEFAULT 0)`);
    // Migração: se ainda não há procedimentos cadastrados, semeia "CONSULTA" com o valor
    // MAIS COMUM que estava por médico no modelo antigo (mantém o comportamento vigente).
    try {
      const n = Banco.queryUnica(`SELECT COUNT(*) AS n FROM config_proc_producao`);
      if (!n || !n.n) {
        let valorConsulta = 0;
        const vals = Banco.query(`SELECT valor FROM config_consulta_producao`) || [];
        if (vals.length) {
          const cont = {};
          vals.forEach(v => { const k = Number(v.valor) || 0; cont[k] = (cont[k] || 0) + 1; });
          valorConsulta = Number(Object.keys(cont).sort((a, b) => cont[b] - cont[a])[0]) || 0;
        }
        Banco.executar(`INSERT INTO config_proc_producao (tags, valor) VALUES (?, ?)`,
          [JSON.stringify(['CONSULTA']), valorConsulta]);
      }
    } catch (e) {}
  }
  function cpRegraAtiva() {
    try {
      cpGarantirTabelas();
      const r = Banco.queryUnica(`SELECT valor FROM config_consulta_producao_meta WHERE chave='ativo'`);
      return !!(r && String(r.valor) === '1');
    } catch (e) { return false; }
  }
  function cpMedicosConfig() {
    try {
      cpGarantirTabelas();
      return Banco.query(`SELECT c.medico_id, c.valor, m.nome_oficial, m.nome_normalizado
                            FROM config_consulta_producao c
                            JOIN medicos m ON m.id = c.medico_id
                           ORDER BY m.nome_oficial`) || [];
    } catch (e) { return []; }
  }
  // de-para: norm(qualquer grafia) → medico_id (oficial + sinônimos)
  function cpMapaNomeId() {
    const map = new Map();
    try {
      (Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM medicos`) || []).forEach(m => {
        const nn = norm(m.nome_normalizado || m.nome_oficial);
        if (nn) map.set(nn, m.id);
      });
    } catch (e) {}
    try {
      (Banco.query(`SELECT grafia, grafia_normalizada, medico_id FROM sinonimos_medico`) || []).forEach(s => {
        const nn = norm(s.grafia_normalizada || s.grafia);
        if (nn) map.set(nn, s.medico_id);
      });
    } catch (e) {}
    return map;
  }

  // V458: procedimentos cadastrados (tags AND + valor). Cacheia nada — leitura direta.
  function cpProcsConfig() {
    try {
      cpGarantirTabelas();
      return (Banco.query(`SELECT id, tags, valor FROM config_proc_producao ORDER BY id`) || []).map(r => {
        let tags = [];
        try { tags = JSON.parse(r.tags || '[]'); } catch (e) { tags = []; }
        return { id: r.id, tags: Array.isArray(tags) ? tags.map(t => String(t)) : [], valor: Number(r.valor) || 0 };
      });
    } catch (e) { return []; }
  }
  // Retorna o 1º procedimento cujas TODAS as tags estão contidas no texto (AND); senão null.
  function cpMatchProc(textoNorm, procs) {
    for (const p of procs) {
      if (!p.tags.length) continue;
      if (p.tags.every(t => { const tn = norm(t); return tn && textoNorm.includes(tn); })) return p;
    }
    return null;
  }

  function aplicarRegraConsultaProducao(linhas, comp) {
    if (!cpRegraAtiva()) return 0;
    const cfg = cpMedicosConfig();          // médicos participantes
    if (!cfg.length) return 0;
    const procs = cpProcsConfig().filter(p => p.tags.length);   // padrões: tags (AND) no PRODUTO + valor
    if (!procs.length) return 0;

    // O valor é POR PADRÃO/PROCEDIMENTO. A lista de médicos define só QUEM participa.
    const medicoIds = new Set(cfg.map(c => c.medico_id));
    const nomePorId = new Map();
    for (const c of cfg) nomePorId.set(c.medico_id, c.nome_oficial || '');
    const nomeId = cpMapaNomeId();
    const idCadastrado = (nome) => {
      const id = nomeId.get(norm(nome || ''));
      return (id != null && medicoIds.has(id)) ? id : null;
    };

    // Puxa as linhas de CONVÊNIO da Produção desses médicos (o match de tags é feito no JS).
    let prodRows = [];
    try {
      prodRows = Banco.query(
        `SELECT cod_admissao, data_admissao, paciente, convenio, tipo_recebimento,
                medico, procedimento_principal, produto, unidade, valor
           FROM linhas_producao
          WHERE competencia = ?
            AND UPPER(COALESCE(tipo_recebimento,'')) LIKE 'CONV%'
            AND medico IS NOT NULL AND TRIM(medico) <> ''`, [comp]) || [];
    } catch (e) { console.warn('[auditoria] proc-producao query', e); }

    // 1) Prepara a INJEÇÃO da Produção (com dedup) e registra quais (admissão|procedimento) TÊM
    //    produção — só isso autoriza remover o equivalente do QVIS.
    const vistos = new Set();
    const injetar = [];
    const temProducao = new Set();   // "admissao|proc.id"
    for (const p of prodRows) {
      const mid = idCadastrado(p.medico);
      if (mid == null) continue;
      const pr = String(p.produto || '').trim();
      const proc = cpMatchProc(norm(pr), procs);   // ★ busca SÓ na coluna PRODUTO
      if (!proc) continue;                          // produto não casa nenhum procedimento cadastrado
      const adm = String(p.cod_admissao || '').trim();
      temProducao.add(adm + '|' + proc.id);
      const chave = `${adm}|${mid}|${norm(pr)}|${norm(p.paciente || '')}`;
      if (vistos.has(chave)) continue;              // não duplica o mesmo PRODUTO na mesma admissão
      vistos.add(chave);
      injetar.push({
        id: `cp:${p.cod_admissao || ''}:${injetar.length}`,    // sintético (não colide com QVIS)
        cod_repasse: '',
        admissao: adm,
        nome_profissional: nomePorId.get(mid) || String(p.medico || ''),
        papel: 'MEDICO',
        procedimento: pr,                        // ★ exibe o PRODUTO (nome específico do exame/consulta)
        origem: 'CONVENIO',
        convenio: p.convenio || '',
        produzido: Number(p.valor) || 0,
        recebido: 0,
        competencia: comp,
        data_admissao: p.data_admissao || '',
        mes_pagamento: comp,
        paciente: p.paciente || '',
        classificacao: 'PRODUÇÃO',
        unidade_atendimento: p.unidade || '',
        _repasse: proc.valor || 0,                // ★ valor DO PADRÃO/PROCEDIMENTO casado
        _status: 'casou',
        _motivo: '',
        _fonteValor: 'producao',
        _ehConsultaProducao: true,        // marcador: passa direto, não re-analisa papéis
        _medicoId: mid,
        _medicoTipo: null,
        _papelId: null,
        _procOficial: null,
        _auditMotivo: 'Procedimento pago pela Produção',
      });
    }

    // 2) REMOVE do QVIS SOMENTE as linhas de convênio (deste mês) que TÊM produção correspondente
    //    (mesma admissão + mesmo procedimento). Sem substituto na Produção, a linha do QVIS é
    //    MANTIDA — o pagamento por produção é da competência do mês e NÃO anula os demais.
    for (let i = linhas.length - 1; i >= 0; i--) {
      const l = linhas[i];
      if (l._ehConsultaProducao) continue;
      if (!String(l.origem || '').toUpperCase().startsWith('CONV')) continue;   // SÓ convênio
      const mid = (l._medicoId != null && medicoIds.has(l._medicoId))
        ? l._medicoId : idCadastrado(l.nome_profissional);
      if (mid == null) continue;
      const pMatch = cpMatchProc(norm(l.procedimento || ''), procs);
      if (!pMatch) continue;
      if (!temProducao.has(String(l.admissao || '').trim() + '|' + pMatch.id)) continue;   // sem substituto → mantém
      linhas.splice(i, 1);
    }

    // 3) Injeta as linhas da Produção
    for (const linha of injetar) linhas.push(linha);
    return injetar.length;
  }

  // Aplica a regra sobre as linhas (zera o repasse do que a tela "Ajuste
  // Unidades" deixa DESMARCADO pro médico do Períodos).
  // V938: generalizada — antes era fixa no código (consulta de convênio fora da
  // Matriz). Agora o padrão continua o mesmo, mas a tela permite marcar/desmarcar
  // qualquer Unidade › Categoria › Procedimento × fonte (AtlasUnidadesRegras).
  // Unidade vazia ou sem cadastro conta como "Outras unidades" (fora da Matriz).
  function aplicarRegraPeriodosConsulta(linhas, comp) {
    const R = window.AtlasUnidadesRegras;
    if (!R) return 0;
    const periodos = setMedicosPeriodos(comp);
    if (!periodos.size) return 0;
    const unidades = qvisUnidadeMap();
    let n = 0;
    for (const l of linhas) {
      if ((Number(l._repasse) || 0) <= 0) continue;
      if (l._ehAuditoria || l._ehPacoteDetalhe || l._ehConsultaProducao) continue;  // só linhas reais do QVIS
      if (!periodos.has(norm(l.nome_profissional || ''))) continue;
      const uni = unidades.has(l.id) ? unidades.get(l.id) : norm(l.unidade_atendimento || '');
      const d = R.decidir({ unidade: uni, procNome: l._procOficial || '', nomeQvis: l.procedimento || '',
        classificacao: l.classificacao || '', origem: l.origem, medicoPeriodos: true });
      if (d.paga) continue;
      l._repasse = 0;
      l._auditRetidoUnidade = true;
      l._auditUnidadeRegra = d.motivo;
      l._procOriginal = l.procedimento;                  // guarda o original
      if (R.ehConsultaNome(l.procedimento, l.classificacao)) {
        l._auditConsultaForaMatriz = true;
        l.procedimento = 'CONSULTA FEITA EM UNIDADE';     // descrição explicativa pro médico (como sempre foi)
      }
      l._auditMotivo = (l._auditMotivo ? l._auditMotivo + ' · ' : '') + d.motivo;
      n++;
    }
    return n;
  }

  // REGRA ATLAS: o QVIS às vezes DUPLICA linhas de EXAME de CONVÊNIO — gera 2 linhas
  // idênticas de Executante e 2 de Indicante/Solicitante na mesma admissão (4 onde
  // deveriam ser 2). Mantém só 1 de cada (admissão + exame + papel + médico) e
  // remove as cópias. RESTRITO a: classificação = EXAME e fonte = CONVÊNIO,
  // e somente os papéis Executante e Indicante/Solicitante.
  function aplicarRegraDuplicidadeQvis(linhas) {
    const PAPEIS_ALVO = new Set(['Executante', 'Indicante', 'Solicitante']);
    const vistos = new Set();
    let removidos = 0;
    for (const l of linhas) {
      const cls = norm(l.classificacao || '');
      const fonte = norm(l.origem || '');
      if (!cls.startsWith('EXAME')) continue;        // só EXAMES
      if (!fonte.startsWith('CONV')) continue;       // só CONVÊNIO
      const papel = canonNomePapel(l);
      if (!PAPEIS_ALVO.has(papel)) continue;         // só Executante / Indicante / Solicitante
      const adm = normAdm(l.admissao || '');
      const procN = norm(l.procedimento || '');
      if (!adm || !procN) continue;
      const med = norm(l.nome_profissional || '');
      const key = `${adm}||${procN}||${papel}||${med}`;
      if (vistos.has(key)) {
        l._duplicidadeRemovida = true;               // cópia → marca pra remover
        removidos++;
      } else {
        vistos.add(key);                             // 1ª ocorrência → mantém
      }
    }
    if (removidos) {
      for (let i = linhas.length - 1; i >= 0; i--) {
        if (linhas[i]._duplicidadeRemovida) linhas.splice(i, 1);
      }
    }
    return removidos;
  }

  function auditar(snapshot, compOverride) {
    const compAtual = compOverride || state.competencia;
    // V132.23: papéis, BASE TABELA e PRODUÇÃO são cacheados enquanto a tela vive
    // (não mudam entre competências). Só recarregam ao reentrar na tela (montar).
    const P = lerPapeis();
    carregarBase();
    carregarProducaoNomes();   // V132.28: só os nomes na abertura (qtd/cat são lazy no Validador)
    carregarCirurgiaDatas();   // V132.31: datas de cirurgia (leve, só categoria Cirurgias)
    const linhasOrig = (snapshot && Array.isArray(snapshot.linhas)) ? snapshot.linhas : [];

    // Trabalhamos sobre cópias (não mutar o snapshot original em memória)
    const linhas = linhasOrig.map(l => Object.assign({}, l));

    // REGRA ATLAS: remove a DUPLICIDADE do QVIS em EXAMES de CONVÊNIO (linhas
    // idênticas repetidas de Executante/Indicante/Solicitante na mesma admissão).
    aplicarRegraDuplicidadeQvis(linhas);

    // REGRA ATLAS: médicos oftalmopediátricos cadastrados → CONSULTA de convênio
    // paga pela PRODUÇÃO (remove as do QVIS, injeta as da Produção).
    aplicarRegraConsultaProducao(linhas, compAtual);

    // REGRA ATLAS: médico do Períodos não recebe CONSULTA (e CONSULTA URGÊNCIA)
    // fora da Matriz → zera repasse.
    aplicarRegraPeriodosConsulta(linhas, compAtual);

    // Agrupa por (admissão + procedimento normalizado). Só interessa onde HÁ repasse.
    const grupos = new Map();   // key → { admissao, procNorm, procOficial, fonte, linhas:[], produzidoBase }
    for (const l of linhas) {
      // Só linhas REAIS com repasse entram na análise de papéis.
      // Glosa, procSemRegra, etc. são ignoradas; filhas de PACOTE também
      // (elas seguem na matriz, mas não contam como papel presente).
      const temRepasse = l._status === 'casou' && (Number(l._repasse) || 0) > 0;
      if (!temRepasse || l._ehPacoteDetalhe || l._ehConsultaProducao) continue;
      const admissao = l.admissao || '';
      const procNorm = norm(l.procedimento || '');
      if (!admissao || !procNorm) continue;
      const key = `${admissao}||${procNorm}`;
      if (!grupos.has(key)) {
        grupos.set(key, {
          admissao, procNorm,
          procOficial: l._procOficial || l.procedimento || '',
          fonte: fonteEfetiva(l),   // V222: respeita a tabela do Perfil Particular
          linhas: [], produzidoBase: 0,
        });
      }
      const g = grupos.get(key);
      g.linhas.push(l);
      const prod = Number(l.produzido) || 0;
      if (prod > g.produzidoBase) g.produzidoBase = prod;
      if (!g.procOficial && l._procOficial) g.procOficial = l._procOficial;
    }

    /**
     * V842: GRUPOS SÓ DE GLOSA — regra do usuário: "por mais que seja GLOSA as
     * linhas precisam ser criadas e as regras precisam ser cumpridas". A
     * admissão glosada passa a ser auditada como qualquer outra (o AUXILIAR vai
     * para o cirurgião, o SOLICITANTE vira INDICANTE, o INDICANTE ausente é
     * criado), mas sem UM CENTAVO de repasse: as filhas nascem zeradas e com o
     * status GLOSA (ver criarFilha).
     *
     * Guarda deliberada: só entram aqui os grupos (admissão + procedimento) que
     * NÃO têm nenhuma linha paga. Misturar glosa com pagamento no mesmo grupo
     * mudaria a contagem de jogos/papéis de uma admissão QUE FOI PAGA — e isso
     * mexeria em dinheiro. Grupo com pagamento continua exatamente como era.
     */
    {
      const soGlosa = new Map();
      for (const l of linhas) {
        if (l._status !== 'glosa') continue;
        if (l._ehPacoteDetalhe || l._ehConsultaProducao) continue;
        /**
         * V843: cálculo SALVO por versão antiga (pré-V842) tem a glosa sem
         * classificação — o motor da época descartava a linha antes de
         * resolver papel e procedimento. Resolve AQUI, na hora de auditar:
         * as regras valem sem precisar recalcular (mês consolidado tem o
         * ▶ Calcular travado de propósito e não pode ser pré-requisito).
         */
        if (l._papelId == null) {
          const n = norm(l.papel);
          let pid = P.mapQvis.get(n);
          // o texto pode já ser o NOME do papel ("AUXILIAR", "EXECUTANTE") —
          // o mapeamento_papeis só cobre as grafias do QVIS
          if (pid == null) { for (const [id, nome] of P.porId) { if (norm(nome) === n) { pid = id; break; } } }
          if (pid != null) l._papelId = pid;
        }
        if (l._papelId == null) continue;
        const admissao = l.admissao || '';
        const procNorm = norm(l.procedimento || '');
        if (!admissao || !procNorm) continue;
        const key = `${admissao}||${procNorm}`;
        if (grupos.has(key)) continue;   // grupo COM pagamento manda — nada muda nele
        if (!soGlosa.has(key)) {
          soGlosa.set(key, {
            admissao, procNorm,
            procOficial: l._procOficial || l.procedimento || '',
            fonte: fonteEfetiva(l),
            linhas: [], produzidoBase: 0, _soGlosa: true,
          });
        }
        const g = soGlosa.get(key);
        g.linhas.push(l);
        const prod = Number(l.produzido) || 0;
        if (prod > g.produzidoBase) g.produzidoBase = prod;
        if (!g.procOficial && l._procOficial) g.procOficial = l._procOficial;
      }
      for (const [key, g] of soGlosa) grupos.set(key, g);
    }

    const novasFilhas = [];
    const notificacoes = [];
    let nRenomeados = 0;

    // ── V132.34: colapsa "PACOTE X" + "X" (mesma PALAVRA-CHAVE de cirurgia, mesma
    // admissão+dia). A equivalência usa a LISTA de palavras-chave (FACECTOMIA,
    // CAPSULOTOMIA, ...) que o usuário mantém — a palavra pode estar em qualquer
    // posição do nome. Só dispara quando a PRODUÇÃO confirma cirurgia (categoria
    // Cirurgias). Regra: some o CONJUNTO inteiro do NÃO-PACOTE; fica o do PACOTE. ──
    {
      const porChaveProc = new Map();   // `${adm}|${raiz}|${dia}` → { pacotes:[], naoPacotes:[] }
      for (const g of grupos.values()) {
        const raiz = raizCirurgia(g.procNorm);
        if (!raiz) continue;                       // não é cirurgia da lista
        const datasCir = mapCirurgiaDatas.get(normAdm(g.admissao));
        if (!datasCir || !datasCir.size) continue;  // Produção não confirma cirurgia
        const dia = soData((g.linhas[0] && g.linhas[0].data_admissao) || '');
        const ch = `${g.admissao}|${raiz}|${dia}`;
        let e = porChaveProc.get(ch);
        if (!e) { e = { pacotes: [], naoPacotes: [] }; porChaveProc.set(ch, e); }
        if (/\bPACOTE\b/.test(g.procNorm)) e.pacotes.push(g);
        else e.naoPacotes.push(g);
      }
      for (const e of porChaveProc.values()) {
        // só colapsa quando há AS DUAS versões (pacote E não-pacote) da mesma raiz/dia
        if (e.pacotes.length >= 1 && e.naoPacotes.length >= 1) {
          for (const g of e.naoPacotes) {
            g._colapsadoPacote = true;
            for (const l of g.linhas) l._removerDuplicidade = true;
          }
        }
      }
    }

    for (const g of grupos.values()) {
      if (g._colapsadoPacote) continue;   // V132.32: não-pacote absorvido pelo PACOTE
      const procId = procIdDeOficial(g.procOficial);
      if (procId == null) {
        // sem procedimento reconhecido na BASE — não dá pra auditar papéis
        continue;
      }
      const fonte = g.fonte || 'CONVENIO';
      // V563: data de admissão do grupo → versão da tabela vigente nela
      const dataAdmGrupo = (g.linhas[0] && g.linhas[0].data_admissao) || '';
      const exigidos = papeisExigidos(procId, fonte, dataAdmGrupo);
      if (!exigidos.length) continue;

      // V132.17: contagem de linhas por papel (não só presença) — pra replicar
      // as filhas conforme a quantidade de jogos do grupo.
      const contaPorPapel = new Map();
      for (const l of g.linhas) {
        if (l._papelId == null) continue;
        contaPorPapel.set(l._papelId, (contaPorPapel.get(l._papelId) || 0) + 1);
      }
      const presentes = new Set(contaPorPapel.keys());

      // nº de "jogos" do grupo = nº de linhas de EXECUTANTE (cada execução repetida
      // no QVIS = 1 jogo). As linhas-filhas de papéis ausentes acompanham essa qtd.
      let executantes = g.linhas.filter(l => l._papelId === P.idExecutante);
      let nJogos = Math.max(1, executantes.length);

      // ── V132.31: admissão CIRÚRGICA → nº de jogos = nº de DATAS distintas de
      // cirurgia na Produção. Numa cirurgia, 1 dia = 1 executante; o QVIS às vezes
      // duplica executantes no MESMO dia (impossível na vida real → duplicidade).
      // Em DIAS diferentes, são cirurgias legítimas distintas (cada uma = 1 jogo).
      // Só dispara quando a Produção confirma cirurgia (Set de datas não-vazio). ──
      const _datasCir = mapCirurgiaDatas.get(normAdm(g.admissao));
      if (_datasCir && _datasCir.size >= 1 && executantes.length > _datasCir.size) {
        const comNome = executantes.filter(l => (l.nome_profissional || '').trim());
        const semNome = executantes.filter(l => !(l.nome_profissional || '').trim());
        const manter = new Set(comNome.concat(semNome).slice(0, _datasCir.size));
        for (const l of executantes) {
          if (!manter.has(l)) {
            l._removerDuplicidade = true;
            contaPorPapel.set(l._papelId, Math.max(0, (contaPorPapel.get(l._papelId) || 1) - 1));
          }
        }
        executantes = executantes.filter(l => manter.has(l));
        nJogos = Math.max(1, executantes.length);
      }

      const linhaExec = executantes[0] || null;
      // V132.21: nome do cirurgião — do QVIS; se ausente/vazio, busca na Produção.
      let nomeCirurgiao = linhaExec ? (linhaExec.nome_profissional || '') : '';
      if (!nomeCirurgiao.trim()) nomeCirurgiao = cirurgiaoProducao(g.admissao);

      // ── V132.20: Indicante/Solicitante = UM por jogo (executante). Se o QVIS
      // trouxe MAIS indicantes/solicitantes que executantes, o excedente é
      // duplicidade indevida e some da matriz (mesmo vindo do QVIS). ──
      {
        const linhasIndSol = g.linhas.filter(l => l._papelId === P.idIndicante || l._papelId === P.idSolicitante);
        if (linhasIndSol.length > nJogos) {
          // mantém as primeiras, preferindo as que têm nome
          const comNome = linhasIndSol.filter(l => (l.nome_profissional || '').trim());
          const semNome = linhasIndSol.filter(l => !(l.nome_profissional || '').trim());
          const manter = new Set(comNome.concat(semNome).slice(0, nJogos));
          for (const l of linhasIndSol) {
            if (!manter.has(l)) {
              l._removerDuplicidade = true;
              contaPorPapel.set(l._papelId, Math.max(0, (contaPorPapel.get(l._papelId) || 1) - 1));
            }
          }
        }
      }

      // ── V132.30: AUXILIAR também segue o nº de executantes (cada auxiliar
      // acompanha um executante). O QVIS às vezes DUPLICA a linha do auxiliar
      // (mesmo nome/valor repetido). O excedente além do nº de executantes é
      // duplicidade indevida do QVIS e some da matriz. ──
      if (P.idAuxiliar != null) {
        const linhasAux = g.linhas.filter(l => l._papelId === P.idAuxiliar);
        if (linhasAux.length > nJogos) {
          const comNome = linhasAux.filter(l => (l.nome_profissional || '').trim());
          const semNome = linhasAux.filter(l => !(l.nome_profissional || '').trim());
          const manter = new Set(comNome.concat(semNome).slice(0, nJogos));
          for (const l of linhasAux) {
            if (!manter.has(l)) {
              l._removerDuplicidade = true;
              contaPorPapel.set(l._papelId, Math.max(0, (contaPorPapel.get(l._papelId) || 1) - 1));
            }
          }
        }
      }

      // ── REGRA: linha ORIGINAL de SOLICITANTE sem INDICANTE → exibe como INDICANTE ──
      // (só existe um dos dois; o padrão de exibição é sempre Indicante)
      if (P.idSolicitante != null && P.idIndicante != null && !presentes.has(P.idIndicante)) {
        const rotuloInd = P.porId.get(P.idIndicante) || 'Indicante';
        for (const l of g.linhas) {
          if (l._papelId === P.idSolicitante) {
            l._auditPapelOriginal = l.papel;
            l.papel = rotuloInd;
            l._papelId = P.idIndicante;
            l._auditPapelTrocado = true;
          }
        }
      }

      // ── REGRA: auxiliar presente mas divergente do cirurgião → renomeia ──
      if (P.idAuxiliar != null && nomeCirurgiao) {
        for (const l of g.linhas) {
          if (l._papelId === P.idAuxiliar && norm(l.nome_profissional) !== norm(nomeCirurgiao)) {
            l._auditNomeOriginal = l.nome_profissional;
            l.nome_profissional = nomeCirurgiao;
            l._auditRenomeado = true;
            nRenomeados++;
          }
        }
      }

      // ── V132.21: executante do QVIS SEM NOME → preenche pelo cirurgião da Produção ──
      if (P.idExecutante != null && nomeCirurgiao) {
        for (const l of g.linhas) {
          if (l._papelId === P.idExecutante && !(l.nome_profissional || '').trim()) {
            l.nome_profissional = nomeCirurgiao;
            l._auditNomePreenchido = true;
          }
        }
      }

      // helper local: monta e empilha uma linha-filha
      function criarFilha(opts) {
        // opts: { papelIdRegra, papelIdTag, nomeExibido, nomeProf, notificar, motivo, sufixo }
        const regra = regraDe(procId, opts.papelIdRegra, fonte, dataAdmGrupo);
        // V816: a linha de AJUSTE registra a VERSÃO da tabela que a regra usou
        // (mesma resolução por data da admissão) — antes a coluna V.TAB saía
        // vazia nas filhas e não dava para saber de onde veio o valor.
        const vFilha = versaoDaData(dataAdmGrupo);
        let repasse = 0;
        if (regra) {
          if (regra.valor != null) repasse = Number(regra.valor) || 0;
          else if (regra.percentual != null) repasse = (g.produzidoBase || 0) * (Number(regra.percentual) || 0);
        }
        /**
         * V842: grupo GLOSADO — a linha é criada (a regra tem que ser cumprida
         * e ficar visível), mas o convênio não pagou a admissão: o repasse vai
         * ZERADO e a linha carrega o status GLOSA. O valor que a regra daria
         * fica guardado em _repasseRegra, só para o export natural da glosa
         * (V531) — nenhum total da ferramenta soma este número.
         */
        const ehGlosa = !!g._soGlosa;
        const repasseRegra = repasse;
        if (ehGlosa) repasse = 0;
        const filha = {
          id: `audit-${g.admissao}-${procId}-${opts.sufixo}`,
          admissao: g.admissao,
          data_admissao: (g.linhas[0] && g.linhas[0].data_admissao) || '',
          nome_profissional: opts.nomeProf || '',
          papel: opts.nomeExibido,
          procedimento: (g.linhas[0] && g.linhas[0].procedimento) || g.procOficial,
          origem: fonte,
          convenio: (g.linhas[0] && g.linhas[0].convenio) || '',
          produzido: 0,
          recebido: 0,
          _repasse: repasse,
          // V842: glosa nunca herda o visual ATLAS (que soma nos totais) —
          // ela é uma linha GLOSA, zerada, como as demais da admissão
          _status: ehGlosa ? 'glosa' : 'pacoteDetalhe',   // reusa o status ATLAS (cinza)
          _motivo: ehGlosa ? 'Recebido = R$ 0,00 (glosa do convênio) — linha criada pela regra, sem repasse' : '',
          _papelId: opts.papelIdTag,
          _procOficial: g.procOficial,
          _ehAuditoria: true,
          _ehPacoteDetalhe: !ehGlosa,     // herda tag/visual ATLAS
          _ehAuditoriaGlosa: ehGlosa,     // V842
          _repasseRegra: ehGlosa ? repasseRegra : undefined,   // V842/V531: só p/ o export de glosa
          _papelFaltante: true,
          // V847: em admissão GLOSADA a filha não é pendência — o status dela
          // acompanha a admissão (tag GLOSA), como pediu o usuário
          _auditNotificar: !!opts.notificar && !ehGlosa,
          _auditMotivo: opts.motivo || '',
          _versaoTabela: vFilha ? vFilha.numero : undefined,   // V816
        };
        // V844: linha exibida com um TEXTO no lugar do profissional, mas cujo
        // valor pertence a um médico REAL (indicante não informado → executante)
        if (opts.medicoReal) filha._medicoReal = opts.medicoReal;
        // V842: a linha glosada é criada, mas NÃO vira pendência para tratar —
        // ela não tem efeito financeiro nenhum e encheria o painel de avisos
        // com admissões que o convênio não pagou. O motivo continua na própria
        // linha da matriz (coluna de observação), onde faz sentido lê-lo.
        if (opts.notificar && !ehGlosa) {
          notificacoes.push({
            admissao: g.admissao,
            procedimento: g.procOficial,
            papel: opts.nomeExibido,
            motivo: opts.motivo || '',
          });
        }
        novasFilhas.push(filha);
      }

      const nomeIndicante = P.porId.get(P.idIndicante) || 'Indicante';

      // ── papéis exigidos e AUSENTES → uma linha-filha POR JOGO faltante ──
      // INDICANTE/SOLICITANTE são o MESMO papel (tratados abaixo).
      // Para cada papel, faltam = nº de jogos − quantos já existem no QVIS.
      for (const papelId of exigidos) {
        if (papelId === P.idIndicante || papelId === P.idSolicitante) continue;
        const nomePapel = P.porId.get(papelId) || `Papel ${papelId}`;
        const jaTem = contaPorPapel.get(papelId) || 0;
        const faltam = Math.max(0, nJogos - jaTem);

        for (let i = 0; i < faltam; i++) {
          if (papelId === P.idAuxiliar) {
            // cada auxiliar acompanha um executante (nome do executante correspondente)
            const exec = executantes[jaTem + i] || linhaExec;
            const nomeAux = (exec && (exec.nome_profissional || '').trim()) ? exec.nome_profissional : nomeCirurgiao;
            if (nomeAux) {
              criarFilha({ papelIdRegra: papelId, papelIdTag: papelId, nomeExibido: nomePapel,
                           nomeProf: nomeAux, sufixo: `${papelId}-${i}` });
            } else {
              criarFilha({ papelIdRegra: papelId, papelIdTag: papelId, nomeExibido: nomePapel,
                           nomeProf: '', notificar: true,
                           motivo: 'Auxiliar exigido pela BASE TABELA, mas o procedimento não tem linha de CIRURGIÃO — não há a quem atribuir o valor.',
                           sufixo: `${papelId}-${i}` });
            }
          } else if (papelId === P.idExecutante) {
            // V132.21: executante ausente no QVIS → nome do cirurgião da Produção
            if (nomeCirurgiao) {
              criarFilha({ papelIdRegra: papelId, papelIdTag: papelId, nomeExibido: nomePapel,
                           nomeProf: nomeCirurgiao, sufixo: `${papelId}-${i}` });
            } else {
              criarFilha({ papelIdRegra: papelId, papelIdTag: papelId, nomeExibido: nomePapel,
                           nomeProf: '', notificar: true,
                           motivo: `Executante exigido e ausente no QVIS — a Produção também não tem cirurgião/médico pra admissão ${g.admissao}.`,
                           sufixo: `${papelId}-${i}` });
            }
          } else {
            // outros papéis faltantes (ex.: Médico Laudo) — sem regra de preenchimento automático
            criarFilha({ papelIdRegra: papelId, papelIdTag: papelId, nomeExibido: nomePapel,
                         nomeProf: '', notificar: true,
                         motivo: `${nomePapel} exigido pela BASE TABELA e ausente no QVIS (sem regra de preenchimento automático).`,
                         sufixo: `${papelId}-${i}` });
          }
        }
      }

      // ── INDICANTE/SOLICITANTE unificado → uma filha POR JOGO faltante ──
      const exigeIndSol = exigidos.includes(P.idIndicante) || exigidos.includes(P.idSolicitante);
      if (exigeIndSol) {
        const jaTemIndSol = (contaPorPapel.get(P.idIndicante) || 0) + (contaPorPapel.get(P.idSolicitante) || 0);
        const faltamIndSol = Math.max(0, nJogos - jaTemIndSol);
        if (faltamIndSol > 0) {
          // regra de valor: usa a do Indicante; se não houver, a do Solicitante (mesmo valor, não soma)
          const papelRegra = regraDe(procId, P.idIndicante, fonte, dataAdmGrupo) ? P.idIndicante : P.idSolicitante;
          const is = indicanteSolicitante(g.admissao);
          const nomeProf = is.indicante || is.solicitante || '';
          for (let i = 0; i < faltamIndSol; i++) {
            if (nomeProf) {
              criarFilha({ papelIdRegra: papelRegra, papelIdTag: P.idIndicante, nomeExibido: nomeIndicante,
                           nomeProf, sufixo: `indsol-${i}` });
            } else if (nomeCirurgiao) {
              /**
               * V844 (regra do usuário): indicante NÃO informado no sistema →
               * o valor do indicante vai para o próprio EXECUTANTE. Na coluna
               * PROFISSIONAL sai o texto fixo (a notificação fica no papel);
               * quem recebe de verdade fica em _medicoReal — é ele que vale no
               * filtro interno/híbrido, no arquivo por médico e nos totais.
               */
              criarFilha({ papelIdRegra: papelRegra, papelIdTag: P.idIndicante, nomeExibido: nomeIndicante,
                           nomeProf: 'INDICANTE NÃO INFORMADO NO SISTEMA',
                           medicoReal: nomeCirurgiao, notificar: true,
                           motivo: `Indicante não informado no sistema — o valor do indicante foi repassado ao executante (${nomeCirurgiao}).`,
                           sufixo: `indsol-${i}` });
            } else {
              criarFilha({ papelIdRegra: papelRegra, papelIdTag: P.idIndicante, nomeExibido: nomeIndicante,
                           nomeProf: '', notificar: true,
                           motivo: `Indicante exigido, mas a Produção não tem indicante nem solicitante pra admissão ${g.admissao} (nem cirurgião a quem atrelar).`,
                           sufixo: `indsol-${i}` });
            }
          }
        }
      }
    }

    // monta a matriz final: só os status que o usuário quer auditar —
    // REPASSADO (casou), GLOSA (glosa) e ATLAS (filhas da auditoria ou de pacote).
    // Duplicidade, "Novo", "S/Regra" e "Retirado" NÃO entram na Auditoria.
    // Também remove o excedente de indicante/solicitante (duplicidade indevida).
    const ehAtlas = (l) => l._ehAuditoria || l._ehPacoteDetalhe || l._status === 'pacoteDetalhe';
    const entraNaAuditoria = (l) => l._status === 'casou' || l._status === 'glosa' || ehAtlas(l);
    const todas = linhas
      .filter(l => !l._removerDuplicidade && entraNaAuditoria(l))
      .concat(novasFilhas);
    // papel canônico em todas as linhas (Executante/Auxiliar/Indicante/Solicitante/Médico Laudo)
    for (const l of todas) {
      l._papelCanon = canonNomePapel(l);
    }

    // totais
    const totRepasse = todas
      .filter(l => l._status === 'casou' || l._ehPacoteDetalhe)
      .reduce((s, l) => s + (Number(l._repasse) || 0), 0);

    return {
      linhas: todas,
      notificacoes,
      stats: {
        nOriginais: linhasOrig.length,
        nFilhasAudit: novasFilhas.length,
        nRenomeados,
        nNotificacoes: notificacoes.length,
        totRepasse,
        nGruposAuditados: grupos.size,
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // SNAPSHOT
  // ──────────────────────────────────────────────────────────────────────
  function competenciasDisponiveis() {
    try {
      // V600: só cálculos salvos de meses com QVIS IMPORTADO — um snapshot
      // antigo de um mês cujo QVIS foi excluído (mas que ainda tem Produção)
      // não aparece mais no seletor (pedido do usuário: competências do
      // repasse são baseadas no relatório do QVIS).
      const r = Banco.query(
        `SELECT s.competencia FROM repasse_snapshot s
          WHERE EXISTS (SELECT 1 FROM linhas_qvis q WHERE q.mes_pagamento = s.competencia)
          ORDER BY s.competencia DESC`
      ) || [];
      // V132.26: a Auditoria trabalha sempre por MÊS específico. O snapshot
      // agregado "TODAS" (gerado no Cálculo) é gigante e travava a abertura —
      // por isso é excluído aqui.
      return r.map(x => x.competencia).filter(c => c && c !== '0000-00' && norm(c) !== 'TODAS');
    } catch (e) { return []; }
  }

  function lerSnapshot(competencia) {
    if (!competencia) return null;
    try {
      const r = Banco.query(
        `SELECT resultado_json FROM repasse_snapshot WHERE competencia = ? LIMIT 1`,
        [competencia]
      );
      if (!r || !r[0]) return null;
      return JSON.parse(Banco.snapUnpack ? Banco.snapUnpack(r[0].resultado_json) : r[0].resultado_json);
    } catch (e) {
      console.error('[auditoria] erro ao ler snapshot:', e);
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────
  // V597: os caches só são zerados quando o BANCO mudou desde a última visita
  // (Banco._versao carimba toda gravação — recálculo salvo, edição na Base,
  // importação…). Antes, TODA entrada na tela re-auditava o mês inteiro mesmo
  // sem nenhuma mudança — a "demora" ao abrir a Auditoria.
  let _montarVersao = -1;
  function montar() {
    garantirSchemaHonorario();   // V239
    // inicializa/valida a competência (nunca "TODAS" — ver competenciasDisponiveis)
    const comps = competenciasDisponiveis();
    if (!state.competencia || !comps.includes(state.competencia)) {
      state.competencia = comps.length ? comps[0] : null;
    }
    const v = Banco._versao || 0;
    if (_montarVersao !== v) {
      // V132.11: invalida o cache — reflete recálculo/edições desde a última visita
      state._auditKey = null;
      state._datalists = null;
      // V132.23: recarrega papéis, BASE TABELA e PRODUÇÃO
      cachePapeis = null;
      baseProcOficial = null; baseProcNorm = null; baseRegras = null; baseExigidos = null;
      mapProducao = null;
      mapProducaoQtd = null;
      mapProducaoCat = null;
      mapCirurgiaDatas = null;
      palavrasCirurgia = null;
      _qvisUnidadeMap = null;
      _periodosCache = { comp: null, set: null };
      _montarVersao = v;
      _cachesBaseVersao = v;   // V859: acabaram de ser zerados nesta versão
    }
    renderizar();
  }

  function recomputar() {
    // V132.14: 'repasse' e 'validador' usam o MESMO resultado auditado.
    if (state.secao !== 'repasse' && state.secao !== 'validador') { state.resultado = null; return; }
    // V132.11: só re-audita quando a competência muda. Os filtros (busca*) e a
    // troca repasse↔validador NÃO re-auditam — re-auditar a cada tecla travava o app.
    const key = `audit|${state.competencia}`;
    if (state._auditKey === key && state.resultado) return;
    const snap = lerSnapshot(state.competencia);
    state.resultado = snap ? auditar(snap) : null;
    state._auditKey = key;
    state._datalists = null;   // invalida os datalists memoizados
  }

  // ── Comboboxes de filtro (idênticos ao relatório de repasse) ──
  const mapKeyState = {
    admissao: 'buscaAdmissao', profissional: 'buscaProfissional',
    procedimento: 'buscaProcedimento', convenio: 'buscaConvenio',
  };
  // V493: mapas de apoio do render parcial (key do combo → id do input / datalist).
  // mapIdInput saiu de bindCorpo() pro escopo do módulo — o listener delegado usa.
  const mapIdInput = {
    'aud-busca-adm':  'buscaAdmissao',
    'aud-busca-prof': 'buscaProfissional',
    'aud-busca-proc': 'buscaProcedimento',
    'aud-busca-conv': 'buscaConvenio',
  };
  const mapKeyInputId = {
    admissao: 'aud-busca-adm', profissional: 'aud-busca-prof',
    procedimento: 'aud-busca-proc', convenio: 'aud-busca-conv',
  };
  const mapKeyDatalist = {
    admissao: 'adm', profissional: 'prof', procedimento: 'proc', convenio: 'conv',
  };
  const LIMITE_TABELA = 600;   // V493: era `LIMITE` local de renderSecaoRepasse

  // V493: botão "×" do combo de texto — template único (render completo + parcial).
  function comboXBtnHtml(id) {
    return `<button type="button" class="calc-fil-x" data-fil-x-input="${id}" title="Limpar este filtro">×</button>`;
  }

  // V493: <ul> de opções do combo de texto — extraído de renderFiltroCombo pra
  // ser reusado pelo renderParcialFiltros (mesmo markup, agora com id estável).
  function comboUlHtml(key, valor, opcoes) {
    // V903: opções em CHECKBOX — marcados pinados no topo; o texto digitado
    // só procura nas demais (mesmo desenho do Calcular Repasse)
    const sel = (state.multiSel[key] || []);
    const selSet = new Set(sel);
    const b = norm(valor);
    const restantes = opcoes.filter(o => !selSet.has(o));
    const filtradas = !b ? restantes : restantes.filter(o => norm(o).includes(b));
    const LIMITE = 200;
    const exibir = filtradas.slice(0, LIMITE);
    if (sel.length === 0 && exibir.length === 0) {
      return `<ul class="calc-fil-opcoes" id="aud-fil-opcoes-${key}"><li class="calc-fil-opt-mais">Nenhuma sugestão correspondente.</li></ul>`;
    }
    const item = (o, marcado) => `
                <li class="calc-fil-opt ${marcado ? 'calc-fil-opt-ativa' : ''}"
                    data-fil-opt-key="${key}" data-fil-opt-valor="${esc(o)}" role="option" aria-selected="${marcado}">
                  <span class="calc-fil-opt-cbx ${marcado ? 'on' : ''}">${marcado ? '✓' : ''}</span>
                  <span class="calc-fil-opt-texto">${esc(o)}</span>
                </li>`;
    return `
            <ul class="calc-fil-opcoes" id="aud-fil-opcoes-${key}" role="listbox">
              ${sel.map(o => item(o, true)).join('')}
              ${sel.length && exibir.length ? '<li class="calc-fil-opt-mais calc-fil-opt-separa"></li>' : ''}
              ${exibir.map(o => item(o, false)).join('')}
              ${filtradas.length > exibir.length ? `
                <li class="calc-fil-opt-mais">+${filtradas.length - exibir.length} sugestões — continue digitando pra refinar</li>
              ` : ''}
            </ul>
          `;
  }

  function renderFiltroCombo(label, id, key, placeholder, valor, opcoes) {
    const sel = (state.multiSel[key] || []);   // V903
    const ativo = !!valor || sel.length > 0;
    const aberto = state.dropAberto === key;
    const ph = sel.length && !valor
      ? `${sel.length} selecionado${sel.length > 1 ? 's' : ''}` : placeholder;
    return `
      <div class="calc-filtro-grupo">
        <label class="calc-filtro-label" for="${id}">${label}</label>
        <div class="calc-fil-input-wrap ${ativo ? 'calc-fil-ativo' : ''} ${aberto ? 'calc-fil-combo-aberto' : ''}">
          <span class="calc-fil-icone">🔎</span>
          <input type="text" id="${id}" class="calc-fil-input"
                 placeholder="${esc(ph)}"
                 value="${esc(valor)}" autocomplete="off"
                 data-fil-input="${key}">
          ${ativo ? comboXBtnHtml(id) : ''}
          <button type="button" class="calc-fil-caret-btn" data-fil-toggle-input="${key}" tabindex="-1" title="Mostrar opções">
            <span class="calc-fil-caret">▾</span>
          </button>
          ${aberto ? comboUlHtml(key, valor, opcoes) : ''}
        </div>
      </div>
    `;
  }

  // V903: rótulo do drop multi — nada = default; 1 = o nome; N = contagem
  function rotuloDrop(sel, opcoes, valorDefault) {
    if (!sel.length) return (opcoes.find(o => o.v === valorDefault) || opcoes[0]).l;
    if (sel.length === 1) return (opcoes.find(o => o.v === sel[0]) || { l: sel[0] }).l;
    return `${sel.length} selecionados`;
  }
  function renderFiltroDrop(label, key, valorAtual, valorDefault, opcoes) {
    const sel = selDe(valorAtual, valorDefault);   // V903: multi
    const ativo = sel.length > 0;
    const aberto = state.dropAberto === key;
    return `
      <div class="calc-filtro-grupo">
        <label class="calc-filtro-label">${label}</label>
        <div class="calc-fil-combo ${aberto ? 'calc-fil-combo-aberto' : ''} ${ativo ? 'calc-fil-ativo' : ''}" data-fil-combo="${key}">
          <button type="button" class="calc-fil-display" data-fil-toggle="${key}">
            <span class="calc-fil-icone">🔎</span>
            <span class="calc-fil-valor">${esc(rotuloDrop(sel, opcoes, valorDefault))}</span>
            ${ativo ? `<span class="calc-fil-x-wrap" data-fil-x-drop="${key}" title="Limpar">×</span>` : ''}
            <span class="calc-fil-caret">▾</span>
          </button>
          ${aberto ? `
            <ul class="calc-fil-opcoes" role="listbox">
              ${opcoes.map(o => {
                const ehDefault = o.v === valorDefault;
                const marcado = ehDefault ? sel.length === 0 : sel.includes(o.v);
                return `
                <li class="calc-fil-opt ${marcado ? 'calc-fil-opt-ativa' : ''}"
                    data-fil-opt-key="${key}" data-fil-opt-valor="${esc(o.v)}" role="option" aria-selected="${marcado}">
                  <span class="calc-fil-opt-cbx ${marcado ? 'on' : ''}">${marcado ? '✓' : ''}</span>
                  <span>${esc(o.l)}</span>
                </li>`;
              }).join('')}
            </ul>
          ` : ''}
        </div>
      </div>
    `;
  }

  // ── V734: fileira de filtros 20C (padrão desempenho_lio, prefixo aud-sb) ──
  // O único filtro do header é a competência ("Mês do cálculo") — o antigo
  // <select id="aud-competencia"> virou a célula Competência. Painel abre e
  // fecha LOCAL (insertAdjacentHTML, zero re-render); aplicar seta a MESMA
  // chave de state (state.competencia) e chama o MESMO renderizar() de antes.
  function _audSbIc(nome) {
    return {
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      check: '<polyline points="20 6 9 17 4 12"/>',
      chev: '<polyline points="6 9 12 15 18 9"/>',
    }[nome] || '';
  }
  function _audSbSvg(d, px, sw) {
    return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  function _audSbSemAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function renderBarraFiltrosAud20C(comps) {
    // guarda as opções pro painel abrir LOCAL depois, sem recoletar
    state._sbComps = comps.slice();
    const valor = state.competencia || '';
    const estaAberta = state.sbAberto === 'competencia';
    return `
      <div class="aud-sb" id="aud-sb">
        <div class="aud-sb-celwrap" style="flex:1">
          <button type="button" class="aud-sb-cel ${valor ? 'ativo' : ''} ${estaAberta ? 'aberta' : ''}"
                  data-sb-cel="competencia" data-sb-vazio="— sem cálculos salvos —" role="combobox"
                  aria-expanded="${estaAberta ? 'true' : 'false'}" aria-haspopup="listbox"
                  title="Competência do cálculo salvo que a Auditoria vai ler">
            <span class="aud-sb-tile">${_audSbSvg(_audSbIc('calendar'), 14, 2.1)}</span>
            <span class="aud-sb-tx">
              <span class="aud-sb-rot">Mês do cálculo</span>
              <span class="aud-sb-val">${esc(valor || '— sem cálculos salvos —')}</span>
            </span>
            <span class="aud-sb-chev">${_audSbSvg(_audSbIc('chev'), 10, 2.8)}</span>
          </button>
          ${estaAberta ? painelAud20C('competencia') : ''}
        </div>
      </div>`;
  }
  function painelAud20C(id) {
    const comps = state._sbComps || [];
    const item = (val, rotulo, sel) => `
      <div class="aud-sb-it ${sel ? 'sel' : ''}" data-sb-item data-val="${esc(val)}" data-busca="${esc(_audSbSemAcento(rotulo))}" role="option" aria-selected="${sel ? 'true' : 'false'}">
        <span class="aud-sb-it-nome">${esc(rotulo)}</span>
        ${sel ? `<span class="aud-sb-ck">${_audSbSvg(_audSbIc('check'), 14, 2.5)}</span>` : ''}
      </div>`;
    // a Auditoria trabalha sempre por MÊS específico (nunca "TODAS") — sem
    // item "Todos": as opções são exatamente as do antigo select
    return `
      <div class="aud-sb-painel" data-sb-painel="${id}">
        <div class="aud-sb-lista" role="listbox">
          ${comps.length
            ? comps.map(c => item(c, c, state.competencia === c)).join('')
            : '<div class="aud-sb-vazio">— sem cálculos salvos —</div>'}
        </div>
      </div>`;
  }
  function bindBarraFiltrosAud20C() {
    const sb = document.getElementById('aud-sb');
    if (!sb) return;
    const fecharPainelLocal = () => {
      sb.querySelectorAll('.aud-sb-painel').forEach(p => p.remove());
      sb.querySelectorAll('.aud-sb-cel.aberta').forEach(c => { c.classList.remove('aberta'); c.setAttribute('aria-expanded', 'false'); });
      state.sbAberto = null;
    };
    const aplicar = (celId, val) => {
      fecharPainelLocal();
      if (!val || val === state.competencia) return;   // nada mudou — só fecha
      // MESMO fluxo do change do antigo #aud-competencia
      state.competencia = val;
      renderizar();
    };
    const abrirPainelLocal = (id) => {
      const jaAberto = state.sbAberto === id;
      fecharPainelLocal();
      if (jaAberto) return;
      state.sbAberto = id;
      const btn = sb.querySelector(`[data-sb-cel="${id}"]`);
      btn.classList.add('aberta');
      btn.setAttribute('aria-expanded', 'true');
      btn.parentElement.insertAdjacentHTML('beforeend', painelAud20C(id));
    };
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
      const painel = sb.querySelector('.aud-sb-painel');
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
    if (window.__audSbFechar) {
      document.removeEventListener('click', window.__audSbFechar);
      document.removeEventListener('keydown', window.__audSbEsc);
    }
    const fecharFora = (e) => {
      if (App.telaAtual !== 'auditoria') return;
      if (state.sbAberto && !e.target.closest('#aud-sb')) fecharPainelLocal();
    };
    const escFecha = (e) => { if (e.key === 'Escape' && state.sbAberto) fecharPainelLocal(); };
    window.__audSbFechar = fecharFora;
    window.__audSbEsc = escFecha;
    document.addEventListener('click', fecharFora);
    document.addEventListener('keydown', escFecha);
  }

  function renderizar() {
    const conteudo = document.getElementById('conteudo');
    if (!conteudo) return;

    const comps = competenciasDisponiveis();

    // V492: CSS injetado uma única vez no <head> (antes ia dentro do innerHTML
    // a cada render, forçando re-parse de ~10KB de estilo).
    Utilidades.garantirEstilos('css-tela-auditoria', CSS);
    conteudo.innerHTML = `
      <div class="aud-tela">
        <header class="aud-header">
          <div class="aud-header-titulo">
            <h2>Auditoria</h2>
            <p>Corrige lacunas de papéis do QVIS usando a <strong>BASE TABELA</strong> como gabarito. O Cálculo de Repasse é só fonte — as correções vivem aqui.</p>
          </div>
          <div class="aud-comp-wrap">
            <button type="button" class="aud-btn-palavras" data-abrir-palavras title="Palavras-chave de cirurgia (PACOTE X = X)">🔑 Palavras-chave</button>
            <button type="button" class="aud-btn-palavras" data-abrir-cp title="Procedimentos de convênio pagos pela Produção (por tags de nome)">🩺 Procedimento por Produção</button>
            <button type="button" class="aud-btn-palavras" data-abrir-export-aud title="Exportar a matriz auditada em Excel (layout da ferramenta), com filtro por médico">📥 Exportar</button>
            <button type="button" class="aud-btn-palavras" data-abrir-errover title="Quanto foi pago a mais enquanto a resolução de vigência caía na versão errada (corrigido na V639)">⚖ Erro de versão</button>
            <button type="button" class="aud-btn-palavras" data-abrir-unidades title="O que o médico do Períodos recebe além do plantão, por Unidade › Categoria › Procedimento × fonte pagadora">🏥 Ajuste Unidades</button><!-- V938 -->
          </div>
        </header>
        <!-- V734: fileira de filtros 20C — IRMÃ do header, esticada de ponta a
             ponta. O wrapper tem "filtro" no nome (o leque #atlas-hub ignora
             [class*="filtro"]) e position:relative + z-index:30 (a animação
             fade-in-up global deixa transform residual nos irmãos → sem isso
             os painéis abririam POR BAIXO dos cards). -->
        <div class="aud-sb-filtros-bar">
          ${renderBarraFiltrosAud20C(comps)}
        </div>

        ${state._modalPalavras ? renderModalPalavras() : ''}
        ${state._modalCP ? renderModalCP() : ''}
        ${state._modalExportAud ? renderModalExportAud() : ''}
        ${state._modalErroVer ? renderModalErroVersao() : ''}
        ${state._modalUnidades ? renderModalUnidades() : ''}<!-- V938 -->

        <div class="aud-secoes">
          <button class="aud-secao-btn ${state.secao === 'repasse' ? 'ativa' : ''}" data-secao="repasse">∑ Cálculo de Repasse</button>
          <button class="aud-secao-btn ${state.secao === 'validador' ? 'ativa' : ''}" data-secao="validador">✓ Validador</button>
          <button class="aud-secao-btn ${state.secao === 'honorario' ? 'ativa' : ''}" data-secao="honorario">$ Honorário Médico</button>
        </div>

        <div id="aud-corpo">
          <div class="aud-loading"><div class="atlas-loader"></div></div>
        </div>
      </div>
    `;

    bindCasca();
    Utilidades.staggerEntrada('.aud-header, .aud-secoes', { delay: 50, duracao: 360, deslocamento: 12 });
    setTimeout(renderCorpo, 16);
  }

  function renderCorpo() {
    const corpo = document.getElementById('aud-corpo');
    if (!corpo) return;
    recomputar();
    corpo.innerHTML = state.secao === 'repasse' ? renderSecaoRepasse()
      : state.secao === 'validador' ? renderSecaoValidador()
      : renderSecaoHonorario();
    bindCorpo();
    Utilidades.staggerEntrada('.aud-kpi, .aud-painel-notif, .aud-tabela-wrap',
      { delay: 50, duracao: 360, deslocamento: 12 });
  }

  function renderSecaoRepasse() {
    if (!state.competencia) {
      return msgVazia('Nenhum cálculo salvo', 'Rode o <strong>Cálculo de Repasse</strong> e salve um snapshot pra auditar aqui.');
    }
    const res = state.resultado;
    if (!res) {
      return msgVazia('Snapshot não encontrado', `Não há cálculo salvo pra competência <strong>${esc(state.competencia)}</strong>.`);
    }
    const s = res.stats;

    // valores únicos pros comboboxes — V132.11: memoizados (computados 1x por
    // resultado, não a cada tecla). Antes faziam 5 ordenações de ~50k linhas
    // a cada render, o que travava o app ao digitar nos filtros.
    if (!state._datalists) {
      const uniqSort = (arr) => Array.from(new Set(arr.filter(Boolean).map(String))).sort();
      const base = res.linhas;
      state._datalists = {
        adm:   uniqSort(base.map(l => l.admissao)),
        prof:  uniqSort(base.map(l => l.nome_profissional)),
        proc:  uniqSort(base.map(l => l.procedimento)),
        conv:  uniqSort(base.map(l => l.convenio)),
        papel: uniqSort(base.map(l => l._papelCanon || l.papel)),
      };
    }
    const dlAdmissoes     = state._datalists.adm;
    const dlProfissionais = state._datalists.prof;
    const dlProcedimentos = state._datalists.proc;
    const dlConvenios     = state._datalists.conv;
    const opcoesPapel = [{ v: 'todos', l: 'Todos' },
                         ...state._datalists.papel.map(p => ({ v: p, l: p }))];

    // aplica os 7 filtros (idênticos ao relatório de repasse)
    // V493: extraído pra filtrarLinhasRepasse() — o renderParcialFiltros usa o mesmo.
    const linhas = filtrarLinhasRepasse(res);
    const truncou = linhas.length > LIMITE_TABELA;
    const exibidas = truncou ? linhas.slice(0, LIMITE_TABELA) : linhas;

    // V132.11: aviso se a Produção não foi importada (sem ela não há nome de indicante/solicitante)
    const semProducao = carregarProducao().size === 0;
    const avisoProducao = semProducao ? `
      <div class="aud-aviso-prod">
        ⓘ A <strong>Produção</strong> (linhas_producao) está vazia — por isso os nomes de
        <strong>Indicante/Solicitante</strong> não são preenchidos. Importe o relatório de Produção
        pra que a Auditoria consiga puxar esses nomes.
      </div>` : '';

    return `
      ${avisoProducao}
      <div class="aud-kpis">
        <div class="aud-kpi">
          <span class="aud-kpi-label">Repasse auditado</span>
          <span class="aud-kpi-valor aud-kpi-rs">R$ ${fmt(s.totRepasse)}</span>
          <span class="aud-kpi-sub">${s.nGruposAuditados} grupos (admissão × proc.)</span>
        </div>
        <div class="aud-kpi aud-kpi-atlas">
          <span class="aud-kpi-label">Linhas-filhas criadas</span>
          <span class="aud-kpi-valor">${s.nFilhasAudit}</span>
          <span class="aud-kpi-sub">papéis faltantes preenchidos</span>
        </div>
        <div class="aud-kpi">
          <span class="aud-kpi-label">Auxiliares renomeados</span>
          <span class="aud-kpi-valor">${s.nRenomeados}</span>
          <span class="aud-kpi-sub">→ cirurgião do procedimento</span>
        </div>
        <div class="aud-kpi ${s.nNotificacoes > 0 ? 'aud-kpi-notif' : ''}">
          <span class="aud-kpi-label">Notificações</span>
          <span class="aud-kpi-valor">${s.nNotificacoes}</span>
          <span class="aud-kpi-sub">precisam de atenção manual</span>
        </div>
      </div>

      ${res.notificacoes.length ? (() => {
        // V598: painel MINIMIZÁVEL — clique no cabeçalho esconde/mostra a lista;
        // a preferência fica guardada (sobrevive à troca de tela e de sessão).
        const notifMin = localStorage.getItem('aud_notif_min') === '1';
        return `
        <div class="aud-painel-notif">
          <div class="aud-painel-notif-head aud-notif-head-tg" data-aud-notif-toggle role="button" tabindex="0"
               title="${notifMin ? 'Mostrar as notificações' : 'Minimizar as notificações'}">
            <span>⚠ ${res.notificacoes.length} ${res.notificacoes.length === 1 ? 'notificação' : 'notificações'} — resolução manual</span>
            <span class="aud-notif-caret">${notifMin ? '▸ mostrar' : '▾ minimizar'}</span>
          </div>
          ${notifMin ? '' : `
          <div class="aud-painel-notif-body">
            ${res.notificacoes.slice(0, 40).map(n => `
              <div class="aud-notif-item">
                <span class="aud-notif-adm mono">${esc(n.admissao)}</span>
                <span class="aud-notif-papel">${esc(n.papel)}</span>
                <span class="aud-notif-proc">${esc(Utilidades.procComPerfil(n))}</span>
                <span class="aud-notif-motivo">${esc(n.motivo)}</span>
              </div>
            `).join('')}
            ${res.notificacoes.length > 40 ? `<div class="aud-notif-mais">+ ${res.notificacoes.length - 40} outras…</div>` : ''}
          </div>`}
        </div>`;
      })() : ''}

      <div class="calc-filtros-card">
        ${renderFiltroCombo('Admissão', 'aud-busca-adm', 'admissao', 'Nº admissão...', state.buscaAdmissao, dlAdmissoes)}
        ${renderFiltroCombo('Profissional', 'aud-busca-prof', 'profissional', 'Nome do médico...', state.buscaProfissional, dlProfissionais)}
        ${renderFiltroCombo('Procedimento', 'aud-busca-proc', 'procedimento', 'Procedimento...', state.buscaProcedimento, dlProcedimentos)}
        ${renderFiltroCombo('Convênio', 'aud-busca-conv', 'convenio', 'Nome do convênio...', state.buscaConvenio, dlConvenios)}
        ${renderFiltroDrop('Papel', 'papel', state.filtroPapel, 'todos', opcoesPapel)}
        ${renderFiltroDrop('Status', 'status', state.filtroStatus, 'todos', [
          { v: 'todos',         l: 'Todas' },
          { v: 'casou',         l: 'QVIS' },
          { v: 'glosa',         l: 'Glosa' },
          { v: 'pacoteDetalhe', l: 'Ajustes' },
        ])}
        ${renderFiltroDrop('Fonte Pagadora', 'fonte', state.filtroFonte, 'todas', [
          { v: 'todas',      l: 'Todas' },
          { v: 'CONVENIO',   l: 'Convênio' },
          { v: 'PARTICULAR', l: 'Particular' },
          { v: 'SUS',        l: 'SUS' },
          { v: 'PERFIL',     l: 'Filtros particulares' },
        ])}
      </div>

      <div class="aud-tabela-wrap">
        <table class="aud-tabela" id="aud-tabela-principal">
          <thead>
            <tr>
              ${['Status', 'Admissão', 'Data', 'Profissional', 'Papel', 'Procedimento', 'Origem',
                 'Convênio', 'V.TAB', 'Produzido (Part.)', 'Repasse'].map((t, i) => `
                <th class="${i >= 9 ? 'num' : ''}">${t}<span class="aud-th-grip" data-aud-grip="${i}"
                  title="V920: arraste para ajustar a largura da coluna · duplo clique restaura o automático"></span></th>`).join('')}
            </tr>
          </thead>
          <tbody id="aud-tbody">
            ${tbodyRepasseHtml(exibidas)}
          </tbody>
        </table>
      </div>
      <div id="aud-trunc-wrap">${truncRepasseHtml(linhas.length)}</div>
    `;
  }

  // V493: filtros da matriz extraídos de renderSecaoRepasse — template/lógica
  // únicos, compartilhados entre o render completo e o renderParcialFiltros.
  // V903: leitura/alternância dos filtros multi (mesmos helpers do Calcular)
  function selDe(v, vazio) {
    if (v == null) return [];
    if (Array.isArray(v)) return v;
    return v === vazio ? [] : [v];
  }
  function toggleSel(atual, vazio, v) {
    if (v === vazio) return [];
    const arr = selDe(atual, vazio);
    return arr.includes(v) ? arr.filter(x => x !== v) : arr.concat(v);
  }

  function filtrarLinhasRepasse(res) {
    let linhas = res.linhas.slice();
    /**
     * V903: cada combo tem DOIS modos — itens MARCADOS (multiSel, união por
     * casamento exato) ou, sem marcação, o texto digitado como "contém".
     */
    const combo = (key, busca, campoDe) => {
      const sel = (state.multiSel[key] || []).map(norm);
      if (sel.length) { linhas = linhas.filter(l => sel.includes(norm(campoDe(l)))); return; }
      if (busca.trim()) { const q = norm(busca); linhas = linhas.filter(l => norm(campoDe(l)).includes(q)); }
    };
    combo('admissao',     state.buscaAdmissao,     l => l.admissao);
    combo('profissional', state.buscaProfissional, l => l.nome_profissional);
    combo('procedimento', state.buscaProcedimento, l => l.procedimento);
    combo('convenio',     state.buscaConvenio,     l => l.convenio);
    const ps = selDe(state.filtroPapel, 'todos');   // V903: multi (união)
    if (ps.length) linhas = linhas.filter(l => ps.includes(l._papelCanon || l.papel));
    const ss = selDe(state.filtroStatus, 'todos');
    if (ss.length) linhas = linhas.filter(l => ss.includes(l._status));
    const fs = selDe(state.filtroFonte, 'todas');
    if (fs.length) {
      linhas = linhas.filter(l => fs.some(f =>
        f === 'PERFIL' ? !!l._regraPerfil : norm(l.origem) === f));
    }
    return linhas;
  }

  // V493: conteúdo do tbody da matriz (mesmas linhas do render completo).
  function tbodyRepasseHtml(exibidas) {
    if (window.AtlasMemoria) AtlasMemoria.novaLeva('aud');   // V937: memória de cálculo por linha
    return exibidas.map(renderLinha).join('') || `<tr><td colspan="11" class="aud-vazio">Nenhuma linha com este filtro.</td></tr>`;
  }

  // V493: aviso de truncamento ("Exibindo 600 de N linhas").
  function truncRepasseHtml(total) {
    return total > LIMITE_TABELA
      ? `<div class="aud-trunc">Exibindo ${LIMITE_TABELA} de ${total} linhas (use os filtros pra refinar).</div>`
      : '';
  }

  // V493: RENDER INCREMENTAL dos filtros de texto. Atualiza SÓ as regiões que a
  // digitação afeta — tbody da matriz (#aud-tbody), aviso de truncamento
  // (#aud-trunc-wrap) e a lista de opções do combo aberto (#aud-fil-opcoes-*) +
  // estado visual do próprio wrap (classe ativo / botão ×) — sem reconstruir os
  // inputs, que assim NÃO perdem foco (dispensa focarRestaurar neste caminho).
  // Usa exatamente as mesmas funções de template do render completo.
  function renderParcialFiltros() {
    if (state.secao !== 'repasse') { renderCorpo(); return; }
    const res = state.resultado;
    const tbody = document.getElementById('aud-tbody');
    if (!res || !tbody) { renderCorpo(); return; }   // fallback seguro → render completo

    // 1) tbody + aviso de truncamento
    const linhas = filtrarLinhasRepasse(res);
    const truncou = linhas.length > LIMITE_TABELA;
    const exibidas = truncou ? linhas.slice(0, LIMITE_TABELA) : linhas;
    tbody.innerHTML = tbodyRepasseHtml(exibidas);
    const truncWrap = document.getElementById('aud-trunc-wrap');
    if (truncWrap) truncWrap.innerHTML = truncRepasseHtml(linhas.length);

    // 2) combo ativo: classe 'ativo', botão × e lista de opções filtrada
    const k = state.dropAberto;
    if (k && mapKeyState[k]) {
      const inp = document.getElementById(mapKeyInputId[k]);
      const wrap = inp ? inp.closest('.calc-fil-input-wrap') : null;
      if (wrap) {
        const valor = state[mapKeyState[k]] || '';
        const temSel = (state.multiSel[k] || []).length > 0;   // V903
        wrap.classList.toggle('calc-fil-ativo', !!valor || temSel);
        wrap.classList.add('calc-fil-combo-aberto');   // dropAberto === k neste caminho
        const x = wrap.querySelector('[data-fil-x-input]');
        if ((valor || temSel) && !x) inp.insertAdjacentHTML('afterend', comboXBtnHtml(inp.id));
        else if (!valor && !temSel && x) x.remove();
        const dl = (state._datalists && state._datalists[mapKeyDatalist[k]]) || [];
        const ul = document.getElementById('aud-fil-opcoes-' + k);
        if (ul) ul.outerHTML = comboUlHtml(k, valor, dl);
        else wrap.insertAdjacentHTML('beforeend', comboUlHtml(k, valor, dl));
      }
    }
  }

  // rótulos/classes de status na matriz (excluidoTipo → "Retirado")
  const STATUS_TAG = {
    casou:         { l: 'QVIS',         c: 'aud-tag-ok' },
    glosa:         { l: 'GLOSA',        c: 'aud-tag-glosa' },
    duplicada:     { l: 'DUPL.',        c: 'aud-tag-dup' },
    procSemRegra:  { l: 'NOVO',         c: 'aud-tag-warn' },
    semRegraPapel: { l: 'S/ REGRA',     c: 'aud-tag-warn' },
    excluidoTipo:  { l: 'RETIRADO',     c: 'aud-tag-neutra' },
    pacoteDetalhe: { l: 'Ajustes',        c: 'aud-tag-atlas' },
  };

  // V132.25: formata a data de admissão (YYYY-MM-DD HH:MM:SS → DD/MM/AAAA)
  function fmtDataAdm(s) {
    if (!s) return '';
    const str = String(s).trim();
    let m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    m = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return m[0];
    return str.slice(0, 10);
  }

  // V132.19: badge de fonte pagadora (reusado na matriz e no Validador).
  // V947: tag padrão da ferramenta (Utilidades.badgeFonte); linha sem fonte conta como Convênio (regra antiga)
  function fonteBadge(origem, convenio) {
    const cls = Utilidades.classeFonte(origem) || 'conv';
    const conv = (cls === 'conv' && convenio) ? ` <span class="aud-fonte-conv-nome">${esc(convenio)}</span>` : '';
    return `${Utilidades.badgeFonte(cls === 'conv' ? 'CONVENIO' : origem)}${conv}`;
  }

  function renderLinha(l) {
    const ehAudit = !!l._ehAuditoria;
    const notif = !!l._auditNotificar;
    let tag;
    if (l._ehConsultaProducao) {
      tag = '<span class="aud-tag aud-tag-atlas">Produção</span>';
    } else if (ehAudit && l._status !== 'glosa') {
      // V847: filha criada numa admissão GLOSADA acompanha a admissão — cai no
      // ramo do status e sai com a tag GLOSA, como as demais linhas dela
      tag = notif
        ? '<span class="aud-tag aud-tag-notif">NOTIFICAR</span>'
        : '<span class="aud-tag aud-tag-atlas">Ajustes</span>';
    } else {
      const cfg = STATUS_TAG[l._status] || { l: (l._status || '—'), c: 'aud-tag-neutra' };
      tag = `<span class="aud-tag ${cfg.c}">${esc(cfg.l)}</span>`;
    }
    const profHtml = l._auditRenomeado
      ? `${esc(CodigoMedico.exibir(l.nome_profissional))} <span class="aud-renomeado" title="Era: ${esc(CodigoMedico.exibir(l._auditNomeOriginal))}">↻ renomeado</span>`
      : (esc(CodigoMedico.exibir(l.nome_profissional)) || '<span class="aud-faltante">— sem nome —</span>');
    const repasseHtml = (l._status === 'casou' || l._ehPacoteDetalhe)
      ? `R$ ${fmt(l._repasse)}`
      : '—';
    // V132.18: destaca a fonte pagadora (badge colorido). Particular não tem
    // a lógica de auxiliar/papéis — o destaque evita confundir com erro.
    const fonteN = norm(l.origem);
    const fonteCls = fonteN === 'PARTICULAR' ? 'part' : (fonteN === 'SUS' ? 'sus' : 'conv');
    const fonteHtml = fonteBadge(l.origem, '');   // V947: tag padrão
    // convênio só faz sentido quando a fonte é Convênio
    const convHtml = (l._regraPerfil && l._perfilNome)
      ? `<span class="aud-conv-nome">${esc(l._perfilNome)}</span>`
      : (fonteCls === 'conv'
          ? `<span class="aud-conv-nome">${esc(l.convenio) || '—'}</span>`
          : '<span class="aud-conv-na">—</span>');
    return `
      <tr class="${ehAudit ? (notif ? 'aud-tr-notif' : 'aud-tr-atlas') : ''}">
        <td>${tag}</td>
        <td class="mono">${esc(l.admissao)}</td>
        <td class="mono aud-col-data">${l.data_admissao ? esc(fmtDataAdm(l.data_admissao)) : '—'}</td>
        <td>${profHtml}</td>
        <td>${esc(l._papelCanon || l.papel)}</td>
        <td class="aud-td-proc">${esc(Utilidades.procComPerfil(l))}</td>
        <td>${fonteHtml}</td>
        <td>${convHtml}</td>
        <td class="mono aud-col-vtab" title="V928: versão da Base Tabela aplicada (pela data de admissão)">${l._versaoTabela != null && l._versaoTabela !== '' ? 'v' + esc(String(l._versaoTabela)) : '—'}</td>
        <td class="num mono">${Utilidades.produzidoViewCell(l)}</td>
        <td class="num mono aud-td-repasse"${window.AtlasMemoria ? AtlasMemoria.ref('aud', l) : ''} title="Passe o mouse: memória de cálculo · clique fixa">${repasseHtml}</td>
      </tr>
    `;
  }

  function renderSecaoValidador() {
    if (!state.competencia) {
      return msgVazia('Nenhum cálculo salvo', 'Rode o <strong>Cálculo de Repasse</strong> e salve um snapshot pra validar aqui.');
    }
    const res = state.resultado;
    if (!res) {
      return msgVazia('Snapshot não encontrado', `Não há cálculo salvo pra competência <strong>${esc(state.competencia)}</strong>.`);
    }
    const v = validar();
    if (!v) return msgVazia('Sem dados', 'Não há o que validar nesta competência.');

    const semProducao = carregarProducao().size === 0;
    const avisoProd = semProducao ? `
      <div class="aud-aviso-prod">
        ⓘ A <strong>Produção</strong> está vazia — as validações dependem dela. Importe os relatórios de Produção
        (inclusive de outras competências) pra conferir indicante/solicitante e a quantidade.
      </div>` : '';

    // ── Bloco 1: Indicante/Solicitante ──
    const is = v.indSol;
    const bloco1Linhas = is.divergencias.length
      ? is.divergencias.slice(0, 200).map(d => `
          <tr>
            <td class="aud-val-mono">${esc(d.admissao)}</td>
            <td>${esc(d.papel)}</td>
            <td>${fonteBadge(d.origem, d.convenio)}</td>
            <td>${esc(d.nomeQvis) || '<span class="aud-val-vazio">— vazio —</span>'}</td>
            <td>${esc(d.nomeProd) || '<span class="aud-val-vazio">— vazio —</span>'}</td>
          </tr>`).join('')
      : `<tr><td colspan="5" class="aud-val-ok-vazio">✓ Nenhuma divergência — todos os indicantes/solicitantes conferidos batem com a Produção.</td></tr>`;

    // ── Bloco 2: Procedimento abaixo da BASE TABELA ──
    const ab = v.abaixo;
    const bloco2Linhas = ab.lista.length
      ? ab.lista.slice(0, 400).map(e => `
          <tr class="aud-val-jamult">
            <td class="aud-val-mono">${esc(e.admissao)}</td>
            <td>${esc(e.proc)}</td>
            <td>${fonteBadge(e.origem, e.convenio)}</td>
            <td class="aud-val-center">${e.qtd > 1 ? `×${e.qtd}` : e.qtd}</td>
            <td class="aud-val-num">R$ ${fmt(e.pago)}</td>
            <td class="aud-val-num">R$ ${fmt(e.esperado)}</td>
            <td class="aud-val-num"><strong>− R$ ${fmt(e.diferenca)}</strong></td>
          </tr>`).join('')
      : `<tr><td colspan="7" class="aud-val-ok-vazio">Nenhum procedimento pago abaixo da BASE TABELA nesta competência. ✓</td></tr>`;

    // ── Bloco 3: Procedimento (QVIS) × categoria Cirurgias (Produção, mesmo mês) ──
    const pr = v.proc;
    const sitTag = {
      'cirurgica':     '<span class="aud-val-sit-cir">✓ Cirúrgica</span>',
      'nao-cirurgica': '<span class="aud-val-sit-nao">Não cirúrgica</span>',
      'sem-prod':      '<span class="aud-val-vazio">não achada no mês</span>',
    };
    const bloco3Linhas = pr.lista.length
      ? pr.lista.slice(0, 400).map(p => `
          <tr class="${p.situacao === 'cirurgica' ? 'aud-val-dobra' : ''}">
            <td class="aud-val-mono">${esc(p.admissao)}</td>
            <td>${esc(p.proc)}</td>
            <td>${fonteBadge(p.origem, p.convenio)}</td>
            <td class="aud-val-center aud-val-mono">${esc(p.comp) || '—'}</td>
            <td>${p.categoria ? esc(p.categoria) : '<span class="aud-val-vazio">—</span>'}</td>
            <td class="aud-val-center">${sitTag[p.situacao] || '—'}</td>
          </tr>`).join('')
      : `<tr><td colspan="6" class="aud-val-ok-vazio">Nenhuma admissão com classificação "Procedimento" nesta competência.</td></tr>`;

    return `
      ${avisoProd}

      <div class="aud-val-bloco">
        <div class="aud-val-head">
          <h3>1 · Indicante / Solicitante — QVIS × Produção</h3>
          <div class="aud-val-resumo">
            <span class="aud-val-chip ok">✓ ${is.nOk} conferem</span>
            <span class="aud-val-chip ${is.nDiverg ? 'alerta' : ''}">⚠ ${is.nDiverg} divergem</span>
            <span class="aud-val-chip neutra">${is.nSemProd} sem produção</span>
          </div>
        </div>
        <p class="aud-val-nota">Considera <strong>apenas</strong> linhas com classificação <strong>"Procedimento"</strong> (não Consulta/Exame). Comparação flexível de nomes (tolera grafias diferentes). Admissões sem Produção importada são ignoradas — basta importar a Produção da competência correspondente.</p>
        <div class="aud-val-tab-wrap">
          <table class="aud-val-tab">
            <thead><tr><th>Admissão</th><th>Papel</th><th>Fonte</th><th>Nome no QVIS</th><th>Nome na Produção</th></tr></thead>
            <tbody>${bloco1Linhas}</tbody>
          </table>
          ${is.nDiverg > 200 ? `<div class="aud-val-mais">+ ${is.nDiverg - 200} divergências…</div>` : ''}
        </div>
      </div>

      <div class="aud-val-bloco">
        <div class="aud-val-head">
          <h3>2 · Procedimento abaixo da BASE TABELA</h3>
          <div class="aud-val-resumo">
            <span class="aud-val-chip ${ab.total ? 'alerta' : 'ok'}">${ab.total ? `⚠ ${ab.total}` : '✓ 0'} abaixo da BASE</span>
          </div>
        </div>
        <p class="aud-val-nota">Para cada <strong>procedimento</strong> (Convênio/SUS — exclui Particular e Glosa), compara o total <strong>pago</strong> (soma dos repasses de todas as linhas: QVIS + filhas ATLAS) com a soma dos papéis na <strong>BASE TABELA</strong> (Executante + Indicante/Solicitante + Auxiliar + Médico Laudo), no valor cheio de <strong>uma</strong> cirurgia. Lista só quem pagou <strong>abaixo</strong> desse valor. Quem pagou em dobro (quantidade 2) fica acima da BASE e <strong>não</strong> aparece.</p>
        <div class="aud-val-tab-wrap">
          <table class="aud-val-tab">
            <thead><tr><th>Admissão</th><th>Procedimento</th><th>Fonte</th><th>Qtd prod.</th><th>Pago</th><th>Esperado (BASE)</th><th>Diferença</th></tr></thead>
            <tbody>${bloco2Linhas}</tbody>
          </table>
          ${ab.total > 400 ? `<div class="aud-val-mais">+ ${ab.total - 400} procedimentos…</div>` : ''}
        </div>
      </div>

      <div class="aud-val-bloco">
        <div class="aud-val-head">
          <h3>3 · Procedimento × Cirurgia (Produção, mesmo mês)</h3>
          <div class="aud-val-resumo">
            <span class="aud-val-chip ${pr.nCirurgica ? 'ok' : 'neutra'}">✓ ${pr.nCirurgica} cirúrgica${pr.nCirurgica === 1 ? '' : 's'}</span>
            <span class="aud-val-chip neutra">${pr.nNaoCirurgica} não cirúrgica${pr.nNaoCirurgica === 1 ? '' : 's'}</span>
            <span class="aud-val-chip neutra">${pr.nProcSemProd} não achadas</span>
            <span class="aud-val-chip neutra">${pr.total} "Procedimento"</span>
          </div>
        </div>
        <p class="aud-val-nota">Admissões cuja <strong>Classificação Produto = "Procedimento"</strong> no QVIS. O Atlas busca a mesma admissão na <strong>Produção, dentro do mês da data de admissão</strong>, e verifica se a categoria é <strong>Cirurgias</strong> (flexível: singular/plural, acento, caixa). Esta é uma conferência-base para uma regra futura.</p>
        <div class="aud-val-tab-wrap">
          <table class="aud-val-tab">
            <thead><tr><th>Admissão</th><th>Procedimento</th><th>Fonte</th><th>Mês</th><th>Categoria (Produção)</th><th>Situação</th></tr></thead>
            <tbody>${bloco3Linhas}</tbody>
          </table>
          ${pr.total > 400 ? `<div class="aud-val-mais">+ ${pr.total - 400} admissões…</div>` : ''}
        </div>
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════════════
  // V239: HONORÁRIO MÉDICO (substitui a antiga aba "Desempenho")
  // Lista as linhas do QVIS cujo PROCEDIMENTO contém um termo de honorário
  // (default: HONORARIO, HM). Permite sobrescrever MÉDICO e VALOR; o override é
  // aplicado em matrizDaCompetencia → reflete no repasse/Relatórios/Consolidado
  // (sobrescreve a linha existente, sem criar nova → nunca duplica).
  // ══════════════════════════════════════════════════════════════════════
  function garantirSchemaHonorario() {
    try {
      Banco.executar(`CREATE TABLE IF NOT EXISTS honorario_termo (termo TEXT PRIMARY KEY, ativo INTEGER DEFAULT 1)`);
      Banco.executar(`CREATE TABLE IF NOT EXISTS honorario_ajuste (
        competencia   TEXT NOT NULL,
        chave         TEXT NOT NULL,
        medico_nome   TEXT,
        valor         REAL,
        atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (competencia, chave)
      )`);
      const c = ((Banco.query(`SELECT COUNT(*) AS c FROM honorario_termo`) || [{}])[0] || {}).c || 0;
      if (!c) ['HONORARIO', 'HM'].forEach(t => Banco.executar(`INSERT OR IGNORE INTO honorario_termo (termo, ativo) VALUES (?, 1)`, [t]));
    } catch (e) { console.warn('[auditoria] schema honorário:', e); }
  }
  function termosHonorario() {
    try {
      const r = (Banco.query(`SELECT termo FROM honorario_termo WHERE ativo = 1`) || []).map(x => norm(x.termo)).filter(Boolean);
      return r.length ? r : ['HONORARIO', 'HM'];
    } catch (_) { return ['HONORARIO', 'HM']; }
  }
  function ehHonorario(proc, termos) {
    const p = norm(proc || ''); if (!p) return false;
    const ts = termos || termosHonorario();
    return ts.some(t => t && p.indexOf(t) >= 0);
  }
  // chave ESTÁVEL da linha (não usa nome/valor, que mudam com o override)
  function chaveHonorario(l) {
    return [String(l.admissao || '').trim(), norm(l.procedimento || ''), norm(l.papel || '')].join('\u0001');
  }
  function overridesHonorario(comp) {
    const m = new Map();
    try { (Banco.query(`SELECT chave, medico_nome, valor FROM honorario_ajuste WHERE competencia = ?`, [comp]) || [])
      .forEach(r => m.set(r.chave, { medico_nome: r.medico_nome, valor: r.valor })); } catch (_) {}
    return m;
  }
  function salvarOverrideHonorario(comp, chave, medico, valor) {
    garantirSchemaHonorario();
    try {
      Banco.executar(
        `INSERT OR REPLACE INTO honorario_ajuste (competencia, chave, medico_nome, valor, atualizado_em)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        [comp, chave, (medico == null ? null : String(medico)), (valor == null ? null : Number(valor))]);
      Banco.salvar();
      if (window.AtlasRelatorios && window.AtlasRelatorios.invalidarConsolidado) window.AtlasRelatorios.invalidarConsolidado(comp);
    } catch (e) { console.warn('[auditoria] salvar honorário:', e); }
  }
  function removerOverrideHonorario(comp, chave) {
    try {
      Banco.executar(`DELETE FROM honorario_ajuste WHERE competencia = ? AND chave = ?`, [comp, chave]);
      Banco.salvar();
      if (window.AtlasRelatorios && window.AtlasRelatorios.invalidarConsolidado) window.AtlasRelatorios.invalidarConsolidado(comp);
    } catch (_) {}
  }
  function parseValorBR(s) {
    if (s == null) return 0;
    let t = String(s).trim().replace(/[^\d.,-]/g, '');
    if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  }
  // aplica os overrides nas linhas auditadas — chamado por matrizDaCompetencia
  function aplicarOverridesHonorario(comp, linhas) {
    try {
      const ovs = overridesHonorario(comp);
      if (!ovs.size) return;
      const termos = termosHonorario();
      for (const l of linhas) {
        if (!ehHonorario(l.procedimento, termos)) continue;
        const ov = ovs.get(chaveHonorario(l));
        if (!ov) continue;
        if (ov.medico_nome != null && String(ov.medico_nome).trim() !== '') l.nome_profissional = ov.medico_nome;
        if (ov.valor != null) { l._repasse = Number(ov.valor) || 0; l._honorarioOverride = true; }
      }
    } catch (e) { console.warn('[auditoria] aplicar honorário:', e); }
  }

  /**
   * V844: o HONORÁRIO MÉDICO SUBSTITUI o pagamento de tabela do executante.
   * Regra do usuário: admissão com CIRURGIA que tem linha de HONORÁRIO MÉDICO
   * → os procedimentos NÃO pagam o EXECUTANTE pela tabela quando ele é o
   * MESMO médico do HM — o pagamento dele é a linha do HM (com os ajustes da
   * aba). O INDICANTE só cai junto quando é o PRÓPRIO médico do HM (ele
   * indicou e executou); indicante DIFERENTE (ex.: Dra. Rafaela indicou a
   * vitrectomia que a Dra. Katia executou) continua recebendo pela tabela,
   * assim como auxiliar, laudo e qualquer outro médico. Exames e consultas da
   * admissão não são afetados. As linhas suprimidas SOMEM da matriz (decisão
   * do usuário) — a linha do HM é o registro do pagamento do executante.
   */
  function aplicarRegraHonorarioExecutante(linhas) {
    try {
      const termos = termosHonorario();
      const hmPorAdm = new Map();   // admissão → Set de médicos (norm) com HM
      for (const l of linhas) {
        if (!ehHonorario(l.procedimento, termos)) continue;
        const nome = norm(l.nome_profissional || '');
        const adm = String(l.admissao || '').trim();
        if (!nome || !adm) continue;
        let s = hmPorAdm.get(adm);
        if (!s) { s = new Set(); hmPorAdm.set(adm, s); }
        s.add(nome);
      }
      if (!hmPorAdm.size) return linhas;
      const P = lerPapeis();
      return linhas.filter(l => {
        const adm = String(l.admissao || '').trim();
        const meds = hmPorAdm.get(adm);
        if (!meds) return true;
        if (ehHonorario(l.procedimento, termos)) return true;   // a linha do HM fica
        /**
         * V853: a regra NÃO depende mais da produção. Antes eu exigia cirurgia
         * confirmada no relatório analítico (categoria "Cirurgias") — e, na
         * base real, admissão com produção não importada (ou com a categoria
         * escrita de outro jeito) passava batido e o executante recebia em
         * dobro. Agora basta a admissão ter linha de HONORÁRIO MÉDICO; quem
         * separa cirurgia de exame/consulta é a CLASSIFICAÇÃO da linha,
         * conferida logo abaixo.
         */
        const ehExec = l._papelId === P.idExecutante;
        const ehInd = l._papelId === P.idIndicante || l._papelId === P.idSolicitante;
        if (!ehExec && !ehInd) return true;   // auxiliar/laudo/etc. seguem pela tabela
        const nomeReal = norm(l._medicoReal || l.nome_profissional || '');
        if (!meds.has(nomeReal)) return true;   // outro médico → tabela normal
        const cls = norm(l.classificacao || '');
        if (cls && cls !== 'PROCEDIMENTO') return true;   // exame/consulta não são afetados
        return false;   // suprimida: este pagamento é o HONORÁRIO MÉDICO
      });
    } catch (e) { console.warn('[auditoria] honorário × executante:', e); return linhas; }
  }

  function renderSecaoHonorario() {
    const comp = state.competencia;
    if (!comp) return msgVazia('Honorário Médico', 'Selecione uma competência com dados do QVIS.');
    garantirSchemaHonorario();
    const termos = termosHonorario();
    let linhas = [];
    try { linhas = (matrizDaCompetencia(comp) || []).filter(l => ehHonorario(l.procedimento, termos)); }
    catch (e) { console.error('[auditoria] honorário:', e); }
    const ovs = overridesHonorario(comp);
    const medicosList = (() => { try { return Banco.query(`SELECT nome_oficial FROM medicos WHERE ativo = 1 ORDER BY nome_oficial`) || []; } catch (_) { return []; } })();
    // espelha exatamente as colunas/valores do Relatório Consolidado
    const fmtLinha = (window.AtlasRelatorios && window.AtlasRelatorios.formatarLinhaRepasse)
      ? window.AtlasRelatorios.formatarLinhaRepasse
      : (l => ({ status: l._status || '', modulo: 'Repasse', admissao: l.admissao || '', data: l.data_admissao || '',
                 papel: l.papel || '', profissional: l.nome_profissional || '', paciente: '',
                 origem: l.origem || '', convenio: l.convenio || '', descricao: l.procedimento || '', valor: Number(l._repasse) || 0 }));
    let totalValor = 0;
    const rows = linhas.map(l => {
      const chave = chaveHonorario(l);
      const editado = ovs.has(chave);                 // matrizDaCompetencia já aplicou o override
      const p = fmtLinha(l);
      const medico = p.profissional || '';
      const valor = Number(p.valor) || 0;
      totalValor += valor;
      return `<tr data-hon-chave="${esc(chave)}" class="${editado ? 'hon-row-edit' : ''}">
        <td><span class="aud-tag aud-tag-neutra">${esc(p.status || '—')}</span></td>
        <td class="hon-mod">${esc(p.modulo || '—')}</td>
        <td class="hon-adm">${esc(p.admissao || '—')}</td>
        <td class="hon-data">${esc(p.data || '—')}</td>
        <td class="hon-papel">${esc(p.papel || '—')}</td>
        <td>${selectMedicoHon(medico, medicosList)}</td>
        <td class="hon-pac">${esc(p.paciente || '')}</td>
        <td>${fonteBadge(p.origem, '')}</td>
        <td class="hon-conv">${esc(p.convenio || '')}</td>
        <td class="hon-proc">${esc(p.descricao || '—')}</td>
        <td class="hon-num"><span class="hon-cifra">R$</span><input class="hon-in hon-valor" inputmode="decimal" value="${esc(fmt(valor))}" autocomplete="off"></td>
        <td class="hon-acao">${editado ? `<button class="hon-reset" title="Desfazer edição">↺</button>` : ''}</td>
      </tr>`;
    }).join('');
    return `
      <div class="hon-wrap">
        <div class="hon-bar">
          <div class="hon-kpis">
            <div class="hon-kpi"><span class="hon-kpi-lbl">Linhas de honorário</span><span class="hon-kpi-val">${linhas.length}</span></div>
            <div class="hon-kpi"><span class="hon-kpi-lbl">Total</span><span class="hon-kpi-val hon-kpi-verde">R$ ${fmt(totalValor)}</span></div>
          </div>
          <button class="hon-btn-termos" data-hon-termos>⚙ Termos (${termos.length})</button>
        </div>
        <p class="hon-hint">Linhas do QVIS cujo procedimento contém ${termos.map(t => `<code>${esc(t)}</code>`).join(' · ')}. Edite <strong>médico</strong> e <strong>valor</strong> — entra direto no repasse final (Relatórios/Consolidado).</p>
        <div class="hon-tab-wrap">
          <table class="hon-tab">
            <thead><tr>
              <th>Status</th><th>Módulo</th><th>Admissão</th><th>Data</th><th>Papel</th>
              <th>Profissional</th><th>Paciente</th><th>Origem</th><th>Convênio</th><th>Descrição</th>
              <th class="hon-num-h">Valor repasse</th><th></th>
            </tr></thead>
            <tbody>${rows || `<tr><td colspan="12" class="hon-vazio">Nenhuma linha de honorário nesta competência. ✓</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      ${state._modalHonTermos ? renderModalHonTermos(termos) : ''}
    `;
  }
  function selectMedicoHon(medico, lista) {
    const medNorm = norm(medico || '');
    const naLista = lista.some(m => norm(m.nome_oficial) === medNorm);
    const opts = lista.map(m => `<option value="${esc(m.nome_oficial)}"${norm(m.nome_oficial) === medNorm ? ' selected' : ''}>${esc(CodigoMedico.exibir(m.nome_oficial))}</option>`).join('');
    const optAtual = (medico && !naLista) ? `<option value="${esc(medico)}" selected>${esc(medico)} — (do QVIS, não cadastrado)</option>` : '';
    const optVazia = `<option value=""${!medico ? ' selected' : ''}>— selecione —</option>`;
    return `<select class="hon-in hon-medico">${optVazia}${optAtual}${opts}</select>`;
  }
  function renderModalHonTermos(termos) {
    return `
      <div class="aud-modal-overlay" data-hon-fechar-termos>
        <div class="aud-modal" onclick="event.stopPropagation()" style="max-width:460px">
          <h3>⚙ Termos de honorário</h3>
          <p class="muted" style="margin:0 0 10px">Um por linha. A linha do QVIS entra na aba quando o procedimento <strong>contém</strong> qualquer um destes termos (ignora acento e caixa).</p>
          <textarea id="hon-termos-txt" class="hon-termos-txt" rows="6">${esc(termos.join('\n'))}</textarea>
          <div class="hon-modal-acoes">
            <button class="hon-btn-cancelar" data-hon-fechar-termos>Cancelar</button>
            <button class="hon-btn-salvar-termos" data-hon-salvar-termos>Salvar termos</button>
          </div>
        </div>
      </div>
    `;
  }


  function msgVazia(titulo, txt) {
    return `
      <div class="aud-placeholder">
        <div class="aud-placeholder-ico">∑</div>
        <h3>${titulo}</h3>
        <p>${txt}</p>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────
  // EVENTOS
  // ──────────────────────────────────────────────────────────────────────
  // V132.34: modal de edição da lista de palavras-chave de cirurgia
  function renderModalPalavras() {
    const lista = carregarPalavrasCirurgia();
    return `
      <div class="aud-modal-overlay" data-fechar-palavras>
        <div class="aud-modal" onclick="event.stopPropagation()">
          <h3>🔑 Palavras-chave de cirurgia</h3>
          <p class="aud-modal-nota">Uma palavra por linha. O Atlas usa estas palavras pra reconhecer que <strong>"PACOTE X"</strong> e <strong>"X"</strong> são a mesma cirurgia (ex.: FACECTOMIA, CAPSULOTOMIA). O colapso só ocorre quando a Produção confirma categoria <strong>Cirurgias</strong>.</p>
          <textarea id="aud-palavras-txt" class="aud-modal-txt" rows="10" spellcheck="false">${esc(lista.join('\n'))}</textarea>
          <div class="aud-modal-acoes">
            <button type="button" class="aud-modal-cancelar" data-fechar-palavras>Cancelar</button>
            <button type="button" class="aud-modal-salvar" data-salvar-palavras>Salvar</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── V938: modal AJUSTE UNIDADES — drilldown Unidade › Categoria › Procedimento ──
  // marcado = paga · vazio = não paga · contador = procedimentos pagos / total.
  // Cada clique grava na hora (AtlasUnidadesRegras.definir) e a matriz é refeita.
  const UNID_F = [['CONVENIO', 'Convênio'], ['PARTICULAR', 'Particular'], ['SUS', 'SUS']];
  const fmtCompUnid = (c) => { const m = /^(\d{4})-(\d{2})/.exec(String(c || '')); return m ? `${m[2]}/${m[1]}` : String(c || '—'); };
  function unidExp() { if (!state._unidExp) state._unidExp = new Set(); return state._unidExp; }
  function renderArvoreUnidades() {
    const R = window.AtlasUnidadesRegras;
    if (!R) return '<tr><td colspan="4">Módulo de unidades não carregado.</td></tr>';
    const A = R.arvore(state.competencia);
    const exp = unidExp();
    if (!state._unidExpInit) state._unidExpInit = true;   // V945: o drilldown abre com TODAS as unidades fechadas
    const cnt = (o) => `<small class="aud-unid-cnt ${o.pagos < o.total ? 'parcial' : ''}">${o.pagos}/${o.total}</small>`;
    const cb = (attrs, checked, extra) => `<td class="aud-unid-f"><input type="checkbox" class="aud-unid-cb" ${attrs} ${checked ? 'checked' : ''}>${extra || ''}</td>`;
    const rows = [];
    for (const u of A.unidades) {
      const abertaU = exp.has(u.key);
      rows.push(`<tr class="aud-unid-n1" data-uni="${esc(u.key)}">
        <td><span class="aud-unid-nome"><button type="button" class="aud-unid-seta" data-exp="${esc(u.key)}">${abertaU ? '▾' : '▸'}</button>${esc(u.nome)}
          <span class="aud-unid-qtd">${u.nLinhas} linha${u.nLinhas === 1 ? '' : 's'} no mês</span>
          ${u.ehMatriz ? '<span class="aud-unid-tag info">Matriz</span>' : ''}${u.outras ? '<span class="aud-unid-tag info">sem cadastro ou vazia · tratada como unidade</span>' : ''}</span></td>
        ${UNID_F.map(([f]) => cb(`data-uni="${esc(u.key)}" data-f="${f}"`, u.fontes[f].total > 0 && u.fontes[f].pagos === u.fontes[f].total, cnt(u.fontes[f]))).join('')}
      </tr>`);
      if (!abertaU) continue;
      for (const c of u.cats) {
        const kC = `${u.key}|${c.key}`;
        const abertaC = exp.has(kC);
        rows.push(`<tr class="aud-unid-n2" data-uni="${esc(u.key)}" data-cat="${esc(c.key)}">
          <td><span class="aud-unid-nome"><button type="button" class="aud-unid-seta" data-exp="${esc(kC)}">${abertaC ? '▾' : '▸'}</button>${esc(c.nome)}
            <span class="aud-unid-qtd">${c.procs.length} proc.</span>${c.semCategoria ? '<span class="aud-unid-tag info">escolha a categoria de cada um</span>' : ''}</span></td>
          ${UNID_F.map(([f]) => cb(`data-uni="${esc(u.key)}" data-cat="${esc(c.key)}" data-f="${f}"`, c.fontes[f].pagos === c.fontes[f].total, cnt(c.fontes[f]))).join('')}
        </tr>`);
        if (!abertaC) continue;
        for (const p of c.procs) {
          const sel = c.semCategoria ? `<select class="aud-unid-catsel" data-proc="${esc(p.proc)}" title="Mover este procedimento para uma categoria">
              <option value="">— escolher categoria —</option>${A.categorias.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>` : '';
          rows.push(`<tr class="aud-unid-n3" data-uni="${esc(u.key)}" data-cat="${esc(c.key)}" data-proc="${esc(p.proc)}">
            <td><span class="aud-unid-nome">${esc(p.nome)}${p.nLinhas ? `<span class="aud-unid-qtd">${p.nLinhas} linha${p.nLinhas === 1 ? '' : 's'}</span>` : ''}${p.oficial ? '' : '<span class="aud-unid-tag info">nome do QVIS (sem casamento na Base Tabela)</span>'}${sel}</span></td>
            ${UNID_F.map(([f]) => cb(`data-uni="${esc(u.key)}" data-cat="${esc(c.key)}" data-proc="${esc(p.proc)}" data-categoria="${esc(p.categoria)}" data-f="${f}"`, p.fontes[f].paga, p.fontes[f].n ? `<small class="aud-unid-cnt">${p.fontes[f].n} l.</small>` : '')).join('')}
          </tr>`);
        }
      }
    }
    state._unidArvore = A;
    return rows.join('');
  }
  function renderModalUnidades() {
    const R = window.AtlasUnidadesRegras;
    const A = R ? R.arvore(state.competencia) : { nMedicosPeriodos: 0, nRegras: 0 };
    return `
      <div class="aud-modal-overlay" data-fechar-unidades>
        <div class="aud-modal aud-modal-unid" onclick="event.stopPropagation()">
          <div class="aud-unid-head">
            <div>
              <h3>🏥 Ajuste Unidades</h3>
              <p>O que o médico do <strong>Períodos</strong> recebe além do plantão. Marcado = paga · vazio = não paga. Clicar numa unidade ou categoria aplica a todos os procedimentos dela. O contador mostra <strong>procedimentos pagos / total</strong>. Cada clique grava na hora e a matriz é refeita.</p>
            </div>
            <div class="aud-unid-meta"><span id="aud-unid-meta">${esc(fmtCompUnid(state.competencia))} · ${A.nMedicosPeriodos} médico${A.nMedicosPeriodos === 1 ? '' : 's'} no Períodos · ${A.nRegras} ajuste${A.nRegras === 1 ? '' : 's'} gravado${A.nRegras === 1 ? '' : 's'}</span></div>
          </div>
          <div id="aud-unid-teste">${renderTesteUnidades()}</div><!-- V939: verificador -->
          <div class="aud-unid-wrap">
            <table class="aud-unid-tab">
              <thead><tr><th>Unidade › Categoria › Procedimento</th>${UNID_F.map(([, r]) => `<th class="aud-unid-f">${r}</th>`).join('')}</tr></thead>
              <tbody id="aud-unid-arvore">${renderArvoreUnidades()}</tbody>
            </table>
          </div>
          <div class="aud-modal-acoes aud-unid-acoes">
            <span class="aud-unid-nota">Padrão: em toda unidade fora da Matriz, Consultas × Convênio não paga; todo o resto paga.</span>
            <button type="button" class="aud-modal-cancelar" data-unid-padrao>Voltar ao padrão</button>
            <button type="button" class="aud-modal-salvar" data-fechar-unidades>Fechar</button>
          </div>
        </div>
      </div>`;
  }
  // ── V939: VERIFICADOR "Testar uma linha" (topo do modal) ──
  // Esteira Unidade → Fonte → Procedimento → Papel (opcional): mostra se, com os
  // checkboxes como estão, a combinação gera "Repasse R$ X" ou "Sem repasse ·
  // regra: R$ X", de onde veio a decisão (padrão / ajuste gravado) e as linhas
  // REAIS do mês nessa combinação (prova de que a marcação está valendo).
  const TESTE_PAPEIS = ['Executante', 'Solicitante', 'Indicante'];
  function unidTeste() { if (!state._unidTeste) state._unidTeste = { aberto: false, uni: null, fonte: null, proc: null, papel: null, busca: {} }; return state._unidTeste; }
  const fmtBRLu = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPctU = (p) => ((Number(p) || 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
  function linhasDoTeste(t, A) {
    // linhas reais da matriz auditada (médicos do Períodos) na combinação escolhida
    const R = window.AtlasUnidadesRegras;
    const res = state.resultado; if (!res || !Array.isArray(res.linhas) || !R) return [];
    const per = setMedicosPeriodos(state.competencia);
    const uniMap = qvisUnidadeMap();
    const out = [];
    for (const l of res.linhas) {
      if (l._ehAuditoria || l._ehPacoteDetalhe || l._ehConsultaProducao) continue;
      if (!per.has(norm(l.nome_profissional || ''))) continue;
      if (R.fonteDe(l.origem) !== t.fonte) continue;
      const uTxt = uniMap.has(l.id) ? uniMap.get(l.id) : norm(l.unidade_atendimento || '');
      if (R.resolverUnidade(uTxt) !== t.uni) continue;
      const nomeProc = l._procOficial || l._procOriginal || l.procedimento || '';
      if (norm(nomeProc) !== t.proc && norm(l._procOriginal || '') !== t.proc) continue;
      if (t.papel && norm(l._papelCanon || l.papel || '') !== norm(t.papel)) continue;
      out.push(l);
    }
    return out;
  }
  function renderTesteUnidades() {
    const R = window.AtlasUnidadesRegras;
    const t = unidTeste();
    if (!t.aberto) return `<div class="aud-unid-teste"><button type="button" class="aud-unid-teste-tog" data-unid-teste-tog>▸ Testar uma linha <span class="aud-unid-qtd">confira se a marcação está valendo</span></button></div>`;
    const A = state._unidArvore || (R ? R.arvore(state.competencia) : null);
    if (!A) return '';
    const procs = new Map();
    (A.unidades[0] ? A.unidades[0].cats : []).forEach(c => c.procs.forEach(p => procs.set(p.proc, { proc: p.proc, nome: p.nome, categoria: c.nome })));
    const listaProcs = [...procs.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const nomeSel = (lista, k, chave) => { const x = lista.find(i => i[chave] === k); return x ? x.nome : ''; };
    // V939b: combo COMPACTO no estilo dos filtros da ferramenta — botão com o
    // valor escolhido; clicar abre a lista suspensa (busca + checkbox de escolha única)
    const painel = (id, titulo, itens, sel, habilitado, ph) => {
      const b = norm(t.busca[id] || '');
      const vis = itens.filter(i => !b || norm(i.nome).includes(b) || norm(i.sub || '').includes(b));
      const aberto = habilitado && t.abertoCampo === id;
      return `
        <div class="aud-unid-tp ${habilitado ? '' : 'off'} ${aberto ? 'aberto' : ''}" data-tp="${id}" data-sel="${esc(sel || '')}">
          <button type="button" class="aud-unid-tc-btn" data-unid-tc="${id}" ${habilitado ? '' : 'disabled'} aria-expanded="${aberto}">
            <span class="aud-unid-tc-rot">${titulo}</span>
            <span class="aud-unid-tc-val ${sel ? 'tem' : ''}">${esc(sel || (habilitado ? 'Escolher…' : '—'))}</span>
            <span class="aud-unid-tc-chev">${aberto ? '▴' : '▾'}</span>
          </button>
          ${aberto ? `
          <div class="aud-unid-tc-pop">
            <input type="search" class="aud-unid-tp-busca" data-unid-busca="${id}" placeholder="${ph}" value="${esc(t.busca[id] || '')}" autocomplete="off">
            <div class="aud-unid-tp-lista">
              ${vis.map(i => `<label class="aud-unid-tp-it ${i.key === t[id] ? 'sel' : ''}"><input type="checkbox" class="aud-unid-cb aud-unid-tp-cb" data-unid-tp="${id}" value="${esc(i.key)}" ${i.key === t[id] ? 'checked' : ''}><span>${esc(i.nome)}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</span></label>`).join('')
                || '<div class="aud-unid-tp-vazio">Nenhum resultado.</div>'}
            </div>
          </div>` : ''}
        </div>`;
    };
    const unis = A.unidades.map(u => ({ key: u.key, nome: u.nome, sub: u.ehMatriz ? 'Matriz' : (u.outras ? 'sem cadastro ou vazia' : '') }));
    const fontes = UNID_F.map(([k, r]) => ({ key: k, nome: r }));
    const procsIt = listaProcs.map(p => ({ key: p.proc, nome: p.nome, sub: p.categoria }));
    const papeis = TESTE_PAPEIS.map(p => ({ key: p, nome: p }));
    // ── veredito ──
    let veredito = '';
    if (t.uni && t.fonte && t.proc) {
      const p = procs.get(t.proc) || { nome: t.proc, categoria: R.categoriaDe(t.proc, '') };
      const d = R.decidir({ unidade: R.nomeUnidade(t.uni) === 'Outras unidades' ? '' : (t.uni.includes('MATRIZ') ? 'MATRIZ' : R.nomeUnidade(t.uni)), procNome: p.nome, nomeQvis: p.nome, classificacao: '', origem: t.fonte, medicoPeriodos: true });
      const pagaCfg = R.paga(t.uni, t.proc, p.categoria, t.fonte);
      const grav = R.regraGravada(t.uni, t.proc, t.fonte);
      const linhas = linhasDoTeste(t, A);
      const prodMedio = linhas.length ? linhas.reduce((s, l) => s + (Number(l.produzido) || 0), 0) / linhas.length : 0;
      const regras = R.valoresRegra(t.proc, t.fonte).filter(r => !t.papel || norm(r.papel) === norm(t.papel));
      const partes = regras.map(r => r.valor != null
        ? { papel: r.papel, txt: fmtBRLu(r.valor), v: r.valor }
        : { papel: r.papel, txt: `${fmtPctU(r.percentual)} s/ produzido${prodMedio ? ` (≈ ${fmtBRLu(prodMedio * r.percentual)})` : ''}`, v: prodMedio ? prodMedio * r.percentual : 0 });
      const total = partes.reduce((s, x) => s + x.v, 0);
      const semRegra = !partes.length;
      const valorTxt = semRegra ? (t.papel ? `sem regra na Base Tabela para ${t.papel} × ${esc(UNID_F.find(f => f[0] === t.fonte)[1])}` : 'sem regra na Base Tabela para esta fonte') : fmtBRLu(total);
      const detalhe = partes.length > 1 ? `<div class="aud-unid-ver-det">${partes.map(x => `${esc(x.papel)} ${x.txt}`).join(' + ')}</div>` : (partes.length === 1 ? `<div class="aud-unid-ver-det">${esc(partes[0].papel)}: ${partes[0].txt}${t.papel ? '' : ' (único papel com regra)'}</div>` : '');
      const origem = grav ? `ajuste gravado${grav.quando ? ' em ' + esc(String(grav.quando).slice(0, 16).replace('T', ' ')) : ''}` : 'padrão (nada gravado para esta combinação)';
      const trilha = `${esc(R.nomeUnidade(t.uni))} › ${esc(p.categoria)} › ${esc(p.nome)} › ${esc(UNID_F.find(f => f[0] === t.fonte)[1])}${t.papel ? ' › ' + esc(t.papel) : ' › todos os papéis'}`;
      const prova = linhas.length ? `
        <div class="aud-unid-prova-wrap ${linhas.length > 10 ? 'esteira' : ''}"><!-- V942: esteira — rola por dentro depois de 10 linhas -->
        <table class="aud-unid-prova"><thead><tr><th>Admissão</th><th>Médico</th><th>Papel</th><th>Procedimento (QVIS)</th><th class="num">Produzido</th><th class="num">Repasse na Auditoria</th></tr></thead>
          <tbody>${linhas.map(l => `<tr class="${l._auditRetidoUnidade ? 'retida' : ''}"><td class="mono">${esc(l.admissao)}</td><td>${esc(CodigoMedico.exibir(l.nome_profissional))}</td><td>${esc(l._papelCanon || l.papel)}</td><td>${esc(l._procOriginal || l.procedimento)}</td><td class="num mono">${fmtBRLu(l.produzido)}</td><td class="num mono${(l._status === 'casou' || l._ehPacoteDetalhe) ? ' atlas-rep' : ''}">${(l._status === 'casou' || l._ehPacoteDetalhe) ? fmtBRLu(l._repasse) : '—'}</td></tr>`).join('')}</tbody></table>
        </div>`
        : `<div class="aud-unid-tp-vazio">Nenhuma linha de médico do Períodos nessa combinação em ${esc(fmtCompUnid(state.competencia))}.</div>`;
      veredito = `
        <div class="aud-unid-ver ${pagaCfg ? 'paga' : 'nao'}">
          <div class="aud-unid-ver-top">
            <span class="aud-unid-ver-badge">${pagaCfg ? 'Repasse' : 'Sem repasse'}</span>
            <span class="aud-unid-ver-valor">${pagaCfg ? valorTxt : `<small>regra:</small> ${valorTxt}`}</span>
            <span class="aud-unid-ver-origem">${origem}</span>
          </div>
          ${detalhe}
          <div class="aud-unid-ver-trilha">${trilha}</div>
          <div class="aud-unid-ver-prova"><div class="aud-unid-tp-tit">Linhas reais do mês nessa combinação <span class="aud-unid-qtd">${linhas.length}</span></div>${prova}</div>
        </div>`;
    } else {
      veredito = `<div class="aud-unid-tp-vazio aud-unid-ver-dica">Escolha Unidade, Fonte pagadora e Procedimento. O Papel é opcional: sem papel, o valor mostrado é o total que a Base Tabela paga ao procedimento.</div>`;
    }
    return `
      <div class="aud-unid-teste aberta">
        <button type="button" class="aud-unid-teste-tog" data-unid-teste-tog>▾ Testar uma linha <span class="aud-unid-qtd">confira se a marcação está valendo · nada é gravado aqui</span></button>
        <div class="aud-unid-esteira">
          ${painel('uni', '1 · Unidade', unis, nomeSel(unis, t.uni, 'key'), true, 'Buscar unidade')}
          ${painel('fonte', '2 · Fonte pagadora', fontes, nomeSel(fontes, t.fonte, 'key'), !!t.uni, 'Buscar fonte')}
          ${painel('proc', '3 · Procedimento', procsIt, nomeSel(procsIt, t.proc, 'key'), !!(t.uni && t.fonte), 'Buscar procedimento')}
          ${painel('papel', '4 · Papel (opcional)', papeis, t.papel || '', !!(t.uni && t.fonte && t.proc), 'Buscar papel')}
        </div>
        ${veredito}
      </div>`;
  }
  function refazerTesteUnidades() {
    const h = document.getElementById('aud-unid-teste');
    if (h) h.innerHTML = renderTesteUnidades();
  }
  function bindTesteUnidades(host) {
    host.addEventListener('click', (e) => {
      if (e.target.closest('[data-unid-teste-tog]')) { const t = unidTeste(); t.aberto = !t.aberto; t.abertoCampo = null; refazerTesteUnidades(); return; }
      const btn = e.target.closest('[data-unid-tc]');
      if (btn && !btn.disabled) {
        const t = unidTeste(); const id = btn.dataset.unidTc;
        t.abertoCampo = t.abertoCampo === id ? null : id;
        refazerTesteUnidades();
        const nb = host.querySelector(`[data-unid-busca="${id}"]`); if (nb) nb.focus();
      }
    });
    // clique fora fecha a lista suspensa — ouvido no PRÓPRIO modal (o .aud-modal
    // faz stopPropagation, então o clique nunca chega ao document)
    const modal = host.closest('.aud-modal') || document;
    if (!modal.__audUnidTesteFora) {
      modal.__audUnidTesteFora = true;
      modal.addEventListener('click', (e) => {
        const t = state._unidTeste; if (!t || !t.abertoCampo) return;
        if (e.target.closest('.aud-unid-tp')) return;
        t.abertoCampo = null; refazerTesteUnidades();
      });
    }
    if (!document.__audUnidTesteEsc) {
      document.__audUnidTesteEsc = true;
      document.addEventListener('keydown', (e) => {
        const t = state._unidTeste; if (e.key === 'Escape' && t && t.abertoCampo) { t.abertoCampo = null; refazerTesteUnidades(); }
      });
    }
    host.addEventListener('input', (e) => {
      const b = e.target.closest('[data-unid-busca]'); if (!b) return;
      const t = unidTeste(); t.busca[b.dataset.unidBusca] = b.value;
      const id = b.dataset.unidBusca;
      refazerTesteUnidades();
      const nb = host.querySelector(`[data-unid-busca="${id}"]`); if (nb) { nb.focus(); try { nb.setSelectionRange(nb.value.length, nb.value.length); } catch (_) {} }
    });
    host.addEventListener('change', (e) => {
      const cb = e.target.closest('.aud-unid-tp-cb'); if (!cb) return;
      const t = unidTeste(); const id = cb.dataset.unidTp;
      t[id] = cb.checked ? cb.value : null;          // escolha ÚNICA: marcar um desmarca o anterior
      if (id === 'uni') { t.fonte = null; t.proc = null; t.papel = null; }
      else if (id === 'fonte') { t.proc = null; t.papel = null; }
      else if (id === 'proc') { t.papel = null; }
      t.abertoCampo = null;                          // escolheu → a lista fecha
      refazerTesteUnidades();
    });
  }

  function refazerArvoreUnidades() {
    const tb = document.getElementById('aud-unid-arvore');
    if (tb) tb.innerHTML = renderArvoreUnidades();
    refazerTesteUnidades();   // V939: o veredito acompanha os checkboxes
    const meta = document.getElementById('aud-unid-meta');
    const A = state._unidArvore;
    if (meta && A) meta.textContent = `${fmtCompUnid(state.competencia)} · ${A.nMedicosPeriodos} médico${A.nMedicosPeriodos === 1 ? '' : 's'} no Períodos · ${A.nRegras} ajuste${A.nRegras === 1 ? '' : 's'} gravado${A.nRegras === 1 ? '' : 's'}`;
  }
  function reauditarAposUnidades() {
    _periodosCache = { comp: null, set: null };
    state._auditKey = null;
    renderCorpo();
    refazerTesteUnidades();   // V939: a "prova" do verificador lê a matriz JÁ re-auditada
  }
  function bindModalUnidades() {
    const tb = document.getElementById('aud-unid-arvore');
    if (!tb || tb.__bound) return;
    tb.__bound = true;
    const hostTeste = document.getElementById('aud-unid-teste');   // V939
    if (hostTeste && !hostTeste.__bound) { hostTeste.__bound = true; bindTesteUnidades(hostTeste); }
    tb.addEventListener('click', (e) => {
      const b = e.target.closest('.aud-unid-seta'); if (!b) return;
      const k = b.dataset.exp; const exp = unidExp();
      if (exp.has(k)) exp.delete(k); else exp.add(k);
      refazerArvoreUnidades();
    });
    tb.addEventListener('change', (e) => {
      const R = window.AtlasUnidadesRegras; if (!R) return;
      const sel = e.target.closest('.aud-unid-catsel');
      if (sel) { R.definirCategoria(sel.dataset.proc, sel.value); refazerArvoreUnidades(); reauditarAposUnidades(); return; }
      const cb = e.target.closest('.aud-unid-cb'); if (!cb) return;
      const A = state._unidArvore; if (!A) return;
      const u = A.unidades.find(x => x.key === cb.dataset.uni); if (!u) return;
      let itens = [];
      if (cb.dataset.proc) itens = [{ proc: cb.dataset.proc, categoria: cb.dataset.categoria }];
      else if (cb.dataset.cat) { const c = u.cats.find(x => x.key === cb.dataset.cat); itens = c ? c.procs.map(p => ({ proc: p.proc, categoria: p.categoria })) : []; }
      else itens = u.cats.flatMap(c => c.procs.map(p => ({ proc: p.proc, categoria: p.categoria })));
      R.definir(u.key, itens, cb.dataset.f, cb.checked);
      refazerArvoreUnidades();
      reauditarAposUnidades();
    });
    const pad = document.querySelector('[data-unid-padrao]');
    if (pad) pad.addEventListener('click', () => {
      if (!confirm('Apagar todos os ajustes e voltar ao padrão (Consultas × Convênio fora da Matriz não paga; o resto paga)?')) return;
      window.AtlasUnidadesRegras.voltarPadrao();
      refazerArvoreUnidades();
      reauditarAposUnidades();
    });
  }

  // Modal: Consulta paga pela Produção (médicos oftalmopediátricos)
  // ── V622: EXPORT da matriz auditada (Excel, layout da ferramenta) ─────────
  // ── V640: modal do BALANÇO DO ERRO DE VERSÃO ──
  function renderModalErroVersao() {
    if (!state._modalErroVer) return '';
    const comps = competenciasDisponiveis();
    const consolidada = (c) => !!(window.AtlasConsolidacao && window.AtlasConsolidacao.estaConsolidado && window.AtlasConsolidacao.estaConsolidado(c));
    const res = state._evRes;
    let corpo = '';
    if (!res) {
      const checks = comps.map(c => `
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:3px 0">
          <input type="checkbox" data-ev-comp value="${esc(c)}" ${consolidada(c) ? '' : 'checked'}>
          <span class="mono">${esc(c)}</span>
          ${consolidada(c) ? '<span style="font-size:11px;color:var(--ink-soft)">🔒 consolidado</span>' : ''}
        </label>`).join('');
      corpo = `
        <p class="aud-modal-nota">Calcula, linha a linha da matriz, a diferença entre o que a resolução
        <strong>errada</strong> de vigência pagava (admissão anterior a todas as vigências caía na versão de
        vigência mais antiga — ex.: <strong>2.0</strong>) e o valor <strong>correto</strong> pela versão padrão
        (<strong>1.0</strong>). Meses consolidados <em>antes</em> da publicação da 2.0 não foram afetados —
        por isso vêm desmarcados. Exceções por médico e overrides manuais de Honorário não dependem de versão
        e ficam fora da conta.</p>
        <div style="max-height:220px;overflow:auto;border:1px solid var(--linha, #E5E5E5);border-radius:8px;padding:8px 12px;margin:10px 0">
          ${checks || '<em style="font-size:12px">Nenhuma competência com cálculo salvo.</em>'}
        </div>
        <div class="aud-modal-acoes">
          <button type="button" class="aud-modal-cancelar" data-fechar-errover>Cancelar</button>
          <button type="button" class="aud-modal-salvar" data-ev-calcular>⚖ Calcular diferença</button>
        </div>`;
    } else if (res.semVersoes) {
      corpo = `
        <p class="aud-modal-nota">Nenhuma versão publicada na Base Tabela — sem versões não há erro de resolução possível.</p>
        <div class="aud-modal-acoes"><button type="button" class="aud-modal-cancelar" data-fechar-errover>Fechar</button></div>`;
    } else if (!res.porComp.length) {
      corpo = `
        <p class="aud-modal-nota">✅ Nenhuma diferença encontrada nas competências selecionadas — nenhuma linha
        dessas matrizes teria sido paga com valores de outra versão.</p>
        <div class="aud-modal-acoes">
          <button type="button" class="aud-modal-cancelar" data-ev-voltar>← Voltar</button>
          <button type="button" class="aud-modal-cancelar" data-fechar-errover>Fechar</button>
        </div>`;
    } else {
      const td = 'padding:5px 10px;border-bottom:1px solid #EDEDED;font-size:12.5px';
      const money = (v) => (v < 0 ? '−' : '') + 'R$ ' + fmt(Math.abs(v));
      const blocos = res.porComp.map(pc => `
        <tr><td colspan="4" style="${td};background:#F3F6F4;font-weight:700">
          ${esc(pc.comp)} ${pc.consolidado ? '🔒' : ''} — ${pc.n} linha(s) · pago a mais: ${money(pc.total)}</td></tr>
        ${pc.medicos.map(m => `
          <tr>
            <td style="${td}"></td>
            <td style="${td}">${esc(CodigoMedico.exibir(m.nome))}</td>
            <td style="${td};text-align:right" class="mono">${m.n}</td>
            <td style="${td};text-align:right;font-weight:600" class="mono">${money(m.dif)}</td>
          </tr>`).join('')}`).join('');
      corpo = `
        <p class="aud-modal-nota">Diferença <strong>pago (errado) − correto</strong> por competência e médico.
        Valor positivo = pago a mais; negativo = pago a menos. O Excel traz o detalhamento linha a linha.</p>
        <div style="max-height:380px;overflow:auto;border:1px solid var(--linha, #E5E5E5);border-radius:8px;margin:10px 0">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr>
              <th style="${td};text-align:left;width:12px"></th>
              <th style="${td};text-align:left">Médico</th>
              <th style="${td};text-align:right">Linhas</th>
              <th style="${td};text-align:right">Diferença</th>
            </tr></thead>
            <tbody>${blocos}</tbody>
            <tfoot><tr>
              <td colspan="2" style="${td};font-weight:700;background:#EFF3F1">TOTAL PAGO A MAIS</td>
              <td style="${td};text-align:right;font-weight:700;background:#EFF3F1" class="mono">${res.nLinhas}</td>
              <td style="${td};text-align:right;font-weight:700;background:#EFF3F1" class="mono atlas-rep">${money(res.totalGeral)}</td><!-- V963 -->
            </tr></tfoot>
          </table>
        </div>
        <div class="aud-modal-acoes">
          <button type="button" class="aud-modal-cancelar" data-ev-voltar>← Voltar</button>
          <button type="button" class="aud-modal-salvar" data-ev-exportar>📥 Exportar Excel (detalhado)</button>
        </div>`;
    }
    return `
      <div class="aud-modal-overlay" data-fechar-errover>
        <div class="aud-modal" onclick="event.stopPropagation()" style="max-width:640px">
          <h3>⚖ Pago a mais — erro de versão</h3>
          ${corpo}
        </div>
      </div>`;
  }

  async function exportarErroVersao() {
    const res = state._evRes;
    if (!res || !res.detalhe || !res.detalhe.length) { Utilidades.toast?.('Nada pra exportar.', 'error', 3000); return; }
    if (typeof ExcelJS === 'undefined') { Utilidades.toast?.('Biblioteca ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return; }
    Utilidades.toast?.('Gerando Excel…', 'info', 2000);
    await new Promise(r => setTimeout(r, 60));
    try {
      const wb = new ExcelJS.Workbook();
      const cab = (ws) => {
        const head = ws.getRow(1);
        head.height = 22;
        head.eachCell((c) => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16456B' } };
          c.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
          c.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
      };
      // ── aba RESUMO (competência × médico) ──
      const wsR = wb.addWorksheet('Resumo', { views: [{ state: 'frozen', ySplit: 1 }] });
      wsR.columns = [
        { header: 'Competência', key: 'comp', width: 14 },
        { header: 'Médico', key: 'medico', width: 36 },
        { header: 'Linhas', key: 'n', width: 10 },
        { header: 'Pago a mais (R$)', key: 'dif', width: 18 },
      ];
      cab(wsR);
      for (const pc of res.porComp) for (const m of pc.medicos) {
        const row = wsR.addRow({ comp: pc.comp + (pc.consolidado ? ' 🔒' : ''), medico: CodigoMedico.exibir(m.nome), n: m.n, dif: m.dif });
        row.getCell('dif').numFmt = '#,##0.00';
        row.getCell('dif').font = { name: 'Consolas', size: 10, bold: true };
      }
      const totR = wsR.addRow({ medico: 'TOTAL PAGO A MAIS', n: res.nLinhas, dif: res.totalGeral });
      totR.eachCell({ includeEmpty: true }, (c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F1' } };
        c.border = { top: { style: 'thin', color: { argb: 'FF16456B' } } };
        c.font = { name: 'Calibri', size: 10.5, bold: true };
      });
      totR.getCell('dif').numFmt = '#,##0.00';
      // ── aba DETALHE (linha a linha) ──
      const wsD = wb.addWorksheet('Detalhe', { views: [{ state: 'frozen', ySplit: 1 }] });
      wsD.columns = [
        { header: 'Competência', key: 'comp', width: 13 },
        { header: 'Admissão', key: 'admissao', width: 14 },
        { header: 'Data admissão', key: 'data', width: 13 },
        { header: 'Profissional', key: 'nome', width: 34 },
        { header: 'Papel', key: 'papel', width: 16 },
        { header: 'Procedimento', key: 'proc', width: 44 },
        { header: 'Convênio', key: 'convenio', width: 22 },
        { header: 'Versão paga (errada)', key: 'vAntiga', width: 16 },
        { header: 'Versão correta', key: 'vNova', width: 14 },
        { header: 'Pago (errado)', key: 'valorA', width: 14 },
        { header: 'Correto', key: 'valorN', width: 12 },
        { header: 'Diferença', key: 'dif', width: 12 },
      ];
      cab(wsD);
      for (const d of res.detalhe) {
        const row = wsD.addRow(Object.assign({}, d, { nome: CodigoMedico.exibir(d.nome) }));
        for (const k of ['valorA', 'valorN', 'dif']) {
          row.getCell(k).numFmt = '#,##0.00';
          row.getCell(k).font = { name: 'Consolas', size: 10 };
        }
        row.getCell('dif').font = { name: 'Consolas', size: 10, bold: true, color: { argb: 'FF9B3A3A' } };
        row.getCell('admissao').font = { name: 'Consolas', size: 9.5 };
        row.getCell('data').font = { name: 'Consolas', size: 9.5 };
      }
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pago_a_mais_erro_versao.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      Utilidades.toast?.('✓ Excel gerado.', 'success', 3000);
    } catch (e) {
      console.error('[auditoria] export erro-versão:', e);
      Utilidades.toast?.('Erro ao gerar o Excel: ' + e.message, 'error', 5000);
    }
  }

  function renderModalExportAud() {
    if (!state._modalExportAud) return '';
    const res = state.resultado;
    const nomes = new Set();
    if (res && res.linhas) for (const l of res.linhas) {
      const n = String(l.nome_profissional || '').trim();
      if (n) nomes.add(n);
    }
    const lista = [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const opts = ['<option value="">— Todos os médicos —</option>']
      .concat(lista.map(n => `<option value="${esc(n)}">${esc(CodigoMedico.exibir(n))}</option>`)).join('');
    return `
      <div class="aud-modal-overlay" data-fechar-export-aud>
        <div class="aud-modal" onclick="event.stopPropagation()" style="max-width:460px">
          <h3>📥 Exportar matriz auditada · ${esc(state.competencia || '—')}</h3>
          <p class="aud-modal-nota">Gera o Excel com as <strong>mesmas colunas e cores da matriz</strong> (Status, Admissão, Data, Profissional, Papel, Procedimento, Origem, Convênio, Produzido, Repasse) — incluindo as linhas de Ajustes/Produção criadas pela Auditoria. Escolha um médico pra extrair só as linhas dele, ou exporte todos.</p>
          <label style="display:flex;flex-direction:column;gap:4px;margin:12px 0;font-size:12px;color:var(--ink-soft)">
            <span>Médico</span>
            <select id="aud-export-medico" class="aud-select" style="width:100%">${opts}</select>
          </label>
          <div class="aud-modal-acoes">
            <button type="button" class="aud-modal-cancelar" data-fechar-export-aud>Cancelar</button>
            <button type="button" class="aud-modal-salvar" data-export-aud-go>↓ Exportar Excel</button>
          </div>
        </div>
      </div>`;
  }

  async function exportarMatrizAuditada(nomeMedico) {
    if (typeof ExcelJS === 'undefined') { Utilidades.toast?.('Biblioteca ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return; }
    const res = state.resultado;
    if (!res || !res.linhas || !res.linhas.length) { Utilidades.toast?.('Sem matriz carregada neste mês.', 'error', 3500); return; }
    let linhas = res.linhas;
    if (nomeMedico) linhas = linhas.filter(l => norm(l.nome_profissional) === norm(nomeMedico));
    if (!linhas.length) { Utilidades.toast?.('Nenhuma linha pra esse médico neste mês.', 'error', 3500); return; }
    Utilidades.toast?.('Gerando Excel…', 'info', 2000);
    await new Promise(r => setTimeout(r, 60));
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Auditoria', { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = [
        { header: 'Status', key: 'status', width: 13 },
        { header: 'Admissão', key: 'admissao', width: 14 },
        { header: 'Data', key: 'data', width: 12 },
        { header: 'Profissional', key: 'profissional', width: 34 },
        { header: 'Papel', key: 'papel', width: 16 },
        { header: 'Procedimento', key: 'procedimento', width: 44 },
        { header: 'Origem', key: 'origem', width: 13 },
        { header: 'Convênio', key: 'convenio', width: 22 },
        { header: 'V.TAB', key: 'vtab', width: 9 },   // V928
        { header: 'Produzido (Part.)', key: 'produzido', width: 16 },
        { header: 'Repasse', key: 'repasse', width: 14 },
      ];
      // cabeçalho no azul da ferramenta
      const head = ws.getRow(1);
      head.height = 22;
      head.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16456B' } };
        c.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
        c.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      // estilos por tipo de linha — mesmas cores das tags da matriz
      const ESTILOS = {
        qvis:     { label: 'QVIS',      tagBg: 'FF1F7A5C', tagFg: 'FFFFFFFF', bg: null },
        glosa:    { label: 'GLOSA',     tagBg: 'FF9B3A3A', tagFg: 'FFFFFFFF', bg: 'FFFBF1F1' },
        ajustes:  { label: 'Ajustes',   tagBg: 'FF6B7280', tagFg: 'FFFFFFFF', bg: 'FFF7F7F8' },
        notif:    { label: 'NOTIFICAR', tagBg: 'FFC18A4A', tagFg: 'FFFFFFFF', bg: 'FFFAF5EE' },
        producao: { label: 'Produção',  tagBg: 'FF189AD3', tagFg: 'FFFFFFFF', bg: 'FFEAF4FB' },
        outro:    { label: '',          tagBg: 'FFE5E7EA', tagFg: 'FF6B7280', bg: 'FFF5F5F6' },
      };
      const estiloDe = (l) => {
        if (l._ehConsultaProducao) return ESTILOS.producao;
        // V847: filha em admissão GLOSADA sai com o estilo GLOSA no export também
        if (l._ehAuditoria) return l._status === 'glosa' ? ESTILOS.glosa
          : (l._auditNotificar ? ESTILOS.notif : ESTILOS.ajustes);
        if (l._status === 'casou') return ESTILOS.qvis;
        if (l._status === 'glosa') return ESTILOS.glosa;
        if (l._ehPacoteDetalhe) return l._execRealProducao ? ESTILOS.producao : ESTILOS.ajustes;
        const cfg = STATUS_TAG[l._status];
        return Object.assign({}, ESTILOS.outro, { label: (cfg && cfg.l) || (l._status || '—') });
      };
      const BORDA = { bottom: { style: 'thin', color: { argb: 'FFE5E5E5' } } };
      let totalRepasse = 0;
      for (const l of linhas) {
        const st = estiloDe(l);
        const temRepasse = (l._status === 'casou' || l._ehPacoteDetalhe);
        const rep = temRepasse ? (Number(l._repasse) || 0) : null;
        if (rep != null) totalRepasse += rep;
        const row = ws.addRow({
          status: st.label,
          admissao: l.admissao || '',
          data: l.data_admissao ? fmtDataAdm(l.data_admissao) : '',
          profissional: CodigoMedico.exibir(l.nome_profissional || ''),
          papel: l._papelCanon || l.papel || '',
          procedimento: Utilidades.procComPerfil(l),
          origem: Utilidades.rotuloFonte(l.origem) || 'Convênio',   // V947: rótulo uniforme
          convenio: (l._regraPerfil && l._perfilNome) ? l._perfilNome : (l.convenio || ''),
          vtab: l._versaoTabela != null && l._versaoTabela !== '' ? 'v' + l._versaoTabela : '',   // V928
          produzido: Number(l.produzido) || 0,
          repasse: rep,
        });
        row.eachCell({ includeEmpty: true }, (c) => {
          c.border = BORDA;
          c.alignment = { vertical: 'middle' };
          if (st.bg) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.bg } };
        });
        Utilidades.pintarCelulaFonte(row.getCell('origem'), l.origem || 'CONVENIO');   // V947
        const sc = row.getCell('status');
        sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.tagBg } };
        sc.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: st.tagFg } };
        sc.alignment = { vertical: 'middle', horizontal: 'center' };
        row.getCell('admissao').font = { name: 'Consolas', size: 9.5 };
        row.getCell('data').font = { name: 'Consolas', size: 9.5 };
        row.getCell('produzido').numFmt = '#,##0.00';
        row.getCell('produzido').font = { name: 'Consolas', size: 10 };
        const rc = row.getCell('repasse');
        rc.numFmt = '#,##0.00';
        rc.font = { name: 'Consolas', size: 10, bold: true, color: { argb: 'FF1F3A34' } };
        if (l._ehPacoteDetalhe) {
          row.getCell('procedimento').font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF6B7280' } };
        }
      }
      // rodapé de total
      const tot = ws.addRow({ procedimento: nomeMedico ? `TOTAL · ${CodigoMedico.exibir(nomeMedico)}` : 'TOTAL', repasse: totalRepasse });
      tot.getCell('procedimento').font = { name: 'Calibri', size: 10.5, bold: true };
      tot.getCell('repasse').numFmt = '#,##0.00';
      tot.getCell('repasse').font = { name: 'Consolas', size: 10.5, bold: true };
      tot.eachCell({ includeEmpty: true }, (c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F1' } };
        c.border = { top: { style: 'thin', color: { argb: 'FF16456B' } } };
      });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = nomeMedico ? '_' + norm(nomeMedico).replace(/\s+/g, '_') : '';
      a.href = url;
      a.download = `auditoria_${state.competencia}${slug}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      Utilidades.toast?.(`✓ Excel gerado — ${linhas.length} linha${linhas.length === 1 ? '' : 's'} · R$ ${fmt(totalRepasse)}`, 'success', 4000);
    } catch (e) {
      console.error('[auditoria] exportar:', e);
      Utilidades.toast?.('Erro ao exportar: ' + (e.message || e), 'error', 5000);
    }
  }

  function renderModalCP() {
    const ativo = !!state._cpAtivo;
    const draft = state._cpDraft || [];
    const procs = state._cpProcs || [];
    const todos = (() => { try { return Banco.query(`SELECT id, nome_oficial FROM medicos ORDER BY nome_oficial`) || []; } catch (e) { return []; } })();
    const jaIds = new Set(draft.map(d => d.medico_id));
    const opcoes = todos.filter(m => !jaIds.has(m.id))
      .map(m => `<option value="${m.id}">${esc(CodigoMedico.exibir(m.nome_oficial))}</option>`).join('');
    const medicosHtml = draft.length ? draft.map((d, i) => `
      <tr>
        <td style="padding:6px 8px">${esc(CodigoMedico.exibir(d.nome))}</td>
        <td style="padding:6px 8px; text-align:right">
          <button type="button" class="btn btn-pequeno btn-perigo" data-cp-remover="${i}">remover</button>
        </td>
      </tr>`).join('') :
      `<tr><td colspan="2" class="muted" style="text-align:center; padding:16px">Nenhum médico cadastrado ainda.</td></tr>`;
    const procsHtml = procs.length ? procs.map((p, pi) => `
      <div class="aud-cp-proc">
        <div style="flex:1">
          <div class="aud-cp-tags">
            ${(p.tags || []).map((t, ti) => `<span class="aud-cp-tag">${esc(t)}<button type="button" data-tag-rm="${pi}:${ti}" title="remover tag">×</button></span>`).join('')}
            <input type="text" class="aud-cp-tag-add" data-tag-add="${pi}" placeholder="+ tag e Enter">
          </div>
          <div class="aud-cp-proc-hint">o PRODUTO precisa conter TODAS as tags</div>
        </div>
        <input type="number" step="0.01" min="0" class="aud-cp-proc-valor" data-proc-idx="${pi}" value="${Number(p.valor) || 0}" placeholder="R$" title="valor deste procedimento">
        <button type="button" class="btn btn-pequeno btn-perigo" data-proc-rm="${pi}">remover</button>
      </div>`).join('') :
      `<div class="muted" style="padding:12px; text-align:center">Nenhum padrão cadastrado. Adicione ao menos um (ex.: tag CONSULTA).</div>`;
    return `
      <div class="aud-modal-overlay" data-fechar-cp>
        <div class="aud-modal" onclick="event.stopPropagation()" style="max-width:640px">
          <h3>🩺 Procedimento pago pela Produção</h3>
          <p class="aud-modal-nota">Os médicos abaixo têm a <strong>consulta e os exames marcados</strong> (de convênio) pagos pelo que foi <strong>produzido no mês</strong> (Produção), e não pelo QVIS. Cada <strong>procedimento tem o seu valor</strong> e é reconhecido pelas <strong>tags no nome do PRODUTO</strong> (coluna PRODUTO da Produção — precisa conter TODAS). Só sai do QVIS quando há produção correspondente. Particular e SUS continuam normais.</p>
          <label style="display:flex; align-items:center; gap:8px; margin:12px 0; cursor:pointer">
            <input type="checkbox" id="aud-cp-ativo" ${ativo ? 'checked' : ''}>
            <span><strong>Ativar regra</strong> — quando ligada, vale para todos os médicos abaixo.</span>
          </label>
          <div class="aud-cp-secao">PROCEDIMENTOS E VALOR (padrões no PRODUTO)</div>
          ${procsHtml}
          <button type="button" class="btn btn-pequeno" data-proc-add style="margin-top:2px">+ adicionar procedimento (ex.: exame)</button>
          <div class="aud-cp-secao" style="margin-top:16px">MÉDICOS QUE PARTICIPAM</div>
          <div style="margin:0 0 8px">
            <select id="aud-cp-add-sel" class="aud-select" style="width:100%">
              <option value="">+ adicionar médico…</option>
              ${opcoes}
            </select>
          </div>
          <table class="data-table" style="width:100%; margin-top:4px">
            <thead><tr><th style="text-align:left">MÉDICO</th><th></th></tr></thead>
            <tbody>${medicosHtml}</tbody>
          </table>
          <div class="aud-modal-acoes">
            <button type="button" class="aud-modal-cancelar" data-fechar-cp>Cancelar</button>
            <button type="button" class="aud-modal-salvar" data-salvar-cp>Salvar</button>
          </div>
        </div>
      </div>
    `;
  }

  function bindCasca() {
    // V734: a competência agora é a célula da fileira 20C (#aud-sb)
    bindBarraFiltrosAud20C();

    document.querySelectorAll('.aud-secao-btn').forEach(b => {
      b.addEventListener('click', () => { state.secao = b.dataset.secao; renderizar(); });
    });

    // ── V132.34: modal de palavras-chave de cirurgia ──
    const btnPal = document.querySelector('[data-abrir-palavras]');
    if (btnPal) btnPal.addEventListener('click', () => { state._modalPalavras = true; renderizar(); });
    document.querySelectorAll('[data-fechar-palavras]').forEach(el => {
      el.addEventListener('click', () => { state._modalPalavras = false; renderizar(); });
    });
    const btnSalvarPal = document.querySelector('[data-salvar-palavras]');
    if (btnSalvarPal) btnSalvarPal.addEventListener('click', async () => {
      const txt = document.getElementById('aud-palavras-txt');
      const palavras = (txt ? txt.value : '')
        .split('\n').map(s => norm(s)).filter(Boolean);
      const unicas = [...new Set(palavras)];
      try {
        Banco.executar(`CREATE TABLE IF NOT EXISTS config_palavras_cirurgia (
          id INTEGER PRIMARY KEY AUTOINCREMENT, palavra TEXT NOT NULL)`);
        Banco.executar(`DELETE FROM config_palavras_cirurgia`);
        for (const p of unicas) Banco.executar(`INSERT INTO config_palavras_cirurgia (palavra) VALUES (?)`, [p]);
        await Banco.salvar();
      } catch (e) { /* ignora */ }
      palavrasCirurgia = unicas;
      state._modalPalavras = false;
      state._auditKey = null;   // força re-auditar com a lista nova
      Utilidades.toast?.('✓ Palavras-chave salvas. Recalculando auditoria…', 'success', 3000);
      renderizar();
    });

    // ── V938: modal Ajuste Unidades ──
    const btnUnid = document.querySelector('[data-abrir-unidades]');
    if (btnUnid) btnUnid.addEventListener('click', () => { state._modalUnidades = true; renderizar(); });
    document.querySelectorAll('[data-fechar-unidades]').forEach(el => {
      el.addEventListener('click', () => { state._modalUnidades = false; renderizar(); });
    });
    if (state._modalUnidades) bindModalUnidades();

    // ── V622: Modal de export da matriz auditada (filtro por médico) ──
    const btnExpAud = document.querySelector('[data-abrir-export-aud]');
    if (btnExpAud) btnExpAud.addEventListener('click', () => { state._modalExportAud = true; renderizar(); });
    document.querySelectorAll('[data-fechar-export-aud]').forEach(el => {
      el.addEventListener('click', () => { state._modalExportAud = false; renderizar(); });
    });
    const btnExpAudGo = document.querySelector('[data-export-aud-go]');
    if (btnExpAudGo) btnExpAudGo.addEventListener('click', async () => {
      const sel = document.getElementById('aud-export-medico');
      const nome = sel ? sel.value : '';
      await exportarMatrizAuditada(nome || null);
      state._modalExportAud = false;
      renderizar();
    });

    // ── V640: Modal do balanço do erro de versão ──
    const btnErroVer = document.querySelector('[data-abrir-errover]');
    if (btnErroVer) btnErroVer.addEventListener('click', () => { state._modalErroVer = true; state._evRes = null; renderizar(); });
    document.querySelectorAll('[data-fechar-errover]').forEach(el => {
      el.addEventListener('click', () => { state._modalErroVer = false; state._evRes = null; renderizar(); });
    });
    const btnEvVoltar = document.querySelector('[data-ev-voltar]');
    if (btnEvVoltar) btnEvVoltar.addEventListener('click', () => { state._evRes = null; renderizar(); });
    const btnEvCalc = document.querySelector('[data-ev-calcular]');
    if (btnEvCalc) btnEvCalc.addEventListener('click', () => {
      const comps = [...document.querySelectorAll('[data-ev-comp]:checked')].map(el => el.value);
      if (!comps.length) { Utilidades.toast?.('Marque ao menos uma competência.', 'error', 3000); return; }
      btnEvCalc.disabled = true; btnEvCalc.textContent = '⏳ Calculando…';
      setTimeout(() => {
        try { state._evRes = balancoErroVersao(comps); }
        catch (e) { console.error('[auditoria] erro-versão:', e); Utilidades.toast?.('Erro ao calcular: ' + e.message, 'error', 5000); }
        // volta a matriz da tela pra competência atual (o balanço navegou o cache)
        state._auditKey = null;
        renderizar();
      }, 60);
    });
    const btnEvExp = document.querySelector('[data-ev-exportar]');
    if (btnEvExp) btnEvExp.addEventListener('click', () => { exportarErroVersao(); });

    // ── Modal: Procedimento pago pela Produção ──
    const btnCP = document.querySelector('[data-abrir-cp]');
    if (btnCP) btnCP.addEventListener('click', () => {
      // carrega rascunho a partir do banco (cancelar = descarta)
      try { cpGarantirTabelas(); } catch (e) {}
      state._cpAtivo = cpRegraAtiva();
      state._cpDraft = cpMedicosConfig().map(c => ({ medico_id: c.medico_id, nome: c.nome_oficial }));
      state._cpProcs = cpProcsConfig().map(p => ({ tags: (p.tags || []).slice(), valor: Number(p.valor) || 0 }));
      state._modalCP = true;
      renderizar();
    });
    document.querySelectorAll('[data-fechar-cp]').forEach(el => {
      el.addEventListener('click', () => { state._modalCP = false; renderizar(); });
    });
    const selAddCP = document.getElementById('aud-cp-add-sel');
    if (selAddCP) selAddCP.addEventListener('change', () => {
      const id = Number(selAddCP.value);
      if (!id) return;
      let m = null;
      try { m = Banco.queryUnica(`SELECT id, nome_oficial FROM medicos WHERE id = ?`, [id]); } catch (e) {}
      if (m) {
        state._cpDraft = state._cpDraft || [];
        if (!state._cpDraft.some(d => d.medico_id === id))
          state._cpDraft.push({ medico_id: id, nome: m.nome_oficial });
      }
      renderizar();
    });
    document.querySelectorAll('[data-cp-remover]').forEach(b => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.cpRemover);
        if (state._cpDraft && i >= 0 && i < state._cpDraft.length) state._cpDraft.splice(i, 1);
        renderizar();
      });
    });
    // Procedimentos: adicionar / remover
    const btnProcAdd = document.querySelector('[data-proc-add]');
    if (btnProcAdd) btnProcAdd.addEventListener('click', () => {
      state._cpProcs = state._cpProcs || [];
      state._cpProcs.push({ tags: [], valor: 0 });
      renderizar();
    });
    document.querySelectorAll('[data-proc-rm]').forEach(b => {
      b.addEventListener('click', () => {
        const pi = Number(b.dataset.procRm);
        if (state._cpProcs && pi >= 0 && pi < state._cpProcs.length) state._cpProcs.splice(pi, 1);
        renderizar();
      });
    });
    // Tags: adicionar (Enter/vírgula) / remover
    document.querySelectorAll('.aud-cp-tag-add').forEach(inp => {
      inp.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ',') return;
        ev.preventDefault();
        const pi = Number(inp.dataset.tagAdd);
        const val = String(inp.value || '').trim();
        if (!val) return;
        state._cpProcs = state._cpProcs || [];
        if (state._cpProcs[pi]) {
          const tagsN = state._cpProcs[pi].tags.map(t => norm(t));
          if (!tagsN.includes(norm(val))) state._cpProcs[pi].tags.push(val.toUpperCase());
        }
        inp.value = '';
        renderizar();
      });
    });
    document.querySelectorAll('[data-tag-rm]').forEach(b => {
      b.addEventListener('click', () => {
        const [pi, ti] = String(b.dataset.tagRm).split(':').map(Number);
        if (state._cpProcs && state._cpProcs[pi]) state._cpProcs[pi].tags.splice(ti, 1);
        renderizar();
      });
    });
    document.querySelectorAll('.aud-cp-proc-valor').forEach(inp => {
      inp.addEventListener('input', () => {
        const pi = Number(inp.dataset.procIdx);
        if (state._cpProcs && state._cpProcs[pi]) state._cpProcs[pi].valor = Number(inp.value) || 0;
      });
    });
    const chkCP = document.getElementById('aud-cp-ativo');
    if (chkCP) chkCP.addEventListener('change', () => { state._cpAtivo = chkCP.checked; });
    const btnSalvarCP = document.querySelector('[data-salvar-cp]');
    if (btnSalvarCP) btnSalvarCP.addEventListener('click', async () => {
      try {
        cpGarantirTabelas();
        Banco.executar(`DELETE FROM config_consulta_producao`);
        for (const d of (state._cpDraft || [])) {
          if (d.medico_id != null) Banco.executar(
            `INSERT OR REPLACE INTO config_consulta_producao (medico_id, valor) VALUES (?, 0)`,
            [d.medico_id]);
        }
        Banco.executar(`DELETE FROM config_proc_producao`);
        for (const p of (state._cpProcs || [])) {
          const tags = (p.tags || []).map(t => String(t).trim()).filter(Boolean);
          if (!tags.length) continue;   // padrão sem tag é ignorado
          Banco.executar(`INSERT INTO config_proc_producao (tags, valor) VALUES (?, ?)`,
            [JSON.stringify(tags), Number(p.valor) || 0]);
        }
        Banco.executar(
          `INSERT OR REPLACE INTO config_consulta_producao_meta (chave, valor) VALUES ('ativo', ?)`,
          [state._cpAtivo ? '1' : '0']);
        await Banco.salvar();
      } catch (e) { console.warn('[auditoria] salvar proc-producao', e); }
      state._modalCP = false;
      state._auditKey = null;   // força re-auditar com a regra nova
      Utilidades.toast?.('✓ Regra de procedimento por produção salva. Recalculando…', 'success', 3000);
      renderizar();
    });
  }

  /**
   * V920: AJUSTE OPCIONAL de largura das colunas da matriz — arraste a alça
   * na borda direita do título; duplo clique na alça restaura o automático
   * daquela coluna. As larguras ficam guardadas (localStorage) por coluna.
   * Sem nenhum ajuste salvo, a tabela segue o layout automático de sempre.
   */
  const AUD_LARG_KEY = 'aud_larguras_colunas_v2';   // V928: +1 coluna (V.TAB) — larguras antigas por índice não valem mais
  function bindLargurasAud() {
    const tab = document.getElementById('aud-tabela-principal');
    if (!tab) return;
    const ths = [...tab.querySelectorAll('thead th')];
    const ler = () => { try { return JSON.parse(localStorage.getItem(AUD_LARG_KEY) || '{}') || {}; } catch (_) { return {}; } };
    const gravar = (m) => { try { localStorage.setItem(AUD_LARG_KEY, JSON.stringify(m)); } catch (_) {} };
    const aplicar = () => {
      const m = ler();
      tab.style.tableLayout = Object.keys(m).length ? 'fixed' : '';
      ths.forEach((th, i) => { th.style.width = m[i] ? m[i] + 'px' : ''; });
    };
    aplicar();
    ths.forEach((th, i) => {
      const grip = th.querySelector('.aud-th-grip');
      if (!grip) return;
      grip.addEventListener('dblclick', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const m = ler(); delete m[i]; gravar(m); aplicar();
      });
      grip.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const m = ler();
        // primeiro ajuste da sessão: congela as larguras ATUAIS de todas as
        // colunas — só a arrastada muda; as outras ficam como estavam
        if (!Object.keys(m).length) ths.forEach((t, j) => { m[j] = t.offsetWidth; });
        const x0 = ev.pageX;
        const w0 = m[i] || th.offsetWidth;
        document.body.style.cursor = 'col-resize';
        const move = (e) => { m[i] = Math.max(46, w0 + (e.pageX - x0)); gravar(m); aplicar(); };
        const up = () => {
          document.body.style.cursor = '';
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    });
  }

  function bindCorpo() {
    bindLargurasAud();   // V920: alças de largura da matriz do repasse
    // V598: minimizar/expandir as notificações de resolução manual
    const ntg = document.querySelector('[data-aud-notif-toggle]');
    if (ntg) {
      const alternar = () => {
        const min = localStorage.getItem('aud_notif_min') === '1';
        localStorage.setItem('aud_notif_min', min ? '0' : '1');
        renderCorpo();
      };
      ntg.addEventListener('click', alternar);
      ntg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } });
    }

    // ── Filtros (comboboxes idênticos ao repasse) ──
    const focarRestaurar = (id, pos) => {
      const n = document.getElementById(id);
      if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
    };
    // V493: mapIdInput subiu pro escopo do módulo (o listener delegado também usa).

    document.querySelectorAll('[data-fil-input]').forEach(inp => {
      inp.addEventListener('focus', () => {
        const k = inp.dataset.filInput;
        if (state.dropAberto !== k) {
          state.dropAberto = k;
          const pos = inp.selectionStart || 0;
          renderCorpo();
          focarRestaurar(inp.id, pos);
        }
      });
      // V491: debounce de 250ms — antes cada tecla refazia a tabela inteira
      // (até 600 linhas) via renderCorpo(). Estado atualiza na hora.
      // V493: o debounce agora chama renderParcialFiltros() — atualiza só
      // tbody/contador/opções do combo aberto, sem recriar o input; o foco
      // permanece nele naturalmente (sem focarRestaurar neste caminho).
      inp.addEventListener('input', () => {
        const k = inp.dataset.filInput;
        const sk = mapKeyState[k];
        if (sk) state[sk] = inp.value;
        state.dropAberto = k;
        clearTimeout(window.__audBuscaTimer);
        window.__audBuscaTimer = setTimeout(renderParcialFiltros, 250);
      });
    });
    document.querySelectorAll('[data-fil-toggle-input]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const k = btn.dataset.filToggleInput;
        state.dropAberto = state.dropAberto === k ? null : k;
        renderCorpo();
      });
    });
    document.querySelectorAll('[data-fil-toggle]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const k = btn.dataset.filToggle;
        state.dropAberto = state.dropAberto === k ? null : k;
        renderCorpo();
      });
    });
    // V493: opções dos combos ([data-fil-opt-key]) e "×" dos inputs
    // ([data-fil-x-input]) agora usam UM listener DELEGADO no container estável
    // #aud-corpo — o renderParcialFiltros troca a <ul> de opções e cria/remove o
    // "×" sem re-executar bindCorpo, e a delegação garante que os cliques
    // continuam funcionando (mesmos handlers de antes, mesmo comportamento).
    const corpoEl = document.getElementById('aud-corpo');
    if (corpoEl && !corpoEl.__audFilDelegadoV493) {
      corpoEl.__audFilDelegadoV493 = true;
      corpoEl.addEventListener('click', (ev) => {
        const li = ev.target.closest('[data-fil-opt-key]');
        if (li) {
          ev.stopPropagation();
          const k = li.dataset.filOptKey;
          const v = li.dataset.filOptValor;
          // V903: checkbox — alterna e mantém a lista aberta pra marcar mais
          if (k === 'status') state.filtroStatus = toggleSel(state.filtroStatus, 'todos', v);
          else if (k === 'fonte') state.filtroFonte = toggleSel(state.filtroFonte, 'todas', v);
          else if (k === 'papel') state.filtroPapel = toggleSel(state.filtroPapel, 'todos', v);
          else if (mapKeyState[k]) {
            const arr = state.multiSel[k] || (state.multiSel[k] = []);
            const i = arr.indexOf(v);
            if (i >= 0) arr.splice(i, 1); else arr.push(v);
          }
          renderCorpo();
          return;
        }
        const x = ev.target.closest('[data-fil-x-input]');
        if (x) {
          ev.stopPropagation();
          const id = x.dataset.filXInput;
          const key = mapIdInput[id];
          if (key) state[key] = '';
          // V903: o × limpa também os itens marcados do combo
          const comboKey = Object.keys(mapKeyState).find(kk => mapKeyState[kk] === key);
          if (comboKey && state.multiSel[comboKey]) state.multiSel[comboKey] = [];
          state.dropAberto = null;
          renderCorpo();
        }
      });
    }
    document.querySelectorAll('[data-fil-x-drop]').forEach(x => {
      x.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const k = x.dataset.filXDrop;
        if (k === 'status') state.filtroStatus = 'todos';
        else if (k === 'fonte') state.filtroFonte = 'todas';
        else if (k === 'papel') state.filtroPapel = 'todos';
        state.dropAberto = null;
        renderCorpo();
      });
    });
    // V493: o binding por-elemento de [data-fil-x-input] saiu daqui — coberto
    // pelo listener delegado em #aud-corpo acima.
    // V492: remove o handler do renderCorpo anterior ANTES de registrar outro —
    // antes, cada renderCorpo com dropdown aberto empilhava um novo listener no
    // document (só era removido no caminho "clicou fora").
    if (window.__audDocClickHandler) {
      document.removeEventListener('click', window.__audDocClickHandler);
      window.__audDocClickHandler = null;
    }
    if (state.dropAberto) {
      const fechar = (ev) => {
        if (!ev.target.closest('.calc-fil-combo') && !ev.target.closest('.calc-fil-input-wrap')) {
          state.dropAberto = null;
          document.removeEventListener('click', fechar);
          if (window.__audDocClickHandler === fechar) window.__audDocClickHandler = null;   // V492
          renderCorpo();
        }
      };
      window.__audDocClickHandler = fechar;   // V492
      // V492: só adiciona se ainda for o handler corrente (um re-render dentro
      // do mesmo tick já pode tê-lo substituído).
      setTimeout(() => {
        if (window.__audDocClickHandler === fechar) document.addEventListener('click', fechar);
      }, 0);
    }

    // ── V239: Honorário Médico ──
    if (state.secao === 'honorario') {
      document.querySelectorAll('tr[data-hon-chave]').forEach(tr => {
        const chave = tr.getAttribute('data-hon-chave');
        const med = tr.querySelector('.hon-medico');
        const val = tr.querySelector('.hon-valor');
        const salvar = () => {
          salvarOverrideHonorario(state.competencia, chave, med ? med.value : null, val ? parseValorBR(val.value) : null);
          renderizar();
        };
        if (med) med.addEventListener('change', salvar);
        if (val) val.addEventListener('change', salvar);
        const rst = tr.querySelector('.hon-reset');
        if (rst) rst.addEventListener('click', () => { removerOverrideHonorario(state.competencia, chave); renderizar(); });
      });
      const btnT = document.querySelector('[data-hon-termos]');
      if (btnT) btnT.addEventListener('click', () => { state._modalHonTermos = true; renderizar(); });
      document.querySelectorAll('[data-hon-fechar-termos]').forEach(el => el.addEventListener('click', () => { state._modalHonTermos = false; renderizar(); }));
      const btnST = document.querySelector('[data-hon-salvar-termos]');
      if (btnST) btnST.addEventListener('click', () => {
        const txt = document.getElementById('hon-termos-txt');
        const novos = (txt ? txt.value : '').split('\n').map(x => norm(x)).filter(Boolean);
        garantirSchemaHonorario();
        try {
          Banco.executar(`DELETE FROM honorario_termo`);
          novos.forEach(t => Banco.executar(`INSERT OR IGNORE INTO honorario_termo (termo, ativo) VALUES (?, 1)`, [t]));
          Banco.salvar();
          if (window.AtlasRelatorios && window.AtlasRelatorios.invalidarConsolidado) window.AtlasRelatorios.invalidarConsolidado(state.competencia);
        } catch (_) {}
        state._modalHonTermos = false; renderizar();
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // CSS
  // ──────────────────────────────────────────────────────────────────────
  const CSS = `
    .aud-tela { padding: 4px 2px 40px; }
    .aud-loading { display: flex; align-items: center; gap: 10px; justify-content: center; padding: 56px 20px; color: var(--ink-faint); font-size: 13px; font-weight: 600; }
    .aud-loading-spin { width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--primary); border-radius: 50%; animation: aud-spin 0.7s linear infinite; }
    @keyframes aud-spin { to { transform: rotate(360deg); } }
    .aud-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 18px; }
    .aud-header-titulo h2 { margin: 0 0 4px; font-family: var(--font-display); font-weight: 500; }
    .aud-header-titulo p { margin: 0; color: var(--ink-soft); font-size: 13px; max-width: 620px; line-height: 1.5; }
    .aud-comp-wrap { display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }

    /* ── V734: fileira de filtros 20C (padrão desempenho_lio, prefixo aud-sb) ── */
    .aud-sb-filtros-bar {
      /* a animação global fade-in-up (.page-content > *) deixa transform
         residual nos irmãos → cada um vira stacking context; sem esse
         z-index no WRAPPER os painéis abririam POR BAIXO dos cards */
      position: relative;
      z-index: 30;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      width: 100%;
      box-sizing: border-box;
      margin-top: 10px;
      margin-bottom: 14px;
    }
    .aud-sb {
      position: relative; z-index: 30;
      display: flex; align-items: stretch;
      padding: 6px;
      background: #fff;
      border: 1px solid #e2ebf2;
      border-radius: 12px;
      box-shadow: 0 1px 2px rgba(20,50,80,.04), 0 10px 26px -20px rgba(20,50,80,.26);
      flex-wrap: wrap;
    }
    .aud-sb-celwrap { position: relative; min-width: 150px; display: flex; }
    .aud-sb-celwrap:not(:last-child) .aud-sb-cel { border-right: 1px solid #eef3f7; }
    .aud-sb-cel {
      flex: 1; min-width: 0;
      display: flex; align-items: center; gap: 9px;
      padding: 9px 12px; border: none; border-radius: 9px;
      background: transparent; cursor: pointer;
      font-family: inherit; text-align: left;
      transition: background-color 120ms;
    }
    .aud-sb-cel:hover, .aud-sb-cel.ativo, .aud-sb-cel.aberta { background: #f4fafd; }
    .aud-sb-cel:focus-visible { outline: 2px solid #2f8fc4; outline-offset: 2px; }
    .aud-sb-tile {
      width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: #f0f5f9; color: #5b6c7c;
    }
    .aud-sb-cel.ativo .aud-sb-tile, .aud-sb-cel.aberta .aud-sb-tile { background: #dbeef8; color: #1c6fa8; }
    .aud-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
    .aud-sb-rot {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .09em; color: #5b6c7c; white-space: nowrap;
    }
    .aud-sb-val {
      font-size: 13px; font-weight: 500; color: #4f6274;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .aud-sb-cel.ativo .aud-sb-val { font-weight: 700; color: #14384f; }
    .aud-sb-chev { color: #7d8fa0; flex-shrink: 0; display: flex; transition: transform 140ms; }
    .aud-sb-cel.aberta .aud-sb-chev { transform: rotate(180deg); }
    /* painel ancorado na célula, por cima dos cards */
    .aud-sb-painel {
      position: absolute; top: 100%; left: 0; margin-top: 6px; z-index: 40;
      min-width: 100%; width: max-content; max-width: 340px;
      background: #fff; border: 1px solid #dfe8f0; border-radius: 12px;
      box-shadow: 0 18px 44px -14px rgba(15,37,68,.42);
      overflow: hidden;
    }
    .aud-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; }
    .aud-sb-lista::-webkit-scrollbar { width: 8px; }
    .aud-sb-lista::-webkit-scrollbar-track { background: #f2f6f9; }
    .aud-sb-lista::-webkit-scrollbar-thumb { background: #c3d5e2; border-radius: 4px; }
    .aud-sb-it {
      display: flex; align-items: center; gap: 10px;
      height: 38px; padding: 0 8px; border-radius: 8px; cursor: pointer;
      font-size: 13px; color: #14384f;
    }
    .aud-sb-it:hover, .aud-sb-it.foco { background: #f2f7fb; }
    .aud-sb-it.sel { background: #eaf4fb; font-weight: 700; }
    .aud-sb-it-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .aud-sb-ck { color: #1c6fa8; display: flex; }
    .aud-sb-vazio { padding: 12px; font-size: 12.5px; color: #7d8fa0; font-style: italic; }

    .aud-select {
      padding: 9px 32px 9px 12px; border: 1.5px solid var(--border); border-radius: 10px;
      background: var(--bg-elevated); font-family: inherit; font-size: 13px; font-weight: 600;
      color: var(--ink); cursor: pointer; min-width: 160px; appearance: none; -webkit-appearance: none;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23244222' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>");
      background-repeat: no-repeat; background-position: right 10px center;
    }
    .aud-select-sm { min-width: 150px; padding: 8px 30px 8px 11px; font-size: 12.5px; }
    .aud-select:focus { outline: none; border-color: #244222; box-shadow: 0 0 0 3px rgba(0, 80, 115,0.15); }

    .aud-secoes { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1.5px solid var(--border); padding-bottom: 0; }
    .aud-secao-btn {
      padding: 10px 18px; background: transparent; border: none; border-bottom: 2.5px solid transparent;
      font-family: inherit; font-size: 13.5px; font-weight: 600; color: var(--ink-soft); cursor: pointer;
      transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms; margin-bottom: -1.5px;
    }
    .aud-secao-btn:hover { color: #107DAC; }
    .aud-secao-btn.ativa { color: #1F6E6E; border-bottom-color: #189AD3; }
    /* V132.14: Validador */
    .aud-val-bloco { margin-bottom: 24px; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--bg-elevated); }
    .aud-val-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 14px 18px; border-bottom: 1px solid var(--border); background: var(--bg-sunken); }
    .aud-val-head h3 { margin: 0; font-size: 14px; font-family: var(--font-display); font-weight: 500; color: var(--ink); }
    .aud-val-resumo { display: flex; gap: 8px; flex-wrap: wrap; }
    .aud-val-chip { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; background: var(--bg-elevated); border: 1px solid var(--border); color: var(--ink-soft); }
    .aud-val-chip.ok { color: #2B7A5B; border-color: rgba(43,122,91,0.35); background: rgba(43,122,91,0.08); }
    .aud-val-chip.alerta { color: #9B3A3A; border-color: rgba(155,58,58,0.35); background: rgba(155,58,58,0.08); }
    .aud-val-chip.dobra { color: #8A5A1A; border-color: rgba(24, 154, 211,0.5); background: rgba(24, 154, 211,0.12); }
    .aud-val-chip.neutra { color: var(--ink-faint); }
    .aud-val-nota { padding: 10px 18px 0; font-size: 12px; color: var(--ink-faint); line-height: 1.5; margin: 0; }
    .aud-val-tab-wrap { padding: 0 18px 16px; overflow: auto; max-height: 340px; }
    .aud-val-tab { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .aud-val-tab thead th { position: sticky; top: 0; z-index: 1; background: var(--bg-elevated); box-shadow: inset 0 -1.5px 0 var(--border); }
    .aud-val-tab thead th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); padding: 6px 10px; border-bottom: 1.5px solid var(--border); white-space: nowrap; }
    .aud-val-tab td { padding: 7px 10px; border-bottom: 1px solid var(--border); color: var(--ink); }
    .aud-val-tab tr:last-child td { border-bottom: none; }
    .aud-val-mono { font-family: var(--font-mono); color: var(--ink-soft); }
    .aud-val-num { font-family: var(--font-mono); text-align: right; white-space: nowrap; }
    .aud-val-center { text-align: center; }
    .aud-val-vazio { color: var(--ink-faint); font-style: italic; }
    .aud-val-dobra { background: rgba(24, 154, 211,0.08); }
    .aud-val-dobra td { color: #6E4E12; }
    .aud-val-jamult { background: rgba(120,120,120,0.05); }
    .aud-val-jamult-tag { font-size: 11px; font-weight: 700; color: var(--ink-faint); padding: 2px 8px; border: 1px solid var(--border); border-radius: 20px; white-space: nowrap; }
    .aud-val-ok-vazio { text-align: center; color: #2B7A5B; padding: 16px; font-size: 12.5px; }
    .aud-val-mais { padding: 8px; text-align: center; font-size: 11px; color: var(--ink-faint); }

    .aud-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
    .aud-aviso-prod { padding: 11px 16px; margin-bottom: 16px; background: rgba(24, 154, 211,0.08); border: 1px solid rgba(24, 154, 211,0.35); border-radius: 10px; font-size: 12.5px; color: #2B7A7A; line-height: 1.5; }
    .aud-kpi {
      background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 12px;
      padding: 14px 16px; display: flex; flex-direction: column; gap: 3px; min-height: 78px;
    }
    .aud-kpi-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #06283A; } /* V849: título dos cards totalizadores */
    .aud-kpi-valor { font-family: var(--font-mono); font-size: 22px; font-weight: 700; color: var(--ink); }
    .aud-kpi-rs { color: #1F6E6E; }
    .aud-kpi-sub { font-size: 11px; color: var(--ink-soft); }
    .aud-kpi-atlas { border-color: #C7CDD2; background: #F4F6F7; }
    .aud-kpi-atlas .aud-kpi-valor { color: #5B736C; }
    .aud-kpi-notif { border-color: #D9A441; background: #FEF8E9; }
    .aud-kpi-notif .aud-kpi-valor { color: #B07A12; }

    .aud-painel-notif {
      border: 1px solid #E6C36B; background: #FEFBF1; border-radius: 12px; margin-bottom: 18px; overflow: hidden;
    }
    .aud-painel-notif-head { padding: 10px 16px; font-weight: 700; font-size: 13px; color: #8A6420; background: #FBF1D6; border-bottom: 1px solid #EBD7A0; }
    /* V598: cabeçalho clicável (minimizar/expandir as notificações) */
    .aud-notif-head-tg { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      cursor: pointer; user-select: none; }
    .aud-notif-head-tg:hover { background: #F7E8BF; }
    .aud-notif-caret { font-size: 10.5px; font-weight: 800; text-transform: uppercase;
      letter-spacing: .05em; opacity: .8; white-space: nowrap; }
    .aud-painel-notif-body { max-height: 260px; overflow-y: auto; }
    .aud-notif-item {
      display: grid; grid-template-columns: 100px 110px 1fr 2fr; gap: 10px; align-items: center;
      padding: 8px 16px; border-bottom: 1px solid #F0E6CB; font-size: 12px;
    }
    .aud-notif-item:last-child { border-bottom: none; }
    .aud-notif-adm { font-weight: 700; color: #6E5212; }
    .aud-notif-papel { font-weight: 600; color: #8A6420; }
    .aud-notif-proc { color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .aud-notif-motivo { color: var(--ink-soft); line-height: 1.4; }
    .aud-notif-mais { padding: 8px 16px; font-size: 12px; color: var(--ink-faint); font-style: italic; }

    .aud-filtros { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
    .aud-input {
      padding: 8px 12px; border: 1.5px solid var(--border); border-radius: 8px; font-family: inherit;
      font-size: 13px; color: var(--ink); background: var(--bg-elevated); min-width: 200px;
    }
    .aud-input:focus { outline: none; border-color: #189AD3; box-shadow: 0 0 0 3px rgba(24, 154, 211,0.12); }

    .aud-tabela-wrap { border: 1px solid var(--border); border-radius: 12px; overflow: auto; background: var(--bg-elevated); }
    .aud-tabela { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .aud-tabela thead th {
      position: sticky; top: 0; background: var(--bg-sunken); text-align: left; padding: 10px 12px;
      font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--ink-faint); border-bottom: 1px solid var(--border); white-space: nowrap; z-index: 1;
    }
    .aud-tabela tbody td { padding: 8px 12px; border-bottom: 1px solid var(--border); color: var(--ink); vertical-align: top; }
    .aud-tabela tbody tr:hover { background: rgba(24, 154, 211,0.04); }
    /* V920: alça OPCIONAL de ajuste de largura nos títulos da matriz */
    .aud-tabela thead th { overflow: hidden; }
    .aud-th-grip {
      position: absolute; top: 0; right: 0; width: 9px; height: 100%;
      cursor: col-resize; user-select: none;
      border-right: 2px solid transparent; transition: border-color 120ms;
    }
    .aud-th-grip:hover { border-right-color: rgba(255,255,255,0.65); }
    .aud-tabela[style*="fixed"] tbody td { overflow: hidden; text-overflow: ellipsis; }
    .aud-td-proc { max-width: 280px; }
    .num { text-align: right; white-space: nowrap; }   /* V941: valor nunca quebra em 2 linhas */
    .mono { font-family: var(--font-mono); }
    .aud-tr-atlas { background: #F7F8F9; }
    .aud-tr-notif { background: #FEFBF1; }

    .aud-tag { display: inline-block; padding: 2px 8px; border-radius: 5px; font-size: 10px; font-weight: 700; letter-spacing: 0.03em; }
    .aud-tag-ok     { background: #E3F2EC; color: #2B7A5B; }
    .aud-tag-atlas  { background: #E5E8EB; color: #5B736C; }
    /* V132.18: badges de fonte pagadora */
    .aud-fonte { display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: 0.04em; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
    /* V947: .aud-fonte-* saiu — a tag é a global .atlas-fonte */
    .aud-conv-nome { font-weight: 600; color: var(--ink); }
    .aud-conv-na { color: var(--ink-faint); }
    .aud-fonte-conv-nome { font-size: 11px; font-weight: 600; color: var(--ink-soft); margin-left: 2px; }
    .aud-val-sit-cir { font-size: 11px; font-weight: 800; color: #2B7A5B; }
    .aud-data-adm { color: var(--ink-faint); font-size: 11px; margin-left: 6px; }
    .aud-col-data { color: var(--ink-soft); font-size: 12px; white-space: nowrap; }
    .aud-btn-palavras {
      margin-top: 8px; padding: 7px 12px; border: 1px solid var(--linha, #E5E0D5);
      background: var(--papel, #fff); color: var(--ink, #042222); border-radius: 8px;
      font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
    }
    .aud-btn-palavras:hover { background: #DCE8E3; border-color: #189AD3; }
    .aud-modal-overlay {
      position: fixed; inset: 0; background: rgba(34,36,34,0.55);
      display: flex; align-items: center; justify-content: center; z-index: 1000;
    }
    .aud-modal {
      background: var(--papel, #fff); border-radius: 14px; padding: 24px;
      width: min(520px, 92vw); box-shadow: 0 18px 50px rgba(0,0,0,0.25);
      /* V618: modal maior que a tela → rola por dentro (sem cortar topo/rodapé) */
      max-height: 88vh; overflow-y: auto; overscroll-behavior: contain;
    }
    .aud-modal h3 { margin: 0 0 8px; font-family: var(--font-display); font-weight: 500; }
    .aud-modal-nota { margin: 0 0 14px; font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; }
    .aud-modal-txt {
      width: 100%; box-sizing: border-box; border: 1px solid var(--linha, #E5E0D5);
      border-radius: 8px; padding: 10px 12px; font-family: var(--font-mono, monospace);
      font-size: 13px; resize: vertical; background: #FCFAF4;
    }
    .aud-modal-acoes { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
    /* V938: modal Ajuste Unidades */
    .aud-modal.aud-modal-unid { width: min(1440px, 98vw); max-height: 94vh; padding: 0; display: flex; flex-direction: column; overflow: hidden; }   /* V942: tela maior */
    .aud-unid-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding: 18px 22px 14px; background: #06283A; color: #fff; }
    .aud-unid-head h3 { margin: 0; font-size: 16px; color: #fff; }
    .aud-unid-head p { margin: 6px 0 0; font-size: 12.5px; color: #9FC3D6; max-width: 76ch; line-height: 1.4; }
    .aud-unid-head p strong { color: #fff; }
    .aud-unid-meta { font-family: var(--font-mono); font-size: 11.5px; background: rgba(255,255,255,.1); padding: 6px 10px; border-radius: 8px; white-space: nowrap; }
    .aud-unid-wrap { overflow: auto; flex: 1; min-height: 200px; }
    .aud-unid-tab { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 720px; }
    .aud-unid-tab thead th { position: sticky; top: 0; z-index: 2; background: var(--papel, #fff); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-soft); padding: 10px 14px; border-bottom: 2px solid var(--linha, #E5E0D5); text-align: left; }
    .aud-unid-tab th.aud-unid-f, .aud-unid-tab td.aud-unid-f { text-align: center; width: 120px; }
    .aud-unid-tab td { padding: 0 14px; height: 42px; border-bottom: 1px solid #EDF2F0; vertical-align: middle; }
    .aud-unid-n1 td { background: #EAF4FB; font-weight: 800; height: 50px; }
    .aud-unid-n2 td { font-weight: 700; height: 48px; }
    .aud-unid-n2 td:first-child { padding-left: 38px; }
    .aud-unid-n3 td:first-child { padding-left: 66px; font-weight: 500; }
    .aud-unid-n3:nth-child(odd) td { background: #FAFCFD; }
    .aud-unid-nome { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .aud-unid-seta { width: 18px; height: 18px; border: none; background: transparent; color: #107DAC; font: inherit; font-size: 11px; cursor: pointer; padding: 0; }
    .aud-unid-qtd { font-family: var(--font-mono); font-size: 11px; color: var(--ink-soft); font-weight: 500; }
    .aud-unid-tag { font-size: 10px; font-weight: 800; letter-spacing: .05em; padding: 2px 7px; border-radius: 999px; background: #EAF4FB; color: #107DAC; }
    .aud-unid-cb { appearance: none; -webkit-appearance: none; width: 20px; height: 20px; border: 2px solid #107DAC; border-radius: 5px; background: #fff; cursor: pointer; position: relative; vertical-align: middle; margin: 0; }
    .aud-unid-cb:checked { background: #107DAC; }
    /* V972: o check centrado de verdade. Era left:5px/top:1px — o "L" girado
       ficava ~1,3px à direita e ~1,9px abaixo do centro do quadrado. Agora o
       elemento nasce no centro (50%/50%) e sobe 2,1px, que é o quanto a caixa
       visível do "✓" (só as bordas direita+inferior giradas) fica abaixo do
       centro do próprio elemento. */
    .aud-unid-cb:checked::after { content: ""; position: absolute; left: 50%; top: 50%; width: 6px; height: 11px; border: solid #fff; border-width: 0 2.5px 2.5px 0; transform: translate(-50%, calc(-50% - 2.1px)) rotate(45deg); }
    .aud-unid-cb:focus-visible { outline: 2px solid #2F8FC4; outline-offset: 2px; }
    .aud-unid-cnt { display: block; font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-soft); line-height: 1; margin-top: 3px; font-weight: 500; }
    .aud-unid-cnt.parcial { color: #8A5A1F; font-weight: 700; }
    .aud-unid-catsel { font: inherit; font-size: 12px; padding: 4px 8px; border-radius: 8px; border: 1px solid var(--linha, #E5E0D5); background: var(--papel, #fff); color: var(--ink); }
    .aud-unid-acoes { padding: 12px 22px; margin-top: 0; border-top: 1px solid var(--linha, #E5E0D5); background: #F8FBFC; align-items: center; }
    /* V939: verificador "Testar uma linha" */
    .aud-unid-teste { border-bottom: 1px solid var(--linha, #E5E0D5); background: #F8FBFC; position: relative; z-index: 5; }
    .aud-unid-teste-tog { width: 100%; text-align: left; border: none; background: transparent; font: inherit; font-size: 13px; font-weight: 800; color: #06283A; padding: 10px 22px; cursor: pointer; display: flex; gap: 10px; align-items: center; }
    .aud-unid-teste-tog:hover { background: #EAF4FB; }
    .aud-unid-esteira { display: flex; gap: 10px; flex-wrap: wrap; padding: 4px 22px 12px; }
    .aud-unid-tp { position: relative; flex: 1 1 200px; min-width: 0; }
    .aud-unid-tp.off { opacity: .55; }
    .aud-unid-tc-btn { width: 100%; display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid var(--linha, #E5E0D5); border-radius: 10px; background: var(--papel, #fff); font: inherit; font-size: 12.5px; color: var(--ink); cursor: pointer; text-align: left; min-width: 0; }
    .aud-unid-tc-btn:disabled { cursor: default; }
    .aud-unid-tp.aberto .aud-unid-tc-btn, .aud-unid-tc-btn:not(:disabled):hover { border-color: #107DAC; background: #F4FAFD; }
    .aud-unid-tc-rot { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: #107DAC; white-space: nowrap; }
    .aud-unid-tc-val { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-soft); }
    .aud-unid-tc-val.tem { color: #06283A; font-weight: 700; }
    .aud-unid-tc-chev { color: #107DAC; font-size: 11px; }
    .aud-unid-tc-pop { position: absolute; top: calc(100% + 6px); left: 0; right: 0; min-width: 260px; z-index: 20; background: var(--papel, #fff); border: 1px solid #dfe8f0; border-radius: 12px; padding: 8px; box-shadow: 0 18px 44px -14px rgba(15,37,68,.42); }
    .aud-unid-tp-busca { width: 100%; box-sizing: border-box; font: inherit; font-size: 12.5px; padding: 6px 9px; border: 1px solid var(--linha, #E5E0D5); border-radius: 8px; margin-bottom: 6px; background: #fff; color: var(--ink); }
    .aud-unid-tp-lista { max-height: 240px; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
    .aud-unid-tp-it { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 7px; cursor: pointer; font-size: 12.5px; }
    .aud-unid-tp-it:hover { background: #F4FAFD; }
    .aud-unid-tp-it.sel { background: #EAF4FB; font-weight: 700; }
    .aud-unid-tp-it small { display: block; font-size: 10.5px; color: var(--ink-soft); font-weight: 500; }
    .aud-unid-tp-cb { flex: none; width: 17px; height: 17px; }
    .aud-unid-tp-cb:checked::after { left: 4px; top: 0; width: 5px; height: 9px; }
    .aud-unid-tp-vazio { font-size: 12px; color: var(--ink-soft); padding: 8px 6px; }
    .aud-unid-ver-dica { padding: 4px 22px 14px; }
    .aud-unid-ver { margin: 0 22px 14px; border-radius: 12px; border: 1px solid var(--linha, #E5E0D5); background: var(--papel, #fff); padding: 12px 14px; }
    .aud-unid-ver.paga { border-color: #9FD9C1; }
    .aud-unid-ver.nao { border-color: #F2C4BF; }   /* V945 */
    .aud-unid-ver-top { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
    .aud-unid-ver-badge { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; padding: 3px 10px; border-radius: 999px; }
    .aud-unid-ver.paga .aud-unid-ver-badge { background: #DDF5EA; color: #0E7A57; }
    .aud-unid-ver.nao .aud-unid-ver-badge { background: #FDE8E6; color: #B4453A; }   /* V945: vermelho claro */
    .aud-unid-ver-valor { font-family: var(--font-mono); font-size: 18px; font-weight: 800; color: #06283A; }
    .aud-unid-ver.paga .aud-unid-ver-valor { color: #0E7A57; }
    .aud-unid-ver-valor small { font-family: var(--font-body, inherit); font-size: 11.5px; font-weight: 600; color: var(--ink-soft); }
    .aud-unid-ver-origem { margin-left: auto; font-size: 11.5px; color: var(--ink-soft); }
    .aud-unid-ver-det { font-size: 12px; color: var(--ink-soft); margin-top: 4px; }
    .aud-unid-ver-trilha { font-size: 12px; color: #06283A; margin-top: 6px; }
    .aud-unid-ver-prova { margin-top: 10px; }
    .aud-unid-prova-wrap { border: 1px solid #EDF2F0; border-radius: 8px; }
    .aud-unid-prova-wrap.esteira { max-height: 318px; overflow: auto; }   /* V942: ~10 linhas + cabeçalho; o resto rola */
    .aud-unid-prova { width: 100%; border-collapse: collapse; font-size: 12px; }
    .aud-unid-prova thead th { position: sticky; top: 0; background: var(--papel, #fff); z-index: 1; }
    .aud-unid-prova th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-soft); padding: 5px 8px; border-bottom: 1px solid var(--linha, #E5E0D5); }
    .aud-unid-prova td { padding: 5px 8px; border-bottom: 1px solid #EDF2F0; }
    .aud-unid-prova th.num, .aud-unid-prova td.num { text-align: right; white-space: nowrap; }
    .aud-unid-prova tr.retida td { color: #B4453A; background: #FDF1F0; }   /* V945: vermelho claro */
    .aud-unid-nota { margin-right: auto; font-size: 12px; color: var(--ink-soft); }
    .aud-modal-cancelar, .aud-modal-salvar {
      padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .aud-modal-cancelar { border: 1px solid var(--linha, #E5E0D5); background: var(--papel, #fff); color: var(--ink-soft); }
    .aud-modal-salvar { border: 1px solid #2C7A5B; background: #2C7A5B; color: #fff; }
    .aud-val-sit-nao { font-size: 11px; font-weight: 700; color: var(--ink-soft); }
    .aud-tag-notif  { background: #FBE6BE; color: #9A6A12; }
    .aud-tag-neutra { background: var(--bg-sunken); color: var(--ink-faint); }
    .aud-tag-glosa  { background: #9B3A3A; color: #fff; }
    .aud-tag-dup    { background: #6B4FA0; color: #fff; }
    .aud-tag-warn   { background: #9FE6C9; color: #003A54; }
    .aud-renomeado { font-size: 10px; color: #107DAC; font-weight: 600; margin-left: 4px; }
    .aud-faltante { color: var(--ink-faint); font-style: italic; }
    .aud-trunc { text-align: center; padding: 10px; font-size: 12px; color: var(--ink-faint); font-style: italic; }
    .aud-vazio { text-align: center; padding: 30px; color: var(--ink-faint); font-style: italic; }

    .aud-placeholder { text-align: center; padding: 60px 20px; }
    .aud-placeholder-ico { font-size: 42px; opacity: 0.35; margin-bottom: 10px; }
    .aud-placeholder h3 { margin: 0 0 8px; font-family: var(--font-display); font-weight: 500; }
    .aud-placeholder p { margin: 0 0 4px; color: var(--ink-soft); font-size: 13px; }
    .aud-placeholder .muted { color: var(--ink-faint); font-size: 12px; }

    /* V239: Honorário Médico */
    .hon-wrap { display: flex; flex-direction: column; gap: 12px; }
    .hon-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .hon-kpis { display: flex; gap: 22px; }
    .hon-kpi { display: flex; flex-direction: column; gap: 2px; }
    .hon-kpi-lbl { font-size: 11px; color: var(--ink-faint); }
    .hon-kpi-val { font-size: 18px; font-weight: 600; font-family: var(--font-mono); }
    .hon-kpi-verde { color: var(--primary); }
    .hon-btn-termos { font-size: 12px; font-weight: 600; color: var(--ink-soft); background: var(--bg-elevated); border: 1px solid var(--border); padding: 8px 14px; border-radius: 8px; cursor: pointer; }
    .hon-btn-termos:hover { border-color: var(--primary); color: var(--primary); }
    .hon-hint { font-size: 12px; color: var(--ink-faint); margin: 0; }
    .hon-hint code { background: var(--bg-sunken); padding: 1px 6px; border-radius: 5px; font-family: var(--font-mono); font-size: 11px; color: var(--ink-soft); }
    .hon-tab-wrap { border: 1px solid var(--bg-sunken); border-radius: 10px; overflow: auto; max-height: 60vh; }
    .hon-tab { width: 100%; border-collapse: collapse; font-size: 12px; }
    .hon-tab thead th { position: sticky; top: 0; background: #F7F3E9; color: var(--ink-soft); text-align: left; font-weight: 500; padding: 9px 10px; border-bottom: 1px solid var(--border); z-index: 1; }
    .hon-tab tbody td { padding: 6px 10px; border-top: 1px solid #E8F1F7; color: var(--ink); vertical-align: middle; }
    .hon-tab tbody tr.hon-row-edit { background: var(--primary-soft, #E1EFF6); }
    .hon-adm { font-family: var(--font-mono); white-space: nowrap; }
    .hon-proc { max-width: 240px; }
    .hon-in { width: 100%; box-sizing: border-box; height: 32px; padding: 0 9px; border: 1px solid var(--border); border-radius: 7px; font: inherit; font-size: 12px; background: var(--bg-elevated); color: var(--ink); }
    .hon-in:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-soft); }
    .hon-medico { min-width: 190px; }
    select.hon-in { appearance: none; -webkit-appearance: none; -moz-appearance: none; cursor: pointer; padding-right: 28px;
      background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="%2356645E" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>');
      background-repeat: no-repeat; background-position: right 10px center; }
    .hon-val-cell { white-space: nowrap; }
    .hon-cifra { color: var(--ink-faint); font-size: 11px; margin-right: 4px; }
    .hon-valor { width: 104px; text-align: right; font-family: var(--font-mono); display: inline-block; }
    .hon-num { text-align: right; white-space: nowrap; }
    .hon-num-h { text-align: right; }
    .hon-mod, .hon-conv, .hon-papel { font-size: 11px; color: var(--ink-soft); white-space: nowrap; }
    .hon-data { font-family: var(--font-mono); font-size: 11px; color: var(--ink-soft); white-space: nowrap; }
    .hon-pac { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hon-tab th { white-space: nowrap; }
    .hon-acao { text-align: center; }
    .hon-reset { background: transparent; border: none; cursor: pointer; font-size: 15px; color: var(--ink-faint); line-height: 1; }
    .hon-reset:hover { color: var(--danger); }
    .hon-vazio { text-align: center; color: var(--ink-faint); padding: 24px; }
    .hon-termos-txt { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 8px; padding: 9px; font: inherit; font-size: 13px; resize: vertical; }
    .hon-modal-acoes { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
    .hon-btn-cancelar { padding: 8px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elevated); cursor: pointer; font: inherit; font-size: 12px; }
    .hon-btn-salvar-termos { padding: 8px 16px; border: none; border-radius: 8px; background: var(--primary); color: #fff; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; }

    @media (max-width: 1000px) { .aud-kpis { grid-template-columns: repeat(2, 1fr); } }

    /* ── Filtros idênticos ao relatório de repasse ── */
    .calc-filtros-card {
      display: grid; grid-template-columns: repeat(7, 1fr); gap: 12px;
      padding: 14px 16px; background: var(--bg-elevated);
      border: 1px solid var(--border); border-radius: 12px; margin-bottom: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    }
    @media (max-width: 1500px) { .calc-filtros-card { grid-template-columns: repeat(4, 1fr); } }
    @media (max-width: 800px)  { .calc-filtros-card { grid-template-columns: 1fr 1fr; } }
    .calc-filtro-grupo { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .calc-filtro-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); }
    .calc-fil-input-wrap {
      position: relative; display: flex; align-items: center; background: var(--bg-elevated);
      border: 1px solid var(--border); border-radius: 8px; height: 38px; transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
    }
    .calc-fil-input-wrap:hover { border-color: rgba(24, 154, 211,0.45); }
    .calc-fil-input-wrap:focus-within { border-color: #189AD3; box-shadow: 0 0 0 3px rgba(24, 154, 211,0.15); }
    .calc-fil-input-wrap.calc-fil-ativo { background: rgba(24, 154, 211,0.06); border-color: rgba(24, 154, 211,0.45); }
    .calc-fil-icone { padding: 0 8px 0 12px; color: var(--ink-faint); font-size: 12px; pointer-events: none; }
    .calc-fil-input { flex: 1; min-width: 0; padding: 0 4px 0 0; border: none; background: transparent; font-family: inherit; font-size: 12.5px; color: var(--ink); height: 100%; }
    .calc-fil-input:focus { outline: none; }
    .calc-fil-x, .calc-fil-x-wrap {
      display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; margin-right: 4px;
      border: none; background: rgba(155,58,58,0.10); color: #9B3A3A; border-radius: 50%;
      font-size: 14px; font-weight: 700; line-height: 1; cursor: pointer; padding: 0; transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
    }
    .calc-fil-x:hover, .calc-fil-x-wrap:hover { background: #9B3A3A; color: white; transform: scale(1.1); }
    .calc-fil-caret-btn {
      display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 100%; padding: 0; margin-right: 2px;
      background: transparent; border: none; cursor: pointer; color: var(--ink-faint); transition: color 150ms;
    }
    .calc-fil-caret-btn:hover { color: #107DAC; }
    .calc-fil-combo-aberto .calc-fil-caret-btn { color: #107DAC; }
    .calc-fil-input-wrap .calc-fil-caret { transition: transform 200ms ease; }
    .calc-fil-combo-aberto.calc-fil-input-wrap .calc-fil-caret { transform: rotate(180deg); }
    .calc-fil-opt-mais { padding: 8px 10px; font-size: 11px; color: var(--ink-faint); font-style: italic; background: var(--bg-sunken); border-radius: 6px; margin-top: 4px; text-align: center; }
    .calc-fil-opt-texto { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .calc-fil-combo { position: relative; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms; }
    .calc-fil-combo:hover { border-color: rgba(24, 154, 211,0.45); }
    .calc-fil-combo.calc-fil-ativo { background: rgba(24, 154, 211,0.06); border-color: rgba(24, 154, 211,0.45); }
    .calc-fil-combo.calc-fil-combo-aberto { border-color: #189AD3; box-shadow: 0 0 0 3px rgba(24, 154, 211,0.15); }
    .calc-fil-display { width: 100%; height: 38px; display: flex; align-items: center; justify-content: space-between; padding: 0 10px 0 12px; background: transparent; border: none; font-family: inherit; font-size: 12.5px; color: var(--ink); cursor: pointer; text-align: left; }
    .calc-fil-display:focus { outline: none; }
    .calc-fil-valor { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .calc-fil-caret { color: var(--ink-faint); font-size: 11px; margin-left: 6px; transition: transform 200ms ease; }
    .calc-fil-combo-aberto .calc-fil-caret { transform: rotate(180deg); color: #107DAC; }
    /* V920: a janela cresce pro NOME CABER NUMA LINHA SÓ (sem quebra) —
       largura mínima = o campo; máxima generosa; nunca menor que o campo */
    .calc-fil-opcoes {
      position: absolute; top: calc(100% + 6px); left: 0; right: auto; list-style: none; margin: 0; padding: 6px;
      min-width: 100%; width: max-content; max-width: min(92vw, 680px);
      background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 50; max-height: 280px; overflow-y: auto; overflow-x: auto;
      animation: aud-fil-fadein 140ms ease;
    }
    @keyframes aud-fil-fadein { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .calc-fil-opt { display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-size: 12.5px; color: var(--ink); cursor: pointer; border-radius: 6px; transition: background 120ms; }
    .calc-fil-opt:hover { background: rgba(24, 154, 211,0.08); }
    .calc-fil-opt-ativa { background: rgba(24, 154, 211,0.12); color: #107DAC; font-weight: 600; }
    .calc-fil-opt-check { display: inline-block; width: 14px; color: #189AD3; font-weight: 700; }
  `;

  // V132.38: expõe a matriz auditada de uma competência pro módulo Relatórios.
  // Reaproveita exatamente a mesma lógica da Auditoria (auditar + snapshot),
  // recarregando os caches da Base/Produção pra refletir o estado atual.
  function matrizDaCompetencia(competencia) {
    if (!competencia) return [];
    // V492: memoizado por (competencia | Banco._versao). Antes, CADA render da
    // aba Honorário zerava todos os caches do módulo e re-rodava auditar()
    // completo. Qualquer gravação incrementa Banco._versao → invalida sozinho.
    const key = competencia + '|' + (Banco._versao || 0);
    if (_matrizCache.key === key) return _matrizCache.linhas;
    // V601: de volta a UM slot (o LRU de 3 meses da V597 guardava matrizes
    // completas de ~24 mil linhas cada — na base real estourava a memória da
    // aba e congelava tudo). A reentrada rápida nas telas continua garantida
    // pelos gates por versão (V597) — que são o conserto de verdade.
    //
    // V859: estes caches NÃO são do mês — são do BANCO (papéis, Base Tabela,
    // versões da tabela e os mapas da produção, todos indexados por admissão).
    // Zerá-los a cada TROCA DE MÊS obrigava a reler a produção inteira: 1,84s
    // só na varredura de 1 milhão de linhas, em CADA matriz montada. Quem
    // percorre vários meses
    // pagava isso dezenas de vezes — foi o que prendeu a tela por minutos.
    // Agora seguem a mesma regra que o montar() já usava desde a V597: só
    // zeram quando o BANCO muda (Banco._versao carimba toda gravação).
    const vBase = Banco._versao || 0;
    if (_cachesBaseVersao !== vBase) {
      cachePapeis = null;
      baseProcOficial = null; baseProcNorm = null; baseRegras = null; baseExigidos = null;
      versoesTab = null; baseRegrasVer = null;   // V563: recarrega as versões da tabela
      mapProducao = null; mapProducaoQtd = null; mapProducaoCat = null;
      mapCirurgiaDatas = null; palavrasCirurgia = null;
      _cachesBaseVersao = vBase;
    }
    const snap = lerSnapshot(competencia);
    if (!snap) { _matrizCache = { key, linhas: [] }; return []; }   // V492
    const res = auditar(snap, competencia);
    let linhas = (res && Array.isArray(res.linhas)) ? res.linhas : [];
    aplicarOverridesHonorario(competencia, linhas);   // V239 (antes do V844: o médico do HM pode ter sido ajustado)
    linhas = aplicarRegraHonorarioExecutante(linhas); // V844: HM substitui a tabela do executante
    _matrizCache = { key, linhas };   // V492
    try { if (window.__atlasMatrizLRU) { window.__atlasMatrizLRU.clear(); delete window.__atlasMatrizLRU; } } catch (_) {}   // V601: limpa resíduo da V597
    return linhas;
  }

  return { montar, matrizDaCompetencia, competenciasDisponiveis, fmtDataAdm, fonteBadge };
})();

if (typeof window !== 'undefined') window.AtlasAuditoria = AuditoriaApp;
