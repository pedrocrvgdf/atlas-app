/**
 * V949: DEGRADÊ CONTÍNUO NO CABEÇALHO DE TODAS AS MATRIZES.
 *
 * O padrão global (css/style.css → `table thead th`) pinta cada título de
 * coluna com o degradê azul. Só que um gradiente é desenhado POR CÉLULA: cada
 * th reiniciaria do escuro ao claro, e o cabeçalho ficava "quebrado por
 * coluna". `background-attachment: fixed` resolvia em algumas telas, mas o
 * navegador o ignora dentro de contêineres com transform/camada própria
 * (tela da LIO, modais…) — não é confiável.
 *
 * Este módulo mede cada tabela e escreve, inline, em cada th do cabeçalho:
 *   background-size:     <largura visível do cabeçalho> x 100%
 *   background-position: -<distância da célula até a esquerda visível> 0
 * Assim cada célula mostra exatamente a SUA fatia e o conjunto vira um único
 * degradê da esquerda à direita da largura visível (em tabelas com rolagem
 * horizontal o cabeçalho na tela sempre vai do escuro ao claro; ao rolar, as
 * colunas assumem a cor da posição em que estão — escolha do usuário).
 *
 * Refaz-se sozinho: render de tela (MutationObserver no body), resize da
 * janela/tabela (ResizeObserver) e rolagem horizontal (scroll em captura).
 * Tudo coalescido num requestAnimationFrame — custo desprezível.
 */
(function () {
  'use strict';

  const OBS_TABELAS = new WeakSet();
  let _agendado = false;
  let _ro = null;

  function contenedorRolagem(tab) {
    // primeiro ancestral que rola na horizontal (overflow-x auto/scroll)
    let el = tab.parentElement;
    while (el && el !== document.body) {
      const ov = getComputedStyle(el).overflowX;
      if (ov === 'auto' || ov === 'scroll') return el;
      el = el.parentElement;
    }
    return null;
  }

  function alinharTabela(tab) {
    const ths = tab.querySelectorAll(':scope > thead th');
    if (!ths.length) return;
    const rt = tab.getBoundingClientRect();
    if (!rt.width) return;                       // tabela oculta — nada a medir
    const cont = contenedorRolagem(tab);
    let esq = rt.left, larg = rt.width;
    if (cont) {
      const rc = cont.getBoundingClientRect();
      const visEsq = rc.left + cont.clientLeft;
      const visLarg = cont.clientWidth;
      if (rt.width > visLarg) { esq = visEsq; larg = visLarg; }   // mais larga que a janela de rolagem
    }
    larg = Math.round(larg);
    for (const th of ths) {
      const x = Math.round(th.getBoundingClientRect().left - esq);
      const size = larg + 'px 100%', pos = (-x) + 'px 0px';
      if (th.style.backgroundSize !== size) th.style.backgroundSize = size;
      if (th.style.backgroundPosition !== pos) th.style.backgroundPosition = pos;
    }
  }

  function alinhar(raiz) {
    const tabs = (raiz && raiz.querySelectorAll ? raiz : document).querySelectorAll('table');
    for (const tab of tabs) {
      if (tab.tHead) alinharTabela(tab);
      if (_ro && !OBS_TABELAS.has(tab)) { OBS_TABELAS.add(tab); _ro.observe(tab); }
    }
    if (raiz && raiz.tagName === 'TABLE') alinharTabela(raiz);
  }

  function agendar(raiz) {
    if (_agendado) return;
    _agendado = true;
    requestAnimationFrame(() => { _agendado = false; try { alinhar(raiz); } catch (_) {} });
  }

  function iniciar() {
    if (typeof ResizeObserver !== 'undefined') _ro = new ResizeObserver(() => agendar());
    new MutationObserver(() => agendar()).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', () => agendar());
    // rolagem horizontal de qualquer contêiner (captura — os wrappers não borbulham)
    document.addEventListener('scroll', (e) => {
      const alvo = e.target;
      if (alvo === document || !alvo.querySelector) { agendar(); return; }
      if (alvo.querySelector('table')) agendar(alvo);
    }, true);
    agendar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  window.AtlasCabecalho = { alinhar: () => alinhar(), alinharTabela };
})();
