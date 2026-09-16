/*
 * ATLAS — V938: AJUSTE UNIDADES (o que o médico do Períodos recebe além do plantão).
 *
 * Regra ATLAS: o corpo clínico das unidades (médicos que estão no Períodos do
 * mês) recebe o valor fixo dos períodos e, por cima, só o que estiver MARCADO
 * na tela "Ajuste Unidades" da Auditoria — drilldown Unidade › Categoria ›
 * Procedimento com três colunas de fonte pagadora (Convênio · Particular · SUS).
 *   marcado  = paga
 *   vazio    = não paga (a linha do QVIS vai a zero na Auditoria / Produção Médica)
 *
 * PADRÃO (sem nada gravado) = a regra que já existia no código: em toda unidade
 * fora da Matriz, Consultas × Convênio não paga; todo o resto paga. Só o que
 * difere do padrão é gravado em `unidades_regras`, então "Voltar ao padrão" =
 * apagar a tabela.
 *
 *  · Unidade: Cadastros › Unidades (a Matriz é uma delas; sem cadastro de
 *    Matriz, entra uma sintética). A linha do QVIS casa pela coluna Unidade de
 *    Atendimento (sem acento/caixa; "MATRIZ" no texto → Matriz). O que não casa
 *    com o cadastro, ou vem vazio, cai em "Outras unidades" (tratada como
 *    unidade fora da Matriz).
 *  · Categoria: a coluna Categoria da Base Tabela (prod_categoria); na falta,
 *    a categoria mais frequente do produto na Produção importada; "consulta"
 *    no nome (ou urgência classificada como consulta) força "Consultas";
 *    senão "Sem categoria" — onde o usuário escolhe a categoria (gravada em
 *    `unidades_proc_categoria`).
 *  · Procedimento: o oficial da Base Tabela com que a linha casou (_procOficial);
 *    linha sem casamento entra pelo próprio nome do QVIS.
 */
