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
  let _memoMed = { chave: null, lista: [] };
  let _memoTodos = { chave: null, lista: [] };

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
    App.garantirUnificacao();
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
  // O CLIENTE (O MÉDICO AUDITADO)
  //
  // O HOSPITAL é o centro de custo / CNPJ: é dele o cofre, e os relatórios de
  // PRODUÇÃO e SISTEMA que ele emite trazem a instituição inteira — no CBV,
  // 655 profissionais. O CLIENTE é o MÉDICO: quem contratou a ATLAS e por
  // quem a auditoria responde. Ele é escolhido aqui, sai dos relatórios já
  // unificado pelo de-para, e vira o recorte de todas as telas.
  //
  // O seletor lista só os médicos MARCADOS como clientes (medicos.eh_cliente);
  // escolher alguém na busca marca. Vazio = o hospital inteiro.
  // ──────────────────────────────────────────────────────────────────────

  /** Os médicos-clientes deste hospital (lista curta, a do seletor). */
  App.listarMedicos = function () {
    const c = App.clienteAtivo();
    if (!c) return [];
    const chave = 'cli|' + c.id + '|' + Banco._versao;
    if (_memoMed.chave === chave) return _memoMed.lista;
    _memoMed = { chave, lista: Motor.clientesMedicos(c.id) };
    return _memoMed.lista;
  };

  /** TODOS os profissionais que aparecem nos relatórios (a busca do seletor). */
  App.listarMedicosTodos = function () {
    const c = App.clienteAtivo();
    if (!c) return [];
    const chave = 'todos|' + c.id + '|' + Banco._versao;
    if (_memoTodos.chave === chave) return _memoTodos.lista;
    _memoTodos = { chave, lista: Motor.medicosDoCliente(c.id) };
    return _memoTodos.lista;
  };

  /** Chave normalizada do cliente auditado ('' = o hospital inteiro). */
  App.medicoAtivo = function () {
    const c = App.clienteAtivo();
    if (!c) return '';
    const k = String(Banco.configLer('medico_ativo_c' + c.id, '') || '');
    if (!k) return '';
    return App.listarMedicos().some(m => m.chave === k) ? k : '';
  };

  /** Nome oficial do cliente auditado ('' = todos). */
  App.medicoAtivoNome = function () {
    const k = App.medicoAtivo();
    if (!k) return '';
    const m = App.listarMedicos().find(x => x.chave === k);
    return m ? m.nome : '';
  };

  App.setMedicoAtivo = function (chave, nome) {
    const c = App.clienteAtivo();
    if (!c) return;
    // escolher um médico é dizer que a ATLAS responde por ele: vira cliente.
    // Quem manda é o nome OFICIAL do de-para — é sob ele que o motor soma.
    if (chave && nome) {
      const of = Motor.marcarClienteMedico(c.id, nome, true);
      if (of) chave = of.chave;
    }
    Banco.configGravar('medico_ativo_c' + c.id, String(chave || ''));
    Banco.salvarDebounced();
    _memoMed = { chave: null, lista: [] };
    App.renderShell();
    App.navegar(_telaAtual || 'inspecao');
  };

  /**
   * Busca do médico-cliente: o hospital tem centenas de profissionais nos
   * relatórios, então a escolha é por busca, não por lista rolante.
   */
  App.popupEscolherMedico = function () {
    const c = App.clienteAtivo();
    if (!c) return;
    const esc = Utilidades.esc;
    const todos = App.listarMedicosTodos();
    const clientes = new Set(App.listarMedicos().map(m => m.chave));

    const ov = document.createElement('div');
    ov.className = 'modal-fundo';
    ov.innerHTML = `
      <div class="modal" style="width:620px;max-width:95vw">
        <div class="modal-cabecalho">
          <span class="modal-titulo">🩺 Escolher o médico (cliente)</span>
          <button class="modal-fechar">✕</button>
        </div>
        <div class="modal-corpo">
          <div class="aviso-caixa">Os relatórios são do hospital inteiro —
            <strong>${todos.length}</strong> profissionais apareceram neles. Escolha
            quem a ATLAS audita: ele passa a ser o <strong>cliente</strong> e fica no
            seletor do topo.</div>
          <input class="entrada" id="bm-busca" placeholder="Buscar pelo nome…" autocomplete="off"
                 style="margin-top:12px;width:100%">
          <div id="bm-lista" class="rolagem-y" style="max-height:44vh;margin-top:10px"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const fechar = () => ov.remove();
    ov.querySelector('.modal-fechar').addEventListener('click', fechar);
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });

    const campo = ov.querySelector('#bm-busca');
    const lista = ov.querySelector('#bm-lista');
    function pintar() {
      const q = Utilidades.normalizar(campo.value);
      const vis = (q ? todos.filter(m => m.chave.includes(q)) : todos).slice(0, 60);
      lista.innerHTML = vis.length ? `<table class="tabela"><tbody>${vis.map(m => `
        <tr><td><strong>${esc(m.nome)}</strong>${clientes.has(m.chave)
              ? ' <span class="imp-chip imp-chip-TODAS">cliente</span>' : ''}
            <br><span class="texto-cinza" style="font-size:11px">produção ${m.producao} ·
              sistema ${m.sistema} · médico ${m.medico}${m.grafias.length > 1
              ? ' · ' + m.grafias.length + ' grafias' : ''}</span></td>
          <td class="num"><button class="botao botao-mini botao-primario" data-esc="${esc(m.chave)}"
            data-nome="${esc(m.nome)}">escolher</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="texto-cinza" style="padding:10px">Nenhum médico com esse nome nos relatórios.</div>';
      lista.querySelectorAll('[data-esc]').forEach(btn => btn.addEventListener('click', () => {
        fechar();
        App.setMedicoAtivo(btn.dataset.esc, btn.dataset.nome);
      }));
    }
    campo.addEventListener('input', pintar);
    pintar();
    campo.focus();
  };

  /**
   * Garante que o de-para de médicos já rodou neste cofre. Os cofres criados
   * antes da unificação automática guardam as grafias soltas ("DURVAL M C
   * JUNIOR" e "DURVAL MORAES DE CARVALHO JUNIOR" como duas pessoas) — aqui a
   * unificação roda uma vez por versão de dados, fora do caminho da
   * importação, e o resultado fica gravado.
   */
  App.garantirUnificacao = function () {
    const c = App.clienteAtivo();
    if (!c) return;
    const marca = String(Banco.configLer('unificado_c' + c.id, '') || '');
    const atual = String(Banco._versao);
    if (marca === atual) return;
    try {
      Motor.unificarMedicos(c.id);
      Banco.configGravar('unificado_c' + c.id, String(Banco._versao));
      Banco.salvarDebounced();
    } catch (e) {
      console.warn('[app] unificação automática falhou:', e);
    }
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
    const medicos = ativo ? App.listarMedicos() : [];
    const medAtivo = ativo ? App.medicoAtivo() : '';

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
            <span class="topo-cliente-rotulo">Hospital</span>
            ${clientes.length ? `
              <select id="sel-cliente" class="topo-cliente-select" title="O centro / CNPJ que emite os relatórios">
                <option value="0" ${!ativo ? 'selected' : ''}>— selecione —</option>
                ${opcoes}
              </select>` :
              `<button class="botao botao-mini botao-primario" data-tela="clientes">＋ cadastrar</button>`}
            ${ativo ? `
              <span class="topo-cliente-rotulo" style="margin-left:10px">Cliente</span>
              ${medicos.length ? `
                <select id="sel-medico" class="topo-cliente-select" title="O médico auditado — é por ele que a ATLAS responde">
                  <option value="">— todos os médicos do hospital —</option>
                  ${medicos.map(m => `<option value="${esc(m.chave)}" ${m.chave === medAtivo ? 'selected' : ''}>${esc(m.nome)}</option>`).join('')}
                </select>` : ''}
              <button class="botao botao-mini" id="btn-escolher-medico"
                title="Escolher o médico auditado entre os que apareceram nos relatórios">${medicos.length ? '🔎' : '🩺 escolher médico'}</button>` : ''}
          </div>
        </header>
      </div>

      <main class="main"><div id="conteudo"></div></main>
    `;

    const sel = document.getElementById('sel-cliente');
    if (sel) sel.addEventListener('change', () => App.setClienteAtivo(sel.value));
    const selMed = document.getElementById('sel-medico');
    if (selMed) selMed.addEventListener('change', () => App.setMedicoAtivo(selMed.value));
    const btnMed = document.getElementById('btn-escolher-medico');
    if (btnMed) btnMed.addEventListener('click', () => App.popupEscolherMedico());

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
      mensagem('Conferindo os nomes dos médicos…');
      App.garantirUnificacao();
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
