/**
 * ============================================================================
 * TELA: Clientes (👥)
 * Cadastro dos clientes da ATLAS (médico, clínica ou grupo) e dos hospitais
 * de cada um. Multi-cliente é o desenho do produto: cada cliente enxerga só
 * os próprios dados, e o "cliente ativo" (barra lateral) é o contexto de
 * todas as demais telas.
 * ============================================================================
 */
App.telas['clientes'] = function () {
  'use strict';
  const el = document.getElementById('conteudo');
  const esc = Utilidades.esc;

  function render() {
    const clientes = Banco.query('SELECT * FROM clientes WHERE ativo = 1 ORDER BY nome');
    const ativo = App.clienteAtivo();

    el.innerHTML = `
      <div class="tela-cabecalho">
        <h1 class="tela-titulo">Clientes</h1>
        <span class="tela-sub">quem contrata a auditoria — e os hospitais de cada um</span>
      </div>

      <div class="painel">
        <div class="painel-cabecalho"><span class="painel-titulo">Novo cliente</span></div>
        <div class="painel-corpo">
          <div class="linha-campos">
            <div class="campo"><span class="campo-rotulo">Nome *</span>
              <input id="cli-nome" placeholder="Dr. Fulano de Tal / Clínica X"></div>
            <div class="campo" style="max-width:150px"><span class="campo-rotulo">Tipo</span>
              <select id="cli-tipo">
                <option value="MEDICO">Médico</option>
                <option value="CLINICA">Clínica</option>
                <option value="GRUPO">Grupo</option>
              </select></div>
            <div class="campo"><span class="campo-rotulo">CRM / CNPJ</span>
              <input id="cli-doc" placeholder="opcional"></div>
            <div class="campo"><span class="campo-rotulo">Contato</span>
              <input id="cli-contato" placeholder="e-mail ou telefone (opcional)"></div>
            <button class="botao botao-primario" id="cli-add">＋ Cadastrar</button>
          </div>
        </div>
      </div>

      ${clientes.length ? clientes.map(c => cartaoCliente(c, ativo)).join('') :
        `<div class="painel"><div class="tabela-vazia">Nenhum cliente cadastrado ainda.</div></div>`}
    `;

    el.querySelector('#cli-add').addEventListener('click', () => {
      const nome = el.querySelector('#cli-nome').value.trim();
      if (!nome) { Utilidades.toast('Informe o nome do cliente.', 'aviso'); return; }
      Banco.executar(
        'INSERT INTO clientes (nome, tipo, documento, contato) VALUES (?,?,?,?)',
        [nome, el.querySelector('#cli-tipo').value,
          el.querySelector('#cli-doc').value.trim(), el.querySelector('#cli-contato').value.trim()]);
      const novoId = Banco.ultimoId();
      if (!App.clienteAtivo()) Banco.configGravar('cliente_ativo', novoId);
      Banco.salvarDebounced();
      Utilidades.toast('Cliente cadastrado.', 'ok');
      App.renderShell();
      App.navegar('clientes');
    });

    // ── handlers dos cartões ──
    el.querySelectorAll('[data-acao]').forEach(btn => {
      btn.addEventListener('click', () => {
        const acao = btn.dataset.acao;
        const id = Number(btn.dataset.id);

        if (acao === 'ativar') {
          App.setClienteAtivo(id);
          App.navegar('clientes');

        } else if (acao === 'remover') {
          const temDados = (Banco.escalar('SELECT COUNT(*) FROM linhas_producao WHERE cliente_id=?', [id]) || 0) +
            (Banco.escalar('SELECT COUNT(*) FROM linhas_repasse WHERE cliente_id=?', [id]) || 0);
          const msg = temDados
            ? `Este cliente tem ${temDados.toLocaleString('pt-BR')} linhas importadas. Ele será apenas ARQUIVADO (os dados ficam no banco). Continuar?`
            : 'Arquivar este cliente?';
          if (!confirm(msg)) return;
          Banco.executar('UPDATE clientes SET ativo = 0 WHERE id = ?', [id]);
          if (Number(Banco.configLer('cliente_ativo', 0)) === id) Banco.configGravar('cliente_ativo', 0);
          Banco.salvarDebounced();
          App.renderShell();
          App.navegar('clientes');

        } else if (acao === 'add-hosp') {
          const inp = el.querySelector(`#hosp-nome-${id}`);
          const nome = inp.value.trim();
          if (!nome) { Utilidades.toast('Informe o nome do hospital/clínica.', 'aviso'); return; }
          Banco.executar('INSERT INTO hospitais (cliente_id, nome) VALUES (?,?)', [id, nome]);
          Banco.salvarDebounced();
          Utilidades.toast('Hospital cadastrado.', 'ok');
          render();

        } else if (acao === 'rem-hosp') {
          const nLinhas = (Banco.escalar('SELECT COUNT(*) FROM linhas_producao WHERE hospital_id=?', [id]) || 0) +
            (Banco.escalar('SELECT COUNT(*) FROM linhas_repasse WHERE hospital_id=?', [id]) || 0);
          if (nLinhas) { Utilidades.toast('Este hospital tem dados importados — exclua as importações antes.', 'aviso'); return; }
          if (!confirm('Remover este hospital?')) return;
          Banco.executar('DELETE FROM base_tabela WHERE hospital_id = ?', [id]);
          Banco.executar('DELETE FROM perfis_importacao WHERE hospital_id = ?', [id]);
          Banco.executar('DELETE FROM hospitais WHERE id = ?', [id]);
          Banco.salvarDebounced();
          render();
        }
      });
    });
  }

  function cartaoCliente(c, ativo) {
    const hospitais = App.listarHospitais(c.id);
    const ehAtivo = ativo && ativo.id === c.id;
    const nProd = Banco.escalar('SELECT COUNT(*) FROM linhas_producao WHERE cliente_id=?', [c.id]) || 0;
    const nRep = Banco.escalar('SELECT COUNT(*) FROM linhas_repasse WHERE cliente_id=?', [c.id]) || 0;

    return `
      <div class="painel">
        <div class="painel-cabecalho">
          <span class="painel-titulo">${esc(c.nome)}</span>
          <span class="painel-conta">${esc(c.tipo || '')}${c.documento ? ' · ' + esc(c.documento) : ''}${c.contato ? ' · ' + esc(c.contato) : ''}</span>
          <span class="painel-conta">· produção: ${nProd.toLocaleString('pt-BR')} linhas · repasse: ${nRep.toLocaleString('pt-BR')}</span>
          <div class="painel-acoes">
            ${ehAtivo ? '<span class="badge badge-OK">CLIENTE ATIVO</span>' :
              `<button class="botao botao-mini botao-marinho" data-acao="ativar" data-id="${c.id}">Tornar ativo</button>`}
            <button class="botao botao-mini botao-perigo" data-acao="remover" data-id="${c.id}">Arquivar</button>
          </div>
        </div>
        <div class="painel-corpo">
          <div class="raiox-rotulo">Hospitais / clínicas que emitem os relatórios</div>
          ${hospitais.length ? `<div class="rolagem-x"><table class="tabela"><tbody>
            ${hospitais.map(h => `<tr>
              <td>${esc(h.nome)}</td>
              <td class="texto-cinza">${Banco.escalar('SELECT COUNT(*) FROM base_tabela WHERE hospital_id=?', [h.id]) || 0} regras na Base Tabela</td>
              <td style="text-align:right">
                <button class="botao botao-mini botao-perigo" data-acao="rem-hosp" data-id="${h.id}">remover</button>
              </td></tr>`).join('')}
          </tbody></table></div>` :
          `<div class="texto-cinza" style="margin-bottom:8px">Nenhum hospital ainda — cadastre para poder importar os relatórios.</div>`}
          <div class="linha-campos" style="margin-top:10px">
            <div class="campo"><span class="campo-rotulo">Novo hospital/clínica</span>
              <input id="hosp-nome-${c.id}" placeholder="ex.: Hospital Santa Luzia"></div>
            <button class="botao" data-acao="add-hosp" data-id="${c.id}">＋ Adicionar</button>
          </div>
        </div>
      </div>`;
  }

  render();
};
