/**
 * ============================================================================
 * TELA: Clientes (👥)
 * Cadastro dos clientes da ATLAS (médico, clínica ou grupo) e dos hospitais
 * de cada um. Multi-cliente é o desenho do produto: cada cliente tem o seu
 * próprio COFRE (banco) e enxerga só os próprios dados; o "cliente ativo"
 * (barra do topo) é o contexto de todas as demais telas.
 *
 * A lista vem do CATÁLOGO (nome, hospitais, contagens) — não abre cofre
 * nenhum. Só o cliente ativo é editável (hospitais); os outros mostram o
 * retrato do último salvamento e um "Tornar ativo".
 * ============================================================================
 */
App.telas['clientes'] = function () {
  'use strict';
  const el = document.getElementById('conteudo');
  const esc = Utilidades.esc;
  const n = (x) => (Number(x) || 0).toLocaleString('pt-BR');
  const tamanho = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : (b || 0) + ' B';
  const quando = (iso) => iso ? String(iso).slice(0, 16).replace('T', ' ') : '—';
  const TIPO = { MEDICO: 'Médico', CLINICA: 'Clínica', GRUPO: 'Grupo' };

  /** Ação assíncrona com overlay + tratamento de erro padrão. */
  async function agir(msg, fn) {
    Utilidades.loading.mostrar(msg);
    try { await fn(); }
    catch (e) { console.error(e); Utilidades.toast('Falhou: ' + (e && e.message || e), 'erro', 6000); }
    finally { Utilidades.loading.esconder(); }
  }

  function render() {
    const clientes = Banco.clientes();
    const arquivados = Banco.clientes({ arquivados: true });
    const ativo = App.clienteAtivo();

    el.innerHTML = `
      <div class="tela-cabecalho">
        <h1 class="tela-titulo">Clientes</h1>
        <span class="tela-sub">quem contrata a auditoria — e os hospitais de cada um · cada cliente tem o seu próprio cofre</span>
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

      ${arquivados.length ? `<div class="painel">
        <div class="painel-cabecalho"><span class="painel-titulo">Arquivados</span>
          <span class="painel-conta">${arquivados.length} cliente(s) fora das listas — o cofre continua guardado</span></div>
        <div class="rolagem-x"><table class="tabela"><tbody>
          ${arquivados.map(c => `<tr>
            <td><strong>${esc(c.nome)}</strong> <span class="texto-cinza">${esc(TIPO[c.tipo] || c.tipo || '')}${c.documento ? ' · ' + esc(c.documento) : ''}</span></td>
            <td class="texto-cinza">produção ${n(c.producao)} · sistema ${n(c.sistema)} · ${tamanho(c.bytes)}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="botao botao-mini" data-acao="reativar" data-id="${c.id}">Reativar</button>
              <button class="botao botao-mini botao-perigo" data-acao="excluir" data-id="${c.id}" title="Apaga o cofre deste cliente do navegador">Excluir definitivamente</button>
            </td></tr>`).join('')}
        </tbody></table></div>
      </div>` : ''}
    `;

    el.querySelector('#cli-add').addEventListener('click', async () => {
      const nome = el.querySelector('#cli-nome').value.trim();
      if (!nome) { Utilidades.toast('Informe o nome do cliente.', 'aviso'); return; }
      await agir('Criando o cofre do cliente…', async () => {
        await Banco.criarCliente({
          nome, tipo: el.querySelector('#cli-tipo').value,
          documento: el.querySelector('#cli-doc').value.trim(), contato: el.querySelector('#cli-contato').value.trim(),
        });
        Utilidades.toast('Cliente cadastrado.', 'ok');
      });
      App.renderShell();
      App.navegar('clientes');
    });

    // ── handlers dos cartões ──
    el.querySelectorAll('[data-acao]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const acao = btn.dataset.acao;
        const id = Number(btn.dataset.id);
        const c = Banco.cliente(id);

        if (acao === 'ativar') {
          await App.setClienteAtivo(id);
          App.navegar('clientes');

        } else if (acao === 'remover') {
          const temDados = (c.producao || 0) + (c.sistema || 0);
          const msg = temDados
            ? `Este cliente tem ${n(temDados)} linhas importadas. Ele será apenas ARQUIVADO (o cofre continua guardado). Continuar?`
            : 'Arquivar este cliente?';
          if (!confirm(msg)) return;
          await agir('Arquivando…', () => Banco.arquivarCliente(id));
          App.renderShell();
          App.navegar('clientes');

        } else if (acao === 'reativar') {
          await agir('Reativando…', () => Banco.reativarCliente(id));
          App.renderShell();
          App.navegar('clientes');

        } else if (acao === 'excluir') {
          if (!confirm(`EXCLUIR DEFINITIVAMENTE o cliente "${c.nome}" e todos os dados dele deste navegador? Não há volta sem backup.`)) return;
          if (!confirm('Última confirmação: excluir mesmo?')) return;
          await agir('Excluindo o cofre…', () => Banco.excluirCliente(id));
          Utilidades.toast('Cliente excluído.', 'ok');
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
    const ehAtivo = !!ativo && ativo.id === c.id;
    // o cliente ativo mostra o cofre ao vivo; os outros, o retrato do último salvamento (catálogo)
    const hospitais = ehAtivo ? App.listarHospitais(c.id) : (c.hospitais || []);
    const nProd = ehAtivo ? (Banco.escalar('SELECT COUNT(*) FROM linhas_producao WHERE cliente_id=?', [c.id]) || 0) : (c.producao || 0);
    const nRep = ehAtivo ? (Banco.escalar('SELECT COUNT(*) FROM linhas_repasse WHERE cliente_id=?', [c.id]) || 0) : (c.sistema || 0);

    return `
      <div class="painel ${ehAtivo ? 'painel-ativo' : ''}">
        <div class="painel-cabecalho">
          <span class="painel-titulo">${esc(c.nome)}</span>
          <span class="painel-conta">${esc(TIPO[c.tipo] || c.tipo || '')}${c.documento ? ' · ' + esc(c.documento) : ''}${c.contato ? ' · ' + esc(c.contato) : ''}</span>
          <span class="painel-conta">· produção: ${n(nProd)} linhas · sistema: ${n(nRep)} · cofre ${tamanho(c.bytes)}${c.atualizado_em ? ' · gravado ' + esc(quando(c.atualizado_em)) : ''}</span>
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
              <td class="texto-cinza">${ehAtivo ? (Banco.escalar('SELECT COUNT(*) FROM base_tabela WHERE hospital_id=?', [h.id]) || 0) + ' regras na Base Tabela' : ''}</td>
              <td style="text-align:right">
                ${ehAtivo ? `<button class="botao botao-mini botao-perigo" data-acao="rem-hosp" data-id="${h.id}">remover</button>` : ''}
              </td></tr>`).join('')}
          </tbody></table></div>` :
          `<div class="texto-cinza" style="margin-bottom:8px">Nenhum hospital ainda — cadastre para poder importar os relatórios.</div>`}
          ${ehAtivo ? `<div class="linha-campos" style="margin-top:10px">
            <div class="campo"><span class="campo-rotulo">Novo hospital/clínica</span>
              <input id="hosp-nome-${c.id}" placeholder="ex.: Hospital Santa Luzia"></div>
            <button class="botao" data-acao="add-hosp" data-id="${c.id}">＋ Adicionar</button>
          </div>` :
          `<div class="texto-cinza" style="font-size:11.5px;margin-top:8px">Torne o cliente ativo para cadastrar hospitais e importar relatórios.</div>`}
        </div>
      </div>`;
  }

  render();
};
