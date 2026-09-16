/**
 * ATLAS — Linha do tempo do repasse (V590/V591)
 * V591: esteira alinhada à ESQUERDA (abre na ponta recente via scrollLeft),
 * faixa slim (trilho 70px) e balão de hover num elemento único fixed no body.
 * Faixa horizontal de marcos no topo da Visão Geral: registra os eventos que
 * mudam o cálculo do repasse (mudança de regra, entrada/saída de médico,
 * contrato/convênio, auditoria).
 *
 * Design: handoff "9D — faixa em degradê com alfinetes de mapa" (Claude
 * Design). Faixa em degradê marinho→ciano, alfinetes 24px com ícone da
 * categoria, balão de hover com o título, esteira que abre na ponta mais
 * recente (truque direction:rtl, sem script).
 *
 * Fluxo (mantém a V573): clicar no alfinete abre o modal do evento com a
 * DESCRIÇÃO editável e os ANEXOS (padrão 9D); o lápis no topo abre a edição
 * completa (título/data/categoria/impacto/sinal/responsável) — onde também
 * dá pra escolher o ÍCONE (forma) do marco (V590, coluna `icone`).
 *
 * Persistência 100% local: tabelas `timeline_eventos` e `timeline_docs`
 * (documentos gravados em base64 para abrir/baixar offline).
 *
 * API pública (window.AtlasLinhaTempo): montar(containerId)
 */
