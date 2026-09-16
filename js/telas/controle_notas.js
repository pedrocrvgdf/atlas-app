/**
 * ============================================================================
 * TELA: Controle de Notas (V906) — o ciclo mensal do repasse interno
 *
 *   relatório enviado por email → nota fiscal recebida → nota enviada ao CAV
 *
 * Substitui a planilha manual "CONTROLE DE REPASSE INTERNO":
 *   · CADASTRO dos médicos/PJ (nome, razão social, CNPJ, email do médico e
 *     do contador) — importável da própria planilha, editável aqui;
 *   · por COMPETÊNCIA, uma linha por médico com os 3 CHECKS, valores da nota
 *     (bruto/líquido/nº), status especial (DISTRATO, ADIANTAMENTO...) e obs;
 *   · ANEXO da nota em PDF: o arquivo fica guardado no banco e o módulo LÊ
 *     valor bruto, líquido e número automaticamente (pdf.js local);
 *   · CONFERÊNCIA: o bruto da nota × o total do RELATÓRIO do médico na
 *     competência (AtlasRelatorios.totaisPorMedico) → bateu / divergiu.
 *
 * PDFs escaneados (imagem, sem camada de texto) não têm leitura automática —
 * os campos ficam editáveis à mão e a conferência funciona igual.
 * ============================================================================
 */
App.telas['controle-notas'] = function () { ControleNotas.montar(); };

