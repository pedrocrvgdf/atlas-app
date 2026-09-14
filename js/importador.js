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
 * aplicar() grava as linhas em transação, com opção de SUBSTITUIR as
 * competências presentes no arquivo (reimportação segura, sem duplicar).
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
      { campo: 'repassado',    rotulo: 'Valor repassado / pago (R$)', obrig: true,
        aliases: ['REPASSADO', 'REPASSE', 'VALOR REPASSADO', 'VALOR REPASSE', 'VALOR PAGO', 'PAGO', 'VALOR MEDICO', 'HONORARIO', 'HONORARIO PAGO', 'VALOR LIQUIDO', 'RECEBIDO'] },
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
   * Grava as linhas no banco.
   * @param {object} p  { tipo, matriz, linhaCab, map (campo→índice),
   *                      clienteId, hospitalId, arquivo,
   *                      competencia (repasse: mês de pagamento 'YYYY-MM'),
   *                      substituir (bool: apaga competências presentes) }
   * @returns { inseridas, ignoradas, competencias, avisos[] }
   */
  function aplicar(p) {
    const U_ = U();
    const tipo = p.tipo;
    const avisos = [];
    const linhas = [];
    const compsNoArquivo = new Set();

    for (let i = p.linhaCab + 1; i < p.matriz.length; i++) {
      const raw = p.matriz[i] || [];
      if (!raw.some(c => String(c).trim() !== '')) continue;   // linha em branco

      if (tipo === 'BASE_TABELA') {
        const proc = String(celula(raw, p.map, 'procedimento')).trim();
        if (!proc) continue;
        const valor = U_.paraNumero(celula(raw, p.map, 'valor'));
        const pct = U_.paraNumero(celula(raw, p.map, 'percentual'));
        linhas.push({
          procedimento: proc,
          procedimento_norm: U_.normalizar(proc),
          papel: U_.papelCanonico(celula(raw, p.map, 'papel')) || 'EXECUTANTE',
          fonte: celula(raw, p.map, 'fonte') !== '' ? U_.classificarFonte(celula(raw, p.map, 'fonte')) : 'TODAS',
          valor: valor || null,
          percentual: pct || null,
        });
        continue;
      }

      if (tipo === 'MEDICO') {
        const proc = String(celula(raw, p.map, 'procedimento')).trim();
        const papel = String(celula(raw, p.map, 'papel')).trim();
        const valorCel = celula(raw, p.map, 'valor');
        if (!proc && !papel && valorCel === '') continue;
        if (!papel && !proc) { avisos.push(`Linha ${i + 1}: sem papel/procedimento — ignorada.`); continue; }
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
        if (l.competencia) compsNoArquivo.add(l.competencia);
        linhas.push(l);
        continue;
      }

      const adm = String(celula(raw, p.map, 'admissao')).trim();
      const proc = String(celula(raw, p.map, 'procedimento')).trim();
      if (!adm && !proc) continue;
      if (!adm) { avisos.push(`Linha ${i + 1}: sem admissão — ignorada.`); continue; }
      if (!proc) { avisos.push(`Linha ${i + 1}: sem procedimento — ignorada.`); continue; }

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
        if (l.competencia) compsNoArquivo.add(l.competencia);
        linhas.push(l);
      } else {  // REPASSE
        const papel = String(celula(raw, p.map, 'papel')).trim();
        const l = {
          admissao: adm, data: dataISO,
          competencia: p.competencia || U_.competenciaDe(dataISO) || '',
          paciente: String(celula(raw, p.map, 'paciente')).trim(),
          convenio, fonte,
          procedimento: proc, procedimento_norm: U_.normalizar(proc),
          papel, papel_canon: U_.papelCanonico(papel),
          medico: String(celula(raw, p.map, 'medico')).trim(),
          quantidade: qtd,
          produzido: U_.paraNumero(celula(raw, p.map, 'produzido')),
          repassado: U_.paraNumero(celula(raw, p.map, 'repassado')),
          status: String(celula(raw, p.map, 'status')).trim(),
          linha_origem: i + 1,
        };
        if (l.competencia) compsNoArquivo.add(l.competencia);
        linhas.push(l);
      }
    }

    if (!linhas.length) throw new Error('Nenhuma linha válida encontrada abaixo do cabeçalho.');

    let inseridas = 0;
    Banco.transacao(() => {
      // substituir: apaga o que já existia para as mesmas competências
      if (p.substituir) {
        if (tipo === 'BASE_TABELA') {
          Banco.executar('DELETE FROM base_tabela WHERE hospital_id = ?', [p.hospitalId]);
        } else {
          const tabela = tipo === 'PRODUCAO' ? 'linhas_producao'
            : (tipo === 'MEDICO' ? 'linhas_medico' : 'linhas_repasse');
          const comps = [...compsNoArquivo];
          if (comps.length) {
            const marcas = comps.map(() => '?').join(',');
            Banco.executar(
              `DELETE FROM ${tabela} WHERE hospital_id = ? AND competencia IN (${marcas})`,
              [p.hospitalId, ...comps]);
          }
        }
      }

      Banco.executar(
        `INSERT INTO importacoes (cliente_id, hospital_id, tipo, arquivo, competencia, n_linhas)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [p.clienteId, p.hospitalId, tipo, p.arquivo || '', p.competencia || '', linhas.length]);
      const impId = Banco.ultimoId();

      for (const l of linhas) {
        if (tipo === 'BASE_TABELA') {
          Banco.executar(
            `INSERT INTO base_tabela (hospital_id, procedimento, procedimento_norm, papel, fonte, valor, percentual, origem)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'IMPORTADA')`,
            [p.hospitalId, l.procedimento, l.procedimento_norm, l.papel, l.fonte, l.valor, l.percentual]);
        } else if (tipo === 'MEDICO') {
          Banco.executar(
            `INSERT INTO linhas_medico
               (cliente_id, hospital_id, importacao_id, competencia, sistema, modulo, admissao,
                admissao_origem, data, paciente, paciente_norm, medico, medico_norm, papel,
                papel_canon, fonte, convenio, procedimento, procedimento_norm, valor, linha_origem)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [p.clienteId, p.hospitalId, impId, l.competencia, l.sistema, l.modulo, l.admissao,
              l.admissao_origem, l.data, l.paciente, l.paciente_norm, l.medico, U_.normalizar(l.medico),
              l.papel, l.papel_canon, l.fonte, l.convenio, l.procedimento, l.procedimento_norm,
              l.valor, l.linha_origem]);
        } else if (tipo === 'PRODUCAO') {
          Banco.executar(
            `INSERT INTO linhas_producao
               (cliente_id, hospital_id, importacao_id, competencia, admissao, data, paciente,
                convenio, fonte, classificacao, procedimento, procedimento_norm, quantidade, valor,
                executante, executante_norm, auxiliar, auxiliar_norm, indicante, indicante_norm,
                solicitante, solicitante_norm, laudo, laudo_norm, linha_origem)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [p.clienteId, p.hospitalId, impId, l.competencia, l.admissao, l.data, l.paciente,
              l.convenio, l.fonte, l.classificacao, l.procedimento, l.procedimento_norm, l.quantidade, l.valor,
              l.executante, U_.normalizar(l.executante), l.auxiliar, U_.normalizar(l.auxiliar),
              l.indicante, U_.normalizar(l.indicante), l.solicitante, U_.normalizar(l.solicitante),
              l.laudo, U_.normalizar(l.laudo), l.linha_origem]);
        } else {
          Banco.executar(
            `INSERT INTO linhas_repasse
               (cliente_id, hospital_id, importacao_id, competencia, admissao, data, paciente,
                convenio, fonte, procedimento, procedimento_norm, papel, papel_canon,
                medico, medico_norm, quantidade, produzido, repassado, status, linha_origem)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [p.clienteId, p.hospitalId, impId, l.competencia, l.admissao, l.data, l.paciente,
              l.convenio, l.fonte, l.procedimento, l.procedimento_norm, l.papel, l.papel_canon,
              l.medico, U_.normalizar(l.medico), l.quantidade, l.produzido, l.repassado,
              l.status, l.linha_origem]);
        }
        inseridas++;
      }
    });

    return { inseridas, competencias: [...compsNoArquivo].sort(), avisos };
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
    perfilLer, perfilGravar, aplicarPerfil, aplicar,
    detectarCompetenciaRelatorio, pareceRelatorioMedico,
  };
})();
