/**
 * ============================================================================
 * IMPORTADOR DA BASE TABELA — Excel → Banco SQLite
 * ============================================================================
 * Mesma lógica do importador Python original:
 *   1. Lê Excel via SheetJS (XLSX)
 *   2. Normaliza nomes (resolve duplicatas de grafia)
 *   3. Cria procedimentos únicos
 *   4. Cadastra todas as grafias como sinônimos
 *   5. Cria valores de repasse por procedimento+papel+fonte
 *
 * Regras aplicadas:
 *   - INDICANTE e SOLICITANTE pagam mesmo valor (cadastrados separadamente)
 *   - Coluna vazia ou zero = "não paga aquele papel"
 *   - Mesma normalização = mesmo procedimento (1ª grafia vira "oficial")
 */

const ImportadorBaseTabela = {

  /** Mapeamento: nome da coluna no Excel → nome do papel canônico (legado) */
  COLUNAS_PAPEIS: {
    'CIRURGIAO':     'Executante',
    'INDICANTE':     'Indicante',
    'SOLICITANTE':   'Solicitante',
    'MEDICO LAUDO':  'Médico Laudo',
    'AUXILIAR':      'Auxiliar',
  },

  /** Papéis e os apelidos de coluna aceitos (normalizados: sem acento, maiúsculas).
   *  Torna o importador tolerante a variações: acento, espaços, "EXECUTANTE", etc. */
  PAPEIS_COLS: [
    { papel: 'Executante',   aliases: ['CIRURGIAO', 'CIRURGIÃO', 'EXECUTANTE', 'MEDICO EXECUTANTE', 'MÉDICO EXECUTANTE', 'CIRURGIAO/EXECUTANTE'] },
    { papel: 'Indicante',    aliases: ['INDICANTE', 'MEDICO INDICANTE'] },
    { papel: 'Solicitante',  aliases: ['SOLICITANTE', 'MEDICO SOLICITANTE'] },
    { papel: 'Médico Laudo', aliases: ['MEDICO LAUDO', 'MÉDICO LAUDO', 'MED LAUDO', 'MED. LAUDO', 'MEDICO DO LAUDO', 'LAUDO', 'MEDICO LAUDISTA'] },
    { papel: 'Auxiliar',     aliases: ['AUXILIAR', 'AUX', 'AUXILIO', '1 AUXILIAR', 'PRIMEIRO AUXILIAR'] },
  ],
  PROCEDIMENTO_ALIASES: ['PROCEDIMENTO', 'PROCEDIMENTOS', 'PROC', 'DESCRICAO', 'DESCRIÇÃO', 'NOME', 'EXAME'],

  /** Normaliza um nome de coluna: trim, maiúsculas, sem acento, espaços colapsados */
  _normCol(s) {
    return String(s || '').trim().toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  },

  /** Lê a planilha e devolve [{procedimento, valores:{Papel:valor}}] — SEM gravar.
   *  Usado pela ferramenta de "casar por similaridade". Colunas tolerantes. */
  async lerArquivoValores(arquivo) {
    if (!arquivo) throw new Error('Arquivo não fornecido');
    const buffer = await arquivo.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json(ws, { defval: null });
    if (!linhas.length) throw new Error('Planilha vazia');

    const colunasReais = Object.keys(linhas[0]);
    const mapaNorm = {};
    for (const c of colunasReais) mapaNorm[this._normCol(c)] = c;
    const acharCol = (aliases) => {
      for (const a of aliases) { const r = mapaNorm[this._normCol(a)]; if (r) return r; }
      return null;
    };
    const colProc = acharCol(this.PROCEDIMENTO_ALIASES);
    const papelCol = {};
    for (const def of this.PAPEIS_COLS) { const r = acharCol(def.aliases); if (r) papelCol[def.papel] = r; }
    if (!colProc || Object.keys(papelCol).length === 0) {
      throw new Error('Colunas faltando.\n\nEncontradas no arquivo: ' + colunasReais.join(' | '));
    }

    const out = [];
    for (const l of linhas) {
      const proc = String(l[colProc] || '').trim();
      if (!proc) continue;
      const valores = {};
      for (const [papel, col] of Object.entries(papelCol)) {
        // V491: parse BR-aware — Number() puro fazia "1.234,56" virar NaN → 0
        const v = Utilidades.parseNumBR(l[col], 0);
        valores[papel] = isFinite(v) ? v : 0;
      }
      out.push({ procedimento: proc, valores });
    }
    return { linhas: out, papeis: Object.keys(papelCol) };
  },

  /**
   * Lê arquivo Excel e importa.
   * @param {File} arquivo - Arquivo Excel
   * @param {string|null} tipoForcado - Se informado (CONVENIO/PARTICULAR/SUS), todas as
   *        linhas usam esse tipo e a coluna TIPO NÃO é exigida no arquivo.
   * @returns {Promise<object>} Relatório da importação
   */
  async importar(arquivo, tipoForcado = null, opts = {}) {
    if (!arquivo) throw new Error('Arquivo não fornecido');
    // V677: opts.versaoId → grava DIRETO no snapshot de uma versão publicada
    // (tabela_repasse_hist / procedimentos_hist), sem tocar na tabela viva.
    const versaoId = opts && opts.versaoId ? Number(opts.versaoId) : null;

    // normaliza o tipo forçado (aceita "CONVÊNIO" com acento)
    if (tipoForcado) {
      tipoForcado = String(tipoForcado).trim().toUpperCase();
      if (tipoForcado === 'CONVÊNIO') tipoForcado = 'CONVENIO';
      if (!['CONVENIO', 'PARTICULAR', 'SUS'].includes(tipoForcado)) {
        throw new Error(`Tipo inválido: ${tipoForcado}`);
      }
    }

    // 1) Lê o Excel
    const buffer = await arquivo.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const primeiraSheet = wb.SheetNames[0];
    const ws = wb.Sheets[primeiraSheet];

    // Converte para JSON (array de objetos)
    const linhas = XLSX.utils.sheet_to_json(ws, { defval: null });

    if (linhas.length === 0) {
      throw new Error('Planilha vazia');
    }

    // 2) Resolve colunas de forma TOLERANTE (ignora acento/espaços/maiúsculas + apelidos)
    const colunasReais = Object.keys(linhas[0]);
    const mapaNorm = {};                       // norm(coluna) → nome real da coluna
    for (const c of colunasReais) mapaNorm[this._normCol(c)] = c;

    const acharCol = (aliases) => {
      for (const a of aliases) {
        const real = mapaNorm[this._normCol(a)];
        if (real) return real;
      }
      return null;
    };

    // coluna do procedimento
    const colProc = acharCol(this.PROCEDIMENTO_ALIASES);
    // coluna de cada papel (pode faltar alguma — só não importa aquele papel)
    const papelCol = {};                       // nome do papel → nome real da coluna
    for (const def of this.PAPEIS_COLS) {
      const real = acharCol(def.aliases);
      if (real) papelCol[def.papel] = real;
    }

    const faltando = [];
    if (!colProc) faltando.push('PROCEDIMENTO');
    if (Object.keys(papelCol).length === 0) {
      faltando.push('pelo menos uma coluna de papel (CIRURGIÃO/EXECUTANTE, INDICANTE, SOLICITANTE, MÉDICO LAUDO, AUXILIAR)');
    }
    if (!tipoForcado && !mapaNorm[this._normCol('TIPO')]) {
      faltando.push('TIPO');
    }
    if (faltando.length > 0) {
      throw new Error(
        `Colunas faltando no Excel: ${faltando.join(', ')}.\n\n` +
        `Colunas encontradas no arquivo: ${colunasReais.join(' | ')}`
      );
    }
    const colTipoReal = mapaNorm[this._normCol('TIPO')] || 'TIPO';

    // 3) Carrega papéis (nome → id)
    const papeis = {};
    for (const p of Banco.query('SELECT id, nome FROM papeis')) {
      papeis[p.nome] = p.id;
    }

    // 4) Processa linhas
    const relatorio = {
      linhas_lidas: linhas.length,
      procedimentos_criados: 0,
      sinonimos_criados: 0,
      valores_criados: 0,
      linhas_ignoradas: 0,
      avisos: [],
    };

    // V491: loop inteiro numa transação única — antes cada linha da planilha
    // executava ~10 statements em autocommit (SELECT+INSERT de procedimento,
    // de sinônimo e até 5× de valores), o que deixava a importação lenta e
    // não-atômica. Resultado gravado idêntico; só velocidade e atomicidade.
    Banco.db.exec('BEGIN');
    try {

    for (let idx = 0; idx < linhas.length; idx++) {
      const linha = linhas[idx];
      const numLinha = idx + 2;  // +2 considerando cabeçalho

      const procOriginal = String(linha[colProc] || '').trim();

      if (!procOriginal) {
        relatorio.linhas_ignoradas++;
        continue;
      }

      let tipo;
      if (tipoForcado) {
        tipo = tipoForcado;                       // arquivo de um tipo só (sem coluna TIPO)
      } else {
        const tipoBruto = String(linha[colTipoReal] || '').trim().toUpperCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '');   // tolera acento
        if (!['CONVENIO', 'PARTICULAR', 'SUS'].includes(tipoBruto)) {
          relatorio.avisos.push(`Linha ${numLinha}: TIPO '${tipoBruto}' desconhecido — ignorado`);
          relatorio.linhas_ignoradas++;
          continue;
        }
        tipo = tipoBruto;
      }

      const procNormalizado = Utilidades.normalizar(procOriginal);

      // 4.1) Busca ou cria procedimento
      const proc = this._buscarOuCriarProcedimento(procOriginal, procNormalizado);
      if (proc.criado) relatorio.procedimentos_criados++;
      // V677: importando PARA uma versão publicada — o procedimento também
      // entra no snapshot dela (procedimentos_hist), senão a regra não conta
      if (versaoId) this._garantirProcNaVersao(versaoId, proc.id);

      // 4.2) Cadastra sinônimo (se ainda não existe)
      const criouSinonimo = this._registrarSinonimo(
        proc.id, procOriginal, procNormalizado, 'BASE_TABELA'
      );
      if (criouSinonimo) relatorio.sinonimos_criados++;

      // 4.3) Para cada papel encontrado, cadastra valor
      for (const [nomePapel, colReal] of Object.entries(papelCol)) {
        const valor = linha[colReal];
        if (valor === null || valor === undefined || valor === 0 || valor === '') continue;

        const papelId = papeis[nomePapel];
        if (papelId == null) {
          relatorio.avisos.push(`Papel '${nomePapel}' não está cadastrado em 'papeis' — ignorado`);
          continue;
        }
        // V677: com versaoId, grava no SNAPSHOT da versão (tabela_repasse_hist)
        // em vez da tabela viva — a tabela atual e as outras versões não mudam
        const criou = versaoId
          ? this._upsertValorRepasseVersao(versaoId, proc.id, papelId, tipo, Utilidades.parseNumBR(valor, 0))
          : this._upsertValorRepasse(proc.id, papelId, tipo, Utilidades.parseNumBR(valor, 0));   // V491: parse BR-aware
        if (criou) relatorio.valores_criados++;
      }
    }

    Banco.db.exec('COMMIT');   // V491: fecha a transação aberta antes do loop
    } catch (e) {
      try { Banco.db.exec('ROLLBACK'); } catch (_) {}
      throw e;
    }

    // 5) Salva no IndexedDB
    await Banco.salvar({ imediato: true });

    return relatorio;
  },

  /**
   * Lê a planilha e devolve os valores por procedimento SEM gravar nada.
   * Usado pela ferramenta de "casar por similaridade".
   * @returns {Promise<{linhas: Array<{procedimento:string, valores:Object}>, papeis:string[]}>}
   */
  async lerArquivoValores(arquivo) {
    if (!arquivo) throw new Error('Arquivo não fornecido');
    const buffer = await arquivo.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json(ws, { defval: null });
    if (!linhas.length) throw new Error('Planilha vazia');

    // resolve colunas de forma tolerante (mesma lógica do importar)
    const colunasReais = Object.keys(linhas[0]);
    const mapaNorm = {};
    for (const c of colunasReais) mapaNorm[this._normCol(c)] = c;
    const acharCol = (aliases) => {
      for (const a of aliases) { const r = mapaNorm[this._normCol(a)]; if (r) return r; }
      return null;
    };
    const colProc = acharCol(this.PROCEDIMENTO_ALIASES);
    const papelCol = {};
    for (const def of this.PAPEIS_COLS) { const r = acharCol(def.aliases); if (r) papelCol[def.papel] = r; }

    const faltando = [];
    if (!colProc) faltando.push('PROCEDIMENTO');
    if (Object.keys(papelCol).length === 0) faltando.push('pelo menos uma coluna de papel');
    if (faltando.length) {
      throw new Error(
        `Colunas faltando no Excel: ${faltando.join(', ')}.\n\n` +
        `Colunas encontradas no arquivo: ${colunasReais.join(' | ')}`
      );
    }

    const out = [];
    for (const linha of linhas) {
      const proc = String(linha[colProc] || '').trim();
      if (!proc) continue;
      const valores = {};
      for (const [papel, col] of Object.entries(papelCol)) {
        const v = linha[col];
        if (v === null || v === undefined || v === '' || Number(v) === 0) continue;
        valores[papel] = Number(v);
      }
      out.push({ procedimento: proc, valores });
    }
    return { linhas: out, papeis: Object.keys(papelCol) };
  },

  // ==========================================================================
  // Funções auxiliares (privadas)
  // ==========================================================================

  _buscarOuCriarProcedimento(nomeOriginal, nomeNormalizado) {
    const existente = Banco.queryUnica(
      'SELECT id FROM procedimentos WHERE nome_normalizado = ?',
      [nomeNormalizado]
    );
    if (existente) {
      return { id: existente.id, criado: false };
    }

    const r = Banco.executar(
      `INSERT INTO procedimentos (nome_oficial, nome_normalizado, repassavel)
       VALUES (?, ?, 1)`,
      [nomeOriginal, nomeNormalizado]
    );
    return { id: r.lastInsertRowId, criado: true };
  },

  _registrarSinonimo(procedimentoId, grafia, grafiaNormalizada, fonte) {
    const existente = Banco.queryUnica(
      'SELECT id FROM sinonimos_proc WHERE grafia = ?',
      [grafia]
    );
    if (existente) return false;

    Banco.executar(
      `INSERT INTO sinonimos_proc
         (procedimento_id, grafia, grafia_normalizada, fonte, aprovado_por)
       VALUES (?, ?, ?, ?, 'IMPORTACAO_AUTOMATICA')`,
      [procedimentoId, grafia, grafiaNormalizada, fonte]
    );
    return true;
  },

  // ── V677: escrita no SNAPSHOT de uma versão publicada ─────────────────────
  _garantirProcNaVersao(versaoId, procId) {
    const ex = Banco.queryUnica(
      `SELECT 1 AS um FROM procedimentos_hist WHERE versao_id = ? AND procedimento_id = ?`,
      [versaoId, procId]);
    if (ex) return false;
    try {
      Banco.executar(
        `INSERT INTO procedimentos_hist (versao_id, procedimento_id, nome_oficial, nome_normalizado, nomenclatura,
                                         repassavel, prod_categoria, prod_subcategoria, prod_subespecialidade)
          SELECT ?, id, nome_oficial, nome_normalizado, nomenclatura,
                 COALESCE(repassavel, 1), prod_categoria, prod_subcategoria, prod_subespecialidade
            FROM procedimentos WHERE id = ?`, [versaoId, procId]);
    } catch (_) {
      // base antiga sem as colunas de classificação — copia só o essencial
      Banco.executar(
        `INSERT INTO procedimentos_hist (versao_id, procedimento_id, nome_oficial, nome_normalizado, nomenclatura, repassavel)
          SELECT ?, id, nome_oficial, nome_normalizado, nomenclatura, COALESCE(repassavel, 1)
            FROM procedimentos WHERE id = ?`, [versaoId, procId]);
    }
    return true;
  },

  _upsertValorRepasseVersao(versaoId, procedimentoId, papelId, fonte, valorBruto) {
    let valor = null;
    let percentual = null;
    if (fonte === 'PARTICULAR') {
      percentual = valorBruto;
      if (percentual > 1) percentual = percentual / 100;  // normaliza 18 → 0.18
    } else {
      valor = valorBruto;
    }
    const existente = Banco.queryUnica(
      `SELECT rowid AS rid FROM tabela_repasse_hist
        WHERE versao_id = ? AND procedimento_id = ? AND papel_id = ? AND fonte_pagadora = ?`,
      [versaoId, procedimentoId, papelId, fonte]);
    if (existente) {
      Banco.executar(
        `UPDATE tabela_repasse_hist SET valor = ?, percentual = ?, ativo = 1 WHERE rowid = ?`,
        [valor, percentual, existente.rid]);
      return false;
    }
    Banco.executar(
      `INSERT INTO tabela_repasse_hist (versao_id, procedimento_id, papel_id, fonte_pagadora, valor, percentual, ativo)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [versaoId, procedimentoId, papelId, fonte, valor, percentual]);
    return true;
  },

  _upsertValorRepasse(procedimentoId, papelId, fonte, valorBruto) {
    let valor = null;
    let percentual = null;

    if (fonte === 'PARTICULAR') {
      percentual = valorBruto;
      if (percentual > 1) percentual = percentual / 100;  // normaliza 18 → 0.18
    } else {
      valor = valorBruto;
    }

    // Tenta inserir; se existir (UNIQUE), atualiza
    const existente = Banco.queryUnica(
      `SELECT id FROM tabela_repasse
        WHERE procedimento_id = ? AND papel_id = ? AND fonte_pagadora = ?`,
      [procedimentoId, papelId, fonte]
    );

    if (existente) {
      Banco.executar(
        `UPDATE tabela_repasse
            SET valor = ?, percentual = ?, atualizado_em = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [valor, percentual, existente.id]
      );
      return false;
    }

    Banco.executar(
      `INSERT INTO tabela_repasse
         (procedimento_id, papel_id, fonte_pagadora, valor, percentual)
       VALUES (?, ?, ?, ?, ?)`,
      [procedimentoId, papelId, fonte, valor, percentual]
    );
    return true;
  },
};

window.ImportadorBaseTabela = ImportadorBaseTabela;
