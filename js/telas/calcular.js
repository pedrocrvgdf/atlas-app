/**
 * ============================================================================
 * TELA: Calcular Repasse  (∑)
 *
 * Cruza cada linha do QVIS (`linhas_qvis`) com a BASE TABELA (`tabela_repasse`),
 * usando `procedimentos` + `sinonimos_proc` pra resolver o procedimento, e
 * `mapeamento_papeis` pra resolver o papel.
 *
 * Estratégia de match em CAMADAS (do mais seguro pro mais permissivo):
 *   1) Exato sobre o nome normalizado          → match instantâneo
 *   2) Sinônimos cadastrados (sinonimos_proc)  → grafias já conhecidas
 *   3) Similaridade (Levenshtein) ≥ limiar      → tolera pequenos typos
 *
 * Cálculo:
 *   • valor preenchido       → repasse = valor fixo            (Convênio/SUS)
 *   • percentual preenchido  → repasse = produzido × percentual (Particular)
 * ============================================================================
 */
App.telas['calcular'] = function () {
  if (!window.__calc) {
    window.__calc = {
      competencia: null,
      // V903: os três drops viram MULTI — o state aceita 'todos'/'todas'
      // (nada filtrado), uma string (legado) ou um ARRAY de valores marcados.
      filtroStatus: 'todos',   // V131.6: 'casou' | 'glosa' | 'procSemRegra' | ...
      filtroFonte: 'todas',     // 'CONVENIO' | 'PARTICULAR' | 'SUS' | 'PERFIL'
      filtroPapel: 'todos',     // V131.16: nome do papel
      // V903: seleções múltiplas dos combos (chave → array de valores exatos).
      // Vazio = o combo segue no modo "contém" pelo texto digitado.
      multiSel: { admissao: [], profissional: [], procedimento: [], convenio: [], especialidade: [] },
      buscaAdmissao: '',        // V131.6: 3 campos de busca separados
      buscaProfissional: '',
      buscaProcedimento: '',
      buscaConvenio: '',        // V131.52: 4º campo de busca — filtra pelo nome do convênio
      buscaEspecialidade: '',   // V901: 5º campo — filtra pela Especialidade da linha (V500)
      dropAberto: null,         // V131.8: 'status' | 'fonte' | null — custom dropdown aberto
      sbAberto: null,           // V734: célula da fileira 20C com painel aberto ('competencia' | null)
      calculou: false,
      resultado: null,         // { linhas, kpis, ts }
      limiar: 0.88,             // similaridade mínima pra match fuzzy
      ajustesAberto: false,     // V131.3: modal de ajustes (tipos + overrides)
      ajustesAba: 'tipos',      // 'tipos' | 'overrides'
      ajustesBusca: '',
      cadastroAberto: false,      // V131.19: modal de cadastro rápido de procedimento na BASE TABELA
      cadastroForm: null,         // { nome, CONVENIO:{papel:{v,t}}, PARTICULAR:{...}, SUS:{...} }
      // V131.44/45: state do form de Nova Regra de Exceção (multi-procedimento + multi-fonte)
      excForm: {
        medicoNome: '',
        papelId: '',
        fontes: ['TODAS'],  // V131.45: array de fontes selecionadas
        valor: '',
        tipo: 'R$',
        procs: [],          // array de { id, nome }
      },
      // V131.49/52: state do form de Pacote de Convênio (nova aba "Pacotes")
      pacoteForm: {
        label: '',
        valorConsulta: '', tipoConsulta: 'R$',   // V131.52: valor pra linha-mãe
        valor: '', tipo: 'R$',                   // valor pra linha-filha (exames)
        nomeDetalhe: 'Exames inclusos no pacote'
      },
      // V131.50: qual pacote tem a sub-linha de procedimentos expandida
      pacoteExpandidoId: null,
      // V218: form de Regra de Perfil Particular (aba nova)
      perfilForm: { perfil: '', tabela: 'CONVENIO' },
      perfilExpandidoId: null,   // qual regra de perfil está com a lista de procs expandida
      tiposHabilitados: null,   // Set carregado do banco; null = não carregou ainda
      overrides: null,          // Map<nome_normalizado, boolean (true=incluir, false=excluir)>
    };
  }
  const state = window.__calc;
  // V734: garante a chave da fileira 20C em state persistido de versão antiga
  if (state.sbAberto === undefined) state.sbAberto = null;
  // V903: garante o mapa de multi-seleção em state persistido de versão antiga
  if (!state.multiSel) {
    state.multiSel = { admissao: [], profissional: [], procedimento: [], convenio: [], especialidade: [] };
  }
  if (!state.multiSel.especialidade) state.multiSel.especialidade = [];

  // V903: leitura normalizada dos drops multi — aceita 'todos'/'todas' (nada),
  // string legada (um valor) ou array. Devolve SEMPRE um array de ativos.
  function selDe(v, vazio) {
    if (v == null) return [];
    if (Array.isArray(v)) return v;
    return v === vazio ? [] : [v];
  }
  // V903: alterna um valor num drop multi; clicar em 'todos'/'todas' zera.
  function toggleSel(atual, vazio, v) {
    if (v === vazio) return [];
    const arr = selDe(atual, vazio);
    return arr.includes(v) ? arr.filter(x => x !== v) : arr.concat(v);
  }
  // V218: garante que perfilForm exista mesmo em state de versão antiga
  if (!state.perfilForm) state.perfilForm = { perfil: '', tabela: 'CONVENIO' };
  if (!state.perfilForm.tabela) state.perfilForm.tabela = 'CONVENIO';
  if (state.perfilExpandidoId === undefined) state.perfilExpandidoId = null;
  // V131.44: garante que excForm exista mesmo se state veio de versão antiga
  if (!state.excForm) {
    state.excForm = { medicoNome: '', papelId: '', fontes: ['TODAS'], valor: '', tipo: 'R$', procs: [] };
  } else if (!Array.isArray(state.excForm.fontes)) {
    // V131.45: back-compat: state.excForm.fonte (string) → state.excForm.fontes (array)
    state.excForm.fontes = state.excForm.fonte ? [state.excForm.fonte] : ['TODAS'];
    delete state.excForm.fonte;
  }
  // V656: FICHÁRIOS de exceção por médico + cadastro em 2 etapas (sobreposição)
  if (!state.excFich) state.excFich = { aberto: null };   // medico_id com drill-down aberto
  if (!state.excNovo) state.excNovo = {
    medicoId: null, medicoNome: '', medicoBusca: '',
    fontes: [], procs: [], procBusca: '',   // V659: VÁRIOS procedimentos · V913: VÁRIAS fontes
    campos: {},   // { papelId: { valor: '', tipo: 'R$' } } — só os preenchidos viram sobreposição
    extracao: 'QVIS',   // V658: 'QVIS' (motor) ou 'PRODUCAO' (1×/admissão via Produção → Desempenho)
  };
  if (!state.excNovo.extracao) state.excNovo.extracao = 'QVIS';
  if (state.excNovo.vigencia === undefined) state.excNovo.vigencia = '';   // V912
  if (state.excNovo.anularDemais === undefined) state.excNovo.anularDemais = false;   // V919
  if (!Array.isArray(state.excNovo.fontes)) {   // V913: back-compat (fonte string → fontes array)
    state.excNovo.fontes = state.excNovo.fonte ? [state.excNovo.fonte] : [];
    delete state.excNovo.fonte;
  }
  if (!Array.isArray(state.excNovo.procs)) {   // back-compat com o state antigo (1 proc)
    state.excNovo.procs = state.excNovo.procId ? [{ id: state.excNovo.procId, nome: state.excNovo.procNome || '' }] : [];
    delete state.excNovo.procId; delete state.excNovo.procNome;
  }
  // V131.49/52: garante que pacoteForm exista com todos os campos
  if (!state.pacoteForm) {
    state.pacoteForm = { label: '', valorConsulta: '', tipoConsulta: 'R$', valor: '', tipo: 'R$', nomeDetalhe: 'Exames inclusos no pacote' };
  } else {
    // back-compat — adiciona campos novos sem destruir valores antigos
    if (state.pacoteForm.valorConsulta == null) state.pacoteForm.valorConsulta = '';
    if (state.pacoteForm.tipoConsulta == null) state.pacoteForm.tipoConsulta = 'R$';
  }

  // V131.3: tabelas de config (criadas se ainda não existirem)
  try {
    Banco.db.exec(`
      CREATE TABLE IF NOT EXISTS config_calcular (
        chave TEXT PRIMARY KEY,
        valor TEXT
      );
      CREATE TABLE IF NOT EXISTS calcular_medico_override (
        nome_normalizado TEXT PRIMARY KEY,
        incluir INTEGER NOT NULL DEFAULT 1,
        criado_em TEXT DEFAULT CURRENT_TIMESTAMP
      );
      /* V131.40: snapshot persistente do cálculo de repasse por competência */
      CREATE TABLE IF NOT EXISTS repasse_snapshot (
        competencia       TEXT PRIMARY KEY,
        resultado_json    TEXT NOT NULL,
        total_repasse     REAL DEFAULT 0,
        total_produzido   REAL DEFAULT 0,
        n_linhas          INTEGER DEFAULT 0,
        n_repassado       INTEGER DEFAULT 0,
        n_glosa           INTEGER DEFAULT 0,
        n_proc_sem_regra  INTEGER DEFAULT 0,
        criado_em         TEXT DEFAULT CURRENT_TIMESTAMP,
        atualizado_em     TEXT DEFAULT CURRENT_TIMESTAMP
      );
      /* V131.41: índice de linhas PAGAS pra detectar duplicidade histórica
         (mesma admissão + procedimento + papel já pago em competência anterior) */
      CREATE TABLE IF NOT EXISTS repasse_pagos (
        competencia       TEXT NOT NULL,
        cod_admissao      TEXT NOT NULL,
        procedimento_norm TEXT NOT NULL,
        papel_id          INTEGER NOT NULL,
        repasse           REAL DEFAULT 0,
        registrado_em     TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (competencia, cod_admissao, procedimento_norm, papel_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pagos_chave ON repasse_pagos(cod_admissao, procedimento_norm, papel_id, competencia);
      /* V131.42: exceções da regra de duplicidade (médicos ou procedimentos isentos) */
      CREATE TABLE IF NOT EXISTS duplicidade_excecao (
        tipo       TEXT NOT NULL,    -- 'medico' ou 'procedimento'
        chave      TEXT NOT NULL,    -- nome_normalizado
        rotulo     TEXT,             -- display original
        criado_em  TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tipo, chave)
      );
      /* V131.43/44: REGRAS DE EXCEÇÃO de pagamento — sobrescrevem a BASE TABELA
         para combinações específicas (médico + procedimento + papel + fonte).
         Quando existe, ela é aplicada e a regra geral é IGNORADA pra esse caso.
         fonte_pagadora: 'TODAS' = qualquer fonte, ou 'CONVENIO' / 'PARTICULAR' / 'SUS'. */
      CREATE TABLE IF NOT EXISTS tabela_repasse_excecao (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        medico_id       INTEGER NOT NULL,
        procedimento_id INTEGER NOT NULL,
        papel_id        INTEGER NOT NULL,
        fonte_pagadora  TEXT NOT NULL DEFAULT 'TODAS',
        valor           REAL,
        percentual      REAL,
        ativo           INTEGER DEFAULT 1,
        criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
        atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (medico_id, procedimento_id, papel_id, fonte_pagadora)
      );
      CREATE INDEX IF NOT EXISTS idx_excecao_chave ON tabela_repasse_excecao(medico_id, procedimento_id, papel_id, fonte_pagadora);
      /* V658: bloqueio de DESEMPENHO por médico × módulo — anula a participação
         do médico naquele fichário de desempenho (a exceção passa a pagar). */
      CREATE TABLE IF NOT EXISTS excecao_desempenho_bloqueio (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        medico_id  INTEGER NOT NULL,
        modulo     TEXT NOT NULL,       -- id do fichário: lio/opme/fellow/.../estrabismo
        ativo      INTEGER DEFAULT 1,
        criado_em  TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (medico_id, modulo)
      );
      /* V131.49: PACOTE DE CONSULTA por convênio
         Convênios como BRADESCO/CASSI/AMIL/SULAMERICA pagam a CONSULTA como pacote
         (inclui exames). Quando uma linha do QVIS tem procedimento contendo "CONSULTA"
         e convênio bate com algum cadastrado, aplica este valor (substitui BASE TABELA)
         e cria linha-filha informativa replicando os dados. */
      CREATE TABLE IF NOT EXISTS pacote_convenio (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        convenio_nome         TEXT NOT NULL UNIQUE,    -- normalizado (ex: "BRADESCO")
        convenio_label        TEXT NOT NULL,           -- display original (ex: "Bradesco")
        valor_consulta        REAL,                    -- V131.52: valor da consulta (linha-mãe)
        percentual_consulta   REAL,                    -- V131.52: percentual sobre Produzido pra consulta
        valor                 REAL,                    -- valor da LINHA-FILHA (exames inclusos)
        percentual            REAL,                    -- percentual sobre Produzido pra linha-filha
        nome_detalhe          TEXT NOT NULL DEFAULT 'Exames inclusos no pacote',
        ativo                 INTEGER DEFAULT 1,
        criado_em             TEXT DEFAULT CURRENT_TIMESTAMP,
        atualizado_em         TEXT DEFAULT CURRENT_TIMESTAMP
      );
      /* Seed inicial — popula os 4 convênios padrão com valor 0 (usuário edita depois) */
      INSERT OR IGNORE INTO pacote_convenio (convenio_nome, convenio_label, valor, nome_detalhe) VALUES
        ('BRADESCO',   'Bradesco',    0, 'Exames inclusos no pacote'),
        ('CASSI',      'Cassi',       0, 'Exames inclusos no pacote'),
        ('AMIL',       'Amil',        0, 'Exames inclusos no pacote'),
        ('SULAMERICA', 'SulAmérica',  0, 'Exames inclusos no pacote');
      /* V131.50: Procedimentos vinculados a cada pacote (whitelist manual).
         Quando há procs cadastrados pra um pacote, SÓ esses entram (modo manual).
         Quando vazio, mantém o modo automático (qualquer proc com "CONSULTA" no nome). */
      CREATE TABLE IF NOT EXISTS pacote_procedimento (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        pacote_id       INTEGER NOT NULL,
        procedimento_id INTEGER NOT NULL,
        ativo           INTEGER DEFAULT 1,
        criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (pacote_id, procedimento_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pacote_proc ON pacote_procedimento(pacote_id);
      /* V131.59: ALIASES de convênio — vínculos manuais ("flags").
         Quando o nome no QVIS não bate (ex: "SUL AMERICA" vs cadastro "SULAMERICA"),
         o usuário vincula manualmente esse nome a um pacote. alias_nome é normalizado. */
      CREATE TABLE IF NOT EXISTS pacote_alias (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        pacote_id   INTEGER NOT NULL,
        alias_nome  TEXT NOT NULL,        -- normalizado (chave de match)
        alias_label TEXT,                 -- original (exibição)
        criado_em   TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (alias_nome)
      );
      CREATE INDEX IF NOT EXISTS idx_pacote_alias ON pacote_alias(pacote_id);
      /* V218: REGRAS DE PERFIL PARTICULAR — projetos tipo PROJETO CATARATA / VISÃO SAÚDE.
         O QVIS não carrega o perfil; ele é checado na PRODUÇÃO (linhas_producao.perfil_particular)
         pela admissão. Quando a admissão tem o perfil e o procedimento está na regra, o valor
         ÚNICO da regra SUBSTITUI a BASE TABELA (pago uma vez por admissão+procedimento). */
      CREATE TABLE IF NOT EXISTS perfil_regra (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        perfil        TEXT NOT NULL UNIQUE,    -- nome do perfil (ex: 'PROJETO CATARATA (ATLAS)')
        valor         REAL,                    -- R$ fixo
        percentual    REAL,                    -- % sobre produzido
        ativo         INTEGER DEFAULT 1,
        criado_em     TEXT DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS perfil_regra_proc (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        regra_id        INTEGER NOT NULL,
        procedimento_id INTEGER NOT NULL,
        valor           REAL,
        percentual      REAL,
        ativo           INTEGER DEFAULT 1,
        criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (regra_id, procedimento_id)
      );
      CREATE INDEX IF NOT EXISTS idx_perfil_regra_proc ON perfil_regra_proc(regra_id);
    `);
  } catch (e) { console.warn('[calcular] tabelas config:', e); }
  // V220: migração defensiva — adiciona valor/percentual em bancos que já tinham a tabela
  try { Banco.executar(`ALTER TABLE perfil_regra_proc ADD COLUMN valor REAL`); } catch (_) {}
  try { Banco.executar(`ALTER TABLE perfil_regra_proc ADD COLUMN percentual REAL`); } catch (_) {}
  // V221: a regra de perfil escolhe a TABELA (CONVENIO/PARTICULAR), não um valor.
  try { Banco.executar(`ALTER TABLE perfil_regra ADD COLUMN tabela TEXT DEFAULT 'CONVENIO'`); } catch (_) {}
  try { Banco.executar(`ALTER TABLE perfil_regra_proc ADD COLUMN tabela TEXT`); } catch (_) {}
  try { Banco.executar(`UPDATE perfil_regra SET tabela = 'CONVENIO' WHERE tabela IS NULL OR TRIM(tabela) = ''`); } catch (_) {}

  // V131.44: MIGRAÇÃO — adicionar coluna fonte_pagadora na tabela_repasse_excecao
  // (versão antiga só tinha medico+proc+papel; agora aceita fonte específica ou TODAS)
  try {
    const cols = Banco.query(`PRAGMA table_info(tabela_repasse_excecao)`) || [];
    const temFonte = cols.some(c => c.name === 'fonte_pagadora');
    if (!temFonte && cols.length > 0) {
      console.log('[calcular] migrando tabela_repasse_excecao pra suportar fonte_pagadora...');
      Banco.db.exec(`
        ALTER TABLE tabela_repasse_excecao RENAME TO tabela_repasse_excecao_v1;
        CREATE TABLE tabela_repasse_excecao (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          medico_id       INTEGER NOT NULL,
          procedimento_id INTEGER NOT NULL,
          papel_id        INTEGER NOT NULL,
          fonte_pagadora  TEXT NOT NULL DEFAULT 'TODAS',
          valor           REAL,
          percentual      REAL,
          ativo           INTEGER DEFAULT 1,
          criado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
          atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (medico_id, procedimento_id, papel_id, fonte_pagadora)
        );
        INSERT INTO tabela_repasse_excecao
          (id, medico_id, procedimento_id, papel_id, fonte_pagadora, valor, percentual, ativo, criado_em, atualizado_em)
          SELECT id, medico_id, procedimento_id, papel_id, 'TODAS',
                 valor, percentual, ativo, criado_em, atualizado_em
            FROM tabela_repasse_excecao_v1;
        DROP TABLE tabela_repasse_excecao_v1;
        CREATE INDEX IF NOT EXISTS idx_excecao_chave_v2
          ON tabela_repasse_excecao(medico_id, procedimento_id, papel_id, fonte_pagadora);
      `);
      Banco.salvar();
      console.log('[calcular] migração concluída.');
    }
  } catch (e) { console.warn('[calcular] erro migrando tabela_repasse_excecao:', e); }

  // V658: MIGRAÇÃO — coluna extracao na tabela_repasse_excecao
  // ('QVIS' padrão = motor atual; 'PRODUCAO' = valor fixo pago 1× por admissão
  //  via linhas de PRODUÇÃO, entrando no consolidado como Desempenho)
  try {
    const cols = Banco.query(`PRAGMA table_info(tabela_repasse_excecao)`) || [];
    if (cols.length > 0 && !cols.some(c => c.name === 'extracao')) {
      Banco.executar(`ALTER TABLE tabela_repasse_excecao ADD COLUMN extracao TEXT`);
      Banco.salvar();
      console.log('[calcular] migração V658: coluna extracao adicionada.');
    }
    // V912: VIGÊNCIA — a regra só vale para admissões com data >= vigencia_inicio
    // (vazio = todas). Admissões anteriores seguem a regra antiga (Base Tabela).
    if (cols.length > 0 && !cols.some(c => c.name === 'vigencia_inicio')) {
      Banco.executar(`ALTER TABLE tabela_repasse_excecao ADD COLUMN vigencia_inicio TEXT`);
      Banco.salvar();
      console.log('[calcular] migração V912: coluna vigencia_inicio adicionada.');
    }
    // V919: ANULAR os demais papéis — quando 1, a sobreposição vale como o
    // pagamento COMPLETO da combinação (médico+procedimento+fonte): papéis que
    // não estão na sobreposição ficam ZERADOS em vez de seguir a Base Tabela.
    if (cols.length > 0 && !cols.some(c => c.name === 'anular_demais')) {
      Banco.executar(`ALTER TABLE tabela_repasse_excecao ADD COLUMN anular_demais INTEGER DEFAULT 0`);
      Banco.salvar();
      console.log('[calcular] migração V919: coluna anular_demais adicionada.');
    }
  } catch (e) { console.warn('[calcular] erro migrando extracao:', e); }

  // V131.52: MIGRAÇÃO — adicionar colunas valor_consulta + percentual_consulta na pacote_convenio
  // (valor da consulta — linha-mãe — substitui o da BASE TABELA quando preenchido)
  try {
    const cols = Banco.query(`PRAGMA table_info(pacote_convenio)`) || [];
    const temValorConsulta = cols.some(c => c.name === 'valor_consulta');
    if (!temValorConsulta && cols.length > 0) {
      console.log('[calcular] migrando pacote_convenio pra suportar valor_consulta...');
      Banco.db.exec(`
        ALTER TABLE pacote_convenio ADD COLUMN valor_consulta REAL;
        ALTER TABLE pacote_convenio ADD COLUMN percentual_consulta REAL;
      `);
      Banco.salvar();
      console.log('[calcular] migração de pacote_convenio concluída.');
    }
  } catch (e) { console.warn('[calcular] erro migrando pacote_convenio:', e); }

  // ─── V131.40: Snapshot helpers ───────────────────────────────────────────
  function salvarSnapshot(competencia, resultado) {
    if (!competencia || !resultado) return false;
    try {
      // Serializa só o essencial pra não inflar o banco
      const snap = {
        linhas: resultado.linhas,
        kpis: resultado.kpis,
        medicosDetectados: resultado.medicosDetectados,
        ts: resultado.ts,
        versaoSnap: 1,
      };
      // V644: snapshot comprimido (gzip) — JSON de um mês cheio tem dezenas de
      // MB e era a 2ª maior área do banco; comprimido fica ~8-10× menor.
      const json = Banco.snapPack ? Banco.snapPack(JSON.stringify(snap)) : JSON.stringify(snap);
      const k = resultado.kpis || {};
      // Preserva criado_em do registro original quando atualiza
      const existente = Banco.query(`SELECT criado_em FROM repasse_snapshot WHERE competencia = ? LIMIT 1`, [competencia]) || [];
      const criadoEm = (existente[0] && existente[0].criado_em) || new Date().toISOString();
      const totProduzido = (k.totalProduzido != null) ? k.totalProduzido : 0;
      Banco.executar(
        `INSERT OR REPLACE INTO repasse_snapshot
          (competencia, resultado_json, total_repasse, total_produzido,
           n_linhas, n_repassado, n_glosa, n_proc_sem_regra,
           criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [competencia, json,
         k.totalRepasse || 0, totProduzido,
         k.total || 0, k.nCasou || 0, k.nGlosa || 0, k.nProcSemRegra || 0,
         criadoEm]
      );

      // V131.41: popular repasse_pagos pra duplicidade histórica
      // (DELETE primeiro pra refletir alterações em recálculos)
      Banco.executar(`DELETE FROM repasse_pagos WHERE competencia = ?`, [competencia]);
      let nPagosInseridos = 0;
      const linhasCasou = (resultado.linhas || []).filter(l => l._status === 'casou');
      for (const l of linhasCasou) {
        const codAdm = String(l.cod_admissao || '').trim();
        const procNorm = normalizar(l.procedimento || '');
        const papelId = l._papelId;
        if (!codAdm || !procNorm || !papelId) continue;
        try {
          Banco.executar(
            `INSERT OR REPLACE INTO repasse_pagos
              (competencia, cod_admissao, procedimento_norm, papel_id, repasse)
             VALUES (?, ?, ?, ?, ?)`,
            [competencia, codAdm, procNorm, papelId, l._repasse || 0]
          );
          nPagosInseridos++;
        } catch (_) { /* duplicate na mesma competência → ignora */ }
      }

      // V602: salvamento COALESCIDO — o export do banco inteiro (10-18s na
      // base real, congelando a tela) rodava aqui a cada cálculo salvo; com o
      // debounce, calcular vários meses em sequência gera UM export só.
      // O dado já está no banco em memória; pagehide/arquivo automático cobrem
      // o fechamento repentino.
      Banco.salvarDebounced(1500);
      console.log('[calcular] snapshot salvo:', competencia, '— JSON:', json.length, 'bytes — pagos:', nPagosInseridos);
      return true;
    } catch (e) {
      console.error('[calcular] erro ao salvar snapshot:', e);
      Utilidades.toast?.('Erro ao salvar cálculo: ' + (e.message || e), 'error', 5000);
      return false;
    }
  }

  // V597: memo do PARSE — o resultado_json de um mês cheio tem vários MB e o
  // JSON.parse era refeito a cada troca de competência / reentrada na tela
  // (a "demora" ao abrir o Calcular). Chave por competência|versão do banco:
  // qualquer gravação (recálculo, importação) invalida sozinha.
  const _snapMemo = {};
  function carregarSnapshot(competencia) {
    if (!competencia) return null;
    const memoK = competencia + '|' + (Banco._versao || 0);
    if (_snapMemo[memoK]) return _snapMemo[memoK];
    try {
      const r = Banco.query(
        `SELECT resultado_json, criado_em, atualizado_em FROM repasse_snapshot WHERE competencia = ? LIMIT 1`,
        [competencia]
      );
      if (!r || !r[0]) return null;
      const parsed = JSON.parse(Banco.snapUnpack ? Banco.snapUnpack(r[0].resultado_json) : r[0].resultado_json);
      parsed._snapshotInfo = {
        criado_em: r[0].criado_em,
        atualizado_em: r[0].atualizado_em,
        fromSnapshot: true,
      };
      // V601: UM slot só — na base real cada snapshot interpretado ocupa
      // dezenas de MB; guardar 3 (V597) estourava a memória da aba e
      // congelava a ferramenta inteira. O ganho principal (reentrada na tela
      // sem re-parse do MESMO mês) continua valendo.
      for (const k in _snapMemo) delete _snapMemo[k];
      _snapMemo[memoK] = parsed;
      return parsed;
    } catch (e) {
      console.error('[calcular] erro ao carregar snapshot:', e);
      return null;
    }
  }

  function apagarSnapshot(competencia) {
    if (!competencia) return false;
    try {
      Banco.executar(`DELETE FROM repasse_snapshot WHERE competencia = ?`, [competencia]);
      // V131.41: ao apagar snapshot, remover também os registros de "pagos" daquela competência
      Banco.executar(`DELETE FROM repasse_pagos WHERE competencia = ?`, [competencia]);
      Banco.salvar();
      return true;
    } catch (e) {
      console.error('[calcular] erro ao apagar snapshot:', e);
      return false;
    }
  }

  function infoSnapshot(competencia) {
    if (!competencia) return null;
    try {
      const r = Banco.query(
        `SELECT total_repasse, total_produzido, n_linhas, n_repassado, n_glosa, n_proc_sem_regra,
                criado_em, atualizado_em
         FROM repasse_snapshot WHERE competencia = ? LIMIT 1`, [competencia]) || [];
      return r[0] || null;
    } catch (_) { return null; }
  }

  // ─── V131.42/43: Simulação de duplicidade pra testes (mantida) ────────
  const COMPETENCIA_TESTE = '0000-00';   // lexicograficamente < qualquer YYYY-MM real

  // ─── V131.43: Regras de EXCEÇÃO de pagamento ──────────────────────────
  // Substitui o conceito antigo de "exceções de duplicidade".
  // Uma exceção é uma regra personalizada (médico + procedimento + papel)
  // que SOBRESCREVE a regra geral da BASE TABELA.

  // ─── V218: REGRAS DE PERFIL PARTICULAR ───────────────────────────────────
  // Perfis vêm da PRODUÇÃO (linhas_producao.perfil_particular). Uma regra = 1 perfil
  // + 1 valor (R$ ou %) + lista de procedimentos. No cálculo, substitui a BASE TABELA.

  function listarPerfisProducao() {
    try {
      return (Banco.query(
        `SELECT DISTINCT perfil_particular AS p FROM linhas_producao
          WHERE perfil_particular IS NOT NULL AND TRIM(perfil_particular) <> ''
          ORDER BY perfil_particular`
      ) || []).map(r => r.p);
    } catch (e) { console.warn('[calcular] listarPerfisProducao:', e); return []; }
  }

  function listarRegrasPerfil() {
    try {
      return Banco.query(`
        SELECT r.id, r.perfil, r.tabela, r.ativo
          FROM perfil_regra r
         WHERE r.ativo = 1
         ORDER BY r.perfil
      `) || [];
    } catch (e) { console.warn('[calcular] listarRegrasPerfil:', e); return []; }
  }

  function listarProcsDaRegraPerfil(regraId) {
    try {
      return Banco.query(`
        SELECT pp.procedimento_id, pr.nome_oficial AS procedimento_nome, pp.tabela, pp.valor
          FROM perfil_regra_proc pp
          JOIN procedimentos pr ON pr.id = pp.procedimento_id
         WHERE pp.regra_id = ? AND pp.ativo = 1
           AND ((pp.tabela IS NOT NULL AND TRIM(pp.tabela) <> '') OR pp.valor IS NOT NULL)
         ORDER BY pr.nome_oficial
      `, [regraId]) || [];
    } catch (e) { console.warn('[calcular] listarProcsDaRegraPerfil:', e); return []; }
  }

  // V220: conta admissões ÚNICAS (DISTINCT cod_admissao) por perfil na Produção.
  function contarAdmissoesPorPerfil() {
    const mapa = new Map();
    try {
      const rows = Banco.query(`
        SELECT perfil_particular AS p, COUNT(DISTINCT cod_admissao) AS n
          FROM linhas_producao
         WHERE perfil_particular IS NOT NULL AND TRIM(perfil_particular) <> ''
         GROUP BY perfil_particular
      `) || [];
      for (const r of rows) mapa.set(String(r.p).trim(), Number(r.n) || 0);
    } catch (e) { console.warn('[calcular] contarAdmissoesPorPerfil:', e); }
    return mapa;
  }

  // Cria ou atualiza a regra de um perfil (UNIQUE em perfil). tabela = 'CONVENIO'|'PARTICULAR'. Retorna o id.
  function salvarRegraPerfil(perfil, tabela) {
    const nome = String(perfil || '').trim();
    if (!nome) return null;
    const tb = String(tabela || 'CONVENIO').toUpperCase().trim();
    const tbOk = (tb === 'PARTICULAR') ? 'PARTICULAR' : 'CONVENIO';
    try {
      Banco.executar(
        `INSERT INTO perfil_regra (perfil, tabela, ativo)
         VALUES (?, ?, 1)
         ON CONFLICT(perfil) DO UPDATE SET
           tabela = excluded.tabela, ativo = 1, atualizado_em = CURRENT_TIMESTAMP`,
        [nome, tbOk]
      );
      const row = Banco.queryUnica(`SELECT id FROM perfil_regra WHERE perfil = ?`, [nome]);
      return row ? row.id : null;
    } catch (e) { console.error('[calcular] salvarRegraPerfil:', e); return null; }
  }

  function removeRegraPerfil(id) {
    try {
      Banco.executar(`DELETE FROM perfil_regra_proc WHERE regra_id = ?`, [id]);
      Banco.executar(`DELETE FROM perfil_regra WHERE id = ?`, [id]);
      return true;
    } catch (e) { console.error('[calcular] removeRegraPerfil:', e); return false; }
  }

  // V221: cadastra/atualiza a TABELA (conv/part) de um procedimento dentro de um perfil.
  // V243: parse de valor BR/decimal pro campo de valor fixo
  function parseValorPF(s) {
    if (s == null) return NaN;
    let t = String(s).trim().replace(/[^\d.,-]/g, '');
    if (t === '') return NaN;
    if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(t);
    return isNaN(n) ? NaN : n;
  }
  // V243: exceção por procedimento = VALOR fixo (R$) OU TABELA (Convênio/Particular).
  // tipo 'valor' grava valor e zera tabela; tipo 'tabela' grava tabela e zera valor.
  function salvarAjusteProc(regraId, procId, tipo, valor, tabela) {
    if (!regraId || !procId) return false;
    try {
      if (tipo === 'valor') {
        const v = Number(valor);
        if (!isFinite(v) || v < 0) return false;
        Banco.executar(
          `INSERT INTO perfil_regra_proc (regra_id, procedimento_id, valor, tabela, ativo)
           VALUES (?, ?, ?, NULL, 1)
           ON CONFLICT(regra_id, procedimento_id) DO UPDATE SET
             valor = excluded.valor, tabela = NULL, ativo = 1`,
          [regraId, procId, v]
        );
      } else {
        const tb = String(tabela || '').toUpperCase().trim();
        const tbOk = (tb === 'PARTICULAR') ? 'PARTICULAR' : 'CONVENIO';
        Banco.executar(
          `INSERT INTO perfil_regra_proc (regra_id, procedimento_id, tabela, valor, ativo)
           VALUES (?, ?, ?, NULL, 1)
           ON CONFLICT(regra_id, procedimento_id) DO UPDATE SET
             tabela = excluded.tabela, valor = NULL, ativo = 1`,
          [regraId, procId, tbOk]
        );
      }
      return true;
    } catch (e) { console.error('[calcular] salvarAjusteProc:', e); return false; }
  }

  function removeProcRegraPerfil(regraId, procId) {
    try {
      Banco.executar(`DELETE FROM perfil_regra_proc WHERE regra_id = ? AND procedimento_id = ?`, [regraId, procId]);
      return true;
    } catch (e) { console.error('[calcular] removeProcRegraPerfil:', e); return false; }
  }

  // V657: o histórico de versões só existe depois da primeira publicação —
  // qualquer consulta a procedimentos_hist precisa checar antes.
  function temHistProcedimentos() {
    try { return !!Banco.queryUnica(`SELECT name FROM sqlite_master WHERE type='table' AND name='procedimentos_hist'`); }
    catch (_) { return false; }
  }

  function listarRegrasExcecao() {
    try {
      // V657: procedimento recriado/removido na Base → recupera o nome pelo
      // histórico de versões (procedimentos_hist) e marca a regra como órfã.
      const nomeProc = temHistProcedimentos()
        ? `COALESCE(pr.nome_oficial,
                    (SELECT h.nome_oficial FROM procedimentos_hist h
                      WHERE h.procedimento_id = e.procedimento_id
                      ORDER BY h.versao_id DESC LIMIT 1))`
        : `pr.nome_oficial`;
      return Banco.query(`
        SELECT e.id, e.medico_id, e.procedimento_id, e.papel_id, e.fonte_pagadora,
               e.valor, e.percentual, e.ativo, e.vigencia_inicio,
               COALESCE(e.anular_demais, 0) AS anular_demais,
               UPPER(COALESCE(e.extracao, 'QVIS')) AS extracao,
               m.nome_oficial AS medico_nome,
               ${nomeProc} AS procedimento_nome,
               (pr.id IS NULL) AS proc_orfao,
               pa.nome AS papel_nome
          FROM tabela_repasse_excecao e
          LEFT JOIN medicos m       ON m.id  = e.medico_id
          LEFT JOIN procedimentos pr ON pr.id = e.procedimento_id
          LEFT JOIN papeis pa       ON pa.id = e.papel_id
         WHERE e.ativo = 1
         ORDER BY m.nome_oficial, pr.nome_oficial, pa.nome
      `) || [];
    } catch (e) {
      console.warn('[calcular] listarRegrasExcecao:', e);
      return [];
    }
  }

  // V657: REVINCULA regras de exceção órfãs — quando a Base Tabela é limpa ou
  // reimportada, os procedimentos são recriados com ids NOVOS e a exceção fica
  // apontando pro id antigo (nome "?" e, pior, regra MORTA no motor). Se o
  // histórico de versões conhece o nome do id antigo e existe um procedimento
  // atual com a MESMA grafia, a regra é religada ao id atual. Idempotente.
  function repararExcecoesOrfas() {
    try {
      if (!temHistProcedimentos()) return 0;   // sem histórico não dá pra descobrir o nome antigo
      const orfas = Banco.query(`
        SELECT e.id, e.medico_id, e.papel_id, e.fonte_pagadora, e.procedimento_id
          FROM tabela_repasse_excecao e
         WHERE e.ativo = 1
           AND NOT EXISTS (SELECT 1 FROM procedimentos p WHERE p.id = e.procedimento_id)`) || [];
      if (!orfas.length) return 0;
      let mudou = 0;
      for (const o of orfas) {
        const hist = (Banco.query(
          `SELECT nome_oficial, nome_normalizado FROM procedimentos_hist
            WHERE procedimento_id = ? ORDER BY versao_id DESC LIMIT 1`, [o.procedimento_id]) || [])[0];
        if (!hist) continue;
        const alvoNorm = hist.nome_normalizado || normalizar(hist.nome_oficial || '');
        if (!alvoNorm) continue;
        const atual = (Banco.query(`SELECT id FROM procedimentos WHERE nome_normalizado = ? LIMIT 1`, [alvoNorm]) || [])[0];
        if (!atual) continue;
        const jaTem = (Banco.query(
          `SELECT id FROM tabela_repasse_excecao
            WHERE medico_id = ? AND procedimento_id = ? AND papel_id = ? AND fonte_pagadora = ? LIMIT 1`,
          [o.medico_id, atual.id, o.papel_id, o.fonte_pagadora]) || [])[0];
        if (jaTem) Banco.executar(`DELETE FROM tabela_repasse_excecao WHERE id = ?`, [o.id]);
        else Banco.executar(`UPDATE tabela_repasse_excecao SET procedimento_id = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`, [atual.id, o.id]);
        mudou++;
      }
      if (mudou) { Banco._versao = (Banco._versao || 0) + 1; Banco.salvar(); }
      return mudou;
    } catch (e) { console.warn('[calcular] repararExcecoesOrfas:', e); return 0; }
  }

  // V912: normaliza uma data de admissão pra ISO (aceita ISO e dd/mm/aaaa)
  function isoDataAdm(v) {
    const s = String(v || '').trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    return '';
  }

  function addRegraExcecao(medicoId, procedimentoId, papelId, fontePagadora, valor, percentual, extracao, vigenciaInicio, anularDemais) {
    if (!medicoId || !procedimentoId || !papelId) return false;
    const fonte = String(fontePagadora || 'TODAS').toUpperCase();
    const vNum = (valor != null && valor !== '' && !isNaN(Number(valor))) ? Number(valor) : null;
    const pNum = (percentual != null && percentual !== '' && !isNaN(Number(percentual))) ? Number(percentual) : null;
    if (vNum == null && pNum == null) return false;
    // V658: 'QVIS' (padrão, motor atual) ou 'PRODUCAO' (1× por admissão via Produção → Desempenho)
    const ext = String(extracao || 'QVIS').toUpperCase() === 'PRODUCAO' ? 'PRODUCAO' : 'QVIS';
    try {
      // V912: vigência opcional (ISO); vazio/ inválida = vale para todas as admissões
      const vig = isoDataAdm(vigenciaInicio) || null;
      // V919: 1 = os papéis SEM sobreposição desta combinação ficam ANULADOS
      const anula = anularDemais ? 1 : 0;
      Banco.executar(
        `INSERT INTO tabela_repasse_excecao
           (medico_id, procedimento_id, papel_id, fonte_pagadora, valor, percentual, extracao, vigencia_inicio, anular_demais, ativo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(medico_id, procedimento_id, papel_id, fonte_pagadora) DO UPDATE SET
           valor = excluded.valor,
           percentual = excluded.percentual,
           extracao = excluded.extracao,
           vigencia_inicio = excluded.vigencia_inicio,
           anular_demais = excluded.anular_demais,
           ativo = 1,
           atualizado_em = CURRENT_TIMESTAMP`,
        [medicoId, procedimentoId, papelId, fonte, vNum, pNum, ext, vig, anula]
      );
      Banco.salvarDebounced();   // V659: N papéis salvos num clique = 1 export
      return true;
    } catch (e) {
      console.error('[calcular] addRegraExcecao:', e);
      return false;
    }
  }

  function removeRegraExcecao(id) {
    if (!id) return false;
    try {
      Banco.executar(`DELETE FROM tabela_repasse_excecao WHERE id = ?`, [id]);
      Banco.salvarDebounced();   // V659: coalescido (o flush de saída cobre)
      return true;
    } catch (e) {
      console.error('[calcular] removeRegraExcecao:', e);
      return false;
    }
  }

  // V656: valor ATUAL da Base Tabela viva pra (procedimento, papel, fonte) —
  // fonte específica primeiro, senão TODAS (mesma prioridade do motor).
  function valorTabelaViva(procId, papelId, fonte) {
    try {
      const q = (f) => (Banco.query(
        `SELECT valor, percentual FROM tabela_repasse
          WHERE ativo = 1 AND procedimento_id = ? AND papel_id = ? AND UPPER(fonte_pagadora) = ?
          LIMIT 1`, [procId, papelId, f]) || [])[0] || null;
      return q(String(fonte || 'TODAS').toUpperCase()) || q('TODAS');
    } catch (e) { return null; }
  }
  // V656: sobreposições já cadastradas pra (médico, procedimento, fonte) → Map(papelId → regra)
  function excecoesDaCombinacao(medicoId, procId, fonte) {
    const m = new Map();
    try {
      for (const e of (Banco.query(
        `SELECT id, papel_id, valor, percentual, UPPER(COALESCE(extracao,'QVIS')) AS extracao, vigencia_inicio,
                COALESCE(anular_demais, 0) AS anular_demais FROM tabela_repasse_excecao
          WHERE ativo = 1 AND medico_id = ? AND procedimento_id = ? AND UPPER(fonte_pagadora) = ?`,
        [medicoId, procId, String(fonte || 'TODAS').toUpperCase()]) || [])) m.set(e.papel_id, e);
    } catch (_) {}
    return m;
  }

  // V658: módulos de desempenho (mesmos ids dos fichários de Relatórios)
  const MODULOS_DESEMPENHO = [
    { id: 'lio', nome: 'LIO' }, { id: 'opme', nome: 'OPME' },
    { id: 'fellow', nome: 'Fellow' }, { id: 'fracionamento', nome: 'Fracionamento' },
    { id: 'refractive', nome: 'Refractive Laser' }, { id: 'periodos', nome: 'Períodos' },
    { id: 'cargos', nome: 'Cargos' }, { id: 'lentes', nome: 'Lentes de Contato' },
    { id: 'luz', nome: 'Luz Pulsada' }, { id: 'estrabismo', nome: 'Estrabismo' },
    { id: 'laudos', nome: 'Laudos' }, { id: 'crosslink', nome: 'Crosslink' },
  ];
  function bloqueiosDesempenhoDe(medicoId) {
    const s = new Set();
    try {
      for (const r of (Banco.query(`SELECT modulo FROM excecao_desempenho_bloqueio WHERE ativo = 1 AND medico_id = ?`, [medicoId]) || []))
        s.add(String(r.modulo));
    } catch (_) {}
    return s;
  }
  function toggleBloqueioDesempenho(medicoId, modulo) {
    try {
      const tem = (Banco.query(`SELECT id, ativo FROM excecao_desempenho_bloqueio WHERE medico_id = ? AND modulo = ?`, [medicoId, modulo]) || [])[0];
      if (tem && tem.ativo) Banco.executar(`UPDATE excecao_desempenho_bloqueio SET ativo = 0 WHERE id = ?`, [tem.id]);
      else if (tem) Banco.executar(`UPDATE excecao_desempenho_bloqueio SET ativo = 1 WHERE id = ?`, [tem.id]);
      else Banco.executar(`INSERT INTO excecao_desempenho_bloqueio (medico_id, modulo, ativo) VALUES (?,?,1)`, [medicoId, modulo]);
      Banco._versao = (Banco._versao || 0) + 1;
      Banco.salvar();
      return true;
    } catch (e) { console.error('[calcular] toggleBloqueioDesempenho:', e); return false; }
  }

  // ─── V131.49: Pacote de CONSULTA por convênio ────────────────────────────
  function listarPacotes() {
    try {
      return Banco.query(`
        SELECT id, convenio_nome, convenio_label,
               valor_consulta, percentual_consulta,
               valor, percentual, nome_detalhe, ativo
          FROM pacote_convenio
         WHERE ativo = 1
         ORDER BY convenio_label
      `) || [];
    } catch (e) {
      console.warn('[calcular] listarPacotes:', e);
      return [];
    }
  }

  function addPacote(label, valorConsulta, percentualConsulta, valorExames, percentualExames, nomeDetalhe) {
    const lbl = String(label || '').trim();
    if (!lbl) return false;
    const nome = normalizar(lbl);
    if (!nome) return false;
    const numConsulta = (valorConsulta != null && valorConsulta !== '' && !isNaN(Number(valorConsulta))) ? Number(valorConsulta) : null;
    const pctConsulta = (percentualConsulta != null && percentualConsulta !== '' && !isNaN(Number(percentualConsulta))) ? Number(percentualConsulta) : null;
    const numExames   = (valorExames != null && valorExames !== '' && !isNaN(Number(valorExames))) ? Number(valorExames) : null;
    const pctExames   = (percentualExames != null && percentualExames !== '' && !isNaN(Number(percentualExames))) ? Number(percentualExames) : null;
    const det = String(nomeDetalhe || 'Exames inclusos no pacote').trim() || 'Exames inclusos no pacote';
    try {
      Banco.executar(
        `INSERT INTO pacote_convenio
           (convenio_nome, convenio_label, valor_consulta, percentual_consulta, valor, percentual, nome_detalhe, ativo)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(convenio_nome) DO UPDATE SET
           convenio_label       = excluded.convenio_label,
           valor_consulta       = excluded.valor_consulta,
           percentual_consulta  = excluded.percentual_consulta,
           valor                = excluded.valor,
           percentual           = excluded.percentual,
           nome_detalhe         = excluded.nome_detalhe,
           ativo                = 1,
           atualizado_em        = CURRENT_TIMESTAMP`,
        [nome, lbl, numConsulta, pctConsulta, numExames, pctExames, det]
      );
      Banco.salvar();
      return true;
    } catch (e) {
      console.error('[calcular] addPacote:', e);
      return false;
    }
  }

  function updatePacote(id, valorConsulta, percentualConsulta, valorExames, percentualExames, nomeDetalhe) {
    if (!id) return false;
    const numConsulta = (valorConsulta != null && valorConsulta !== '' && !isNaN(Number(valorConsulta))) ? Number(valorConsulta) : null;
    const pctConsulta = (percentualConsulta != null && percentualConsulta !== '' && !isNaN(Number(percentualConsulta))) ? Number(percentualConsulta) : null;
    const numExames   = (valorExames != null && valorExames !== '' && !isNaN(Number(valorExames))) ? Number(valorExames) : null;
    const pctExames   = (percentualExames != null && percentualExames !== '' && !isNaN(Number(percentualExames))) ? Number(percentualExames) : null;
    const det = String(nomeDetalhe || 'Exames inclusos no pacote').trim() || 'Exames inclusos no pacote';
    try {
      Banco.executar(
        `UPDATE pacote_convenio
            SET valor_consulta = ?, percentual_consulta = ?,
                valor = ?, percentual = ?,
                nome_detalhe = ?,
                atualizado_em = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [numConsulta, pctConsulta, numExames, pctExames, det, id]
      );
      Banco.salvar();
      return true;
    } catch (e) {
      console.error('[calcular] updatePacote:', e);
      return false;
    }
  }

  function removePacote(id) {
    if (!id) return false;
    try {
      // V131.50/59: limpa procedimentos vinculados e aliases também
      Banco.executar(`DELETE FROM pacote_procedimento WHERE pacote_id = ?`, [id]);
      Banco.executar(`DELETE FROM pacote_alias WHERE pacote_id = ?`, [id]);
      Banco.executar(`DELETE FROM pacote_convenio WHERE id = ?`, [id]);
      Banco.salvar();
      return true;
    } catch (e) {
      console.error('[calcular] removePacote:', e);
      return false;
    }
  }

  // ─── V131.59: Aliases de convênio (vínculos manuais "flag") ──────────────
  function listarAliasesDoPacote(pacoteId) {
    if (!pacoteId) return [];
    try {
      return Banco.query(
        `SELECT id, alias_nome, alias_label FROM pacote_alias WHERE pacote_id = ? ORDER BY alias_label`,
        [pacoteId]
      ) || [];
    } catch (e) {
      console.warn('[calcular] listarAliasesDoPacote:', e);
      return [];
    }
  }

  function addAliasPacote(pacoteId, aliasLabelOriginal) {
    const label = String(aliasLabelOriginal || '').trim();
    const nome = normalizar(label);
    if (!pacoteId || !nome) return false;
    try {
      Banco.executar(
        `INSERT INTO pacote_alias (pacote_id, alias_nome, alias_label)
         VALUES (?, ?, ?)
         ON CONFLICT(alias_nome) DO UPDATE SET
           pacote_id   = excluded.pacote_id,
           alias_label = excluded.alias_label`,
        [pacoteId, nome, label]
      );
      Banco.salvar();
      return true;
    } catch (e) {
      console.error('[calcular] addAliasPacote:', e);
      return false;
    }
  }

  function removeAlias(id) {
    if (!id) return false;
    try {
      Banco.executar(`DELETE FROM pacote_alias WHERE id = ?`, [id]);
      Banco.salvar();
      return true;
    } catch (e) {
      console.error('[calcular] removeAlias:', e);
      return false;
    }
  }

  // ─── V131.50: Procedimentos vinculados a um pacote (whitelist manual) ────
  function listarProcsDoPacote(pacoteId) {
    if (!pacoteId) return [];
    try {
      return Banco.query(`
        SELECT pp.id AS link_id, pp.procedimento_id, p.nome_oficial
          FROM pacote_procedimento pp
          LEFT JOIN procedimentos p ON p.id = pp.procedimento_id
         WHERE pp.pacote_id = ? AND pp.ativo = 1
         ORDER BY p.nome_oficial
      `, [pacoteId]) || [];
    } catch (e) {
      console.warn('[calcular] listarProcsDoPacote:', e);
      return [];
    }
  }

  function addProcAoPacote(pacoteId, procedimentoId) {
    if (!pacoteId || !procedimentoId) return false;
    try {
      Banco.executar(
        `INSERT OR IGNORE INTO pacote_procedimento (pacote_id, procedimento_id, ativo)
         VALUES (?, ?, 1)`,
        [pacoteId, procedimentoId]
      );
      // Se já existia desativado, reativa
      Banco.executar(
        `UPDATE pacote_procedimento SET ativo = 1 WHERE pacote_id = ? AND procedimento_id = ?`,
        [pacoteId, procedimentoId]
      );
      Banco.salvar();
      return true;
    } catch (e) {
      console.error('[calcular] addProcAoPacote:', e);
      return false;
    }
  }

  function removeProcDoPacote(pacoteId, procedimentoId) {
    if (!pacoteId || !procedimentoId) return false;
    try {
      Banco.executar(
        `DELETE FROM pacote_procedimento WHERE pacote_id = ? AND procedimento_id = ?`,
        [pacoteId, procedimentoId]
      );
      Banco.salvar();
      return true;
    } catch (e) {
      console.error('[calcular] removeProcDoPacote:', e);
      return false;
    }
  }

  // ─── V131.42/43: Simulação de duplicidade pra testes ───────────────────
  function injetarDuplicidadesTeste(qtd = 10) {
    if (!state.resultado || !state.resultado.linhas) {
      Utilidades.toast?.('Calcule um mês primeiro pra ter linhas de referência.', 'error', 3500);
      return false;
    }
    const linhasCasou = state.resultado.linhas
      .filter(l => l._status === 'casou' && l.admissao && l.procedimento && l._papelId)
      .slice(0, qtd);
    if (linhasCasou.length === 0) {
      Utilidades.toast?.('Nenhuma linha "casou" disponível pra injetar.', 'error', 3500);
      return false;
    }
    try {
      // Limpa registros de teste anteriores
      Banco.executar(`DELETE FROM repasse_pagos WHERE competencia = ?`, [COMPETENCIA_TESTE]);
      let n = 0;
      for (const l of linhasCasou) {
        Banco.executar(
          `INSERT OR REPLACE INTO repasse_pagos
            (competencia, cod_admissao, procedimento_norm, papel_id, repasse)
           VALUES (?, ?, ?, ?, ?)`,
          [COMPETENCIA_TESTE,
           String(l.admissao).trim(),
           normalizar(l.procedimento),
           l._papelId,
           l._repasse || 0]
        );
        n++;
      }
      Banco.salvar();
      Utilidades.toast?.(
        `✓ ${n} duplicidades fake injetadas (competência ${COMPETENCIA_TESTE}). Clique em ▶ Recalcular pra ver.`,
        'success', 5500
      );
      return true;
    } catch (e) {
      console.error('[calcular] injetarDuplicidadesTeste:', e);
      Utilidades.toast?.('Erro ao injetar: ' + (e.message || e), 'error', 4000);
      return false;
    }
  }

  function limparSimulacaoTeste() {
    try {
      Banco.executar(`DELETE FROM repasse_pagos WHERE competencia = ?`, [COMPETENCIA_TESTE]);
      Banco.salvar();
      Utilidades.toast?.('✓ Simulação removida. Recalcule pra atualizar.', 'success', 3500);
      return true;
    } catch (e) {
      console.error('[calcular] limparSimulacaoTeste:', e);
      return false;
    }
  }
  // ─── /Exceções e simulação ───────────────────────────────────────────────

  // ─── V131.48: Exportar APENAS a matriz em .xlsx COM ESTÉTICA VISUAL ──
  // Usa ExcelJS (suporta cores, fonts, borders — diferente do SheetJS Community).
  async function exportarMatrizExcel() {
    if (!state.calculou || !state.resultado || !state.resultado.linhas) {
      Utilidades.toast?.('Calcule primeiro pra poder exportar.', 'error', 3500);
      return;
    }
    if (!state.competencia || state.competencia === 'TODAS') {
      Utilidades.toast?.('Selecione uma competência específica (não "Todas") pra exportar.', 'error', 4000);
      return;
    }
    if (typeof ExcelJS === 'undefined') {
      Utilidades.toast?.('Biblioteca ExcelJS não carregada. Recarregue a página (Ctrl+Shift+R).', 'error', 4500);
      return;
    }

    const competencia = state.competencia;

    // Aplica os MESMOS filtros que a matriz visível — V903: fonte única
    // (aplicarFiltros cobre multi-seleção dos combos e dos drops)
    const res = state.resultado;
    const filtradas = aplicarFiltros(res.linhas, null);

    if (filtradas.length === 0) {
      Utilidades.toast?.('Nenhuma linha pra exportar com os filtros atuais.', 'error', 3500);
      return;
    }

    Utilidades.toast?.('Gerando planilha com estética...', 'info', 2500);

    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'ATLAS — Repasse Médico';
      wb.created = new Date();

      const ws = wb.addWorksheet(`Matriz ${competencia}`, {
        properties: { tabColor: { argb: 'FF1F3A34' } },
        views: [{ state: 'frozen', ySplit: 1, xSplit: 0, activeCell: 'A2' }],
      });

      // Colunas (largura ~ paleta da matriz)
      ws.columns = [
        { header: 'Status',               key: 'status',       width: 14 },
        { header: 'Admissão',             key: 'admissao',     width: 13 },
        { header: 'Profissional',         key: 'profissional', width: 30 },
        { header: 'Papel',                key: 'papel',        width: 14 },
        { header: 'Procedimento',         key: 'procedimento', width: 40 },
        { header: 'Especialidade',        key: 'especialidade', width: 22 },  // V500: subespecialidade da Produção
        { header: 'Origem',               key: 'origem',       width: 12 },
        { header: 'Convênio',             key: 'convenio',     width: 22 },
        { header: 'V.TAB',                key: 'vtab',         width: 9 },   // V928: versão da Base Tabela aplicada
        { header: 'Produzido',            key: 'produzido',    width: 14, style: { numFmt: '"R$" #,##0.00' } },
        { header: 'Recebido',             key: 'recebido',     width: 14, style: { numFmt: '"R$" #,##0.00' } },
        { header: 'Repasse',              key: 'repasse',      width: 14, style: { numFmt: '"R$" #,##0.00' } },
        { header: 'Procedimento Oficial', key: 'procOficial',  width: 30 },
        { header: 'Tipo de Match',        key: 'matchTipo',    width: 14 },
        { header: 'Score Match',          key: 'scoreMatch',   width: 12, style: { numFmt: '0.00"%"' } },
        { header: 'Fonte do Valor',       key: 'fonteValor',   width: 16 },
        { header: 'Regra Exceção',        key: 'regraExc',     width: 14 },
        { header: 'Comp. Já Paga',        key: 'compJaPaga',   width: 14 },
        { header: 'Motivo',               key: 'motivo',       width: 50 },
      ];

      // ─── HEADER STYLE — verde sidebar + off-white + bold + borda dourada ───
      const headerRow = ws.getRow(1);
      headerRow.height = 26;
      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Calibri', size: 11, bold: true,
          color: { argb: 'FFF5EBD0' }
        };
        cell.fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: 'FF1F3A34' }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        cell.border = {
          top:    { style: 'thin',   color: { argb: 'FF1F3A34' } },
          bottom: { style: 'medium', color: { argb: 'FFB8965A' } },
          left:   { style: 'thin',   color: { argb: 'FF2A4A42' } },
          right:  { style: 'thin',   color: { argb: 'FF2A4A42' } },
        };
      });

      // ─── PALETA DE ESTILOS POR STATUS (igual ao CSS da matriz) ───
      // bg = fundo da linha; tagFg/tagBg = cor da célula Status (tag visual)
      const ESTILOS = {
        casou: {
          bg:    null,                                            // linha normal
          tagBg: 'FFE1ECDE',  tagFg: 'FF2C4E37',                  // ✓ verde sutil
          label: 'QVIS',
        },
        glosa: {
          bg:    'FFF6E5E5',                                      // rgba(161, 86, 70,0.07)
          tagBg: 'FF9B3A3A',  tagFg: 'FFFFFFFF',                  // GLOSA - vermelho sólido
          label: 'GLOSA',
        },
        duplicada: {
          bg:    'FFF4ECDC',                                      // dourado claro (proxy do listras)
          tagBg: 'FFB8965A',  tagFg: 'FFFFFFFF',                  // DUPL. - dourado
          label: 'DUPL.',
        },
        procSemRegra: {
          bg:    'FFFAF5EE',                                      // warning claro
          tagBg: 'FFC18A4A',  tagFg: 'FFFFFFFF',                  // NOVO - laranja warning
          label: 'NOVO',
        },
        semRegraPapel: {
          bg:    'FFFBF4EF',                                      // laranja muito claro
          tagBg: 'FFC76A3A',  tagFg: 'FFFFFFFF',                  // S/ REGRA - laranja forte
          label: 'S/ REGRA',
        },
        excluidoTipo: {
          bg:    'FFF5F5F6',                                      // cinza muito claro
          tagBg: 'FFE5E7EA',  tagFg: 'FF6B7280',                  // 🚫 cinza
          label: '🚫 Excluído',
        },
        pacoteDetalhe: {
          bg:    'FFF7F7F8',                                      // cinza muito claro (linha-filha)
          tagBg: 'FF6B7280',  tagFg: 'FFFFFFFF',                  // Ajustes - cinza sólido
          label: 'Ajustes',
        },
      };

      const BORDA_LINHA = { style: 'thin', color: { argb: 'FFE5E5E5' } };

      // ─── ADICIONA AS LINHAS ───
      for (const l of filtradas) {
        const st = ESTILOS[l._status] || ESTILOS.semRegraPapel;
        const recebidoZeroGlosa = (Number(l.recebido) || 0) <= 0 && l._status === 'glosa';

        const row = ws.addRow({
          status:       st.label,
          admissao:     l.admissao || '',
          profissional: l.nome_profissional || '',
          papel:        l.papel || '',
          procedimento: l._ehPacoteDetalhe ? `   ↳ ${l.procedimento || ''}` : Utilidades.procComPerfil(l),
          especialidade: espLinha(l),   // V500: mesmo valor da coluna na tela (memo V901)
          origem:       Utilidades.rotuloFonte(l.origem),   // V947: rótulo uniforme
          convenio:     l.convenio || '',
          vtab:         l._versaoTabela != null && l._versaoTabela !== '' ? 'v' + l._versaoTabela : '',   // V928
          produzido:    Number(l.produzido) || 0,
          recebido:     Number(l.recebido) || 0,
          repasse:      Number(l._repasse) || 0,
          procOficial:  l._procOficial || '',
          matchTipo:    l._matchTipo || '',
          scoreMatch:   (l._matchScore != null) ? Number((l._matchScore * 100).toFixed(2)) : null,
          fonteValor:   l._fonteValor || '',
          regraExc:     l._regraExcecao ? 'Sim' : (l._regraPacote ? `Pacote: ${l._pacoteConvenio || ''}` : (l._regraPerfil ? `Perfil: ${l._perfilNome || ''} (${String(l._perfilTabela||'CONVENIO').toUpperCase()==='VALOR FIXO'?'Valor fixo':(String(l._perfilTabela||'CONVENIO').toUpperCase()==='PARTICULAR'?'Particular':'Convênio')})` : '')),
          compJaPaga:   l._competenciaJaPaga || '',
          motivo:       l._motivo || '',
        });
        row.height = 19;

        // 1) Fundo da linha inteira conforme status (só se tiver bg definido)
        // V617: filha herdada pelo executante real (Produção) → azul bem claro
        const bgLinha = l._execRealProducao ? 'FFEAF4FB' : st.bg;
        if (bgLinha) {
          row.eachCell({ includeEmpty: true }, (cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgLinha } };
          });
        }

        // 2) Border bottom leve em todas as células (separação visual)
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = { bottom: BORDA_LINHA };
          cell.alignment = cell.alignment || { vertical: 'middle' };
          if (!cell.alignment.vertical) cell.alignment.vertical = 'middle';
        });

        // V947: célula ORIGEM com a cor da tag
        Utilidades.pintarCelulaFonte(row.getCell('origem'), l.origem);

        // 3) Célula STATUS — tag colorida (fundo cheio + texto branco em bold)
        const statusCell = row.getCell('status');
        statusCell.font = {
          name: 'Calibri', size: 9.5, bold: true,
          color: { argb: st.tagFg }
        };
        statusCell.fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: st.tagBg }
        };
        statusCell.alignment = { vertical: 'middle', horizontal: 'center' };

        // 4) Célula PAPEL — tag teal sutil (igual ao app)
        const papelCell = row.getCell('papel');
        papelCell.font = {
          name: 'Calibri', size: 9.5, bold: true,
          color: { argb: 'FF2B8C8C' }
        };
        if (!st.bg) {
          // só pinta o papel se a linha estiver no fundo branco (senão fica polido demais)
          papelCell.fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: 'FFE6F4F4' }
          };
        }
        papelCell.alignment = { vertical: 'middle', horizontal: 'center' };

        // 5) RECEBIDO em vermelho destacado quando glosa
        if (recebidoZeroGlosa) {
          const recCell = row.getCell('recebido');
          recCell.font = {
            name: 'Consolas', size: 10, bold: true,
            color: { argb: 'FF9B3A3A' }
          };
          recCell.fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: 'FFF2DFDF' }
          };
        }

        // 6) Valores em mono — Produzido / Recebido / Repasse
        if (!recebidoZeroGlosa) {
          row.getCell('recebido').font = { name: 'Consolas', size: 10 };
        }
        row.getCell('produzido').font = { name: 'Consolas', size: 10 };
        row.getCell('repasse').font = {
          name: 'Consolas', size: 10, bold: true,
          color: { argb: 'FF1F3A34' }
        };

        // 7) Score Match em mono (se preenchido)
        if (l._matchScore != null) {
          row.getCell('scoreMatch').font = { name: 'Consolas', size: 9.5 };
        }

        // 8) Admissão em mono
        row.getCell('admissao').font = { name: 'Consolas', size: 9.5 };

        // 9) V131.49: Linha-filha de pacote — procedimento em itálico, repasse esmaecido
        if (l._ehPacoteDetalhe) {
          row.getCell('procedimento').font = {
            name: 'Calibri', size: 10, italic: true,
            color: { argb: 'FF6B7280' }
          };
          row.getCell('repasse').font = {
            name: 'Consolas', size: 10,
            color: { argb: 'FFA0A0A0' }
          };
          row.getCell('produzido').font = {
            name: 'Consolas', size: 10,
            color: { argb: 'FFA0A0A0' }
          };
          row.getCell('recebido').font = {
            name: 'Consolas', size: 10,
            color: { argb: 'FFA0A0A0' }
          };
        }
      }

      // ─── AUTO-FILTER ───
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to:   { row: 1, column: ws.columns.length }
      };

      // ─── GERAR BLOB E BAIXAR ───
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      a.href = url;
      a.download = `matriz_repasse_${competencia}_${ts}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      Utilidades.toast?.(
        `✓ ${filtradas.length} linha${filtradas.length === 1 ? '' : 's'} exportada${filtradas.length === 1 ? '' : 's'} com formatação visual.`,
        'success', 4500
      );
    } catch (e) {
      console.error('[calcular] exportarMatrizExcel:', e);
      Utilidades.toast?.('Erro ao gerar XLSX: ' + (e.message || e), 'error', 4500);
    }
  }
  // ─── /Exportar matriz ─────────────────────────────────────────────────────

  // ─── V131.45: Autocomplete custom (substitui datalist nativo) ────────────
  // Cria dropdown estilizado abaixo do input. Sugestões filtradas conforme o user digita.
  // - items: [{ value, label }]
  // - onSelect(item): callback quando o user escolhe (click ou Enter)
  function setupAutocomplete(inputEl, listEl, items, onSelect) {
    if (!inputEl || !listEl) return;
    let active = -1;
    let visible = [];

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function highlightMatch(text, query) {
      if (!query) return esc(text);
      const idx = text.toLowerCase().indexOf(query.toLowerCase());
      if (idx === -1) return esc(text);
      return esc(text.slice(0, idx))
           + '<mark>' + esc(text.slice(idx, idx + query.length)) + '</mark>'
           + esc(text.slice(idx + query.length));
    }
    function renderList() {
      const q = (inputEl.value || '').trim().toLowerCase();
      visible = q
        ? items.filter(it => it.label.toLowerCase().includes(q)).slice(0, 60)
        : items.slice(0, 60);
      if (visible.length === 0) {
        listEl.innerHTML = '<div class="calc-aj-ac-empty">Nenhum resultado.</div>';
        listEl.classList.add('open');
        return;
      }
      listEl.innerHTML = visible.map((it, i) =>
        `<div class="calc-aj-ac-item${i === active ? ' calc-aj-ac-active' : ''}" data-idx="${i}">${highlightMatch(it.label, q)}</div>`
      ).join('');
      listEl.classList.add('open');
      // garante que o item ativo fique visível ao navegar com teclado
      if (active >= 0) {
        const el = listEl.querySelector('.calc-aj-ac-active');
        if (el) el.scrollIntoView({ block: 'nearest' });
      }
    }
    function close() { listEl.classList.remove('open'); active = -1; }
    function selectIdx(idx) {
      if (idx < 0 || idx >= visible.length) return;
      onSelect(visible[idx]);
      close();
    }

    inputEl.addEventListener('input', () => { active = -1; renderList(); });
    inputEl.addEventListener('focus', () => { active = -1; renderList(); });
    inputEl.addEventListener('keydown', (ev) => {
      if (!listEl.classList.contains('open')) return;
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        active = Math.min(active + 1, visible.length - 1);
        renderList();
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        active = Math.max(active - 1, 0);
        renderList();
      } else if (ev.key === 'Enter' && active >= 0) {
        ev.preventDefault();
        selectIdx(active);
      } else if (ev.key === 'Escape') {
        close();
      }
    });
    // mousedown (não click) pra evitar perder o foco do input antes de selecionar
    listEl.addEventListener('mousedown', (ev) => {
      const it = ev.target.closest('.calc-aj-ac-item');
      if (!it) return;
      ev.preventDefault();
      selectIdx(parseInt(it.dataset.idx, 10));
    });
    inputEl.addEventListener('blur', () => setTimeout(close, 180));
  }
  // ─── /Snapshot helpers ────────────────────────────────────────────────────

  // Default: todos os 3 tipos cadastrados, SEM_TIPO desligado por segurança
  const TIPOS_DEFAULT = new Set(['INTERNO', 'HIBRIDO', 'EXTERNO']);

  function lerTiposHabilitados() {
    try {
      const r = Banco.query(`SELECT valor FROM config_calcular WHERE chave = 'TIPOS_HABILITADOS'`);
      if (r && r[0] && r[0].valor) {
        return new Set(String(r[0].valor).split(',').map(s => s.trim()).filter(Boolean));
      }
    } catch (_) {}
    return new Set(TIPOS_DEFAULT);
  }
  function salvarTiposHabilitados(set) {
    try {
      const csv = Array.from(set).join(',');
      Banco.executar(
        `INSERT INTO config_calcular (chave, valor) VALUES ('TIPOS_HABILITADOS', ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
        [csv]
      );
      Banco.salvar();
    } catch (e) { console.error('[calcular] salvarTipos:', e); }
  }
  function lerOverrides() {
    const m = new Map();
    try {
      const r = Banco.query(`SELECT nome_normalizado, incluir FROM calcular_medico_override`);
      for (const row of (r || [])) m.set(row.nome_normalizado, !!row.incluir);
    } catch (_) {}
    return m;
  }
  function setOverride(nomeNorm, incluir) {
    try {
      Banco.executar(
        `INSERT INTO calcular_medico_override (nome_normalizado, incluir) VALUES (?, ?)
         ON CONFLICT(nome_normalizado) DO UPDATE SET incluir = excluded.incluir`,
        [nomeNorm, incluir ? 1 : 0]
      );
      Banco.salvar();
      if (state.overrides) state.overrides.set(nomeNorm, incluir);
    } catch (e) { console.error('[calcular] setOverride:', e); }
  }
  function removerOverride(nomeNorm) {
    try {
      Banco.executar(`DELETE FROM calcular_medico_override WHERE nome_normalizado = ?`, [nomeNorm]);
      Banco.salvar();
      if (state.overrides) state.overrides.delete(nomeNorm);
    } catch (e) { console.error('[calcular] removerOverride:', e); }
  }

  // Carrega config no início
  if (state.tiposHabilitados === null) state.tiposHabilitados = lerTiposHabilitados();
  if (state.overrides === null) state.overrides = lerOverrides();

  // ────────────────────────────────────────────────────────────────────────
  // UTILITÁRIOS
  // ────────────────────────────────────────────────────────────────────────
  const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtInt = (n) => (Number(n) || 0).toLocaleString('pt-BR');
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** Normalização agressiva: sem acento, MAIÚSCULA, sem pontuação, espaços limpos. */
  function normalizar(s) {
    if (s == null) return '';
    return String(s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // acentos
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')                        // pontuação → espaço
      .replace(/\s+/g, ' ')                                // colapsa espaços
      .trim();
  }

  /** Distância de Levenshtein (nº mínimo de edições). */
  function levenshtein(a, b) {
    if (a === b) return 0;
    const al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    let v0 = new Array(bl + 1);
    let v1 = new Array(bl + 1);
    for (let i = 0; i <= bl; i++) v0[i] = i;
    for (let i = 0; i < al; i++) {
      v1[0] = i + 1;
      for (let j = 0; j < bl; j++) {
        const cost = a.charCodeAt(i) === b.charCodeAt(j) ? 0 : 1;
        v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
      }
      const tmp = v0; v0 = v1; v1 = tmp;
    }
    return v0[bl];
  }
  /** Similaridade 0..1 (1 = idênticos). */
  function similaridade(a, b) {
    const max = Math.max(a.length, b.length);
    if (max === 0) return 1;
    return 1 - (levenshtein(a, b) / max);
  }

  // V131.18: stopwords e tokenização pra match por palavras-chave
  // (4ª camada do match — cobre casos onde QVIS tem palavras a mais/menos que a BASE TABELA)
  const STOPWORDS_PROC = new Set([
    'DE', 'DO', 'DA', 'DOS', 'DAS',
    'PARA', 'COM', 'SEM', 'POR',
    'A', 'O', 'AS', 'OS',
    'E', 'OU',
    'NO', 'NA', 'NOS', 'NAS',
    'EM', 'ATE', 'OU',
    'C',  // muito comum em "C/" → "C"
    'S',  // "S/" → "S"
  ]);

  /** Divide texto em tokens normalizados (sem acento, uppercase, sem pontuação),
   *  removendo stopwords e palavras muito curtas (< 2 chars). */
  function tokenizar(s) {
    if (!s) return [];
    return normalizar(s).split(/\s+/)
      .filter(t => t.length >= 2 && !STOPWORDS_PROC.has(t));
  }

  /** Score de match por tokens. Retorna { coverageA, coverageB, jaccard }.
   *  coverageA = % de tokens de A presentes em B (do total único de A).
   *  coverageB = % de tokens de B presentes em A (do total único de B). */
  function matchTokens(tokensA, tokensB) {
    if (!tokensA.length || !tokensB.length) return { coverageA: 0, coverageB: 0, jaccard: 0 };
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    let inter = 0;
    for (const t of setA) if (setB.has(t)) inter++;
    const uniao = new Set([...setA, ...setB]).size;
    return {
      coverageA: inter / setA.size,
      coverageB: inter / setB.size,
      jaccard:   inter / uniao,
    };
  }

  // V244: detecta procedimentos que apareceram sob um perfil COM exceções marcadas, NÃO estão
  // marcados, mas têm nome BEM PARECIDO com algum marcado (possível nova nomenclatura da mesma
  // cirurgia). Sensibilidade "equilibrada": similaridade alta OU boa cobertura de palavras-chave.
  function detectarNovasNomenclaturas(candidatos, aux) {
    const out = [];
    if (!candidatos || !candidatos.size) return out;
    const nomeDe = (id) => { const p = aux.procPorId && aux.procPorId.get(id); return p ? (p.nome_oficial || '') : ''; };
    for (const [pn, candMap] of candidatos) {
      const marcados = [];
      const addMarc = (map) => { if (map) for (const id of map.keys()) { const nome = nomeDe(id); if (nome) marcados.push({ id, nome, norm: normalizar(nome), tok: tokenizar(nome) }); } };
      addMarc(aux.mapPerfilProcValor && aux.mapPerfilProcValor.get(pn));
      addMarc(aux.mapPerfilProcTabela && aux.mapPerfilProcTabela.get(pn));
      if (!marcados.length) continue;
      const perfilNome = ((aux.mapPerfilAjuste && aux.mapPerfilAjuste.get(pn)) || {}).perfilNome || pn;
      for (const [cid, cnome] of candMap) {
        const cNorm = normalizar(cnome), cTok = tokenizar(cnome);
        let melhor = null, melhorScore = 0;
        for (const mc of marcados) {
          if (mc.id === cid) continue;
          const sim = similaridade(cNorm, mc.norm);
          const mt = matchTokens(cTok, mc.tok);
          const parecido = sim >= 0.72 || (mc.tok.length >= 2 && cTok.length >= 2 && (mt.coverageB >= 0.7 || mt.jaccard >= 0.5));
          if (parecido) {
            const score = Math.max(sim, mt.jaccard, mt.coverageB);
            if (score > melhorScore) { melhorScore = score; melhor = mc.nome; }
          }
        }
        if (melhor) out.push({ perfil: perfilNome, procNova: cnome, pareceCom: melhor });
      }
    }
    return out;
  }

  // ────────────────────────────────────────────────────────────────────────
  // CARREGAMENTO DE DADOS AUXILIARES (procedimentos, sinônimos, papéis, regras)
  // ────────────────────────────────────────────────────────────────────────
  // V252: especialidades (global) que recebem a linha-filha (exames) do PACOTE CONSULTA.
  // Config em config_sistema (chave PACOTE_CONSULTA_ESPECIALIDADES = JSON de IDs). Default: Retina.
  function lerEspecialidadesPacote() {
    try {
      const r = Banco.queryUnica(`SELECT valor FROM config_sistema WHERE chave='PACOTE_CONSULTA_ESPECIALIDADES'`);
      if (r && r.valor != null && String(r.valor).trim() !== '') {
        const arr = JSON.parse(r.valor);
        if (Array.isArray(arr)) return arr.map(Number).filter(x => x > 0);
      }
    } catch (_) {}
    // nunca configurado → default Retina (preserva o comportamento anterior)
    try {
      const ret = Banco.queryUnica(`SELECT id FROM especialidades WHERE UPPER(TRIM(nome))='RETINA'`);
      if (ret && ret.id != null) return [Number(ret.id)];
    } catch (_) {}
    return [];
  }
  function salvarEspecialidadesPacote(ids) {
    try {
      Banco.executar(`CREATE TABLE IF NOT EXISTS config_sistema (chave TEXT PRIMARY KEY, valor TEXT)`);
      Banco.executar(
        `INSERT INTO config_sistema (chave, valor) VALUES ('PACOTE_CONSULTA_ESPECIALIDADES', ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
        [JSON.stringify((ids || []).map(Number).filter(x => x > 0))]);
      Banco.salvar();
      return true;
    } catch (e) { console.error('[calcular] salvarEspecialidadesPacote', e); return false; }
  }
  function renderEspPacoteUI() {
    let esps = [];
    try { esps = Banco.query(`SELECT id, nome FROM especialidades WHERE ativo = 1 ORDER BY ordem, nome`) || []; } catch (_) {}
    const selEsp = new Set(lerEspecialidadesPacote());
    const chips = esps.map(e => `
      <label class="calc-aj-pk-esp-chip ${selEsp.has(Number(e.id)) ? 'is-on' : ''}">
        <input type="checkbox" class="calc-aj-pk-esp-cb" value="${e.id}" ${selEsp.has(Number(e.id)) ? 'checked' : ''}>
        <span>${esc(e.nome)}</span>
      </label>`).join('');
    return `
      <div class="calc-aj-exc-secao calc-aj-pk-esp-secao">
        <h4 class="calc-aj-exc-titulo">✦ Especialidades que recebem os exames inclusos</h4>
        <p class="calc-aj-pk-ajuda" style="margin:0 0 12px;font-size:11.5px;color:var(--ink-soft);">
          A linha-filha (<strong>exames inclusos</strong>) só é paga ao médico da consulta se ele tiver <strong>uma destas especialidades</strong> cadastrada no módulo Médicos. Marque uma ou mais. <em>(Padrão: Retina.)</em>
        </p>
        ${esps.length === 0
          ? `<div class="calc-aj-vazio">Nenhuma especialidade cadastrada no módulo Médicos.</div>`
          : `<div class="calc-aj-pk-esp-chips">${chips}</div>
             <button id="calc-aj-pk-esp-salvar" class="calc-aj-exc-btn calc-aj-exc-btn-salvar" style="margin-top:10px;">✓ Salvar especialidades</button>`}
      </div>`;
  }

  // ─── V620: VALIDADOR da regra do Pacote de Consulta (executante real) ───
  // Varre o cálculo carregado e mostra, admissão por admissão, como a regra
  // decidiu a linha-filha: mesma pessoa, herdada pelo executante real (azul),
  // travada pela especialidade ou sem mapeamento na Produção.
  function validarRegraPacote() {
    const res = state.resultado;
    if (!res || !res.linhas || !res.linhas.length) {
      return { erro: 'Nenhum cálculo carregado. Selecione a competência e calcule (ou abra um mês com cálculo salvo) antes de validar.' };
    }
    const maes = res.linhas.filter(l => l._regraPacote && !l._ehPacoteDetalhe);
    if (!maes.length) {
      return { erro: `Nenhuma linha de ${state.competencia} casou com um Pacote de Consulta. Confira se o convênio do QVIS está na lista de pacotes acima (✓ verde/dourado ou 🔗 vinculado).` };
    }
    const aux = carregarAux();
    const cache = new Map();
    const filhasPorAdm = new Map();
    for (const l of res.linhas) {
      if (!l._ehPacoteDetalhe) continue;
      const k = String(l._paiAdmissao || l.admissao || '').trim();
      if (!filhasPorAdm.has(k)) filhasPorAdm.set(k, []);
      filhasPorAdm.get(k).push(l);
    }
    const rows = maes.map(m => {
      const adm = String(m.admissao || '').trim();
      const filha = (filhasPorAdm.get(adm) || [])[0] || null;
      const prod = execRealMapeamentoRetina(adm, cache);
      let decisao, cls, detalhe;
      if (!prod) {
        detalhe = 'Produção sem linha de MAPEAMENTO + RETINA nesta admissão';
        if (filha) { decisao = 'Filha padrão — médico da consulta'; cls = 'ok'; }
        else { decisao = 'Filha NÃO criada — médico da consulta sem a especialidade'; cls = 'trava'; }
      } else {
        const medExec = matcharMedico(prod.medico, aux);
        const medAdm  = matcharMedico(prod.profissional_admissao, aux);
        const mesma = normalizar(prod.medico) === normalizar(prod.profissional_admissao) ||
                      (medExec && medAdm && medExec.id === medAdm.id);
        detalhe = `Produção → PROF. ADMISSÃO: ${prod.profissional_admissao || '—'} · MÉDICO: ${prod.medico}`;
        if (mesma) {
          if (filha) { decisao = 'MÉDICO = PROF. ADMISSÃO — filha com o médico da consulta'; cls = 'ok'; }
          else { decisao = 'Filha NÃO criada — médico da consulta sem a especialidade'; cls = 'trava'; }
        } else if (filha) {
          decisao = 'HERDADA pelo executante real (coluna MÉDICO)'; cls = 'azul';
          if (!filha._execRealProducao) detalhe += ' · ⚠ cálculo salvo é anterior à regra — Recalcule pra aplicar';
        } else {
          decisao = 'Filha NÃO criada — executante real sem a especialidade'; cls = 'trava';
        }
      }
      return { adm, convenio: m._pacoteConvenio || m.convenio || '', medConsulta: m.nome_profissional || '',
               filhaProf: filha ? filha.nome_profissional : null,
               filhaValor: filha ? (Number(filha._repasse) || 0) : null,
               decisao, cls, detalhe };
    });
    return {
      rows,
      resumo: {
        total: rows.length,
        herdadas: rows.filter(r => r.cls === 'azul').length,
        padrao: rows.filter(r => r.cls === 'ok').length,
        travadas: rows.filter(r => r.cls === 'trava').length,
      },
    };
  }

  function renderValidacaoPacote() {
    const v = state.pacoteValidacao;
    if (!v) return '';
    if (v.erro) return `<div class="calc-aj-pk-val-erro">⚠ ${esc(v.erro)}</div>`;
    const chip = (r) => r.cls === 'azul'
      ? `<span class="calc-aj-pk-val-chip is-azul">herdada</span>`
      : r.cls === 'trava'
        ? `<span class="calc-aj-pk-val-chip is-trava">sem filha</span>`
        : `<span class="calc-aj-pk-val-chip is-ok">padrão</span>`;
    return `
      <div class="calc-aj-pk-val-resumo">
        <strong>${v.resumo.total}</strong> consulta${v.resumo.total === 1 ? '' : 's'} de pacote em ${esc(state.competencia)} ·
        <span class="calc-aj-pk-val-chip is-azul">${v.resumo.herdadas} herdada${v.resumo.herdadas === 1 ? '' : 's'} pelo executante real</span>
        <span class="calc-aj-pk-val-chip is-ok">${v.resumo.padrao} padrão</span>
        <span class="calc-aj-pk-val-chip is-trava">${v.resumo.travadas} sem filha (trava)</span>
      </div>
      <div class="calc-aj-pk-val-tabwrap">
        <table class="calc-aj-pk-val-tab">
          <thead><tr><th></th><th>Admissão</th><th>Convênio</th><th>Médico da consulta</th><th>Linha-filha</th><th>Decisão da regra</th></tr></thead>
          <tbody>
            ${v.rows.map(r => `
              <tr class="calc-aj-pk-val-tr-${r.cls}">
                <td>${chip(r)}</td>
                <td class="mono">${esc(r.adm)}</td>
                <td>${esc(r.convenio)}</td>
                <td>${esc(CodigoMedico.exibir(r.medConsulta))}</td>
                <td>${r.filhaProf
                  ? `${esc(CodigoMedico.exibir(r.filhaProf))} <small>· R$ ${fmt(r.filhaValor)}</small>`
                  : '<span class="calc-aj-pk-val-nada">não criada</span>'}</td>
                <td><div>${esc(r.decisao)}</div><small class="calc-aj-pk-val-det">${esc(r.detalhe)}</small></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function carregarAux() {
    // V200: cache do aux entre chamadas. As estruturas dependem só de cadastros
    // (procedimentos, regras, médicos, pacotes, sinônimos) que mudam raramente.
    // Invalidado por window.__atlasInvalidarAux() após edições na Base/Médicos.
    if (window.__atlasAuxCache) return window.__atlasAuxCache;
    const procs = (Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM procedimentos`) || [])
      .map(p => ({ ...p,
                   _norm: normalizar(p.nome_normalizado || p.nome_oficial),
                   _tokens: tokenizar(p.nome_normalizado || p.nome_oficial) }));
    const mapProcsExatos = new Map();
    for (const p of procs) {
      if (p._norm) mapProcsExatos.set(p._norm, p);
      // V132.7: indexa também o nome_oficial normalizado (robustez quando o
      // nome_normalizado gravado no banco diverge da função normalizar atual)
      const normOficial = normalizar(p.nome_oficial);
      if (normOficial && !mapProcsExatos.has(normOficial)) mapProcsExatos.set(normOficial, p);
    }

    const sinos = (Banco.query(`SELECT procedimento_id, grafia, grafia_normalizada FROM sinonimos_proc`) || []);
    const mapSinos = new Map();
    for (const s of sinos) {
      const n = normalizar(s.grafia_normalizada || s.grafia);
      if (n && !mapSinos.has(n)) mapSinos.set(n, s.procedimento_id);
    }
    const procPorId = new Map(procs.map(p => [p.id, p]));

    const papeis = (Banco.query(`SELECT id, nome FROM papeis`) || []);
    const mapPapeis = new Map();
    for (const p of papeis) mapPapeis.set(normalizar(p.nome), p.id);

    let mapeamento = [];
    try { mapeamento = Banco.query(`SELECT papel_qvis, papel_id FROM mapeamento_papeis`) || []; } catch (_) {}
    const mapPapelQvis = new Map();
    for (const m of mapeamento) mapPapelQvis.set(normalizar(m.papel_qvis), m.papel_id);

    const regras = (Banco.query(
      `SELECT t.procedimento_id, t.papel_id, t.fonte_pagadora, t.valor, t.percentual
       FROM tabela_repasse t
       JOIN procedimentos p ON p.id = t.procedimento_id
       WHERE t.ativo = 1 AND p.repassavel = 1`
    ) || []);
    const mapRegras = new Map();
    const procsComRegra = new Set();   // V132: procedimentos que têm AO MENOS uma regra cadastrada
    for (const r of regras) {
      const k = `${r.procedimento_id}|${r.papel_id}|${normalizar(r.fonte_pagadora)}`;
      if (!mapRegras.has(k)) mapRegras.set(k, r);
      procsComRegra.add(r.procedimento_id);
    }

    // V131.3: médicos + sinônimos pra match por nome → tipo_vinculo
    const medicos = (Banco.query(`SELECT id, nome_oficial, nome_normalizado, tipo_vinculo FROM medicos WHERE ativo = 1`) || []);
    const mapMedicosExato = new Map();
    for (const m of medicos) {
      const n = normalizar(m.nome_normalizado || m.nome_oficial);
      if (n) mapMedicosExato.set(n, m);
    }
    let sinMed = [];
    try { sinMed = Banco.query(`SELECT medico_id, grafia, grafia_normalizada FROM sinonimos_medico`) || []; } catch (_) {}
    const mapSinMed = new Map();
    for (const s of sinMed) {
      const n = normalizar(s.grafia_normalizada || s.grafia);
      if (n && !mapSinMed.has(n)) mapSinMed.set(n, s.medico_id);
    }
    const medicoPorId = new Map(medicos.map(m => [m.id, m]));

    // V131.43/44: regras de EXCEÇÃO por (medico_id + procedimento_id + papel_id + fonte_pagadora)
    // sobrescrevem a regra geral da BASE TABELA quando existem.
    // fonte_pagadora pode ser 'TODAS' (qualquer fonte) ou específica ('CONVENIO', 'PARTICULAR', 'SUS').
    const mapRegrasExcecao = new Map();
    // V919: combinações (médico|proc|fonte) com "anular os demais papéis" —
    // papel SEM sobreposição nelas fica ZERADO em vez de seguir a Base Tabela.
    // Guarda as vigências (a anulação respeita a mesma janela da regra).
    const mapExcecaoAnula = new Map();
    try {
      const excecoes = Banco.query(
        `SELECT medico_id, procedimento_id, papel_id, fonte_pagadora, valor, percentual,
                UPPER(COALESCE(extracao, 'QVIS')) AS extracao, vigencia_inicio,
                COALESCE(anular_demais, 0) AS anular_demais
           FROM tabela_repasse_excecao WHERE ativo = 1`
      ) || [];
      for (const e of excecoes) {
        const fonteN = normalizar(e.fonte_pagadora || 'TODAS');
        const k = `${e.medico_id}|${e.procedimento_id}|${e.papel_id}|${fonteN}`;
        mapRegrasExcecao.set(k, e);
        if (Number(e.anular_demais) === 1) {
          const ka = `${e.medico_id}|${e.procedimento_id}|${fonteN}`;
          if (!mapExcecaoAnula.has(ka)) mapExcecaoAnula.set(ka, []);
          mapExcecaoAnula.get(ka).push(e.vigencia_inicio || null);
        }
      }
    } catch (_) {}

    // V131.49/52: PACOTE DE CONSULTA por convênio
    // Aplica em linhas cujo procedimento contém "CONSULTA" (modo auto)
    // ou que estão na whitelist do pacote (modo manual).
    const mapPacotes = new Map();
    try {
      const pkgs = Banco.query(
        `SELECT id, convenio_nome, convenio_label,
                valor_consulta, percentual_consulta,
                valor, percentual, nome_detalhe
           FROM pacote_convenio WHERE ativo = 1`
      ) || [];
      for (const p of pkgs) {
        mapPacotes.set(p.convenio_nome, p);
      }
    } catch (_) {}

    // V131.50: Procedimentos vinculados manualmente a cada pacote (whitelist)
    // mapProcsPacote: Map<pacote_id, Set<procedimento_id>>
    // Quando o pacote tem procs vinculados, SÓ esses entram (ignora "contém CONSULTA").
    const mapProcsPacote = new Map();
    try {
      const links = Banco.query(
        `SELECT pacote_id, procedimento_id FROM pacote_procedimento WHERE ativo = 1`
      ) || [];
      for (const r of links) {
        if (!mapProcsPacote.has(r.pacote_id)) mapProcsPacote.set(r.pacote_id, new Set());
        mapProcsPacote.get(r.pacote_id).add(r.procedimento_id);
      }
    } catch (_) {}

    // V131.59: Aliases de convênio (vínculos manuais "flag")
    // mapAliasPacote: Map<alias_normalizado, pacote>
    const mapAliasPacote = new Map();
    try {
      const aliases = Banco.query(
        `SELECT a.alias_nome,
                p.id, p.convenio_nome, p.convenio_label,
                p.valor_consulta, p.percentual_consulta,
                p.valor, p.percentual, p.nome_detalhe
           FROM pacote_alias a
           JOIN pacote_convenio p ON p.id = a.pacote_id
          WHERE p.ativo = 1`
      ) || [];
      for (const a of aliases) {
        mapAliasPacote.set(a.alias_nome, a);
      }
    } catch (_) {}

    // V252: Médicos com QUALQUER das especialidades configuradas (global) que recebem a
    // linha-filha (exames) do PACOTE CONSULTA. Config em config_sistema; default Retina.
    const medicosEspPacote = new Set();
    try {
      const espIds = lerEspecialidadesPacote();
      if (espIds.length) {
        const ph = espIds.map(() => '?').join(',');
        const rowsRet = Banco.query(
          `SELECT DISTINCT me.medico_id AS mid FROM medico_especialidades me
            WHERE me.especialidade_id IN (${ph})`, espIds) || [];
        for (const rr of rowsRet) if (rr.mid != null) medicosEspPacote.add(rr.mid);
      }
    } catch (_) {}

    // V219: PERFIS PARTICULARES ativos. Admissão com um desses perfis é paga pela
    // tabela de CONVÊNIO da BASE TABELA (não Particular), pra TODAS as linhas.
    // O ajuste (valor/percentual) é OPCIONAL: vazio = usa o valor de Convênio de cada
    // procedimento; preenchido = sobrescreve com R$ fixo ou % sobre o produzido.
    const perfisAtivos = new Set();              // Set<perfilNorm>
    const mapPerfilAjuste = new Map();           // perfilNorm → {perfilNome, perfilNorm, id, tabela}
    const mapPerfilProcTabela = new Map();       // V221: perfilNorm → Map(procId → 'CONVENIO'|'PARTICULAR')
    const mapPerfilProcValor = new Map();        // V243: perfilNorm → Map(procId → R$ fixo)
    try {
      const rowsPerfil = Banco.query(
        `SELECT id, perfil, tabela FROM perfil_regra WHERE ativo = 1`
      ) || [];
      const regraIdToNorm = new Map();
      for (const rp of rowsPerfil) {
        const pn = normalizar(rp.perfil);
        const tb = String(rp.tabela || 'CONVENIO').toUpperCase().trim() === 'PARTICULAR' ? 'PARTICULAR' : 'CONVENIO';
        perfisAtivos.add(pn);
        mapPerfilAjuste.set(pn, { perfilNome: rp.perfil, perfilNorm: pn, id: rp.id, tabela: tb });
        regraIdToNorm.set(rp.id, pn);
      }
      // V221: override de TABELA por procedimento (sobrescreve a tabela do perfil)
      const rowsProc = Banco.query(
        `SELECT regra_id, procedimento_id, tabela
           FROM perfil_regra_proc WHERE ativo = 1 AND tabela IS NOT NULL AND TRIM(tabela) <> ''`
      ) || [];
      for (const rp of rowsProc) {
        const pn = regraIdToNorm.get(rp.regra_id);
        if (!pn) continue;
        const tb = String(rp.tabela).toUpperCase().trim() === 'PARTICULAR' ? 'PARTICULAR' : 'CONVENIO';
        if (!mapPerfilProcTabela.has(pn)) mapPerfilProcTabela.set(pn, new Map());
        mapPerfilProcTabela.get(pn).set(rp.procedimento_id, tb);
      }
      // V243: override de VALOR FIXO por procedimento (sobrescreve a tabela do perfil)
      const rowsProcVal = Banco.query(
        `SELECT regra_id, procedimento_id, valor
           FROM perfil_regra_proc WHERE ativo = 1 AND valor IS NOT NULL`
      ) || [];
      for (const rp of rowsProcVal) {
        const pn = regraIdToNorm.get(rp.regra_id);
        if (!pn) continue;
        if (!mapPerfilProcValor.has(pn)) mapPerfilProcValor.set(pn, new Map());
        mapPerfilProcValor.get(pn).set(rp.procedimento_id, Number(rp.valor) || 0);
      }
    } catch (_) {}

    // ── V563: VERSÕES DA BASE TABELA — regras congeladas por data de admissão.
    // Sem versão publicada → tabela viva (comportamento original). Com versões,
    // cada linha usa a versão vigente na SUA data de admissão (o dia da
    // publicação já conta para a versão nova). Os mapas de cada versão são
    // montados UMA vez por cálculo (lazy) — custo extra por linha: uma busca
    // numa lista pequena ordenada + trocar 2 referências.
    let versoesTab = [];
    try {
      if (window.AtlasVersoesTabela && window.AtlasVersoesTabela.garantir()) {
        versoesTab = Banco.query(`SELECT id, numero, data_vigencia FROM tabela_versoes ORDER BY data_vigencia, id`) || [];
      }
    } catch (_) {}
    // V639: chaves (proc|papel|fonte) que existem em ALGUMA versão publicada.
    // O fallback pra tabela VIVA (V627/V631) só pode preencher buracos que
    // NUNCA foram publicados — regra que já existe numa versão tem vigência
    // própria (ex.: só na 2.0, vigente a partir de 01/07/2026) e NÃO pode
    // valer, via viva, em admissões resolvidas por outra versão.
    let keysPublicadas = null, procsPublicados = null;
    if (versoesTab.length) {
      keysPublicadas = new Set(); procsPublicados = new Set();
      try {
        const rowsPub = Banco.query(
          `SELECT DISTINCT procedimento_id, papel_id, fonte_pagadora
             FROM tabela_repasse_hist WHERE ativo = 1`) || [];
        for (const r of rowsPub) {
          keysPublicadas.add(`${r.procedimento_id}|${r.papel_id}|${normalizar(r.fonte_pagadora)}`);
          procsPublicados.add(r.procedimento_id);
        }
      } catch (_) {}
    }
    const regrasVersaoCache = new Map();   // versao_id → { mapRegras, procsComRegra }
    function regrasDaVersao(vid) {
      let rg = regrasVersaoCache.get(vid);
      if (rg) return rg;
      const rows = Banco.query(
        `SELECT h.procedimento_id, h.papel_id, h.fonte_pagadora, h.valor, h.percentual
           FROM tabela_repasse_hist h
           JOIN procedimentos_hist ph ON ph.versao_id = h.versao_id AND ph.procedimento_id = h.procedimento_id
          WHERE h.versao_id = ? AND h.ativo = 1 AND ph.repassavel = 1`, [vid]) || [];
      const mR = new Map(); const pS = new Set();
      for (const r of rows) {
        const k = `${r.procedimento_id}|${r.papel_id}|${normalizar(r.fonte_pagadora)}`;
        if (!mR.has(k)) mR.set(k, r);
        pS.add(r.procedimento_id);
      }
      rg = { mapRegras: mR, procsComRegra: pS };
      regrasVersaoCache.set(vid, rg);
      return rg;
    }

    const auxResult = { procs, mapProcsExatos, mapSinos, procPorId, papeis, mapPapeis, mapPapelQvis, mapRegras, procsComRegra,
             medicos, mapMedicosExato, mapSinMed, medicoPorId, mapRegrasExcecao, mapExcecaoAnula, mapPacotes, mapProcsPacote, mapAliasPacote,
             medicosEspPacote, perfisAtivos, mapPerfilAjuste, mapPerfilProcTabela, mapPerfilProcValor,
             // V563
             versoesTabela: versoesTab,
             _regrasLive: { mapRegras, procsComRegra },
             // V639
             _keysPublicadas: keysPublicadas, _procsPublicados: procsPublicados,
             usarRegrasPorData(dataAdm) {
               if (!versoesTab.length) return null;   // sem versão → tabela viva já carregada
               const d = String(dataAdm || '').slice(0, 10);
               let v = versoesTab[versoesTab.length - 1];         // sem data → última publicada
               if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
                 // V636: antes de TODAS as vigências → versão de MENOR NÚMERO
                 // (1.0, a padrão) — não a de vigência mais antiga (se a 1.0
                 // foi publicada com vigência posterior à da 2.0, datas velhas
                 // caíam indevidamente na 2.0)
                 v = null;
                 for (const c of versoesTab) { if (c.data_vigencia <= d) v = c; else break; }
                 if (!v) v = versoesTab.reduce((a, b) =>
                   (Number(String(b.numero).replace(',', '.')) || 0) < (Number(String(a.numero).replace(',', '.')) || 0) ? b : a, versoesTab[0]);
               }
               const rg = regrasDaVersao(v.id);
               this.mapRegras = rg.mapRegras;
               this.procsComRegra = rg.procsComRegra;
               return v;
             } };
    // com versões publicadas, o DEFAULT (caminhos sem data) é a última versão —
    // rascunho da tabela viva NÃO vale para cálculo até ser publicado
    if (versoesTab.length) auxResult.usarRegrasPorData(null);
    window.__atlasAuxCache = auxResult;
    return auxResult;
  }

  /**
   * V627: busca de regra com FALLBACK pra tabela VIVA em procedimento NOVO.
   * Com versões da Base Tabela publicadas, o cálculo usa as regras CONGELADAS
   * da versão vigente na data da admissão. Mas um procedimento que NÃO TINHA
   * NENHUMA regra naquela versão (procedimento novo, cadastrado depois) ficava
   * eternamente "NOVO/sem regra" mesmo após o usuário cadastrar — a regra viva
   * era ignorada. Agora: se a versão congelada não tem regra ALGUMA pro
   * procedimento, vale a regra da tabela viva (preenche o buraco sem reescrever
   * os valores históricos dos procedimentos que JÁ existiam na versão).
   */
  // V937: memória de cálculo — diz se a ÚLTIMA regra devolvida por buscarRegra
  // veio da tabela VIVA (buraco na versão congelada) e não da versão da data.
  let _regraVeioDaViva = false;
  function buscarRegra(aux, procId, papelId, fonteN) {
    _regraVeioDaViva = false;
    let regra = aux.mapRegras.get(`${procId}|${papelId}|${fonteN}`);
    if (!regra) regra = aux.mapRegras.get(`${procId}|${papelId}|TODAS`);
    // V631: QUALQUER buraco na versão congelada (proc+papel+fonte sem regra —
    // não só procedimento inteiro ausente) → vale a regra da tabela VIVA.
    // Ex.: versão tem só CONVENIO pro procedimento; o usuário cadastra a regra
    // PARTICULAR agora → ela passa a valer. Onde a versão TEM regra, ela manda
    // (histórico congelado intacto). "Não pagar de propósito" = regra com
    // valor/percentual zerados (papel omitido), não ausência de regra.
    if (!regra && aux._regrasLive && aux.mapRegras !== aux._regrasLive.mapRegras) {
      // V639: a viva só preenche buracos que NUNCA foram publicados em versão
      // alguma. Regra que já existe numa versão publicada tem vigência própria
      // (ex.: regra que só existe na 2.0, vigente a partir de 01/07/2026) e
      // não pode valer, via viva, em admissões resolvidas por outra versão.
      const kp = aux._keysPublicadas;
      const k1 = `${procId}|${papelId}|${fonteN}`;
      const k2 = `${procId}|${papelId}|TODAS`;
      if (!kp || !kp.has(k1)) regra = aux._regrasLive.mapRegras.get(k1);
      if (!regra && (!kp || !kp.has(k2))) regra = aux._regrasLive.mapRegras.get(k2);
      if (regra) _regraVeioDaViva = true;   // V937
    }
    return regra;
  }
  // V937: grava na linha o que a regra da BASE TABELA tinha (valor fixo ou %),
  // e se ela veio da tabela viva — só pra memória de cálculo, não muda o valor.
  function anotarRegra(r, regra) {
    if (!regra) return;
    r._regraValor = regra.valor != null ? (Number(regra.valor) || 0) : null;
    r._regraPct = regra.percentual != null ? (Number(regra.percentual) || 0) : null;
    r._regraViva = _regraVeioDaViva;
  }
  // V627: o procedimento tem regra pra ALGUM papel? (versão congelada OU, se
  // não existia nela, a tabela viva — mesmo critério do buscarRegra)
  function procTemRegraAlgum(aux, procId) {
    if (aux.procsComRegra.has(procId)) return true;
    // V639: a viva só conta pra procedimento NUNCA publicado em versão alguma
    // (procedimento realmente novo) — mesmo critério do buscarRegra.
    return !!(aux._regrasLive && aux.mapRegras !== aux._regrasLive.mapRegras &&
              !(aux._procsPublicados && aux._procsPublicados.has(procId)) &&
              aux._regrasLive.procsComRegra.has(procId));
  }

  /** Match de médico por nome (exato + sinônimos). Retorna o registro de `medicos` ou null. */
  function matcharMedico(nome, aux) {
    const norm = normalizar(nome);
    if (!norm) return null;
    const m = aux.mapMedicosExato.get(norm);
    if (m) return m;
    const medId = aux.mapSinMed.get(norm);
    if (medId) return aux.medicoPorId.get(medId) || null;
    return null;
  }

  // ────────────────────────────────────────────────────────────────────────
  // MATCH DE PROCEDIMENTO (3 camadas) — com cache pra performance
  // ────────────────────────────────────────────────────────────────────────
  // ─── V132.8: Inspetor de admissão — raio-x do caminho de decisão de cada linha ───
  function inspecionarAdmissao(adm) {
    adm = String(adm || '').trim();
    if (!adm) return;
    const aux = carregarAux();
    const compSel = state.competencia;
    const linhas = Banco.query(`SELECT * FROM linhas_qvis WHERE TRIM(admissao) = ? ORDER BY id`, [adm]) || [];
    const ESCOPO = new Set(['CONSULTA', 'EXAME', 'PROCEDIMENTO']);
    const cacheProc = new Map();

    let corpo = '';
    if (!linhas.length) {
      corpo = `<div class="calc-insp-vazio">Nenhuma linha encontrada em <strong>linhas_qvis</strong> para a admissão <strong>${esc(adm)}</strong>.<br>
        Ela <strong>não foi importada</strong> (ou está com outro número/espaços).</div>`;
    } else {
      corpo = linhas.map((lin, idx) => {
        const passos = [];
        const classNorm = normalizar(lin.classificacao_produto || '');
        const noEscopo = ESCOPO.has(classNorm);
        passos.push([`Classificação`, esc(lin.classificacao_produto || '—'), noEscopo ? 'ok' : 'erro', noEscopo ? 'no escopo' : 'FORA do escopo → ignorada']);

        const mesOk = (compSel === 'TODAS' || lin.mes_pagamento === compSel);
        passos.push([`Mês de pagamento`, esc(lin.mes_pagamento || '—'), mesOk ? 'ok' : 'erro', mesOk ? `bate com "${esc(compSel)}"` : `≠ "${esc(compSel)}" → NÃO entra neste cálculo`]);

        const ehParticular = String(lin.origem || '').toUpperCase().trim() === 'PARTICULAR';
        const recebido = Number(lin.recebido) || 0;
        const ehGlosa = !ehParticular && recebido <= 0;
        passos.push([`Recebido`, `R$ ${fmt(recebido)} (${esc(Utilidades.rotuloFonte(lin.origem) || '—')})`, ehGlosa ? 'aviso' : 'ok', ehGlosa ? 'Recebido = 0 → GLOSA' : 'ok']);

        const m = matcharProcedimento(lin.procedimento, aux, cacheProc);
        passos.push([`Match procedimento`, m ? `${esc(m.nome)} (${m.tipo})` : '—', m ? 'ok' : 'aviso', m ? 'encontrado na BASE' : 'NÃO encontrado → NOVO']);

        const papelId = matcharPapel(lin.papel, aux);
        const papelNome = papelId ? (aux.papeis.find(p => p.id === papelId) || {}).nome : null;
        passos.push([`Papel`, esc(lin.papel || '—'), papelId ? 'ok' : 'erro', papelId ? `→ ${esc(papelNome || '')}` : 'NÃO mapeado em mapeamento_papeis']);

        // V563: no inspetor, as regras consultadas são as da VERSÃO da tabela
        // vigente na data de admissão desta linha (mesma resolução do motor)
        let vTabInsp = null;
        if (aux.usarRegrasPorData) {
          vTabInsp = aux.usarRegrasPorData(lin.data_admissao || (lin.competencia ? lin.competencia + '-01' : ''));
          if (vTabInsp) passos.push([`Versão da tabela`, `Versão ${esc(vTabInsp.numero)} (vigente desde ${esc(vTabInsp.data_vigencia)})`, 'ok', 'resolvida pela data da admissão']);
        }

        let regraTxt = '—', regraTipo = 'aviso', concl = '';
        if (m && papelId) {
          const fonteRaw = normalizar(lin.origem);
          let regra = aux.mapRegras.get(`${m.id}|${papelId}|${fonteRaw}`);
          let viaTodas = false;
          if (!regra) { regra = aux.mapRegras.get(`${m.id}|${papelId}|TODAS`); if (regra) viaTodas = true; }
          // V629: espelha o motor — proc novo sem regra na versão congelada usa a viva
          let viaViva = false;
          if (!regra) { const rv = buscarRegra(aux, m.id, papelId, fonteRaw); if (rv) { regra = rv; viaViva = true; } }
          if (regra) {
            const temValor = regra.valor != null && Number(regra.valor) !== 0;
            const temPct = regra.percentual != null && Number(regra.percentual) !== 0;
            if (temValor || temPct) {
              regraTipo = 'ok';
              regraTxt = `valor=${regra.valor != null ? 'R$ ' + fmt(regra.valor) : '—'}, %=${regra.percentual != null ? regra.percentual : '—'}${viaTodas ? ' (via fonte TODAS)' : ''}${viaViva ? ' (sem regra na versão — usou a tabela viva)' : ''}`;
              concl = '✓ PAGA (casou)';
            } else {
              regraTxt = 'regra com valor E percentual zerados';
              concl = 'omitida (papel não remunerado)';
            }
          } else {
            const temOutras = procTemRegraAlgum(aux, m.id);   // V629
            const ehExec = ehExecutante(lin.papel);
            regraTxt = temOutras ? 'sem regra p/ este papel/fonte (proc TEM outras regras)' : 'proc SEM nenhuma regra cadastrada';
            if (ehExec || !temOutras) { concl = '→ aparece como NOVO'; }
            else { regraTipo = 'erro'; concl = 'omitida (papel secundário não remunerado)'; }
          }
        }
        passos.push([`Regra BASE TABELA`, regraTxt, regraTipo, concl]);

        const linhasPassos = passos.map(([lbl, val, tipo, obs]) => `
          <tr><td class="calc-insp-lbl">${lbl}</td><td class="calc-insp-val">${val}</td><td class="calc-insp-${tipo}">${esc(obs)}</td></tr>`).join('');

        return `<div class="calc-insp-linha">
            <div class="calc-insp-linha-head">Linha ${idx + 1}: <strong>${esc(lin.papel || '—')}</strong> · ${esc(Utilidades.procComPerfil(lin) || '—')}</div>
            <table class="calc-insp-tab"><tbody>${linhasPassos}</tbody></table>
          </div>`;
      }).join('');
    }

    const overlay = document.createElement('div');
    overlay.className = 'calc-insp-overlay';
    overlay.innerHTML = `<div class="calc-insp-modal">
        <div class="calc-insp-head">
          <h3>🔍 Inspeção da admissão ${esc(adm)}</h3>
          <button class="calc-insp-fechar" title="Fechar">×</button>
        </div>
        <div class="calc-insp-body">
          <div class="calc-insp-info">Competência selecionada: <strong>${esc(compSel || '—')}</strong> · ${linhas.length} linha(s) no QVIS</div>
          ${corpo}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const fechar = () => overlay.remove();
    overlay.querySelector('.calc-insp-fechar').addEventListener('click', fechar);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });
  }

  function matcharProcedimento(textoQvis, aux, cache) {
    const norm = normalizar(textoQvis);
    if (!norm) return null;
    if (cache.has(norm)) return cache.get(norm);

    // 1) Exato
    let m = aux.mapProcsExatos.get(norm);
    if (m) {
      const r = { id: m.id, nome: m.nome_oficial, tipo: 'exato', score: 1 };
      cache.set(norm, r); return r;
    }
    // 2) Sinônimo
    const procIdSin = aux.mapSinos.get(norm);
    if (procIdSin) {
      const p = aux.procPorId.get(procIdSin);
      if (p) {
        const r = { id: p.id, nome: p.nome_oficial, tipo: 'sinonimo', score: 1 };
        cache.set(norm, r); return r;
      }
    }
    // 3) Similaridade — só compara com candidatos de tamanho próximo (otimização)
    let melhor = null, melhorScore = state.limiar;
    const len = norm.length;
    for (const p of aux.procs) {
      const cand = p._norm;
      if (!cand) continue;
      // Pré-filtro de tamanho: se a diferença é grande, não pode passar do limiar
      const dl = Math.abs(cand.length - len);
      if (dl / Math.max(cand.length, len) > 1 - state.limiar) continue;
      const s = similaridade(norm, cand);
      if (s > melhorScore) { melhorScore = s; melhor = p; }
    }
    if (melhor) {
      const r = { id: melhor.id, nome: melhor.nome_oficial, tipo: 'similar', score: melhorScore };
      cache.set(norm, r); return r;
    }

    // 4) V131.18: Match por TOKENS (palavras-chave).
    //    Cobre casos onde o QVIS tem palavras a mais ou diferentes da BASE TABELA
    //    (ex: "FACECTOMIA C/ LENTE DOBRAVEL" × "FACECTOMIA LENTE INTRA OCULAR").
    //    Regras conservadoras pra evitar falsos positivos:
    //      - QVIS precisa ter ≥ 2 tokens significativos
    //      - BASE precisa ter ≥ 2 tokens (evita match com termos genéricos de 1 palavra)
    //      - coverageBASE >= 0.75 (75% das palavras-chave da BASE aparecem no QVIS)
    //      - coverageQVIS >= 0.40 (pelo menos 40% das palavras do QVIS estão na BASE)
    const tokensQvis = tokenizar(textoQvis);
    if (tokensQvis.length >= 2) {
      let melhorT = null, melhorScoreT = 0;
      for (const p of aux.procs) {
        const tokensBase = p._tokens || [];
        if (tokensBase.length < 2) continue;
        const { coverageA: covBase, coverageB: covQvis } = matchTokens(tokensBase, tokensQvis);
        if (covBase >= 0.75 && covQvis >= 0.40) {
          const score = (covBase * 0.6) + (covQvis * 0.4);  // peso maior em "BASE coberta"
          if (score > melhorScoreT) { melhorScoreT = score; melhorT = p; }
        }
      }
      if (melhorT) {
        const r = { id: melhorT.id, nome: melhorT.nome_oficial, tipo: 'tokens', score: melhorScoreT };
        cache.set(norm, r); return r;
      }
    }

    cache.set(norm, null);
    return null;
  }

  function matcharPapel(papelQvis, aux) {
    const norm = normalizar(papelQvis);
    if (!norm) return null;
    return aux.mapPapelQvis.get(norm) || aux.mapPapeis.get(norm) || null;
  }

  // V131.14: helper de identificação do papel executante (cirurgião/médico).
  // O valor `produzido` se repete por papel na mesma admissão, então vários cálculos
  // ficam restritos a executante pra evitar dupla contagem. Glosa também só vale
  // pra executante (auxiliares/solicitantes seguem o fluxo normal de cálculo).
  // V131.15: usa `normalizar` pra cobrir variações tipo "Médico", "MÉDICO", "Cirurgião", etc.
  const ehExecutante = (papel) => {
    const p = normalizar(papel);
    return p === 'CIRURGIAO' || p === 'MEDICO';
  };

  // V131.4: Mapeia papel do QVIS → colunas correspondentes em linhas_producao
  //         (pro fallback de valor quando QVIS vem zerado).
  //         Conservador: só busca onde o profissional realmente aparece naquele papel.
  function colunasProdPorPapel(papelQvis) {
    const p = String(papelQvis || '').toUpperCase().trim();
    if (p === 'CIRURGIAO') return ['cirurgiao'];
    if (p === 'MEDICO') return ['cirurgiao', 'medico'];
    if (p === 'SOLICITANTE') return ['solicitante'];
    if (p === 'AUXILIAR 1') return ['auxiliar_1'];
    if (p === 'AUXILIAR 2') return ['auxiliar_2'];
    if (p === 'AUXILIAR SADT') return ['auxiliar_sadt'];
    if (p === 'INDICANTE') return ['indicante'];
    if (p.startsWith('MEDICO DE LAUDO') || p.startsWith('MEDICO DO LAUDO')) return [];
    return [];
  }

  /**
   * V131.4: Fallback de Produção — quando o QVIS tem produzido = 0,
   * verifica se a MESMA admissão tem valor na Produção pro MESMO profissional
   * no PAPEL CORRESPONDENTE. Se sim, usa esse valor como base do cálculo.
   * Retorna o SUM(valor) > 0 encontrado, ou null.
   */
  function fallbackProducao(admissao, profissional, papelQvis, cache) {
    if (!admissao || !profissional) return null;
    const key = `${admissao}|${normalizar(profissional)}|${normalizar(papelQvis)}`;
    if (cache.has(key)) return cache.get(key);

    const cols = colunasProdPorPapel(papelQvis);
    if (cols.length === 0) { cache.set(key, null); return null; }

    const esc = (s) => String(s).replace(/'/g, "''");
    const admEsc = esc(admissao);
    const profEsc = esc(profissional);
    const condCols = cols.map(c => `UPPER(${c}) = UPPER('${profEsc}')`).join(' OR ');
    const sql = `SELECT SUM(valor) AS total FROM linhas_producao
                 WHERE cod_admissao = '${admEsc}' AND (${condCols})`;
    try {
      const r = Banco.query(sql);
      const t = (r && r[0] && Number(r[0].total)) || 0;
      const out = t > 0 ? t : null;
      cache.set(key, out);
      return out;
    } catch (e) {
      console.error('[calcular] fallbackProducao:', e);
      cache.set(key, null);
      return null;
    }
  }

  /**
   * V617: EXECUTANTE REAL do mapeamento de retina — busca na PRODUÇÃO a linha
   * da admissão cujo PRODUTO contém "MAPEAMENTO" e "RETINA" e devolve as colunas
   * MÉDICO e PROFISSIONAL DA ADMISSÃO dessa linha (pra linha-filha do PACOTE
   * CONSULTA ser herdada por quem executou o exame). Retorna null quando a
   * PRODUÇÃO não tem a admissão ou não tem linha de mapeamento com MÉDICO.
   */
  function execRealMapeamentoRetina(admissao, cache) {
    admissao = String(admissao || '').trim();
    if (!admissao) return null;
    if (cache.has(admissao)) return cache.get(admissao);
    let out = null;
    try {
      const rows = Banco.query(
        `SELECT produto, medico, profissional_admissao
           FROM linhas_producao
          WHERE cod_admissao = ?`, [admissao]) || [];
      for (const p of rows) {
        const prod = normalizar(p.produto || '');
        if (!prod.includes('MAPEAMENTO') || !prod.includes('RETINA')) continue;
        const med = String(p.medico || '').trim();
        if (!med) continue;
        out = { medico: med, profissional_admissao: String(p.profissional_admissao || '').trim() };
        break;
      }
    } catch (e) {
      console.error('[calcular] execRealMapeamentoRetina:', e);
    }
    cache.set(admissao, out);
    return out;
  }

  // V218: busca o PERFIL PARTICULAR de uma admissão na PRODUÇÃO (cacheado).
  // O QVIS não tem essa coluna; ela vem de linhas_producao.perfil_particular.
  // V238: perfil particular é por PRODUTO (linha de produção), NÃO pela admissão inteira.
  // Casa o `procedimento` da linha do QVIS com o `produto` da linha de produção que carrega
  // o perfil — pelo nome normalizado (normalizar() já tira hífens/barras/parênteses, então
  // "ORBSCAN /SCANSYS CERATOSCOPIA (MONOCULAR)" == "ORBSCAN - /SCANSYS - CERATOSCOPIA (MONOCULAR)").
  // Só a linha cujo produto bate recebe o perfil; as demais da mesma admissão NÃO.
  function perfilDaLinhaProd(admissao, procedimentoQvis, cache) {
    const adm = String(admissao || '').trim();
    if (!adm) return null;
    const procN = normalizar(procedimentoQvis || '');
    if (!procN) return null;
    const key = adm + '\u0000' + procN;
    if (cache.has(key)) return cache.get(key);
    let perfil = null;
    try {
      const esc = adm.replace(/'/g, "''");
      const rows = Banco.query(
        `SELECT produto, perfil_particular AS p FROM linhas_producao
          WHERE cod_admissao = '${esc}'
            AND perfil_particular IS NOT NULL AND TRIM(perfil_particular) <> ''`
      ) || [];
      for (const row of rows) {
        if (normalizar(row.produto || '') === procN) { perfil = String(row.p).trim(); break; }
      }
    } catch (e) { perfil = null; }
    cache.set(key, perfil);
    return perfil;
  }

  // V500: ESPECIALIDADE (coluna informativa) — vem da PRODUÇÃO importada
  // (linhas_producao.subespecialidade), cruzando pela admissão na MESMA
  // competência. NÃO participa de NENHUM cálculo de repasse.
  // Cache em variável do módulo, chaveado por `competencia + '|' + Banco._versao`
  // (a versão do banco muda a cada import/gravação, invalidando o cache).
  let _cacheEspecialidades = { versao: null, mapa: null };
  // V500.1: normalização da chave de admissão no padrão `chaveNum` que a
  // Auditoria e o Balanço já usam pra cruzar QVIS↔Produção: preferir SÓ os
  // DÍGITOS (sem zeros à esquerda) — imune a "12345.0", "0012345", "1.234.5"
  // e espaços. Fallback pro texto trimado quando a admissão não tem dígitos.
  // Aplicada IGUAL nos DOIS lados do cruzamento.
  const normAdmEsp = (x) => {
    const s = String(x == null ? '' : x).trim().replace(/\.0+$/, '');
    const d = s.replace(/\D/g, '').replace(/^0+/, '');
    return d || s.replace(/\s/g, '');
  };
  // V500.1: mapa GLOBAL admissão→especialidade (sem filtro de competência —
  // a admissão é um código único; filtrar por mês fazia o cruzamento falhar
  // quando a competência da produção divergia da do relatório, ex.: admissão
  // do fim do mês anterior ou bases importadas por versões antigas).
  function mapaEspecialidades() {
    const v = Banco._versao || 0;
    if (_cacheEspecialidades.versao === v && _cacheEspecialidades.mapa) return _cacheEspecialidades.mapa;
    // V503: cada admissão guarda { subs: [distintas], itens: [{prod, procPrinc, esp}] }
    // — os textos de produto/procedimento principal vão NORMALIZADOS pra permitir
    // o desempate pelo PRODUTO quando a admissão tem 2+ subespecialidades.
    const mapa = new Map();
    try {
      const rows = Banco.query(
        `SELECT cod_admissao, produto, procedimento_principal, subespecialidade
           FROM linhas_producao
          WHERE subespecialidade IS NOT NULL AND TRIM(subespecialidade) <> ''`
      ) || [];
      for (const r of rows) {
        const adm = normAdmEsp(r.cod_admissao);
        if (!adm) continue;
        const esp = String(r.subespecialidade).trim();
        if (!esp) continue;
        let ent = mapa.get(adm);
        if (!ent) { ent = { subs: [], itens: [] }; mapa.set(adm, ent); }
        if (!ent.subs.includes(esp)) ent.subs.push(esp);
        ent.itens.push({
          prod:      Utilidades.normalizar(String(r.produto || '')),
          procPrinc: Utilidades.normalizar(String(r.procedimento_principal || '')),
          esp,
        });
      }
    } catch (e) { console.error('[calcular] mapaEspecialidades:', e); }
    _cacheEspecialidades = { versao: v, mapa };
    return mapa;
  }
  // V503: especialidade de uma linha da matriz.
  // Regra (definida pelo usuário): ADMISSÃO(QVIS) = ADMISSÃO(PRODUÇÃO); se a
  // admissão tem MAIS de uma subespecialidade, PREDOMINA a linha da produção
  // cujo PRODUTO casa com o PROCEDIMENTO do QVIS (match exato normalizado,
  // depois por contém). Só se NENHUM produto casar, exibe todas com ' / '.
  // V504/V505: fallback QVIS — mapa admissão → linhas {proc, esp} da coluna
  // Especialidade do PRÓPRIO relatório QVIS, usado quando a admissão NÃO existe
  // na Produção (adições da auditoria como Pacote Consulta, consertos, fichários).
  let _cacheEspQvis = { versao: null, mapa: null };
  function mapaEspQvis() {
    const v = Banco._versao || 0;
    if (_cacheEspQvis.versao === v && _cacheEspQvis.mapa) return _cacheEspQvis.mapa;
    const mapa = new Map();
    try {
      const rows = Banco.query(
        `SELECT admissao, procedimento, especialidade FROM linhas_qvis
          WHERE especialidade IS NOT NULL AND TRIM(especialidade) <> ''`) || [];
      for (const r of rows) {
        const adm = normAdmEsp(r.admissao);
        if (!adm) continue;
        const esp = String(r.especialidade).trim();
        if (!esp) continue;
        let ent = mapa.get(adm);
        if (!ent) { ent = { itens: [] }; mapa.set(adm, ent); }
        ent.itens.push({ proc: Utilidades.normalizar(String(r.procedimento || '')), esp });
      }
    } catch (e) { console.error('[calcular] mapaEspQvis:', e); }
    _cacheEspQvis = { versao: v, mapa };
    return mapa;
  }
  // V505: última instância SEM " / " — devolve a especialidade MAIS FREQUENTE
  // entre as linhas da admissão (empate: a primeira que apareceu). Decisão do
  // usuário (opção a): valor único e limpo em vez de "A / B / C".
  function _espMaisFrequente(itens) {
    const cont = new Map();
    for (const x of itens) cont.set(x.esp, (cont.get(x.esp) || 0) + 1);
    let melhor = '', n = -1;
    for (const [esp, qtd] of cont) if (qtd > n) { melhor = esp; n = qtd; }
    return melhor;
  }
  // V505: match por texto (exato normalizado → contém) — mesmo critério nos dois lados
  function _espPorTexto(itens, campos, texto) {
    const p = Utilidades.normalizar(String(texto || ''));
    if (!p) return null;
    let hit = itens.find(x => campos.some(c => x[c] && x[c] === p));
    if (!hit) hit = itens.find(x => campos.some(c => x[c] && (x[c].indexOf(p) >= 0 || p.indexOf(x[c]) >= 0)));
    return hit ? hit.esp : null;
  }
  function especialidadeDaLinha(l) {
    if (!l) return '';
    const ent = mapaEspecialidades().get(normAdmEsp(l.admissao));
    if (ent) {
      if (ent.subs.length === 1) return ent.subs[0];
      // PRODUTO predomina (V503); sem match → mais frequente (V505, sem " / ")
      const porProduto = _espPorTexto(ent.itens, ['prod', 'procPrinc'], l.procedimento);
      if (porProduto) return porProduto;
      return _espMaisFrequente(ent.itens);
    }
    // V504: admissão SEM correspondência na Produção → Especialidade do QVIS:
    // 1º a da própria linha (filhas de pacote herdam da mãe); 2º a linha QVIS
    // da admissão cujo PROCEDIMENTO casa; 3º a mais frequente da admissão.
    const propria = String(l.especialidade || '').trim();
    if (propria) return propria;
    const entQ = mapaEspQvis().get(normAdmEsp(l.admissao));
    if (!entQ) return '';
    const porProc = _espPorTexto(entQ.itens, ['proc'], l.procedimento);
    if (porProc) return porProc;
    return _espMaisFrequente(entQ.itens);
  }

  // V901: a especialidade é DERIVADA (cruzamento com Produção/QVIS) — o filtro
  // e o combo a consultam linha a linha a cada tecla, então memoiza na própria
  // linha. As linhas nascem a cada calcular(), então a memória morre junto.
  function espLinha(l) {
    if (!l) return '';
    const v = Banco._versao || 0;   // banco mudou (reimporte) → rememoiza
    if (l._esp === undefined || l._espV !== v) {
      l._espV = v;
      l._esp = especialidadeDaLinha(l);
    }
    return l._esp;
  }

  // ────────────────────────────────────────────────────────────────────────
  // CÁLCULO PRINCIPAL — itera linhas_qvis aplicando as regras
  // ────────────────────────────────────────────────────────────────────────
  function calcular(opcoes) {
    opcoes = opcoes || {};
    const modoGlosa = opcoes.modoGlosa === true;   // V194: passagem isolada p/ estimar perda das glosadas
    const compForcada = opcoes.competencia || null;
    const t0 = performance.now();
    const aux = carregarAux();

    let where = '1=1';
    const compAlvo = compForcada || (state.competencia && state.competencia !== 'TODAS' ? state.competencia : null);
    if (compAlvo) {
      // V131.1: filtra pelo MÊS DE PAGAMENTO (mês de extração do QVIS)
      where = `mes_pagamento = '${String(compAlvo).replace(/'/g, "''")}'`;
    }
    // V194: no modo glosa, processa SÓ linhas com recebido zerado de CONVÊNIO/SUS
    // (PARTICULAR não glosa). Aplica TODAS as demais regras do motor sobre elas.
    if (modoGlosa) {
      where += ` AND COALESCE(recebido,0) <= 0 AND UPPER(TRIM(COALESCE(origem,''))) <> 'PARTICULAR'`;
    }
    const linhasBrutas = Banco.query(`SELECT * FROM linhas_qvis WHERE ${where} ORDER BY id`) || [];

    // V131.26: REGRA GERAL — só processar linhas onde CLASSIFICACAO PRODUTO ∈ {CONSULTA, EXAME, PROCEDIMENTO}.
    // Outras (TAXA, MATERIAL, OPME, MEDICAMENTO, GÁS, DIÁRIA) e SEM classificação ficam fora do relatório.
    const CLASSIFICACOES_VALIDAS = new Set(['CONSULTA', 'EXAME', 'PROCEDIMENTO']);
    const linhas = [];
    let nForaEscopo = 0;
    const foraEscopoPorClass = new Map();   // classificação_normalizada → contagem
    for (const lin of linhasBrutas) {
      const classNorm = normalizar(lin.classificacao_produto || '');
      if (CLASSIFICACOES_VALIDAS.has(classNorm)) {
        linhas.push(lin);
      } else {
        nForaEscopo++;
        const k = classNorm || '(sem classificação)';
        foraEscopoPorClass.set(k, (foraEscopoPorClass.get(k) || 0) + 1);
      }
    }

    const cacheProc = new Map();
    const cacheProd = new Map();    // V131.4: cache do fallback de Produção
    const cacheExecRetina = new Map(); // V617: cache do executante real do mapeamento (por admissão)
    const cachePerfilAdm = new Map();   // V219: perfil_particular por admissão (da Produção)
    const out = [];
    let totalRepasse = 0;
    let nCasou = 0, nProcSemRegra = 0, nSemRegraPapel = 0, nExcluidoTipo = 0, nGlosa = 0, nFallbackProd = 0;
    let nSemRemuneracao = 0;   // V132: papel sem remuneração na BASE (valor/percentual zerados) — omitido
    let nExato = 0, nSinonimo = 0, nSimilar = 0, nMatchTokens = 0;
    let nDuplicada = 0;             // V131.41: duplicidade histórica
    const vistosPerfilProcValor = new Set();   // V243: dedup do valor fixo (1x por admissão+procedimento)
    const candidatosNovaNom = new Map();       // V244: perfilNorm → Map(procId → nome) de procs não marcados sob perfil com exceções
    const medicosDetectados = new Map();   // nome_norm → { nome, tipo, count, total_produzido, medico_id }

    // V131.41: Carrega histórico de PAGOS em competências ANTERIORES pra detectar duplicidade.
    // Chave: `${cod_admissao}|${procedimento_norm}|${papel_id}`. Valor: competência mais antiga em que foi pago.
    // V200: usa compAlvo (não state.competencia) — corrige o modo glosa; cacheia por competência.
    let pagosAnteriores = new Map();
    if (compAlvo) {
      const cacheKey = `__atlasPagos_${compAlvo}`;
      if (window[cacheKey]) {
        pagosAnteriores = window[cacheKey];
      } else {
        try {
          const rows = Banco.query(
            `SELECT competencia, cod_admissao, procedimento_norm, papel_id
             FROM repasse_pagos
             WHERE competencia < ?
             ORDER BY competencia ASC`,
            [compAlvo]
          ) || [];
          for (const row of rows) {
            const k = `${row.cod_admissao}|${row.procedimento_norm}|${row.papel_id}`;
            if (!pagosAnteriores.has(k)) {
              pagosAnteriores.set(k, row.competencia);
            }
          }
          window[cacheKey] = pagosAnteriores;
        } catch (e) { console.warn('[calcular] erro lendo repasse_pagos:', e); }
      }
    }

    for (const linha of linhas) {
      const r = {
        id: linha.id,
        cod_repasse: linha.cod_repasse || '',
        admissao: linha.admissao || '',                   // V131.4: exposto na matriz
        nome_profissional: linha.nome_profissional || '',
        papel: linha.papel || '',
        procedimento: linha.procedimento || '',
        origem: String(linha.origem || '').toUpperCase(),
        convenio: linha.convenio || '',
        produzido: Number(linha.produzido) || 0,
        recebido: Number(linha.recebido) || 0,            // V131.4: para regra "Recebido > 0"
        competencia: linha.competencia || '',
        data_admissao: linha.data_admissao || '',
        mes_pagamento: linha.mes_pagamento || '',
        paciente: linha.paciente || '',
        classificacao: linha.classificacao_produto || '',
        _repasse: 0,
        _status: 'procSemRegra',          // V131.6: 'casou' | 'glosa' | 'procSemRegra' | 'excluidoTipo'
        _motivo: '',
        _matchTipo: null,
        _matchScore: null,
        _procOficial: null,
        _papelId: null,
        _medicoTipo: null,
        _medicoId: null,
        _valorBase: 0,                // V131.4: valor usado como base (produzido OU fallback)
        _fonteValor: null,            // V131.4: 'qvis' | 'producao'
      };

      // V563: seleciona a VERSÃO da Base Tabela vigente na data da admissão —
      // todas as consultas a aux.mapRegras/procsComRegra desta linha usam ela.
      if (aux.usarRegrasPorData) {
        const vTab = aux.usarRegrasPorData(r.data_admissao || (r.competencia ? r.competencia + '-01' : ''));
        if (vTab) r._versaoTabela = vTab.numero;
      }

      // V131.3: Match de médico → tipo_vinculo
      const med = matcharMedico(r.nome_profissional, aux);
      const tipoVinculo = (med && med.tipo_vinculo) ? String(med.tipo_vinculo).toUpperCase() : 'SEM_TIPO';
      r._medicoTipo = tipoVinculo;
      r._medicoId = med ? med.id : null;

      const nomeNorm = normalizar(r.nome_profissional);
      // registra detecção pra o modal de overrides (independente do status)
      if (nomeNorm) {
        const reg = medicosDetectados.get(nomeNorm) || {
          nome_norm: nomeNorm,
          nome_exibido: r.nome_profissional,
          tipo: tipoVinculo,
          medico_id: med ? med.id : null,
          count: 0,
          total_produzido: 0,
        };
        reg.count++;
        reg.total_produzido += r.produzido;
        medicosDetectados.set(nomeNorm, reg);
      }

      // V131.3: aplica override manual (se houver) — prioridade sobre o tipo
      const override = state.overrides && state.overrides.has(nomeNorm)
        ? state.overrides.get(nomeNorm) : null;
      const tipoHabilitado = state.tiposHabilitados.has(tipoVinculo);
      const passa = override === true ? true
                  : override === false ? false
                  : tipoHabilitado;

      if (!passa && !modoGlosa) {
        const motivo = override === false
          ? 'excluído manualmente'
          : `tipo "${tipoVinculo === 'SEM_TIPO' ? 'sem tipo' : tipoVinculo}" desabilitado nos ajustes`;
        r._status = 'excluidoTipo';
        r._motivo = motivo;
        nExcluidoTipo++;
        out.push(r);
        continue;
      }

      // V131.13: GLOSA só se aplica a CONVÊNIO e SUS.
      // PARTICULAR não tem conceito de glosa (cliente paga direto sem intermediário) —
      // aplica a regra da BASE TABELA usando Produzido, independente do Recebido.
      // V194: no modoGlosa NÃO abortamos aqui — queremos justamente calcular o
      // repasse que ESSAS linhas teriam, aplicando todas as demais regras.
      const fonteUp = String(r.origem || '').toUpperCase().trim();
      const ehParticular = fonteUp === 'PARTICULAR';
      if (!ehParticular && r.recebido <= 0 && !modoGlosa) {
        r._status = 'glosa';
        r._motivo = 'Recebido = R$ 0,00 (glosa do convênio) — repasse não devido';
        /**
         * V842: a linha glosada continua CLASSIFICADA — procedimento oficial e
         * papel. Sem isso ela chegava "anônima" na Auditoria (_papelId e
         * _procOficial nulos), e por isso NENHUMA regra rodava nela: o
         * INDICANTE não era criado e o AUXILIAR não ia para o cirurgião
         * (caso real trazido pelo usuário). Classificar não paga nada:
         * _repasse continua 0, o status continua GLOSA e a linha não entra em
         * nenhum total — só passa a ser auditável.
         */
        const mG = matcharProcedimento(r.procedimento, aux, cacheProc);
        if (mG) { r._matchTipo = mG.tipo; r._matchScore = mG.score; r._procOficial = mG.nome; }
        const papelG = matcharPapel(r.papel, aux);
        if (papelG) r._papelId = papelG;
        nGlosa++;
        out.push(r);
        continue;
      }

      // Match de procedimento
      const m = matcharProcedimento(r.procedimento, aux, cacheProc);
      if (!m) {
        r._motivo = 'Procedimento novo: não cadastrado na BASE TABELA';
        r._status = 'procSemRegra'; nProcSemRegra++; out.push(r); continue;
      }
      r._matchTipo = m.tipo; r._matchScore = m.score; r._procOficial = m.nome;

      // Match de papel
      const papelId = matcharPapel(r.papel, aux);
      if (!papelId) {
        r._motivo = `papel "${r.papel}" não mapeado em mapeamento_papeis`;
        r._status = 'semRegraPapel'; nSemRegraPapel++; out.push(r); continue;
      }
      r._papelId = papelId;

      // V131.41: Check de duplicidade histórica
      // (mesma admissão + procedimento + papel já pago em competência anterior)
      const codAdmDup = String(r.admissao || linha.admissao || '').trim();
      const procNormDup = normalizar(r.procedimento || '');
      if (codAdmDup && procNormDup) {
        const chaveDup = `${codAdmDup}|${procNormDup}|${papelId}`;
        const competenciaJaPaga = pagosAnteriores.get(chaveDup);
        if (competenciaJaPaga) {
          r._status = 'duplicada';
          r._motivo = `Duplicidade: mesma admissão + procedimento + papel já foram pagos em ${competenciaJaPaga}`;
          r._competenciaJaPaga = competenciaJaPaga;
          r._repasse = 0;
          // V531: valor NATURAL da regra (ignorando a remoção de duplicidade) —
          // usado só pelo export de glosa. NÃO altera _repasse/_status/total.
          { const _fN = normalizar(r.origem);
            const _g = buscarRegra(aux, m.id, papelId, _fN);   // V629: inclui fallback viva
            r._repasseRegra = _g ? (_g.valor != null ? (Number(_g.valor) || 0)
                                   : (_g.percentual != null && r.produzido > 0 ? r.produzido * Number(_g.percentual) : 0)) : 0;
            anotarRegra(r, _g); }   // V937: memória de cálculo
          nDuplicada++;
          out.push(r);
          continue;
        }
      }

      // Fonte pagadora
      if (!r.origem) {
        r._motivo = 'sem fonte pagadora (origem) na linha';
        r._status = 'semRegraPapel'; nSemRegraPapel++; out.push(r); continue;
      }

      // V221: PERFIL PARTICULAR — muda a TABELA de pagamento. Admissão com perfil
      // cadastrado é paga pela tabela escolhida (Convênio por padrão), em vez da origem
      // real (Particular). Cada procedimento pode sobrescrever a tabela (override).
      let perfilAtivoInfo = null;
      if (aux.perfisAtivos && aux.perfisAtivos.size && r.admissao) {
        const perfilAdm = perfilDaLinhaProd(r.admissao, r.procedimento, cachePerfilAdm);
        if (perfilAdm) {
          const pn = normalizar(perfilAdm);
          if (aux.perfisAtivos.has(pn)) perfilAtivoInfo = aux.mapPerfilAjuste.get(pn) || { perfilNome: perfilAdm, perfilNorm: pn, tabela: 'CONVENIO' };
        }
      }
      // V713: HONORÁRIO MÉDICO NÃO é afetado pelo perfil particular — o desvio
      // de tabela mandava o HM pra tabela do perfil (sem regra lá → linhas
      // replicadas zeradas, caso VISÃO SAÚDE). Ele segue o fluxo normal.
      if (perfilAtivoInfo && normalizar(r.procedimento || '').includes('HONORARIO MEDIC')) {
        perfilAtivoInfo = null;
      }
      if (perfilAtivoInfo) {
        // V243: VALOR FIXO por procedimento — sobrescreve a BASE TABELA, pago 1x por admissão+procedimento
        const ovValMap = aux.mapPerfilProcValor ? aux.mapPerfilProcValor.get(perfilAtivoInfo.perfilNorm) : null;
        const ovVal = ovValMap ? ovValMap.get(m.id) : null;
        if (ovVal != null) {
          r._regraPerfil = true; r._perfilNome = perfilAtivoInfo.perfilNome; r._perfilTabela = 'VALOR FIXO';
          const dedupKey = `${r.admissao}\u0000${normalizar(r.procedimento)}\u0000${perfilAtivoInfo.perfilNorm}`;
          if (vistosPerfilProcValor.has(dedupKey)) {
            r._repasse = 0; r._valorBase = 0; r._fonteValor = 'perfil-proc-valor-dup';
            r._motivo = `[Perfil ${perfilAtivoInfo.perfilNome}] Valor fixo já pago nesta admissão+procedimento`;
            r._repasseRegra = Number(ovVal) || 0;   // V531: valor natural da regra p/ export glosa
            r._status = 'duplicada'; nDuplicada++; out.push(r); continue;
          }
          vistosPerfilProcValor.add(dedupKey);
          const repasse = Number(ovVal) || 0;
          r._repasse = repasse; r._valorBase = repasse;
          r._regraValor = repasse; r._regraPct = null;   // V937: memória de cálculo
          r._fonteValor = 'perfil-proc-valor'; r._status = 'casou';
          totalRepasse += repasse; nCasou++; out.push(r); continue;
        }
        // tabela efetiva: override do procedimento > tabela do perfil > CONVENIO
        const ovMap = aux.mapPerfilProcTabela ? aux.mapPerfilProcTabela.get(perfilAtivoInfo.perfilNorm) : null;
        const ovTab = ovMap ? ovMap.get(m.id) : null;
        // V244: candidato a NOVA NOMENCLATURA — perfil TEM exceções marcadas, mas este proc não está marcado
        if (m && m.id != null && ovVal == null && ovTab == null) {
          const _pn = perfilAtivoInfo.perfilNorm;
          const _temMarc = (aux.mapPerfilProcValor && aux.mapPerfilProcValor.has(_pn)) || (aux.mapPerfilProcTabela && aux.mapPerfilProcTabela.has(_pn));
          if (_temMarc) {
            if (!candidatosNovaNom.has(_pn)) candidatosNovaNom.set(_pn, new Map());
            const _mm = candidatosNovaNom.get(_pn);
            if (!_mm.has(m.id)) _mm.set(m.id, m.nome || r.procedimento || '');
          }
        }
        const tabelaEfetiva = ovTab || perfilAtivoInfo.tabela || 'CONVENIO';
        const fonteEsc = normalizar(tabelaEfetiva);
        // V629: mesmo fallback do fluxo normal — procedimento NOVO (sem regra
        // alguma na versão congelada) usa a regra da tabela VIVA (PARTICULARES
        // pelo Perfil caíam aqui e continuavam "sem regra" após o cadastro)
        const regraPf = buscarRegra(aux, m.id, papelId, fonteEsc);
        if (!regraPf) {
          r._motivo = `[Perfil ${perfilAtivoInfo.perfilNome}] Sem regra de ${tabelaEfetiva} na BASE TABELA pra este procedimento/papel`;
          r._regraPerfil = true; r._perfilNome = perfilAtivoInfo.perfilNome; r._perfilTabela = tabelaEfetiva;
          r._status = 'semRegraPapel'; nSemRegraPapel++; out.push(r); continue;
        }
        let repasse = 0, base = null;
        anotarRegra(r, regraPf);   // V937: memória de cálculo
        if (regraPf.valor != null) {
          repasse = Number(regraPf.valor) || 0; base = repasse;
        } else if (regraPf.percentual != null) {
          base = r.produzido;
          r._baseFonte = 'qvis';
          if (base <= 0) {
            const vp = fallbackProducao(r.admissao, r.nome_profissional, r.papel, cacheProd);
            if (vp != null && vp > 0) { base = vp; nFallbackProd++; r._baseFonte = 'producao'; }
          }
          repasse = base > 0 ? base * Number(regraPf.percentual) : 0;
        }
        r._repasse = repasse;
        r._valorBase = base;
        r._regraPerfil = true;
        r._perfilNome = perfilAtivoInfo.perfilNome;
        r._perfilTabela = tabelaEfetiva;
        r._fonteValor = ovTab ? 'perfil-proc' : 'perfil';
        r._status = 'casou';
        totalRepasse += repasse;
        nCasou++;
        out.push(r);
        continue;
      }

      // V131.43/44: REGRA DE EXCEÇÃO (médico + procedimento + papel + fonte)
      // Se existe regra personalizada cadastrada pra esse quarteto, ela SOBRESCREVE a regra geral.
      // Busca primeiro a fonte ESPECÍFICA; se não achar, tenta 'TODAS' (wildcard).
      const medicoIdAtual = (med && med.id) ? med.id : null;
      const fonteRaw = normalizar(r.origem);
      let regraExcecao = null;
      if (medicoIdAtual != null) {
        const kEspecifica = `${medicoIdAtual}|${m.id}|${papelId}|${fonteRaw}`;
        const kTodas = `${medicoIdAtual}|${m.id}|${papelId}|TODAS`;
        regraExcecao = aux.mapRegrasExcecao.get(kEspecifica) || aux.mapRegrasExcecao.get(kTodas) || null;
      }
      /**
       * V912: VIGÊNCIA da exceção — a regra só vale para admissões com data
       * >= vigencia_inicio. Admissões ANTERIORES (ou sem data legível) seguem
       * a regra antiga da Base Tabela, como se a exceção não existisse.
       */
      if (regraExcecao && regraExcecao.vigencia_inicio) {
        const dataAdm = isoDataAdm(r.data_admissao);
        if (!dataAdm || dataAdm < regraExcecao.vigencia_inicio) regraExcecao = null;
      }
      if (regraExcecao) {   // V937: memória de cálculo — vigência e o que a exceção cadastra
        r._excecaoVigencia = regraExcecao.vigencia_inicio || null;
        r._regraValor = regraExcecao.valor != null ? (Number(regraExcecao.valor) || 0) : null;
        r._regraPct = regraExcecao.percentual != null ? (Number(regraExcecao.percentual) || 0) : null;
      }
      if (regraExcecao && String(regraExcecao.extracao || 'QVIS').toUpperCase() === 'PRODUCAO') {
        // V658: exceção com extração via PRODUÇÃO — o valor é pago 1× por admissão
        // pelo canal de DESEMPENHO (módulo "Exceção · Produção"). A linha do QVIS
        // NÃO paga nada (nem exceção nem regra geral) pra não duplicar.
        r._repasse = 0;
        r._valorBase = 0;
        r._fonteValor = 'excecao-producao';
        r._motivo = '[Exceção] paga via PRODUÇÃO (desempenho) — linha QVIS zerada';
        r._regraExcecao = true;
        r._status = 'casou';
        nCasou++;
        out.push(r);
        continue;
      }
      if (regraExcecao) {
        // Aplica exceção e marca a linha pra rastreabilidade
        if (regraExcecao.valor != null) {
          r._repasse = Number(regraExcecao.valor) || 0;
          r._valorBase = r._repasse;
          r._fonteValor = 'excecao';
        } else if (regraExcecao.percentual != null) {
          let base = r.produzido;
          let fonte = 'qvis';
          if (base <= 0) {
            const valorProd = fallbackProducao(r.admissao, r.nome_profissional, r.papel, cacheProd);
            if (valorProd != null && valorProd > 0) {
              base = valorProd;
              fonte = 'producao';
              nFallbackProd++;
            }
          }
          if (base <= 0) {
            r._motivo = '[Exceção] Produzido = R$ 0,00 e sem fallback de Produção';
            r._status = 'semRegraPapel'; nSemRegraPapel++; out.push(r); continue;
          }
          r._valorBase = base;
          r._baseFonte = fonte;   // V937
          r._fonteValor = (fonte === 'producao') ? 'excecao+producao' : 'excecao';
          r._repasse = base * Number(regraExcecao.percentual);
        } else {
          r._motivo = '[Exceção] cadastro inválido — sem valor nem percentual';
          r._status = 'semRegraPapel'; nSemRegraPapel++; out.push(r); continue;
        }
        r._regraExcecao = true;
        r._status = 'casou';
        totalRepasse += (Number(r._repasse) || 0);
        nCasou++;
        out.push(r);
        continue;
      }
      /**
       * V919: ANULAR OS DEMAIS PAPÉIS — a combinação (médico+procedimento+fonte)
       * tem sobreposição marcada como "só os papéis preenchidos pagam" e este
       * papel NÃO está entre eles → a linha fica ZERADA (não cai na Base
       * Tabela). A anulação respeita a vigência da regra: admissão anterior à
       * vigência segue a regra antiga normalmente.
       */
      if (medicoIdAtual != null) {
        const vigsAnula = aux.mapExcecaoAnula.get(`${medicoIdAtual}|${m.id}|${fonteRaw}`)
          || aux.mapExcecaoAnula.get(`${medicoIdAtual}|${m.id}|TODAS`);
        if (vigsAnula && vigsAnula.some(vig => {
          if (!vig) return true;
          const d = isoDataAdm(r.data_admissao);
          return d && d >= vig;
        })) {
          r._repasse = 0;
          r._valorBase = 0;
          r._fonteValor = 'excecao-anulado';
          r._motivo = '[Exceção] papel ANULADO — a sobreposição desta combinação paga só os papéis definidos nela';
          r._regraExcecao = true;
          r._excecaoAnulado = true;
          r._status = 'casou';
          nCasou++;
          out.push(r);
          continue;
        }
      }

      // V131.49/50/55: REGRA DE PACOTE DE CONSULTA (convênio + procedimento qualifica)
      // Aplica quando: origem == CONVENIO E convênio cadastrado em pacote_convenio
      // E procedimento qualifica:
      //   - Modo MANUAL: pacote tem whitelist em pacote_procedimento → proc deve estar listado
      //   - Modo AUTO  : whitelist vazia → proc deve conter "CONSULTA" no nome
      // V131.55: match RELAXADO por prefixo — se cadastrou "AMIL" e QVIS tem "AMIL (DF)" → bate
      const convNorm = normalizar(r.convenio || '');
      let regraPacoteCand = null;
      if (convNorm && fonteRaw === 'CONVENIO') {
        // 1) Match EXATO
        regraPacoteCand = aux.mapPacotes.get(convNorm) || null;
        // 2) Match por ALIAS (vínculo manual "flag")
        if (!regraPacoteCand) {
          regraPacoteCand = aux.mapAliasPacote.get(convNorm) || null;
        }
        // 3) Match por PREFIXO (cadastrado é o início do convênio do QVIS)
        if (!regraPacoteCand) {
          for (const [chave, p] of aux.mapPacotes.entries()) {
            if (chave && (convNorm === chave || convNorm.startsWith(chave + ' '))) {
              regraPacoteCand = p;
              break;
            }
          }
        }
      }
      let regraPacote = null;
      if (regraPacoteCand) {
        const procsCadastrados = aux.mapProcsPacote.get(regraPacoteCand.id);
        const temWhitelist = procsCadastrados && procsCadastrados.size > 0;
        const procContemConsulta = normalizar(r.procedimento || '').includes('CONSULTA');
        const aplicaPacote = temWhitelist
          ? (m && m.id && procsCadastrados.has(m.id))
          : procContemConsulta;
        if (aplicaPacote) regraPacote = regraPacoteCand;
      }
      if (regraPacote) {
        // ─── V131.52: Calcula MÃE (valor_consulta) e FILHA (valor) separadamente ───
        // Mãe: substitui o valor da BASE TABELA pela consulta especial do convênio.
        //   Fallback: se valor_consulta vazio, busca a regra normal da BASE TABELA.
        // Filha: o valor cadastrado (era o único valor antes) agora é o "extra" dos exames.
        let valorMae = null;
        let fonteMae = 'pacote-consulta';
        if (regraPacote.valor_consulta != null) {
          valorMae = Number(regraPacote.valor_consulta) || 0;
          r._valorBase = valorMae;
          r._regraValor = valorMae; r._regraPct = null;   // V937: memória de cálculo
        } else if (regraPacote.percentual_consulta != null) {
          let base = r.produzido;
          let fonte = 'qvis';
          if (base <= 0) {
            const valorProd = fallbackProducao(r.admissao, r.nome_profissional, r.papel, cacheProd);
            if (valorProd != null && valorProd > 0) {
              base = valorProd; fonte = 'producao'; nFallbackProd++;
            }
          }
          if (base > 0) {
            valorMae = base * Number(regraPacote.percentual_consulta);
            r._valorBase = base;
            r._regraPct = Number(regraPacote.percentual_consulta) || 0; r._regraValor = null; r._baseFonte = fonte;   // V937
            fonteMae = (fonte === 'producao') ? 'pacote-consulta+producao' : 'pacote-consulta';
          }
        }
        // Fallback pra BASE TABELA quando não há valor_consulta cadastrado
        if (valorMae == null) {
          const fonteN = fonteRaw;
          const regraBase = buscarRegra(aux, m.id, papelId, fonteN);   // V627: inclui fallback viva p/ proc novo
          if (regraBase) {
            anotarRegra(r, regraBase);   // V937
            if (regraBase.valor != null) {
              valorMae = Number(regraBase.valor) || 0;
              r._valorBase = valorMae;
              fonteMae = 'pacote-consulta-base';
            } else if (regraBase.percentual != null) {
              let base = r.produzido;
              r._baseFonte = 'qvis';
              if (base <= 0) {
                const valorProd = fallbackProducao(r.admissao, r.nome_profissional, r.papel, cacheProd);
                if (valorProd != null && valorProd > 0) { base = valorProd; nFallbackProd++; r._baseFonte = 'producao'; }
              }
              if (base > 0) {
                valorMae = base * Number(regraBase.percentual);
                r._valorBase = base;
                fonteMae = 'pacote-consulta-base';
              }
            }
          }
        }
        if (valorMae == null) {
          r._motivo = '[Pacote] sem valor de consulta cadastrado e sem regra na BASE TABELA';
          r._status = 'semRegraPapel'; nSemRegraPapel++; out.push(r); continue;
        }
        r._repasse = valorMae;
        r._fonteValor = fonteMae;
        r._regraPacote = true;
        r._pacoteConvenio = regraPacote.convenio_label;
        r._status = 'casou';
        totalRepasse += valorMae;
        nCasou++;
        out.push(r);

        // V617: EXECUTANTE REAL da linha-filha via PRODUÇÃO.
        // Busca na PRODUÇÃO a linha da mesma admissão cujo PRODUTO contém
        // "MAPEAMENTO" e "RETINA". Se a coluna MÉDICO for pessoa diferente do
        // PROFISSIONAL DA ADMISSÃO, a filha é herdada pelo profissional da
        // coluna MÉDICO (executante real). Sem PRODUÇÃO importada ou sem linha
        // de mapeamento → comportamento anterior (filha pro médico da consulta).
        let filhaNome    = r.nome_profissional;
        let filhaMedId   = r._medicoId;
        let filhaMedTipo = r._medicoTipo;
        let filhaExecReal = false;
        const execProd = execRealMapeamentoRetina(r.admissao, cacheExecRetina);
        if (execProd) {
          const medExec = matcharMedico(execProd.medico, aux);
          const medAdm  = matcharMedico(execProd.profissional_admissao, aux);
          const mesmaPessoa =
            normalizar(execProd.medico) === normalizar(execProd.profissional_admissao) ||
            (medExec && medAdm && medExec.id === medAdm.id);
          if (!mesmaPessoa) {
            filhaExecReal = true;
            filhaMedId    = medExec ? medExec.id : null;
            filhaMedTipo  = (medExec && medExec.tipo_vinculo) ? String(medExec.tipo_vinculo).toUpperCase() : 'SEM_TIPO';
            filhaNome     = medExec ? (medExec.nome_oficial || execProd.medico) : execProd.medico;
          }
        }

        // V132.x/V617: TRAVA DE ESPECIALIDADE 'Retina' na linha-filha do PACOTE CONSULTA.
        // A consulta (mãe) já foi paga acima. A linha-filha (exames inclusos) só é
        // criada/paga se QUEM RECEBE A FILHA (o executante real, quando houver
        // redirecionamento; senão o médico da consulta) tiver uma das especialidades
        // configuradas (default 'Retina') no módulo Médicos. Sem a especialidade
        // (ou não cadastrado) → a filha NÃO é criada. A linha-mãe segue normal.
        const _medTemEsp = (filhaMedId != null) &&
          aux.medicosEspPacote && aux.medicosEspPacote.has(filhaMedId);
        if (!_medTemEsp) {
          continue;
        }

        // ─── Linha-FILHA com valor próprio (não é mais R$ 0) ───
        let valorFilha = 0;
        let baseFilha = null, baseFonteFilha = null;   // V937
        if (regraPacote.valor != null) {
          valorFilha = Number(regraPacote.valor) || 0;
        } else if (regraPacote.percentual != null) {
          let base = r.produzido;
          baseFonteFilha = 'qvis';
          if (base <= 0) {
            const valorProd = fallbackProducao(r.admissao, r.nome_profissional, r.papel, cacheProd);
            if (valorProd != null && valorProd > 0) { base = valorProd; baseFonteFilha = 'producao'; }
          }
          if (base > 0) { valorFilha = base * Number(regraPacote.percentual); baseFilha = base; }
        }
        const linhaFilha = Object.assign({}, r, {
          // V937: memória de cálculo própria da filha (não herda a da mãe)
          _regraValor:     regraPacote.valor != null ? (Number(regraPacote.valor) || 0) : null,
          _regraPct:       regraPacote.percentual != null ? (Number(regraPacote.percentual) || 0) : null,
          _regraViva:      false,
          _baseFonte:      baseFonteFilha,
          _basePct:        baseFilha,
          procedimento:    regraPacote.nome_detalhe || 'Exames inclusos no pacote',
          nome_profissional: filhaNome,
          _medicoId:       filhaMedId,
          _medicoTipo:     filhaMedTipo,
          _execRealProducao: filhaExecReal,
          _procOficial:    null,
          _repasse:        valorFilha,
          _valorBase:      valorFilha,
          _status:         'pacoteDetalhe',
          _ehPacoteDetalhe: true,
          _paiAdmissao:    r.admissao,
          _paiProcedimento: r.procedimento,
          _pacoteConvenio: regraPacote.convenio_label,
          _motivo:         `Detalhe do pacote ${regraPacote.convenio_label} — valor extra dos exames inclusos`,
          _matchTipo:      null,
          _matchScore:     null,
          _fonteValor:     'pacote-filha',
        });
        // V131.52: a filha agora ENTRA no total de repasse (não é só informativa)
        totalRepasse += valorFilha;
        out.push(linhaFilha);
        continue;
      }

      // Buscar regra na BASE TABELA (fluxo normal)
      // V627: com fallback pra tabela VIVA quando o procedimento é NOVO
      // (sem nenhuma regra na versão congelada da data da admissão)
      const fonteN = fonteRaw;
      const regra = buscarRegra(aux, m.id, papelId, fonteN);

      if (!regra) {
        // V132.6: distinguir casos de "sem regra":
        // O EXECUTANTE (cirurgião/médico) é o papel principal — nunca é "não remunerado".
        // Se ele está sem regra, é sempre um caso a mostrar (procedimento a cadastrar).
        if (ehExecutante(r.papel) || !procTemRegraAlgum(aux, m.id)) {
          r._motivo = ehExecutante(r.papel)
            ? `procedimento "${m.nome}" sem regra cadastrada pro EXECUTANTE / fonte "${r.origem}"`
            : `procedimento "${m.nome}" sem nenhuma regra cadastrada na BASE TABELA`;
          r._status = 'procSemRegra'; nProcSemRegra++; out.push(r); continue;
        }
        // Procedimento TEM regras pra outros papéis, mas não pra ESTE papel secundário:
        // → papel não remunerado nesse procedimento → OMITE (não é erro).
        r._status = 'semRemuneracao'; nSemRemuneracao++;
        continue;
      }

      // V132: regra existe, mas valor E percentual zerados/vazios → papel não remunerado → OMITE.
      const temValor = regra.valor != null && Number(regra.valor) !== 0;
      const temPct   = regra.percentual != null && Number(regra.percentual) !== 0;
      if (!temValor && !temPct) {
        r._status = 'semRemuneracao'; nSemRemuneracao++;
        continue;   // omite — não entra no resultado
      }

      // Calcular — convênio/SUS = valor fixo; particular = produzido × %
      anotarRegra(r, regra);   // V937: memória de cálculo
      if (temValor) {
        // Valor fixo: produzido não importa, só pagamento já validado (recebido > 0)
        r._repasse = Number(regra.valor) || 0;
        r._valorBase = r._repasse;
        r._fonteValor = 'tabela';
      } else {
        // tem percentual: usa produzido do QVIS; se zerado, tenta fallback na Produção
        let base = r.produzido;
        let fonte = 'qvis';
        if (base <= 0) {
          const valorProd = fallbackProducao(r.admissao, r.nome_profissional, r.papel, cacheProd);
          if (valorProd != null && valorProd > 0) {
            base = valorProd;
            fonte = 'producao';
            nFallbackProd++;
          }
        }
        if (base <= 0) {
          r._motivo = 'Produzido = R$ 0,00 e sem valor correspondente na Produção pra esse profissional/papel';
          r._status = 'semRegraPapel'; nSemRegraPapel++; out.push(r); continue;
        }
        r._valorBase = base;
        r._fonteValor = fonte;
        r._baseFonte = fonte;   // V937
        r._repasse = base * (Number(regra.percentual) || 0);
      }
      r._status = 'casou';
      totalRepasse += r._repasse;
      nCasou++;
      if (m.tipo === 'exato') nExato++;
      else if (m.tipo === 'sinonimo') nSinonimo++;
      else if (m.tipo === 'tokens') nMatchTokens++;
      else nSimilar++;
      out.push(r);
    }

    const ms = Math.round(performance.now() - t0);
    const novasNomenclaturas = detectarNovasNomenclaturas(candidatosNovaNom, aux);   // V244
    return {
      linhas: out,
      kpis: { total: linhas.length, totalRepasse, nCasou, nProcSemRegra, nSemRegraPapel,
              nExcluidoTipo, nGlosa, nFallbackProd, nSemRemuneracao,
              nExato, nSinonimo, nSimilar, nMatchTokens, ms,
              nDuplicada,
              novasNomenclaturas,   // V244
              // V131.26: info do filtro de classificação
              nTotalBruto: linhasBrutas.length,
              nForaEscopo,
              foraEscopoPorClass: Array.from(foraEscopoPorClass.entries())
                .sort((a, b) => b[1] - a[1]) },
      medicosDetectados: Array.from(medicosDetectados.values())
        .sort((a, b) => b.total_produzido - a.total_produzido),
      ts: new Date().toISOString(),
    };
  }

  window.__atlasInvalidarAux = function () { window.__atlasAuxCache = null; };

  // ── V641: SIMULADOR DE LINHA — o MESMO motor do Calcular aplicado a uma
  // linha hipotética. Usado pelo "Check de regra" da Base Tabela pra conferir
  // qual VERSÃO da tabela e qual regra pagariam a linha (check preventivo),
  // sem depender de importação. Usa matcharProcedimento (exato/sinônimo/
  // similar), usarRegrasPorData (vigências, com a correção V636/V639) e
  // buscarRegra (fallback pra tabela viva só em regra nunca publicada).
  window.AtlasSimulador = {
    papeis() {
      try { return Banco.query(`SELECT id, nome FROM papeis ORDER BY nome`) || []; } catch (_) { return []; }
    },
    procedimentos() {
      try {
        return (Banco.query(`SELECT nome_oficial FROM procedimentos ORDER BY nome_oficial`) || [])
          .map(r => r.nome_oficial);
      } catch (_) { return []; }
    },
    simular({ dataAdmissao, procedimento, papelId, origem, produzido }) {
      const aux = carregarAux();
      const out = { versao: null, procOficial: null, matchTipo: null, temProc: false,
                    regra: null, viaViva: false, repasse: 0, semRegra: true };
      try {
        if (aux.usarRegrasPorData) {
          const v = aux.usarRegrasPorData(String(dataAdmissao || '').slice(0, 10) || null);
          if (v) out.versao = v.numero;
        }
        const m = matcharProcedimento(String(procedimento || ''), aux, new Map());
        if (!m) return out;
        out.temProc = true; out.procOficial = m.nome; out.matchTipo = m.tipo;
        const fonteN = normalizar(origem || '');
        const pid = Number(papelId);
        if (!pid) return out;
        const congelada = aux.mapRegras.get(`${m.id}|${pid}|${fonteN}`)
                       || aux.mapRegras.get(`${m.id}|${pid}|TODAS`) || null;
        const regra = buscarRegra(aux, m.id, pid, fonteN);
        if (!regra) return out;
        out.semRegra = false;
        out.viaViva = !congelada;   // regra veio da tabela VIVA (nunca publicada)
        out.regra = { valor: regra.valor != null ? Number(regra.valor) : null,
                      percentual: regra.percentual != null ? Number(regra.percentual) : null };
        const prod = Number(produzido) || 0;
        out.repasse = regra.valor != null ? (Number(regra.valor) || 0)
                    : (regra.percentual != null ? prod * Number(regra.percentual) : 0);
        return out;
      } finally {
        // restaura o estado padrão do aux (usarRegrasPorData é mutável)
        try { if (aux.usarRegrasPorData) aux.usarRegrasPorData(null); } catch (_) {}
      }
    },
  };

  // V531: EXPORT NATURAL da glosa — roda o motor (modoGlosa) e devolve as linhas
  // do QVIS em sua NATURALIDADE: TODOS os papéis, SEM aplicar remoção de
  // duplicidade nem filtro de papel. Cada linha traz o valor da REGRA DE REPASSE
  // que aquele papel receberia (mesmas regras do Calcular). PRODUZIDO é o do QVIS.
  window.__atlasGlosaNatural = function (competencia) {
    if (state.tiposHabilitados === null) state.tiposHabilitados = lerTiposHabilitados();
    if (state.overrides === null) state.overrides = lerOverrides();
    const res = calcular({ modoGlosa: true, competencia });
    const linhas = (res && res.linhas) ? res.linhas : [];
    // V532: quais papéis do QVIS são EXECUTANTE (mesma definição do card:
    // mapeamento_papeis → papel 'Executante'). Só o executante (médico/cirurgião)
    // carrega o PRODUZIDO; os demais papéis vão zerados, pra a soma bater c/ o card.
    const execQvis = new Set();
    try {
      const execRows = Banco.query(
        `SELECT UPPER(TRIM(papel_qvis)) AS p FROM mapeamento_papeis
          WHERE papel_id = (SELECT id FROM papeis WHERE nome = 'Executante')`) || [];
      execRows.forEach(r => { if (r.p) execQvis.add(r.p); });
    } catch (_) {}
    const ehExec = (papel) => execQvis.has(String(papel || '').trim().toUpperCase());
    return linhas.map(l => {
      const executante = ehExec(l.papel);
      return {
        id: l.id != null ? l.id : null,   // V533: id da linha_qvis p/ join com o QVIS cru
        admissao: l.admissao || '',
        procedimento: l.procedimento || '',
        papel: l.papel || '',
        nome: l.nome_profissional || '',
        convenio: l.convenio || '',
        origem: l.origem || '',
        ehExecutante: executante,
        // V532: PRODUZIDO só no executante; demais papéis = 0 (evita dobrar o total)
        produzido: executante ? (Number(l.produzido) || 0) : 0,
        recebido: Number(l.recebido) || 0,
        // 'casou' → repasse já calculado; 'duplicada' → valor natural da regra
        // (V531, ignora a remoção de duplicidade); demais status → sem regra = 0.
        regraRepasse: l._status === 'casou'
          ? (Number(l._repasse) || 0)
          : (l._repasseRegra != null ? (Number(l._repasseRegra) || 0) : 0),
        status: l._status || '',
      };
    });
  };

  // V194: expõe ao dashboard uma passagem isolada que estima a PERDA por glosa.
  // Roda o motor COMPLETO (match, papel, exceção, pacote, fracionamento,
  // duplicidade, regra geral) apenas sobre as linhas com recebido<=0 de
  // CONVÊNIO/SUS, sem abortar pela glosa. Retorna por linha:
  //   { nome, papel, papelId, procedimento, origem, admissao, produzido,
  //     repassePerdido, status }
  window.__atlasCalcularPerdaGlosa = function (competencia) {
    if (state.tiposHabilitados === null) state.tiposHabilitados = lerTiposHabilitados();
    if (state.overrides === null) state.overrides = lerOverrides();
    const res = calcular({ modoGlosa: true, competencia });
    const linhas = (res && res.linhas) ? res.linhas : [];
    return linhas.map(l => ({
      id: l.id != null ? l.id : null,   // V535: id da linha_qvis p/ o export de glosa casar o repasse
      nome: l.nome_profissional || '',
      papel: l.papel || '',
      papelId: l._papelId || null,
      procedimento: l.procedimento || '',
      origem: l.origem || '',
      convenio: l.convenio || '',   // V521: p/ o filtro de convênio do dashboard
      admissao: l.admissao || '',
      produzido: Number(l.produzido) || 0,
      // só conta perda quando o motor casou a regra (status 'casou');
      // duplicada/procSemRegra/semRegraPapel = sem repasse devido → perda 0
      repassePerdido: l._status === 'casou' ? (Number(l._repasse) || 0) : 0,
      status: l._status || '',
    }));
  };

  // ────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────
  function listarCompetencias() {
    try {
      // V131.1: usa mes_pagamento (mês de extração/pagamento do QVIS),
      // não competencia (que é derivada da data_admissao de cada linha)
      const r = Banco.query(`SELECT DISTINCT mes_pagamento FROM linhas_qvis
                             WHERE mes_pagamento IS NOT NULL AND mes_pagamento <> ''
                             ORDER BY mes_pagamento DESC`);
      return (r || []).map(x => x.mes_pagamento).filter(Boolean);
    } catch (_) { return []; }
  }

  // ── V734: fileira de filtros 20C (padrão desempenho_lio, prefixo calc-sb) ──
  // Uma única célula: Competência (Mês do QVIS) — central pro módulo (o ▶
  // Calcular usa ela). O <select id="calc-competencia"> continua no DOM,
  // FUNCIONAL porém escondido: testes externos setam value + dispatch('change')
  // nele; escolher na célula seta o select e dispara o MESMO change antigo.
  function _calcSbIc(nome) {
    return {
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      check: '<polyline points="20 6 9 17 4 12"/>',
      chev: '<polyline points="6 9 12 15 18 9"/>',
    }[nome] || '';
  }
  function _calcSbSvg(d, px, sw) {
    return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  function _calcSbSemAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function _calcSbRotuloComp(v) {
    return v === 'TODAS' ? 'Todas' : (v || '');
  }
  function renderBarraFiltrosCalc20C(competencias) {
    // guarda as opções pro painel abrir LOCAL depois, sem recoletar
    state._sbComps = competencias.slice();
    const valor = _calcSbRotuloComp(state.competencia);
    const estaAberta = state.sbAberto === 'competencia';
    return `
      <div class="calc-sb" id="calc-sb">
        <div class="calc-sb-celwrap" style="flex:1">
          <button type="button" class="calc-sb-cel ${valor ? 'ativo' : ''} ${estaAberta ? 'aberta' : ''}"
                  data-sb-cel="competencia" data-sb-vazio="—" role="combobox"
                  aria-expanded="${estaAberta ? 'true' : 'false'}" aria-haspopup="listbox"
                  title="Mês em que o relatório do QVIS foi extraído / pago">
            <span class="calc-sb-tile">${_calcSbSvg(_calcSbIc('calendar'), 14, 2.1)}</span>
            <span class="calc-sb-tx">
              <span class="calc-sb-rot">Mês do QVIS</span>
              <span class="calc-sb-val">${esc(valor || '—')}</span>
            </span>
            <span class="calc-sb-chev">${_calcSbSvg(_calcSbIc('chev'), 10, 2.8)}</span>
          </button>
          ${estaAberta ? painelCalc20C('competencia') : ''}
        </div>
      </div>`;
  }
  function painelCalc20C(id) {
    // mesmas opções (e MESMOS rótulos) do <select id="calc-competencia">:
    // "Todas" (value TODAS) no topo + cada competência disponível
    const comps = state._sbComps || [];
    const item = (val, rotulo, sel) => `
      <div class="calc-sb-it ${sel ? 'sel' : ''} ${val === 'TODAS' ? 'calc-sb-it-todos' : ''}" data-sb-item data-val="${esc(val)}" data-busca="${esc(_calcSbSemAcento(rotulo))}" role="option" aria-selected="${sel ? 'true' : 'false'}">
        <span class="calc-sb-it-nome">${esc(rotulo)}</span>
        ${sel ? `<span class="calc-sb-ck">${_calcSbSvg(_calcSbIc('check'), 14, 2.5)}</span>` : ''}
      </div>`;
    return `
      <div class="calc-sb-painel" data-sb-painel="${id}">
        <div class="calc-sb-lista" role="listbox">
          ${item('TODAS', 'Todas', state.competencia === 'TODAS')}
          ${comps.map(c => item(c, c, state.competencia === c)).join('')}
        </div>
      </div>`;
  }
  function bindBarraFiltrosCalc20C() {
    const sb = document.getElementById('calc-sb');
    if (!sb) return;
    const fecharPainelLocal = () => {
      sb.querySelectorAll('.calc-sb-painel').forEach(p => p.remove());
      sb.querySelectorAll('.calc-sb-cel.aberta').forEach(c => { c.classList.remove('aberta'); c.setAttribute('aria-expanded', 'false'); });
      state.sbAberto = null;
    };
    const aplicar = (celId, val) => {
      fecharPainelLocal();
      const sel = document.getElementById('calc-competencia');
      if (!sel || !val) return;
      if (sel.value === val) return;   // nada mudou — só fecha
      // seta o select oculto e dispara o MESMO handler antigo (state.competencia
      // + snapshot + render completo, que já re-sincroniza a célula)
      sel.value = val;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const abrirPainelLocal = (id) => {
      const jaAberto = state.sbAberto === id;
      fecharPainelLocal();
      if (jaAberto) return;
      state.sbAberto = id;
      const btn = sb.querySelector(`[data-sb-cel="${id}"]`);
      btn.classList.add('aberta');
      btn.setAttribute('aria-expanded', 'true');
      btn.parentElement.insertAdjacentHTML('beforeend', painelCalc20C(id));
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
      const painel = sb.querySelector('.calc-sb-painel');
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
    if (window.__calcSbFechar) {
      document.removeEventListener('click', window.__calcSbFechar);
      document.removeEventListener('keydown', window.__calcSbEsc);
    }
    const fecharFora = (e) => {
      if (App.telaAtual !== 'calcular') return;
      if (state.sbAberto && !e.target.closest('#calc-sb')) fecharPainelLocal();
    };
    const escFecha = (e) => { if (e.key === 'Escape' && state.sbAberto) fecharPainelLocal(); };
    window.__calcSbFechar = fecharFora;
    window.__calcSbEsc = escFecha;
    document.addEventListener('click', fecharFora);
    document.addEventListener('keydown', escFecha);
  }

  function render() {
    const competencias = listarCompetencias();

    // V131.40: se ainda não tem competência selecionada, usa a mais recente disponível
    if (!state.competencia && competencias.length) {
      state.competencia = competencias[0];
    }

    // V131.40: se a competência atual tem snapshot salvo e ainda não há resultado em memória, carrega
    if (state.competencia && state.competencia !== 'TODAS' && !state.resultado) {
      const snap = carregarSnapshot(state.competencia);
      if (snap) {
        state.resultado = snap;
        state.calculou = true;
      }
    }

    const res = state.resultado;

    // opções de competência
    const optsComp = ['<option value="TODAS">Todas</option>']
      .concat(competencias.map(c =>
        `<option value="${c}" ${state.competencia === c ? 'selected' : ''}>${c}</option>`)).join('');

    const html = `
      <div class="calc-tela">
        <header class="calc-header">
          <div class="calc-header-titulo">
            <h2>Calcular Repasse</h2>
            <p>Cruza as linhas do <strong>QVIS</strong> com a <strong>BASE TABELA</strong> aplicando a regra de cada (procedimento × papel × fonte pagadora).</p>
          </div>
          <div class="calc-header-acoes">
            <div class="calc-comp-wrap">
              <!-- V734: o select segue no DOM e FUNCIONAL (testes externos setam
                   value + change nele), só que escondido — a UI é a célula 20C -->
              <select id="calc-competencia" class="calc-select-oculto" tabindex="-1" aria-hidden="true">${optsComp}</select>
              ${(() => {
                // V131.40: badge de snapshot salvo
                const info = (state.competencia && state.competencia !== 'TODAS') ? infoSnapshot(state.competencia) : null;
                if (!info) return '';
                const dt = new Date(info.atualizado_em.replace(' ', 'T') + 'Z');
                const dataLocal = isNaN(dt.getTime()) ? info.atualizado_em : dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                return `<div class="calc-snap-info" title="Cálculo salvo automaticamente. O snapshot é carregado sempre que você abre essa competência.">
                  <span class="calc-snap-dot"></span>
                  <span class="calc-snap-txt">Cálculo salvo · ${esc(dataLocal)}</span>
                  <button id="calc-snap-apagar" class="calc-snap-apagar" title="Apagar cálculo salvo desse mês">apagar</button>
                </div>`;
              })()}
            </div>
            <div class="calc-header-botoes">
              <button id="calc-btn-inspecionar" class="calc-btn-acao calc-btn-ajustes" title="Diagnosticar uma admissão: ver o que acontece com cada linha dela">🔍 Inspecionar</button>
              <button id="calc-btn-ajustes" class="calc-btn-acao calc-btn-ajustes" title="Ajustes do Calcular Repasse">⚙ Ajustes</button>
              <button id="calc-btn-exportar" class="calc-btn-acao calc-btn-exportar" title="Exportar matriz em Excel (.xlsx) — mesmas colunas e linhas + cores/tags/visual idêntico" ${!state.calculou || !state.resultado ? 'disabled' : ''}>📥 Exportar matriz</button>
              ${(() => {
                // V619: mês consolidado → recálculo travado (registro oficial do mês)
                const consolidado = state.competencia && state.competencia !== 'TODAS' &&
                  window.AtlasConsolidacao && window.AtlasConsolidacao.estaConsolidado &&
                  window.AtlasConsolidacao.estaConsolidado(state.competencia);
                return consolidado
                  ? `<button id="calc-btn-calcular" class="calc-btn-acao calc-btn-calcular" title="Mês CONSOLIDADO — o cálculo salvo é o registro oficial do que foi repassado. Pra recalcular, reabra a competência na Consolidação." style="opacity:.55;cursor:not-allowed">🔒 Consolidado</button>`
                  : `<button id="calc-btn-calcular" class="calc-btn-acao calc-btn-calcular">▶ ${state.calculou ? 'Recalcular' : 'Calcular'}</button>`;
              })()}
            </div>
          </div>
        </header>
        <!-- V734: fileira de filtros 20C — IRMÃ do header, esticada de ponta a
             ponta. O wrapper tem "filtro" no nome (o leque #atlas-hub ignora
             [class*="filtro"]) e position:relative + z-index:30 (a animação
             fade-in-up global deixa transform residual nos irmãos → sem isso
             os painéis abririam POR BAIXO dos cards). -->
        <div class="calc-sb-filtros-bar">
          ${renderBarraFiltrosCalc20C(competencias)}
        </div>

        ${res ? renderResultado(res) : renderVazio(competencias)}
        ${state.ajustesAberto ? renderModalAjustes() : ''}
        ${state.cadastroAberto ? renderModalCadastroProc() : ''}
      </div>
    `;
    // V492: CSS injetado uma única vez no <head> (antes ia dentro do innerHTML
    // a cada render, forçando re-parse de ~1.700 linhas de estilo).
    Utilidades.garantirEstilos('css-tela-calcular', CSS);
    document.getElementById('conteudo').innerHTML = html;
    bind();
  }

  function renderVazio(competencias) {
    return `
      <div class="calc-vazio">
        <div class="calc-vazio-ico">∑</div>
        <h3>Pronto pra calcular</h3>
        <p>Escolha a competência e clique em <strong>Calcular</strong>. Vou cruzar cada linha do QVIS com a BASE TABELA aplicando a regra correta.</p>
        ${competencias.length === 0 ? `
          <div class="calc-vazio-aviso">⚠ Nenhuma competência encontrada — importe o QVIS primeiro.</div>
        ` : `
          <div class="calc-vazio-hint">${competencias.length} competência(s) disponível(is) no QVIS.</div>
        `}
      </div>
    `;
  }

  // V131.9: combobox CUSTOM (input + dropdown ornado) — substitui o datalist nativo feio
  // V493: o botão × e a lista de sugestões viraram funções-template (htmlComboX /
  // htmlComboOpcoes), compartilhadas com o caminho incremental (renderParcialFiltros).
  // Markup idêntico ao anterior — fonte única.
  function renderFiltroCombo(label, id, key, placeholder, valor, opcoes) {
    const sel = (state.multiSel && state.multiSel[key]) || [];   // V903
    const ativo = !!valor || sel.length > 0;
    const aberto = state.dropAberto === key;
    // V903: com itens marcados, o campo anuncia a contagem no placeholder
    const ph = sel.length && !valor
      ? `${sel.length} selecionado${sel.length > 1 ? 's' : ''}`
      : placeholder;

    return `
      <div class="calc-filtro-grupo">
        <label class="calc-filtro-label" for="${id}">${label}</label>
        <div class="calc-fil-input-wrap ${ativo ? 'calc-fil-ativo' : ''} ${aberto ? 'calc-fil-combo-aberto' : ''}">
          <span class="calc-fil-icone">🔎</span>
          <input type="text" id="${id}" class="calc-fil-input"
                 placeholder="${esc(ph)}"
                 value="${esc(valor)}" autocomplete="off"
                 data-fil-input="${key}">
          ${ativo ? htmlComboX(id) : ''}
          <button type="button" class="calc-fil-caret-btn" data-fil-toggle-input="${key}" tabindex="-1" title="Mostrar opções">
            <span class="calc-fil-caret">▾</span>
          </button>
          ${aberto ? htmlComboOpcoes(key, valor, opcoes) : ''}
        </div>
      </div>
    `;
  }

  // V493: botão × de limpar o combo — fonte única (render completo + incremental).
  // O clique é tratado por DELEGAÇÃO no #calc-filtros (ver bind()).
  function htmlComboX(id) {
    return `<button type="button" class="calc-fil-x" data-fil-x-input="${id}" title="Limpar este filtro">×</button>`;
  }

  // V493: lista de sugestões do combo (dropdown), já filtrada pelo texto digitado —
  // fonte única usada pelo renderFiltroCombo (render completo) E pelo
  // renderParcialFiltros (caminho da digitação). Só é chamada com o dropdown aberto.
  function htmlComboOpcoes(key, valor, opcoes) {
    /**
     * V903: cada opção é um CHECKBOX — marcar vários filtra pela união.
     * Os marcados ficam PINADOS no topo (mesmo quando o texto digitado não
     * os alcança); o texto digitado só procura nas demais opções.
     */
    const sel = (state.multiSel && state.multiSel[key]) || [];
    const selSet = new Set(sel);
    const b = normalizar(valor);
    const restantes = opcoes.filter(o => !selSet.has(o));
    const filtradas = !b ? restantes : restantes.filter(o => normalizar(o).includes(b));
    const LIMITE = 200;
    const exibir = filtradas.slice(0, LIMITE);
    if (sel.length === 0 && exibir.length === 0) return `
            <ul class="calc-fil-opcoes">
              <li class="calc-fil-opt-mais">Nenhuma sugestão correspondente.</li>
            </ul>
          `;
    const item = (o, marcado) => `
                <li class="calc-fil-opt ${marcado ? 'calc-fil-opt-ativa' : ''}"
                    data-fil-opt-key="${key}" data-fil-opt-valor="${esc(o)}" role="option" aria-selected="${marcado}">
                  <span class="calc-fil-opt-cbx ${marcado ? 'on' : ''}">${marcado ? '✓' : ''}</span>
                  <span class="calc-fil-opt-texto">${esc(o)}</span>
                </li>`;
    return `
            <ul class="calc-fil-opcoes" role="listbox">
              ${sel.map(o => item(o, true)).join('')}
              ${sel.length && exibir.length ? '<li class="calc-fil-opt-mais calc-fil-opt-separa"></li>' : ''}
              ${exibir.map(o => item(o, false)).join('')}
              ${filtradas.length > exibir.length ? `
                <li class="calc-fil-opt-mais">+${filtradas.length - exibir.length} sugestões — continue digitando pra refinar</li>
              ` : ''}
            </ul>
          `;
  }

  // V131.8: helper de filtro de DROPDOWN customizado (ornando com o tema)
  // V903: virou MULTI — cada opção é um checkbox; vários marcados = união.
  // A opção default ('todos'/'todas') zera a seleção.
  function rotuloDrop(sel, opcoes, valorDefault) {
    if (!sel.length) return (opcoes.find(o => o.v === valorDefault) || opcoes[0]).l;
    if (sel.length === 1) return (opcoes.find(o => o.v === sel[0]) || { l: sel[0] }).l;
    return `${sel.length} selecionados`;
  }
  function renderFiltroDrop(label, key, valorAtual, valorDefault, opcoes) {
    const sel = selDe(valorAtual, valorDefault);
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

  // V493: cálculo da visão filtrada (escopo → status → KPIs → totais → truncamento),
  // EXTRAÍDO de renderResultado() pra ser a fonte única usada TANTO pelo render()
  // completo QUANTO pelo renderParcialFiltros() (caminho da digitação nos combos).
  // Lógica idêntica à anterior — mesmos filtros, mesma ordem, mesmas contas.
  // V901.1: aplica os filtros do escopo PULANDO o de `exceto` — fonte única
  // usada pela visão (exceto='status', que é aplicado depois em duas etapas)
  // e pelas OPÇÕES de cada combo/drop (exceto = o próprio filtro, para os
  // filtros "respeitarem um ao outro": cada lista só mostra o que sobrevive
  // aos DEMAIS filtros ativos, sem esconder as alternativas do próprio campo).
  function aplicarFiltros(linhas, exceto) {
    let out = linhas;
    if (exceto !== 'fonte') {
      const fs = selDe(state.filtroFonte, 'todas');   // V903: multi (união)
      if (fs.length) {
        out = out.filter(l => fs.some(f =>
          f === 'PERFIL' ? !!l._regraPerfil : normalizar(l.origem) === f));
      }
    }
    if (exceto !== 'papel') {
      const ps = selDe(state.filtroPapel, 'todos').map(normalizar);   // V903: multi
      if (ps.length) out = out.filter(l => ps.includes(normalizar(l.papel)));
    }
    /**
     * V903: cada combo tem DOIS modos que não se misturam —
     *   · itens MARCADOS (multiSel): a linha entra se casar EXATO com
     *     qualquer um deles (união); o texto digitado só procura na lista;
     *   · nada marcado: o texto digitado filtra por "contém" (como sempre).
     */
    const combo = (key, campoDe) => {
      if (exceto === key) return;
      const sel = (state.multiSel[key] || []).map(x => String(x).toUpperCase());
      if (sel.length) {
        out = out.filter(l => campoDe(l).some(v => sel.includes(v)));
        return;
      }
      const busca = state[MAPA_KEY_STATE[key]];
      if (busca) {
        const b = busca.toUpperCase();
        out = out.filter(l => campoDe(l).some(v => v.includes(b)));
      }
    };
    combo('admissao', l => [String(l.admissao || '').toUpperCase(),
                            String(l.cod_repasse || '').toUpperCase()]);
    combo('profissional', l => [String(l.nome_profissional || '').toUpperCase()]);
    combo('procedimento', l => [String(l.procedimento || '').toUpperCase()]);
    combo('convenio', l => [String(l.convenio || '').toUpperCase()]);
    combo('especialidade', l => [espLinha(l).toUpperCase()]);   // V901
    if (exceto !== 'status') {
      const ss = selDe(state.filtroStatus, 'todos');   // V903: multi
      if (ss.length) {
        out = out.filter(l => {
          if (l._ehPacoteDetalhe) {
            return ss.includes('casou') || ss.includes('pacoteDetalhe');
          }
          return ss.includes(l._status);
        });
      }
    }
    return out;
  }

  function calcularVisaoFiltros(res) {
    const { linhas } = res;

    // V131.10: filtragem em DUAS etapas para que os KPIs reflitam o escopo (busca/fonte)
    // mas não o filtro de status (assim você vê "quanto há de cada status no escopo")
    // V131.49: linhas-filhas de pacote (status 'pacoteDetalhe') NÃO contam em KPI nenhum
    // V901.1: os predicados moveram para aplicarFiltros() (fonte única com as
    // opções dos combos) — a lógica e a ordem são as mesmas de sempre.
    const filtradasEscopo = aplicarFiltros(linhas, 'status');

    // V131.49: Aplica filtro de status; linhas-filhas (pacoteDetalhe) seguem a mãe
    // quando o filtro é 'casou' (porque o pacote sempre acompanha um match)
    // V903: multi — vários status marcados somam (união)
    let filtradas = filtradasEscopo;
    const ssVis = selDe(state.filtroStatus, 'todos');
    if (ssVis.length) {
      filtradas = filtradasEscopo.filter(l => {
        if (l._ehPacoteDetalhe) {
          // V131.60: filhas aparecem com filtro 'casou' (acompanham a mãe)
          // ou com filtro 'pacoteDetalhe' (ATLAS — só as filhas)
          return ssVis.includes('casou') || ssVis.includes('pacoteDetalhe');
        }
        return ssVis.includes(l._status);
      });
    }

    // V131.12/14: usa o helper `ehExecutante` declarado no escopo do módulo (acima).
    // V131.61: TODOS os totalizadores respeitam TODOS os filtros.
    //   - kpisF   = de `filtradas` (escopo + STATUS) → cards de VALOR (Produção/Repasse) + rodapé
    //   - kpisEsc = de `filtradasEscopo` (sem status) → cards CLICÁVEIS + dropdown (navegação)
    //   Os cards clicáveis (Glosa/Proc/Linhas) e o dropdown precisam do escopo, senão ao
    //   filtrar um status os outros zeram e a navegação fica impossível.
    const naoFilha = l => !l._ehPacoteDetalhe;
    const ehFilha  = l => !!l._ehPacoteDetalhe;

    function calcKpis(base) {
      const semFilha   = base.filter(naoFilha);
      const exec       = base.filter(l => ehExecutante(l.papel) && naoFilha(l));
      const glosaExec  = exec.filter(l => l._status === 'glosa');
      const procSRExec = exec.filter(l => l._status === 'procSemRegra');
      const casou      = base.filter(l => l._status === 'casou' && naoFilha(l));
      const filhas     = base.filter(ehFilha);
      const porFonte   = (arr, f) => arr.filter(l => normalizar(l.origem) === f);
      const somaRep    = arr => arr.reduce((s, l) => s + (Number(l._repasse) || 0), 0);
      const somaProd   = arr => arr.reduce((s, l) => s + (Number(l.produzido) || 0), 0);
      return {
        total:           semFilha.length,
        totalLinhasCONV: porFonte(semFilha, 'CONVENIO').length,
        totalLinhasPART: porFonte(semFilha, 'PARTICULAR').length,
        totalLinhasSUS:  porFonte(semFilha, 'SUS').length,
        totalProduzido:  somaProd(exec),
        produzidoCONV:   somaProd(porFonte(exec, 'CONVENIO')),
        produzidoPART:   somaProd(porFonte(exec, 'PARTICULAR')),
        produzidoSUS:    somaProd(porFonte(exec, 'SUS')),
        // Repasse Total = mães (casou) + filhas (exames do pacote)
        totalRepasse:    somaRep(casou) + somaRep(filhas),
        repasseCONV:     somaRep(porFonte(casou, 'CONVENIO'))   + somaRep(porFonte(filhas, 'CONVENIO')),
        repassePART:     somaRep(porFonte(casou, 'PARTICULAR')) + somaRep(porFonte(filhas, 'PARTICULAR')),
        repasseSUS:      somaRep(porFonte(casou, 'SUS'))        + somaRep(porFonte(filhas, 'SUS')),
        nGlosa:          glosaExec.length,
        produzidoGlosa:  somaProd(glosaExec),
        nProcSemRegraUnique: new Set(procSRExec.map(l => normalizar(l.procedimento))).size,
        nProcSemRegraLinhas: procSRExec.length,
        nRepassado:      casou.length,
        nDuplicada:      base.filter(l => l._status === 'duplicada' && ehExecutante(l.papel)).length,
        nAtlas:          filhas.length,
      };
    }

    const kpisF   = calcKpis(filtradas);        // respeita TODOS os filtros (valor + rodapé)
    const kpisEsc = calcKpis(filtradasEscopo);  // sem o status (navegação: cards clicáveis + dropdown)

    // V131.10/61: TOTAIS pro rodapé — respeitam TODOS os filtros (incl. status), filhas somam no repasse
    const totProduzido = filtradas.filter(naoFilha).reduce((s, l) => s + (Number(l.produzido) || 0), 0);
    const totRecebido  = filtradas.filter(naoFilha).reduce((s, l) => s + (Number(l.recebido)  || 0), 0);
    // V572: total da coluna "Produzido (Part.)" — soma só o que a coluna mostra
    // como número (linhas particulares em %); o rodapé antes não tinha essa
    // célula e as somas apareciam deslocadas uma coluna à esquerda ao filtrar.
    const totProduzidoPart = filtradas.filter(naoFilha).reduce((s, l) => {
      const p = Utilidades.produzidoView(l);
      return s + (typeof p === 'number' ? p : 0);
    }, 0);
    const totRepasse   = filtradas
      .filter(l => l._status === 'casou' || l._ehPacoteDetalhe)
      .reduce((s, l) => s + (Number(l._repasse) || 0), 0);

    // limita exibição pra performance (avisa se truncou)
    const LIMITE = 500;
    const truncou = filtradas.length > LIMITE;
    const exibidas = truncou ? filtradas.slice(0, LIMITE) : filtradas;

    // V493: devolve tudo que os DOIS caminhos de render precisam pra montar as regiões
    return { filtradas, kpisF, kpisEsc, totProduzido, totRecebido, totProduzidoPart, totRepasse, LIMITE, truncou, exibidas };
  }

  // V493: valores únicos pros combos + papéis — extraído de renderResultado() pra
  // fonte única (render completo + incremental). As chaves casam com data-fil-input.
  function opcoesFiltrosCombos(linhas) {
    // V131.7/V132.9: valores únicos pros datalists — sem corte prévio (o combobox
    // limita a exibição a 200 DEPOIS de filtrar pelo texto digitado).
    // V901.1: os filtros RESPEITAM UM AO OUTRO — cada lista nasce das linhas
    // que sobrevivem aos DEMAIS filtros ativos (o próprio campo fica de fora,
    // senão a lista encolheria pro que já foi digitado nele).
    const uniqSort = (arr) => Array.from(new Set(arr.filter(Boolean).map(String))).sort();
    const base = (exceto) => aplicarFiltros(linhas, exceto);
    return {
      admissao:     uniqSort(base('admissao').map(l => l.admissao)),
      profissional: uniqSort(base('profissional').map(l => l.nome_profissional)),
      procedimento: uniqSort(base('procedimento').map(l => l.procedimento)),
      // V131.52: lista de convênios únicos (nome do convênio, não a fonte pagadora)
      convenio:     uniqSort(base('convenio').map(l => l.convenio)),
      // V901: especialidades únicas — o mesmo valor da coluna Especialidade (V500)
      especialidade: uniqSort(base('especialidade').map(l => espLinha(l))),
      // V131.16: opções dinâmicas de papel — também em cascata (V901.1)
      papeis:       uniqSort(base('papel').map(l => l.papel)),
    };
  }

  // V493: opções do drop de Status — fonte única. Os labels carregam contadores do
  // escopo (ex.: "Glosa (12)"), então o caminho incremental também usa isso pra
  // atualizar o label exibido no botão do drop enquanto o usuário digita.
  function opcoesStatusDrop(kpisEsc) {
    return [
      { v: 'todos',        l: 'Todas' },
      { v: 'casou',        l: `QVIS (${kpisEsc.nRepassado})` },
      { v: 'glosa',        l: `Glosa (${kpisEsc.nGlosa})` },
      { v: 'duplicada',    l: `Duplicidade (${kpisEsc.nDuplicada})` },
      { v: 'procSemRegra', l: `NOVO (${kpisEsc.nProcSemRegraUnique})` },
      { v: 'pacoteDetalhe', l: `Ajustes (${kpisEsc.nAtlas})` },
    ];
  }

  // V493: linhas do <tbody> — fonte única (render completo + incremental)
  function htmlTbodyLinhas(exibidas) {
    if (window.AtlasMemoria) AtlasMemoria.novaLeva('calc');   // V937: memória de cálculo por linha
    return exibidas.map(renderLinha).join('') || `
      <tr><td colspan="13" class="calc-vazio-tabela">Nenhuma linha com este filtro.</td></tr><!-- V500: 12 colunas com a nova Especialidade -->
    `;
  }

  // V493: os 5 cards de KPI (conteúdo do grid estável #calc-kpis) — fonte única.
  // Markup idêntico ao que vivia inline no renderResultado().
  function htmlKpis(res, v) {
    const { kpisF, kpisEsc } = v;
    // V973: subtotais dos cards — nome COMPLETO (Convênio/Particular/SUS) e um
    // por linha, sem cortar com "…" (antes: "conv: … · part: …" numa linha só)
    const subKpi = (itens) => itens.filter(Boolean)
      .map(([rot, val]) => `<span class="calc-kpi-sub-it"><strong>${rot}:</strong> ${val}</span>`).join('');
    return `
        ${Utilidades.cardKPI(
          'Produção Total',
          `R$ ${fmt(kpisF.totalProduzido)}`,
          subKpi([['Convênio', `R$ ${fmt(kpisF.produzidoCONV)}`], ['Particular', `R$ ${fmt(kpisF.produzidoPART)}`], kpisF.produzidoSUS > 0 ? ['SUS', `R$ ${fmt(kpisF.produzidoSUS)}`] : null]),
          '', '', 'title="Soma do Produzido — apenas linhas de executante (cirurgião/médico)"'
        )}
        ${Utilidades.cardKPI(
          'Repasse Total',
          `R$ ${fmt(kpisF.totalRepasse)}`,
          subKpi([['Convênio', `R$ ${fmt(kpisF.repasseCONV)}`], ['Particular', `R$ ${fmt(kpisF.repassePART)}`], kpisF.repasseSUS > 0 ? ['SUS', `R$ ${fmt(kpisF.repasseSUS)}`] : null]),
          '', '', 'title="Soma do Repasse calculado (linhas que casaram com regra)"'
        )}
        ${Utilidades.cardKPI(
          'Glosa',
          `${fmtInt(kpisEsc.nGlosa)} <small>linha${kpisEsc.nGlosa===1?'':'s'}</small>`,
          `R$ ${fmt(kpisEsc.produzidoGlosa)} produzido`,
          'glosa',
          `calc-kpi-clicavel ${selDe(state.filtroStatus,'todos').includes('glosa')?'aic--ativo':''}`,
          'data-filtro="glosa" title="Linhas (de executante) com Recebido = R$ 0,00 (glosa do convênio)"'
        )}
        ${Utilidades.cardKPI(
          'Proc sem regra',
          `${fmtInt(kpisEsc.nProcSemRegraUnique)} <small>proc.</small>`,
          `${fmtInt(kpisEsc.nProcSemRegraLinhas)} linha${kpisEsc.nProcSemRegraLinhas===1?'':'s'} afetada${kpisEsc.nProcSemRegraLinhas===1?'':'s'}`,
          'alerta',
          `calc-kpi-clicavel ${selDe(state.filtroStatus,'todos').includes('procSemRegra')?'aic--ativo':''}`,
          'data-filtro="procSemRegra" title="Procedimentos NOVOS — não cadastrados na BASE TABELA (contagem única)"'
        )}
        ${Utilidades.cardKPI(
          'Linhas QVIS',
          fmtInt(kpisEsc.total),
          subKpi([['Convênio', fmtInt(kpisEsc.totalLinhasCONV)], ['Particular', fmtInt(kpisEsc.totalLinhasPART)], kpisEsc.totalLinhasSUS > 0 ? ['SUS', fmtInt(kpisEsc.totalLinhasSUS)] : null, res.kpis.nForaEscopo > 0 ? ['Fora do escopo', fmtInt(res.kpis.nForaEscopo)] : null]),
          '',
          'calc-kpi-clicavel',
          `data-filtro="todos" title="${res.kpis.nForaEscopo > 0
            ? `${fmtInt(res.kpis.nTotalBruto)} no QVIS bruto. ${fmtInt(res.kpis.nForaEscopo)} fora do escopo (não-CONSULTA/EXAME/PROCEDIMENTO):\n  ${res.kpis.foraEscopoPorClass.map(([k,n]) => `${k}: ${fmtInt(n)}`).join('\n  ')}`
            : `${fmtInt(res.kpis.nTotalBruto)} linhas no escopo (CONSULTA/EXAME/PROCEDIMENTO)`}"`
        )}
    `;
  }

  // V493: linha de TOTAIS do <tfoot> (rodapé + contador de linhas exibidas) — fonte única
  function htmlTfootTotais(v) {
    const { filtradas, truncou, LIMITE, totProduzido, totRecebido, totProduzidoPart, totRepasse } = v;
    return `
            <tr class="calc-tr-totais">
              <td class="calc-td-total-label" colspan="9"><!-- V500: +1 pela coluna Especialidade · V928: +1 pela V.TAB -->
                <strong>TOTAIS</strong>
                <small>(${filtradas.length} linha${filtradas.length===1?'':'s'} exibida${filtradas.length===1?'':'s'}${truncou ? ` — primeiras ${LIMITE} de ${filtradas.length}` : ''})</small>
              </td>
              <td class="num mono"><strong>R$ ${fmt(totProduzido)}</strong></td>
              <td class="num mono"><strong>R$ ${fmt(totRecebido)}</strong></td>
              <td class="num mono"><strong>${totProduzidoPart > 0 ? 'R$ ' + fmt(totProduzidoPart) : '—'}</strong></td><!-- V572: coluna Produzido (Part.) faltava no rodapé -->
              <td class="num mono calc-td-repasse-total"><strong>R$ ${fmt(totRepasse)}</strong></td>
            </tr>
          `;
  }

  // V493: aviso de truncamento — fonte única; vai dentro do wrap estável
  // #calc-truncado-wrap (sempre presente, pra o incremental poder ligar/desligar).
  function htmlTruncado(v) {
    return v.truncou ? `
        <div class="calc-truncado">
          Exibindo as primeiras <strong>${v.LIMITE}</strong> de <strong>${v.filtradas.length}</strong> linhas filtradas. Use a busca pra refinar.
        </div>
      ` : '';
  }

  function renderResultado(res) {
    // V493: as contas e o markup das regiões dinâmicas agora vêm das funções
    // extraídas acima (fonte única com o renderParcialFiltros). Os ids estáveis
    // (#calc-kpis, #calc-filtros, #calc-tbody, #calc-tfoot, #calc-truncado-wrap)
    // são os pontos de ancoragem do caminho incremental.
    const v = calcularVisaoFiltros(res);
    const kpisEsc = v.kpisEsc;
    const dl = opcoesFiltrosCombos(res.linhas);
    const opcoesPapel = [{ v: 'todos', l: 'Todos' },
                         ...dl.papeis.map(p => ({ v: p, l: p }))];

    return `
      <div class="aic-grid" id="calc-kpis">${htmlKpis(res, v)}</div>

      <div class="calc-filtros-card" id="calc-filtros">
        ${renderFiltroCombo('Admissão', 'calc-busca-adm', 'admissao', 'Nº admissão...', state.buscaAdmissao, dl.admissao)}
        ${renderFiltroCombo('Profissional', 'calc-busca-prof', 'profissional', 'Nome do médico...', state.buscaProfissional, dl.profissional)}
        ${renderFiltroCombo('Procedimento', 'calc-busca-proc', 'procedimento', 'Procedimento...', state.buscaProcedimento, dl.procedimento)}
        ${renderFiltroCombo('Convênio', 'calc-busca-conv', 'convenio', 'Nome do convênio...', state.buscaConvenio, dl.convenio)}
        ${renderFiltroCombo('Especialidade', 'calc-busca-esp', 'especialidade', 'Especialidade...', state.buscaEspecialidade, dl.especialidade)}
        ${renderFiltroDrop('Papel', 'papel', state.filtroPapel, 'todos', opcoesPapel)}
        ${renderFiltroDrop('Status', 'status', state.filtroStatus, 'todos', opcoesStatusDrop(kpisEsc))}
        ${renderFiltroDrop('Fonte Pagadora', 'fonte', state.filtroFonte, 'todas', [
          { v: 'todas',      l: 'Todas' },
          { v: 'CONVENIO',   l: 'Convênio' },
          { v: 'PARTICULAR', l: 'Particular' },
          { v: 'SUS',        l: 'SUS' },
          { v: 'PERFIL',     l: 'Filtros particulares' },
        ])}
      </div>

      <div class="calc-tabela-wrap">
        <table class="calc-tabela">
          <thead>
            <tr>
              <th class="calc-th-status">Status</th>
              <th class="calc-th-cod">Admissão</th>
              <th>Profissional</th>
              <th>Papel</th>
              <th>Procedimento</th>
              <th>Especialidade</th><!-- V500: subespecialidade da Produção (informativa) -->
              <th>Origem</th>
              <th>Convênio</th>
              <th class="calc-th-vtab" title="V928: versão da Base Tabela aplicada nesta linha (vigente na data de admissão)">V.TAB</th>
              <th class="num">Produzido</th>
              <th class="num">Recebido</th>
              <th class="num">Produzido (Part.)</th>
              <th class="num">Repasse</th>
            </tr>
          </thead>
          <tbody id="calc-tbody">${htmlTbodyLinhas(v.exibidas)}</tbody>
          <tfoot id="calc-tfoot">${htmlTfootTotais(v)}</tfoot>
        </table>
      </div>

      <div id="calc-truncado-wrap">${htmlTruncado(v)}</div>
    `;
  }

  // V493: mapeamento chave do combo → campo do state — compartilhado entre bind()
  // e renderParcialFiltros() (antes vivia duplicável dentro do bind()).
  const MAPA_KEY_STATE = {
    admissao: 'buscaAdmissao',
    profissional: 'buscaProfissional',
    procedimento: 'buscaProcedimento',
    convenio: 'buscaConvenio',
    especialidade: 'buscaEspecialidade',   // V901
  };

  // V493: RENDER INCREMENTAL do caminho de digitação nos combos de filtro.
  // Recalcula a visão filtrada com as MESMAS funções do render() completo e
  // atualiza SÓ as regiões dinâmicas: KPIs (#calc-kpis), linhas (#calc-tbody),
  // rodapé de totais (#calc-tfoot), aviso de truncamento (#calc-truncado-wrap),
  // label do drop de Status (carrega contadores) e a lista de sugestões do combo
  // ativo. NÃO toca no input (foco e cursor ficam intactos) nem no resto do DOM.
  // Todos os demais caminhos continuam chamando render() completo.
  function renderParcialFiltros() {
    const res = state.resultado;
    const tbody = document.getElementById('calc-tbody');
    // Sem resultado na tela (ou DOM inesperado): cai no render completo, que sabe lidar
    if (!res || !tbody) { render(); return; }

    const v = calcularVisaoFiltros(res);

    const grid = document.getElementById('calc-kpis');
    if (grid) grid.innerHTML = htmlKpis(res, v);

    tbody.innerHTML = htmlTbodyLinhas(v.exibidas);

    const tfoot = document.getElementById('calc-tfoot');
    if (tfoot) tfoot.innerHTML = htmlTfootTotais(v);

    const trunc = document.getElementById('calc-truncado-wrap');
    if (trunc) trunc.innerHTML = htmlTruncado(v);

    // Label do botão do drop de Status — os contadores mudam com o escopo filtrado
    const stValor = document.querySelector('[data-fil-combo="status"] .calc-fil-valor');
    if (stValor) {
      const ops = opcoesStatusDrop(v.kpisEsc);
      stValor.textContent = rotuloDrop(selDe(state.filtroStatus, 'todos'), ops, 'todos');   // V903
    }

    // Combo ativo: estado visual (classe ativo + botão ×) e sugestões refiltradas.
    // Mesma decisão de markup do renderFiltroCombo, só que cirúrgica no DOM.
    const key = state.dropAberto;
    if (key && MAPA_KEY_STATE[key]) {
      const inp = document.querySelector(`[data-fil-input="${key}"]`);
      const wrap = inp && inp.closest('.calc-fil-input-wrap');
      if (wrap) {
        const valor = state[MAPA_KEY_STATE[key]] || '';
        const temSel = ((state.multiSel && state.multiSel[key]) || []).length > 0;   // V903
        wrap.classList.toggle('calc-fil-ativo', !!valor || temSel);
        wrap.classList.add('calc-fil-combo-aberto');
        const x = wrap.querySelector('.calc-fil-x');
        if ((valor || temSel) && !x) inp.insertAdjacentHTML('afterend', htmlComboX(inp.id));
        else if (!valor && !temSel && x) x.remove();
        // A <ul> é recriada no MESMO lugar do render completo (fim do wrap);
        // o clique nas opções é delegado no #calc-filtros, então segue funcionando.
        const ulVelha = wrap.querySelector('.calc-fil-opcoes');
        if (ulVelha) ulVelha.remove();
        wrap.insertAdjacentHTML('beforeend',
          htmlComboOpcoes(key, valor, opcoesFiltrosCombos(res.linhas)[key]));
      }
    }
  }

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

  function renderLinha(l) {
    const statusCfg = {
      casou:         { ico: '<span class="calc-tag-qvis">QVIS</span>', cls: 'calc-st-ok',    tt: 'Repasse calculado (veio do QVIS)' },
      glosa:         { ico: '<span class="calc-tag-glosa">GLOSA</span>', cls: 'calc-st-glosa', tt: l._motivo || 'Glosa (recebido = 0)' },
      duplicada:     { ico: '<span class="calc-tag-dup">DUPL.</span>',   cls: 'calc-st-dup',   tt: l._motivo || 'Duplicidade histórica' },
      procSemRegra:  { ico: '<span class="calc-tag-novo">NOVO</span>', cls: 'calc-st-warn', tt: l._motivo || 'Procedimento novo — não cadastrado na BASE TABELA' },
      semRegraPapel: { ico: '<span class="calc-tag-srp">S/ REGRA</span>', cls: 'calc-st-warn2', tt: l._motivo || 'Sem regra cadastrada pro papel/fonte' },
      excluidoTipo:  { ico: '🚫', cls: 'calc-st-excl',  tt: l._motivo || 'Excluído por tipo' },
      pacoteDetalhe: { ico: '<span class="calc-tag-pacote">Ajustes</span>', cls: 'calc-st-pacote', tt: l._motivo || 'Detalhe informativo do pacote' },
    };
    const st = statusCfg[l._status] || statusCfg.semRegraPapel;

    let badgeMatch = '';
    if (l._status === 'casou') {
      if (l._regraPerfil) {
        const pt = String(l._perfilTabela || 'CONVENIO').toUpperCase();
        const ehValor = pt === 'VALOR FIXO';                          // V243
        const tb = ehValor ? 'R$ fixo' : (pt === 'PARTICULAR' ? 'PART' : 'CONV');
        const titulo = ehValor ? 'pago por VALOR FIXO do procedimento' : `pago pela tabela ${tb === 'PART' ? 'Particular' : 'Convênio'}`;
        badgeMatch = `<span class="calc-bdg calc-bdg-perfil" title="Perfil Particular &quot;${esc(l._perfilNome || '')}&quot; — ${titulo}">perfil → ${tb}</span>`;
      } else if (l._matchTipo === 'sinonimo') {
        badgeMatch = `<span class="calc-bdg calc-bdg-sin" title="Match via sinônimo cadastrado">sinônimo</span>`;
      } else if (l._matchTipo === 'similar') {
        badgeMatch = `<span class="calc-bdg calc-bdg-sim" title="Match por similaridade (${(l._matchScore*100).toFixed(1)}%) — ${esc(l._procOficial)}">~${(l._matchScore*100).toFixed(0)}%</span>`;
      } else if (l._matchTipo === 'tokens') {
        badgeMatch = `<span class="calc-bdg calc-bdg-tok" title="Match por palavras-chave (score ${(l._matchScore*100).toFixed(1)}%) — ${esc(l._procOficial)}">palavras ${(l._matchScore*100).toFixed(0)}%</span>`;
      }
    }

    const motivo = l._status !== 'casou' ? `<div class="calc-motivo">↳ ${esc(l._motivo)}</div>` : '';

    // V131.19: botão (+) pra cadastrar rapidamente o procedimento novo na BASE TABELA
    // V131.20: usa <span> em vez de <button> pra ficar realmente inline no texto
    const botaoAdd = l._status === 'procSemRegra'
      ? `<span class="calc-add-proc" role="button" tabindex="0"
                  data-add-proc="${esc(l.procedimento)}"
                  onclick="event.stopPropagation();window.__atlasCadastrarProc&&window.__atlasCadastrarProc(this.dataset.addProc)"
                  title="Cadastrar este procedimento na BASE TABELA"> +</span>`
      : '';

    // V131.4: Produzido — mostra valor (do QVIS) e indica se usou fallback de Produção no cálculo
    const cellProduzido = l.produzido > 0
      ? `R$ ${fmt(l.produzido)}`
      : (l._fonteValor === 'producao'
          ? `<span class="calc-via-prod" title="QVIS = 0; valor R$ ${fmt(l._valorBase)} pego da Produção pra esse profissional/papel/admissão">R$ ${fmt(l._valorBase)} <small>via Prod.</small></span>`
          : `<span class="calc-zerado">R$ 0,00</span>`);

    // V131.4: Recebido — destaca em vermelho quando zerado (glosa)
    const recebidoZerado = (Number(l.recebido) || 0) <= 0;
    const cellRecebido = recebidoZerado
      ? `<span class="calc-glosa-tag" title="Convênio glosou (não pagou)">R$ 0,00</span>`
      : `R$ ${fmt(l.recebido)}`;

    return `
      <tr class="${st.cls}${l._execRealProducao ? ' calc-st-exec-real' : ''}">
        <td class="calc-td-status" title="${esc(st.tt)}">${st.ico}</td>
        <td class="calc-td-cod mono" title="Código de admissão">${esc(l.admissao)}${l.data_admissao ? ` <span class="calc-data-adm">${esc(fmtDataAdm(l.data_admissao))}</span>` : ''}</td>
        <td>${esc(CodigoMedico.exibir(l.nome_profissional))}</td>
        <td><span class="calc-papel">${esc(l.papel)}</span></td>
        <td class="calc-td-proc">
          <div class="calc-proc-nome">${esc(Utilidades.procComPerfil(l))}${badgeMatch}${botaoAdd}</div>
          ${l._procOficial && l._procOficial !== l.procedimento ? `<div class="calc-proc-oficial">↳ ${esc(l._procOficial)}</div>` : ''}
          ${motivo}
        </td>
        <td title="Subespecialidade (relatório de Produção)">${esc(espLinha(l))}</td><!-- V500 (memo V901) -->
        <td>${l.origem ? Utilidades.badgeFonte(l.origem) : ''}</td><!-- V947: tag padrão -->
        <td>${esc(Utilidades.convenioComPerfil(l))}</td>
        <td class="mono calc-td-vtab" title="Versão da Base Tabela aplicada (pela data de admissão)">${l._versaoTabela != null && l._versaoTabela !== '' ? 'v' + esc(String(l._versaoTabela)) : '—'}</td><!-- V928 -->
        <td class="num mono">${cellProduzido}</td>
        <td class="num mono">${cellRecebido}</td>
        <td class="num mono">${Utilidades.produzidoViewCell(l)}</td>
        <td class="num mono calc-td-repasse"${window.AtlasMemoria ? AtlasMemoria.ref('calc', l) : ''} title="Passe o mouse: memória de cálculo · clique fixa">${
          (l._status === 'casou' || (l._ehPacoteDetalhe && Number(l._repasse) > 0))
            ? 'R$ ' + fmt(l._repasse)
            : (l._ehPacoteDetalhe ? '<span class="calc-zerado">R$ 0,00</span>' : '—')
        }</td>
      </tr>
    `;
  }

  // V131.19: helpers do mini-modal de cadastro rápido de procedimento na BASE TABELA
  function abrirCadastroProc(nomeQvis) {
    console.log('[calcular] abrirCadastroProc:', nomeQvis);
    try {
      const papeisDB = Banco.query(`SELECT nome FROM papeis ORDER BY id`) || [];
      const fontes = ['CONVENIO', 'PARTICULAR', 'SUS'];
      const form = { nome: String(nomeQvis || '').trim() };
      for (const f of fontes) {
        form[f] = {};
        for (const p of papeisDB) form[f][p.nome] = { v: '', t: 'R$' };
      }
      state.cadastroAberto = true;
      state.cadastroForm = form;
      render();
    } catch (e) {
      console.error('[calcular] erro em abrirCadastroProc:', e);
      Utilidades.toast?.('Erro ao abrir cadastro: ' + (e.message || e), 'error', 5000);
    }
  }
  // V131.20: expõe imediatamente no window pra o onclick inline funcionar sempre
  window.__atlasCadastrarProc = abrirCadastroProc;
  function fecharCadastroProc() {
    state.cadastroAberto = false;
    state.cadastroForm = null;
    render();
  }
  async function salvarCadastroProc() {
    const f = state.cadastroForm;
    if (!f) return;
    const nome = String(f.nome || '').trim();
    if (!nome) {
      Utilidades.toast?.('Informe o nome do procedimento.', 'error', 3000);
      return;
    }
    try {
      const norm = normalizar(nome);

      // 1) Verifica se procedimento já existe (por nome_normalizado OU nome_oficial,
      //    pois nome_oficial é UNIQUE — evita exceção ao reabrir um já existente)
      let procRow = (Banco.query(
        `SELECT id FROM procedimentos WHERE nome_normalizado = ? OR nome_oficial = ? LIMIT 1`,
        [norm, nome]
      ) || [])[0];
      let procId;
      if (procRow) {
        procId = procRow.id;
      } else {
        Banco.executar(
          `INSERT INTO procedimentos (nome_oficial, nome_normalizado, repassavel) VALUES (?, ?, 1)`,
          [nome, norm]
        );
        procRow = (Banco.query(`SELECT id FROM procedimentos WHERE nome_normalizado = ? LIMIT 1`, [norm]) || [])[0];
        procId = procRow && procRow.id;
        if (!procId) throw new Error('Falha ao recuperar id do procedimento inserido.');
        // V215: cadastra a grafia como sinônimo (igual à Base Tabela) — ajuda o
        // procedimento a casar no recálculo e sair da lista de "sem regra".
        // OR IGNORE: grafia é UNIQUE; se já existir noutro proc, não quebra.
        Banco.executar(
          `INSERT OR IGNORE INTO sinonimos_proc
             (procedimento_id, grafia, grafia_normalizada, fonte, aprovado_por)
           VALUES (?, ?, ?, 'MANUAL', 'USUARIO')`,
          [procId, nome, norm]
        );
      }

      // 2) Mapa papel_nome → papel_id
      const papeisDB = Banco.query(`SELECT id, nome FROM papeis`) || [];
      const mapPapelId = new Map(papeisDB.map(p => [p.nome, p.id]));

      // 3) Insere regras (INSERT OR REPLACE — UNIQUE em proc+papel+fonte)
      let nRegras = 0;
      for (const fonte of ['CONVENIO', 'PARTICULAR', 'SUS']) {
        const ff = f[fonte] || {};
        for (const [papelNome, cfg] of Object.entries(ff)) {
          let raw = String(cfg.v || '').trim().replace(/\s/g, '');
          if (!raw) continue;
          // pt-BR: se houver vírgula, ela é o decimal e o ponto é separador de milhar
          if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
          const num = Number(raw);
          if (isNaN(num) || num < 0) continue;  // 0 é valor válido; descarta só negativos
          const papelId = mapPapelId.get(papelNome);
          if (!papelId) continue;
          const valor = cfg.t === 'R$' ? num : null;
          const percentual = cfg.t === '%' ? (num / 100) : null;
          Banco.executar(
            `INSERT OR REPLACE INTO tabela_repasse
             (procedimento_id, papel_id, fonte_pagadora, valor, percentual)
             VALUES (?, ?, ?, ?, ?)`,
            [procId, papelId, fonte, valor, percentual]
          );
          nRegras++;
        }
      }
      await Banco.salvar({ imediato: true });

      if (nRegras === 0) {
        // nada preenchido → mantém o modal aberto pro usuário completar
        Utilidades.toast?.('Nenhum valor preenchido — informe ao menos um valor por papel/fonte.', 'error', 4000);
        return;
      }

      // fecha o modal de cadastro e mostra a tela imediatamente
      state.cadastroAberto = false;
      state.cadastroForm = null;
      render();

      Utilidades.toast?.(
        `✓ "${nome}" cadastrado com ${nRegras} regra${nRegras === 1 ? '' : 's'}.`,
        'success', 3000
      );

      // V215: recálculo DEFERIDO (fora do handler de clique) — não bloqueia a UI e
      // não depende de re-render dentro de função async. A linha sai da lista quando termina.
      if (state.calculou && state.competencia) {
        setTimeout(() => {
          try {
            window.__atlasAuxCache = null;  // reflete a Base recém-editada
            Object.keys(window).filter(k => k.indexOf('__atlasPagos_') === 0).forEach(k => { delete window[k]; });
            state.resultado = calcular();
            salvarSnapshot(state.competencia, state.resultado);
            render();
          } catch (e) {
            console.error('[calcular] recálculo pós-cadastro:', e);
          }
        }, 50);
      }
    } catch (e) {
      console.error('[calcular] salvarCadastroProc:', e);
      Utilidades.toast?.('Erro ao cadastrar: ' + (e.message || e), 'error', 5000);
    }
  }

  // V215: vincula o modal de cadastro por DELEGAÇÃO no document (uma única vez).
  // Imune à ordem/estado do bind() geral — assim o botão Salvar SEMPRE funciona,
  // mesmo após o recálculo automático ter re-renderizado a tela (corrige "só o 1º cadastro funcionava").
  function bindModalCadastroDelegado() {
    if (window.__atlasCadModalBound) return;
    window.__atlasCadModalBound = true;

    document.addEventListener('click', (e) => {
      if (App.telaAtual !== 'calcular') return;   // V492: listener global permanente — só age na tela ativa
      if (!state.cadastroAberto) return;
      const alvo = e.target;
      if (alvo.closest && alvo.closest('#calc-cp-salvar')) { e.preventDefault(); salvarCadastroProc(); return; }
      if (alvo.closest && alvo.closest('#calc-cp-fechar, #calc-cp-cancelar')) { e.preventDefault(); fecharCadastroProc(); return; }
      if (alvo.id === 'calc-cp-overlay') { fecharCadastroProc(); return; }
    });

    const onForm = (e) => {
      if (App.telaAtual !== 'calcular') return;   // V492: listener global permanente — só age na tela ativa
      if (!state.cadastroAberto || !state.cadastroForm) return;
      const t = e.target;
      if (t.id === 'calc-cp-nome') { state.cadastroForm.nome = t.value; return; }
      const fonte = t.dataset && t.dataset.cpFonte;
      if (!fonte) return;
      const papel = t.dataset.cpPapel, campo = t.dataset.cpCampo;
      if (!state.cadastroForm[fonte]) state.cadastroForm[fonte] = {};
      if (!state.cadastroForm[fonte][papel]) state.cadastroForm[fonte][papel] = { v: '', t: 'R$' };
      state.cadastroForm[fonte][papel][campo] = t.value;
    };
    document.addEventListener('input', onForm);
    document.addEventListener('change', onForm);
  }

  function renderModalCadastroProc() {
    if (!state.cadastroAberto || !state.cadastroForm) return '';
    const f = state.cadastroForm;
    const papeisDB = Banco.query(`SELECT nome FROM papeis ORDER BY id`) || [];
    const labelFonte = { CONVENIO: 'Convênio', PARTICULAR: 'Particular', SUS: 'SUS' };

    const renderSecao = (fonte) => {
      const ff = f[fonte] || {};
      return `
        <div class="calc-cp-secao">
          <div class="calc-cp-secao-head">${labelFonte[fonte]}</div>
          <table class="calc-cp-tabela">
            <thead><tr><th>Papel</th><th>Valor</th><th>Tipo</th></tr></thead>
            <tbody>
              ${papeisDB.map(p => {
                const k = p.nome;
                const cfg = ff[k] || { v: '', t: 'R$' };
                return `
                  <tr>
                    <td>${esc(k)}</td>
                    <td><input type="text" class="calc-cp-input"
                               data-cp-fonte="${fonte}" data-cp-papel="${esc(k)}" data-cp-campo="v"
                               placeholder="0,00" value="${esc(cfg.v)}"></td>
                    <td>
                      <select class="calc-cp-tipo"
                              data-cp-fonte="${fonte}" data-cp-papel="${esc(k)}" data-cp-campo="t">
                        <option value="R$" ${cfg.t === 'R$' ? 'selected' : ''}>R$</option>
                        <option value="%"  ${cfg.t === '%'  ? 'selected' : ''}>%</option>
                      </select>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    };

    return `
      <div class="calc-cp-overlay" id="calc-cp-overlay"></div>
      <div class="calc-cp-modal" role="dialog" aria-modal="true">
        <div class="calc-cp-head">
          <h3>➕ Cadastrar procedimento novo na BASE TABELA</h3>
          <button class="calc-cp-fechar" id="calc-cp-fechar" title="Fechar">✕</button>
        </div>
        <div class="calc-cp-body">
          <label class="calc-cp-label" for="calc-cp-nome">Nome do procedimento</label>
          <input type="text" class="calc-cp-nome" id="calc-cp-nome"
                 value="${esc(f.nome || '')}" placeholder="Nome oficial">
          <p class="calc-cp-help">
            Preencha o valor (ou percentual) de cada papel e fonte que se aplica.
            Deixe em branco as combinações sem regra. Pra %, digite o número (ex.: 18 = 18%).
          </p>
          ${renderSecao('CONVENIO')}
          ${renderSecao('PARTICULAR')}
          ${renderSecao('SUS')}
        </div>
        <div class="calc-cp-footer">
          <button class="calc-cp-cancelar" id="calc-cp-cancelar">Cancelar</button>
          <button class="calc-cp-salvar" id="calc-cp-salvar">✓ Salvar e Cadastrar</button>
        </div>
      </div>
    `;
  }

  function renderModalAjustes() {
    const tipos = ['INTERNO', 'HIBRIDO', 'EXTERNO', 'SEM_TIPO'];
    const tipoLabels = { INTERNO: 'Interno', HIBRIDO: 'Híbrido', EXTERNO: 'Externo', SEM_TIPO: 'Sem tipo (não cadastrado)' };
    const chips = tipos.map(t => {
      const on = state.tiposHabilitados.has(t);
      return `
        <label class="calc-aj-tipo ${on ? 'calc-aj-tipo-on' : 'calc-aj-tipo-off'}">
          <input type="checkbox" data-tipo="${t}" ${on ? 'checked' : ''}>
          <strong>${tipoLabels[t]}</strong>
          ${t === 'SEM_TIPO' ? '<small>médicos do QVIS sem cadastro</small>' : ''}
        </label>
      `;
    }).join('');

    // lista de médicos detectados (precisa ter calculado)
    let listaMedicos = '';
    const detectados = (state.resultado && state.resultado.medicosDetectados) || [];
    if (detectados.length === 0) {
      listaMedicos = `<div class="calc-aj-vazio">Clique em <strong>Calcular</strong> primeiro pra detectar os médicos do QVIS desta competência.</div>`;
    } else {
      let lista = detectados;
      if (state.ajustesBusca) {
        const b = state.ajustesBusca.toUpperCase();
        lista = lista.filter(m => m.nome_norm.includes(b));
      }
      listaMedicos = lista.map(m => {
        const override = state.overrides.has(m.nome_norm) ? state.overrides.get(m.nome_norm) : null;
        const tipoHabil = state.tiposHabilitados.has(m.tipo);
        const incluido = override === true || (override === null && tipoHabil);
        return `
          <div class="calc-aj-medico ${incluido ? '' : 'calc-aj-medico-excl'}">
            <div class="calc-aj-medico-info">
              <strong>${esc(CodigoMedico.exibir(m.nome_exibido))}</strong>
              <span class="calc-aj-medico-tipo calc-aj-tipo-${m.tipo.toLowerCase()}">${tipoLabels[m.tipo] || m.tipo}</span>
              <small>${m.count} linha(s) · R$ ${fmt(m.total_produzido)} produzido</small>
            </div>
            <div class="calc-aj-medico-acoes">
              ${override !== null ? `<span class="calc-aj-override-tag">override manual</span>` : ''}
              <label class="calc-aj-toggle">
                <input type="checkbox" data-override="${esc(m.nome_norm)}" ${incluido ? 'checked' : ''}>
                <span>${incluido ? 'incluir' : 'excluir'}</span>
              </label>
              ${override !== null ? `<button class="calc-aj-reset" data-reset="${esc(m.nome_norm)}" title="Voltar pro padrão do tipo">↺</button>` : ''}
            </div>
          </div>
        `;
      }).join('') || '<div class="calc-aj-vazio">Nenhum médico encontrado com este filtro.</div>';
    }

    // V131.43: lista de regras de exceção já cadastradas
    // V657: antes de listar, revincula órfãs (Base reimportada → ids novos)
    const nReparadas = repararExcecoesOrfas();
    if (nReparadas) Utilidades.toast?.(`✓ ${nReparadas} regra${nReparadas === 1 ? '' : 's'} de exceção revinculada${nReparadas === 1 ? '' : 's'} ao procedimento atual da Base. Clique em ▶ Recalcular pra aplicar.`, 'success', 6000);
    const regrasExcecao = listarRegrasExcecao();
    // V131.49: lista de pacotes de convênio cadastrados
    const pacotesAtuais = listarPacotes();
    // V218: regras de perfil + perfis disponíveis na Produção
    const regrasPerfil = listarRegrasPerfil();
    const perfisProducao = listarPerfisProducao();
    // V220: admissões únicas (sem duplicidade) por perfil + total
    const admissoesPorPerfil = contarAdmissoesPorPerfil();
    let totalAdmUnicas = 0; for (const n of admissoesPorPerfil.values()) totalAdmUnicas += n;
    // Datalists pra autocomplete de médico e procedimento
    const medicosAtivos = (() => {
      try { return Banco.query(`SELECT id, nome_oficial FROM medicos WHERE ativo = 1 ORDER BY nome_oficial`) || []; }
      catch (_) { return []; }
    })();
    const procedimentosAtivos = (() => {
      try { return Banco.query(`SELECT id, nome_oficial FROM procedimentos ORDER BY nome_oficial`) || []; }
      catch (_) { return []; }
    })();
    const papeisLista = (() => {
      try { return Banco.query(`SELECT id, nome FROM papeis ORDER BY id`) || []; }
      catch (_) { return []; }
    })();
    const temSimulacao = (() => {
      try { return ((Banco.query(`SELECT COUNT(*) AS n FROM repasse_pagos WHERE competencia = ?`, [COMPETENCIA_TESTE]) || [])[0]?.n || 0) > 0; }
      catch (_) { return false; }
    })();

    return `
      <div class="calc-aj-overlay" id="calc-aj-overlay"></div>
      <div class="calc-aj-modal" role="dialog" aria-modal="true">
        <div class="calc-aj-head">
          <h3>⚙ Ajustes do Calcular Repasse</h3>
          <button class="calc-aj-fechar" id="calc-aj-fechar" title="Fechar">✕</button>
        </div>

        <div class="calc-aj-tabs">
          <button class="calc-aj-tab ${state.ajustesAba==='tipos'?'calc-aj-tab-ativa':''}" data-aba="tipos">Tipos de Vínculo</button>
          <button class="calc-aj-tab ${state.ajustesAba==='overrides'?'calc-aj-tab-ativa':''}" data-aba="overrides">
            Override Manual ${detectados.length > 0 ? `<small>(${detectados.length})</small>` : ''}
          </button>
          <button class="calc-aj-tab ${state.ajustesAba==='excecoes'?'calc-aj-tab-ativa':''}" data-aba="excecoes">
            Exceções ${regrasExcecao.length > 0 ? `<small>(${regrasExcecao.length})</small>` : ''}
          </button>
          <button class="calc-aj-tab ${state.ajustesAba==='pacotes'?'calc-aj-tab-ativa':''}" data-aba="pacotes">
            Pacotes de Consulta ${pacotesAtuais.length > 0 ? `<small>(${pacotesAtuais.length})</small>` : ''}
          </button>
          <button class="calc-aj-tab ${state.ajustesAba==='perfil'?'calc-aj-tab-ativa':''}" data-aba="perfil">
            Perfil Particular ${regrasPerfil.length > 0 ? `<small>(${regrasPerfil.length})</small>` : ''}
          </button>
        </div>

        <div class="calc-aj-body">
          ${state.ajustesAba === 'tipos' ? `
            <p class="calc-aj-help">
              Só os tipos <strong>marcados</strong> recebem repasse. Os demais ficam como <em>"excluído por tipo"</em> e não entram nos totais.
              O override manual (próxima aba) tem prioridade sobre o tipo.
            </p>
            <div class="calc-aj-tipos">${chips}</div>
          ` : state.ajustesAba === 'overrides' ? `
            <p class="calc-aj-help">
              <strong>Apenas os médicos que aparecem no QVIS desta competência</strong> (não todo o cadastro).
              Marque/desmarque pra forçar inclusão ou exclusão de algum específico, independente do tipo.
            </p>
            <input type="text" id="calc-aj-busca" class="calc-aj-busca" placeholder="🔎 Buscar médico..."
                   value="${esc(state.ajustesBusca)}" autocomplete="off">
            <div class="calc-aj-lista">${listaMedicos}</div>
          ` : state.ajustesAba === 'excecoes' ? `
            <p class="calc-aj-help">
              Regras de pagamento <strong>personalizadas</strong> que sobrescrevem a BASE TABELA pra combinações
              específicas (<em>médico + procedimento + papel + fonte</em>). Quando uma exceção existe, ela tem prioridade
              sobre a regra geral. A BASE TABELA não é alterada.
            </p>

            <!-- V656: FORM DE CADASTRO EM 2 ETAPAS (médico → linha da tabela editável) -->
            ${(() => {
              const n = state.excNovo;
              const fontesOpts = [
                { v: 'TODAS',      l: 'Todas',      cls: 'todas' },
                { v: 'CONVENIO',   l: 'Convênio',   cls: 'convenio' },
                { v: 'PARTICULAR', l: 'Particular', cls: 'particular' },
                { v: 'SUS',        l: 'SUS',        cls: 'sus' },
              ];
              const fonteRotulo = (f) => f === 'TODAS' ? 'Todas' : f === 'CONVENIO' ? 'Convênio' : f === 'PARTICULAR' ? 'Particular' : 'SUS';
              const fmtRegraViva = (r) => !r ? '—'
                : (r.valor != null ? `R$ ${fmt(r.valor)}`
                : (r.percentual != null ? `${(r.percentual * 100).toFixed(2).replace('.', ',')}%` : '—'));
              const pronto = !!(n.medicoId && n.fontes.length && n.procs.length);
              // "sobreposição ativa" por papel: só faz sentido com UM procedimento e UMA fonte
              const excAtuais = (pronto && n.procs.length === 1 && n.fontes.length === 1)
                ? excecoesDaCombinacao(n.medicoId, n.procs[0].id, n.fontes[0]) : new Map();
              return `
              <div class="calc-aj-exc-secao">
                <h4 class="calc-aj-exc-titulo">✦ Nova regra de sobreposição</h4>
                ${!n.medicoId ? `
                  <p class="calc-aj-help" style="margin-top:0;">1º passo: informe o <strong>médico</strong> que terá a regra de sobreposição à regra geral.</p>
                  <div class="calc-exc2-etapa1">
                    <div class="calc-aj-ac-wrap">
                      <input id="calc-exc2-med" class="calc-aj-exc-input" placeholder="Digite o nome do médico..." autocomplete="off" value="${esc(n.medicoBusca)}">
                      <div class="calc-aj-ac-list" id="calc-exc2-ac-med"></div>
                    </div>
                    <button id="calc-exc2-med-ok" class="calc-aj-exc-btn calc-aj-exc-btn-salvar">Continuar →</button>
                  </div>
                ` : `
                  <div class="calc-exc2-medbar">
                    <span class="calc-exc2-medbadge">👤 ${esc(CodigoMedico.exibir(n.medicoNome))}</span>
                    <button id="calc-exc2-med-trocar" class="calc-aj-exc-btn calc-aj-exc-btn-ghost">✕ trocar médico</button>
                  </div>
                  <div class="calc-aj-exc-form-l1">
                    <div class="calc-aj-exc-campo">
                      <label class="calc-aj-exc-label">Fontes pagadoras <small>(marque uma ou várias — cria uma regra por fonte)</small></label>
                      <div class="calc-aj-exc-fontes">
                        ${fontesOpts.map(o => `
                          <label class="calc-aj-exc-fcheck calc-aj-exc-fcheck-${o.cls} ${n.fontes.includes(o.v) ? 'calc-aj-exc-fcheck-on' : ''}">
                            <input type="checkbox" data-exc2-fonte="${o.v}" ${n.fontes.includes(o.v) ? 'checked' : ''}>
                            <span>${o.l}</span>
                          </label>`).join('')}
                      </div>
                    </div>
                    <div class="calc-aj-exc-campo calc-exc2-campo-proc">
                      <label class="calc-aj-exc-label">Procedimentos <small>(pode adicionar vários)</small></label>
                      <div class="calc-exc2-procsel">
                        ${n.procs.map(p => `
                          <span class="calc-aj-exc-chip">${esc(p.nome)}
                            <button class="calc-aj-exc-chip-x" data-exc2-proc-rm="${p.id}" title="Remover este procedimento">✕</button>
                          </span>`).join('')}
                        <div class="calc-aj-ac-wrap" style="flex:1;min-width:220px;">
                          <input id="calc-exc2-proc" class="calc-aj-exc-input" placeholder="${n.procs.length ? '+ adicionar outro procedimento...' : 'Busque o procedimento na tabela...'}" autocomplete="off" value="${esc(n.procBusca)}">
                          <div class="calc-aj-ac-list" id="calc-exc2-ac-proc"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  ${!n.fontes.length ? `<div class="calc-aj-vazio">Marque ao menos <strong>uma fonte pagadora</strong> pra continuar (pode marcar várias — sai uma regra por fonte).</div>`
                    : (!n.procs.length ? `<div class="calc-aj-vazio">Busque o <strong>procedimento</strong> pra ver a linha da tabela (você pode adicionar vários).</div>` : '')}
                  ${pronto ? `
                    <div class="calc-aj-exc-campo" style="margin-bottom:10px;">
                      <label class="calc-aj-exc-label">Extração do pagamento <small>(de onde a regra é disparada)</small></label>
                      <div class="calc-aj-exc-fontes">
                        <label class="calc-aj-exc-fcheck ${n.extracao !== 'PRODUCAO' ? 'calc-aj-exc-fcheck-on' : ''}">
                          <input type="radio" name="calc-exc2-ext" data-exc2-ext="QVIS" ${n.extracao !== 'PRODUCAO' ? 'checked' : ''}>
                          <span>QVIS (padrão)</span>
                        </label>
                        <label class="calc-aj-exc-fcheck ${n.extracao === 'PRODUCAO' ? 'calc-aj-exc-fcheck-on' : ''}">
                          <input type="radio" name="calc-exc2-ext" data-exc2-ext="PRODUCAO" ${n.extracao === 'PRODUCAO' ? 'checked' : ''}>
                          <span>PRODUÇÃO (1× por admissão · entra como Desempenho)</span>
                        </label>
                      </div>
                      ${n.extracao === 'PRODUCAO' ? `<small style="display:block;margin-top:4px;color:var(--ink-faint);">O valor é pago <strong>uma vez por admissão</strong> encontrada na PRODUÇÃO e entra no consolidado como <strong>Desempenho · "Exceção · Produção"</strong>. A linha correspondente no QVIS fica zerada (não duplica).</small>` : ''}
                    </div>
                    <!-- V912: VIGÊNCIA — a partir de qual data de admissão a regra vale -->
                    <div class="calc-aj-exc-campo" style="margin-bottom:10px;">
                      <label class="calc-aj-exc-label">Vale para admissões a partir de <small>(opcional — vazio = todas as admissões)</small></label>
                      <div style="display:flex; align-items:center; gap:10px;">
                        <input type="date" id="calc-exc2-vigencia" value="${esc(n.vigencia || '')}"
                               style="padding:7px 10px; border:1px solid var(--border); border-radius:8px; font:inherit;">
                        ${n.vigencia ? `<button type="button" class="calc-aj-exc-btn" id="calc-exc2-vigencia-x" title="Limpar — a regra volta a valer para todas as admissões">× sem data</button>` : ''}
                        <small style="color:var(--ink-faint);">Admissões com data <strong>anterior</strong> seguem a regra antiga (Base Tabela); a partir desta data vale a sobreposição.</small>
                      </div>
                    </div>
                    <!-- V919: destino dos papéis que NÃO recebem sobreposição -->
                    <div class="calc-aj-exc-campo" style="margin-bottom:10px;">
                      <label class="calc-aj-exc-label">Papéis não preenchidos <small>(o que acontece com os demais papéis desta combinação)</small></label>
                      <div class="calc-aj-exc-fontes">
                        <label class="calc-aj-exc-fcheck ${!n.anularDemais ? 'calc-aj-exc-fcheck-on' : ''}">
                          <input type="radio" name="calc-exc2-anular" data-exc2-anular="0" ${!n.anularDemais ? 'checked' : ''}>
                          <span>Continuam pagando pela Base Tabela (padrão)</span>
                        </label>
                        <label class="calc-aj-exc-fcheck ${n.anularDemais ? 'calc-aj-exc-fcheck-on' : ''}">
                          <input type="radio" name="calc-exc2-anular" data-exc2-anular="1" ${n.anularDemais ? 'checked' : ''}>
                          <span>São ANULADOS — só os papéis preenchidos aqui recebem</span>
                        </label>
                      </div>
                      ${n.anularDemais ? `<small style="display:block;margin-top:4px;color:#8A2F24;">Os papéis sem valor na sobreposição ficam <strong>zerados</strong> nesta combinação (médico + procedimento + fonte) — não caem na Base Tabela. A linha aparece na matriz com o motivo "papel anulado".</small>` : ''}
                    </div>
                    <div class="calc-exc2-linha-wrap">
                      <table class="calc-exc2-linha">
                        <thead><tr><th></th>${papeisLista.map(p => `<th>${esc(p.nome)}</th>`).join('')}</tr></thead>
                        <tbody>
                          ${n.procs.map(pr => n.fontes.map(f => `
                          <tr class="calc-exc2-geral">
                            <td>Tabela geral · ${esc(pr.nome)} <small>(${fonteRotulo(f)})</small></td>
                            ${papeisLista.map(p => `<td>${fmtRegraViva(valorTabelaViva(pr.id, p.id, f))}</td>`).join('')}
                          </tr>`).join('')).join('')}
                          <tr class="calc-exc2-sobre">
                            <td>Sobreposição<br><small>${n.procs.length > 1 || n.fontes.length > 1 ? `aplica a ${n.procs.length} procedimento${n.procs.length === 1 ? '' : 's'} × ${n.fontes.length} fonte${n.fontes.length === 1 ? '' : 's'}` : 'deste médico'}</small></td>
                            ${papeisLista.map(p => {
                              const c = n.campos[p.id] || { valor: '', tipo: 'R$' };
                              const ativa = excAtuais.has(p.id);
                              return `<td class="${ativa ? 'calc-exc2-td-ativa' : ''}">
                                <div class="calc-aj-exc-vtipo">
                                  <input type="text" class="calc-aj-exc-input calc-exc2-val" data-exc2-papel="${p.id}" placeholder="—" autocomplete="off" value="${esc(c.valor)}">
                                  <select class="calc-aj-exc-input calc-aj-exc-tipo" data-exc2-tipo="${p.id}">
                                    <option value="R$" ${c.tipo !== '%' ? 'selected' : ''}>R$</option>
                                    <option value="%"  ${c.tipo === '%' ? 'selected' : ''}>%</option>
                                  </select>
                                </div>
                                ${ativa ? `<small class="calc-exc2-tag-ativa">sobreposição ativa</small>` : ''}
                              </td>`;
                            }).join('')}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p class="calc-aj-help" style="margin:8px 0 10px;">
                      Só os papéis <strong>preenchidos</strong> viram sobreposição — os vazios continuam seguindo a Base Tabela
                      (inclusive atualizações futuras dela). Apagar um campo com <em>sobreposição ativa</em> <strong>remove</strong> aquela
                      sobreposição ao salvar. A <strong>Base Tabela geral nunca é alterada</strong>.
                    </p>
                    <div class="calc-aj-exc-form-l3" style="justify-content:flex-end;">
                      <button id="calc-exc2-salvar" class="calc-aj-exc-btn calc-aj-exc-btn-salvar">✓ Salvar sobreposição</button>
                    </div>
                  ` : ''}
                `}
              </div>`;
            })()}

            <!-- V656: FICHÁRIOS POR MÉDICO (drill-down) -->
            ${(() => {
              const porMed = new Map();
              for (const e of regrasExcecao) {
                if (!porMed.has(e.medico_id)) porMed.set(e.medico_id, { nome: e.medico_nome || '?', regras: [] });
                porMed.get(e.medico_id).regras.push(e);
              }
              const grupos = [...porMed.entries()].sort((a, b) => String(a[1].nome).localeCompare(String(b[1].nome), 'pt-BR'));
              const fonteTagHtml = (fonteN) => {
                const l = fonteN === 'TODAS' ? 'Todas' : (fonteN === 'CONVENIO' ? 'Convênio' : fonteN === 'PARTICULAR' ? 'Particular' : 'SUS');
                const cls = fonteN === 'TODAS' ? 'calc-aj-exc-fonte-todas' : `calc-aj-exc-fonte-${fonteN.toLowerCase()}`;
                return `<span class="calc-aj-exc-fonte-tag ${cls}">${l}</span>`;
              };
              return `
              <div class="calc-aj-exc-secao">
                <h4 class="calc-aj-exc-titulo">🗂 Fichários por médico <small>(${grupos.length})</small></h4>
                ${grupos.length === 0
                  ? `<div class="calc-aj-vazio">Nenhuma regra de sobreposição cadastrada ainda. Use o cadastro acima.</div>`
                  : `<div class="calc-exc2-fichs">
                      ${grupos.map(([medId, g]) => {
                        const aberto = state.excFich.aberto === medId;
                        const procs = new Map();
                        for (const e of g.regras) {
                          if (!procs.has(e.procedimento_id)) procs.set(e.procedimento_id, {
                            nome: e.procedimento_nome || `Procedimento removido da Base (id ${e.procedimento_id})`,
                            orfao: !!e.proc_orfao, regras: [],
                          });
                          procs.get(e.procedimento_id).regras.push(e);
                        }
                        const fontesSet = [...new Set(g.regras.map(e => String(e.fonte_pagadora || 'TODAS').toUpperCase()))];
                        const nBloq = bloqueiosDesempenhoDe(medId).size;   // V658
                        return `
                        <div class="calc-exc2-fich ${aberto ? 'calc-exc2-fich-aberto' : ''}">
                          <div class="calc-exc2-fich-head" data-exc2-fich="${medId}" title="${aberto ? 'Recolher' : 'Ver regras deste médico'}">
                            <div class="calc-exc2-fich-id">
                              <strong>${esc(CodigoMedico.exibir(g.nome))}</strong>
                              <small>${g.regras.length} regra${g.regras.length === 1 ? '' : 's'} · ${procs.size} procedimento${procs.size === 1 ? '' : 's'}${nBloq ? ` · 🚫 ${nBloq} desempenho${nBloq === 1 ? '' : 's'} bloqueado${nBloq === 1 ? '' : 's'}` : ''}</small>
                            </div>
                            <div class="calc-exc2-fich-acoes">
                              ${fontesSet.map(fonteTagHtml).join('')}
                              <button class="calc-aj-exc-btn calc-aj-exc-btn-ghost calc-exc2-btn-mini" data-exc2-nova="${medId}" data-exc2-nome="${esc(g.nome)}" title="Nova regra pra este médico">＋ nova</button>
                              <button class="calc-aj-exc-btn calc-aj-exc-btn-ghost calc-exc2-btn-mini" data-exc2-edit-todas="${medId}" title="V913: carrega TODAS as regras deste médico no cadastro pra editar de uma vez">✎ editar todas</button>
                              <button class="calc-aj-exc-btn calc-aj-exc-btn-ghost calc-exc2-btn-mini calc-exc2-btn-perigo" data-exc2-del-todas="${medId}" data-exc2-nome="${esc(g.nome)}" title="V913: remove TODAS as regras de sobreposição deste médico de uma vez">🗑 excluir todas</button>
                              <span class="calc-exc2-seta">${aberto ? '▴' : '▾'}</span>
                            </div>
                          </div>
                          ${aberto ? `
                          <div class="calc-exc2-fich-body">
                            ${(() => {
                              // V658: bloqueio de desempenho por módulo (anula a participação do médico)
                              const bloq = bloqueiosDesempenhoDe(medId);
                              return `
                              <div class="calc-exc2-bloq">
                                <div class="calc-exc2-bloq-tit">🚫 Bloqueio de desempenho <small>— clique num módulo pra anular a participação deste médico (as linhas dele aparecem zeradas no módulo)</small></div>
                                <div class="calc-exc2-bloq-chips">
                                  ${MODULOS_DESEMPENHO.map(md => `
                                    <button class="calc-exc2-bloq-chip ${bloq.has(md.id) ? 'calc-exc2-bloq-on' : ''}"
                                            data-exc2-bloq="${medId}" data-exc2-mod="${md.id}"
                                            title="${bloq.has(md.id) ? 'Bloqueado — clique pra voltar a participar' : 'Clique pra bloquear este médico no módulo ' + esc(md.nome)}">
                                      ${bloq.has(md.id) ? '🚫 ' : ''}${esc(md.nome)}
                                    </button>`).join('')}
                                </div>
                              </div>`;
                            })()}
                            ${[...procs.values()].map(pg => `
                              <div class="calc-exc2-procgrupo">
                                <div class="calc-exc2-procnome">${esc(pg.nome)}${pg.orfao ? ` <span class="calc-exc2-orfao">⚠ fora da Base atual — a regra só volta a valer se o procedimento for recadastrado com esta grafia</span>` : ''}
                                  <button class="calc-aj-exc-btn calc-aj-exc-btn-ghost calc-exc2-btn-mini calc-exc2-btn-perigo" style="margin-left:8px;" data-exc2-del-proc="${medId}" data-exc2-del-procid="${pg.regras[0].procedimento_id}" data-exc2-procnome="${esc(pg.nome)}" title="V913: remove as ${pg.regras.length} regra(s) deste procedimento de uma vez">🗑 excluir do procedimento</button>
                                </div>
                                <table class="calc-aj-exc-tabela">
                                  <thead><tr><th>Papel</th><th>Fonte</th><th class="calc-aj-exc-th-valor">Sobreposição</th><th></th></tr></thead>
                                  <tbody>
                                    ${pg.regras.map(e => {
                                      const valorTxt = (e.valor != null)
                                        ? `R$ ${fmt(e.valor)}`
                                        : (e.percentual != null ? `${(e.percentual * 100).toFixed(2).replace('.', ',')}%` : '—');
                                      const fonteN = String(e.fonte_pagadora || 'TODAS').toUpperCase();
                                      return `
                                      <tr>
                                        <td><span class="calc-aj-exc-papel-tag">${esc(e.papel_nome || '?')}</span></td>
                                        <td>${fonteTagHtml(fonteN)}</td>
                                        <td class="calc-aj-exc-td-valor"><strong>${valorTxt}</strong>${String(e.extracao || 'QVIS') === 'PRODUCAO' ? ` <span class="calc-exc2-tag-prod" title="Pago 1× por admissão via PRODUÇÃO — entra como Desempenho">via Produção</span>` : ''}${e.vigencia_inicio ? ` <span class="calc-exc2-tag-prod" style="background:#FBF0DA;color:#8A5A1F;" title="V912: vale só para admissões a partir desta data — as anteriores seguem a Base Tabela">≥ ${esc(String(e.vigencia_inicio).split('-').reverse().join('/'))}</span>` : ''}${Number(e.anular_demais) === 1 ? ` <span class="calc-exc2-tag-prod" style="background:#FDECEA;color:#8A2F24;" title="V919: os papéis SEM sobreposição desta combinação ficam ZERADOS — não caem na Base Tabela">🚫 anula os demais papéis</span>` : ''}</td>
                                        <td class="calc-exc2-td-acoes">
                                          <button class="calc-exc2-editar" data-exc2-edit="${e.id}" title="Editar no cadastro (mostra a linha da tabela)">✎</button>
                                          <button class="calc-aj-exc-remove" data-remove-regra="${e.id}" title="Remover">✕</button>
                                        </td>
                                      </tr>`;
                                    }).join('')}
                                  </tbody>
                                </table>
                              </div>`).join('')}
                          </div>` : ''}
                        </div>`;
                      }).join('')}
                    </div>`}
              </div>`;
            })()}

            <!-- ÁREA DE TESTE / SIMULAÇÃO -->
            <div class="calc-aj-exc-secao calc-aj-exc-teste">
              <h4 class="calc-aj-exc-titulo">🧪 Simulação de duplicidade (teste)</h4>
              <p class="calc-aj-help" style="margin:0 0 10px;">
                Injeta <strong>10 duplicidades fake</strong> usando as 10 primeiras linhas que casaram no resultado atual.
                Útil pra ver visualmente como fica a detecção sem precisar ter 2 meses calculados.
                Competência fake: <code>${COMPETENCIA_TESTE}</code>.
              </p>
              ${temSimulacao ? `<div class="calc-aj-teste-aviso">⚠ Simulação ativa no banco. Limpe antes de usar em produção.</div>` : ''}
              <div class="calc-aj-teste-botoes">
                <button id="calc-aj-teste-injetar" class="calc-aj-teste-btn">🧪 Injetar 10 duplicidades</button>
                <button id="calc-aj-teste-limpar" class="calc-aj-teste-btn calc-aj-teste-btn-clear" ${temSimulacao ? '' : 'disabled'}>🧹 Limpar simulação</button>
              </div>
            </div>
          ` : state.ajustesAba === 'pacotes' ? `
            ${renderEspPacoteUI()}
            <div class="calc-aj-exc-secao">
              <h4 class="calc-aj-exc-titulo">✦ Validar a regra no mês (executante real via Produção)</h4>
              <p class="calc-aj-pk-ajuda" style="margin:0 0 10px;font-size:11.5px;color:var(--ink-soft);">
                Mostra, admissão por admissão, como a regra decidiu a linha-filha dos exames inclusos:
                <strong>herdada</strong> pelo executante real (coluna MÉDICO da Produção — aparece em azul na matriz),
                <strong>padrão</strong> (mesma pessoa ou sem mapeamento na Produção) ou <strong>sem filha</strong> (trava de especialidade).
              </p>
              <button id="calc-aj-pk-validar" class="calc-aj-exc-btn calc-aj-exc-btn-salvar">🧪 Validar regra em ${esc(state.competencia || '—')}</button>
              ${state.pacoteValidacao ? `<button id="calc-aj-pk-validar-fechar" class="calc-aj-exc-btn" style="margin-left:8px;">✕ fechar resultado</button>` : ''}
              ${renderValidacaoPacote()}
            </div>
            <p class="calc-aj-help">
              Alguns convênios pagam a <strong>CONSULTA como pacote</strong>, com exames inclusos no valor. Quando uma linha do QVIS tem
              <strong>procedimento com a palavra "CONSULTA"</strong> e o <strong>convênio</strong> está nesta lista, o ATLAS aplica o valor cadastrado abaixo
              (substitui a BASE TABELA) e adiciona uma <strong>linha-filha informativa</strong> abaixo, com o nome que você definir, replicando os dados.
              A linha-filha tem repasse R$ 0,00 (apenas detalhe visual) e não conta em nenhum KPI.
            </p>

            ${(() => {
              // V131.55/59: Diagnóstico — convênios detectados no QVIS atual
              // e indicação de quais batem (exato / alias / prefixo) com algum pacote.
              if (!state.resultado || !state.resultado.linhas) return '';
              const detec = new Map();   // nome original → quantidade de linhas
              for (const l of state.resultado.linhas) {
                if (l._ehPacoteDetalhe) continue;
                if (normalizar(l.origem) !== 'CONVENIO') continue;
                const c = String(l.convenio || '').trim();
                if (!c) continue;
                detec.set(c, (detec.get(c) || 0) + 1);
              }
              if (detec.size === 0) return '';
              const cadastradosKeys = new Set(pacotesAtuais.map(p => p.convenio_nome));
              // mapa de aliases já cadastrados (alias_nome → pacote_label)
              const aliasMap = new Map();
              try {
                const todosAlias = Banco.query(`SELECT a.alias_nome, p.convenio_label FROM pacote_alias a JOIN pacote_convenio p ON p.id = a.pacote_id WHERE p.ativo=1`) || [];
                for (const a of todosAlias) aliasMap.set(a.alias_nome, a.convenio_label);
              } catch (_) {}
              const classificar = (nomeOriginal) => {
                const n = normalizar(nomeOriginal);
                if (cadastradosKeys.has(n)) return { tipo: 'exato' };
                if (aliasMap.has(n)) return { tipo: 'alias', alvo: aliasMap.get(n) };
                for (const k of cadastradosKeys) {
                  if (k && (n === k || n.startsWith(k + ' '))) return { tipo: 'prefixo' };
                }
                return { tipo: 'nenhum' };
              };
              const lista = Array.from(detec.entries()).sort();
              const optsPacotes = pacotesAtuais.map(p => `<option value="${p.id}">→ ${esc(p.convenio_label)}</option>`).join('');
              return `
                <div class="calc-aj-pk-diag">
                  <strong>💡 Convênios detectados no QVIS desta competência (${lista.length}):</strong>
                  <div class="calc-aj-pk-diag-chips">
                    ${lista.map(([nome, qtd]) => {
                      const cl = classificar(nome);
                      if (cl.tipo === 'exato') {
                        return `<span class="calc-aj-pk-diag-ok" title="Bate exato com pacote cadastrado">✓ ${esc(nome)} <small>(${qtd})</small></span>`;
                      }
                      if (cl.tipo === 'alias') {
                        return `<span class="calc-aj-pk-diag-alias" title="Vinculado manualmente a ${esc(cl.alvo)}">🔗 ${esc(nome)} <small>(${qtd}) → ${esc(cl.alvo)}</small></span>`;
                      }
                      if (cl.tipo === 'prefixo') {
                        return `<span class="calc-aj-pk-diag-prefixo" title="Bate por prefixo com pacote cadastrado">✓ ${esc(nome)} <small>(${qtd})</small></span>`;
                      }
                      // Nenhum match → mostra select pra "flagar" (vincular manualmente)
                      return `
                        <span class="calc-aj-pk-diag-no" title="Sem pacote — vincule manualmente no seletor ao lado">
                          ○ ${esc(nome)} <small>(${qtd})</small>
                          ${pacotesAtuais.length > 0 ? `
                            <select class="calc-aj-pk-flag" data-flag-conv="${esc(nome)}" title="Vincular este convênio a um pacote">
                              <option value="">🔗 vincular…</option>
                              ${optsPacotes}
                            </select>
                          ` : ''}
                        </span>`;
                    }).join('')}
                  </div>
                  <small class="calc-aj-pk-help" style="margin-top:6px;">
                    ✓ verde = bate exato · ✓ dourado = bate por prefixo · 🔗 azul = vínculo manual · ○ cinza = sem pacote (use 🔗 vincular pra "flagar")
                  </small>
                </div>
              `;
            })()}

            <!-- FORM DE NOVO CONVÊNIO -->
            <div class="calc-aj-exc-secao">
              <h4 class="calc-aj-exc-titulo">✦ Adicionar convênio com pacote</h4>
              <p class="calc-aj-pk-ajuda" style="margin:0 0 12px;font-size:11.5px;color:var(--ink-soft);">
                <strong>Consulta</strong> = valor que substitui a BASE TABELA na linha-mãe (CONSULTA).<br>
                <strong>Exames inclusos</strong> = valor extra que aparece na linha-filha logo abaixo.<br>
                <em>Repasse total do pacote = consulta + exames inclusos.</em>
              </p>
              <div class="calc-aj-pk-form">
                <div class="calc-aj-exc-campo">
                  <label class="calc-aj-exc-label">Convênio</label>
                  <input type="text" id="calc-aj-pk-label" class="calc-aj-exc-input"
                         placeholder="Ex: PORTO SEGURO" autocomplete="off"
                         value="${esc(state.pacoteForm.label)}">
                </div>
                <div class="calc-aj-exc-campo">
                  <label class="calc-aj-exc-label">Valor consulta <small>(linha-mãe)</small></label>
                  <div class="calc-aj-exc-vtipo">
                    <input type="text" id="calc-aj-pk-valor-consulta" class="calc-aj-exc-input"
                           placeholder="0,00" autocomplete="off"
                           value="${esc(state.pacoteForm.valorConsulta || '')}">
                    <select id="calc-aj-pk-tipo-consulta" class="calc-aj-exc-input calc-aj-exc-tipo">
                      <option value="R$" ${(state.pacoteForm.tipoConsulta || 'R$') === 'R$' ? 'selected' : ''}>R$</option>
                      <option value="%"  ${(state.pacoteForm.tipoConsulta || 'R$') === '%'  ? 'selected' : ''}>%</option>
                    </select>
                  </div>
                </div>
                <div class="calc-aj-exc-campo">
                  <label class="calc-aj-exc-label">Valor exames <small>(linha-filha)</small></label>
                  <div class="calc-aj-exc-vtipo">
                    <input type="text" id="calc-aj-pk-valor" class="calc-aj-exc-input"
                           placeholder="0,00" autocomplete="off"
                           value="${esc(state.pacoteForm.valor)}">
                    <select id="calc-aj-pk-tipo" class="calc-aj-exc-input calc-aj-exc-tipo">
                      <option value="R$" ${state.pacoteForm.tipo === 'R$' ? 'selected' : ''}>R$</option>
                      <option value="%"  ${state.pacoteForm.tipo === '%'  ? 'selected' : ''}>%</option>
                    </select>
                  </div>
                </div>
                <div class="calc-aj-exc-campo calc-aj-pk-campo-nome">
                  <label class="calc-aj-exc-label">Nome da linha-filha</label>
                  <input type="text" id="calc-aj-pk-nome" class="calc-aj-exc-input"
                         placeholder="Ex: Exames inclusos no pacote" autocomplete="off"
                         value="${esc(state.pacoteForm.nomeDetalhe)}">
                </div>
                <button id="calc-aj-pk-salvar" class="calc-aj-exc-btn calc-aj-exc-btn-salvar">✓ Adicionar</button>
              </div>
            </div>

            <!-- LISTA DE PACOTES CADASTRADOS (edição inline) -->
            <div class="calc-aj-exc-secao">
              <h4 class="calc-aj-exc-titulo">Convênios cadastrados <small>(${pacotesAtuais.length})</small></h4>
              ${pacotesAtuais.length === 0
                ? `<div class="calc-aj-vazio">Nenhum convênio cadastrado ainda.</div>`
                : `<div class="calc-aj-pk-wrap">
                    <table class="calc-aj-pk-tabela">
                      <thead>
                        <tr>
                          <th class="calc-aj-pk-th-conv">Convênio</th>
                          <th class="calc-aj-pk-th-val2">Consulta <small>(linha-mãe)</small></th>
                          <th class="calc-aj-pk-th-val2">Exames inclusos <small>(linha-filha)</small></th>
                          <th class="calc-aj-pk-th-nome">Nome da linha-filha</th>
                          <th class="calc-aj-pk-th-procs">Procedimentos</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        ${pacotesAtuais.map(p => {
                          // Mãe (consulta)
                          const tipoConsulta = (p.valor_consulta != null && p.valor_consulta !== '') ? 'R$' : (p.percentual_consulta != null ? '%' : 'R$');
                          const valorConsultaTxt = (tipoConsulta === 'R$')
                            ? (p.valor_consulta != null ? Utilidades.formatarNumero(p.valor_consulta, 2) : '0,00')   // V944: #0.000,00
                            : (p.percentual_consulta != null ? (p.percentual_consulta * 100).toFixed(2).replace('.', ',') : '0,00');
                          // Filha (exames)
                          const tipoAtual = (p.valor != null && p.valor !== '') ? 'R$' : (p.percentual != null ? '%' : 'R$');
                          const valorAtual = (tipoAtual === 'R$')
                            ? (p.valor != null ? Utilidades.formatarNumero(p.valor, 2) : '0,00')   // V944
                            : (p.percentual != null ? (p.percentual * 100).toFixed(2).replace('.', ',') : '0,00');
                          const procsDoPacote = listarProcsDoPacote(p.id);
                          const aliasesDoPacote = listarAliasesDoPacote(p.id);
                          const expandido = state.pacoteExpandidoId === p.id;
                          const totalProcs = procsDoPacote.length;
                          const detec = new Set();
                          if (state.resultado && state.resultado.linhas) {
                            for (const l of state.resultado.linhas) {
                              if (l._regraPacote && !l._ehPacoteDetalhe && l._pacoteConvenio === p.convenio_label) {
                                detec.add((l.procedimento || '').trim());
                              }
                            }
                          }
                          const detectados = Array.from(detec).filter(Boolean).sort();
                          return `
                            <tr data-pk-id="${p.id}" class="${expandido ? 'calc-aj-pk-row-on' : ''}">
                              <td>
                                <strong>${esc(p.convenio_label)}</strong>
                                <small class="calc-aj-pk-chave" title="Chave normalizada usada no match">${esc(p.convenio_nome)}</small>
                                ${aliasesDoPacote.length > 0 ? `
                                  <div class="calc-aj-pk-aliases">
                                    ${aliasesDoPacote.map(a => `
                                      <span class="calc-aj-pk-alias" title="Vínculo manual — convênio do QVIS que aponta pra este pacote">
                                        🔗 ${esc(a.alias_label || a.alias_nome)}
                                        <button class="calc-aj-pk-alias-x" data-alias-remove="${a.id}" title="Remover vínculo">✕</button>
                                      </span>
                                    `).join('')}
                                  </div>
                                ` : ''}
                              </td>
                              <td>
                                <div class="calc-aj-pk-vtipo">
                                  <input type="text" class="calc-aj-pk-i calc-aj-pk-i-valor" data-pk-campo="valorConsulta" value="${esc(valorConsultaTxt)}" autocomplete="off">
                                  <select class="calc-aj-pk-i calc-aj-pk-i-tipo" data-pk-campo="tipoConsulta">
                                    <option value="R$" ${tipoConsulta==='R$'?'selected':''}>R$</option>
                                    <option value="%"  ${tipoConsulta==='%' ?'selected':''}>%</option>
                                  </select>
                                </div>
                              </td>
                              <td>
                                <div class="calc-aj-pk-vtipo">
                                  <input type="text" class="calc-aj-pk-i calc-aj-pk-i-valor" data-pk-campo="valor" value="${esc(valorAtual)}" autocomplete="off">
                                  <select class="calc-aj-pk-i calc-aj-pk-i-tipo" data-pk-campo="tipo">
                                    <option value="R$" ${tipoAtual==='R$'?'selected':''}>R$</option>
                                    <option value="%"  ${tipoAtual==='%' ?'selected':''}>%</option>
                                  </select>
                                </div>
                              </td>
                              <td><input type="text" class="calc-aj-pk-i calc-aj-pk-i-nome" data-pk-campo="nomeDetalhe" value="${esc(p.nome_detalhe || '')}" autocomplete="off"></td>
                              <td class="calc-aj-pk-td-toggle">
                                <button class="calc-aj-pk-toggle ${expandido?'calc-aj-pk-toggle-on':''}" data-pk-toggle="${p.id}" title="${expandido?'Ocultar':'Ver/editar'} procedimentos vinculados">
                                  ${expandido?'▼':'▶'} ${totalProcs > 0 ? `<strong>${totalProcs}</strong>` : `<small>auto</small>`}
                                </button>
                                ${expandido ? `
                                  <div class="calc-aj-pk-pop" data-pk-pop="${p.id}">
                                    <div class="calc-aj-pk-pop-head">
                                      <div class="calc-aj-pk-pop-titulo">
                                        <strong>${esc(p.convenio_label)}</strong>
                                        <small>${totalProcs > 0
                                          ? `· modo manual · ${totalProcs} cadastrado${totalProcs===1?'':'s'}`
                                          : `· modo automático (qualquer "CONSULTA" entra)`}</small>
                                      </div>
                                      <button class="calc-aj-pk-pop-close" data-pk-toggle="${p.id}" title="Fechar">✕</button>
                                    </div>

                                    <div class="calc-aj-pk-pop-body">
                                      <label class="calc-aj-exc-label" style="margin-bottom:4px;">Adicionar procedimento</label>
                                      <div class="calc-aj-ac-wrap">
                                        <input type="text" id="calc-aj-pk-addproc-${p.id}" class="calc-aj-exc-input"
                                               placeholder="Digite e clique no item da lista..."
                                               autocomplete="off" data-pk-addproc-id="${p.id}">
                                        <div class="calc-aj-ac-list" id="calc-aj-pk-addproc-list-${p.id}"></div>
                                      </div>

                                      <label class="calc-aj-exc-label" style="margin-top:14px;">Vinculados</label>
                                      ${totalProcs > 0 ? `
                                        <div class="calc-aj-pk-pop-chips">
                                          ${procsDoPacote.map(pr => `
                                            <span class="calc-aj-exc-chip calc-aj-pk-chip-vinculado" title="Vinculado ao pacote — modo manual">
                                              ${esc(pr.nome_oficial || '?')}
                                              <button class="calc-aj-exc-chip-x" data-pk-proc-remove="${p.id}|${pr.procedimento_id}" title="Desvincular">✕</button>
                                            </span>
                                          `).join('')}
                                        </div>
                                      ` : `<div class="calc-aj-pk-pop-empty">Nenhum vinculado · modo automático ativo</div>`}

                                      ${detectados.length > 0 ? `
                                        <div class="calc-aj-pk-pop-detec">
                                          <small class="calc-aj-pk-detectados-titulo">
                                            ↳ ${totalProcs > 0
                                              ? `Bateram no último cálculo (${detectados.length}):`
                                              : `Detectados no último cálculo (${detectados.length}):`}
                                          </small>
                                          <div class="calc-aj-pk-detectados-list">
                                            ${detectados.map(d => `
                                              <span class="calc-aj-pk-chip-detec">${esc(d)}</span>
                                            `).join('')}
                                          </div>
                                        </div>
                                      ` : (state.resultado ? `<small class="calc-aj-pk-help" style="display:block;margin-top:8px;">Nenhum procedimento bateu nesse pacote no último cálculo.</small>` : '')}
                                    </div>
                                  </div>
                                ` : ''}
                              </td>
                              <td><button class="calc-aj-exc-remove" data-pk-remove="${p.id}" title="Remover convênio">✕</button></td>
                            </tr>
                          `;
                        }).join('')}
                      </tbody>
                    </table>
                  </div>
                  ${state.pacoteExpandidoId ? `<div class="calc-aj-pk-overlay" data-pk-overlay="1"></div>` : ''}
                  <small class="calc-aj-pk-help">↳ Edite os valores ou o nome da linha-filha direto na tabela. Clique no botão ▶ pra abrir a lista de procedimentos vinculados ao convênio.</small>`
              }
            </div>
          ` : `
            <p class="calc-aj-help">
              Perfis particulares (projetos tipo <strong>PROJETO CATARATA, VISÃO SAÚDE, SESC</strong>...) vêm da <strong>Produção</strong>.
              Quando uma admissão tem um perfil cadastrado aqui, <strong>tudo</strong> dela (procedimento, consulta e exame) passa a ser
              pago pela <strong>tabela de CONVÊNIO</strong> da Base Tabela — em vez da Particular.
            </p>

            <div class="calc-pf-resumo">
              <div class="calc-pf-resumo-num">${totalAdmUnicas.toLocaleString('pt-BR')}</div>
              <div class="calc-pf-resumo-txt">
                <strong>admissões únicas</strong> (sem duplicidade) identificadas com perfil particular,
                em <strong>${admissoesPorPerfil.size}</strong> ${admissoesPorPerfil.size === 1 ? 'perfil' : 'perfis'} na Produção.
              </div>
            </div>

            <div class="calc-pf-secao">
              <h4 class="calc-pf-titulo">✦ Cadastrar / atualizar perfil</h4>
              <div class="calc-pf-form">
                <div class="calc-pf-campo calc-pf-campo-perfil">
                  <label class="calc-pf-label">Perfil (da Produção)</label>
                  <select id="calc-pf-perfil" class="calc-pf-input">
                    <option value="">— selecione —</option>
                    ${perfisProducao.map(p => { const n = admissoesPorPerfil.get(p) || 0; return `<option value="${esc(p)}" ${state.perfilForm.perfil === p ? 'selected' : ''}>${esc(p)} — ${n} adm.</option>`; }).join('')}
                  </select>
                </div>
                <div class="calc-pf-campo">
                  <label class="calc-pf-label">Pagar pela tabela</label>
                  <select id="calc-pf-tabela" class="calc-pf-input">
                    <option value="CONVENIO"   ${state.perfilForm.tabela === 'CONVENIO'   ? 'selected' : ''}>Convênio</option>
                    <option value="PARTICULAR" ${state.perfilForm.tabela === 'PARTICULAR' ? 'selected' : ''}>Particular</option>
                  </select>
                </div>
                <button class="calc-pf-salvar" id="calc-pf-salvar">Salvar perfil</button>
              </div>
              <small class="calc-pf-help">Admissões deste perfil passam a ser pagas pela tabela escolhida. Pra exceções por procedimento (ex: um caso que deve usar a outra tabela), use "ajustar tabela" no perfil abaixo.</small>
              ${perfisProducao.length === 0 ? `<small class="calc-pf-help">⚠ Nenhum perfil encontrado — importe a Produção primeiro (a coluna "Perfil Particular").</small>` : ''}
            </div>

            <div class="calc-pf-lista">
              ${regrasPerfil.length === 0 ? `<div class="calc-aj-vazio">Nenhum perfil cadastrado ainda. Os perfis cadastrados aqui passam a pagar pela tabela escolhida (em vez da Particular).</div>` :
                regrasPerfil.map(rg => {
                  const tb = String(rg.tabela || 'CONVENIO').toUpperCase() === 'PARTICULAR' ? 'PARTICULAR' : 'CONVENIO';
                  const tbTxt = tb === 'PARTICULAR' ? '→ paga como PARTICULAR' : '→ paga como CONVÊNIO';
                  const nAdm = admissoesPorPerfil.get(rg.perfil) || 0;
                  const aberto = String(state.perfilExpandidoId) === String(rg.id);
                  const ajustes = aberto ? listarProcsDaRegraPerfil(rg.id) : [];
                  return `
                    <div class="calc-pf-card">
                      <div class="calc-pf-card-head">
                        <div class="calc-pf-card-info">
                          <strong>${esc(rg.perfil)}</strong>
                          <span class="calc-pf-card-val ${tb === 'PARTICULAR' ? 'calc-pf-card-val-conv' : ''}">${tbTxt}</span>
                          <small>${nAdm} admissão(ões) na Produção</small>
                        </div>
                        <div class="calc-pf-card-acoes">
                          <button class="calc-pf-mini" data-pf-toggle="${rg.id}">${aberto ? 'fechar' : 'ajustar tabela'}</button>
                          <button class="calc-pf-mini" data-pf-edit="${esc(rg.perfil)}|${tb}">trocar tabela</button>
                          <button class="calc-pf-del" data-pf-del="${rg.id}" title="Remover perfil">🗑</button>
                        </div>
                      </div>
                      ${aberto ? `
                        <div class="calc-pf-card-body">
                          <small class="calc-pf-help">Ajuste por procedimento <strong>só neste perfil</strong>. Selecione <strong>um ou vários</strong> procedimentos (a mesma cirurgia pode ter nomes diferentes) e aplique um <strong>valor fixo (R$)</strong> ou outra <strong>tabela</strong> — todos recebem o mesmo ajuste.</small>
                          <div class="calc-pf-exc-form">
                            <div class="calc-pf-exc-tipo" data-pf-tipo-wrap="${rg.id}">
                              <button type="button" class="calc-pf-tipo-btn calc-pf-tipo-ativa" data-pf-tipo="valor" data-pf-rg="${rg.id}">Valor fixo (R$)</button>
                              <button type="button" class="calc-pf-tipo-btn" data-pf-tipo="tabela" data-pf-rg="${rg.id}">Tabela</button>
                              <input type="text" inputmode="decimal" class="calc-pf-input calc-pf-exc-valor" data-pf-exc-valor="${rg.id}" placeholder="R$ 0,00">
                              <select class="calc-pf-input calc-pf-exc-tab" data-pf-exc-tab="${rg.id}" style="display:none">
                                <option value="CONVENIO">Convênio</option>
                                <option value="PARTICULAR">Particular</option>
                              </select>
                            </div>
                            <input type="text" class="calc-pf-input calc-pf-exc-filtro" data-pf-exc-filtro="${rg.id}" placeholder="🔍 filtrar procedimentos…">
                            <select multiple size="6" class="calc-pf-input calc-pf-exc-multi" data-pf-exc-multi="${rg.id}">
                              ${procedimentosAtivos.map(p => `<option value="${p.id}" data-nome="${normalizar(p.nome_oficial || '')}">${esc(p.nome_oficial)}</option>`).join('')}
                            </select>
                            <div class="calc-pf-exc-acoes">
                              <small class="calc-pf-help" data-pf-exc-count="${rg.id}">0 selecionado(s)</small>
                              <button class="calc-pf-salvar" data-pf-proc-add="${rg.id}">+ adicionar aos selecionados</button>
                            </div>
                          </div>
                          ${ajustes.length === 0 ? `<small class="calc-pf-help">Nenhuma exceção — todos os procedimentos seguem a tabela do perfil (${tb === 'PARTICULAR' ? 'Particular' : 'Convênio'}).</small>` :
                            `<ul class="calc-pf-proc-list">${ajustes.map(pc => {
                              const ehVal = (pc.valor != null);
                              const tag = ehVal
                                ? `<span class="calc-pf-proc-vtag calc-pf-proc-vtag-valor">R$ ${Utilidades.formatarNumero(Number(pc.valor) || 0, 2)}</span>`
                                : `<span class="calc-pf-proc-vtag">${String(pc.tabela || '').toUpperCase() === 'PARTICULAR' ? 'Particular' : 'Convênio'}</span>`;
                              return `<li><span>${esc(pc.procedimento_nome)}</span>${tag}<button class="calc-pf-proc-x" data-pf-proc-del="${rg.id}|${pc.procedimento_id}" title="Remover exceção">×</button></li>`;
                            }).join('')}</ul>`}
                        </div>` : ''}
                    </div>`;
                }).join('')}
            </div>
          `}
        </div>

        <div class="calc-aj-footer">
          <small>Mudanças aplicam ao clicar em <strong>Recalcular</strong>.</small>
          <button class="calc-aj-aplicar" id="calc-aj-aplicar">✓ Aplicar e Recalcular</button>
        </div>
      </div>
    `;
  }

  function bind() {
    const sel = document.getElementById('calc-competencia');
    if (sel) sel.addEventListener('change', () => {
      state.competencia = sel.value;
      state.pacoteValidacao = null;   // V620: validação vale por mês
      // V131.40: ao mudar competência, tenta carregar snapshot automaticamente
      const snap = carregarSnapshot(state.competencia);
      if (snap) {
        state.resultado = snap;
        state.calculou = true;
        console.log('[calcular] snapshot carregado pra', state.competencia, '— atualizado em', snap._snapshotInfo?.atualizado_em);
      } else {
        state.resultado = null;
        state.calculou = false;
      }
      render();
    });

    // V734: fileira de filtros 20C (célula Competência ↔ select oculto)
    bindBarraFiltrosCalc20C();

    // V131.40: handler do botão apagar snapshot
    const btnApagar = document.getElementById('calc-snap-apagar');
    if (btnApagar) btnApagar.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!state.competencia || state.competencia === 'TODAS') return;
      // V619: mês consolidado é congelado — não se apaga o cálculo dele
      if (window.AtlasConsolidacao && window.AtlasConsolidacao.estaConsolidado && window.AtlasConsolidacao.estaConsolidado(state.competencia)) {
        Utilidades.toast?.(`🔒 ${state.competencia} está CONSOLIDADO — o cálculo salvo é o registro oficial do mês. Reabra a competência na Consolidação se realmente precisar mexer.`, 'error', 7000);
        return;
      }
      if (!confirm(`Apagar o cálculo salvo de ${state.competencia}?\nNão dá pra desfazer — você terá que recalcular.`)) return;
      if (apagarSnapshot(state.competencia)) {
        state.resultado = null;
        state.calculou = false;
        Utilidades.toast?.(`✓ Cálculo de ${state.competencia} apagado.`, 'success', 3000);
        render();
      } else {
        Utilidades.toast?.('Erro ao apagar cálculo.', 'error', 3000);
      }
    });

    const btn = document.getElementById('calc-btn-calcular');
    if (btn) btn.addEventListener('click', () => {
      // V619: mês consolidado é congelado — recálculo travado (não sobrescreve
      // o registro oficial do que foi repassado). Reabrir na Consolidação libera.
      if (window.AtlasConsolidacao && window.AtlasConsolidacao.estaConsolidado && window.AtlasConsolidacao.estaConsolidado(state.competencia)) {
        Utilidades.toast?.(`🔒 ${state.competencia} está CONSOLIDADO — o recálculo está travado pra preservar o que de fato foi repassado no mês. Pra recalcular, reabra a competência no módulo Consolidação.`, 'error', 8000);
        return;
      }
      btn.disabled = true; btn.textContent = '⏳ Calculando...';
      // pequeno setTimeout pra UI atualizar antes do trabalho pesado
      setTimeout(() => {
        try {
          window.__atlasAuxCache = null;   // V200: força recarga do aux (refletir edições na Base)
          // limpa caches de duplicidade (pagos) — serão recriados no cálculo
          Object.keys(window).filter(k => k.indexOf('__atlasPagos_') === 0).forEach(k => { delete window[k]; });
          state.resultado = calcular();
          state.calculou = true;
          // V131.40: salva o snapshot pra não recalcular toda vez
          const salvou = salvarSnapshot(state.competencia, state.resultado);
          render();
          const k = state.resultado.kpis;
          const msg = `✓ ${k.nCasou} casou · ${k.nGlosa} glosa · ${k.nProcSemRegra} sem regra · R$ ${fmt(k.totalRepasse)} (${k.ms}ms)`
                    + (salvou ? ' · 💾 salvo' : '');
          Utilidades.toast?.(msg, 'success', 4000);
          // V223: alerta de ajustes GERENCIAIS a tratar neste mês (recorrentes + pendentes)
          try {
            if (window.AtlasGerenciais && typeof window.AtlasGerenciais.pendentesDoMes === 'function') {
              const pg = window.AtlasGerenciais.pendentesDoMes(state.competencia);
              if (pg && pg.total > 0) {
                Utilidades.toast?.(`⚠ ${pg.total} ajuste(s) gerencial(is) a tratar (${pg.recorrentes.length} recorrentes + ${pg.pontuais.length} pontuais). Abra "Gerenciais" antes de consolidar.`, 'info', 8000);
                state._gerPendentes = pg.total;
              } else { state._gerPendentes = 0; }
            }
          } catch (_) {}
          // V244: alerta de NOVA NOMENCLATURA — proc parecido com um marcado, mas não marcado no perfil
          try {
            const nn = (state.resultado.kpis && state.resultado.kpis.novasNomenclaturas) || [];
            if (nn.length > 0) {
              const amostra = nn.slice(0, 3).map(x => `"${x.procNova}" (parece "${x.pareceCom}")`).join('; ');
              const extra = nn.length > 3 ? ` +${nn.length - 3} mais` : '';
              Utilidades.toast?.(`⚠ ${nn.length} possível(is) nova(s) nomenclatura(s) NÃO marcada(s) no Perfil Particular: ${amostra}${extra}. Revise em Ajustes → Perfil Particular.`, 'info', 12000);
              state._novasNomenclaturas = nn.length;
            } else { state._novasNomenclaturas = 0; }
          } catch (_) {}
        } catch (e) {
          console.error('[calcular]', e);
          Utilidades.toast?.(`Erro ao calcular: ${e.message}`, 'error', 5000);
          render();
        }
      }, 30);
    });

    // V131.9/52: 4 combobox custom (Admissão, Profissional, Procedimento, Convênio)
    // Mapeamento id → chave de state
    // V493: movido pra constante de módulo MAPA_KEY_STATE (compartilhada com o
    // renderParcialFiltros) — fonte única.
    const mapKeyState = MAPA_KEY_STATE;
    const focarRestaurar = (id, pos) => {
      requestAnimationFrame(() => {
        const ne = document.getElementById(id);
        if (ne) { ne.focus(); try { ne.setSelectionRange(pos, pos); } catch (_) {} }
      });
    };
    document.querySelectorAll('[data-fil-input]').forEach(inp => {
      // Focus: abre o dropdown
      inp.addEventListener('focus', () => {
        const k = inp.dataset.filInput;
        if (state.dropAberto !== k) {
          state.dropAberto = k;
          const pos = inp.selectionStart || 0;
          render();
          focarRestaurar(inp.id, pos);
        }
      });
      // Input: atualiza estado e mantém aberto
      // V491: debounce de 250ms — antes CADA tecla reconstruía a tela inteira
      // (CSS + tabela + dropdowns) via render(). O estado atualiza na hora;
      // só o re-render espera a pausa na digitação. Comportamento final idêntico.
      // V493: o debounce agora dispara renderParcialFiltros() (incremental) em vez
      // de render() completo — atualiza só KPIs/tabela/rodapé/sugestões, SEM tocar
      // no input, então o foco/cursor nem chegam a se perder (dispensa focarRestaurar).
      inp.addEventListener('input', () => {
        const k = inp.dataset.filInput;
        const sk = mapKeyState[k];
        if (sk) state[sk] = inp.value;
        state.dropAberto = k;
        clearTimeout(window.__calcBuscaTimer);
        window.__calcBuscaTimer = setTimeout(() => renderParcialFiltros(), 250);
      });
    });
    // Toggle ▾ do combobox
    document.querySelectorAll('[data-fil-toggle-input]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const k = btn.dataset.filToggleInput;
        state.dropAberto = state.dropAberto === k ? null : k;
        render();
      });
    });

    // V131.5: dropdowns de status e fonte pagadora (V131.8: custom)
    document.querySelectorAll('[data-fil-toggle]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const k = btn.dataset.filToggle;
        state.dropAberto = state.dropAberto === k ? null : k;
        render();
      });
    });
    // V493: DELEGAÇÃO no card de filtros (#calc-filtros) — as <li> de sugestão dos
    // combos e o botão × do input são RECRIADOS pelo renderParcialFiltros via
    // innerHTML/insertAdjacentHTML, então os listeners não podem morar nos próprios
    // elementos (morreriam na primeira digitação). Um único listener no container
    // estável cobre render completo E incremental — mesma lógica de antes, mesmo
    // stopPropagation (impede o "fechar ao clicar fora" no document).
    const cardFiltros = document.getElementById('calc-filtros');
    if (cardFiltros) cardFiltros.addEventListener('click', (ev) => {
      // Seleção de opção (cobre TODOS os filtros: combos + drops Papel/Status/Fonte)
      const li = ev.target.closest('[data-fil-opt-key]');
      if (li) {
        ev.stopPropagation();
        const k = li.dataset.filOptKey;
        const v = li.dataset.filOptValor;
        // V903: cada opção é um checkbox — o clique ALTERNA o valor e a lista
        // continua aberta pra marcar mais; 'todos'/'todas' zera a seleção.
        if (k === 'status') state.filtroStatus = toggleSel(state.filtroStatus, 'todos', v);
        else if (k === 'fonte') state.filtroFonte = toggleSel(state.filtroFonte, 'todas', v);
        else if (k === 'papel') state.filtroPapel = toggleSel(state.filtroPapel, 'todos', v);
        else if (mapKeyState[k]) {
          const arr = state.multiSel[k] || (state.multiSel[k] = []);
          const i = arr.indexOf(v);
          if (i >= 0) arr.splice(i, 1); else arr.push(v);
        }
        render();
        return;
      }
      // X interno do input combobox — limpa o texto E os itens marcados (V903)
      const xi = ev.target.closest('[data-fil-x-input]');
      if (xi) {
        ev.stopPropagation();
        const id = xi.dataset.filXInput;
        // V131.54: incluir Convênio no mapeamento (estava faltando)
        const mapId = {
          'calc-busca-adm':  ['buscaAdmissao', 'admissao'],
          'calc-busca-prof': ['buscaProfissional', 'profissional'],
          'calc-busca-proc': ['buscaProcedimento', 'procedimento'],
          'calc-busca-conv': ['buscaConvenio', 'convenio'],
          'calc-busca-esp':  ['buscaEspecialidade', 'especialidade'],   // V901
        };
        const par = mapId[id];
        if (par) { state[par[0]] = ''; state.multiSel[par[1]] = []; }
        state.dropAberto = null;
        render();
      }
    });
    // X interno do dropdown (Status/Fonte/Papel) — só o render completo recria; mantém por elemento
    document.querySelectorAll('[data-fil-x-drop]').forEach(x => {
      x.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const k = x.dataset.filXDrop;
        if (k === 'status') state.filtroStatus = 'todos';
        else if (k === 'fonte') state.filtroFonte = 'todas';
        else if (k === 'papel') state.filtroPapel = 'todos';
        state.dropAberto = null;
        render();
      });
    });
    // Fechar ao clicar fora (V131.9: cobre ambos os tipos de wrapper)
    // V492: remove o handler do render anterior ANTES de registrar outro —
    // antes, cada render com dropdown aberto empilhava um novo listener no
    // document (só era removido no caminho "clicou fora").
    if (window.__calcDocClickHandler) {
      document.removeEventListener('click', window.__calcDocClickHandler);
      window.__calcDocClickHandler = null;
    }
    if (state.dropAberto) {
      const fechar = (ev) => {
        if (!ev.target.closest('.calc-fil-combo') && !ev.target.closest('.calc-fil-input-wrap')) {
          state.dropAberto = null;
          document.removeEventListener('click', fechar);
          if (window.__calcDocClickHandler === fechar) window.__calcDocClickHandler = null;   // V492
          render();
        }
      };
      window.__calcDocClickHandler = fechar;   // V492
      // V492: só adiciona se ainda for o handler corrente (um re-render dentro
      // do mesmo tick já pode tê-lo substituído).
      setTimeout(() => {
        if (window.__calcDocClickHandler === fechar) document.addEventListener('click', fechar);
      }, 0);
    }

    // KPIs clicáveis (mantém — sincroniza com dropdown de status)
    // V493: DELEGADO no grid estável #calc-kpis — os cards são reescritos via
    // innerHTML pelo renderParcialFiltros, então o listener não pode morar no card.
    const gridKpis = document.getElementById('calc-kpis');
    if (gridKpis) gridKpis.addEventListener('click', (ev) => {
      const card = ev.target.closest('.calc-kpi-clicavel[data-filtro]');
      if (!card) return;
      // V903: o card clicável ALTERNA o status dele na seleção múltipla
      // ('todos' segue zerando, como sempre)
      const alvo = card.dataset.filtro;
      state.filtroStatus = alvo === 'todos' ? 'todos'
        : toggleSel(state.filtroStatus, 'todos', alvo);
      render();
    });

    // V131.3: Botão Ajustes
    const btnAj = document.getElementById('calc-btn-ajustes');
    if (btnAj) btnAj.addEventListener('click', () => { state.ajustesAberto = true; render(); });

    // V132.8: inspetor de admissão
    const btnInsp = document.getElementById('calc-btn-inspecionar');
    if (btnInsp) btnInsp.addEventListener('click', () => {
      const adm = prompt('Digite o número da admissão pra inspecionar:');
      if (adm) inspecionarAdmissao(adm);
    });

    // V131.46/47: Botão Exportar matriz (XLSX)
    const btnExp = document.getElementById('calc-btn-exportar');
    if (btnExp) btnExp.addEventListener('click', () => exportarMatrizExcel());

    // Modal de ajustes — fechar
    const fechar = () => { state.ajustesAberto = false; render(); };
    const btnFechar = document.getElementById('calc-aj-fechar');
    if (btnFechar) btnFechar.addEventListener('click', fechar);
    const ov = document.getElementById('calc-aj-overlay');
    if (ov) ov.addEventListener('click', fechar);

    // Modal — abas
    document.querySelectorAll('.calc-aj-tab[data-aba]').forEach(t => {
      t.addEventListener('click', () => { state.ajustesAba = t.dataset.aba; render(); });
    });

    // V221: aba PERFIL PARTICULAR — binds
    (function bindPerfil() {
      const selPerfil = document.getElementById('calc-pf-perfil');
      if (selPerfil) selPerfil.addEventListener('change', () => { state.perfilForm.perfil = selPerfil.value; });
      const selTab = document.getElementById('calc-pf-tabela');
      if (selTab) selTab.addEventListener('change', () => { state.perfilForm.tabela = selTab.value; });

      const btnSalvar = document.getElementById('calc-pf-salvar');
      if (btnSalvar) btnSalvar.addEventListener('click', () => {
        const perfil = state.perfilForm.perfil;
        if (!perfil) { Utilidades.toast?.('Selecione um perfil.', 'error', 3000); return; }
        const id = salvarRegraPerfil(perfil, state.perfilForm.tabela || 'CONVENIO');
        if (id) {
          if (window.__atlasInvalidarAux) window.__atlasInvalidarAux();
          Banco.salvar();
          state.perfilForm = { perfil: '', tabela: state.perfilForm.tabela || 'CONVENIO' };
          Utilidades.toast?.('Perfil salvo.', 'success', 3000);
          render();
        } else {
          Utilidades.toast?.('Erro ao salvar o perfil.', 'error', 4000);
        }
      });

      // trocar tabela → preenche o form com o perfil + tabela atual
      document.querySelectorAll('[data-pf-edit]').forEach(b => b.addEventListener('click', () => {
        const parts = String(b.dataset.pfEdit).split('|');
        const perfil = parts[0];
        const tabela = (parts[1] || 'CONVENIO').toUpperCase() === 'PARTICULAR' ? 'PARTICULAR' : 'CONVENIO';
        state.perfilForm = { perfil, tabela };
        render();
      }));

      document.querySelectorAll('[data-pf-del]').forEach(b => b.addEventListener('click', () => {
        const id = Number(b.dataset.pfDel);
        if (!confirm('Remover este perfil? As admissões dele voltam a ser pagas como Particular (a regra normal).')) return;
        removeRegraPerfil(id);
        if (window.__atlasInvalidarAux) window.__atlasInvalidarAux();
        Banco.salvar();
        Utilidades.toast?.('Perfil removido.', 'success', 3000);
        render();
      }));

      // expandir a área de exceções por procedimento
      document.querySelectorAll('[data-pf-toggle]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.pfToggle;
        state.perfilExpandidoId = (String(state.perfilExpandidoId) === String(id)) ? null : id;
        render();
      }));
      // V243: adicionar exceção (valor fixo OU tabela) a VÁRIOS procedimentos de uma vez
      document.querySelectorAll('[data-pf-proc-add]').forEach(b => b.addEventListener('click', () => {
        const regraId = Number(b.dataset.pfProcAdd);
        const multi = document.querySelector(`[data-pf-exc-multi="${regraId}"]`);
        const procIds = multi ? Array.from(multi.selectedOptions).map(o => Number(o.value)).filter(Boolean) : [];
        if (!procIds.length) { Utilidades.toast?.('Escolha ao menos um procedimento.', 'error', 3000); return; }
        const wrap = document.querySelector(`[data-pf-tipo-wrap="${regraId}"]`);
        const ativa = wrap ? wrap.querySelector('.calc-pf-tipo-ativa') : null;
        const tipo = ativa ? ativa.dataset.pfTipo : 'valor';
        let ok = 0;
        if (tipo === 'valor') {
          const valEl = document.querySelector(`[data-pf-exc-valor="${regraId}"]`);
          const raw = valEl ? String(valEl.value).trim() : '';
          const v = parseValorPF(raw);
          if (raw === '' || !(v >= 0)) { Utilidades.toast?.('Informe o valor fixo (R$).', 'error', 3000); return; }
          procIds.forEach(pid => { if (salvarAjusteProc(regraId, pid, 'valor', v, null)) ok++; });
        } else {
          const tabEl = document.querySelector(`[data-pf-exc-tab="${regraId}"]`);
          const tabela = tabEl ? tabEl.value : 'CONVENIO';
          procIds.forEach(pid => { if (salvarAjusteProc(regraId, pid, 'tabela', null, tabela)) ok++; });
        }
        if (window.__atlasInvalidarAux) window.__atlasInvalidarAux();
        Banco.salvar();
        Utilidades.toast?.(`${ok} exceção(ões) salva(s).`, 'success', 3000);
        render();
      }));
      // V243: alternar tipo (valor fixo / tabela)
      document.querySelectorAll('[data-pf-tipo]').forEach(btn => btn.addEventListener('click', () => {
        const rg = btn.dataset.pfRg;
        const wrap = document.querySelector(`[data-pf-tipo-wrap="${rg}"]`);
        if (wrap) wrap.querySelectorAll('.calc-pf-tipo-btn').forEach(x => x.classList.toggle('calc-pf-tipo-ativa', x === btn));
        const tipo = btn.dataset.pfTipo;
        const valEl = document.querySelector(`[data-pf-exc-valor="${rg}"]`);
        const tabEl = document.querySelector(`[data-pf-exc-tab="${rg}"]`);
        if (valEl) valEl.style.display = (tipo === 'valor') ? '' : 'none';
        if (tabEl) tabEl.style.display = (tipo === 'tabela') ? '' : 'none';
      }));
      // V243: filtro do multi-select de procedimentos
      document.querySelectorAll('[data-pf-exc-filtro]').forEach(inp => inp.addEventListener('input', () => {
        const rg = inp.dataset.pfExcFiltro;
        const multi = document.querySelector(`[data-pf-exc-multi="${rg}"]`);
        if (!multi) return;
        const q = normalizar(inp.value);
        multi.querySelectorAll('option').forEach(o => {
          o.style.display = (!q || String(o.dataset.nome || '').indexOf(q) >= 0) ? '' : 'none';
        });
      }));
      // V243: contador de selecionados
      document.querySelectorAll('[data-pf-exc-multi]').forEach(multi => multi.addEventListener('change', () => {
        const rg = multi.dataset.pfExcMulti;
        const cnt = document.querySelector(`[data-pf-exc-count="${rg}"]`);
        if (cnt) cnt.textContent = `${Array.from(multi.selectedOptions).length} selecionado(s)`;
      }));
      document.querySelectorAll('[data-pf-proc-del]').forEach(b => b.addEventListener('click', () => {
        const parts = String(b.dataset.pfProcDel).split('|').map(Number);
        removeProcRegraPerfil(parts[0], parts[1]);
        if (window.__atlasInvalidarAux) window.__atlasInvalidarAux();
        Banco.salvar();
        render();
      }));
    })();

    // ── V656: NOVO CADASTRO DE SOBREPOSIÇÃO (2 etapas) ──────────────────────
    const n2 = state.excNovo;
    const resetExcNovo = (medId, medNome) => {
      state.excNovo = {
        medicoId: medId || null, medicoNome: medNome || '', medicoBusca: '',
        fontes: [], procs: [], procBusca: '', campos: {}, extracao: 'QVIS', vigencia: '', anularDemais: false,
      };
    };
    // pré-preenche os campos com as sobreposições já existentes da combinação
    // (só com UM procedimento e UMA fonte — com vários, os campos começam vazios)
    function preencherCamposExc2() {
      // V913: com VÁRIAS fontes/procedimentos não há prefill — e o que o usuário
      // já digitou fica preservado (vale para todas as combinações ao salvar).
      if (!(n2.medicoId && n2.fontes.length === 1 && n2.procs && n2.procs.length === 1)) return;
      n2.campos = {};
      n2.extracao = 'QVIS';
      n2.vigencia = '';   // V912
      n2.anularDemais = false;   // V919
      for (const [papelId, e] of excecoesDaCombinacao(n2.medicoId, n2.procs[0].id, n2.fontes[0])) {
        n2.campos[papelId] = (e.valor != null)
          ? { valor: String(e.valor).replace('.', ','), tipo: 'R$' }
          : { valor: String(Math.round((e.percentual || 0) * 10000) / 100).replace('.', ','), tipo: '%' };
        if (String(e.extracao || 'QVIS') === 'PRODUCAO') n2.extracao = 'PRODUCAO';   // V658
        if (e.vigencia_inicio) n2.vigencia = e.vigencia_inicio;   // V912
        if (Number(e.anular_demais) === 1) n2.anularDemais = true;   // V919
      }
    }
    // etapa 1: médico (autocomplete + Continuar)
    const inMed2 = document.getElementById('calc-exc2-med');
    const listMed2 = document.getElementById('calc-exc2-ac-med');
    if (inMed2 && listMed2) {
      inMed2.addEventListener('input', () => { n2.medicoBusca = inMed2.value; });
      let mediAtivos = [];
      try { mediAtivos = Banco.query(`SELECT id, nome_oficial FROM medicos WHERE ativo = 1 ORDER BY nome_oficial`) || []; } catch (_) {}
      setupAutocomplete(inMed2, listMed2, mediAtivos.map(m => ({ value: m.id, label: m.nome_oficial })), (item) => {
        n2.medicoId = item.value; n2.medicoNome = item.label; n2.medicoBusca = '';
        render();
      });
    }
    const btnMedOk2 = document.getElementById('calc-exc2-med-ok');
    if (btnMedOk2) btnMedOk2.addEventListener('click', () => {
      const nome = String((inMed2 && inMed2.value) || '').trim();
      if (!nome) { Utilidades.toast?.('Digite o nome do médico.', 'error', 2500); return; }
      const medNorm = normalizar(nome);
      const row = (Banco.query(`SELECT id, nome_oficial FROM medicos WHERE ativo = 1 AND (nome_normalizado = ? OR UPPER(nome_oficial) = ?) LIMIT 1`, [medNorm, medNorm]) || [])[0];
      if (!row) { Utilidades.toast?.(`Médico "${nome}" não encontrado no cadastro.`, 'error', 4000); return; }
      n2.medicoId = row.id; n2.medicoNome = row.nome_oficial; n2.medicoBusca = '';
      render();
    });
    const btnMedTrocar2 = document.getElementById('calc-exc2-med-trocar');
    if (btnMedTrocar2) btnMedTrocar2.addEventListener('click', () => { resetExcNovo(); render(); });
    // V913: fontes (checkbox — uma OU várias; "Todas" é exclusiva com as específicas)
    document.querySelectorAll('[data-exc2-fonte]').forEach(r => r.addEventListener('change', () => {
      const f = r.dataset.exc2Fonte;
      if (n2.fontes.includes(f)) n2.fontes = n2.fontes.filter(x => x !== f);
      else if (f === 'TODAS') n2.fontes = ['TODAS'];
      else n2.fontes = [...n2.fontes.filter(x => x !== 'TODAS'), f];
      preencherCamposExc2();
      render();
    }));
    // etapa 2: procedimento (autocomplete)
    const inProc2 = document.getElementById('calc-exc2-proc');
    const listProc2 = document.getElementById('calc-exc2-ac-proc');
    if (inProc2 && listProc2) {
      inProc2.addEventListener('input', () => { n2.procBusca = inProc2.value; });
      let procsA = [];
      try { procsA = Banco.query(`SELECT id, nome_oficial FROM procedimentos ORDER BY nome_oficial`) || []; } catch (_) {}
      setupAutocomplete(inProc2, listProc2, procsA.map(p => ({ value: p.id, label: p.nome_oficial })), (item) => {
        // V659: empilha como chip — dá pra adicionar VÁRIOS procedimentos
        if (n2.procs.some(p => p.id === item.value)) {
          Utilidades.toast?.(`"${item.label}" já está na lista.`, 'error', 2200);
          n2.procBusca = ''; render(); return;
        }
        n2.procs.push({ id: item.value, nome: item.label });
        n2.procBusca = '';
        if (n2.procs.length === 1) preencherCamposExc2();   // prefill só com 1 proc
        render();
      });
    }
    // V659: remover um procedimento da lista (chip ✕)
    document.querySelectorAll('[data-exc2-proc-rm]').forEach(b => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = parseInt(b.dataset.exc2ProcRm, 10);
      n2.procs = n2.procs.filter(p => p.id !== id);
      if (!n2.procs.length) n2.campos = {};
      render();
    }));
    // campos por papel (digitação fica no state — sobrevive ao re-render)
    document.querySelectorAll('[data-exc2-papel]').forEach(inp => inp.addEventListener('input', () => {
      const pid = inp.dataset.exc2Papel;
      if (!n2.campos[pid]) n2.campos[pid] = { valor: '', tipo: 'R$' };
      n2.campos[pid].valor = inp.value;
    }));
    document.querySelectorAll('[data-exc2-tipo]').forEach(sel => sel.addEventListener('change', () => {
      const pid = sel.dataset.exc2Tipo;
      if (!n2.campos[pid]) n2.campos[pid] = { valor: '', tipo: 'R$' };
      n2.campos[pid].tipo = sel.value;
    }));
    // V658: extração do pagamento (QVIS × PRODUÇÃO)
    // V912: vigência da regra (a partir de qual data de admissão vale)
    const inVig2 = document.getElementById('calc-exc2-vigencia');
    if (inVig2) inVig2.addEventListener('change', () => { n2.vigencia = inVig2.value || ''; render(); });
    const btnVigX = document.getElementById('calc-exc2-vigencia-x');
    if (btnVigX) btnVigX.addEventListener('click', () => { n2.vigencia = ''; render(); });
    document.querySelectorAll('[data-exc2-ext]').forEach(r => r.addEventListener('change', () => {
      n2.extracao = r.dataset.exc2Ext === 'PRODUCAO' ? 'PRODUCAO' : 'QVIS';
      render();
    }));
    // V919: destino dos papéis não preenchidos (Base Tabela × anulados)
    document.querySelectorAll('[data-exc2-anular]').forEach(r => r.addEventListener('change', () => {
      n2.anularDemais = r.dataset.exc2Anular === '1';
      render();
    }));
    // V658: bloqueio de desempenho (médico × módulo)
    document.querySelectorAll('[data-exc2-bloq]').forEach(b => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const medId = parseInt(b.dataset.exc2Bloq, 10), mod = b.dataset.exc2Mod;
      if (!medId || !mod) return;
      if (toggleBloqueioDesempenho(medId, mod)) {
        const agora = bloqueiosDesempenhoDe(medId).has(mod);
        Utilidades.toast?.(agora
          ? `🚫 Médico bloqueado no desempenho "${mod.toUpperCase()}" — as linhas dele ficam zeradas no módulo.`
          : `✓ Médico volta a participar do desempenho "${mod.toUpperCase()}".`, 'success', 4000);
        render();
      }
    }));
    // salvar: upsert dos papéis preenchidos; campo apagado que TINHA sobreposição → remove
    const btnSalvar2 = document.getElementById('calc-exc2-salvar');
    if (btnSalvar2) btnSalvar2.addEventListener('click', () => {
      if (!(n2.medicoId && n2.fontes.length && n2.procs && n2.procs.length)) { Utilidades.toast?.('Selecione médico, fonte(s) e ao menos um procedimento.', 'error', 3000); return; }
      // V659/V913: remoção-por-campo-vazio só faz sentido com UM procedimento e UMA fonte
      const unico = n2.procs.length === 1 && n2.fontes.length === 1;
      const atuais = unico ? excecoesDaCombinacao(n2.medicoId, n2.procs[0].id, n2.fontes[0]) : new Map();
      const papeis2 = (() => { try { return Banco.query(`SELECT id, nome FROM papeis ORDER BY id`) || []; } catch (_) { return []; } })();
      let nUp = 0, nDel = 0, nErr = 0;
      for (const p of papeis2) {
        const c = n2.campos[p.id];
        const raw = c ? String(c.valor || '').trim() : '';
        if (raw) {
          const num = parseValorPF(raw);
          if (isNaN(num) || num <= 0) { Utilidades.toast?.(`Valor inválido em "${p.nome}".`, 'error', 3000); nErr++; continue; }
          const valor = (c.tipo === '%') ? null : num;
          const percentual = (c.tipo === '%') ? num / 100 : null;
          for (const pr of n2.procs) {
            for (const f of n2.fontes) {   // V913: uma regra por fonte marcada
              if (addRegraExcecao(n2.medicoId, pr.id, p.id, f, valor, percentual, n2.extracao, n2.vigencia, n2.anularDemais)) nUp++; else nErr++;
            }
          }
        } else if (unico) {
          const tinha = atuais.get(p.id);
          if (tinha) { if (removeRegraExcecao(tinha.id)) nDel++; else nErr++; }
        }
      }
      if (nUp + nDel === 0) {
        if (!nErr) Utilidades.toast?.('Preencha ao menos um papel pra criar a sobreposição.', 'error', 3500);
        return;
      }
      const partes = [];
      if (nUp) partes.push(`${nUp} sobreposiç${nUp === 1 ? 'ão salva' : 'ões salvas'}${(n2.procs.length > 1 || n2.fontes.length > 1) ? ` (${n2.procs.length} procedimento${n2.procs.length === 1 ? '' : 's'} × ${n2.fontes.length} fonte${n2.fontes.length === 1 ? '' : 's'})` : ''}`);
      if (nDel) partes.push(`${nDel} removida${nDel === 1 ? '' : 's'}`);
      Utilidades.toast?.(`✓ ${partes.join(' e ')}. Clique em ▶ Recalcular pra aplicar.`, 'success', 4500);
      state.excFich.aberto = n2.medicoId;
      n2.procs = []; n2.campos = {};
      render();
    });
    // fichários: toggle do drill-down / ＋ nova / ✎ editar
    document.querySelectorAll('[data-exc2-fich]').forEach(h => h.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      const id = parseInt(h.dataset.exc2Fich, 10);
      state.excFich.aberto = state.excFich.aberto === id ? null : id;
      render();
    }));
    document.querySelectorAll('[data-exc2-nova]').forEach(b => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      resetExcNovo(parseInt(b.dataset.exc2Nova, 10), b.dataset.exc2Nome || '');
      render();
      document.querySelector('.calc-aj-exc-secao')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    document.querySelectorAll('[data-exc2-edit]').forEach(b => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = parseInt(b.dataset.exc2Edit, 10);
      const nomeProcSql = temHistProcedimentos()
        ? `COALESCE(pr.nome_oficial,
                    (SELECT h.nome_oficial FROM procedimentos_hist h
                      WHERE h.procedimento_id = e.procedimento_id
                      ORDER BY h.versao_id DESC LIMIT 1))`
        : `pr.nome_oficial`;
      const e = (Banco.query(
        `SELECT e.*, m.nome_oficial AS medico_nome, ${nomeProcSql} AS proc_nome
           FROM tabela_repasse_excecao e
           LEFT JOIN medicos m ON m.id = e.medico_id
           LEFT JOIN procedimentos pr ON pr.id = e.procedimento_id
          WHERE e.id = ?`, [id]) || [])[0];
      if (!e) return;
      state.excNovo = {
        medicoId: e.medico_id, medicoNome: e.medico_nome || '', medicoBusca: '',
        fontes: [String(e.fonte_pagadora || 'TODAS').toUpperCase()],
        procs: [{ id: e.procedimento_id, nome: e.proc_nome || '' }], procBusca: '', campos: {}, extracao: 'QVIS', vigencia: '', anularDemais: false,
      };
      const nn = state.excNovo;
      for (const [papelId, ex] of excecoesDaCombinacao(nn.medicoId, nn.procs[0].id, nn.fontes[0])) {
        nn.campos[papelId] = (ex.valor != null)
          ? { valor: String(ex.valor).replace('.', ','), tipo: 'R$' }
          : { valor: String(Math.round((ex.percentual || 0) * 10000) / 100).replace('.', ','), tipo: '%' };
        if (String(ex.extracao || 'QVIS') === 'PRODUCAO') nn.extracao = 'PRODUCAO';   // V658
        if (ex.vigencia_inicio) nn.vigencia = ex.vigencia_inicio;   // V912/V913: prefill da vigência ao editar
        if (Number(ex.anular_demais) === 1) nn.anularDemais = true;   // V919
      }
      render();
      document.querySelector('.calc-aj-exc-secao')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    // V913: ✎ EDITAR TODAS — carrega TODAS as regras do médico no cadastro de uma vez
    // (todos os procedimentos + todas as fontes; valores prefillados quando são
    // uniformes entre as regras — se divergem, o campo fica vazio e o aviso explica).
    document.querySelectorAll('[data-exc2-edit-todas]').forEach(b => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const medId = parseInt(b.dataset.exc2EditTodas, 10);
      const regras = listarRegrasExcecao().filter(e => e.medico_id === medId);
      if (!regras.length) return;
      const procsMap = new Map();
      for (const e of regras) if (!procsMap.has(e.procedimento_id)) {
        procsMap.set(e.procedimento_id, { id: e.procedimento_id, nome: e.procedimento_nome || `(id ${e.procedimento_id})` });
      }
      const fontes = [...new Set(regras.map(e => String(e.fonte_pagadora || 'TODAS').toUpperCase()))];
      const nn = {
        medicoId: medId, medicoNome: regras[0].medico_nome || '', medicoBusca: '',
        fontes: fontes.includes('TODAS') && fontes.length > 1 ? fontes.filter(f => f !== 'TODAS') : fontes,
        procs: [...procsMap.values()], procBusca: '', campos: {}, extracao: 'QVIS', vigencia: '',
        anularDemais: regras.every(e => Number(e.anular_demais) === 1),   // V919
      };
      // prefill por papel só quando o valor é IGUAL em todas as regras daquele papel
      const porPapel = new Map();
      for (const e of regras) {
        if (!porPapel.has(e.papel_id)) porPapel.set(e.papel_id, []);
        porPapel.get(e.papel_id).push(e);
      }
      let divergentes = 0;
      for (const [papelId, lst] of porPapel) {
        const assin = new Set(lst.map(e => `${e.valor}|${e.percentual}`));
        if (assin.size === 1) {
          const e = lst[0];
          nn.campos[papelId] = (e.valor != null)
            ? { valor: String(e.valor).replace('.', ','), tipo: 'R$' }
            : { valor: String(Math.round((e.percentual || 0) * 10000) / 100).replace('.', ','), tipo: '%' };
        } else divergentes++;
      }
      if (regras.every(e => String(e.extracao || 'QVIS').toUpperCase() === 'PRODUCAO')) nn.extracao = 'PRODUCAO';
      const vigs = new Set(regras.map(e => e.vigencia_inicio || ''));
      if (vigs.size === 1) nn.vigencia = [...vigs][0] || '';
      state.excNovo = nn;
      render();
      Utilidades.toast?.(`✎ ${regras.length} regra${regras.length === 1 ? '' : 's'} carregada${regras.length === 1 ? '' : 's'} no cadastro (${nn.procs.length} procedimento${nn.procs.length === 1 ? '' : 's'} × ${nn.fontes.length} fonte${nn.fontes.length === 1 ? '' : 's'}). ${divergentes ? `⚠ ${divergentes} papel${divergentes === 1 ? ' tem' : 'éis têm'} valores diferentes entre as regras — o campo veio vazio; preencha pra unificar ou deixe vazio pra manter como está.` : 'Altere os valores e salve — aplica a todas de uma vez.'}`, divergentes ? 'error' : 'success', 8000);
      document.querySelector('.calc-aj-exc-secao')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    // V913: 🗑 EXCLUIR TODAS as regras do médico de uma vez
    document.querySelectorAll('[data-exc2-del-todas]').forEach(b => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const medId = parseInt(b.dataset.exc2DelTodas, 10);
      if (!medId) return;
      const n = (Banco.query(`SELECT COUNT(*) AS n FROM tabela_repasse_excecao WHERE medico_id = ?`, [medId])[0] || {}).n || 0;
      if (!n) return;
      if (!confirm(`Remover TODAS as ${n} regra${n === 1 ? '' : 's'} de sobreposição de ${b.dataset.exc2Nome || 'este médico'}?\n\nA Base Tabela volta a valer pra tudo. Isso não pode ser desfeito.`)) return;
      try {
        Banco.executar(`DELETE FROM tabela_repasse_excecao WHERE medico_id = ?`, [medId]);
        Banco.salvar();
        Banco._versao = (Banco._versao || 0) + 1;
        Utilidades.toast?.(`✓ ${n} regra${n === 1 ? ' removida' : 's removidas'}. Clique em ▶ Recalcular pra aplicar.`, 'success', 4500);
        render();
      } catch (e) { console.error('[calcular] excluir todas:', e); }
    }));
    // V913: 🗑 EXCLUIR todas as regras de UM procedimento do médico
    document.querySelectorAll('[data-exc2-del-proc]').forEach(b => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const medId = parseInt(b.dataset.exc2DelProc, 10);
      const procId = parseInt(b.dataset.exc2DelProcid, 10);
      if (!medId || !procId) return;
      const n = (Banco.query(`SELECT COUNT(*) AS n FROM tabela_repasse_excecao WHERE medico_id = ? AND procedimento_id = ?`, [medId, procId])[0] || {}).n || 0;
      if (!n) return;
      if (!confirm(`Remover as ${n} regra${n === 1 ? '' : 's'} de "${b.dataset.exc2Procnome || 'este procedimento'}" deste médico?`)) return;
      try {
        Banco.executar(`DELETE FROM tabela_repasse_excecao WHERE medico_id = ? AND procedimento_id = ?`, [medId, procId]);
        Banco.salvar();
        Banco._versao = (Banco._versao || 0) + 1;
        Utilidades.toast?.(`✓ ${n} regra${n === 1 ? ' removida' : 's removidas'}. Clique em ▶ Recalcular pra aplicar.`, 'success', 4500);
        render();
      } catch (e) { console.error('[calcular] excluir do procedimento:', e); }
    }));

    // V131.43/44/45: Modal — Salvar regra(s) — uma por (procedimento × fonte)
    // V131.43: Modal — Remover regra de exceção
    document.querySelectorAll('[data-remove-regra]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = parseInt(btn.dataset.removeRegra, 10);
        if (!id) return;
        if (!confirm('Remover essa regra de exceção?')) return;
        if (removeRegraExcecao(id)) {
          Utilidades.toast?.('✓ Exceção removida.', 'success', 2500);
          render();
        }
      });
    });

    // V252: especialidades (global) que recebem os exames do Pacote de Consulta
    document.querySelectorAll('.calc-aj-pk-esp-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const lab = cb.closest('.calc-aj-pk-esp-chip');
        if (lab) lab.classList.toggle('is-on', cb.checked);
      });
    });
    const btnEspSalvar = document.getElementById('calc-aj-pk-esp-salvar');
    if (btnEspSalvar) btnEspSalvar.addEventListener('click', () => {
      const ids = Array.from(document.querySelectorAll('.calc-aj-pk-esp-cb'))
        .filter(cb => cb.checked).map(cb => parseInt(cb.value, 10)).filter(n => n > 0);
      if (salvarEspecialidadesPacote(ids)) {
        Utilidades.toast?.(ids.length
          ? `✓ ${ids.length} especialidade${ids.length === 1 ? '' : 's'} salva${ids.length === 1 ? '' : 's'}. Recalcule pra aplicar.`
          : '✓ Nenhuma especialidade marcada — os exames não serão pagos a ninguém. Recalcule pra aplicar.', 'success', 4800);
      } else {
        Utilidades.toast?.('Erro ao salvar especialidades.', 'error', 3500);
      }
    });

    // V620: validador da regra do Pacote de Consulta (executante real)
    const btnPkValidar = document.getElementById('calc-aj-pk-validar');
    if (btnPkValidar) btnPkValidar.addEventListener('click', () => {
      state.pacoteValidacao = validarRegraPacote();
      render();
    });
    const btnPkValidarFechar = document.getElementById('calc-aj-pk-validar-fechar');
    if (btnPkValidarFechar) btnPkValidarFechar.addEventListener('click', () => {
      state.pacoteValidacao = null;
      render();
    });

    // V131.49/52: Modal — Pacote de Consulta (form de adicionar novo convênio)
    const inPkLabel = document.getElementById('calc-aj-pk-label');
    const inPkValor = document.getElementById('calc-aj-pk-valor');
    const selPkTipo = document.getElementById('calc-aj-pk-tipo');
    const inPkValorConsulta = document.getElementById('calc-aj-pk-valor-consulta');
    const selPkTipoConsulta = document.getElementById('calc-aj-pk-tipo-consulta');
    const inPkNome  = document.getElementById('calc-aj-pk-nome');
    const btnPkSalvar = document.getElementById('calc-aj-pk-salvar');
    if (inPkLabel) inPkLabel.addEventListener('input', () => { state.pacoteForm.label = inPkLabel.value; });
    if (inPkValor) inPkValor.addEventListener('input', () => { state.pacoteForm.valor = inPkValor.value; });
    if (selPkTipo) selPkTipo.addEventListener('change', () => { state.pacoteForm.tipo = selPkTipo.value; });
    if (inPkValorConsulta) inPkValorConsulta.addEventListener('input', () => { state.pacoteForm.valorConsulta = inPkValorConsulta.value; });
    if (selPkTipoConsulta) selPkTipoConsulta.addEventListener('change', () => { state.pacoteForm.tipoConsulta = selPkTipoConsulta.value; });
    if (inPkNome)  inPkNome.addEventListener('input',  () => { state.pacoteForm.nomeDetalhe = inPkNome.value; });
    if (btnPkSalvar) btnPkSalvar.addEventListener('click', () => {
      const label = String(state.pacoteForm.label || '').trim();
      // Filha (exames) — V491: parseValorPF (BR-correto; "150.75" gravava 15075)
      const numFilha  = parseValorPF(state.pacoteForm.valor);
      const tipoFilha = state.pacoteForm.tipo || 'R$';
      // Mãe (consulta) — V491: idem
      const numConsulta  = parseValorPF(state.pacoteForm.valorConsulta);
      const tipoConsulta = state.pacoteForm.tipoConsulta || 'R$';
      const nomeDet = String(state.pacoteForm.nomeDetalhe || '').trim() || 'Exames inclusos no pacote';

      if (!label) { Utilidades.toast?.('Informe o nome do convênio.', 'error', 3000); return; }
      // Permite zerar (vazio = 0)
      const vConsulta = isNaN(numConsulta) ? null : numConsulta;
      const vFilha    = isNaN(numFilha)    ? null : numFilha;
      const valorConsulta = (tipoConsulta === 'R$') ? vConsulta : null;
      const pctConsulta   = (tipoConsulta === '%' && vConsulta != null) ? (vConsulta / 100) : null;
      const valorFilha    = (tipoFilha === 'R$') ? vFilha : null;
      const pctFilha      = (tipoFilha === '%' && vFilha != null) ? (vFilha / 100) : null;

      if (addPacote(label, valorConsulta, pctConsulta, valorFilha, pctFilha, nomeDet)) {
        Utilidades.toast?.(`✓ Pacote "${label}" cadastrado. Recalcule pra aplicar.`, 'success', 4000);
        state.pacoteForm.label = '';
        state.pacoteForm.valor = '';
        state.pacoteForm.valorConsulta = '';
        state.pacoteForm.nomeDetalhe = 'Exames inclusos no pacote';
        render();
      } else {
        Utilidades.toast?.('Erro ao cadastrar pacote.', 'error', 3500);
      }
    });

    // V131.49/52: Modal — Pacote de Consulta (edição inline + remover)
    function salvarLinhaPk(rowEl) {
      const id = parseInt(rowEl.dataset.pkId, 10);
      if (!id) return false;
      const get = (campo) => rowEl.querySelector(`[data-pk-campo="${campo}"]`);
      const inValor     = get('valor');
      const selTipo     = get('tipo');
      const inValorCons = get('valorConsulta');
      const selTipoCons = get('tipoConsulta');
      const inNome      = get('nomeDetalhe');
      if (!inValor || !selTipo || !inValorCons || !selTipoCons || !inNome) {
        console.warn('[calcular] salvarLinhaPk: campos ausentes', { id });
        return false;
      }
      // V491: parseValorPF (BR-correto; "150.75" gravava 15075)
      const numFilha = parseValorPF(inValor.value);
      const tipoFilha = selTipo.value;
      const numCons = parseValorPF(inValorCons.value);
      const tipoCons = selTipoCons.value;
      const nomeDet = String(inNome.value || '').trim() || 'Exames inclusos no pacote';

      const vC = isNaN(numCons)  ? null : numCons;
      const vF = isNaN(numFilha) ? null : numFilha;
      const valorConsulta = (tipoCons === 'R$') ? vC : null;
      const pctConsulta   = (tipoCons === '%' && vC != null) ? (vC / 100) : null;
      const valorFilha    = (tipoFilha === 'R$') ? vF : null;
      const pctFilha      = (tipoFilha === '%' && vF != null) ? (vF / 100) : null;
      return updatePacote(id, valorConsulta, pctConsulta, valorFilha, pctFilha, nomeDet);
    }
    // V131.54: expõe globalmente pra ser chamada no "Aplicar e Recalcular"
    window.__atlasSavePk = salvarLinhaPk;
    document.querySelectorAll('tr[data-pk-id]').forEach(tr => {
      // V131.56: guard anti-duplicação (blur + change disparam juntos)
      let salvandoPk = false;
      const doSave = () => {
        if (salvandoPk) return;
        // Só processa se o tr ainda está no DOM (evita salvar de elementos órfãos)
        if (!document.body.contains(tr)) return;
        salvandoPk = true;
        const ok = salvarLinhaPk(tr);
        if (ok) {
          const convLabel = (tr.querySelector('td:first-child strong') || {}).textContent || 'Pacote';
          Utilidades.toast?.(`✓ ${convLabel} atualizado — recalcule pra aplicar à matriz`, 'success', 2200);
        }
        // Libera após um tick (NÃO re-renderiza — isso causava loop de foco)
        setTimeout(() => { salvandoPk = false; }, 120);
      };
      tr.querySelectorAll('.calc-aj-pk-i').forEach(field => {
        field.addEventListener('blur', doSave);
        field.addEventListener('change', doSave);
        field.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); field.blur(); }
        });
      });
    });
    document.querySelectorAll('[data-pk-remove]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = parseInt(btn.dataset.pkRemove, 10);
        if (!id) return;
        if (!confirm('Remover este convênio da lista de pacotes?')) return;
        if (removePacote(id)) {
          if (state.pacoteExpandidoId === id) state.pacoteExpandidoId = null;
          Utilidades.toast?.('✓ Convênio removido.', 'success', 2500);
          render();
        }
      });
    });

    // V131.59: "Flagar" — vincular manualmente um convênio do QVIS a um pacote
    document.querySelectorAll('[data-flag-conv]').forEach(sel => {
      sel.addEventListener('change', (ev) => {
        ev.stopPropagation();
        const convLabel = sel.dataset.flagConv;
        const pacoteId = parseInt(sel.value, 10);
        if (!pacoteId || !convLabel) return;
        if (addAliasPacote(pacoteId, convLabel)) {
          Utilidades.toast?.(`✓ "${convLabel}" vinculado ao pacote. Recalcule pra aplicar.`, 'success', 4000);
          render();
        } else {
          Utilidades.toast?.('Erro ao vincular convênio.', 'error', 3000);
        }
      });
    });

    // V131.59: remover vínculo manual (alias)
    document.querySelectorAll('[data-alias-remove]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = parseInt(btn.dataset.aliasRemove, 10);
        if (!id) return;
        if (removeAlias(id)) {
          Utilidades.toast?.('✓ Vínculo removido. Recalcule pra aplicar.', 'success', 3000);
          render();
        }
      });
    });

    // V131.50: Toggle pra expandir/colapsar a sub-linha de procedimentos
    document.querySelectorAll('[data-pk-toggle]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = parseInt(btn.dataset.pkToggle, 10);
        if (!id) return;
        state.pacoteExpandidoId = (state.pacoteExpandidoId === id) ? null : id;
        render();
      });
    });

    // V131.51: Overlay invisível atrás do popover — click fora fecha
    const ovPk = document.querySelector('[data-pk-overlay]');
    if (ovPk) ovPk.addEventListener('click', () => {
      state.pacoteExpandidoId = null;
      render();
    });
    // V131.51: ESC fecha o popover (registrado uma vez por render)
    if (state.pacoteExpandidoId && !window.__atlasPkEscBound) {
      window.__atlasPkEscBound = true;
      document.addEventListener('keydown', function escFechaPk(ev) {
        if (App.telaAtual !== 'calcular') return;   // V492: evita render() fantasma sobrescrever outra tela
        if (ev.key === 'Escape' && state.pacoteExpandidoId) {
          state.pacoteExpandidoId = null;
          render();
        }
      });
    }
    // V131.51: Auto-foca o input de busca quando o popover abre
    if (state.pacoteExpandidoId) {
      setTimeout(() => {
        const inp = document.getElementById(`calc-aj-pk-addproc-${state.pacoteExpandidoId}`);
        if (inp) inp.focus();
      }, 50);
    }

    // V131.50: Autocomplete custom em cada input de "adicionar procedimento ao pacote"
    document.querySelectorAll('[data-pk-addproc-id]').forEach(inp => {
      const pacoteId = parseInt(inp.dataset.pkAddprocId, 10);
      if (!pacoteId) return;
      const listEl = document.getElementById(`calc-aj-pk-addproc-list-${pacoteId}`);
      if (!listEl) return;
      // Carrega procedimentos disponíveis (todos)
      let procs = [];
      try { procs = Banco.query(`SELECT id, nome_oficial FROM procedimentos ORDER BY nome_oficial`) || []; } catch (_) {}
      // Filtra os que JÁ estão vinculados (não mostra repetidos)
      const jaVinculados = new Set();
      try {
        const links = Banco.query(`SELECT procedimento_id FROM pacote_procedimento WHERE pacote_id = ? AND ativo = 1`, [pacoteId]) || [];
        for (const l of links) jaVinculados.add(l.procedimento_id);
      } catch (_) {}
      const items = procs
        .filter(p => !jaVinculados.has(p.id))
        .map(p => ({ value: p.id, label: p.nome_oficial }));

      setupAutocomplete(inp, listEl, items, (item) => {
        if (addProcAoPacote(pacoteId, item.value)) {
          Utilidades.toast?.(`✓ "${item.label}" vinculado ao pacote.`, 'success', 2800);
          inp.value = '';
          render();
        } else {
          Utilidades.toast?.('Erro ao vincular procedimento.', 'error', 3000);
        }
      });
    });

    // V131.50: Remover procedimento vinculado (chip ✕)
    document.querySelectorAll('[data-pk-proc-remove]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const raw = String(btn.dataset.pkProcRemove || '');
        const [pacoteId, procId] = raw.split('|').map(x => parseInt(x, 10));
        if (!pacoteId || !procId) return;
        if (removeProcDoPacote(pacoteId, procId)) {
          Utilidades.toast?.('✓ Procedimento desvinculado.', 'success', 2500);
          render();
        }
      });
    });

    // V131.42: Modal — Botões de teste (simulação de duplicidade)
    const btnInjetar = document.getElementById('calc-aj-teste-injetar');
    if (btnInjetar) btnInjetar.addEventListener('click', () => {
      injetarDuplicidadesTeste(10);
      render();
    });
    const btnLimparTeste = document.getElementById('calc-aj-teste-limpar');
    if (btnLimparTeste) btnLimparTeste.addEventListener('click', () => {
      limparSimulacaoTeste();
      render();
    });

    // Modal — checkboxes de tipo
    document.querySelectorAll('[data-tipo]').forEach(cb => {
      cb.addEventListener('change', () => {
        const t = cb.dataset.tipo;
        if (cb.checked) state.tiposHabilitados.add(t);
        else state.tiposHabilitados.delete(t);
        salvarTiposHabilitados(state.tiposHabilitados);
      });
    });

    // Modal — busca de médicos
    const buscaAj = document.getElementById('calc-aj-busca');
    if (buscaAj) buscaAj.addEventListener('input', () => {
      state.ajustesBusca = buscaAj.value;
      // V491: debounce de 250ms (antes: render completo do modal a cada tecla)
      clearTimeout(window.__calcAjBuscaTimer);
      window.__calcAjBuscaTimer = setTimeout(() => {
        const nbAtual = document.getElementById('calc-aj-busca');
        const pos = nbAtual ? nbAtual.selectionStart : null;
        render();
        const nb = document.getElementById('calc-aj-busca');
        if (nb) { nb.focus(); try { if (pos != null) nb.setSelectionRange(pos, pos); } catch (_) {} }
      }, 250);
    });

    // Modal — toggle de override por médico (V131.4: preserva scroll)
    document.querySelectorAll('[data-override]').forEach(cb => {
      cb.addEventListener('change', () => {
        const nome = cb.dataset.override;
        setOverride(nome, cb.checked);
        const scrollPos = document.querySelector('.calc-aj-body')?.scrollTop || 0;
        render();
        requestAnimationFrame(() => {
          const body = document.querySelector('.calc-aj-body');
          if (body) body.scrollTop = scrollPos;
        });
      });
    });
    // Modal — reset de override (V131.4: preserva scroll)
    document.querySelectorAll('[data-reset]').forEach(btn => {
      btn.addEventListener('click', () => {
        removerOverride(btn.dataset.reset);
        const scrollPos = document.querySelector('.calc-aj-body')?.scrollTop || 0;
        render();
        requestAnimationFrame(() => {
          const body = document.querySelector('.calc-aj-body');
          if (body) body.scrollTop = scrollPos;
        });
      });
    });

    // Modal — botão "Aplicar e Recalcular"
    const btnAplicar = document.getElementById('calc-aj-aplicar');
    if (btnAplicar) btnAplicar.addEventListener('click', () => {
      // V131.54: força blur em qualquer input de pacote ativo antes de fechar.
      // Garante que edições inline pendentes (ex: valor consulta editado mas foco ainda
      // no input) sejam SALVAS no banco antes do calcular() rodar.
      const ativo = document.activeElement;
      if (ativo && ativo.classList && ativo.classList.contains('calc-aj-pk-i')) {
        ativo.blur();
      }
      // Salva qualquer linha de pacote — força save explícito como cinto-e-suspensórios.
      document.querySelectorAll('tr[data-pk-id]').forEach(tr => {
        if (typeof window.__atlasSavePk === 'function') window.__atlasSavePk(tr);
      });
      state.ajustesAberto = false;
      // simula clique no Recalcular
      render();
      const btn = document.getElementById('calc-btn-calcular');
      if (btn && state.calculou) btn.click();
      else render();
    });

    // V131.19/20: Botão (+) — usa event delegation + onclick inline (mais robusto)
    document.querySelectorAll('[data-add-proc]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        const nome = btn.dataset.addProc;
        console.log('[calcular] click botão + → abrir cadastro:', nome);
        abrirCadastroProc(nome);
      });
    });
    // Expõe no window pra fallback de onclick inline (caso o listener falhe)
    window.__atlasCadastrarProc = (nome) => {
      console.log('[calcular] window.__atlasCadastrarProc:', nome);
      abrirCadastroProc(nome);
    };

    // V215: modal de cadastro vinculado por delegação no document (robusto a re-render).
    // Substitui os binds diretos que podiam não ser anexados se um bind anterior falhasse.
    bindModalCadastroDelegado();
  }

  const CSS = `
    .calc-tela { padding: 14px 22px 30px; max-width: 1600px; margin: 0 auto; font-family: inherit; }
    .calc-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 18px; flex-wrap: wrap; }
    .calc-header-titulo h2 { margin: 0 0 4px; font-size: 22px; color: var(--ink); }
    .calc-header-titulo p { margin: 0; font-size: 13px; color: var(--ink-soft); max-width: 720px; line-height: 1.4; }
    .calc-header-acoes { display: flex; align-items: flex-end; gap: 10px; }
    /* V131.62: grupo dos 3 botões de ação — uniformes e centralizados entre si */
    .calc-header-botoes {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    /* Base comum: mesma altura e largura mínima pros 3 botões */
    .calc-btn-acao {
      min-width: 158px;
      height: 44px;
      padding: 0 18px;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      white-space: nowrap;
    }
    .calc-comp-wrap { display: flex; flex-direction: column; gap: 4px; position: relative; }
    /* V734: o select de competência segue FUNCIONAL no DOM (value + change),
       mas invisível — a UI dele agora é a célula da fileira 20C */
    .calc-select-oculto {
      position: absolute; opacity: 0; pointer-events: none;
      width: 1px; height: 1px; margin: 0; padding: 0; border: 0;
    }

    /* ── V734: fileira de filtros 20C (padrão desempenho_lio, prefixo calc-sb) ── */
    .calc-sb-filtros-bar {
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
    .calc-sb {
      position: relative; z-index: 30;
      display: flex; align-items: stretch;
      padding: 6px;
      background: #fff;
      border: 1px solid #eef2f6;
      border-radius: 12px;
      box-shadow: 0 1px 2px rgba(89, 128, 166,.04), 0 10px 26px -20px rgba(89, 128, 166,.26);
      flex-wrap: wrap;
    }
    .calc-sb-celwrap { position: relative; min-width: 150px; display: flex; }
    .calc-sb-celwrap:not(:last-child) .calc-sb-cel { border-right: 1px solid #f7f8fa; }
    .calc-sb-cel {
      flex: 1; min-width: 0;
      display: flex; align-items: center; gap: 9px;
      padding: 9px 12px; border: none; border-radius: 9px;
      background: transparent; cursor: pointer;
      font-family: inherit; text-align: left;
      transition: background-color 120ms;
    }
    .calc-sb-cel:hover, .calc-sb-cel.ativo, .calc-sb-cel.aberta { background: #fafbfc; }
    .calc-sb-cel:focus-visible { outline: 2px solid #3f6489; outline-offset: 2px; }
    .calc-sb-tile {
      width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: #f0f5f9; color: #585d62;
    }
    .calc-sb-cel.ativo .calc-sb-tile, .calc-sb-cel.aberta .calc-sb-tile { background: #eef2f6; color: #46688c; }
    .calc-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
    .calc-sb-rot {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .09em; color: #585d62; white-space: nowrap;
    }
    .calc-sb-val {
      font-size: 13px; font-weight: 500; color: #585d62;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .calc-sb-cel.ativo .calc-sb-val { font-weight: 700; color: #3a5877; }
    .calc-sb-chev { color: #8a9096; flex-shrink: 0; display: flex; transition: transform 140ms; }
    .calc-sb-cel.aberta .calc-sb-chev { transform: rotate(180deg); }
    /* painel ancorado na célula, por cima dos cards */
    .calc-sb-painel {
      position: absolute; top: 100%; left: 0; margin-top: 6px; z-index: 40;
      min-width: 100%; width: max-content; max-width: 340px;
      background: #fff; border: 1px solid #eef0f2; border-radius: 12px;
      box-shadow: 0 18px 44px -14px rgba(29, 31, 32,.42);
      overflow: hidden;
    }
    .calc-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; }
    .calc-sb-lista::-webkit-scrollbar { width: 8px; }
    .calc-sb-lista::-webkit-scrollbar-track { background: #f7f8fa; }
    .calc-sb-lista::-webkit-scrollbar-thumb { background: #e4eaf1; border-radius: 4px; }
    .calc-sb-it {
      display: flex; align-items: center; gap: 10px;
      height: 38px; padding: 0 8px; border-radius: 8px; cursor: pointer;
      font-size: 13px; color: #3a5877;
    }
    .calc-sb-it:hover, .calc-sb-it.foco { background: #f7f8fa; }
    .calc-sb-it.sel { background: #f7f8fa; font-weight: 700; }
    .calc-sb-it-todos { font-weight: 700; }
    .calc-sb-it-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .calc-sb-ck { color: #46688c; display: flex; }
    /* V131.39/41: botão calcular — cinza-escuro #222422 (mesma cor sidebar) + texto off-white */
    .calc-btn-calcular {
      background: linear-gradient(135deg, #3f6489, #46688c);
      color: #FFFFFF;
      border: none;
      letter-spacing: 0.04em;
    }
    .calc-btn-calcular:hover {
      background: linear-gradient(135deg, #34D6A6, #0C8A6C);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(70, 104, 140, 0.35);
    }
    .calc-btn-calcular:active { transform: translateY(0); }
    .calc-btn-calcular:disabled { opacity: 0.6; cursor: wait; transform: none; }

    /* V131.40: badge de snapshot salvo abaixo do select de mês */
    .calc-snap-info {
      display: inline-flex; align-items: center; gap: 6px;
      margin-top: 4px;
      padding: 4px 8px;
      background: rgba(89, 128, 166,0.06);
      border: 1px solid rgba(89, 128, 166,0.20);
      border-radius: 6px;
      font-size: 10.5px;
      color: #244222;
      max-width: 100%;
      box-sizing: border-box;
    }
    .calc-snap-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #4f8a5b;
      box-shadow: 0 0 0 2px rgba(79, 138, 91,0.20);
      flex-shrink: 0;
    }
    .calc-snap-txt {
      font-weight: 600;
      letter-spacing: 0.01em;
      white-space: nowrap;
    }
    .calc-snap-apagar {
      margin-left: 4px;
      padding: 2px 6px;
      background: transparent;
      border: 1px solid rgba(161, 86, 70,0.30);
      border-radius: 4px;
      color: #a15646;
      font-size: 9.5px;
      font-weight: 600;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      transition: background-color 130ms, color 130ms, border-color 130ms, box-shadow 130ms, transform 130ms, opacity 130ms;
    }
    .calc-snap-apagar:hover {
      background: rgba(161, 86, 70,0.10);
      border-color: #a15646;
    }
    .calc-btn-ajustes { background: var(--bg-elevated); color: var(--ink-soft); border: 1px solid var(--border); font-weight: 600; }
    .calc-btn-ajustes:hover { background: var(--bg-sunken); border-color: #3f6489; color: #46688c; }
    /* V132.8: Inspetor de admissão */
    .calc-insp-overlay { position: fixed; inset: 0; background: rgba(29, 31, 32,0.55); z-index: 120;  display: flex; align-items: center; justify-content: center; padding: 20px; }
    .calc-insp-modal { background: var(--bg-elevated); border-radius: 14px; width: min(820px, 96vw); max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.30); }
    .calc-insp-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); background: var(--bg-sunken); }
    .calc-insp-head h3 { margin: 0; font-size: 15px; font-family: var(--font-display); font-weight: 500; }
    .calc-insp-fechar { background: transparent; border: 1px solid var(--border); border-radius: 6px; width: 28px; height: 28px; font-size: 16px; cursor: pointer; color: var(--ink-faint); }
    .calc-insp-fechar:hover { background: var(--bg-elevated); color: var(--ink); }
    .calc-insp-body { padding: 16px 18px; overflow-y: auto; }
    .calc-insp-info { font-size: 12px; color: var(--ink-soft); margin-bottom: 14px; padding: 8px 12px; background: rgba(63, 100, 137,0.07); border-radius: 8px; }
    .calc-insp-vazio { padding: 20px; text-align: center; color: #a15646; background: rgba(161, 86, 70,0.06); border-radius: 8px; line-height: 1.6; }
    .calc-insp-linha { margin-bottom: 16px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
    .calc-insp-linha-head { padding: 9px 12px; background: var(--bg-sunken); font-size: 12.5px; border-bottom: 1px solid var(--border); }
    .calc-insp-tab { width: 100%; border-collapse: collapse; font-size: 12px; }
    .calc-insp-tab td { padding: 6px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
    .calc-insp-tab tr:last-child td { border-bottom: none; }
    .calc-insp-lbl { font-weight: 700; color: var(--ink-faint); width: 150px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; }
    .calc-insp-val { font-family: var(--font-mono); color: var(--ink); }
    .calc-insp-ok { color: #2B7A5B; }
    .calc-insp-aviso { color: #8A6420; }
    .calc-insp-erro { color: #a15646; font-weight: 600; }

    /* V131.46: Botão Exportar relatório */
    .calc-btn-exportar {
      background: var(--bg-elevated);
      color: #5980a6;
      border: 1px solid #3f6489;
      font-weight: 700;
    }
    .calc-btn-exportar:hover:not(:disabled) {
      background: linear-gradient(135deg, #3f6489, #5980a6);
      color: white;
      border-color: #5980a6;
      transform: translateY(-1px);
      box-shadow: 0 3px 10px rgba(63, 100, 137,0.30);
    }
    .calc-btn-exportar:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* V131.11/30/32: KPIs uniformes, compactos, alinhados à esquerda */
    .calc-kpis {
      display: grid; gap: 10px; margin-bottom: 12px;
      grid-template-columns: repeat(5, 1fr);
    }
    .calc-kpi {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 14px;
      display: flex; flex-direction: column; gap: 4px;
      align-items: flex-start;      /* V131.32: alinhado à esquerda */
      text-align: left;
      min-height: 78px;
      transition: background-color 180ms, color 180ms, border-color 180ms, box-shadow 180ms, transform 180ms, opacity 180ms;
      position: relative; overflow: hidden;
    }
    .calc-kpi-clicavel { cursor: pointer; }
    .calc-kpi-clicavel:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(63, 100, 137,0.10);
      border-color: rgba(63, 100, 137,0.40);
    }
    .calc-kpi-ativo {
      border-color: #3f6489;
      box-shadow: 0 0 0 3px rgba(63, 100, 137,0.18);
      background: rgba(63, 100, 137,0.04);
    }

    /* Cards teal (Produção Total e Repasse Total) */
    .calc-kpi-teal-soft {
      background: linear-gradient(135deg, rgba(63, 100, 137,0.10), rgba(63, 100, 137,0.04));
      border-color: rgba(63, 100, 137,0.35);
    }
    .calc-kpi-teal-soft .calc-kpi-valor { color: #46688c; }
    .calc-kpi-teal-forte {
      background: linear-gradient(135deg, #3f6489, #46688c);
      border: none;
    }
    .calc-kpi-teal-forte .calc-kpi-label,
    .calc-kpi-teal-forte .calc-kpi-valor,
    .calc-kpi-teal-forte .calc-kpi-sub { color: white; }
    .calc-kpi-teal-forte .calc-kpi-label { opacity: 0.85; }
    .calc-kpi-teal-forte::before {
      content: ''; position: absolute; top: 0; right: 0;
      width: 80px; height: 80px;
      background: radial-gradient(circle at top right, rgba(255,255,255,0.18), transparent 70%);
      pointer-events: none;
    }

    /* V131.12: Card de Glosa com mesmo "peso" visual do Repasse Total — gradient cheio + brilho */
    .calc-kpi-glosa-forte {
      background: linear-gradient(135deg, #a15646, #7A2B2B);
      border: none;
    }
    .calc-kpi-glosa-forte .calc-kpi-label,
    .calc-kpi-glosa-forte .calc-kpi-valor,
    .calc-kpi-glosa-forte .calc-kpi-sub,
    .calc-kpi-glosa-forte .calc-kpi-sub small,
    .calc-kpi-glosa-forte .calc-kpi-valor small,
    .calc-kpi-glosa-forte .calc-kpi-unid { color: white; }
    .calc-kpi-glosa-forte .calc-kpi-label { opacity: 0.85; }
    .calc-kpi-glosa-forte::before {
      content: ''; position: absolute; top: 0; right: 0;
      width: 80px; height: 80px;
      background: radial-gradient(circle at top right, rgba(255,255,255,0.18), transparent 70%);
      pointer-events: none;
    }
    /* Hover/Ativo da Glosa forte — mantém vermelho ao invés do teal padrão */
    .calc-kpi-glosa-forte.calc-kpi-clicavel:hover {
      box-shadow: 0 6px 16px rgba(161, 86, 70,0.30);
    }
    .calc-kpi-glosa-forte.calc-kpi-ativo {
      border: none;
      box-shadow: 0 0 0 3px rgba(161, 86, 70,0.35);
      background: linear-gradient(135deg, #a15646, #7A2B2B);
    }

    /* V131.27/28/29: Card Produção Total — fundo igual à sidebar (#222422).
       Valor principal em teal, demais textos em off-white (cor de texto da sidebar). */
    .calc-kpi-producao-dark {
      background: linear-gradient(135deg, #222422, #1A1C1A);
      border: none;
    }
    /* Valor principal — verde (mesma família do card Repasse Total ao lado) */
    .calc-kpi-producao-dark .calc-kpi-valor,
    .calc-kpi-producao-dark .calc-kpi-valor small { color: #3f6489; }
    /* Demais textos — off-white */
    .calc-kpi-producao-dark .calc-kpi-label,
    .calc-kpi-producao-dark .calc-kpi-sub,
    .calc-kpi-producao-dark .calc-kpi-sub small,
    .calc-kpi-producao-dark .calc-kpi-unid { color: #f2f3f5; }
    .calc-kpi-producao-dark .calc-kpi-label { opacity: 0.78; }
    .calc-kpi-producao-dark::before {
      content: ''; position: absolute; top: 0; right: 0;
      width: 80px; height: 80px;
      background: radial-gradient(circle at top right, rgba(63, 100, 137,0.20), transparent 70%);
      pointer-events: none;
    }

    /* V131.27/30/31/32: Card Glosa — fundo neutro com glow vermelho permanente (igual o QVIS ativo em teal) */
    .calc-kpi-glosa-bordered {
      background: rgba(161, 86, 70,0.04);
      border: 1px solid #a15646;
      box-shadow: 0 0 0 3px rgba(161, 86, 70,0.18);
    }
    .calc-kpi-glosa-bordered .calc-kpi-label { color: #a15646; opacity: 0.85; }
    .calc-kpi-glosa-bordered .calc-kpi-valor,
    .calc-kpi-glosa-bordered .calc-kpi-valor small,
    .calc-kpi-glosa-bordered .calc-kpi-unid { color: #a15646; }
    .calc-kpi-glosa-bordered .calc-kpi-sub,
    .calc-kpi-glosa-bordered .calc-kpi-sub small { color: var(--ink-soft); }
    .calc-kpi-glosa-bordered.calc-kpi-clicavel:hover {
      border-color: #7A2B2B;
      box-shadow: 0 0 0 3px rgba(161, 86, 70,0.25), 0 6px 16px rgba(161, 86, 70,0.18);
      background: rgba(161, 86, 70,0.06);
    }
    .calc-kpi-glosa-bordered.calc-kpi-ativo {
      border-color: #a15646;
      box-shadow: 0 0 0 4px rgba(161, 86, 70,0.30);
      background: rgba(161, 86, 70,0.08);
    }

    /* V131.14/30/31/32: breakdown — alinhado à esquerda como o resto */
    .calc-kpi-breakdown {
      display: flex; flex-direction: column;
      gap: 1px;
      margin-top: 3px;
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--ink-soft);
      line-height: 1.5;
      align-items: flex-start;
      text-align: left;
      width: 100%;
    }
    /* V131.30: labels strong na MESMA cor do valor (sem opacity diferente) */
    .calc-kpi-breakdown strong {
      display: inline-block;
      min-width: 38px;
      font-weight: 700;
      text-transform: lowercase;
      color: inherit;                           /* herda do parent */
    }

    /* V131.17/30: breakdown dentro do card teal forte — branco em todos os textos */
    .calc-kpi-teal-forte .calc-kpi-breakdown,
    .calc-kpi-teal-forte .calc-kpi-breakdown strong {
      color: rgba(255,255,255,0.92);
    }
    /* V131.27/29/30: breakdown dentro do producao-dark — off-white em todos os textos */
    .calc-kpi-producao-dark .calc-kpi-breakdown,
    .calc-kpi-producao-dark .calc-kpi-breakdown strong {
      color: #f2f3f5;
    }
    /* V131.27/30: breakdown dentro do glosa-bordered — vermelho discreto em todos */
    .calc-kpi-glosa-bordered .calc-kpi-breakdown,
    .calc-kpi-glosa-bordered .calc-kpi-breakdown strong {
      color: #a15646;
    }

    /* Variantes de cor (existentes) */
    .calc-kpi-excl  .calc-kpi-valor { color: #585d62; }
    .calc-kpi-glosa .calc-kpi-valor { color: #a15646; }
    .calc-kpi-warn  .calc-kpi-valor { color: #5980a6; }
    .calc-kpi-warn2 .calc-kpi-valor { color: #C76A3A; }

    /* Tipografia interna do card — V131.30/32: uniforme, alinhado à esquerda */
    .calc-kpi-label {
      font-size: 10.5px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.06em;
      color: #1d1f20; /* V849: título dos cards totalizadores (variantes fortes/glosa mantêm a cor própria) */
      text-align: left;
    }
    .calc-kpi-valor {
      font-size: 20px; font-weight: 800;
      color: var(--ink);
      font-family: var(--font-mono);
      line-height: 1.15;
      text-align: left;
      white-space: nowrap;       /* V131.41: não quebra valor R$ */
    }
    .calc-kpi-valor-rs { font-size: 20px; }    /* V131.30: igual ao valor (era 21px) */
    .calc-kpi-valor small,
    .calc-kpi-unid {
      font-size: 10.5px; font-weight: 600;
      opacity: 0.7;
      margin-left: 2px;
    }
    /* V131.11/30/32: linha secundária dentro do card (Glosa: R$ produzido / Proc sem regra: linhas) */
    .calc-kpi-sub {
      font-size: 11px; font-weight: 600;
      color: var(--ink-soft);
      font-family: var(--font-mono);
      margin-top: 2px;
      text-align: left;
    }
    .calc-kpi-sub small {
      font-family: var(--font-body, system-ui);
      font-weight: 500;
      opacity: 0.7; margin-left: 2px;
    }
    .calc-kpi-glosa .calc-kpi-sub { color: #a15646; opacity: 0.85; }
    .calc-kpi-warn  .calc-kpi-sub { color: #5980a6; opacity: 0.85; }

    /* V973: subtotais dos cards inteiros — sem nowrap/ellipsis do .aic-meta global; um por linha */
    #calc-kpis .aic-meta { white-space: normal; overflow: visible; text-overflow: clip; line-height: 1.4; }
    .calc-kpi-sub-it { display: block; white-space: nowrap; }
    @media (max-width: 1300px) { .calc-kpis { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 800px)  { .calc-kpis { grid-template-columns: repeat(2, 1fr); } }

    /* V131.10: rodapé da matriz com totais */
    .calc-tabela tfoot tr.calc-tr-totais td {
      background: linear-gradient(to bottom, var(--bg-sunken), var(--bg-elevated));
      border-top: 2px solid #3f6489;
      padding: 12px 8px;
      font-size: 13px;
    }
    .calc-tabela tfoot .calc-td-total-label {
      text-align: right; color: var(--ink-soft);
    }
    .calc-tabela tfoot .calc-td-total-label small {
      display: inline-block; margin-left: 8px;
      font-weight: 400; font-style: italic;
      color: var(--ink-faint); font-size: 11px;
    }
    .calc-tabela tfoot .calc-td-repasse-total {
      color: #3f6489; font-size: 14px;   /* V964 */
      background: linear-gradient(to bottom, rgba(63, 100, 137,0.08), rgba(63, 100, 137,0.04));
    }
    .calc-kpi-excl  .calc-kpi-valor { color: #585d62; }
    .calc-kpi-glosa .calc-kpi-valor { color: #a15646; }
    .calc-kpi-warn2 .calc-kpi-valor { color: #C76A3A; }

    .calc-st-excl .calc-td-status { color: #585d62; font-weight: 700; }
    .calc-st-excl td { background: rgba(107,114,128,0.05); opacity: 0.75; }
    /* V131.7: estado "sem regra pro papel" — laranja diferente do "proc novo" */
    .calc-st-warn2 .calc-td-status { color: #C76A3A; }
    .calc-st-warn2 td { background: rgba(199,106,58,0.04); }

    /* V131.7: tags textuais por status (substituem ícones quando aplicável) */
    .calc-tag-novo {
      display: inline-block; padding: 2px 7px;
      background: #C18A4A; color: white;
      font-size: 9px; font-weight: 800; letter-spacing: 0.06em;
      border-radius: 4px; text-transform: uppercase;
    }
    .calc-tag-srp {
      display: inline-block; padding: 2px 6px;
      background: #C76A3A; color: white;
      font-size: 9px; font-weight: 800; letter-spacing: 0.06em;
      border-radius: 4px; text-transform: uppercase; white-space: nowrap;
    }

    /* V131.4: GLOSA (linha avermelhada) */
    .calc-st-glosa .calc-td-status { color: #a15646; font-weight: 700; }
    .calc-st-glosa td { background: rgba(161, 86, 70,0.07) !important; }
    .calc-st-glosa:hover td { background: rgba(161, 86, 70,0.12) !important; }

    /* V131.41: DUPLICIDADE — linha com marca d'água dourada estriada */
    .calc-st-dup .calc-td-status { color: #5980a6; font-weight: 700; }
    .calc-st-dup td {
      background:
        repeating-linear-gradient(
          135deg,
          rgba(63, 100, 137,0.10),
          rgba(63, 100, 137,0.10) 8px,
          rgba(63, 100, 137,0.18) 8px,
          rgba(63, 100, 137,0.18) 16px
        ) !important;
    }
    .calc-st-dup:hover td {
      background:
        repeating-linear-gradient(
          135deg,
          rgba(63, 100, 137,0.16),
          rgba(63, 100, 137,0.16) 8px,
          rgba(63, 100, 137,0.26) 8px,
          rgba(63, 100, 137,0.26) 16px
        ) !important;
    }
    .calc-tag-dup {
      display: inline-block; padding: 2px 7px;
      background: #3f6489; color: white;
      font-size: 9px; font-weight: 800; letter-spacing: 0.06em;
      border-radius: 4px; text-transform: uppercase;
    }

    /* V131.49: PACOTE de Consulta — linha-filha informativa */
    .calc-tag-pacote {
      display: inline-block; padding: 2px 7px;
      background: #585d62; color: white;
      font-size: 9px; font-weight: 800; letter-spacing: 0.06em;
      border-radius: 4px; text-transform: uppercase;
    }
    /* V132.25: tag QVIS (status "casou") e data de admissão */
    .calc-tag-qvis {
      display: inline-block; padding: 2px 7px;
      background: #2C7A5B; color: white;
      font-size: 9px; font-weight: 800; letter-spacing: 0.06em;
      border-radius: 4px; text-transform: uppercase;
    }
    .calc-data-adm { color: #9A9A9A; font-size: 11px; margin-left: 6px; }
    .calc-st-pacote .calc-td-status { color: #585d62; font-weight: 700; }
    .calc-st-pacote td {
      background: rgba(107,114,128,0.04) !important;
      border-top: 1px dashed rgba(107,114,128,0.20) !important;
    }
    /* indentação visual no Procedimento da filha */
    .calc-st-pacote .calc-td-proc { padding-left: 28px; position: relative; }
    .calc-st-pacote .calc-td-proc::before {
      content: '↳';
      position: absolute;
      left: 10px; top: 50%;
      transform: translateY(-50%);
      color: #3f6489;
      font-weight: 700;
      font-size: 14px;
    }
    .calc-st-pacote .calc-proc-nome {
      font-style: italic;
      color: var(--ink-soft);
      font-size: 12.5px;
    }
    /* V617: filha herdada pelo executante real (coluna MÉDICO da Produção) */
    .calc-st-exec-real td {
      background: rgba(63, 100, 137,0.07) !important;
      border-top: 1px dashed rgba(63, 100, 137,0.30) !important;
    }
    /* V620: validador da regra do Pacote de Consulta */
    .calc-aj-pk-val-erro {
      margin-top: 12px; padding: 10px 12px; border-radius: 8px;
      background: rgba(193,138,74,0.10); color: #8A5A22; font-size: 12.5px;
    }
    .calc-aj-pk-val-resumo { margin: 14px 0 8px; font-size: 12.5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .calc-aj-pk-val-chip {
      display: inline-block; padding: 2px 9px; border-radius: 999px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.02em;
    }
    .calc-aj-pk-val-chip.is-azul  { background: rgba(63, 100, 137,0.14); color: #0F6E99; }
    .calc-aj-pk-val-chip.is-ok    { background: rgba(107,114,128,0.12); color: #4B5563; }
    .calc-aj-pk-val-chip.is-trava { background: rgba(199,106,58,0.14); color: #9A4E22; }
    .calc-aj-pk-val-tabwrap { margin-top: 6px; max-height: 340px; overflow: auto; border: 1px solid var(--linha, #E5E0D5); border-radius: 8px; }
    .calc-aj-pk-val-tab { width: 100%; border-collapse: collapse; font-size: 12px; }
    .calc-aj-pk-val-tab th {
      position: sticky; top: 0; background: var(--papel, #fff);
      text-align: left; padding: 7px 9px; font-size: 10.5px; letter-spacing: 0.05em;
      text-transform: uppercase; color: var(--ink-soft); border-bottom: 1px solid var(--linha, #E5E0D5);
    }
    .calc-aj-pk-val-tab td { padding: 7px 9px; border-bottom: 1px solid rgba(0,0,0,0.05); vertical-align: top; }
    .calc-aj-pk-val-tr-azul td { background: rgba(63, 100, 137,0.06); }
    .calc-aj-pk-val-tr-trava td { background: rgba(199,106,58,0.05); }
    .calc-aj-pk-val-det { color: var(--ink-soft); font-size: 11px; }
    .calc-aj-pk-val-nada { color: #9A4E22; font-style: italic; }
    .calc-glosa-tag {
      display: inline-block; padding: 1px 7px; border-radius: 4px;
      background: rgba(161, 86, 70,0.12); color: #a15646;
      font-weight: 700; letter-spacing: 0.02em;
    }
    .calc-zerado { color: var(--ink-faint); }
    .calc-via-prod {
      display: inline-flex; align-items: center; gap: 4px;
      background: rgba(63, 100, 137,0.12); color: #5980a6;
      padding: 1px 7px; border-radius: 4px; border: 1px solid rgba(63, 100, 137,0.25);
      font-weight: 600;
    }
    .calc-via-prod small { font-size: 8.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.85; }
    .calc-match-fallback { background: rgba(63, 100, 137,0.15) !important; color: #5980a6 !important; }

    /* V131.4: caixa de filtros separada (card próprio) */
    .calc-filtros-card {
      display: grid;
      /* V901: 8 filtros (5 combos + 3 drops) → 4+4, em vez dos 6+1 de antes */
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      padding: 14px 16px; background: var(--bg-elevated);
      border: 1px solid var(--border); border-radius: 12px;
      margin-bottom: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    }
    @media (max-width: 1500px) { .calc-filtros-card { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 800px)  { .calc-filtros-card { grid-template-columns: 1fr 1fr; } }

    .calc-filtro-grupo { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .calc-filtro-label {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--ink-faint);
    }

    /* === V131.8: Input de texto (Admissão, Profissional, Procedimento) === */
    .calc-fil-input-wrap {
      position: relative; display: flex; align-items: center;
      background: var(--bg-elevated); border: 1px solid var(--border);
      border-radius: 8px; height: 38px;
      transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
    }
    .calc-fil-input-wrap:hover { border-color: rgba(63, 100, 137,0.45); }
    .calc-fil-input-wrap:focus-within {
      border-color: #3f6489;
      box-shadow: 0 0 0 3px rgba(63, 100, 137,0.15);
    }
    .calc-fil-input-wrap.calc-fil-ativo {
      background: rgba(63, 100, 137,0.06);
      border-color: rgba(63, 100, 137,0.45);
    }
    .calc-fil-icone {
      padding: 0 8px 0 12px; color: var(--ink-faint); font-size: 12px;
      pointer-events: none;
    }
    .calc-fil-input {
      flex: 1; min-width: 0;
      padding: 0 4px 0 0;
      border: none; background: transparent;
      font-family: inherit; font-size: 12.5px; color: var(--ink);
      height: 100%; line-height: normal;
    }
    .calc-fil-input:focus { outline: none; }

    /* === V131.8: Botão X interno (limpa um filtro específico) === */
    .calc-fil-x, .calc-fil-x-wrap {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; margin-right: 4px;
      border: none; background: rgba(161, 86, 70,0.10); color: #a15646;
      border-radius: 50%;
      font-size: 14px; font-weight: 700; line-height: 1;
      cursor: pointer; padding: 0;
      transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
    }
    .calc-fil-x:hover, .calc-fil-x-wrap:hover {
      background: #a15646; color: white; transform: scale(1.1);
    }

    /* V131.9: Caret ▾ dentro do combobox (input) — clicável pra abrir lista */
    .calc-fil-caret-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 100%; padding: 0; margin-right: 2px;
      background: transparent; border: none; cursor: pointer;
      color: var(--ink-faint); transition: color 150ms;
    }
    .calc-fil-caret-btn:hover { color: #46688c; }
    .calc-fil-combo-aberto .calc-fil-caret-btn { color: #46688c; }
    .calc-fil-input-wrap .calc-fil-caret { transition: transform 200ms ease; }
    .calc-fil-combo-aberto.calc-fil-input-wrap .calc-fil-caret { transform: rotate(180deg); }

    /* V131.9: dropdown do combobox usa as mesmas classes .calc-fil-opcoes / .calc-fil-opt */
    .calc-fil-opt-mais {
      padding: 8px 10px;
      font-size: 11px; color: var(--ink-faint);
      font-style: italic;
      background: var(--bg-sunken);
      border-radius: 6px; margin-top: 4px;
      text-align: center;
    }
    .calc-fil-opt-texto {
      flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* === V131.8: Custom Dropdown (Status, Fonte) — visual igual ao input === */
    .calc-fil-combo {
      position: relative;
      background: var(--bg-elevated); border: 1px solid var(--border);
      border-radius: 8px;
      transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
    }
    .calc-fil-combo:hover { border-color: rgba(63, 100, 137,0.45); }
    .calc-fil-combo.calc-fil-ativo {
      background: rgba(63, 100, 137,0.06);
      border-color: rgba(63, 100, 137,0.45);
    }
    .calc-fil-combo.calc-fil-combo-aberto {
      border-color: #3f6489;
      box-shadow: 0 0 0 3px rgba(63, 100, 137,0.15);
    }
    .calc-fil-display {
      width: 100%; height: 38px;
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 10px 0 12px;
      background: transparent; border: none;
      font-family: inherit; font-size: 12.5px; color: var(--ink);
      cursor: pointer; text-align: left;
    }
    .calc-fil-display:focus { outline: none; }
    .calc-fil-valor {
      flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .calc-fil-caret {
      color: var(--ink-faint); font-size: 11px; margin-left: 6px;
      transition: transform 200ms ease;
    }
    .calc-fil-combo-aberto .calc-fil-caret { transform: rotate(180deg); color: #46688c; }

    .calc-fil-opcoes {
      position: absolute; top: calc(100% + 6px); left: 0; right: auto;
      list-style: none; margin: 0; padding: 6px;
      /* V920: a janela cresce pro nome caber numa linha só (sem quebra) */
      min-width: 100%; width: max-content; max-width: min(92vw, 680px);
      background: var(--bg-elevated);
      border: 1px solid var(--border); border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      z-index: 50;
      max-height: 280px; overflow-y: auto; overflow-x: auto;
      animation: calc-fil-fadein 140ms ease;
    }
    @keyframes calc-fil-fadein {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .calc-fil-opt {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px;
      font-size: 12.5px; color: var(--ink);
      cursor: pointer; border-radius: 6px;
      transition: background 120ms;
    }
    .calc-fil-opt:hover { background: rgba(63, 100, 137,0.08); }
    .calc-fil-opt-ativa {
      background: rgba(63, 100, 137,0.12); color: #46688c; font-weight: 600;
    }
    .calc-fil-opt-check {
      display: inline-block; width: 14px; color: #3f6489;
      font-weight: 700;
    }
    /* V903: caixinha de checkbox das opções multi */
    .calc-fil-opt-cbx {
      flex: 0 0 15px; width: 15px; height: 15px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1.5px solid #9DBECE; border-radius: 4px;
      background: #fff; color: #fff;
      font-size: 11px; font-weight: 800; line-height: 1;
    }
    .calc-fil-opt-cbx.on { background: #3f6489; border-color: #3f6489; }
    .calc-fil-opt-separa {
      border-top: 1px dashed var(--border);
      margin: 4px 2px; padding: 0 !important; height: 0;
    }
    /* V904: dentro dos FILTROS o texto sai inteiro (sem "…") e em CAIXA ALTA.
       V920: SEM quebra de linha — o nome inteiro fica numa linha só (a janela
       alarga e a fonte diminui um pouco); matriz e exportações ficam como estão */
    .calc-fil-opcoes .calc-fil-opt,
    .calc-fil-opcoes .calc-fil-opt-texto {
      text-transform: uppercase;
      white-space: nowrap; overflow: visible; text-overflow: clip;
      word-break: normal;
      font-size: 11.5px;
    }

    /* V131.5: tag de Glosa (substitui o emoji 🩹) */
    .calc-th-status, .calc-td-status { width: 84px; text-align: center; padding-left: 6px; padding-right: 6px; }
    .calc-tag-glosa {
      display: inline-block;
      padding: 2px 7px;
      background: #a15646;
      color: white;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.06em;
      border-radius: 4px;
      text-transform: uppercase;
    }

    /* === V131.3: Modal de Ajustes === */
    .calc-aj-overlay { position: fixed; inset: 0; background: rgba(29, 31, 32,0.55); z-index: 99;  }
    .calc-aj-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 100; width: min(960px, 94vw); max-height: 88vh; background: var(--bg-elevated); border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.30); display: flex; flex-direction: column; overflow: hidden; }
    .calc-aj-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--border); background: var(--bg-sunken); }
    .calc-aj-head h3 { margin: 0; font-size: 16px; color: var(--ink); }
    .calc-aj-fechar { background: transparent; border: 1px solid var(--border); border-radius: 6px; width: 28px; height: 28px; font-size: 14px; cursor: pointer; color: var(--ink-faint); }
    .calc-aj-fechar:hover { background: var(--bg-elevated); color: var(--ink); }
    .calc-aj-tabs { display: flex; border-bottom: 1px solid var(--border); padding: 0 20px; gap: 4px; }
    .calc-aj-tab { padding: 10px 16px; background: transparent; border: none; border-bottom: 2px solid transparent; font-family: inherit; font-size: 13px; font-weight: 600; color: var(--ink-faint); cursor: pointer; }
    .calc-aj-tab:hover { color: var(--ink-soft); }
    .calc-aj-tab-ativa { color: #46688c; border-bottom-color: #3f6489; }
    .calc-aj-tab small { font-size: 10px; opacity: 0.7; font-weight: 500; }
    .calc-aj-body { padding: 18px 20px; overflow-y: auto; flex: 1; min-height: 0; }
    .calc-aj-help { margin: 0 0 14px; font-size: 12px; color: var(--ink-soft); line-height: 1.5; padding: 10px 12px; background: rgba(63, 100, 137,0.06); border: 1px solid rgba(63, 100, 137,0.18); border-radius: 8px; }

    .calc-aj-tipos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .calc-aj-tipo { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 2px solid var(--border); border-radius: 10px; cursor: pointer; transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms; }
    .calc-aj-tipo:hover { background: var(--bg-sunken); }
    .calc-aj-tipo input { margin: 0; }
    .calc-aj-tipo strong { font-size: 13px; color: var(--ink); display: block; }
    .calc-aj-tipo small { display: block; font-size: 10px; color: var(--ink-faint); margin-top: 2px; }
    .calc-aj-tipo-on { border-color: #3f6489; background: rgba(63, 100, 137,0.06); }
    .calc-aj-tipo-off { opacity: 0.7; }

    /* V131.42/43/44: Aba Exceções de Regras Personalizadas */
    .calc-aj-exc-secao {
      margin-bottom: 18px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--bg-elevated);
    }
    .calc-aj-exc-titulo {
      margin: 0 0 14px; font-size: 13px; font-weight: 700;
      color: var(--ink); display: flex; align-items: center; gap: 6px;
    }
    .calc-aj-exc-titulo small {
      font-size: 10px; font-weight: 500; color: var(--ink-faint);
      background: var(--bg-sunken); padding: 1px 6px; border-radius: 10px;
    }

    /* Formulário — linha 1 (médico + papel + fontes) */
    .calc-aj-exc-form-l1 {
      display: grid;
      grid-template-columns: 2fr 1fr 1.5fr;
      gap: 12px;
      margin-bottom: 12px;
    }
    .calc-aj-exc-form-l3 {
      display: flex; gap: 12px; align-items: end;
      margin-top: 12px;
    }
    .calc-aj-exc-form-l3 .calc-aj-exc-campo-valor { flex: 0 0 220px; }
    .calc-aj-exc-form-l3 .calc-aj-exc-btn { margin-left: auto; }

    .calc-aj-exc-campo { display: flex; flex-direction: column; gap: 4px; }
    .calc-aj-exc-label {
      font-size: 9.5px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--ink-faint);
    }
    .calc-aj-exc-label small { font-size: 9px; color: var(--ink-faint); opacity: 0.7; font-weight: 500; text-transform: none; }
    .calc-aj-exc-input {
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: 7px;
      font-family: inherit; font-size: 13px;
      background: var(--bg-elevated); color: var(--ink);
      width: 100%; box-sizing: border-box;
    }
    .calc-aj-exc-input:focus {
      outline: none; border-color: #3f6489;
      box-shadow: 0 0 0 2px rgba(63, 100, 137,0.18);
    }
    .calc-aj-exc-vtipo { display: flex; gap: 6px; }
    .calc-aj-exc-vtipo .calc-aj-exc-input { flex: 1; text-align: right; font-family: var(--font-mono); }
    .calc-aj-exc-tipo { width: 72px !important; flex: 0 0 72px !important; text-align: left !important; }

    /* V656: cadastro de SOBREPOSIÇÃO em 2 etapas + fichários por médico */
    .calc-exc2-etapa1 { display: flex; gap: 10px; align-items: flex-start; }
    .calc-exc2-etapa1 .calc-aj-ac-wrap { flex: 1; }
    .calc-exc2-medbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .calc-exc2-medbadge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 8px; font-size: 13px; font-weight: 700;
      background: rgba(70, 104, 140,0.10); color: #46688c; border: 1px solid rgba(70, 104, 140,0.35);
    }
    .calc-aj-exc-form-l1:has(.calc-exc2-campo-proc) { grid-template-columns: auto 1fr; }
    .calc-exc2-procsel { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-height: 36px; }
    .calc-exc2-linha-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
    .calc-exc2-linha { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 640px; }
    .calc-exc2-linha th {
      padding: 8px 10px; text-align: center; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em;
      background: #46688c; color: #fff; white-space: nowrap;
    }
    .calc-exc2-linha th:first-child { text-align: left; }
    .calc-exc2-linha td { padding: 8px 10px; border-top: 1px solid var(--border); text-align: center; vertical-align: middle; }
    .calc-exc2-linha td:first-child {
      text-align: left; font-weight: 700; font-size: 11px; color: var(--ink-soft); white-space: nowrap;
    }
    .calc-exc2-linha td:first-child small { font-weight: 500; color: var(--ink-faint); }
    .calc-exc2-geral td { background: var(--bg-sunken); font-family: var(--font-mono); font-size: 12px; }
    .calc-exc2-sobre .calc-aj-exc-vtipo { min-width: 128px; }
    .calc-exc2-sobre .calc-exc2-val { min-width: 64px; }
    .calc-exc2-td-ativa { background: rgba(70, 104, 140,0.07); }
    .calc-exc2-tag-ativa { display: block; margin-top: 3px; font-size: 9px; font-weight: 700; color: #46688c; }
    .calc-exc2-fichs { display: flex; flex-direction: column; gap: 8px; }
    .calc-exc2-fich { border: 1px solid var(--border); border-radius: 10px; background: var(--bg-elevated); overflow: hidden; }
    .calc-exc2-fich-aberto { border-color: rgba(70, 104, 140,0.5); box-shadow: 0 1px 6px rgba(70, 104, 140,0.12); }
    .calc-exc2-fich-head {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 10px 14px; cursor: pointer; user-select: none;
    }
    .calc-exc2-fich-head:hover { background: rgba(70, 104, 140,0.05); }
    .calc-exc2-fich-id strong { font-size: 13px; color: var(--ink); display: block; }
    .calc-exc2-fich-id small { font-size: 10.5px; color: var(--ink-faint); }
    .calc-exc2-fich-acoes { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .calc-exc2-btn-mini { padding: 4px 10px !important; font-size: 11px !important; }
    .calc-exc2-btn-perigo { color: #B3261E !important; border-color: rgba(179,38,30,0.35) !important; }
    .calc-exc2-btn-perigo:hover { background: rgba(179,38,30,0.08) !important; }
    .calc-exc2-seta { font-size: 12px; color: var(--ink-faint); width: 14px; text-align: center; }
    .calc-exc2-fich-body { padding: 4px 14px 12px; border-top: 1px dashed var(--border); }
    .calc-exc2-procgrupo { margin-top: 10px; }
    .calc-exc2-procnome { font-size: 11.5px; font-weight: 700; color: #46688c; margin-bottom: 4px; }
    .calc-exc2-orfao { font-size: 9.5px; font-weight: 600; color: #c07a66; }
    /* V658: extração via Produção + bloqueio de desempenho */
    .calc-exc2-tag-prod {
      display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 9px;
      font-size: 9px; font-weight: 700; letter-spacing: 0.03em;
      background: rgba(184,150,90,0.16); color: #8a6d3b; border: 1px solid rgba(184,150,90,0.45);
    }
    .calc-exc2-bloq { margin: 8px 0 4px; padding: 10px 12px; border: 1px dashed var(--border); border-radius: 8px; background: var(--bg-sunken); }
    .calc-exc2-bloq-tit { font-size: 11px; font-weight: 700; color: var(--ink-soft); margin-bottom: 8px; }
    .calc-exc2-bloq-tit small { font-weight: 500; color: var(--ink-faint); }
    .calc-exc2-bloq-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .calc-exc2-bloq-chip {
      padding: 4px 10px; border-radius: 14px; font-size: 11px; cursor: pointer;
      border: 1px solid var(--border); background: var(--bg-elevated); color: var(--ink-soft);
    }
    .calc-exc2-bloq-chip:hover { border-color: #c07a66; color: #c07a66; }
    .calc-exc2-bloq-on {
      background: rgba(192,57,43,0.10); border-color: rgba(192,57,43,0.55);
      color: #c07a66; font-weight: 700;
    }
    .calc-exc2-td-acoes { white-space: nowrap; }
    .calc-exc2-editar {
      border: none; background: transparent; cursor: pointer; font-size: 13px;
      color: #46688c; padding: 2px 6px; border-radius: 5px;
    }
    .calc-exc2-editar:hover { background: rgba(70, 104, 140,0.12); }

    /* V131.45: Autocomplete custom */
    .calc-aj-ac-wrap { position: relative; width: 100%; }
    .calc-aj-ac-list {
      position: absolute;
      top: calc(100% + 3px); left: 0; right: 0;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 8px;
      max-height: 260px; overflow-y: auto;
      z-index: 200;
      display: none;
      box-shadow: 0 8px 28px rgba(0,0,0,0.18);
    }
    .calc-aj-ac-list.open { display: block; }
    .calc-aj-ac-item {
      padding: 8px 12px;
      cursor: pointer;
      font-size: 12.5px;
      color: var(--ink);
      border-bottom: 1px solid var(--border);
      transition: background 100ms;
      line-height: 1.4;
    }
    .calc-aj-ac-item:last-child { border-bottom: none; }
    .calc-aj-ac-item:hover,
    .calc-aj-ac-active {
      background: rgba(63, 100, 137,0.10);
      color: #6B5020;
    }
    .calc-aj-ac-item mark {
      background: rgba(63, 100, 137,0.40);
      color: inherit;
      padding: 0 1px;
      border-radius: 2px;
      font-weight: 700;
    }
    .calc-aj-ac-empty {
      padding: 10px 12px;
      font-size: 11.5px;
      color: var(--ink-faint);
      font-style: italic;
      text-align: center;
    }
    /* Scrollbar custom da lista */
    .calc-aj-ac-list::-webkit-scrollbar { width: 8px; }
    .calc-aj-ac-list::-webkit-scrollbar-track { background: var(--bg-sunken); border-radius: 4px; }
    .calc-aj-ac-list::-webkit-scrollbar-thumb { background: rgba(63, 100, 137,0.30); border-radius: 4px; }
    .calc-aj-ac-list::-webkit-scrollbar-thumb:hover { background: rgba(63, 100, 137,0.50); }

    /* V131.45: Checkboxes multi-fonte */
    .calc-aj-exc-fontes {
      display: flex; gap: 4px; flex-wrap: wrap;
      padding: 4px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--bg-sunken);
    }
    .calc-aj-exc-fcheck {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 10px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 11.5px; font-weight: 600;
      color: var(--ink-soft);
      transition: background-color 130ms, color 130ms, border-color 130ms, box-shadow 130ms, transform 130ms, opacity 130ms;
      background: transparent;
      user-select: none;
    }
    .calc-aj-exc-fcheck:hover { background: var(--bg-elevated); }
    .calc-aj-exc-fcheck input { margin: 0; cursor: pointer; }
    .calc-aj-exc-fcheck-on { background: var(--bg-elevated); color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .calc-aj-exc-fcheck-disabled { opacity: 0.40; cursor: not-allowed; }
    .calc-aj-exc-fcheck-disabled:hover { background: transparent; }
    .calc-aj-exc-fcheck-todas.calc-aj-exc-fcheck-on { color: #4B5563; }
    .calc-aj-exc-fcheck-convenio.calc-aj-exc-fcheck-on { color: #2C4E37; }
    .calc-aj-exc-fcheck-particular.calc-aj-exc-fcheck-on { color: #6B5020; }
    .calc-aj-exc-fcheck-sus.calc-aj-exc-fcheck-on { color: #7A2B2B; }

    /* Procedimentos com chips */
    .calc-aj-exc-procs { margin-top: 4px; }
    .calc-aj-exc-procs-add {
      display: flex; gap: 8px; margin-bottom: 8px;
      align-items: stretch;
    }
    .calc-aj-exc-procs-add .calc-aj-ac-wrap { flex: 1; }
    .calc-aj-exc-btn-ghost {
      background: transparent !important;
      color: #5980a6 !important;
      border: 1.5px solid #3f6489 !important;
    }
    .calc-aj-exc-btn-ghost:hover {
      background: rgba(63, 100, 137,0.08) !important;
      color: #6B5020 !important;
    }
    .calc-aj-exc-chips {
      display: flex; flex-wrap: wrap; gap: 6px;
      min-height: 36px;
      padding: 8px;
      border: 1px dashed var(--border);
      border-radius: 7px;
      background: var(--bg-sunken);
      align-items: center;
    }
    .calc-aj-exc-chips-vazio {
      font-size: 11.5px; color: var(--ink-faint);
      font-style: italic; padding: 0 4px;
    }
    .calc-aj-exc-chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 4px 4px 10px;
      background: rgba(63, 100, 137,0.12);
      border: 1px solid rgba(63, 100, 137,0.40);
      border-radius: 16px;
      font-size: 11.5px; font-weight: 500;
      color: #6B5020;
    }
    .calc-aj-exc-chip-x {
      width: 18px; height: 18px;
      background: transparent;
      border: none; border-radius: 50%;
      color: #6B5020;
      font-size: 11px; font-weight: 700;
      cursor: pointer; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      transition: background-color 130ms, color 130ms, border-color 130ms, box-shadow 130ms, transform 130ms, opacity 130ms;
      margin-left: 2px;
    }
    .calc-aj-exc-chip-x:hover {
      background: #a15646;
      color: white;
    }

    /* Botões */
    .calc-aj-exc-btn {
      padding: 9px 16px;
      background: #3f6489;
      color: white;
      border: none; border-radius: 7px;
      font-family: inherit; font-size: 12px; font-weight: 700;
      cursor: pointer; transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      white-space: nowrap;
    }
    .calc-aj-exc-btn:hover { background: #A07F45; transform: translateY(-1px); }
    .calc-aj-exc-btn-salvar {
      background: linear-gradient(135deg, #3f6489, #5980a6);
      padding: 10px 22px;
      font-size: 13px;
    }
    .calc-aj-exc-btn-salvar:hover { background: linear-gradient(135deg, #C9A66B, #A07F45); }

    /* Tabela de regras cadastradas */
    .calc-aj-exc-tabela-wrap {
      max-height: 320px; overflow-y: auto;
      border-radius: 8px; border: 1px solid var(--border);
    }
    .calc-aj-exc-tabela {
      width: 100%; border-collapse: collapse;
      font-size: 12px;
    }
    .calc-aj-exc-tabela th {
      padding: 8px 12px;
      text-align: left;
      background: var(--bg-sunken);
      font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--ink-faint);
      border-bottom: 1px solid var(--border);
      position: sticky; top: 0;
    }
    .calc-aj-exc-tabela th.calc-aj-exc-th-valor { text-align: right; }
    .calc-aj-exc-tabela td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      color: var(--ink);
      vertical-align: middle;
    }
    .calc-aj-exc-tabela tr:hover td { background: rgba(63, 100, 137,0.04); }
    .calc-aj-exc-tabela tr:last-child td { border-bottom: none; }
    .calc-aj-exc-tabela td strong { font-weight: 600; }
    .calc-aj-exc-td-valor {
      text-align: right;
      font-family: var(--font-mono);
      font-weight: 700; color: #5980a6;
      font-size: 12.5px;
      white-space: nowrap;
    }

    /* Tags */
    .calc-aj-exc-papel-tag {
      display: inline-block;
      padding: 2px 8px;
      background: rgba(63, 100, 137,0.12);
      color: #46688c;
      border-radius: 10px;
      font-size: 10.5px;
      font-weight: 600;
      white-space: nowrap;
    }
    .calc-aj-exc-fonte-tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10.5px;
      font-weight: 600;
      white-space: nowrap;
    }
    .calc-aj-exc-fonte-todas      { background: rgba(107,114,128,0.12); color: #4B5563; }
    .calc-aj-exc-fonte-convenio   { background: rgba(79, 138, 91,0.14);   color: #2C4E37; }
    .calc-aj-exc-fonte-particular { background: rgba(63, 100, 137,0.16);  color: #6B5020; }
    .calc-aj-exc-fonte-sus        { background: rgba(161, 86, 70,0.12);   color: #7A2B2B; }

    /* Botão remover */
    .calc-aj-exc-remove {
      width: 22px; height: 22px;
      background: transparent;
      border: 1px solid rgba(161, 86, 70,0.30);
      border-radius: 6px;
      color: #a15646;
      font-size: 12px; font-weight: 700;
      cursor: pointer; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      transition: background-color 130ms, color 130ms, border-color 130ms, box-shadow 130ms, transform 130ms, opacity 130ms;
    }
    .calc-aj-exc-remove:hover {
      background: rgba(161, 86, 70,0.10);
      border-color: #a15646;
    }

    /* Área de teste/simulação */
    .calc-aj-exc-teste {
      background: linear-gradient(135deg, rgba(124,92,191,0.04), rgba(124,92,191,0.02));
      border: 1px dashed rgba(124,92,191,0.40);
    }
    .calc-aj-exc-teste .calc-aj-exc-titulo {
      color: #7C5CBF;
    }
    .calc-aj-teste-aviso {
      padding: 6px 10px;
      background: rgba(199,106,58,0.10);
      border: 1px solid rgba(199,106,58,0.30);
      color: #8B4A23;
      border-radius: 6px;
      font-size: 11px; font-weight: 600;
      margin-bottom: 10px;
    }
    .calc-aj-teste-botoes { display: flex; gap: 8px; flex-wrap: wrap; }
    .calc-aj-teste-btn {
      padding: 8px 14px;
      background: #7C5CBF;
      color: white;
      border: none; border-radius: 8px;
      font-family: inherit; font-size: 12px; font-weight: 700;
      cursor: pointer; transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
    }
    .calc-aj-teste-btn:hover { background: #6647A6; transform: translateY(-1px); }
    .calc-aj-teste-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
    .calc-aj-teste-btn-clear { background: #6B6B6B; }
    .calc-aj-teste-btn-clear:hover { background: #555; }

    @media (max-width: 900px) {
      .calc-aj-exc-form-l1 { grid-template-columns: 1fr 1fr; }
      .calc-aj-exc-form-l3 { flex-wrap: wrap; }
      .calc-aj-exc-form-l3 .calc-aj-exc-btn { margin-left: 0; width: 100%; }
    }

    /* V131.49: Aba Pacotes de Consulta */
    .calc-aj-pk-form {
      display: grid;
      grid-template-columns: 1.2fr 1fr 1fr 1.6fr auto;
      gap: 12px;
      align-items: end;
    }
    .calc-aj-pk-campo-nome { min-width: 0; }
    .calc-aj-pk-tabela {
      width: 100%; border-collapse: collapse;
      font-size: 12px;
    }
    .calc-aj-pk-tabela th {
      padding: 8px 12px;
      text-align: left;
      background: var(--bg-sunken);
      font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--ink-faint);
      border-bottom: 1px solid var(--border);
      position: sticky; top: 0;
    }
    .calc-aj-pk-tabela th small {
      display: block;
      font-size: 8.5px;
      font-weight: 500;
      text-transform: none;
      letter-spacing: 0;
      color: var(--ink-faint);
      opacity: 0.7;
      margin-top: 1px;
    }
    .calc-aj-pk-tabela td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--border);
      color: var(--ink);
      vertical-align: middle;
    }
    .calc-aj-pk-tabela td:first-child { padding-left: 12px; }
    .calc-aj-pk-tabela tr:hover td { background: rgba(63, 100, 137,0.04); }
    .calc-aj-pk-tabela tr:last-child td { border-bottom: none; }
    .calc-aj-pk-th-conv  { width: 16%; }
    .calc-aj-pk-th-val2  { width: 16%; }
    .calc-aj-pk-th-nome  { width: 30%; }

    /* V131.52: Célula com input + select compactos (valor + tipo lado-a-lado) */
    .calc-aj-pk-vtipo {
      display: flex; gap: 4px;
    }
    .calc-aj-pk-vtipo .calc-aj-pk-i-valor { flex: 1; min-width: 0; }
    .calc-aj-pk-vtipo .calc-aj-pk-i-tipo { width: 56px; flex: 0 0 56px; padding: 6px 4px; }

    /* V131.55: Chave normalizada embaixo do nome (mostra como o match é feito) */
    .calc-aj-pk-chave {
      display: block;
      font-size: 9.5px;
      font-weight: 500;
      color: var(--ink-faint);
      font-family: var(--font-mono);
      letter-spacing: 0.02em;
      margin-top: 2px;
      opacity: 0.75;
    }

    /* V131.55: Painel de diagnóstico — convênios detectados no QVIS */
    .calc-aj-pk-diag {
      margin: 0 0 16px;
      padding: 11px 13px 10px;
      background: var(--bg-sunken);
      border-left: 3px solid #3f6489;
      border-radius: 0 8px 8px 0;
      font-size: 11.5px;
    }
    .calc-aj-pk-diag strong {
      display: block;
      margin-bottom: 7px;
      color: var(--ink);
      font-size: 12px;
    }
    .calc-aj-pk-diag-chips {
      display: flex; flex-wrap: wrap; gap: 5px;
    }
    .calc-aj-pk-diag-ok, .calc-aj-pk-diag-prefixo, .calc-aj-pk-diag-no {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 9px;
      border-radius: 11px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid;
    }
    .calc-aj-pk-diag-ok {
      background: rgba(79, 138, 91,0.10);
      border-color: rgba(79, 138, 91,0.40);
      color: #2C4E37;
    }
    .calc-aj-pk-diag-prefixo {
      background: rgba(63, 100, 137,0.10);
      border-color: rgba(63, 100, 137,0.45);
      color: #5980a6;
    }
    .calc-aj-pk-diag-no {
      background: rgba(107,114,128,0.06);
      border-color: rgba(107,114,128,0.25);
      color: var(--ink-faint);
    }
    /* V131.59: chip de vínculo manual (alias) no diagnóstico */
    .calc-aj-pk-diag-alias {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 9px;
      border-radius: 11px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid rgba(63, 100, 137,0.45);
      background: rgba(63, 100, 137,0.10);
      color: #1F6B6B;
    }
    .calc-aj-pk-diag-alias small { opacity: 0.7; font-weight: 400; font-size: 9.5px; }
    .calc-aj-pk-diag-ok small,
    .calc-aj-pk-diag-prefixo small,
    .calc-aj-pk-diag-no small {
      opacity: 0.65;
      font-weight: 400;
      font-size: 9.5px;
    }
    /* select de "flagar" dentro do chip cinza */
    .calc-aj-pk-flag {
      margin-left: 6px;
      padding: 1px 4px;
      font-family: inherit;
      font-size: 10px;
      border: 1px solid rgba(63, 100, 137,0.45);
      border-radius: 6px;
      background: var(--bg-elevated);
      color: #1F6B6B;
      cursor: pointer;
    }
    .calc-aj-pk-flag:hover { border-color: #3f6489; }

    /* V131.59: aliases vinculados na coluna Convênio da tabela */
    .calc-aj-pk-aliases {
      display: flex; flex-wrap: wrap; gap: 3px;
      margin-top: 4px;
    }
    .calc-aj-pk-alias {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 1px 6px;
      background: rgba(63, 100, 137,0.10);
      border: 1px solid rgba(63, 100, 137,0.35);
      border-radius: 9px;
      font-size: 9.5px;
      color: #1F6B6B;
    }
    .calc-aj-pk-alias-x {
      border: none; background: transparent;
      color: #1F6B6B; cursor: pointer;
      font-size: 10px; font-weight: 700;
      padding: 0 0 0 2px; line-height: 1;
    }
    .calc-aj-pk-alias-x:hover { color: #a15646; }

    .calc-aj-pk-i {
      width: 100%; box-sizing: border-box;
      padding: 6px 9px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-family: inherit; font-size: 12px;
      background: var(--bg-elevated); color: var(--ink);
    }
    .calc-aj-pk-i:focus {
      outline: none;
      border-color: #3f6489;
      box-shadow: 0 0 0 2px rgba(63, 100, 137,0.18);
    }
    .calc-aj-pk-i-valor { text-align: right; font-family: var(--font-mono); }
    .calc-aj-pk-i-tipo  { width: 70px; }
    .calc-aj-pk-help {
      display: block;
      margin-top: 8px;
      font-size: 10.5px;
      color: var(--ink-faint);
      font-style: italic;
      padding: 0 4px;
    }

    /* V131.50/51: Toggle + popover de procedimentos vinculados */
    .calc-aj-pk-wrap {
      border-radius: 8px;
      border: 1px solid var(--border);
      overflow: visible;   /* importante: popover não pode ser cortado */
    }
    .calc-aj-pk-th-procs { width: 14%; text-align: center; }
    .calc-aj-pk-td-toggle {
      position: relative;   /* âncora do popover */
      text-align: center;
    }
    .calc-aj-pk-toggle {
      padding: 5px 10px;
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-family: inherit;
      font-size: 11px;
      font-weight: 700;
      color: var(--ink-soft);
      cursor: pointer;
      transition: background-color 130ms, color 130ms, border-color 130ms, box-shadow 130ms, transform 130ms, opacity 130ms;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }
    .calc-aj-pk-toggle:hover {
      background: rgba(63, 100, 137,0.08);
      border-color: #3f6489;
      color: #5980a6;
    }
    .calc-aj-pk-toggle strong {
      color: #5980a6;
      font-size: 11.5px;
    }
    .calc-aj-pk-toggle small {
      color: var(--ink-faint);
      font-weight: 600;
      font-style: italic;
      font-size: 10px;
    }
    .calc-aj-pk-toggle-on {
      background: linear-gradient(135deg, #3f6489, #5980a6) !important;
      border-color: #5980a6 !important;
      color: white !important;
    }
    .calc-aj-pk-toggle-on strong { color: white !important; }
    .calc-aj-pk-row-on {
      background: rgba(63, 100, 137,0.04);
    }

    /* OVERLAY (clica fora pra fechar) */
    .calc-aj-pk-overlay {
      position: fixed;
      inset: 0;
      z-index: 145;
      background: transparent;
      cursor: default;
    }

    /* POPOVER ancorado ao botão */
    .calc-aj-pk-pop {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      width: 440px;
      max-width: calc(100vw - 60px);
      z-index: 150;
      background: var(--bg-elevated);
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      box-shadow: 0 12px 36px rgba(0,0,0,0.20);
      text-align: left;
      animation: pkPopIn 130ms ease-out;
    }
    @keyframes pkPopIn {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    /* "Seta" apontando pro botão */
    .calc-aj-pk-pop::before {
      content: '';
      position: absolute;
      top: -6px;
      right: 24px;
      width: 12px; height: 12px;
      background: var(--bg-elevated);
      border-top: 1px solid var(--border-strong);
      border-left: 1px solid var(--border-strong);
      transform: rotate(45deg);
    }
    .calc-aj-pk-pop-head {
      display: flex; justify-content: space-between; align-items: center;
      padding: 11px 14px 10px;
      background: linear-gradient(135deg, rgba(63, 100, 137,0.10), rgba(63, 100, 137,0.04));
      border-bottom: 1px solid var(--border);
      border-radius: 10px 10px 0 0;
    }
    .calc-aj-pk-pop-titulo {
      display: flex; align-items: baseline; gap: 6px;
      font-size: 13px;
      color: var(--ink);
    }
    .calc-aj-pk-pop-titulo strong {
      font-weight: 700;
      color: #6B5020;
    }
    .calc-aj-pk-pop-titulo small {
      font-size: 10.5px;
      color: var(--ink-faint);
      font-weight: 500;
    }
    .calc-aj-pk-pop-close {
      width: 22px; height: 22px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 5px;
      color: var(--ink-faint);
      font-size: 13px; font-weight: 700;
      cursor: pointer; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      transition: background-color 130ms, color 130ms, border-color 130ms, box-shadow 130ms, transform 130ms, opacity 130ms;
    }
    .calc-aj-pk-pop-close:hover {
      background: rgba(161, 86, 70,0.10);
      border-color: rgba(161, 86, 70,0.30);
      color: #a15646;
    }
    .calc-aj-pk-pop-body {
      padding: 12px 14px 14px;
    }

    .calc-aj-pk-pop-chips {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding: 8px;
      max-height: 200px;
      overflow-y: auto;
      background: var(--bg-sunken);
      border: 1px solid var(--border);
      border-radius: 7px;
    }
    .calc-aj-pk-pop-chips::-webkit-scrollbar { width: 6px; }
    .calc-aj-pk-pop-chips::-webkit-scrollbar-thumb { background: rgba(63, 100, 137,0.30); border-radius: 3px; }
    .calc-aj-pk-chip-vinculado {
      background: rgba(79, 138, 91,0.12);
      border-color: rgba(79, 138, 91,0.35);
      color: #2C4E37;
    }
    .calc-aj-pk-chip-vinculado .calc-aj-exc-chip-x {
      color: #2C4E37;
    }
    .calc-aj-pk-chip-vinculado .calc-aj-exc-chip-x:hover {
      background: #a15646;
      color: white;
    }
    .calc-aj-pk-pop-empty {
      padding: 10px 12px;
      background: var(--bg-sunken);
      border: 1px dashed var(--border);
      border-radius: 7px;
      font-size: 11.5px;
      color: var(--ink-faint);
      font-style: italic;
      text-align: center;
    }

    .calc-aj-pk-pop-detec {
      margin-top: 12px;
      padding: 8px 10px;
      background: var(--bg-sunken);
      border-left: 3px solid #3f6489;
      border-radius: 0 6px 6px 0;
    }
    .calc-aj-pk-detectados-titulo {
      display: block;
      font-size: 10.5px;
      font-weight: 600;
      color: var(--ink-soft);
      margin-bottom: 6px;
    }
    .calc-aj-pk-detectados-list {
      display: flex; flex-wrap: wrap; gap: 4px;
      max-height: 120px;
      overflow-y: auto;
    }
    .calc-aj-pk-chip-detec {
      display: inline-block;
      padding: 2px 8px;
      background: rgba(107,114,128,0.08);
      border: 1px dashed rgba(107,114,128,0.30);
      border-radius: 10px;
      font-size: 10.5px;
      color: var(--ink-soft);
    }

    .calc-aj-busca { width: 100%; box-sizing: border-box; padding: 8px 12px; margin-bottom: 10px; border: 1px solid var(--border); border-radius: 8px; font-family: inherit; font-size: 13px; background: var(--bg-elevated); }
    .calc-aj-busca:focus { outline: none; border-color: #3f6489; box-shadow: 0 0 0 3px rgba(63, 100, 137,0.15); }
    .calc-aj-lista { display: flex; flex-direction: column; gap: 6px; }
    .calc-aj-medico { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--bg-sunken); border-radius: 8px; gap: 12px; border: 1px solid transparent; }
    .calc-aj-medico-excl { opacity: 0.55; border-color: rgba(161, 86, 70,0.20); }
    .calc-aj-medico-info { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .calc-aj-medico-info strong { font-size: 12.5px; color: var(--ink); }
    .calc-aj-medico-info small { font-size: 10px; color: var(--ink-faint); font-family: var(--font-mono); }
    .calc-aj-medico-tipo { display: inline-block; font-size: 9.5px; font-weight: 700; padding: 1px 6px; border-radius: 3px; letter-spacing: 0.03em; text-transform: uppercase; width: fit-content; }
    .calc-aj-tipo-interno { background: rgba(63, 100, 137,0.15); color: #46688c; }
    .calc-aj-tipo-hibrido { background: rgba(63, 100, 137,0.18); color: #5980a6; }
    .calc-aj-tipo-externo { background: rgba(124,92,191,0.12); color: #7C5CBF; }
    .calc-aj-tipo-sem_tipo { background: rgba(107,114,128,0.12); color: #585d62; }
    .calc-aj-medico-acoes { display: flex; align-items: center; gap: 8px; }
    .calc-aj-override-tag { font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 3px; background: rgba(63, 100, 137,0.18); color: #5980a6; letter-spacing: 0.03em; text-transform: uppercase; }
    .calc-aj-toggle { display: flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer; color: var(--ink-soft); user-select: none; }
    .calc-aj-toggle input { margin: 0; }
    .calc-aj-reset { background: transparent; border: 1px solid var(--border); color: var(--ink-faint); width: 24px; height: 24px; border-radius: 5px; cursor: pointer; font-size: 12px; }
    .calc-aj-reset:hover { background: var(--bg-elevated); border-color: #3f6489; color: #46688c; }
    .calc-aj-vazio { padding: 24px; text-align: center; color: var(--ink-faint); font-size: 12px; font-style: italic; background: var(--bg-sunken); border-radius: 8px; }

    .calc-aj-footer { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-top: 1px solid var(--border); background: var(--bg-sunken); }
    .calc-aj-footer small { font-size: 11px; color: var(--ink-faint); }
    .calc-aj-aplicar { padding: 8px 16px; background: linear-gradient(135deg, #3f6489, #46688c); color: white; border: none; border-radius: 8px; font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
    .calc-aj-aplicar:hover { background: linear-gradient(135deg, #3f6489, #46688c); }

    .calc-vazio { padding: 60px 30px; text-align: center; background: var(--bg-elevated); border: 1px dashed var(--border); border-radius: 12px; }
    .calc-vazio-ico { font-size: 48px; color: #3f6489; margin-bottom: 10px; }
    .calc-vazio h3 { margin: 0 0 8px; color: var(--ink); }
    .calc-vazio p { margin: 0 auto 14px; max-width: 480px; font-size: 13px; color: var(--ink-soft); line-height: 1.5; }
    .calc-vazio-aviso { display: inline-block; padding: 8px 14px; background: rgba(63, 100, 137,0.12); color: #5980a6; border: 1px solid rgba(63, 100, 137,0.30); border-radius: 6px; font-size: 12px; font-weight: 600; }
    .calc-vazio-hint { font-size: 11px; color: var(--ink-faint); }

    .calc-kpis-3 { /* legado V131.10 — não usado */ }

    .calc-match-resumo { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding: 8px 12px; background: var(--bg-sunken); border-radius: 8px; flex-wrap: wrap; }
    .calc-match-resumo strong { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-soft); margin-right: 4px; }
    .calc-match-tag { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
    .calc-match-exato    { background: rgba(79, 138, 91,0.12);   color: #4f8a5b; }
    .calc-match-sinonimo { background: rgba(63, 100, 137,0.12);  color: #46688c; }
    .calc-match-similar  { background: rgba(63, 100, 137,0.15);  color: #5980a6; }
    .calc-match-tempo { font-size: 10px; color: var(--ink-faint); font-style: italic; margin-left: auto; }

    /* V218: aba Perfil Particular */
    .calc-pf-resumo { display: flex; align-items: center; gap: 14px; padding: 14px 16px; margin-bottom: 14px; border: 1px solid var(--border); border-radius: 10px; background: linear-gradient(135deg, rgba(63, 100, 137,0.10), rgba(89, 128, 166,0.06)); }
    .calc-pf-resumo-num { font-size: 30px; font-weight: 800; color: #5980a6; line-height: 1; }
    .calc-pf-resumo-txt { font-size: 12.5px; color: var(--ink-soft); line-height: 1.4; }
    .calc-pf-proc-vtag { font-size: 11.5px; font-weight: 700; color: #8A6A2E; margin-left: auto; margin-right: 8px; }
    .calc-pf-secao { padding: 14px; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 14px; background: var(--bg-sunken); }
    .calc-pf-titulo { margin: 0 0 10px; font-size: 13px; color: var(--ink); }
    .calc-pf-form { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
    .calc-pf-campo { display: flex; flex-direction: column; gap: 4px; }
    .calc-pf-campo-perfil { flex: 2; min-width: 200px; }
    .calc-pf-campo-tipo { max-width: 84px; }
    .calc-pf-label { font-size: 11px; color: var(--ink-faint); font-weight: 600; }
    .calc-pf-input { padding: 7px 10px; border: 1px solid var(--border); border-radius: 7px; font-family: inherit; font-size: 13px; background: #fff; color: var(--ink); }
    .calc-pf-salvar { padding: 8px 14px; background: linear-gradient(135deg, #3f6489, #46688c); color: #fff; border: none; border-radius: 8px; font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }
    .calc-pf-salvar:hover { filter: brightness(1.05); }
    .calc-pf-help { display: block; margin-top: 8px; font-size: 11.5px; color: var(--ink-faint); }
    .calc-pf-lista { display: flex; flex-direction: column; gap: 8px; }
    .calc-pf-card { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: #fff; }
    .calc-pf-card-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; gap: 10px; }
    .calc-pf-card-info { display: flex; flex-direction: column; gap: 2px; }
    .calc-pf-card-info strong { font-size: 13px; color: var(--ink); }
    .calc-pf-card-val { font-size: 12px; font-weight: 700; color: #46688c; }
    .calc-pf-card-val-conv { color: #8A6A2E; font-weight: 600; }
    .calc-pf-card-info small { font-size: 11px; color: var(--ink-faint); }
    .calc-pf-card-acoes { display: flex; gap: 6px; align-items: center; }
    .calc-pf-mini { padding: 5px 10px; background: var(--bg-sunken); border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 11.5px; cursor: pointer; color: var(--ink-soft); }
    .calc-pf-mini:hover { background: var(--border); }
    .calc-pf-del { background: transparent; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; padding: 4px 8px; }
    .calc-pf-del:hover { background: rgba(163,45,45,0.08); }
    .calc-pf-card-body { padding: 10px 12px; border-top: 1px solid var(--border); background: var(--bg-sunken); }
    .calc-pf-add-proc { display: flex; gap: 8px; margin-bottom: 8px; }
    /* V243: form de exceção (valor fixo OU tabela + multi-seleção) */
    .calc-pf-exc-form { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
    .calc-pf-exc-tipo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .calc-pf-tipo-btn { padding: 6px 12px; border: 1px solid var(--border, #eef0f2); border-radius: 7px; background: #fff; font-family: inherit; font-size: 12px; font-weight: 600; color: var(--ink-soft, #41544F); cursor: pointer; }
    .calc-pf-tipo-btn.calc-pf-tipo-ativa { background: var(--primary, #5980a6); border-color: var(--primary, #5980a6); color: #fff; }
    .calc-pf-exc-valor { max-width: 130px; }
    .calc-pf-exc-tab { max-width: 150px; }
    .calc-pf-exc-multi { width: 100%; min-height: 132px; padding: 4px; box-sizing: border-box; }
    .calc-pf-exc-multi option { padding: 4px 6px; border-radius: 4px; }
    .calc-pf-exc-acoes { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .calc-pf-proc-vtag-valor { color: var(--primary, #5980a6); }
    .calc-pf-add-proc .calc-pf-input { flex: 1; }
    .calc-pf-proc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .calc-pf-proc-list li { display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; background: #fff; border: 1px solid var(--border); border-radius: 6px; font-size: 12.5px; }
    .calc-pf-proc-x { background: transparent; border: none; color: #a15646; font-size: 16px; cursor: pointer; line-height: 1; padding: 0 4px; }

    .calc-toolbar { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; flex-wrap: wrap; }
    .calc-busca { flex: 1; min-width: 240px; max-width: 420px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-family: inherit; font-size: 13px; background: var(--bg-elevated); }
    .calc-busca:focus { outline: none; border-color: #3f6489; box-shadow: 0 0 0 3px rgba(63, 100, 137,0.15); }
    .calc-filtro-status { display: flex; gap: 4px; }
    .calc-filtro-btn { padding: 6px 12px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 11.5px; font-weight: 600; color: var(--ink-soft); cursor: pointer; }
    .calc-filtro-btn:hover { background: var(--bg-sunken); }
    .calc-filtro-ativo { background: #3f6489; color: white; border-color: #3f6489; }
    .calc-filtro-ativo:hover { background: #46688c; }

    .calc-tabela-wrap { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 12px; overflow: auto; box-shadow: 0 4px 14px rgba(29, 31, 32,0.08); max-height: 65vh; }
    .calc-tabela { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 1100px; }
    .calc-tabela thead th { position: sticky; top: 0; z-index: 1; background: #3a5877; padding: 10px 12px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #FFFFFF; border-bottom: 2px solid #3a5877; text-align: left; }
    .calc-tabela thead th.num { text-align: right; }
    .calc-tabela tbody td { padding: 9px 12px; border-bottom: 1px solid var(--border-soft); vertical-align: top; }
    .calc-tabela tbody tr:hover td { background: var(--bg-sunken); }
    .num { text-align: right; white-space: nowrap; }   /* V941: valor nunca quebra em 2 linhas */
    .mono { font-family: var(--font-mono); }
    .calc-th-cod, .calc-td-cod { width: 90px; font-size: 11px; color: var(--ink-faint); }
    .calc-st-ok   .calc-td-status { color: #4f8a5b; font-weight: 700; }
    .calc-st-warn .calc-td-status { color: #5980a6; font-weight: 700; }
    .calc-st-erro .calc-td-status { color: #a15646; font-weight: 700; }
    .calc-st-warn td { background: rgba(63, 100, 137,0.04); }
    .calc-st-erro td { background: rgba(161, 86, 70,0.05); }
    .calc-papel { font-size: 10.5px; font-weight: 600; color: var(--ink-faint); background: var(--bg-sunken); padding: 1px 6px; border-radius: 4px; }
    .calc-td-proc { max-width: 360px; }
    .calc-proc-nome { font-weight: 500; color: var(--ink); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .calc-proc-oficial { font-size: 10.5px; color: #46688c; margin-top: 2px; }
    .calc-motivo { font-size: 10.5px; color: #5980a6; margin-top: 3px; font-style: italic; }
    .calc-td-repasse { color: #3f6489; font-weight: 700; }   /* V964: cor global do repasse (style.css) */
    .calc-bdg { font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px; letter-spacing: 0.04em; text-transform: uppercase; }
    .calc-bdg-sin { background: rgba(63, 100, 137,0.15); color: #46688c; }
    .calc-bdg-sim { background: rgba(63, 100, 137,0.18); color: #5980a6; }
    .calc-bdg-tok { background: rgba(124,92,191,0.15); color: #7C5CBF; }
    .calc-bdg-perfil { background: rgba(184,150,90,0.18); color: #8A6A2E; text-transform: none; letter-spacing: 0; }

    /* V131.26: linha "fora do escopo" no breakdown — cinza discreto, indica linhas filtradas pela regra geral */
    .calc-kpi-fora {
      color: var(--ink-faint);
      font-size: 10px;
      font-style: italic;
      margin-top: 2px;
      opacity: 0.85;
    }

    /* V131.20: botão (+) compacto, só símbolo teal (sem círculo) — inline junto ao texto */
    .calc-add-proc {
      display: inline;
      color: #46688c;
      font-weight: 800;
      font-size: 15px;
      cursor: pointer;
      transition: color 130ms;
      user-select: none;
    }
    .calc-add-proc:hover {
      color: #3f6489;
      text-decoration: none;
    }
    .calc-add-proc:focus { outline: 2px solid #3f6489; outline-offset: 1px; border-radius: 3px; }

    /* V131.19: Modal de cadastro de procedimento */
    .calc-cp-overlay {
      position: fixed; inset: 0; z-index: 99;
      background: rgba(29, 31, 32,0.55);
      
    }
    .calc-cp-modal {
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      z-index: 100;
      width: min(640px, 94vw); max-height: 88vh;
      background: var(--bg-elevated);
      border-radius: 14px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.30);
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    .calc-cp-head {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 20px; border-bottom: 1px solid var(--border);
      background: var(--bg-sunken);
    }
    .calc-cp-head h3 { margin: 0; font-size: 15px; color: var(--ink); }
    .calc-cp-fechar {
      background: transparent; border: 1px solid var(--border);
      border-radius: 6px; width: 28px; height: 28px;
      font-size: 14px; cursor: pointer; color: var(--ink-faint);
    }
    .calc-cp-fechar:hover { background: var(--bg-elevated); color: var(--ink); }
    .calc-cp-body {
      padding: 18px 20px; overflow-y: auto; flex: 1; min-height: 0;
    }
    .calc-cp-label {
      display: block; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--ink-faint); margin-bottom: 5px;
    }
    .calc-cp-nome {
      width: 100%; box-sizing: border-box;
      padding: 10px 12px; margin-bottom: 12px;
      border: 1px solid var(--border); border-radius: 8px;
      font-family: inherit; font-size: 13px; font-weight: 600;
      background: var(--bg-elevated); color: var(--ink);
    }
    .calc-cp-nome:focus {
      outline: none; border-color: #3f6489;
      box-shadow: 0 0 0 3px rgba(63, 100, 137,0.15);
    }
    .calc-cp-help {
      font-size: 11px; color: var(--ink-soft);
      background: rgba(63, 100, 137,0.06);
      border: 1px solid rgba(63, 100, 137,0.18);
      padding: 8px 10px; border-radius: 6px;
      margin: 0 0 14px; line-height: 1.5;
    }
    .calc-cp-secao {
      margin-bottom: 10px;
      border: 1px solid var(--border); border-radius: 8px;
      overflow: hidden;
    }
    .calc-cp-secao-head {
      padding: 7px 12px;
      background: rgba(63, 100, 137,0.08);
      font-size: 10.5px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.06em;
      color: #46688c;
      border-bottom: 1px solid var(--border);
    }
    .calc-cp-tabela {
      width: 100%; border-collapse: collapse;
    }
    .calc-cp-tabela th {
      padding: 5px 10px; text-align: left;
      font-size: 9.5px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--ink-faint);
      border-bottom: 1px solid var(--border);
      background: var(--bg-sunken);
    }
    .calc-cp-tabela td {
      padding: 5px 10px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
    }
    .calc-cp-tabela tr:last-child td { border-bottom: none; }
    .calc-cp-input, .calc-cp-tipo {
      padding: 5px 8px; border: 1px solid var(--border);
      border-radius: 6px; background: var(--bg-elevated);
      font-family: inherit; font-size: 12px;
      color: var(--ink);
    }
    .calc-cp-input { width: 100px; text-align: right; font-family: var(--font-mono); }
    .calc-cp-tipo { width: 56px; cursor: pointer; }
    .calc-cp-input:focus, .calc-cp-tipo:focus {
      outline: none; border-color: #3f6489;
      box-shadow: 0 0 0 2px rgba(63, 100, 137,0.18);
    }
    .calc-cp-footer {
      display: flex; justify-content: flex-end; gap: 8px;
      padding: 12px 20px;
      border-top: 1px solid var(--border);
      background: var(--bg-sunken);
    }
    .calc-cp-cancelar {
      padding: 8px 16px;
      background: transparent; color: var(--ink-soft);
      border: 1px solid var(--border); border-radius: 8px;
      font-family: inherit; font-size: 12px; font-weight: 600;
      cursor: pointer;
    }
    .calc-cp-cancelar:hover { background: var(--bg-elevated); color: var(--ink); }
    .calc-cp-salvar {
      padding: 8px 18px;
      background: linear-gradient(135deg, #3f6489, #46688c);
      color: white; border: none; border-radius: 8px;
      font-family: inherit; font-size: 12px; font-weight: 700;
      cursor: pointer;
    }
    .calc-cp-salvar:hover {
      background: linear-gradient(135deg, #3f6489, #46688c);
      box-shadow: 0 4px 12px rgba(63, 100, 137,0.30);
    }
    .calc-vazio-tabela { padding: 30px; text-align: center; color: var(--ink-faint); font-style: italic; }

    .calc-truncado { margin-top: 8px; padding: 8px 12px; background: rgba(63, 100, 137,0.06); border: 1px solid rgba(63, 100, 137,0.18); border-radius: 6px; font-size: 11.5px; color: var(--ink-soft); }

    @media (max-width: 1100px) { .calc-toolbar { flex-direction: column; align-items: stretch; } }
  `;

  render();
};
