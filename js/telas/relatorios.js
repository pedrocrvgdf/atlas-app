// ╔══════════════════════════════════════════════════════════════════════╗
// ║  RELATÓRIOS — V132.38                                                  ║
// ║  Fichários: um por módulo de Desempenho + "Relatório Repasse".         ║
// ║  Um seletor de MÊS vale pra todos os fichários.                        ║
// ║  • Relatório Repasse: matriz CONSOLIDADA da Auditoria do mês (mesmas    ║
// ║    9 colunas) + exportação Excel.                                      ║
// ║  • Desempenho (12): estrutura visível; o resultado (Módulo·Profissional ║
// ║    ·Competência·Valor) é ativado em seguida, com validação.            ║
// ╚══════════════════════════════════════════════════════════════════════╝

App.telas['relatorios'] = function () {
  RelatoriosApp.montar();
};

const RelatoriosApp = (function () {
  'use strict';

  const Banco = window.Banco;
  const Utilidades = window.Utilidades;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
  const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Os 12 fichários de Desempenho (ordem do menu)
  const FICHARIOS_DESEMPENHO = [
    { id: 'lio',             nome: 'LIO' },
    { id: 'opme',            nome: 'OPME' },
    { id: 'fellow',          nome: 'Fellow' },
    { id: 'fracionamento',   nome: 'Fracionamento' },
    { id: 'refractive',      nome: 'Refractive Laser' },
    { id: 'periodos',        nome: 'Períodos' },
    { id: 'cargos',          nome: 'Cargos' },
    { id: 'lentes',          nome: 'Lentes de Contato' },
    { id: 'luz',             nome: 'Luz Pulsada' },
    { id: 'estrabismo',      nome: 'Estrabismo' },
    { id: 'laudos',          nome: 'Laudos' },
    { id: 'crosslink',       nome: 'Crosslink' },
    { id: 'excecao_prod',    nome: 'Exceção · Produção' },   // V658
  ];
  // V775: fichários que entram no CONSOLIDADO mas não ganham aba/coluna própria
  const SEM_FICHARIO_PROPRIO = new Set(['excecao_prod']);

  const state = {
    fichario: 'consolidado',   // 'consolidado' | 'repasse' | id de desempenho
    competencia: null,
    modalExport: false,
    modalAvulsa: false,          // modal de linhas avulsas (manuais) do consolidado
    modalComplementos: false,    // V621: modal de importação de complementos em lote
    exportTipo: 'consolidado',   // 'consolidado' | 'medico'
    exportMedico: '',            // V598: '' = todos; nome = extrai SÓ esse médico
    exportAbas: null,            // Set de ids; null = ainda não inicializado
    exportVTab: true,            // V638: coluna V.TAB (versão da Base Tabela) na extração — V928: ligada por padrão
    exportStatus: null,          // Set de status; null = ainda não inicializado
    consolidadoFiltros: {},      // filtros (texto "contém") por coluna na aba Consolidado
    consolidadoSelect: {},       // V902: por coluna, ARRAY de valores marcados (multi)
    consolidadoMselAberto: null, // V902: coluna com o dropdown de checkboxes aberto
    mmDe: null, mmAte: null,     // V594: período da aba "Mês a mês" (por médico)
  };

  // V132.45: caches por competência/fichário — evita recalcular (auditoria/LIO)
  // a cada troca de aba ou re-render. Resetados ao reentrar na tela (montar).
  let _cacheRep = { comp: null, linhas: null };
  let _cacheDes = new Map();   // key: `${fichario}|${competencia}`

  // Exportação final (modelo + de-para de médicos)
  let _modeloBuffer = null;    // ArrayBuffer do modelo .xlsx importado
  let _modeloNome = '';
  let _modeloParse = null;     // { headerRow, colMap:[{col,campo,nome}], sheetName }
  let _cadExport = null;       // Map nome→nome_oficial (de-para)
  const STATUS_OPCOES = ['QVIS', 'GLOSA', 'Ajustes', 'Desempenho', 'CARGO ADMINISTRATIVO'];
  const COLS_PADRAO = [
    { header: 'Status', campo: 'status', width: 16 },
    { header: 'Módulo', campo: 'modulo', width: 16 },
    { header: 'Admissão', campo: 'admissao', width: 14 },
    { header: 'Data', campo: 'data', width: 12 },
    { header: 'Papel', campo: 'papel', width: 16 },
    { header: 'Profissional', campo: 'profissional', width: 34 },
    { header: 'Paciente', campo: 'paciente', width: 30 },
    { header: 'Origem', campo: 'origem', width: 13 },
    { header: 'Convênio', campo: 'convenio', width: 22 },
    { header: 'Descrição', campo: 'descricao', width: 42 },
    { header: 'Especialidade', campo: 'especialidade', width: 22 },   // V500.1
    { header: 'Produzido (Part.)', campo: 'produzido', width: 16 },
    { header: 'Valor repasse', campo: 'valor', width: 15 },
  ];

  function fmtDataAdm(s) {
    if (!s) return '';
    const str = String(s).trim();
    let m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    m = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return m[0];
    return str.slice(0, 10);
  }

  // competências disponíveis — UNIÃO de repasse (snapshots) + produção
  // (a LIO e outros módulos filtram por lp.competencia da Produção, que pode
  // ter meses diferentes dos snapshots de repasse).
  // V600: as competências do fluxo de REPASSE são definidas pelo QVIS
  // importado (mes_pagamento) — pedido do usuário: meses que só têm Produção
  // (ou fichários/cálculos antigos sem QVIS) NÃO aparecem mais aqui. Antes a
  // lista unia Produção + Períodos + Laudos + snapshots e meses de 2025
  // "vazavam" para o seletor e para a matriz Mês a mês.
  /**
   * Meses que este módulo TEM — os do seletor.
   *
   * V876: a lista vinha só do QVIS de pagamento, e ficava incompleta. Um
   * COMPLEMENTO lançado à mão no Consolidado (consolidado_linhas_manuais) num
   * mês sem QVIS, ou um mês já calculado (repasse_snapshot), existem de fato
   * aqui dentro — mas o mês não aparecia no seletor, e o lançamento ficava
   * inalcançável na tela. Agora os três entram.
   *
   * O que continua FORA, de propósito: mês que só tem PRODUÇÃO. Produção não é
   * pagamento — era daí que saía um repasse de LIO "pago" em 08/2025 numa base
   * sem nenhum pagamento daquele mês.
   */
  function competencias() {
    const set = new Set();
    const juntar = (sql, campo) => {
      try {
        for (const x of Banco.query(sql) || []) {
          const c = x[campo];
          if (c && c !== '0000-00' && String(c).toUpperCase() !== 'TODAS') set.add(String(c));
        }
      } catch (e) {}
    };
    juntar(`SELECT DISTINCT mes_pagamento FROM linhas_qvis
             WHERE mes_pagamento IS NOT NULL AND mes_pagamento <> ''`, 'mes_pagamento');
    juntar(`SELECT DISTINCT competencia FROM repasse_snapshot
             WHERE competencia IS NOT NULL AND competencia <> ''`, 'competencia');
    juntar(`SELECT DISTINCT competencia FROM consolidado_linhas_manuais
             WHERE competencia IS NOT NULL AND competencia <> ''`, 'competencia');
    return Array.from(set).sort().reverse();
  }

  // matriz auditada do mês (reaproveita a lógica da Auditoria)
  function matrizRepasse() {
    if (!state.competencia) return [];
    // V916: Banco._versao na chave — o montar() só limpa o cache quando a TELA
    // de Relatórios abre, mas o Controle de Notas (totaisPorMedico) e o
    // dashboard chamam o consolidado direto; sem o carimbo, uma edição na
    // auditoria/recálculo NÃO aparecia lá até alguém visitar Relatórios
    // (era o "não está atualizando os valores"). Mesma receita do V672.
    const vRep = Banco._versao || 0;
    if (_cacheRep.comp === state.competencia && _cacheRep.v === vRep && _cacheRep.linhas) return _cacheRep.linhas;
    let linhas = [];
    try {
      if (window.AtlasAuditoria && window.AtlasAuditoria.matrizDaCompetencia) {
        linhas = window.AtlasAuditoria.matrizDaCompetencia(state.competencia) || [];
      }
    } catch (e) { console.error('[relatorios] matrizRepasse:', e); }
    _cacheRep = { comp: state.competencia, v: vRep, linhas };
    return linhas;
  }

  // V500: mapa admissão → especialidade (subespecialidade do relatório de
  // PRODUÇÃO importado, linhas_producao). Coluna APENAS informativa — não
  // participa de nenhum cálculo. Cache por competência + versão do banco.
  let _espCache = { key: null, mapa: null };
  // V500.1: normalização no padrão `chaveNum` (Auditoria/Balanço) — prefere só
  // os DÍGITOS sem zeros à esquerda; imune a "12345.0", "0012345", "1.234.5".
  // MESMA função do calcular.js — as duas telas casam as MESMAS admissões.
  const _normAdmEsp = (x) => {
    const s = String(x == null ? '' : x).trim().replace(/\.0+$/, '');
    const d = s.replace(/\D/g, '').replace(/^0+/, '');
    return d || s.replace(/\s/g, '');
  };
  // V500.1: mapa GLOBAL (sem filtro de competência — admissão é código único;
  // o filtro por mês fazia o cruzamento falhar quando a competência da
  // produção divergia da do relatório).
  function mapaEspecialidades() {
    const key = String(Banco._versao || 0);
    if (_espCache.key === key && _espCache.mapa) return _espCache.mapa;
    // V503: cada admissão guarda { subs: [distintas], itens: [{prod, procPrinc, esp}] }
    // (textos normalizados) — permite o desempate pelo PRODUTO. MESMA estrutura
    // e regra do calcular.js.
    const m = new Map();
    try {
      const rows = Banco.query(
        `SELECT cod_admissao, produto, procedimento_principal, subespecialidade
           FROM linhas_producao
          WHERE subespecialidade IS NOT NULL AND TRIM(subespecialidade) <> ''`) || [];
      for (const r of rows) {
        const k = _normAdmEsp(r.cod_admissao);
        if (!k) continue;
        const esp = String(r.subespecialidade).trim();
        if (!esp) continue;
        let ent = m.get(k);
        if (!ent) { ent = { subs: [], itens: [] }; m.set(k, ent); }
        if (!ent.subs.includes(esp)) ent.subs.push(esp);
        ent.itens.push({
          prod:      Utilidades.normalizar(String(r.produto || '')),
          procPrinc: Utilidades.normalizar(String(r.procedimento_principal || '')),
          esp,
        });
      }
    } catch (e) { console.error('[relatorios] mapaEspecialidades:', e); }
    _espCache = { key, mapa: m };
    return m;
  }
  // V503: especialidade de uma admissão. Regra (definida pelo usuário): se a
  // admissão tem 2+ subespecialidades na Produção, PREDOMINA a linha cujo
  // PRODUTO casa com o PROCEDIMENTO/descrição da linha do relatório (match
  // exato normalizado, depois por contém). Só sem NENHUM match: todas com ' / '.
  // V504/V505: fallback QVIS — admissões sem correspondência na Produção
  // (adições da auditoria como Pacote Consulta, consertos, linhas de fichários)
  // usam a coluna Especialidade do próprio relatório QVIS, com match por
  // PROCEDIMENTO e último recurso pela MAIS FREQUENTE (sem " / ").
  let _espQvisCache = { key: null, mapa: null };
  function mapaEspQvis() {
    const key = String(Banco._versao || 0);
    if (_espQvisCache.key === key && _espQvisCache.mapa) return _espQvisCache.mapa;
    const m = new Map();
    try {
      const rows = Banco.query(
        `SELECT admissao, procedimento, especialidade FROM linhas_qvis
          WHERE especialidade IS NOT NULL AND TRIM(especialidade) <> ''`) || [];
      for (const r of rows) {
        const k = _normAdmEsp(r.admissao);
        if (!k) continue;
        const esp = String(r.especialidade).trim();
        if (!esp) continue;
        let ent = m.get(k);
        if (!ent) { ent = { itens: [] }; m.set(k, ent); }
        ent.itens.push({ proc: Utilidades.normalizar(String(r.procedimento || '')), esp });
      }
    } catch (e) { console.error('[relatorios] mapaEspQvis:', e); }
    _espQvisCache = { key, mapa: m };
    return m;
  }
  // V505: última instância SEM " / " — a especialidade MAIS FREQUENTE entre as
  // linhas da admissão (empate: a primeira). Decisão do usuário (opção a).
  function _espMaisFrequente(itens) {
    const cont = new Map();
    for (const x of itens) cont.set(x.esp, (cont.get(x.esp) || 0) + 1);
    let melhor = '', n = -1;
    for (const [esp, qtd] of cont) if (qtd > n) { melhor = esp; n = qtd; }
    return melhor;
  }
  function _espPorTexto(itens, campos, texto) {
    const p = Utilidades.normalizar(String(texto || ''));
    if (!p) return null;
    let hit = itens.find(x => campos.some(c => x[c] && x[c] === p));
    if (!hit) hit = itens.find(x => campos.some(c => x[c] && (x[c].indexOf(p) >= 0 || p.indexOf(x[c]) >= 0)));
    return hit ? hit.esp : null;
  }
  function especialidadeDe(mapa, admissao, procedimento) {
    const k = _normAdmEsp(admissao);
    if (!k) return '';
    const ent = mapa.get(k);
    if (!ent) {
      // V504/V505: fallback QVIS — match por procedimento; senão a mais frequente
      const entQ = mapaEspQvis().get(k);
      if (!entQ) return '';
      const porProc = _espPorTexto(entQ.itens, ['proc'], procedimento);
      if (porProc) return porProc;
      return _espMaisFrequente(entQ.itens);
    }
    if (ent.subs.length === 1) return ent.subs[0];
    // PRODUTO predomina (V503); sem match → mais frequente (V505, sem " / ")
    const porProduto = _espPorTexto(ent.itens, ['prod', 'procPrinc'], procedimento);
    if (porProduto) return porProduto;
    return _espMaisFrequente(ent.itens);
  }

  // status → rótulo (QVIS / GLOSA / ATLAS)
  function statusInfo(l) {
    const ehAtlas = l._ehAuditoria || l._ehPacoteDetalhe || l._status === 'pacoteDetalhe';
    if (l._ehConsultaProducao) return { label: 'Produção', cls: 'rel-tag-atlas' };
    if (l._status === 'glosa') return { label: 'GLOSA', cls: 'rel-tag-glosa' };
    if (ehAtlas) return { label: 'Ajustes', cls: 'rel-tag-atlas' };
    if (l._status === 'casou') return { label: 'QVIS', cls: 'rel-tag-qvis' };
    return { label: (l._status || '—'), cls: 'rel-tag-neutra' };
  }

  // V947: tag padrão da ferramenta (Utilidades.badgeFonte) — sem palheta própria
  function fonteBadge(origem, convenio) {
    const cls = Utilidades.classeFonte(origem) || 'conv';
    const tag = Utilidades.badgeFonte(cls === 'conv' ? 'CONVENIO' : origem);
    return `${tag}${cls === 'conv' && convenio ? ` <span class="rel-conv-nome">${esc(convenio)}</span>` : ''}`;
  }

  // ── ADAPTADORES DE DESEMPENHO ────────────────────────────────────────────
  // Cada módulo expõe seu resultado já calculado; aqui transformamos no formato
  // padrão do relatório: { modulo, papel, profissional, competencia, valor }.
  // O "unpivot" vira cada papel-em-coluna em uma LINHA.
  // Categorias do Refractive Laser (espelha SINONIMOS_RL da tela RL)
  const RL_SINONIMOS = {
    A: { label: 'ORBSCAN Ceratoscopia', tipo: 'EXAME', sinonimos: ['ORBSCAN /SCANSYS CERATOSCOPIA (MONOCULAR)'] },
    B: { label: 'ORBSCAN Paquimetria', tipo: 'EXAME', sinonimos: ['ORBSCAN /SCANSYS PAQUIMETRIA (MONOCULAR)'] },
    C: { label: 'Fotoablação PRK', tipo: 'CIRURGICO', sinonimos: ['FOTOABLACAO DA SUPERFICIE CONVENCIONAL PRK', 'PACOTE FOTOABLACAO DE SUPERFICIE CONVENCIONAL PRK', 'PACOTE FOTOABLACAO DA SUPERFICIE CONVENCIONAL'] },
    D: { label: 'Pacote Delaminação LASIK', tipo: 'CIRURGICO', sinonimos: ['PACOTE DELAMINACAO CORNEANA C/FOTOABLACAO ESTROMAL LASIK', 'PACOTE DELAMINACAO CORNEANA C/FOTOABLACAO ESTROMAL LASIK BINOCULAR', 'PACOTE DELAMINACAO CORNEANA C/FOTOABLACAO ESTROMAL LASIK OU PRK (ENF)'] },
    E: { label: 'Cirurgia Refrativa LASIK', tipo: 'CIRURGICO', sinonimos: ['CIRURGIA REFRATIVA PERSONALIZADA (LASIK)'] },
    F: { label: 'Cirurgia Refrativa PRK', tipo: 'CIRURGICO', sinonimos: ['CIRURGIA REFRATIVA PERSONALIZADA (PRK)'] },
    G: { label: 'Delaminação LASIK', tipo: 'CIRURGICO', sinonimos: ['DELAMINACAO CORNEANA C/ FOTO. ESTROMAL / LASIK'] },
  };
  const RL_MAPA = (() => {
    const m = new Map();
    const nrm = (s) => String(s == null ? '' : s).toUpperCase().trim().replace(/\s+/g, ' ');
    for (const [cat, info] of Object.entries(RL_SINONIMOS)) for (const sin of info.sinonimos) m.set(nrm(sin), cat);
    return m;
  })();
  function rlCategorizar(proc) {
    return RL_MAPA.get(String(proc == null ? '' : proc).toUpperCase().trim().replace(/\s+/g, ' ')) || null;
  }

  // Produção LC do mês (médicos INTERNO/HIBRIDO) — usada nas exceções percentuais
  // de cargo. Espelha calcularProducaoLCTotal da tela de Cargos.
  function cargosProducaoLC(competencia) {
    if (!competencia) return 0;
    try {
      const inIH = new Set();
      Banco.query(`SELECT nome_oficial, nome_normalizado FROM medicos WHERE ativo = 1 AND tipo_vinculo IN ('INTERNO','HIBRIDO')`)
        .forEach(m => { inIH.add((m.nome_oficial || '').toUpperCase().trim()); inIH.add(m.nome_normalizado || ''); });
      try {
        Banco.query(`SELECT s.grafia, s.grafia_normalizada FROM sinonimos_medico s JOIN medicos m ON m.id = s.medico_id WHERE m.ativo = 1 AND m.tipo_vinculo IN ('INTERNO','HIBRIDO')`)
          .forEach(sin => { inIH.add((sin.grafia || '').toUpperCase().trim()); inIH.add(sin.grafia_normalizada || ''); });
      } catch (e) {}
      const linhas = Banco.query(`SELECT valor, UPPER(TRIM(COALESCE(medico,''))) AS m, UPPER(TRIM(COALESCE(cirurgiao,''))) AS c FROM linhas_producao WHERE categoria = 'Lentes de Contato' AND competencia = ?`, [competencia]) || [];
      let total = 0;
      for (const l of linhas) { const v = Number(l.valor) || 0; if (v <= 0) continue; const exec = l.m || l.c; if (inIH.has(exec)) total += v; }
      return total;
    } catch (e) { return 0; }
  }

  const ADAPTADORES = {
    // LIO: papéis Executante (18%) e Indicante (2,5% só quando ≠ executante).
    // Reaproveita App.repasseLIO.calcularRepasses (fonte fiel da tela LIO).
    lio: function (competencia) {
      const R = window.App && App.repasseLIO;
      if (!R || typeof R.montarLinhasConvenio !== 'function') {
        return { erro: 'Módulo LIO não carregado. Recarregue a página (Ctrl+Shift+R).' };
      }
      const ano = competencia ? competencia.slice(0, 4) : '';
      const mes = competencia ? competencia.slice(5, 7) : '';

      // diagnóstico
      let nFlag = 0, nProd = 0;
      try { nFlag = ((Banco.query(`SELECT COUNT(*) AS n FROM lio_convenios_flagados`) || [])[0] || {}).n || 0; } catch (e) {}
      try {
        nProd = ((Banco.query(
          `SELECT COUNT(*) AS n FROM linhas_producao
           WHERE classificacao_produto='OPME'
             AND substr(competencia,1,4)=? AND substr(competencia,6,2)=?`, [ano, mes]) || [])[0] || {}).n || 0;
      } catch (e) {}

      const cfg = R.lerConfigCalculo();
      const desab = (typeof R.admissoesDesabilitadas === 'function') ? R.admissoesDesabilitadas() : new Set();

      // Convênio (reproduz a aba CONVÊNIO) + Particular (reproduz a aba PARTICULAR)
      let conv = [], part = [];
      try { conv = R.montarLinhasConvenio({ ano, mes }, { incluirTodosTiposReceb: true }) || []; }
      catch (e) { console.error('[relatorios] LIO convênio:', e); }
      try { part = (typeof R.montarLinhasParticular === 'function') ? (R.montarLinhasParticular({ ano, mes }) || []) : []; }
      catch (e) { console.error('[relatorios] LIO particular:', e); }
      const brutas = conv.concat(part);

      const out = [];
      let comRegra = 0;
      for (const l of brutas) {
        if (desab.has(String(l.admissao))) continue;       // duplicidade → fora
        let temRegra = true;
        try { temRegra = R.temRegraAplicada(l, cfg); } catch (e) { temRegra = false; }
        if (!temRegra) continue;
        let calc;
        try { calc = R.calcularRepasseLinha(l, cfg); } catch (e) { calc = { repExec: 0, repInd: 0, semRegra: true }; }
        if (calc.semRegra) continue;                        // sem OPME identificado (convênio)
        comRegra++;
        const comp = l.competencia || competencia || '';
        const exec = l.cirurgiao || l.medico || '';
        const ind = l.indicante || '';
        const ehPart = String(l.tipo_recebimento || '').toUpperCase().startsWith('PART');
        const origem = ehPart ? 'PARTICULAR' : 'CONVÊNIO';
        const convenio = ehPart ? 'PARTICULAR' : (l.convenio || '');
        const adm = String(l.admissao || '');
        const descr = l.produto || l.procedimento_principal || l.procedimento ||
          (calc && typeof calc.opmeIdentificado === 'string' ? calc.opmeIdentificado : '') ||
          l.descricao || '';
        const base = { status: 'Desempenho', modulo: 'LIO', admissao: adm, data_admissao: l.data_admissao || '',
                       origem: origem, convenio: convenio, competencia: comp, descricao: descr,
                       produzido: ehPart ? (Number(l.valor) || 0) : 0, _fichProd: ehPart };   // V251: LIO part. = % de l.valor (produzido)
        // V132.45: só linhas com valor > 0 (evita poluição: Indicante R$ 0,00 etc.)
        const vE = Number(calc.repExec) || 0;
        const vI = Number(calc.repInd) || 0;
        if (exec && vE > 0) out.push({ ...base, papel: 'Executante', profissional: exec, valor: vE });
        if (ind && vI > 0) out.push({ ...base, papel: 'Indicante', profissional: ind, valor: vI });
      }

      // V667: ADICIONAL — repasse EXTRA de % (padrão 50) sobre a diferença
      // entre o valor COBRADO (produzido) e o valor de TABELA cadastrado da
      // lente, em LIOs particulares de executantes da especialidade Catarata.
      // Soma-se ao repasse normal do LIO (linha própria "LIO · ADICIONAL").
      // V672: SÓ entra no consolidado com o interruptor da aba LIGADO — o
      // repasse do adicional está sendo lançado manualmente (pedido do usuário).
      let nAdic = 0;
      try {
        if (typeof R.montarLinhasAdicional === 'function'
            && typeof R.adicionalNoConsolidado === 'function' && R.adicionalNoConsolidado()) {
          for (const l of (R.montarLinhasAdicional({ ano, mes }) || [])) {
            if (desab.has(String(l.admissao))) continue;       // duplicidade → fora
            const ad = l._adicional || {};
            const exec = l.cirurgiao || l.medico || '';
            const vAd = Number(ad.repasse) || 0;
            if (!exec || vAd <= 0) continue;
            nAdic++;
            out.push({
              status: 'Desempenho', modulo: 'LIO · ADICIONAL',
              admissao: String(l.admissao || ''), data_admissao: l.data_admissao || '',
              origem: 'PARTICULAR', convenio: 'PARTICULAR',
              competencia: l.competencia || competencia || '',
              descricao: `${l.produto || ''} — tabela R$ ${Utilidades.formatarNumero(Number(ad.valorTabela) || 0, 2)} · diferença R$ ${Utilidades.formatarNumero(Number(ad.diferenca) || 0, 2)} (${Number(ad.pct) || 0}%)`,   // V944: #0.000,00
              produzido: Number(l.valor) || 0, _fichProd: true,
              papel: 'Executante', profissional: exec, valor: vAd,
            });
          }
        }
      } catch (e) { console.error('[relatorios] LIO adicional:', e); }
      console.log(`[relatorios] LIO ${ano}-${mes}: flagados=${nFlag}, prodOPME(mês)=${nProd}, conv=${conv.length}, part=${part.length}, comRegra=${comRegra}, adicional=${nAdic}, linhasFinais=${out.length}`);
      return { linhas: out };
    },

    // OPME: traz SOMENTE o que estiver FLAGADO COMO PAGO (opme_pagamentos).
    // Reaproveita a lógica da própria tela OPME (window.AtlasOPME).
    opme: function (competencia) {
      if (!window.AtlasOPME || typeof window.AtlasOPME.resultadoPagosRelatorio !== 'function') {
        return { erro: 'Módulo OPME não carregado. Recarregue a página (Ctrl+Shift+R).' };
      }
      let linhas = [];
      try { linhas = window.AtlasOPME.resultadoPagosRelatorio(competencia) || []; }
      catch (e) { console.error('[relatorios] adaptador OPME:', e); return { erro: 'Erro ao calcular o OPME: ' + (e.message || e) }; }
      console.log(`[relatorios] OPME ${competencia}: ${linhas.length} linhas pagas com valor`);
      return { linhas };
    },

    // FELLOW: consolida por profissional no mês. Total a repassar = complemento
    // efetivo + refeição (mesma conta da tela, somada por fellow). Admissão,
    // Origem e Convênio em branco; Data = 1º dia do mês de referência (mes_ref).
    fellow: function (competencia) {
      let rows = [];
      try {
        rows = Banco.query(`
          SELECT fellow_nome, fellow_norm, valor_complem, valor_complem_manual,
                 qtd_complem, refeicao
            FROM fellow_linhas WHERE mes_ref = ?`, [competencia]) || [];
      } catch (e) { console.error('[relatorios] FELLOW:', e); return { erro: 'Erro ao ler Fellow: ' + (e.message || e) }; }

      const porFellow = new Map();   // nome → { valor, complementos, refeicoes }
      for (const l of rows) {
        const temManual = (l.valor_complem_manual !== null && l.valor_complem_manual !== undefined);
        const complem = temManual ? Number(l.valor_complem_manual)
                      : (Number(l.qtd_complem) < 0 ? 0 : (Number(l.valor_complem) || 0));
        const totalEf = complem + (Number(l.refeicao) || 0);
        const nome = l.fellow_nome || '—';
        let e = porFellow.get(nome);
        if (!e) { e = { valor: 0, complementos: 0, refeicoes: 0 }; porFellow.set(nome, e); }
        e.valor += totalEf;
        const qc = Number(l.qtd_complem) || 0;            // qtd de complemento (negativo = sem)
        if (qc > 0) e.complementos += qc;
        if ((Number(l.refeicao) || 0) > 0) e.refeicoes += 1;
      }
      const dataMes = `${competencia}-01`;   // fmtDataAdm → 01/MM/AAAA
      const out = [];
      for (const [nome, e] of porFellow) {
        if (e.valor <= 0) continue;            // só com valor
        const descricao = `${e.complementos} complemento${e.complementos === 1 ? '' : 's'} + ${e.refeicoes} refeiç${e.refeicoes === 1 ? 'ão' : 'ões'}`;
        out.push({ status: 'Desempenho', modulo: 'FELLOW', admissao: '', data_admissao: dataMes,
                   papel: 'FELLOW', profissional: nome, origem: '', convenio: '', descricao: descricao,
                   competencia, valor: e.valor });
      }
      out.sort((a, b) => b.valor - a.valor);
      console.log(`[relatorios] FELLOW ${competencia}: ${out.length} profissionais`);
      return { linhas: out };
    },

    // FRACIONAMENTO: por aplicação. Repasse já salvo (valor_repasse / manual).
    // Papel = FELLOW; Origem por eh_particular; Convênio da coluna; Descrição = medicamento.
    fracionamento: function (competencia) {
      let rows = [];
      try {
        rows = Banco.query(`
          SELECT a.admissao, a.data_aplicacao, a.medico_nome, a.medico_id,
                 a.convenio, a.observacao, a.eh_particular,
                 COALESCE(a.valor_repasse_manual, a.valor_repasse) AS valor,
                 a.valor_fracionamento AS produzido_base,
                 m.nome_oficial
            FROM fracionamento_aplicacoes a
            LEFT JOIN medicos m ON m.id = a.medico_id
           WHERE a.mes_ref = ?
           ORDER BY a.data_aplicacao, a.admissao`, [competencia]) || [];
      } catch (e) { console.error('[relatorios] FRACIONAMENTO:', e); return { erro: 'Erro ao ler Fracionamento: ' + (e.message || e) }; }

      const out = [];
      for (const l of rows) {
        const valor = Number(l.valor) || 0;
        if (valor <= 0) continue;                  // só com valor
        const ehPart = Number(l.eh_particular) === 1;
        out.push({
          status: 'Desempenho', modulo: 'FRACIONAMENTO',
          admissao: l.admissao || '',
          data_admissao: l.data_aplicacao || '',
          papel: 'EXECUTANTE',
          profissional: l.nome_oficial || l.medico_nome || '—',
          origem: ehPart ? 'PARTICULAR' : 'CONVÊNIO',
          convenio: l.convenio || '',
          descricao: l.observacao || '',          // medicamento (EYLIA/VABYSMO)
          competencia, valor,
          produzido: ehPart ? (Number(l.produzido_base) || 0) : 0, _fichProd: ehPart,   // V250
        });
      }
      console.log(`[relatorios] FRACIONAMENTO ${competencia}: ${out.length} aplicações com valor`);
      return { linhas: out };
    },

    // REFRACTIVE LASER: taxa de aluguel do aparelho. Quem recebe = proprietária
    // (config PROPRIETARIO_MEDICO_ID, ou auto Maria Regina Catai). Por linha (proc).
    refractive: function (competencia) {
      // config (mesmos defaults da tela)
      const c = {};
      try { (Banco.query('SELECT chave, valor FROM config_refractive_laser') || []).forEach(r => { c[r.chave] = r.valor; }); } catch (e) {}
      const cfg = {
        baseParticular: (c.BASE_PARTICULAR ?? '1') === '1',
        baseConvenio:   (c.BASE_CONVENIO   ?? '1') === '1',
        VAL_A_CONV: parseFloat(c.VAL_A_CONV || '28.72') || 0, VAL_A_PART: parseFloat(c.VAL_A_PART || '62.50') || 0,
        VAL_B_CONV: parseFloat(c.VAL_B_CONV || '23.40') || 0, VAL_B_PART: parseFloat(c.VAL_B_PART || '62.50') || 0,
        VAL_CIRUR_CONV_QTD1: parseFloat(c.VAL_CIRUR_CONV_QTD1 || '254.65') || 0,
        VAL_CIRUR_CONV_QTD2: parseFloat(c.VAL_CIRUR_CONV_QTD2 || '509.30') || 0,
        PCT_CIRUR_PART: parseFloat(c.PCT_CIRUR_PART || '26.50') || 0,
      };
      // proprietária (quem recebe a taxa)
      let prop = null;
      try {
        if (c.PROPRIETARIO_MEDICO_ID) prop = Banco.queryUnica(`SELECT nome_oficial FROM medicos WHERE id = ? AND ativo = 1`, [c.PROPRIETARIO_MEDICO_ID]);
        if (!prop) prop = Banco.queryUnica(`SELECT nome_oficial FROM medicos WHERE ativo = 1 AND UPPER(nome_oficial) LIKE '%MARIA%REGINA%CATAI%' LIMIT 1`);
      } catch (e) {}
      const nomeProp = (prop && prop.nome_oficial) || 'Proprietário do aparelho';

      let linhas = [];
      try {
        linhas = Banco.query(`
          SELECT admissao, data_admissao, procedimento, origem, convenio, produzido, quantidade
            FROM linhas_qvis
           WHERE papel IN ('MEDICO', 'CIRURGIAO') AND mes_pagamento = ?
           ORDER BY data_admissao, admissao`, [competencia]) || [];
      } catch (e) { console.error('[relatorios] REFRACTIVE:', e); return { erro: 'Erro ao ler Refractive Laser: ' + (e.message || e) }; }

      const out = [];
      for (const l of linhas) {
        const cat = rlCategorizar(l.procedimento);
        if (!cat) continue;                         // não é procedimento do RL
        const info = RL_SINONIMOS[cat];
        const ehPart = String(l.origem || '').toUpperCase() === 'PARTICULAR';
        if (ehPart && !cfg.baseParticular) continue;
        if (!ehPart && !cfg.baseConvenio) continue;
        const qtd = Number(l.quantidade) || 1;
        let taxa = 0;
        if (info.tipo === 'EXAME') {
          taxa = ehPart ? (cfg[`VAL_${cat}_PART`] || 0) : (cfg[`VAL_${cat}_CONV`] || 0);
        } else {
          if (!ehPart) taxa = qtd === 1 ? cfg.VAL_CIRUR_CONV_QTD1 : cfg.VAL_CIRUR_CONV_QTD2;
          else taxa = (Number(l.produzido) || 0) * cfg.PCT_CIRUR_PART / 100;
        }
        if (taxa <= 0) continue;                    // só com valor
        const prodBaseRL = (ehPart && info.tipo !== 'EXAME') ? (Number(l.produzido) || 0) : 0;  // V250: só CIRÚRGICO particular é %
        out.push({
          status: 'Desempenho', modulo: 'Refractive Laser',
          admissao: l.admissao || '', data_admissao: l.data_admissao || '',
          papel: 'TAXA EQUIPAMENTO', profissional: nomeProp,
          origem: ehPart ? 'PARTICULAR' : 'CONVÊNIO',
          convenio: l.convenio || '', descricao: info.label,
          competencia, valor: taxa,
          produzido: prodBaseRL, _fichProd: prodBaseRL > 0,   // V250
        });
      }
      console.log(`[relatorios] REFRACTIVE ${competencia}: ${out.length} linhas com taxa`);
      return { linhas: out };
    },

    // PERÍODOS: uma linha por médico+unidade. Papel = Unidades; Data = 1º dia do
    // mês; Descrição = unidade + qtd de períodos; Valor = Total R$ (total_valor).
    periodos: function (competencia) {
      let rows = [];
      try {
        rows = Banco.query(`
          SELECT nome_original, unidade, total_periodos, total_valor
            FROM periodos_linhas WHERE mes_ref = ?
           ORDER BY unidade, nome_original`, [competencia]) || [];
      } catch (e) { console.error('[relatorios] PERÍODOS:', e); return { erro: 'Erro ao ler Períodos: ' + (e.message || e) }; }

      const dataMes = `${competencia}-01`;   // fmtDataAdm → 01/MM/AAAA
      const out = [];
      for (const l of rows) {
        const valor = Number(l.total_valor) || 0;
        if (valor <= 0) continue;             // só com valor
        const qtd = Number(l.total_periodos) || 0;
        out.push({
          status: 'Desempenho', modulo: 'Períodos',
          admissao: '', data_admissao: dataMes,
          papel: 'Unidades', profissional: l.nome_original || '—',
          origem: '', convenio: '',
          descricao: `${l.unidade || '—'} + ${qtd} período${qtd === 1 ? '' : 's'}`,
          competencia, valor,
        });
      }
      console.log(`[relatorios] PERÍODOS ${competencia}: ${out.length} linhas`);
      return { linhas: out };
    },

    // CARGOS ADMINISTRATIVOS: uma linha por médico+cargo (exceto Sócio).
    // Status = CARGO ADMINISTRATIVO; Papel = sigla da TAG (DC/DM/CM/RT);
    // Descrição = nome do cargo; Valor = valor mensal fixo (ou da exceção).
    cargos: function (competencia) {
      const valores = {};
      try { (Banco.query('SELECT cargo, valor_mensal FROM valores_cargos') || []).forEach(r => { valores[r.cargo] = Number(r.valor_mensal) || 0; }); } catch (e) {}
      const excPorMedico = new Map();
      try { (Banco.query(`SELECT * FROM excecoes_cargo WHERE ativo = 1`) || []).forEach(e => excPorMedico.set(e.medico_id, e)); } catch (e) {}

      let medicos = [];
      try {
        medicos = Banco.query(`
          SELECT m.id AS medico_id, m.nome_oficial AS nome_medico, GROUP_CONCAT(mc.cargo, ',') AS cargos
            FROM medicos m JOIN medico_cargos mc ON mc.medico_id = m.id
           WHERE m.ativo = 1 AND mc.cargo != 'SOCIO'
           GROUP BY m.id ORDER BY m.nome_oficial`) || [];
      } catch (e) { console.error('[relatorios] CARGOS:', e); return { erro: 'Erro ao ler Cargos: ' + (e.message || e) }; }

      const producaoLC = cargosProducaoLC(competencia);
      const CA = (window.Utilidades && Utilidades.CARGOS_ADMIN) || {};
      const dataMes = `${competencia}-01`;
      const out = [];
      for (const m of medicos) {
        const listaCargos = (m.cargos || '').split(',').filter(Boolean);
        const exc = excPorMedico.get(m.medico_id);
        for (const cargo of listaCargos) {
          const cat = CA[cargo];
          if (cat && cat.ehSocio) continue;             // sócio não paga
          const sigla = cat ? cat.sigla : cargo;
          const label = cat ? cat.label : cargo;
          let valor = 0;
          if (exc && exc.cargo_base === cargo) {        // exceção sobrescreve o fixo
            if (exc.tipo_calculo === 'VALOR_FIXO') valor = Number(exc.valor_fixo) || 0;
            else valor = producaoLC > 0 ? producaoLC * (Number(exc.percentual) || 0) / 100 : 0;
          } else {
            valor = valores[cargo] || 0;
          }
          if (valor <= 0) continue;                     // só com valor
          out.push({
            status: 'CARGO ADMINISTRATIVO', modulo: 'CARGOS ADMINISTRATIVOS',
            admissao: '', data_admissao: dataMes,
            papel: sigla, profissional: m.nome_medico || '—',
            origem: '', convenio: '', descricao: label,
            competencia, valor,
          });
        }
      }
      out.sort((a, b) => b.valor - a.valor);
      console.log(`[relatorios] CARGOS ${competencia}: ${out.length} linhas`);
      return { linhas: out };
    },

    // LENTES DE CONTATO: detalhado por admissão (vem da PRODUÇÃO). Unpivot de
    // papéis: Executante (pctExec, default 18%) e Indicante (pctIndic, default
    // 9%), só para médicos INTERNO/HIBRIDO. Mesma conta da tela LC.
    lentes: function (competencia) {
      let pctExec = 18, pctIndic = 9;
      try {
        const cfg = {};
        (Banco.query('SELECT chave, valor FROM config_lentes_contato') || []).forEach(r => { cfg[r.chave] = Number(r.valor); });
        pctExec = cfg['PERCENTUAL_EXECUTANTE'] != null ? cfg['PERCENTUAL_EXECUTANTE'] : 18;
        pctIndic = cfg['PERCENTUAL_INDICANTE'] != null ? cfg['PERCENTUAL_INDICANTE'] : 9;
      } catch (e) {}
      const fExec = pctExec / 100, fIndic = pctIndic / 100;

      // cadastro de médicos (nome → médico) + sinônimos
      const cadMap = new Map();
      try {
        const porId = new Map();
        (Banco.query(`SELECT id, nome_oficial, nome_normalizado, tipo_vinculo FROM medicos WHERE ativo = 1`) || []).forEach(m => {
          cadMap.set((m.nome_oficial || '').toUpperCase().trim(), m);
          cadMap.set(m.nome_normalizado, m); porId.set(m.id, m);
        });
        try {
          (Banco.query(`SELECT s.grafia, s.grafia_normalizada, s.medico_id FROM sinonimos_medico s JOIN medicos m ON m.id = s.medico_id WHERE m.ativo = 1`) || []).forEach(s => {
            const med = porId.get(s.medico_id);
            if (med) { cadMap.set((s.grafia || '').toUpperCase().trim(), med); cadMap.set(s.grafia_normalizada, med); }
          });
        } catch (e) {}
      } catch (e) {}
      const ehIH = (med) => med && (med.tipo_vinculo === 'INTERNO' || med.tipo_vinculo === 'HIBRIDO');

      let linhas = [];
      try {
        linhas = Banco.query(`
          SELECT cod_admissao, data_admissao, valor, tipo_recebimento, convenio,
                 produto, procedimento_principal,
                 UPPER(TRIM(COALESCE(medico,'')))      AS m,
                 UPPER(TRIM(COALESCE(cirurgiao,'')))   AS c,
                 UPPER(TRIM(COALESCE(indicante,'')))   AS i,
                 UPPER(TRIM(COALESCE(solicitante,''))) AS s
            FROM linhas_producao
           WHERE categoria = 'Lentes de Contato' AND competencia = ?
           ORDER BY data_admissao, cod_admissao`, [competencia]) || [];
      } catch (e) { console.error('[relatorios] LENTES:', e); return { erro: 'Erro ao ler Lentes de Contato: ' + (e.message || e) }; }

      const out = [];
      for (const l of linhas) {
        const v = Number(l.valor) || 0;
        if (v <= 0) continue;
        const oUp = String(l.tipo_recebimento || '').toUpperCase();
        const origem = oUp.indexOf('PART') >= 0 ? 'PARTICULAR' : (oUp.indexOf('CONV') >= 0 ? 'CONVÊNIO' : (l.tipo_recebimento || ''));
        const base = {
          status: 'Desempenho', modulo: 'LENTES DE CONTATO',
          admissao: l.cod_admissao || '', data_admissao: l.data_admissao || '',
          origem, convenio: l.convenio || '',
          descricao: 'SERVIÇO - ADAPTAÇÃO DE LENTE DE CONTATO', competencia,
          produzido: v, _fichProd: true,   // V250: % sobre o produzido (v) — particular mostra a base
        };
        const execMed = cadMap.get(l.m || l.c);
        if (ehIH(execMed) && v * fExec > 0) out.push({ ...base, papel: 'Executante', profissional: execMed.nome_oficial, valor: v * fExec });
        const indicMed = cadMap.get(l.i || l.s);
        if (ehIH(indicMed) && v * fIndic > 0) out.push({ ...base, papel: 'Indicante', profissional: indicMed.nome_oficial, valor: v * fIndic });
      }
      console.log(`[relatorios] LENTES ${competencia}: ${out.length} linhas (papéis)`);
      return { linhas: out };
    },

    // ESTRABISMO: vem da PRODUÇÃO (produto LIKE ESTRABISMO). Uma linha por
    // admissão MARCADA (marcacoes_estrabismo). Repasse = valor por qtd (1 olho
    // /2 olhos, convênio ou SUS). Papel = EXECUTANTE; cirurgião principal = o de
    // maior valor de produção na admissão. Convênio/produto vêm da produção.
    estrabismo: function (competencia) {
      const cfg = { qtd1Conv: 1260, qtd2Conv: 1680, qtd1Sus: 300, qtd2Sus: 300 };
      try {
        const c = {};
        (Banco.query('SELECT chave, valor FROM config_estrabismo') || []).forEach(r => { c[r.chave] = Number(r.valor); });
        if (c['VALOR_QTD1_CONVENIO'] != null) cfg.qtd1Conv = c['VALOR_QTD1_CONVENIO'];
        if (c['VALOR_QTD2_CONVENIO'] != null) cfg.qtd2Conv = c['VALOR_QTD2_CONVENIO'];
        if (c['VALOR_QTD1_SUS'] != null) cfg.qtd1Sus = c['VALOR_QTD1_SUS'];
        if (c['VALOR_QTD2_SUS'] != null) cfg.qtd2Sus = c['VALOR_QTD2_SUS'];
      } catch (e) {}
      const valorPorQtd = (eSUS, qtd) => { if (!qtd) return 0; if (eSUS) return qtd === 1 ? cfg.qtd1Sus : cfg.qtd2Sus; return qtd === 1 ? cfg.qtd1Conv : cfg.qtd2Conv; };

      // cadastro (nome → médico) + sinônimos
      const cadMap = new Map();
      try {
        const porId = new Map();
        (Banco.query(`SELECT id, nome_oficial, nome_normalizado, tipo_vinculo FROM medicos WHERE ativo = 1`) || []).forEach(m => { cadMap.set((m.nome_oficial || '').toUpperCase().trim(), m); cadMap.set(m.nome_normalizado, m); porId.set(m.id, m); });
        try { (Banco.query(`SELECT s.grafia, s.grafia_normalizada, s.medico_id FROM sinonimos_medico s JOIN medicos m ON m.id = s.medico_id WHERE m.ativo = 1`) || []).forEach(s => { const med = porId.get(s.medico_id); if (med) { cadMap.set((s.grafia || '').toUpperCase().trim(), med); cadMap.set(s.grafia_normalizada, med); } }); } catch (e) {}
      } catch (e) {}

      // marcações do mês (cod_admissao → qtd)
      const marc = new Map();
      try { (Banco.query(`SELECT cod_admissao, quantidade FROM marcacoes_estrabismo WHERE competencia = ?`, [competencia]) || []).forEach(r => marc.set(String(r.cod_admissao), Number(r.quantidade) || 0)); } catch (e) {}

      // V914: regra por médico — valor FIXO por admissão marcada (ignora qtd/fonte)
      const valorFixoMed = new Map();
      try { (Banco.query(`SELECT medico_id, valor_fixo FROM estrabismo_valor_medico`) || []).forEach(r => valorFixoMed.set(Number(r.medico_id), Number(r.valor_fixo) || 0)); } catch (e) {}

      let linhas = [];
      try {
        linhas = Banco.query(`
          SELECT cod_admissao, COALESCE(data_admissao,'') AS data_admissao, COALESCE(produto,'') AS produto,
                 COALESCE(convenio,'') AS convenio, UPPER(COALESCE(tipo_recebimento,'')) AS tipo_receb,
                 UPPER(TRIM(COALESCE(medico,'')))    AS exec_medico,
                 UPPER(TRIM(COALESCE(cirurgiao,''))) AS exec_cirurgiao,
                 COALESCE(valor,0) AS valor_producao
            FROM linhas_producao
           WHERE UPPER(COALESCE(produto,'')) LIKE '%ESTRABISMO%'
             AND UPPER(COALESCE(produto,'')) NOT LIKE '%TAXA%'
             AND UPPER(COALESCE(produto,'')) NOT LIKE '%PACOTE%'
             AND competencia = ?
           ORDER BY cod_admissao`, [competencia]) || [];
      } catch (e) { console.error('[relatorios] ESTRABISMO:', e); return { erro: 'Erro ao ler Estrabismo: ' + (e.message || e) }; }

      // consolida por admissão
      const admMap = new Map();
      for (const l of linhas) {
        const cod = String(l.cod_admissao);
        if (!admMap.has(cod)) admMap.set(cod, { cod, data: l.data_admissao, tipo_receb: l.tipo_receb, convenio: l.convenio, somaExec: new Map(), produtoTop: l.produto, topValor: -Infinity });
        const a = admMap.get(cod);
        const exec = l.exec_cirurgiao || l.exec_medico || '';
        const v = Number(l.valor_producao) || 0;
        a.somaExec.set(exec, (a.somaExec.get(exec) || 0) + v);
        if (v > a.topValor) { a.topValor = v; a.produtoTop = l.produto; if (l.convenio) a.convenio = l.convenio; if (l.tipo_receb) a.tipo_receb = l.tipo_receb; if (l.data_admissao) a.data = l.data_admissao; }
      }

      const out = [];
      for (const [cod, a] of admMap) {
        const qtd = marc.get(cod) || 0;
        if (qtd <= 0) continue;                    // só admissões marcadas
        let melhorNome = '', melhorValor = -Infinity;
        for (const [nome, val] of a.somaExec) { if (val > melhorValor) { melhorValor = val; melhorNome = nome; } }
        const med = cadMap.get(melhorNome);
        const eSUS = a.tipo_receb === 'SUS';
        // V914: médico com regra de valor fixo → paga o fixo por admissão marcada
        const repasse = (med && valorFixoMed.has(med.id)) ? valorFixoMed.get(med.id) : valorPorQtd(eSUS, qtd);
        if (repasse <= 0) continue;
        const oUp = String(a.tipo_receb || '').toUpperCase();
        const origem = oUp.indexOf('PART') >= 0 ? 'PARTICULAR' : (oUp.indexOf('CONV') >= 0 ? 'CONVÊNIO' : (a.tipo_receb || ''));
        out.push({
          status: 'Desempenho', modulo: 'ESTRABISMO',
          admissao: cod, data_admissao: a.data,
          papel: 'EXECUTANTE', profissional: med ? med.nome_oficial : (melhorNome || '—'),
          origem, convenio: a.convenio || '', descricao: a.produtoTop || '',
          competencia, valor: repasse,
        });
      }
      out.sort((a, b) => b.valor - a.valor);
      console.log(`[relatorios] ESTRABISMO ${competencia}: ${out.length} admissões marcadas`);
      return { linhas: out };
    },

    // LAUDOS: as 3 categorias (PACOTE/IMPRESSO/EXTERNO). Papel = EXECUTANTE;
    // Profissional = médico; Descrição = exame; Valor = valor_repasse.
    // Origem/Convênio: cruza a admissão com a PRODUÇÃO; sem admissão, em branco.
    laudos: function (competencia) {
      let laudos = [];
      try {
        laudos = Banco.query(`SELECT categoria, medico, exame, valor_repasse, admissao, data_admissao FROM laudos WHERE competencia = ?`, [competencia]) || [];
      } catch (e) { console.error('[relatorios] LAUDOS:', e); return { erro: 'Erro ao ler Laudos: ' + (e.message || e) }; }

      // mapa produção por admissão (origem/convênio/data) — só das admissões presentes
      const adms = [...new Set(laudos.map(l => String(l.admissao || '').trim()).filter(Boolean))];
      const prodMap = new Map();
      if (adms.length) {
        try {
          const ph = adms.map(() => '?').join(',');
          (Banco.query(`SELECT cod_admissao, tipo_recebimento, convenio, data_admissao FROM linhas_producao WHERE cod_admissao IN (${ph})`, adms) || [])
            .forEach(r => { const cod = String(r.cod_admissao); if (!prodMap.has(cod)) prodMap.set(cod, r); });
        } catch (e) {}
      }

      const out = [];
      for (const l of laudos) {
        const valor = Number(l.valor_repasse) || 0;
        if (valor <= 0) continue;                  // só com valor
        const adm = String(l.admissao || '').trim();
        let origem = '', convenio = '', data = l.data_admissao || '';
        if (adm) {
          const p = prodMap.get(adm);
          if (p) {
            const oUp = String(p.tipo_recebimento || '').toUpperCase();
            origem = oUp.indexOf('PART') >= 0 ? 'PARTICULAR' : (oUp.indexOf('CONV') >= 0 ? 'CONVÊNIO' : (p.tipo_recebimento || ''));
            convenio = p.convenio || '';
            if (!data) data = p.data_admissao || '';
          }
        }
        if (!data) data = `${competencia}-01`;     // sem dados → 1º dia do mês
        out.push({
          status: 'Desempenho', modulo: 'LAUDOS',
          admissao: adm, data_admissao: data,
          papel: 'MEDICO LAUDO', profissional: l.medico || '—',
          origem, convenio, descricao: l.exame || '',
          competencia, valor,
        });
      }
      out.sort((a, b) => b.valor - a.valor);
      console.log(`[relatorios] LAUDOS ${competencia}: ${out.length} laudos`);
      return { linhas: out };
    },

    // CROSSLINK: taxa fixa de equipamento (VALOR_FIXO por admissão), vinda do
    // QVIS (procedimento LIKE CROSSLINK, papel MEDICO/CIRURGIAO). Só admissões
    // de médicos IH (internos/híbridos). Profissional = proprietária (recebe).
    crosslink: function (competencia) {
      const c = {};
      try { (Banco.query('SELECT chave, valor FROM config_crosslink') || []).forEach(r => { c[r.chave] = r.valor; }); } catch (e) {}
      const valorFixo = parseFloat(c.VALOR_FIXO || '288.00') || 0;

      let prop = null;
      try {
        if (c.PROPRIETARIO_MEDICO_ID) prop = Banco.queryUnica(`SELECT nome_oficial FROM medicos WHERE id = ? AND ativo = 1`, [c.PROPRIETARIO_MEDICO_ID]);
        if (!prop) prop = Banco.queryUnica(`SELECT nome_oficial FROM medicos WHERE ativo = 1 AND UPPER(nome_oficial) LIKE '%MARIA%REGINA%CATAI%' LIMIT 1`);
      } catch (e) {}
      const nomeProp = (prop && prop.nome_oficial) || 'Proprietário do aparelho';

      // cadastro (nome_normalizado → vínculo) + sinônimos
      const cadMap = new Map();
      try {
        const porId = new Map();
        (Banco.query(`SELECT id, nome_oficial, nome_normalizado, tipo_vinculo FROM medicos WHERE ativo = 1`) || []).forEach(m => { cadMap.set((m.nome_oficial || '').toUpperCase().trim(), m); cadMap.set(m.nome_normalizado, m); porId.set(m.id, m); });
        try { (Banco.query(`SELECT s.grafia, s.grafia_normalizada, s.medico_id FROM sinonimos_medico s JOIN medicos m ON m.id = s.medico_id WHERE m.ativo = 1`) || []).forEach(s => { const med = porId.get(s.medico_id); if (med) { cadMap.set((s.grafia || '').toUpperCase().trim(), med); cadMap.set(s.grafia_normalizada, med); } }); } catch (e) {}
      } catch (e) {}

      let linhas = [];
      try {
        linhas = Banco.query(`
          SELECT admissao, data_admissao, procedimento, nome_normalizado,
                 origem, tipo_recebimento, convenio
            FROM linhas_qvis
           WHERE procedimento_normalizado LIKE '%CROSSLINK%'
             AND papel IN ('MEDICO', 'CIRURGIAO') AND mes_pagamento = ?
           ORDER BY data_admissao`, [competencia]) || [];
      } catch (e) { console.error('[relatorios] CROSSLINK:', e); return { erro: 'Erro ao ler Crosslink: ' + (e.message || e) }; }

      // agrupa por admissão (1 taxa por admissão)
      const admMap = new Map();
      for (const l of linhas) {
        const cod = String(l.admissao);
        if (!admMap.has(cod)) {
          const cad = cadMap.get(l.nome_normalizado);
          admMap.set(cod, { cod, data: l.data_admissao, procedimento: l.procedimento, origem: l.origem, tipo_receb: l.tipo_recebimento, convenio: l.convenio, tipo_vinculo: cad ? cad.tipo_vinculo : null });
        }
      }

      const out = [];
      for (const [cod, a] of admMap) {
        const tv = a.tipo_vinculo || 'EXTERNO';
        if (tv !== 'INTERNO' && tv !== 'HIBRIDO') continue;   // só IH
        if (valorFixo <= 0) continue;
        const oUp = String(a.origem || a.tipo_receb || '').toUpperCase();
        const origem = oUp.indexOf('PART') >= 0 ? 'PARTICULAR' : (oUp.indexOf('CONV') >= 0 ? 'CONVÊNIO' : (a.origem || ''));
        out.push({
          status: 'Desempenho', modulo: 'CROSSLINK',
          admissao: cod, data_admissao: a.data,
          papel: 'TAXA EQUIPAMENTO', profissional: nomeProp,
          origem, convenio: a.convenio || '', descricao: a.procedimento || '',
          competencia, valor: valorFixo,
        });
      }
      console.log(`[relatorios] CROSSLINK ${competencia}: ${out.length} admissões`);
      return { linhas: out };
    },

    // LUZ PULSADA: taxa percentual de equipamento. A proprietária recebe pct%
    // do produzido (convênio=recebido / particular=produzido) dos médicos que
    // usaram (só IH). Detalhado por admissão: Profissional = médico que usou;
    // Descrição = procedimento; Valor = pct% do produzido (o repasse DELA, não
    // o produzido — assim o total da aba = repasse total da proprietária).
    luz: function (competencia) {
      const c = {};
      try { (Banco.query('SELECT chave, valor FROM config_luz_pulsada') || []).forEach(r => { c[r.chave] = r.valor; }); } catch (e) {}
      const pct = parseFloat(c.PERCENTUAL_TAXA || '8.00') || 0;

      // cadastro (nome_normalizado → médico) + sinônimos
      const cadMap = new Map();
      try {
        const porId = new Map();
        (Banco.query(`SELECT id, nome_oficial, nome_normalizado, tipo_vinculo FROM medicos WHERE ativo = 1`) || []).forEach(m => { cadMap.set((m.nome_oficial || '').toUpperCase().trim(), m); cadMap.set(m.nome_normalizado, m); porId.set(m.id, m); });
        try { (Banco.query(`SELECT s.grafia, s.grafia_normalizada, s.medico_id FROM sinonimos_medico s JOIN medicos m ON m.id = s.medico_id WHERE m.ativo = 1`) || []).forEach(s => { const med = porId.get(s.medico_id); if (med) { cadMap.set((s.grafia || '').toUpperCase().trim(), med); cadMap.set(s.grafia_normalizada, med); } }); } catch (e) {}
      } catch (e) {}

      let linhas = [];
      try {
        linhas = Banco.query(`
          SELECT admissao, data_admissao, procedimento, nome_profissional, nome_normalizado,
                 origem, tipo_recebimento, convenio, produzido, recebido
            FROM linhas_qvis
           WHERE procedimento_normalizado LIKE '%LUZ PULSADA%'
             AND papel IN ('MEDICO', 'CIRURGIAO') AND mes_pagamento = ?
           ORDER BY data_admissao`, [competencia]) || [];
      } catch (e) { console.error('[relatorios] LUZ:', e); return { erro: 'Erro ao ler Luz Pulsada: ' + (e.message || e) }; }

      // Luz Pulsada é APENAS PARTICULAR. Base = produzido. 1ª linha define a admissão.
      const admMap = new Map();
      for (const l of linhas) {
        if (String(l.origem || '').toUpperCase() !== 'PARTICULAR') continue;  // só particular
        const cod = String(l.admissao);
        if (admMap.has(cod)) continue;
        const cad = cadMap.get(l.nome_normalizado);
        admMap.set(cod, {
          cod, data: l.data_admissao, procedimento: l.procedimento,
          nome: cad ? cad.nome_oficial : (l.nome_profissional || '—'),
          tipo_vinculo: cad ? cad.tipo_vinculo : null,
          convenio: l.convenio, base: Number(l.produzido) || 0,
        });
      }

      const out = [];
      for (const [cod, a] of admMap) {
        const tv = a.tipo_vinculo || 'EXTERNO';
        if (tv !== 'INTERNO' && tv !== 'HIBRIDO') continue;     // só IH (regra)
        const repasse = a.base * pct / 100;                     // % do produzido = repasse DELA
        if (repasse <= 0) continue;
        out.push({
          status: 'Desempenho', modulo: 'LUZ PULSADA',
          admissao: cod, data_admissao: a.data,
          papel: 'TAXA EQUIPAMENTO', profissional: a.nome,
          origem: 'PARTICULAR', convenio: a.convenio || '', descricao: a.procedimento || '',
          competencia, valor: repasse,
          produzido: a.base, _fichProd: true,   // V250: % do produzido (a.base) → mostra a base
        });
      }
      out.sort((a, b) => b.valor - a.valor);
      console.log(`[relatorios] LUZ ${competencia}: ${out.length} admissões particulares (repasse ${pct}%)`);
      return { linhas: out };
    },

    // V658: EXCEÇÃO · PRODUÇÃO — regras de exceção com extração via PRODUÇÃO.
    // O valor da regra é pago 1× POR ADMISSÃO encontrada nas linhas de produção
    // (executante = cirurgião/médico da linha; procedimento casa por grafia ou
    // sinônimo; fonte da linha casa com a fonte da regra ou TODAS). Percentual
    // aplica sobre a SOMA do produzido da admissão naquele procedimento.
    excecao_prod: function (competencia) {
      let regras = [];
      try {
        // V912: bancos antigos podem abrir Relatórios antes do Calcular (que faz a migração)
        try {
          const cols = Banco.query(`PRAGMA table_info(tabela_repasse_excecao)`) || [];
          if (cols.length > 0 && !cols.some(c => c.name === 'vigencia_inicio')) {
            Banco.executar(`ALTER TABLE tabela_repasse_excecao ADD COLUMN vigencia_inicio TEXT`);
            Banco.salvar();
          }
          if (cols.length > 0 && !cols.some(c => c.name === 'anular_demais')) {   // V919
            Banco.executar(`ALTER TABLE tabela_repasse_excecao ADD COLUMN anular_demais INTEGER DEFAULT 0`);
            Banco.salvar();
          }
        } catch (_) {}
        regras = Banco.query(`
          SELECT e.medico_id, e.procedimento_id, e.papel_id, e.fonte_pagadora, e.valor, e.percentual,
                 e.vigencia_inicio,
                 m.nome_oficial AS medico_nome, p.nome_oficial AS proc_nome,
                 pa.nome AS papel_nome
            FROM tabela_repasse_excecao e
            JOIN medicos m        ON m.id  = e.medico_id
            JOIN procedimentos p  ON p.id  = e.procedimento_id
            LEFT JOIN papeis pa   ON pa.id = e.papel_id
           WHERE e.ativo = 1 AND UPPER(COALESCE(e.extracao, 'QVIS')) = 'PRODUCAO'`) || [];
      } catch (e) { return { linhas: [] }; }
      if (!regras.length) return { linhas: [] };

      // regras por (médico|proc|fonte) → lista (uma por papel)
      const mapRegras = new Map();
      for (const r of regras) {
        const k = `${r.medico_id}|${r.procedimento_id}|${String(r.fonte_pagadora || 'TODAS').toUpperCase()}`;
        if (!mapRegras.has(k)) mapRegras.set(k, []);
        mapRegras.get(k).push(r);
      }
      // nomes → médico (cadastro + sinônimos) e grafia → procedimento (cadastro + sinônimos)
      const nomeId = new Map();
      try {
        (Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM medicos`) || []).forEach(m => {
          nomeId.set(String(m.nome_oficial || '').toUpperCase().trim(), m.id);
          nomeId.set(m.nome_normalizado, m.id);
        });
        (Banco.query(`SELECT grafia, grafia_normalizada, medico_id FROM sinonimos_medico`) || []).forEach(s => {
          nomeId.set(String(s.grafia || '').toUpperCase().trim(), s.medico_id);
          nomeId.set(s.grafia_normalizada, s.medico_id);
        });
      } catch (e) {}
      const procPorGrafia = new Map();
      try {
        (Banco.query(`SELECT id, nome_normalizado FROM procedimentos`) || []).forEach(p => procPorGrafia.set(p.nome_normalizado, p.id));
        (Banco.query(`SELECT grafia_normalizada, procedimento_id FROM sinonimos_proc`) || []).forEach(s => {
          if (!procPorGrafia.has(s.grafia_normalizada)) procPorGrafia.set(s.grafia_normalizada, s.procedimento_id);
        });
      } catch (e) {}

      let linhas = [];
      try {
        linhas = Banco.query(`
          SELECT cod_admissao, COALESCE(data_admissao,'') AS data_admissao, COALESCE(produto,'') AS produto,
                 COALESCE(convenio,'') AS convenio, COALESCE(tipo_recebimento,'') AS tipo_recebimento,
                 COALESCE(valor,0) AS valor, COALESCE(cirurgiao,'') AS cirurgiao, COALESCE(medico,'') AS medico
            FROM linhas_producao WHERE competencia = ?`, [competencia]) || [];
      } catch (e) { return { linhas: [] }; }

      // agrupa por admissão+médico+proc+regra (paga 1× por admissão)
      const grupos = new Map();
      for (const l of linhas) {
        const execNome = String(l.cirurgiao || l.medico || '').trim();
        if (!execNome) continue;
        const medId = nomeId.get(execNome.toUpperCase()) ?? nomeId.get(Utilidades.normalizar(execNome));
        if (medId == null) continue;
        const procId = procPorGrafia.get(Utilidades.normalizar(String(l.produto || '')));
        if (procId == null) continue;
        // V913: casamento tolerante — "CONVÊNIO 30%", "SUS AMB." etc. contam pela
        // fonte que começa igual; um tipo desconhecido ainda casa com regra TODAS.
        const tr = Utilidades.normalizar(String(l.tipo_recebimento || ''));
        const fonteN = tr.startsWith('CONVENIO') ? 'CONVENIO'
          : tr.startsWith('PARTICULAR') ? 'PARTICULAR'
          : tr.startsWith('SUS') ? 'SUS' : null;
        const lista = (fonteN && mapRegras.get(`${medId}|${procId}|${fonteN}`))
          || mapRegras.get(`${medId}|${procId}|TODAS`);
        if (!lista) continue;
        for (const regra of lista) {
          // V912: vigência — só admissões com data >= vigencia_inicio entram
          if (regra.vigencia_inicio) {
            const dAdm = isoDataAdmRel(l.data_admissao);
            if (!dAdm || dAdm < regra.vigencia_inicio) continue;
          }
          const k = `${String(l.cod_admissao || '').trim()}|${medId}|${procId}|${regra.papel_id}|${String(regra.fonte_pagadora || 'TODAS').toUpperCase()}`;
          if (!grupos.has(k)) grupos.set(k, { regra, adm: l.cod_admissao, data: l.data_admissao, conv: l.convenio, fonteN, produto: l.produto, soma: 0 });
          grupos.get(k).soma += Number(l.valor) || 0;
        }
      }

      const out = [];
      for (const g of grupos.values()) {
        const v = g.regra.valor != null
          ? (Number(g.regra.valor) || 0)
          : (Number(g.regra.percentual) || 0) * g.soma;
        if (v <= 0) continue;
        out.push({
          status: 'Desempenho', modulo: 'EXCEÇÃO · PRODUÇÃO',
          admissao: g.adm, data_admissao: g.data,
          papel: g.regra.papel_nome || 'EXECUTANTE', profissional: g.regra.medico_nome,
          origem: g.fonteN === 'CONVENIO' ? 'CONVÊNIO' : (g.fonteN || 'OUTRO'), convenio: g.conv || '',
          descricao: g.regra.proc_nome || g.produto || '',
          competencia, valor: v,
        });
      }
      out.sort((a, b) => b.valor - a.valor);
      console.log(`[relatorios] EXCEÇÃO·PRODUÇÃO ${competencia}: ${out.length} admissões`);
      return { linhas: out };
    },
  };

  // V658: bloqueios de desempenho (médico × módulo, cadastrados no fichário de
  // Exceções do Calcular) — módulo → Set(medico_id) + resolvedor nome → id.
  let _bloqCache = null, _bloqCacheV = -1;
  function _bloqueiosDesempenho() {
    const v = (typeof Banco !== 'undefined' && Banco._versao) || 0;
    if (_bloqCache && _bloqCacheV === v) return _bloqCache;
    const porMod = new Map(), nomeId = new Map();
    try {
      const rows = Banco.query(`SELECT medico_id, modulo FROM excecao_desempenho_bloqueio WHERE ativo = 1`) || [];
      for (const r of rows) {
        const mod = String(r.modulo);
        if (!porMod.has(mod)) porMod.set(mod, new Set());
        porMod.get(mod).add(r.medico_id);
      }
      if (porMod.size) {
        (Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM medicos`) || []).forEach(m => {
          nomeId.set(String(m.nome_oficial || '').toUpperCase().trim(), m.id);
          nomeId.set(m.nome_normalizado, m.id);
        });
        try {
          (Banco.query(`SELECT grafia, grafia_normalizada, medico_id FROM sinonimos_medico`) || []).forEach(s => {
            nomeId.set(String(s.grafia || '').toUpperCase().trim(), s.medico_id);
            nomeId.set(s.grafia_normalizada, s.medico_id);
          });
        } catch (e) {}
      }
    } catch (e) { /* tabela pode não existir ainda (nasce na tela Calcular) */ }
    _bloqCache = { porMod, nomeId }; _bloqCacheV = v;
    return _bloqCache;
  }

  function resultadoDesempenho(fichId) {
    const fn = ADAPTADORES[fichId];
    if (!fn) return null;          // ainda não ativado → placeholder
    // V672: Banco._versao na chave — o montar() só limpa o cache quando a TELA
    // de Relatórios abre, mas a Produção Médica chama desempenhoLinhas() direto;
    // sem o carimbo, regra/bloqueio novo não aparecia lá até visitar Relatórios.
    const key = `${fichId}|${state.competencia}|${Banco._versao || 0}`;
    if (_cacheDes.has(key)) return _cacheDes.get(key);
    if (_cacheDes.size > 240) _cacheDes = new Map();
    let r = fn(state.competencia);
    // V658: médico bloqueado neste módulo → linhas dele ficam ZERADAS (com tag),
    // valendo pra tela do fichário, pro consolidado e pra Produção Médica.
    try {
      if (r && r.linhas && r.linhas.length) {
        const { porMod, nomeId } = _bloqueiosDesempenho();
        const bloq = porMod.get(fichId);
        if (bloq && bloq.size) {
          r = Object.assign({}, r, {
            linhas: r.linhas.map(l => {
              const nome = String(l.profissional || '');
              const id = nomeId.get(nome.toUpperCase().trim()) ?? nomeId.get(Utilidades.normalizar(nome));
              if (id != null && bloq.has(id) && (Number(l.valor) || 0) !== 0) {
                return Object.assign({}, l, {
                  valor: 0, _bloqueadoExc: true,
                  descricao: ((l.descricao || '') + ' · bloqueado por exceção').trim(),
                });
              }
              return l;
            }),
          });
        }
      }
    } catch (e) {}
    _cacheDes.set(key, r);
    return r;
  }

  // ── API PÚBLICA: desempenho consolidado (reuso pelo módulo Produção Médica) ──
  // Retorna as linhas dos 12 fichários de Desempenho de uma competência, no
  // formato padrão { modulo, profissional, valor }. Reaproveita os ADAPTADORES.
  function desempenhoLinhas(comp) {
    const prev = state.competencia;
    state.competencia = comp;
    const out = [];
    try {
      for (const f of FICHARIOS_DESEMPENHO) {
        let r = null;
        try { r = resultadoDesempenho(f.id); } catch (e) { r = null; }
        const linhas = (r && r.linhas) ? r.linhas : [];
        for (const l of linhas) {
          out.push(Object.assign({}, l, { modulo: l.modulo || f.nome, profissional: l.profissional || '—', valor: Number(l.valor) || 0 }));
        }
      }
    } finally { state.competencia = prev; }
    return out;
  }
  window.AtlasRelatorios = Object.assign(window.AtlasRelatorios || {}, { desempenhoLinhas });

  // ── RENDER ──────────────────────────────────────────────────────────────
  // V597: os caches só são zerados quando o BANCO mudou desde a última visita
  // (Banco._versao carimba toda gravação). Antes, TODA entrada na tela jogava
  // fora matriz + consolidado + adaptadores e re-auditava o mês inteiro do
  // zero mesmo sem nenhuma alteração — a "demora" ao abrir Relatórios.
  let _montarVersao = -1;
  function montar() {
    const v = Banco._versao || 0;
    if (_montarVersao !== v) {
      _cacheRep = { comp: null, linhas: null };   // frescor: banco mudou
      _consCache = { comp: null, linhas: null };
      for (const k in _consCacheVG) delete _consCacheVG[k];
      _cadExport = null;
      _ihSet = null;
      _pacMap = null;
      _cacheDes = new Map();
      _montarVersao = v;
    }
    const comps = competencias();
    if (!state.competencia || !comps.includes(state.competencia)) {
      state.competencia = comps.length ? comps[0] : null;
    }
    renderizar();
  }

  function renderizar() {
    const conteudo = document.getElementById('conteudo');
    if (!conteudo) return;
    const comps = competencias();
    const optsComp = comps.length
      ? comps.map(c => `<option value="${esc(c)}" ${state.competencia === c ? 'selected' : ''}>${esc(c)}</option>`).join('')
      : '<option value="">— sem cálculos salvos —</option>';

    // V599: "Mês a mês" saiu das abas — virou botão no topo (visão ampliada)
    // V775: "Exceção · Produção" NÃO tem fichário próprio — ela é um desvio de
    // rota do repasse (a linha do QVIS é zerada e o valor sai pela Produção),
    // então entra no CONSOLIDADO junto com o resto, sem coluna dedicada.
    const abas = [{ id: 'consolidado', nome: 'Σ Consolidado' }, { id: 'repasse', nome: '▦ Relatório Repasse' }]
      .concat(FICHARIOS_DESEMPENHO
        .filter(f => !SEM_FICHARIO_PROPRIO.has(f.id))
        .map(f => ({ id: f.id, nome: f.nome })));

    // V132.45: a CASCA (header + abas + seletor) renderiza na hora; o conteúdo
    // pesado (matriz/adaptadores) é calculado logo em seguida, sem travar a abertura.
    // V492: CSS injetado 1x no <head> (antes: <style> re-parseado a cada render)
    Utilidades.garantirEstilos('css-tela-relatorios', CSS);
    conteudo.innerHTML = `
      <div class="rel-tela">
        <header class="rel-header">
          <div class="rel-header-titulo">
            <h2>Relatórios</h2>
            <p>Resultado consolidado do mês selecionado. O <strong>Relatório Repasse</strong> traz a matriz da Auditoria; os demais fichários trazem o repasse de cada módulo de Desempenho.</p>
          </div>
          <div class="rel-topo-acoes">
            <div class="rel-comp-wrap">
              <label class="rel-label" for="rel-competencia">Mês</label>
              <select id="rel-competencia" class="rel-select">${optsComp}</select>
            </div>
            <button type="button" class="rel-btn-exportar rel-btn-mesames" id="rel-abrir-mesames" title="Matriz mês a mês do repasse por médico (visão ampliada)">⇆ Mês a mês</button><!-- V599 -->
            <button type="button" class="rel-btn-exportar" id="rel-abrir-export" title="Exportar relatório">↓ Exportar relatório</button>
            <button type="button" class="rel-btn-exportar" id="rel-export-filtrado" title="Extração rápida da matriz do Consolidado EXATAMENTE como está filtrada na tela (colunas marcadas + 'contém')">⇩ Extração filtrada</button><!-- V902 -->
            <button type="button" class="rel-btn-exportar" id="rel-abrir-check" title="Check de regra — preencha uma linha (formato da matriz) e veja qual versão da tabela e qual regra se aplicam">🧪 Check de regra</button><!-- V642 -->
            <button type="button" class="rel-btn-exportar" id="rel-abrir-inspecao" title="Inspeção da admissão — rastreia uma admissão pelo QVIS, pelo Consolidado e pela Produção e diz onde ela parou">🔎 Inspeção</button><!-- V943: de volta, sem cofre -->
          </div>
        </header>

        <div class="rel-fichas">
          ${abas.map(a => `
            <button class="rel-ficha ${state.fichario === a.id ? 'ativa' : ''} ${a.id === 'repasse' ? 'rel-ficha-repasse' : ''}"
                    data-ficha="${a.id}">${esc(a.nome)}</button>
          `).join('')}
        </div>

        <div class="rel-conteudo" id="rel-conteudo">
          <div class="rel-loading"><div class="atlas-loader"></div></div>
        </div>
        <div id="rel-modal-container"></div>
      </div>
    `;

    bindCasca();
    Utilidades.staggerEntrada?.('.rel-header, .rel-fichas', { delay: 50, duracao: 320, deslocamento: 12 });
    // calcula o conteúdo fora do caminho de abertura
    setTimeout(renderConteudo, 16);
  }

  function renderConteudo() {
    const alvo = document.getElementById('rel-conteudo');
    if (!alvo) return;
    alvo.innerHTML = state.fichario === 'repasse' ? renderRepasse()
      : state.fichario === 'consolidado' ? renderConsolidado()
      : renderDesempenho();
    bindConteudo();
  }

  function renderRepasse() {
    if (!state.competencia) {
      return msgVazia('Nenhum cálculo salvo', 'Rode o <strong>Cálculo de Repasse</strong> e salve um snapshot para ver o relatório.');
    }
    const linhas = matrizRepasse();
    if (!linhas.length) {
      return msgVazia('Sem dados', `Não há matriz auditada para <strong>${esc(state.competencia)}</strong>.`);
    }
    const LIMITE = 800;
    const total = linhas.reduce((s, l) => s + (Number(l._repasse) || 0), 0);
    const exibidas = linhas.slice(0, LIMITE);
    const espMap = mapaEspecialidades();   // V500.1: mapa global admissão → especialidade

    const linhasHtml = exibidas.map(l => {
      const st = statusInfo(l);
      const repasse = (l._status === 'casou' || l._ehPacoteDetalhe || l._ehAuditoria)
        ? `R$ ${fmt(l._repasse)}`
        : (l._status === 'glosa' ? `<span class="rel-glosa">R$ 0,00</span>` : '—');
      return `
        <tr>
          <td><span class="rel-tag ${st.cls}">${st.label}</span></td>
          <td>Repasse</td>
          <td class="rel-mono">${esc(l.admissao)}</td>
          <td class="rel-mono rel-data">${l.data_admissao ? esc(fmtDataAdm(l.data_admissao)) : '—'}</td>
          <td>${esc(l._papelCanon || l.papel || '—')}</td>
          <td>${esc(CodigoMedico.exibir(l.nome_profissional || '—'))}</td>
          <td>${esc(l.paciente || pacientePorAdmissao(l.admissao))}</td>
          <td>${fonteBadge(l.origem, l.convenio)}</td>
          <td>${esc(convenioComPerfil(l))}</td>
          <td class="rel-proc">${esc(l.procedimento || '—')}</td>
          <td>${esc(especialidadeDe(espMap, l.admissao, l.procedimento))}</td><!-- V503: Especialidade (Produção, produto predomina) -->
          <td class="rel-num${/^R\$/.test(repasse) ? ' atlas-rep' : ''}">${repasse}</td><!-- V962: valor de repasse em #46688c -->
        </tr>`;
    }).join('');

    return `
      <div class="rel-barra">
        <div class="rel-resumo">
          <div class="rel-kpi"><div class="rel-kpi-lbl">Repasse total</div><div class="rel-kpi-val rel-kpi-verde">R$ ${fmt(total)}</div></div>
        </div>
        <button class="rel-btn-excel" id="rel-export">↓ Exportar Excel</button>
      </div>
      <div class="rel-tab-wrap">
        <table class="rel-tab">
          <thead>
            <tr>
              <th>Status</th><th>Módulo</th><th>Admissão</th><th>Data</th><th>Papel</th><th>Profissional</th>
              <th>Paciente</th><th>Origem</th><th>Convênio</th><th>Descrição</th><th>Especialidade</th><th class="rel-num">Valor repasse</th><!-- V500: coluna Especialidade -->
            </tr>
          </thead>
          <tbody>${linhasHtml}</tbody>
        </table>
      </div>
      ${linhas.length > LIMITE ? `<div class="rel-trunc">Exibindo ${LIMITE} de ${linhas.length.toLocaleString('pt-BR')} linhas. A exportação inclui todas.</div>` : ''}
    `;
  }

  // ════════════════════════════════════════════════════════════════════════
  // V594: ABA "MÊS A MÊS" — consolidado por médico, comparativo por competência
  // Modelo do arquivo CONSOLIDADO do usuário (aba TOTAIS): NOME 1 | NOME 2 |
  // REPASSE <MÊS>… — SEM coluna TOTAL (pedido), linha CORPO CLÍNICO no topo
  // com o total geral de cada mês. Números: MESMA fonte do consolidado
  // (linhasConsolidadoComp) agrupada por profissional; 'Refractive Laser'
  // conta como linha própria (mesma convenção do export por médico).
  // Performance: foto persistente por mês ('cmpMedTot', esquema V589/V591) —
  // reabrir pinta das fotos; só o mês com dado alterado recalcula.
  // ════════════════════════════════════════════════════════════════════════
  const MM_MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
                    'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
  let _mmGen = 0;
  // V599: esteira automática — TODAS as competências, sem filtro de período
  function mmComps() { return competencias().slice().sort(); }
  function mmRotulo(comp, multiAno) {
    // V599: só o nome do mês (sem "REPASSE"); o ANO vai acima, no cabeçalho
    const m = MM_MESES[(+comp.slice(5, 7)) - 1] || comp;
    return m + (multiAno ? '/' + comp.slice(2, 4) : '');
  }
  // V599: KPI Last Month — variação % da célula vs o mês ANTERIOR da esteira
  function mmBadgeLM(atual, anterior) {
    if (!(anterior > 0) || atual == null) return '';
    const pct = ((atual - anterior) / anterior) * 100;
    const up = pct >= 0;
    return `<span class="mm-lm ${up ? 'mm-lm-up' : 'mm-lm-down'}">${up ? '↑' : '↓'} ${Math.abs(pct).toFixed(1).replace('.', ',')}%</span>`;
  }
  // total consolidado por médico de UMA competência (com foto persistente)
  function mmTotaisPorMedico(comp) {
    try {
      const foto = (window.VGExec && VGExec._fotoLer) ? VGExec._fotoLer('cmpMedTot', comp) : null;
      if (foto) return new Map(foto);
    } catch (_) {}
    const linhas = linhasConsolidadoComp(comp) || [];
    const m = new Map();
    for (const l of linhas) {
      const med = (l.modulo === 'Refractive Laser') ? 'Refractive Laser' : String(l.profissional || '').trim();
      if (!med || med === '—') continue;
      m.set(med, (m.get(med) || 0) + (Number(l.valor) || 0));
    }
    try { if (linhas.length && window.VGExec && VGExec._fotoGravar) VGExec._fotoGravar('cmpMedTot', comp, [...m]); } catch (_) {}
    return m;
  }
  // V599: visão AMPLIADA em overlay (aberta pelo botão "⇆ Mês a mês" do topo)
  function abrirMesAMes() {
    if (document.getElementById('mmov')) return;
    const ov = document.createElement('div');
    ov.className = 'mmov-ov';
    ov.id = 'mmov';
    ov.innerHTML = `
      <div class="mmov-painel" role="dialog" aria-modal="true">
        <div class="mmov-head">
          <div>
            <div class="mmov-titulo">⇆ Mês a mês — repasse por médico</div>
            <div class="mmov-sub">Consolidado por competência · esteira automática com todos os meses · LM = variação vs mês anterior</div>
          </div>
          <div class="mmov-acoes">
            <label class="mmov-ord">Ordenar
              <select id="mm-ordem" class="rel-select">
                <option value="az" ${(window.__mmOrdem || 'az') === 'az' ? 'selected' : ''}>A → Z</option>
                <option value="maior" ${window.__mmOrdem === 'maior' ? 'selected' : ''}>Maior valor</option>
                <option value="menor" ${window.__mmOrdem === 'menor' ? 'selected' : ''}>Menor valor</option>
              </select>
            </label><!-- V608 -->
            <button type="button" class="rel-btn-excel" id="mm-export">↓ Exportar Excel</button>
            <button type="button" class="mmov-x" id="mmov-fechar" title="Fechar">×</button>
          </div>
        </div>
        <div class="mmov-corpo" id="mm-corpo">
          <div class="rel-loading"><div class="atlas-loader"></div>
            <div id="mm-prog" style="margin-top: 10px; font-size: 12px; color: #7a8079">calculando…</div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const fechar = () => { document.removeEventListener('keydown', onKey); _mmGen++; ov.remove(); };
    function onKey(e) { if (e.key === 'Escape') fechar(); }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    ov.querySelector('#mmov-fechar').addEventListener('click', fechar);
    ov.querySelector('#mm-export').addEventListener('click', async () => { if (await avisarLembretes()) exportarMesAMes(); });
    // V608: ordenação A→Z / Maior / Menor (re-render instantâneo — vem das fotos)
    ov.querySelector('#mm-ordem').addEventListener('change', (e) => {
      window.__mmOrdem = e.target.value;
      mmPreencher();
    });
    mmPreencher();
  }
  async function mmPreencher() {
    const gen = ++_mmGen;
    const comps = mmComps();
    const corpo = document.getElementById('mm-corpo');
    if (!corpo) return;
    if (!comps.length) {
      corpo.innerHTML = msgVazia('Sem competências', 'Importe dados (QVIS/Produção) para montar a matriz por médico.');
      return;
    }
    // mês a mês, cedendo a thread — meses fotografados voltam instantâneos
    const porComp = new Map();
    for (let i = 0; i < comps.length; i++) {
      const p = document.getElementById('mm-prog');
      if (p) p.textContent = `calculando ${comps[i]} (${i + 1}/${comps.length})…`;
      if (Utilidades.aguardarPintura) await Utilidades.aguardarPintura();
      if (gen !== _mmGen) return;                        // fechou a visão no meio
      porComp.set(comps[i], mmTotaisPorMedico(comps[i]));
    }
    if (gen !== _mmGen) return;
    const meds = new Set();
    for (const m of porComp.values()) for (const k of m.keys()) meds.add(k);
    // V608: ordenação — A→Z (padrão) ou por TOTAL do período (maior/menor)
    const totLinhaDe = (n) => comps.reduce((s, c) => s + (Number(porComp.get(c).get(n)) || 0), 0);
    const ordem = window.__mmOrdem || 'az';
    const nomes = [...meds].sort((a, b) =>
      ordem === 'maior' ? (totLinhaDe(b) - totLinhaDe(a) || a.localeCompare(b, 'pt-BR'))
      : ordem === 'menor' ? (totLinhaDe(a) - totLinhaDe(b) || a.localeCompare(b, 'pt-BR'))
      : a.localeCompare(b, 'pt-BR'));
    const multiAno = new Set(comps.map(c => c.slice(0, 4))).size > 1;
    const totais = comps.map(c => { let s = 0; for (const v of porComp.get(c).values()) s += v; return s; });
    if (!nomes.length) {
      corpo.innerHTML = msgVazia('Sem dados', 'Nenhum médico com repasse consolidado nas competências disponíveis.');
      return;
    }
    // V595: TOTAL (soma dos meses) no final · V599: LM em cada célula
    // V608: TODA célula de valor reserva a linha do LM (mesmo sem %) — os
    // valores ficam alinhados na mesma altura em todas as colunas
    const celVal = (conteudo, badge, extraCls) => `
      <td class="rel-num${extraCls ? ' ' + extraCls : ''}"><span class="mm-val">${conteudo}</span>${badge || '<span class="mm-lm mm-lm-vazio">&nbsp;</span>'}</td>`;
    const thVal = (conteudo, badge) => `
      <th class="rel-num"><span class="mm-val">${conteudo}</span>${badge || '<span class="mm-lm mm-lm-vazio">&nbsp;</span>'}</th>`;
    const totalGeral = totais.reduce((s, v) => s + v, 0);
    const linhas = nomes.map(n => {
      const vals = comps.map(c => Number(porComp.get(c).get(n)) || 0);
      const totLinha = vals.reduce((s, v) => s + v, 0);
      return `
      <tr>
        <td class="mm-fixo">${esc(n)}</td>
        ${vals.map((v, i) => celVal(v ? 'R$ ' + fmt(v) : '—', i > 0 ? mmBadgeLM(v, vals[i - 1]) : '')).join('')}
        ${celVal('R$ ' + fmt(totLinha), '', 'mm-total')}
      </tr>`;
    }).join('');
    corpo.innerHTML = `
      <div class="rel-tab-wrap mm-scroll mmov-scroll">
        <table class="rel-tab">
          <thead>
            <tr class="mm-cc">
              <th class="mm-fixo">TOTAL GERAL</th>
              ${comps.map((c, i) => thVal('R$ ' + fmt(totais[i]), i > 0 ? mmBadgeLM(totais[i], totais[i - 1]) : '')).join('')}
              ${thVal('R$ ' + fmt(totalGeral), '')}
            </tr>
            <tr>
              <th class="mm-fixo">Corpo Clínico</th>
              ${comps.map(c => `<th class="rel-num"><span class="mm-th-ano">${esc(c.slice(0, 4))}</span><span class="mm-th-mes">${esc(mmRotulo(c, multiAno))}</span></th>`).join('')}
              <th class="rel-num"><span class="mm-th-ano">&nbsp;</span><span class="mm-th-mes">TOTAL</span></th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
      <div class="rel-trunc">${nomes.length} médicos · ${comps.length} competências · repasse do consolidado (mesma fonte da aba Σ Consolidado) · LM = variação vs mês anterior</div>`;
    // esteira abre na ponta mais recente
    const sc = corpo.querySelector('.mm-scroll');
    if (sc) sc.scrollLeft = sc.scrollWidth;
  }
  // linhas COMPLETAS (todas as colunas) de uma competência — p/ a aba "Repasse" do export
  function mmLinhasCompletas(comp) {
    const compAnt = state.competencia, cacheAnt = _consCache;
    try {
      state.competencia = comp;
      _consCache = { comp: null, linhas: null };
      return coletarLinhas(null, null) || [];
    } finally { state.competencia = compAnt; _consCache = cacheAnt; }
  }
  async function exportarMesAMes() {
    if (typeof ExcelJS === 'undefined') { Utilidades.toast?.('Biblioteca ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return; }
    const comps = mmComps();   // V599: todas as competências da esteira
    if (!comps.length) { Utilidades.toast?.('Sem competências para exportar.', 'error', 3500); return; }
    Utilidades.toast?.('Gerando Excel…', 'info', 2200);
    try {
      const porComp = new Map();
      for (const c of comps) {
        porComp.set(c, mmTotaisPorMedico(c));
        if (Utilidades.aguardarPintura) await Utilidades.aguardarPintura();
      }
      const meds = new Set();
      for (const m of porComp.values()) for (const k of m.keys()) meds.add(k);
      const nomes = [...meds].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const multiAno = new Set(comps.map(c => c.slice(0, 4))).size > 1;
      const compFim = comps[comps.length - 1];
      // aba "Repasse": detalhamento completo da ÚLTIMA competência do período
      // (usa o MODELO importado, se houver — mesmo caminho do export normal)
      const detalhe = mmLinhasCompletas(compFim);
      const wb = await wbDeLinhas(detalhe, 'Repasse');
      // aba "TOTAIS": comparativo por médico — SEM coluna TOTAL (pedido do usuário)
      const jaTem = wb.getWorksheet('TOTAIS');
      if (jaTem) wb.removeWorksheet(jaTem.id);
      // V595: UMA coluna de nome + coluna TOTAL (soma dos meses) no final
      const ws = wb.addWorksheet('TOTAIS', { views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }] });
      const totaisMes = comps.map(c => { let s = 0; for (const v of porComp.get(c).values()) s += v; return s; });
      // V599: linha do ANO acima do mês; coluna do médico = "CORPO CLÍNICO"
      ws.addRow(['', ...comps.map(c => c.slice(0, 4)), '']);
      ws.addRow(['TOTAL GERAL', ...totaisMes, totaisMes.reduce((s, v) => s + v, 0)]);
      ws.addRow(['CORPO CLÍNICO', ...comps.map(c => mmRotulo(c, multiAno)), 'TOTAL']);
      for (const n of nomes) {
        const vals = comps.map(c => Number(porComp.get(c).get(n) || 0));
        ws.addRow([n, ...vals, vals.reduce((s, v) => s + v, 0)]);
      }
      ws.getColumn(1).width = 44;
      for (let i = 0; i < comps.length + 1; i++) { const col = ws.getColumn(2 + i); col.width = 20; }
      // R$ só nas linhas de valores (a linha 1 é o ANO)
      for (let r = 2; r <= ws.rowCount; r++) {
        if (r === 3) continue;   // linha dos nomes de mês
        for (let ci = 2; ci <= comps.length + 2; ci++) ws.getRow(r).getCell(ci).numFmt = 'R$ #,##0.00';
      }
      uniformizarFonte(ws, 'Calibri', 12);
      ws.getRow(1).eachCell((c) => { c.font = { ...(c.font || {}), bold: true }; });
      ws.getRow(2).eachCell((c) => { c.font = { ...(c.font || {}), bold: true }; });
      ws.getRow(3).eachCell((c) => { c.font = { ...(c.font || {}), bold: true }; });
      await baixarWb(wb, `consolidado_mes_a_mes_${comps[0]}_a_${comps[comps.length - 1]}`);
      Utilidades.toast?.(`✓ Exportado: ${nomes.length} médicos × ${comps.length} competências (abas Repasse + TOTAIS).`, 'success', 5200);
    } catch (e) {
      console.error('[relatorios] exportarMesAMes:', e);
      Utilidades.toast?.('Erro ao gerar Excel: ' + (e.message || e), 'error', 4500);
    }
  }

  function renderDesempenho() {
    const fich = FICHARIOS_DESEMPENHO.find(f => f.id === state.fichario);
    const nome = fich ? fich.nome : state.fichario;

    const res = resultadoDesempenho(state.fichario);
    if (!res) {
      // módulo ainda não ativado
      return `
        <div class="rel-placeholder">
          <div class="rel-placeholder-ico">⊿</div>
          <h3>${esc(nome)}</h3>
          <p>Este fichário vai trazer o resultado de repasse do módulo <strong>${esc(nome)}</strong> no formato <strong>Módulo · Papel · Profissional · Competência · Valor</strong>, para o mês selecionado.</p>
          <p class="rel-muted">Em ativação — será ligado em seguida, com validação dos valores contra a tela original do módulo.</p>
        </div>`;
    }
    if (res.erro) {
      return msgVazia(nome, esc(res.erro));
    }
    if (!state.competencia) {
      return msgVazia(nome, 'Selecione um mês no topo.');
    }
    const linhas = res.linhas || [];
    if (!linhas.length) {
      return msgVazia(nome, `Sem resultado de <strong>${esc(nome)}</strong> em <strong>${esc(state.competencia)}</strong>.`);
    }

    const LIMITE = 800;
    const total = linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);
    const exibidas = linhas.slice(0, LIMITE);
    if (window.AtlasMemoria) AtlasMemoria.novaLeva('rel-fich');   // V996
    const linhasHtml = exibidas.map(l => {
      const origemBadge = l.origem ? Utilidades.badgeFonte(l.origem) : '';   // V947: tag padrão (SUS agora aparece)
      const statusLbl = l.status || 'Desempenho';
      return `
        <tr>
          <td><span class="rel-tag rel-tag-desemp">${esc(statusLbl)}</span></td>
          <td>${esc(l.modulo)}</td>
          <td class="rel-mono">${esc(l.admissao || '—')}</td>
          <td class="rel-mono rel-data">${l.data_admissao ? esc(fmtDataAdm(l.data_admissao)) : '—'}</td>
          <td><span class="rel-tag rel-tag-papel">${esc(l.papel)}</span></td>
          <td>${esc(CodigoMedico.exibir(l.profissional || '—'))}</td>
          <td>${esc(l.paciente || pacientePorAdmissao(l.admissao))}</td>
          <td>${origemBadge}</td>
          <td>${esc(l.convenio || '')}</td>
          <td class="rel-desc">${esc(l.descricao || '')}</td>
          <td class="rel-num${(Number(l.valor) || 0) === 0 ? '' : ' atlas-rep'}"${window.AtlasMemoria ? AtlasMemoria.ref('rel-fich', l, 'consolidado') : ''} title="Passe o mouse: memória de cálculo · clique fixa">${(Number(l.valor) || 0) === 0 ? '<span class="rel-zero">R$ 0,00</span>' : 'R$ ' + fmt(l.valor)}</td><!-- V962 · V996: memória -->
        </tr>`;
    }).join('');

    return `
      <div class="rel-barra">
        <div class="rel-resumo">
          <div class="rel-kpi"><div class="rel-kpi-lbl">Valor total</div><div class="rel-kpi-val rel-kpi-verde">R$ ${fmt(total)}</div></div>
        </div>
        <button class="rel-btn-excel" id="rel-export-desemp">↓ Exportar Excel</button>
      </div>
      <div class="rel-tab-wrap">
        <table class="rel-tab">
          <thead>
            <tr><th>Status</th><th>Módulo</th><th>Admissão</th><th>Data</th><th>Papel</th><th>Profissional</th><th>Paciente</th><th>Origem</th><th>Convênio</th><th>Descrição</th><th class="rel-num">Valor repasse</th></tr>
          </thead>
          <tbody>${linhasHtml}</tbody>
        </table>
      </div>
      ${linhas.length > LIMITE ? `<div class="rel-trunc">Exibindo ${LIMITE} de ${linhas.length.toLocaleString('pt-BR')} linhas. A exportação inclui todas.</div>` : ''}
    `;
  }

  async function exportarExcelDesemp() {
    Utilidades.toast?.('Gerando Excel…', 'info', 2000);
    await new Promise(r => setTimeout(r, 80));   // V601: fecha o aviso/pinta o toast antes do trabalho pesado
    if (typeof ExcelJS === 'undefined') {
      Utilidades.toast?.('Biblioteca ExcelJS não carregada. Recarregue a página (Ctrl+Shift+R).', 'error', 4500);
      return;
    }
    const res = resultadoDesempenho(state.fichario);
    const linhas = (res && res.linhas) || [];
    if (!linhas.length) { Utilidades.toast?.('Nada para exportar.', 'error', 3500); return; }
    const fich = FICHARIOS_DESEMPENHO.find(f => f.id === state.fichario);
    const nome = fich ? fich.nome : state.fichario;
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(`${nome} ${state.competencia}`.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = [
        { header: 'Status', key: 'status', width: 13 },
        { header: 'Módulo', key: 'modulo', width: 14 },
        { header: 'Admissão', key: 'admissao', width: 14 },
        { header: 'Data', key: 'data', width: 12 },
        { header: 'Papel', key: 'papel', width: 14 },
        { header: 'Profissional', key: 'prof', width: 32 },
        { header: 'Paciente', key: 'paciente', width: 30 },
        { header: 'Origem', key: 'origem', width: 13 },
        { header: 'Convênio', key: 'convenio', width: 22 },
        { header: 'Descrição', key: 'descricao', width: 26 },
        { header: 'Valor repasse', key: 'valor', width: 16 },
      ];
      const head = ws.getRow(1);
      head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A34' } };
      for (const l of linhas) {
        const row = ws.addRow({ status: l.status || 'Desempenho', modulo: l.modulo, admissao: l.admissao || '',
                                data: l.data_admissao ? fmtDataAdm(l.data_admissao) : '',
                                papel: l.papel, prof: l.profissional || '', paciente: l.paciente || pacientePorAdmissao(l.admissao), origem: l.origem || '',
                                convenio: l.convenio || '', descricao: l.descricao || '', valor: Number(l.valor) || 0 });
        row.getCell('valor').numFmt = 'R$ #,##0.00';
        Utilidades.pintarCelulaFonte(row.getCell('origem'), l.origem);   // V947
      }
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      a.href = url;
      a.download = `relatorio_${state.fichario}_${state.competencia}_${ts}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      Utilidades.toast?.(`✓ ${linhas.length} linhas exportadas.`, 'success', 4000);
    } catch (e) {
      console.error('[relatorios] exportarExcelDesemp:', e);
      Utilidades.toast?.('Erro ao gerar Excel: ' + (e.message || e), 'error', 4500);
    }
  }

  function msgVazia(titulo, txt) {
    return `
      <div class="rel-placeholder">
        <div class="rel-placeholder-ico">▦</div>
        <h3>${esc(titulo)}</h3>
        <p>${txt}</p>
      </div>`;
  }

  // ── EXPORTAÇÃO EXCEL ──────────────────────────────────────────────────
  async function exportarExcel() {
    if (typeof ExcelJS === 'undefined') {
      Utilidades.toast?.('Biblioteca ExcelJS não carregada. Recarregue a página (Ctrl+Shift+R).', 'error', 4500);
      return;
    }
    Utilidades.toast?.('Gerando Excel…', 'info', 2000);
    await new Promise(r => setTimeout(r, 80));   // V601: fecha o aviso/pinta o toast antes do trabalho pesado
    const linhas = matrizRepasse();
    if (!linhas.length) { Utilidades.toast?.('Nada para exportar neste mês.', 'error', 3500); return; }
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(`Repasse ${state.competencia}`, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = [
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Módulo', key: 'modulo', width: 12 },
        { header: 'Admissão', key: 'admissao', width: 14 },
        { header: 'Data', key: 'data', width: 12 },
        { header: 'Papel', key: 'papel', width: 14 },
        { header: 'Profissional', key: 'prof', width: 34 },
        { header: 'Paciente', key: 'paciente', width: 30 },
        { header: 'Origem', key: 'origem', width: 14 },
        { header: 'Convênio', key: 'convenio', width: 22 },
        { header: 'Descrição', key: 'descricao', width: 44 },
        { header: 'Especialidade', key: 'especialidade', width: 22 },   // V500: coluna Especialidade (Produção)
        { header: 'Valor repasse', key: 'repasse', width: 14 },
      ];
      const espMap = mapaEspecialidades();   // V500.1: mapa global admissão → especialidade
      const head = ws.getRow(1);
      head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A34' } };
      head.alignment = { vertical: 'middle' };

      for (const l of linhas) {
        const st = statusInfo(l);
        const row = ws.addRow({
          status: st.label,
          modulo: 'Repasse',
          admissao: l.admissao || '',
          data: l.data_admissao ? fmtDataAdm(l.data_admissao) : '',
          papel: l._papelCanon || l.papel || '',
          prof: l.nome_profissional || '',
          paciente: l.paciente || pacientePorAdmissao(l.admissao),
          origem: l.origem || '',
          convenio: convenioComPerfil(l),
          descricao: l.procedimento || '',
          especialidade: especialidadeDe(espMap, l.admissao, l.procedimento),   // V503: produto predomina
          repasse: Number(l._repasse) || 0,
        });
        row.getCell('repasse').numFmt = 'R$ #,##0.00';
        Utilidades.pintarCelulaFonte(row.getCell('origem'), l.origem);   // V947
        let cor = null;
        if (st.label === 'GLOSA') cor = 'FFF6E5E5';
        else if (st.label === 'Ajustes') cor = 'FFF2F2F3';
        else if (st.label === 'QVIS') cor = 'FFE9F3EE';
        if (cor) row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } };
      }
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      a.href = url;
      a.download = `relatorio_repasse_${state.competencia}_${ts}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      Utilidades.toast?.(`✓ ${linhas.length} linhas exportadas.`, 'success', 4000);
    } catch (e) {
      console.error('[relatorios] exportarExcel:', e);
      Utilidades.toast?.('Erro ao gerar Excel: ' + (e.message || e), 'error', 4500);
    }
  }

  function trocarConteudo() {
    // mostra loading e recalcula só o conteúdo (sem re-renderizar a casca)
    const alvo = document.getElementById('rel-conteudo');
    if (alvo) alvo.innerHTML = `<div class="rel-loading"><div class="atlas-loader"></div></div>`;
    setTimeout(renderConteudo, 16);
  }

  function bindCasca() {
    const sel = document.getElementById('rel-competencia');
    if (sel) sel.addEventListener('change', () => { state.competencia = sel.value; trocarConteudo(); });
    document.querySelectorAll('[data-ficha]').forEach(b => {
      b.addEventListener('click', () => {
        state.fichario = b.dataset.ficha;
        document.querySelectorAll('.rel-ficha').forEach(x => x.classList.toggle('ativa', x.dataset.ficha === state.fichario));
        trocarConteudo();
      });
    });
    // V943: Inspeção da Admissão de volta — abre direto (sem frase de acesso)
    const btnInsp = document.getElementById('rel-abrir-inspecao');
    if (btnInsp) btnInsp.addEventListener('click', () => {
      if (window.AtlasInspecao && typeof AtlasInspecao.abrir === 'function') AtlasInspecao.abrir();
      else Utilidades.toast?.('Módulo Inspeção não carregado. Recarregue a página (Ctrl+Shift+R).', 'error', 4000);
    });
    const btnExp = document.getElementById('rel-abrir-export');
    if (btnExp) btnExp.addEventListener('click', async () => {
      if (!await avisarLembretes(true)) return;   // V550/V814: extração FINAL
      state.modalExport = true; atualizarModal();
    });
    // V902: segunda extração — a matriz do Consolidado COMO ESTÁ na tela
    const btnExpF = document.getElementById('rel-export-filtrado');
    if (btnExpF) btnExpF.addEventListener('click', exportarConsolidadoFiltrado);
    const btnMM = document.getElementById('rel-abrir-mesames');
    if (btnMM) btnMM.addEventListener('click', abrirMesAMes);   // V599
    const btnCk = document.getElementById('rel-abrir-check');   // V642
    if (btnCk) btnCk.addEventListener('click', () => {
      if (window.AtlasCheckRegra) window.AtlasCheckRegra.abrir();
      else Utilidades.toast?.('Check de regra não carregado. Recarregue a página.', 'error', 4000);
    });
    atualizarModal();
  }

  // V550: antes de extrair qualquer relatório, avisa se há lembretes/alertas
  // sem o checkbox de concluído. Retorna true = pode seguir.
  async function avisarLembretes(extracaoFinal) {
    try {
      if (window.AtlasLembretes && typeof window.AtlasLembretes.avisarPendentes === 'function') {
        // V814: a EXTRAÇÃO FINAL soma as pendências de cadastro e a advertência
        return await window.AtlasLembretes.avisarPendentes(!!extracaoFinal);
      }
    } catch (e) { console.warn('[relatorios] aviso de lembretes:', e); }
    return true;
  }

  function bindConteudo() {
    const exp = document.getElementById('rel-export');
    if (exp) exp.addEventListener('click', async () => { if (await avisarLembretes()) exportarExcel(); });   // V550
    const expD = document.getElementById('rel-export-desemp');
    if (expD) expD.addEventListener('click', async () => { if (await avisarLembretes()) exportarExcelDesemp(); });   // V550
    if (state.fichario === 'consolidado') bindConsolidado();
  }

  // ════════════════════════════════════════════════════════════════════════
  // EXPORTAÇÃO FINAL (Consolidado / Por médico · status · abas · modelo)
  // ════════════════════════════════════════════════════════════════════════

  // de-para de médicos (nome qualquer → nome_oficial), via medicos + sinônimos
  function _normNome(s) {
    return (window.Utilidades && Utilidades.normalizar) ? Utilidades.normalizar(s) : String(s == null ? '' : s).toUpperCase().trim();
  }
  let _cadExportV = -1;   // V916: carimbo de versão (uso fora do montar)
  function cadMapExport() {
    if (_cadExport && _cadExportV === (Banco._versao || 0)) return _cadExport;
    _cadExportV = Banco._versao || 0;
    const m = new Map();
    try {
      const porId = new Map();
      (Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM medicos`) || []).forEach(x => {
        const no = x.nome_oficial || '';
        if (!no) return;
        m.set(_normNome(x.nome_oficial), no);
        if (x.nome_normalizado) { m.set(String(x.nome_normalizado), no); m.set(_normNome(x.nome_normalizado), no); }
        porId.set(x.id, no);
      });
      try {
        (Banco.query(`SELECT grafia, grafia_normalizada, medico_id FROM sinonimos_medico`) || []).forEach(s => {
          const no = porId.get(s.medico_id);
          if (!no) return;
          if (s.grafia) m.set(_normNome(s.grafia), no);
          if (s.grafia_normalizada) { m.set(String(s.grafia_normalizada), no); m.set(_normNome(s.grafia_normalizada), no); }
        });
      } catch (e) {}
    } catch (e) {}
    _cadExport = m;
    return m;
  }
  function resolverMedico(nome) {
    if (!nome || nome === '—') return nome || '—';
    return cadMapExport().get(_normNome(nome)) || nome;
  }

  // conjunto de médicos INTERNO/HIBRIDO (por nome oficial normalizado)
  let _ihSet = null;
  let _ihSetV = -1;   // V916: carimbo de versão (uso fora do montar)
  function ihSet() {
    if (_ihSet && _ihSetV === (Banco._versao || 0)) return _ihSet;
    _ihSetV = Banco._versao || 0;
    const s = new Set();
    try {
      (Banco.query(`SELECT nome_oficial FROM medicos WHERE tipo_vinculo IN ('INTERNO','HIBRIDO')`) || []).forEach(m => {
        if (m.nome_oficial) s.add(_normNome(m.nome_oficial));
      });
    } catch (e) {}
    _ihSet = s;
    return s;
  }
  function ehIH(profissional) {
    return ihSet().has(_normNome(resolverMedico(profissional)));
  }

  // normaliza a Origem para um valor único (CONVÊNIO/CONVENIO → CONVENIO, etc.)
  function canonOrigem(o) {
    const n = String(o == null ? '' : o).toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (n.startsWith('CONV')) return 'CONVENIO';
    if (n.startsWith('PART')) return 'PARTICULAR';
    if (n === 'SUS') return 'SUS';
    return n;
  }

  // mapa admissão → paciente (de TODO o QVIS; Produção como reserva). Global,
  // porque a competência do relatório é o mês de pagamento e pode diferir do
  // mês de admissão do QVIS. Cacheado e recriado ao reentrar na tela.
  let _pacMap = null;
  let _pacMapV = -1;   // V916: carimbo de versão (uso fora do montar)
  function pacMap() {
    if (_pacMap && _pacMapV === (Banco._versao || 0)) return _pacMap;
    _pacMapV = Banco._versao || 0;
    const m = new Map();
    const add = (a, p) => {
      const k = String(a == null ? '' : a).trim();
      if (k && p && String(p).trim() && !m.has(k)) m.set(k, String(p).trim());
    };
    try { (Banco.query(`SELECT admissao AS a, paciente AS p FROM linhas_qvis WHERE paciente IS NOT NULL AND paciente <> ''`) || []).forEach(r => add(r.a, r.p)); } catch (e) {}
    try { (Banco.query(`SELECT cod_admissao AS a, paciente AS p FROM linhas_producao WHERE paciente IS NOT NULL AND paciente <> ''`) || []).forEach(r => add(r.a, r.p)); } catch (e) {}
    _pacMap = m;
    try {
      const ex = m.size ? (() => { const [k, v] = [...m.entries()][0]; return ` · ex: "${k}" → "${v}"`; })() : '';
      console.log(`[relatorios] pacientes (admissão→nome): ${m.size} entradas${ex}`);
    } catch (e) {}
    return m;
  }
  function pacientePorAdmissao(adm) {
    const k = String(adm == null ? '' : adm).trim();
    return k ? (pacMap().get(k) || '') : '';
  }

  // normaliza uma linha (repasse ou desempenho) para o formato único
  // V284: perfil particular (VISÃO SAÚDE, PROJETO CATARATA...) aparece na coluna CONVÊNIO
  // (que fica branca no particular), em vez de virar sufixo no nome do procedimento.
  function convenioComPerfil(l) {
    if (l && l._regraPerfil && l._perfilNome) return String(l._perfilNome).trim();
    return (l && l.convenio) ? l.convenio : '';
  }
  function linhaPadrao(l, abaId) {
    if (abaId === 'repasse') {
      const st = statusInfo(l);
      // V245/246/247: coluna Produzido via helper único (Utilidades.produzidoView):
      // PARTICULAR pago por % → produzido bruto do QVIS; CONVÊNIO → 'PROD. CONV'; resto → branco.
      const _prodCol = Utilidades.produzidoView(l);
      const proj = {
        status: st.label, modulo: 'Repasse',
        admissao: l.admissao || '', data: l.data_admissao ? fmtDataAdm(l.data_admissao) : '',
        papel: l._papelCanon || l.papel || '', profissional: l.nome_profissional || '',
        paciente: l.paciente || pacientePorAdmissao(l.admissao),
        origem: canonOrigem(l.origem), convenio: convenioComPerfil(l),
        descricao: l.procedimento || '', valor: Number(l._repasse) || 0,
        produzido: _prodCol,
        especialidade: especialidadeDe(mapaEspecialidades(), l.admissao, l.procedimento),   // V503
        vtab: l._versaoTabela != null && l._versaoTabela !== '' ? 'v' + l._versaoTabela : '',   // V638: versão da Base Tabela aplicada
      };
      // V996: a linha ORIGINAL do QVIS viaja junto — é ela que permite ao
      // Relatórios abrir a MESMA memória de cálculo do Calcular ao passar o
      // mouse. NÃO enumerável: não entra no JSON da foto nem na exportação.
      try { Object.defineProperty(proj, '_orig', { value: l, enumerable: false }); } catch (_) {}
      return proj;
    }
    return {
      status: l.status || 'Desempenho', modulo: l.modulo || '',
      admissao: l.admissao || '', data: l.data_admissao ? fmtDataAdm(l.data_admissao) : '',
      papel: l.papel || '', profissional: l.profissional || '',
      paciente: l.paciente || pacientePorAdmissao(l.admissao),
      origem: canonOrigem(l.origem), convenio: l.convenio || '',
      descricao: l.descricao || '', valor: Number(l.valor) || 0,
      produzido: Utilidades.produzidoView(l),   // V250: fichários % mostram a base; fixos→branco; convênio→PROD. CONV
      especialidade: especialidadeDe(mapaEspecialidades(), l.admissao, l.descricao),   // V503
      vtab: '',   // V638: fichários de desempenho não usam a Base Tabela
    };
  }

  // coleta as linhas das abas selecionadas (do mês atual), filtradas por status
  // ── LINHAS AVULSAS (manuais) do Consolidado — por competência ─────────────
  // Coisas que não vêm do QVIS/Produção/Desempenho mas precisam entrar no
  // repasse. Mesmo formato da matriz. SEMPRE entram (sem filtro IH/status/aba).
  function garantirTabelaAvulsas() {
    Banco.executar(`CREATE TABLE IF NOT EXISTS consolidado_linhas_manuais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competencia  TEXT NOT NULL,
      status TEXT, modulo TEXT, admissao TEXT, data TEXT, papel TEXT,
      profissional TEXT, medico_id INTEGER, paciente TEXT, origem TEXT,
      convenio TEXT, descricao TEXT, valor REAL DEFAULT 0,
      criado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);
    // V621: complementos importados em lote (rastreio + desfazer por arquivo)
    try { Banco.executar(`ALTER TABLE consolidado_linhas_manuais ADD COLUMN lote TEXT`); } catch (_) {}
  }
  function carregarLinhasManuais(comp) {
    if (!comp) return [];
    try {
      garantirTabelaAvulsas();
      return Banco.query(
        `SELECT * FROM consolidado_linhas_manuais WHERE competencia = ? ORDER BY id`,
        [comp]) || [];
    } catch (e) { console.error('[relatorios] carregar avulsas', e); return []; }
  }

  // e com o de-para de nomes já aplicado na coluna Profissional
  // V619: MÊS CONSOLIDADO = FOTO CONGELADA. Depois de consolidar, o consolidado
  // do mês é servido da foto gravada na consolidação — mudanças posteriores de
  // regras/cadastros NÃO recalculam o passado. Mês aberto segue ao vivo.
  function coletarLinhas(abasSet, statusSet) {
    const AC = window.AtlasConsolidacao;
    const comp = state.competencia;
    if (AC && AC.estaConsolidado && AC.estaConsolidado(comp)) {
      let foto = AC.lerFotoConsolidado ? AC.lerFotoConsolidado(comp) : null;
      if (!foto) {
        // consolidado antes da V619 (sem foto) → adota o cálculo atual e congela
        foto = coletarLinhasLive(null, null);
        if (AC.gravarFotoConsolidado) AC.gravarFotoConsolidado(comp, foto);
      }
      return foto.filter(l => {
        if (l._avulsa || l._gerencial) return true;   // sempre entram (como no ao-vivo)
        if (abasSet && l._abaId && !abasSet.has(l._abaId)) return false;
        if (statusSet && !l._ehConsultaProducao && !statusSet.has(l.status)) return false;
        return true;
      });
    }
    return coletarLinhasLive(abasSet, statusSet);
  }

  function coletarLinhasLive(abasSet, statusSet) {
    const out = [];
    // V625: profissionais DESCARTADOS pelo filtro interno/híbrido — antes sumiam em
    // silêncio (médico "não recebia" sem ninguém saber). Agora são coletados e o
    // Consolidado mostra o aviso com o motivo (sem de-para × tipo de vínculo).
    const descartados = new Map();
    const todas = ['repasse', ...FICHARIOS_DESEMPENHO.map(f => f.id)];
    for (const abaId of todas) {
      // V775: fichário sem aba própria (Exceção · Produção) não aparece na lista
      // de abas da extração — então nunca pode ser cortado por ela: entra sempre.
      if (abasSet && !abasSet.has(abaId) && !SEM_FICHARIO_PROPRIO.has(abaId)) continue;
      let linhas = [];
      try {
        if (abaId === 'repasse') linhas = matrizRepasse() || [];
        else { const res = resultadoDesempenho(abaId); linhas = (res && res.linhas) || []; }
      } catch (e) { console.error('[relatorios] coletar', abaId, e); }
      for (const l of linhas) {
        const p = linhaPadrao(l, abaId);
        // Consulta paga pela PRODUÇÃO: médico selecionado de propósito — entra
        // sempre, ignorando o filtro de status e o filtro de INTERNO/HÍBRIDO.
        const ehProducaoConsulta = !!l._ehConsultaProducao;
        // V619: carimbos pra foto congelada re-filtrar por aba/status
        p._abaId = abaId;
        if (ehProducaoConsulta) p._ehConsultaProducao = true;
        if (!ehProducaoConsulta && statusSet && !statusSet.has(p.status)) continue;
        p.profissional = resolverMedico(p.profissional);   // de-para de nomes
        // V844: linha cujo PROFISSIONAL exibido era um texto informativo
        // ("INDICANTE NÃO INFORMADO NO SISTEMA") mas cujo valor pertence a um
        // médico REAL (o executante) — o filtro interno/híbrido, o arquivo por
        // médico e os totais usam o médico real.
        // V916 (decisão do usuário): a COLUNA da matriz também sai no médico
        // REAL — filtrar o Consolidado pelo nome dele bate com o Controle de
        // Notas e com a extração por médico. O aviso vai pra descrição.
        if (l._medicoReal) {
          p._medicoReal = resolverMedico(l._medicoReal);
          if (p.profissional !== p._medicoReal) {
            const aviso = String(p.profissional || '').trim();
            p.profissional = p._medicoReal;
            p.descricao = `${String(p.descricao || '').trim()} · ${aviso || 'INDICANTE NÃO INFORMADO'} — valor pago ao executante`.replace(/^ · /, '');
          }
        }
        // regra: só médicos INTERNO/HIBRIDO — exceção: taxas de equipamento
        // (são da proprietária; o uso já é restrito a IH nos adaptadores)
        const ehTaxa = String(p.papel || '').toUpperCase().indexOf('TAXA') >= 0;
        if (!ehTaxa && !ehProducaoConsulta && !ehIH(p._medicoReal || p.profissional)) {
          // V625: registra o descarte pro aviso do Consolidado (nome já pós de-para)
          const nomeDesc = String(p.profissional || '').trim();
          if (nomeDesc && nomeDesc !== '—' && (Number(p.valor) || 0) !== 0) {
            const k = _normNome(nomeDesc) + '|' + (p.modulo || '');
            const d = descartados.get(k) || {
              nome: nomeDesc, modulo: p.modulo || abaId, n: 0, valor: 0,
              semCadastro: !cadMapExport().has(_normNome(nomeDesc)),
            };
            d.n++; d.valor += Number(p.valor) || 0;
            descartados.set(k, d);
          }
          continue;
        }
        out.push(p);
      }
    }

    // Linhas AVULSAS (manuais) do mês — SEMPRE entram, ignorando filtro de
    // status/aba e o filtro de médicos INTERNO/HÍBRIDO (foram adicionadas à mão).
    try {
      for (const m of carregarLinhasManuais(state.competencia)) {
        out.push({
          status:       m.status || 'Avulso',
          modulo:       m.modulo || 'Avulso',
          admissao:     m.admissao || '',
          data:         m.data ? fmtDataAdm(m.data) : '',
          papel:        m.papel || '',
          profissional: resolverMedico(m.profissional || ''),
          paciente:     m.paciente || '',
          origem:       canonOrigem(m.origem),
          convenio:     m.convenio || '',
          descricao:    m.descricao || '',
          valor:        Number(m.valor) || 0,
          especialidade: especialidadeDe(mapaEspecialidades(), m.admissao, m.descricao),   // V503
          _avulsa:      true,
        });
      }
    } catch (e) { console.error('[relatorios] injetar avulsas', e); }

    // V223: Ajustes GERENCIAIS aplicados do mês — entram sempre no Consolidado
    // (crédito + / desconto −). Fonte: módulo Gerenciais (Processamento).
    try {
      if (window.AtlasGerenciais && typeof window.AtlasGerenciais.linhasConsolidado === 'function') {
        for (const g of window.AtlasGerenciais.linhasConsolidado(state.competencia)) {
          out.push({
            status:       g.status || 'Gerencial',
            modulo:       g.modulo || 'Gerencial',
            admissao:     g.admissao || '',
            data:         '',
            papel:        g.papel || '',
            profissional: resolverMedico(g.profissional || ''),
            paciente:     '',
            origem:       canonOrigem(g.origem),
            convenio:     '',
            descricao:    g.descricao || '',
            valor:        Number(g.valor) || 0,
            _gerencial:   true,
          });
        }
      }
    } catch (e) { console.error('[relatorios] injetar gerenciais', e); }

    // V625: viaja junto com o resultado (propriedade do array — não entra no JSON da foto)
    try { Object.defineProperty(out, '_descartadosIH', { value: [...descartados.values()], enumerable: false }); } catch (_) {}
    return out;
  }

  // cache das linhas consolidadas (todas as abas) por competência
  let _consCache = { comp: null, linhas: null };
  function linhasConsolidado() {
    if (_consCache.comp === state.competencia && _consCache.linhas) return _consCache.linhas;
    const linhas = coletarLinhas(null, null);
    _consCache = { comp: state.competencia, linhas };
    return linhas;
  }

  // V195.1: expõe ao Dashboard o conjunto de PROFISSIONAIS do CONSOLIDADO de uma
  // competência (mesma coleta da aba Consolidado: interno/híbrido + taxas +
  // consulta-produção + avulsos + de-para de nomes). É o universo de médicos
  // que o dashboard deve considerar.
  function nomesConsolidado(comp) {
    const linhas = linhasConsolidadoComp(comp);
    const set = new Set();
    for (const l of linhas) {
      const nome = (l && l.profissional) ? String(l.profissional).trim() : '';
      if (nome && nome !== '—') set.add(nome);
    }
    return set;
  }

  // V196.1: expõe as LINHAS completas do consolidado de uma competência
  // (cada uma com modulo, profissional, valor, papel) — fonte única do dashboard
  // pro repasse, já consolidado e com nome completo + módulo prontos.
  const _consCacheVG = {};   // comp → linhas
  function linhasConsolidadoComp(comp) {
    if (!comp) return [];
    // V675: chave carimbada com Banco._versao — rodar o ▶ Calcular (novo
    // snapshot) ou mudar regra invalida sozinho. Antes, a 1ª consulta (ex.:
    // gerencial da Produção Médica ANTES do recálculo) congelava um consolidado
    // vazio/velho até alguém visitar a tela de Relatórios.
    const kVG = comp + '|' + (Banco._versao || 0);
    if (_consCacheVG[kVG]) return _consCacheVG[kVG];
    const compAnterior = state.competencia;
    const cacheAnterior = _consCache;
    let linhas = [];
    try {
      state.competencia = comp;
      _consCache = { comp: null, linhas: null };
      linhas = (coletarLinhas(null, null) || []).map(l => ({
        modulo: l.modulo || '', status: l.status || '',
        // V844: o dashboard agrega por médico — vale o médico REAL da linha
        profissional: l._medicoReal || l.profissional || '', papel: l.papel || '',
        origem: l.origem || '',
        valor: Number(l.valor) || 0, admissao: l.admissao || '',
        convenio: l.convenio || '',   // V521: filtro de convênio do dashboard
      }));
    } catch (e) {
      console.error('[relatorios] linhasConsolidadoComp:', e);
    } finally {
      state.competencia = compAnterior;
      _consCache = cacheAnterior;
    }
    // V601: no máx. 4 meses retidos — o dashboard varre muitos meses e, na
    // base real, guardar TODOS os consolidados (milhares de linhas por mês)
    // pressionava a memória da aba até congelar a ferramenta.
    const ksVG = Object.keys(_consCacheVG);
    if (ksVG.length >= 4) delete _consCacheVG[ksVG[0]];
    _consCacheVG[kVG] = linhas;
    return linhas;
  }
  window.AtlasRelatorios = Object.assign(window.AtlasRelatorios || {}, { nomesConsolidado, linhasConsolidadoComp,
    formatarLinhaRepasse: (l) => linhaPadrao(l, 'repasse'),   // V241: usado pela aba Honorário p/ espelhar as colunas do Consolidado
    invalidarConsolidado: (comp) => { try {
      // V675: chaves agora são comp|versão — apaga por prefixo
      if (comp) { for (const k in _consCacheVG) if (k === comp || k.indexOf(comp + '|') === 0) delete _consCacheVG[k]; }
      else { for (const k in _consCacheVG) delete _consCacheVG[k]; }
      // V619: derruba também os memos de sessão da matriz — sem isso a
      // consolidação poderia fotografar (congelar) uma matriz desatualizada
      _cacheRep = { comp: null, linhas: null };
      _consCache = { comp: null, linhas: null };
    } catch (_) {} } });
  // V943: API do Consolidado usada pela INSPEÇÃO DA ADMISSÃO (V791/V876; saiu na
  // V926 junto com o módulo, volta com ele). linhasConsolidadoAdmissao(comp, adm)
  // devolve as linhas COMPLETAS do Consolidado do mês (coletarLinhas — paciente,
  // data, descrição, produzido, _medico, _status…) só da admissão pedida, com a
  // matriz do mês montada UMA vez e indexada por admissão (o módulo pede
  // dezenas de admissões do mesmo mês em sequência — V859).
  const _normAdmRel = (x) => { const s = String(x == null ? '' : x).trim().replace(/\.0+$/, ''); const d = s.replace(/\D/g, '').replace(/^0+/, ''); return d || s.toUpperCase(); };
  let _consAdmCache = {};   // `${comp}|${versão}` → Map(admissão normalizada → linhas)
  function linhasConsolidadoAdmissao(comp, adm) {
    if (!comp) return [];
    const k = comp + '|' + (Banco._versao || 0);
    let mapa = _consAdmCache[k];
    if (!mapa) {
      mapa = new Map();
      for (const l of mmLinhasCompletas(comp) || []) {
        const a = _normAdmRel(l.admissao); if (!a) continue;
        if (!mapa.has(a)) mapa.set(a, []);
        mapa.get(a).push(l);
      }
      const ks = Object.keys(_consAdmCache);
      if (ks.length >= 4) delete _consAdmCache[ks[0]];   // mesmo teto do linhasConsolidadoComp (V601)
      _consAdmCache[k] = mapa;
    }
    return mapa.get(_normAdmRel(adm)) || [];
  }
  // competências que o módulo Relatórios oferece — a Inspeção poda o bloco 2 por elas (V876)
  function competenciasConsolidado() { try { return competencias().slice(); } catch (_) { return []; } }
  window.AtlasRelatorios = Object.assign(window.AtlasRelatorios, { linhasConsolidadoAdmissao, competenciasConsolidado });

  // V614: a Consolidação de Repasse exporta o consolidado final com o MESMO
  // layout dos exports do Relatórios (modelo importado, colunas e estilos)
  window.AtlasRelatorios = Object.assign(window.AtlasRelatorios, {
    linhasCompletasComp: (comp) => mmLinhasCompletas(comp),
    wbDeLinhas: (linhas, aba) => wbDeLinhas(linhas, aba),
    baixarWb: (wb, nome) => baixarWb(wb, nome),
  });

  // ── Aba CONSOLIDADO (todas as abas numa tabela, de-para + filtros) ────────
  // V912: data de admissão → ISO (aceita ISO e dd/mm/aaaa) pra comparar vigência
  function isoDataAdmRel(v) {
    const s = String(v || '').trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    return '';
  }

  // V902: seleção multi de uma coluna do Consolidado — aceita o legado
  // (string única) e o novo formato (array). Vazio = coluna sem seleção.
  function selConsDe(campo) {
    const v = (state.consolidadoSelect || {})[campo];
    if (v == null || v === '') return [];
    return Array.isArray(v) ? v : [String(v)];
  }

  // V902: o filtro da matriz do Consolidado — FONTE ÚNICA usada pela tela e
  // pela extração filtrada do botão flutuante. Por coluna: os valores
  // MARCADOS (união, casamento exato) E o texto "contém…".
  function filtrarConsolidado(linhas) {
    const F = state.consolidadoFiltros || {};
    return linhas.filter(l => CONS_COLS.every(c => {
      const valor = String(l[c.campo] == null ? '' : l[c.campo]);
      const sels = selConsDe(c.campo);
      if (sels.length && !sels.includes(valor)) return false;
      const f = String(F[c.campo] || '').trim().toLowerCase();
      return !f || valor.toLowerCase().includes(f);
    }));
  }

  // V902: há algum filtro ativo na matriz do Consolidado?
  function temFiltroConsolidado() {
    const F = state.consolidadoFiltros || {};
    return CONS_COLS.some(c => selConsDe(c.campo).length || String(F[c.campo] || '').trim());
  }

  const CONS_COLS = [
    { campo: 'status', label: 'Status' }, { campo: 'modulo', label: 'Módulo' },
    { campo: 'admissao', label: 'Admissão' }, { campo: 'data', label: 'Data' },
    { campo: 'papel', label: 'Papel' }, { campo: 'profissional', label: 'Profissional' },
    { campo: 'paciente', label: 'Paciente' },
    { campo: 'origem', label: 'Origem' }, { campo: 'convenio', label: 'Convênio' },
    { campo: 'descricao', label: 'Descrição' },
    { campo: 'especialidade', label: 'Especialidade' },   // V500.1: subespecialidade da Produção (por admissão)
    { campo: 'vtab', label: 'V.TAB' },   // V638: versão da Base Tabela aplicada na regra
  ];
  function renderConsolidado() {
    if (!state.competencia) return msgVazia('Nenhum mês', 'Selecione um mês para consolidar.');
    let linhas;
    try { linhas = linhasConsolidado(); }
    catch (e) { console.error('[relatorios] consolidado:', e); return msgVazia('Erro', esc(e.message || String(e))); }
    if (!linhas.length) return msgVazia('Sem dados', `Nada para consolidar em <strong>${esc(state.competencia)}</strong>.`);
    // V500.1: anota a especialidade em cada linha (idempotente; cache global do mapa)
    {
      const espMapCons = mapaEspecialidades();
      for (const l of linhas) if (l.especialidade === undefined) l.especialidade = especialidadeDe(espMapCons, l.admissao, l.descricao);
    }

    // V633: aviso de descartados removido a pedido do usuário (a coleta
    // _descartadosIH continua disponível internamente, sem UI)
    const F = state.consolidadoFiltros || {};
    const filtradas = filtrarConsolidado(linhas);
    const LIMITE = 1500;
    const exibidas = filtradas.slice(0, LIMITE);
    const total = filtradas.reduce((s, l) => s + (Number(l.valor) || 0), 0);

    // valores distintos por coluna (para o dropdown multi)
    const distintos = {};
    for (const c of CONS_COLS) {
      const set = new Set();
      for (const l of linhas) { const v = l[c.campo]; if (v != null && String(v).trim() !== '') set.add(String(v)); }
      distintos[c.campo] = Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }
    state._consDistintos = distintos;   // V905: o painel do body usa no bind

    const ths = CONS_COLS.map(c => `<th>${c.label}</th>`).join('') + `<th class="rel-num">Produzido (Part.)</th><th class="rel-num">Valor repasse</th>`;
    const filtros = CONS_COLS.map(c => {
      /**
       * V902: a lista suspensa virou dropdown com CHECKBOX (multi) — marcar
       * vários valores soma (união). Os textos saem inteiros e em caixa alta
       * (V904) só aqui no filtro. O "contém…" continua ao lado.
       */
      const sel = selConsDe(c.campo);
      const aberto = state.consolidadoMselAberto === c.campo;
      const rotulo = sel.length
        ? `${sel.length} ✓` : `Todos (${distintos[c.campo].length})`;
      /**
       * V905: o botão ganhou rótulo e seta em SPANS próprios (nada de rótulo
       * sumido), e o PAINEL não é mais filho da célula — ele nasce no <body>
       * com position:fixed, ancorado no botão (montarMselPop, no bind). Assim
       * nenhum sticky/overflow/z-index da tabela consegue cortá-lo ou
       * desalinhá-lo, em qualquer zoom/rolagem.
       */
      const selHtml = `
        <div class="rel-msel-wrap">
          <button type="button" class="rel-cons-sel rel-msel-btn ${sel.length ? 'rel-msel-on' : ''} ${aberto ? 'rel-msel-aberto' : ''}"
                  data-cons-msel="${esc(c.campo)}" title="${sel.length ? sel.map(esc).join(' · ') : 'Selecionar valores (multi)'}">
            <span class="rel-msel-rot">${esc(rotulo)}</span><span class="rel-msel-caret">▾</span>
          </button>
        </div>`;
      const inpHtml = `<input type="text" class="rel-cons-fil" id="rel-consf-${c.campo}" data-cons-filtro="${c.campo}" value="${esc(F[c.campo] || '')}" placeholder="contém…">`;
      return `<th><div class="rel-cons-cell">${selHtml}${inpHtml}</div></th>`;
    }).join('') + `<th></th><th></th>`;

    // V996: memória de cálculo por linha também aqui — passar o mouse no valor
    // abre a regra do módulo de origem (e, nas linhas de Repasse, a trilha
    // completa do QVIS, igual ao Calcular).
    if (window.AtlasMemoria) AtlasMemoria.novaLeva('rel-cons');
    const linhasHtml = exibidas.map(l => {
      const origemBadge = l.origem ? Utilidades.badgeFonte(l.origem) : '';   // V947: tag padrão
      const valor = (Number(l.valor) || 0) === 0 ? '<span class="rel-zero">R$ 0,00</span>' : 'R$ ' + fmt(l.valor);
      return `
        <tr>
          <td><span class="rel-tag rel-tag-desemp">${esc(l.status || '—')}</span></td>
          <td>${esc(l.modulo || '—')}</td>
          <td class="rel-mono">${esc(l.admissao || '—')}</td>
          <td class="rel-mono rel-data">${esc(l.data || '—')}</td>
          <td><span class="rel-tag rel-tag-papel">${esc(l.papel || '—')}</span></td>
          <td>${esc(CodigoMedico.exibir(l.profissional || '—'))}</td>
          <td>${esc(l.paciente || '')}</td>
          <td>${origemBadge}</td>
          <td>${esc(l.convenio || '')}</td>
          <td class="rel-proc">${esc(l.descricao || '')}</td>
          <td>${esc(l.especialidade || '')}</td><!-- V500.1: Especialidade (Produção) -->
          <td class="rel-mono">${esc(l.vtab || '')}</td><!-- V638: V.TAB -->
          <td class="rel-num">${l.produzido == null ? '' : (typeof l.produzido === 'number' ? 'R$ ' + fmt(l.produzido) : esc(l.produzido))}</td>
          <td class="rel-num${(Number(l.valor) || 0) === 0 ? '' : ' atlas-rep'}"${window.AtlasMemoria ? AtlasMemoria.ref('rel-cons', l, 'consolidado') : ''} title="Passe o mouse: memória de cálculo · clique fixa">${valor}</td><!-- V962: valor de repasse em #46688c · V996: memória -->
        </tr>`;
    }).join('');

    return `
      <div class="rel-barra">
        <div class="rel-resumo">
          <div class="rel-kpi"><div class="rel-kpi-lbl">Valor total</div><div class="rel-kpi-val rel-kpi-verde">R$ ${fmt(total)}</div></div>
        </div>
        <div class="rel-acoes">
          <button class="rel-btn-excel" id="rel-abrir-export-2">↓ Exportar relatório</button>
          <button class="rel-btn-excel" id="rel-abrir-avulsa" style="background:var(--bg-elevated); color:var(--primary); border:1px solid var(--border)">➕ Linha avulsa</button>
          <button class="rel-btn-excel" id="rel-abrir-complementos" style="background:var(--bg-elevated); color:var(--primary); border:1px solid var(--border)" title="Importar um relatório (.xlsx) com várias linhas de complemento de uma vez — em vez de digitar uma a uma na Linha avulsa">📥 Inserir complementos</button>
        </div>
      </div>
      <div class="rel-tab-wrap">
        <table class="rel-tab rel-tab-cons">
          <thead>
            <tr>${ths}</tr>
            <tr class="rel-cons-filtros">${filtros}</tr>
          </thead>
          <tbody>${linhasHtml}</tbody>
        </table>
      </div>
      ${filtradas.length > LIMITE ? `<div class="rel-trunc">Exibindo ${LIMITE.toLocaleString('pt-BR')} de ${filtradas.length.toLocaleString('pt-BR')} linhas — refine os filtros para ver o restante (a exportação leva tudo).</div>` : ''}
    `;
  }

  function bindConsolidado() {
    const exp = document.getElementById('rel-abrir-export-2');
    if (exp) exp.addEventListener('click', async () => {   // V550
      if (!await avisarLembretes()) return;
      state.modalExport = true; atualizarModal();
    });
    const av = document.getElementById('rel-abrir-avulsa');
    if (av) av.addEventListener('click', () => { state.modalAvulsa = true; atualizarModal(); });
    const cp = document.getElementById('rel-abrir-complementos');
    if (cp) cp.addEventListener('click', () => {
      // V621: mês consolidado é congelado — complementos só em mês aberto
      if (window.AtlasConsolidacao && window.AtlasConsolidacao.estaConsolidado && window.AtlasConsolidacao.estaConsolidado(state.competencia)) {
        Utilidades.toast?.(`🔒 ${state.competencia} está CONSOLIDADO — reabra a competência na Consolidação pra inserir complementos.`, 'error', 6000);
        return;
      }
      _compPreview = null;
      state.modalComplementos = true;
      atualizarModal();
    });
    // V902/V905: dropdown multi por coluna — o botão só alterna o estado; o
    // painel em si vive no <body> (montarMselPop), imune ao overflow da tabela
    document.querySelectorAll('[data-cons-msel]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const campo = btn.dataset.consMsel;
        state.consolidadoMselAberto = state.consolidadoMselAberto === campo ? null : campo;
        renderConteudo();
      });
    });
    montarMselPop();
    if (!window.__relMselFecharFora) {
      window.__relMselFecharFora = true;
      document.addEventListener('click', (e) => {
        if (state.consolidadoMselAberto
            && !e.target.closest('#rel-msel-pop-body')
            && !e.target.closest('[data-cons-msel]')) {
          state.consolidadoMselAberto = null;
          const pop = document.getElementById('rel-msel-pop-body');
          if (pop) pop.remove();
          const ab = document.querySelector('.rel-msel-aberto');
          if (ab) ab.classList.remove('rel-msel-aberto');
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.consolidadoMselAberto) {
          state.consolidadoMselAberto = null;
          const pop = document.getElementById('rel-msel-pop-body');
          if (pop) pop.remove();
        }
      });
    }
    document.querySelectorAll('[data-cons-filtro]').forEach(inp => {
      inp.addEventListener('input', () => {
        const campo = inp.dataset.consFiltro;
        state.consolidadoFiltros = state.consolidadoFiltros || {};
        state.consolidadoFiltros[campo] = inp.value;
        const id = inp.id, pos = inp.selectionStart || inp.value.length;
        renderConteudo();   // re-filtra (consolidado usa cache, é rápido)
        const n = document.getElementById(id);
        if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
      });
    });
  }

  /**
   * V905: monta o painel de checkboxes da coluna aberta DIRETO NO <body>,
   * position:fixed ancorado no botão. Nada de sticky/overflow/z-index da
   * tabela alcança ele — não corta, não desalinha, em qualquer zoom.
   * Perto da borda direita da janela, alinha pela direita do botão.
   */
  function montarMselPop() {
    const velho = document.getElementById('rel-msel-pop-body');
    if (velho) velho.remove();
    const campo = state.consolidadoMselAberto;
    if (!campo) return;
    const btn = document.querySelector(`[data-cons-msel="${campo}"]`);
    const distintos = (state._consDistintos || {})[campo] || [];
    if (!btn) return;
    const sel = selConsDe(campo);
    const opcoes = distintos.slice(0, 500);
    const item = (v, marcado, extra) => `
      <div class="rel-msel-opt ${marcado ? 'on' : ''} ${extra || ''}" data-val="${esc(v)}">
        <span class="rel-msel-cbx ${marcado ? 'on' : ''}">${marcado ? '✓' : ''}</span>
        <span class="rel-msel-txt">${esc(v)}</span>
      </div>`;
    const pop = document.createElement('div');
    pop.id = 'rel-msel-pop-body';
    pop.className = 'rel-msel-pop';
    pop.innerHTML = `
      <div class="rel-msel-opt rel-msel-todos ${sel.length ? '' : 'on'}" data-msel-todos="1">
        <span class="rel-msel-cbx ${sel.length ? '' : 'on'}">${sel.length ? '' : '✓'}</span>
        <span class="rel-msel-txt">TODOS (${distintos.length})</span>
      </div>
      ${sel.filter(v => !opcoes.includes(v)).map(v => item(v, true)).join('')}
      ${opcoes.map(v => item(v, sel.includes(v))).join('')}
      ${distintos.length > opcoes.length ? `<div class="rel-msel-opt rel-msel-mais">+${distintos.length - opcoes.length} valores — use o "contém…" pra refinar</div>` : ''}`;
    document.body.appendChild(pop);
    // ancora no botão; se estourar a direita da janela, alinha pela direita
    const r = btn.getBoundingClientRect();
    pop.style.top = `${Math.round(r.bottom + 4)}px`;
    pop.style.minWidth = `${Math.round(r.width)}px`;
    const larguraPop = Math.min(pop.offsetWidth || 320, 360);
    if (r.left + larguraPop > window.innerWidth - 12) {
      pop.style.left = `${Math.max(8, Math.round(r.right - larguraPop))}px`;
    } else {
      pop.style.left = `${Math.round(r.left)}px`;
    }
    // não deixa passar do rodapé da janela
    const maxH = Math.max(160, window.innerHeight - r.bottom - 24);
    pop.style.maxHeight = `${Math.round(maxH)}px`;

    pop.addEventListener('click', (e) => {
      e.stopPropagation();
      const todos = e.target.closest('[data-msel-todos]');
      state.consolidadoSelect = state.consolidadoSelect || {};
      if (todos) {
        state.consolidadoSelect[campo] = [];
        renderConteudo();
        return;
      }
      const opt = e.target.closest('.rel-msel-opt[data-val]');
      if (!opt) return;
      const v = opt.dataset.val;
      const arr = selConsDe(campo).slice();
      const i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1); else arr.push(v);
      state.consolidadoSelect[campo] = arr;
      renderConteudo();   // painel remontado aberto (consolidadoMselAberto mantido)
    });
  }

  // lê o modelo importado e descobre a linha de cabeçalho + mapa de colunas
  async function parseModelo(buffer) {
    const MAP = {
      'status': 'status', 'modulo': 'modulo', 'módulo': 'modulo',
      'admissao': 'admissao', 'admissão': 'admissao', 'cod admissao': 'admissao', 'cód admissão': 'admissao',
      'data': 'data', 'papel': 'papel',
      'profissional': 'profissional', 'medico': 'profissional', 'médico': 'profissional', 'nome': 'profissional',
      'paciente': 'paciente', 'nome do paciente': 'paciente', 'nome paciente': 'paciente',
      'origem': 'origem', 'convenio': 'convenio', 'convênio': 'convenio',
      'descricao': 'descricao', 'descrição': 'descricao', 'produto': 'descricao', 'procedimento': 'descricao',
      'valor': 'valor', 'valor repasse': 'valor', 'repasse': 'valor', 'valor do repasse': 'valor',
      // V501: coluna Especialidade (subespecialidade da Produção) — reconhece as grafias no modelo
      'especialidade': 'especialidade', 'subespecialidade': 'especialidade',
      'sub-especialidade': 'especialidade', 'sub especialidade': 'especialidade',
      'especialidades': 'especialidade',
      // V249: coluna "Produzido (Part.)" (visão do produzido) — reconhece o cabeçalho do modelo
      'produzido': 'produzido', 'produzido (part.)': 'produzido', 'produzido (part)': 'produzido',
      'produzido part.': 'produzido', 'produzido part': 'produzido',
      'produzido (particular)': 'produzido', 'produzido particular': 'produzido',
      'prod. (part.)': 'produzido', 'prod (part.)': 'produzido', 'prod (part)': 'produzido',
    };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws) return null;
    let headerRow = -1, colMap = [];
    const lim = Math.min(ws.rowCount || 1, 25);
    for (let r = 1; r <= lim; r++) {
      const row = ws.getRow(r);
      const cols = [];
      row.eachCell((cell, c) => {
        const txt = String(cell.value == null ? '' : cell.value).toLowerCase().trim().replace(/\s+/g, ' ');
        const campo = MAP[txt];
        if (campo && !cols.some(x => x.campo === campo)) cols.push({ col: c, campo, nome: String(cell.value) });
      });
      if (cols.length >= 3) { headerRow = r; colMap = cols; break; }
    }
    if (headerRow < 0) return null;
    return { headerRow, colMap, sheetName: ws.name };
  }

  // colunas de saída: do modelo (se houver) ou padrão
  function colunasSaida() {
    let cols = (_modeloParse && _modeloParse.colMap.length)
      ? _modeloParse.colMap.map(c => ({ header: c.nome, campo: c.campo, width: 18 }))
      : COLS_PADRAO.slice();
    // V638: coluna V.TAB opcional na extração (versão da Base Tabela aplicada);
    // com modelo importado ela entra ao FINAL, sem mexer no layout do modelo
    if (state.exportVTab && !cols.some(c => c.campo === 'vtab')) {
      cols = cols.concat([{ header: 'V.TAB', campo: 'vtab', width: 9 }]);
    }
    return cols;
  }

  function sanitizeSheet(nome) {
    let n = String(nome || 'Sem nome').replace(/[\[\]\*\/\\\?:]/g, ' ').trim().slice(0, 28);
    return n || 'Sem nome';
  }

  // Uniformiza a fonte de TODAS as células de uma planilha (preserva bold/cor).
  function uniformizarFonte(ws, nomeFonte, tamanho) {
    try {
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const f = cell.font || {};
          cell.font = { ...f, name: nomeFonte, size: tamanho };
        });
      });
    } catch (e) { console.warn('[relatorios] uniformizarFonte', e); }
  }

  function montarWS(wb, nome, linhas, cols) {
    const ws = wb.addWorksheet(nome, { views: [{ state: 'frozen', ySplit: 1 }] });
    const valIdx = cols.findIndex(c => c.campo === 'valor');

    // monta as linhas como matriz de valores (em ordem das colunas)
    const dados = linhas.map(l => cols.map(c =>
      (c.campo === 'valor') ? (Number(l.valor) || 0) : (l[c.campo] != null ? l[c.campo] : '')
    ));
    // garante ao menos 1 linha pra a Tabela ser válida mesmo sem dados
    if (dados.length === 0) dados.push(cols.map(() => ''));

    const nomeTabela = ('T_' + String(nome || 'Dados')).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 200);

    // TABELA DO EXCEL de verdade (cabeçalho + filtro + faixas + linha de total dentro da tabela)
    ws.addTable({
      name: nomeTabela,
      ref: 'A1',
      headerRow: true,
      totalsRow: true,
      style: { theme: 'TableStyleMedium9', showRowStripes: true, showFirstColumn: false },
      columns: cols.map((c, i) => ({
        name: c.header,
        filterButton: true,
        totalsRowLabel: i === 0 ? 'TOTAL' : undefined,
        totalsRowFunction: (i === valIdx) ? 'sum' : 'none',
      })),
      rows: dados,
    });

    // larguras das colunas
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || 18; });
    // formato R$ na coluna de valor (dados + linha de total)
    if (valIdx >= 0) ws.getColumn(valIdx + 1).numFmt = 'R$ #,##0.00';
    const prodIdx = cols.findIndex(c => c.campo === 'produzido');   // V245
    if (prodIdx >= 0) ws.getColumn(prodIdx + 1).numFmt = 'R$ #,##0.00';
    // V947: coluna Origem com o rótulo uniforme e a cor da tag
    const origIdx = cols.findIndex(c => c.campo === 'origem');
    if (origIdx >= 0) linhas.forEach((l, i) => Utilidades.pintarCelulaFonte(ws.getRow(i + 2).getCell(origIdx + 1), l.origem));

    uniformizarFonte(ws, 'Calibri', 12);   // todas as letras: Calibri 12
    return ws;
  }

  /**
   * V902: EXTRAÇÃO FILTRADA — a segunda opção de exportação do botão
   * flutuante. Gera na hora, sem modal, um Excel com EXATAMENTE as linhas
   * que a matriz do Consolidado está mostrando (filtrarConsolidado = a mesma
   * régua da tela: colunas marcadas no multi + "contém…"). O layout segue as
   * colunas da matriz + Produzido (Part.) + Valor repasse.
   */
  async function exportarConsolidadoFiltrado() {
    if (!state.competencia) { Utilidades.toast?.('Selecione um mês primeiro.', 'error', 3000); return; }
    if (typeof ExcelJS === 'undefined') {
      Utilidades.toast?.('Biblioteca ExcelJS ainda carregando — tente de novo em instantes.', 'error', 3500);
      return;
    }
    let linhas;
    try { linhas = linhasConsolidado(); }
    catch (e) { console.error('[relatorios] extração filtrada:', e); Utilidades.toast?.(`Erro: ${e.message}`, 'error', 4000); return; }
    const espMapCons = mapaEspecialidades();
    for (const l of linhas) if (l.especialidade === undefined) l.especialidade = especialidadeDe(espMapCons, l.admissao, l.descricao);
    const filtradas = filtrarConsolidado(linhas);
    if (!filtradas.length) { Utilidades.toast?.('Nenhuma linha com os filtros atuais.', 'error', 3500); return; }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Consolidado (filtro)', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = CONS_COLS.map(c => ({
      header: c.label.toUpperCase(), key: c.campo,
      width: c.campo === 'descricao' ? 44 : c.campo === 'profissional' || c.campo === 'paciente' ? 30 : 15,
    })).concat([
      { header: 'PRODUZIDO (PART.)', key: 'produzido', width: 17 },
      { header: 'VALOR REPASSE', key: 'valor', width: 16 },
    ]);
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16456B' } };
    head.alignment = { vertical: 'middle' };
    head.height = 20;
    // V929: TODO texto da extração filtrada sai em CAIXA ALTA, independente da
    // grafia de origem (pedido do usuário) — números e valores ficam como são.
    const CAIXA_ALTA = (v) => (typeof v === 'string' ? v.toUpperCase() : v);
    const _rowsExtraidas = [];   // espelho para os testes de regressão
    for (const l of filtradas) {
      const row = {};
      for (const c of CONS_COLS) row[c.campo] = l[c.campo] == null ? '' : CAIXA_ALTA(l[c.campo]);
      row.produzido = typeof l.produzido === 'number' ? l.produzido : CAIXA_ALTA(l.produzido || '');
      row.valor = Number(l.valor) || 0;
      _rowsExtraidas.push(row);
      const r = ws.addRow(row);
      if (r.number % 2 === 0) {
        r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4FAFD' } };
      }
    }
    const nCols = CONS_COLS.length + 2;
    ws.getColumn(nCols - 1).numFmt = 'R$ #,##0.00';
    ws.getColumn(nCols).numFmt = 'R$ #,##0.00';
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: nCols } };
    const tot = ws.addRow({ descricao: 'TOTAL',
      valor: filtradas.reduce((s, l) => s + (Number(l.valor) || 0), 0) });
    tot.font = { bold: true };

    window.AtlasRelatorios = Object.assign(window.AtlasRelatorios || {}, { _ultimaExtracaoFiltrada: _rowsExtraidas });   // V929
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    baixarBlob(blob, `consolidado_filtrado_${state.competencia}_${ts}.xlsx`);
    Utilidades.toast?.(
      `✓ ${filtradas.length.toLocaleString('pt-BR')} linha(s) extraída(s)` +
      (temFiltroConsolidado() ? ' com os filtros da matriz' : ' — matriz sem filtro (foi tudo)'),
      'success', 3200);
  }

  function baixarBlob(blob, nomeArq) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArq;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // Re-anexa os DESENHOS do modelo (caixa de texto + logo) ao arquivo gerado.
  // O ExcelJS descarta caixas de texto ao salvar; aqui copiamos os drawings/media
  // do modelo de volta para o .xlsx (via JSZip) e religamos à 1ª planilha.
  async function reanexarDesenhos(saidaBuffer) {
    try {
      if (!_modeloBuffer || typeof JSZip === 'undefined') return saidaBuffer;
      const zModel = await JSZip.loadAsync(_modeloBuffer);
      const drawPaths = Object.keys(zModel.files).filter(p => /^xl\/drawings\/drawing\d+\.xml$/.test(p));
      if (!drawPaths.length) return saidaBuffer;   // modelo não tem desenho

      const zOut = await JSZip.loadAsync(saidaBuffer);

      // 1) copia drawings + media do modelo para a saída
      for (const p of Object.keys(zModel.files)) {
        if (/^xl\/drawings\//.test(p) || /^xl\/media\//.test(p)) {
          zOut.file(p, await zModel.file(p).async('uint8array'));
        }
      }

      // 2) Content_Types: Default png/jpeg + Override de cada drawing
      let ct = await zOut.file('[Content_Types].xml').async('string');
      const addDefault = (ext, tp) => {
        if (!new RegExp('Extension="' + ext + '"', 'i').test(ct))
          ct = ct.replace(/(<Types[^>]*>)/, (m) => m + '<Default Extension="' + ext + '" ContentType="' + tp + '"/>');
      };
      addDefault('png', 'image/png'); addDefault('jpeg', 'image/jpeg'); addDefault('jpg', 'image/jpeg');
      for (const dp of drawPaths) {
        const part = '/' + dp;
        if (ct.indexOf(part) < 0)
          ct = ct.replace('</Types>', '<Override PartName="' + part + '" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
      }
      zOut.file('[Content_Types].xml', ct);

      // 3) religa o desenho à 1ª planilha (no consolidado, sheet1 = modelo "Repasse")
      const sheetPath = Object.keys(zOut.files).find(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
      if (sheetPath) {
        const relsPath = sheetPath.replace(/(sheet\d+\.xml)$/, '_rels/$1.rels');
        let rels = zOut.file(relsPath)
          ? await zOut.file(relsPath).async('string')
          : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
        const alvo = '../drawings/' + drawPaths[0].split('/').pop();
        let relId;
        if (rels.indexOf('Target="' + alvo + '"') >= 0) {
          const m = rels.match(/Id="(rId\d+)"[^>]*drawing/);
          relId = m ? m[1] : 'rIdDraw1';
        } else {
          const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map(x => +x[1]);
          relId = 'rId' + ((ids.length ? Math.max(...ids) : 0) + 1);
          rels = rels.replace('</Relationships>',
            '<Relationship Id="' + relId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="' + alvo + '"/></Relationships>');
          zOut.file(relsPath, rels);
        }
        let sheet = await zOut.file(sheetPath).async('string');
        if (!/<drawing\s/.test(sheet)) {
          if (!/xmlns:r=/.test(sheet))
            sheet = sheet.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
          const tag = '<drawing r:id="' + relId + '"/>';
          if (/<tableParts/.test(sheet)) sheet = sheet.replace('<tableParts', tag + '<tableParts');
          else if (/<extLst/.test(sheet)) sheet = sheet.replace('<extLst', tag + '<extLst');
          else sheet = sheet.replace('</worksheet>', tag + '</worksheet>');
          zOut.file(sheetPath, sheet);
        }
      }

      return await zOut.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    } catch (e) {
      console.warn('[relatorios] reanexarDesenhos falhou; arquivo segue sem a caixa de texto', e);
      return saidaBuffer;
    }
  }

  async function baixarWb(wb, nomeBase) {
    let buffer = await wb.xlsx.writeBuffer();
    buffer = await reanexarDesenhos(buffer);   // devolve a caixa de texto/logo do modelo
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    baixarBlob(blob, `${nomeBase}_${ts}.xlsx`);
  }

  function sanitizeFile(nome) {
    return (String(nome || 'Sem nome').replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()) || 'Sem nome';
  }

  // preenche o MODELO real (preserva o template) com um conjunto de linhas → wb
  async function montarWbTemplate(linhas) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(_modeloBuffer);
    const ws = wb.getWorksheet(_modeloParse.sheetName) || wb.worksheets[0];
    const hr = _modeloParse.headerRow;
    const ultimaTpl = ws.rowCount;

    const clonar = (o) => (o ? JSON.parse(JSON.stringify(o)) : o);

    // Estilos de referência do template para as linhas de dados (mantém a ZEBRA):
    // estiloA = 1ª linha de dados (clara), estiloB = 2ª linha (faixa) — por coluna,
    // já capturando fonte (Arial), tamanho, alinhamento, bordas, preenchimento e R$.
    const linhaA = hr + 1;
    const linhaB = (hr + 2 <= ultimaTpl) ? hr + 2 : hr + 1;
    const estiloA = {}, estiloB = {};
    for (const cm of _modeloParse.colMap) {
      estiloA[cm.col] = clonar(ws.getRow(linhaA).getCell(cm.col).style);
      estiloB[cm.col] = clonar(ws.getRow(linhaB).getCell(cm.col).style);
    }

    let r = hr + 1;
    for (const l of linhas) {
      const row = ws.getRow(r);
      const clara = ((r - (hr + 1)) % 2 === 0);   // alterna a zebra como no modelo
      for (const cm of _modeloParse.colMap) {
        const cell = row.getCell(cm.col);
        cell.value = (cm.campo === 'valor') ? (Number(l.valor) || 0) : (l[cm.campo] != null ? l[cm.campo] : '');
        // aplica o estilo do modelo → uniformiza TODAS as linhas (inclusive além do template)
        const st = clonar(clara ? estiloA[cm.col] : estiloB[cm.col]);
        if (st) cell.style = st;
        if (cm.campo === 'valor' || cm.campo === 'produzido') cell.numFmt = 'R$ #,##0.00'; // V249
      }
      r++;
    }
    // NÃO uniformiza para Calibri — preserva o visual do modelo (Arial + hierarquia + zebra).
    return wb;
  }

  // gera um workbook para um conjunto de linhas — no modelo (se houver) ou padrão
  async function wbDeLinhas(linhas, nomeAba) {
    if (_modeloBuffer && _modeloParse) return await montarWbTemplate(linhas);
    const wb = new ExcelJS.Workbook();
    montarWS(wb, nomeAba || 'Consolidado', linhas, colunasSaida());
    return wb;
  }

  async function exportarFinal() {
    if (typeof ExcelJS === 'undefined') { Utilidades.toast?.('Biblioteca ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return; }
    if (!state.competencia) { Utilidades.toast?.('Selecione um mês.', 'error', 3500); return; }
    const abasSet = state.exportAbas, statusSet = state.exportStatus;
    if (abasSet && abasSet.size === 0) { Utilidades.toast?.('Selecione ao menos uma aba.', 'error', 3500); return; }
    if (statusSet && statusSet.size === 0) { Utilidades.toast?.('Selecione ao menos um status.', 'error', 3500); return; }

    Utilidades.toast?.('Gerando relatório…', 'info', 2000);
    // V601: cede a vez ANTES do trabalho pesado — o aviso de lembretes fecha
    // e o toast pinta; sem isso a tela parecia "travada na mensagem".
    await new Promise(r => setTimeout(r, 80));
    let linhas;
    try { linhas = coletarLinhas(abasSet, statusSet); }
    catch (e) { console.error('[relatorios] coletarLinhas:', e); Utilidades.toast?.('Erro ao coletar dados: ' + (e.message || e), 'error', 4500); return; }
    if (!linhas.length) { Utilidades.toast?.('Nada para exportar com os filtros atuais neste mês.', 'error', 4000); return; }

    try {
      if (state.exportTipo === 'medico') {
        // agrupa por médico (de-para). Exceção: Refractive Laser sai num
        // "arquivo" próprio, como se fosse um médico, chamado "Refractive Laser".
        const grupos = new Map();
        for (const l of linhas) {
          const med = (l.modulo === 'Refractive Laser') ? 'Refractive Laser'
            : resolverMedico(l._medicoReal || l.profissional);   // V844: o arquivo é do médico REAL
          if (!grupos.has(med)) grupos.set(med, []);
          grupos.get(med).push(l);
        }
        const ordenados = [...grupos.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR'));

        // V598: UM médico escolhido → um único .xlsx baixado direto (sem pasta/zip)
        if (state.exportMedico) {
          const alvo = ordenados.find(([med]) => med === state.exportMedico);
          if (!alvo) {
            Utilidades.toast?.(`Sem linhas para ${state.exportMedico} em ${state.competencia} com os filtros atuais.`, 'error', 4500);
            return;
          }
          const [med, ls] = alvo;
          const wb = await wbDeLinhas(ls, sanitizeSheet(med));
          await baixarWb(wb, `Relatorio_${sanitizeFile(med)}_${state.competencia}`);
          Utilidades.toast?.(`✓ Relatório de ${med} exportado (${ls.length} linhas · R$ ${fmt(ls.reduce((s, l) => s + (Number(l.valor) || 0), 0))}).`, 'success', 5200);
          state.modalExport = false; atualizarModal();
          return;
        }

        // Opção preferida: gravar os .xlsx numa PASTA real escolhida (sem zip)
        if (window.showDirectoryPicker) {
          let dir = null;
          try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); }
          catch (e) { if (e && e.name === 'AbortError') { Utilidades.toast?.('Exportação cancelada.', 'info', 2500); return; } dir = null; }
          if (dir) {
            try {
              const sub = await dir.getDirectoryHandle(`Relatorio_por_medico_${state.competencia}`, { create: true });
              const usados = new Set();
              for (const [med, ls] of ordenados) {
                const wb = await wbDeLinhas(ls, sanitizeSheet(med));
                const buf = await reanexarDesenhos(await wb.xlsx.writeBuffer());
                let arq = sanitizeFile(med); const base = arq; let i = 2;
                while (usados.has(arq.toLowerCase())) arq = `${base} (${i++})`;
                usados.add(arq.toLowerCase());
                const fh = await sub.getFileHandle(`${arq}.xlsx`, { create: true });
                const w = await fh.createWritable();
                await w.write(buf);
                await w.close();
              }
              Utilidades.toast?.(`✓ ${ordenados.length} arquivos salvos na pasta "Relatorio_por_medico_${state.competencia}".`, 'success', 5500);
              state.modalExport = false; atualizarModal();
              return;
            } catch (e) {
              console.warn('[relatorios] gravação em pasta falhou, usando .zip:', e);
              Utilidades.toast?.('Não consegui gravar na pasta; gerando .zip…', 'info', 3000);
            }
          }
        }

        // Reserva: .zip (navegador sem suporte à gravação em pasta)
        if (typeof JSZip === 'undefined') { Utilidades.toast?.('Biblioteca JSZip não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return; }
        const zip = new JSZip();
        const pasta = zip.folder(`Relatorio_por_medico_${state.competencia}`);
        const usados = new Set();
        for (const [med, ls] of ordenados) {
          const wb = await wbDeLinhas(ls, sanitizeSheet(med));
          const buf = await reanexarDesenhos(await wb.xlsx.writeBuffer());
          let arq = sanitizeFile(med); const base = arq; let i = 2;
          while (usados.has(arq.toLowerCase())) arq = `${base} (${i++})`;
          usados.add(arq.toLowerCase());
          pasta.file(`${arq}.xlsx`, buf);
        }
        const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
        baixarBlob(blob, `Relatorio_por_medico_${state.competencia}_${ts}.zip`);
        Utilidades.toast?.(`✓ ${ordenados.length} médicos exportados (.zip).`, 'success', 5000);
        state.modalExport = false; atualizarModal();
        return;
      }
      // consolidado
      const wb = await wbDeLinhas(linhas, 'Consolidado');
      // Aba TOTAIS: total por médico (Refractive Laser conta como um "médico" próprio)
      const totMed = new Map();
      for (const l of linhas) {
        const med = (l.modulo === 'Refractive Laser') ? 'Refractive Laser' : (l.profissional || '—');
        totMed.set(med, (totMed.get(med) || 0) + (Number(l.valor) || 0));
      }
      const linhasTotais = [...totMed.entries()]
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR'))
        .map(([medico, valor]) => ({ medico, valor }));
      montarWS(wb, 'TOTAIS', linhasTotais, [
        { header: 'MÉDICO', campo: 'medico', width: 42 },
        { header: 'TOTAL - MÊS', campo: 'valor', width: 18 },
      ]);
      await baixarWb(wb, `relatorio_consolidado_${state.competencia}`);
      Utilidades.toast?.(`✓ ${linhas.length} linhas exportadas${_modeloBuffer && _modeloParse ? ' no modelo' : ''}.`, 'success', 4500);
      state.modalExport = false; atualizarModal();
    } catch (e) {
      console.error('[relatorios] exportarFinal:', e);
      Utilidades.toast?.('Erro ao gerar Excel: ' + (e.message || e), 'error', 4500);
    }
  }

  // ── Modal de exportação ──────────────────────────────────────────────────
  function garantirSetsExport() {
    if (!state.exportAbas) state.exportAbas = new Set(['repasse', ...FICHARIOS_DESEMPENHO.map(f => f.id)]);
    if (!state.exportStatus) state.exportStatus = new Set(STATUS_OPCOES);
  }

  function renderModalExport() {
    if (!state.modalExport) return '';
    garantirSetsExport();
    // V775: sem aba própria também aqui — o valor sai no consolidado, sempre.
    const abas = [{ id: 'repasse', nome: 'Relatório Repasse' }]
      .concat(FICHARIOS_DESEMPENHO
        .filter(f => !SEM_FICHARIO_PROPRIO.has(f.id))
        .map(f => ({ id: f.id, nome: f.nome })));
    const chkAbas = abas.map(a => `
      <label class="rel-chk">
        <input type="checkbox" data-export-aba="${a.id}" ${state.exportAbas.has(a.id) ? 'checked' : ''}>
        <span>${esc(a.nome)}</span>
      </label>`).join('');
    const chkStatus = STATUS_OPCOES.map(s => `
      <label class="rel-chk">
        <input type="checkbox" data-export-status="${esc(s)}" ${state.exportStatus.has(s) ? 'checked' : ''}>
        <span>${esc(s)}</span>
      </label>`).join('');
    const modeloInfo = _modeloNome
      ? `<div class="rel-modelo-ok">✓ Modelo: <strong>${esc(_modeloNome)}</strong>${_modeloParse ? ` · ${_modeloParse.colMap.length} colunas reconhecidas` : ' · <span class="rel-modelo-warn">cabeçalho não reconhecido</span>'}</div>`
      : `<div class="rel-modelo-vazio">Nenhum modelo — será usado o formato padrão.</div>`;

    return `
      <div class="rel-modal-overlay" data-export-fechar-overlay>
        <div class="rel-modal" role="dialog">
          <div class="rel-modal-head">
            <h3>↓ Exportar relatório · <span class="rel-modal-mes">${esc(state.competencia || '—')}</span></h3>
            <button class="rel-modal-x" data-export-fechar title="Fechar">✕</button>
          </div>
          <div class="rel-modal-body">
            <div class="rel-modal-sec">
              <div class="rel-modal-lbl">Tipo de extração</div>
              <div class="rel-tipo-opcoes">
                <label class="rel-radio ${state.exportTipo === 'consolidado' ? 'ativo' : ''}">
                  <input type="radio" name="rel-tipo" data-export-tipo="consolidado" ${state.exportTipo === 'consolidado' ? 'checked' : ''}>
                  <span><strong>Consolidado</strong><small>Todas as abas numa só planilha</small></span>
                </label>
                <label class="rel-radio ${state.exportTipo === 'medico' ? 'ativo' : ''}">
                  <input type="radio" name="rel-tipo" data-export-tipo="medico" ${state.exportTipo === 'medico' ? 'checked' : ''}>
                  <span><strong>Por médico</strong><small>Todos (um arquivo por médico) ou apenas um médico escolhido</small></span>
                </label>
              </div>
              ${state.exportTipo === 'medico' ? (() => {
                // V598: escolher UM médico específico ou manter todos
                let meds = [];
                try {
                  meds = (Banco.query(`SELECT nome_oficial FROM medicos
                                        WHERE tipo_vinculo IN ('INTERNO','HIBRIDO') AND ativo = 1
                                        ORDER BY nome_oficial`) || []).map(m => m.nome_oficial);
                } catch (_) {}
                return `
                <div style="margin-top: 10px">
                  <div class="rel-modal-lbl">Qual médico?</div>
                  <select class="rel-select" data-export-medico style="max-width: 430px; width: 100%">
                    <option value="">Todos os médicos (um arquivo por médico)</option>
                    ${meds.map(m => `<option value="${esc(m)}" ${state.exportMedico === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
                    <option value="Refractive Laser" ${state.exportMedico === 'Refractive Laser' ? 'selected' : ''}>Refractive Laser (arquivo próprio)</option>
                  </select>
                </div>`;
              })() : ''}
            </div>
            <div class="rel-modal-sec">
              <div class="rel-modal-lbl">Status incluídos</div>
              <div class="rel-chk-grid">${chkStatus}</div>
            </div>
            <div class="rel-modal-sec">
              <div class="rel-modal-lbl">Abas (fichários) incluídos</div>
              <div class="rel-chk-grid">${chkAbas}</div>
            </div>
            <div class="rel-modal-sec">
              <div class="rel-modal-lbl">Coluna V.TAB (versão da Base Tabela)</div>
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:12.5px">
                <input type="checkbox" data-export-vtab ${state.exportVTab ? 'checked' : ''}>
                <span>Incluir a coluna <strong>V.TAB</strong> na extração — mostra a versão da Base Tabela aplicada na regra de cada linha (informação interna; desmarcado, o relatório sai como sempre).</span>
              </label>
            </div>
            <div class="rel-modal-sec">
              <div class="rel-modal-lbl">Modelo de planilha (opcional)</div>
              <div class="rel-modelo-wrap">
                <button class="rel-btn-modelo" data-export-modelo-btn>↑ Importar modelo (.xlsx)</button>
                ${_modeloNome ? `<button class="rel-btn-modelo-x" data-export-modelo-limpar title="Remover modelo">×</button>` : ''}
                <input type="file" accept=".xlsx,.xls" data-export-modelo-input style="display:none">
              </div>
              ${modeloInfo}
              <p class="rel-modelo-dica">A saída é preenchida no seu modelo (preservando o layout). No modo <strong>Por médico</strong>, cada arquivo do .zip sai no mesmo modelo. O modelo precisa ter uma linha de cabeçalho com nomes como Status, Módulo, Admissão, Data, Papel, Profissional, Origem, Convênio, Descrição e Valor.</p>
            </div>
          </div>
          <div class="rel-modal-foot">
            <button class="rel-btn-cancelar" data-export-fechar>Cancelar</button>
            <button class="rel-btn-exportar-go" data-export-go>↓ Exportar ${esc(state.competencia || '')}</button>
          </div>
        </div>
      </div>`;
  }

  function atualizarModal() {
    const cont = document.getElementById('rel-modal-container');
    if (!cont) return;
    cont.innerHTML = renderModalExport() + renderModalAvulsa() + renderModalComplementos();
    bindModal();
    bindModalAvulsa();
    bindModalComplementos();   // V621
  }

  function bindModal() {
    if (!state.modalExport) return;
    document.querySelectorAll('[data-export-fechar]').forEach(b => b.addEventListener('click', () => { state.modalExport = false; atualizarModal(); }));
    const ov = document.querySelector('[data-export-fechar-overlay]');
    if (ov) ov.addEventListener('click', (e) => { if (e.target === ov) { state.modalExport = false; atualizarModal(); } });

    document.querySelectorAll('[data-export-tipo]').forEach(r => r.addEventListener('change', () => { state.exportTipo = r.dataset.exportTipo; atualizarModal(); }));
    // V638: incluir/excluir a coluna V.TAB na extração
    const chkVTab = document.querySelector('[data-export-vtab]');
    if (chkVTab) chkVTab.addEventListener('change', () => { state.exportVTab = chkVTab.checked; });
    // V598: seletor de médico específico no modo "Por médico"
    const selMed = document.querySelector('[data-export-medico]');
    if (selMed) selMed.addEventListener('change', () => { state.exportMedico = selMed.value; });
    document.querySelectorAll('[data-export-aba]').forEach(c => c.addEventListener('change', () => {
      const id = c.dataset.exportAba; if (c.checked) state.exportAbas.add(id); else state.exportAbas.delete(id);
    }));
    document.querySelectorAll('[data-export-status]').forEach(c => c.addEventListener('change', () => {
      const s = c.dataset.exportStatus; if (c.checked) state.exportStatus.add(s); else state.exportStatus.delete(s);
    }));

    const btnMod = document.querySelector('[data-export-modelo-btn]');
    const inpMod = document.querySelector('[data-export-modelo-input]');
    if (btnMod && inpMod) btnMod.addEventListener('click', () => inpMod.click());
    if (inpMod) inpMod.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const buf = await f.arrayBuffer();
        _modeloBuffer = buf; _modeloNome = f.name;
        try { _modeloParse = await parseModelo(buf); } catch (err) { _modeloParse = null; }
      } catch (err) { Utilidades.toast?.('Erro ao ler o modelo: ' + (err.message || err), 'error', 4500); }
      atualizarModal();
    });
    const limpar = document.querySelector('[data-export-modelo-limpar]');
    if (limpar) limpar.addEventListener('click', () => { _modeloBuffer = null; _modeloNome = ''; _modeloParse = null; atualizarModal(); });

    const go = document.querySelector('[data-export-go]');
    if (go) go.addEventListener('click', exportarFinal);
  }

  // ── Modal de LINHAS AVULSAS (manuais) ────────────────────────────────────
  function renderModalAvulsa() {
    if (!state.modalAvulsa) return '';
    const comp = state.competencia || '';
    let medicos = [];
    try { medicos = Banco.query(`SELECT id, nome_oficial FROM medicos WHERE ativo = 1 ORDER BY nome_oficial`) || []; } catch (e) {}
    const optMed = ['<option value="">— selecione —</option>']
      .concat(medicos.map(m => `<option value="${m.id}">${esc(CodigoMedico.exibir(m.nome_oficial))}</option>`)).join('');
    const manuais = carregarLinhasManuais(comp);
    const linhasHtml = manuais.length ? manuais.map(m => `
      <tr>
        <td>${esc(m.status || '')}</td><td>${esc(m.modulo || '')}</td>
        <td>${esc(m.admissao || '')}</td><td>${esc(m.data ? fmtDataAdm(m.data) : '')}</td>
        <td>${esc(m.papel || '')}</td><td>${esc(CodigoMedico.exibir(m.profissional || ''))}</td>
        <td>${esc(m.paciente || '')}</td><td>${m.origem ? Utilidades.badgeFonte(m.origem) : ''}</td>
        <td>${esc(m.convenio || '')}</td><td>${esc(m.descricao || '')}</td>
        <td style="text-align:right">R$ ${fmt(Number(m.valor) || 0)}</td>
        <td style="text-align:center"><button class="rel-modal-x" data-avulsa-del="${m.id}" title="Excluir">✕</button></td>
      </tr>`).join('') : `<tr><td colspan="12" style="text-align:center;color:var(--ink-faint);padding:12px">Nenhuma linha avulsa neste mês ainda.</td></tr>`;

    const estiloCampo = 'padding:6px 8px;border:1px solid var(--border);border-radius:6px;font:inherit;width:100%;box-sizing:border-box';
    const campo = (label, inner) => `<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--ink-soft)"><span>${label}</span>${inner}</label>`;
    const inp = (id, tipo, extra) => `<input id="${id}" type="${tipo || 'text'}" ${extra || ''} style="${estiloCampo}">`;

    return `
      <div class="rel-modal-overlay" data-avulsa-fechar-overlay>
        <div class="rel-modal" role="dialog" style="max-width:940px">
          <div class="rel-modal-head">
            <h3>➕ Linha avulsa · <span class="rel-modal-mes">${esc(comp || '—')}</span></h3>
            <button class="rel-modal-x" data-avulsa-fechar title="Fechar">✕</button>
          </div>
          <div class="rel-modal-body">
            <div class="rel-modal-sec">
              <div class="rel-modal-lbl">Nova linha (mesmo formato da matriz) — entra sempre no consolidado e na exportação deste mês</div>
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
                ${campo('Status', inp('av-status', 'text', 'placeholder="Avulso"'))}
                ${campo('Módulo', inp('av-modulo', 'text', 'placeholder="Avulso"'))}
                ${campo('Admissão', inp('av-admissao'))}
                ${campo('Data', inp('av-data', 'date'))}
                ${campo('Papel', inp('av-papel'))}
                ${campo('Profissional', `<select id="av-medico" style="${estiloCampo}">${optMed}</select>`)}
                ${campo('Paciente', inp('av-paciente'))}
                ${campo('Origem', `<select id="av-origem" style="${estiloCampo}"><option value="CONVENIO">Convênio</option><option value="PARTICULAR">Particular</option><option value="SUS">SUS</option></select>`)}
                ${campo('Convênio', inp('av-convenio'))}
                ${campo('Descrição', inp('av-descricao'))}
                ${campo('Valor repasse (R$)', inp('av-valor', 'number', 'step="0.01" min="0"'))}
                <div style="display:flex;align-items:flex-end"><button class="rel-btn-exportar-go" data-avulsa-add style="width:100%">➕ Adicionar</button></div>
              </div>
            </div>
            <div class="rel-modal-sec">
              <div class="rel-modal-lbl">Linhas avulsas deste mês (${manuais.length})</div>
              <div style="max-height:240px;overflow:auto;border:1px solid var(--border);border-radius:8px">
                <table class="rel-tab" style="width:100%;font-size:11px">
                  <thead><tr>
                    <th>Status</th><th>Módulo</th><th>Admissão</th><th>Data</th><th>Papel</th>
                    <th>Profissional</th><th>Paciente</th><th>Origem</th><th>Convênio</th><th>Descrição</th>
                    <th style="text-align:right">Valor</th><th></th>
                  </tr></thead>
                  <tbody>${linhasHtml}</tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="rel-modal-foot">
            <button class="rel-btn-cancelar" data-avulsa-fechar>Fechar</button>
          </div>
        </div>
      </div>`;
  }

  // ── V621: INSERIR COMPLEMENTOS (importação em lote pro Consolidado) ───────
  // Lê um relatório .xlsx com as MESMAS colunas do Consolidado e insere tudo
  // como linhas de complemento (mesmo caminho da Linha avulsa), num LOTE
  // identificado — dá pra desfazer o arquivo inteiro com um clique.
  let _compPreview = null;   // { nomeArq, rows, ignoradas, naoReconhecidos, totalValor } | { erro }

  const COMP_CAMPOS = {
    'STATUS': 'status', 'MODULO': 'modulo', 'ADMISSAO': 'admissao', 'DATA': 'data',
    'PAPEL': 'papel', 'PROFISSIONAL': 'profissional', 'PACIENTE': 'paciente',
    'ORIGEM': 'origem', 'CONVENIO': 'convenio', 'DESCRICAO': 'descricao',
    'VALOR REPASSE': 'valor', 'VALOR REPASSE (R$)': 'valor', 'VALOR (R$)': 'valor',
    'VALOR': 'valor', 'REPASSE': 'valor',
  };
  function _compNorm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z0-9()$ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function _compData(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v.getTime())) {
      const p = (n) => String(n).padStart(2, '0');
      return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
    }
    const s = String(v).trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const ano = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    return s;
  }
  function parseArquivoComplementos(buffer, nomeArq) {
    let wb;
    // raw:true → CSV fica como texto (evita o parser US trocar dia/mês em "05/12/2099");
    // .xlsx mantém os tipos das células normalmente (datas reais viram Date via cellDates)
    try { wb = XLSX.read(buffer, { type: 'array', cellDates: true, raw: true }); }
    catch (e) { return { erro: 'Não consegui ler o arquivo (.xlsx/.xls/.csv): ' + (e.message || e) }; }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return { erro: 'Arquivo sem planilha legível.' };
    const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    // acha o cabeçalho: linha com PROFISSIONAL + alguma coluna de VALOR
    let mapa = null, hIdx = -1;
    for (let i = 0; i < Math.min(matriz.length, 25); i++) {
      const m = {};
      (matriz[i] || []).forEach((c, j) => {
        const k = _compNorm(c);
        if (k && COMP_CAMPOS[k] != null && m[COMP_CAMPOS[k]] == null) m[COMP_CAMPOS[k]] = j;
      });
      if (m.profissional != null && m.valor != null) { mapa = m; hIdx = i; break; }
    }
    if (!mapa) return { erro: 'Cabeçalho não encontrado. O relatório precisa ter as colunas do Consolidado — no mínimo "Profissional" e "Valor repasse".' };
    // de-para de médicos pra tentar vincular o cadastro (não obrigatório)
    const mapMed = new Map();
    try {
      (Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM medicos WHERE ativo = 1`) || [])
        .forEach(m => { mapMed.set(_compNorm(m.nome_normalizado || m.nome_oficial), m.id); mapMed.set(_compNorm(m.nome_oficial), m.id); });
      (Banco.query(`SELECT medico_id, grafia, grafia_normalizada FROM sinonimos_medico`) || [])
        .forEach(s => { const k = _compNorm(s.grafia_normalizada || s.grafia); if (k && !mapMed.has(k)) mapMed.set(k, s.medico_id); });
    } catch (_) {}
    const rows = [];
    const naoRec = new Set();
    let ignoradas = 0, totalValor = 0;
    for (let i = hIdx + 1; i < matriz.length; i++) {
      const lin = matriz[i] || [];
      const cel = (campo) => (mapa[campo] != null ? lin[mapa[campo]] : null);
      const prof = String(cel('profissional') == null ? '' : cel('profissional')).trim();
      const valor = Utilidades.parseNumBR(cel('valor'), null);
      if (!prof && valor == null) continue;              // linha vazia/total
      if (!prof || valor == null) { ignoradas++; continue; }   // incompleta
      const medicoId = mapMed.get(_compNorm(prof)) || null;
      if (!medicoId) naoRec.add(prof);
      totalValor += valor;
      rows.push({
        status: String(cel('status') == null ? '' : cel('status')).trim() || 'Complemento',
        modulo: String(cel('modulo') == null ? '' : cel('modulo')).trim() || 'Complemento',
        admissao: String(cel('admissao') == null ? '' : cel('admissao')).trim(),
        data: _compData(cel('data')),
        papel: String(cel('papel') == null ? '' : cel('papel')).trim(),
        profissional: prof, medico_id: medicoId,
        paciente: String(cel('paciente') == null ? '' : cel('paciente')).trim(),
        origem: String(cel('origem') == null ? '' : cel('origem')).trim() || 'CONVENIO',
        convenio: String(cel('convenio') == null ? '' : cel('convenio')).trim(),
        descricao: String(cel('descricao') == null ? '' : cel('descricao')).trim(),
        valor,
      });
    }
    if (!rows.length) return { erro: 'Nenhuma linha válida no arquivo (cada linha precisa de Profissional e Valor repasse).' };
    return { nomeArq, rows, ignoradas, naoReconhecidos: [...naoRec], totalValor };
  }

  function lotesComplementos(comp) {
    try {
      garantirTabelaAvulsas();
      return Banco.query(
        `SELECT lote, COUNT(*) AS n, COALESCE(SUM(valor),0) AS total
           FROM consolidado_linhas_manuais
          WHERE competencia = ? AND lote IS NOT NULL AND lote <> ''
          GROUP BY lote ORDER BY MAX(id) DESC`, [comp]) || [];
    } catch (_) { return []; }
  }

  function renderModalComplementos() {
    if (!state.modalComplementos) return '';
    const comp = state.competencia || '';
    const p = _compPreview;
    const lotes = lotesComplementos(comp);
    const previewHtml = !p ? '' : p.erro
      ? `<div class="rel-comp-erro">⚠ ${esc(p.erro)}</div>`
      : `
        <div class="rel-comp-resumo">
          <strong>${p.rows.length}</strong> linha${p.rows.length === 1 ? '' : 's'} lida${p.rows.length === 1 ? '' : 's'} de <em>${esc(p.nomeArq)}</em>
          · total <strong>R$ ${fmt(p.totalValor)}</strong>
          ${p.ignoradas ? ` · <span class="rel-comp-warn">${p.ignoradas} incompleta${p.ignoradas === 1 ? '' : 's'} ignorada${p.ignoradas === 1 ? '' : 's'}</span>` : ''}
          ${p.naoReconhecidos.length ? `<div class="rel-comp-warn" style="margin-top:4px">⚠ Profissionais fora do cadastro (entram com o nome como está): ${esc(p.naoReconhecidos.slice(0, 5).join(', '))}${p.naoReconhecidos.length > 5 ? ` +${p.naoReconhecidos.length - 5}` : ''}</div>` : ''}
        </div>
        <div style="max-height:230px;overflow:auto;border:1px solid var(--border);border-radius:8px">
          <table class="rel-tab" style="width:100%;font-size:11px">
            <thead><tr><th>Status</th><th>Módulo</th><th>Admissão</th><th>Data</th><th>Papel</th><th>Profissional</th><th>Origem</th><th>Descrição</th><th style="text-align:right">Valor</th></tr></thead>
            <tbody>${p.rows.slice(0, 200).map(r => `
              <tr>
                <td>${esc(r.status)}</td><td>${esc(r.modulo)}</td><td>${esc(r.admissao)}</td>
                <td>${esc(r.data ? fmtDataAdm(r.data) : '')}</td><td>${esc(r.papel)}</td>
                <td>${esc(r.profissional)}${r.medico_id ? '' : ' <small style="color:#9A4E22">⚠</small>'}</td>
                <td>${r.origem ? Utilidades.badgeFonte(r.origem) : ''}</td><td>${esc(r.descricao)}</td>
                <td style="text-align:right">R$ ${fmt(r.valor)}</td>
              </tr>`).join('')}
              ${p.rows.length > 200 ? `<tr><td colspan="9" style="text-align:center;color:var(--ink-faint)">… +${p.rows.length - 200} linhas</td></tr>` : ''}
            </tbody>
          </table>
        </div>
        <button class="rel-btn-exportar-go" data-comp-importar style="margin-top:10px">📥 Adicionar ${p.rows.length} complemento${p.rows.length === 1 ? '' : 's'} em ${esc(comp)}</button>`;
    const lotesHtml = lotes.length ? `
      <div class="rel-modal-sec">
        <div class="rel-modal-lbl">Lotes já importados neste mês (${lotes.length})</div>
        ${lotes.map(l => `
          <div class="rel-comp-lote">
            <span>${esc(l.lote)}</span>
            <span class="rel-comp-lote-info">${l.n} linha${l.n === 1 ? '' : 's'} · R$ ${fmt(l.total)}</span>
            <button class="rel-modal-x" data-comp-del-lote="${esc(l.lote)}" title="Remover este lote inteiro">✕</button>
          </div>`).join('')}
      </div>` : '';
    return `
      <div class="rel-modal-overlay" data-comp-fechar-overlay>
        <div class="rel-modal" role="dialog" style="max-width:960px">
          <div class="rel-modal-head">
            <h3>📥 Inserir complementos · <span class="rel-modal-mes">${esc(comp || '—')}</span></h3>
            <button class="rel-modal-x" data-comp-fechar title="Fechar">✕</button>
          </div>
          <div class="rel-modal-body">
            <div class="rel-modal-sec">
              <div class="rel-modal-lbl">Importe um relatório (.xlsx) com as mesmas colunas do Consolidado — todas as linhas entram de uma vez como complemento deste mês (em vez de digitar uma a uma na Linha avulsa)</div>
              <p style="margin:4px 0 10px;font-size:11.5px;color:var(--ink-soft)">
                Colunas reconhecidas: <strong>Status · Módulo · Admissão · Data · Papel · Profissional · Paciente · Origem · Convênio · Descrição · Valor repasse</strong>.
                Obrigatórias: <strong>Profissional</strong> e <strong>Valor repasse</strong> — as demais são opcionais. A 1ª planilha do arquivo é lida; um export do próprio Consolidado serve de modelo.
              </p>
              <input type="file" id="rel-comp-arquivo" accept=".xlsx,.xls,.csv" style="font-size:12.5px">
              ${previewHtml}
            </div>
            ${lotesHtml}
          </div>
          <div class="rel-modal-foot">
            <button class="rel-btn-cancelar" data-comp-fechar>Fechar</button>
          </div>
        </div>
      </div>`;
  }

  function bindModalComplementos() {
    if (!state.modalComplementos) return;
    const fechar = () => { state.modalComplementos = false; _compPreview = null; atualizarModal(); };
    document.querySelectorAll('[data-comp-fechar]').forEach(b => b.addEventListener('click', fechar));
    const ov = document.querySelector('[data-comp-fechar-overlay]');
    if (ov) ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });

    const inp = document.getElementById('rel-comp-arquivo');
    if (inp) inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        _compPreview = parseArquivoComplementos(new Uint8Array(fr.result), f.name);
        atualizarModal();
      };
      fr.onerror = () => { _compPreview = { erro: 'Falha ao ler o arquivo.' }; atualizarModal(); };
      fr.readAsArrayBuffer(f);
    });

    const btnImp = document.querySelector('[data-comp-importar]');
    if (btnImp) btnImp.addEventListener('click', async () => {
      const p = _compPreview;
      if (!p || p.erro || !p.rows.length || !state.competencia) return;
      try {
        garantirTabelaAvulsas();
        const agora = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const lote = `${p.nomeArq} · ${pad(agora.getDate())}/${pad(agora.getMonth() + 1)}/${agora.getFullYear()} ${pad(agora.getHours())}:${pad(agora.getMinutes())}`;
        for (const r of p.rows) {
          Banco.executar(`INSERT INTO consolidado_linhas_manuais
            (competencia, status, modulo, admissao, data, papel, profissional, medico_id, paciente, origem, convenio, descricao, valor, lote)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [state.competencia, r.status, r.modulo, r.admissao, r.data, r.papel,
             r.profissional, r.medico_id, r.paciente, r.origem, r.convenio, r.descricao, r.valor, lote]);
        }
        await Banco.salvar();
        _consCache = { comp: null, linhas: null };
        try { delete _consCacheVG[state.competencia]; } catch (_) {}
        Utilidades.toast?.(`✓ ${p.rows.length} complemento${p.rows.length === 1 ? '' : 's'} adicionado${p.rows.length === 1 ? '' : 's'} ao Consolidado de ${state.competencia} (R$ ${fmt(p.totalValor)})`, 'success', 5000);
        _compPreview = null;
        atualizarModal();
        renderConteudo();
      } catch (e) {
        console.error('[relatorios] importar complementos', e);
        alert('❌ Erro ao importar:\n\n' + (e.message || e));
      }
    });

    document.querySelectorAll('[data-comp-del-lote]').forEach(b => {
      b.addEventListener('click', async () => {
        const lote = b.dataset.compDelLote;
        if (!lote) return;
        if (!confirm(`Remover o lote inteiro?\n\n${lote}`)) return;
        try {
          Banco.executar(`DELETE FROM consolidado_linhas_manuais WHERE competencia = ? AND lote = ?`, [state.competencia, lote]);
          await Banco.salvar();
          _consCache = { comp: null, linhas: null };
          try { delete _consCacheVG[state.competencia]; } catch (_) {}
          Utilidades.toast?.('✓ Lote removido do Consolidado.', 'success', 3000);
          atualizarModal();
          renderConteudo();
        } catch (e) { console.error('[relatorios] del lote', e); }
      });
    });
  }

  function bindModalAvulsa() {
    if (!state.modalAvulsa) return;
    const fechar = () => { state.modalAvulsa = false; atualizarModal(); };
    document.querySelectorAll('[data-avulsa-fechar]').forEach(b => b.addEventListener('click', fechar));
    const ov = document.querySelector('[data-avulsa-fechar-overlay]');
    if (ov) ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });

    const add = document.querySelector('[data-avulsa-add]');
    if (add) add.addEventListener('click', async () => {
      if (!state.competencia) { Utilidades.toast?.('Selecione um mês primeiro.', 'error', 3000); return; }
      const v = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
      const selMed = document.getElementById('av-medico');
      const medicoId = selMed && selMed.value ? parseInt(selMed.value, 10) : null;
      const profissional = (selMed && selMed.selectedIndex > 0) ? selMed.options[selMed.selectedIndex].text : '';
      if (!medicoId || !profissional) { Utilidades.toast?.('Escolha o profissional.', 'error', 3000); return; }
      const valor = parseFloat(document.getElementById('av-valor')?.value) || 0;
      try {
        garantirTabelaAvulsas();
        Banco.executar(`INSERT INTO consolidado_linhas_manuais
          (competencia, status, modulo, admissao, data, papel, profissional, medico_id, paciente, origem, convenio, descricao, valor)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [state.competencia, v('av-status') || 'Avulso', v('av-modulo') || 'Avulso',
           v('av-admissao'), v('av-data'), v('av-papel'), profissional, medicoId,
           v('av-paciente'), v('av-origem') || 'CONVENIO', v('av-convenio'),
           v('av-descricao'), valor]);
        await Banco.salvar();
        _consCache = { comp: null, linhas: null };   // invalida cache do consolidado
        Utilidades.toast?.('✓ Linha avulsa adicionada', 'success', 2500);
        atualizarModal();   // re-renderiza modal (lista atualiza, form limpa)
        renderConteudo();   // atualiza a tabela do consolidado por trás
      } catch (e) {
        console.error('[relatorios] add avulsa', e);
        alert('❌ Erro ao adicionar:\n\n' + (e.message || e));
      }
    });

    document.querySelectorAll('[data-avulsa-del]').forEach(b => {
      b.addEventListener('click', async () => {
        const id = parseInt(b.dataset.avulsaDel, 10);
        if (!id) return;
        if (!confirm('Excluir esta linha avulsa?')) return;
        try {
          Banco.executar(`DELETE FROM consolidado_linhas_manuais WHERE id = ?`, [id]);
          await Banco.salvar();
          _consCache = { comp: null, linhas: null };
          atualizarModal();
          renderConteudo();
        } catch (e) { console.error('[relatorios] del avulsa', e); }
      });
    });
  }

  // ── CSS ────────────────────────────────────────────────────────────────
  const CSS = `
    .rel-tela { padding: 4px 2px 40px; }
    .rel-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 16px; }
    .rel-header-titulo h2 { margin: 0 0 4px; font-family: var(--font-display); font-weight: 500; }
    .rel-header-titulo p { margin: 0; color: var(--ink-soft); font-size: 13px; max-width: 640px; line-height: 1.5; }
    .rel-comp-wrap { display: flex; flex-direction: column; gap: 4px; }
    .rel-cons-filtros th { padding: 4px 6px !important; background: var(--bg-sunken); position: sticky; top: 0; }
    .rel-cons-cell { display: flex; flex-direction: column; gap: 3px; min-width: 110px; }
    .rel-cons-sel {
      width: 100%; box-sizing: border-box; padding: 3px 5px; font-family: inherit; font-size: 11px;
      border: 1px solid var(--border); border-radius: 6px; background: var(--bg-elevated); color: var(--ink); cursor: pointer;
    }
    .rel-cons-sel:focus { outline: none; border-color: var(--primary); }
    /* V902/V905: dropdown multi (checkboxes) das colunas do Consolidado.
       O painel vive no <body> (position:fixed, ancorado no botão) — imune a
       sticky/overflow/z-index da tabela em qualquer zoom. */
    .rel-msel-wrap { position: relative; }
    .rel-msel-btn { display: flex; align-items: center; gap: 4px; min-height: 21px; }
    .rel-msel-rot {
      flex: 1; min-width: 0; text-align: left;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .rel-msel-caret { flex: 0 0 auto; font-size: 9px; opacity: 0.75; }
    /* V922: filtro ativo SEM o destaque azul (pedido do usuário — parecia crítica);
       só o negrito marca que há filtro aplicado */
    .rel-msel-btn.rel-msel-on { font-weight: 700; }
    .rel-msel-btn.rel-msel-aberto { border-color: #3f6489; box-shadow: 0 0 0 2px rgba(63, 100, 137,0.15); }
    .rel-msel-pop {
      position: fixed;
      width: max-content; max-width: 360px;
      overflow-y: auto;
      background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 9px;
      box-shadow: 0 10px 26px rgba(0,0,0,0.18);
      padding: 5px; z-index: 100010;
      text-transform: none; font-weight: 400; letter-spacing: normal;
      text-align: left; color: var(--ink);
    }
    .rel-msel-mais { color: var(--ink-faint); cursor: default; font-size: 10.5px; }
    .rel-msel-opt {
      display: flex; align-items: flex-start; gap: 7px;
      padding: 6px 8px; border-radius: 6px; cursor: pointer;
      font-size: 11.5px; color: var(--ink); line-height: 1.3;
    }
    .rel-msel-opt:hover { background: rgba(63, 100, 137,0.08); }
    .rel-msel-opt.on { color: #46688c; font-weight: 600; }
    .rel-msel-cbx {
      flex: 0 0 14px; width: 14px; height: 14px; margin-top: 1px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1.5px solid #9DBECE; border-radius: 4px; background: #fff;
      color: #fff; font-size: 10px; font-weight: 800; line-height: 1;
    }
    .rel-msel-cbx.on { background: #3f6489; border-color: #3f6489; }
    /* V904: no FILTRO o texto sai inteiro (sem "…") e em caixa alta */
    .rel-msel-txt {
      text-transform: uppercase;
      white-space: normal; word-break: break-word;
    }
    .rel-msel-todos { border-bottom: 1px dashed var(--border); border-radius: 6px 6px 0 0; margin-bottom: 3px; }
    .rel-msel-pop-dir { left: auto; right: 0; }
    .rel-cons-fil {
      width: 100%; box-sizing: border-box; padding: 4px 7px; font-family: inherit; font-size: 11.5px;
      border: 1px solid var(--border); border-radius: 6px; background: var(--bg-elevated); color: var(--ink);
    }
    .rel-cons-fil:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 2px rgba(89, 128, 166,0.12); }
    .rel-cons-fil::placeholder { color: var(--ink-faint); font-size: 10.5px; }
    .rel-tab-cons thead tr:first-child th { position: sticky; top: 0; }
    .rel-trunc { margin-top: 10px; padding: 8px 12px; font-size: 12px; color: var(--ink-soft); background: var(--bg-sunken); border-radius: 8px; }
    .rel-topo-acoes { display: flex; align-items: flex-end; gap: 12px; flex-shrink: 0; }
    .rel-btn-exportar {
      padding: 9px 16px; border: 1.5px solid var(--primary); border-radius: 10px;
      background: var(--primary); color: #fff; font-family: inherit; font-size: 13px; font-weight: 700;
      cursor: pointer; white-space: nowrap; transition: opacity 150ms;
    }
    .rel-btn-exportar:hover { opacity: 0.88; }
    .rel-modal-overlay { position: fixed; inset: 0; background: rgba(30,30,28,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
    .rel-modal { background: var(--bg-elevated); border-radius: 16px; width: 100%; max-width: 580px; max-height: 88vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden; }
    .rel-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
    .rel-modal-head h3 { margin: 0; font-family: var(--font-display); font-weight: 500; font-size: 16px; }
    .rel-modal-mes { color: var(--accent); font-family: var(--font-mono); font-size: 14px; }
    .rel-modal-x { border: none; background: transparent; font-size: 16px; cursor: pointer; color: var(--ink-faint); padding: 4px 8px; border-radius: 6px; }
    .rel-modal-x:hover { background: var(--bg-sunken); }
    .rel-modal-body { padding: 16px 20px; overflow-y: auto; }
    .rel-modal-sec { margin-bottom: 18px; }
    .rel-modal-lbl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint); margin-bottom: 8px; }
    .rel-tipo-opcoes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .rel-radio { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; cursor: pointer; transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms; }
    .rel-radio.ativo { border-color: var(--primary); background: rgba(89, 128, 166,0.05); }
    .rel-radio input { margin-top: 2px; }
    .rel-radio span { display: flex; flex-direction: column; gap: 2px; }
    .rel-radio strong { font-size: 13px; color: var(--ink); }
    .rel-radio small { font-size: 11px; color: var(--ink-faint); line-height: 1.3; }
    .rel-chk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; }
    .rel-chk { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--ink-soft); cursor: pointer; padding: 3px 0; }
    .rel-chk input { cursor: pointer; }
    .rel-modelo-wrap { display: flex; align-items: center; gap: 8px; }
    .rel-btn-modelo { padding: 8px 14px; border: 1.5px dashed var(--border); border-radius: 9px; background: var(--bg-sunken); font-family: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink-soft); cursor: pointer; }
    .rel-btn-modelo:hover { border-color: var(--primary); color: var(--primary); }
    .rel-btn-modelo-x { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 8px; width: 30px; height: 30px; cursor: pointer; color: var(--danger); font-size: 16px; }
    .rel-modelo-ok { margin-top: 8px; font-size: 12px; color: var(--primary); }
    .rel-modelo-warn { color: var(--danger); }
    .rel-modelo-vazio { margin-top: 8px; font-size: 12px; color: var(--ink-faint); }
    .rel-modelo-dica { margin: 8px 0 0; font-size: 11px; color: var(--ink-faint); line-height: 1.45; }
    .rel-modal-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--border); background: var(--bg-sunken); }
    .rel-btn-cancelar { padding: 9px 16px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg-elevated); font-family: inherit; font-size: 13px; font-weight: 600; color: var(--ink-soft); cursor: pointer; }
    .rel-btn-exportar-go { padding: 9px 18px; border: none; border-radius: 10px; background: var(--primary); color: #fff; font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
    /* V625: aviso de profissionais fora do consolidado (filtro interno/híbrido) */
    .rel-desc-aviso {
      margin: 0 0 14px; padding: 12px 14px; border-radius: 10px;
      background: rgba(193,138,74,0.09); border: 1px solid rgba(193,138,74,0.35);
    }
    .rel-desc-titulo { font-size: 13px; font-weight: 700; color: #8A5A22; margin-bottom: 8px; }
    .rel-desc-item {
      display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap;
      padding: 4px 0; border-top: 1px dashed rgba(193,138,74,0.25); font-size: 12px;
    }
    .rel-desc-nome { font-weight: 700; }
    .rel-desc-mod { color: var(--ink-soft); white-space: nowrap; }
    .rel-desc-motivo { color: #8A5A22; font-size: 11.5px; }
    .rel-desc-mais { padding-top: 6px; color: var(--ink-soft); font-size: 11.5px; }
    /* V621: importação de complementos em lote */
    .rel-comp-erro { margin-top: 10px; padding: 9px 12px; border-radius: 8px; background: rgba(193,138,74,0.10); color: #8A5A22; font-size: 12.5px; }
    .rel-comp-resumo { margin: 10px 0 8px; font-size: 12.5px; }
    .rel-comp-warn { color: #9A4E22; font-size: 11.5px; }
    .rel-comp-lote { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; margin-top: 6px; font-size: 12px; }
    .rel-comp-lote > span:first-child { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rel-comp-lote-info { color: var(--ink-soft); white-space: nowrap; }
    .rel-btn-exportar-go:hover { opacity: 0.9; }
    .rel-label { font-size: 11px; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.04em; }
    .rel-select { padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elevated); font-size: 13px; font-weight: 500; color: var(--ink); }

    .rel-fichas { display: flex; flex-wrap: wrap; gap: 6px; border-bottom: 2px solid var(--border); padding-bottom: 0; margin-bottom: 0; }
    .rel-ficha { font-size: 12px; padding: 8px 13px; border: 1px solid var(--border); border-bottom: none; border-radius: 8px 8px 0 0; background: var(--bg-sunken); color: var(--ink-faint); cursor: pointer; position: relative; top: 2px; transition: background .15s; }
    .rel-ficha:hover { background: var(--accent-soft); color: var(--ink); }
    .rel-ficha.ativa { background: var(--bg-elevated); color: var(--ink); font-weight: 500; border-bottom: 2px solid var(--bg-elevated); }
    .rel-ficha-repasse.ativa { color: var(--primary); }

    .rel-conteudo { background: var(--bg-elevated); border: 1px solid var(--border); border-top: none; border-radius: 0 0 12px 12px; padding: 18px 20px 22px; }
    .rel-loading { display: flex; align-items: center; gap: 10px; justify-content: center; padding: 48px 20px; color: var(--ink-soft); font-size: 13px; }
    .rel-loading-spin { width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--primary); border-radius: 50%; animation: rel-spin 0.7s linear infinite; }
    @keyframes rel-spin { to { transform: rotate(360deg); } }

    .rel-barra { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
    .rel-resumo { display: flex; gap: 22px; }
    .rel-acoes { display: flex; align-items: center; gap: 10px; }
    .rel-kpi { padding: 11px 16px; }
    .rel-kpi-lbl { font-size: 11px; color: #1d1f20; } /* V849: título dos cards totalizadores */
    .rel-kpi-val { font-size: 18px; font-weight: 500; font-family: var(--font-mono); }
    .rel-kpi-verde { color: var(--primary); }
    .rel-btn-excel { font-size: 12px; font-weight: 600; color: #fff; background: #3f6489; border: none; padding: 9px 16px; border-radius: 8px; cursor: pointer; }
    .rel-btn-excel:hover { background: #2BA9A9; }

    .rel-tab-wrap { border: 1px solid var(--bg-sunken); border-radius: 10px; overflow: auto; max-height: 64vh; }
    /* V594/V599: matriz Mês a mês (visão ampliada) — cabeçalho fixo + coluna fixa */
    .mm-scroll { max-height: 62vh; }
    /* V608: cabeçalho no MESMO degradê da Linha do tempo. V949: o degradê
       agora é o padrão global (style.css) e o js/cabecalho_degrade.js alinha
       as fatias por célula — nada de background-attachment fixed. */
    .mm-scroll thead th { color: #fff !important; }
    .mm-scroll thead tr.mm-cc th { top: 0; height: 18px; font-weight: 700; }
    .mm-scroll thead tr:nth-child(2) th { top: 37px; font-weight: 700; }
    .mm-scroll th, .mm-scroll td:first-child { white-space: nowrap; }
    .mm-scroll .rel-num { white-space: nowrap; }
    .mm-total .mm-val { font-weight: 700; }   /* V595: totalizador da linha */
    /* V608: CAMADAS corretas — o cabeçalho fixo SEMPRE acima das células do
       corpo (a coluna fixa do corpo passava por cima e "cortava" as datas) */
    .mm-scroll thead tr.mm-cc th { z-index: 7; }
    .mm-scroll thead tr:nth-child(2) th { z-index: 6; }
    .mm-scroll thead th.mm-fixo { z-index: 8 !important; }
    /* V599: coluna "Corpo Clínico" FIXA na esteira horizontal */
    .mm-scroll th.mm-fixo, .mm-scroll td.mm-fixo { position: sticky; left: 0; }
    .mm-scroll td.mm-fixo { background: #fff; box-shadow: 2px 0 4px rgba(0,0,0,.05); z-index: 2; }
    .mm-scroll tbody tr:nth-child(even) td.mm-fixo { background: #FAFAF7; }
    /* V599: cabeçalho ANO (acima) + MÊS */
    .mm-th-ano { display: block; font-size: 9.5px; font-weight: 800; letter-spacing: .06em; color: #e2f6fd; opacity: .85; }
    .mm-th-mes { display: block; }
    /* V599/V608: KPI Last Month — toda célula reserva a linha (valores alinhados) */
    .mm-val { display: block; }
    .mm-lm { display: block; font-size: 9.5px; font-weight: 800; letter-spacing: .02em; margin-top: 1px; min-height: 12px; }
    .mm-lm-vazio { visibility: hidden; }
    .mm-lm-up { color: #15a34a; }
    .mm-lm-down { color: #dc2626; }
    .mm-cc .mm-lm-up { color: #a8f5c9; }
    .mm-cc .mm-lm-down { color: #ffc4bd; }
    /* V608: seletor de ordenação no topo da visão ampliada */
    .mmov-ord { display: inline-flex; align-items: center; gap: 8px; font-size: 11.5px;
      font-weight: 700; color: var(--ink-soft, #4b5a55); }
    .mmov-ord select { padding: 7px 10px; }
    /* V599: visão AMPLIADA (overlay quase tela cheia) */
    .mmov-ov { position: fixed; inset: 0; z-index: 100000; background: rgba(29, 31, 32,.5);
      display: flex; align-items: center; justify-content: center; padding: 22px; }
    .mmov-painel { background: var(--bg-elevated, #fff); border-radius: 16px; width: 100%; height: 100%;
      max-width: 1780px; box-shadow: 0 24px 60px -20px rgba(29, 31, 32,.45); overflow: hidden;
      display: flex; flex-direction: column; }
    .mmov-head { display: flex; align-items: center; justify-content: space-between; gap: 14px;
      padding: 14px 20px; border-bottom: 1px solid var(--border, #eef0f2); }
    .mmov-titulo { font: 700 16px/1.2 'Inter Tight', -apple-system, sans-serif; color: var(--ink, #1d1f20); }
    .mmov-sub { font-size: 11.5px; color: var(--ink-faint, #7a8079); margin-top: 2px; }
    .mmov-acoes { display: flex; align-items: center; gap: 8px; }
    .mmov-x { width: 32px; height: 32px; border-radius: 8px; border: none; background: #f7f8fa;
      color: #585d62; font-size: 18px; line-height: 1; cursor: pointer; padding: 0; }
    .mmov-x:hover { background: #e5edf3; color: #3a5877; }
    .mmov-corpo { flex: 1; min-height: 0; padding: 14px 20px 18px; display: flex; flex-direction: column; }
    .mmov-corpo .mm-scroll { flex: 1; max-height: none; }   /* ocupa a tela toda */
    .rel-tab { width: 100%; border-collapse: collapse; font-size: 12px; }
    .rel-tab thead th { position: sticky; top: 0; background: #F7F3E9; color: var(--ink-soft); text-align: left; font-weight: 500; padding: 9px 10px; border-bottom: 1px solid var(--border); z-index: 1; }
    .rel-tab tbody td { padding: 8px 10px; border-top: 1px solid #f2f3f5; color: var(--ink); }
    .rel-tab tbody tr:nth-child(even) td { background: #FAFAF7; }
    .rel-mono { font-family: var(--font-mono); }
    .rel-data { color: var(--ink-soft); white-space: nowrap; }
    .rel-proc { max-width: 320px; }
    .rel-num { text-align: right; font-family: var(--font-mono); white-space: nowrap; }
    .rel-glosa { color: var(--danger); }

    .rel-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; color: #fff; }
    .rel-tag-qvis { background: #2C7A5B; }
    .rel-tag-glosa { background: #a15646; }
    .rel-tag-atlas { background: #585d62; }
    .rel-tag-neutra { background: #B4B2A9; }
    .rel-tag-papel { background: var(--primary); }
    .rel-tag-desemp { background: #3f6489; }
    .rel-zero { color: var(--ink-faint); }
    .rel-desc { color: var(--ink-soft); font-size: 12px; white-space: nowrap; }

    /* V947: .rel-fonte saiu — a tag de fonte é a global .atlas-fonte */
    .rel-conv-nome { font-size: 11px; color: var(--ink-soft); }

    .rel-trunc { margin-top: 10px; font-size: 11px; color: var(--ink-faint); }

    .rel-placeholder { text-align: center; padding: 48px 20px; color: var(--ink-soft); }
    .rel-placeholder-ico { font-size: 34px; color: var(--accent); margin-bottom: 8px; }
    .rel-placeholder h3 { margin: 0 0 8px; font-weight: 500; font-family: var(--font-display); color: var(--ink); }
    .rel-placeholder p { margin: 0 auto 6px; max-width: 520px; font-size: 13px; line-height: 1.5; }
    .rel-muted { color: var(--ink-faint); font-size: 12px; }
  `;

  /**
   * V906: API pública pro CONTROLE DE NOTAS — total do repasse consolidado
   * por médico numa competência (a MESMA soma da extração por médico).
   * Devolve Map<nome_normalizado, { nome, total }>.
   */
  function totaisPorMedico(comp) {
    const mapa = new Map();
    if (!comp) return mapa;
    let linhas = [];
    try { linhas = linhasConsolidadoComp(comp) || []; }
    catch (e) { console.error('[relatorios] totaisPorMedico:', e); return mapa; }
    const normalizar = (s) => (window.Utilidades ? Utilidades.normalizar(String(s || '')) :
      String(s || '').toUpperCase().trim());
    for (const l of linhas) {
      const nome = String(l.profissional || '').trim();
      if (!nome) continue;
      const k = normalizar(nome);
      const ent = mapa.get(k) || { nome, total: 0 };
      ent.total += Number(l.valor) || 0;
      mapa.set(k, ent);
    }
    return mapa;
  }
  window.AtlasRelatorios = Object.assign(window.AtlasRelatorios || {}, { totaisPorMedico });

  return { montar };
})();
