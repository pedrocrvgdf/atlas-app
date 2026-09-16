/**
 * ATLAS — Diagnóstico de desempenho (V592)
 * Cronômetro leve, sempre ligado, nas funções PESADAS da ferramenta. Guarda
 * só TEMPOS (nenhum dado de paciente/valor): agregado por função + as últimas
 * execuções individuais (com a competência e a hora). O relatório aparece na
 * tela Sistema › Backup e pode ser copiado para enviar ao suporte.
 *
 * Overhead: ~0 (um performance.now() antes/depois de chamadas que já são
 * caras). Funções registradas depois do boot (ex.: motor de glosa) são
 * capturadas pelas re-tentativas de instalação nos 2 primeiros minutos.
 *
 * API (window.AtlasDiagPerf): agregado(), ultimas(), relatorioTexto(), limpar()
 */
(function () {
  'use strict';

  const MAX_REG = 400;
  const REG = [];          // { rot, alvo, ms, quando }
  const AGG = {};          // rot → { n, ms, max }
  const t0Boot = performance.now();

  function registrar(rot, alvo, ms) {
    const a = (AGG[rot] = AGG[rot] || { n: 0, ms: 0, max: 0 });
    a.n++; a.ms += ms; if (ms > a.max) a.max = ms;
    REG.push({
      rot,
      alvo: (alvo == null || typeof alvo === 'object' || typeof alvo === 'function') ? '' : String(alvo).slice(0, 24),   // V698: objeto não vira "[object Object]"
      ms: Math.round(ms),
      quando: new Date().toLocaleTimeString('pt-BR'),
      t: performance.now(),   // V605: a sentinela cruza com o instante da travada
    });
    if (REG.length > MAX_REG) REG.shift();
  }

  // ── V605: SENTINELA DE TRAVAMENTOS ────────────────────────────────────
  // Batimento a cada 500ms: se a tela ficou presa por >2,5s (aba VISÍVEL),
  // registra hora, duração, tela ativa e o contexto (salvamento do banco /
  // última função pesada). Fica no localStorage — sobrevive até a fechamento
  // brusco da aba — e aparece no Diagnóstico e no relatório copiado.
  const TRAVA_LIMIAR = 2500;
  function travadas() {
    try { return JSON.parse(localStorage.getItem('atlas_travadas') || '[]'); } catch (_) { return []; }
  }
  function limparTravadas() { try { localStorage.removeItem('atlas_travadas'); } catch (_) {} }
  function _gravarTravada(t) {
    try {
      const arr = travadas(); arr.push(t);
      while (arr.length > 60) arr.shift();
      localStorage.setItem('atlas_travadas', JSON.stringify(arr));
    } catch (_) {}
  }
  let _ultimoTick = performance.now();
  let _ultimaVisib = -1e9;
  document.addEventListener('visibilitychange', () => { _ultimaVisib = performance.now(); });
  setInterval(() => {
    const agora = performance.now();
    const gap = agora - _ultimoTick;
    _ultimoTick = agora;
    if (gap < TRAVA_LIMIAR + 500) return;                    // batimento normal
    if (document.hidden) return;                             // aba em 2º plano
    if (agora - _ultimaVisib < gap + 1500) return;           // acabou de voltar do 2º plano (timer represado, não é travada)
    const ctx = [];
    try { if (window.App && App.telaAtual) ctx.push('tela: ' + App.telaAtual); } catch (_) {}
    try {
      if (window.Banco && Banco._ultimoExportFim && (agora - Banco._ultimoExportFim) < gap + 1500) {
        ctx.push('salvamento do banco (export' + (Banco._ultimoExportTam ? ' de ' + (Banco._ultimoExportTam / 1048576).toFixed(0) + ' MB' : '') + ')');
      }
    } catch (_) {}
    const ult = REG[REG.length - 1];
    if (ult && ult.t >= agora - gap - 1500) {
      ctx.push('função: ' + ult.rot + (ult.alvo ? ' (' + ult.alvo + ')' : '') + ' · ' + (ult.ms / 1000).toFixed(1).replace('.', ',') + 's');
    }
    _gravarTravada({
      quando: new Date().toLocaleString('pt-BR'),
      ms: Math.round(gap),
      ctx: ctx.join(' · ') || 'sem contexto identificado',
    });
  }, 500);

  function embrulhar(obj, nome, rot) {
    try {
      if (!obj || typeof obj[nome] !== 'function' || obj[nome].__diag) return;
      const f = obj[nome];
      const w = function (...a) {
        const ini = performance.now();
        const r = f.apply(this, a);
        if (r && typeof r.then === 'function') {
          return r.then((v) => { registrar(rot, a[0], performance.now() - ini); return v; },
                        (e) => { registrar(rot, a[0], performance.now() - ini); throw e; });
        }
        registrar(rot, a[0], performance.now() - ini);
        return r;
      };
      w.__diag = true;
      obj[nome] = w;
    } catch (_) {}
  }

  function instalar() {
    embrulhar(window.AtlasAuditoria, 'matrizDaCompetencia', 'Auditoria — matriz da competência');
    embrulhar(window.AtlasRelatorios, 'linhasConsolidadoComp', 'Relatórios — consolidado do mês');
    embrulhar(window.AtlasProducaoMedica, 'consolidacaoContabilPartes', 'Prod. Médica — consolidação contábil');
    embrulhar(window, '__atlasCalcularPerdaGlosa', 'Motor — perda de glosa');
    embrulhar(window.Banco, 'salvar', 'Banco — salvar (export + IndexedDB)');
    embrulhar(window.Banco, '_flushSalvar', 'Banco — salvar (export + IndexedDB)');
  }
  // instala já e re-tenta (motor de glosa/telas registram depois do boot)
  instalar();
  const iv = setInterval(instalar, 3000);
  setTimeout(() => clearInterval(iv), 120000);

  function agregado() {
    return Object.entries(AGG)
      .map(([rot, a]) => ({ rot, chamadas: a.n, totalMs: Math.round(a.ms), maxMs: Math.round(a.max) }))
      .sort((x, y) => y.totalMs - x.totalMs);
  }
  function ultimas(n) {
    return REG.slice(-(n || 40)).reverse();
  }
  function relatorioTexto() {
    const fmtS = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + 's';
    const L = [];
    L.push('DIAGNÓSTICO DE DESEMPENHO — Repasse Médico');
    L.push(`Gerado em: ${new Date().toLocaleString('pt-BR')} · sessão aberta há ${fmtS(performance.now() - t0Boot)}`);
    try {
      const nq = Banco.queryUnica(`SELECT COUNT(*) AS n FROM linhas_qvis`).n;
      const np = Banco.queryUnica(`SELECT COUNT(*) AS n FROM linhas_producao`).n;
      const nf = Banco.queryUnica(`SELECT COUNT(*) AS n FROM vg_calc_cache`).n;
      L.push(`Base: ${nq} linhas QVIS · ${np} linhas Produção · ${nf} fotos de cálculo`);
    } catch (_) {}
    // V602: RAIO-X do peso do banco — cada salvamento exporta o banco inteiro,
    // então o tamanho dele define o custo do "Banco — salvar"
    try {
      const mb = (n) => (Number(n || 0) / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
      const q1 = (sql) => { try { const r = Banco.queryUnica(sql); return r ? Number(Object.values(r)[0]) || 0 : 0; } catch (_) { return 0; } };
      if (Banco._ultimoExportTam) L.push(`Banco exportado no último salvamento: ${mb(Banco._ultimoExportTam)}`);
      // V659: FASES do último salvamento — separa o que TRAVA a tela (export
      // síncrono) do que roda em 2º plano (arquivo vinculado + IndexedDB).
      const fs2 = Banco._fasesUltimoSalvar;
      if (fs2 && fs2.export != null) {
        const f = (ms) => (Number(ms || 0) / 1000).toFixed(1).replace('.', ',') + 's';
        L.push(`Fases do último salvamento: export ${f(fs2.export)} (trava a tela)` +
               (fs2.arquivo > 50 ? ` · arquivo vinculado ${f(fs2.arquivo)}${fs2.caminho === 'worker' ? ' em 2º plano (no worker — V686)' : ''}` : '') +
               ` · IndexedDB ${f(fs2.idbAguardo)} em 2º plano` +
               (fs2.idbTx != null ? ` (transação ${f(fs2.idbTx)})` : '') +
               (fs2.fatiasTotal != null
                 ? ` · fatias gravadas ${fs2.fatias}/${fs2.fatiasTotal} (${mb(fs2.bytesGravados)} — V820: só o que mudou)` : '') +
               ` · via ${fs2.caminho || '?'}`);
      }
      if (Banco._ultimoExportDurMs > 2000) {
        const jan = Math.min(Math.max(4 * Banco._ultimoExportDurMs, 2000), 60000);
        L.push(`Coalescing ativo: salvamentos comuns aguardam até ${(jan / 1000).toFixed(0)}s entre exports (ações críticas furam a janela).`);
      }
      L.push('Peso por área (conteúdo):');
      L.push(`  Cálculos salvos (snapshots): ${mb(q1(`SELECT COALESCE(SUM(LENGTH(resultado_json)),0) FROM repasse_snapshot`))} em ${q1(`SELECT COUNT(*) FROM repasse_snapshot`)} meses`);
      const snapTodas = q1(`SELECT COALESCE(SUM(LENGTH(resultado_json)),0) FROM repasse_snapshot WHERE UPPER(competencia)='TODAS'`);
      if (snapTodas > 0) L.push(`    (inclui um cálculo "TODAS" de ${mb(snapTodas)} — candidato a apagar no Calcular)`);
      L.push(`  Documentos da linha do tempo: ${mb(q1(`SELECT COALESCE(SUM(LENGTH(conteudo)),0) FROM timeline_docs`))} em ${q1(`SELECT COUNT(*) FROM timeline_docs`)} anexos`);
      L.push(`  Fotos de cálculo: ${mb(q1(`SELECT COALESCE(SUM(LENGTH(payload)),0) FROM vg_calc_cache`))}`);
      // V650: PÁGINAS LIVRES — espaço morto dentro do arquivo (deleções e a
      // compressão dos snapshots deixam "buracos" que o export carrega junto).
      // O VACUUM (Backup → Compactar banco) devolve esse espaço.
      const livres = q1(`PRAGMA freelist_count`) * q1(`PRAGMA page_size`);
      if (livres > 5 * 1048576) {
        L.push(`  ⚠ Espaço livre RECUPERÁVEL dentro do arquivo: ${mb(livres)}`);
        L.push(`    → Rode Backup → Compactar banco (leva ~30-60s) pra encolher o arquivo`);
        L.push(`      e deixar TODOS os salvamentos proporcionalmente mais rápidos.`);
      }
    } catch (_) {}
    L.push('');
    L.push('POR FUNÇÃO (total da sessão):');
    for (const a of agregado()) {
      L.push(`  ${a.rot}: ${a.chamadas}x · total ${fmtS(a.totalMs)} · mais lenta ${fmtS(a.maxMs)}`);
    }
    L.push('');
    L.push('EXECUÇÕES MAIS LENTAS:');
    const top = REG.slice().sort((x, y) => y.ms - x.ms).slice(0, 15);
    for (const r of top) L.push(`  ${r.quando} · ${r.rot}${r.alvo ? ' (' + r.alvo + ')' : ''} · ${fmtS(r.ms)}`);
    if (!REG.length) L.push('  (nenhuma função pesada rodou nesta sessão — tudo veio das fotos)');
    // V605: travadas registradas pela sentinela (persistem entre sessões)
    const tv = travadas();
    L.push('');
    L.push(`TRAVADAS REGISTRADAS PELA SENTINELA (tela presa >2,5s): ${tv.length}`);
    for (const t of tv.slice(-12).reverse()) L.push(`  ${t.quando} · ${fmtS(t.ms)} · ${t.ctx}`);
    return L.join('\n');
  }
  function limpar() { REG.length = 0; for (const k in AGG) delete AGG[k]; }

  window.AtlasDiagPerf = { agregado, ultimas, relatorioTexto, limpar, travadas, limparTravadas };
})();
