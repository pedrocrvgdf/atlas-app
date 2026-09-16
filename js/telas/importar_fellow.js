/**
 * ============================================================================
 * MÓDULO: Importação de Fellow (plantões diários)
 *
 * Helper consumido pelo fichário "desempenho-fellow".
 * Não é uma tela registrada — apenas expõe `window.ImportFellow`:
 *
 *   ImportFellow.abrirModal(callback)     -- abre o modal de upload
 *   ImportFellow.formatarMes(mes_ref)     -- 'Abr/26'
 *   ImportFellow.excluirMes(mes_ref, cb)  -- DELETE + save (com confirm)
 *
 * Estratégia: parser robusto (não confia em índices fixos), range A1 forçado,
 * detecção dinâmica de cabeçalho, recalculo de TUDO em JS (não confia nas
 * fórmulas Excel). Granularidade: 1 linha = 1 plantão (mês+data+fellow+turno).
 *
 * V900: a planilha mensal SIMPLES é o padrão — Data · Médico · Turno · Qtd.
 * Atendimento, sem fórmula nenhuma; o módulo calcula tudo (complemento até a
 * meta, refeição). Se a coluna TURNO faltar, a importação NÃO trava: os
 * plantões entram como 'DIA' com aviso (refeição só pelo fim de semana).
 * Meta/valores: os configurados no módulo (fellow_config); a aba "Cadastro
 * Valores", quando existir, sobrepõe.
 *
 * Complemento: só até a meta — acima dela é R$ 0 no total (sem desconto);
 * o excedente fica visível com sinal em qtd/valor_complem (V900).
 * Refeição: turno NOTURNO ou dia ∈ {sáb, dom}.
 *
 * Fellows novos são auto-criados em `fellow_cadastro` (mesmo padrão das
 * unidades em ImportPeriodos).
 * ============================================================================
 */

