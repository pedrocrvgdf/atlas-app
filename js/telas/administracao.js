/**
 * ============================================================================
 * TELA: Administração
 *
 * V697: centro de DESENVOLVIMENTO e observabilidade da ferramenta —
 *   1. Saúde da ferramenta (números-chave do banco e do salvamento)
 *   2. Diagnóstico de desempenho (funções pesadas + travadas da sentinela)
 *   3. Log local de erros
 *   4. Manual, senha administrativa, marca institucional e zona crítica
 * ============================================================================
 */

App.telas['administracao'] = function () {

  function renderizar() {
    App.alvoConteudo().innerHTML = `
      <div class="page-content">
        <header class="page-header">
          <div>
            <h2>Administração</h2>
            <div class="subtitle">Centro de desenvolvimento — desempenho, erros e saúde da ferramenta</div>
          </div>
        </header>

        <!-- V596: Manual da ferramenta -->
        <div class="card" style="margin-bottom: 16px; border-color: #46688c">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap">
            <div>
              <h3 class="card-title">📖 Manual da ferramenta</h3>
              <p class="card-subtitle" style="margin-bottom: 0">
                Guia completo dos módulos, regras e fluxo mensal — para ler aqui ou exportar em Word.
              </p>
            </div>
            <button class="btn btn-primary" id="btn-abrir-manual">Abrir manual</button>
          </div>
        </div>

        <!-- V698 (handoff 15A): SAÚDE + DIAGNÓSTICO num bloco único -->
        <div style="margin-bottom: 10px">
          <h3 class="card-title" style="margin-bottom: 2px">Saúde da ferramenta</h3>
          <p class="card-subtitle" style="margin-bottom: 0">Diagnóstico de desempenho, banco e sessão — só cronômetros e contagens, nenhum dado de paciente.</p>
        </div>
        <div class="card admsd-card" id="adm-diag" style="padding: 0; overflow: hidden; margin-bottom: 16px">
          <div id="adm-sd-corpo"></div>
        </div>

        <!-- V695: Card — Log LOCAL de erros (observabilidade offline) -->
        <div class="card" style="margin-bottom: 16px">
          <h3 class="card-title">Log de erros (local)</h3>
          <p class="card-subtitle">
            Erros de JavaScript capturados automaticamente enquanto a ferramenta roda —
            gravados <strong>somente neste banco local</strong>, nada sai da máquina.
            Útil pra manutenção diagnosticar um problema mesmo que ninguém tenha anotado a hora.
          </p>
          <div id="adm-log-erros" style="margin-top: 12px">${(() => {
            const escL = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            const erros = (window.AtlasLogErros ? AtlasLogErros.listar(30) : []);
            if (!erros.length) return '<div style="font-size: 13px; color: var(--ink-faint); font-style: italic">Nenhum erro registrado.</div>';
            return `
              <div style="max-height: 260px; overflow-y: auto; border: 1px solid var(--border); border-radius: 9px">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px">
                  <thead><tr style="background: var(--bg-elevated, #fafbfc)">
                    <th style="text-align: left; padding: 7px 10px">Quando</th>
                    <th style="text-align: left; padding: 7px 10px">Tela</th>
                    <th style="text-align: left; padding: 7px 10px">Erro</th>
                    <th style="text-align: right; padding: 7px 10px" title="Vezes seguidas que o mesmo erro ocorreu">×</th>
                  </tr></thead>
                  <tbody>${erros.map(e => `
                    <tr style="border-top: 1px solid var(--border)" title="${escL(e.stack)}">
                      <td style="padding: 6px 10px; white-space: nowrap; font-family: monospace">${escL(e.quando)}</td>
                      <td style="padding: 6px 10px">${escL(e.tela) || '—'}</td>
                      <td style="padding: 6px 10px; word-break: break-word">${escL(e.msg)}</td>
                      <td style="padding: 6px 10px; text-align: right; font-weight: 700">${e.n > 1 ? e.n + '×' : ''}</td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>
              <button class="btn" id="btn-limpar-log-erros" style="margin-top: 10px">Limpar log (${window.AtlasLogErros ? AtlasLogErros.contar() : 0})</button>`;
          })()}</div>
        </div>

        <!-- ATLAS v1.0: o hospital atendido — a marca do profissional institucional -->
        <div class="card" style="margin-bottom: 16px">
          <h3 class="card-title">Hospital atendido — profissional institucional</h3>
          <p class="card-subtitle">
            Nos relatórios do hospital, alguns papéis vêm no nome da <strong>própria instituição</strong>
            (ex.: "MEDICO CENTRO DIAGNOSTICOS CBV"). Esse profissional não recebe repasse: a Inspeção
            zera o valor dele na extração. Diga aqui a palavra que identifica a instituição nesses nomes.
          </p>
          <div style="display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; max-width: 520px; margin-top: 12px">
            <div class="field" style="flex: 1; min-width: 200px; margin: 0">
              <label>Marca no nome do profissional</label>
              <input type="text" class="input" id="adm-marca-inst" value="${(window.Utilidades && Utilidades.marcaInstitucional) ? Utilidades.marcaInstitucional() : 'CBV'}" placeholder="ex.: CBV">
            </div>
            <button class="btn btn-primary" id="btn-marca-inst">Salvar</button>
          </div>
        </div>

        <!-- Card 2: Senha administrativa -->
        <div class="card" style="margin-bottom: 16px">
          <h3 class="card-title">Senha administrativa</h3>
          <p class="card-subtitle">
            A ATLAS não tem tela de login. Esta senha só confirma as ações que não têm volta —
            apagar tudo, publicar uma versão da Base Tabela, desmarcar uma admissão paga no OPME.
            Padrão de fábrica: <strong class="mono">1q2w3e4r5t6y7u</strong> — troque aqui.
          </p>

          <div style="max-width: 420px; margin-top: 16px">
            <div class="field">
              <label>Senha atual</label>
              <input type="password" class="input" id="senha-atual" autocomplete="current-password">
            </div>
            <div class="field">
              <label>Nova senha (mín. 6 caracteres)</label>
              <input type="password" class="input" id="senha-nova" autocomplete="new-password">
            </div>
            <div class="field">
              <label>Confirmar nova senha</label>
              <input type="password" class="input" id="senha-conf" autocomplete="new-password">
            </div>
            <button class="btn btn-primary" id="btn-alterar-senha">Alterar senha</button>
          </div>
        </div>

        <!-- Card 3: Apagar tudo (zona de perigo) -->
        <div class="card" style="border-color: var(--danger); background: var(--danger-soft)">
          <h3 class="card-title" style="color: var(--danger)">⚠ Zona crítica · Apagar tudo</h3>
          <p class="card-subtitle">
            Esta ação apaga <strong>todos os dados</strong> do sistema (procedimentos, médicos, unidades, etc.).
            <strong>Faça um backup antes</strong> se quiser garantir.
          </p>

          <button class="btn" id="btn-apagar-tudo"
                  style="background: var(--danger); color: white; border-color: var(--danger); margin-top: 12px">
            Apagar TUDO
          </button>
        </div>
      </div>

    `;

    bindEventos();
    renderSaudeDiag();
  }

  // ==========================================================================
  // EVENTOS
  // ==========================================================================

  function bindEventos() {

    // V596: Manual da ferramenta (pop-up + export Word)
    const btnManual = document.getElementById('btn-abrir-manual');
    if (btnManual) btnManual.addEventListener('click', () => {
      if (window.AtlasManual) AtlasManual.abrir();
    });

    // ATLAS v1.0: marca do profissional institucional (dado do hospital atendido)
    const btnMarca = document.getElementById('btn-marca-inst');
    if (btnMarca) btnMarca.addEventListener('click', () => {
      const v = (document.getElementById('adm-marca-inst').value || '').trim();
      if (!v) { alert('Informe a palavra que identifica a instituição nos nomes.'); return; }
      Utilidades.marcaInstitucionalGravar(v);
      Utilidades.toast('Marca institucional gravada: ' + v.toUpperCase(), 'success');
    });

    // Alterar senha
    document.getElementById('btn-alterar-senha').addEventListener('click', async () => {
      const atual = document.getElementById('senha-atual').value;
      const nova = document.getElementById('senha-nova').value;
      const conf = document.getElementById('senha-conf').value;

      if (!atual || !nova || !conf) {
        alert('Preencha todos os campos');
        return;
      }
      if (nova !== conf) {
        alert('A nova senha e a confirmação não conferem');
        return;
      }
      if (nova.length < 6) {
        alert('A nova senha precisa ter pelo menos 6 caracteres');
        return;
      }

      try {
        await Auth.alterarSenha(atual, nova);
        // Limpa os campos
        document.getElementById('senha-atual').value = '';
        document.getElementById('senha-nova').value = '';
        document.getElementById('senha-conf').value = '';
        alert(
          '✓ Senha administrativa alterada!\n\n' +
          'Ela passa a valer nas próximas confirmações de ações sensíveis.\n\n' +
          'Importante: anote em local seguro. Se esquecer, não há recuperação ' +
          '(você precisaria limpar o localStorage do navegador para resetar).'
        );
      } catch (e) {
        alert('Erro: ' + e.message);
      }
    });

    // Apagar tudo — confirmação tripla
    document.getElementById('btn-apagar-tudo').addEventListener('click', apagarTudo);


    // V695: limpar o log local de erros
    const btnLimparLog = document.getElementById('btn-limpar-log-erros');
    if (btnLimparLog) btnLimparLog.addEventListener('click', () => {
      if (!confirm('Limpar todo o log de erros?')) return;
      if (window.AtlasLogErros) AtlasLogErros.limpar();
      Utilidades.toast('Log de erros limpo.', 'success');
      renderizar();
    });
  }

  // ══ V698 (handoff 15A): SAÚDE + DIAGNÓSTICO num bloco único ══════════════
  // Faixa de veredito (erro/aviso/ok) + 3 grupos de métricas nomeados +
  // tabela de funções com barra de proporção e limiares (2,5s = sentinela).
  const ADMSD_CSS = `
    .admsd-faixa { display: flex; align-items: center; gap: 16px; padding: 16px 22px; border-bottom: 1px solid; }
    .admsd-faixa.erro  { background: #fdf4f2; border-color: #f2d9d2; }
    .admsd-faixa.aviso { background: #fdf9ef; border-color: #f0e2c4; }
    .admsd-faixa.ok    { background: #f2faf6; border-color: #cfe9dc; }
    .admsd-tile { width: 38px; height: 38px; flex: none; border-radius: 9px; display: flex; align-items: center; justify-content: center; color: #fff; }
    .admsd-faixa.erro  .admsd-tile { background: #c0563f; }
    .admsd-faixa.aviso .admsd-tile { background: #c08a1e; }
    .admsd-faixa.ok    .admsd-tile { background: #1d8f5f; }
    .admsd-fx-txt { flex: 1; min-width: 0; }
    .admsd-fx-tit { font-size: 15px; font-weight: 700; }
    .admsd-faixa.erro  .admsd-fx-tit { color: #8f3d2b; }
    .admsd-faixa.aviso .admsd-fx-tit { color: #8a6414; }
    .admsd-faixa.ok    .admsd-fx-tit { color: #166b48; }
    .admsd-fx-sub { font-size: 12.5px; color: #7a5348; margin-top: 2px; }
    .admsd-faixa.ok .admsd-fx-sub { color: #4f7a63; }
    .admsd-fx-acoes { display: flex; gap: 9px; flex: none; }
    .admsd-btn-pri { height: 38px; padding: 0 16px; border: none; border-radius: 9px; font: 700 12.5px/1 inherit; font-family: inherit;
      color: #fff; cursor: pointer; display: flex; align-items: center; gap: 7px; white-space: nowrap; }
    .admsd-faixa.erro  .admsd-btn-pri { background: #c0563f; } .admsd-faixa.erro  .admsd-btn-pri:hover { background: #a04a36; }
    .admsd-faixa.aviso .admsd-btn-pri { background: #c08a1e; } .admsd-faixa.aviso .admsd-btn-pri:hover { background: #a3760f; }
    .admsd-faixa.ok    .admsd-btn-pri { background: #1d8f5f; } .admsd-faixa.ok    .admsd-btn-pri:hover { background: #166b48; }
    .admsd-btn-sec { height: 38px; padding: 0 16px; border-radius: 9px; font: 700 12.5px/1 inherit; font-family: inherit;
      background: #fff; border: 1px solid #e0c4bb; color: #8f3d2b; cursor: pointer; white-space: nowrap; }
    .admsd-btn-sec:hover { background: #faeae6; }
    .admsd-grupos { display: grid; grid-template-columns: 1.15fr 1fr 1fr; }
    .admsd-grupo { padding: 18px 22px 20px; border-right: 1px solid #f7f8fa; min-width: 0; }
    .admsd-grupo:last-child { border-right: none; }
    .admsd-gr-tit { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700;
      letter-spacing: .11em; text-transform: uppercase; color: #585d62; margin-bottom: 13px; }
    .admsd-linha { display: flex; align-items: baseline; gap: 12px; }
    .admsd-linha + .admsd-linha { margin-top: 11px; }
    .admsd-rot { flex: 1; min-width: 0; font-size: 13px; color: #585d62; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .admsd-val { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; color: #3a5877; }
    .admsd-val.bom { color: #1d8f5f; } .admsd-val.ruim { color: #c0563f; } .admsd-val.fraco { color: #585d62; font-weight: 600; } .admsd-val.aten { color: #c08a1e; }
    .admsd-nota { width: 106px; flex: none; font-size: 11.5px; color: #585d62; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .admsd-funcs { border-top: 1px solid #eef2f6; padding: 16px 22px 6px; }
    .admsd-fn-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
    .admsd-fn-tit { font-size: 13.5px; font-weight: 700; color: #3a5877; }
    .admsd-fn-sub { font-size: 12px; color: #585d62; flex: 1; }
    .admsd-fn-quando { font-size: 11.5px; color: #585d62; white-space: nowrap; }
    .admsd-btn-rec { height: 34px; padding: 0 13px; border: 1px solid #eef0f2; border-radius: 9px; background: #fff;
      font: 700 12px/1 inherit; font-family: inherit; color: #3a5877; cursor: pointer; display: flex; align-items: center; gap: 7px; white-space: nowrap; }
    .admsd-btn-rec:hover { background: #fafbfc; }
    .admsd-tab { min-width: 640px; }
    .admsd-tab-wrap { overflow-x: auto; margin: 0 -22px; padding: 0 22px; }
    .admsd-tr { display: grid; grid-template-columns: 1.9fr 100px 120px 120px 1fr; align-items: center; }
    .admsd-th { background: #1f7fb5; }
    .admsd-th > div { padding: 10px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #fff; }
    .admsd-td { padding: 11px 12px; border-bottom: 1px solid #f7f8fa; font-variant-numeric: tabular-nums; }
    .admsd-tr:nth-child(odd):not(.admsd-th) .admsd-td { background: #fbfdfe; }
    .admsd-fn-nome { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #3a5877;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .admsd-num { text-align: right; font-size: 12.5px; color: #585d62; }
    .admsd-tot { text-align: right; font-size: 12.5px; font-weight: 600; color: #3a5877; }
    .admsd-pico { text-align: right; font-size: 12.5px; font-weight: 700; }
    .admsd-barra { height: 5px; background: #f7f8fa; border-radius: 3px; overflow: hidden; }
    .admsd-barra > div { height: 100%; border-radius: 3px; }
    .admsd-vazio { font-size: 13px; color: #585d62; padding: 22px 0; }
    @media (max-width: 1200px) {
      .admsd-grupos { grid-template-columns: 1fr 1fr; }
      .admsd-grupo:nth-child(3) { grid-column: 1 / -1; border-right: none; border-top: 1px solid #f7f8fa; }
      .admsd-grupo:nth-child(2) { border-right: none; }
    }
    @media (max-width: 900px) {
      .admsd-grupos { grid-template-columns: 1fr; }
      .admsd-grupo { border-right: none; }
      .admsd-grupo + .admsd-grupo { border-top: 1px solid #f7f8fa; }
      .admsd-faixa { flex-wrap: wrap; }
      .admsd-fx-acoes { width: 100%; justify-content: flex-end; }
    }`;
  function _admsdEstilos() {
    if (document.getElementById('admsd-css')) return;
    const st = document.createElement('style');
    st.id = 'admsd-css';
    st.textContent = ADMSD_CSS;
    document.head.appendChild(st);
  }
  const _sdSvg = (d, px, sw) => `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 2.1}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const SD_IC = {
    alerta: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    check: '<circle cx="12" cy="12" r="9"/><polyline points="8.5 12.2 11 14.7 15.5 9.7"/>',
    copiar: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>',
    banco: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    user: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
    relogio: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 13.8"/>',
  };
  function renderSaudeDiag() {
    _admsdEstilos();
    const el = document.getElementById('adm-sd-corpo');
    if (!el) return;
    const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const q1 = (sql) => { try { const r = Banco.queryUnica(sql); return r ? (Number(Object.values(r)[0]) || 0) : 0; } catch (_) { return 0; } };
    const num = (n) => (Number(n) || 0).toLocaleString('pt-BR');
    const mb = (n) => ((Number(n) || 0) / 1048576).toFixed(1).replace('.', ',') + ' MB';
    const fseg = (ms) => ((Number(ms) || 0) / 1000).toFixed(1).replace('.', ',') + 's';
    const hhmm = (d) => d ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : '';

    // ── dados ──
    const tv = (window.AtlasDiagPerf && AtlasDiagPerf.travadas) ? (AtlasDiagPerf.travadas() || []) : [];
    const nErros = window.AtlasLogErros ? AtlasLogErros.contar() : 0;
    const arq = (window.AtlasArquivoBanco && AtlasArquivoBanco.estado) ? AtlasArquivoBanco.estado() : {};
    const livres = q1(`PRAGMA freelist_count`) * q1(`PRAGMA page_size`);
    const fases = Banco._fasesUltimoSalvar || null;
    const agg = ((window.AtlasDiagPerf && AtlasDiagPerf.agregado()) || []).slice().sort((a, b) => b.totalMs - a.totalMs);
    let iniciada = null;
    try { const ss = JSON.parse(sessionStorage.getItem(Auth.CHAVE_SESSAO) || 'null'); if (ss && ss.entrouEm) iniciada = new Date(ss.entrouEm); } catch (_) {}
    const agora = new Date();

    // ── faixa de veredito ──
    const avisos = [];
    // V835: mais de uma janela do sistema é a receita do erro de leitura
    if (Banco._outraJanela) {
      avisos.push('O sistema esteve aberto em MAIS DE UMA janela — feche as demais (duas janelas com o mesmo banco causam erro de leitura das fatias)');
    }
    // V832: a abertura anterior foi abandonada no meio? o rastro diz onde parou
    if (Banco._bootAbortadoAnterior) {
      const ab = Banco._bootAbortadoAnterior;
      avisos.push(`A abertura ANTERIOR não terminou — parou em "${ab.fase}"${ab.extra ? ` (${ab.extra})` : ''}`);
    }
    // V839: o boot RECUPEROU a cópia interna a partir do arquivo .db —
    // vale conferir se os lançamentos mais recentes estão presentes
    if (Banco._recuperadoDoArquivo) {
      avisos.push('O banco desta abertura foi RECUPERADO automaticamente da cópia (.db) — confira se os últimos lançamentos estão presentes');
    }
    if (!arq.vinculado) avisos.push('Sem arquivo automático vinculado — vincule em Backup pra ter cópia contínua em disco');
    else if (arq.defasado) avisos.push('Arquivo automático defasado — o próximo salvamento regrava');
    if (livres > 5 * 1048576) avisos.push(`${mb(livres)} recuperáveis dentro do banco — rode Backup → Compactar`);
    // V839: janela suspensa (época vencida) é o problema mais grave da faixa
    const estado = (Banco._epocaVencida || tv.length || nErros) ? 'erro' : (avisos.length ? 'aviso' : 'ok');
    let fxTit, fxSub;
    if (estado === 'erro') {
      if (Banco._epocaVencida) {
        fxTit = 'Salvamentos SUSPENSOS nesta janela — o banco foi substituído/restaurado em OUTRA janela';
        fxSub = 'nada do que for feito aqui será gravado · recarregue (F5) para abrir o banco novo e voltar a salvar';
      } else {
        const partes = [];
        if (tv.length) partes.push(`${tv.length} travada${tv.length > 1 ? 's' : ''} registrada${tv.length > 1 ? 's' : ''}`);
        if (nErros) partes.push(`${nErros} erro${nErros > 1 ? 's' : ''} no log`);
        fxTit = partes.join(' · ') + ' nesta sessão';
        const ult = tv[tv.length - 1];
        fxSub = ult ? `tela presa por mais de 2,5s · a mais recente ${esc(ult.quando)} — <b>${esc(ult.ctx)}</b>`
                    : 'veja o card "Log de erros" logo abaixo';
      }
    } else if (estado === 'aviso') {
      fxTit = avisos[0];
      fxSub = avisos.slice(1).join(' · ') || 'nenhuma travada e nenhum erro nesta sessão';
    } else {
      fxTit = 'Nenhuma travada nesta sessão';
      fxSub = `nenhum erro no log · última verificação às ${hhmm(agora)}`;
    }

    // ── grupos de métricas ──
    const linha = (rot, val, cls, nota) => `
      <div class="admsd-linha"><span class="admsd-rot">${rot}</span><span class="admsd-val ${cls || ''}">${val}</span><span class="admsd-nota" title="${esc(nota || '')}">${nota || ''}</span></div>`;
    const gravadoEm = arq.ultimaGravacao ? (() => { const d = new Date(arq.ultimaGravacao);
      return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ', ' + hhmm(d); })() : '';
    const durSessao = iniciada ? (() => { const m = Math.max(0, Math.round((agora - iniciada) / 60000));
      return m >= 60 ? Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'min' : m + 'min'; })() : '—';
    const gruposHtml = `
      <div class="admsd-grupos" id="adm-saude">
        <div class="admsd-grupo">
          <div class="admsd-gr-tit">${_sdSvg(SD_IC.banco, 14)} Banco de dados</div>
          ${linha('Banco exportado', Banco._ultimoExportTam ? mb(Banco._ultimoExportTam) : '—', Banco._ultimoExportTam ? '' : 'fraco', 'último salvamento')}
          ${linha('Linhas QVIS', num(q1(`SELECT COUNT(*) FROM linhas_qvis`)))}
          ${linha('Linhas de produção', num(q1(`SELECT COUNT(*) FROM linhas_producao`)))}
          ${linha('Espaço recuperável', mb(livres), livres > 5 * 1048576 ? 'aten' : 'fraco', livres > 5 * 1048576 ? 'compacte para recuperar' : 'dentro do normal')}
          <button type="button" class="admsd-btn-sec" id="adm-compactar" style="margin-top:8px"
                  title="Reescreve o banco sem as páginas mortas (VACUUM) e persiste — em banco grande pode levar ~1 minuto">🗜 Compactar banco agora</button>
        </div>
        <div class="admsd-grupo">
          <div class="admsd-gr-tit">${_sdSvg(SD_IC.user, 14)} Cadastros</div>
          ${linha('Médicos ativos', num(q1(`SELECT COUNT(*) FROM medicos WHERE ativo = 1`)))}
          ${linha('Procedimentos', num(q1(`SELECT COUNT(*) FROM procedimentos`)))}
          ${linha('Fotos de cálculo', num(q1(`SELECT COUNT(*) FROM vg_calc_cache`)), '', mb(q1(`SELECT COALESCE(SUM(LENGTH(payload)),0) FROM vg_calc_cache`)))}
          ${linha('Arquivo automático', arq.vinculado ? (arq.defasado ? 'defasado' : 'em dia') : 'nenhum',
                  arq.vinculado ? (arq.defasado ? 'aten' : 'bom') : 'fraco', gravadoEm || (arq.vinculado ? esc(arq.nome || '') : ''))}
        </div>
        <div class="admsd-grupo">
          <div class="admsd-gr-tit">${_sdSvg(SD_IC.relogio, 14)} Sessão atual</div>
          ${linha('Abertura do banco', Banco._fasesBoot ? fseg(Banco._fasesBoot.total) : '—',
                  Banco._fasesBoot && Banco._fasesBoot.total > 15000 ? 'aten' : '',
                  Banco._fasesBoot ? `ler ${fseg(Banco._fasesBoot.ler)} · abrir ${fseg(Banco._fasesBoot.abrir)}` : 'banco novo nesta sessão')}
          ${linha('Último salvamento', fases ? fseg((fases.export || 0) + (fases.arquivo || 0) + (fases.idbAguardo || 0)) : 'nenhum', fases ? '' : 'fraco', fases ? ('via ' + (fases.caminho || '?')) : 'nesta sessão')}
          ${linha('Travadas (sentinela)', num(tv.length), tv.length ? 'ruim' : 'bom', 'tela presa > 2,5s')}
          ${linha('Erros no log', num(nErros), nErros ? 'ruim' : 'bom')}
          ${linha('Tempo de sessão', durSessao, '', iniciada ? 'desde ' + hhmm(iniciada) : '')}
        </div>
      </div>`;

    // ── tabela de funções ──
    const cor = (ms) => ms >= 2500 ? '#c0563f' : (ms >= 1000 ? '#c08a1e' : '#1d8f5f');
    const maiorPico = agg.reduce((mx, a) => Math.max(mx, a.maxMs), 0) || 1;
    const tabHtml = agg.length ? `
      <div class="admsd-tab-wrap"><div class="admsd-tab">
        <div class="admsd-tr admsd-th"><div>Função</div><div style="text-align:right">Chamadas</div><div style="text-align:right">Tempo total</div><div style="text-align:right">Mais lenta</div><div></div></div>
        ${agg.map(a => `
          <div class="admsd-tr">
            <div class="admsd-td admsd-fn-nome" title="${esc(a.rot)}">${esc(a.rot)}</div>
            <div class="admsd-td admsd-num">${num(a.chamadas)}</div>
            <div class="admsd-td admsd-tot">${fseg(a.totalMs)}</div>
            <div class="admsd-td admsd-pico" style="color:${cor(a.maxMs)}">${fseg(a.maxMs)}</div>
            <div class="admsd-td"><div class="admsd-barra"><div style="width:${Math.max(3, Math.round(100 * a.maxMs / maiorPico))}%; background:${cor(a.maxMs)}"></div></div></div>
          </div>`).join('')}
      </div></div>` : `<div class="admsd-vazio">Nenhuma medição nesta sessão ainda — abra a Visão Geral ou recalcule algo e volte aqui.</div>`;

    el.innerHTML = `
      <div class="admsd-faixa ${estado}">
        <div class="admsd-tile">${_sdSvg(estado === 'ok' ? SD_IC.check : SD_IC.alerta, 19, 2.2)}</div>
        <div class="admsd-fx-txt">
          <div class="admsd-fx-tit">${fxTit}</div>
          <div class="admsd-fx-sub">${fxSub}</div>
        </div>
        <div class="admsd-fx-acoes">
          <button type="button" class="admsd-btn-pri" id="adm-diag-copiar">${_sdSvg(SD_IC.copiar, 14, 2.2)} Copiar relatório</button>
          ${tv.length ? `<button type="button" class="admsd-btn-sec" id="adm-diag-limpar-travadas">Limpar registro</button>` : ''}
        </div>
      </div>
      ${gruposHtml}
      <div class="admsd-funcs">
        <div class="admsd-fn-head">
          <span class="admsd-fn-tit">Funções mais pesadas nesta sessão</span>
          <span class="admsd-fn-sub">só cronômetros — nenhum dado de paciente</span>
          <span class="admsd-fn-quando">medições atualizadas ${agora.toLocaleTimeString('pt-BR')}</span>
          <button type="button" class="admsd-btn-rec" id="adm-diag-atualizar"><span style="color:#46688c; display:flex">${_sdSvg(SD_IC.refresh, 14, 2.2)}</span> Recalcular medições</button>
        </div>
        ${tabHtml}
      </div>`;

    // ── binds (vivem no renderer — a faixa re-renderiza) ──
    // V830: Compactar direto da Administração (o mesmo do Backup)
    const bcp = document.getElementById('adm-compactar');
    if (bcp) bcp.addEventListener('click', async () => {
      if (!confirm('Compactar o banco agora?\nReescreve o banco sem páginas mortas e persiste — em banco grande pode levar ~1 minuto com a tela ocupada.')) return;
      bcp.disabled = true;
      bcp.textContent = 'Compactando…';
      try {
        const r = await Banco.compactar();
        Utilidades.toast(`✓ Banco compactado: ${mb(r.antes || 0)} → ${mb(r.depois || 0)}`, 'success', 6000);
      } catch (e) {
        Utilidades.toast('Erro ao compactar: ' + (e.message || e), 'error', 6000);
      }
      App.navegarPara('administracao');
    });
    const bc = document.getElementById('adm-diag-copiar');
    if (bc) bc.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(AtlasDiagPerf.relatorioTexto());
        const antes = bc.innerHTML;
        bc.textContent = 'Relatório copiado';
        setTimeout(() => { if (bc.isConnected) bc.innerHTML = antes; }, 2000);
      } catch (e) { Utilidades.toast('Não consegui copiar automaticamente — tire um print', 'error'); }
    });
    const bl = document.getElementById('adm-diag-limpar-travadas');
    if (bl) bl.addEventListener('click', () => {
      if (!confirm(`Apagar os ${tv.length} eventos registrados?`)) return;
      AtlasDiagPerf.limparTravadas();
      renderSaudeDiag();
    });
    const br = document.getElementById('adm-diag-atualizar');
    if (br) br.addEventListener('click', () => {
      if (AtlasDiagPerf.limpar) AtlasDiagPerf.limpar();
      renderSaudeDiag();
    });
  }

  // ==========================================================================
  // APAGAR TUDO (confirmação tripla)
  // ==========================================================================

  async function apagarTudo() {
    // 1ª confirmação: detalhes do impacto
    const r = Banco.resumo();
    const total = Object.values(r).reduce((a, b) => a + b, 0);

    const c1 = confirm(
      `⚠ APAGAR TUDO?\n\n` +
      `Esta ação remove PERMANENTEMENTE todos os dados:\n` +
      `   • ${r.procedimentos} procedimentos\n` +
      `   • ${r.medicos} médicos\n` +
      `   • ${r.unidades} unidades\n` +
      `   • ${r.valores} valores de repasse\n` +
      `   • ${r.competencias} competências\n` +
      `   • ${r.importacoes} importações\n` +
      `   • Todos os vínculos\n\n` +
      `Total: ${total} registros\n\n` +
      `Faça um backup antes em Backup → Exportar arquivo .db`
    );
    if (!c1) return;

    // 2ª confirmação: digitar texto
    const txt = prompt('Digite APAGAR TUDO (em maiúsculas) para confirmar:');
    if (txt !== 'APAGAR TUDO') {
      Utilidades.toast('Cancelado', 'info');
      return;
    }

    // 3ª confirmação: senha
    const senha = prompt('Por segurança, digite sua senha de administrador:');
    if (!senha) {
      Utilidades.toast('Cancelado', 'info');
      return;
    }
    const cfg = Auth._lerConfig();
    const hash = await Auth._hash(senha);
    if (hash !== cfg.senhaHash) {
      alert('Senha incorreta. Operação cancelada.');
      return;
    }

    // Apagar
    Utilidades.mostrarLoading('Apagando tudo...');
    try {
      await Banco.resetar();
      Utilidades.esconderLoading();
      alert('✓ Banco resetado. Você foi redirecionado para a tela inicial.');
      App.navegarPara(App._primeiraTelaPermitida());   // ATLAS v1.3.4: tela inicial (a Visão Geral saiu do boot)
    } catch (e) {
      Utilidades.esconderLoading();
      alert('Erro: ' + e.message);
    }
  }
  renderizar();   // V698: no FIM — as consts do bloco 15A precisam inicializar antes (TDZ)
};
