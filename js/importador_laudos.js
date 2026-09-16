/**
 * ============================================================================
 * IMPORTADOR de PAGAMENTO LAUDOS
 *
 * Lê a planilha "PAGAMENTO - LAUDOS - <MES>.xlsx" que vem de outro setor
 * e popula a tabela `laudos` no banco.
 *
 * O arquivo de entrada tem várias abas; reconhecemos estas 3 (por termos, flexível):
 *   - 'PACOTES' / 'LAUDOS PACOTE'                  → categoria PACOTE
 *   - 'IMPRESSOS' / 'LAUDO(S) NO(S) RES'           → categoria IMPRESSO
 *   - 'MÉDICO LAUDISTA EXTERNO'                     → categoria EXTERNO
 * Abas "VALORES LAUDOS" (preços) e "TOTAL" (resumo) são ignoradas.
 *
 * Tratamentos aplicados (sem mudar a planilha de origem):
 *   - Linha "Total" no fim de cada aba é DESCARTADA
 *   - Coluna "Unidade" mesclada (vazia nas linhas seguintes) faz forward-fill
 *   - "LANÇAR" como valor vira flag pendente + valor = 0
 *   - Nomes recebem TRIM (ex: "ANGIOGRAFIA " → "ANGIOGRAFIA")
 *   - Observação == "PARTICULAR" vira flag particular
 *
 * A competência é detectada a partir das datas (ou pode ser informada manualmente).
 * Reimportar a mesma competência SUBSTITUI os dados anteriores (evita duplicação).
 * ============================================================================
 */