(function () {
  'use strict';

  const OUTRAS = '__OUTRAS__';
  const MATRIZ_SINT = 'MATRIZ';
  const FONTES = ['CONVENIO', 'PARTICULAR', 'SUS'];
  const SEM_CATEGORIA = 'Sem categoria';
  const CONSULTAS = 'Consultas';

  const norm = (s) => (window.Utilidades && Utilidades.normalizar) ? Utilidades.normalizar(s) : String(s || '').toUpperCase().trim();
  let _tabelasOk = false;
  let _cache = { v: -1, regras: null, catOver: null, unidades: null, procCat: null, prodCat: null };

  function garantirTabelas() {
    if (_tabelasOk || !window.Banco || !Banco.db) return;
    try {
      Banco.db.exec(`CREATE TABLE IF NOT EXISTS unidades_regras (
        unidade TEXT NOT NULL, proc TEXT NOT NULL, fonte TEXT NOT NULL, paga INTEGER NOT NULL DEFAULT 1,
        atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (unidade, proc, fonte))`);
      Banco.db.exec(`CREATE TABLE IF NOT EXISTS unidades_proc_categoria (
        proc TEXT PRIMARY KEY, categoria TEXT NOT NULL, atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);
      _tabelasOk = true;
    } catch (e) { console.warn('[unidades_regras] garantirTabelas', e); }
  }
  function cache() {
    const v = (window.Banco && Banco._versao) || 0;
    if (_cache.v === v && _cache.regras) return _cache;
    garantirTabelas();
    const regras = new Map(), catOver = new Map(), quando = new Map();
    try { for (const r of Banco.query(`SELECT unidade, proc, fonte, paga, atualizado_em FROM unidades_regras`) || []) { const k = `${r.unidade}|${r.proc}|${r.fonte}`; regras.set(k, Number(r.paga) ? 1 : 0); quando.set(k, r.atualizado_em || ''); } } catch (_) {}
    try { for (const r of Banco.query(`SELECT proc, categoria FROM unidades_proc_categoria`) || []) catOver.set(r.proc, r.categoria); } catch (_) {}
    _cache = { v, regras, catOver, quando, unidades: null, procCat: null, prodCat: null };
    return _cache;
  }
  function tocar() {
    _cache.v = -1;
    try { Banco._versao = (Banco._versao || 0) + 1; } catch (_) {}
    try { if (Banco.salvarDebounced) Banco.salvarDebounced(1500); } catch (_) {}
  }

  // ── unidades ──
  function unidades() {
    const c = cache();
    if (c.unidades) return c.unidades;
    let lista = [];
    try {
      lista = (Banco.query(`SELECT nome FROM unidades WHERE ativo = 1 ORDER BY ordem, nome`) || [])
        .map(u => ({ key: norm(u.nome), nome: String(u.nome || '').trim() }))
        .filter(u => u.key);
    } catch (_) {}
    if (!lista.some(u => u.key.includes('MATRIZ'))) lista.unshift({ key: MATRIZ_SINT, nome: 'Matriz' });
    for (const u of lista) u.ehMatriz = u.key.includes('MATRIZ');
    lista.sort((a, b) => (b.ehMatriz ? 1 : 0) - (a.ehMatriz ? 1 : 0));
    lista.push({ key: OUTRAS, nome: 'Outras unidades', ehMatriz: false, outras: true });
    c.unidades = lista;
    return lista;
  }
  function ehMatriz(key) { return String(key || '').includes('MATRIZ'); }
  // Casamento do texto do QVIS ("UN. NORTE", "UNIDADE NORTE - SALA 2") com o
  // cadastro ("Unidade Norte"): compara os tokens SIGNIFICATIVOS (sem
  // "UNIDADE/UN/HOSPITAL/ATLAS/DE/DA…"); vale a unidade cujos tokens estão todos
  // no texto. Texto vazio ou sem casamento → "Outras unidades".
  const STOP = new Set(['UNIDADE', 'UNID', 'UN', 'U', 'HOSPITAL', 'HOSP', 'CBV', 'ATLAS', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'CLINICA', 'FILIAL', 'LOJA', 'SALA']);
  const tokens = (s) => norm(s).split(/[^A-Z0-9]+/).filter(x => x && !STOP.has(x));
  function resolverUnidade(texto) {
    const t = norm(texto);
    const lista = unidades();
    if (!t) return OUTRAS;
    if (t.includes('MATRIZ')) return (lista.find(u => u.ehMatriz) || { key: MATRIZ_SINT }).key;
    const tt = tokens(t);
    let melhor = null, melhorN = 0;
    for (const u of lista) {
      if (u.outras || u.ehMatriz) continue;
      if (t === u.key) return u.key;
      const tu = tokens(u.key);
      if (!tu.length) continue;
      const bate = tu.every(x => tt.some(y => y === x || (x.length >= 4 && (y.startsWith(x) || x.startsWith(y)))));
      if (bate && tu.length > melhorN) { melhor = u; melhorN = tu.length; }
    }
    if (melhor) return melhor.key;
    for (const u of lista) if (!u.outras && !u.ehMatriz && (t.includes(u.key) || u.key.includes(t))) return u.key;
    return OUTRAS;
  }
  function nomeUnidade(key) { const u = unidades().find(x => x.key === key); return u ? u.nome : String(key || ''); }

  // ── categoria ──
  function ehConsultaNome(nome, classificacao) {
    const p = norm(nome);
    return p.includes('CONSULTA') || (p.includes('URGENC') && norm(classificacao).includes('CONSULTA'));
  }
  function ehCatConsulta(cat) { return norm(cat).startsWith('CONSULTA'); }
  function mapaProcCat() {
    const c = cache();
    if (c.procCat) return c.procCat;
    const m = new Map();
    try { for (const r of Banco.query(`SELECT nome_normalizado AS n, prod_categoria AS c FROM procedimentos WHERE prod_categoria IS NOT NULL AND TRIM(prod_categoria) <> ''`) || []) m.set(r.n, String(r.c).trim()); } catch (_) {}
    c.procCat = m;
    return m;
  }
  function mapaProdCat() {
    const c = cache();
    if (c.prodCat) return c.prodCat;
    const m = new Map();
    try {
      const cont = new Map();
      for (const r of Banco.query(`SELECT produto, categoria, COUNT(*) AS n FROM linhas_producao WHERE categoria IS NOT NULL AND TRIM(categoria) <> '' GROUP BY produto, categoria`) || []) {
        const k = norm(r.produto); if (!k) continue;
        const n = Number(r.n) || 0;
        if (!cont.has(k) || n > cont.get(k)) { cont.set(k, n); m.set(k, String(r.categoria).trim()); }
      }
    } catch (_) {}
    c.prodCat = m;
    return m;
  }
  // nome OFICIAL da Base Tabela a partir de um nome qualquer (oficial ou sinônimo cadastrado)
  function mapaOficial() {
    const c = cache();
    if (c.oficial) return c.oficial;
    const m = new Map();
    try { for (const r of Banco.query(`SELECT nome_oficial AS nome, nome_normalizado AS n FROM procedimentos`) || []) if (r.n) m.set(r.n, r.nome); } catch (_) {}
    try {
      for (const r of Banco.query(`SELECT s.grafia_normalizada AS g, p.nome_oficial AS nome FROM sinonimos_proc s JOIN procedimentos p ON p.id = s.procedimento_id`) || []) {
        if (r.g && !m.has(r.g)) m.set(r.g, r.nome);
      }
    } catch (_) {}
    c.oficial = m;
    return m;
  }
  function oficialDe(nome) { return mapaOficial().get(norm(nome)) || null; }

  // categoria do procedimento (nome oficial ou nome do QVIS); classificacao = coluna do QVIS
  function categoriaDe(nome, classificacao, nomeQvis) {
    const k = norm(nome);
    const over = cache().catOver.get(k);
    if (over) return over;
    if (ehConsultaNome(nome, classificacao) || (nomeQvis && ehConsultaNome(nomeQvis, classificacao))) return CONSULTAS;
    return mapaProcCat().get(k) || mapaProdCat().get(k) || (nomeQvis ? (mapaProcCat().get(norm(nomeQvis)) || mapaProdCat().get(norm(nomeQvis))) : null) || SEM_CATEGORIA;
  }

  // ── fonte ──
  function fonteDe(origem) {
    const f = norm(origem);
    if (!f) return null;
    if (f.startsWith('CONV')) return 'CONVENIO';
    if (f.startsWith('PART')) return 'PARTICULAR';
    if (f === 'SUS' || f.startsWith('SUS')) return 'SUS';
    return null;
  }

  // ── estado (padrão + gravado) ──
  function padrao(unidadeKey, categoria, fonte) {
    return (!ehMatriz(unidadeKey) && ehCatConsulta(categoria) && fonte === 'CONVENIO') ? 0 : 1;
  }
  function estado(unidadeKey, procNorm, categoria, fonte) {
    const g = cache().regras.get(`${unidadeKey}|${procNorm}|${fonte}`);
    return g != null ? g : padrao(unidadeKey, categoria, fonte);
  }
  function paga(unidadeKey, procNorm, categoria, fonte) { return estado(unidadeKey, procNorm, categoria, fonte) === 1; }

  /**
   * Decide uma linha do QVIS (ou da Produção): { paga, unidadeKey, unidadeNome, categoria, proc, procNome, fonte, motivo }.
   * ctx = { unidade, procNome (oficial), nomeQvis, classificacao, origem, medicoPeriodos }
   */
  function decidir(ctx) {
    const fonte = fonteDe(ctx.origem);
    const out = { paga: true, fonte, unidadeKey: null, unidadeNome: '', categoria: null, proc: null, procNome: ctx.procNome || ctx.nomeQvis || '', motivo: '' };
    if (!ctx.medicoPeriodos || !fonte) return out;
    const unidadeKey = resolverUnidade(ctx.unidade);
    const procNome = ctx.procNome || oficialDe(ctx.nomeQvis) || ctx.nomeQvis || '';
    const proc = norm(procNome);
    const categoria = categoriaDe(procNome, ctx.classificacao, ctx.nomeQvis);
    out.unidadeKey = unidadeKey; out.unidadeNome = nomeUnidade(unidadeKey); out.categoria = categoria; out.proc = proc; out.procNome = procNome;
    out.paga = paga(unidadeKey, proc, categoria, fonte);
    if (!out.paga) out.motivo = `Ajuste Unidades: ${out.unidadeNome} › ${categoria} › ${procNome} › ${Utilidades.rotuloFonte(fonte)} — médico do Períodos não recebe`;
    return out;
  }

  // V939: o ajuste gravado (se houver) para a combinação — { paga, quando } ou null
  function regraGravada(unidadeKey, procNorm, fonte) {
    const c = cache(); const k = `${unidadeKey}|${procNorm}|${fonte}`;
    return c.regras.has(k) ? { paga: c.regras.get(k) === 1, quando: c.quando.get(k) || '' } : null;
  }
  // V939: o que a Base Tabela ATUAL paga por papel para procedimento × fonte
  // → [{ papelId, papel, valor, percentual }] (fonte específica vence 'TODAS')
  function valoresRegra(procNorm, fonte) {
    const out = new Map();
    try {
      const rows = Banco.query(`SELECT t.papel_id AS papelId, pa.nome AS papel, t.valor, t.percentual, UPPER(TRIM(t.fonte_pagadora)) AS f
          FROM tabela_repasse t JOIN procedimentos p ON p.id = t.procedimento_id JOIN papeis pa ON pa.id = t.papel_id
         WHERE p.nome_normalizado = ? AND COALESCE(t.ativo, 1) = 1 AND (UPPER(TRIM(t.fonte_pagadora)) = ? OR UPPER(TRIM(t.fonte_pagadora)) = 'TODAS')`, [procNorm, fonte]) || [];
      for (const r of rows) {
        const temValor = r.valor != null && Number(r.valor) !== 0, temPct = r.percentual != null && Number(r.percentual) !== 0;
        if (!temValor && !temPct) continue;
        const atual = out.get(r.papelId);
        if (atual && atual.f !== 'TODAS') continue;   // específica já registrada
        out.set(r.papelId, { papelId: r.papelId, papel: r.papel, valor: temValor ? Number(r.valor) : null, percentual: temPct ? Number(r.percentual) : null, f: r.f });
      }
    } catch (e) { console.warn('[unidades_regras] valoresRegra', e); }
    return [...out.values()];
  }

  // ── gravação ──
  function definir(unidadeKey, itens, fonte, pagar) {
    // itens = [{ proc, categoria }]; só o que difere do padrão fica gravado
    garantirTabelas();
    const v = pagar ? 1 : 0;
    for (const it of itens) {
      const pd = padrao(unidadeKey, it.categoria, fonte);
      if (pd === v) Banco.executar(`DELETE FROM unidades_regras WHERE unidade = ? AND proc = ? AND fonte = ?`, [unidadeKey, it.proc, fonte]);
      else Banco.executar(`INSERT OR REPLACE INTO unidades_regras (unidade, proc, fonte, paga, atualizado_em) VALUES (?, ?, ?, ?, datetime('now'))`, [unidadeKey, it.proc, fonte, v]);
    }
    tocar();
  }
  function definirCategoria(procNorm, categoria) {
    garantirTabelas();
    const c = String(categoria || '').trim();
    if (!c) Banco.executar(`DELETE FROM unidades_proc_categoria WHERE proc = ?`, [procNorm]);
    else Banco.executar(`INSERT OR REPLACE INTO unidades_proc_categoria (proc, categoria, atualizado_em) VALUES (?, ?, datetime('now'))`, [procNorm, c]);
    tocar();
  }
  function voltarPadrao() {
    garantirTabelas();
    try { Banco.executar(`DELETE FROM unidades_regras`); } catch (_) {}
    tocar();
  }
  function nRegrasGravadas() { return cache().regras.size; }

  // ── médicos do Períodos no mês (de-para expandido) ──
  function medicosPeriodos(comp) {
    const set = new Set();
    try {
      const nomesPer = Banco.query(`SELECT DISTINCT nome_normalizado FROM periodos_linhas WHERE mes_ref = ?`, [comp]) || [];
      if (!nomesPer.length) return set;
      const nomeParaId = new Map(), idParaNomes = new Map();
      const add = (nn, id) => { if (!nn || id == null) return; nomeParaId.set(nn, id); if (!idParaNomes.has(id)) idParaNomes.set(id, []); idParaNomes.get(id).push(nn); };
      try { (Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM medicos`) || []).forEach(m => add(norm(m.nome_normalizado || m.nome_oficial), m.id)); } catch (_) {}
      try { (Banco.query(`SELECT grafia, grafia_normalizada, medico_id FROM sinonimos_medico`) || []).forEach(s => add(norm(s.grafia_normalizada || s.grafia), s.medico_id)); } catch (_) {}
      for (const row of nomesPer) {
        const nn = norm(row.nome_normalizado); if (!nn) continue;
        set.add(nn);
        const id = nomeParaId.get(nn);
        if (id != null && idParaNomes.has(id)) idParaNomes.get(id).forEach(x => set.add(x));
      }
    } catch (e) { console.warn('[unidades_regras] medicosPeriodos', e); }
    return set;
  }

  // ── modelo do drilldown ──
  function lerSnapshot(comp) {
    try {
      const r = Banco.query(`SELECT resultado_json FROM repasse_snapshot WHERE competencia = ?`, [comp]);
      if (!r || !r[0]) return null;
      const raw = r[0].resultado_json;
      return JSON.parse(Banco.snapUnpack ? Banco.snapUnpack(raw) : raw);
    } catch (_) { return null; }
  }
  function arvore(comp) {
    const unis = unidades();
    const procs = new Map();   // norm → { proc, nome, categoria, oficial }
    try {
      for (const r of Banco.query(`SELECT nome_oficial AS nome, nome_normalizado AS n FROM procedimentos WHERE COALESCE(repassavel, 1) = 1 ORDER BY nome_oficial`) || []) {
        if (r.n) procs.set(r.n, { proc: r.n, nome: r.nome, categoria: categoriaDe(r.nome, ''), oficial: true });
      }
    } catch (_) {}
    // contagem por unidade × proc × fonte a partir do snapshot do mês (só médicos do Períodos)
    const cont = new Map();   // `${uni}|${proc}|${fonte}` → n
    const nUni = new Map();
    const perSet = comp ? medicosPeriodos(comp) : new Set();
    const snap = comp ? lerSnapshot(comp) : null;
    if (snap && Array.isArray(snap.linhas) && perSet.size) {
      let uniMap = null;
      try { uniMap = new Map((Banco.query(`SELECT id, unidade_atendimento AS u FROM linhas_qvis WHERE mes_pagamento = ? OR competencia = ?`, [comp, comp]) || []).map(r => [r.id, r.u])); } catch (_) {}
      for (const l of snap.linhas) {
        if (!perSet.has(norm(l.nome_profissional))) continue;
        const fonte = fonteDe(l.origem); if (!fonte) continue;
        const uTxt = (uniMap && uniMap.get(l.id)) || l.unidade_atendimento || '';
        const uni = resolverUnidade(uTxt);
        const nome = l._procOficial || l.procedimento || '';
        const k = norm(nome); if (!k) continue;
        if (!procs.has(k)) procs.set(k, { proc: k, nome, categoria: categoriaDe(nome, l.classificacao, l.procedimento), oficial: false });
        else if (ehConsultaNome(l.procedimento, l.classificacao) && !ehCatConsulta(procs.get(k).categoria) && !cache().catOver.has(k)) procs.get(k).categoria = CONSULTAS;
        const kk = `${uni}|${k}|${fonte}`;
        cont.set(kk, (cont.get(kk) || 0) + 1);
        nUni.set(uni, (nUni.get(uni) || 0) + 1);
      }
    }
    // categorias (chave normalizada → nome de exibição)
    const cats = new Map();
    for (const p of procs.values()) { const ck = norm(p.categoria); if (!cats.has(ck)) cats.set(ck, p.categoria); }
    const ordemCat = [...cats.keys()].sort((a, b) => {
      const sa = a === norm(SEM_CATEGORIA) ? 2 : (a.startsWith('CONSULTA') ? 0 : 1), sb = b === norm(SEM_CATEGORIA) ? 2 : (b.startsWith('CONSULTA') ? 0 : 1);
      return sa - sb || cats.get(a).localeCompare(cats.get(b), 'pt-BR');
    });
    const listaProcs = [...procs.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const out = unis.map(u => {
      const catsU = ordemCat.map(ck => {
        const ps = listaProcs.filter(p => norm(p.categoria) === ck).map(p => {
          const fontes = {};
          for (const f of FONTES) fontes[f] = { paga: paga(u.key, p.proc, p.categoria, f), n: cont.get(`${u.key}|${p.proc}|${f}`) || 0, gravado: cache().regras.has(`${u.key}|${p.proc}|${f}`) };
          return { proc: p.proc, nome: p.nome, categoria: p.categoria, oficial: p.oficial, fontes, nLinhas: FONTES.reduce((s, f) => s + fontes[f].n, 0) };
        });
        const fontes = {};
        for (const f of FONTES) fontes[f] = { total: ps.length, pagos: ps.filter(p => p.fontes[f].paga).length };
        return { key: ck, nome: cats.get(ck), semCategoria: ck === norm(SEM_CATEGORIA), procs: ps, fontes };
      }).filter(c => c.procs.length);
      const fontes = {};
      for (const f of FONTES) fontes[f] = { total: catsU.reduce((s, c) => s + c.fontes[f].total, 0), pagos: catsU.reduce((s, c) => s + c.fontes[f].pagos, 0) };
      return { key: u.key, nome: u.nome, ehMatriz: u.ehMatriz, outras: !!u.outras, nLinhas: nUni.get(u.key) || 0, cats: catsU, fontes };
    });
    return { unidades: out, categorias: ordemCat.map(k => cats.get(k)).filter(c => norm(c) !== norm(SEM_CATEGORIA)), nMedicosPeriodos: perSet.size, nRegras: nRegrasGravadas(), comp };
  }

  window.AtlasUnidadesRegras = {
    OUTRAS, FONTES, SEM_CATEGORIA, CONSULTAS,
    garantirTabelas, unidades, resolverUnidade, nomeUnidade, ehMatriz, oficialDe,
    categoriaDe, ehConsultaNome, fonteDe, padrao, estado, paga, decidir,
    definir, definirCategoria, voltarPadrao, nRegrasGravadas, medicosPeriodos, arvore,
    regraGravada, valoresRegra,   // V939 (verificador)
    _invalidar: () => { _cache.v = -1; },
  };
})();