(function () {
  'use strict';

  const MESES_LABELS = {
    'jan': 1, 'fev': 2, 'mar': 3, 'abr': 4, 'mai': 5, 'jun': 6,
    'jul': 7, 'ago': 8, 'set': 9, 'out': 10, 'nov': 11, 'dez': 12,
  };

  const TURNOS_VALIDOS = new Set(['MANHA', 'TARDE', 'NOTURNO']);

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

  function pad2(n) { return String(n).padStart(2, '0'); }

  /** Converte JS Date para 'YYYY-MM-DD' (sem timezone). */
  function dateParaISO(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  /** Tenta extrair Date a partir de uma célula (Date, string ou número serial Excel). */
  function celulaParaDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === 'number') {
      // Serial Excel: dias desde 1900-01-01 (com bug 1900-02-29)
      // SheetJS normalmente já converte com cellDates: true, mas defensivo aqui.
      if (window.XLSX && window.XLSX.SSF && typeof XLSX.SSF.parse_date_code === 'function') {
        const o = XLSX.SSF.parse_date_code(v);
        if (o) return new Date(Date.UTC(o.y, o.m - 1, o.d));
      }
      return null;
    }
    if (typeof v === 'string') {
      // 'dd/mm/yyyy' ou 'dd/mm/yy' ou 'YYYY-MM-DD'
      const s = v.trim();
      let m;
      if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
        return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
      }
      if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
        let ano = parseInt(m[3]);
        if (ano < 100) ano += 2000;
        return new Date(ano, parseInt(m[2]) - 1, parseInt(m[1]));
      }
    }
    return null;
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

  /**
   * Lê a aba 'Cadastro Valores' e devolve:
   *   { meta, valor_atend, valor_refeicao, fellows: [{nome_original, nome_normalizado, data_inicio, observacao}] }
   *
   * Busca dinâmica:
   *  - "Meta..."           → o número à direita na mesma linha (ou nas próximas)
   *  - "Valor por atend..." → idem
   *  - "Valor da refei..."  → idem
   *  - Cabeçalho da lista: linha contendo "Fellow" (ou "Médico") + "Início"
   *    Lê os nomes a partir da linha seguinte.
   */
  /** V900: a planilha mensal simples não traz "Cadastro Valores" — os valores
   *  valem os JÁ CONFIGURADOS no módulo (fellow_config), com 13/38/50 só como
   *  último recurso. Assim um ajuste feito no app não é resetado pelo import. */
  function configDoBanco() {
    const cfg = { meta: 13, valor_atend: 38, valor_refeicao: 50 };
    try {
      for (const r of Banco.query(`SELECT chave, valor FROM fellow_config`) || []) {
        const v = Number(r.valor);
        if (!isFinite(v) || v <= 0) continue;
        if (r.chave === 'META_ATENDIMENTOS') cfg.meta = v;
        else if (r.chave === 'VALOR_POR_ATENDIMENTO') cfg.valor_atend = v;
        else if (r.chave === 'VALOR_REFEICAO') cfg.valor_refeicao = v;
      }
    } catch (e) { /* tabela pode não existir ainda */ }
    return cfg;
  }

  function parseCadastroValores(workbook) {
    const base = configDoBanco();
    const aba = workbook.Sheets['Cadastro Valores'];
    if (!aba) return { ...base, fellows: [] };
    const rows = window.XLSX.utils.sheet_to_json(aba, {
      header: 1, raw: true, defval: null,
      range: { s: { c: 0, r: 0 }, e: { c: 10, r: 70 } },
    });

    let { meta, valor_atend, valor_refeicao } = base;

    function buscarValor(palavrasChave, valorAtual) {
      for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const linha = rows[r] || [];
        for (let c = 0; c < linha.length; c++) {
          const v = String(linha[c] || '').toLowerCase();
          if (palavrasChave.every(k => v.includes(k))) {
            // Procura número na mesma linha (até 5 colunas à direita) ou na próxima
            for (let rr = r; rr <= r + 1 && rr < rows.length; rr++) {
              const linhaRR = rows[rr] || [];
              const startC = rr === r ? c + 1 : c;
              for (let cc = startC; cc < linhaRR.length && cc < c + 8; cc++) {
                const candidato = Number(linhaRR[cc]);
                if (isFinite(candidato) && candidato > 0 && candidato < 100000) {
                  return candidato;
                }
              }
            }
          }
        }
      }
      return valorAtual;
    }

    meta            = buscarValor(['meta'], meta);
    valor_atend     = buscarValor(['valor', 'atend'], valor_atend);
    valor_refeicao  = buscarValor(['valor', 'refei'], valor_refeicao);

    // Cabeçalho da lista: procura linha com "fellow" (ou "médic") + opcional "início"
    const fellows = [];
    let headerRow = -1, colNome = -1, colInicio = -1, colObs = -1;
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const linha = rows[r] || [];
      for (let c = 0; c < linha.length; c++) {
        const v = String(linha[c] || '').toLowerCase().trim();
        if (v === 'fellow' || v.startsWith('médic') || v === 'medico' || v === 'nome') {
          headerRow = r;
          colNome = c;
          for (let cc = c + 1; cc < linha.length && cc < c + 6; cc++) {
            const v2 = String(linha[cc] || '').toLowerCase();
            if (colInicio < 0 && (v2.includes('iníci') || v2.includes('inici') || v2.includes('admiss'))) colInicio = cc;
            if (colObs < 0 && (v2.includes('obs') || v2.includes('coment') || v2.includes('notas'))) colObs = cc;
          }
          break;
        }
      }
      if (headerRow >= 0) break;
    }

    if (headerRow >= 0) {
      for (let i = headerRow + 1; i < rows.length && i < headerRow + 60; i++) {
        const linha = rows[i];
        if (!linha) continue;
        const nome = (linha[colNome] || '').toString().trim();
        if (!nome) continue;
        const inicioRaw = colInicio >= 0 ? linha[colInicio] : null;
        const obs = colObs >= 0 ? ((linha[colObs] || '').toString().trim() || null) : null;
        let data_inicio = null;
        const d = celulaParaDate(inicioRaw);
        if (d) data_inicio = dateParaISO(d);

        fellows.push({
          nome_original: nome,
          nome_normalizado: normalizar(nome),
          data_inicio,
          observacao: obs,
        });
      }
    }

    return { meta, valor_atend, valor_refeicao, fellows };
  }

  /**
   * Detecta a linha de cabeçalho da aba mensal e os índices das colunas.
   * OBRIGATÓRIAS: "Data", "Fellow"/"Médico" e "QTD" (algo com "atend").
   * V900: "Turno" é OPCIONAL — a planilha mensal real chega só com
   * Data · Médico · Qtd. Atendimento, e é isso que o cálculo precisa.
   * O resto não é lido (são fórmulas — recalculamos em JS).
   */
  function detectarColunasMensal(rows) {
    for (let r = 0; r < Math.min(rows.length, 12); r++) {
      const linha = rows[r] || [];
      let colData = -1, colFellow = -1, colTurno = -1, colQtd = -1;

      for (let c = 0; c < linha.length; c++) {
        const v = String(linha[c] || '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (!v) continue;
        // "data" mas evita "dia" e "data adm..."
        if (colData < 0 && /^data($|\b)/i.test(v) && !v.includes('admiss')) colData = c;
        if (colFellow < 0 && (v === 'fellow' || v.startsWith('médic') || v === 'medico' || v === 'nome')) colFellow = c;
        if (colTurno < 0 && (v === 'turno' || v.startsWith('turno'))) colTurno = c;
        if (colQtd < 0 && !v.includes('complem')
            && ((v.includes('qtd') && v.includes('atend')) || v === 'atendimentos' || v.startsWith('atendim'))) {
          colQtd = c;
        }
      }

      if (colData >= 0 && colFellow >= 0 && colQtd >= 0) {
        return { headerRow: r, colData, colFellow, colTurno, colQtd };
      }
    }
    return null;
  }

  function parseAbaMensal(workbook, nomeAba, cadastro) {
    const mesInfo = detectarMesAba(nomeAba);   // dica pelo nome da aba (pode ser null)

    const aba = workbook.Sheets[nomeAba];
    if (!aba) return null;
    const rows = window.XLSX.utils.sheet_to_json(aba, {
      header: 1, raw: true, defval: null,
      range: { s: { c: 0, r: 0 }, e: { c: 15, r: 80 } },
    });

    const colMap = detectarColunasMensal(rows);
    if (!colMap) {
      return { mes_ref: mesInfo ? `${mesInfo.ano}-${pad2(mesInfo.mes)}` : null, mesDetectado: !!mesInfo, linhas: [], problemas: ['Cabeçalho com colunas Data/Médico/Qtd. Atendimento não encontrado.'] };
    }

    // Determina o mês-alvo: pelo nome da aba OU pelo mês predominante das datas dos plantões
    let alvoAno, alvoMes;
    if (mesInfo) { alvoAno = mesInfo.ano; alvoMes = mesInfo.mes; }
    else {
      const cont = new Map();
      for (let i = colMap.headerRow + 1; i < rows.length && i < colMap.headerRow + 71; i++) {
        const rr = rows[i]; if (!rr) continue;
        const d = celulaParaDate(rr[colMap.colData]);
        if (d) { const k = `${d.getFullYear()}-${d.getMonth() + 1}`; cont.set(k, (cont.get(k) || 0) + 1); }
      }
      let best = null, bestN = -1;
      cont.forEach((n, k) => { if (n > bestN) { bestN = n; best = k; } });
      if (best) { const [a, m] = best.split('-').map(Number); alvoAno = a; alvoMes = m; }
    }
    if (!alvoAno) {
      return { mes_ref: null, mesDetectado: false, linhas: [], problemas: ['Nenhuma data válida encontrada para determinar o mês.'] };
    }
    const mes_ref = `${alvoAno}-${pad2(alvoMes)}`;

    const META = cadastro.meta;
    const VATEND = cadastro.valor_atend;
    const VREF = cadastro.valor_refeicao;

    const linhas = [];
    const problemas = [];
    // V900: sem a coluna TURNO a importação NÃO trava mais (era o problema de
    // todo mês) — mas o turno FAZ parte da planilha padrão, então avisa alto.
    if (colMap.colTurno < 0) {
      problemas.push('A planilha veio SEM a coluna TURNO — todos os plantões entraram como "Dia" e a '
        + 'refeição foi aplicada só pelo fim de semana. Peça a planilha com o TURNO '
        + '(Manhã/Tarde/Noturno) ou ajuste os noturnos pela edição da linha (✏).');
    }

    // Lê da linha seguinte ao cabeçalho até no máx 70 linhas (cobre 60+ plantões)
    for (let i = colMap.headerRow + 1; i < rows.length && i < colMap.headerRow + 71; i++) {
      const r = rows[i];
      if (!r) continue;

      const dataRaw = r[colMap.colData];
      const fellowRaw = r[colMap.colFellow];
      const turnoRaw = colMap.colTurno >= 0 ? r[colMap.colTurno] : null;
      const qtdRaw = r[colMap.colQtd];

      // Ignora linhas vazias silenciosamente
      const temAlgo = (dataRaw !== null && dataRaw !== undefined && dataRaw !== '')
        || (fellowRaw && String(fellowRaw).trim())
        || (turnoRaw && String(turnoRaw).trim())
        || (qtdRaw !== null && qtdRaw !== undefined && qtdRaw !== '');
      if (!temAlgo) continue;

      // ── Validações ─────────────────────────────────────────────────
      const data = celulaParaDate(dataRaw);
      if (!data) {
        problemas.push(`Linha ${i + 1}: data inválida ou ausente — ignorada.`);
        continue;
      }
      // Valida data dentro do mês-alvo
      if (data.getFullYear() !== alvoAno || (data.getMonth() + 1) !== alvoMes) {
        problemas.push(`Linha ${i + 1}: data ${dateParaISO(data)} fora do mês ${mes_ref} — ignorada.`);
        continue;
      }

      const fellow_nome = (fellowRaw || '').toString().trim();
      if (!fellow_nome) {
        problemas.push(`Linha ${i + 1}: fellow não preenchido — ignorada.`);
        continue;
      }

      /* V900: turno é OPCIONAL. Sem coluna de turno (a planilha mensal real
         só tem Data · Médico · Qtd.) ou com a célula vazia, o plantão entra
         como 'DIA' — a refeição fica por conta do fim de semana, e o turno
         pode ser trocado depois pela edição da linha (ex.: marcar NOTURNO).
         Valor estranho na célula NÃO derruba mais a linha: vira 'DIA' com
         aviso — perder o plantão inteiro era o problema de todo mês. */
      let turno = normalizar(turnoRaw || '');
      if (!turno) {
        turno = 'DIA';
      } else if (!TURNOS_VALIDOS.has(turno)) {
        problemas.push(`Linha ${i + 1}: turno "${turnoRaw}" não reconhecido (Manhã/Tarde/Noturno) — importado como "Dia".`);
        turno = 'DIA';
      }

      const qtd_atendim = parseInt(qtdRaw);
      if (!isFinite(qtd_atendim) || qtd_atendim < 0) {
        problemas.push(`Linha ${i + 1}: QTD Atendimento inválida — ignorada.`);
        continue;
      }

      // ── Cálculos (recalcular tudo em JS, não confiar nas fórmulas) ──
      // A regra do complemento: quem atende MENOS que a meta recebe o
      // complemento até ela; quem atende a meta ou mais não tem complemento
      // (e NÃO desconta). qtd/valor_complem ficam com o sinal para a
      // controladoria ver o excedente, mas o TOTAL zera o negativo — V900,
      // igual à edição de linha ("Atendeu acima da meta — sem complemento").
      const dow = data.getDay(); // 0=Dom ... 6=Sáb
      const qtd_complem = META - qtd_atendim;                          // pode ser NEGATIVO (exibição)
      const valor_complem = qtd_complem * VATEND;                      // pode ser NEGATIVO (exibição)
      const refeicao = (turno === 'NOTURNO' || dow === 0 || dow === 6) ? VREF : 0;
      const total_repassar = Math.max(0, valor_complem) + refeicao;    // nunca desconta

      linhas.push({
        mes_ref,
        data_plantao: dateParaISO(data),
        fellow_nome,
        fellow_norm: normalizar(fellow_nome),
        turno,
        qtd_atendim,
        meta: META,
        valor_atendim: VATEND,
        valor_refeicao: VREF,
        qtd_complem,
        valor_complem,
        refeicao,
        total_repassar,
        dia_semana: dow,
      });
    }

    // Agrega duplicatas do mesmo plantão (data + fellow + turno) somando atendimentos —
    // evita violar o UNIQUE(mes_ref, data_plantao, fellow_norm, turno).
    const mapa = new Map();
    for (const l of linhas) {
      const k = l.data_plantao + '||' + l.fellow_norm + '||' + l.turno;
      if (mapa.has(k)) {
        const ex = mapa.get(k);
        ex.qtd_atendim += l.qtd_atendim;
        ex.qtd_complem = ex.meta - ex.qtd_atendim;
        ex.valor_complem = ex.qtd_complem * ex.valor_atendim;
        ex.total_repassar = Math.max(0, ex.valor_complem) + ex.refeicao;
      } else {
        mapa.set(k, { ...l });
      }
    }
    const linhasAg = Array.from(mapa.values());
    if (linhasAg.length < linhas.length) {
      problemas.push(`${linhas.length - linhasAg.length} plantão(ões) duplicado(s) (mesma data/fellow/turno) foram somados.`);
    }

    return { mes_ref, mesDetectado: !!mesInfo, linhas: linhasAg, problemas };
  }

  function analisarWorkbook(workbook) {
    const cadastro = parseCadastroValores(workbook);
    const abasMensais = [];
    const debug = { abasIgnoradas: [], abasSemDados: [] };

    // Cache de fellows já cadastrados
    const fellowsCache = new Map();
    try {
      const rows = Banco.query(`SELECT id, nome_normalizado, nome_original FROM fellow_cadastro WHERE ativo = 1`);
      rows.forEach(r => fellowsCache.set(r.nome_normalizado, { id: r.id, nome: r.nome_original }));
    } catch (e) { /* tabela pode não existir ainda */ }

    // Fellows DETECTADOS na planilha mas não cadastrados (mescla cadastro + abas mensais)
    const fellowsNaPlanilha = new Map();

    // Fellows do "Cadastro Valores" entram primeiro (têm data_inicio/obs)
    for (const f of cadastro.fellows) {
      if (!fellowsCache.has(f.nome_normalizado) && !fellowsNaPlanilha.has(f.nome_normalizado)) {
        fellowsNaPlanilha.set(f.nome_normalizado, {
          nome_original: f.nome_original,
          nome_normalizado: f.nome_normalizado,
          data_inicio: f.data_inicio,
          observacao: f.observacao,
        });
      }
    }

    for (const nomeAba of workbook.SheetNames) {
      const parsed = parseAbaMensal(workbook, nomeAba, cadastro);
      if (parsed && parsed.linhas.length > 0) {
        // Resolve fellow_id em cada linha + coleta fellows faltantes
        for (const l of parsed.linhas) {
          const cached = fellowsCache.get(l.fellow_norm);
          if (cached) {
            l.fellow_id = cached.id;
            l.fellow_status = 'existente';
          } else {
            l.fellow_id = null;
            l.fellow_status = 'a_criar';
            if (!fellowsNaPlanilha.has(l.fellow_norm)) {
              fellowsNaPlanilha.set(l.fellow_norm, {
                nome_original: l.fellow_nome,
                nome_normalizado: l.fellow_norm,
                data_inicio: null,
                observacao: null,
              });
            }
          }
        }

        abasMensais.push({
          nome_aba: nomeAba,
          mes_ref: parsed.mes_ref,
          mesDetectado: parsed.mesDetectado,
          linhas: parsed.linhas,
          problemas: parsed.problemas,
          total_atendim: parsed.linhas.reduce((s, l) => s + l.qtd_atendim, 0),
          total_repassar: parsed.linhas.reduce((s, l) => s + l.total_repassar, 0),
        });
      } else if (parsed) {
        debug.abasSemDados.push({ nome: nomeAba, problemas: parsed.problemas || [] });
      } else {
        debug.abasIgnoradas.push(nomeAba);
      }
    }

    abasMensais.sort((a, b) => String(a.mes_ref || '9999-99').localeCompare(String(b.mes_ref || '9999-99')));

    console.group('📥 ImportFellow — análise');
    console.log(`Abas no arquivo: ${workbook.SheetNames.length}`);
    console.log(`Abas mensais com dados: ${abasMensais.length}`);
    if (debug.abasIgnoradas.length > 0) console.log(`Abas ignoradas:`, debug.abasIgnoradas);
    if (debug.abasSemDados.length > 0) console.log(`Abas mensais SEM dados:`, debug.abasSemDados);
    console.log(`Config: META=${cadastro.meta} · R$/atend=${cadastro.valor_atend} · Refeição=${cadastro.valor_refeicao}`);
    console.log(`Fellows no Cadastro Valores: ${cadastro.fellows.length}`);
    console.log(`Fellows a criar (não existem):`, Array.from(fellowsNaPlanilha.values()).map(f => f.nome_original));
    console.groupEnd();

    const fellowsACriar = Array.from(fellowsNaPlanilha.values());
    return { cadastro, abasMensais, fellowsACriar };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Persistência
  // ──────────────────────────────────────────────────────────────────────

  function salvarMes(abaMensal) {
    const { mes_ref, linhas } = abaMensal;

    // 1. Captura overrides manuais existentes para reaplicar depois do INSERT.
    //    A chave natural (mes_ref, data, fellow_norm, turno) sobrevive ao re-import.
    let manuaisSalvos = [];
    try {
      manuaisSalvos = Banco.query(`
        SELECT data_plantao, fellow_norm, turno, valor_complem_manual
        FROM fellow_linhas
        WHERE mes_ref = ? AND valor_complem_manual IS NOT NULL
      `, [mes_ref]);
    } catch (e) { /* primeira importação */ }

    // 2. Apaga tudo do mês
    const stmtDel = Banco.db.prepare(`DELETE FROM fellow_linhas WHERE mes_ref = ?`);
    try { stmtDel.run([mes_ref]); } finally { stmtDel.free(); }

    if (linhas.length === 0) return 0;

    // 3. Reinsere todas as linhas com cálculo automático limpo
    const stmt = Banco.db.prepare(`
      INSERT INTO fellow_linhas (
        mes_ref, data_plantao, fellow_nome, fellow_norm, fellow_id, turno,
        qtd_atendim, meta, valor_atendim, valor_refeicao,
        qtd_complem, valor_complem, refeicao, total_repassar,
        dia_semana, origem
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    try {
      for (const l of linhas) {
        stmt.run([
          l.mes_ref, l.data_plantao, l.fellow_nome, l.fellow_norm, l.fellow_id || null, l.turno,
          l.qtd_atendim, l.meta, l.valor_atendim, l.valor_refeicao,
          l.qtd_complem, l.valor_complem, l.refeicao, l.total_repassar,
          l.dia_semana, 'planilha',
        ]);
      }
    } finally {
      stmt.free();
    }

    // 4. Reaplica os overrides manuais nas linhas correspondentes
    //    Também ajusta total_repassar para refletir o efetivo (manual + refeição).
    if (manuaisSalvos.length > 0) {
      const stmtUpd = Banco.db.prepare(`
        UPDATE fellow_linhas
        SET valor_complem_manual = ?,
            total_repassar = ? + refeicao
        WHERE mes_ref = ? AND data_plantao = ? AND fellow_norm = ? AND turno = ?
      `);
      let reaplicados = 0;
      try {
        for (const m of manuaisSalvos) {
          stmtUpd.run([m.valor_complem_manual, m.valor_complem_manual, mes_ref, m.data_plantao, m.fellow_norm, m.turno]);
          // Não dá pra checar changes() sem query extra; assumimos que a maioria casa
          reaplicados++;
        }
      } finally { stmtUpd.free(); }
      if (reaplicados > 0) {
        console.log(`📌 ${reaplicados} override(s) manual(is) preservado(s) em ${mes_ref}`);
      }
    }

    return linhas.length;
  }

  /**
   * Cria fellows novos em fellow_cadastro. Retorna mapa nome_norm → id.
   */
  function criarFellowsFaltantes(fellowsACriar) {
    if (!fellowsACriar || fellowsACriar.length === 0) return new Map();
    const stmt = Banco.db.prepare(`
      INSERT INTO fellow_cadastro (nome_normalizado, nome_original, data_inicio, observacao, ativo)
      VALUES (?, ?, ?, ?, 1)
    `);
    const novoMapa = new Map();
    try {
      for (const f of fellowsACriar) {
        try {
          stmt.run([f.nome_normalizado, f.nome_original, f.data_inicio, f.observacao]);
          const row = Banco.queryUnica(`SELECT id FROM fellow_cadastro WHERE nome_normalizado = ?`, [f.nome_normalizado]);
          if (row) novoMapa.set(f.nome_normalizado, row.id);
        } catch (e) {
          // UNIQUE constraint — busca o id existente
          const row = Banco.queryUnica(`SELECT id FROM fellow_cadastro WHERE nome_normalizado = ?`, [f.nome_normalizado]);
          if (row) novoMapa.set(f.nome_normalizado, row.id);
        }
      }
    } finally {
      stmt.free();
    }
    return novoMapa;
  }

  /** Atualiza a tabela fellow_config (META, VALOR_POR_ATENDIMENTO, VALOR_REFEICAO). */
  function salvarConfig(cadastro) {
    const stmt = Banco.db.prepare(`
      INSERT INTO fellow_config (chave, valor) VALUES (?, ?)
      ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = CURRENT_TIMESTAMP
    `);
    try {
      stmt.run(['META_ATENDIMENTOS',     String(cadastro.meta)]);
      stmt.run(['VALOR_POR_ATENDIMENTO', String(cadastro.valor_atend)]);
      stmt.run(['VALOR_REFEICAO',        String(cadastro.valor_refeicao)]);
    } finally {
      stmt.free();
    }
  }

  function excluirMes(mes_ref, onSuccess) {
    if (!confirm(`Excluir todos os plantões de ${formatarMes(mes_ref)}? Esta ação não pode ser desfeita.`)) return;
    const stmt = Banco.db.prepare(`DELETE FROM fellow_linhas WHERE mes_ref = ?`);
    try { stmt.run([mes_ref]); } finally { stmt.free(); }
    Banco.salvar().then(() => {
      Utilidades.toast('Importação excluída', 'success');
      if (onSuccess) onSuccess();
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // UI: modal de upload
  // ──────────────────────────────────────────────────────────────────────

  function abrirModalUpload(onImportConcluida) {
    const overlay = document.createElement('div');
    overlay.className = 'impfel-modal-overlay';
    overlay.innerHTML = `
      <div class="impfel-modal" style="width: 500px">
        <div class="impfel-modal-header">
          <span>📥 Importar Planilha de Fellow</span>
          <button class="impfel-modal-fechar" id="impfel-cancel">✕</button>
        </div>
        <div class="impfel-modal-body">
          <div class="impfel-upload-area" id="impfel-drop-area">
            <div style="font-size: 36px; margin-bottom: 8px;">📂</div>
            <div style="font-weight: 700; margin-bottom: 4px;">Selecione a planilha de Fellow</div>
            <div style="font-size: 11px; color: var(--ink-soft); margin-bottom: 14px;">
              Basta a planilha mensal simples — <strong>Data · Médico · Turno · Qtd. Atendimento</strong>.
              O cálculo (complemento até a meta, refeição de noturno/fim de semana) é todo daqui.
              O template completo (12 abas) também é aceito.</div>
            <button class="btn btn-primary" id="impfel-pick">📂 Escolher arquivo Excel</button>
            <input type="file" id="impfel-file" accept=".xlsx,.xls" style="display:none">
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const fechar = () => overlay.remove();
    document.getElementById('impfel-cancel').addEventListener('click', fechar);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });

    const fileInput = document.getElementById('impfel-file');
    document.getElementById('impfel-pick').addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const buf = await f.arrayBuffer();
        const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
        const analise = analisarWorkbook(wb);

        if (analise.abasMensais.length === 0) {
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
          alert('❌ Não encontrei plantões de Fellow (colunas Data, Médico/Fellow e Qtd. Atendimento).\n\n' +
            'Veja o que li nas primeiras linhas — me mande isso que eu ajusto a leitura:\n' + diag);
          console.log('[ImportFellow] diagnóstico de cabeçalho:', diag);
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
      Banco.query(`SELECT DISTINCT mes_ref FROM fellow_linhas`).forEach(r => mesesExistentes.add(r.mes_ref));
    } catch (e) { /* */ }

    // aplica um mes_ref a uma aba E a todas as suas linhas
    function setMesAba(aba, mes) {
      aba.mes_ref = mes;
      aba.linhas.forEach(l => { l.mes_ref = mes; });
    }

    const modal = document.createElement('div');
    modal.className = 'impfel-modal-overlay';
    document.body.appendChild(modal);
    const fechar = () => modal.remove();

    function render() {
      const abas = analise.abasMensais;
      const totalLinhas = abas.reduce((s, a) => s + a.linhas.length, 0);
      const totalValor = abas.reduce((s, a) => s + a.total_repassar, 0);
      const semMes = abas.filter(a => !a.mesDetectado);

      modal.innerHTML = `
      <div class="impfel-modal">
        <div class="impfel-modal-header">
          <span>📥 Confirmar Importação · Fellow</span>
          <button class="impfel-modal-fechar" id="impfel-cancel">✕</button>
        </div>
        <div class="impfel-modal-body">
          <div class="impfel-resumo">
            <div class="impfel-resumo-item">
              <div class="impfel-resumo-label">Arquivo</div>
              <div class="impfel-resumo-valor" style="font-size: 11px;">${escapeHTML(file.name)}</div>
            </div>
            <div class="impfel-resumo-item">
              <div class="impfel-resumo-label">Abas com dados</div>
              <div class="impfel-resumo-valor mono">${abas.length}</div>
            </div>
            <div class="impfel-resumo-item">
              <div class="impfel-resumo-label">Total plantões</div>
              <div class="impfel-resumo-valor mono">${totalLinhas}</div>
            </div>
            <div class="impfel-resumo-item">
              <div class="impfel-resumo-label">Meta / turno</div>
              <div class="impfel-resumo-valor mono">${analise.cadastro.meta}</div>
            </div>
            <div class="impfel-resumo-item">
              <div class="impfel-resumo-label">R$ / atendim.</div>
              <div class="impfel-resumo-valor mono">R$ ${fmt(analise.cadastro.valor_atend, 2)}</div>
            </div>
            <div class="impfel-resumo-item">
              <div class="impfel-resumo-label">Total geral</div>
              <div class="impfel-resumo-valor mono"><strong>R$ ${fmt(totalValor, 2)}</strong></div>
            </div>
          </div>

          ${semMes.length > 0 ? `
            <div class="impfel-mes-atribuir">
              <div class="impfel-mes-atribuir-titulo">📅 Mês ${semMes.length > 1 ? 'de cada aba' : 'desta planilha'}</div>
              <p class="impfel-mes-atribuir-sub">A aba não tem o mês no nome — defini pelas <strong>datas dos plantões</strong>. Confira e corrija se precisar.</p>
              ${semMes.map(a => {
                const idx = abas.indexOf(a);
                return `<div class="impfel-mes-atribuir-linha">
                  <span>${escapeHTML(a.nome_aba)} <small>(${a.linhas.length} plantões)</small></span>
                  <input type="month" class="impfel-input-mes" data-aba-idx="${idx}" value="${a.mes_ref || ''}">
                </div>`;
              }).join('')}
            </div>
          ` : ''}

          <div class="impfel-modo-titulo">SELECIONE O QUE IMPORTAR</div>
          <div class="impfel-modo-opcoes">
            <label class="impfel-opcao">
              <input type="radio" name="impfel-modo" value="todos" checked>
              <div class="impfel-opcao-corpo">
                <div class="impfel-opcao-titulo">Importar TUDO (${abas.length} ${abas.length === 1 ? 'aba' : 'abas'})</div>
                <div class="impfel-opcao-sub">Substitui os plantões existentes nos meses indicados</div>
              </div>
            </label>
            <label class="impfel-opcao">
              <input type="radio" name="impfel-modo" value="um">
              <div class="impfel-opcao-corpo">
                <div class="impfel-opcao-titulo">Importar apenas UM mês</div>
                <div class="impfel-opcao-sub">Útil para envios mensais avulsos</div>
              </div>
            </label>
          </div>

          <div class="impfel-mes-seletor" id="impfel-mes-seletor" style="display: none">
            <label class="impfel-mes-seletor-label">Selecione o mês:</label>
            <select id="impfel-mes-select" class="impfel-select mono">
              ${abas.map((a, i) => `
                <option value="${i}">${formatarMes(a.mes_ref)} (${a.linhas.length} plantões · R$ ${fmt(a.total_repassar, 2)})</option>
              `).join('')}
            </select>
          </div>

          <div class="impfel-meses-detalhe">
            <div class="impfel-meses-detalhe-titulo">MESES A GRAVAR</div>
            <div class="impfel-meses-lista">
              ${abas.map(a => {
                const existe = mesesExistentes.has(a.mes_ref);
                return `
                <div class="impfel-mes-item">
                  <span class="impfel-mes-nome">${formatarMes(a.mes_ref)}${a.mesDetectado ? '' : ' <small style="color:var(--ink-faint)">(pelas datas)</small>'}</span>
                  ${existe ? '<span class="impfel-mes-tag impfel-tag-aviso">⚠ vai substituir</span>' : '<span class="impfel-mes-tag impfel-tag-novo">novo</span>'}
                  <span class="impfel-mes-stat mono">${a.linhas.length} plantões · R$ ${fmt(a.total_repassar, 2)}</span>
                </div>
              `;}).join('')}
            </div>
          </div>

          <label class="impfel-cadastro-opt">
            <input type="checkbox" id="impfel-importar-config" checked>
            <span>Também atualizar configurações (Meta, R$/atendimento, R$ refeição)</span>
          </label>

          ${analise.fellowsACriar && analise.fellowsACriar.length > 0 ? `
            <div class="impfel-aviso-fellows">
              <strong>🆕 Fellows novos detectados:</strong>
              <div class="impfel-aviso-lista">
                ${analise.fellowsACriar.map(f => `<span class="impfel-aviso-tag">${escapeHTML(f.nome_original)}</span>`).join('')}
              </div>
              <div class="impfel-aviso-sub">Serão criados automaticamente no cadastro de Fellows.</div>
            </div>
          ` : ''}

          ${(() => {
            const todosProblemas = analise.abasMensais.flatMap(a => (a.problemas || []).map(p => `${a.nome_aba}: ${p}`));
            if (todosProblemas.length === 0) return '';
            return `
              <div class="impfel-aviso-problemas">
                <strong>⚠ ${todosProblemas.length} aviso(s):</strong>
                <ul class="impfel-problemas-lista">
                  ${todosProblemas.slice(0, 12).map(p => `<li>${escapeHTML(p)}</li>`).join('')}
                  ${todosProblemas.length > 12 ? `<li style="color: var(--ink-faint)">... e mais ${todosProblemas.length - 12}</li>` : ''}
                </ul>
              </div>
            `;
          })()}
        </div>
        <div class="impfel-modal-footer">
          <button class="btn" id="impfel-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="impfel-confirmar">✓ Confirmar Importação</button>
        </div>
      </div>
      `;
      bind();
    }

    function bind() {
      modal.querySelector('#impfel-cancel').addEventListener('click', fechar);
      modal.querySelector('#impfel-cancelar').addEventListener('click', fechar);
      modal.addEventListener('click', (e) => { if (e.target === modal) fechar(); });

      modal.querySelectorAll('input[name="impfel-modo"]').forEach(r => {
        r.addEventListener('change', () => {
          const um = modal.querySelector('input[name="impfel-modo"]:checked').value === 'um';
          modal.querySelector('#impfel-mes-seletor').style.display = um ? 'flex' : 'none';
        });
      });

      modal.querySelectorAll('.impfel-input-mes').forEach(inp => {
        inp.addEventListener('change', () => {
          const idx = parseInt(inp.dataset.abaIdx, 10);
          const v = (inp.value || '').trim();
          if (/^\d{4}-\d{2}$/.test(v) && analise.abasMensais[idx]) {
            setMesAba(analise.abasMensais[idx], v);
            render();
          }
        });
      });

      modal.querySelector('#impfel-confirmar').addEventListener('click', confirmar);
    }

    async function confirmar() {
      const modo = modal.querySelector('input[name="impfel-modo"]:checked').value;
      const atualizarConfig = modal.querySelector('#impfel-importar-config').checked;

      let abasASalvar;
      if (modo === 'todos') {
        abasASalvar = analise.abasMensais;
      } else {
        const idx = parseInt(modal.querySelector('#impfel-mes-select').value, 10);
        abasASalvar = [analise.abasMensais[idx]].filter(Boolean);
      }

      try {
        Banco.db.exec('BEGIN');
        if (analise.fellowsACriar && analise.fellowsACriar.length > 0) {
          const novoMapa = criarFellowsFaltantes(analise.fellowsACriar);
          for (const aba of abasASalvar) {
            for (const l of aba.linhas) {
              if (!l.fellow_id) {
                const id = novoMapa.get(l.fellow_norm);
                if (id) l.fellow_id = id;
              }
            }
          }
        }
        if (atualizarConfig) salvarConfig(analise.cadastro);

        let totalSalvas = 0;
        for (const aba of abasASalvar) totalSalvas += salvarMes(aba);

        Banco.db.exec('COMMIT');
        await Banco.salvar({ imediato: true });

        const msgFel = analise.fellowsACriar && analise.fellowsACriar.length > 0
          ? ` (criados ${analise.fellowsACriar.length} fellows)` : '';
        Utilidades.toast(`✓ ${totalSalvas} plantões importados em ${abasASalvar.length} mês(es)${msgFel}`, 'success');
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
    if (document.getElementById('impfel-css')) return;
    const style = document.createElement('style');
    style.id = 'impfel-css';
    style.textContent = `
      .impfel-modal-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.5);
        display: flex; align-items: center; justify-content: center;
        z-index: 9999;
      }
      .impfel-modal {
        background: var(--bg-elevated);
        border-radius: 12px;
        width: 640px;
        max-width: 95vw;
        max-height: 90vh;
        display: flex; flex-direction: column;
      }
      .impfel-modal-header {
        padding: 14px 20px;
        border-bottom: 1px solid var(--border);
        display: flex; justify-content: space-between; align-items: center;
        font-weight: 700;
      }
      .impfel-modal-fechar { background: none; border: none; cursor: pointer; font-size: 16px; color: var(--ink-soft); }
      .impfel-modal-body { padding: 20px; overflow-y: auto; }
      .impfel-modal-footer { padding: 12px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }

      .impfel-upload-area {
        padding: 30px 20px;
        text-align: center;
        background: var(--bg-sunken);
        border: 2px dashed var(--border);
        border-radius: 12px;
      }

      .impfel-resumo {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        padding: 12px;
        background: var(--bg-sunken);
        border-radius: 8px;
        margin-bottom: 16px;
      }
      .impfel-resumo-item { text-align: center; }
      .impfel-resumo-label { font-size: 10px; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 4px; }
      .impfel-resumo-valor { font-size: 13px; color: var(--ink); }

      .impfel-modo-titulo { font-size: 10px; font-weight: 700; color: var(--ink-soft); letter-spacing: 0.06em; margin: 16px 0 8px; }
      .impfel-modo-opcoes { display: flex; flex-direction: column; gap: 8px; }
      .impfel-opcao {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 10px;
        border: 1px solid var(--border);
        border-radius: 8px;
        cursor: pointer;
      }
      .impfel-opcao:hover { background: var(--bg-sunken); }
      .impfel-opcao input { margin-top: 3px; }
      .impfel-opcao-corpo { flex: 1; }
      .impfel-opcao-titulo { font-weight: 600; font-size: 13px; }
      .impfel-opcao-sub { font-size: 11px; color: var(--ink-soft); margin-top: 2px; }

      .impfel-mes-seletor { margin-top: 8px; display: flex; gap: 8px; align-items: center; }
      .impfel-mes-atribuir {
        margin: 4px 0 16px; padding: 12px 14px;
        background: #FFF4E5; border: 1px solid #E6B97A; border-radius: 8px;
      }
      .impfel-mes-atribuir-titulo { font-size: 13px; font-weight: 700; color: #8A5A1F; }
      .impfel-mes-atribuir-sub { font-size: 11.5px; color: #8A5A1F; margin: 4px 0 10px; line-height: 1.4; }
      .impfel-mes-atribuir-linha {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 5px 0; font-size: 13px; color: var(--ink, #071a30);
      }
      .impfel-mes-atribuir-linha small { color: var(--ink-faint, #5a6879); }
      .impfel-input-mes {
        padding: 6px 9px; font-family: inherit; font-size: 14px;
        border: 1.5px solid var(--primary, #143352); border-radius: 8px; background: #fff; cursor: pointer;
      }
      .impfel-mes-seletor-label { font-size: 12px; color: var(--ink-soft); }
      .impfel-select { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; font-family: var(--mono); font-size: 12px; flex: 1; }

      .impfel-meses-detalhe { margin-top: 16px; }
      .impfel-meses-detalhe-titulo { font-size: 10px; font-weight: 700; color: var(--ink-soft); letter-spacing: 0.06em; margin-bottom: 8px; }
      .impfel-meses-lista { max-height: 180px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; }
      .impfel-mes-item {
        display: flex; align-items: center; gap: 12px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--border);
        font-size: 12px;
      }
      .impfel-mes-item:last-child { border-bottom: none; }
      .impfel-mes-nome { font-weight: 600; min-width: 60px; color: var(--primary); }
      .impfel-mes-tag { padding: 2px 8px; border-radius: 12px; font-size: 10px; text-transform: uppercase; font-weight: 700; }
      .impfel-tag-novo { background: #E1F5EE; color: #085041; }
      .impfel-tag-aviso { background: #e4ecf4; color: #854F0B; }
      .impfel-mes-stat { margin-left: auto; color: var(--ink-soft); font-size: 11px; }

      .impfel-cadastro-opt {
        display: flex; align-items: center; gap: 8px;
        margin-top: 16px;
        font-size: 12px;
        color: var(--ink-soft);
      }

      .impfel-aviso-fellows {
        margin-top: 14px;
        padding: 10px 12px;
        background: #e4ecf4;
        border: 1px solid #BA7517;
        border-radius: 8px;
        font-size: 12px;
        color: #633806;
      }
      .impfel-aviso-lista { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
      .impfel-aviso-tag {
        background: rgba(255,255,255,0.7);
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
      }
      .impfel-aviso-sub { margin-top: 6px; font-size: 11px; opacity: 0.8; }

      .impfel-aviso-problemas {
        margin-top: 14px;
        padding: 10px 12px;
        background: #FCEBEB;
        border: 1px solid #C04040;
        border-radius: 8px;
        font-size: 12px;
        color: #6E1F1F;
      }
      .impfel-problemas-lista {
        margin: 6px 0 0 18px;
        padding: 0;
        font-size: 11px;
        max-height: 120px;
        overflow-y: auto;
      }
      .impfel-problemas-lista li { margin-bottom: 2px; }
    `;
    document.head.appendChild(style);
  }

  // ──────────────────────────────────────────────────────────────────────
  // API pública
  // ──────────────────────────────────────────────────────────────────────
  window.ImportFellow = {
    abrirModal(onImportConcluida) {
      _injetarCSS();
      abrirModalUpload(onImportConcluida);
    },
    formatarMes,
    excluirMes,
    // V900: internos expostos para a suíte de regressão exercitar o parser
    // sem passar pelo file picker do modal.
    _interno: { analisarWorkbook, parseAbaMensal, parseCadastroValores,
                detectarColunasMensal, configDoBanco, salvarMes, criarFellowsFaltantes },
  };
})();
