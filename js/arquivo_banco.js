/**
 * ATLAS — Arquivo automático do banco (V592)
 * O banco vive no IndexedDB do navegador (invisível, preso ao perfil). Este
 * módulo grava uma cópia AUTOMÁTICA num ARQUIVO real do Windows escolhido pelo
 * usuário (rede/OneDrive/pen drive) via File System Access API (Chrome/Edge):
 *
 *  • Vincular arquivo NOVO  → showSaveFilePicker; a ferramenta passa a gravar
 *    nele sozinha (debounce de ~12s após cada persistência do banco).
 *  • Vincular arquivo EXISTENTE (recuperação em máquina/navegador zerado) →
 *    showOpenFilePicker + restauração (Banco.importar) + vínculo.
 *  • Guarda anti-desastre: nunca sobrescreve um arquivo grande com um banco
 *    quase vazio (ex.: banco recém-resetado).
 *  • Permissão: o Chrome pode pedir de novo a cada sessão — no 1º clique do
 *    usuário após o boot tentamos reautorizar silenciosamente; a tela Backup
 *    tem o botão explícito.
 *
 * O IndexedDB continua sendo o armazenamento primário; o arquivo é a cópia de
 * segurança contínua (fica no máximo alguns segundos atrás; em banco GRANDE
 * — >128MB — no máximo ~5 minutos, com cura no flush de saída — V686).
 * V686: quando o worker do Banco está ativo, a gravação do arquivo acontece
 * DENTRO do worker (handle clonado) — nada de escrita de centenas de MB na
 * main thread.
 *
 * API (window.AtlasArquivoBanco): inicializar, vincularNovo, vincularExistente,
 * gravarAgora, reautorizar, desvincular, estado, aoSalvarBanco
 */
