/**
 * ============================================================================
 * TELA: Cadastros · De-Para de Nomes
 *
 * Permite vincular nomes de profissionais que aparecem no relatório de
 * PRODUÇÃO a médicos cadastrados no sistema. Resolve o problema de grafias
 * diferentes (ex: "WILLIAN FAGUNDES PFEILSTICKER" no relatório vs
 * "William Fagundes Pfeilsticker" no cadastro).
 *
 * Estrutura:
 *   - Header: título + botão "↻ Re-escanear produção"
 *   - 4 cards: total, vinculados, pendentes, sugestões automáticas
 *   - Filtros: busca + status (apenas pendentes/todos/vinculados)
 *   - Tabela: nome do relatório | freq | vincular a... | ação
 *   - Rodapé: aceitar todas as sugestões automáticas de uma vez
 *
 * Sugestão automática (heurística):
 *   - Normaliza ambos os nomes (remove acentos, espaços extras, MAIÚSCULAS)
 *   - Se baterem 100% → match exato → marca como sugestão alta confiança
 *   - Se um for prefixo do outro com mesmas iniciais → sugere
 *   - Caso contrário, deixa pro usuário escolher
 *
 * Tabela usada: sinonimos_medico (id, medico_id, grafia, grafia_normalizada,
 * confianca, aprovado_por, criado_em)
 * ============================================================================
 */

