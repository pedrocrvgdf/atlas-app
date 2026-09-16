/**
 * ATLAS — Lembretes / Alertas
 * Painel de lembretes acessível pelo ícone de alerta no canto superior
 * esquerdo da Visão Geral. Caixinhas por categoria (kanban) usadas para
 * lembrar informações importantes durante o repasse.
 *
 * Persistência: tabela `lembretes` (sql.js + IndexedDB via Banco).
 * O modal é montado em document.body (escapa o transform do .main).
 *
 * API pública (window.AtlasLembretes):
 *   - montar(btnId)      → liga o botão do header e pinta o estado do ícone
 *   - atualizarIcone()   → repinta o estado (verde se há lembrete / contorno se não)
 *   - abrir()            → abre o modal kanban
 *   - contar()           → nº de lembretes
 *   - iconeSVG()         → markup do ícone (triângulo de alerta)
 */
(function () {
  'use strict';

  const CATEGORIAS = [
    { id: 'Importante', cor: '#C0392B', bg: '#FBEAE8', faixa: 'rgba(192,57,43,0.06)' },
    { id: 'Urgente',    cor: '#D35400', bg: '#FCEBDD', faixa: 'rgba(211,84,0,0.06)' },
    { id: 'Pessoal',    cor: '#2D6FB8', bg: '#E6EFF8', faixa: 'rgba(45,111,184,0.06)' },
    { id: 'Trabalho',   cor: '#7E57C2', bg: '#EEE8F7', faixa: 'rgba(126,87,194,0.06)' },
  ];
  const VERDE_ATIVO = '#1EBBD7';

  // ── util ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function hojeISO() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function fmtDataLonga(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    const ano = m[1], mes = parseInt(m[2], 10) - 1, dia = parseInt(m[3], 10);
    if (mes < 0 || mes > 11) return iso;
    return `${dia} de ${MESES[mes]} de ${ano}`;
  }
  function toast(msg, tipo, ms) {
    try { window.Utilidades && window.Utilidades.toast && window.Utilidades.toast(msg, tipo || 'info', ms || 2200); }
    catch (e) {}
  }
  function catInfo(id) {
    return CATEGORIAS.find(c => c.id === id) || CATEGORIAS[0];
  }

  // ── dados ─────────────────────────────────────────────────────────────
  // V549: coluna `concluido` (0/1) — migração para bancos já existentes
  let _colOk = false;
  function garantirColunaConcluido() {
    if (_colOk) return;
    try {
      const cols = window.Banco.query(`PRAGMA table_info(lembretes)`) || [];
      if (!cols.some(c => c.name === 'concluido')) {
        window.Banco.executar(`ALTER TABLE lembretes ADD COLUMN concluido INTEGER NOT NULL DEFAULT 0`);
      }
      _colOk = true;
    } catch (e) { console.warn('[lembretes] migração concluido:', e); }
  }
  function listar() {
    garantirColunaConcluido();
    try {
      // V549: pendentes primeiro; concluídos vão para o fim da coluna
      return window.Banco.query(`
        SELECT id, categoria, titulo, descricao, data, criado_em,
               COALESCE(concluido, 0) AS concluido
          FROM lembretes
         ORDER BY COALESCE(concluido,0) ASC, (data IS NULL), data DESC, id DESC
      `);
    } catch (e) { return []; }
  }
  // V549: o badge conta só o que está PENDENTE (concluído não alerta mais)
  function contar() {
    garantirColunaConcluido();
    try {
      const r = window.Banco.queryUnica(`SELECT COUNT(*) AS n FROM lembretes WHERE COALESCE(concluido,0) = 0`);
      return r ? (Number(r.n) || 0) : 0;
    } catch (e) {
      try { return window.Banco.contar('lembretes'); } catch (_) { return 0; }
    }
  }
  async function alternarConcluido(id, valor) {
    garantirColunaConcluido();
    window.Banco.executar(`UPDATE lembretes SET concluido = ? WHERE id = ?`, [valor ? 1 : 0, id]);
    await window.Banco.salvar();
  }
  async function criar({ categoria, titulo, descricao, data }) {
    window.Banco.executar(
      `INSERT INTO lembretes (categoria, titulo, descricao, data) VALUES (?, ?, ?, ?)`,
      [categoria || 'Importante', titulo || '', descricao || null, data || null]
    );
    await window.Banco.salvar();
  }
  async function atualizar(id, { categoria, titulo, descricao, data }) {
    window.Banco.executar(
      `UPDATE lembretes SET categoria = ?, titulo = ?, descricao = ?, data = ? WHERE id = ?`,
      [categoria, titulo, descricao || null, data || null, id]
    );
    await window.Banco.salvar();
  }
  async function remover(id) {
    window.Banco.executar(`DELETE FROM lembretes WHERE id = ?`, [id]);
    await window.Banco.salvar();
  }

  // ── ícone ─────────────────────────────────────────────────────────────
  function iconeSVG() {
    return `
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none"
           xmlns="http://www.w3.org/2000/svg" class="vg-lb-svg" aria-hidden="true">
        <path class="vg-lb-tri"
              d="M12 4.3c.47 0 .9.25 1.14.66l7.86 13.43c.48.82-.11 1.86-1.06 1.86H4.06c-.95 0-1.54-1.04-1.06-1.86L10.86 4.96c.24-.41.67-.66 1.14-.66z"
              stroke-width="1.7" stroke-linejoin="round"/>
        <path class="vg-lb-stem" d="M12 9.4v4.4" stroke-width="1.9" stroke-linecap="round"/>
        <circle class="vg-lb-dot" cx="12" cy="16.7" r="1.05"/>
      </svg>`;
  }

  let _btnId = null;
  function montar(btnId) {
    _btnId = btnId;
    injetarEstilos();
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.innerHTML = iconeSVG();
    btn.title = 'Lembretes / alertas';
    btn.setAttribute('aria-label', 'Lembretes e alertas');
    btn.onclick = abrir;
    atualizarIcone();
  }
  function atualizarIcone() {
    if (!_btnId) return;
    const btn = document.getElementById(_btnId);
    if (!btn) return;
    const tem = contar() > 0;
    btn.classList.toggle('tem', tem);
    const badge = btn.querySelector('.vg-lb-badge');
    const n = contar();
    if (tem) {
      if (badge) badge.textContent = n;
      else {
        const b = document.createElement('span');
        b.className = 'vg-lb-badge';
        b.textContent = n;
        btn.appendChild(b);
      }
    } else if (badge) badge.remove();
  }

  // ── modal kanban ──────────────────────────────────────────────────────
  let _overlay = null;
  // edição: { id|null, categoria } da caixinha em edição (null = nenhuma)
  let _editando = null;

  function abrir() {
    if (_overlay) return;
    injetarEstilos();
    _editando = null;
    _overlay = document.createElement('div');
    _overlay.className = 'vg-lb-overlay';
    _overlay.innerHTML = `
      <div class="vg-lb-modal" role="dialog" aria-label="Lembretes e alertas">
        <div class="vg-lb-head">
          <h3><span class="vg-lb-head-ico">${iconeSVG()}</span> Lembretes / alertas</h3>
          <button class="vg-lb-fechar" aria-label="Fechar">✕</button>
        </div>
        <div class="vg-lb-sub">Caixinhas pra lembrar de informações importantes durante o repasse.</div>
        <div class="vg-lb-board" id="vg-lb-board"></div>
      </div>`;
    document.body.appendChild(_overlay);
    _overlay.querySelector('.vg-lb-head-ico .vg-lb-svg')?.classList.add('tem');
    _overlay.querySelector('.vg-lb-fechar').addEventListener('click', fechar);
    _overlay.addEventListener('click', (e) => { if (e.target === _overlay) fechar(); });
    document.addEventListener('keydown', escHandler);
    renderBoard();
  }
  function fechar() {
    if (!_overlay) return;
    _overlay.remove();
    _overlay = null;
    _editando = null;
    document.removeEventListener('keydown', escHandler);
    atualizarIcone();
  }
  function escHandler(e) { if (e.key === 'Escape') { if (_editando) { _editando = null; renderBoard(); } else fechar(); } }

  function renderBoard() {
    const board = _overlay && _overlay.querySelector('#vg-lb-board');
    if (!board) return;
    const todos = listar();
    board.innerHTML = CATEGORIAS.map(cat => {
      const itens = todos.filter(l => l.categoria === cat.id);
      const cards = itens.map(l => renderCard(l, cat)).join('');
      const formNovo = (_editando && _editando.id == null && _editando.categoria === cat.id)
        ? renderForm(null, cat) : '';
      const btnNovo = formNovo ? '' : `
        <button class="vg-lb-novo" data-cat="${esc(cat.id)}" style="color:${cat.cor}">
          <span>+</span> Novo item
        </button>`;
      return `
        <div class="vg-lb-col" style="background:${cat.faixa}">
          <div class="vg-lb-col-head" style="background:${cat.bg};color:${cat.cor}">
            <span>${esc(cat.id)}</span>
            <span class="vg-lb-col-count">${itens.filter(x => Number(x.concluido) !== 1).length}</span>
          </div><!-- V549: conta só pendentes -->
          <div class="vg-lb-cards">
            ${cards || (formNovo ? '' : `<div class="vg-lb-vazio">Sem lembretes</div>`)}
            ${formNovo}
            ${btnNovo}
          </div>
        </div>`;
    }).join('');
    ligarEventosBoard();
  }

  function renderCard(l, cat) {
    if (_editando && _editando.id === l.id) return renderForm(l, cat);
    const dataTxt = l.data ? fmtDataLonga(l.data) : '';
    const desc = l.descricao ? `<div class="vg-lb-card-desc">${esc(l.descricao)}</div>` : '';
    // V549: checkbox de conclusão — marcado risca o texto e dá a tarefa como feita
    const feito = Number(l.concluido) === 1;
    return `
      <div class="vg-lb-card${feito ? ' vg-lb-feito' : ''}" data-id="${l.id}">
        <div class="vg-lb-card-top">
          <button type="button" class="vg-lb-check${feito ? ' on' : ''}" data-id="${l.id}"
                  role="checkbox" aria-checked="${feito ? 'true' : 'false'}"
                  title="${feito ? 'Reabrir tarefa' : 'Marcar como concluída'}"
                  style="${feito ? `background:${cat.cor};border-color:${cat.cor}` : ''}">✓</button>
          <div class="vg-lb-card-titulo">${esc(l.titulo)}</div>
          <div class="vg-lb-card-acoes">
            <button class="vg-lb-edit" data-id="${l.id}" title="Editar">✎</button>
            <button class="vg-lb-del" data-id="${l.id}" title="Remover">✕</button>
          </div>
        </div>
        ${desc}
        ${dataTxt ? `<div class="vg-lb-card-data">${esc(dataTxt)}</div>` : ''}
      </div>`;
  }

  function renderForm(l, cat) {
    const id = l ? l.id : '';
    const titulo = l ? esc(l.titulo) : '';
    const descricao = l ? esc(l.descricao || '') : '';
    const data = l && l.data ? l.data.slice(0, 10) : hojeISO();
    return `
      <div class="vg-lb-form" data-id="${id}" data-cat="${esc(cat.id)}" style="border-color:${cat.cor}">
        <input type="text" class="vg-lb-in-titulo" placeholder="Título do lembrete" value="${titulo}" maxlength="160">
        <textarea class="vg-lb-in-desc" placeholder="Descrição (opcional)" rows="2">${descricao}</textarea>
        <input type="date" class="vg-lb-in-data" value="${esc(data)}">
        <div class="vg-lb-form-acoes">
          <button class="vg-lb-cancel">Cancelar</button>
          <button class="vg-lb-salvar" style="background:${cat.cor}">Salvar</button>
        </div>
      </div>`;
  }

  function ligarEventosBoard() {
    const board = _overlay.querySelector('#vg-lb-board');

    board.querySelectorAll('.vg-lb-novo').forEach(b => {
      b.addEventListener('click', () => {
        _editando = { id: null, categoria: b.dataset.cat };
        renderBoard();
        const inp = _overlay.querySelector('.vg-lb-form .vg-lb-in-titulo');
        if (inp) inp.focus();
      });
    });
    board.querySelectorAll('.vg-lb-edit').forEach(b => {
      b.addEventListener('click', () => {
        const id = parseInt(b.dataset.id, 10);
        const l = listar().find(x => x.id === id);
        _editando = { id, categoria: l ? l.categoria : 'Importante' };
        renderBoard();
        const inp = _overlay.querySelector('.vg-lb-form .vg-lb-in-titulo');
        if (inp) { inp.focus(); inp.select(); }
      });
    });
    // V549: checkbox de conclusão (risca o texto e marca como feito)
    board.querySelectorAll('.vg-lb-check').forEach(b => {
      b.addEventListener('click', async () => {
        const id = parseInt(b.dataset.id, 10);
        const marcando = !b.classList.contains('on');
        await alternarConcluido(id, marcando);
        renderBoard();
        atualizarIcone();
        toast(marcando ? 'Tarefa concluída' : 'Tarefa reaberta', marcando ? 'success' : 'info');
      });
    });
    board.querySelectorAll('.vg-lb-del').forEach(b => {
      b.addEventListener('click', async () => {
        const id = parseInt(b.dataset.id, 10);
        await remover(id);
        toast('Lembrete removido', 'info');
        renderBoard();
        atualizarIcone();
      });
    });
    board.querySelectorAll('.vg-lb-form').forEach(form => {
      const idAttr = form.dataset.id;
      const id = idAttr ? parseInt(idAttr, 10) : null;
      const cat = form.dataset.cat;
      const inTitulo = form.querySelector('.vg-lb-in-titulo');
      const salvar = async () => {
        const titulo = (inTitulo.value || '').trim();
        if (!titulo) { inTitulo.focus(); inTitulo.classList.add('vg-lb-erro'); return; }
        const descricao = (form.querySelector('.vg-lb-in-desc').value || '').trim();
        const data = form.querySelector('.vg-lb-in-data').value || null;
        if (id == null) await criar({ categoria: cat, titulo, descricao, data });
        else            await atualizar(id, { categoria: cat, titulo, descricao, data });
        _editando = null;
        renderBoard();
        atualizarIcone();
        toast(id == null ? 'Lembrete adicionado' : 'Lembrete atualizado', 'success');
      };
      form.querySelector('.vg-lb-salvar').addEventListener('click', salvar);
      form.querySelector('.vg-lb-cancel').addEventListener('click', () => { _editando = null; renderBoard(); });
      inTitulo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); salvar(); }
      });
      inTitulo.addEventListener('input', () => inTitulo.classList.remove('vg-lb-erro'));
    });
  }

  // ── estilos ───────────────────────────────────────────────────────────
  function injetarEstilos() {
    if (document.getElementById('vg-lb-estilos')) return;
    const st = document.createElement('style');
    st.id = 'vg-lb-estilos';
    st.textContent = `
      /* header da Visão Geral: botão de alerta no canto superior DIREITO (onde ficava o globo) */
      .vg-header { position: relative; }
      .vg-header-left { display: flex; align-items: center; gap: 14px; }
      /* botão do header (canto sup. direito) */
      .vg-lembrete-btn {
        --tri-fill: none; --tri-stroke: #9aa09c; --mark: #9aa09c;
        position: absolute; top: 0; right: 0;
        width: 40px; height: 40px;
        display: inline-flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.5);
        border: 1px solid var(--border, rgba(0,0,0,0.08));
        border-radius: 12px; cursor: pointer;
        transition: background-color .15s ease, border-color .15s ease, transform .12s ease, box-shadow .15s ease;
      }
      .vg-lembrete-btn:hover { background: #fff; transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,0.08); }
      /* V586: com pendências o ícone fica IGUAL ao olho ao lado (cinza neutro);
         só o número da notificação (badge) mantém a cor */
      .vg-lembrete-btn.tem {
        --tri-fill: none; --tri-stroke: #9aa09c; --mark: #9aa09c;
      }
      .vg-lb-svg .vg-lb-tri  { fill: var(--tri-fill); stroke: var(--tri-stroke); }
      .vg-lb-svg .vg-lb-stem { stroke: var(--mark); }
      .vg-lb-svg .vg-lb-dot  { fill: var(--mark); }
      .vg-lb-badge {
        position: absolute; top: -5px; right: -5px;
        min-width: 17px; height: 17px; padding: 0 4px;
        background: ${VERDE_ATIVO}; color: #003A54;
        font: 700 10px/1 var(--font-display, Inter Tight), sans-serif;
        display: inline-flex; align-items: center; justify-content: center;
        border-radius: 999px;
        border: 2px solid var(--surface, #F5F2EC);
        box-sizing: border-box;
      }

      /* overlay + modal */
      .vg-lb-overlay {
        position: fixed; inset: 0; z-index: 4000;
        background: rgba(20,28,25,0.42);
        display: flex; align-items: center; justify-content: center;
        padding: 24px; 
      }
      .vg-lb-modal {
        width: min(1100px, 96vw); max-height: 90vh;
        display: flex; flex-direction: column;
        background: var(--surface, #F5F2EC);
        border: 1px solid var(--border, rgba(0,0,0,0.08));
        border-radius: 18px; overflow: hidden;
        box-shadow: 0 24px 70px rgba(0,0,0,0.30);
      }
      .vg-lb-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 20px 10px;
      }
      .vg-lb-head h3 {
        margin: 0; display: flex; align-items: center; gap: 10px;
        font-family: var(--font-display, Inter Tight), sans-serif;
        font-size: 19px; font-weight: 600; color: var(--primary, #06283A);
      }
      .vg-lb-head-ico { display: inline-flex; width: 24px; height: 24px; }
      .vg-lb-fechar {
        width: 30px; height: 30px; border-radius: 8px;
        background: rgba(255,255,255,0.6); border: 1px solid rgba(0,0,0,0.1);
        cursor: pointer; color: var(--primary, #06283A); font-size: 14px;
      }
      .vg-lb-fechar:hover { background: #fff; }
      .vg-lb-sub {
        padding: 0 20px 14px; font-size: 12.5px; color: var(--ink-faint, #7a8079);
      }

      /* board */
      .vg-lb-board {
        display: flex; gap: 14px; padding: 4px 20px 20px;
        overflow: auto; align-items: flex-start;
      }
      .vg-lb-col {
        flex: 1 1 0; min-width: 230px;
        border-radius: 14px; padding: 8px;
        display: flex; flex-direction: column; gap: 8px;
      }
      .vg-lb-col-head {
        display: inline-flex; align-items: center; gap: 8px;
        align-self: flex-start;
        padding: 4px 12px; border-radius: 8px;
        font: 600 13px/1 var(--font-display, Inter Tight), sans-serif;
      }
      .vg-lb-col-count { opacity: .7; font-size: 12px; }
      .vg-lb-cards { display: flex; flex-direction: column; gap: 8px; }
      .vg-lb-vazio {
        font-size: 12px; color: var(--ink-faint, #9aa09c);
        padding: 8px 6px; font-style: italic;
      }

      /* card */
      .vg-lb-card {
        background: #fff; border: 1px solid rgba(0,0,0,0.07);
        border-radius: 10px; padding: 10px 12px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      }
      .vg-lb-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
      .vg-lb-card-titulo {
        font: 500 13.5px/1.35 var(--font-display, Inter Tight), sans-serif;
        color: var(--primary, #06283A); word-break: break-word; flex: 1;
      }
      .vg-lb-card-acoes { display: flex; gap: 2px; opacity: 0; transition: opacity .12s ease; }
      .vg-lb-card:hover .vg-lb-card-acoes { opacity: 1; }
      .vg-lb-edit, .vg-lb-del {
        width: 22px; height: 22px; border-radius: 6px;
        border: none; background: transparent; cursor: pointer;
        font-size: 12px; color: var(--ink-faint, #7a8079);
      }
      .vg-lb-edit:hover { background: rgba(0,0,0,0.06); color: var(--primary, #06283A); }
      .vg-lb-del:hover  { background: rgba(192,57,43,0.10); color: #C0392B; }
      .vg-lb-card-desc {
        margin-top: 5px; font-size: 12px; line-height: 1.4;
        color: var(--ink-soft, #5a625a); white-space: pre-wrap; word-break: break-word;
      }
      .vg-lb-card-data {
        margin-top: 7px; font-size: 11.5px; color: var(--ink-faint, #9aa09c);
      }

      /* V549: checkbox de conclusão — marcado risca o texto (tarefa concluída) */
      .vg-lb-check {
        width: 18px; height: 18px; flex: none; margin-top: 1px;
        border: 1.6px solid rgba(0,0,0,0.22); border-radius: 5px;
        background: #fff; cursor: pointer; padding: 0;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; line-height: 1; color: transparent;
        transition: background-color .12s ease, border-color .12s ease, color .12s ease;
      }
      .vg-lb-check:hover { border-color: rgba(0,0,0,0.42); color: rgba(0,0,0,0.25); }
      .vg-lb-check.on { color: #fff; }
      .vg-lb-feito { opacity: .62; }
      .vg-lb-feito .vg-lb-card-titulo,
      .vg-lb-feito .vg-lb-card-desc { text-decoration: line-through; }
      .vg-lb-feito .vg-lb-card-titulo { color: var(--ink-faint, #7a8079); }

      /* + novo */
      .vg-lb-novo {
        text-align: left; background: transparent; border: none; cursor: pointer;
        padding: 7px 6px; border-radius: 8px;
        font: 500 12.5px/1 var(--font-display, Inter Tight), sans-serif;
        display: flex; align-items: center; gap: 6px; opacity: .85;
      }
      .vg-lb-novo span { font-size: 15px; line-height: 1; }
      .vg-lb-novo:hover { background: rgba(0,0,0,0.04); opacity: 1; }

      /* form */
      .vg-lb-form {
        background: #fff; border: 1.5px solid; border-radius: 10px;
        padding: 10px; display: flex; flex-direction: column; gap: 7px;
      }
      .vg-lb-form input, .vg-lb-form textarea {
        font: 400 13px/1.35 var(--font-display, Inter Tight), sans-serif;
        border: 1px solid rgba(0,0,0,0.12); border-radius: 7px;
        padding: 7px 9px; background: #fff; color: var(--primary, #06283A);
        width: 100%; box-sizing: border-box; resize: vertical;
      }
      .vg-lb-form input:focus, .vg-lb-form textarea:focus { outline: none; border-color: var(--primary, #06283A); }
      .vg-lb-in-titulo.vg-lb-erro { border-color: #C0392B; background: rgba(192,57,43,0.04); }
      .vg-lb-form-acoes { display: flex; justify-content: flex-end; gap: 7px; margin-top: 1px; }
      .vg-lb-cancel, .vg-lb-salvar {
        font: 600 12px/1 var(--font-display, Inter Tight), sans-serif;
        padding: 7px 13px; border-radius: 7px; cursor: pointer; border: 1px solid transparent;
      }
      .vg-lb-cancel { background: transparent; color: var(--ink-soft, #5a625a); border-color: rgba(0,0,0,0.12); }
      .vg-lb-cancel:hover { background: rgba(0,0,0,0.04); }
      .vg-lb-salvar { color: #fff; }
      .vg-lb-salvar:hover { filter: brightness(1.05); }

      /* V550/V551: pop-up de pendências — mesma linguagem dos modais do app
         (overlay escuro, cartão elevado, cabeçalho com borda, rodapé de ações) */
      .vg-lb-aviso-ov {
        /* V601: SEMPRE acima das visões ampliadas (que usam 100000) — com
           z-index empatado o aviso podia ficar atrás e parecer "travado" */
        position: fixed; inset: 0; z-index: 100020;
        background: rgba(30,30,28,0.45);
        display: flex; align-items: center; justify-content: center; padding: 20px;
        animation: vgLbFadeIn .16s ease-out;
      }
      @keyframes vgLbFadeIn { from { opacity: 0 } to { opacity: 1 } }
      .vg-lb-aviso {
        background: var(--bg-elevated, #fff); border-radius: 16px; overflow: hidden;
        width: 100%; max-width: 460px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        display: flex; flex-direction: column;
        animation: vgLbSobe .18s cubic-bezier(.2,.7,.3,1);
      }
      @keyframes vgLbSobe { from { transform: translateY(8px); opacity: .6 } to { transform: none; opacity: 1 } }
      .vg-lb-aviso-head {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 14px 18px; border-bottom: 1px solid var(--border, #DEE3E1);
      }
      .vg-lb-aviso-head-l { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .vg-lb-aviso-head h3 {
        margin: 0; font-family: var(--font-display, Inter Tight), sans-serif;
        font-weight: 500; font-size: 16px; color: var(--ink, #06283A);
      }
      .vg-lb-aviso-ico {
        width: 30px; height: 30px; border-radius: 9px; background: #FCEBDD;
        display: flex; align-items: center; justify-content: center; flex: none;
      }
      .vg-lb-aviso-ico svg { width: 17px; height: 17px; }
      .vg-lb-aviso-ico .vg-lb-tri { stroke: #D35400; fill: none; }
      .vg-lb-aviso-ico .vg-lb-stem { stroke: #D35400; }
      .vg-lb-aviso-ico .vg-lb-dot { fill: #D35400; }
      .vg-lb-aviso-x {
        border: none; background: transparent; font-size: 15px; cursor: pointer;
        color: var(--ink-faint, #7a8079); padding: 4px 8px; border-radius: 6px; flex: none;
      }
      .vg-lb-aviso-x:hover { background: var(--bg-sunken, #F1F4F2); }
      .vg-lb-aviso-body { padding: 16px 18px 4px; }
      .vg-lb-aviso-tit {
        margin: 0; font: 600 14px/1.4 var(--font-display, Inter Tight), sans-serif;
        color: var(--ink, #06283A);
      }
      .vg-lb-aviso-sub {
        margin: 5px 0 0; font-size: 12.5px; line-height: 1.45; color: var(--ink-soft, #5a625a);
      }
      .vg-lb-aviso-cont {
        display: flex; align-items: baseline; gap: 7px; margin: 14px 0 8px;
        padding-top: 12px; border-top: 1px solid var(--border, #DEE3E1);
      }
      .vg-lb-aviso-num {
        font: 700 22px/1 var(--font-display, Inter Tight), sans-serif; color: #D35400;
      }
      .vg-lb-aviso-num-lbl {
        font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
        color: var(--ink-faint, #9aa09c);
      }
      .vg-lb-aviso-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
      .vg-lb-aviso-item {
        display: flex; align-items: center; gap: 9px; padding: 7px 0;
        border-bottom: 1px solid rgba(0,0,0,0.045);
      }
      .vg-lb-aviso-item:last-child { border-bottom: none; }
      .vg-lb-aviso-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
      .vg-lb-aviso-item-tit {
        flex: 1; min-width: 0; font-size: 13px; color: var(--ink, #06283A);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .vg-lb-aviso-tag {
        flex: none; font-size: 10px; font-weight: 700; letter-spacing: .03em;
        padding: 3px 7px; border-radius: 999px;
      }
      .vg-lb-aviso-mais {
        margin-top: 8px; font-size: 11.5px; color: var(--ink-faint, #9aa09c); font-style: italic;
      }
      .vg-lb-aviso-acoes {
        display: flex; gap: 8px; justify-content: flex-end;
        padding: 14px 18px; margin-top: 12px;
        border-top: 1px solid var(--border, #DEE3E1); background: var(--bg-sunken, #F7F9F8);
      }
      .vg-lb-aviso-acoes button {
        border-radius: 9px; padding: 9px 16px; cursor: pointer;
        font: 600 13px/1 var(--font-display, Inter Tight), sans-serif;
        border: 1px solid transparent; transition: background-color .12s ease, filter .12s ease;
      }
      .vg-lb-aviso-ver {
        background: var(--bg-elevated, #fff); color: var(--ink-soft, #5a625a);
        border-color: var(--border, #DEE3E1);
      }
      .vg-lb-aviso-ver:hover { background: rgba(0,0,0,0.04); color: var(--ink, #06283A); }
      .vg-lb-aviso-seguir { background: var(--primary, #06283A); color: #fff; }
      .vg-lb-aviso-seguir:hover { filter: brightness(1.14); }
    `;
    document.head.appendChild(st);
  }

  // ── V550: aviso de pendências antes de extrair relatórios ─────────────
  // Retorna Promise<boolean>: true = seguir com a extração, false = cancelar.
  // Sem lembretes pendentes, resolve true na hora (não atrapalha o fluxo).
  // V814: `extracaoFinal` = aviso da EXTRAÇÃO FINAL do relatório — soma as
  // PENDÊNCIAS DE CADASTRO (clicáveis: levam ao módulo mostrando o que falta)
  // e a advertência de risco. Demais extrações seguem só com os lembretes.
  function avisarPendentes(extracaoFinal) {
    const nLemb = contar();
    const cad = (extracaoFinal && window.CadastroPendencias)
      ? window.CadastroPendencias.listar() : { medicos: [], procedimentos: [] };
    const nCad = cad.medicos.length + cad.procedimentos.length;
    const n = nLemb + nCad;
    if (!n) return Promise.resolve(true);
    injetarEstilos();
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'vg-lb-aviso-ov';
      // V551: prévia dos pendentes (até 4) no visual do app
      const pend = listar().filter(l => Number(l.concluido) !== 1).slice(0, 4);
      const itensHtml = pend.map(l => {
        const c = catInfo(l.categoria);
        return `<li class="vg-lb-aviso-item">
          <span class="vg-lb-aviso-dot" style="background:${c.cor}"></span>
          <span class="vg-lb-aviso-item-tit">${esc(l.titulo)}</span>
          <span class="vg-lb-aviso-tag" style="background:${c.bg};color:${c.cor}">${esc(c.id)}</span>
        </li>`;
      }).join('');
      const restante = nLemb - pend.length;
      // V814: pendências de cadastro — clique leva ao módulo certo
      const cadHtml = [
        cad.medicos.length ? `<li class="vg-lb-aviso-item vg-lb-aviso-cad" data-cad="medicos" style="cursor:pointer">
            <span class="vg-lb-aviso-dot" style="background:#B8860B"></span>
            <span class="vg-lb-aviso-item-tit">${cad.medicos.length} médico${cad.medicos.length === 1 ? '' : 's'} sem cadastro — ${esc(cad.medicos.slice(0, 3).join(', '))}${cad.medicos.length > 3 ? '…' : ''}</span>
            <span class="vg-lb-aviso-tag" style="background:#FFF3D6;color:#B8860B">Cadastro</span>
          </li>` : '',
        cad.procedimentos.length ? `<li class="vg-lb-aviso-item vg-lb-aviso-cad" data-cad="base-tabela" style="cursor:pointer">
            <span class="vg-lb-aviso-dot" style="background:#B8860B"></span>
            <span class="vg-lb-aviso-item-tit">${cad.procedimentos.length} procedimento${cad.procedimentos.length === 1 ? '' : 's'} sem regra na Base Tabela — ${esc(cad.procedimentos.slice(0, 3).join(', '))}${cad.procedimentos.length > 3 ? '…' : ''}</span>
            <span class="vg-lb-aviso-tag" style="background:#FFF3D6;color:#B8860B">Cadastro</span>
          </li>` : '',
      ].join('');
      ov.innerHTML = `
        <div class="vg-lb-aviso" role="alertdialog" aria-modal="true">
          <div class="vg-lb-aviso-head">
            <div class="vg-lb-aviso-head-l">
              <span class="vg-lb-aviso-ico">${iconeSVG()}</span>
              <h3>Lembretes / alertas pendentes</h3>
            </div>
            <button type="button" class="vg-lb-aviso-x" title="Fechar">✕</button>
          </div>
          <div class="vg-lb-aviso-body">
            <p class="vg-lb-aviso-tit">Existem ações não realizadas no lembretes/alertas</p>
            <p class="vg-lb-aviso-sub">Recomendo verificar antes de extrair o relatório.</p>
            <div class="vg-lb-aviso-cont">
              <span class="vg-lb-aviso-num">${n}</span>
              <span class="vg-lb-aviso-num-lbl">${n === 1 ? 'item pendente' : 'itens pendentes'}</span>
            </div>
            <ul class="vg-lb-aviso-lista">${itensHtml}${cadHtml}</ul>
            ${restante > 0 ? `<div class="vg-lb-aviso-mais">+ ${restante} ${restante === 1 ? 'outro item' : 'outros itens'}</div>` : ''}
            ${extracaoFinal ? `<p class="vg-lb-aviso-risco" style="margin:10px 2px 0;padding:9px 12px;border-radius:8px;
                background:#FDECEC;color:#9B3A3A;font-weight:600;font-size:12.5px;line-height:1.45">
              A não verificação das pendências pode ocasionar o não pagamento para algum médico
              e futuros complementos desnecessários.</p>` : ''}
          </div>
          <div class="vg-lb-aviso-acoes">
            <button type="button" class="vg-lb-aviso-ver">Ver lembretes</button>
            <button type="button" class="vg-lb-aviso-seguir">Extrair mesmo assim</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      const fim = (ok, abrirBoard) => {
        document.removeEventListener('keydown', onKey);
        ov.remove();
        if (abrirBoard) { try { abrir(); } catch (_) {} }
        resolve(ok);
      };
      function onKey(e) { if (e.key === 'Escape') fim(false, false); }
      document.addEventListener('keydown', onKey);
      ov.querySelector('.vg-lb-aviso-ver').addEventListener('click', () => fim(false, true));
      ov.querySelector('.vg-lb-aviso-seguir').addEventListener('click', () => fim(true, false));
      // V814: clique numa pendência de cadastro → módulo certo, filtrado
      ov.querySelectorAll('.vg-lb-aviso-cad').forEach(li => li.addEventListener('click', () => {
        fim(false, false);
        try { window.CadastroPendencias.abrirModulo(li.dataset.cad === 'medicos' ? 'medicos' : 'base-tabela'); } catch (_) {}
      }));
      ov.querySelector('.vg-lb-aviso-x').addEventListener('click', () => fim(false, false));
      ov.addEventListener('click', (e) => { if (e.target === ov) fim(false, false); });
      const b = ov.querySelector('.vg-lb-aviso-seguir'); if (b) b.focus();
    });
  }

  // ── exporta ───────────────────────────────────────────────────────────
  window.AtlasLembretes = { montar, atualizarIcone, abrir, fechar, contar, iconeSVG, CATEGORIAS, avisarPendentes };
})();
