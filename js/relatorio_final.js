/*
 * ============================================================================
 * ATLAS v1.3 — RELATÓRIO FINAL: o que o MÉDICO de fato recebeu
 * ============================================================================
 *
 * A ferramenta inteira converge no módulo Relatórios: Importar Sistema →
 * Calcular (Base Tabela) → Auditoria (papéis que o sistema não trouxe) →
 * fichários de Desempenho → Consolidado. Isso é o "DEVERIA ter sido pago".
 *
 * O RELATÓRIO FINAL é o outro lado da conta: o arquivo que o médico recebeu
 * para emitir a nota — um por médico × mês de PAGAMENTO. Antes de abril/2026
 * ele era feito à mão (dois layouts manuais); depois, é o .xlsx que a própria
 * ferramenta exporta por médico (Relatórios › Exportar › por médico).
 *
 * Esta aba lê esses arquivos (vários de uma vez, sem travar), guarda no banco
 * (viaja com o .db) e faz a AUDITORIA: confronta, por médico e por mês, o que
 * o Consolidado manda pagar com o que o relatório final pagou, admissão por
 * admissão, papel por papel — e diz O QUE FALTA PAGAR ao médico.
 *
 * OS LAYOUTS REAIS (arquivos do hospital, guardados anonimizados em
 * test/fixtures/relatorio_final/ — a suíte lê os quatro):
 *   1. manual SEM admissão ("FEVEREIRO2025 - DURVAL.xlsx"): aba com o nome do
 *      médico; r2 "CBV - Centro Brasileiro da Visão"; r3 "Acerto Médico:" …
 *      "Saldo relatório" <total>; r4 "Pagamentos liberados entre dd/mm/aaaa e
 *      dd/mm/aaaa"; r5 cabeçalho Sistema | Médico | CONVENIO | PAPEL |
 *      PROCEDIMENTO | DATA | PACIENTE | REPASSADO. Sistema = Medical/Qvis;
 *      CONVENIO = Convênio/Particular (o TIPO); PAPEL = Md, Encaminh,
 *      MEDICO, CIRURGIAO, SOLICITANTE, Auxiliar, AUXILIAR 1/2; DATA = data
 *      da ADMISSÃO (Date, às vezes com hora); a planilha declara 1 milhão
 *      de linhas (dimensão inflada — ler com sheetRows e encolher o !ref).
 *   2. manual COM admissão ("OUTUBRO2025 - DURVAL.xlsx", 26 MB, 1 milhão de
 *      linhas declaradas): aba Planilha1; r3 "Acerto Médico:" … "VALOR
 *      EMISSÃO NOTA FISCAL" <total>; r4 "Pagamentos liberados entre …";
 *      r5 Sistema | Médico | Recebimento | Admissão/ CPS | Papel |
 *      Procedimento | Data | Paciente | Repassado. Recebimento = NOME do
 *      convênio ("GEAP (DF)") ou PARTICULAR; admissão de 8 dígitos (QVIS)
 *      ou 7 (Medical).
 *   3. manual COM admissão, 2ª grafia ("DEZEMBRO2025 - DURVAL.xlsx"): r1
 *      "CBV…"; r2 "Acerto" … "VALOR EMISSÃO DE NOTA" <total>; r3
 *      "Pagamentos liberados entre …"; r4 SISTEMA | MÉDICO | RECEBIMENTO |
 *      ADMISSÃO | PAPEL | PROCEDIMENTO | DATA | PACIENTE | REPASSADO.
 *      Sistema = QVIS/MEDICAL/ESTORNO/"DESEMPENHO / ADICIONAL"; a linha de
 *      ESTORNO tem "ESTORNO" na admissão e no papel e valor NEGATIVO; o
 *      auxiliar do sistema antigo vem como EXECUTANTE com o procedimento
 *      "… - MÉDICO AUXILIAR SISTEMA ANTIGO".
 *   4. o EXPORT DA FERRAMENTA ("MAIO2026 - DURVAL.xlsx"): aba Repasse; r2
 *      "RELATÓRIO DE REPASSE MÉDICO"; r4 "Competência: ABRIL / 2026 ·
 *      Emitido em 31/05/2026"; r6 "EMITA SUA NOTA NESTE VALOR ="; r8
 *      STATUS | MÓDULO | ADMISSÃO | DATA | PAPEL | PROFISSIONAL | ORIGEM |
 *      CONVÊNIO | PACIENTE | DESCRIÇÃO | REPASSE. Status = QVIS/Ajustes/
 *      Desempenho/GLOSA; Módulo = Repasse/LIO/OPME (OPME sem descrição);
 *      Papel = Executante/Indicante/Auxiliar/Solicitante/CIRURGIAO; datas em
 *      texto dd/mm/aaaa. ATENÇÃO: "Competência: ABRIL" é a competência
 *      contábil; o arquivo é o de MAIO (nome) e tem admissões de maio — o
 *      mês vale pelos DADOS (ver competenciaPelosDados) antes do texto.
 *
 * Regras de leitura (validadas nas três gerações de layout do hospital):
 *   · nunca deduplicar — a soma das linhas é o valor da nota; linhas repetidas
 *     e NEGATIVAS (estornos) são legítimas e contam;
 *   · GLOSA vale zero no confronto (glosa = 1, valor guardado só para leitura);
 *   · competência = mês do pagamento: vem do cabeçalho do arquivo
 *     ("Pagamentos liberados entre dd/mm/aaaa e dd/mm/aaaa" → mês final;
 *     "Competência: ABRIL / 2026"; "mm/aaaa"), do nome do arquivo
 *     (Relatorio_<MÉDICO>_<AAAA-MM>…) ou do nome da aba ("Repasse AAAA-MM");
 *     sem nada disso, pergunta na importação;
 *   · médico = o valor mais frequente da coluna Profissional/Médico, resolvido
 *     pelo de-para (nome oficial); na falta, o nome do arquivo ou o cabeçalho;
 *   · layout sem coluna de admissão (manual, 1ª geração) → a admissão é
 *     resolvida por PACIENTE + DATA na produção analítica e no sistema.
 *
 * Categorias do confronto (falta = o que somar na cobrança):
 *   conforme        deveria = recebido
 *   a_menor         recebido < deveria                       → falta a diferença
 *   nao_pago        papel devido sem linha no relatório      → falta o valor
 *   nao_consta      admissão devida sem NENHUMA linha final  → falta tudo
 *   regra_nao_paga  linha do sistema com regra na Base Tabela e sem pagamento
 *                   em lugar nenhum (nem Consolidado, nem final) → falta
 *   a_maior         recebido > deveria                       (informativo)
 *   sem_lastro      recebido sem par no Consolidado          (informativo)
 *   glosa           glosado — vale zero                      (informativo)
 *   estorno         linha negativa sem par positivo          (informativo)
 *   aguardando      produzido e ainda não recebido do convênio (informativo)
 *
 * ATLAS v1.3.2 — O RELATÓRIO FINAL DA PRÓPRIA FERRAMENTA. Desde abril/2026 o
 * relatório que o médico recebe é o export desta ferramenta: o Consolidado do
 * mês. A partir do mês configurado (config_sistema →
 * RELATORIO_FINAL_FERRAMENTA_DESDE, padrão 2026-04) não é preciso importar
 * arquivo: o Consolidado de cada mês calculado vale como "recebido" (relatório
 * VIRTUAL, id 'f|AAAA-MM'), o que está nele conta como PAGO, e a auditoria
 * desses meses cobra o que o sistema recebeu com regra na Base Tabela e ficou
 * sem pagamento (regra_nao_paga). Arquivo importado do mesmo médico × mês
 * vence o virtual. E linha do Consolidado de um mês SEM relatório (nem arquivo,
 * nem virtual) nunca é dívida: vira 'sem_relatorio', informativa — sem o
 * relatório daquele mês a ATLAS não pode afirmar que faltou.
 *
 * Módulo GLOBAL: window.AtlasRelatorioFinal — montar(container) desenha a aba;
 * linhasDaAdmissao/confrontoDaAdmissao alimentam o 4º painel da Inspeção.
 * Depende de js/inspecao.js (AtlasInspecao._interno) e, para o "deveria", de
 * AtlasRelatorios.linhasCompletasComp e AtlasCalcular.calcularESalvar.
 * ============================================================================
 */
