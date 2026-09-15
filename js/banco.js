/**
 * ============================================================================
 * ATLAS — NÚCLEO DO BANCO (sql.js + IndexedDB) — UM COFRE POR CLIENTE
 *
 * SQLite rodando no navegador via sql.js (WASM). O binário WASM vem embutido
 * em base64 (libs/sql-wasm-b64.js) porque `fetch` de arquivo local é
 * bloqueado quando a ferramenta abre por duplo clique (file://).
 *
 * ESCALA (v0.8): cada CLIENTE (CNPJ) tem o seu próprio banco SQLite — o seu
 * "cofre" — gravado num registro do IndexedDB (`cliente:<id>`). Só o cofre
 * do cliente ativo fica aberto na memória; trocar de cliente fecha um e abre
 * o outro. É o que os sistemas grandes fazem (uma partição por inquilino):
 * dez CNPJs com 150 mil linhas cada não pesam dez vezes mais na memória nem
 * na gravação — cada salvamento exporta só o cofre em uso. Um CATÁLOGO
 * pequeno (`catalogo`, JSON) lista os clientes com nome, hospitais e
 * contagens, para as telas não precisarem abrir cofre nenhum. A configuração
 * (parâmetros do motor, estado das telas) é global e vai à parte (`config`).
 *
 * Bancos da v0.7 (um só, `principal`) são separados por cliente no primeiro
 * boot; o registro antigo fica guardado como cópia de segurança até um
 * "apagar tudo".
 *
 * Convenções da casa:
 *   - Banco._versao: carimbo incrementado a toda gravação de DADOS — TODO
 *     cache derivado de dados se chaveia nele (cache sem carimbo = bug).
 *   - UI primeiro, persistência depois: handlers de tela usam
 *     `render(); Banco.salvarDebounced();` — nunca `await Banco.salvar()`
 *     antes de repintar.
 *   - Importação pesada = transacaoAsync (lotes com a tela livre); enquanto
 *     ela está aberta nada é salvo (db.export() fecha e reabre o banco).
 * ============================================================================
 */
