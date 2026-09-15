/**
 * ============================================================================
 * ATLAS — NÚCLEO DO BANCO (sql.js + IndexedDB)
 *
 * SQLite rodando no navegador via sql.js (WASM). O binário WASM vem embutido
 * em base64 (libs/sql-wasm-b64.js) porque `fetch` de arquivo local é
 * bloqueado quando a ferramenta abre por duplo clique (file://).
 *
 * Persistência: o banco inteiro é exportado (Uint8Array) e gravado num
 * registro do IndexedDB. Backup manual: exportar/importar arquivo .db.
 *
 * Convenções da casa:
 *   - Banco._versao: carimbo incrementado a toda gravação — TODO cache
 *     derivado de dados se chaveia nele (cache sem carimbo = bug).
 *   - UI primeiro, persistência depois: handlers de tela usam
 *     `render(); Banco.salvarDebounced();` — nunca `await Banco.salvar()`
 *     antes de repintar.
 * ============================================================================
 */
(function () {
  'use strict';

  const Banco = {
    SQL: null,          // módulo sql.js
    db: null,           // instância do banco aberto
    _versao: 0,         // carimbo de gravação de DADOS (bump a cada escrita que muda resultados)
    _versaoConfig: 0,   // carimbo de estado de tela (filtros, pauta, vigias…) — não invalida caches de dados
    // chaves de config que mudam o RESULTADO do motor: gravar uma delas bumpa _versao
    CONFIG_DADOS: new Set(['tolerancia_centavos', 'inferencia_min_amostras', 'inferencia_min_confianca',
      'fuzzy_limiar', 'institucional_marca']),
    _salvarTimer: null,
    _pronto: false,

    IDB_NOME: 'atlas_auditoria',
    IDB_STORE: 'banco',
    IDB_CHAVE: 'principal',
    IDB_CHAVE_CFG: 'config',     // configuração à parte (gravação leve)
    _sujoDados: false, _sujoConfig: false, _jaSalvouDados: false,

    // ──────────────────────────────────────────────────────────────────
    // BOOT
    // ──────────────────────────────────────────────────────────────────
    async inicializar(opts = {}) {
      const progresso = typeof opts.progresso === 'function' ? opts.progresso : () => {};
      if (typeof initSqlJs === 'undefined') {
        throw new Error('sql.js não carregou (libs/sql-wasm.js ausente?)');
      }
      const cfg = {};
      if (window.__SQL_WASM_B64) {
        const bin = Uint8Array.from(atob(window.__SQL_WASM_B64), c => c.charCodeAt(0));
        cfg.wasmBinary = bin.buffer;
        window.__SQL_WASM_B64 = null;   // libera a string grande da memória
      } else {
        cfg.locateFile = (f) => 'libs/' + f;   // servido por http: baixa o .wasm
      }
      this.SQL = await initSqlJs(cfg);

      progresso('Abrindo a base…');
      const salvo = await this._idbLer(this.IDB_CHAVE);
      this.db = salvo ? new this.SQL.Database(salvo) : new this.SQL.Database();
      this._jaSalvouDados = !!salvo;

      // Schema idempotente + migrações defensivas + seeds
      progresso('Preparando as tabelas…');
      this.db.exec(window.SCHEMA_SQL);
      this._migrar();
      if (window.SCHEMA_SEEDS) this.db.exec(window.SCHEMA_SEEDS);
      // a configuração tem gravação própria (leve) — o que está lá é o mais novo
      await this._aplicarConfigSalva();

      this._pronto = true;
      // índice de admissão normalizada em linhas de versões antigas (uma vez só)
      const normalizadas = await this.normalizarPendentes(progresso);
      if (!salvo || normalizadas) await this.salvar({ tudo: true });
      this._sujoDados = false; this._sujoConfig = false;
      return this;
    },

    // ──────────────────────────────────────────────────────────────────
    // ADMISSÃO NORMALIZADA — toda busca por admissão passa por admissao_norm
    // (só dígitos, sem zeros à esquerda — Utilidades.normAdm) com índice.
    // Linhas antigas (ou inseridas por SQL cru) são preenchidas aqui.
    // ──────────────────────────────────────────────────────────────────
    _normVersao: -1,
    TABELAS_ADM: ['linhas_producao', 'linhas_repasse', 'linhas_medico'],

    _temPendentes() {
      for (const t of this.TABELAS_ADM) {
        if (this.escalar(`SELECT 1 FROM ${t} WHERE admissao_norm IS NULL LIMIT 1`) != null) return true;
      }
      return false;
    },

    /** Preenche um lote (a partir de um id) e devolve { n, ultimoId }. */
    _normalizarLote(tabela, aPartirDe, limite) {
      const U = window.Utilidades;
      const comPac = tabela === 'linhas_producao';
      const rows = this.query(
        `SELECT id, admissao${comPac ? ', paciente' : ''} FROM ${tabela}
          WHERE id > ? AND admissao_norm IS NULL ORDER BY id LIMIT ${limite}`, [aPartirDe]);
      if (!rows.length) return { n: 0, ultimoId: aPartirDe };
      const sql = comPac
        ? `UPDATE ${tabela} SET admissao_norm = ?, paciente_norm = ? WHERE id = ?`
        : `UPDATE ${tabela} SET admissao_norm = ? WHERE id = ?`;
      this.db.exec('BEGIN');
      try {
        this.executarLote(sql, rows.map(r => comPac
          ? [U.normAdm(r.admissao), U.normalizar(r.paciente), r.id]
          : [U.normAdm(r.admissao), r.id]));
        this.db.exec('COMMIT');
      } catch (e) { this.db.exec('ROLLBACK'); throw e; }
      return { n: rows.length, ultimoId: rows[rows.length - 1].id };
    },

    /** Boot: preenche em lotes cedendo a tela entre eles. Devolve quantas linhas preencheu. */
    async normalizarPendentes(progresso) {
      const p = typeof progresso === 'function' ? progresso : () => {};
      let total = 0;
      for (const t of this.TABELAS_ADM) {
        const pend = this.escalar(`SELECT COUNT(*) FROM ${t} WHERE admissao_norm IS NULL`) || 0;
        if (!pend) continue;
        let feitas = 0, ultimoId = 0;
        while (feitas < pend) {
          const r = this._normalizarLote(t, ultimoId, 5000);
          if (!r.n) break;
          feitas += r.n; ultimoId = r.ultimoId; total += r.n;
          p(`Preparando o índice de admissões… ${Math.min(100, Math.round(feitas / pend * 100))}%`);
          await new Promise(res => setTimeout(res, 0));
        }
      }
      this._normVersao = this._versao;
      return total;
    },

    /** Síncrono, para quem consulta por admissão: garante que nada ficou sem admissao_norm. */
    garantirNormalizados() {
      if (this._normVersao === this._versao) return;
      if (this._temPendentes()) {
        for (const t of this.TABELAS_ADM) {
          let ultimoId = 0;
          for (;;) { const r = this._normalizarLote(t, ultimoId, 20000); if (!r.n) break; ultimoId = r.ultimoId; }
        }
      }
      this._normVersao = this._versao;
    },

    /**
     * Migrações leves: coluna nova em tabela existente entra AQUI via
     * PRAGMA table_info + ALTER TABLE defensivo (nunca quebra banco antigo).
     */
    _migrar() {
      const addCol = (tabela, coluna, ddl) => {
        try {
          const cols = this.query(`PRAGMA table_info(${tabela})`).map(c => c.name);
          if (!cols.includes(coluna)) this.db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${ddl}`);
        } catch (e) { console.warn('[banco] migração falhou:', tabela, coluna, e); }
      };
      // v0.2: status da linha de repasse (detecção de GLOSA — docs/METODOLOGIA.md §5)
      addCol('linhas_repasse', 'status', 'status TEXT');
      // v0.6: íntegra do relatório analítico de produção (importação automática)
      for (const col of ['hora_admissao', 'status_admissao', 'unidade', 'especialidade', 'destino',
        'tipo_produto', 'categoria', 'subcategoria', 'subespecialidade', 'medico_externo',
        'cod_apresentacao', 'procedimento_principal', 'pacote', 'plano', 'perfil_particular',
        'perfil_admissao', 'carater_admissao', 'observacao_admissao', 'sala', 'profissional_admissao',
        'tipo_paciente', 'cod_paciente', 'data_nascimento', 'faixa_etaria', 'cid_alta', 'descricao_cid',
        'consultor', 'medico', 'cirurgiao', 'instrumentador', 'contatologa', 'ortoptista',
        'auxiliar_sadt', 'auxiliar2']) {
        addCol('linhas_producao', col, `${col} TEXT`);
      }
      addCol('linhas_producao', 'idade_atendimento', 'idade_atendimento REAL');
      // v0.7: origem do relatório do SISTEMA (Convênio / Particular / os dois)
      addCol('importacoes', 'origem', 'origem TEXT');
      // v0.7.2: admissão normalizada (índice de busca) + paciente normalizado na produção.
      // Os índices ficam AQUI (não no SCHEMA_SQL) porque a coluna pode não existir
      // ainda num banco antigo na hora em que o schema roda.
      addCol('linhas_producao', 'admissao_norm', 'admissao_norm TEXT');
      addCol('linhas_producao', 'paciente_norm', 'paciente_norm TEXT');
      addCol('linhas_repasse', 'admissao_norm', 'admissao_norm TEXT');
      addCol('linhas_medico', 'admissao_norm', 'admissao_norm TEXT');
      for (const [nome, ddl] of [
        ['idx_prod_cli_admn', 'linhas_producao(cliente_id, admissao_norm)'],
        ['idx_rep_cli_admn', 'linhas_repasse(cliente_id, admissao_norm)'],
        ['idx_med_cli_admn', 'linhas_medico(cliente_id, admissao_norm)'],
        // índices parciais: "há linha sem admissao_norm?" custa O(1) em vez de varrer a tabela
        ['idx_prod_norm_pend', 'linhas_producao(id) WHERE admissao_norm IS NULL'],
        ['idx_rep_norm_pend', 'linhas_repasse(id) WHERE admissao_norm IS NULL'],
        ['idx_med_norm_pend', 'linhas_medico(id) WHERE admissao_norm IS NULL']]) {
        try { this.db.exec(`CREATE INDEX IF NOT EXISTS ${nome} ON ${ddl}`); }
        catch (e) { console.warn('[banco] índice falhou:', nome, e); }
      }
    },

    // ──────────────────────────────────────────────────────────────────
    // API DE DADOS
    // ──────────────────────────────────────────────────────────────────

    /** SELECT → array de objetos. Ex: Banco.query('SELECT * FROM clientes WHERE id=?',[1]) */
    query(sql, params = []) {
      if (!this.db) return [];
      const stmt = this.db.prepare(sql);
      try {
        stmt.bind(params);
        const out = [];
        while (stmt.step()) out.push(stmt.getAsObject());
        return out;
      } finally { stmt.free(); }
    },

    /** SELECT de 1 valor escalar (primeira coluna da primeira linha) ou null. */
    escalar(sql, params = []) {
      const r = this.query(sql, params);
      if (!r.length) return null;
      const k = Object.keys(r[0])[0];
      return r[0][k];
    },

    /** INSERT/UPDATE/DELETE. Incrementa o carimbo _versao. */
    executar(sql, params = []) {
      if (!this.db) return;
      const stmt = this.db.prepare(sql);
      try { stmt.bind(params); stmt.step(); } finally { stmt.free(); }
      this._versao++;
      this._sujoDados = true;
    },

    /**
     * Muitas linhas com o MESMO SQL: prepara o statement uma vez e só
     * troca os parâmetros (50 mil linhas de produção em segundos, não em
     * minutos). Devolve quantas rodou. Use dentro de transacao().
     */
    executarLote(sql, listaParams) {
      if (!this.db) return 0;
      const stmt = this.db.prepare(sql);
      let n = 0;
      try {
        for (const params of listaParams) {
          stmt.bind(params.map(v => v === undefined ? null : v));
          stmt.step();
          stmt.reset();
          n++;
        }
      } finally { stmt.free(); }
      this._versao++;
      this._sujoDados = true;
      return n;
    },

    /** id gerado pelo último INSERT. */
    ultimoId() {
      return this.escalar('SELECT last_insert_rowid() AS id');
    },

    /** Várias gravações numa transação (rollback em erro). */
    transacao(fn) {
      this.db.exec('BEGIN');
      try { fn(); this.db.exec('COMMIT'); }
      catch (e) { this.db.exec('ROLLBACK'); throw e; }
      this._versao++;
      this._sujoDados = true;
    },

    /** Lê config (JSON ou texto puro). */
    configLer(chave, padrao = null) {
      const v = this.escalar('SELECT valor FROM config WHERE chave = ?', [chave]);
      if (v == null) return padrao;
      try { return JSON.parse(v); } catch (_) { return v; }
    },

    configGravar(chave, valor) {
      const txt = (typeof valor === 'string') ? valor : JSON.stringify(valor);
      const sujo = this._sujoDados, versao = this._versao;
      this.executar(
        `INSERT INTO config (chave, valor, atualizado_em) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = CURRENT_TIMESTAMP`,
        [chave, txt]);
      // config tem gravação própria (leve): mexer num filtro não exporta a base inteira
      this._sujoDados = sujo;
      this._sujoConfig = true;
      // estado de tela NÃO invalida os caches de dados (motor, lotes, agregações) —
      // com a base grande cada invalidação custa segundos
      if (!this.CONFIG_DADOS.has(chave)) this._versao = versao;
      this._versaoConfig++;
    },

    _configJSON() {
      return JSON.stringify(this.query('SELECT chave, valor, atualizado_em FROM config'));
    },

    /** A config gravada à parte é sempre a mais nova: reaplica sobre a tabela do banco. */
    async _aplicarConfigSalva() {
      const txt = await this._idbLer(this.IDB_CHAVE_CFG);
      if (!txt) return;
      let rows = [];
      try { rows = JSON.parse(txt) || []; } catch (_) { return; }
      if (!Array.isArray(rows) || !rows.length) return;
      this.db.exec('BEGIN');
      try {
        this.executarLote(
          `INSERT INTO config (chave, valor, atualizado_em) VALUES (?, ?, ?)
           ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
          rows.map(r => [r.chave, r.valor, r.atualizado_em || null]));
        this.db.exec('COMMIT');
      } catch (e) { this.db.exec('ROLLBACK'); console.warn('[banco] config salva não pôde ser aplicada:', e); }
    },

    // ──────────────────────────────────────────────────────────────────
    // PERSISTÊNCIA (IndexedDB)
    // ──────────────────────────────────────────────────────────────────

    /**
     * Persiste no IndexedDB. A base (export inteiro do SQLite — pesado com
     * centenas de milhares de linhas) só vai quando houve gravação de DADOS;
     * a configuração vai sempre, como JSON pequeno. opts.tudo força a base.
     */
    async salvar(opts = {}) {
      if (!this.db || !this._pronto) return;
      clearTimeout(this._salvarTimer);
      this._salvarTimer = null;
      // gravações em FILA: duas salvas sobrepostas nunca chegam ao IndexedDB
      // fora de ordem (a mais antiga não pode vencer a mais nova)
      const fila = (this._filaSalvar || Promise.resolve())
        .then(() => this._salvarAgora(opts))
        .catch(e => console.error('[banco] salvar falhou:', e));
      this._filaSalvar = fila;
      await fila;
    },

    async _salvarAgora(opts) {
      if (opts.tudo || this._sujoDados || !this._jaSalvouDados) {
        const bytes = this.db.export();
        this._sujoDados = false;   // ANTES de aguardar: gravação durante o await suja de novo
        await this._idbGravar(this.IDB_CHAVE, bytes);
        this._jaSalvouDados = true;
      }
      const cfg = this._configJSON();
      this._sujoConfig = false;
      await this._idbGravar(this.IDB_CHAVE_CFG, cfg);
    },

    /** Versão coalescida: várias edições em sequência = 1 gravação. */
    salvarDebounced(ms = 800) {
      clearTimeout(this._salvarTimer);
      this._salvarTimer = setTimeout(() => {
        this.salvar().catch(e => console.error('[banco] salvar falhou:', e));
      }, ms);
    },

    /** Uma conexão só com o IndexedDB (reaberta se o navegador a fechar). */
    _idbAbrir() {
      if (this._idbConexao) return Promise.resolve(this._idbConexao);
      if (this._idbAbrindo) return this._idbAbrindo;
      this._idbAbrindo = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.IDB_NOME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(this.IDB_STORE)) {
            req.result.createObjectStore(this.IDB_STORE);
          }
        };
        req.onsuccess = () => {
          const idb = req.result;
          idb.onclose = () => { this._idbConexao = null; };
          idb.onversionchange = () => { idb.close(); this._idbConexao = null; };
          this._idbConexao = idb; this._idbAbrindo = null;
          resolve(idb);
        };
        req.onerror = () => { this._idbAbrindo = null; reject(req.error); };
      });
      return this._idbAbrindo;
    },

    async _idbLer(chave) {
      try {
        const idb = await this._idbAbrir();
        return await new Promise((resolve, reject) => {
          const tx = idb.transaction(this.IDB_STORE, 'readonly');
          const rq = tx.objectStore(this.IDB_STORE).get(chave || this.IDB_CHAVE);
          rq.onsuccess = () => resolve(rq.result || null);
          rq.onerror = () => reject(rq.error);
        });
      } catch (e) {
        console.warn('[banco] IndexedDB indisponível — banco só em memória.', e);
        return null;
      }
    },

    async _idbGravar(chave, valor) {
      try {
        const idb = await this._idbAbrir();
        await new Promise((resolve, reject) => {
          const tx = idb.transaction(this.IDB_STORE, 'readwrite');
          tx.objectStore(this.IDB_STORE).put(valor, chave);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) {
        console.warn('[banco] gravação IndexedDB falhou (dados seguem em memória).', e);
      }
    },

    // ──────────────────────────────────────────────────────────────────
    // BACKUP MANUAL (.db)
    // ──────────────────────────────────────────────────────────────────

    exportarArquivo() {
      const bytes = this.db.export();
      const data = new Date().toISOString().slice(0, 10);
      Utilidades.baixarArquivo(`atlas_auditoria_${data}.db`, bytes, 'application/octet-stream');
    },

    async importarArquivo(arrayBuffer) {
      const novo = new this.SQL.Database(new Uint8Array(arrayBuffer));
      // sanidade: precisa ser um banco ATLAS (tabela clientes presente)
      const ok = novo.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='clientes'`);
      if (!ok.length) { novo.close(); throw new Error('O arquivo não parece um banco da ATLAS.'); }
      if (this.db) this.db.close();
      this.db = novo;
      this.db.exec(window.SCHEMA_SQL);   // garante tabelas novas em banco antigo
      this._migrar();
      this._versao++;
      await this.normalizarPendentes();
      await this.salvar({ tudo: true });   // a config passa a ser a do arquivo restaurado
    },

    async resetar() {
      if (this.db) this.db.close();
      this.db = new this.SQL.Database();
      this.db.exec(window.SCHEMA_SQL);
      this._migrar();
      if (window.SCHEMA_SEEDS) this.db.exec(window.SCHEMA_SEEDS);
      this._versao++;
      this._normVersao = this._versao;
      await this.salvar({ tudo: true });
    },
  };

  window.Banco = Banco;
})();