(function () {
  'use strict';

  const PASSO = 96;         // distância entre marcos (handoff 9D)
  const X0 = 48;            // x do primeiro marco
  // Categorias — cor do alfinete + tint/texto do chip do modal (handoff 9D)
  const CATS = {
    regra:     { nome: 'Mudança de regra',   cor: '#1d4470', tint: '#f0f4f8', texto: '#143352' },
    entrada:   { nome: 'Entrada de médico',  cor: '#1d8f5f', tint: '#e7f6ee', texto: '#166b48' },
    saida:     { nome: 'Saída de médico',    cor: '#c0563f', tint: '#fbeeea', texto: '#9c3d29' },
    contrato:  { nome: 'Contrato / convênio', cor: '#7a5cc4', tint: '#f0ecfa', texto: '#5b429c' },
    auditoria: { nome: 'Auditoria e glosa',  cor: '#c08a1e', tint: '#fbf3e2', texto: '#8f6511' },
  };
  // V590: formas disponíveis para o marco (Lucide, path único). As 5 primeiras
  // são os ícones-padrão das categorias; as demais são opções extras do
  // seletor no pop-up de edição. `ev.icone` guarda a chave; vazio = automático
  // (segue a categoria).
  const ICONES = {
    regra:      { nome: 'Lápis',      d: 'M4 20h5M6.5 16.5 16 7l3 3-9.5 9.5H6.5zM4 4h9' },
    entrada:    { nome: 'Entrada',    d: 'M13 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M7.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M18 9v6M15 12h6' },
    saida:      { nome: 'Saída',      d: 'M13 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M7.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M15 12h6' },
    contrato:   { nome: 'Documento',  d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4' },
    auditoria:  { nome: 'Lupa',       d: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M16.5 16.5 21 21' },
    bandeira:   { nome: 'Bandeira',   d: 'M4 22v-7M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z' },
    estrela:    { nome: 'Estrela',    d: 'm12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3 1.2-6.9-5-4.9 6.9-1z' },
    alerta:     { nome: 'Alerta',     d: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' },
    cifrao:     { nome: 'Cifrão',     d: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
    calendario: { nome: 'Calendário', d: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
    sino:       { nome: 'Sino',       d: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0' },
  };
  const SINAIS = { alta: 'Alta', baixa: 'Baixa', neutro: 'Neutro' };
  const SINAL_COR = { alta: '#1d8f5f', baixa: '#c0563f', neutro: '#5a6879' };

  let _sel = null;      // id do evento selecionado
  let _contId = null;

  // ── util ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const MESES_C = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MESES_L = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                   'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function fmtCurta(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return iso || '';
    return `${m[3]} ${MESES_C[+m[2] - 1]}/${m[1].slice(2)}`;   // 9D: "12 ago/25"
  }
  function fmtLonga(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return iso || '';
    return `${+m[3]} de ${MESES_L[+m[2] - 1]} de ${m[1]}`;
  }
  function fmtTamanho(bytes) {
    const b = Number(bytes) || 0;
    if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
    return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  }
  function toast(msg, tipo, ms) {
    try { window.Utilidades && window.Utilidades.toast && window.Utilidades.toast(msg, tipo || 'info', ms || 2400); } catch (e) {}
  }
  function catDe(ev) { return CATS[ev.categoria] || CATS.regra; }
  // chave do ícone do evento: escolhido no editor, senão o da categoria
  function iconeDe(ev) {
    if (ev && ev.icone && ICONES[ev.icone]) return ev.icone;
    return CATS[ev && ev.categoria] ? ev.categoria : 'regra';
  }
  function svgIcone(chave, cor, tam, extra) {
    const ic = ICONES[chave] || ICONES.regra;
    return `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="${cor}"
      stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra || ''}><path d="${ic.d}"></path></svg>`;
  }

  // ── dados ─────────────────────────────────────────────────────────────
  let _tabelasOk = false;
  function garantirTabelas() {
    if (_tabelasOk) return;
    try {
      // db.exec (não Banco.executar) — múltiplas instruções num só bloco
      window.Banco.db.exec(`
        CREATE TABLE IF NOT EXISTS timeline_eventos (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          data        TEXT NOT NULL,
          categoria   TEXT NOT NULL DEFAULT 'regra',
          titulo      TEXT NOT NULL,
          descricao   TEXT,
          impacto     TEXT,
          sinal       TEXT NOT NULL DEFAULT 'neutro',
          responsavel TEXT,
          criado_em   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          editado_em  TEXT
        );
        CREATE TABLE IF NOT EXISTS timeline_docs (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          evento_id INTEGER NOT NULL,
          nome      TEXT NOT NULL,
          tamanho   INTEGER,
          tipo      TEXT,
          conteudo  TEXT,
          criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_tl_docs_ev ON timeline_docs(evento_id);
      `);
      // V590: coluna `icone` (forma escolhida do marco) — migração leve
      const cols = window.Banco.query(`PRAGMA table_info(timeline_eventos)`) || [];
      if (!cols.some(c => c.name === 'icone')) {
        window.Banco.db.exec(`ALTER TABLE timeline_eventos ADD COLUMN icone TEXT`);
      }
      _tabelasOk = true;
    } catch (e) { console.error('[linha-tempo] tabelas:', e); }
  }
  function listar() {
    garantirTabelas();
    try {
      return window.Banco.query(`
        SELECT e.*, (SELECT COUNT(*) FROM timeline_docs d WHERE d.evento_id = e.id) AS n_docs
          FROM timeline_eventos e
         ORDER BY e.data ASC, e.id ASC`) || [];
    } catch (e) { return []; }
  }
  function evento(id) {
    garantirTabelas();
    try { return window.Banco.queryUnica(`SELECT * FROM timeline_eventos WHERE id = ?`, [id]); }
    catch (e) { return null; }
  }
  function docsDe(id) {
    garantirTabelas();
    try { return window.Banco.query(`SELECT id, nome, tamanho, tipo FROM timeline_docs WHERE evento_id = ? ORDER BY id`, [id]) || []; }
    catch (e) { return []; }
  }
  async function criar(ev) {
    garantirTabelas();
    window.Banco.executar(
      `INSERT INTO timeline_eventos (data, categoria, titulo, descricao, impacto, sinal, responsavel, icone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ev.data, ev.categoria || 'regra', ev.titulo || 'Novo evento sem título',
       ev.descricao || null, ev.impacto || null, ev.sinal || 'neutro', ev.responsavel || null, ev.icone || null]);
    const r = window.Banco.queryUnica(`SELECT last_insert_rowid() AS id`);
    await window.Banco.salvar();
    return r ? r.id : null;
  }
  async function salvarEvento(id, ev) {
    garantirTabelas();
    window.Banco.executar(
      `UPDATE timeline_eventos SET data = ?, categoria = ?, titulo = ?, descricao = ?,
              impacto = ?, sinal = ?, responsavel = ?, icone = ?, editado_em = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [ev.data, ev.categoria, ev.titulo, ev.descricao || null,
       ev.impacto || null, ev.sinal || 'neutro', ev.responsavel || null, ev.icone || null, id]);
    await window.Banco.salvar();
  }
  // V590: o modal do evento (padrão 9D) grava só a descrição
  async function salvarDescricao(id, desc) {
    garantirTabelas();
    window.Banco.executar(
      `UPDATE timeline_eventos SET descricao = ?, editado_em = CURRENT_TIMESTAMP WHERE id = ?`,
      [desc || null, id]);
    await window.Banco.salvar();
  }
  async function removerEvento(id) {
    garantirTabelas();
    window.Banco.executar(`DELETE FROM timeline_docs WHERE evento_id = ?`, [id]);
    window.Banco.executar(`DELETE FROM timeline_eventos WHERE id = ?`, [id]);
    await window.Banco.salvar();
  }
  async function anexar(eventoId, arquivo, conteudoB64) {
    garantirTabelas();
    window.Banco.executar(
      `INSERT INTO timeline_docs (evento_id, nome, tamanho, tipo, conteudo) VALUES (?, ?, ?, ?, ?)`,
      [eventoId, arquivo.name, arquivo.size, arquivo.type || '', conteudoB64 || null]);
    await window.Banco.salvar();
  }
  async function removerDoc(docId) {
    garantirTabelas();
    window.Banco.executar(`DELETE FROM timeline_docs WHERE id = ?`, [docId]);
    await window.Banco.salvar();
  }
  function baixarDoc(docId) {
    try {
      const d = window.Banco.queryUnica(`SELECT nome, conteudo, tipo FROM timeline_docs WHERE id = ?`, [docId]);
      if (!d || !d.conteudo) { toast('Documento sem conteúdo salvo.', 'error'); return; }
      const a = document.createElement('a');
      a.href = d.conteudo; a.download = d.nome || 'documento';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { toast('Erro ao abrir o documento.', 'error'); }
  }

  // ── faixa (9D) ────────────────────────────────────────────────────────
  function montar(contId) {
    _contId = contId || _contId;
    injetarEstilos();
    document.getElementById('tl-lupa-pop')?.remove();   // V693: popover de outra visita
    render();
  }

  // V690: filtro por mês/ano (lupa acima do "+ Evento") — quando a linha do
  // tempo cresce, dá pra enxergar só uma competência específica.
  // V693: a lupa também busca por TÍTULO ("BASE TABELA" acha "BASE TABELA -
  // VERSÃO"), sem acento e sem caixa, combinável com o filtro de mês.
  let _filtroMes = null;    // 'YYYY-MM' | null
  let _filtroTexto = '';    // trecho do título
  const _MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function _rotuloMes(am) {
    const m = /^(\d{4})-(\d{2})$/.exec(am || '');
    return m ? (_MES_CURTO[(+m[2]) - 1] || m[2]) + '/' + m[1].slice(2) : am;
  }
  const _tlSemAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function _filtrarEvs(evsTodos) {
    const q = _tlSemAcento(_filtroTexto).trim();
    return evsTodos.filter(e =>
      (!_filtroMes || String(e.data || '').slice(0, 7) === _filtroMes) &&
      (!q || _tlSemAcento(e.titulo).indexOf(q) >= 0));
  }
  function _rotuloFiltro() {
    const partes = [];
    if (_filtroMes) partes.push(_rotuloMes(_filtroMes));
    if (_tlSemAcento(_filtroTexto).trim()) partes.push(`"${_filtroTexto.trim()}"`);
    return partes.join(' · ');
  }

  function render() {
    const cont = document.getElementById(_contId);
    if (!cont) return;
    const evsTodos = listar();
    const temFiltro = !!(_filtroMes || _tlSemAcento(_filtroTexto).trim());
    const evs = temFiltro ? _filtrarEvs(evsTodos) : evsTodos;
    const hoje = hojeISO();
    const nPassados = evs.filter(e => e.data <= hoje).length;
    const trilhoW = evs.length * PASSO + 40;
    const hojeX = X0 + Math.max(nPassados - 1, 0) * PASSO + PASSO / 2;

    const marcos = evs.map((e, i) => {
      const x = X0 + i * PASSO;
      const cat = catDe(e);
      const passado = e.data <= hoje;
      const sel = _sel === e.id;
      const cheio = sel || passado;                       // 9D: passado/selecionado = branco
      // V692: sinal ALTA (importante) = SINAL DE ALERTA — o pino fica #B8965A
      const alta = String(e.sinal || '') === 'alta';
      const fundo = cheio ? (alta ? '#B8965A' : '#fff') : (alta ? 'rgba(184,150,90,.4)' : 'rgba(255,255,255,.16)');
      const borda = alta ? '#B8965A' : (cheio ? '#fff' : 'rgba(255,255,255,.75)');
      const corIco = cheio ? (alta ? '#fff' : cat.cor) : '#fff';
      const corData = alta ? '#B8965A' : (sel ? '#fff' : 'rgba(255,255,255,.86)');
      return `
        <div class="tl-col" style="left:${x}px">
          <button type="button" class="tl-marco ${alta ? 'tl-marco-alta' : ''}" data-tl-ev="${e.id}"
                  style="background:${fundo}; border-color:${borda}"
                  aria-label="${esc(fmtCurta(e.data))} · ${esc(cat.nome)} — ${esc(e.titulo)}${alta ? ' (sinal ALTA)' : ''}">
            ${svgIcone(iconeDe(e), corIco, 12, ' style="transform: rotate(45deg)"')}
          </button>
          <span class="tl-data" style="color:${corData}; ${alta ? 'font-weight:800' : ''}">${esc(fmtCurta(e.data))}</span>
        </div>`;
    }).join('');

    cont.innerHTML = `
      <section class="tl-faixa">
        <div class="tl-fixo">
          <span class="tl-fixo-rot">Linha do tempo<button type="button" class="atlas-btn-info atlas-btn-info-mini atlas-btn-info-claro tl-info"
            data-atlas-info="vg-linha-tempo" data-no-hub title="Como ler: o que é a linha do tempo e o que ela registra"
            aria-label="Como ler a linha do tempo"><i class="ti ti-info-circle" aria-hidden="true"></i></button></span>
          <span class="tl-fixo-n">${temFiltro
            ? `${evs.length} de ${evsTodos.length} · ${esc(_rotuloFiltro())}`
            : `${evs.length} ${evs.length === 1 ? 'evento' : 'eventos'}`}</span>
        </div>
        ${evs.length ? `
        <div class="tl-scroller">
          <div class="tl-trilho" style="width:${trilhoW}px">
            <div class="tl-linha"></div>
            ${nPassados > 0 ? `<div class="tl-progresso" style="width:${Math.max(hojeX - 8, 0)}px"></div>` : ''}
            ${nPassados > 0 ? `
              <div class="tl-hoje" style="left:${hojeX}px"></div>
              <div class="tl-hoje-rot" style="left:${hojeX}px">Hoje</div>` : ''}
            ${marcos}
          </div>
        </div>` : (temFiltro ? `
        <div class="tl-vazio">Nenhum evento com ${esc(_rotuloFiltro())}. Clique na lupa para trocar ou limpar o filtro.</div>` : `
        <div class="tl-vazio">Nenhum evento registrado. Use <b>+ Evento</b> para marcar mudanças de regra,
          entrada/saída de médicos, contratos e auditorias que afetam o repasse.</div>`)}
        <!-- V711: a lupa mora no CANTO SUPERIOR DIREITO da faixa -->
        <button type="button" class="tl-lupa ${temFiltro ? 'on' : ''}" data-tl-lupa
                title="${temFiltro ? 'Filtrando ' + esc(_rotuloFiltro()) + ' — clique para trocar/limpar' : 'Filtrar a linha do tempo por título ou mês/ano'}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
        <div class="tl-acao-col">
          <button type="button" class="tl-novo" data-tl-novo>+ Evento</button>
        </div>
      </section>`;

    // V591: esteira aberta na ponta mais recente (conteúdo curto fica à
    // ESQUERDA, colado no bloco fixo — o truque de direction:rtl alinhava
    // tudo à direita quando não havia rolagem)
    const sc = cont.querySelector('.tl-scroller');
    if (sc) sc.scrollLeft = sc.scrollWidth;

    // balão de hover controlado por estado (não CSS :hover) com delay de 120ms.
    // V591: balão ÚNICO no document.body com position:fixed — não ocupa altura
    // no trilho (faixa slim), não é cortado pela esteira e não sofre o desvio
    // de fixed dentro de ancestral com transform (.tl-col é transformado).
    let balao = document.getElementById('tl-balao-flutuante');
    if (!balao) {
      balao = document.createElement('div');
      balao.id = 'tl-balao-flutuante';
      balao.className = 'tl-balao';
      document.body.appendChild(balao);
    }
    const mapEvs = new Map(evs.map(e => [String(e.id), e]));
    let tHover = null;
    const esconderBalao = () => balao.classList.remove('on');
    esconderBalao();
    if (sc) sc.addEventListener('scroll', esconderBalao, { passive: true });
    cont.querySelectorAll('.tl-col').forEach(col => {
      col.addEventListener('mouseenter', () => {
        clearTimeout(tHover);
        tHover = setTimeout(() => {
          const pino = col.querySelector('.tl-marco');
          const e = pino ? mapEvs.get(pino.dataset.tlEv) : null;
          if (!pino || !e) return;
          const cat = catDe(e);
          balao.innerHTML = `
            <span class="tl-balao-cat" style="color:${cat.cor}"><span class="tl-balao-pt" style="background:${cat.cor}"></span>${esc(cat.nome)}</span>
            <span class="tl-balao-tit">${esc(e.titulo)}</span>`;
          const r = pino.getBoundingClientRect();
          const cx = Math.max(118, Math.min(r.left + r.width / 2, window.innerWidth - 118));
          balao.style.left = `${cx}px`;
          balao.style.top = `${r.bottom + 30}px`;   // abaixo da data
          balao.classList.add('on');
        }, 120);
      });
      col.addEventListener('mouseleave', () => { clearTimeout(tHover); esconderBalao(); });
    });

    cont.querySelectorAll('[data-tl-ev]').forEach(b => {
      b.addEventListener('click', () => { _sel = parseInt(b.dataset.tlEv, 10); render(); abrirModalVer(_sel); });   // V573: marco abre a visualização
    });
    // V690/V693: lupa → popover com BUSCA POR TÍTULO + meses/anos com eventos.
    // O popover vive no document.body e NÃO é destruído pelo re-render da
    // faixa — digitar filtra os marcos ao vivo sem o campo perder o foco.
    const bl = cont.querySelector('[data-tl-lupa]');
    if (bl) bl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const aberto = document.getElementById('tl-lupa-pop');
      if (aberto) { aberto.remove(); return; }
      const meses = [...new Set(evsTodos.map(e => String(e.data || '').slice(0, 7)).filter(m => /^\d{4}-\d{2}$/.test(m)))].sort().reverse();
      const pop = document.createElement('div');
      pop.id = 'tl-lupa-pop';
      pop.className = 'tl-lupa-pop';
      pop.innerHTML = `
        <div class="tl-lupa-tit">Filtrar a linha do tempo</div>
        <div class="tl-lupa-busca">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="tl-lupa-inp" placeholder="Buscar por título…" autocomplete="off" value="${esc(_filtroTexto)}">
          <button type="button" id="tl-lupa-inp-x" title="Limpar busca" style="${_tlSemAcento(_filtroTexto).trim() ? '' : 'display:none'}">✕</button>
        </div>
        <div class="tl-lupa-lista">
          <button type="button" class="tl-lupa-it ${!_filtroMes ? 'sel' : ''}" data-tl-mes="">Todos os meses</button>
          ${meses.map(m => `<button type="button" class="tl-lupa-it ${_filtroMes === m ? 'sel' : ''}" data-tl-mes="${esc(m)}">${esc(_rotuloMes(m))}<span class="tl-lupa-qt">${evsTodos.filter(e => String(e.data || '').slice(0, 7) === m).length}</span></button>`).join('')}
        </div>`;
      document.body.appendChild(pop);
      // fixed no body (a faixa vive sob ancestral com transform — mesmo motivo do balão)
      const r = bl.getBoundingClientRect();
      pop.style.top = `${r.bottom + 6}px`;
      pop.style.left = `${Math.max(10, Math.min(r.right - 210, window.innerWidth - 220))}px`;
      // V693: busca por título ao vivo (o popover sobrevive ao re-render da faixa)
      const inp = pop.querySelector('#tl-lupa-inp');
      const inpX = pop.querySelector('#tl-lupa-inp-x');
      inp.addEventListener('input', () => {
        _filtroTexto = inp.value;
        inpX.style.display = _tlSemAcento(_filtroTexto).trim() ? '' : 'none';
        render();
      });
      inp.addEventListener('keydown', (e2) => { if (e2.key === 'Escape') { pop.remove(); } });
      inpX.addEventListener('click', () => { _filtroTexto = ''; inp.value = ''; inpX.style.display = 'none'; inp.focus(); render(); });
      setTimeout(() => inp.focus(), 30);
      pop.querySelectorAll('[data-tl-mes]').forEach(b => b.addEventListener('click', () => {
        _filtroMes = b.dataset.tlMes || null;
        pop.remove();
        render();
      }));
      const fecharPop = (e2) => {
        if (!pop.contains(e2.target) && e2.target !== bl && !e2.target.closest('[data-tl-lupa]')) {
          pop.remove(); document.removeEventListener('click', fecharPop);
        }
      };
      setTimeout(() => document.addEventListener('click', fecharPop), 0);
    });

    const bn = cont.querySelector('[data-tl-novo]');
    if (bn) bn.addEventListener('click', async () => {
      const id = await criar({ data: hojeISO(), categoria: 'regra', titulo: 'Novo evento sem título' });
      _sel = id; render(); if (id) abrirModal(id, true);
    });
  }

  // ── modal do EVENTO (9D) — descrição editável + anexos ────────────────
  // Clicar num alfinete abre este modal (padrão do handoff): chip da
  // categoria, título, impacto/responsável, DESCRIÇÃO editável e documentos
  // (anexar/baixar/remover). O lápis abre a edição completa (V573).
  function abrirModalVer(id) {
    const ev = evento(id);
    if (!ev) return;
    const cat = catDe(ev);
    const ov = document.createElement('div');
    ov.className = 'tl-ov';
    ov.innerHTML = `
      <div class="tl-modal tl-modal-ver" role="dialog" aria-modal="true">
        <div class="tl-modal-head">
          <div class="tl-modal-head-topo">
            <div class="tl-modal-head-l">
              <span class="tl-chip" style="color:${cat.texto}; background:${cat.tint}">
                <span class="tl-chip-pt" style="background:${cat.cor}"></span>${esc(cat.nome)}
              </span>
              <span class="tl-modal-data">${esc(fmtLonga(ev.data))}</span>
            </div>
            <div class="tl-modal-head-r">
              <button type="button" class="tl-lapis" title="Editar este evento">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
              </button>
              <button type="button" class="tl-x" title="Fechar">×</button>
            </div>
          </div>
          <div class="tl-ver-titulo">${esc(ev.titulo)}</div>
        </div>
        <div class="tl-modal-body">
          <div class="tl-cartoes">
            <div class="tl-cartao">
              <span class="tl-lbl">Impacto no repasse</span>
              <span class="tl-cartao-v" style="color:${SINAL_COR[ev.sinal] || SINAL_COR.neutro}">${ev.impacto ? esc(ev.impacto) : '—'}</span>
            </div>
            <div class="tl-cartao">
              <span class="tl-lbl">Responsável</span>
              <span class="tl-cartao-v">${ev.responsavel ? esc(ev.responsavel) : '—'}</span>
            </div>
          </div>
          <label class="tl-campo">
            <span class="tl-lbl">Descrição do evento</span>
            <textarea class="tl-ver-desc" rows="5"
              placeholder="Descreva o que mudou e como isso afeta o cálculo do repasse">${esc(ev.descricao || '')}</textarea>
          </label>
          <div class="tl-docs-bloco">
            <div class="tl-docs-head">
              <span class="tl-lbl">Documentos anexados</span>
              <span class="tl-docs-n" data-tl-docs-n></span>
            </div>
            <div class="tl-docs-lista" data-tl-docs-lista></div>
            <label class="tl-anexar">
              <input type="file" multiple hidden data-tl-file>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 17V5"></path><polyline points="6.5 10.5 12 5 17.5 10.5"></polyline><path d="M5 19h14"></path></svg>
              <span>Anexar documento</span>
            </label>
          </div>
        </div>
        <div class="tl-modal-foot">
          <button type="button" class="tl-salvar">Salvar registro</button>
          <button type="button" class="tl-cancelar">Cancelar</button>
          <span class="tl-foot-info">Registro #${String(ev.id).padStart(4, '0')}</span>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const fechar = () => { document.removeEventListener('keydown', onKey); ov.remove(); _sel = null; render(); };
    function onKey(e) { if (e.key === 'Escape') fechar(); }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    ov.querySelector('.tl-x').addEventListener('click', fechar);
    ov.querySelector('.tl-cancelar').addEventListener('click', fechar);

    function renderDocs() {
      const lista = ov.querySelector('[data-tl-docs-lista]');
      const contN = ov.querySelector('[data-tl-docs-n]');
      const ds = docsDe(id);
      if (contN) contN.textContent = ds.length === 0 ? 'Sem documentos' : ds.length === 1 ? '1 documento' : `${ds.length} documentos`;
      lista.innerHTML = ds.length ? ds.map(d => {
        const ext = (d.nome.split('.').pop() || '').slice(0, 4).toUpperCase();
        return `
          <div class="tl-doc">
            <span class="tl-doc-ext">${esc(ext || 'DOC')}</span>
            <button type="button" class="tl-doc-nome" data-tl-baixar="${d.id}" title="Baixar ${esc(d.nome)}">${esc(d.nome)}</button>
            <span class="tl-doc-tam">${esc(fmtTamanho(d.tamanho))}</span>
            <button type="button" class="tl-doc-rm" data-tl-rmdoc="${d.id}">Remover</button>
          </div>`;
      }).join('') : `<div class="tl-doc-vazio">Nenhum documento anexado a este evento.</div>`;
      lista.querySelectorAll('[data-tl-rmdoc]').forEach(b => {
        b.addEventListener('click', async () => {
          if (!window.confirm('Remover este documento do evento?')) return;
          await removerDoc(parseInt(b.dataset.tlRmdoc, 10));
          renderDocs(); toast('Documento removido', 'info');
        });
      });
      lista.querySelectorAll('[data-tl-baixar]').forEach(b => {
        b.addEventListener('click', () => baixarDoc(parseInt(b.dataset.tlBaixar, 10)));
      });
    }
    renderDocs();

    ov.querySelector('[data-tl-file]').addEventListener('change', async (e) => {
      const arquivos = Array.from(e.target.files || []);
      if (!arquivos.length) return;
      for (const f of arquivos) {
        try {
          const b64 = await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = () => rej(fr.error);
            fr.readAsDataURL(f);
          });
          await anexar(id, f, b64);
        } catch (err) { console.error('[linha-tempo] anexo:', err); toast(`Falha ao anexar ${f.name}`, 'error'); }
      }
      e.target.value = '';
      renderDocs();
      toast(arquivos.length === 1 ? 'Documento anexado' : `${arquivos.length} documentos anexados`, 'success');
    });

    ov.querySelector('.tl-salvar').addEventListener('click', async () => {
      await salvarDescricao(id, (ov.querySelector('.tl-ver-desc').value || '').trim());
      toast('Registro salvo', 'success');
      fechar();
    });

    // lápis → fecha a visualização e abre a edição completa
    ov.querySelector('.tl-lapis').addEventListener('click', () => {
      document.removeEventListener('keydown', onKey);
      ov.remove();
      abrirModal(id);
    });
  }

  // ── modal de EDIÇÃO completa (lápis) ──────────────────────────────────
  function abrirModal(id, novo) {
    const ev = evento(id);
    if (!ev) return;
    const cat = catDe(ev);
    const icoSel = (ev.icone && ICONES[ev.icone]) ? ev.icone : '';
    const ov = document.createElement('div');
    ov.className = 'tl-ov';
    ov.innerHTML = `
      <div class="tl-modal" role="dialog" aria-modal="true">
        <div class="tl-modal-head">
          <div class="tl-modal-head-topo">
            <div class="tl-modal-head-l">
              <span class="tl-chip" style="color:${cat.texto}; background:${cat.tint}">
                <span class="tl-chip-pt" style="background:${cat.cor}"></span>${esc(cat.nome)}
              </span>
              <span class="tl-modal-data">${esc(fmtLonga(ev.data))}</span>
            </div>
            <button type="button" class="tl-x" title="Fechar">×</button>
          </div>
        </div>
        <div class="tl-modal-body">
          <label class="tl-campo">
            <span class="tl-lbl">Título do evento</span>
            <input type="text" class="tl-in tl-in-titulo" maxlength="180" value="${esc(ev.titulo)}" placeholder="Ex.: Nova regra de repasse para consultas">
          </label>
          <div class="tl-linha2">
            <label class="tl-campo">
              <span class="tl-lbl">Data</span>
              <input type="date" class="tl-in tl-in-data" value="${esc((ev.data || '').slice(0, 10))}">
            </label>
            <label class="tl-campo">
              <span class="tl-lbl">Categoria</span>
              <select class="tl-in tl-in-cat">
                ${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${ev.categoria === k ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="tl-campo">
            <span class="tl-lbl">Ícone do marco na linha</span>
            <!-- V590: forma do alfinete — "Auto" segue a categoria; as demais fixam o ícone -->
            <div class="tl-icones" data-tl-icones>
              <button type="button" class="tl-ico-op tl-ico-auto${icoSel ? '' : ' on'}" data-tl-ico=""
                      title="Automático — segue a categoria">AUTO</button>
              ${Object.entries(ICONES).map(([k, ic]) => `
                <button type="button" class="tl-ico-op${icoSel === k ? ' on' : ''}" data-tl-ico="${k}" title="${esc(ic.nome)}">
                  ${svgIcone(k, 'currentColor', 14)}
                </button>`).join('')}
            </div>
          </div>
          <div class="tl-linha2">
            <label class="tl-campo">
              <span class="tl-lbl">Impacto no repasse</span>
              <input type="text" class="tl-in tl-in-impacto" maxlength="80" value="${esc(ev.impacto || '')}" placeholder="Ex.: +R$ 12.000/mês">
            </label>
            <label class="tl-campo">
              <span class="tl-lbl">Sinal</span>
              <select class="tl-in tl-in-sinal">
                ${Object.entries(SINAIS).map(([k, n]) => `<option value="${k}" ${(ev.sinal || 'neutro') === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}
              </select>
            </label>
          </div>
          <label class="tl-campo">
            <span class="tl-lbl">Responsável</span>
            <input type="text" class="tl-in tl-in-resp" maxlength="120" value="${esc(ev.responsavel || '')}" placeholder="Quem conduziu a mudança">
          </label>
          <label class="tl-campo">
            <span class="tl-lbl">Descrição do evento</span>
            <textarea class="tl-in tl-in-desc" rows="4" placeholder="O que mudou, por quê e o que passa a valer…">${esc(ev.descricao || '')}</textarea>
          </label>
        </div>
        <div class="tl-modal-foot">
          <button type="button" class="tl-salvar">Salvar registro</button>
          <button type="button" class="tl-cancelar">Cancelar</button>
          <button type="button" class="tl-excluir" title="Excluir este evento">Excluir</button>
          <span class="tl-foot-info">Registro #${String(ev.id).padStart(4, '0')}</span>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const fechar = () => { document.removeEventListener('keydown', onKey); ov.remove(); _sel = null; render(); };
    function onKey(e) { if (e.key === 'Escape') fechar(); }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    ov.querySelector('.tl-x').addEventListener('click', fechar);
    ov.querySelector('.tl-cancelar').addEventListener('click', fechar);

    // seletor de ícone (V590)
    ov.querySelectorAll('.tl-ico-op').forEach(b => {
      b.addEventListener('click', () => {
        ov.querySelectorAll('.tl-ico-op.on').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
      });
    });

    ov.querySelector('.tl-excluir').addEventListener('click', async () => {
      if (!window.confirm('Excluir este evento e seus documentos?')) return;
      await removerEvento(id);
      toast('Evento excluído', 'info');
      fechar();
    });

    ov.querySelector('.tl-salvar').addEventListener('click', async () => {
      const titulo = (ov.querySelector('.tl-in-titulo').value || '').trim();
      if (!titulo) { ov.querySelector('.tl-in-titulo').focus(); return; }
      const icoBt = ov.querySelector('.tl-ico-op.on');
      await salvarEvento(id, {
        data: ov.querySelector('.tl-in-data').value || ev.data,
        categoria: ov.querySelector('.tl-in-cat').value,
        titulo,
        impacto: (ov.querySelector('.tl-in-impacto').value || '').trim(),
        sinal: ov.querySelector('.tl-in-sinal').value,
        responsavel: (ov.querySelector('.tl-in-resp').value || '').trim(),
        descricao: (ov.querySelector('.tl-in-desc').value || '').trim(),
        icone: icoBt ? (icoBt.dataset.tlIco || null) : (ev.icone || null),
      });
      toast('Registro salvo', 'success');
      fechar();
    });

    const foco = ov.querySelector(novo ? '.tl-in-titulo' : '.tl-in-desc');
    if (foco) { foco.focus(); if (novo) foco.select(); }
  }

  // ── estilos ───────────────────────────────────────────────────────────
  function injetarEstilos() {
    if (document.getElementById('tl-estilos-9d')) return;
    const antigo = document.getElementById('tl-estilos');
    if (antigo) antigo.remove();
    const st = document.createElement('style');
    st.id = 'tl-estilos-9d';
    st.textContent = `
      /* V590: faixa em degradê com alfinetes (handoff 9D — Claude Design) */
      .tl-faixa { background: linear-gradient(90deg, #143352 0%, #1d4470 34%, #2a5a8c 68%, #8faccb 100%);
        border-radius: 14px; box-shadow: 0 1px 2px rgba(20, 51, 82,.05), 0 14px 32px -22px rgba(16, 45, 75,.5);
        padding: 14px 18px 10px; display: flex; align-items: center; gap: 18px; margin: 0 0 20px;
        position: relative; }   /* V711: ancoradouro da lupa (canto sup. direito) */
      .tl-fixo { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0;
        padding-right: 18px; border-right: 1px solid rgba(255,255,255,.28); }
      .tl-fixo-rot { font: 700 10px/1.3 'Inter Tight', -apple-system, sans-serif; letter-spacing: .12em;
        text-transform: uppercase; color: #e2f6fd; }
      .tl-fixo-n { font: 700 15px/1.3 'Inter Tight', -apple-system, sans-serif; color: #fff; }
      .tl-vazio { flex: 1; min-width: 0; font-size: 12.5px; color: rgba(255,255,255,.88);
        padding: 6px 0; line-height: 1.5; }
      .tl-vazio b { color: #fff; }
      .tl-novo { flex-shrink: 0; font: 700 12.5px/1 'Inter Tight', -apple-system, sans-serif;
        color: #143352; background: #fff; border: none; border-radius: 9px; padding: 9px 14px;
        cursor: pointer; white-space: nowrap; box-shadow: 0 2px 6px rgba(11, 35, 64,.2);
        transition: background-color .12s ease; }
      .tl-novo:hover { background: #eaf7fc; }
      /* V692: pino de evento com sinal ALTA — halo dourado de alerta
         (.tl-marco.tl-marco-alta: especificidade maior que a regra base) */
      .tl-marco.tl-marco-alta { box-shadow: 0 0 0 3px rgba(184,150,90,.45), 0 2px 8px rgba(11, 35, 64,.3); }
      /* V690: lupa BEM pequena acima do "+ Evento" — filtro por mês/ano */
      .tl-acao-col { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
      .tl-lupa { position: absolute; top: 8px; right: 10px; z-index: 6;   /* V711: canto sup. direito da faixa */
        width: 18px; height: 18px; padding: 0; border: none; border-radius: 999px;
        background: rgba(255,255,255,.22); color: #fff; cursor: pointer;
        display: flex; align-items: center; justify-content: center; transition: background-color .12s ease; }
      .tl-lupa:hover { background: rgba(255,255,255,.4); }
      .tl-lupa.on { background: #fff; color: #143352; box-shadow: 0 2px 6px rgba(11, 35, 64,.25); }
      .tl-lupa-pop { position: fixed; z-index: 100060; width: 190px; background: #fff;
        border: 1px solid #dfe4ea; border-radius: 10px; overflow: hidden;
        box-shadow: 0 14px 36px -10px rgba(11, 35, 64,.4); }
      .tl-lupa-tit { font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
        color: #96a2b1; padding: 9px 12px 7px; border-bottom: 1px solid #f0f4f8; }
      /* V693: busca por título dentro do popover da lupa */
      .tl-lupa-busca { display: flex; align-items: center; gap: 7px; margin: 8px 8px 2px; padding: 0 9px; height: 32px;
        background: #f6f4ef; border: 1px solid #dfe4ea; border-radius: 8px; color: #6b7d8e; }
      .tl-lupa-busca input { flex: 1; min-width: 0; border: none; background: none; font: 500 12.5px/1 inherit;
        font-family: inherit; color: #12304f; }
      .tl-lupa-busca input:focus { outline: none; }
      .tl-lupa-busca input::placeholder { color: #96a2b1; }
      .tl-lupa-busca button { width: 18px; height: 18px; flex: none; border: none; border-radius: 999px;
        background: #dfe4ea; color: #5a6879; font-size: 10px; line-height: 1; cursor: pointer; padding: 0; }
      .tl-lupa-lista { max-height: 220px; overflow-y: auto; padding: 5px; }
      .tl-lupa-it { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
        border: none; background: none; font: 600 12.5px/1 inherit; font-family: inherit; color: #12304f;
        padding: 8px 9px; border-radius: 7px; cursor: pointer; text-align: left; }
      .tl-lupa-it:hover { background: #f0f4f8; }
      .tl-lupa-it.sel { background: #f0f4f8; font-weight: 700; }
      .tl-lupa-qt { font-size: 10.5px; font-weight: 700; color: #1d4470; background: #f0f4f8;
        border-radius: 999px; padding: 2px 7px; }
      .tl-lupa-it.sel .tl-lupa-qt { background: #fff; }

      /* V591: esteira ltr (conteúdo curto cola à ESQUERDA, no bloco fixo);
         o scroll abre na ponta recente via scrollLeft no render. Trilho slim:
         70px — o balão de hover agora é fixed e não reserva altura. */
      .tl-scroller { flex: 1; min-width: 0; overflow-x: auto; overflow-y: hidden;
        scrollbar-width: thin; scrollbar-color: #c5d5e5 transparent; }
      .tl-scroller::-webkit-scrollbar { height: 8px; }
      .tl-scroller::-webkit-scrollbar-track { background: rgba(255,255,255,.14); border-radius: 4px; }
      .tl-scroller::-webkit-scrollbar-thumb { background: #c5d5e5; border-radius: 4px; }
      .tl-trilho { position: relative; height: 70px; }
      .tl-linha { position: absolute; left: 8px; right: 8px; top: 34px; height: 5px;
        border-radius: 3px; background: rgba(255,255,255,.22); }
      .tl-progresso { position: absolute; left: 8px; top: 34px; height: 5px;
        border-radius: 3px; background: rgba(255,255,255,.85); }
      .tl-hoje { position: absolute; top: 24px; width: 2px; height: 24px; background: #fff; }
      .tl-hoje-rot { position: absolute; top: 10px; transform: translateX(-50%);
        font: 700 10px/1 'Inter Tight', -apple-system, sans-serif; letter-spacing: .1em;
        text-transform: uppercase; color: #fff; white-space: nowrap; }
      .tl-col { position: absolute; top: 6px; transform: translateX(-50%);
        display: flex; flex-direction: column; align-items: center; }
      /* alfinete de mapa: gota com a ponta encostando na linha */
      .tl-marco { width: 24px; height: 24px; padding: 0; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        border: 1.5px solid rgba(255,255,255,.75); border-radius: 50% 50% 50% 2px;
        transform: rotate(-45deg); box-shadow: 0 3px 7px rgba(11, 35, 64,.3);
        position: relative; z-index: 2; transition: transform .12s ease; }
      .tl-marco:hover { transform: rotate(-45deg) scale(1.16); }
      .tl-marco:focus-visible { outline: 2px solid #2a5a8c; outline-offset: 2px; }
      .tl-data { margin-top: 16px; font: 700 10.5px/1 'Inter Tight', -apple-system, sans-serif;
        white-space: nowrap; }
      /* balão de hover (substitui o title nativo) — V591: fixed, ancorado no
         alfinete via JS; flutua SOBRE o que estiver abaixo da faixa */
      .tl-balao { position: fixed; transform: translateX(-50%);
        z-index: 100001; width: 220px; display: none; flex-direction: column; gap: 2px;
        background: #fff; border-radius: 9px; padding: 8px 11px;
        box-shadow: 0 6px 18px rgba(11, 35, 64,.32); pointer-events: none; text-align: left; }
      .tl-balao.on { display: flex; }
      .tl-balao-cat { display: flex; align-items: center; gap: 6px;
        font: 700 9.5px/1.3 'Inter Tight', -apple-system, sans-serif; letter-spacing: .08em;
        text-transform: uppercase; }
      .tl-balao-pt { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
      /* clamp em 2 linhas: título longo não pode passar dos 108px do trilho
         (criaria scrollbar vertical na faixa durante o hover) */
      .tl-balao-tit { font: 700 12px/1.3 'Inter Tight', -apple-system, sans-serif;
        color: #12304f; text-wrap: pretty; display: -webkit-box; -webkit-line-clamp: 2;
        -webkit-box-orient: vertical; overflow: hidden; }

      /* ── modal (9D) ─────────────────────────────────────────────────── */
      .tl-ov { position: fixed; inset: 0; z-index: 100000; background: rgba(11, 35, 64,.5);
        display: flex; align-items: flex-start; justify-content: center; padding: 60px 24px;
        overflow-y: auto; animation: tlFade .16s ease-out; }
      @keyframes tlFade { from { opacity: 0 } to { opacity: 1 } }
      .tl-modal { background: #fff; border-radius: 16px; width: 100%; max-width: 560px;
        box-shadow: 0 24px 60px -20px rgba(11, 35, 64,.45); overflow: hidden;
        display: flex; flex-direction: column; }
      .tl-modal-head { padding: 20px 24px 16px; border-bottom: 1px solid #f0f4f8;
        display: flex; flex-direction: column; gap: 10px; }
      .tl-modal-head-topo { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .tl-modal-head-l { display: flex; align-items: center; gap: 9px; min-width: 0; flex-wrap: wrap; }
      .tl-modal-head-r { display: flex; align-items: center; gap: 6px; }
      .tl-chip { display: inline-flex; align-items: center; gap: 7px;
        font: 700 11.5px/1 'Inter Tight', -apple-system, sans-serif;
        border-radius: 999px; padding: 5px 11px; }
      .tl-chip-pt { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .tl-modal-data { font-size: 12.5px; font-weight: 600; color: #5a6879; }
      .tl-x { width: 30px; height: 30px; border-radius: 8px; border: none; background: #f0f4f8;
        color: #5a6879; font-size: 17px; line-height: 1; cursor: pointer; padding: 0;
        transition: background-color .12s ease, color .12s ease; }
      .tl-x:hover { background: #e5edf3; color: #12304f; }
      .tl-lapis { display: inline-flex; align-items: center; justify-content: center;
        width: 30px; height: 30px; border: none; border-radius: 8px;
        background: #f0f4f8; color: #5a6879; cursor: pointer;
        transition: color .12s ease, background-color .12s ease; }
      .tl-lapis:hover { color: #1d4470; background: #f0f4f8; }
      .tl-ver-titulo { font: 700 20px/1.25 'Inter Tight', -apple-system, sans-serif;
        letter-spacing: -.01em; color: #12304f; text-wrap: pretty; }
      .tl-modal-body { padding: 18px 24px; display: flex; flex-direction: column; gap: 16px; }
      .tl-cartoes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .tl-cartao { background: #f6f4ef; border: 1px solid #e8eff5; border-radius: 10px;
        padding: 11px 13px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .tl-cartao-v { font: 700 14.5px/1.3 'Inter Tight', -apple-system, sans-serif; color: #12304f;
        overflow: hidden; text-overflow: ellipsis; }
      .tl-campo { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
      .tl-linha2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .tl-lbl { font: 700 10px/1 'Inter Tight', -apple-system, sans-serif; text-transform: uppercase;
        letter-spacing: .1em; color: #96a2b1; }
      .tl-ver-desc, .tl-in { font: inherit; font-size: 13.5px; line-height: 1.55; color: #1b2a3a;
        background: #f6f4ef; border: 1px solid #dfe4ea; border-radius: 10px; padding: 10px 13px;
        width: 100%; box-sizing: border-box; }
      .tl-ver-desc { resize: vertical; }
      textarea.tl-in { resize: vertical; }
      .tl-ver-desc:focus, .tl-in:focus { outline: none; border-color: #2a5a8c;
        box-shadow: 0 0 0 3px rgba(47,143,196,.14); background: #fff; }
      /* V590: seletor de ícone do marco */
      .tl-icones { display: flex; flex-wrap: wrap; gap: 6px; }
      .tl-ico-op { width: 34px; height: 34px; display: inline-flex; align-items: center;
        justify-content: center; border: 1px solid #dfe4ea; border-radius: 9px;
        background: #f6f4ef; color: #5a6879; cursor: pointer; padding: 0;
        transition: border-color .12s ease, background-color .12s ease, color .12s ease; }
      .tl-ico-op:hover { border-color: #2a5a8c; color: #1d4470; }
      .tl-ico-op.on { border-color: #1d4470; background: #f0f4f8; color: #1d4470;
        box-shadow: 0 0 0 1px #1d4470 inset; }
      .tl-ico-auto { width: auto; padding: 0 10px;
        font: 700 9.5px/1 'Inter Tight', -apple-system, sans-serif; letter-spacing: .08em; }
      .tl-docs-bloco { display: flex; flex-direction: column; gap: 9px; }
      .tl-docs-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .tl-docs-n { font-size: 11.5px; font-weight: 600; color: #5a6879; }
      .tl-docs-lista { display: flex; flex-direction: column; gap: 7px; }
      .tl-doc { display: flex; align-items: center; gap: 11px; background: #f6f4ef;
        border: 1px solid #e8eff5; border-radius: 10px; padding: 9px 11px; }
      .tl-doc-ext { font: 700 9.5px/1 'Inter Tight', -apple-system, sans-serif; letter-spacing: .04em;
        color: #fff; background: #5b7c93; border-radius: 5px; padding: 4px 6px; flex-shrink: 0; }
      .tl-doc-nome { flex: 1; min-width: 0; text-align: left; font-size: 13px; font-weight: 600;
        color: #12304f; background: none; border: none; padding: 0; cursor: pointer;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tl-doc-nome:hover { color: #1d4470; text-decoration: underline; }
      .tl-doc-tam { font-size: 11.5px; color: #5a6879; white-space: nowrap; }
      .tl-doc-rm { font: 700 11.5px/1 'Inter Tight', -apple-system, sans-serif;
        border: none; background: none; color: #c0563f; cursor: pointer; padding: 2px 0; }
      .tl-doc-rm:hover { color: #9c3d29; }
      .tl-doc-vazio { font-size: 12.5px; color: #96a2b1; background: #f6f4ef;
        border: 1px dashed #dfe4ea; border-radius: 10px; padding: 14px 13px; }
      .tl-anexar { align-self: flex-start; display: inline-flex; align-items: center; gap: 8px;
        font: 700 12.5px/1 'Inter Tight', -apple-system, sans-serif; color: #1d4470;
        background: #f0f4f8; border: 1px solid #cbe3f2; border-radius: 10px; padding: 10px 14px;
        cursor: pointer; transition: background-color .12s ease; }
      .tl-anexar:hover { background: #d8ebf7; }
      .tl-modal-foot { padding: 14px 24px; border-top: 1px solid #f0f4f8;
        display: flex; align-items: center; gap: 9px; }
      .tl-foot-info { margin-left: auto; font-size: 11.5px; color: #96a2b1; }
      .tl-salvar { font: 700 12.5px/1 'Inter Tight', -apple-system, sans-serif; color: #fff;
        background: #1d4470; border: none; border-radius: 9px; padding: 11px 18px; cursor: pointer;
        transition: background-color .12s ease; }
      .tl-salvar:hover { background: #143352; }
      .tl-cancelar { font: 700 12.5px/1 'Inter Tight', -apple-system, sans-serif; color: #5a6879;
        background: transparent; border: 1px solid #dfe4ea; border-radius: 9px; padding: 10px 16px;
        cursor: pointer; transition: border-color .12s ease, color .12s ease; }
      .tl-cancelar:hover { border-color: #c5d5e5; color: #12304f; }
      .tl-excluir { font: 700 11.5px/1 'Inter Tight', -apple-system, sans-serif; color: #c0563f;
        background: transparent; border: none; cursor: pointer; padding: 10px 6px; }
      .tl-excluir:hover { color: #9c3d29; text-decoration: underline; }
      @media (max-width: 640px) { .tl-linha2, .tl-cartoes { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(st);
  }

  window.AtlasLinhaTempo = { montar, listar, criar };   // V615: criar exposto — a Consolidação registra reaberturas na linha do tempo
})();