(function () {
  'use strict';

  const TABELAS_CLIENTE = ['hospitais', 'importacoes', 'linhas_producao', 'linhas_repasse', 'linhas_medico',
    'pauta_inspecao', 'medicos'];   // têm cliente_id; base_tabela/perfis vêm pelo hospital, sinônimos pelo médico

  const Banco = {
    SQL: null,          // módulo sql.js
    db: null,           // cofre aberto (ou um banco vazio em memória quando não há cliente ativo)
    _versao: 0,         // carimbo de gravação de DADOS (bump a cada escrita que muda resultados)
    _versaoConfig: 0,   // carimbo de estado de tela (filtros, pauta, vigias…) — não invalida caches de dados
    // chaves de config que mudam o RESULTADO do motor: gravar uma delas bumpa _versao
    CONFIG_DADOS: new Set(['tolerancia_centavos', 'inferencia_min_amostras', 'inferencia_min_confianca',
      'fuzzy_limiar', 'institucional_marca']),
    _salvarTimer: null,
    _pronto: false,

    IDB_NOME: 'atlas_auditoria',
    IDB_STORE: 'banco',
    IDB_CHAVE: 'principal',        // v0.7: banco único (separado em cofres no 1º boot da v0.8; fica como cópia)
    IDB_CHAVE_CFG: 'config',       // configuração global à parte (gravação leve)
    IDB_CHAVE_CAT: 'catalogo',     // catálogo dos clientes (JSON pequeno)
    _catalogo: null,               // { versao, ativo, clientes: [{ id, nome, tipo, documento, contato, ativo, hospitais, producao, sistema, medico, bytes, atualizado_em }] }
    _clienteId: 0,                 // cofre aberto (0 = nenhum)
    _configTxt: '',                // última configuração global conhecida (JSON) — reaplicada ao abrir um cofre
    _sujoDados: false, _sujoConfig: false, _jaSalvouDados: false,
    _emTransacao: false, _fimTransacao: null,   // importação em lotes aberta (ver transacaoAsync)

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

      // o navegador não deve descartar os cofres sob pressão de espaço
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) { /* opcional */ }

      progresso('Abrindo a base…');
      this._configTxt = (await this._idbLer(this.IDB_CHAVE_CFG)) || '';
      let cat = null;
      const catTxt = await this._idbLer(this.IDB_CHAVE_CAT);
      if (catTxt) { try { cat = JSON.parse(catTxt); } catch (_) { cat = null; } }
      if (!cat || !Array.isArray(cat.clientes)) {
        const legado = await this._idbLer(this.IDB_CHAVE);
        cat = legado ? await this._migrarLegado(legado, progresso) : this._catalogoVazio();
        this._catalogo = cat;
        await this._gravarCatalogo();
      }
      this._catalogo = cat;

      const ativo = this.cliente(cat.ativo);
      await this._abrir(ativo && ativo.ativo ? ativo.id : 0, progresso);
      this._pronto = true;
      // índice de admissão normalizada em linhas de versões antigas (uma vez só)
      const normalizadas = await this.normalizarPendentes(progresso);
      if (normalizadas) await this.salvar({ tudo: true });
      this._sujoDados = false; this._sujoConfig = false;
      return this;
    },

    // ──────────────────────────────────────────────────────────────────
    // CATÁLOGO E COFRES (um banco por cliente)
    // ──────────────────────────────────────────────────────────────────
    _catalogoVazio() { return { versao: 1, ativo: 0, clientes: [] }; },
    catalogo() { return this._catalogo || (this._catalogo = this._catalogoVazio()); },
    chaveCofre(id) { return 'cliente:' + id; },

    /** Entrada do catálogo de um cliente (ativo ou arquivado) ou null. */
    cliente(id) {
      id = Number(id) || 0;
      return this.catalogo().clientes.find(c => c.id === id) || null;
    },

    /** Clientes ativos (ou arquivados, com { arquivados: true }), por nome. */
    clientes(opts = {}) {
      return this.catalogo().clientes
        .filter(c => opts.arquivados ? !c.ativo : !!c.ativo)
        .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    },

    /** O cliente cujo cofre está aberto (o contexto de todas as telas) ou null. */
    clienteAberto() { return this._clienteId ? this.cliente(this._clienteId) : null; },

    _proximoId() { return this.catalogo().clientes.reduce((m, c) => Math.max(m, c.id), 0) + 1; },

    async _gravarCatalogo() {
      await this._idbGravar(this.IDB_CHAVE_CAT, JSON.stringify(this.catalogo()));
    },

    /** Abre o cofre `id` (0 = nenhum: banco vazio) no lugar do atual — o atual é salvo antes. */
    async abrirCliente(id, progresso) {
      id = Number(id) || 0;
      if (id === this._clienteId) return this.clienteAberto();
      if (this._emTransacao) throw new Error('Há uma importação em andamento — aguarde ela terminar.');
      if (id && !this.cliente(id)) throw new Error('Cliente não encontrado no catálogo.');
      await this.salvar();                       // nada do cofre atual se perde na troca
      this._configTxt = this._configJSON();
      await this._abrir(id, progresso);
      this.catalogo().ativo = id;
      this.configGravar('cliente_ativo', id);   // espelho na config (quem lê cliente_ativo continua certo)
      await this.salvar();                       // catálogo + config (a base não está suja)
      return this.clienteAberto();
    },

    async fecharCliente() { return this.abrirCliente(0); },

    /** Troca o banco aberto pelo cofre `id` (ou um vazio). Schema + migrações + config global. */
    async _abrir(id, progresso) {
      const p = typeof progresso === 'function' ? progresso : () => {};
      if (this.db) { try { this.db.close(); } catch (_) { /* já fechado */ } this.db = null; }
      let bytes = null;
      if (id) { p('Abrindo o cofre do cliente…'); bytes = await this._idbLer(this.chaveCofre(id)); }
      this.db = bytes ? new this.SQL.Database(bytes) : new this.SQL.Database();
      p('Preparando as tabelas…');
      this.db.exec(window.SCHEMA_SQL);
      this._migrar();
      if (window.SCHEMA_SEEDS) this.db.exec(window.SCHEMA_SEEDS);
      if (id) {
        // o catálogo é a fonte da verdade do cadastro: o registro do cliente no cofre segue ele
        const c = this.cliente(id);
        this.executar(
          `INSERT OR IGNORE INTO clientes (id, nome, tipo, documento, contato, criado_em)
           VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
          [c.id, c.nome, c.tipo || 'MEDICO', c.documento || '', c.contato || '', c.criado_em || null]);
        this.executar('UPDATE clientes SET nome = ?, tipo = ?, documento = ?, contato = ?, ativo = 1 WHERE id = ?',
          [c.nome, c.tipo || 'MEDICO', c.documento || '', c.contato || '', c.id]);
      }
      this._clienteId = id;
      this._jaSalvouDados = !!bytes || !id;
      if (this._configTxt) this._aplicarConfig(this._configTxt);
      this._sujoDados = false;
      this._versao++;
      this._normVersao = -1;
    },

    /** Cadastra um cliente: cofre novo (vazio) + entrada no catálogo. Abre-o se nenhum estiver aberto. */
    async criarCliente(dados) {
      const nome = String(dados && dados.nome || '').trim();
      if (!nome) throw new Error('Informe o nome do cliente.');
      const id = this._proximoId();
      const entrada = {
        id, nome, tipo: (dados.tipo || 'MEDICO'), documento: String(dados.documento || '').trim(),
        contato: String(dados.contato || '').trim(), ativo: 1, criado_em: new Date().toISOString(),
        hospitais: [], producao: 0, sistema: 0, medico: 0, bytes: 0, atualizado_em: null,
      };
      const novo = new this.SQL.Database();
      try {
        novo.exec(window.SCHEMA_SQL);
        this._migrar(novo);
        if (window.SCHEMA_SEEDS) novo.exec(window.SCHEMA_SEEDS);
        const st = novo.prepare('INSERT INTO clientes (id, nome, tipo, documento, contato) VALUES (?, ?, ?, ?, ?)');
        try { st.run([id, entrada.nome, entrada.tipo, entrada.documento, entrada.contato]); } finally { st.free(); }
        const bytes = novo.export();
        entrada.bytes = bytes.length; entrada.atualizado_em = new Date().toISOString();
        await this._idbGravar(this.chaveCofre(id), bytes);
      } finally { novo.close(); }
      this.catalogo().clientes.push(entrada);
      await this._gravarCatalogo();
      if (!this._clienteId) await this.abrirCliente(id);
      return entrada;
    },

    /** Edita o cadastro (nome, tipo, documento, contato) no catálogo — e no cofre, se estiver aberto. */
    async atualizarCliente(id, campos) {
      const c = this.cliente(id);
      if (!c) throw new Error('Cliente não encontrado.');
      for (const k of ['nome', 'tipo', 'documento', 'contato']) if (campos[k] != null) c[k] = String(campos[k]).trim();
      if (!c.nome) throw new Error('Informe o nome do cliente.');
      if (c.id === this._clienteId) {
        this.executar('UPDATE clientes SET nome = ?, tipo = ?, documento = ?, contato = ? WHERE id = ?',
          [c.nome, c.tipo, c.documento, c.contato, c.id]);
      }
      await this._gravarCatalogo();
      return c;
    },

    /** Arquiva (some das listas; o cofre fica guardado). Se for o aberto, fecha antes. */
    async arquivarCliente(id) {
      const c = this.cliente(id);
      if (!c) return;
      if (c.id === this._clienteId) await this.abrirCliente(0);
      c.ativo = 0;
      await this._gravarCatalogo();
    },

    async reativarCliente(id) {
      const c = this.cliente(id);
      if (!c) return;
      c.ativo = 1;
      await this._gravarCatalogo();
    },

    /** Apaga o cofre do cliente do navegador (definitivo — só com backup). */
    async excluirCliente(id) {
      const c = this.cliente(id);
      if (!c) return;
      if (c.id === this._clienteId) await this.abrirCliente(0);
      this.catalogo().clientes = this.catalogo().clientes.filter(x => x.id !== c.id);
      await this._idbApagar(this.chaveCofre(c.id));
      await this._gravarCatalogo();
    },

    /** Contagens, hospitais e tamanho do cofre aberto → catálogo (a cada gravação da base). */
    _atualizarEntrada(id, bytes) {
      const c = this.cliente(id);
      if (!c) return;
      c.producao = this.escalar('SELECT COUNT(*) FROM linhas_producao') || 0;
      c.sistema = this.escalar('SELECT COUNT(*) FROM linhas_repasse') || 0;
      c.medico = this.escalar('SELECT COUNT(*) FROM linhas_medico') || 0;
      c.hospitais = this.query('SELECT id, nome FROM hospitais ORDER BY nome');
      c.bytes = bytes;
      c.atualizado_em = new Date().toISOString();
    },

    /** Espaço do navegador: { usado, cota } em bytes (null quando não dá para saber). */
    async espaco() {
      try {
        const e = await navigator.storage.estimate();
        let persistente = null;
        try { persistente = await navigator.storage.persisted(); } catch (_) { /* opcional */ }
        return { usado: e.usage || 0, cota: e.quota || 0, persistente };
      } catch (_) { return null; }
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
      const propria = !this._emTransacao;   // dentro de uma importação em lotes, entra na transação dela
      if (propria) this.db.exec('BEGIN');
      try {
        this.executarLote(sql, rows.map(r => comPac
          ? [U.normAdm(r.admissao), U.normalizar(r.paciente), r.id]
          : [U.normAdm(r.admissao), r.id]));
        if (propria) this.db.exec('COMMIT');
      } catch (e) { if (propria) this.db.exec('ROLLBACK'); throw e; }
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
     * Roda em qualquer banco (`bd`): o cofre aberto, um cofre novo ou um
     * arquivo de backup sendo restaurado.
     */
    _migrar(bd) {
      bd = bd || this.db;
      const colunas = (tabela) => {
        const r = bd.exec(`PRAGMA table_info(${tabela})`);
        return r.length ? r[0].values.map(v => v[1]) : [];
      };
      const addCol = (tabela, coluna, ddl) => {
        try {
          if (!colunas(tabela).includes(coluna)) bd.exec(`ALTER TABLE ${tabela} ADD COLUMN ${ddl}`);
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
      // v0.8.1: o que o PAGADOR pagou (recebido = 0 → glosa) e o honorário do item.
      // Ficam NULL nas linhas já importadas: null = "o relatório não trouxe a coluna",
      // e a regra da glosa por recebido não se aplica a elas.
      addCol('linhas_repasse', 'recebido', 'recebido REAL');
      addCol('linhas_repasse', 'honorario', 'honorario REAL');
      // v0.9.1: a Base Tabela exportada pela ferramenta traz o nome canônico do
      // exame e a classificação dele junto com as regras
      // v0.11.0: o médico auditado é o CLIENTE da ATLAS — marcado à mão ou na
      // escolha do topo. Sem a marca, o seletor listaria o hospital inteiro.
      addCol('medicos', 'eh_cliente', 'eh_cliente INTEGER DEFAULT 0');
      addCol('base_tabela', 'nomenclatura', 'nomenclatura TEXT');
      addCol('base_tabela', 'categoria', 'categoria TEXT');
      addCol('base_tabela', 'subespecialidade', 'subespecialidade TEXT');
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
        try { bd.exec(`CREATE INDEX IF NOT EXISTS ${nome} ON ${ddl}`); }
        catch (e) { console.warn('[banco] índice falhou:', nome, e); }
      }
    },

    // ──────────────────────────────────────────────────────────────────
    // API DE DADOS
    // ──────────────────────────────────────────────────────────────────

    /** SELECT → array de objetos. Ex: Banco.query('SELECT * FROM clientes WHERE id=?',[1]) */
    query(sql, params = []) {
      if (!this.db) return [];
      return this._q(this.db, sql, params);
    },

    /** O mesmo, em QUALQUER banco sql.js (cofre novo, arquivo de backup…). */
    _q(bd, sql, params = []) {
      const stmt = bd.prepare(sql);
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

    _escalarDe(bd, sql, params = []) {
      const r = this._q(bd, sql, params);
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
      if (this._emTransacao) throw new Error('Há uma importação em andamento — aguarde ela terminar.');
      this.db.exec('BEGIN');
      try { fn(); this.db.exec('COMMIT'); }
      catch (e) { this.db.exec('ROLLBACK'); throw e; }
      this._versao++;
      this._sujoDados = true;
    },

    /**
     * Transação ASSÍNCRONA — importação em lotes: fn pode aguardar entre os
     * lotes (a tela respira, a barra de progresso anda) e tudo entra ou nada
     * entra. Enquanto ela está aberta NÃO se salva: db.export() fecha e
     * reabre o banco (derrubaria a transação) — salvar() espera o fim dela.
     */
    async transacaoAsync(fn) {
      if (this._emTransacao) throw new Error('Já há uma importação em andamento — aguarde ela terminar.');
      this._emTransacao = true;
      let liberar;
      this._fimTransacao = new Promise(r => { liberar = r; });
      this.db.exec('BEGIN');
      try {
        const r = await fn();
        this.db.exec('COMMIT');
        return r;
      } catch (e) {
        try { this.db.exec('ROLLBACK'); } catch (_) { /* já revertida */ }
        throw e;
      } finally {
        this._emTransacao = false;
        this._versao++;
        this._sujoDados = true;
        liberar();
      }
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

    /** A configuração global (JSON) é sempre a mais nova: reaplica sobre a tabela config do banco aberto. */
    _aplicarConfig(txt) {
      let rows = [];
      try { rows = JSON.parse(txt) || []; } catch (_) { return; }
      if (!Array.isArray(rows) || !rows.length) return;
      const sujo = this._sujoDados, versao = this._versao;
      const propria = !this._emTransacao;
      if (propria) this.db.exec('BEGIN');
      try {
        this.executarLote(
          `INSERT INTO config (chave, valor, atualizado_em) VALUES (?, ?, ?)
           ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
          rows.map(r => [r.chave, r.valor, r.atualizado_em || null]));
        if (propria) this.db.exec('COMMIT');
      } catch (e) { if (propria) this.db.exec('ROLLBACK'); console.warn('[banco] config salva não pôde ser aplicada:', e); }
      this._sujoDados = sujo; this._versao = versao;
    },

    async _aplicarConfigSalva() {
      const txt = await this._idbLer(this.IDB_CHAVE_CFG);
      if (txt) { this._configTxt = txt; this._aplicarConfig(txt); }
    },

    // ──────────────────────────────────────────────────────────────────
    // PERSISTÊNCIA (IndexedDB)
    // ──────────────────────────────────────────────────────────────────

    /**
     * Persiste no IndexedDB. O cofre aberto (export inteiro do SQLite —
     * pesado com centenas de milhares de linhas) só vai quando houve
     * gravação de DADOS; a configuração e o catálogo vão sempre, como JSON
     * pequeno. opts.tudo força o cofre.
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
      // uma importação em lotes aberta: exportar agora derrubaria a transação
      while (this._emTransacao) await this._fimTransacao;
      if (this._clienteId && (opts.tudo || this._sujoDados || !this._jaSalvouDados)) {
        const id = this._clienteId;
        const bytes = this.db.export();
        this._sujoDados = false;   // ANTES de aguardar: gravação durante o await suja de novo
        this._atualizarEntrada(id, bytes.length);
        await this._idbGravar(this.chaveCofre(id), bytes);
        this._jaSalvouDados = true;
      }
      const cfg = this._configJSON();
      this._configTxt = cfg;
      this._sujoConfig = false;
      await this._idbGravar(this.IDB_CHAVE_CFG, cfg);
      await this._gravarCatalogo();
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

    async _idbApagar(chave) {
      try {
        const idb = await this._idbAbrir();
        await new Promise((resolve, reject) => {
          const tx = idb.transaction(this.IDB_STORE, 'readwrite');
          tx.objectStore(this.IDB_STORE).delete(chave);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) { console.warn('[banco] exclusão IndexedDB falhou.', e); }
    },

    async _idbLimpar() {
      try {
        const idb = await this._idbAbrir();
        await new Promise((resolve, reject) => {
          const tx = idb.transaction(this.IDB_STORE, 'readwrite');
          tx.objectStore(this.IDB_STORE).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) { console.warn('[banco] limpeza IndexedDB falhou.', e); }
    },

    // ──────────────────────────────────────────────────────────────────
    // CÓPIA DE UM CLIENTE ENTRE BANCOS (migração da v0.7 e restauração)
    // ──────────────────────────────────────────────────────────────────

    _colunasComuns(a, b, tabela) {
      const de = (bd) => { const r = bd.exec(`PRAGMA table_info(${tabela})`); return r.length ? r[0].values.map(v => v[1]) : []; };
      const deB = new Set(de(b));
      return de(a).filter(c => deB.has(c));
    },

    /**
     * Copia TUDO de um cliente do banco `origem` (id `idOrigem`) para um cofre
     * novo com id `idDestino`, via ATTACH (só SQL, sem passar linha por linha
     * pelo JavaScript). Devolve { bytes, contagens }.
     */
    _copiarCliente(origem, idOrigem, idDestino) {
      const novo = new this.SQL.Database();
      try {
        novo.exec(window.SCHEMA_SQL);
        this._migrar(novo);
        if (window.SCHEMA_SEEDS) novo.exec(window.SCHEMA_SEEDS);
        novo.exec(`ATTACH DATABASE '${origem.filename}' AS o`);
        try {
          const copiar = (tabela, where, params) => {
            const cols = this._colunasComuns(novo, origem, tabela).join(', ');
            if (!cols) return;
            const st = novo.prepare(`INSERT INTO ${tabela} (${cols}) SELECT ${cols} FROM o.${tabela} ${where}`);
            try { st.run(params); } finally { st.free(); }
          };
          copiar('clientes', 'WHERE id = ?', [idOrigem]);
          for (const t of TABELAS_CLIENTE) copiar(t, 'WHERE cliente_id = ?', [idOrigem]);
          copiar('base_tabela', 'WHERE hospital_id IN (SELECT id FROM o.hospitais WHERE cliente_id = ?)', [idOrigem]);
          copiar('perfis_importacao', 'WHERE hospital_id IN (SELECT id FROM o.hospitais WHERE cliente_id = ?)', [idOrigem]);
          copiar('sinonimos_proc', 'WHERE hospital_id IN (SELECT id FROM o.hospitais WHERE cliente_id = ?)', [idOrigem]);
          copiar('sinonimos_medico', 'WHERE medico_id IN (SELECT id FROM o.medicos WHERE cliente_id = ?)', [idOrigem]);
          // config NÃO é copiada: parâmetros e estado das telas são globais (chave 'config' do IndexedDB)
        } finally {
          try { novo.exec('DETACH DATABASE o'); } catch (_) { /* nada */ }
        }
        if (idDestino !== idOrigem) {
          const troca = (sql) => { const st = novo.prepare(sql); try { st.run([idDestino]); } finally { st.free(); } };
          troca('UPDATE clientes SET id = ?');
          for (const t of TABELAS_CLIENTE) troca(`UPDATE ${t} SET cliente_id = ?`);
        }
        const contagens = {
          producao: this._escalarDe(novo, 'SELECT COUNT(*) FROM linhas_producao') || 0,
          sistema: this._escalarDe(novo, 'SELECT COUNT(*) FROM linhas_repasse') || 0,
          medico: this._escalarDe(novo, 'SELECT COUNT(*) FROM linhas_medico') || 0,
          hospitais: this._q(novo, 'SELECT id, nome FROM hospitais ORDER BY nome'),
        };
        const bytes = novo.export();
        return { bytes, contagens };
      } finally { novo.close(); }
    },

    /** v0.7 → v0.8: o banco único vira um cofre por cliente (uma vez só, no boot). */
    async _migrarLegado(bytes, progresso) {
      const p = typeof progresso === 'function' ? progresso : () => {};
      p('Separando a base por cliente (uma vez só)…');
      const antigo = new this.SQL.Database(bytes);
      const cat = this._catalogoVazio();
      try {
        antigo.exec(window.SCHEMA_SQL);
        this._migrar(antigo);
        const clientes = this._q(antigo, 'SELECT * FROM clientes ORDER BY id');
        for (const c of clientes) {
          p(`Separando a base por cliente… ${c.nome}`);
          const { bytes: b, contagens } = this._copiarCliente(antigo, c.id, c.id);
          await this._idbGravar(this.chaveCofre(c.id), b);
          cat.clientes.push({
            id: c.id, nome: c.nome, tipo: c.tipo || 'MEDICO', documento: c.documento || '', contato: c.contato || '',
            ativo: c.ativo == null ? 1 : Number(c.ativo), criado_em: c.criado_em || null,
            ...contagens, bytes: b.length, atualizado_em: new Date().toISOString(),
          });
          await new Promise(r => setTimeout(r, 0));
        }
        // cliente ativo: o da configuração gravada à parte (mais nova); senão o da tabela config antiga
        let ativo = 0;
        try {
          const rows = JSON.parse(this._configTxt || '[]');
          const r = (rows || []).find(x => x.chave === 'cliente_ativo');
          if (r) ativo = Number(JSON.parse(r.valor)) || 0;
        } catch (_) { /* sem config à parte */ }
        if (!ativo) ativo = Number(this._escalarDe(antigo, `SELECT valor FROM config WHERE chave = 'cliente_ativo'`)) || 0;
        cat.ativo = cat.clientes.some(c => c.id === ativo && c.ativo) ? ativo : 0;
        if (!this._configTxt) {
          this._configTxt = JSON.stringify(this._q(antigo, 'SELECT chave, valor, atualizado_em FROM config'));
          await this._idbGravar(this.IDB_CHAVE_CFG, this._configTxt);
        }
      } finally { antigo.close(); }
      // o banco único antigo fica no IndexedDB ('principal') como cópia de segurança
      return cat;
    },

    // ──────────────────────────────────────────────────────────────────
    // BACKUP MANUAL (.db) — por cliente
    // ──────────────────────────────────────────────────────────────────

    /** Bytes do cofre de um cliente (o aberto sai da memória, os outros do IndexedDB). */
    async exportarCliente(id) {
      id = Number(id) || this._clienteId;
      if (!id) throw new Error('Nenhum cliente para exportar.');
      if (id === this._clienteId) {
        if (this._emTransacao) throw new Error('Há uma importação em andamento — aguarde ela terminar.');
        return this.db.export();
      }
      const bytes = await this._idbLer(this.chaveCofre(id));
      if (!bytes) throw new Error('O cofre deste cliente não está neste navegador.');
      return bytes;
    },

    /** Baixa o backup (.db) de um cliente. */
    async exportarArquivo(id) {
      const c = this.cliente(id || this._clienteId);
      if (!c) throw new Error('Nenhum cliente para exportar.');
      const bytes = await this.exportarCliente(c.id);
      const data = new Date().toISOString().slice(0, 10);
      const slug = window.Utilidades.normalizar(c.nome).toLowerCase().replace(/\s+/g, '_').slice(0, 40) || 'cliente';
      window.Utilidades.baixarArquivo(`atlas_${slug}_${data}.db`, bytes, 'application/octet-stream');
    },

    _abrirArquivoDb(arrayBuffer) {
      const arq = new this.SQL.Database(new Uint8Array(arrayBuffer));
      const ok = arq.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='clientes'`);
      if (!ok.length) { arq.close(); throw new Error('O arquivo não parece um banco da ATLAS.'); }
      arq.exec(window.SCHEMA_SQL);   // garante tabelas/colunas novas num arquivo antigo
      this._migrar(arq);
      return arq;
    },

    /** Cliente do catálogo que corresponde a um cliente de um arquivo: mesmo documento, senão mesmo nome. */
    _casarCliente(c) {
      const U = window.Utilidades;
      const doc = U.normalizar(c.documento || '');
      const nome = U.normalizar(c.nome || '');
      const todos = this.catalogo().clientes;
      if (doc) { const porDoc = todos.find(x => U.normalizar(x.documento || '') === doc); if (porDoc) return porDoc; }
      return todos.find(x => U.normalizar(x.nome || '') === nome) || null;
    },

    /** O que um .db contém e o que a restauração faria com cada cliente dele. */
    async inspecionarArquivo(arrayBuffer) {
      const arq = this._abrirArquivoDb(arrayBuffer);
      try {
        return this._q(arq, 'SELECT id, nome, tipo, documento, contato, ativo FROM clientes ORDER BY id').map(c => {
          const alvo = this._casarCliente(c);
          return {
            id: c.id, nome: c.nome, tipo: c.tipo, documento: c.documento || '',
            producao: this._escalarDe(arq, 'SELECT COUNT(*) FROM linhas_producao WHERE cliente_id = ?', [c.id]) || 0,
            sistema: this._escalarDe(arq, 'SELECT COUNT(*) FROM linhas_repasse WHERE cliente_id = ?', [c.id]) || 0,
            alvo: alvo ? { id: alvo.id, nome: alvo.nome } : null,
          };
        });
      } finally { arq.close(); }
    },

    /**
     * Restaura um .db — o backup de um cliente ou o banco único da v0.7 (vários
     * clientes). Cada cliente do arquivo SUBSTITUI o cliente correspondente do
     * catálogo (mesmo documento, senão mesmo nome) ou entra como cliente novo.
     */
    async restaurarArquivo(arrayBuffer, progresso) {
      const p = typeof progresso === 'function' ? progresso : () => {};
      if (this._emTransacao) throw new Error('Há uma importação em andamento — aguarde ela terminar.');
      const arq = this._abrirArquivoDb(arrayBuffer);
      const resultado = { substituidos: [], novos: [] };
      try {
        const clientes = this._q(arq, 'SELECT * FROM clientes ORDER BY id');
        if (!clientes.length) throw new Error('O arquivo não tem nenhum cliente.');
        const aberto = this._clienteId;
        let reabrir = false;
        for (const c of clientes) {
          p(`Restaurando ${c.nome}…`);
          const alvo = this._casarCliente(c);
          const id = alvo ? alvo.id : this._proximoId();
          const { bytes, contagens } = this._copiarCliente(arq, c.id, id);
          if (id === aberto) { reabrir = true; if (this.db) { this.db.close(); this.db = null; } }
          await this._idbGravar(this.chaveCofre(id), bytes);
          const entrada = alvo || { id, criado_em: c.criado_em || new Date().toISOString() };
          Object.assign(entrada, {
            nome: c.nome, tipo: c.tipo || 'MEDICO', documento: c.documento || '', contato: c.contato || '', ativo: 1,
            ...contagens, bytes: bytes.length, atualizado_em: new Date().toISOString(),
          });
          if (!alvo) this.catalogo().clientes.push(entrada);
          (alvo ? resultado.substituidos : resultado.novos).push(entrada.nome);
          await new Promise(r => setTimeout(r, 0));
        }
        await this._gravarCatalogo();
        if (reabrir) { this._clienteId = 0; await this._abrir(aberto, p); }
        else if (!aberto && this.catalogo().clientes.length === resultado.novos.length && resultado.novos.length === 1) {
          await this.abrirCliente(this.catalogo().clientes[0].id, p);   // 1º cliente do navegador: já abre
        }
      } finally { arq.close(); }
      this._versao++;
      await this.salvar();
      return resultado;
    },

    /** Compatibilidade (v0.7): importar .db = restaurar. */
    async importarArquivo(arrayBuffer) { return this.restaurarArquivo(arrayBuffer); },

    /** Apaga TUDO deste navegador: cofres, catálogo, configuração e o banco antigo. */
    async resetar() {
      if (this._emTransacao) throw new Error('Há uma importação em andamento — aguarde ela terminar.');
      if (this.db) { try { this.db.close(); } catch (_) { /* nada */ } this.db = null; }
      await this._idbLimpar();
      this._catalogo = this._catalogoVazio();
      this._configTxt = '';
      this._clienteId = 0;
      await this._abrir(0);
      this._versao++;
      this._normVersao = this._versao;
      await this.salvar({ tudo: true });
    },
  };

  window.Banco = Banco;
})();
