/*
 * ATLAS — INSPEÇÃO DA ADMISSÃO (V747…V907). V926 removeu o módulo; V943 o
 * recoloca SEM cofre/cifra (pedido do usuário): o fonte entra direto no pacote
 * e abre pelo botão "🔎 Inspeção" dos Relatórios (window.AtlasInspecao.abrir).
 */
/* ============================================================================
 * V747: INSPEÇÃO DE ADMISSÃO — rastreia UMA admissão pelas três bases, na
 * ordem em que o dinheiro caminha:
 *
 *   1. QVIS CRU ............ como o repasse chega do módulo Importação
 *                            (linhas_qvis, estrutura original)
 *   2. RELATÓRIOS .......... como a admissão ficou na aba "Relatório Repasse"
 *                            (matriz auditada), varrendo TODAS as competências
 *   3. PRODUÇÃO ANALÍTICA .. o mesmo paciente/admissão no relatório de
 *                            produção importado (linhas_producao)
 *
 * A leitura entre os painéis é o diagnóstico:
 *   • fora do 1º e dentro do 3º → o CONVÊNIO ainda não pagou;
 *   • dentro do 1º e fora do 2º → parou na ferramenta (Calcular ou Auditoria);
 *   • nos três → pago; em nenhum → admissão inexistente nas bases.
 *
 * Nada é pré-carregado: as bases só são consultadas na busca. A importação de
 * planilha do médico casa nome + data APENAS contra a produção analítica e
 * pré-carrega, na lista da direita, as admissões encontradas.
 *
 * Módulo GLOBAL (carrega no boot): window.AtlasInspecao.abrir().
 * ==========================================================================*/
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (n) => Utilidades.formatarNumero(Number(n) || 0, 2);
  const LISTA_KEY = 'insp_lista_import_v1';

  /**
   * ══ V858: CONFIGURAÇÃO QUE VIAJA COM O BANCO ═══════════════════════════
   *
   * A ferramenta roda em DUAS máquinas e o arquivo .db passa de uma para a
   * outra. As vigias e os filtros da extração moravam no localStorage — que
   * NÃO viaja: quem importava o banco abria a Inspeção sem vigia nenhuma e
   * extraía um relatório diferente, sem pista do motivo. Agora o banco é a
   * fonte da verdade (tabela config_inspecao) e o localStorage vira só um
   * espelho local.
   *
   * Migração: na primeira leitura, se o banco ainda não tem a chave mas o
   * navegador tem, o valor local é ADOTADO e gravado — ninguém perde o que já
   * havia cadastrado.
   *
   * Custo de gravação (V857): escrever no banco avança a versão e derruba os
   * caches pesados. Por isso há dois modos:
   *   · cadastro (vigias): grava e agenda a persistência — muda pouco e não
   *     pode se perder;
   *   · recorte (filtros/flag): grava na memória do banco SEM pedir gravação —
   *     o próximo salvamento (ou o flush de saída) leva junto. Assim mexer num
   *     filtro não custa a reconstrução da matriz.
   */
  let _cfgCache = { versao: -1, mapa: null };
  function _cfgMapa() {
    if (_cfgCache.versao === Banco._versao && _cfgCache.mapa) return _cfgCache.mapa;
    const m = new Map();
    try {
      Banco.db.exec(`CREATE TABLE IF NOT EXISTS config_inspecao (
        chave TEXT PRIMARY KEY, valor TEXT, atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);
      for (const r of Banco.query(`SELECT chave, valor FROM config_inspecao`) || []) {
        m.set(r.chave, r.valor);
      }
    } catch (e) { /* banco ainda não pronto: cai no espelho local */ }
    _cfgCache = { versao: Banco._versao, mapa: m };
    return m;
  }
  /** Lê do BANCO; sem valor lá, adota o que houver no navegador (migração). */
  function cfgLer(chave) {
    const m = _cfgMapa();
    if (m.has(chave)) return m.get(chave);
    let local = null;
    try { local = localStorage.getItem(chave); } catch (_) {}
    if (local != null) { cfgGravar(chave, local, { cadastro: true }); return local; }
    return null;
  }
  function cfgGravar(chave, valor, opts) {
    const cadastro = !!(opts && opts.cadastro);
    try {
      Banco.db.exec(`CREATE TABLE IF NOT EXISTS config_inspecao (
        chave TEXT PRIMARY KEY, valor TEXT, atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);
      Banco.executar(
        `INSERT OR REPLACE INTO config_inspecao (chave, valor, atualizado_em)
         VALUES (?, ?, datetime('now'))`, [chave, valor]);
      if (_cfgCache.mapa) _cfgCache.mapa.set(chave, valor);
      // cadastro precisa de gravação garantida; recorte pega carona no
      // próximo salvamento (não derruba os caches pesados — V857)
      if (cadastro && Banco.salvarDebounced) Banco.salvarDebounced(3000);
    } catch (e) { console.warn('[inspecao] config compartilhada:', e); }
    try { localStorage.setItem(chave, valor); } catch (_) {}   // espelho local
  }

  /** Só os dígitos, sem zeros à esquerda — mesmo critério do Calcular/Auditoria. */
  const normAdm = (x) => {
    const s = String(x == null ? '' : x).trim().replace(/\.0+$/, '');
    const d = s.replace(/\D/g, '').replace(/^0+/, '');
    return d || s.replace(/\s/g, '');
  };
  /** Nome comparável: sem acento, caixa alta, espaços colapsados. */
  const normNome = (x) => String(x == null ? '' : x)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  /** Qualquer formato usual → 'YYYY-MM-DD' ('' se não reconhecer). */
  function normData(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) {
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) {
      const ano = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    // serial do Excel (dias desde 30/12/1899), em UTC pra não escorregar o dia
    if (/^\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (n > 20000 && n < 80000) {
        const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      }
    }
    return '';
  }
  const dataBR = (iso) => {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ? String(iso).slice(0, 10) : '—');
  };

  /**
   * V749: variantes GRAVÁVEIS do código da admissão. Trocam os `LIKE '%x%'`
   * (varredura completa de 287k linhas do QVIS e 1M da produção) por
   * igualdades que usam o índice.
   */
  function variantesAdm(adm) {
    const bruto = String(adm == null ? '' : adm).trim();
    const dig = normAdm(bruto);
    const v = new Set([bruto, dig, dig + '.0', dig + '.00']);
    for (let z = 1; z <= 4; z++) v.add(dig.padStart(dig.length + z, '0'));
    return [...v].filter(Boolean);
  }
  /** WHERE <col> IN (?,?,…) montado a partir das variantes. */
  function sqlIn(col, vals) {
    return `${col} IN (${vals.map(() => '?').join(',')})`;
  }

  /**
   * V751: EFEITO ESTEIRA — HORIZONTAL. Cada visualização carregada entra
   * deslizando pela lateral, uma depois da outra (o `staggerEntrada` global
   * desliza na vertical; aqui a esteira é no eixo X). A animação é feita por
   * classe + `animation-delay`: como os blocos são recriados a cada busca, ela
   * se repete sozinha em toda admissão carregada, sem estado nenhum.
   */
  function esteira(seletor, { passo = 90, base = 0 } = {}) {
    const els = [...document.querySelectorAll(seletor)];
    els.forEach((el, i) => {
      // V752: teto no atraso — numa lista de 50 itens o último não espera 4s
      const d = base + Math.min(i, 10) * passo + Math.max(0, i - 10) * 12;
      el.classList.add('insp-esteira', 'insp-esteira-pausa');
      el.style.animationDelay = d + 'ms';
      // V782: acabou a animação → REMOVE transform/will-change. Mantidos (o
      // "both" congela o translate3d), cada bloco vivia numa camada própria da
      // GPU e o TEXTO ficava rasterizado borrado ("144p") em telas com zoom
      // ou escala do Windows. Sem a classe, o texto volta a ser nítido.
      el.addEventListener('animationend', () => {
        el.classList.remove('insp-esteira', 'insp-esteira-pausa');
        el.style.animationDelay = '';
      }, { once: true });
    });
    const soltar = (el) => el.classList.remove('insp-esteira-pausa');
    // V752: com MUITO conteúdo o layout inicial leva mais que a animação — o
    // relógio dela corria durante o travamento e ela "sumia" (terminava antes
    // do 1º quadro pintado). A esteira nasce PAUSADA no estado inicial
    // (opacidade 0) e só é liberada depois do primeiro paint (rAF duplo).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // V753: quem está FORA da área visível só entra na esteira ao ser
      // alcançado pela rolagem — com matrizes longas o 3º bloco animava lá
      // embaixo, fora de vista, e o usuário nunca via o efeito.
      if (typeof IntersectionObserver !== 'function') { els.forEach(soltar); return; }
      const io = new IntersectionObserver((entradas) => {
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          soltar(e.target);
          io.unobserve(e.target);
        }
      }, { threshold: 0.02 });
      els.forEach(el => io.observe(el));
      // rede de segurança: nada pode ficar invisível para sempre
      setTimeout(() => { els.forEach(soltar); io.disconnect(); }, 8000);
    }));
  }

  // ── peça 20C (mesmo visual do LIO/OPME): ícone em tile + rótulo + valor ──
  function _inspIc(nome) {
    return {
      hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
      user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    }[nome] || '';
  }
  function _inspSvg(d, tam = 14, w = 2.1) {
    return `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" fill="none" stroke="currentColor"
      stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }

  // ────────────────────────────────────────────────────────────────────────
  // CONSULTAS (só rodam na busca — nada é pré-carregado)
  // ────────────────────────────────────────────────────────────────────────

  /** 1º painel: linhas do QVIS cru da admissão (busca por índice — V749). */
  /**
   * ══ V894: MEMÓRIA POR ADMISSÃO ═══════════════════════════════════════════
   *
   * Numa extração grande, cada admissão consultava o banco DEZENAS de vezes —
   * a Situação, os alertas, o repasse faltante, a coluna da produção e a
   * divisão por fonte pagadora pedem o MESMO qvis e a MESMA produção, cada um
   * por si. Com milhares de admissões a extração travava a tela.
   *
   * O cache vive enquanto o banco não muda (Banco._versao) — a mesma régua dos
   * outros memos do módulo.
   */
  let _admCache = { v: -1, qvis: new Map(), prod: new Map() };
  function _cacheAdm() {
    const v = Banco._versao || 0;
    if (_admCache.v !== v) _admCache = { v, qvis: new Map(), prod: new Map() };
    return _admCache;
  }
  function buscarQvis(adm) {
    const c = _cacheAdm();
    const k = normAdm(adm);
    if (c.qvis.has(k)) return c.qvis.get(k);
    let rows = [];
    try {
      const v = variantesAdm(adm);
      rows = Banco.query(`
        SELECT origem, competencia, mes_pagamento, admissao, data_admissao, paciente,
               nome_profissional, papel, procedimento, quantidade, convenio,
               produzido, honorario, recebido, repassado, tipo_recebimento, classificacao_produto
          FROM linhas_qvis WHERE ${sqlIn('admissao', v)}`, v) || [];
    } catch (e) { console.warn('[inspecao] qvis:', e); rows = []; }
    c.qvis.set(k, rows);
    return rows;
  }

  /**
   * 3º painel: TUDO o que a produção analítica tem da admissão — todas as
   * linhas e TODAS as colunas, na ordem original do relatório (V748). As
   * colunas 100% vazias naquelas linhas são omitidas pra não virar deserto.
   */
  function buscarProducao(adm) {
    const c = _cacheAdm();                      // V894: mesma memória do qvis
    const k = normAdm(adm);
    if (c.prod.has(k)) return c.prod.get(k);
    let rows = [];
    try {
      const v = variantesAdm(adm);
      rows = Banco.query(`SELECT * FROM linhas_producao WHERE ${sqlIn('cod_admissao', v)}`, v) || [];
    } catch (e) { console.warn('[inspecao] producao:', e); rows = []; }
    c.prod.set(k, rows);
    return rows;
  }

  /** Rótulo legível para o nome técnico da coluna da produção. */
  const ROT_PROD = {
    competencia: 'Competência', cod_admissao: 'Cód. admissão', data_admissao: 'Data adm.',
    hora_admissao: 'Hora', status_admissao: 'Status adm.', unidade: 'Unidade',
    especialidade: 'Especialidade', tipo_recebimento: 'Recebimento', destino: 'Destino',
    classificacao_produto: 'Classificação', tipo_produto: 'Tipo produto', categoria: 'Categoria',
    subcategoria: 'Subcategoria', subespecialidade: 'Subespecialidade', medico_externo: 'Médico externo',
    cod_apresentacao: 'Cód. apresentação', procedimento_principal: 'Proc. principal', produto: 'Produto',
    pacote: 'Pacote', convenio: 'Convênio', plano: 'Plano', perfil_particular: 'Perfil particular',
    perfil_admissao: 'Perfil admissão', carater_admissao: 'Caráter', observacao_admissao: 'Observação',
    sala: 'Sala', profissional_admissao: 'Prof. admissão', tipo_paciente: 'Tipo paciente',
    cod_paciente: 'Cód. paciente', paciente: 'Paciente', data_nascimento: 'Nascimento',
    idade_atendimento: 'Idade', faixa_etaria: 'Faixa etária', cid_alta: 'CID', descricao_cid: 'Descrição CID',
    quantidade: 'Qtd', valor: 'Valor', indicante: 'Indicante', solicitante: 'Solicitante',
    consultor: 'Consultor', medico: 'Médico', cirurgiao: 'Cirurgião', instrumentador: 'Instrumentador',
    contatologa: 'Contatóloga', ortoptista: 'Ortoptista', auxiliar_sadt: 'Auxiliar SADT',
    auxiliar_1: 'Auxiliar 1', auxiliar_2: 'Auxiliar 2', linha_origem: 'Linha origem',
  };
  const PROD_OCULTAS = new Set(['id', 'importacao_id', 'importada_em']);
  const PROD_MEDICOS = new Set(['indicante', 'solicitante', 'consultor', 'medico', 'cirurgiao',
    'instrumentador', 'contatologa', 'ortoptista', 'auxiliar_sadt', 'auxiliar_1', 'auxiliar_2',
    'medico_externo', 'profissional_admissao']);

  /**
   * V812: o bloco 3 é o ESPELHO do relatório de produção importado — as 48
   * colunas do arquivo, na ordem e com os cabeçalhos ORIGINAIS do importador,
   * mesmo quando a coluna está vazia nestas linhas (a célula sai em branco).
   * Antes ele escondia coluna vazia (V748) e usava rótulos resumidos; agora o
   * que você vê é o que o arquivo tem. Só ficam de fora os campos internos de
   * controle (id, competência derivada, nº da linha…), que não existem no
   * relatório.
   */
  const PROD_RELATORIO = [
    ['Cód. Admissão', 'cod_admissao'],       ['Data Admissão', 'data_admissao'],
    ['Hora Admissão', 'hora_admissao'],      ['Status Admissão', 'status_admissao'],
    ['Unid. Atendimento', 'unidade'],        ['Especialidade', 'especialidade'],
    ['Tipo Recebimento', 'tipo_recebimento'],['Destino', 'destino'],
    ['Classificação Produto', 'classificacao_produto'], ['Tipo Produto', 'tipo_produto'],
    ['Categoria', 'categoria'],              ['Subcategoria', 'subcategoria'],
    ['Subespecialidade', 'subespecialidade'],['Médico Externo', 'medico_externo'],
    ['Cód. Apresentação', 'cod_apresentacao'], ['Procedimento Principal', 'procedimento_principal'],
    ['Produto', 'produto'],                  ['Pacote', 'pacote'],
    ['Convênio', 'convenio'],                ['Plano', 'plano'],
    ['Perfil Particular', 'perfil_particular'], ['Perfil Admissão', 'perfil_admissao'],
    ['Caráter Admissão', 'carater_admissao'],['Observação Admissão', 'observacao_admissao'],
    ['Sala', 'sala'],                        ['Profissional Admissão', 'profissional_admissao'],
    ['Tipo Paciente', 'tipo_paciente'],      ['Cód. Paciente', 'cod_paciente'],
    ['Paciente', 'paciente'],                ['Data Nascimento', 'data_nascimento'],
    ['Idade no Atendimento', 'idade_atendimento'], ['Faixa Etária', 'faixa_etaria'],
    ['CID Alta', 'cid_alta'],                ['Descrição CID', 'descricao_cid'],
    ['Qtd.', 'quantidade'],                  ['Valor R$', 'valor'],
    ['Indicante', 'indicante'],              ['Solicitante', 'solicitante'],
    ['Consultor', 'consultor'],              ['Médico', 'medico'],
    ['Cirurgião', 'cirurgiao'],              ['Instrumentador', 'instrumentador'],
    ['Contatologa', 'contatologa'],          ['Ortoptista', 'ortoptista'],
    ['Auxiliar SADT', 'auxiliar_sadt'],      ['Auxiliar 1', 'auxiliar_1'],
    ['Auxiliar 2', 'auxiliar_2'],
  ];
  function colunasProducao(linhas) {
    if (!linhas.length) return [];
    return PROD_RELATORIO.map(([rot, k]) => ({
      rot,
      num: k === 'quantidade' || k === 'valor' || k === 'idade_atendimento',
      html: k === 'tipo_recebimento',   // V947: tag padrão de fonte pagadora
      get: (l) => {
        const v = l[k];
        if (v === null || v === undefined || String(v).trim() === '') return '';
        if (k === 'tipo_recebimento') return Utilidades.badgeFonte(v);
        if (k === 'valor') return 'R$ ' + fmtN(v);
        if (k === 'data_admissao' || k === 'data_nascimento') return dataBR(v);
        if (PROD_MEDICOS.has(k)) return CodigoMedico.exibir(v);
        if (k === 'paciente') return nomePaciente(v);   // V808
        return v;
      },
    }));
  }

  /** Competências que têm cálculo salvo (fonte da matriz auditada). */
  // V859: consultada uma vez por admissão da pauta — memoizada pela versão do
  // banco (a lista de meses com foto de cálculo só muda quando alguém calcula)
  let _compSnapCache = { versao: -1, lista: null };
  function competenciasComSnapshot() {
    const v = Banco._versao || 0;
    if (_compSnapCache.versao === v && _compSnapCache.lista) return _compSnapCache.lista;
    let lista = [];
    try {
      lista = (Banco.query(`SELECT competencia FROM repasse_snapshot ORDER BY competencia DESC`) || [])
        .map(r => r.competencia).filter(Boolean);
    } catch (e) { lista = []; }
    _compSnapCache = { versao: v, lista };
    return lista;
  }

  /**
   * V774: a linha FOI de fato para o relatório do médico?
   *
   * A matriz auditada carrega, além das linhas pagas, linhas-filhas criadas
   * pela AUDITORIA (status `pacoteDetalhe`). Elas se dividem em duas coisas
   * bem diferentes:
   *
   *   • ajuste ATRIBUÍDO — tem profissional e valor (ex.: auxiliar herdando o
   *     nome do cirurgião): isso virou repasse de verdade e ENTRA;
   *   • PENDÊNCIA da auditoria — a Base Tabela exige aquele papel (Médico
   *     Laudo, por exemplo), o QVIS não trouxe ninguém, e a linha nasce com o
   *     valor da regra mas SEM profissional (`_auditNotificar`). É dinheiro
   *     previsto sem destinatário: ninguém recebeu, então NÃO entra.
   *
   * Era o caso das linhas "Médico Laudo" sem nome, com R$ 20,00 e R$ 8,20.
   */
  function foiParaORelatorioMedico(l) {
    const ehAjuste = l._ehAuditoria || l._ehPacoteDetalhe || l._status === 'pacoteDetalhe';
    if (!ehAjuste) return true;                       // linha normal do QVIS
    const temMedico = String(l._medicoNome || l.nome_profissional || '').trim() !== '';
    if (!temMedico) return false;                     // valor sem quem receba
    return (Number(l._repasse) || 0) !== 0;           // ajuste com médico E valor
  }

  /**
   * V771: competências em que a admissão realmente FOI PAGA.
   *
   * A V749 passou a procurar o repasse só nas competências que aparecem no
   * QVIS da admissão — rápido, mas INCOMPLETO: uma admissão pode ser paga em
   * mais de um mês (parte em junho, o resto em julho) e o mês que não estava
   * no QVIS ficava de fora, deixando o total menor que o real. A tabela
   * `repasse_pagos` (gravada a cada cálculo, indexada por cod_admissao) diz
   * exatamente onde houve pagamento — instantâneo e completo.
   */
  function competenciasPagasDaAdmissao(adm) {
    try {
      const v = variantesAdm(adm);
      return (Banco.query(
        `SELECT DISTINCT competencia FROM repasse_pagos WHERE ${sqlIn('cod_admissao', v)}`, v) || [])
        .map(r => r.competencia).filter(Boolean);
    } catch (e) { return []; }   // base antiga sem a tabela: segue pelo QVIS
  }

  /**
   * 2º painel: como a admissão ficou no "Relatório Repasse" — matriz auditada.
   *
   * V749 (desempenho): a versão anterior reconstruía a matriz de TODAS as
   * competências com cálculo salvo (45 fotos na base real) a cada busca — era
   * o que fazia o navegador pedir "aguarde o site responder". A matriz de uma
   * competência nasce das linhas do QVIS daquele mês de pagamento; logo, só as
   * competências em que a admissão APARECE no QVIS podem contê-la. Passamos de
   * dezenas de reconstruções para, tipicamente, UMA — e nenhuma quando a
   * admissão sequer chegou no QVIS (caso "o convênio ainda não pagou").
   */
  /**
   * V791: BLOCO 2 = Relatórios › Consolidado.
   *
   * Antes o painel reconstruía a matriz auditada por conta própria. Agora ele
   * lê o CONSOLIDADO do módulo Relatórios — a mesma tabela que vira o
   * relatório do médico. Com isso o bloco passa a mostrar, além do repasse do
   * QVIS, o que a admissão gerou nos fichários de desempenho (LIO, OPME,
   * Fellow…), as linhas avulsas e os complementos lançados no Consolidado —
   * e deixa de fora quem o Consolidado não paga (profissional que não é
   * INTERNO/HÍBRIDO).
   *
   * Competências candidatas: onde a admissão aparece no QVIS, onde consta
   * pagamento (repasse_pagos), onde há lançamento manual e onde ela aparece na
   * produção (é de lá que nascem os fichários de desempenho).
   */
  function competenciasDaAdmissao(adm, mesesQvis) {
    const v = variantesAdm(adm);
    const comps = new Set(mesesQvis || []);
    for (const c of competenciasPagasDaAdmissao(adm)) comps.add(c);
    const juntar = (sql) => {
      try { for (const r of Banco.query(sql, v) || []) if (r.competencia) comps.add(r.competencia); }
      catch (e) {}
    };
    juntar(`SELECT DISTINCT competencia FROM consolidado_linhas_manuais WHERE ${sqlIn('admissao', v)}`);
    juntar(`SELECT DISTINCT competencia FROM linhas_producao WHERE ${sqlIn('cod_admissao', v)}`);
    juntar(`SELECT DISTINCT mes_pagamento AS competencia FROM linhas_qvis WHERE ${sqlIn('admissao', v)}`);
    /**
     * ══ V876: NADA ALÉM DO QUE O CONSOLIDADO TEM ══════════════════════════
     *
     * A lista acima é MAIS LARGA que a do Consolidado: ela inclui a
     * competência da PRODUÇÃO, e o Consolidado só conhece os meses em que um
     * relatório QVIS de pagamento foi importado (é o que o seletor dele
     * oferece). Perguntar por um mês fora dessa lista fazia o módulo calcular
     * um mês que ele não mostra para ninguém — e um LIO de 08/2025 aparecia
     * como pago no box 2 sem existir nenhum pagamento daquele mês.
     *
     * Se o box 2 é o Consolidado, ele não pode trazer NADA além do que aparece
     * lá. Aqui a lista é podada para a do próprio módulo.
     *
     * Sem o módulo carregado (ou com a lista vazia) nada é podado — melhor
     * manter o comportamento antigo do que esvaziar o box 2 por engano.
     */
    const doModulo = _competenciasDoConsolidado();
    const todas = [...comps].filter(Boolean).sort();
    return doModulo ? todas.filter(c => doModulo.has(c)) : todas;
  }
  /** Set das competências que o módulo Relatórios tem; null = não dá para saber */
  let _compConsCache = { versao: null, set: null };
  function _competenciasDoConsolidado() {
    if (_compConsCache.versao === Banco._versao) return _compConsCache.set;
    let set = null;
    try {
      const api = window.AtlasRelatorios;
      if (api && typeof api.competenciasConsolidado === 'function') {
        const lista = api.competenciasConsolidado() || [];
        if (lista.length) set = new Set(lista.map(String));
      }
    } catch (e) {}
    _compConsCache = { versao: Banco._versao, set };
    return set;
  }
  /** valor do Consolidado com a regra da casa (profissional institucional → 0) */
  function valorConsolidado(l) {
    return ehMedicoInstitucional(l.profissional) ? 0 : (Number(l.valor) || 0);
  }
  /**
   * V859: PRÉ-CARGA POR COMPETÊNCIA — o conserto da lentidão da Inspeção.
   *
   * Cada consulta ao Consolidado de um mês obriga a montar a matriz auditada
   * daquele mês, e só cabem 2 meses em memória (V601). A Inspeção percorre a
   * PAUTA — dezenas de admissões, cada uma de um mês diferente —, então o mês
   * era montado, descartado e montado de novo, uma vez por admissão: numa base
   * real deram 198 montagens (8 min só para ABRIR a tela).
   *
   * Aqui a ordem se inverte: primeiro descobrimos de quais meses a pauta
   * precisa, depois percorremos MÊS A MÊS, resolvendo de uma vez todas as
   * admissões daquele mês. Cada mês é montado UMA vez — 198 viram 7 — e o
   * resultado por admissão fica guardado para o restante da extração.
   */
  let _consPre = { versao: -1, mapa: null };
  function _chavePre(comp, adm) { return comp + '|' + normAdm(adm); }
  function precarregarConsolidado(admissoes) {
    const api = window.AtlasRelatorios;
    if (!api || typeof api.linhasConsolidadoAdmissao !== 'function') return;
    const v = Banco._versao || 0;
    if (_consPre.versao !== v || !_consPre.mapa) _consPre = { versao: v, mapa: new Map() };
    const porComp = new Map();
    for (const adm of (admissoes || [])) {
      if (!adm) continue;
      let mesesQvis = [];
      try { mesesQvis = [...new Set(buscarQvis(adm).map(l => l.mes_pagamento).filter(Boolean))]; }
      catch (e) {}
      for (const comp of competenciasDaAdmissao(adm, mesesQvis)) {
        if (_consPre.mapa.has(_chavePre(comp, adm))) continue;
        if (!porComp.has(comp)) porComp.set(comp, []);
        porComp.get(comp).push(adm);
      }
    }
    // um mês por vez: dentro do laço, a matriz e o consolidado do mês estão
    // quentes e toda admissão daquele mês sai de graça
    for (const [comp, adms] of porComp) {
      for (const adm of adms) {
        let linhas = [];
        try { linhas = api.linhasConsolidadoAdmissao(comp, adm) || []; } catch (e) { linhas = []; }
        _consPre.mapa.set(_chavePre(comp, adm), linhas);
      }
    }
  }

  function buscarConsolidado(adm, mesesQvis) {
    const api = window.AtlasRelatorios;
    if (!api || typeof api.linhasConsolidadoAdmissao !== 'function') return [];
    const achados = [];
    const pre = (_consPre.versao === (Banco._versao || 0) && _consPre.mapa) ? _consPre.mapa : null;
    for (const comp of competenciasDaAdmissao(adm, mesesQvis)) {
      let linhas = [];
      const k = _chavePre(comp, adm);
      if (pre && pre.has(k)) linhas = pre.get(k);
      else {
        try { linhas = api.linhasConsolidadoAdmissao(comp, adm) || []; } catch (e) { continue; }
      }
      for (const l of linhas) achados.push({ competencia: comp, linha: l });
    }
    return achados;
  }

  function buscarRepasse(adm, mesesQvis) {
    const alvo = normAdm(adm);
    const achados = [];
    if (!window.AtlasAuditoria || !window.AtlasAuditoria.matrizDaCompetencia) return achados;
    const comSnap = new Set(competenciasComSnapshot());
    // V771: QVIS ∪ competências onde a admissão foi paga (índice repasse_pagos)
    const candidatas = [...new Set([...(mesesQvis || []), ...competenciasPagasDaAdmissao(adm)])]
      .filter(m => comSnap.has(m));
    for (const comp of candidatas) {
      let linhas = [];
      try { linhas = window.AtlasAuditoria.matrizDaCompetencia(comp) || []; }
      catch (e) { continue; }
      for (const l of linhas) {
        if (normAdm(l.admissao) !== alvo) continue;
        if (!foiParaORelatorioMedico(l)) continue;   // V773
        achados.push({ competencia: comp, linha: l });
      }
    }
    return achados;
  }

  /**
   * V748: procedimento principal da admissão, lido da PRODUÇÃO ANALÍTICA —
   * é o que diferencia duas admissões do mesmo paciente no mesmo dia. Quando
   * há mais de um distinto, mostra o predominante + "+N".
   */
  function procPrincipalDaAdmissao(adm) {
    try {
      const alvo = normAdm(adm);
      const v = variantesAdm(adm);
      const linhas = (Banco.query(
        `SELECT procedimento_principal FROM linhas_producao WHERE ${sqlIn('cod_admissao', v)}`, v) || [])
        .map(l => String(l.procedimento_principal || '').trim()).filter(Boolean);
      if (!linhas.length) return '';
      const cont = new Map();
      for (const p of linhas) cont.set(p, (cont.get(p) || 0) + 1);
      const ordenado = [...cont.entries()].sort((a, b) => b[1] - a[1]);
      const extras = ordenado.length - 1;
      return ordenado[0][0] + (extras > 0 ? ` +${extras}` : '');
    } catch (e) { return ''; }
  }

  /**
   * Busca por paciente (nome, opcionalmente + data) → admissões candidatas.
   *
   * V749: cada palavra digitada vira um LIKE próprio, todos exigidos juntos
   * (AND) — isso é seletivo o bastante para o SQLite devolver pouquíssimas
   * linhas mesmo em 1M de registros. Vogais e "C" viram `_` no padrão para
   * casar com acentos e cedilha (JOSE ↔ JOSÉ, ASSUNCAO ↔ ASSUNÇÃO), já que o
   * SQLite não tem "unaccent". O acerto fino fica no filtro em JS.
   */
  function buscarAdmissoesPorPaciente(nome, dataIso) {
    const alvo = normNome(nome);
    if (alvo.length < 3) return [];
    const palavras = alvo.split(' ').filter(p => p.length >= 2);
    if (!palavras.length) return [];
    const curinga = (p) => '%' + p.replace(/[AEIOUC]/g, '_') + '%';
    const condNome = palavras.map(() => 'UPPER(paciente) LIKE ?').join(' AND ');
    const params = palavras.map(curinga);
    const condData = dataIso ? ' AND substr(data_admissao, 1, 10) = ?' : '';
    if (dataIso) params.push(dataIso);

    const mapa = new Map();
    const juntar = (adm, pac, data) => {
      const k = normAdm(adm);
      if (!k) return;
      if (!mapa.has(k)) mapa.set(k, { admissao: String(adm), paciente: pac || '', data: normData(data) });
      const it = mapa.get(k);
      if (!it.paciente && pac) it.paciente = pac;
      if (!it.data && data) it.data = normData(data);
    };
    try {
      for (const l of Banco.query(
        `SELECT cod_admissao, paciente, data_admissao FROM linhas_producao
          WHERE ${condNome}${condData} LIMIT 3000`, params) || []) {
        if (normNome(l.paciente).includes(alvo)) juntar(l.cod_admissao, l.paciente, l.data_admissao);
      }
    } catch (e) { console.warn('[inspecao] nome/producao:', e); }
    try {
      for (const l of Banco.query(
        `SELECT admissao, paciente, data_admissao FROM linhas_qvis
          WHERE ${condNome}${condData} LIMIT 3000`, params) || []) {
        if (normNome(l.paciente).includes(alvo)) juntar(l.admissao, l.paciente, l.data_admissao);
      }
    } catch (e) { console.warn('[inspecao] nome/qvis:', e); }
    let itens = [...mapa.values()];
    if (dataIso) itens = itens.filter(i => i.data === dataIso);
    return itens.sort((a, b) => String(b.data).localeCompare(String(a.data)));
  }

  /**
   * V752: de uma lista de admissões, quais JÁ apareceram no QVIS — uma única
   * consulta indexada (em lotes) para pintar a lista da planilha do médico.
   */
  function admissoesNoQvis(admissoes) {
    const no = new Set();
    try {
      for (let i = 0; i < admissoes.length; i += 120) {
        const lote = admissoes.slice(i, i + 120);
        const vars = [...new Set(lote.flatMap(variantesAdm))];
        for (const r of Banco.query(
          `SELECT DISTINCT admissao FROM linhas_qvis WHERE ${sqlIn('admissao', vars)}`, vars) || []) {
          no.add(normAdm(r.admissao));
        }
      }
    } catch (e) {}
    return no;
  }

  /**
   * V778: COLUNA DE PRODUTOS na extração da planilha do médico.
   *
   * A produção analítica traz, em cada linha, as colunas de PAPÉIS (cirurgião,
   * médico, indicante, auxiliares…). O usuário escolhe quais PRODUTOS lhe
   * interessam numa pré-lista (com busca), e a extração ganha uma coluna a mais
   * mostrando, por admissão, esses produtos com os papéis lançados na produção.
   * Sem produto selecionado, a coluna não é construída — o relatório fica como era.
   */
  const PROD_SEL_KEY = 'insp_prod_sel_v1';
  // V794: produtos que devem sair na coluna SITUAÇÃO da extração. Vazio = tudo
  // (comportamento de sempre); com seleção, a descrição do que foi pago mostra
  // só esses produtos — e o total acompanha o que está descrito.
  const PROD_SIT_KEY = 'insp_prod_sit_v1';
  function lerSelSituacao() {
    try { return new Set(JSON.parse(cfgLer(PROD_SIT_KEY) || '[]')); }   // V858
    catch (e) { return new Set(); }
  }
  function salvarSelSituacao(sel) {
    cfgGravar(PROD_SIT_KEY, JSON.stringify([...sel]));   // V858
  }
  /**
   * V803: FILTRO DE MÉDICOS — a admissão costuma ter vários profissionais
   * (cirurgião, indicante, auxiliares, laudista). Aqui você escolhe de quem
   * quer ver a informação; vazio = todos, como sempre.
   */
  const MED_SEL_KEY = 'insp_med_sel_v1';
  function lerSelMedicos() {
    try { return new Set(JSON.parse(cfgLer(MED_SEL_KEY) || '[]')); }   // V858
    catch (e) { return new Set(); }
  }
  function salvarSelMedicos(sel) {
    cfgGravar(MED_SEL_KEY, JSON.stringify([...sel]));   // V858
  }
  /**
   * V817: qualquer grafia do médico → nome OFICIAL do cadastro, passando pelo
   * DE-PARA de nomes (sinonimos_medico) — a mesma unidade de nome que o resto
   * da ferramenta usa (resolverMedico dos Relatórios). Sem isso o filtro
   * oferecia "Tiago Suzuki Godoy" e "TIAGO SUZUKI GODOY" como dois médicos.
   */
  let _medOficialCache = { versao: null, mapa: null };
  function nomeOficialMedico(nome) {
    const k = normNome(nome);
    if (!k) return String(nome || '').trim();
    if (_medOficialCache.versao !== Banco._versao || !_medOficialCache.mapa) {
      const m = new Map();
      try {
        const porId = new Map();
        // o PRIMEIRO cadastro vale — um recadastro tardio da mesma grafia não
        // pode roubar o nome de exibição
        for (const r of Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM medicos ORDER BY id`) || []) {
          if (!r.nome_oficial) continue;
          const k1 = normNome(r.nome_oficial);
          if (!m.has(k1)) m.set(k1, r.nome_oficial);
          if (r.nome_normalizado) {
            const k2 = normNome(r.nome_normalizado);
            if (!m.has(k2)) m.set(k2, r.nome_oficial);
          }
          porId.set(r.id, r.nome_oficial);
        }
        for (const sN of Banco.query(`SELECT grafia, grafia_normalizada, medico_id FROM sinonimos_medico`) || []) {
          const of = porId.get(sN.medico_id);
          if (!of) continue;
          if (sN.grafia) m.set(normNome(sN.grafia), of);
          if (sN.grafia_normalizada) m.set(normNome(sN.grafia_normalizada), of);
        }
      } catch (e) {}
      _medOficialCache = { versao: Banco._versao, mapa: m };
    }
    return _medOficialCache.mapa.get(k) || String(nome || '').trim();
  }
  /**
   * ══ V882: TODO NOME QUE A INSPEÇÃO ESCREVE PASSA PELO DE-PARA ═══════════
   *
   * O cadastro de médicos guarda o nome OFICIAL e o de-para das grafias
   * (sinonimos_medico). O filtro e a comparação já usavam isso desde a V817;
   * o TEXTO, não — a extração saía com a grafia que veio na planilha de
   * origem ("T. SUZUKI", "TIAGO S GODOY", o nome truncado do sistema).
   *
   * Agora o caminho é único: resolve o oficial e só então decide como
   * mostrar (nome real, ou o código quando "ocultar nomes" está ligado).
   */
  function exibirMedico(nome) {
    return CodigoMedico.exibir(nomeOficialMedico(nome || ''));
  }
  /** o médico da linha é um dos escolhidos? (vazio = todos) — compara pelo OFICIAL */
  function medicoEscolhido(sel, nome) {
    if (!sel || !sel.size) return true;
    const n = normNome(nomeOficialMedico(nome));
    if (!n) return false;
    for (const m of sel) if (normNome(nomeOficialMedico(m)) === n) return true;
    return false;
  }
  /**
   * V807: FILTRO DE PARTICIPAÇÃO — qual papel do médico você quer ver. Um
   * profissional pode entrar na mesma admissão como executante e como
   * indicante; aqui você escolhe a participação específica. Vazio = todas.
   */
  const PAPEL_SEL_KEY = 'insp_papel_sel_v1';
  function lerSelPapeis() {
    try { return new Set(JSON.parse(cfgLer(PAPEL_SEL_KEY) || '[]')); }   // V858
    catch (e) { return new Set(); }
  }
  function salvarSelPapeis(sel) {
    cfgGravar(PAPEL_SEL_KEY, JSON.stringify([...sel]));   // V858
  }
  /**
   * Nome da participação PARA O FILTRO: o papel canônico, o mesmo vocabulário
   * com que a ferramenta paga — MEDICO/CIRURGIAO são EXECUTANTE, SOLICITANTE é
   * INDICANTE, e os auxiliares 1 e 2 são AUXILIAR.
   *
   * Cheguei a separar "AUXILIAR 1" de "AUXILIAR 2" aqui, mas o Consolidado
   * (que é de onde sai o pagamento) grava o auxiliar SEM o número: separar na
   * lista criaria duas opções que filtram exatamente a mesma coisa. O número
   * continua visível onde ele existe de verdade — na coluna Produto · papéis,
   * que lê a produção.
   */
  const papelFiltro = (papel) => papelCanonico(papel);
  /** a participação da linha é uma das escolhidas? (vazio = todas) */
  function papelEscolhido(sel, papel) {
    if (!sel || !sel.size) return true;
    const c = papelFiltro(papel);
    if (!c) return false;
    for (const p of sel) if (papelFiltro(p) === c) return true;
    return false;
  }
  /**
   * Participações que aparecem nas admissões da lista, pelo nome do filtro —
   * "MEDICO" e "CIRURGIAO" são a mesma participação (executante) e não podem
   * virar duas opções; já "AUXILIAR 1" e "AUXILIAR 2" continuam separados.
   */
  function papeisDaLista(admissoes) {
    const cont = new Map();
    const somar = (papel) => {
      const c = papelFiltro(papel);
      if (!c) return;
      cont.set(c, (cont.get(c) || 0) + 1);
    };
    try {
      for (let i = 0; i < admissoes.length; i += 120) {
        const vars = [...new Set(admissoes.slice(i, i + 120).flatMap(variantesAdm))];
        for (const r of Banco.query(
          `SELECT papel AS p FROM linhas_qvis WHERE ${sqlIn('admissao', vars)}`, vars) || []) somar(r.p);
        for (const r of Banco.query(
          `SELECT papel AS p FROM consolidado_linhas_manuais WHERE ${sqlIn('admissao', vars)}`, vars) || []) somar(r.p);
      }
    } catch (e) {}
    try {
      precarregarConsolidado(admissoes);   // V859: um mês de cada vez
      for (const adm of admissoes) {
        for (const r of buscarConsolidado(adm, [])) somar(r.linha.papel);
      }
    } catch (e) {}
    return [...cont.entries()].map(([papel, n]) => ({ papel, n }))
      .sort((a, b) => a.papel.localeCompare(b.papel, 'pt-BR'));
  }

  /** profissionais que aparecem nas admissões da lista (com contagem) */
  function medicosDaLista(admissoes) {
    const cont = new Map();   // norm(oficial) → { nome, n }
    const somar = (nome) => {
      const bruto = String(nome || '').trim();
      if (!bruto) return;
      // V817: uma entrada por MÉDICO, não por grafia — cadastro + de-para
      const oficial = nomeOficialMedico(bruto);
      const k = normNome(oficial);
      const e = cont.get(k) || { nome: oficial, n: 0 };
      e.n++;
      cont.set(k, e);
    };
    try {
      for (let i = 0; i < admissoes.length; i += 120) {
        const vars = [...new Set(admissoes.slice(i, i + 120).flatMap(variantesAdm))];
        // bloco 1 (base padrão) e os lançamentos do Consolidado (inclui o que
        // vem por desempenho, que só existe lá)
        for (const r of Banco.query(
          `SELECT nome_profissional AS n FROM linhas_qvis WHERE ${sqlIn('admissao', vars)}`, vars) || []) {
          somar(r.n);
        }
        for (const r of Banco.query(
          `SELECT profissional AS n FROM consolidado_linhas_manuais WHERE ${sqlIn('admissao', vars)}`, vars) || []) {
          somar(r.n);
        }
      }
    } catch (e) {}
    // o que a matriz pagou: entra pelo Consolidado das competências da lista
    try {
      precarregarConsolidado(admissoes);   // V859: um mês de cada vez
      for (const adm of admissoes) {
        for (const r of buscarConsolidado(adm, [])) somar(r.linha.profissional);
      }
    } catch (e) {}
    return [...cont.values()]
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  /**
   * V779: só os papéis DE REGRA interessam na coluna, com as equivalências que
   * valem no resto da ferramenta:
   *   • EXECUTANTE = Cirurgião; na ausência, Médico cobre (papelCanonico dobra
   *     CIRURGIAO/MEDICO → EXECUTANTE; a Exceção·Produção usa cirurgiao||medico);
   *   • INDICANTE = Indicante; na ausência, Solicitante cobre (mesma regra de
   *     repasse — "Indicante paga o mesmo valor que Solicitante");
   *   • AUXILIAR 1 e AUXILIAR 2, como estão.
   * Os demais papéis da produção (consultor, instrumentador, contatóloga,
   * ortoptista, auxiliar SADT) ficam de fora.
   */
  function papeisDaLinhaProd(r) {
    const v = (x) => String(x == null ? '' : x).trim();
    const out = [];
    const exec = v(r.cirurgiao) || v(r.medico);
    if (exec) out.push(['EXECUTANTE', exec]);
    const ind = v(r.indicante) || v(r.solicitante);
    if (ind) out.push(['INDICANTE', ind]);
    if (v(r.auxiliar_1)) out.push(['AUXILIAR 1', v(r.auxiliar_1)]);
    if (v(r.auxiliar_2)) out.push(['AUXILIAR 2', v(r.auxiliar_2)]);
    return out;
  }
  function lerSelProdutos() {
    try { return new Set(JSON.parse(cfgLer(PROD_SEL_KEY) || '[]')); }   // V858
    catch (e) { return new Set(); }
  }
  function salvarSelProdutos(sel) {
    cfgGravar(PROD_SEL_KEY, JSON.stringify([...sel]));   // V858
  }
  /** produtos lançados na produção analítica das admissões da lista (com contagem) */
  /**
   * V856: a lista de produtos oferece só o que PODE ser repassado. A produção
   * analítica traz tudo o que foi lançado na admissão — inclusive MAT/MED
   * (compressa de gaze, seringa…), taxa, diária, gás e OPME. Nada disso passa
   * pelo motor de cálculo (regra V131.26: só CONSULTA, EXAME e PROCEDIMENTO),
   * então vigiar esses itens nunca produziria alerta de papel — só enchia a
   * lista de escolha. Ficam de fora as classificações NÃO repassáveis; o que
   * vier SEM classificação continua aparecendo (não escondo o que não sei
   * classificar).
   */
  const CLASS_NAO_REPASSAVEL = new Set([
    'MATERIAL', 'MEDICAMENTO', 'MAT MED', 'MATMED', 'TAXA', 'OPME', 'GAS', 'DIARIA',
  ]);
  function produtoRepassavel(classificacao, categoria) {
    const c = normNome(classificacao);
    if (c && CLASS_NAO_REPASSAVEL.has(c)) return false;
    const cat = normNome(categoria);
    if (cat && (CLASS_NAO_REPASSAVEL.has(cat) || /^MAT( |\/)?MED/.test(cat))) return false;
    return true;
  }

  function produtosDaLista(admissoes) {
    const cont = new Map();
    try {
      for (let i = 0; i < admissoes.length; i += 120) {
        const lote = admissoes.slice(i, i + 120);
        const vars = [...new Set(lote.flatMap(variantesAdm))];
        for (const r of Banco.query(
          `SELECT produto, classificacao_produto, categoria, COUNT(*) AS n FROM linhas_producao
            WHERE ${sqlIn('cod_admissao', vars)} AND TRIM(COALESCE(produto,'')) <> ''
            GROUP BY produto, classificacao_produto, categoria`, vars) || []) {
          if (!produtoRepassavel(r.classificacao_produto, r.categoria)) continue;   // V856
          const p = String(r.produto).trim();
          cont.set(p, (cont.get(p) || 0) + (Number(r.n) || 0));
        }
      }
    } catch (e) {}
    // V797: grafias do MESMO exame viram UMA opção (com as contagens somadas).
    // Sem isso a pré-lista oferece três caixinhas da mesma OCT e o relatório
    // acaba repetindo o mesmo termo três vezes.
    // V855: mesma regra do outro caminho — exibe a NOMENCLATURA, guarda a grafia
    return agruparProdutos([...cont.keys()])
      .map(g => ({ produto: g.nome, rotulo: rotuloAlerta(g.nome),
                   n: g.grafias.reduce((t, x) => t + (cont.get(x) || 0), 0) }))
      .sort((a, b) => (a.rotulo || a.produto).localeCompare(b.rotulo || b.produto, 'pt-BR'));
  }
  /**
   * Os papéis lançados na produção para os produtos SELECIONADOS de uma
   * admissão. Linhas idênticas (mesmo produto + mesmos papéis) são fundidas
   * com xN; papéis vazios não aparecem.
   */
  function papeisDoProduto(adm, selecao) {
    const v = variantesAdm(adm);
    if (!v.length || !selecao.size) return { plain: '', rich: [] };
    let rows = [];
    try {
      rows = Banco.query(
        `SELECT * FROM linhas_producao WHERE ${sqlIn('cod_admissao', v)} ORDER BY id`, v) || [];
    } catch (e) { return { plain: '', rich: [] }; }
    const grupos = new Map();
    const escolhidos = [...selecao];
    for (const r of rows) {
      const produto = String(r.produto || '').trim();
      // V797: a linha entra por QUALQUER grafia do exame escolhido, e é
      // descrita com o nome escolhido — três grafias viram um bloco só.
      // V799: mesma regra dos outros filtros — a sigla também é o exame
      const alvo = escolhidos.find(p => mesmoExame(produto, p));
      if (!alvo) continue;
      const papeis = papeisDaLinhaProd(r);   // V779: só os papéis de regra
      const k = alvo + '|' + papeis.map(p => p.join(':')).join('|');
      if (!grupos.has(k)) grupos.set(k, { produto: alvo, papeis, n: 0 });
      grupos.get(k).n++;
    }
    if (!grupos.size) return { plain: '', rich: [] };
    const rich = [], plain = [];
    let primeiro = true;
    for (const g of grupos.values()) {
      if (!primeiro) rich.push({ text: '\n' });
      primeiro = false;
      const xN = g.n > 1 ? `x${g.n} ` : '';
      rich.push({ text: xN + g.produto, font: { bold: true } });
      const partes = [];
      if (g.papeis.length) {
        rich.push({ text: ' — ' });
        g.papeis.forEach(([rot, nome], i) => {
          if (i) rich.push({ text: ' · ' });
          // V882: o papel da produção sai com o nome OFICIAL do médico
          const quem = nomeOficialMedico(nome);
          rich.push({ text: rot + ': ', font: { bold: true, color: { argb: 'FF107DAC' } } });
          rich.push({ text: quem });
          partes.push(`${rot}: ${quem}`);
        });
      } else {
        rich.push({ text: ' — sem papéis lançados' });
        partes.push('sem papéis lançados');
      }
      plain.push(`${xN}${g.produto} — ${partes.join(' · ')}`);
    }
    return { plain: plain.join('\n'), rich };
  }

  /**
   * V784: VIGIAS — "produto que exige um papel pago".
   *
   * Regra do usuário: uma admissão PAGA que tem OCT mas não tem MÉDICO LAUDO
   * pago quase sempre é falta de lançamento do laudista no sistema. A vigia
   * generaliza isso: uma lista de pares (produto lançado → papel exigido),
   * configurável na lateral da Inspeção, com a OCT + Médico Laudo já de fábrica.
   *
   * Por vigia, três diagnósticos possíveis (só para admissão paga):
   *   • o produto não está na produção (nem no QVIS) → "Produção sem …";
   *   • está na produção mas nada foi pago dele → "… sem pagamento no repasse";
   *   • foi pago, mas nenhum pagamento no papel exigido → provável falta de
   *     lançamento do profissional daquele papel.
   */
  // V780: classificação de quem ainda não tem repasse a fazer. Fica numa
  // constante só para a tela, a Situação e o resumo dizerem a MESMA frase.
  const AGUARDANDO = 'Aguardando pagamento do convênio ou aguardando conciliação para efetuar o repasse';
  const VIGIAS_KEY = 'insp_vigias_v1';
  const VIGIAS_PADRAO = [{ produto: 'TOMOGRAFIA DE COERENCIA OPTICA OCT', papel: 'Médico Laudo' }];
  function lerVigias() {
    try {
      const bruto = cfgLer(VIGIAS_KEY);                   // V858: vem do BANCO
      if (bruto == null) return VIGIAS_PADRAO.slice();     // 1ª vez: OCT + Médico Laudo
      const v = JSON.parse(bruto);
      return Array.isArray(v) ? v.filter(x => x && x.produto && x.papel) : [];
    } catch (e) { return VIGIAS_PADRAO.slice(); }
  }
  function salvarVigias(v) {
    cfgGravar(VIGIAS_KEY, JSON.stringify(v), { cadastro: true });   // V858
  }

  /** grafia → id de procedimento (cadastro + sinônimos), para casar nomes divergentes */
  let _procIdCache = { versao: null, mapa: null };
  function _procIdMapa() {
    if (_procIdCache.versao === Banco._versao && _procIdCache.mapa) return _procIdCache.mapa;
    const m = new Map();
    try {
      for (const r of Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM procedimentos`) || []) {
        if (r.nome_oficial) m.set(normNome(r.nome_oficial), r.id);
        if (r.nome_normalizado) m.set(normNome(r.nome_normalizado), r.id);
      }
    } catch (e) {}
    try {
      for (const s of Banco.query(`SELECT grafia, grafia_normalizada, procedimento_id FROM sinonimos_proc`) || []) {
        if (s.grafia) m.set(normNome(s.grafia), s.procedimento_id);
        if (s.grafia_normalizada) m.set(normNome(s.grafia_normalizada), s.procedimento_id);
      }
    } catch (e) {}
    _procIdCache = { versao: Banco._versao, mapa: m };
    return m;
  }
  /**
   * V797: a regra de "isto tudo é o MESMO exame", num lugar só.
   *
   * "PACOTE - TOMOGRAFIA … OCT", "… OCT (AMBOS OS OLHOS)" e "TOMOGRAFIA - DE
   * COERENCIA OPTICA - OCT" são grafias do mesmo procedimento: viram UM grupo,
   * com um nome de exibição — o OFICIAL do de-para quando existe, senão a
   * grafia mais curta, que é a raiz contida nas outras.
   * Usada pelas vigias (V785), pelas pré-listas de produto e pelos textos da
   * coluna Situação — para nenhum deles repetir o mesmo termo.
   */
  /**
   * V852: NOMENCLATURA da BASE TABELA — a coluna que o usuário mantém no
   * cadastro (e importa pelo "↑ Importar nomenclaturas"). É a chave OFICIAL
   * do procedimento: enquanto mesmoExame/mesmoConteudo comparam texto, aqui a
   * própria base diz "estas grafias são a mesma coisa". Mapa por grafia
   * normalizada (nome oficial, nome normalizado e sinônimos) → nomenclatura.
   */
  let _nomCache = { versao: null, mapa: null };
  function _nomenclaturaMapa() {
    if (_nomCache.versao === Banco._versao && _nomCache.mapa) return _nomCache.mapa;
    const m = new Map();
    const porId = new Map();
    try {
      for (const r of Banco.query(
        `SELECT id, nome_oficial, nome_normalizado, nomenclatura FROM procedimentos`) || []) {
        const nom = String(r.nomenclatura || '').trim();
        if (!nom) continue;
        porId.set(r.id, nom);
        if (r.nome_oficial) m.set(normNome(r.nome_oficial), nom);
        if (r.nome_normalizado) m.set(normNome(r.nome_normalizado), nom);
      }
    } catch (e) {}
    try {
      for (const s of Banco.query(
        `SELECT grafia, grafia_normalizada, procedimento_id FROM sinonimos_proc`) || []) {
        const nom = porId.get(s.procedimento_id);
        if (!nom) continue;
        if (s.grafia) m.set(normNome(s.grafia), nom);
        if (s.grafia_normalizada) m.set(normNome(s.grafia_normalizada), nom);
      }
    } catch (e) {}
    _nomCache = { versao: Banco._versao, mapa: m };
    return m;
  }
  /** V852: nomenclatura cadastrada de uma grafia ('' quando não há) */
  function nomenclaturaDe(nome) {
    return _nomenclaturaMapa().get(normNome(nome)) || '';
  }
  /**
   * V852: rótulo do procedimento nos ALERTAS DE PAPEL — a NOMENCLATURA da
   * Base Tabela quando existir; sem ela, o nome de hoje (nada deixa de ser
   * avisado). Só o texto muda: o campo `produto` do alerta continua sendo a
   * grafia real, que é o que casa com as vigias e os filtros.
   */
  function rotuloAlerta(nome) {
    return nomenclaturaDe(nome) || nome;
  }

  function _grupoDe(grupos, nome, procId) {
    const nomDeste = nomenclaturaDe(nome);
    return grupos.find(x => (procId != null && x.procId === procId)
      /**
       * V852: MESMA NOMENCLATURA da Base Tabela = mesmo procedimento, ponto —
       * vence até a guarda do cadastro (duas grafias registradas com ids
       * diferentes, mas com a mesma nomenclatura, são uma coisa só).
       */
      || (!!nomDeste && x.grafias.some(gr => nomenclaturaDe(gr) === nomDeste))
      || x.grafias.some(gr => mesmoProduto(gr, nome))
      /**
       * V834: as listas de escolha agrupam pela MESMA régua dos filtros — a
       * nomenclatura ampla (mesmoExame): "FACECTOMIA - COM LENTE…" e
       * "PACOTE - FACECTOMIA COM LENTE…" são o mesmo procedimento e viram UMA
       * opção. Guarda: dois procedimentos CADASTRADOS como distintos
       * (procedimento_id diferente) nunca se fundem.
       */
      || ((procId == null || x.procId == null || x.procId === procId)
          && x.grafias.some(gr => mesmoExame(gr, nome)))
      /**
       * V845: a guarda do cadastro tem UMA exceção — grafias com o MESMO
       * CONTEÚDO (idênticas tirando a embalagem: PACOTE, COM, DE, "C/"…) são o
       * mesmo procedimento por definição, mesmo quando a base as cadastrou em
       * ids distintos (o QVIS usa um nome, a produção outro, e os dois foram
       * parar no cadastro). Caso real do usuário: as duas FACECTOMIAs
       * continuavam separadas na vigia e na extração por causa da guarda.
       */
      || x.grafias.some(gr => mesmoConteudo(gr, nome)));
  }
  /**
   * Todas as grafias que existem na base (produção + base padrão). Sem isto,
   * cada lugar batizava o exame com a grafia mais curta que ELE por acaso
   * conhecia — e a mesma OCT saía como "PACOTE - …" no alerta e como
   * "TOMOGRAFIA - …" na Situação, no mesmo relatório.
   */
  let _grafiasCache = { versao: null, lista: null };
  function _grafiasConhecidas() {
    if (_grafiasCache.versao === Banco._versao && _grafiasCache.lista) return _grafiasCache.lista;
    const s = new Set();
    const juntar = (sql) => {
      try {
        for (const r of Banco.query(sql) || []) {
          const n = String(r.n || '').trim();
          if (n) s.add(n);
        }
      } catch (e) {}
    };
    juntar(`SELECT DISTINCT produto AS n FROM linhas_producao`);
    juntar(`SELECT DISTINCT procedimento AS n FROM linhas_qvis`);
    _grafiasCache = { versao: Banco._versao, lista: [...s] };
    return _grafiasCache.lista;
  }
  /** nome de exibição de um exame: o oficial do de-para, senão a RAIZ conhecida */
  let _canonCache = { versao: null, mapa: null };
  function nomeCanonico(nome) {
    if (_canonCache.versao !== Banco._versao || !_canonCache.mapa) {
      _canonCache = { versao: Banco._versao, mapa: new Map() };
    }
    const k = normNome(nome);
    if (!k) return nome;
    if (_canonCache.mapa.has(k)) return _canonCache.mapa.get(k);
    const procId = _procIdMapa().get(k);
    let melhor = procId != null ? _procNomeOficial(procId) : null;
    if (!melhor) {
      melhor = nome;
      for (const g of _grafiasConhecidas()) {
        if (normNome(g).length < normNome(melhor).length && mesmoProduto(g, nome)) melhor = g;
      }
    }
    _canonCache.mapa.set(k, melhor);
    return melhor;
  }
  function _nomeDoGrupo(g) {
    const oficial = g.procId != null ? _procNomeOficial(g.procId) : null;
    return oficial || g.grafias.map(nomeCanonico)
      .sort((a, b) => normNome(a).length - normNome(b).length)[0];
  }
  /** [grafias] → [{ nome, grafias }], uma entrada por procedimento */
  function agruparProdutos(nomes) {
    const mapa = _procIdMapa();
    const grupos = [];
    for (const n of nomes) {
      const procId = mapa.get(normNome(n));
      let g = _grupoDe(grupos, n, procId);
      if (!g) { grupos.push(g = { procId: procId != null ? procId : null, grafias: [] }); }
      if (g.procId == null && procId != null) g.procId = procId;
      g.grafias.push(n);
    }
    return grupos.map(g => ({ nome: _nomeDoGrupo(g), grafias: g.grafias }));
  }

  /**
   * V841: PADRÃO DE EXIBIÇÃO — dado um conjunto de grafias, devolve o mapa
   * grafia normalizada → nome do grupo, com o MESMO agrupamento de
   * nomenclatura das listas (V834, com a guarda do cadastro: procedimentos
   * registrados como distintos nunca se fundem). É o que faz
   * "FACECTOMIA - COM LENTE…" e "PACOTE - FACECTOMIA COM LENTE…" saírem como
   * UM padrão só na extração. Só EXIBIÇÃO: nada muda no banco, e o dinheiro
   * das grafias unificadas é somado sob o mesmo nome.
   */
  function padraoDeExibicao(nomes) {
    const mapa = new Map();
    for (const g of agruparProdutos([...new Set(nomes)].filter(Boolean))) {
      for (const gr of g.grafias) mapa.set(normNome(gr), g.nome);
    }
    return mapa;
  }

  /** o produto da produção e o procedimento do repasse são a MESMA coisa? */
  function mesmoProduto(a, b) {
    const x = normNome(a), y = normNome(b);
    if (!x || !y) return false;
    if (x === y) return true;
    /**
     * V870: a NOMENCLATURA da Base Tabela é a palavra final. Ela existe para o
     * usuário dizer "estas grafias são a mesma coisa", e até aqui só servia
     * para AGRUPAR as vigias e para escrever o RÓTULO do alerta — na hora de
     * perguntar "este exame foi pago nesta admissão?" a ferramenta voltava a
     * comparar texto cru, e o cadastro não tinha efeito nenhum. Agora tem:
     * mesma nomenclatura = mesmo procedimento, sem discussão de grafia. É a
     * saída manual para o que a régua de texto não conseguir adivinhar.
     */
    const nx = nomenclaturaDe(x), ny = nomenclaturaDe(y);
    if (nx && ny && normNome(nx) === normNome(ny)) return true;
    // grafias diferentes do mesmo procedimento (cadastro/sinônimos)
    const mapa = _procIdMapa();
    const ix = mapa.get(x), iy = mapa.get(y);
    if (ix != null && iy != null && ix === iy) return true;
    // "OCT" dentro de "TOMOGRAFIA … OCT": um contém o outro (com guarda de tamanho)
    if (x.length >= 6 && y.length >= 6 && (x.indexOf(y) >= 0 || y.indexOf(x) >= 0)) return true;
    return false;
  }

  /**
   * V799: casamento AMPLO — usado só para responder "este exame aconteceu
   * nesta admissão?" (vigias, diagnóstico e filtro da Situação).
   *
   * Caso real: a produção lança "PACOTE - TOMOGRAFIA DE COERENCIA OPTICA -
   * OCT" e o repasse paga o mesmo exame como "OCT". A regra de nomenclatura
   * (mesmoProduto) exige 6 caracteres dos dois lados justamente para não casar
   * bobagem, então a sigla ficava de fora e o relatório dizia "na produção,
   * mas sem pagamento" para uma OCT que FOI paga.
   *
   * Aqui a sigla vale, com duas guardas: ela precisa aparecer como PALAVRA
   * INTEIRA (senão "OCT" casaria com "PROCTOLOGIA") e as palavras de embalagem
   * ("PACOTE", "AMBOS OS OLHOS"…) não contam como conteúdo.
   *
   * O nome de exibição e o agrupamento do dinheiro continuam com a regra
   * ESTRITA — juntar "OCT" com "OCT DE MACULA" numa linha de pagamento seria
   * pior do que deixá-las separadas.
   */
  const _RUIDO = new Set(['PACOTE', 'AMBOS', 'OS', 'O', 'A', 'DE', 'DA', 'DO', 'DAS', 'DOS',
    'E', 'EM', 'COM', 'OLHO', 'OLHOS', 'BILATERAL', 'UNILATERAL']);
  const _palavras = (s) => normNome(s).split(' ').filter(Boolean);
  const _conteudo = (s) => _palavras(s).filter(t => !_RUIDO.has(t) && t.length >= 3);

  /**
   * V870: COLAGEM DE PALAVRAS — o mesmo termo escrito JUNTO de um lado e
   * SEPARADO do outro.
   *
   * Caso real do usuário: "FACECTOMIA COM LENTE INTRAOCULAR" (a grafia da
   * vigia) e "PACOTE - FACECTOMIA COM LENTE INTRA OCULAR C/ FACOEMUL" (a
   * grafia que FOI paga). Tirando a embalagem, sobra de um lado FACECTOMIA /
   * LENTE / INTRAOCULAR e do outro FACECTOMIA / LENTE / INTRA / OCULAR /
   * FACOEMUL. As duas primeiras casam; INTRAOCULAR não existe do outro lado,
   * porque lá está quebrada em duas. Uma palavra colada é, para a comparação,
   * uma palavra diferente de duas palavras — e só isso derrubava o casamento:
   * a vigia não achava o pagamento e o relatório acusava "não encontrado para
   * pagamento / sem informação no sistema" de um procedimento pago.
   *
   * Aqui as palavras VIZINHAS podem ser coladas para casar, nos dois sentidos
   * (INTRA+OCULAR = INTRAOCULAR, MICRO+BYPASS = MICROBYPASS), com duas
   * guardas que preservam o que já funcionava:
   *   · a colagem tem de começar e terminar em FRONTEIRA DE PALAVRA — é o que
   *     impede "OCT" de casar com "PROCTOLOGIA" (a sigla solta continua
   *     valendo só como palavra inteira, regra da V799);
   *   · a colagem precisa de 6 caracteres, o mesmo piso que a regra estrita
   *     usa para não casar bobagem ("FACO" nunca vira "FACOEMULSIFICACAO").
   */
  function _colagens(palavras) {
    const s = new Set(palavras);
    for (let i = 0; i < palavras.length; i++) {
      let junta = palavras[i];
      for (let j = i + 1; j < palavras.length && j - i < 4; j++) {
        junta += palavras[j];
        s.add(junta);
      }
    }
    return s;
  }
  /**
   * As palavras de conteúdo de um lado cabem todas no outro? Cada palavra vale
   * solta (regra de sempre) ou colada às vizinhas (V870). A ordem entre elas
   * segue livre — só a colagem exige que sejam consecutivas.
   */
  function _conteudoCabe(conteudo, palavrasDoOutro) {
    if (!conteudo.length || !palavrasDoOutro.length) return false;
    const soltas = new Set(palavrasDoOutro);
    const coladas = _colagens(palavrasDoOutro);
    let i = 0;
    while (i < conteudo.length) {
      let usou = 0;
      // do maior grupo para o menor: 2+ palavras só casam coladas
      for (let n = Math.min(4, conteudo.length - i); n >= 1; n--) {
        const junta = conteudo.slice(i, i + n).join('');
        if (n === 1 && soltas.has(junta)) { usou = 1; break; }
        if (junta.length >= 6 && coladas.has(junta)) { usou = n; break; }
      }
      if (!usou) return false;
      i += usou;
    }
    return true;
  }
  function mesmoExame(a, b) {
    if (mesmoProduto(a, b)) return true;
    const A = _palavras(a), B = _palavras(b);
    if (!A.length || !B.length) return false;
    const [curto, longo] = A.length <= B.length ? [A, B] : [B, A];
    return _conteudoCabe(curto.filter(t => !_RUIDO.has(t) && t.length >= 3), longo);
  }

  /**
   * V845: as grafias têm o MESMO CONTEÚDO — tirando o ruído de embalagem
   * (PACOTE, COM, DE, "C/", "AMBOS OS OLHOS"…), as palavras que sobram são
   * IDÊNTICAS dos dois lados. É mais estrito que mesmoExame (que aceita a
   * curta contida na longa): qualquer palavra de conteúdo a mais mantém a
   * separação — FACO × FACO + ISTENT e OCT × OCT DE MÁCULA nunca se fundem
   * por aqui; "FACECTOMIA - COM LENTE…" × "PACOTE - FACECTOMIA COM LENTE…"
   * fundem.
   *
   * V870: "idênticas" passa a valer também quando a única diferença é a
   * COLAGEM (INTRAOCULAR × INTRA OCULAR). A conta de igualdade vira uma dupla
   * checagem — cada lado cabe INTEIRO no outro — que dá exatamente o mesmo
   * resultado de antes quando não há palavra colada no meio, e continua
   * separando quem tem conteúdo a mais (FACOEMUL, ISTENT, MÁCULA).
   */
  function mesmoConteudo(a, b) {
    const A = _conteudo(a), B = _conteudo(b);
    if (!A.length || !B.length) return false;
    return _conteudoCabe(A, _palavras(b)) && _conteudoCabe(B, _palavras(a));
  }

  /**
   * V785: nome OFICIAL do procedimento de uma grafia (de-para de nomenclaturas).
   * Devolve null quando a grafia não está no cadastro nem nos sinônimos.
   */
  let _procNomeCache = { versao: null, mapa: null };
  function _procNomeOficial(procId) {
    if (_procNomeCache.versao !== Banco._versao || !_procNomeCache.mapa) {
      const m = new Map();
      try {
        for (const r of Banco.query(`SELECT id, nome_oficial FROM procedimentos`) || []) {
          if (r.nome_oficial) m.set(r.id, r.nome_oficial);
        }
      } catch (e) {}
      _procNomeCache = { versao: Banco._versao, mapa: m };
    }
    return _procNomeCache.mapa.get(procId) || null;
  }

  /**
   * V785: agrupa as vigias pelo PROCEDIMENTO CANÔNICO (de-para de
   * nomenclaturas). "PACOTE - TOMOGRAFIA … OCT", "… OCT (AMBOS OS OLHOS)" e
   * "TOMOGRAFIA - DE COERENCIA OPTICA - OCT" são o mesmo exame: viram UMA
   * vigia, com o nome oficial, e geram UM alerta em vez de três.
   * Grafia fora do de-para continua com vigia própria (não dá para saber que
   * é a mesma coisa).
   */
  function vigiasAgrupadas() {
    const mapa = _procIdMapa();
    const grupos = [];
    lerVigias().forEach((v, indice) => {
      const papel = papelCanonico(v.papel);
      const procId = mapa.get(normNome(v.produto));
      // V786: o de-para de nomenclaturas resolve o caso fácil (mesmo
      // procedimento_id). Quando a grafia NÃO está lá — e é o caso dos nomes
      // de PRODUTO da produção, que nunca foram mapeados — vale a mesma
      // equivalência de nomenclatura usada no casamento: "PACOTE - X",
      // "X (AMBOS OS OLHOS)" e "X" são o MESMO exame.
      let g = _grupoDe(grupos.filter(x => x.papelCanon === papel), v.produto, procId);
      if (!g) {
        g = { procId: procId != null ? procId : null, papel: v.papel,
              papelCanon: papel, grafias: [], indices: [] };
        grupos.push(g);
      }
      if (g.procId == null && procId != null) g.procId = procId;
      g.grafias.push(v.produto);
      g.indices.push(indice);
    });
    // nome do grupo: a mesma regra de sempre (oficial do de-para, senão a raiz)
    // V855: `nome` continua sendo a grafia canônica (é ela que CASA com a
    // produção e o QVIS); `rotulo` é só a exibição — a NOMENCLATURA da Base
    // Tabela quando houver.
    return grupos.map((g, i) => {
      const nome = _nomeDoGrupo(g);
      return Object.assign({}, g, { chave: 'g' + i, nome, rotulo: rotuloAlerta(nome) });
    });
  }

  /**
   * V813: o AUXILIAR acompanha o EXECUTANTE — regra geral da Auditoria (a
   * linha do auxiliar é sempre renomeada para o cirurgião; a filha criada
   * pela Base Tabela nasce com o nome do executante). Consequência: quando o
   * executante do exame é o profissional INSTITUCIONAL, o auxiliar também é
   * da instituição — não tem repasse e nunca aparece no bloco 2. Cobrá-lo
   * seria alerta falso.
   */
  function execInstitucionalDoExame(linhasQvis, grafias) {
    return (linhasQvis || []).some(q =>
      grafias.some(gr => mesmoExame(gr, q.procedimento))
      && papelCanonico(q.papel) === 'EXECUTANTE'
      && ehMedicoInstitucional(q.nome_profissional));
  }

  /** quem é o profissional daquele papel, em português, para o texto do alerta */
  function quemDoPapel(papel) {
    return papelCanonico(papel) === 'MEDICO LAUDO'
      ? 'médico laudista' : String(papel).toLowerCase();
  }

  /**
   * V809: DIAGNÓSTICO DO PROCEDIMENTO — o motor deixa de depender da lista de
   * vigias e passa a cobrar o que a BASE TABELA manda pagar.
   *
   * Raciocínio do usuário: o valor do procedimento é a soma dos papéis. Se a
   * tabela remunera 3 papéis e o Consolidado pagou 2, alguma coisa aconteceu —
   * e isso vale para qualquer procedimento, não só para os vigiados.
   *
   * Para cada procedimento que o convênio informou (bloco 1), com profissional
   * nomeado, UM diagnóstico por procedimento:
   *
   *   sem regra que remunere (ou regra zerada)  → "Sem regra de repasse"
   *   com regra, NADA pago no bloco 2           → "procedimento recebido do
   *                                               convênio sem repasse executado"
   *   com regra, pago, faltando papel da regra  → "<PAPÉIS> não encontrado(s)
   *                                               para pagamento / sem
   *                                               informação … no sistema"
   *
   * Quem decide o que foi pago é sempre o BLOCO 2 — é ele que reflete o
   * processo inteiro da ferramenta.
   */
  function diagnosticoProcedimentos(adm, qvis, pagos) {
    const { procs, porProc, chaves } = _carregarRegras();
    // Sem Base Tabela carregada não há o que cobrar — a ferramenta não teria
    // como saber o que deveria ter sido pago (mesma guarda de temRegraDeRepasse).
    if (!chaves.size) return [];
    const linhasQvis = (qvis || []).filter(q => String(q.nome_profissional || '').trim());
    if (!linhasQvis.length) return [];
    // agrupa o bloco 1 por EXAME (de-para de nomenclatura), guardando o id do
    // procedimento quando alguma grafia dele está no cadastro
    const grupos = [];
    for (const q of linhasQvis) {
      const nome = q.procedimento || '';
      const pid = procs.get(normNome(q.procedimento_normalizado || nome));
      // V852: grafias com a MESMA NOMENCLATURA da Base Tabela são o mesmo
      // procedimento — geram UM alerta, não um por grafia
      const nomQ = nomenclaturaDe(nome);
      let g = grupos.find(x =>
        (!!nomQ && x.grafias.some(gr => nomenclaturaDe(gr) === nomQ))
        || x.grafias.some(gr => mesmoExame(gr, nome)));
      if (!g) { grupos.push(g = { pid: null, grafias: [], papeis: new Set() }); }
      if (g.pid == null && pid != null) g.pid = pid;
      g.grafias.push(nome);
      g.papeis.add(papelCanonico(q.papel));
    }
    const out = [];
    for (const g of grupos) {
      const nome = nomeCanonico(g.grafias.slice()
        .sort((a, b) => normNome(a).length - normNome(b).length)[0]);
      const daRegra = (g.pid != null && porProc.get(g.pid)) || null;
      // V813: auxiliar acompanha o executante — executante institucional
      // isenta o auxiliar junto (regra geral da Auditoria)
      const execInst = execInstitucionalDoExame(linhasQvis, g.grafias);
      // o que o BLOCO 2 pagou deste exame (só linha com profissional nomeado)
      const pagosDoExame = (pagos || []).filter(r =>
        g.grafias.some(gr => mesmoExame(r.linha.procedimento, gr))
        && String(r.linha._medicoNome || r.linha.nome_profissional || '').trim());
      if (!daRegra || !daRegra.size) {
        // exame PAGO sem regra conhecida não vira aviso: o pagamento aconteceu,
        // e dizer "sem regra" ali só confundiria quem lê.
        if (!pagosDoExame.length) {
          out.push({ tipo: 'sem_regra', produto: nome, papel: '',
            texto: `${rotuloAlerta(nome)} - Sem regra de repasse` });   // V852: nomenclatura da Base Tabela
        }
        continue;
      }
      if (!pagosDoExame.length) {
        // V811: exame cujo box 1 só tem profissional INSTITUCIONAL nunca gera
        // repasse — não é falha de execução, é a regra da casa.
        const soInstitucional = linhasQvis
          .filter(q => g.grafias.some(gr => mesmoExame(gr, q.procedimento)))
          .every(q => ehMedicoInstitucional(q.nome_profissional)
            || (execInst && papelCanonico(q.papel) === 'AUXILIAR'));
        if (!soInstitucional) {
          out.push({ tipo: 'sem_repasse', produto: nome, papel: '',
            texto: `${rotuloAlerta(nome)} - procedimento recebido do convênio sem repasse executado` });   // V852
        }
        continue;
      }
      const pagosPapel = new Set(pagosDoExame.map(r =>
        papelCanonico(r.linha._papelNome || r.linha.papel)));
      /**
       * V811 — o fluxo, na ordem que o usuário definiu:
       *   procedimento no box 1 → papéis desse procedimento na TABELA →
       *   todos pagos no box 2? → se não, alerta.
       *
       * A TABELA é a fonte dos papéis esperados (o box 1 só decide se o
       * procedimento entrou): se a regra remunera um papel e ele não está no
       * box 2, faltou — o motor de cálculo não achou a informação para pagar,
       * e é exatamente isso que o alerta diz.
       *
       * Exceção: papel ocupado por profissional INSTITUCIONAL no box 1. Ele
       * não tem regra de repasse aplicada de fato — nunca aparece pago no
       * box 2, e cobrá-lo seria alerta falso.
       */
      const institucional = new Set(linhasQvis
        .filter(q => g.grafias.some(gr => mesmoExame(gr, q.procedimento))
          && ehMedicoInstitucional(q.nome_profissional))
        .map(q => papelCanonico(q.papel)));
      if (execInst) institucional.add('AUXILIAR');   // V813
      const faltando = [...daRegra]
        .filter(p => !pagosPapel.has(p) && !institucional.has(p)).sort();
      if (!faltando.length) continue;
      const um = faltando.length === 1;
      out.push({ tipo: 'papel_ausente', produto: nome, papel: faltando.join(', '),
        texto: `${rotuloAlerta(nome)} - ${faltando.join(', ')} não encontrado${um ? '' : 's'} para pagamento`   // V852
          + ` / sem informação ${um ? 'de ' + quemDoPapel(faltando[0]) + ' ' : ''}no sistema` });
    }
    return out;
  }

  /**
   * Alertas das vigias para UMA admissão paga.
   * `pagos` = linhas que foram para o relatório do médico (matriz + complementos).
   */
  /**
   * V818: com vigia marcada o alerta é INDIVIDUALIZADO — o motor geral da
   * Base Tabela só fala dos procedimentos vigiados (qualquer grafia do grupo).
   * Sem vigia nenhuma, devolve null e o motor geral cobre tudo.
   */
  function filtroVigiados() {
    const vigias = vigiasAgrupadas();
    if (!vigias.length) return null;
    return (produto) => vigias.some(v =>
      v.grafias.concat(v.nome).some(g => mesmoExame(produto, g)));
  }
  function alertasVigia(adm, pagos, qvis) {
    // V785: uma vigia por procedimento canônico — as grafias do de-para
    // procuram todas juntas e o texto sai com o nome oficial.
    const vigias = vigiasAgrupadas().map(g => ({
      produto: g.nome, papel: g.papel, grafias: g.grafias.concat(g.nome),
    }));
    if (!vigias.length) return [];
    const linhasQvis = qvis || [];
    const out = [];
    for (const v of vigias) {
      // V785: qualquer grafia do grupo serve para achar o produto
      const grafias = v.grafias || [v.produto];
      // V799: a sigla do repasse ("OCT") conta como o exame lançado
      const casa = (nome) => grafias.some(g => mesmoExame(nome, g));
      const noQvis = linhasQvis.some(q => casa(q.procedimento));
      // V788: alerta ESTRUTURADO — a aba de resumo agrega por procedimento,
      // papel e diagnóstico; o texto continua o mesmo na coluna Situação.
      const alerta = (tipo, texto) => out.push({ tipo, produto: v.produto, papel: v.papel, texto });
      // V809: se o exame veio no bloco 1 e a BASE TABELA já manda pagar esse
      // papel, quem cobra é o motor geral (diagnosticoProcedimentos) — a vigia
      // sairia com o mesmo diagnóstico, em dobro. A vigia continua valendo
      // para o que a tabela não cobre e para exame fora do bloco 1.
      // V833: papel "Todos" = vigiar o procedimento inteiro. A vigia só marca
      // o produto; quem cobra papel a papel é o motor geral (que, com vigia
      // marcada, já roda individualizado — V818).
      const todosPapeis = normNome(v.papel) === 'TODOS';
      if (noQvis) {
        const { procs, porProc } = _carregarRegras();
        const naRegra = linhasQvis.some(q => {
          if (!casa(q.procedimento)) return false;
          const pid = procs.get(normNome(q.procedimento_normalizado || q.procedimento));
          const papeis = pid != null ? porProc.get(pid) : null;
          return !!(papeis && (todosPapeis ? papeis.size > 0 : papeis.has(papelCanonico(v.papel))));
        });
        if (naRegra) continue;
      }
      // V799: o BLOCO 2 decide. Se o procedimento saiu pago lá, ele existe —
      // mesmo que não apareça no bloco 1 nem na produção, porque pode ter sido
      // pago por outro caminho (o módulo de desempenho de laudos paga direto).
      // Só quando o bloco 2 não tem pagamento é que faz sentido perguntar onde
      // o procedimento está; a ordem inversa acusava falta de coisa paga.
      const doProduto = pagos.filter(r => casa(r.linha.procedimento));
      // só conta como pagamento a linha com PROFISSIONAL nomeado (regra V774)
      const comProfissional = doProduto.filter(r =>
        String(r.linha._medicoNome || r.linha.nome_profissional || '').trim());
      if (!comProfissional.length) {
        // V801: o MOTIVO é sempre o mesmo vocabulário — quem decide é o bloco
        // 1. Fora dele e sem pagamento no bloco 2, a presunção é que a admissão
        // ainda não foi recebida ou conciliada (e não "produção sem o exame").
        const semPag = alertaSemPagamento(v.produto, adm, grafias, pagos);
        if (semPag) out.push(semPag);   // V886: sem o procedimento, sem alerta
        continue;
      }
      // V833: com "Todos", produto pago no bloco 2 não tem papel específico a
      // cobrar aqui — os papéis faltantes saem pelo motor geral individualizado
      if (todosPapeis) continue;
      const alvo = papelCanonico(v.papel);
      const temPapel = comProfissional.some(r =>
        papelCanonico(r.linha._papelNome || r.linha.papel) === alvo);
      /**
       * V805: o alerta é sobre um procedimento QUITADO nos demais papéis, ao
       * qual falta só aquele que ele de fato teria que receber. Se OUTRO papel
       * do mesmo procedimento também ficou sem pagamento, a situação não é
       * "faltou o laudo" — é pagamento incompleto, e quem mostra isso é a
       * seção "Não pago nesta admissão (Base padrão)", linha a linha.
       */
      const pagoNoPapel = (papelQvis) => comProfissional.some(r =>
        papelCanonico(r.linha._papelNome || r.linha.papel) === papelCanonico(papelQvis));
      const outrosEmAberto = linhasQvis.some(q =>
        casa(q.procedimento)
        && papelCanonico(q.papel) !== alvo
        && String(q.nome_profissional || '').trim()
        && temRegraDeRepasse(q)
        && !pagoNoPapel(q.papel));
      // V813: vigia de AUXILIAR também respeita "auxiliar acompanha o
      // executante" — executante institucional, auxiliar isento
      if (alvo === 'AUXILIAR' && execInstitucionalDoExame(linhasQvis, grafias)) continue;
      if (!temPapel && !outrosEmAberto) {
        // V787: texto definido pelo usuário —
        // "<procedimento> - <PAPEL> não encontrado para pagamento / sem
        //  informação de <quem> no sistema"
        const quem = quemDoPapel(v.papel);
        alerta('papel_ausente',
          `${v.produto} - ${String(v.papel).toUpperCase()} não encontrado para pagamento`
          + ` / sem informação de ${quem} no sistema`);
      }
    }
    return out;
  }

  /**
   * V796: diagnóstico de um produto ESCOLHIDO no filtro da Situação que não
   * teve pagamento nenhum na admissão. Usa o molde do alerta de papel (V787):
   *
   *   "<produto> - <PAPEL> não encontrado para pagamento / <motivo>"
   *
   * O papel sai da vigia cadastrada para aquele produto; sem vigia, vale o
   * padrão da ferramenta (Médico Laudo). O nome do produto é o que você
   * escolheu no filtro — é o que você está procurando na planilha.
   *
   * Um procedimento que não foi pago só tem TRÊS motivos possíveis, e todos
   * se leem no bloco 1 (Base padrão) — é lá que a informação nasce:
   *
   *   1. o procedimento está no bloco 1 COM a linha do papel exigida, e mesmo
   *      assim não entrou no bloco 2 → nós é que não pagamos:
   *        "… / erro no processo de execução do repasse"
   *   2. o procedimento está no bloco 1 mas SEM a linha daquele papel (o
   *      laudo, por exemplo) → não dava para pagar, o lançamento não existe:
   *        "… / sem informação de <quem> no sistema"        (texto da V787)
   *   3. o procedimento não está no bloco 1 (logo também não está no 2) →
   *      ainda não há repasse a fazer:
   *        "Aguardando pagamento do convênio ou aguardando conciliação…"
   *                                                          (texto da V780)
   *
   * O caso "pagamos os outros papéis e faltou um" NÃO passa por aqui: aquele
   * procedimento aparece no bloco 2, então a Situação o descreve normalmente e
   * o alerta de vigia (alertasVigia) faz o diagnóstico — classificação que já
   * existia e continua igual.
   */
  function alertaSemPagamento(produto, adm, grafias, pagosDaAdm) {
    const grupo = vigiasAgrupadas().find(g =>
      g.grafias.concat(g.nome).some(gr => mesmoExame(gr, produto)));
    const papel = grupo ? grupo.papel : VIGIAS_PADRAO[0].papel;
    // V833: vigia "Todos" fala do procedimento inteiro — o texto sai sem
    // nomear papel ("<produto> - não encontrado para pagamento / ...")
    const todosPapeis = normNome(papel) === 'TODOS';
    const alvo = papelCanonico(papel);
    const quem = quemDoPapel(papel);
    const rotuloPapel = todosPapeis ? '' : `${String(papel).toUpperCase()} `;
    const semInfo = todosPapeis ? 'sem informação no sistema' : `sem informação de ${quem} no sistema`;
    // V797: procura por TODAS as grafias do exame, não só pela escolhida
    const nomes = [...new Set([produto].concat(grafias || []))];
    let qvisAdm = [], doProduto = [];
    try {
      qvisAdm = buscarQvis(adm) || [];
      doProduto = qvisAdm.filter(q => nomes.some(n => mesmoExame(q.procedimento, n)));
    } catch (e) {}
    /**
     * ══ V886: VIGIAR DOIS PROCEDIMENTOS NÃO É EXIGIR OS DOIS ════════════════
     *
     * Vigiando dois procedimentos sobre a mesma lista de admissões, uma
     * admissão pode ter um, o outro, ou os dois. Acusar "não encontrado para
     * pagamento" numa admissão que simplesmente NÃO TEM aquele procedimento
     * não é diagnóstico — é ruído, e ruído que parece erro.
     *
     * Quem diz se o procedimento existiu é a PRODUÇÃO (e, por segurança, o
     * box 1 e o que já foi pago no box 2 — um exame pago por desempenho pode
     * não estar na produção). Não existindo em nenhum dos três, a vigia não
     * tem o que dizer sobre esta admissão: devolve nada.
     */
    const casaNome = (x) => nomes.some(n => mesmoExame(String(x || ''), n));
    let naProducao = false;
    try {
      naProducao = (buscarProducao(adm) || [])
        .some(l => casaNome(l.produto) || casaNome(l.procedimento_principal));
    } catch (e) {}
    const noPago = (pagosDaAdm || []).some(r => casaNome(r && r.linha && r.linha.procedimento));
    if (!naProducao && !noPago && !doProduto.length) return null;
    if (!doProduto.length) {
      // V809: fora do bloco 1 há duas leituras — a admissão ainda não foi paga
      // (nada em lugar nenhum: aguardando) ou ela FOI paga e este procedimento
      // simplesmente não apareceu para pagar, que é falta de informação.
      //
      // V810: "paga" exige informação na BASE PADRÃO. Com o bloco 1 vazio o
      // convênio não pagou nada — não há o que encontrar, e cobrar um papel
      // ali seria acusar falta de algo que nunca poderia existir. (O bloco 2
      // pode ter só um adiantamento de desempenho, que não é pagamento da
      // admissão.)
      const admPaga = !!(pagosDaAdm && pagosDaAdm.length) && qvisAdm.length > 0;
      if (!admPaga) {
        return { tipo: 'aguardando', produto, papel,
          texto: `${rotuloAlerta(produto)} - ${AGUARDANDO}` };   // V852
      }
      return { tipo: 'papel_ausente', produto, papel, motivo: 'sem_informacao',
        texto: `${rotuloAlerta(produto)} - ${rotuloPapel}não encontrado para pagamento`
          + ` / ${semInfo}` };
    }
    // 2) está na base padrão, mas sem a linha do papel exigido (com
    //    profissional nomeado — linha sem nome não é lançamento, regra V774)
    const temLinhaDoPapel = doProduto.some(q =>
      (todosPapeis || papelCanonico(q.papel) === alvo) && String(q.nome_profissional || '').trim());
    const motivo = temLinhaDoPapel
      ? 'erro no processo de execução do repasse'
      : semInfo;
    return {
      tipo: 'papel_ausente', produto, papel,
      motivo: temLinhaDoPapel ? 'execucao_repasse' : 'sem_informacao',
      texto: `${rotuloAlerta(produto)} - ${rotuloPapel}não encontrado para pagamento`
        + ` / ${motivo}`,
    };
  }

  /**
   * V754: estrutura analítica do que foi pago, na leitura pedida pelo usuário:
   *   • uma linha por PROCEDIMENTO (nomes repetidos são fundidos, com "xN" na
   *     frente quando houve mais de uma ocorrência);
   *   • dentro dele, o médico que recebeu, com os PAPÉIS e valores;
   *   • linha glosada não mostra valor — mostra "glosa".
   * A contagem xN soma, por médico, a maior repetição de um mesmo papel: dois
   * olhos com o mesmo médico/papel contam 2, e dois médicos diferentes no
   * mesmo procedimento também contam 2.
   */
  function analiticoPago(repasse, paraTela) {
    // V841: grafias do MESMO procedimento saem sob UM padrão só — o
    // agrupamento de nomenclatura das listas (V834) agora vale também para as
    // linhas de pagamento. A regra estrita do V797 deixava passar pares como
    // "FACECTOMIA - COM LENTE…" × "PACOTE - FACECTOMIA COM LENTE…" quando a
    // grafia longa tem palavras a mais; a régua ampla (mesmoExame) os junta,
    // e a guarda do cadastro mantém procedimentos DISTINTOS separados.
    const padrao = padraoDeExibicao(repasse.map(r =>
      String(r.linha.procedimento || '').replace(/\s+/g, ' ').trim()));
    const porProc = new Map();
    for (const r of repasse) {
      const l = r.linha;
      // V797: grafias do mesmo exame descrevem UMA linha, com o nome canônico —
      // "PACOTE - X", "X (AMBOS OS OLHOS)" e "X" não se repetem no relatório.
      /**
       * V879: pagamento vindo de um módulo de desempenho pode chegar SEM o
       * nome do procedimento — foto de mês congelada antes da V875, por
       * exemplo. Em vez do "—" mudo, a linha diz de qual fichário ela veio:
       * "(OPME)" explica muito mais do que um travessão.
       */
      const bruto = (l.procedimento
        || (l._moduloCons ? `(${String(l._moduloCons).trim()})` : '—')).replace(/\s+/g, ' ').trim();
      const proc = (bruto === '—' || /^\(.*\)$/.test(bruto)) ? bruto
        : (padrao.get(normNome(bruto)) || nomeCanonico(bruto));
      // V808: a EXTRAÇÃO leva o nome real; a TELA respeita o "ocultar nomes"
      // V882: e o nome real é o OFICIAL do cadastro, pelo de-para
      const nomeReal = nomeOficialMedico(l._medicoNome || l.nome_profissional || '') || '—';
      const medico = paraTela ? CodigoMedico.exibir(nomeReal) : nomeReal;
      // V761: sempre nomeado · V765: em caixa alta
      const papel = String(l._papelNome || l.papel || l._papel || '—').toUpperCase();
      const glosa = l._status === 'glosa';
      const valor = Number(l._repasse) || 0;
      if (!porProc.has(proc)) porProc.set(proc, { proc, total: 0, medicos: new Map() });
      const g = porProc.get(proc);
      g.total += valor;
      if (!g.medicos.has(medico)) g.medicos.set(medico, new Map());
      const papeis = g.medicos.get(medico);
      // V770: a chave inclui o VALOR — assim cada pagamento aparece com o
      // número exato que saiu no Relatório Repasse, em vez de uma soma.
      // V799: pagamento vindo de um módulo de desempenho (status
      // "Desempenho") ganha a marca do caminho — é o que explica o papel estar
      // no bloco 2 sem estar no bloco 1.
      /**
       * V801 dizia só "desempenho" — o caminho, de propósito, sem o módulo.
       * V875 volta atrás a pedido do usuário: saber que o valor veio "por
       * desempenho" não basta para ir conferir. Agora a marca nomeia a ORIGEM
       * ("via desempenho · OPME"), que é o fichário onde a linha foi paga.
       */
      const modCons = String(l._moduloCons || '').trim();
      const via = /desempenh/i.test(String(l._statusCons || ''))
        ? ('desempenho' + (modCons ? ' · ' + modCons : '')) : '';
      const k = papel + '|' + (glosa ? 'G' : 'V') + '|' + valor + '|' + via;
      if (!papeis.has(k)) papeis.set(k, { papel, valor, glosa, via, n: 0 });
      papeis.get(k).n++;
    }
    return [...porProc.values()].map(g => {
      const medicos = [...g.medicos.entries()].map(([medico, papeis]) => ({
        medico, itens: [...papeis.values()].sort((a, b) => b.valor - a.valor),
      }));
      const vezes = medicos.reduce((t, m) => t + Math.max(...m.itens.map(i => i.n)), 0);
      return { proc: g.proc, total: g.total, vezes, medicos };
    }).sort((a, b) => b.total - a.total);
  }

  /**
   * V776: PAGAMENTO COMPLEMENTAR — a mesma admissão volta a ser paga numa
   * competência POSTERIOR à do pagamento principal (o convênio liberou um
   * resto, um procedimento saiu atrasado, uma glosa foi revertida…).
   *
   * Caso relatado: a admissão 39646338 foi paga em 2026-06 e recebeu um
   * complemento em 2026-07. Antes, os dois meses vinham misturados na mesma
   * lista e nada dizia que aquilo era complemento.
   *
   * Regra: a PRIMEIRA competência em que a admissão foi paga é o pagamento
   * principal; toda competência posterior é complemento e sai à parte, com o
   * mês, o total e os procedimentos que entraram nele. Vale para qualquer
   * admissão — o corte é feito pelos dados, não por uma lista fixa.
   */
  function separarComplemento(achados) {
    // V777: linha vinda do CONSOLIDADO (Linha avulsa / Inserir complementos) é
    // complemento POR DEFINIÇÃO — ela foi digitada/importada por fora do
    // cálculo, mesmo que caia no mesmo mês do pagamento principal.
    const ehCompl = (r) => !!r._manual;
    const snaps = achados.filter(r => !ehCompl(r));
    const comps = [...new Set(snaps.map(r => r.competencia))].sort();
    const principal = comps[0] || '';
    const achadosPrincipal = snaps.filter(r => r.competencia === principal);
    const resto = achados.filter(r => ehCompl(r) || r.competencia !== principal);
    const porComp = new Map();
    for (const r of resto) {
      if (!porComp.has(r.competencia)) porComp.set(r.competencia, []);
      porComp.get(r.competencia).push(r);
    }
    return {
      principal,
      achadosPrincipal,
      complementos: [...porComp.keys()].sort().map(c => ({
        competencia: c,
        achados: porComp.get(c),
        total: porComp.get(c).reduce((t, r) => t + (Number(r.linha._repasse) || 0), 0),
      })),
    };
  }

  /**
   * V777: pagamentos feitos POR FORA do cálculo — as linhas do CONSOLIDADO
   * digitadas na "Linha avulsa" ou importadas em "Inserir complementos"
   * (tabela consolidado_linhas_manuais, status típico "Complemento").
   *
   * Caso relatado: a admissão 39646338 tinha o complemento de 2026-07 lançado
   * assim — ele aparecia no Consolidado com o selo "Complemento", mas a
   * Inspeção só lia os snapshots do cálculo e não enxergava NADA disso.
   * Devolve no mesmo formato dos achados da matriz para os mesmos
   * agrupadores (analiticoPago / separarComplemento) funcionarem.
   */
  function buscarComplementosManuais(adm) {
    const v = variantesAdm(adm);
    if (!v.length) return [];
    try {
      const rows = Banco.query(
        `SELECT * FROM consolidado_linhas_manuais
          WHERE ${sqlIn('admissao', v)} ORDER BY competencia, id`, v) || [];
      return rows.map(r => ({
        competencia: r.competencia, _manual: true, linha: {
          admissao: r.admissao, paciente: r.paciente || '',
          data_admissao: r.data || '', procedimento: String(r.descricao || '—').trim() || '—',
          _status: 'casou', _repasse: Number(r.valor) || 0,
          _medicoNome: r.profissional || '', _papelNome: r.papel || '',
        },
      }));
    } catch (e) { return []; }   // base antiga sem a tabela: nada a somar
  }

  /**
   * V759: papel em forma CANÔNICA para comparar QVIS × matriz. Usa o
   * mapeamento oficial da ferramenta (mapeamento_papeis → papeis: MEDICO e
   * CIRURGIAO viram Executante, AUXILIAR 1/2 viram Auxiliar…) e, por cima,
   * a regra do usuário: SOLICITANTE e INDICANTE são o MESMO papel — a própria
   * base diz "Indicante: paga o mesmo valor que Solicitante". Sem isso, uma
   * linha paga como Indicante reaparecia como "não paga" por vir do QVIS
   * escrita SOLICITANTE.
   */
  let _papeisCache = { versao: null, mapa: null };
  function papelCanonico(papel) {
    const n = normNome(papel);
    if (!n) return '';
    if (_papeisCache.versao !== Banco._versao || !_papeisCache.mapa) {
      const mapa = new Map();
      try {
        for (const r of Banco.query(
          `SELECT mp.papel_qvis AS q, pa.nome AS n
             FROM mapeamento_papeis mp JOIN papeis pa ON pa.id = mp.papel_id`) || []) {
          mapa.set(normNome(r.q), normNome(r.n));
        }
      } catch (e) {}
      _papeisCache = { versao: Banco._versao, mapa };
    }
    let c = _papeisCache.mapa.get(n) || n;
    if (c === 'CIRURGIAO' || c === 'MEDICO') c = 'EXECUTANTE';
    if (c === 'MEDICO DE LAUDO') c = 'MEDICO LAUDO';
    if (/^AUXILIAR( \d)?$/.test(c)) c = 'AUXILIAR';
    if (c === 'SOLICITANTE') c = 'INDICANTE';        // mesma regra de repasse
    return c;
  }

  /**
   * V760: existe REGRA de repasse para esse procedimento + papel?
   *
   * Leitura DIRETA da Base Tabela (tabela_repasse + exceções), sem passar pelo
   * motor do Calcular: inicializar aquela tela num sandbox recalculava e
   * regravava o snapshot da competência — efeito colateral inaceitável numa
   * tela de consulta.
   *
   * Consulta com Solicitante, por exemplo, não tem regra: não é divergência, é
   * o desenho da tabela. O foco do relatório é o que TEM regra e mesmo assim
   * não foi pago ao médico (outro profissional informado, por exemplo).
   */
  let _regrasCache = { versao: null, chaves: null, procs: null };
  function _carregarRegras() {
    if (_regrasCache.versao === Banco._versao && _regrasCache.chaves) return _regrasCache;
    const chaves = new Set();
    const procs = new Map();   // nome normalizado → id
    try {
      for (const r of Banco.query(
        `SELECT id, nome_oficial, nome_normalizado FROM procedimentos`) || []) {
        procs.set(normNome(r.nome_normalizado || r.nome_oficial), r.id);
      }
    } catch (e) {}
    // V809: além de "existe regra?", o motor precisa saber o que a regra manda
    // PAGAR. Regra com valor e percentual zerados não remunera ninguém — para
    // efeito de cobrança ela vale como "sem regra de repasse".
    const porProc = new Map();   // procedimento_id → Set de papéis REMUNERADOS
    // V846: além de QUAIS papéis, QUANTO cada um vale (p/ o "Repasse faltante")
    const porProcValores = new Map();   // procedimento_id → Map<papel, {valor, percentual}>
    const juntar = (rows) => {
      for (const r of rows || []) {
        const papel = papelCanonico(r.papel);
        // V812: regra SEM VALOR não remunera — para todo efeito (diagnóstico,
        // seção "não pago", vigias) ela vale como regra inexistente. Exemplo do
        // usuário: a retinografia monocular paga indicante e laudo; executante
        // e auxiliar não têm valor e não podem ser cobrados em lugar nenhum.
        const remunera = (Number(r.valor) || 0) > 0 || (Number(r.percentual) || 0) > 0;
        if (!remunera) continue;
        chaves.add(r.procedimento_id + '|' + papel);
        if (!porProc.has(r.procedimento_id)) porProc.set(r.procedimento_id, new Set());
        porProc.get(r.procedimento_id).add(papel);
        if (!porProcValores.has(r.procedimento_id)) porProcValores.set(r.procedimento_id, new Map());
        const vm = porProcValores.get(r.procedimento_id);
        if (!vm.has(papel)) vm.set(papel, { valor: r.valor, percentual: r.percentual });
      }
    };
    try {
      juntar(Banco.query(
        `SELECT t.procedimento_id, t.valor, t.percentual, pa.nome AS papel FROM tabela_repasse t
           JOIN papeis pa ON pa.id = t.papel_id WHERE t.ativo = 1`));
    } catch (e) {}
    try {
      juntar(Banco.query(
        `SELECT e.procedimento_id, e.valor, e.percentual, pa.nome AS papel FROM tabela_repasse_excecao e
           JOIN papeis pa ON pa.id = e.papel_id WHERE e.ativo = 1`));
    } catch (e) {}
    _regrasCache = { versao: Banco._versao, chaves, procs, porProc, porProcValores };
    return _regrasCache;
  }

  /**
   * ══ V871: A REGRA É A DA ÉPOCA DA ADMISSÃO ═════════════════════════════
   *
   * A Base Tabela é VERSIONADA: cada versão publicada tem uma data de
   * vigência, e o resto da ferramenta (motor do Calcular, Auditoria, Balanço
   * Retroativo) já resolve a regra de cada linha pela DATA DA ADMISSÃO — uma
   * cirurgia de março é paga pela tabela que valia em março, mesmo que hoje
   * exista uma versão mais nova.
   *
   * A Inspeção não fazia isso. O "Repasse faltante" lia a tabela VIVA — a
   * última versão publicada — e precificava com ela qualquer admissão, de
   * qualquer data. Numa base com duas versões, uma admissão antiga aparecia
   * com o valor de hoje: número que não bate com o repasse, e que não bateria
   * nem se a gente pagasse (o motor pagaria pela versão da época).
   *
   * Agora a Inspeção usa a MESMA resolução do resto da ferramenta — o
   * AtlasVersoesTabela.resolver(), para a regra de vigência morar num lugar
   * só (dia da publicação já conta para a versão nova; admissão anterior a
   * TODAS as vigências cai na versão de MENOR número, a padrão — V639).
   *
   * Sem nenhuma versão publicada, nada muda: vale a tabela viva.
   *
   * Ressalva: as EXCEÇÕES por médico (tabela_repasse_excecao) não são
   * versionadas em lugar nenhum da ferramenta — não há histórico delas para
   * consultar. Elas continuam entrando como estão hoje, como o snapshot da
   * Auditoria também faz.
   */
  let _regrasVerCache = { versao: null, porVersao: null };
  function _versoesTabela() {
    try {
      if (window.AtlasVersoesTabela && window.AtlasVersoesTabela.garantir()) {
        return window.AtlasVersoesTabela.listar() || [];
      }
    } catch (e) {}
    return [];
  }
  /** Versão publicada que vale numa data ('YYYY-MM-DD'); null = base sem versões */
  function versaoDaAdmissao(dataAdm) {
    const vs = _versoesTabela();
    if (!vs.length) return null;
    try { return window.AtlasVersoesTabela.resolver(dataAdm, vs); } catch (e) { return null; }
  }
  /** Monta {chaves, procs, porProc, porProcValores} da VERSÃO pedida */
  function _regrasDaVersao(vid) {
    if (_regrasVerCache.versao !== Banco._versao || !_regrasVerCache.porVersao) {
      _regrasVerCache = { versao: Banco._versao, porVersao: new Map() };
    }
    const pronta = _regrasVerCache.porVersao.get(vid);
    if (pronta) return pronta;
    const vivas = _carregarRegras();
    const chaves = new Set();
    const porProc = new Map();
    const porProcValores = new Map();
    const juntar = (rows) => {
      for (const r of rows || []) {
        const papel = papelCanonico(r.papel);
        // mesma guarda da V812: regra sem valor não remunera ninguém
        if (!((Number(r.valor) || 0) > 0 || (Number(r.percentual) || 0) > 0)) continue;
        chaves.add(r.procedimento_id + '|' + papel);
        if (!porProc.has(r.procedimento_id)) porProc.set(r.procedimento_id, new Set());
        porProc.get(r.procedimento_id).add(papel);
        if (!porProcValores.has(r.procedimento_id)) porProcValores.set(r.procedimento_id, new Map());
        const vm = porProcValores.get(r.procedimento_id);
        if (!vm.has(papel)) vm.set(papel, { valor: r.valor, percentual: r.percentual });
      }
    };
    try {
      juntar(Banco.query(
        `SELECT h.procedimento_id, h.valor, h.percentual, pa.nome AS papel FROM tabela_repasse_hist h
           JOIN papeis pa ON pa.id = h.papel_id WHERE h.versao_id = ? AND h.ativo = 1`, [vid]));
    } catch (e) {}
    // exceções por médico: não versionadas — entram como estão (ver cabeçalho)
    try {
      juntar(Banco.query(
        `SELECT e.procedimento_id, e.valor, e.percentual, pa.nome AS papel FROM tabela_repasse_excecao e
           JOIN papeis pa ON pa.id = e.papel_id WHERE e.ativo = 1`));
    } catch (e) {}
    // versão publicada vazia (nada no histórico) → não dá para precificar por
    // ela; melhor a tabela viva do que zerar tudo em silêncio
    const base = chaves.size ? { chaves, procs: vivas.procs, porProc, porProcValores } : vivas;
    _regrasVerCache.porVersao.set(vid, base);
    return base;
  }
  /** As regras que valiam na data da admissão (tabela viva quando não há versões) */
  function _regrasNaData(dataAdm) {
    const v = versaoDaAdmissao(dataAdm);
    return v ? _regrasDaVersao(v.id) : _carregarRegras();
  }

  // ── V846: flag "Adicionar Repasse faltante" (persiste com as preferências) ──
  const REP_FALT_KEY = 'insp_rep_faltante_v1';
  const lerRepFaltante = () => cfgLer(REP_FALT_KEY) === '1';                       // V858
  const salvarRepFaltante = (b) => cfgGravar(REP_FALT_KEY, b ? '1' : '0');         // V858

  /**
   * ══ V873: OPME NÃO PAGO ENTRA NO REPASSE FALTANTE ═══════════════════════
   *
   * OPME não é pago pela Base Tabela — quem o paga é o MÓDULO DE OPME, com um
   * PERCENTUAL sobre o valor do material. E esse valor mora no BOX 3 (produção
   * analítica): no box 1 o material aparece zerado, e por isso a extração o
   * joga na lista "Não pago nesta admissão" com R$ 0,00. A ferramenta acusava
   * que faltou, mas não dizia QUANTO — o Repasse faltante só somava o que a
   * Base Tabela manda pagar nos procedimentos vigiados.
   *
   * Agora, quando um OPME elegível está no box 3 e não tem pagamento nenhum na
   * admissão, a Inspeção acha a linha dele na produção, aplica a MESMA regra do
   * módulo de OPME e leva o valor para o Repasse faltante.
   *
   * A precedência do percentual é a do módulo, na mesma ordem:
   *   1. regra por PRODUTO (switch nos Ajustes; nasce inativa) — vence tudo;
   *   2. regra do MÉDICO × % do próprio TERMO — desempate pelo switch
   *      "Respeitar regra do médico";
   *   3. regra por PAPEL (switch; nasce inativa);
   *   4. PCT_GERAL (10% de fábrica).
   * Os termos elegíveis são lidos da tabela do próprio módulo
   * (opme_termos_elegiveis): os Ajustes dele continuam mandando aqui.
   *
   * Fica de fora o que já foi pago: admissão marcada como paga no módulo
   * (opme_pagamentos), admissão com repasse antecipado (EV) e material com
   * qualquer pagamento no Consolidado — somar seria cobrar duas vezes.
   *
   * A versão da Base Tabela (V871) NÃO se aplica: o percentual do OPME não é
   * versionado, não há histórico dele. Vale o que está configurado hoje.
   */
  let _opmeCfgCache = { versao: null, cfg: null };
  function _opmeCfg() {
    if (_opmeCfgCache.versao === Banco._versao && _opmeCfgCache.cfg) return _opmeCfgCache.cfg;
    const cfg = { pctGeral: 10, respeitarMedico: true, termos: [],
      regrasMedico: new Map(), regraProdutoAtiva: false, regraPapelAtiva: false,
      regrasProduto: new Map(), regrasPapel: new Map() };
    const um = (chave) => {
      try {
        const r = Banco.queryUnica(`SELECT valor FROM config_opme WHERE chave = ?`, [chave]);
        return r ? r.valor : null;
      } catch (e) { return null; }
    };
    const pg = um('PCT_GERAL');
    if (pg != null) cfg.pctGeral = Number(pg) || 10;
    const rm = um('RESPEITAR_REGRA_MEDICO');
    if (rm != null) cfg.respeitarMedico = String(rm) !== '0';
    cfg.regraProdutoAtiva = String(um('REGRA_PRODUTO_ATIVA') || '') === '1';
    cfg.regraPapelAtiva = String(um('REGRA_PAPEL_ATIVA') || '') === '1';
    try {
      cfg.termos = Banco.query(`SELECT termo, ativo, pct FROM opme_termos_elegiveis`) || [];
    } catch (e) {}
    try {
      for (const r of Banco.query(
        `SELECT produto_normalizado, pct FROM opme_regra_produto`) || []) {
        cfg.regrasProduto.set(normNome(r.produto_normalizado), Number(r.pct));
      }
    } catch (e) {}
    try {
      for (const r of Banco.query(
        `SELECT papel_normalizado, produto_normalizado, pct FROM opme_regra_papel`) || []) {
        cfg.regrasPapel.set(`${normNome(r.papel_normalizado)}|${normNome(r.produto_normalizado || '')}`,
          Number(r.pct));
      }
    } catch (e) {}
    try {
      for (const r of Banco.query(
        `SELECT nome_normalizado, nome_exibicao, pct FROM opme_regra_medico`) || []) {
        // a regra vale para TODAS as grafias do mesmo médico (de-para)
        cfg.regrasMedico.set(_chaveMedicoOpme(r.nome_exibicao || r.nome_normalizado), Number(r.pct));
      }
    } catch (e) {}
    _opmeCfgCache = { versao: Banco._versao, cfg };
    return cfg;
  }
  /** chave canônica do médico — o de-para do cadastro, como nos outros módulos */
  function _chaveMedicoOpme(nome) {
    const n = normNome(nome);
    if (!n) return '';
    try {
      const r = Banco.queryUnica(
        `SELECT m.nome_oficial AS n FROM medicos m WHERE UPPER(m.nome_normalizado) = ?
          UNION ALL
         SELECT m.nome_oficial AS n FROM sinonimos_medico s JOIN medicos m ON m.id = s.medico_id
          WHERE UPPER(s.grafia_normalizada) = ? LIMIT 1`, [n, n]);
      if (r && r.n) return normNome(r.n);
    } catch (e) {}
    return n;
  }
  /**
   * O termo casa o produto? Termo curto (< 5 letras, como MP3 e COLA) exige
   * PALAVRA INTEIRA — "COLA" não pode pegar COLAGENO nem COLANGIO. Termo longo
   * segue o "contém" do módulo.
   */
  function _termoCasa(termo, produto) {
    const t = normNome(termo), p = normNome(produto);
    if (!t || !p) return false;
    if (t.length >= 5) return p.indexOf(t) >= 0;
    return _palavras(p).indexOf(t) >= 0;
  }
  /** % do termo ATIVO com pct definido que casa o produto (empate: termo mais longo) */
  function _pctDoTermoOpme(produto, cfg) {
    let achado = null, achadoLen = -1;
    for (const t of (cfg.termos || [])) {
      if (!t.ativo) continue;
      if (t.pct === null || t.pct === undefined || t.pct === '') continue;
      if (!_termoCasa(t.termo, produto)) continue;
      const n = normNome(t.termo).length;
      if (n > achadoLen) { achado = t; achadoLen = n; }
    }
    return achado ? Number(achado.pct) : null;
  }
  /** o percentual do módulo de OPME para (médico, produto, papel) → {pct, origem} */
  function _pctOpme(nomeMedico, produto, papel, cfg) {
    if (cfg.regraProdutoAtiva && cfg.regrasProduto.size) {
      const rp = cfg.regrasProduto.get(normNome(produto));
      if (rp != null) return { pct: Number(rp) || 0, origem: 'produto' };
    }
    const nm = _chaveMedicoOpme(nomeMedico || '');
    const temMedico = !!(nm && cfg.regrasMedico.has(nm));
    const pctTermo = _pctDoTermoOpme(produto, cfg);
    const temTermo = pctTermo !== null;
    if (temMedico && temTermo) {
      return cfg.respeitarMedico
        ? { pct: Number(cfg.regrasMedico.get(nm)) || 0, origem: 'médico' }
        : { pct: pctTermo, origem: 'OPME' };
    }
    if (temMedico) return { pct: Number(cfg.regrasMedico.get(nm)) || 0, origem: 'médico' };
    if (temTermo) return { pct: pctTermo, origem: 'OPME' };
    if (cfg.regraPapelAtiva && papel && cfg.regrasPapel.size) {
      const pk = normNome(papel);
      const espec = cfg.regrasPapel.get(`${pk}|${normNome(produto)}`);
      if (espec != null) return { pct: Number(espec) || 0, origem: 'papel' };
      const qualquer = cfg.regrasPapel.get(`${pk}|`);
      if (qualquer != null) return { pct: Number(qualquer) || 0, origem: 'papel' };
    }
    return { pct: Number(cfg.pctGeral) || 10, origem: 'geral' };
  }
  /**
   * V875: ESTE material já tem repasse antecipado (EV) nesta admissão?
   *
   * A V873 vetava a ADMISSÃO INTEIRA quando ela tinha qualquer marca de pago
   * no módulo de OPME. Era grosseiro demais: numa admissão com dois materiais,
   * um pago e outro não, o segundo sumia da conta. Agora a pergunta é por
   * material — quem responde "já pagaram este aqui" é o Consolidado (que desde
   * a V875 traz o NOME do OPME) e, para o adiantamento, o EV do próprio
   * material.
   */
  function _opmeTemEv(adm, produto) {
    for (const v of variantesAdm(adm)) {
      try {
        for (const r of Banco.query(
          `SELECT procedimento FROM opme_repasse_antecipado WHERE admissao = ?`, [v]) || []) {
          if (mesmoExame(String(r.procedimento || ''), produto)) return true;
        }
      } catch (e) {}
    }
    return false;
  }
  /** valor de partida do material — com o valor fixo de subfaturamento do módulo */
  function _baseOpme(l) {
    const bruto = Number(l.valor) || 0;
    const api = window.AtlasOPME && window.AtlasOPME._interno;
    if (!api || typeof api.baseComValorFixo !== 'function') return bruto;
    try {
      const ehPart = /PART/i.test(String(l.tipo_recebimento || ''));
      const r = api.baseComValorFixo(l.produto, bruto, l.convenio, ehPart, l.cod_admissao);
      return Number(r && r.base) > 0 ? Number(r.base) : bruto;
    } catch (e) { return bruto; }
  }
  /**
   * OPMEs do box 3 desta admissão que não foram pagos por ninguém, já
   * precificados pela regra do módulo. Devolve [] quando não há nenhum.
   */
  function opmeFaltanteDe(adm, prod, pagosLinhas) {
    const cfg = _opmeCfg();
    const ativos = (cfg.termos || []).filter(t => t.ativo);
    if (!ativos.length) return [];
    const linhas = (prod || []).filter(l =>
      /OPME/i.test(String(l.classificacao_produto || ''))
      && ativos.some(t => _termoCasa(t.termo, l.produto)));
    if (!linhas.length) return [];
    // pagamento de QUALQUER valor no Consolidado para aquele material tira ele
    // da conta (glosa não é pagamento)
    const pago = (produto) => (pagosLinhas || []).some(r => {
      const l = r.linha;
      if (/glosa/i.test(String(l.status || ''))) return false;
      if (!(Number(l.valor) > 0)) return false;
      return mesmoExame(String(l.descricao || ''), produto);
    });
    /**
     * V881: material GLOSADO não gera repasse faltante. Glosa não é pagamento
     * — mas também não é dívida: o hospital não recebeu, o médico não vai
     * receber, e a conta do que falta repassar é ZERO. Cobrar aqui seria
     * transformar uma glosa em dívida da casa.
     */
    const glosado = (produto) => (pagosLinhas || []).some(r => {
      const l = r.linha;
      if (!/glosa/i.test(String(l.status || ''))) return false;
      return mesmoExame(String(l.descricao || ''), produto);
    });
    /**
     * ══ V879: O PAGAMENTO DE OPME QUE NÃO DIZ O MATERIAL ══════════════════
     *
     * A V875 fez o adaptador do OPME mandar o nome do material junto. Só que
     * mês CONGELADO guarda uma FOTO do Consolidado — e as fotos tiradas antes
     * daquela versão não têm o nome. Na Situação a linha sai como "— —", e
     * aqui a comparação por nome não casava: o material aparecia pago no texto
     * e cobrado na coluna, ao mesmo tempo.
     *
     * Sem nome não dá para dizer QUAL material foi pago. Então a conta passa a
     * ser pelo VALOR: um pagamento anônimo de OPME quita o material cujo
     * repasse calculado bate com ele. E se sobrar pagamento anônimo sem par,
     * os materiais restantes saem da cobrança — entre cobrar duas vezes e
     * deixar de cobrar, o erro caro é o primeiro.
     */
    const anonimos = (pagosLinhas || []).filter(r => {
      const l = r.linha;
      if (/glosa/i.test(String(l.status || ''))) return false;
      if (!(Number(l.valor) > 0)) return false;
      if (String(l.descricao || '').trim()) return false;       // esse tem nome
      return /OPME/i.test(String(l.modulo || ''));
    }).map(r => ({ valor: Number(r.linha.valor) || 0, usado: false }));
    const quitaAnonimo = (quanto) => {
      const alvo = anonimos.find(a => !a.usado && Math.abs(a.valor - quanto) < 0.01);
      if (alvo) { alvo.usado = true; return true; }
      return false;
    };
    const grupos = new Map();
    for (const l of linhas) {
      const produto = String(l.produto || '').trim();
      if (!produto || pago(produto)) continue;
      if (glosado(produto)) continue;                             // V881: glosa → zero
      if (_opmeTemEv(l.cod_admissao || adm, produto)) continue;   // V875: adiantado
      // V875: subfaturamento — o módulo troca o valor da base pelo valor fixo
      // cadastrado (ISTENT a R$ 500 na base valendo R$ 12.980). Sem isso o
      // repasse faltante sairia uma fração do devido.
      const valorMaterial = _baseOpme(l);
      if (valorMaterial <= 0) continue;
      // a regra do módulo é procurada pela GRAFIA da produção (ela já resolve
      // o cadastro por dentro); V882: o que sai escrito é o nome OFICIAL
      const grafiaMed = String(l.cirurgiao || l.medico || '').trim();
      const medico = nomeOficialMedico(grafiaMed);
      const { pct, origem } = _pctOpme(grafiaMed, produto, l.papel || 'EXECUTANTE', cfg);
      const quanto = valorMaterial * (Number(pct) || 0) / 100;
      if (quanto <= 0) continue;
      if (quitaAnonimo(quanto)) continue;   // V879: pagamento anônimo bate no valor
      const k = normNome(produto) + '|' + normNome(medico);
      if (!grupos.has(k)) {
        grupos.set(k, { proc: produto, opme: true, medico, pct, origemPct: origem,
          material: 0, valor: 0, papeis: [] });
      }
      const g = grupos.get(k);
      g.material += valorMaterial;
      g.valor += quanto;
    }
    /**
     * V879: sobrou pagamento anônimo de OPME sem par de valor? Então houve
     * repasse de OPME nesta admissão que não conseguimos atribuir. Cobrar
     * seria arriscar pagar de novo — a cobrança sai inteira.
     */
    if (anonimos.some(a => !a.usado)) return [];
    for (const g of grupos.values()) {
      // o rótulo mostra a CONTA — % aplicado, valor do material e de onde o
      // percentual veio; é o que permite conferir a linha sem abrir o módulo
      g.papeis = [{ papel: `OPME ${fmtN(g.pct)}% de R$ ${fmtN(g.material)} · regra ${g.origemPct}`,
        valor: g.valor }];
    }
    return [...grupos.values()];
  }

  /** os dois nomes são o MESMO médico? (de-para do cadastro) */
  function _mesmoMedico(a, b) {
    const x = normNome(nomeOficialMedico(a)), y = normNome(nomeOficialMedico(b));
    return !!x && x === y;
  }
  /**
   * ══ V877: A QUEM ESTE PAPEL DEVERIA SER PAGO ═════════════════════════════
   *
   * Cascata definida pelo usuário, nesta ordem:
   *   1. o profissional LANÇADO naquele papel no box 1;
   *   2. AUXILIAR não tem dono próprio — ele é pago ao EXECUTANTE do
   *      procedimento (regra da casa, a mesma da Auditoria);
   *   3. a PRODUÇÃO (box 3), que traz executante, indicante e auxiliares;
   *   4. não achou em lugar nenhum → "Médico não informado".
   *
   * O nome importa por dois motivos: é ele que o relatório mostra ao lado do
   * papel faltante, e é contra ele que se pergunta "foi pago a QUEM DEVIA?".
   */
  const SEM_MEDICO = 'Médico não informado';
  // V882: o termo, com as palavras do usuário · V883: redação escolhida por ele
  const NOTA_INDICANTE = 'Indicante tem outro médico no sistema';
  // V884: a marca de conferência — PRODUÇÃO × QVIS não dizem o mesmo
  const VERIFICAR_IND = 'verificar indicante';
  function _destinatarioDoPapel(papel, grafias, qvis, prod) {
    const casa = (nome) => grafias.some(gr => mesmoExame(String(nome || ''), gr));
    const doQvis = (p) => {
      const l = (qvis || []).find(q => casa(q.procedimento)
        && papelCanonico(q.papel) === p && String(q.nome_profissional || '').trim());
      return l ? String(l.nome_profissional).trim() : '';
    };
    const daProd = (p) => {
      for (const l of (prod || [])) {
        if (!casa(l.produto) && !casa(l.procedimento_principal)) continue;
        for (const [rot, nome] of papeisDaLinhaProd(l)) {
          if (papelCanonico(rot) === p && nome) return nome;
        }
      }
      return '';
    };
    // 2) o auxiliar acompanha o executante — procura o executante, não ele
    const alvo = papel === 'AUXILIAR' ? 'EXECUTANTE' : papel;
    const achado = doQvis(alvo) || daProd(alvo);
    // V882: quem quer que seja, sai pelo nome OFICIAL (de-para do cadastro)
    return achado ? nomeOficialMedico(achado) : SEM_MEDICO;
  }

  /**
   * ══ V877: REPASSE FALTANTE — A ADMISSÃO INTEIRA, NO RECORTE ATIVO ════════
   *
   * A V846 nasceu olhando só o procedimento VIGIADO. Era o descompasso da
   * ferramenta: o resto do relatório audita a admissão toda e a coluna do
   * dinheiro olhava um recorte — procedimento fora da lista de vigias nem
   * chegava a ser conferido, e por isso a coluna vinha vazia.
   *
   * A regra agora é a do usuário, e vale para todo procedimento:
   *
   *   todo procedimento tem um TOTAL A PAGAR — a soma dos papéis que a Base
   *   Tabela remunera, na VERSÃO vigente na data da admissão. Falta o que não
   *   foi pago A QUEM DEVIA.
   *
   *   · faltou um papel  → só ele, identificado, com o seu valor;
   *   · nada pago no box 2 → o total integral (faltam todos);
   *   · aguardando convênio/conciliação → idem, por definição.
   *
   * "Pago a quem devia" é a pergunta certa, não "pago?": o auxiliar pago a
   * outro médico que não o executante continua devendo ao executante — o
   * dinheiro saiu, mas para a pessoa errada, e quem tinha direito segue sem
   * receber. O relatório distingue as duas causas.
   *
   * E o ESCOPO segue o recorte ativo, como o resto do relatório:
   *   · sem filtro       → a admissão inteira;
   *   · vigia marcada    → aquele procedimento (e o papel dela, se específico);
   *   · médico filtrado  → só os papéis que seriam DELE;
   *   · papel filtrado   → só aquele papel, e só nos procedimentos que a
   *     tabela remunera nele (facectomia não paga laudo — não é omissão, é o
   *     desenho da tabela).
   */
  function repasseFaltanteDe(adm, vigias, ctx) {
    const escopo = ctx || {};
    const grupos = vigias || vigiasAgrupadas();
    // V873: o OPME é uma segunda fonte do mesmo total e NÃO depende de vigia —
    // material implantado não é procedimento vigiado.
    let qvis = buscarQvis(adm);
    let prod = buscarProducao(adm);
    /**
     * V871: a regra é a da ÉPOCA da admissão. A data sai do QVIS e, na falta
     * dele, da produção analítica — a mesma que o motor do Calcular usa para
     * resolver a versão da tabela.
     */
    const dataAdm = normData(
      (qvis.find(q => q.data_admissao) || {}).data_admissao
      || (prod.find(l => l.data_admissao) || {}).data_admissao || '');
    const versao = versaoDaAdmissao(dataAdm);
    const { procs, porProcValores } = _regrasNaData(dataAdm);
    const mesesQvis = [...new Set(qvis.map(q => q.mes_pagamento || q.competencia).filter(Boolean))];
    let pagosLinhas = buscarConsolidado(adm, mesesQvis);
    // V877: recorte por FONTE PAGADORA — a admissão com particular e convênio
    // sai em duas linhas, e cada uma analisa só os procedimentos da sua fonte
    if (escopo.fonte) {
      const daFonte = (t) => _mesmaFonte(t, escopo.fonte);
      qvis = qvis.filter(q => daFonte(q.origem || q.tipo_recebimento));
      prod = prod.filter(l => daFonte(l.tipo_recebimento));
      pagosLinhas = pagosLinhas.filter(r => daFonte(r.linha.origem));
    }
    const selMed = escopo.selMed, selPapel = escopo.selPapel, selSit = escopo.selSit;
    const noEscopoProc = (nomes) => {
      if (selSit && selSit.size
          && ![...selSit].some(p => nomes.some(n => mesmoExame(n, p)))) return false;
      if (grupos.length
          && !grupos.some(g => g.grafias.concat(g.nome).some(
            gr => nomes.some(n => mesmoExame(gr, n))))) return false;
      return true;
    };
    const itens = [];
    let total = 0;
    // V873: OPME do box 3 sem pagamento, pela regra do módulo de OPME
    for (const o of opmeFaltanteDe(adm, prod, pagosLinhas)) {
      if (!noEscopoProc([o.proc])) continue;
      if (selMed && selMed.size && !medicoEscolhido(selMed, o.medico)) continue;
      itens.push(o);
      total += o.valor;
    }
    if (!porProcValores.size) {
      return itens.length ? { total, itens, versao, dataAdm } : null;
    }
    /**
     * V877: os procedimentos vêm do BOX 1 e, quando ele é mudo, da PRODUÇÃO —
     * a cascata que o usuário pediu. Sem box 1 nem box 2, é na produção que se
     * lê o que aconteceu na admissão.
     */
    const vistos = [];
    const juntarProc = (nome, classe, categoria) => {
      if (!String(nome || '').trim()) return;
      /**
       * V878: "trazer tudo" é CONSULTA, EXAME e PROCEDIMENTO — o que o motor de
       * repasse cobre. Material, medicamento, taxa, diária, gás e OPME ficam
       * fora: não passam pela Base Tabela e cobrar papel deles seria inventar
       * dívida. (O OPME tem o caminho próprio dele, pela regra do módulo.)
       * A régua é a mesma da lista de vigias — produto sem classificação
       * continua entrando, que é a decisão da V856: não se esconde o que não
       * se sabe classificar.
       */
      if (!produtoRepassavel(classe, categoria)) return;
      const g = vistos.find(x => x.grafias.some(gr => mesmoExame(gr, nome)));
      if (g) { if (!g.grafias.includes(nome)) g.grafias.push(nome); return; }
      vistos.push({ grafias: [nome] });
    };
    for (const q of qvis) juntarProc(q.procedimento, q.classificacao_produto, q.categoria);
    if (!qvis.length) for (const l of prod) {
      juntarProc(l.produto || l.procedimento_principal, l.classificacao_produto, l.categoria);
    }

    for (const g of vistos) {
      const grafias = g.grafias;
      if (!noEscopoProc(grafias)) continue;
      const casa = (nome) => grafias.some(gr => mesmoExame(String(nome || ''), gr));
      const noQvis = qvis.filter(q => casa(q.procedimento));
      const naProd = prod.filter(l => casa(l.produto) || casa(l.procedimento_principal));
      const mapa = _procIdMapa();
      let pid = null;
      for (const q of noQvis) { const p2 = mapa.get(normNome(q.procedimento)); if (p2 != null) { pid = p2; break; } }
      if (pid == null) for (const gr of grafias) { const p2 = mapa.get(normNome(gr)); if (p2 != null) { pid = p2; break; } }
      if (pid == null) for (const l of naProd) {
        const p2 = mapa.get(normNome(l.produto)) ?? mapa.get(normNome(l.procedimento_principal));
        if (p2 != null) { pid = p2; break; }
      }
      const valores = pid != null ? porProcValores.get(pid) : null;
      if (!valores || !valores.size) continue;   // sem regra que remunere → nada a verificar
      /**
       * O recorte de PAPEL: o filtro do usuário e, quando há vigia casando
       * este procedimento com papel específico, o papel dela. "Todos" (ou
       * nenhum) = todos os papéis que a tabela remunera aqui — e só eles:
       * facectomia não paga laudo, então não há laudo a cobrar.
       */
      const vigDeste = grupos.filter(v =>
        v.grafias.concat(v.nome).some(gr => grafias.some(n => mesmoExame(gr, n))));
      const papeisDaVigia = new Set(vigDeste
        .filter(v => normNome(v.papel) !== 'TODOS').map(v => v.papelCanon));
      const exigidos = [...valores.keys()].filter(p => {
        if (selPapel && selPapel.size && !papelEscolhido(selPapel, p)) return false;
        if (vigDeste.length && papeisDaVigia.size && !papeisDaVigia.has(p)) return false;
        return true;
      });
      if (!exigidos.length) continue;
      // V813: executante institucional isenta o auxiliar junto
      const execInst = execInstitucionalDoExame(qvis, grafias);
      // o que o BOX 2 pagou deste exame, com o papel e a QUEM
      const pagosDoExame = [];
      /**
       * ══ V881: GLOSA — A CONTA DO QUE FALTA É ZERO ═════════════════════════
       *
       * Até aqui a glosa era só "não é pagamento": a linha era pulada e o
       * papel caía na cobrança como se ninguém tivesse pago. Isso inverte o
       * fato. Glosado é o procedimento que o convênio recusou — o hospital não
       * recebeu, e o médico não vai receber papel nenhum por ele. Não há o que
       * repassar, e portanto não há o que faltar.
       *
       * E a glosa é do PROCEDIMENTO, não da linha: se um papel dele foi
       * glosado, os papéis que não aparecem em lugar nenhum herdam a glosa em
       * vez de virarem dívida. Foi o que o usuário pediu — "se no caso ele não
       * encontrar algum papel, esse papel não encontrado também tem que ser
       * glosado".
       *
       * Eles continuam VISÍVEIS, com o nome de quem os receberia e R$ 0,00,
       * marcados como glosa: o relatório mostra o que aconteceu sem somar um
       * centavo à cobrança.
       */
      let temGlosa = false;
      const papeisGlosados = new Set();
      for (const r of pagosLinhas) {
        const l = r.linha;
        if (!casa(l.descricao)) continue;
        if (/glosa/i.test(String(l.status || ''))) {
          temGlosa = true;
          if (l.papel) papeisGlosados.add(papelCanonico(l.papel));
          continue;
        }
        if (!l.papel) continue;
        pagosDoExame.push({ papel: papelCanonico(l.papel),
          medico: String(l.profissional || '').trim() });
      }
      // base para regra percentual: produzido do QVIS; sem QVIS, valor da produção
      const base = noQvis.length
        ? Math.max(0, ...noQvis.map(q => Number(q.produzido) || 0))
        : Math.max(0, ...naProd.map(l => Number(l.valor) || 0), 0);
      const nome = nomeCanonico(grafias.slice()
        .sort((a, b) => normNome(a).length - normNome(b).length)[0]);
      /**
       * V884: as DUAS BASES dizem o mesmo sobre quem indicou? O QVIS (box 1) e
       * a produção analítica (box 3) têm cada um o seu indicante; quando eles
       * divergem, quem paga não tem como saber qual está certo — e é isso que
       * a marca amarela manda conferir. Nome ausente de um lado só também é
       * divergência: uma base afirma, a outra cala.
       */
      const divergeIndicante = () => {
        const doBox1 = (qvis || []).filter(q => casa(q.procedimento)
          && papelCanonico(q.papel) === 'INDICANTE'
          && String(q.nome_profissional || '').trim())
          .map(q => normNome(nomeOficialMedico(q.nome_profissional)));
        const doBox3 = naProd
          .map(l => String(l.indicante || l.solicitante || '').trim()).filter(Boolean)
          .map(n => normNome(nomeOficialMedico(n)));
        const a = new Set(doBox1), b = new Set(doBox3);
        if (!a.size && !b.size) return false;          // ninguém informou: outro caso
        if (a.size !== b.size) return true;
        for (const x of a) if (!b.has(x)) return true;
        return false;
      };
      const faltas = [];
      let valor = 0;
      for (const p of exigidos) {
        if (p === 'AUXILIAR' && execInst) continue;
        const quem = _destinatarioDoPapel(p, grafias, qvis, prod);
        // V801: profissional institucional nunca tem repasse
        if (quem !== SEM_MEDICO && ehMedicoInstitucional(quem)) continue;
        const doPapel = pagosDoExame.filter(x => x.papel === p);
        // "foi pago a QUEM DEVIA?" — pago a outro não quita a dívida
        if (doPapel.some(x => _mesmoMedico(x.medico, quem))) continue;
        /**
         * ══ V884: O PAPEL QUE NÃO TEM DONO EM LUGAR NENHUM ══════════════════
         *
         * Admissão antiga sem indicante lançado — nem no box 1, nem na
         * produção. Com um médico filtrado, esse papel sumia da conta: o
         * recorte por médico não reconhece "Médico não informado" como o
         * filtrado e descartava a linha antes de precificá-la. O papel deixava
         * de ser pago e ninguém via.
         *
         * Regra do usuário: quem manda é a Base Tabela. Se a versão vigente na
         * data remunera aquele papel e ele não aparece em lugar nenhum, o
         * valor ENTRA no "falta repasse" — a ausência de nome não apaga a
         * dívida, só não diz de quem ela é. A linha continua saindo como
         * "Médico não informado", nunca no nome do filtrado.
         *
         * Duas guardas, para não cobrar o que já foi pago:
         *   · alguém JÁ RECEBEU aquele papel no box 2 → não cobra (sem nome de
         *     destinatário não dá para afirmar que foi para a pessoa errada);
         *   · e aí, no indicante, vale a conferência que o usuário pediu:
         *     PRODUÇÃO × QVIS. Se as duas bases não dizem o mesmo, a linha sai
         *     com "verificar indicante", em amarelo.
         */
        const exec = _destinatarioDoPapel('EXECUTANTE', grafias, qvis, prod);
        /**
         * A linha interessa ao recorte? Sem filtro, sempre. Com filtro, quando
         * o papel é do médico escolhido — ou quando ELE é o executante deste
         * procedimento, caso em que o indicante alheio ainda lhe diz respeito
         * (é o que explica a conta dele não ter os três papéis).
         */
        const noRecorte = !selMed || !selMed.size || medicoEscolhido(selMed, quem)
          || (p === 'INDICANTE' && exec !== SEM_MEDICO && medicoEscolhido(selMed, exec));
        /**
         * V884: o indicante já foi pago a alguém e as bases não sustentam a
         * cobrança — ou porque discordam entre si, ou porque nenhuma delas tem
         * indicante. Não é dívida: é conferir. Vem antes do recorte por médico
         * porque "confira este cadastro" pesa mais do que "este papel não é
         * seu" — e as duas linhas valem zero do mesmo jeito.
         */
        if (p === 'INDICANTE' && doPapel.length
            && (quem === SEM_MEDICO || divergeIndicante())) {
          if (noRecorte) {
            faltas.push({ papel: p, valor: 0, medico: quem, verificar: true,
              motivo: 'verificar_indicante', glosa: temGlosa, pagoA: '' });
          }
          continue;
        }
        // papel sem dono que já foi pago a alguém: não se cobra de novo — sem
        // nome de destinatário não dá para dizer que foi para a pessoa errada
        if (quem === SEM_MEDICO && doPapel.length) continue;
        // recorte por MÉDICO: só os papéis que seriam DELE — o papel SEM DONO
        // não é de ninguém e por isso não pode ser descartado por esse recorte
        if (selMed && selMed.size && quem !== SEM_MEDICO && !medicoEscolhido(selMed, quem)) {
          /**
           * ══ V882: O INDICANTE QUE NÃO É O EXECUTANTE ═════════════════════
           *
           * Filtrando UM médico, a admissão passa a ser lida pelo que é DELE —
           * e aí ele deixa de receber os três papéis do procedimento. Quando o
           * indicante informado é OUTRA pessoa, o papel dele sumia da tela sem
           * dizer por quê, e a conta parecia incompleta.
           *
           * Ele volta, valendo ZERO (não é dívida com o médico filtrado) e com
           * a marca que explica a diferença.
           */
          if (p === 'INDICANTE' && quem !== SEM_MEDICO) {
            if (exec !== SEM_MEDICO && !_mesmoMedico(exec, quem)
                && medicoEscolhido(selMed, exec)) {
              faltas.push({ papel: p, valor: 0, medico: quem, nota: NOTA_INDICANTE,
                motivo: 'indicante_outro', glosa: temGlosa, pagoA: '' });
            }
          }
          continue;
        }
        // V881: procedimento glosado — o papel aparece, mas valendo zero
        if (temGlosa) {
          faltas.push({ papel: p, valor: 0, medico: quem, glosa: true,
            motivo: papeisGlosados.has(p) ? 'glosa' : 'glosa_do_procedimento', pagoA: '' });
          continue;
        }
        const v = valores.get(p);
        const quanto = (Number(v.valor) || 0) > 0 ? Number(v.valor)
          : (Number(v.percentual) || 0) * base;
        if (quanto <= 0) continue;
        faltas.push({ papel: p, valor: quanto, medico: quem,
          motivo: doPapel.length ? 'pago_a_outro' : (quem === SEM_MEDICO ? 'sem_medico' : 'nao_pago'),
          // V882: quem recebeu no lugar também sai pelo nome oficial
          pagoA: doPapel.length
            ? [...new Set(doPapel.map(x => x.medico).filter(Boolean)
              .map(nomeOficialMedico))].join(', ') : '' });
        valor += quanto;
      }
      if (!faltas.length) continue;
      // V884: a marca de conferência sobe junto — é ela que pinta a célula
      itens.push({ proc: nome, papeis: faltas, valor,
        verificar: faltas.some(f => f.verificar) });
      total += valor;
    }
    // V871: a versão aplicada viaja junto — é o que permite conferir, olhando
    // a planilha, que a admissão foi precificada pela tabela da época dela.
    // Nada faltando devolve null — quem chama distingue "nada a cobrar" de
    // "não calculado" (a coluna mostra R$ 0,00 nos dois casos, V875).
    return itens.length
      ? { total, itens, versao, dataAdm, verificar: itens.some(i => i.verificar) }
      : null;
  }
  /**
   * V877: o faltante é pedido DUAS vezes por linha do relatório (a coluna e a
   * seção "Não pago"). O memo evita refazer a conta — chave por admissão,
   * fonte pagadora, filtros e versão do banco.
   */
  let _faltMemo = { versao: null, mapa: null };
  function _faltanteMemo(adm, fontePag, ctx) {
    const v = Banco._versao || 0;
    if (_faltMemo.versao !== v || !_faltMemo.mapa) _faltMemo = { versao: v, mapa: new Map() };
    const k = [normAdm(adm), _catFonte(fontePag),
      [...(ctx.selSit || [])].sort().join('~'),
      [...(ctx.selMed || [])].sort().join('~'),
      [...(ctx.selPapel || [])].sort().join('~')].join('|');
    if (_faltMemo.mapa.has(k)) return _faltMemo.mapa.get(k);
    let r = null;
    try {
      r = repasseFaltanteDe(adm, vigiasAgrupadas(),
        Object.assign({ fonte: fontePag }, ctx));
    } catch (e) { r = null; }
    _faltMemo.mapa.set(k, r);
    return r;
  }
  /** categoria da fonte pagadora de um texto qualquer */
  function _catFonte(x) {
    const v = normNome(x);
    if (!v) return '';
    return /PART/.test(v) ? 'PARTICULAR' : (/SUS/.test(v) ? 'SUS' : 'CONVENIO');
  }
  /** particular × convênio × SUS — a fonte pagadora de uma linha bate com a pedida? */
  function _mesmaFonte(valor, fonte) {
    const f = _catFonte(fonte);
    if (!f) return true;
    return _catFonte(valor) === f;
  }

  function temRegraDeRepasse(q) {
    const { chaves, procs } = _carregarRegras();
    if (!chaves.size) return true;                 // base sem tabela: não filtra
    const nome = normNome(q.procedimento_normalizado || q.procedimento);
    const pid = procs.get(nome);
    if (pid == null) return true;                  // procedimento não cadastrado: mostra
    return chaves.has(pid + '|' + papelCanonico(q.papel));
  }

  /**
   * V757: o que a admissão tem na BASE PADRÃO (QVIS) e NÃO virou pagamento —
   * médico e papel, mesmo zerados. A chave de comparação aceita tanto o papel
   * bruto do QVIS ("CIRURGIAO", "MEDICO DE LAUDO") quanto o canônico da matriz
   * ("Executante", "Médico Laudo"), porque a linha paga carrega os dois.
   */
  function naoPagoDaAdmissao(qvis, achados) {
    const chave = (proc, med, papel) => normNome(proc) + '|' + normNome(med) + '|' + papelCanonico(papel);
    const pagos = new Set();
    // V799: além da chave exata, guarda o pagamento "aberto" para comparar o
    // EXAME (e não a grafia). O bloco 2 pode pagar o mesmo exame com outro
    // nome — é o que acontece com o que vem por desempenho (status
    // "Desempenho", como o módulo de laudos), cujo nome não é o do QVIS.
    // Sem isso, um laudo PAGO reaparecia na lista de "não pago".
    const abertos = [];
    for (const r of achados) {
      const l = r.linha;
      const med = l._medicoNome || l.nome_profissional || '';
      const papeis = [l.papel, l._papelNome].filter(Boolean);
      for (const p of papeis) pagos.add(chave(l.procedimento, med, p));
      abertos.push({ proc: l.procedimento, med, papeis });
    }
    const foiPago = (q) => abertos.some(p =>
      normNome(p.med) === normNome(q.nome_profissional)
      && p.papeis.some(x => papelCanonico(x) === papelCanonico(q.papel))
      && mesmoExame(p.proc, q.procedimento));
    // V841: padrão de exibição das grafias do bloco 1 (ver analiticoPago)
    const padraoNP = padraoDeExibicao((qvis || []).map(q =>
      String(q.procedimento || '').replace(/\s+/g, ' ').trim()));
    const grupos = new Map();
    for (const q of qvis) {
      if (pagos.has(chave(q.procedimento, q.nome_profissional, q.papel))) continue;
      if (foiPago(q)) continue;
      if (!temRegraDeRepasse(q)) continue;   // V760: sem regra não é divergência
      /**
       * V813: o AUXILIAR acompanha o EXECUTANTE (regra da Auditoria). Com o
       * executante institucional, quem "receberia" o auxiliar é a instituição —
       * que não tem repasse. A linha FICA, identificada com o nome de quem
       * receberia e zerada ("Auxiliar: Médico Instituição R$ 0,00"), em vez de
       * sair como divergência.
       */
      let nomeQuem = q.nome_profissional, valorQuem = null;
      if (papelCanonico(q.papel) === 'AUXILIAR' && !ehMedicoInstitucional(q.nome_profissional)) {
        const exec = qvis.find(x => mesmoExame(x.procedimento, q.procedimento)
          && papelCanonico(x.papel) === 'EXECUTANTE' && ehMedicoInstitucional(x.nome_profissional));
        if (exec) { nomeQuem = exec.nome_profissional; valorQuem = 0; }
      }
      // V801: profissional INSTITUCIONAL nunca tem repasse — ele aparece no
      // bloco 1 e na produção, jamais no bloco 2. Cobrá-lo aqui seria apontar
      // uma divergência que não existe. (O auxiliar herdado acima é a exceção
      // deliberada: ele fica, zerado, para mostrar quem receberia.)
      if (valorQuem === null && ehMedicoInstitucional(q.nome_profissional)) continue;
      // V841: o nome sai no PADRÃO unificado (grafias do mesmo procedimento
      // não se repetem na lista de não pagos)
      const bruto = (q.procedimento || '—').replace(/\s+/g, ' ').trim();
      const proc = bruto === '—' ? bruto : (padraoNP.get(normNome(bruto)) || bruto);
      const medico = nomeQuem ? exibirMedico(nomeQuem) : '—';   // V882: de-para
      const papel = String(q.papel || '—').toUpperCase();   // V765: caixa alta
      const k = proc + '|' + medico + '|' + papel;
      if (!grupos.has(k)) grupos.set(k, { proc, medico, papel, valor: 0, n: 0,
        medicoBruto: nomeQuem ? nomeOficialMedico(nomeQuem) : '' });
      const g = grupos.get(k);
      g.valor += valorQuem !== null ? valorQuem : (Number(q.repassado) || 0);
      g.n++;
    }
    return [...grupos.values()];
  }

  /** V756/V761: convênio e tipo de recebimento (fonte pagadora) da admissão. */
  function recebimentoResumo(adm) {
    const r = recebimentoDe([adm]).get(normAdm(adm)) || {};
    return { convenio: r.convenio || '', tipo: r.tipo || '' };
  }

  /**
   * V755: tipo de recebimento (Convênio/Particular/SUS) e nome do convênio de
   * cada admissão — uma consulta em lote na produção, com o QVIS de reserva
   * para o que não estiver lá.
   */
  function recebimentoDe(admissoes) {
    const mapa = new Map();
    const guardar = (adm, tipo, conv) => {
      const k = normAdm(adm);
      if (!k) return;
      const at = mapa.get(k) || { tipo: '', convenio: '', fontes: new Map() };
      if (!at.tipo && tipo) at.tipo = String(tipo).trim();
      if (!at.convenio && conv) at.convenio = String(conv).trim();
      /**
       * V877: a admissão pode ter DUAS fontes pagadoras (particular e
       * convênio). Antes só a primeira encontrada sobrevivia e a outra sumia
       * do relatório; agora guardamos todas, e a extração emite UMA LINHA POR
       * FONTE — cada uma analisando só os procedimentos dela.
       */
      const cat = tipo ? _catFonte(tipo) : '';
      if (cat && !at.fontes.has(cat)) {
        at.fontes.set(cat, { tipo: String(tipo).trim(), convenio: String(conv || '').trim() });
      } else if (cat && conv && !at.fontes.get(cat).convenio) {
        at.fontes.get(cat).convenio = String(conv).trim();
      }
      mapa.set(k, at);
    };
    for (let i = 0; i < admissoes.length; i += 120) {
      const vars = [...new Set(admissoes.slice(i, i + 120).flatMap(variantesAdm))];
      try {
        for (const l of Banco.query(
          `SELECT cod_admissao, tipo_recebimento, convenio FROM linhas_producao
            WHERE ${sqlIn('cod_admissao', vars)}`, vars) || []) {
          guardar(l.cod_admissao, l.tipo_recebimento, l.convenio);
        }
      } catch (e) {}
      try {
        for (const l of Banco.query(
          `SELECT admissao, tipo_recebimento, origem, convenio FROM linhas_qvis
            WHERE ${sqlIn('admissao', vars)}`, vars) || []) {
          guardar(l.admissao, l.tipo_recebimento || l.origem, l.convenio);
        }
      } catch (e) {}
    }
    return mapa;
  }

  /**
   * V754: SITUAÇÃO de uma admissão para a coluna do Excel — devolve o texto
   * puro e a versão em RICH TEXT (negrito na data do repasse, no valor total e
   * nos papéis; "glosa" em vermelho; pendente em #1d4470). O Consolidado
   * compartilha a reconstrução da matriz auditada entre admissões do mesmo mês.
   */


  /**
   * V769: profissional institucional do hospital no papel (ex.: "MEDICO CENTRO
   * DIAGNOSTICOS CBV"). Não é repasse de médico — no RELATÓRIO EXTRAÍDO o
   * valor sai zerado (na tela os valores continuam os reais). A palavra que
   * identifica a instituição é configurável (Administração → marca
   * institucional; padrão CBV) — ATLAS v1.0.
   */
  function ehMedicoInstitucional(nome) {
    return Utilidades.ehProfissionalInstitucional(nome);
  }

  /**
   * V788: ABA RESUMO da extração — o panorama da lista importada.
   *
   *  1) quantitativo: admissões informadas · pagas · R$ repassado · quantas
   *     estão aguardando o convênio/conciliação · quantas pararam numa etapa;
   *  2) qualitativo: as confirmações sobre PAPÉIS NÃO PAGOS, agregadas por
   *     procedimento × papel × diagnóstico, com as admissões de cada caso.
   */
  /**
   * V846: aba "VALOR A REPASSAR" — o detalhe do repasse faltante dos
   * procedimentos VIGIADOS, uma linha por (admissão × procedimento), com os
   * papéis que faltam, o valor de cada um e o TOTAL no fim. Só existe quando a
   * flag "Adicionar Repasse faltante" está ligada e há vigia ativa.
   */
  function montarAbaValorARepassar(wb, dados) {
    const ws = wb.addWorksheet('Valor a Repassar', {
      views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
    });
    ws.columns = [
      { header: 'ADMISSÃO', key: 'adm', width: 14 },
      { header: 'NOME DO PACIENTE', key: 'pac', width: 34 },
      { header: 'DATA', key: 'data', width: 12 },
      { header: 'PROCEDIMENTO VIGIADO', key: 'proc', width: 42 },
      { header: 'PAPÉIS FALTANTES', key: 'papeis', width: 44 },
      // V871: a versão da Base Tabela que precificou ESTA admissão (resolvida
      // pela data dela). Sem versão publicada a coluna sai como "tabela atual".
      { header: 'VERSÃO DA TABELA', key: 'ver', width: 18 },
      { header: 'VALOR A REPASSAR', key: 'val', width: 19 },
    ];
    const h = ws.getRow(1);
    h.height = 22;
    h.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF107DAC' } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    let total = 0, n = 0;
    for (const d of dados) {
      if (!d.falt || !(d.falt.total > 0)) continue;
      const ver = d.falt.versao;
      for (const item of d.falt.itens) {
        const row = ws.addRow({ adm: d.adm, pac: d.pac, data: d.data, proc: item.proc,
          // V877: o papel diz A QUEM ele caberia e POR QUE está faltando —
          // "não pago" é diferente de "pago ao médico errado"
          papeis: item.papeis.map(p => {
            const quem = p.medico ? ` · ${exibirMedico(p.medico)}` : '';
            const motivo = p.motivo === 'pago_a_outro'
              ? ' · pago a ' + String(p.pagoA || 'outro médico').split(', ')
                .map(exibirMedico).join(', ') : '';
            // V882/V883: indicante informado ≠ executante — a marca entra no
            // LUGAR do nome, do mesmo jeito que na Situação
            if (p.nota) return `${p.papel} R$ ${fmtN(p.valor)} · ${p.nota}`;
            // V884: conferir o indicante nas duas bases
            if (p.verificar) return `${p.papel} R$ ${fmtN(p.valor)} · ${VERIFICAR_IND}`;
            // V881: papel glosado entra pelo registro, valendo zero
            if (p.glosa) return `${p.papel} GLOSA (R$ 0,00)${quem}`;
            return `${p.papel} R$ ${fmtN(p.valor)}${quem}${motivo}`;
          }).join(' · '),
          // V873: OPME não é pago pela Base Tabela e o % do módulo não é
          // versionado — dizer "Versão N" nessa linha seria mentira
          ver: item.opme ? 'OPME (sem versão)' : (ver ? `Versão ${ver.numero}` : 'tabela atual'),
          val: item.valor });
        ['adm', 'data', 'ver'].forEach(k => { row.getCell(k).alignment = { horizontal: 'center', vertical: 'middle' }; });
        row.getCell('papeis').alignment = { wrapText: true, vertical: 'middle' };
        const cv = row.getCell('val');
        cv.numFmt = '"R$" #,##0.00';
        cv.font = { bold: true, color: { argb: 'FF9B3A3A' } };
        cv.alignment = { horizontal: 'center', vertical: 'middle' };
        const zebra = (ws.rowCount % 2 === 0) ? 'FFDDDDDD' : 'FFFFFFFF';
        for (let c = 1; c <= ws.columns.length; c++) {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
        }
        n++;
      }
      total += d.falt.total;
    }
    if (!n) {
      ws.addRow({ adm: 'Nenhum repasse faltante nos procedimentos vigiados desta lista.' });
      return;
    }
    const rt = ws.addRow({ papeis: 'TOTAL A REPASSAR', val: total });
    rt.font = { bold: true };
    rt.getCell('papeis').alignment = { horizontal: 'right', vertical: 'middle' };
    const ct = rt.getCell('val');
    ct.numFmt = '"R$" #,##0.00';
    ct.font = { bold: true, color: { argb: 'FF9B3A3A' } };
    ct.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  function montarAbaResumo(wb, dados) {
    const ws = wb.addWorksheet('Resumo', { views: [{ showGridLines: false }] });
    const AZUL = 'FF107DAC', ESCURO = 'FF06283A', VERMELHO = 'FF9B3A3A';
    const meta = (d) => d.sit.meta || { estado: 'aguardando', total: 0, alertas: [] };
    const porEstado = (e) => dados.filter(d => meta(d).estado === e);
    const pagas = porEstado('paga');
    const comAlerta = dados.filter(d => (meta(d).alertas || []).length);

    ws.columns = [
      { width: 16 }, { width: 32 }, { width: 12 }, { width: 46 }, { width: 20 }, { width: 46 },
    ];
    const faixa = (titulo, ate) => {
      const r = ws.addRow([titulo]);
      ws.mergeCells(r.number, 1, r.number, ate);
      r.height = 20;
      const c = r.getCell(1);
      c.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
      c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      return r;
    };
    const linhaKV = (rotulo, valor, moeda) => {
      const r = ws.addRow([rotulo, valor]);
      r.getCell(1).font = { color: { argb: ESCURO } };
      r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
      const c = r.getCell(2);
      c.font = { bold: true, color: { argb: AZUL } };
      c.alignment = { horizontal: 'right', vertical: 'middle' };
      if (moeda) c.numFmt = Utilidades.FMT_EXPORT_MOEDA;
      return r;
    };

    // uma entrada por ADMISSÃO × alerta (a tabela de baixo é linha a linha)
    const ocorrencias = [];
    for (const d of dados) {
      for (const a of meta(d).alertas || []) ocorrencias.push({ d, a });
    }

    // V790: panorama enxuto — só os cinco números pedidos
    // V822: com VIGIA ativa, o panorama fala dela — a linha das repassadas diz
    // quantas têm o procedimento vigiado pago, e a linha de papéis não pagos é
    // nomeada pelo(s) procedimento(s) vigiado(s) em vez do rótulo genérico.
    const vigiasResumo = vigiasAgrupadas();
    const casaVigia = (proc) => vigiasResumo.some(v =>
      v.grafias.concat(v.nome).some(g => mesmoExame(proc, g)));
    const pagasComVigiado = vigiasResumo.length
      ? pagas.filter(d => (meta(d).procsPagos || []).some(casaVigia)).length : 0;
    faixa('PANORAMA DA LISTA', 6);
    linhaKV('Total de admissões analisadas', dados.length);
    linhaKV('Total de admissões repassadas', vigiasResumo.length
      ? `${pagas.length} (${pagasComVigiado} com o procedimento vigiado pago)`
      : pagas.length);
    // V825: a linha "Total de repasse já realizado" saiu do panorama
    linhaKV('Aguardando pagamento do convênio ou conciliação', porEstado('aguardando').length);
    linhaKV(vigiasResumo.length
      ? `Admissões com ${vigiasResumo.map(v => v.nome).join(', ')} não pago${vigiasResumo.length > 1 ? 's' : ''}`
      : 'Admissões com algum papel não pago', comAlerta.length);

    // V826: breve leitura dos números — os pontos que geram dúvida na conta
    // (as linhas medem conjuntos diferentes e não se somam para o total)
    ws.addRow([]);
    faixa('COMO LER O PANORAMA', 6);
    const nota = (txt) => {
      const r = ws.addRow([txt]);
      ws.mergeCells(r.number, 1, r.number, 6);
      const c = r.getCell(1);
      c.font = { size: 10, color: { argb: 'FF56645E' } };
      c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'left', indent: 1 };
      r.height = Math.max(14, Math.ceil(txt.length / 160) * 13 + 3);
      return r;
    };
    nota('• Total analisadas = repassadas + aguardando convênio/conciliação (e eventuais etapas ainda sem cálculo). As linhas medem conjuntos diferentes — elas não se somam para fechar o total.');
    if (vigiasResumo.length) {
      nota('• Nas repassadas, o número entre parênteses conta quantas têm o procedimento VIGIADO pago no Consolidado.');
      nota('• A última linha conta só as admissões com problema real de papel do vigiado: o procedimento entrou na Base padrão (box 1) e ficou papel sem pagamento segundo a Base Tabela.');
      nota('• Admissão repassada em que o vigiado não existe (não veio do convênio) não entra em nenhuma das duas contas — não há o que cobrar. Executante institucional e procedimento sem regra de repasse também ficam de fora.');
    } else {
      nota('• A última linha conta as admissões com problema real de papel: procedimento na Base padrão (box 1) com papel sem pagamento segundo a Base Tabela.');
    }
    ws.addRow([]);

    // ── qualitativo: UMA LINHA POR ADMISSÃO (pedido do usuário) ──
    faixa('CONFIRMAÇÕES SOBRE PAPÉIS NÃO PAGOS', 6);
    const cab = ws.addRow(['ADMISSÃO', 'NOME DO PACIENTE', 'DATA',
                           'PROCEDIMENTO', 'PAPEL EXIGIDO', 'DIAGNÓSTICO']);
    cab.height = 18;
    cab.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ESCURO } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    if (!ocorrencias.length) {
      const r = ws.addRow(['Nenhum alerta de papel nesta lista.']);
      ws.mergeCells(r.number, 1, r.number, 6);
      r.getCell(1).font = { italic: true, color: { argb: ESCURO } };
      // V791: TODA célula da extração fica alinhada ao meio — inclusive esta,
      // que só aparece quando a lista não tem alerta nenhum.
      for (let c = 1; c <= 6; c++) {
        r.getCell(c).alignment = { vertical: 'middle', horizontal: 'left' };
      }
    }
    for (const { d, a } of ocorrencias) {
      // V790: o diagnóstico é a MESMA frase que sai no alerta da matriz
      const r = ws.addRow([d.adm, d.pac, d.data, a.produto,
                           String(a.papel).toUpperCase(), a.texto]);
      r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(5).font = { bold: true, color: { argb: VERMELHO } };
      r.getCell(6).font = { color: { argb: VERMELHO } };
      [2, 4, 6].forEach(i => { r.getCell(i).alignment = { wrapText: true, vertical: 'middle' }; });
      r.getCell(5).alignment = { vertical: 'middle', horizontal: 'center' };
      const zebra = (r.number % 2 === 0) ? 'FFDDDDDD' : 'FFFFFFFF';
      for (let c = 1; c <= 6; c++) {
        r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
      }
    }
    return ws;
  }

  function situacaoDe(adm, fontePag) {   // V795: fonte = Relatórios › Consolidado
    // V762: o relatório extraído não leva vermelho. O azul #1d4470 marca a
    // frase-título e os VALORES repassados; o resto fica neutro.
    const B = { bold: true };
    const AZUL = { color: { argb: 'FF107DAC' } };
    const AZUL_B = { bold: true, color: { argb: 'FF107DAC' } };
    const VERMELHO_B = { bold: true, color: { argb: 'FF9B3A3A' } };

    // V877: com duas fontes pagadoras a admissão sai em duas linhas, e cada
    // uma descreve SÓ os procedimentos da sua fonte
    const qvis = buscarQvis(adm)
      .filter(q => _mesmaFonte(q.origem || q.tipo_recebimento, fontePag));
    const mesesQvis = [...new Set(qvis.map(l => l.mes_pagamento).filter(Boolean))];
    const comSnap = new Set(competenciasComSnapshot());
    /**
     * V795: a coluna SITUAÇÃO passa a nascer da MESMA fonte do bloco 2 —
     * Relatórios › Consolidado.
     *
     * Caso relatado: uma admissão com OCT visível no bloco 2 saía no relatório
     * como "nenhum dos produtos escolhidos foi pago". A causa era a fonte
     * dupla: o bloco 2 lia o Consolidado (V791) e a Situação continuava
     * remontando a matriz auditada + complementos. Agora as duas leem o mesmo
     * lugar, e o que está na tela é o que sai no Excel.
     */
    const achados = buscarConsolidado(adm, mesesQvis)
      .filter(r => _mesmaFonte(r.linha.origem, fontePag)).map(r => ({
      competencia: r.competencia,
      // linha avulsa/complemento lançada no Consolidado conta como complemento
      _manual: /complement|avuls/i.test(String(r.linha.status || '')),
      linha: {
        admissao: r.linha.admissao, paciente: r.linha.paciente,
        data_admissao: r.linha.data, procedimento: r.linha.descricao,
        _status: /glosa/i.test(String(r.linha.status || '')) ? 'glosa' : 'casou',
        _repasse: Number(r.linha.valor) || 0,
        _medicoNome: r.linha.profissional, nome_profissional: r.linha.profissional,
        _papelNome: r.linha.papel, papel: r.linha.papel,
        modulo: r.linha.modulo, origem: r.linha.origem, convenio: r.linha.convenio,
        // V799: o Consolidado diz por qual CAMINHO o valor saiu. "Desempenho"
        // é pagamento direto de um módulo (o de laudos, por exemplo) — não veio
        // do relatório padrão, e por isso não tem linha no bloco 1.
        _statusCons: r.linha.status, _moduloCons: r.linha.modulo,
      },
    }));
    /**
     * ══ V880: LINHA PARTICULAR NÃO ESPERA CONVÊNIO ═══════════════════════
     *
     * Com a admissão dividida por fonte pagadora (V877), a linha PARTICULAR
     * herdava a frase de "aguardando pagamento do convênio ou conciliação".
     * Não faz sentido: particular não tem convênio para esperar — ele é
     * liquidado dentro da própria competência.
     *
     * No lugar da espera, a linha diz A QUE ela se refere: os procedimentos
     * particulares da admissão, procurados no BOX 1 para sair com o papel e o
     * profissional. O que só existe na produção sai marcado como tal.
     */
    const ehParticular = _catFonte(fontePag) === 'PARTICULAR';
    /**
     * ══ V885: A LINHA QUE ESPERA PASSA A DIZER PELO QUE ESPERA ═══════════
     *
     * A V880 fez isso para o PARTICULAR. Agora vale para qualquer fonte: a
     * admissão sem nada no box 1 e sem nada no box 2 era uma frase muda —
     * você sabia que ela estava esperando, mas não O QUÊ. Sendo a produção a
     * única base que responde nesse caso, é dela que sai a descrição.
     *
     * Entram CONSULTA, EXAME, PROCEDIMENTO e OPME — material, medicamento,
     * taxa e diária não descrevem o atendimento. O OPME sai só identificado,
     * sem valor nem percentual (decisão do usuário): aqui é texto, não conta.
     *
     * Com um MÉDICO filtrado, só os itens em que ele aparece em algum papel —
     * a linha é a leitura da admissão pela ótica dele.
     */
    const _ehOpme = (l) => /OPME/i.test(String(l.classificacao_produto || ''))
      || /OPME/i.test(String(l.categoria || ''));
    const descreverAdmissao = (titulo) => {
      const selMedD = lerSelMedicos();
      const daFonte = (buscarProducao(adm) || [])
        .filter(l => _mesmaFonte(l.tipo_recebimento, fontePag))
        .filter(l => produtoRepassavel(l.classificacao_produto, l.categoria) || _ehOpme(l));
      const nomes = [...new Set(daFonte
        .map(l => String(l.produto || l.procedimento_principal || '').trim())
        .filter(Boolean))];
      if (!nomes.length) return null;
      const box1 = buscarQvis(adm) || [];
      const itens = nomes.map((n) => {
        const l = daFonte.find(x => mesmoExame(x.produto || x.procedimento_principal, n));
        // o BOX 1 descreve melhor quando conhece o exame (nome e papel dele);
        // não conhecendo, a PRODUÇÃO responde, com os papéis da própria linha
        const q = box1.find(x => mesmoExame(x.procedimento, n));
        const papeis = q
          ? [[String(q.papel || '—').toUpperCase(), q.nome_profissional || SEM_MEDICO]]
          : (l ? papeisDaLinhaProd(l) : []);
        return { nome: q ? q.procedimento : n, papeis, opme: !!(l && _ehOpme(l)), daProd: !q };
      }).filter(it => !selMedD.size
        || it.papeis.some(([, quem]) => medicoEscolhido(selMedD, quem)));
      if (!itens.length) return null;
      const linhas = itens.map((it) => `${it.nome}${it.opme ? ' (OPME)' : ''} — `
        + (it.papeis.length
          ? it.papeis.map(([rot, quem]) => `${rot}: ${exibirMedico(quem)}`).join(' · ')
          : SEM_MEDICO)
        + (it.daProd ? ' (produção)' : ''));
      return {
        plain: [titulo].concat(linhas).join('\n'),
        rich: [{ text: titulo, font: B }].concat(linhas.map(t => ({ text: '\n' + t }))),
      };
    };
    if (!qvis.length && !achados.length) {
      const tit = ehParticular
        ? 'Particular — sem repasse lançado nesta competência:'
        : AGUARDANDO + ':';
      const p = descreverAdmissao(tit);
      if (p) {
        return { plain: p.plain, rich: p.rich,
          meta: { estado: 'aguardando', total: 0, competencias: [], alertas: [] } };
      }
      // nada descritível na produção: a frase sozinha, como sempre foi
      const t = ehParticular ? 'Particular — sem repasse lançado nesta competência' : AGUARDANDO;
      return { plain: t, rich: [{ text: t, font: B }],
        meta: { estado: 'aguardando', total: 0, competencias: [], alertas: [] } };
    }
    if (achados.length) {
      // V769: profissional institucional no papel entra ZERADO no relatório
      const valorRel = (l) => ehMedicoInstitucional(l._medicoNome || l.nome_profissional) ? 0 : (Number(l._repasse) || 0);
      // V822: o resumo pergunta "das pagas, quantas têm o VIGIADO pago?" — a
      // lista dos procedimentos pagos da admissão viaja no meta (sempre a
      // admissão inteira, antes de qualquer filtro)
      const procsPagos = [...new Set(achados.map(r => String(r.linha.procedimento || '')).filter(Boolean))];
      let tudo = achados;
      // V794: filtro de produtos da coluna Situação — mostra só o que você
      // escolheu ver. O total do título passa a ser o do que está descrito.
      const selSit = lerSelSituacao();
      const totalCheio = tudo.reduce((t, r) => t + valorRel(r.linha), 0);
      let filtrouAlgo = false;
      if (selSit.size) {
        const antes = tudo.length;
        tudo = tudo.filter(r => [...selSit].some(p => mesmoExame(r.linha.procedimento, p)));
        filtrouAlgo = tudo.length !== antes;
        if (!tudo.length) {
          // V796: produto escolhido SEM pagamento nesta admissão não sai mais
          // com uma frase genérica — sai com o MOTIVO de não ter sido pago,
          // lido na base padrão. Uma linha por produto escolhido.
          // V797: grafias do mesmo exame dão UMA linha (de-para de nomenclatura)
          const alertas = agruparProdutos([...selSit])
            .map(g => alertaSemPagamento(g.nome, adm, g.grafias, achados))
            .filter(Boolean);   // V886: produto que a admissão não tem sai calado
          return {
            plain: alertas.map(a => a.texto).join('\n'),
            rich: alertas.map((a, i) => ({
              text: (i ? '\n' : '') + a.texto,
              // "aguardando" não é falha de ninguém: fica neutro, como na tela
              font: a.tipo === 'aguardando' ? B : VERMELHO_B })),
            meta: {
              // V886: sem alerta nenhum, o estado é o da admissão — calar sobre
              // um procedimento que ela não tem não a torna "aguardando"
              estado: alertas.length
                ? (alertas.every(a => a.tipo === 'aguardando') ? 'aguardando' : 'paga')
                : (achados.length ? 'paga' : 'aguardando'),
              total: 0, competencias: [], procsPagos,
              // só diagnóstico de PAPEL alimenta a tabela do resumo
              alertas: alertas.filter(a => a.tipo === 'papel_ausente' || a.tipo === 'sem_repasse'),
            },
          };
        }
      }
      /**
       * V803: FILTRO DE MÉDICOS — mostra só o que os profissionais escolhidos
       * receberam nesta admissão. Os ALERTAS continuam sendo calculados sobre a
       * admissão INTEIRA (`tudoTodos`): um laudo que falta é problema da
       * admissão, não do médico que você está olhando — filtrar antes faria o
       * relatório acusar falta de papel só porque você escolheu outro médico.
       */
      const tudoTodos = tudo;
      const selMed = lerSelMedicos();
      const selPapel = lerSelPapeis();   // V807: participação específica
      let filtrouMedico = false, filtrouPapel = false;
      if (selMed.size || selPapel.size) {
        const antes = tudo.length;
        if (selMed.size) {
          tudo = tudo.filter(r => medicoEscolhido(selMed, r.linha._medicoNome || r.linha.nome_profissional));
          filtrouMedico = tudo.length !== antes;
        }
        if (selPapel.size) {
          const antesP = tudo.length;
          tudo = tudo.filter(r => papelEscolhido(selPapel, r.linha._papelNome || r.linha.papel));
          filtrouPapel = tudo.length !== antesP;
        }
        if (!tudo.length) {
          /**
           * V819: médico escolhido + bloco 1 VAZIO + bloco 2 pago a OUTRO
           * médico → a admissão ainda não foi paga pelo convênio; o que está
           * no bloco 2 é adiantamento de outro profissional (desempenho, por
           * exemplo). Para o médico selecionado a mensagem é a de AGUARDANDO,
           * sem citar o que o outro recebeu.
           */
          if (selMed.size && !qvis.length) {
            return { plain: AGUARDANDO, rich: [{ text: AGUARDANDO, font: B }],
              meta: { estado: 'aguardando', total: 0, competencias: [], alertas: [] } };
          }
          // V818: grafias do mesmo médico não se repetem na mensagem
          const medUnicos = [...new Set([...selMed].map(m => nomeOficialMedico(m)))];
          const quem = [
            selMed.size ? medUnicos.map(m => CodigoMedico.exibir(m)).join(', ') : '',
            selPapel.size ? `como ${[...selPapel].join(', ')}` : '',
          ].filter(Boolean).join(' ');
          // V821/V822: no relatório do médico filtrado, NADA dos outros sai —
          // nem valor, nem o fato. Quem diferencia é o box 1: vazio → a frase
          // de AGUARDANDO (tratada acima, V819); com linha (admissão recebida
          // e paga a outros) → a frase seca. Sem médico escolhido (só
          // participação), o total da admissão continua, como sempre.
          const t = selMed.size
            ? `Nenhum pagamento de ${quem} nesta admissão.`
            : `Nenhum pagamento ${quem} nesta admissão (a admissão teve R$ ${fmtN(totalCheio)} pagos).`;
          return { plain: t, rich: [{ text: t, font: B }],
            meta: { estado: 'paga', total: 0, competencias: [], procsPagos, alertas: [] } };
        }
      }
      const total = tudo.reduce((t, r) => t + valorRel(r.linha), 0);
      // V781: pago em mais de um período → o título abre o valor POR
      // competência (com a mesma regra do ATLAS — é o que saiu para o médico);
      // um período só mantém o formato de sempre.
      const compsArr = [...new Set(tudo.map(r => r.competencia))].sort();
      const comps = compsArr.length > 1
        ? compsArr.map(c => `${c} (R$ ${fmtN(
            tudo.filter(r => r.competencia === c).reduce((t, r) => t + valorRel(r.linha), 0))})`).join(', ')
        : compsArr.join(', ');
      /**
       * V802: ADIANTAMENTO — tem linha no bloco 2, mas o bloco 1 está zerado.
       *
       * Regra do usuário: sem NADA na base padrão, a admissão ainda não foi
       * recebida (ou a conciliação não terminou) — o que está pago ali é um
       * valor adiantado a algum médico por outro motivo, tipicamente
       * desempenho. Chamar isso de "Paga no repasse" é errado: o convênio não
       * pagou a admissão. Então o título vira a classificação de aguardando e,
       * logo abaixo, o relatório informa o valor já adiantado.
       */
      const adiantado = !qvis.length;
      const viaDesemp = tudo.length && tudo.every(r =>
        /desempenh/i.test(String(r.linha._statusCons || '')));
      // V875: o título também nomeia a origem — os módulos que pagaram
      const modsDesemp = [...new Set(tudo
        .filter(r => /desempenh/i.test(String(r.linha._statusCons || '')))
        .map(r => String(r.linha._moduloCons || '').trim())
        .filter(Boolean))];
      const marcaVia = viaDesemp
        ? ` (via desempenho${modsDesemp.length ? ' · ' + modsDesemp.join(', ') : ''})` : '';
      // V804: a marca do caminho aparece UMA vez — se o título já a carrega,
      // as linhas de baixo saem limpas.
      const viaNoTitulo = !!(adiantado && viaDesemp);
      // V762/V764: a frase-título inteira em #1d4470 e TODA em negrito
      // V880: particular não espera convênio — a frase de espera vira a dele
      const ABERTURA = ehParticular
        ? 'Particular — sem repasse lançado nesta competência' : AGUARDANDO;
      const rich = adiantado
        ? [{ text: ABERTURA + '.', font: B },
           { text: '\nJá houve pagamento adiantado de ', font: AZUL_B },
           { text: 'R$ ' + fmtN(total), font: AZUL_B },
           { text: ` nesta admissão${marcaVia}.`, font: AZUL_B }]
        : [{ text: 'Paga no repasse de ', font: AZUL_B },
           { text: comps, font: AZUL_B },                   // data do pagamento
           { text: ' — ', font: AZUL_B },
           { text: 'R$ ' + fmtN(total), font: AZUL_B },     // total repassado
           { text: '.', font: AZUL_B }];
      const plain = adiantado
        ? [ABERTURA + '.', `Já houve pagamento adiantado de R$ ${fmtN(total)}`
            + ` nesta admissão${marcaVia}.`]
        : [`Paga no repasse de ${comps} — R$ ${fmtN(total)}.`];
      // V784: alertas das vigias (produto que exige papel pago) — logo abaixo
      // do título, em vermelho negrito, antes da lista de procedimentos.
      // V809: vigias + motor geral da Base Tabela, sem repetir o mesmo exame.
      // V818: com VIGIA marcada, o alerta fica INDIVIDUALIZADO nos procedimentos
      // vigiados — o motor geral só fala DELES (regra do usuário: vigiar um
      // procedimento suprime os alertas dos demais). Sem vigia nenhuma, o motor
      // geral cobre tudo o que a Base Tabela remunera.
      const alertas = alertasVigia(adm, tudoTodos, qvis);
      const soVigiado = filtroVigiados();
      for (const d of diagnosticoProcedimentos(adm, qvis, tudoTodos)) {
        if (alertas.some(a => mesmoExame(a.produto, d.produto))) continue;
        if (soVigiado && !soVigiado(d.produto)) continue;
        alertas.push(d);
      }
      for (const a of alertas) {
        // V805: quando o TÍTULO já é a classificação de aguardando, a vigia não
        // repete a mesma frase — vira eco.
        if (a.tipo === 'aguardando' && adiantado) continue;
        // V801: "aguardando" é presunção, não falha — sai neutro e sem o ⚠,
        // como na tela. O resto continua em vermelho negrito.
        const neutro = a.tipo === 'aguardando' || a.tipo === 'sem_regra';
        const marca = neutro ? '' : '⚠ ';
        rich.push({ text: '\n' + marca + a.texto, font: neutro ? B : VERMELHO_B });
        plain.push(marca + a.texto);
      }
      const achadosRel = tudo.map(r => ({
        ...r, linha: { ...r.linha, _repasse: valorRel(r.linha) },
      }));
      // descreve uma lista de procedimentos pagos (usada no bloco principal e,
      // depois, em cada bloco de pagamento complementar)
      const descrever = (grupos) => {
        for (const g of grupos) {
          rich.push({ text: '\n' + g.proc + ' — ' });
          const partes = [];
          g.medicos.forEach((m, iM) => {
            if (iM) rich.push({ text: ' ; ' });
            rich.push({ text: 'pago', font: AZUL });   // V766
            rich.push({ text: ' a ' + m.medico + ': ' });
            m.itens.forEach((i, iI) => {
              if (iI) rich.push({ text: ' · ' });
              rich.push({ text: i.papel, font: B });       // papel em negrito
              rich.push({ text: ' ' });
              // V779: "glosa" em VERMELHO (mesmo vermelho do título "Não pago")
              if (i.glosa) rich.push({ text: 'glosa', font: { bold: true, color: { argb: 'FF9B3A3A' } } });
              else rich.push({ text: 'R$ ' + fmtN(i.valor), font: AZUL });   // valor repassado
              // V799: pagamento que veio direto de um módulo de desempenho
              // (laudos, por exemplo) diz o caminho — sem isso o leitor procura
              // no bloco 1 uma linha que nunca existiu.
              // V804: quando o TÍTULO já diz "(via desempenho)", a linha não
              // repete — fica uma marca só, a azul do título.
              if (i.via && !viaNoTitulo) rich.push({ text: ` (via ${i.via})`, font: { italic: true } });
            });
            partes.push(`pago a ${m.medico}: `
              + m.itens.map(i => `${i.papel} ${i.glosa ? 'glosa' : 'R$ ' + fmtN(i.valor)}`
                + (i.via && !viaNoTitulo ? ` (via ${i.via})` : '')).join(' · '));
          });
          plain.push(g.proc + ' — ' + partes.join(' ; '));
        }
      };
      // V776: o que foi pago no mês principal e, abaixo, o que veio como
      // COMPLEMENTO em competência posterior — cada mês com o seu título.
      const { achadosPrincipal, complementos } = separarComplemento(achadosRel);
      descrever(analiticoPago(achadosPrincipal));
      for (const c of complementos) {
        const tit = `Contém pagamento complementar (${c.competencia}) — R$ ${fmtN(c.total)}:`;
        rich.push({ text: '\n' + tit, font: AZUL_B });
        plain.push(tit);
        descrever(analiticoPago(c.achados));
      }
      // V794: quando o filtro escondeu pagamentos, o total cheio da admissão
      // fica dito de forma explícita — o número do título é o do que se vê.
      // V821: com MÉDICO (ou participação) escolhido isso NÃO vale mais — o
      // relatório extraído é só do que foi pago PARA ELE, e o aviso vazava o
      // total dos outros médicos ("total pago na admissão: R$ ..."). O filtro
      // fica só como filtro. O aviso continua para o filtro de PRODUTOS, que é
      // recorte de conteúdo, não de pessoa.
      if (filtrouAlgo && !selMed.size && !selPapel.size) {
        const aviso = `Filtro de produtos ativo · total pago na admissão: R$ ${fmtN(totalCheio)}.`;
        rich.push({ text: '\n' + aviso, font: { italic: true } });
        plain.push(aviso);
      }
      // V757: o que está na Base padrão (QVIS) e NÃO foi pago — médico e
      // papéis, mesmo zerados. V777: o que foi pago via complemento manual
      // conta como pago (não é divergência).
      let naoPagos = naoPagoDaAdmissao(qvis, tudo);
      // V794: com filtro de produtos, a seção de divergências acompanha
      if (selSit.size) {
        naoPagos = naoPagos.filter(n => [...selSit].some(p => mesmoExame(n.proc, p)));
      }
      // V803: com médicos escolhidos, a seção mostra só as linhas deles
      if (selMed.size) naoPagos = naoPagos.filter(n => medicoEscolhido(selMed, n.medicoBruto || n.medico));
      if (selPapel.size) naoPagos = naoPagos.filter(n => papelEscolhido(selPapel, n.papel));
      /**
       * V877: a seção nascia SÓ do box 1 — logo, papel que a Base Tabela manda
       * pagar e que não tem lançamento nenhum no QVIS não aparecia em lugar
       * algum. É o caso das admissões antigas, sem o nome do profissional.
       *
       * Agora ele entra aqui também, ZERADO, com o nome resolvido pela cascata
       * (box 1 → executante, no caso do auxiliar → produção → "Médico não
       * informado"). A coluna do dinheiro é que carrega quanto falta; aqui o
       * valor é R$ 0,00 porque é isso que o médico recebeu.
       */
      try {
        const f = _faltanteMemo(adm, fontePag, { selSit, selMed, selPapel });
        /**
         * V879: OPME no box 1 vem SEMPRE zerado — quem o paga é o módulo, com
         * percentual sobre o material, e não a Base Tabela. Se o motor concluiu
         * que aquele material está quitado (pagamento no Consolidado, EV ou o
         * pagamento anônimo que bate no valor), a linha zerada aqui é ruído:
         * ela dizia "não pago" logo abaixo do texto que dizia "pago".
         */
        const opmesEmAberto = new Set(((f && f.itens) || [])
          .filter(i => i.opme).map(i => normNome(i.proc)));
        const ehOpme = (nome) => (buscarProducao(adm) || []).some(l =>
          /OPME/i.test(String(l.classificacao_produto || ''))
          && mesmoExame(l.produto, nome));
        naoPagos = naoPagos.filter(n => !(ehOpme(n.proc)
          && ![...opmesEmAberto].some(p => mesmoExame(p, n.proc))));
        for (const it of (f && f.itens) || []) {
          if (it.opme) continue;                      // OPME não é papel do box 1
          for (const pa of it.papeis || []) {
            const igual = naoPagos.filter(n => mesmoExame(n.proc, it.proc)
              && papelCanonico(n.papel) === pa.papel);
            // V881: o papel já listado pelo box 1 também recebe a marca da
            // glosa — senão a mesma seção diria "glosa" numa linha e ficaria
            // muda na outra, para o mesmo procedimento recusado
            if (igual.length) {
              if (pa.glosa) igual.forEach(n => { n.glosa = true; });
              // V883: a marca ocupa o LUGAR do nome (ver abaixo)
              if (pa.nota) igual.forEach(n => {
                n.nota = pa.nota; n.medico = pa.nota; n.medicoBruto = pa.nota;
              });
              if (pa.verificar) igual.forEach(n => { n.verificar = true; });   // V884
              continue;
            }
            /**
             * V883: com um médico filtrado, o papel de outro profissional não
             * sai no NOME dele — sai com a marca no lugar do nome. Quem está
             * lendo pediu a admissão pela ótica de um médico; o que interessa
             * ali é "este papel é de outro", não quem é o outro.
             */
            naoPagos.push({ proc: it.proc,
              medico: pa.nota || exibirMedico(pa.medico),
              medicoBruto: pa.nota
                || (pa.medico === SEM_MEDICO ? '' : nomeOficialMedico(pa.medico)),
              papel: String(pa.papel).toUpperCase(), valor: 0, n: 1, nota: pa.nota || '',
              verificar: !!pa.verificar,   // V884
              // V881: papel que herdou a glosa do procedimento — sai marcado,
              // para não ser lido como pagamento esquecido
              glosa: !!pa.glosa });
          }
        }
      } catch (e) { /* a seção não pode quebrar por causa do complemento */ }
      if (naoPagos.length) {
        // V765: título da seção em VERMELHO e negrito
        rich.push({ text: '\nNão pago nesta admissão (Base padrão):',
                    font: { bold: true, color: { argb: 'FF9B3A3A' } } });
        plain.push('Não pago nesta admissão (Base padrão):');
        for (const n of naoPagos) {
          // V808: extração com o nome real, mesmo com "ocultar nomes" ligado
          rich.push({ text: '\n' + n.proc + ' — ' });
          // V883: no lugar do nome, quando é papel de outro médico
          if (n.nota) rich.push({ text: n.nota, font: { italic: true, color: { argb: 'FF107DAC' } } });
          else rich.push({ text: n.medicoBruto || n.medico });
          rich.push({ text: ': ' });
          rich.push({ text: n.papel, font: B });
          rich.push({ text: ' R$ ' + fmtN(n.valor) });
          // V881: a glosa dita o valor — a marca ao lado diz POR QUE é zero
          if (n.glosa) rich.push({ text: ' glosa',
            font: { bold: true, color: { argb: 'FF9B3A3A' } } });
          /**
           * V884: as duas bases discordam sobre o indicante (ou pagaram uma
           * indicação que não está em base nenhuma). Não é dívida — é conferir.
           * O Excel não pinta pedaço de célula, então a frase sai destacada e
           * a CÉLULA inteira da situação recebe o fundo amarelo (lá embaixo).
           */
          if (n.verificar) rich.push({ text: '  ' + VERIFICAR_IND + '  ',
            font: { bold: true, color: { argb: 'FF7A5B00' } } });
          plain.push(`${n.proc} — ${n.medicoBruto || n.medico}: ${n.papel} R$ ${fmtN(n.valor)}`
            + (n.glosa ? ' glosa' : '') + (n.verificar ? '  ' + VERIFICAR_IND : ''));
        }
      }
      // V788: dados estruturados para a aba de RESUMO da extração
      return { plain: plain.join('\n'), rich, divergencias: naoPagos,
        // V802: adiantamento não é admissão paga — no panorama ela conta como
        // aguardando, e o valor adiantado fica fora do "repasse já realizado".
        meta: { estado: adiantado ? 'aguardando' : 'paga',
                total: adiantado ? 0 : total, adiantado: adiantado ? total : 0,
                competencias: compsArr, procsPagos,
                // V805: a tabela "CONFIRMAÇÕES SOBRE PAPÉIS NÃO PAGOS" e o
                // contador de admissões com papel pendente só olham FALHA DE
                // PAPEL. "Aguardando" é estado da admissão, não problema de
                // papel — contá-lo ali dizia que a admissão tinha um problema
                // que ela não tem.
                alertas: alertas.filter(a => a.tipo === 'papel_ausente' || a.tipo === 'sem_repasse') } };
    }
    const semCalc = mesesQvis.filter(m => !comSnap.has(m));
    const t = semCalc.length
      ? `Volte à etapa "Calcular Repasse" (${semCalc.join(', ')}) — chegou no QVIS, mas o mês ainda não tem cálculo salvo.`
      : `Volte à etapa "Auditoria" (${mesesQvis.join(', ')}) — chegou no QVIS, o mês foi calculado, mas ficou fora da matriz (glosa, sem regra ou papel não mapeado).`;
    return { plain: t, rich: [{ text: t }],
      meta: { estado: semCalc.length ? 'calcular' : 'auditoria', total: 0, competencias: [], alertas: [] } };
  }

  // ────────────────────────────────────────────────────────────────────────
  // DIAGNÓSTICO — a leitura entre os três painéis
  // ────────────────────────────────────────────────────────────────────────
  function diagnosticar(qvis, repasse, prod, adm) {
    // V777: pagamentos lançados no Consolidado (Linha avulsa / complementos)
    // também são pagamento — sem eles a admissão paga só por complemento
    // aparecia como "aguardando" e o card não mostrava NADA do complemento.
    const admRef = adm != null ? adm
      : (repasse[0]?.linha.admissao ?? qvis[0]?.admissao ?? prod[0]?.cod_admissao);
    // V810: os lançamentos manuais já vêm dentro do bloco 2 — buscá-los de novo
    // aqui contaria o mesmo complemento duas vezes.
    const manuais = [];
    if (repasse.length || manuais.length) {
      // V772: o totalizador NÃO soma o que sai zerado na descrição — linhas
      // com profissional institucional do ATLAS no papel valem 0 aqui também
      // (antes só o relatório descontava, e o card mostrava um total maior).
      const valorRel = (l) => ehMedicoInstitucional(l._medicoNome || l.nome_profissional) ? 0 : (Number(l._repasse) || 0);
      const tudo = [...repasse, ...manuais];
      const repasseRel = tudo.map(r => ({ ...r, linha: { ...r.linha, _repasse: valorRel(r.linha) } }));
      const total = repasseRel.reduce((s, r) => s + (Number(r.linha._repasse) || 0), 0);
      // V781: mesmo desdobramento por período do relatório extraído
      const compsArr = [...new Set(repasseRel.map(r => r.competencia))].sort();
      const comps = compsArr.length > 1
        ? compsArr.map(c => `${c} (R$ ${fmtN(
            repasseRel.filter(r => r.competencia === c).reduce((t, r) => t + (Number(r.linha._repasse) || 0), 0))})`).join(', ')
        : compsArr.join(', ');
      // V752: descrição ANALÍTICA — por procedimento e médico, com os papéis
      // e valores de cada um (o card e a exportação usam a mesma estrutura)
      // V776: o mês principal em cima; os complementos (competências
      // posteriores + lançamentos manuais) saem em blocos próprios.
      const { achadosPrincipal, complementos } = separarComplemento(repasseRel);
      const analitico = analiticoPago(achadosPrincipal, true);
      const complAnalit = complementos.map(c => ({
        competencia: c.competencia, total: c.total, analitico: analiticoPago(c.achados, true),
      }));
      const rec = recebimentoResumo(tudo[0].linha.admissao);   // V756/V761
      const naoPago = naoPagoDaAdmissao(qvis, tudo);      // V760: o foco
      // V784/V788: no card entra só o texto (o objeto estruturado é do resumo)
      const admDo = tudo[0].linha.admissao;
      const listaAlertas = alertasVigia(admDo, tudo, qvis);
      // V818: vigia marcada → alerta só dos vigiados (mesma regra da extração)
      const soVigiadoCard = filtroVigiados();
      for (const d of diagnosticoProcedimentos(admDo, qvis, tudo)) {
        if (listaAlertas.some(a => mesmoExame(a.produto, d.produto))) continue;
        if (soVigiadoCard && !soVigiadoCard(d.produto)) continue;
        listaAlertas.push(d);
      }
      const alertas = listaAlertas.map(a => a.texto);
      return { tom: 'ok', titulo: 'Admissão paga no repasse', complementos: complAnalit, alertas,
        texto: `Encontrada no <strong>Relatório Repasse</strong> de <strong>${esc(comps)}</strong>`
             + (rec.tipo ? ` · Recebimento: ${Utilidades.badgeFonte(rec.tipo)}` : '')
             + (rec.convenio ? ` · Convênio: <strong>${esc(rec.convenio)}</strong>` : '')
             + `, com <strong>R$ ${fmtN(total)}</strong> repassado.`,
        analitico, naoPago };
    }
    if (!qvis.length && prod.length) {
      // V754: sem texto longo — só o essencial
      return { tom: 'aviso', titulo: AGUARDANDO, texto: '' };
    }
    if (qvis.length) {
      const meses = [...new Set(qvis.map(l => l.mes_pagamento).filter(Boolean))];
      const comSnap = new Set(competenciasComSnapshot());
      const semCalculo = meses.filter(m => !comSnap.has(m));
      if (semCalculo.length) {
        return { tom: 'etapa', titulo: `Volte à etapa "Calcular Repasse" (${esc(semCalculo.join(', '))})`,
          texto: `A admissão <strong>chegou no QVIS</strong> (mês de pagamento <strong>${esc(semCalculo.join(', '))}</strong>), `
               + 'mas esse mês <strong>ainda não tem cálculo salvo</strong> — por isso não aparece no Relatório Repasse.' };
      }
      return { tom: 'etapa', titulo: `Volte à etapa "Auditoria" (${esc(meses.join(', ') || '—')})`,
        texto: 'A admissão <strong>chegou no QVIS</strong> e o mês <strong>já foi calculado</strong>, mas ela ficou de fora da matriz. '
             + 'Os motivos típicos são <strong>glosa</strong>, <strong>procedimento sem regra</strong> na Base Tabela ou <strong>papel não mapeado</strong> — '
             + 'confira as linhas do 1º painel na Auditoria desse mês.' };
    }
    return { tom: 'nada', titulo: 'Admissão não encontrada',
      texto: 'Nenhuma linha em QVIS, Relatórios ou Produção para esta admissão. Confirme o código ou importe a competência correspondente.' };
  }

  // ────────────────────────────────────────────────────────────────────────
  // LISTA DA DIREITA (match da planilha, só produção analítica)
  // ────────────────────────────────────────────────────────────────────────
  // V858: a lista importada é a própria pauta da inspeção — quem recebe o .db
  // precisa inspecionar as MESMAS admissões. Vai no banco, como cadastro.
  function lerLista() {
    try { return JSON.parse(cfgLer(LISTA_KEY) || '[]'); } catch (e) { return []; }
  }
  function salvarLista(l) {
    cfgGravar(LISTA_KEY, JSON.stringify(l), { cadastro: true });
  }

  /**
   * Casa nome + data APENAS na produção analítica → admissões encontradas.
   * V749: antes carregava a produção INTEIRA (1M linhas) na memória. Agora faz
   * UMA consulta filtrada pelas datas que existem na planilha — a varredura
   * fica no SQLite e volta só o que interessa.
   */
  function casarNaProducao(linhasPlanilha) {
    const datas = [...new Set(linhasPlanilha.map(i => normData(i.data)).filter(Boolean))];
    if (!datas.length) return [];
    let prod = [];
    try {
      prod = Banco.query(
        `SELECT cod_admissao, paciente, data_admissao FROM linhas_producao
          WHERE substr(data_admissao, 1, 10) IN (${datas.map(() => '?').join(',')})`, datas) || [];
    } catch (e) { return []; }
    const porChave = new Map();
    for (const p of prod) {
      const chave = normNome(p.paciente) + '|' + normData(p.data_admissao);
      if (!porChave.has(chave)) porChave.set(chave, p);
    }
    const achados = new Map();
    for (const item of linhasPlanilha) {
      const p = porChave.get(normNome(item.nome) + '|' + normData(item.data));
      if (!p) continue;
      const k = normAdm(p.cod_admissao);
      if (!k || achados.has(k)) continue;
      achados.set(k, { admissao: String(p.cod_admissao), paciente: p.paciente || item.nome, data: normData(p.data_admissao) });
    }
    return [...achados.values()];
  }

  /**
   * Lê a planilha do médico → { itens: [{nome, data}], adms: [admissões] }.
   * V907: além do par NOME+DATA, a importação aceita SÓ ADMISSÕES —
   *   · uma coluna com cabeçalho de admissão ("Admissão", "Cód. Admissão"...);
   *   · ou uma planilha SEM cabeçalho nenhum, só com os números (qualquer
   *     célula com 5+ dígitos vira candidata a admissão).
   */
  async function lerPlanilha(arquivo) {
    const buf = await arquivo.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    if (!linhas.length) return { itens: [], adms: [], erro: 'Planilha vazia' };
    // acha o cabeçalho: nome+data E/OU uma coluna de admissão
    const ehNome = (c) => /paciente|nome/i.test(String(c));
    const ehData = (c) => /data|atendimento/i.test(String(c));
    const ehAdm = (c) => /admiss|c[óo]d/i.test(String(c)) && !/data/i.test(String(c));
    let iCab = -1, cNome = -1, cData = -1, cAdm = -1;
    for (let i = 0; i < Math.min(linhas.length, 15); i++) {
      const linha = linhas[i].map(x => String(x || ''));
      const a = linha.findIndex(ehAdm);
      const n = linha.findIndex((c, idx) => idx !== a && ehNome(c));
      const d = linha.findIndex((c, idx) => idx !== n && idx !== a && ehData(c));
      if ((n >= 0 && d >= 0) || a >= 0) { iCab = i; cNome = n; cData = d; cAdm = a; break; }
    }
    const itens = [], adms = [];
    const pareceAdm = (v) => {
      if (v instanceof Date) return false;
      const s = String(v == null ? '' : v).trim().replace(/\.0+$/, '');
      return /^\d{5,}$/.test(s) ? s : false;
    };
    if (iCab >= 0) {
      for (let i = iCab + 1; i < linhas.length; i++) {
        if (cAdm >= 0) {
          const a = pareceAdm(linhas[i][cAdm]) || String(linhas[i][cAdm] || '').trim();
          if (a) adms.push(a);
        }
        if (cNome >= 0 && cData >= 0) {
          const nome = linhas[i][cNome], data = linhas[i][cData];
          if (nome && String(nome).trim()) itens.push({ nome: String(nome), data });
        }
      }
    } else {
      // sem cabeçalho: toda célula que parecer um número de admissão entra
      for (const linha of linhas) {
        for (const cel of linha) {
          const a = pareceAdm(cel);
          if (a) adms.push(a);
        }
      }
    }
    if (!itens.length && !adms.length) {
      return { itens, adms, erro: 'Não achei colunas de NOME+DATA nem de ADMISSÃO na planilha' };
    }
    return { itens, adms, erro: null };
  }

  /** V907: resolve uma lista de ADMISSÕES em itens da lista — paciente e data
   *  vêm da produção (1ª escolha) ou do QVIS; sem par em lugar nenhum, a
   *  admissão entra mesmo assim (o motor da Inspeção trabalha por admissão). */
  function resolverAdmissoes(adms) {
    const out = [];
    const vistos = new Set();
    for (const a of adms) {
      const k = normAdm(a);
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      let p = null;
      try {
        p = (buscarProducao(a) || [])[0] || null;
        if (p) p = { adm: p.cod_admissao, paciente: p.paciente, data: p.data_admissao };
        else {
          const q = (buscarQvis(a) || [])[0] || null;
          if (q) p = { adm: q.admissao, paciente: q.paciente, data: q.data_admissao };
        }
      } catch (e) { p = null; }
      out.push({
        admissao: String(p ? p.adm : String(a).trim()),
        paciente: p ? (p.paciente || '') : '',
        data: p ? normData(p.data) : '',
      });
    }
    return out;
  }

  // ────────────────────────────────────────────────────────────────────────
  // TELA
  // ────────────────────────────────────────────────────────────────────────
  /**
   * V808: OCULTAR NOMES na tela da Inspeção.
   *
   * O médico já tem código (CodigoMedico) — é ele que aparece no lugar do nome.
   * O paciente não tem, então vira INICIAIS: "MARIA DA PENHA MOURA WANDERLEY"
   * → "M.P.M.W." (partículas como DA/DE/DO não contam). Some o nome, fica a
   * identificação suficiente para acompanhar a linha na tela.
   *
   * Só a TELA é afetada: a extração continua com os nomes reais, como o resto
   * da ferramenta (é ela que vai para a conferência).
   */
  const _PARTICULA = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'D']);
  function nomePaciente(nome) {
    const t = String(nome == null ? '' : nome).trim();
    if (!t || !CodigoMedico.ocultando()) return t;
    const iniciais = normNome(t).split(' ')
      .filter(x => x && !_PARTICULA.has(x))
      .map(x => x[0]);
    return iniciais.length ? iniciais.join('.') + '.' : '—';
  }
  /** nome do profissional como deve aparecer na TELA (código quando ocultando) */
  const nomeMedico = (n) => CodigoMedico.exibir(n || '');

  function tabela(linhas, colunas) {
    return `
      <div class="insp-tab-wrap">
        <table class="insp-tab">
          <thead><tr>${colunas.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.rot)}</th>`).join('')}</tr></thead>
          <tbody>
            ${linhas.map(l => `<tr>${colunas.map(c => {
              const v = c.get(l);
              return `<td class="${c.num ? 'num mono' : ''}${c.rep ? ' atlas-rep' : ''}">${c.html ? v : esc(v == null ? '' : v)}</td>`;   // V962: coluna de repasse em #1d4470
            }).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  const COLS_QVIS = [
    { rot: 'Competência', get: l => l.competencia },
    { rot: 'Mês pgto', get: l => l.mes_pagamento },
    { rot: 'Data adm.', get: l => dataBR(l.data_admissao) },
    { rot: 'Paciente', get: l => nomePaciente(l.paciente) },
    { rot: 'Profissional', get: l => CodigoMedico.exibir(l.nome_profissional || '') },
    { rot: 'Papel', get: l => l.papel },
    { rot: 'Procedimento', get: l => l.procedimento },
    { rot: 'Origem', html: true, get: l => l.origem ? Utilidades.badgeFonte(l.origem) : '' },   // V947
    { rot: 'Convênio', get: l => l.convenio },
    { rot: 'Qtd', get: l => l.quantidade, num: true },
    { rot: 'Produzido', get: l => 'R$ ' + fmtN(l.produzido), num: true },
    { rot: 'Honorário', get: l => 'R$ ' + fmtN(l.honorario), num: true },
    { rot: 'Recebido', get: l => 'R$ ' + fmtN(l.recebido), num: true },
    { rot: 'Repassado', get: l => 'R$ ' + fmtN(l.repassado), num: true },
  ];
  /** V773: valor EFETIVAMENTE pago ao médico — o ATLAS institucional vale 0. */
  function valorPagoDaLinha(l) {
    return ehMedicoInstitucional(l._medicoNome || l.nome_profissional) ? 0 : (Number(l._repasse) || 0);
  }

  // V791: o bloco 2 passou a ler Relatórios › Consolidado — as colunas são as
  // do próprio Consolidado (com Módulo, que diz de onde veio cada pagamento).
  const COLS_REP = [
    { rot: 'Competência', get: r => r.competencia },
    { rot: 'Status', get: r => r.linha.status || '' },
    { rot: 'Módulo', get: r => r.linha.modulo || '' },
    { rot: 'Data', get: r => r.linha.data || '' },
    { rot: 'Papel', get: r => r.linha.papel || '' },
    { rot: 'Profissional', get: r => CodigoMedico.exibir(r.linha.profissional || '') },
    { rot: 'Paciente', get: r => nomePaciente(r.linha.paciente) },
    { rot: 'Origem', html: true, get: r => r.linha.origem ? Utilidades.badgeFonte(r.linha.origem) : '' },   // V947
    { rot: 'Convênio', get: r => r.linha.convenio || '' },
    { rot: 'Descrição', get: r => r.linha.descricao || '' },
    { rot: 'Produzido', get: r => r.linha.produzido || '', num: true },
    { rot: 'Valor', get: r => 'R$ ' + fmtN(valorConsolidado(r.linha)), num: true, rep: true },   // V962
  ];
  function vazio(msg) {
    return `<div class="insp-vazio">${esc(msg)}</div>`;
  }

  function abrir() {
    document.getElementById('insp-overlay')?.remove();
    Utilidades.garantirEstilos && Utilidades.garantirEstilos('css-inspecao', CSS);
    const ov = document.createElement('div');
    ov.id = 'insp-overlay';
    ov.className = 'insp-overlay';
    ov.innerHTML = `
      <div class="insp-tela" role="dialog" aria-modal="true" aria-label="Inspeção de admissão">
        <header class="insp-head">
          <div>
            <h3>🔎 Inspeção de admissão</h3>
            <p>Rastreia a admissão nas três bases: como ela <strong>chega do QVIS</strong>, como fica no <strong>Relatório Repasse</strong> e como aparece na <strong>produção analítica</strong>.</p>
          </div>
          <div class="insp-head-acoes">
            <button class="insp-btn insp-btn-mini" id="insp-ocultar"
                    title="Trocar os nomes por código (médico) e iniciais (paciente) na tela"></button>
            <button class="insp-x" id="insp-fechar" title="Fechar">×</button>
          </div>
        </header>

        <div class="insp-filtros">
          <div class="insp-sb" id="insp-sb">
            <div class="insp-sb-celwrap" style="flex:.9">
              <div class="insp-sb-cel" data-cel="adm">
                <span class="insp-sb-tile">${_inspSvg(_inspIc('hash'))}</span>
                <span class="insp-sb-tx">
                  <label class="insp-sb-rot" for="insp-adm">Admissão</label>
                  <input class="insp-sb-inp" type="text" id="insp-adm" placeholder="código" autocomplete="off">
                </span>
              </div>
            </div>
            <div class="insp-sb-celwrap" style="flex:1.6">
              <div class="insp-sb-cel" data-cel="nome">
                <span class="insp-sb-tile">${_inspSvg(_inspIc('user'))}</span>
                <span class="insp-sb-tx">
                  <label class="insp-sb-rot" for="insp-nome">Nome do paciente</label>
                  <input class="insp-sb-inp" type="text" id="insp-nome" placeholder="traz as admissões do paciente" autocomplete="off">
                </span>
              </div>
            </div>
            <div class="insp-sb-celwrap" style="flex:.9">
              <div class="insp-sb-cel" data-cel="data">
                <span class="insp-sb-tile">${_inspSvg(_inspIc('calendar'))}</span>
                <span class="insp-sb-tx">
                  <label class="insp-sb-rot" for="insp-data">Data da admissão</label>
                  <input class="insp-sb-inp" type="date" id="insp-data" disabled title="Habilita ao buscar por nome">
                </span>
              </div>
            </div>
            <div class="insp-sb-acoes">
              <button class="insp-btn insp-btn-primary" id="insp-buscar">${_inspSvg(_inspIc('search'), 13, 2.4)} Buscar</button>
              <button class="insp-btn" id="insp-limpar">Limpar</button>
            </div>
          </div>
        </div>

        <div class="insp-corpo">
          <div class="insp-paineis" id="insp-paineis">
            ${vazio('Faça uma busca por admissão, ou pelo nome do paciente, para inspecionar.')}
          </div>
          <aside class="insp-lateral" id="insp-lateral">
            <!-- V787: a lateral recolhe para a DIREITA, liberando a área dos
                 painéis; a aba fina fica visível para trazer de volta. -->
            <button class="insp-lat-retrair" id="insp-lat-retrair"
                    title="Recolher a Planilha do médico">›</button>
            <div class="insp-lat-head">
              <strong>Planilha do médico</strong>
              <small>nome + data, ou só a coluna de ADMISSÕES</small><!-- V907 -->
            </div>
            <div class="insp-lat-acoes">
              <label class="insp-btn insp-btn-mini" title="Importar a planilha (colunas NOME+DATA, uma coluna de ADMISSÃO, ou só os números de admissão sem cabeçalho)">
                Importar
                <input type="file" id="insp-arquivo" accept=".xlsx,.xls,.csv" hidden>
              </label>
              <button class="insp-btn insp-btn-mini" id="insp-exportar-lista" title="Exporta a lista com a situação de cada admissão (pago × pendente)">Exportar</button>
              <button class="insp-btn insp-btn-mini" id="insp-limpar-lista" title="Esvaziar a lista">Limpar</button>
            </div>
            <!-- V846: com vigia ativa, a extração ganha a coluna REPASSE FALTANTE
                 e a aba "Valor a Repassar" (verificação pura da regra) -->
            <label style="display:flex; align-items:center; gap:5px; font-size:11px; cursor:pointer; margin-top:6px"
                   title="Com vigia ativa: a extração ganha a coluna REPASSE FALTANTE — o que a Base Tabela remunera para o procedimento vigiado e NÃO foi pago — e a aba 'Valor a Repassar' com o detalhe por admissão.">
              <input type="checkbox" id="insp-rep-faltante"> Adicionar Repasse faltante
            </label>
            <div class="insp-prod-bloco">
              <button class="insp-btn insp-btn-mini insp-prod-toggle" id="insp-prod-toggle"
                      title="Escolher produtos da produção para sair numa coluna extra da extração">
                ▤ Coluna de produtos <span id="insp-prod-badge"></span>
              </button>
              <div class="insp-prod-painel" id="insp-prod-painel" hidden>
                <input type="text" id="insp-prod-filtro" class="insp-prod-filtro" placeholder="contém...">
                <div class="insp-prod-lista" id="insp-prod-lista"></div>
              </div>
              <!-- V794: quais produtos aparecem na coluna SITUAÇÃO -->
              <button class="insp-btn insp-btn-mini insp-prod-toggle" id="insp-sit-toggle"
                      style="margin-top:5px"
                      title="Escolher quais produtos aparecem na coluna Situação da extração (vazio = todos)">
                ◎ Produtos na Situação <span id="insp-sit-badge"></span>
              </button>
              <div class="insp-prod-painel" id="insp-sit-painel" hidden>
                <input type="text" id="insp-sit-filtro" class="insp-prod-filtro" placeholder="contém...">
                <div class="insp-prod-lista" id="insp-sit-lista"></div>
              </div>
              <!-- V803: de quais médicos você quer ver a informação -->
              <button class="insp-btn insp-btn-mini insp-prod-toggle" id="insp-med-toggle"
                      style="margin-top:5px"
                      title="Escolher de quais médicos a extração mostra a informação (vazio = todos)">
                ⚕ Médicos da admissão <span id="insp-med-badge"></span>
              </button>
              <div class="insp-prod-painel" id="insp-med-painel" hidden>
                <input type="text" id="insp-med-filtro" class="insp-prod-filtro" placeholder="contém...">
                <div class="insp-prod-lista" id="insp-med-lista"></div>
              </div>
              <!-- V807: qual participação (papel) você quer ver -->
              <button class="insp-btn insp-btn-mini insp-prod-toggle" id="insp-papel-toggle"
                      style="margin-top:5px"
                      title="Escolher a participação do médico que a extração mostra (vazio = todas)">
                ⛭ Participação na admissão <span id="insp-papel-badge"></span>
              </button>
              <div class="insp-prod-painel" id="insp-papel-painel" hidden>
                <input type="text" id="insp-papel-filtro" class="insp-prod-filtro" placeholder="contém...">
                <div class="insp-prod-lista" id="insp-papel-lista"></div>
              </div>
              <button class="insp-btn insp-btn-mini insp-prod-toggle" id="insp-vig-toggle"
                      style="margin-top:5px"
                      title="Avisar quando um produto for pago sem o papel exigido (ex.: OCT sem Médico Laudo)">
                ⚠ Alertas de papel <span id="insp-vig-badge"></span>
              </button>
              <div class="insp-prod-painel" id="insp-vig-painel" hidden>
                <div class="insp-vig-lista" id="insp-vig-lista"></div>
                <div class="insp-vig-add">
                  <input type="text" id="insp-vig-filtro" class="insp-prod-filtro" placeholder="buscar produto (contém...)">
                  <div class="insp-vig-prods" id="insp-vig-prods"></div>
                  <div class="insp-vig-linha">
                    <select id="insp-vig-papel" class="insp-vig-select"></select>
                    <button class="insp-btn insp-btn-mini" id="insp-vig-add">+ Vigiar</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="insp-lat-lista" id="insp-lista"></div>
          </aside>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const $ = (id) => document.getElementById(id);
    const fechar = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    function onKey(e) { if (e.key === 'Escape') fechar(); }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    // V808: ocultar/mostrar nomes — repinta tudo o que está na tela
    function pintarBotaoOcultar() {
      const b = $('insp-ocultar');
      if (!b) return;
      const on = CodigoMedico.ocultando();
      b.textContent = on ? '👁 Mostrar nomes' : '🙈 Ocultar nomes';
      b.classList.toggle('ativo', on);
    }
    pintarBotaoOcultar();
    $('insp-ocultar').addEventListener('click', () => {
      CodigoMedico.alternar();
      pintarBotaoOcultar();
      pintarLista();
      const alvo = $('insp-adm')?.value?.trim();
      if (alvo && $('insp-paineis')?.querySelector('.insp-painel')) $('insp-buscar').click();
    });
    $('insp-fechar').addEventListener('click', fechar);

    // ── V787: lateral retrátil (estado lembrado entre aberturas) ──
    const LAT_KEY = 'insp_lateral_recolhida_v1';
    function aplicarLateral(recolhida) {
      const lat = $('insp-lateral'), bt = $('insp-lat-retrair');
      if (!lat || !bt) return;
      lat.classList.toggle('recolhida', recolhida);
      bt.textContent = recolhida ? '‹' : '›';
      bt.title = recolhida ? 'Mostrar a Planilha do médico' : 'Recolher a Planilha do médico';
      try { localStorage.setItem(LAT_KEY, recolhida ? '1' : '0'); } catch (e) {}
    }
    $('insp-lat-retrair').addEventListener('click', () =>
      aplicarLateral(!$('insp-lateral').classList.contains('recolhida')));
    try { aplicarLateral(localStorage.getItem(LAT_KEY) === '1'); } catch (e) {}

    // ── lista da direita (persistida) ──
    function pintarLista() {
      const itens = lerLista();
      const alvo = $('insp-lista');
      if (!itens.length) {
        alvo.innerHTML = `<div class="insp-lat-vazio">Nenhuma planilha importada.<br>As admissões encontradas aparecem aqui.</div>`;
        return;
      }
      // V752: quem AINDA não foi pago pelo convênio (fora do QVIS) → #1d4470
      const noQvis = admissoesNoQvis(itens.map(i => i.admissao));
      alvo.innerHTML = itens.map(i => {
        const pendente = !noQvis.has(normAdm(i.admissao));
        return `
        <button class="insp-lat-item ${pendente ? 'insp-lat-pendente' : ''}" data-adm="${esc(i.admissao)}"
                ${pendente ? 'title="O convênio ainda não pagou esta admissão"' : ''}>
          <span class="insp-lat-adm">${esc(i.admissao)}</span>
          <span class="insp-lat-pac">${esc(nomePaciente(i.paciente))}</span>
          <span class="insp-lat-data">${esc(dataBR(i.data))}</span>
        </button>`;
      }).join('');
      esteira('#insp-lista .insp-lat-item', { passo: 45 });
      alvo.querySelectorAll('.insp-lat-item').forEach(b => {
        b.addEventListener('click', () => {
          $('insp-adm').value = b.dataset.adm;
          $('insp-nome').value = '';
          $('insp-data').value = '';
          $('insp-data').disabled = true;
          inspecionar(b.dataset.adm);
          alvo.querySelectorAll('.insp-lat-item').forEach(x => x.classList.toggle('ativo', x === b));
        });
      });
    }
    pintarLista();

    // ── V778: pré-lista de produtos (com busca) para a coluna extra da extração ──
    /**
     * V794: o MESMO painel serve a dois filtros — os produtos da coluna extra
     * ("Coluna de produtos") e os que aparecem na coluna SITUAÇÃO. Muda só a
     * chave lida/gravada e os ids dos elementos.
     */
    function montarPainelProdutos({ pre, ler, salvar, vazio, fonte, rotuloVazio }) {
      // V803: o mesmo painel serve para produto e para MÉDICO — muda só a fonte
      // V855: `chave` = grafia real (gravada no filtro e casada com a produção);
      // `rotulo` = NOMENCLATURA da Base Tabela, que é o que aparece na tela
      const listar = fonte || ((adms) => produtosDaLista(adms)
        .map(p => ({ chave: p.produto, rotulo: p.rotulo, n: p.n })));
      const oQue = rotuloVazio || 'produto';
      const id = (s) => `insp-${pre}-${s}`;
      function pintar() {
        const sel = ler();
        const badge = $(id('badge'));
        if (badge) badge.textContent = sel.size ? `(${sel.size})` : '';
        const alvo = $(id('lista'));
        if (!alvo) return;
        /**
         * V859: com o painel FECHADO, para no contador.
         *
         * Os quatro painéis (produtos, situação, médicos, participação) eram
         * montados na ABERTURA da tela, escondidos. Para listar médicos e
         * participações é preciso saber o que cada admissão da pauta recebeu —
         * ou seja, auditar todos os meses da pauta. A tela ficava minutos presa
         * calculando quatro listas que ninguém estava vendo.
         *
         * O contador `(N)` vem da seleção salva e continua saindo na hora. A
         * lista é montada quando o painel abre — que é quando ela é olhada, e
         * já era o gatilho do próprio botão.
         */
        const painel = $(id('painel'));
        if (painel && painel.hidden) return;
        const itens = lerLista();
        if (!itens.length) { alvo.innerHTML = `<div class="insp-prod-vazio">${vazio}</div>`; return; }
        const filtro = normNome($(id('filtro'))?.value || '');
        const todos = listar(itens.map(i => i.admissao));
        const visiveis = filtro
          ? todos.filter(p => normNome(p.rotulo || p.chave).indexOf(filtro) >= 0)
          : todos;
        if (!visiveis.length) {
          alvo.innerHTML = `<div class="insp-prod-vazio">Nenhum ${oQue} ${filtro ? 'com esse texto' : 'nessas admissões'}.</div>`;
          return;
        }
        alvo.innerHTML = visiveis.map(p => `
          <label class="insp-prod-item" title="${esc(p.rotulo || p.chave)}">
            <input type="checkbox" data-prod="${esc(p.chave)}" ${sel.has(p.chave) ? 'checked' : ''}>
            <span class="insp-prod-nome">${esc(p.rotulo || p.chave)}</span>
            <span class="insp-prod-n">${p.n}</span>
          </label>`).join('');
        alvo.querySelectorAll('input[data-prod]').forEach(chk => {
          chk.addEventListener('change', () => {
            const s = ler();
            if (chk.checked) s.add(chk.dataset.prod); else s.delete(chk.dataset.prod);
            salvar(s);
            const b = $(id('badge'));
            if (b) b.textContent = s.size ? `(${s.size})` : '';
          });
        });
      }
      $(id('toggle')).addEventListener('click', () => {
        const p = $(id('painel'));
        p.hidden = !p.hidden;
        if (!p.hidden) pintar();
      });
      $(id('filtro')).addEventListener('input', pintar);
      pintar();
      return pintar;
    }
    const pintarProdutos = montarPainelProdutos({
      pre: 'prod', ler: lerSelProdutos, salvar: salvarSelProdutos,
      vazio: 'Importe uma planilha — os produtos lançados dessas admissões aparecem aqui.',
    });
    const pintarSituacao = montarPainelProdutos({
      pre: 'sit', ler: lerSelSituacao, salvar: salvarSelSituacao,
      vazio: 'Importe uma planilha — escolha aqui o que deve aparecer na coluna Situação.',
    });

    const pintarMedicos = montarPainelProdutos({
      pre: 'med', ler: lerSelMedicos, salvar: salvarSelMedicos,
      vazio: 'Importe uma planilha — os médicos dessas admissões aparecem aqui.',
      rotuloVazio: 'médico',
      fonte: (adms) => medicosDaLista(adms).map(m => ({
        chave: m.nome, rotulo: CodigoMedico.exibir(m.nome), n: m.n })),
    });

    const pintarPapeis = montarPainelProdutos({
      pre: 'papel', ler: lerSelPapeis, salvar: salvarSelPapeis,
      vazio: 'Importe uma planilha — as participações dessas admissões aparecem aqui.',
      rotuloVazio: 'papel',
      fonte: (adms) => papeisDaLista(adms).map(p => ({ chave: p.papel, n: p.n })),
    });

    // ── V784: vigias (produto → papel exigido) ──
    let vigProdSel = null;
    let vigAberto = false;   // V785: bloco "mais de um" começa fechado
    function papeisDisponiveis() {
      let nomes = [];
      try { nomes = (Banco.query(`SELECT nome FROM papeis ORDER BY nome`) || []).map(p => p.nome).filter(Boolean); }
      catch (e) {}
      if (!nomes.length) nomes = ['Executante', 'Indicante', 'Médico Laudo', 'Auxiliar'];
      if (!nomes.some(n => papelCanonico(n) === 'MEDICO LAUDO')) nomes.push('Médico Laudo');
      // V833: "Todos" — vigia o procedimento INTEIRO (consolidado de todos os
      // papéis: o motor geral, individualizado na vigia, cobra o que faltar)
      return ['Todos'].concat(nomes);
    }
    /** produtos para escolher: os da lista importada; sem lista, os mais lançados */
    function produtosParaVigia() {
      const itens = lerLista();
      if (itens.length) return produtosDaLista(itens.map(i => i.admissao));
      try {
        const cont = new Map();
        for (const r of Banco.query(
          `SELECT produto, classificacao_produto, categoria, COUNT(*) AS n FROM linhas_producao
            WHERE TRIM(COALESCE(produto,'')) <> ''
            GROUP BY produto, classificacao_produto, categoria ORDER BY n DESC LIMIT 600`) || []) {
          if (!produtoRepassavel(r.classificacao_produto, r.categoria)) continue;   // V856
          const p = String(r.produto).trim();
          cont.set(p, (cont.get(p) || 0) + (Number(r.n) || 0));
        }
        // V797: mesma regra da pré-lista — uma opção por exame, não por grafia
        // V855: `produto` = grafia real (é o que fica gravado na vigia e casa
        // com a produção); `rotulo` = NOMENCLATURA da Base Tabela, só exibição
        return agruparProdutos([...cont.keys()])
          .map(g => ({ produto: g.nome, rotulo: rotuloAlerta(g.nome),
                       n: g.grafias.reduce((t, x) => t + (cont.get(x) || 0), 0) }))
          .sort((a, b) => (a.rotulo || a.produto).localeCompare(b.rotulo || b.produto, 'pt-BR'));
      } catch (e) { return []; }
    }
    function pintarVigias() {
      const vigias = lerVigias();
      const badge = $('insp-vig-badge');
      if (badge) badge.textContent = vigias.length ? `(${vigias.length})` : '';
      const lista = $('insp-vig-lista');
      if (!lista) return;
      // V785: uma linha por procedimento canônico (de-para de nomenclaturas)
      const grupos = vigiasAgrupadas();
      if (badge) badge.textContent = grupos.length ? `(${grupos.length})` : '';
      const item = (g) => `
        <div class="insp-vig-item" title="${esc(g.nome)} exige ${esc(g.papel)} pago">
          <div class="insp-vig-prod">${esc(g.rotulo || g.nome)}
            ${g.grafias.length > 1
              ? `<span class="insp-vig-grafias">cobre ${g.grafias.length} grafias: ${esc(g.grafias.join(' · '))}</span>` : ''}
          </div>
          <span class="insp-vig-papel">→ ${esc(String(g.papel).toUpperCase())}</span>
          <button class="insp-vig-x" data-vig="${esc(g.chave)}" title="Remover">✕</button>
        </div>`;
      if (!grupos.length) {
        lista.innerHTML = `<div class="insp-prod-vazio">Nenhuma vigia — nenhum alerta sai no relatório.</div>`;
      } else if (grupos.length === 1) {
        lista.innerHTML = item(grupos[0]);
      } else {
        // V785: mais de um procedimento vigiado → tudo dentro de um só bloco,
        // que abre ao clicar (o painel deixa de ficar espremido)
        lista.innerHTML = `
          <button class="insp-vig-mais" id="insp-vig-mais" aria-expanded="${vigAberto ? 'true' : 'false'}">
            <span>${vigAberto ? '▾' : '▸'} mais de um (${grupos.length})</span>
          </button>
          <div class="insp-vig-dentro" ${vigAberto ? '' : 'hidden'}>${grupos.map(item).join('')}</div>`;
        lista.querySelector('#insp-vig-mais').addEventListener('click', () => {
          vigAberto = !vigAberto; pintarVigias();
        });
      }
      lista.querySelectorAll('[data-vig]').forEach(b => {
        b.addEventListener('click', () => {
          const alvo = grupos.find(g => g.chave === b.dataset.vig);
          if (!alvo) return;
          // remove TODAS as grafias do grupo (índices de trás para frente)
          const v = lerVigias();
          alvo.indices.slice().sort((a, c) => c - a).forEach(i => v.splice(i, 1));
          salvarVigias(v); pintarVigias();
        });
      });
      // seletor de papel
      const sel = $('insp-vig-papel');
      if (sel && !sel.options.length) {
        sel.innerHTML = papeisDisponiveis().map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
        const laudo = [...sel.options].find(o => papelCanonico(o.value) === 'MEDICO LAUDO');
        if (laudo) sel.value = laudo.value;
      }
      // lista de produtos para escolher
      const filtro = normNome($('insp-vig-filtro')?.value || '');
      const prods = produtosParaVigia()
        // V855: o "buscar produto" acha tanto pela grafia quanto pela nomenclatura
        .filter(p => !filtro || normNome(p.produto).indexOf(filtro) >= 0
                  || normNome(p.rotulo || '').indexOf(filtro) >= 0)
        .slice(0, 60);
      const alvo = $('insp-vig-prods');
      alvo.innerHTML = prods.length
        ? prods.map(p => `
            <button class="insp-vig-op ${vigProdSel === p.produto ? 'sel' : ''}"
                    data-prod="${esc(p.produto)}" title="${esc(p.produto)}">${esc(p.rotulo || p.produto)}</button>`).join('')
        : `<div class="insp-prod-vazio">Nenhum produto ${filtro ? 'com esse texto' : 'na produção'}.</div>`;
      alvo.querySelectorAll('[data-prod]').forEach(b => {
        b.addEventListener('click', () => { vigProdSel = b.dataset.prod; pintarVigias(); });
      });
    }
    $('insp-vig-toggle').addEventListener('click', () => {
      const p = $('insp-vig-painel');
      p.hidden = !p.hidden;
      if (!p.hidden) pintarVigias();
    });
    $('insp-vig-filtro').addEventListener('input', pintarVigias);
    $('insp-vig-add').addEventListener('click', () => {
      const papel = $('insp-vig-papel').value;
      if (!vigProdSel) { Utilidades.toast?.('Escolha um produto na lista', 'warning', 2600); return; }
      const v = lerVigias();
      // V785: uma única checagem — a grafia escolhida já é coberta por algum
      // grupo (mesmo nome OU mesma coisa pelo de-para de nomenclaturas)?
      const jaCoberta = vigiasAgrupadas().find(g =>
        g.papelCanon === papelCanonico(papel)
        && g.grafias.concat(g.nome).some(gr => mesmoExame(gr, vigProdSel)));
      if (jaCoberta) {
        const mesmoTexto = g => normNome(g) === normNome(vigProdSel);
        Utilidades.toast?.(
          jaCoberta.grafias.concat(jaCoberta.nome).some(mesmoTexto)
            ? 'Essa vigia já existe'
            : `Já coberta por ${jaCoberta.nome} (mesma nomenclatura)`, 'info', 3400);
        vigProdSel = null; $('insp-vig-filtro').value = ''; pintarVigias();
        return;
      }
      v.push({ produto: vigProdSel, papel });
      salvarVigias(v);
      vigProdSel = null;
      $('insp-vig-filtro').value = '';
      pintarVigias();
      Utilidades.toast?.('✓ Vigia adicionada', 'success', 2200);
    });
    pintarVigias();

    // V846: flag "Adicionar Repasse faltante" — persiste entre sessões
    const flagRep = $('insp-rep-faltante');
    if (flagRep) {
      flagRep.checked = lerRepFaltante();
      flagRep.addEventListener('change', () => salvarRepFaltante(flagRep.checked));
    }
    $('insp-limpar-lista').addEventListener('click', () => {
      salvarLista([]);
      // V829: "Limpar" zera a planilha E TODOS os filtros juntos — coluna de
      // produtos, produtos na situação, médicos e participação. (As vigias
      // ficam: são monitoramento cadastrado, não filtro da lista.)
      salvarSelProdutos(new Set());
      salvarSelSituacao(new Set());
      salvarSelMedicos(new Set());
      salvarSelPapeis(new Set());
      pintarLista(); pintarProdutos(); pintarSituacao(); pintarMedicos(); pintarPapeis();
    });
    // V752: exportação — Admissão | Nome do paciente | Data | Situação
    $('insp-exportar-lista').addEventListener('click', async () => {
      const itens = lerLista();
      if (!itens.length) { Utilidades.toast?.('Importe uma planilha primeiro', 'warning'); return; }
      if (typeof ExcelJS === 'undefined') { Utilidades.toast?.('Biblioteca ExcelJS não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4500); return; }
      // V894: trava contra clique duplo — a extração longa agora é assíncrona
      const btnExpLista = $('insp-exportar-lista');
      if (btnExpLista && btnExpLista.disabled) return;
      const rotuloExp = btnExpLista ? btnExpLista.textContent : '';
      if (btnExpLista) btnExpLista.disabled = true;
      try {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'ATLAS — Repasse Médico';
        wb.created = new Date();
        const ws = wb.addWorksheet('Inspeção', {   // V764: sem linhas de grade
          views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
        });

        // V763: a situação é calculada ANTES de montar a planilha — as larguras
        // e as alturas saem do conteúdo real, então o relatório já abre com
        // tudo à mostra, sem precisar arrastar coluna nem expandir linha.
        // V859: resolve o Consolidado da pauta inteira MÊS A MÊS antes de
        // montar a planilha. Sem isso, cada admissão remontava a matriz do seu
        // mês (198 montagens na base real) e a extração levava minutos.
        precarregarConsolidado(itens.map(i => i.admissao));
        const receb = recebimentoDe(itens.map(i => i.admissao));   // V755
        // V778: produtos selecionados na pré-lista → coluna extra (nenhum
        // selecionado = a coluna nem é construída)
        const selProd = lerSelProdutos();
        const comProd = selProd.size > 0;
        /**
         * V823: com VIGIA ativa, a ferramenta consulta o BOX 3 (produção) de
         * cada admissão e classifica numa coluna própria: o procedimento
         * vigiado está lá? "Sim" / "Não". Qualquer grafia do grupo da vigia
         * vale (de-para de nomenclatura), no produto ou no procedimento
         * principal do relatório de produção. Sem vigia, a coluna nem existe.
         */
        const vigsExp = vigiasAgrupadas();
        const comVig = vigsExp.length > 0;
        // V846: flag ligada → coluna REPASSE FALTANTE + aba própria.
        // V873: a exigência de vigia ativa saiu — o OPME do box 3 é uma fonte
        // de repasse faltante que NÃO passa por vigia, e com a regra antiga ele
        // nunca apareceria numa base sem procedimento vigiado.
        const comFaltante = lerRepFaltante();
        const vigNaProducao = (adm) => (buscarProducao(adm) || []).some(l =>
          vigsExp.some(v => v.grafias.concat(v.nome).some(g =>
            mesmoExame(l.produto || '', g)
            || mesmoExame(l.procedimento_principal || '', g)))) ? 'Sim' : 'Não';
        /**
         * V877: UMA LINHA POR FONTE PAGADORA. A admissão com particular E
         * convênio vira duas linhas, e cada uma analisa só os procedimentos da
         * sua fonte — Situação, alertas e Repasse faltante inclusive. Assim a
         * soma das duas é a admissão, em vez de repetir o texto inteiro nas
         * duas (que duplicaria valor na leitura).
         */
        const ctxFalt = { selSit: lerSelSituacao(), selMed: lerSelMedicos(),
                          selPapel: lerSelPapeis() };
        const linhasDaPauta = [];
        for (const i of itens) {
          const r = receb.get(normAdm(i.admissao)) || {};
          const fontes = (r.fontes && r.fontes.size > 1) ? [...r.fontes.values()] : [null];
          for (const f of fontes) linhasDaPauta.push({ i, r, f });
        }
        /**
         * ══ V894: A EXTRAÇÃO GRANDE NÃO TRAVA MAIS ═══════════════════════════
         *
         * Antes, TODA a análise rodava num bloco síncrono só: com milhares de
         * admissões o navegador congelava (e o Chrome chegava a matar a aba).
         * Agora o trabalho anda em LOTES, devolvendo o fôlego à tela entre um
         * e outro — e o botão vira a barra de progresso ("já foram X de Y").
         */
        const respiro = () => new Promise(r => setTimeout(r, 0));
        const progresso = (txt) => { if (btnExpLista) btnExpLista.textContent = txt; };
        const LOTE = 40;
        const dados = [];
        for (let i0 = 0; i0 < linhasDaPauta.length; i0 += LOTE) {
          for (const { i, r, f } of linhasDaPauta.slice(i0, i0 + LOTE)) {
            dados.push({
              adm: String(i.admissao), pac: i.paciente || '', data: dataBR(i.data),
              tipo: (f ? f.tipo : r.tipo) || '—', conv: (f ? f.convenio : r.convenio) || '—',
              fonte: f ? f.tipo : '',
              sit: situacaoDe(i.admissao, f ? f.tipo : ''),
              prod: comProd ? papeisDoProduto(i.admissao, selProd) : null,
              vig: comVig ? vigNaProducao(i.admissao) : null,
              falt: comFaltante ? _faltanteMemo(i.admissao, f ? f.tipo : '', ctxFalt) : null,
            });
          }
          progresso(`Analisando… ${Math.min(i0 + LOTE, linhasDaPauta.length)}/${linhasDaPauta.length}`);
          await respiro();
        }
        const larg = (titulo, valores, min, max) => Math.max(
          min, Math.min(max, Math.max(titulo.length, ...valores.map(v => String(v || '').length)) + 3));
        // a coluna da situação acompanha a LINHA MAIS LONGA do texto
        const linhasSit = dados.flatMap(d => d.sit.plain.split('\n'));
        const largSit = larg('Situação', linhasSit, 40, 255);   // V764: até a maior frase
        // V778: largura da coluna de produtos pela linha mais longa dela
        const linhasProd = comProd ? dados.flatMap(d => (d.prod?.plain || '').split('\n')) : [];
        const largProd = comProd ? larg('Produto · papéis', linhasProd, 26, 120) : 0;
        // V790: títulos das colunas em CAIXA ALTA
        ws.columns = [
          { header: 'ADMISSÃO', key: 'adm', width: larg('Admissão', dados.map(d => d.adm), 12, 24) },
          { header: 'NOME DO PACIENTE', key: 'pac', width: larg('Nome do paciente', dados.map(d => d.pac), 20, 46) },
          { header: 'DATA', key: 'data', width: larg('Data', dados.map(d => d.data), 11, 16) },
          { header: 'TIPO DE RECEBIMENTO', key: 'tipo', width: larg('Tipo de recebimento', dados.map(d => d.tipo), 14, 28) },
          { header: 'CONVÊNIO', key: 'conv', width: larg('Convênio', dados.map(d => d.conv), 14, 40) },
          { header: 'SITUAÇÃO', key: 'sit', width: largSit },
          ...(comProd ? [{ header: 'PRODUTO · PAPÉIS', key: 'prod', width: largProd }] : []),
          // V823/V824: coluna Sim/Não do vigiado no box 3 — a ÚLTIMA, para não
          // deslocar a SITUAÇÃO de quem já lê a planilha por posição
          ...(comVig ? [{ header: 'PRODUÇÃO', key: 'vig', width: 14 }] : []),
          // V846: valor que a regra manda pagar e não foi pago (vigiados)
          ...(comFaltante ? [{ header: 'REPASSE FALTANTE', key: 'falt', width: 19 }] : []),
        ];
        const h = ws.getRow(1);
        h.height = 22;
        h.eachCell((c) => {
          c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF107DAC' } };
          c.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        let _nLote = 0;
        for (const d of dados) {
          // V894: a montagem da planilha também anda em lotes
          if (++_nLote % 200 === 0) {
            progresso(`Montando planilha… ${_nLote}/${dados.length}`);
            await respiro();
          }
          const row = ws.addRow({ adm: d.adm, pac: d.pac, data: d.data, tipo: d.tipo, conv: d.conv,
                                  ...(comVig ? { vig: d.vig } : {}),
                                  // V875: sem nada a pagar a célula sai R$ 0,00,
                                  // não em branco — branco confunde com "não
                                  // calculado", e o zero é uma afirmação
                                  ...(comFaltante ? { falt: (d.falt && d.falt.total > 0) ? d.falt.total : 0 } : {}) });
          if (comVig) {
            const cv = row.getCell('vig');
            cv.alignment = { horizontal: 'center', vertical: 'middle' };
            // V824: os dois com o mesmo peso — Sim no azul da marca, Não no
            // vermelho, ambos em negrito
            cv.font = { bold: true,
              color: { argb: d.vig === 'Não' ? 'FF9B3A3A' : 'FF107DAC' } };
          }
          // V846: REPASSE FALTANTE — em vermelho negrito quando há valor
          if (comFaltante) {
            const cf = row.getCell('falt');
            cf.alignment = { horizontal: 'center', vertical: 'middle' };
            cf.numFmt = '"R$" #,##0.00';         // V875: o zero também sai em R$
            if (d.falt && d.falt.total > 0) {
              cf.font = { bold: true, color: { argb: 'FF9B3A3A' } };
            } else {
              // nada a pagar: R$ 0,00 discreto, sem o vermelho de cobrança
              cf.font = { color: { argb: 'FF8B98A5' } };
            }
          }
          // V763/V764: colunas centralizadas — menos o NOME DO PACIENTE, que
          // fica à esquerda
          ['adm', 'data', 'tipo'].forEach(k => {
            row.getCell(k).alignment = { horizontal: 'center', vertical: 'middle' };
          });
          // V770: nome do paciente e CONVÊNIO à esquerda
          ['pac', 'conv'].forEach(k => {
            row.getCell(k).alignment = { horizontal: 'left', vertical: 'middle' };
          });
          Utilidades.pintarCelulaFonte(row.getCell('tipo'), d.tipo);   // V947 (a zebra abaixo respeita)
          const cel = row.getCell('sit');
          cel.value = { richText: d.sit.rich };
          cel.alignment = { wrapText: true, vertical: 'middle', horizontal: 'left' };
          // V778: coluna de produtos (papéis lançados na produção)
          if (comProd) {
            const cp = row.getCell('prod');
            if (d.prod && d.prod.rich.length) cp.value = { richText: d.prod.rich };
            cp.alignment = { wrapText: true, vertical: 'middle', horizontal: 'left' };
          }
          // V768: a zebra é pintada DEPOIS de a linha estar completa e percorre
          // as colunas por índice — antes a Situação era preenchida após o
          // eachCell e ficava sempre branca.
          const zebra = (ws.rowCount % 2 === 0) ? 'FFDDDDDD' : 'FFFFFFFF';
          for (let c = 1; c <= ws.columns.length; c++) {
            if (ws.getColumn(c).key === 'tipo' && Utilidades.classeFonte(d.tipo)) continue;   // V947: mantém a cor da tag
            row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
          }
          /**
           * V884: "verificar indicante" — o Excel não pinta um pedaço de
           * célula, só a célula inteira. Então a SITUAÇÃO da linha sai em
           * amarelo, depois da zebra, e a frase dentro dela é o que dizer.
           */
          if (d.falt && d.falt.verificar) {
            row.getCell('sit').fill = { type: 'pattern', pattern: 'solid',
              fgColor: { argb: 'FFFFF3B0' } };
          }
          // altura = todas as linhas do texto (contando as que ainda quebrarem),
          // respeitando o teto do Excel (409 pontos)
          const contarVisuais = (texto, largura) => String(texto || '').split('\n')
            .reduce((t, l) => t + Math.max(1, Math.ceil(l.length / Math.max(10, largura - 2))), 0);
          const visuais = Math.max(
            contarVisuais(d.sit.plain, largSit),
            comProd ? contarVisuais(d.prod?.plain, largProd) : 0);
          row.height = Math.min(409, 13.8 * visuais + 5);
        }

        // ── V788: aba RESUMO — quantitativo + confirmações sobre papéis ──
        montarAbaResumo(wb, dados);
        // ── V846: aba "Valor a Repassar" — detalhe do repasse faltante ──
        if (comFaltante) montarAbaValorARepassar(wb, dados);
        progresso('Gerando arquivo…');
        await respiro();
        const buffer = await wb.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'Inspecao_planilha_medico.xlsx';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        Utilidades.toast?.(`✓ Exportadas ${itens.length} admissões com a situação`, 'success');
      } catch (err) {
        console.error(err);
        Utilidades.toast?.('Falha ao exportar: ' + err.message, 'error', 4500);
      } finally {
        if (btnExpLista) { btnExpLista.disabled = false; btnExpLista.textContent = rotuloExp; }
      }
    });
    $('insp-arquivo').addEventListener('change', async (e) => {
      const arq = e.target.files && e.target.files[0];
      if (!arq) return;
      e.target.value = '';
      if (typeof XLSX === 'undefined') {
        Utilidades.toast?.('Biblioteca de Excel não carregada. Recarregue (Ctrl+Shift+R).', 'error', 4000); return;
      }
      try {
        const { itens, adms, erro } = await lerPlanilha(arq);
        if (erro) { Utilidades.toast?.(erro, 'error', 4500); return; }
        // V907: admissões diretas + nome+data — união sem duplicar
        const porAdm = adms && adms.length ? resolverAdmissoes(adms) : [];
        const porNome = itens.length ? casarNaProducao(itens) : [];
        const mapa = new Map();
        for (const x of [...porAdm, ...porNome]) {
          const k = normAdm(x.admissao);
          if (k && !mapa.has(k)) mapa.set(k, x);
        }
        const achados = [...mapa.values()];
        salvarLista(achados);
        pintarLista();
        pintarProdutos(); pintarSituacao(); pintarMedicos(); pintarPapeis();   // as pré-listas acompanham a lista
        const partes = [];
        if (porAdm.length) partes.push(`${porAdm.length} direto pela admissão`);
        if (itens.length) partes.push(`${porNome.length} de ${itens.length} por nome+data`);
        Utilidades.toast?.(`✓ ${achados.length} admissões na lista — ${partes.join(' · ')}`,
          achados.length ? 'success' : 'warning', 4200);
      } catch (err) {
        console.error(err);
        Utilidades.toast?.('Falha ao ler a planilha: ' + err.message, 'error', 4500);
      }
    });

    // ── busca ──
    const nomeEl = $('insp-nome'), dataEl = $('insp-data'), admEl = $('insp-adm');
    nomeEl.addEventListener('input', () => {
      // a data só é preenchível quando se busca por nome
      dataEl.disabled = normNome(nomeEl.value).length < 3;
      if (dataEl.disabled) dataEl.value = '';
    });
    $('insp-limpar').addEventListener('click', () => {
      admEl.value = ''; nomeEl.value = ''; dataEl.value = ''; dataEl.disabled = true;
      $('insp-paineis').innerHTML = vazio('Faça uma busca por admissão, ou pelo nome do paciente, para inspecionar.');
    });
    const buscar = () => {
      const adm = admEl.value.trim();
      if (adm) { inspecionar(adm); return; }
      const nome = nomeEl.value.trim();
      if (normNome(nome).length < 3) {
        $('insp-paineis').innerHTML = vazio('Informe a admissão ou pelo menos 3 letras do nome do paciente.');
        return;
      }
      const candidatas = buscarAdmissoesPorPaciente(nome, dataEl.value || '');
      if (!candidatas.length) {
        $('insp-paineis').innerHTML = vazio('Nenhuma admissão encontrada para esse paciente' + (dataEl.value ? ' nessa data.' : '.'));
        return;
      }
      if (candidatas.length === 1) { admEl.value = candidatas[0].admissao; inspecionar(candidatas[0].admissao); return; }
      $('insp-paineis').innerHTML = `
        <div class="insp-cands">
          <div class="insp-cands-tit">${candidatas.length} admissões de <strong>${esc(nomePaciente(candidatas[0].paciente || nome))}</strong> — escolha uma:</div>
          ${candidatas.map(c => `
            <button class="insp-cand" data-adm="${esc(c.admissao)}">
              <span class="insp-lat-adm">${esc(c.admissao)}</span>
              <span class="insp-lat-data">${esc(dataBR(c.data))}</span>
              <span class="insp-lat-pac">${esc(nomePaciente(c.paciente))}</span>
              <span class="insp-cand-proc">${esc(procPrincipalDaAdmissao(c.admissao))}</span>
            </button>`).join('')}
        </div>`;
      esteira('#insp-paineis .insp-cands-tit, #insp-paineis .insp-cand', { passo: 55 });
      $('insp-paineis').querySelectorAll('.insp-cand').forEach(b => {
        b.addEventListener('click', () => { admEl.value = b.dataset.adm; inspecionar(b.dataset.adm); });
      });
    };
    $('insp-buscar').addEventListener('click', buscar);
    [admEl, nomeEl, dataEl].forEach(el => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') buscar(); }));

    /** Monta os três painéis + o diagnóstico da admissão. */
    // V776: as linhas "procedimento — pago a médico: PAPEL R$ x" do card. O
    // mesmo desenho serve para o pagamento principal e para os complementos.
    function linhasAnalit(lista) {
      return (lista || []).map(a => `
        <div class="insp-analit-l">
          ${a.vezes > 1 ? `<span class="insp-analit-qtd">x${a.vezes}</span> ` : ''}
          <span class="insp-analit-proc">${esc(a.proc)}</span> —
          ${a.medicos.map(m => `
            pago a <span class="insp-analit-med">${esc(m.medico)}</span>:
            ${m.itens.map(i => `<strong class="insp-analit-papel">${esc(i.papel)}</strong> `
              + (i.glosa ? '<span class="insp-analit-glosa">glosa</span>'
                         : `<span class="insp-analit-val" data-ocultavel>R$ ${fmtN(i.valor)}</span>`)).join(' · ')}`).join(' ; ')}
        </div>`).join('');
    }

    function inspecionar(adm) {
      const alvo = $('insp-paineis');
      alvo.innerHTML = `<div class="insp-vazio">Consultando as bases…</div>`;
      setTimeout(() => {
        const qvis = buscarQvis(adm);
        const mesesQvis = [...new Set(qvis.map(l => l.mes_pagamento).filter(Boolean))];
        const prod = buscarProducao(adm);
        // V810: o que está no bloco 2 já passou pelo motor principal — é LEI.
        // O cartão passa a julgar por ele, igual à extração (antes ele
        // reconstruía a matriz auditada por conta própria e podia divergir do
        // painel logo abaixo, na mesma tela).
        const consolidado = buscarConsolidado(adm, mesesQvis);
        const dg = diagnosticar(qvis, consolidado.map(r => ({
          competencia: r.competencia,
          _manual: /complement|avuls/i.test(String(r.linha.status || '')),
          linha: {
            admissao: r.linha.admissao, paciente: r.linha.paciente,
            data_admissao: r.linha.data, procedimento: r.linha.descricao,
            _status: /glosa/i.test(String(r.linha.status || '')) ? 'glosa' : 'casou',
            _repasse: Number(r.linha.valor) || 0,
            _medicoNome: r.linha.profissional, nome_profissional: r.linha.profissional,
            _papelNome: r.linha.papel, papel: r.linha.papel,
            modulo: r.linha.modulo, origem: r.linha.origem, convenio: r.linha.convenio,
            _statusCons: r.linha.status, _moduloCons: r.linha.modulo,
          },
        })), prod, adm);
        const totQvis = qvis.reduce((s, l) => s + (Number(l.repassado) || 0), 0);
        // V791: o bloco 2 mostra o CONSOLIDADO do módulo Relatórios
        const totCons = consolidado.reduce((s, r) => s + valorConsolidado(r.linha), 0);
        const totProd = prod.reduce((s, l) => s + (Number(l.valor) || 0), 0);
        alvo.innerHTML = `
          <div class="insp-diag insp-diag-${dg.tom}" id="insp-diag">
            <button class="insp-diag-retrair" id="insp-diag-retrair"
                    title="Recolher as informações do pagamento">▾</button>
            <strong>${esc(dg.titulo)}</strong>
            <span>${dg.texto}</span>
            ${(dg.alertas || []).length ? `
              <div class="insp-alertas">
                ${dg.alertas.map(a => `<div class="insp-alerta-l">⚠ ${esc(a)}</div>`).join('')}
              </div>` : ''}
            ${(dg.analitico && dg.analitico.length) ? `
              <div class="insp-analit">${linhasAnalit(dg.analitico)}</div>` : ''}
            ${(dg.complementos || []).map(c => `
              <div class="insp-analit insp-compl">
                <div class="insp-compl-tit">Contém pagamento complementar (${esc(c.competencia)})
                  — <span data-ocultavel>R$ ${fmtN(c.total)}</span></div>
                ${linhasAnalit(c.analitico)}
              </div>`).join('')}
            ${(dg.naoPago && dg.naoPago.length) ? `
              <div class="insp-diverg">
                <strong>⚠ Com regra de repasse e NÃO pago nesta admissão:</strong>
                ${dg.naoPago.map(n => `
                  <div class="insp-diverg-l">
                    ${n.n > 1 ? `<span class="insp-analit-qtd">x${n.n}</span> ` : ''}
                    <span class="insp-analit-proc">${esc(n.proc)}</span> —
                    <span class="insp-analit-med">${esc(n.medico)}</span>:
                    <strong class="insp-diverg-papel">${esc(n.papel)}</strong>
                    <span class="insp-diverg-val">R$ ${fmtN(n.valor)}</span>
                  </div>`).join('')}
              </div>` : ''}
          </div>

          <section class="insp-painel">
            <div class="insp-painel-head">
              <span class="insp-num">1</span>
              <div><strong>Base padrão</strong><small>como o repasse chega do módulo Importação</small></div>
              <span class="insp-tot">${qvis.length} linha${qvis.length !== 1 ? 's' : ''} · repassado R$ ${fmtN(totQvis)}</span>
            </div>
            ${qvis.length ? tabela(qvis, COLS_QVIS) : vazio('Esta admissão não veio no relatório de repasse (QVIS).')}
          </section>

          <section class="insp-painel">
            <div class="insp-painel-head">
              <span class="insp-num">2</span>
              <div><strong>Consolidado</strong><small>Relatórios › Consolidado, todas as competências</small></div>
              <span class="insp-tot">${consolidado.length} linha${consolidado.length !== 1 ? 's' : ''} · total R$ ${fmtN(totCons)}</span>
            </div>
            ${consolidado.length ? tabela(consolidado, COLS_REP) : vazio('Esta admissão não está no Consolidado de nenhuma competência.')}
          </section>

          <section class="insp-painel">
            <div class="insp-painel-head">
              <span class="insp-num">3</span>
              <div><strong>Produção analítica</strong><small>relatório de produção importado</small></div>
              <span class="insp-tot">${prod.length} linha${prod.length !== 1 ? 's' : ''} · R$ ${fmtN(totProd)}</span>
            </div>
            ${prod.length ? tabela(prod, colunasProducao(prod)) : vazio('Esta admissão não está na produção importada.')}
          </section>`;
        Utilidades.aplicarMascaraValores?.();
        // V788: o card do pagamento recolhe/expande (estado lembrado)
        const btDiag = $('insp-diag-retrair'), diag = $('insp-diag');
        if (btDiag && diag) {
          const DIAG_KEY = 'insp_diag_recolhido_v1';
          const aplicarDiag = (rec) => {
            diag.classList.toggle('recolhido', rec);
            btDiag.textContent = rec ? '▸' : '▾';
            btDiag.title = rec ? 'Mostrar as informações do pagamento' : 'Recolher as informações do pagamento';
            try { localStorage.setItem(DIAG_KEY, rec ? '1' : '0'); } catch (e) {}
          };
          btDiag.addEventListener('click', () => aplicarDiag(!diag.classList.contains('recolhido')));
          try { aplicarDiag(localStorage.getItem(DIAG_KEY) === '1'); } catch (e) {}
        }
        // V751: esteira HORIZONTAL — diagnóstico e os 3 blocos entram
        // deslizando da lateral, um após o outro, a cada admissão carregada.
        esteira('#insp-paineis > .insp-diag, #insp-paineis > .insp-painel', { passo: 95 });
      }, 16);
    }

    setTimeout(() => admEl.focus(), 60);
  }

  const CSS = `
    .insp-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(20, 51, 82, 0.35);
      display: flex; align-items: center; justify-content: center;
    }
    .insp-tela {
      background: var(--bg-elevated, #FFF);
      border: 1px solid var(--border, #dfe4ea);
      border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.18);
      width: min(1920px, 99vw); height: 97vh;   /* V944: tela maior (pedido do usuário) */
      display: flex; flex-direction: column; overflow: hidden;
    }
    /* V750: cabeçalho e filtros comprimidos — a tela é pro conteúdo */
    .insp-head {
      display: flex; align-items: center; justify-content: space-between; gap: 14px;
      padding: 8px 18px; border-bottom: 1px solid var(--border, #dfe4ea);
    }
    .insp-head > div { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
    .insp-head h3 { margin: 0; font-size: 14.5px; color: #0f1d2e; white-space: nowrap; }
    .insp-head p {
      margin: 0; font-size: 10.5px; color: var(--ink-soft, #5a6879);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .insp-x {
      border: none; background: none; font-size: 22px; line-height: 1;
      color: var(--ink-soft, #5a6879); cursor: pointer; padding: 0 4px;
    }
    .insp-x:hover { color: #0f1d2e; }
    .insp-head-acoes { display: flex; align-items: center; gap: 8px; }
    .insp-head-acoes .insp-btn.ativo {
      background: #1d4470; border-color: #1d4470; color: #fff;
    }

    /* Fileira de filtros no padrão 20C (mesmo visual de LIO/OPME) */
    .insp-filtros { padding: 6px 18px; border-bottom: 1px solid var(--border, #dfe4ea); background: var(--bg-sunken, #F6F9FB); }
    .insp-sb {
      display: flex; align-items: stretch; flex-wrap: wrap;
      padding: 6px; background: #fff;
      border: 1px solid #e4ecf4; border-radius: 12px;
      box-shadow: 0 1px 2px rgba(20, 51, 82,.04), 0 10px 26px -20px rgba(20, 51, 82,.26);
    }
    .insp-sb-celwrap { position: relative; min-width: 150px; display: flex; }
    .insp-sb-celwrap:not(:last-of-type) .insp-sb-cel { border-right: 1px solid #f0f4f8; }
    .insp-sb-cel {
      flex: 1; min-width: 0;
      display: flex; align-items: center; gap: 9px;
      padding: 7px 12px; border: none; border-radius: 9px;   /* V750: um pouco mais baixo */
      background: transparent; font-family: inherit; text-align: left;
      transition: background-color 120ms;
    }
    .insp-sb-cel:hover, .insp-sb-cel.ativo, .insp-sb-cel:focus-within { background: #f6f4ef; }
    .insp-sb-tile {
      width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: #f0f5f9; color: #5a6879;
    }
    .insp-sb-cel.ativo .insp-sb-tile, .insp-sb-cel:focus-within .insp-sb-tile { background: #e4ecf4; color: #1d4470; }
    .insp-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
    .insp-sb-rot {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .09em; color: #5a6879; white-space: nowrap;
    }
    .insp-sb-inp {
      font-size: 13px; font-weight: 500; color: #5a6879;
      border: none; background: transparent; padding: 0; font-family: inherit;
      width: 100%; min-width: 0;
    }
    .insp-sb-inp:focus { outline: none; }
    .insp-sb-inp::placeholder { color: #9fb0bf; font-weight: 400; }
    .insp-sb-cel.ativo .insp-sb-inp { font-weight: 700; color: #12304f; }
    .insp-sb-inp:disabled { color: #a9b7c2; cursor: not-allowed; }
    .insp-sb-acoes { display: flex; align-items: center; gap: 6px; padding-left: 8px; margin-left: auto; }
    .insp-btn {
      padding: 8px 14px; border: 1px solid var(--border, #dfe4ea); border-radius: 8px;
      background: #FFF; color: var(--ink, #222);
      font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
    }
    .insp-btn:hover { background: var(--bg-sunken, #F5F5F5); }
    .insp-btn-primary { background: #1d4470; border-color: #1d4470; color: #FFF; display: inline-flex; align-items: center; gap: 6px; }
    .insp-btn-primary:hover { background: #0C6A93; }

    .insp-corpo { flex: 1; display: flex; min-height: 0; }
    .insp-paineis { flex: 1; overflow: auto; padding: 10px 18px 14px; display: flex; flex-direction: column; gap: 10px; }
    .insp-vazio {
      padding: 26px; text-align: center; color: var(--ink-faint, #8A968F);
      font-size: 12.5px; font-style: italic;
      background: var(--bg-sunken, #F6F9FB); border-radius: 10px;
    }

    .insp-diag {
      display: flex; flex-direction: column; gap: 3px;
      padding: 9px 14px; border-radius: 10px; font-size: 12px;
      border-left: 5px solid #1d4470; background: #e4ecf4; color: #0f1d2e;
      position: relative;
    }
    .insp-diag strong { font-size: 13px; }
    /* V788: o card do pagamento também recolhe — fica só o título */
    .insp-diag-retrair {
      position: absolute; top: 6px; right: 8px; width: 22px; height: 22px;
      border: none; background: rgba(255,255,255,.6); color: #0f1d2e;
      border-radius: 7px; cursor: pointer; font-size: 12px; line-height: 1; padding: 0;
    }
    .insp-diag-retrair:hover { background: #FFF; }
    .insp-diag.recolhido > *:not(strong):not(.insp-diag-retrair) { display: none; }
    .insp-diag.recolhido { padding-bottom: 8px; }
    /* V752: descrição analítica do pagamento — por procedimento e médico */
    .insp-analit { display: flex; flex-direction: column; gap: 3px; margin-top: 6px; }
    .insp-analit-l {
      font-size: 10.5px; line-height: 1.5; color: #0f1d2e;
      padding: 4px 9px; border-radius: 7px;
      background: rgba(255,255,255,.75); border: 1px solid rgba(15, 29, 46,.12);
    }
    .insp-analit-proc { font-weight: 800; }
    .insp-analit-med { font-weight: 700; }
    .insp-analit-papel { font-weight: 800; color: #0f1d2e; }
    .insp-analit-qtd {
      font-weight: 800; color: #1d4470; font-family: var(--mono, monospace);
      font-size: 10px; background: #e4ecf4; border-radius: 5px; padding: 1px 5px;
    }
    /* V760: divergência — tem regra e não foi pago (foco do relatório) */
    .insp-diverg {
      margin-top: 7px; padding: 6px 10px; border-radius: 8px;
      background: #F8ECEC; border-left: 4px solid #c0563f;
      display: flex; flex-direction: column; gap: 2px;
    }
    .insp-diverg > strong { font-size: 11px; color: #9B3A3A; }
    .insp-diverg-l { font-size: 10.5px; line-height: 1.5; color: #0f1d2e; }
    .insp-diverg-papel { color: #9B3A3A; font-weight: 800; }
    .insp-diverg-val { font-weight: 800; color: #9B3A3A; font-family: var(--mono, monospace); }
    .insp-analit-glosa { font-weight: 800; color: #C0392B; text-transform: uppercase; font-size: 10px; }
    /* V776: bloco do pagamento complementar (competência posterior) */
    .insp-compl { margin-top: 7px; padding-top: 6px; border-top: 1px dashed rgba(29, 68, 112,.45); }
    .insp-compl-tit { font-size: 11px; font-weight: 800; color: #1d4470; text-transform: uppercase; letter-spacing: .3px; }
    .insp-analit-val { font-weight: 800; color: #15a34a; font-family: var(--mono, monospace); }
    .insp-diag-ok    { border-left-color: #15a34a; background: #E8F6EE; }
    .insp-diag-aviso { border-left-color: #B8965A; background: #FBF3E3; }
    .insp-diag-etapa { border-left-color: #1d4470; background: #e4ecf4; }
    .insp-diag-nada  { border-left-color: #9B3A3A; background: #F8ECEC; }

    /* V751: esteira horizontal — entrada deslizando pelo eixo X */
    /* V756: a esteira entra na diagonal — desliza pela lateral E de baixo */
    @keyframes inspEsteira {
      from { opacity: 0; transform: translate3d(-34px, 16px, 0); }
      to   { opacity: 1; transform: translate3d(0, 0, 0); }
    }
    .insp-esteira {
      animation: inspEsteira 400ms cubic-bezier(0.22, 1, 0.36, 1) both;
      will-change: opacity, transform;
    }
    /* V752: pausada no estado inicial até o 1º paint — o relógio da animação
       não corre enquanto o navegador monta um bloco pesado */
    .insp-esteira-pausa { animation-play-state: paused; }
    @media (prefers-reduced-motion: reduce) { .insp-esteira { animation: none; } }

    /* V753: os blocos são itens flex — sem "flex: none" eles ENCOLHIAM para
       caber na altura do painel e, com overflow:hidden, a matriz aparecia
       cortada e o container nunca rolava até o fim da admissão. */
    .insp-paineis > .insp-diag, .insp-paineis > .insp-painel { flex: none; }
    .insp-painel { border: 1px solid var(--border, #dfe4ea); border-radius: 10px; overflow: hidden; }
    /* V748: faixa de título SLIM — título e subtítulo na MESMA linha, menos
       respiro vertical: o conteúdo das admissões é que tem de aparecer. */
    .insp-painel-head {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 12px; background: var(--bg-sunken, #F6F9FB);
      border-bottom: 1px solid var(--border, #dfe4ea);
      line-height: 1.25;
    }
    .insp-num {
      width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0;
      background: #1d4470; color: #FFF; font-size: 9.5px; font-weight: 800;
      display: flex; align-items: center; justify-content: center;
    }
    .insp-painel-head > div { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
    .insp-painel-head strong { font-size: 11.5px; color: #0f1d2e; white-space: nowrap; }
    .insp-painel-head small {
      font-size: 9.5px; color: var(--ink-soft, #5a6879);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .insp-tot { margin-left: auto; font-size: 10.5px; font-weight: 700; color: #1d4470; white-space: nowrap; }

    /* V753: SEM rolagem vertical própria — a matriz cresce até o fim da
       admissão e quem rola é o painel inteiro. Antes havia duas rolagens
       aninhadas e a de dentro não chegava ao fim das linhas. O eixo X segue
       rolando (a produção analítica tem muitas colunas). */
    .insp-tab-wrap { overflow-x: auto; overflow-y: hidden; max-height: none; }
    .insp-tab { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    .insp-tab th {
      position: sticky; top: 0; z-index: 1;
      background: #0f1d2e; color: #FFF; text-align: left;
      padding: 4px 9px; font-size: 9.5px; font-weight: 700;   /* V748: mais slim */
      text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap;
    }
    .insp-tab td { padding: 6px 10px; border-bottom: 1px solid var(--border, #EEF2F0); white-space: nowrap; }
    .insp-tab tbody tr:nth-child(even) td { background: #e4ecf4; }
    .insp-tab th.num, .insp-tab td.num { text-align: right; }

    .insp-lateral {
      width: 290px; flex-shrink: 0; border-left: 1px solid var(--border, #dfe4ea);
      display: flex; flex-direction: column; background: var(--bg-sunken, #F6F9FB);
      position: relative; transition: width .22s ease;
    }
    /* V787: lateral retrátil — recolhida, sobra só a aba com a seta */
    .insp-lateral.recolhida { width: 26px; overflow: hidden; }
    .insp-lateral.recolhida > *:not(.insp-lat-retrair) { display: none; }
    .insp-lat-retrair {
      position: absolute; top: 8px; left: -1px; width: 24px; height: 26px;
      border: 1px solid var(--border, #dfe4ea); border-left: none;
      border-radius: 0 8px 8px 0; background: #FFF; color: #0f1d2e;
      font-size: 15px; line-height: 1; cursor: pointer; z-index: 2; padding: 0;
    }
    .insp-lat-retrair:hover { background: #eef6fa; }
    .insp-lateral.recolhida .insp-lat-retrair {
      position: static; width: 26px; height: 100%; border: none; border-radius: 0;
      background: var(--bg-sunken, #F6F9FB); writing-mode: vertical-rl;
    }
    .insp-lateral:not(.recolhida) .insp-lat-head { padding-left: 34px; }
    .insp-lat-head { padding: 12px 14px 6px; }
    .insp-lat-head strong { font-size: 12px; color: #0f1d2e; display: block; }
    .insp-lat-head small { font-size: 10px; color: var(--ink-soft, #5a6879); }
    /* V756: os três botões com o MESMO tamanho, mais compactos */
    .insp-lat-acoes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; padding: 4px 12px 8px; }
    /* V778: pré-lista de produtos → coluna extra na extração */
    .insp-prod-bloco { padding: 0 12px 8px; }
    .insp-prod-toggle { width: 100%; text-align: left; }
    .insp-prod-toggle #insp-prod-badge { color: #1d4470; font-weight: 800; }
    .insp-prod-painel { margin-top: 6px; border: 1px solid #d3dfe8; border-radius: 10px; background: #fff; overflow: hidden; }
    .insp-prod-filtro {
      width: 100%; border: none; border-bottom: 1px solid #e4ecf4; padding: 7px 10px;
      font-size: 12px; outline: none; box-sizing: border-box; background: #f6fafc;
    }
    .insp-prod-lista { max-height: 190px; overflow-y: auto; }
    .insp-prod-item {
      display: flex; align-items: center; gap: 7px; padding: 5px 10px; cursor: pointer;
      font-size: 11.5px; line-height: 1.3; border-bottom: 1px solid #eef4f8;
    }
    .insp-prod-item:hover { background: #eef6fa; }
    .insp-prod-item input { flex: none; accent-color: #1d4470; }
    .insp-prod-nome { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .insp-prod-n { flex: none; font-size: 10px; color: #7C93A3; font-weight: 700; }
    .insp-prod-vazio { padding: 12px 10px; font-size: 11.5px; color: #7C93A3; text-align: center; }
    /* V784: vigias (produto → papel exigido) + alertas no card */
    .insp-vig-lista { border-bottom: 1px solid #e4ecf4; }
    .insp-vig-item {
      display: flex; align-items: flex-start; gap: 5px; padding: 6px 8px;
      font-size: 11px; border-bottom: 1px solid #eef4f8;
    }
    /* V785: nome QUEBRA a linha em vez de cortar com "…" */
    .insp-vig-prod { flex: 1; min-width: 0; font-weight: 600; line-height: 1.35; white-space: normal; word-break: break-word; }
    .insp-vig-grafias { display: block; font-weight: 500; font-size: 10px; color: #7C93A3; font-style: italic; }
    .insp-vig-papel { flex: none; color: #9B3A3A; font-weight: 800; font-size: 10px; white-space: nowrap; }
    /* V785: bloco "mais de um" — tudo dentro, abre ao clicar */
    .insp-vig-mais {
      width: 100%; border: none; background: #eef6fa; cursor: pointer;
      padding: 6px 9px; font-size: 11.5px; font-weight: 700; color: #0f1d2e; text-align: left;
    }
    .insp-vig-mais:hover { background: #e2eff6; }
    .insp-vig-dentro { max-height: 200px; overflow-y: auto; }
    .insp-vig-x { flex: none; border: none; background: none; color: #9B3A3A; cursor: pointer; padding: 0 2px; font-size: 12px; }
    .insp-vig-x:hover { color: #6E2828; }
    /* V786: a lista NÃO é flex — como item flex, cada botão encolhia para
       caber na altura máxima e o texto saía cortado ao meio ("corrompido").
       Container em bloco + botão de largura total: cada linha guarda a sua
       altura e a lista rola. */
    .insp-vig-prods { max-height: 150px; overflow-y: auto; display: block; }
    .insp-vig-op {
      display: block; width: 100%; box-sizing: border-box; flex: none;
      border: none; background: none; text-align: left; cursor: pointer;
      padding: 5px 9px; font-size: 11px; line-height: 1.5; min-height: 24px;
      border-bottom: 1px solid #eef4f8;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .insp-vig-op:hover { background: #eef6fa; }
    .insp-vig-op.sel { background: #1d4470; color: #fff; font-weight: 700; }
    .insp-vig-linha { display: flex; gap: 5px; padding: 6px 8px; align-items: center; }
    .insp-vig-select { flex: 1; font-size: 11px; padding: 4px 6px; border: 1px solid #d3dfe8; border-radius: 7px; min-width: 0; }
    /* V788: só o TEXTO em vermelho — sem caixa nem borda, para não poluir a
       paleta do card verde (pedido do usuário). */
    .insp-alertas { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
    .insp-alerta-l { font-size: 12px; font-weight: 700; color: #9B3A3A; line-height: 1.4; }
    .insp-btn-mini {
      padding: 5px 6px; font-size: 10.5px; font-weight: 700;
      text-align: center; line-height: 1.3; cursor: pointer;
    }
    .insp-lat-lista { flex: 1; overflow: auto; padding: 0 10px 12px; display: flex; flex-direction: column; gap: 5px; }
    .insp-lat-vazio {
      padding: 18px 12px; text-align: center; font-size: 11px; font-style: italic;
      color: var(--ink-faint, #8A968F);
    }
    .insp-lat-item, .insp-cand {
      display: grid; grid-template-columns: auto 1fr auto; gap: 4px 8px;
      align-items: center; text-align: left; width: 100%;
      padding: 7px 10px; border: 1px solid var(--border, #dfe4ea); border-radius: 8px;
      background: #FFF; cursor: pointer; font-family: inherit;
    }
    .insp-lat-item:hover, .insp-cand:hover { background: #e4ecf4; border-color: #1d4470; }
    .insp-lat-item.ativo { background: #e4ecf4; border-color: #1d4470; }
    /* V758: convênio ainda não pagou → vermelho do card de GLOSA da Visão
       Geral (linha #c0563f, texto #9B3A3A) */
    .insp-lat-item.insp-lat-pendente { border-color: #c0563f; border-left-width: 4px; background: #F8ECEC; }
    .insp-lat-item.insp-lat-pendente .insp-lat-pac { color: #9B3A3A; font-weight: 700; }
    .insp-lat-item.insp-lat-pendente .insp-lat-adm { color: #9B3A3A; }
    .insp-lat-adm { font-size: 11.5px; font-weight: 800; color: #1d4470; font-family: var(--mono, monospace); }
    .insp-lat-pac { font-size: 11px; color: var(--ink, #222); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .insp-lat-data { font-size: 10.5px; color: var(--ink-soft, #5a6879); white-space: nowrap; }

    .insp-cands { display: flex; flex-direction: column; gap: 6px; }
    .insp-cands-tit { font-size: 12.5px; color: #0f1d2e; margin-bottom: 4px; }
    .insp-cand { grid-template-columns: auto auto auto 1fr; }
    /* V748: procedimento principal (produção analítica) diferencia admissões
       do mesmo paciente no mesmo dia */
    .insp-cand-proc {
      font-size: 10.5px; color: #1d4470; font-weight: 600;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
  `;

  // V870: as réguas de "é o mesmo procedimento?" entram no _interno para poder
  // ser conferidas par a par pelo teste de regressão (é onde mora o defeito da
  // nomenclatura; conferir só pela extração esconde qual das três falhou).
  window.AtlasInspecao = { abrir, _interno: { normAdm, normNome, normData, casarNaProducao, diagnosticar,
    lerPlanilha, buscarQvis, buscarRepasse, buscarProducao, buscarAdmissoesPorPaciente,
    mesmoProduto, mesmoExame, mesmoConteudo,
    // V871: o repasse faltante e a resolução de versão por data de admissão
    repasseFaltanteDe, versaoDaAdmissao,
    // V876: a poda das competências pela lista do Consolidado
    competenciasDaAdmissao, buscarConsolidado,
    // V880: a frase da linha particular
    situacaoDe } };
})();
