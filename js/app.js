/**
 * ============================================================================
 * ATLAS — SHELL DA APLICAÇÃO
 *
 * Monta a barra lateral (marca ATLAS, seletor de CLIENTE ATIVO, menu),
 * inicializa o banco e roteia as telas. Uma tela = um arquivo em js/telas/,
 * registrado em App.telas['id'] — convenção da casa.
 *
 * O CLIENTE ATIVO é o contexto de tudo: todas as telas de dados leem
 * App.clienteAtivo() e mostram só o que é daquele cliente. Cada cliente tem
 * o seu próprio cofre (banco SQLite) — trocar de cliente fecha um e abre o
 * outro (Banco.abrirCliente); a lista vem do catálogo, sem abrir cofre.
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

  /** O cliente cujo cofre está aberto ({ id, nome, tipo, documento, contato, … }) ou null. */
  App.clienteAtivo = function () {
    return Banco.clienteAberto();
  };

  /** Troca o cliente ativo: salva o cofre atual, abre o outro e repinta. */
  App.setClienteAtivo = async function (id) {
    id = Number(id) || 0;
    const atual = Banco.clienteAberto();
    if ((atual ? atual.id : 0) !== id) {
      Utilidades.loading.mostrar(id ? 'Abrindo o cofre do cliente…' : 'Fechando o cliente…');
      try {
        await Banco.abrirCliente(id, (m) => Utilidades.loading.mostrar(m));
      } catch (e) {
        console.error('[app] abrir cliente falhou:', e);
        Utilidades.toast('Não foi possível abrir o cliente: ' + (e && e.message || e), 'erro', 6000);
      } finally {
        Utilidades.loading.esconder();
      }
    }
    App.renderShell();
    App.navegar(_telaAtual || 'visao');
  };

  /** Clientes ativos do catálogo (sem abrir cofre nenhum). */
  App.listarClientes = function () {
    return Banco.clientes();
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
              `<button class="botao botao-mini botao-primario" data-tela="clientes">＋ cadastrar</button>`}
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
        <button class="botao botao-primario" id="ir-clientes">Ir para Clientes</button>
      </div>`;
    const b = el.querySelector('#ir-clientes');
    if (b) b.addEventListener('click', () => App.navegar('clientes'));
  };

  // ──────────────────────────────────────────────────────────────────────
  // BOOT
  // ──────────────────────────────────────────────────────────────────────

  async function boot() {
    const mensagem = (t) => { const m = document.querySelector('.loading-overlay .message'); if (m) m.textContent = t; };
    try {
      await Banco.inicializar({ progresso: mensagem });
      mensagem('Montando a tela…');
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