(function () {
  'use strict';

  const I = () => (window.AtlasInspecao && window.AtlasInspecao._interno) || {};
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (n) => Utilidades.formatarNumero(Number(n) || 0, 2);
  const norm = (s) => Utilidades.normalizar(s);
  const tick = () => new Promise(r => setTimeout(r, 0));
  const normAdm = (x) => (I().normAdm ? I().normAdm(x) : String(x == null ? '' : x).replace(/\D/g, '').replace(/^0+/, ''));
  const normNome = (x) => (I().normNome ? I().normNome(x) : norm(x));
  const normData = (x) => (I().normData ? I().normData(x) : '');
  const dataBR = (iso) => (I().dataBR ? I().dataBR(iso) : String(iso || ''));

  /**
   * As libs de planilha carregam ~1,5 s depois do boot (app.js, V589). Quem
   * chega aqui antes disso espera por elas em vez de falhar.
   */
  const _libs = {};
  function garantirLib(global, src) {
    if (window[global]) return Promise.resolve(window[global]);
    if (_libs[global]) return _libs[global];
    _libs[global] = new Promise((resolve, reject) => {
      const t0 = Date.now();
      const espera = () => {
        if (window[global]) return resolve(window[global]);
        if (Date.now() - t0 > 20000) return reject(new Error(`Biblioteca ${global} não carregou (${src})`));
        setTimeout(espera, 120);
      };
      if (![...document.scripts].some(sc => (sc.getAttribute('src') || '') === src)) {
        const sc = document.createElement('script');
        sc.src = src;
        sc.onerror = () => reject(new Error(`Não consegui carregar ${src}`));
        document.head.appendChild(sc);
      }
      espera();
    });
    return _libs[global];
  }
  const garantirXLSX = () => garantirLib('XLSX', 'libs/xlsx.full.min.js');
  const garantirExcelJS = () => garantirLib('ExcelJS', 'libs/exceljs.min.js');

  const CATEGORIAS = {
    conforme:       { rotulo: 'Conforme',                     soma: false, tom: 'ok' },
    a_menor:        { rotulo: 'Pago a menor',                 soma: true,  tom: 'falta' },
    nao_pago:       { rotulo: 'Papel não pago',               soma: true,  tom: 'falta' },
    nao_consta:     { rotulo: 'Não consta no relatório final', soma: true, tom: 'falta' },
    regra_nao_paga: { rotulo: 'Com regra e sem pagamento',    soma: true,  tom: 'falta' },
    a_maior:        { rotulo: 'Pago a maior',                 soma: false, tom: 'aviso' },
    sem_lastro:     { rotulo: 'Recebido sem lastro',          soma: false, tom: 'aviso' },
    glosa:          { rotulo: 'Glosa (vale zero)',            soma: false, tom: 'info' },
    estorno:        { rotulo: 'Estorno',                      soma: false, tom: 'info' },
    aguardando:     { rotulo: 'Aguardando convênio',          soma: false, tom: 'info' },
    sem_relatorio:  { rotulo: 'Pago no Consolidado (sem relatório final do mês)', soma: false, tom: 'info' },
    adicional:      { rotulo: 'Adicional do LIO (fora da cobrança)',  soma: false, tom: 'info' },
    desempenho:     { rotulo: 'Pago por módulo de desempenho',        soma: false, tom: 'info' },
  };
  const CATS_FALTA = Object.keys(CATEGORIAS).filter(k => CATEGORIAS[k].soma);

  // ──────────────────────────────────────────────────────────────────────
  // LEITURA DO ARQUIVO
  // ──────────────────────────────────────────────────────────────────────
  const ALIASES = {
    admissao:     ['ADMISSAO', 'ADMISSAO CPS', 'COD ADMISSAO', 'CODIGO ADMISSAO', 'N ADMISSAO', 'NUM ADMISSAO',
                   'NRO ADMISSAO', 'NUMERO ADMISSAO', 'ATENDIMENTO', 'CPS', 'ADM', 'N ATENDIMENTO'],
    data:         ['DATA', 'DATA ADMISSAO', 'DT ADMISSAO', 'DATA ATENDIMENTO', 'DT', 'DATA ADM', 'DATA DO ATENDIMENTO'],
    papel:        ['PAPEL', 'FUNCAO', 'TIPO PROFISSIONAL', 'PARTICIPACAO', 'PAPEL DO MEDICO', 'ATUACAO'],
    profissional: ['PROFISSIONAL', 'MEDICO', 'NOME PROFISSIONAL', 'NOME DO PROFISSIONAL', 'PRESTADOR',
                   'NOME MEDICO', 'NOME DO MEDICO', 'MEDICO PROFISSIONAL'],
    paciente:     ['PACIENTE', 'NOME PACIENTE', 'NOME DO PACIENTE'],
    procedimento: ['DESCRICAO', 'PROCEDIMENTO', 'DESCRICAO PROCEDIMENTO', 'DESCRICAO DO PROCEDIMENTO', 'PRODUTO',
                   'ITEM', 'SERVICO', 'EXAME PROCEDIMENTO'],
    valor:        ['VALOR REPASSE', 'REPASSADO', 'REPASSE', 'VALOR REPASSADO', 'VALOR RECEBIDO', 'RECEBIDO',
                   'VALOR PAGO', 'VALOR', 'VALOR LIQUIDO', 'VALOR R$', 'VLR REPASSE', 'VLR', 'TOTAL', 'HONORARIO PAGO'],
    status:       ['STATUS', 'SISTEMA', 'SITUACAO', 'ESTADO'],
    modulo:       ['MODULO', 'FICHARIO'],
    origem:       ['ORIGEM', 'RECEBIMENTO', 'TIPO RECEBIMENTO', 'TIPO DE RECEBIMENTO', 'FONTE', 'FONTE PAGADORA'],
    convenio:     ['CONVENIO', 'PLANO', 'OPERADORA'],
  };
  const ALIAS_CAMPO = new Map();
  for (const campo of Object.keys(ALIASES)) for (const a of ALIASES[campo]) if (!ALIAS_CAMPO.has(a)) ALIAS_CAMPO.set(a, campo);

  const MESES = { JANEIRO: '01', FEVEREIRO: '02', MARCO: '03', ABRIL: '04', MAIO: '05', JUNHO: '06', JULHO: '07',
    AGOSTO: '08', SETEMBRO: '09', OUTUBRO: '10', NOVEMBRO: '11', DEZEMBRO: '12',
    JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12' };

  /** 'dd/mm/aaaa' | 'aaaa-mm-dd' | Date | serial → 'AAAA-MM' */
  function mesDe(v) {
    const iso = normData(v);
    return iso ? iso.slice(0, 7) : '';
  }
  function compDeTexto(txt) {
    const t = String(txt || '');
    let m = t.match(/pagamentos?\s+liberados?\s+(?:entre|de)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(?:e|a|at[ée])\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (m) return { competencia: mesDe(m[2]), periodo_ini: normData(m[1]), periodo_fim: normData(m[2]) };
    m = t.match(/compet[êe]ncia\s*:?\s*([A-Za-zçÇ]+)\s*(?:\/|de|-)?\s*(\d{4})/i);
    if (m) { const mm = MESES[norm(m[1])]; if (mm) return { competencia: `${m[2]}-${mm}` }; }
    m = t.match(/compet[êe]ncia\s*:?\s*(\d{1,2})\s*\/\s*(\d{4})/i);
    if (m) return { competencia: `${m[2]}-${String(m[1]).padStart(2, '0')}` };
    m = t.match(/compet[êe]ncia\s*:?\s*(\d{4})-(\d{2})/i);
    if (m) return { competencia: `${m[1]}-${m[2]}` };
    m = t.match(/m[êe]s\s*(?:de\s+)?(?:pagamento|refer[êe]ncia|repasse)?\s*:?\s*(\d{1,2})\s*\/\s*(\d{4})/i);
    if (m) return { competencia: `${m[2]}-${String(m[1]).padStart(2, '0')}` };
    m = t.match(/m[êe]s\s*(?:de\s+)?(?:pagamento|refer[êe]ncia|repasse)?\s*:?\s*([A-Za-zçÇ]+)\s*(?:\/|de|-)\s*(\d{4})/i);
    if (m) { const mm = MESES[norm(m[1])]; if (mm) return { competencia: `${m[2]}-${mm}` }; }
    return null;
  }
  function compDoNome(nome) {
    const s = String(nome || '');
    let m = s.match(/(\d{4})[-_.](\d{2})(?!\d)/);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2]}`;
    m = s.match(/(?<!\d)(\d{2})[-_.](\d{4})(?!\d)/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1]}`;
    // "MAIO2026 - DURVAL", "Fevereiro_2025", "DEZ 2025"
    m = norm(s).match(/\b(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO|JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s?(\d{4})\b/);
    if (m && MESES[m[1]]) return `${m[2]}-${MESES[m[1]]}`;
    return '';
  }
  /** Tipo da fonte pagadora a partir de um texto ('' quando é o NOME do convênio) */
  function catOrigem(v) {
    const n = norm(v);
    if (!n) return '';
    if (n.startsWith('CONV')) return 'CONVENIO';
    if (n.startsWith('PART')) return 'PARTICULAR';
    if (n === 'SUS') return 'SUS';
    return '';
  }
  /** Última linha com valor de uma aba (as planilhas do hospital declaram 1 milhão de linhas) */
  function ultimaLinhaComValor(ws) {
    let max = -1;
    for (const k of Object.keys(ws)) {
      if (k[0] === '!') continue;
      const c = XLSX.utils.decode_cell(k);
      if (c.r > max) max = c.r;
    }
    return max;
  }
  function encolherRef(ws) {
    if (!ws || !ws['!ref']) return;
    let maxR = -1, maxC = 0;
    for (const k of Object.keys(ws)) {
      if (k[0] === '!') continue;
      const c = XLSX.utils.decode_cell(k);
      if (c.r > maxR) maxR = c.r;
      if (c.c > maxC) maxC = c.c;
    }
    if (maxR >= 0) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  }
  const TETO_LINHAS = 4000;
  /**
   * Lê o workbook em DUAS passadas: primeiro só as 4.000 primeiras linhas
   * (os relatórios reais têm < 1.000; as planilhas do hospital declaram 1
   * milhão de linhas vazias e a leitura completa leva 6-14 s); se alguma aba
   * encostou no teto com dados, relê inteira.
   */
  function lerWorkbook(buf) {
    let wb = XLSX.read(buf, { type: 'array', cellDates: true, sheetRows: TETO_LINHAS });
    const encostou = wb.SheetNames.some(n => ultimaLinhaComValor(wb.Sheets[n]) >= TETO_LINHAS - 10);
    if (encostou) wb = XLSX.read(buf, { type: 'array', cellDates: true });
    for (const n of wb.SheetNames) encolherRef(wb.Sheets[n]);
    return wb;
  }
  function medicoDoNome(nome) {
    const s = String(nome || '').replace(/\.(xlsx|xlsm|xls|csv)$/i, '');
    let m = s.match(/^relat[oó]rio[_ \-]+(.+?)[_ \-]+\d{4}[-_]\d{2}/i);
    if (m) return m[1].replace(/_/g, ' ').trim();
    m = s.match(/^(?:dr[a]?\.?\s+)?(.+?)[_ \-]+\d{4}[-_]\d{2}/i);
    if (m && /[A-Za-z]{3,}/.test(m[1]) && !/^(repasse|relatorio|final)$/i.test(m[1].trim())) return m[1].replace(/_/g, ' ').trim();
    return '';
  }
  /** abreviaturas dos layouts manuais → papel que o de-para de papéis conhece */
  function papelBruto(p) {
    const n = normNome(p);
    if (!n) return '';
    if (n === 'MD' || n === 'MED' || n === 'EXEC' || n === 'EXECUTANTE' || n === 'CIRURGIAO' || n === 'CIRURGIA') return 'EXECUTANTE';
    if (/^ENCAMINH/.test(n) || n === 'INDICADOR') return 'INDICANTE';
    if (/^AUX/.test(n)) return 'AUXILIAR';
    if (/LAUDO|LAUDISTA/.test(n)) return 'MEDICO LAUDO';
    if (/^SOLIC/.test(n)) return 'SOLICITANTE';
    return String(p || '').trim();
  }
  function papelCanon(p) {
    const b = papelBruto(p);
    return I().papelCanonico ? I().papelCanonico(b) : normNome(b);
  }
  function nomeOficial(nome) {
    return I().nomeOficialMedico ? I().nomeOficialMedico(nome) : String(nome || '').trim();
  }
  function ehTotalRow(cells) {
    const primeira = cells.find(c => String(c == null ? '' : c).trim() !== '');
    return /^(total|sub\s*total|soma|totais)\b/i.test(String(primeira == null ? '' : primeira).trim());
  }

  /**
   * Lê UM arquivo → { meta, linhas, avisos }. Varre todas as abas e fica com
   * a primeira que tem cabeçalho reconhecível (procedimento + valor + 1).
   */
  async function lerArquivo(arquivo) {
    await garantirXLSX();
    const buf = await arquivo.arrayBuffer();
    const wb = lerWorkbook(buf);
    const avisos = [];
    let escolhida = null;
    for (const nomeAba of wb.SheetNames) {
      const ws = wb.Sheets[nomeAba];
      if (!ws || !ws['!ref']) continue;
      const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
      const cab = acharCabecalho(matriz);
      if (!cab) continue;
      escolhida = { nomeAba, matriz, cab };
      break;
    }
    if (!escolhida) throw new Error('Não reconheci o layout: preciso de colunas de procedimento/descrição e de valor/repasse');
    const { nomeAba, matriz, cab } = escolhida;
    const mapa = cab.mapa;   // campo → índice
    const layout = mapa.status != null && mapa.modulo != null && mapa.admissao != null ? 'ferramenta'
      : (mapa.admissao != null ? 'manual2' : 'manual1');

    // texto informativo acima do cabeçalho (competência, período, médico)
    const textos = [];
    for (let i = 0; i < cab.linha; i++) for (const c of matriz[i] || []) if (c != null && String(c).trim()) textos.push(String(c));
    let meta = { competencia: '', periodo_ini: '', periodo_fim: '', medico: '', layout, arquivo: arquivo.name, aba: nomeAba };
    // ATLAS v1.3.1: ordem de confiança do MÊS — o período dos pagamentos
    // ("Pagamentos liberados entre …"), depois o NOME do arquivo (MAIO2026),
    // depois o texto "Competência: ABRIL / 2026" (é a competência contábil, um
    // mês antes do pagamento no export da ferramenta), depois o nome da aba.
    // Os DADOS (competenciaPelosDados, na importação) mandam acima de tudo.
    const achados = textos.map(compDeTexto).filter(Boolean);
    const periodo = achados.find(c => c.periodo_fim);
    const textoComp = achados.find(c => !c.periodo_fim);
    if (periodo) { meta.periodo_ini = periodo.periodo_ini; meta.periodo_fim = periodo.periodo_fim; }
    meta.competenciaTexto = textoComp ? textoComp.competencia : '';
    meta.competencia = (periodo && periodo.competencia) || compDoNome(arquivo.name) || meta.competenciaTexto || compDoNome(nomeAba) || '';
    for (const t of textos) {
      const m = String(t).match(/m[ée]dico\s*:?\s*(.{4,})/i);
      if (m && !/^\s*(nome|profissional)/i.test(m[1])) { meta.medicoTexto = m[1].trim(); break; }
    }

    const linhas = [];
    const contagemMed = new Map();
    for (let i = cab.linha + 1; i < matriz.length; i++) {
      const row = matriz[i] || [];
      const cel = (campo) => (mapa[campo] == null ? '' : row[mapa[campo]]);
      const txt = (campo) => { const v = cel(campo); return v == null ? '' : (v instanceof Date ? normData(v) : String(v).trim()); };
      if (!row.some(c => c != null && String(c).trim() !== '')) continue;
      if (ehTotalRow(row)) continue;
      const procedimento = txt('procedimento');
      const paciente = txt('paciente');
      const admissaoRaw = txt('admissao').replace(/\.0+$/, '');
      const admissaoNorm = /\d/.test(admissaoRaw) ? normAdm(admissaoRaw) : '';   // "ESTORNO" não é admissão
      const valorRaw = cel('valor');
      const valor = Utilidades.parseNumBR(valorRaw, null);
      if (!procedimento && !paciente && !admissaoRaw) continue;   // linha decorativa
      if (valor == null && !procedimento) continue;
      const status = txt('status');
      let papel = txt('papel');
      // o auxiliar do sistema antigo vem como EXECUTANTE com o papel no texto
      if (/M[EÉ]DICO\s+AUXILIAR/i.test(procedimento) && /^(EXEC|MD|MED|CIRUR)/.test(normNome(papel))) papel = 'AUXILIAR';
      let origem = txt('origem');
      let convenio = txt('convenio');
      // "Recebimento"/"CONVENIO" trazem ora o TIPO (Convênio/Particular), ora o
      // NOME do convênio ("GEAP (DF)") — separa os dois
      const catO = catOrigem(origem), catC = catOrigem(convenio);
      if (origem && !catO) { if (!convenio) convenio = origem; origem = /estorno/i.test(status) ? '' : 'CONVENIO'; }
      else if (catO) origem = catO;
      if (!origem && catC) { origem = catC; convenio = ''; }
      const prof = txt('profissional');
      if (prof) { const k = normNome(prof); contagemMed.set(k, (contagemMed.get(k) || { nome: prof, n: 0 })); contagemMed.get(k).n++; }
      const glosa = /glosa/i.test(status) ? 1 : 0;
      linhas.push({
        admissao: admissaoRaw, admissao_norm: admissaoNorm,
        data: normData(cel('data')), paciente, paciente_norm: normNome(paciente),
        papel, papel_canon: papelCanon(papel),
        procedimento, procedimento_norm: normNome(procedimento),
        valor: Number(valor) || 0, status, modulo: txt('modulo'), origem, convenio, glosa,
        medico: prof, linha_origem: i + 1,
      });
    }
    if (!linhas.length) throw new Error('Cabeçalho reconhecido, mas nenhuma linha de dados');

    // médico do arquivo: a coluna manda (valor mais frequente), depois o nome
    // do arquivo, depois o cabeçalho, depois o nome da aba
    let medico = '';
    if (contagemMed.size) {
      const ordenados = [...contagemMed.values()].sort((a, b) => b.n - a.n);
      medico = ordenados[0].nome;
      if (ordenados.length > 1 && ordenados[1].n >= ordenados[0].n * 0.5) {
        avisos.push(`Mais de um profissional no arquivo (${ordenados.slice(0, 3).map(o => `${o.nome} ×${o.n}`).join(', ')}) — ficou o mais frequente`);
      }
    }
    if (!medico) medico = medicoDoNome(arquivo.name) || meta.medicoTexto || '';
    if (!medico && !/^(repasse|planilha|sheet|plan)\b/i.test(nomeAba) && !/\d{4}-\d{2}/.test(nomeAba)) medico = nomeAba;
    meta.medicoBruto = medico;
    meta.medico = medico ? nomeOficial(medico) : '';
    meta.n_linhas = linhas.length;
    meta.total = linhas.reduce((s, l) => s + (l.glosa ? 0 : l.valor), 0);
    return { meta, linhas, avisos };
  }

  function acharCabecalho(matriz) {
    const max = Math.min(matriz.length, 60);
    for (let i = 0; i < max; i++) {
      const row = matriz[i] || [];
      const mapa = {};
      let n = 0;
      row.forEach((c, idx) => {
        const campo = ALIAS_CAMPO.get(norm(c));
        if (campo && mapa[campo] == null) { mapa[campo] = idx; n++; }
      });
      if (n >= 3 && mapa.procedimento != null && mapa.valor != null) return { linha: i, mapa };
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // EM QUE MÊS O SISTEMA PAGOU ESSAS ADMISSÕES? (a competência pelos dados)
  // ──────────────────────────────────────────────────────────────────────
  /** admissões (normalizadas) → Set de meses de pagamento em linhas_qvis */
  function mesesDasAdmissoes(adms) {
    const mapa = new Map();
    const variantes = I().variantesAdm || ((a) => [a]);
    const lista = [...new Set((adms || []).map(normAdm).filter(Boolean))];
    for (let i = 0; i < lista.length; i += 120) {
      const lote = lista.slice(i, i + 120);
      const vars = [...new Set(lote.flatMap(variantes))];
      try {
        for (const r of Banco.query(
          `SELECT DISTINCT admissao, mes_pagamento FROM linhas_qvis
            WHERE admissao IN (${vars.map(() => '?').join(',')}) AND mes_pagamento IS NOT NULL AND mes_pagamento <> ''`, vars) || []) {
          const k = normAdm(r.admissao);
          if (!mapa.has(k)) mapa.set(k, new Set());
          mapa.get(k).add(String(r.mes_pagamento));
        }
      } catch (e) {}
    }
    return mapa;
  }
  /**
   * O mês do relatório final é o mês em que a ferramenta tem essas admissões
   * pagas — o texto do arquivo ("Competência: ABRIL / 2026") pode ser a
   * competência contábil, um mês antes do pagamento. Decide quando ≥ 60% das
   * admissões encontradas no sistema estão num mesmo mês (e ao menos 20% do
   * relatório foi encontrado); null quando o sistema ainda não tem os dados.
   */
  function competenciaPelosDados(linhas) {
    const adms = [...new Set((linhas || []).map(l => l.admissao_norm).filter(Boolean))];
    if (!adms.length) return null;
    const onde = mesesDasAdmissoes(adms);
    const cont = new Map();
    let achadas = 0;
    for (const a of adms) {
      const comps = onde.get(a);
      if (!comps || !comps.size) continue;
      achadas++;
      for (const c of comps) cont.set(c, (cont.get(c) || 0) + 1);
    }
    if (!achadas || achadas < Math.max(5, adms.length * 0.2)) return null;
    const ordem = [...cont.entries()].sort((a, b) => b[1] - a[1]);
    const [melhor, n] = ordem[0];
    if (n < achadas * 0.6) return null;
    return { competencia: melhor, n, achadas, total: adms.length, pct: Math.round(100 * n / achadas),
      distribuicao: ordem.map(([c, k]) => ({ competencia: c, n: k })) };
  }
  const fmtComp = (c) => { const m = String(c || '').match(/^(\d{4})-(\d{2})$/); return m ? `${m[2]}/${m[1]}` : String(c || '—'); };

  // ──────────────────────────────────────────────────────────────────────
  // ADMISSÃO POR PACIENTE + DATA (layout manual sem coluna de admissão)
  // ──────────────────────────────────────────────────────────────────────
  function resolverAdmissoesPorPacienteData(linhas) {
    const pend = linhas.filter(l => !l.admissao_norm && l.paciente_norm && l.data);
    if (!pend.length) return 0;
    const datas = [...new Set(pend.map(l => l.data))];
    const porChave = new Map();
    const juntar = (sql, campoAdm, campoPac, campoData) => {
      for (let i = 0; i < datas.length; i += 200) {
        const lote = datas.slice(i, i + 200);
        try {
          for (const r of Banco.query(sql.replace('__IN__', lote.map(() => '?').join(',')), lote) || []) {
            const k = normNome(r[campoPac]) + '|' + normData(r[campoData]);
            if (!porChave.has(k)) porChave.set(k, String(r[campoAdm]));
          }
        } catch (e) {}
      }
    };
    juntar(`SELECT cod_admissao, paciente, data_admissao FROM linhas_producao WHERE substr(data_admissao, 1, 10) IN (__IN__)`, 'cod_admissao', 'paciente', 'data_admissao');
    juntar(`SELECT admissao, paciente, data_admissao FROM linhas_qvis WHERE substr(data_admissao, 1, 10) IN (__IN__)`, 'admissao', 'paciente', 'data_admissao');
    let n = 0;
    for (const l of pend) {
      const a = porChave.get(l.paciente_norm + '|' + l.data);
      if (a) { l.admissao = a; l.admissao_norm = normAdm(a); n++; }
    }
    return n;
  }

  // ──────────────────────────────────────────────────────────────────────
  // IMPORTAÇÃO EM LOTE (vários arquivos, sem travar)
  // ──────────────────────────────────────────────────────────────────────
  let _listaCache = { versao: -1, lista: null };
  function invalidar() { _listaCache = { versao: -1, lista: null }; _admCache = new Map(); _admCacheV = -1; }
  let _colunasOk = false;
  /** bancos gravados pela v1.3.0 não têm competencia_arquivo (a migração de banco.js também cobre) */
  function garantirColunas() {
    if (_colunasOk) return;
    try { Banco.db.exec(`ALTER TABLE relatorio_final ADD COLUMN competencia_arquivo TEXT`); } catch (e) {}
    _colunasOk = true;
  }

  async function importarArquivos(arquivos, opts) {
    opts = opts || {};
    const progresso = typeof opts.progresso === 'function' ? opts.progresso : () => {};
    const files = Array.from(arquivos || []).filter(Boolean);
    const lidos = [], erros = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      progresso({ fase: 'lendo', i, n: files.length, arquivo: f.name });
      await tick();
      try { lidos.push(Object.assign(await lerArquivo(f), { file: f })); }
      catch (e) { erros.push({ arquivo: f.name, erro: e.message || String(e) }); }
    }
    // a competência vale pelos DADOS: o mês em que o sistema pagou as admissões
    for (const l of lidos) {
      l.meta.competencia_arquivo = l.meta.competencia || '';
      try {
        resolverAdmissoesPorPacienteData(l.linhas);   // o layout sem admissão precisa disto antes
        const dados = competenciaPelosDados(l.linhas);
        if (dados && dados.competencia) {
          if (l.meta.competencia && l.meta.competencia !== dados.competencia) {
            l.avisos.push(`o arquivo indica ${fmtComp(l.meta.competencia)}, mas ${dados.pct}% das admissões encontradas no sistema estão em ${fmtComp(dados.competencia)} — importado como ${fmtComp(dados.competencia)}`);
          }
          l.meta.competencia = dados.competencia;
          l.meta.competenciaDados = dados;
        }
      } catch (e) { console.warn('[relatorio_final] competência pelos dados:', e); }
    }
    // o que ficou sem médico ou competência: pergunta (uma vez, para todos)
    const pend = lidos.filter(l => !l.meta.medico || !l.meta.competencia);
    let cancelados = [];
    if (pend.length) {
      const ok = opts.perguntar === false ? false : await pedirDados(pend);
      if (!ok) { cancelados = pend.map(l => l.meta.arquivo); }
    }
    const prontos = lidos.filter(l => l.meta.medico && l.meta.competencia);
    // ordem estável: o mesmo médico×mês repetido no lote → o último substitui
    const importados = [];
    for (let i = 0; i < prontos.length; i++) {
      const l = prontos[i];
      progresso({ fase: 'gravando', i, n: prontos.length, arquivo: l.meta.arquivo });
      await tick();
      try {
        const resolvidas = l.linhas.filter(x => x.admissao_norm).length && l.meta.layout === 'manual1'
          ? l.linhas.filter(x => x.admissao_norm).length : 0;
        const id = gravar(l);
        importados.push({ id, medico: l.meta.medico, competencia: l.meta.competencia, layout: l.meta.layout,
          arquivo: l.meta.arquivo, n_linhas: l.meta.n_linhas, total: l.meta.total, avisos: l.avisos,
          semAdmissao: l.linhas.filter(x => !x.admissao_norm).length, resolvidas });
      } catch (e) { erros.push({ arquivo: l.meta.arquivo, erro: e.message || String(e) }); }
    }
    invalidar();
    if (importados.length) Banco.salvarDebounced(2000);
    progresso({ fase: 'fim', n: importados.length });
    return { importados, erros, cancelados };
  }

  /** Grava um relatório lido (substitui o mesmo médico × competência). */
  function gravar(l) {
    const m = l.meta;
    const medNorm = normNome(m.medico);
    Banco.db.exec('BEGIN');
    try {
      // substitui o mesmo médico × mês E o mesmo ARQUIVO do médico (o mês pode
      // ter mudado entre duas importações — pelos dados — sem virar duplicata)
      const antigos = Banco.query(`SELECT id FROM relatorio_final WHERE medico_norm = ? AND (competencia = ? OR arquivo = ?)`,
        [medNorm, m.competencia, m.arquivo || '']) || [];
      for (const a of antigos) {
        Banco.db.run(`DELETE FROM relatorio_final_linhas WHERE relatorio_id = ?`, [a.id]);
        Banco.db.run(`DELETE FROM relatorio_final WHERE id = ?`, [a.id]);
      }
      garantirColunas();
      Banco.db.run(
        `INSERT INTO relatorio_final (medico, medico_norm, competencia, competencia_arquivo, layout, arquivo, periodo_ini, periodo_fim, n_linhas, total, importado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [m.medico, medNorm, m.competencia, m.competencia_arquivo || null, m.layout, m.arquivo, m.periodo_ini || null, m.periodo_fim || null, m.n_linhas, m.total]);
      const id = Banco.queryUnica(`SELECT last_insert_rowid() AS id`).id;
      const stmt = Banco.db.prepare(
        `INSERT INTO relatorio_final_linhas
           (relatorio_id, competencia, medico, medico_norm, admissao, admissao_norm, data, paciente, paciente_norm,
            papel, papel_canon, procedimento, procedimento_norm, valor, status, modulo, origem, convenio, glosa, linha_origem)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      try {
        for (const x of l.linhas) {
          stmt.run([id, m.competencia, m.medico, medNorm, x.admissao || '', x.admissao_norm || '', x.data || '',
            x.paciente || '', x.paciente_norm || '', x.papel || '', x.papel_canon || '', x.procedimento || '',
            x.procedimento_norm || '', Number(x.valor) || 0, x.status || '', x.modulo || '', x.origem || '',
            x.convenio || '', x.glosa ? 1 : 0, x.linha_origem || null]);
        }
      } finally { stmt.free(); }
      Banco.db.exec('COMMIT');
      return id;
    } catch (e) {
      try { Banco.db.exec('ROLLBACK'); } catch (_) {}
      throw e;
    }
  }

  function remover(id) {
    Banco.db.exec('BEGIN');
    try {
      Banco.db.run(`DELETE FROM relatorio_final_linhas WHERE relatorio_id = ?`, [id]);
      Banco.db.run(`DELETE FROM relatorio_final WHERE id = ?`, [id]);
      Banco.db.exec('COMMIT');
    } catch (e) { try { Banco.db.exec('ROLLBACK'); } catch (_) {} throw e; }
    invalidar();
    Banco.salvarDebounced(1500);
  }

  function listar() {
    const v = Banco._versao || 0;
    if (_listaCache.versao === v && _listaCache.lista) return _listaCache.lista;
    let lista = [];
    try {
      garantirColunas();
      lista = Banco.query(`SELECT * FROM relatorio_final ORDER BY competencia DESC, medico`) || [];
    } catch (e) { lista = []; }
    _listaCache = { versao: v, lista };
    return lista;
  }
  function linhasDoRelatorio(id) {
    const v = idVirtual(id);
    if (v) { try { return linhasVirtuais(v.comp, v.medNorm); } catch (e) { return []; } }
    try { return Banco.query(`SELECT * FROM relatorio_final_linhas WHERE relatorio_id = ? ORDER BY id`, [id]) || []; }
    catch (e) { return []; }
  }
  let _admCache = new Map(), _admCacheV = -1;
  function linhasDaAdmissao(adm) {
    const k = normAdm(adm);
    if (!k) return [];
    const v = Banco._versao || 0;
    if (_admCacheV !== v) { _admCache = new Map(); _admCacheV = v; }
    if (_admCache.has(k)) return _admCache.get(k);
    let rows = [];
    try {
      rows = Banco.query(`SELECT l.*, r.arquivo, r.layout FROM relatorio_final_linhas l
                            JOIN relatorio_final r ON r.id = l.relatorio_id
                           WHERE l.admissao_norm = ? ORDER BY l.competencia, l.id`, [k]) || [];
    } catch (e) { rows = []; }
    if (_admCache.size > 2000) _admCache = new Map();
    _admCache.set(k, rows);
    return rows;
  }
  function temRelatorio(medNorm, comp) {
    return listar().some(r => r.medico_norm === medNorm && r.competencia === comp);
  }

  // ──────────────────────────────────────────────────────────────────────
  // ATLAS v1.3.2: O RELATÓRIO FINAL DA PRÓPRIA FERRAMENTA (Consolidado)
  // ──────────────────────────────────────────────────────────────────────
  const DESDE_CHAVE = 'RELATORIO_FINAL_FERRAMENTA_DESDE';
  const DESDE_PADRAO = '2026-04';
  function desdeFerramenta() {
    try {
      const r = Banco.queryUnica(`SELECT valor FROM config_sistema WHERE chave = ?`, [DESDE_CHAVE]);
      const v = r && String(r.valor || '').trim();
      return /^\d{4}-\d{2}$/.test(v) ? v : DESDE_PADRAO;
    } catch (e) { return DESDE_PADRAO; }
  }
  function definirDesdeFerramenta(v) {
    v = String(v || '').trim();
    if (!/^\d{4}-\d{2}$/.test(v)) return false;
    try { Banco.executar(`INSERT OR REPLACE INTO config_sistema (chave, valor) VALUES (?, ?)`, [DESDE_CHAVE, v]); } catch (e) { return false; }
    Banco.salvarDebounced(1500);
    invalidar();
    return true;
  }
  // ATLAS v1.3.3: o MÉDICO AUDITADO — a auditoria é de um médico por vez. Os
  // meses da ferramenta usam só as linhas dele no Consolidado, e um relatório
  // importado de outro médico é avisado. Vazio = todos os médicos.
  const AUD_CHAVE = 'RELATORIO_FINAL_MEDICO_AUDITADO';
  function medicoAuditado() {
    try {
      const r = Banco.queryUnica(`SELECT valor FROM config_sistema WHERE chave = ?`, [AUD_CHAVE]);
      return r && r.valor ? String(r.valor).trim() : '';
    } catch (e) { return ''; }
  }
  function definirMedicoAuditado(nome) {
    const v = String(nome || '').trim();
    const oficial = v ? nomeOficial(v) : '';
    try { Banco.executar(`INSERT OR REPLACE INTO config_sistema (chave, valor) VALUES (?, ?)`, [AUD_CHAVE, oficial]); } catch (e) { return ''; }
    Banco.salvarDebounced(1500);
    return oficial;
  }
  /** médicos conhecidos: cadastro + os dos relatórios importados */
  function medicosConhecidos() {
    const set = new Map();
    try { for (const m of Banco.query(`SELECT nome_oficial FROM medicos WHERE ativo = 1 ORDER BY nome_oficial`) || []) if (m.nome_oficial) set.set(normNome(m.nome_oficial), m.nome_oficial); } catch (e) {}
    for (const r of listar()) if (r.medico && !set.has(r.medico_norm)) set.set(r.medico_norm, r.medico);
    return [...set.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
  /**
   * ATLAS v1.3.5: o mês é da ferramenta (o Consolidado É o relatório final que
   * o médico recebeu)? `compDaFerramenta` olha só a data — serve para quem já
   * tem as linhas do Consolidado em mãos (Inspeção). `mesDaFerramenta` também
   * exige o cálculo salvo — serve para LISTAR o mês na aba.
   */
  function compDaFerramenta(comp) {
    return !!comp && String(comp) >= desdeFerramenta();
  }
  function mesDaFerramenta(comp) {
    return compDaFerramenta(comp) && temSnapshot(comp);
  }
  /** meses calculados a partir do "desde" — os relatórios finais virtuais */
  function mesesDaFerramenta() {
    try {
      return (Banco.query(`SELECT competencia, n_linhas, total_repasse FROM repasse_snapshot WHERE competencia >= ? ORDER BY competencia DESC`, [desdeFerramenta()]) || [])
        .map(r => ({ id: 'f|' + r.competencia, virtual: true, competencia: String(r.competencia), competencia_arquivo: String(r.competencia),
          medico: 'todos os médicos do Consolidado', medico_norm: '', layout: 'ferramenta', arquivo: 'Consolidado da ferramenta',
          n_linhas: r.n_linhas || 0, total: Number(r.total_repasse) || 0, importado_em: '' }));
    } catch (e) { return []; }
  }
  function listarTodos() { return listar().concat(mesesDaFerramenta()); }
  // ATLAS v1.3.3: recorte do Consolidado de um mês pelo médico auditado
  // (linhas + total dele) — cache por versão do banco; cada mês é calculado
  // uma vez e só quando a lista pede (assíncrono, sem travar a aba)
  let _resumoAud = { versao: -1, medNorm: '', porComp: new Map() };
  function resumoDoMedicoNoMes(comp, medNorm) {
    const v = Banco._versao || 0;
    if (_resumoAud.versao !== v || _resumoAud.medNorm !== medNorm) _resumoAud = { versao: v, medNorm, porComp: new Map() };
    if (_resumoAud.porComp.has(comp)) return _resumoAud.porComp.get(comp);
    let n = 0, total = 0;
    for (const l of deveriaDaCompetencia(comp)) {
      if (medNormDeLinhaCons(l) !== medNorm) continue;
      n++;
      if (!/glosa/i.test(String(l.status || ''))) total += Number(l.valor) || 0;
    }
    const r = { n, total };
    _resumoAud.porComp.set(comp, r);
    return r;
  }
  /** há relatório final (arquivo ou o próprio Consolidado) para este médico neste mês? */
  function temRelatorioPara(medNorm, comp) {
    return temRelatorio(medNorm, comp) || compDaFerramenta(comp);   // ATLAS v1.3.5
  }
  /** linha do Consolidado → linha "recebida" virtual (mesma forma das linhas importadas) */
  function linhaVirtualDe(l, comp) {
    const medico = nomeOficial(l._medicoReal || l.profissional || '');
    const glosa = /glosa/i.test(String(l.status || ''));
    return { competencia: comp, medico, medico_norm: normNome(medico), admissao: String(l.admissao || '').trim(), admissao_norm: normAdm(l.admissao),
      data: normData(l.data), paciente: l.paciente || '', paciente_norm: normNome(l.paciente), papel: l.papel || '', papel_canon: papelCanon(l.papel),
      procedimento: String(l.descricao || '').trim(), procedimento_norm: normNome(l.descricao), valor: Number(l.valor) || 0,
      status: l.status || '', modulo: l.modulo || '', origem: l.origem || '', convenio: l.convenio || '', glosa: glosa ? 1 : 0,
      virtual: true, arquivo: 'Consolidado da ferramenta', layout: 'ferramenta' };
  }
  /**
   * ATLAS v1.3.5: item RECEBIDO virtual a partir de um item do "deveria" — a
   * linha do Consolidado daquele mês contando como paga (o Consolidado é o
   * relatório final do mês). Uma função só, para os dois caminhos da auditoria.
   */
  function recVirtualDeItem(it, comp) {
    const rv = itemRecebido(linhaVirtualDe({
      admissao: it.admissao, data: it.data, paciente: it.paciente, papel: it.papelRot || it.papel,
      descricao: it.procedimento, profissional: it.medico, status: it.status, modulo: it.modulo,
      origem: it.origem, convenio: it.convenio, valor: it.glosa ? 0 : it.valor,
    }, comp));
    rv.relatorio_id = null;
    return rv;
  }
  function linhasVirtuais(comp, medNorm) {
    const out = [];
    for (const l of deveriaDaCompetencia(comp)) {
      if (medNorm && medNormDeLinhaCons(l) !== medNorm) continue;
      out.push(linhaVirtualDe(l, comp));
    }
    return out;
  }
  /** id virtual 'f|AAAA-MM' (mês inteiro) ou 'f|AAAA-MM|medNorm' */
  function idVirtual(id) {
    const s = String(id || '');
    if (!s.startsWith('f|')) return null;
    const [, comp, medNorm] = s.split('|');
    return { comp, medNorm: medNorm || '' };
  }
  /** 4º painel da Inspeção: linhas importadas + as do Consolidado dos meses da ferramenta */
  function linhasFinaisDaAdmissao(adm, consolidado) {
    const importadas = linhasDaAdmissao(adm);
    const virtuais = [];
    // ATLAS v1.3.5: nos meses da ferramenta o Consolidado É o relatório final —
    // ele entra MESMO quando há arquivo importado do mesmo médico × mês (o
    // arquivo pode ser um recorte). A ferramenta não cobra o que ela mesma
    // mostra pago: a linha do arquivo vence no pareamento e a do Consolidado
    // só entra quando o arquivo não tem aquela linha.
    for (const r of consolidado || []) {
      if (!compDaFerramenta(r.competencia)) continue;
      const v = linhaVirtualDe(r.linha, r.competencia);
      const jaNoArquivo = importadas.some(l => l.medico_norm === v.medico_norm
        && (l.papel_canon || papelCanon(l.papel)) === v.papel_canon
        && mesmoExame(l.procedimento, v.procedimento));
      if (jaNoArquivo) continue;
      virtuais.push(v);
    }
    return importadas.concat(virtuais);
  }

  // ──────────────────────────────────────────────────────────────────────
  // PERGUNTA — médico / competência que o arquivo não disse
  // ──────────────────────────────────────────────────────────────────────
  function pedirDados(pendentes) {
    return new Promise((resolve) => {
      let medicos = [];
      try { medicos = (Banco.query(`SELECT nome_oficial FROM medicos WHERE ativo = 1 ORDER BY nome_oficial`) || []).map(m => m.nome_oficial); } catch (e) {}
      const ov = document.createElement('div');
      ov.className = 'rf-modal-ov';
      ov.innerHTML = `
        <div class="rf-modal" role="dialog" aria-modal="true">
          <div class="rf-modal-head"><strong>Complete o que o arquivo não disse</strong>
            <span>${pendentes.length} arquivo${pendentes.length > 1 ? 's' : ''} sem médico ou competência. Informe e importe — ou cancele só estes.</span></div>
          <datalist id="rf-dl-medicos">${medicos.map(m => `<option value="${esc(m)}"></option>`).join('')}</datalist>
          <div class="rf-modal-lista">
            ${pendentes.map((l, i) => `
              <div class="rf-modal-item" data-i="${i}">
                <div class="rf-modal-arq" title="${esc(l.meta.arquivo)}">${esc(l.meta.arquivo)} <small>${l.meta.n_linhas} linhas · R$ ${fmtN(l.meta.total)}</small></div>
                <input type="text" class="rf-modal-med" list="rf-dl-medicos" placeholder="Médico" value="${esc(l.meta.medico || l.meta.medicoBruto || '')}">
                <input type="month" class="rf-modal-comp" value="${esc(l.meta.competencia || '')}">
              </div>`).join('')}
          </div>
          <div class="rf-modal-acoes">
            <button type="button" class="btn" id="rf-modal-cancelar">Cancelar estes</button>
            <button type="button" class="btn btn-primary" id="rf-modal-ok">Importar</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      const fechar = (ok) => { ov.remove(); resolve(ok); };
      ov.querySelector('#rf-modal-cancelar').addEventListener('click', () => fechar(false));
      ov.querySelector('#rf-modal-ok').addEventListener('click', () => {
        let faltou = false;
        ov.querySelectorAll('.rf-modal-item').forEach(el => {
          const l = pendentes[Number(el.dataset.i)];
          const med = el.querySelector('.rf-modal-med').value.trim();
          const comp = el.querySelector('.rf-modal-comp').value.trim();
          if (med) l.meta.medico = nomeOficial(med);
          if (/^\d{4}-\d{2}$/.test(comp)) l.meta.competencia = comp;
          if (!l.meta.medico || !l.meta.competencia) { faltou = true; el.classList.add('rf-modal-falta'); }
        });
        if (faltou) { Utilidades.toast?.('Preencha médico e competência dos arquivos marcados (ou cancele).', 'warning', 3500); return; }
        fechar(true);
      });
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // O "DEVERIA": a soma da ferramenta por competência
  // ──────────────────────────────────────────────────────────────────────
  function garantirMotor() {
    if (window.AtlasCalcular && typeof window.AtlasCalcular.calcularESalvar === 'function') return true;
    try {
      if (window.App && App.telas && typeof App.telas['calcular'] === 'function') App.telas['calcular']({ soRegistrar: true });
    } catch (e) { console.warn('[relatorio_final] motor do Calcular:', e); }
    return !!(window.AtlasCalcular && typeof window.AtlasCalcular.calcularESalvar === 'function');
  }
  function temSnapshot(comp) {
    try { return !!Banco.queryUnica(`SELECT competencia FROM repasse_snapshot WHERE competencia = ? LIMIT 1`, [comp]); }
    catch (e) { return false; }
  }
  function temSistema(comp) {
    try { return !!Banco.queryUnica(`SELECT id FROM linhas_qvis WHERE mes_pagamento = ? LIMIT 1`, [comp]); }
    catch (e) { return false; }
  }
  /** Garante o cálculo do mês (as regras do Calcular, sem a tela) → { ok, motivo } */
  function garantirCalculo(comp) {
    if (temSnapshot(comp)) return { ok: true, motivo: 'salvo' };
    if (!temSistema(comp)) return { ok: false, motivo: 'sem relatório do sistema importado para ' + comp };
    if (!garantirMotor()) return { ok: false, motivo: 'motor do Calcular indisponível' };
    try {
      const r = window.AtlasCalcular.calcularESalvar(comp);
      if (r && r.ok) return { ok: true, motivo: 'calculado agora' };
      return { ok: false, motivo: (r && r.motivo) || 'não calculou' };
    } catch (e) { return { ok: false, motivo: e.message || String(e) }; }
  }
  /** Linhas COMPLETAS do Consolidado do mês, sem o filtro interno/híbrido. */
  function deveriaDaCompetencia(comp) {
    const api = window.AtlasRelatorios;
    if (!api || typeof api.linhasCompletasComp !== 'function') return [];
    try { return api.linhasCompletasComp(comp, { semFiltroIH: true }) || []; }
    catch (e) { console.error('[relatorio_final] deveria', comp, e); return []; }
  }
  function medNormDeLinhaCons(l) {
    return normNome(nomeOficial(l._medicoReal || l.profissional || ''));
  }
  function itemDeveria(l, comp) {
    return {
      lado: 'deveria', competencia: comp,
      admissao: String(l.admissao || '').trim(), admissao_norm: normAdm(l.admissao),
      data: normData(l.data), paciente: l.paciente || '',
      papel: papelCanon(l.papel), papelRot: l.papel || '',
      procedimento: String(l.descricao || '').trim(),
      valor: /glosa/i.test(String(l.status || '')) ? 0 : (Number(l.valor) || 0),
      glosa: /glosa/i.test(String(l.status || '')),
      status: l.status || '', modulo: l.modulo || '', origem: l.origem || '', convenio: l.convenio || '',
      medico: nomeOficial(l._medicoReal || l.profissional || ''),
    };
  }
  function itemRecebido(r) {
    return {
      lado: 'recebido', competencia: r.competencia,
      admissao: String(r.admissao || '').trim(), admissao_norm: r.admissao_norm || '',
      data: r.data || '', paciente: r.paciente || '',
      papel: r.papel_canon || papelCanon(r.papel), papelRot: r.papel || '',
      procedimento: String(r.procedimento || '').trim(),
      valor: r.glosa ? 0 : (Number(r.valor) || 0), glosa: !!r.glosa,
      status: r.status || '', modulo: r.modulo || '', origem: r.origem || '', convenio: r.convenio || '',
      medico: r.medico || '', virtual: !!r.virtual,
    };
  }
  const mesmoExame = (a, b) => (I().mesmoExame ? I().mesmoExame(a, b) : normNome(a) === normNome(b));
  const igual = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;

  /**
   * Confronta UMA admissão: itens do deveria × itens do recebido → itens
   * classificados. Nunca deduplica: cada linha de um lado consome no máximo
   * uma do outro. Estorno (negativo) anula o positivo igual do mesmo papel.
   */
  /**
   * ATLAS v1.3.6: o ADICIONAL do LIO (linha "LIO · ADICIONAL" do Consolidado —
   * % sobre a diferença da lente) NÃO entra no que falta pagar: a vigência é
   * recente, então não há o que cobrar para trás (Pedro, 17/09/2026). Ele
   * continua aparecendo, como item informativo.
   */
  function ehAdicional(x) {
    return !!x && /ADICIONAL/.test(norm(x.modulo || ''));
  }
  /**
   * ATLAS v1.3.7: a linha veio de um MÓDULO DE DESEMPENHO (os fichários: LIO,
   * OPME, Laudos, Fellow, Períodos, Fracionamento, Lentes de Contato, Luz
   * Pulsada, Estrabismo, Crosslink, Refractive Laser, Exceção · Produção,
   * Cargos). No Consolidado elas nascem com status "Desempenho" / "CARGO
   * ADMINISTRATIVO" (`relatorios.js`), contra "QVIS", "GLOSA" e "Ajustes" do
   * repasse comum. O que o módulo de desempenho pagou FOI PAGO (Pedro,
   * 17/09/2026): não achar a linha no relatório final do médico é motivo para
   * CONFERIR, não para cobrar.
   */
  function ehDesempenho(x) {
    return !!x && /^(DESEMPENHO|CARGO ADMINISTRATIVO)/.test(norm(x.status || ''));
  }
  const CATS_AUSENCIA = new Set(['nao_pago', 'nao_consta']);
  function confrontarAdmissao(dev, rec, ctx) {
    const out = [];
    const base = (d, r, categoria, falta) => {
      // ATLAS v1.3.6: nenhuma categoria do ADICIONAL soma no falta pagar
      if (CATEGORIAS[categoria] && CATEGORIAS[categoria].soma && ehAdicional(d || r)) { categoria = 'adicional'; falta = 0; }
      // ATLAS v1.3.7: linha de módulo de desempenho que não aparece no relatório
      // final não é dívida — o módulo já pagou; fica informativa, para conferir
      else if (CATS_AUSENCIA.has(categoria) && ehDesempenho(d || r)) { categoria = 'desempenho'; falta = 0; }
      return {
      categoria, rotulo: CATEGORIAS[categoria].rotulo, tom: CATEGORIAS[categoria].tom,
      competencia: (d || r).competencia, medico: (d && d.medico) || (r && r.medico) || (ctx && ctx.medico) || '',
      admissao: (d && d.admissao) || (r && r.admissao) || '', admissao_norm: (d && d.admissao_norm) || (r && r.admissao_norm) || '',
      data: (d && d.data) || (r && r.data) || '', paciente: (d && d.paciente) || (r && r.paciente) || '',
      procedimento: (d && d.procedimento) || (r && r.procedimento) || '',
      papel: (d && d.papel) || (r && r.papel) || '',
      deveria: d ? d.valor : 0, recebido: r ? r.valor : 0, falta: Math.max(0, Number(falta) || 0),
      status: (d && d.status) || (r && r.status) || '', modulo: (d && d.modulo) || (r && r.modulo) || '',
      origem: (d && d.origem) || (r && r.origem) || '', convenio: (d && d.convenio) || (r && r.convenio) || '',
      fonte: d ? 'consolidado' : 'final',
      // ATLAS v1.3.1: de qual relatório veio o recebido e em que mês a
      // ferramenta pagou (o deveria pode estar noutro mês que o do relatório)
      relatorio_id: (r && r.relatorio_id) || null,
      compRecebido: (r && r.competencia) || '',
      foraDoMes: !!(d && d.dentro === false),
      // ATLAS v1.3.5: o recebido veio do Consolidado da ferramenta (não do arquivo)
      recDoConsolidado: !!(r && r.virtual),
      adicional: ehAdicional(d || r),   // ATLAS v1.3.6
      desempenho: ehDesempenho(d || r),  // ATLAS v1.3.7
      };
    };
    // 1) estornos: negativo anula o positivo igual (mesmo papel e exame)
    const recAtivas = rec.slice();
    for (const neg of rec.filter(r => r.valor < -0.004)) {
      const pos = recAtivas.find(r => r !== neg && r.valor > 0.004 && r.papel === neg.papel
        && igual(r.valor, -neg.valor) && mesmoExame(r.procedimento, neg.procedimento));
      if (pos) { recAtivas.splice(recAtivas.indexOf(pos), 1); recAtivas.splice(recAtivas.indexOf(neg), 1); }
    }
    const usados = new Set();
    const devOrd = dev.slice().sort((a, b) => b.valor - a.valor);
    const temRecebidoAlgum = recAtivas.some(r => !r.glosa && r.valor > 0.004);
    for (const d of devOrd) {
      const cand = recAtivas.filter(r => !usados.has(r) && r.papel === d.papel && r.valor >= -0.004);
      // ATLAS v1.3.2/v1.3.5: o ARQUIVO do médico vale antes do Consolidado — em
      // duas passadas, senão a linha do Consolidado (valor exato) roubava o par
      // do arquivo e o "pago a menor" virava "conforme" + "recebido sem lastro"
      const escolher = (lista) => lista.find(r => mesmoExame(r.procedimento, d.procedimento) && igual(r.valor, d.valor))
        || lista.find(r => mesmoExame(r.procedimento, d.procedimento))
        || lista.find(r => igual(r.valor, d.valor) && d.valor > 0.004);
      const pick = escolher(cand.filter(r => !r.virtual)) || escolher(cand.filter(r => r.virtual));
      if (pick) {
        usados.add(pick);
        if (d.glosa && pick.glosa) { out.push(base(d, pick, 'glosa', 0)); continue; }
        if (igual(pick.valor, d.valor)) out.push(base(d, pick, d.glosa ? 'glosa' : 'conforme', 0));
        else if (pick.valor < d.valor) out.push(base(d, pick, 'a_menor', d.valor - pick.valor));
        else out.push(base(d, pick, 'a_maior', 0));
        continue;
      }
      if (d.glosa) { out.push(base(d, null, 'glosa', 0)); continue; }
      if (!(d.valor > 0.004)) continue;   // linha zerada do Consolidado: nada a cobrar
      // ATLAS v1.3.2: sem o relatório final daquele mês (nem arquivo, nem a
      // ferramenta) não dá para afirmar que faltou — informa, não cobra
      if (d.semRelatorio) { out.push(base(d, null, 'sem_relatorio', 0)); continue; }
      out.push(base(d, null, temRecebidoAlgum ? 'nao_pago' : 'nao_consta', d.valor));
    }
    for (const r of recAtivas) {
      if (usados.has(r)) continue;
      if (r.virtual) continue;   // ATLAS v1.3.2: linha do próprio Consolidado sem par não é "sem lastro"
      if (r.glosa) { out.push(base(null, r, 'glosa', 0)); continue; }
      if (r.valor < -0.004) { out.push(base(null, r, 'estorno', 0)); continue; }
      if (!(r.valor > 0.004)) continue;
      out.push(base(null, r, 'sem_lastro', 0));
    }
    return out;
  }
  function agruparPorAdm(itens) {
    const m = new Map();
    for (const it of itens) {
      const k = it.admissao_norm || ('?|' + normNome(it.paciente) + '|' + it.data);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return m;
  }
  /** Linhas do final SEM admissão ganham a admissão do deveria por paciente + data */
  function adotarAdmissoes(recItens, devItens) {
    const porPacData = new Map();
    for (const d of devItens) if (d.admissao_norm && d.paciente && d.data) {
      const k = normNome(d.paciente) + '|' + d.data;
      if (!porPacData.has(k)) porPacData.set(k, d);
    }
    for (const r of recItens) if (!r.admissao_norm && r.paciente && r.data) {
      const d = porPacData.get(normNome(r.paciente) + '|' + r.data);
      if (d) { r.admissao = d.admissao; r.admissao_norm = d.admissao_norm; }
    }
  }

  /** grafias conhecidas do médico (cadastro + de-para), normalizadas */
  function grafiasDoMedico(medico) {
    const set = new Set([norm(medico), normNome(medico)]);
    try {
      const m = Banco.queryUnica(`SELECT id, nome_oficial, nome_normalizado FROM medicos WHERE nome_oficial = ? LIMIT 1`, [medico]);
      if (m) {
        if (m.nome_normalizado) set.add(String(m.nome_normalizado));
        for (const s of Banco.query(`SELECT grafia, grafia_normalizada FROM sinonimos_medico WHERE medico_id = ?`, [m.id]) || []) {
          if (s.grafia) { set.add(norm(s.grafia)); set.add(normNome(s.grafia)); }
          if (s.grafia_normalizada) set.add(String(s.grafia_normalizada));
        }
      }
    } catch (e) {}
    return [...set].filter(Boolean);
  }
  function qvisDoMedico(medico, comp) {
    const g = grafiasDoMedico(medico);
    if (!g.length) return [];
    try {
      const ph = g.map(() => '?').join(',');
      return Banco.query(
        `SELECT admissao, data_admissao, paciente, nome_profissional, papel, procedimento, procedimento_normalizado,
                origem, convenio, produzido, recebido, repassado, classificacao_produto, mes_pagamento
           FROM linhas_qvis
          WHERE mes_pagamento = ? AND (nome_normalizado IN (${ph}) OR UPPER(TRIM(nome_profissional)) IN (${ph}))`,
        [comp, ...g, ...g]) || [];
    } catch (e) { return []; }
  }
  /** valor que a regra da Base Tabela manda para a linha do sistema (V846/V871 da Inspeção) */
  function valorDaRegra(q) {
    const rep = Number(q.repassado) || 0;
    if (rep > 0) return rep;
    try {
      const regras = I()._regrasNaData ? I()._regrasNaData(normData(q.data_admissao)) : (I()._carregarRegras ? I()._carregarRegras() : null);
      if (!regras || !regras.procs) return 0;
      const pid = regras.procs.get(normNome(q.procedimento_normalizado || q.procedimento));
      if (pid == null) return 0;
      const vm = regras.porProcValores && regras.porProcValores.get(pid);
      const r = vm && vm.get(papelCanon(q.papel));
      if (!r) return 0;
      if ((Number(r.valor) || 0) > 0) return Number(r.valor);
      if ((Number(r.percentual) || 0) > 0) return (Number(q.produzido) || 0) * Number(r.percentual);
    } catch (e) {}
    return 0;
  }
  /** Linhas do sistema do médico no mês, com regra, sem pagamento em lugar nenhum */
  function regraNaoPaga(medico, comp, itensJa) {
    const qvis = qvisDoMedico(medico, comp);
    if (!qvis.length) return [];
    const porAdm = agruparPorAdm(itensJa);
    const inst = I().ehMedicoInstitucional || (() => false);
    const temRegra = I().temRegraDeRepasse || (() => true);
    const grupos = new Map();
    for (const q of qvis) {
      if (inst(q.nome_profissional)) continue;
      const origem = String(q.origem || '').toUpperCase();
      if (origem !== 'PARTICULAR' && (Number(q.recebido) || 0) <= 0) continue;   // glosa do convênio: vale zero
      if (!temRegra(q)) continue;
      const papel = papelCanon(q.papel);
      const k = normAdm(q.admissao);
      const ja = (porAdm.get(k) || []).some(it => it.papel === papel && mesmoExame(it.procedimento, q.procedimento));
      if (ja) continue;
      const valor = valorDaRegra(q);
      const gk = k + '|' + papel + '|' + normNome(q.procedimento);
      if (!grupos.has(gk)) {
        grupos.set(gk, { categoria: 'regra_nao_paga', rotulo: CATEGORIAS.regra_nao_paga.rotulo, tom: 'falta',
          competencia: comp, medico, admissao: String(q.admissao || '').trim(), admissao_norm: k,
          data: normData(q.data_admissao), paciente: q.paciente || '', procedimento: q.procedimento || '', papel,
          deveria: 0, recebido: 0, falta: 0, status: 'Sistema', modulo: 'Sistema', origem: q.origem || '',
          convenio: q.convenio || '', fonte: 'sistema', n: 0 });
      }
      const g = grupos.get(gk);
      g.deveria += valor; g.falta += valor; g.n++;
    }
    return [...grupos.values()];
  }
  /** Produzido nos últimos 3 meses e ainda fora do sistema (não é dívida — informativo) */
  function aguardandoConvenio(medico, comp, jaVistas) {
    const g = new Set(grafiasDoMedico(medico));
    if (!g.size) return [];
    const [ano, mes] = comp.split('-').map(Number);
    const comps = [];
    for (let k = 0; k < 3; k++) {
      const d = new Date(Date.UTC(ano, mes - 1 - k, 1));
      comps.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    let rows = [];
    try {
      rows = Banco.query(
        `SELECT cod_admissao, data_admissao, paciente, produto, procedimento_principal, classificacao_produto, categoria,
                tipo_recebimento, convenio, medico, cirurgiao, indicante, solicitante, auxiliar_1, auxiliar_2
           FROM linhas_producao WHERE competencia IN (${comps.map(() => '?').join(',')})`, comps) || [];
    } catch (e) { rows = []; }
    const repassavel = I().produtoRepassavel || (() => true);
    const COLS = [['cirurgiao', 'EXECUTANTE'], ['medico', 'EXECUTANTE'], ['indicante', 'INDICANTE'],
      ['solicitante', 'INDICANTE'], ['auxiliar_1', 'AUXILIAR'], ['auxiliar_2', 'AUXILIAR']];
    const cand = [];
    for (const r of rows) {
      const k = normAdm(r.cod_admissao);
      if (!k || jaVistas.has(k)) continue;
      if (!repassavel(r.classificacao_produto, r.categoria)) continue;
      const col = COLS.find(([c]) => r[c] && (g.has(norm(r[c])) || g.has(normNome(r[c]))));
      if (!col) continue;
      cand.push({ r, k, papel: col[1] });
    }
    if (!cand.length) return [];
    const adms = [...new Set(cand.map(c => c.k))];
    const noSistema = new Set();
    const variantes = I().variantesAdm || ((a) => [a]);
    for (let i = 0; i < adms.length; i += 120) {
      const lote = adms.slice(i, i + 120);
      const vars = [...new Set(lote.flatMap(variantes))];
      try {
        for (const x of Banco.query(`SELECT DISTINCT admissao FROM linhas_qvis WHERE admissao IN (${vars.map(() => '?').join(',')})`, vars) || []) {
          noSistema.add(normAdm(x.admissao));
        }
      } catch (e) {}
    }
    const out = new Map();
    for (const c of cand) {
      if (noSistema.has(c.k)) continue;
      const proc = String(c.r.produto || c.r.procedimento_principal || '').trim();
      const gk = c.k + '|' + c.papel + '|' + normNome(proc);
      if (out.has(gk)) continue;
      out.set(gk, { categoria: 'aguardando', rotulo: CATEGORIAS.aguardando.rotulo, tom: 'info', competencia: comp, medico,
        admissao: String(c.r.cod_admissao || '').trim(), admissao_norm: c.k, data: normData(c.r.data_admissao),
        paciente: c.r.paciente || '', procedimento: proc, papel: c.papel, deveria: 0, recebido: 0, falta: 0,
        status: 'Produção', modulo: 'Produção', origem: c.r.tipo_recebimento || '', convenio: c.r.convenio || '', fonte: 'producao' });
    }
    return [...out.values()];
  }

  /**
   * AUDITORIA: relatórios (ids; vazio = todos) → { itens, porRelatorio, totais }.
   * Assíncrona e com progresso: monta cada competência UMA vez e cede a vez
   * ao navegador entre relatórios (vários médicos × meses sem travar).
   *
   * ATLAS v1.3.1 — O CASAMENTO É PELA ADMISSÃO, NÃO PELO MÊS. O relatório
   * do médico e a competência da ferramenta podem não coincidir (o arquivo
   * "MAIO2026" diz "Competência: ABRIL" e o sistema pode ter sido importado
   * como maio). Por isso o confronto junta TODOS os relatórios do médico:
   *   · o "deveria" nasce dos meses dos relatórios;
   *   · admissão recebida que não está nesses meses é procurada no mês em
   *     que o sistema a pagou (linhas_qvis.mes_pagamento) e o Consolidado
   *     daquele mês entra só para ela (marcada "fora do mês");
   *   · cada relatório recebe uma COBERTURA: quantas admissões dele estão no
   *     Consolidado do próprio mês, quantas noutros meses e quantas em nenhum
   *     — é o que mostra, na hora, um mês importado com outro rótulo.
   */
  async function auditar(ids, opts) {
    opts = opts || {};
    const progresso = typeof opts.progresso === 'function' ? opts.progresso : () => {};
    const todos = listarTodos();
    const selBruta = (ids && ids.length) ? todos.filter(r => ids.includes(r.id)) : todos.slice();
    const avisos = [];
    const avisosComp = new Set();
    const semRelatorioAviso = new Map();   // comp → Set(médico) — meses do Consolidado sem relatório final
    // o "deveria" de cada mês, montado uma vez (sob demanda)
    const devCache = new Map();
    const getDeveria = async (comp) => {
      if (devCache.has(comp)) return devCache.get(comp);
      progresso({ fase: 'competencia', i: devCache.size, n: devCache.size + 1, competencia: comp });
      await tick();
      const calc = garantirCalculo(comp);
      const linhas = calc.ok || temSnapshot(comp) ? deveriaDaCompetencia(comp) : [];
      if (!calc.ok && !temSnapshot(comp) && !avisosComp.has(comp)) {
        avisosComp.add(comp);
        avisos.push(`${comp}: ${calc.motivo} — o "deveria" deste mês ficou só com o que o Consolidado tem`);
      }
      const porMed = new Map();
      for (const l of linhas) {
        const k = medNormDeLinhaCons(l);
        if (!porMed.has(k)) porMed.set(k, []);
        porMed.get(k).push(itemDeveria(l, comp));
      }
      const ent = { porMed, ok: calc.ok };
      devCache.set(comp, ent);
      return ent;
    };
    // ATLAS v1.3.3: o médico auditado recorta os meses da ferramenta; relatório
    // importado de outro médico entra, mas avisado
    const auditado = medicoAuditado();
    const audNorm = normNome(auditado);
    // ATLAS v1.3.2: mês virtual (Consolidado da ferramenta) vira um relatório
    // por médico; arquivo importado do mesmo médico × mês vence o virtual
    const sel = [];
    for (const r of selBruta) {
      const v = idVirtual(r.id);
      if (!v) {
        if (audNorm && r.medico_norm !== audNorm) avisos.push(`"${r.arquivo}" (${r.medico} · ${fmtComp(r.competencia)}) é de OUTRO médico — o médico auditado é ${auditado}`);
        sel.push(r); continue;
      }
      const ent = await getDeveria(v.comp);
      if (audNorm && !(ent.porMed.get(audNorm) || []).length) avisos.push(`Consolidado de ${fmtComp(v.comp)}: nenhuma linha do médico auditado (${auditado})`);
      for (const [medNorm, itensDev] of ent.porMed) {
        if (!medNorm || !itensDev.length) continue;
        if (audNorm && medNorm !== audNorm) continue;
        const importado = listar().find(x => x.medico_norm === medNorm && x.competencia === v.comp);
        if (importado) { if (!sel.some(x => x.id === importado.id)) sel.push(importado); continue; }
        sel.push({ id: 'f|' + v.comp + '|' + medNorm, virtual: true, medico: itensDev[0].medico, medico_norm: medNorm,
          competencia: v.comp, competencia_arquivo: v.comp, layout: 'ferramenta', arquivo: 'Consolidado ' + v.comp,
          n_linhas: itensDev.length, total: itensDev.reduce((s, x) => s + (x.valor || 0), 0) });
      }
    }
    // por médico: todos os relatórios dele juntos
    const porMedico = new Map();
    for (const r of sel) {
      if (!porMedico.has(r.medico_norm)) porMedico.set(r.medico_norm, { medico: r.medico, rels: [] });
      porMedico.get(r.medico_norm).rels.push(r);
    }
    const itens = [], porRelatorio = [];
    let iRel = 0;
    for (const [medNorm, g] of porMedico) {
      const rels = g.rels;
      const compsRel = [...new Set(rels.map(r => r.competencia))];
      const relDoComp = (comp) => rels.find(r => r.competencia === comp) || null;
      // recebido: todas as linhas de todos os relatórios do médico
      const rec = [];
      for (const r of rels) {
        progresso({ fase: 'relatorio', i: iRel++, n: sel.length, medico: r.medico, competencia: r.competencia });
        await tick();
        for (const x of linhasDoRelatorio(r.id)) { const it = itemRecebido(x); it.relatorio_id = r.id; rec.push(it); }
      }
      // deveria dos meses dos relatórios
      const dev = [];
      for (const comp of compsRel) {
        const ent = await getDeveria(comp);
        for (const it of (ent.porMed.get(medNorm) || [])) { it.dentro = true; dev.push(it); }
      }
      // ATLAS v1.3.5: nos meses da ferramenta o Consolidado É o relatório final
      // do mês. Mesmo havendo ARQUIVO importado, as linhas do Consolidado entram
      // como recebidas — o arquivo vence no pareamento e a linha do Consolidado
      // que sobra é descartada. Sem isso a ferramenta cobrava como "não consta"
      // exatamente a linha que ela mesma mostra paga (Pedro, 16/09/2026).
      const complemento = new Map();   // comp → nº de linhas do Consolidado fora do arquivo
      for (const comp of compsRel) {
        if (!compDaFerramenta(comp)) continue;
        if (!temRelatorio(medNorm, comp)) continue;   // sem arquivo o mês virtual já entrou como relatório
        for (const it of dev) {
          if (it.competencia !== comp) continue;
          rec.push(recVirtualDeItem(it, comp));
          complemento.set(comp, (complemento.get(comp) || 0) + 1);
        }
      }
      adotarAdmissoes(rec, dev);
      // admissões recebidas que não estão nesses meses: em que mês o sistema as pagou?
      const admsDev = new Set(dev.map(d => d.admissao_norm).filter(Boolean));
      const admsRec = [...new Set(rec.map(x => x.admissao_norm).filter(Boolean))];
      const faltando = admsRec.filter(a => !admsDev.has(a));
      const onde = faltando.length ? mesesDasAdmissoes(faltando) : new Map();
      const outros = new Map();   // comp → Set(admissões)
      for (const [adm, comps] of onde) for (const c of comps) {
        if (compsRel.includes(c)) continue;
        if (!outros.has(c)) outros.set(c, new Set());
        outros.get(c).add(adm);
      }
      for (const [comp, adms] of outros) {
        const ent = await getDeveria(comp);
        const temArquivo = temRelatorio(medNorm, comp);
        const ehFerramenta = compDaFerramenta(comp);   // ATLAS v1.3.5: o Consolidado vale mesmo com arquivo
        const semRel = !temArquivo && !ehFerramenta;
        for (const it of (ent.porMed.get(medNorm) || [])) {
          if (!adms.has(it.admissao_norm)) continue;
          it.dentro = false;
          it.semRelatorio = semRel;
          dev.push(it);
          // ATLAS v1.3.2: no mês da ferramenta o Consolidado É o relatório
          // final — o que está nele entra como recebido (pago)
          if (ehFerramenta) rec.push(recVirtualDeItem(it, comp));   // ATLAS v1.3.5
          if (semRel) { if (!semRelatorioAviso.has(comp)) semRelatorioAviso.set(comp, new Set()); semRelatorioAviso.get(comp).add(g.medico); }
        }
      }
      // confronto por admissão (qualquer mês)
      const gDev = agruparPorAdm(dev), gRec = agruparPorAdm(rec);
      const chaves = new Set([...gDev.keys(), ...gRec.keys()]);
      const doMed = [];
      for (const k of chaves) {
        const its = confrontarAdmissao(gDev.get(k) || [], gRec.get(k) || [], { medico: g.medico });
        const recDaAdm = (gRec.get(k) || [])[0];
        for (const it of its) {
          if (!it.relatorio_id) {
            const rel = (recDaAdm && recDaAdm.relatorio_id) ? rels.find(r => r.id === recDaAdm.relatorio_id) : relDoComp(it.competencia);
            it.relatorio_id = (rel || rels[0]).id;
          }
          it.medico = it.medico || g.medico;
        }
        doMed.push(...its);
      }
      // com regra e sem pagamento / aguardando — por mês de relatório
      for (const comp of compsRel) {
        const rel = relDoComp(comp);
        const extras = opts.semRegra ? [] : regraNaoPaga(g.medico, comp, doMed);
        for (const it of extras) { it.relatorio_id = rel ? rel.id : rels[0].id; doMed.push(it); }
        if (!opts.semAguardando) {
          const vistas = new Set(doMed.map(x => x.admissao_norm).filter(Boolean));
          for (const it of aguardandoConvenio(g.medico, comp, vistas)) { it.relatorio_id = rel ? rel.id : rels[0].id; doMed.push(it); }
        }
      }
      // cobertura de cada relatório: onde estão as admissões dele
      const devPorAdm = new Map();
      for (const d of dev) { if (!d.admissao_norm) continue; if (!devPorAdm.has(d.admissao_norm)) devPorAdm.set(d.admissao_norm, new Set()); devPorAdm.get(d.admissao_norm).add(d.competencia); }
      for (const r of rels) {
        const adms = [...new Set(rec.filter(x => x.relatorio_id === r.id).map(x => x.admissao_norm).filter(Boolean))];
        const semAdm = rec.filter(x => x.relatorio_id === r.id && !x.admissao_norm).length;
        let noMes = 0, nenhum = 0;
        const outrosMeses = new Map();
        for (const a of adms) {
          const comps = devPorAdm.get(a);
          if (comps && comps.has(r.competencia)) { noMes++; continue; }
          if (comps && comps.size) { for (const c of comps) outrosMeses.set(c, (outrosMeses.get(c) || 0) + 1); continue; }
          nenhum++;
        }
        const cob = { n: adms.length, noMes, outros: [...outrosMeses.entries()].sort((a, b) => b[1] - a[1]).map(([c, k]) => ({ competencia: c, n: k })),
          nenhum, semAdmissao: semAdm };
        const its = doMed.filter(it => it.relatorio_id === r.id);
        porRelatorio.push({ id: r.id, medico: r.medico, competencia: r.competencia, competencia_arquivo: r.competencia_arquivo || '',
          layout: r.layout, arquivo: r.arquivo, n_linhas: r.n_linhas, cobertura: cob, ...totais(its) });
        // ATLAS v1.3.5: o Consolidado do mês da ferramenta cobriu linhas que o
        // arquivo não trazia — informa, não cobra (a ferramenta não desmente a
        // si mesma, mas também não esconde a diferença)
        if (complemento.has(r.competencia)) {
          const nCompl = its.filter(i => i.recDoConsolidado).length;
          if (nCompl) avisos.push(`${r.medico} · ${fmtComp(r.competencia)} (${r.arquivo}): ${nCompl} linha${nCompl > 1 ? 's' : ''} do Consolidado não aparece${nCompl > 1 ? 'm' : ''} no arquivo importado — contada${nCompl > 1 ? 's' : ''} como PAGA${nCompl > 1 ? 'S' : ''}, porque nesse mês o relatório final é o da própria ferramenta`);
        }
        if (adms.length && noMes < adms.length * 0.5) {
          const partes = [`${noMes} de ${adms.length} admissões no Consolidado de ${fmtComp(r.competencia)}`];
          if (cob.outros.length) partes.push('em outros meses: ' + cob.outros.slice(0, 4).map(o => `${fmtComp(o.competencia)} (${o.n})`).join(', '));
          if (nenhum) partes.push(`${nenhum} em nenhum mês calculado do sistema`);
          avisos.push(`${r.medico} · ${fmtComp(r.competencia)} (${r.arquivo}): ${partes.join(' · ')}${cob.outros.length ? ' — as admissões de outros meses foram confrontadas no mês em que o sistema as pagou' : ''}`);
        }
      }
      itens.push(...doMed);
    }
    for (const [comp, meds] of semRelatorioAviso) {
      avisos.push(`Consolidado de ${fmtComp(comp)}: admissões de ${[...meds].join(', ')} pagas nesse mês sem relatório final importado — o que está lá conta como pago, não como falta; importe o arquivo de ${fmtComp(comp)} para conferir (ou inclua o mês em "desde a ferramenta")`);
    }
    invalidar();   // um cálculo pode ter gravado snapshot → listas por versão
    progresso({ fase: 'fim', n: sel.length });
    return { itens, porRelatorio, totais: totais(itens), avisos, geradoEm: new Date().toISOString(),
      competencias: [...new Set(sel.map(r => r.competencia))].sort(), relatorios: sel.map(r => r.id), medicoAuditado: auditado };
  }
  function totais(itens) {
    const t = { deveria: 0, recebido: 0, falta: 0, semLastro: 0, n: itens.length, porCategoria: {} };
    for (const it of itens) {
      t.deveria += it.deveria || 0;
      t.recebido += it.recebido || 0;
      if (CATEGORIAS[it.categoria] && CATEGORIAS[it.categoria].soma) t.falta += it.falta || 0;
      if (it.categoria === 'sem_lastro') t.semLastro += it.recebido || 0;
      const c = t.porCategoria[it.categoria] || { n: 0, valor: 0 };
      c.n++; c.valor += CATEGORIAS[it.categoria] && CATEGORIAS[it.categoria].soma ? (it.falta || 0) : (it.categoria === 'sem_lastro' || it.categoria === 'a_maior' ? it.recebido - it.deveria : 0);
      t.porCategoria[it.categoria] = c;
    }
    return t;
  }

  /** 4º painel da Inspeção: confronto de UMA admissão (Consolidado × final) */
  function confrontoDaAdmissao(adm, consolidado, finais) {
    // `finais` já traz as linhas virtuais dos meses da ferramenta (linhasFinaisDaAdmissao)
    const rec = (finais || []).map(itemRecebido);
    const devTodos = (consolidado || []).map(r => itemDeveria(r.linha, r.competencia));
    if (!devTodos.length && !rec.length) return { tom: 'info', titulo: 'Nada a confrontar nesta admissão', texto: '', itens: [] };
    // ATLAS v1.3.2: mês sem relatório final (nem arquivo, nem ferramenta) → não
    // cobra. E o confronto é por MÉDICO, em qualquer mês (como na auditoria em
    // lote): o arquivo de junho pode trazer a admissão que a ferramenta pagou em
    // maio — o arquivo do médico vale antes do Consolidado no pareamento.
    const semRel = [];
    let temPar = false;
    for (const d of devTodos) {
      const medN = normNome(d.medico);
      if (temRelatorioPara(medN, d.competencia)) temPar = true;
      else { d.semRelatorio = true; semRel.push(d); }
    }
    if (rec.length) temPar = true;
    const medicos = [...new Set(devTodos.map(d => normNome(d.medico)).concat(rec.map(r => normNome(r.medico))))];
    const itens = [];
    for (const medN of medicos) {
      const dev = devTodos.filter(d => normNome(d.medico) === medN);
      const re = rec.filter(r => normNome(r.medico) === medN);
      const medico = (dev[0] && dev[0].medico) || (re[0] && re[0].medico) || '';
      itens.push(...confrontarAdmissao(dev, re, { medico }));
    }
    const pares = { size: temPar ? 1 : 0 };
    const t = totais(itens);
    const mesesSemRel = [...new Set(semRel.map(d => d.competencia))].sort();
    let tom = 'ok', titulo = 'Relatório final confere com o Consolidado', texto = '';
    if (t.falta > 0.004) { tom = 'falta'; titulo = `Falta pagar ao médico R$ ${fmtN(t.falta)} nesta admissão`; }
    else if (itens.some(i => i.categoria === 'sem_lastro' || i.categoria === 'a_maior')) { tom = 'sem'; titulo = 'Recebido sem lastro no Consolidado'; }
    else if (!pares.size && mesesSemRel.length) { tom = 'info'; titulo = `Pago no Consolidado de ${mesesSemRel.map(fmtComp).join(', ')} — sem relatório final do mês para conferir`;
      texto = 'O que está no Consolidado conta como pago. Importe o relatório do médico desse mês (ou inclua o mês em "desde a ferramenta") para confrontar.'; }
    else if (!itens.length) { tom = 'info'; titulo = 'Nada a confrontar nesta admissão'; }
    if (tom === 'ok' && rec.some(r => r.virtual !== undefined ? false : false)) { /* reservado */ }
    if (tom === 'ok' && (finais || []).length && (finais || []).every(l => l.virtual)) titulo = 'Pago no Consolidado — o relatório final deste mês é o da própria ferramenta';
    // ATLAS v1.3.5: parte do pago veio do Consolidado e parte do arquivo
    else if (tom === 'ok' && itens.some(i => i.recDoConsolidado) && itens.some(i => !i.recDoConsolidado && i.recebido > 0.004)) {
      titulo = 'Pago — arquivo do médico e Consolidado da ferramenta';
      texto = 'O arquivo importado não traz todas as linhas desta admissão; as que faltam estão no Consolidado do mês, que nesse período É o relatório final — por isso contam como pagas.';
    } else if (tom === 'ok' && itens.some(i => i.categoria === 'desempenho' || i.categoria === 'adicional')) {
      // ATLAS v1.3.7: o que o módulo de desempenho pagou não é cobrado
      titulo = 'Pago — inclui linha de módulo de desempenho';
      texto = 'A linha de desempenho (LIO, OPME, Laudos, Fellow…) foi paga pelo módulo e não foi localizada no relatório final do médico: confira nele, mas a ATLAS não cobra o que a própria ferramenta pagou.';
    } else if (tom === 'ok' && itens.some(i => i.recDoConsolidado)) {
      texto = texto || 'O que está no Consolidado do mês conta como pago — nesse período o relatório final é o da própria ferramenta.';
    }
    return { tom, titulo, texto, itens: itens.filter(i => i.categoria !== 'conforme' || itens.length <= 12), totais: t };
  }

  // ──────────────────────────────────────────────────────────────────────
  // EXPORTAÇÃO EXCEL
  // ──────────────────────────────────────────────────────────────────────
  async function exportarExcel(res, opts) {
    try { await garantirExcelJS(); }
    catch (e) { Utilidades.toast?.('Biblioteca ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return; }
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ATLAS — Auditoria de Contas';
    wb.created = new Date();
    const cols = [
      { header: 'Categoria', key: 'rotulo', width: 28 }, { header: 'Competência', key: 'competencia', width: 12 },
      { header: 'Médico', key: 'medico', width: 32 }, { header: 'Admissão', key: 'admissao', width: 13 },
      { header: 'Data', key: 'data', width: 12 }, { header: 'Paciente', key: 'paciente', width: 30 },
      { header: 'Procedimento', key: 'procedimento', width: 44 }, { header: 'Papel', key: 'papel', width: 16 },
      { header: 'Origem', key: 'origem', width: 12 }, { header: 'Convênio', key: 'convenio', width: 22 },
      { header: 'Deveria', key: 'deveria', width: 14 }, { header: 'Recebido', key: 'recebido', width: 14 },
      { header: 'Falta pagar', key: 'falta', width: 14 }, { header: 'Fonte', key: 'fonte', width: 12 },
      { header: 'Pago por', key: 'pagoPor', width: 22 },   // ATLAS v1.3.5
    ];
    const aba = (nome, itens) => {
      const ws = wb.addWorksheet(nome, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = cols;
      const head = ws.getRow(1);
      head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3F6489' } };
      for (const it of itens) {
        const row = ws.addRow({ rotulo: it.rotulo, competencia: it.competencia, medico: it.medico, admissao: it.admissao,
          data: dataBR(it.data), paciente: it.paciente, procedimento: it.procedimento, papel: it.papel, origem: it.origem,
          convenio: it.convenio, deveria: Number(it.deveria) || 0, recebido: Number(it.recebido) || 0,
          falta: Number(it.falta) || 0, fonte: it.fonte,
          pagoPor: it.recDoConsolidado ? 'Consolidado da ferramenta' : (Number(it.recebido) > 0.004 ? 'arquivo do médico' : '') });
        ['deveria', 'recebido', 'falta'].forEach(k => { row.getCell(k).numFmt = 'R$ #,##0.00'; });
        if (it.tom === 'falta') row.getCell('falta').font = { bold: true, color: { argb: 'FFA15646' } };
      }
      const tot = ws.addRow({ rotulo: 'TOTAL', deveria: itens.reduce((s, i) => s + (i.deveria || 0), 0),
        recebido: itens.reduce((s, i) => s + (i.recebido || 0), 0), falta: itens.reduce((s, i) => s + (i.falta || 0), 0) });
      tot.font = { bold: true };
      ['deveria', 'recebido', 'falta'].forEach(k => { tot.getCell(k).numFmt = 'R$ #,##0.00'; });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    };
    const itens = res.itens || [];
    aba('Falta pagar', itens.filter(i => CATEGORIAS[i.categoria] && CATEGORIAS[i.categoria].soma));
    aba('Conforme', itens.filter(i => i.categoria === 'conforme'));
    aba('Avisos', itens.filter(i => !CATEGORIAS[i.categoria].soma && i.categoria !== 'conforme'));
    const ws = wb.addWorksheet('Resumo', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Médico', key: 'medico', width: 32 }, { header: 'Competência', key: 'competencia', width: 12 },
      { header: 'Layout', key: 'layout', width: 12 }, { header: 'Linhas do final', key: 'n_linhas', width: 14 },
      { header: 'Deveria', key: 'deveria', width: 14 }, { header: 'Recebido', key: 'recebido', width: 14 },
      { header: 'Falta pagar', key: 'falta', width: 14 }, { header: 'Sem lastro', key: 'semLastro', width: 14 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3F6489' } };
    for (const r of res.porRelatorio || []) {
      const row = ws.addRow({ medico: r.medico, competencia: r.competencia, layout: r.layout, n_linhas: r.n_linhas,
        deveria: r.deveria, recebido: r.recebido, falta: r.falta, semLastro: r.semLastro });
      ['deveria', 'recebido', 'falta', 'semLastro'].forEach(k => { row.getCell(k).numFmt = 'R$ #,##0.00'; });
    }
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    a.href = url; a.download = (opts && opts.nome) || `ATLAS_falta_pagar_${ts}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ──────────────────────────────────────────────────────────────────────
  // A ABA (UI)
  // ──────────────────────────────────────────────────────────────────────
  const ui = { sel: new Set(), filtroMed: '', filtroComp: '', busca: '', resultado: null, cats: new Set(), buscaRes: '',
    medRes: '', compRes: '', ocupado: false };
  let _root = null;
  const $ = (id) => document.getElementById(id);

  function montar(container) {
    if (!container) return;
    _root = container;
    Utilidades.garantirEstilos && Utilidades.garantirEstilos('css-relatorio-final', CSS);
    container.innerHTML = `
      <div class="rf-wrap">
        <section class="card rf-card" id="rf-card-import">
          <div class="rf-head">
            <div>
              <h3>Relatórios finais importados</h3>
              <p>O relatório que cada <strong>médico recebeu</strong>, um arquivo por médico e mês de pagamento — o layout manual de antes de abril/2026 ou o exportado pela ferramenta. Solte vários arquivos de uma vez.</p>
            </div>
            <div class="rf-acoes">
              <label class="btn btn-primary rf-btn-importar" title="Selecionar um ou vários relatórios (.xlsx, .xls, .csv)">
                <i class="ti ti-file-import"></i> Importar relatórios
                <input type="file" id="rf-arquivos" accept=".xlsx,.xlsm,.xls,.csv" multiple hidden>
              </label>
            </div>
          </div>
          <div class="rf-drop" id="rf-drop">Arraste os arquivos para cá</div>
          <div class="rf-progresso" id="rf-progresso" hidden>
            <div class="rf-barra"><div class="rf-barra-fill" id="rf-barra-fill"></div></div>
            <div class="rf-prog-tx" id="rf-prog-tx"></div>
          </div>
          <div class="rf-auditado" id="rf-auditado"></div>
          <div class="rf-filtros" id="rf-filtros"></div>
          <div class="rf-lista" id="rf-lista"></div>
          <div class="rf-lista-acoes">
            <button type="button" class="btn btn-primary" id="rf-auditar" title="Confronta o Consolidado da ferramenta com os relatórios marcados (ou todos) e lista o que falta pagar">
              <i class="ti ti-scale"></i> Auditar <span id="rf-auditar-n"></span>
            </button>
            <button type="button" class="btn" id="rf-pauta" title="Manda as admissões dos relatórios marcados para a pauta da aba Admissão">Mandar admissões para a pauta</button>
          </div>
        </section>
        <section class="card rf-card" id="rf-resultado" hidden></section>
      </div>`;
    ligar();
    pintarLista();
    if (ui.resultado) pintarResultado();
  }

  function ligar() {
    const inp = $('rf-arquivos');
    inp.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      await importarUI(files);
    });
    const drop = $('rf-drop');
    const card = $('rf-card-import');
    ['dragenter', 'dragover'].forEach(ev => card.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('ativo'); }));
    ['dragleave', 'drop'].forEach(ev => card.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || !card.contains(e.relatedTarget)) drop.classList.remove('ativo'); }));
    card.addEventListener('drop', async (e) => {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length) await importarUI(files);
    });
    $('rf-auditar').addEventListener('click', () => auditarUI());
    $('rf-pauta').addEventListener('click', () => {
      const ids = idsSelecionados();
      const itens = [];
      for (const id of ids) for (const l of linhasDoRelatorio(id)) if (l.admissao_norm) itens.push({ admissao: l.admissao, paciente: l.paciente, data: l.data });
      const n = window.AtlasInspecao && AtlasInspecao.definirPauta ? AtlasInspecao.definirPauta(itens) : 0;
      Utilidades.toast?.(n ? `✓ ${n} admissões na pauta da aba Admissão` : 'Nenhuma admissão com código nos relatórios marcados', n ? 'success' : 'warning', 3500);
      if (n && window.AtlasInspecaoTela && AtlasInspecaoTela.irPara) AtlasInspecaoTela.irPara('admissao');
    });
  }

  async function importarUI(files) {
    if (!files.length || ui.ocupado) return;
    ui.ocupado = true;
    const prog = $('rf-progresso'), fill = $('rf-barra-fill'), tx = $('rf-prog-tx');
    prog.hidden = false;
    try {
      const res = await importarArquivos(files, { progresso: (p) => {
        if (!fill) return;
        const pct = p.fase === 'fim' ? 100 : Math.round(((p.i || 0) / Math.max(1, p.n || 1)) * (p.fase === 'lendo' ? 50 : 50) + (p.fase === 'gravando' ? 50 : 0));
        fill.style.width = pct + '%';
        tx.textContent = p.fase === 'lendo' ? `Lendo ${p.i + 1}/${p.n}: ${p.arquivo}`
          : p.fase === 'gravando' ? `Gravando ${p.i + 1}/${p.n}: ${p.arquivo}` : 'Concluído';
      } });
      pintarLista();
      const partes = [];
      if (res.importados.length) partes.push(`${res.importados.length} relatório${res.importados.length > 1 ? 's' : ''} importado${res.importados.length > 1 ? 's' : ''}`);
      if (res.cancelados.length) partes.push(`${res.cancelados.length} cancelado${res.cancelados.length > 1 ? 's' : ''}`);
      if (res.erros.length) partes.push(`${res.erros.length} com erro`);
      const semAdm = res.importados.reduce((s, r) => s + (r.semAdmissao || 0), 0);
      if (semAdm) partes.push(`${semAdm} linha${semAdm > 1 ? 's' : ''} sem admissão (paciente + data não casou)`);
      Utilidades.toast?.(`✓ ${partes.join(' · ') || 'nada importado'}`, res.erros.length && !res.importados.length ? 'error' : 'success', 6000);
      if (res.erros.length) console.warn('[relatorio_final] erros de importação:', res.erros);
      pintarErros(res);
    } catch (e) {
      console.error(e);
      Utilidades.toast?.('Falha na importação: ' + (e.message || e), 'error', 5000);
    } finally {
      ui.ocupado = false;
      setTimeout(() => { if (prog) prog.hidden = true; }, 900);
    }
  }
  function pintarErros(res) {
    const alvo = $('rf-lista');
    if (!alvo) return;
    const blocos = [];
    for (const e of res.erros) blocos.push(`<div class="rf-aviso rf-aviso-erro">✗ <strong>${esc(e.arquivo)}</strong>: ${esc(e.erro)}</div>`);
    for (const r of res.importados) for (const a of r.avisos || []) blocos.push(`<div class="rf-aviso">⚠ <strong>${esc(r.arquivo)}</strong>: ${esc(a)}</div>`);
    if (blocos.length) alvo.insertAdjacentHTML('afterbegin', `<div class="rf-avisos">${blocos.join('')}</div>`);
  }

  function idsSelecionados() {
    const lista = listarTodos();
    const ids = lista.filter(r => ui.sel.has(r.id)).map(r => r.id);
    if (ids.length) return ids;
    return filtrados().map(r => r.id).concat(mesesFiltrados().map(r => r.id));
  }
  function mesesFiltrados() {
    return mesesDaFerramenta().filter(r => !ui.filtroComp || r.competencia === ui.filtroComp);
  }
  function filtrados() {
    const b = normNome(ui.busca);
    const fm = normNome(ui.filtroMed);   // ATLAS v1.3.3: pelo nome normalizado (duas grafias = um médico)
    return listar().filter(r => (!fm || r.medico_norm === fm) && (!ui.filtroComp || r.competencia === ui.filtroComp)
      && (!b || normNome(r.medico + ' ' + r.arquivo + ' ' + r.competencia).includes(b)));
  }
  // ATLAS v1.3.3: o médico auditado (gravado no banco) — recorta os meses da
  // ferramenta e avisa relatórios de outros médicos
  function pintarAuditado() {
    const alvo = $('rf-auditado');
    if (!alvo) return;
    const aud = medicoAuditado();
    const meds = medicosConhecidos();
    alvo.innerHTML = `
      <div class="rf-aud-linha">
        <label class="rf-aud-lbl" for="rf-medico-aud"><i class="ti ti-user-search"></i> Médico auditado</label>
        <input type="text" id="rf-medico-aud" class="rf-aud-input" list="rf-dl-medicos-aud" placeholder="todos os médicos" value="${esc(aud)}" autocomplete="off">
        <datalist id="rf-dl-medicos-aud">${meds.map(m => `<option value="${esc(m)}"></option>`).join('')}</datalist>
        <button type="button" class="rf-mini" id="rf-medico-aud-ok" title="Gravar o médico auditado">Aplicar</button>
        ${aud ? '<button type="button" class="rf-mini" id="rf-medico-aud-limpar" title="Auditar todos os médicos">todos</button>' : ''}
        <span class="rf-aud-hint">${aud
          ? `A auditoria é de <b>${esc(CodigoMedico.exibir(aud))}</b>: os meses da ferramenta usam só as linhas dele no Consolidado; relatório importado de outro médico é avisado.`
          : 'Sem médico auditado, os meses da ferramenta auditam <b>todos</b> os médicos do Consolidado. Escolha o médico para restringir.'}</span>
      </div>`;
    const aplicar = () => {
      const v = $('rf-medico-aud').value.trim();
      const oficial = definirMedicoAuditado(v);
      const on = normNome(oficial);
      ui.filtroMed = on && listar().some(r => r.medico_norm === on) ? oficial : '';
      ui.sel = new Set();
      pintarLista();
      Utilidades.toast?.(oficial ? `✓ Médico auditado: ${oficial}` : '✓ Auditando todos os médicos', 'success', 3000);
    };
    $('rf-medico-aud-ok')?.addEventListener('click', aplicar);
    $('rf-medico-aud')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); aplicar(); } });
    $('rf-medico-aud-limpar')?.addEventListener('click', () => { $('rf-medico-aud').value = ''; aplicar(); });
  }
  function pintarLista() {
    const alvo = $('rf-lista'), filt = $('rf-filtros');
    if (!alvo) return;
    pintarAuditado();
    const audNorm = normNome(medicoAuditado());
    const lista = listar();
    // ATLAS v1.3.3: um médico por nome normalizado (a 1ª grafia representa)
    const medsMap = new Map();
    for (const r of lista) if (r.medico_norm && !medsMap.has(r.medico_norm)) medsMap.set(r.medico_norm, r.medico);
    const meds = [...medsMap.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const fmSel = normNome(ui.filtroMed);
    const comps = [...new Set(lista.map(r => r.competencia))].sort().reverse();
    filt.innerHTML = lista.length ? `
      <label class="atlas-ff-wrap"><span class="atlas-ff-pre">Médico</span><span class="atlas-ff-divr"></span>
        <select class="atlas-ff-sel" id="rf-f-med"><option value="">todos</option>${meds.map(m => `<option value="${esc(m)}" ${fmSel && normNome(m) === fmSel ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
      <label class="atlas-ff-wrap"><span class="atlas-ff-pre">Mês</span><span class="atlas-ff-divr"></span>
        <select class="atlas-ff-sel" id="rf-f-comp"><option value="">todos</option>${comps.map(c => `<option value="${esc(c)}" ${ui.filtroComp === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="atlas-ff-wrap"><span class="atlas-ff-pre">Buscar</span><span class="atlas-ff-divr"></span>
        <input type="text" class="atlas-ff-sel" id="rf-f-busca" placeholder="médico, arquivo…" value="${esc(ui.busca)}"></label>
      <span class="rf-contagem">${lista.length} relatório${lista.length !== 1 ? 's' : ''} · ${meds.length} médico${meds.length !== 1 ? 's' : ''} · ${comps.length} m${comps.length !== 1 ? 'eses' : 'ês'}</span>` : '';
    const vis = filtrados();
    if (!lista.length) {
      alvo.innerHTML = `<div class="rf-vazio">Nenhum relatório final importado ainda.<br>Importe os relatórios manuais (de antes de ${esc(fmtComp(desdeFerramenta()))}) que os médicos receberam — um arquivo por médico e mês. Dos meses da ferramenta em diante, o Consolidado abaixo já é o relatório final.</div>`;
    } else {
      const todosSel = vis.length && vis.every(r => ui.sel.has(r.id));
      alvo.innerHTML = `
        <div class="rf-tab-wrap"><table class="rf-tab">
          <thead><tr>
            <th class="rf-chk"><input type="checkbox" id="rf-sel-todos" ${todosSel ? 'checked' : ''} title="Marcar todos os visíveis"></th>
            <th>Médico</th><th>Mês</th><th>Layout</th><th class="num">Linhas</th><th class="num">Total recebido</th><th>Arquivo</th><th>Importado em</th><th></th>
          </tr></thead>
          <tbody>${vis.map(r => `
            <tr data-id="${r.id}" class="${ui.sel.has(r.id) ? 'sel' : ''} ${audNorm && r.medico_norm !== audNorm ? 'rf-outro' : ''}">
              <td class="rf-chk"><input type="checkbox" class="rf-sel" data-id="${r.id}" ${ui.sel.has(r.id) ? 'checked' : ''}></td>
              <td class="rf-med">${esc(CodigoMedico.exibir(r.medico))}${audNorm && r.medico_norm !== audNorm ? ' <span class="rf-outro-tag" title="Não é o médico auditado">outro médico</span>' : ''}</td>
              <td class="mono">${esc(r.competencia)}${r.competencia_arquivo && r.competencia_arquivo !== r.competencia
                ? ` <span class="rf-comp-arq" title="O arquivo indica ${esc(fmtComp(r.competencia_arquivo))}; as admissões estão no sistema de ${esc(fmtComp(r.competencia))}">arquivo: ${esc(fmtComp(r.competencia_arquivo))}</span>` : ''}</td>
              <td><span class="rf-layout rf-layout-${esc(r.layout || '')}">${esc(rotuloLayout(r.layout))}</span></td>
              <td class="num mono">${r.n_linhas}</td>
              <td class="num mono" data-ocultavel>R$ ${fmtN(r.total)}</td>
              <td class="rf-arq" title="${esc(r.arquivo)}">${esc(r.arquivo)}</td>
              <td class="mono">${esc(String(r.importado_em || '').slice(0, 16).replace('T', ' '))}</td>
              <td class="rf-row-acoes">
                <button type="button" class="rf-mini" data-ver="${r.id}" title="Ver as linhas deste relatório">Ver</button>
                <button type="button" class="rf-mini rf-mini-x" data-remover="${r.id}" title="Remover este relatório">Remover</button>
              </td>
            </tr>`).join('')}
          </tbody></table></div>`;
    }
    // ATLAS v1.3.2: os meses em que o relatório final é o da própria ferramenta
    const desde = desdeFerramenta();
    const meses = mesesFiltrados();
    // ATLAS v1.3.3: com médico auditado, cada mês mostra as linhas e o total DELE
    // no Consolidado (calculado em seguida, mês a mês, sem travar) e o "Ver" abre só ele
    const audNome = medicoAuditado();
    alvo.insertAdjacentHTML('beforeend', `
      <div class="rf-ferr" id="rf-ferr">
        <div class="rf-ferr-head">
          <div class="rf-ferr-tit">Relatórios finais da própria ferramenta</div>
          <div class="rf-ferr-tx">Desde <input type="month" id="rf-desde" class="rf-desde" value="${esc(desde)}"> o relatório que o médico recebe é o <b>Consolidado</b> desta ferramenta — não precisa importar arquivo. O que está no Consolidado conta como pago; a auditoria cobra o que o sistema recebeu com regra na Base Tabela e ficou sem pagamento. Arquivo importado do mesmo médico × mês vale mais que o Consolidado.</div>
        </div>
        ${meses.length ? `
        <div class="rf-tab-wrap"><table class="rf-tab">
          <thead><tr><th class="rf-chk"></th><th>Mês</th><th>Fonte</th><th class="num">${audNorm ? 'Linhas do médico auditado' : 'Linhas do Consolidado'}</th><th class="num">${audNorm ? 'Total repassado a ele' : 'Total repassado'}</th><th></th></tr></thead>
          <tbody>${meses.map(r => `
            <tr data-id="${esc(r.id)}" class="${ui.sel.has(r.id) ? 'sel' : ''}">
              <td class="rf-chk"><input type="checkbox" class="rf-sel-v" data-id="${esc(r.id)}" ${ui.sel.has(r.id) ? 'checked' : ''}></td>
              <td class="mono">${esc(r.competencia)}</td>
              <td><span class="rf-layout rf-layout-ferramenta">Consolidado da ferramenta</span>${audNorm ? ` <span class="rf-aud-tag" title="Só as linhas do médico auditado">${esc(CodigoMedico.exibir(audNome))}</span>` : ''}</td>
              <td class="num mono" data-aud-n="${esc(r.competencia)}">${audNorm ? '…' : r.n_linhas}</td>
              <td class="num mono" data-ocultavel data-aud-total="${esc(r.competencia)}">${audNorm ? '…' : 'R$ ' + fmtN(r.total)}</td>
              <td class="rf-row-acoes"><button type="button" class="rf-mini" data-ver-v="${esc(audNorm ? r.id + '|' + audNorm : r.id)}" title="${audNorm ? 'Ver as linhas do médico auditado no Consolidado deste mês' : 'Ver as linhas do Consolidado deste mês'}">Ver</button></td>
            </tr>`).join('')}
          </tbody></table></div>` : `<div class="rf-vazio rf-vazio-mini">Nenhum mês calculado a partir de ${esc(fmtComp(desde))}. Importe o relatório do sistema e calcule (ou ajuste o mês de início).</div>`}
      </div>`);
    if (audNorm && meses.length) {
      const fila = meses.map(r => r.competencia);
      const passo = () => {
        const comp = fila.shift();
        if (!comp || !alvo.isConnected || normNome(medicoAuditado()) !== audNorm) return;
        const res = resumoDoMedicoNoMes(comp, audNorm);
        const k = String(comp).replace(/[^0-9-]/g, '');   // AAAA-MM (a constante CSS do módulo faz sombra ao window.CSS)
        const cN = alvo.querySelector(`[data-aud-n="${k}"]`), cT = alvo.querySelector(`[data-aud-total="${k}"]`);
        if (cN) { cN.textContent = String(res.n); if (!res.n) cN.closest('tr')?.classList.add('rf-outro'); }
        if (cT) cT.textContent = 'R$ ' + fmtN(res.total);
        if (fila.length) setTimeout(passo, 0);
        else Utilidades.aplicarMascaraValores?.();
      };
      setTimeout(passo, 0);
    }
    const n = ui.sel.size;
    const btnN = $('rf-auditar-n');
    const nVis = vis.length + meses.length;
    if (btnN) btnN.textContent = n ? `(${n} marcado${n > 1 ? 's' : ''})` : (nVis ? `(${nVis} visíve${nVis > 1 ? 'is' : 'l'})` : '');
    $('rf-desde')?.addEventListener('change', (e) => {
      if (definirDesdeFerramenta(e.target.value)) { ui.sel = new Set([...ui.sel].filter(id => !idVirtual(id))); pintarLista(); Utilidades.toast?.(`✓ Relatório final da ferramenta desde ${fmtComp(e.target.value)}`, 'success', 3000); }
      else Utilidades.toast?.('Informe um mês válido (AAAA-MM).', 'warning', 3000);
    });
    alvo.querySelectorAll('.rf-sel-v').forEach(cb => cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) ui.sel.add(id); else ui.sel.delete(id);
      cb.closest('tr').classList.toggle('sel', cb.checked);
      const btn = $('rf-auditar-n'); if (btn) btn.textContent = ui.sel.size ? `(${ui.sel.size} marcado${ui.sel.size > 1 ? 's' : ''})` : '';
    }));
    alvo.querySelectorAll('[data-ver-v]').forEach(b => b.addEventListener('click', () => verLinhas(b.dataset.verV)));
    // eventos
    $('rf-f-med')?.addEventListener('change', (e) => { ui.filtroMed = e.target.value; pintarLista(); });
    $('rf-f-comp')?.addEventListener('change', (e) => { ui.filtroComp = e.target.value; pintarLista(); });
    $('rf-f-busca')?.addEventListener('input', (e) => { ui.busca = e.target.value; clearTimeout(ui._t); ui._t = setTimeout(pintarLista, 200); });
    $('rf-sel-todos')?.addEventListener('change', (e) => { for (const r of vis) { if (e.target.checked) ui.sel.add(r.id); else ui.sel.delete(r.id); } pintarLista(); });
    alvo.querySelectorAll('.rf-sel').forEach(cb => cb.addEventListener('change', () => {
      const id = Number(cb.dataset.id);
      if (cb.checked) ui.sel.add(id); else ui.sel.delete(id);
      cb.closest('tr').classList.toggle('sel', cb.checked);
      const btn = $('rf-auditar-n'); if (btn) btn.textContent = ui.sel.size ? `(${ui.sel.size} marcado${ui.sel.size > 1 ? 's' : ''})` : '';
    }));
    alvo.querySelectorAll('[data-remover]').forEach(b => b.addEventListener('click', async () => {
      const id = Number(b.dataset.remover);
      const r = listar().find(x => x.id === id);
      if (!r) return;
      if (!await Utilidades.confirmar(`Remover o relatório final de ${r.medico} · ${r.competencia}?`)) return;
      remover(id); ui.sel.delete(id); pintarLista();
      Utilidades.toast?.('Relatório removido.', 'info', 2500);
    }));
    alvo.querySelectorAll('[data-ver]').forEach(b => b.addEventListener('click', () => verLinhas(Number(b.dataset.ver))));
  }
  function rotuloLayout(l) { return l === 'ferramenta' ? 'ferramenta' : l === 'manual2' ? 'manual (c/ admissão)' : l === 'manual1' ? 'manual (s/ admissão)' : (l || '—'); }

  function verLinhas(id) {
    const vid = idVirtual(id);   // ATLAS v1.3.3: 'f|AAAA-MM|medNorm' → o mês, só as linhas daquele médico
    const r0 = listarTodos().find(x => String(x.id) === String(vid && vid.medNorm ? 'f|' + vid.comp : id));
    if (!r0) return;
    const linhas = linhasDoRelatorio(id);
    const r = vid && vid.medNorm ? Object.assign({}, r0, { medico: (linhas[0] && linhas[0].medico) || CodigoMedico.exibir(medicoAuditado()), arquivo: 'Consolidado da ferramenta · só o médico auditado' }) : r0;
    const ov = document.createElement('div');
    ov.className = 'rf-modal-ov';
    ov.innerHTML = `
      <div class="rf-modal rf-modal-larga" role="dialog" aria-modal="true">
        <div class="rf-modal-head"><strong>${esc(r.virtual ? (vid && vid.medNorm ? CodigoMedico.exibir(r.medico) + ' · Consolidado da ferramenta' : 'Consolidado da ferramenta') : CodigoMedico.exibir(r.medico))} · ${esc(r.competencia)}</strong>
          <span>${esc(r.arquivo)} · ${linhas.length} linhas · ${r.virtual ? 'repassado' : 'recebido'} R$ ${fmtN(linhas.reduce((s, l) => s + (l.glosa ? 0 : (Number(l.valor) || 0)), 0))}${r.periodo_ini ? ` · pagamentos de ${dataBR(r.periodo_ini)} a ${dataBR(r.periodo_fim)}` : ''}</span>
          <button type="button" class="rf-modal-x" data-fechar>×</button></div>
        <div class="rf-tab-wrap rf-modal-scroll"><table class="rf-tab">
          <thead><tr>${r.virtual ? '<th>Médico</th>' : ''}<th>Status</th><th>Módulo</th><th>Admissão</th><th>Data</th><th>Papel</th><th>Paciente</th><th>Origem</th><th>Convênio</th><th>Procedimento</th><th class="num">Valor</th></tr></thead>
          <tbody>${linhas.map(l => `<tr class="${l.glosa ? 'rf-glosa' : ''}">
            ${r.virtual ? `<td>${esc(CodigoMedico.exibir(l.medico || ''))}</td>` : ''}<td>${esc(l.status)}</td><td>${esc(l.modulo)}</td>
            <td class="mono"><button type="button" class="rf-link" data-adm="${esc(l.admissao)}">${esc(l.admissao || '—')}</button></td>
            <td class="mono">${esc(dataBR(l.data))}</td><td>${esc(l.papel)}</td><td>${esc(I().nomePaciente ? I().nomePaciente(l.paciente) : l.paciente)}</td>
            <td>${l.origem ? Utilidades.badgeFonte(l.origem) : ''}</td><td>${esc(l.convenio)}</td><td>${esc(l.procedimento)}</td>
            <td class="num mono" data-ocultavel>R$ ${fmtN(l.valor)}</td></tr>`).join('')}
          </tbody></table></div>
      </div>`;
    document.body.appendChild(ov);
    const fechar = () => ov.remove();
    ov.querySelector('[data-fechar]').addEventListener('click', fechar);
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    ov.querySelectorAll('[data-adm]').forEach(b => b.addEventListener('click', () => { fechar(); abrirAdmissao(b.dataset.adm); }));
    Utilidades.aplicarMascaraValores?.();
  }
  function abrirAdmissao(adm) {
    if (!adm) return;
    if (window.AtlasInspecaoTela && AtlasInspecaoTela.abrirAdmissao) AtlasInspecaoTela.abrirAdmissao(adm);
    else if (window.AtlasInspecao && AtlasInspecao.inspecionarAdmissao) AtlasInspecao.inspecionarAdmissao(adm);
  }

  async function auditarUI() {
    if (ui.ocupado) return;
    const ids = idsSelecionados();
    if (!ids.length) { Utilidades.toast?.('Importe ao menos um relatório final.', 'warning', 3000); return; }
    ui.ocupado = true;
    const prog = $('rf-progresso'), fill = $('rf-barra-fill'), tx = $('rf-prog-tx');
    prog.hidden = false; fill.style.width = '2%'; tx.textContent = 'Preparando…';
    const btn = $('rf-auditar'); if (btn) btn.disabled = true;
    try {
      ui.resultado = await auditar(ids, { progresso: (p) => {
        const pct = p.fase === 'fim' ? 100 : p.fase === 'competencia' ? Math.round(((p.i || 0) / Math.max(1, p.n)) * 40)
          : 40 + Math.round(((p.i || 0) / Math.max(1, p.n)) * 60);
        fill.style.width = pct + '%';
        tx.textContent = p.fase === 'competencia' ? `Montando o "deveria" de ${p.competencia} (${p.i + 1}/${p.n})`
          : p.fase === 'relatorio' ? `Confrontando ${p.medico} · ${p.competencia} (${p.i + 1}/${p.n})` : 'Concluído';
      } });
      ui.cats = new Set(); ui.buscaRes = ''; ui.medRes = ''; ui.compRes = '';
      pintarResultado();
      const t = ui.resultado.totais;
      Utilidades.toast?.(`✓ Auditoria: ${ui.resultado.porRelatorio.length} relatório(s) · falta pagar R$ ${fmtN(t.falta)}`, t.falta > 0 ? 'warning' : 'success', 6000);
      $('rf-resultado')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      Utilidades.toast?.('Falha na auditoria: ' + (e.message || e), 'error', 5000);
    } finally {
      ui.ocupado = false;
      if (btn) btn.disabled = false;
      setTimeout(() => { if (prog) prog.hidden = true; }, 900);
    }
  }

  function itensVisiveis() {
    const res = ui.resultado;
    if (!res) return [];
    const b = normNome(ui.buscaRes);
    return res.itens.filter(it => (!ui.cats.size || ui.cats.has(it.categoria))
      && (!ui.medRes || it.medico === ui.medRes) && (!ui.compRes || it.competencia === ui.compRes)
      && (!b || normNome([it.admissao, it.paciente, it.procedimento, it.papel, it.medico, it.rotulo].join(' ')).includes(b)));
  }
  function pintarResultado() {
    const alvo = $('rf-resultado');
    const res = ui.resultado;
    if (!alvo || !res) return;
    alvo.hidden = false;
    const t = res.totais;
    const meds = [...new Set(res.itens.map(i => i.medico))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const comps = [...new Set(res.itens.map(i => i.competencia))].sort().reverse();
    const vis = itensVisiveis();
    const totVis = totais(vis);
    const cats = Object.keys(CATEGORIAS).filter(k => t.porCategoria[k]);
    alvo.innerHTML = `
      <div class="rf-head">
        <div>
          <h3>O que falta pagar</h3>
          <p>Deveria (Consolidado da ferramenta) × recebido (relatório final), por admissão e papel. ${res.porRelatorio.length} relatório${res.porRelatorio.length !== 1 ? 's' : ''} · ${res.competencias.join(', ')}.${res.medicoAuditado ? ` Médico auditado: <strong>${esc(CodigoMedico.exibir(res.medicoAuditado))}</strong>.` : ''}</p>
        </div>
        <div class="rf-acoes">
          <button type="button" class="btn" id="rf-pauta-falta" title="Manda para a pauta da aba Admissão as admissões com valor faltante">Pauta do que falta</button>
          <button type="button" class="btn btn-primary" id="rf-exportar"><i class="ti ti-file-spreadsheet"></i> Exportar Excel</button>
        </div>
      </div>
      ${res.avisos.length ? `<div class="rf-avisos">${res.avisos.map(a => `<div class="rf-aviso">⚠ ${esc(a)}</div>`).join('')}</div>` : ''}
      <div class="rf-kpis">
        <div class="rf-kpi"><span class="rf-kpi-lbl">Deveria</span><span class="rf-kpi-val" data-ocultavel>R$ ${fmtN(t.deveria)}</span></div>
        <div class="rf-kpi"><span class="rf-kpi-lbl">Recebido</span><span class="rf-kpi-val" data-ocultavel>R$ ${fmtN(t.recebido)}</span></div>
        <div class="rf-kpi rf-kpi-falta"><span class="rf-kpi-lbl">Falta pagar</span><span class="rf-kpi-val" data-ocultavel>R$ ${fmtN(t.falta)}</span></div>
        <div class="rf-kpi rf-kpi-aviso"><span class="rf-kpi-lbl">Sem lastro</span><span class="rf-kpi-val" data-ocultavel>R$ ${fmtN(t.semLastro)}</span></div>
      </div>
      <div class="rf-resumo">
        <div class="rf-tab-wrap"><table class="rf-tab rf-tab-resumo">
          <thead><tr><th>Médico</th><th>Mês</th><th>Admissões do relatório</th><th class="num">Deveria</th><th class="num">Recebido</th><th class="num">Falta pagar</th><th class="num">Sem lastro</th><th class="num">Itens</th></tr></thead>
          <tbody>${res.porRelatorio.map(r => {
            const c = r.cobertura || { n: 0, noMes: 0, outros: [], nenhum: 0, semAdmissao: 0 };
            const ruim = c.n && c.noMes < c.n * 0.5;
            const cob = c.n ? `<span class="rf-cob ${ruim ? 'rf-cob-ruim' : ''}" title="Onde a ferramenta tem as admissões deste relatório">${c.n} · <b>${c.noMes}</b> no mês${c.outros.length ? ' · ' + c.outros.slice(0, 3).map(o => `${o.n} em ${esc(fmtComp(o.competencia))}`).join(', ') : ''}${c.nenhum ? ` · <b>${c.nenhum}</b> em nenhum` : ''}${c.semAdmissao ? ` · ${c.semAdmissao} s/ admissão` : ''}</span>` : '—';
            return `<tr class="${r.falta > 0.004 ? 'rf-tem-falta' : ''}">
            <td>${esc(CodigoMedico.exibir(r.medico))}</td><td class="mono">${esc(r.competencia)}${r.competencia_arquivo && r.competencia_arquivo !== r.competencia ? ` <span class="rf-comp-arq">arquivo: ${esc(fmtComp(r.competencia_arquivo))}</span>` : ''}</td>
            <td>${cob}</td>
            <td class="num mono" data-ocultavel>R$ ${fmtN(r.deveria)}</td><td class="num mono" data-ocultavel>R$ ${fmtN(r.recebido)}</td>
            <td class="num mono rf-falta" data-ocultavel>R$ ${fmtN(r.falta)}</td><td class="num mono" data-ocultavel>R$ ${fmtN(r.semLastro)}</td><td class="num mono">${r.n}</td></tr>`; }).join('')}
          </tbody></table></div>
      </div>
      <div class="rf-cats">
        ${cats.map(k => `<button type="button" class="rf-cat rf-cat-${CATEGORIAS[k].tom} ${ui.cats.has(k) ? 'ativa' : ''}" data-cat="${k}">
          ${esc(CATEGORIAS[k].rotulo)} <b>${t.porCategoria[k].n}</b>${CATEGORIAS[k].soma ? ` <span data-ocultavel>R$ ${fmtN(t.porCategoria[k].valor)}</span>` : ''}</button>`).join('')}
        ${ui.cats.size ? '<button type="button" class="rf-cat rf-cat-limpar" data-cat="">limpar</button>' : ''}
      </div>
      <div class="rf-filtros">
        <label class="atlas-ff-wrap"><span class="atlas-ff-pre">Médico</span><span class="atlas-ff-divr"></span>
          <select class="atlas-ff-sel" id="rf-r-med"><option value="">todos</option>${meds.map(m => `<option value="${esc(m)}" ${ui.medRes === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        <label class="atlas-ff-wrap"><span class="atlas-ff-pre">Mês</span><span class="atlas-ff-divr"></span>
          <select class="atlas-ff-sel" id="rf-r-comp"><option value="">todos</option>${comps.map(c => `<option value="${esc(c)}" ${ui.compRes === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="atlas-ff-wrap"><span class="atlas-ff-pre">Buscar</span><span class="atlas-ff-divr"></span>
          <input type="text" class="atlas-ff-sel" id="rf-r-busca" placeholder="admissão, paciente, procedimento…" value="${esc(ui.buscaRes)}"></label>
        <span class="rf-contagem">${vis.length} de ${res.itens.length} itens · falta <span data-ocultavel>R$ ${fmtN(totVis.falta)}</span></span>
      </div>
      <div class="rf-tab-wrap rf-tab-itens"><table class="rf-tab">
        <thead><tr><th>Categoria</th><th>Mês</th><th>Médico</th><th>Admissão</th><th>Data</th><th>Paciente</th><th>Procedimento</th><th>Papel</th><th>Origem</th><th class="num">Deveria</th><th class="num">Recebido</th><th class="num">Falta</th></tr></thead>
        <tbody>${vis.slice(0, 2000).map(it => `<tr class="rf-it rf-it-${it.tom}" data-adm="${esc(it.admissao)}" title="Abrir a admissão na aba Admissão">
          <td><span class="rf-cat-tag rf-cat-${it.tom}">${esc(it.rotulo)}</span></td>
          <td class="mono">${esc(it.competencia)}${it.foraDoMes ? ` <span class="rf-fora" title="A ferramenta pagou esta admissão em ${esc(fmtComp(it.competencia))}; o relatório é de ${esc(fmtComp(it.compRecebido))}">≠ ${esc(fmtComp(it.compRecebido))}</span>` : ''}</td><td>${esc(CodigoMedico.exibir(it.medico))}</td>
          <td class="mono">${esc(it.admissao || '—')}</td><td class="mono">${esc(dataBR(it.data))}</td>
          <td>${esc(I().nomePaciente ? I().nomePaciente(it.paciente) : it.paciente)}</td><td>${esc(it.procedimento)}</td><td>${esc(it.papel)}</td>
          <td>${it.origem ? Utilidades.badgeFonte(it.origem) : ''}</td>
          <td class="num mono" data-ocultavel>R$ ${fmtN(it.deveria)}</td>
          <td class="num mono" data-ocultavel>R$ ${fmtN(it.recebido)}${it.recDoConsolidado ? ' <span class="rf-do-cons" title="Esta linha não está no arquivo importado; ela está no Consolidado do mês, que nesse período é o relatório final — por isso conta como paga">Consolidado</span>' : ''}</td>
          <td class="num mono rf-falta" data-ocultavel>${it.falta > 0.004 ? 'R$ ' + fmtN(it.falta) : ''}</td></tr>`).join('')}
        </tbody></table>
        ${vis.length > 2000 ? `<div class="rf-truncado">Mostrando 2.000 de ${vis.length} itens — refine os filtros ou exporte o Excel.</div>` : ''}
      </div>`;
    alvo.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.cat;
      if (!k) ui.cats.clear(); else if (ui.cats.has(k)) ui.cats.delete(k); else ui.cats.add(k);
      pintarResultado();
    }));
    $('rf-r-med')?.addEventListener('change', (e) => { ui.medRes = e.target.value; pintarResultado(); });
    $('rf-r-comp')?.addEventListener('change', (e) => { ui.compRes = e.target.value; pintarResultado(); });
    $('rf-r-busca')?.addEventListener('input', (e) => { ui.buscaRes = e.target.value; clearTimeout(ui._t2); ui._t2 = setTimeout(pintarResultado, 220); });
    $('rf-exportar')?.addEventListener('click', () => exportarExcel({ ...res, itens: vis }));
    $('rf-pauta-falta')?.addEventListener('click', () => {
      const itens = res.itens.filter(i => i.falta > 0.004 && i.admissao_norm).map(i => ({ admissao: i.admissao, paciente: i.paciente, data: i.data }));
      const n = window.AtlasInspecao && AtlasInspecao.definirPauta ? AtlasInspecao.definirPauta(itens) : 0;
      Utilidades.toast?.(n ? `✓ ${n} admissões com valor faltante na pauta` : 'Nada faltando — pauta não alterada', n ? 'success' : 'info', 3500);
      if (n && window.AtlasInspecaoTela && AtlasInspecaoTela.irPara) AtlasInspecaoTela.irPara('admissao');
    });
    alvo.querySelectorAll('tr.rf-it').forEach(tr => tr.addEventListener('click', () => abrirAdmissao(tr.dataset.adm)));
    Utilidades.aplicarMascaraValores?.();
  }

  const CSS = `
    .rf-wrap { display: flex; flex-direction: column; gap: 16px; }
    .rf-card { padding: 18px 20px 20px; }
    .rf-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; flex-wrap: wrap; margin-bottom: 12px; }
    .rf-head h3 { margin: 0 0 4px; font-size: 20px; }
    .rf-head p { margin: 0; font-size: 12.5px; color: var(--ink-soft, #585d62); max-width: 720px; line-height: 1.45; }
    .rf-acoes { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .rf-btn-importar { cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
    .rf-drop { border: 2px dashed var(--border, #eef0f2); border-radius: 14px; padding: 12px; text-align: center; font-size: 12px; color: var(--ink-faint, #8a9096); margin-bottom: 12px; transition: all .15s; }
    .rf-drop.ativo { border-color: var(--primary, #5980a6); background: var(--accent-soft, #e4eaf1); color: var(--accent-text, #3f6489); }
    .rf-progresso { margin: 0 0 12px; }
    .rf-barra { height: 8px; border-radius: 999px; background: var(--bg-sunken, #f2f3f5); overflow: hidden; }
    .rf-barra-fill { height: 100%; width: 0; background: var(--primary, #5980a6); transition: width .2s; }
    .rf-prog-tx { font-size: 11.5px; color: var(--ink-soft, #585d62); margin-top: 4px; }
    .rf-filtros { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
    .rf-filtros .atlas-ff-wrap { min-width: 180px; }
    .rf-contagem { margin-left: auto; font-size: 11.5px; color: var(--ink-soft, #585d62); font-weight: 600; }
    .rf-vazio { padding: 26px; text-align: center; color: var(--ink-faint, #8a9096); font-size: 13px; line-height: 1.6; border: 1px dashed var(--border, #eef0f2); border-radius: 14px; }
    .rf-tab-wrap { overflow: auto; border-radius: 14px; border: 1px solid var(--border, #eef0f2); }
    .rf-tab-itens { max-height: 62vh; }
    .rf-modal-scroll { max-height: 70vh; }
    .rf-tab { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11.5px; }
    .rf-tab th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-faint, #8a9096); padding: 8px 10px; position: sticky; top: 0; background: #fff; z-index: 1; border-bottom: 1px solid var(--border, #eef0f2); }
    .rf-tab td { padding: 6px 10px; border-bottom: 1px solid #f2f3f5; vertical-align: middle; }
    .rf-tab tbody tr:nth-child(even) td { background: #f7f8fa; }
    .rf-tab tbody tr:hover td { background: #f2f4f7; }
    .rf-tab tr.sel td { background: var(--accent-soft, #e4eaf1) !important; }
    .rf-tab .num { text-align: right; white-space: nowrap; }
    .rf-tab .mono { font-family: var(--font-mono, monospace); white-space: nowrap; }
    .rf-chk { width: 28px; text-align: center; }
    .rf-med { font-weight: 600; }
    .rf-arq { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-soft, #585d62); }
    .rf-layout { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: #eef2f6; color: #3f6489; white-space: nowrap; }
    .rf-layout-manual1, .rf-layout-manual2 { background: #fbf3e3; color: #8a6d2f; }
    .rf-auditado { margin: 0 0 12px; }
    .rf-aud-linha { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 12px; border-radius: 14px; background: var(--accent-soft, #e4eaf1); }
    .rf-aud-lbl { font-size: 12px; font-weight: 700; color: var(--accent-text, #3f6489); display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
    .rf-aud-input { font-family: inherit; font-size: 12.5px; padding: 6px 10px; border: 1px solid var(--border, #eef0f2); border-radius: 10px; min-width: 280px; background: #fff; }
    .rf-aud-hint { font-size: 11.5px; color: var(--ink-soft, #585d62); line-height: 1.4; }
    .rf-aud-hint b { color: var(--ink, #1d1f20); }
    tr.rf-outro td { color: var(--ink-faint, #8a9096); }
    .rf-aud-tag { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: #eef2f6; color: #3f6489; margin-left: 4px; white-space: nowrap; }
    .rf-outro-tag { display: inline-block; font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .3px; padding: 1px 6px; border-radius: 999px; background: #fbf3e3; color: #8a6d2f; margin-left: 4px; }
    .rf-ferr { margin-top: 16px; padding-top: 12px; border-top: 1px dashed var(--border, #eef0f2); }
    .rf-ferr-head { margin-bottom: 8px; }
    .rf-ferr-tit { font-size: 13px; font-weight: 700; margin-bottom: 3px; }
    .rf-ferr-tx { font-size: 12px; color: var(--ink-soft, #585d62); line-height: 1.6; max-width: 980px; }
    .rf-ferr-tx b { font-weight: 700; color: var(--ink, #1d1f20); }
    .rf-desde { font-family: inherit; font-size: 12px; padding: 2px 6px; border: 1px solid var(--border, #eef0f2); border-radius: 8px; margin: 0 4px; }
    .rf-vazio-mini { padding: 12px; font-size: 12px; }
    .rf-comp-arq, .rf-fora { display: inline-block; font-family: inherit; font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: #fbf3e3; color: #8a6d2f; white-space: nowrap; margin-left: 4px; }
    .rf-cob { font-size: 11px; color: var(--ink-soft, #585d62); white-space: nowrap; }
    .rf-cob b { font-weight: 800; color: var(--ink, #1d1f20); }
    .rf-cob-ruim { color: #a15646; } .rf-cob-ruim b { color: #a15646; }
    .rf-row-acoes { white-space: nowrap; text-align: right; }
    .rf-mini { font-size: 11px; padding: 3px 9px; border-radius: 8px; border: 1px solid var(--border, #eef0f2); background: #fff; cursor: pointer; color: var(--ink, #1d1f20); }
    .rf-mini:hover { background: var(--accent-soft, #e4eaf1); }
    .rf-mini-x { color: #a15646; }
    .rf-link { border: none; background: none; color: #3f6489; font-weight: 700; cursor: pointer; padding: 0; font-family: inherit; text-decoration: underline dotted; }
    .rf-lista-acoes { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .rf-avisos { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
    .rf-aviso { font-size: 11.5px; padding: 6px 10px; border-radius: 10px; background: #fbf3e3; color: #6b4f1d; }
    .rf-aviso-erro { background: #faf5f3; color: #a15646; }
    .rf-glosa td { color: #c07a66; }
    .rf-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin: 6px 0 14px; }
    .rf-kpi { padding: 12px 14px; border-radius: 16px; background: #f7f8fa; display: flex; flex-direction: column; gap: 2px; }
    .rf-kpi-lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-faint, #8a9096); }
    .rf-kpi-val { font-size: 20px; font-weight: 700; font-family: var(--font-mono, monospace); color: var(--ink, #1d1f20); }
    .rf-kpi-falta { background: #faf5f3; } .rf-kpi-falta .rf-kpi-val { color: #a15646; }
    .rf-kpi-aviso { background: #fbf3e3; } .rf-kpi-aviso .rf-kpi-val { color: #8a6d2f; }
    .rf-resumo { margin-bottom: 12px; }
    .rf-tab-resumo tr.rf-tem-falta .rf-falta { color: #a15646; font-weight: 800; }
    .rf-falta { color: #a15646; font-weight: 700; }
    .rf-cats { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
    .rf-cat { font-size: 11px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border, #eef0f2); background: #fff; cursor: pointer; color: var(--ink, #1d1f20); font-family: inherit; }
    .rf-cat b { font-weight: 800; margin-left: 2px; }
    .rf-cat.ativa { background: var(--primary, #5980a6); border-color: var(--primary, #5980a6); color: #fff; }
    .rf-cat-falta:not(.ativa) { color: #a15646; border-color: #e8cfc7; }
    .rf-cat-aviso:not(.ativa) { color: #8a6d2f; border-color: #eadcb8; }
    .rf-cat-ok:not(.ativa) { color: #3c6b45; border-color: #cfdfd1; }
    .rf-cat-limpar { color: var(--ink-faint, #8a9096); border-style: dashed; }
    .rf-cat-tag { display: inline-block; font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .3px; padding: 1px 7px; border-radius: 999px; background: #eef2f6; color: #3f6489; white-space: nowrap; }
    .rf-cat-tag.rf-cat-falta { background: #faf5f3; color: #a15646; }
    .rf-cat-tag.rf-cat-aviso { background: #fbf3e3; color: #8a6d2f; }
    .rf-cat-tag.rf-cat-ok { background: #e9f1e9; color: #3c6b45; }
    .rf-cat-tag.rf-cat-info { background: #f2f3f5; color: #6b7075; }
    .rf-do-cons { display: inline-block; font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .3px; padding: 1px 6px; border-radius: 999px; background: #eef2f6; color: #3f6489; margin-left: 4px; vertical-align: middle; }
    tr.rf-it { cursor: pointer; }
    .rf-truncado { padding: 8px 12px; font-size: 11.5px; color: var(--ink-soft, #585d62); }
    .rf-modal-ov { position: fixed; inset: 0; z-index: 10000; background: rgba(29, 31, 32, .35); display: flex; align-items: center; justify-content: center; padding: 20px; }
    .rf-modal { background: #fff; border-radius: 20px; box-shadow: 0 24px 60px -20px rgba(29,31,32,.5); width: min(760px, 96vw); max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; }
    .rf-modal-larga { width: min(1500px, 98vw); }
    .rf-modal-head { padding: 14px 18px 10px; border-bottom: 1px solid var(--border, #eef0f2); display: flex; flex-direction: column; gap: 2px; position: relative; }
    .rf-modal-head strong { font-size: 15px; }
    .rf-modal-head span { font-size: 12px; color: var(--ink-soft, #585d62); }
    .rf-modal-x { position: absolute; right: 12px; top: 10px; border: none; background: none; font-size: 22px; cursor: pointer; color: var(--ink-soft, #585d62); }
    .rf-modal-lista { padding: 12px 18px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
    .rf-modal-item { display: grid; grid-template-columns: 1.4fr 1fr 150px; gap: 8px; align-items: center; padding: 8px 10px; border-radius: 12px; background: #f7f8fa; }
    .rf-modal-item.rf-modal-falta { outline: 2px solid #c07a66; }
    .rf-modal-arq { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rf-modal-arq small { display: block; font-weight: 400; color: var(--ink-soft, #585d62); }
    .rf-modal-item input { font-size: 12px; padding: 6px 8px; border: 1px solid var(--border, #eef0f2); border-radius: 10px; font-family: inherit; }
    .rf-modal-acoes { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--border, #eef0f2); }
  `;

  window.AtlasRelatorioFinal = {
    montar, importarArquivos, lerArquivo, listar, remover, linhasDoRelatorio, linhasDaAdmissao, temRelatorio,
    auditar, confrontoDaAdmissao, exportarExcel, garantirCalculo, garantirMotor,
    CATEGORIAS, CATS_FALTA, garantirXLSX, garantirExcelJS,
    competenciaPelosDados, mesesDasAdmissoes,
    desdeFerramenta, definirDesdeFerramenta, mesesDaFerramenta, listarTodos, temRelatorioPara, linhasFinaisDaAdmissao, mesDaFerramenta,
    medicoAuditado, definirMedicoAuditado, medicosConhecidos,
    _interno: { acharCabecalho, compDeTexto, compDoNome, medicoDoNome, papelCanon, confrontarAdmissao, itemDeveria, itemRecebido, totais, ui, catOrigem, lerWorkbook },
  };
})();
