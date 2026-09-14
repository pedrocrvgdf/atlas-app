/**
 * ============================================================================
 * ATLAS — SHELL DA APLICAÇÃO
 *
 * Monta a barra lateral (marca ATLAS, seletor de CLIENTE ATIVO, menu),
 * inicializa o banco e roteia as telas. Uma tela = um arquivo em js/telas/,
 * registrado em App.telas['id'] — convenção da casa.
 *
 * O CLIENTE ATIVO é o contexto de tudo: todas as telas de dados leem
 * App.clienteAtivo() e mostram só o que é daquele cliente.
 * ============================================================================
 */
(function () {
  'use strict';

  const App = window.App = window.App || {};
  App.telas = App.telas || {};

  // A INSPEÇÃO é a base da ferramenta (abre nela); análise fica à mão na
  // barra flutuante e os módulos de CADASTRO moram no menu suspenso.
  const PRINCIPAIS = [
    { id: 'inspecao',   nome: 'Inspeção',   icone: '🔎' },
    { id: 'auditoria',  nome: 'Auditoria',  icone: '📋' },
    { id: 'relatorios', nome: 'Relatórios', icone: '📄' },
  ];
  const CADASTROS = [
    { id: 'visao',    nome: 'Visão Geral',  icone: '🧭' },
    { id: 'clientes', nome: 'Clientes',     icone: '👥' },
    { id: 'importar', nome: 'Importações',  icone: '📥' },
    { id: 'base',     nome: 'Base Tabela',  icone: '📚' },
    { id: 'medicos',  nome: 'Médicos',      icone: '🩺' },
    { id: 'sistema',  nome: 'Sistema',      icone: '⚙️' },
  ];

  let _telaAtual = null;

  // ──────────────────────────────────────────────────────────────────────
  // CLIENTE ATIVO
  // ──────────────────────────────────────────────────────────────────────

  App.clienteAtivo = function () {
    const id = Number(Banco.configLer('cliente_ativo', 0)) || 0;
    if (!id) return null;
    const r = Banco.query('SELECT * FROM clientes WHERE id = ? AND ativo = 1', [id]);
    return r.length ? r[0] : null;
  };

  App.setClienteAtivo = function (id) {
    Banco.configGravar('cliente_ativo', Number(id) || 0);
    Banco.salvarDebounced();
    App.renderShell();
    App.navegar(_telaAtual || 'visao');
  };

  App.listarClientes = function () {
    return Banco.query('SELECT * FROM clientes WHERE ativo = 1 ORDER BY nome');
  };

  App.listarHospitais = function (clienteId) {
    return Banco.query('SELECT * FROM hospitais WHERE cliente_id = ? ORDER BY nome', [clienteId]);
  };

  // ──────────────────────────────────────────────────────────────────────
  // SHELL
  // ──────────────────────────────────────────────────────────────────────

  App.renderShell = function () {
    const esc = Utilidades.esc;
    const clientes = App.listarClientes();
    const ativo = App.clienteAtivo();
    const v = window.ATLAS_VERSAO || { pacote: '?' };

    const opcoes = clientes.map(c =>
      `<option value="${c.id}" ${ativo && ativo.id === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`
    ).join('');

    document.getElementById('app').innerHTML = `
      <div class="marca-dagua" aria-hidden="true"></div>

      <div class="topo-wrap">
        <header class="topo">
          <div class="topo-marca" data-tela="inspecao" role="button">
            <span class="marca-nome">ATLAS</span>
            <span class="topo-sub">AUDITORIA DE CONTAS</span>
          </div>

          <nav class="topo-nav">
            ${PRINCIPAIS.map(m => `
              <button class="topo-link" data-tela="${m.id}">${m.icone} ${m.nome}</button>`).join('')}
            <div class="topo-drop">
              <button class="topo-link" id="drop-cadastros">🗃 Cadastros <span class="drop-seta">▾</span></button>
              <div class="topo-menu" id="menu-cadastros" hidden>
                ${CADASTROS.map(m => `
                  <button class="topo-menu-item" data-tela="${m.id}">
                    <span>${m.icone}</span> ${m.nome}</button>`).join('')}
                <div class="topo-versao">ATLAS COMPANY · ${esc(v.pacote)} · ${esc(v.gerado || '')}</div>
              </div>
            </div>
          </nav>

          <div class="topo-cliente">
            <span class="topo-cliente-rotulo">Cliente</span>
            ${clientes.length ? `
              <select id="sel-cliente" class="topo-cliente-select">
                <option value="0" ${!ativo ? 'selected' : ''}>— selecione —</option>
                ${opcoes}
              </select>` :
              `<button class="botao botao-mini botao-ouro" data-tela="clientes">＋ cadastrar</button>`}
          </div>
        </header>
      </div>

      <main class="main"><div id="conteudo"></div></main>
    `;

    const sel = document.getElementById('sel-cliente');
    if (sel) sel.addEventListener('change', () => App.setClienteAtivo(sel.value));

    // navegação (barra + menu suspenso)
    document.querySelectorAll('[data-tela]').forEach(btn => {
      btn.addEventListener('click', () => { fecharMenu(); App.navegar(btn.dataset.tela); });
    });
    const drop = document.getElementById('drop-cadastros');
    const menu = document.getElementById('menu-cadastros');
    function fecharMenu() { if (menu) menu.hidden = true; }
    if (drop) {
      drop.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
      document.addEventListener('click', (e) => {
        if (menu && !menu.hidden && !menu.contains(e.target)) fecharMenu();
      });
    }
  };

  App.navegar = function (id) {
    if (!App.telas[id]) id = 'visao';
    _telaAtual = id;
    document.querySelectorAll('.topo-link[data-tela], .topo-menu-item').forEach(b =>
      b.classList.toggle('ativo', b.dataset.tela === id));
    const drop = document.getElementById('drop-cadastros');
    if (drop) drop.classList.toggle('ativo',
      ['visao', 'clientes', 'importar', 'base', 'medicos', 'sistema'].includes(id));
    const alvo = document.getElementById('conteudo');
    alvo.innerHTML = '';
    try {
      App.telas[id]();
    } catch (e) {
      console.error('[app] tela falhou:', id, e);
      alvo.innerHTML = `<div class="erro-tela">A tela <strong>${Utilidades.esc(id)}</strong> falhou:
        <pre>${Utilidades.esc(e && e.stack || e)}</pre></div>`;
    }
    alvo.scrollTop = 0;
  };

  App.telaAtual = function () { return _telaAtual; };

  /**
   * Bloco padrão "selecione um cliente" — telas de dados chamam isto quando
   * App.clienteAtivo() é null e desenham o aviso em vez do conteúdo.
   */
  App.avisoSemCliente = function (el) {
    el.innerHTML = `
      <div class="sem-cliente">
        <img src="assets/atlas-marca.png" alt="ATLAS" class="sem-cliente-marca">
        <h2>Selecione um cliente</h2>
        <p>Escolha o <strong>cliente ativo</strong> na barra lateral — ou cadastre o
        primeiro em <strong>Clientes</strong>. Toda a ferramenta trabalha no contexto
        de um cliente por vez.</p>
        <button class="botao botao-ouro" id="ir-clientes">Ir para Clientes</button>
      </div>`;
    const b = el.querySelector('#ir-clientes');
    if (b) b.addEventListener('click', () => App.navegar('clientes'));
  };

  // ──────────────────────────────────────────────────────────────────────
  // BOOT
  // ──────────────────────────────────────────────────────────────────────

  async function boot() {
    try {
      await Banco.inicializar();
      App.renderShell();
      App.navegar('inspecao');   // a Inspeção é a base da ferramenta
    } catch (e) {
      console.error('[app] boot falhou:', e);
      document.getElementById('app').innerHTML = `
        <div class="erro-boot">
          <h2>A ferramenta não conseguiu iniciar</h2>
          <p>${Utilidades.esc(e && e.message || e)}</p>
          <p>Abra o console (F12) e envie o erro para a ATLAS.</p>
        </div>`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
