/**
 * ============================================================================
 * MÓDULO: Importação de Fracionamento de Injeções Intra-Vítreas
 *
 * Helper consumido pelo fichário "desempenho-fracionamento".
 * Não é uma tela registrada — expõe apenas `window.ImportFracionamento`:
 *
 *   ImportFracionamento.abrirModal(callback)     -- abre o modal de upload
 *   ImportFracionamento.formatarMes(mes_ref)     -- 'Abr/26'
 *   ImportFracionamento.excluirMes(mes_ref, cb)  -- DELETE + save (com confirm)
 *
 * ESTRATÉGIA DE PARSING:
 *   - Lê o XLSX com `cellStyles: true` para capturar as cores de fundo
 *   - Cada GRUPO consecutivo de linhas com a mesma cor de fundo = 1 frasco
 *   - Frasco pode ter 2, 3 ou 4 aplicações (regra do ATLAS)
 *   - Particulares são extraídos do agrupamento (não geram repasse aqui —
 *     entram com eh_particular=1 pra que o módulo de 27% padrão particular
 *     processe depois)
 *   - Classificação INDIVIDUAL vs COMPARTILHADO: olha os médicos do grupo
 *     (mesmo médico = individual; >1 médico = compartilhado)
 *
 * DE-PARA INTELIGENTE DE MÉDICOS:
 *   Implementa matching por SUBSET DE PALAVRAS — se TODAS as palavras
 *   significativas do nome do relatório estão no nome do cadastro,
 *   considera match (ordem irrelevante).
 *     "TIAGO SUZUKI"  ⊂  "Tiago Suzuki Godoy"  → ✓
 *     "TIAGO GODOY"   ⊂  "Tiago Suzuki Godoy"  → ✓
 *     "TIAGO"         (1 palavra só)            → AMBÍGUO (não match)
 *   Em caso de ambiguidade (várias correspondências), pede resolução ao usuário.
 *
 * CÁLCULO DE REPASSE:
 *   Lê regra atual de `config_fracionamento` (V20 painel) e aplica:
 *     valor_repasse = valor_bruto - valor_fixo
 *   Onde valor_bruto vem da tabela (individual por posição, ou compartilhado
 *   pelo total de aplicações no frasco).
 *
 * REIMPORTAÇÃO: preserva overrides manuais (valor_repasse_manual) via chave
 * natural (mes_ref, data_aplicacao, paciente, medico_norm) — mesmo padrão
 * que ImportFellow usa.
 * ============================================================================
 */

