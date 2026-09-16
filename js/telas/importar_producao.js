/**
 * ============================================================================
 * TELA: Processamento · Importar PRODUÇÃO
 *
 * Importa o relatório analítico do hospital (não confundir com QVIS).
 * Esta é a fonte de apoio usada pelos módulos de desempenho.
 *
 * Layout:
 *   - Banner explicativo no topo
 *   - Botão "Importar nova produção"
 *   - Listagem das competências já importadas
 *   - Para cada competência: estatísticas + botão de excluir
 * ============================================================================
 */

App.telas['importar-producao'] = function () {
  renderizar();

  function renderizar() {
    // Lista todas as competências importadas com estatísticas
    const todasComps = Banco.query(`
      SELECT
        competencia,
        SUM(COALESCE(quantidade, 0)) AS qtd_linhas,   -- V850: soma da coluna QUANTIDADE (pedido do usuário; antes contava linhas)
        COUNT(DISTINCT cod_admissao) AS qtd_admissoes,
        SUM(CASE WHEN valor IS NOT NULL THEN valor ELSE 0 END) AS total_valor,
        MAX(importada_em) AS importada_em
      FROM linhas_producao
      GROUP BY competencia
      ORDER BY competencia DESC
    `);

    // V604: FILTRO DE ANO — vale para a tabela E para os totalizadores.
    // A escolha persiste enquanto o app está aberto (window.__impProdAno).
    const anos = [...new Set(todasComps.map(c => String(c.competencia).slice(0, 4)))].sort().reverse();
    let anoSel = window.__impProdAno || '';
    if (anoSel && !anos.includes(anoSel)) anoSel = window.__impProdAno = '';
    const competencias = anoSel ? todasComps.filter(c => String(c.competencia).startsWith(anoSel)) : todasComps;

    /**
     * V848 (1): DRILLDOWN POR ANO — as competências saem agrupadas por ano;
     * cada ano é uma linha-cabeçalho clicável (▸/▾) com os totais do ano, e os
     * meses ficam dentro. O ano mais recente nasce aberto; a escolha persiste
     * enquanto o app está aberto (window.__impProdAnosAbertos).
     */
    const grupos = [];
    for (const c of competencias) {
      const ano = String(c.competencia).slice(0, 4);
      let g = grupos.find(x => x.ano === ano);
      if (!g) grupos.push(g = { ano, comps: [], linhas: 0, admissoes: 0, valor: 0 });
      g.comps.push(c);
      g.linhas += Number(c.qtd_linhas) || 0;
      g.admissoes += Number(c.qtd_admissoes) || 0;
      g.valor += Number(c.total_valor) || 0;
    }
    if (!(window.__impProdAnosAbertos instanceof Set)) {
      window.__impProdAnosAbertos = new Set(grupos.length ? [grupos[0].ano] : []);
    }
    const abertos = window.__impProdAnosAbertos;

    /**
     * V848 (2): FILTRO — botão que abre a barra com ADMISSÃO · PACIENTE ·
     * DATA · PRODUTO (campos "contém", como nos filtros das outras abas).
     * Com algum campo preenchido, um card de RESULTADOS mostra as linhas da
     * produção que casam (com a competência de cada uma), limitado a 300.
     */
    const flt = window.__impProdFiltro || (window.__impProdFiltro = { aberto: false, adm: '', pac: '', data: '', prod: '' });
    const temFiltro = !!(flt.adm || flt.pac || flt.data || flt.prod);
    let resultados = null, totalResultados = 0;
    if (temFiltro) {
      const where = [], params = [];
      const like = (col, v) => { where.push(`${col} LIKE ?`); params.push('%' + v.trim() + '%'); };
      if (flt.adm) like('cod_admissao', flt.adm);
      if (flt.pac) like('paciente', flt.pac);
      if (flt.prod) { where.push(`(produto LIKE ? OR procedimento_principal LIKE ?)`);
        params.push('%' + flt.prod.trim() + '%', '%' + flt.prod.trim() + '%'); }
      if (flt.data) {
        // aceita o formato brasileiro (14/07/2026 ou 14/07) e o ISO do banco
        const m = flt.data.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
        const alvo = m ? `${m[3] || ''}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` : flt.data.trim();
        like('data_admissao', alvo);
      }
      const sql = where.join(' AND ');
      try {
        totalResultados = (Banco.queryUnica(`SELECT COUNT(*) AS n FROM linhas_producao WHERE ${sql}`, params) || {}).n || 0;
        resultados = Banco.query(`
          SELECT competencia, cod_admissao, data_admissao, paciente, produto, procedimento_principal, valor
            FROM linhas_producao WHERE ${sql}
           ORDER BY competencia DESC, cod_admissao LIMIT 300`, params) || [];
      } catch (e) { console.warn('[importar-producao] filtro:', e); resultados = []; }
    }

    // V603: o totalizador do resumo passou a SOMAR O VALOR da produção
    // importada (pedido do usuário) — antes contava número de linhas
    const totalValor = competencias.reduce((a, c) => a + (Number(c.total_valor) || 0), 0);

    document.getElementById('conteudo').innerHTML = `
      <div class="page-content">
        <header class="page-header">
          <div>
            <h2>Importar Produção</h2>
            <div class="subtitle">Relatório analítico mensal do hospital — fonte de apoio para os módulos de Desempenho</div>
          </div>
          <div style="display: flex; align-items: flex-end; gap: 12px">
            <div><!-- V604: filtro de ano (tabela + totalizadores) -->
              <label for="filtro-ano-prod" style="display: block; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-faint, #9aa09c); margin-bottom: 4px">Ano</label>
              <select id="filtro-ano-prod" class="input" style="min-width: 120px; padding: 8px 10px" data-no-hub>
                <option value="">Todos</option>
                ${anos.map(a => `<option value="${a}" ${a === anoSel ? 'selected' : ''}>${a}</option>`).join('')}
              </select>
            </div>
            <button class="btn btn-secondary" id="btn-filtro-prod" title="Filtrar as linhas importadas por admissão, paciente, data e produto"
                    style="${flt.aberto || temFiltro ? 'background: var(--accent); color: #fff; border-color: var(--accent);' : ''}">
              ⛛ Filtro${temFiltro ? ' ●' : ''}</button>
            <input type="file" id="upload-producao" accept=".xlsx,.xls" style="display: none">
            <button class="btn btn-primary" id="btn-importar">↑ Importar nova produção</button>
          </div>
        </header>

        <!-- V848 (2): barra de filtro — mesmo modelo "contém..." das outras abas -->
        <div class="card" id="painel-filtro-prod" style="padding: 12px 14px; margin-bottom: 14px; ${flt.aberto ? '' : 'display: none'}">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px">
            ${[['adm', 'ADMISSÃO', 'contém...'], ['pac', 'NOME DO PACIENTE', 'contém...'],
               ['data', 'DATA', '14/07/2026 ou 2026-07-14'], ['prod', 'PRODUTO', 'contém...']].map(([k, rot, ph]) => `
              <div>
                <label style="display: block; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-faint, #9aa09c); margin-bottom: 4px">${rot}</label>
                <input type="text" class="input" data-fprod="${k}" value="${String(flt[k] || '').replace(/"/g, '&quot;')}"
                       placeholder="${ph}" style="width: 100%; padding: 7px 9px" data-no-hub>
              </div>`).join('')}
          </div>
          ${temFiltro ? `<div style="margin-top: 8px; display: flex; align-items: center; gap: 10px">
            <span class="muted" style="font-size: 12px"><strong>${Utilidades.formatarNumero(totalResultados)}</strong> linha${totalResultados === 1 ? '' : 's'} encontrada${totalResultados === 1 ? '' : 's'}${totalResultados > 300 ? ' · mostrando as 300 primeiras' : ''}</span>
            <button class="btn btn-pequeno" id="btn-limpar-filtro-prod">✕ Limpar filtro</button>
          </div>` : ''}
        </div>

        ${temFiltro ? `
        <div class="card" style="padding: 0; overflow: hidden; margin-bottom: 16px">
          <table class="data-table">
            <thead><tr><th>COMPETÊNCIA</th><th>ADMISSÃO</th><th>DATA</th><th>PACIENTE</th><th>PRODUTO</th><th class="num">VALOR</th></tr></thead>
            <tbody>
              ${(resultados || []).length ? resultados.map(r => `
                <tr>
                  <td style="font-family: var(--font-mono)">${formatarCompetencia(r.competencia)}</td>
                  <td class="mono">${r.cod_admissao || '—'}</td>
                  <td>${r.data_admissao || '—'}</td>
                  <td>${String(r.paciente || '—')}</td>
                  <td>${String(r.produto || r.procedimento_principal || '—')}</td>
                  <td class="num mono">R$ ${Utilidades.formatarNumero(Number(r.valor) || 0, 2)}</td>
                </tr>`).join('')
              : `<tr><td colspan="6" style="text-align: center; color: var(--ink-faint); padding: 18px">Nenhuma linha da produção casa com o filtro.</td></tr>`}
            </tbody>
          </table>
        </div>` : ''}

        <div class="card" style="background: #E1EFF6; border-color: #9FE6C9; padding: 14px; margin-bottom: 16px">
          <div style="display: flex; gap: 10px; align-items: flex-start">
            <div style="font-size: 20px; line-height: 1">ℹ</div>
            <div style="font-size: 12px; color: #4A5754; line-height: 1.5">
              <strong>Esta NÃO é a importação do QVIS.</strong> O QVIS é a fonte oficial do
              repasse médico financeiro. Esta importação carrega o <strong>relatório analítico</strong>
              do hospital, que é usado pelos fichários do módulo Desempenho (Lentes de Contato,
              OPME, LIO, etc.) para identificar quem executou cada procedimento.
              <br><br>
              O relatório é importado <strong>na íntegra</strong>, preservando a estrutura original
              — cada fichário decide o que filtrar/ignorar nos seus próprios cálculos.
              Reimportar um mês já existente <strong>sobrescreve</strong> os dados anteriores
              dessa competência (não duplica).
            </div>
          </div>
        </div>

        <!-- Resumo geral -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="label">Competências importadas</div>
            <div class="value">${competencias.length}</div>
          </div>
          <div class="stat-card">
            <div class="label">Valor da produção importada</div>
            <div class="value">R$ ${Utilidades.formatarNumero(totalValor, 2)}</div>
          </div>
        </div>

        <!-- Lista de competências -->
        ${competencias.length === 0 ? `
          <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 40px 20px">
            <div style="font-size: 32px; opacity: 0.4; margin-bottom: 8px">⌧</div>
            <h3 style="margin: 0 0 6px">${anoSel && todasComps.length ? `Nenhuma produção de ${anoSel}` : 'Nenhuma produção importada ainda'}</h3>
            <p class="muted" style="font-size: 13px; margin: 0">
              ${anoSel && todasComps.length ? 'Escolha outro ano no filtro acima.' : 'Clique em <strong>"Importar nova produção"</strong> para começar'}
            </p>
          </div>
        ` : `
          <div class="card" style="padding: 0; overflow: hidden">
            <table class="data-table">
              <thead>
                <tr>
                  <th>COMPETÊNCIA</th>
                  <th class="num" title="Soma da coluna QUANTIDADE das linhas importadas (V850)">QUANTIDADE</th>
                  <th class="num">ADMISSÕES</th>
                  <th class="num">VALOR FATURADO</th>
                  <th>IMPORTADA EM</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${grupos.map(g => `
                  <tr class="prod-ano" data-ano="${g.ano}" title="${abertos.has(g.ano) ? 'Recolher' : 'Expandir'} os meses de ${g.ano}">
                    <td style="font-weight: 700; font-size: 13px">
                      <span class="prod-ano-seta">${abertos.has(g.ano) ? '▾' : '▸'}</span> ${g.ano}
                      <span class="muted" style="font-weight: 400; font-size: 11px">(${g.comps.length} ${g.comps.length === 1 ? 'mês' : 'meses'})</span>
                    </td>
                    <td class="num mono">${Utilidades.formatarNumero(g.linhas)}</td>
                    <td class="num mono">${Utilidades.formatarNumero(g.admissoes)}</td>
                    <td class="num mono"><strong>R$ ${Utilidades.formatarNumero(g.valor, 2)}</strong></td>
                    <td></td><td></td>
                  </tr>
                  ${abertos.has(g.ano) ? g.comps.map(c => `
                  <tr class="prod-mes">
                    <td style="font-weight: 600; font-family: var(--font-mono); padding-left: 30px">
                      ${formatarCompetencia(c.competencia)}
                    </td>
                    <td class="num mono">${Utilidades.formatarNumero(c.qtd_linhas)}</td>
                    <td class="num mono">${Utilidades.formatarNumero(c.qtd_admissoes)}</td>
                    <td class="num mono"><strong>R$ ${Utilidades.formatarNumero(c.total_valor, 2)}</strong></td>
                    <td class="muted" style="font-size: 11px">${formatarDataHora(c.importada_em)}</td>
                    <td style="text-align: right; white-space: nowrap">
                      <button class="btn btn-pequeno btn-exportar-prod" data-comp="${c.competencia}" title="V927: exporta o relatório de produção deste mês (as mesmas colunas importadas) com o acompanhamento do repasse por admissão: código do relatório de repasse, status Pago/Aguardando, glosado e pago">⬇ Exportar</button>
                      <button class="btn btn-pequeno btn-atualizar" data-comp="${c.competencia}" title="Lançar um relatório ATUALIZADO deste mês (sobrescreve a produção). O Gerencial reflete; o Contábil consolidado permanece congelado.">↻ Atualizar</button>
                      <button class="btn btn-pequeno btn-perigo btn-excluir" data-comp="${c.competencia}">
                        Excluir
                      </button>
                    </td>
                  </tr>`).join('') : ''}
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>

      <style>
        .btn-pequeno {
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 600;
        }
        .btn-atualizar { margin-right: 6px; background: #E1EFF6; color: #0F6E56; border: 1px solid #9FE6C9; }
        .btn-atualizar:hover { background: #D4E9DF; }
        /* V848: drilldown por ano */
        .prod-ano { cursor: pointer; background: var(--bg-sunken, #F4F6F5); }
        .prod-ano:hover { background: #E9EEEC; }
        .prod-ano .prod-ano-seta { display: inline-block; width: 14px; color: var(--accent, #107DAC); }
      </style>
    `;

    bindEventos();
  }

  function formatarCompetencia(comp) {
    if (!comp) return '—';
    const [ano, mes] = comp.split('-');
    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${meses[Number(mes) - 1] || mes}/${ano}`;
  }

  function formatarDataHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso.replace(' ', 'T'));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function bindEventos() {
    // V604: filtro de ano — refiltra a tabela e os totalizadores
    const selAno = document.getElementById('filtro-ano-prod');
    if (selAno) selAno.addEventListener('change', () => {
      window.__impProdAno = selAno.value;
      renderizar();
    });

    // V848 (1): drilldown — clicar no ANO expande/recolhe os meses dele
    document.querySelectorAll('.prod-ano').forEach(tr => tr.addEventListener('click', () => {
      const ano = tr.dataset.ano;
      const ab = window.__impProdAnosAbertos;
      if (ab.has(ano)) ab.delete(ano); else ab.add(ano);
      renderizar();
    }));

    // V848 (2): botão de filtro + campos "contém" (re-render preservando o foco)
    const btnFlt = document.getElementById('btn-filtro-prod');
    if (btnFlt) btnFlt.addEventListener('click', () => {
      window.__impProdFiltro.aberto = !window.__impProdFiltro.aberto;
      renderizar();
    });
    let tmrFlt = null;
    document.querySelectorAll('[data-fprod]').forEach(inp => {
      inp.addEventListener('input', () => {
        clearTimeout(tmrFlt);
        tmrFlt = setTimeout(() => {
          const chave = inp.dataset.fprod;
          const pos = inp.selectionStart;
          window.__impProdFiltro[chave] = inp.value;
          renderizar();
          const novo = document.querySelector(`[data-fprod="${chave}"]`);
          if (novo) { novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (_) {} }
        }, 300);
      });
    });
    const btnLimpar = document.getElementById('btn-limpar-filtro-prod');
    if (btnLimpar) btnLimpar.addEventListener('click', () => {
      Object.assign(window.__impProdFiltro, { adm: '', pac: '', data: '', prod: '' });
      renderizar();
    });

    document.getElementById('btn-importar').addEventListener('click', () => {
      const up = document.getElementById('upload-producao');
      up.dataset.alvoComp = '';   // importação nova (sem alvo)
      up.click();
    });
    document.querySelectorAll('.btn-atualizar').forEach(btn => {
      btn.addEventListener('click', () => {
        const up = document.getElementById('upload-producao');
        up.dataset.alvoComp = btn.dataset.comp;   // V271: atualizar a produção deste mês
        up.click();
      });
    });

    document.getElementById('upload-producao').addEventListener('change', async (e) => {
      const arquivo = e.target.files[0];
      const alvoComp = e.target.dataset.alvoComp || '';
      if (!arquivo) return;
      await importarArquivo(arquivo, alvoComp);
      e.target.value = '';  // Permite reimportar o mesmo arquivo
      e.target.dataset.alvoComp = '';
    });

    document.querySelectorAll('.btn-excluir').forEach(btn => {
      btn.addEventListener('click', () => excluirCompetencia(btn.dataset.comp));
    });

    // V927: extração da produção com o acompanhamento do repasse
    document.querySelectorAll('.btn-exportar-prod').forEach(btn => {
      btn.addEventListener('click', () => exportarProducaoComRepasse(btn.dataset.comp));
    });
  }

  // ==========================================================================
  // IMPORTAÇÃO
  // ==========================================================================

  async function importarArquivo(arquivo, alvoComp = '') {
    Utilidades.mostrarLoading('Importando produção... isso pode demorar 30s a 2min para 50k linhas');

    try {
      const rel = await ImportadorProducao.importar(arquivo);
      Utilidades.esconderLoading();

      // V271: invalida caches p/ o Gerencial refletir a produção atualizada (o Contábil consolidado fica congelado)
      (rel.competencias || []).forEach(cp => {
        try { window.AtlasProducaoMedica?.invalidar(cp); } catch (_) {}
        try { window.AtlasRelatorios?.invalidarConsolidado(cp); } catch (_) {}
      });

      const compsTexto = rel.competencias.map(formatarCompetencia).join(', ');

      alert(
        `✓ Importação concluída!\n\n` +
        `Competência(s) importada(s): ${compsTexto || '—'}\n\n` +
        `Linhas lidas no arquivo:    ${Utilidades.formatarNumero(rel.linhas_lidas)}\n` +
        `Linhas importadas:          ${Utilidades.formatarNumero(rel.linhas_importadas)}\n` +
        `Linhas vazias ignoradas:    ${Utilidades.formatarNumero(rel.linhas_vazias)}\n\n` +
        `Admissões únicas:           ${Utilidades.formatarNumero(rel.admissoes_unicas)}\n` +
        `Valor total faturado:       R$ ${Utilidades.formatarNumero(rel.total_valor, 2)}\n\n` +
        (rel.competencias.length > 1
          ? `⚠ O arquivo continha múltiplos meses (${rel.competencias.length}). Todos foram importados.`
          : '') +
        (alvoComp ? `\n\nℹ Atualização: o Gerencial reflete a nova produção; o Contábil consolidado permanece CONGELADO (imutável).` : '') +
        (alvoComp && !(rel.competencias || []).includes(alvoComp)
          ? `\n\n⚠ Você pediu atualizar ${formatarCompetencia(alvoComp)}, mas o arquivo é de ${(rel.competencias || []).map(formatarCompetencia).join(', ') || '—'}.`
          : '')
      );

      renderizar();
    } catch (e) {
      Utilidades.esconderLoading();
      console.error(e);
      alert('Erro na importação:\n\n' + e.message);
    }
  }

  // ==========================================================================
  // V927: EXTRAÇÃO DA PRODUÇÃO COM O ACOMPANHAMENTO DO REPASSE
  //
  // Pedido do usuário: "precisamos acompanhar na produção as admissões que já
  // foram pagas e que ainda não foram". O arquivo é o MESMO relatório de
  // produção importado (47 colunas, mesma ordem e cabeçalhos) mais 4 colunas
  // por ADMISSÃO no fim: COMPETÊNCIA DO REPASSE (mês de pagamento do QVIS em
  // que a admissão entrou), Nº DO RELATÓRIO DE REPASSE (o código NUMÉRICO do
  // relatório QVIS — qvis_snapshot_stats.codigo_relatorio, por origem — V927b,
  // pedido do usuário; a coluna de código de consolidação saiu na V930), STATUS (Pago = a admissão consta em algum relatório de
  // repasse/QVIS importado; Aguardando repasse = ainda não), GLOSADO
  // (produzido − recebido, só a parte positiva, nas linhas do EXECUTANTE — a
  // régua da Glosa FATO da Visão Geral) e PAGO (recebido do convênio nas linhas
  // do executante). Os valores se repetem em todas as linhas da admissão (pra
  // filtrar no Excel); a aba "Por admissão" tem uma linha por admissão para
  // totalizar sem somar em dobro.
  // ==========================================================================
  const PROD_RELATORIO = [
    ['Cód. Admissão', 'cod_admissao'],       ['Data Admissão', 'data_admissao'],
    ['Hora Admissão', 'hora_admissao'],      ['Status Admissão', 'status_admissao'],
    ['Unid. Atendimento', 'unidade'],        ['Especialidade', 'especialidade'],
    ['Tipo Recebimento', 'tipo_recebimento'],['Destino', 'destino'],
    ['Classificação Produto', 'classificacao_produto'], ['Tipo Produto', 'tipo_produto'],
    ['Categoria', 'categoria'],              ['Subcategoria', 'subcategoria'],
    ['Subespecialidade', 'subespecialidade'],['Médico Externo', 'medico_externo'],
    ['Cód. Apresentação', 'cod_apresentacao'], ['Procedimento Principal', 'procedimento_principal'],
    ['Produto', 'produto'],                  ['Pacote', 'pacote'],
    ['Convênio', 'convenio'],                ['Plano', 'plano'],
    ['Perfil Particular', 'perfil_particular'], ['Perfil Admissão', 'perfil_admissao'],
    ['Caráter Admissão', 'carater_admissao'],['Observação Admissão', 'observacao_admissao'],
    ['Sala', 'sala'],                        ['Profissional Admissão', 'profissional_admissao'],
    ['Tipo Paciente', 'tipo_paciente'],      ['Cód. Paciente', 'cod_paciente'],
    ['Paciente', 'paciente'],                ['Data Nascimento', 'data_nascimento'],
    ['Idade no Atendimento', 'idade_atendimento'], ['Faixa Etária', 'faixa_etaria'],
    ['CID Alta', 'cid_alta'],                ['Descrição CID', 'descricao_cid'],
    ['Qtd.', 'quantidade'],                  ['Valor R$', 'valor'],
    ['Indicante', 'indicante'],              ['Solicitante', 'solicitante'],
    ['Consultor', 'consultor'],              ['Médico', 'medico'],
    ['Cirurgião', 'cirurgiao'],              ['Instrumentador', 'instrumentador'],
    ['Contatologa', 'contatologa'],          ['Ortoptista', 'ortoptista'],
    ['Auxiliar SADT', 'auxiliar_sadt'],      ['Auxiliar 1', 'auxiliar_1'],
    ['Auxiliar 2', 'auxiliar_2'],
  ];
  const STATUS_PAGO = 'Pago', STATUS_AGUARDANDO = 'Aguardando repasse';
  /** só os dígitos, sem zeros à esquerda — mesmo critério do Calcular/Auditoria */
  const _normAdmExp = (x) => {
    const s = String(x == null ? '' : x).trim().replace(/\.0+$/, '');
    const d = s.replace(/\D/g, '').replace(/^0+/, '');
    return d || s.replace(/\s/g, '');
  };
  const _dataBR = (v) => {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (v == null ? '' : String(v));
  };

  /** Papéis do QVIS que são EXECUTANTE (mapeamento_papeis) — mesma régua da Visão Geral. */
  function _papeisExecutante() {
    const set = new Set();
    try {
      (Banco.query(`SELECT UPPER(TRIM(papel_qvis)) AS p FROM mapeamento_papeis
                     WHERE papel_id = (SELECT id FROM papeis WHERE nome = 'Executante')`) || [])
        .forEach(r => { if (r.p) set.add(r.p); });
    } catch (_) {}
    if (!set.size) ['MEDICO', 'CIRURGIAO', 'EXECUTANTE'].forEach(p => set.add(p));
    return set;
  }

  /**
   * Acompanhamento por admissão: { status, competencia, numero, glosado, pago, meses }.
   * Lê o QVIS inteiro uma vez (por índice de admissão normalizada) e os códigos
   * de consolidação gravados por admissão (consolidacao_admissao) com o código
   * do mês (consolidacao_mes) de reserva.
   */
  function acompanhamentoPorAdmissao(admissoes) {
    const alvo = new Set(admissoes.map(_normAdmExp).filter(Boolean));
    const exec = _papeisExecutante();
    const mapa = new Map();
    const pega = (k) => {
      let o = mapa.get(k);
      if (!o) { o = { status: STATUS_AGUARDANDO, meses: new Set(), origens: new Set(), glosado: 0, pago: 0 }; mapa.set(k, o); }
      return o;
    };
    try {
      for (const q of Banco.query(`SELECT admissao, mes_pagamento, competencia, origem, papel, produzido, recebido FROM linhas_qvis`) || []) {
        const k = _normAdmExp(q.admissao);
        if (!alvo.has(k)) continue;
        const o = pega(k);
        o.status = STATUS_PAGO;
        const mes = q.mes_pagamento || q.competencia;
        if (mes) { o.meses.add(mes); o.origens.add(String(q.origem || 'CONVENIO').toUpperCase() + '|' + mes); }
        if (exec.has(String(q.papel || '').trim().toUpperCase())) {
          const prod = Number(q.produzido) || 0, rec = Number(q.recebido) || 0;
          o.pago += rec;
          if (prod - rec > 0) o.glosado += prod - rec;
        }
      }
    } catch (e) { console.warn('[importar-producao] acompanhamento QVIS:', e); }
    // V927b: o NÚMERO do relatório de repasse (QVIS) — por origem × mês de pagamento
    const numRel = new Map();
    try {
      (Banco.query(`SELECT origem, mes_pagamento, codigo_relatorio FROM qvis_snapshot_stats`) || [])
        .forEach(r => { if (r.codigo_relatorio) numRel.set(String(r.origem || '').toUpperCase() + '|' + r.mes_pagamento, String(r.codigo_relatorio)); });
    } catch (_) {}
    const rotOrigem = (o) => /PART/.test(o) ? 'Part' : (o === 'SUS' ? 'SUS' : 'Conv');
    const out = new Map();
    for (const [k, o] of mapa) {
      const meses = [...o.meses].sort();
      const pares = [...o.origens].sort();
      const nums = pares.map(p => numRel.get(p)).filter(Boolean);
      // um número só → só o número; mais de um → "Conv 35804 · Part 35783"
      const numero = nums.length <= 1 ? (nums[0] || '')
        : pares.filter(p => numRel.get(p)).map(p => `${rotOrigem(p.split('|')[0])} ${numRel.get(p)}`).join(' · ');
      out.set(k, { status: o.status,
                   competencia: meses.map(formatarCompetencia).join(', '), numero,
                   glosado: Math.round(o.glosado * 100) / 100, pago: Math.round(o.pago * 100) / 100, meses });
    }
    return out;
  }

  /** Dados prontos para a planilha: linhas (47 colunas + 4) e o resumo por admissão. */
  function montarDadosExport(comp) {
    const linhas = Banco.query(`SELECT * FROM linhas_producao WHERE competencia = ? ORDER BY id`, [comp]) || [];
    const adms = [...new Set(linhas.map(l => l.cod_admissao).filter(Boolean))];
    const acomp = acompanhamentoPorAdmissao(adms);
    const vazio = { status: STATUS_AGUARDANDO, competencia: '', numero: '', glosado: 0, pago: 0, meses: [] };
    const porAdm = new Map();
    const saida = linhas.map(l => {
      const k = _normAdmExp(l.cod_admissao);
      const a = acomp.get(k) || vazio;
      if (l.cod_admissao && !porAdm.has(k)) {
        porAdm.set(k, { admissao: String(l.cod_admissao), paciente: l.paciente || '', data: _dataBR(l.data_admissao),
                        convenio: l.convenio || '', competencia: a.competencia, numero: a.numero, status: a.status, glosado: a.glosado, pago: a.pago });
      }
      const row = {};
      for (const [, key] of PROD_RELATORIO) row[key] = l[key];
      row._competencia = a.competencia; row._numero = a.numero;
      row._status = a.status; row._glosado = a.glosado; row._pago = a.pago;
      return row;
    });
    return { linhas: saida, porAdmissao: [...porAdm.values()] };
  }

  async function exportarProducaoComRepasse(comp) {
    if (typeof ExcelJS === 'undefined') { Utilidades.toast('Biblioteca ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return; }
    Utilidades.mostrarLoading('Montando a produção com o acompanhamento do repasse…');
    try {
      await new Promise(r => setTimeout(r, 30));
      const { linhas, porAdmissao } = montarDadosExport(comp);
      if (!linhas.length) { Utilidades.esconderLoading(); Utilidades.toast('Nada para exportar neste mês', 'warning'); return; }
      const AZUL = 'FF107DAC', VERDE = 'FF0E7A57', VERMELHO = 'FF9B3A3A';
      const FMT = Utilidades.FMT_EXPORT_MOEDA;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'ATLAS — Repasse Médico';
      wb.created = new Date();
      const cabecalho = (ws) => {
        const h = ws.getRow(1);
        h.height = 22;
        h.eachCell((c) => {
          c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
          c.alignment = { vertical: 'middle', horizontal: 'center' };
        });
      };
      const pintarStatus = (cel, status) => {
        cel.font = { bold: true, color: { argb: status === STATUS_PAGO ? VERDE : AZUL } };
        cel.alignment = { horizontal: 'center', vertical: 'middle' };
      };

      // ── aba 1: o relatório de produção + acompanhamento ──
      const ws = wb.addWorksheet('Produção', { views: [{ state: 'frozen', ySplit: 1 }] });
      const larg = (k) => (k === 'produto' || k === 'procedimento_principal' || k === 'paciente' || k === 'observacao_admissao') ? 34
        : (k === 'valor' || k === 'quantidade') ? 12 : 16;
      ws.columns = PROD_RELATORIO.map(([rot, k]) => ({ header: rot.toUpperCase(), key: k, width: larg(k) }))
        .concat([
          { header: 'COMPETÊNCIA DO REPASSE', key: '_competencia', width: 22 },
          { header: 'Nº DO RELATÓRIO DE REPASSE', key: '_numero', width: 24 },
          { header: 'STATUS', key: '_status', width: 20 },
          { header: 'GLOSADO', key: '_glosado', width: 16, style: { numFmt: FMT } },
          { header: 'PAGO', key: '_pago', width: 16, style: { numFmt: FMT } },
        ]);
      ws.getColumn('valor').numFmt = FMT;
      cabecalho(ws);
      for (const l of linhas) {
        const row = { ...l };
        row.data_admissao = _dataBR(l.data_admissao);
        row.data_nascimento = _dataBR(l.data_nascimento);
        row.valor = Number(l.valor) || 0;
        row.quantidade = l.quantidade == null || l.quantidade === '' ? '' : Number(l.quantidade);
        const r = ws.addRow(row);
        if (l.tipo_recebimento) Utilidades.pintarCelulaFonte(r.getCell('tipo_recebimento'), l.tipo_recebimento);   // V947
        pintarStatus(r.getCell('_status'), l._status);
        if (l._glosado > 0) r.getCell('_glosado').font = { bold: true, color: { argb: VERMELHO } };
      }
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

      // ── aba 2: uma linha por admissão (para totalizar) ──
      const wa = wb.addWorksheet('Por admissão', { views: [{ state: 'frozen', ySplit: 1 }] });
      wa.columns = [
        { header: 'ADMISSÃO', key: 'admissao', width: 14 },
        { header: 'PACIENTE', key: 'paciente', width: 36 },
        { header: 'DATA', key: 'data', width: 12 },
        { header: 'CONVÊNIO', key: 'convenio', width: 24 },
        { header: 'COMPETÊNCIA DO REPASSE', key: 'competencia', width: 22 },
        { header: 'Nº DO RELATÓRIO DE REPASSE', key: 'numero', width: 24 },
        { header: 'STATUS', key: 'status', width: 20 },
        { header: 'GLOSADO', key: 'glosado', width: 16, style: { numFmt: FMT } },
        { header: 'PAGO', key: 'pago', width: 16, style: { numFmt: FMT } },
      ];
      cabecalho(wa);
      let tg = 0, tp = 0, nPago = 0;
      for (const a of porAdmissao) {
        const r = wa.addRow(a);
        pintarStatus(r.getCell('status'), a.status);
        ['admissao', 'data'].forEach(k => { r.getCell(k).alignment = { horizontal: 'center' }; });
        if (a.glosado > 0) r.getCell('glosado').font = { bold: true, color: { argb: VERMELHO } };
        tg += a.glosado; tp += a.pago; if (a.status === STATUS_PAGO) nPago++;
      }
      const rt = wa.addRow({ paciente: `TOTAL · ${porAdmissao.length} admissões · ${nPago} pagas · ${porAdmissao.length - nPago} aguardando`, glosado: tg, pago: tp });
      rt.font = { bold: true };
      wa.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `Producao_${comp}_com_repasse.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      Utilidades.esconderLoading();
      Utilidades.toast(`✓ Produção ${formatarCompetencia(comp)} exportada — ${porAdmissao.length} admissões (${nPago} pagas)`, 'success');
    } catch (e) {
      Utilidades.esconderLoading();
      console.error(e);
      alert('Erro na exportação:\n\n' + e.message);
    }
  }
  // exposto para os testes de regressão conferirem o acompanhamento sem baixar o arquivo
  window.AtlasImportarProducao = Object.assign(window.AtlasImportarProducao || {}, {
    montarDadosExport, acompanhamentoPorAdmissao, exportarProducaoComRepasse,
  });

  // ==========================================================================
  // EXCLUSÃO
  // ==========================================================================

  async function excluirCompetencia(comp) {
    const stats = Banco.queryUnica(
      `SELECT COUNT(*) AS qtd, SUM(valor) AS total FROM linhas_producao WHERE competencia = ?`,
      [comp]
    );

    if (!confirm(
      `Excluir TODOS os dados de produção da competência ${formatarCompetencia(comp)}?\n\n` +
      `Serão removidas ${Utilidades.formatarNumero(stats.qtd)} linhas ` +
      `(R$ ${Utilidades.formatarNumero(stats.total || 0, 2)} em faturamento).\n\n` +
      `Esta ação não pode ser desfeita. ` +
      `Você precisará reimportar o relatório se quiser recuperar.`
    )) return;

    Utilidades.mostrarLoading('Excluindo...');
    try {
      Banco.executar('DELETE FROM linhas_producao WHERE competencia = ?', [comp]);
      await Banco.compactar();   // V606: recupera o espaço do mês excluído já no mesmo passo
      Utilidades.esconderLoading();
      Utilidades.toast(`Competência ${formatarCompetencia(comp)} excluída`, 'success');
      renderizar();
    } catch (e) {
      Utilidades.esconderLoading();
      alert('Erro: ' + e.message);
    }
  }
};
