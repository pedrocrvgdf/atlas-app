/**
 * ============================================================================
 * ATLAS v1.3 — TELA "INSPEÇÃO" (no dock, no lugar do Calcular Repasse)
 * ============================================================================
 * A ATLAS não faz repasse — ela AUDITA o repasse que o hospital fez. Por isso
 * o botão do Calcular saiu do dock (as regras dele continuam valendo por
 * baixo: AtlasCalcular.calcularESalvar) e no lugar entra a Inspeção, com duas
 * abas:
 *   · ADMISSÃO — o rastreio de uma admissão pelas quatro bases (js/inspecao.js);
 *   · RELATÓRIO FINAL — importação dos relatórios que os médicos receberam e a
 *     auditoria do que falta pagar (js/relatorio_final.js).
 * ============================================================================
 */
(function () {
  'use strict';
  const ABA_KEY = 'atlas_insp_aba';
  let abaAtual = 'admissao';
  let montadas = { admissao: false, final: false };

  function $(id) { return document.getElementById(id); }

  function irPara(aba) {
    if (aba !== 'admissao' && aba !== 'final') return;
    abaAtual = aba;
    try { sessionStorage.setItem(ABA_KEY, aba); } catch (_) {}
    document.querySelectorAll('.insp-aba').forEach(b => b.classList.toggle('ativa', b.dataset.aba === aba));
    const admEl = $('insp-aba-admissao'), finEl = $('insp-aba-final');
    if (!admEl || !finEl) return;
    admEl.hidden = aba !== 'admissao';
    finEl.hidden = aba !== 'final';
    if (aba === 'admissao' && !montadas.admissao) {
      if (window.AtlasInspecao && AtlasInspecao.montar) { AtlasInspecao.montar(admEl); montadas.admissao = true; }
      else admEl.innerHTML = '<div class="card">Módulo Inspeção não carregado. Recarregue a página (Ctrl+Shift+R).</div>';
    }
    if (aba === 'final' && !montadas.final) {
      if (window.AtlasRelatorioFinal && AtlasRelatorioFinal.montar) { AtlasRelatorioFinal.montar(finEl); montadas.final = true; }
      else finEl.innerHTML = '<div class="card">Módulo Relatório final não carregado. Recarregue a página (Ctrl+Shift+R).</div>';
    }
  }

  /** Abre uma admissão na aba Admissão (chamado pela aba Relatório final). */
  function abrirAdmissao(adm) {
    if (App.telaAtual !== 'inspecao') {
      App.navegarPara('inspecao');
      setTimeout(() => abrirAdmissao(adm), 60);
      return;
    }
    irPara('admissao');
    if (window.AtlasInspecao && AtlasInspecao.inspecionarAdmissao) AtlasInspecao.inspecionarAdmissao(adm);
    const el = $('insp-aba-admissao');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  App.telas['inspecao'] = function () {
    const conteudo = $('conteudo');
    if (!conteudo) return;
    montadas = { admissao: false, final: false };
    Utilidades.garantirEstilos('css-tela-inspecao', CSS);
    conteudo.innerHTML = `
      <div class="page-content insp-page">
        <header class="page-header">
          <div>
            <h2>Inspeção</h2>
            <div class="subtitle">Rastreie uma admissão pelas bases da ferramenta e confronte o que o médico <strong>deveria</strong> receber com o que <strong>recebeu</strong> no relatório final — é aqui que sai o que falta pagar.</div>
          </div>
        </header>
        <div class="insp-abas" role="tablist">
          <button type="button" class="insp-aba" data-aba="admissao" role="tab"><i class="ti ti-search"></i> Admissão</button>
          <button type="button" class="insp-aba" data-aba="final" role="tab"><i class="ti ti-file-check"></i> Relatório final</button>
        </div>
        <div id="insp-aba-admissao" class="insp-aba-corpo" hidden></div>
        <div id="insp-aba-final" class="insp-aba-corpo" hidden></div>
      </div>`;
    conteudo.querySelectorAll('.insp-aba').forEach(b => b.addEventListener('click', () => irPara(b.dataset.aba)));
    let inicial = 'admissao';
    try { inicial = sessionStorage.getItem(ABA_KEY) || 'admissao'; } catch (_) {}
    irPara(inicial === 'final' ? 'final' : 'admissao');
    Utilidades.staggerEntrada?.('.insp-page .page-header, .insp-abas', { delay: 40, duracao: 300, deslocamento: 10 });
  };

  const CSS = `
    .insp-abas { display: flex; gap: 6px; margin: -6px 0 16px; flex-wrap: wrap; }
    .insp-aba {
      display: inline-flex; align-items: center; gap: 7px; font-family: inherit; font-size: 13px; font-weight: 600;
      padding: 9px 16px; border-radius: 999px; border: 1px solid var(--border, #eef0f2); background: #fff;
      color: var(--ink-soft, #585d62); cursor: pointer; transition: background .15s, color .15s, border-color .15s;
    }
    .insp-aba i { font-size: 15px; }
    .insp-aba:hover { background: var(--accent-soft, #e4eaf1); color: var(--accent-text, #3f6489); }
    .insp-aba.ativa { background: var(--primary, #5980a6); border-color: var(--primary, #5980a6); color: #fff; }
    .insp-aba-corpo[hidden] { display: none; }
  `;

  window.AtlasInspecaoTela = { irPara, abrirAdmissao };
})();
