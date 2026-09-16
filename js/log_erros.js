/**
 * ATLAS — Log LOCAL de erros (V695) — observabilidade offline
 * Captura erros de JavaScript (window.onerror) e promessas rejeitadas sem
 * tratamento, e grava num log LOCAL dentro do próprio banco (tabela
 * log_erros) — NADA sai da máquina. O log aparece em Administração →
 * "Log de erros" e ajuda a manutenção a diagnosticar problemas que o
 * usuário nem percebeu na hora.
 *
 * Regras:
 *  • Guarda no máx. 200 registros (os mais antigos caem sozinhos);
 *  • Erros repetidos em sequência viram UM registro com contador (n) —
 *    um erro em loop não infla o banco nem dispara salvamentos em série;
 *  • Erros antes do banco abrir ficam numa fila em memória e são gravados
 *    quando o banco estiver pronto;
 *  • A gravação usa salvarDebounced — nunca trava a interface.
 */
(function () {
  'use strict';

  let _fila = [];
  let _flushTimer = null;

  function _bancoPronto() { return !!(window.Banco && Banco.db); }

  function _garantirTabela() {
    Banco.executar(`CREATE TABLE IF NOT EXISTS log_erros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quando TEXT, tipo TEXT, tela TEXT, msg TEXT, stack TEXT,
      n INTEGER NOT NULL DEFAULT 1
    )`);
  }

  function _gravar(item) {
    try {
      _garantirTabela();
      // erro idêntico ao último registro → só incrementa o contador
      const ult = Banco.queryUnica(`SELECT id, msg, tipo FROM log_erros ORDER BY id DESC LIMIT 1`);
      if (ult && ult.msg === item.msg && ult.tipo === item.tipo) {
        Banco.executar(`UPDATE log_erros SET n = n + 1, quando = ? WHERE id = ?`, [item.quando, ult.id]);
      } else {
        Banco.executar(`INSERT INTO log_erros (quando, tipo, tela, msg, stack) VALUES (?,?,?,?,?)`,
          [item.quando, item.tipo, item.tela, item.msg, item.stack]);
        Banco.executar(`DELETE FROM log_erros WHERE id NOT IN (SELECT id FROM log_erros ORDER BY id DESC LIMIT 200)`);
      }
      if (Banco.salvarDebounced) Banco.salvarDebounced(8000);
    } catch (_) { /* o log NUNCA pode quebrar o app */ }
  }

  function registrar(tipo, msg, stack) {
    try {
      const item = {
        quando: new Date().toISOString().replace('T', ' ').slice(0, 19),
        tipo: String(tipo || 'erro'),
        tela: String((window.App && App.telaAtual) || ''),
        msg: String(msg || '').slice(0, 500),
        stack: String(stack || '').slice(0, 2000),
      };
      if (_bancoPronto()) { _flush(); _gravar(item); }
      else {
        if (_fila.length < 50) _fila.push(item);
        _armarFlush();
      }
    } catch (_) {}
  }

  function _flush() {
    if (!_bancoPronto() || !_fila.length) return;
    const f = _fila; _fila = [];
    f.forEach(_gravar);
  }
  function _armarFlush() {
    if (_flushTimer) return;
    _flushTimer = setInterval(() => {
      if (_bancoPronto()) { _flush(); clearInterval(_flushTimer); _flushTimer = null; }
    }, 3000);
  }

  function listar(n) {
    try { _garantirTabela(); return Banco.query(`SELECT * FROM log_erros ORDER BY id DESC LIMIT ?`, [n || 50]) || []; }
    catch (_) { return []; }
  }
  function contar() {
    try { _garantirTabela(); return (Banco.queryUnica(`SELECT COUNT(*) AS n FROM log_erros`) || {}).n || 0; }
    catch (_) { return 0; }
  }
  function limpar() {
    try {
      Banco.executar(`DELETE FROM log_erros`);
      if (Banco.salvarDebounced) Banco.salvarDebounced();
      return true;
    } catch (_) { return false; }
  }

  // captura global — instalada JÁ (este arquivo carrega logo após utilidades)
  window.addEventListener('error', (e) => {
    registrar('erro', e.message || (e.error && e.error.message) || String(e.type || 'erro'),
      e.error && e.error.stack ? e.error.stack : `${e.filename || ''}:${e.lineno || ''}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    registrar('promise', (r && r.message) || String(r || 'rejeição sem motivo'), r && r.stack);
  });

  window.AtlasLogErros = { registrar, listar, contar, limpar, _flush };
})();