const ImportadorLaudos = {

  // TERMOS distintivos por categoria (robusto a renomeações do setor).
  // O reconhecimento (ver acharAba, abaixo) tenta primeiro IGUALDADE EXATA e,
  // se não achar, casa por SUBSTRING ignorando acentos — assim "PACOTES",
  // "IMPRESSOS", "LAUDOS NO RES", etc. são reconhecidos automaticamente.
  // Abas sem nenhum termo (ex.: "VALORES LAUDOS" = tabela de preços, "TOTAL" =
  // resumo) NÃO contêm termo de categoria e por isso são naturalmente ignoradas.
  ABAS: {
    PACOTE:    ['LAUDOS PACOTE', 'PACOTES', 'PACOTE'],
    IMPRESSO:  ['LAUDO NOS IMPRESSOS', 'LAUDOS NOS IMPRESSOS', 'IMPRESSOS', 'IMPRESSO',
                'LAUDOS NO RES', 'LAUDO NO RES', 'LAUDOS RES', 'LAUDO RES'],
    EXTERNO:   ['MÉDICO LAUDISTA EXTERNO', 'MEDICO LAUDISTA EXTERNO', 'LAUDISTA EXTERNO',
                'MEDICO EXTERNO', 'EXTERNO'],
  },

  // ─────────────────────────────────────────────────────────────────────
  // PONTO DE ENTRADA — recebe um File do <input type="file">
  //                    e a competência (AAAA-MM) informada pelo usuário
  // ─────────────────────────────────────────────────────────────────────
  async importar(file, competencia) {
    if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) {
      throw new Error('Competência inválida. Informe no formato AAAA-MM.');
    }

    const buffer = await this._lerArquivo(file);
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });

    // normaliza: trim + maiúsculas + remove acentos (ç, ó, etc.)
    const norm = (s) => String(s || '').trim().toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // ⚠ DINHEIRO: cada aba só pode ser usada UMA vez (evita somar em dobro).
    const usadas = new Set();
    const acharAba = (termos) => {
      const abas = wb.SheetNames;
      const tentar = (pred) => {
        const idx = abas.findIndex(n => !usadas.has(n) && pred(norm(n)));
        if (idx >= 0) { usadas.add(abas[idx]); return abas[idx]; }
        return null;
      };
      // 1) igualdade exata (mais seguro)
      for (const t of termos) {
        const r = tentar(n => n === norm(t));
        if (r) return r;
      }
      // 2) substring sem acento — reconhece "PACOTES", "IMPRESSOS", etc.
      for (const t of termos) {
        const r = tentar(n => n.includes(norm(t)));
        if (r) return r;
      }
      return null;
    };

    // Ordem importa: EXTERNO primeiro (termo "EXTERNO" é o mais específico),
    // depois PACOTE, depois IMPRESSO — assim a trava 'usadas' não rouba aba errada.
    const abaExterno  = acharAba(this.ABAS.EXTERNO);
    const abaPacote   = acharAba(this.ABAS.PACOTE);
    const abaImpresso = acharAba(this.ABAS.IMPRESSO);

    if (!abaPacote && !abaImpresso && !abaExterno) {
      throw new Error(
        'Nenhuma aba de laudos foi reconhecida na planilha.\n' +
        'Esperado abas com nomes contendo: "PACOTE(S)", "IMPRESSO(S)" (ou "NO RES") e "LAUDISTA EXTERNO".\n' +
        'Abas encontradas no arquivo: ' + wb.SheetNames.join(' | ')
      );
    }

    const todasLinhas = [];

    if (abaPacote) {
      const linhas = this._parsePacote(wb.Sheets[abaPacote]);
      todasLinhas.push(...linhas);
    }
    if (abaImpresso) {
      const linhas = this._parseImpresso(wb.Sheets[abaImpresso]);
      todasLinhas.push(...linhas);
    }
    if (abaExterno) {
      const linhas = this._parseExterno(wb.Sheets[abaExterno]);
      todasLinhas.push(...linhas);
    }

    if (todasLinhas.length === 0) {
      throw new Error('As 3 abas foram lidas, mas nenhuma linha de dados foi extraída.');
    }

    // Aplica competência em todas as linhas
    todasLinhas.forEach(l => { l.competencia = competencia; });

    // Persiste — substitui a competência inteira pra evitar duplicação
    this._persistir(competencia, todasLinhas);

    // Resumo pra exibir pro usuário
    return {
      competencia,
      total: todasLinhas.length,
      por_categoria: {
        PACOTE:   todasLinhas.filter(l => l.categoria === 'PACOTE').length,
        IMPRESSO: todasLinhas.filter(l => l.categoria === 'IMPRESSO').length,
        EXTERNO:  todasLinhas.filter(l => l.categoria === 'EXTERNO').length,
      },
      total_valor: todasLinhas.reduce((s, l) => s + (Number(l.valor_repasse) || 0), 0),
      pendencias: todasLinhas.filter(l => l.pendente).length,
      particulares: todasLinhas.filter(l => l.particular).length,
    };
  },

  // ─────────────────────────────────────────────────────────────────────
  // Lê o File como ArrayBuffer (assíncrono)
  // ─────────────────────────────────────────────────────────────────────
  _lerArquivo(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => resolve(new Uint8Array(e.target.result));
      r.onerror = () => reject(new Error('Falha ao ler o arquivo'));
      r.readAsArrayBuffer(file);
    });
  },

  // ─────────────────────────────────────────────────────────────────────
  // PARSE — LAUDOS PACOTE
  // Cabeçalho na linha 1:
  //   Unidade | CONVÊNIO | MÉDICO EXECUTANTE | LAUDO | QUANTIDADE | VALOR POR EXAME | VALOR DE REPASSE
  // ─────────────────────────────────────────────────────────────────────
  _parsePacote(sheet) {
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    const linhas = [];
    let unidadeAtual = '';   // forward-fill

    // Acha linha do cabeçalho (procura por "UNIDADE" + "CONVÊNIO")
    const idxHeader = aoa.findIndex(row =>
      row.length >= 4 &&
      String(row[0] || '').trim().toUpperCase() === 'UNIDADE' &&
      String(row[1] || '').trim().toUpperCase().includes('CONV')
    );
    if (idxHeader < 0) return [];

    let ordem = 0;
    for (let i = idxHeader + 1; i < aoa.length; i++) {
      const row = aoa[i];
      const col0 = String(row[0] || '').trim();
      const colConv = String(row[1] || '').trim();

      // Pula linha "Total" no fim
      if (col0.toUpperCase() === 'TOTAL' || colConv.toUpperCase() === 'TOTAL') continue;

      // Pula linhas totalmente vazias
      if (!colConv && !String(row[2] || '').trim()) continue;

      // Forward-fill da unidade
      if (col0) unidadeAtual = col0;

      const medico = this._normalizarNome(row[2]);
      const exame  = this._normalizarTexto(row[3]);
      if (!medico || !exame) continue;

      const qtd   = this._numero(row[4], 1);
      const unit  = this._numero(row[5], 0);
      const total = this._numero(row[6], 0);

      linhas.push({
        categoria:      'PACOTE',
        ordem:          ++ordem,
        unidade:        unidadeAtual || null,
        convenio:       this._normalizarTexto(colConv),
        medico,
        exame,
        quantidade:     qtd,
        valor_unitario: unit,
        valor_repasse:  total,
        pendente:       0,
        particular:     0,
      });
    }
    return linhas;
  },

  // ─────────────────────────────────────────────────────────────────────
  // PARSE — LAUDO NOS IMPRESSOS
  // V908: o CABEÇALHO manda. O layout antigo tinha 8 colunas
  //   (Cód. Admissão | Data Admissão | Cód. Paciente | Paciente | Profissional | Fluxo | Modulo | Valores)
  // e a planilha real de agosto veio com 7, SEM o "Cód. Paciente"
  //   (Cód. Admissão | Data Admissão | Paciente | Profissional | Fluxo | Descrição | Valores)
  // — os índices fixos liam a coluna errada e o detector antigo (Paciente
  // obrigatoriamente na 4ª coluna) nem achava o cabeçalho, devolvendo []
  // em silêncio. Agora cada coluna é localizada pelo TEXTO do cabeçalho;
  // obrigatórias só ADMISSÃO, PACIENTE e VALOR — o resto é opcional.
  // ─────────────────────────────────────────────────────────────────────
  _parseImpresso(sheet) {
    // V908: raw:true — a coluna de data é datetime nativo na planilha real e
    // com raw:false ela chegava como texto "M/D/YY" (formato americano do
    // Excel) que o _normalizarData não reconhece; com raw:true vem como
    // Date e os valores como número, sem ambiguidade.
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const linhas = [];

    const normCab = (c) => String(c || '').trim().toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let idxHeader = -1, col = null;
    for (let i = 0; i < Math.min(aoa.length, 12); i++) {
      const cab = (aoa[i] || []).map(normCab);
      const m = {
        admissao:    cab.findIndex(c => c.includes('ADMIS') && !c.includes('DATA')),
        data:        cab.findIndex(c => c.includes('DATA')),
        codPaciente: cab.findIndex(c => c.includes('PACIENT') && c.includes('COD')),
        paciente:    cab.findIndex(c => c.includes('PACIENT') && !c.includes('COD')),
        medico:      cab.findIndex(c => c.includes('PROFISSIONAL') || c.includes('MEDIC')),
        fluxo:       cab.findIndex(c => c.includes('FLUXO')),
        modulo:      cab.findIndex(c => c.includes('MODUL') || c.includes('DESCRI') || c.includes('EXAME')),
        valor:       cab.findIndex(c => c.includes('VALOR')),
      };
      if (m.admissao >= 0 && m.paciente >= 0 && m.valor >= 0) { idxHeader = i; col = m; break; }
    }
    if (idxHeader < 0) return [];
    const pega = (row, k) => (col[k] >= 0 ? row[col[k]] : '');

    let ordem = 0;
    for (let i = idxHeader + 1; i < aoa.length; i++) {
      const row = aoa[i];
      const admissao = String(pega(row, 'admissao') ?? '').trim();

      // Pula linha "Total" no fim
      if (admissao.toUpperCase() === 'TOTAL') continue;
      // V908: linha SEM cód. de admissão mas COM paciente entra mesmo assim
      // (a planilha real de agosto tem uma) — só a linha vazia de verdade sai
      const temPaciente = String(pega(row, 'paciente') ?? '').trim() !== '';
      if (!admissao && !temPaciente) continue;

      const valorRaw = String(pega(row, 'valor') ?? '').trim().toUpperCase();
      let valor = 0;
      let pendente = 0;
      if (/LAN[ÇC]AR|VERIFICAR/i.test(valorRaw)) {
        pendente = 1;
        valor = 0;
      } else {
        valor = this._numero(pega(row, 'valor'), 0);
      }

      linhas.push({
        categoria:     'IMPRESSO',
        ordem:         ++ordem,
        admissao,
        data_admissao: this._normalizarData(pega(row, 'data')),
        cod_paciente:  this._normalizarTexto(pega(row, 'codPaciente')),
        paciente:      this._normalizarNome(pega(row, 'paciente')),
        medico:        this._normalizarNome(pega(row, 'medico')),
        fluxo:         this._normalizarTexto(pega(row, 'fluxo')),
        modulo:        this._normalizarTexto(pega(row, 'modulo')),
        exame:         this._limparPrefixoExame(pega(row, 'modulo')),
        valor_repasse: valor,
        pendente,
        particular:    0,
      });
    }
    return linhas;
  },

  // ─────────────────────────────────────────────────────────────────────
  // PARSE — MÉDICO LAUDISTA EXTERNO
  // Cabeçalho na linha 1:
  //   ADMISSAO | NOME | EXAME | MÉDICO | VALOR DE REPASSE | OBSERVAÇÃO
  // ─────────────────────────────────────────────────────────────────────
  _parseExterno(sheet) {
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    const linhas = [];

    const idxHeader = aoa.findIndex(row =>
      row.length >= 4 &&
      String(row[0] || '').trim().toUpperCase().includes('ADMIS') &&
      String(row[1] || '').trim().toUpperCase().includes('NOME')
    );
    if (idxHeader < 0) return [];

    let ordem = 0;
    for (let i = idxHeader + 1; i < aoa.length; i++) {
      const row = aoa[i];
      const admissao = String(row[0] || '').trim();

      if (admissao.toUpperCase() === 'TOTAL') continue;
      if (!admissao) continue;

      const obs = this._normalizarTexto(row[5]);
      const particular = (obs && obs.toUpperCase() === 'PARTICULAR') ? 1 : 0;

      // Detecta pendência: "LANÇAR", "VERIFICAR/LANÇAR", "VERIFICAR", "A LANÇAR"
      const valorRaw = String(row[4] || '').trim().toUpperCase();
      let valor = 0;
      let pendente = 0;
      if (/LAN[ÇC]AR|VERIFICAR/i.test(valorRaw)) {
        pendente = 1;
        valor = 0;
      } else {
        valor = this._numero(row[4], 0);
      }

      linhas.push({
        categoria:     'EXTERNO',
        ordem:         ++ordem,
        admissao,
        paciente:      this._normalizarNome(row[1]),
        exame:         this._normalizarTexto(row[2]),  // já vem sem prefixo aqui
        medico:        this._normalizarNome(row[3]),
        valor_repasse: valor,
        observacao:    obs || null,
        pendente,
        particular,
      });
    }
    return linhas;
  },

  // ─────────────────────────────────────────────────────────────────────
  // HELPERS de normalização
  // ─────────────────────────────────────────────────────────────────────
  _normalizarTexto(v) {
    if (v == null || v === '') return null;
    return String(v).trim().replace(/\s+/g, ' ');
  },

  _normalizarNome(v) {
    if (v == null || v === '') return null;
    return String(v).trim().replace(/\s+/g, ' ').toUpperCase();
  },

  _normalizarData(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) {
      const ano = v.getFullYear();
      const mes = String(v.getMonth() + 1).padStart(2, '0');
      const dia = String(v.getDate()).padStart(2, '0');
      return `${ano}-${mes}-${dia}`;
    }
    // String em vários formatos possíveis
    const s = String(v).trim();
    // 2026-04-13 ou 2026-04-13 00:00:00
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    // 13/04/2026
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    return null;
  },

  _numero(v, padrao = 0) {
    if (v == null || v === '') return padrao;
    if (typeof v === 'number') return v;
    let s = String(v).replace(/[R$\s\u00A0]/g, '').trim();
    if (!s) return padrao;

    // Detecta formato BR vs US olhando a presença de vírgula:
    //   - Tem vírgula  → formato BR: ponto = milhar, vírgula = decimal
    //   - Sem vírgula  → assume formato US ou número simples: ponto = decimal
    if (s.includes(',')) {
      s = s.replace(/\./g, '').replace(',', '.');
    }
    // (sem else: mantém o ponto como decimal)

    const n = Number(s);
    return Number.isFinite(n) ? n : padrao;
  },

  /** Remove prefixos "LAUDO -", "<UNIDADE> - Laudo", etc do nome do exame */
  _limparPrefixoExame(v) {
    if (!v) return null;
    let s = String(v).trim().toUpperCase();
    s = s.replace(/^LAUDO\s*-\s*/, '');
    s = s.replace(/^[A-Z]{2,8}\s*-\s*LAUDO\s*/, '');   // "CBV - Laudo", "HXX - Laudo"… — o prefixo é o da unidade, qualquer uma
    s = s.replace(/^LAUDO\s+/, '');
    return s.trim();
  },

  // ─────────────────────────────────────────────────────────────────────
  // Persiste no banco — apaga competência anterior antes de inserir
  // ─────────────────────────────────────────────────────────────────────
  _persistir(competencia, linhas) {
    Banco.db.exec('BEGIN');
    try {
      Banco.executar('DELETE FROM laudos WHERE competencia = ?', [competencia]);

      const sql = `INSERT INTO laudos
        (competencia, categoria, ordem, medico, exame, valor_repasse,
         unidade, convenio, quantidade, valor_unitario,
         admissao, data_admissao, cod_paciente, paciente, fluxo, modulo,
         observacao, pendente, particular)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      // V491: statement preparado UMA vez e reutilizado — Banco.executar
      // re-preparava o INSERT (+ um SELECT last_insert_rowid extra) por linha.
      const stmt = Banco.db.prepare(sql);
      try {
      for (const l of linhas) {
        stmt.run([
          l.competencia,
          l.categoria,
          l.ordem,
          l.medico,
          l.exame,
          l.valor_repasse || 0,
          l.unidade || null,
          l.convenio || null,
          l.quantidade || 1,
          l.valor_unitario || null,
          l.admissao || null,
          l.data_admissao || null,
          l.cod_paciente || null,
          l.paciente || null,
          l.fluxo || null,
          l.modulo || null,
          l.observacao || null,
          l.pendente || 0,
          l.particular || 0,
        ]);
      }
      } finally {
        try { stmt.free(); } catch (_) {}   // V491
      }
      Banco.db.exec('COMMIT');
    } catch (e) {
      Banco.db.exec('ROLLBACK');
      throw e;
    }
  },
};

window.ImportadorLaudos = ImportadorLaudos;
