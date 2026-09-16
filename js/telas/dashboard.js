/**
 * ============================================================================
 * TELA: Visão Geral (Dashboard executivo)
 * V125 — PASSO 1 de 3
 *   • KPIs financeiros (Hero + 3 secundários)
 *   • Status da Competência (checklist visual dos fichários)
 *   • Últimas Importações (log)
 *   • Placeholders dos gráficos (PASSO 2)
 *   • Placeholders do ranking + alertas (PASSO 3)
 *   • Atalhos rápidos
 *   • Saúde do Sistema (rodapé)
 * ============================================================================
 */

App.telas['dashboard'] = function () {
  injetarEstilosDashboard();

  // -------- Detecção da competência atual e anterior --------
  const compAtual = detectarCompetenciaAtual();
  const compAnterior = compAtual ? subtrairMes(compAtual, 1) : null;

  // -------- Agregados financeiros --------
  const repasseAtual = repasseConsolidado(compAtual);
  const repasseAnterior = repasseConsolidado(compAnterior);

  const totalAtual = somaObj(repasseAtual);
  const totalAnt   = somaObj(repasseAnterior);

  const variacao = (totalAnt > 0)
    ? { pct: ((totalAtual - totalAnt) / totalAnt) * 100, abs: totalAtual - totalAnt }
    : null;

  // -------- KPIs secundários --------
  const medAtivos = medicosAtivos(compAtual);
  const pend = pendenciasLaudos(compAtual);
  const repasseMedio = (medAtivos > 0 && totalAtual > 0) ? totalAtual / medAtivos : 0;

  // -------- Status e log --------
  const status = statusFicharios(compAtual);
  const ultimas = ultimasImportacoes(5);

  // -------- Saúde do sistema --------
  const saude = Banco.resumo();

  // -------- Render --------
  const html = `
    <div class="page-content vg-page">
      <header class="page-header">
        <div>
          <h2>Visão Geral</h2>
          <div class="subtitle">
            ${compAtual
              ? `Competência atual · <strong>${formatarCompetenciaBR(compAtual)}</strong>`
              : 'Nenhuma competência com dados ainda — importe um fichário pra começar'}
          </div>
        </div>
      </header>

      ${compAtual ? renderHeroKPIs(totalAtual, variacao, compAtual, medAtivos, saude.medicos, pend, repasseMedio) : renderEstadoVazio()}

      ${compAtual ? renderStatusLogRow(status, ultimas, compAtual) : ''}

      ${compAtual ? renderGraficos(compAtual, repasseAtual) : ''}

      ${compAtual ? renderRankingAlertas(compAtual) : ''}

      ${renderAtalhosRapidos()}

      ${renderSaudeSistema(saude)}
    </div>
  `;

  document.getElementById('conteudo').innerHTML = html;
  bindAtalhos();
};

// ============================================================================
// SEÇÕES DE RENDER
// ============================================================================

function renderHeroKPIs(total, variacao, comp, medAtivos, totMedicosCad, pend, repasseMedio) {
  const seta = variacao && variacao.pct >= 0 ? '↑' : '↓';
  const klass = variacao && variacao.pct >= 0 ? 'vg-var-up' : 'vg-var-down';
  const sinal = variacao && variacao.abs >= 0 ? '+' : '';
  return `
    <div class="aic-grid">
      ${Utilidades.cardKPI(
        `Repasse total · ${formatarCompetenciaBR(comp)}`,
        Utilidades.formatarMoeda(total),
        variacao
          ? `<span class="${klass}">${seta} ${Math.abs(variacao.pct).toFixed(1).replace('.', ',')}%</span> ${sinal}${Utilidades.formatarMoeda(variacao.abs)} vs mês anterior`
          : '<span class="vg-meta-faint">Sem dado anterior pra comparar</span>'
      )}
      ${Utilidades.cardKPI('Médicos ativos', Utilidades.formatarNumero(medAtivos), `de ${Utilidades.formatarNumero(totMedicosCad)} cadastrados`)}
      ${Utilidades.cardKPI('Pendências (Laudos)', Utilidades.formatarNumero(pend.qtd), pend.qtd > 0 ? 'Sem precificação' : 'Tudo certo ✓', 'alerta')}
      ${Utilidades.cardKPI('Repasse médio / médico', Utilidades.formatarMoeda(repasseMedio), medAtivos > 0 ? `${Utilidades.formatarNumero(medAtivos)} médicos` : '—')}
    </div>
    <div class="vg-hero-foot">
      * Inclui Laudos · Períodos · Fellow · QVIS calculado · Externos · LIO · OPME
    </div>
  `;
}

// ============================================================================
// V506 — HELPERS DE DADOS do Comparativo mês a mês (a UI vive em
// visao_geral_ui.js, que é o dashboard ATIVO; estas funções são globais e
// reutilizam o cache/split do repasseConsolidado deste arquivo).
// ============================================================================
const __vgProdCache = new Map();   // comp|versao → { total, medica }

// Produção do mês: total = SUM(valor) de TODAS as linhas da Produção;
// médica = SUM(valor) das classificações CONSULTA/EXAME/PROCEDIMENTO
// (mesmo critério de elegibilidade padrão do módulo Produção Médica).
function producaoDoMes(comp) {
  const chave = comp + '|' + Banco._versao;
  if (__vgProdCache.has(chave)) return __vgProdCache.get(chave);
  if (__vgProdCache.size > 200) __vgProdCache.clear();
  const r = { total: 0, medica: 0 };
  try {
    const q = Banco.query(
      `SELECT COALESCE(SUM(valor), 0) AS t,
              COALESCE(SUM(CASE WHEN UPPER(COALESCE(classificacao_produto, ''))
                                     IN ('CONSULTA', 'EXAME', 'PROCEDIMENTO')
                                THEN valor ELSE 0 END), 0) AS m
         FROM linhas_producao
        WHERE competencia = ?`, [comp]);
    r.total  = Number(q[0] && q[0].t) || 0;
    r.medica = Number(q[0] && q[0].m) || 0;
  } catch (_) {}
  __vgProdCache.set(chave, r);
  return r;
}

function mesesComparativo(n) {
  // V626: usa a MESMA lista canônica do dashboard (competenciasDisponiveis —
  // QVIS por MÊS DE PAGAMENTO + fichários). Antes lia linhas_qvis.competencia
  // (mês de produção de cada linha) e linhas_producao.competencia (data de cada
  // linha), então um relatório de julho com linhas datadas de agosto fazia
  // "agosto" aparecer no Comparativo sem nenhuma importação de agosto.
  try {
    if (window.VGExec && typeof VGExec.competenciasDisponiveis === 'function') {
      return (VGExec.competenciasDisponiveis() || [])
        .filter(c => c && c !== '0000-00').slice(0, n);
    }
  } catch (_) {}
  const set = new Set();
  try { for (const x of (Banco.query(`SELECT DISTINCT mes_pagamento AS c FROM linhas_qvis WHERE mes_pagamento IS NOT NULL AND mes_pagamento <> ''`) || [])) set.add(x.c); } catch (_) {}
  return Array.from(set).filter(c => c && c !== '0000-00').sort().reverse().slice(0, n);
}

