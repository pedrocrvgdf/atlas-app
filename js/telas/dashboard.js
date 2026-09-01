/**
 * ============================================================================
 * TELA: Visão Geral (🧭)
 * Painel de entrada: números do cliente ativo, o passo a passo do fluxo de
 * auditoria e as últimas importações.
 * ============================================================================
 */
App.telas['visao'] = function () {
  'use strict';
  const el = document.getElementById('conteudo');
  const esc = Utilidades.esc;
  const cliente = App.clienteAtivo();

  const totCli = Banco.escalar('SELECT COUNT(*) FROM clientes WHERE ativo = 1') || 0;

  if (!cliente) {
    if (!totCli) {
      el.innerHTML = `
        <div class="sem-cliente">
          <img src="assets/atlas-marca.png" alt="ATLAS" class="sem-cliente-marca">
          <h2>Bem-vindo à ATLAS</h2>
          <p>Auditoria de contas médicas: cruzamos a <strong>produção</strong> com o
          <strong>repasse</strong> e mostramos, admissão por admissão, o que ainda
          falta o médico receber.</p>
          <p class="texto-cinza">Comece cadastrando o primeiro cliente.</p>
          <button class="botao botao-ouro" id="ir-clientes">Cadastrar cliente</button>
        </div>`;
      el.querySelector('#ir-clientes').addEventListener('click', () => App.navegar('clientes'));
      return;
    }
    App.avisoSemCliente(el);
    return;
  }

  const cid = cliente.id;
  const hosp = Banco.escalar('SELECT COUNT(*) FROM hospitais WHERE cliente_id=?', [cid]) || 0;
  const nProd = Banco.escalar('SELECT COUNT(*) FROM linhas_producao WHERE cliente_id=?', [cid]) || 0;
  const nRep = Banco.escalar('SELECT COUNT(*) FROM linhas_repasse WHERE cliente_id=?', [cid]) || 0;
  const nBase = Banco.escalar(
    `SELECT COUNT(*) FROM base_tabela b JOIN hospitais h ON h.id = b.hospital_id
     WHERE h.cliente_id=?`, [cid]) || 0;
  const nPauta = Banco.escalar(
    `SELECT COUNT(*) FROM pauta_inspecao WHERE cliente_id=? AND situacao IN ('PENDENTE','COBRADO')`, [cid]) || 0;

  // resumo da auditoria (todas as competências) — só quando já há dados dos 2 lados
  let kpisHTML = '';
  if (nProd && nRep) {
    const r = Motor.auditar({ clienteId: cid, hospitalId: 0, competencia: '' });
    kpisHTML = `
      <div class="cards">
        <div class="card"><div class="card-rotulo">Produzido</div>
          <div class="card-valor mono">${Utilidades.moeda(r.kpis.produzido)}</div></div>
        <div class="card"><div class="card-rotulo">Esperado (regras)</div>
          <div class="card-valor mono">${Utilidades.moeda(r.kpis.esperado)}</div></div>
        <div class="card"><div class="card-rotulo">Pago ao médico</div>
          <div class="card-valor mono">${Utilidades.moeda(r.kpis.pago)}</div></div>
        <div class="card card-destaque"><div class="card-rotulo">Falta receber</div>
          <div class="card-valor mono">${Utilidades.moeda(r.kpis.falta)}</div>
          <div class="card-extra">${r.kpis.nPendencias} de ${r.kpis.nAdmissoes} admissões com pendência</div></div>
      </div>`;
  }

  const passos = [
    { n: 1, titulo: 'Cadastrar cliente e hospitais', desc: 'Quem contratou a auditoria e as instituições que emitem os relatórios.', tela: 'clientes', feito: hosp > 0 },
    { n: 2, titulo: 'Importar produção e repasse', desc: 'As planilhas do hospital — a ATLAS aprende o formato de cada um.', tela: 'importar', feito: nProd > 0 && nRep > 0 },
    { n: 3, titulo: 'Base Tabela (opcional)', desc: 'Regras contratuais quando existem; sem elas, o motor infere o padrão pago.', tela: 'base', feito: nBase > 0 },
    { n: 4, titulo: 'Inspecionar admissões', desc: 'O cruzamento: o que era esperado × o que foi pago, admissão por admissão.', tela: 'inspecao', feito: nPauta > 0 },
    { n: 5, titulo: 'Relatório para o cliente', desc: 'Consolidado por médico com o valor a cobrar, exportável em Excel.', tela: 'relatorios', feito: false },
  ];

  const imps = Banco.query(
    `SELECT i.*, h.nome AS hospital FROM importacoes i
     JOIN hospitais h ON h.id = i.hospital_id
     WHERE i.cliente_id = ? ORDER BY i.id DESC LIMIT 6`, [cid]);

  el.innerHTML = `
    <div class="tela-cabecalho">
      <h1 class="tela-titulo">Visão Geral</h1>
      <span class="tela-sub">cliente: <strong>${esc(cliente.nome)}</strong></span>
    </div>

    ${kpisHTML}

    <div class="cards">
      <div class="card"><div class="card-rotulo">Hospitais</div><div class="card-valor">${hosp}</div></div>
      <div class="card"><div class="card-rotulo">Linhas de produção</div><div class="card-valor">${nProd.toLocaleString('pt-BR')}</div></div>
      <div class="card"><div class="card-rotulo">Linhas de repasse</div><div class="card-valor">${nRep.toLocaleString('pt-BR')}</div></div>
      <div class="card"><div class="card-rotulo">Regras na Base</div><div class="card-valor">${nBase.toLocaleString('pt-BR')}</div></div>
      <div class="card"><div class="card-rotulo">Pauta em aberto</div><div class="card-valor">${nPauta}</div></div>
    </div>

    <div class="painel"><div class="painel-cabecalho">
      <span class="painel-titulo">O fluxo da auditoria</span></div>
      <div class="painel-corpo"><div class="passos">
        ${passos.map(p => `
          <div class="passo ${p.feito ? 'passo-feito' : ''}" data-tela="${p.tela}">
            <div class="passo-num">${p.feito ? '✓' : p.n}</div>
            <div class="passo-titulo">${p.titulo}</div>
            <div class="passo-desc">${p.desc}</div>
          </div>`).join('')}
      </div></div>
    </div>

    <div class="painel">
      <div class="painel-cabecalho"><span class="painel-titulo">Últimas importações</span></div>
      ${imps.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
          <th>Quando</th><th>Hospital</th><th>Tipo</th><th>Arquivo</th><th class="num">Linhas</th>
        </tr></thead><tbody>
        ${imps.map(i => `<tr>
          <td>${esc((i.importada_em || '').slice(0, 16).replace('T', ' '))}</td>
          <td>${esc(i.hospital)}</td><td>${esc(i.tipo)}</td>
          <td>${esc(i.arquivo || '—')}</td>
          <td class="num">${(i.n_linhas || 0).toLocaleString('pt-BR')}</td></tr>`).join('')}
        </tbody></table></div>` :
      `<div class="tabela-vazia">Nenhuma importação ainda — comece em <strong>Importações</strong>.</div>`}
    </div>`;

  el.querySelectorAll('.passo').forEach(p =>
    p.addEventListener('click', () => App.navegar(p.dataset.tela)));
};
