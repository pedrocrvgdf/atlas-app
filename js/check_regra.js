/* ============================================================================
 * V642: CHECK DE REGRA — simulador de linha da matriz de Relatórios.
 * Módulo GLOBAL (carrega no boot): abre de qualquer tela via
 * window.AtlasCheckRegra.abrir() — hoje no leque dos Relatórios e no FAB da
 * Base Tabela. Preenche-se uma linha com as MESMAS colunas do Consolidado;
 * a cada tecla o MOTOR REAL do Calcular (AtlasSimulador) aplica a regra e
 * mostra Status, Valor e V.TAB — o check preventivo de qual versão paga.
 * ============================================================================ */
(function () {
  const escapeHTML = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CSS = `
    .ckr-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(20, 51, 82, 0.35);
      display: flex; align-items: center; justify-content: center;
    }
    .ckr-modal {
      background: var(--bg-elevated, #FFF);
      border: 1px solid var(--border, #dfe4ea);
      border-radius: var(--radius-md, 10px);
      box-shadow: 0 12px 40px rgba(0,0,0,0.18);
      padding: 22px; width: min(1240px, 96vw); max-height: 92vh; overflow: auto;
    }
    .ckr-modal .btn {
      padding: 8px 16px; border: 1px solid var(--border, #dfe4ea); border-radius: 8px;
      background: var(--bg-sunken, #F5F5F5); color: var(--ink, #222);
      font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
    }
    .ckr-modal .btn:hover { background: var(--bg-elevated, #FFF); }
  `;

  function abrir() {
    // O motor (AtlasSimulador) é definido pelo corpo da tela Calcular, que só
    // roda na primeira navegação até ela. Se o usuário ainda não passou pelo
    // Calcular nesta sessão, inicializa a tela num sandbox INVISÍVEL — define
    // o simulador sem tocar na tela atual.
    if (!window.AtlasSimulador && window.App && App.telas && App.telas['calcular']) {
      const real = document.getElementById('conteudo');
      const sandbox = document.createElement('div');
      sandbox.style.display = 'none';
      try {
        if (real) real.id = 'conteudo-real-tmp';
        sandbox.id = 'conteudo';
        document.body.appendChild(sandbox);
        App.telas['calcular']();
      } catch (e) { console.warn('[check-regra] bootstrap do simulador:', e); }
      finally {
        sandbox.remove();
        if (real) real.id = 'conteudo';
      }
    }
    const S = window.AtlasSimulador;
    if (!S) { Utilidades.toast?.('Motor do Calcular não carregado. Recarregue a página.', 'error', 4000); return; }
    Utilidades.garantirEstilos && Utilidades.garantirEstilos('css-check-regra', CSS);
    const papeis = S.papeis();
    const procs = S.procedimentos();
    const fmtN = (n) => Utilidades.formatarNumero(Number(n) || 0, 2);
    const optsPapel = ['<option value="">—</option>']
      .concat(papeis.map(p => `<option value="${p.id}">${escapeHTML(p.nome)}</option>`)).join('');
    const datalist = procs.map(p => `<option value="${escapeHTML(p)}"></option>`).join('');
    const th = 'padding:6px 8px;background:#143352;color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap';
    const td = 'padding:6px 6px;border-bottom:1px solid #E5E5E5;vertical-align:middle';
    const inp = 'width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #D8D8D8;border-radius:6px;font-size:12.5px;background:#fff;color:#222';
    const ov = document.createElement('div');
    ov.className = 'ckr-overlay';
    ov.innerHTML = `
      <div class="ckr-modal">
        <h3 style="margin: 0 0 6px">🧪 Check de regra — Versão da Tabela</h3>
        <p style="font-size: 13px; color: var(--ink-soft); margin: 0 0 12px">
          Preencha a linha como ela apareceria na matriz dos <strong>Relatórios</strong>. A cada
          preenchimento o <strong>motor real do Calcular</strong> aplica a regra e mostra o
          <strong>Status</strong>, o <strong>Valor</strong> e a <strong>V.TAB</strong> (versão da
          Base Tabela aplicada pela <em>data da admissão</em>) — um check preventivo antes de
          calcular o mês. Os campos que decidem a regra são <strong>Data</strong>, <strong>Papel</strong>,
          <strong>Origem</strong>, <strong>Descrição</strong> e <strong>Produzido</strong>; os demais
          são ilustrativos.
        </p>
        <datalist id="bt-check-procs">${datalist}</datalist>
        <div style="overflow-x: auto">
          <table style="width:100%; border-collapse: collapse; min-width: 1080px">
            <thead><tr>
              <th style="${th}">Status</th><th style="${th}">Módulo</th><th style="${th}">Admissão</th>
              <th style="${th}">Data *</th><th style="${th}">Papel *</th><th style="${th}">Profissional</th>
              <th style="${th}">Paciente</th><th style="${th}">Origem *</th><th style="${th}">Convênio</th>
              <th style="${th}; min-width: 240px">Descrição (procedimento) *</th>
              <th style="${th}">Produzido</th><th style="${th}">Valor</th><th style="${th}">V.TAB</th>
            </tr></thead>
            <tbody><tr>
              <td style="${td}; text-align:center"><span id="bt-check-status" style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:#E5E7EA;color:#6B7280">—</span></td>
              <td style="${td}; font-size:12.5px; color:var(--ink-soft)">Repasse</td>
              <td style="${td}"><input id="bt-check-adm" style="${inp}; width:110px" placeholder="00000000"></td>
              <td style="${td}"><input id="bt-check-data" type="date" style="${inp}; width:140px"></td>
              <td style="${td}"><select id="bt-check-papel" style="${inp}; width:140px">${optsPapel}</select></td>
              <td style="${td}"><input id="bt-check-prof" style="${inp}; width:150px" placeholder="(opcional)"></td>
              <td style="${td}"><input id="bt-check-pac" style="${inp}; width:130px" placeholder="(opcional)"></td>
              <td style="${td}">
                <select id="bt-check-origem" style="${inp}; width:130px">
                  <option value="CONVENIO">CONVÊNIO</option>
                  <option value="PARTICULAR">PARTICULAR</option>
                  <option value="SUS">SUS</option>
                </select>
              </td>
              <td style="${td}"><input id="bt-check-conv" style="${inp}; width:140px" placeholder="(opcional)"></td>
              <td style="${td}"><input id="bt-check-proc" list="bt-check-procs" style="${inp}; min-width:240px" placeholder="Digite o procedimento…"></td>
              <td style="${td}"><input id="bt-check-prod" type="number" step="0.01" min="0" style="${inp}; width:110px" placeholder="0,00"></td>
              <td style="${td}; text-align:right"><strong id="bt-check-valor" class="mono" style="font-size:13px">—</strong></td>
              <td style="${td}; text-align:center"><span id="bt-check-vtab" style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:#E5E7EA;color:#6B7280">—</span></td>
            </tr></tbody>
          </table>
        </div>
        <div id="bt-check-res" style="margin-top: 12px; padding: 12px 14px; border: 1px solid var(--linha, #E5E5E5); border-radius: 10px; font-size: 13px; line-height: 1.7; color: var(--ink-soft)">
          Preencha <strong>Data</strong>, <strong>Papel</strong>, <strong>Origem</strong> e a
          <strong>Descrição</strong> pra ver a regra aplicada.
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px">
          <button class="btn" id="bt-check-fechar">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#bt-check-fechar').addEventListener('click', () => ov.remove());
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });

    const $ = (id) => ov.querySelector('#' + id);
    const badge = (el, txt, bg, fg) => { el.textContent = txt; el.style.background = bg; el.style.color = fg; };
    const aplicar = () => {
      const data = $('bt-check-data').value;
      const papelId = $('bt-check-papel').value;
      const origem = $('bt-check-origem').value;
      const proc = $('bt-check-proc').value.trim();
      const prod = parseFloat($('bt-check-prod').value) || 0;
      const stEl = $('bt-check-status'), vtEl = $('bt-check-vtab'), vlEl = $('bt-check-valor'), resEl = $('bt-check-res');
      if (!proc || !papelId) {
        badge(stEl, '—', '#E5E7EA', '#6B7280'); badge(vtEl, '—', '#E5E7EA', '#6B7280');
        vlEl.textContent = '—';
        resEl.innerHTML = 'Preencha <strong>Data</strong>, <strong>Papel</strong>, <strong>Origem</strong> e a <strong>Descrição</strong> pra ver a regra aplicada.';
        return;
      }
      let r;
      try { r = S.simular({ dataAdmissao: data, procedimento: proc, papelId, origem, produzido: prod }); }
      catch (e) { resEl.innerHTML = '⚠ Erro ao simular: ' + escapeHTML(e.message || String(e)); return; }
      const linhas = [];
      if (r.versao != null) {
        badge(vtEl, 'v' + r.versao, '#143352', '#FFFFFF');
        linhas.push(`📌 <strong>Versão aplicada: v${escapeHTML(String(r.versao))}</strong> — vigente para a data ${data ? escapeHTML(data.split('-').reverse().join('/')) : '(sem data → última publicada)'}.`);
      } else {
        badge(vtEl, 'viva', '#6B7280', '#FFFFFF');
        linhas.push('📌 <strong>Nenhuma versão publicada</strong> — vale a tabela viva.');
      }
      if (!r.temProc) {
        badge(stEl, 'NOVO', '#C18A4A', '#FFFFFF');
        vlEl.textContent = 'R$ 0,00';
        linhas.push('⚠ <strong>Procedimento não cadastrado</strong> na Base Tabela (nem por sinônimo) — a linha sairia como <strong>NOVO</strong>, sem repasse.');
      } else {
        const matchTxt = r.matchTipo === 'exato' ? 'match exato' : r.matchTipo === 'sinonimo' ? 'via sinônimo' : `match ${escapeHTML(String(r.matchTipo || ''))}`;
        linhas.push(`🩺 Procedimento reconhecido: <strong>${escapeHTML(r.procOficial)}</strong> (${matchTxt}).`);
        if (r.semRegra) {
          badge(stEl, 'SEM REGRA', '#9B3A3A', '#FFFFFF');
          vlEl.textContent = 'R$ 0,00';
          linhas.push(`⚠ <strong>Sem regra</strong> pra este papel + origem ${r.versao != null ? `na versão v${escapeHTML(String(r.versao))} (nem na tabela viva como regra inédita)` : 'na tabela viva'} — a linha não seria paga.`);
        } else {
          badge(stEl, '✓ CASOU', '#1F7A5C', '#FFFFFF');
          vlEl.textContent = 'R$ ' + fmtN(r.repasse);
          const regraTxt = r.regra.valor != null
            ? `R$ ${fmtN(r.regra.valor)} fixo`
            : `${fmtN((r.regra.percentual || 0) * 100)}% sobre o produzido (R$ ${fmtN(prod)})`;
          linhas.push(`💰 Regra aplicada: <strong>${regraTxt}</strong> → repasse <strong>R$ ${fmtN(r.repasse)}</strong>.`);
          if (r.viaViva) {
            linhas.push('🔎 Fonte da regra: <strong>tabela VIVA</strong> — regra ainda não publicada em versão alguma (procedimento/regra novos valem em qualquer data). Ao publicar a próxima versão ela ganha vigência.');
          } else if (r.versao != null) {
            linhas.push(`🔎 Fonte da regra: <strong>versão congelada v${escapeHTML(String(r.versao))}</strong>.`);
          }
        }
      }
      if (!data) linhas.push('ℹ Sem a <strong>Data</strong>, o motor usa a última versão publicada — preencha a data da admissão pra validar a vigência.');
      resEl.innerHTML = linhas.join('<br>');
    };
    ['bt-check-data', 'bt-check-papel', 'bt-check-origem', 'bt-check-proc', 'bt-check-prod']
      .forEach(id => { const el = $(id); el.addEventListener('input', aplicar); el.addEventListener('change', aplicar); });
  }

  window.AtlasCheckRegra = { abrir };
})();
