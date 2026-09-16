/**
 * ============================================================================
 * TELA: Unidades
 *
 * CRUD simples para gerenciar as unidades de atendimento.
 * Mostra também a quantidade de médicos vinculados a cada unidade.
 * ============================================================================
 */

App.telas['unidades'] = function () {

  function renderizar() {
    const unidades = Banco.query(`
      SELECT
        u.id, u.nome, u.ativo,
        (SELECT COUNT(*) FROM medico_unidades WHERE unidade_id = u.id) AS qtd_medicos
      FROM unidades u
      ORDER BY u.ordem, u.nome
    `);

    const totalUnidades = unidades.length;
    const totalAtivas = unidades.filter(u => u.ativo).length;

    const html = `
      <div class="page-content">
        <header class="page-header">
          <div>
            <h2>Unidades</h2>
            <div class="subtitle">Unidades de atendimento — cadastre as suas e vincule aos médicos</div>
          </div>
          <div style="display: flex; gap: 8px">
            <button class="btn btn-primary" id="btn-nova-unidade">+ Nova Unidade</button>
          </div>
        </header>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="label">Unidades cadastradas</div>
            <div class="value">${Utilidades.formatarNumero(totalUnidades)}</div>
            <div class="meta">${totalAtivas} ativa${totalAtivas !== 1 ? 's' : ''}</div>
          </div>
          <div class="stat-card">
            <div class="label">Vínculos médico × unidade</div>
            <div class="value">${Utilidades.formatarNumero(Banco.contar('medico_unidades'))}</div>
          </div>
        </div>

        <div class="card" style="padding: 0; overflow: hidden">
          ${totalUnidades === 0 ? `
            <div class="empty-state" style="padding: 60px 20px">
              <div class="icon">◇</div>
              <h3>Nenhuma unidade cadastrada</h3>
              <p>Comece criando uma de teste pelo botão "+ Nova Unidade".</p>
            </div>
          ` : `
            <table class="data-table">
              <thead>
                <tr>
                  <th>UNIDADE</th>
                  <th class="num">MÉDICOS VINCULADOS</th>
                  <th>STATUS</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${unidades.map(u => `
                  <tr data-unidade-id="${u.id}">
                    <td style="font-weight: 600">${escapeHTML(u.nome)}</td>
                    <td class="num mono">${u.qtd_medicos}</td>
                    <td>${u.ativo
                      ? '<span class="tag tag-success">Ativa</span>'
                      : '<span class="tag tag-neutral">Inativa</span>'}</td>
                    <td style="text-align: right">
                      <button class="btn btn-pequeno btn-renomear" data-id="${u.id}" data-nome="${escapeHTML(u.nome)}">Renomear</button>
                      <button class="btn btn-pequeno btn-toggle-ativo" data-id="${u.id}" data-ativo="${u.ativo}">
                        ${u.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                      <button class="btn btn-pequeno btn-perigo btn-excluir" data-id="${u.id}" data-nome="${escapeHTML(u.nome)}" data-qtd="${u.qtd_medicos}">×</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>
      </div>

      <style>
        .btn-pequeno {
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 600;
          margin-left: 4px;
        }
      </style>
    `;

    document.getElementById('conteudo').innerHTML = html;

    // ============== EVENTOS ==============

    document.getElementById('btn-nova-unidade').addEventListener('click', novaUnidade);

    document.querySelectorAll('.btn-renomear').forEach(btn => {
      btn.addEventListener('click', () => renomearUnidade(Number(btn.dataset.id), btn.dataset.nome));
    });

    document.querySelectorAll('.btn-toggle-ativo').forEach(btn => {
      btn.addEventListener('click', () => toggleAtivo(Number(btn.dataset.id), btn.dataset.ativo === '1'));
    });

    document.querySelectorAll('.btn-excluir').forEach(btn => {
      btn.addEventListener('click', () => excluirUnidade(
        Number(btn.dataset.id),
        btn.dataset.nome,
        Number(btn.dataset.qtd)
      ));
    });
  }

  // ============== AÇÕES ==============

  async function novaUnidade() {
    const nome = prompt('Nome da unidade (ex: Águas Claras, Matriz, Taguatinga):');
    if (!nome || !nome.trim()) return;

    const nomeLimpo = nome.trim();
    const existente = Banco.queryUnica(
      'SELECT id, nome FROM unidades WHERE UPPER(nome) = UPPER(?)',
      [nomeLimpo]
    );
    if (existente) {
      alert(`Já existe unidade "${existente.nome}"`);
      return;
    }

    const prox = (Banco.queryUnica(
      'SELECT COALESCE(MAX(ordem), 0) + 1 AS n FROM unidades'
    ) || { n: 1 }).n;

    Banco.executar(
      'INSERT INTO unidades (nome, ordem, ativo) VALUES (?, ?, 1)',
      [nomeLimpo, prox]
    );
    await Banco.salvar();
    Utilidades.toast('Unidade criada', 'success');
    renderizar();
  }

  async function renomearUnidade(id, nomeAtual) {
    const novoNome = prompt('Novo nome da unidade:', nomeAtual);
    if (!novoNome || !novoNome.trim() || novoNome.trim() === nomeAtual) return;

    const novoLimpo = novoNome.trim();
    const existente = Banco.queryUnica(
      'SELECT id FROM unidades WHERE UPPER(nome) = UPPER(?) AND id != ?',
      [novoLimpo, id]
    );
    if (existente) {
      alert('Já existe outra unidade com esse nome');
      return;
    }

    Banco.executar('UPDATE unidades SET nome = ? WHERE id = ?', [novoLimpo, id]);
    await Banco.salvar();
    Utilidades.toast('Unidade renomeada', 'success');
    renderizar();
  }

  async function toggleAtivo(id, ativoAtual) {
    Banco.executar('UPDATE unidades SET ativo = ? WHERE id = ?', [ativoAtual ? 0 : 1, id]);
    await Banco.salvar();
    Utilidades.toast(ativoAtual ? 'Unidade desativada' : 'Unidade reativada', 'success');
    renderizar();
  }

  async function excluirUnidade(id, nome, qtdMedicos) {
    if (qtdMedicos > 0) {
      alert(
        `A unidade "${nome}" tem ${qtdMedicos} médico(s) vinculado(s).\n\n` +
        `Desative em vez de excluir (botão "Desativar") — assim você preserva o histórico.\n\n` +
        `Para excluir, primeiro remova os vínculos manualmente em cada médico.`
      );
      return;
    }

    if (!confirm(`Excluir a unidade "${nome}"?\n\nEsta ação não pode ser desfeita.`)) return;

    Banco.executar('DELETE FROM unidades WHERE id = ?', [id]);
    await Banco.salvar();
    Utilidades.toast('Unidade excluída', 'success');
    renderizar();
  }

  // Render inicial
  renderizar();
};

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
