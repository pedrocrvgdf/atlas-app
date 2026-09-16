/**
 * ============================================================================
 * BANCO DE DADOS - SQLite no navegador (sql.js) com persistência em IndexedDB
 * ============================================================================
 *
 * Como funciona:
 *   - sql.js carrega o SQLite compilado em WebAssembly
 *   - O banco fica em memória durante a sessão
 *   - Salvamos snapshots no IndexedDB para persistir entre sessões
 *   - Usuário pode exportar/importar arquivos .db para backup
 *
 * Por que IndexedDB e não localStorage?
 *   - localStorage tem limite de ~5MB e armazena só strings
 *   - IndexedDB aceita binário (BLOB) e tem GB de espaço
 */

const Banco = {
  db: null,           // Instância SQL.Database (em memória)
  SQL: null,          // Módulo sql.js carregado

  // --- Configuração IndexedDB ---
  IDB_NAME: 'repasse_medico',
  IDB_VERSION: 1,
  IDB_STORE: 'sqlite_db',
  IDB_KEY: 'banco_principal',
  IDB_KEY_FOTOS: 'fotos_calculo',   // V613: cofre próprio das fotos (~0,1 MB)

  // ==========================================================================
  // INICIALIZAÇÃO
  // ==========================================================================

  /**
   * Carrega sql.js (WASM), abre banco existente do IndexedDB ou cria novo.
   * Deve ser chamado UMA VEZ no início do app.
   */
  /** V832: texto da tela de carregamento inicial (progresso real do boot) */
  _msgBoot(txt) {
    try {
      const el = document.querySelector('#app-loading-overlay .message')
        || document.querySelector('.loading-overlay .message');
      if (el) el.textContent = txt;
    } catch (_) {}
  },
  /** V832: rastro persistente do boot — se a abertura for abandonada no meio,
   *  a PRÓXIMA sessão sabe exatamente em que fase parou */
  _traceBoot(fase, extra) {
    try { localStorage.setItem('boot_trace_v1', JSON.stringify({ fase, extra: extra || null, ts: Date.now() })); }
    catch (_) {}
  },

  async inicializar() {
    if (this.db) return; // já inicializado

    /**
     * V835: o sistema está aberto em OUTRA janela/aba do mesmo perfil? Duas
     * janelas salvando o mesmo banco rasgam a leitura das fatias (foi a causa
     * do "fatia N ausente ou com tamanho errado"). O detector acende o aviso
     * na hora e a Administração repete.
     */
    try {
      this._bcInst = new BroadcastChannel('atlas_instancia_v1');
      this._bcInst.onmessage = (e) => {
        const d = e && e.data;
        if (d === 'ping') { try { this._bcInst.postMessage('pong'); } catch (_) {} }
        else if (d === 'pong' && !this._outraJanela) {
          this._outraJanela = true;
          console.warn('[banco] o sistema está aberto em OUTRA janela — feche uma delas (risco de erro de leitura/salvamento)');
          try { window.Utilidades?.toast?.('⚠ O sistema está aberto em OUTRA janela — feche uma delas para evitar erro de leitura do banco.', 'warning', 9000); } catch (_) {}
        }
      };
      this._bcInst.postMessage('ping');
      setInterval(() => { try { this._bcInst.postMessage('ping'); } catch (_) {} }, 30000);
    } catch (_) {}

    // V832: a abertura anterior terminou? (rastro fica em 'ok' quando termina)
    try {
      const ant = JSON.parse(localStorage.getItem('boot_trace_v1') || 'null');
      if (ant && ant.fase && ant.fase !== 'ok') {
        this._bootAbortadoAnterior = ant;
        console.warn('[banco] a ABERTURA ANTERIOR não terminou — parou em:', ant.fase, ant.extra || '');
      }
    } catch (_) {}
    this._traceBoot('carregar-wasm');

    // 1) Carrega o módulo sql.js
    if (typeof initSqlJs === 'undefined') {
      throw new Error('sql.js não carregado. Verifique <script> no HTML.');
    }

    // V493: WASM local — nada mais vem de CDN. Preferência: binário embutido
    // em base64 (libs/sql-wasm-b64.js), que funciona inclusive abrindo o app
    // via duplo clique (file://, onde fetch de arquivo local é bloqueado).
    // Fallback: libs/sql-wasm.wasm via fetch (funciona servido por http).
    const cfgSql = {};
    if (window.__SQL_WASM_B64) {
      const b64 = window.__SQL_WASM_B64;
      const bin = new Uint8Array(atob(b64).split('').map(c => c.charCodeAt(0)));
      cfgSql.wasmBinary = bin;
      window.__SQL_WASM_B64 = null;   // libera a string grande da memória
    } else {
      cfgSql.locateFile = file => `libs/${file}`;
    }
    this.SQL = await initSqlJs(cfgSql);

    // 2) Tenta restaurar banco do IndexedDB
    // V830: a ABERTURA ganha cronômetro próprio (ler IDB × abrir no WASM) —
    // a Administração mostra, e o diagnóstico de "carregamento lento" deixa
    // de ser adivinhação
    const t0Boot = performance.now();
    this._traceBoot('ler-idb');
    this._msgBoot('Abrindo o banco…');
    let bytesExistentes;
    try {
      bytesExistentes = await this._lerDoIndexedDB();
    } catch (e) {
      /**
       * V837: AUTO-RECUPERAÇÃO — a cópia interna (IndexedDB) falhou na
       * montagem. Antes de mostrar qualquer erro, a ferramenta tenta
       * restaurar SOZINHA a partir do arquivo vinculado (.db), sem nenhuma
       * interação. Só se não houver vínculo/permissão é que a tela de erro
       * aparece (e lá o botão usa o mesmo caminho, com um clique).
       */
      console.error('[banco] leitura da cópia interna falhou:', e);
      /**
       * V839: a auto-recuperação SÓ roda quando a cópia interna está de fato
       * quebrada e SOZINHA. Se a falha veio de outra janela ATIVA salvando
       * (o manifesto mudava a cada tentativa), o IndexedDB provavelmente está
       * ÍNTEGRO e MAIS NOVO que o arquivo .db — restaurar aqui regressaria o
       * banco no tempo. Nesse caso o erro sobe com a instrução certa.
       */
      if (e.outraJanelaAtiva || this._outraJanela) {
        this._traceBoot('erro-outra-janela');
        e.message = (e.message || '') + ' O sistema está aberto em OUTRA janela — feche-a e recarregue (F5). '
          + 'A restauração automática foi suspensa de propósito para não voltar o banco no tempo.';
        throw e;
      }
      this._traceBoot('auto-recuperacao');
      this._msgBoot('Problema na cópia interna — recuperando da cópia automática (.db)…');
      bytesExistentes = await this._tentarAutoRecuperacao();
      if (!bytesExistentes) throw e;
    }
    // V839: IndexedDB VAZIO mas existe espelho .db vinculado com permissão?
    // Perfil que perdeu o storage não pode virar "primeiro uso" silencioso —
    // a cura do espelho regravaria o .db cheio com um banco vazio.
    if (!bytesExistentes) {
      const doEspelho = await this._tentarAutoRecuperacao();
      if (doEspelho) bytesExistentes = doEspelho;
    }
    // época da sessão (arbitragem de intenção entre janelas — V839)
    try { this._epoca = Number(await this._lerChaveIDB('banco_epoca')) || 0; } catch (_) { this._epoca = 0; }
    const tLer = performance.now() - t0Boot;

    if (bytesExistentes) {
      // V827: banco de ~1GB — cada cópia inteira conta. O construtor do
      // sql.js já copia os bytes para o heap WASM; embrulhar em
      // new Uint8Array(...) duplicava o banco INTEIRO mais uma vez e, no pico
      // do boot, derrubava máquina justa de memória ("Out of Memory" ao
      // abrir). Passa direto quando já é Uint8Array e solta a referência JS
      // assim que o WASM tem a cópia dele.
      const tamRestaurado = bytesExistentes.byteLength || bytesExistentes.length || 0;
      const t1Boot = performance.now();
      this._traceBoot('abrir-motor');
      this._msgBoot('Preparando o banco…');
      this.db = new this.SQL.Database(
        bytesExistentes instanceof Uint8Array ? bytesExistentes : new Uint8Array(bytesExistentes));
      bytesExistentes = null;
      this._fasesBoot = { ler: tLer, abrir: performance.now() - t1Boot,
        total: performance.now() - t0Boot, tam: tamRestaurado };
      console.log(`✓ Abertura do banco: ler IDB ${(tLer / 1000).toFixed(1)}s · abrir ${((performance.now() - t1Boot) / 1000).toFixed(1)}s · ${(tamRestaurado / 1048576).toFixed(0)}MB`);

      // V659: referência do skip V644 ANTES das migrações — se elas não
      // escreverem nada (boot de rotina: CREATE IF NOT EXISTS + INSERT OR
      // IGNORE sem efeito), o salvar() da migração pula o export completo
      // (~900MB) que rodava em TODO início de sessão. DDL real bumpa
      // schema_version e escrita real conta em total_changes — os dois furam
      // o skip e o export acontece normalmente.
      this._carimboExportado = this._carimboEscrita();
      this._ultimoExportTam = tamRestaurado;

      // ── Pré-migração: drop forçado de linhas_qvis antiga ────────────
      // A tabela linhas_qvis foi redefinida com 33 colunas + competência.
      // Se versão antiga existir (sem `competencia`), removemos ANTES de
      // executar SCHEMA_SQL pra garantir que será recriada corretamente.
      try {
        const colsResult = this.db.exec(`PRAGMA table_info(linhas_qvis)`);
        if (colsResult.length > 0) {
          const colNames = colsResult[0].values.map(r => r[1]);
          if (!colNames.includes('competencia')) {
            console.log('Pre-migração: drop linhas_qvis antiga (' + colNames.length + ' colunas, sem `competencia`)');
            this.db.exec(`DROP TABLE IF EXISTS linhas_qvis`);
          }
        }
      } catch (e) {
        console.warn('Pre-migração linhas_qvis falhou (ignorando):', e.message);
      }

      // Migração: garante que tabelas e seeds novos sejam aplicados
      // (CREATE TABLE IF NOT EXISTS e INSERT OR IGNORE são seguros)
      this._traceBoot('migracoes');
      try {
        this.db.exec(window.SCHEMA_SQL);
        this.db.exec(window.SEEDS_SQL);
        this._migrarColunas();
        await this.salvar({ imediato: true });   // V659: cai no skip V644 em boot de rotina
      } catch (e) {
        console.warn('Migração parcial:', e);
      }
      console.log('✓ Banco restaurado do IndexedDB (com migrações)');
    } else {
      // Primeiro uso: cria do zero
      this.db = new this.SQL.Database();
      this.db.exec(window.SCHEMA_SQL);
      this.db.exec(window.SEEDS_SQL);
      await this.salvar({ imediato: true });
      console.log('✓ Banco novo criado com schema e seeds');
    }

    // 3) Garantia explícita: tabela linhas_qvis tem que existir com
    // a estrutura correta. Em alguns casos o SCHEMA_SQL anterior pode
    // falhar silenciosamente nesse CREATE específico (ordem dos statements,
    // FK quebrada, etc), então recriamos aqui inline se necessário.
    // V613: fotos de cálculo voltam do cofre próprio (podem ser mais novas
    // que a cópia dentro do banco — fingerprint garante que foto velha não vale)
    await this._restaurarFotosDoIDB();

    this._garantirEstruturas();
    // V839: se as garantias acima (ou a restauração das fotos) ESCREVERAM
    // algo, o skip V644 já não vale — sem isto, o PRIMEIRO gesto do usuário
    // pagaria o export completo (~900MB, tela presa). Persiste em 2º plano
    // agora, com a tela já livre.
    if (this.db && this._carimboEscrita() !== this._carimboExportado) this.salvarDebounced(2500);
    this._conferirVersaoDoPacote();   // V858
    this._traceBoot('ok');   // V832: abertura completa — o rastro fecha limpo
  },

  /**
   * V858: O BANCO CARIMBA A VERSÃO QUE O USOU. A ferramenta roda em duas
   * máquinas e o arquivo .db passa de uma para a outra. Se o Matheus abrir,
   * num pacote ANTIGO, um banco que o Pedro já usou num pacote mais NOVO, ele
   * veria telas e números diferentes sem nenhuma pista do motivo — foi
   * exatamente o que aconteceu. Agora:
   *  · o banco guarda a maior versão que já o abriu (APP_VERSAO_MAIOR);
   *  · abrir com um pacote mais ATRASADO que isso dá um aviso claro;
   *  · o carimbo só é gravado quando MUDA (boot de rotina não escreve nada,
   *    para não derrubar os caches nem pagar export — ver V857).
   * Falha aqui nunca impede a abertura: é aviso, não trava.
   */
  /**
   * V858: tudo que garante que o banco ABERTO tem a estrutura que ESTE pacote
   * espera. Ficava solto no boot; virou método porque a importação de um .db
   * (o caminho do Matheus recebendo o arquivo do Pedro) precisa do mesmo
   * tratamento — sem isso, um .db exportado por um pacote mais antigo entrava
   * sem as tabelas novas e as telas que dependem delas ficavam vazias, em
   * silêncio, até o próximo F5.
   */
  _garantirEstruturas() {
    this._garantirTabelaQVIS();
    this._garantirTabelaConfigLP();
    this._garantirTabelaConfigCrosslink();
    this._garantirTabelaConfigRefractive();
    this._garantirTabelaQVISStats();
    this._garantirTabelasPeriodos();
    this._garantirTabelasFellow();
    this._garantirTabelasNotas();
    this._garantirNomesIgnoradosESituacional();
    this._garantirTabelasFracionamento();
    this._garantirTabelaOpmePagamentos();
    this._garantirTabelasLio();
    this._normalizarEspacosQVIS();
    this._limparSeedAntigo();
    this._garantirTabelasUnidadesRegras();   // V938
  },

  // V938: Ajuste Unidades — só o que difere do padrão é gravado
  _garantirTabelasUnidadesRegras() {
    try {
      this.db.exec(`CREATE TABLE IF NOT EXISTS unidades_regras (
        unidade TEXT NOT NULL, proc TEXT NOT NULL, fonte TEXT NOT NULL, paga INTEGER NOT NULL DEFAULT 1,
        atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (unidade, proc, fonte))`);
      this.db.exec(`CREATE TABLE IF NOT EXISTS unidades_proc_categoria (
        proc TEXT PRIMARY KEY, categoria TEXT NOT NULL, atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);
    } catch (e) { console.warn('[banco] unidades_regras:', e); }
  },

  _conferirVersaoDoPacote() {
    try {
      if (!this.db) return;
      const atual = Number((window.ATLAS_VERSAO || {}).numero) || 0;
      if (!atual) return;
      this.db.exec(`CREATE TABLE IF NOT EXISTS config_sistema (chave TEXT PRIMARY KEY, valor TEXT)`);
      const r = this.queryUnica(`SELECT valor FROM config_sistema WHERE chave = 'APP_VERSAO_MAIOR'`);
      const maior = Number(r && r.valor) || 0;
      this._versaoBancoMaior = maior;
      this._versaoAtrasada = maior > atual ? maior : 0;
      // o aviso de verdade é o carimbo FIXO no rodapé do menu: um toast some
      // sozinho e, no boot, nasce atrás da tela de login (V858)
      try { window.App?.pintarVersao?.(); } catch (_) {}
      if (maior > atual) {
        console.warn(`[banco] este banco já foi usado na versão versão ${maior}; este pacote é o versão ${atual}`);
        try {
          window.Utilidades?.toast?.(
            `Atenção: este banco já foi usado numa versão MAIS NOVA da ferramenta `
            + `(versão ${maior}). Você está no versão ${atual} — peça o pacote atualizado `
            + `antes de trabalhar, para não usar regras antigas.`, 'error', 15000);
        } catch (_) {}
        return;   // não rebaixa o carimbo
      }
      if (maior < atual) {
        this.executar(`INSERT OR REPLACE INTO config_sistema (chave, valor) VALUES ('APP_VERSAO_MAIOR', ?)`,
          [String(atual)]);
        this.salvarDebounced(4000);
      }
    } catch (e) { console.warn('[banco] carimbo de versão:', e); }
  },

  /**
   * V18 — De-Para de Nomes:
   *  - Tabela `nomes_ignorados`: nomes do relatório de produção marcados
   *    explicitamente como ignorados (não vinculam a nenhum médico).
   *  - Coluna `situacional` em `medicos`: flag para externos pontuais
   *    (ex: anestesistas que aparecem só esporadicamente).
   */
  _garantirNomesIgnoradosESituacional() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS nomes_ignorados (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          grafia              TEXT NOT NULL,
          grafia_normalizada  TEXT NOT NULL UNIQUE,
          criado_em           TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ignorados_norm ON nomes_ignorados(grafia_normalizada)`);
      // Migração defensiva: adiciona coluna situacional se ainda não existir
      try {
        this.db.exec(`ALTER TABLE medicos ADD COLUMN situacional INTEGER NOT NULL DEFAULT 0`);
      } catch (e) { /* coluna já existe */ }
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_medicos_situacional ON medicos(situacional)`);
    } catch (e) {
      console.error('Erro criando nomes_ignorados / situacional:', e);
    }
  },

  /**
   * V20 — Módulo Fracionamento de Injeções Intra-Vítreas
   *
   * Semântica da regra de pagamento:
   *   REPASSE (médico) = FRACIONAMENTO BRUTO (ATLAS recebe) − VALOR FIXO (retido)
   *
   * Exemplo concreto (1ª aplicação em frasco individual):
   *   Fracionamento bruto: R$ 868,52  (o ATLAS recebe do convênio)
   *   – Valor fixo:        R$ 418,52  (procedimento cirúrgico, retido)
   *   = Repasse médico:    R$ 450,00
   *
   * Tabelas criadas:
   *   - config_fracionamento: parâmetros (key-value, padrão config_luz_pulsada)
   *   - fracionamento_frascos: 1 linha por frasco identificado por cor
   *   - fracionamento_aplicacoes: 1 linha por aplicação individual
   *
   * Defaults validados contra abril/2026:
   *   - VALOR_FIXO (retido): R$ 418,52
   *   - REPASSE por posição: R$ 450 (1ª) / 550 (2ª) / 700 (3ª) / 900 (4ª)
   *   - Compartilhado entre médicos: rateio igual = média dos valores acima
   *   - Particulares: NÃO usam essa regra (regra padrão 27%)
   */
  _garantirTabelasFracionamento() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS config_fracionamento (
          chave         TEXT PRIMARY KEY,
          valor         TEXT NOT NULL,
          atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // Defaults da regra. Armazenamos o FRACIONAMENTO BRUTO (o que o ATLAS
      // recebe). O repasse ao médico é calculado: bruto - valor fixo.
      this.db.exec(`
        INSERT OR IGNORE INTO config_fracionamento (chave, valor) VALUES
          ('VALOR_FIXO',             '418.52'),
          ('VALOR_BRUTO_POS1',       '868.52'),
          ('VALOR_BRUTO_POS2',       '968.52'),
          ('VALOR_BRUTO_POS3',       '1118.52'),
          ('VALOR_BRUTO_POS4',       '1318.52'),
          ('VALOR_BRUTO_COMPART_2',  '918.52'),
          ('VALOR_BRUTO_COMPART_3',  '985.18'),
          ('VALOR_BRUTO_COMPART_4',  '1068.52'),
          ('PCT_PARTICULAR',         '27.00')
      `);
      // Migração defensiva: remove chaves antigas (V20 inicial armazenava
      // o REPASSE em VALOR_POS{N} e VALOR_COMPART_{N}; agora migramos pra
      // VALOR_BRUTO_POS{N} e VALOR_BRUTO_COMPART_{N} com defaults brutos).
      this.db.exec(`
        DELETE FROM config_fracionamento WHERE chave IN (
          'VALOR_PROCEDIMENTO',
          'VALOR_POS1', 'VALOR_POS2', 'VALOR_POS3', 'VALOR_POS4',
          'VALOR_COMPART_2', 'VALOR_COMPART_3', 'VALOR_COMPART_4'
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS fracionamento_frascos (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          mes_ref           TEXT NOT NULL,
          data_frasco       TEXT,
          medicamento       TEXT,                 -- EYLIA 2MG | EYLIA 8MG
          cor_hex           TEXT,                 -- chave do agrupamento na origem
          total_aplicacoes  INTEGER NOT NULL,     -- 2, 3 ou 4
          compartilhado     INTEGER NOT NULL DEFAULT 0,  -- 0 individual, 1 múltiplos médicos
          origem            TEXT,
          importado_em      TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_frascos_mes ON fracionamento_frascos(mes_ref)`);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS fracionamento_aplicacoes (
          id                       INTEGER PRIMARY KEY AUTOINCREMENT,
          frasco_id                INTEGER,            -- NULL para particulares
          mes_ref                  TEXT NOT NULL,
          admissao                 TEXT,
          data_aplicacao           TEXT NOT NULL,
          paciente                 TEXT NOT NULL,
          medico_nome              TEXT NOT NULL,      -- nome do relatório (cru)
          medico_norm              TEXT NOT NULL,      -- normalizado p/ matching
          medico_id                INTEGER,            -- FK opcional pra medicos
          convenio                 TEXT,
          observacao               TEXT,               -- EYLIA 2MG / VABYSMO (técnica)
          posicao_no_frasco        INTEGER,            -- 1..4. NULL p/ particulares
          eh_particular            INTEGER NOT NULL DEFAULT 0,
          -- Valores (semântica de SUBTRAÇÃO):
          valor_fracionamento      REAL NOT NULL DEFAULT 0,  -- o ATLAS recebe (bruto)
          valor_fixo               REAL NOT NULL DEFAULT 0,  -- retido pelo ATLAS (procedimento)
          valor_repasse            REAL NOT NULL DEFAULT 0,  -- vai pro médico = bruto - fixo
          valor_repasse_manual     REAL,                     -- override do repasse
          origem                   TEXT,
          importado_em             TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (frasco_id) REFERENCES fracionamento_frascos(id) ON DELETE CASCADE,
          FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE SET NULL
        )
      `);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_frac_apl_mes ON fracionamento_aplicacoes(mes_ref)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_frac_apl_med ON fracionamento_aplicacoes(medico_norm)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_frac_apl_frasco ON fracionamento_aplicacoes(frasco_id)`);
      // Migração defensiva: coluna valor_origem registra de onde veio o valor
      // dos particulares ('QVIS' | 'PRODUCAO' | 'SEM_VALOR' | NULL p/ convênio).
      try {
        this.db.exec(`ALTER TABLE fracionamento_aplicacoes ADD COLUMN valor_origem TEXT`);
      } catch (e) { /* coluna já existe */ }
    } catch (e) {
      console.error('Erro criando tabelas de fracionamento:', e);
    }
  },

  /**
   * OPME — tabelas relacionadas ao módulo OPME:
   *   - opme_pagamentos:        admissões marcadas como pagas (por relatório)
   *   - config_opme:            chave/valor (PCT_GERAL etc.)
   *   - opme_termos_elegiveis:  lista de termos pra filtrar produto OPME
   *   - opme_regra_medico:      regras específicas de % por profissional
   *   - opme_produtos_excluidos: blacklist de produtos por nome
   *
   * V37: a chave de pagamento mudou de (admissao, competencia) para
   * (admissao, codigo_relatorio). Cada importação QVIS gera um código
   * único de relatório (em qvis_snapshot_stats); a duplicidade é detectada
   * quando a mesma admissão aparece em codigos_relatorio diferentes.
   * A data de pagamento agora é sempre atribuída automaticamente como
   * a data corrente (CURRENT_DATE) ao marcar a check box.
   */
  _garantirTabelaOpmePagamentos() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS opme_pagamentos (
          admissao          TEXT NOT NULL,
          codigo_relatorio  TEXT NOT NULL,
          competencia       TEXT,           -- YYYY-MM da linha qvis (auditoria)
          data_admissao    TEXT,            -- snapshot da data de admissão (auditoria)
          data_pagamento    TEXT NOT NULL,  -- sempre = data corrente ao marcar
          observacao        TEXT,
          criado_em         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (admissao, codigo_relatorio)
        );
        CREATE INDEX IF NOT EXISTS idx_opme_pag_admissao ON opme_pagamentos(admissao);
        CREATE INDEX IF NOT EXISTS idx_opme_pag_data ON opme_pagamentos(data_pagamento);

        CREATE TABLE IF NOT EXISTS config_opme (
          chave TEXT PRIMARY KEY,
          valor TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS lembretes (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          categoria TEXT NOT NULL DEFAULT 'Importante',
          titulo    TEXT NOT NULL,
          descricao TEXT,
          data      TEXT,                -- YYYY-MM-DD escolhida pelo usuário
          criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS opme_termos_elegiveis (
          termo  TEXT PRIMARY KEY,
          ativo  INTEGER NOT NULL DEFAULT 1,
          pct    REAL              -- % de repasse deste OPME (NULL = usa a regra geral)
        );

        CREATE TABLE IF NOT EXISTS opme_regra_medico (
          nome_normalizado TEXT PRIMARY KEY,
          nome_exibicao    TEXT NOT NULL,
          pct              REAL NOT NULL,
          criado_em        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        /* V663: regra específica por PRODUTO e por PAPEL (switch — nascem
           INATIVAS; ativação em config_opme REGRA_PRODUTO_ATIVA/REGRA_PAPEL_ATIVA) */
        CREATE TABLE IF NOT EXISTS opme_regra_produto (
          produto_normalizado TEXT PRIMARY KEY,
          produto_exibicao    TEXT NOT NULL,
          pct                 REAL NOT NULL,
          criado_em           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS opme_regra_papel (
          papel_normalizado   TEXT NOT NULL,
          papel_exibicao      TEXT NOT NULL,
          produto_normalizado TEXT NOT NULL DEFAULT '',   -- '' = qualquer produto
          produto_exibicao    TEXT,
          pct                 REAL NOT NULL,
          criado_em           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (papel_normalizado, produto_normalizado)
        );

        CREATE TABLE IF NOT EXISTS opme_produtos_excluidos (
          produto      TEXT PRIMARY KEY,
          excluido_em  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        /* V661: linha do Relatório QVIS com valor FIXO casado onde o usuário
           escolheu repassar pelo VALOR REAL (produzido) em vez do ajustado.
           Chave: admissao|produto_normalizado. */
        CREATE TABLE IF NOT EXISTS opme_usar_real (
          chave      TEXT PRIMARY KEY,
          criado_em  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        /* V897: o AJUSTE de valor fixo virou OPT-IN — a linha do Relatório
           QVIS mostra o valor REAL com a sugestão "ajustar"; só depois do
           clique o valor fixado passa a valer. Aqui ficam as linhas ACEITAS.
           Chave: admissao|produto_normalizado. (opme_usar_real ficou obsoleta
           — o real agora é o padrão.) */
        CREATE TABLE IF NOT EXISTS opme_ajuste_aceito (
          chave      TEXT PRIMARY KEY,
          criado_em  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        /* V661: termos ADICIONAIS de busca da PRODUÇÃO QVIS — produtos que o
           painel Produção passa a buscar além dos termos elegíveis. */
        CREATE TABLE IF NOT EXISTS opme_producao_extras (
          termo      TEXT PRIMARY KEY,
          ativo      INTEGER NOT NULL DEFAULT 1,
          criado_em  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        /* Substituição de médico no fichário OPME — quando o médico
           cadastrado no QVIS não é quem vai receber o repasse. Chave por
           (admissao, codigo_relatorio, papel) — só afeta a linha específica
           selecionada, não propaga pra outras admissões do mesmo médico. */
        CREATE TABLE IF NOT EXISTS opme_substituicao_medico (
          admissao              TEXT NOT NULL,
          codigo_relatorio      TEXT NOT NULL,
          papel                 TEXT NOT NULL DEFAULT '',
          nome_original         TEXT,
          nome_substituto       TEXT NOT NULL,
          nome_normalizado      TEXT,
          criado_em             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (admissao, codigo_relatorio, papel)
        );
        CREATE INDEX IF NOT EXISTS idx_subs_admissao ON opme_substituicao_medico(admissao);

        /* OPME EV (Espaço Verde) — repasses pagos ANTES de o convênio pagar
           o ATLAS. A admissão é copiada da Produção pro Relatório QVIS no mês
           filtrado. Chave primária só "admissao" porque uma admissão só pode
           ser paga antecipadamente UMA vez. Quando o convênio pagar e essa
           admissão aparecer no QVIS de outro mês, o sistema reconhece pelo
           registro nessa tabela e desabilita o repasse (já foi pago). */
        CREATE TABLE IF NOT EXISTS opme_repasse_antecipado (
          admissao              TEXT PRIMARY KEY,
          competencia           TEXT NOT NULL,
          data_admissao         TEXT,
          paciente              TEXT,
          procedimento          TEXT,
          convenio              TEXT,
          nome_profissional     TEXT,
          nome_normalizado      TEXT,
          quantidade            INTEGER DEFAULT 1,
          produzido             REAL DEFAULT 0,
          pct_aplicado          REAL DEFAULT 0,
          repasse_calculado     REAL DEFAULT 0,
          origem_codigo_relatorio TEXT,
          criado_em             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_ev_competencia ON opme_repasse_antecipado(competencia);

        /* Valor fixo de OPME (subfaturamento) — quando o OPME vem subfaturado
           na base (ex.: ISTENT INFINITY a R$ 500 sendo que o valor real é
           R$ 12.980), cadastra-se um PADRÃO de busca (contém) + o VALOR fixo.
           Em toda linha cujo produto contém o padrão, se o produzido for MENOR
           que o valor fixo, o repasse usa o valor fixo. Empate entre padrões:
           vence o mais específico (texto mais longo). Padrão e valor editáveis. */
        CREATE TABLE IF NOT EXISTS opme_valor_fixo (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          convenio    TEXT NOT NULL DEFAULT '',
          padrao      TEXT NOT NULL,
          valor_fixo  REAL NOT NULL DEFAULT 0,
          ativo       INTEGER NOT NULL DEFAULT 1,
          criado_em   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT OR IGNORE INTO config_opme (chave, valor) VALUES
          ('PCT_GERAL', '10.00'),
          ('RESPEITAR_REGRA_MEDICO', '1');

        INSERT OR IGNORE INTO opme_termos_elegiveis (termo, ativo) VALUES
          ('ANTIGLAUCOMATOSA', 1),
          ('ISTENT', 1),
          ('VALVULA', 1),
          ('AHMED', 1),
          ('PRESERFLO', 1),
          ('MP3', 1),
          -- V873: pedido do usuário
          ('COLA', 1);

        /* Termos que saíram da lista padrão de elegíveis (substituição da lista) */
        DELETE FROM opme_termos_elegiveis WHERE termo IN ('VALVULA MP3', 'ANEL');
      `);

      // Migração: coluna 'convenio' em opme_valor_fixo e opme_repasse_antecipado
      // (pra bancos que já tinham essas tabelas sem a coluna).
      try {
        const colsVF = (this.db.exec(`PRAGMA table_info(opme_valor_fixo)`)[0]?.values || []).map(v => v[1]);
        if (!colsVF.includes('convenio')) {
          this.db.exec(`ALTER TABLE opme_valor_fixo ADD COLUMN convenio TEXT NOT NULL DEFAULT ''`);
        }
        const colsEV = (this.db.exec(`PRAGMA table_info(opme_repasse_antecipado)`)[0]?.values || []).map(v => v[1]);
        if (!colsEV.includes('convenio')) {
          this.db.exec(`ALTER TABLE opme_repasse_antecipado ADD COLUMN convenio TEXT`);
        }
      } catch (e) { console.warn('[OPME] migração convenio:', e); }

      // Migração: coluna 'pct' (% de repasse por OPME) em opme_termos_elegiveis
      // (NULL = usa a regra geral). Pra bancos antigos sem a coluna.
      try {
        const colsTE = (this.db.exec(`PRAGMA table_info(opme_termos_elegiveis)`)[0]?.values || []).map(v => v[1]);
        if (!colsTE.includes('pct')) {
          this.db.exec(`ALTER TABLE opme_termos_elegiveis ADD COLUMN pct REAL`);
        }
      } catch (e) { console.warn('[OPME] migração pct termo:', e); }

      // Migração: coluna 'codigo_atlas' (código de individualização MDATLAS#### por médico,
      // atribuído em ordem alfabética na 1ª vez; novos médicos pegam o próximo número livre
      // e os já atribuídos NUNCA mudam). Preenchida pelo helper CodigoMedico.garantir().
      try {
        const colsMed = (this.db.exec(`PRAGMA table_info(medicos)`)[0]?.values || []).map(v => v[1]);
        if (!colsMed.includes('codigo_atlas')) {
          this.db.exec(`ALTER TABLE medicos ADD COLUMN codigo_atlas TEXT`);
        }
      } catch (e) { console.warn('[MEDICOS] migração codigo_atlas:', e); }

      // Migração: coluna 'nomenclatura' (texto livre por procedimento, p/ módulo de
      // indicadores) em procedimentos. Pra bancos antigos sem a coluna.
      try {
        const colsProc = (this.db.exec(`PRAGMA table_info(procedimentos)`)[0]?.values || []).map(v => v[1]);
        if (!colsProc.includes('nomenclatura')) {
          this.db.exec(`ALTER TABLE procedimentos ADD COLUMN nomenclatura TEXT`);
        }
      } catch (e) { console.warn('[BaseTabela] migração nomenclatura:', e); }

      // Migração V665: opme_regra_papel ganha PRODUTO (papel+produto → %)
      try {
        const colsRP = (this.db.exec(`PRAGMA table_info(opme_regra_papel)`)[0]?.values || []).map(v => v[1]);
        if (colsRP.length && !colsRP.includes('produto_normalizado')) {
          this.db.exec(`
            ALTER TABLE opme_regra_papel RENAME TO opme_regra_papel_v1;
            CREATE TABLE opme_regra_papel (
              papel_normalizado   TEXT NOT NULL,
              papel_exibicao      TEXT NOT NULL,
              produto_normalizado TEXT NOT NULL DEFAULT '',
              produto_exibicao    TEXT,
              pct                 REAL NOT NULL,
              criado_em           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (papel_normalizado, produto_normalizado)
            );
            INSERT INTO opme_regra_papel (papel_normalizado, papel_exibicao, produto_normalizado, produto_exibicao, pct, criado_em)
              SELECT papel_normalizado, papel_exibicao, '', NULL, pct, criado_em FROM opme_regra_papel_v1;
            DROP TABLE opme_regra_papel_v1;
          `);
          console.log('[OPME] migração V665: regra por papel agora aceita produto.');
        }
      } catch (e) { console.warn('[OPME] migração regra_papel:', e); }

      // Migração V37: se a tabela atual NÃO tem 'codigo_relatorio', migrar.
      const pragma = this.db.exec(`PRAGMA table_info(opme_pagamentos)`);
      const cols = pragma[0]?.values.map(v => v[1]) || [];
      if (!cols.includes('codigo_relatorio')) {
        this.db.exec(`
          DROP TABLE IF EXISTS opme_pagamentos_v37;
          CREATE TABLE opme_pagamentos_v37 (
            admissao          TEXT NOT NULL,
            codigo_relatorio  TEXT NOT NULL,
            competencia       TEXT,
            data_admissao    TEXT,
            data_pagamento    TEXT NOT NULL,
            observacao        TEXT,
            criado_em         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (admissao, codigo_relatorio)
          );

          -- Tenta derivar codigo_relatorio das linhas QVIS originais via snapshot_stats.
          -- Se não achar correspondência, usa fallback "OLD-<competencia>" pra manter
          -- a chave única.
          INSERT OR IGNORE INTO opme_pagamentos_v37
            (admissao, codigo_relatorio, competencia, data_admissao, data_pagamento, observacao, criado_em)
          SELECT
            op.admissao,
            COALESCE(
              (
                SELECT ss.codigo_relatorio
                  FROM linhas_qvis lq
                  JOIN qvis_snapshot_stats ss
                    ON ss.origem = lq.origem AND ss.mes_pagamento = lq.mes_pagamento
                 WHERE lq.admissao = op.admissao
                   AND lq.competencia = op.competencia
                   AND ss.codigo_relatorio IS NOT NULL
                   AND ss.codigo_relatorio <> ''
                 LIMIT 1
              ),
              'OLD-' || COALESCE(op.competencia, '')
            ),
            op.competencia,
            (
              SELECT lq.data_admissao
                FROM linhas_qvis lq
               WHERE lq.admissao = op.admissao
                 AND lq.competencia = op.competencia
               LIMIT 1
            ),
            op.data_pagamento,
            op.observacao,
            op.criado_em
          FROM opme_pagamentos op;

          DROP TABLE opme_pagamentos;
          ALTER TABLE opme_pagamentos_v37 RENAME TO opme_pagamentos;
          CREATE INDEX IF NOT EXISTS idx_opme_pag_admissao ON opme_pagamentos(admissao);
          CREATE INDEX IF NOT EXISTS idx_opme_pag_data ON opme_pagamentos(data_pagamento);
        `);
        console.log('[OPME] Migração V37: opme_pagamentos agora tem PK (admissao, codigo_relatorio)');
      }
    } catch (e) {
      console.error('Erro criando/migrando tabelas de OPME:', e);
    }
  },

  /**
   * Garante as tabelas do fichário LIO (Lentes Intra-Oculares).
   *
   * Regra de negócio:
   *   - 18% do produzido pro EXECUTANTE (Cirurgião)
   *   - 2,5% do produzido pro INDICANTE, SE indicante ≠ executante
   *   - Se forem iguais: só 18% (não duplica)
   *
   * Base de cruzamento: linhas_producao com Classificação OPME +
   * Tipo Produto contendo LIO/LENTE INTRA OCULAR/SERVICO DE LIO.
   *
   * Separado em 2 abas: CONVÊNIO e PARTICULAR (campo tipo_recebimento).
   */
  _garantirTabelasLio() {
    try {
      // ─── config_lio: chave/valor com defaults ────────────────────────────
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS config_lio (
          chave  TEXT PRIMARY KEY,
          valor  TEXT NOT NULL
        );
      `);
      const defaultsLio = [
        ['PCT_EXECUTANTE_GERAL', '18.00'],
        ['PCT_INDICANTE_GERAL',  '2.50'],
      ];
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO config_lio (chave, valor) VALUES (?, ?)
      `);
      try { for (const [k, v] of defaultsLio) stmt.run([k, v]); }
      finally { stmt.free(); }

      // ─── lio_regra_medico: regra específica por médico ────────────────────
      // Permite sobrescrever os percentuais gerais por médico individual.
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS lio_regra_medico (
          nome_normalizado  TEXT PRIMARY KEY,
          nome_exibicao     TEXT NOT NULL,
          pct_executante    REAL,             -- se NULL, usa PCT_EXECUTANTE_GERAL
          pct_indicante     REAL,             -- se NULL, usa PCT_INDICANTE_GERAL
          atualizado_em     TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // ─── lio_pagamentos: marca uma admissão como paga ─────────────────────
      // Chave é (admissao, tipo_recebimento) pra permitir pagar CONV e PART
      // separados na mesma admissão (alguns casos têm ambas).
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS lio_pagamentos (
          admissao          TEXT NOT NULL,
          tipo_recebimento  TEXT NOT NULL,    -- CONVENIO ou PARTICULAR
          data_pagamento    TEXT,
          observacao        TEXT,
          pago_em           TEXT DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (admissao, tipo_recebimento)
        );
      `);

      // ─── lio_substituicao_medico: redirecionar repasse de uma linha ──────
      // Mesmo padrão da OPME — chave (admissao, papel) afeta só essa linha.
      // 'papel' = 'EXECUTANTE' ou 'INDICANTE'.
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS lio_substituicao_medico (
          admissao          TEXT NOT NULL,
          papel             TEXT NOT NULL,    -- EXECUTANTE ou INDICANTE
          nome_original     TEXT,
          nome_substituto   TEXT NOT NULL,
          nome_normalizado  TEXT,
          criado_em         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (admissao, papel)
        );
        CREATE INDEX IF NOT EXISTS idx_lio_subs_admissao ON lio_substituicao_medico(admissao);
      `);

      // ─── V667: lio_adicional_tabela — valor de tabela por LENTE (aba ─────
      // ADICIONAL). LIO particular cobrada ACIMA deste valor gera repasse
      // extra de % (config PCT_ADICIONAL, padrão 50) sobre a diferença, só
      // para executantes da especialidade Catarata.
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS lio_adicional_tabela (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          nome              TEXT NOT NULL,
          nome_normalizado  TEXT NOT NULL UNIQUE,
          valor_tabela      REAL NOT NULL,
          ativo             INTEGER NOT NULL DEFAULT 1,
          criado_em         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (e) {
      console.error('Erro criando/migrando tabelas de LIO:', e);
    }
  },

  /**
   * Garante que a tabela config_luz_pulsada existe com seus defaults.
   */
  _garantirTabelaConfigLP() {
    try {
      const r = this.db.exec(`PRAGMA table_info(config_luz_pulsada)`);
      if (r.length > 0 && r[0].values.length > 0) {
        // Já existe — só verifica se tem os defaults
        try {
          this.db.exec(`
            INSERT OR IGNORE INTO config_luz_pulsada (chave, valor) VALUES
              ('PERCENTUAL_TAXA',        '8.00'),
              ('PROPRIETARIO_MEDICO_ID', ''),
              ('BASE_PARTICULAR',        '1'),
              ('BASE_CONVENIO',          '1')
          `);
        } catch (e) {}
        return;
      }
      console.log('Criando tabela config_luz_pulsada');
      this.db.exec(`
        CREATE TABLE config_luz_pulsada (
          chave         TEXT PRIMARY KEY,
          valor         TEXT NOT NULL,
          atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.db.exec(`
        INSERT OR IGNORE INTO config_luz_pulsada (chave, valor) VALUES
          ('PERCENTUAL_TAXA',        '8.00'),
          ('PROPRIETARIO_MEDICO_ID', ''),
          ('BASE_PARTICULAR',        '1'),
          ('BASE_CONVENIO',          '1')
      `);
      console.log('✓ config_luz_pulsada criada');
    } catch (e) {
      console.error('Erro criando config_luz_pulsada:', e);
    }
  },

  /**
   * Garante que a tabela config_crosslink existe com seus defaults.
   * Mesmo padrão da config_luz_pulsada, mas com VALOR_FIXO em vez de
   * PERCENTUAL (Crosslink usa valor fixo por procedimento).
   */
  _garantirTabelaConfigCrosslink() {
    try {
      const r = this.db.exec(`PRAGMA table_info(config_crosslink)`);
      if (r.length > 0 && r[0].values.length > 0) {
        try {
          this.db.exec(`
            INSERT OR IGNORE INTO config_crosslink (chave, valor) VALUES
              ('VALOR_FIXO',             '288.00'),
              ('PROPRIETARIO_MEDICO_ID', ''),
              ('BASE_PARTICULAR',        '1'),
              ('BASE_CONVENIO',          '1')
          `);
        } catch (e) {}
        return;
      }
      console.log('Criando tabela config_crosslink');
      this.db.exec(`
        CREATE TABLE config_crosslink (
          chave         TEXT PRIMARY KEY,
          valor         TEXT NOT NULL,
          atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.db.exec(`
        INSERT OR IGNORE INTO config_crosslink (chave, valor) VALUES
          ('VALOR_FIXO',             '288.00'),
          ('PROPRIETARIO_MEDICO_ID', ''),
          ('BASE_PARTICULAR',        '1'),
          ('BASE_CONVENIO',          '1')
      `);
      console.log('✓ config_crosslink criada');
    } catch (e) {
      console.error('Erro criando config_crosslink:', e);
    }
  },

  _garantirTabelaConfigRefractive() {
    try {
      const r = this.db.exec(`PRAGMA table_info(config_refractive_laser)`);
      if (r.length > 0 && r[0].values.length > 0) {
        try {
          this.db.exec(`
            INSERT OR IGNORE INTO config_refractive_laser (chave, valor) VALUES
              ('PROPRIETARIO_MEDICO_ID', ''),
              ('BASE_PARTICULAR',        '1'),
              ('BASE_CONVENIO',          '1'),
              ('VAL_A_CONV',  '28.72'),
              ('VAL_A_PART', '62.50'),
              ('VAL_B_CONV', '23.40'),
              ('VAL_B_PART', '62.50'),
              ('VAL_CIRUR_CONV_QTD1', '254.65'),
              ('VAL_CIRUR_CONV_QTD2', '509.30'),
              ('PCT_CIRUR_PART',      '26.50')
          `);
        } catch (e) {}
        return;
      }
      console.log('Criando tabela config_refractive_laser');
      this.db.exec(`
        CREATE TABLE config_refractive_laser (
          chave         TEXT PRIMARY KEY,
          valor         TEXT NOT NULL,
          atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.db.exec(`
        INSERT OR IGNORE INTO config_refractive_laser (chave, valor) VALUES
          ('PROPRIETARIO_MEDICO_ID', ''),
          ('BASE_PARTICULAR',        '1'),
          ('BASE_CONVENIO',          '1'),
          ('VAL_A_CONV',  '28.72'),
          ('VAL_A_PART', '62.50'),
          ('VAL_B_CONV', '23.40'),
          ('VAL_B_PART', '62.50'),
          ('VAL_CIRUR_CONV_QTD1', '254.65'),
          ('VAL_CIRUR_CONV_QTD2', '509.30'),
          ('PCT_CIRUR_PART',      '26.50')
      `);
      console.log('✓ config_refractive_laser criada');
    } catch (e) {
      console.error('Erro criando config_refractive_laser:', e);
    }
  },

  /**
   * Tabela qvis_snapshot_stats — estatísticas pré-calculadas de cada snapshot
   * importado (1 linha por origem + mes_pagamento).
   *
   * Salva durante a importação para que o card de Status mostre os números
   * SEM precisar recalcular (que custaria muito processamento).
   */
  _garantirTabelaQVISStats() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS qvis_snapshot_stats (
          origem                 TEXT NOT NULL,
          mes_pagamento          TEXT NOT NULL,
          total_linhas           INTEGER NOT NULL DEFAULT 0,
          total_admissoes_unicas INTEGER NOT NULL DEFAULT 0,
          total_profissionais    INTEGER NOT NULL DEFAULT 0,
          total_produzido        REAL NOT NULL DEFAULT 0,
          total_recebido         REAL NOT NULL DEFAULT 0,
          adm_produzido_zero     INTEGER NOT NULL DEFAULT 0,
          adm_recebido_zero      INTEGER NOT NULL DEFAULT 0,
          competencia_min        TEXT,
          competencia_max        TEXT,
          arquivo_nome           TEXT,
          codigo_relatorio       TEXT,
          data_pagamento         TEXT,
          importado_em           TEXT DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (origem, mes_pagamento)
        )
      `);
      // Migrações defensivas pra bancos antigos:
      try {
        this.db.exec(`ALTER TABLE qvis_snapshot_stats ADD COLUMN codigo_relatorio TEXT`);
      } catch (e) { /* coluna já existe */ }
      try {
        this.db.exec(`ALTER TABLE qvis_snapshot_stats ADD COLUMN data_pagamento TEXT`);
      } catch (e) { /* coluna já existe */ }
    } catch (e) {
      console.error('Erro criando qvis_snapshot_stats:', e);
    }
  },

  /**
   * Garante que as tabelas de Períodos por Unidade existam (importante pra
   * bancos antigos que rodam migração mas o SCHEMA_SQL completo pode falhar
   * em algum CREATE intermediário).
   */
  _garantirTabelasPeriodos() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS periodos_config (
          chave           TEXT PRIMARY KEY,
          valor           TEXT NOT NULL,
          atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.db.exec(`
        INSERT OR IGNORE INTO periodos_config (chave, valor) VALUES ('VALOR_PADRAO_PERIODO', '700')
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS periodos_cadastro_valor (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          nome_normalizado TEXT NOT NULL,
          nome_original   TEXT NOT NULL,
          unidade         TEXT,
          valor_periodo   REAL NOT NULL,
          observacao      TEXT,
          atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(nome_normalizado, unidade)
        )
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS periodos_linhas (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          mes_ref         TEXT NOT NULL,
          nome_original   TEXT NOT NULL,
          nome_normalizado TEXT NOT NULL,
          unidade         TEXT NOT NULL,
          unidade_id      INTEGER,
          valor_periodo   REAL NOT NULL,
          sem1            INTEGER NOT NULL DEFAULT 0,
          sem2            INTEGER NOT NULL DEFAULT 0,
          sem3            INTEGER NOT NULL DEFAULT 0,
          sem4            INTEGER NOT NULL DEFAULT 0,
          sem5            INTEGER NOT NULL DEFAULT 0,
          total_periodos  INTEGER NOT NULL DEFAULT 0,
          total_valor     REAL NOT NULL DEFAULT 0,
          origem          TEXT,
          importado_em    TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(mes_ref, nome_normalizado, unidade),
          FOREIGN KEY (unidade_id) REFERENCES unidades(id) ON DELETE SET NULL
        )
      `);
      // Migração: adiciona unidade_id em bancos antigos
      try {
        this.db.exec(`ALTER TABLE periodos_linhas ADD COLUMN unidade_id INTEGER REFERENCES unidades(id)`);
      } catch (e) { /* coluna já existe */ }
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_periodos_mes ON periodos_linhas(mes_ref)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_periodos_nome_norm ON periodos_linhas(nome_normalizado)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_periodos_unidade ON periodos_linhas(unidade)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_periodos_unidade_id ON periodos_linhas(unidade_id)`);
    } catch (e) {
      console.error('Erro criando tabelas de Períodos:', e);
    }
  },

  /**
   * Garante as 3 tabelas do fichário Fellow (plantões diários).
   *  - fellow_config:    META_ATENDIMENTOS, VALOR_POR_ATENDIMENTO, VALOR_REFEICAO
   *  - fellow_cadastro:  lista de fellows (auto-populada na importação)
   *  - fellow_linhas:    1 linha = 1 plantão (data + fellow + turno)
   *
   * Mesma estratégia do _garantirTabelasPeriodos: CREATE TABLE IF NOT EXISTS
   * + ALTER TABLE try/catch para migrar bancos pré-V11 que ainda não tinham
   * essas tabelas. Idempotente.
   */
  /**
   * V906: CONTROLE DE NOTAS (repasse interno) — o ciclo mensal
   * relatório → nota fiscal → CAV, por médico.
   *  - notas_cadastro: o cadastro dos médicos/PJ (nome, razão, CNPJ, emails)
   *  - notas_controle: 1 linha = médico × competência (os 3 checks, valores,
   *    NF, status especial tipo DISTRATO/ADIANTAMENTO, observação)
   *  - notas_arquivos: o PDF da nota (base64), 1:1 com o controle
   */
  _garantirTabelasNotas() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS notas_cadastro (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          nome              TEXT NOT NULL UNIQUE,
          nome_normalizado  TEXT NOT NULL,
          razao_social      TEXT,
          cnpj              TEXT,
          email_medico      TEXT,
          email_contador    TEXT,
          ativo             INTEGER NOT NULL DEFAULT 1,
          criado_em         TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_notas_cad_norm ON notas_cadastro(nome_normalizado);
        CREATE TABLE IF NOT EXISTS notas_controle (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          competencia       TEXT NOT NULL,
          nome_normalizado  TEXT NOT NULL,
          oc                TEXT,
          email_enviado     INTEGER NOT NULL DEFAULT 0,
          nota_recebida     INTEGER NOT NULL DEFAULT 0,
          cav_enviado       INTEGER NOT NULL DEFAULT 0,
          valor_bruto       REAL,
          valor_liquido     REAL,
          nf_numero         TEXT,
          origem_valores    TEXT,
          status_especial   TEXT,
          observacao        TEXT,
          nota_arquivo      TEXT,
          criado_em         TEXT DEFAULT CURRENT_TIMESTAMP,
          atualizado_em     TEXT,
          UNIQUE(competencia, nome_normalizado)
        );
        CREATE INDEX IF NOT EXISTS idx_notas_ctl_comp ON notas_controle(competencia);
        CREATE TABLE IF NOT EXISTS notas_arquivos (
          controle_id   INTEGER PRIMARY KEY,
          nome_arquivo  TEXT,
          conteudo_b64  TEXT NOT NULL,
          tamanho       INTEGER,
          criado_em     TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (e) { console.error('[Banco] tabelas de notas:', e); }
  },

  _garantirTabelasFellow() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS fellow_config (
          chave           TEXT PRIMARY KEY,
          valor           TEXT NOT NULL,
          atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.db.exec(`
        INSERT OR IGNORE INTO fellow_config (chave, valor) VALUES
          ('META_ATENDIMENTOS',    '13'),
          ('VALOR_POR_ATENDIMENTO','38'),
          ('VALOR_REFEICAO',       '50')
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS fellow_cadastro (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          nome_normalizado TEXT NOT NULL UNIQUE,
          nome_original   TEXT NOT NULL,
          data_inicio     TEXT,
          observacao      TEXT,
          ativo           INTEGER NOT NULL DEFAULT 1,
          medico_id       INTEGER,
          atualizado_em   TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE SET NULL
        )
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS fellow_linhas (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          mes_ref         TEXT NOT NULL,
          data_plantao    TEXT NOT NULL,
          fellow_nome     TEXT NOT NULL,
          fellow_norm     TEXT NOT NULL,
          fellow_id       INTEGER,
          turno           TEXT NOT NULL,
          qtd_atendim     INTEGER NOT NULL DEFAULT 0,
          meta            INTEGER NOT NULL,
          valor_atendim   REAL NOT NULL,
          valor_refeicao  REAL NOT NULL,
          qtd_complem     INTEGER NOT NULL DEFAULT 0,
          valor_complem   REAL NOT NULL DEFAULT 0,
          valor_complem_manual REAL,
          refeicao        REAL NOT NULL DEFAULT 0,
          total_repassar  REAL NOT NULL DEFAULT 0,
          dia_semana      INTEGER NOT NULL,
          origem          TEXT,
          importado_em    TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(mes_ref, data_plantao, fellow_norm, turno),
          FOREIGN KEY (fellow_id) REFERENCES fellow_cadastro(id) ON DELETE SET NULL
        )
      `);
      // Migrações ALTER TABLE para bancos antigos (defensivo — se a tabela
      // existia mas sem alguma coluna, adiciona; se já existe, ignora).
      const colsFellow = [
        ['meta',                 'INTEGER NOT NULL DEFAULT 13'],
        ['valor_atendim',        'REAL NOT NULL DEFAULT 38'],
        ['valor_refeicao',       'REAL NOT NULL DEFAULT 50'],
        ['fellow_id',            'INTEGER'],
        ['dia_semana',           'INTEGER NOT NULL DEFAULT 0'],
        ['valor_complem_manual', 'REAL'],   // override opcional (controladoria)
      ];
      for (const [c, t] of colsFellow) {
        try { this.db.exec(`ALTER TABLE fellow_linhas ADD COLUMN ${c} ${t}`); }
        catch (e) { /* coluna já existe */ }
      }
      try { this.db.exec(`ALTER TABLE fellow_cadastro ADD COLUMN medico_id INTEGER`); }
      catch (e) { /* coluna já existe */ }

      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_fellow_mes  ON fellow_linhas(mes_ref)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_fellow_norm ON fellow_linhas(fellow_norm)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_fellow_data ON fellow_linhas(data_plantao)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_fellow_id   ON fellow_linhas(fellow_id)`);

      // ─── MIGRATION V14 (reverte V13) ───────────────────────────────
      // V13 clampava em 0 (regra "zerar complemento negativo"); essa regra
      // foi revertida para o app web — voltamos a preservar negativos.
      // O qtd_atendim original sempre foi preservado, então conseguimos
      // recalcular qtd_complem, valor_complem e total_repassar do zero.
      //
      // Aplica-se a TODAS as linhas onde o cálculo armazenado não bate com
      // a fórmula (meta - qtd_atendim). UPDATE idempotente: roda toda vez,
      // mas só faz changes nas linhas realmente desincronizadas.
      try {
        this.db.exec(`
          UPDATE fellow_linhas SET
            qtd_complem    = meta - qtd_atendim,
            valor_complem  = (meta - qtd_atendim) * valor_atendim,
            total_repassar = (meta - qtd_atendim) * valor_atendim + refeicao
          WHERE qtd_complem != (meta - qtd_atendim)
        `);
      } catch (e) { /* tabela ainda sem linhas */ }
    } catch (e) {
      console.error('Erro criando tabelas de Fellow:', e);
    }
  },

  /**
   * Migração one-shot: normaliza espaços múltiplos em procedimento_normalizado
   * e nome_normalizado nas linhas QVIS existentes. Isso é necessário porque
   * o seed original gravou esses campos como UPPER+TRIM sem reduzir espaços
   * múltiplos para um (ex: "ORBSCAN /SCANSYS   CERATOSCOPIA").
   *
   * Idempotente: a marca 'qvis_normalizado_v1' fica em config_app pra não
   * rodar de novo em sessões futuras.
   */
  _normalizarEspacosQVIS() {
    try {
      // Verifica se há linhas pra normalizar
      const total = this.queryUnica(`SELECT COUNT(*) AS n FROM linhas_qvis`);
      if (!total || total.n === 0) return;

      // Conta quantas linhas TÊM espaços múltiplos pra evitar rodar à toa
      const comEspacos = this.queryUnica(`
        SELECT COUNT(*) AS n FROM linhas_qvis
        WHERE procedimento_normalizado LIKE '%  %'
           OR nome_normalizado          LIKE '%  %'
      `);
      if (!comEspacos || comEspacos.n === 0) return;  // tudo OK, nada a fazer

      console.log(`Normalizando espaços em ${comEspacos.n} linhas QVIS...`);
      const t0 = performance.now();

      // SQL trick: usa replace iterativo. Em SQLite puro não dá pra fazer
      // regex, então fazemos múltiplos REPLACE até saturar. 5 passadas
      // cobrem qualquer espaço múltiplo realista (até 32 espaços seguidos).
      this.db.exec(`BEGIN`);
      try {
        const colsNormalizar = ['procedimento_normalizado', 'nome_normalizado'];
        for (const col of colsNormalizar) {
          for (let i = 0; i < 5; i++) {
            this.db.exec(`UPDATE linhas_qvis SET ${col} = REPLACE(${col}, '  ', ' ') WHERE ${col} LIKE '%  %'`);
          }
          this.db.exec(`UPDATE linhas_qvis SET ${col} = TRIM(${col})`);
        }
        this.db.exec(`COMMIT`);
        const t1 = performance.now();
        console.log(`✓ Normalização concluída em ${((t1-t0)/1000).toFixed(1)}s`);
      } catch (e) {
        this.db.exec(`ROLLBACK`);
        throw e;
      }
    } catch (e) {
      console.error('Erro normalizando espaços QVIS:', e);
    }
  },

  _marcarFlagNormalizacao() {
    try {
      // Garante que config_app existe
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS config_app (
          chave TEXT PRIMARY KEY,
          valor TEXT NOT NULL,
          atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.db.exec(`
        INSERT INTO config_app (chave, valor) VALUES ('qvis_normalizado_v1', '1')
        ON CONFLICT(chave) DO UPDATE SET valor = '1', atualizado_em = CURRENT_TIMESTAMP
      `);
    } catch (e) {
      console.warn('Falha marcando flag normalização:', e.message);
    }
  },

  /**
   * Garante que a tabela linhas_qvis existe na estrutura correta.
   * Se não existir (ou tiver versão errada), cria do zero.
   */
  _garantirTabelaQVIS() {
    try {
      const r = this.db.exec(`PRAGMA table_info(linhas_qvis)`);
      const colNames = (r.length > 0) ? r[0].values.map(x => x[1]) : [];
      const temBase = colNames.includes('competencia') && colNames.includes('origem') && colNames.includes('procedimento_normalizado');
      const temPgto = colNames.includes('mes_pagamento');

      // Caso 1: tabela existe e tem tudo → nada a fazer
      if (temBase && temPgto) return;

      // Caso 2: tabela existe mas não tem mes_pagamento → ALTER TABLE
      if (temBase && !temPgto) {
        console.log('Migração: ALTER TABLE linhas_qvis ADD COLUMN mes_pagamento');
        try {
          this.db.exec(`ALTER TABLE linhas_qvis ADD COLUMN mes_pagamento TEXT`);
          this.db.exec(`CREATE INDEX IF NOT EXISTS idx_qvis_mes_pgto ON linhas_qvis(mes_pagamento)`);
          console.log('✓ Coluna mes_pagamento adicionada');
        } catch (e) {
          console.error('Falha no ALTER:', e);
        }
        return;
      }

      // Caso 3: tabela não existe ou tem estrutura faltando → recria do zero
      console.log('Criando/recriando tabela linhas_qvis (estrutura faltando ou incorreta)');
      this.db.exec(`DROP TABLE IF EXISTS linhas_qvis`);
      this.db.exec(`
        CREATE TABLE linhas_qvis (
          id                       INTEGER PRIMARY KEY AUTOINCREMENT,
          origem                   TEXT NOT NULL,
          competencia              TEXT NOT NULL,
          nome_profissional        TEXT,
          nome_normalizado         TEXT,
          papel                    TEXT,
          procedimento             TEXT,
          procedimento_normalizado TEXT,
          quantidade               INTEGER DEFAULT 1,
          convenio                 TEXT,
          unidade_faturamento      TEXT,
          unidade_atendimento      TEXT,
          destino                  TEXT,
          estado                   TEXT,
          admissao                 TEXT,
          data_admissao            TEXT,
          paciente                 TEXT,
          cod_paciente             TEXT,
          conta                    TEXT,
          envio                    TEXT,
          produzido                REAL DEFAULT 0,
          honorario                REAL DEFAULT 0,
          recebido                 REAL DEFAULT 0,
          repassado                REAL DEFAULT 0,
          tipo_paciente            TEXT,
          especialidade            TEXT,
          tipo_recebimento         TEXT,
          classificacao_produto    TEXT,
          cod_unidade_faturamento  TEXT,
          cod_repasse              TEXT,
          cod_regra_repasse        TEXT,
          novo_valor               REAL,
          mes_pagamento            TEXT,
          criado_em                TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_qvis_competencia ON linhas_qvis(competencia)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_qvis_admissao    ON linhas_qvis(admissao)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_qvis_proc_norm   ON linhas_qvis(procedimento_normalizado)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_qvis_papel       ON linhas_qvis(papel)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_qvis_nome_norm   ON linhas_qvis(nome_normalizado)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_qvis_origem      ON linhas_qvis(origem)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_qvis_mes_pgto    ON linhas_qvis(mes_pagamento)`);
      console.log('✓ linhas_qvis criada com sucesso');
    } catch (e) {
      console.error('Erro criando linhas_qvis:', e);
    }
  },

  /**
   * Migração one-shot: limpa o seed antigo (~58k linhas QVIS que vieram
   * carregadas automaticamente). A partir desta versão o usuário precisa
   * importar manualmente via tela "Importar QVIS", definindo o mês de
   * pagamento de cada arquivo.
   *
   * Idempotente: a flag 'qvis_seed_limpo_v2' em config_app garante que não
   * roda de novo. Linhas inseridas pelo módulo Importar QVIS NÃO são
   * afetadas (elas têm mes_pagamento preenchido).
   */
  // V943: a migração V926 (_removerInspecao — DROP config_inspecao + limpeza insp_*) saiu:
  // o módulo Inspeção voltou e a configuração dele viaja no .db de novo.

  _limparSeedAntigo() {
    try {
      // Já rodou?
      let jaRodou = false;
      try {
        const flag = this.queryUnica(`SELECT valor FROM config_app WHERE chave = 'qvis_seed_limpo_v2'`);
        if (flag && flag.valor === '1') jaRodou = true;
      } catch (e) {}
      if (jaRodou) return;

      // Limpa só linhas que não têm mes_pagamento (que são as do seed antigo)
      // Linhas importadas pelo módulo Importar QVIS TÊM mes_pagamento preenchido
      const r = this.queryUnica(`SELECT COUNT(*) AS n FROM linhas_qvis WHERE mes_pagamento IS NULL OR mes_pagamento = ''`);
      const qtd = r?.n || 0;
      if (qtd > 0) {
        console.log(`Limpando seed antigo: ${qtd} linhas QVIS sem mes_pagamento`);
        this.db.exec(`DELETE FROM linhas_qvis WHERE mes_pagamento IS NULL OR mes_pagamento = ''`);
      }
      // Marca flag
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS config_app (
          chave TEXT PRIMARY KEY,
          valor TEXT NOT NULL,
          atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.db.exec(`
        INSERT INTO config_app (chave, valor) VALUES ('qvis_seed_limpo_v2', '1')
        ON CONFLICT(chave) DO UPDATE SET valor = '1', atualizado_em = CURRENT_TIMESTAMP
      `);
    } catch (e) {
      console.warn('Erro limpando seed antigo:', e.message);
    }
  },

  /**
   * Migra schema: adiciona colunas novas em tabelas que já existem.
   * Cada chamada é idempotente (tenta adicionar, ignora se já existe).
   */
  _migrarColunas() {
    const migracoes = [
      // Colunas novas na tabela medicos
      "ALTER TABLE medicos ADD COLUMN rqe TEXT",
      "ALTER TABLE medicos ADD COLUMN cnpj TEXT",
      "ALTER TABLE medicos ADD COLUMN razao_social TEXT",
      "ALTER TABLE medicos ADD COLUMN email TEXT",
      "ALTER TABLE medicos ADD COLUMN telefone TEXT",
      "ALTER TABLE medicos ADD COLUMN tipo_vinculo TEXT",
      "ALTER TABLE medicos ADD COLUMN cargo_admin TEXT",
      // V699: médico externo pertence a uma clínica (cadastro em externos_clinicas)
      "ALTER TABLE medicos ADD COLUMN clinica_externa_id INTEGER",
      // Colunas novas em unidades
      "ALTER TABLE unidades ADD COLUMN ordem INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE unidades ADD COLUMN criado_em TEXT DEFAULT CURRENT_TIMESTAMP",
      // Coluna nova em excecoes_cargo
      "ALTER TABLE excecoes_cargo ADD COLUMN valor_fixo REAL NOT NULL DEFAULT 0",
    ];

    for (const sql of migracoes) {
      try {
        this.db.exec(sql);
      } catch (e) {
        // "duplicate column name" é esperado quando já foi aplicada
        if (!String(e.message).includes('duplicate column')) {
          console.warn('Falha em migração:', sql, e);
        }
      }
    }

    // Migração de dados: cargo_admin (TEXT único) → medico_cargos (N:N)
    // Move dados que ficaram no campo antigo para a nova tabela
    try {
      this.db.exec(`
        INSERT OR IGNORE INTO medico_cargos (medico_id, cargo)
        SELECT id, cargo_admin
        FROM medicos
        WHERE cargo_admin IS NOT NULL AND cargo_admin != ''
      `);
      // Após migrar, limpa o campo antigo para evitar inconsistência futura
      this.db.exec(`UPDATE medicos SET cargo_admin = NULL WHERE cargo_admin IS NOT NULL`);
    } catch (e) {
      console.warn('Falha na migração cargo_admin → medico_cargos:', e);
    }

    // Migração: o cargo antigo DIRETOR_MEDICO foi dividido em
    // DIRETORIA_TECNICA e DIRETORIA_CLINICA. Como não temos como saber
    // qual aplicar a cada médico, apagamos os vínculos antigos.
    // O usuário precisa remarcar manualmente quem é DT e quem é DC.
    try {
      this.db.exec(`DELETE FROM medico_cargos WHERE cargo = 'DIRETOR_MEDICO'`);
      this.db.exec(`DELETE FROM valores_cargos WHERE cargo = 'DIRETOR_MEDICO'`);
      this.db.exec(`DELETE FROM excecoes_cargo WHERE cargo_base = 'DIRETOR_MEDICO'`);
    } catch (e) {
      console.warn('Falha na migração DIRETOR_MEDICO → DT/DC:', e);
    }
  },

  // ==========================================================================
  // PERSISTÊNCIA NO INDEXEDDB
  // ==========================================================================

  /**
   * Salva snapshot do banco no IndexedDB.
   * Chamar após qualquer operação importante (insert/update/delete).
   */
  // V602: aviso "salvando…" — o export do banco inteiro é síncrono e, em
  // bases grandes, segura a tela por vários segundos; o selo transforma o
  // congelamento-mistério num estado visível.
  _seloSalvando(mostrar) {
    try {
      let el = document.getElementById('atlas-selo-salvando');
      if (mostrar) {
        if (!el) {
          el = document.createElement('div');
          el.id = 'atlas-selo-salvando';
          el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:100060;' +
            'background:#0f1d2e;color:#fff;font:600 12px/1 Inter Tight,-apple-system,sans-serif;' +
            'padding:10px 14px;border-radius:10px;box-shadow:0 6px 18px rgba(11, 35, 64,.35);pointer-events:none';
          el.textContent = '💾 Salvando o banco — a tela pode pausar alguns segundos…';
          document.body.appendChild(el);
        }
      } else if (el) el.remove();
    } catch (_) {}
  },
  async _aguardarPintura2() {
    // V659: rAF NÃO dispara com a página oculta/em unload — o flush de saída
    // (pagehide/visibilitychange) estacionava aqui pra sempre e o export nunca
    // rodava: fechar a aba com um debounce pendente PERDIA a edição. Com a
    // página escondida não há o que pintar — segue direto pro export.
    if (document.visibilityState === 'hidden' || this._saindo) return;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  },

  /**
   * V644: "carimbo de escrita" da sessão — total_changes() (linhas inseridas/
   * alteradas/apagadas nesta conexão) + schema_version (bumpa em DDL). Se o
   * carimbo não mudou desde o último export, NÃO há dado novo pra persistir —
   * o export de banco grande (1 GB ≈ 4-8s de tela presa) é pulado inteiro.
   * Salvamentos "defensivos" (navegação, pagehide, rotinas de limpeza que não
   * acharam nada) deixam de congelar a tela.
   */
  _carimboEscrita() {
    try {
      const tc = this.queryUnica('SELECT total_changes() AS tc');
      const sv = this.queryUnica('PRAGMA schema_version');
      const svVal = sv ? (sv.schema_version != null ? sv.schema_version : Object.values(sv)[0]) : 0;
      return (tc ? tc.tc : 0) + '|' + svVal;
    } catch (_) { return null; }
  },
  _resolverSalvarPendentes() {
    if (this._salvarTimer) { clearTimeout(this._salvarTimer); this._salvarTimer = null; }
    const r = this._salvarResolve;
    this._salvarPromise = null; this._salvarResolve = null;
    if (r) r();
  },

  async salvar(opts = {}) {
    if (!this.db) throw new Error('Banco não inicializado');
    // V839: outra janela substituiu o banco (reset/restauração) — esta sessão
    // não grava mais nada; só recarregar pega o banco novo.
    if (this._epocaVencida) { this._resolverSalvarPendentes(); return; }
    // V820: o avanço de _versao invalida os memos pesados (matriz da auditoria,
    // consolidado por mês, totais do OPME). Um salvar DEFENSIVO — navegação,
    // rotina que não escreveu nada — não pode pagar essa conta: o diagnóstico
    // real mostrou a matriz reconstruída 95× numa sessão (4-6s de tela presa
    // cada) porque todo salvar carimbava versão nova. Agora _versao só avança
    // quando houve ESCRITA desde o último export (mesmo critério do skip V644).
    const carimbo = this._carimboEscrita();
    const limpo = carimbo && carimbo === this._carimboExportado && this._ultimoExportTam;
    if (!limpo) this._versao = (this._versao || 0) + 1;
    // V644: nada foi escrito desde o último export → pula o export pesado
    if (limpo) {
      this._resolverSalvarPendentes();
      this._gravarFotosNoIDB().catch(() => {});   // fotos (cache) podem ter mudado
      return;
    }
    // V659: COALESCING ADAPTATIVO — em banco grande, cada gesto não pode custar
    // um export completo. Janela mínima entre persists; dentro dela o pedido
    // AGENDA o flush e RESOLVE NA HORA (o dado já está no banco em memória —
    // handlers de UI que fazem `await Banco.salvar(); render()` não podem
    // congelar esperando a janela). O flush roda sozinho no fim da janela, ou
    // antes no flush de saída (aba oculta/fechar/beforeunload). Ações críticas
    // (consolidar, importar, resetar, compactar, backup) passam
    // { imediato: true } e furam a janela; quem precisa da persistência
    // CONFIRMADA usa Banco.flushPendente().
    // V686: a janela é 4× o custo TOTAL do último persist (export + arquivo
    // vinculado + IndexedDB), não só do export — com arquivo vinculado de
    // centenas de MB o export era 0,3s mas o persist real levava minutos, e a
    // janela de 2s deixava um persist completo passar a cada gesto.
    if (!opts.imediato) {
      if (this._exportEmAndamento) { this.salvarDebounced(2000); return; }
      const restante = this._janelaRestanteMs();
      if (restante > 0) { this.salvarDebounced(restante); return; }
    }
    // V492: um salvar() imediato supersede qualquer debounce pendente
    if (this._salvarTimer) { clearTimeout(this._salvarTimer); this._salvarTimer = null; }
    await this._exportarEPersistir();
    const r = this._salvarResolve;
    this._salvarPromise = null; this._salvarResolve = null;
    if (r) r();
  },

  // V686: quanto falta da janela de coalescência entre persists completos.
  // Custo de referência = duração TOTAL do último _exportarEPersistir
  // (fallback: só o export, p/ o 1º save da sessão). Piso 2s, teto 2min.
  _janelaRestanteMs() {
    const custo = this._ultimoPersistDurMs || this._ultimoExportDurMs || 0;
    const janela = Math.min(Math.max(4 * custo, 2000), 120000);
    const decorrido = performance.now() - (this._ultimoPersistFim || this._ultimoExportFim || -1e9);
    return decorrido < janela ? Math.ceil(janela - decorrido) : 0;
  },

  // V659: pipeline compartilhado de salvar()/_flushSalvar() com FASES medidas
  // (o diag separa o que TRAVA a tela — export — do que roda em 2º plano).
  // V686: com o worker do IndexedDB disponível, o ARQUIVO VINCULADO também é
  // gravado DENTRO do worker (o FileSystemFileHandle é clonável) — a escrita
  // de centenas de MB sai da main thread. Ordem: export → transferência
  // zero-cópia pro worker (handle junto) → worker grava IndexedDB e depois o
  // arquivo. Sem worker, cai no caminho antigo (arquivo na main thread, MESMO
  // buffer; write() copia, não detacha).
  async _exportarEPersistir() {
    const fases = { pintura: 0, export: 0, arquivo: 0, idbAguardo: 0, idbTx: null, caminho: '' };
    this._exportEmAndamento = true;
    const t0Persist = performance.now();
    try {
      let t = performance.now();
      this._seloSalvando(true);
      try { await this._aguardarPintura2(); } catch (_) {}   // o selo pinta antes do export
      fases.pintura = performance.now() - t;
      let bytes;
      t = performance.now();
      try {
        bytes = this.db.export();   // Uint8Array com todo o banco (síncrono)
      } finally { this._seloSalvando(false); }
      fases.export = performance.now() - t;
      this._ultimoExportDurMs = fases.export;   // V659: dimensiona a janela do coalescing
      // V644: o export() do sql.js REABRE a conexão (total_changes volta a 0) —
      // o carimbo de referência é recalculado logo após, não o de antes
      this._carimboExportado = this._carimboEscrita();
      this._ultimoExportTam = bytes.length; this._ultimoExportFim = performance.now();   // V605/V602
      // V686: SEM worker, o arquivo vinculado grava aqui (main thread, ANTES
      // da gravação direta no IDB — mesmo buffer). COM worker, quem grava é o
      // próprio worker (handle vai junto na transferência, em _gravarNoIndexedDB).
      // Falha aqui NUNCA pula a gravação no IndexedDB (que é o primário).
      t = performance.now();
      try {
        if (!this._obterWorkerIDB() && window.AtlasArquivoBanco && AtlasArquivoBanco.estado().vinculado && AtlasArquivoBanco.gravarBytes) {
          await AtlasArquivoBanco.gravarBytes(bytes);
        }
      } catch (e) { console.warn('[banco] arquivo vinculado:', e); }
      fases.arquivo = performance.now() - t;
      t = performance.now();
      try {
        await this._gravarNoIndexedDB(bytes, fases);
      } catch (e) {
        // V659: a persistência FALHOU — anula o carimbo pra próxima tentativa
        // não cair no skip V644 com o dado preso só em memória ("salvo" falso).
        this._carimboExportado = null;
        // V839: o banco no disco tem uma ÉPOCA mais nova (outra janela resetou
        // ou restaurou de propósito). Esta sessão carrega o banco ANTIGO em
        // memória — qualquer gravação desfaria a intenção do usuário. Suspende
        // os salvamentos desta janela de vez; só recarregar (F5) volta ao normal.
        if (e && e.epocaNova) {
          this._epocaVencida = true;
          console.warn('[banco] salvamentos SUSPENSOS nesta janela: o banco foi substituído em outra janela (época nova)');
          try {
            window.Utilidades?.toast?.('O banco foi SUBSTITUÍDO em outra janela (restauração/reset). '
              + 'Esta janela parou de salvar para não desfazer isso — recarregue (F5) para continuar.', 'error', 15000);
          } catch (_) {}
        }
        throw e;
      }
      fases.idbAguardo = performance.now() - t;
      this._fasesUltimoSalvar = fases;
      // V613: espelha o cofre das fotos (cobre exclusões de fotos junto com o dado)
      this._gravarFotosNoIDB().catch(() => {});
    } finally {
      this._exportEmAndamento = false;
      // V686: dimensiona a janela de coalescência pelo custo TOTAL, medido do
      // FIM do persist (com persists longos, medir do fim do export deixava a
      // janela "já vencida" quando o persist terminava).
      this._ultimoPersistDurMs = performance.now() - t0Persist;
      this._ultimoPersistFim = performance.now();
    }
  },

  // V659: força o flush de um debounce pendente (pra telas que precisam do
  // IndexedDB/arquivo atualizados AGORA — backup, vincular, diagnósticos).
  async flushPendente() {
    if (this._salvarTimer) await this._flushSalvar(true);   // V686: fura a janela
  },

  /**
   * V492: versão COALESCIDA do salvar() para micro-edições em sequência
   * (checkbox, célula editada, clique de quantidade). O export do banco
   * inteiro (que trava a main thread e cresce com o tamanho do banco) só
   * roda UMA vez, ~400ms após a última chamada — N cliques = 1 export.
   *
   * Garantias:
   *  - O dado JÁ ESTÁ no banco em memória (as queries seguintes o enxergam);
   *    só a persistência no IndexedDB é adiada alguns ms.
   *  - flush automático em pagehide/aba oculta (registrado no fim do arquivo),
   *    então fechar a aba logo após a edição não perde o dado.
   *  - Um Banco.salvar() imediato no meio cancela o timer e persiste tudo.
   */
  salvarDebounced(ms = 400) {
    if (!this.db) throw new Error('Banco não inicializado');
    if (this._epocaVencida) return Promise.resolve();   // V839: sessão suspensa
    // V820: mesma regra do salvar() — só invalida os memos se algo foi escrito
    const carimboD = this._carimboEscrita();
    if (!(carimboD && carimboD === this._carimboExportado && this._ultimoExportTam)) {
      this._versao = (this._versao || 0) + 1;
    }
    if (!this._salvarPromise) {
      this._salvarPromise = new Promise((res) => { this._salvarResolve = res; });
    }
    clearTimeout(this._salvarTimer);
    this._salvarTimer = setTimeout(() => { this._flushSalvar(); }, ms);
    return this._salvarPromise;
  },

  /**
   * V606: COMPACTA o banco (VACUUM) e persiste. Importações/exclusões deixam
   * "páginas mortas" dentro do arquivo — o VACUUM reescreve o banco sem elas.
   * Retorna { antes, depois } em bytes (antes = último export conhecido).
   */
  async compactar() {
    if (!this.db) throw new Error('Banco não inicializado');
    // V659: persiste ANTES do VACUUM — a reescrita de um banco de ~900MB dobra
    // o uso de memória; um crash no meio perderia tudo desde o último save.
    await this.salvar({ imediato: true });
    const antes = this._ultimoExportTam || null;
    this._seloSalvando(true);
    try {
      await this._aguardarPintura2();   // o selo pinta antes do trabalho pesado
      this.db.exec('VACUUM');
    } finally { this._seloSalvando(false); }
    this._carimboExportado = null;     // V644: VACUUM não conta em total_changes — força o export
    await this.salvar({ imediato: true });   // persiste já compactado (mede o novo tamanho)
    return { antes, depois: this._ultimoExportTam || null };
  },

  // ── V644: SNAPSHOTS COMPRIMIDOS (gzip via fflate) ────────────────────────
  // O resultado_json dos cálculos salvos era a 2ª maior área do banco
  // (~160 MB). JSON repetitivo comprime ~8-10×: guardamos gzip (BLOB) e
  // descomprimimos na leitura. snapPack/snapUnpack aceitam os DOIS formatos —
  // texto puro (bases antigas) e gzip — então nada quebra sem a migração.
  snapPack(json) {
    try {
      if (window.fflate && typeof json === 'string' && json.length > 4096) {
        return window.fflate.gzipSync(window.fflate.strToU8(json), { level: 6 });
      }
    } catch (e) { console.warn('[banco] snapPack (segue sem compressão):', e); }
    return json;
  },
  snapUnpack(val) {
    try {
      if (val instanceof Uint8Array) {
        if (window.fflate) return window.fflate.strFromU8(window.fflate.gunzipSync(val));
        throw new Error('snapshot comprimido, mas fflate não carregou');
      }
    } catch (e) { console.error('[banco] snapUnpack:', e); throw e; }
    return val;
  },

  /**
   * V591: persistência SEM carimbo de versão — para escritas de CACHE (as
   * "fotos" dos painéis da Visão Geral). Elas não mudam dado-fonte, então
   * NÃO podem incrementar _versao: o salvarDebounced() que a V589 usava
   * carimbava nova versão a cada foto gravada e invalidava os memos pesados
   * (matriz da auditoria, consolidado por mês, aux do motor) NO MEIO do
   * carregamento do dashboard — o motor rodava 4-6× em vez de 1×, e a tela
   * levava minutos. Compartilha o timer/promise do salvarDebounced (um único
   * export coalescido) e o flush de pagehide continua garantindo a gravação.
   */
  // V613: as fotos NÃO disparam mais o export do banco inteiro. Numa base de
  // 1 GB, cada foto gravada custava um export de 1 GB (10-500s de tela presa
  // — o diagnóstico real mostrou o festival de travadas no Mês a mês). Agora
  // as fotos vão para um cofre próprio no IndexedDB (~0,1 MB): o banco grande
  // só é exportado quando há DADO REAL novo (importação, cálculo, cadastro).
  persistirCacheDebounced(ms = 1500) {
    if (!this.db) return Promise.resolve();
    if (!this._fotosPromise) {
      this._fotosPromise = new Promise((res) => { this._fotosResolve = res; });
    }
    clearTimeout(this._fotosTimer);
    this._fotosTimer = setTimeout(() => { this._flushFotos(); }, ms);
    return this._fotosPromise;
  },

  async _flushFotos() {
    if (this._fotosTimer) { clearTimeout(this._fotosTimer); this._fotosTimer = null; }
    const r = this._fotosResolve;
    this._fotosPromise = null; this._fotosResolve = null;
    try { await this._gravarFotosNoIDB(); }
    catch (e) { console.warn('Falha persistindo fotos de cálculo:', e); }
    if (r) r();
  },

  async _gravarFotosNoIDB() {
    if (!this.db) return;
    // V613: antes da restauração do boot, NÃO espelhar — o salvar() da migração
    // sobrescreveria o cofre com a cópia velha de dentro do banco
    if (!this._fotosProntas) return;
    let rows = [];
    try { rows = this.query(`SELECT chave, fingerprint, payload, atualizado_em FROM vg_calc_cache`) || []; }
    catch (_) {}   // tabela ainda não existe nesta base
    let baseClassFp = null;
    try { baseClassFp = this.queryUnica(`SELECT valor FROM config_sistema WHERE chave = 'BASE_CLASS_FP'`)?.valor || null; }
    catch (_) {}
    const idb = await this._abrirIDB();
    await new Promise((resolve, reject) => {
      const tx = idb.transaction(this.IDB_STORE, 'readwrite');
      tx.objectStore(this.IDB_STORE).put(JSON.stringify({ v: 1, fotos: rows, baseClassFp }), this.IDB_KEY_FOTOS);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transação abortada'));   // V838
    });
  },

  async _restaurarFotosDoIDB() {
    try {
      const idb = await this._abrirIDB();
      const raw = await new Promise((resolve) => {
        const tx = idb.transaction(this.IDB_STORE, 'readonly');
        const rq = tx.objectStore(this.IDB_STORE).get(this.IDB_KEY_FOTOS);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => resolve(null);
      });
      if (!raw) return;
      const dados = JSON.parse(raw);
      const fotos = Array.isArray(dados) ? dados : (dados.fotos || []);
      if (fotos.length) {
        this.db.exec(`CREATE TABLE IF NOT EXISTS vg_calc_cache (
          chave TEXT PRIMARY KEY, fingerprint TEXT, payload TEXT,
          atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);
        for (const f of fotos) {
          this.executar(`INSERT OR REPLACE INTO vg_calc_cache (chave, fingerprint, payload, atualizado_em)
                         VALUES (?,?,?,?)`, [f.chave, f.fingerprint, f.payload, f.atualizado_em || null]);
        }
        console.log(`✓ ${fotos.length} fotos de cálculo restauradas do cofre`);
      }
      // V613: fingerprint da Base Tabela (V596) viaja no mesmo cofre
      if (!Array.isArray(dados) && dados.baseClassFp) {
        try {
          this.executar(`INSERT OR REPLACE INTO config_sistema (chave, valor) VALUES ('BASE_CLASS_FP', ?)`, [dados.baseClassFp]);
        } catch (_) {}
      }
    } catch (e) { console.warn('Restauração das fotos de cálculo:', e); }
    finally { this._fotosProntas = true; }   // V613: libera o espelhamento do cofre
  },

  async _flushSalvar(force) {
    if (this._salvarTimer) { clearTimeout(this._salvarTimer); this._salvarTimer = null; }
    // V839: sessão suspensa (o banco foi substituído em outra janela) — o
    // flush resolve quem espera e NÃO grava (inclusive o flush de saída).
    if (this._epocaVencida) {
      const r0 = this._salvarResolve;
      this._salvarPromise = null; this._salvarResolve = null;
      if (r0) r0();
      return;
    }
    // V686: o flush do debounce respeita a MESMA janela de coalescência do
    // salvar() — sem isso, um salvarDebounced() das telas furava a janela e
    // cada gesto pagava um persist completo (em base de 900MB, minutos de
    // disco). Reagenda mantendo a promise viva; o flush de SAÍDA (pagehide/
    // aba oculta/flushPendente) passa force=true e persiste JÁ.
    if (!force && this.db) {
      const carimbo0 = this._carimboEscrita();
      const sujo = !(carimbo0 && carimbo0 === this._carimboExportado && this._ultimoExportTam);
      if (sujo) {
        const espera = this._exportEmAndamento ? 2000 : this._janelaRestanteMs();
        if (espera > 0) {
          this._salvarTimer = setTimeout(() => { this._flushSalvar(); }, espera);
          return;
        }
      }
    }
    const r = this._salvarResolve;
    this._salvarPromise = null; this._salvarResolve = null;
    try {
      if (this.db) {
        // V644: nada foi escrito desde o último export → pula o export pesado
        const carimbo = this._carimboEscrita();
        if (carimbo && carimbo === this._carimboExportado && this._ultimoExportTam) {
          this._gravarFotosNoIDB().catch(() => {});
          if (r) r();
          return;
        }
        // V659: pipeline compartilhado
        await this._exportarEPersistir();
      }
    } catch (e) {
      console.error('Falha persistindo banco (flush):', e);
    }
    if (r) r();
  },

  _abrirIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.IDB_NAME, this.IDB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains(this.IDB_STORE)) {
          idb.createObjectStore(this.IDB_STORE);
        }
      };
    });
  },

  // ── V650: gravação do banco no IndexedDB via WEB WORKER ────────────────
  // O put de ~1 GB na main thread congelava a tela por vários segundos (a
  // clonagem estruturada + transação rodavam no fio da interface). Agora o
  // buffer é ENTREGUE a um worker por transferência (zero-cópia, ~50ms) e a
  // escrita no disco acontece em paralelo — o congelamento do salvamento cai
  // para só o custo do export do sql.js. Com o ARQUIVO VINCULADO (V592)
  // ativo, o worker recebe uma cópia (o original segue para o arquivo).
  // Qualquer falha (worker/IDB indisponível) volta ao caminho direto antigo.
  _workerIDB: null,
  _workerIDBFalhou: false,
  _workerIDBSeq: 0,
  _obterWorkerIDB() {
    if (this._workerIDBFalhou) return null;
    if (this._workerIDB) return this._workerIDB;
    try {
      const codigo = `
        let db = null;
        let fila = Promise.resolve();   // V686: um persist por vez (sem interleave de buffers gigantes)
        let manifesto;                  // V820: hashes das fatias já gravadas (undefined = ainda não lido do IDB)
        const abrir = (nome, versao, store) => new Promise((res, rej) => {
          if (db) return res(db);
          const rq = indexedDB.open(nome, versao);
          rq.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(store)) d.createObjectStore(store);
          };
          rq.onsuccess = () => { db = rq.result; res(db); };
          rq.onerror = () => rej(rq.error);
        });
        // V820: hash rápido de uma fatia (FNV-1a em palavras de 32 bits, com um
        // segundo acumulador independente — colisão dupla é ~2^-64). Fatias são
        // alinhadas a 8MB, então a visão Uint32 nunca desalinha.
        const hashFatia = (u8) => {
          let a = 0x811c9dc5 | 0, b = 0x12345679 | 0;
          const n4 = u8.byteLength >>> 2;
          const w = new Uint32Array(u8.buffer, u8.byteOffset, n4);
          for (let i = 0; i < n4; i++) {
            a = Math.imul(a ^ w[i], 16777619);
            b = (Math.imul(b ^ w[i], 0x85ebca6b) + i) | 0;
          }
          for (let i = n4 << 2; i < u8.byteLength; i++) {
            a = Math.imul(a ^ u8[i], 16777619);
            b = (Math.imul(b ^ u8[i], 0x85ebca6b) + i) | 0;
          }
          return a + ':' + b;
        };
        const CH = 8388608;   // 8MB por fatia (~113 fatias num banco de 900MB)
        const processa = async (m) => {
          const { seq, nome, versao, store, chave, bytes, arquivoHandle, epoca } = m;
          try {
            const d = await abrir(nome, versao, store);
            const t0 = performance.now();   // V659: tempo real da transação (diag)
            /**
             * V820: PERSISTÊNCIA POR FATIAS. O banco de ~900MB era regravado
             * INTEIRO no IndexedDB a cada salvamento, mesmo quando a sessão só
             * mudou alguns KB (uma marcação, uma regra). O SQLite escreve
             * páginas no lugar — uma edição pequena muda POUCAS fatias. Então:
             * hash de cada fatia, comparação com o manifesto da última gravação
             * e put SÓ do que mudou. Fatias + manifesto vão na MESMA transação
             * (atômica: ou grava tudo, ou o estado anterior fica intacto).
             *
             * V836: o manifesto NUNCA é confiado da memória — ele é RELIDO do
             * IDB a cada gravação. Com duas janelas do sistema abertas, cada
             * worker diffava contra o manifesto que TINHA na memória; os dois
             * atropelavam-se e o conjunto de fatias ficava misto — o banco não
             * abria mais ("fatia N ausente ou com tamanho errado"). Relendo,
             * o diff compara com o que está REALMENTE no disco e cada gravação
             * deixa o conjunto inteiro consistente, aconteça o que acontecer
             * na outra janela.
             */
            /**
             * V837: CONCORRÊNCIA FECHADA DE VEZ. O diff é calculado contra um
             * manifesto lido do disco; na hora de gravar, o manifesto é RELIDO
             * DENTRO da própria transação readwrite — se mudou (outra janela
             * gravou entre a leitura e a transação), a transação ABORTA sem
             * escrever nada e o processo recomeça com o estado novo. Depois de
             * 2 conflitos seguidos, a rodada final regrava TODAS as fatias
             * (sem verificação): um conjunto completo é consistente por
             * construção. Resultado: NÃO EXISTE intercalação de duas janelas
             * que deixe fatias e manifesto fora de sincronia.
             */
            const lerMan = () => new Promise((res) => {
              const tx = d.transaction(store, 'readonly');
              const rq = tx.objectStore(store).get(chave);
              rq.onsuccess = () => {
                const v = rq.result;
                res(v && v.v === 2 && Array.isArray(v.hashes) && v.ch === CH ? v : null);
              };
              rq.onerror = () => res(null);
            });
            const assina = (man) => man
              ? man.tam + '|' + man.hashes.join(',') + '|' + (man.gz || []).join(',') : '';
            const n = Math.max(1, Math.ceil(bytes.byteLength / CH));
            const hashes = new Array(n);
            for (let i = 0; i < n; i++) {
              hashes[i] = hashFatia(bytes.subarray(i * CH, Math.min((i + 1) * CH, bytes.byteLength)));
            }
            // V832: fatia gravada COMPRIMIDA (gzip nativo) — o IndexedDB encolhe
            // ~4-5× e a abertura lê 4-5× menos disco. Hashes sempre do conteúdo
            // CRU — o diff não muda com a compressão.
            const comprimir = async (fat) => {
              if (typeof CompressionStream !== 'undefined') {
                try {
                  const comp = new Uint8Array(await new Response(
                    new Blob([fat]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
                  if (comp.byteLength < fat.byteLength) return { dados: comp, flag: 1 };
                } catch (_) { /* sem compressão nesta fatia */ }
              }
              // V838: fatia CRUA vai como CÓPIA própria — o structured clone de
              // uma view serializa o ArrayBuffer INTEIRO (o banco todo!) por
              // trás; um slice() de 8MB evita gravar ~900MB por fatia crua
              return { dados: fat.slice(), flag: 0 };
            };
            let fatias = 0, bytesGravados = 0;
            const fatiasTotal = n;
            for (let rodada = 0; ; rodada++) {
              const cheia = rodada >= 2;   // 3ª rodada: regrava tudo, sem verificação
              const base = cheia ? null : await lerMan();
              const velho = base ? base.hashes : [];
              const gz = (base && Array.isArray(base.gz) ? base.gz.slice(0, n) : []);
              while (gz.length < n) gz.push(0);
              const mudou = [];
              for (let i = 0; i < n; i++) if (cheia || hashes[i] !== velho[i]) mudou.push(i);
              const aGravar = [];
              bytesGravados = 0;
              for (const i of mudou) {
                const fat = bytes.subarray(i * CH, Math.min((i + 1) * CH, bytes.byteLength));
                const c = await comprimir(fat);
                gz[i] = c.flag;
                bytesGravados += c.dados.byteLength;
                aGravar.push([i, c.dados]);
              }
              const esperada = assina(base);
              const okTx = await new Promise((res, rej) => {
                const tx = d.transaction(store, 'readwrite');
                const st = tx.objectStore(store);
                let conflito = false;
                let epocaVelha = false;
                // V839: ÉPOCA conferida DENTRO da transação (FIFO: resolve
                // antes do manifesto). Se o disco tem uma época mais nova,
                // outra janela RESETOU/RESTAUROU o banco — a gravação desta
                // sessão (que ainda carrega o banco antigo em memória) seria
                // exatamente o atropelo que desfaz a intenção do usuário.
                // Recusa DEFINITIVA, sem retry.
                const rqE = st.get('banco_epoca');
                rqE.onsuccess = () => {
                  if ((Number(rqE.result) || 0) > (epoca || 0)) {
                    epocaVelha = true;
                    try { tx.abort(); } catch (_) {}
                  }
                };
                rqE.onerror = () => {};
                const rq = st.get(chave);   // relido DENTRO da transação
                rq.onsuccess = () => {
                  if (epocaVelha) return;
                  const v = rq.result;
                  const atual = v && v.v === 2 && Array.isArray(v.hashes) && v.ch === CH ? v : null;
                  if (!cheia && assina(atual) !== esperada) {
                    conflito = true;
                    try { tx.abort(); } catch (_) {}
                    return;
                  }
                  if (cheia || !atual) {
                    // V838: sem manifesto válido no disco (blob legado/reset) ou
                    // regravação completa — varre TODAS as fatias antigas antes
                    // de regravar (nada de órfã ocupando disco para sempre)
                    st.delete(IDBKeyRange.bound(chave + '::fatia::', chave + '::fatia::￿'));
                  } else {
                    const antigos = Math.max(atual.hashes.length, velho.length);
                    for (let i = n; i < antigos; i++) st.delete(chave + '::fatia::' + i);
                  }
                  for (const [i, dados] of aGravar) st.put(dados, chave + '::fatia::' + i);
                  st.put({ v: 2, tam: bytes.byteLength, ch: CH, hashes, gz }, chave);
                };
                rq.onerror = () => { try { tx.abort(); } catch (_) {} };
                tx.oncomplete = () => res(true);
                tx.onabort = () => {
                  if (epocaVelha) {
                    const e = new Error('o banco foi substituído/restaurado em outra janela');
                    e.epocaNova = true;
                    return rej(e);
                  }
                  return conflito ? res(false) : rej(tx.error || new Error('transação abortada'));
                };
                tx.onerror = () => {};   // o onabort decide
              });
              if (okTx) { fatias = mudou.length; break; }
              // conflito: outra janela gravou no meio — recomeça com o estado novo
            }
            const ms = performance.now() - t0;
            // V686: arquivo vinculado gravado AQUI (fora da main thread) —
            // depois do IndexedDB (o primário nunca espera o arquivo).
            let arqMs = null, arqOk = null, arqErro = null;
            if (arquivoHandle) {
              const t1 = performance.now();
              try {
                const wtr = await arquivoHandle.createWritable();
                await wtr.write(bytes);
                await wtr.close();
                arqOk = true;
              } catch (err) { arqOk = false; arqErro = String((err && err.message) || err); }
              arqMs = performance.now() - t1;
            }
            self.postMessage({ seq, ok: true, ms, fatias, fatiasTotal, bytesGravados, arqMs, arqOk, arqErro });
          } catch (err) {
            self.postMessage({ seq, ok: false, erro: String((err && err.message) || err),
                               epocaNova: !!(err && err.epocaNova) });
          }
        };
        self.onmessage = (e) => {
          // V820: reset/importação apagou ou trocou o que está no IDB por fora
          // — o manifesto em memória não vale mais; relê na próxima gravação
          if (e.data && e.data.esquecerManifesto) { fila = fila.then(() => { manifesto = undefined; }); return; }
          fila = fila.then(() => processa(e.data));
        };`;
      const url = URL.createObjectURL(new Blob([codigo], { type: 'text/javascript' }));
      const w = new Worker(url);
      w._pend = new Map();
      // V838: worker morto (memória/erro de carga) não pode pendurar o app —
      // rejeita TODOS os persists pendentes e degrada para o caminho direto
      w.onerror = (e) => {
        console.warn('[banco] worker IDB caiu:', (e && e.message) || e);
        this._workerIDBFalhou = true;
        for (const [, p] of w._pend) { try { p.rej(new Error('worker IDB caiu')); } catch (_) {} }
        w._pend.clear();
      };
      w.onmessageerror = w.onerror;
      w.onmessage = (e) => {
        const p = w._pend.get(e.data.seq);
        if (!p) return;
        w._pend.delete(e.data.seq);
        if (e.data.ok) p.res(e.data);
        else {
          const err = new Error(e.data.erro || 'worker IDB');
          if (e.data.epocaNova) err.epocaNova = true;   // V839
          p.rej(err);
        }
      };
      this._workerIDB = w;
      return w;
    } catch (_) {
      this._workerIDBFalhou = true;
      return null;
    }
  },

  async _gravarNoIndexedDB(bytes, fases) {
    const w = this._obterWorkerIDB();
    if (w) {
      // V686: o arquivo vinculado vai JUNTO na mensagem (handle é clonável) e
      // é gravado DENTRO do worker — main thread livre. O AtlasArquivoBanco
      // decide se esta rodada grava (throttle p/ banco grande) e recebe o
      // resultado de volta (última gravação / erro / defasado).
      let arquivoHandle = null;
      let arqPendente = false;   // avisamos o AtlasArquivoBanco aconteça o que acontecer
      try {
        if (window.AtlasArquivoBanco && AtlasArquivoBanco.paraWorker) {
          arquivoHandle = AtlasArquivoBanco.paraWorker(bytes.length) || null;
          arqPendente = !!arquivoHandle;
        }
      } catch (_) { arquivoHandle = null; }
      const arqFim = (ok, erro) => {
        if (!arqPendente) return;
        arqPendente = false;
        try { if (window.AtlasArquivoBanco && AtlasArquivoBanco.resultadoWorker) AtlasArquivoBanco.resultadoWorker(ok, erro); } catch (_) {}
      };
      try {
        // V659: transferência SEMPRE zero-cópia (o buffer detacha; quem grava
        // o arquivo é o worker, com o mesmo buffer, depois do IndexedDB).
        const seq = ++this._workerIDBSeq;
        await new Promise((res, rej) => {
          w._pend.set(seq, { res: (d) => {
            if (fases && d.ms != null) fases.idbTx = d.ms;
            if (fases && d.fatiasTotal != null) {   // V820: diag mostra o diff
              fases.fatias = d.fatias; fases.fatiasTotal = d.fatiasTotal;
              fases.bytesGravados = d.bytesGravados;
            }
            if (fases && d.arqMs != null) fases.arquivo = d.arqMs;
            if (d.arqOk != null) arqFim(!!d.arqOk, d.arqErro);
            res();
          }, rej });
          try {
            w.postMessage({ seq, nome: this.IDB_NAME, versao: this.IDB_VERSION,
                            store: this.IDB_STORE, chave: this.IDB_KEY, bytes, arquivoHandle,
                            epoca: this._epoca || 0 },
                          [bytes.buffer]);
          } catch (e) {
            // V695: se o próprio HANDLE não clonar (DataCloneError), o worker
            // está saudável — reenvia SEM o handle em vez de degradar pro
            // caminho direto pra sempre. O arquivo fica pro fallback/exit.
            if (arquivoHandle && bytes.byteLength) {
              arqFim(false, 'handle não clonável: ' + String((e && e.message) || e));
              try {
                w.postMessage({ seq, nome: this.IDB_NAME, versao: this.IDB_VERSION,
                                store: this.IDB_STORE, chave: this.IDB_KEY, bytes, arquivoHandle: null,
                                epoca: this._epoca || 0 },
                              [bytes.buffer]);
              } catch (e2) { w._pend.delete(seq); rej(e2); }
            } else { w._pend.delete(seq); rej(e); }
          }
        });
        arqFim(false, null);   // worker respondeu sem info do arquivo (não gravou)
        if (fases) fases.caminho = 'worker';
        return;
      } catch (e) {
        arqFim(false, String((e && e.message) || e));
        // V839: época mais nova no disco — o worker está SAUDÁVEL; a recusa é
        // deliberada e o caminho direto seria o mesmo atropelo. Sobe direto
        // para o _exportarEPersistir suspender os salvamentos desta janela.
        if (e && e.epocaNova) throw e;
        console.warn('[banco] gravação via worker falhou — usando o caminho direto:', e);
        this._workerIDBFalhou = true;
        if (!bytes.byteLength) {
          // buffer já transferido: nada a gravar nesta rodada — anula o
          // carimbo pro PRÓXIMO salvar exportar de novo (V659; antes o skip
          // V644 prendia o dado só em memória com o app mostrando "salvo")
          this._carimboExportado = null;
          if (fases) fases.caminho = 'worker-falhou';
          return;
        }
      }
    }
    if (fases) fases.caminho = 'direto';
    const idb = await this._abrirIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(this.IDB_STORE, 'readwrite');
      const store = tx.objectStore(this.IDB_STORE);
      // V839: mesma arbitragem de ÉPOCA do worker — outra janela resetou/
      // restaurou (época mais nova no disco)? Esta gravação é recusada.
      let epocaVelha = false;
      const rqE = store.get('banco_epoca');
      rqE.onsuccess = () => {
        if ((Number(rqE.result) || 0) > (this._epoca || 0)) {
          epocaVelha = true;
          try { tx.abort(); } catch (_) {}
        }
      };
      rqE.onerror = () => {};
      // V838: o blob legado substitui o manifesto — as fatias antigas viram
      // lixo inacessível: somem na mesma transação
      store.delete(IDBKeyRange.bound(this.IDB_KEY + '::fatia::', this.IDB_KEY + '::fatia::￿'));
      store.put(bytes, this.IDB_KEY);
      // V838: durabilidade SÓ no oncomplete — o onsuccess do put não garante
      // o commit (quota/IO são verificados na hora de comitar)
      tx.oncomplete = () => resolve();
      tx.onerror = () => {};   // o onabort decide (erro de request também aborta a tx)
      tx.onabort = () => {
        if (epocaVelha) {
          const e = new Error('o banco foi substituído/restaurado em outra janela');
          e.epocaNova = true;
          return reject(e);
        }
        return reject(tx.error || new Error('transação abortada'));
      };
    });
  },

  // ── V839: ÉPOCA do banco — arbitragem de INTENÇÃO entre janelas ─────────
  // Cada reset/restauração/importação grava uma época nova (timestamp) no
  // IndexedDB. O worker confere a época DENTRO da transação de gravação: se o
  // disco tem uma época mais nova que a desta sessão, a gravação é recusada
  // de vez — o salvamento de uma janela velha nunca desfaz o reset/restauração
  // feito na outra.
  async _lerChaveIDB(k) {
    const idb = await this._abrirIDB();
    return new Promise((resolve) => {
      const tx = idb.transaction(this.IDB_STORE, 'readonly');
      const rq = tx.objectStore(this.IDB_STORE).get(k);
      rq.onsuccess = () => resolve(rq.result != null ? rq.result : null);
      rq.onerror = () => resolve(null);
    });
  },
  async _gravarChaveIDB(k, v) {
    const idb = await this._abrirIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(this.IDB_STORE, 'readwrite');
      tx.objectStore(this.IDB_STORE).put(v, k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transação abortada'));
    });
  },
  async _novaEpoca() {
    this._epoca = Date.now();
    try { await this._gravarChaveIDB('banco_epoca', this._epoca); } catch (e) { console.warn('[banco] época:', e); }
  },

  /** V835: assinatura do manifesto — muda quando QUALQUER fatia muda */
  _assinaturaManifesto(m) {
    return m ? `${m.tam}|${(m.hashes || []).join(',')}|${(m.gz || []).join(',')}` : '';
  },
  async _lerManifesto(idb) {
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(this.IDB_STORE, 'readonly');
      const req = tx.objectStore(this.IDB_STORE).get(this.IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  /** V838: o MESMO hash do worker, para validar cada fatia na remontagem */
  _hashFatia(u8) {
    if (u8.byteOffset % 4 !== 0) u8 = u8.slice();   // alinhamento da visão de 32 bits
    let a = 0x811c9dc5 | 0, b = 0x12345679 | 0;
    const n4 = u8.byteLength >>> 2;
    const w = new Uint32Array(u8.buffer, u8.byteOffset, n4);
    for (let i = 0; i < n4; i++) {
      a = Math.imul(a ^ w[i], 16777619);
      b = (Math.imul(b ^ w[i], 0x85ebca6b) + i) | 0;
    }
    for (let i = n4 << 2; i < u8.byteLength; i++) {
      a = Math.imul(a ^ u8[i], 16777619);
      b = (Math.imul(b ^ u8[i], 0x85ebca6b) + i) | 0;
    }
    return a + ':' + b;
  },

  async _lerDoIndexedDB() {
    const idb = await this._abrirIDB();
    /**
     * V835/V838: a GRAVAÇÃO é atômica (fatias + manifesto numa transação), mas
     * a LEITURA acontece em vários lotes. Se OUTRA janela salvar no meio, a
     * montagem falha (tamanho OU hash da fatia não bate com o manifesto) — e
     * aqui a leitura RECOMEÇA do zero com o estado novo, inclusive quando o
     * formato mudou por completo (outra janela restaurou blob legado ou
     * resetou). Só depois de 4 recomeços o erro é real e sobe.
     */
    for (let tentativa = 0; ; tentativa++) {
      const bruto = await this._lerManifesto(idb);
      // formato antigo (blob único) ou base vazia: devolve como está
      if (!(bruto && bruto.v === 2 && Array.isArray(bruto.hashes))) return bruto;
      const assinatura = this._assinaturaManifesto(bruto);
      try {
        return await this._lerFatias(idb, bruto);
      } catch (e) {
        let atual = null;
        try { atual = await this._lerManifesto(idb); } catch (_) {}
        const atualV2 = atual && atual.v === 2 && Array.isArray(atual.hashes);
        const mudou = !atualV2 || this._assinaturaManifesto(atual) !== assinatura;
        if (mudou && tentativa < 4) {
          console.warn(`[banco] o banco mudou no meio da leitura (outra janela) — recomeçando (${tentativa + 1}/4)`);
          this._msgBoot('O banco foi salvo por outra janela — recomeçando a leitura…');
          continue;
        }
        // V839: esgotou COM o manifesto mudando = outra janela segue salvando
        // (o IndexedDB está vivo e íntegro — quem trata NÃO pode restaurar)
        if (mudou) e.outraJanelaAtiva = true;
        throw e;
      }
    }
  },

  async _lerFatias(idb, bruto) {
    const n = Math.max(1, Math.ceil(bruto.tam / bruto.ch));
    const out = new Uint8Array(bruto.tam);
    /**
     * V827/V830: as fatias são lidas em LOTES — todas de uma tacada
     * materializava mais um banco inteiro em memória (pico que derrubava
     * máquina justa de RAM: "Out of Memory" ao abrir); uma por vez, com uma
     * transação para cada, deixou a ABERTURA lenta em disco mecânico
     * (~113 idas ao IndexedDB em série). Lotes de 12 (~96MB) numa transação
     * só equilibram: velocidade de leitura grande, pico de memória pequeno.
     */
    const LOTE = 12;
    const gzArr = Array.isArray(bruto.gz) ? bruto.gz : [];
    const mbTot = Math.round(bruto.tam / 1048576);
    // fatia ausente/corrompida/misturada: FALHA ALTO — abrir um banco pela
    // metade seria pior que não abrir. Quem trata é o chamador (V835), e a
    // mensagem final já diz o caminho de recuperação.
    const falha = (idx) => new Error(
      `fatia ${idx} do banco ausente ou com tamanho errado no IndexedDB. `
      + `Feche OUTRAS janelas/abas do sistema e recarregue (F5). `
      + `Se persistir, restaure a cópia automática em Backup → Vincular arquivo existente.`);
    for (let i0 = 0; i0 < n; i0 += LOTE) {
      const fim = Math.min(i0 + LOTE, n);
      // lê o lote cru numa transação só…
      const lote = await new Promise((resolve, reject) => {
        const tx = idb.transaction(this.IDB_STORE, 'readonly');
        const st = tx.objectStore(this.IDB_STORE);
        const vals = [];
        let falta = fim - i0, erro = null;
        for (let i = i0; i < fim; i++) {
          const idx = i;
          const rq = st.get(this.IDB_KEY + '::fatia::' + idx);
          rq.onsuccess = () => {
            vals.push({ idx, f: rq.result });
            if (!--falta) (erro ? reject(erro) : resolve(vals));
          };
          rq.onerror = () => { erro = erro || rq.error; if (!--falta) reject(erro); };
        }
      });
      // …e monta (descomprimindo as fatias marcadas — gzip nativo, V832)
      for (const { idx, f } of lote) {
        let u8 = f instanceof Uint8Array ? f : (f ? new Uint8Array(f) : null);
        if (u8 && gzArr[idx]) {
          if (typeof DecompressionStream === 'undefined') {
            throw new Error('fatias comprimidas exigem um navegador com DecompressionStream (Chrome/Edge atuais)');
          }
          try {
            u8 = new Uint8Array(await new Response(
              new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
          } catch (e) { throw falha(idx); }   // V835: gzip inválido = fatia de outra safra
        }
        const esperado = Math.min(bruto.ch, bruto.tam - idx * bruto.ch);
        if (!u8 || u8.byteLength !== esperado) throw falha(idx);
        // V838: o TAMANHO não basta — uma fatia trocada por outra janela pode
        // ter o mesmo tamanho. O hash CRU tem que bater com o manifesto.
        if (this._hashFatia(u8) !== bruto.hashes[idx]) throw falha(idx);
        out.set(u8, idx * bruto.ch);
      }
      // V832: progresso visível — carregamento nunca mais parece travado
      const mbLido = Math.round(Math.min(fim * bruto.ch, bruto.tam) / 1048576);
      this._msgBoot(`Abrindo o banco — ${mbLido} de ${mbTot} MB…`);
      this._traceBoot('ler-idb', `${mbLido}/${mbTot} MB`);
    }
    return out;
  },

  async _apagarIndexedDB() {
    const idb = await this._abrirIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(this.IDB_STORE, 'readwrite');
      const store = tx.objectStore(this.IDB_STORE);
      store.delete(this.IDB_KEY);
      store.delete(this.IDB_KEY_FOTOS);   // V613: reset apaga também o cofre das fotos
      // V820: apaga as fatias do formato novo (chave::fatia::N) e manda o
      // worker esquecer o manifesto em memória — sem isso, o próximo salvar
      // gravaria um diff em cima de fatias que não existem mais
      store.delete(IDBKeyRange.bound(this.IDB_KEY + '::fatia::', this.IDB_KEY + '::fatia::￿'));
      tx.oncomplete = () => {
        try { if (this._workerIDB) this._workerIDB.postMessage({ esquecerManifesto: true }); } catch (_) {}
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transação abortada'));   // V838
    });
  },

  // ==========================================================================
  // OPERAÇÕES SQL (wrappers convenientes)
  // ==========================================================================

  /**
   * Executa SELECT e retorna lista de objetos.
   * Ex: query("SELECT * FROM medicos WHERE ativo = ?", [1])
   */
  query(sql, params = []) {
    if (!this.db) throw new Error('Banco não inicializado');
    const stmt = this.db.prepare(sql);
    // V491: free() em finally — se bind/step lançasse, o statement vazava no
    // heap WASM (acumula em sessões longas, já que várias telas engolem erros).
    try {
      stmt.bind(params);
      const linhas = [];
      while (stmt.step()) {
        linhas.push(stmt.getAsObject());
      }
      return linhas;
    } finally {
      stmt.free();
    }
  },

  /**
   * V857: LEITURA EM MASSA — mesmas linhas, mesma ordem, transporte barato.
   *
   * query() monta UM OBJETO JS por linha (getAsObject). Em varredura grande
   * isso domina o custo: medido na base de 1 milhão de linhas de produção,
   * 2.572ms contra 1.116ms lendo em ARRAYS (2,3× mais rápido) — e ainda evita
   * a montanha de objetos que depois vira trabalho do coletor de lixo (0,7s
   * no perfil da abertura).
   *
   * Devolve { colunas, valores }: `colunas` são os nomes na ordem do SELECT e
   * `valores` é uma lista de arrays. Use quando a consulta varre MUITAS linhas
   * e o resultado é reduzido logo em seguida (mapas, somas, agrupamentos).
   * Para punhados de linhas, query() continua mais legível.
   */
  queryArrays(sql, params = []) {
    if (!this.db) throw new Error('Banco não inicializado');
    if (!params || !params.length) {
      const res = this.db.exec(sql);   // uma travessia só do WASM
      return res && res.length ? { colunas: res[0].columns, valores: res[0].values }
                               : { colunas: [], valores: [] };
    }
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const valores = [];
      while (stmt.step()) valores.push(stmt.get());
      return { colunas: stmt.getColumnNames(), valores };
    } finally {
      stmt.free();
    }
  },

  /** Executa SELECT esperando uma única linha (ou null). */
  queryUnica(sql, params = []) {
    const r = this.query(sql, params);
    return r.length > 0 ? r[0] : null;
  },

  /**
   * Executa INSERT/UPDATE/DELETE.
   * Retorna { changes: N, lastInsertRowId: X } via API do sql.js.
   */
  executar(sql, params = []) {
    if (!this.db) throw new Error('Banco não inicializado');
    const stmt = this.db.prepare(sql);
    // V491: free() em finally (mesmo motivo do query acima)
    try {
      stmt.bind(params);
      stmt.step();
    } finally {
      stmt.free();
    }
    const changes = this.db.getRowsModified();
    // V664: QUALQUER mudança de regra/valores entra AUTOMATICAMENTE na Linha
    // do Tempo — o registro é agregado por área+dia (sem poluir com 1 evento
    // por clique) e só conta escritas que mudaram linhas de verdade.
    if (changes > 0) { try { this._tlAutoDetectar(sql, changes); } catch (_) {} }
    return {
      changes,
      lastInsertRowId: this._lastInsertRowId(),
    };
  },

  // ── V664: LINHA DO TEMPO AUTOMÁTICA de mudanças de regra ─────────────────
  // Tabelas de REGRA/VALOR são vigiadas na saída do executar(); dados
  // operacionais (pagamentos, marcações, produção, QVIS) ficam de fora.
  _tlAutoBuf: null,
  _tlAutoTimer: null,
  _tlAreaDe(tab) {
    if (tab === 'tabela_repasse') return 'Base Tabela · valores de repasse';
    if (tab === 'tabela_repasse_excecao') return 'Exceções · sobreposições por médico';
    if (tab === 'excecao_desempenho_bloqueio') return 'Exceções · bloqueios de desempenho';
    if (tab.indexOf('pacote_') === 0) return 'Pacotes de consulta';
    if (tab.indexOf('perfil_') === 0) return 'Perfis particulares';
    if (tab === 'duplicidade_excecao') return 'Isenções de duplicidade';
    if (tab === 'config_opme' || tab === 'opme_termos_elegiveis' || tab === 'opme_regra_medico'
        || tab === 'opme_regra_produto' || tab === 'opme_regra_papel' || tab === 'opme_valor_fixo'
        || tab === 'opme_producao_extras') return 'OPME · regras e ajustes';
    if (tab === 'config_estrabismo') return 'Estrabismo · valores';
    if (tab === 'lio_exceto_termos' || tab === 'lio_adicional_tabela') return 'LIO · ajustes';
    // V699: base de cálculo do módulo Externos também é regra de valor
    if (tab === 'externos_base_proc' || tab === 'externos_base_lio'
        || tab === 'externos_base_opme' || tab === 'externos_config') return 'Externos · base de cálculo';
    return null;
  },
  _tlAutoDetectar(sql, changes) {
    const m = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z_]+)/i.exec(String(sql || ''));
    if (!m) return;
    const area = this._tlAreaDe(m[1].toLowerCase());
    if (!area) return;
    if (!this._tlAutoBuf) this._tlAutoBuf = new Map();
    const e = this._tlAutoBuf.get(area) || { n: 0, detalhes: [] };
    e.n += (changes || 1);
    this._tlAutoBuf.set(area, e);
    clearTimeout(this._tlAutoTimer);
    this._tlAutoTimer = setTimeout(() => { try { this._tlAutoFlush(); } catch (_) {} }, 1500);
  },
  // V666: bump explícito do contador de uma área — para mudanças em tabelas
  // que NÃO são vigiadas pelo _tlAutoDetectar (ex.: snapshots de versão
  // publicada, cujos INSERT..SELECT em massa do publicar não podem poluir a
  // linha do tempo; a edição pontual registra a si mesma por aqui).
  _tlAutoContar(area, n) {
    if (!area) return;
    if (!this._tlAutoBuf) this._tlAutoBuf = new Map();
    const e = this._tlAutoBuf.get(area) || { n: 0, detalhes: [] };
    e.n += (n || 1);
    this._tlAutoBuf.set(area, e);
    clearTimeout(this._tlAutoTimer);
    this._tlAutoTimer = setTimeout(() => { try { this._tlAutoFlush(); } catch (_) {} }, 1500);
  },
  // detalhe legível (ex.: Base Tabela "PROC · Executante · CONVENIO: 390 → 500")
  _tlAutoDetalhe(area, texto) {
    if (!this._tlAutoBuf) this._tlAutoBuf = new Map();
    const e = this._tlAutoBuf.get(area) || { n: 0, detalhes: [] };
    if (e.detalhes.length < 8) e.detalhes.push(String(texto || '').slice(0, 180));
    this._tlAutoBuf.set(area, e);
    clearTimeout(this._tlAutoTimer);
    this._tlAutoTimer = setTimeout(() => { try { this._tlAutoFlush(); } catch (_) {} }, 1500);
  },
  _tlAutoFlush() {
    const buf = this._tlAutoBuf;
    this._tlAutoBuf = null; this._tlAutoTimer = null;
    if (!buf || !buf.size || !this.db) return;
    try {
      this.db.exec(`CREATE TABLE IF NOT EXISTS timeline_eventos (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        data        TEXT NOT NULL,
        categoria   TEXT NOT NULL DEFAULT 'regra',
        titulo      TEXT NOT NULL,
        descricao   TEXT,
        impacto     TEXT,
        sinal       TEXT NOT NULL DEFAULT 'neutro',
        responsavel TEXT,
        criado_em   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        editado_em  TEXT,
        icone       TEXT
      )`);
    } catch (_) {}
    const ag = new Date();
    const dataISO = `${ag.getFullYear()}-${String(ag.getMonth() + 1).padStart(2, '0')}-${String(ag.getDate()).padStart(2, '0')}`;
    const hora = `${String(ag.getHours()).padStart(2, '0')}:${String(ag.getMinutes()).padStart(2, '0')}`;
    for (const [area, e] of buf) {
      const titulo = `⚙ ${area}`;
      try {
        const ex = this.queryUnica(
          `SELECT id, descricao FROM timeline_eventos
            WHERE data = ? AND titulo = ? AND responsavel = 'Registro automático' LIMIT 1`,
          [dataISO, titulo]);
        const linhasDet = e.detalhes.map(d => '• ' + d);
        if (ex) {
          const mTot = /Total do dia: (\d+)/.exec(ex.descricao || '');
          const tot = (mTot ? parseInt(mTot[1], 10) : 0) + e.n;
          const resto = String(ex.descricao || '').split('\n').filter(l => l && !/^Total do dia:/.test(l)).slice(0, 24);
          const desc = [`Total do dia: ${tot} mudança${tot === 1 ? '' : 's'} (última às ${hora}) — registro automático.`]
            .concat(resto).concat(linhasDet).join('\n').slice(0, 4000);
          this.executar(`UPDATE timeline_eventos SET descricao = ?, editado_em = CURRENT_TIMESTAMP WHERE id = ?`, [desc, ex.id]);
        } else {
          const desc = [`Total do dia: ${e.n} mudança${e.n === 1 ? '' : 's'} (última às ${hora}) — registro automático.`]
            .concat(linhasDet).join('\n').slice(0, 4000);
          try {
            this.executar(`INSERT INTO timeline_eventos (data, categoria, titulo, descricao, sinal, responsavel, icone)
                           VALUES (?, 'regra', ?, ?, 'neutro', 'Registro automático', '⚙')`, [dataISO, titulo, desc]);
          } catch (_) {
            // banco antigo sem a coluna icone (a tela migra ao abrir)
            this.executar(`INSERT INTO timeline_eventos (data, categoria, titulo, descricao, sinal, responsavel)
                           VALUES (?, 'regra', ?, ?, 'neutro', 'Registro automático')`, [dataISO, titulo, desc]);
          }
        }
      } catch (err) { console.warn('[banco] linha do tempo automática:', err); }
    }
    this.salvarDebounced();
  },

  _lastInsertRowId() {
    const r = this.query('SELECT last_insert_rowid() AS id');
    return r[0]?.id;
  },

  /** Executa script completo (vários statements separados por ;). */
  executarScript(sql) {
    if (!this.db) throw new Error('Banco não inicializado');
    this.db.exec(sql);
  },

  /** Conta registros de uma tabela. */
  contar(tabela, where = '', params = []) {
    const sql = `SELECT COUNT(*) AS n FROM ${tabela} ${where ? 'WHERE ' + where : ''}`;
    return this.queryUnica(sql, params).n;
  },

  // ==========================================================================
  // BACKUP / RESTAURAÇÃO
  // ==========================================================================

  /** Exporta banco como arquivo .db (download). */
  exportar(nomeArquivo = 'repasse_backup.db') {
    if (!this.db) throw new Error('Banco não inicializado');
    const bytes = this.db.export();
    const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    a.click();
    URL.revokeObjectURL(url);
  },

  /** Importa arquivo .db (substitui o atual). */
  async importar(arquivo) {
    const buffer = await arquivo.arrayBuffer();
    // V491: valida o arquivo ANTES de fechar o banco atual — antes, um .db
    // corrompido/não-SQLite deixava o app sem banco nenhum até recarregar.
    let novo;
    try {
      novo = new this.SQL.Database(new Uint8Array(buffer));
      novo.exec('SELECT 1');   // sanity check: o arquivo abre e responde SQL
    } catch (e) {
      try { novo?.close(); } catch (_) {}
      throw new Error('Arquivo inválido: não é um banco SQLite legível (' + e.message + ')');
    }
    if (this.db) this.db.close();
    this.db = novo;
    // V820: conexão NOVA — o carimbo do export antigo não compara com ela.
    // Sem anular, um schema_version coincidente cairia no skip V644 (import
    // sem persistir e sem invalidar os memos).
    this._carimboExportado = null;
    // V858: o .db pode vir de um pacote MAIS ANTIGO. Aplica schema, seeds e
    // migrações agora (CREATE/INSERT OR IGNORE são seguros) — antes disso a
    // importação entregava um banco sem as tabelas novas e as telas que
    // dependiam delas apareciam vazias, sem erro, até o próximo F5.
    try {
      this.db.exec(window.SCHEMA_SQL);
      this.db.exec(window.SEEDS_SQL);
      this._migrarColunas();
      this._garantirEstruturas();
    } catch (e) { console.warn('[banco] migração na importação:', e); }
    await this._novaEpoca();   // V839: importação é intenção nova (vale contra janelas velhas)
    await this.salvar({ imediato: true });   // V659: importação nunca espera a janela
    this._conferirVersaoDoPacote();   // V858: o arquivo pode vir de um pacote mais NOVO
  },

  /**
   * V837: auto-recuperação do BOOT — lê o .db do arquivo vinculado (sem
   * interação, quando a permissão já está concedida), valida e regrava a
   * cópia interna inteira. Devolve os bytes prontos para abrir, ou null.
   */
  async _tentarAutoRecuperacao() {
    try {
      if (!window.AtlasArquivoBanco || !AtlasArquivoBanco.lerBytesSilencioso) return null;
      const bytes = await AtlasArquivoBanco.lerBytesSilencioso();
      if (!bytes) return null;
      await this.restaurarDeArquivo(bytes, { semReload: true });
      this._recuperadoDoArquivo = true;
      console.warn('[banco] cópia interna RECUPERADA automaticamente do arquivo vinculado (.db)');
      try { window.Utilidades?.toast?.('✓ O banco foi recuperado automaticamente da cópia (.db).', 'success', 8000); } catch (_) {}
      return bytes;
    } catch (e) { console.warn('[banco] auto-recuperação falhou:', e); return null; }
  },

  /**
   * V836: recuperação SEM precisar abrir o app — usada pela tela "Erro ao
   * inicializar". Lê o .db da cópia automática (ou de um backup), valida o
   * cabeçalho SQLite, LIMPA o formato de fatias e grava o arquivo inteiro como
   * blob (o formato legado, que o boot sempre soube ler). O próximo salvamento
   * refatia e recomprime sozinho.
   */
  async restaurarDeArquivo(arquivo, opts = {}) {
    const buf = arquivo instanceof Uint8Array
      ? arquivo : new Uint8Array(await arquivo.arrayBuffer());
    // cabeçalho SQLite: "SQLite format 3" + byte NUL (16 bytes)
    const cab = 'SQLite format 3';
    const cabOk = buf.byteLength > 100 && buf[15] === 0
      && cab.split('').every((c, i) => buf[i] === c.charCodeAt(0));
    if (!cabOk) throw new Error('O arquivo escolhido não é um banco SQLite (.db) válido.');
    // V839: um .db TRUNCADO (sincronização parcial de nuvem, queda no meio da
    // gravação) passa na checagem de cabeçalho — o tamanho declarado pelo
    // próprio SQLite tem que caber no arquivo
    const pag = (buf[16] << 8) | buf[17];
    const pageSize = pag === 1 ? 65536 : pag;
    const nPag = ((buf[28] << 24) | (buf[29] << 16) | (buf[30] << 8) | buf[31]) >>> 0;
    const tamOk = pageSize >= 512 && (pageSize & (pageSize - 1)) === 0
      && (nPag === 0 || buf.byteLength >= pageSize * nPag);
    if (!tamOk) {
      throw new Error('O arquivo .db parece TRUNCADO/INCOMPLETO (sincronização parcial da nuvem?) — '
        + 'restauração bloqueada por segurança. Aguarde a sincronização terminar ou use outra cópia íntegra.');
    }
    await this._novaEpoca();   // V839: restauração é intenção nova — janelas velhas não a desfazem
    const idb = await this._abrirIDB();
    await new Promise((resolve, reject) => {
      const tx = idb.transaction(this.IDB_STORE, 'readwrite');
      const st = tx.objectStore(this.IDB_STORE);
      st.delete(IDBKeyRange.bound(this.IDB_KEY + '::fatia::', this.IDB_KEY + '::fatia::￿'));
      st.put(buf, this.IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transação abortada'));
    });
    try { if (this._workerIDB) this._workerIDB.postMessage({ esquecerManifesto: true }); } catch (_) {}
    if (!opts.semReload) location.reload();
    return buf.byteLength;
  },

  /** APAGA TUDO. Cria banco do zero. */
  async resetar() {
    if (this.db) this.db.close();
    await this._apagarIndexedDB();
    // V839: reset é intenção nova — a época impede que o salvamento de uma
    // janela velha "ressuscite" o banco apagado
    await this._novaEpoca();
    this.db = new this.SQL.Database();
    this.db.exec(window.SCHEMA_SQL);
    this.db.exec(window.SEEDS_SQL);
    this._carimboExportado = null;   // V820: conexão nova — mesmo motivo do importar
    await this.salvar({ imediato: true });   // V659: o IDB foi apagado — persiste JÁ
  },

  // ==========================================================================
  // ESTATÍSTICAS
  // ==========================================================================

  resumo() {
    return {
      procedimentos:  this.contar('procedimentos'),
      sinonimos:      this.contar('sinonimos_proc'),
      valores:        this.contar('tabela_repasse'),
      medicos:        this.contar('medicos'),
      sinonimosMed:   this.contar('sinonimos_medico'),
      unidades:       this.contar('unidades'),
      regras:         this.contar('regras_especiais'),
      competencias:   this.contar('competencias'),
      importacoes:    this.contar('importacoes'),
    };
  },
};

window.Banco = Banco;

// V492: garante que um salvarDebounced() pendente seja persistido se o usuário
// fechar/trocar de aba antes do timer disparar (pagehide cobre fechar/navegar;
// visibilitychange cobre minimizar/trocar de aba).
window.addEventListener('pagehide', () => {
  Banco._saindo = true;   // V659: pula o rAF do selo — o flush exporta JÁ
  if (Banco._salvarTimer) Banco._flushSalvar(true);   // V686: flush de saída fura a janela
  if (Banco._fotosTimer) Banco._flushFotos();   // V613
});
// V659: com pendência (debounce armado ou persistência em VOO), segura o
// fechamento — dá tempo do IndexedDB commitar e avisa o usuário. Sem
// pendência, fecha sem diálogo nenhum.
window.addEventListener('beforeunload', (e) => {
  if (Banco._salvarTimer || Banco._exportEmAndamento) {
    try { if (Banco._salvarTimer) Banco._flushSalvar(true); } catch (_) {}   // V686
    e.preventDefault();
    e.returnValue = '';
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && Banco._salvarTimer) Banco._flushSalvar(true);   // V686
  if (document.visibilityState === 'hidden' && Banco._fotosTimer) Banco._flushFotos();   // V613
});
