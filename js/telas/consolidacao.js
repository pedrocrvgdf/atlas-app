/**
 * ============================================================================
 * TELA: Consolidação de Repasse  (Saída → após Relatórios)
 *
 * LEVE por design (V229): trabalha SEMPRE por mês, lendo direto de linhas_qvis
 * com queries agregadas — NÃO monta a matriz/consolidado do Relatórios.
 *
 * Você informa um CÓDIGO (único do mês) e o sistema congela a LISTA DE
 * ADMISSÕES do mês sob esse código. Depois disso:
 *   • o que foi congelado fica intacto;
 *   • admissão NOVA (que aparecer depois) vira ACRÉSCIMO, a consolidar de novo
 *     sob o mesmo código.
 *
 * Portão: só consolida se NÃO houver ajustes pendentes no Gerenciais.
 * A tela mostra só o RESUMO (totais) + busca pontual de admissão.
 * ============================================================================
 */
(function () {
  'use strict';

  function garantirSchema() {
    try {
      Banco.executar(`
        CREATE TABLE IF NOT EXISTS consolidacao_mes (
          competencia    TEXT PRIMARY KEY,
          codigo         TEXT NOT NULL,
          consolidado_em TEXT DEFAULT CURRENT_TIMESTAMP,
          atualizado_em  TEXT
        );`);
      Banco.executar(`
        CREATE TABLE IF NOT EXISTS consolidacao_admissao (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          competencia  TEXT NOT NULL,
          codigo       TEXT NOT NULL,
          lote         INTEGER DEFAULT 1,
          admissao     TEXT NOT NULL,
          valor        REAL DEFAULT 0,
          congelado_em TEXT DEFAULT CURRENT_TIMESTAMP
        );`);
      Banco.executar(`CREATE INDEX IF NOT EXISTS idx_cons_adm ON consolidacao_admissao(competencia, admissao);`);
      // V615: quem consolidou (card "Responsável" do modal da linha do tempo)
      try { Banco.executar(`ALTER TABLE consolidacao_mes ADD COLUMN responsavel TEXT`); } catch (_) {}
      // V619: FOTO OFICIAL do consolidado do mês — congelada no ato de consolidar.
      // Mês consolidado passa a ser servido desta foto (Relatórios/Dashboard/
      // Visão Geral/totais), imune a mudanças posteriores de regras e cadastros.
      Banco.executar(`
        CREATE TABLE IF NOT EXISTS consolidacao_foto (
          competencia  TEXT PRIMARY KEY,
          linhas_json  TEXT NOT NULL,
          congelado_em TEXT DEFAULT CURRENT_TIMESTAMP
        );`);
    } catch (e) { console.warn('[consolidacao] schema:', e); }
  }

  const fmt = (n) => Utilidades.formatarNumero(Number(n) || 0, 2);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const q1 = (sql, p) => { try { return (Banco.query(sql, p) || [])[0] || {}; } catch (_) { return {}; } };

  // ── Competências: SOMENTE os meses de repasse importados no QVIS ──────────
  function listarCompetencias() {
    // V614: mesmo critério do V600 (Calcular/Auditoria/Relatórios) — o mês de
    // repasse é o MES_PAGAMENTO do QVIS. Antes listava linhas_qvis.competencia
    // (mês de produção da linha), o que trazia meses antigos (ex.: 2025) que
    // nunca foram importados como relatório de repasse.
    const set = new Set();
    try {
      (Banco.query(`SELECT DISTINCT mes_pagamento AS c FROM linhas_qvis WHERE mes_pagamento IS NOT NULL AND mes_pagamento <> ''`) || [])
        .forEach(r => {
          const c = r.c;
          if (c && c !== '0000-00' && String(c).toUpperCase() !== 'TODAS') set.add(c);
        });
    } catch (_) {}
    return [...set].filter(Boolean).sort().reverse();
  }
  function competenciaPadrao() { return listarCompetencias()[0] || ''; }

  // ── Resumos LEVES (queries agregadas em linhas_qvis) ──────────────────────
  // V237: total OFICIAL do mês = soma do consolidado do Relatórios (Convênio+Particular+SUS+Desempenho+Gerenciais),
  // o mesmo valor que o Dashboard usa. Antes somava o REPASSADO bruto do QVIS, que não passa pelas regras do app.
  function totalRepasseOficial(comp) {
    if (!comp) return 0;
    try {
      const R = window.AtlasRelatorios;
      if (R && typeof R.linhasConsolidadoComp === 'function') {
        return (R.linhasConsolidadoComp(comp) || []).reduce((s, l) => s + (Number(l.valor) || 0), 0);
      }
    } catch (e) { console.warn('[consolidacao] total oficial:', e); }
    return 0;
  }
  // V614: o universo do mês é o MÊS DE REPASSE (mes_pagamento) — o mesmo do
  // Calcular/Relatórios e do total oficial mostrado ao lado
  function resumoMes(comp) {
    // n = admissões do mês no QVIS; total = repasse oficial do app (Relatórios)
    const r = q1(`SELECT COUNT(DISTINCT admissao) AS n
                  FROM linhas_qvis WHERE mes_pagamento = ? AND admissao IS NOT NULL AND admissao <> ''`, [comp]);
    return { n: r.n || 0, total: totalRepasseOficial(comp) };
  }
  function admissoesDoMes(comp) {
    try {
      return Banco.query(`SELECT admissao, COALESCE(SUM(repassado),0) AS valor FROM linhas_qvis
                          WHERE mes_pagamento = ? AND admissao IS NOT NULL AND admissao <> '' GROUP BY admissao`, [comp]) || [];
    } catch (_) { return []; }
  }
  function codigoDoMes(comp) {
    if (!comp) return null;
    garantirSchema();
    const r = q1(`SELECT codigo FROM consolidacao_mes WHERE competencia = ?`, [comp]);
    return r.codigo || null;
  }
  function estaConsolidado(comp) { return !!codigoDoMes(comp); }

  // ── V619: foto oficial congelada do consolidado do mês ────────────────────
  // Memo de sessão (JSON de mês cheio tem MBs — não re-parsear a cada render)
  const _fotoMemo = {};   // comp → linhas[]
  function lerFotoConsolidado(comp) {
    if (!comp || !estaConsolidado(comp)) return null;
    if (_fotoMemo[comp]) return _fotoMemo[comp];
    garantirSchema();
    try {
      const r = q1(`SELECT linhas_json FROM consolidacao_foto WHERE competencia = ?`, [comp]);
      if (!r.linhas_json) return null;
      const linhas = JSON.parse(r.linhas_json);
      const ks = Object.keys(_fotoMemo);
      if (ks.length >= 4) delete _fotoMemo[ks[0]];
      _fotoMemo[comp] = linhas;
      return linhas;
    } catch (e) { console.warn('[consolidacao] lerFotoConsolidado:', e); return null; }
  }
  function gravarFotoConsolidado(comp, linhas) {
    if (!comp || !Array.isArray(linhas)) return false;
    garantirSchema();
    try {
      Banco.executar(`INSERT OR REPLACE INTO consolidacao_foto (competencia, linhas_json, congelado_em)
                      VALUES (?, ?, datetime('now'))`, [comp, JSON.stringify(linhas)]);
      delete _fotoMemo[comp];
      delete _fotoTsMemo[comp];
      // V633: derruba as fotos dos PAINÉIS (Visão Geral) desse mês — elas se
      // refazem a partir desta foto oficial, mantendo os totais alinhados
      try { Banco.executar(`DELETE FROM vg_calc_cache WHERE chave LIKE '%|' || ?`, [comp]); } catch (_) {}
      if (Banco.salvarDebounced) Banco.salvarDebounced(1500);
      console.log('[consolidacao] foto do consolidado congelada:', comp, '—', linhas.length, 'linhas');
      return true;
    } catch (e) { console.error('[consolidacao] gravarFotoConsolidado:', e); return false; }
  }
  // V633: quando a foto oficial foi congelada (pros painéis se conferirem)
  const _fotoTsMemo = {};
  function fotoCongeladaEm(comp) {
    if (!comp) return null;
    if (comp in _fotoTsMemo) return _fotoTsMemo[comp];
    let ts = null;
    try { ts = (q1(`SELECT congelado_em FROM consolidacao_foto WHERE competencia = ?`, [comp]) || {}).congelado_em || null; } catch (_) {}
    _fotoTsMemo[comp] = ts;
    return ts;
  }
  function apagarFotoConsolidado(comp) {
    if (!comp) return;
    garantirSchema();
    try {
      Banco.executar(`DELETE FROM consolidacao_foto WHERE competencia = ?`, [comp]);
      delete _fotoMemo[comp];
      delete _fotoTsMemo[comp];   // V633
    } catch (e) { console.warn('[consolidacao] apagarFotoConsolidado:', e); }
  }
  // recongela a foto a partir do cálculo AO VIVO (usada ao consolidar/acréscimo)
  function recongelarFoto(comp) {
    try {
      apagarFotoConsolidado(comp);
      const R = window.AtlasRelatorios;
      if (R && R.invalidarConsolidado) R.invalidarConsolidado(comp);
      // linhasCompletasComp com a foto ausente calcula ao vivo e regrava a foto
      if (R && R.linhasCompletasComp) R.linhasCompletasComp(comp);
    } catch (e) { console.warn('[consolidacao] recongelarFoto:', e); }
  }
  // API global — Relatórios/Visão Geral/Calcular respeitam a trava por aqui
  window.AtlasConsolidacao = Object.assign(window.AtlasConsolidacao || {}, {
    estaConsolidado,
    lerFotoConsolidado,
    gravarFotoConsolidado,
    apagarFotoConsolidado,
    fotoCongeladaEm,   // V633
  });
  function resumoCongelado(comp) {
    const r = q1(`SELECT COUNT(*) AS n, COALESCE(SUM(valor),0) AS total FROM consolidacao_admissao WHERE competencia = ?`, [comp]);
    return { n: r.n || 0, total: r.total || 0 };
  }
  // admissões do mês ainda NÃO congeladas (acréscimos) — só quando consolidado
  function resumoAcrescimos(comp) {
    if (!estaConsolidado(comp)) return { n: 0, total: 0 };
    const r = q1(`SELECT COUNT(*) AS n, COALESCE(SUM(t.valor),0) AS total FROM (
                    SELECT admissao, SUM(repassado) AS valor FROM linhas_qvis
                     WHERE mes_pagamento = ? AND admissao IS NOT NULL AND admissao <> ''
                       AND admissao NOT IN (SELECT admissao FROM consolidacao_admissao WHERE competencia = ?)
                     GROUP BY admissao) t`, [comp, comp]);
    return { n: r.n || 0, total: r.total || 0 };
  }
  // V614: repasse dividido — Calcular (matriz da Auditoria sobre o cálculo
  // salvo) e Desempenhos. Mesma fonte/foto da Visão Geral (cmpMes): lê a foto
  // se existir; senão calcula com a MESMA receita e fotografa (a VG reusa).
  function repasseDividido(comp) {
    try {
      if (window.AtlasVGUI && typeof window.AtlasVGUI.dadosRepasseMes === 'function') {
        const d = window.AtlasVGUI.dadosRepasseMes(comp) || {};
        return { repQvis: Number(d.repQvis) || 0, repDesemp: Number(d.repDesemp) || 0 };
      }
    } catch (e) { console.warn('[consolidacao] repasse dividido (VG):', e); }
    try {
      const D = window.VGExec;
      const foto = (D && D._fotoLer) ? D._fotoLer('cmpMes', comp) : null;
      if (foto) return { repQvis: Number(foto.repQvis) || 0, repDesemp: Number(foto.repDesemp) || 0 };
      const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
      const d = { repTotal: 0, repDesemp: 0, repQvis: 0, contabil: null };
      const linhas = (window.AtlasRelatorios && window.AtlasRelatorios.linhasConsolidadoComp)
        ? (window.AtlasRelatorios.linhasConsolidadoComp(comp) || []) : [];
      for (const l of linhas) {
        const v = Number(l.valor) || 0;
        d.repTotal += v;
        if (norm(l.status) === 'DESEMPENHO') d.repDesemp += v;
      }
      const matriz = (window.AtlasAuditoria && window.AtlasAuditoria.matrizDaCompetencia)
        ? (window.AtlasAuditoria.matrizDaCompetencia(comp) || []) : [];
      d.repQvis = matriz.reduce((s, l) => s + (Number(l._repasse) || 0), 0);
      try {
        d.contabil = (window.AtlasProducaoMedica && window.AtlasProducaoMedica.consolidacaoContabilPartes)
          ? window.AtlasProducaoMedica.consolidacaoContabilPartes(comp) : null;
      } catch (_) { d.contabil = null; }
      if (D && D._fotoGravar && (d.contabil !== null || d.repTotal !== 0)) D._fotoGravar('cmpMes', comp, d);
      return { repQvis: d.repQvis, repDesemp: d.repDesemp };
    } catch (e) { console.warn('[consolidacao] repasse dividido:', e); }
    return { repQvis: 0, repDesemp: 0 };
  }
  function pendentesGer(comp) {
    try { return (window.AtlasGerenciais && typeof window.AtlasGerenciais.contarPendentes === 'function') ? window.AtlasGerenciais.contarPendentes(comp) : 0; }
    catch (_) { return 0; }
  }
  function proximoLote(comp) {
    const r = q1(`SELECT MAX(lote) AS m FROM consolidacao_admissao WHERE competencia = ?`, [comp]);
    return (r.m || 0) + 1;
  }

  // busca pontual de uma admissão
  function buscarAdmissao(comp, termo) {
    const t = String(termo || '').trim();
    if (!comp || !t) return null;
    const r = q1(`SELECT admissao, COALESCE(SUM(repassado),0) AS valor, COUNT(*) AS linhas
                  FROM linhas_qvis WHERE mes_pagamento = ? AND admissao = ? GROUP BY admissao`, [comp, t]);
    if (!r.admissao) return { achou: false, termo: t };
    const c = q1(`SELECT codigo FROM consolidacao_admissao WHERE competencia = ? AND admissao = ? LIMIT 1`, [comp, t]);
    return { achou: true, admissao: r.admissao, valor: r.valor || 0, linhas: r.linhas || 0, congelada: !!c.codigo, codigo: c.codigo || null };
  }

  // ── Consolidar / reabrir ──────────────────────────────────────────────────
  function consolidar(comp, codigoInformado) {
    garantirSchema();
    if (!comp) return { ok: false, erro: 'Selecione uma competência.' };
    if (pendentesGer(comp) > 0) return { ok: false, erro: 'Há ajustes pendentes no Gerenciais. Trate-os antes de consolidar.' };
    const existente = codigoDoMes(comp);
    const codigo = (existente || String(codigoInformado || '').trim());
    if (!codigo) return { ok: false, erro: 'Informe o código do repasse.' };

    const congSet = new Set();
    try { (Banco.query(`SELECT admissao FROM consolidacao_admissao WHERE competencia = ?`, [comp]) || []).forEach(r => congSet.add(r.admissao)); } catch (_) {}
    const novas = admissoesDoMes(comp).filter(a => !congSet.has(a.admissao));
    if (novas.length === 0) return { ok: false, erro: existente ? 'Não há admissões novas a consolidar.' : 'Não há admissões neste mês.' };

    const lote = proximoLote(comp);
    const resp = (() => { try { return (window.Auth && Auth.usuarioAtual && Auth.usuarioAtual()) || null; } catch (_) { return null; } })();   // V615
    try {
      if (!existente) Banco.executar(`INSERT INTO consolidacao_mes (competencia, codigo, consolidado_em, responsavel) VALUES (?, ?, datetime('now'), ?)`, [comp, codigo, resp]);
      else Banco.executar(`UPDATE consolidacao_mes SET atualizado_em = datetime('now') WHERE competencia = ?`, [comp]);
      // inserts em lote (evita travar com muitas admissões)
      for (let i = 0; i < novas.length; i += 250) {
        const chunk = novas.slice(i, i + 250);
        const ph = chunk.map(() => `(?,?,?,?,?,datetime('now'))`).join(',');
        const params = [];
        chunk.forEach(a => params.push(comp, codigo, lote, a.admissao, Number(a.valor) || 0));
        Banco.executar(`INSERT INTO consolidacao_admissao (competencia, codigo, lote, admissao, valor, congelado_em) VALUES ${ph}`, params);
      }
      // V619: congela a FOTO OFICIAL do consolidado agora (1ª vez ou acréscimo) —
      // daqui em diante o mês é servido da foto, imune a mudanças de regras.
      recongelarFoto(comp);
      return { ok: true, codigo, qtd: novas.length, primeira: !existente };
    } catch (e) { console.error('[consolidacao] consolidar:', e); return { ok: false, erro: e.message || String(e) }; }
  }
  // ── V614: exporta o CONSOLIDADO FINAL (o relatório enviado ao médico) ─────
  // Detalhe completo do mês com o MESMO layout dos exports do Relatórios
  // (modelo importado, colunas e estilos) + aba RESUMO com os totais da tela.
  async function exportarConsolidado() {
    const state = st();
    const comp = state.competencia;
    if (!comp) { Utilidades.toast?.('Selecione uma competência.', 'error', 3500); return; }
    if (typeof ExcelJS === 'undefined') { Utilidades.toast?.('Biblioteca ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return; }
    const R = window.AtlasRelatorios;
    if (!R || !R.linhasCompletasComp || !R.wbDeLinhas || !R.baixarWb) {
      Utilidades.toast?.('Abra o módulo Relatórios uma vez e tente de novo.', 'error', 4500); return;
    }
    Utilidades.toast?.('Gerando o consolidado final…', 'info', 2500);
    await new Promise(r => setTimeout(r, 80));   // o toast pinta antes do trabalho pesado
    try {
      const linhas = R.linhasCompletasComp(comp) || [];
      if (!linhas.length) { Utilidades.toast?.('Não há linhas consolidadas neste mês.', 'error', 4000); return; }
      const wb = await R.wbDeLinhas(linhas, 'Consolidado');

      // aba RESUMO no visual da ferramenta (cabeçalho no azul do app + zebra)
      const codigo = codigoDoMes(comp);
      const resumo = resumoMes(comp);
      const div = repasseDividido(comp);
      const jaTem = wb.getWorksheet('RESUMO');
      if (jaTem) wb.removeWorksheet(jaTem.id);
      const ws = wb.addWorksheet('RESUMO');
      ws.columns = [{ width: 36 }, { width: 26 }];
      const azul = '16456B', claro = 'F2F8FB', borda = { style: 'thin', color: { argb: 'FFD8E4EC' } };
      const tit = ws.addRow(['CONSOLIDAÇÃO DE REPASSE', '']);
      ws.mergeCells('A1:B1');
      tit.height = 26;
      tit.getCell(1).style = { font: { bold: true, size: 14, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + azul } },
        alignment: { vertical: 'middle', horizontal: 'left', indent: 1 } };
      const agora = new Date();
      const pares = [
        ['Competência', comp],
        ['Código do repasse', codigo || '— mês ainda aberto —'],
        ['Gerado em', agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR').slice(0, 5)],
        ['Admissões do mês (QVIS)', resumo.n],
        ['Total repassado', resumo.total],
        ['Repasse do Calcular (Auditoria)', div.repQvis],
        ['Repasse dos Desempenhos', div.repDesemp],
      ];
      pares.forEach(([lbl, val], i) => {
        const row = ws.addRow([lbl, val]);
        row.getCell(1).style = { font: { bold: true, size: 11, color: { argb: 'FF14384F' } },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 ? 'FFFFFFFF' : 'FF' + claro } },
          border: { bottom: borda }, alignment: { vertical: 'middle', indent: 1 } };
        row.getCell(2).style = { font: { size: 11, color: { argb: 'FF14384F' } },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 ? 'FFFFFFFF' : 'FF' + claro } },
          border: { bottom: borda }, alignment: { vertical: 'middle' } };
        if (typeof val === 'number' && lbl !== 'Admissões do mês (QVIS)') row.getCell(2).numFmt = 'R$ #,##0.00';
      });
      await R.baixarWb(wb, `Consolidado_${(codigo || comp).replace(/[\\\/:*?"<>|]/g, '-')}`);
      Utilidades.toast?.('Consolidado final exportado.', 'success', 3500);
    } catch (e) {
      console.error('[consolidacao] exportar:', e);
      Utilidades.toast?.('Erro ao exportar: ' + (e.message || e), 'error', 4500);
    }
  }

  function reabrir(comp) {
    try {
      Banco.executar(`DELETE FROM consolidacao_admissao WHERE competencia = ?`, [comp]);
      Banco.executar(`DELETE FROM consolidacao_mes WHERE competencia = ?`, [comp]);
      // V619: mês reaberto volta a calcular AO VIVO — descarta a foto congelada
      apagarFotoConsolidado(comp);
      try { window.AtlasRelatorios && window.AtlasRelatorios.invalidarConsolidado && window.AtlasRelatorios.invalidarConsolidado(comp); } catch (_) {}
      return true;
    } catch (e) { console.error('[consolidacao] reabrir:', e); return false; }
  }

  window.AtlasConsolidacao = Object.assign(window.AtlasConsolidacao || {}, { estaConsolidado, codigoDoMes });

  // ══ V615: LINHA DO TEMPO DE CONSOLIDAÇÃO (handoff Claude Design) ══════════
  // Substitui a faixa azul estática por uma esteira de marcos — um por
  // competência do QVIS. Estado no ÍCONE (cadeado = consolidada, relógio =
  // aberta); código/valores só no hover (balão) e no clique (modal).
  const TL_ST = {
    consolidado: { label: 'Consolidado', cor: '#1d8f5f', tint: '#e7f6ee', texto: '#166b48' },
    aberta:      { label: 'Aguardando fechamento', cor: '#5b7c93', tint: '#eef4f8', texto: '#3f5e74' },
  };
  const TL_MES  = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const TL_MESL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const TL_PASSO = 74;
  function tlMesCurto(comp) { const [a, m] = String(comp).split('-'); return (TL_MES[(+m) - 1] || m) + '/' + String(a).slice(2); }
  function tlMesLongo(comp) { const [a, m] = String(comp).split('-'); return (TL_MESL[(+m) - 1] || m) + ' de ' + a; }
  function tlDataBr(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
  }
  const tlNum = (n) => (Number(n) || 0).toLocaleString('pt-BR');
  const tlR$ = (v) => v == null ? 'R$ —' : 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR');
  // um item por competência (ascendente). Valor da aberta vem da foto cmpMes
  // (barato); sem foto fica "—" — nunca roda o consolidado pesado por hover.
  function tlDados(totalCompAtual) {
    const comps = listarCompetencias().slice().sort();
    return comps.map(c => {
      const codigo = codigoDoMes(c);
      if (codigo) {
        const rc = resumoCongelado(c);
        const m = q1(`SELECT consolidado_em, responsavel FROM consolidacao_mes WHERE competencia = ?`, [c]);
        return { comp: c, st: 'consolidado', codigo, adm: rc.n, valor: rc.total,
                 quando: m.consolidado_em || null, resp: m.responsavel || null };
      }
      const r = q1(`SELECT COUNT(DISTINCT admissao) AS n FROM linhas_qvis
                    WHERE mes_pagamento = ? AND admissao IS NOT NULL AND admissao <> ''`, [c]);
      let valor = null;
      if (totalCompAtual && totalCompAtual.comp === c) valor = totalCompAtual.total;
      else {
        try { const f = (window.VGExec && window.VGExec._fotoLer) ? window.VGExec._fotoLer('cmpMes', c) : null;
              if (f) valor = Number(f.repTotal) || 0; } catch (_) {}
      }
      return { comp: c, st: 'aberta', codigo: null, adm: r.n || 0, valor, quando: null, resp: null };
    });
  }
  const TL_SVG = {
    consolidado: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1d8f5f" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2"></rect><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"></path></svg>`,
    aberta: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b7c93" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><polyline points="12 7.5 12 12 15 13.6"></polyline></svg>`,
  };
  function tlFaixaHtml(itens) {
    if (!itens.length) return '';
    const nCons = itens.filter(i => i.st === 'consolidado').length;
    let ultimoIdx = -1, primeiroIdx = -1;
    itens.forEach((i, ix) => { if (i.st === 'consolidado') { if (primeiroIdx < 0) primeiroIdx = ix; ultimoIdx = ix; } });
    const trilhoW = itens.length * TL_PASSO + 24;
    // V616: o progresso cobre só o trecho consolidado (meses abertos no início
    // da série não ficam por baixo da barra clara)
    const progLeft = primeiroIdx <= 0 ? 8 : 37 + primeiroIdx * TL_PASSO;
    const progW = ultimoIdx >= 0 ? (37 + ultimoIdx * TL_PASSO + TL_PASSO / 2 - progLeft) : 0;
    const emAberto = itens.find(i => i.st !== 'consolidado');
    const marcos = itens.map((i, ix) => `
      <div class="cons-tl-marco" style="left:${37 + ix * TL_PASSO}px" data-tl-comp="${esc(i.comp)}">
        <button type="button" class="cons-tl-pino st-${i.st}" data-tl-abrir="${esc(i.comp)}" aria-label="${esc(tlMesLongo(i.comp))}">${TL_SVG[i.st]}</button>
        <span class="cons-tl-data">${esc(tlMesCurto(i.comp))}</span>
      </div>`).join('');
    return `
      <div class="cons-tl-wrap">
        <div class="cons-tl">
          <div class="cons-tl-resumo">
            <span class="cons-tl-kicker">Consolidação</span>
            <span class="cons-tl-num">${nCons} de ${itens.length} competência${itens.length === 1 ? '' : 's'}</span>
          </div>
          <button type="button" class="cons-tl-acao" id="cons-tl-acao" ${emAberto ? `data-comp="${esc(emAberto.comp)}"` : 'disabled'}>
            ${emAberto ? 'Consolidar ' + esc(tlMesCurto(emAberto.comp)) : 'Tudo consolidado'}
          </button>
          <div class="cons-tl-esteira" id="cons-tl-esteira">
            <div class="cons-tl-trilho" style="width:${trilhoW}px">
              <div class="cons-tl-base"></div>
              ${progW ? `<div class="cons-tl-prog" style="left:${progLeft}px;width:${progW}px"></div>` : ''}
              ${marcos}
            </div>
          </div>
        </div>
        <div class="cons-tl-balao" id="cons-tl-balao" style="display:none"></div>
      </div>`;
  }
  function tlModalHtml(i) {
    if (!i) return '';
    const st = TL_ST[i.st];
    const consolidada = i.st === 'consolidado';
    const aviso = consolidada
      ? 'Competência congelada: nenhum lançamento novo entra no cálculo. Reabrir exige justificativa e fica registrado na linha do tempo.'
      : 'Competência em aberto. Lançamentos continuam entrando e o repasse só é congelado no fechamento.';
    return `
      <div class="cons-tl-bd" id="cons-tl-bd">
        <div class="cons-tl-modal">
          <div class="cons-tl-mod-head">
            <div class="cons-tl-mod-topo">
              <span class="cons-tl-chip" style="color:${st.texto};background:${st.tint}"><span class="cons-tl-chip-dot" style="background:${st.cor}"></span>${st.label}</span>
              <button type="button" class="cons-tl-x" id="cons-tl-x" aria-label="Fechar">×</button>
            </div>
            <span class="cons-tl-mod-titulo">${esc(tlMesLongo(i.comp))}</span>
            <span class="cons-tl-mod-cod">${consolidada ? 'Código ' + esc(i.codigo) : 'Código a informar no fechamento'}</span>
          </div>
          <div class="cons-tl-mod-corpo">
            <div class="cons-tl-mod-grid">
              <div class="cons-tl-mod-cardi"><span>Admissões</span><strong>${tlNum(i.adm)}</strong></div>
              <div class="cons-tl-mod-cardi"><span>Repasse apurado</span><strong>${tlR$(i.valor)}</strong></div>
              <div class="cons-tl-mod-cardi"><span>Consolidado em</span><strong>${consolidada ? tlDataBr(i.quando) : '—'}</strong></div>
              <div class="cons-tl-mod-cardi"><span>Responsável</span><strong>${esc(i.resp || '—')}</strong></div>
            </div>
            <div class="cons-tl-aviso" style="background:${st.tint};border-color:${st.cor}33">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${st.cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="8" x2="12" y2="12.5"></line><line x1="12" y1="16" x2="12" y2="16"></line></svg>
              <span>${aviso}</span>
            </div>
          </div>
          <div class="cons-tl-mod-pe">
            <button type="button" class="cons-tl-btn-pri" id="cons-tl-primaria" data-comp="${esc(i.comp)}" data-acao="${consolidada ? 'reabrir' : 'consolidar'}">
              ${consolidada ? 'Reabrir competência' : 'Consolidar agora'}
            </button>
            <button type="button" class="cons-tl-btn-sec" id="cons-tl-relatorio">Ver relatório</button>
            <span class="cons-tl-mod-nota">${consolidada ? 'Relatório disponível' : 'Prévia sujeita a alteração'}</span>
          </div>
        </div>
      </div>`;
  }
  function tlBalaoHtml(i) {
    const st = TL_ST[i.st];
    const linha2 = i.st === 'consolidado'
      ? `Congelado em ${tlDataBr(i.quando)} · ${esc(i.codigo)}`
      : 'Em aberto · valores ainda podem mudar';
    return `
      <span class="cons-tl-b-status" style="color:${st.cor}"><span style="background:${st.cor}"></span>${st.label}</span>
      <span class="cons-tl-b-titulo">${esc(tlMesLongo(i.comp))}</span>
      <div class="cons-tl-b-linhas">
        <span>${tlNum(i.adm)} ${i.adm === 1 ? 'admissão' : 'admissões'} · ${tlR$(i.valor)}</span>
        <span>${linha2}</span>
      </div>`;
  }

  // ── Estado da tela ────────────────────────────────────────────────────────
  function st() {
    if (!window.__cons) window.__cons = { competencia: competenciaPadrao(), codigoInput: '', busca: '', buscaRes: null };
    if (!window.__cons.competencia) window.__cons.competencia = competenciaPadrao();
    return window.__cons;
  }

  App.telas['consolidacao'] = function () {
    garantirSchema();
    const state = st();
    const comp = state.competencia;
    const comps = listarCompetencias();
    const codigo = comp ? codigoDoMes(comp) : null;
    const consolidado = !!codigo;
    const pend = comp ? pendentesGer(comp) : 0;
    const resumo = comp ? resumoMes(comp) : { n: 0, total: 0 };
    const cong = consolidado ? resumoCongelado(comp) : { n: 0, total: 0 };
    const acr = consolidado ? resumoAcrescimos(comp) : { n: 0, total: 0 };
    const div = comp ? repasseDividido(comp) : { repQvis: 0, repDesemp: 0 };   // V614
    const tlItens = tlDados(comp ? { comp, total: resumo.total } : null);      // V615
    const tlSelItem = state.tlSel ? tlItens.find(i => i.comp === state.tlSel) : null;
    const br = state.buscaRes;

    const html = `
      <div class="page-content cons-page">
        <header class="page-header">
          <div>
            <h2>Consolidação</h2>
            <div class="subtitle">Fecha o repasse do mês sob um código. Congela as admissões pagas; admissão nova vira acréscimo.</div>
          </div>
          <div style="display:flex; gap:9px; align-items:center">
            <button class="cons-atualizar" id="cons-atualizar" title="Recarregar">↻</button>
            <label class="cons-comp-lbl">Competência</label>
            <select id="cons-comp" class="cons-in cons-comp">
              ${comps.length === 0 ? `<option value="">— sem dados —</option>` :
                comps.map(c => `<option value="${esc(c)}" ${c === comp ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
          </div>
        </header>

        <!-- V614: extração do consolidado final (relatório enviado ao médico) —
             fora do header pra ficar SEMPRE visível (o hub absorve botões de header) -->
        <div class="cons-topo-acoes">
          <button class="cons-exportar" id="cons-exportar" ${!comp ? 'disabled' : ''} title="Exportar o consolidado final em Excel">
            <i class="ti ti-download"></i> Exportar consolidado
          </button>
        </div>

        <!-- V615: linha do tempo de consolidação (handoff Claude Design) — um
             marco por competência; status no ícone, detalhes no hover/clique -->
        ${tlFaixaHtml(tlItens)}
        ${!consolidado && pend > 0 ? `
          <div class="cons-gate">
            <i class="ti ti-alert-triangle"></i>
            <div><strong>${pend} ajuste(s) pendente(s) no Gerenciais.</strong> Trate todos antes de consolidar este mês.</div>
          </div>` : ''}

        <!-- V614: sem o card de acréscimos/situação — entram o repasse do
             Calcular (matriz da Auditoria) e o repasse dos Desempenhos -->
        <div class="stats-grid">
          <div class="stat-card"><div class="label">Admissões do mês</div><div class="value">${resumo.n}</div><div class="meta">no QVIS</div></div>
          <div class="stat-card"><div class="label">Total repassado</div><div class="value">R$ ${fmt(resumo.total)}</div></div>
          <div class="stat-card"><div class="label">Repasse do Calcular</div><div class="value">R$ ${fmt(div.repQvis)}</div><div class="meta">cálculo salvo · conferido na Auditoria</div></div>
          <div class="stat-card"><div class="label">Repasse dos Desempenhos</div><div class="value">R$ ${fmt(div.repDesemp)}</div><div class="meta">módulos de desempenho</div></div>
        </div>

        ${!consolidado ? `
          <div class="card cons-acao-card">
            <div class="cons-acao-head">
              <span class="cons-eyebrow">Fechar o mês</span>
              <h3 class="cons-titulo">Consolidar repasse</h3>
              <p class="cons-desc">Informe o código do repasse. As <strong>${resumo.n}</strong> admissão(ões) do mês serão congeladas sob o código — protegidas contra alteração.</p>
            </div>
            <div class="cons-acao-row">
              <div class="cons-field">
                <label>Código do repasse</label>
                <input id="cons-codigo" class="cons-in" placeholder="ex: REP-${esc(comp || '')}" autocomplete="off" value="${esc(state.codigoInput)}" ${pend > 0 ? 'disabled' : ''}>
              </div>
              <button class="btn btn-primary cons-btn" id="cons-consolidar" ${(pend > 0 || resumo.n === 0) ? 'disabled' : ''}>
                <i class="ti ti-lock"></i> Consolidar ${resumo.n} admissão(ões)
              </button>
            </div>
            ${pend > 0 ? `<div class="cons-bloqueio">Bloqueado: trate os ${pend} pendente(s) no Gerenciais primeiro.</div>` : ''}
            ${resumo.n === 0 ? `<div class="cons-bloqueio">Não há admissões no QVIS deste mês.</div>` : ''}
          </div>
        ` : (acr.n ? `
          <div class="card cons-acao-card cons-acao-acr">
            <div class="cons-acao-head">
              <span class="cons-eyebrow">Novidades do mês</span>
              <h3 class="cons-titulo">${acr.n} acréscimo(s) a consolidar</h3>
              <p class="cons-desc">Admissões novas surgiram após a consolidação (R$ ${fmt(acr.total)}). Consolide-as sob o mesmo código <strong>${esc(codigo)}</strong>.</p>
            </div>
            <div class="cons-acao-row">
              <button class="btn btn-primary cons-btn" id="cons-acrescimos" ${pend > 0 ? 'disabled' : ''}>
                <i class="ti ti-plus"></i> Consolidar ${acr.n} acréscimo(s) sob ${esc(codigo)}
              </button>
            </div>
            ${pend > 0 ? `<div class="cons-bloqueio">Trate os ${pend} pendente(s) no Gerenciais antes.</div>` : ''}
          </div>
        ` : `
          <div class="cons-ok"><i class="ti ti-circle-check"></i> Tudo consolidado. Nenhum acréscimo novo neste mês.</div>
        `)}

        <div class="card cons-busca-card">
          <div class="cons-acao-head">
            <span class="cons-eyebrow">Consultar</span>
            <h3 class="cons-titulo">Buscar admissão</h3>
            <p class="cons-desc">Veja o repasse de uma admissão específica e se ela já está consolidada.</p>
          </div>
          <div class="cons-acao-row">
            <div class="cons-field">
              <label>Código da admissão</label>
              <input id="cons-busca" class="cons-in" placeholder="cód. admissão" autocomplete="off" value="${esc(state.busca)}">
            </div>
            <button class="btn cons-btn" id="cons-busca-btn"><i class="ti ti-search"></i> Buscar</button>
          </div>
          ${br ? (br.achou ? `
            <div class="cons-resultado">
              <div class="cons-res-linha"><span class="cons-res-lbl">Admissão</span><strong>${esc(br.admissao)}</strong></div>
              <div class="cons-res-linha"><span class="cons-res-lbl">Repassado</span><strong>R$ ${fmt(br.valor)}</strong> <span class="cons-muted">(${br.linhas} linha[s] no QVIS)</span></div>
              <div class="cons-res-linha"><span class="cons-res-lbl">Status</span>${br.congelada
                ? `<span class="cons-stag" style="background:#0A7A5A">CONGELADA · ${esc(br.codigo)}</span>`
                : `<span class="cons-stag" style="background:#B8864A">NÃO CONSOLIDADA</span>`}</div>
            </div>` : `
            <div class="cons-resultado cons-res-vazio">Nenhuma admissão "<strong>${esc(br.termo)}</strong>" no QVIS deste mês.</div>`) : ''}
        </div>
      </div>
      ${tlModalHtml(tlSelItem)}
      ${estilo()}`;

    const root = document.getElementById('conteudo');
    if (root) root.innerHTML = html;
    bind();
    bindLinhaTempo(tlItens);   // V615
  };

  function bind() {
    const state = st();
    const comp = state.competencia;
    const $ = (id) => document.getElementById(id);

    const selComp = $('cons-comp');
    if (selComp) selComp.addEventListener('change', () => { state.competencia = selComp.value; state.codigoInput = ''; state.busca = ''; state.buscaRes = null; App.telas['consolidacao'](); });
    const btnAtu = $('cons-atualizar');
    if (btnAtu) btnAtu.addEventListener('click', () => { state.buscaRes = null; App.telas['consolidacao'](); });

    const btnExp = $('cons-exportar');   // V614
    if (btnExp) btnExp.addEventListener('click', () => { exportarConsolidado(); });

    const inCod = $('cons-codigo');
    if (inCod) inCod.addEventListener('input', () => { state.codigoInput = inCod.value; });

    const btnCons = $('cons-consolidar');
    if (btnCons) btnCons.addEventListener('click', () => {
      const r = consolidar(comp, state.codigoInput);
      if (r.ok) { Banco.salvar({ imediato: true }); state.codigoInput = '';
        try { window.AtlasProducaoMedica?.snapshotContabil(comp); } catch (e) { console.error('[consolidacao] snapshot contábil', e); }   // V271: congela o Contábil do mês
        Utilidades.toast?.(`Repasse consolidado sob ${r.codigo} — ${r.qtd} admissão(ões) congelada(s).`, 'success', 4000);
        App.telas['consolidacao'](); }
      else Utilidades.toast?.(r.erro, 'error', 4500);
    });

    const btnAcr = $('cons-acrescimos');
    if (btnAcr) btnAcr.addEventListener('click', () => {
      const r = consolidar(comp, null);
      if (r.ok) { Banco.salvar({ imediato: true });
        try { window.AtlasProducaoMedica?.snapshotContabil(comp); } catch (e) { console.error('[consolidacao] snapshot contábil (acréscimos)', e); }   // V271: re-congela com os acréscimos
        Utilidades.toast?.(`${r.qtd} acréscimo(s) consolidado(s) sob ${r.codigo}.`, 'success', 4000);
        App.telas['consolidacao'](); }
      else Utilidades.toast?.(r.erro, 'error', 4500);
    });

    // (V615: o "Reabrir" saiu do selo — agora vive no modal da linha do tempo,
    //  com justificativa obrigatória; ver bindLinhaTempo)

    const inBusca = $('cons-busca');
    if (inBusca) inBusca.addEventListener('input', () => { state.busca = inBusca.value; });
    const fazerBusca = () => { state.buscaRes = buscarAdmissao(comp, state.busca); App.telas['consolidacao'](); };
    const btnBusca = $('cons-busca-btn');
    if (btnBusca) btnBusca.addEventListener('click', fazerBusca);
    if (inBusca) inBusca.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fazerBusca(); } });
  }

  // ── V615: interações da linha do tempo ────────────────────────────────────
  function tlFocarCodigo(compAlvo) {
    const state = st();
    state.competencia = compAlvo; state.tlSel = null;
    state.codigoInput = ''; state.busca = ''; state.buscaRes = null;
    App.telas['consolidacao']();
    setTimeout(() => {
      const inp = document.getElementById('cons-codigo');
      if (inp) { inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); inp.focus(); }
    }, 60);
  }
  async function tlReabrir(compAlvo) {
    const codigoAntigo = codigoDoMes(compAlvo);
    const just = prompt(`Reabrir ${tlMesLongo(compAlvo)}? As admissões congeladas serão liberadas e o código ${codigoAntigo || ''} removido.\n\nJustificativa (obrigatória):`);
    if (just === null) return;                       // cancelou
    if (!String(just).trim()) { Utilidades.toast?.('A reabertura exige justificativa.', 'error', 4000); return; }
    if (!reabrir(compAlvo)) { Utilidades.toast?.('Erro ao reabrir.', 'error', 3500); return; }
    try { window.AtlasProducaoMedica?.removerSnapContabil(compAlvo); } catch (_) {}   // V271: descongela o Contábil
    // registra a reabertura na Linha do Tempo da Visão Geral (rastreabilidade)
    let salvou = false;
    try {
      if (window.AtlasLinhaTempo && typeof window.AtlasLinhaTempo.criar === 'function') {
        const resp = (() => { try { return (window.Auth && Auth.usuarioAtual && Auth.usuarioAtual()) || null; } catch (_) { return null; } })();
        await window.AtlasLinhaTempo.criar({
          data: new Date().toISOString().slice(0, 10), categoria: 'auditoria', sinal: 'neutro',
          titulo: `Consolidação reaberta — ${tlMesLongo(compAlvo)}`,
          descricao: `Código ${codigoAntigo || '—'} removido. Justificativa: ${String(just).trim()}`,
          responsavel: resp,
        });
        salvou = true;   // criar() já persistiu o banco
      }
    } catch (e) { console.warn('[consolidacao] evento de reabertura:', e); }
    if (!salvou) Banco.salvar({ imediato: true });
    const state = st();
    state.tlSel = null;
    Utilidades.toast?.(`Consolidação de ${tlMesLongo(compAlvo)} reaberta.`, 'info', 3500);
    App.telas['consolidacao']();
  }
  function bindLinhaTempo(itens) {
    const state = st();
    const $ = (id) => document.getElementById(id);

    // botão de ação da faixa → seleciona a 1ª competência aberta e foca o código
    const btnAcao = $('cons-tl-acao');
    if (btnAcao && !btnAcao.disabled) btnAcao.addEventListener('click', () => tlFocarCodigo(btnAcao.dataset.comp));

    // marcos: clique abre o modal
    document.querySelectorAll('[data-tl-abrir]').forEach(b => b.addEventListener('click', () => {
      state.tlSel = b.dataset.tlAbrir; App.telas['consolidacao']();
    }));

    // V690: a esteira rola na HORIZONTAL — abre na competência mais recente e
    // a roda do mouse rola a esteira (não a página)
    const est = $('cons-tl-esteira');
    if (est) {
      if (state.tlScroll != null) est.scrollLeft = state.tlScroll;
      else est.scrollLeft = est.scrollWidth;
      est.addEventListener('scroll', () => { state.tlScroll = est.scrollLeft; });
      est.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { est.scrollLeft += e.deltaY; e.preventDefault(); }
      }, { passive: false });
    }

    // balão de hover — FORA da esteira (overflow-x:auto clipa overflow-y), com
    // atraso de ~120ms pra não piscar varrendo a régua
    const wrap = document.querySelector('.cons-tl-wrap');
    const balao = $('cons-tl-balao');
    const esteira = $('cons-tl-esteira');
    if (wrap && balao) {
      let timer = null;
      const esconder = () => { clearTimeout(timer); timer = null; balao.style.display = 'none'; };
      document.querySelectorAll('.cons-tl-marco').forEach(m => {
        m.addEventListener('mouseenter', () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            const item = itens.find(i => i.comp === m.dataset.tlComp);
            if (!item) return;
            balao.innerHTML = tlBalaoHtml(item);
            const wr = wrap.getBoundingClientRect();
            const mr = m.getBoundingClientRect();
            const centro = mr.left + mr.width / 2 - wr.left;
            balao.style.display = 'flex';
            const bw = balao.offsetWidth || 246;   // V616: largura real (valores longos não quebram mais)
            balao.style.left = Math.max(8, Math.min(centro - bw / 2, wr.width - bw - 8)) + 'px';
          }, 120);
        });
        m.addEventListener('mouseleave', esconder);
      });
      if (esteira) esteira.addEventListener('scroll', esconder, { passive: true });
    }

    // modal
    const bd = $('cons-tl-bd');
    if (bd) {
      const fechar = () => { state.tlSel = null; App.telas['consolidacao'](); };
      bd.addEventListener('click', (e) => { if (e.target === bd) fechar(); });
      const x = $('cons-tl-x');
      if (x) x.addEventListener('click', fechar);
      const rel = $('cons-tl-relatorio');
      if (rel) rel.addEventListener('click', () => { state.tlSel = null; App.navegarPara('relatorios'); });
      const pri = $('cons-tl-primaria');
      if (pri) pri.addEventListener('click', () => {
        const c = pri.dataset.comp;
        if (pri.dataset.acao === 'reabrir') tlReabrir(c);
        else tlFocarCodigo(c);
      });
    }
    // Esc fecha o modal (um único handler global, re-registrado por render)
    if (window.__consEscHandler) document.removeEventListener('keydown', window.__consEscHandler);
    window.__consEscHandler = (e) => {
      if (e.key === 'Escape' && st().tlSel && document.getElementById('cons-tl-bd')) {
        st().tlSel = null; App.telas['consolidacao']();
      }
    };
    document.addEventListener('keydown', window.__consEscHandler);
  }

  function estilo() {
    return `<style>
      .cons-in { width:100%; height:38px; padding:0 11px; border:1px solid var(--border); border-radius:var(--radius-md);
        font-family:inherit; font-size:13px; background:var(--bg-elevated); color:var(--ink); transition:border-color var(--t-fast), box-shadow var(--t-fast); }
      .cons-in:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-soft); }
      select.cons-in { cursor:pointer; appearance:none;
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2356645E' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
        background-repeat:no-repeat; background-position:right 11px center; padding-right:28px; }
      /* V616: valores grandes (R$ em milhões) NÃO quebram linha — nowrap + tamanho fluido */
      .cons-page .stat-card .value { font-family:var(--font-body); font-weight:700; letter-spacing:normal;
        white-space:nowrap; font-variant-numeric:tabular-nums; font-size:clamp(16px, 1.5vw, 26px); }
      .cons-comp-lbl { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.07em; color:var(--ink-faint); }
      .cons-comp { width:auto; min-width:120px; }
      .cons-atualizar { width:38px; height:38px; border:1px solid var(--border); background:var(--bg-elevated); color:var(--ink-soft);
        border-radius:var(--radius-md); font-size:16px; cursor:pointer; transition:background var(--t-fast); }
      .cons-atualizar:hover { background:var(--bg-sunken); }
      /* V614: botão de exportar o consolidado final */
      .cons-topo-acoes { display:flex; justify-content:flex-end; margin:-6px 0 var(--space-4); }
      .cons-exportar { height:38px; padding:0 16px; border:none; border-radius:var(--radius-md); cursor:pointer;
        background:var(--primary); color:#fff; font-family:inherit; font-size:12.5px; font-weight:700;
        display:inline-flex; align-items:center; gap:7px; white-space:nowrap; transition:opacity var(--t-fast); }
      .cons-exportar:hover:not(:disabled) { opacity:0.9; }
      .cons-exportar:disabled { opacity:0.45; cursor:not-allowed; }

      /* ── V615: linha do tempo de consolidação (handoff Claude Design) ── */
      /* V616: z-index no wrap — o balão de hover precisa SOBREPOR os cards abaixo */
      .cons-tl-wrap { position:relative; margin-bottom:var(--space-4); z-index:40; }
      /* V690: altura flexível — o conteúdo da esteira (pino + mês + scrollbar
         horizontal) não cabia nos 54px fixos e nascia um SCROLL VERTICAL */
      .cons-tl { background:linear-gradient(90deg, #102d4b 0%, #143352 34%, #1d4470 68%, #2a5a8c 100%);
        border-radius:12px; padding:10px 16px 8px; min-height:54px; box-sizing:border-box;
        display:flex; align-items:center; gap:16px;
        box-shadow:0 1px 2px rgba(20, 51, 82,.05), 0 12px 28px -22px rgba(16, 45, 75,.5); }
      .cons-tl-resumo { display:flex; flex-direction:column; gap:1px; flex-shrink:0; padding-right:16px; border-right:1px solid rgba(255,255,255,.28); }
      .cons-tl-kicker { font-size:9.5px; font-weight:700; letter-spacing:0.13em; text-transform:uppercase; color:#e2f6fd; white-space:nowrap; }
      .cons-tl-num { font-size:13.5px; font-weight:700; color:#fff; white-space:nowrap; font-variant-numeric:tabular-nums; }
      .cons-tl-acao { flex-shrink:0; font-family:inherit; font-size:12px; font-weight:700; color:#143352; background:#fff;
        border:none; border-radius:8px; padding:8px 13px; cursor:pointer; white-space:nowrap; box-shadow:0 2px 6px rgba(11, 35, 64,.2); }
      .cons-tl-acao:hover:not(:disabled) { background:#eaf7fc; }
      .cons-tl-acao:disabled { opacity:0.65; cursor:default; }
      /* V616: a esteira começa no lado ESQUERDO (igual à linha do tempo da
         Visão Geral) — sem o truque rtl; o trilho estica até preencher a faixa */
      /* V690: scroll SÓ horizontal — overflow-y era "auto" implícito e o
         conteúdo (49px) + scrollbar (8px) estouravam os 48px → barra VERTICAL */
      .cons-tl-esteira { flex:1; min-width:0; overflow-x:auto; overflow-y:hidden; height:62px; }
      .cons-tl-esteira::-webkit-scrollbar { height:8px; }
      .cons-tl-esteira::-webkit-scrollbar-track { background:rgba(255,255,255,.14); border-radius:4px; }
      .cons-tl-esteira::-webkit-scrollbar-thumb { background:rgba(255,255,255,.42); border-radius:4px; }
      .cons-tl-trilho { position:relative; height:32px; min-width:100%; }
      .cons-tl-base { position:absolute; left:8px; right:8px; top:15px; height:4px; border-radius:2px; background:rgba(255,255,255,.22); }
      .cons-tl-prog { position:absolute; left:8px; top:15px; height:4px; border-radius:2px; background:rgba(255,255,255,.85); }
      .cons-tl-marco { position:absolute; top:4px; display:flex; flex-direction:column; align-items:center; transform:translateX(-50%); }
      .cons-tl-pino { width:24px; height:24px; border-radius:7px; padding:0; cursor:pointer; display:flex; align-items:center; justify-content:center;
        background:#fff; box-shadow:0 3px 7px rgba(11, 35, 64,.3); position:relative; z-index:2; transition:transform var(--t-fast); }
      .cons-tl-pino:hover { transform:scale(1.16); }
      .cons-tl-pino.st-consolidado { border:1.5px solid #fff; }
      .cons-tl-pino.st-aberta { border:1.5px solid #5b7c93; }
      .cons-tl-data { margin-top:7px; font-size:11px; font-weight:700; white-space:nowrap; color:#fff; }
      .cons-tl-balao { position:absolute; top:60px; z-index:9; width:max-content; min-width:246px; max-width:340px; box-sizing:border-box; flex-direction:column; gap:7px;
        background:#fff; border-radius:10px; padding:11px 13px; box-shadow:0 8px 22px rgba(11, 35, 64,.34); pointer-events:none; }
      .cons-tl-b-status { display:flex; align-items:center; gap:7px; font-size:9.5px; font-weight:700; letter-spacing:0.09em; text-transform:uppercase; white-space:nowrap; }
      .cons-tl-b-status > span { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
      .cons-tl-b-titulo { font-size:13px; font-weight:700; color:#12304f; white-space:nowrap; }
      .cons-tl-b-linhas { display:flex; flex-direction:column; gap:3px; }
      .cons-tl-b-linhas span { font-size:11.5px; color:#5a6879; white-space:nowrap; font-variant-numeric:tabular-nums; }
      .cons-tl-bd { position:fixed; inset:0; background:rgba(11, 35, 64,.5); z-index:100050; display:flex; align-items:flex-start; justify-content:center; padding:64px 24px; }
      .cons-tl-modal { width:520px; max-width:96vw; background:#fff; border-radius:16px; box-shadow:0 24px 60px -20px rgba(11, 35, 64,.45); display:flex; flex-direction:column; }
      .cons-tl-mod-head { padding:20px 24px 16px; border-bottom:1px solid #f0f4f8; display:flex; flex-direction:column; gap:10px; }
      .cons-tl-mod-topo { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
      .cons-tl-chip { display:flex; align-items:center; gap:7px; font-size:11.5px; font-weight:700; border-radius:999px; padding:5px 11px; }
      .cons-tl-chip-dot { width:8px; height:8px; border-radius:50%; }
      .cons-tl-x { width:30px; height:30px; border-radius:8px; border:none; background:#f0f4f8; color:#5a6879; font-size:17px; line-height:1; cursor:pointer; }
      .cons-tl-x:hover { background:#e5edf3; color:#12304f; }
      .cons-tl-mod-titulo { font-size:20px; font-weight:700; color:#12304f; letter-spacing:-0.01em; }
      .cons-tl-mod-cod { font-size:13px; color:#5a6879; }
      .cons-tl-mod-corpo { padding:18px 24px; display:flex; flex-direction:column; gap:16px; }
      .cons-tl-mod-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      .cons-tl-mod-cardi { background:#f6f4ef; border:1px solid #e8eff5; border-radius:10px; padding:11px 13px; display:flex; flex-direction:column; gap:2px; }
      .cons-tl-mod-cardi span { font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#96a2b1; }
      .cons-tl-mod-cardi strong { font-size:15px; font-weight:700; color:#12304f; }
      .cons-tl-aviso { display:flex; align-items:flex-start; gap:9px; border:1px solid; border-radius:10px; padding:11px 13px; }
      .cons-tl-aviso svg { flex-shrink:0; margin-top:1px; }
      .cons-tl-aviso span { font-size:12.5px; line-height:1.5; color:#5a6879; }
      .cons-tl-mod-pe { padding:14px 24px; border-top:1px solid #f0f4f8; display:flex; align-items:center; gap:9px; }
      .cons-tl-btn-pri { font-family:inherit; font-size:12.5px; font-weight:700; color:#fff; background:#1d4470; border:none; border-radius:9px; padding:11px 18px; cursor:pointer; }
      .cons-tl-btn-pri:hover { background:#143352; }
      .cons-tl-btn-sec { font-family:inherit; font-size:12.5px; font-weight:700; color:#5a6879; background:transparent; border:1px solid #dfe4ea; border-radius:9px; padding:10px 16px; cursor:pointer; }
      .cons-tl-btn-sec:hover { border-color:#c5d5e5; color:#12304f; }
      .cons-tl-mod-nota { margin-left:auto; font-size:11.5px; color:#96a2b1; }
      .cons-tl-pino:focus-visible, .cons-tl-acao:focus-visible { outline:2px solid #2a5a8c; outline-offset:2px; }

      .cons-gate { display:flex; gap:12px; align-items:center; padding:13px 16px; margin-bottom:var(--space-4); border-radius:var(--radius-lg);
        background:var(--warning-soft); border:1px solid #E6CFA0; color:#7A5B22; font-size:13px; }
      .cons-gate i { font-size:20px; flex-shrink:0; }
      .cons-ok { display:flex; gap:9px; align-items:center; padding:14px 16px; margin-bottom:var(--space-4); border-radius:var(--radius-lg);
        background:var(--success-soft); border:1px solid #BFE3D2; color:var(--success); font-size:13px; }

      .cons-card-acr { border-color:#E6CFA0; background:var(--warning-soft); }
      .cons-card-acr .value { color:#7A5B22; }
      .cons-sit { font-family:var(--font-display); }
      .cons-sit.ok { color:var(--success); }

      .cons-acao-card { margin-bottom:var(--space-4); }
      .cons-acao-acr { border-left:3px solid var(--warning); }
      .cons-acao-head { margin-bottom:var(--space-4); }
      .cons-eyebrow { display:block; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:var(--accent); margin-bottom:3px; }
      .cons-titulo { margin:0 0 5px; font-family:var(--font-display); font-size:19px; font-weight:600; letter-spacing:-0.01em; color:var(--ink); }
      .cons-desc { margin:0; font-size:13px; color:var(--ink-soft); max-width:64ch; }
      .cons-acao-row { display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; }
      .cons-field { display:flex; flex-direction:column; gap:6px; min-width:240px; }
      .cons-field label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--ink-faint); }
      .cons-btn { white-space:nowrap; }
      .cons-btn:disabled { opacity:0.5; cursor:not-allowed; }
      .cons-bloqueio { margin-top:10px; font-size:12px; color:var(--danger); }

      .cons-busca-card { margin-bottom:var(--space-4); }
      .cons-resultado { margin-top:var(--space-4); padding:14px 16px; border-radius:var(--radius-md); background:var(--bg-sunken); display:flex; flex-direction:column; gap:8px; }
      .cons-res-linha { display:flex; align-items:center; gap:10px; font-size:13px; }
      .cons-res-lbl { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--ink-faint); min-width:90px; }
      .cons-res-vazio { color:var(--ink-soft); font-size:13px; }
      .cons-stag { display:inline-block; padding:3px 9px; border-radius:5px; font-size:10px; font-weight:700; letter-spacing:0.04em; color:#fff; }
      .cons-muted { color:var(--ink-faint); }
    </style>`;
  }
})();
