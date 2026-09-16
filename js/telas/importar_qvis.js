/**
 * ============================================================================
 * TELA: Importar QVIS
 *
 * Recebe os 2 relatórios mensais (Convênio + Particular) e popula a tabela
 * linhas_qvis. Suporta:
 *   - Drag & drop nos 2 inputs
 *   - Detecção automática do tipo (CONVENIO/PARTICULAR) pelo conteúdo
 *   - Pré-visualização antes de salvar (competências, contagens, alertas)
 *   - Substituição por competência+origem (re-importar Mai/2026 apaga só
 *     o Mai/2026 + origem detectada e insere o novo)
 *   - Importação atômica (se um arquivo falhar, nenhum é salvo)
 *   - Normalização de espaços nas colunas de busca
 *
 * Layout: 2 áreas de drop lado a lado + status atual + histórico.
 * ============================================================================
 */

App.telas['importar-qvis'] = function () {

  // Estado por sessão
  if (window.__impQvis === undefined) {
    window.__impQvis = {
      arquivoConvenio:   null,  // { file, parsed: { linhas, competencias, problemas } }
      arquivoParticular: null,  // idem
      processando: false,
      snapshotsExpandidos: new Set(),  // mes_pagamento dos snapshots expandidos no Status
      filtroCodigo: '',  // texto digitado no filtro de busca por código
    };
  }
  // Garantir que existe mesmo em sessões antigas
  if (!window.__impQvis.snapshotsExpandidos) {
    window.__impQvis.snapshotsExpandidos = new Set();
  }
  if (window.__impQvis.filtroCodigo === undefined) {
    window.__impQvis.filtroCodigo = '';
  }

  // ============================================================================
  // CATÁLOGO DE COLUNAS (estrutura inteligente, tolerante a variações)
  // ============================================================================
  //
  // Os relatórios QVIS evoluem: colunas podem desaparecer, mudar de nome ou
  // ganhar sinônimos. A estratégia aqui:
  //   - ESSENCIAIS: sem elas é impossível calcular qualquer coisa → BLOQUEIA
  //   - ORIGEM:    precisa de pelo menos UMA das alternativas → BLOQUEIA se nenhuma
  //   - OPCIONAIS: se vierem, importa; se não, salva null e mostra aviso
  //   - NOVAS:     colunas no arquivo mas não no catálogo → usuário decide
  //
  // Cada entrada `aceita` lista os possíveis nomes no Excel (case-insensitive,
  // ignorando espaços múltiplos e acentos).

  const NIVEL_ESSENCIAL = 'essencial';
  const NIVEL_ORIGEM    = 'origem';
  const NIVEL_OPCIONAL  = 'opcional';

  const CATALOGO_COLUNAS = [
    // ── ESSENCIAIS ──────────────────────────────────────────────────────────
    { chave: 'nome_profissional', nivel: NIVEL_ESSENCIAL, aceita: ['NOME PROFISSIONAL', 'PROFISSIONAL', 'NOME DO PROFISSIONAL', 'MEDICO', 'NOME MEDICO'] },
    { chave: 'papel',             nivel: NIVEL_ESSENCIAL, aceita: ['PAPEL', 'FUNCAO', 'FUNÇÃO'] },
    { chave: 'procedimento',      nivel: NIVEL_ESSENCIAL, aceita: ['PROCEDIMENTO', 'DESCRICAO PROCEDIMENTO', 'DESCRIÇÃO PROCEDIMENTO'] },
    { chave: 'admissao',          nivel: NIVEL_ESSENCIAL, aceita: ['ADMISSAO', 'ADMISSÃO', 'COD ADMISSAO', 'CODIGO ADMISSAO', 'NUM ADMISSAO'] },
    { chave: 'data_admissao',     nivel: NIVEL_ESSENCIAL, aceita: ['DATA ADMISSAO', 'DATA ADMISSÃO', 'DATA DA ADMISSAO', 'DT ADMISSAO'] },
    { chave: 'produzido',         nivel: NIVEL_ESSENCIAL, aceita: ['PRODUZIDO', 'VALOR PRODUZIDO', 'PRODUCAO', 'PRODUÇÃO'] },

    // ── ORIGEM (precisa de pelo menos UMA) ──────────────────────────────────
    // Identifica se a linha é de CONVENIO ou PARTICULAR. Os relatórios mais
    // recentes usam FONTE PAGADORA; os antigos usavam TIPO RECEBIMENTO.
    // Tratamos como sinônimos.
    { chave: 'tipo_recebimento',  nivel: NIVEL_ORIGEM,    aceita: ['TIPO RECEBIMENTO', 'TIPO DE RECEBIMENTO', 'FONTE PAGADORA', 'FONTE', 'TIPO PAGAMENTO'] },

    // ── OPCIONAIS ──────────────────────────────────────────────────────────
    { chave: 'quantidade',              nivel: NIVEL_OPCIONAL, aceita: ['QUANTIDADE', 'QTD', 'QTDE'] },
    { chave: 'convenio',                nivel: NIVEL_OPCIONAL, aceita: ['CONVENIO', 'CONVÊNIO', 'NOME CONVENIO'] },
    { chave: 'unidade_faturamento',     nivel: NIVEL_OPCIONAL, aceita: ['UNIDADE DE FATURAMENTO', 'UN FATURAMENTO', 'UN. FATURAMENTO'] },
    { chave: 'unidade_atendimento',     nivel: NIVEL_OPCIONAL, aceita: ['UNIDADE DE ATENDIMENTO', 'UN ATENDIMENTO', 'UN. ATENDIMENTO'] },
    { chave: 'destino',                 nivel: NIVEL_OPCIONAL, aceita: ['DESTINO'] },
    { chave: 'estado',                  nivel: NIVEL_OPCIONAL, aceita: ['ESTADO', 'STATUS'] },
    { chave: 'paciente',                nivel: NIVEL_OPCIONAL, aceita: ['PACIENTE', 'NOME PACIENTE', 'NOME DO PACIENTE'] },
    { chave: 'cod_paciente',            nivel: NIVEL_OPCIONAL, aceita: ['COD. PACIENTE', 'COD PACIENTE', 'CODIGO PACIENTE', 'CÓD. PACIENTE'] },
    { chave: 'conta',                   nivel: NIVEL_OPCIONAL, aceita: ['CONTA', 'NUM CONTA', 'NUMERO CONTA'] },
    { chave: 'envio',                   nivel: NIVEL_OPCIONAL, aceita: ['ENVIO', 'DATA ENVIO'] },
    { chave: 'honorario',               nivel: NIVEL_OPCIONAL, aceita: ['HONORARIO', 'HONORÁRIO', 'VALOR HONORARIO'] },
    { chave: 'recebido',                nivel: NIVEL_OPCIONAL, aceita: ['RECEBIDO', 'VALOR RECEBIDO'] },
    { chave: 'repassado',               nivel: NIVEL_OPCIONAL, aceita: ['REPASSADO', 'VALOR REPASSADO', 'REPASSE'] },
    { chave: 'tipo_paciente',           nivel: NIVEL_OPCIONAL, aceita: ['TIPO PACIENTE', 'TIPO DE PACIENTE'] },
    { chave: 'especialidade',           nivel: NIVEL_OPCIONAL, aceita: ['ESPECIALIDADE', 'AREA', 'ÁREA'] },
    { chave: 'classificacao_produto',   nivel: NIVEL_OPCIONAL, aceita: ['CLASSIFICACAO PRODUTO', 'CLASSIFICAÇÃO PRODUTO', 'CLASSIFICACAO', 'CLASSIFICAÇÃO', 'TIPO PRODUTO'] },
    { chave: 'cod_unidade_faturamento', nivel: NIVEL_OPCIONAL, aceita: ['COD. UNIDADE DE FATURAMENTO', 'COD UNIDADE FATURAMENTO', 'CÓD. UNIDADE DE FATURAMENTO'] },
    { chave: 'cod_repasse',             nivel: NIVEL_OPCIONAL, aceita: ['COD. REPASSE', 'COD REPASSE', 'CÓD. REPASSE'] },
    { chave: 'cod_regra_repasse',       nivel: NIVEL_OPCIONAL, aceita: ['COD. REGRA REPASSE', 'COD REGRA REPASSE', 'CÓD. REGRA REPASSE'] },
    { chave: 'novo_valor',              nivel: NIVEL_OPCIONAL, aceita: ['NOVO VALOR', 'VALOR NOVO', 'VALOR AJUSTADO'] },
  ];

  // Versão legada para compatibilidade (mantida com os mesmos nomes do BD)
  const COLUNAS_ESPERADAS = CATALOGO_COLUNAS.map(c => [c.aceita[0], c.chave]);

  // Colunas para exportação (DB → header Excel)
  // Inclui campos adicionais (origem, competencia, mes_pagamento, codigo_relatorio) ao final
  const COLS_EXPORT = [
    ...CATALOGO_COLUNAS.map(c => [c.chave, c.aceita[0]]),
    ['origem',           'ORIGEM'],
    ['competencia',      'COMPETENCIA'],
    ['mes_pagamento',    'MES_PAGAMENTO'],
    ['codigo_relatorio', 'CODIGO_RELATORIO'],
  ];

  /**
   * Constrói a cláusula SELECT para exportação fazendo LEFT JOIN com
   * qvis_snapshot_stats para trazer codigo_relatorio (que mora lá).
   * Todas as outras colunas vêm de linhas_qvis (alias 'lq').
   */
  function buildSelectExportSQL() {
    return COLS_EXPORT.map(c => {
      if (c[0] === 'codigo_relatorio') return `s.codigo_relatorio AS codigo_relatorio`;
      return `lq.${c[0]} AS ${c[0]}`;
    }).join(', ');
  }
  const FROM_EXPORT_SQL = `
    FROM linhas_qvis lq
    LEFT JOIN qvis_snapshot_stats s
      ON s.origem = lq.origem AND s.mes_pagamento = lq.mes_pagamento
  `;

  // V995: campos do filtro de linhas. Declarados AQUI, ACIMA do renderizar()
  // — a tela roda o primeiro render no meio do corpo da função, então um const
  // declarado depois cairia na zona morta (TDZ) e quebraria o primeiro desenho.
  const FILTRO_CAMPOS = [
    ['adm', 'ADMISSÃO', 'contém...'],
    ['pac', 'NOME DO PACIENTE', 'contém...'],
    ['data', 'DATA', '14/07/2026 ou 2026-07-14'],
    ['proc', 'PROCEDIMENTO', 'contém...'],
    ['prof', 'PROFISSIONAL', 'contém...'],
  ];
  const LIMITE_FILTRO = 300;

  renderizar();

  function renderizar() {
    try { _renderizarInterno(); }
    catch (e) {
      console.error('Erro Importação QVIS:', e);
      document.getElementById('conteudo').innerHTML = `
        <div class="page-content">
          <header class="page-header"><h2>Importar Sistema</h2></header>
          <div class="card" style="background: #FEE; border-color: #D88; padding: 18px">
            <h3 style="margin: 0 0 8px; color: #9B3A3A">⚠ Erro</h3>
            <pre style="font-size: 11px; white-space: pre-wrap">${escapeHTML(e.message)}\n\n${escapeHTML(e.stack || '')}</pre>
          </div>
        </div>
      `;
    }
  }

  /**
   * V995: FILTRO DAS LINHAS IMPORTADAS — o mesmo modelo "contém..." da
   * Importar Produção. Até aqui a tela só filtrava SNAPSHOT por código do
   * relatório; não dava pra perguntar "essa admissão entrou?" sem sair do
   * módulo. Agora ADMISSÃO · PACIENTE · DATA · PROCEDIMENTO · PROFISSIONAL
   * consultam linhas_qvis direto, com a origem e o mês de pagamento de cada
   * linha no resultado.
   */
  function filtroLinhasEstado() {
    if (!window.__impQvisFiltro) {
      window.__impQvisFiltro = { aberto: false, adm: '', pac: '', data: '', proc: '', prof: '' };
    }
    return window.__impQvisFiltro;
  }

  function buscarLinhasFiltro(flt) {
    const where = [], params = [];
    const like = (col, v) => { where.push(`${col} LIKE ?`); params.push('%' + v.trim() + '%'); };
    if (flt.adm) like('admissao', flt.adm);
    if (flt.pac) like('paciente', flt.pac);
    if (flt.proc) like('procedimento', flt.proc);
    if (flt.prof) like('nome_profissional', flt.prof);
    if (flt.data) {
      // aceita o formato brasileiro (14/07/2026 ou 14/07) e o ISO do banco
      const m = flt.data.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
      const alvo = m ? `${m[3] || ''}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
                     : flt.data.trim();
      like('data_admissao', alvo);
    }
    if (!where.length) return { total: 0, linhas: [] };
    const sql = where.join(' AND ');
    try {
      const total = (Banco.queryUnica(`SELECT COUNT(*) AS n FROM linhas_qvis WHERE ${sql}`, params) || {}).n || 0;
      const linhas = Banco.query(`
        SELECT origem, mes_pagamento, competencia, admissao, data_admissao, paciente,
               procedimento, papel, nome_profissional, produzido, recebido
          FROM linhas_qvis WHERE ${sql}
         ORDER BY mes_pagamento DESC, admissao LIMIT ${LIMITE_FILTRO}`, params) || [];
      return { total, linhas };
    } catch (e) {
      console.warn('[importar-qvis] filtro:', e);
      return { total: 0, linhas: [] };
    }
  }

  function renderFiltroLinhas(flt, temFiltro, res) {
    const fmtData = (d) => {
      const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || '—');
    };
    const fmtN = (v) => Utilidades.formatarNumero(Number(v) || 0, 2);
    return `
      <div class="card impq-filtro-linhas" id="impq-painel-filtro" ${flt.aberto ? '' : 'hidden'}>
        <div class="impq-filtro-grid">
          ${FILTRO_CAMPOS.map(([k, rot, ph]) => `
            <div>
              <label for="impq-f-${k}">${rot}</label>
              <input type="text" id="impq-f-${k}" class="input" data-fqvis="${k}"
                     value="${escapeAttr(flt[k] || '')}" placeholder="${ph}" autocomplete="off" data-no-hub>
            </div>`).join('')}
        </div>
        ${temFiltro ? `
          <div class="impq-filtro-rodape">
            <span><strong>${Utilidades.formatarNumero(res.total)}</strong> linha${res.total === 1 ? '' : 's'} no QVIS${res.total > LIMITE_FILTRO ? ` · mostrando as ${LIMITE_FILTRO} primeiras` : ''}</span>
            <button class="btn btn-pequeno" id="impq-filtro-linhas-limpar">✕ Limpar filtro</button>
          </div>` : ''}
      </div>
      ${temFiltro ? `
        <div class="card impq-filtro-resultado">
          <table class="data-table">
            <thead><tr>
              <th>ORIGEM</th><th>MÊS PGTO</th><th>ADMISSÃO</th><th>DATA</th><th>PACIENTE</th>
              <th>PROCEDIMENTO</th><th>PROFISSIONAL</th><th class="num">PRODUZIDO</th><th class="num">RECEBIDO</th>
            </tr></thead>
            <tbody>
              ${res.linhas.length ? res.linhas.map(r => `
                <tr>
                  <td><span class="impq-f-origem impq-f-${String(r.origem || '').toLowerCase()}">${escapeHTML(r.origem || '—')}</span></td>
                  <td class="mono">${escapeHTML(formatarComp(r.mes_pagamento))}</td>
                  <td class="mono">${escapeHTML(r.admissao || '—')}</td>
                  <td class="mono">${escapeHTML(fmtData(r.data_admissao))}</td>
                  <td>${escapeHTML(r.paciente || '—')}</td>
                  <td>${escapeHTML(r.procedimento || '—')}</td>
                  <td>${escapeHTML(r.nome_profissional || '—')}</td>
                  <td class="num mono">R$ ${fmtN(r.produzido)}</td>
                  <td class="num mono">R$ ${fmtN(r.recebido)}</td>
                </tr>`).join('')
              : `<tr><td colspan="9" class="impq-f-vazio">Nenhuma linha do QVIS casa com o filtro.</td></tr>`}
            </tbody>
          </table>
        </div>` : ''}
    `;
  }

  function _renderizarInterno() {
    const status = carregarStatusBase();
    const temDados = status.total > 0;
    const flt = filtroLinhasEstado();
    const temFiltro = !!(flt.adm || flt.pac || flt.data || flt.proc || flt.prof);
    const res = temFiltro ? buscarLinhasFiltro(flt) : { total: 0, linhas: [] };

    document.getElementById('conteudo').innerHTML = `
      <div class="page-content impq-page">
        <header class="page-header">
          <div>
            <h2>Importar Sistema</h2>
            <div class="subtitle">O relatório do sistema (QVIS) — importe os mensais Convênio + Particular; é dele que saem o cálculo e a auditoria</div>
          </div>
          <div class="impq-header-acoes">
            <button class="btn btn-secondary ${flt.aberto || temFiltro ? 'impq-filtro-on' : ''}" id="impq-btn-filtro"
                    ${!temDados ? 'disabled' : ''}
                    title="Filtrar as linhas já importadas por admissão, paciente, data, procedimento e profissional">
              ⛛ Filtro${temFiltro ? ' ●' : ''}
            </button>
            <button class="btn btn-primary" id="impq-exp-consol-header" ${!temDados ? 'disabled' : ''}>
              📚 Exportar Consolidado
            </button>
          </div>
        </header>

        ${temDados ? renderFiltroLinhas(flt, temFiltro, res) : ''}
        ${renderDropAreas()}
        ${renderPreviewETrigger()}
        ${renderStatusBase(status)}
      </div>
      ${getStyles()}
    `;

    bindEventos();
  }

  // ==========================================================================
  // ÁREAS DE DROP
  // ==========================================================================
  function renderDropAreas() {
    // Verifica se há dados de cada origem pra habilitar o botão Exportar
    let temConv = 0, temPart = 0;
    try {
      temConv = Banco.queryUnica(`SELECT COUNT(*) AS n FROM linhas_qvis WHERE origem = 'CONVENIO'`)?.n || 0;
      temPart = Banco.queryUnica(`SELECT COUNT(*) AS n FROM linhas_qvis WHERE origem = 'PARTICULAR'`)?.n || 0;
    } catch (e) {}

    return `
      <div class="impq-drops-grid">
        ${renderDropArea('convenio', '🏥', 'Convênio', '#102d4b', window.__impQvis.arquivoConvenio, temConv)}
        ${renderDropArea('particular', '💳', 'Particular', '#6B4587', window.__impQvis.arquivoParticular, temPart)}
      </div>
    `;
  }

  function renderDropArea(tipo, icone, label, cor, arquivo, qtdNoBanco) {
    // Header comum (com botão Exportar se houver dados daquela origem no banco)
    const btnExport = qtdNoBanco > 0
      ? `<button class="impq-drop-exp" data-exp-origem="${tipo}" title="Exportar dados de ${label}">↓ Exportar</button>`
      : '';
    if (arquivo) {
      // Já tem arquivo: mostra resumo
      const p = arquivo.parsed;
      const competsLista = Array.from(p.competencias.keys()).sort();
      const competsLabel = competsLista.length === 0 ? '—'
        : competsLista.length === 1 ? formatarComp(competsLista[0])
        : `${formatarComp(competsLista[0])} → ${formatarComp(competsLista[competsLista.length - 1])} (${competsLista.length} meses)`;
      const temProb = p.problemas.length > 0;

      // Sugestões para o seletor de mês de pagamento: 6 meses antes/depois
      // da última competência detectada no arquivo.
      const compReferencia = competsLista[competsLista.length - 1] || obterAnoMesAtual();
      const opcoes = gerarOpcoesMesPagamento(compReferencia);
      const mesPgtoEscolhido = arquivo.mesPagamento || sugerirMesPagamento(compReferencia);

      return `
        <div class="impq-drop impq-drop-carregado" data-tipo="${tipo}">
          <div class="impq-drop-header" style="border-bottom-color: ${cor}">
            <span class="impq-drop-icone">${icone}</span>
            <span class="impq-drop-label">${label}</span>
            ${btnExport}
            <button class="impq-drop-remover" data-remover="${tipo}" title="Remover">✕</button>
          </div>
          <div class="impq-drop-corpo">
            <div class="impq-arquivo-nome" title="${escapeAttr(arquivo.file.name)}">📄 ${escapeHTML(arquivo.file.name)}</div>
            <div class="impq-arquivo-meta">${(arquivo.file.size / 1024).toFixed(0)} KB</div>

            <div class="impq-resumo">
              <div class="impq-resumo-linha">
                <span class="impq-resumo-lbl">Linhas válidas:</span>
                <span class="impq-resumo-val mono">${p.linhas.length.toLocaleString('pt-BR')}</span>
              </div>
              <div class="impq-resumo-linha">
                <span class="impq-resumo-lbl">Competências:</span>
                <span class="impq-resumo-val">${competsLabel}</span>
              </div>
              <div class="impq-resumo-linha">
                <span class="impq-resumo-lbl">Profissionais:</span>
                <span class="impq-resumo-val mono">${p.profissionais.size}</span>
              </div>
              <div class="impq-resumo-linha">
                <span class="impq-resumo-lbl">Admissões únicas:</span>
                <span class="impq-resumo-val mono">${(p.estatisticas?.admissoesUnicas ?? p.admissoes.size).toLocaleString('pt-BR')}</span>
              </div>
              <div class="impq-resumo-divisor"></div>
              <div class="impq-resumo-linha">
                <span class="impq-resumo-lbl">Total PRODUZIDO:</span>
                <span class="impq-resumo-val mono" style="color: #0A7A5A">R$ ${formatarBR(p.estatisticas?.totalProduzido || 0)}</span>
              </div>
              <div class="impq-resumo-linha">
                <span class="impq-resumo-lbl">Total RECEBIDO:</span>
                <span class="impq-resumo-val mono" style="color: #0A7A5A">R$ ${formatarBR(p.estatisticas?.totalRecebido || 0)}</span>
              </div>
              <div class="impq-resumo-linha">
                <span class="impq-resumo-lbl">Adm. c/ PRODUZIDO zero:</span>
                <span class="impq-resumo-val mono" style="color: ${(p.estatisticas?.linhasProduzidoZero || 0) > 0 ? '#9B3A3A' : 'var(--ink)'}">${(p.estatisticas?.linhasProduzidoZero || 0).toLocaleString('pt-BR')}</span>
              </div>
              <div class="impq-resumo-linha">
                <span class="impq-resumo-lbl">Adm. c/ RECEBIDO zero:</span>
                <span class="impq-resumo-val mono" style="color: ${(p.estatisticas?.linhasRecebidoZero || 0) > 0 ? '#143352' : 'var(--ink)'}">${(p.estatisticas?.linhasRecebidoZero || 0).toLocaleString('pt-BR')}</span>
              </div>
              ${temProb ? `
                <div class="impq-problemas">
                  ⚠ ${p.problemas.length} problema${p.problemas.length !== 1 ? 's' : ''} detectado${p.problemas.length !== 1 ? 's' : ''}
                  <button class="impq-ver-problemas" data-tipo="${tipo}">ver</button>
                </div>
              ` : ''}
            </div>

            <div class="impq-mes-pgto">
              <div class="impq-mes-pgto-label">📅 Referente ao mês de pagamento</div>
              <select class="impq-mes-pgto-select mono" data-mes-pgto="${tipo}">
                ${opcoes.map(o => `<option value="${o.valor}" ${o.valor === mesPgtoEscolhido ? 'selected' : ''}>${o.label}</option>`).join('')}
              </select>
              <div class="impq-mes-pgto-hint">Esta data será gravada em todas as ${p.linhas.length.toLocaleString('pt-BR')} linhas deste arquivo</div>
            </div>
          </div>
        </div>
      `;
    }

    // Sem arquivo: mostra zona de drop
    return `
      <div class="impq-drop impq-drop-vazio" data-tipo="${tipo}" data-zona-drop="${tipo}">
        <div class="impq-drop-header" style="border-bottom-color: ${cor}">
          <span class="impq-drop-icone">${icone}</span>
          <span class="impq-drop-label">${label}</span>
          ${btnExport}
        </div>
        <div class="impq-drop-corpo impq-drop-zona">
          <div class="impq-drop-area">
            <div class="impq-drop-icone-grande">📂</div>
            <div class="impq-drop-prompt">Arraste o arquivo aqui<br>ou <strong>clique para selecionar</strong></div>
            <div class="impq-drop-hint">Aceita .xlsx</div>
            <input type="file" id="impq-input-${tipo}" accept=".xlsx,.xls" hidden>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // PREVIEW E BOTÃO DE EXECUTAR
  // ==========================================================================
  function renderPreviewETrigger() {
    const ac = window.__impQvis.arquivoConvenio;
    const ap = window.__impQvis.arquivoParticular;
    if (!ac && !ap) return '';

    // Calcula resumo do que vai acontecer (modelo SNAPSHOT por mes_pagamento + origem)
    const snapshotsAfetados = [];  // [{origem, mesPagamento, linhasNovas, linhasSubstituidas}]
    let totalLinhasNovas = 0;
    let totalLinhasSubstituidas = 0;
    let semMesPgto = false;

    function processarArq(arq, origem) {
      if (!arq) return;
      if (!arq.mesPagamento) {
        semMesPgto = true;
        return;
      }
      const novas = arq.parsed.linhas.length;
      let subs = 0;
      try {
        const r = Banco.queryUnica(
          `SELECT COUNT(*) AS n FROM linhas_qvis WHERE origem = ? AND mes_pagamento = ?`,
          [origem, arq.mesPagamento]
        );
        subs = r?.n || 0;
      } catch (e) {}
      snapshotsAfetados.push({ origem, mesPagamento: arq.mesPagamento, novas, subs });
      totalLinhasNovas += novas;
      totalLinhasSubstituidas += subs;
    }
    processarArq(ac, 'CONVENIO');
    processarArq(ap, 'PARTICULAR');

    const temSubstituicao = totalLinhasSubstituidas > 0;
    const podeImportar = (ac || ap) && !window.__impQvis.processando && !semMesPgto;

    return `
      <div class="impq-preview">
        <div class="impq-preview-titulo">
          <span>📊</span> Resumo da importação
        </div>
        <div class="impq-preview-grid">
          <div class="impq-preview-item">
            <div class="impq-preview-lbl">Arquivos selecionados</div>
            <div class="impq-preview-val mono">${(ac ? 1 : 0) + (ap ? 1 : 0)} / 2</div>
          </div>
          <div class="impq-preview-item">
            <div class="impq-preview-lbl">Snapshots afetados</div>
            <div class="impq-preview-val mono">${snapshotsAfetados.length}</div>
          </div>
          <div class="impq-preview-item">
            <div class="impq-preview-lbl">Linhas a inserir</div>
            <div class="impq-preview-val mono" style="color: #0A7A5A">+${totalLinhasNovas.toLocaleString('pt-BR')}</div>
          </div>
          <div class="impq-preview-item">
            <div class="impq-preview-lbl">Linhas a substituir</div>
            <div class="impq-preview-val mono" style="color: ${temSubstituicao ? '#143352' : 'var(--ink-faint)'}">${temSubstituicao ? '−' : ''}${totalLinhasSubstituidas.toLocaleString('pt-BR')}</div>
          </div>
        </div>

        ${snapshotsAfetados.length > 0 ? `
          <div class="impq-snapshots-detalhe">
            ${snapshotsAfetados.map(s => {
              const labelOrigem = s.origem === 'CONVENIO' ? 'Convênio' : 'Particular';
              const acao = s.subs > 0
                ? `<span class="impq-snap-substituir">substituirá ${s.subs.toLocaleString('pt-BR')} linhas existentes</span>`
                : `<span class="impq-snap-novo">snapshot novo</span>`;
              return `
                <div class="impq-snap-linha">
                  ${Utilidades.badgeFonte(s.origem, labelOrigem)}<!-- V947 -->
                  <strong>${formatarComp(s.mesPagamento)}</strong>
                  <span class="impq-snap-arrow">→</span>
                  <span>${s.novas.toLocaleString('pt-BR')} linhas · ${acao}</span>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}

        ${semMesPgto ? `
          <div class="impq-aviso impq-aviso-erro">
            ⛔ <strong>Mês de pagamento obrigatório</strong> — defina o mês de pagamento em cada arquivo carregado antes de prosseguir.
          </div>
        ` : ''}

        ${temSubstituicao ? `
          <div class="impq-aviso">
            ⚠ Já existem snapshots no banco com o mesmo mês de pagamento + origem. Eles serão <strong>substituídos</strong>. Snapshots de outros meses de pagamento permanecem intactos.
          </div>
        ` : ''}

        <div class="impq-acoes">
          <button class="btn btn-pequeno" id="impq-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="impq-confirmar" ${!podeImportar ? 'disabled' : ''}>
            ${window.__impQvis.processando ? '⏳ Processando...' : '✓ Confirmar importação'}
          </button>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // STATUS DA BASE (no rodapé)
  // ==========================================================================
  function carregarStatusBase() {
    try {
      const total = Banco.queryUnica(`SELECT COUNT(*) AS n FROM linhas_qvis`)?.n || 0;
      const conv = Banco.queryUnica(`SELECT COUNT(*) AS n FROM linhas_qvis WHERE origem = 'CONVENIO'`)?.n || 0;
      const part = Banco.queryUnica(`SELECT COUNT(*) AS n FROM linhas_qvis WHERE origem = 'PARTICULAR'`)?.n || 0;
      const periodos = Banco.query(`SELECT DISTINCT competencia FROM linhas_qvis ORDER BY competencia`).map(r => r.competencia);
      const profissionais = Banco.queryUnica(`SELECT COUNT(DISTINCT nome_normalizado) AS n FROM linhas_qvis WHERE nome_normalizado IS NOT NULL AND nome_normalizado != ''`)?.n || 0;
      return { total, conv, part, periodos, profissionais };
    } catch (e) {
      return { total: 0, conv: 0, part: 0, periodos: [], profissionais: 0 };
    }
  }

  function renderStatusBase(s) {
    const temDados = s.total > 0;
    const snapshots = temDados ? carregarSnapshots() : [];

    return `
      <div class="impq-status">
        <div class="impq-status-header">
          <div class="impq-status-titulo">📊 Status atual da base</div>
          <div class="impq-status-acoes">
            <button class="btn btn-pequeno btn-perigo" id="impq-apagar-comp" ${!temDados ? 'disabled' : ''}>
              🗑 Apagar snapshot
            </button>
          </div>
        </div>

        ${temDados ? renderCardsSnapshots(snapshots) : `
          <div class="impq-vazio">
            Nenhum relatório QVIS importado ainda. Arraste arquivos acima para começar.
          </div>
        `}
      </div>
    `;
  }

  /**
   * Carrega lista de SNAPSHOTS com estatísticas (da tabela qvis_snapshot_stats).
   * Retorna: [{ mes_pagamento, conv: {...stats...}, part: {...stats...}, total }]
   *
   * Fallback: se qvis_snapshot_stats não tem dados pra um snapshot existente
   * em linhas_qvis (caso de banco antigo), calcula on-the-fly.
   *
   * Também: detecta stats inconsistentes (total_linhas > 0 mas total_produzido = 0,
   * que indica importação anterior com bug do papel=MEDICO) e recalcula.
   */
  function carregarSnapshots() {
    try {
      // Pega dados primários da tabela de stats (uma linha por origem + mes_pagamento)
      let rows = Banco.query(`
        SELECT origem, mes_pagamento,
               total_linhas, total_admissoes_unicas, total_profissionais,
               total_produzido, total_recebido,
               adm_produzido_zero, adm_recebido_zero,
               competencia_min, competencia_max,
               arquivo_nome, codigo_relatorio, importado_em
        FROM qvis_snapshot_stats
        ORDER BY mes_pagamento DESC
      `);

      // Detecta stats inconsistentes (bug antigo: importação com papel=MEDICO
      // filtrado, mas o arquivo não tem papel=MEDICO → zerou tudo)
      // Recalcula essas linhas com a função fallback.
      const inconsistentes = rows.filter(r =>
        (r.total_linhas || 0) > 0 &&
        (r.total_produzido || 0) === 0 &&
        (r.total_recebido || 0) === 0
      );
      if (inconsistentes.length > 0) {
        console.log(`Detectados ${inconsistentes.length} snapshot(s) com stats zeradas — recalculando...`);
        for (const r of inconsistentes) {
          try {
            const novos = computarStatsSnapshot(r.origem, r.mes_pagamento);
            // Atualiza tabela
            Banco.executar(`
              UPDATE qvis_snapshot_stats
                 SET total_produzido = ?, total_recebido = ?,
                     adm_produzido_zero = ?, adm_recebido_zero = ?
               WHERE origem = ? AND mes_pagamento = ?
            `, [
              novos.total_produzido, novos.total_recebido,
              novos.adm_produzido_zero, novos.adm_recebido_zero,
              r.origem, r.mes_pagamento,
            ]);
            // Atualiza in-memory
            r.total_produzido = novos.total_produzido;
            r.total_recebido = novos.total_recebido;
            r.adm_produzido_zero = novos.adm_produzido_zero;
            r.adm_recebido_zero = novos.adm_recebido_zero;
          } catch (e) {
            console.warn(`Falha recalculando ${r.origem}/${r.mes_pagamento}:`, e);
          }
        }
        // Persiste
        Banco.salvar().catch(e => console.warn('Falha salvando stats recalculadas:', e));
      }

      // Verifica se há snapshots em linhas_qvis SEM entrada em stats
      // (importações antigas pré-tabela de stats)
      const snapshotsExistentes = new Set();
      try {
        Banco.query(`
          SELECT DISTINCT mes_pagamento, origem FROM linhas_qvis
          WHERE mes_pagamento IS NOT NULL AND mes_pagamento != ''
        `).forEach(r => snapshotsExistentes.add(`${r.origem}|${r.mes_pagamento}`));
      } catch (e) {}
      const statsExistentes = new Set(rows.map(r => `${r.origem}|${r.mes_pagamento}`));
      const faltando = [...snapshotsExistentes].filter(k => !statsExistentes.has(k));

      // Computa stats faltantes on-the-fly (lento, mas só roda 1 vez)
      const statsFallback = [];
      for (const key of faltando) {
        const [origem, mp] = key.split('|');
        try {
          const stats = computarStatsSnapshot(origem, mp);
          statsFallback.push(stats);
        } catch (e) { console.warn('Falha computando stats fallback:', e); }
      }

      const todasRows = [...rows, ...statsFallback];

      // Agrupa por mes_pagamento → {conv, part}
      const mapa = new Map();
      for (const r of todasRows) {
        if (!mapa.has(r.mes_pagamento)) {
          mapa.set(r.mes_pagamento, {
            mes_pagamento: r.mes_pagamento,
            conv: null,
            part: null,
            total: 0,
            arquivo_nome_conv: null,
            arquivo_nome_part: null,
            importado_em: null,
          });
        }
        const item = mapa.get(r.mes_pagamento);
        const dados = {
          origem:             r.origem,
          mes_pagamento:      r.mes_pagamento,
          linhas:             r.total_linhas || 0,
          admissoes_unicas:   r.total_admissoes_unicas || 0,
          profissionais:      r.total_profissionais || 0,
          produzido:          r.total_produzido || 0,
          recebido:           r.total_recebido || 0,
          adm_prod_zero:      r.adm_produzido_zero || 0,
          adm_receb_zero:     r.adm_recebido_zero || 0,
          comp_min:           r.competencia_min,
          comp_max:           r.competencia_max,
          arquivo_nome:       r.arquivo_nome,
          codigo_relatorio:   r.codigo_relatorio || null,
          importado_em:       r.importado_em,
        };
        if (r.origem === 'CONVENIO')        { item.conv = dados; item.arquivo_nome_conv = r.arquivo_nome; }
        else if (r.origem === 'PARTICULAR') { item.part = dados; item.arquivo_nome_part = r.arquivo_nome; }
        item.total += dados.linhas;
        if (r.importado_em && (!item.importado_em || r.importado_em > item.importado_em)) {
          item.importado_em = r.importado_em;
        }
      }
      return Array.from(mapa.values()).sort((a, b) => b.mes_pagamento.localeCompare(a.mes_pagamento));
    } catch (e) {
      console.warn('Erro carregando snapshots:', e);
      return [];
    }
  }

  /**
   * Calcula estatísticas de um snapshot diretamente das linhas (fallback
   * para snapshots antigos sem registro em qvis_snapshot_stats).
   */
  function computarStatsSnapshot(origem, mesPagamento) {
    const r = Banco.queryUnica(`
      SELECT
        COUNT(*) AS total_linhas,
        COUNT(DISTINCT admissao) AS total_admissoes_unicas,
        COUNT(DISTINCT nome_normalizado) AS total_profissionais,
        MIN(competencia) AS competencia_min,
        MAX(competencia) AS competencia_max
      FROM linhas_qvis
      WHERE origem = ? AND mes_pagamento = ?
    `, [origem, mesPagamento]);

    // Soma SIMPLES de TODAS as linhas (sem dedupe) — igual à soma de coluna no Excel
    const r2 = Banco.queryUnica(`
      SELECT
        COALESCE(SUM(produzido), 0) AS total_produzido,
        COALESCE(SUM(recebido), 0) AS total_recebido
      FROM linhas_qvis
      WHERE origem = ? AND mes_pagamento = ?
    `, [origem, mesPagamento]);

    // Quantas ADMISSÕES DISTINTAS têm pelo menos 1 linha com produzido/recebido = 0?
    // (admissões com algum procedimento não-faturado)
    const linhasZero = Banco.queryUnica(`
      SELECT
        COUNT(DISTINCT CASE WHEN ABS(COALESCE(produzido, 0)) < 0.005 THEN admissao END) AS lin_prod_zero,
        COUNT(DISTINCT CASE WHEN ABS(COALESCE(recebido, 0))  < 0.005 THEN admissao END) AS lin_receb_zero
      FROM linhas_qvis
      WHERE origem = ? AND mes_pagamento = ?
    `, [origem, mesPagamento]);
    const admProdZero = Number(linhasZero?.lin_prod_zero) || 0;
    const admRecebZero = Number(linhasZero?.lin_receb_zero) || 0;

    return {
      origem, mes_pagamento: mesPagamento,
      total_linhas: r?.total_linhas || 0,
      total_admissoes_unicas: r?.total_admissoes_unicas || 0,
      total_profissionais: r?.total_profissionais || 0,
      total_produzido: r2?.total_produzido || 0,
      total_recebido: r2?.total_recebido || 0,
      adm_produzido_zero: admProdZero,
      adm_recebido_zero: admRecebZero,
      competencia_min: r?.competencia_min,
      competencia_max: r?.competencia_max,
      arquivo_nome: null,
      importado_em: null,
    };
  }

  /**
   * Renderiza os snapshots como CARDS EXPANSÍVEIS (substitui a tabela antiga).
   */
  function renderCardsSnapshots(snapshots) {
    if (snapshots.length === 0) return '';

    // Aplica filtro por código (não diferencia conv/part)
    const filtro = (window.__impQvis.filtroCodigo || '').trim().toLowerCase();
    let snapshotsFiltrados = snapshots;
    if (filtro) {
      snapshotsFiltrados = snapshots.filter(s => {
        const cConv = (s.conv?.codigo_relatorio || '').toString().toLowerCase();
        const cPart = (s.part?.codigo_relatorio || '').toString().toLowerCase();
        return cConv.includes(filtro) || cPart.includes(filtro);
      });
    }

    return `
      <div class="impq-cards-snapshots-titulo">
        <span>📅 IMPORTADOS</span>
        <span class="impq-cards-snapshots-hint">Clique no ▶ para ver os detalhes · ✏ edita mês · 🗑 apaga snapshot</span>
      </div>
      <div class="impq-filtro-codigo-bar">
        <span class="impq-filtro-icone">🔍</span>
        <input type="text"
               id="impq-filtro-codigo"
               class="impq-filtro-codigo-input mono"
               placeholder="Filtrar por código do relatório (ex: 41897)"
               value="${escapeAttr(filtro)}"
               autocomplete="off">
        ${filtro ? `
          <span class="impq-filtro-resultados">${snapshotsFiltrados.length} de ${snapshots.length} ${snapshots.length === 1 ? 'snapshot' : 'snapshots'}</span>
          <button class="impq-filtro-limpar" id="impq-filtro-limpar" title="Limpar filtro">✕</button>
        ` : ''}
      </div>
      ${snapshotsFiltrados.length === 0 ? `
        <div class="impq-vazio">
          Nenhum snapshot encontrado com código <strong>${escapeHTML(filtro)}</strong>.
        </div>
      ` : `
        <div class="impq-cards-snapshots">
          ${snapshotsFiltrados.map(s => renderCardSnapshot(s)).join('')}
        </div>
      `}
    `;
  }

  function renderCardSnapshot(s) {
    const expandido = window.__impQvis.snapshotsExpandidos?.has(s.mes_pagamento);
    const fmtPeriodo = (d) => {
      if (!d || !d.comp_min) return '—';
      return d.comp_min === d.comp_max ? formatarComp(d.comp_min)
                                       : `${formatarComp(d.comp_min)} → ${formatarComp(d.comp_max)}`;
    };

    // Cabeçalho compacto (sempre visível)
    const codConv = s.conv?.codigo_relatorio;
    const codPart = s.part?.codigo_relatorio;
    const tagConv = s.conv
      ? (codConv
          ? `<span class="impq-tag-conv">Conv: <strong>${escapeHTML(codConv)}</strong></span>`
          : `<span class="impq-tag-conv-sem-cod">Conv: <em>sem código</em></span>`)
      : `<span class="impq-tag-vazio">sem Conv</span>`;
    const tagPart = s.part
      ? (codPart
          ? `<span class="impq-tag-part">Part: <strong>${escapeHTML(codPart)}</strong></span>`
          : `<span class="impq-tag-part-sem-cod">Part: <em>sem código</em></span>`)
      : `<span class="impq-tag-vazio">sem Part</span>`;
    const headerCompacto = `
      <div class="impq-card-snap-header" data-toggle-snap="${s.mes_pagamento}">
        <span class="impq-card-snap-seta">${expandido ? '▼' : '▶'}</span>
        <span class="impq-card-snap-mes mono">${formatarComp(s.mes_pagamento)}</span>
        <div class="impq-card-snap-tags">
          ${tagConv}
          ${tagPart}
        </div>
        <div class="impq-card-snap-acoes" onclick="event.stopPropagation()">
          <button class="impq-pgto-editar" data-edit-snap="${s.mes_pagamento}" title="Editar mês de pagamento e códigos">✏</button>
          <button class="impq-pgto-editar impq-btn-apagar" data-apagar-snap="${s.mes_pagamento}" title="Apagar este snapshot">🗑</button>
        </div>
      </div>
    `;

    // Conteúdo expandido (só se expandido = true)
    if (!expandido) {
      return `<div class="impq-card-snap impq-card-snap-colapsado">${headerCompacto}</div>`;
    }

    const renderDetalheOrigem = (label, cor, dados) => {
      if (!dados) {
        return `
          <div class="impq-detalhe-coluna impq-detalhe-vazio">
            <div class="impq-detalhe-titulo" style="color:${cor}">${label}</div>
            <div class="impq-detalhe-sem-dados">— sem dados —</div>
          </div>
        `;
      }
      return `
        <div class="impq-detalhe-coluna">
          <div class="impq-detalhe-titulo" style="color:${cor}">${label}</div>
          <div class="impq-detalhe-linha">
            <span class="impq-detalhe-lbl">Total linhas</span>
            <span class="impq-detalhe-val mono">${dados.linhas.toLocaleString('pt-BR')}</span>
          </div>
          <div class="impq-detalhe-linha">
            <span class="impq-detalhe-lbl">Admissões únicas</span>
            <span class="impq-detalhe-val mono">${dados.admissoes_unicas.toLocaleString('pt-BR')}</span>
          </div>
          <div class="impq-detalhe-linha">
            <span class="impq-detalhe-lbl">Profissionais</span>
            <span class="impq-detalhe-val mono">${dados.profissionais.toLocaleString('pt-BR')}</span>
          </div>
          <div class="impq-detalhe-linha">
            <span class="impq-detalhe-lbl">Competências</span>
            <span class="impq-detalhe-val">${fmtPeriodo(dados)}</span>
          </div>
          <div class="impq-detalhe-divisor"></div>
          <div class="impq-detalhe-linha">
            <span class="impq-detalhe-lbl">Total PRODUZIDO</span>
            <span class="impq-detalhe-val mono" style="color:#0A7A5A">R$ ${formatarBR(dados.produzido)}</span>
          </div>
          <div class="impq-detalhe-linha">
            <span class="impq-detalhe-lbl">Total RECEBIDO</span>
            <span class="impq-detalhe-val mono" style="color:#0A7A5A">R$ ${formatarBR(dados.recebido)}</span>
          </div>
          <div class="impq-detalhe-linha">
            <span class="impq-detalhe-lbl">
              Adm. c/ PRODUZIDO zero
              ${dados.adm_prod_zero > 0 ? `<button class="impq-extrair-mini" data-extrair-zero="${dados.mes_pagamento}|${dados.origem}|PRODUZIDO" title="Exportar admissões com PRODUZIDO=0">📥</button>` : ''}
            </span>
            <span class="impq-detalhe-val mono" style="color:${dados.adm_prod_zero > 0 ? '#9B3A3A' : 'var(--ink)'}">${dados.adm_prod_zero.toLocaleString('pt-BR')}</span>
          </div>
          <div class="impq-detalhe-linha">
            <span class="impq-detalhe-lbl">
              Adm. c/ RECEBIDO zero
              ${dados.adm_receb_zero > 0 ? `<button class="impq-extrair-mini" data-extrair-zero="${dados.mes_pagamento}|${dados.origem}|RECEBIDO" title="Exportar admissões com RECEBIDO=0">📥</button>` : ''}
            </span>
            <span class="impq-detalhe-val mono" style="color:${dados.adm_receb_zero > 0 ? '#143352' : 'var(--ink)'}">${dados.adm_receb_zero.toLocaleString('pt-BR')}</span>
          </div>
          ${dados.arquivo_nome ? `
            <div class="impq-detalhe-linha impq-detalhe-arquivo">
              <span class="impq-detalhe-lbl">Arquivo</span>
              <span class="impq-detalhe-val" style="font-size: 10px">${escapeHTML(dados.arquivo_nome)}</span>
            </div>
          ` : ''}
          <div class="impq-detalhe-linha">
            <span class="impq-detalhe-lbl">Código relatório QVIS</span>
            <span class="impq-detalhe-val mono">
              ${dados.codigo_relatorio
                ? `<strong>${escapeHTML(dados.codigo_relatorio)}</strong>`
                : `<em style="color:var(--ink-faint)">não informado</em>`}
            </span>
          </div>
        </div>
      `;
    };

    return `
      <div class="impq-card-snap impq-card-snap-expandido">
        ${headerCompacto}
        <div class="impq-card-snap-corpo">
          <div class="impq-detalhe-grid">
            ${renderDetalheOrigem('🏥 CONVÊNIO', '#102d4b', s.conv)}
            ${renderDetalheOrigem('💳 PARTICULAR', '#6B4587', s.part)}
          </div>
          <div class="impq-detalhe-rodape">
            <button class="btn btn-pequeno" data-recalc-snap="${s.mes_pagamento}" title="Recalcula as estatísticas a partir das linhas no banco">
              🔄 Recalcular estatísticas
            </button>
            <span class="impq-rodape-hint">Use se os valores estiverem em R$ 0,00 ou desatualizados</span>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // EVENTOS
  // ==========================================================================
  function bindEventos() {
    // Inputs hidden (clique)
    ['convenio', 'particular'].forEach(tipo => {
      const input = document.getElementById(`impq-input-${tipo}`);
      if (input) {
        // Click na zona toda abre o seletor
        const zona = document.querySelector(`[data-zona-drop="${tipo}"]`);
        if (zona) zona.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => {
          if (e.target.files && e.target.files[0]) {
            handleArquivo(tipo, e.target.files[0]);
          }
        });
      }
    });

    // Drag & drop
    ['convenio', 'particular'].forEach(tipo => {
      const zona = document.querySelector(`[data-zona-drop="${tipo}"]`);
      if (!zona) return;
      ['dragenter', 'dragover'].forEach(ev => {
        zona.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          zona.classList.add('impq-drag-hover');
        });
      });
      ['dragleave', 'drop'].forEach(ev => {
        zona.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (ev === 'dragleave') zona.classList.remove('impq-drag-hover');
        });
      });
      zona.addEventListener('drop', (e) => {
        zona.classList.remove('impq-drag-hover');
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files[0]) handleArquivo(tipo, files[0]);
      });
    });

    // Botões remover
    document.querySelectorAll('[data-remover]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tipo = btn.dataset.remover;
        if (tipo === 'convenio') window.__impQvis.arquivoConvenio = null;
        if (tipo === 'particular') window.__impQvis.arquivoParticular = null;
        renderizar();
      });
    });

    // Ver problemas
    document.querySelectorAll('.impq-ver-problemas').forEach(btn => {
      btn.addEventListener('click', () => {
        const tipo = btn.dataset.tipo;
        const arq = tipo === 'convenio' ? window.__impQvis.arquivoConvenio : window.__impQvis.arquivoParticular;
        if (!arq) return;
        alert(`Problemas detectados em "${arq.file.name}":\n\n${arq.parsed.problemas.slice(0, 50).map((p, i) => `${i+1}. ${p}`).join('\n')}${arq.parsed.problemas.length > 50 ? `\n\n... e mais ${arq.parsed.problemas.length - 50} problema(s)` : ''}`);
      });
    });

    // Cancelar / Confirmar
    const btnCancel = document.getElementById('impq-cancelar');
    if (btnCancel) btnCancel.addEventListener('click', () => {
      window.__impQvis.arquivoConvenio = null;
      window.__impQvis.arquivoParticular = null;
      renderizar();
    });
    const btnConf = document.getElementById('impq-confirmar');
    if (btnConf) btnConf.addEventListener('click', executarImportacao);

    // Select de mês de pagamento (1 por arquivo carregado)
    document.querySelectorAll('[data-mes-pgto]').forEach(sel => {
      sel.addEventListener('change', () => {
        const tipo = sel.dataset.mesPgto;
        if (tipo === 'convenio' && window.__impQvis.arquivoConvenio) {
          window.__impQvis.arquivoConvenio.mesPagamento = sel.value;
        } else if (tipo === 'particular' && window.__impQvis.arquivoParticular) {
          window.__impQvis.arquivoParticular.mesPagamento = sel.value;
        }
        // Re-renderiza só o resumo (que pode usar essa info no preview)
        renderizar();
      });
    });

    // Apagar competência específica (botão no Status atual)
    const btnApagarComp = document.getElementById('impq-apagar-comp');
    if (btnApagarComp) btnApagarComp.addEventListener('click', abrirModalApagarCompetencia);

    // Exportar Consolidado (botão no header)
    const btnExpConsolHeader = document.getElementById('impq-exp-consol-header');
    if (btnExpConsolHeader) btnExpConsolHeader.addEventListener('click', exportarConsolidado);

    // Exportar por origem (botões nos cards Convênio/Particular)
    document.querySelectorAll('[data-exp-origem]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();  // evita disparar o click do drop-zona embaixo
        const origem = btn.dataset.expOrigem === 'convenio' ? 'CONVENIO' : 'PARTICULAR';
        abrirModalExportarPorOrigem(origem);
      });
    });

    // Editar mês de pagamento de um snapshot
    document.querySelectorAll('[data-edit-snap]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirModalEditarSnapshot(btn.dataset.editSnap);
      });
    });

    // Apagar snapshot inteiro
    document.querySelectorAll('[data-apagar-snap]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirModalApagarSnapshot(btn.dataset.apagarSnap);
      });
    });

    // Toggle expandir/recolher snapshot
    document.querySelectorAll('[data-toggle-snap]').forEach(el => {
      el.addEventListener('click', (e) => {
        // Não dispara se clique foi em botão de ação
        if (e.target.closest('.impq-card-snap-acoes')) return;
        const mp = el.dataset.toggleSnap;
        const set = window.__impQvis.snapshotsExpandidos;
        if (set.has(mp)) set.delete(mp);
        else set.add(mp);
        renderizar();
      });
    });

    // Recalcular estatísticas de um snapshot
    document.querySelectorAll('[data-recalc-snap]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mp = btn.dataset.recalcSnap;
        await recalcularStatsSnapshot(mp);
      });
    });

    // Extrair admissões com PRODUZIDO ou RECEBIDO zero
    document.querySelectorAll('[data-extrair-zero]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const [mp, origem, tipo] = btn.dataset.extrairZero.split('|');
        extrairAdmissoesZero(mp, origem, tipo);
      });
    });

    // Filtro de busca por código
    const inpFiltroCod = document.getElementById('impq-filtro-codigo');
    if (inpFiltroCod) {
      inpFiltroCod.addEventListener('input', (e) => {
        window.__impQvis.filtroCodigo = e.target.value;
        // Re-renderiza só a parte do status (mais eficiente)
        renderizar();
        // Restaura foco
        const novoInp = document.getElementById('impq-filtro-codigo');
        if (novoInp) {
          novoInp.focus();
          novoInp.setSelectionRange(novoInp.value.length, novoInp.value.length);
        }
      });
    }

    const btnLimparFiltro = document.getElementById('impq-filtro-limpar');
    if (btnLimparFiltro) {
      btnLimparFiltro.addEventListener('click', () => {
        window.__impQvis.filtroCodigo = '';
        renderizar();
      });
    }

    // ── V995: filtro das LINHAS importadas ────────────────────────────────
    const btnFlt = document.getElementById('impq-btn-filtro');
    if (btnFlt) btnFlt.addEventListener('click', () => {
      const f = filtroLinhasEstado();
      f.aberto = !f.aberto;
      renderizar();
      if (f.aberto) { const primeiro = document.querySelector('[data-fqvis]'); if (primeiro) primeiro.focus(); }
    });
    // digitar re-renderiza (com atraso) e devolve o foco e o cursor ao campo
    let tmrFqvis = null;
    document.querySelectorAll('[data-fqvis]').forEach(inp => {
      inp.addEventListener('input', () => {
        clearTimeout(tmrFqvis);
        tmrFqvis = setTimeout(() => {
          const chave = inp.dataset.fqvis;
          const pos = inp.selectionStart;
          filtroLinhasEstado()[chave] = inp.value;
          renderizar();
          const novo = document.querySelector(`[data-fqvis="${chave}"]`);
          if (novo) { novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (_) {} }
        }, 300);
      });
    });
    const btnLimparLinhas = document.getElementById('impq-filtro-linhas-limpar');
    if (btnLimparLinhas) btnLimparLinhas.addEventListener('click', () => {
      Object.assign(filtroLinhasEstado(), { adm: '', pac: '', data: '', proc: '', prof: '' });
      renderizar();
    });
  }

  /**
   * Recalcula estatísticas de TODOS os snapshots com mes_pagamento = mp.
   * Apaga entradas antigas em qvis_snapshot_stats e força recálculo on-the-fly
   * via computarStatsSnapshot.
   */
  async function recalcularStatsSnapshot(mp) {
    try {
      Utilidades.toast(`Recalculando ${formatarComp(mp)}...`, 'info', 2000);
      const t0 = performance.now();

      // Para cada origem (Conv/Part) presente no snapshot, recalcula
      const origens = Banco.query(
        `SELECT DISTINCT origem FROM linhas_qvis WHERE mes_pagamento = ?`,
        [mp]
      );

      Banco.db.exec('BEGIN');
      try {
        for (const r of origens) {
          const stats = computarStatsSnapshot(r.origem, mp);
          // Pega o arquivo_nome existente (se houver)
          const existente = Banco.queryUnica(
            `SELECT arquivo_nome, importado_em, codigo_relatorio, data_pagamento FROM qvis_snapshot_stats WHERE origem = ? AND mes_pagamento = ?`,
            [r.origem, mp]
          );
          const arquivoNome = existente?.arquivo_nome || null;
          const importadoEm = existente?.importado_em || null;
          const codigoRelatorio = existente?.codigo_relatorio || null;
          const dataPagamento = existente?.data_pagamento || null;

          // Apaga e reinsere com valores corretos
          Banco.executar(
            `DELETE FROM qvis_snapshot_stats WHERE origem = ? AND mes_pagamento = ?`,
            [r.origem, mp]
          );
          const stmt = Banco.db.prepare(`
            INSERT INTO qvis_snapshot_stats
              (origem, mes_pagamento, total_linhas, total_admissoes_unicas,
               total_profissionais, total_produzido, total_recebido,
               adm_produzido_zero, adm_recebido_zero,
               competencia_min, competencia_max, arquivo_nome, codigo_relatorio, data_pagamento, importado_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          stmt.run([
            r.origem, mp,
            stats.total_linhas,
            stats.total_admissoes_unicas,
            stats.total_profissionais,
            stats.total_produzido,
            stats.total_recebido,
            stats.adm_produzido_zero,
            stats.adm_recebido_zero,
            stats.competencia_min,
            stats.competencia_max,
            arquivoNome,
            codigoRelatorio,
            dataPagamento,
            importadoEm || new Date().toISOString(),
          ]);
          stmt.free();
        }
        Banco.db.exec('COMMIT');
        await Banco.salvar({ imediato: true });
        const dur = ((performance.now() - t0) / 1000).toFixed(1);
        Utilidades.toast(`✓ Estatísticas recalculadas em ${dur}s`, 'success');
        renderizar();
      } catch (e) {
        try { Banco.db.exec('ROLLBACK'); } catch (ee) {}
        throw e;
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao recalcular: ' + e.message);
    }
  }

  /**
   * Extrai linhas das admissões que têm PRODUZIDO ou RECEBIDO = 0 em um snapshot.
   * Gera Excel com TODAS as linhas (não só as zeradas) das admissões problemáticas,
   * pra o usuário ver o contexto completo.
   */
  function extrairAdmissoesZero(mesPagamento, origem, tipo) {
    try {
      const labelOrigem = origem === 'CONVENIO' ? 'Convenio' : 'Particular';
      const campo = tipo === 'PRODUZIDO' ? 'produzido' : 'recebido';
      const labelCampo = tipo === 'PRODUZIDO' ? 'PRODUZIDO' : 'RECEBIDO';

      Utilidades.toast(`Procurando admissões com ${labelCampo}=0...`, 'info', 2000);

      // 1) Lista admissões DISTINCT que têm pelo menos 1 linha com campo = 0
      const admissoesZero = Banco.query(`
        SELECT DISTINCT admissao
        FROM linhas_qvis
        WHERE origem = ? AND mes_pagamento = ?
          AND ABS(COALESCE(${campo}, 0)) < 0.005
          AND admissao IS NOT NULL AND admissao != ''
      `, [origem, mesPagamento]);

      if (admissoesZero.length === 0) {
        alert(`Nenhuma admissão com ${labelCampo}=0 encontrada neste snapshot.`);
        return;
      }

      const admIds = admissoesZero.map(r => r.admissao);
      const placeholders = admIds.map(() => '?').join(',');

      // 2) Pega TODAS as linhas dessas admissões (não só as zeradas), com codigo_relatorio
      const linhas = Banco.query(`
        SELECT ${buildSelectExportSQL()}
        ${FROM_EXPORT_SQL}
        WHERE lq.origem = ? AND lq.mes_pagamento = ?
          AND lq.admissao IN (${placeholders})
        ORDER BY lq.admissao, lq.data_admissao
      `, [origem, mesPagamento, ...admIds]);

      if (linhas.length === 0) {
        alert('Nenhuma linha para exportar.');
        return;
      }

      // 3) Monta Excel
      const wb = XLSX.utils.book_new();

      // Aba 1: resumo
      const resumoRows = [
        ['EXPORTAÇÃO — ADMISSÕES COM ' + labelCampo + ' ZERO'],
        [],
        ['Origem',              labelOrigem],
        ['Mês de pagamento',    formatarComp(mesPagamento)],
        ['Admissões distintas', admIds.length],
        ['Total de linhas',     linhas.length],
        ['Gerado em',           new Date().toLocaleString('pt-BR')],
        [],
        ['Observação',          'Estão TODAS as linhas dessas admissões (incluindo as não-zeradas), para você ver o contexto completo.'],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumoRows), 'Resumo');

      // Aba 2: dados
      const dataRows = [COLS_EXPORT.map(c => c[1])];
      for (const l of linhas) dataRows.push(COLS_EXPORT.map(c => l[c[0]] ?? ''));
      const nomeAba = `Adm ${labelCampo === 'PRODUZIDO' ? 'Prod' : 'Receb'} Zero`.slice(0, 31);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dataRows), nomeAba);

      const nomeArquivo = `Admissoes_${labelCampo}_Zero_${labelOrigem}_Pgto_${mesPagamento}.xlsx`;
      XLSX.writeFile(wb, nomeArquivo);
      Utilidades.toast(`✓ Exportadas ${linhas.length.toLocaleString('pt-BR')} linhas de ${admIds.length} admissões`, 'success');
    } catch (e) {
      console.error(e);
      alert('Erro ao exportar: ' + e.message);
    }
  }

  // ==========================================================================
  // PROCESSAMENTO DO ARQUIVO
  // ==========================================================================
  async function handleArquivo(tipo, file) {
    if (!file.name.toLowerCase().endsWith('.xlsx') && !file.name.toLowerCase().endsWith('.xls')) {
      alert('Arquivo precisa ser .xlsx ou .xls');
      return;
    }

    Utilidades.toast(`Analisando "${file.name}"...`, 'info', 2000);
    try {
      // FASE 1: análise da estrutura
      const analise = await analisarEstrutura(file);

      // Se faltam ESSENCIAIS: bloqueia (mensagem clara)
      if (analise.faltandoEssenciais.length > 0) {
        alert(
          `❌ Não é possível importar este arquivo\n\n` +
          `As seguintes colunas ESSENCIAIS não foram encontradas:\n` +
          `• ${analise.faltandoEssenciais.join('\n• ')}\n\n` +
          `Sem elas, o cálculo de repasse fica impossível. Verifique se o arquivo é um relatório QVIS válido.`
        );
        return;
      }

      // Se faltou a coluna de origem (TIPO RECEBIMENTO / FONTE PAGADORA): bloqueia
      if (analise.faltandoOrigem) {
        alert(
          `❌ Não foi possível identificar a origem dos dados\n\n` +
          `Nenhuma das colunas aceitas foi encontrada:\n` +
          `• TIPO RECEBIMENTO\n• FONTE PAGADORA\n\n` +
          `É necessária uma dessas colunas para identificar se a linha é de Convênio ou Particular.`
        );
        return;
      }

      // Se há colunas opcionais faltando OU colunas novas: abre modal pro usuário decidir
      const precisaConfirmar = analise.faltandoOpcionais.length > 0 || analise.novasColunas.length > 0;

      if (precisaConfirmar) {
        const usuarioAceitou = await mostrarModalAnalise(file, analise);
        if (!usuarioAceitou) return;  // cancelou
      }

      // FASE 2: processa as linhas com o mapeamento aprovado
      Utilidades.toast(`Lendo ${file.name}...`, 'info', 2000);
      const parsed = processarLinhas(analise);

      // Detecta origem do arquivo (CONVENIO ou PARTICULAR) pelo TIPO RECEBIMENTO/FONTE PAGADORA predominante
      const origemDetectada = parsed.origemPredominante;
      const origemEsperada = tipo === 'convenio' ? 'CONVENIO' : 'PARTICULAR';

      if (origemDetectada !== origemEsperada) {
        const confirma = confirm(
          `⚠ Aviso de detecção automática\n\n` +
          `Você está enviando este arquivo como "${origemEsperada}", mas o conteúdo parece ser de "${origemDetectada}".\n\n` +
          `Isso pode ser um arquivo trocado.\n\nDeseja continuar mesmo assim?`
        );
        if (!confirma) return;
      }

      const ultimaComp = Array.from(parsed.competencias.keys()).sort().pop();
      const mesPagamento = sugerirMesPagamento(ultimaComp);

      // Solicita código do relatório (obrigatório) + data de pagamento (opcional)
      const resultado = await pedirCodigoRelatorio(file.name, tipo);
      if (resultado === null) {
        // Usuário cancelou
        return;
      }
      const codigoRelatorio = resultado.codigo;
      const dataPagamento = resultado.dataPagamento;

      if (tipo === 'convenio')   window.__impQvis.arquivoConvenio   = { file, parsed, mesPagamento, analise, codigoRelatorio, dataPagamento };
      else                       window.__impQvis.arquivoParticular = { file, parsed, mesPagamento, analise, codigoRelatorio, dataPagamento };
      renderizar();
    } catch (e) {
      console.error(e);
      alert(`Erro ao processar arquivo:\n\n${e.message}`);
    }
  }

  /**
   * Modal pra pedir o código do relatório QVIS + data de pagamento.
   * Retorna Promise<{codigo, dataPagamento}|null>.
   * Código é obrigatório, data de pagamento é opcional.
   */
  function pedirCodigoRelatorio(arquivoNome, tipo, codigoAtual = '', dataAtual = '') {
    return new Promise((resolve) => {
      const labelOrigem = tipo === 'convenio' ? 'Convênio' : 'Particular';
      const corOrigem = tipo === 'convenio' ? '#102d4b' : '#6B4587';
      const isEdicao = !!codigoAtual;

      const overlay = document.createElement('div');
      overlay.className = 'impq-modal-overlay';
      overlay.innerHTML = `
        <div class="impq-modal" style="max-width: 460px">
          <div class="impq-modal-header">
            <h3>🔢 ${isEdicao ? 'Editar' : 'Informar'} código do relatório</h3>
            <button class="impq-modal-close" data-close>×</button>
          </div>
          <div class="impq-modal-body">
            <div class="impq-codigo-info">
              <div class="impq-codigo-linha">
                <span class="impq-codigo-lbl">Origem:</span>
                ${Utilidades.badgeFonte(tipo === 'convenio' ? 'CONVENIO' : 'PARTICULAR')}<!-- V947 -->
              </div>
              <div class="impq-codigo-linha">
                <span class="impq-codigo-lbl">Arquivo:</span>
                <strong style="font-size: 11px">${escapeHTML(arquivoNome)}</strong>
              </div>
            </div>

            <div class="impq-codigo-campo">
              <label class="impq-codigo-label">Código do relatório QVIS *</label>
              <input type="text"
                     id="impq-codigo-input"
                     class="impq-codigo-input mono"
                     placeholder="Ex: 41897"
                     value="${escapeAttr(codigoAtual)}"
                     autocomplete="off">
              <div class="impq-codigo-hint">Esse código identifica unicamente o relatório no sistema QVIS.</div>
            </div>

            <div class="impq-codigo-campo">
              <label class="impq-codigo-label">
                Data de pagamento aos médicos
                <span class="impq-data-alerta" title="Importante! Registre a data exata em que o ATLAS pagou os médicos deste relatório. Pode deixar em branco se ainda não houve pagamento.">!</span>
              </label>
              <input type="date"
                     id="impq-data-input"
                     class="impq-codigo-input mono"
                     value="${escapeAttr(dataAtual)}"
                     autocomplete="off">
              <div class="impq-codigo-hint">Data em que o ATLAS efetivou o pagamento aos médicos (opcional, mas importante pra rastreio).</div>
            </div>

            <div class="impq-aviso-modal" id="impq-codigo-erro" style="display:none">
              ⛔ <span id="impq-codigo-erro-msg">Código é obrigatório.</span>
            </div>
          </div>
          <div class="impq-modal-footer">
            <button class="btn btn-pequeno" data-close>Cancelar</button>
            <button class="btn btn-primary" id="impq-codigo-confirmar">${isEdicao ? '💾 Salvar' : '✓ Continuar'}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('#impq-codigo-input');
      const inputData = overlay.querySelector('#impq-data-input');
      const erroBox = overlay.querySelector('#impq-codigo-erro');
      const erroMsg = overlay.querySelector('#impq-codigo-erro-msg');
      const btnOk = overlay.querySelector('#impq-codigo-confirmar');

      setTimeout(() => input.focus(), 50);

      const finalizar = (valor) => {
        overlay.remove();
        resolve(valor);
      };
      overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => finalizar(null)));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finalizar(null); });

      function confirmar() {
        const v = input.value.trim();
        if (!v) {
          erroMsg.textContent = 'Código é obrigatório.';
          erroBox.style.display = 'block';
          input.focus();
          return;
        }
        if (v.length > 50) {
          erroMsg.textContent = 'Código não pode ter mais de 50 caracteres.';
          erroBox.style.display = 'block';
          return;
        }
        const dataPagto = inputData.value.trim() || null;
        finalizar({ codigo: v, dataPagamento: dataPagto });
      }

      btnOk.addEventListener('click', confirmar);
      [input, inputData].forEach(el => {
        el.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            confirmar();
          }
        });
      });
      input.addEventListener('input', () => {
        erroBox.style.display = 'none';
      });
    });
  }

  /**
   * Modal de confirmação da análise de estrutura.
   * Mostra o que foi encontrado, o que falta, colunas novas.
   * Retorna Promise<bool>: true = continuar, false = cancelar.
   */
  function mostrarModalAnalise(file, analise) {
    return new Promise((resolve) => {
      const totalLinhas = analise.matriz.length - 1;
      const essenciais = analise.encontradas.filter(e => e.nivel === NIVEL_ESSENCIAL);
      const origem = analise.encontradas.filter(e => e.nivel === NIVEL_ORIGEM);
      const opcionaisOk = analise.encontradas.filter(e => e.nivel === NIVEL_OPCIONAL);

      const overlay = document.createElement('div');
      overlay.className = 'impq-modal-overlay';
      overlay.innerHTML = `
        <div class="impq-modal" style="max-width: 640px">
          <div class="impq-modal-header">
            <h3>🔍 Análise do arquivo</h3>
            <button class="impq-modal-close" data-close>×</button>
          </div>
          <div class="impq-modal-body">
            <div class="impq-analise-arquivo">
              📄 <strong>${escapeHTML(file.name)}</strong>
              <span class="impq-analise-meta">${totalLinhas.toLocaleString('pt-BR')} linhas · aba "${escapeHTML(analise.sheetName)}"</span>
            </div>

            <!-- Essenciais (sempre OK aqui — caso contrário já bloqueou antes) -->
            <div class="impq-analise-secao impq-secao-ok">
              <div class="impq-analise-titulo">
                ✅ Colunas Essenciais
                <span class="impq-analise-count">${essenciais.length}/${essenciais.length}</span>
              </div>
              <div class="impq-analise-lista">
                ${essenciais.map(e => `<span class="impq-coluna-ok">✓ ${escapeHTML(e.headerCanonico)}</span>`).join('')}
              </div>
            </div>

            <!-- Origem identificada -->
            <div class="impq-analise-secao impq-secao-ok">
              <div class="impq-analise-titulo">
                🟡 Origem detectada via
                <span class="impq-analise-count">${origem.length > 0 ? '✓' : '—'}</span>
              </div>
              <div class="impq-analise-lista">
                ${origem.map(e => `
                  <span class="impq-coluna-ok">✓ ${escapeHTML(e.header)}</span>
                `).join('')}
                <div class="impq-coluna-hint">Outros relatórios podem usar nomes diferentes (TIPO RECEBIMENTO ou FONTE PAGADORA) — ambos aceitos.</div>
              </div>
            </div>

            <!-- Opcionais faltando -->
            ${analise.faltandoOpcionais.length > 0 ? `
              <div class="impq-analise-secao impq-secao-aviso">
                <div class="impq-analise-titulo">
                  ⚠ Colunas Opcionais NÃO encontradas
                  <span class="impq-analise-count">${analise.faltandoOpcionais.length}</span>
                </div>
                <div class="impq-analise-descricao">
                  Estas colunas não vieram no arquivo. As linhas correspondentes serão salvas com valor <strong>vazio</strong> nessas colunas:
                </div>
                <div class="impq-analise-lista">
                  ${analise.faltandoOpcionais.map(c => `<span class="impq-coluna-faltando">${escapeHTML(c)}</span>`).join('')}
                </div>
              </div>
            ` : ''}

            <!-- Colunas novas/desconhecidas -->
            ${analise.novasColunas.length > 0 ? `
              <div class="impq-analise-secao impq-secao-novo">
                <div class="impq-analise-titulo">
                  🆕 Colunas Novas (não reconhecidas)
                  <span class="impq-analise-count">${analise.novasColunas.length}</span>
                </div>
                <div class="impq-analise-descricao">
                  Estas colunas estão no arquivo mas o app não as conhece. Elas serão <strong>ignoradas</strong> na importação. Se for importante, me avise para incluí-las no schema.
                </div>
                <div class="impq-analise-lista">
                  ${analise.novasColunas.map(c => `<span class="impq-coluna-nova">${escapeHTML(c)}</span>`).join('')}
                </div>
              </div>
            ` : ''}

            <!-- Opcionais OK (collapse, só se quiser ver) -->
            ${opcionaisOk.length > 0 ? `
              <details class="impq-analise-detalhes">
                <summary>Ver ${opcionaisOk.length} colunas opcionais reconhecidas</summary>
                <div class="impq-analise-lista" style="margin-top: 8px">
                  ${opcionaisOk.map(e => `<span class="impq-coluna-ok">✓ ${escapeHTML(e.headerCanonico)}</span>`).join('')}
                </div>
              </details>
            ` : ''}
          </div>
          <div class="impq-modal-footer">
            <button class="btn btn-pequeno" data-close>Cancelar</button>
            <button class="btn btn-primary" id="impq-analise-continuar">Continuar importação</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const finalizar = (ok) => {
        overlay.remove();
        resolve(ok);
      };
      overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => finalizar(false)));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finalizar(false); });
      overlay.querySelector('#impq-analise-continuar').addEventListener('click', () => finalizar(true));
    });
  }

  /**
   * Lê um .xlsx e retorna:
   *   { linhas: [...], competencias: Map<comp, count>, problemas: [...],
   *     profissionais: Set, admissoes: Set, origemPredominante: 'CONVENIO'|'PARTICULAR' }
   * Cada linha já vem com a origem da PRÓPRIA linha (TIPO RECEBIMENTO).
   */
  /**
   * Normaliza um nome de coluna pra comparação tolerante:
   *  - UPPER
   *  - Remove acentos
   *  - Espaços múltiplos → único
   *  - Trim
   */
  function normalizarHeader(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // remove acentos
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * FASE 1 — Analisa só a estrutura do arquivo (header).
   * Retorna um diagnóstico que o usuário precisa confirmar antes da importação.
   *
   * Resultado:
   *  {
   *    workbook, sheetName, header,           // pra reusar depois
   *    mapeamento: { chave: idx },            // chave → índice no header
   *    encontradas: [{chave, nivel, header}], // colunas reconhecidas
   *    faltandoEssenciais: [chave],           // essenciais não encontradas (BLOQUEIA)
   *    faltandoOrigem: bool,                  // se nenhuma coluna de origem foi achada
   *    faltandoOpcionais: [chave],            // opcionais não encontradas (avisa)
   *    novasColunas: [header],                // colunas no arquivo NÃO mapeadas
   *  }
   */
  async function analisarEstrutura(file) {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });

    // Escolhe a aba — antigo formato tinha "ITENS DO REPASSE"; novo tem "Planilha1"
    // Heurística: prefere a aba que tem "ITENS" e "REPASSE"; se não, usa a primeira.
    const sheetName = wb.SheetNames.find(n => /ITENS/i.test(n) && /REPASSE/i.test(n)) || wb.SheetNames[0];
    if (!sheetName) throw new Error('Arquivo não tem nenhuma planilha legível.');
    const sheet = wb.Sheets[sheetName];

    // Lê só o cabeçalho (range A1:?1)
    // raw=true preserva Date objects (graças ao cellDates=true).
    // Isso é mais robusto que dateNF que pode causar problemas de formato.
    const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    if (matriz.length < 2) throw new Error(`A planilha "${sheetName}" está vazia.`);
    const header = matriz[0].map(h => String(h || '').trim());
    const headerNorm = header.map(h => normalizarHeader(h));

    // Mapeia: pra cada entrada do catálogo, procura no header se algum dos
    // nomes aceitos bate.
    const mapeamento = {};
    const encontradas = [];
    const faltandoEssenciais = [];
    const faltandoOpcionais = [];
    let achouOrigem = false;

    for (const entry of CATALOGO_COLUNAS) {
      let idx = -1;
      let headerMatchado = null;
      for (const aceito of entry.aceita) {
        const aceitoNorm = normalizarHeader(aceito);
        const i = headerNorm.indexOf(aceitoNorm);
        if (i !== -1) {
          idx = i;
          headerMatchado = header[i];
          break;
        }
      }
      if (idx !== -1) {
        mapeamento[entry.chave] = idx;
        encontradas.push({ chave: entry.chave, nivel: entry.nivel, header: headerMatchado, headerCanonico: entry.aceita[0] });
        if (entry.nivel === NIVEL_ORIGEM) achouOrigem = true;
      } else {
        if (entry.nivel === NIVEL_ESSENCIAL) faltandoEssenciais.push(entry.aceita[0]);
        else if (entry.nivel === NIVEL_OPCIONAL) faltandoOpcionais.push(entry.aceita[0]);
      }
    }

    // Detecta colunas no arquivo que NÃO estão em nenhuma entrada do catálogo
    const headersReconhecidos = new Set();
    for (const ent of CATALOGO_COLUNAS) {
      for (const a of ent.aceita) headersReconhecidos.add(normalizarHeader(a));
    }
    const novasColunas = [];
    const seenColumns = new Set();
    header.forEach((h, i) => {
      const norm = headerNorm[i];
      if (!norm) return;  // coluna vazia
      if (seenColumns.has(norm)) return;
      seenColumns.add(norm);
      if (!headersReconhecidos.has(norm)) {
        // Algumas variações comuns que devemos ignorar silenciosamente
        // (duplicatas internas dos relatórios QVIS — PAPEL.1 etc)
        if (/^PAPEL\.?\d+$/.test(norm)) return;
        novasColunas.push(h);
      }
    });

    return {
      wb,
      sheetName,
      header,
      matriz,  // já cache pra processar depois
      mapeamento,
      encontradas,
      faltandoEssenciais,
      faltandoOrigem: !achouOrigem,
      faltandoOpcionais,
      novasColunas,
    };
  }

  /**
   * FASE 2 — Processa as linhas conforme o mapeamento já aprovado pelo usuário.
   * Recebe o resultado da fase 1 + flags do que o usuário aceitou.
   */
  function processarLinhas(analise) {
    const { matriz, mapeamento } = analise;

    const linhas = [];
    const competencias = new Map();
    const problemas = [];
    const profissionais = new Set();
    const admissoes = new Set();
    const contagemOrigem = { CONVENIO: 0, PARTICULAR: 0 };

    for (let i = 1; i < matriz.length; i++) {
      const row = matriz[i];
      if (!row || row.length === 0) continue;
      const algumaPreenchida = row.some(v => v !== null && v !== undefined && String(v).trim() !== '');
      if (!algumaPreenchida) continue;

      const obj = {};

      // Pega valores de TODAS as chaves do catálogo (mesmo as não mapeadas → null)
      for (const entry of CATALOGO_COLUNAS) {
        const idx = mapeamento[entry.chave];
        if (idx === undefined || idx === -1) {
          obj[entry.chave] = null;  // não veio nessa planilha
        } else {
          const v = row[idx];
          obj[entry.chave] = (v === undefined || v === null) ? null : v;
        }
      }

      // Validação: campos obrigatórios
      if (!obj.admissao && !obj.nome_profissional) {
        problemas.push(`Linha ${i + 1}: sem ADMISSAO nem NOME PROFISSIONAL — ignorada.`);
        continue;
      }

      // Trata data_admissao: pode vir como Date (raw=true + cellDates=true),
      // como string ISO, como serial number do Excel, ou como string br dd/mm/yyyy.
      let dataStr = '';
      const rawData = obj.data_admissao;
      if (rawData instanceof Date && !isNaN(rawData.getTime())) {
        const d = rawData;
        dataStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
      } else if (typeof rawData === 'number') {
        // Serial Excel (raro com cellDates=true mas pode acontecer)
        // V491: getters UTC — o serial é convertido em ms UTC; com getters locais,
        // em UTC-3 a data voltava 3h (véspera às 21:00) e mudava a competência.
        const d = new Date(Math.round((rawData - 25569) * 86400 * 1000));
        if (!isNaN(d.getTime())) {
          dataStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
        }
      } else if (rawData) {
        const s = String(rawData).trim();
        // Tenta dd/mm/yyyy
        const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
        if (m) {
          const dia = m[1].padStart(2, '0');
          const mes = m[2].padStart(2, '0');
          const ano = m[3];
          const hh = (m[4] || '00').padStart(2, '0');
          const mm = (m[5] || '00').padStart(2, '0');
          const ss = (m[6] || '00').padStart(2, '0');
          dataStr = `${ano}-${mes}-${dia} ${hh}:${mm}:${ss}`;
        } else {
          dataStr = s;
        }
      }
      obj.data_admissao = dataStr;

      // Deriva competência YYYY-MM
      let comp = null;
      if (dataStr.length >= 7) {
        const m = dataStr.match(/^(\d{4})-(\d{2})/);
        if (m) comp = `${m[1]}-${m[2]}`;
      }
      if (!comp) {
        problemas.push(`Linha ${i + 1}: DATA ADMISSAO inválida ou vazia ('${dataStr}') — competência não detectada.`);
        continue;
      }
      obj.competencia = comp;
      competencias.set(comp, (competencias.get(comp) || 0) + 1);

      // Detecta origem da linha:
      //  - via tipo_recebimento (que aceita TIPO RECEBIMENTO ou FONTE PAGADORA)
      const tipoReceb = String(obj.tipo_recebimento || '').toUpperCase().trim();
      let origem = 'CONVENIO';
      if (tipoReceb === 'PARTICULAR') origem = 'PARTICULAR';
      else if (tipoReceb === 'CONVÊNIO' || tipoReceb === 'CONVENIO') origem = 'CONVENIO';
      obj.origem = origem;
      contagemOrigem[origem]++;

      // Converte campos numéricos
      obj.quantidade = parseNum(obj.quantidade) || 1;
      obj.produzido  = parseNum(obj.produzido) || 0;
      obj.honorario  = parseNum(obj.honorario) || 0;
      obj.recebido   = parseNum(obj.recebido) || 0;
      obj.repassado  = parseNum(obj.repassado) || 0;
      obj.novo_valor = parseNum(obj.novo_valor);

      // Stringify códigos
      ['admissao', 'cod_paciente', 'conta', 'envio', 'cod_unidade_faturamento', 'cod_repasse', 'cod_regra_repasse'].forEach(k => {
        if (obj[k] !== null && obj[k] !== undefined) {
          let s = String(obj[k]).trim();
          if (s.endsWith('.0')) s = s.slice(0, -2);
          obj[k] = s;
        }
      });

      // Strings simples
      ['nome_profissional', 'papel', 'procedimento', 'convenio', 'unidade_faturamento',
       'unidade_atendimento', 'destino', 'estado', 'paciente', 'tipo_paciente',
       'especialidade', 'tipo_recebimento', 'classificacao_produto'].forEach(k => {
        if (obj[k] !== null && obj[k] !== undefined) {
          obj[k] = String(obj[k]).trim();
        }
      });

      // Normalização (UPPER + espaços únicos + trim)
      obj.nome_normalizado = obj.nome_profissional
        ? obj.nome_profissional.toUpperCase().replace(/\s+/g, ' ').trim()
        : null;
      obj.procedimento_normalizado = obj.procedimento
        ? obj.procedimento.toUpperCase().replace(/\s+/g, ' ').trim()
        : null;

      if (obj.nome_normalizado) profissionais.add(obj.nome_normalizado);
      if (obj.admissao) admissoes.add(obj.admissao);

      linhas.push(obj);
    }

    const origemPredominante = contagemOrigem.CONVENIO >= contagemOrigem.PARTICULAR
      ? 'CONVENIO' : 'PARTICULAR';

    // ── Agregados (soma SIMPLES, sem dedupe) ────────────────────────────
    // O usuário quer a soma direta de TODAS as linhas, igual a fazer
    // SOMA() na coluna PRODUZIDO/RECEBIDO no Excel original.
    //
    // Para "Admissões c/ PRODUZIDO zero":
    //   - Conta admissões DISTINTAS que têm PELO MENOS 1 linha com produzido=0
    //   - Ou seja: admissão que tem algum procedimento não-faturado
    //   - Uma admissão é contada apenas 1 vez, mesmo que tenha N linhas zeradas
    let totalProduzido = 0;
    let totalRecebido = 0;
    const admissoesComProdZero = new Set();
    const admissoesComRecebZero = new Set();

    const TOL = 0.005;  // 1 centavo de tolerância para floats

    for (const l of linhas) {
      const p = Number(l.produzido) || 0;
      const r = Number(l.recebido) || 0;
      totalProduzido += p;
      totalRecebido += r;
      if (l.admissao) {
        if (Math.abs(p) < TOL) admissoesComProdZero.add(l.admissao);
        if (Math.abs(r) < TOL) admissoesComRecebZero.add(l.admissao);
      }
    }

    const linhasProduzidoZero = admissoesComProdZero.size;
    const linhasRecebidoZero  = admissoesComRecebZero.size;

    return {
      linhas,
      competencias,
      problemas,
      profissionais,
      admissoes,
      origemPredominante,
      estatisticas: {
        totalProduzido,
        totalRecebido,
        admissoesUnicas: admissoes.size,
        linhasProduzidoZero,
        linhasRecebidoZero,
      },
    };
  }

  function parseNum(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    // V491: só trata ponto como milhar quando HÁ vírgula — antes uma célula-texto
    // "1234.56" em PRODUZIDO/RECEBIDO virava 123456 (100× o valor, silencioso).
    let s = String(v).trim();
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  // ==========================================================================
  // EXECUÇÃO DA IMPORTAÇÃO
  // ==========================================================================
  async function executarImportacao() {
    if (window.__impQvis.processando) return;
    window.__impQvis.processando = true;
    renderizar();

    const ac = window.__impQvis.arquivoConvenio;
    const ap = window.__impQvis.arquivoParticular;
    if (!ac && !ap) {
      window.__impQvis.processando = false;
      renderizar();
      return;
    }

    try {
      const t0 = performance.now();
      Banco.db.exec('BEGIN');

      try {
        // Para cada arquivo, processa em lote:
        //   1) DELETE linhas existentes da combinação (origem, competencia)
        //   2) INSERT novas linhas
        let totalInseridas = 0;
        let totalRemovidas = 0;

        const processarArquivo = (arq) => {
          if (!arq) return;
          const { linhas, competencias } = arq.parsed;
          if (linhas.length === 0) return;

          const mesPagamento = arq.mesPagamento;
          if (!mesPagamento) {
            throw new Error(`Arquivo ${arq.file.name} sem mês de pagamento definido.`);
          }

          // Aplica mes_pagamento (escolhido pelo usuário) em todas as linhas
          for (const l of linhas) {
            l.mes_pagamento = mesPagamento;
          }

          // Origem do arquivo (todas as linhas têm a mesma origem)
          const origemArquivo = linhas[0].origem;

          // Snapshot = (origem + mes_pagamento). Se já existe snapshot
          // com esse mesmo mes_pagamento + origem, substitui (DELETE antes do INSERT).
          // Snapshots de OUTROS meses de pagamento são preservados — modelo
          // multi-snapshot acumulativo.
          const res = Banco.db.exec(
            `SELECT COUNT(*) FROM linhas_qvis WHERE origem = '${origemArquivo}' AND mes_pagamento = '${mesPagamento}'`
          );
          const n = res.length > 0 && res[0].values.length > 0 ? res[0].values[0][0] : 0;
          totalRemovidas += n;
          Banco.db.exec(
            `DELETE FROM linhas_qvis WHERE origem = '${origemArquivo}' AND mes_pagamento = '${mesPagamento}'`
          );

          // INSERT em lote via prepared statement
          const cols = [
            'origem', 'competencia', 'nome_profissional', 'nome_normalizado',
            'papel', 'procedimento', 'procedimento_normalizado', 'quantidade',
            'convenio', 'unidade_faturamento', 'unidade_atendimento',
            'destino', 'estado', 'admissao', 'data_admissao',
            'paciente', 'cod_paciente', 'conta', 'envio',
            'produzido', 'honorario', 'recebido', 'repassado',
            'tipo_paciente', 'especialidade', 'tipo_recebimento',
            'classificacao_produto', 'cod_unidade_faturamento',
            'cod_repasse', 'cod_regra_repasse', 'novo_valor',
            'mes_pagamento',
          ];
          const placeholders = cols.map(() => '?').join(',');
          const stmt = Banco.db.prepare(`INSERT INTO linhas_qvis (${cols.join(',')}) VALUES (${placeholders})`);
          for (const l of linhas) {
            const params = cols.map(c => {
              const v = l[c];
              if (v === null || v === undefined) return null;
              if (typeof v === 'number') return v;
              return String(v);
            });
            stmt.run(params);
            totalInseridas++;
          }
          stmt.free();

          // Salva estatísticas pré-calculadas deste snapshot
          const est = arq.parsed.estatisticas || {};
          const comps = Array.from(arq.parsed.competencias.keys()).sort();
          const compMin = comps[0] || null;
          const compMax = comps[comps.length - 1] || null;
          const stmtStats = Banco.db.prepare(`
            INSERT INTO qvis_snapshot_stats
              (origem, mes_pagamento, total_linhas, total_admissoes_unicas,
               total_profissionais, total_produzido, total_recebido,
               adm_produzido_zero, adm_recebido_zero,
               competencia_min, competencia_max, arquivo_nome, codigo_relatorio, data_pagamento, importado_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(origem, mes_pagamento) DO UPDATE SET
              total_linhas = excluded.total_linhas,
              total_admissoes_unicas = excluded.total_admissoes_unicas,
              total_profissionais = excluded.total_profissionais,
              total_produzido = excluded.total_produzido,
              total_recebido = excluded.total_recebido,
              adm_produzido_zero = excluded.adm_produzido_zero,
              adm_recebido_zero = excluded.adm_recebido_zero,
              competencia_min = excluded.competencia_min,
              competencia_max = excluded.competencia_max,
              arquivo_nome = excluded.arquivo_nome,
              codigo_relatorio = excluded.codigo_relatorio,
              data_pagamento = excluded.data_pagamento,
              importado_em = CURRENT_TIMESTAMP
          `);
          stmtStats.run([
            origemArquivo,
            mesPagamento,
            linhas.length,
            est.admissoesUnicas || 0,
            arq.parsed.profissionais.size,
            est.totalProduzido || 0,
            est.totalRecebido || 0,
            est.linhasProduzidoZero || 0,
            est.linhasRecebidoZero || 0,
            compMin,
            compMax,
            arq.file.name,
            arq.codigoRelatorio || null,
            arq.dataPagamento || null,
          ]);
          stmtStats.free();
        };

        processarArquivo(ac);
        processarArquivo(ap);

        Banco.db.exec('COMMIT');
        // Normaliza espaços múltiplos (segurança contra dados antigos importados
        // com versões anteriores do importador sem normalização)
        try { Banco._normalizarEspacosQVIS(); } catch (e) { console.warn(e); }
        await Banco.salvar({ imediato: true });

        const t1 = performance.now();
        const dur = ((t1 - t0) / 1000).toFixed(1);
        const msg = `✓ Importação concluída!\n\n` +
          `• ${totalInseridas.toLocaleString('pt-BR')} linhas inseridas\n` +
          `• ${totalRemovidas.toLocaleString('pt-BR')} linhas substituídas\n` +
          `• Tempo: ${dur}s`;
        alert(msg);

        // Limpa estado e re-renderiza com status atualizado
        window.__impQvis.arquivoConvenio = null;
        window.__impQvis.arquivoParticular = null;
      } catch (e) {
        Banco.db.exec('ROLLBACK');
        throw e;
      }
    } catch (e) {
      console.error(e);
      alert(`❌ Erro durante a importação:\n\n${e.message}\n\nNenhuma alteração foi salva.`);
    }

    window.__impQvis.processando = false;
    renderizar();
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================
  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHTML(s); }

  function formatarBR(n) {
    if (n === null || n === undefined || isNaN(n)) return '0,00';
    return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatarComp(c) {
    if (!c) return '—';
    const [a, m] = c.split('-');
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return `${meses[Number(m) - 1] || m}/${a}`;
  }

  function obterAnoMesAtual() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Mês de pagamento sugerido: 1 mês após a maior competência detectada.
   * Ex: arquivo tem competências até Abr/2026 → sugere pagamento em Mai/2026.
   */
  function sugerirMesPagamento(comp) {
    if (!comp) return obterAnoMesAtual();
    const [a, m] = comp.split('-').map(Number);
    let mp = m + 1, ap = a;
    if (mp > 12) { mp = 1; ap = a + 1; }
    return `${ap}-${String(mp).padStart(2, '0')}`;
  }

  /**
   * Gera opções para o select de mês de pagamento: 12 meses antes + 12 depois
   * da competência de referência, ordem decrescente (mais recente primeiro).
   */
  function gerarOpcoesMesPagamento(compRef) {
    if (!compRef) compRef = obterAnoMesAtual();
    const [a0, m0] = compRef.split('-').map(Number);
    const opcoes = [];
    for (let delta = -12; delta <= 12; delta++) {
      let m = m0 + delta;
      let a = a0;
      while (m <= 0) { m += 12; a--; }
      while (m > 12) { m -= 12; a++; }
      const valor = `${a}-${String(m).padStart(2, '0')}`;
      opcoes.push({ valor, label: formatarComp(valor) });
    }
    // Mais recente primeiro
    return opcoes.sort((x, y) => y.valor.localeCompare(x.valor));
  }

  // ==========================================================================
  // APAGAR COMPETÊNCIA
  // ==========================================================================
  function abrirModalApagarCompetencia() {
    const snapshots = Banco.query(`
      SELECT mes_pagamento,
             SUM(CASE WHEN origem = 'CONVENIO' THEN 1 ELSE 0 END) AS conv,
             SUM(CASE WHEN origem = 'PARTICULAR' THEN 1 ELSE 0 END) AS part,
             COUNT(*) AS total
      FROM linhas_qvis
      WHERE mes_pagamento IS NOT NULL AND mes_pagamento != ''
      GROUP BY mes_pagamento
      ORDER BY mes_pagamento DESC
    `);
    if (snapshots.length === 0) {
      alert('Não há dados QVIS para apagar.');
      return;
    }

    // Cria modal
    const overlay = document.createElement('div');
    overlay.className = 'impq-modal-overlay';
    overlay.innerHTML = `
      <div class="impq-modal">
        <div class="impq-modal-header">
          <h3>🗑 Apagar snapshot</h3>
          <button class="impq-modal-close" data-close>×</button>
        </div>
        <div class="impq-modal-body">
          <p class="impq-modal-texto">
            Selecione o snapshot (mês de pagamento) cujos dados serão apagados. Convênio + Particular do mesmo mês de pagamento serão apagados juntos.
          </p>
          <div class="impq-comp-lista">
            ${snapshots.map(p => `
              <label class="impq-comp-linha">
                <input type="radio" name="impq-comp-apagar" value="${p.mes_pagamento}">
                <span class="impq-comp-nome">${formatarComp(p.mes_pagamento)}</span>
                <span class="impq-comp-tags">
                  <span class="impq-tag-conv">${p.conv.toLocaleString('pt-BR')} Conv</span>
                  <span class="impq-tag-part">${p.part.toLocaleString('pt-BR')} Part</span>
                  <span class="impq-tag-total mono">${p.total.toLocaleString('pt-BR')} linhas</span>
                </span>
              </label>
            `).join('')}
          </div>
          <div class="impq-aviso-modal">
            ⚠ Esta ação é permanente e não pode ser desfeita. Os dados de outros snapshots (outros meses de pagamento) não serão afetados.
          </div>
        </div>
        <div class="impq-modal-footer">
          <button class="btn btn-pequeno" data-close>Cancelar</button>
          <button class="btn btn-perigo" id="impq-modal-confirmar-apagar" disabled>Apagar snapshot</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const fechar = () => overlay.remove();
    overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', fechar));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });

    const btnConf = overlay.querySelector('#impq-modal-confirmar-apagar');
    overlay.querySelectorAll('input[name="impq-comp-apagar"]').forEach(r => {
      r.addEventListener('change', () => { btnConf.disabled = false; });
    });

    btnConf.addEventListener('click', async () => {
      const escolhido = overlay.querySelector('input[name="impq-comp-apagar"]:checked');
      if (!escolhido) return;
      const mesPgto = escolhido.value;
      const info = snapshots.find(p => p.mes_pagamento === mesPgto);
      if (!confirm(
        `Tem certeza?\n\n` +
        `Vai apagar PERMANENTEMENTE o snapshot de ${formatarComp(mesPgto)}:\n` +
        `• ${info.total.toLocaleString('pt-BR')} linhas no total\n` +
        `• ${info.conv.toLocaleString('pt-BR')} Conv + ${info.part.toLocaleString('pt-BR')} Part\n` +
        `• o cálculo de repasse salvo deste mês (se houver) também será removido`
      )) return;

      try {
        Banco.db.exec('BEGIN');
        Banco.executar(`DELETE FROM linhas_qvis WHERE mes_pagamento = ?`, [mesPgto]);
        Banco.executar(`DELETE FROM qvis_snapshot_stats WHERE mes_pagamento = ?`, [mesPgto]);
        // V597: derivados do mês também saem — antes o CÁLCULO SALVO
        // (repasse_snapshot) ficava para trás e a competência "voltava" nos
        // seletores do Calcular/Relatórios/Visão Geral mesmo sem QVIS.
        try { Banco.executar(`DELETE FROM repasse_snapshot WHERE competencia = ?`, [mesPgto]); } catch (_) {}
        try { Banco.executar(`DELETE FROM repasse_pagos WHERE competencia = ?`, [mesPgto]); } catch (_) {}
        try { Banco.executar(`DELETE FROM vg_calc_cache WHERE chave LIKE '%|' || ?`, [mesPgto]); } catch (_) {}
        Banco.db.exec('COMMIT');
        await Banco.compactar();   // V606: recupera o espaço do mês excluído já no mesmo passo
        Utilidades.toast(`✓ ${info.total.toLocaleString('pt-BR')} linhas de ${formatarComp(mesPgto)} apagadas`, 'success');
        fechar();
        renderizar();
      } catch (e) {
        Banco.db.exec('ROLLBACK');
        alert('Erro ao apagar: ' + e.message);
      }
    });
  }

  // ==========================================================================
  // EXPORTAR CONSOLIDADO (uma aba só, empilhado)
  // ==========================================================================
  function exportarConsolidado() {
    try {
      const total = Banco.queryUnica(`SELECT COUNT(*) AS n FROM linhas_qvis`)?.n || 0;
      if (total === 0) { alert('Não há dados para exportar.'); return; }

      if (total > 100000 && !confirm(`Você está prestes a exportar ${total.toLocaleString('pt-BR')} linhas. Isso pode demorar alguns segundos. Continuar?`)) return;

      Utilidades.toast(`Gerando consolidado de ${total.toLocaleString('pt-BR')} linhas...`, 'info', 3000);
      const t0 = performance.now();

      const tudo = Banco.query(`
        SELECT ${buildSelectExportSQL()}
        ${FROM_EXPORT_SQL}
        ORDER BY lq.competencia, lq.origem, lq.data_admissao, lq.admissao
      `);

      const rows = [COLS_EXPORT.map(c => c[1])];
      for (const l of tudo) rows.push(COLS_EXPORT.map(c => l[c[0]] ?? ''));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'QVIS Consolidado');
      const dataLabel = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `QVIS_Consolidado_${dataLabel}.xlsx`);

      const dur = ((performance.now() - t0) / 1000).toFixed(1);
      Utilidades.toast(`✓ ${tudo.length.toLocaleString('pt-BR')} linhas exportadas em ${dur}s`, 'success');
    } catch (e) {
      console.error(e);
      alert('Erro ao exportar: ' + e.message);
    }
  }

  // ==========================================================================
  // EXPORTAR POR ORIGEM (botão dentro do card Convênio ou Particular)
  // ==========================================================================
  function abrirModalExportarPorOrigem(origem) {
    // Lista SNAPSHOTS (mes_pagamento) que existem nessa origem
    const snapshots = Banco.query(`
      SELECT mes_pagamento,
             COUNT(*) AS linhas,
             COUNT(DISTINCT admissao) AS admissoes,
             MIN(competencia) AS comp_min,
             MAX(competencia) AS comp_max
      FROM linhas_qvis
      WHERE origem = ? AND mes_pagamento IS NOT NULL AND mes_pagamento != ''
      GROUP BY mes_pagamento
      ORDER BY mes_pagamento DESC
    `, [origem]);

    if (snapshots.length === 0) {
      alert(`Não há snapshots de ${origem} para exportar.`);
      return;
    }

    const labelOrigem = origem === 'CONVENIO' ? 'Convênio' : 'Particular';

    const overlay = document.createElement('div');
    overlay.className = 'impq-modal-overlay';
    overlay.innerHTML = `
      <div class="impq-modal">
        <div class="impq-modal-header">
          <h3>📥 Exportar ${labelOrigem}</h3>
          <button class="impq-modal-close" data-close>×</button>
        </div>
        <div class="impq-modal-body">
          <p class="impq-modal-texto">
            Selecione um ou mais <strong>snapshots</strong> (mês de pagamento) para exportar. Cada snapshot corresponde a um relatório importado e contém todas as linhas que vieram naquele arquivo.
          </p>
          <div class="impq-comp-master">
            <label class="impq-comp-master-label">
              <input type="checkbox" id="impq-master-all" checked>
              <span><strong>Marcar / desmarcar todos</strong></span>
            </label>
            <span class="impq-comp-master-info" id="impq-sel-info">${snapshots.length} de ${snapshots.length} selecionados</span>
          </div>
          <div class="impq-comp-lista">
            ${snapshots.map(s => {
              const periodo = s.comp_min === s.comp_max
                ? formatarComp(s.comp_min)
                : `${formatarComp(s.comp_min)} → ${formatarComp(s.comp_max)}`;
              return `
                <label class="impq-comp-linha">
                  <input type="checkbox" name="impq-snap-exp-multi" value="${s.mes_pagamento}" checked>
                  <span class="impq-comp-nome">📅 Pgto: ${formatarComp(s.mes_pagamento)}</span>
                  <span class="impq-comp-tags">
                    <span class="impq-tag-total mono">${s.linhas.toLocaleString('pt-BR')} linhas</span>
                    <span class="impq-tag-adm mono">${s.admissoes.toLocaleString('pt-BR')} admissões</span>
                    <span class="impq-comp-pgto">competências: ${periodo}</span>
                  </span>
                </label>
              `;
            }).join('')}
          </div>
          <div class="impq-resumo-exp" id="impq-resumo-exp">
            Selecionados: <strong>${snapshots.length}</strong> snapshot${snapshots.length !== 1 ? 's' : ''} · <strong>${snapshots.reduce((s, p) => s + p.linhas, 0).toLocaleString('pt-BR')}</strong> linhas
          </div>
        </div>
        <div class="impq-modal-footer">
          <button class="btn btn-pequeno" data-close>Cancelar</button>
          <button class="btn btn-primary" id="impq-modal-exp-origem-go">📥 Gerar Excel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const fechar = () => overlay.remove();
    overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', fechar));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });

    // Marcar/desmarcar todas
    const masterChk = overlay.querySelector('#impq-master-all');
    const allChks = () => overlay.querySelectorAll('input[name="impq-snap-exp-multi"]');
    masterChk.addEventListener('change', () => {
      allChks().forEach(c => { c.checked = masterChk.checked; });
      atualizarResumo();
    });

    function atualizarResumo() {
      const sel = Array.from(allChks()).filter(c => c.checked);
      const totLinhas = sel.reduce((s, c) => {
        const p = snapshots.find(x => x.mes_pagamento === c.value);
        return s + (p?.linhas || 0);
      }, 0);
      overlay.querySelector('#impq-sel-info').textContent = `${sel.length} de ${snapshots.length} selecionados`;
      overlay.querySelector('#impq-resumo-exp').innerHTML =
        `Selecionados: <strong>${sel.length}</strong> snapshot${sel.length !== 1 ? 's' : ''} · <strong>${totLinhas.toLocaleString('pt-BR')}</strong> linhas`;
      // Atualiza estado do master
      if (sel.length === 0) {
        masterChk.checked = false; masterChk.indeterminate = false;
      } else if (sel.length === snapshots.length) {
        masterChk.checked = true; masterChk.indeterminate = false;
      } else {
        masterChk.checked = false; masterChk.indeterminate = true;
      }
      overlay.querySelector('#impq-modal-exp-origem-go').disabled = sel.length === 0;
    }
    allChks().forEach(c => c.addEventListener('change', atualizarResumo));

    overlay.querySelector('#impq-modal-exp-origem-go').addEventListener('click', () => {
      const snapsSelec = Array.from(allChks()).filter(c => c.checked).map(c => c.value);
      if (snapsSelec.length === 0) return;
      exportarPorOrigem(origem, snapsSelec);
      fechar();
    });
  }

  /**
   * Exporta linhas de uma origem filtradas por mes_pagamento (snapshots).
   * Múltiplos snapshots = múltiplas abas no Excel (uma por snapshot),
   * para preservar a identidade de cada relatório importado.
   */
  function exportarPorOrigem(origem, snapshots) {
    try {
      const labelOrigem = origem === 'CONVENIO' ? 'Convenio' : 'Particular';
      Utilidades.toast(`Gerando Excel de ${labelOrigem}...`, 'info', 2000);

      const wb = XLSX.utils.book_new();
      let totalLinhas = 0;

      // Ordena snapshots por mes_pagamento (mais antigo primeiro)
      const snapsOrd = [...snapshots].sort();

      for (const mp of snapsOrd) {
        const linhas = Banco.query(`
          SELECT ${buildSelectExportSQL()}
          ${FROM_EXPORT_SQL}
          WHERE lq.origem = ? AND lq.mes_pagamento = ?
          ORDER BY lq.competencia, lq.data_admissao, lq.admissao
        `, [origem, mp]);
        if (linhas.length === 0) continue;
        const rows = [COLS_EXPORT.map(c => c[1])];
        for (const l of linhas) rows.push(COLS_EXPORT.map(c => l[c[0]] ?? ''));
        // Nome da aba: "Pgto Jan-2026" (máx 31 chars no Excel)
        const nomeAba = `Pgto ${mp}`.slice(0, 31);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), nomeAba);
        totalLinhas += linhas.length;
      }

      if (wb.SheetNames.length === 0) {
        alert('Nada para exportar com os filtros selecionados.');
        return;
      }

      // Nome do arquivo: pgto único ou range de pgtos
      const sufixo = snapsOrd.length === 1
        ? snapsOrd[0]
        : `${snapsOrd[0]}_a_${snapsOrd[snapsOrd.length - 1]}`;
      XLSX.writeFile(wb, `QVIS_${labelOrigem}_Pgto_${sufixo}.xlsx`);
      Utilidades.toast(`✓ ${totalLinhas.toLocaleString('pt-BR')} linhas exportadas em ${wb.SheetNames.length} aba(s)`, 'success');
    } catch (e) {
      console.error(e);
      alert('Erro ao exportar: ' + e.message);
    }
  }

  // ==========================================================================
  // EDITAR MÊS DE PAGAMENTO DE UM SNAPSHOT INTEIRO
  // ==========================================================================
  function abrirModalEditarSnapshot(mesPagamento) {
    // Conta linhas + busca códigos e data de pagamento atuais
    let qtdConv = 0, qtdPart = 0;
    let codConvAtual = '', codPartAtual = '';
    let dataPgtoAtual = '';
    try {
      qtdConv = Banco.queryUnica(
        `SELECT COUNT(*) AS n FROM linhas_qvis WHERE mes_pagamento = ? AND origem = 'CONVENIO'`,
        [mesPagamento]
      )?.n || 0;
      qtdPart = Banco.queryUnica(
        `SELECT COUNT(*) AS n FROM linhas_qvis WHERE mes_pagamento = ? AND origem = 'PARTICULAR'`,
        [mesPagamento]
      )?.n || 0;
      const sconv = Banco.queryUnica(
        `SELECT codigo_relatorio, data_pagamento FROM qvis_snapshot_stats WHERE mes_pagamento = ? AND origem = 'CONVENIO'`,
        [mesPagamento]
      );
      const spart = Banco.queryUnica(
        `SELECT codigo_relatorio, data_pagamento FROM qvis_snapshot_stats WHERE mes_pagamento = ? AND origem = 'PARTICULAR'`,
        [mesPagamento]
      );
      codConvAtual = sconv?.codigo_relatorio || '';
      codPartAtual = spart?.codigo_relatorio || '';
      // Pega a data de pagamento que já existir (prioriza Convênio, depois Particular)
      dataPgtoAtual = sconv?.data_pagamento || spart?.data_pagamento || '';
    } catch (e) {}
    const qtdTotal = qtdConv + qtdPart;

    const opcoes = gerarOpcoesMesPagamento(mesPagamento);

    const overlay = document.createElement('div');
    overlay.className = 'impq-modal-overlay';
    overlay.innerHTML = `
      <div class="impq-modal" style="max-width: 480px">
        <div class="impq-modal-header">
          <h3>✏ Editar Snapshot</h3>
          <button class="impq-modal-close" data-close>×</button>
        </div>
        <div class="impq-modal-body">
          <div class="impq-edit-pgto-info">
            <div class="impq-edit-pgto-linha">
              <span class="impq-edit-pgto-lbl">Snapshot atual:</span>
              <strong>${formatarComp(mesPagamento)}</strong>
            </div>
            ${qtdConv > 0 ? `
              <div class="impq-edit-pgto-linha">
                <span class="impq-edit-pgto-lbl">Convênio:</span>
                <strong class="mono">${qtdConv.toLocaleString('pt-BR')} linhas</strong>
              </div>
            ` : ''}
            ${qtdPart > 0 ? `
              <div class="impq-edit-pgto-linha">
                <span class="impq-edit-pgto-lbl">Particular:</span>
                <strong class="mono">${qtdPart.toLocaleString('pt-BR')} linhas</strong>
              </div>
            ` : ''}
          </div>

          <div class="impq-edit-pgto-campo">
            <label class="impq-edit-pgto-label">📅 Mês de pagamento</label>
            <select class="impq-edit-pgto-select mono" id="impq-edit-pgto-novo">
              ${opcoes.map(o => `<option value="${o.valor}" ${o.valor === mesPagamento ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
          </div>

          ${qtdConv > 0 ? `
            <div class="impq-edit-pgto-campo">
              <label class="impq-edit-pgto-label" style="color:#102d4b">🏥 Código do relatório — Convênio</label>
              <input type="text" id="impq-edit-cod-conv"
                     class="impq-codigo-input mono"
                     value="${escapeAttr(codConvAtual)}"
                     placeholder="Ex: 41897"
                     autocomplete="off">
            </div>
          ` : ''}

          ${qtdPart > 0 ? `
            <div class="impq-edit-pgto-campo">
              <label class="impq-edit-pgto-label" style="color:#6B4587">💳 Código do relatório — Particular</label>
              <input type="text" id="impq-edit-cod-part"
                     class="impq-codigo-input mono"
                     value="${escapeAttr(codPartAtual)}"
                     placeholder="Ex: 33745"
                     autocomplete="off">
            </div>
          ` : ''}

          <div class="impq-edit-pgto-campo">
            <label class="impq-edit-pgto-label">
              📅 Data de pagamento aos médicos
              <span class="impq-data-alerta" title="Importante! Registre a data exata em que o ATLAS pagou os médicos deste relatório. Pode deixar em branco se ainda não houve pagamento.">!</span>
            </label>
            <input type="date" id="impq-edit-data-pgto"
                   class="impq-codigo-input mono"
                   value="${escapeAttr(dataPgtoAtual)}"
                   autocomplete="off">
            <div class="impq-codigo-hint">Data em que o ATLAS efetivou o pagamento aos médicos deste snapshot (opcional).</div>
          </div>

          <div class="impq-aviso-modal">
            ⚠ Alterar o mês de pagamento reetiqueta todas as <strong class="mono">${qtdTotal.toLocaleString('pt-BR')}</strong> linhas. Se já existir outro snapshot com o mesmo mês + origem, serão <strong>mesclados</strong>.
          </div>
        </div>
        <div class="impq-modal-footer">
          <button class="btn btn-pequeno" data-close>Cancelar</button>
          <button class="btn btn-primary" id="impq-edit-pgto-salvar">💾 Salvar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const fechar = () => overlay.remove();
    overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', fechar));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });

    overlay.querySelector('#impq-edit-pgto-salvar').addEventListener('click', async () => {
      const novoMes = overlay.querySelector('#impq-edit-pgto-novo').value;
      const novoCodConv = overlay.querySelector('#impq-edit-cod-conv')?.value?.trim() || null;
      const novoCodPart = overlay.querySelector('#impq-edit-cod-part')?.value?.trim() || null;
      const novaDataPgto = overlay.querySelector('#impq-edit-data-pgto')?.value?.trim() || null;

      // Validação de comprimento
      if ((novoCodConv && novoCodConv.length > 50) || (novoCodPart && novoCodPart.length > 50)) {
        alert('Código não pode ter mais de 50 caracteres.');
        return;
      }

      const mudouMes = (novoMes && novoMes !== mesPagamento);
      const mudouCodConv = (novoCodConv || '') !== (codConvAtual || '');
      const mudouCodPart = (novoCodPart || '') !== (codPartAtual || '');
      const mudouDataPgto = (novaDataPgto || '') !== (dataPgtoAtual || '');
      if (!mudouMes && !mudouCodConv && !mudouCodPart && !mudouDataPgto) {
        fechar();
        return;
      }

      // Se mês mudou: verifica colisão
      if (mudouMes) {
        try {
          const conflito = Banco.queryUnica(
            `SELECT COUNT(*) AS n FROM linhas_qvis WHERE mes_pagamento = ?`,
            [novoMes]
          );
          if (conflito && conflito.n > 0) {
            if (!confirm(
              `Já existem ${conflito.n.toLocaleString('pt-BR')} linhas no snapshot de ${formatarComp(novoMes)}.\n\n` +
              `As linhas do snapshot atual (${formatarComp(mesPagamento)}) serão MESCLADAS com elas.\n\n` +
              `Deseja continuar?`
            )) return;
          }
        } catch (e) {}
      }

      try {
        Banco.db.exec('BEGIN');

        // 1) Atualiza códigos se mudaram
        if (mudouCodConv && qtdConv > 0) {
          Banco.executar(
            `UPDATE qvis_snapshot_stats SET codigo_relatorio = ?
              WHERE mes_pagamento = ? AND origem = 'CONVENIO'`,
            [novoCodConv, mesPagamento]
          );
        }
        if (mudouCodPart && qtdPart > 0) {
          Banco.executar(
            `UPDATE qvis_snapshot_stats SET codigo_relatorio = ?
              WHERE mes_pagamento = ? AND origem = 'PARTICULAR'`,
            [novoCodPart, mesPagamento]
          );
        }

        // 1b) Atualiza data de pagamento (aplica em ambas as origens)
        if (mudouDataPgto) {
          Banco.executar(
            `UPDATE qvis_snapshot_stats SET data_pagamento = ?
              WHERE mes_pagamento = ?`,
            [novaDataPgto, mesPagamento]
          );
        }

        // 2) Se mes mudou, reetiqueta tudo
        if (mudouMes) {
          Banco.executar(
            `UPDATE linhas_qvis SET mes_pagamento = ? WHERE mes_pagamento = ?`,
            [novoMes, mesPagamento]
          );
          Banco.executar(
            `DELETE FROM qvis_snapshot_stats WHERE mes_pagamento = ?`,
            [novoMes]
          );
          Banco.executar(
            `UPDATE qvis_snapshot_stats SET mes_pagamento = ? WHERE mes_pagamento = ?`,
            [novoMes, mesPagamento]
          );
        }
        Banco.db.exec('COMMIT');
        await Banco.salvar({ imediato: true });

        let msg = '';
        if (mudouMes && (mudouCodConv || mudouCodPart || mudouDataPgto)) {
          msg = `✓ Snapshot ${formatarComp(mesPagamento)} → ${formatarComp(novoMes)} (atualizado)`;
        } else if (mudouMes) {
          msg = `✓ Snapshot ${formatarComp(mesPagamento)} → ${formatarComp(novoMes)}`;
        } else if (mudouDataPgto && !mudouCodConv && !mudouCodPart) {
          msg = `✓ Data de pagamento atualizada em ${formatarComp(mesPagamento)}`;
        } else {
          msg = `✓ Snapshot ${formatarComp(mesPagamento)} atualizado`;
        }
        Utilidades.toast(msg, 'success');
        fechar();
        renderizar();
      } catch (e) {
        try { Banco.db.exec('ROLLBACK'); } catch (ee) {}
        alert('Erro: ' + e.message);
      }
    });
  }

  // ==========================================================================
  // APAGAR SNAPSHOT INTEIRO (Conv + Part de um mês de pagamento)
  // ==========================================================================
  function abrirModalApagarSnapshot(mesPagamento) {
    let qtdConv = 0, qtdPart = 0;
    try {
      qtdConv = Banco.queryUnica(
        `SELECT COUNT(*) AS n FROM linhas_qvis WHERE mes_pagamento = ? AND origem = 'CONVENIO'`,
        [mesPagamento]
      )?.n || 0;
      qtdPart = Banco.queryUnica(
        `SELECT COUNT(*) AS n FROM linhas_qvis WHERE mes_pagamento = ? AND origem = 'PARTICULAR'`,
        [mesPagamento]
      )?.n || 0;
    } catch (e) {}
    const total = qtdConv + qtdPart;

    if (total === 0) { renderizar(); return; }

    if (!confirm(
      `🗑 APAGAR SNAPSHOT\n\n` +
      `Mês de pagamento: ${formatarComp(mesPagamento)}\n` +
      (qtdConv > 0 ? `Convênio: ${qtdConv.toLocaleString('pt-BR')} linhas\n` : '') +
      (qtdPart > 0 ? `Particular: ${qtdPart.toLocaleString('pt-BR')} linhas\n` : '') +
      `Total: ${total.toLocaleString('pt-BR')} linhas\n` +
      `O cálculo de repasse salvo deste mês (se houver) também será removido.\n\n` +
      `Esta ação é PERMANENTE e não pode ser desfeita.\n\n` +
      `Confirma?`
    )) return;

    (async () => {
      try {
        Banco.db.exec('BEGIN');
        Banco.executar(`DELETE FROM linhas_qvis WHERE mes_pagamento = ?`, [mesPagamento]);
        Banco.executar(`DELETE FROM qvis_snapshot_stats WHERE mes_pagamento = ?`, [mesPagamento]);
        // V597: derivados do mês também saem — antes o CÁLCULO SALVO
        // (repasse_snapshot) ficava para trás e a competência "voltava" nos
        // seletores do Calcular/Relatórios/Visão Geral mesmo sem QVIS.
        try { Banco.executar(`DELETE FROM repasse_snapshot WHERE competencia = ?`, [mesPagamento]); } catch (_) {}
        try { Banco.executar(`DELETE FROM repasse_pagos WHERE competencia = ?`, [mesPagamento]); } catch (_) {}
        try { Banco.executar(`DELETE FROM vg_calc_cache WHERE chave LIKE '%|' || ?`, [mesPagamento]); } catch (_) {}
        Banco.db.exec('COMMIT');
        await Banco.compactar();   // V606: recupera o espaço do mês excluído já no mesmo passo
        Utilidades.toast(`✓ Snapshot ${formatarComp(mesPagamento)} apagado (${total.toLocaleString('pt-BR')} linhas)`, 'success');
        renderizar();
      } catch (e) {
        try { Banco.db.exec('ROLLBACK'); } catch (ee) {}
        alert('Erro: ' + e.message);
      }
    })();
  }

  // ==========================================================================
  // ESTILOS
  // ==========================================================================
  function getStyles() {
    return `
      <style>
        /* ── V995: filtro das linhas já importadas ─────────────────────── */
        .impq-filtro-linhas { padding: 12px 14px; margin-bottom: 14px; }
        .impq-filtro-linhas[hidden] { display: none; }
        .impq-filtro-grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px;
        }
        .impq-filtro-grid label {
          display: block; font-size: 10px; font-weight: 700; letter-spacing: .06em;
          text-transform: uppercase; color: var(--ink-faint, #9aa09c); margin-bottom: 4px;
        }
        .impq-filtro-grid .input { width: 100%; padding: 7px 9px; }
        .impq-filtro-rodape {
          margin-top: 9px; display: flex; align-items: center; gap: 10px;
          font-size: 12px; color: var(--ink-soft, #5a6879);
        }
        .impq-filtro-on {
          background: var(--accent) !important; color: #fff !important; border-color: var(--accent) !important;
        }
        .impq-filtro-resultado { padding: 0; overflow: hidden; margin-bottom: 16px; }
        .impq-filtro-resultado .data-table { font-size: 12px; }
        .impq-f-vazio { text-align: center; color: var(--ink-faint); padding: 18px; }
        .impq-f-origem {
          display: inline-block; padding: 1px 7px; border-radius: 999px;
          font-size: 10px; font-weight: 800; letter-spacing: .04em; color: #fff;
        }
        .impq-f-convenio { background: #102d4b; }
        .impq-f-particular { background: #6B4587; }

        .impq-drops-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
          margin: 18px 0;
        }
        @media (max-width: 800px) { .impq-drops-grid { grid-template-columns: 1fr; } }

        .impq-drop {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          min-height: 240px;
          display: flex; flex-direction: column;
        }
        .impq-drop-header {
          padding: 12px 16px;
          display: flex; align-items: center; gap: 8px;
          border-bottom: 3px solid var(--border);
          background: var(--bg-sunken);
        }
        .impq-drop-icone { font-size: 18px; }
        .impq-drop-label {
          font-size: 13px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--ink); flex: 1;
        }
        .impq-drop-remover {
          background: transparent; border: 1px solid var(--border);
          border-radius: 50%; width: 24px; height: 24px;
          cursor: pointer; color: var(--ink-soft);
          font-size: 12px;
        }
        .impq-drop-remover:hover {
          background: #FEE; color: #9B3A3A; border-color: #D88;
        }

        /* Botão Exportar dentro do header do card */
        .impq-drop-exp {
          background: white;
          border: 1px solid var(--accent);
          color: var(--accent);
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 11px; font-weight: 700;
          cursor: pointer; letter-spacing: 0.04em;
        }
        .impq-drop-exp:hover {
          background: var(--accent); color: white;
        }

        /* Header de ações da página */
        .impq-header-acoes { display: flex; gap: 8px; }

        .impq-drop-corpo { padding: 10px; flex: 1; }
        .impq-drop-zona {
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          border: 2px dashed var(--border);
          margin: 6px;
          border-radius: 8px;
          background: var(--bg-sunken);
          transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
          min-height: 100px;
        }
        .impq-drop-zona:hover {
          border-color: var(--accent);
          background: rgba(42, 90, 140, 0.05);
        }
        .impq-drop-zona.impq-drag-hover {
          border-color: var(--primary);
          background: rgba(20, 51, 82, 0.06);
        }
        .impq-drop-area { text-align: center; padding: 10px; }
        .impq-drop-icone-grande { font-size: 24px; margin-bottom: 6px; opacity: 0.55; }
        .impq-drop-prompt {
          font-size: 12px; color: var(--ink); line-height: 1.4;
          margin-bottom: 2px;
        }
        .impq-drop-hint { font-size: 10px; color: var(--ink-faint); font-style: italic; }

        .impq-drop-carregado { }
        .impq-arquivo-nome {
          font-size: 12px; font-weight: 600; color: var(--primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          padding: 6px 10px;
          background: var(--bg-sunken);
          border-radius: 6px;
          margin-bottom: 4px;
        }
        .impq-arquivo-meta { font-size: 10px; color: var(--ink-faint); margin-bottom: 10px; }
        .impq-resumo { display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
        .impq-resumo-linha {
          display: flex; justify-content: space-between; align-items: center;
          padding: 4px 0;
        }
        .impq-resumo-lbl { color: var(--ink-soft); }
        .impq-resumo-val { font-weight: 700; color: var(--ink); }
        .impq-resumo-divisor {
          height: 1px;
          background: var(--border);
          margin: 4px 0 2px;
        }
        .impq-problemas {
          margin-top: 8px;
          padding: 6px 10px;
          background: #e4ecf4; border: 1px solid #9FE6C9;
          border-radius: 6px;
          font-size: 10px; color: #143352;
          display: flex; align-items: center; justify-content: space-between;
        }
        .impq-ver-problemas {
          background: transparent; border: 1px solid #143352;
          color: #143352; padding: 1px 8px; border-radius: 4px;
          font-size: 10px; cursor: pointer;
        }
        .impq-ver-problemas:hover { background: #143352; color: white; }

        /* Preview */
        .impq-preview {
          background: linear-gradient(135deg, #143352, #0b2340);
          color: #f6f4ef;
          border-radius: 12px; padding: 18px 22px;
          margin-bottom: 18px;
          box-shadow: 0 4px 12px rgba(20, 51, 82,.2);
        }
        .impq-preview-titulo {
          font-size: 12px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.06em;
          color: #2a5a8c;
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 14px;
        }
        .impq-preview-grid {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px;
          margin-bottom: 14px;
        }
        @media (max-width: 700px) { .impq-preview-grid { grid-template-columns: repeat(2, 1fr); } }
        .impq-preview-item {}
        .impq-preview-lbl {
          font-size: 9px; color: #c5d5e5; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em;
          margin-bottom: 4px;
        }
        .impq-preview-val {
          font-size: 18px; font-weight: 800; color: #9FE6C9;
        }
        .impq-aviso {
          background: rgba(232, 201, 122, 0.15);
          border-left: 3px solid #9FE6C9;
          padding: 10px 14px; border-radius: 6px;
          font-size: 12px; line-height: 1.55;
          margin-bottom: 14px;
        }
        .impq-acoes {
          display: flex; gap: 8px; justify-content: flex-end;
        }
        .impq-acoes .btn-pequeno {
          background: transparent; color: #f6f4ef;
          border: 1px solid #c5d5e5;
        }
        .impq-acoes .btn-pequeno:hover {
          background: rgba(255,255,255,0.1);
        }

        /* Status atual */
        .impq-status {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-left: 4px solid var(--accent);
          border-radius: 10px;
          padding: 16px 20px;
          margin-top: 18px;
        }
        .impq-status-titulo {
          font-size: 11px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.06em;
          color: var(--ink-soft); margin-bottom: 12px;
        }
        .impq-status-grid {
          display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px;
        }
        @media (max-width: 900px) { .impq-status-grid { grid-template-columns: repeat(2, 1fr); } }
        .impq-status-lbl {
          font-size: 10px; color: var(--ink-soft); font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.04em;
          margin-bottom: 4px;
        }
        .impq-status-val { font-size: 18px; font-weight: 700; color: var(--ink); }

        /* Resumo mini (header do status) */
        .impq-status-resumo-mini {
          display: flex; align-items: center; gap: 14px;
          padding: 10px 14px;
          background: var(--bg-sunken);
          border-radius: 8px;
          margin-bottom: 14px;
          flex-wrap: wrap;
        }
        .impq-mini-item {
          display: flex; align-items: baseline; gap: 6px;
        }
        .impq-mini-lbl {
          font-size: 10px; color: var(--ink-soft);
          text-transform: uppercase; letter-spacing: 0.04em;
          font-weight: 600;
        }
        .impq-mini-val {
          font-size: 16px; font-weight: 800;
          color: var(--primary);
        }
        .impq-mini-sub {
          font-size: 10px; color: var(--ink-faint);
        }
        .impq-mini-sep {
          width: 1px; height: 18px;
          background: var(--border);
        }

        /* Container vazio (sem snapshots) */
        .impq-vazio {
          padding: 30px 20px;
          text-align: center;
          color: var(--ink-faint);
          font-size: 13px;
          background: var(--bg-sunken);
          border: 1px dashed var(--border);
          border-radius: 8px;
        }

        /* Cards expansíveis de snapshots */
        .impq-cards-snapshots-titulo {
          display: flex; justify-content: space-between; align-items: center;
          font-size: 11px; font-weight: 700;
          letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--ink-soft);
          margin-bottom: 10px; padding: 0 4px;
          flex-wrap: wrap; gap: 8px;
        }
        .impq-cards-snapshots-hint {
          font-size: 10px; font-weight: 500;
          text-transform: none; letter-spacing: 0;
          color: var(--ink-faint); font-style: italic;
        }
        .impq-cards-snapshots {
          display: flex; flex-direction: column; gap: 8px;
        }
        .impq-card-snap {
          background: white;
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
          transition: box-shadow 150ms;
        }
        .impq-card-snap-expandido {
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
          border-color: var(--accent);
        }
        .impq-card-snap-header {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 14px;
          cursor: pointer;
          background: var(--bg-elevated);
          transition: background 150ms;
        }
        .impq-card-snap-header:hover { background: rgba(42, 90, 140, 0.06); }
        .impq-card-snap-expandido .impq-card-snap-header {
          background: linear-gradient(135deg, #e9edf1, #e4ecf4);
          border-bottom: 1px solid var(--border);
        }
        .impq-card-snap-seta {
          font-size: 11px;
          color: var(--accent);
          font-weight: 700;
          width: 12px; text-align: center;
          user-select: none;
        }
        .impq-card-snap-mes {
          font-size: 15px; font-weight: 700;
          color: var(--primary);
          min-width: 90px;
        }
        .impq-card-snap-tags {
          display: flex; gap: 6px; flex: 1;
          flex-wrap: wrap;
        }
        .impq-tag-vazio {
          padding: 3px 9px;
          background: var(--bg-sunken);
          color: var(--ink-faint);
          font-size: 11px; font-style: italic;
          border-radius: 4px;
        }
        .impq-card-snap-acoes {
          display: flex; gap: 4px;
        }

        .impq-card-snap-corpo {
          padding: 16px 18px;
          background: white;
        }
        .impq-detalhe-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        @media (max-width: 700px) {
          .impq-detalhe-grid { grid-template-columns: 1fr; }
        }
        .impq-detalhe-coluna {
          background: var(--bg-sunken);
          border-radius: 8px;
          padding: 12px 14px;
        }
        .impq-detalhe-vazio {
          opacity: 0.5;
        }
        .impq-detalhe-titulo {
          font-size: 12px; font-weight: 700;
          letter-spacing: 0.05em;
          margin-bottom: 10px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border);
        }
        .impq-detalhe-sem-dados {
          font-size: 12px; color: var(--ink-faint);
          font-style: italic; text-align: center;
          padding: 20px 0;
        }
        .impq-detalhe-linha {
          display: flex; justify-content: space-between;
          align-items: center; padding: 3px 0;
          font-size: 12px;
        }
        .impq-detalhe-lbl {
          color: var(--ink-soft);
        }
        .impq-detalhe-val {
          font-weight: 700; color: var(--ink);
        }
        .impq-detalhe-divisor {
          height: 1px; background: var(--border);
          margin: 6px 0;
        }
        .impq-detalhe-arquivo {
          margin-top: 6px;
          padding-top: 6px;
          border-top: 1px dashed var(--border);
        }
        .impq-detalhe-rodape {
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid var(--border);
          display: flex; gap: 12px; align-items: center;
          flex-wrap: wrap;
        }
        .impq-rodape-hint {
          font-size: 10px; color: var(--ink-faint);
          font-style: italic;
        }

        /* Header do Status com ações */
        .impq-status-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 12px;
          gap: 12px; flex-wrap: wrap;
        }
        .impq-status-acoes { display: flex; gap: 6px; flex-wrap: wrap; }

        .btn-perigo {
          background: white; color: #9B3A3A;
          border: 1px solid #D88;
        }
        .btn-perigo:hover:not(:disabled) {
          background: #9B3A3A; color: white;
        }
        .btn-perigo:disabled {
          opacity: 0.4; cursor: not-allowed;
        }

        /* Seletor de mês de pagamento na área de arquivo */
        .impq-mes-pgto {
          margin-top: 12px; padding: 10px 12px;
          background: linear-gradient(135deg, #e9edf1, #e4ecf4);
          border: 1px solid #9FE6C9;
          border-left: 3px solid #2a5a8c;
          border-radius: 6px;
        }
        .impq-mes-pgto-label {
          font-size: 10px; font-weight: 700;
          color: #102d4b; letter-spacing: 0.05em;
          text-transform: uppercase; margin-bottom: 6px;
        }
        .impq-mes-pgto-select {
          width: 100%; padding: 6px 8px;
          border: 1px solid #9FE6C9; border-radius: 4px;
          font-size: 13px; font-weight: 700;
          background: white; color: var(--primary);
          cursor: pointer;
        }
        .impq-mes-pgto-hint {
          font-size: 10px; color: #143352;
          margin-top: 4px; font-style: italic;
        }

        /* Modais */
        .impq-modal-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 200; display: flex;
          align-items: center; justify-content: center;
          padding: 20px;
        }
        .impq-modal {
          background: var(--bg-elevated);
          border-radius: 14px;
          width: 100%; max-width: 580px;
          max-height: calc(100vh - 40px);
          display: flex; flex-direction: column;
          box-shadow: 0 12px 40px rgba(0,0,0,0.3);
        }
        .impq-modal-header {
          padding: 14px 18px; border-bottom: 1px solid var(--border);
          display: flex; justify-content: space-between; align-items: center;
        }
        .impq-modal-header h3 {
          margin: 0; font-family: var(--font-display); font-weight: 500; font-size: 16px;
        }
        .impq-modal-close {
          background: transparent; border: none;
          font-size: 22px; color: var(--ink-soft);
          cursor: pointer; padding: 0 4px;
        }
        .impq-modal-body {
          padding: 16px 20px; overflow-y: auto;
          flex: 1;
        }
        .impq-modal-texto {
          font-size: 13px; color: var(--ink); margin: 0 0 12px;
        }
        .impq-modal-footer {
          padding: 12px 20px; border-top: 1px solid var(--border);
          display: flex; justify-content: flex-end; gap: 8px;
        }

        .impq-comp-lista {
          display: flex; flex-direction: column; gap: 4px;
          max-height: 320px; overflow-y: auto;
          background: var(--bg-sunken);
          padding: 8px; border-radius: 8px;
        }
        .impq-comp-linha {
          display: flex; align-items: center; gap: 12px;
          padding: 8px 12px; background: white;
          border: 1px solid var(--border); border-radius: 6px;
          cursor: pointer;
        }
        .impq-comp-linha:hover { background: rgba(42, 90, 140, 0.08); }
        .impq-comp-linha input[type="radio"] { cursor: pointer; }
        .impq-comp-nome {
          flex: 1; font-weight: 700;
          color: var(--primary); font-size: 13px;
        }
        .impq-comp-tags {
          display: flex; gap: 6px; align-items: center;
        }
        .impq-tag-conv, .impq-tag-part, .impq-tag-total, .impq-tag-adm {
          font-size: 10px; padding: 2px 8px;
          border-radius: 4px; font-weight: 700;
        }
        .impq-tag-conv { background: #e4ecf4; color: #143352; }
        .impq-tag-part { background: #ECE5F2; color: #6B4587; }
        .impq-tag-conv-sem-cod, .impq-tag-part-sem-cod {
          font-size: 10px; padding: 2px 8px;
          border-radius: 4px; font-weight: 700;
          background: #e9edf1;
          border: 1px dashed #9FE6C9;
          color: #143352;
        }
        .impq-tag-conv-sem-cod em, .impq-tag-part-sem-cod em {
          font-style: italic; font-weight: 500;
        }
        .impq-tag-conv strong, .impq-tag-part strong {
          font-family: var(--font-mono);
          font-weight: 800;
        }

        /* Filtro de código (barra de busca) */
        .impq-filtro-codigo-bar {
          display: flex; align-items: center; gap: 10px;
          background: var(--bg-sunken);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 6px 14px;
          margin-bottom: 10px;
        }
        .impq-filtro-icone {
          font-size: 13px;
          color: var(--ink-soft);
        }
        .impq-filtro-codigo-input {
          flex: 1;
          border: none;
          background: transparent;
          outline: none;
          font-size: 13px;
          color: var(--ink);
          padding: 4px 0;
        }
        .impq-filtro-codigo-input::placeholder {
          color: var(--ink-faint);
          font-family: var(--font-body);
        }
        .impq-filtro-resultados {
          font-size: 11px;
          color: var(--accent);
          font-weight: 700;
          background: rgba(42, 90, 140, 0.12);
          padding: 2px 8px;
          border-radius: 10px;
        }
        .impq-filtro-limpar {
          background: none;
          border: 1px solid var(--border);
          color: var(--ink-soft);
          font-size: 11px;
          width: 22px; height: 22px;
          border-radius: 4px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }
        .impq-filtro-limpar:hover {
          background: #F5B5B5;
          color: white;
          border-color: #F5B5B5;
        }

        /* Botão mini de extrair admissões zero */
        .impq-extrair-mini {
          background: none;
          border: 1px solid var(--border);
          color: var(--accent);
          font-size: 10px;
          padding: 1px 5px;
          border-radius: 3px;
          cursor: pointer;
          margin-left: 6px;
          line-height: 1;
          vertical-align: middle;
        }
        .impq-extrair-mini:hover {
          background: var(--accent);
          color: white;
          border-color: var(--accent);
        }

        /* Modal de código (pop-up de import) */
        .impq-codigo-info {
          background: var(--bg-sunken);
          border-radius: 8px;
          padding: 10px 14px;
          margin-bottom: 16px;
        }
        .impq-codigo-linha {
          display: flex; justify-content: space-between;
          font-size: 12px; padding: 3px 0;
        }
        .impq-codigo-lbl {
          color: var(--ink-soft);
        }
        .impq-codigo-campo {
          margin-bottom: 14px;
        }
        .impq-codigo-label {
          display: block;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--ink-soft);
          margin-bottom: 6px;
        }
        .impq-data-alerta {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          background: #FFD54F;
          border: 1px solid #C49000;
          color: #5C3D00;
          border-radius: 50%;
          font-size: 10px;
          font-weight: 900;
          margin-left: 6px;
          cursor: help;
          vertical-align: middle;
          line-height: 1;
        }
        .impq-data-alerta:hover {
          background: #FFC107;
          box-shadow: 0 0 0 3px rgba(255, 213, 79, 0.35);
        }
        .impq-codigo-input {
          width: 100%;
          padding: 9px 12px;
          font-size: 15px;
          font-weight: 700;
          border: 1px solid var(--accent);
          border-radius: 6px;
          background: white;
          color: var(--primary);
          outline: none;
          box-sizing: border-box;
        }
        .impq-codigo-input:focus {
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(20, 51, 82, 0.1);
        }
        .impq-codigo-hint {
          font-size: 10px;
          color: var(--ink-faint);
          margin-top: 4px;
          font-style: italic;
        }
        .impq-tag-total {
          background: var(--bg-sunken); color: var(--ink-soft);
          font-family: var(--font-mono);
        }
        .impq-tag-adm {
          background: #e9edf1; color: #102d4b;
          font-family: var(--font-mono);
        }
        .impq-aviso-modal {
          margin-top: 14px;
          background: #e4ecf4; border-left: 3px solid #9FE6C9;
          padding: 10px 14px; border-radius: 6px;
          font-size: 12px; color: #102d4b; line-height: 1.5;
        }

        /* Lista detalhada de competências no Status */
        .impq-comp-detalhe {
          margin-top: 18px;
          padding-top: 14px;
          border-top: 1px solid var(--border);
        }
        .impq-comp-detalhe-titulo {
          display: flex; justify-content: space-between; align-items: center;
          font-size: 11px; font-weight: 700;
          letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--ink-soft); margin-bottom: 10px;
        }
        .impq-comp-detalhe-hint {
          font-size: 10px; font-weight: 500;
          text-transform: none; letter-spacing: 0;
          color: var(--ink-faint); font-style: italic;
        }
        .impq-comp-detalhe-tabela {
          background: var(--bg-sunken);
          border-radius: 8px;
          padding: 4px;
          max-height: 280px; overflow-y: auto;
        }
        .impq-comp-detalhe-header {
          display: grid;
          grid-template-columns: 110px 100px 1fr 100px 1fr;
          gap: 12px;
          padding: 6px 12px;
          font-size: 10px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.04em;
          color: var(--ink-soft);
        }
        .impq-comp-detalhe-header .num { text-align: right; }
        .impq-comp-detalhe-linha {
          display: grid;
          grid-template-columns: 110px 100px 1fr 100px 1fr;
          gap: 12px;
          padding: 8px 12px;
          background: white;
          border-radius: 6px;
          margin-bottom: 3px;
          font-size: 12px; align-items: center;
        }
        .impq-comp-detalhe-nome {
          font-weight: 700;
          color: var(--primary);
        }
        .impq-comp-vazio {
          color: var(--ink-faint); font-style: italic;
        }
        .impq-pgto-celula {
          display: flex; align-items: center; gap: 6px;
        }
        .impq-pgto-ok {
          padding: 2px 8px; background: #e4ecf4; color: #143352;
          border-radius: 4px; font-size: 11px; font-weight: 700;
        }
        .impq-pgto-vazio {
          padding: 2px 8px; background: #e4ecf4; color: #143352;
          border-radius: 4px; font-size: 11px; font-weight: 700;
          font-style: italic;
        }
        .impq-pgto-editar {
          background: transparent; border: 1px solid var(--border);
          color: var(--ink-soft); padding: 2px 6px;
          border-radius: 4px; cursor: pointer;
          font-size: 11px;
        }
        .impq-pgto-editar:hover {
          background: var(--accent); color: white; border-color: var(--accent);
        }

        /* Modal Exportar — master checkbox e resumo */
        .impq-comp-master {
          display: flex; justify-content: space-between; align-items: center;
          padding: 8px 12px;
          background: rgba(20, 51, 82, 0.04);
          border: 1px solid var(--border);
          border-radius: 8px;
          margin-bottom: 10px;
        }
        .impq-comp-master-label {
          display: flex; align-items: center; gap: 8px;
          font-size: 12px; cursor: pointer;
        }
        .impq-comp-master-info {
          font-size: 11px; color: var(--ink-soft); font-weight: 600;
        }
        .impq-comp-pgto {
          font-size: 10px; color: var(--ink-soft);
          background: var(--bg-sunken);
          padding: 2px 8px; border-radius: 4px;
        }
        .impq-resumo-exp {
          margin-top: 12px; padding: 10px 14px;
          background: linear-gradient(135deg, #143352, #0b2340);
          color: #f6f4ef;
          border-radius: 8px; font-size: 13px;
        }
        .impq-resumo-exp strong { color: #9FE6C9; }

        /* Modal editar mês de pagamento */
        .impq-edit-pgto-info {
          background: var(--bg-sunken);
          border-radius: 8px;
          padding: 10px 14px;
          margin-bottom: 14px;
        }
        .impq-edit-pgto-linha {
          display: flex; justify-content: space-between; align-items: center;
          padding: 4px 0;
          font-size: 13px;
        }
        .impq-edit-pgto-lbl {
          color: var(--ink-soft); font-size: 11px;
          text-transform: uppercase; letter-spacing: 0.04em;
        }
        .impq-edit-pgto-campo {
          margin-bottom: 12px;
        }
        .impq-edit-pgto-label {
          display: block; font-size: 10px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--ink-soft); margin-bottom: 6px;
        }
        .impq-edit-pgto-select {
          width: 100%; padding: 8px 10px;
          border: 1px solid var(--accent); border-radius: 6px;
          font-size: 14px; font-weight: 700;
          background: white; color: var(--primary);
          cursor: pointer;
        }

        /* Snapshots */
        .impq-snap-tabela {
          background: var(--bg-sunken);
          border-radius: 8px;
          padding: 4px;
          max-height: 320px; overflow-y: auto;
        }
        .impq-snap-header {
          display: grid;
          grid-template-columns: 120px 100px 1fr 100px 1fr 80px;
          gap: 12px;
          padding: 6px 12px;
          font-size: 10px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.04em;
          color: var(--ink-soft);
        }
        .impq-snap-header .num { text-align: right; }
        .impq-snap-linha-tab {
          display: grid;
          grid-template-columns: 120px 100px 1fr 100px 1fr 80px;
          gap: 12px;
          padding: 8px 12px;
          background: white;
          border-radius: 6px;
          margin-bottom: 3px;
          font-size: 12px; align-items: center;
        }
        .impq-snap-mes {
          font-weight: 700;
          color: var(--accent);
          background: rgba(42, 90, 140, 0.1);
          padding: 4px 10px;
          border-radius: 6px;
          text-align: center;
          font-size: 13px;
        }
        .impq-snap-acoes {
          display: flex; gap: 4px; justify-content: flex-end;
        }
        .impq-btn-apagar {
          color: #9B3A3A !important;
        }
        .impq-btn-apagar:hover {
          background: #9B3A3A !important; color: white !important;
          border-color: #9B3A3A !important;
        }

        /* Detalhes dos snapshots no preview */
        .impq-snapshots-detalhe {
          margin: 10px 0;
          display: flex; flex-direction: column; gap: 4px;
        }
        .impq-snap-linha {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 10px;
          background: rgba(255,255,255,0.08);
          border-radius: 6px; font-size: 12px;
        }
        .impq-snap-tag {
          padding: 2px 8px; border-radius: 4px;
          font-size: 10px; font-weight: 700;
          letter-spacing: 0.04em;
        }
        .impq-snap-tag-convenio {
          background: rgba(220, 234, 230, 0.15); color: #C8F5C0;
        }
        .impq-snap-tag-particular {
          background: rgba(236, 229, 242, 0.15); color: #DAC8E4;
        }
        .impq-snap-substituir {
          color: #9FE6C9; font-weight: 600;
        }
        .impq-snap-novo {
          color: #C8F5C0; font-weight: 600;
        }
        .impq-snap-arrow {
          color: #c5d5e5; font-weight: 700;
        }
        .impq-aviso-erro {
          background: rgba(155, 58, 58, 0.15) !important;
          border-left-color: #F5B5B5 !important;
          color: #F5B5B5 !important;
        }

        /* Modal de análise de estrutura */
        .impq-analise-arquivo {
          padding: 12px 14px;
          background: var(--bg-sunken);
          border-radius: 8px; font-size: 13px;
          display: flex; align-items: center; gap: 10px;
          margin-bottom: 16px;
        }
        .impq-analise-meta {
          margin-left: auto; font-size: 11px;
          color: var(--ink-soft);
        }
        .impq-analise-secao {
          margin-bottom: 14px;
          border-radius: 8px;
          padding: 12px 14px;
        }
        .impq-secao-ok { background: rgba(31, 132, 76, 0.06); border-left: 3px solid #0A7A5A; }
        .impq-secao-aviso { background: rgba(232, 201, 122, 0.12); border-left: 3px solid #9FE6C9; }
        .impq-secao-novo { background: rgba(107, 69, 135, 0.06); border-left: 3px solid #6B4587; }
        .impq-analise-titulo {
          font-size: 12px; font-weight: 700;
          color: var(--ink);
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 8px;
        }
        .impq-analise-count {
          margin-left: auto;
          font-size: 11px; font-weight: 700;
          padding: 2px 8px; background: white;
          border-radius: 10px;
          color: var(--ink-soft);
        }
        .impq-analise-descricao {
          font-size: 11px; color: var(--ink-soft);
          margin-bottom: 8px; line-height: 1.5;
        }
        .impq-analise-lista {
          display: flex; flex-wrap: wrap; gap: 4px;
        }
        .impq-coluna-ok {
          font-size: 11px;
          padding: 3px 9px;
          background: white;
          border: 1px solid #C8E0D2;
          color: #0A7A5A;
          border-radius: 4px;
          font-weight: 600;
        }
        .impq-coluna-faltando {
          font-size: 11px;
          padding: 3px 9px;
          background: white;
          border: 1px dashed #D8B870;
          color: #143352;
          border-radius: 4px;
          font-weight: 600;
        }
        .impq-coluna-nova {
          font-size: 11px;
          padding: 3px 9px;
          background: white;
          border: 1px solid #C8B8DC;
          color: #6B4587;
          border-radius: 4px;
          font-weight: 600;
        }
        .impq-coluna-hint {
          font-size: 10px; color: var(--ink-faint);
          font-style: italic; margin-top: 6px;
          width: 100%;
        }
        .impq-analise-detalhes {
          margin-top: 8px;
          border-top: 1px dashed var(--border);
          padding-top: 10px;
        }
        .impq-analise-detalhes summary {
          font-size: 11px; color: var(--ink-soft);
          cursor: pointer; font-weight: 600;
        }
        .impq-analise-detalhes summary:hover { color: var(--accent); }
      </style>
    `;
  }

};
