/**
 * ============================================================================
 * TELA: Backup
 *   - Exportar banco como arquivo .db
 *   - Importar banco existente
 *   - Resetar (apagar tudo)
 * ============================================================================
 */

App.telas['backup'] = function () {
  const r = Banco.resumo();
  const total = Object.values(r).reduce((a, b) => a + b, 0);

  const dataHoje = new Date().toISOString().slice(0, 10);
  const nomePadrao = `repasse_backup_${dataHoje}.db`;

  // ── V592: card do ARQUIVO AUTOMÁTICO (File System Access) ────────────
  const arq = window.AtlasArquivoBanco ? AtlasArquivoBanco.estado() : { suportado: false };
  const arqStatusHtml = () => {
    if (!arq.suportado) {
      return `<p style="margin: 8px 0 0; font-size: 13px; color: var(--ink-soft)">
        Este navegador não tem suporte à gravação em arquivo. Use <strong>Google Chrome</strong> ou <strong>Microsoft Edge</strong>.</p>`;
    }
    if (!arq.vinculado) {
      return `<p style="margin: 8px 0 0; font-size: 13px; color: var(--ink-soft)">
        Nenhum arquivo vinculado ainda. Escolha um arquivo numa pasta segura
        (<strong>OneDrive / pasta de rede</strong>) e a ferramenta passa a gravar nele
        <strong>sozinha</strong> a cada alteração — se a máquina pifar ou o navegador for limpo,
        os dados continuam no arquivo.</p>`;
    }
    const ult = arq.ultimaGravacao ? arq.ultimaGravacao.toLocaleString('pt-BR') : 'ainda nesta sessão';
    const erroHtml = arq.erro === 'permissao'
      ? `<div style="margin-top:8px; font-size:12.5px; color:#8A6840"><strong>⚠ Permissão pendente</strong> — o navegador precisa reautorizar o acesso ao arquivo nesta sessão. Clique em <strong>Reautorizar</strong>.</div>`
      : (arq.erro ? `<div style="margin-top:8px; font-size:12.5px; color:#a15646"><strong>⚠</strong> ${arq.erro}</div>` : '');
    return `<p style="margin: 8px 0 0; font-size: 13px; color: var(--ink-soft)">
      Vinculado a <strong>${arq.nome}</strong> · última gravação: <strong>${ult}</strong>.
      A ferramenta grava nele automaticamente (alguns segundos após cada alteração).</p>${erroHtml}`;
  };

  App.alvoConteudo().innerHTML = `
    <div class="page-content">
      <header class="page-header">
        <div>
          <h2>Backup &amp; Restauração</h2>
          <div class="subtitle">Mantenha cópias de segurança dos seus dados</div>
        </div>
      </header>

      <div class="card" style="margin-bottom: 24px; background: var(--warning-soft); border-color: var(--warning)">
        <div style="display: flex; gap: 16px; align-items: flex-start">
          <div style="font-size: 24px">⚠</div>
          <div>
            <h3 class="card-title" style="margin: 0">Onde os dados vivem</h3>
            <p style="margin: 8px 0 0; font-size: 13px; color: var(--ink-soft)">
              Seus dados ficam armazenados <strong>apenas neste navegador</strong>, neste computador
              (aba anônima e outros navegadores <strong>não</strong> enxergam esses dados).
              Vincule o <strong>arquivo automático</strong> abaixo para ter uma cópia real em disco,
              atualizada sozinha — e/ou exporte um backup manual todo fim de mês.
            </p>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px; border-color: #46688c">
        <h3 class="card-title">Arquivo automático <span style="font-size: 10px; font-weight: 800; letter-spacing: .06em; color: #fff; background: #46688c; border-radius: 999px; padding: 3px 8px; vertical-align: middle">RECOMENDADO</span></h3>
        <!-- V593: sem subtítulo — só o título, a pedido do usuário -->
        <div id="bk-arq-status">${arqStatusHtml()}</div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px">
          ${arq.suportado ? `
            <button class="btn btn-primary" id="bk-arq-vincular">${arq.vinculado ? 'Trocar arquivo…' : 'Criar/vincular arquivo…'}</button>
            <button class="btn" id="bk-arq-restaurar" title="Escolher um arquivo .db existente e CARREGAR os dados dele (recuperação em máquina nova)">Vincular arquivo existente (restaurar)…</button>
            ${arq.vinculado ? `
              <button class="btn" id="bk-arq-gravar">Gravar agora</button>
              ${arq.erro === 'permissao' ? `<button class="btn" id="bk-arq-reautorizar" style="border-color:#B8965A; color:#8A6840">Reautorizar</button>` : ''}
              <button class="btn" id="bk-arq-desvincular" style="color: #a15646">Desvincular</button>` : ''}` : ''}
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px">
        <h3 class="card-title">Compactar banco</h3>
        <p class="card-subtitle">Recupera o espaço morto deixado por importações e exclusões — o banco encolhe e o salvamento fica mais rápido. Nenhum dado é apagado.</p>
        <div style="display: flex; gap: 14px; align-items: center; margin-top: 14px">
          <button class="btn" id="bk-compactar">🗜 Compactar agora</button>
          <div class="small muted" id="bk-compactar-info">${Banco._ultimoExportTam ? `Tamanho no último salvamento: <strong>${(Banco._ultimoExportTam / 1048576).toFixed(1).replace('.', ',')} MB</strong>` : 'Pode levar até ~1 minuto em bancos grandes.'}</div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Exportar banco</h3>
        <p class="card-subtitle">Salva todos os dados em um arquivo .db que você pode guardar</p>

        <div style="display: flex; gap: 16px; align-items: center; margin-top: 16px">
          <button class="btn btn-primary" id="btn-exportar">
            <span>↓</span> Exportar arquivo .db
          </button>
          <div class="small muted">
            Atualmente: <strong>${total}</strong> registros no banco
          </div>
        </div>
      </div>

      <div class="card" style="margin-top: 16px">
        <h3 class="card-title">Importar banco</h3>
        <p class="card-subtitle">Substitui o banco atual por um arquivo .db de backup</p>

        <div style="margin-top: 16px">
          <input type="file" id="upload-banco" accept=".db,.sqlite,.sqlite3" style="display: none">
          <button class="btn" id="btn-importar">
            <span>↑</span> Importar arquivo .db
          </button>
        </div>
      </div>

    </div>
  `;

  // ── V592: eventos do ARQUIVO AUTOMÁTICO ──────────────────────────────
  const rerender = () => App.telas['backup']();
  const bkErro = (e) => {
    if (e && e.name === 'AbortError') return;   // usuário cancelou o seletor
    Utilidades.toast('Arquivo automático: ' + ((e && e.message) || e), 'error', 4500);
  };
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
  on('bk-arq-vincular', async () => {
    try { const nome = await AtlasArquivoBanco.vincularNovo(); if (nome) rerender(); } catch (e) { bkErro(e); }
  });
  on('bk-arq-restaurar', async () => {
    try {
      const nome = await AtlasArquivoBanco.vincularExistente();
      if (nome) App.navegarPara('dashboard');
    } catch (e) { bkErro(e); }
  });
  on('bk-arq-gravar', async () => {
    const ok = await AtlasArquivoBanco.gravarAgora();
    Utilidades.toast(ok ? 'Banco gravado no arquivo' : 'Não foi possível gravar — veja o status', ok ? 'success' : 'error');
    rerender();
  });
  on('bk-arq-reautorizar', async () => {
    const ok = await AtlasArquivoBanco.reautorizar();
    Utilidades.toast(ok ? 'Permissão reautorizada — gravação automática ativa' : 'Permissão negada pelo navegador', ok ? 'success' : 'error');
    rerender();
  });
  on('bk-arq-desvincular', async () => {
    if (!confirm('Desvincular o arquivo automático?\nO arquivo em disco NÃO será apagado — só deixa de ser atualizado.')) return;
    await AtlasArquivoBanco.desvincular();
    rerender();
  });

  // V697: o Diagnóstico de desempenho mudou para a ADMINISTRAÇÃO.

  // V606: compactação manual (VACUUM + salvar)
  const btnComp = document.getElementById('bk-compactar');
  if (btnComp) btnComp.addEventListener('click', async () => {
    btnComp.disabled = true;
    Utilidades.mostrarLoading('Compactando o banco — pode levar até 1 minuto…');
    try {
      const r = await Banco.compactar();
      Utilidades.esconderLoading();
      const mb = (n) => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
      Utilidades.toast(r.antes && r.depois
        ? `✓ Banco compactado: ${mb(r.antes)} → ${mb(r.depois)}`
        : `✓ Banco compactado${r.depois ? ': ' + mb(r.depois) : ''}`, 'success', 6000);
      rerender();
    } catch (e) {
      Utilidades.esconderLoading();
      Utilidades.toast('Erro ao compactar: ' + (e.message || e), 'error', 5000);
      btnComp.disabled = false;
    }
  });

  // Eventos
  document.getElementById('btn-exportar').addEventListener('click', () => {
    try {
      Banco.exportar(`repasse_backup_${dataHoje}.db`);
      Utilidades.toast('Backup exportado com sucesso', 'success');
    } catch (e) {
      Utilidades.toast('Erro ao exportar: ' + e.message, 'error');
    }
  });

  document.getElementById('btn-importar').addEventListener('click', () => {
    document.getElementById('upload-banco').click();
  });

  document.getElementById('upload-banco').addEventListener('change', async (e) => {
    const arq = e.target.files[0];
    if (!arq) return;

    const ok = confirm(
      `Importar substituirá TODOS os dados atuais!\n\n` +
      `Você tem certeza que quer continuar?\n\n` +
      `Dica: faça um backup do banco atual antes, por garantia.`
    );
    if (!ok) {
      e.target.value = '';
      return;
    }

    Utilidades.mostrarLoading('Importando banco...');
    try {
      await Banco.importar(arq);
      Utilidades.esconderLoading();
      Utilidades.toast('Banco importado com sucesso', 'success');
      App.navegarPara('dashboard');
    } catch (err) {
      Utilidades.esconderLoading();
      alert('Erro ao importar: ' + err.message);
    }
  });
};