// V507: Repasse (QVIS) do mês — o resultado SALVO do Calcular Repasse.
// Fonte primária: repasse_snapshot.total_repasse (gravado ao salvar o cálculo);
// fallback: soma de repasse_pagos da competência. (O campo qvis_calculado do
// consolidado legado lia a tabela OBSOLETA `linhas_calculadas` — sempre 0.)
const __vgQvisCache = new Map();   // comp|versao → valor
function repasseQvisDoMes(comp) {
  const chave = comp + '|' + Banco._versao;
  if (__vgQvisCache.has(chave)) return __vgQvisCache.get(chave);
  if (__vgQvisCache.size > 200) __vgQvisCache.clear();
  let v = 0;
  try {
    const q = Banco.query(`SELECT total_repasse AS s FROM repasse_snapshot WHERE competencia = ? LIMIT 1`, [comp]);
    if (q && q[0] && q[0].s != null) v = Number(q[0].s) || 0;
  } catch (_) {}
  if (!v) {
    try {
      const q = Banco.query(`SELECT COALESCE(SUM(repasse), 0) AS s FROM repasse_pagos WHERE competencia = ?`, [comp]);
      v = Number(q && q[0] && q[0].s) || 0;
    } catch (_) {}
  }
  __vgQvisCache.set(chave, v);
  return v;
}

function renderEstadoVazio() {
  return `
    <div class="vg-empty">
      <h3>Bem-vindo ao Atlas</h3>
      <p>Pra ver o dashboard executivo, importe pelo menos um fichário (QVIS, Laudos, Períodos ou Fellow).</p>
      <p class="vg-empty-hint">Use os atalhos rápidos abaixo pra começar.</p>
    </div>
  `;
}

