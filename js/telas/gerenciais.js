/**
 * ============================================================================
 * TELA: Gerenciais  (Processamento → após Auditoria)
 *
 * Ajustes gerenciais que FOGEM (ou não) da regra automática. Cada ajuste vira
 * uma LINHA no Consolidado do mês (crédito + ou desconto −), com:
 *   • admissão (opcional)  • médico  • descrição  • valor (±)  • fixar mensal
 *
 * Recorrência: "fixar mensalmente" faz o ajuste reaparecer todo mês (a partir
 * do mês de criação) até ser desativado. Cada mês tem seu próprio STATUS
 * (pendente / aplicado / descartado) por ajuste.
 *
 * Gate: após o Calcular Repasse, um alerta lista os pendentes (recorrentes +
 * pontuais). Só os APLICADOS entram no Consolidado. A Consolidação de Repasse
 * (módulo da Saída) exige que não haja pendentes.
 *
 * API pública (window.AtlasGerenciais): usada pelo Calcular (alerta) e pelo
 * Relatórios (injeta as linhas aplicadas no Consolidado).
 * ============================================================================
 */
(function () {
  'use strict';

  // ── Schema ────────────────────────────────────────────────────────────────
  function garantirSchema() {
    try {
      Banco.executar(`
        CREATE TABLE IF NOT EXISTS ajuste_gerencial (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          competencia   TEXT,                 -- mês de origem (pontual = mês-alvo; fixo = mês de criação)
          admissao      TEXT,
          medico_id     INTEGER,
          medico_nome   TEXT,
          descricao     TEXT NOT NULL,
          valor         REAL DEFAULT 0,       -- + crédito / − desconto
          fixo_mensal   INTEGER DEFAULT 0,    -- 1 = recorrente
          ativo         INTEGER DEFAULT 1,
          criado_em     TEXT DEFAULT CURRENT_TIMESTAMP,
          atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);
      Banco.executar(`
        CREATE TABLE IF NOT EXISTS ajuste_gerencial_status (
          ajuste_id   INTEGER NOT NULL,
          competencia TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'pendente',   -- pendente | aplicado | descartado
          valor_mes   REAL,                               -- valor efetivo no mês (default = valor do ajuste)
          tratado_em  TEXT,
          PRIMARY KEY (ajuste_id, competencia)
        );
      `);
      // V224: TIPO = categoria editável e crescente (Ajustes, Qvis, …)
      try { Banco.executar(`ALTER TABLE ajuste_gerencial ADD COLUMN tipo TEXT`); } catch (_) { /* já existe */ }
      // V225: janela de recorrência por competência (mês/ano) — de → até
      try { Banco.executar(`ALTER TABLE ajuste_gerencial ADD COLUMN recorre_de TEXT`); } catch (_) {}
      try { Banco.executar(`ALTER TABLE ajuste_gerencial ADD COLUMN recorre_ate TEXT`); } catch (_) {}
      Banco.executar(`
        CREATE TABLE IF NOT EXISTS gerencial_tipo (
          id    INTEGER PRIMARY KEY AUTOINCREMENT,
          nome  TEXT NOT NULL,
          ativo INTEGER DEFAULT 1
        );
      `);
      // semeia os tipos iniciais só uma vez (lista vazia)
      try {
        const n = ((Banco.query(`SELECT COUNT(*) AS n FROM gerencial_tipo`) || [])[0] || {}).n || 0;
        if (n === 0) ['Ajustes', 'Qvis'].forEach(t =>
          Banco.executar(`INSERT INTO gerencial_tipo (nome, ativo) VALUES (?, 1)`, [t]));
      } catch (_) {}
    } catch (e) { console.warn('[gerenciais] schema:', e); }
  }

  const norm = (s) => Utilidades.normalizar(String(s == null ? '' : s));
  const fmt  = (n) => Utilidades.formatarNumero(Number(n) || 0, 2);
  const esc  = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Status (categoria) com a MESMA paleta do Relatórios (statusInfo/rel-tag-*)
  function corStatus(nome) {
    const n = norm(nome).replace(/[ÇC]/g, 'C');
    if (n.indexOf('QVIS') >= 0) return '#2C7A5B';                 // rel-tag-qvis
    if (n.indexOf('GLOSA') >= 0) return '#9B3A3A';               // rel-tag-glosa
    if (n.indexOf('AJUSTE') >= 0 || n.indexOf('PRODU') >= 0) return '#5a6879'; // rel-tag-atlas
    if (n.indexOf('DESEMPENHO') >= 0) return '#2a5a8c';         // rel-tag-desemp
    return '#B4B2A9';                                            // rel-tag-neutra
  }

  // ── Competências disponíveis (snapshots + produção) ───────────────────────
  function listarCompetencias() {
    const set = new Set();
    try { (Banco.query(`SELECT competencia FROM repasse_snapshot`) || []).forEach(r => r.competencia && set.add(r.competencia)); } catch (_) {}
    try { (Banco.query(`SELECT DISTINCT competencia FROM linhas_producao WHERE competencia IS NOT NULL AND competencia <> ''`) || []).forEach(r => set.add(r.competencia)); } catch (_) {}
    try { (Banco.query(`SELECT DISTINCT competencia FROM ajuste_gerencial WHERE competencia IS NOT NULL`) || []).forEach(r => r.competencia && set.add(r.competencia)); } catch (_) {}
    return [...set].filter(Boolean).sort().reverse();
  }
  function competenciaPadrao() {
    const c = listarCompetencias();
    return c[0] || '';
  }

  function listarMedicos() {
    try { return Banco.query(`SELECT id, nome_oficial FROM medicos WHERE ativo = 1 ORDER BY nome_oficial`) || []; }
    catch (_) { return []; }
  }

  // ── Tipos (categoria que cresce: Ajustes, Qvis, …) ────────────────────────
  function listarTipos() {
    garantirSchema();
    try { return (Banco.query(`SELECT id, nome FROM gerencial_tipo WHERE ativo = 1 ORDER BY nome`) || []).map(r => r.nome); }
    catch (_) { return []; }
  }
  function criarTipo(nome) {
    const n = String(nome || '').trim();
    if (!n) return false;
    garantirSchema();
    try {
      const ja = (Banco.query(`SELECT id FROM gerencial_tipo WHERE LOWER(nome) = LOWER(?) LIMIT 1`, [n]) || [])[0];
      if (ja) { Banco.executar(`UPDATE gerencial_tipo SET ativo = 1 WHERE id = ?`, [ja.id]); return n; }
      Banco.executar(`INSERT INTO gerencial_tipo (nome, ativo) VALUES (?, 1)`, [n]);
      return n;
    } catch (e) { console.error('[gerenciais] criarTipo:', e); return false; }
  }

  // ── Dados: ajustes que se aplicam a um mês + status do mês ────────────────
  // Retorna [{ id, admissao, medico_id, medico_nome, descricao, valor, fixo_mensal,
  //            status, valor_mes }] — status default 'pendente' quando não tratado.
  function ajustesDoMes(comp) {
    if (!comp) return [];
    garantirSchema();
    let rows = [];
    try {
      rows = Banco.query(`
        SELECT a.id, a.admissao, a.medico_id, a.medico_nome, a.descricao,
               a.valor, a.fixo_mensal, a.tipo, a.recorre_de, a.recorre_ate,
               a.competencia AS comp_origem,
               s.status AS status, s.valor_mes AS valor_mes
          FROM ajuste_gerencial a
          LEFT JOIN ajuste_gerencial_status s
                 ON s.ajuste_id = a.id AND s.competencia = ?
         WHERE a.ativo = 1
           AND ( (a.fixo_mensal = 0 AND a.competencia = ?)        -- pontual deste mês
              OR (a.fixo_mensal = 1                                -- recorrente, dentro da janela
                  AND ? >= COALESCE(a.recorre_de, a.competencia, '0000-00')
                  AND (a.recorre_ate IS NULL OR a.recorre_ate = '' OR ? <= a.recorre_ate)) )
         ORDER BY a.fixo_mensal DESC, a.medico_nome, a.id
      `, [comp, comp, comp, comp]) || [];
    } catch (e) { console.warn('[gerenciais] ajustesDoMes:', e); }
    return rows.map(r => ({
      id: r.id, admissao: r.admissao || '', medico_id: r.medico_id,
      medico_nome: r.medico_nome || '', descricao: r.descricao || '',
      valor: Number(r.valor) || 0, fixo_mensal: !!r.fixo_mensal,
      tipo: r.tipo || '', recorre_de: r.recorre_de || '', recorre_ate: r.recorre_ate || '',
      status: r.status || 'pendente',
      valor_mes: (r.valor_mes != null ? Number(r.valor_mes) : (Number(r.valor) || 0)),
    }));
  }

  function pendentesDoMes(comp) {
    const lst = ajustesDoMes(comp).filter(a => a.status === 'pendente');
    return {
      recorrentes: lst.filter(a => a.fixo_mensal),
      pontuais:    lst.filter(a => !a.fixo_mensal),
      total: lst.length,
    };
  }
  function aplicadosDoMes(comp) { return ajustesDoMes(comp).filter(a => a.status === 'aplicado'); }

  // Linhas no formato do Consolidado (consumidas pelo Relatórios)
  function linhasConsolidado(comp) {
    return aplicadosDoMes(comp).map(a => ({
      status:       'Gerencial',
      modulo:       'Gerencial',
      admissao:     a.admissao || '',
      data:         '',
      papel:        a.valor_mes < 0 ? 'Desconto' : 'Crédito',
      profissional: a.medico_nome || '',
      medico_id:    a.medico_id || null,
      paciente:     '',
      origem:       '',
      convenio:     '',
      descricao:    a.descricao || '',
      valor:        Number(a.valor_mes) || 0,
      _gerencial:   true,
    }));
  }

  // ── Mutações ──────────────────────────────────────────────────────────────
  function criarAjuste(o) {
    garantirSchema();
    const desc = String(o.descricao || '').trim();
    if (!desc) return false;
    try {
      Banco.executar(
        `INSERT INTO ajuste_gerencial (competencia, admissao, medico_id, medico_nome, descricao, valor, fixo_mensal, tipo, recorre_de, recorre_ate, ativo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [o.competencia || null, o.admissao || null, o.medico_id || null,
         o.medico_nome || null, desc, Number(o.valor) || 0, o.fixo_mensal ? 1 : 0, o.tipo || null,
         (o.fixo_mensal ? (o.recorre_de || null) : null), (o.fixo_mensal ? (o.recorre_ate || null) : null)]
      );
      return true;
    } catch (e) { console.error('[gerenciais] criarAjuste:', e); return false; }
  }
  function atualizarAjuste(id, o) {
    try {
      Banco.executar(
        `UPDATE ajuste_gerencial SET admissao=?, medico_id=?, medico_nome=?, descricao=?,
           valor=?, fixo_mensal=?, tipo=?, recorre_de=?, recorre_ate=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
        [o.admissao || null, o.medico_id || null, o.medico_nome || null,
         String(o.descricao || '').trim(), Number(o.valor) || 0, o.fixo_mensal ? 1 : 0, o.tipo || null,
         (o.fixo_mensal ? (o.recorre_de || null) : null), (o.fixo_mensal ? (o.recorre_ate || null) : null), id]
      );
      return true;
    } catch (e) { console.error('[gerenciais] atualizarAjuste:', e); return false; }
  }
  function removerAjuste(id) {
    try {
      Banco.executar(`DELETE FROM ajuste_gerencial_status WHERE ajuste_id = ?`, [id]);
      Banco.executar(`DELETE FROM ajuste_gerencial WHERE id = ?`, [id]);
      return true;
    } catch (e) { console.error('[gerenciais] removerAjuste:', e); return false; }
  }
  function definirStatus(ajusteId, comp, status, valorMes) {
    if (!ajusteId || !comp) return false;
    try {
      Banco.executar(
        `INSERT INTO ajuste_gerencial_status (ajuste_id, competencia, status, valor_mes, tratado_em)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(ajuste_id, competencia) DO UPDATE SET
           status = excluded.status, valor_mes = excluded.valor_mes, tratado_em = datetime('now')`,
        [ajusteId, comp, status, (valorMes != null ? Number(valorMes) : null)]
      );
      return true;
    } catch (e) { console.error('[gerenciais] definirStatus:', e); return false; }
  }

  // ── API pública (alerta do Calcular + injeção no Consolidado) ─────────────
  window.AtlasGerenciais = Object.assign(window.AtlasGerenciais || {}, {
    pendentesDoMes, aplicadosDoMes, linhasConsolidado, ajustesDoMes,
    contarPendentes: (comp) => pendentesDoMes(comp).total,
  });

  // ── Estado da tela ────────────────────────────────────────────────────────
  function st() {
    if (!window.__ger) {
      window.__ger = {
        competencia: competenciaPadrao(),
        form: { id: null, tipo: '', admissao: '', medico_id: '', descricao: '', valorAbs: '', sinal: '+', fixo: false, recorre_de: '', recorre_ate: '' },
      };
    }
    if (!window.__ger.competencia) window.__ger.competencia = competenciaPadrao();
    return window.__ger;
  }

  // ── Tela ──────────────────────────────────────────────────────────────────
  App.telas['gerenciais'] = function () {
    garantirSchema();
    const state = st();
    const comp = state.competencia;
    const comps = listarCompetencias();
    const medicos = listarMedicos();
    const tipos = listarTipos();
    const ajustes = comp ? ajustesDoMes(comp) : [];
    const pend = comp ? pendentesDoMes(comp) : { recorrentes: [], pontuais: [], total: 0 };
    const aplicados = ajustes.filter(a => a.status === 'aplicado');
    const totalCredito = aplicados.filter(a => a.valor_mes > 0).reduce((s, a) => s + a.valor_mes, 0);
    const totalDesconto = aplicados.filter(a => a.valor_mes < 0).reduce((s, a) => s + a.valor_mes, 0);
    const liquido = totalCredito + totalDesconto;
    const f = state.form;

    const stChip = (s) => {
      const cfg = { pendente: ['Pendente', 'ger-st-pend'], aplicado: ['Aplicado', 'ger-st-apl'], descartado: ['Descartado', 'ger-st-desc'] }[s] || ['—', ''];
      return `<span class="ger-chip ${cfg[1]}">${cfg[0]}</span>`;
    };

    const linhaAjuste = (a) => `
      <tr class="${a.status === 'descartado' ? 'ger-row-desc' : ''}">
        <td>${a.tipo ? `<span class="ger-stag" style="background:${corStatus(a.tipo)}">${esc(a.tipo)}</span>` : '<span class="ger-muted">—</span>'}</td>
        <td>${esc(CodigoMedico.exibir(a.medico_nome)) || '<span class="ger-muted">— sem médico —</span>'}</td>
        <td>${esc(a.admissao) || '<span class="ger-muted">—</span>'}</td>
        <td>${esc(a.descricao)}</td>
        <td class="num ${a.valor_mes < 0 ? 'ger-neg' : 'ger-pos'}">${a.valor_mes < 0 ? '−' : '+'} R$ ${fmt(Math.abs(a.valor_mes))}</td>
        <td>${stChip(a.status)}</td>
        <td class="ger-acoes">
          ${a.status !== 'aplicado' ? `<button class="ger-mini ger-mini-apl" data-ger-aplicar="${a.id}">aplicar</button>` : ''}
          ${a.status !== 'descartado' ? `<button class="ger-mini" data-ger-descartar="${a.id}">descartar</button>` : ''}
          ${a.status !== 'pendente' ? `<button class="ger-mini" data-ger-reabrir="${a.id}">reabrir</button>` : ''}
          <button class="ger-mini" data-ger-editar="${a.id}">editar</button>
          <button class="ger-mini ger-mini-del" data-ger-remover="${a.id}" title="Remover">🗑</button>
        </td>
      </tr>`;

    const html = `
      <div class="page-content ger-page">
        <header class="page-header">
          <div>
            <h2>Gerenciais</h2>
            <div class="subtitle">Ajustes que entram no Consolidado do mês — crédito (+) ou desconto (−). Trate os pendentes antes de consolidar.</div>
          </div>
          <div style="display:flex; gap:9px; align-items:center">
            <label class="ger-comp-lbl">Competência</label>
            <select id="ger-comp" class="ger-in ger-comp">
              ${comps.length === 0 ? `<option value="">— sem dados —</option>` :
                comps.map(c => `<option value="${esc(c)}" ${c === comp ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
          </div>
        </header>

        ${pend.total > 0 ? `
          <div class="ger-alerta">
            <i class="ti ti-alert-triangle"></i>
            <div>
              <strong>${pend.total} ajuste(s) pendente(s)</strong> neste mês —
              ${pend.recorrentes.length} recorrente(s) + ${pend.pontuais.length} pontual(is).
              Aplique ou descarte cada um antes de consolidar o repasse.
            </div>
          </div>` : (ajustes.length > 0 ? `
          <div class="ger-ok"><i class="ti ti-circle-check"></i> Todos os ajustes deste mês foram tratados.</div>` : '')}

        <div class="stats-grid">
          <div class="stat-card ger-card-pend ${pend.total > 0 ? 'tem' : ''}"><div class="label">Pendentes</div><div class="value">${pend.total}</div><div class="meta">${pend.recorrentes.length} fixos · ${pend.pontuais.length} pontuais</div></div>
          <div class="stat-card"><div class="label">Crédito aplicado</div><div class="value ger-pos">R$ ${fmt(totalCredito)}</div></div>
          <div class="stat-card"><div class="label">Desconto aplicado</div><div class="value ger-neg">R$ ${fmt(Math.abs(totalDesconto))}</div></div>
          <div class="stat-card"><div class="label">Líquido no Consolidado</div><div class="value">${liquido < 0 ? '−' : ''}R$ ${fmt(Math.abs(liquido))}</div></div>
        </div>

        <div class="card ger-form-card">
          <div class="ger-form-head">
            <span class="ger-eyebrow">${f.id ? 'Editando lançamento' : 'Novo lançamento'}</span>
            <h3 class="ger-form-titulo">${f.id ? 'Editar ajuste' : 'Adicionar ajuste'}</h3>
          </div>
          <div class="ger-grid">
            <div class="ger-field gf-3">
              <label>Status</label>
              <select id="ger-tipo" class="ger-in">
                <option value="">— selecione —</option>
                ${tipos.map(t => `<option value="${esc(t)}" ${f.tipo === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
              </select>
            </div>
            <div class="ger-field gf-3">
              <label>Novo status</label>
              <div class="ger-inline">
                <input id="ger-tipo-novo" class="ger-in" placeholder="ex: Glosa" autocomplete="off">
                <button class="ger-add-btn" id="ger-tipo-add" type="button" title="Adicionar à lista">+</button>
              </div>
            </div>
            <div class="ger-field gf-3">
              <label>Médico</label>
              <select id="ger-medico" class="ger-in">
                <option value="">— selecione —</option>
                ${medicos.map(m => `<option value="${m.id}" ${String(f.medico_id) === String(m.id) ? 'selected' : ''}>${esc(CodigoMedico.exibir(m.nome_oficial))}</option>`).join('')}
              </select>
            </div>
            <div class="ger-field gf-3">
              <label>Admissão <span class="ger-opt">opcional</span></label>
              <input id="ger-admissao" class="ger-in" placeholder="cód. admissão" autocomplete="off" value="${esc(f.admissao)}">
            </div>
            <div class="ger-field gf-8">
              <label>Descrição</label>
              <input id="ger-descricao" class="ger-in" placeholder="ex: bonificação coordenação LC" autocomplete="off" value="${esc(f.descricao)}">
            </div>
            <div class="ger-field gf-4">
              <label>Valor</label>
              <div class="ger-inline ger-valor-inline ger-sinal-${f.sinal === '-' ? 'neg' : 'pos'}">
                <select id="ger-sinal" class="ger-in ger-sinal">
                  <option value="+" ${f.sinal === '+' ? 'selected' : ''}>+ crédito</option>
                  <option value="-" ${f.sinal === '-' ? 'selected' : ''}>− desconto</option>
                </select>
                <input id="ger-valor" class="ger-in" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${esc(f.valorAbs)}">
              </div>
            </div>
            <div class="ger-field gf-12 ger-recorr">
              <label class="ger-switch">
                <input type="checkbox" id="ger-fixo" ${f.fixo ? 'checked' : ''}>
                <span class="ger-switch-track"><span class="ger-switch-thumb"></span></span>
                <span class="ger-switch-lbl">Fixar mensalmente</span>
              </label>
              ${f.fixo ? `
              <div class="ger-janela">
                <span class="ger-janela-w">de</span>
                <input type="month" id="ger-rec-de" class="ger-in ger-in-month" value="${esc(f.recorre_de)}">
                <span class="ger-janela-w">até</span>
                <input type="month" id="ger-rec-ate" class="ger-in ger-in-month" value="${esc(f.recorre_ate)}">
                <span class="ger-janela-hint">em branco = sem fim</span>
              </div>` : `<span class="ger-recorr-hint">repete todo mês dentro da janela que você definir</span>`}
            </div>
          </div>
          <div class="ger-form-acoes">
            ${f.id ? `<button class="btn" id="ger-cancelar">Cancelar</button>` : ''}
            <button class="btn btn-primary" id="ger-salvar">${f.id ? 'Salvar alterações' : 'Adicionar ajuste'}</button>
          </div>
        </div>

        <div class="card" style="padding:0; overflow:hidden">
          ${ajustes.length === 0 ? `
            <div class="empty-state" style="padding:48px 20px">
              <div class="icon">◇</div><h3>Nenhum ajuste neste mês</h3>
              <p>Cadastre um ajuste acima. Marque "fixar mensalmente" pra ele se repetir.</p>
            </div>` : `
            <table class="data-table ger-tabela">
              <thead><tr>
                <th>STATUS</th><th>MÉDICO</th><th>ADMISSÃO</th><th>DESCRIÇÃO</th>
                <th class="num">VALOR</th><th>TRATAMENTO</th><th>AÇÕES</th>
              </tr></thead>
              <tbody>${ajustes.map(linhaAjuste).join('')}</tbody>
            </table>`}
        </div>
      </div>
      ${estiloGer()}`;

    const root = document.getElementById('conteudo');
    if (root) root.innerHTML = html;
    bind();
  };

  function bind() {
    const state = st();
    const comp = state.competencia;
    const f = state.form;
    const $ = (id) => document.getElementById(id);

    const selComp = $('ger-comp');
    if (selComp) selComp.addEventListener('change', () => { state.competencia = selComp.value; App.telas['gerenciais'](); });

    const selMed = $('ger-medico'); if (selMed) selMed.addEventListener('change', () => { f.medico_id = selMed.value; });
    const selTipo = $('ger-tipo'); if (selTipo) selTipo.addEventListener('change', () => { f.tipo = selTipo.value; });
    const btnTipoAdd = $('ger-tipo-add');
    if (btnTipoAdd) btnTipoAdd.addEventListener('click', () => {
      const inp = $('ger-tipo-novo');
      const nome = inp ? String(inp.value || '').trim() : '';
      if (!nome) { Utilidades.toast?.('Digite o nome do novo tipo.', 'error', 2500); return; }
      const novo = criarTipo(nome);
      if (novo) { Banco.salvar(); f.tipo = novo; Utilidades.toast?.(`Tipo "${novo}" adicionado.`, 'success', 2500); App.telas['gerenciais'](); }
      else { Utilidades.toast?.('Erro ao adicionar o tipo.', 'error', 3000); }
    });
    const inAdm = $('ger-admissao'); if (inAdm) inAdm.addEventListener('input', () => { f.admissao = inAdm.value; });
    const inDesc = $('ger-descricao'); if (inDesc) inDesc.addEventListener('input', () => { f.descricao = inDesc.value; });
    const selSinal = $('ger-sinal'); if (selSinal) selSinal.addEventListener('change', () => {
      f.sinal = selSinal.value;
      const wrap = selSinal.closest('.ger-valor-inline');
      if (wrap) { wrap.classList.toggle('ger-sinal-neg', f.sinal === '-'); wrap.classList.toggle('ger-sinal-pos', f.sinal === '+'); }
    });
    const inVal = $('ger-valor'); if (inVal) inVal.addEventListener('input', () => { f.valorAbs = inVal.value; });
    const chkFixo = $('ger-fixo'); if (chkFixo) chkFixo.addEventListener('change', () => { f.fixo = chkFixo.checked; App.telas['gerenciais'](); });
    const inRecDe = $('ger-rec-de'); if (inRecDe) inRecDe.addEventListener('input', () => { f.recorre_de = inRecDe.value; });
    const inRecAte = $('ger-rec-ate'); if (inRecAte) inRecAte.addEventListener('input', () => { f.recorre_ate = inRecAte.value; });

    const btnCancelar = $('ger-cancelar');
    if (btnCancelar) btnCancelar.addEventListener('click', () => { resetForm(); App.telas['gerenciais'](); });

    const btnSalvar = $('ger-salvar');
    if (btnSalvar) btnSalvar.addEventListener('click', () => {
      if (!comp) { Utilidades.toast?.('Selecione uma competência.', 'error', 3000); return; }
      const desc = String(f.descricao || '').trim();
      if (!desc) { Utilidades.toast?.('Informe a descrição do ajuste.', 'error', 3000); return; }
      let raw = String(f.valorAbs || '').trim().replace(/\s/g, '');
      if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
      const num = Number(raw);
      if (raw === '' || isNaN(num) || num < 0) { Utilidades.toast?.('Informe um valor válido (ex: 350 ou 350,00).', 'error', 3500); return; }
      const valor = (f.sinal === '-') ? -num : num;
      const medSel = $('ger-medico');
      const medNome = medSel && medSel.value ? (medSel.options[medSel.selectedIndex] || {}).text || '' : '';
      if (f.fixo && f.recorre_de && f.recorre_ate && f.recorre_ate < f.recorre_de) {
        Utilidades.toast?.('A janela de recorrência está invertida (o "até" é anterior ao "de").', 'error', 4000); return;
      }
      const dados = { competencia: comp, admissao: f.admissao, medico_id: f.medico_id ? Number(f.medico_id) : null,
                      medico_nome: medNome, descricao: desc, valor, fixo_mensal: f.fixo, tipo: f.tipo || null,
                      recorre_de: f.recorre_de || null, recorre_ate: f.recorre_ate || null };
      const okSave = f.id ? atualizarAjuste(f.id, dados) : criarAjuste(dados);
      if (okSave) {
        Banco.salvar();
        Utilidades.toast?.(f.id ? 'Ajuste atualizado.' : 'Ajuste adicionado.', 'success', 3000);
        resetForm();
        App.telas['gerenciais']();
      } else { Utilidades.toast?.('Erro ao salvar o ajuste.', 'error', 4000); }
    });

    document.querySelectorAll('[data-ger-aplicar]').forEach(b => b.addEventListener('click', () => {
      definirStatus(Number(b.dataset.gerAplicar), comp, 'aplicado', null); Banco.salvar();
      Utilidades.toast?.('Ajuste aplicado — entra no Consolidado.', 'success', 3000); App.telas['gerenciais']();
    }));
    document.querySelectorAll('[data-ger-descartar]').forEach(b => b.addEventListener('click', () => {
      definirStatus(Number(b.dataset.gerDescartar), comp, 'descartado', null); Banco.salvar();
      Utilidades.toast?.('Ajuste descartado neste mês.', 'info', 3000); App.telas['gerenciais']();
    }));
    document.querySelectorAll('[data-ger-reabrir]').forEach(b => b.addEventListener('click', () => {
      definirStatus(Number(b.dataset.gerReabrir), comp, 'pendente', null); Banco.salvar();
      App.telas['gerenciais']();
    }));
    document.querySelectorAll('[data-ger-editar]').forEach(b => b.addEventListener('click', () => {
      const id = Number(b.dataset.gerEditar);
      const a = ajustesDoMes(comp).find(x => x.id === id);
      if (!a) return;
      state.form = { id: a.id, tipo: a.tipo || '', admissao: a.admissao, medico_id: a.medico_id || '', descricao: a.descricao,
                     valorAbs: String(Math.abs(a.valor)).replace('.', ','), sinal: a.valor < 0 ? '-' : '+', fixo: a.fixo_mensal,
                     recorre_de: a.recorre_de || '', recorre_ate: a.recorre_ate || '' };
      App.telas['gerenciais']();
    }));
    document.querySelectorAll('[data-ger-remover]').forEach(b => b.addEventListener('click', () => {
      const id = Number(b.dataset.gerRemover);
      if (!confirm('Remover este ajuste? Se for recorrente, some de todos os meses.')) return;
      removerAjuste(id); Banco.salvar();
      Utilidades.toast?.('Ajuste removido.', 'success', 3000); App.telas['gerenciais']();
    }));
  }

  function resetForm() {
    st().form = { id: null, tipo: '', admissao: '', medico_id: '', descricao: '', valorAbs: '', sinal: '+', fixo: false, recorre_de: '', recorre_ate: '' };
  }

  function estiloGer() {
    return `<style>
      /* ── inputs padrão alinhados ao design system ── */
      .ger-in { width:100%; height:38px; padding:0 11px; border:1px solid var(--border); border-radius:var(--radius-md);
        font-family:inherit; font-size:13px; background:var(--bg-elevated); color:var(--ink); transition:border-color var(--t-fast), box-shadow var(--t-fast); }
      .ger-in:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-soft); }
      select.ger-in { cursor:pointer; appearance:none;
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2356645E' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
        background-repeat:no-repeat; background-position:right 11px center; padding-right:28px; }
      .ger-comp-lbl { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.07em; color:var(--ink-faint); }
      .ger-comp { width:auto; min-width:120px; }

      /* ── banners ── */
      .ger-alerta { display:flex; gap:12px; align-items:center; padding:13px 16px; margin-bottom:var(--space-4); border-radius:var(--radius-lg);
        background:var(--warning-soft); border:1px solid #E6CFA0; color:#7A5B22; font-size:13px; }
      .ger-alerta i { font-size:20px; flex-shrink:0; }
      .ger-ok { display:flex; gap:9px; align-items:center; padding:11px 16px; margin-bottom:var(--space-4); border-radius:var(--radius-lg);
        background:var(--success-soft); border:1px solid #BFE3D2; color:var(--success); font-size:13px; }

      /* ── fonte dos números = mesma da Visão Geral (.aic-val): Inter Tight (var(--font-body)), bold, sem tracking apertado ── */
      .ger-page .stat-card .value { font-family: var(--font-body); font-weight: 700; letter-spacing: normal; }
      .ger-page .num { font-family: var(--font-body); }

      /* ── stat-cards: realces ── */
      .ger-card-pend.tem { border-color:#E6CFA0; background:var(--warning-soft); }
      .ger-card-pend.tem .value { color:#7A5B22; }

      /* ── formulário ── */
      .ger-form-card { margin-bottom:var(--space-4); }
      .ger-form-head { margin-bottom:var(--space-4); }
      .ger-eyebrow { display:block; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:var(--accent); margin-bottom:3px; }
      .ger-form-titulo { margin:0; font-family:var(--font-display); font-size:19px; font-weight:600; letter-spacing:-0.01em; color:var(--ink); }
      .ger-grid { display:grid; grid-template-columns:repeat(12, 1fr); gap:var(--space-4) var(--space-3); align-items:end; }
      .ger-field { display:flex; flex-direction:column; gap:6px; min-width:0; }
      .ger-field > label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--ink-faint); }
      .ger-opt { text-transform:none; letter-spacing:0; font-weight:400; color:var(--border-strong); font-size:10.5px; margin-left:3px; }
      .gf-3 { grid-column:span 3; } .gf-4 { grid-column:span 4; } .gf-6 { grid-column:span 6; }
      .gf-8 { grid-column:span 8; } .gf-12 { grid-column:span 12; }
      .ger-inline { display:flex; gap:6px; align-items:stretch; }
      .ger-add-btn { flex-shrink:0; width:38px; border:1px solid var(--primary); background:var(--primary-soft); color:var(--primary);
        border-radius:var(--radius-md); font-size:18px; font-weight:600; cursor:pointer; line-height:1; transition:background var(--t-fast); }
      .ger-add-btn:hover { background:var(--primary); color:#fff; }
      .ger-valor-inline .ger-sinal { flex:0 0 124px; font-weight:600; }
      .ger-valor-inline.ger-sinal-pos .ger-sinal { color:var(--success); }
      .ger-valor-inline.ger-sinal-neg .ger-sinal { color:var(--danger); }

      /* ── toggle "fixar mensalmente" ── */
      .ger-recorr { flex-direction:row; align-items:center; gap:18px; flex-wrap:wrap; padding-top:4px; border-top:1px solid var(--border); margin-top:2px; }
      .ger-switch { display:inline-flex; align-items:center; gap:9px; cursor:pointer; user-select:none; }
      .ger-switch input { position:absolute; opacity:0; width:0; height:0; }
      .ger-switch-track { width:38px; height:22px; border-radius:11px; background:var(--border-strong); position:relative; transition:background var(--t-fast); flex-shrink:0; }
      .ger-switch-thumb { position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#fff;
        box-shadow:var(--shadow-sm); transition:transform var(--t-fast); }
      .ger-switch input:checked + .ger-switch-track { background:var(--primary); }
      .ger-switch input:checked + .ger-switch-track .ger-switch-thumb { transform:translateX(16px); }
      .ger-switch input:focus-visible + .ger-switch-track { box-shadow:0 0 0 3px var(--primary-soft); }
      .ger-switch-lbl { font-size:13px; font-weight:600; color:var(--ink); }
      .ger-recorr-hint { font-size:12px; color:var(--ink-faint); }
      .ger-janela { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .ger-janela-w { font-size:12px; font-weight:600; color:var(--ink-faint); }
      .ger-in-month { width:auto; min-width:120px; }
      .ger-janela-hint { font-size:11px; color:var(--ink-faint); font-style:italic; }
      .ger-form-acoes { display:flex; gap:8px; justify-content:flex-end; margin-top:var(--space-4); padding-top:var(--space-4); border-top:1px solid var(--border); }

      /* ── tabela ── */
      .ger-tabela td { vertical-align:middle; }
      .ger-stag { display:inline-block; padding:3px 9px; border-radius:5px; font-size:10px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:#fff; }
      .ger-chip { display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; padding:3px 9px; border-radius:20px; }
      .ger-chip::before { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; }
      .ger-st-pend { background:var(--warning-soft); color:#7A5B22; }
      .ger-st-apl { background:var(--success-soft); color:var(--success); }
      .ger-st-desc { background:#ECECEC; color:#7A7A7A; }
      .ger-row-desc { opacity:0.5; }
      .ger-acoes { white-space:nowrap; text-align:right; }
      .ger-mini { padding:5px 10px; margin-left:5px; background:var(--bg-elevated); border:1px solid var(--border); border-radius:var(--radius-sm);
        font-family:inherit; font-size:11.5px; font-weight:500; cursor:pointer; color:var(--ink-soft); transition:background var(--t-fast), border-color var(--t-fast); }
      .ger-mini:hover { background:var(--bg-sunken); border-color:var(--border-strong); }
      .ger-mini-apl { background:var(--primary); color:#fff; border-color:var(--primary); font-weight:600; }
      .ger-mini-apl:hover { background:var(--primary-hover); border-color:var(--primary-hover); }
      .ger-mini-del { color:var(--danger); }
      .ger-mini-del:hover { background:var(--danger-soft); border-color:var(--danger); }
      .ger-pos { color:var(--success); font-weight:600; }
      .ger-neg { color:var(--danger); font-weight:600; }
      .ger-muted { color:var(--border-strong); }

      @media (max-width: 880px) {
        .ger-grid { grid-template-columns:repeat(2, 1fr); }
        .gf-3, .gf-4, .gf-6, .gf-8 { grid-column:span 2; }
      }
    </style>`;
  }
})();
