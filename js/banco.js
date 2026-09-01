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
    _versao: 0,         // carimbo de gravação (bump a cada escrita)
    _salvarTimer: null,
    _pronto: false,

    IDB_NOME: 'atlas_auditoria',
    IDB_STORE: 'banco',
    IDB_CHAVE: 'principal',

    // ──────────────────────────────────────────────────────────────────
    // BOOT
    // ──────────────────────────────────────────────────────────────────
    async inicializar() {
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

      const salvo = await this._idbLer();
      this.db = salvo ? new this.SQL.Database(salvo) : new this.SQL.Database();

      // Schema idempotente + migrações defensivas + seeds
      this.db.exec(window.SCHEMA_SQL);
      this._migrar();
      if (window.SCHEMA_SEEDS) this.db.exec(window.SCHEMA_SEEDS);

      this._pronto = true;
      if (!salvo) await this.salvar({ imediato: true });
      return this;
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
    },

    /** Lê config (JSON ou texto puro). */
    configLer(chave, padrao = null) {
      const v = this.escalar('SELECT valor FROM config WHERE chave = ?', [chave]);
      if (v == null) return padrao;
      try { return JSON.parse(v); } catch (_) { return v; }
    },

    configGravar(chave, valor) {
      const txt = (typeof valor === 'string') ? valor : JSON.stringify(valor);
      this.executar(
        `INSERT INTO config (chave, valor, atualizado_em) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = CURRENT_TIMESTAMP`,
        [chave, txt]);
    },

    // ──────────────────────────────────────────────────────────────────
    // PERSISTÊNCIA (IndexedDB)
    // ──────────────────────────────────────────────────────────────────

    async salvar(opts = {}) {
      if (!this.db || !this._pronto) return;
      clearTimeout(this._salvarTimer);
      this._salvarTimer = null;
      const bytes = this.db.export();
      await this._idbGravar(bytes);
      void opts;
    },

    /** Versão coalescida: várias edições em sequência = 1 gravação. */
    salvarDebounced(ms = 800) {
      clearTimeout(this._salvarTimer);
      this._salvarTimer = setTimeout(() => {
        this.salvar().catch(e => console.error('[banco] salvar falhou:', e));
      }, ms);
    },

    _idbAbrir() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(this.IDB_NOME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(this.IDB_STORE)) {
            req.result.createObjectStore(this.IDB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },

    async _idbLer() {
      try {
        const idb = await this._idbAbrir();
        return await new Promise((resolve, reject) => {
          const tx = idb.transaction(this.IDB_STORE, 'readonly');
          const rq = tx.objectStore(this.IDB_STORE).get(this.IDB_CHAVE);
          rq.onsuccess = () => resolve(rq.result || null);
          rq.onerror = () => reject(rq.error);
        });
      } catch (e) {
        console.warn('[banco] IndexedDB indisponível — banco só em memória.', e);
        return null;
      }
    },

    async _idbGravar(bytes) {
      try {
        const idb = await this._idbAbrir();
        await new Promise((resolve, reject) => {
          const tx = idb.transaction(this.IDB_STORE, 'readwrite');
          tx.objectStore(this.IDB_STORE).put(bytes, this.IDB_CHAVE);
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
      await this.salvar({ imediato: true });
    },

    async resetar() {
      if (this.db) this.db.close();
      this.db = new this.SQL.Database();
      this.db.exec(window.SCHEMA_SQL);
      if (window.SCHEMA_SEEDS) this.db.exec(window.SCHEMA_SEEDS);
      this._versao++;
      await this.salvar({ imediato: true });
    },
  };

  window.Banco = Banco;
})();
