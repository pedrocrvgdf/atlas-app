/**
 * ============================================================================
 * ATLAS — IMPORTADOR GENÉRICO DE PLANILHAS
 *
 * Cada hospital/clínica exporta relatórios num formato próprio. Este módulo
 * resolve isso em três passos:
 *
 *   1. lerPlanilha()        — .xlsx/.xls/.csv → matriz de células (1ª aba)
 *   2. detectarCabecalho()  — acha a linha de cabeçalho (relatórios costumam
 *                             ter títulos/filtros acima dela)
 *   3. sugerirMapeamento()  — casa os cabeçalhos com os CAMPOS da ATLAS por
 *                             apelidos (aliases); o usuário confere e ajusta
 *                             na tela, e o mapeamento fica salvo por
 *                             hospital × tipo (perfis_importacao) para as
 *                             próximas importações.
 *
 * aplicar()/aplicarFonte() e importarProducao()/importarProducaoFonte()
 * gravam as linhas em UMA transação, em lotes, com opção de SUBSTITUIR as
 * competências presentes no arquivo (reimportação segura, sem duplicar).
 * Arquivo pesado (.xlsx) é lido em FLUXO — ver "FONTES DE LINHAS".
 * ============================================================================
 */
(function () {
  'use strict';
  const U = () => window.Utilidades;

  // ──────────────────────────────────────────────────────────────────────
  // CAMPOS DESTINO POR TIPO DE RELATÓRIO
  // rotulo: como aparece na tela · obrig: importação exige · aliases:
  // nomes de coluna (normalizados) que sugerem o campo automaticamente.
  // ──────────────────────────────────────────────────────────────────────
  const CAMPOS = {
    PRODUCAO: [
      { campo: 'admissao',     rotulo: 'Admissão / Atendimento', obrig: true,
        aliases: ['ADMISSAO', 'COD ADMISSAO', 'CODIGO ADMISSAO', 'N ADMISSAO', 'NUM ADMISSAO', 'NUMERO ADMISSAO', 'ATENDIMENTO', 'NUM ATENDIMENTO', 'NUMERO ATENDIMENTO', 'CONTA', 'GUIA', 'AIH'] },
      { campo: 'data',         rotulo: 'Data', obrig: false,
        aliases: ['DATA ADMISSAO', 'DT ADMISSAO', 'DATA ATENDIMENTO', 'DATA', 'DT', 'DATA REALIZACAO', 'DATA EXECUCAO', 'COMPETENCIA'] },
      { campo: 'paciente',     rotulo: 'Paciente', obrig: false,
        aliases: ['PACIENTE', 'NOME PACIENTE', 'NOME DO PACIENTE'] },
      { campo: 'procedimento', rotulo: 'Procedimento / Produto', obrig: true,
        aliases: ['PROCEDIMENTO', 'PRODUTO', 'PROCEDIMENTO PRINCIPAL', 'DESCRICAO', 'DESCRICAO PROCEDIMENTO', 'ITEM', 'SERVICO', 'EXAME'] },
      { campo: 'convenio',     rotulo: 'Convênio / Plano', obrig: false,
        aliases: ['CONVENIO', 'PLANO', 'OPERADORA', 'FONTE PAGADORA'] },
      { campo: 'fonte',        rotulo: 'Fonte (Convênio/Particular/SUS)', obrig: false,
        aliases: ['TIPO RECEBIMENTO', 'ORIGEM', 'FONTE', 'TIPO ATENDIMENTO', 'NATUREZA'] },
      { campo: 'classificacao', rotulo: 'Classificação do produto', obrig: false,
        aliases: ['CLASSIFICACAO PRODUTO', 'CLASSIFICACAO', 'CLASSIFICACAO DO PRODUTO', 'TIPO PRODUTO', 'GRUPO', 'CATEGORIA'] },
      { campo: 'quantidade',   rotulo: 'Quantidade', obrig: false,
        aliases: ['QUANTIDADE', 'QTD', 'QTDE', 'QTE'] },
      { campo: 'valor',        rotulo: 'Valor produzido (R$)', obrig: true,
        aliases: ['VALOR', 'VALOR R', 'VALOR TOTAL', 'VALOR PRODUZIDO', 'VALOR PRODUCAO', 'VALOR FATURADO', 'FATURADO', 'VLR', 'VLR TOTAL', 'PRODUZIDO', 'VALOR BRUTO'] },
      { campo: 'executante',   rotulo: 'Executante / Cirurgião', obrig: false,
        aliases: ['CIRURGIAO', 'EXECUTANTE', 'MEDICO EXECUTANTE', 'PROFISSIONAL EXECUTANTE'] },
      { campo: 'executante_alt', rotulo: 'Executante — 2ª opção (usada se a 1ª vier vazia)', obrig: false,
        aliases: ['MEDICO', 'PROFISSIONAL', 'NOME PROFISSIONAL', 'MEDICO RESPONSAVEL'] },
      { campo: 'auxiliar',     rotulo: 'Auxiliar', obrig: false,
        aliases: ['AUXILIAR', 'AUXILIAR 1', '1 AUXILIAR', 'PRIMEIRO AUXILIAR'] },
      { campo: 'indicante',    rotulo: 'Indicante', obrig: false,
        aliases: ['INDICANTE', 'MEDICO INDICANTE', 'INDICADOR'] },
      { campo: 'solicitante',  rotulo: 'Solicitante', obrig: false,
        aliases: ['SOLICITANTE', 'MEDICO SOLICITANTE'] },
      { campo: 'laudo',        rotulo: 'Médico do laudo', obrig: false,
        aliases: ['MEDICO LAUDO', 'MEDICO DE LAUDO', 'LAUDO', 'LAUDANTE'] },
    ],

    REPASSE: [
      { campo: 'admissao',     rotulo: 'Admissão / Atendimento', obrig: true,
        aliases: ['ADMISSAO', 'COD ADMISSAO', 'CODIGO ADMISSAO', 'N ADMISSAO', 'NUM ADMISSAO', 'NUMERO ADMISSAO', 'ATENDIMENTO', 'NUM ATENDIMENTO', 'CONTA', 'GUIA', 'AIH'] },
      { campo: 'data',         rotulo: 'Data da admissão', obrig: false,
        aliases: ['DATA ADMISSAO', 'DT ADMISSAO', 'DATA', 'DATA ATENDIMENTO'] },
      { campo: 'paciente',     rotulo: 'Paciente', obrig: false,
        aliases: ['PACIENTE', 'NOME PACIENTE'] },
      { campo: 'procedimento', rotulo: 'Procedimento', obrig: true,
        aliases: ['PROCEDIMENTO', 'PRODUTO', 'DESCRICAO', 'DESCRICAO PROCEDIMENTO', 'ITEM', 'SERVICO'] },
      { campo: 'convenio',     rotulo: 'Convênio / Plano', obrig: false,
        aliases: ['CONVENIO', 'PLANO', 'OPERADORA'] },
      { campo: 'fonte',        rotulo: 'Fonte (Convênio/Particular/SUS)', obrig: false,
        aliases: ['TIPO RECEBIMENTO', 'TIPO DE RECEBIMENTO', 'FONTE PAGADORA', 'ORIGEM', 'FONTE', 'NATUREZA', 'TIPO PAGAMENTO'] },
      { campo: 'papel',        rotulo: 'Papel (Cirurgião/Auxiliar/…)', obrig: false,
        aliases: ['PAPEL', 'FUNCAO', 'TIPO PROFISSIONAL', 'CATEGORIA PROFISSIONAL', 'VINCULO'] },
      { campo: 'medico',       rotulo: 'Médico / Profissional', obrig: false,
        aliases: ['NOME PROFISSIONAL', 'NOME DO PROFISSIONAL', 'PROFISSIONAL', 'MEDICO', 'NOME MEDICO', 'PRESTADOR'] },
      { campo: 'quantidade',   rotulo: 'Quantidade', obrig: false,
        aliases: ['QUANTIDADE', 'QTD', 'QTDE'] },
      { campo: 'produzido',    rotulo: 'Valor produzido (R$)', obrig: false,
        aliases: ['PRODUZIDO', 'VALOR PRODUZIDO', 'PRODUCAO', 'VALOR PRODUCAO', 'FATURADO', 'VALOR FATURADO', 'VALOR BRUTO'] },
      { campo: 'recebido',     rotulo: 'Valor RECEBIDO do pagador (R$) — 0 = glosa', obrig: false,
        aliases: ['RECEBIDO', 'VALOR RECEBIDO', 'RECEBIDO CONVENIO', 'VALOR RECEBIDO CONVENIO'] },
      { campo: 'honorario',    rotulo: 'Honorário (R$)', obrig: false,
        aliases: ['HONORARIO', 'VALOR HONORARIO', 'HONORARIOS'] },
      { campo: 'repassado',    rotulo: 'Valor repassado pelo sistema (R$)', obrig: true,
        aliases: ['REPASSADO', 'REPASSE', 'VALOR REPASSADO', 'VALOR REPASSE', 'VALOR PAGO', 'PAGO', 'VALOR MEDICO', 'HONORARIO PAGO', 'VALOR LIQUIDO'] },
      { campo: 'status',       rotulo: 'Status / ocorrência (detecta GLOSA)', obrig: false,
        aliases: ['STATUS', 'ESTADO', 'SITUACAO', 'GLOSA', 'STATUS PAGAMENTO', 'SITUACAO PAGAMENTO', 'OCORRENCIA', 'MOTIVO'] },
    ],

    // Relatório do MÉDICO — o que ele de fato recebeu. Três gerações de layout:
    //   gen 1: Sistema | Médico | CONVENIO | PAPEL | PROCEDIMENTO | DATA | PACIENTE | REPASSADO  (sem admissão)
    //   gen 2: Sistema | Médico | Recebimento | Admissão/ CPS | Papel | Procedimento | Data | Paciente | Repassado
    //   gen 3: STATUS | MÓDULO | ADMISSÃO | DATA | PAPEL | PROFISSIONAL | ORIGEM | CONVÊNIO | PACIENTE | DESCRIÇÃO | REPASSE
    MEDICO: [
      { campo: 'procedimento', rotulo: 'Procedimento / Descrição', obrig: true,
        aliases: ['PROCEDIMENTO', 'DESCRICAO', 'DESCRICAO PROCEDIMENTO', 'PRODUTO', 'ITEM', 'SERVICO'] },
      { campo: 'papel',        rotulo: 'Papel', obrig: true,
        aliases: ['PAPEL', 'FUNCAO', 'TIPO PROFISSIONAL'] },
      { campo: 'valor',        rotulo: 'Valor recebido (R$)', obrig: true,
        aliases: ['REPASSADO', 'REPASSE', 'VALOR REPASSADO', 'VALOR REPASSE', 'VALOR RECEBIDO', 'RECEBIDO', 'VALOR PAGO', 'VALOR', 'VALOR LIQUIDO'] },
      { campo: 'admissao',     rotulo: 'Admissão (opcional — gen 1 não tem)', obrig: false,
        aliases: ['ADMISSAO', 'ADMISSAO CPS', 'COD ADMISSAO', 'CODIGO ADMISSAO', 'N ADMISSAO', 'NUM ADMISSAO', 'ATENDIMENTO', 'CPS'] },
      { campo: 'data',         rotulo: 'Data', obrig: false,
        aliases: ['DATA', 'DATA ADMISSAO', 'DT ADMISSAO', 'DATA ATENDIMENTO'] },
      { campo: 'paciente',     rotulo: 'Paciente', obrig: false,
        aliases: ['PACIENTE', 'NOME PACIENTE', 'NOME DO PACIENTE'] },
      { campo: 'medico',       rotulo: 'Médico / Profissional', obrig: false,
        aliases: ['MEDICO', 'PROFISSIONAL', 'NOME PROFISSIONAL', 'NOME DO PROFISSIONAL'] },
      { campo: 'sistema',      rotulo: 'Sistema / Status (QVIS, Medical, Ajustes, GLOSA…)', obrig: false,
        aliases: ['SISTEMA', 'STATUS', 'ESTADO', 'SITUACAO'] },
      { campo: 'modulo',       rotulo: 'Módulo (Repasse, LIO, OPME…)', obrig: false,
        aliases: ['MODULO', 'FICHARIO', 'ORIGEM DO REPASSE'] },
      { campo: 'fonte',        rotulo: 'Fonte / Origem (Convênio/Particular)', obrig: false,
        aliases: ['ORIGEM', 'RECEBIMENTO', 'TIPO RECEBIMENTO', 'TIPO DE RECEBIMENTO', 'FONTE', 'FONTE PAGADORA', 'CONVENIO'] },
      { campo: 'convenio',     rotulo: 'Convênio (nome do pagador)', obrig: false,
        aliases: ['CONVENIO', 'PLANO', 'OPERADORA', 'RECEBIMENTO'] },
    ],

    BASE_TABELA: [
      { campo: 'procedimento', rotulo: 'Procedimento', obrig: true,
        aliases: ['PROCEDIMENTO', 'PRODUTO', 'DESCRICAO', 'ITEM', 'SERVICO'] },
      { campo: 'papel',        rotulo: 'Papel', obrig: false,
        aliases: ['PAPEL', 'FUNCAO', 'CIRURGIAO', 'TIPO PROFISSIONAL'] },
      { campo: 'fonte',        rotulo: 'Fonte (Convênio/Particular/SUS)', obrig: false,
        aliases: ['FONTE', 'TIPO', 'ORIGEM', 'TIPO RECEBIMENTO'] },
      { campo: 'valor',        rotulo: 'Valor fixo (R$)', obrig: false,
        aliases: ['VALOR', 'VALOR REPASSE', 'VALOR FIXO', 'VLR', 'REPASSE'] },
      { campo: 'percentual',   rotulo: 'Percentual (%)', obrig: false,
        aliases: ['PERCENTUAL', 'PCT', 'PORCENTAGEM', '%', 'PERC'] },
    ],
  };

  // ──────────────────────────────────────────────────────────────────────
  // LEITURA
  // ──────────────────────────────────────────────────────────────────────

  /** ArrayBuffer (.xlsx/.xls/.csv) → { matriz, nomeAba, abas } (1ª aba com dados). */
  /**
   * Relatórios exportados de sistemas hospitalares costumam declarar um
   * intervalo de 1 milhão de linhas com ~800 preenchidas; converter o
   * intervalo inteiro custa ~10 s. Encolhe o "!ref" para o maior endereço
   * que de fato existe na aba (custa milissegundos).
   */
  function podarIntervalo(ws) {
    if (!ws || !ws['!ref']) return;
    let maxR = -1, maxC = -1;
    for (const k of Object.keys(ws)) {
      if (k[0] === '!') continue;
      const c = XLSX.utils.decode_cell(k);
      if (c.r > maxR) maxR = c.r;
      if (c.c > maxC) maxC = c.c;
    }
    if (maxR < 0) return;
    const atual = XLSX.utils.decode_range(ws['!ref']);
    if (maxR < atual.e.r || maxC < atual.e.c) {
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 },
        e: { r: Math.min(maxR, atual.e.r), c: Math.min(maxC, atual.e.c) } });
    }
  }

  function lerPlanilha(arrayBuffer) {
    if (typeof XLSX === 'undefined') {
      throw new Error('Biblioteca de planilha ainda carregando — tente novamente em instantes.');
    }
    const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
    let melhor = null;
    for (const nome of wb.SheetNames) {
      const ws = wb.Sheets[nome];
      podarIntervalo(ws);
      const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
      if (!melhor || matriz.length > melhor.matriz.length) melhor = { matriz, nomeAba: nome };
      if (matriz.length >= 2) { melhor = { matriz, nomeAba: nome }; break; }
    }
    if (!melhor || !melhor.matriz.length) throw new Error('A planilha está vazia.');
    melhor.abas = wb.SheetNames;
    return melhor;
  }

  // ──────────────────────────────────────────────────────────────────────
  // FONTES DE LINHAS — matriz em memória OU arquivo lido em fluxo
  //
  // Quem importa não recebe mais a planilha inteira: recebe uma FONTE, com
  // a `cabeca` (primeiras linhas — para achar o cabeçalho e mapear colunas)
  // e um `percorrer(aoLote)` que entrega as linhas em lotes. Com .xlsx e
  // navegador moderno o arquivo é descompactado e varrido em fluxo
  // (LeitorXlsx): 150 mil linhas em segundos, sem estourar a memória e sem
  // travar a tela; nos demais formatos (.xls, .csv) a planilha é lida
  // inteira pelo SheetJS, como antes. `matriz()` materializa tudo para quem
  // precisa (relatório do médico, base tabela — pequenos).
  // ──────────────────────────────────────────────────────────────────────
  const CABECA_N = 80;    // linhas da cabeça (o cabeçalho fica nas 30 primeiras)
  const LOTE_N = 4000;    // linhas por lote (gravação + respiro da tela)
  const respirar = () => new Promise(r => setTimeout(r, 0));

  function fonteDeMatriz(matriz, extra) {
    matriz = matriz || [];
    return Object.assign({
      origem: 'matriz', nomeAba: '', abas: [], total: matriz.length,
      cabeca: matriz.slice(0, CABECA_N),
      async percorrer(aoLote, porLote) {
        const n = porLote || LOTE_N;
        for (let i = 0; i < matriz.length; i += n) {
          const fim = Math.min(i + n, matriz.length);
          await aoLote(matriz.slice(i, fim), { lidas: fim, total: matriz.length, pct: Math.min(0.99, fim / matriz.length) });
        }
        return { lidas: matriz.length, total: matriz.length };
      },
      async matriz() { return matriz; },
    }, extra || {});
  }

  async function fonteDeXlsx(file) {
    const leitor = await window.LeitorXlsx.abrir(file);
    // a aba: a primeira com 2+ linhas (senão a que mais tem) — como lerPlanilha
    let aba = null, cab = null;
    for (const a of leitor.abas) {
      const c = await leitor.cabeca(a.caminho, CABECA_N);
      if (!aba || c.linhas.length > cab.linhas.length) { aba = a; cab = c; }
      if (c.linhas.length >= 2) break;
    }
    if (!cab || !cab.linhas.length) throw new Error('A planilha está vazia.');
    const fonte = {
      origem: 'xlsx', nomeAba: aba.nome, abas: leitor.abas.map(a => a.nome), total: cab.total, cabeca: cab.linhas,
      async percorrer(aoLote, porLote) {
        const r = await leitor.lerAba(aba.caminho, { aoLote, porLote: porLote || LOTE_N });
        fonte.total = r.lidas;
        return r;
      },
      async matriz() { const m = []; await fonte.percorrer((l) => { for (const x of l) m.push(x); }); return m; },
    };
    return fonte;
  }

  /** File → fonte de linhas (fluxo para .xlsx quando o navegador suporta; SheetJS nos demais). */
  async function abrirFonte(file) {
    const L = window.LeitorXlsx;
    if (L && L.suportado() && await L.ehXlsx(file)) {
      try { return await fonteDeXlsx(file); }
      catch (e) { console.warn('[importador] leitura em fluxo falhou — lendo pelo SheetJS:', e); }
    }
    const lido = lerPlanilha(await file.arrayBuffer());
    return fonteDeMatriz(lido.matriz, { nomeAba: lido.nomeAba, abas: lido.abas });
  }

  /**
   * Acha a linha de cabeçalho: pontua as 30 primeiras linhas por células de
   * texto + casamentos com aliases conhecidos do tipo. Sem casamento decente,
   * assume a linha 0.
   */
  function detectarCabecalho(matriz, tipo) {
    const aliasSet = new Set();
    for (const c of (CAMPOS[tipo] || [])) for (const a of c.aliases) aliasSet.add(a);
    let melhorIdx = 0, melhorPts = -1;
    const ate = Math.min(matriz.length, 30);
    for (let i = 0; i < ate; i++) {
      const linha = matriz[i] || [];
      let strs = 0, hits = 0;
      const vistos = new Set();
      for (const cel of linha) {
        const n = U().normalizar(cel);
        if (!n || vistos.has(n)) continue;
        vistos.add(n);
        if (isNaN(Number(String(cel).replace(',', '.')))) strs++;
        if (aliasSet.has(n)) hits++;
      }
      const pts = hits * 5 + strs;
      if (hits >= 2 && pts > melhorPts) { melhorPts = pts; melhorIdx = i; }
    }
    return melhorPts >= 0 && melhorPts > 0 ? melhorIdx : 0;
  }

  /**
   * Sugere { campo → índice de coluna } casando cabeçalhos com aliases
   * (match exato primeiro, depois "contém"). Uma coluna não é usada 2x.
   */
  function sugerirMapeamento(cabecalhos, tipo) {
    const norm = cabecalhos.map(c => U().normalizar(c));
    const usadas = new Set();
    const map = {};
    // 1ª passada: match exato
    for (const c of (CAMPOS[tipo] || [])) {
      for (const alias of c.aliases) {
        const idx = norm.findIndex((n, i) => n === alias && !usadas.has(i));
        if (idx >= 0) { map[c.campo] = idx; usadas.add(idx); break; }
      }
    }
    // 2ª passada: "contém" (só para campos ainda sem coluna)
    for (const c of (CAMPOS[tipo] || [])) {
      if (map[c.campo] != null) continue;
      for (const alias of c.aliases) {
        const idx = norm.findIndex((n, i) => n && !usadas.has(i) &&
          (n.includes(alias) || alias.includes(n)) && n.length >= 3);
        if (idx >= 0) { map[c.campo] = idx; usadas.add(idx); break; }
      }
    }
    return map;
  }

  // ──────────────────────────────────────────────────────────────────────
  // PERFIS SALVOS (mapeamento por hospital × tipo)
  // ──────────────────────────────────────────────────────────────────────

  function perfilLer(hospitalId, tipo) {
    const r = Banco.query(
      'SELECT mapeamento, linha_cabecalho FROM perfis_importacao WHERE hospital_id=? AND tipo=?',
      [hospitalId, tipo]);
    if (!r.length) return null;
    try { return { mapeamento: JSON.parse(r[0].mapeamento), linhaCab: r[0].linha_cabecalho }; }
    catch (_) { return null; }
  }

  function perfilGravar(hospitalId, tipo, mapeamentoPorNome, linhaCab) {
    Banco.executar(
      `INSERT INTO perfis_importacao (hospital_id, tipo, mapeamento, linha_cabecalho, atualizado_em)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(hospital_id, tipo) DO UPDATE SET
         mapeamento = excluded.mapeamento,
         linha_cabecalho = excluded.linha_cabecalho,
         atualizado_em = CURRENT_TIMESTAMP`,
      [hospitalId, tipo, JSON.stringify(mapeamentoPorNome), linhaCab || 0]);
  }

  /**
   * Perfil guarda NOME de coluna (não índice) — sobrevive a colunas
   * reordenadas. Esta função re-resolve nomes → índices no arquivo atual.
   */
  function aplicarPerfil(perfil, cabecalhos) {
    const norm = cabecalhos.map(c => U().normalizar(c));
    const map = {};
    for (const [campo, nomeCol] of Object.entries(perfil.mapeamento || {})) {
      const idx = norm.indexOf(U().normalizar(nomeCol));
      if (idx >= 0) map[campo] = idx;
    }
    return map;
  }

  // ──────────────────────────────────────────────────────────────────────
  // GRAVAÇÃO
  // ──────────────────────────────────────────────────────────────────────

  function celula(linha, map, campo) {
    const idx = map[campo];
    if (idx == null || idx < 0) return '';
    const v = linha[idx];
    return v == null ? '' : v;
  }

  /**
   * Importação genérica — SISTEMA, MÉDICO, BASE TABELA e a produção mapeada
   * à mão. prepararAplicar() monta o conversor linha crua → registro e os
   * acumuladores do resumo; a gravação corre em UMA transação, em lotes com
   * statement preparado, de duas formas:
   *   aplicar(p)                — síncrona, sobre p.matriz (tudo em memória)
   *   aplicarFonte(p, fonte, …) — assíncrona, em lotes da FONTE (arquivo em
   *                               fluxo), cedendo a tela entre os lotes
   * @param {object} p  { tipo, linhaCab, map (campo→índice), clienteId,
   *                      hospitalId, arquivo, competencia (sistema/médico:
   *                      mês de pagamento 'YYYY-MM'), origem (sistema),
   *                      substituir (bool: apaga o que já existia para as
   *                      competências presentes — e a origem, no sistema) }
   * @returns { inseridas, competencias, avisos, importacaoId, linhasLidas,
   *            origem, divergentes, admissoes, produzido, repassado }
   */
  const SQL_APLICAR = {
    BASE_TABELA: `INSERT INTO base_tabela (hospital_id, procedimento, procedimento_norm, papel, fonte, valor, percentual, origem)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 'IMPORTADA')`,
    MEDICO: `INSERT INTO linhas_medico
               (cliente_id, hospital_id, importacao_id, competencia, sistema, modulo, admissao, admissao_norm,
                admissao_origem, data, paciente, paciente_norm, medico, medico_norm, papel,
                papel_canon, fonte, convenio, procedimento, procedimento_norm, valor, linha_origem)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    PRODUCAO: `INSERT INTO linhas_producao
               (cliente_id, hospital_id, importacao_id, competencia, admissao, admissao_norm, data, paciente, paciente_norm,
                convenio, fonte, classificacao, procedimento, procedimento_norm, quantidade, valor,
                executante, executante_norm, auxiliar, auxiliar_norm, indicante, indicante_norm,
                solicitante, solicitante_norm, laudo, laudo_norm, linha_origem)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    REPASSE: `INSERT INTO linhas_repasse
               (cliente_id, hospital_id, importacao_id, competencia, admissao, admissao_norm, data, paciente,
                convenio, fonte, procedimento, procedimento_norm, papel, papel_canon,
                medico, medico_norm, quantidade, produzido, honorario, recebido, repassado, status, linha_origem)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  };

  function paramsAplicar(tipo, p, impId, l) {
    const U_ = U();
    if (tipo === 'BASE_TABELA') {
      return [p.hospitalId, l.procedimento, l.procedimento_norm, l.papel, l.fonte, l.valor, l.percentual];
    }
    if (tipo === 'MEDICO') {
      return [p.clienteId, p.hospitalId, impId, l.competencia, l.sistema, l.modulo, l.admissao, U_.normAdm(l.admissao),
        l.admissao_origem, l.data, l.paciente, l.paciente_norm, l.medico, U_.normalizar(l.medico),
        l.papel, l.papel_canon, l.fonte, l.convenio, l.procedimento, l.procedimento_norm, l.valor, l.linha_origem];
    }
    if (tipo === 'PRODUCAO') {
      return [p.clienteId, p.hospitalId, impId, l.competencia, l.admissao, U_.normAdm(l.admissao), l.data, l.paciente, U_.normalizar(l.paciente),
        l.convenio, l.fonte, l.classificacao, l.procedimento, l.procedimento_norm, l.quantidade, l.valor,
        l.executante, U_.normalizar(l.executante), l.auxiliar, U_.normalizar(l.auxiliar),
        l.indicante, U_.normalizar(l.indicante), l.solicitante, U_.normalizar(l.solicitante),
        l.laudo, U_.normalizar(l.laudo), l.linha_origem];
    }
    return [p.clienteId, p.hospitalId, impId, l.competencia, l.admissao, U_.normAdm(l.admissao), l.data, l.paciente,
      l.convenio, l.fonte, l.procedimento, l.procedimento_norm, l.papel, l.papel_canon,
      l.medico, U_.normalizar(l.medico), l.quantidade, l.produzido, l.honorario, l.recebido, l.repassado,
      l.status, l.linha_origem];
  }

  function prepararAplicar(p) {
    const U_ = U();
    const tipo = p.tipo;
    // SISTEMA: o relatório pode ser SÓ de Convênio, SÓ de Particular ou dos
    // dois juntos. Nos dois primeiros a fonte de toda linha é a declarada
    // (a coluna do arquivo, se disser outra coisa, vira aviso); no "juntos"
    // a fonte sai da coluna. A substituição respeita a origem: reimportar o
    // Particular de um mês não apaga o Convênio do mesmo mês.
    const origem = tipo === 'REPASSE' && (p.origem === 'CONVENIO' || p.origem === 'PARTICULAR') ? p.origem : null;
    const ctx = { tipo, origem, avisos: [], comps: new Set(), admissoes: new Set(), admGlosa: new Set(),
      divergentes: 0, produzido: 0, recebido: 0, repassado: 0, temRecebido: false, glosadas: 0,
      lidas: 0, inseridas: 0, impId: null };
    const avisos = ctx.avisos;

    /** Linha crua (índice i na planilha) → registro, ou null quando não entra. */
    ctx.converter = (raw, i) => {
      if (!raw.some(c => c != null && String(c).trim() !== '')) return null;   // linha em branco

      if (tipo === 'BASE_TABELA') {
        const proc = String(celula(raw, p.map, 'procedimento')).trim();
        if (!proc) return null;
        const valor = U_.paraNumero(celula(raw, p.map, 'valor'));
        const pct = U_.paraNumero(celula(raw, p.map, 'percentual'));
        return {
          procedimento: proc,
          procedimento_norm: U_.normalizar(proc),
          papel: U_.papelCanonico(celula(raw, p.map, 'papel')) || 'EXECUTANTE',
          fonte: celula(raw, p.map, 'fonte') !== '' ? U_.classificarFonte(celula(raw, p.map, 'fonte')) : 'TODAS',
          valor: valor || null,
          percentual: pct || null,
        };
      }

      if (tipo === 'MEDICO') {
        const proc = String(celula(raw, p.map, 'procedimento')).trim();
        const papel = String(celula(raw, p.map, 'papel')).trim();
        const valorCel = celula(raw, p.map, 'valor');
        if (!proc && !papel && valorCel === '') return null;
        if (!papel && !proc) { avisos.push(`Linha ${i + 1}: sem papel/procedimento — ignorada.`); return null; }
        const fonteTxt = String(celula(raw, p.map, 'fonte')).trim();
        const fonte = fonteTxt ? U_.classificarFonte(fonteTxt) : 'CONVENIO';
        // gen 2 traz o NOME do convênio na mesma coluna de "recebimento":
        // quando o texto não é só Convênio/Particular, ele é o pagador
        let convenio = String(celula(raw, p.map, 'convenio')).trim();
        const fonteN = U_.normalizar(fonteTxt);
        if (!convenio && fonteTxt && !['CONVENIO', 'PARTICULAR', 'SUS'].includes(fonteN)) convenio = fonteTxt;
        const adm = String(celula(raw, p.map, 'admissao')).trim().replace(/\.0+$/, '');
        const dataISO = U_.paraDataISO(celula(raw, p.map, 'data'));
        const paciente = String(celula(raw, p.map, 'paciente')).trim();
        const l = {
          competencia: p.competencia || '',
          sistema: String(celula(raw, p.map, 'sistema')).trim(),
          modulo: String(celula(raw, p.map, 'modulo')).trim(),
          admissao: adm, admissao_origem: adm ? 'RELATORIO' : '',
          data: dataISO, paciente, paciente_norm: U_.normalizar(paciente),
          medico: String(celula(raw, p.map, 'medico')).trim(),
          papel, papel_canon: U_.papelCanonico(papel),
          fonte, convenio,
          procedimento: proc, procedimento_norm: U_.normalizar(proc),
          valor: U_.paraNumero(valorCel),
          linha_origem: i + 1,
        };
        if (l.competencia) ctx.comps.add(l.competencia);
        return l;
      }

      const adm = String(celula(raw, p.map, 'admissao')).trim();
      const proc = String(celula(raw, p.map, 'procedimento')).trim();
      if (!adm && !proc) return null;
      if (!adm) { avisos.push(`Linha ${i + 1}: sem admissão — ignorada.`); return null; }
      if (!proc) { avisos.push(`Linha ${i + 1}: sem procedimento — ignorada.`); return null; }

      const dataISO = U_.paraDataISO(celula(raw, p.map, 'data'));
      const fonteTxt = celula(raw, p.map, 'fonte');
      const convenio = String(celula(raw, p.map, 'convenio')).trim();
      const fonte = fonteTxt !== '' ? U_.classificarFonte(fonteTxt)
        : (convenio ? U_.classificarFonte(convenio) : 'CONVENIO');
      const qtd = U_.paraNumero(celula(raw, p.map, 'quantidade')) || 1;

      if (tipo === 'PRODUCAO') {
        const exec = String(celula(raw, p.map, 'executante')).trim() ||
          String(celula(raw, p.map, 'executante_alt')).trim();
        const l = {
          admissao: adm, data: dataISO,
          competencia: U_.competenciaDe(dataISO) || (p.competencia || ''),
          paciente: String(celula(raw, p.map, 'paciente')).trim(),
          convenio, fonte,
          classificacao: U_.normalizar(celula(raw, p.map, 'classificacao')),
          procedimento: proc, procedimento_norm: U_.normalizar(proc),
          quantidade: qtd,
          valor: U_.paraNumero(celula(raw, p.map, 'valor')),
          executante: exec,
          auxiliar: String(celula(raw, p.map, 'auxiliar')).trim(),
          indicante: String(celula(raw, p.map, 'indicante')).trim(),
          solicitante: String(celula(raw, p.map, 'solicitante')).trim(),
          laudo: String(celula(raw, p.map, 'laudo')).trim(),
          linha_origem: i + 1,
        };
        if (l.competencia) ctx.comps.add(l.competencia);
        return l;
      }

      // REPASSE (Sistema)
      const papel = String(celula(raw, p.map, 'papel')).trim();
      if (origem && fonteTxt !== '' && U_.classificarFonte(fonteTxt) !== origem) ctx.divergentes++;
      // RECEBIDO e HONORÁRIO: null quando o relatório NÃO trouxe a coluna — a
      // diferença importa, porque "recebido = 0" é glosa e "sem coluna" não é.
      const temCol = (campo) => p.map[campo] != null && p.map[campo] >= 0;
      const fonteLinha = origem || fonte;
      const l = {
        admissao: adm, data: dataISO,
        competencia: p.competencia || U_.competenciaDe(dataISO) || '',
        paciente: String(celula(raw, p.map, 'paciente')).trim(),
        convenio, fonte: fonteLinha,
        procedimento: proc, procedimento_norm: U_.normalizar(proc),
        papel, papel_canon: U_.papelCanonico(papel),
        medico: String(celula(raw, p.map, 'medico')).trim(),
        quantidade: qtd,
        produzido: U_.paraNumero(celula(raw, p.map, 'produzido')),
        honorario: temCol('honorario') ? U_.paraNumero(celula(raw, p.map, 'honorario')) : null,
        recebido: temCol('recebido') ? U_.paraNumero(celula(raw, p.map, 'recebido')) : null,
        repassado: U_.paraNumero(celula(raw, p.map, 'repassado')),
        status: String(celula(raw, p.map, 'status')).trim(),
        linha_origem: i + 1,
      };
      if (l.competencia) ctx.comps.add(l.competencia);
      ctx.produzido += l.produzido; ctx.repassado += l.repassado; ctx.admissoes.add(U_.normAdm(adm));
      if (l.recebido != null) {
        ctx.temRecebido = true;
        ctx.recebido += l.recebido;
        // glosa: o pagador não pagou. No PARTICULAR o paciente paga direto —
        // a coluna não se aplica e zero ali não é glosa.
        if (l.recebido <= 0 && U_.classificarFonte(fonteLinha) !== 'PARTICULAR') {
          ctx.glosadas++;
          ctx.admGlosa.add(U_.normAdm(adm));
        }
      }
      return l;
    };
    return ctx;
  }

  /** Abre a importação (dentro da transação): registro em importacoes + base tabela anterior fora. */
  function gravarInicioAplicar(ctx, p) {
    // BASE TABELA não tem importacao_id nas linhas: a base anterior do hospital sai ANTES
    if (p.substituir && ctx.tipo === 'BASE_TABELA') Banco.executar('DELETE FROM base_tabela WHERE hospital_id = ?', [p.hospitalId]);
    Banco.executar(
      `INSERT INTO importacoes (cliente_id, hospital_id, tipo, arquivo, competencia, n_linhas, origem)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [p.clienteId, p.hospitalId, ctx.tipo, p.arquivo || '', p.competencia || '',
        ctx.tipo === 'REPASSE' ? (ctx.origem || 'TODAS') : null]);
    ctx.impId = Banco.ultimoId();
  }

  function gravarLoteAplicar(ctx, p, linhas) {
    ctx.inseridas += Banco.executarLote(SQL_APLICAR[ctx.tipo], linhas.map(l => paramsAplicar(ctx.tipo, p, ctx.impId, l)));
  }

  /** Fecha a importação (dentro da transação): substituição, contagem e histórico. */
  function finalizarAplicar(ctx, p) {
    if (!ctx.inseridas) throw new Error('Nenhuma linha válida encontrada abaixo do cabeçalho.');
    const tipo = ctx.tipo;
    Banco.executar('UPDATE importacoes SET n_linhas = ? WHERE id = ?', [ctx.inseridas, ctx.impId]);
    if (tipo !== 'BASE_TABELA') {
      const tabela = tipo === 'PRODUCAO' ? 'linhas_producao' : (tipo === 'MEDICO' ? 'linhas_medico' : 'linhas_repasse');
      // substituir: o que já existia para as mesmas competências (e origem) sai — as linhas desta importação ficam
      const comps = [...ctx.comps];
      if (p.substituir && comps.length) {
        Banco.executar(
          `DELETE FROM ${tabela} WHERE hospital_id = ? AND competencia IN (${comps.map(() => '?').join(',')})` +
          (ctx.origem ? ' AND fonte = ?' : '') + ' AND COALESCE(importacao_id, 0) <> ?',
          ctx.origem ? [p.hospitalId, ...comps, ctx.origem, ctx.impId] : [p.hospitalId, ...comps, ctx.impId]);
      }
      // importações deste tipo/hospital que ficaram sem nenhuma linha
      // (sobrescritas) saem do histórico — ele mostra o que está na base
      Banco.executar(
        `DELETE FROM importacoes WHERE tipo = ? AND hospital_id = ? AND id <> ?
           AND NOT EXISTS (SELECT 1 FROM ${tabela} t WHERE t.importacao_id = importacoes.id)`,
        [tipo, p.hospitalId, ctx.impId]);
    }

    /**
     * PAGAMENTO REPETIDO ENTRE MESES. Cada relatório do sistema é o que será
     * pago NAQUELE mês: um mês não sobrepõe o outro, porque a admissão que a
     * conciliação ainda não quitou simplesmente não está no arquivo. Então
     * uma linha igual (mesma admissão × procedimento × papel × origem) em
     * DOIS meses do mesmo hospital é sinal de arquivo repetido ou exportado
     * com o filtro errado — e o mesmo pagamento contado duas vezes infla o
     * "pago" e esconde dívida. A ATLAS não apaga nada: avisa.
     */
    if (tipo === 'REPASSE') {
      const d = Banco.query(
        `SELECT COUNT(*) AS n, COUNT(DISTINCT a.admissao_norm) AS adms,
                (SELECT GROUP_CONCAT(x, ', ') FROM (
                   SELECT DISTINCT b2.competencia AS x FROM linhas_repasse b2
                    WHERE b2.hospital_id = ? AND b2.importacao_id <> ? AND b2.competencia <> ?
                    ORDER BY b2.competencia LIMIT 12)) AS meses
           FROM linhas_repasse a
          WHERE a.importacao_id = ?
            AND EXISTS (SELECT 1 FROM linhas_repasse b
                         WHERE b.hospital_id = a.hospital_id
                           AND b.importacao_id <> a.importacao_id
                           AND b.competencia <> a.competencia
                           AND b.admissao_norm = a.admissao_norm
                           AND b.procedimento_norm = a.procedimento_norm
                           AND COALESCE(b.papel_canon, '') = COALESCE(a.papel_canon, '')
                           AND COALESCE(b.fonte, '') = COALESCE(a.fonte, ''))`,
        [p.hospitalId, ctx.impId, p.competencia || '', ctx.impId])[0] || {};
      ctx.repetidas = Number(d.n) || 0;
      ctx.admissoesRepetidas = Number(d.adms) || 0;
      ctx.mesesRepetidos = ctx.repetidas ? String(d.meses || '') : '';
    }
    return { inseridas: ctx.inseridas, competencias: [...ctx.comps].sort(), avisos: ctx.avisos, importacaoId: ctx.impId,
      linhasLidas: ctx.lidas,
      origem: tipo === 'REPASSE' ? (ctx.origem || 'TODAS') : null, divergentes: ctx.divergentes,
      admissoes: ctx.admissoes.size, produzido: Math.round(ctx.produzido * 100) / 100,
      repassado: Math.round(ctx.repassado * 100) / 100,
      temRecebido: ctx.temRecebido, recebido: Math.round(ctx.recebido * 100) / 100,
      glosadas: ctx.glosadas, admissoesGlosadas: ctx.admGlosa.size,
      repetidas: ctx.repetidas || 0, admissoesRepetidas: ctx.admissoesRepetidas || 0,
      mesesRepetidos: ctx.mesesRepetidos || '' };
  }

  /** Síncrona: p.matriz inteira em memória (testes, relatório do médico, base tabela). */
  function aplicar(p) {
    const ctx = prepararAplicar(p);
    const matriz = p.matriz || [];
    let r;
    Banco.transacao(() => {
      gravarInicioAplicar(ctx, p);
      let lote = [];
      for (let i = p.linhaCab + 1; i < matriz.length; i++) {
        ctx.lidas++;
        const l = ctx.converter(matriz[i] || [], i);
        if (!l) continue;
        lote.push(l);
        if (lote.length >= LOTE_N) { gravarLoteAplicar(ctx, p, lote); lote = []; }
      }
      if (lote.length) gravarLoteAplicar(ctx, p, lote);
      r = finalizarAplicar(ctx, p);
    });
    return r;
  }

  /** Assíncrona, em lotes da fonte: a tela respira e a barra de progresso anda. */
  async function aplicarFonte(p, fonte, progresso) {
    const ctx = prepararAplicar(p);
    return Banco.transacaoAsync(async () => {
      gravarInicioAplicar(ctx, p);
      let i = 0;
      await fonte.percorrer(async (linhas, info) => {
        const lote = [];
        for (const raw of linhas) {
          const idx = i++;
          if (idx <= p.linhaCab) continue;
          ctx.lidas++;
          const l = ctx.converter(raw || [], idx);
          if (l) lote.push(l);
        }
        if (lote.length) gravarLoteAplicar(ctx, p, lote);
        if (progresso) progresso(info, ctx);
        await respirar();
      });
      return finalizarAplicar(ctx, p);
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // PRODUÇÃO — importação AUTOMÁTICA (a forma da ferramenta de origem)
  //
  // Escolheu o arquivo, importou: a ATLAS acha o cabeçalho (a linha com
  // "Cód. Admissão"), reconhece as colunas pelo layout do relatório
  // analítico + aliases, exige só ADMISSÃO e DATA, deriva a competência de
  // CADA linha pela data (um arquivo pode trazer mais de um mês), apaga as
  // competências presentes (do hospital) e grava tudo numa transação com
  // statement preparado. O relatório entra NA ÍNTEGRA: o que não vira
  // campo-núcleo da auditoria fica guardado nas colunas de mesmo nome.
  // ──────────────────────────────────────────────────────────────────────

  /** Layout do relatório analítico: cabeçalho da planilha → coluna do banco. */
  const LAYOUT_PRODUCAO = [
    ['Cód. Admissão', 'admissao'],            ['Data Admissão', 'data'],
    ['Hora Admissão', 'hora_admissao'],       ['Status Admissão', 'status_admissao'],
    ['Unid. Atendimento', 'unidade'],         ['Especialidade', 'especialidade'],
    ['Tipo Recebimento', 'fonte'],            ['Destino', 'destino'],
    ['Classificação Produto', 'classificacao'], ['Tipo Produto', 'tipo_produto'],
    ['Categoria', 'categoria'],               ['Subcategoria', 'subcategoria'],
    ['Subespecialidade', 'subespecialidade'], ['Médico Externo', 'medico_externo'],
    ['Cód. Apresentação', 'cod_apresentacao'], ['Procedimento Principal', 'procedimento_principal'],
    ['Produto', 'procedimento'],              ['Pacote', 'pacote'],
    ['Convênio', 'convenio'],                 ['Plano', 'plano'],
    ['Perfil Particular', 'perfil_particular'], ['Perfil Admissão', 'perfil_admissao'],
    ['Caráter Admissão', 'carater_admissao'], ['Observação Admissão', 'observacao_admissao'],
    ['Sala', 'sala'],                         ['Profissional Admissão', 'profissional_admissao'],
    ['Tipo Paciente', 'tipo_paciente'],       ['Cód. Paciente', 'cod_paciente'],
    ['Paciente', 'paciente'],                 ['Data Nascimento', 'data_nascimento'],
    ['Idade no Atendimento', 'idade_atendimento'], ['Faixa Etária', 'faixa_etaria'],
    ['CID Alta', 'cid_alta'],                 ['Descrição CID', 'descricao_cid'],
    ['Qtd.', 'quantidade'],                   ['Valor R$', 'valor'],
    ['Indicante', 'indicante'],               ['Solicitante', 'solicitante'],
    ['Consultor', 'consultor'],               ['Médico', 'medico'],
    ['Cirurgião', 'cirurgiao'],               ['Instrumentador', 'instrumentador'],
    ['Contatologa', 'contatologa'],           ['Ortoptista', 'ortoptista'],
    ['Auxiliar SADT', 'auxiliar_sadt'],       ['Auxiliar 1', 'auxiliar'],
    ['Auxiliar 2', 'auxiliar2'],
  ];

  // campo do mapeamento manual (CAMPOS.PRODUCAO) ↔ coluna do banco
  const NUCLEO_PARA_COLUNA = { executante: 'cirurgiao', executante_alt: 'medico' };
  const COLUNA_PARA_NUCLEO = { cirurgiao: 'executante', medico: 'executante_alt' };

  /** Linha do cabeçalho da produção: a que tem "Cód. Admissão"; senão, a melhor por aliases. */
  function detectarCabecalhoProducao(matriz) {
    const ate = Math.min(matriz.length, 30);
    for (let i = 0; i < ate; i++) {
      if ((matriz[i] || []).some(c => U().normalizar(c) === 'COD ADMISSAO')) return i;
    }
    return detectarCabecalho(matriz, 'PRODUCAO');
  }

  /**
   * Mapeia o cabeçalho da produção → { coluna_do_banco: índice }.
   *   1º o layout conhecido (nome exato, indiferente a acento/caixa);
   *   2º os aliases genéricos, só para o núcleo que ainda faltar;
   *   3º o perfil salvo do hospital (se houver) tem a última palavra;
   *   4º `nucleo` (o que o usuário apontou no mapeamento manual) manda em tudo.
   */
  function mapearProducao(cab, perfil, nucleo) {
    const norm = cab.map(c => U().normalizar(c));
    const map = {};
    const usadas = new Set();
    for (const [rotulo, col] of LAYOUT_PRODUCAO) {
      const alvo = U().normalizar(rotulo);
      const idx = norm.findIndex((n, i) => n === alvo && !usadas.has(i));
      if (idx >= 0) { map[col] = idx; usadas.add(idx); }
    }
    const traduz = (campo) => NUCLEO_PARA_COLUNA[campo] || campo;
    const sug = sugerirMapeamento(cab, 'PRODUCAO');
    for (const [campo, idx] of Object.entries(sug)) {
      const col = traduz(campo);
      if (idx == null || map[col] != null || usadas.has(idx)) continue;
      map[col] = idx; usadas.add(idx);
    }
    if (perfil) {
      for (const [campo, idx] of Object.entries(aplicarPerfil(perfil, cab))) {
        if (idx != null) map[traduz(campo)] = idx;
      }
    }
    if (nucleo) {
      for (const [campo, idx] of Object.entries(nucleo)) {
        const col = traduz(campo);
        if (idx == null || idx < 0) delete map[col]; else map[col] = idx;
      }
    }
    return map;
  }

  /** O mapa por coluna do banco → mapa do mapeamento manual (CAMPOS.PRODUCAO). */
  function nucleoDoMapa(map) {
    const out = {};
    for (const c of CAMPOS.PRODUCAO) {
      const col = NUCLEO_PARA_COLUNA[c.campo] || c.campo;
      if (map[col] != null) out[c.campo] = map[col];
    }
    return out;
  }

  // colunas gravadas na íntegra (além do núcleo da auditoria)
  const COLUNAS_INTEGRA = ['hora_admissao', 'status_admissao', 'unidade', 'especialidade', 'destino',
    'tipo_produto', 'categoria', 'subcategoria', 'subespecialidade', 'medico_externo', 'cod_apresentacao',
    'procedimento_principal', 'pacote', 'plano', 'perfil_particular', 'perfil_admissao', 'carater_admissao',
    'observacao_admissao', 'sala', 'profissional_admissao', 'tipo_paciente', 'cod_paciente',
    'data_nascimento', 'idade_atendimento', 'faixa_etaria', 'cid_alta', 'descricao_cid', 'consultor',
    'medico', 'cirurgiao', 'instrumentador', 'contatologa', 'ortoptista', 'auxiliar_sadt', 'auxiliar2'];
  const COLUNAS_NUCLEO = ['competencia', 'admissao', 'admissao_norm', 'data', 'paciente', 'paciente_norm', 'convenio', 'fonte', 'classificacao',
    'procedimento', 'procedimento_norm', 'quantidade', 'valor', 'executante', 'executante_norm',
    'auxiliar', 'auxiliar_norm', 'indicante', 'indicante_norm', 'solicitante', 'solicitante_norm',
    'laudo', 'laudo_norm', 'linha_origem'];

  /**
   * Importa a PRODUÇÃO automaticamente — em lotes.
   * prepararProducao() acha o cabeçalho na CABEÇA da fonte (a linha com
   * "Cód. Admissão"), mapeia as colunas e devolve o contexto (conversor de
   * linha + acumuladores do resumo); a gravação corre numa transação com
   * statement preparado, em lotes:
   *   importarProducao(p)                — síncrona, sobre p.matriz
   *   importarProducaoFonte(p, fonte, …) — assíncrona, em lotes da FONTE
   *                                        (arquivo em fluxo), cedendo a tela
   * p: { clienteId, hospitalId, arquivo, substituir (padrão true),
   *      perfil (perfilLer), linhaCab e nucleo (só quando vem do mapeamento manual),
   *      escopo: { tipo: 'ANO'|'MES', ano: '2026', mes: '03' } — o período que
   *      o arquivo cobre, declarado pelo usuário: só as linhas desse período
   *      entram (as de fora são contadas em foraDoEscopo) e só os meses que
   *      vierem nele são sobrescritos. Sem escopo, aceita todas as datas. }
   * Lança erro com .precisaMapear = true (e .linhaCab/.map) quando não
   * reconhece ADMISSÃO ou DATA — a tela cai no mapeamento manual.
   * Devolve o resumo: { linhaCab, cab, map, linhasLidas, inseridas, vazias,
   *   semData, semAdmissao, foraDoEscopo, escopo, mantidas[], truncado
   *   ({motivo:'nota'|'contagem', limite} quando o arquivo parece cortado no
   *   limite de exportação do Power BI), competencias[], admissoes, totalValor,
   *   totalQuantidade, porCompetencia[{competencia, linhas, valor, quantidade}],
   *   reconhecidas, naoReconhecidas[] }.
   */
  function prepararProducao(p, cabeca) {
    const U_ = U();
    cabeca = cabeca || [];
    const linhaCab = p.linhaCab != null ? p.linhaCab : detectarCabecalhoProducao(cabeca);
    const cab = (cabeca[linhaCab] || []).map(c => String(c == null ? '' : c).trim());
    const map = mapearProducao(cab, p.perfil || null, p.nucleo || null);
    const faltam = ['admissao', 'data'].filter(c => map[c] == null);
    if (faltam.length) {
      const e = new Error('Não reconheci a coluna de ' +
        faltam.map(c => c === 'admissao' ? 'ADMISSÃO' : 'DATA DA ADMISSÃO').join(' nem a de ') +
        ' — aponte no mapeamento.');
      e.precisaMapear = true; e.linhaCab = linhaCab; e.map = map;
      throw e;
    }

    const cel = (raw, col) => { const i = map[col]; if (i == null) return ''; const v = raw[i]; return v == null ? '' : v; };
    const txt = (raw, col) => String(cel(raw, col)).trim();
    const hora = (v) => v instanceof Date ? v.toTimeString().slice(0, 8) : String(v == null ? '' : v).trim();

    // período declarado pelo usuário (pop-up ano/mês)
    const escopo = p.escopo && p.escopo.tipo && p.escopo.ano ? {
      tipo: p.escopo.tipo === 'MES' ? 'MES' : 'ANO', ano: String(p.escopo.ano),
      mes: p.escopo.tipo === 'MES' ? String(p.escopo.mes || '').padStart(2, '0') : '' } : null;
    const compEscopo = escopo && escopo.tipo === 'MES' ? escopo.ano + '-' + escopo.mes : '';
    const dentro = (comp) => !escopo || (escopo.tipo === 'ANO' ? comp.slice(0, 4) === escopo.ano : comp === compEscopo);
    const rotuloEscopo = !escopo ? '' : (escopo.tipo === 'ANO' ? 'o ano de ' + escopo.ano : U_.compExibir(compEscopo));

    // Exportação cortada: o Power BI para em 150.000 linhas e escreve a nota
    // "Exported data limited to 150000 rows" acima do cabeçalho — quando o
    // relatório tem mais linhas que isso, o arquivo vem incompleto e o total
    // do período NÃO fecha. Detecta pela nota (aqui) ou pela contagem exata
    // (no fim, quando se sabe quantas linhas o arquivo tinha).
    let truncado = null;
    for (let i = 0; i < linhaCab; i++) {
      for (const c of (cabeca[i] || [])) {
        const m = String(c == null ? '' : c).match(/limited to\s+([\d.,]+)\s+rows|limitad[oa]s?\s+a\s+([\d.,]+)\s+linhas/i);
        if (m) { truncado = { motivo: 'nota', limite: Number(String(m[1] || m[2]).replace(/\D/g, '')) || 150000, nota: String(c).trim() }; }
      }
    }

    const colunas = COLUNAS_NUCLEO.concat(COLUNAS_INTEGRA);
    const ctx = {
      linhaCab, cab, map, escopo, rotuloEscopo, truncado, colunas,
      sql: `INSERT INTO linhas_producao (cliente_id, hospital_id, importacao_id, ${colunas.join(', ')})
            VALUES (?, ?, ?, ${colunas.map(() => '?').join(', ')})`,
      comps: new Set(), adms: new Set(), porComp: new Map(),
      vazias: 0, semData: 0, semAdmissao: 0, foraDoEscopo: 0, totalValor: 0, totalQuantidade: 0,
      lidas: 0, inseridas: 0, impId: null,
    };

    /** Linha crua (índice i na planilha) → registro completo, ou null quando não entra. */
    ctx.converter = (raw, i) => {
      if (!raw.some(c => c != null && String(c).trim() !== '')) { ctx.vazias++; return null; }
      const dataISO = U_.paraDataISO(cel(raw, 'data'));
      if (!dataISO) { ctx.semData++; return null; }              // sem data não há competência
      if (!dentro(U_.competenciaDe(dataISO))) { ctx.foraDoEscopo++; return null; }   // fora do período declarado
      const adm = txt(raw, 'admissao').replace(/\.0+$/, '');
      if (!adm) { ctx.semAdmissao++; return null; }               // a auditoria é por admissão
      const proc = txt(raw, 'procedimento');
      const fonteTxt = txt(raw, 'fonte'), convenio = txt(raw, 'convenio');
      const cirurgiao = txt(raw, 'cirurgiao'), medico = txt(raw, 'medico');
      const executante = cirurgiao || medico;               // cirurgião; senão, o médico
      const auxiliar = txt(raw, 'auxiliar'), indicante = txt(raw, 'indicante');
      const solicitante = txt(raw, 'solicitante'), laudo = txt(raw, 'laudo');
      const valor = U_.paraNumero(cel(raw, 'valor'));
      const paciente = txt(raw, 'paciente');
      const l = {
        competencia: U_.competenciaDe(dataISO), admissao: adm, admissao_norm: U_.normAdm(adm), data: dataISO,
        paciente, paciente_norm: U_.normalizar(paciente), convenio,
        fonte: fonteTxt ? U_.classificarFonte(fonteTxt) : (convenio ? U_.classificarFonte(convenio) : 'CONVENIO'),
        classificacao: U_.normalizar(cel(raw, 'classificacao')),
        procedimento: proc, procedimento_norm: U_.normalizar(proc),
        quantidade: U_.paraNumero(cel(raw, 'quantidade')) || 1,
        valor,
        executante, executante_norm: U_.normalizar(executante),
        auxiliar, auxiliar_norm: U_.normalizar(auxiliar),
        indicante, indicante_norm: U_.normalizar(indicante),
        solicitante, solicitante_norm: U_.normalizar(solicitante),
        laudo, laudo_norm: U_.normalizar(laudo),
        linha_origem: i + 1,
      };
      for (const col of COLUNAS_INTEGRA) {
        if (map[col] == null) { l[col] = null; continue; }
        const v = cel(raw, col);
        if (col === 'hora_admissao') l[col] = hora(v);
        else if (col === 'data_nascimento') l[col] = U_.paraDataISO(v) || String(v).trim();
        else if (col === 'idade_atendimento') l[col] = v === '' ? null : U_.paraNumero(v);
        else l[col] = String(v).trim();
      }
      ctx.comps.add(l.competencia); ctx.adms.add(U_.normAdm(adm)); ctx.totalValor += valor; ctx.totalQuantidade += l.quantidade;
      const pc = ctx.porComp.get(l.competencia) || { competencia: l.competencia, linhas: 0, valor: 0, quantidade: 0 };
      pc.linhas++; pc.valor += valor; pc.quantidade += l.quantidade; ctx.porComp.set(l.competencia, pc);
      return l;
    };
    return ctx;
  }

  function gravarInicioProducao(ctx, p) {
    Banco.executar(
      `INSERT INTO importacoes (cliente_id, hospital_id, tipo, arquivo, competencia, n_linhas)
       VALUES (?, ?, 'PRODUCAO', ?, '', 0)`,
      [p.clienteId, p.hospitalId, p.arquivo || '']);
    ctx.impId = Banco.ultimoId();
  }

  function gravarLoteProducao(ctx, p, linhas) {
    ctx.inseridas += Banco.executarLote(ctx.sql,
      linhas.map(l => [p.clienteId, p.hospitalId, ctx.impId, ...ctx.colunas.map(c => l[c])]));
  }

  /** Fecha a importação (dentro da transação): substituição por competência, histórico e resumo. */
  function finalizarProducao(ctx, p) {
    if (!ctx.inseridas) {
      if (ctx.escopo && ctx.foraDoEscopo) {
        throw new Error(`O arquivo não tem nenhuma linha de ${ctx.rotuloEscopo} — as ${ctx.foraDoEscopo.toLocaleString('pt-BR')} linhas com data são de outro período. É o arquivo certo?`);
      }
      throw new Error('Nenhuma linha com admissão e data abaixo do cabeçalho — é o relatório de produção certo?');
    }
    let truncado = ctx.truncado;
    if (!truncado && ctx.lidas >= 150000 && ctx.lidas <= 150003) truncado = { motivo: 'contagem', limite: 150000, nota: '' };
    const lista = [...ctx.comps].sort();

    // ano inteiro: meses do ano que já estão na base e NÃO vieram no arquivo
    // são mantidos (a ATLAS não apaga o que o arquivo não cobre) — o resumo avisa
    let mantidas = [];
    if (ctx.escopo && ctx.escopo.tipo === 'ANO') {
      mantidas = Banco.query(
        `SELECT DISTINCT competencia FROM linhas_producao
          WHERE hospital_id = ? AND competencia LIKE ? AND COALESCE(importacao_id, 0) <> ? ORDER BY competencia`,
        [p.hospitalId, ctx.escopo.ano + '-%', ctx.impId]).map(r => r.competencia).filter(c => !ctx.comps.has(c));
    }
    // substituir: o que já existia do hospital para os meses do arquivo sai — as linhas desta importação ficam
    if (p.substituir !== false) {
      Banco.executar(
        `DELETE FROM linhas_producao WHERE hospital_id = ? AND competencia IN (${lista.map(() => '?').join(',')})
           AND COALESCE(importacao_id, 0) <> ?`,
        [p.hospitalId, ...lista, ctx.impId]);
    }
    Banco.executar('UPDATE importacoes SET competencia = ?, n_linhas = ? WHERE id = ?', [lista.join(', '), ctx.inseridas, ctx.impId]);
    // importações de produção deste hospital que ficaram sem nenhuma linha
    // (sobrescritas) saem do histórico — ele mostra o que está na base
    Banco.executar(
      `DELETE FROM importacoes WHERE tipo = 'PRODUCAO' AND hospital_id = ? AND id <> ?
         AND NOT EXISTS (SELECT 1 FROM linhas_producao lp WHERE lp.importacao_id = importacoes.id)`,
      [p.hospitalId, ctx.impId]);

    const usados = new Set(Object.values(ctx.map));
    return {
      importacaoId: ctx.impId,
      linhaCab: ctx.linhaCab, cab: ctx.cab, map: ctx.map, linhasLidas: ctx.lidas,
      inseridas: ctx.inseridas, vazias: ctx.vazias, semData: ctx.semData, semAdmissao: ctx.semAdmissao,
      foraDoEscopo: ctx.foraDoEscopo, escopo: ctx.escopo, rotuloEscopo: ctx.rotuloEscopo, mantidas, truncado,
      competencias: lista, admissoes: ctx.adms.size,
      totalValor: Math.round(ctx.totalValor * 100) / 100,
      totalQuantidade: Math.round(ctx.totalQuantidade * 100) / 100,
      porCompetencia: lista.map(c => { const pc = ctx.porComp.get(c); return { competencia: c, linhas: pc.linhas,
        valor: Math.round(pc.valor * 100) / 100, quantidade: Math.round(pc.quantidade * 100) / 100 }; }),
      reconhecidas: Object.keys(ctx.map).length,
      naoReconhecidas: ctx.cab.filter((c, i) => c && !usados.has(i)),
    };
  }

  /** Síncrona: p.matriz inteira em memória (testes e mapeamento com matriz). */
  function importarProducao(p) {
    const matriz = p.matriz || [];
    const ctx = prepararProducao(p, matriz.slice(0, CABECA_N));
    let r;
    Banco.transacao(() => {
      gravarInicioProducao(ctx, p);
      let lote = [];
      for (let i = ctx.linhaCab + 1; i < matriz.length; i++) {
        ctx.lidas++;
        const l = ctx.converter(matriz[i] || [], i);
        if (!l) continue;
        lote.push(l);
        if (lote.length >= LOTE_N) { gravarLoteProducao(ctx, p, lote); lote = []; }
      }
      if (lote.length) gravarLoteProducao(ctx, p, lote);
      r = finalizarProducao(ctx, p);
    });
    return r;
  }

  /** Assíncrona, em lotes da fonte (arquivo em fluxo): a tela respira e a barra anda. */
  async function importarProducaoFonte(p, fonte, progresso) {
    const ctx = prepararProducao(p, fonte.cabeca);
    return Banco.transacaoAsync(async () => {
      gravarInicioProducao(ctx, p);
      let i = 0;
      await fonte.percorrer(async (linhas, info) => {
        const lote = [];
        for (const raw of linhas) {
          const idx = i++;
          if (idx <= ctx.linhaCab) continue;
          ctx.lidas++;
          const l = ctx.converter(raw || [], idx);
          if (l) lote.push(l);
        }
        if (lote.length) gravarLoteProducao(ctx, p, lote);
        if (progresso) progresso(info, ctx);
        await respirar();
      });
      return finalizarProducao(ctx, p);
    });
  }

  const MESES = { JANEIRO: '01', FEVEREIRO: '02', MARCO: '03', ABRIL: '04', MAIO: '05', JUNHO: '06',
    JULHO: '07', AGOSTO: '08', SETEMBRO: '09', OUTUBRO: '10', NOVEMBRO: '11', DEZEMBRO: '12' };

  /**
   * Competência (YYYY-MM) escrita no cabeçalho informativo do relatório do
   * médico: "Pagamentos liberados entre dd/mm/aaaa e dd/mm/aaaa" (gens 1-2 →
   * mês da data final) ou "Competência: ABRIL / 2026" (gen 3). '' se não achar.
   */
  function detectarCompetenciaRelatorio(matriz) {
    const ate = Math.min(matriz.length, 12);
    for (let i = 0; i < ate; i++) {
      for (const cel of (matriz[i] || [])) {
        const txt = String(cel == null ? '' : cel);
        let m = txt.match(/liberados\s+entre\s+(\d{2})\/(\d{2})\/(\d{4})\s+e\s+(\d{2})\/(\d{2})\/(\d{4})/i);
        if (m) return m[6] + '-' + m[5];
        m = U().normalizar(txt).match(/COMPETENCIA\s+([A-Z]+)\s*(\d{4})/);
        if (m && MESES[m[1]]) return m[2] + '-' + MESES[m[1]];
        m = txt.match(/compet[êe]ncia:?\s*(\d{2})\/(\d{4})/i);
        if (m) return m[2] + '-' + m[1];
      }
    }
    return '';
  }

  /** É um relatório do médico? (tem papel + valor + procedimento no cabeçalho) */
  function pareceRelatorioMedico(matriz) {
    const linhaCab = detectarCabecalho(matriz, 'MEDICO');
    const cab = (matriz[linhaCab] || []).map(String);
    const map = sugerirMapeamento(cab, 'MEDICO');
    const ok = map.papel != null && map.valor != null && map.procedimento != null;
    return { ok, linhaCab, map, cab };
  }

  window.Importador = {
    CAMPOS, lerPlanilha, detectarCabecalho, sugerirMapeamento,
    perfilLer, perfilGravar, aplicarPerfil, aplicar, aplicarFonte,
    detectarCompetenciaRelatorio, pareceRelatorioMedico,
    LAYOUT_PRODUCAO, detectarCabecalhoProducao, mapearProducao, nucleoDoMapa, importarProducao, importarProducaoFonte,
    fonteDeMatriz, abrirFonte, CABECA_N, LOTE_N,
  };
})();