const ControleNotas = (function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = (s) => (window.Utilidades ? Utilidades.normalizar(String(s || ''))
    : String(s || '').toUpperCase().trim());
  const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const MES_ABREV = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7,
    ago: 8, set: 9, out: 10, nov: 11, dez: 12,
    janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
    julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
  const compLabel = (c) => {
    if (!c) return '—';
    const [a, m] = String(c).split('-');
    return `${MESES[parseInt(m, 10) - 1] || m}/${a}`;
  };

  if (window.__cnotas === undefined) {
    window.__cnotas = {
      competencia: null,
      busca: '',
      etapa: 'todas',      // todas | sem_email | sem_nota | sem_cav | divergiu | especiais
      cadastroAberto: false,
      cadEditando: null,   // id em edição no modal do cadastro
      // V909: modal da estrutura do e-mail
      emailAberto: false,
      emailDtPgto: '',     // ISO — pré-preenchida pela data de pagamento do QVIS
      emailPrazo: '',      // ISO — "nota fiscal até"
      emailAssunto: null,  // null = usa o padrão/último modelo
      emailEscopo: 'pendentes',
    };
  }
  const state = window.__cnotas;
  if (state.emailAberto === undefined) {
    Object.assign(state, { emailAberto: false, emailDtPgto: '', emailPrazo: '',
      emailAssunto: null, emailEscopo: 'pendentes' });
  }

  // ── dados ────────────────────────────────────────────────────────────
  function listarCadastro() {
    try {
      return Banco.query(`SELECT * FROM notas_cadastro ORDER BY nome`) || [];
    } catch (e) { return []; }
  }
  function competenciasDisponiveis() {
    const set = new Set();
    try { (Banco.query(`SELECT DISTINCT competencia c FROM notas_controle`) || []).forEach(r => set.add(r.c)); } catch (e) {}
    try { (Banco.query(`SELECT DISTINCT competencia c FROM repasse_snapshot`) || []).forEach(r => set.add(r.c)); } catch (e) {}
    return Array.from(set).filter(Boolean).sort().reverse();
  }
  function listarControle(comp) {
    try {
      return Banco.query(`
        SELECT ctl.*, cad.nome, cad.razao_social, cad.cnpj, cad.email_medico, cad.email_contador
          FROM notas_controle ctl
          LEFT JOIN notas_cadastro cad ON cad.nome_normalizado = ctl.nome_normalizado
         WHERE ctl.competencia = ?
         ORDER BY COALESCE(cad.nome, ctl.nome_normalizado)`, [comp]) || [];
    } catch (e) { console.error('[notas]', e); return []; }
  }
  async function gerarMes(comp) {
    const cads = listarCadastro().filter(c => c.ativo);
    if (!cads.length) { Utilidades.toast('Cadastro vazio — importe a planilha ou cadastre os médicos primeiro.', 'error', 4000); return 0; }
    let n = 0;
    for (const c of cads) {
      try {
        Banco.executar(`INSERT OR IGNORE INTO notas_controle (competencia, nome_normalizado)
          VALUES (?, ?)`, [comp, c.nome_normalizado]);
        n++;
      } catch (e) {}
    }
    await Banco.salvar();
    return n;
  }
  async function salvarCampo(id, campo, valor) {
    const PERMITIDOS = new Set(['oc', 'email_enviado', 'nota_recebida', 'cav_enviado',
      'valor_bruto', 'valor_liquido', 'nf_numero', 'origem_valores',
      'status_especial', 'observacao', 'nota_arquivo']);
    if (!PERMITIDOS.has(campo)) return;
    Banco.executar(`UPDATE notas_controle SET ${campo} = ?, atualizado_em = datetime('now') WHERE id = ?`,
      [valor, id]);
    await Banco.salvar();
  }

  // totais do RELATÓRIO por médico (memoizado por competência + versão do banco)
  let _cacheTot = { chave: null, mapa: null };
  function totaisRelatorio(comp) {
    const chave = comp + '|' + (Banco._versao || 0);
    if (_cacheTot.chave === chave) return _cacheTot.mapa;
    const mapa = (window.AtlasRelatorios && AtlasRelatorios.totaisPorMedico)
      ? AtlasRelatorios.totaisPorMedico(comp) : new Map();
    _cacheTot = { chave, mapa };
    return mapa;
  }
  function conferir(l, tot) {
    if (l.status_especial) return { estado: 'especial', dif: 0 };
    const rel = tot.get(l.nome_normalizado);
    const bruto = l.valor_bruto;
    if (rel == null && (bruto == null || bruto === '')) return { estado: 'vazio', dif: 0 };
    if (rel == null) return { estado: 'sem_relatorio', dif: 0 };
    if (bruto == null || bruto === '') return { estado: 'sem_nota', rel: rel.total, dif: 0 };
    const dif = (Number(bruto) || 0) - rel.total;
    return Math.abs(dif) < 0.015
      ? { estado: 'bateu', rel: rel.total, dif: 0 }
      : { estado: 'divergiu', rel: rel.total, dif };
  }

  // ── pdf.js (local, lazy) ─────────────────────────────────────────────
  let _pdfCarregando = null;
  function carregarPdfJs() {
    if (window.pdfjsLib) return Promise.resolve();
    if (_pdfCarregando) return _pdfCarregando;
    const um = (src) => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('Falha ao carregar ' + src));
      document.head.appendChild(s);
    });
    // ordem importa: o worker ANTES define window.pdfjsWorker e o pdf.js
    // entra em modo "fake worker" (thread principal) — o único que funciona
    // em file:// sem servidor
    _pdfCarregando = um('libs/pdf.worker.min.js').then(() => um('libs/pdf.min.js'));
    return _pdfCarregando;
  }

  /** Extrai texto de todas as páginas e caça bruto/líquido/número. */
  async function lerNotaPdf(arrayBuffer) {
    await carregarPdfJs();
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
    let texto = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      texto += tc.items.map(i => i.str).join(' ') + '\n';
    }
    try { doc.destroy(); } catch (e) {}
    // normalização PRÓPRIA: maiúsculas sem acento MAS preservando pontuação —
    // o Utilidades.normalizar apaga pontos/vírgulas e destruiria os valores
    const T = String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/\s+/g, ' ');

    const numBR = (s) => {
      const m = String(s).replace(/[^\d.,]/g, '');
      if (!m) return null;
      // pt-BR: 1.234,56 · também aceita 1234.56
      const v = m.includes(',') ? m.replace(/\./g, '').replace(',', '.') : m;
      const n = parseFloat(v);
      return isFinite(n) ? n : null;
    };
    const acharValor = (rotulos) => {
      for (const r of rotulos) {
        const re = new RegExp(r + '[^0-9]{0,25}R?\\$?\\s*([\\d.]+,\\d{2}|[\\d,]+\\.\\d{2}|\\d+)', 'i');
        const m = T.match(re);
        if (m) { const n = numBR(m[1]); if (n != null && n > 0) return n; }
      }
      return null;
    };
    const liquido = acharValor([
      'VALOR LIQUIDO DA NFS-?E', 'VALOR LIQUIDO DA NOTA', 'VALOR LIQUIDO', 'VLR\\.? LIQUIDO']);
    const bruto = acharValor([
      'VALOR TOTAL DA NOTA', 'VALOR TOTAL DOS SERVICOS', 'VALOR DOS SERVICOS',
      'VALOR DO SERVICO', 'VALOR BRUTO', 'VALOR TOTAL', 'VALOR SERVICOS']);
    let numero = null;
    for (const re of [
      /NUMERO DA NFS-?E[^0-9]{0,20}(\d{1,15})/,
      /NUMERO DA NOTA[^0-9]{0,20}(\d{1,15})/,
      /NFS-?E[^0-9A-Z]{0,6}N[ºO°.]?\s*(\d{1,15})/,
      /NOTA FISCAL[^0-9]{0,30}N?[ºO°.]?\s*(\d{1,15})/,
      /\bNUMERO\b[^0-9]{0,12}(\d{1,15})/,
    ]) {
      const m = T.match(re);
      if (m) { numero = m[1].replace(/^0+(?=\d)/, ''); break; }
    }
    return { bruto, liquido, numero, temTexto: T.trim().length > 30 };
  }

  // ── importação da planilha CONTROLE DE REPASSE INTERNO ───────────────
  /** Acha o mês num texto ("repasse_mar2026", "Março/2026") — nome/abreviação
   *  mais LONGO que aparecer, com o ano. Devolve 'AAAA-MM' ou null. */
  function _mesAnoDe(texto) {
    const t = norm(texto || '').toLowerCase();
    const anoM = t.match(/(20\d{2})/);
    if (!anoM) return null;
    let melhor = null;
    for (const k of Object.keys(MES_ABREV)) {
      if (t.includes(k) && (!melhor || k.length > melhor.length)) melhor = k;
    }
    return melhor ? `${anoM[1]}-${String(MES_ABREV[melhor]).padStart(2, '0')}` : null;
  }
  function compDaAba(nomeAba, tituloB3) {
    // 1º o NOME da aba (mais confiável — o título B3 já veio errado por
    // cópia de aba na planilha real); 2º o B3 "Competência: Março/2026"
    return _mesAnoDe(nomeAba) || _mesAnoDe(tituloB3);
  }

  function importarWorkbook(wb) {
    const res = { abas: [], cadNovos: 0, cadAtualizados: 0, linhas: 0, avisos: [] };
    const boolDe = (v) => v === true || /^(TRUE|VERDADEIRO|SIM|X|OK|1)$/i.test(String(v || '').trim());
    for (const nomeAba of wb.SheetNames) {
      if (!/repasse/i.test(nomeAba)) continue;
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], {
        header: 1, raw: true, defval: null, range: { s: { c: 0, r: 0 }, e: { c: 12, r: 400 } } });
      // acha o cabeçalho (linha com "Nome do Profissional")
      let hr = -1, col = {};
      for (let r = 0; r < Math.min(rows.length, 12); r++) {
        const linha = rows[r] || [];
        for (let c = 0; c < linha.length; c++) {
          const v = norm(linha[c] || '');
          if (/NOME DO PROFISSIONAL|^NOME$/.test(v)) { hr = r; break; }
        }
        if (hr >= 0) {
          (rows[hr] || []).forEach((v, c) => {
            const t = norm(v || '');
            if (/CONSOLIDACAO|^OC\b|\/OC/.test(t)) col.oc = c;
            else if (/NOME/.test(t)) col.nome = c;
            else if (/RAZAO/.test(t)) col.razao = c;
            else if (/CNPJ/.test(t)) col.cnpj = c;
            else if (/MAIL/.test(t)) col.email = c;
            else if (/^ENVIADO$/.test(t)) col.flagF = c, col.flagFTipo = 'email_enviado';
            else if (/^RECEBIDO$/.test(t)) col.flagF = c, col.flagFTipo = 'nota_recebida';
            else if (/BRUTO/.test(t)) col.bruto = c;
            else if (/LIQUIDO/.test(t)) col.liquido = c;
            else if (/^NF$|NUMERO/.test(t)) col.nf = c;
            else if (/CAV/.test(t)) col.cav = c;
          });
          break;
        }
      }
      if (hr < 0 || col.nome == null) { res.avisos.push(`Aba "${nomeAba}": cabeçalho não encontrado — pulada.`); continue; }
      const comp = compDaAba(nomeAba, (rows[2] || [])[1]);
      if (!comp) { res.avisos.push(`Aba "${nomeAba}": competência não identificada — pulada.`); continue; }

      let nLinhas = 0;
      for (let r = hr + 1; r < rows.length; r++) {
        const linha = rows[r] || [];
        const nome = String(linha[col.nome] || '').trim();
        if (!nome) continue;
        const nnorm = norm(nome);
        const razao = String(linha[col.razao] || '').trim() || null;
        const cnpj = String(linha[col.cnpj] || '').trim() || null;
        const emails = String(linha[col.email] || '').split('/').map(x => x.trim()).filter(Boolean);
        // upsert do cadastro (a aba mais recente vence nos contatos)
        const ex = Banco.query(`SELECT id FROM notas_cadastro WHERE nome_normalizado = ?`, [nnorm])[0];
        if (ex) {
          Banco.executar(`UPDATE notas_cadastro SET razao_social = COALESCE(?, razao_social),
              cnpj = COALESCE(?, cnpj), email_medico = COALESCE(?, email_medico),
              email_contador = COALESCE(?, email_contador) WHERE id = ?`,
            [razao, cnpj, emails[0] || null, emails[1] || null, ex.id]);
          res.cadAtualizados++;
        } else {
          Banco.executar(`INSERT INTO notas_cadastro (nome, nome_normalizado, razao_social, cnpj,
              email_medico, email_contador, ativo) VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [nome, nnorm, razao, cnpj, emails[0] || null, emails[1] || null]);
          res.cadNovos++;
        }
        // linha de controle da competência
        const brutoRaw = col.bruto != null ? linha[col.bruto] : null;
        const liqRaw = col.liquido != null ? linha[col.liquido] : null;
        const bruto = typeof brutoRaw === 'number' ? brutoRaw : null;
        const liquido = typeof liqRaw === 'number' ? liqRaw : null;
        const especiais = [];
        if (brutoRaw != null && typeof brutoRaw !== 'number' && String(brutoRaw).trim()) especiais.push(String(brutoRaw).trim());
        if (liqRaw != null && typeof liqRaw !== 'number' && String(liqRaw).trim()) especiais.push(String(liqRaw).trim());
        const flag = col.flagF != null ? boolDe(linha[col.flagF]) : false;
        Banco.executar(`INSERT INTO notas_controle (competencia, nome_normalizado, oc,
            email_enviado, nota_recebida, cav_enviado, valor_bruto, valor_liquido, nf_numero,
            origem_valores, status_especial, atualizado_em)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'planilha', ?, datetime('now'))
          ON CONFLICT(competencia, nome_normalizado) DO UPDATE SET
            oc = excluded.oc,
            email_enviado = excluded.email_enviado, nota_recebida = excluded.nota_recebida,
            cav_enviado = excluded.cav_enviado,
            valor_bruto = excluded.valor_bruto, valor_liquido = excluded.valor_liquido,
            nf_numero = excluded.nf_numero, origem_valores = excluded.origem_valores,
            status_especial = excluded.status_especial, atualizado_em = excluded.atualizado_em`,
          [comp, nnorm, col.oc != null ? (String(linha[col.oc] || '').trim() || null) : null,
           col.flagFTipo === 'email_enviado' && flag ? 1 : 0,
           col.flagFTipo === 'nota_recebida' && flag ? 1 : 0,
           col.cav != null && boolDe(linha[col.cav]) ? 1 : 0,
           bruto, liquido,
           col.nf != null && linha[col.nf] != null ? String(linha[col.nf]).trim() : null,
           especiais.join(' · ') || null]);
        nLinhas++;
      }
      res.abas.push({ aba: nomeAba, comp, linhas: nLinhas });
      res.linhas += nLinhas;
    }
    return res;
  }

  // ── render ───────────────────────────────────────────────────────────
  function montar() {
    _injetarCSS();
    const comps = competenciasDisponiveis();
    if (!state.competencia || (!comps.includes(state.competencia) && comps.length)) {
      state.competencia = comps[0] || null;
    }
    render();
  }

  function render() {
    const cont = document.getElementById('conteudo');
    if (!cont) return;
    const comps = competenciasDisponiveis();
    const comp = state.competencia;
    const linhas = comp ? listarControle(comp) : [];
    const tot = comp ? totaisRelatorio(comp) : new Map();
    const cads = listarCadastro();

    // conferência + filtros
    const enriquecidas = linhas.map(l => ({ ...l, conf: conferir(l, tot) }));
    state._ultimaLista = enriquecidas;   // V909: o modal do e-mail extrai daqui
    // V922: busca aceita VÁRIOS termos separados por vírgula (união)
    const termos = String(state.busca || '').split(',').map(t => t.trim()).filter(Boolean);
    let visiveis = !termos.length ? enriquecidas
      : enriquecidas.filter(l => termos.some(t => {
          const b = norm(t);
          return norm(l.nome || l.nome_normalizado).includes(b)
            || norm(l.razao_social).includes(b) || String(l.cnpj || '').includes(t);
        }));
    if (state.etapa === 'sem_email') visiveis = visiveis.filter(l => !l.email_enviado && !l.status_especial);
    else if (state.etapa === 'sem_nota') visiveis = visiveis.filter(l => !l.nota_recebida && !l.status_especial);
    else if (state.etapa === 'sem_cav') visiveis = visiveis.filter(l => !l.cav_enviado && !l.status_especial);
    else if (state.etapa === 'divergiu') visiveis = visiveis.filter(l => l.conf.estado === 'divergiu');
    else if (state.etapa === 'especiais') visiveis = visiveis.filter(l => !!l.status_especial);

    const normais = enriquecidas.filter(l => !l.status_especial);
    const kpi = {
      total: enriquecidas.length,
      email: normais.filter(l => l.email_enviado).length,
      nota: normais.filter(l => l.nota_recebida).length,
      cav: normais.filter(l => l.cav_enviado).length,
      normais: normais.length,
      bateu: enriquecidas.filter(l => l.conf.estado === 'bateu').length,
      divergiu: enriquecidas.filter(l => l.conf.estado === 'divergiu').length,
      especiais: enriquecidas.length - normais.length,
    };

    const chip = (id, rot) => `<button class="cn-chip ${state.etapa === id ? 'on' : ''}" data-cn-etapa="${id}">${rot}</button>`;
    const card = (rot, valor, sub, extra) => `
      <div class="cn-card ${extra || ''}">
        <div class="cn-card-rot">${rot}</div>
        <div class="cn-card-val">${valor}</div>
        <div class="cn-card-sub">${sub || ''}</div>
      </div>`;

    cont.innerHTML = `
      <header class="page-header">
        <div>
          <h2>Controle de Notas</h2>
          <div class="subtitle">Relatório enviado → nota recebida → CAV · conferência automática contra o Relatório</div>
        </div>
        <div class="cn-header-acoes">
          <select id="cn-comp" class="cn-select mono">
            ${comps.length ? comps.map(c => `<option value="${c}" ${c === comp ? 'selected' : ''}>${compLabel(c)}</option>`).join('')
              : '<option value="">— sem competências —</option>'}
          </select>
          <button class="btn" id="cn-gerar" title="Cria as linhas desta competência para todos os médicos ativos do cadastro (não duplica quem já existe)">➕ Gerar mês</button>
          <button class="btn" id="cn-cadastro">👥 Cadastro (${cads.length})</button>
          <button class="btn" id="cn-importar" title="Importa a planilha CONTROLE DE REPASSE INTERNO (cadastro + histórico das abas repasse_*)">📥 Importar planilha</button>
          <button class="btn btn-primary" id="cn-exportar">↓ Exportar Excel</button>
        </div>
      </header>

      <div class="cn-cards">
        ${card('Médicos no mês', kpi.total, kpi.especiais ? `${kpi.especiais} especiais (distrato/adiant.)` : '')}
        ${card('Email enviado', `${kpi.email}/${kpi.normais}`, kpi.normais - kpi.email ? `${kpi.normais - kpi.email} pendentes` : 'completo ✓')}
        ${card('Nota recebida', `${kpi.nota}/${kpi.normais}`, kpi.normais - kpi.nota ? `${kpi.normais - kpi.nota} pendentes` : 'completo ✓')}
        ${card('Enviada ao CAV', `${kpi.cav}/${kpi.normais}`, kpi.normais - kpi.cav ? `${kpi.normais - kpi.cav} pendentes` : 'completo ✓')}
        ${card('Conferência', `${kpi.bateu} ✓ · ${kpi.divergiu} ✕`, 'nota × relatório', kpi.divergiu ? 'cn-card-alerta' : '')}
      </div>

      <div class="cn-filtros">
        <input type="text" id="cn-busca" class="cn-busca" placeholder="Buscar médico, razão social ou CNPJ — vírgula p/ vários..." value="${esc(state.busca)}">
        ${chip('todas', 'Todos')}
        ${chip('sem_email', `Falta email (${kpi.normais - kpi.email})`)}
        ${chip('sem_nota', `Falta nota (${kpi.normais - kpi.nota})`)}
        ${chip('sem_cav', `Falta CAV (${kpi.normais - kpi.cav})`)}
        ${chip('divergiu', `Divergiu (${kpi.divergiu})`)}
        ${chip('especiais', `Especiais (${kpi.especiais})`)}
        <button class="cn-btn-email" id="cn-email"
          title="Monta a estrutura do e-mail de emissão de nota: pega a data de pagamento importada no QVIS, pergunta o prazo da nota e extrai título, destinatários e o corpo pronto por médico">
          ✉ Estrutura do e-mail
        </button>
      </div>

      ${!comp ? `<div class="cn-vazio">Nenhuma competência ainda. Importe a planilha de controle ou rode um cálculo de repasse e clique em <strong>➕ Gerar mês</strong>.</div>`
      : !linhas.length ? `<div class="cn-vazio">Sem linhas em <strong>${compLabel(comp)}</strong>. Clique em <strong>➕ Gerar mês</strong> para criar uma linha por médico do cadastro, ou importe a planilha.</div>`
      : `
      <div class="cn-tab-wrap">
        <table class="cn-tab">
          <thead><tr>
            <th>Médico / PJ</th><th>OC</th>
            <th class="cn-c" title="O ciclo: email do relatório → nota recebida → enviada ao CAV">Etapas</th>
            <th title="Bruto, líquido e número da nota — clique para editar">Nota fiscal</th>
            <th>Anexo</th>
            <th title="Total do Relatório do médico na competência × valor bruto da nota">Conferência</th>
            <th>Status / Obs</th>
          </tr></thead>
          <tbody>
            ${visiveis.map(l => linhaHtml(l)).join('') || '<tr><td colspan="7" class="cn-vazio-tab">Nenhuma linha com este filtro.</td></tr>'}
          </tbody>
        </table>
      </div>`}
      ${renderModalCadastro(cads)}
      ${renderModalEmail(enriquecidas)}
    `;
    // V980: os modais (e-mail, cadastro) saem do #conteudo e vão para o <body>.
    // Dentro do .main (que tem transform) o "position: fixed" do overlay vira
    // relativo ao .main — sobrava uma faixa branca no topo (a barra do dock)
    // e o dock/botão flutuante ficavam de fora. No body o overlay cobre a
    // janela inteira; o CSS esconde o dock e o hub enquanto houver modal.
    // (try: remover o overlay dispara blur/change no campo focado → render()
    //  reentrante; a 2ª remoção do mesmo nó lançava NotFoundError)
    document.querySelectorAll('body > .cn-modal-ov').forEach(e => { try { if (e.parentNode) e.parentNode.removeChild(e); } catch (_) {} });
    cont.querySelectorAll('.cn-modal-ov').forEach(ov => document.body.appendChild(ov));
    bind();
  }

  // ── V909: estrutura do e-mail de emissão de nota ─────────────────────
  const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  function isoDe(v) {
    const s = String(v || '').trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    return '';
  }
  const brDe = (iso) => {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  };
  const diaSemanaDe = (iso) => {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return DIAS_SEMANA[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] || '';
  };
  /** Data de pagamento importada no relatório do QVIS (por mês de pagamento). */
  function dataPagamentoQvis(comp) {
    try {
      const r = Banco.query(`SELECT data_pagamento FROM qvis_snapshot_stats
        WHERE mes_pagamento = ? AND data_pagamento IS NOT NULL AND TRIM(data_pagamento) <> ''
        ORDER BY CASE WHEN origem = 'CONVENIO' THEN 0 ELSE 1 END`, [comp])[0];
      return isoDe(r && r.data_pagamento);
    } catch (e) { return ''; }
  }
  const cfgLer = (chave) => {
    try { return (Banco.query(`SELECT valor FROM config_sistema WHERE chave = ?`, [chave])[0] || {}).valor || ''; }
    catch (e) { return ''; }
  };
  const cfgGravar = (chave, valor) => {
    if (String(chave).indexOf('NOTAS_ETQ_') === 0) etqCfgInvalidar();   // V989
    try {
      Banco.executar(`INSERT INTO config_sistema (chave, valor) VALUES (?, ?)
        ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`, [chave, String(valor || '')]);
    } catch (e) {}
  };
  function assuntoPadrao(comp) {
    return `Repasse Médico ATLAS — ${compLabel(comp)} · Emissão da Nota Fiscal`;
  }
  /**
   * V915: a ESTRUTURA do e-mail virou um MODELO EDITÁVEL. Os campos variáveis
   * entram como {CAMPO} e são trocados na hora da prévia/extração:
   *   {MEDICO} {DATA_PAGAMENTO} {PRAZO} {DIA_SEMANA_PRAZO} {SALDO} {MES}
   * O modelo fica salvo em config_sistema (NOTAS_EMAIL_CORPO_MODELO) e o
   * botão "↺ modelo padrão" volta pra estrutura original.
   */
  const CORPO_PADRAO = [
    'Prezado(a) Dr(a). {MEDICO},',
    '',
    'Espero que esteja bem.',
    '',
    'Informamos que o repasse referente ao período já foi apurado e o pagamento está programado para o dia {DATA_PAGAMENTO}.',
    '',
    'Para que o pagamento ocorra na data prevista, solicitamos a gentileza de emitir e nos encaminhar a nota fiscal até {DIA_SEMANA_PRAZO}, {PRAZO}. Notas enviadas após esse prazo poderão ter o pagamento postergado para o próximo ciclo.',
    '',
    'Como o relatório passou a trazer novas informações, segue uma breve explicação sobre:',
    '',
    '• QVIS: procedimentos extraídos do relatório oficial de repasse (QVIS), pagos conforme a tabela de repasse vigente.',
    '• Produção: regras específicas da produção.',
    '• Desempenho: valores referentes aos indicadores de desempenho.',
    '• Ajustes: linhas conferidas e ajustadas na auditoria, para garantir que o valor final esteja correto.',
    '• GLOSA: procedimentos glosados pelo convênio — não pagos neste repasse (valor zerado).',
    '• Cargo Administrativo: valores referentes a função administrativa.',
    '',
    'Qualquer dúvida sobre os valores, os status ou a emissão da nota, ficamos à disposição.',
    '',
    'SALDO A EMITIR: {SALDO}',
  ].join('\n');
  /** O modelo em vigor: edição da sessão > salvo no banco > padrão. */
  function modeloCorpoAtual() {
    if (state.emailCorpoModelo != null) return state.emailCorpoModelo;
    return cfgLer('NOTAS_EMAIL_CORPO_MODELO') || CORPO_PADRAO;
  }
  /** O corpo do e-mail — o modelo com os campos da vez preenchidos. */
  function corpoEmail(nome, dtPgtoISO, prazoISO, saldo, modelo) {
    return String(modelo != null ? modelo : modeloCorpoAtual())
      .replace(/\{MEDICO\}/g, nome)
      .replace(/\{DATA_PAGAMENTO\}/g, brDe(dtPgtoISO))
      .replace(/\{PRAZO\}/g, brDe(prazoISO))
      .replace(/\{DIA_SEMANA_PRAZO\}/g, diaSemanaDe(prazoISO))
      .replace(/\{SALDO\}/g, saldo != null ? 'R$ ' + fmt(saldo) : '(conferir no relatório)')
      .replace(/\{MES\}/g, compLabel(state.competencia));
  }

  // ══ V981: ETIQUETA DA NOTA (desenho "cartão de embarque") ════════════════
  // Bloco pronto pra copiar e colar no e-mail: talão escuro com competência,
  // valor da nota e data do pagamento; parte branca com prestador (nome UMA
  // vez + CNPJ; razão social só se existir e for diferente do nome), tomador,
  // descrição do serviço, prazo da nota, e-mail de envio e assunto. Tudo em
  // tabelas + estilo inline + cores sólidas (o que o Outlook e o Gmail
  // preservam ao colar). Tomador / CNPJ / serviço / e-mail ficam gravados uma
  // vez (config NOTAS_ETQ_*) e valem pra todos os meses.
  // V984: MARCA D'ÁGUA do talão — silhueta branca translúcida do titã da ATLAS
  // (gerada de assets/atlas-mark.png), embutida em base64 pra viajar junto
  // quando a etiqueta é colada no e-mail.
  const ETQ_MARCA = 'data:image/png;base64,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';
  // V987: aviso do prazo — dois itens numerados sob "Atenção:"
  const ETQ_AVISO = [
    '1 - Notas enviadas após o prazo podem ter o pagamento remanejado para 15 dias úteis da abertura da OC.',
    '2 - Eventuais valores complementares ou deduções só ocorrerão no próximo ciclo de repasse.',
  ];
  const ETQ_PADRAO = { tomador: '', tomadorCnpj: '', servico: 'Serviços médicos — repasse competência {MES}', emailEnvio: '' };
  // V989: em CACHE. Sem isso, cada linha da lista relia as 4 chaves no banco —
  // com 120 médicos dava ~500 consultas e ~300ms a cada clique no modal.
  let _etqCfgCache = null;
  function etqCfgInvalidar() { _etqCfgCache = null; }
  function etqCfg() {
    if (_etqCfgCache) return _etqCfgCache;
    _etqCfgCache = {
      tomador:     cfgLer('NOTAS_ETQ_TOMADOR')      || ETQ_PADRAO.tomador,
      tomadorCnpj: cfgLer('NOTAS_ETQ_TOMADOR_CNPJ') || ETQ_PADRAO.tomadorCnpj,
      servico:     cfgLer('NOTAS_ETQ_SERVICO')      || ETQ_PADRAO.servico,
      emailEnvio:  cfgLer('NOTAS_ETQ_EMAIL')        || ETQ_PADRAO.emailEnvio,
    };
    return _etqCfgCache;
  }
  // V990: a etiqueta lê o CADASTRO ATUAL (nome, razão social, CNPJ, e-mails).
  // A lista do módulo é uma fotografia do último render; qualquer alteração no
  // cadastro — pela tela ou por importação de planilha — passa a valer na hora.
  // Uma consulta por VERSÃO do banco (qualquer gravação invalida o cache).
  let _cadCache = { v: -1, mapa: null };
  function cadastroAtual(nomeNorm) {
    const v = Banco._versao || 0;
    if (_cadCache.v !== v) {
      const m = new Map();
      try {
        for (const c of (Banco.query(`SELECT nome, nome_normalizado, razao_social, cnpj, email_medico, email_contador FROM notas_cadastro`) || []))
          m.set(c.nome_normalizado, c);
      } catch (e) {}
      _cadCache = { v, mapa: m };
    }
    return _cadCache.mapa.get(nomeNorm) || null;
  }
  /** Linha do módulo + o cadastro mais recente por cima. */
  function comCadastro(l) {
    const c = cadastroAtual(l.nome_normalizado);
    return c ? Object.assign({}, l, {
      nome: c.nome || l.nome,
      razao_social: c.razao_social != null ? c.razao_social : l.razao_social,
      cnpj: c.cnpj != null ? c.cnpj : l.cnpj,
      email_medico: c.email_medico != null ? c.email_medico : l.email_medico,
      email_contador: c.email_contador != null ? c.email_contador : l.email_contador,
    }) : l;
  }
  function etiquetaDados(linha, dtPgto, prazo, assunto) {
    const cfg = etqCfg();
    const l = comCadastro(linha);   // V990
    const nome = l.nome || l.nome_normalizado || '';
    const razao = String(l.razao_social || '').trim();
    const saldo = (l.conf && l.conf.rel != null) ? l.conf.rel : null;
    const mes = compLabel(state.competencia);
    return {
      nome, razao: (razao && norm(razao) !== norm(nome)) ? razao : '', cnpj: String(l.cnpj || '').trim(),
      mes, mesCurto: mes.toUpperCase(),
      saldo, valor: saldo != null ? 'R$ ' + fmt(saldo) : '(conferir no relatório)',
      pagamento: dtPgto ? brDe(dtPgto) : '—',
      prazoDia: prazo ? diaSemanaDe(prazo) : '', prazoData: prazo ? brDe(prazo) : '—',
      tomador: cfg.tomador, tomadorCnpj: cfg.tomadorCnpj,
      servico: String(cfg.servico || '').replace(/\{MES\}/g, mes),
      emailEnvio: cfg.emailEnvio, assunto: assunto || assuntoPadrao(state.competencia),
    };
  }
  function etiquetaHtml(d) {
    const lbl = (t) => `<div style="font-size:10px;letter-spacing:.12em;font-weight:700;color:${ETQ_TAL_LBL};font-family:Arial,Helvetica,sans-serif;">${esc(t)}</div>`;
    const lblB = (t) => `<div style="font-size:10px;letter-spacing:.12em;font-weight:700;color:#52606d;font-family:Arial,Helvetica,sans-serif;">${esc(t)}</div>`;
    const sep = '<div style="height:1px;background:' + ETQ_TAL_SEP + ';margin:11px 0 10px;font-size:0;line-height:0;">&nbsp;</div>';
    // V982: fontes menores, sombra leve (a prévia mostra; o e-mail mostra onde
    // o cliente suportar) e o e-mail de envio no rodapé. V983: proporção
    // DEITADA (~2,4 : 1, o rascunho do usuário) — 740px de largura (V992: era
    // 660), altura contida, cantos de 28px.
    return `<table cellpadding="0" cellspacing="0" border="0" class="cn-etq" style="border-collapse:separate;width:740px;max-width:100%;font-family:Arial,Helvetica,sans-serif;border-radius:28px;overflow:hidden;box-shadow:0 4px 14px rgba(6,40,58,0.14);">
  <tr>
    <td width="200" valign="top" style="background-color:#16456b;background-image:url(data:image/png;base64,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),linear-gradient(90deg,#16456b 0%,#1d6d92 34%,#2a9fc4 68%,#4fd3ec 100%);background-repeat:no-repeat,no-repeat;background-position:center bottom -18px,0 0;background-size:132px 132px,100% 100%;color:#FFFFFF;padding:16px 18px 14px;border-right:2px dashed #FFFFFF;border-radius:28px 0 0 28px;"><!-- V984: marca d'água -->
      ${lbl('REPASSE MÉDICO')}
      <div style="font-size:20px;font-weight:800;line-height:1.05;margin:5px 0 2px;color:#FFFFFF;">${esc(d.mesCurto)}</div>
      <div style="font-size:9.5px;color:#C8D6D2;">competência</div>
      ${sep}
      ${lbl('VALOR DA NOTA')}
      <div style="font-size:${d.saldo != null ? 18 : 12}px;font-weight:800;color:#FFFFFF;margin-top:3px;white-space:nowrap;">${esc(d.valor)}</div>
      ${sep}
      ${lbl('PAGAMENTO EM')}
      <div style="font-size:13.5px;font-weight:800;margin-top:3px;color:#FFFFFF;">${esc(d.pagamento)}</div>
    </td>
    <td valign="top" style="background:#FFFFFF;padding:14px 20px 12px;color:#06283A;border:1px solid #D3E0E9;border-left:none;border-radius:0 28px 28px 0;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family:Arial,Helvetica,sans-serif;">
        <tr><td colspan="2" style="padding:0 0 8px;border-bottom:1px solid #E4EEF4;">
          ${lblB('DOUTOR (A)')}<!-- V986: era "PRESTADOR" -->
          <div style="font-size:13.5px;font-weight:800;color:#06283A;margin-top:2px;">${esc(d.nome)}</div>
          <div style="font-size:11px;color:#52606d;margin-top:2px;">${d.razao ? esc(d.razao) + ' · ' : ''}CNPJ ${esc(d.cnpj || '—')}</div>
        </td></tr>
        <tr>
          <td width="50%" valign="top" style="padding:8px 6px 0 0;">
            ${lblB('TOMADOR')}
            <div style="font-size:11.5px;font-weight:700;margin-top:2px;color:#06283A;">${esc(d.tomador || '—')}</div>
            <div style="font-size:10.5px;color:#52606d;">CNPJ ${d.tomadorCnpj ? esc(d.tomadorCnpj) : '<i>(informe no popup)</i>'}</div>
          </td>
          <td width="50%" valign="top" style="padding:8px 0 0 6px;">
            ${lblB('DESCRIÇÃO DO SERVIÇO')}
            <div style="font-size:11px;margin-top:2px;line-height:1.35;color:#06283A;">${esc(d.servico || '—')}</div>
          </td>
        </tr>
        <tr><td colspan="2" style="padding:10px 0 0;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #189AD3;border-radius:10px;background:#EAF6FC;">
            <tr><td style="padding:7px 10px;font-size:10.5px;color:#16456b;font-family:Arial,Helvetica,sans-serif;">
              <b style="font-size:11px;">ENVIAR A NOTA ATÉ</b> &nbsp; <span style="font-size:13px;font-weight:800;color:#189AD3;">${esc((d.prazoDia ? d.prazoDia + ', ' : '') + d.prazoData)}</span>
              <div style="font-size:10px;color:#52606d;margin-top:3px;line-height:1.38;"><!-- V987 -->
                <b style="color:#16456b;">Atenção:</b><br>${ETQ_AVISO.map(esc).join('<br>')}
              </div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td colspan="2" style="padding:9px 0 0;font-size:10px;color:#52606d;"><!-- V982: sem "Assunto" (a descrição do serviço já diz) -->
          Enviar a nota para: <b style="color:#06283A;">${esc(d.emailEnvio || '(informe o e-mail de envio)')}</b>
        </td></tr>
      </table>
    </td>
  </tr>
</table>`;
  }
  function etiquetaTexto(d) {
    const L = [];
    L.push(`NOTA FISCAL · REPASSE MÉDICO · ${d.mesCurto}`);
    L.push(`Doutor(a): ${d.nome}${d.razao ? ' — ' + d.razao : ''} · CNPJ ${d.cnpj || '—'}`);
    L.push(`Tomador: ${d.tomador || '—'} · CNPJ ${d.tomadorCnpj || '(informe no popup)'}`);
    L.push(`Serviço: ${d.servico || '—'}`);
    L.push(`VALOR DA NOTA: ${d.valor}`);
    L.push(`PAGAMENTO EM: ${d.pagamento}`);
    L.push(`ENVIAR A NOTA ATÉ: ${(d.prazoDia ? d.prazoDia + ', ' : '') + d.prazoData}`);
    L.push('Atenção:');
    for (const a of ETQ_AVISO) L.push('  ' + a);
    L.push(`Enviar a nota para: ${d.emailEnvio || '(informe o e-mail de envio)'}`);
    return L.join('\n');
  }
  // ══ V984: a etiqueta também sai como IMAGEM (PNG) ════════════════════════
  // Desenhada num <canvas> (sem biblioteca externa) com o mesmo layout do HTML
  // — pra colar direto no corpo do e-mail em qualquer cliente, inclusive os
  // que ignoram tabela/fundo. Fundo transparente + sombra leve.
  // V992: cartão um pouco maior (era 660×186) e desenhado em 2× (HD)
  const ETQ_W = 740, ETQ_TALAO = 200, ETQ_R = 28, ETQ_MARGEM = 12;
  let _etqMarca = null;
  function etqMarcaImg() {
    if (!_etqMarca) { _etqMarca = new Image(); _etqMarca.src = ETQ_MARCA; }
    return _etqMarca;
  }
  function etqArco(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  // V992/V993: a etiqueta é desenhada em 2× (HD, 1528 px de pixels reais) e
  // COLADA ocupando ETQ_COLA px — a proporção que o usuário pediu (pouco mais
  // da metade da janela de escrita do e-mail). Os dois caminhos declaram essa
  // mesma largura:
  //   · text/html → <img width="960"> (Outlook novo, Gmail: rodam no navegador
  //     e ignoram a densidade do arquivo — sem isso colavam os 1528 px crus e
  //     a etiqueta tomava a janela inteira);
  //   · PNG puro  → chunk pHYs com a densidade equivalente (Word e Outlook
  //     clássico leem daí e chegam nos mesmos 960 px).
  // Em ambos sobram ~1,6 pixel de imagem por pixel de tela → nítido.
  const ETQ_ESCALA = 2, ETQ_COLA = 960;
  // V994: o talão ganhou o degradê padrão do ATLAS. Os rótulos eram #9FD3EC e
  // as divisórias #2a6a93 — cores pensadas pro azul chapado, que somem na
  // ponta clara (#4fd3ec) do degradê. Branco (cheio e a 32%) lê nos dois
  // extremos.
  const ETQ_TAL_LBL = 'rgba(255,255,255,0.92)', ETQ_TAL_SEP = 'rgba(255,255,255,0.32)';
  async function etiquetaCanvas(d, escala) {
    const S = escala || ETQ_ESCALA;
    const F = (peso, tam) => `${peso} ${tam}px Arial, Helvetica, sans-serif`;
    const medidor = document.createElement('canvas').getContext('2d');
    const larg = (t, f) => { medidor.font = f; return medidor.measureText(String(t == null ? '' : t)).width; };
    const quebrar = (txt, maxW, f) => {
      const palavras = String(txt == null ? '' : txt).split(/\s+/).filter(Boolean);
      const out = []; let atual = '';
      for (const w of palavras) {
        const t = atual ? atual + ' ' + w : w;
        if (!atual || larg(t, f) <= maxW) atual = t; else { out.push(atual); atual = w; }
      }
      if (atual) out.push(atual);
      return out.length ? out : [''];
    };
    const xR = ETQ_TALAO + 20, LARG_DIR = ETQ_W - ETQ_TALAO - 40, COL = (LARG_DIR - 12) / 2;
    const subPrest = (d.razao ? d.razao + ' · ' : '') + 'CNPJ ' + (d.cnpj || '—');
    const avisoTit = 'Atenção:';
    const prazoTxt = (d.prazoDia ? d.prazoDia + ', ' : '') + d.prazoData;
    const emailTxt = d.emailEnvio || '(informe o e-mail de envio)';
    // ── passo 1: medir (ctx nulo só calcula o y) ──
    const montar = (ctx) => {
      const T = (txt, x, y, f, cor, esp) => {
        if (!ctx) return;
        ctx.font = f; ctx.fillStyle = cor; ctx.textBaseline = 'top';
        try { ctx.letterSpacing = esp || '0px'; } catch (_) {}
        ctx.fillText(String(txt == null ? '' : txt), x, y);
        try { ctx.letterSpacing = '0px'; } catch (_) {}
      };
      let y = 14;
      T('DOUTOR (A)', xR, y, F('bold', 10), '#52606d', '1.2px'); y += 13;   // V986
      for (const l of quebrar(d.nome, LARG_DIR, F('bold', 13.5))) { T(l, xR, y, F('bold', 13.5), '#06283A'); y += 17; }
      for (const l of quebrar(subPrest, LARG_DIR, F('normal', 11))) { T(l, xR, y, F('normal', 11), '#52606d'); y += 14; }
      y += 7;
      if (ctx) { ctx.fillStyle = '#E4EEF4'; ctx.fillRect(xR, y, LARG_DIR, 1); }
      y += 10;
      const yCols = y;
      T('TOMADOR', xR, y, F('bold', 10), '#52606d', '1.2px');
      T('DESCRIÇÃO DO SERVIÇO', xR + COL + 12, y, F('bold', 10), '#52606d', '1.2px');
      let yA = yCols + 13, yB = yCols + 13;
      for (const l of quebrar(d.tomador || '—', COL, F('bold', 11.5))) { T(l, xR, yA, F('bold', 11.5), '#06283A'); yA += 14; }
      for (const l of quebrar('CNPJ ' + (d.tomadorCnpj || '(informe no popup)'), COL, F('normal', 10.5))) { T(l, xR, yA, F('normal', 10.5), '#52606d'); yA += 13; }
      for (const l of quebrar(d.servico || '—', COL, F('normal', 11))) { T(l, xR + COL + 12, yB, F('normal', 11), '#06283A'); yB += 14; }
      y = Math.max(yA, yB) + 10;
      // caixa do prazo
      const avisoL = [].concat(...ETQ_AVISO.map(t => quebrar(t, LARG_DIR - 20, F('normal', 10))));
      const boxH = 7 + 13 + 3 + 13 + avisoL.length * 12 + 7;   // V987: título "Atenção:" + itens
      if (ctx) {
        etqArco(ctx, xR + 0.5, y + 0.5, LARG_DIR - 1, boxH - 1, 10);
        ctx.fillStyle = '#EAF6FC'; ctx.fill();
        ctx.strokeStyle = '#189AD3'; ctx.lineWidth = 1; ctx.stroke();
      }
      const tit = 'ENVIAR A NOTA ATÉ';
      T(tit, xR + 10, y + 8, F('bold', 11), '#16456b', '0.6px');
      T(prazoTxt, xR + 10 + larg(tit, F('bold', 11)) + 14, y + 6.5, F('bold', 13), '#189AD3');
      let yAv = y + 23;
      T(avisoTit, xR + 10, yAv, F('bold', 10), '#16456b'); yAv += 13;
      for (const l of avisoL) { T(l, xR + 10, yAv, F('normal', 10), '#52606d'); yAv += 12; }
      y += boxH + 9;
      const rot = 'Enviar a nota para: ';
      T(rot, xR, y, F('normal', 10), '#52606d');
      const wRot = larg(rot, F('normal', 10));
      const emailL = quebrar(emailTxt, LARG_DIR - wRot, F('bold', 10));
      T(emailL[0], xR + wRot, y, F('bold', 10), '#06283A'); y += 12;
      for (const l of emailL.slice(1)) { T(l, xR, y, F('bold', 10), '#06283A'); y += 12; }
      return y + 12;
    };
    const hDir = montar(null);
    const H = Math.max(hDir, 252);
    const c = document.createElement('canvas');
    c.width = Math.round((ETQ_W + ETQ_MARGEM * 2) * S);
    c.height = Math.round((H + ETQ_MARGEM * 2) * S);
    const ctx = c.getContext('2d');
    ctx.scale(S, S);
    ctx.translate(ETQ_MARGEM, ETQ_MARGEM);
    // sombra leve + cartão
    ctx.save();
    ctx.shadowColor = 'rgba(6,40,58,0.16)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
    etqArco(ctx, 0, 0, ETQ_W, H, ETQ_R); ctx.fillStyle = '#FFFFFF'; ctx.fill();
    ctx.restore();
    // recorta tudo ao cartão
    ctx.save();
    etqArco(ctx, 0, 0, ETQ_W, H, ETQ_R); ctx.clip();
    // V994: talão com o degradê padrão do ATLAS (mesmo dos cabeçalhos)
    const gTalao = ctx.createLinearGradient(0, 0, ETQ_TALAO, 0);
    gTalao.addColorStop(0, '#16456b'); gTalao.addColorStop(0.34, '#1d6d92');
    gTalao.addColorStop(0.68, '#2a9fc4'); gTalao.addColorStop(1, '#4fd3ec');
    ctx.fillStyle = gTalao; ctx.fillRect(0, 0, ETQ_TALAO, H);
    // marca d'água
    try {
      const im = etqMarcaImg();
      if (im.complete && im.naturalWidth) ctx.drawImage(im, (ETQ_TALAO - 132) / 2, H - 114, 132, 132);
    } catch (_) {}
    // divisória tracejada
    ctx.save();
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    // (dentro do talão: branco sobre branco não apareceria do lado direito)
    ctx.beginPath(); ctx.moveTo(ETQ_TALAO - 1, 0); ctx.lineTo(ETQ_TALAO - 1, H); ctx.stroke();
    ctx.restore();
    // talão
    const TT = (txt, x, y, f, cor, esp) => {
      ctx.font = f; ctx.fillStyle = cor; ctx.textBaseline = 'top';
      try { ctx.letterSpacing = esp || '0px'; } catch (_) {}
      ctx.fillText(String(txt == null ? '' : txt), x, y);
      try { ctx.letterSpacing = '0px'; } catch (_) {}
    };
    let yT = 16;
    TT('REPASSE MÉDICO', 18, yT, F('bold', 10), ETQ_TAL_LBL, '1.2px'); yT += 17;
    TT(d.mesCurto, 18, yT, F('bold', 20), '#FFFFFF'); yT += 25;
    TT('competência', 18, yT, F('normal', 9.5), '#C8D6D2'); yT += 18;
    ctx.fillStyle = ETQ_TAL_SEP; ctx.fillRect(18, yT, ETQ_TALAO - 36, 1); yT += 11;
    TT('VALOR DA NOTA', 18, yT, F('bold', 10), ETQ_TAL_LBL, '1.2px'); yT += 16;
    TT(d.valor, 18, yT, F('bold', d.saldo != null ? 18 : 12), '#FFFFFF'); yT += (d.saldo != null ? 24 : 18);
    ctx.fillStyle = ETQ_TAL_SEP; ctx.fillRect(18, yT, ETQ_TALAO - 36, 1); yT += 11;
    TT('PAGAMENTO EM', 18, yT, F('bold', 10), ETQ_TAL_LBL, '1.2px'); yT += 16;
    TT(d.pagamento, 18, yT, F('bold', 13.5), '#FFFFFF');
    // lado direito
    montar(ctx);
    ctx.restore();
    // contorno do lado branco
    ctx.save();
    etqArco(ctx, 0.5, 0.5, ETQ_W - 1, H - 1, ETQ_R);
    ctx.strokeStyle = '#D3E0E9'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    return c;
  }
  function etqBlob(c) { return new Promise(r => c.toBlob(r, 'image/png')); }
  /** CRC-32 dos chunks do PNG. */
  let _crcTab = null;
  function etqCrc32(buf) {
    if (!_crcTab) {
      _crcTab = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        _crcTab[n] = c >>> 0;
      }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = _crcTab[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  /** Insere o chunk pHYs (densidade) logo após o IHDR. */
  function etqPngComDpi(bytes, dpi) {
    const ppm = Math.round(dpi / 0.0254);            // pixels por metro
    const pos = 8 + 25;                              // assinatura + IHDR completo
    if (bytes.length < pos) return bytes;
    const chunk = new Uint8Array(21);                // 4 tam + 4 tipo + 9 dados + 4 crc
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, 9);
    chunk.set([0x70, 0x48, 0x59, 0x73], 4);          // "pHYs"
    dv.setUint32(8, ppm); dv.setUint32(12, ppm);
    chunk[16] = 1;                                   // unidade: metro
    dv.setUint32(17, etqCrc32(chunk.subarray(4, 17)));
    const out = new Uint8Array(bytes.length + 21);
    out.set(bytes.subarray(0, pos), 0);
    out.set(chunk, pos);
    out.set(bytes.subarray(pos), pos + 21);
    return out;
  }
  async function etiquetaImagem(d, escala) {
    const im = etqMarcaImg();
    if (!im.complete) { try { await im.decode(); } catch (_) { await new Promise(r => { im.onload = r; im.onerror = r; setTimeout(r, 1200); }); } }
    const S = escala || ETQ_ESCALA;
    const c = await etiquetaCanvas(d, S);
    let blob = await etqBlob(c);
    // V993: carimba a densidade que faz o PNG ocupar ETQ_COLA px ao ser colado
    try {
      const bytes = etqPngComDpi(new Uint8Array(await blob.arrayBuffer()), 96 * c.width / ETQ_COLA);
      blob = new Blob([bytes], { type: 'image/png' });
    } catch (e) { /* sem densidade: segue o PNG cru */ }
    // V989: dataUrl PREGUIÇOSO — gerá-lo sempre custava um 2º encode do PNG
    // (~150 KB) em toda cópia, mesmo quando só o blob era usado.
    // V993: e agora sai do PRÓPRIO blob (FileReader), sem reencodar o canvas —
    // assim a data URL carrega a densidade carimbada acima.
    const url = () => new Promise((ok, falha) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result); fr.onerror = () => falha(fr.error);
      fr.readAsDataURL(blob);
    });
    return { blob, canvas: c, largura: ETQ_COLA, dataUrl: url };
  }
  /** V986/V988: copia a etiqueta como IMAGEM (PNG) — colada assim ela NÃO
   *  perde o layout em nenhum cliente de e-mail.
   *  Duas armadilhas resolvidas aqui:
   *   1) desenhar a imagem ANTES de escrever no clipboard consome o "gesto do
   *      clique" e o navegador recusa a escrita → o ClipboardItem recebe a
   *      PROMESSA do blob e a escrita é disparada ainda dentro do clique;
   *   2) mandar text/plain junto fazia alguns clientes de e-mail colarem o
   *      TEXTO em vez da figura → nunca vai texto puro.
   *  V993: junto do PNG vai também um text/html com a MESMA figura embutida e
   *  a largura declarada (764 px). O Outlook novo e o Gmail rodam no navegador
   *  e ignoram a densidade do arquivo: colando o PNG cru, entravam os 1528 px
   *  crus e a etiqueta ocupava a janela inteira. Pelo text/html eles respeitam
   *  o width e colam em 764 px — com o dobro de pixels por trás, em HD. Quem
   *  não lê HTML (editores simples) continua recebendo o PNG.
   *  Plano B: HTML com a imagem embutida (cola como figura no Outlook/Gmail).
   *  Plano C: o texto puro. Devolve 'imagem' | 'html' | 'texto' | null. */
  function etqImgTag(img, extra) {
    return img.dataUrl().then(u => `<img src="${u}" width="${img.largura}" style="width:${img.largura}px;${extra || ''}display:block;border:0" alt="Etiqueta da nota fiscal">`);
  }
  function copiarEtiquetaPNG(d) {
    const promessa = etiquetaImagem(d);   // começa a desenhar, mas NÃO espera aqui
    const viaApi = (() => {
      try {
        if (!(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write)) return null;
        return navigator.clipboard.write([new ClipboardItem({
          'image/png': promessa.then(i => i.blob),
          'text/html': promessa.then(i => etqImgTag(i)).then(h => new Blob([h], { type: 'text/html' })),
        })]);
      } catch (e) { return null; }
    })();
    return (viaApi || Promise.reject(new Error('sem API')))
      .then(() => 'imagem')
      .catch(async () => {
        const img = await promessa;
        try {
          const box = document.createElement('div');
          box.contentEditable = 'true';
          box.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
          box.innerHTML = await etqImgTag(img);
          document.body.appendChild(box);
          const sel = window.getSelection(); const range = document.createRange();
          range.selectNodeContents(box); sel.removeAllRanges(); sel.addRange(range);
          const okc = document.execCommand('copy');
          sel.removeAllRanges(); box.remove();
          if (okc) return 'html';
        } catch (e) {}
        try { await navigator.clipboard.writeText(etiquetaTexto(d)); return 'texto'; } catch (e) { return null; }
      });
  }

  /** Copia HTML formatado (text/html) + texto puro (text/plain); cai no
   *  execCommand com seleção do HTML se a API do clipboard recusar. */
  async function copiarRico(html, texto) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([texto], { type: 'text/plain' }),
        })]);
        return true;
      }
    } catch (e) { /* cai no fallback */ }
    try {
      const box = document.createElement('div');
      box.contentEditable = 'true';
      box.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      box.innerHTML = html;
      document.body.appendChild(box);
      const sel = window.getSelection(); const range = document.createRange();
      range.selectNodeContents(box); sel.removeAllRanges(); sel.addRange(range);
      const okc = document.execCommand('copy');
      sel.removeAllRanges(); box.remove();
      if (okc) return true;
    } catch (e) {}
    try { await navigator.clipboard.writeText(texto); return true; } catch (e) { return false; }
  }
  function corpoParaHtml(texto) {
    return String(texto || '').split('\n').map(l => l.trim() === '' ? '<br>' : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#06283A;line-height:1.45;">${esc(l)}</div>`).join('');
  }
  // V989: fonte única das linhas da lista — usa só o que já veio na consulta
  // do módulo (nome, saldo conferido, CNPJ); montar a etiqueta inteira por
  // médico relia a config no banco e pesava a cada render.
  function etqLinhasHtml(doEscopo) {
    return doEscopo.map(linha => {
      const l = comCadastro(linha);   // V990
      const nome = l.nome || l.nome_normalizado || '';
      const saldo = (l.conf && l.conf.rel != null) ? l.conf.rel : null;
      const valor = saldo != null ? 'R$ ' + fmt(saldo) : '(conferir no relatório)';
      const cnpj = String(l.cnpj || '').trim();
      return `<div class="cn-etq-lin ${l.id === state.etqSel ? 'sel' : ''}" data-etq-id="${l.id}">
        <span class="cn-etq-nome"><strong>${esc(nome)}</strong> <small>· ${esc(valor)}${cnpj ? ' · CNPJ ' + esc(cnpj) : ' · <em>sem CNPJ no cadastro</em>'}</small></span>
        <span class="cn-etq-acoes">
          <button class="cn-mini" data-etq-ver="${l.id}" title="Mostrar a etiqueta deste médico na prévia">Ver</button>
          <button class="cn-mini cn-mini-salvar" data-etq-copiar="${l.id}" title="Copia a etiqueta como IMAGEM (PNG) — colada assim ela não perde o layout em nenhum cliente de e-mail">Copiar etiqueta (imagem)</button>
          <button class="cn-mini cn-mini-ver" data-etq-copiar-tudo="${l.id}" title="Copia o corpo do e-mail + a etiqueta (a etiqueta vai como imagem)">Copiar e-mail completo</button>
        </span>
      </div>`;
    }).join('');
  }
  function renderEtiquetaSecao(doEscopo, dtPgto, prazo, assunto) {
    const cfg = etqCfg();
    if (!state.etqSel || !doEscopo.some(l => l.id === state.etqSel)) state.etqSel = doEscopo[0] ? doEscopo[0].id : null;
    const sel = doEscopo.find(l => l.id === state.etqSel);
    const linhas = etqLinhasHtml(doEscopo);
    return `

      <div class="cn-email-prev-tit" style="display:flex; align-items:center; gap:8px; margin-top:18px;">
        <span>🏷 Etiqueta da nota <small style="text-transform:none; letter-spacing:0; font-weight:400;">— bloco pronto pra colar no e-mail, com o valor que o médico deve emitir</small></span>
      </div>
      <div class="cn-etq-cfg">
        <label>Tomador <input type="text" id="cn-etq-tomador" value="${esc(cfg.tomador)}" placeholder="Nome do tomador"></label>
        <label>CNPJ do tomador (o hospital atendido) <input type="text" id="cn-etq-tomador-cnpj" value="${esc(cfg.tomadorCnpj)}" placeholder="preencha uma vez — entra no card"></label>
        <label>Descrição do serviço <input type="text" id="cn-etq-servico" value="${esc(cfg.servico)}" placeholder="Serviços médicos — repasse competência {MES}"></label>
        <div class="cn-etq-cfg-acoes"><!-- V985 -->
          <button class="cn-mini cn-mini-salvar" id="cn-etq-cfg-salvar" title="Grava tomador, CNPJ e descrição no banco — valem para todos os meses">💾 Salvar tomador, CNPJ e serviço</button>
          <small>Fica gravado no banco e vale para todas as competências.</small>
        </div>
      </div>
      <div class="cn-etq-lista">${linhas || '<div class="cn-email-aviso">Nenhum médico no recorte escolhido.</div>'}</div>
      ${sel ? `<div class="cn-email-prev-tit" id="cn-etq-prev-tit">Prévia da etiqueta — ${esc(sel.nome || sel.nome_normalizado)}</div>
      <div class="cn-etq-prev" id="cn-etq-prev">${etiquetaHtml(etiquetaDados(sel, dtPgto, prazo, assunto))}</div>` : ''}`;
  }

  function renderModalEmail(enriquecidas) {
    if (!state.emailAberto) return '';
    const comp = state.competencia;
    const dtQvis = dataPagamentoQvis(comp);
    const dtPgto = state.emailDtPgto || cfgLer(`NOTAS_EMAIL_DTPGTO_${comp}`) || dtQvis;
    const prazo = state.emailPrazo || cfgLer(`NOTAS_EMAIL_PRAZO_${comp}`) || '';
    const assunto = state.emailAssunto != null ? state.emailAssunto
      : (cfgLer('NOTAS_EMAIL_ASSUNTO_MODELO') || assuntoPadrao(comp));
    const alvo = (state.emailEscopo || 'pendentes');
    const candidatos = enriquecidas.filter(l => !l.status_especial);
    const pendentes = candidatos.filter(l => !l.email_enviado);
    const doEscopo = alvo === 'todos' ? candidatos : pendentes;
    const semEmail = doEscopo.filter(l => !l.email_medico && !l.email_contador).length;
    const exemplo = doEscopo[0];
    // V915: dados do exemplo pra prévia ao vivo enquanto o modelo é digitado
    state._emailExemplo = exemplo ? {
      nome: exemplo.nome || exemplo.nome_normalizado,
      saldo: (exemplo.conf && exemplo.conf.rel != null) ? exemplo.conf.rel : null,
    } : null;
    return `
      <div class="cn-modal-ov" id="cn-email-ov">
        <div class="cn-modal cn-modal-email">
          <div class="cn-modal-head"><strong>✉ Estrutura do e-mail — ${compLabel(comp)}</strong>
            <button class="cn-mini" id="cn-email-fechar">✕</button></div>
          <div class="cn-modal-body">
            <div class="cn-email-grid">
              <label class="cn-email-campo">
                <span>Data do pagamento ${dtQvis ? '<small class="cn-email-fonte">· importada do relatório QVIS</small>'
                  : '<small class="cn-email-fonte cn-email-falta">· não achei no QVIS deste mês — informe</small>'}</span>
                <input type="date" id="cn-email-dtpgto" value="${esc(dtPgto)}">
              </label>
              <label class="cn-email-campo">
                <span>Nota fiscal até <small class="cn-email-fonte">· o prazo que entra no texto</small></span>
                <input type="date" id="cn-email-prazo" value="${esc(prazo)}">
              </label>
              <label class="cn-email-campo cn-email-campo-larga">
                <span>Título (assunto) do e-mail</span>
                <input type="text" id="cn-email-assunto" value="${esc(assunto)}">
              </label>
              <div class="cn-email-campo cn-email-campo-larga"><!-- V982: e-mail(s) para onde o médico manda a nota — entra na etiqueta -->
                <span>E-mail para envio da nota <small class="cn-email-fonte">· para onde o médico manda a nota; vários separados por vírgula ou ponto e vírgula</small></span>
                <div class="cn-etq-linha-salvar"><!-- V985: botão que GRAVA NO BANCO (antes só ficava na memória e sumia ao fechar o app) -->
                  <input type="text" id="cn-etq-email" value="${esc(etqCfg().emailEnvio)}" placeholder="notas@…; financeiro@…">
                  <button class="cn-mini cn-mini-salvar" id="cn-etq-email-salvar" title="Grava o e-mail no banco — vale para todos os meses">💾 Salvar</button>
                </div>
              </div>
              <div class="cn-email-campo">
                <span>Para quem</span>
                <div class="cn-email-radios">
                  <label><input type="radio" name="cn-email-escopo" value="pendentes" ${alvo === 'pendentes' ? 'checked' : ''}>
                    Só quem ainda não recebeu (${pendentes.length})</label>
                  <label><input type="radio" name="cn-email-escopo" value="todos" ${alvo === 'todos' ? 'checked' : ''}>
                    Todos do mês (${candidatos.length})</label>
                </div>
              </div>
            </div>
            <div class="cn-email-aviso" ${semEmail ? '' : 'hidden'}>⚠ ${semEmail} médico(s) do recorte sem email no cadastro — saem na extração com o campo PARA vazio.</div>
            <!-- V915: a estrutura é EDITÁVEL — campos variáveis entre chaves -->
            <div class="cn-email-prev-tit" style="display:flex; align-items:center; gap:8px;">
              <span>Estrutura do e-mail <small style="text-transform:none; letter-spacing:0; font-weight:400;">— edite à vontade; o texto vale pra todos os e-mails da extração</small></span>
              <button class="cn-mini" id="cn-email-corpo-padrao" title="Descarta as mudanças e volta pra estrutura original" style="margin-left:auto;">↺ modelo padrão</button>
            </div>
            <div class="cn-email-tags">
              Campos que se preenchem sozinhos:
              <code>{MEDICO}</code> <code>{DATA_PAGAMENTO}</code> <code>{PRAZO}</code>
              <code>{DIA_SEMANA_PRAZO}</code> <code>{SALDO}</code> <code>{MES}</code>
            </div>
            <textarea id="cn-email-corpo" class="cn-email-corpo" spellcheck="false">${esc(modeloCorpoAtual())}</textarea>
            <div class="cn-email-prev-tit">Prévia${exemplo ? ` — ${esc(exemplo.nome || exemplo.nome_normalizado)}` : ''}</div>
            <pre class="cn-email-prev">${!exemplo
              ? 'Nenhum médico no recorte escolhido — troque para "Todos do mês" ou confira as pendências.'
              : dtPgto && prazo
                ? esc(corpoEmail(exemplo.nome || exemplo.nome_normalizado, dtPgto, prazo,
                    exemplo.conf && exemplo.conf.rel != null ? exemplo.conf.rel : null))
                : 'Preencha a data do pagamento e o prazo da nota para ver a prévia.'}</pre>
            ${renderEtiquetaSecao(doEscopo, dtPgto, prazo, assunto)}<!-- V981 -->
          </div>
          <div class="cn-modal-footer">
            <button class="btn" id="cn-email-cancelar">Cancelar</button>
            <button class="btn btn-primary" id="cn-email-extrair" ${dtPgto && prazo && doEscopo.length ? '' : 'disabled'}>
              ↓ Extrair (${doEscopo.length} e-mail${doEscopo.length === 1 ? '' : 's'})
            </button>
          </div>
        </div>
      </div>`;
  }

  async function extrairEmails(enriquecidas) {
    const comp = state.competencia;
    const dtPgto = state.emailDtPgto;
    const prazo = state.emailPrazo;
    const assunto = state.emailAssunto || assuntoPadrao(comp);
    const alvo = state.emailEscopo || 'pendentes';
    const candidatos = enriquecidas.filter(l => !l.status_especial);
    const doEscopo = alvo === 'todos' ? candidatos : candidatos.filter(l => !l.email_enviado);
    if (!doEscopo.length || !dtPgto || !prazo) return;
    if (typeof ExcelJS === 'undefined') { Utilidades.toast('ExcelJS ainda carregando — tente de novo.', 'error', 3000); return; }

    cfgGravar(`NOTAS_EMAIL_DTPGTO_${comp}`, dtPgto);
    cfgGravar(`NOTAS_EMAIL_PRAZO_${comp}`, prazo);
    cfgGravar('NOTAS_EMAIL_ASSUNTO_MODELO', assunto.replace(compLabel(comp), '{MES}'));
    // V915: o modelo editado fica guardado pros próximos meses (vazio = padrão)
    const modeloCorpo = modeloCorpoAtual();
    cfgGravar('NOTAS_EMAIL_CORPO_MODELO', modeloCorpo === CORPO_PADRAO ? '' : modeloCorpo);
    await Banco.salvar();

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('E-mails', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'MÉDICO', key: 'medico', width: 34 },
      { header: 'PARA (DESTINATÁRIOS)', key: 'para', width: 46 },
      { header: 'ASSUNTO', key: 'assunto', width: 46 },
      { header: 'SALDO A EMITIR', key: 'saldo', width: 16 },
      { header: 'CORPO DO E-MAIL', key: 'corpo', width: 110 },
    ];
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16456B' } };
    for (const linha of doEscopo) {
      const l = comCadastro(linha);   // V990: cadastro atual no PARA e no nome
      const nome = l.nome || l.nome_normalizado;
      const saldo = l.conf && l.conf.rel != null ? l.conf.rel : null;
      const r = ws.addRow({
        medico: nome,
        para: [l.email_medico, l.email_contador].filter(Boolean).join('; '),
        assunto,
        saldo: saldo != null ? saldo : '',
        corpo: corpoEmail(nome, dtPgto, prazo, saldo),
      });
      r.getCell('corpo').alignment = { wrapText: true, vertical: 'top' };
      r.alignment = { vertical: 'top' };
      if (r.number % 2 === 0) r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4FAFD' } };
    }
    ws.getColumn('saldo').numFmt = 'R$ #,##0.00';
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `emails_repasse_${comp}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    Utilidades.toast(`✓ ${doEscopo.length} e-mail(s) extraído(s) — pagamento ${brDe(dtPgto)}, nota até ${diaSemanaDe(prazo)} ${brDe(prazo)}`, 'success', 4200);
  }

  /** Iniciais pro avatar (2 letras, sem partículas). */
  function iniciaisDe(nome) {
    const PART = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E']);
    const p = norm(nome).split(' ').filter(x => x && !PART.has(x));
    return ((p[0] || '?')[0] + ((p.length > 1 ? p[p.length - 1] : p[0] || '?')[0] || '')).toUpperCase();
  }

  function linhaHtml(l) {
    const conf = l.conf;
    // V909: as 3 etapas viram uma ESTEIRA conectada (email → nota → CAV) —
    // os botões guardam os mesmos data-attrs de antes (persistência intacta)
    const passo = (campo, val, icone, rotulo) => `
      <div class="cn-passo ${val ? 'on' : ''}">
        <button class="cn-chk ${val ? 'on' : ''}" data-cn-chk="${campo}" data-id="${l.id}"
          title="${rotulo}: ${val ? 'feito — clique para desfazer' : 'pendente — clique para marcar'}">${val ? '✓' : icone}</button>
        <span class="cn-passo-rot">${rotulo}</span>
      </div>`;
    const badge =
      conf.estado === 'bateu' ? `<span class="cn-badge cn-badge-ok" title="Nota R$ ${fmt(l.valor_bruto)} × Relatório R$ ${fmt(conf.rel)}">✓ bateu</span>`
      : conf.estado === 'divergiu' ? `<span class="cn-badge cn-badge-err" title="Nota R$ ${fmt(l.valor_bruto)} × Relatório R$ ${fmt(conf.rel)}">✕ ${conf.dif > 0 ? '+' : '−'}R$ ${fmt(Math.abs(conf.dif))}</span>`
      : conf.estado === 'sem_nota' ? '<span class="cn-badge cn-badge-neutra">aguarda nota</span>'
      : conf.estado === 'sem_relatorio' ? '<span class="cn-badge cn-badge-neutra" title="O médico não aparece no Relatório desta competência (confira o nome no cadastro)">sem relatório</span>'
      : conf.estado === 'especial' ? `<span class="cn-badge cn-badge-esp">${esc(l.status_especial || 'especial')}</span>`
      : '<span class="cn-badge cn-badge-neutra">—</span>';
    const emails = [l.email_medico, l.email_contador].filter(Boolean);
    const inputNum = (campo, val, rotulo) => `
      <div class="cn-valor-bloco">
        <span class="cn-valor-rot">${rotulo}</span>
        <span class="cn-valor-caixa">${val != null ? '<span class="cn-rs">R$</span>' : ''}<input
          class="cn-inp cn-inp-num" data-cn-inp="${campo}" data-id="${l.id}"
          value="${val == null ? '' : fmt(val)}" placeholder="—"></span>
      </div>`;
    return `
      <tr class="${l.status_especial ? 'cn-tr-esp' : ''}">
        <td class="cn-td-medico">
          <div class="cn-medico">
            <span class="cn-avatar">${esc(iniciaisDe(l.nome || l.nome_normalizado))}</span>
            <div class="cn-medico-info">
              <div class="cn-nome">${esc(l.nome || l.nome_normalizado)}</div>
              <div class="cn-sub">${esc(l.razao_social || '')}${l.cnpj ? ` <span class="cn-cnpj">${esc(l.cnpj)}</span>` : ''}</div>
              <div class="cn-sub cn-sub-mails" title="${esc(emails.join('\n'))}">${
                emails.length ? `✉ ${esc(emails[0])}${emails.length > 1 ? ` <small>+${emails.length - 1}</small>` : ''}` : '<em>sem email</em>'}</div>
            </div>
          </div>
        </td>
        <td class="cn-td-oc"><input class="cn-inp cn-inp-oc" data-cn-inp="oc" data-id="${l.id}" value="${esc(l.oc || '')}" placeholder="OC"></td>
        <td class="cn-td-esteira">
          <div class="cn-esteira">
            ${passo('email_enviado', l.email_enviado, '✉', 'Email')}
            <span class="cn-fio ${l.email_enviado && l.nota_recebida ? 'on' : ''}"></span>
            ${passo('nota_recebida', l.nota_recebida, '🧾', 'Nota')}
            <span class="cn-fio ${l.nota_recebida && l.cav_enviado ? 'on' : ''}"></span>
            ${passo('cav_enviado', l.cav_enviado, '📤', 'CAV')}
          </div>
        </td>
        <td class="cn-td-valores">
          ${inputNum('valor_bruto', l.valor_bruto, 'Bruto')}
          ${inputNum('valor_liquido', l.valor_liquido, 'Líquido')}
          <div class="cn-valor-bloco">
            <span class="cn-valor-rot">NF</span>
            <span class="cn-valor-caixa"><input class="cn-inp cn-inp-nf" data-cn-inp="nf_numero" data-id="${l.id}"
              value="${esc(l.nf_numero || '')}" placeholder="—"></span>
          </div>
        </td>
        <td class="cn-anexo">
          ${l.nota_arquivo
            ? `<button class="cn-mini cn-mini-ver" data-cn-ver="${l.id}" title="Abrir ${esc(l.nota_arquivo)}">📎 ver nota</button>
               <button class="cn-mini cn-mini-x" data-cn-del="${l.id}" title="Remover o anexo">×</button>`
            : `<button class="cn-mini" data-cn-up="${l.id}" title="Anexar o PDF da nota — o módulo lê bruto/líquido/nº automaticamente">📎 anexar</button>`}
        </td>
        <td class="cn-td-conf">
          <div class="cn-rel">${conf.rel != null ? 'R$ ' + fmt(conf.rel) : '—'}</div>
          <div class="cn-rel-rot">relatório</div>
          ${badge}
        </td>
        <td class="cn-td-obs"><input class="cn-inp cn-inp-obs" data-cn-inp="status_especial" data-id="${l.id}"
          value="${esc(l.status_especial || '')}" placeholder="—" title="DISTRATO, ADIANTAMENTO, observação... (linha com status não conta como pendência)"></td>
      </tr>`;
  }

  function renderModalCadastro(cads) {
    if (!state.cadastroAberto) return '';
    const ed = state.cadEditando;
    const linha = (c) => ed === c.id ? `
      <tr class="cn-cad-ed">
        <td><input id="cn-ed-nome" value="${esc(c.nome)}"></td>
        <td><input id="cn-ed-razao" value="${esc(c.razao_social || '')}"></td>
        <td><input id="cn-ed-cnpj" value="${esc(c.cnpj || '')}"></td>
        <td><input id="cn-ed-em" value="${esc(c.email_medico || '')}"></td>
        <td><input id="cn-ed-ec" value="${esc(c.email_contador || '')}"></td>
        <td class="cn-c"><input type="checkbox" id="cn-ed-ativo" ${c.ativo ? 'checked' : ''}></td>
        <td><button class="cn-mini" data-cad-salvar="${c.id}">💾 salvar</button></td>
      </tr>` : `
      <tr>
        <td>${esc(c.nome)}</td><td>${esc(c.razao_social || '—')}</td><td class="mono">${esc(c.cnpj || '—')}</td>
        <td>${esc(c.email_medico || '—')}</td><td>${esc(c.email_contador || '—')}</td>
        <td class="cn-c">${c.ativo ? '✓' : '—'}</td>
        <td><button class="cn-mini" data-cad-editar="${c.id}">✏</button></td>
      </tr>`;
    return `
      <div class="cn-modal-ov" id="cn-cad-ov">
        <div class="cn-modal">
          <div class="cn-modal-head"><strong>👥 Cadastro de médicos (${cads.length})</strong>
            <button class="cn-mini" id="cn-cad-fechar">✕</button></div>
          <div class="cn-modal-body">
            <p class="cn-modal-help">Importado da planilha de controle (editável). O <strong>nome</strong> precisa
            bater com o do Relatório para a conferência automática funcionar.</p>
            <table class="cn-tab cn-tab-cad">
              <thead><tr><th>Nome</th><th>Razão social</th><th>CNPJ</th><th>Email médico</th><th>Email contador</th><th>Ativo</th><th></th></tr></thead>
              <tbody>${cads.map(linha).join('') || '<tr><td colspan="7" class="cn-vazio-tab">Cadastro vazio — use 📥 Importar planilha.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  // ── eventos ──────────────────────────────────────────────────────────
  function bind() {
    const $ = (id) => document.getElementById(id);
    const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };

    on('cn-comp', 'change', () => { state.competencia = $('cn-comp').value || null; render(); });
    on('cn-gerar', 'click', async () => {
      if (!state.competencia) {
        const c = prompt('Competência (AAAA-MM):', new Date().toISOString().slice(0, 7));
        if (!c || !/^\d{4}-\d{2}$/.test(c)) return;
        state.competencia = c;
      }
      const n = await gerarMes(state.competencia);
      if (n) Utilidades.toast(`✓ Linhas garantidas para ${n} médicos em ${compLabel(state.competencia)}`, 'success', 2600);
      render();
    });
    on('cn-cadastro', 'click', () => { state.cadastroAberto = true; state.cadEditando = null; render(); });
    on('cn-exportar', 'click', exportarExcel);
    on('cn-importar', 'click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.xlsx,.xls';
      inp.addEventListener('change', async () => {
        const f = inp.files[0];
        if (!f) return;
        try {
          if (typeof XLSX === 'undefined') { Utilidades.toast('Biblioteca de planilhas ainda carregando — tente de novo.', 'error', 3500); return; }
          const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', raw: true });
          Banco.db.exec('BEGIN');
          let res;
          try { res = importarWorkbook(wb); Banco.db.exec('COMMIT'); }
          catch (e) { Banco.db.exec('ROLLBACK'); throw e; }
          await Banco.salvar();
          _cacheTot = { chave: null, mapa: null };
          const abas = res.abas.map(a => `${compLabel(a.comp)} (${a.linhas})`).join(' · ');
          Utilidades.toast(`✓ ${res.linhas} linhas em ${res.abas.length} competência(s): ${abas}. Cadastro: ${res.cadNovos} novos, ${res.cadAtualizados} atualizados.`, 'success', 5200);
          if (res.avisos.length) console.warn('[notas] avisos do import:', res.avisos);
          if (res.abas.length) state.competencia = res.abas[res.abas.length - 1].comp;
          render();
        } catch (e) { console.error(e); alert('❌ Erro ao importar:\n\n' + e.message); }
      });
      inp.click();
    });
    on('cn-busca', 'input', () => {
      state.busca = $('cn-busca').value;
      clearTimeout(window.__cnBuscaT);
      window.__cnBuscaT = setTimeout(() => {
        const pos = $('cn-busca').selectionStart;
        render();
        const n = $('cn-busca');
        if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
      }, 280);
    });
    document.querySelectorAll('[data-cn-etapa]').forEach(c => c.addEventListener('click', () => {
      state.etapa = c.dataset.cnEtapa; render();
    }));

    // checkboxes das 3 etapas
    document.querySelectorAll('[data-cn-chk]').forEach(btn => btn.addEventListener('click', async () => {
      const id = +btn.dataset.id;
      const campo = btn.dataset.cnChk;
      const atual = btn.classList.contains('on');
      await salvarCampo(id, campo, atual ? 0 : 1);
      render();
    }));

    // campos editáveis (blur salva)
    document.querySelectorAll('[data-cn-inp]').forEach(inp => inp.addEventListener('blur', async () => {
      const id = +inp.dataset.id;
      const campo = inp.dataset.cnInp;
      let v = inp.value.trim();
      if (campo === 'valor_bruto' || campo === 'valor_liquido') {
        v = v === '' ? null : parseFloat(v.replace(/\./g, '').replace(',', '.'));
        if (v != null && !isFinite(v)) return;
        await salvarCampo(id, campo, v);
        await salvarCampo(id, 'origem_valores', 'manual');
      } else {
        await salvarCampo(id, campo, v || null);
      }
      render();
    }));

    // anexo: subir, ver, remover
    document.querySelectorAll('[data-cn-up]').forEach(btn => btn.addEventListener('click', () => {
      const id = +btn.dataset.cnUp;
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.pdf,application/pdf';
      inp.addEventListener('change', () => anexarNota(id, inp.files[0]));
      inp.click();
    }));
    document.querySelectorAll('[data-cn-ver]').forEach(btn => btn.addEventListener('click', () => {
      const id = +btn.dataset.cnVer;
      const r = Banco.query(`SELECT conteudo_b64, nome_arquivo FROM notas_arquivos WHERE controle_id = ?`, [id])[0];
      if (!r) { Utilidades.toast('Anexo não encontrado.', 'error', 2500); return; }
      const bytes = Uint8Array.from(atob(r.conteudo_b64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }));
    document.querySelectorAll('[data-cn-del]').forEach(btn => btn.addEventListener('click', async () => {
      const id = +btn.dataset.cnDel;
      if (!confirm('Remover o PDF anexado desta linha? (os valores digitados ficam)')) return;
      Banco.executar(`DELETE FROM notas_arquivos WHERE controle_id = ?`, [id]);
      await salvarCampo(id, 'nota_arquivo', null);
      render();
    }));

    // V909: modal da estrutura do e-mail
    on('cn-email', 'click', () => {
      state.emailAberto = true;
      state.emailDtPgto = state.emailDtPgto || cfgLer(`NOTAS_EMAIL_DTPGTO_${state.competencia}`)
        || dataPagamentoQvis(state.competencia);
      state.emailPrazo = state.emailPrazo || cfgLer(`NOTAS_EMAIL_PRAZO_${state.competencia}`);
      render();
    });
    const fecharEmail = () => { state.emailAberto = false; render(); };
    on('cn-email-fechar', 'click', fecharEmail);
    on('cn-email-cancelar', 'click', fecharEmail);
    const ovEm = $('cn-email-ov');
    if (ovEm) ovEm.addEventListener('click', (e) => { if (e.target === ovEm) fecharEmail(); });
    // V989: datas repintam só as PRÉVIAS (um render() completo refazia a matriz
    // inteira do módulo a cada troca de data)
    const atualizarDatas = () => {
      state.emailDtPgto = ($('cn-email-dtpgto') || {}).value || '';
      state.emailPrazo = ($('cn-email-prazo') || {}).value || '';
      const btn = $('cn-email-extrair');
      if (btn) btn.disabled = !(state.emailDtPgto && state.emailPrazo && (state._etqEscopoQtd || 0) > 0);
      if (typeof atualizarPrevia === 'function') atualizarPrevia();
      etqRepintarPrevia();
    };
    on('cn-email-dtpgto', 'change', atualizarDatas);
    on('cn-email-prazo', 'change', atualizarDatas);
    on('cn-email-assunto', 'change', () => { state.emailAssunto = $('cn-email-assunto').value; });
    // V989: trocar o escopo mexe SÓ no modal — o render() completo refazia a
    // matriz inteira do módulo (com 120 médicos, ~200ms a cada clique).
    document.querySelectorAll('input[name="cn-email-escopo"]').forEach(r =>
      r.addEventListener('change', () => {
        if (!r.checked) return;
        state.emailEscopo = r.value;
        const cands = (state._ultimaLista || []).filter(l => !l.status_especial);
        const doEscopo = r.value === 'todos' ? cands : cands.filter(l => !l.email_enviado);
        state._etqEscopoQtd = doEscopo.length;
        if (!doEscopo.some(l => l.id === state.etqSel)) state.etqSel = doEscopo[0] ? doEscopo[0].id : null;
        const lista = document.querySelector('.cn-etq-lista');
        if (lista) lista.innerHTML = etqLinhasHtml(doEscopo);
        const semMail = doEscopo.filter(l => !l.email_medico && !l.email_contador).length;
        const aviso = document.querySelector('.cn-email-aviso');
        if (aviso) { aviso.textContent = `⚠ ${semMail} médico(s) do recorte sem email no cadastro — saem na extração com o campo PARA vazio.`; aviso.hidden = !semMail; }
        const btn = $('cn-email-extrair');
        if (btn) {
          btn.textContent = `↓ Extrair (${doEscopo.length} e-mail${doEscopo.length === 1 ? '' : 's'})`;
          btn.disabled = !(state.emailDtPgto && state.emailPrazo && doEscopo.length);
        }
        const ex = doEscopo[0];
        state._emailExemplo = ex ? { nome: ex.nome || ex.nome_normalizado, saldo: (ex.conf && ex.conf.rel != null) ? ex.conf.rel : null } : null;
        if (typeof atualizarPrevia === 'function') atualizarPrevia();
        const tit = $('cn-etq-prev-tit'); const sel = etqLinha(state.etqSel);
        if (tit && sel) tit.textContent = 'Prévia da etiqueta — ' + (sel.nome || sel.nome_normalizado || '');
        etqRepintarPrevia();
      }));
    // V915: modelo editável — prévia ao vivo (sem re-render, pro cursor não pular)
    const atualizarPrevia = () => {
      const prev = document.querySelector('.cn-email-prev');
      const ex = state._emailExemplo;
      if (!prev || !ex) return;
      if (state.emailDtPgto && state.emailPrazo) {
        prev.textContent = corpoEmail(ex.nome, state.emailDtPgto, state.emailPrazo, ex.saldo);
      }
    };
    on('cn-email-corpo', 'input', () => {
      state.emailCorpoModelo = $('cn-email-corpo').value;
      atualizarPrevia();
    });
    on('cn-email-corpo-padrao', 'click', () => {
      if (!confirm('Voltar pra estrutura original do e-mail? As mudanças no modelo serão descartadas.')) return;
      state.emailCorpoModelo = CORPO_PADRAO;
      cfgGravar('NOTAS_EMAIL_CORPO_MODELO', '');
      render();
    });
    // V981: etiqueta da nota — config do tomador, seleção, cópia
    // V985: a gravação agora CHEGA AO DISCO (Banco.salvar) — antes só ficava na
    // memória e o CNPJ/e-mail se perdiam ao fechar o app.
    const ETQ_CAMPOS = {
      'cn-etq-tomador':      ['NOTAS_ETQ_TOMADOR',      (v) => v.trim()],
      'cn-etq-tomador-cnpj': ['NOTAS_ETQ_TOMADOR_CNPJ', (v) => v.trim()],
      'cn-etq-servico':      ['NOTAS_ETQ_SERVICO',      (v) => v.trim()],
      'cn-etq-email':        ['NOTAS_ETQ_EMAIL',        (v) => v.split(/[;,]/).map(x => x.trim()).filter(Boolean).join('; ')],
    };
    // Repinta SÓ a prévia da etiqueta (um render() completo no 'change' do
    // campo destruía o próprio botão de salvar antes do clique chegar nele).
    const etqRepintarPrevia = () => {
      const prev = $('cn-etq-prev'); if (!prev) return;
      const l = (state._ultimaLista || []).find(x => x.id === state.etqSel);
      if (!l) return;
      const c = etqCtx();
      prev.innerHTML = etiquetaHtml(etiquetaDados(l, c.dtPgto, c.prazo, c.assunto));
    };
    const etqSalvar = async (ids, msg) => {
      let mudou = false;
      for (const id of ids) {
        const el = $(id); if (!el) continue;
        const [chave, limpar] = ETQ_CAMPOS[id];
        const v = limpar(el.value);
        if (el.value !== v) el.value = v;   // normaliza na tela (e-mails)
        if (v === (cfgLer(chave) || '')) continue;
        cfgGravar(chave, v); mudou = true;
      }
      // V985: o salvar() comum é COALESCIDO (dentro da janela ele só AGENDA o
      // flush) — dois salvamentos seguidos deixavam o segundo pendente e
      // recarregar o app perdia o que foi digitado. O botão Salvar (msg) fura a
      // janela; V989: o salvamento por BLUR usa a via normal — forçar o export
      // completo do banco a cada saída de campo travava o modal.
      if (mudou || msg) { try { await Banco.salvar(msg ? { imediato: true } : {}); } catch (_) {} }
      etqRepintarPrevia();
      if (msg) Utilidades.toast(msg, 'success', 2600);
      return mudou;
    };
    for (const id of Object.keys(ETQ_CAMPOS)) on(id, 'change', () => etqSalvar([id]));
    on('cn-etq-email-salvar', 'click', () => etqSalvar(['cn-etq-email'], '✓ E-mail para envio da nota salvo'));
    on('cn-etq-cfg-salvar', 'click', () => etqSalvar(['cn-etq-tomador', 'cn-etq-tomador-cnpj', 'cn-etq-servico'], '✓ Tomador, CNPJ e descrição do serviço salvos'));
    const etqLinha = (id) => (state._ultimaLista || []).find(l => String(l.id) === String(id));
    state._etqEscopoQtd = document.querySelectorAll('.cn-etq-lin').length;   // V989
    const etqCtx = () => ({
      dtPgto: ($('cn-email-dtpgto') || {}).value || state.emailDtPgto || '',
      prazo: ($('cn-email-prazo') || {}).value || state.emailPrazo || '',
      assunto: ($('cn-email-assunto') || {}).value || state.emailAssunto || assuntoPadrao(state.competencia),
      modelo: ($('cn-email-corpo') || {}).value ?? modeloCorpoAtual(),
    });
    // V989: UM listener para a lista inteira (eram 3 por médico, 360 com 120
    // médicos) — e, como a troca de escopo reescreve a lista, os listeners
    // presos a cada botão morriam e os botões paravam de responder.
    const listaEtq = document.querySelector('.cn-etq-lista');
    if (listaEtq) listaEtq.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      const ds = b.dataset;
      if (ds.etqVer) {
        state.etqSel = Number(ds.etqVer);
        const l = etqLinha(state.etqSel);
        listaEtq.querySelectorAll('.cn-etq-lin').forEach(x => x.classList.toggle('sel', Number(x.dataset.etqId) === state.etqSel));
        const tit = $('cn-etq-prev-tit');
        if (tit && l) tit.textContent = 'Prévia da etiqueta — ' + (l.nome || l.nome_normalizado || '');
        etqRepintarPrevia();
        return;
      }
      const l = etqLinha(ds.etqCopiar || ds.etqCopiarTudo); if (!l) return;
      const c = etqCtx(); const d = etiquetaDados(l, c.dtPgto, c.prazo, c.assunto);
      if (ds.etqCopiar) {
        // sem await antes daqui: a escrita no clipboard precisa sair no clique
        copiarEtiquetaPNG(d).then(modo => Utilidades.toast(
          modo ? `✓ Etiqueta de ${d.nome} copiada como IMAGEM — cole no e-mail (Ctrl+V)`
               : 'Não consegui copiar a imagem — tente de novo com a janela do ATLAS em foco.',
          modo ? 'success' : 'error', 3400));
        return;
      }
      if (ds.etqCopiarTudo) {
        const corpo = corpoEmail(d.nome, c.dtPgto, c.prazo, d.saldo, c.modelo);
        etiquetaImagem(d).then(async (img) => {   // a etiqueta vai como IMAGEM no corpo
          const html = corpoParaHtml(corpo) + '<br>' + await etqImgTag(img, 'max-width:100%;');
          const okc = await copiarRico(html, corpo + '\n\n' + etiquetaTexto(d));
          Utilidades.toast(okc ? `✓ E-mail completo de ${d.nome} copiado (corpo + etiqueta em imagem)` : 'Não consegui copiar — tente de novo', okc ? 'success' : 'error', 3200);
        });
      }
    });
    on('cn-email-extrair', 'click', async () => {
      state.emailDtPgto = $('cn-email-dtpgto').value;
      state.emailPrazo = $('cn-email-prazo').value;
      state.emailAssunto = $('cn-email-assunto').value;
      state.emailCorpoModelo = ($('cn-email-corpo') || {}).value ?? state.emailCorpoModelo;
      await extrairEmails(state._ultimaLista || []);
      fecharEmail();
    });

    // modal do cadastro
    on('cn-cad-fechar', 'click', () => { state.cadastroAberto = false; render(); });
    const ov = $('cn-cad-ov');
    if (ov) ov.addEventListener('click', (e) => { if (e.target === ov) { state.cadastroAberto = false; render(); } });
    document.querySelectorAll('[data-cad-editar]').forEach(b => b.addEventListener('click', () => {
      state.cadEditando = +b.dataset.cadEditar; render();
    }));
    document.querySelectorAll('[data-cad-salvar]').forEach(b => b.addEventListener('click', async () => {
      const id = +b.dataset.cadSalvar;
      const nome = $('cn-ed-nome').value.trim();
      if (!nome) { Utilidades.toast('Nome é obrigatório', 'error', 2500); return; }
      const nnormNovo = norm(nome);
      const antigo = Banco.query(`SELECT nome_normalizado FROM notas_cadastro WHERE id = ?`, [id])[0];
      Banco.executar(`UPDATE notas_cadastro SET nome = ?, nome_normalizado = ?, razao_social = ?,
          cnpj = ?, email_medico = ?, email_contador = ?, ativo = ? WHERE id = ?`,
        [nome, nnormNovo, $('cn-ed-razao').value.trim() || null, $('cn-ed-cnpj').value.trim() || null,
         $('cn-ed-em').value.trim() || null, $('cn-ed-ec').value.trim() || null,
         $('cn-ed-ativo').checked ? 1 : 0, id]);
      // renomeou? arrasta as linhas de controle junto
      if (antigo && antigo.nome_normalizado !== nnormNovo) {
        Banco.executar(`UPDATE OR IGNORE notas_controle SET nome_normalizado = ? WHERE nome_normalizado = ?`,
          [nnormNovo, antigo.nome_normalizado]);
      }
      await Banco.salvar();
      state.cadEditando = null;
      render();
    }));
  }

  async function anexarNota(id, file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { Utilidades.toast('PDF acima de 8 MB — anexe uma versão menor.', 'error', 4000); return; }
    try {
      Utilidades.toast('Lendo a nota…', 'info', 1800);
      const buf = await file.arrayBuffer();
      // guarda o arquivo
      let b64 = '';
      const bytes = new Uint8Array(buf);
      const PASSO = 0x8000;
      for (let i = 0; i < bytes.length; i += PASSO) {
        b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + PASSO));
      }
      b64 = btoa(b64);
      Banco.executar(`INSERT OR REPLACE INTO notas_arquivos (controle_id, nome_arquivo, conteudo_b64, tamanho)
        VALUES (?, ?, ?, ?)`, [id, file.name, b64, file.size]);
      await salvarCampo(id, 'nota_arquivo', file.name);
      await salvarCampo(id, 'nota_recebida', 1);   // anexou = recebeu

      // lê os valores (PDF com camada de texto)
      let lido = null;
      try { lido = await lerNotaPdf(buf.slice(0)); }
      catch (e) { console.warn('[notas] pdf.js:', e); }
      if (lido && lido.temTexto && (lido.bruto != null || lido.liquido != null || lido.numero)) {
        if (lido.bruto != null) await salvarCampo(id, 'valor_bruto', lido.bruto);
        if (lido.liquido != null) await salvarCampo(id, 'valor_liquido', lido.liquido);
        if (lido.numero) await salvarCampo(id, 'nf_numero', lido.numero);
        await salvarCampo(id, 'origem_valores', 'pdf');
        Utilidades.toast(`✓ Nota lida — bruto ${lido.bruto != null ? 'R$ ' + fmt(lido.bruto) : '—'} · líquido ${
          lido.liquido != null ? 'R$ ' + fmt(lido.liquido) : '—'} · nº ${lido.numero || '—'}`, 'success', 4200);
      } else {
        Utilidades.toast('Anexado. Não achei os valores no PDF (escaneado?) — preencha bruto/líquido/NF à mão.', 'info', 5200);
      }
      render();
    } catch (e) {
      console.error(e);
      alert('❌ Erro ao anexar:\n\n' + e.message);
    }
  }

  async function exportarExcel() {
    const comp = state.competencia;
    if (!comp) { Utilidades.toast('Selecione uma competência.', 'error', 2500); return; }
    if (typeof ExcelJS === 'undefined') { Utilidades.toast('ExcelJS ainda carregando — tente de novo.', 'error', 3000); return; }
    const linhas = listarControle(comp);
    const tot = totaisRelatorio(comp);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Controle ${comp}`, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'CONSOLIDAÇÃO/OC', key: 'oc', width: 16 },
      { header: 'NOME DO PROFISSIONAL', key: 'nome', width: 36 },
      { header: 'RAZÃO SOCIAL', key: 'razao', width: 34 },
      { header: 'CNPJ', key: 'cnpj', width: 20 },
      { header: 'E-MAIL', key: 'email', width: 44 },
      { header: 'EMAIL ENVIADO', key: 'email_env', width: 14 },
      { header: 'NOTA RECEBIDA', key: 'nota_rec', width: 14 },
      { header: 'VALOR BRUTO', key: 'bruto', width: 14 },
      { header: 'VALOR LÍQUIDO', key: 'liquido', width: 14 },
      { header: 'NF', key: 'nf', width: 10 },
      { header: 'ENVIADA - CAV', key: 'cav', width: 13 },
      { header: 'RELATÓRIO (R$)', key: 'rel', width: 15 },
      { header: 'CONFERÊNCIA', key: 'conf', width: 18 },
      { header: 'STATUS / OBS', key: 'obs', width: 26 },
    ];
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16456B' } };
    for (const l of linhas) {
      const conf = conferir(l, tot);
      const rel = tot.get(l.nome_normalizado);
      const r = ws.addRow({
        oc: l.oc || '', nome: l.nome || l.nome_normalizado, razao: l.razao_social || '',
        cnpj: l.cnpj || '', email: [l.email_medico, l.email_contador].filter(Boolean).join(' / '),
        email_env: l.email_enviado ? 'SIM' : 'NÃO',
        nota_rec: l.nota_recebida ? 'SIM' : 'NÃO',
        bruto: l.valor_bruto != null ? l.valor_bruto : '',
        liquido: l.valor_liquido != null ? l.valor_liquido : '',
        nf: l.nf_numero || '',
        cav: l.cav_enviado ? 'SIM' : 'NÃO',
        rel: rel ? rel.total : '',
        conf: conf.estado === 'bateu' ? 'BATEU'
          : conf.estado === 'divergiu' ? `DIVERGIU (${conf.dif > 0 ? '+' : ''}${fmt(conf.dif)})`
          : conf.estado === 'especial' ? 'ESPECIAL' : '',
        obs: l.status_especial || '',
      });
      if (conf.estado === 'divergiu') {
        r.getCell('conf').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE5E1' } };
      }
      if (r.number % 2 === 0) r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4FAFD' } };
    }
    for (const k of ['bruto', 'liquido', 'rel']) ws.getColumn(k).numFmt = 'R$ #,##0.00';
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 14 } };
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `controle_notas_${comp}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ── CSS ──────────────────────────────────────────────────────────────
  function _injetarCSS() {
    if (document.getElementById('cn-css')) return;
    const st = document.createElement('style');
    st.id = 'cn-css';
    st.textContent = `
      .cn-header-acoes { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .cn-select { padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; background: var(--bg-elevated); }
      .cn-cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin: 14px 0; }
      @media (max-width: 1200px) { .cn-cards { grid-template-columns: repeat(2, 1fr); } }
      .cn-card-rot { font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-soft); }
      .cn-card-val { font-size: 21px; font-weight: 800; color: #06283A; margin: 4px 0 2px; font-variant-numeric: tabular-nums; }
      .cn-card-sub { font-size: 11px; color: var(--ink-faint); min-height: 14px; }
      .cn-card { padding: 13px 15px; }
      .cn-card-alerta .cn-card-val { color: #A33B2E; }
      .cn-filtros { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
      .cn-busca { flex: 0 1 320px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 9px; font-size: 12.5px; background: var(--bg-elevated); }
      .cn-chip { padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-elevated); font-size: 11.5px; font-weight: 600; cursor: pointer; color: var(--ink-soft); }
      .cn-chip.on { background: #106284; color: #fff; border-color: #106284; }
      .cn-btn-email {
        margin-left: auto;
        padding: 8px 16px; border-radius: 999px; border: none; cursor: pointer;
        background: linear-gradient(90deg, #16456b 0%, #1d6d92 45%, #2a9fc4 100%);
        color: #fff; font-weight: 700; font-size: 12px; letter-spacing: 0.02em;
        box-shadow: 0 4px 12px rgba(22,69,107,0.28);
      }
      .cn-btn-email:hover { filter: brightness(1.08); }
      /* V909: a matriz deixa de parecer planilha — linhas com respiro,
         cabeçalho na faixa da marca, avatar e a esteira de etapas */
      .cn-tab-wrap { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 14px; overflow: auto; max-height: calc(100vh - 330px); box-shadow: 0 6px 18px rgba(0,58,84,0.07); }
      .cn-tab { width: 100%; border-collapse: collapse; font-size: 12px; }
      /* V910: o cabeçalho da matriz segue o PADRÃO GLOBAL da ferramenta
         (V149/V561 — azul #107DAC, texto branco, centralizado); aqui só o
         sticky, o respiro e a tipografia fina */
      .main .cn-tab thead th { position: sticky; top: 0; font-weight: 700; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; padding: 11px 14px; z-index: 2; white-space: nowrap; }
      .cn-tab td { padding: 13px 14px; border-bottom: 1px solid #EDF3F7; vertical-align: middle; }
      .cn-tab tbody tr { transition: background 120ms; }
      .cn-tab tbody tr:hover { background: #F4FAFD; }
      .cn-tr-esp { background: #FBF6EC; }
      .cn-c { text-align: center; }
      .cn-num { text-align: right; font-variant-numeric: tabular-nums; }
      .cn-medico { display: flex; align-items: center; gap: 11px; min-width: 230px; }
      .cn-avatar {
        flex: 0 0 36px; width: 36px; height: 36px; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, #16456b, #2a9fc4);
        color: #fff; font-weight: 800; font-size: 13px; letter-spacing: 0.03em;
        box-shadow: 0 3px 8px rgba(22,69,107,0.25);
      }
      .cn-nome { font-weight: 700; color: #06283A; font-size: 12.5px; line-height: 1.25; }
      .cn-sub { font-size: 10.5px; color: var(--ink-faint); margin-top: 1px; }
      .cn-cnpj { font-family: var(--mono, monospace); letter-spacing: -0.01em; }
      .cn-sub-mails { cursor: help; color: #4A7A93; }
      /* esteira email → nota → CAV */
      .cn-esteira { display: flex; align-items: flex-start; gap: 0; min-width: 168px; }
      .cn-passo { display: flex; flex-direction: column; align-items: center; gap: 3px; width: 46px; }
      .cn-passo-rot { font-size: 9px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-faint); }
      .cn-passo.on .cn-passo-rot { color: #1D8348; }
      .cn-fio { flex: 1; height: 2.5px; background: #DCE8EF; border-radius: 2px; margin-top: 14px; min-width: 14px; }
      .cn-fio.on { background: #7CC7A0; }
      .cn-chk {
        width: 30px; height: 30px; border-radius: 50%; border: 1.5px solid #C4D7E2;
        background: #fff; cursor: pointer; color: #9DB4C2; font-size: 13px; line-height: 1;
        transition: all 130ms;
      }
      .cn-chk:hover { border-color: #189AD3; transform: scale(1.07); }
      .cn-chk.on { background: #1D8348; border-color: #1D8348; color: #fff; font-weight: 800; box-shadow: 0 3px 8px rgba(29,131,72,0.3); }
      /* blocos de valores da nota */
      .cn-td-valores { min-width: 150px; }
      .cn-valor-bloco { display: flex; align-items: baseline; gap: 6px; padding: 1px 0; }
      .cn-valor-rot { flex: 0 0 44px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-faint); text-align: right; }
      .cn-valor-caixa { display: inline-flex; align-items: baseline; gap: 2px; }
      .cn-rs { font-size: 10px; color: var(--ink-faint); }
      .cn-inp { border: 1px solid transparent; background: transparent; border-radius: 6px; padding: 3px 6px; font: inherit; box-sizing: border-box; }
      .cn-inp:hover { border-color: var(--border); background: var(--bg-elevated); }
      .cn-inp:focus { outline: none; border-color: #189AD3; background: var(--bg-elevated); box-shadow: 0 0 0 2px rgba(24,154,211,0.12); }
      .cn-inp-num { width: 92px; text-align: left; font-variant-numeric: tabular-nums; font-weight: 600; color: #06283A; }
      .cn-inp-nf { width: 92px; font-family: var(--mono, monospace); }
      .cn-inp-oc { width: 64px; font-family: var(--mono, monospace); }
      .cn-inp-obs { min-width: 130px; width: 100%; }
      .cn-td-conf { min-width: 120px; }
      .cn-rel-rot { font-size: 9px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-faint); margin: -1px 0 4px; }
      .cn-mini-ver { border-color: #9DBECE; color: #106284; }
      /* modal do e-mail */
      .cn-modal-email { width: min(880px, 96vw); }
      .cn-modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--border); }
      .cn-email-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
      .cn-email-campo { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 600; color: var(--ink); }
      .cn-email-campo input[type="date"], .cn-email-campo input[type="text"] {
        padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; font: inherit; font-weight: 400;
      }
      .cn-email-campo input:focus { outline: none; border-color: #189AD3; box-shadow: 0 0 0 2px rgba(24,154,211,0.12); }
      .cn-email-campo-larga { grid-column: 1 / -1; }
      .cn-email-fonte { font-weight: 400; color: var(--ink-faint); }
      .cn-email-falta { color: #A33B2E; font-weight: 600; }
      .cn-email-radios { display: flex; flex-direction: column; gap: 4px; font-weight: 400; font-size: 12px; }
      .cn-email-aviso { margin-top: 10px; padding: 8px 12px; background: #FBF0DA; border: 1px solid #EAD9BE; border-radius: 8px; font-size: 11.5px; color: #8A5A1F; }
      .cn-email-prev-tit { margin: 14px 0 6px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-soft); }
      /* V915: modelo editável do corpo */
      .cn-email-tags { margin: 0 0 6px; font-size: 11px; color: var(--ink-faint); }
      /* V981: etiqueta da nota */
      .cn-etq-cfg { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; margin: 4px 0 10px; }
      .cn-etq-cfg label:nth-child(3) { grid-column: 1 / -1; }
      .cn-etq-cfg-acoes { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; }
      .cn-etq-cfg-acoes small { font-size: 10.5px; color: var(--ink-faint); }
      .cn-etq-linha-salvar { display: flex; align-items: center; gap: 8px; }
      .cn-etq-linha-salvar input { flex: 1; min-width: 0; }
      .cn-mini-salvar { border-color: #189AD3; color: #189AD3; font-weight: 700; white-space: nowrap; }
      .cn-mini-salvar:hover { background: #EAF6FC; }
      .cn-etq-cfg label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; font-weight: 600; color: var(--ink-soft); }
      .cn-etq-cfg input { border: 1px solid var(--border); border-radius: 7px; padding: 6px 9px; font-size: 12px; font-family: inherit; color: var(--ink); background: #fff; }
      .cn-etq-cfg input:focus { outline: none; border-color: #189AD3; box-shadow: 0 0 0 2px rgba(24,154,211,0.12); }
      .cn-etq-lista { display: flex; flex-direction: column; gap: 5px; max-height: 220px; overflow: auto; padding-right: 2px; }
      .cn-etq-lin { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 8px; background: #fff; font-size: 12px; }
      .cn-etq-lin.sel { border-color: #189AD3; background: #F4FAFD; }
      .cn-etq-nome small { color: var(--ink-soft); font-weight: 500; }
      .cn-etq-acoes { display: flex; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
      .cn-etq-prev { padding: 12px; background: #F3F6F8; border: 1px solid var(--border); border-radius: 10px; overflow: auto; }
      .cn-email-tags code {
        display: inline-block; margin: 1px 2px; padding: 1px 6px; background: #E7F3F9;
        border: 1px solid #BFDCEA; border-radius: 6px; font-size: 10.5px; color: #106284;
      }
      .cn-email-corpo {
        width: 100%; box-sizing: border-box; min-height: 190px; resize: vertical;
        padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px;
        font: 11.5px/1.55 'SFMono-Regular', Consolas, monospace; color: #24445A; background: #FFFFFF;
      }
      .cn-email-corpo:focus { outline: none; border-color: #189AD3; box-shadow: 0 0 0 2px rgba(24,154,211,0.12); }
      .cn-email-prev {
        margin: 0; padding: 14px 16px; background: #F7FAFC; border: 1px solid var(--border);
        border-radius: 10px; font: 11.5px/1.55 inherit; white-space: pre-wrap; max-height: 260px; overflow: auto;
        color: #24445A;
      }
      .cn-mini { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 7px; padding: 3px 8px; font-size: 11px; cursor: pointer; white-space: nowrap; }
      .cn-mini:hover { border-color: #189AD3; color: #107DAC; }
      .cn-mini-x { color: #A33B2E; }
      .cn-anexo { white-space: nowrap; }
      .cn-rel { color: #106284; font-weight: 600; }
      .cn-badge { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
      .cn-badge-ok { background: #E1F5EE; color: #085041; }
      .cn-badge-err { background: #FCE5E1; color: #8E2B1E; }
      .cn-badge-neutra { background: var(--bg-sunken); color: var(--ink-faint); }
      .cn-badge-esp { background: #FBF0DA; color: #8A5A1F; }
      .cn-vazio, .cn-vazio-tab { padding: 34px; text-align: center; color: var(--ink-soft); font-size: 13px; }
      /* V911: z-index acima da barra superior/dock (o "Mês a mês" usa 100000
         pelo mesmo motivo) — o modal ficava por baixo dela */
      .cn-modal-ov { position: fixed; inset: 0; background: rgba(15,37,68,0.5); z-index: 100000; display: flex; align-items: center; justify-content: center; padding: 22px; }
      /* V980: com um modal aberto, o dock de importação e o botão flutuante do módulo somem (o modal fica sobre TODO o layout) */
      body:has(> .cn-modal-ov) :is(#atlas-hub, #topbar-import) { display: none !important; }
      .cn-modal { max-height: calc(100vh - 44px); }
      .cn-modal { background: var(--bg-elevated); border-radius: 14px; width: min(1100px, 96vw); max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 24px 60px rgba(0,0,0,0.3); }
      .cn-modal-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--border); }
      .cn-modal-body { padding: 14px 20px 20px; overflow: auto; }
      .cn-modal-help { font-size: 12px; color: var(--ink-soft); margin: 0 0 12px; }
      .cn-tab-cad input { width: 100%; box-sizing: border-box; padding: 5px 7px; border: 1px solid var(--border); border-radius: 6px; font: inherit; }
    `;
    document.head.appendChild(st);
  }

  return { montar, _interno: { importarWorkbook, lerNotaPdf, conferir, compDaAba, totaisRelatorio, gerarMes } };
})();
window.ControleNotas = ControleNotas;
