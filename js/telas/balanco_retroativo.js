// ============================================================================
// MÓDULO TEMPORÁRIO — BALANÇO RETROATIVO (V292)
// Contas "EM NEGOCIAÇÃO / FORA DO PRAZO" que não foram enviadas ao convênio.
// O usuário sobe o .xlsx; o módulo lê a aba BASE TABELA (regras) do PRÓPRIO
// arquivo e, pra cada linha de conta, casa o PRODUTO → BASE TABELA → TOTAL
// (valor fixo = soma de todos os papéis). Soma tudo → total a repassar.
//
// Reproduz exatamente a coluna REPASSE do arquivo (validado: R$ 407.912,75).
// É TEMPORÁRIO — vive como aba dentro do módulo SISTEMA (só adm.atlas).
// Pra remover depois: tirar o <script> do index.html, a aba no sistema.js
// e este arquivo.
// ============================================================================
(function () {
  'use strict';

  // ---- núcleo de cálculo (testável de forma isolada) ----------------------
  function norm(s) {
    if (s == null) return '';
    s = String(s).toUpperCase().trim();
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // tira acentos
    s = s.replace(/\s+/g, ' ');
    return s;
  }

  // acha a linha do cabeçalho (procura nas primeiras 20 linhas) onde TODOS os
  // termos aparecem como célula (exata ou contida)
  function acharCabecalho(matriz, termos) {
    const lim = Math.min(matriz.length, 20);
    for (let i = 0; i < lim; i++) {
      const linha = (matriz[i] || []).map(norm);
      const ok = termos.every(t => linha.some(c => c === t || c.indexOf(t) !== -1));
      if (ok) return i;
    }
    return -1;
  }

  // índice da coluna: tenta match exato, depois "contém"
  function colDe(hdrNorm, alvos) {
    for (const a of alvos) { const i = hdrNorm.indexOf(a); if (i !== -1) return i; }
    for (const a of alvos) { const i = hdrNorm.findIndex(c => c.indexOf(a) !== -1); if (i !== -1) return i; }
    return -1;
  }

  // monta o dicionário PROCEDIMENTO(norm) -> TOTAL a partir da aba BASE TABELA
  function montarBaseTabela(sheets) {
    for (const nome of Object.keys(sheets)) {
      const m = sheets[nome];
      const h = acharCabecalho(m, ['PROCEDIMENTO', 'TOTAL']);
      if (h === -1) continue;
      const hdr = (m[h] || []).map(norm);
      const ehContas = hdr.includes('PRODUTO') || hdr.some(c => c.indexOf('VALOR CONSUMO') !== -1);
      if (!hdr.includes('PROCEDIMENTO') || !hdr.includes('TOTAL') || ehContas) continue;
      const cProc = colDe(hdr, ['PROCEDIMENTO']);
      const cTot = colDe(hdr, ['TOTAL']);
      const base = {};
      for (let i = h + 1; i < m.length; i++) {
        const r = m[i]; if (!r) continue;
        const p = norm(r[cProc]); const t = Number(r[cTot]);
        if (p && isFinite(t) && !(p in base)) base[p] = t;
      }
      if (Object.keys(base).length) return { base, aba: nome };
    }
    return { base: {}, aba: null };
  }

  // acha as abas de contas (PRODUTO + VALOR CONSUMO/PROCEDIMENTO PRINCIPAL).
  // Se existe a aba GERAL (consolidada), usa SÓ ela — senão somaria em dobro
  // com as abas por convênio.
  function acharAbasContas(sheets) {
    const contas = []; let geral = null;
    for (const nome of Object.keys(sheets)) {
      const m = sheets[nome];
      const h = acharCabecalho(m, ['PRODUTO']);
      if (h === -1) continue;
      const hdr = (m[h] || []).map(norm);
      const ehContas = hdr.includes('PRODUTO') &&
        hdr.some(c => c.indexOf('VALOR CONSUMO') !== -1 || c.indexOf('PROCEDIMENTO PRINCIPAL') !== -1);
      if (!ehContas) continue;
      const info = { nome, headerRow: h, hdr };
      contas.push(info);
      if (norm(nome).indexOf('GERAL') !== -1) geral = info;
    }
    return geral ? [geral] : contas;
  }

  // V630: VIGÊNCIA DAS VERSÕES DA BASE TABELA — cada linha usa a versão
  // vigente na SUA Data Admissão (mesma regra do motor do Calcular). Sem
  // versões publicadas → tabela viva. Procedimento sem regra ALGUMA na versão
  // (novo, cadastrado depois) → fallback pra tabela viva (padrão V627/V629).
  function dataIsoDe(v) {
    if (v == null || v === '') return '';
    const serial = (n) => {
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      const p = (x) => String(x).padStart(2, '0');
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    };
    if (typeof v === 'number' && isFinite(v)) return v > 20000 && v < 80000 ? serial(v) : '';
    if (v instanceof Date && !isNaN(v.getTime())) {       // cellDates ligado em algum caminho
      const p = (x) => String(x).padStart(2, '0');
      return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
    }
    const s = String(v).trim();
    // V632: serial que veio como TEXTO ("45602" / "45602.0")
    if (/^\d{4,5}([.,]\d+)?$/.test(s)) {
      const n = Number(s.replace(',', '.'));
      if (isFinite(n) && n > 20000 && n < 80000) return serial(n);
    }
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    // V632: aceita hora depois da data ("06/11/2024 08:23")
    const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (br) {
      const ano = br[3].length === 2 ? '20' + br[3] : br[3];
      return `${ano}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
    }
    return '';
  }
  function montarVersoesBalanco() {
    try {
      if (!temBanco()) return null;
      if (!(window.AtlasVersoesTabela && window.AtlasVersoesTabela.garantir())) return null;
      const vs = q(`SELECT id, numero, data_vigencia FROM tabela_versoes ORDER BY data_vigencia, id`);
      if (!vs.length) return null;
      const cache = new Map();
      const regrasDe = (vid) => {
        let m = cache.get(vid);
        if (m) return m;
        m = { regras: new Map(), procs: new Set() };
        for (const r of q(`SELECT h.procedimento_id, h.papel_id, h.fonte_pagadora, h.valor, h.percentual
                             FROM tabela_repasse_hist h
                             JOIN procedimentos_hist ph ON ph.versao_id = h.versao_id AND ph.procedimento_id = h.procedimento_id
                            WHERE h.versao_id = ? AND h.ativo = 1 AND ph.repassavel = 1`, [vid])) {
          const k = r.procedimento_id + '|' + r.papel_id + '|' + normAtlas(r.fonte_pagadora);
          if (!m.regras.has(k)) m.regras.set(k, r);
          m.procs.add(r.procedimento_id);
        }
        cache.set(vid, m);
        return m;
      };
      // V636: a PADRÃO é a versão de MENOR NÚMERO (1.0) — não a de vigência
      // mais antiga. Se a 1.0 foi publicada com vigência POSTERIOR à da 2.0
      // (ordem de publicação trocada), uma admissão de 2024 — anterior a TODAS
      // as vigências — caía na 2.0. Antes de todas as vigências (ou sem data
      // legível) vale SEMPRE a 1.0 (a padrão).
      const baseline = vs.reduce((a, b) =>
        (Number(String(b.numero).replace(',', '.')) || 0) < (Number(String(a.numero).replace(',', '.')) || 0) ? b : a, vs[0]);
      const versaoDe = (dataIso) => {
        const d = String(dataIso || '').slice(0, 10);
        let v = null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          for (const c of vs) { if (c.data_vigencia <= d) v = c; else break; }
        }
        return v || baseline;   // sem data OU antes de todas as vigências → padrão (1.0)
      };
      // V639: procedimentos publicados em QUALQUER versão. A tabela viva só
      // entra pra procedimento que NUNCA existiu em versão alguma (realmente
      // novo). Proc que existe só numa versão (ex.: entrou na 2.0) tem
      // vigência própria — datas anteriores NÃO caem na viva.
      let procsPub = null;
      const procPublicado = (procId) => {
        if (!procsPub) {
          procsPub = new Set();
          try {
            for (const r of q(`SELECT DISTINCT procedimento_id FROM tabela_repasse_hist WHERE ativo = 1`)) procsPub.add(r.procedimento_id);
          } catch (_) {}
        }
        return procsPub.has(procId);
      };
      return { versaoDe, regrasDe, procPublicado, numeros: vs.map(v => v.numero), lista: vs };
    } catch (e) { console.warn('[balanco] montarVersoesBalanco:', e); return null; }
  }

  // V628: BASE TABELA DA FERRAMENTA como fonte das regras — quando o arquivo
  // NÃO traz a aba "BASE TABELA" embutida, o repasse de cada produto é
  // calculado pelas regras cadastradas no ATLAS (todos os papéis, fonte
  // CONVENIO com fallback TODAS): valor fixo somado + percentuais × valor
  // consumo da linha. Match do produto = exato + sinônimos (igual ao Calcular).
  function montarBaseAtlas() {
    if (!temBanco()) return null;
    try {
      const aux = carregarAuxBanco();
      // escolhe UMA regra por procedimento+papel (CONVENIO vence TODAS)
      const porProcPapel = new Map();
      for (const [k, r] of aux.regras) {
        const parts = k.split('|');
        const fonte = parts[2];
        if (fonte !== 'CONVENIO' && fonte !== 'TODAS') continue;
        const kk = parts[0] + '|' + parts[1];
        const atual = porProcPapel.get(kk);
        if (!atual || (normAtlas(atual.fonte_pagadora) === 'TODAS' && fonte === 'CONVENIO')) {
          porProcPapel.set(kk, r);
        }
      }
      const fixoPorProc = new Map();   // procId → soma dos R$ fixos de todos os papéis
      const pctPorProc = new Map();    // procId → soma dos percentuais (aplicados no valor consumo)
      for (const r of porProcPapel.values()) {
        const id = r.procedimento_id;
        if (r.valor != null) fixoPorProc.set(id, (fixoPorProc.get(id) || 0) + (Number(r.valor) || 0));
        if (r.percentual != null) pctPorProc.set(id, (pctPorProc.get(id) || 0) + (Number(r.percentual) || 0));
      }
      if (!fixoPorProc.size && !pctPorProc.size) return null;
      return { aux, fixoPorProc, pctPorProc,
               nProcs: new Set([...fixoPorProc.keys(), ...pctPorProc.keys()]).size };
    } catch (e) { console.warn('[balanco] montarBaseAtlas:', e); return null; }
  }

  function calcular(sheets) {
    let { base, aba: abaBase } = montarBaseTabela(sheets);
    // V628: sem aba embutida → regras da ferramenta (Base Tabela do ATLAS)
    let atlas = null, verInfo = null;
    if (!abaBase) {
      atlas = montarBaseAtlas();
      verInfo = atlas ? montarVersoesBalanco() : null;   // V630: vigências
      if (atlas) abaBase = `Base Tabela da ferramenta (${atlas.nProcs} procedimentos com regra${verInfo ? ` · vigências ${verInfo.numeros.join(', ')} respeitadas pela Data Admissão` : ''})`;
    }
    // V630: somas (fixo + %) por procedimento DE CADA VERSÃO (lazy, CONVENIO vence TODAS)
    // V631: UNIÃO com a tabela viva — a versão congelada manda onde tem regra;
    // combinações proc+papel sem regra na versão são preenchidas pela viva
    const somasVersao = new Map();
    const escolherPorProcPapel = (regrasMap) => {
      const m = new Map();
      for (const [k, r] of regrasMap) {
        const parts = k.split('|');
        const fonte = parts[2];
        if (fonte !== 'CONVENIO' && fonte !== 'TODAS') continue;
        const kk = parts[0] + '|' + parts[1];
        const atual = m.get(kk);
        if (!atual || (normAtlas(atual.fonte_pagadora) === 'TODAS' && fonte === 'CONVENIO')) m.set(kk, r);
      }
      return m;
    };
    function somasDaVersao(vid) {
      let s = somasVersao.get(vid);
      if (s) return s;
      // V632: SOMENTE as regras da versão congelada; a viva não completa proc antigo
      const rv = verInfo.regrasDe(vid);
      const cong = escolherPorProcPapel(rv.regras);
      s = { fixo: new Map(), pct: new Map(), procs: rv.procs };
      for (const r of cong.values()) {
        const id = r.procedimento_id;
        if (r.valor != null) s.fixo.set(id, (s.fixo.get(id) || 0) + (Number(r.valor) || 0));
        if (r.percentual != null) s.pct.set(id, (s.pct.get(id) || 0) + (Number(r.percentual) || 0));
      }
      somasVersao.set(vid, s);
      return s;
    }
    const abas = acharAbasContas(sheets);
    let total = 0, nLinhas = 0, nCasou = 0, semMatch = 0, valorConsumo = 0;
    let semData = 0;   // V632: linhas sem Data Admissão legível (caem na versão padrão 1.0)
    const porConvenio = {};
    const porProcedimento = {};
    const naoCasaramTop = {};
    const linhas = [];
    for (const info of abas) {
      const m = sheets[info.nome];
      const cProd = colDe(info.hdr, ['PRODUTO']);
      const cConv = colDe(info.hdr, ['CONVENIO']);
      const cVal = colDe(info.hdr, ['VALOR CONSUMO', 'VALOR']);
      const cProcP = colDe(info.hdr, ['PROCEDIMENTO PRINCIPAL', 'PROCEDIMENTO']);
      const cAdm = colDe(info.hdr, ['COD ADMISSAO', 'CODIGO ADMISSAO', 'COD. ADMISSAO', 'ADMISSAO']);
      const cData = colDe(info.hdr, ['DATA ADMISSAO', 'DATA']);   // V630: vigência por linha
      for (let i = info.headerRow + 1; i < m.length; i++) {
        const r = m[i]; if (!r) continue;
        const prod = r[cProd];
        if (prod == null || norm(prod) === '') continue;
        nLinhas++;
        const vc = (cVal !== -1) ? Number(r[cVal]) : NaN;
        const vcNum = isFinite(vc) ? vc : 0;
        valorConsumo += vcNum;
        // V628: com aba embutida usa o TOTAL dela; senão, regras da ferramenta
        // V630: com versões publicadas, vale a versão VIGENTE na Data Admissão
        const dataAdm = (cData !== -1) ? dataIsoDe(r[cData]) : '';
        if (atlas && verInfo && !dataAdm) semData++;   // V632
        let v = 0;
        if (atlas) {
          const pAtlas = acharProc(prod, atlas.aux);
          if (pAtlas) {
            let fixo = null, pct = null;
            if (verInfo) {   // V632: versão vigente na data manda; viva SÓ pra proc fora da versão
              const vs = somasDaVersao(verInfo.versaoDe(dataAdm).id);
              if (vs.procs.has(pAtlas.id)) { fixo = vs.fixo.get(pAtlas.id) || 0; pct = vs.pct.get(pAtlas.id) || 0; }
              // V639: proc publicado em OUTRA versão → não cai na viva
              else if (verInfo.procPublicado && verInfo.procPublicado(pAtlas.id)) { fixo = 0; pct = 0; }
            }
            if (fixo == null) {
              fixo = atlas.fixoPorProc.get(pAtlas.id) || 0;
              pct = atlas.pctPorProc.get(pAtlas.id) || 0;
            }
            v = fixo + pct * vcNum;
          }
        } else {
          v = base[norm(prod)] || 0;
        }
        total += v;
        const conv = (cConv !== -1 && r[cConv] != null) ? String(r[cConv]).trim() : '—';
        const procP = (cProcP !== -1 && r[cProcP] != null) ? String(r[cProcP]).trim() : '';
        const adm = (cAdm !== -1 && r[cAdm] != null) ? String(r[cAdm]).trim() : '';
        const prodTxt = String(prod).trim();
        linhas.push({ admissao: adm, convenio: conv, procedimento: procP, produto: prodTxt, valorConsumo: vcNum, repasse: v, dataAdm });
        if (v > 0) {
          nCasou++;
          porConvenio[conv] = (porConvenio[conv] || 0) + v;
          const k = norm(prod);
          if (!porProcedimento[k]) porProcedimento[k] = { nome: prodTxt, qtd: 0, repasse: 0 };
          porProcedimento[k].qtd++; porProcedimento[k].repasse += v;
        } else {
          semMatch++;
          const k = norm(prod);
          naoCasaramTop[k] = (naoCasaramTop[k] || 0) + 1;
        }
      }
    }
    return {
      total, nLinhas, nCasou, semMatch, valorConsumo,
      porConvenio, porProcedimento, linhas, abaBase,
      nBase: atlas ? atlas.nProcs : Object.keys(base).length,
      usouBaseFerramenta: !!atlas,   // V628
      semData,                       // V632
      abasContas: abas.map(a => a.nome), naoCasaramTop
    };
  }

  // ===========================================================================
  // MOTOR POR MÉDICO (V296) — cruza as contas elegíveis com a PRODUÇÃO já
  // importada (linhas_producao) e aplica as regras do ATLAS (tabela_repasse +
  // exceções), atribuindo o valor de cada papel ao médico certo.
  // Espelha a normalização e as buscas do Calcular pra ficar consistente.
  // Colapsos: Executante = cirurgião↔médico (cirurgião prevalece);
  //           Referência = indicante↔solicitante (indicante prevalece);
  //           Auxiliar paga no nome do executante.
  // ===========================================================================

  // normalização IDÊNTICA à do Calcular (acentos, maiúsculas, pontuação→espaço)
  function normAtlas(s) {
    if (s == null) return '';
    return String(s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function temBanco() {
    return (typeof window.Banco !== 'undefined' && Banco && typeof Banco.query === 'function');
  }
  function q(sql, params) {
    try { return Banco.query(sql, params || []) || []; } catch (e) { console.warn('[balanco] query falhou:', e); return []; }
  }

  // monta os mapas de cadastro (procedimentos, sinônimos, papéis, regras, médicos, exceções)
  function carregarAuxBanco() {
    const aux = {
      procExato: new Map(), sinProc: new Map(), procPorId: new Map(),
      papelId: new Map(), regras: new Map(), procsComRegra: new Set(),
      medExato: new Map(), sinMed: new Map(), medPorId: new Map(), excecoes: new Map()
    };
    for (const p of q(`SELECT id, nome_oficial, nome_normalizado FROM procedimentos`)) {
      const n = normAtlas(p.nome_normalizado || p.nome_oficial);
      if (n && !aux.procExato.has(n)) aux.procExato.set(n, p);
      const no = normAtlas(p.nome_oficial);
      if (no && !aux.procExato.has(no)) aux.procExato.set(no, p);
      aux.procPorId.set(p.id, p);
    }
    for (const s of q(`SELECT procedimento_id, grafia, grafia_normalizada FROM sinonimos_proc`)) {
      const n = normAtlas(s.grafia_normalizada || s.grafia);
      if (n && !aux.sinProc.has(n)) aux.sinProc.set(n, s.procedimento_id);
    }
    for (const p of q(`SELECT id, nome FROM papeis`)) aux.papelId.set(normAtlas(p.nome), p.id);
    aux.exigidos = new Map();   // `procId|fonteN` → Set(papelId) — papéis exigidos pela BASE TABELA
    for (const r of q(`SELECT t.procedimento_id, t.papel_id, t.fonte_pagadora, t.valor, t.percentual
                       FROM tabela_repasse t JOIN procedimentos p ON p.id = t.procedimento_id
                       WHERE t.ativo = 1 AND p.repassavel = 1`)) {
      const k = r.procedimento_id + '|' + r.papel_id + '|' + normAtlas(r.fonte_pagadora);
      if (!aux.regras.has(k)) aux.regras.set(k, r);
      aux.procsComRegra.add(r.procedimento_id);
      const ke = r.procedimento_id + '|' + normAtlas(r.fonte_pagadora);
      if (!aux.exigidos.has(ke)) aux.exigidos.set(ke, new Set());
      aux.exigidos.get(ke).add(r.papel_id);
    }
    for (const m of q(`SELECT id, nome_oficial, nome_normalizado, tipo_vinculo FROM medicos WHERE ativo = 1`)) {
      const n = normAtlas(m.nome_normalizado || m.nome_oficial);
      if (n) aux.medExato.set(n, m);
      aux.medPorId.set(m.id, m);
    }
    for (const s of q(`SELECT medico_id, grafia, grafia_normalizada FROM sinonimos_medico`)) {
      const n = normAtlas(s.grafia_normalizada || s.grafia);
      if (n && !aux.sinMed.has(n)) aux.sinMed.set(n, s.medico_id);
    }
    for (const e of q(`SELECT medico_id, procedimento_id, papel_id, fonte_pagadora, valor, percentual
                       FROM tabela_repasse_excecao WHERE ativo = 1`)) {
      aux.excecoes.set(e.medico_id + '|' + e.procedimento_id + '|' + e.papel_id + '|' + normAtlas(e.fonte_pagadora || 'TODAS'), e);
    }
    // DESEMPENHO LC: lista de procedimentos de lentes de contato + percentuais (18/9)
    aux.lcSet = new Set();
    for (const p of q(`SELECT nome, nome_normalizado FROM procedimentos_lentes WHERE ativo = 1`)) {
      const n = normAtlas(p.nome_normalizado || p.nome); if (n) aux.lcSet.add(n);
      const no = normAtlas(p.nome); if (no) aux.lcSet.add(no);
    }
    const cfgLC = {};
    for (const r of q(`SELECT chave, valor FROM config_lentes_contato`)) cfgLC[r.chave] = Number(r.valor);
    aux.lcPctExec = (cfgLC['PERCENTUAL_EXECUTANTE'] != null ? cfgLC['PERCENTUAL_EXECUTANTE'] : 18);
    aux.lcPctIndic = (cfgLC['PERCENTUAL_INDICANTE'] != null ? cfgLC['PERCENTUAL_INDICANTE'] : 9);

    // DESEMPENHO OPME: termos elegíveis + pct geral + regra por médico
    aux.opmeTermos = [];
    for (const t of q(`SELECT termo FROM opme_termos_elegiveis WHERE ativo = 1`)) {
      const n = normAtlas(t.termo); if (n) aux.opmeTermos.push(n);
    }
    // COLA BIOLÓGICA sempre paga (adicionada à lista, mantendo os demais termos)
    if (aux.opmeTermos.indexOf('COLA BIOLOGICA') === -1) aux.opmeTermos.push('COLA BIOLOGICA');
    aux.opmePctGeral = 10;
    const rPct = q(`SELECT valor FROM config_opme WHERE chave = 'PCT_GERAL'`)[0];
    if (rPct && rPct.valor != null) aux.opmePctGeral = Number(rPct.valor) || 10;
    aux.opmeRegraMed = new Map();   // nome_normalizado → pct
    for (const r of q(`SELECT nome_normalizado, pct FROM opme_regra_medico`)) {
      aux.opmeRegraMed.set(normAtlas(r.nome_normalizado), Number(r.pct));
    }

    // DESEMPENHO LIO (substitui o 10% pros OPME de lente intra-ocular, no convênio):
    // 18% executante + 2,5% indicante (quando indicante ≠ executante)
    aux.lioTermos = ['LIO', 'LENTE INTRA OCULAR', 'SERVICO DE IMPLANTE'];
    aux.lioPctExec = 18; aux.lioPctIndic = 2.5;
    for (const r of q(`SELECT chave, valor FROM config_lio WHERE chave IN ('PCT_EXECUTANTE_GERAL','PCT_INDICANTE')`)) {
      const v = parseFloat(r.valor);
      if (!isNaN(v)) { if (r.chave === 'PCT_EXECUTANTE_GERAL') aux.lioPctExec = v; if (r.chave === 'PCT_INDICANTE') aux.lioPctIndic = v; }
    }

    // DESEMPENHO ESTRABISMO: valores fixos + marcações (qtd 1/2 por admissão)
    const cfgE = {};
    for (const r of q(`SELECT chave, valor FROM config_estrabismo`)) cfgE[r.chave] = Number(r.valor);
    aux.estr = {
      qtd1Conv: cfgE['VALOR_QTD1_CONVENIO'] != null ? cfgE['VALOR_QTD1_CONVENIO'] : 1260,
      qtd2Conv: cfgE['VALOR_QTD2_CONVENIO'] != null ? cfgE['VALOR_QTD2_CONVENIO'] : 1680,
      qtd1Sus:  cfgE['VALOR_QTD1_SUS']      != null ? cfgE['VALOR_QTD1_SUS']      : 300,
      qtd2Sus:  cfgE['VALOR_QTD2_SUS']      != null ? cfgE['VALOR_QTD2_SUS']      : 300
    };
    aux.marcEstr = new Map();   // `competencia|cod_admissao` → qtd
    for (const m of q(`SELECT cod_admissao, competencia, quantidade FROM marcacoes_estrabismo`)) {
      aux.marcEstr.set(m.competencia + '|' + String(m.cod_admissao).trim(), Number(m.quantidade) || 0);
    }

    // PACOTE CONSULTA por convênio (mãe = consulta substitui base; filha = exames só se médico tem 'Retina')
    aux.mapPacotes = new Map();
    for (const p of q(`SELECT id, convenio_nome, convenio_label, valor_consulta, percentual_consulta, valor, percentual, nome_detalhe FROM pacote_convenio WHERE ativo = 1`)) {
      aux.mapPacotes.set(normAtlas(p.convenio_nome), p);
    }
    aux.mapAliasPacote = new Map();
    for (const a of q(`SELECT a.alias_nome, p.id, p.convenio_nome, p.convenio_label, p.valor_consulta, p.percentual_consulta, p.valor, p.percentual, p.nome_detalhe
                       FROM pacote_alias a JOIN pacote_convenio p ON p.id = a.pacote_id WHERE p.ativo = 1`)) {
      aux.mapAliasPacote.set(normAtlas(a.alias_nome), a);
    }
    aux.mapProcsPacote = new Map();
    for (const r of q(`SELECT pacote_id, procedimento_id FROM pacote_procedimento WHERE ativo = 1`)) {
      if (!aux.mapProcsPacote.has(r.pacote_id)) aux.mapProcsPacote.set(r.pacote_id, new Set());
      aux.mapProcsPacote.get(r.pacote_id).add(r.procedimento_id);
    }
    aux.medicosEspPacote = new Set();
    let espIds = [];
    const cfgEsp = q(`SELECT valor FROM config_sistema WHERE chave='PACOTE_CONSULTA_ESPECIALIDADES'`)[0];
    if (cfgEsp && cfgEsp.valor) { try { const arr = JSON.parse(cfgEsp.valor); if (Array.isArray(arr)) espIds = arr.map(Number).filter(n => !isNaN(n)); } catch (_) {} }
    if (!espIds.length) {
      const ret = q(`SELECT id FROM especialidades WHERE UPPER(TRIM(nome))='RETINA'`)[0];
      if (ret && ret.id != null) espIds = [ret.id];
    }
    if (espIds.length) {
      for (const rr of q(`SELECT DISTINCT medico_id AS mid FROM medico_especialidades WHERE especialidade_id IN (${espIds.join(',')})`)) {
        if (rr.mid != null) aux.medicosEspPacote.add(rr.mid);
      }
    }
    // palavras-chave de cirurgia (pra colapsar "PACOTE X" + "X" da mesma cirurgia)
    aux.palavrasCir = [];
    for (const r of q(`SELECT palavra FROM config_palavras_cirurgia ORDER BY palavra`)) {
      const n = normAtlas(r.palavra); if (n) aux.palavrasCir.push(n);
    }
    if (!aux.palavrasCir.length) aux.palavrasCir = ['FACECTOMIA', 'CAPSULOTOMIA'];
    return aux;
  }

  // procedimento: exato → sinônimo (sem fuzzy nesta 1ª versão)
  function acharProc(texto, aux) {
    const n = normAtlas(texto); if (!n) return null;
    if (aux.procExato.has(n)) return aux.procExato.get(n);
    if (aux.sinProc.has(n)) return aux.procPorId.get(aux.sinProc.get(n)) || null;
    return null;
  }
  // médico: exato → sinônimo
  function acharMed(nome, aux) {
    const n = normAtlas(nome); if (!n) return null;
    if (aux.medExato.has(n)) return aux.medExato.get(n);
    if (aux.sinMed.has(n)) return aux.medPorId.get(aux.sinMed.get(n)) || null;
    return null;
  }
  function regraDe(aux, procId, papelId, fonteN) {
    return aux.regras.get(procId + '|' + papelId + '|' + fonteN)
        || aux.regras.get(procId + '|' + papelId + '|TODAS') || null;
  }
  function excDe(aux, medId, procId, papelId, fonteN) {
    if (medId == null) return null;
    return aux.excecoes.get(medId + '|' + procId + '|' + papelId + '|' + fonteN)
        || aux.excecoes.get(medId + '|' + procId + '|' + papelId + '|TODAS') || null;
  }
  function fonteDe(tipoRec, convenio) {
    const t = normAtlas(tipoRec || '');
    if (t.indexOf('PARTICULAR') !== -1) return 'PARTICULAR';
    if (t === 'SUS' || t.indexOf('SUS') !== -1) return 'SUS';
    if (t.indexOf('CONVENIO') !== -1) return 'CONVENIO';
    return 'CONVENIO'; // contas não enviadas ao convênio → padrão CONVENIO
  }
  // a linha de produção tem algum profissional?
  function temProf(r) {
    return [r.cirurgiao, r.medico, r.indicante, r.solicitante, r.auxiliar_1, r.auxiliar_2, r.auxiliar_sadt]
      .some(x => x && String(x).trim());
  }
  // a linha de produção é material/OPME/taxa (não procedimento)?
  function ehMaterialOpme(r) {
    const c = normAtlas(r.classificacao_produto);
    return c === 'OPME' || c === 'MATERIAL' || c === 'TAXA' || c === 'MATERIAIS';
  }

  // calcula o repasse POR MÉDICO a partir do resultado do parse das contas
  function calcularPorMedico(res) {
    if (!temBanco()) return { erro: 'Banco do ATLAS indisponível.' };
    const aux = carregarAuxBanco();
    // V630: busca de regra respeitando a VERSÃO vigente na data da admissão.
    // Proc sem regra alguma na versão (novo) → cai na viva (padrão V627/V629).
    const verInfo = montarVersoesBalanco();
    // V635: rastro da fonte aplicada (versão X / tabela viva / exceção) — vai
    // pra matriz, pro usuário AUDITAR qual regra pagou cada linha
    let _fonteRegra = null;
    const regraDeData = (dataAdm, procId, papelId, fonteN) => {
      _fonteRegra = null;
      if (verInfo) {
        // V632: contas RETROATIVAS seguem SOMENTE a versão vigente na data.
        // A tabela viva só entra se o procedimento NEM EXISTE na versão
        // (procedimento novo) — nunca pra completar papel/fonte de proc antigo.
        const ver = verInfo.versaoDe(dataIsoDe(dataAdm));
        const rv = verInfo.regrasDe(ver.id);
        if (rv.procs.has(procId)) {
          _fonteRegra = 'v' + ver.numero;
          return rv.regras.get(procId + '|' + papelId + '|' + fonteN)
              || rv.regras.get(procId + '|' + papelId + '|TODAS') || null;
        }
        // V639: proc publicado em OUTRA versão (vigência própria — ex.: só
        // entrou na 2.0) → NÃO cai na viva; nesta data ele não tinha regra.
        if (verInfo.procPublicado && verInfo.procPublicado(procId)) return null;
      }
      const r = regraDe(aux, procId, papelId, fonteN);
      if (r) _fonteRegra = 'tabela viva';
      return r;
    };
    const pExec = aux.papelId.get('EXECUTANTE');
    const pAux = aux.papelId.get('AUXILIAR');
    const pLaudo = aux.papelId.get('MEDICO LAUDO');
    const pSolic = aux.papelId.get('SOLICITANTE');
    const pIndic = aux.papelId.get('INDICANTE');

    // carrega TODA a produção UMA vez (1 query) → Map por admissão
    // chave primária = código exato (trim); chave secundária = só dígitos sem zero à
    // esquerda (cobre casos de "35920841.0", zero à esquerda, etc.)
    const chaveNum = (x) => { const d = String(x == null ? '' : x).trim().replace(/\.0+$/, '').replace(/\D/g, ''); return d.replace(/^0+/, '') || d; };
    const prodPorAdm = new Map();
    const prodPorAdmNum = new Map();
    for (const r of q(`SELECT TRIM(cod_admissao) AS _adm, produto, cirurgiao, medico, indicante,
                              solicitante, auxiliar_1, auxiliar_2, auxiliar_sadt, perfil_particular,
                              tipo_recebimento, valor, competencia, data_admissao,
                              classificacao_produto, convenio, categoria, quantidade
                       FROM linhas_producao`)) {
      const a = String(r._adm || '').trim();
      if (!a) continue;
      if (!prodPorAdm.has(a)) prodPorAdm.set(a, []);
      prodPorAdm.get(a).push(r);
      const an = chaveNum(a);
      if (an) { if (!prodPorAdmNum.has(an)) prodPorAdmNum.set(an, []); prodPorAdmNum.get(an).push(r); }
    }
    const prodDaAdmissao = (adm) => {
      const k = String(adm == null ? '' : adm).trim();
      if (prodPorAdm.has(k)) return prodPorAdm.get(k);
      const kn = chaveNum(k);
      return (kn && prodPorAdmNum.get(kn)) || [];
    };
    const vinculoDe = (med) => (med && med.tipo_vinculo) ? String(med.tipo_vinculo).toUpperCase() : null;
    // linha de produção é de Lentes de Contato?
    const ehLinhaLC = (r) => normAtlas(r.categoria) === 'LENTES DE CONTATO' || aux.lcSet.has(normAtlas(r.produto));
    // estrabismo: produto contém ESTRABISMO (fora TAXA/PACOTE)
    const ehEstrabismo = (txt) => { const n = normAtlas(txt); return n.indexOf('ESTRABISMO') !== -1 && n.indexOf('TAXA') === -1 && n.indexOf('PACOTE') === -1; };
    const valorEstr = (eSUS, qtd) => { if (!qtd) return 0; return eSUS ? (qtd === 1 ? aux.estr.qtd1Sus : aux.estr.qtd2Sus) : (qtd === 1 ? aux.estr.qtd1Conv : aux.estr.qtd2Conv); };
    // OPME elegível = classificacao OPME + produto/procedimento bate num termo elegível
    const ehOpmeElegivel = (txt) => { const n = normAtlas(txt); return aux.opmeTermos.some(t => n.indexOf(t) !== -1); };
    // LIO = produto bate num termo de lente intra-ocular (regra própria 18%/2,5% no convênio)
    const ehLio = (txt) => { const n = normAtlas(txt); return aux.lioTermos.some(t => n.indexOf(t) !== -1); };
    const ehConvenio = (tipo) => normAtlas(tipo).indexOf('CONVENIO') !== -1;
    // pacote consulta: acha a regra do convênio (exato → alias → prefixo)
    const matchPacote = (convStr) => {
      const cn = normAtlas(convStr || ''); if (!cn) return null;
      if (aux.mapPacotes.has(cn)) return aux.mapPacotes.get(cn);
      if (aux.mapAliasPacote.has(cn)) return aux.mapAliasPacote.get(cn);
      for (const [chave, p] of aux.mapPacotes.entries()) { if (chave && (cn === chave || cn.startsWith(chave + ' '))) return p; }
      return null;
    };
    // procedimento qualifica pro pacote: whitelist (se houver) senão contém "CONSULTA"
    const pacoteQualifica = (pacote, proc, produtoTxt) => {
      const procs = aux.mapProcsPacote.get(pacote.id);
      if (procs && procs.size > 0) return !!(proc && proc.id && procs.has(proc.id));
      return normAtlas(produtoTxt).indexOf('CONSULTA') !== -1;
    };
    const opmePctDe = (med, nomeProf) => {
      const chave = normAtlas((med && med.nome_normalizado) || nomeProf);
      if (aux.opmeRegraMed.has(chave)) return aux.opmeRegraMed.get(chave);
      return aux.opmePctGeral;
    };

    const linhas = [];          // matriz (1 linha por papel pago, ou órfã) — padrão Auditoria
    const opme = [];            // OPME (classificacao_produto=OPME) das admissões do balanço
    const mesesSet = new Set();
    let nElegiveis = 0, nProcessadas = 0, nOrfas = 0, nSubstituidos = 0;
    const consumido = new Set();   // linhas de produção já usadas (evita usar a mesma 2x)

    for (const l of res.linhas) {
      const proc = acharProc(l.produto, aux);
      const ehLCrep = aux.lcSet.has(normAtlas(l.produto)) || (proc && aux.lcSet.has(normAtlas(proc.nome_oficial)));

      // ===== DESEMPENHO LC (substitui a regra-base): 18% executante + 9% indicante, só IH =====
      if (ehLCrep) {
        nElegiveis++;
        const rowsProd = l.admissao ? prodDaAdmissao(l.admissao) : [];
        const prodNlc = normAtlas(l.produto);
        let prLC = rowsProd.find(r => !consumido.has(r) && ehLinhaLC(r) && normAtlas(r.produto) === prodNlc)
                || rowsProd.find(r => !consumido.has(r) && ehLinhaLC(r)) || null;
        if (!prLC) {
          nOrfas++;
          const motivo = !l.admissao ? 'conta sem código de admissão'
            : (!rowsProd.length ? 'admissão não está na produção importada'
              : 'produção da admissão sem linha de Lentes de Contato');
          linhas.push({ status: 'sem_producao', admissao: l.admissao || '', data: '', profissional: '',
            papel: '', papelId: null, procedimento: ((proc && proc.nome_oficial) || l.produto), produto: l.produto,
            origem: '', convenio: l.convenio, produzido: 0, repasse: 0, medicoId: null, tipoVinculo: null,
            cadastrado: false, competencia: '', substituido: false, desempenho: 'LC', motivo });
          continue;
        }
        consumido.add(prLC);
        nProcessadas++;
        const vlc = Number(prLC.valor) || 0;
        const compLC = prLC.competencia || ''; if (compLC) mesesSet.add(compLC);
        const convLC = (prLC.convenio && String(prLC.convenio).trim()) || l.convenio;
        const procNomeLC = (proc && proc.nome_oficial) || l.produto;
        const execLC = (prLC.medico && String(prLC.medico).trim()) || (prLC.cirurgiao && String(prLC.cirurgiao).trim()) || '';
        const indicLC = (prLC.indicante && String(prLC.indicante).trim()) || (prLC.solicitante && String(prLC.solicitante).trim()) || '';
        const pagarLC = (profNome, papelId, papelBase, pct) => {
          if (!profNome) return;
          const med = acharMed(profNome, aux);
          const ih = med && (vinculoDe(med) === 'INTERNO' || vinculoDe(med) === 'HIBRIDO');
          const valor = ih ? vlc * (pct / 100) : 0;   // só Interno/Híbrido recebe; externo = R$ 0 informativo
          linhas.push({ status: (med && med.id) ? 'casou' : 'sem_cadastro',
            admissao: l.admissao, data: prLC.data_admissao || '', profissional: med ? med.nome_oficial : profNome,
            papel: papelBase + ' · LC ' + pct + '%', papelId, procedimento: procNomeLC, produto: l.produto,
            origem: 'Convênio', convenio: convLC, produzido: 0, repasse: valor,
            medicoId: (med && med.id) || null, tipoVinculo: vinculoDe(med), cadastrado: !!(med && med.id),
            competencia: compLC, substituido: false, desempenho: 'LC' });
        };
        pagarLC(execLC, pExec, 'Executante', aux.lcPctExec);
        pagarLC(indicLC, pIndic, 'Indicante', aux.lcPctIndic);
        continue;
      }
      // ===== fim LC =====

      // ===== DESEMPENHO ESTRABISMO (substitui a base): valor fixo por cirurgia, marcar qtd 1/2 =====
      if (ehEstrabismo(l.produto) || (proc && ehEstrabismo(proc.nome_oficial))) {
        nElegiveis++;
        const rowsProd = l.admissao ? prodDaAdmissao(l.admissao) : [];
        const prodNe = normAtlas(l.produto);
        const prE = rowsProd.find(r => !consumido.has(r) && ehEstrabismo(r.produto) && normAtlas(r.produto) === prodNe)
                 || rowsProd.find(r => !consumido.has(r) && ehEstrabismo(r.produto)) || null;
        if (!prE) {
          nOrfas++;
          const motivo = !l.admissao ? 'conta sem código de admissão'
            : (!rowsProd.length ? 'admissão não está na produção importada'
              : 'produção da admissão sem linha de Estrabismo');
          linhas.push({ status: 'sem_producao', admissao: l.admissao || '', data: '', profissional: '', papel: '', papelId: null,
            procedimento: ((proc && proc.nome_oficial) || l.produto), produto: l.produto, origem: '', convenio: l.convenio,
            produzido: 0, repasse: 0, medicoId: null, tipoVinculo: null, cadastrado: false, competencia: '', substituido: false, desempenho: 'ESTRABISMO', motivo });
          continue;
        }
        consumido.add(prE);
        nProcessadas++;
        const compE = prE.competencia || ''; if (compE) mesesSet.add(compE);
        const eSUS = normAtlas(prE.tipo_recebimento) === 'SUS';
        const codE = String(l.admissao || '').trim();
        const qtdE = aux.marcEstr.get(compE + '|' + codE) || 0;
        const cir = (prE.cirurgiao && String(prE.cirurgiao).trim()) || (prE.medico && String(prE.medico).trim()) || '';
        const medE = cir ? acharMed(cir, aux) : null;
        linhas.push({ status: (medE && medE.id) ? 'casou' : 'sem_cadastro',
          admissao: l.admissao, data: prE.data_admissao || '', profissional: medE ? medE.nome_oficial : (cir || '(sem cirurgião)'),
          papel: 'Cirurgião · Estrabismo', papelId: pExec, procedimento: ((proc && proc.nome_oficial) || l.produto), produto: l.produto,
          origem: eSUS ? 'SUS' : 'Convênio', convenio: (prE.convenio && String(prE.convenio).trim()) || l.convenio,
          produzido: 0, repasse: valorEstr(eSUS, qtdE), medicoId: (medE && medE.id) || null, tipoVinculo: vinculoDe(medE),
          cadastrado: !!(medE && medE.id), competencia: compE, substituido: false,
          desempenho: 'ESTRABISMO', estrQtd: qtdE, estrSus: eSUS, estrCod: codE, estrComp: compE });
        continue;
      }
      // ===== fim ESTRABISMO =====

      // ===== PACOTE CONSULTA por convênio (substitui base): mãe (consulta) + filha (exames, só 'Retina') =====
      const pacote = proc ? matchPacote(l.convenio) : null;
      if (pacote && pacoteQualifica(pacote, proc, l.produto)) {
        nElegiveis++;
        const rowsProd = l.admissao ? prodDaAdmissao(l.admissao) : [];
        const prodNp = normAtlas(l.produto);
        const prC = rowsProd.find(r => !consumido.has(r) && normAtlas(r.produto) === prodNp)
                 || rowsProd.find(r => !consumido.has(r) && normAtlas(r.produto).indexOf('CONSULTA') !== -1)
                 || rowsProd.find(r => !consumido.has(r) && temProf(r)) || null;
        if (!prC) {
          nOrfas++;
          const motivo = !l.admissao ? 'conta sem código de admissão'
            : (!rowsProd.length ? 'admissão não está na produção importada' : 'produção da admissão sem linha da consulta');
          linhas.push({ status: 'sem_producao', admissao: l.admissao || '', data: '', profissional: '', papel: '', papelId: null,
            procedimento: proc.nome_oficial, produto: l.produto, origem: '', convenio: l.convenio, produzido: 0, repasse: 0,
            medicoId: null, tipoVinculo: null, cadastrado: false, competencia: '', substituido: false, desempenho: 'PACOTE', motivo });
          continue;
        }
        consumido.add(prC);
        nProcessadas++;
        const fonteNp = fonteDe(prC.tipo_recebimento, l.convenio);
        const produzido = Number(prC.valor) || 0;
        const compP = prC.competencia || ''; if (compP) mesesSet.add(compP);
        const convP = (prC.convenio && String(prC.convenio).trim()) || l.convenio;
        const execP = (prC.cirurgiao && String(prC.cirurgiao).trim()) || (prC.medico && String(prC.medico).trim()) || '';
        const medP = execP ? acharMed(execP, aux) : null;
        // MÃE (consulta): valor_consulta ou %×produzido; fallback BASE TABELA do executante
        let valorMae = null;
        if (pacote.valor_consulta != null) valorMae = Number(pacote.valor_consulta) || 0;
        else if (pacote.percentual_consulta != null && produzido > 0) valorMae = produzido * Number(pacote.percentual_consulta);
        if (valorMae == null) {
          const rb = regraDeData(prC.data_admissao || l.dataAdm, proc.id, pExec, fonteNp);   // V630
          if (rb) valorMae = rb.valor != null ? (Number(rb.valor) || 0) : (rb.percentual != null && produzido > 0 ? produzido * Number(rb.percentual) : 0);
        }
        if (valorMae == null) valorMae = 0;
        linhas.push({ status: (medP && medP.id) ? 'casou' : 'sem_cadastro',
          admissao: l.admissao, data: prC.data_admissao || '', profissional: medP ? medP.nome_oficial : (execP || '(sem executante)'),
          papel: 'Executante · Pacote ' + (pacote.convenio_label || ''), papelId: pExec, procedimento: proc.nome_oficial, produto: l.produto,
          origem: 'Convênio', convenio: convP, produzido: 0, repasse: valorMae, medicoId: (medP && medP.id) || null,
          tipoVinculo: vinculoDe(medP), cadastrado: !!(medP && medP.id), competencia: compP, substituido: false, desempenho: 'PACOTE' });
        // FILHA (exames inclusos) — só se o executante tem a especialidade configurada (default 'Retina')
        if (medP && medP.id && aux.medicosEspPacote.has(medP.id)) {
          let valorFilha = 0;
          if (pacote.valor != null) valorFilha = Number(pacote.valor) || 0;
          else if (pacote.percentual != null && produzido > 0) valorFilha = produzido * Number(pacote.percentual);
          if (valorFilha > 0) {
            linhas.push({ status: 'casou', admissao: l.admissao, data: prC.data_admissao || '', profissional: medP.nome_oficial,
              papel: 'Exames inclusos · Pacote', papelId: pExec, procedimento: (pacote.nome_detalhe || 'Exames inclusos no pacote'), produto: l.produto,
              origem: 'Convênio', convenio: convP, produzido: 0, repasse: valorFilha, medicoId: medP.id,
              tipoVinculo: vinculoDe(medP), cadastrado: true, competencia: compP, substituido: false, desempenho: 'PACOTE' });
          } else {
            linhas[linhas.length - 1].motivo = 'filha não paga: pacote sem valor/percentual de exames cadastrado';
          }
        } else {
          // transparência: explica na linha-mãe por que a filha (exames) não saiu
          linhas[linhas.length - 1].motivo = (!medP || !medP.id)
            ? 'filha não paga: executante da consulta não foi reconhecido no cadastro de médicos'
            : 'filha não paga: executante não tem a especialidade Retina cadastrada';
        }
        continue;
      }
      // ===== fim PACOTE =====

      if (!proc) continue;   // não é procedimento (material/taxa/OPME) → fora da matriz
      if (!aux.procsComRegra.has(proc.id)) {
        // procedimento conhecido, mas SEM regra na tabela_repasse → sinaliza
        linhas.push({ status: 'sem_regra', admissao: l.admissao || '', data: '', profissional: '',
          papel: '', papelId: null, procedimento: (proc.nome_oficial || l.produto), produto: l.produto,
          origem: '', convenio: l.convenio, produzido: 0, repasse: 0, medicoId: null, tipoVinculo: null,
          cadastrado: false, competencia: '' });
        continue;
      }
      nElegiveis++;

      // 1) casa admissão + produto (exato, linha ainda não consumida)
      const prodN = normAtlas(l.produto);
      const rowsProd = l.admissao ? prodDaAdmissao(l.admissao) : [];
      let pr = rowsProd.find(r => !consumido.has(r) && normAtlas(r.produto) === prodN) || null;
      let procEf = proc;            // procedimento efetivo (default: o do relatório)
      let substituido = false;      // nível 2: procedimento trazido da produção
      let profProducao = false;     // nível 3: profissional da produção + regra do relatório

      // 2) a admissão existe na produção, mas com PROCEDIMENTO diferente → usa o
      //    procedimento lançado na coluna PRODUTO da produção (1ª linha elegível c/ regra).
      if (!pr && rowsProd.length) {
        for (const r of rowsProd) {
          if (consumido.has(r) || ehLinhaLC(r) || ehEstrabismo(r.produto)) continue;
          const p2 = acharProc(r.produto, aux);
          if (p2 && aux.procsComRegra.has(p2.id)) { pr = r; procEf = p2; substituido = true; break; }
        }
      }
      // 3) a admissão existe na produção mas SEM procedimento elegível lançado →
      //    puxa o profissional da melhor linha (procedimento antes de material, maior valor)
      //    e aplica a REGRA DO PROCEDIMENTO DO RELATÓRIO (que já passou na elegibilidade).
      if (!pr && rowsProd.length) {
        const cand = rowsProd.filter(r => !consumido.has(r) && temProf(r) && !ehLinhaLC(r) && !ehEstrabismo(r.produto) && normAtlas(r.classificacao_produto).indexOf('OPME') === -1);
        if (cand.length) {
          cand.sort((a, b) => {
            const ma = ehMaterialOpme(a) ? 1 : 0, mb = ehMaterialOpme(b) ? 1 : 0;
            if (ma !== mb) return ma - mb;
            return (Number(b.valor) || 0) - (Number(a.valor) || 0);
          });
          pr = cand[0]; procEf = proc; profProducao = true;
        }
      }

      if (!pr) {
        nOrfas++;
        let motivo;
        if (!l.admissao) motivo = 'conta sem código de admissão';
        else if (!rowsProd.length) motivo = 'admissão não está na produção importada';
        else {
          const naoConsumidas = rowsProd.filter(r => !consumido.has(r));
          if (!naoConsumidas.length) motivo = 'todas as linhas da produção dessa admissão já foram usadas por outros itens';
          else if (!naoConsumidas.some(temProf)) motivo = 'produção dessa admissão sem profissional nas colunas de repasse';
          else motivo = 'sem correspondência pagável na produção';
        }
        linhas.push({ status: 'sem_producao', admissao: l.admissao || '', data: '', profissional: '',
          papel: '', papelId: null, procedimento: (proc.nome_oficial || proc.nome_normalizado || l.produto), produto: l.produto, origem: '',
          convenio: l.convenio, produzido: 0, repasse: 0, medicoId: null, tipoVinculo: null,
          cadastrado: false, competencia: '', substituido: false, motivo });
        continue;
      }
      consumido.add(pr);
      if (substituido || profProducao) nSubstituidos++;
      nProcessadas++;
      const fonteN = fonteDe(pr.tipo_recebimento, l.convenio);
      const origem = fonteN === 'CONVENIO' ? 'Convênio' : (fonteN === 'PARTICULAR' ? 'Particular' : 'SUS');
      const produzido = Number(pr.valor) || 0;
      const comp = pr.competencia || '';
      if (comp) mesesSet.add(comp);
      const data = pr.data_admissao || '';
      const conv = (pr.convenio && String(pr.convenio).trim()) || l.convenio;
      const exec = (pr.cirurgiao && String(pr.cirurgiao).trim()) || (pr.medico && String(pr.medico).trim()) || '';

      // A BASE TABELA já traz o VALOR CHEIO do papel (a Auditoria não multiplica pela
      // quantidade). Cada papel recebe o seu próprio valor — sem dobrar.
      const exigidos = aux.exigidos.get(procEf.id + '|' + fonteN) || aux.exigidos.get(procEf.id + '|TODAS') || new Set();

      const pagar = (papelId, papelNome, profNome, profPagamento) => {
        if (papelId == null || !profNome) return;
        const rBase = regraDeData(data || l.dataAdm, procEf.id, papelId, fonteN);   // V630
        const fonteBase = _fonteRegra;   // V635: rastro
        if (!rBase) return;
        const quemRecebe = profPagamento || profNome;
        const med = acharMed(quemRecebe, aux);
        const exc = excDe(aux, med && med.id, procEf.id, papelId, fonteN);
        const regra = exc || rBase;
        const fonteRegra = exc ? 'exceção' : fonteBase;   // V635
        let valor = 0;
        if (regra.valor != null) valor = Number(regra.valor) || 0;
        else if (regra.percentual != null) valor = produzido * (Number(regra.percentual) || 0);
        if (!(valor > 0)) return;
        linhas.push({ status: (med && med.id) ? 'casou' : 'sem_cadastro',
          admissao: l.admissao, data, profissional: med ? med.nome_oficial : quemRecebe,
          papel: papelNome, papelId, procedimento: (procEf.nome_oficial || procEf.nome_normalizado || pr.produto),
          produto: (procEf === proc ? l.produto : pr.produto) || l.produto, origem, convenio: conv,
          produzido: fonteN === 'PARTICULAR' ? produzido : 0, repasse: valor,
          medicoId: (med && med.id) || null, tipoVinculo: vinculoDe(med), cadastrado: !!(med && med.id),
          competencia: comp, substituido, profProducao, fonteRegra });
      };

      // Paga TODOS os papéis EXIGIDOS pela BASE TABELA (regras da Auditoria):
      // Executante (cirurgião), Indicante/Solicitante (um), Médico Laudo (médico) e
      // AUXILIAR — cujo valor vai pro CIRURGIÃO mesmo quando não há auxiliar nomeado.
      if (exigidos.has(pExec) && exec) pagar(pExec, 'Executante', exec, null);
      const indicNome = (pr.indicante && String(pr.indicante).trim()) || (pr.solicitante && String(pr.solicitante).trim()) || '';
      if (indicNome) {
        if (exigidos.has(pIndic)) pagar(pIndic, 'Indicante', indicNome, null);
        else if (exigidos.has(pSolic)) pagar(pSolic, 'Solicitante', indicNome, null);
      }
      if (exigidos.has(pLaudo) && pr.medico && String(pr.medico).trim()) pagar(pLaudo, 'Médico Laudo', String(pr.medico).trim(), null);
      if (exigidos.has(pAux) && exec) pagar(pAux, 'Auxiliar', exec, exec);
    }

    // OPME — linhas de produção (classificacao OPME) das admissões do balanço.
    // Elegíveis (produto bate num termo) geram repasse = valor × pct (geral ou por médico) pro cirurgião.
    const admsBalanco = new Set(res.linhas.map(l => String(l.admissao || '').trim()).filter(Boolean));
    const lioConvSet = new Set();   // convênios que aparecem em LIO (pro filtro)
    admsBalanco.forEach(adm => {
      for (const r of prodDaAdmissao(adm)) {
        if (normAtlas(r.classificacao_produto).indexOf('OPME') === -1) continue;
        if (consumido.has(r)) continue;
        if (r.competencia) mesesSet.add(r.competencia);
        const valorProd = Number(r.valor) || 0;
        const cir = (r.cirurgiao || r.medico || '').trim();
        const conv = ehConvenio(r.tipo_recebimento);

        // ── LIO de convênio: 18% executante + 2,5% indicante (substitui o 10%) ──
        if (ehLio(r.produto) && conv) {
          const execL = cir;
          const indicL = (r.indicante || r.solicitante || '').trim();
          const medE = execL ? acharMed(execL, aux) : null;
          opme.push({ admissao: adm, produto: r.produto || '', convenio: (r.convenio || '').trim(),
            medico: medE ? medE.nome_oficial : execL, competencia: r.competencia || '', valor: valorProd, elegivel: true,
            pct: aux.lioPctExec, repasse: valorProd > 0 ? valorProd * (aux.lioPctExec / 100) : 0,
            repasseBase: valorProd > 0 ? valorProd * (aux.lioPctExec / 100) : 0, tipo: 'LIO' });
          if (valorProd > 0 && execL) {
            consumido.add(r);
            const convNome = (r.convenio || '').trim();
            lioConvSet.add(convNome);
            const repExec = valorProd * (aux.lioPctExec / 100);
            linhas.push({ status: (medE && medE.id) ? 'casou' : 'sem_cadastro',
              admissao: adm, data: r.data_admissao || '', profissional: medE ? medE.nome_oficial : execL,
              papel: 'Executante · LIO ' + aux.lioPctExec + '%', papelId: pExec, procedimento: (r.produto || ''), produto: r.produto || '',
              origem: 'Convênio', convenio: convNome, produzido: 0, repasse: repExec, repasseBase: repExec,
              medicoId: (medE && medE.id) || null, tipoVinculo: vinculoDe(medE), cadastrado: !!(medE && medE.id),
              competencia: r.competencia || '', substituido: false, desempenho: 'LIO' });
            // indicante só se existir e for diferente do executante
            if (indicL && normAtlas(indicL) !== normAtlas(execL)) {
              const medI = acharMed(indicL, aux);
              const repInd = valorProd * (aux.lioPctIndic / 100);
              linhas.push({ status: (medI && medI.id) ? 'casou' : 'sem_cadastro',
                admissao: adm, data: r.data_admissao || '', profissional: medI ? medI.nome_oficial : indicL,
                papel: 'Indicante · LIO ' + aux.lioPctIndic + '%', papelId: pIndic, procedimento: (r.produto || ''), produto: r.produto || '',
                origem: 'Convênio', convenio: convNome, produzido: 0, repasse: repInd, repasseBase: repInd,
                medicoId: (medI && medI.id) || null, tipoVinculo: vinculoDe(medI), cadastrado: !!(medI && medI.id),
                competencia: r.competencia || '', substituido: false, desempenho: 'LIO' });
            }
          }
          continue;
        }

        // ── OPME elegível: 10% (ou % por médico) pro cirurgião ──
        const elegivel = ehOpmeElegivel(r.produto);
        const med = (elegivel && cir) ? acharMed(cir, aux) : null;
        const pct = elegivel ? opmePctDe(med, cir) : 0;
        const repasse = (elegivel && valorProd > 0) ? valorProd * (pct / 100) : 0;
        opme.push({ admissao: adm, produto: r.produto || '', convenio: (r.convenio || '').trim(),
          medico: (med && med.nome_oficial) || cir, competencia: r.competencia || '', valor: valorProd, elegivel, pct, repasse, tipo: 'OPME' });
        if (repasse > 0 && cir) {
          consumido.add(r);
          linhas.push({ status: (med && med.id) ? 'casou' : 'sem_cadastro',
            admissao: adm, data: r.data_admissao || '', profissional: med ? med.nome_oficial : cir,
            papel: 'Cirurgião · OPME ' + pct + '%', papelId: pExec, procedimento: (r.produto || ''), produto: r.produto || '',
            origem: 'Convênio', convenio: (r.convenio || '').trim(), produzido: 0, repasse,
            medicoId: (med && med.id) || null, tipoVinculo: vinculoDe(med), cadastrado: !!(med && med.id),
            competencia: r.competencia || '', substituido: false, desempenho: 'OPME' });
        }
      }
    });

    // destaque: repasse por produto pago de COLA BIOLÓGICA, ISTENT e PRESERFLO
    const destaqueTermos = [['COLA BIOLÓGICA', 'COLA BIOLOGICA'], ['ISTENT', 'ISTENT'], ['PRESERFLO', 'PRESERFLO']];
    const destaque = destaqueTermos.map(([label, termo]) => {
      let total = 0, qtd = 0;
      for (const o of opme) { if (o.repasse > 0 && normAtlas(o.produto).indexOf(termo) !== -1) { total += o.repasse; qtd++; } }
      return { label, total, qtd };
    }).filter(d => d.qtd > 0);

    // REGRA AUDITORIA: colapsa "PACOTE X" + "X" da MESMA cirurgia (admissão + raiz + dia).
    // Some o conjunto AVULSO (não-pacote); fica o do PACOTE. Evita pagar duas vezes a mesma cirurgia.
    const raizCir = (txt) => { const n = normAtlas(txt); for (const p of aux.palavrasCir) if (n.indexOf(p) >= 0) return p; return ''; };
    const soDia = (d) => String(d || '').slice(0, 10);
    const grupoCir = new Map();   // `adm|raiz|dia` → { pacote: [], avulso: [] }
    for (const li of linhas) {
      if (li.status !== 'casou' || li.desempenho) continue;   // só linhas-base que pagaram
      const raiz = raizCir(li.procedimento);
      if (!raiz) continue;
      const ch = li.admissao + '|' + raiz + '|' + soDia(li.data);
      let e = grupoCir.get(ch); if (!e) { e = { pacote: [], avulso: [] }; grupoCir.set(ch, e); }
      if (normAtlas(li.procedimento).indexOf('PACOTE') >= 0) e.pacote.push(li); else e.avulso.push(li);
    }
    const remover = new Set();
    for (const e of grupoCir.values()) {
      if (e.pacote.length && e.avulso.length) for (const li of e.avulso) remover.add(li);
    }
    if (remover.size) {
      const restantes = linhas.filter(li => !remover.has(li));
      linhas.length = 0; linhas.push(...restantes);
    }

    return { ok: true, linhas, opme, destaque, meses: Array.from(mesesSet).sort(),
             lioConvenios: Array.from(lioConvSet).sort(),
             nElegiveis, nProcessadas, nOrfas, nSubstituidos, estr: aux.estr };
  }

  // marca a quantidade (0/1/2) de uma cirurgia de estrabismo (grava em marcacoes_estrabismo)
  function salvarMarcacaoEstrabismo(codAdmissao, competencia, quantidade) {
    if (!temBanco()) return { erro: 'Banco do ATLAS indisponível.' };
    const cod = String(codAdmissao || '').trim(); const comp = String(competencia || '').trim();
    const qtd = Number(quantidade) || 0;
    if (!cod || !comp) return { erro: 'Admissão/competência inválida.' };
    try {
      if (qtd === 0) {
        Banco.executar(`DELETE FROM marcacoes_estrabismo WHERE cod_admissao = ? AND competencia = ?`, [cod, comp]);
      } else {
        Banco.executar(`INSERT INTO marcacoes_estrabismo (cod_admissao, competencia, quantidade) VALUES (?, ?, ?)
          ON CONFLICT(cod_admissao, competencia) DO UPDATE SET quantidade = excluded.quantidade`, [cod, comp, qtd]);
      }
      if (typeof Banco.salvar === 'function') Banco.salvar();
      return { ok: true, qtd };
    } catch (e) { return { erro: e.message || String(e) }; }
  }

  // grava no repasse_pagos pra o Cálculo de Repasse NÃO pagar essas admissões de novo.
  // Chave do ATLAS: (competencia, cod_admissao, procedimento_norm, papel_id).
  // Só grava linhas pagas e cadastradas (status 'casou'); usa o produto normalizado como
  // procedimento_norm (mesma convenção textual das contas).
  function salvarSnapshotBalanco(linhas) {
    if (!temBanco()) return { erro: 'Banco do ATLAS indisponível.' };
    let gravadas = 0, ignoradas = 0;
    try {
      for (const l of linhas) {
        if (l.status !== 'casou') { ignoradas++; continue; }
        const comp = l.competencia;
        const codAdm = String(l.admissao || '').trim();
        const procNorm = normAtlas(l.produto || l.procedimento || '');
        if (!comp || !codAdm || !procNorm || l.papelId == null) { ignoradas++; continue; }
        Banco.executar(
          `INSERT OR REPLACE INTO repasse_pagos
            (competencia, cod_admissao, procedimento_norm, papel_id, repasse)
           VALUES (?, ?, ?, ?, ?)`,
          [comp, codAdm, procNorm, l.papelId, l.repasse || 0]
        );
        gravadas++;
      }
      if (typeof Banco.salvar === 'function') Banco.salvar();
      // invalida o cache de pagos do Calcular (ele cacheia em window.__atlasPagos_*)
      Object.keys(window).forEach(k => { if (k.indexOf('__atlasPagos_') === 0) delete window[k]; });
      return { ok: true, gravadas, ignoradas };
    } catch (e) {
      return { erro: e.message || String(e) };
    }
  }

  // normalização de nome igual à do app (Médicos usa Utilidades.normalizar)
  function normNome(s) {
    return (window.Utilidades && typeof Utilidades.normalizar === 'function') ? Utilidades.normalizar(s) : normAtlas(s);
  }
  function invalidarCaches() {
    if (typeof window.__atlasInvalidarAux === 'function') window.__atlasInvalidarAux();
    Object.keys(window).forEach(k => { if (k.indexOf('__atlasPagos_') === 0) delete window[k]; });
  }

  // cadastra um NOVO médico (com vínculo escolhido)
  function cadastrarMedicoNovo(nome, vinculo) {
    if (!temBanco()) return { erro: 'Banco do ATLAS indisponível.' };
    const nm = String(nome || '').trim();
    if (!nm) return { erro: 'Nome vazio.' };
    const norm = normNome(nm);
    try {
      const ex = q(`SELECT id, nome_oficial FROM medicos WHERE nome_normalizado = ?`, [norm]);
      if (ex.length) return { ok: true, id: ex[0].id, nome: ex[0].nome_oficial, vinculo: vinculo || null, jaExistia: true };
      const r = Banco.executar(
        `INSERT INTO medicos (nome_oficial, nome_normalizado, tipo_vinculo, ativo) VALUES (?, ?, ?, 1)`,
        [nm, norm, vinculo || null]);
      if (typeof Banco.salvar === 'function') Banco.salvar();
      invalidarCaches();
      return { ok: true, id: r && (r.lastInsertRowId != null ? r.lastInsertRowId : r.lastID), nome: nm, vinculo: vinculo || null };
    } catch (e) { return { erro: e.message || String(e) }; }
  }

  // vincula a grafia do relatório a um médico EXISTENTE (De-Para → sinonimos_medico)
  function vincularDePara(nome, medicoId) {
    if (!temBanco()) return { erro: 'Banco do ATLAS indisponível.' };
    const nm = String(nome || '').trim();
    if (!nm || !medicoId) return { erro: 'Dados incompletos.' };
    const norm = normNome(nm);
    try {
      const med = q(`SELECT id, nome_oficial, tipo_vinculo FROM medicos WHERE id = ?`, [medicoId])[0];
      if (!med) return { erro: 'Médico não encontrado.' };
      const ja = q(`SELECT medico_id FROM sinonimos_medico WHERE grafia = ?`, [nm]);
      if (!ja.length) {
        Banco.executar(`INSERT INTO sinonimos_medico (medico_id, grafia, grafia_normalizada) VALUES (?, ?, ?)`,
          [medicoId, nm, norm]);
        if (typeof Banco.salvar === 'function') Banco.salvar();
      }
      invalidarCaches();
      return { ok: true, id: med.id, nome: med.nome_oficial, vinculo: med.tipo_vinculo || null };
    } catch (e) { return { erro: e.message || String(e) }; }
  }

  function listarMedicosAtivos() {
    if (!temBanco()) return [];
    return q(`SELECT id, nome_oficial, tipo_vinculo FROM medicos WHERE ativo = 1 ORDER BY nome_oficial`);
  }

  // expõe o núcleo pra teste/uso

  // ==========================================================================
  // V892 — LATERALIDADE × QVIS (o módulo agora é MULTIUSO)
  //
  // Pedido do usuário: o Balanço Retroativo passa a ser a casa das pendências
  // avulsas da empresa — "extremamente mutável". O uso da vez: cruzar uma
  // planilha de LATERALIDADE (Cód. Admissão · Data · AO/OD/OE) com as
  // admissões PAGAS no relatório QVIS desde 2025 cujo procedimento contenha um
  // termo (INJEÇÃO, no caso de hoje) — para enxergar as injeções feitas em
  // AMBOS os olhos.
  // ==========================================================================
  /** "3 - AO", " ao ", "1 - OD" → AO / OD / OE */
  function normLateral(v) {
    const s = norm(v);
    const m = s.match(/\b(AO|OD|OE)\b/);
    return m ? m[1] : s;
  }
  /** admissão comparável: maiúscula, sem espaços; só-dígitos perde zeros à esquerda */
  function normAdmBal(v) {
    let s = String(v == null ? '' : v).trim().toUpperCase();
    if (/^\d+$/.test(s)) s = s.replace(/^0+/, '') || '0';
    return s;
  }
  /** acha a aba com Cód. Admissão + Lateralidade e devolve adm → [{data, lat}] */
  function lerLateralidade(sheets) {
    for (const nome of Object.keys(sheets)) {
      const m = sheets[nome];
      const h = acharCabecalho(m, ['ADMISSAO', 'LATERALIDADE']);
      if (h === -1) continue;
      const hdr = (m[h] || []).map(norm);
      const cAdm = colDe(hdr, ['COD. ADMISSAO', 'COD ADMISSAO', 'ADMISSAO']);
      const cLat = colDe(hdr, ['LATERALIDADE']);
      const cData = colDe(hdr, ['DATA ADMISSAO', 'DATA']);
      if (cAdm === -1 || cLat === -1) continue;
      const mapa = new Map();
      let nLinhas = 0;
      for (let i = h + 1; i < m.length; i++) {
        const r = m[i]; if (!r) continue;
        const adm = normAdmBal(r[cAdm]);
        if (!adm) continue;
        nLinhas++;
        if (!mapa.has(adm)) mapa.set(adm, []);
        mapa.get(adm).push({ data: cData !== -1 ? dataIsoDe(r[cData]) : '',
          lat: normLateral(r[cLat]) });
      }
      if (mapa.size) return { mapa, nLinhas, aba: nome };
    }
    return null;
  }
  /**
   * Cruza a planilha com o QVIS. As linhas do QVIS são POR PAPEL: produzido e
   * recebido repetem em cada papel do mesmo procedimento (entra o MAIOR — a
   * régua que o resto da ferramenta usa) e o repasse é a soma do repassado.
   * A lateralidade sai da linha da MESMA data de admissão; sem par exato de
   * data, saem as lateralidades distintas daquela admissão ("AO · OD").
   */
  function cruzarLateralidade(sheets, opts) {
    const o = opts || {};
    const termo = norm(o.termo == null ? 'INJEÇÃO' : o.termo);
    const desde = o.desde || '2025-01-01';
    const lidos = lerLateralidade(sheets);
    if (!lidos) throw new Error('Não encontrei uma aba com as colunas "Cód. Admissão" e "Lateralidade".');
    if (!temBanco()) throw new Error('Banco da ferramenta indisponível.');
    const rows = q(`SELECT admissao, data_admissao, procedimento, paciente,
          produzido, recebido, repassado, origem, tipo_recebimento, papel, nome_profissional
        FROM linhas_qvis WHERE data_admissao >= ?`, [desde]) || [];
    const grupos = new Map();
    for (const r of rows) {
      if (termo && norm(r.procedimento).indexOf(termo) === -1) continue;
      const adm = normAdmBal(r.admissao);
      const k = adm + '|' + norm(r.procedimento) + '|' + String(r.data_admissao || '');
      if (!grupos.has(k)) {
        grupos.set(k, { adm, admBruta: String(r.admissao == null ? '' : r.admissao).trim(),
          data: String(r.data_admissao || ''), proc: r.procedimento || '',
          paciente: '', tipo: '', medico: '', _medPapel: '',
          produzido: 0, recebido: 0, repasse: 0 });
      }
      const g = grupos.get(k);
      g.produzido = Math.max(g.produzido, Number(r.produzido) || 0);
      g.recebido = Math.max(g.recebido, Number(r.recebido) || 0);
      g.repasse += Number(r.repassado) || 0;
      if (!g.paciente && r.paciente) g.paciente = String(r.paciente).trim();
      // V893: tipo de recebimento — PARTICULAR ou CONVÊNIO (origem do QVIS)
      if (!g.tipo) {
        const o = norm(r.tipo_recebimento || r.origem);
        if (o) g.tipo = o.indexOf('PART') !== -1 ? 'PARTICULAR' : 'CONVÊNIO';
      }
      // V893: MÉDICO — o do papel principal (cirurgião/executante/médico);
      // linha de outro papel só preenche enquanto não aparece o principal
      const nomeMed = String(r.nome_profissional || '').trim();
      if (nomeMed) {
        const pp = norm(r.papel);
        const principal = /CIRURGIAO|EXECUTANTE|^MEDICO$/.test(pp);
        if (principal && g._medPapel !== 'P') { g.medico = nomeMed; g._medPapel = 'P'; }
        else if (!g.medico) g.medico = nomeMed;
      }
    }
    const linhas = [];
    const admsCasadas = new Set();
    let qvisFora = 0;
    for (const g of grupos.values()) {
      const doAdm = lidos.mapa.get(g.adm);
      if (!doAdm) { qvisFora++; continue; }
      const daData = doAdm.filter(x => x.data && x.data === g.data).map(x => x.lat);
      const lats = [...new Set((daData.length ? daData : doAdm.map(x => x.lat)).filter(Boolean))];
      linhas.push(Object.assign({}, g, { lateralidade: lats.join(' · ') || '—' }));
      admsCasadas.add(g.adm);
    }
    linhas.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.adm.localeCompare(b.adm)));
    return {
      linhas,
      resumo: {
        aba: lidos.aba, linhasPlanilha: lidos.nLinhas, admsPlanilha: lidos.mapa.size,
        gruposQvis: grupos.size, admsCasadas: admsCasadas.size, linhasMatriz: linhas.length,
        qvisForaDaPlanilha: qvisFora, planilhaForaDoQvis: lidos.mapa.size - admsCasadas.size,
      },
      termo: o.termo == null ? 'INJEÇÃO' : String(o.termo), desde,
    };
  }

  window.BalancoRetroativo = { norm, acharCabecalho, colDe, montarBaseTabela, acharAbasContas, calcular,
    normAtlas, carregarAuxBanco, acharProc, acharMed, calcularPorMedico, salvarSnapshotBalanco,
    cadastrarMedicoNovo, vincularDePara, listarMedicosAtivos, salvarMarcacaoEstrabismo,
    normLateral, normAdmBal, lerLateralidade, cruzarLateralidade };   // V892

  // ---- exportação Excel (3 abas) ------------------------------------------
  function baixarBlob(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1200);
  }

  function colLetterX(n) {
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
    return s;
  }
  // tabela formatada manualmente (SEM objeto "Tabela do Excel") na paleta ATLAS
  function montarTabelaX(wb, nomeAba, cols, dados, somaIdx, startRow, opts) {
    startRow = startRow || 1;
    const ws = wb.addWorksheet(String(nomeAba).slice(0, 31), { views: [{ state: 'frozen', ySplit: startRow }] });
    const HEADER = 'FF042222', BORDER = 'FFDEE3E1', ZEBRA = 'FFF1F7F4', TOTAL = 'FFE4F0EB', INK = 'FF042222', VERDE = 'FF03624C';
    opts = opts || {}; const corTexto = opts.dataColor || INK;
    const bThin = { style: 'thin', color: { argb: BORDER } };
    const bordas = { top: bThin, left: bThin, bottom: bThin, right: bThin };
    const ncols = cols.length;
    const hr = startRow;
    cols.forEach((c, i) => {
      const cell = ws.getCell(hr, i + 1);
      cell.value = c.header;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER } };
      cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: c.money ? 'right' : 'left' };
      cell.border = bordas;
    });
    dados.forEach((row, ri) => {
      const r = hr + 1 + ri;
      const zebra = (ri % 2 === 1);
      cols.forEach((c, ci) => {
        const cell = ws.getCell(r, ci + 1);
        cell.value = (row[ci] != null ? row[ci] : (c.money ? 0 : ''));
        cell.font = { name: 'Calibri', size: 12, color: { argb: corTexto } };
        cell.border = bordas;
        if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
        if (c.money) { cell.numFmt = 'R$ #,##0.00'; cell.alignment = { horizontal: 'right' }; }
        if (c.fonte) Utilidades.pintarCelulaFonte(cell, row[ci]);   // V947: coluna de fonte pagadora com a cor da tag
        if (c.vinculo) Utilidades.pintarCelulaVinculo(cell, row[ci]);   // V960: coluna de vínculo com a cor da tag
      });
    });
    const tr = hr + 1 + dados.length;
    cols.forEach((c, i) => {
      const cell = ws.getCell(tr, i + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL } };
      cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: INK } };
      cell.border = { top: { style: 'medium', color: { argb: VERDE } }, left: bThin, bottom: bThin, right: bThin };
      if (i === 0) {
        cell.value = 'TOTAL';
      } else if (somaIdx.includes(i)) {
        const col = colLetterX(i + 1);
        const soma = dados.reduce((a, row) => a + (Number(row[i]) || 0), 0);
        cell.value = { formula: `SUBTOTAL(9,${col}${hr + 1}:${col}${tr - 1})`, result: soma };
        cell.alignment = { horizontal: 'right' };
        if (c.money) cell.numFmt = 'R$ #,##0.00';
      }
    });
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || 18; });
    ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: Math.max(hr, tr - 1), column: ncols } };
    return ws;
  }
  // banner "card" verde do total — ocupa as linhas 1-3
  function montarHeroX(ws, ncols, valor, subtitulo, titulo) {
    const HERO = 'FF03624C';
    ws.mergeCells(1, 1, 1, ncols); ws.mergeCells(2, 1, 2, ncols); ws.mergeCells(3, 1, 3, ncols);
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= ncols; c++) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HERO } };
    const a1 = ws.getCell(1, 1);
    a1.value = titulo || 'TOTAL A REPASSAR PARA OS MÉDICOS';
    a1.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFCFE8DD' } };
    a1.alignment = { horizontal: 'center', vertical: 'middle' };
    const a2 = ws.getCell(2, 1);
    a2.value = valor; a2.numFmt = 'R$ #,##0.00';
    a2.font = { name: 'Calibri', size: 30, bold: true, color: { argb: 'FFFFFFFF' } };
    a2.alignment = { horizontal: 'center', vertical: 'middle' };
    const a3 = ws.getCell(3, 1);
    a3.value = subtitulo;
    a3.font = { name: 'Calibri', size: 10, color: { argb: 'FFAFCBBF' } };
    a3.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 22; ws.getRow(2).height = 46; ws.getRow(3).height = 18; ws.getRow(4).height = 8;
  }
  // agrega repasse por médico com quebra por tipo de desempenho (só linhas que pagam)
  function aggPorMedico(linhas) {
    const rotulo = (l) => l.desempenho === 'LC' ? 'LC' : l.desempenho === 'ESTRABISMO' ? 'Estrabismo'
      : l.desempenho === 'OPME' ? 'OPME' : l.desempenho === 'LIO' ? 'LIO' : l.desempenho === 'PACOTE' ? 'Pacote' : 'Base';
    const agg = {};
    linhas.forEach(l => {
      const k = l.medicoId ? '#' + l.medicoId : '?' + l.profissional;
      if (!agg[k]) agg[k] = { nome: l.profissional, vinc: l.tipoVinculo || '', Base: 0, LC: 0, Estrabismo: 0, OPME: 0, LIO: 0, Pacote: 0, total: 0 };
      agg[k][rotulo(l)] += l.repasse; agg[k].total += l.repasse;
    });
    return Object.values(agg).sort((a, b) => b.total - a.total);
  }

  async function exportarExcel(res, nomeArq, btn) {
    if (typeof ExcelJS === 'undefined') { alert('ExcelJS não carregou. Recarregue a página.'); return; }
    const txtOrig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 br-spin"></i> Gerando…'; }
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'ATLAS'; wb.created = new Date();

      const colLetter = colLetterX;
      const montarTabela = (nomeAba, cols, dados, somaIdx, startRow, opts) => montarTabelaX(wb, nomeAba, cols, dados, somaIdx, startRow, opts);
      const montarHero = (ws, ncols, valor, subtitulo, titulo) => montarHeroX(ws, ncols, valor, subtitulo, titulo);

      // 1) Resumo por convênio (com o card do total no topo)
      const convs = Object.keys(res.porConvenio).sort((a, b) => res.porConvenio[b] - res.porConvenio[a]);
      const wsResumo = montarTabela('Resumo por Convênio',
        [{ header: 'Convênio', width: 40 }, { header: 'Repasse', width: 20, money: true }],
        convs.map(c => [c, res.porConvenio[c]]),
        [1], 5);
      montarHero(wsResumo, 2, res.total, 'Contas não enviadas ao convênio  ·  ' + String(nomeArq || ''));

      // 2) Detalhado (linha a linha — todas as contas)
      montarTabela('Detalhado',
        [{ header: 'Convênio', width: 26 }, { header: 'Procedimento Principal', width: 38 },
         { header: 'Produto', width: 40 }, { header: 'Valor Consumo', width: 16, money: true },
         { header: 'Repasse', width: 16, money: true }],
        res.linhas.map(l => [l.convenio, l.procedimento, l.produto, l.valorConsumo, l.repasse]),
        [3, 4]);

      // 3) Por procedimento (qtd + repasse)
      const procs = Object.values(res.porProcedimento).sort((a, b) => b.repasse - a.repasse);
      montarTabela('Por Procedimento',
        [{ header: 'Procedimento', width: 48 }, { header: 'Qtd', width: 10 }, { header: 'Repasse', width: 18, money: true }],
        procs.map(p => [p.nome, p.qtd, p.repasse]),
        [1, 2]);

      // 4) Matriz por médico + Por Médico (agregado) + OPME (se o cálculo foi rodado)
      if (res._matriz && res._matriz.ok) {
        const med = res._matriz;
        const linhasPag = med.linhas.filter(l => l.status === 'casou');
        // Matriz (linha a linha, padrão Auditoria)
        montarTabela('Matriz',
          [{ header: 'Status', width: 14 }, { header: 'Admissão', width: 16 }, { header: 'Data', width: 12 },
           { header: 'Profissional', width: 30 }, { header: 'Vínculo', width: 12, vinculo: true }, { header: 'Papel', width: 16 },
           { header: 'Procedimento', width: 38 }, { header: 'Origem', width: 12, fonte: true }, { header: 'Convênio', width: 24 },
           { header: 'V.TAB', width: 12 },   // V928: versão/fonte da regra aplicada (pela Data Admissão)
           { header: 'Produzido (Part.)', width: 16, money: true }, { header: 'Repasse', width: 16, money: true }],
          med.linhas.map(l => [l.status, l.admissao, l.data, l.profissional, l.tipoVinculo || '',
            l.papel, l.procedimento, l.origem, l.convenio, l.fonteRegra || '', l.produzido || 0, l.repasse]),
          [10, 11]);
        // Por Médico (agregado)
        const agg = {};
        linhasPag.forEach(l => {
          const k = (l.medicoId ? '#' + l.medicoId : '?' + l.profissional);
          if (!agg[k]) agg[k] = { nome: l.profissional, vinc: l.tipoVinculo || '', total: 0 };
          agg[k].total += l.repasse;
        });
        const aggList = Object.values(agg).sort((a, b) => b.total - a.total);
        const wsMed = montarTabela('Por Médico',
          [{ header: 'Médico', width: 36 }, { header: 'Vínculo', width: 12, vinculo: true }, { header: 'Repasse', width: 18, money: true }],
          aggList.map(m => [m.nome, m.vinc, m.total]),
          [2], 5);
        montarHero(wsMed, 3, aggList.reduce((a, m) => a + m.total, 0), 'Repasse por médico (regras do ATLAS)  ·  ' + aggList.length + ' médicos');
        // Total por Médico (consolidado com quebra por tipo de desempenho)
        const consol = aggPorMedico(linhasPag);
        const wsConsol = montarTabela('Total por Médico',
          [{ header: 'Médico', width: 32 }, { header: 'Vínculo', width: 12, vinculo: true },
           { header: 'Base', width: 13, money: true }, { header: 'LC', width: 11, money: true },
           { header: 'Estrabismo', width: 13, money: true }, { header: 'OPME', width: 11, money: true },
           { header: 'LIO', width: 11, money: true }, { header: 'Pacote', width: 12, money: true },
           { header: 'TOTAL', width: 15, money: true }],
          consol.map(m => [m.nome, m.vinc, m.Base, m.LC, m.Estrabismo, m.OPME, m.LIO, m.Pacote, m.total]),
          [2, 3, 4, 5, 6, 7, 8], 5);
        montarHero(wsConsol, 9, consol.reduce((a, m) => a + m.total, 0), 'Consolidado por médico, dividido por tipo  ·  ' + consol.length + ' médicos');
        // OPME
        if (med.opme.length) {
          montarTabela('OPME',
            [{ header: 'Admissão', width: 16 }, { header: 'Produto', width: 42 }, { header: 'Convênio', width: 22 },
             { header: 'Médico', width: 26 }, { header: 'Mês', width: 12 }, { header: 'Valor produção', width: 16, money: true },
             { header: 'Elegível', width: 10 }, { header: '%', width: 8 }, { header: 'Repasse', width: 16, money: true }],
            med.opme.map(o => [o.admissao, o.produto, o.convenio, o.medico, o.competencia, o.valor,
              o.elegivel ? 'Sim' : 'Não', o.pct || 0, o.repasse || 0]),
            [5, 8]);
        }
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const baseNome = String(nomeArq || 'balanco').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_\-]+/g, '_').slice(0, 40);
      const ts = new Date().toISOString().slice(0, 10);
      baixarBlob(blob, `balanco_retroativo_${baseNome}_${ts}.xlsx`);
    } catch (err) {
      alert('Erro ao gerar Excel: ' + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = txtOrig; }
    }
  }

  function rotuloTipo(l) {
    return l.desempenho === 'LC' ? 'LC' : l.desempenho === 'ESTRABISMO' ? 'Estrabismo'
      : l.desempenho === 'OPME' ? 'OPME' : l.desempenho === 'LIO' ? 'LIO' : l.desempenho === 'PACOTE' ? 'Pacote' : 'Base';
  }
  function sanitizeSheet(s) { return String(s || 'Médico').replace(/[\\\/\?\*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Médico'; }
  function sanitizeFile(s) { return String(s || 'medico').replace(/[^A-Za-z0-9_\- À-ÿ]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'medico'; }

  function colsDetalhe() {
    return [{ header: 'Status', width: 12 }, { header: 'Módulo', width: 13 }, { header: 'Admissão', width: 14 },
      { header: 'Data', width: 12 }, { header: 'Papel', width: 20 }, { header: 'Profissional', width: 32 },
      { header: 'Paciente', width: 28 }, { header: 'Origem', width: 12, fonte: true }, { header: 'Convênio', width: 22 },
      { header: 'Descrição', width: 42 }, { header: 'V.TAB', width: 12 },   // V928
      { header: 'Produzido (Part.)', width: 15, money: true },
      { header: 'Valor repasse', width: 15, money: true }];
  }
  function rowsDetalhe(linhas) {
    return linhas.map(l => ['Elegível', rotuloTipo(l), l.admissao, l.data, l.papel, l.profissional, l.paciente || '',
      l.origem, l.convenio, l.procedimento, l.fonteRegra || '', l.produzido || 0, l.repasse]);
  }

  // workbook de UM médico (1 aba com as colunas do relatório por médico)
  async function wbDeLinhasMedico(linhas, nomeAba) {
    const wb = new ExcelJS.Workbook(); wb.creator = 'ATLAS'; wb.created = new Date();
    montarTabelaX(wb, sanitizeSheet(nomeAba), colsDetalhe(), rowsDetalhe(linhas), [11, 12]);
    return wb;
  }

  // workbook consolidado: aba "Total por Médico" + aba "Detalhamento" (tudo junto, sem separar)
  async function wbConsolidado(elegivel) {
    const consol = aggPorMedico(elegivel);
    const wb = new ExcelJS.Workbook(); wb.creator = 'ATLAS'; wb.created = new Date();
    const wsC = montarTabelaX(wb, 'Total por Médico',
      [{ header: 'Médico', width: 32 }, { header: 'Vínculo', width: 12, vinculo: true },
       { header: 'Base', width: 13, money: true }, { header: 'LC', width: 11, money: true },
       { header: 'Estrabismo', width: 13, money: true }, { header: 'OPME', width: 11, money: true },
       { header: 'LIO', width: 11, money: true }, { header: 'Pacote', width: 12, money: true },
       { header: 'TOTAL', width: 15, money: true }],
      consol.map(m => [m.nome, m.vinc, m.Base, m.LC, m.Estrabismo, m.OPME, m.LIO, m.Pacote, m.total]),
      [2, 3, 4, 5, 6, 7, 8], 5);
    montarHeroX(wsC, 9, consol.reduce((a, m) => a + m.total, 0),
      'Elegível por médico  ·  ' + consol.length + ' médicos', 'TOTAL ELEGÍVEL POR MÉDICO');
    const detLin = elegivel.slice().sort((a, b) => (a.profissional || '').localeCompare(b.profissional || '', 'pt-BR')
      || String(a.admissao).localeCompare(String(b.admissao)));
    montarTabelaX(wb, 'Detalhamento', colsDetalhe(), rowsDetalhe(detLin), [11, 12]);
    return wb;
  }

  // Extração "por médico (ELEGÍVEL)" — consolidado + UM ARQUIVO POR MÉDICO, salvos numa PASTA
  // (igual ao módulo relatórios: showDirectoryPicker; .zip só como reserva)
  async function exportarElegivelPorMedico(med, nomeArq, btn, filtros) {
    if (typeof ExcelJS === 'undefined') { alert('ExcelJS não carregou. Recarregue a página.'); return; }
    const txtOrig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 br-spin"></i> Gerando…'; }
    try {
      filtros = filtros || {};
      const vinc = filtros.vinculo, mes = filtros.mes || 'todos', medicoSel = filtros.medico || 'todos';
      const elegivel = med.linhas.filter(l =>
        l.status === 'casou' && l.repasse > 0 &&
        (!vinc || (l.tipoVinculo && vinc.has(l.tipoVinculo))) &&
        (mes === 'todos' || l.competencia === mes) &&
        (medicoSel === 'todos' || l.profissional === medicoSel));
      if (!elegivel.length) { alert('Nada elegível para exportar com os filtros atuais.'); return; }

      const baseNome = String(nomeArq || 'balanco').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_\-]+/g, '_').slice(0, 40);
      const ts = new Date().toISOString().slice(0, 10);
      const nomePasta = `Repasse_por_medico_${baseNome}_${ts}`;

      // agrupa por médico
      const grupos = new Map();
      for (const l of elegivel) { const k = l.profissional || '(sem médico)'; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(l); }
      const ordenados = [...grupos.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR'));
      ordenados.forEach(([, ls]) => ls.sort((a, b) => String(a.admissao).localeCompare(String(b.admissao))));

      // 1) Preferido: salvar os .xlsx numa PASTA escolhida (sem zip)
      if (window.showDirectoryPicker) {
        let dir = null;
        try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); }
        catch (e) { if (e && e.name === 'AbortError') { return; } dir = null; }
        if (dir) {
          const sub = await dir.getDirectoryHandle(nomePasta, { create: true });
          const gravar = async (nomeArqXlsx, wb) => {
            const buf = await wb.xlsx.writeBuffer();
            const fh = await sub.getFileHandle(nomeArqXlsx, { create: true });
            const w = await fh.createWritable(); await w.write(buf); await w.close();
          };
          await gravar('_Total_por_medico.xlsx', await wbConsolidado(elegivel));
          const usados = new Set();
          for (const [nome, ls] of ordenados) {
            let arq = sanitizeFile(nome); const base = arq; let i = 2;
            while (usados.has(arq.toLowerCase())) arq = `${base} (${i++})`;
            usados.add(arq.toLowerCase());
            await gravar(`${arq}.xlsx`, await wbDeLinhasMedico(ls, nome));
          }
          alert(`✓ ${ordenados.length} arquivos por médico + consolidado salvos na pasta "${nomePasta}".`);
          return;
        }
      }

      // 2) Reserva: .zip (navegador sem File System Access)
      if (typeof JSZip === 'undefined') { alert('Seu navegador não permite salvar em pasta e o JSZip não carregou. Recarregue (Ctrl+Shift+R).'); return; }
      const zip = new JSZip();
      const pasta = zip.folder(nomePasta);
      pasta.file('_Total_por_medico.xlsx', await (await wbConsolidado(elegivel)).xlsx.writeBuffer());
      const usados = new Set();
      for (const [nome, ls] of ordenados) {
        let arq = sanitizeFile(nome); const base = arq; let i = 2;
        while (usados.has(arq.toLowerCase())) arq = `${base} (${i++})`;
        usados.add(arq.toLowerCase());
        pasta.file(`${arq}.xlsx`, await (await wbDeLinhasMedico(ls, nome)).xlsx.writeBuffer());
      }
      const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      baixarBlob(blob, `${nomePasta}.zip`);
    } catch (err) {
      alert('Erro ao gerar extração: ' + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = txtOrig; }
    }
  }
  const fmt = (n) => (window.Utilidades && Utilidades.formatarMoeda)
    ? Utilidades.formatarMoeda(n)
    : 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  App.telas['balanco-retroativo'] = function () {
    const alvo = App.alvoConteudo();
    if (!alvo) return;
    /**
     * V892: o módulo é MULTIUSO — a casa das pendências avulsas da empresa.
     * Cada demanda vira um MODO, com a sua tela; o modo antigo (contas não
     * enviadas) fica intacto. O da vez: LATERALIDADE × QVIS.
     */
    alvo.innerHTML = `
      <div class="br-wrap">
        <div class="br-modos" role="tablist">
          <button class="br-modo br-modo-ativo" data-brmodo="lateral" role="tab">
            <i class="ti ti-eye"></i> Lateralidade × QVIS</button>
          <button class="br-modo" data-brmodo="contas" role="tab">
            <i class="ti ti-file-invoice"></i> Contas não enviadas</button>
        </div>

        <div id="br-pane-lateral">
          <div class="br-aviso">
            <i class="ti ti-eye"></i>
            <div>
              <strong>Lateralidade × QVIS.</strong>
              Suba a planilha com <strong>Cód. Admissão · Data Admissão · Lateralidade</strong> (AO/OD/OE).
              O módulo procura no <strong>relatório QVIS</strong>, desde a data escolhida, as admissões pagas cujo
              procedimento contenha o termo, e casa cada uma com a lateralidade da planilha —
              é o que identifica as injeções feitas em <strong>ambos os olhos (AO)</strong>.
            </div>
          </div>
          <div class="br-lat-filtros">
            <label>Procedimento contém <input type="text" id="br-lat-termo" value="INJEÇÃO"></label>
            <label>Desde <input type="date" id="br-lat-desde" value="2025-01-01"></label>
            <label>Lateralidade <select id="br-lat-sel">
              <option value="">Todas</option><option>AO</option><option>OD</option><option>OE</option>
            </select></label>
          </div>
          <label class="br-drop" id="br-lat-drop">
            <input type="file" id="br-lat-file" accept=".xlsx,.xls" hidden>
            <i class="ti ti-file-spreadsheet"></i>
            <div class="br-drop-txt"><strong>Clique ou arraste</strong> a planilha de lateralidade (.xlsx)</div>
            <div class="br-drop-sub">Colunas: Cód. Admissão · Data Admissão · Lateralidade</div>
          </label>
          <div id="br-lat-status" class="br-status" hidden></div>
          <div id="br-lat-out"></div>
        </div>

        <div id="br-pane-contas" hidden>
          <div class="br-aviso">
            <i class="ti ti-flask"></i>
            <div>
              <strong>Contas não enviadas ao convênio.</strong>
              Calcula quanto há a repassar para os médicos nas contas <em>não enviadas ao convênio</em>.
              Sobe o arquivo (.xlsx); o cálculo casa o <strong>Produto</strong> de cada conta com a
              <strong>Base Tabela da ferramenta</strong> (todos os papéis somados; % aplicado sobre o valor consumo).
              Se o arquivo trouxer uma aba <strong>BASE TABELA</strong> embutida, ela tem prioridade.
            </div>
          </div>

          <label class="br-drop" id="br-drop">
            <input type="file" id="br-file" accept=".xlsx,.xls" hidden>
            <i class="ti ti-file-spreadsheet"></i>
            <div class="br-drop-txt"><strong>Clique ou arraste</strong> o arquivo .xlsx aqui</div>
            <div class="br-drop-sub">Ex.: "EM NEGOCIAÇÃO – FORA DO PRAZO"</div>
          </label>

          <div id="br-status" class="br-status" hidden></div>
          <div id="br-resultado"></div>
        </div>
      </div>`;

    // ── troca de modo ──
    alvo.querySelectorAll('.br-modo').forEach(btn => btn.addEventListener('click', () => {
      alvo.querySelectorAll('.br-modo').forEach(x => x.classList.toggle('br-modo-ativo', x === btn));
      alvo.querySelector('#br-pane-lateral').hidden = btn.dataset.brmodo !== 'lateral';
      alvo.querySelector('#br-pane-contas').hidden = btn.dataset.brmodo !== 'contas';
    }));

    // ══ MODO LATERALIDADE × QVIS (V892) ══════════════════════════════════
    let estadoLat = null;
    const latStatus = alvo.querySelector('#br-lat-status');
    const latOut = alvo.querySelector('#br-lat-out');
    const latDrop = alvo.querySelector('#br-lat-drop');
    const latInp = alvo.querySelector('#br-lat-file');
    const dataBrDe = (iso) => {
      const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '—');
    };

    latInp.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) processarLateral(e.target.files[0]);
    });
    ['dragover', 'dragenter'].forEach(ev => latDrop.addEventListener(ev, (e) => {
      e.preventDefault(); latDrop.classList.add('br-drop-ativo');
    }));
    ['dragleave', 'drop'].forEach(ev => latDrop.addEventListener(ev, (e) => {
      e.preventDefault(); latDrop.classList.remove('br-drop-ativo');
    }));
    latDrop.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) processarLateral(f);
    });
    alvo.querySelector('#br-lat-sel').addEventListener('change', () => renderLateral());
    // termo e data valem para a PRÓXIMA leitura; com resultado na tela, recalcula
    ['br-lat-termo', 'br-lat-desde'].forEach(id =>
      alvo.querySelector('#' + id).addEventListener('change', () => {
        if (estadoLat && estadoLat.sheets) calcularLateral(estadoLat.sheets, estadoLat.nomeArq);
      }));

    async function processarLateral(file) {
      latOut.innerHTML = '';
      latStatus.hidden = false;
      latStatus.className = 'br-status br-status-load';
      latStatus.innerHTML = `<i class="ti ti-loader-2 br-spin"></i> Lendo <strong>${esc(file.name)}</strong>…`;
      try {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
        const sheets = {};
        wb.SheetNames.forEach(nome => {
          sheets[nome] = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: null });
        });
        calcularLateral(sheets, file.name);
      } catch (err) {
        latStatus.className = 'br-status br-status-erro';
        latStatus.innerHTML = `<i class="ti ti-alert-triangle"></i> ${esc(err.message || String(err))}`;
      }
    }

    function calcularLateral(sheets, nomeArq) {
      try {
        const termo = alvo.querySelector('#br-lat-termo').value;
        const desde = alvo.querySelector('#br-lat-desde').value || '2025-01-01';
        const res = window.BalancoRetroativo.cruzarLateralidade(sheets, { termo, desde });
        estadoLat = { sheets, nomeArq, res };
        latStatus.hidden = true;
        renderLateral();
      } catch (err) {
        latStatus.hidden = false;
        latStatus.className = 'br-status br-status-erro';
        latStatus.innerHTML = `<i class="ti ti-alert-triangle"></i> ${esc(err.message || String(err))}`;
      }
    }

    function linhasLatFiltradas() {
      const sel = alvo.querySelector('#br-lat-sel').value;
      const todas = (estadoLat && estadoLat.res.linhas) || [];
      if (!sel) return todas;
      return todas.filter(l => String(l.lateralidade).split(' · ').includes(sel));
    }

    function renderLateral() {
      if (!estadoLat) return;
      const { res, nomeArq } = estadoLat;
      const linhas = linhasLatFiltradas();
      const soma = (k) => linhas.reduce((a, l) => a + (Number(l[k]) || 0), 0);
      const r = res.resumo;
      const corpo = linhas.map(l => `
        <tr>
          <td>${esc(l.admBruta || l.adm)}</td>
          <td>${esc(dataBrDe(l.data))}</td>
          <td>${esc(l.proc)}</td>
          <td class="br-lat-tag ${l.lateralidade === 'AO' ? 'br-lat-ao' : ''}">${esc(l.lateralidade)}</td>
          <td>${esc(l.paciente || '—')}</td>
          <td>${esc(l.medico || '—')}</td>
          <td>${l.tipo ? Utilidades.badgeFonte(l.tipo) : '—'}</td><!-- V947 -->
          <td class="br-num">${fmt(l.produzido)}</td>
          <td class="br-num">${fmt(l.recebido)}</td>
          <td class="br-num atlas-rep">${fmt(l.repasse)}</td><!-- V962 -->
        </tr>`).join('');
      latOut.innerHTML = `
        <div class="br-diag">
          <div class="br-diag-card"><span>${r.linhasPlanilha.toLocaleString('pt-BR')}</span>linhas na planilha</div>
          <div class="br-diag-card"><span>${r.admsPlanilha.toLocaleString('pt-BR')}</span>admissões únicas nela</div>
          <div class="br-diag-card"><span>${r.admsCasadas.toLocaleString('pt-BR')}</span>casadas com o QVIS</div>
          <div class="br-diag-card"><span>${linhas.length.toLocaleString('pt-BR')}</span>linhas na matriz${alvo.querySelector('#br-lat-sel').value ? ' (' + esc(alvo.querySelector('#br-lat-sel').value) + ')' : ''}</div>
        </div>
        <div class="br-fonte">Termo: <strong>${esc(res.termo)}</strong> · desde <strong>${esc(dataBrDe(res.desde))}</strong> ·
          planilha: <strong>${esc(nomeArq)}</strong> (aba ${esc(r.aba)}) ·
          ${r.qvisForaDaPlanilha.toLocaleString('pt-BR')} admissões do QVIS com o termo ficaram fora da planilha ·
          ${r.planilhaForaDoQvis.toLocaleString('pt-BR')} da planilha não têm o termo pago no QVIS</div>
        <div class="br-acoes">
          <button class="br-btn-exp" id="br-lat-exportar"><i class="ti ti-file-spreadsheet"></i> Exportar Excel</button>
        </div>
        <div class="br-tab-scroll">
          <table class="br-tab br-tab-lat">
            <thead><tr>
              <th>CÓD. ADMISSÃO</th><th>DATA DA ADMISSÃO</th><th>PROCEDIMENTO</th><th>LATERALIDADE</th>
              <th>PACIENTE</th><th>MÉDICO</th><th>TIPO DE RECEBIMENTO</th>
              <th class="br-num">VALOR PRODUZIDO</th><th class="br-num">VALOR RECEBIDO</th>
              <th class="br-num">REPASSE</th>
            </tr></thead>
            <tbody>${corpo || '<tr><td colspan="10">Nenhuma admissão casada com os filtros atuais.</td></tr>'}</tbody>
            <tfoot><tr>
              <td>TOTAL</td><td></td><td></td><td></td><td>${linhas.length.toLocaleString('pt-BR')} linha${linhas.length === 1 ? '' : 's'}</td>
              <td></td><td></td>
              <td class="br-num">${fmt(soma('produzido'))}</td>
              <td class="br-num">${fmt(soma('recebido'))}</td>
              <td class="br-num atlas-rep">${fmt(soma('repasse'))}</td><!-- V962 -->
            </tr></tfoot>
          </table>
        </div>`;
      const btn = latOut.querySelector('#br-lat-exportar');
      if (btn) btn.addEventListener('click', () => exportarLateral(btn));
    }

    async function exportarLateral(btn) {
      if (typeof ExcelJS === 'undefined') { alert('ExcelJS não carregou. Recarregue a página.'); return; }
      const txt = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 br-spin"></i> Gerando…';
      try {
        const linhas = linhasLatFiltradas();
        const wb = new ExcelJS.Workbook();
        montarTabelaX(wb, 'Lateralidade x QVIS', [
          { header: 'CÓD. ADMISSÃO', width: 16 },
          { header: 'DATA DA ADMISSÃO', width: 18 },
          { header: 'PROCEDIMENTO', width: 44 },
          { header: 'LATERALIDADE', width: 15 },
          { header: 'PACIENTE', width: 34 },
          { header: 'MÉDICO', width: 30 },
          { header: 'TIPO DE RECEBIMENTO', width: 20, fonte: true },
          { header: 'VALOR PRODUZIDO', width: 18, money: true },
          { header: 'VALOR RECEBIDO', width: 18, money: true },
          { header: 'REPASSE', width: 16, money: true },
        ], linhas.map(l => [l.admBruta || l.adm, dataBrDe(l.data), l.proc, l.lateralidade,
          l.paciente || '', l.medico || '', l.tipo || '',
          l.produzido, l.recebido, l.repasse]), [7, 8, 9]);
        const buf = await wb.xlsx.writeBuffer();
        baixarBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
          'Balanco_Lateralidade_QVIS.xlsx');
      } catch (e) {
        alert('Falha ao exportar: ' + (e.message || e));
      } finally {
        btn.disabled = false; btn.innerHTML = txt;
      }
    }

    const inp = alvo.querySelector('#br-file');
    const drop = alvo.querySelector('#br-drop');
    const status = alvo.querySelector('#br-status');
    const out = alvo.querySelector('#br-resultado');

    inp.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) processar(e.target.files[0]);
    });
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, (e) => {
      e.preventDefault(); drop.classList.add('br-drop-ativo');
    }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => {
      e.preventDefault(); drop.classList.remove('br-drop-ativo');
    }));
    drop.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) processar(f);
    });

    async function processar(file) {
      out.innerHTML = '';
      status.hidden = false;
      status.className = 'br-status br-status-load';
      status.innerHTML = `<i class="ti ti-loader-2 br-spin"></i> Lendo <strong>${esc(file.name)}</strong>…`;
      try {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
        const sheets = {};
        wb.SheetNames.forEach(nome => {
          sheets[nome] = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: null });
        });
        const res = calcular(sheets);
        if (!res.abaBase) {
          // V628: só falha se NEM o arquivo NEM a ferramenta tiverem regras
          throw new Error('O arquivo não tem a aba BASE TABELA embutida e a Base Tabela da ferramenta está vazia — cadastre as regras na Base Tabela e tente de novo.');
        }
        if (!res.abasContas.length) {
          throw new Error('Não encontrei abas de contas (com colunas Produto e Valor Consumo).');
        }
        status.hidden = true;
        renderResultado(res, file.name);
      } catch (err) {
        status.className = 'br-status br-status-erro';
        status.innerHTML = `<i class="ti ti-alert-triangle"></i> ${esc(err.message || String(err))}`;
      }
    }

    function renderResultado(res, nomeArq) {
      res._nomeArq = nomeArq;
      const convs = Object.keys(res.porConvenio).sort((a, b) => res.porConvenio[b] - res.porConvenio[a]);
      const linhasConv = convs.map(c => `
        <tr><td>${esc(c)}</td><td class="br-num">${fmt(res.porConvenio[c])}</td></tr>`).join('');
      out.innerHTML = `
        <div class="br-hero">
          <div class="br-hero-lbl">TOTAL A REPASSAR PARA OS MÉDICOS</div>
          <div class="br-hero-val">${fmt(res.total)}</div>
          <div class="br-hero-sub">${esc(nomeArq)}</div>
        </div>

        <div class="br-acoes">
          <button class="br-btn-exp br-btn-med" id="br-calc-medico"><i class="ti ti-stethoscope"></i> Calcular repasse por médico</button>
          <button class="br-btn-exp" id="br-exportar"><i class="ti ti-file-spreadsheet"></i> Exportar Excel</button>
        </div>

        <div id="br-medicos"></div>

        <div class="br-diag">
          <div class="br-diag-card"><span>${res.nLinhas.toLocaleString('pt-BR')}</span>linhas de conta</div>
          <div class="br-diag-card"><span>${res.nCasou.toLocaleString('pt-BR')}</span>casaram na BASE TABELA</div>
          <div class="br-diag-card"><span>${res.semMatch.toLocaleString('pt-BR')}</span>sem repasse (material/taxa)</div>
          <div class="br-diag-card"><span>${res.nBase.toLocaleString('pt-BR')}</span>procedimentos na BASE TABELA</div>
        </div>
        <div class="br-fonte">Valor de consumo total das contas: <strong>${fmt(res.valorConsumo)}</strong> ·
          fonte das contas: <strong>${esc(res.abasContas.join(', '))}</strong> · regras: <strong>${esc(res.abaBase)}</strong>${res.semData ? ` · <span style="color:#9A4E22">⚠ ${res.semData} linha${res.semData === 1 ? '' : 's'} sem Data Admissão legível → versão padrão (1.0)</span>` : ''}</div>

        <details class="br-det">
          <summary>Detalhamento por convênio (${convs.length})</summary>
          <table class="br-tab">
            <thead><tr><th>Convênio</th><th class="br-num">Repasse</th></tr></thead>
            <tbody>${linhasConv}</tbody>
            <tfoot><tr><td>TOTAL</td><td class="br-num atlas-rep">${fmt(res.total)}</td></tr></tfoot><!-- V963 -->
          </table>
        </details>`;

      const btnExp = out.querySelector('#br-exportar');
      if (btnExp) btnExp.addEventListener('click', () => exportarExcel(res, nomeArq, btnExp));
      const btnMed = out.querySelector('#br-calc-medico');
      if (btnMed) btnMed.addEventListener('click', () => calcularErenderMedico(res, btnMed));
    }

    let estadoMatriz = null;
    const VINC_LABEL = { INTERNO: 'Interno', HIBRIDO: 'Híbrido', EXTERNO: 'Externo' };
    const STAT = {
      casou:        { l: 'OK',          c: 'br-st-ok' },
      sem_cadastro: { l: 'S/ CADASTRO', c: 'br-st-warn' },
      sem_producao: { l: 'S/ PRODUÇÃO', c: 'br-st-erro' },
      sem_regra:    { l: 'S/ REGRA',    c: 'br-st-reg' },
    };
    const STATUS_FILTRO = [
      { v: 'casou', l: 'OK' }, { v: 'sem_cadastro', l: 'S/ Cadastro' },
      { v: 'sem_producao', l: 'S/ Produção' }, { v: 'sem_regra', l: 'S/ Regra' },
    ];

    function calcularErenderMedico(res, btn) {
      const alvo = out.querySelector('#br-medicos');
      const txt = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 br-spin"></i> Calculando…';
      setTimeout(() => {
        try {
          const med = window.BalancoRetroativo.calcularPorMedico(res);
          if (med.erro) {
            alvo.innerHTML = `<div class="br-status br-status-erro"><i class="ti ti-alert-triangle"></i> ${esc(med.erro)} Importe a produção e a tabela de repasse no ATLAS antes.</div>`;
            return;
          }
          res._matriz = med;
          estadoMatriz = { med, vinculo: new Set(['INTERNO', 'HIBRIDO', 'EXTERNO']), mes: 'todos', medico: 'todos',
            status: new Set(['casou', 'sem_cadastro', 'sem_producao', 'sem_regra']),
            lioConv: new Set(med.lioConvenios || []),
            aba: 'geral', opmeSoEleg: false, opmeSoRep: false, nomeArq: res._nomeArq };
          renderMatriz(alvo);
        } catch (e) {
          alvo.innerHTML = `<div class="br-status br-status-erro"><i class="ti ti-alert-triangle"></i> ${esc(e.message || e)}</div>`;
        } finally {
          btn.disabled = false; btn.innerHTML = txt;
        }
      }, 30);
    }

    function matrizVisiveis() {
      const { med, mes, status, medico } = estadoMatriz;
      return med.linhas.filter(l => (mes === 'todos' || l.competencia === mes)
        && status.has(l.status)
        && (medico === 'todos' || (l.profissional || '') === medico));
    }
    function incluida(l) {
      return l.status === 'casou' && l.tipoVinculo && estadoMatriz.vinculo.has(l.tipoVinculo);
    }
    function matrizPagaveis() { return matrizVisiveis().filter(incluida); }

    function wireFiltrosComuns(alvo) {
      const selMes = alvo.querySelector('#br-mes');
      if (selMes) selMes.addEventListener('change', () => { estadoMatriz.mes = selMes.value; renderMatriz(alvo); });
      const selMedico = alvo.querySelector('#br-medico');
      if (selMedico) selMedico.addEventListener('change', () => { estadoMatriz.medico = selMedico.value; renderMatriz(alvo); });
      alvo.querySelectorAll('input[data-lioconv]').forEach(ck => ck.addEventListener('change', () => {
        const c = ck.dataset.lioconv;
        if (ck.checked) estadoMatriz.lioConv.add(c); else estadoMatriz.lioConv.delete(c);
        renderMatriz(alvo);
      }));
      alvo.querySelectorAll('.br-lio-mini[data-lioall]').forEach(b => b.addEventListener('click', () => {
        estadoMatriz.lioConv = b.dataset.lioall === '1' ? new Set(estadoMatriz.med.lioConvenios || []) : new Set();
        renderMatriz(alvo);
      }));
      alvo.querySelectorAll('.br-aba[data-aba]').forEach(b => b.addEventListener('click', () => {
        estadoMatriz.aba = b.dataset.aba; renderMatriz(alvo);
      }));
    }

    function renderMatriz(alvo) {
      const { med, vinculo, mes } = estadoMatriz;
      // filtro LIO: zera o repasse das linhas LIO de convênios não selecionados
      med.linhas.forEach(l => { if (l.desempenho === 'LIO') l.repasse = estadoMatriz.lioConv.has(l.convenio) ? (l.repasseBase || 0) : 0; });
      med.opme.forEach(o => { if (o.tipo === 'LIO' && o.repasseBase != null) o.repasse = estadoMatriz.lioConv.has(o.convenio) ? o.repasseBase : 0; });
      const visiveis = matrizVisiveis();
      const pagaveis = matrizPagaveis();
      const totalPag = pagaveis.reduce((a, l) => a + l.repasse, 0);
      const nMed = new Set(pagaveis.map(l => l.medicoId)).size;
      const nOrfas = visiveis.filter(l => l.status === 'sem_producao').length;
      const nSemCad = visiveis.filter(l => l.status === 'sem_cadastro').length;

      const chips = ['INTERNO', 'HIBRIDO', 'EXTERNO'].map(v =>
        `<button class="br-chip ${vinculo.has(v) ? 'on' : ''}" data-vinc="${v}">${VINC_LABEL[v]}</button>`).join('');
      const optMes = ['<option value="todos">Todos os meses</option>']
        .concat(med.meses.map(m => `<option value="${esc(m)}" ${m === mes ? 'selected' : ''}>${esc(m)}</option>`)).join('');
      // lista suspensa de médicos (profissionais distintos da matriz, ordenada)
      const medicosUnicos = Array.from(new Set(med.linhas.map(l => l.profissional).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const optMed = ['<option value="todos">Todos os médicos</option>']
        .concat(medicosUnicos.map(nm => `<option value="${esc(nm)}" ${nm === estadoMatriz.medico ? 'selected' : ''}>${esc(nm)}</option>`)).join('');
      // checkboxes pequenos de convênios que pagam LIO
      const lioChips = (med.lioConvenios && med.lioConvenios.length) ? med.lioConvenios.map(c =>
        `<label class="br-lio-ck"><input type="checkbox" data-lioconv="${esc(c)}" ${estadoMatriz.lioConv.has(c) ? 'checked' : ''}><span>${esc(c || '(sem convênio)')}</span></label>`).join('') : '';

      const toggle = `<div class="br-aba-toggle">
        <button class="br-aba ${(estadoMatriz.aba || 'geral') === 'geral' ? 'on' : ''}" data-aba="geral"><i class="ti ti-table"></i> Repasse (geral)</button>
        <button class="br-aba ${estadoMatriz.aba === 'opme' ? 'on' : ''}" data-aba="opme"><i class="ti ti-cpu"></i> OPME (${med.opme.length})</button>
      </div>`;

      // ===== ABA OPME: matriz própria dos OPMEs =====
      if (estadoMatriz.aba === 'opme') {
        const itens = med.opme.filter(o =>
          (mes === 'todos' || o.competencia === mes) &&
          (estadoMatriz.medico === 'todos' || o.medico === estadoMatriz.medico) &&
          (!estadoMatriz.opmeSoEleg || o.elegivel) &&
          (!estadoMatriz.opmeSoRep || o.repasse > 0));
        const totProd = itens.reduce((a, o) => a + (o.valor || 0), 0);
        const totRep = itens.reduce((a, o) => a + (o.repasse || 0), 0);
        const nLio = itens.filter(o => o.tipo === 'LIO' && o.repasse > 0).length;
        const LIMO = 1000;
        const rows = itens.slice(0, LIMO).map(o => `<tr class="${o.repasse > 0 ? '' : 'br-orfa'}">
          <td>${esc(o.admissao)}</td><td>${esc(o.produto)}</td><td>${esc(o.convenio)}</td><td>${esc(o.medico)}</td>
          <td>${esc(o.competencia)}</td><td>${o.repasse > 0 ? `<span class="br-tipo br-tipo-${(o.tipo || 'OPME').toLowerCase()}">${esc(o.tipo || 'OPME')}</span>` : (o.elegivel ? '' : '<span class="br-naoeleg">não elegível</span>')}</td>
          <td class="br-num">${fmt(o.valor)}</td><td class="br-num">${o.repasse > 0 ? o.pct + '%' : '—'}</td><td class="br-num${o.repasse > 0 ? ' atlas-rep' : ''}">${o.repasse > 0 ? fmt(o.repasse) : '—'}</td></tr>`).join('');
        const trunc = itens.length > LIMO ? `<div class="br-fonte">Mostrando ${LIMO} de ${itens.length.toLocaleString('pt-BR')}.</div>` : '';
        alvo.innerHTML = `
          ${toggle}
          <div class="br-hero br-hero-med">
            <div class="br-hero-lbl">REPASSE DE OPME${mes !== 'todos' ? ' · ' + esc(mes) : ''}</div>
            <div class="br-hero-val">${fmt(totRep)}</div>
            <div class="br-hero-sub">${itens.length} itens · produção ${fmt(totProd)} · ${nLio} LIO</div>
          </div>
          <div class="br-matriz-bar">
            <div class="br-filtro-grupo"><span class="br-filtro-lbl">Mês</span><select class="br-select" id="br-mes">${optMes}</select></div>
            <div class="br-filtro-grupo"><span class="br-filtro-lbl">Médico</span><select class="br-select" id="br-medico">${optMed}</select></div>
            <div class="br-filtro-grupo"><span class="br-filtro-lbl">Mostrar</span><div class="br-chips">
              <label class="br-lio-ck"><input type="checkbox" id="br-opme-eleg" ${estadoMatriz.opmeSoEleg ? 'checked' : ''}><span>só elegíveis</span></label>
              <label class="br-lio-ck"><input type="checkbox" id="br-opme-rep" ${estadoMatriz.opmeSoRep ? 'checked' : ''}><span>só com repasse</span></label>
            </div></div>
            ${lioChips ? `<div class="br-filtro-grupo br-filtro-lio"><span class="br-filtro-lbl">LIO — convênios que pagam <button class="br-lio-mini" data-lioall="1">todos</button><button class="br-lio-mini" data-lioall="0">limpar</button></span><div class="br-chips">${lioChips}</div></div>` : ''}
          </div>
          <div class="br-matriz-wrap">
            <table class="br-tab br-matriz">
              <thead><tr><th>Admissão</th><th>Produto</th><th>Convênio</th><th>Médico</th><th>Mês</th><th>Tipo</th><th class="br-num">Valor produção</th><th class="br-num">%</th><th class="br-num">Repasse</th></tr></thead>
              <tbody>${rows || `<tr><td colspan="9" class="br-vazio">Nenhum OPME com este filtro.</td></tr>`}</tbody>
              <tfoot><tr><td colspan="6">TOTAL</td><td class="br-num">${fmt(totProd)}</td><td></td><td class="br-num atlas-rep">${fmt(totRep)}</td></tr></tfoot><!-- V963 -->
            </table>
          </div>
          ${trunc}`;
        wireFiltrosComuns(alvo);
        const ckE = alvo.querySelector('#br-opme-eleg'); if (ckE) ckE.addEventListener('change', () => { estadoMatriz.opmeSoEleg = ckE.checked; renderMatriz(alvo); });
        const ckR = alvo.querySelector('#br-opme-rep'); if (ckR) ckR.addEventListener('change', () => { estadoMatriz.opmeSoRep = ckR.checked; renderMatriz(alvo); });
        return;
      }
      // ===== fim ABA OPME =====

      const LIM = 800;
      const linhasTab = visiveis.slice(0, LIM).map(l => {
        const st = STAT[l.status] || STAT.casou;
        const fora = (l.status === 'casou' && !incluida(l));
        const stTag = fora ? '<span class="br-st br-st-fora">FORA</span>' : `<span class="br-st ${st.c}">${st.l}</span>`;
        return `<tr class="${l.status === 'sem_producao' ? 'br-orfa' : ''}${fora ? ' br-row-fora' : ''}">
          <td>${stTag}</td><td>${esc(l.admissao)}</td><td>${esc(l.data)}</td>
          <td>${esc(l.profissional)}${l.tipoVinculo ? ' ' + (Utilidades.badgeVinculo(l.tipoVinculo) || `<span class="br-vinc">${esc(l.tipoVinculo)}</span>`) : ''}</td><!-- V960: tag padrão de vínculo -->
          <td>${esc(l.papel)}</td><td>${esc(l.procedimento)}${l.substituido ? ' <span class="br-subst" title="Procedimento trazido da produção (o produto do relatório não batia)">↔ proc. produção</span>' : (l.profProducao ? ' <span class="br-subst" title="Profissional puxado da produção; regra aplicada pelo procedimento do relatório">↔ prof. produção</span>' : '')}${l.motivo ? ` <span class="br-motivo" title="${esc(l.motivo)}">— ${esc(l.motivo)}</span>` : ''}</td><td>${l.origem ? Utilidades.badgeFonte(l.origem) : ''}</td>
          <td>${esc(l.convenio)}</td><td class="br-num">${l.produzido ? fmt(l.produzido) : '—'}</td>
          <td class="br-num atlas-rep">${l.desempenho === 'ESTRABISMO' ? `<div class="br-estr-qtd" data-cod="${esc(l.estrCod)}" data-comp="${esc(l.estrComp)}" data-sus="${l.estrSus ? 1 : 0}"><button class="br-eq ${l.estrQtd === 0 ? 'on' : ''}" data-q="0" title="Não marcar">—</button><button class="br-eq ${l.estrQtd === 1 ? 'on' : ''}" data-q="1" title="Unilateral">1</button><button class="br-eq ${l.estrQtd === 2 ? 'on' : ''}" data-q="2" title="Bilateral">2</button></div>` : ''}${fmt(l.repasse)}${l.fonteRegra ? ` <span class="br-vinc" title="Fonte da regra aplicada nesta linha (pela Data Admissão)">${esc(l.fonteRegra)}</span>` : ''}</td></tr>`;
      }).join('');
      const truncado = visiveis.length > LIM ? `<div class="br-fonte">Mostrando ${LIM} de ${visiveis.length.toLocaleString('pt-BR')} linhas (use os filtros). O Excel traz tudo.</div>` : '';
      // V635: transparência das VIGÊNCIAS — lista as versões publicadas; cada
      // linha da matriz mostra a fonte aplicada (vX / tabela viva / exceção)
      const _vinfoBal = montarVersoesBalanco();
      const versoesHtml = _vinfoBal
        ? `<div class="br-fonte">📌 Versões publicadas da Base Tabela: ${_vinfoBal.lista.map(v => `<strong>${esc(v.numero)}</strong> (vigência ${esc(String(v.data_vigencia).split('-').reverse().join('/'))})`).join(' · ')} — a etiqueta ao lado do Repasse mostra a versão aplicada pela Data Admissão de cada linha.</div>`
        : `<div class="br-fonte">📌 Nenhuma versão da Base Tabela publicada — todas as linhas usam a tabela viva atual.</div>`;

      const opmeMes = mes === 'todos' ? med.opme : med.opme.filter(o => o.competencia === mes);
      const opmeMesTotal = opmeMes.reduce((a, o) => a + o.valor, 0);
      const opmeMesRepasse = opmeMes.reduce((a, o) => a + (o.repasse || 0), 0);
      // destaque: COLA BIOLÓGICA, ISTENT, PRESERFLO (repasse separado)
      const destaqueHtml = (med.destaque && med.destaque.length) ? `
        <div class="br-destaque">
          <span class="br-destaque-lbl"><i class="ti ti-flag"></i> Itens pagos em destaque</span>
          ${med.destaque.map(d => `<div class="br-destaque-card"><span class="br-destaque-nome">${esc(d.label)}</span><span class="br-destaque-val">${fmt(d.total)}</span><span class="br-destaque-qtd">${d.qtd} ${d.qtd === 1 ? 'item' : 'itens'}</span></div>`).join('')}
        </div>` : '';
      const opmeHtml = med.opme.length ? `
        ${destaqueHtml}
        <details class="br-det">
          <summary>OPME na produção (${opmeMes.length}) — produção: ${fmt(opmeMesTotal)} · repasse: ${fmt(opmeMesRepasse)}</summary>
          <table class="br-tab">
            <thead><tr><th>Admissão</th><th>Produto</th><th>Convênio</th><th>Médico</th><th>Mês</th><th class="br-num">Valor produção</th><th>Tipo</th><th class="br-num">%</th><th class="br-num">Repasse</th></tr></thead>
            <tbody>${opmeMes.slice(0, 500).map(o => `<tr><td>${esc(o.admissao)}</td><td>${esc(o.produto)}</td><td>${esc(o.convenio)}</td><td>${esc(o.medico)}</td><td>${esc(o.competencia)}</td><td class="br-num">${fmt(o.valor)}</td><td>${o.repasse > 0 ? esc(o.tipo || 'OPME') : '—'}</td><td class="br-num">${o.repasse > 0 ? o.pct + '%' : '—'}</td><td class="br-num${o.repasse > 0 ? ' atlas-rep' : ''}">${o.repasse > 0 ? fmt(o.repasse) : '—'}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="5">TOTAL</td><td class="br-num">${fmt(opmeMesTotal)}</td><td colspan="2"></td><td class="br-num atlas-rep">${fmt(opmeMesRepasse)}</td></tr></tfoot><!-- V963 -->
          </table>
        </details>` : '';

      const statusChips = STATUS_FILTRO.map(s =>
        `<button class="br-chip ${estadoMatriz.status.has(s.v) ? 'on' : ''}" data-status="${s.v}">${s.l}</button>`).join('');

      // distintos sem_cadastro (por nome normalizado) pro painel de cadastro
      const nA = window.BalancoRetroativo.normAtlas;
      const semCad = {};
      med.linhas.forEach(l => {
        if (l.status !== 'sem_cadastro') return;
        const k = nA(l.profissional);
        if (!semCad[k]) semCad[k] = { nome: l.profissional, n: 0, total: 0 };
        semCad[k].n++; semCad[k].total += l.repasse;
      });
      const semCadList = Object.entries(semCad).sort((a, b) => b[1].total - a[1].total);
      const optMedicos = (med._medicos || (med._medicos = window.BalancoRetroativo.listarMedicosAtivos()))
        .map(m => `<option value="${m.id}">${esc(m.nome_oficial)}${m.tipo_vinculo ? ' · ' + esc(m.tipo_vinculo) : ''}</option>`).join('');
      const cadHtml = semCadList.length ? `
        <details class="br-det br-det-cad" open>
          <summary>Cadastrar médicos sem cadastro (${semCadList.length})</summary>
          <div class="br-cad-lista">
            ${semCadList.map(([k, m]) => `
              <div class="br-cad-row" data-prof="${esc(k)}">
                <div class="br-cad-nome">${esc(m.nome)} <span class="br-cad-meta">${m.n} linha(s) · ${fmt(m.total)}</span></div>
                <div class="br-cad-acoes">
                  <select class="br-cad-vinc"><option value="INTERNO">Interno</option><option value="HIBRIDO">Híbrido</option><option value="EXTERNO">Externo</option></select>
                  <button class="br-cad-btn br-cad-novo">+ Cadastrar novo</button>
                  <span class="br-cad-ou">ou</span>
                  <select class="br-cad-exist"><option value="">vincular a um existente…</option>${optMedicos}</select>
                  <button class="br-cad-btn br-cad-vinc-btn">Vincular</button>
                </div>
              </div>`).join('')}
          </div>
        </details>` : '';

      alvo.innerHTML = `
        ${toggle}
        <div class="br-hero br-hero-med">
          <div class="br-hero-lbl">TOTAL A REPASSAR POR MÉDICO · regras do ATLAS${mes !== 'todos' ? ' · ' + esc(mes) : ''}</div>
          <div class="br-hero-val">${fmt(totalPag)}</div>
          <div class="br-hero-sub">${nMed} médicos · ${pagaveis.length} linhas pagáveis · ${nOrfas} sem produção · ${nSemCad} sem cadastro${med.nSubstituidos ? ' · ' + med.nSubstituidos + ' por admissão' : ''}</div>
        </div>

        <div class="br-matriz-bar">
          <div class="br-filtro-grupo"><span class="br-filtro-lbl">Vínculo (quem é pago)</span><div class="br-chips">${chips}</div></div>
          <div class="br-filtro-grupo"><span class="br-filtro-lbl">Status</span><div class="br-chips">${statusChips}</div></div>
          <div class="br-filtro-grupo"><span class="br-filtro-lbl">Mês</span><select class="br-select" id="br-mes">${optMes}</select></div>
          <div class="br-filtro-grupo"><span class="br-filtro-lbl">Médico</span><select class="br-select" id="br-medico">${optMed}</select></div>
          ${lioChips ? `<div class="br-filtro-grupo br-filtro-lio"><span class="br-filtro-lbl">LIO — convênios que pagam <button class="br-lio-mini" data-lioall="1">todos</button><button class="br-lio-mini" data-lioall="0">limpar</button></span><div class="br-chips">${lioChips}</div></div>` : ''}
          <button class="br-btn-exp br-btn-snap" id="br-snapshot"><i class="ti ti-device-floppy"></i> Salvar snapshot (marcar ${pagaveis.length} como pago)</button>
          <button class="br-btn-exp" id="br-exp-elegivel"><i class="ti ti-user-dollar"></i> Extrair por médico (elegível)</button>
        </div>
        <div id="br-snap-msg"></div>
        ${cadHtml}

        <div class="br-matriz-wrap">
          <table class="br-tab br-matriz">
            <thead><tr>
              <th>Status</th><th>Admissão</th><th>Data</th><th>Profissional</th><th>Papel</th>
              <th>Procedimento</th><th>Origem</th><th>Convênio</th><th class="br-num">Produzido (Part.)</th><th class="br-num">Repasse</th>
            </tr></thead>
            <tbody>${linhasTab || `<tr><td colspan="10" class="br-vazio">Nenhuma linha com este filtro.</td></tr>`}</tbody>
          </table>
        </div>
        ${truncado}
        ${versoesHtml}
        ${opmeHtml}`;

      alvo.querySelectorAll('.br-chip[data-vinc]').forEach(ch => ch.addEventListener('click', () => {
        const v = ch.dataset.vinc;
        if (estadoMatriz.vinculo.has(v)) estadoMatriz.vinculo.delete(v); else estadoMatriz.vinculo.add(v);
        renderMatriz(alvo);
      }));
      alvo.querySelectorAll('.br-chip[data-status]').forEach(ch => ch.addEventListener('click', () => {
        const s = ch.dataset.status;
        if (estadoMatriz.status.has(s)) estadoMatriz.status.delete(s); else estadoMatriz.status.add(s);
        renderMatriz(alvo);
      }));
      wireFiltrosComuns(alvo);
      const btnSnap = alvo.querySelector('#br-snapshot');
      if (btnSnap) btnSnap.addEventListener('click', () => salvarSnapshot(alvo, btnSnap));
      const btnEleg = alvo.querySelector('#br-exp-elegivel');
      if (btnEleg) btnEleg.addEventListener('click', () => exportarElegivelPorMedico(estadoMatriz.med, estadoMatriz.nomeArq, btnEleg,
        { vinculo: estadoMatriz.vinculo, mes: estadoMatriz.mes, medico: estadoMatriz.medico }));

      // marcação de estrabismo (qtd 1/2) → grava + recalcula a linha
      alvo.querySelectorAll('.br-estr-qtd .br-eq').forEach(btn => btn.addEventListener('click', () => {
        const grp = btn.closest('.br-estr-qtd');
        const cod = grp.dataset.cod, comp = grp.dataset.comp, sus = grp.dataset.sus === '1';
        const qNovo = Number(btn.dataset.q);
        const r = window.BalancoRetroativo.salvarMarcacaoEstrabismo(cod, comp, qNovo);
        if (r.erro) { alert(r.erro); return; }
        const e = estadoMatriz.med.estr || {};
        estadoMatriz.med.linhas.forEach(l => {
          if (l.desempenho === 'ESTRABISMO' && l.estrCod === cod && l.estrComp === comp) {
            l.estrQtd = qNovo;
            l.repasse = qNovo === 0 ? 0 : (sus ? (qNovo === 1 ? e.qtd1Sus : e.qtd2Sus) : (qNovo === 1 ? e.qtd1Conv : e.qtd2Conv));
          }
        });
        renderMatriz(alvo);
      }));

      // cadastro dos sem_cadastro
      const nrm = window.BalancoRetroativo.normAtlas;
      alvo.querySelectorAll('.br-cad-row').forEach(row => {
        const prof = row.dataset.prof;
        const achaNome = () => { const f = med.linhas.find(l => l.status === 'sem_cadastro' && nrm(l.profissional) === prof); return f ? f.profissional : prof; };
        const aplicar = (id, vinc) => {
          med.linhas.forEach(l => {
            if (l.status === 'sem_cadastro' && nrm(l.profissional) === prof) {
              l.status = 'casou'; l.medicoId = id; l.tipoVinculo = vinc || null; l.cadastrado = true;
            }
          });
          renderMatriz(alvo);
        };
        const bNovo = row.querySelector('.br-cad-novo');
        if (bNovo) bNovo.addEventListener('click', () => {
          const vinc = row.querySelector('.br-cad-vinc').value;
          const r = window.BalancoRetroativo.cadastrarMedicoNovo(achaNome(), vinc);
          if (r.erro) { alert(r.erro); return; }
          delete med._medicos;
          aplicar(r.id, r.vinculo || vinc);
        });
        const bVinc = row.querySelector('.br-cad-vinc-btn');
        if (bVinc) bVinc.addEventListener('click', () => {
          const mid = Number(row.querySelector('.br-cad-exist').value);
          if (!mid) { alert('Escolha um médico pra vincular.'); return; }
          const r = window.BalancoRetroativo.vincularDePara(achaNome(), mid);
          if (r.erro) { alert(r.erro); return; }
          aplicar(r.id, r.vinculo);
        });
      });
    }

    function salvarSnapshot(alvo, btn) {
      const pagaveis = matrizPagaveis();
      const msg = alvo.querySelector('#br-snap-msg');
      if (!pagaveis.length) { msg.innerHTML = `<div class="br-status br-status-erro">Nada pagável com os filtros atuais.</div>`; return; }
      const ok = window.confirm(`Marcar ${pagaveis.length} linha(s) como PAGAS no ATLAS?\n\nO Cálculo de Repasse deixará de pagar essas admissões. Grava no banco.`);
      if (!ok) return;
      const txt = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 br-spin"></i> Salvando…';
      setTimeout(() => {
        const r = window.BalancoRetroativo.salvarSnapshotBalanco(pagaveis);
        if (r.erro) msg.innerHTML = `<div class="br-status br-status-erro"><i class="ti ti-alert-triangle"></i> ${esc(r.erro)}</div>`;
        else msg.innerHTML = `<div class="br-status br-status-ok"><i class="ti ti-check"></i> Snapshot salvo: ${r.gravadas} linha(s) marcadas como pagas${r.ignoradas ? ` (${r.ignoradas} ignoradas)` : ''}.</div>`;
        btn.disabled = false; btn.innerHTML = txt;
      }, 30);
    }

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
  };
})();