function renderStatusLogRow(status, ultimas, comp) {
  return `
    <div class="vg-row-2">
      <div class="card">
        <h3 class="card-title">Status da competência</h3>
        <p class="card-subtitle">Quais fichários já receberam dados em ${formatarCompetenciaBR(comp)}</p>
        <div class="vg-status-grid">
          ${status.map(s => `
            <div class="vg-status-item">
              <span class="vg-status-nome">${s.nome}</span>
              <span class="vg-status-badge vg-badge-${s.estado}">
                ${s.estado === 'ok'      ? '✓ ' + Utilidades.formatarNumero(s.qtd) + ' ' + s.unidade : ''}
                ${s.estado === 'parcial' ? '⏳ parcial' : ''}
                ${s.estado === 'vazio'   ? '⊘ sem dados' : ''}
              </span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="card">
        <h3 class="card-title">Últimas importações</h3>
        <p class="card-subtitle">Atividade recente no sistema</p>
        <div class="vg-log">
          ${ultimas.length === 0
            ? '<div class="vg-log-empty">Nenhuma importação registrada ainda.</div>'
            : ultimas.map(u => `
                <div class="vg-log-item">
                  <span class="vg-log-quando">${u.quando_relativo}</span>
                  <span class="vg-log-texto">
                    <strong>${u.tipo}</strong> · ${u.competencia} (${Utilidades.formatarNumero(u.qtd)} linhas)
                  </span>
                  <span class="vg-log-hora">${u.hora}</span>
                </div>
              `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderGraficos(compAtual, repasseAtual) {
  const evolucao = evolucaoMensal(compAtual, 6);
  return `
    <div class="vg-row-charts">
      <div class="card vg-chart-card">
        <h3 class="card-title">Evolução do repasse</h3>
        <p class="card-subtitle">Últimas 6 competências · clique numa barra pra abrir os Laudos</p>
        ${renderGraficoBarras(evolucao, compAtual)}
      </div>
      <div class="card vg-chart-card">
        <h3 class="card-title">Distribuição por fichário</h3>
        <p class="card-subtitle">Composição do repasse · ${formatarCompetenciaBR(compAtual)}</p>
        ${renderGraficoDonut(repasseAtual)}
      </div>
    </div>
  `;
}

/** Gráfico de barras verticais — 6 últimas competências */
function renderGraficoBarras(dados, compAtual) {
  if (!dados || dados.length === 0) {
    return `<div class="vg-placeholder"><span>Sem dados pra exibir</span></div>`;
  }

  const max = Math.max(...dados.map(d => d.total), 1);

  const W = 600, H = 230;
  const PAD_L = 12, PAD_R = 12, PAD_T = 30, PAD_B = 38;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const barCount = dados.length;
  const gap = 12;
  const barW = (innerW - gap * (barCount - 1)) / barCount;

  const barras = dados.map((d, i) => {
    const x = PAD_L + i * (barW + gap);
    const altura = d.total > 0 ? (d.total / max) * innerH : 0;
    const y = PAD_T + (innerH - altura);
    const isAtual = d.comp === compAtual;
    const fill = isAtual ? 'var(--accent)' : 'var(--primary)';
    const labelY = altura > 28 ? y + 16 : y - 6;
    const labelColor = altura > 28 ? '#FFFFFF' : 'var(--ink-soft)';
    const valorTopo = altura > 28 ? '' : formatarValorCurto(d.total);
    const valorDentro = altura > 28 ? formatarValorCurto(d.total) : '';

    return `
      <g class="vg-bar-group" data-comp="${d.comp}">
        <title>${formatarCompetenciaBR(d.comp)} — ${Utilidades.formatarMoeda(d.total)}</title>
        <rect x="${x}" y="${y}" width="${barW}" height="${altura}"
              fill="${fill}" rx="4" class="vg-bar"
              data-comp="${d.comp}"/>
        ${valorTopo ? `<text x="${x + barW/2}" y="${y - 6}" text-anchor="middle"
              font-size="11" font-weight="600" fill="var(--ink-soft)">${valorTopo}</text>` : ''}
        ${valorDentro ? `<text x="${x + barW/2}" y="${y + 18}" text-anchor="middle"
              font-size="11" font-weight="600" fill="#FFFFFF">${valorDentro}</text>` : ''}
        <text x="${x + barW/2}" y="${H - 18}" text-anchor="middle"
              font-size="11" fill="var(--ink-faint)" font-weight="500">
          ${formatarCompetenciaBR(d.comp)}
        </text>
        ${isAtual ? `<text x="${x + barW/2}" y="${H - 5}" text-anchor="middle"
              font-size="9" fill="var(--accent)" font-weight="700"
              letter-spacing="0.05em">ATUAL</text>` : ''}
      </g>
    `;
  }).join('');

  return `
    <div class="vg-svg-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="vg-svg-grafico" preserveAspectRatio="xMidYMid meet">
        <!-- Linha de base sutil -->
        <line x1="${PAD_L}" y1="${PAD_T + innerH}" x2="${W - PAD_R}" y2="${PAD_T + innerH}"
              stroke="var(--border)" stroke-width="1"/>
        ${barras}
      </svg>
    </div>
  `;
}

/** Donut de distribuição por fichário */
function renderGraficoDonut(repasse) {
  const fontes = [
    { chave: 'laudos',         label: 'Laudos',         cor: '#5980a6', valor: repasse.laudos          || 0 },
    { chave: 'periodos',       label: 'Períodos',       cor: '#3f6489', valor: repasse.periodos        || 0 },
    { chave: 'fellow',         label: 'Fellow',         cor: '#15a34a', valor: repasse.fellow          || 0 },
    { chave: 'qvis_calculado', label: 'QVIS calculado', cor: '#46688c', valor: repasse.qvis_calculado  || 0 },
    { chave: 'externos',       label: 'Externos',       cor: '#8A6840', valor: repasse.externos        || 0 },
    { chave: 'lio',            label: 'LIO',            cor: '#5B7A4F', valor: repasse.lio             || 0 },
    { chave: 'opme',           label: 'OPME',           cor: '#6B4F3A', valor: repasse.opme            || 0 },
  ];
  const total = fontes.reduce((a, b) => a + b.valor, 0);

  if (total <= 0) {
    return `
      <div class="vg-placeholder" style="min-height: 200px">
        <span class="vg-ph-ico">🍩</span>
        <span>Sem repasse na competência atual</span>
      </div>
    `;
  }

  const com = fontes.filter(f => f.valor > 0);

  const cx = 100, cy = 100;
  const rOut = 84, rIn = 54;
  let acum = -Math.PI / 2;  // começa no topo

  // Caso especial: só uma fonte com 100% → desenha círculo completo
  let segmentos = '';
  if (com.length === 1) {
    const f = com[0];
    segmentos = `
      <g class="vg-donut-seg" data-fonte="${f.chave}">
        <title>${f.label} — ${Utilidades.formatarMoeda(f.valor)} (100%)</title>
        <circle cx="${cx}" cy="${cy}" r="${(rOut + rIn) / 2}"
                fill="none" stroke="${f.cor}" stroke-width="${rOut - rIn}"/>
      </g>
    `;
  } else {
    segmentos = com.map(f => {
      const ang = (f.valor / total) * 2 * Math.PI;
      const a0 = acum;
      const a1 = acum + ang;
      acum = a1;

      const x1 = cx + rOut * Math.cos(a0);
      const y1 = cy + rOut * Math.sin(a0);
      const x2 = cx + rOut * Math.cos(a1);
      const y2 = cy + rOut * Math.sin(a1);
      const xi1 = cx + rIn * Math.cos(a1);
      const yi1 = cy + rIn * Math.sin(a1);
      const xi2 = cx + rIn * Math.cos(a0);
      const yi2 = cy + rIn * Math.sin(a0);
      const large = ang > Math.PI ? 1 : 0;
      const pct = ((f.valor / total) * 100).toFixed(1).replace('.', ',');

      const path = `M ${x1.toFixed(2)} ${y1.toFixed(2)} `
                 + `A ${rOut} ${rOut} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} `
                 + `L ${xi1.toFixed(2)} ${yi1.toFixed(2)} `
                 + `A ${rIn} ${rIn} 0 ${large} 0 ${xi2.toFixed(2)} ${yi2.toFixed(2)} Z`;

      return `
        <g class="vg-donut-seg" data-fonte="${f.chave}">
          <title>${f.label} — ${Utilidades.formatarMoeda(f.valor)} (${pct}%)</title>
          <path d="${path}" fill="${f.cor}"/>
        </g>
      `;
    }).join('');
  }

  // Legenda à direita
  const legenda = com.map(f => {
    const pct = ((f.valor / total) * 100).toFixed(1).replace('.', ',');
    return `
      <div class="vg-legenda-item" data-fonte="${f.chave}">
        <span class="vg-legenda-swatch" style="background: ${f.cor}"></span>
        <span class="vg-legenda-nome">${f.label}</span>
        <span class="vg-legenda-valor">${pct}%</span>
      </div>
    `;
  }).join('');

  return `
    <div class="vg-donut-wrap">
      <svg viewBox="0 0 200 200" class="vg-svg-donut" preserveAspectRatio="xMidYMid meet">
        ${segmentos}
        <!-- Total no centro -->
        <text x="100" y="94" text-anchor="middle"
              font-size="10" fill="var(--ink-faint)"
              letter-spacing="0.08em" font-weight="600">TOTAL</text>
        <text x="100" y="115" text-anchor="middle"
              font-size="15" fill="var(--ink)" font-weight="600"
              style="font-family: var(--font-display)">
          ${formatarValorCurto(total)}
        </text>
      </svg>
      <div class="vg-legenda">
        ${legenda}
      </div>
    </div>
  `;
}

/** Formata valor curto pra labels de gráfico: R$ 2,8 mi · R$ 314 mil · R$ 4.520 */
function formatarValorCurto(v) {
  if (v == null || isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e6) return 'R$ ' + (v / 1e6).toFixed(1).replace('.', ',') + ' mi';
  if (abs >= 1e3) return 'R$ ' + (v / 1e3).toFixed(0) + ' mil';
  return Utilidades.formatarMoeda(v);
}

function renderRankingAlertas(compAtual) {
  const top = topMedicosComp(compAtual, 10);
  const alertas = alertasInteligentes(compAtual);
  return `
    <div class="vg-row-2">
      <div class="card">
        <h3 class="card-title">Top 10 médicos da competência</h3>
        <p class="card-subtitle">Maior repasse em ${formatarCompetenciaBR(compAtual)}</p>
        ${renderRankingMedicos(top)}
      </div>
      <div class="card">
        <h3 class="card-title">Alertas inteligentes</h3>
        <p class="card-subtitle">Itens que precisam de atenção</p>
        ${renderAlertas(alertas)}
      </div>
    </div>
  `;
}

function renderRankingMedicos(top) {
  if (!top || top.length === 0) {
    return `
      <div class="vg-placeholder" style="min-height: 180px">
        <span class="vg-ph-ico">🏆</span>
        <span>Nenhum médico com repasse na competência</span>
      </div>
    `;
  }

  const maxVal = top[0].total;

  return `
    <div class="vg-ranking-list">
      ${top.map((m, i) => {
        const pct = (m.total / maxVal) * 100;
        const nomeExibido = formatarNomeMedico(m.nome_display);
        return `
          <div class="vg-rank-item">
            <span class="vg-rank-pos">${i + 1}</span>
            <div class="vg-rank-content">
              <div class="vg-rank-nome" title="${nomeExibido}">${nomeExibido}</div>
              <div class="vg-rank-bar-track">
                <div class="vg-rank-bar-fill" style="width: ${pct.toFixed(1)}%"></div>
              </div>
            </div>
            <span class="vg-rank-val">${Utilidades.formatarMoeda(m.total)}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderAlertas(alertas) {
  if (!alertas || alertas.length === 0) {
    return `<div class="vg-log-empty">Nenhum alerta no momento.</div>`;
  }

  return `
    <div class="vg-alertas-list">
      ${alertas.map(a => `
        <div class="vg-alerta vg-alerta-${a.tipo}">
          <div class="vg-alerta-titulo">${a.titulo}</div>
          <div class="vg-alerta-desc">${a.descricao}</div>
          ${a.acao ? `<button class="vg-alerta-acao" data-acao="${a.acao}">Ver detalhes →</button>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

/** Formata nome do médico de forma elegante e curta */
function formatarNomeMedico(nome) {
  if (!nome) return '—';
  // Se já tá em UPPER, converte pra Title Case
  if (nome === nome.toUpperCase()) {
    return nome.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  return nome;
}

function renderAtalhosRapidos() {
  return `
    <div class="vg-shortcuts">
      <button class="vg-shortcut" data-atalho="importar-qvis">
        <span class="vg-sc-ico">↑</span>
        <span class="vg-sc-label">Importar QVIS</span>
      </button>
      <button class="vg-shortcut" data-atalho="importar-laudos">
        <span class="vg-sc-ico">📄</span>
        <span class="vg-sc-label">Importar Laudos</span>
      </button>
      <button class="vg-shortcut" data-atalho="abrir-laudos">
        <span class="vg-sc-ico">📋</span>
        <span class="vg-sc-label">Abrir Laudos</span>
      </button>
      <button class="vg-shortcut" data-atalho="abrir-medicos">
        <span class="vg-sc-ico">👥</span>
        <span class="vg-sc-label">Médicos</span>
      </button>
    </div>
  `;
}

function renderSaudeSistema(saude) {
  return `
    <div class="vg-health">
      <div class="vg-health-item">
        <strong>${Utilidades.formatarNumero(saude.procedimentos)}</strong>
        <span>Procedimentos cadastrados</span>
      </div>
      <div class="vg-health-item">
        <strong>${Utilidades.formatarNumero(saude.medicos)}</strong>
        <span>Médicos cadastrados</span>
      </div>
      <div class="vg-health-item">
        <strong>${Utilidades.formatarNumero(saude.sinonimos)}</strong>
        <span>Grafias / sinônimos</span>
      </div>
      <div class="vg-health-item">
        <strong>${Utilidades.formatarNumero(saude.competencias)}</strong>
        <span>Competências históricas</span>
      </div>
    </div>
  `;
}

// ============================================================================
// AGREGAÇÕES DE DADOS (queries)
// ============================================================================

/** Detecta a competência mais recente que tem dados em algum fichário.
 *  Retorna 'AAAA-MM' ou null se não houver dados. */
function detectarCompetenciaAtual() {
  const candidatos = [];
  try {
    const q1 = Banco.query(`SELECT MAX(competencia) AS c FROM laudos`);
    if (q1[0] && q1[0].c) candidatos.push(q1[0].c);
  } catch (_) {}
  try {
    const q2 = Banco.query(`SELECT MAX(mes_ref) AS c FROM periodos_linhas`);
    if (q2[0] && q2[0].c) candidatos.push(q2[0].c);
  } catch (_) {}
  try {
    const q3 = Banco.query(`SELECT MAX(mes_ref) AS c FROM fellow_linhas`);
    if (q3[0] && q3[0].c) candidatos.push(q3[0].c);
  } catch (_) {}
  try {
    const q4 = Banco.query(`SELECT MAX(competencia) AS c FROM linhas_qvis`);
    if (q4[0] && q4[0].c) candidatos.push(q4[0].c);
  } catch (_) {}
  try {
    const q5 = Banco.query(`SELECT MAX(competencia) AS c FROM linhas_producao`);
    if (q5[0] && q5[0].c) candidatos.push(q5[0].c);
  } catch (_) {}
  try {
    const q6 = Banco.query(`SELECT printf('%04d-%02d', ano, mes) AS c FROM competencias ORDER BY ano DESC, mes DESC LIMIT 1`);
    if (q6[0] && q6[0].c) candidatos.push(q6[0].c);
  } catch (_) {}

  if (candidatos.length === 0) return null;
  return candidatos.sort().reverse()[0];   // maior AAAA-MM lexicograficamente = mais recente
}

/** Subtrai N meses de um AAAA-MM, retornando AAAA-MM. */
function subtrairMes(comp, n = 1) {
  if (!comp) return null;
  const [ano, mes] = comp.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Soma repasse de cada fonte na competência e retorna objeto por fonte. */
// V492: cache por chave (competencia + '|' + Banco._versao). Cada gravação no banco
// incrementa Banco._versao, então o cache se invalida sozinho — sem hook manual.
// Evita re-rodar as ~8 queries agregadas pesadas 8x por render (2 do topo + 6 da evolução).
const __vgRepasseCache = new Map();
function repasseConsolidado(comp) {
  const chave = comp + '|' + Banco._versao;                       // V492
  if (__vgRepasseCache.has(chave)) return __vgRepasseCache.get(chave);   // V492
  if (__vgRepasseCache.size > 200) __vgRepasseCache.clear();      // V492: higiene — descarta versões antigas
  const r = __vgRepasseConsolidadoCalc(comp);                     // V492
  __vgRepasseCache.set(chave, r);                                 // V492
  return r;                                                       // V492
}
// V492: cálculo original, inalterado (era o corpo de repasseConsolidado)
function __vgRepasseConsolidadoCalc(comp) {
  const r = { laudos: 0, periodos: 0, fellow: 0, qvis_calculado: 0, externos: 0, lio: 0, opme: 0 };
  if (!comp) return r;

  // Laudos (apenas linhas não-pendentes — pendentes não têm valor confiável)
  try {
    const q = Banco.query(
      `SELECT COALESCE(SUM(valor_repasse), 0) AS s
         FROM laudos
        WHERE competencia = ? AND COALESCE(pendente, 0) = 0`,
      [comp]
    );
    r.laudos = q[0] && q[0].s ? Number(q[0].s) : 0;
  } catch (_) {}

  // Períodos
  try {
    const q = Banco.query(
      `SELECT COALESCE(SUM(total_valor), 0) AS s
         FROM periodos_linhas
        WHERE mes_ref = ?`,
      [comp]
    );
    r.periodos = q[0] && q[0].s ? Number(q[0].s) : 0;
  } catch (_) {}

  // Fellow
  try {
    const q = Banco.query(
      `SELECT COALESCE(SUM(total_repassar), 0) AS s
         FROM fellow_linhas
        WHERE mes_ref = ?`,
      [comp]
    );
    r.fellow = q[0] && q[0].s ? Number(q[0].s) : 0;
  } catch (_) {}

  // QVIS calculado (linhas_calculadas, JOIN com competencias)
  try {
    const [ano, mes] = comp.split('-').map(Number);
    const q = Banco.query(
      `SELECT COALESCE(SUM(lc.valor_repasse), 0) AS s
         FROM linhas_calculadas lc
         JOIN competencias c ON c.id = lc.competencia_id
        WHERE c.ano = ? AND c.mes = ? AND lc.excluida = 0`,
      [ano, mes]
    );
    r.qvis_calculado = q[0] && q[0].s ? Number(q[0].s) : 0;
  } catch (_) {}

  // Lançamentos externos
  try {
    const [ano, mes] = comp.split('-').map(Number);
    const q = Banco.query(
      `SELECT COALESCE(SUM(le.valor_total), 0) AS s
         FROM lancamentos_externos le
         JOIN competencias c ON c.id = le.competencia_id
        WHERE c.ano = ? AND c.mes = ?`,
      [ano, mes]
    );
    r.externos = q[0] && q[0].s ? Number(q[0].s) : 0;
  } catch (_) {}

  // 6) LIO — repasse aproximado calculado on-the-fly (V128.1)
  //    Pega valor da produção * pct_executante do médico (ou pct geral 18%)
  //    Filtra: classificacao_produto='OPME' + tipo_produto LIKE LIO
  //    Exclui: produtos em lio_produtos_excluidos pela mesma fonte
  try {
    const pctGeralExec = Number(
      (Banco.query(`SELECT valor FROM config_lio WHERE chave = 'PCT_EXECUTANTE_GERAL'`)[0] || {}).valor
    ) || 18;
    const pctGeralInd = Number(
      (Banco.query(`SELECT valor FROM config_lio WHERE chave = 'PCT_INDICANTE_GERAL'`)[0] || {}).valor
    ) || 2.5;

    const q = Banco.query(
      `SELECT COALESCE(SUM(
                p.valor * COALESCE(lr.pct_executante, ?) / 100.0
              ), 0) AS s
         FROM linhas_producao p
    LEFT JOIN lio_regra_medico lr
           ON UPPER(TRIM(COALESCE(p.medico, p.cirurgiao, ''))) = lr.nome_normalizado
        WHERE p.competencia = ?
          AND p.classificacao_produto = 'OPME'
          AND (
            UPPER(COALESCE(p.tipo_produto,'')) LIKE '%LIO%'
            OR UPPER(COALESCE(p.tipo_produto,'')) = 'LENTE INTRA OCULAR'
            OR UPPER(COALESCE(p.tipo_produto,'')) = 'SERVICO DE LIO'
          )
          AND COALESCE(p.valor, 0) > 0
          AND p.produto NOT IN (
            SELECT produto FROM lio_produtos_excluidos
             WHERE UPPER(TRIM(COALESCE(tipo_recebimento, 'CONVENIO'))) = UPPER(TRIM(COALESCE(p.tipo_recebimento, 'CONVENIO')))
          )`,
      [pctGeralExec, comp]
    );
    r.lio = q[0] && q[0].s ? Number(q[0].s) : 0;

    // Soma também repasse de indicantes (médicos que aparecem como indicante e têm % indicante)
    const qInd = Banco.query(
      `SELECT COALESCE(SUM(
                p.valor * COALESCE(lr.pct_indicante, ?) / 100.0
              ), 0) AS s
         FROM linhas_producao p
         JOIN lio_regra_medico lr
           ON UPPER(TRIM(COALESCE(p.indicante, ''))) = lr.nome_normalizado
        WHERE p.competencia = ?
          AND p.classificacao_produto = 'OPME'
          AND (
            UPPER(COALESCE(p.tipo_produto,'')) LIKE '%LIO%'
            OR UPPER(COALESCE(p.tipo_produto,'')) = 'LENTE INTRA OCULAR'
            OR UPPER(COALESCE(p.tipo_produto,'')) = 'SERVICO DE LIO'
          )
          AND COALESCE(p.valor, 0) > 0
          AND UPPER(TRIM(COALESCE(p.indicante, ''))) <> UPPER(TRIM(COALESCE(p.medico, '')))
          AND p.produto NOT IN (
            SELECT produto FROM lio_produtos_excluidos
             WHERE UPPER(TRIM(COALESCE(tipo_recebimento, 'CONVENIO'))) = UPPER(TRIM(COALESCE(p.tipo_recebimento, 'CONVENIO')))
          )`,
      [pctGeralInd, comp]
    );
    r.lio += qInd[0] && qInd[0].s ? Number(qInd[0].s) : 0;
  } catch (e) { console.warn('[Dashboard] erro calculando LIO:', e); }

  // 7) OPME — repasse aproximado calculado on-the-fly (V128.1)
  //    Filtra: classificacao_produto='OPME' MAS NÃO LIO (pra não duplicar)
  //    + produto bate com algum termo elegível em opme_termos_elegiveis
  //    + produto NÃO está em opme_produtos_excluidos
  try {
    // Lê termos elegíveis ativos (pra evitar fazer LIKE n vezes)
    const termos = Banco.query(`SELECT termo FROM opme_termos_elegiveis WHERE ativo = 1`)
      .map(r => String(r.termo || '').trim().toUpperCase())
      .filter(t => t.length > 0);

    if (termos.length > 0) {
      // Construir cláusula OR com cada termo
      const ors = termos.map(_ => `UPPER(COALESCE(p.produto,'')) LIKE ?`).join(' OR ');
      const params = [comp, ...termos.map(t => `%${t}%`)];

      const q = Banco.query(
        `SELECT COALESCE(SUM(
                  p.valor * COALESCE(orm.pct, 27) / 100.0
                ), 0) AS s
           FROM linhas_producao p
      LEFT JOIN opme_regra_medico orm
             ON UPPER(TRIM(COALESCE(p.medico, p.cirurgiao, ''))) = orm.nome_normalizado
          WHERE p.competencia = ?
            AND p.classificacao_produto = 'OPME'
            AND COALESCE(p.valor, 0) > 0
            -- exclui LIO (já contabilizado em r.lio)
            AND NOT (
              UPPER(COALESCE(p.tipo_produto,'')) LIKE '%LIO%'
              OR UPPER(COALESCE(p.tipo_produto,'')) = 'LENTE INTRA OCULAR'
              OR UPPER(COALESCE(p.tipo_produto,'')) = 'SERVICO DE LIO'
            )
            AND (${ors})
            AND p.produto NOT IN (SELECT produto FROM opme_produtos_excluidos)`,
        params
      );
      r.opme = q[0] && q[0].s ? Number(q[0].s) : 0;
    }
  } catch (e) { console.warn('[Dashboard] erro calculando OPME:', e); }

  return r;
}

function somaObj(obj) {
  return Object.values(obj).reduce((a, b) => a + (Number(b) || 0), 0);
}

/** Quantos médicos receberam algum valor de repasse na competência (distintos). */
function medicosAtivos(comp) {
  if (!comp) return 0;
  const nomes = new Set();
  try {
    const q = Banco.query(
      `SELECT DISTINCT UPPER(TRIM(medico)) AS n
         FROM laudos
        WHERE competencia = ? AND medico IS NOT NULL AND TRIM(medico) <> ''`,
      [comp]
    );
    q.forEach(x => x.n && nomes.add(x.n));
  } catch (_) {}
  try {
    const q = Banco.query(
      `SELECT DISTINCT nome_normalizado AS n
         FROM periodos_linhas
        WHERE mes_ref = ?`,
      [comp]
    );
    q.forEach(x => x.n && nomes.add(x.n));
  } catch (_) {}
  try {
    const q = Banco.query(
      `SELECT DISTINCT fellow_norm AS n
         FROM fellow_linhas
        WHERE mes_ref = ?`,
      [comp]
    );
    q.forEach(x => x.n && nomes.add(x.n));
  } catch (_) {}
  try {
    const [ano, mes] = comp.split('-').map(Number);
    const q = Banco.query(
      `SELECT DISTINCT m.nome_normalizado AS n
         FROM linhas_calculadas lc
         JOIN competencias c ON c.id = lc.competencia_id
         JOIN medicos m ON m.id = lc.medico_id
        WHERE c.ano = ? AND c.mes = ? AND lc.excluida = 0`,
      [ano, mes]
    );
    q.forEach(x => x.n && nomes.add(x.n));
  } catch (_) {}
  return nomes.size;
}

function pendenciasLaudos(comp) {
  const r = { qtd: 0 };
  if (!comp) return r;
  try {
    const q = Banco.query(
      `SELECT COUNT(*) AS qtd
         FROM laudos
        WHERE competencia = ? AND pendente = 1`,
      [comp]
    );
    r.qtd = q[0] && q[0].qtd ? Number(q[0].qtd) : 0;
  } catch (_) {}
  return r;
}

/** Retorna array de status por fichário pra competência. */
function statusFicharios(comp) {
  if (!comp) return [];

  const checagens = [
    { nome: 'Laudos',          tabela: 'laudos',           campoComp: 'competencia',  unidade: 'linhas' },
    { nome: 'Períodos',        tabela: 'periodos_linhas',  campoComp: 'mes_ref',      unidade: 'linhas' },
    { nome: 'Fellow',          tabela: 'fellow_linhas',    campoComp: 'mes_ref',      unidade: 'plantões' },
    { nome: 'QVIS (Geral)',    tabela: 'linhas_qvis',      campoComp: 'competencia',  unidade: 'linhas' },
    { nome: 'Produção Analítica', tabela: 'linhas_producao', campoComp: 'competencia', unidade: 'linhas' },
  ];

  return checagens.map(c => {
    let qtd = 0;
    try {
      const q = Banco.query(
        `SELECT COUNT(*) AS n FROM ${c.tabela} WHERE ${c.campoComp} = ?`,
        [comp]
      );
      qtd = q[0] && q[0].n ? Number(q[0].n) : 0;
    } catch (_) {}
    return {
      nome: c.nome,
      qtd,
      unidade: c.unidade,
      estado: qtd > 0 ? 'ok' : 'vazio',
    };
  });
}

/** Últimas N importações registradas. */
function ultimasImportacoes(n = 5) {
  try {
    const q = Banco.query(
      `SELECT i.tipo,
              i.qtd_linhas AS qtd,
              i.importado_em,
              printf('%04d-%02d', c.ano, c.mes) AS comp_codigo
         FROM importacoes i
         JOIN competencias c ON c.id = i.competencia_id
        WHERE i.status = 'OK'
        ORDER BY i.importado_em DESC
        LIMIT ?`,
      [n]
    );
    return q.map(r => ({
      tipo: r.tipo || '—',
      qtd: r.qtd || 0,
      competencia: formatarCompetenciaBR(r.comp_codigo),
      quando_relativo: tempoRelativo(r.importado_em),
      hora: formatarHora(r.importado_em),
    }));
  } catch (_) {
    return [];
  }
}

/** Retorna array com últimas N competências (incluindo a atual) com totais.
 *  Ex: [{comp: '2025-11', total: 2500000}, ..., {comp: '2026-04', total: 2847392}] */
function evolucaoMensal(compAtual, n = 6) {
  if (!compAtual) return [];
  const result = [];
  for (let i = n - 1; i >= 0; i--) {
    const c = subtrairMes(compAtual, i);
    const repasse = repasseConsolidado(c);
    result.push({ comp: c, total: somaObj(repasse) });
  }
  return result;
}

/** Top N médicos por repasse na competência (consolidado das 5 fontes). */
function topMedicosComp(comp, n = 10) {
  if (!comp) return [];
  const acum = new Map();  // chave: nome_norm → { nome_norm, nome_display, total }

  const add = (nomeNorm, nomeDisplay, valor) => {
    if (!nomeNorm || valor == null) return;
    const v = Number(valor);
    if (!v || isNaN(v)) return;
    const key = String(nomeNorm).trim().toUpperCase();
    if (!key) return;
    if (!acum.has(key)) {
      acum.set(key, { nome_norm: key, nome_display: nomeDisplay || key, total: 0 });
    }
    acum.get(key).total += v;
  };

  // 1) Laudos (excluindo pendentes — não têm valor confiável)
  try {
    const q = Banco.query(
      `SELECT UPPER(TRIM(medico)) AS nome_norm,
              medico               AS nome_display,
              SUM(valor_repasse)   AS total
         FROM laudos
        WHERE competencia = ?
          AND medico IS NOT NULL AND TRIM(medico) <> ''
          AND COALESCE(pendente, 0) = 0
        GROUP BY UPPER(TRIM(medico))`,
      [comp]
    );
    q.forEach(r => add(r.nome_norm, r.nome_display, r.total));
  } catch (_) {}

  // 2) Períodos
  try {
    const q = Banco.query(
      `SELECT nome_normalizado   AS nome_norm,
              MAX(nome_original) AS nome_display,
              SUM(total_valor)   AS total
         FROM periodos_linhas
        WHERE mes_ref = ?
        GROUP BY nome_normalizado`,
      [comp]
    );
    q.forEach(r => add(r.nome_norm, r.nome_display, r.total));
  } catch (_) {}

  // 3) Fellow
  try {
    const q = Banco.query(
      `SELECT fellow_norm        AS nome_norm,
              MAX(fellow_nome)   AS nome_display,
              SUM(total_repassar) AS total
         FROM fellow_linhas
        WHERE mes_ref = ?
        GROUP BY fellow_norm`,
      [comp]
    );
    q.forEach(r => add(r.nome_norm, r.nome_display, r.total));
  } catch (_) {}

  // 4) QVIS calculado
  try {
    const [ano, mes] = comp.split('-').map(Number);
    const q = Banco.query(
      `SELECT m.nome_normalizado    AS nome_norm,
              m.nome_oficial        AS nome_display,
              SUM(lc.valor_repasse) AS total
         FROM linhas_calculadas lc
         JOIN competencias c ON c.id = lc.competencia_id
         JOIN medicos m      ON m.id = lc.medico_id
        WHERE c.ano = ? AND c.mes = ? AND lc.excluida = 0
        GROUP BY m.id`,
      [ano, mes]
    );
    q.forEach(r => add(r.nome_norm, r.nome_display, r.total));
  } catch (_) {}

  // 5) Lançamentos externos
  try {
    const [ano, mes] = comp.split('-').map(Number);
    const q = Banco.query(
      `SELECT m.nome_normalizado AS nome_norm,
              m.nome_oficial     AS nome_display,
              SUM(le.valor_total) AS total
         FROM lancamentos_externos le
         JOIN competencias c ON c.id = le.competencia_id
         JOIN medicos m      ON m.id = le.medico_id
        WHERE c.ano = ? AND c.mes = ?
        GROUP BY m.id`,
      [ano, mes]
    );
    q.forEach(r => add(r.nome_norm, r.nome_display, r.total));
  } catch (_) {}

  return Array.from(acum.values())
    .filter(x => x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}

/** Alertas inteligentes baseados em estado real do banco. */
function alertasInteligentes(comp) {
  const alertas = [];
  if (!comp) return alertas;

  // 1) Pendências de precificação em Laudos (CRÍTICO)
  try {
    const q = Banco.query(
      `SELECT COUNT(*) AS qtd FROM laudos WHERE competencia = ? AND pendente = 1`,
      [comp]
    );
    const qtd = q[0] && q[0].qtd ? Number(q[0].qtd) : 0;
    if (qtd > 0) {
      alertas.push({
        tipo: 'danger',
        titulo: `${qtd} laudo(s) pendente(s) de precificação`,
        descricao: `Itens marcados como "LANÇAR" no fichário Laudos · ${formatarCompetenciaBR(comp)}`,
        acao: 'desempenho-laudos',
      });
    }
  } catch (_) {}

  // 2) Médicos com produção LIO sem regra cadastrada (AVISO)
  try {
    const q = Banco.query(
      `SELECT COUNT(DISTINCT UPPER(TRIM(p.medico))) AS qtd
         FROM linhas_producao p
        WHERE p.competencia = ?
          AND p.classificacao_produto = 'OPME'
          AND (UPPER(COALESCE(p.tipo_produto,'')) LIKE '%LIO%'
               OR UPPER(COALESCE(p.tipo_produto,'')) = 'LENTE INTRA OCULAR'
               OR UPPER(COALESCE(p.tipo_produto,'')) = 'SERVICO DE LIO')
          AND p.medico IS NOT NULL AND TRIM(p.medico) <> ''
          AND UPPER(TRIM(p.medico)) NOT IN (SELECT medico_norm FROM lio_regra_medico)`,
      [comp]
    );
    const qtd = q[0] && q[0].qtd ? Number(q[0].qtd) : 0;
    if (qtd > 0) {
      alertas.push({
        tipo: 'warning',
        titulo: `${qtd} médico(s) com produção LIO sem regra cadastrada`,
        descricao: 'Sem % de executante/indicante definido, o repasse não pode ser calculado',
        acao: 'desempenho-lio',
      });
    }
  } catch (_) {}

  // 3) Médicos no Laudos sem cadastro central (AVISO)
  try {
    const q = Banco.query(
      `SELECT COUNT(DISTINCT UPPER(TRIM(l.medico))) AS qtd
         FROM laudos l
        WHERE l.competencia = ?
          AND l.medico IS NOT NULL AND TRIM(l.medico) <> ''
          AND UPPER(TRIM(l.medico)) NOT IN (SELECT UPPER(TRIM(nome_normalizado)) FROM medicos)`,
      [comp]
    );
    const qtd = q[0] && q[0].qtd ? Number(q[0].qtd) : 0;
    if (qtd > 0) {
      alertas.push({
        tipo: 'warning',
        titulo: `${qtd} nome(s) no Laudos não bate(m) com o cadastro central`,
        descricao: 'Verifique no "De-Para de Nomes" pra normalizar variações',
        acao: 'de-para-nomes',
      });
    }
  } catch (_) {}

  // 3.5) Divergência valor_repasse × laudos_valores (tabela mestre) — AVISO
  //      Detecta linhas importadas onde o valor não bate com a tabela de referência.
  //      Tolerância de R$ 0,01 pra ignorar arredondamento.
  try {
    const q = Banco.query(
      `SELECT COUNT(*) AS qtd_linhas,
              COUNT(DISTINCT UPPER(TRIM(l.exame))) AS qtd_exames
         FROM laudos l
         JOIN laudos_valores lv
           ON UPPER(TRIM(l.exame)) = UPPER(TRIM(lv.exame))
        WHERE l.competencia = ?
          AND COALESCE(l.pendente, 0) = 0
          AND (
            (COALESCE(l.particular, 0) = 1
              AND lv.valor_particular > 0
              AND ABS(COALESCE(l.valor_repasse, 0) - lv.valor_particular) > 0.01)
            OR
            (COALESCE(l.particular, 0) = 0
              AND lv.valor_convenio > 0
              AND ABS(COALESCE(l.valor_repasse, 0) - lv.valor_convenio) > 0.01)
          )`,
      [comp]
    );
    const qtdLin = q[0] && q[0].qtd_linhas ? Number(q[0].qtd_linhas) : 0;
    const qtdExm = q[0] && q[0].qtd_exames ? Number(q[0].qtd_exames) : 0;
    if (qtdLin > 0) {
      alertas.push({
        tipo: 'warning',
        titulo: `${qtdLin} linha(s) com valor divergente da tabela mestre`,
        descricao: `${qtdExm} exame(s) com valor importado diferente do cadastrado em "Tabela de Preços"`,
        acao: 'desempenho-laudos',
      });
    }
  } catch (_) {}

  // 4) Importações realizadas hoje (INFO — atividade positiva)
  try {
    const q = Banco.query(
      `SELECT COUNT(*) AS qtd
         FROM importacoes
        WHERE status = 'OK'
          AND date(importado_em) = date('now', 'localtime')`
    );
    const qtd = q[0] && q[0].qtd ? Number(q[0].qtd) : 0;
    if (qtd > 0) {
      alertas.push({
        tipo: 'info',
        titulo: `${qtd} importação(ões) realizada(s) hoje`,
        descricao: 'O sistema recebeu dados novos nas últimas horas',
      });
    }
  } catch (_) {}

  // 5) Estado "tudo certo" — se nenhum dos alertas críticos disparou
  const temCritico = alertas.some(a => a.tipo === 'danger' || a.tipo === 'warning');
  if (!temCritico) {
    alertas.unshift({
      tipo: 'success',
      titulo: 'Tudo certo na competência atual',
      descricao: 'Sem pendências críticas. Boa hora pra revisar relatórios e fechar a competência.',
    });
  }

  return alertas;
}

// ============================================================================
// HELPERS DE FORMATAÇÃO
// ============================================================================

function formatarCompetenciaBR(comp) {
  if (!comp) return '—';
  const [ano, mes] = comp.split('-').map(Number);
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${meses[mes - 1]}/${ano}`;
}

function tempoRelativo(iso) {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  const hoje = new Date();
  const diffMin = Math.floor((hoje - d) / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'ontem';
  if (diffD < 7) return `${diffD}d`;
  return Utilidades.formatarDataBR(iso.slice(0, 10));
}

function formatarHora(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ============================================================================
// INTERAÇÃO
// ============================================================================

function bindAtalhos() {
  document.querySelectorAll('.vg-shortcut').forEach(btn => {
    btn.addEventListener('click', () => {
      const tipo = btn.dataset.atalho;
      switch (tipo) {
        case 'importar-qvis':   App.navegarPara('importar-qvis');     break;
        case 'importar-laudos': App.navegarPara('importar-laudos');   break;
        case 'abrir-laudos':    App.navegarPara('desempenho-laudos'); break;
        case 'abrir-medicos':   App.navegarPara('medicos');           break;
      }
    });
  });

  // Click em barras do gráfico de evolução → abre Laudos
  // (a competência selecionada fica na responsabilidade da tela Laudos
  //  via querystring/state — por ora só abre o módulo)
  document.querySelectorAll('.vg-bar-group').forEach(g => {
    g.addEventListener('click', () => {
      App.navegarPara('desempenho-laudos');
    });
  });

  // Click nas ações dos alertas → navega pro módulo apontado
  document.querySelectorAll('.vg-alerta-acao').forEach(btn => {
    btn.addEventListener('click', () => {
      const tela = btn.dataset.acao;
      if (tela) App.navegarPara(tela);
    });
  });
}

// ============================================================================
// CSS INJETADO
// ============================================================================

function injetarEstilosDashboard() {
  if (document.getElementById('vg-estilos')) return;
  const style = document.createElement('style');
  style.id = 'vg-estilos';
  style.textContent = `
    /* === HERO + KPIs === */
    .vg-hero-row {
      display: grid;
      grid-template-columns: 1.4fr 1fr 1fr 1fr;
      gap: var(--space-4);
      margin-bottom: var(--space-6);
    }
    .vg-hero {
      background: #222422;
      color: #f2f3f5;
      border-radius: var(--radius-lg);
      padding: var(--space-5);
      position: relative;
      overflow: hidden;
    }
    .vg-hero::before {
      content: '';
      position: absolute;
      top: -40px; right: -40px;
      width: 200px; height: 200px;
      background: radial-gradient(circle, rgba(63, 100, 137, 0.12) 0%, transparent 70%);
      pointer-events: none;
    }
    .vg-hero-label {
      font-size: 11px;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      color: rgba(63, 100, 137, 0.80);
      font-weight: 600;
      margin-bottom: var(--space-2);
    }
    .vg-hero-value {
      font-family: var(--font-display);
      font-size: 42px;
      font-weight: 500;
      line-height: 1;
      letter-spacing: -0.025em;
      color: #fafbfc;
      margin-bottom: var(--space-2);
    }
    .vg-hero-meta {
      font-size: 13px;
      color: rgba(63, 100, 137, 0.65);
      margin-bottom: var(--space-3);
    }
    .vg-hero-foot {
      font-size: 11px;
      color: rgba(240, 242, 240, 0.60);
      letter-spacing: 0.02em;
      border-top: 1px solid rgba(240, 242, 240, 0.12);
      padding-top: var(--space-2);
      margin-top: var(--space-2);
    }
    .vg-var-up   { color: #A8D5B1; font-weight: 600; }
    .vg-var-down { color: #E6B5B5; font-weight: 600; }
    .vg-meta-faint { color: rgba(63, 100, 137, 0.55); font-style: italic; }

    /* === Linha de 2 cards (status, ranking, alertas) === */
    .vg-row-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-4);
      margin-bottom: var(--space-6);
    }

    /* === Linha de gráficos === */
    .vg-row-charts {
      display: grid;
      grid-template-columns: 1.6fr 1fr;
      gap: var(--space-4);
      margin-bottom: var(--space-6);
    }
    .vg-chart-card { min-height: 280px; }

    /* === Status grid === */
    .vg-status-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      margin-top: var(--space-3);
    }
    .vg-status-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      padding: 10px 14px;
      background: var(--bg-sunken);
      border-radius: var(--radius-md);
      border: 1px solid var(--border);
      font-size: 13px;
    }
    .vg-status-nome { color: var(--ink-soft); font-weight: 500; }
    .vg-status-badge { font-size: 12px; font-weight: 600; white-space: nowrap; }
    .vg-badge-ok      { color: #15a34a; }   /* V711: verde da VG */
    .vg-badge-parcial { color: var(--warning); }
    .vg-badge-vazio   { color: var(--ink-faint); opacity: 0.7; }

    /* === Log de importações === */
    .vg-log { margin-top: var(--space-3); }
    .vg-log-item {
      display: grid;
      grid-template-columns: 70px 1fr 50px;
      gap: var(--space-2);
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      align-items: center;
    }
    .vg-log-item:last-child { border-bottom: none; }
    .vg-log-quando {
      color: var(--accent);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .vg-log-texto { color: var(--ink-soft); }
    .vg-log-texto strong { color: var(--ink); font-weight: 600; }
    .vg-log-hora {
      color: var(--ink-faint);
      font-size: 11px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .vg-log-empty {
      padding: 20px;
      text-align: center;
      color: var(--ink-faint);
      font-style: italic;
      font-size: 13px;
    }

    /* === Gráficos SVG === */
    .vg-svg-wrap {
      width: 100%;
      margin-top: var(--space-3);
    }
    .vg-svg-grafico {
      width: 100%;
      height: auto;
      max-height: 240px;
      display: block;
    }
    .vg-bar-group { cursor: pointer; transition: opacity var(--t-fast); }
    .vg-bar {
      transition: background-color var(--t-fast), color var(--t-fast), border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast), opacity var(--t-fast);
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.08));
    }
    .vg-bar-group:hover .vg-bar {
      filter: drop-shadow(0 3px 8px rgba(89, 128, 166, 0.30));
      opacity: 0.92;
    }

    /* Animação de entrada das barras */
    @keyframes vg-bar-grow {
      from { transform: scaleY(0); }
      to   { transform: scaleY(1); }
    }
    .vg-svg-grafico .vg-bar {
      transform-origin: bottom;
      transform-box: fill-box;
      animation: vg-bar-grow 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }

    /* === Donut === */
    .vg-donut-wrap {
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: var(--space-4);
      align-items: center;
      margin-top: var(--space-3);
    }
    .vg-svg-donut {
      width: 100%;
      max-width: 200px;
      height: auto;
      display: block;
    }
    .vg-donut-seg {
      cursor: default;
      transition: opacity var(--t-fast), transform var(--t-fast);
      transform-origin: 100px 100px;
      transform-box: fill-box;
    }
    .vg-donut-seg:hover {
      opacity: 0.85;
    }
    .vg-svg-donut > * {
      animation: vg-fade-in 0.5s ease-out;
    }
    @keyframes vg-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* Legenda do donut */
    .vg-legenda {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .vg-legenda-item {
      display: grid;
      grid-template-columns: 14px 1fr auto;
      gap: 10px;
      align-items: center;
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 6px;
      transition: background var(--t-fast);
    }
    .vg-legenda-item:hover {
      background: var(--bg-sunken);
    }
    .vg-legenda-swatch {
      width: 12px;
      height: 12px;
      border-radius: 3px;
      display: block;
    }
    .vg-legenda-nome {
      color: var(--ink-soft);
      font-weight: 500;
    }
    .vg-legenda-valor {
      color: var(--ink);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      font-size: 13px;
    }

    /* === Ranking Top 10 médicos === */
    .vg-ranking-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: var(--space-3);
    }
    .vg-rank-item {
      display: grid;
      grid-template-columns: 28px 1fr 110px;
      gap: var(--space-3);
      align-items: center;
      padding: 8px 6px;
      border-radius: 6px;
      transition: background var(--t-fast);
    }
    .vg-rank-item:hover { background: var(--bg-sunken); }
    .vg-rank-pos {
      font-family: var(--font-display);
      font-size: 18px;
      font-weight: 600;
      color: var(--accent);
      text-align: center;
      line-height: 1;
    }
    .vg-rank-content {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .vg-rank-nome {
      font-size: 13px;
      color: var(--ink-soft);
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .vg-rank-bar-track {
      height: 5px;
      background: var(--bg-sunken);
      border-radius: 3px;
      overflow: hidden;
      position: relative;
    }
    .vg-rank-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--primary) 0%, var(--primary-hover) 100%);
      border-radius: 3px;
      transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
      animation: vg-rank-grow 0.7s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes vg-rank-grow {
      from { width: 0 !important; }
    }
    .vg-rank-val {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      color: var(--ink);
      font-size: 13px;
      text-align: right;
      white-space: nowrap;
    }
    /* Top 3 com destaque */
    .vg-rank-item:nth-child(1) .vg-rank-pos { font-size: 22px; }
    .vg-rank-item:nth-child(1) .vg-rank-bar-fill {
      background: linear-gradient(90deg, var(--accent) 0%, #D4B07A 100%);
    }
    .vg-rank-item:nth-child(2) .vg-rank-bar-fill,
    .vg-rank-item:nth-child(3) .vg-rank-bar-fill {
      background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
    }

    /* === Alertas inteligentes === */
    .vg-alertas-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: var(--space-3);
    }
    .vg-alerta {
      padding: 12px 14px;
      border-radius: var(--radius-md);
      border-left: 3px solid;
      position: relative;
    }
    .vg-alerta-danger {
      background: var(--danger-soft, #faf5f3);
      border-left-color: var(--danger);
    }
    .vg-alerta-warning {
      background: var(--warning-soft, #F4E8D2);
      border-left-color: var(--warning);
    }
    .vg-alerta-info {
      background: var(--accent-soft);
      border-left-color: var(--accent);
    }
    .vg-alerta-success {
      background: var(--success-soft, #e9f1e9);
      border-left-color: var(--success);
    }
    .vg-alerta-titulo {
      font-size: 13px;
      font-weight: 600;
      color: var(--ink);
      margin-bottom: 2px;
      line-height: 1.35;
    }
    .vg-alerta-desc {
      font-size: 12px;
      color: var(--ink-soft);
      line-height: 1.45;
    }
    .vg-alerta-acao {
      margin-top: 8px;
      padding: 4px 0;
      background: none;
      border: none;
      color: var(--primary);
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      letter-spacing: 0.02em;
      transition: color var(--t-fast);
    }
    .vg-alerta-acao:hover { color: var(--primary-hover); text-decoration: underline; }

    /* === Placeholders (caso ainda apareçam) === */
    .vg-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 30px;
      background: repeating-linear-gradient(
        45deg,
        var(--bg-sunken),
        var(--bg-sunken) 8px,
        var(--bg) 8px,
        var(--bg) 16px
      );
      border-radius: var(--radius-md);
      color: var(--accent);
      font-size: 13px;
      font-style: italic;
      margin-top: var(--space-3);
      min-height: 180px;
      border: 1px dashed var(--border-strong);
    }
    .vg-ph-ico { font-size: 28px; opacity: 0.7; }

    /* === Atalhos === */
    .vg-shortcuts {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--space-3);
      margin-bottom: var(--space-6);
    }
    .vg-shortcut {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 18px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      cursor: pointer;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      color: var(--primary);
      transition: background-color var(--t-fast), color var(--t-fast), border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast), opacity var(--t-fast);
    }
    .vg-shortcut:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .vg-sc-ico {
      font-size: 22px;
      color: var(--accent);
      line-height: 1;
    }
    .vg-sc-label { letter-spacing: 0.02em; }

    /* === Saúde do sistema (rodapé) === */
    .vg-health {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--space-4);
      padding: var(--space-4) var(--space-5);
      background: var(--bg-sunken);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border);
    }
    .vg-health-item {
      text-align: center;
      font-size: 11px;
      color: var(--ink-faint);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .vg-health-item strong {
      display: block;
      font-size: 22px;
      font-family: var(--font-display);
      color: var(--ink);
      font-weight: 500;
      margin-bottom: 2px;
      letter-spacing: -0.01em;
    }

    /* === Estado vazio (sem dados ainda) === */
    .vg-empty {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--space-7);
      text-align: center;
      margin-bottom: var(--space-6);
    }
    .vg-empty h3 {
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 500;
      margin: 0 0 var(--space-2);
      color: var(--ink);
    }
    .vg-empty p {
      margin: 0 0 var(--space-1);
      color: var(--ink-soft);
      font-size: 14px;
    }
    .vg-empty-hint {
      color: var(--accent) !important;
      font-style: italic;
      font-size: 13px !important;
    }

    /* === Responsividade básica === */
    @media (max-width: 1100px) {
      .vg-hero-row { grid-template-columns: 1fr 1fr; }
      .vg-row-2,
      .vg-row-charts { grid-template-columns: 1fr; }
      .vg-shortcuts { grid-template-columns: repeat(2, 1fr); }
      .vg-health    { grid-template-columns: repeat(2, 1fr); }
    }
  `;
  document.head.appendChild(style);
}