(function () {
  'use strict';

  const IDB_NOME = 'repasse_arquivo_vinculo';
  const IDB_STORE = 'handles';
  const CHAVE = 'arquivo_banco';
  const DEBOUNCE_MS = 12000;          // gravação no arquivo no máx. a cada ~12s
  const GUARDA_ARQ_MIN = 100 * 1024;  // arquivo com >100KB…
  const GUARDA_DB_MIN = 20 * 1024;    // …não é sobrescrito por banco com <20KB
  // V839: guarda RELATIVA — arquivo grande (>10MB) nunca é sobrescrito por um
  // banco com menos de 5% do tamanho dele. Cobre o perfil que perdeu o
  // IndexedDB: o app abriria "novo" (só seeds) e a cura regravaria o espelho
  // cheio com um banco vazio — o backup morreria junto com o principal.
  const GUARDA_REL_MIN = 10 * 1024 * 1024;
  const GUARDA_REL_FRACAO = 0.05;
  // V686: banco GRANDE não regrava o arquivo em todo salvamento — regravar
  // centenas de MB (rede/OneDrive) a cada gesto custava ~100s por vez. Acima
  // do limiar, o espelho grava no máx. a cada INTERVALO; entre gravações fica
  // "defasado" e é curado no próximo persist elegível ou no flush de saída.
  const LIMIAR_GRANDE = 128 * 1024 * 1024;    // >128MB = banco grande
  const INTERVALO_GRANDE_MS = 5 * 60 * 1000;  // no máx. a cada 5 min

  let _handle = null;                 // FileSystemFileHandle vinculado
  let _timer = null;
  let _gravando = false;
  let _pendente = false;
  let _ultimaGravacao = null;         // Date da última gravação OK
  let _erro = null;                   // 'permissao' | mensagem | null
  let _avisoPermMostrado = false;
  let _defasado = false;              // V686: espelho ficou atrás do banco (throttle)
  let _workerEscrevendo = false;      // V686: gravação em curso DENTRO do worker do Banco
  let _tamArquivoVisto = 0;           // V839: último tamanho conhecido do arquivo (guarda do worker)
  let _tamEnviadoWorker = 0;          // V839: tamanho da gravação em curso no worker

  // V686: limiar/intervalo sobrescrevíveis pelos testes automatizados
  function _cfgGrande() {
    const t = window.__arquivoBancoTeste || {};
    return { limiar: t.limiar || LIMIAR_GRANDE, intervalo: t.intervalo || INTERVALO_GRANDE_MS };
  }
  function _deveEscrever(tam) {
    const c = _cfgGrande();
    if (!tam || tam <= c.limiar) return true;
    if (!_ultimaGravacao) return true;
    return (Date.now() - _ultimaGravacao.getTime()) >= c.intervalo;
  }

  const suportado = () => typeof window.showSaveFilePicker === 'function' &&
                          typeof window.showOpenFilePicker === 'function';

  function toast(msg, tipo, ms) {
    try { window.Utilidades && Utilidades.toast && Utilidades.toast(msg, tipo || 'info', ms || 3200); } catch (_) {}
  }

  // ── vínculo persistido no IndexedDB (handles são clonáveis) ───────────
  function _abrirIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NOME, 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains(IDB_STORE)) idb.createObjectStore(IDB_STORE);
      };
    });
  }
  async function _lerHandle() {
    const idb = await _abrirIDB();
    return new Promise((resolve) => {
      try {
        const tx = idb.transaction(IDB_STORE, 'readonly');
        const rq = tx.objectStore(IDB_STORE).get(CHAVE);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }
  async function _gravarHandle(h) {
    const idb = await _abrirIDB();
    return new Promise((resolve) => {
      try {
        const tx = idb.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(h, CHAVE);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }
  async function _apagarHandle() {
    const idb = await _abrirIDB();
    return new Promise((resolve) => {
      try {
        const tx = idb.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(CHAVE);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }

  // ── permissão ─────────────────────────────────────────────────────────
  async function _temPermissao(pedir) {
    if (!_handle) return false;
    try {
      let p = await _handle.queryPermission({ mode: 'readwrite' });
      if (p === 'granted') return true;
      if (pedir) {
        p = await _handle.requestPermission({ mode: 'readwrite' });
        return p === 'granted';
      }
      return false;
    } catch (_) { return false; }
  }

  // ── escrita ───────────────────────────────────────────────────────────
  // V602: aceita bytes JÁ exportados (do salvamento do Banco) — antes fazia
  // um SEGUNDO export completo do banco (10-18s de tela presa em base grande)
  // só para gravar o arquivo.
  async function _escrever(pedirPermissao, bytesProntos) {
    if (!_handle || !window.Banco || !Banco.db) return false;
    if (_gravando) { _pendente = true; return false; }
    _gravando = true;
    try {
      if (!(await _temPermissao(!!pedirPermissao))) {
        _erro = 'permissao';
        if (!_avisoPermMostrado) {
          _avisoPermMostrado = true;
          toast('Gravação automática no arquivo pausada — reautorize em Sistema › Backup.', 'info', 5200);
        }
        return false;
      }
      // V659: bytes explicitamente passados mas vazios/transferidos (buffer
      // detached) → NO-OP; nunca cair num SEGUNDO export completo por acidente.
      // O fallback de export continua valendo só pra chamadas SEM bytes
      // (gravarAgora, debounce, cura de boot — export fresco intencional).
      if (bytesProntos && !bytesProntos.length) return false;
      const bytes = bytesProntos || Banco.db.export();
      // guarda anti-desastre: banco quase vazio não sobrescreve arquivo cheio
      try {
        const f = await _handle.getFile();
        _tamArquivoVisto = f.size;   // V839: referência para a guarda do worker
        if (f.size > GUARDA_ARQ_MIN && bytes.length < GUARDA_DB_MIN) {
          _erro = 'guarda: o banco atual está quase vazio e o arquivo tem dados — gravação bloqueada por segurança';
          console.warn('[arquivo-banco]', _erro);
          return false;
        }
        // V839: guarda relativa (ver constantes no topo)
        if (f.size > GUARDA_REL_MIN && bytes.length < f.size * GUARDA_REL_FRACAO) {
          _erro = 'guarda: o banco atual (' + Math.round(bytes.length / 1048576) + 'MB) é muito menor que o arquivo ('
            + Math.round(f.size / 1048576) + 'MB) — gravação bloqueada por segurança';
          console.warn('[arquivo-banco]', _erro);
          return false;
        }
      } catch (_) {}
      const w = await _handle.createWritable();
      await w.write(bytes);
      await w.close();
      _tamArquivoVisto = bytes.length;   // V839
      _ultimaGravacao = new Date();
      _erro = null;
      _defasado = false;   // V686
      return true;
    } catch (e) {
      _erro = String((e && e.message) || e);
      console.warn('[arquivo-banco] gravação falhou:', e);
      return false;
    } finally {
      _gravando = false;
      if (_pendente) { _pendente = false; _agendar(); }
    }
  }
  function _agendar() {
    if (!_handle) return;
    clearTimeout(_timer);
    _timer = setTimeout(() => { _timer = null; _escrever(false); }, DEBOUNCE_MS);
  }

  // ── API ───────────────────────────────────────────────────────────────
  /** Chamado pelo Banco após cada persistência no IndexedDB.
   *  V602: quando o Banco passa os bytes já exportados, grava DIRETO no
   *  arquivo (sem novo export, sem debounce — os salvamentos já coalescem). */
  function aoSalvarBanco(bytes) {
    if (bytes && bytes.length) {
      if (!_deveEscrever(bytes.length)) { _defasado = true; return; }   // V686
      clearTimeout(_timer); _timer = null; _escrever(false, bytes);
    }
    else _agendar();
  }

  /** V659: grava os bytes JÁ exportados de forma AGUARDÁVEL — chamado pelo
   *  Banco ANTES de transferir o mesmo buffer pro worker do IndexedDB
   *  (zero-cópia: w.write() copia internamente, o buffer segue íntegro).
   *  Se outra escrita está em curso, pula — o próximo salvamento cobre. */
  async function gravarBytes(bytes) {
    if (!_handle || !bytes || !bytes.length) return false;
    // V686: banco grande gravado há pouco → pula esta rodada (fica defasado;
    // o próximo persist elegível ou o flush de saída regrava).
    if (!_deveEscrever(bytes.length)) { _defasado = true; return false; }
    clearTimeout(_timer); _timer = null;
    if (_gravando) return false;
    return _escrever(false, bytes);
  }

  /** V686: o worker do Banco grava o arquivo por nós (handle é clonável) —
   *  aqui só decidimos SE esta rodada grava (throttle de banco grande +
   *  reentrância) e entregamos o handle. O resultado volta em resultadoWorker. */
  function paraWorker(tam) {
    if (!_handle || _gravando || _workerEscrevendo) return null;
    // V839: guarda relativa também no caminho do worker (lá o handle grava
    // sem conferir o arquivo) — compara com o último tamanho visto do arquivo
    if (_tamArquivoVisto > GUARDA_REL_MIN && tam && tam < _tamArquivoVisto * GUARDA_REL_FRACAO) {
      _erro = 'guarda: o banco atual (' + Math.round(tam / 1048576) + 'MB) é muito menor que o arquivo ('
        + Math.round(_tamArquivoVisto / 1048576) + 'MB) — gravação bloqueada por segurança';
      console.warn('[arquivo-banco]', _erro);
      return null;
    }
    if (!_deveEscrever(tam)) { _defasado = true; return null; }
    clearTimeout(_timer); _timer = null;
    _workerEscrevendo = true;
    _tamEnviadoWorker = tam || 0;   // V839
    return _handle;
  }
  function resultadoWorker(ok, erro) {
    _workerEscrevendo = false;
    if (ok) {
      _ultimaGravacao = new Date(); _erro = null; _defasado = false;
      if (_tamEnviadoWorker) _tamArquivoVisto = _tamEnviadoWorker;   // V839
      return;
    }
    if (erro == null) return;   // worker não chegou a gravar (sem erro do arquivo)
    _erro = /notallowed|permission|permiss/i.test(String(erro)) ? 'permissao' : String(erro);
    if (_erro === 'permissao' && !_avisoPermMostrado) {
      _avisoPermMostrado = true;
      toast('Gravação automática no arquivo pausada — reautorize em Sistema › Backup.', 'info', 5200);
    }
    console.warn('[arquivo-banco] gravação via worker falhou:', erro);
  }

  /** V659: cura de boot — com o skip do export no início da sessão, o arquivo
   *  só é regravado se estiver DEFASADO do banco carregado (tamanho difere).
   *  Evita pagar um export completo em todo boot só pra reescrever o idêntico. */
  async function _curarSeDefasado() {
    try {
      if (!_handle || !window.Banco || !Banco.db) return;
      if (!(await _temPermissao(false))) return;
      const f = await _handle.getFile();
      _tamArquivoVisto = f.size;   // V839: referência para a guarda do worker
      const tam = Number(Banco._ultimoExportTam) || 0;
      if (tam && f.size === tam) return;   // arquivo já espelha o banco
      _agendar();                          // defasado: agenda a regravação
    } catch (_) {}
  }

  /** Vincula um arquivo NOVO (ou sobrescreve um escolhido conscientemente). */
  async function vincularNovo() {
    if (!suportado()) throw new Error('Este navegador não tem suporte — use Chrome ou Edge.');
    const h = await window.showSaveFilePicker({
      suggestedName: `repasse_dados_${new Date().toISOString().slice(0, 10)}.db`,
      types: [{ description: 'Banco do Repasse Médico (.db)', accept: { 'application/octet-stream': ['.db'] } }],
    });
    // arquivo já com conteúdo → confirmação explícita antes de sobrescrever
    try {
      const f = await h.getFile();
      if (f.size > 0) {
        const ok = window.confirm(
          `O arquivo "${h.name}" já contém dados (${(f.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB).\n\n` +
          `Ele será SOBRESCRITO pelos dados atuais da ferramenta.\n` +
          `Para CARREGAR os dados desse arquivo, use "Vincular arquivo existente (restaurar)".\n\nSobrescrever?`);
        if (!ok) return null;
      }
    } catch (_) {}
    _handle = h; _erro = null;
    await _gravarHandle(h);
    const ok = await _escrever(true);
    if (ok) toast(`Arquivo vinculado: ${h.name} — gravação automática ativada`, 'success');
    return h.name;
  }

  /** Vincula um arquivo EXISTENTE e RESTAURA o banco a partir dele
   *  (recuperação em máquina/navegador zerado). */
  async function vincularExistente() {
    if (!suportado()) throw new Error('Este navegador não tem suporte — use Chrome ou Edge.');
    const [h] = await window.showOpenFilePicker({
      types: [{ description: 'Banco do Repasse Médico (.db)', accept: { 'application/octet-stream': ['.db', '.sqlite', '.sqlite3'] } }],
      multiple: false,
    });
    const f = await h.getFile();
    if (!f.size) throw new Error('O arquivo escolhido está vazio.');
    const ok = window.confirm(
      `Restaurar substituirá TODOS os dados atuais da ferramenta pelos dados de "${h.name}".\n\nContinuar?`);
    if (!ok) return null;
    await Banco.importar(f);          // valida antes de trocar (V491)
    _handle = h; _erro = null;
    await _gravarHandle(h);
    await _temPermissao(true);        // já garante o readwrite p/ gravação automática
    toast(`Banco restaurado de ${h.name} — gravação automática ativada`, 'success');
    return h.name;
  }

  /** Gravação imediata (gesto do usuário — pode pedir permissão). */
  async function gravarAgora() {
    if (!_handle) return false;
    clearTimeout(_timer); _timer = null;
    return _escrever(true);
  }

  /** Reautoriza a permissão do arquivo (gesto do usuário). */
  async function reautorizar() {
    const ok = await _temPermissao(true);
    if (ok) { _erro = null; _avisoPermMostrado = false; _curarSeDefasado(); }   // V659
    return ok;
  }

  async function desvincular() {
    clearTimeout(_timer); _timer = null;
    _handle = null; _erro = null; _ultimaGravacao = null;
    await _apagarHandle();
  }

  /** V837: lê o .db do vínculo SEM interação — só quando a permissão de
   *  leitura já está concedida. Usado pela AUTO-RECUPERAÇÃO do boot. */
  async function lerBytesSilencioso() {
    if (!_handle) { try { _handle = await _lerHandle(); } catch (_) {} }
    if (!_handle) return null;
    try {
      if ((await _handle.queryPermission({ mode: 'read' })) !== 'granted') return null;
      const f = await _handle.getFile();
      _tamArquivoVisto = f.size;   // V839
      const b = new Uint8Array(await f.arrayBuffer());
      return b.byteLength > 100 ? b : null;
    } catch (_) { return null; }
  }
  /** V837: lê o .db do vínculo DENTRO de um clique (pode pedir permissão). */
  async function lerBytesComPermissao() {
    if (!_handle) { try { _handle = await _lerHandle(); } catch (_) {} }
    if (!_handle) return null;
    try {
      let perm = await _handle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') perm = await _handle.requestPermission({ mode: 'read' });
      if (perm !== 'granted') return null;
      const f = await _handle.getFile();
      _tamArquivoVisto = f.size;   // V839
      const b = new Uint8Array(await f.arrayBuffer());
      return b.byteLength > 100 ? b : null;
    } catch (_) { return null; }
  }

  function estado() {
    return {
      suportado: suportado(),
      vinculado: !!_handle,
      nome: _handle ? _handle.name : null,
      ultimaGravacao: _ultimaGravacao,
      erro: _erro,
      defasado: _defasado,   // V686: espelho atrás do banco (throttle de banco grande)
    };
  }

  /** Boot: recarrega o vínculo e arma a reautorização no 1º clique. */
  async function inicializar() {
    if (!suportado()) return estado();
    try { _handle = await _lerHandle(); } catch (_) { _handle = null; }
    if (_handle) {
      try {
        const p = await _handle.queryPermission({ mode: 'readwrite' });
        if (p === 'granted') { _curarSeDefasado(); }   // V659: só regrava se defasado
        else {
          // requestPermission exige gesto do usuário — aproveita o 1º clique
          const tentar = async () => {
            const ok = await _temPermissao(true);
            if (ok) { _erro = null; _curarSeDefasado(); toast(`Gravação automática no arquivo ${_handle.name} reativada`, 'success'); }   // V659
          };
          document.addEventListener('click', tentar, { once: true });
        }
      } catch (_) {}
    }
    return estado();
  }

  // flush best-effort ao esconder/fechar a aba (se havia gravação agendada
  // ou o espelho ficou defasado pelo throttle de banco grande — V686)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && _handle && (_timer || _defasado)) {
      clearTimeout(_timer); _timer = null;
      _escrever(false);
    }
  });

  window.AtlasArquivoBanco = {
    inicializar, vincularNovo, vincularExistente, gravarAgora, reautorizar,
    desvincular, estado, aoSalvarBanco, gravarBytes,
    paraWorker, resultadoWorker,                    // V686
    lerBytesSilencioso, lerBytesComPermissao,       // V837: auto-recuperação
    _setHandleParaTeste: (h) => { _handle = h; },   // testes automatizados
  };
})();
