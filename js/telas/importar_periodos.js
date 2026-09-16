/**
 * ============================================================================
 * MÓDULO: Importação de Períodos por Unidade
 *
 * Helper consumido pelo fichário "desempenho-periodos".
 * Não é uma tela registrada — apenas expõe `window.ImportPeriodos`:
 *
 *   ImportPeriodos.abrirModal(callback)   -- abre o modal de upload
 *   ImportPeriodos.formatarMes(mes_ref)   -- 'Abr/26'
 *   ImportPeriodos.excluirMes(mes_ref, cb)-- DELETE + save (com confirm)
 * ============================================================================
 */

(function () {
  'use strict';

  const MESES_LABELS = {
    'jan': 1, 'fev': 2, 'mar': 3, 'abr': 4, 'mai': 5, 'jun': 6,
    'jul': 7, 'ago': 8, 'set': 9, 'out': 10, 'nov': 11, 'dez': 12,
  };

  function normalizar(s) {
    if (!s) return '';
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  }

  function escapeHTML(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmt(n, casas = 0) { return Utilidades.formatarNumero(n || 0, casas); }

  function formatarMes(mes_ref) {
    if (!mes_ref) return '—';
    const [ano, mes] = mes_ref.split('-');
    const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${nomes[parseInt(mes) - 1]}/${ano.slice(2)}`;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Parser
  // ──────────────────────────────────────────────────────────────────────

  function detectarMesAba(nomeAba) {
    if (!nomeAba) return null;
    const limpo = normalizar(nomeAba).replace(/[\/\-_]/g, ' ').replace(/\s+/g, ' ');
    const partes = limpo.split(' ').filter(Boolean);
    if (partes.length !== 2) return null;
    const [p1, p2] = partes;

    let mes = null;
    if (/^\d{1,2}$/.test(p1)) {
      const n = parseInt(p1, 10);
      if (n >= 1 && n <= 12) mes = n;
    } else {
      const abrev = p1.slice(0, 3).toLowerCase();
      mes = MESES_LABELS[abrev];
    }
    if (!mes) return null;

    let ano = null;
    if (/^\d{2}$/.test(p2)) ano = 2000 + parseInt(p2, 10);
    else if (/^\d{4}$/.test(p2)) ano = parseInt(p2, 10);
    if (!ano || ano < 2020 || ano > 2099) return null;

    return { ano, mes };
  }

  function parseCadastroValores(workbook) {
    const aba = workbook.Sheets['Cadastro Valores'];
    if (!aba) return { padrao: 700, especiais: [] };
    // Força range desde A1 pra evitar shifts
    const rows = window.XLSX.utils.sheet_to_json(aba, {
      header: 1, raw: true, defval: null,
      range: { s: { c: 0, r: 0 }, e: { c: 10, r: 70 } },
    });

    // Procura o "VALOR PADRÃO" e o número à direita (até 4 colunas pra frente)
    let padrao = 700;
    for (let r = 0; r < Math.min(rows.length, 12); r++) {
      const linha = rows[r] || [];
      for (let c = 0; c < linha.length; c++) {
        const v = String(linha[c] || '').toLowerCase();
        if (v.includes('aplicado a todos') || v.includes('valor padrão')) {
          // Procura número na mesma linha ou na próxima, à direita
          for (let rr = r; rr <= r + 1 && rr < rows.length; rr++) {
            for (let cc = c; cc < (rows[rr] || []).length; cc++) {
              const candidato = Number(rows[rr]?.[cc]);
              if (isFinite(candidato) && candidato > 0 && candidato < 100000) {
                padrao = candidato;
                break;
              }
            }
            if (padrao !== 700) break;
          }
          break;
        }
      }
      if (padrao !== 700) break;
    }

    // Procura a linha-cabeçalho "Médico | Unidade | Valor/Período" e lê dali pra baixo
    const especiais = [];
    let headerRow = -1, colNome = -1, colUnidade = -1, colValor = -1;
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const linha = rows[r] || [];
      for (let c = 0; c < linha.length; c++) {
        const v = String(linha[c] || '').toLowerCase().trim();
        if (v.startsWith('médic') || v === 'medico' || v === 'fellow') {
          // Verifica se essa linha também tem "valor" em alguma coluna
          for (let cc = c; cc < linha.length; cc++) {
            const v2 = String(linha[cc] || '').toLowerCase();
            if (v2.includes('valor') && v2.includes('per')) {
              headerRow = r;
              colNome = c;
              colValor = cc;
              // Unidade: procura entre nome e valor
              for (let cu = c + 1; cu < cc; cu++) {
                const vu = String(linha[cu] || '').toLowerCase();
                if (vu.includes('unidad')) { colUnidade = cu; break; }
              }
              break;
            }
          }
        }
        if (headerRow >= 0) break;
      }
      if (headerRow >= 0) break;
    }

    if (headerRow >= 0) {
      for (let i = headerRow + 1; i < rows.length && i < headerRow + 100; i++) {
        const linha = rows[i];
        if (!linha) continue;
        const nome = (linha[colNome] || '').toString().trim();
        const unidade = colUnidade >= 0 ? ((linha[colUnidade] || '').toString().trim() || null) : null;
        const valor = Number(linha[colValor]);
        if (nome && isFinite(valor) && valor > 0) {
          especiais.push({
            nome_original: nome,
            nome_normalizado: normalizar(nome),
            unidade: unidade || null,
            valor,
          });
        }
      }
    }

    return { padrao, especiais };
  }

  /**
   * Localiza a linha do cabeçalho e o índice de cada coluna importante.
   * Procura nas primeiras 10 linhas por uma célula contendo "médic" e usa
   * essa linha como header. As demais colunas são encontradas relativamente.
   */
  function detectarBlocos(rows) {
    const norm = s => String(s == null ? '' : s).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    const blocos = [];
    for (let r = 0; r < rows.length; r++) {
      const linha = rows[r] || [];
      let colVP = -1, colVR = -1, colMedicoHdr = -1, colUnidadeHdr = -1;
      for (let c = 0; c < linha.length; c++) {
        const v = norm(linha[c]);
        if (!v) continue;
        // V624: aceita variações — "Valor Período", "Valor do Período", "Valor por Período", "Valor/Período"
        if (colVP < 0 && (v === 'valor periodo' || v === 'valor do periodo' || v === 'valor por periodo' ||
                          v.startsWith('valor periodo') || v.startsWith('valor por periodo') || v === 'valor/periodo')) colVP = c;
        // V624: a coluna de conferência pode ser "Valor Repasse" OU "Total dos períodos" (total em R$)
        else if (colVR < 0 && (v === 'valor repasse' || v.startsWith('valor repasse') || v === 'repasse' || v === 'valor do repasse' ||
                               v.startsWith('total dos periodos') || v.startsWith('total do periodo') || v === 'total periodos')) colVR = c;
        else if (colMedicoHdr < 0 && (v.startsWith('medic') || v === 'fellow')) colMedicoHdr = c;
        else if (colUnidadeHdr < 0 && v.startsWith('unidade')) colUnidadeHdr = c;
      }
      if (colVP < 0) continue; // linha não é cabeçalho de bloco
      // Colunas de semana = tudo ENTRE "Valor Período" e a coluna de conferência (senão, as 5 seguintes)
      const colsSemana = [];
      if (colVR > colVP + 1) { for (let c = colVP + 1; c < colVR; c++) colsSemana.push(c); }
      else { for (let c = colVP + 1; c <= colVP + 5; c++) colsSemana.push(c); }
      // V624: LAYOUT COM COLUNAS PRÓPRIAS — o cabeçalho tem "Médico" (e opcionalmente
      // "Unidade de Atendimento"): médico sai da coluna Médico e a UNIDADE sai de
      // cada LINHA, não do topo do bloco.
      if (colMedicoHdr >= 0) {
        blocos.push({ headerRow: r, colMedico: colMedicoHdr,
                      colUnidadeLinha: colUnidadeHdr, unidadeNome: '',
                      colVP, colVR, colsSemana });
        continue;
      }
      // Layout original: unidade = célula de texto imediatamente à esquerda de "Valor Período"
      let colUnidade = 0;
      for (let c = colVP - 1; c >= 0; c--) { if (norm(linha[c])) { colUnidade = c; break; } }
      const unidadeNome = String(linha[colUnidade] == null ? '' : linha[colUnidade]).trim();
      blocos.push({ headerRow: r, colMedico: colUnidade, colUnidadeLinha: -1, unidadeNome, colVP, colVR, colsSemana });
    }
    return blocos;
  }

  function parseAbaMensal(workbook, nomeAba, cadastro) {
    const mesInfo = detectarMesAba(nomeAba);
    const mes_ref = mesInfo ? `${mesInfo.ano}-${String(mesInfo.mes).padStart(2, '0')}` : null;

    const aba = workbook.Sheets[nomeAba];
    if (!aba) return null;
    // Força range desde A1 pra evitar shifts quando !ref começa em B1
    const rows = window.XLSX.utils.sheet_to_json(aba, {
      header: 1, raw: true, defval: null,
      range: { s: { c: 0, r: 0 }, e: { c: 15, r: 70 } },
    });

    const blocos = detectarBlocos(rows);
    if (!blocos.length) {
      return { mes_ref, mesDetectado: !!mesInfo, linhas: [], problemas: ['Cabeçalho de bloco (Valor Período / semanas / Valor Repasse) não encontrado.'] };
    }

    const linhas = [];
    const problemas = [];
    // Cada bloco = uma unidade (nome no topo, à esquerda de "Valor Período"). Lê os médicos
    // do bloco até o próximo cabeçalho de bloco, pulando linhas de subtotal (coluna do médico vazia).
    for (let b = 0; b < blocos.length; b++) {
      const bloco = blocos[b];
      const fim = (b + 1 < blocos.length) ? blocos[b + 1].headerRow : rows.length;

      for (let i = bloco.headerRow + 1; i < fim; i++) {
        const r = rows[i];
        if (!r) continue;
        const nome = (r[bloco.colMedico] == null ? '' : r[bloco.colMedico]).toString().trim();
        if (!nome) continue;                                   // linha de subtotal / separadora
        if (/^(total|subtotal|soma|geral)\b/i.test(nome)) continue;
        // V624: layout com coluna própria de unidade → unidade vem da LINHA;
        // senão, do topo do bloco (layout original)
        const unidade = (bloco.colUnidadeLinha != null && bloco.colUnidadeLinha >= 0)
          ? (r[bloco.colUnidadeLinha] == null ? '' : r[bloco.colUnidadeLinha]).toString().trim()
          : bloco.unidadeNome;
        if (!unidade) { problemas.push(`Linha ${i + 1}: médico "${nome}" sem unidade — ignorado.`); continue; }

        const sems = bloco.colsSemana.map(c => parseInt(r[c]) || 0);
        const sem1 = sems[0] || 0, sem2 = sems[1] || 0, sem3 = sems[2] || 0, sem4 = sems[3] || 0, sem5 = sems[4] || 0;
        const total_periodos = sems.reduce((a, v) => a + (v || 0), 0);

        const nomeNorm = normalizar(nome);
        const especial = cadastro.especiais.find(e =>
          e.nome_normalizado === nomeNorm &&
          (e.unidade === null || normalizar(e.unidade) === normalizar(unidade))
        );
        // Valor por período: prioriza a coluna "Valor Período" da planilha; se vazia, cai no cadastro.
        const valorPlan = Number(bloco.colVP >= 0 ? r[bloco.colVP] : NaN);
        const valor_periodo = (Number.isFinite(valorPlan) && valorPlan > 0)
          ? valorPlan
          : (especial ? especial.valor : cadastro.padrao);
        const total_valor = total_periodos * valor_periodo;

        // Confere contra a coluna "Valor Repasse"/"Total dos períodos", se houver (só avisa; não bloqueia).
        // V624: se a coluna de conferência trouxer a QUANTIDADE de períodos (não R$), não avisa.
        const repassePlan = Number(bloco.colVR >= 0 ? r[bloco.colVR] : NaN);
        if (Number.isFinite(repassePlan) && Math.abs(repassePlan - total_valor) > 0.5 &&
            Math.abs(repassePlan - total_periodos) > 0.5) {
          problemas.push(`Linha ${i + 1} (${nome} · ${unidade}): repasse da planilha R$ ${repassePlan} ≠ calculado R$ ${total_valor}. Usei o calculado (${total_periodos} × ${valor_periodo}).`);
        }

        linhas.push({
          mes_ref,
          nome_original: nome,
          nome_normalizado: nomeNorm,
          unidade,
          valor_periodo,
          sem1, sem2, sem3, sem4, sem5,
          total_periodos,
          total_valor,
          usou_especial: !!especial || (Number.isFinite(valorPlan) && valorPlan > 0 && valorPlan !== cadastro.padrao),
        });
      }
    }

    // Agrega duplicatas: o mesmo médico + unidade no mesmo mês deve virar UMA linha
    // (planilhas em formato "uma linha por período/semana" ou com repetições somam).
    // Evita violar o UNIQUE(mes_ref, nome_normalizado, unidade).
    const mapa = new Map();
    for (const l of linhas) {
      const k = l.nome_normalizado + '||' + normalizar(l.unidade);
      if (mapa.has(k)) {
        const ex = mapa.get(k);
        ex.sem1 += l.sem1; ex.sem2 += l.sem2; ex.sem3 += l.sem3; ex.sem4 += l.sem4; ex.sem5 += l.sem5;
        ex.total_periodos += l.total_periodos;
        ex.total_valor = ex.total_periodos * ex.valor_periodo;
      } else {
        mapa.set(k, { ...l });
      }
    }
    const linhasAgrupadas = Array.from(mapa.values());
    if (linhasAgrupadas.length < linhas.length) {
      problemas.push(`${linhas.length - linhasAgrupadas.length} linha(s) duplicada(s) de médico+unidade foram somadas.`);
    }

    return { mes_ref, mesDetectado: !!mesInfo, linhas: linhasAgrupadas, problemas };
  }

  function analisarWorkbook(workbook) {
    const cadastro = parseCadastroValores(workbook);
    const abasMensais = [];
    const debug = { abasIgnoradas: [], abasSemDados: [] };

    // Pré-carrega cache de unidades existentes (nome normalizado → id)
    const unidadesCache = new Map();
    try {
      const rows = Banco.query(`SELECT id, nome FROM unidades WHERE ativo = 1`);
      rows.forEach(r => unidadesCache.set(normalizar(r.nome), { id: r.id, nome: r.nome }));
    } catch (e) { /* ignora */ }

    // Coleta TODAS as unidades que aparecem na planilha (pra criar as faltantes depois)
    const unidadesNaPlanilha = new Map();

    for (const nomeAba of workbook.SheetNames) {
      const parsed = parseAbaMensal(workbook, nomeAba, cadastro);
      if (parsed && parsed.linhas.length > 0) {
        // Resolve unidade_id em cada linha + coleta unidades faltantes
        for (const l of parsed.linhas) {
          const unidNorm = normalizar(l.unidade);
          if (unidadesCache.has(unidNorm)) {
            l.unidade_id = unidadesCache.get(unidNorm).id;
            l.unidade_status = 'existente';
          } else {
            l.unidade_id = null;
            l.unidade_status = 'a_criar';
            if (!unidadesNaPlanilha.has(unidNorm)) {
              unidadesNaPlanilha.set(unidNorm, l.unidade);
            }
          }
        }

        abasMensais.push({
          nome_aba: nomeAba,
          mes_ref: parsed.mes_ref,          // pode ser null (mês não está no nome da aba)
          mesDetectado: parsed.mesDetectado,
          linhas: parsed.linhas,
          problemas: parsed.problemas,
          total_periodos: parsed.linhas.reduce((s, l) => s + l.total_periodos, 0),
          total_valor: parsed.linhas.reduce((s, l) => s + l.total_valor, 0),
        });
      } else if (parsed) {
        debug.abasSemDados.push({ nome: nomeAba, problemas: parsed.problemas || [] });
      } else {
        debug.abasIgnoradas.push(nomeAba);
      }
    }

    abasMensais.sort((a, b) => String(a.mes_ref || '9999-99').localeCompare(String(b.mes_ref || '9999-99')));

    // Log
    console.group('📥 ImportPeriodos — análise');
    console.log(`Abas no arquivo: ${workbook.SheetNames.length}`);
    console.log(`Abas mensais com dados: ${abasMensais.length}`);
    if (debug.abasIgnoradas.length > 0) {
      console.log(`Abas ignoradas (nome não é mensal):`, debug.abasIgnoradas);
    }
    if (debug.abasSemDados.length > 0) {
      console.log(`Abas mensais SEM dados:`, debug.abasSemDados);
    }
    console.log(`Valor padrão detectado: R$ ${cadastro.padrao}`);
    console.log(`Valores especiais: ${cadastro.especiais.length}`);
    console.log(`Unidades a criar (não existem no cadastro):`, Array.from(unidadesNaPlanilha.values()));
    console.groupEnd();

    const unidadesACriar = Array.from(unidadesNaPlanilha.values());
    return { cadastro, abasMensais, unidadesACriar };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Persistência
  // ──────────────────────────────────────────────────────────────────────

  function salvarMes(abaMensal) {
    const { mes_ref, linhas } = abaMensal;

    const stmtDel = Banco.db.prepare(`DELETE FROM periodos_linhas WHERE mes_ref = ?`);
    try { stmtDel.run([mes_ref]); } finally { stmtDel.free(); }

    if (linhas.length === 0) return 0;

    const stmt = Banco.db.prepare(`
      INSERT INTO periodos_linhas (
        mes_ref, nome_original, nome_normalizado, unidade, unidade_id, valor_periodo,
        sem1, sem2, sem3, sem4, sem5, total_periodos, total_valor, origem
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    try {
      for (const l of linhas) {
        stmt.run([
          l.mes_ref, l.nome_original, l.nome_normalizado, l.unidade, l.unidade_id || null, l.valor_periodo,
          l.sem1, l.sem2, l.sem3, l.sem4, l.sem5, l.total_periodos, l.total_valor,
          'planilha',
        ]);
      }
    } finally {
      stmt.free();
    }
    return linhas.length;
  }

  /**
   * Cria as unidades novas que apareceram na planilha mas não estão cadastradas.
   * Retorna mapa atualizado nome_normalizado → id.
   */
  function criarUnidadesFaltantes(unidadesACriar) {
    if (!unidadesACriar || unidadesACriar.length === 0) return new Map();

    const stmt = Banco.db.prepare(`
      INSERT INTO unidades (nome, ordem, ativo) VALUES (?, ?, 1)
    `);
    const novoMapa = new Map();
    try {
      // Próxima ordem disponível
      const ordemMax = Banco.queryUnica(`SELECT COALESCE(MAX(ordem), 0) AS m FROM unidades`);
      let nextOrdem = (ordemMax?.m || 0) + 1;

      for (const nome of unidadesACriar) {
        try {
          stmt.run([nome, nextOrdem++]);
          // Pega o id que acabou de ser criado
          const row = Banco.queryUnica(`SELECT id FROM unidades WHERE nome = ?`, [nome]);
          if (row) novoMapa.set(normalizar(nome), row.id);
        } catch (e) {
          // UNIQUE constraint pode falhar se outra sessão criou — busca o id existente
          const row = Banco.queryUnica(`SELECT id FROM unidades WHERE nome = ?`, [nome]);
          if (row) novoMapa.set(normalizar(nome), row.id);
        }
      }
    } finally {
      stmt.free();
    }
    return novoMapa;
  }

  function salvarCadastro(cadastro) {
    const stmtConfig = Banco.db.prepare(`
      INSERT INTO periodos_config (chave, valor) VALUES (?, ?)
      ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = CURRENT_TIMESTAMP
    `);
    try {
      stmtConfig.run(['VALOR_PADRAO_PERIODO', String(cadastro.padrao)]);
    } finally {
      stmtConfig.free();
    }

    Banco.db.exec(`DELETE FROM periodos_cadastro_valor`);

    if (cadastro.especiais.length === 0) return;
    const stmt = Banco.db.prepare(`
      INSERT OR IGNORE INTO periodos_cadastro_valor (nome_normalizado, nome_original, unidade, valor_periodo)
      VALUES (?, ?, ?, ?)
    `);
    try {
      for (const e of cadastro.especiais) {
        stmt.run([e.nome_normalizado, e.nome_original, e.unidade, e.valor]);
      }
    } finally {
      stmt.free();
    }
  }

  function excluirMes(mes_ref, onSuccess) {
    if (!confirm(`Excluir todos os dados de ${formatarMes(mes_ref)}? Esta ação não pode ser desfeita.`)) return;
    const stmt = Banco.db.prepare(`DELETE FROM periodos_linhas WHERE mes_ref = ?`);
    try { stmt.run([mes_ref]); } finally { stmt.free(); }
    Banco.salvar().then(() => {
      Utilidades.toast('Importação excluída', 'success');
      if (onSuccess) onSuccess();
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // UI: modal de importação
  // ──────────────────────────────────────────────────────────────────────

  function abrirModalUpload(onImportConcluida) {
    const overlay = document.createElement('div');
    overlay.className = 'impper-modal-overlay';
    overlay.innerHTML = `
      <div class="impper-modal" style="width: 500px">
        <div class="impper-modal-header">
          <span>📥 Importar Planilha de Períodos</span>
          <button class="impper-modal-fechar" id="impper-cancel">✕</button>
        </div>
        <div class="impper-modal-body">
          <div class="impper-upload-area" id="impper-drop-area">
            <div style="font-size: 36px; margin-bottom: 8px;">📂</div>
            <div style="font-weight: 700; margin-bottom: 4px;">Selecione a planilha "Repasse Médico - Períodos"</div>
            <div style="font-size: 11px; color: var(--ink-soft); margin-bottom: 14px;">Aceita o template completo (12 abas mensais) ou avulso.</div>
            <button class="btn btn-primary" id="impper-pick">📂 Escolher arquivo Excel</button>
            <input type="file" id="impper-file" accept=".xlsx,.xls" style="display:none">
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const fechar = () => overlay.remove();
    document.getElementById('impper-cancel').addEventListener('click', fechar);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });

    const fileInput = document.getElementById('impper-file');
    document.getElementById('impper-pick').addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const buf = await f.arrayBuffer();
        const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
        const analise = analisarWorkbook(wb);

        if (analise.abasMensais.length === 0) {
          // Diagnóstico: mostra as primeiras linhas de cada aba pra identificar o cabeçalho
          let diag = '';
          try {
            for (const nomeAba of wb.SheetNames.slice(0, 3)) {
              const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], {
                header: 1, raw: true, defval: null, range: { s: { c: 0, r: 0 }, e: { c: 12, r: 6 } },
              });
              diag += `\n— Aba "${nomeAba}":\n`;
              rows.slice(0, 6).forEach((lin, i) => {
                const cels = (lin || []).map(x => x == null ? '' : String(x)).filter(x => x.trim() !== '');
                if (cels.length) diag += `   linha ${i + 1}: ${cels.join(' | ').slice(0, 120)}\n`;
              });
            }
          } catch (e) {}
          alert('❌ Não encontrei o cabeçalho de Períodos (colunas Médico, Unidade e Semanas/Períodos).\n\n' +
            'Veja abaixo o que li nas primeiras linhas — me mande isso que eu ajusto a leitura:\n' + diag);
          console.log('[ImportPeriodos] diagnóstico de cabeçalho:', diag);
          return;
        }

        fechar();
        mostrarConfirmacao(f, wb, analise, onImportConcluida);
      } catch (e) {
        console.error(e);
        alert(`❌ Erro ao ler o arquivo:\n\n${e.message}`);
      }
    });
  }

  function mostrarConfirmacao(file, wb, analise, onImportConcluida) {
    const mesesExistentes = new Set();
    try {
      Banco.query(`SELECT DISTINCT mes_ref FROM periodos_linhas`).forEach(r => mesesExistentes.add(r.mes_ref));
    } catch (e) { /* tabela pode não existir */ }

    // palpite de mês para abas sem mês no nome: último mês existente + 1, senão mês atual
    function palpiteMes() {
      let latest = null;
      mesesExistentes.forEach(m => { if (!latest || m > latest) latest = m; });
      if (latest && /^\d{4}-\d{2}$/.test(latest)) {
        let [a, m] = latest.split('-').map(Number); m++; if (m > 12) { m = 1; a++; }
        return `${a}-${String(m).padStart(2, '0')}`;
      }
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    // aplica um mes_ref a uma aba E a todas as suas linhas
    function setMesAba(aba, mes) {
      aba.mes_ref = mes;
      aba.linhas.forEach(l => { l.mes_ref = mes; });
    }
    // pré-preenche abas sem mês com o palpite (usuário confere/corrige)
    analise.abasMensais.forEach(a => { if (!a.mes_ref) { setMesAba(a, palpiteMes()); a.mesDetectado = false; } });

    const modal = document.createElement('div');
    modal.className = 'impper-modal-overlay';
    document.body.appendChild(modal);
    const fechar = () => modal.remove();

    function render() {
      const abas = analise.abasMensais;
      const totalLinhas = abas.reduce((s, a) => s + a.linhas.length, 0);
      const totalValor = abas.reduce((s, a) => s + a.total_valor, 0);
      const semMes = abas.filter(a => !a.mesDetectado);

      modal.innerHTML = `
      <div class="impper-modal">
        <div class="impper-modal-header">
          <span>📥 Confirmar Importação</span>
          <button class="impper-modal-fechar" id="impper-cancel">✕</button>
        </div>
        <div class="impper-modal-body">
          <div class="impper-resumo">
            <div class="impper-resumo-item">
              <div class="impper-resumo-label">Arquivo</div>
              <div class="impper-resumo-valor" style="font-size: 11px;">${escapeHTML(file.name)}</div>
            </div>
            <div class="impper-resumo-item">
              <div class="impper-resumo-label">Abas com dados</div>
              <div class="impper-resumo-valor mono">${abas.length}</div>
            </div>
            <div class="impper-resumo-item">
              <div class="impper-resumo-label">Total linhas</div>
              <div class="impper-resumo-valor mono">${totalLinhas}</div>
            </div>
            <div class="impper-resumo-item">
              <div class="impper-resumo-label">Valor padrão</div>
              <div class="impper-resumo-valor mono">R$ ${fmt(analise.cadastro.padrao, 2)}</div>
            </div>
            <div class="impper-resumo-item">
              <div class="impper-resumo-label">Valores especiais</div>
              <div class="impper-resumo-valor mono">${analise.cadastro.especiais.length}</div>
            </div>
            <div class="impper-resumo-item">
              <div class="impper-resumo-label">Total geral</div>
              <div class="impper-resumo-valor mono"><strong>R$ ${fmt(totalValor, 2)}</strong></div>
            </div>
          </div>

          ${semMes.length > 0 ? `
            <div class="impper-mes-atribuir">
              <div class="impper-mes-atribuir-titulo">📅 Defina o mês ${semMes.length > 1 ? 'de cada aba' : 'desta planilha'}</div>
              <p class="impper-mes-atribuir-sub">A planilha não tem o mês no nome da aba. Selecionei um palpite — <strong>confira e corrija</strong>. É este mês que será gravado/substituído.</p>
              ${semMes.map(a => {
                const idx = abas.indexOf(a);
                return `<div class="impper-mes-atribuir-linha">
                  <span>${escapeHTML(a.nome_aba)} <small>(${a.linhas.length} linhas)</small></span>
                  <input type="month" class="impper-input-mes" data-aba-idx="${idx}" value="${a.mes_ref || ''}">
                </div>`;
              }).join('')}
            </div>
          ` : ''}

          <div class="impper-modo-titulo">SELECIONE O QUE IMPORTAR</div>
          <div class="impper-modo-opcoes">
            <label class="impper-opcao">
              <input type="radio" name="impper-modo" value="todos" checked>
              <div class="impper-opcao-corpo">
                <div class="impper-opcao-titulo">Importar TUDO (${abas.length} ${abas.length === 1 ? 'aba' : 'abas'})</div>
                <div class="impper-opcao-sub">Substitui os dados existentes nos meses indicados</div>
              </div>
            </label>
            <label class="impper-opcao">
              <input type="radio" name="impper-modo" value="um">
              <div class="impper-opcao-corpo">
                <div class="impper-opcao-titulo">Importar apenas UM mês</div>
                <div class="impper-opcao-sub">Útil para envios mensais avulsos</div>
              </div>
            </label>
          </div>

          <div class="impper-mes-seletor" id="impper-mes-seletor" style="display: none">
            <label class="impper-mes-seletor-label">Selecione o mês:</label>
            <select id="impper-mes-select" class="impper-select mono">
              ${abas.map((a, i) => `
                <option value="${i}">${formatarMes(a.mes_ref)} (${a.linhas.length} linhas · R$ ${fmt(a.total_valor, 2)})</option>
              `).join('')}
            </select>
          </div>

          <div class="impper-meses-detalhe">
            <div class="impper-meses-detalhe-titulo">MESES A GRAVAR</div>
            <div class="impper-meses-lista">
              ${abas.map(a => {
                const existe = mesesExistentes.has(a.mes_ref);
                return `
                <div class="impper-mes-item">
                  <span class="impper-mes-nome">${formatarMes(a.mes_ref)}${a.mesDetectado ? '' : ' <small style="color:var(--ink-faint)">(definido por você)</small>'}</span>
                  ${existe ? '<span class="impper-mes-tag impper-tag-aviso">⚠ vai substituir</span>' : '<span class="impper-mes-tag impper-tag-novo">novo</span>'}
                  <span class="impper-mes-stat mono">${a.linhas.length} linhas · R$ ${fmt(a.total_valor, 2)}</span>
                </div>
              `;}).join('')}
            </div>
          </div>

          <label class="impper-cadastro-opt">
            <input type="checkbox" id="impper-importar-cadastro" checked>
            <span>Também atualizar Cadastro de Valores (padrão + valores especiais)</span>
          </label>

          ${analise.unidadesACriar && analise.unidadesACriar.length > 0 ? `
            <div class="impper-aviso-unidades">
              <strong>🆕 Unidades novas detectadas:</strong>
              <div class="impper-aviso-lista">
                ${analise.unidadesACriar.map(u => `<span class="impper-aviso-tag">${escapeHTML(u)}</span>`).join('')}
              </div>
              <div class="impper-aviso-sub">Serão criadas automaticamente no cadastro de Unidades.</div>
            </div>
          ` : ''}
        </div>
        <div class="impper-modal-footer">
          <button class="btn" id="impper-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="impper-confirmar">✓ Confirmar Importação</button>
        </div>
      </div>
      `;
      bind();
    }

    function bind() {
      modal.querySelector('#impper-cancel').addEventListener('click', fechar);
      modal.querySelector('#impper-cancelar').addEventListener('click', fechar);
      modal.addEventListener('click', (e) => { if (e.target === modal) fechar(); });

      modal.querySelectorAll('input[name="impper-modo"]').forEach(r => {
        r.addEventListener('change', () => {
          const um = modal.querySelector('input[name="impper-modo"]:checked').value === 'um';
          modal.querySelector('#impper-mes-seletor').style.display = um ? 'flex' : 'none';
        });
      });

      // seletor de mês das abas sem mês no nome
      modal.querySelectorAll('.impper-input-mes').forEach(inp => {
        inp.addEventListener('change', () => {
          const idx = parseInt(inp.dataset.abaIdx, 10);
          const v = (inp.value || '').trim();
          if (/^\d{4}-\d{2}$/.test(v) && analise.abasMensais[idx]) {
            setMesAba(analise.abasMensais[idx], v);
            render();
          }
        });
      });

      modal.querySelector('#impper-confirmar').addEventListener('click', confirmar);
    }

    async function confirmar() {
      const modo = modal.querySelector('input[name="impper-modo"]:checked').value;
      const atualizarCadastro = modal.querySelector('#impper-importar-cadastro').checked;

      let abasASalvar;
      if (modo === 'todos') {
        abasASalvar = analise.abasMensais;
      } else {
        const idx = parseInt(modal.querySelector('#impper-mes-select').value, 10);
        abasASalvar = [analise.abasMensais[idx]].filter(Boolean);
      }

      try {
        Banco.db.exec('BEGIN');
        if (analise.unidadesACriar && analise.unidadesACriar.length > 0) {
          const novoMapa = criarUnidadesFaltantes(analise.unidadesACriar);
          for (const aba of abasASalvar) {
            for (const l of aba.linhas) {
              if (!l.unidade_id) {
                const id = novoMapa.get(normalizar(l.unidade));
                if (id) l.unidade_id = id;
              }
            }
          }
        }
        if (atualizarCadastro) salvarCadastro(analise.cadastro);

        let totalSalvas = 0;
        for (const aba of abasASalvar) totalSalvas += salvarMes(aba);

        Banco.db.exec('COMMIT');
        await Banco.salvar({ imediato: true });

        const msgUnid = analise.unidadesACriar && analise.unidadesACriar.length > 0
          ? ` (criadas ${analise.unidadesACriar.length} unidades)` : '';
        Utilidades.toast(`✓ ${totalSalvas} linhas importadas em ${abasASalvar.length} mês(es)${msgUnid}`, 'success');
        fechar();
        if (onImportConcluida) onImportConcluida();
      } catch (e) {
        Banco.db.exec('ROLLBACK');
        console.error(e);
        alert(`❌ Erro ao salvar:\n\n${e.message}`);
      }
    }

    render();
  }

  // ──────────────────────────────────────────────────────────────────────
  // CSS dos modais (injetado uma vez)
  // ──────────────────────────────────────────────────────────────────────
  function _injetarCSS() {
    if (document.getElementById('impper-css')) return;
    const style = document.createElement('style');
    style.id = 'impper-css';
    style.textContent = `
      .impper-modal-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.5);
        display: flex; align-items: center; justify-content: center;
        z-index: 9999;
      }
      .impper-modal {
        background: var(--bg-elevated);
        border-radius: 12px;
        width: 640px;
        max-width: 95vw;
        max-height: 90vh;
        display: flex; flex-direction: column;
      }
      .impper-modal-header {
        padding: 14px 20px;
        border-bottom: 1px solid var(--border);
        display: flex; justify-content: space-between; align-items: center;
        font-weight: 700;
      }
      .impper-modal-fechar { background: none; border: none; cursor: pointer; font-size: 16px; color: var(--ink-soft); }
      .impper-modal-body { padding: 20px; overflow-y: auto; }
      .impper-modal-footer { padding: 12px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }

      .impper-upload-area {
        padding: 30px 20px;
        text-align: center;
        background: var(--bg-sunken);
        border: 2px dashed var(--border);
        border-radius: 12px;
      }

      .impper-resumo {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        padding: 12px;
        background: var(--bg-sunken);
        border-radius: 8px;
        margin-bottom: 16px;
      }
      .impper-resumo-item { text-align: center; }
      .impper-resumo-label { font-size: 10px; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 4px; }
      .impper-resumo-valor { font-size: 13px; color: var(--ink); }

      .impper-modo-titulo { font-size: 10px; font-weight: 700; color: var(--ink-soft); letter-spacing: 0.06em; margin: 16px 0 8px; }
      .impper-modo-opcoes { display: flex; flex-direction: column; gap: 8px; }
      .impper-opcao {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 10px;
        border: 1px solid var(--border);
        border-radius: 8px;
        cursor: pointer;
      }
      .impper-opcao:hover { background: var(--bg-sunken); }
      .impper-opcao input { margin-top: 3px; }
      .impper-opcao-corpo { flex: 1; }
      .impper-opcao-titulo { font-weight: 600; font-size: 13px; }
      .impper-opcao-sub { font-size: 11px; color: var(--ink-soft); margin-top: 2px; }

      .impper-mes-seletor { margin-top: 8px; display: flex; gap: 8px; align-items: center; }
      .impper-mes-atribuir {
        margin: 4px 0 16px; padding: 12px 14px;
        background: #FFF4E5; border: 1px solid #E6B97A; border-radius: 8px;
      }
      .impper-mes-atribuir-titulo { font-size: 13px; font-weight: 700; color: #8A5A1F; }
      .impper-mes-atribuir-sub { font-size: 11.5px; color: #8A5A1F; margin: 4px 0 10px; line-height: 1.4; }
      .impper-mes-atribuir-linha {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 5px 0; font-size: 13px; color: var(--ink, #071a30);
      }
      .impper-mes-atribuir-linha small { color: var(--ink-faint, #5a6879); }
      .impper-input-mes {
        padding: 6px 9px; font-family: inherit; font-size: 14px;
        border: 1.5px solid var(--primary, #143352); border-radius: 8px; background: #fff; cursor: pointer;
      }
      .impper-mes-seletor-label { font-size: 12px; color: var(--ink-soft); }
      .impper-select { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; font-family: var(--mono); font-size: 12px; flex: 1; }

      .impper-meses-detalhe { margin-top: 16px; }
      .impper-meses-detalhe-titulo { font-size: 10px; font-weight: 700; color: var(--ink-soft); letter-spacing: 0.06em; margin-bottom: 8px; }
      .impper-meses-lista { max-height: 180px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; }
      .impper-mes-item {
        display: flex; align-items: center; gap: 12px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--border);
        font-size: 12px;
      }
      .impper-mes-item:last-child { border-bottom: none; }
      .impper-mes-nome { font-weight: 600; min-width: 60px; color: var(--primary); }
      .impper-mes-tag { padding: 2px 8px; border-radius: 12px; font-size: 10px; text-transform: uppercase; font-weight: 700; }
      .impper-tag-novo { background: #f0f4f8; color: #0f1d2e; }   /* V863 */
      .impper-tag-aviso { background: #e4ecf4; color: #854F0B; }
      .impper-mes-stat { margin-left: auto; color: var(--ink-soft); font-size: 11px; }

      .impper-cadastro-opt {
        display: flex; align-items: center; gap: 8px;
        margin-top: 16px;
        font-size: 12px;
        color: var(--ink-soft);
      }

      .impper-aviso-unidades {
        margin-top: 14px;
        padding: 10px 12px;
        background: #e4ecf4;
        border: 1px solid #BA7517;
        border-radius: 8px;
        font-size: 12px;
        color: #633806;
      }
      .impper-aviso-lista { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
      .impper-aviso-tag {
        background: rgba(255,255,255,0.7);
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
      }
      .impper-aviso-sub { margin-top: 6px; font-size: 11px; opacity: 0.8; }
    `;
    document.head.appendChild(style);
  }

  // Expor API
  window.ImportPeriodos = {
    abrirModal(onImportConcluida) {
      _injetarCSS();
      abrirModalUpload(onImportConcluida);
    },
    formatarMes,
    excluirMes,
  };
})();
