/**
 * ============================================================================
 * IMPORTADOR DE MÉDICOS — Excel → Banco SQLite
 * ============================================================================
 *
 * Aceita planilhas com colunas variadas:
 *   - Nome:          "NOME" | "MÉDICO" | "MÉDICOS" | "MEDICO" | "MEDICOS"
 *   - Especialidade: "ESPECIALIDADE" | "ESPECIALIDADES"
 *                    (várias por linha, separadas por vírgula ou ponto-e-vírgula)
 *   - CRM:           "CRM" | "CRM-DF" | "CRM DF"
 *   - RQE:           "RQE"
 *   - CNPJ:          "CNPJ"
 *   - Razão Social:  "RAZÃO SOCIAL" | "RAZAO SOCIAL"
 *   - E-mail:        "E-MAIL" | "EMAIL"
 *   - Telefone:      "TELEFONE" | "TELEFONES" | "FONE"
 *   - Observações:   "OBSERVACOES" | "OBSERVAÇÕES" | "OBS"
 *
 * Comportamento:
 *   - Linhas vazias são ignoradas
 *   - Médicos repetidos são consolidados (não duplica, só adiciona especialidades novas)
 *   - Especialidades novas são criadas automaticamente
 *   - Se um médico não tem especialidade, ele é cadastrado mesmo assim (sem vínculos)
 */

