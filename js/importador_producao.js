/**
 * ============================================================================
 * IMPORTADOR de PRODUÇÃO ANALÍTICA
 *
 * Importa o relatório mensal de produção do hospital.
 *
 * Características do arquivo:
 *   - Linha 1: filtros aplicados (Applied filters: ...)
 *   - Linha 2: em branco
 *   - Linha 3: cabeçalho (Cód. Admissão, Data Admissão, ...)
 *   - Linhas 4+: dados (geralmente 30-50k linhas)
 *
 * Regras aplicadas na importação:
 *   - Importa TODAS as linhas, preservando a estrutura original do relatório
 *   - O status (MARCAÇÃO EFETIVADA / DIRETO NA RECEPÇÃO) é guardado, mas não
 *     filtra nada. Cada fichário consumidor decide o que faz com cada status.
 *   - Reimportar a mesma competência SOBRESCREVE os dados anteriores
 *     (evita duplicação)
 *
 * A competência (AAAA-MM) é detectada a partir das datas de admissão.
 * ============================================================================
 */

const ImportadorProducao = {

  /** Cabeçalho esperado (ordem importa para identificar a linha do header). */
  CABECALHO_ESPERADO: [
    'Cód. Admissão', 'Data Admissão', 'Hora Admissão', 'Status Admissão',
    'Unid. Atendimento', 'Especialidade', 'Tipo Recebimento',
  ],

  /** Mapeamento "cabeçalho do Excel" → "coluna do banco". */
  COLUNAS: {
    'Cód. Admissão':         'cod_admissao',
    'Data Admissão':         'data_admissao',
    'Hora Admissão':         'hora_admissao',
    'Status Admissão':       'status_admissao',
    'Unid. Atendimento':     'unidade',
    'Especialidade':         'especialidade',
    'Tipo Recebimento':      'tipo_recebimento',
    'Destino':               'destino',
    'Classificação Produto': 'classificacao_produto',
    'Tipo Produto':          'tipo_produto',
    'Categoria':             'categoria',
    'Subcategoria':          'subcategoria',
    'Subespecialidade':      'subespecialidade',
    'Médico Externo':        'medico_externo',
    'Cód. Apresentação':     'cod_apresentacao',
    'Procedimento Principal': 'procedimento_principal',
    'Produto':               'produto',
    'Pacote':                'pacote',
    'Convênio':              'convenio',
    'Plano':                 'plano',
    'Perfil Particular':     'perfil_particular',
    'Perfil Admissão':       'perfil_admissao',
    'Caráter Admissão':      'carater_admissao',
    'Observação Admissão':   'observacao_admissao',
    'Sala':                  'sala',
    'Profissional Admissão': 'profissional_admissao',
    'Tipo Paciente':         'tipo_paciente',
    'Cód. Paciente':         'cod_paciente',
    'Paciente':              'paciente',
    'Data Nascimento':       'data_nascimento',
    'Idade no Atendimento':  'idade_atendimento',
    'Faixa Etária':          'faixa_etaria',
    'CID Alta':              'cid_alta',
    'Descrição CID':         'descricao_cid',
    'Qtd.':                  'quantidade',
    'Valor R$':              'valor',
    'Indicante':             'indicante',
    'Solicitante':           'solicitante',
    'Consultor':             'consultor',
    'Médico':                'medico',
    'Cirurgião':             'cirurgiao',
    'Instrumentador':        'instrumentador',
    'Contatologa':           'contatologa',
    'Ortoptista':            'ortoptista',
    'Auxiliar SADT':         'auxiliar_sadt',
    'Auxiliar 1':            'auxiliar_1',
    'Auxiliar 2':            'auxiliar_2',
  },

  // ==========================================================================

  async importar(arquivo) {
    if (!arquivo) throw new Error('Arquivo não fornecido');

    const buffer = await arquivo.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];

    // Lê tudo como matriz (linha por linha, sem assumir cabeçalho)
    const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    // Localiza a linha do cabeçalho (procurar por "Cód. Admissão")
    let linhaHeader = -1;
    for (let i = 0; i < Math.min(matriz.length, 10); i++) {
      const linha = matriz[i] || [];
      if (linha.some(c => /^C[OÓ]D\.? ?ADMISS[AÃ]O$/i.test(String(c || '').trim()))) {   // V933: caixa/acento indiferentes
        linhaHeader = i;
        break;
      }
    }

    if (linhaHeader < 0) {
      throw new Error(
        'Não foi possível localizar o cabeçalho do relatório.\n\n' +
        'Esperado uma linha contendo "Cód. Admissão" nas primeiras 10 linhas.\n' +
        'O arquivo é o relatório correto de Produção Analítica?'
      );
    }

    const cabecalhos = (matriz[linhaHeader] || []).map(c => String(c || '').trim());
    const dataRows = matriz.slice(linhaHeader + 1);

    // Mapeia índices de coluna para campos do banco
    const indicesCampos = {}; // { campo_banco: indice_excel }
    // V933: o casamento do cabeçalho passa a aceitar diferença de CAIXA e de
    // ACENTO ("CATEGORIA" = "Categoria", "Cod. Admissao" = "Cód. Admissão") —
    // o exato continua tendo prioridade.
    const _cabNorm = (c) => String(c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    const cabecalhosNorm = cabecalhos.map(_cabNorm);
    for (const [cabExcel, campo] of Object.entries(this.COLUNAS)) {
      let idx = cabecalhos.indexOf(cabExcel);
      if (idx < 0) idx = cabecalhosNorm.indexOf(_cabNorm(cabExcel));
      if (idx >= 0) indicesCampos[campo] = idx;
    }

    // V132.13: só EXIGE o mínimo pra funcionar — cod_admissao (chave do PROCV
    // de indicante/solicitante na Auditoria) e data_admissao (deriva a competência).
    // As demais colunas (status_admissao, categoria, papéis, valores…) são OPCIONAIS:
    // se existirem, são gravadas; se não, ficam NULL. A importação não trava por
    // falta de colunas não-essenciais.
    const essenciais = ['cod_admissao', 'data_admissao'];
    const faltando = essenciais.filter(c => indicesCampos[c] === undefined);
    if (faltando.length) {
      const rotulos = { cod_admissao: 'Cód. Admissão', data_admissao: 'Data Admissão' };
      throw new Error(
        `Não foi possível importar: faltam as colunas mínimas ${faltando.map(c => `"${rotulos[c] || c}"`).join(' e ')}.\n\n` +
        `Essas duas são obrigatórias porque identificam a admissão e o mês. As demais colunas são opcionais.\n\n` +
        `Cabeçalhos encontrados: ${cabecalhos.filter(Boolean).slice(0, 12).join(', ')}...`
      );
    }

    const relatorio = {
      linhas_lidas: dataRows.length,
      linhas_importadas: 0,
      linhas_vazias: 0,
      competencias: new Set(),
      total_valor: 0,
      admissoes_unicas: new Set(),
    };

    // NOTA: não registramos auditoria na tabela `importacoes` porque o schema
    // atual dela exige competencia_id (1 competência por importação), e o
    // relatório de PRODUÇÃO pode conter múltiplas competências. Auditoria
    // detalhada de PRODUÇÃO pode ser implementada em tabela própria depois.
    const importacaoId = null;

    // Antes de inserir, identifica quais competências serão sobrescritas.
    // Faz isso lendo todas as linhas para coletar as competências presentes,
    // depois apaga as competências antes de inserir.
    const compsPresentes = new Set();
    const idxData = indicesCampos['data_admissao'];
    for (const linha of dataRows) {
      const data = linha[idxData];
      const comp = this._extrairCompetencia(data);
      if (comp) compsPresentes.add(comp);
    }

    // Prepara o INSERT — só dos campos que existem no mapeamento
    const camposBanco = Object.keys(indicesCampos);
    const placeholders = camposBanco.map(() => '?').join(', ');
    const sqlInsert = `
      INSERT INTO linhas_producao
        (competencia, importacao_id, linha_origem, ${camposBanco.join(', ')})
      VALUES (?, ?, ?, ${placeholders})
    `;

    // V491: DELETE + INSERTs numa TRANSAÇÃO ÚNICA com statement preparado uma vez.
    // Antes: cada linha compilava o INSERT + autocommit individual (30-50k linhas
    // levavam "30s a 2min") e o DELETE fora de transação deixava a competência
    // apagada/parcial se algo falhasse no meio. Agora: ou importa tudo, ou nada.
    // O resultado gravado é idêntico ao anterior — só atomicidade e velocidade.
    Banco.db.exec('BEGIN');
    const stmtInsert = Banco.db.prepare(sqlInsert);
    let numLinhaExcel = linhaHeader + 2;
    try {
      // Sobrescreve: apaga registros das competências detectadas
      for (const comp of compsPresentes) {
        Banco.executar('DELETE FROM linhas_producao WHERE competencia = ?', [comp]);
      }

      // Importa TODAS as linhas (não filtra por status — cada fichário decide
      // o que descartar nos seus próprios cálculos)
      for (const linha of dataRows) {
        numLinhaExcel++;

        // Pula linhas totalmente vazias
        const temAlgo = linha && linha.some(c => c !== null && c !== '');
        if (!temAlgo) {
          relatorio.linhas_vazias++;
          continue;
        }

        // Extrai competência da data desta linha
        const dataVal = linha[idxData];
        const competencia = this._extrairCompetencia(dataVal);
        if (!competencia) {
          // Sem data válida — pula
          relatorio.linhas_vazias++;
          continue;
        }

        // Monta o array de valores na ordem das camposBanco
        const valores = camposBanco.map(campo => {
          const idx = indicesCampos[campo];
          const v = linha[idx];
          return this._converterValor(campo, v);
        });

        try {
          stmtInsert.run([competencia, importacaoId, numLinhaExcel, ...valores]);
          relatorio.linhas_importadas++;
          relatorio.competencias.add(competencia);

          // Estatísticas
          const valorIdx = camposBanco.indexOf('valor');
          const codAdmIdx = camposBanco.indexOf('cod_admissao');
          if (valorIdx >= 0 && valores[valorIdx]) {
            relatorio.total_valor += Number(valores[valorIdx]) || 0;
          }
          if (codAdmIdx >= 0 && valores[codAdmIdx]) {
            relatorio.admissoes_unicas.add(valores[codAdmIdx]);
          }
        } catch (e) {
          console.warn(`Erro na linha ${numLinhaExcel}:`, e);
        }
      }
      Banco.db.exec('COMMIT');
    } catch (e) {
      // Falha estrutural no meio: desfaz TUDO (inclusive os DELETEs) pra não
      // deixar competência apagada pela metade no banco.
      try { Banco.db.exec('ROLLBACK'); } catch (_) {}
      throw e;
    } finally {
      try { stmtInsert.free(); } catch (_) {}
    }

    // Marca importação como concluída (se foi registrada)
    if (importacaoId) {
      try {
        Banco.executar(
          `UPDATE importacoes
              SET status = 'CONCLUIDO',
                  qtd_linhas = ?,
                  qtd_processadas = ?
            WHERE id = ?`,
          [relatorio.linhas_lidas, relatorio.linhas_importadas, importacaoId]
        );
      } catch (e) {
        console.warn('Falha ao atualizar status da importação:', e.message);
      }
    }

    await Banco.salvar({ imediato: true });

    // Converte sets para arrays para retornar
    return {
      ...relatorio,
      competencias: Array.from(relatorio.competencias).sort(),
      admissoes_unicas: relatorio.admissoes_unicas.size,
    };
  },

  // ==========================================================================

  /**
   * Extrai competência (AAAA-MM) de uma data.
   * Aceita Date object, string ISO (2026-04-22) ou serial number do Excel.
   */
  _extrairCompetencia(valor) {
    if (!valor) return null;

    let d;
    if (valor instanceof Date) {
      d = valor;
    } else if (typeof valor === 'number') {
      // Serial date do Excel: dias desde 1899-12-30
      d = new Date(Math.round((valor - 25569) * 86400 * 1000));
    } else {
      const s = String(valor).trim();
      // Tenta ISO yyyy-mm-dd
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}`;
      // Tenta dd/mm/yyyy
      const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m2) return `${m2[3]}-${String(m2[2]).padStart(2, '0')}`;
      d = new Date(s);
    }

    if (!d || isNaN(d.getTime())) return null;
    // V491: getters UTC — o serial Excel é convertido em ms UTC e a data_admissao
    // é gravada via toISOString() (UTC) em _converterValor. Com getters LOCAIS,
    // em UTC-3 o dia 1º às 00:00 caía na competência do mês ANTERIOR e a mesma
    // linha podia ter competencia='2026-04' com data_admissao='2026-05-01'.
    const ano = d.getUTCFullYear();
    const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${ano}-${mes}`;
  },

  /**
   * Converte valor do Excel para o tipo correto do banco.
   * Datas → ISO string. Números mantêm. Textos viram string trimada.
   */
  _converterValor(campo, valor) {
    if (valor === null || valor === undefined || valor === '') return null;

    // Campos de data
    if (['data_admissao', 'data_nascimento'].includes(campo)) {
      if (valor instanceof Date) return valor.toISOString().slice(0, 10);
      if (typeof valor === 'number') {
        const d = new Date(Math.round((valor - 25569) * 86400 * 1000));
        return d.toISOString().slice(0, 10);
      }
      return String(valor).trim();
    }

    // Campos numéricos
    if (['quantidade', 'valor', 'idade_atendimento'].includes(campo)) {
      // V491: Number() puro não entende pt-BR — célula-texto "1.234,56" virava
      // NaN → NULL e zerava faturamento silenciosamente. parseNumBR trata os
      // dois formatos; números vindos como number do SheetJS passam direto.
      return Utilidades.parseNumBR(valor, null);
    }

    // Hora — formato HH:MM ou HH:MM:SS
    if (campo === 'hora_admissao') {
      if (valor instanceof Date) {
        return valor.toTimeString().slice(0, 8);
      }
      return String(valor).trim();
    }

    // Resto: string
    return String(valor).trim() || null;
  },
};

window.ImportadorProducao = ImportadorProducao;