(function () {
  'use strict';

  // ──────────────────────────────────────────────────────────────────────
  // HELPERS GERAIS
  // ──────────────────────────────────────────────────────────────────────

  const MESES_PT = {
    'JAN': 1, 'JANEIRO': 1,
    'FEV': 2, 'FEVEREIRO': 2,
    'MAR': 3, 'MARCO': 3, 'MARÇO': 3,
    'ABR': 4, 'ABRIL': 4,
    'MAI': 5, 'MAIO': 5,
    'JUN': 6, 'JUNHO': 6,
    'JUL': 7, 'JULHO': 7,
    'AGO': 8, 'AGOSTO': 8,
    'SET': 9, 'SETEMBRO': 9,
    'OUT': 10, 'OUTUBRO': 10,
    'NOV': 11, 'NOVEMBRO': 11,
    'DEZ': 12, 'DEZEMBRO': 12,
  };

  // Palavras "vazias" que não contam como tokens significativos
  const STOPWORDS = new Set([
    'DA', 'DE', 'DI', 'DO', 'DU',
    'DAS', 'DES', 'DIS', 'DOS', 'DUS',
    'E', 'EM', 'NO', 'NA', 'NOS', 'NAS',
    'DR', 'DRA', 'DR.', 'DRA.', 'PROF', 'PROF.',
  ]);

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

  function fmt(n, casas = 2) { return Utilidades.formatarNumero(n || 0, casas); }

  function formatarMes(mes_ref) {
    if (!mes_ref) return '—';
    const [ano, mes] = mes_ref.split('-');
    const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${nomes[parseInt(mes) - 1]}/${ano.slice(2)}`;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function dateParaISO(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function celulaParaDate(v) {
    if (v instanceof Date) return v;
    if (typeof v === 'number') {
      try {
        if (window.XLSX?.SSF?.parse_date_code) {
          const dc = XLSX.SSF.parse_date_code(v);
          return new Date(dc.y, dc.m - 1, dc.d);
        }
      } catch (e) { /* */ }
    }
    if (typeof v === 'string') {
      // 'YYYY-MM-DD' ou 'DD/MM/YYYY'
      const m1 = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m1) return new Date(+m1[1], +m1[2] - 1, +m1[3]);
      const m2 = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (m2) return new Date(+m2[3], +m2[2] - 1, +m2[1]);
    }
    return null;
  }

  /** Capitaliza nome ('JOÃO DA SILVA' → 'João da Silva'). */
  function capitalizar(nome) {
    if (!nome) return '';
    return String(nome).toLowerCase().split(/\s+/).map((palavra, i) => {
      // Mantém preposições em minúsculo (exceto se for a 1ª palavra)
      if (i > 0 && ['da', 'de', 'di', 'do', 'du', 'das', 'des', 'dos', 'dus', 'e'].includes(palavra)) {
        return palavra;
      }
      return palavra.charAt(0).toUpperCase() + palavra.slice(1);
    }).join(' ');
  }

  /**
   * Extrai tokens significativos do nome para match por subset:
   *   - Apenas palavras com ≥ 3 letras
   *   - Exclui stopwords (DA, DE, DR, etc.)
   *   - Normalizadas (uppercase, sem acento)
   */
  function tokensRelevantes(nome) {
    const norm = normalizar(nome);
    return norm.split(/\s+/).filter(t => t.length >= 3 && !STOPWORDS.has(t));
  }

  /**
   * Detecta mes_ref do nome da aba (ex: "FRACIONAMENTO ABRIL 2026" → '2026-04').
   * Fallback: usa null e o caller resolve por outra heurística (1ª data).
   */
  function detectarMesAba(nomeAba) {
    if (!nomeAba) return null;
    const norm = normalizar(nomeAba);
    // Procura "<MES> <ANO>" ou "<MES>/<ANO>" ou "<MES>-<ANO>"
    const m = norm.match(/([A-Z]{3,9})\s*[\/\-\s]?\s*(\d{4})/);
    if (m) {
      const mes = MESES_PT[m[1]];
      const ano = parseInt(m[2]);
      if (mes && ano >= 2020 && ano <= 2099) {
        return `${ano}-${pad2(mes)}`;
      }
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // COR DE CÉLULA — chave canônica para agrupamento de frascos
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Extrai chave canônica da cor de fundo da célula. Retorna string.
   *
   * SheetJS CE com `cellStyles: true` pode retornar:
   *   - cell.s.fgColor.rgb     -> 'FFFF3300'
   *   - cell.s.fgColor.theme   -> 5
   *   - cell.s.fgColor.tint    -> 0.4
   *   - cell.s.bgColor.rgb     -> alternativa quando fg não tem
   *
   * Retorna '' (string vazia) se a célula não tem cor de fundo
   * preenchida (default branco).
   */
  function chaveCorCelula(cell) {
    if (!cell || !cell.s) return '';
    const fill = cell.s;
    // patternType pode existir como 'none', 'solid', etc.
    // SheetJS CE às vezes coloca cor direto em s sem nested objects.
    const fg = fill.fgColor || fill.bgColor;
    if (!fg) {
      // Tentativa alternativa: alguns parsers colocam direto em s.color ou s.bg
      if (fill.color) return 'c:' + fill.color;
      if (fill.bg) return 'b:' + fill.bg;
      return '';
    }
    // Trata múltiplas formas de representação
    if (typeof fg === 'string') return 'rgb:' + fg.toUpperCase();
    if (fg.rgb) return 'rgb:' + String(fg.rgb).toUpperCase();
    if (fg.theme != null) {
      const tint = fg.tint != null ? Number(fg.tint).toFixed(4) : '0';
      return `theme:${fg.theme}:${tint}`;
    }
    if (fg.indexed != null) return 'idx:' + fg.indexed;
    return '';
  }

  // ──────────────────────────────────────────────────────────────────────
  // DE-PARA INTELIGENTE — subset de palavras
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Encontra médicos candidatos para o nome do relatório usando subset de
   * palavras. Pré-requisito: o nome do relatório precisa ter >= 2 tokens
   * relevantes para evitar falsos positivos.
   *
   * @param {string} nomeRelatorio
   * @param {Array}  medicos lista de objetos {id, nome_oficial, nome_normalizado, tipo_vinculo}
   * @returns {object} {match, candidatos, motivo}
   *     match: null | {medico, confianca} — match único e seguro
   *     candidatos: [] — sempre todos os candidatos por subset (mesmo se vazio)
   *     motivo: 'direto' | 'subset_unico' | 'ambiguo' | 'sem_tokens' | 'nao_encontrado'
   */
  function buscarMedicoInteligente(nomeRelatorio, medicos) {
    const normRel = normalizar(nomeRelatorio);
    // 1. Match direto (nome_normalizado idêntico)
    const direto = medicos.find(m => m.nome_normalizado === normRel);
    if (direto) {
      return { match: { medico: direto, confianca: 1.0 }, candidatos: [direto], motivo: 'direto' };
    }

    // 2. Match por subset de palavras
    const tokensRel = tokensRelevantes(nomeRelatorio);
    if (tokensRel.length < 2) {
      // Só com 1 token relevante, o risco de falsos positivos é grande
      return { match: null, candidatos: [], motivo: 'sem_tokens' };
    }
    const setRel = new Set(tokensRel);

    const candidatos = medicos.filter(m => {
      const tokensCad = tokensRelevantes(m.nome_oficial);
      const setCad = new Set(tokensCad);
      // Todos os tokens do relatório precisam estar no cadastro
      for (const t of setRel) {
        if (!setCad.has(t)) return false;
      }
      return true;
    });

    if (candidatos.length === 0) {
      return { match: null, candidatos: [], motivo: 'nao_encontrado' };
    }
    if (candidatos.length === 1) {
      // Confiança proporcional ao "overlap" dos tokens
      const tokensCad = tokensRelevantes(candidatos[0].nome_oficial);
      const overlap = tokensRel.length / Math.max(1, tokensCad.length);
      return { match: { medico: candidatos[0], confianca: 0.5 + 0.5 * overlap }, candidatos, motivo: 'subset_unico' };
    }
    // Ambíguo
    return { match: null, candidatos, motivo: 'ambiguo' };
  }

  // ──────────────────────────────────────────────────────────────────────
  // ANÁLISE DA PLANILHA (parsing + agrupamento + classificação)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Lê a aba "FRACIONAMENTO ..." e retorna estrutura preparada para o preview.
   *
   * Estrutura de retorno:
   *   {
   *     ok: true,
   *     mes_ref: '2026-04',
   *     nomeAba: 'FRACIONAMENTO ABRIL 2026',
   *     totalLinhas: 514,
   *     totalParticulares: 18,
   *     frascos: [
   *       {
   *         cor: 'rgb:FFFF3300',
   *         linhas: [N, N+1, ...]   (linhas do Excel, 1-indexed)
   *         total_aplicacoes: 4,
   *         compartilhado: false,
   *         medicamento: 'EYLIA 2MG',
   *         data_frasco: '2026-04-02',
   *         aplicacoes: [{linha, admissao, data, paciente, medico_raw, convenio, observacao, posicao_no_frasco}, ...]
   *       },
   *       ...
   *     ],
   *     particulares: [{...}],          // não fazem parte dos frascos (eh_particular=1)
   *     mediosResolucao: {                // De-Para inteligente
   *       resolvidos: Map<medico_raw, {medico_id, confianca, motivo}>,
   *       pendentes:  [{medico_raw, candidatos, motivo, ocorrencias}],
   *     },
   *     anomalias: [{tipo, descricao, linhas[]}],
   *   }
   */
  function analisarWorkbook(wb) {
    // 1. Identifica a aba mensal (deve ter "FRACIONAMENTO" no nome)
    const nomeAba = wb.SheetNames.find(n => /FRACIONAMENTO/i.test(n));
    if (!nomeAba) {
      return { ok: false, erro: 'Não encontrei nenhuma aba com "FRACIONAMENTO" no nome. Verifique o arquivo.' };
    }
    const ws = wb.Sheets[nomeAba];
    if (!ws['!ref']) {
      return { ok: false, erro: `A aba "${nomeAba}" está vazia.` };
    }

    // 2. Detecta mes_ref pelo nome da aba (fallback: usa primeira data)
    let mes_ref = detectarMesAba(nomeAba);

    // 3. Identifica colunas pelo cabeçalho (linha 2) — busca tolerante
    const range = window.XLSX.utils.decode_range(ws['!ref']);
    let linhaCabecalho = -1;
    const idxCol = { admissao: -1, data: -1, paciente: -1, medico: -1, convenio: -1, observacao: -1 };

    for (let r = range.s.r; r <= Math.min(range.s.r + 5, range.e.r); r++) {
      let acertos = 0;
      const idx = { admissao: -1, data: -1, paciente: -1, medico: -1, convenio: -1, observacao: -1 };
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell || !cell.v) continue;
        const v = normalizar(cell.v);
        if (/^ADMIS/.test(v) && idx.admissao < 0) { idx.admissao = c; acertos++; }
        else if (/^DATA/.test(v) && idx.data < 0) { idx.data = c; acertos++; }
        else if (/^PACIE/.test(v) && idx.paciente < 0) { idx.paciente = c; acertos++; }
        else if (/^MEDIC/.test(v) && idx.medico < 0) { idx.medico = c; acertos++; }
        else if (/^CONVE/.test(v) && idx.convenio < 0) { idx.convenio = c; acertos++; }
        else if (/^OBSERV/.test(v) && idx.observacao < 0) { idx.observacao = c; acertos++; }
      }
      if (acertos >= 4) { linhaCabecalho = r; Object.assign(idxCol, idx); break; }
    }
    if (linhaCabecalho < 0) {
      return { ok: false, erro: `Não encontrei o cabeçalho na aba "${nomeAba}" (esperava ADMISSÃO, DATA, PACIENTE, MEDICO, CONVENIO, OBSERVAÇÃO).` };
    }

    // 4. Itera pelas linhas extraindo dados e cor de fundo
    const linhasRaw = [];
    let temAlgumaCor = false;
    for (let r = linhaCabecalho + 1; r <= range.e.r; r++) {
      const cellPac = ws[XLSX.utils.encode_cell({ r, c: idxCol.paciente })];
      if (!cellPac || cellPac.v == null || String(cellPac.v).trim() === '') continue;  // pula vazias

      const admissao = ws[XLSX.utils.encode_cell({ r, c: idxCol.admissao })]?.v;
      const dataCell = ws[XLSX.utils.encode_cell({ r, c: idxCol.data })];
      const dataRaw = dataCell?.v;
      const paciente = String(cellPac.v || '').trim();
      const medico = String(ws[XLSX.utils.encode_cell({ r, c: idxCol.medico })]?.v || '').trim();
      const convenio = String(ws[XLSX.utils.encode_cell({ r, c: idxCol.convenio })]?.v || '').trim();
      const observacao = String(ws[XLSX.utils.encode_cell({ r, c: idxCol.observacao })]?.v || '').trim();

      const dataObj = celulaParaDate(dataRaw);
      const dataISO = dateParaISO(dataObj);

      // Cor de fundo da linha — pega da coluna A (paciente é seguro também)
      const cellRef = XLSX.utils.encode_cell({ r, c: range.s.c });
      const corA = chaveCorCelula(ws[cellRef]);
      const corP = chaveCorCelula(cellPac);
      const cor = corA || corP || '';
      if (cor) temAlgumaCor = true;

      linhasRaw.push({
        linha: r + 1,   // 1-indexed para mostrar ao usuário
        admissao: admissao != null ? String(admissao) : '',
        data: dataISO,
        paciente,
        medico_raw: medico,
        medico_norm: normalizar(medico),
        convenio,
        observacao: normalizarMedicamento(observacao),
        cor,
        eh_particular: /PARTICULAR/i.test(convenio),
      });
    }

    if (linhasRaw.length === 0) {
      return { ok: false, erro: `Nenhuma linha de dados encontrada na aba "${nomeAba}".` };
    }

    if (!temAlgumaCor) {
      return { ok: false, erro:
        `Não detectei nenhuma cor de fundo nas células da aba "${nomeAba}".\n\n` +
        `O agrupamento de frascos depende das cores. Verifique se o arquivo foi gerado pela líder com as cores aplicadas — ou se está salvo em formato compatível (.xlsx).`
      };
    }

    // Fallback de mes_ref: usa a 1ª data encontrada
    if (!mes_ref) {
      const linhaComData = linhasRaw.find(l => l.data);
      if (linhaComData) {
        const [a, m] = linhaComData.data.split('-');
        mes_ref = `${a}-${m}`;
      }
    }
    if (!mes_ref) {
      return { ok: false, erro: 'Não foi possível determinar o mês de referência (nem pelo nome da aba, nem pela coluna DATA).' };
    }

    // 5. Separa particulares dos demais
    const naoParticulares = linhasRaw.filter(l => !l.eh_particular);
    const particulares = linhasRaw.filter(l => l.eh_particular);

    // 6. Agrupa por cor consecutiva nas linhas NÃO particulares
    const frascos = [];
    let grupoAtual = [];
    let corAtual = null;
    for (const l of naoParticulares) {
      if (l.cor === corAtual && grupoAtual.length > 0) {
        grupoAtual.push(l);
      } else {
        if (grupoAtual.length > 0) frascos.push(formarFrasco(grupoAtual));
        grupoAtual = [l];
        corAtual = l.cor;
      }
    }
    if (grupoAtual.length > 0) frascos.push(formarFrasco(grupoAtual));

    // 7. Detecta anomalias
    const anomalias = [];
    for (const f of frascos) {
      if (f.total_aplicacoes < 2) {
        anomalias.push({
          tipo: 'frasco_unico',
          descricao: `Frasco com apenas 1 aplicação (não há fracionamento real)`,
          linhas: f.linhas,
        });
      }
      if (f.total_aplicacoes > 4) {
        anomalias.push({
          tipo: 'frasco_excesso',
          descricao: `Frasco com ${f.total_aplicacoes} aplicações (limite é 4)`,
          linhas: f.linhas,
        });
      }
      // Frasco sem cor (cor vazia) = não conseguimos identificar grupo
      if (!f.cor) {
        anomalias.push({
          tipo: 'sem_cor',
          descricao: `Linhas sem cor de fundo — verifique se foi pintado pela líder`,
          linhas: f.linhas,
        });
      }
    }

    // 8. Resolve médicos via De-Para inteligente
    const medicos = Banco.query(`
      SELECT id, nome_oficial, nome_normalizado, tipo_vinculo
      FROM medicos WHERE ativo = 1
    `);
    const mediosResolucao = resolverMedicos(linhasRaw, medicos);

    return {
      ok: true,
      mes_ref,
      nomeAba,
      totalLinhas: linhasRaw.length,
      totalParticulares: particulares.length,
      frascos,
      particulares,
      mediosResolucao,
      anomalias,
    };
  }

  /** Forma um objeto-frasco a partir de N linhas consecutivas com mesma cor. */
  function formarFrasco(linhas) {
    const cor = linhas[0].cor;
    const total_aplicacoes = linhas.length;
    // Detecta médicos distintos
    const medicos = new Set(linhas.map(l => l.medico_norm).filter(Boolean));
    const compartilhado = medicos.size > 1;
    // Medicamento predominante (modo)
    const medicCount = {};
    linhas.forEach(l => { medicCount[l.observacao] = (medicCount[l.observacao] || 0) + 1; });
    const medicamento = Object.entries(medicCount).sort((a, b) => b[1] - a[1])[0][0];
    const data_frasco = linhas[0].data;
    const aplicacoes = linhas.map((l, idx) => ({
      ...l,
      posicao_no_frasco: idx + 1,
    }));
    return {
      cor,
      linhas: linhas.map(l => l.linha),
      total_aplicacoes,
      compartilhado,
      medicamento,
      data_frasco,
      aplicacoes,
    };
  }

  /** Normaliza grafias de medicamentos: 'EYLIA  2MG' / 'EYLIA 2 MG' → 'EYLIA 2MG'. */
  function normalizarMedicamento(obs) {
    if (!obs) return '';
    const norm = normalizar(obs);
    // Junta números colados a letras: 'EYLIA 2 MG' -> 'EYLIA 2MG'
    return norm.replace(/(\d+)\s+(MG|MCG|ML)\b/g, '$1$2');
  }

  /** Roda o de-para inteligente para todos os nomes únicos do relatório. */
  function resolverMedicos(linhasRaw, medicos) {
    const nomes = new Map(); // medico_raw -> ocorrencias
    for (const l of linhasRaw) {
      if (!l.medico_raw) continue;
      nomes.set(l.medico_raw, (nomes.get(l.medico_raw) || 0) + 1);
    }

    const resolvidos = new Map();
    const pendentes = [];
    for (const [nomeRaw, ocorrencias] of nomes) {
      const r = buscarMedicoInteligente(nomeRaw, medicos);
      if (r.match) {
        resolvidos.set(nomeRaw, {
          medico_id: r.match.medico.id,
          medico_oficial: r.match.medico.nome_oficial,
          confianca: r.match.confianca,
          motivo: r.motivo,
        });
      } else {
        pendentes.push({
          medico_raw: nomeRaw,
          candidatos: r.candidatos,
          motivo: r.motivo,
          ocorrencias,
        });
      }
    }
    return { resolvidos, pendentes };
  }

  // ──────────────────────────────────────────────────────────────────────
  // CÁLCULO DE REPASSE
  // ──────────────────────────────────────────────────────────────────────

  function lerRegraFracionamento() {
    function getCfg(chave, fallback) {
      try {
        const r = Banco.queryUnica(`SELECT valor FROM config_fracionamento WHERE chave = ?`, [chave]);
        return r ? Number(r.valor) : fallback;
      } catch (e) { return fallback; }
    }
    return {
      valorFixo: getCfg('VALOR_FIXO', 418.52),
      bruto1: getCfg('VALOR_BRUTO_POS1', 868.52),
      bruto2: getCfg('VALOR_BRUTO_POS2', 968.52),
      bruto3: getCfg('VALOR_BRUTO_POS3', 1118.52),
      bruto4: getCfg('VALOR_BRUTO_POS4', 1318.52),
      brutoCompart2: getCfg('VALOR_BRUTO_COMPART_2', 918.52),
      brutoCompart3: getCfg('VALOR_BRUTO_COMPART_3', 985.18),
      brutoCompart4: getCfg('VALOR_BRUTO_COMPART_4', 1068.52),
      pctParticular: getCfg('PCT_PARTICULAR', 27.00),
    };
  }

  function calcularValoresFrasco(frasco, regra) {
    for (const apl of frasco.aplicacoes) {
      const bruto = frasco.compartilhado
        ? (regra['brutoCompart' + frasco.total_aplicacoes] || 0)
        : (regra['bruto' + apl.posicao_no_frasco] || 0);
      apl.valor_fracionamento = bruto;
      apl.valor_fixo = regra.valorFixo;
      apl.valor_repasse = bruto - regra.valorFixo;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // CRUZAMENTO COM QVIS (primário) + PRODUÇÃO (fallback)
  // — calcular repasse dos PARTICULARES
  //
  // Regra do ATLAS (definida pelo usuário):
  //   - Para cada aplicação particular do fracionamento, buscar PRIMEIRO
  //     no QVIS do mesmo mês (origem='PARTICULAR' + procedimento contém
  //     INJEÇÃO INTRA VÍTREA).
  //   - Se não achar no QVIS, fazer DOUBLE-CHECK na PRODUÇÃO do mesmo mês
  //     (tipo_recebimento='PARTICULAR' + subcategoria/procedimento contém
  //     INJEÇÃO).
  //   - Se achou em algum dos dois: aplicar PCT_PARTICULAR sobre o valor
  //     produzido = valor_repasse.
  //   - Se não achou em nenhum: marcar como 'SEM_VALOR' (modal explica).
  //   - Médico beneficiário = quem está no fracionamento (planilha do CC).
  //
  // DEDUPLICAÇÃO no QVIS: a mesma admissão+procedimento aparece em várias
  // linhas (uma por papel), mas o `produzido` é o valor TOTAL — então fazemos
  // distinct por (admissao, procedimento_normalizado, produzido).
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Normaliza texto pra comparação (UPPER + sem acento + trim).
   */
  function normUpper(s) {
    if (!s) return '';
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  }

  /** Indexa QVIS (origem=PARTICULAR + procedimento INJEÇÃO INTRA VÍTREA). */
  function indexarQvisParticular(mes_ref) {
    if (!mes_ref) return new Map();
    let linhas;
    try {
      linhas = Banco.query(`
        SELECT admissao, procedimento_normalizado, procedimento, produzido
          FROM linhas_qvis
         WHERE competencia = ? AND origem = 'PARTICULAR'
      `, [mes_ref]);
    } catch (e) { return new Map(); }
    const FILTRO = 'INJECAO INTRA VITREA';
    const vistos = new Set();
    const idx = new Map();
    for (const l of linhas) {
      if (!l.admissao) continue;
      const procNorm = normUpper(l.procedimento_normalizado || l.procedimento);
      if (!procNorm.includes(FILTRO)) continue;
      const produzido = Number(l.produzido) || 0;
      if (produzido <= 0) continue;
      const adm = String(l.admissao).trim();
      const k = `${adm}|${procNorm}|${produzido.toFixed(2)}`;
      if (vistos.has(k)) continue;  // mesma linha lógica com papel diferente
      vistos.add(k);
      idx.set(adm, (idx.get(adm) || 0) + produzido);
    }
    return idx;
  }

  /** Indexa PRODUÇÃO (tipo_recebimento=PARTICULAR + subcategoria/proc contém INJEÇÃO). */
  function indexarProducaoParticular(mes_ref) {
    if (!mes_ref) return new Map();
    let linhas;
    try {
      linhas = Banco.query(`
        SELECT cod_admissao, subcategoria, procedimento_principal, valor
          FROM linhas_producao
         WHERE competencia = ? AND tipo_recebimento = 'PARTICULAR'
      `, [mes_ref]);
    } catch (e) { return new Map(); }
    // Critério do usuário: subcategoria contém 'INJECAO' (sem acento)
    // OR procedimento_principal contém 'INJECAO INTRA VITREA'
    const idx = new Map();
    for (const l of linhas) {
      if (!l.cod_admissao) continue;
      const subcat = normUpper(l.subcategoria);
      const proc   = normUpper(l.procedimento_principal);
      if (!subcat.includes('INJECAO') && !proc.includes('INJECAO INTRA VITREA')) continue;
      const valor = Number(l.valor) || 0;
      if (valor <= 0) continue;
      const adm = String(l.cod_admissao).trim();
      idx.set(adm, (idx.get(adm) || 0) + valor);
    }
    return idx;
  }

  /**
   * Combina QVIS (primário) e PRODUÇÃO (fallback). Retorna:
   *   Map<admissao, {valor: number, origem: 'QVIS' | 'PRODUCAO'}>
   * Admissões sem produção em nenhuma fonte simplesmente NÃO entram no mapa.
   */
  function indexarProduzidoParticular(mes_ref) {
    const idx = new Map();
    const qvis = indexarQvisParticular(mes_ref);
    for (const [adm, val] of qvis) {
      idx.set(adm, { valor: val, origem: 'QVIS' });
    }
    const prod = indexarProducaoParticular(mes_ref);
    for (const [adm, val] of prod) {
      if (!idx.has(adm)) idx.set(adm, { valor: val, origem: 'PRODUCAO' });
    }
    return idx;
  }

  /**
   * Cruza a lista de particulares (objetos com .admissao) com QVIS+PRODUÇÃO
   * do mês e atribui:
   *   apl.valor_fracionamento = valor produzido daquela admissão (R$ bruto)
   *   apl.valor_fixo          = 0
   *   apl.valor_repasse       = valor_fracionamento × (pct / 100)
   *   apl.valor_origem        = 'QVIS' | 'PRODUCAO' | 'SEM_VALOR'
   *
   * Retorna: {encontrados, encontrados_qvis, encontrados_producao, sem_valor, total_repasse}
   */
  function cruzarParticularesComProducao(particulares, mes_ref, pctParticular) {
    const idx = indexarProduzidoParticular(mes_ref);
    const pct = Number(pctParticular) || 0;
    let encontrados = 0, encontrados_qvis = 0, encontrados_producao = 0;
    let sem_valor = 0, total_repasse = 0;
    for (const apl of particulares) {
      const k = apl.admissao ? String(apl.admissao).trim() : '';
      const hit = idx.get(k);
      if (hit && hit.valor > 0) {
        apl.valor_fracionamento = hit.valor;
        apl.valor_fixo = 0;
        apl.valor_repasse = hit.valor * pct / 100;
        apl.valor_origem = hit.origem;
        encontrados++;
        if (hit.origem === 'QVIS') encontrados_qvis++;
        else if (hit.origem === 'PRODUCAO') encontrados_producao++;
        total_repasse += apl.valor_repasse;
      } else {
        apl.valor_fracionamento = 0;
        apl.valor_fixo = 0;
        apl.valor_repasse = 0;
        apl.valor_origem = 'SEM_VALOR';
        sem_valor++;
      }
    }
    // Mantém os nomes antigos pra compatibilidade (sem_producao = sem_valor)
    return { encontrados, encontrados_qvis, encontrados_producao,
             sem_valor, sem_producao: sem_valor, total_repasse };
  }

  /**
   * Recalcula no banco os valores de TODAS as aplicações particulares do mês
   * cruzando com QVIS+PRODUÇÃO atual.
   *
   * Preserva overrides manuais (valor_repasse_manual). Roda em transação.
   *
   * @returns {Promise<{encontrados_qvis, encontrados_producao, sem_valor, total_repasse, total, pct}>}
   */
  async function recalcularParticularesNoBanco(mes_ref) {
    if (!mes_ref) throw new Error('mes_ref obrigatório');
    const regra = lerRegraFracionamento();
    const idx = indexarProduzidoParticular(mes_ref);
    const pct = Number(regra.pctParticular) || 0;

    const particulares = Banco.query(`
      SELECT id, admissao
        FROM fracionamento_aplicacoes
       WHERE mes_ref = ? AND eh_particular = 1
    `, [mes_ref]);

    let encontrados_qvis = 0, encontrados_producao = 0;
    let sem_valor = 0, total_repasse = 0;
    Banco.db.exec('BEGIN');
    try {
      const stmt = Banco.db.prepare(`
        UPDATE fracionamento_aplicacoes
        SET valor_fracionamento = ?, valor_fixo = 0, valor_repasse = ?, valor_origem = ?
        WHERE id = ?
      `);
      try {
        for (const p of particulares) {
          const k = p.admissao ? String(p.admissao).trim() : '';
          const hit = idx.get(k);
          if (hit && hit.valor > 0) {
            const repasse = hit.valor * pct / 100;
            stmt.run([hit.valor, repasse, hit.origem, p.id]);
            if (hit.origem === 'QVIS') encontrados_qvis++;
            else encontrados_producao++;
            total_repasse += repasse;
          } else {
            stmt.run([0, 0, 'SEM_VALOR', p.id]);
            sem_valor++;
          }
        }
      } finally { stmt.free(); }
      Banco.db.exec('COMMIT');
    } catch (e) {
      Banco.db.exec('ROLLBACK');
      throw e;
    }
    await Banco.salvar({ imediato: true });
    return {
      encontrados_qvis, encontrados_producao,
      encontrados: encontrados_qvis + encontrados_producao,
      sem_valor, sem_producao: sem_valor,  // alias retro-compat
      total_repasse, total: particulares.length, pct,
    };
  }

  /**
   * Busca detalhes de uma admissão particular em QVIS e PRODUÇÃO pra exibir
   * num modal de diagnóstico ("por que essa admissão ficou sem valor").
   * Retorna: { qvis: [...], producao: [...] }
   */
  function buscarDetalhesAdmissaoParticular(admissao, mes_ref) {
    const adm = String(admissao || '').trim();
    if (!adm) return { qvis: [], producao: [] };

    let qvis = [];
    try {
      qvis = Banco.query(`
        SELECT papel, procedimento, procedimento_normalizado,
               quantidade, produzido, honorario, recebido, repassado,
               classificacao_produto, tipo_recebimento, convenio
          FROM linhas_qvis
         WHERE competencia = ? AND admissao = ?
         ORDER BY procedimento_normalizado, papel
      `, [mes_ref, adm]);
    } catch (e) { /* tabela pode não existir */ }

    let producao = [];
    try {
      producao = Banco.query(`
        SELECT categoria, subcategoria, procedimento_principal, produto,
               quantidade, valor, tipo_recebimento, convenio,
               profissional_admissao, medico, cirurgiao
          FROM linhas_producao
         WHERE competencia = ? AND cod_admissao = ?
         ORDER BY categoria, subcategoria, procedimento_principal
      `, [mes_ref, adm]);
    } catch (e) { /* tabela pode não existir */ }

    return { qvis, producao };
  }

  // ──────────────────────────────────────────────────────────────────────
  // PERSISTÊNCIA NO BANCO
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Salva (ou re-salva) o mês inteiro. Roda em transação. Preserva overrides
   * manuais (valor_repasse_manual) que o usuário tenha aplicado antes.
   */
  function salvarImportacao(analise, mediosResolvidosFinal) {
    const { mes_ref, frascos, particulares } = analise;

    // 1. Captura overrides manuais existentes
    let manuaisSalvos = [];
    try {
      manuaisSalvos = Banco.query(`
        SELECT data_aplicacao, paciente, medico_norm, valor_repasse_manual
        FROM fracionamento_aplicacoes
        WHERE mes_ref = ? AND valor_repasse_manual IS NOT NULL
      `, [mes_ref]);
    } catch (e) { /* primeira importação */ }

    Banco.db.exec('BEGIN');
    try {
      // 2. Apaga aplicações e frascos do mês (CASCADE limpa aplicações pelos frascos)
      Banco.executar('DELETE FROM fracionamento_aplicacoes WHERE mes_ref = ?', [mes_ref]);
      Banco.executar('DELETE FROM fracionamento_frascos WHERE mes_ref = ?', [mes_ref]);

      // 3. Insere frascos e capturando seus IDs
      const stmtFrasco = Banco.db.prepare(`
        INSERT INTO fracionamento_frascos
          (mes_ref, data_frasco, medicamento, cor_hex, total_aplicacoes, compartilhado, origem)
        VALUES (?, ?, ?, ?, ?, ?, 'planilha')
      `);
      const stmtApl = Banco.db.prepare(`
        INSERT INTO fracionamento_aplicacoes
          (frasco_id, mes_ref, admissao, data_aplicacao, paciente,
           medico_nome, medico_norm, medico_id, convenio, observacao,
           posicao_no_frasco, eh_particular,
           valor_fracionamento, valor_fixo, valor_repasse, valor_origem, origem)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planilha')
      `);

      try {
        for (const f of frascos) {
          stmtFrasco.run([
            mes_ref, f.data_frasco, f.medicamento, f.cor,
            f.total_aplicacoes, f.compartilhado ? 1 : 0,
          ]);
          // Recupera o ID gerado (sqlite usa last_insert_rowid)
          const idRow = Banco.queryUnica('SELECT last_insert_rowid() AS id');
          const frascoId = idRow.id;
          for (const apl of f.aplicacoes) {
            const medicoInfo = mediosResolvidosFinal.get(apl.medico_raw);
            stmtApl.run([
              frascoId, mes_ref, apl.admissao, apl.data, apl.paciente,
              apl.medico_raw, apl.medico_norm,
              medicoInfo?.medico_id || null,
              apl.convenio, apl.observacao,
              apl.posicao_no_frasco, 0,
              apl.valor_fracionamento, apl.valor_fixo, apl.valor_repasse,
              null,  // valor_origem só faz sentido pra particulares
            ]);
          }
        }

        // 4. Particulares — sem frasco. Valores vêm do cruzamento com QVIS/PRODUÇÃO
        //    (campos valor_fracionamento/valor_fixo/valor_repasse/valor_origem
        //    já preenchidos por cruzarParticularesComProducao). Quando a admissão
        //    não foi achada, valor_origem = 'SEM_VALOR' e valores ficam zerados.
        for (const p of particulares) {
          const medicoInfo = mediosResolvidosFinal.get(p.medico_raw);
          stmtApl.run([
            null, mes_ref, p.admissao, p.data, p.paciente,
            p.medico_raw, p.medico_norm,
            medicoInfo?.medico_id || null,
            p.convenio, p.observacao,
            null, 1,
            p.valor_fracionamento || 0,
            p.valor_fixo          || 0,
            p.valor_repasse       || 0,
            p.valor_origem        || 'SEM_VALOR',
          ]);
        }
      } finally {
        stmtFrasco.free();
        stmtApl.free();
      }

      // 5. Reaplica overrides manuais (pela chave natural)
      if (manuaisSalvos.length > 0) {
        const stmtUpd = Banco.db.prepare(`
          UPDATE fracionamento_aplicacoes
          SET valor_repasse_manual = ?
          WHERE mes_ref = ? AND data_aplicacao = ? AND paciente = ? AND medico_norm = ?
        `);
        let reaplicados = 0;
        try {
          for (const m of manuaisSalvos) {
            stmtUpd.run([m.valor_repasse_manual, mes_ref, m.data_aplicacao, m.paciente, m.medico_norm]);
            reaplicados++;
          }
        } finally { stmtUpd.free(); }
        if (reaplicados > 0) {
          console.log(`📌 ${reaplicados} override(s) manual(is) de fracionamento preservado(s) em ${mes_ref}`);
        }
      }

      Banco.db.exec('COMMIT');
    } catch (e) {
      Banco.db.exec('ROLLBACK');
      throw e;
    }
  }

  function excluirMes(mes_ref, onSuccess) {
    if (!confirm(`Excluir TODOS os dados de fracionamento de ${formatarMes(mes_ref)}?\n\nIsso não afeta a regra de pagamento configurada — apenas remove as aplicações e frascos importados deste mês.`)) {
      return;
    }
    Banco.db.exec('BEGIN');
    try {
      Banco.executar('DELETE FROM fracionamento_aplicacoes WHERE mes_ref = ?', [mes_ref]);
      Banco.executar('DELETE FROM fracionamento_frascos WHERE mes_ref = ?', [mes_ref]);
      Banco.db.exec('COMMIT');
      Banco.salvar().then(() => {
        Utilidades.toast('✓ Mês excluído', 'success');
        if (onSuccess) onSuccess();
      });
    } catch (e) {
      Banco.db.exec('ROLLBACK');
      Utilidades.toast('Erro: ' + e.message, 'error');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // CRIAÇÃO DE MÉDICOS (resolução de pendentes)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Cria um médico INTERNO a partir do nome do relatório. Usado quando o
   * usuário escolhe "criar novo" para um pendente.
   * Retorna o novo medico_id.
   */
  function criarMedicoInterno(nomeRaw) {
    const nomeOficial = capitalizar(nomeRaw);
    const normOficial = normalizar(nomeOficial);
    // Verifica se já existe (defensivo)
    const existente = Banco.queryUnica(
      `SELECT id FROM medicos WHERE nome_normalizado = ? AND ativo = 1`,
      [normOficial]
    );
    if (existente) return existente.id;

    Banco.executar(
      `INSERT INTO medicos (nome_oficial, nome_normalizado, tipo_vinculo, ativo)
       VALUES (?, ?, 'INTERNO', 1)`,
      [nomeOficial, normOficial]
    );
    const r = Banco.queryUnica(
      `SELECT id FROM medicos WHERE nome_normalizado = ? ORDER BY id DESC LIMIT 1`,
      [normOficial]
    );
    return r.id;
  }

  // ──────────────────────────────────────────────────────────────────────
  // UI — MODAL DE UPLOAD
  // ──────────────────────────────────────────────────────────────────────

  function abrirModalUpload(onImportConcluida) {
    _injetarCSS();
    const overlay = document.createElement('div');
    overlay.className = 'impfrac-modal-overlay';
    overlay.innerHTML = `
      <div class="impfrac-modal" style="width: 520px">
        <div class="impfrac-modal-header">
          <span>💉 Importar Planilha de Fracionamento</span>
          <button class="impfrac-modal-fechar" id="impfrac-cancel">✕</button>
        </div>
        <div class="impfrac-modal-body">
          <div class="impfrac-upload-area">
            <div style="font-size: 36px; margin-bottom: 8px;">📂</div>
            <div style="font-weight: 700; margin-bottom: 4px;">Selecione a planilha da líder do CC</div>
            <div style="font-size: 11px; color: var(--ink-soft); margin-bottom: 14px;">
              Esperado: arquivo .xlsx com uma aba "FRACIONAMENTO &lt;MÊS&gt; &lt;ANO&gt;" e cores de fundo agrupando os frascos.
            </div>
            <button class="btn btn-primary" id="impfrac-pick">📂 Escolher arquivo Excel</button>
            <input type="file" id="impfrac-file" accept=".xlsx,.xls" style="display:none">
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const fechar = () => overlay.remove();
    document.getElementById('impfrac-cancel').addEventListener('click', fechar);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });

    const fileInput = document.getElementById('impfrac-file');
    document.getElementById('impfrac-pick').addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      Utilidades.mostrarLoading('Analisando planilha...');
      try {
        const buf = await f.arrayBuffer();
        // cellStyles: true → habilita leitura de cores das células
        const wb = window.XLSX.read(buf, { type: 'array', cellDates: true, cellStyles: true });
        const analise = analisarWorkbook(wb);
        Utilidades.esconderLoading();

        if (!analise.ok) {
          alert('❌ ' + analise.erro);
          return;
        }

        // Calcula valores em todos os frascos
        const regra = lerRegraFracionamento();
        for (const f of analise.frascos) {
          calcularValoresFrasco(f, regra);
        }

        // Cruza particulares com a produção do mês (27% sobre valor produzido
        // do procedimento INJECAO INTRA VITREA na mesma admissão)
        analise.statusParticular = cruzarParticularesComProducao(
          analise.particulares, analise.mes_ref, regra.pctParticular
        );

        fechar();
        mostrarConfirmacao(analise, regra, onImportConcluida);
      } catch (e) {
        Utilidades.esconderLoading();
        console.error(e);
        alert(`❌ Erro ao ler o arquivo:\n\n${e.message}`);
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // UI — MODAL DE CONFIRMAÇÃO (preview com alertas e resolução de pendentes)
  // ──────────────────────────────────────────────────────────────────────

  function mostrarConfirmacao(analise, regra, onImportConcluida) {
    // Resolução de médicos: começa do snapshot da análise, com possibilidade
    // de override pelo usuário nos selects.
    // Map<medico_raw, {medico_id, medico_oficial, criar_novo: bool}>
    const resolucaoFinal = new Map();
    analise.mediosResolucao.resolvidos.forEach((v, k) => {
      resolucaoFinal.set(k, { ...v, criar_novo: false });
    });
    // Pendentes começam vazios (precisam ser preenchidos pelo usuário)
    // null = ainda não resolvido (vai bloquear o save)

    const overlay = document.createElement('div');
    overlay.className = 'impfrac-modal-overlay';
    overlay.innerHTML = `<div class="impfrac-modal impfrac-modal-grande"></div>`;
    document.body.appendChild(overlay);
    const modal = overlay.querySelector('.impfrac-modal');

    function renderModal() {
      const jaExiste = jaImportadoEsteMes(analise.mes_ref);
      const totalFrascos = analise.frascos.length;
      const totalAplFrasco = analise.frascos.reduce((s, f) => s + f.aplicacoes.length, 0);
      const totalBrutoConv = analise.frascos.reduce((s, f) => s + f.aplicacoes.reduce((ss, a) => ss + a.valor_fracionamento, 0), 0);
      const totalFixoConv  = analise.frascos.reduce((s, f) => s + f.aplicacoes.reduce((ss, a) => ss + a.valor_fixo, 0), 0);
      const totalRepasseConv = totalBrutoConv - totalFixoConv;
      const totalRepassePart = analise.statusParticular?.total_repasse || 0;
      const totalRepasse = totalRepasseConv + totalRepassePart;
      const sp = analise.statusParticular || { encontrados: 0, sem_producao: 0 };

      // Pendentes ainda sem resolução
      const pendentes = analise.mediosResolucao.pendentes;
      const pendentesAbertos = pendentes.filter(p => !resolucaoFinal.has(p.medico_raw));

      const podeImportar = pendentesAbertos.length === 0;

      modal.innerHTML = `
        <div class="impfrac-modal-header">
          <span>💉 Confirmar importação — ${formatarMes(analise.mes_ref)}</span>
          <button class="impfrac-modal-fechar" id="impfrac-conf-cancel">✕</button>
        </div>
        <div class="impfrac-modal-body impfrac-modal-body-scroll">
          <div class="impfrac-mes-sel">
            <label for="impfrac-mes-input">📅 Mês de referência desta importação</label>
            <input type="month" id="impfrac-mes-input" value="${analise.mes_ref || ''}">
            <span class="impfrac-mes-hint">Detectado pela aba "${escapeHTML(analise.nomeAba || '')}". <strong>Confira e corrija</strong> se estiver errado — é este mês que será gravado/substituído.</span>
          </div>
          ${jaExiste ? `
            <div class="impfrac-warning">
              ⚠ Já existem dados de fracionamento para ${formatarMes(analise.mes_ref)}.
              Confirmar irá <strong>substituir</strong> os dados existentes
              (overrides manuais serão preservados).
            </div>
          ` : ''}

          <div class="impfrac-summary-grid">
            <div class="impfrac-stat">
              <div class="impfrac-stat-label">Frascos</div>
              <div class="impfrac-stat-valor mono">${totalFrascos}</div>
            </div>
            <div class="impfrac-stat">
              <div class="impfrac-stat-label">Aplicações de convênio</div>
              <div class="impfrac-stat-valor mono">${totalAplFrasco}</div>
            </div>
            <div class="impfrac-stat impfrac-stat-aviso">
              <div class="impfrac-stat-label">Particulares (27% prod.)</div>
              <div class="impfrac-stat-valor mono">${analise.totalParticulares}</div>
              <div style="font-size: 10px; color: var(--ink-soft); margin-top: 3px">
                ${sp.encontrados}/${analise.totalParticulares} com produção
              </div>
            </div>
            <div class="impfrac-stat impfrac-stat-destaque">
              <div class="impfrac-stat-label">Total a repassar</div>
              <div class="impfrac-stat-valor mono">R$ ${fmt(totalRepasse, 2)}</div>
            </div>
          </div>

          <div class="impfrac-secao">
            <h4>Distribuição dos frascos</h4>
            <table class="impfrac-tabela">
              <thead>
                <tr>
                  <th>Aplicações no frasco</th>
                  <th class="num">Frascos individuais</th>
                  <th class="num">Frascos compartilhados</th>
                  <th class="num">Total de aplicações</th>
                </tr>
              </thead>
              <tbody>
                ${[2, 3, 4].map(n => {
                  const ind = analise.frascos.filter(f => f.total_aplicacoes === n && !f.compartilhado).length;
                  const com = analise.frascos.filter(f => f.total_aplicacoes === n && f.compartilhado).length;
                  return `<tr>
                    <td><strong>${n} aplicações</strong></td>
                    <td class="num mono">${ind}</td>
                    <td class="num mono">${com}</td>
                    <td class="num mono">${(ind + com) * n}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>

          ${analise.totalParticulares > 0 ? `
            <div class="impfrac-secao ${sp.sem_producao > 0 ? 'impfrac-secao-anomalia' : 'impfrac-secao-ok'}">
              <h4>💰 Particulares · cruzamento com QVIS</h4>
              ${sp.encontrados > 0 ? `
                <div style="font-size: 12px; margin-bottom: 4px">
                  <strong>${sp.encontrados}</strong> aplicação${sp.encontrados !== 1 ? 'ões' : ''}
                  com produção encontrada no QVIS de ${formatarMes(analise.mes_ref)} —
                  repasse total <strong>R$ ${fmt(sp.total_repasse, 2)}</strong>
                  (${fmt(regra.pctParticular, 2)}% × valor produzido)
                </div>
              ` : ''}
              ${sp.sem_producao > 0 ? `
                <div style="font-size: 12px; color: #993556">
                  ⚠ <strong>${sp.sem_producao}</strong> aplicação${sp.sem_producao !== 1 ? 'ões' : ''}
                  sem produção correspondente no QVIS de ${formatarMes(analise.mes_ref)}.
                  Pode ser que o QVIS desse mês ainda não tenha sido importado.
                  Você pode importar o QVIS e clicar em <strong>↻ Recalcular particulares</strong>
                  na tela de Fracionamento depois.
                </div>
              ` : ''}
            </div>
          ` : ''}

          ${pendentes.length > 0 ? `
            <div class="impfrac-secao">
              <h4>👥 Médicos não vinculados (${pendentes.length}) — resolver antes de importar</h4>
              <p class="impfrac-help">
                Os nomes abaixo não foram encontrados no cadastro. Vincule a um médico existente
                <strong>ou</strong> selecione "Criar novo INTERNO" para cadastrá-lo automaticamente.
              </p>
              <table class="impfrac-tabela">
                <thead>
                  <tr>
                    <th>Nome no relatório</th>
                    <th class="num">Ocorr.</th>
                    <th>Vincular a…</th>
                  </tr>
                </thead>
                <tbody id="impfrac-pendentes-body">
                  ${pendentes.map(p => renderPendenteRow(p)).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="impfrac-secao impfrac-secao-ok">
              ✓ Todos os ${analise.mediosResolucao.resolvidos.size} médicos foram vinculados automaticamente.
            </div>
          `}

          ${analise.anomalias.length > 0 ? `
            <div class="impfrac-secao impfrac-secao-anomalia">
              <h4>⚠ Anomalias detectadas (${analise.anomalias.length})</h4>
              <ul class="impfrac-anomalia-lista">
                ${analise.anomalias.map(a => `
                  <li>
                    <strong>${escapeHTML(a.descricao)}</strong>
                    <small> — linha${a.linhas.length > 1 ? 's' : ''} ${a.linhas.join(', ')}</small>
                  </li>
                `).join('')}
              </ul>
              <p class="impfrac-help">A importação prossegue mesmo com anomalias — você pode revisar manualmente depois.</p>
            </div>
          ` : ''}
        </div>
        <div class="impfrac-modal-footer">
          <button class="btn" id="impfrac-conf-cancel-btn">Cancelar</button>
          <button class="btn btn-primary" id="impfrac-conf-ok" ${podeImportar ? '' : 'disabled'}>
            ${podeImportar ? `✓ Importar ${totalAplFrasco + analise.totalParticulares} aplicações` : `⚠ Resolva ${pendentesAbertos.length} médico(s) pendente(s)`}
          </button>
        </div>
      `;

      // Binds
      overlay.querySelector('#impfrac-conf-cancel').addEventListener('click', () => overlay.remove());
      overlay.querySelector('#impfrac-conf-cancel-btn').addEventListener('click', () => overlay.remove());

      // Bind do seletor de mês — corrige o mês detectado e recalcula particulares
      const mesInput = overlay.querySelector('#impfrac-mes-input');
      if (mesInput) mesInput.addEventListener('change', () => {
        const v = (mesInput.value || '').trim();
        if (/^\d{4}-\d{2}$/.test(v)) {
          analise.mes_ref = v;
          try {
            analise.statusParticular = cruzarParticularesComProducao(
              analise.particulares, analise.mes_ref, regra.pctParticular
            );
          } catch (e) { /* QVIS do novo mês pode não estar importado ainda */ }
          renderModal();
        }
      });

      // Binds dos selects de pendentes
      overlay.querySelectorAll('.impfrac-pendente-select').forEach(sel => {
        sel.addEventListener('change', () => {
          const raw = sel.dataset.raw;
          const valor = sel.value;
          if (valor === '') {
            resolucaoFinal.delete(raw);
          } else if (valor === '__NOVO__') {
            resolucaoFinal.set(raw, { criar_novo: true, medico_id: null, medico_oficial: capitalizar(raw) });
          } else {
            const medicos = Banco.query(`SELECT id, nome_oficial FROM medicos WHERE id = ?`, [parseInt(valor)]);
            const m = medicos[0];
            resolucaoFinal.set(raw, { criar_novo: false, medico_id: m.id, medico_oficial: m.nome_oficial });
          }
          renderModal();
        });
      });

      const btnOk = overlay.querySelector('#impfrac-conf-ok');
      if (btnOk && !btnOk.disabled) {
        btnOk.addEventListener('click', () => {
          confirmarImportacao(analise, resolucaoFinal, () => {
            overlay.remove();
            if (onImportConcluida) onImportConcluida();
          });
        });
      }
    }

    function renderPendenteRow(p) {
      const resolvido = resolucaoFinal.get(p.medico_raw);
      const valorSel = resolvido
        ? (resolvido.criar_novo ? '__NOVO__' : String(resolvido.medico_id))
        : '';
      // Carrega lista de médicos pra o select
      const medicos = Banco.query(`
        SELECT id, nome_oficial, tipo_vinculo FROM medicos WHERE ativo = 1 ORDER BY nome_oficial
      `);
      return `
        <tr>
          <td>
            <strong>${escapeHTML(p.medico_raw)}</strong>
            <small style="display: block; color: var(--ink-faint); margin-top: 2px">
              ${p.motivo === 'ambiguo'
                ? `${p.candidatos.length} candidatos no cadastro`
                : p.motivo === 'sem_tokens'
                  ? 'Nome muito curto para match automático'
                  : 'Não encontrado no cadastro'}
            </small>
          </td>
          <td class="num mono">${p.ocorrencias}</td>
          <td>
            <select class="impfrac-pendente-select" data-raw="${escapeHTML(p.medico_raw)}">
              <option value="">— Selecionar —</option>
              <option value="__NOVO__" ${valorSel === '__NOVO__' ? 'selected' : ''}>
                + Criar "${escapeHTML(capitalizar(p.medico_raw))}" como INTERNO
              </option>
              ${p.candidatos.length > 0 ? `
                <optgroup label="Sugestões">
                  ${p.candidatos.map(c => `
                    <option value="${c.id}" ${valorSel === String(c.id) ? 'selected' : ''}>
                      ${escapeHTML(c.nome_oficial)}${c.tipo_vinculo ? ` · ${c.tipo_vinculo}` : ''}
                    </option>
                  `).join('')}
                </optgroup>
              ` : ''}
              <optgroup label="Todos os médicos cadastrados">
                ${medicos.map(m => `
                  <option value="${m.id}" ${valorSel === String(m.id) ? 'selected' : ''}>
                    ${escapeHTML(m.nome_oficial)}${m.tipo_vinculo ? ` · ${m.tipo_vinculo}` : ''}
                  </option>
                `).join('')}
              </optgroup>
            </select>
          </td>
        </tr>
      `;
    }

    renderModal();
  }

  function jaImportadoEsteMes(mes_ref) {
    try {
      const r = Banco.queryUnica(`SELECT COUNT(*) AS n FROM fracionamento_aplicacoes WHERE mes_ref = ?`, [mes_ref]);
      return (r?.n || 0) > 0;
    } catch (e) { return false; }
  }

  async function confirmarImportacao(analise, resolucaoFinal, onDone) {
    Utilidades.mostrarLoading('Importando...');
    try {
      // 1. Cria médicos novos onde foi pedido
      const novos = [];
      for (const [raw, info] of resolucaoFinal) {
        if (info.criar_novo) {
          const id = criarMedicoInterno(raw);
          info.medico_id = id;
          info.criar_novo = false;
          novos.push({ raw, id });
        }
      }
      // 2. Cria sinônimos pros vinculados (pra próxima importação não pedir de novo)
      for (const [raw, info] of resolucaoFinal) {
        if (!info.medico_id) continue;
        const normRaw = normalizar(raw);
        const medicoNorm = (Banco.queryUnica(`SELECT nome_normalizado FROM medicos WHERE id = ?`, [info.medico_id]) || {}).nome_normalizado;
        if (normRaw === medicoNorm) continue;  // match já é direto
        try {
          Banco.executar('DELETE FROM sinonimos_medico WHERE grafia_normalizada = ?', [normRaw]);
          Banco.executar(
            `INSERT INTO sinonimos_medico (medico_id, grafia, grafia_normalizada, confianca, aprovado_por)
             VALUES (?, ?, ?, 1.0, 'import-fracionamento')`,
            [info.medico_id, raw, normRaw]
          );
        } catch (e) { /* silencia */ }
      }
      // 3. Salva tudo (transação)
      salvarImportacao(analise, resolucaoFinal);
      await Banco.salvar({ imediato: true });
      Utilidades.esconderLoading();
      let msg = `✓ ${analise.frascos.length} frascos / ${analise.totalLinhas} aplicações importadas`;
      if (novos.length > 0) msg += ` (${novos.length} médico(s) novo(s) criado(s))`;
      Utilidades.toast(msg, 'success', 4000);
      if (onDone) onDone();
    } catch (e) {
      Utilidades.esconderLoading();
      console.error(e);
      alert('❌ Erro ao importar:\n\n' + e.message);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // CSS (injetado uma vez)
  // ──────────────────────────────────────────────────────────────────────

  function _injetarCSS() {
    if (document.getElementById('impfrac-styles')) return;
    const style = document.createElement('style');
    style.id = 'impfrac-styles';
    style.textContent = `
      .impfrac-modal-overlay {
        position: fixed; inset: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 10000;
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
      }
      .impfrac-modal {
        background: var(--bg-elevated);
        border-radius: 10px;
        max-width: 95vw;
        max-height: 90vh;
        display: flex; flex-direction: column;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      }
      .impfrac-modal-grande { width: 860px; }
      .impfrac-modal-header {
        padding: 14px 18px;
        background: var(--primary);
        color: #f2f3f5;
        border-radius: 10px 10px 0 0;
        display: flex; justify-content: space-between; align-items: center;
        font-weight: 700;
      }
      .impfrac-modal-fechar {
        background: none; border: none; color: #f2f3f5; cursor: pointer;
        font-size: 16px; padding: 0 6px;
      }
      .impfrac-modal-body { padding: 18px; overflow-y: auto; }
      .impfrac-modal-body-scroll { max-height: 65vh; }
      .impfrac-modal-footer {
        padding: 12px 18px;
        border-top: 1px solid var(--border);
        display: flex; justify-content: flex-end; gap: 8px;
      }
      .impfrac-upload-area {
        border: 2px dashed var(--border);
        border-radius: 10px;
        padding: 30px;
        text-align: center;
      }
      .impfrac-mes-sel {
        padding: 12px 14px;
        background: var(--bg-sunken, #f2f3f5);
        border: 1px solid var(--border, #eef0f2);
        border-radius: 8px;
        margin-bottom: 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .impfrac-mes-sel label {
        font-size: 12px;
        font-weight: 700;
        color: var(--primary, #5980a6);
      }
      .impfrac-mes-sel input[type="month"] {
        align-self: flex-start;
        padding: 7px 10px;
        font-family: inherit;
        font-size: 14px;
        border: 1.5px solid var(--primary, #5980a6);
        border-radius: 8px;
        background: #fff;
        color: var(--ink, #3a5877);
        cursor: pointer;
      }
      .impfrac-mes-hint {
        font-size: 11.5px;
        color: var(--ink-soft, #555);
        line-height: 1.4;
      }
      .impfrac-warning {
        padding: 10px 14px;
        background: #FFF4E5;
        border: 1px solid #E6B97A;
        border-radius: 6px;
        color: #8A5A1F;
        font-size: 13px;
        margin-bottom: 14px;
      }
      .impfrac-summary-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
        margin-bottom: 16px;
      }
      .impfrac-stat {
        padding: 10px 12px;
        background: var(--bg-sunken);
        border-radius: 8px;
        border-left: 3px solid var(--primary);
      }
      .impfrac-stat-aviso { border-left-color: #B87A5A; }
      .impfrac-stat-destaque { border-left-color: var(--accent); background: #eef2f6; }
      .impfrac-stat-label {
        font-size: 10px;
        text-transform: uppercase;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: var(--ink-soft);
      }
      .impfrac-stat-valor {
        font-size: 18px;
        font-weight: 800;
        color: var(--ink);
        margin-top: 2px;
      }
      .impfrac-stat-destaque .impfrac-stat-valor { color: var(--accent); }
      .impfrac-secao { margin-top: 16px; }
      .impfrac-secao h4 {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--ink-soft);
        margin: 0 0 8px;
      }
      .impfrac-secao-ok {
        padding: 10px 14px;
        background: rgba(216, 234, 211, 0.4);
        border-radius: 6px;
        color: #4f8a5b;
        font-size: 13px;
      }
      .impfrac-secao-anomalia h4 { color: #993556; }
      .impfrac-anomalia-lista {
        margin: 0; padding-left: 18px;
        font-size: 12px;
        color: var(--ink-soft);
      }
      .impfrac-anomalia-lista li { margin: 4px 0; }
      .impfrac-tabela {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 6px;
        overflow: hidden;
      }
      .impfrac-tabela th {
        background: var(--bg-sunken);
        padding: 6px 10px;
        text-align: left;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        color: var(--ink-soft);
      }
      .impfrac-tabela th.num, .impfrac-tabela td.num { text-align: right; }
      .impfrac-tabela td { padding: 6px 10px; border-top: 1px solid var(--border); vertical-align: middle; }
      .impfrac-pendente-select {
        width: 100%;
        padding: 5px 8px;
        border: 1px solid var(--border);
        border-radius: 5px;
        background: var(--bg-elevated);
        font-size: 12px;
      }
      .impfrac-help {
        font-size: 11px;
        color: var(--ink-faint);
        margin: 4px 0 8px;
        font-style: italic;
      }
      [disabled].btn { opacity: 0.5; cursor: not-allowed; }
    `;
    document.head.appendChild(style);
  }

  // ──────────────────────────────────────────────────────────────────────
  // EXPORT
  // ──────────────────────────────────────────────────────────────────────

  window.ImportFracionamento = {
    abrirModal: abrirModalUpload,
    formatarMes,
    excluirMes,
    recalcularParticulares: recalcularParticularesNoBanco,
    buscarDetalhesAdmissao: buscarDetalhesAdmissaoParticular,
    // Exposto pra testes/debug:
    _internal: {
      analisarWorkbook,
      buscarMedicoInteligente,
      detectarMesAba,
      tokensRelevantes,
      chaveCorCelula,
      normalizarMedicamento,
      capitalizar,
      indexarProduzidoParticular,
      indexarQvisParticular,
      indexarProducaoParticular,
      cruzarParticularesComProducao,
    },
  };

})();