const ImportadorMedicos = {

  // Mapeamento: cabeçalho normalizado → campo do banco
  COLUNAS_CONHECIDAS: {
    'NOME':           'nome',
    'MEDICO':         'nome',
    'MEDICOS':        'nome',
    'NOME COMPLETO':  'nome',

    'ESPECIALIDADE':  'especialidades',
    'ESPECIALIDADES': 'especialidades',

    'CRM':            'crm',
    'CRM DF':         'crm',
    'CRMDF':          'crm',

    'RQE':            'rqe',

    'CNPJ':           'cnpj',

    'RAZAO SOCIAL':   'razao_social',
    'RAZAO':          'razao_social',

    'EMAIL':          'email',
    'E MAIL':         'email',

    'TELEFONE':       'telefone',
    'TELEFONES':      'telefone',
    'FONE':           'telefone',
    'CELULAR':        'telefone',

    'OBSERVACOES':    'observacoes',
    'OBSERVACAO':     'observacoes',
    'OBS':            'observacoes',

    'TIPO':           'tipo_vinculo',
    'TIPO VINCULO':   'tipo_vinculo',
    'VINCULO':        'tipo_vinculo',
    'TIPO MEDICO':    'tipo_vinculo',

    'UNIDADE':        'unidades',
    'UNIDADES':       'unidades',
    'LOCAL':          'unidades',
    'FILIAL':         'unidades',
  },

  async importar(arquivo) {
    if (!arquivo) throw new Error('Arquivo não fornecido');

    const buffer = await arquivo.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const primeiraSheet = wb.SheetNames[0];
    const ws = wb.Sheets[primeiraSheet];
    const linhas = XLSX.utils.sheet_to_json(ws, { defval: null });

    if (linhas.length === 0) throw new Error('Planilha vazia');

    // Mapeia cabeçalhos do Excel → campos do banco
    const cabecalhos = Object.keys(linhas[0]);
    const mapaCampos = this._mapearCabecalhos(cabecalhos);

    if (!mapaCampos.nome) {
      throw new Error(
        'Coluna de nome não encontrada. Esperado: NOME, MÉDICO ou MÉDICOS.\n' +
        'Colunas presentes: ' + cabecalhos.join(', ')
      );
    }
    if (!mapaCampos.especialidades) {
      throw new Error(
        'Coluna de especialidade não encontrada. Esperado: ESPECIALIDADE ou ESPECIALIDADES.\n' +
        'Colunas presentes: ' + cabecalhos.join(', ')
      );
    }

    const relatorio = {
      linhas_lidas: linhas.length,
      medicos_criados: 0,
      medicos_atualizados: 0,
      especialidades_criadas: 0,
      vinculos_criados: 0,
      unidades_criadas: 0,
      vinculos_unidade_criados: 0,
      linhas_ignoradas: 0,
      avisos: [],
    };

    // V491: loop em transação única (antes: vários statements autocommit por linha)
    Banco.db.exec('BEGIN');
    try {
    for (let idx = 0; idx < linhas.length; idx++) {
      const linha = linhas[idx];
      const numLinha = idx + 2;

      const dados = {};
      for (const [campo, cabExcel] of Object.entries(mapaCampos)) {
        const valor = linha[cabExcel];
        dados[campo] = (valor === null || valor === undefined)
          ? null
          : String(valor).trim();
      }

      if (!dados.nome) {
        relatorio.linhas_ignoradas++;
        continue;
      }

      // 1) Médico (busca ou cria)
      const nomeNorm = Utilidades.normalizar(dados.nome);
      const medicoExistente = Banco.queryUnica(
        'SELECT * FROM medicos WHERE nome_normalizado = ?',
        [nomeNorm]
      );

      let medicoId;
      let foiCriado = false;
      if (medicoExistente) {
        medicoId = medicoExistente.id;
        // Atualiza campos vazios com dados novos (sem sobrescrever existentes)
        this._atualizarCamposVazios(medicoId, medicoExistente, dados);

        // EXCEÇÃO: o tipo_vinculo é sempre sobrescrito quando vier na planilha,
        // pois esta é a fonte de verdade para esse campo.
        const tipoNovo = this._normalizarTipoVinculo(dados.tipo_vinculo);
        if (tipoNovo && tipoNovo !== medicoExistente.tipo_vinculo) {
          Banco.executar(
            `UPDATE medicos SET tipo_vinculo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
            [tipoNovo, medicoId]
          );
        }
        relatorio.medicos_atualizados++;
      } else {
        const r = Banco.executar(
          `INSERT INTO medicos
             (nome_oficial, nome_normalizado, crm, rqe, cnpj, razao_social, email, telefone, tipo_vinculo, observacoes, ativo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            dados.nome, nomeNorm,
            dados.crm || null,
            dados.rqe || null,
            dados.cnpj || null,
            dados.razao_social || null,
            dados.email || null,
            dados.telefone || null,
            this._normalizarTipoVinculo(dados.tipo_vinculo),
            dados.observacoes || null,
          ]
        );
        medicoId = r.lastInsertRowId;
        foiCriado = true;
        relatorio.medicos_criados++;
      }

      // 2) Especialidades (split por vírgula/ponto-e-vírgula)
      if (dados.especialidades) {
        const lista = this._dividirEspecialidades(dados.especialidades);
        for (const espNome of lista) {
          const r = this._garantirEspecialidade(espNome);
          if (r.criada) relatorio.especialidades_criadas++;

          // Vincula (UNIQUE evita duplicação)
          const vinculo = Banco.queryUnica(
            'SELECT id FROM medico_especialidades WHERE medico_id = ? AND especialidade_id = ?',
            [medicoId, r.id]
          );
          if (!vinculo) {
            Banco.executar(
              'INSERT INTO medico_especialidades (medico_id, especialidade_id) VALUES (?, ?)',
              [medicoId, r.id]
            );
            relatorio.vinculos_criados++;
          }
        }
      } else {
        relatorio.avisos.push(`Linha ${numLinha}: "${dados.nome}" cadastrado sem especialidade`);
      }

      // 3) Unidades (split por vírgula/ponto-e-vírgula)
      if (dados.unidades) {
        const lista = this._dividirEspecialidades(dados.unidades);  // mesma lógica
        for (const unidNome of lista) {
          const r = this._garantirUnidade(unidNome);
          if (r.criada) {
            relatorio.unidades_criadas = (relatorio.unidades_criadas || 0) + 1;
          }

          const vinculo = Banco.queryUnica(
            'SELECT id FROM medico_unidades WHERE medico_id = ? AND unidade_id = ?',
            [medicoId, r.id]
          );
          if (!vinculo) {
            Banco.executar(
              'INSERT INTO medico_unidades (medico_id, unidade_id) VALUES (?, ?)',
              [medicoId, r.id]
            );
            relatorio.vinculos_unidade_criados = (relatorio.vinculos_unidade_criados || 0) + 1;
          }
        }
      }
    }
    Banco.db.exec('COMMIT');   // V491
    } catch (e) {
      try { Banco.db.exec('ROLLBACK'); } catch (_) {}
      throw e;
    }

    await Banco.salvar({ imediato: true });
    return relatorio;
  },

  /**
   * Modo especial: importação da planilha de médicos EXTERNOS e HÍBRIDOS.
   *
   * Regras:
   *   - Médicos EXTERNO: criados/atualizados com tipo_vinculo=EXTERNO
   *     + vinculados à especialidade "Informação Externa" (preserva outras)
   *   - Médicos HIBRIDO: criados/atualizados com tipo_vinculo=HIBRIDO
   *     (não mexe em especialidades existentes)
   *   - Especialidades existentes do médico são mantidas (não apaga)
   *   - Especialidade "Informação Externa" é criada se não existir
   */
  async importarExternos(arquivo) {
    if (!arquivo) throw new Error('Arquivo não fornecido');

    const buffer = await arquivo.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json(ws, { defval: null });

    if (linhas.length === 0) throw new Error('Planilha vazia');

    const cabecalhos = Object.keys(linhas[0]);
    const mapaCampos = this._mapearCabecalhos(cabecalhos);

    if (!mapaCampos.nome) {
      throw new Error(
        'Coluna de nome não encontrada. Esperado: NOME, MÉDICO ou MÉDICOS.\n' +
        'Colunas presentes: ' + cabecalhos.join(', ')
      );
    }
    if (!mapaCampos.tipo_vinculo) {
      throw new Error(
        'Coluna de tipo não encontrada. Esperado: TIPO, TIPO_VINCULO ou VINCULO.\n' +
        'Colunas presentes: ' + cabecalhos.join(', ')
      );
    }

    // Garante a especialidade "Informação Externa"
    const espExterna = this._garantirEspecialidade('Informação Externa');

    const relatorio = {
      linhas_lidas: linhas.length,
      medicos_criados: 0,
      medicos_atualizados: 0,
      externos_processados: 0,
      hibridos_processados: 0,
      especialidades_criadas: espExterna.criada ? 1 : 0,
      vinculos_externa_criados: 0,
      linhas_ignoradas: 0,
      avisos: [],
    };

    // V491: loop em transação única (antes: vários statements autocommit por linha)
    Banco.db.exec('BEGIN');
    try {
    for (let idx = 0; idx < linhas.length; idx++) {
      const linha = linhas[idx];
      const numLinha = idx + 2;

      const dados = {};
      for (const [campo, cabExcel] of Object.entries(mapaCampos)) {
        const valor = linha[cabExcel];
        dados[campo] = (valor === null || valor === undefined)
          ? null
          : String(valor).trim();
      }

      if (!dados.nome) {
        relatorio.linhas_ignoradas++;
        continue;
      }

      const tipoNorm = this._normalizarTipoVinculo(dados.tipo_vinculo);
      if (!tipoNorm) {
        relatorio.avisos.push(`Linha ${numLinha}: "${dados.nome}" sem tipo válido (${dados.tipo_vinculo || 'vazio'}) — ignorado`);
        relatorio.linhas_ignoradas++;
        continue;
      }

      // Apenas EXTERNO e HIBRIDO são processados nessa importação
      if (tipoNorm !== 'EXTERNO' && tipoNorm !== 'HIBRIDO') {
        relatorio.avisos.push(`Linha ${numLinha}: "${dados.nome}" é ${tipoNorm} — esta importação é só para EXTERNO/HÍBRIDO`);
        relatorio.linhas_ignoradas++;
        continue;
      }

      // 1) Busca/cria médico
      const nomeNorm = Utilidades.normalizar(dados.nome);
      const medicoExistente = Banco.queryUnica(
        'SELECT * FROM medicos WHERE nome_normalizado = ?',
        [nomeNorm]
      );

      let medicoId;
      if (medicoExistente) {
        medicoId = medicoExistente.id;
        this._atualizarCamposVazios(medicoId, medicoExistente, dados);
        // Sobrescreve tipo_vinculo (esta é a fonte de verdade)
        Banco.executar(
          `UPDATE medicos SET tipo_vinculo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
          [tipoNorm, medicoId]
        );
        relatorio.medicos_atualizados++;
      } else {
        const r = Banco.executar(
          `INSERT INTO medicos
             (nome_oficial, nome_normalizado, crm, rqe, cnpj, razao_social, email, telefone, tipo_vinculo, observacoes, ativo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            dados.nome, nomeNorm,
            dados.crm || null,
            dados.rqe || null,
            dados.cnpj || null,
            dados.razao_social || null,
            dados.email || null,
            dados.telefone || null,
            tipoNorm,
            dados.observacoes || null,
          ]
        );
        medicoId = r.lastInsertRowId;
        relatorio.medicos_criados++;
      }

      // 2) Se for EXTERNO, vincula à especialidade "Informação Externa"
      //    (mantém outras especialidades já existentes)
      if (tipoNorm === 'EXTERNO') {
        relatorio.externos_processados++;
        const vinculo = Banco.queryUnica(
          'SELECT id FROM medico_especialidades WHERE medico_id = ? AND especialidade_id = ?',
          [medicoId, espExterna.id]
        );
        if (!vinculo) {
          Banco.executar(
            'INSERT INTO medico_especialidades (medico_id, especialidade_id) VALUES (?, ?)',
            [medicoId, espExterna.id]
          );
          relatorio.vinculos_externa_criados++;
        }
      } else {
        // HÍBRIDO: não toca em especialidades (já tem as suas reais)
        relatorio.hibridos_processados++;
      }
    }
    Banco.db.exec('COMMIT');   // V491
    } catch (e) {
      try { Banco.db.exec('ROLLBACK'); } catch (_) {}
      throw e;
    }

    await Banco.salvar({ imediato: true });
    return relatorio;
  },

  // ==========================================================================
  // Funções privadas
  // ==========================================================================

  /**
   * Recebe a lista de cabeçalhos do Excel e devolve um mapa:
   *   { nome: "Médicos", especialidades: "Especialidades", crm: "CRM-DF", ... }
   * Compara após normalização (sem acento, maiúsculo, sem pontuação, sem espaços extras).
   * Importante: usa Utilidades.normalizar() que já remove espaços nas pontas e
   * colapsa espaços duplos — então cabeçalhos como "NOME ", "  NOME  " ou
   * "NOME COMPLETO" são tratados corretamente.
   */
  _mapearCabecalhos(cabecalhos) {
    const mapa = {};
    for (const cab of cabecalhos) {
      const norm = Utilidades.normalizar(cab);
      const campo = this.COLUNAS_CONHECIDAS[norm];
      if (campo && !mapa[campo]) {
        mapa[campo] = cab;
      }
    }
    return mapa;
  },

  /**
   * Divide uma string de especialidades em uma lista.
   * Aceita vírgula, ponto-e-vírgula e barra como separadores.
   * Ex: "Retina, Injeção; Laser/Catarata" → ["Retina", "Injeção", "Laser", "Catarata"]
   */
  _dividirEspecialidades(texto) {
    if (!texto) return [];
    return texto
      .split(/[,;/]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  },

  /**
   * Busca especialidade pelo nome (case-insensitive); cria se não existir.
   */
  _garantirEspecialidade(nome) {
    const existente = Banco.queryUnica(
      'SELECT id FROM especialidades WHERE UPPER(nome) = UPPER(?)',
      [nome]
    );
    if (existente) return { id: existente.id, criada: false };

    const prox = (Banco.queryUnica(
      'SELECT COALESCE(MAX(ordem), 0) + 1 AS n FROM especialidades'
    ) || { n: 1 }).n;
    const r = Banco.executar(
      'INSERT INTO especialidades (nome, ordem, ativo) VALUES (?, ?, 1)',
      [nome, prox]
    );
    return { id: r.lastInsertRowId, criada: true };
  },

  /**
   * Busca unidade pelo nome (case-insensitive); cria se não existir.
   */
  _garantirUnidade(nome) {
    const existente = Banco.queryUnica(
      'SELECT id FROM unidades WHERE UPPER(nome) = UPPER(?)',
      [nome]
    );
    if (existente) return { id: existente.id, criada: false };

    const prox = (Banco.queryUnica(
      'SELECT COALESCE(MAX(ordem), 0) + 1 AS n FROM unidades'
    ) || { n: 1 }).n;
    const r = Banco.executar(
      'INSERT INTO unidades (nome, ordem, ativo) VALUES (?, ?, 1)',
      [nome, prox]
    );
    return { id: r.lastInsertRowId, criada: true };
  },

  /**
   * Preenche apenas os campos vazios do médico com os dados novos.
   * Nunca sobrescreve dados existentes (proteção contra perda).
   */
  _atualizarCamposVazios(medicoId, medicoAtual, dadosNovos) {
    const campos = ['crm', 'rqe', 'cnpj', 'razao_social', 'email', 'telefone', 'tipo_vinculo', 'observacoes'];
    const atualizacoes = [];
    const valores = [];

    for (const campo of campos) {
      const atual = medicoAtual[campo];
      let novo = dadosNovos[campo];
      if (campo === 'tipo_vinculo') novo = this._normalizarTipoVinculo(novo);
      if (novo && (!atual || atual === '')) {
        atualizacoes.push(`${campo} = ?`);
        valores.push(novo);
      }
    }

    if (atualizacoes.length > 0) {
      valores.push(medicoId);
      Banco.executar(
        `UPDATE medicos SET ${atualizacoes.join(', ')}, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
        valores
      );
    }
  },

  /**
   * Normaliza a string do tipo de vínculo para os 3 valores canônicos:
   * INTERNO, EXTERNO, HIBRIDO. Aceita variações: "interno", "Interno",
   * "Hibrido", "Híbrido", "EXTERNO", etc.
   */
  _normalizarTipoVinculo(texto) {
    if (!texto) return null;
    const norm = Utilidades.normalizar(texto);
    if (norm.startsWith('INTERNO') || norm === 'INTERNO') return 'INTERNO';
    if (norm.startsWith('EXTERNO') || norm === 'EXTERNO') return 'EXTERNO';
    if (norm.startsWith('HIBRIDO') || norm === 'HIBRIDO' || norm === 'MISTO') return 'HIBRIDO';
    return null;
  },
};

window.ImportadorMedicos = ImportadorMedicos;
