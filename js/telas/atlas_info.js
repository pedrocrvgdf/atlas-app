/*
 * ATLAS — AtlasInfo: botão informativo (ⓘ) + MANUAL do módulo (popover).
 *
 * Lê o conteúdo de window.AtlasDocs[moduloId] e monta o popover na paleta do ATLAS.
 * Reaproveitável por qualquer tela:
 *     window.AtlasInfo.montar(tituloWrapEl, 'desempenho-opme');
 *
 * O popover é montado no document.body (porque .main tem transform e capturaria
 * position:fixed) e posicionado pelo getBoundingClientRect do botão.
 */
(function () {
  'use strict';

  const VERDE_VIVO = '#5980a6';
  let _estiloInjetado = false;
  let _pop = null;        // elemento do popover aberto (no body)
  let _btnAtual = null;   // botão que abriu o popover
  let _moduloAtual = null;

  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // **negrito** -> <strong>, *ênfase* -> <em>; o resto é escapado.
  // O negrito sai PRIMEIRO, então o itálico só vê os asteriscos que sobraram.
  function inline(txt) {
    return escapeHTML(txt)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+?)\*/g, '$1<em>$2</em>');
  }

  function injetarEstilos() {
    if (_estiloInjetado) return;
    _estiloInjetado = true;
    const st = document.createElement('style');
    st.id = 'atlas-info-estilos';
    st.textContent = `
      .atlas-btn-info {
        display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; padding: 0; margin-left: 2px;
        border: none; background: transparent; color: #B8965A; cursor: pointer;
        border-radius: 50%; line-height: 1;
        transition: background-color .15s ease, color .15s ease, transform .12s ease;
      }
      .atlas-btn-info i { font-size: 20px; line-height: 1; }
      .atlas-btn-info:hover { background: rgba(184,150,90,.14); color: #9A7B45; transform: translateY(-1px); }
      .atlas-btn-info.aberto { background: rgba(184,150,90,.18); color: #9A7B45; }

      /* V995: o popover virou o MANUAL do módulo (memória de cálculo, origem
         dos dados e passo a passo). Com muito mais texto, 430px espremia as
         fórmulas em 3 linhas cada — agora 520px e um pouco mais alto. */
      .atlas-info-pop {
        position: fixed; z-index: 4200; width: 520px; max-width: calc(100vw - 24px);
        max-height: min(80vh, 680px); overflow: hidden auto;
        background: #fff; border: none; border-radius: 14px;
        box-shadow: 0 18px 44px rgba(20,40,34,.22);
        opacity: 0; transform: translateY(-6px) scale(.99);
        transition: opacity .16s ease, transform .16s ease;
      }
      .atlas-info-pop.aberto { opacity: 1; transform: translateY(0) scale(1); }
      .atlas-info-pop::-webkit-scrollbar { width: 9px; }
      .atlas-info-pop::-webkit-scrollbar-track { background: transparent; }
      .atlas-info-pop::-webkit-scrollbar-thumb { background: #C4D8E2; border-radius: 999px; border: 2px solid #fff; }

      /* V998: o popover ⓘ passou a usar o MESMO esquema do cartão de memória
         de cálculo — degradê padrão do ATLAS no título, acentos em #3f6489 e
         #46688c no lugar do dourado. Os dois explicam a mesma coisa; não fazia
         sentido serem duas paletas. */
      .atlas-info-head {
        position: sticky; top: 0; display: flex; align-items: center; gap: 9px;
        padding: 13px 16px; color: #FFFFFF;
        background-image: linear-gradient(90deg, #5980a6 0%, #46688c 34%, #3f6489 68%, #d8e4ef 100%);
      }
      .atlas-info-head .ti-info-circle { font-size: 18px; color: #FFFFFF; }
      .atlas-info-head strong { font-size: 13.5px; letter-spacing: .02em; font-weight: 700; }
      .atlas-info-close {
        margin-left: auto; display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; border: none; border-radius: 6px; cursor: pointer;
        background: rgba(255,255,255,.14); color: #FFFFFF;
        transition: background-color .15s ease;
      }
      .atlas-info-close i { font-size: 13px; line-height: 1; }
      .atlas-info-close:hover { background: rgba(255,255,255,.20); }

      .atlas-info-body { padding: 14px 16px 16px; font-size: 12.5px; line-height: 1.55; color: #1d1f20; }
      .atlas-info-sec-tit {
        font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
        color: #46688c; margin: 0 0 4px;
      }
      .atlas-info-body p { margin: 0 0 13px; }
      .atlas-info-body ul, .atlas-info-body ol { margin: 0 0 13px; padding-left: 17px; }
      .atlas-info-body li { margin: 0 0 4px; }
      .atlas-info-sec:last-child > :last-child { margin-bottom: 0; }
      .atlas-info-gloss div { margin: 0 0 5px; }
      .atlas-info-gloss div:last-child { margin-bottom: 0; }
      /* V782: anotações do módulo (editáveis) */
      .atlas-info-notas { border-top: 1px dashed #C4D8E2; padding-top: 10px; margin-top: 12px; }
      .atlas-info-nota-edit {
        border: none; background: transparent; color: #3f6489; cursor: pointer;
        padding: 1px 4px; border-radius: 6px; margin-left: 4px; vertical-align: middle;
      }
      .atlas-info-nota-edit:hover { background: rgba(63, 100, 137,.14); color: #46688c; }
      .atlas-info-nota-view { font-size: 12.5px; line-height: 1.55; color: #1d1f20; }
      .atlas-info-nota-vazia { color: #8A98A3; font-style: italic; }
      .atlas-info-nota-txt {
        width: 100%; box-sizing: border-box; resize: vertical; min-height: 90px;
        border: 1px solid #C4D8E2; border-radius: 10px; padding: 8px 10px;
        font: inherit; font-size: 12.5px; line-height: 1.5; outline: none;
      }
      .atlas-info-nota-txt:focus { border-color: #3f6489; }
      .atlas-info-nota-acoes { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
      .atlas-info-nota-acoes button {
        border: 1px solid #C4D8E2; background: #fff; border-radius: 8px;
        padding: 5px 14px; font-size: 12px; cursor: pointer;
      }
      .atlas-info-nota-salvar { background: #3f6489 !important; border-color: #3f6489 !important; color: #fff; font-weight: 700; }
      .atlas-info-nota-salvar:hover { background: #46688c !important; }
      .atlas-info-body code { background: #F2F8FB; border-radius: 4px; padding: 0 4px; font-size: 11.5px; }

      /* ── V995: tipos de seção do manual ─────────────────────────────────── */
      /* índice — atalho pras seções, que agora são muitas */
      .atlas-info-idx { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 14px; }
      .atlas-info-idx button {
        border: 1px solid #DCE7ED; background: #F6FAFC; color: #585d62;
        border-radius: 999px; padding: 3px 9px; font-size: 10.5px; font-weight: 700;
        cursor: pointer; transition: border-color .15s ease, color .15s ease;
      }
      .atlas-info-idx button:hover { border-color: #3f6489; color: #46688c; }
      /* memória de cálculo — fórmula em fonte mono, uma por linha */
      .atlas-info-formula {
        background: #F2F8FB; border-left: 3px solid #3f6489; border-radius: 0 8px 8px 0;
        padding: 9px 11px; margin: 0 0 13px;
      }
      .atlas-info-formula > div { margin: 0 0 7px; }
      .atlas-info-formula > div:last-child { margin-bottom: 0; }
      .atlas-info-formula .fx-rot {
        display: block; font-size: 10px; font-weight: 800; letter-spacing: .05em;
        text-transform: uppercase; color: #46688c; margin-bottom: 1px;
      }
      .atlas-info-formula .fx-exp {
        display: block; font-family: var(--font-mono, ui-monospace, "SF Mono", Consolas, monospace);
        font-size: 11.5px; line-height: 1.55; color: #1d1f20; white-space: pre-wrap;
      }
      /* exemplo numérico — o mesmo cálculo com números de verdade */
      .atlas-info-exemplo {
        background: #EAF6FC; border: 1px solid #BEE2F3; border-radius: 10px;
        padding: 9px 12px; margin: 0 0 13px; color: #5980a6;
      }
      .atlas-info-exemplo div { margin: 0 0 3px; }
      .atlas-info-exemplo div:last-child { margin-bottom: 0; }
      /* passo a passo — o que o usuário precisa FAZER, na ordem */
      .atlas-info-body ol.atlas-info-passos { counter-reset: atlpasso; list-style: none; padding-left: 0; }
      .atlas-info-passos li { position: relative; padding-left: 27px; margin: 0 0 8px; }
      .atlas-info-passos li::before {
        counter-increment: atlpasso; content: counter(atlpasso);
        position: absolute; left: 0; top: 1px; width: 19px; height: 19px; border-radius: 50%;
        background: #3f6489; color: #fff; font-size: 10px; font-weight: 800;
        display: flex; align-items: center; justify-content: center;
      }
      /* V952: variante compacta do ⓘ para títulos de gráfico/ilha/card */
      .atlas-btn-info.atlas-btn-info-mini { width: 22px; height: 22px; margin-left: 5px; vertical-align: middle; }
      .atlas-btn-info.atlas-btn-info-mini i { font-size: 17px; }
      .atlas-btn-info.atlas-btn-info-claro { color: rgba(255,255,255,.88); }
      .atlas-btn-info.atlas-btn-info-claro:hover { background: rgba(255,255,255,.16); color: #fff; }
    `;
    document.head.appendChild(st);
  }

  // ── V782: ANOTAÇÕES DO MÓDULO — campo editável no popover ⓘ para registrar
  // as "dores" e decisões vividas na construção de cada módulo. Persistidas na
  // tabela modulo_notas do banco (viajam no backup, não no zip).
  function _notasTabela() {
    Banco.executar(`CREATE TABLE IF NOT EXISTS modulo_notas (
      modulo TEXT PRIMARY KEY, texto TEXT, atualizado_em TEXT)`);
  }
  function lerNota(moduloId) {
    try {
      _notasTabela();
      const r = Banco.query(`SELECT texto FROM modulo_notas WHERE modulo = ?`, [moduloId]);
      return (r && r[0] && r[0].texto) || '';
    } catch (e) { return ''; }
  }
  async function salvarNota(moduloId, texto) {
    _notasTabela();
    if (String(texto || '').trim()) {
      Banco.executar(`INSERT OR REPLACE INTO modulo_notas (modulo, texto, atualizado_em)
        VALUES (?, ?, datetime('now'))`, [moduloId, texto]);
    } else {
      Banco.executar(`DELETE FROM modulo_notas WHERE modulo = ?`, [moduloId]);
    }
    // anotação é rara e preciosa — grava o banco na hora, sem depender do debounce
    try { await Banco.salvar({ imediato: true }); } catch (e) { console.error('[AtlasInfo] salvar nota:', e); }
  }
  function notaHTML(nota) {
    return nota
      ? inline(nota).replace(/\n/g, '<br>')
      : '<span class="atlas-info-nota-vazia">Sem anotações ainda — registre aqui as dores e decisões da construção deste módulo.</span>';
  }

  function montarConteudo(doc, moduloId) {
    const secoesHTML = (doc.secoes || []).map((sec, i) => {
      let corpo = '';
      const itens = sec.conteudo || [];
      if (sec.tipo === 'paragrafo') {
        corpo = itens.map(p => `<p>${inline(p)}</p>`).join('');
      } else if (sec.tipo === 'lista') {
        corpo = `<ul>${itens.map(li => `<li>${inline(li)}</li>`).join('')}</ul>`;
      } else if (sec.tipo === 'lista-ordenada') {
        corpo = `<ol>${itens.map(li => `<li>${inline(li)}</li>`).join('')}</ol>`;
      // V995: o que o usuário precisa FAZER, na ordem (círculos numerados)
      } else if (sec.tipo === 'passos') {
        corpo = `<ol class="atlas-info-passos">${itens.map(li => `<li>${inline(li)}</li>`).join('')}</ol>`;
      // V995: memória de cálculo — ['rótulo', 'expressão'] ou só a expressão
      } else if (sec.tipo === 'formula') {
        corpo = `<div class="atlas-info-formula">${itens.map(f => {
          const rot = Array.isArray(f) ? f[0] : '';
          const exp = Array.isArray(f) ? f[1] : f;
          return `<div>${rot ? `<span class="fx-rot">${escapeHTML(rot)}</span>` : ''}<span class="fx-exp">${inline(exp)}</span></div>`;
        }).join('')}</div>`;
      // V995: o mesmo cálculo com números de verdade
      } else if (sec.tipo === 'exemplo') {
        corpo = `<div class="atlas-info-exemplo">${itens.map(l => `<div>${inline(l)}</div>`).join('')}</div>`;
      } else if (sec.tipo === 'glossario') {
        corpo = `<div class="atlas-info-gloss">${itens.map(par => {
          const t = Array.isArray(par) ? par[0] : '';
          const d = Array.isArray(par) ? par[1] : '';
          return `<div><strong>${escapeHTML(t)}</strong> — ${inline(d)}</div>`;
        }).join('')}</div>`;
      }
      return `<div class="atlas-info-sec" data-sec="${i}"><div class="atlas-info-sec-tit">${escapeHTML(sec.titulo)}</div>${corpo}</div>`;
    }).join('');
    // V995: com o manual completo são 8–10 seções — o índice evita a rolagem cega
    const secoes = doc.secoes || [];
    const indice = secoes.length >= 4
      ? `<div class="atlas-info-idx">${secoes.map((s, i) =>
          `<button type="button" data-ir="${i}">${escapeHTML(s.titulo)}</button>`).join('')}</div>`
      : '';
    // V952: docs de GRÁFICO/ILHA (Visão Geral) — cabeçalho próprio ("Como ler")
    // e sem o bloco de anotações do módulo (que é por módulo, não por gráfico)
    const cabecalho = doc.cabecalho || 'Manual do módulo';   // V995: virou manual, não só regras
    return `
      <div class="atlas-info-head">
        <i class="ti ti-info-circle" aria-hidden="true"></i>
        <strong>${escapeHTML(cabecalho)} · ${escapeHTML(doc.titulo || '')}</strong>
        <button class="atlas-info-close" type="button" aria-label="Fechar"><i class="ti ti-x" aria-hidden="true"></i></button>
      </div>
      <div class="atlas-info-body">${indice}${secoesHTML}
        <div class="atlas-info-sec atlas-info-notas" ${doc.semNotas ? 'hidden' : ''}>
          <div class="atlas-info-sec-tit">📝 Anotações do módulo
            <button class="atlas-info-nota-edit" type="button" title="Editar anotações (dores e decisões da construção)"><i class="ti ti-pencil"></i></button>
          </div>
          <div class="atlas-info-nota-view">${notaHTML(lerNota(moduloId))}</div>
          <div class="atlas-info-nota-form" hidden>
            <textarea class="atlas-info-nota-txt" rows="6"
              placeholder="Dores, decisões e aprendizados da construção deste módulo… (**negrito** funciona)"></textarea>
            <div class="atlas-info-nota-acoes">
              <button class="atlas-info-nota-salvar" type="button">Salvar</button>
              <button class="atlas-info-nota-cancelar" type="button">Cancelar</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function posicionar() {
    if (!_pop || !_btnAtual) return;
    if (!_btnAtual.isConnected) { fechar(); return; }
    const r = _btnAtual.getBoundingClientRect();
    const pw = _pop.offsetWidth, ph = _pop.offsetHeight, margem = 12;
    let left = r.left;
    if (left + pw > window.innerWidth - margem) left = window.innerWidth - margem - pw;
    if (left < margem) left = margem;
    let top = r.bottom + 8;
    if (top + ph > window.innerHeight - margem) {
      const acima = r.top - 8 - ph;
      top = acima >= margem ? acima : Math.max(margem, window.innerHeight - margem - ph);
    }
    _pop.style.left = Math.round(left) + 'px';
    _pop.style.top = Math.round(top) + 'px';
  }

  function onDocClick(e) {
    if (_pop && !_pop.contains(e.target) && _btnAtual && !_btnAtual.contains(e.target)) fechar();
  }
  function onKey(e) {
    if (e.key !== 'Escape') return;
    // V782: Escape com o editor de anotações aberto CANCELA a edição — só o
    // segundo Escape fecha o popover.
    const form = _pop && _pop.querySelector('.atlas-info-nota-form');
    if (form && !form.hidden) {
      form.hidden = true;
      const view = _pop.querySelector('.atlas-info-nota-view');
      if (view) view.hidden = false;
      e.stopPropagation();
      return;
    }
    fechar();
  }

  function fechar() {
    if (!_pop) return;
    const p = _pop;
    _pop = null;
    if (_btnAtual) _btnAtual.classList.remove('aberto');
    _btnAtual = null; _moduloAtual = null;
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', posicionar, true);
    window.removeEventListener('resize', posicionar);
    p.classList.remove('aberto');
    setTimeout(() => p.remove(), 170);
  }

  function abrir(moduloId, btn) {
    const doc = (window.AtlasDocs || {})[moduloId];
    if (!doc) { console.warn('AtlasInfo: sem documentação para o módulo', moduloId); return; }
    if (_pop && _moduloAtual === moduloId) { fechar(); return; }  // toggle
    if (_pop) fechar();
    injetarEstilos();
    _pop = document.createElement('div');
    _pop.className = 'atlas-info-pop';
    _pop.innerHTML = montarConteudo(doc, moduloId);
    document.body.appendChild(_pop);
    _btnAtual = btn; _moduloAtual = moduloId;
    btn.classList.add('aberto');
    const fechaBtn = _pop.querySelector('.atlas-info-close');
    if (fechaBtn) fechaBtn.addEventListener('click', fechar);
    // V995: índice — rola DENTRO do popover até a seção (o cabeçalho é sticky,
    // então desconta a altura dele pra não esconder o título da seção)
    _pop.querySelectorAll('.atlas-info-idx button').forEach(b => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const alvo = _pop.querySelector(`.atlas-info-sec[data-sec="${b.dataset.ir}"]`);
      if (!alvo) return;
      const head = _pop.querySelector('.atlas-info-head');
      _pop.scrollTo({ top: alvo.offsetTop - (head ? head.offsetHeight : 0) - 8, behavior: 'smooth' });
    }));
    // V782: editor das anotações do módulo
    const nView = _pop.querySelector('.atlas-info-nota-view');
    const nForm = _pop.querySelector('.atlas-info-nota-form');
    const nTxt = _pop.querySelector('.atlas-info-nota-txt');
    const abrirEditor = () => {
      nTxt.value = lerNota(moduloId);
      nForm.hidden = false; nView.hidden = true;
      nTxt.focus(); posicionar();
    };
    const fecharEditor = () => { nForm.hidden = true; nView.hidden = false; posicionar(); };
    _pop.querySelector('.atlas-info-nota-edit').addEventListener('click', () =>
      nForm.hidden ? abrirEditor() : fecharEditor());
    _pop.querySelector('.atlas-info-nota-cancelar').addEventListener('click', fecharEditor);
    _pop.querySelector('.atlas-info-nota-salvar').addEventListener('click', async () => {
      const texto = nTxt.value.trim();
      await salvarNota(moduloId, texto);
      nView.innerHTML = notaHTML(texto);
      fecharEditor();
      Utilidades.toast?.('✓ Anotações do módulo salvas', 'success', 2200);
    });
    posicionar();
    requestAnimationFrame(() => { if (_pop) { _pop.classList.add('aberto'); posicionar(); } });
    // registra os listeners de fechar DEPOIS do clique de abertura
    setTimeout(() => {
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', posicionar, true);
      window.addEventListener('resize', posicionar);
    }, 0);
  }

  // Insere o botão dourado logo APÓS o elemento de título (idempotente) e liga o clique.
  function montar(tituloEl, moduloId) {
    if (!tituloEl || !tituloEl.parentNode) return null;
    injetarEstilos();
    let btn = tituloEl.nextElementSibling;
    if (!btn || !btn.classList || !btn.classList.contains('atlas-btn-info')) {
      btn = document.createElement('button');
      btn.className = 'atlas-btn-info';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Como funciona este módulo');
      btn.title = 'Como funciona este módulo';
      btn.innerHTML = '<i class="ti ti-info-circle" aria-hidden="true"></i>';
      tituloEl.parentNode.insertBefore(btn, tituloEl.nextSibling);
    }
    btn.onclick = function (e) { e.stopPropagation(); abrir(moduloId, btn); };
    return btn;
  }

  // V952: botões DECLARATIVOS — qualquer tela pode emitir
  //   <button class="atlas-btn-info" data-atlas-info="idDoDoc">…</button>
  // no seu próprio HTML (mesmo re-renderizado a cada filtro) e o clique abre o
  // popover do doc correspondente em window.AtlasDocs. Captura: vence os
  // handlers de linha/card que embrulham o botão (ex.: linha clicável da ilha).
  function ligarBotoesDeclarativos() {
    injetarEstilos();
    document.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-atlas-info]') : null;
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      abrir(btn.getAttribute('data-atlas-info'), btn);
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligarBotoesDeclarativos);
  else ligarBotoesDeclarativos();

  window.AtlasInfo = { montar, abrir, fechar, estilos: injetarEstilos };
})();