App.telas['de-para-nomes'] = function () {

  // Estado da tela
  if (window.__dp === undefined) {
    window.__dp = {
      filtroStatus: 'pendentes', // 'pendentes' | 'todos' | 'vinculados'
    };
  }

  // Tabelas que apontam pra medicos.id — levantadas do schema/DDLs (V681)
  // V917: faltavam excecoes_cargo (exceções do módulo Cargos — a unificação
  // DEIXAVA elas órfãs e o repasse do cargo sumia), estrabismo_valor_medico
  // (regra de valor fixo V914) e fracionamento_aplicacoes (FK do médico).
  const TABELAS_MEDICO_ID = [
    'sinonimos_medico', 'medico_especialidades', 'medico_unidades', 'medico_cargos',
    'cargos_fixos', 'lancamentos_externos', 'linhas_calculadas', 'regras_especiais',
    'valores_periodo_medico', 'fellow_cadastro', 'config_consulta_producao',
    'consolidado_linhas_manuais', 'excecao_desempenho_bloqueio', 'tabela_repasse_excecao',
    'excecoes_cargo', 'estrabismo_valor_medico', 'fracionamento_aplicacoes',
  ];

  const ROTULO_TABELA = {
    sinonimos_medico: 'sinônimos (de-para)', medico_especialidades: 'especialidades',
    medico_unidades: 'unidades', medico_cargos: 'cargos', cargos_fixos: 'cargos fixos',
    lancamentos_externos: 'lançamentos externos', linhas_calculadas: 'linhas calculadas',
    regras_especiais: 'regras especiais', valores_periodo_medico: 'valores de período',
    fellow_cadastro: 'cadastro Fellow', config_consulta_producao: 'consulta·produção',
    consolidado_linhas_manuais: 'linhas avulsas do consolidado',
    excecao_desempenho_bloqueio: 'bloqueios de desempenho',
    tabela_repasse_excecao: 'exceções de repasse', excecoes_cargo: 'exceções de CARGO',
    estrabismo_valor_medico: 'valor fixo do Estrabismo', fracionamento_aplicacoes: 'aplicações de fracionamento',
  };

  renderizar();

  function renderizar() {
    try {
      _renderizarInterno();
    } catch (e) {
      console.error('Erro De-Para:', e);
      document.getElementById('conteudo').innerHTML = `
        <div class="page-content">
          <header class="page-header"><h2>De-Para de Nomes</h2></header>
          <div class="card" style="background: #FEE; border-color: #D88; padding: 18px">
            <h3 style="color: #9B3A3A; margin: 0 0 8px">⚠ Erro ao carregar</h3>
            <pre style="font-size: 11px; white-space: pre-wrap">${e.message}\n\n${e.stack}</pre>
          </div>
        </div>
      `;
    }
  }

  function _renderizarInterno() {
    // 1) Carrega TODOS os nomes únicos que aparecem no relatório de produção
    //    em qualquer um dos papéis profissionais
    const nomesRelatorio = coletarNomesDoRelatorio();

    // 2) Carrega médicos cadastrados ativos
    const medicos = Banco.query(`
      SELECT id, nome_oficial, nome_normalizado, tipo_vinculo
      FROM medicos WHERE ativo = 1 ORDER BY nome_oficial
    `);

    // Índices O(1) e palavras pré-computadas (evita find/split por linha)
    const medicoPorNorm = new Map();
    const medicoPorId = new Map();
    for (const m of medicos) { medicoPorNorm.set(m.nome_normalizado, m); medicoPorId.set(m.id, m); }
    const medicosPrep = medicos.map(m => {
      const pal = (m.nome_normalizado || '').split(/\s+/).filter(p => p.length > 1);
      return { med: m, set: new Set(pal), n: pal.length, pal };   // V681: pal p/ fuzzy
    });

    // 3) Carrega sinônimos já cadastrados
    const sinonimosExistentes = new Map(); // grafia_normalizada -> { medico_id, grafia }
    Banco.query('SELECT * FROM sinonimos_medico').forEach(s => {
      sinonimosExistentes.set(s.grafia_normalizada, s);
    });

    // 3.1) Carrega nomes ignorados explicitamente
    const ignoradosSet = new Set(); // grafia_normalizada
    try {
      Banco.query('SELECT grafia_normalizada FROM nomes_ignorados')
        .forEach(r => ignoradosSet.add(r.grafia_normalizada));
    } catch (e) { /* tabela pode não existir em banco antigo */ }

    // 4) Para cada nome do relatório, determina o status
    const linhas = nomesRelatorio.map(item => {
      const norm = Utilidades.normalizar(item.nome);
      // Ignorado explicitamente? (precedência sobre match)
      if (ignoradosSet.has(norm)) {
        return {
          nome: item.nome,
          freq: item.freq,
          status: 'ignorado',
          medicoVinculado: null,
          sugestao: null,
        };
      }
      // Match direto com nome oficial do médico?
      const matchDireto = medicoPorNorm.get(norm);
      if (matchDireto) {
        return {
          nome: item.nome,
          freq: item.freq,
          status: 'direto',
          medicoVinculado: matchDireto,
          sugestao: null,
        };
      }
      // Match via tabela de sinônimos?
      const sinonimo = sinonimosExistentes.get(norm);
      if (sinonimo) {
        const med = medicoPorId.get(sinonimo.medico_id);
        return {
          nome: item.nome,
          freq: item.freq,
          status: 'sinonimo',
          medicoVinculado: med,
          sugestao: null,
        };
      }
      // Pendente - tenta sugestão automática
      const sugestao = sugerirMedico(item.nome, medicosPrep);
      return {
        nome: item.nome,
        freq: item.freq,
        status: 'pendente',
        medicoVinculado: null,
        sugestao,
      };
    });

    // Stats agregadas
    const total = linhas.length;
    const vinculados = linhas.filter(l => l.status === 'direto' || l.status === 'sinonimo').length;
    const ignorados = linhas.filter(l => l.status === 'ignorado').length;
    const pendentes = linhas.filter(l => l.status === 'pendente').length;
    const comSugestao = linhas.filter(l => l.status === 'pendente' && l.sugestao).length;

    // Filtragem
    let linhasFiltradas = linhas;
    if (window.__dp.filtroStatus === 'pendentes') {
      linhasFiltradas = linhas.filter(l => l.status === 'pendente');
    } else if (window.__dp.filtroStatus === 'vinculados') {
      linhasFiltradas = linhas.filter(l => l.status === 'direto' || l.status === 'sinonimo');
    } else if (window.__dp.filtroStatus === 'ignorados') {
      linhasFiltradas = linhas.filter(l => l.status === 'ignorado');
    }
    // Ordena por: pendentes com sugestão > pendentes sem > vinculados/ignorados; dentro de cada bloco por freq desc
    linhasFiltradas.sort((a, b) => {
      const peso = l => l.status === 'pendente'
        ? (l.sugestao ? 0 : 1)
        : (l.status === 'ignorado' ? 3 : 2);
      const pa = peso(a), pb = peso(b);
      if (pa !== pb) return pa - pb;
      return b.freq - a.freq;
    });

    // V681: cadastros de médicos quase-duplicados (typo virou cadastro)
    const paresDup = detectarCadastrosDuplicados(medicos);
    // V917: configs apontando pra médico que não existe mais (sobras de unificação)
    const orfaos = detectarRegistrosOrfaos();

    document.getElementById('conteudo').innerHTML = `
      <div class="page-content">
        ${renderHeader(pendentes)}
        ${renderStats(total, vinculados, pendentes, comSugestao)}
        ${renderOrfaos(orfaos, medicos)}
        ${renderDuplicados(paresDup)}
        ${total === 0 ? renderVazio() : `
          ${renderFiltros()}
          ${renderTabela(linhasFiltradas, medicos)}
          ${pendentes > 0 ? renderRodape(linhas) : ''}
        `}
      </div>
      ${getStyles()}
    `;

    bindEventos(linhas, medicos);
    bindDuplicados(paresDup);
    bindOrfaos(orfaos);   // V917
  }

  // ── V681: card de CADASTROS quase-duplicados + unificação ────────────────
  function renderDuplicados(pares) {
    if (!pares || !pares.length) return '';
    return `
      <div class="card" style="border-color:#ecd9a8; background:#fffaf0; padding:14px 16px; margin-bottom:14px">
        <h3 style="margin:0 0 4px; font-size:14px; color:#8a5a00">⚠ Possíveis cadastros DUPLICADOS de médico (${pares.length})</h3>
        <p style="margin:0 0 10px; font-size:12px; color:var(--ink-soft)">
          Dois cadastros com nomes quase iguais (erro de digitação) dividem a produção do mesmo médico.
          <strong>Unificar</strong> move tudo (vínculos, exceções, especialidades, sinônimos…) para o cadastro
          escolhido, e o outro vira sinônimo dele — some das listas.
        </p>
        ${pares.map((p, i) => `
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 10px; border:1px solid var(--border); border-radius:8px; background:var(--bg-raised,#fff); margin-bottom:6px">
            <div style="flex:1; min-width:260px">
              <div style="font-weight:700">${escapeHTML(p.a.nome_oficial)} <span style="font-weight:400; color:var(--ink-faint)">(${escapeHTML(p.a.tipo_vinculo || '—')})</span></div>
              <div style="font-weight:700">${escapeHTML(p.b.nome_oficial)} <span style="font-weight:400; color:var(--ink-faint)">(${escapeHTML(p.b.tipo_vinculo || '—')})</span></div>
            </div>
            <button class="btn btn-pequeno" data-unif="${i}" data-manter="${p.a.id}" data-remover="${p.b.id}"
                    title="Unifica os dois cadastros mantendo &quot;${escapeAttr(p.a.nome_oficial)}&quot;">✓ Manter "${escapeHTML(p.a.nome_oficial)}"</button>
            <button class="btn btn-pequeno" data-unif="${i}" data-manter="${p.b.id}" data-remover="${p.a.id}"
                    title="Unifica os dois cadastros mantendo &quot;${escapeAttr(p.b.nome_oficial)}&quot;">✓ Manter "${escapeHTML(p.b.nome_oficial)}"</button>
          </div>`).join('')}
      </div>`;
  }

  function bindDuplicados(pares) {
    document.querySelectorAll('[data-unif]').forEach(b => b.addEventListener('click', () => {
      unificarMedicos(Number(b.dataset.manter), Number(b.dataset.remover));
    }));
  }

  // ── V917: REGISTROS ÓRFÃOS — configs apontando pra um médico que não existe ──
  // (ex.: unificações antigas apagavam o cadastro sem migrar excecoes_cargo —
  // a exceção ficava órfã e o repasse do cargo sumia em silêncio). Este painel
  // acha essas sobras e deixa REVINCULAR tudo a um médico do cadastro.
  function detectarRegistrosOrfaos() {
    const ids = new Set((Banco.query(`SELECT id FROM medicos`) || []).map(m => m.id));
    const porId = new Map();   // medico_id órfão → [{ tab, n }]
    for (const tab of TABELAS_MEDICO_ID) {
      try {
        const rows = Banco.query(`SELECT medico_id, COUNT(*) AS n FROM ${tab}
          WHERE medico_id IS NOT NULL GROUP BY medico_id`) || [];
        for (const r of rows) {
          if (ids.has(r.medico_id)) continue;
          if (!porId.has(r.medico_id)) porId.set(r.medico_id, []);
          porId.get(r.medico_id).push({ tab, n: r.n });
        }
      } catch (_) { /* tabela pode não existir nesta base */ }
    }
    return porId;
  }
  function renderOrfaos(orfaos, medicos) {
    if (!orfaos || orfaos.size === 0) return '';
    const opts = medicos.map(m =>
      `<option value="${m.id}">${escapeHTML(m.nome_oficial)}${m.tipo_vinculo ? ' · ' + m.tipo_vinculo : ''}</option>`).join('');
    return `
      <div class="card" style="border-color:#e0b4ae; background:#fdf3f2; padding:14px 16px; margin-bottom:14px">
        <h3 style="margin:0 0 4px; font-size:14px; color:#8a2f24">🩹 Configurações ÓRFÃS de médico (${orfaos.size})</h3>
        <p style="margin:0 0 10px; font-size:12px; color:var(--ink-soft)">
          Estes registros apontam para um médico que <strong>não existe mais no cadastro</strong> (em geral, sobra
          de uma unificação antiga) — eles <strong>não estão sendo pagos</strong>. Escolha o médico certo e
          revincule: as regras voltam a valer no próximo ▶ Recalcular.
        </p>
        ${[...orfaos.entries()].map(([medId, tabs]) => `
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 10px; border:1px solid var(--border); border-radius:8px; background:var(--bg-raised,#fff); margin-bottom:6px">
            <div style="flex:1; min-width:260px; font-size:12px">
              <strong>id antigo ${medId}</strong> —
              ${tabs.map(t => `${escapeHTML(ROTULO_TABELA[t.tab] || t.tab)} (${t.n})`).join(' · ')}
            </div>
            <select data-orf-sel="${medId}" style="padding:6px 8px; border:1px solid var(--border); border-radius:7px; font:inherit; max-width:280px">
              <option value="">— revincular a qual médico? —</option>
              ${opts}
            </select>
            <button class="btn btn-pequeno" data-orf-fix="${medId}">↻ Revincular tudo</button>
            <button class="btn btn-pequeno" data-orf-del="${medId}" title="Apaga de vez estes registros órfãos" style="color:#8a2f24">🗑 descartar</button>
          </div>`).join('')}
      </div>`;
  }
  function bindOrfaos(orfaos) {
    document.querySelectorAll('[data-orf-fix]').forEach(b => b.addEventListener('click', async () => {
      const antigo = Number(b.dataset.orfFix);
      const sel = document.querySelector(`[data-orf-sel="${antigo}"]`);
      const novo = Number(sel && sel.value);
      if (!novo) { Utilidades.toast('Escolha o médico que recebe estes registros.', 'error', 3000); return; }
      const novoMed = Banco.queryUnica(`SELECT nome_oficial FROM medicos WHERE id = ?`, [novo]);
      if (!novoMed) return;
      if (!confirm(`Revincular TODOS os registros órfãos do id antigo ${antigo} para "${novoMed.nome_oficial}"?`)) return;
      let n = 0;
      for (const tab of TABELAS_MEDICO_ID) {
        try {
          Banco.executar(`UPDATE OR IGNORE ${tab} SET medico_id = ? WHERE medico_id = ?`, [novo, antigo]);
          Banco.executar(`DELETE FROM ${tab} WHERE medico_id = ?`, [antigo]);
          n++;
        } catch (_) {}
      }
      await Banco.salvar();
      Utilidades.toast(`✓ Registros revinculados a "${novoMed.nome_oficial}". Clique em ▶ Recalcular pra aplicar.`, 'success', 5000);
      renderizar();
    }));
    document.querySelectorAll('[data-orf-del]').forEach(b => b.addEventListener('click', async () => {
      const antigo = Number(b.dataset.orfDel);
      if (!confirm(`Apagar DE VEZ todos os registros órfãos do id antigo ${antigo}? Isso não pode ser desfeito.`)) return;
      for (const tab of TABELAS_MEDICO_ID) {
        try { Banco.executar(`DELETE FROM ${tab} WHERE medico_id = ?`, [antigo]); } catch (_) {}
      }
      await Banco.salvar();
      Utilidades.toast('✓ Registros órfãos descartados.', 'success', 3500);
      renderizar();
    }));
  }


  // V917: força do vínculo — na unificação prevalece o MAIS FORTE dos dois
  // (foi assim que um médico INTERNO "virou externo" ao ser unificado num
  // cadastro parecido EXTERNO, sem ninguém perceber).
  const FORCA_VINCULO = { INTERNO: 3, HIBRIDO: 2, EXTERNO: 1 };

  async function unificarMedicos(manterId, removerId) {
    if (!manterId || !removerId || manterId === removerId) return;
    const manter = Banco.queryUnica(`SELECT * FROM medicos WHERE id = ?`, [manterId]);
    const remover = Banco.queryUnica(`SELECT * FROM medicos WHERE id = ?`, [removerId]);
    if (!manter || !remover) { Utilidades.toast('Médico não encontrado.', 'error'); return; }
    const vincManter = String(manter.tipo_vinculo || '').toUpperCase();
    const vincRemover = String(remover.tipo_vinculo || '').toUpperCase();
    const vincFinal = (FORCA_VINCULO[vincRemover] || 0) > (FORCA_VINCULO[vincManter] || 0) ? vincRemover : (vincManter || vincRemover);
    if (!confirm(
      `Unificar os cadastros?\n\n` +
      `MANTER:  ${manter.nome_oficial} (${vincManter || '—'})\n` +
      `REMOVER: ${remover.nome_oficial} (${vincRemover || '—'})\n\n` +
      `Tudo que aponta para "${remover.nome_oficial}" (exceções, cargos, especialidades, vínculos, ` +
      `sinônimos…) passa para "${manter.nome_oficial}", e o nome removido vira sinônimo — ` +
      `a produção dos dois soma num médico só.\n` +
      `O tipo de vínculo que fica é o MAIS FORTE dos dois: ${vincFinal || '—'}.` +
      `\n\nEsta ação não pode ser desfeita.`)) return;

    Utilidades.mostrarLoading('Unificando cadastros...');
    try {
      Banco.db.exec('BEGIN');
      for (const tab of TABELAS_MEDICO_ID) {
        // UPDATE OR IGNORE respeita UNIQUEs (ex.: mesma especialidade nos dois);
        // as sobras que violariam a UNIQUE são descartadas em seguida
        try {
          Banco.executar(`UPDATE OR IGNORE ${tab} SET medico_id = ? WHERE medico_id = ?`, [manterId, removerId]);
          Banco.executar(`DELETE FROM ${tab} WHERE medico_id = ?`, [removerId]);
        } catch (_) { /* tabela pode não existir nesta base */ }
      }
      /**
       * V917: os DADOS DA FICHA do cadastro removido não podem morrer com ele —
       * o tipo de vínculo fica o mais forte dos dois, e todo campo VAZIO do
       * mantido é preenchido com o do removido (CRM, CNPJ, cargo, emails…).
       */
      try {
        if (vincFinal && vincFinal !== vincManter) {
          Banco.executar(`UPDATE medicos SET tipo_vinculo = ? WHERE id = ?`, [vincFinal, manterId]);
        }
        for (const col of ['crm', 'rqe', 'especialidade', 'cnpj', 'razao_social', 'email',
                           'telefone', 'cargo_admin', 'observacoes', 'codigo_atlas']) {
          const vManter = manter[col], vRemover = remover[col];
          if ((vManter == null || String(vManter).trim() === '') && vRemover != null && String(vRemover).trim() !== '') {
            try { Banco.executar(`UPDATE medicos SET ${col} = ? WHERE id = ?`, [vRemover, manterId]); } catch (_) {}
          }
        }
      } catch (_) {}
      // V917: o CONTROLE DE NOTAS é chaveado por nome_normalizado — o cadastro
      // e as competências do nome removido passam pro nome mantido (se o
      // mantido já tem, as sobras que violariam a UNIQUE são descartadas).
      try {
        Banco.executar(`UPDATE OR IGNORE notas_cadastro SET nome = ?, nome_normalizado = ? WHERE nome_normalizado = ?`,
          [manter.nome_oficial, manter.nome_normalizado, remover.nome_normalizado]);
        Banco.executar(`DELETE FROM notas_cadastro WHERE nome_normalizado = ?`, [remover.nome_normalizado]);
        Banco.executar(`UPDATE OR IGNORE notas_controle SET nome_normalizado = ? WHERE nome_normalizado = ?`,
          [manter.nome_normalizado, remover.nome_normalizado]);
        Banco.executar(`DELETE FROM notas_controle WHERE nome_normalizado = ?`, [remover.nome_normalizado]);
      } catch (_) { /* módulo pode não existir nesta base */ }
      // o nome removido (e o normalizado dele) viram SINÔNIMOS do mantido
      try {
        Banco.executar(`DELETE FROM sinonimos_medico WHERE grafia_normalizada = ?`, [remover.nome_normalizado]);
        Banco.executar(
          `INSERT OR REPLACE INTO sinonimos_medico (medico_id, grafia, grafia_normalizada, confianca, aprovado_por)
           VALUES (?, ?, ?, 1.0, 'unificacao')`,
          [manterId, remover.nome_oficial, remover.nome_normalizado || Utilidades.normalizar(remover.nome_oficial)]);
      } catch (_) {}
      Banco.executar(`DELETE FROM medicos WHERE id = ?`, [removerId]);
      Banco.db.exec('COMMIT');
    } catch (e) {
      try { Banco.db.exec('ROLLBACK'); } catch (_) {}
      Utilidades.esconderLoading();
      console.error('[de-para] unificar:', e);
      Utilidades.toast('Erro ao unificar: ' + (e.message || e), 'error', 5000);
      return;
    }
    // registra na Linha do Tempo (área própria) + invalida motor/consolidados
    try {
      Banco._tlAutoContar && Banco._tlAutoContar('Médicos · de-para de nomes', 1);
      Banco._tlAutoDetalhe && Banco._tlAutoDetalhe('Médicos · de-para de nomes',
        `⇉ Unificação de cadastros: "${remover.nome_oficial}" → "${manter.nome_oficial}"`);
    } catch (_) {}
    try { window.__atlasInvalidarAux && window.__atlasInvalidarAux(); } catch (_) {}
    try { window.AtlasRelatorios && AtlasRelatorios.invalidarConsolidado && AtlasRelatorios.invalidarConsolidado(); } catch (_) {}
    await Banco.salvar();
    Utilidades.esconderLoading();
    Utilidades.toast(`✓ Cadastros unificados — "${remover.nome_oficial}" agora é sinônimo de "${manter.nome_oficial}"`, 'success', 5000);
    renderizar();
  }

  // ==========================================================================
  // COLETA DE NOMES DO RELATÓRIO DE PRODUÇÃO
  // ==========================================================================
  // Junta todas as ocorrências distintas dos 4 papéis profissionais
  // (Médico, Cirurgião, Indicante, Solicitante) com a frequência total.

  function coletarNomesDoRelatorio() {
    // Agrega nomes de TODAS as fontes que alimentam os módulos (não só a Produção):
    // Produção (4 papéis), QVIS, Laudos, Períodos e Fellow. Cada fonte é consultada
    // isoladamente — se uma tabela não existir, é ignorada sem quebrar as demais.
    const freq = new Map();
    const add = (sql) => {
      try {
        (Banco.query(sql) || []).forEach(r => {
          const n = (r.n == null ? '' : String(r.n)).trim();
          if (!n) return;
          freq.set(n, (freq.get(n) || 0) + (Number(r.c) || 1));
        });
      } catch (e) { /* tabela/coluna ausente — ignora esta fonte */ }
    };
    add(`SELECT UPPER(TRIM(medico))      AS n, COUNT(*) AS c FROM linhas_producao WHERE medico      IS NOT NULL AND medico      != '' GROUP BY n`);
    add(`SELECT UPPER(TRIM(cirurgiao))   AS n, COUNT(*) AS c FROM linhas_producao WHERE cirurgiao   IS NOT NULL AND cirurgiao   != '' GROUP BY n`);
    add(`SELECT UPPER(TRIM(indicante))   AS n, COUNT(*) AS c FROM linhas_producao WHERE indicante   IS NOT NULL AND indicante   != '' GROUP BY n`);
    add(`SELECT UPPER(TRIM(solicitante)) AS n, COUNT(*) AS c FROM linhas_producao WHERE solicitante IS NOT NULL AND solicitante != '' GROUP BY n`);
    add(`SELECT UPPER(TRIM(nome_profissional)) AS n, COUNT(*) AS c FROM linhas_qvis   WHERE nome_profissional IS NOT NULL AND nome_profissional != '' GROUP BY n`);
    add(`SELECT UPPER(TRIM(medico))            AS n, COUNT(*) AS c FROM laudos        WHERE medico            IS NOT NULL AND medico            != '' GROUP BY n`);
    add(`SELECT UPPER(TRIM(nome_original))     AS n, COUNT(*) AS c FROM periodos_linhas WHERE nome_original   IS NOT NULL AND nome_original     != '' GROUP BY n`);
    add(`SELECT UPPER(TRIM(fellow_nome))       AS n, COUNT(*) AS c FROM fellow_linhas WHERE fellow_nome      IS NOT NULL AND fellow_nome       != '' GROUP BY n`);
    return Array.from(freq.entries())
      .map(([nome, f]) => ({ nome, freq: f }))
      .sort((a, b) => b.freq - a.freq);
  }

  // ==========================================================================
  // ALGORITMO DE SUGESTÃO AUTOMÁTICA
  // ==========================================================================
  // Heurísticas:
  //  1) Mesmas iniciais (primeira letra de cada palavra) + ≥60% das palavras
  //     em comum (em qualquer ordem) → forte sugestão
  //  2) Um nome é "início" do outro com mesmas 2 primeiras palavras → sugestão

  // ── V681: comparação TYPO-TOLERANTE por palavra ──────────────────────────
  // Levenshtein com teto (corta cedo): GOES ↔ GOMES, CARVALHO ↔ CARVALLHO etc.
  // contam como a MESMA palavra (1 letra de diferença; 2 em palavras longas).
  function _levAte(a, b, max) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > max) return max + 1;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      let melhorLinha = cur[0];
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < melhorLinha) melhorLinha = cur[j];
      }
      if (melhorLinha > max) return max + 1;
      const t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }
  function _palavraParecida(a, b) {
    if (a === b) return true;
    const menor = Math.min(a.length, b.length);
    if (menor < 4) return false;                     // palavras curtas: só exatas
    const tol = menor >= 8 ? 2 : 1;
    return _levAte(a, b, tol) <= tol;
  }

  function sugerirMedico(nomeRelatorio, medicosPrep) {
    const normRel = Utilidades.normalizar(nomeRelatorio);
    const palavrasRel = normRel.split(/\s+/).filter(p => p.length > 1);
    if (palavrasRel.length === 0) return null;

    let melhor = null;
    let melhorScore = 0;
    const minComuns = palavrasRel.length <= 2 ? palavrasRel.length : 2;

    for (const mp of medicosPrep) {
      if (mp.n === 0) continue;

      // Conta palavras em comum (independente da ordem)
      let comuns = 0;
      const sobras = [];
      for (const p of palavrasRel) { if (mp.set.has(p)) comuns++; else sobras.push(p); }
      // V681: palavra que não bateu exata ainda conta se for QUASE igual a
      // alguma do médico (erro de digitação) — só tenta quando já há base real
      if (sobras.length && comuns >= Math.max(1, minComuns - 1)) {
        for (const p of sobras) {
          if (mp.pal && mp.pal.some(w => _palavraParecida(p, w))) comuns++;
        }
      }
      if (comuns < minComuns) continue;

      // Score: palavras em comum / total de palavras do maior nome
      const maior = palavrasRel.length > mp.n ? palavrasRel.length : mp.n;
      const score = comuns / maior;
      if (score < 0.5) continue;

      if (score > melhorScore) {
        melhorScore = score;
        melhor = mp.med;
      }
    }
    return melhor;
  }

  // ── V681: CADASTROS quase-duplicados (dois MÉDICOS pro mesmo nome) ───────
  // Caso real: "Hanna ... GOES ..." virou cadastro (ex.: Pendentes → Externos)
  // além do correto "Hanna ... GOMES ..." — o de-para sozinho não resolve, é
  // preciso UNIFICAR os cadastros (re-apontar tudo e virar sinônimo).
  function detectarCadastrosDuplicados(medicos) {
    if (!medicos || medicos.length < 2 || medicos.length > 1500) return [];
    const prep = medicos.map(m => {
      const pal = (m.nome_normalizado || Utilidades.normalizar(m.nome_oficial) || '').split(/\s+/).filter(p => p.length > 1);
      return { med: m, pal, set: new Set(pal) };
    });
    const pares = [];
    for (let i = 0; i < prep.length; i++) {
      for (let j = i + 1; j < prep.length; j++) {
        const A = prep[i], B = prep[j];
        if (!A.pal.length || !B.pal.length) continue;
        const difPal = Math.abs(A.pal.length - B.pal.length);
        if (difPal > 3) continue;
        // menor/maiorP: o nome ABREVIADO precisa caber inteiro no completo
        const [menor, maiorP] = A.pal.length <= B.pal.length ? [A, B] : [B, A];
        let iguais = 0, parecidas = 0, palMaisLonga = 0;
        for (const p of menor.pal) {
          if (maiorP.set.has(p)) { iguais++; if (p.length > palMaisLonga) palMaisLonga = p.length; }
          else if (maiorP.pal.some(w => _palavraParecida(p, w))) { parecidas++; if (p.length > palMaisLonga) palMaisLonga = p.length; }
        }
        const maior = Math.max(A.pal.length, B.pal.length);
        // quase-duplicado (mesmo tamanho ±1): TODAS as palavras casam (exata ou
        // quase) e pelo menos uma é exata — typo que virou cadastro
        const typoMesmoNome = difPal <= 1 && iguais >= 1 && parecidas >= 1 && (iguais + parecidas) >= maior;
        // V684: nome ABREVIADO — TODAS as palavras do nome curto (≥2) casam com
        // o nome completo (exata ou quase), com ≥1 exata; exige uma palavra
        // distintiva (≥6 letras) pra não parear nomes comuns tipo "MARIA SILVA"
        const abreviado = difPal >= 1 && menor.pal.length >= 2 && iguais >= 1 &&
          (iguais + parecidas) >= menor.pal.length && palMaisLonga >= 6;
        if (typoMesmoNome || abreviado) {
          pares.push({ a: A.med, b: B.med });
          if (pares.length >= 20) return pares;   // teto de segurança
        }
      }
    }
    return pares;
  }

  // ==========================================================================
  // RENDERIZAÇÃO
  // ==========================================================================

  function renderHeader(pendentes) {
    const temPendentes = pendentes > 0;
    return `
      <header class="page-header">
        <div>
          <h2>De-Para de Nomes</h2>
          <div class="subtitle">Vincule nomes do relatório de produção a médicos cadastrados</div>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
          ${temPendentes ? `
            <button class="btn btn-pequeno" id="btn-header-pendentes-externos"
                    title="Cria todos os ${pendentes} nomes pendentes como médicos novos do tipo EXTERNO">
              🪄 Pendentes → Externos (${pendentes})
            </button>
            <button class="btn btn-pequeno" id="btn-header-pendentes-situacionais"
                    title="Como EXTERNO, mas com a flag 'situacional' (médicos pontuais)">
              🩹 Pendentes → Ext. Situacionais (${pendentes})
            </button>
          ` : ''}
          <button class="btn" id="btn-reescanear" title="Recarrega os dados (útil após importar nova produção)">↻ Re-escanear</button>
        </div>
      </header>
    `;
  }

  function renderStats(total, vinculados, pendentes, comSugestao) {
    return `
      <div class="dp-stats">
        <div class="dp-stat dp-stat-total">
          <div class="dp-stat-label">Nomes no relatório</div>
          <div class="dp-stat-valor mono">${total}</div>
        </div>
        <div class="dp-stat dp-stat-ok">
          <div class="dp-stat-label">Já vinculados</div>
          <div class="dp-stat-valor mono">${vinculados}</div>
        </div>
        <div class="dp-stat ${pendentes > 0 ? 'dp-stat-alerta' : 'dp-stat-total'}">
          <div class="dp-stat-label">${pendentes > 0 ? '⚠ Pendentes' : 'Pendentes'}</div>
          <div class="dp-stat-valor mono">${pendentes}</div>
        </div>
        <div class="dp-stat dp-stat-sugestao">
          <div class="dp-stat-label">Sugestões automáticas</div>
          <div class="dp-stat-valor mono">${comSugestao}</div>
        </div>
      </div>
    `;
  }

  function renderVazio() {
    return `
      <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 30px 20px">
        <div style="color: var(--ink-faint); font-size: 13px">
          Nenhum nome de profissional encontrado.<br>
          <span style="font-size: 11px">Importe um relatório de PRODUÇÃO em <strong>Processamento → Importar PRODUÇÃO</strong> primeiro.</span>
        </div>
      </div>
    `;
  }

  function renderFiltros() {
    return `
      <div class="dp-filtros">
        <select class="select" id="dp-status" style="font-weight: 600; max-width: 280px">
          <option value="pendentes" ${window.__dp.filtroStatus === 'pendentes' ? 'selected' : ''}>⚠ Apenas pendentes</option>
          <option value="todos"      ${window.__dp.filtroStatus === 'todos' ? 'selected' : ''}>Todos</option>
          <option value="vinculados" ${window.__dp.filtroStatus === 'vinculados' ? 'selected' : ''}>Já vinculados</option>
          <option value="ignorados"  ${window.__dp.filtroStatus === 'ignorados' ? 'selected' : ''}>Ignorados</option>
        </select>
      </div>
    `;
  }

  function renderTabela(linhas, medicos) {
    if (linhas.length === 0) {
      return `
        <div class="card" style="background: var(--bg-sunken); border-style: dashed; text-align: center; padding: 24px">
          <div style="color: var(--ink-faint); font-size: 13px">Nenhum nome corresponde aos filtros aplicados.</div>
        </div>
      `;
    }

    return `
      <div class="card" style="padding: 0; overflow: hidden">
        <table class="data-table dp-tabela">
          <thead>
            <tr>
              <th style="width: 40%">NOME NO RELATÓRIO</th>
              <th class="num" style="width: 8%">FREQ.</th>
              <th style="width: 40%">VINCULAR A...</th>
              <th style="width: 12%; text-align: center">AÇÃO</th>
            </tr>
          </thead>
          <tbody>
            ${linhas.map(l => renderLinha(l, medicos)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderLinha(l, medicos) {
    const ehJuscelino = l.nome === 'JUSCELINO KUBITSCHEK'; // aviso especial

    // Status visual
    let classeStatus = '';
    let badgeStatus = '';
    if (l.status === 'direto') {
      classeStatus = 'dp-linha-ok';
      badgeStatus = '<span class="dp-badge-ok">✓ Match direto</span>';
    } else if (l.status === 'sinonimo') {
      classeStatus = 'dp-linha-ok';
      badgeStatus = '<span class="dp-badge-sin">↔ Vinculado</span>';
    } else if (l.status === 'ignorado') {
      classeStatus = 'dp-linha-ignorado';
      badgeStatus = '<span class="dp-badge-ignorado">— Ignorado —</span>';
    } else if (l.sugestao) {
      classeStatus = 'dp-linha-sugestao';
    }

    return `
      <tr class="${classeStatus}" data-nome="${escapeAttr(l.nome)}">
        <td>
          <div style="font-weight: 600">${escapeHTML(l.nome)}</div>
          ${badgeStatus ? `<div style="margin-top: 3px">${badgeStatus}</div>` : ''}
          ${ehJuscelino ? `
            <div style="font-size: 10px; color: #005073; margin-top: 3px">
              ⚠ Parece nome de pessoa pública — possível erro no sistema do hospital
            </div>
          ` : ''}
        </td>
        <td class="num mono"><strong>${l.freq}</strong></td>
        <td>
          ${renderDropdown(l, medicos)}
        </td>
        <td style="text-align: center">
          ${renderBotaoAcao(l)}
        </td>
      </tr>
    `;
  }

  function renderDropdown(l, medicos) {
    // Lista de médicos para o select, marcando o vinculado/sugerido
    const medicoSelecionado = l.medicoVinculado ? l.medicoVinculado.id : '';
    const sugId = l.sugestao ? l.sugestao.id : null;

    // Se já vinculado por sinônimo, oferece opção de mudar
    if (l.status === 'direto') {
      return `
        <div class="dp-status-display dp-status-direto">
          → <strong>${escapeHTML(l.medicoVinculado.nome_oficial)}</strong>
          <span class="dp-status-sub">(match exato com cadastro)</span>
        </div>
      `;
    }

    // Ignorado: mostra status discreto em vez do select
    if (l.status === 'ignorado') {
      return `
        <div class="dp-status-display dp-status-ignorado">
          — Ignorado —
          <span class="dp-status-sub">não vincula a nenhum médico</span>
        </div>
      `;
    }

    // Slim: só placeholders + sugestão + vínculo atual.
    // A lista completa de médicos é injetada ao focar (popularSelectLazy).
    const optAtual = (l.status === 'sinonimo' && l.medicoVinculado)
      ? `<option value="${l.medicoVinculado.id}" selected>${escapeHTML(l.medicoVinculado.nome_oficial)}</option>`
      : '';
    return `
      <select class="dp-select ${l.sugestao ? 'dp-select-sugestao' : ''}" data-nome="${escapeAttr(l.nome)}" data-lazy="1" data-sel="${medicoSelecionado}">
        <option value="">— Selecione um médico —</option>
        <option value="__NOVO__">+ Cadastrar como novo médico</option>
        <option value="__IGNORAR__">— Ignorar (não vincular) —</option>
        ${l.sugestao ? `
          <option value="${l.sugestao.id}" ${l.status === 'pendente' ? 'selected' : ''} style="font-weight: 600; background: #E1EFF6">
            ✨ ${escapeHTML(l.sugestao.nome_oficial)} (sugestão)
          </option>
        ` : ''}
        ${optAtual}
      </select>
    `;
  }

  function renderBotaoAcao(l) {
    if (l.status === 'direto') {
      return '<span style="color: #0A7A5A; font-size: 11px; font-weight: 600">—</span>';
    }
    if (l.status === 'sinonimo') {
      return `<button class="btn-mini btn-perigo dp-btn-desvincular" data-nome="${escapeAttr(l.nome)}">Desvincular</button>`;
    }
    if (l.status === 'ignorado') {
      return `<button class="btn-mini dp-btn-desfazer-ignorar" data-nome="${escapeAttr(l.nome)}" title="Reativa o nome para vinculação">↶ Reverter</button>`;
    }
    // Pendente
    if (l.sugestao) {
      return `<button class="dp-btn-aceitar" data-nome="${escapeAttr(l.nome)}" data-medico-id="${l.sugestao.id}">✓ Aceitar</button>`;
    }
    return `<button class="dp-btn-vincular" data-nome="${escapeAttr(l.nome)}" disabled>Vincular</button>`;
  }

  function renderRodape(todasLinhas) {
    const comSug = todasLinhas.filter(l => l.status === 'pendente' && l.sugestao);
    const pendentes = todasLinhas.filter(l => l.status === 'pendente');
    if (pendentes.length === 0) return '';

    return `
      <div class="dp-rodape">
        <div class="dp-rodape-info">
          ${comSug.length > 0
            ? `<div><strong>${comSug.length}</strong> sugestões automáticas baseadas em similaridade de nome</div>`
            : ''}
          <div style="font-size: 11px; color: var(--ink-faint); margin-top: ${comSug.length > 0 ? '4px' : '0'}">
            <strong>${pendentes.length}</strong> pendente${pendentes.length !== 1 ? 's' : ''} no total
          </div>
        </div>
        <div class="dp-rodape-acoes">
          ${comSug.length > 0
            ? `<button class="btn btn-pequeno" id="btn-aceitar-todas">✨ Aceitar todas as sugestões (${comSug.length})</button>`
            : ''}
          <button class="btn btn-pequeno" id="btn-pendentes-situacionais"
                  title="Cria todos como EXTERNO marcados como situacionais (médicos pontuais)">
            🩹 Pendentes → Ext. Situacionais (${pendentes.length})
          </button>
          <button class="btn btn-primary btn-pequeno" id="btn-pendentes-externos"
                  title="Cria todos os ${pendentes.length} nomes pendentes como médicos novos do tipo EXTERNO">
            🪄 Pendentes → Externos (${pendentes.length})
          </button>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // EVENTOS
  // ==========================================================================

  function bindEventos(linhas, medicos) {
    document.getElementById('btn-reescanear').addEventListener('click', () => {
      Utilidades.toast('Re-escaneando...', 'success', 1000);
      renderizar();
    });

    const selStatus = document.getElementById('dp-status');
    if (selStatus) {
      selStatus.addEventListener('change', (e) => {
        window.__dp.filtroStatus = e.target.value;
        renderizar();
      });
    }

    // Opções de todos os médicos montadas UMA vez (string reutilizável)
    const medicoOptsTodos = medicos.map(m =>
      `<option value="${m.id}">${escapeHTML(m.nome_oficial)}${m.tipo_vinculo ? ' · ' + m.tipo_vinculo : ''}</option>`
    ).join('');
    function popularSelectLazy(sel) {
      if (!sel.dataset.lazy) return;
      sel.dataset.lazy = '';
      const og = document.createElement('optgroup');
      og.label = 'Todos os médicos';
      og.innerHTML = medicoOptsTodos;
      sel.appendChild(og);
      const sel0 = sel.getAttribute('data-sel');
      if (sel0) sel.value = sel0;
    }

    // Selects de vincular: quando o usuário escolhe, ativa o botão
    document.querySelectorAll('.dp-select').forEach(sel => {
      // popula a lista completa só na 1ª interação (evita milhares de <option> no DOM)
      sel.addEventListener('mousedown', () => popularSelectLazy(sel));
      sel.addEventListener('focus', () => popularSelectLazy(sel));
      sel.addEventListener('change', (e) => {
        const nome = sel.dataset.nome;
        const valor = e.target.value;
        if (valor === '__NOVO__') {
          cadastrarNovoMedico(nome);
          sel.value = '';
        } else if (valor === '__IGNORAR__') {
          // Marca como ignorado — usa medico_id = 0 ou null? Aqui usamos
          // a abordagem: cria sinônimo com confianca = -1 marcando como "ignorar"
          // Por simplicidade, vamos só não permitir vincular. Reset.
          ignorarNome(nome);
        } else if (valor) {
          vincular(nome, Number(valor));
        }
      });
    });

    document.querySelectorAll('.dp-btn-aceitar').forEach(btn => {
      btn.addEventListener('click', () => {
        const nome = btn.dataset.nome;
        const id = Number(btn.dataset.medicoId);
        vincular(nome, id);
      });
    });

    document.querySelectorAll('.dp-btn-desvincular').forEach(btn => {
      btn.addEventListener('click', () => desvincular(btn.dataset.nome));
    });

    document.querySelectorAll('.dp-btn-desfazer-ignorar').forEach(btn => {
      btn.addEventListener('click', () => desfazerIgnorar(btn.dataset.nome));
    });

    const btnTodas = document.getElementById('btn-aceitar-todas');
    if (btnTodas) {
      btnTodas.addEventListener('click', () => aceitarTodasSugestoes(linhas));
    }

    const onExternos     = () => marcarPendentesComoExternos(linhas, { tipoVinculo: 'EXTERNO' });
    const onSituacionais = () => marcarPendentesComoExternos(linhas, { tipoVinculo: 'EXTERNO', situacional: true });

    const btnPendentesExternos = document.getElementById('btn-pendentes-externos');
    if (btnPendentesExternos) btnPendentesExternos.addEventListener('click', onExternos);

    const btnPendentesSituacionais = document.getElementById('btn-pendentes-situacionais');
    if (btnPendentesSituacionais) btnPendentesSituacionais.addEventListener('click', onSituacionais);

    const btnHeaderExt = document.getElementById('btn-header-pendentes-externos');
    if (btnHeaderExt) btnHeaderExt.addEventListener('click', onExternos);

    const btnHeaderSit = document.getElementById('btn-header-pendentes-situacionais');
    if (btnHeaderSit) btnHeaderSit.addEventListener('click', onSituacionais);
  }

  // ==========================================================================
  // AÇÕES
  // ==========================================================================

  async function vincular(nomeRelatorio, medicoId) {
    const norm = Utilidades.normalizar(nomeRelatorio);
    try {
      // Remove sinônimo antigo (se existir) e cria o novo
      Banco.executar('DELETE FROM sinonimos_medico WHERE grafia_normalizada = ?', [norm]);
      Banco.executar(
        `INSERT INTO sinonimos_medico (medico_id, grafia, grafia_normalizada, confianca, aprovado_por)
         VALUES (?, ?, ?, ?, ?)`,
        [medicoId, nomeRelatorio, norm, 1.0, 'manual']
      );
      await Banco.salvar();
      Utilidades.toast('Vinculado com sucesso!', 'success');
      renderizar();
    } catch (e) {
      console.error(e);
      Utilidades.toast('Erro ao vincular: ' + e.message, 'error');
    }
  }

  async function desvincular(nomeRelatorio) {
    if (!confirm(`Desvincular "${nomeRelatorio}"?\n\nO nome voltará a aparecer como pendente.`)) return;
    const norm = Utilidades.normalizar(nomeRelatorio);
    Banco.executar('DELETE FROM sinonimos_medico WHERE grafia_normalizada = ?', [norm]);
    await Banco.salvar();
    Utilidades.toast('Desvinculado', 'success');
    renderizar();
  }

  async function aceitarTodasSugestoes(linhas) {
    const sugestoes = linhas.filter(l => l.status === 'pendente' && l.sugestao);
    if (sugestoes.length === 0) return;
    if (!confirm(`Aceitar todas as ${sugestoes.length} sugestões automáticas?\n\nVocê pode revisar e desvincular individualmente depois.`)) return;

    Utilidades.mostrarLoading('Vinculando...');
    try {
      for (const s of sugestoes) {
        const norm = Utilidades.normalizar(s.nome);
        Banco.executar('DELETE FROM sinonimos_medico WHERE grafia_normalizada = ?', [norm]);
        Banco.executar(
          `INSERT INTO sinonimos_medico (medico_id, grafia, grafia_normalizada, confianca, aprovado_por)
           VALUES (?, ?, ?, ?, ?)`,
          [s.sugestao.id, s.nome, norm, 0.85, 'auto']
        );
      }
      await Banco.salvar();
      Utilidades.esconderLoading();
      Utilidades.toast(`${sugestoes.length} sugestões aceitas!`, 'success');
      renderizar();
    } catch (e) {
      Utilidades.esconderLoading();
      Utilidades.toast('Erro: ' + e.message, 'error');
    }
  }

  /**
   * Cadastra TODOS os nomes pendentes como médicos do tipo informado.
   *
   * @param {object[]} linhas - lista de linhas atual (com status)
   * @param {object}   opts
   * @param {string}   opts.tipoVinculo - 'INTERNO' | 'HIBRIDO' | 'EXTERNO'
   * @param {boolean}  [opts.situacional=false] - marca como externo situacional
   *                   (médico que aparece só pontualmente, ex: anestesistas)
   *
   * Para cada pendente:
   *   1. Cria registro em `medicos` com tipo_vinculo + situacional + nome
   *      capitalizado (ex: "JOÃO SILVA" → "João Silva")
   *   2. Se já existe um médico com o mesmo nome_normalizado, reaproveita
   *   3. Se a grafia difere do nome capitalizado, cria sinonimos_medico
   *
   * Todo o batch roda em transação SQL (BEGIN/COMMIT/ROLLBACK).
   */
  async function marcarPendentesComoExternos(linhas, opts) {
    opts = opts || {};
    const tipoVinculo = opts.tipoVinculo || 'EXTERNO';
    const situacional = opts.situacional ? 1 : 0;
    const pendentes = linhas.filter(l => l.status === 'pendente');
    if (pendentes.length === 0) return;

    const rotuloTipo = situacional ? 'EXTERNOS SITUACIONAIS' : tipoVinculo + 'S';
    const observacao = situacional
      ? 'Marcador "situacional" indica que aparecem só pontualmente na produção.\n'
      : '';
    if (!confirm(
        `Cadastrar todos os ${pendentes.length} nomes pendentes como ${rotuloTipo}?\n\n` +
        observacao +
        `Você pode editar individualmente depois na tela de Médicos.`)) return;

    Utilidades.mostrarLoading(`Cadastrando ${rotuloTipo.toLowerCase()}...`);
    try {
      Banco.db.exec('BEGIN');

      let criados = 0;
      let jaExistiam = 0;
      let vinculados = 0;

      for (const p of pendentes) {
        const nomeOficial = capitalizar(p.nome);
        const normOficial = Utilidades.normalizar(nomeOficial);
        const normRel     = Utilidades.normalizar(p.nome);

        const existente = Banco.queryUnica(
          `SELECT id FROM medicos WHERE nome_normalizado = ? AND ativo = 1`,
          [normOficial]
        );

        let medicoId;
        if (existente) {
          medicoId = existente.id;
          jaExistiam++;
        } else {
          Banco.executar(
            `INSERT INTO medicos (nome_oficial, nome_normalizado, tipo_vinculo, situacional, ativo)
             VALUES (?, ?, ?, ?, 1)`,
            [nomeOficial, normOficial, tipoVinculo, situacional]
          );
          const r = Banco.queryUnica(
            `SELECT id FROM medicos WHERE nome_normalizado = ? ORDER BY id DESC LIMIT 1`,
            [normOficial]
          );
          medicoId = r.id;
          criados++;
        }

        if (normRel !== normOficial) {
          Banco.executar('DELETE FROM sinonimos_medico WHERE grafia_normalizada = ?', [normRel]);
          Banco.executar(
            `INSERT INTO sinonimos_medico (medico_id, grafia, grafia_normalizada, confianca, aprovado_por)
             VALUES (?, ?, ?, 1.0, ?)`,
            [medicoId, p.nome, normRel, situacional ? 'lote-externo-situacional' : 'lote-externo']
          );
          vinculados++;
        }
      }

      Banco.db.exec('COMMIT');
      await Banco.salvar();
      Utilidades.esconderLoading();

      const msg = jaExistiam > 0
        ? `${criados} criado(s) + ${jaExistiam} já existente(s) reaproveitado(s)`
        : `${criados} médico(s) criado(s) como ${rotuloTipo}`;
      Utilidades.toast(`✓ ${msg}`, 'success', 3500);
      renderizar();
    } catch (e) {
      try { Banco.db.exec('ROLLBACK'); } catch (_) {}
      Utilidades.esconderLoading();
      console.error(e);
      Utilidades.toast('Erro: ' + e.message, 'error');
    }
  }

  async function cadastrarNovoMedico(nomeRelatorio) {
    const tipo = prompt(
      `Cadastrar "${nomeRelatorio}" como novo médico?\n\n` +
      `Tipo de vínculo:\n` +
      `  1 = INTERNO (recebe repasse)\n` +
      `  2 = HIBRIDO (recebe repasse)\n` +
      `  3 = EXTERNO (não recebe)\n\n` +
      `Digite 1, 2 ou 3:`
    );
    if (!tipo) return;
    const tipoMap = { '1': 'INTERNO', '2': 'HIBRIDO', '3': 'EXTERNO' };
    const tipoVinculo = tipoMap[tipo.trim()];
    if (!tipoVinculo) {
      alert('Tipo inválido. Cancelado.');
      return;
    }

    try {
      // Cria o médico com o nome do relatório (capitalizado)
      const nomeOficial = capitalizar(nomeRelatorio);
      const norm = Utilidades.normalizar(nomeOficial);
      const r = Banco.executar(
        `INSERT INTO medicos (nome_oficial, nome_normalizado, tipo_vinculo, ativo)
         VALUES (?, ?, ?, 1)`,
        [nomeOficial, norm, tipoVinculo]
      );
      const medicoId = r.lastInsertRowId;

      // Cria também o sinônimo (caso a grafia normalizada seja diferente)
      const normRel = Utilidades.normalizar(nomeRelatorio);
      if (normRel !== norm) {
        Banco.executar(
          `INSERT INTO sinonimos_medico (medico_id, grafia, grafia_normalizada, confianca, aprovado_por)
           VALUES (?, ?, ?, 1.0, 'manual')`,
          [medicoId, nomeRelatorio, normRel]
        );
      }
      await Banco.salvar();
      Utilidades.toast(`"${nomeOficial}" cadastrado como ${tipoVinculo}!`, 'success');
      renderizar();
    } catch (e) {
      console.error(e);
      alert('Erro: ' + e.message);
    }
  }

  async function ignorarNome(nomeRelatorio) {
    const norm = Utilidades.normalizar(nomeRelatorio);
    try {
      // Remove qualquer sinônimo existente (precedência: ignorar > sinônimo)
      Banco.executar('DELETE FROM sinonimos_medico WHERE grafia_normalizada = ?', [norm]);
      // Insere ou atualiza em nomes_ignorados
      Banco.executar('DELETE FROM nomes_ignorados WHERE grafia_normalizada = ?', [norm]);
      Banco.executar(
        `INSERT INTO nomes_ignorados (grafia, grafia_normalizada) VALUES (?, ?)`,
        [nomeRelatorio, norm]
      );
      await Banco.salvar();
      Utilidades.toast('✓ Nome marcado como ignorado', 'success');
      renderizar();
    } catch (e) {
      console.error(e);
      Utilidades.toast('Erro ao ignorar: ' + e.message, 'error');
    }
  }

  async function desfazerIgnorar(nomeRelatorio) {
    const norm = Utilidades.normalizar(nomeRelatorio);
    try {
      Banco.executar('DELETE FROM nomes_ignorados WHERE grafia_normalizada = ?', [norm]);
      await Banco.salvar();
      Utilidades.toast('Nome removido da lista de ignorados', 'success');
      renderizar();
    } catch (e) {
      console.error(e);
      Utilidades.toast('Erro: ' + e.message, 'error');
    }
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  function capitalizar(texto) {
    // "WILLIAN FAGUNDES PFEILSTICKER" → "Willian Fagundes Pfeilsticker"
    return String(texto || '').toLowerCase().split(/\s+/).map(p =>
      p.length > 2
        ? p.charAt(0).toUpperCase() + p.slice(1)
        : p.toLowerCase()  // "de", "da", "do" minúsculas
    ).join(' ');
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHTML(s);
  }

  // ==========================================================================
  // ESTILOS
  // ==========================================================================

  function getStyles() {
    return `
      <style>
        .dp-stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-bottom: 18px;
        }
        .dp-stat {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-left: 3px solid var(--ink-soft);
          border-radius: 10px;
          padding: 12px 14px;
        }
        .dp-stat-total   { border-left-color: var(--primary); }
        .dp-stat-ok      { border-left-color: #0A7A5A; }
        .dp-stat-alerta  { background: #FCEFEF; border-color: #E8B6B6; border-left-color: #9B3A3A; }
        .dp-stat-sugestao{ border-left-color: var(--accent); }
        .dp-stat-label {
          font-size: 10px;
          color: var(--ink-soft);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          font-weight: 600;
          margin-bottom: 4px;
        }
        .dp-stat-valor {
          font-size: 22px;
          font-weight: 700;
          color: var(--ink);
          line-height: 1;
        }
        .dp-stat-alerta .dp-stat-valor   { color: #9B3A3A; }
        .dp-stat-ok      .dp-stat-valor  { color: #0A7A5A; }
        .dp-stat-sugestao .dp-stat-valor { color: var(--accent); }

        .dp-filtros {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
          align-items: center;
        }

        .dp-tabela tr.dp-linha-sugestao { background: #E1EFF6; }
        .dp-tabela tr.dp-linha-ok       { background: rgba(216, 234, 211, 0.3); }
        .dp-tabela tr.dp-linha-ignorado { background: rgba(0, 0, 0, 0.025); }
        .dp-tabela tr.dp-linha-ignorado td { color: var(--ink-faint); }

        .dp-select {
          padding: 5px 8px;
          font-size: 12px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--bg-elevated);
          width: 100%;
          max-width: 380px;
        }
        .dp-select-sugestao {
          border-color: var(--accent);
          background: #E1EFF6;
          font-weight: 600;
        }

        .dp-status-display {
          font-size: 12px;
          color: var(--ink-soft);
        }
        .dp-status-direto strong { color: #0A7A5A; }
        .dp-status-ignorado {
          color: var(--ink-faint);
          font-style: italic;
        }
        .dp-status-sub {
          font-size: 10px;
          color: var(--ink-faint);
          margin-left: 4px;
        }

        .dp-badge-ok {
          display: inline-block;
          padding: 1px 6px;
          background: #DBF0F9;
          color: #005073;
          border: 1px solid #9FD9C7;
          border-radius: 4px;
          font-size: 9px;
          font-weight: 600;
        }
        .dp-badge-sin {
          display: inline-block;
          padding: 1px 6px;
          background: #E8EDE9;
          color: #005073;
          border: 1px solid #C2D2C9;
          border-radius: 4px;
          font-size: 9px;
          font-weight: 600;
        }
        .dp-badge-ignorado {
          display: inline-block;
          padding: 1px 6px;
          background: #EFE9DF;
          color: #6B5C45;
          border: 1px solid #D4C8B0;
          border-radius: 4px;
          font-size: 9px;
          font-weight: 600;
          font-style: italic;
        }

        .dp-btn-aceitar, .dp-btn-vincular {
          padding: 3px 10px;
          font-size: 11px;
          font-weight: 600;
          border-radius: 5px;
          cursor: pointer;
          border: 1px solid;
        }
        .dp-btn-aceitar {
          background: var(--primary);
          color: white;
          border-color: var(--primary);
        }
        .dp-btn-aceitar:hover { background: var(--primary-hover, #0C3A2F); }
        .dp-btn-vincular {
          background: var(--bg-elevated);
          color: var(--ink-soft);
          border-color: var(--border);
        }
        .dp-btn-vincular:disabled { opacity: 0.5; cursor: not-allowed; }

        .btn-mini {
          padding: 2px 8px;
          font-size: 10px;
          font-weight: 600;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 4px;
          cursor: pointer;
          color: var(--ink-soft);
        }
        .btn-mini.btn-perigo { color: #9B3A3A; }
        .btn-mini:hover { background: var(--bg-sunken); }

        .dp-rodape {
          margin-top: 14px;
          padding: 12px 14px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .dp-rodape-info { color: var(--ink-soft); font-size: 12px; }
        .dp-rodape-info strong { color: var(--ink); }
        .dp-rodape-acoes { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

        .btn-pequeno { padding: 6px 12px; font-size: 12px; font-weight: 600; }
      </style>
    `;
  }
};
