/**
 * ============================================================================
 * TELA: Desempenho · Cargos Administrativos
 *
 * Estrutura em 3 seções:
 *
 *   A — Valor fixo por TAG (3 cards: DM, CM, RT)
 *       O usuário define o valor mensal de cada TAG.
 *       Médicos com a TAG recebem automaticamente esse valor.
 *
 *   B — Exceções (regras especiais)
 *       Casos onde um médico com a TAG NÃO recebe o valor fixo
 *       (recebe outra regra, ex: % sobre produção).
 *       Hoje cobre o caso "Coordenador de Lentes de Contato".
 *
 *   Tabela de médicos com cargo administrativo
 *       Mostra cada médico, suas TAGs, regra aplicada e valor mensal.
 *       Médicos com exceção têm linha destacada.
 *
 * IMPORTANTE: ao calcular o repasse mensal (Fase 2), o sistema vai consultar
 * essas tabelas. Médico com exceção NÃO recebe o valor fixo da TAG — recebe
 * apenas o valor calculado pela exceção, para evitar pagamento duplicado.
 * ============================================================================
 */

App.telas['desempenho-cargos'] = function () {
  // Estado de filtro de período (persiste enquanto a tela existir).
  // Default: competência mais recente disponível na produção LC.
  if (window.__cargos === undefined) {
    window.__cargos = {
      anoSelecionado: null,
      mesSelecionado: null,
      infoAberto: false,    // V128.4: popover info ⓘ
    };
  }

  renderizar();

  function renderizar() {

    // ── Dados ──────────────────────────────────────────────────────────────

    // Valor mensal de cada cargo
    const valores = {};
    Banco.query('SELECT cargo, valor_mensal FROM valores_cargos').forEach(r => {
      valores[r.cargo] = Number(r.valor_mensal) || 0;
    });
    // Garante fallback (se seed ainda não rodou)
    for (const c of ['DIRETORIA_TECNICA', 'DIRETORIA_CLINICA', 'COORDENADOR_MEDICO', 'RESPONSAVEL_TECNICO']) {
      if (valores[c] === undefined) valores[c] = 0;
    }

    // Contagem de médicos por cargo
    const contagem = {};
    Banco.query(`
      SELECT mc.cargo, COUNT(*) AS qtd
      FROM medico_cargos mc
      JOIN medicos m ON m.id = mc.medico_id AND m.ativo = 1
      GROUP BY mc.cargo
    `).forEach(r => { contagem[r.cargo] = r.qtd; });

    // Exceções cadastradas
    const excecoes = Banco.query(`
      SELECT
        e.*,
        m.nome_oficial AS nome_medico,
        (SELECT COUNT(*) FROM excecao_procedimentos WHERE excecao_id = e.id) AS qtd_procs
      FROM excecoes_cargo e
      JOIN medicos m ON m.id = e.medico_id
      WHERE e.ativo = 1
      ORDER BY e.nome
    `);
    // Mapa: medico_id → exceção (para identificar médicos com regra especial)
    const excPorMedico = new Map();
    for (const exc of excecoes) {
      excPorMedico.set(exc.medico_id, exc);
    }

    // ── Contexto de produção LC ────────────────────────────────────────────
    // Lista de competências disponíveis na produção LC e a competência ativa
    // (selecionada nos filtros ou, por default, a mais recente).
    const competenciasLC = listarCompetenciasLC();

    // Resolve competência ativa: se o usuário tem ano/mês selecionados, usa;
    // senão, fallback para a mais recente disponível.
    if (!window.__cargos.anoSelecionado && competenciasLC.length > 0) {
      const [ano, mes] = competenciasLC[0].split('-');
      window.__cargos.anoSelecionado = ano;
      window.__cargos.mesSelecionado = mes;
    }
    const competenciaLC = window.__cargos.anoSelecionado && window.__cargos.mesSelecionado
      ? `${window.__cargos.anoSelecionado}-${window.__cargos.mesSelecionado}`
      : null;
    const producaoLCTotal = competenciaLC ? calcularProducaoLCTotal(competenciaLC) : 0;

    // Médicos com algum cargo administrativo (excluindo Sócio, que é apenas informativo)
    const medicosComCargo = Banco.query(`
      SELECT
        m.id AS medico_id,
        m.nome_oficial AS nome_medico,
        GROUP_CONCAT(mc.cargo, ',') AS cargos
      FROM medicos m
      JOIN medico_cargos mc ON mc.medico_id = m.id
      WHERE m.ativo = 1 AND mc.cargo != 'SOCIO'
      GROUP BY m.id
      ORDER BY m.nome_oficial
    `);

    // ── Cálculos ───────────────────────────────────────────────────────────

    // Total custos por cargo (descontando médicos com exceção)
    const custosFixosPorCargo = {};
    let totalGeralFixos = 0;
    let qtdExcecoesPorCargo = {};

    for (const m of medicosComCargo) {
      const listaCargos = (m.cargos || '').split(',').filter(Boolean);
      const exc = excPorMedico.get(m.medico_id);
      for (const cargo of listaCargos) {
        // Se este médico tem exceção que sobrescreve esse cargo, NÃO conta no fixo
        if (exc && exc.cargo_base === cargo) {
          qtdExcecoesPorCargo[cargo] = (qtdExcecoesPorCargo[cargo] || 0) + 1;
          continue;
        }
        custosFixosPorCargo[cargo] = (custosFixosPorCargo[cargo] || 0) + valores[cargo];
        totalGeralFixos += valores[cargo];
      }
    }

    // ── HTML ───────────────────────────────────────────────────────────────

    // V492: CSS injetado 1x no <head> (antes: <style> re-parseado dentro do innerHTML a cada render)
    Utilidades.garantirEstilos('css-tela-desempenho-cargos', getStyles());
    document.getElementById('conteudo').innerHTML = `
      <div class="page-content">
        <header class="page-header">
          <div>
            <div class="fic-titulo-wrap">
              <h2>Cargos Administrativos</h2>
              <button class="fic-btn-info ${window.__cargos.infoAberto ? 'fic-btn-info-ativo' : ''}"
                      id="cargos-btn-info"
                      title="Ver regras do fichário Cargos Administrativos">ⓘ</button>
            </div>
            ${window.__cargos.infoAberto ? `
              <div class="fic-popover-info">
                <div class="fic-popover-info-head">
                  <strong>Regras Cargos Administrativos</strong>
                  <button class="fic-popover-info-close" id="cargos-info-close">✕</button>
                </div>
                <div class="fic-popover-info-body">
                  <p>
                    <strong>Estrutura</strong> · Repasse a médicos que ocupam cargos administrativos:
                    <code>DM</code> (Diretor Médico), <code>CM</code> (Coordenador Médico) e
                    <code>RT</code> (Responsável Técnico).
                  </p>
                  <p>
                    <strong>A — Valor fixo por TAG</strong> · O usuário define o valor mensal de cada cargo.
                    Médicos que possuem a TAG recebem automaticamente o valor configurado.
                  </p>
                  <p>
                    <strong>B — Exceções (regras especiais)</strong> · Casos em que um médico com a TAG
                    <strong>NÃO recebe</strong> o valor fixo — recebe outra regra (ex: % sobre produção).
                    Cobre por exemplo o caso "Coordenador de Lentes de Contato".
                  </p>
                  <p>
                    ⚠ <strong>Importante</strong> · Médico com exceção NÃO recebe o valor fixo da TAG
                    (recebe apenas o valor calculado pela exceção). Evita pagamento duplicado.
                  </p>
                </div>
              </div>
            ` : ''}
            <div class="subtitle">Configure valores fixos por TAG e exceções para casos especiais</div>
          </div>
        </header>

        ${renderFiltroPeriodo(competenciasLC)}

        ${renderSecaoA(valores, contagem, custosFixosPorCargo, qtdExcecoesPorCargo)}

        ${renderSecaoB(excecoes, { competenciaLC, producaoLCTotal })}

        ${renderTabelaMedicos(medicosComCargo, valores, excPorMedico, totalGeralFixos, { competenciaLC, producaoLCTotal })}
      </div>
    `;

    bindEventos(excecoes);
  }

  // ==========================================================================
  // FILTRO DE PERÍODO
  // ==========================================================================
  // Mesma estrutura visual do fichário LC para consistência.
  // Lista as competências disponíveis na produção LC e permite escolher
  // ano/mês para recalcular o repasse das exceções percentuais.

  function renderFiltroPeriodo(periodos) {
    if (!periodos || periodos.length === 0) return '';

    const anosMap = new Map();
    for (const p of periodos) {
      const [ano, mes] = p.split('-');
      if (!anosMap.has(ano)) anosMap.set(ano, []);
      anosMap.get(ano).push(mes);
    }
    const anos = Array.from(anosMap.keys()).sort().reverse();
    const anoAtual = window.__cargos.anoSelecionado;
    const mesesDoAno = anosMap.get(anoAtual) || [];
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    // V731: fileira 20C (peça branca, células com ícone) — individualidade do
    // módulo: o período é OBRIGATÓRIO (sem opção "Todos"); trocar o ano reseta
    // o mês pro primeiro disponível, como os selects antigos faziam.
    const svg = (d) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const icCal = '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>';
    const icClk = '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>';
    const chev = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
    const aberto = window.__cargos.sbAberto;
    const cel = (id, rotulo, valor, ic, itens) => `
      <div class="cargos-sb-celwrap">
        <button type="button" class="cargos-sb-cel ativo ${aberto === id ? 'aberta' : ''}" data-cargos-cel="${id}" aria-expanded="${aberto === id ? 'true' : 'false'}">
          <span class="cargos-sb-tile">${svg(ic)}</span>
          <span class="cargos-sb-tx"><span class="cargos-sb-rot">${rotulo}</span><span class="cargos-sb-val">${valor || '—'}</span></span>
          <span class="cargos-sb-chev">${chev}</span>
        </button>
        ${aberto === id ? `
          <div class="cargos-sb-painel" data-cargos-painel="${id}">
            <div class="cargos-sb-lista">${itens}</div>
          </div>` : ''}
      </div>`;
    const itensAno = anos.map(a => `<div class="cargos-sb-it ${a === anoAtual ? 'sel' : ''}" data-cargos-item data-val="${a}">${a}</div>`).join('');
    const itensMes = mesesDoAno.sort().map(m => `<div class="cargos-sb-it ${m === window.__cargos.mesSelecionado ? 'sel' : ''}" data-cargos-item data-val="${m}">${meses[Number(m) - 1]}</div>`).join('');
    return `
      <div class="cargos-filtros-bar cargos-sb" id="cargos-sb">
        ${cel('ano', 'Ano', anoAtual, icClk, itensAno)}
        ${cel('mes', 'Mês', window.__cargos.mesSelecionado ? meses[Number(window.__cargos.mesSelecionado) - 1] : '', icCal, itensMes)}
        <div class="cargos-filtros-help">
          Período de referência — usado para calcular o repasse percentual sobre a Produção LC do mês.
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // SEÇÃO A — Cards de valor por TAG
  // ==========================================================================

  function renderSecaoA(valores, contagem, custos, qtdExc) {
    const cargos = [
      { id: 'DIRETORIA_TECNICA',   label: 'Diretoria Técnica' },
      { id: 'DIRETORIA_CLINICA',   label: 'Diretoria Clínica' },
      { id: 'COORDENADOR_MEDICO',  label: 'Coordenador Médico' },
      { id: 'RESPONSAVEL_TECNICO', label: 'Responsável Técnico' },
    ];

    return `
      <div class="cargo-secao-titulo">A · Valor fixo por TAG</div>
      <div class="cargo-cards">
        ${cargos.map(c => renderCard(c, valores, contagem, custos, qtdExc)).join('')}
      </div>
    `;
  }

  function renderCard(cargo, valores, contagem, custos, qtdExc) {
    const cat = Utilidades.CARGOS_ADMIN[cargo.id];
    const valor = valores[cargo.id] || 0;
    const qtd = contagem[cargo.id] || 0;
    const qtdComExc = qtdExc[cargo.id] || 0;
    const qtdSemExc = qtd - qtdComExc;
    const custoTotal = custos[cargo.id] || 0;
    const semValor = valor === 0;

    return `
      <div class="cargo-card ${semValor ? 'sem-valor' : ''}">
        <div class="cargo-card-faixa" style="background: ${cat.bgGradient}"></div>

        <div class="cargo-card-topo">
          <span class="badge-cargo" title="${cat.label}"
            style="background:${cat.bgGradient};color:${cat.fg};border-color:${cat.bd};box-shadow:0 1px 2px ${cat.shadow};font-size:11px;padding:0 6px;border-radius:3px">
            ${cat.sigla}
          </span>
          <span class="cargo-medicos-tag">
            ${qtd === 0 ? 'Sem médicos' : `${qtd} médico${qtd !== 1 ? 's' : ''}`}
            ${qtdComExc > 0 ? `<span class="exc-marker">(${qtdComExc} c/ exceção)</span>` : ''}
          </span>
        </div>

        <div class="cargo-card-nome">${cargo.label}</div>

        <div class="cargo-card-label">Valor mensal</div>
        <div class="cargo-card-valor-wrap">
          <span class="cargo-card-rs">R$</span>
          <span class="cargo-card-valor mono" data-cargo="${cargo.id}" data-valor="${valor}" title="Clique para editar">
            ${Utilidades.formatarNumero(valor, 2)}
          </span>
        </div>

        ${qtd > 0 ? `
          <div class="cargo-card-rodape">
            Total: <strong>R$ ${Utilidades.formatarNumero(custoTotal, 2)}</strong> / mês
            ${qtdSemExc !== qtd ? `<span class="exc-marker">(${qtdSemExc} fixo${qtdSemExc !== 1 ? 's' : ''})</span>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  // ==========================================================================
  // SEÇÃO B — Exceções
  // ==========================================================================

  function renderSecaoB(excecoes, ctxLC) {
    return `
      <div class="cargo-secao-header">
        <div class="cargo-secao-titulo">B · Exceções (regras especiais)</div>
        <button class="btn" id="btn-nova-excecao">+ Nova exceção</button>
      </div>

      ${excecoes.length === 0 ? `
        <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 22px">
          <div style="color: var(--ink-faint); font-size: 13px">
            Nenhuma exceção cadastrada.
            <br>
            <span style="font-size: 11px">
              Use exceções quando um médico com a TAG não recebe o valor fixo
              (ex: Coordenador de Lentes que recebe % sobre produção).
            </span>
          </div>
        </div>
      ` : `
        <div class="excecoes-lista">
          ${excecoes.map(e => renderCardExcecao(e, ctxLC)).join('')}
        </div>
      `}
    `;
  }

  function renderCardExcecao(exc, ctxLC) {
    const cat = Utilidades.CARGOS_ADMIN[exc.cargo_base];

    return `
      <div class="excecao-card">
        <div class="excecao-card-header">
          <div>
            <div class="excecao-card-titulo">
              <span class="badge-cargo" style="background:${cat.bgGradient};color:${cat.fg};border-color:${cat.bd};font-size:10px;padding:0 6px;border-radius:3px">
                ${cat.sigla}<sup class="exc-sup">*</sup>
              </span>
              <span class="excecao-card-nome">${escapeHTML(exc.nome)}</span>
            </div>
            <div class="excecao-card-sub">
              Ao invés do valor fixo de ${cat.sigla}, recebe ${formatarTipoCalculo(exc)}
            </div>
          </div>
          <div class="excecao-card-acoes">
            <button class="btn btn-pequeno btn-editar-exc" data-id="${exc.id}">Editar</button>
            <button class="btn btn-pequeno btn-perigo btn-excluir-exc" data-id="${exc.id}">×</button>
          </div>
        </div>

        <div class="excecao-card-corpo">
          <div class="excecao-info">
            <div class="excecao-info-label">Médico responsável</div>
            <div class="excecao-info-valor">${escapeHTML(CodigoMedico.exibir(exc.nome_medico))}</div>
          </div>
          ${exc.tipo_calculo === 'VALOR_FIXO' ? `
            <div class="excecao-info">
              <div class="excecao-info-label">Valor mensal</div>
              <div class="excecao-info-valor mono">R$ ${Utilidades.formatarNumero(exc.valor_fixo, 2)}</div>
            </div>
            <div class="excecao-info">
              <div class="excecao-info-label">Tipo de cálculo</div>
              <div class="excecao-info-valor" style="color: var(--ink-soft); font-style: italic">Valor fixo mensal</div>
            </div>
          ` : renderCalculoPercentualLC(exc, ctxLC)}
        </div>
      </div>
    `;
  }

  /**
   * Renderiza o cálculo da exceção de tipo PERCENTUAL para LC:
   *
   *   ┌────────────────────────────────────────┐
   *   │ PERCENTUAL          │ PRODUÇÃO LC      │
   *   │ 8,00 %              │ R$ 138.929,00    │
   *   └─────────────────────┴──────────────────┘
   *   ┌────────────────────────────────────────┐
   *   │ REPASSE DO MÊS · Abr/2026              │
   *   │ R$ 11.114,32                           │
   *   │ 8% × R$ 138.929,00                     │
   *   └────────────────────────────────────────┘
   *
   * A "Produção LC" é o total mensal de todos os médicos (ver
   * `calcularProducaoLCTotal`), seguindo a regra de só somar linhas com
   * executante Interno/Híbrido.
   */
  function renderCalculoPercentualLC(exc, ctxLC) {
    const competencia = ctxLC?.competenciaLC;
    const producao = Number(ctxLC?.producaoLCTotal) || 0;
    const pct = Number(exc.percentual) || 0;
    const repasse = producao * pct / 100;
    const labelMes = competencia ? formatarCompetencia(competencia) : '—';

    if (!competencia) {
      return `
        <div class="excecao-info">
          <div class="excecao-info-label">Percentual</div>
          <div class="excecao-info-valor mono">${Utilidades.formatarNumero(pct, 2)} %</div>
        </div>
        <div class="excecao-info excecao-info-aviso">
          <div class="excecao-info-label">Repasse calculado</div>
          <div class="excecao-info-valor" style="color: var(--ink-faint); font-size: 11px; font-style: italic">
            Sem produção LC importada para o período.
          </div>
        </div>
      `;
    }

    return `
      <div class="excecao-info">
        <div class="excecao-info-label">Percentual</div>
        <div class="excecao-info-valor mono">${Utilidades.formatarNumero(pct, 2)} %</div>
      </div>
      <div class="excecao-info excecao-calculo">
        <div class="excecao-info-label">Repasse do mês · ${labelMes}</div>
        <div class="excecao-info-valor mono excecao-calculo-valor">
          R$ ${Utilidades.formatarNumero(repasse, 2)}
        </div>
        <div class="excecao-calculo-formula mono">
          ${Utilidades.formatarNumero(pct, 2)}% × R$ ${Utilidades.formatarNumero(producao, 2)}
        </div>
      </div>
    `;
  }

  function formatarCompetencia(comp) {
    if (!comp) return '—';
    const [ano, mes] = String(comp).split('-');
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return `${meses[Number(mes) - 1] || mes}/${ano}`;
  }

  function formatarTipoCalculo(exc) {
    if (exc.tipo_calculo === 'VALOR_FIXO') {
      return `<strong>R$ ${Utilidades.formatarNumero(exc.valor_fixo, 2)}</strong> mensal (substitui o valor padrão da TAG)`;
    }
    return `<strong>${Utilidades.formatarNumero(exc.percentual, 2)}%</strong> sobre produção dos procedimentos elegíveis`;
  }

  // ==========================================================================
  // TABELA DE MÉDICOS
  // ==========================================================================

  function renderTabelaMedicos(medicos, valores, excPorMedico, totalFixos, ctxLC) {
    if (medicos.length === 0) {
      return `
        <div class="cargo-secao-titulo">Médicos com cargo administrativo</div>
        <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 22px">
          <div style="color: var(--ink-faint); font-size: 13px">
            Nenhum médico com cargo administrativo cadastrado ainda.
            <br>
            <span style="font-size: 11px">Vá em <strong>Médicos</strong> e marque DM/CM/RT nos cadastros.</span>
          </div>
        </div>
      `;
    }

    const producaoLC = Number(ctxLC?.producaoLCTotal) || 0;
    const competencia = ctxLC?.competenciaLC;

    // Calcula valor de cada médico (somando fixos + exceção quando aplicável)
    let totalCalculado = 0;  // soma das exceções percentuais já calculadas
    const linhas = medicos.map(m => {
      const listaCargos = (m.cargos || '').split(',').filter(Boolean);
      const exc = excPorMedico.get(m.medico_id);

      let valorFixo = 0;
      const cargosFixos = [];
      let cargoExcecao = null;
      for (const cargo of listaCargos) {
        if (exc && exc.cargo_base === cargo) {
          cargoExcecao = cargo;
        } else {
          valorFixo += valores[cargo];
          cargosFixos.push(cargo);
        }
      }

      // Calcula valor da exceção, se houver
      let valorExc = null;        // R$ a pagar pela exceção (se calculável agora)
      let valorExcInfo = null;    // texto explicativo (ex: "5% × R$ X")
      if (exc) {
        if (exc.tipo_calculo === 'VALOR_FIXO') {
          valorExc = Number(exc.valor_fixo) || 0;
        } else {
          // PERCENTUAL_PROCEDIMENTOS — só calcula se há produção LC do período
          if (competencia && producaoLC > 0) {
            const pct = Number(exc.percentual) || 0;
            valorExc = producaoLC * pct / 100;
            valorExcInfo = `${Utilidades.formatarNumero(pct, 2)}% × R$ ${Utilidades.formatarNumero(producaoLC, 2)}`;
          }
        }
        if (valorExc !== null) totalCalculado += valorExc;
      }

      return {
        ...m,
        listaCargos,
        valorFixo,
        cargosFixos,
        cargoExcecao,
        exc,
        valorExc,
        valorExcInfo,
      };
    });

    const totalGeral = totalFixos + totalCalculado;

    return `
      <div class="cargo-secao-titulo">Médicos com cargo administrativo (${medicos.length})</div>
      <div class="card" style="padding: 0; overflow: hidden">
        <table class="data-table">
          <thead>
            <tr>
              <th>MÉDICO</th>
              <th>CARGOS</th>
              <th>REGRA</th>
              <th class="num">VALOR MENSAL</th>
            </tr>
          </thead>
          <tbody>
            ${linhas.map(l => `
              <tr ${l.exc ? 'class="linha-excecao"' : ''}>
                <td style="font-weight: 600">${escapeHTML(CodigoMedico.exibir(l.nome_medico))}</td>
                <td>
                  ${l.listaCargos.map(c => {
                    const cat = Utilidades.CARGOS_ADMIN[c];
                    const ehExc = l.exc && l.exc.cargo_base === c;
                    return `<span class="badge-cargo" title="${cat.label}${ehExc ? ' · Exceção: ' + l.exc.nome : ''}"
                      style="background:${cat.bgGradient};color:${cat.fg};border-color:${cat.bd};margin-right:3px">
                      ${cat.sigla}${ehExc ? '<sup class="exc-sup">*</sup>' : ''}
                    </span>`;
                  }).join('')}
                </td>
                <td>
                  ${l.exc
                    ? `<span class="regra-excecao">${escapeHTML(l.exc.nome)} ${l.exc.tipo_calculo === 'VALOR_FIXO'
                          ? '(fixo)'
                          : '(' + Utilidades.formatarNumero(l.exc.percentual, 2) + '%)'
                       }</span>`
                    : '<span class="regra-fixa">Valor fixo</span>'
                  }
                </td>
                <td class="num mono ${(l.exc && l.exc.tipo_calculo !== 'VALOR_FIXO' && l.valorExc === null) ? '' : 'atlas-rep'}"><!-- V965: valor mensal em #2a5a8c (aviso "Sem produção LC" fica cinza) -->
                  ${renderValorMensal(l)}
                </td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.06em">
                Total / mês ${competencia ? `· ${formatarCompetencia(competencia)}` : ''}
              </td>
              <td class="num mono" style="font-size: 14px; font-weight: 700; color: var(--primary)">
                R$ ${Utilidades.formatarNumero(totalGeral, 2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  /**
   * Renderiza a célula "Valor Mensal" da tabela de médicos.
   * - Sem exceção: valor fixo (soma das TAGs).
   * - Exceção VALOR_FIXO: o valor configurado.
   * - Exceção PERCENTUAL: o valor calculado (% × Produção LC) com pequena
   *   linha auxiliar mostrando a fórmula. Se a produção LC for zero, mostra
   *   "Sem produção LC no período" em cinza.
   */
  function renderValorMensal(l) {
    if (!l.exc) {
      return `<strong>R$ ${Utilidades.formatarNumero(l.valorFixo, 2)}</strong>`;
    }
    if (l.exc.tipo_calculo === 'VALOR_FIXO') {
      return `<strong>R$ ${Utilidades.formatarNumero(l.exc.valor_fixo, 2)}</strong>`;
    }
    // PERCENTUAL
    if (l.valorExc === null) {
      return `<span class="valor-calculado">Sem produção LC no período</span>`;
    }
    return `
      <div>
        <strong>R$ ${Utilidades.formatarNumero(l.valorExc, 2)}</strong>
        ${l.valorExcInfo ? `<div class="valor-exc-formula">${l.valorExcInfo}</div>` : ''}
      </div>
    `;
  }

  // ==========================================================================
  // EVENTOS
  // ==========================================================================

  function bindEventos(excecoes) {

    // ⓘ Botão Info (V128.4)
    const btnCargosInfo = document.getElementById('cargos-btn-info');
    if (btnCargosInfo) btnCargosInfo.addEventListener('click', () => {
      window.__cargos.infoAberto = !window.__cargos.infoAberto;
      renderizar();
    });
    const btnCargosInfoClose = document.getElementById('cargos-info-close');
    if (btnCargosInfoClose) btnCargosInfoClose.addEventListener('click', () => {
      window.__cargos.infoAberto = false;
      renderizar();
    });

    // V731: fileira 20C — painel abre/fecha LOCAL; escolher aplica e re-renderiza
    const sbCargos = document.getElementById('cargos-sb');
    if (sbCargos) {
      sbCargos.addEventListener('click', (e) => {
        const it = e.target.closest('[data-cargos-item]');
        if (it) {
          e.stopPropagation();
          const painel = it.closest('[data-cargos-painel]').dataset.cargosPainel;
          if (painel === 'ano') {
            window.__cargos.anoSelecionado = it.dataset.val;
            // trocar o ano reseta o mês pro primeiro disponível (regra antiga)
            const mesesNovo = listarCompetenciasLC()
              .filter(c => c.startsWith(it.dataset.val + '-'))
              .map(c => c.split('-')[1]).sort();
            window.__cargos.mesSelecionado = mesesNovo[0] || null;
          } else {
            window.__cargos.mesSelecionado = it.dataset.val;
          }
          window.__cargos.sbAberto = null;
          renderizar();
          return;
        }
        const celBtn = e.target.closest('[data-cargos-cel]');
        if (celBtn) {
          e.stopPropagation();
          const id = celBtn.dataset.cargosCel;
          // toggle LOCAL: remove/insere só o painel, SEM re-render
          const jaAberto = window.__cargos.sbAberto === id;
          sbCargos.querySelectorAll('.cargos-sb-painel').forEach(p => p.remove());
          sbCargos.querySelectorAll('.cargos-sb-cel.aberta').forEach(c => c.classList.remove('aberta'));
          window.__cargos.sbAberto = null;
          if (!jaAberto) {
            window.__cargos.sbAberto = id;
            celBtn.classList.add('aberta');
            const comps = listarCompetenciasLC();
            const nomesMes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
            let itens = '';
            if (id === 'ano') {
              const anos = Array.from(new Set(comps.map(c => c.split('-')[0]))).sort().reverse();
              itens = anos.map(a => `<div class="cargos-sb-it ${a === window.__cargos.anoSelecionado ? 'sel' : ''}" data-cargos-item data-val="${a}">${a}</div>`).join('');
            } else {
              const mesesAno = comps.filter(c => c.startsWith(window.__cargos.anoSelecionado + '-')).map(c => c.split('-')[1]).sort();
              itens = mesesAno.map(m => `<div class="cargos-sb-it ${m === window.__cargos.mesSelecionado ? 'sel' : ''}" data-cargos-item data-val="${m}">${nomesMes[Number(m) - 1]}</div>`).join('');
            }
            celBtn.parentElement.insertAdjacentHTML('beforeend',
              `<div class="cargos-sb-painel" data-cargos-painel="${id}"><div class="cargos-sb-lista">${itens}</div></div>`);
          }
          return;
        }
        e.stopPropagation();
      });
      if (window.__cargosSbFechar) document.removeEventListener('click', window.__cargosSbFechar);
      const fecharFora = (ev) => {
        if (App.telaAtual !== 'desempenho-cargos') return;
        if (window.__cargos.sbAberto && !ev.target.closest('#cargos-sb')) {
          window.__cargos.sbAberto = null;
          document.querySelectorAll('#cargos-sb .cargos-sb-painel').forEach(p => p.remove());
          document.querySelectorAll('#cargos-sb .cargos-sb-cel.aberta').forEach(c => c.classList.remove('aberta'));
        }
      };
      window.__cargosSbFechar = fecharFora;
      document.addEventListener('click', fecharFora);
    }

    // Edição inline do valor da TAG (clica → input → blur/Enter salva)
    document.querySelectorAll('.cargo-card-valor').forEach(span => {
      span.addEventListener('click', () => abrirEdicaoValor(span));
    });

    document.getElementById('btn-nova-excecao').addEventListener('click', () => {
      abrirModalExcecao(null);
    });

    document.querySelectorAll('.btn-editar-exc').forEach(btn => {
      btn.addEventListener('click', () => {
        const exc = excecoes.find(e => e.id === Number(btn.dataset.id));
        abrirModalExcecao(exc);
      });
    });

    document.querySelectorAll('.btn-excluir-exc').forEach(btn => {
      btn.addEventListener('click', () => excluirExcecao(Number(btn.dataset.id)));
    });

    document.querySelectorAll('[data-procs-exc]').forEach(el => {
      el.addEventListener('click', () => {
        abrirModalProcedimentos(Number(el.dataset.procsExc));
      });
    });
  }

  // ==========================================================================
  // EDIÇÃO INLINE DE VALOR DA TAG
  // ==========================================================================

  function abrirEdicaoValor(span) {
    const cargo = span.dataset.cargo;
    const valorAtual = Number(span.dataset.valor) || 0;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cargo-card-valor-input mono';
    input.value = valorAtual ? Utilidades.formatarNumero(valorAtual, 2) : '';
    input.placeholder = '0,00';

    span.replaceWith(input);
    input.focus();
    input.select();

    let salvo = false;
    const salvar = async () => {
      if (salvo) return;
      salvo = true;

      const novoValor = parseValor(input.value);
      if (novoValor !== valorAtual) {
        Banco.executar(
          `UPDATE valores_cargos
              SET valor_mensal = ?, atualizado_em = CURRENT_TIMESTAMP
            WHERE cargo = ?`,
          [novoValor, cargo]
        );
        await Banco.salvar();
        Utilidades.toast('Valor atualizado', 'success', 1500);
      }
      renderizar();
    };

    input.addEventListener('blur', salvar);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') {
        salvo = true; // Cancela sem salvar
        renderizar();
      }
    });
  }

  function parseValor(texto) {
    if (!texto) return 0;
    // Aceita "1.234,56" ou "1234.56" ou "1234,56"
    // V491: só trata ponto como milhar quando HÁ vírgula (antes "1234.56" virava 123456).
    let s = String(texto).trim();
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const limpo = s.replace(/[^\d.-]/g, '');
    const n = parseFloat(limpo);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  // ==========================================================================
  // MODAL DE EXCEÇÃO (criar/editar)
  // ==========================================================================

  function abrirModalExcecao(exc) {
    const editando = !!exc;
    const tipoInicial = exc?.tipo_calculo || 'PERCENTUAL_PROCEDIMENTOS';

    // Médicos disponíveis (que têm DT/DC/CM/RT marcado — Sócio não conta)
    const medicos = Banco.query(`
      SELECT DISTINCT m.id, m.nome_oficial, GROUP_CONCAT(mc.cargo, ',') AS cargos
      FROM medicos m
      JOIN medico_cargos mc ON mc.medico_id = m.id
      WHERE m.ativo = 1 AND mc.cargo != 'SOCIO'
      GROUP BY m.id
      ORDER BY m.nome_oficial
    `);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width: 520px">
        <div class="modal-header">
          <h3>${editando ? 'Editar exceção' : 'Nova exceção'}</h3>
          <button class="modal-close" id="modal-fechar">×</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Nome da exceção</label>
            <input type="text" class="input" id="exc-nome"
                   placeholder="Ex: Coordenador de Lentes de Contato"
                   value="${exc ? escapeHTML(exc.nome) : ''}">
          </div>

          <div class="field">
            <label>TAG que esta exceção sobrescreve</label>
            <select class="select" id="exc-cargo-base">
              <option value="DIRETORIA_TECNICA"   ${exc?.cargo_base === 'DIRETORIA_TECNICA' ? 'selected' : ''}>Diretoria Técnica (DT)</option>
              <option value="DIRETORIA_CLINICA"   ${exc?.cargo_base === 'DIRETORIA_CLINICA' ? 'selected' : ''}>Diretoria Clínica (DC)</option>
              <option value="COORDENADOR_MEDICO"  ${!exc || exc.cargo_base === 'COORDENADOR_MEDICO' ? 'selected' : ''}>Coordenador Médico (CM)</option>
              <option value="RESPONSAVEL_TECNICO" ${exc?.cargo_base === 'RESPONSAVEL_TECNICO' ? 'selected' : ''}>Responsável Técnico (RT)</option>
            </select>
            <div class="small muted" style="margin-top: 4px">
              Quem ocupar esta exceção <strong>NÃO recebe</strong> o valor fixo desta TAG.
            </div>
          </div>

          <div class="field">
            <label>Médico responsável</label>
            <select class="select" id="exc-medico">
              <option value="">— Selecione um médico —</option>
              ${medicos.map(m => `
                <option value="${m.id}" ${exc?.medico_id === m.id ? 'selected' : ''}>
                  ${escapeHTML(CodigoMedico.exibir(m.nome_oficial))} (${(m.cargos || '')
                    .replace(/DIRETORIA_TECNICA/g, 'DT')
                    .replace(/DIRETORIA_CLINICA/g, 'DC')
                    .replace(/COORDENADOR_MEDICO/g, 'CM')
                    .replace(/RESPONSAVEL_TECNICO/g, 'RT')})
                </option>
              `).join('')}
            </select>
            <div class="small muted" style="margin-top: 4px">
              Só aparecem médicos que já têm alguma TAG. Marque DM/CM/RT no cadastro do médico primeiro.
            </div>
          </div>

          <div class="field">
            <label>Tipo de cálculo</label>
            <select class="select" id="exc-tipo">
              <option value="PERCENTUAL_PROCEDIMENTOS" ${tipoInicial === 'PERCENTUAL_PROCEDIMENTOS' ? 'selected' : ''}>Percentual sobre produção</option>
              <option value="VALOR_FIXO"               ${tipoInicial === 'VALOR_FIXO' ? 'selected' : ''}>Valor fixo mensal</option>
            </select>
          </div>

          <!-- Campo Percentual (aparece se tipo = PERCENTUAL_PROCEDIMENTOS) -->
          <div class="field" id="campo-percentual" style="display: ${tipoInicial === 'PERCENTUAL_PROCEDIMENTOS' ? 'block' : 'none'}">
            <label>Percentual (%)</label>
            <input type="text" class="input mono" id="exc-percentual"
                   placeholder="Ex: 10,00"
                   value="${exc && exc.tipo_calculo !== 'VALOR_FIXO' ? Utilidades.formatarNumero(exc.percentual, 2) : ''}">
            <div class="small muted" style="margin-top: 4px">
              Percentual sobre a produção dos procedimentos elegíveis (configurados depois).
            </div>
          </div>

          <!-- Campo Valor Fixo (aparece se tipo = VALOR_FIXO) -->
          <div class="field" id="campo-valor-fixo" style="display: ${tipoInicial === 'VALOR_FIXO' ? 'block' : 'none'}">
            <label>Valor mensal (R$)</label>
            <input type="text" class="input mono" id="exc-valor-fixo"
                   placeholder="Ex: 20.000,00"
                   value="${exc && exc.tipo_calculo === 'VALOR_FIXO' ? Utilidades.formatarNumero(exc.valor_fixo, 2) : ''}">
            <div class="small muted" style="margin-top: 4px">
              Valor fixo mensal que substitui o valor padrão da TAG.
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" id="exc-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="exc-salvar">${editando ? 'Salvar' : 'Criar exceção'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Alternância dos campos conforme tipo selecionado
    const selTipo = document.getElementById('exc-tipo');
    const campoPerc = document.getElementById('campo-percentual');
    const campoFixo = document.getElementById('campo-valor-fixo');
    selTipo.addEventListener('change', () => {
      const eFixo = selTipo.value === 'VALOR_FIXO';
      campoPerc.style.display = eFixo ? 'none' : 'block';
      campoFixo.style.display = eFixo ? 'block' : 'none';
    });

    const fechar = () => modal.remove();
    document.getElementById('modal-fechar').addEventListener('click', fechar);
    document.getElementById('exc-cancelar').addEventListener('click', fechar);

    document.getElementById('exc-salvar').addEventListener('click', async () => {
      const nome = document.getElementById('exc-nome').value.trim();
      const cargoBase = document.getElementById('exc-cargo-base').value;
      const medicoId = Number(document.getElementById('exc-medico').value);
      const tipoCalculo = selTipo.value;
      const percentual = parseValor(document.getElementById('exc-percentual').value);
      const valorFixo = parseValor(document.getElementById('exc-valor-fixo').value);

      if (!nome) { alert('Informe o nome da exceção'); return; }
      if (!medicoId) { alert('Selecione o médico responsável'); return; }

      if (tipoCalculo === 'PERCENTUAL_PROCEDIMENTOS') {
        if (percentual <= 0) { alert('Informe um percentual válido'); return; }
      } else if (tipoCalculo === 'VALOR_FIXO') {
        if (valorFixo <= 0) { alert('Informe um valor mensal válido'); return; }
      }

      // Valida que o médico tem a TAG correspondente
      const temTag = Banco.queryUnica(
        'SELECT 1 FROM medico_cargos WHERE medico_id = ? AND cargo = ?',
        [medicoId, cargoBase]
      );
      if (!temTag) {
        alert('Este médico não tem a TAG selecionada. Vá em Médicos e marque a TAG antes.');
        return;
      }

      // Valida que não existe outra exceção com o mesmo cargo_base + medico
      const sqlChk = editando
        ? 'SELECT id FROM excecoes_cargo WHERE medico_id = ? AND cargo_base = ? AND id != ?'
        : 'SELECT id FROM excecoes_cargo WHERE medico_id = ? AND cargo_base = ?';
      const params = editando ? [medicoId, cargoBase, exc.id] : [medicoId, cargoBase];
      if (Banco.queryUnica(sqlChk, params)) {
        alert('Já existe uma exceção para este médico nesta TAG.');
        return;
      }

      if (editando) {
        Banco.executar(
          `UPDATE excecoes_cargo
              SET nome = ?, cargo_base = ?, medico_id = ?,
                  tipo_calculo = ?, percentual = ?, valor_fixo = ?,
                  atualizado_em = CURRENT_TIMESTAMP
            WHERE id = ?`,
          [nome, cargoBase, medicoId, tipoCalculo, percentual, valorFixo, exc.id]
        );
      } else {
        Banco.executar(
          `INSERT INTO excecoes_cargo (nome, cargo_base, medico_id, tipo_calculo, percentual, valor_fixo)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [nome, cargoBase, medicoId, tipoCalculo, percentual, valorFixo]
        );
      }
      await Banco.salvar();
      fechar();
      Utilidades.toast(editando ? 'Exceção atualizada' : 'Exceção criada', 'success');
      renderizar();
    });
  }

  async function excluirExcecao(id) {
    const exc = Banco.queryUnica('SELECT nome FROM excecoes_cargo WHERE id = ?', [id]);
    if (!exc) return;
    if (!confirm(`Excluir a exceção "${exc.nome}"?\n\nO médico voltará a receber o valor fixo da TAG.`)) return;

    Banco.executar('DELETE FROM excecoes_cargo WHERE id = ?', [id]);
    await Banco.salvar();
    Utilidades.toast('Exceção excluída', 'success');
    renderizar();
  }

  // ==========================================================================
  // MODAL DE PROCEDIMENTOS ELEGÍVEIS
  // ==========================================================================

  function abrirModalProcedimentos(excecaoId) {
    const exc = Banco.queryUnica(
      `SELECT e.*, m.nome_oficial AS nome_medico
       FROM excecoes_cargo e
       JOIN medicos m ON m.id = e.medico_id
       WHERE e.id = ?`,
      [excecaoId]
    );
    if (!exc) return;

    // Procedimentos atuais
    const atuais = new Set(
      Banco.query(
        'SELECT procedimento_id FROM excecao_procedimentos WHERE excecao_id = ?',
        [excecaoId]
      ).map(r => r.procedimento_id)
    );

    // Todos os procedimentos cadastrados
    const todos = Banco.query(`
      SELECT id, nome FROM procedimentos
      WHERE ativo = 1
      ORDER BY nome
    `);

    if (todos.length === 0) {
      alert(
        'Nenhum procedimento cadastrado ainda.\n\n' +
        'Vá em Base Tabela e importe a planilha de procedimentos primeiro.'
      );
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width: 700px; max-height: 90vh; display: flex; flex-direction: column">
        <div class="modal-header">
          <div>
            <h3>Procedimentos elegíveis</h3>
            <div class="small muted">${escapeHTML(exc.nome)} · ${escapeHTML(CodigoMedico.exibir(exc.nome_medico))}</div>
          </div>
          <button class="modal-close" id="modal-fechar">×</button>
        </div>
        <div class="modal-body" style="flex: 1; overflow-y: auto">
          <div class="field" style="margin-bottom: 14px; display: flex; gap: 8px; align-items: center">
            <input type="text" class="input" id="proc-busca" placeholder="🔍 Buscar procedimento..." style="flex: 1">
            <button class="btn btn-pequeno" id="proc-marcar-todos">Marcar todos</button>
            <button class="btn btn-pequeno" id="proc-desmarcar-todos">Desmarcar</button>
          </div>
          <div id="proc-contador" class="small muted" style="margin-bottom: 8px">
            ${atuais.size} de ${todos.length} marcados
          </div>
          <div id="proc-lista" style="max-height: 50vh; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; padding: 8px">
            ${todos.map(p => `
              <label class="proc-item" data-nome="${escapeHTML(p.nome.toLowerCase())}">
                <input type="checkbox" data-proc-id="${p.id}" ${atuais.has(p.id) ? 'checked' : ''}>
                <span>${escapeHTML(p.nome)}</span>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" id="proc-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="proc-salvar">Salvar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const lista = document.getElementById('proc-lista');
    const contador = document.getElementById('proc-contador');

    const atualizarContador = () => {
      const marcados = lista.querySelectorAll('input:checked').length;
      contador.textContent = `${marcados} de ${todos.length} marcados`;
    };

    lista.addEventListener('change', atualizarContador);

    document.getElementById('proc-busca').addEventListener('input', (e) => {
      const termo = e.target.value.toLowerCase();
      lista.querySelectorAll('.proc-item').forEach(item => {
        item.style.display = item.dataset.nome.includes(termo) ? '' : 'none';
      });
    });

    document.getElementById('proc-marcar-todos').addEventListener('click', () => {
      lista.querySelectorAll('.proc-item').forEach(item => {
        if (item.style.display !== 'none') {
          item.querySelector('input').checked = true;
        }
      });
      atualizarContador();
    });

    document.getElementById('proc-desmarcar-todos').addEventListener('click', () => {
      lista.querySelectorAll('.proc-item').forEach(item => {
        if (item.style.display !== 'none') {
          item.querySelector('input').checked = false;
        }
      });
      atualizarContador();
    });

    const fechar = () => modal.remove();
    document.getElementById('modal-fechar').addEventListener('click', fechar);
    document.getElementById('proc-cancelar').addEventListener('click', fechar);

    document.getElementById('proc-salvar').addEventListener('click', async () => {
      const novosIds = new Set(
        Array.from(lista.querySelectorAll('input:checked')).map(cb => Number(cb.dataset.procId))
      );

      // Remove os que saíram
      for (const id of atuais) {
        if (!novosIds.has(id)) {
          Banco.executar(
            'DELETE FROM excecao_procedimentos WHERE excecao_id = ? AND procedimento_id = ?',
            [excecaoId, id]
          );
        }
      }
      // Adiciona os novos
      for (const id of novosIds) {
        if (!atuais.has(id)) {
          Banco.executar(
            'INSERT OR IGNORE INTO excecao_procedimentos (excecao_id, procedimento_id) VALUES (?, ?)',
            [excecaoId, id]
          );
        }
      }
      await Banco.salvar();
      fechar();
      Utilidades.toast(`${novosIds.size} procedimento${novosIds.size !== 1 ? 's' : ''} salvos`, 'success');
      renderizar();
    });
  }

  // ==========================================================================
  // ESTILOS DA TELA
  // ==========================================================================

  // ==========================================================================
  // PRODUÇÃO LC — helpers para o cálculo de exceções tipo PERCENTUAL
  // ==========================================================================

  /**
   * Retorna a lista de competências distintas presentes na produção LC,
   * em ordem decrescente (mais recente primeiro). Usada para popular o
   * filtro de Período e para resolver fallbacks.
   */
  function listarCompetenciasLC() {
    try {
      return Banco.query(`
        SELECT DISTINCT competencia
        FROM linhas_producao
        WHERE categoria = 'Lentes de Contato'
        ORDER BY competencia DESC
      `).map(r => r.competencia);
    } catch (e) {
      return [];
    }
  }

  /**
   * Produção TOTAL de Lentes de Contato no mês (regra #8 do fichário LC):
   * soma o valor das linhas LC onde o executante (Médico ou Cirurgião) tem
   * vínculo Interno ou Híbrido. Considera sinônimos via tabela de De-Para.
   *
   * Esta função é a fonte da verdade para "% × Produção" do Coordenador LC.
   * Bate com o KPI "Receita" da tela de Lentes de Contato.
   */
  function calcularProducaoLCTotal(competencia) {
    if (!competencia) return 0;
    try {
      // Set de nomes IH (oficiais + normalizados + sinônimos)
      const inIH = new Set();
      Banco.query(`
        SELECT nome_oficial, nome_normalizado FROM medicos
        WHERE ativo = 1 AND tipo_vinculo IN ('INTERNO', 'HIBRIDO')
      `).forEach(m => {
        inIH.add((m.nome_oficial || '').toUpperCase().trim());
        inIH.add(m.nome_normalizado || '');
      });
      try {
        Banco.query(`
          SELECT s.grafia, s.grafia_normalizada FROM sinonimos_medico s
          JOIN medicos m ON m.id = s.medico_id
          WHERE m.ativo = 1 AND m.tipo_vinculo IN ('INTERNO', 'HIBRIDO')
        `).forEach(sin => {
          inIH.add((sin.grafia || '').toUpperCase().trim());
          inIH.add(sin.grafia_normalizada || '');
        });
      } catch (e) { /* tabela pode não existir em bancos antigos */ }

      const linhas = Banco.query(`
        SELECT valor,
               UPPER(TRIM(COALESCE(medico, '')))    AS m,
               UPPER(TRIM(COALESCE(cirurgiao, '')))AS c
        FROM linhas_producao
        WHERE categoria = 'Lentes de Contato'
          AND competencia = ?
      `, [competencia]);

      let total = 0;
      for (const l of linhas) {
        const v = Number(l.valor) || 0;
        if (v <= 0) continue;
        const exec = l.m || l.c;
        if (inIH.has(exec)) total += v;
      }
      return total;
    } catch (e) {
      console.warn('Erro ao calcular Produção LC:', e);
      return 0;
    }
  }

  // V492: retorna apenas o CSS (sem tag <style>) — injetado 1x via Utilidades.garantirEstilos
  function getStyles() {
    return `
        .cargo-secao-titulo {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--ink-soft);
          margin: 24px 0 10px;
        }
        .cargo-secao-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 24px 0 10px;
        }
        .cargo-secao-header .cargo-secao-titulo {
          margin: 0;
        }

        .cargo-cards {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }
        @media (max-width: 1100px) {
          .cargo-cards { grid-template-columns: repeat(2, 1fr); }
        }

        .cargo-card {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px;
          position: relative;
          overflow: hidden;
          transition: opacity 200ms;
        }
        .cargo-card.sem-valor {
          opacity: 0.65;
        }
        .cargo-card-faixa {
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 4px;
        }
        .cargo-card-topo {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        .cargo-medicos-tag {
          font-size: 10px;
          color: var(--ink-soft);
          background: var(--bg-sunken);
          padding: 2px 8px;
          border-radius: 100px;
          font-weight: 600;
        }
        .exc-marker {
          font-size: 9px;
          color: var(--accent);
          margin-left: 3px;
          font-weight: 600;
        }
        .cargo-card-nome {
          font-family: var(--font-display);
          font-size: 15px;
          font-weight: 500;
          color: var(--ink);
          margin-bottom: 4px;
        }
        .cargo-card-label {
          font-size: 10px;
          color: var(--ink-soft);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin: 14px 0 6px;
          font-weight: 600;
        }
        .cargo-card-valor-wrap {
          display: flex;
          align-items: baseline;
          gap: 4px;
        }
        .cargo-card-rs {
          font-size: 16px;
          color: var(--ink-soft);
          font-weight: 500;
        }
        .cargo-card-valor {
          font-size: 22px;
          font-weight: 600;
          color: var(--ink);
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
          transition: background 120ms;
        }
        .cargo-card-valor:hover {
          background: var(--bg-sunken);
        }
        .cargo-card-valor-input {
          font-family: var(--font-mono);
          font-size: 22px;
          font-weight: 600;
          color: var(--ink);
          padding: 2px 6px;
          border: 1px solid var(--accent);
          border-radius: 4px;
          width: 140px;
          background: var(--bg-elevated);
          outline: none;
        }
        .cargo-card-rodape {
          font-size: 11px;
          color: var(--ink-soft);
          margin-top: 10px;
          padding-top: 8px;
          border-top: 1px solid var(--bg-sunken);
        }
        .cargo-card-rodape strong {
          color: var(--ink);
        }

        .excecoes-lista {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .excecao-card {
          background: var(--bg-elevated);
          border: 1px solid var(--accent);
          border-radius: 12px;
          padding: 16px;
        }
        .excecao-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 14px;
          gap: 12px;
        }
        .excecao-card-titulo {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }
        .excecao-card-nome {
          font-family: var(--font-display);
          font-size: 15px;
          font-weight: 500;
          color: var(--ink);
        }
        .excecao-card-sub {
          font-size: 11px;
          color: var(--ink-soft);
        }
        .excecao-card-acoes {
          display: flex;
          gap: 4px;
        }
        .excecao-card-corpo {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 14px;
          padding: 12px;
          background: rgba(42, 90, 140, 0.06);
          border-radius: 8px;
        }
        .excecao-info-label {
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--ink-soft);
          margin-bottom: 4px;
          font-weight: 600;
        }
        .excecao-info-valor {
          font-size: 12px;
          font-weight: 600;
          color: var(--ink);
        }
        .excecao-info-valor.link {
          color: var(--primary);
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .excecao-info-valor.link:hover {
          color: var(--accent);
        }

        /* Filtros de período (mesmo visual do fichário LC) */
        /* V731: fileira 20C — peça branca de ponta a ponta com respiro */
        .cargos-filtros-bar.cargos-sb {
          /* V734: z-index no filho direto do .page-content (stacking context
             da animação global) — o painel abria atrás dos cards */
          position: relative; z-index: 30;
          display: flex; align-items: stretch; flex-wrap: wrap;
          width: 100%; box-sizing: border-box;
          margin: 10px 0 14px;
          padding: 6px;
          background: #fff;
          border: 1px solid #e4ecf4;
          border-radius: 12px;
          box-shadow: 0 1px 2px rgba(20, 51, 82,.04), 0 10px 26px -20px rgba(20, 51, 82,.26);
        }
        .cargos-sb-celwrap { position: relative; min-width: 150px; display: flex; flex: 0 0 200px; }
        .cargos-sb-celwrap:not(:last-of-type) .cargos-sb-cel { border-right: 1px solid #f0f4f8; }
        .cargos-sb-cel {
          flex: 1; min-width: 0; display: flex; align-items: center; gap: 9px;
          padding: 9px 12px; border: none; border-radius: 9px;
          background: transparent; cursor: pointer; font-family: inherit; text-align: left;
          transition: background-color 120ms;
        }
        .cargos-sb-cel:hover, .cargos-sb-cel.ativo, .cargos-sb-cel.aberta { background: #f6f4ef; }
        .cargos-sb-tile {
          width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: #e4ecf4; color: #1d4470;
        }
        .cargos-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
        .cargos-sb-rot { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: #5a6879; white-space: nowrap; }
        .cargos-sb-val { font-size: 13px; font-weight: 700; color: #12304f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cargos-sb-chev { color: #96a2b1; flex-shrink: 0; display: flex; transition: transform 140ms; }
        .cargos-sb-cel.aberta .cargos-sb-chev { transform: rotate(180deg); }
        .cargos-sb-painel {
          position: absolute; top: 100%; left: 0; margin-top: 6px; z-index: 40;
          min-width: 100%; width: max-content; max-width: 300px;
          background: #fff; border: 1px solid #dfe4ea; border-radius: 12px;
          box-shadow: 0 18px 44px -14px rgba(11, 35, 64,.42); overflow: hidden;
        }
        .cargos-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; }
        .cargos-sb-it { display: flex; align-items: center; height: 36px; padding: 0 10px; border-radius: 8px; cursor: pointer; font-size: 13px; color: #12304f; }
        .cargos-sb-it:hover { background: #f0f4f8; }
        .cargos-sb-it.sel { background: #f0f4f8; font-weight: 700; }
        .cargos-sb .cargos-filtros-help { align-self: center; margin-left: auto; padding: 0 12px; }
        .cargos-filtros-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--ink-soft);
        }
        .cargos-filtros-controles {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }
        .cargos-filtro-select {
          padding: 6px 12px;
          font-size: 12px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: white;
          font-weight: 600;
          cursor: pointer;
          color: var(--ink);
        }
        .cargos-filtros-help {
          font-size: 11px;
          color: var(--ink-faint);
          font-style: italic;
          margin-left: auto;
        }
        @media (max-width: 700px) {
          .cargos-filtros-help { margin-left: 0; flex-basis: 100%; }
        }

        /* Bloco de cálculo da exceção (% × Produção LC = Repasse) */
        .excecao-calculo {
          background: linear-gradient(135deg, #143352 0%, #0b2340 100%);
          color: #f6f4ef;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid #143352;
        }
        .excecao-calculo .excecao-info-label {
          color: #2a5a8c;
          margin-bottom: 4px;
        }
        .excecao-calculo-valor {
          font-size: 16px !important;
          font-weight: 800 !important;
          color: #FFFFFF !important;   /* V864 (era #9FE6C9) — sobre o fundo escuro do bloco */
          line-height: 1.1;
          margin-bottom: 4px;
        }
        .excecao-calculo-formula {
          font-size: 10px;
          color: #C8D6D2;
          font-weight: 500;
        }
        .excecao-info-aviso {
          background: #FFF8E1;
          border: 1px dashed #FFFFFF;   /* V864 (era #9FE6C9) */
          padding: 8px 10px;
          border-radius: 8px;
        }

        .exc-sup {
          color: var(--accent);
          font-size: 7px;
          margin-left: 1px;
        }

        .linha-excecao {
          background: rgba(42, 90, 140, 0.04);
        }
        .regra-fixa {
          font-size: 11px;
          color: var(--ink-soft);
        }
        .regra-excecao {
          font-size: 11px;
          color: var(--accent);
          font-weight: 600;
        }
        .valor-calculado {
          font-size: 11px;
          color: var(--ink-faint);
          font-style: italic;
          font-weight: 500;
        }
        /* Fórmula auxiliar abaixo do valor (ex: '5% × R$ 138.929') */
        .valor-exc-formula {
          font-size: 10px;
          color: var(--ink-faint);
          font-weight: 500;
          margin-top: 2px;
        }
        /* Linhas de subtotal no rodapé da tabela de médicos */
        .linha-subtotal td {
          border-top: none !important;
          padding-top: 4px !important;
          padding-bottom: 4px !important;
        }

        .btn-pequeno {
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 600;
        }

        /* Modal */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .modal {
          background: var(--bg-elevated);
          border-radius: 12px;
          box-shadow: var(--shadow-lg);
          width: 100%;
          max-width: 480px;
          display: flex;
          flex-direction: column;
        }
        .modal-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .modal-header h3 {
          margin: 0;
          font-family: var(--font-display);
          font-weight: 500;
          font-size: 18px;
        }
        .modal-close {
          background: transparent;
          border: none;
          font-size: 22px;
          color: var(--ink-soft);
          cursor: pointer;
          padding: 0 4px;
        }
        .modal-body {
          padding: 18px 20px;
        }
        .modal-footer {
          padding: 12px 20px;
          border-top: 1px solid var(--border);
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }

        .proc-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          font-size: 13px;
          cursor: pointer;
          border-radius: 4px;
          transition: background 100ms;
        }
        .proc-item:hover {
          background: var(--bg-sunken);
        }
        .proc-item input {
          margin: 0;
        }
    `;
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};
