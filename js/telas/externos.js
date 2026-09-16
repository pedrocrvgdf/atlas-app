/**
 * MÓDULO EXTERNOS (V699) — repasse de médicos externos e híbridos.
 *
 * Fluxo: o espaço verde envia SÓ as admissões → a tela "Importar Admissões"
 * lê a planilha (estrutura livre — a leitura é inteligente) → a Matriz cruza
 * cada admissão com as linhas da PRODUÇÃO e calcula o repasse pelas regras
 * da Base de Cálculo:
 *
 *   FAT TOTAL  = soma do PRODUZIDO das linhas da admissão
 *   deduções   = OPME + custo da LIO + imposto (10% do FAT) + MAT/MED
 *   líquido    = FAT − deduções
 *   indicação  = líquido × 20% (ou 18% quando a LIO é valor ATLAS — ajuste por admissão)
 *   HM         = da base de cálculo, SÓ para médico EXTERNO (híbrido recebe na folha interna)
 *   REPASSE    = indicação + HM
 *
 * Identificação da LIO (regra do processo): procura a linha da produção cujo
 * VALOR bate com o custo de alguma LIO da base; se nenhuma bater, cruza pelo
 * NOME mais próximo (similaridade).
 *
 * Telas: 'externos' (Matriz Externa) · 'externos-importar' · 'externos-base'.
 * O modo Externo (switch ao lado da marca ATLAS) troca o layout — app.js/style.css.
 */
(function () {
  'use strict';

  const U = () => window.Utilidades;

  // ════════════════════════════════════════════════════════════════════════
  // NÚCLEO — base de cálculo + análise de admissões (window.AtlasExternos)
  // ════════════════════════════════════════════════════════════════════════

  let _cacheBase = null;
  let _cacheVersaoBase = -1;

  // V828: colunas novas em bancos que já existiam (schema.js só cria tabela nova)
  //  - proc_planilha: nomenclatura do procedimento como veio na planilha importada
  //  - medico_escolhido_id: médico escolhido no seletor da CLÍNICA (vale só
  //    para aquela admissão)
  let _colunasOk = false;
  function garantirColunas() {
    if (_colunasOk || !window.Banco || !Banco.db) return;
    for (const col of ['proc_planilha TEXT', 'medico_escolhido_id INTEGER', 'lio_tipo TEXT']) {
      try { Banco.db.exec(`ALTER TABLE externos_admissoes ADD COLUMN ${col}`); }
      catch (e) { /* coluna já existe */ }
    }
    _colunasOk = true;
  }

  function base() {
    garantirColunas();
    if (_cacheBase && _cacheVersaoBase === Banco._versao) return _cacheBase;
    const cfg = {};
    Banco.query(`SELECT chave, valor FROM externos_config`).forEach(r => { cfg[r.chave] = parseFloat(r.valor); });
    _cacheBase = {
      cfg: {
        imposto:   isFinite(cfg.IMPOSTO_PCT)           ? cfg.IMPOSTO_PCT           : 10,
        indicacao: isFinite(cfg.INDICACAO_PCT)         ? cfg.INDICACAO_PCT         : 20,
        lioAtlas:    isFinite(cfg.INDICACAO_LIO_ATLAS_PCT) ? cfg.INDICACAO_LIO_ATLAS_PCT : 18,
      },
      procs: Banco.query(`SELECT * FROM externos_base_proc WHERE ativo = 1 ORDER BY nome`),
      lios:  Banco.query(`SELECT * FROM externos_base_lio  WHERE ativo = 1 ORDER BY custo DESC`),
      opmes: Banco.query(`SELECT * FROM externos_base_opme WHERE ativo = 1 ORDER BY custo DESC`),
    };
    _cacheVersaoBase = Banco._versao;
    return _cacheBase;
  }

  // médicos por nome normalizado (cadastro + sinônimos) — cache por versão
  let _cacheMed = null;
  let _cacheVersaoMed = -1;
  function mapaMedicos() {
    if (_cacheMed && _cacheVersaoMed === Banco._versao) return _cacheMed;
    const m = new Map();
    Banco.query(`SELECT m.*, c.nome AS clinica_nome, c.cnpj AS clinica_cnpj
                   FROM medicos m LEFT JOIN externos_clinicas c ON c.id = m.clinica_externa_id
                  WHERE m.ativo = 1`)
      .forEach(r => m.set(r.nome_normalizado, r));
    Banco.query(`SELECT s.grafia, m.nome_normalizado FROM sinonimos_medico s
                   JOIN medicos m ON m.id = s.medico_id AND m.ativo = 1`)
      .forEach(r => {
        const alvo = m.get(r.nome_normalizado);
        if (alvo) m.set(U().normalizar(r.grafia), alvo);
      });
    _cacheMed = m;
    _cacheVersaoMed = Banco._versao;
    return m;
  }

  /**
   * V828: clínicas por nome normalizado E por CNPJ (só dígitos), cada uma com
   * os médicos vinculados (medicos.clinica_externa_id). A coluna "médico" da
   * produção às vezes traz a CLÍNICA (o CNPJ da empresa do médico) — é por
   * aqui que a Matriz a reconhece.
   */
  let _cacheClin = null;
  let _cacheVersaoClin = -1;
  function mapaClinicas() {
    if (_cacheClin && _cacheVersaoClin === Banco._versao) return _cacheClin;
    const porChave = new Map();
    const clinicas = Banco.query(`SELECT * FROM externos_clinicas WHERE ativo = 1`);
    const meds = Banco.query(`SELECT * FROM medicos WHERE ativo = 1 AND clinica_externa_id IS NOT NULL`);
    for (const c of clinicas) {
      const item = { clinica: c, medicos: meds.filter(m => m.clinica_externa_id === c.id) };
      if (c.nome) porChave.set(U().normalizar(c.nome), item);
      const dig = String(c.cnpj || '').replace(/\D/g, '');
      if (dig.length >= 8) porChave.set('cnpj:' + dig, item);
    }
    _cacheClin = porChave;
    _cacheVersaoClin = Banco._versao;
    return porChave;
  }
  function clinicaDoNome(nome) {
    const mapa = mapaClinicas();
    const direto = mapa.get(U().normalizar(nome));
    if (direto) return direto;
    const dig = String(nome || '').replace(/\D/g, '');
    return dig.length >= 8 ? (mapa.get('cnpj:' + dig) || null) : null;
  }

  // Detecção do procedimento-base (MAT/MED + HM) pelos textos das linhas.
  // A ordem importa: combinações primeiro; FACO vence ISTENT/PRESERFLO
  // (no manual, FACO+ISTENT usa MAT/MED e HM de FACO).
  const REGRAS_PROC = [
    { re: /PURE SEE/,                               nome: 'LENTE PURE SEE' },
    { re: /FACO.*(VITRECT|VITRE\b)|VITRECT.*FACO/, nome: 'FACO + VITRECTOMIA' },
    { re: /FACO/,                                   nome: 'FACO' },
    { re: /PRESERFLO|AHMED|XEN|ANTIGLAUCOM|TRABECULECT|IPRISM|ISTENT/, nome: 'ANTIGLAUCOMATOSA' },
    { re: /VITRECT|VITRE\b/,                        nome: 'VITRECTOMIA' },
    { re: /PARACENTESE/,                            nome: 'PARACENTESE' },
    { re: /PTERIGIO/,                               nome: 'PTERIGIO' },
    { re: /CICLOFOTO/,                              nome: 'CICLOFOTOCOAGULACAO' },
    { re: /EYLIA|AFLIBERCEPT/,                      nome: 'EYLIA' },
    { re: /LUCENTIS|RANIBIZUMAB/,                   nome: 'LUCENTIS' },
    { re: /OZURDEX/,                                nome: 'OZURDEX' },
    { re: /YAG|LASER|FOTOCOAGUL/,                   nome: 'LASER' },
    { re: /PRK|PTK/,                                nome: 'PRK' },
    { re: /PTOSE/,                                  nome: 'PTOSE' },
    { re: /ESTRABISMO/,                             nome: 'ESTRABISMO' },
    { re: /ECTROPIO/,                               nome: 'ECTROPIO' },
    { re: /TRIQUIASE/,                              nome: 'TRIQUIASE' },
    { re: /SUTURA.*CONJUNTIVA/,                     nome: 'SUTURA DE CONJUNTIVA' },
    { re: /RECONSTRU.*PALPEBRA/,                    nome: 'RECONSTRUCAO DE PALPEBRAS' },
    { re: /CANTOPLASTIA/,                           nome: 'CANTOPLASTIA' },
    { re: /AUTOTRANSPLANTE|BIOPSIA/,                nome: 'AUTOTRANSPLANTE + BIOPSIA' },
    { re: /EXERESE.*TUMOR/,                         nome: 'EXERESE DE TUMOR' },
    { re: /LESAO|TUMOR/,                            nome: 'LESAO OU TUMOR' },
    // V840: cirurgia de pálpebra SEM outra pista (correção etc.) usa a base de
    // reconstrução — DEPOIS das regras de tumor ("tumor de pálpebra" é tumor)
    { re: /PALPEBRA/,                               nome: 'RECONSTRUCAO DE PALPEBRAS' },
  ];

  function textoDaAdmissao(linhas) {
    return U().normalizar(linhas.map(l =>
      [l.procedimento_principal, l.produto, l.subcategoria, l.categoria, l.pacote].filter(Boolean).join(' ')
    ).join(' '));
  }

  function detectarProc(texto, procs) {
    for (const r of REGRAS_PROC) {
      if (r.re.test(texto)) {
        const p = procs.find(x => U().normalizar(x.nome) === U().normalizar(r.nome));
        if (p) return p;
      }
    }
    // fallback: nome de procedimento da base contido no texto
    for (const p of procs) {
      const n = U().normalizar(p.nome);
      if (n && texto.includes(n)) return p;
    }
    return null;
  }

  const EPS = 0.02;   // tolerância pro "bate com o valor"

  /**
   * Analisa UMA admissão importada contra a PRODUÇÃO. Retorna o dossiê
   * completo (linhas, deduções, repasse, avisos) — a Matriz só apresenta.
   */
  function analisar(adm) {
    const b = base();
    const linhas = Banco.query(
      `SELECT * FROM linhas_producao WHERE cod_admissao = ? ORDER BY id`, [String(adm.cod_admissao)]
    );
    const d = {
      adm, cod: adm.cod_admissao, linhas,
      fat: 0, medicoNome: '', medico: null, tipo: null,
      lio: null,          // { linhaId, nome, custo, por: 'valor' | 'nome' }
      opme: 0, opmeLinhas: [],
      proc: null, ao: false,
      // V840: padrão composto, lateralidade, marcação da LIO e HM pelo cirurgião
      lado: '', padrao: '', ehExames: false,
      lioTipo: null, lioSugestao: null, lioEfetivo: null, lioDeduzido: 0,
      cirurgiao: '', operou: null,   // null = a produção não informa o cirurgião
      imposto: 0, matmed: 0, liquido: 0, pct: 0, indicacao: 0, hm: 0, hmDeduzido: 0, repasse: 0,
      avisos: [],
    };
    if (!linhas.length) {
      d.avisos.push('Admissão não encontrada na PRODUÇÃO — importe a produção do mês correspondente.');
      return d;
    }

    d.fat = linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);

    // médico responsável: coluna "Médico Externo" da produção; senão os papéis.
    // V831: em muitos relatórios a coluna "Médico Externo" é um FLAG (SIM/NÃO),
    // não um nome — o motor lia "NÃO" como se fosse o médico e nunca chegava ao
    // nome verdadeiro nos outros campos. Valor com cara de flag/placeholder é
    // pulado e a busca segue para o próximo campo.
    const ehNomeValido = (v) => {
      const n = U().normalizar(v);
      if (!n || n.length < 4) return false;
      if (['SIM', 'NAO', 'NA', 'N/A', 'X', 'NULL', 'NENHUM', 'TRUE', 'FALSE'].includes(n)) return false;
      if (/^[\d\s.,/-]+$/.test(n)) return false;   // só números/pontuação
      return true;
    };
    for (const campo of ['medico_externo', 'solicitante', 'indicante', 'cirurgiao', 'medico']) {
      const v = linhas.map(l => l[campo])
        .find(x => x && String(x).trim() && ehNomeValido(String(x).trim()));
      if (v) { d.medicoNome = String(v).trim(); break; }
    }
    /**
     * V828: resolução do MÉDICO da admissão, nesta ordem:
     *  1. escolha manual gravada NA admissão (seletor da clínica — vale só
     *     para ela);
     *  2. cadastro + DE-PARA (módulo MÉDICOS e sinônimos) — direto, sem
     *     depender de conciliação em Médicos & Clínicas;
     *  3. o nome é uma CLÍNICA (nome ou CNPJ): um médico vinculado resolve
     *     sozinho; mais de um pede escolha; nenhum avisa;
     *  4. desconhecido: a Matriz oferece cadastrar o médico novo ali mesmo.
     */
    if (d.medicoNome) {
      if (adm.medico_escolhido_id) {
        d.medico = Banco.queryUnica(
          `SELECT m.*, c.nome AS clinica_nome, c.cnpj AS clinica_cnpj
             FROM medicos m LEFT JOIN externos_clinicas c ON c.id = m.clinica_externa_id
            WHERE m.id = ? AND m.ativo = 1`, [adm.medico_escolhido_id]) || null;
        if (d.medico) d.medicoViaEscolha = true;
      }
      if (!d.medico) d.medico = mapaMedicos().get(U().normalizar(d.medicoNome)) || null;
      if (!d.medico) {
        const clin = clinicaDoNome(d.medicoNome);
        if (clin) {
          d.clinica = clin;
          if (clin.medicos.length === 1) {
            const m = clin.medicos[0];
            d.medico = { ...m, clinica_nome: clin.clinica.nome, clinica_cnpj: clin.clinica.cnpj };
            d.medicoViaClinica = true;
          } else if (clin.medicos.length > 1) {
            d.avisos.push(`"${clin.clinica.nome}" é uma clínica com ${clin.medicos.length} médicos — escolha o médico desta admissão.`);
          } else {
            d.avisos.push(`"${clin.clinica.nome}" é uma clínica sem médicos vinculados — vincule-os em Médicos & Clínicas.`);
          }
        } else {
          d.medicoDesconhecido = true;
          d.avisos.push('Médico não encontrado no cadastro (MÉDICOS) — cadastre-o aqui mesmo ou confira grafia/sinônimos.');
        }
      }
      if (d.medico) {
        d.tipo = d.medico.tipo_vinculo || null;
        if (!d.tipo) d.avisos.push('Médico sem tipo de vínculo no cadastro — defina EXTERNO ou HÍBRIDO.');
      }
    } else {
      d.avisos.push('Nenhum médico identificado nas linhas da produção.');
    }

    // ── OPME: linhas classificadas como OPME (ou valor batendo na tabela de OPMEs)
    const usadas = new Set();
    for (const l of linhas) {
      const v = Number(l.valor) || 0;
      const ehClasse = /OPME/i.test(l.classificacao_produto || '');
      const bateValor = b.opmes.some(o => Math.abs(o.custo - v) <= EPS);
      if (ehClasse || (bateValor && v > 0)) {
        d.opme += v;
        d.opmeLinhas.push(l.id);
        usadas.add(l.id);
      }
    }

    // ── LIO: regra do processo — 1º valor exato contra a base de LIOs;
    //         senão, nome mais próximo (só quando o caso menciona LIO/lente)
    const texto = textoDaAdmissao(linhas);
    for (const l of linhas) {
      if (usadas.has(l.id)) continue;
      const v = Number(l.valor) || 0;
      if (!(v > 0)) continue;
      // V840: com DUAS lentes de mesmo custo na base (ex.: MA60AC e SA60AT,
      // ambas 95), o nome escrito na linha da produção desempata
      const candidatas = b.lios.filter(x => Math.abs(x.custo - v) <= EPS);
      if (candidatas.length) {
        const nomeLinha = U().normalizar([l.produto, l.procedimento_principal].filter(Boolean).join(' '));
        const lio = candidatas.find(x => nomeLinha.includes(U().normalizar(x.nome))) || candidatas[0];
        d.lio = { linhaId: l.id, nome: lio.nome, custo: v, por: 'valor' };
        usadas.add(l.id);
        break;
      }
    }
    if (!d.lio && /\bLIO\b|LENTE INTRA/.test(texto)) {
      let melhor = null;
      for (const l of linhas) {
        if (usadas.has(l.id)) continue;
        const nomeLinha = U().normalizar([l.produto, l.procedimento_principal].filter(Boolean).join(' '));
        if (!nomeLinha) continue;
        for (const x of b.lios) {
          const nx = U().normalizar(x.nome);
          const sim = nomeLinha.includes(nx) ? 1 : U().similaridade(nomeLinha, nx);
          if (sim >= 0.5 && (!melhor || sim > melhor.sim)) melhor = { linha: l, lio: x, sim };
        }
      }
      if (melhor) {
        d.lio = { linhaId: melhor.linha.id, nome: melhor.lio.nome, custo: melhor.lio.custo, por: 'nome' };
        usadas.add(melhor.linha.id);
        d.avisos.push(`LIO identificada pelo NOME mais próximo (${melhor.lio.nome}) — nenhum valor da produção bateu com a base.`);
      } else {
        d.avisos.push('O caso menciona LIO mas nenhuma linha bateu por valor nem por nome — confira a Base de Cálculo.');
      }
    }

    // ── procedimento-base (MAT/MED + HM) e LATERALIDADE (V840: OD/OE/AO do texto)
    d.proc = detectarProc(texto, b.procs);
    const temOD = /\bOD\b/.test(texto), temOE = /\bOE\b/.test(texto);
    d.lado = (/\bAO\b/.test(texto) || (temOD && temOE)) ? 'AO' : (temOD ? 'OD' : (temOE ? 'OE' : ''));
    d.ao = d.lado === 'AO';
    // V840: admissão SÓ de exames (nenhum procedimento cirúrgico) é um padrão
    // próprio — "EXAMES": FAT somado numa linha, sem MAT/MED e sem HM
    d.ehExames = !d.proc && !linhas.some(l =>
      /CIRURG/i.test([l.categoria, l.subcategoria, l.classificacao_produto].filter(Boolean).join(' ')));
    if (!d.proc && !d.ehExames) d.avisos.push('Procedimento-base não identificado — MAT/MED e HM ficaram zerados.');

    /**
     * V840: marcação da LIO — ATLAS × PARCERIA (manual; a ferramenta só SUGERE).
     *  PARCERIA: o custo da lente (da base, achada pelo produto) é DEDUZIDO e
     *  a indicação segue no percentual padrão;
     *  ATLAS: a lente NÃO é deduzida e a indicação cai para o percentual "LIO
     *  valor ATLAS" (18% na configuração padrão).
     * Sugestão: a linha bateu pelo VALOR da base (preço de parceria conhecido)
     * → PARCERIA; caso contrário → ATLAS.
     */
    if (d.lio) {
      d.lioSugestao = d.lio.por === 'valor' ? 'PARCERIA' : 'ATLAS';
      d.lioTipo = (adm.lio_tipo === 'PARCERIA' || adm.lio_tipo === 'ATLAS') ? adm.lio_tipo : null;
      d.lioEfetivo = d.lioTipo || d.lioSugestao;
      if (!d.lioTipo) d.avisos.push(`Admissão com LIO sem marcação — usando a sugestão (${d.lioEfetivo}); confirme ATLAS × PARCERIA nas contas da admissão.`);
    }

    /**
     * V840: HM pelo CIRURGIÃO da produção — o médico externo recebe o HM
     * quando ELE MESMO operou; cirurgião interno/outro → só a indicação.
     * Produção sem cirurgião informado mantém o HM (e o ajuste manual
     * "sem HM" continua valendo em qualquer caso).
     */
    const cirurgioes = [...new Set(linhas.map(l => String(l.cirurgiao || '').trim())
      .filter(x => x && ehNomeValido(x)))];
    d.cirurgiao = cirurgioes.join(' · ');
    if (cirurgioes.length && (d.medico || d.medicoNome)) {
      const mm = mapaMedicos();
      const nomesAlvo = new Set([d.medico && d.medico.nome_oficial, d.medicoNome]
        .filter(Boolean).map(x => U().normalizar(x)));
      d.operou = cirurgioes.some(c => {
        const n = U().normalizar(c);
        const m2 = mm.get(n);
        return (m2 && d.medico && m2.id === d.medico.id) || nomesAlvo.has(n);
      });
    }

    // ── contas (modelo manual das abas por médico)
    d.imposto = d.fat * b.cfg.imposto / 100;
    if (d.proc) {
      d.matmed = d.ao ? (d.proc.mat_med_ao != null ? d.proc.mat_med_ao : d.proc.mat_med * 2) : d.proc.mat_med;
    }
    /**
     * V828: o HM muda de lado conforme o vínculo —
     *  EXTERNO: recebe o HM (soma no repasse final, como sempre);
     *  HÍBRIDO: o HM entra nas DEDUÇÕES (ele recebe o HM na folha interna,
     *  então aqui o valor sai do líquido antes do percentual de indicação).
     * V840: e só existe HM quando o cirurgião da produção é o próprio médico
     * (d.operou === false zera; null = sem informação, mantém).
     */
    const hmBase = (d.proc && !adm.sem_hm && d.operou !== false)
      ? (d.ao ? (d.proc.hm_ao != null ? d.proc.hm_ao : d.proc.hm * 2) : d.proc.hm) : 0;
    d.hmDeduzido = d.tipo === 'HIBRIDO' ? hmBase : 0;
    d.lioDeduzido = (d.lio && d.lioEfetivo !== 'ATLAS') ? d.lio.custo : 0;
    d.liquido = d.fat - d.opme - d.lioDeduzido - d.imposto - d.matmed - d.hmDeduzido;
    d.pct = (adm.pct_indicacao != null && isFinite(adm.pct_indicacao)) ? adm.pct_indicacao
          : (d.lio && d.lioEfetivo === 'ATLAS') ? b.cfg.lioAtlas : b.cfg.indicacao;
    d.indicacao = d.liquido * d.pct / 100;
    if (d.tipo === 'EXTERNO') d.hm = hmBase;
    d.repasse = d.indicacao + d.hm;

    // ── V840: PADRÃO do procedimento (a DESCRIÇÃO das planilhas de repasse)
    d.padrao = montarPadrao(d, texto, b);
    return d;
  }

  /**
   * V840: PADRÃO composto do procedimento — a DESCRIÇÃO usada nas planilhas
   * de repasse (ex.: "FACO + ISTENT OD", "ANTIGLAUCOMATOSA COM PRESERFLO OD",
   * "FACO OD + LIO SA60AT", "FACO+VVPP OE", "EXAMES"). Raiz = procedimento da
   * base de cálculo com o rótulo do processo; complementos = OPMEs citados na
   * produção (mesmo sem valor deduzido); lateralidade OD/OE/AO extraída do
   * texto (fica de fora quando não dá para saber); LIO nomeada no fim.
   */
  function montarPadrao(d, texto, b) {
    if (!d.linhas.length) return '';
    if (!d.proc) return d.ehExames ? 'EXAMES' : '';
    let raiz = d.proc.nome;
    if (raiz === 'VITRECTOMIA') raiz = 'VVPP';
    else if (raiz === 'FACO + VITRECTOMIA') raiz = 'FACO+VVPP';
    else if (raiz === 'LASER') raiz = /ENDOLASER/.test(texto) ? 'ENDOLASER' : 'YAG';
    else if (raiz === 'LESAO OU TUMOR') raiz = 'RESSECÇÃO DE TUMOR';
    else if (raiz === 'RECONSTRUCAO DE PALPEBRAS') raiz = /RECONSTRU/.test(texto) ? 'RECONSTRUÇÃO DE PALPEBRA' : 'PALPEBRA';
    else if (raiz === 'PRK') raiz = /PTK/.test(texto) ? 'PTK' : 'PRK';
    let s = raiz;
    for (const o of b.opmes) {
      const n = U().normalizar(o.nome);
      if (n && texto.includes(n)) s += (raiz === 'ANTIGLAUCOMATOSA' ? ' COM ' : ' + ') + String(o.nome).toUpperCase();
    }
    if (d.lado) s += ' ' + d.lado;
    if (d.lio) s += ' + LIO ' + String(d.lio.nome).toUpperCase();
    return s;
  }

  function analisarTodas() {
    const adms = Banco.query(`SELECT * FROM externos_admissoes ORDER BY id`);
    return adms.map(a => analisar(a));
  }

  window.AtlasExternos = { base, analisar, analisarTodas,
    _limparCache() { _cacheBase = null; _cacheMed = null; _cacheClin = null; } };

  // ════════════════════════════════════════════════════════════════════════
  // ESTILOS
  // ════════════════════════════════════════════════════════════════════════

  const CSS = `
    .ext-vazio { text-align: center; padding: 48px 20px; color: var(--ink-faint); }
    .ext-vazio .ti { font-size: 40px; color: var(--accent); }
    .ext-filtros { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
    .ext-filtros .input { max-width: 320px; }
    .ext-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px; }

    .ext-medico { margin-bottom: 22px; }
    .ext-medico-cab { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
      background: var(--bg-sunken); border: 1px solid var(--border); border-radius: var(--radius-md) var(--radius-md) 0 0; }
    .ext-medico-cab .nome { font-weight: 700; font-size: 14px; color: var(--ink); }
    .ext-medico-cab .clinica { font-size: 11px; color: var(--ink-faint); }
    .ext-medico-cab .total { margin-left: auto; font-family: var(--font-mono); font-weight: 700; font-size: 14px; }

    .ext-tab { width: 100%; border-collapse: collapse; background: var(--bg-elevated);
      border: 1px solid var(--border); border-top: none; font-size: 12.5px; }
    .ext-tab th { background: var(--primary); color: #fff; padding: 7px 10px; text-align: left;
      font-size: 11px; font-weight: 600; letter-spacing: 0.03em; white-space: nowrap; }
    .ext-tab td { padding: 6px 10px; border-top: 1px solid var(--border); vertical-align: top; }
    .ext-tab td.num, .ext-tab th.num { text-align: right; font-family: var(--font-mono); white-space: nowrap; }
    .ext-tab tr.ext-linha-lio td { background: var(--accent-soft); }
    /* V840: marcação da LIO — ATLAS × PARCERIA */
    .ext-lio-btn { border: 1px solid var(--border); background: var(--bg); color: var(--ink-soft);
      border-radius: 999px; padding: 1px 9px; font-size: 10.5px; font-weight: 700; cursor: pointer; }
    .ext-lio-btn.on { background: var(--accent); border-color: var(--accent); color: #fff; }
    .ext-lio-btn.sugerida { border-style: dashed; border-color: var(--accent); color: var(--accent); }
    .ext-lio-btn:hover { filter: brightness(0.95); }
    .ext-tab tr.ext-linha-opme td { background: var(--warning-soft); }

    .ext-resumo td { background: var(--bg-sunken); font-size: 12px; border-top: 2px solid var(--border-strong); }
    .ext-resumo .contas { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
    .ext-resumo .parcela { white-space: nowrap; color: var(--ink-soft); }
    .ext-resumo .parcela b { font-family: var(--font-mono); color: var(--ink); font-weight: 600; }
    .ext-resumo .repasse-final { font-family: var(--font-mono); font-weight: 800; font-size: 14px; color: var(--primary); }

    .ext-chip { display: inline-flex; align-items: center; gap: 4px; border-radius: 99px;
      padding: 2px 9px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.02em; }
    .ext-chip-ext  { background: #DCE7ED; color: #33566B; }
    .ext-chip-hib  { background: var(--accent-soft); color: var(--primary); }
    .ext-chip-aguard { background: var(--warning-soft); color: #8A6420; }
    .ext-chip-pago { background: var(--success-soft); color: var(--success); }
    .ext-chip-aviso { background: var(--danger-soft); color: var(--danger); }

    .ext-acao { border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 6px;
      padding: 3px 8px; font-size: 11px; cursor: pointer; color: var(--ink-soft); font-family: inherit; }
    .ext-acao:hover { border-color: var(--primary); color: var(--primary); }
    .ext-avisos { margin: 4px 0 0; padding: 0; list-style: none; font-size: 11px; color: var(--danger); }

    /* filtros por coluna (princípio do Calcular Repasse) */
    .ext-fil-card { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end;
      background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 12px;
      padding: 12px 14px; margin-bottom: 14px; }
    .ext-fil-grupo { display: flex; flex-direction: column; gap: 4px; min-width: 150px; flex: 1; }
    .ext-fil-label { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); }
    .ext-fil-wrap { position: relative; display: flex; align-items: center; }
    .ext-fil-ic { position: absolute; left: 9px; font-size: 11px; opacity: .55; pointer-events: none; }
    .ext-fil-input { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 8px;
      padding: 7px 26px 7px 28px; font: inherit; font-size: 12.5px; background: var(--bg-elevated); color: var(--ink); }
    .ext-fil-input:focus { outline: none; border-color: var(--accent); }
    .ext-fil-wrap.ativo .ext-fil-input { border-color: var(--accent); background: var(--accent-soft); }
    .ext-fil-x { position: absolute; right: 6px; border: none; background: transparent; cursor: pointer;
      color: var(--ink-faint); font-size: 15px; line-height: 1; padding: 2px; }
    .ext-fil-x:hover { color: var(--danger); }
    .ext-fil-select { font-size: 12.5px; }
    .ext-total td { background: var(--bg-sunken); font-weight: 700; border-top: 2px solid var(--border-strong); }

    /* prévia e status da base (princípio do Importar QVIS) */
    .ext-preview { border-top: 1px dashed var(--border-strong); margin-top: 16px; }
    .ext-preview-grid { display: flex; gap: 12px; flex-wrap: wrap; }
    .ext-preview-item { flex: 1; min-width: 150px; background: var(--bg-sunken); border-radius: 10px;
      padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; }
    .ext-preview-item .vlr { font-family: var(--font-mono); font-size: 22px; font-weight: 700; color: var(--ink); }
    .ext-preview-item .rot { font-size: 11.5px; color: var(--ink-soft); }
    .ext-preview-item.atencao { background: var(--warning-soft); }
    .ext-origens { display: flex; flex-direction: column; gap: 8px; }
    .ext-origem-card { display: flex; align-items: center; gap: 12px; border: 1px solid var(--border);
      border-radius: 10px; padding: 10px 12px; }
    .ext-origem-info { flex: 1; min-width: 0; }
    .ext-origem-card .nome { font-size: 13px; font-weight: 600; color: var(--ink); }
    .ext-origem-card .meta { font-size: 11.5px; color: var(--ink-faint); margin-top: 2px; }

    /* importar */
    .ext-drop { border: 2px dashed var(--border-strong); border-radius: var(--radius-lg);
      padding: 36px 20px; text-align: center; color: var(--ink-faint); cursor: pointer;
      transition: border-color var(--t-fast), background var(--t-fast); }
    .ext-drop:hover, .ext-drop.arrastando { border-color: var(--accent); background: var(--accent-soft); }
    .ext-drop .ti { font-size: 34px; color: var(--accent); }

    /* visão geral do modo externo (V702/V704 — mesma estrutura da VG do ATLAS:
       linha do tempo → barra de filtros 12C → cards → 2 colunas → rankings) */
    .ext-vg-grid { display: grid; grid-template-columns: 1.25fr 1fr; gap: 16px; align-items: start; }
    @media (max-width: 1100px) { .ext-vg-grid { grid-template-columns: 1fr; } }
    .ext-vg-card h3 { margin: 0 0 10px; font-size: 14px; }
    .ext-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: stretch; margin-top: 16px; }
    @media (max-width: 1100px) { .ext-2col { grid-template-columns: 1fr; } }
    .ext-vg-bloco { margin-top: 16px; }

    /* barra de filtros no visual 12C da VG do ATLAS */
    .ext-sb-wrap { position: relative; z-index: 40; margin: 14px 0 16px; }
    .ext-sb { display: flex; align-items: stretch; background: var(--bg-elevated); border: 1px solid var(--border);
      border-radius: 14px; box-shadow: 0 1px 2px rgba(20,50,80,.05), 0 12px 30px -24px rgba(20,50,80,.25); }
    .ext-sb-div { width: 1px; background: var(--border); margin: 8px 0; }
    .ext-sb-celwrap { position: relative; display: flex; flex: 1; min-width: 0; }
    .ext-sb-cel { flex: 1; min-width: 0; display: flex; align-items: center; gap: 11px; padding: 10px 14px;
      background: transparent; border: none; cursor: pointer; font-family: inherit; text-align: left;
      border-radius: 14px; transition: background var(--t-fast); }
    .ext-sb-cel:hover, .ext-sb-cel.aberto, .ext-sb-cel.ativo { background: var(--primary-soft); }
    .ext-sb-tile { width: 30px; height: 30px; flex: none; border-radius: 8px; background: var(--bg-sunken);
      color: var(--ink-soft); display: flex; align-items: center; justify-content: center; font-size: 15px; }
    .ext-sb-cel.aberto .ext-sb-tile, .ext-sb-cel.ativo .ext-sb-tile { background: var(--accent-soft); color: var(--primary); }
    .ext-sb-txt { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .ext-sb-rot { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); }
    .ext-sb-cel.aberto .ext-sb-rot { color: var(--primary); }
    .ext-sb-val { font-size: 13px; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ext-sb-chev { margin-left: auto; color: var(--ink-faint); font-size: 11px; transition: transform var(--t-fast); }
    .ext-sb-cel.aberto .ext-sb-chev { transform: rotate(180deg); color: var(--primary); }
    .ext-sb-painel { position: absolute; top: calc(100% + 6px); left: 0; min-width: 100%; width: max-content; max-width: 340px;
      background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 12px; z-index: 60;
      box-shadow: 0 18px 44px -18px rgba(20,50,80,.35); overflow: hidden; }
    .ext-sb-busca { width: 100%; box-sizing: border-box; border: none; border-bottom: 1px solid var(--border);
      padding: 9px 12px; font: inherit; font-size: 13px; outline: none; background: var(--bg-elevated); color: var(--ink); }
    .ext-sb-lista { max-height: 260px; overflow-y: auto; padding: 5px; }
    .ext-sb-it { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: none;
      background: transparent; font: inherit; font-size: 13px; color: var(--ink); cursor: pointer;
      border-radius: 8px; text-align: left; }
    .ext-sb-it:hover { background: var(--primary-soft); }
    .ext-sb-it.sel { background: var(--accent-soft); font-weight: 700; }
    .ext-sb-limpar { border: none; background: transparent; color: var(--primary); font: inherit; font-size: 12px;
      font-weight: 700; cursor: pointer; padding: 10px 14px; white-space: nowrap; border-radius: 14px; }
    .ext-sb-limpar:hover { background: var(--primary-soft); }

    /* evolução do repasse (barras por mês, como o bloco da VG) */
    .ext-evo { display: flex; align-items: flex-end; gap: 14px; height: 170px; padding: 8px 4px 0; }
    .ext-evo-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; height: 100%; justify-content: flex-end; }
    .ext-evo-vlr { font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--ink-soft); white-space: nowrap; }
    .ext-evo-bar { width: 70%; max-width: 64px; border-radius: 6px 6px 0 0; background: var(--accent);
      box-shadow: inset 0 -2px 0 rgba(0,0,0,.08); }
    .ext-evo-bar.pago { background: var(--success); }
    .ext-evo-mes { font-size: 11px; color: var(--ink-faint); white-space: nowrap; }
    .ext-rank { display: flex; flex-direction: column; gap: 7px; }
    .ext-rank-linha { display: grid; grid-template-columns: minmax(140px, 1.1fr) 1fr auto; gap: 10px; align-items: center; font-size: 12.5px; }
    .ext-rank-nome { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ext-rank-trilho { display: block; height: 10px; border-radius: 99px; background: var(--bg-sunken); overflow: hidden; }
    .ext-rank-fill { display: block; height: 100%; border-radius: 99px; background: var(--accent); }
    .ext-rank-vlr { font-family: var(--font-mono); font-weight: 600; white-space: nowrap; }
    .ext-mes-tab { width: 100%; border-collapse: collapse; font-size: 12px; }
    .ext-mes-tab th { text-align: left; font-size: 10.5px; color: var(--ink-faint); padding: 4px 6px; border-bottom: 1px solid var(--border-strong); }
    .ext-mes-tab td { padding: 5px 6px; border-bottom: 1px solid var(--border); }
    .ext-mes-tab td.num { text-align: right; font-family: var(--font-mono); white-space: nowrap; }
    .ext-pend { margin: 0; padding: 0 0 0 4px; list-style: none; font-size: 12.5px; display: flex; flex-direction: column; gap: 6px; }
    .ext-pend li::before { content: '⚠ '; color: var(--warning); }
    .ext-pend-ok::before { content: '✓ ' !important; color: var(--success) !important; }

    /* base de cálculo */
    .ext-base-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
    @media (max-width: 1100px) { .ext-base-grid { grid-template-columns: 1fr; } }
    /* V702: cada cadastro rola VERTICALMENTE dentro do card (cabeçalho fixo) */
    .ext-base-scroll { overflow-y: auto; scrollbar-width: thin; border: 1px solid var(--border); border-radius: 8px; }
    .ext-base-scroll::-webkit-scrollbar { width: 6px; }
    .ext-base-scroll::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 6px; }
    .ext-base-tab { width: 100%; border-collapse: collapse; font-size: 12px; }
    .ext-base-tab th { text-align: left; font-size: 10.5px; color: var(--ink-faint); padding: 6px;
      border-bottom: 1px solid var(--border-strong);
      position: sticky; top: 0; z-index: 2; background: var(--bg-elevated); }
    .ext-base-tab td { padding: 3px 6px; border-bottom: 1px solid var(--border); }
    .ext-base-tab td:first-child { min-width: 170px; }   /* nome inteiro legível */
    .ext-base-tab input { width: 100%; border: 1px solid transparent; background: transparent;
      font: inherit; color: inherit; padding: 3px 5px; border-radius: 5px; }
    .ext-base-tab input:hover { border-color: var(--border); }
    .ext-base-tab input:focus { border-color: var(--accent); background: var(--bg-elevated); outline: none; }
    .ext-base-tab input.num { text-align: right; font-family: var(--font-mono); }
    .ext-rem { border: none; background: transparent; color: var(--ink-faint); cursor: pointer; font-size: 13px; }
    .ext-rem:hover { color: var(--danger); }

    /* modal leve */
    .ext-modal-fundo { position: fixed; inset: 0; background: rgba(6, 40, 58, 0.45); z-index: 300;
      display: flex; align-items: center; justify-content: center; }
    .ext-modal { background: var(--bg-elevated); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);
      width: min(440px, 92vw); padding: 20px; }
    .ext-modal h3 { margin: 0 0 14px; font-size: 15px; }
  `;

  const fm = v => U().formatarMoeda(v);

  function escapar(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function dataBR(s) {
    if (!s) return '—';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s);
  }

  function modal(titulo, corpoHTML, aoConfirmar) {
    document.querySelectorAll('.ext-modal-fundo').forEach(e => e.remove());
    const fundo = document.createElement('div');
    fundo.className = 'ext-modal-fundo';
    fundo.innerHTML = `<div class="ext-modal"><h3>${escapar(titulo)}</h3>${corpoHTML}
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px">
        <button class="btn btn-secondary" data-ext-cancelar>Cancelar</button>
        <button class="btn btn-primary" data-ext-ok>Confirmar</button>
      </div></div>`;
    document.body.appendChild(fundo);
    fundo.addEventListener('click', e => { if (e.target === fundo) fundo.remove(); });
    fundo.querySelector('[data-ext-cancelar]').addEventListener('click', () => fundo.remove());
    fundo.querySelector('[data-ext-ok]').addEventListener('click', () => {
      if (aoConfirmar(fundo) !== false) fundo.remove();
    });
    return fundo;
  }

  // ════════════════════════════════════════════════════════════════════════
  // TELA 1 — MATRIZ EXTERNA (V706: mesmo princípio do CALCULAR REPASSE do
  // ATLAS — KPIs no topo, UM filtro por coluna da tabela, tabela plana; o
  // repasse fecha por admissão na linha de resumo)
  // ════════════════════════════════════════════════════════════════════════

  const st = { fAdmissao: '', fPaciente: '', fMedico: '', fCategoria: '', fSubcategoria: '', status: 'TODOS' };

  App.telas['externos'] = function () {
    U().garantirEstilos('ext-css', CSS);
    const cont = document.getElementById('conteudo');

    const todos = window.AtlasExternos.analisarTodas();

    // filtros por coluna (admissão inteira entra se alguma linha casa)
    const norm = v => U().normalizar(v || '');
    const fAdm = norm(st.fAdmissao), fPac = norm(st.fPaciente), fMed = norm(st.fMedico);
    const fCat = norm(st.fCategoria), fSub = norm(st.fSubcategoria);
    const visiveis = todos.filter(d => {
      if (st.status !== 'TODOS' && (d.adm.status || 'AGUARDANDO') !== st.status) return false;
      if (fAdm && !norm(d.cod).includes(fAdm)) return false;
      if (fMed && !norm(d.medicoNome).includes(fMed)) return false;
      if (fPac && !d.linhas.some(l => norm(l.paciente).includes(fPac))) return false;
      if (fCat && !d.linhas.some(l => norm(l.categoria).includes(fCat))) return false;
      if (fSub && !d.linhas.some(l => norm(l.subcategoria || l.produto).includes(fSub))) return false;
      return true;
    });

    // ordena por médico e admissão (a coluna Médico substitui o agrupamento)
    visiveis.sort((a, b) => (a.medicoNome || '').localeCompare(b.medicoNome || '', 'pt-BR') || String(a.cod).localeCompare(String(b.cod)));

    const totalRepasse = visiveis.reduce((s, d) => s + d.repasse, 0);
    const totalFat = visiveis.reduce((s, d) => s + d.fat, 0);
    const aguardando = todos.filter(d => (d.adm.status || 'AGUARDANDO') !== 'PAGO').length;
    const semProd = todos.filter(d => !d.linhas.length).length;

    const filtro = (rotulo, chave, placeholder) => {
      const ativo = !!st[chave];
      return `<div class="ext-fil-grupo">
        <label class="ext-fil-label">${rotulo}</label>
        <div class="ext-fil-wrap ${ativo ? 'ativo' : ''}">
          <span class="ext-fil-ic">🔎</span>
          <input type="text" class="ext-fil-input" data-ext-fil="${chave}" placeholder="${placeholder}"
                 value="${escapar(st[chave])}" autocomplete="off">
          ${ativo ? `<button type="button" class="ext-fil-x" data-ext-fil-x="${chave}" title="Limpar este filtro">×</button>` : ''}
        </div>
      </div>`;
    };

    cont.innerHTML = `
      <div class="page-content">
        <header class="page-header">
          <h2>Matriz Externa</h2>
          <p class="subtitle">Repasse de médicos externos e híbridos — admissões cruzadas com a PRODUÇÃO, regras da Base de Cálculo.</p>
        </header>

        <div class="ext-kpis">
          ${U().cardKPI('Admissões na matriz', String(todos.length), '', '', 'ext-kpi')}
          ${U().cardKPI('Aguardando repasse', String(aguardando), '', '', 'ext-kpi')}
          ${U().cardKPI('Faturamento (filtro)', fm(totalFat), '', '', 'ext-kpi')}
          ${U().cardKPI('Repasse (filtro)', fm(totalRepasse), '', '', 'ext-kpi')}
        </div>

        ${semProd ? `<div class="card" style="border-color:#D8B25A; background:var(--warning-soft); padding:10px 14px; margin-bottom:14px; font-size:12.5px">
          <strong>${semProd}</strong> admissã${semProd > 1 ? 'ões' : 'o'} ainda sem linhas na PRODUÇÃO — importe a produção do mês em <em>Importar → Produção</em> (modo normal).
        </div>` : ''}

        <div class="ext-fil-card">
          ${filtro('Admissão', 'fAdmissao', 'Nº admissão...')}
          ${filtro('Paciente', 'fPaciente', 'Nome do paciente...')}
          ${filtro('Médico', 'fMedico', 'Nome do médico...')}
          ${filtro('Categoria', 'fCategoria', 'Categoria...')}
          ${filtro('Subcategoria', 'fSubcategoria', 'Subcategoria...')}
          <div class="ext-fil-grupo">
            <label class="ext-fil-label">Status</label>
            <select class="select ext-fil-select" id="ext-status">
              <option value="TODOS"      ${st.status === 'TODOS' ? 'selected' : ''}>Todos</option>
              <option value="AGUARDANDO" ${st.status === 'AGUARDANDO' ? 'selected' : ''}>Aguardando repasse</option>
              <option value="PAGO"       ${st.status === 'PAGO' ? 'selected' : ''}>Pagos</option>
            </select>
          </div>
        </div>

        ${!todos.length ? `
          <div class="card ext-vazio">
            <i class="ti ti-file-import"></i>
            <h3 style="margin:10px 0 6px">Nenhuma admissão importada</h3>
            <p style="margin:0 0 14px">Comece importando a planilha de admissões enviada pelo espaço verde.</p>
            <button class="btn btn-primary" id="ext-ir-importar">Importar admissões</button>
          </div>` : `
        <table class="ext-tab">
          <thead><tr>
            <th>Admissão</th><th>Data</th><th>Cód. Paciente</th><th>Paciente</th><th>Médico</th>
            <th>Categoria</th><th>Subcategoria</th>
            <th title="Nomenclatura do procedimento como veio na planilha importada">Proc. (planilha)</th>
            <th title="Produto lançado na PRODUÇÃO desta admissão">Produto (produção)</th>
            <th class="num">Valor</th><th class="num">Repasse</th>
          </tr></thead>
          <tbody>
            ${visiveis.map(d => renderAdmissao(d)).join('')}
            ${visiveis.length ? `<tr class="ext-total">
              <td colspan="9">TOTAL (${visiveis.length} admissã${visiveis.length === 1 ? 'o' : 'ões'} no filtro)</td>
              <td class="num">${fm(totalFat)}</td>
              <td class="num atlas-rep"><strong>${fm(totalRepasse)}</strong></td><!-- V962 -->
            </tr>` : `<tr><td colspan="11" style="text-align:center; color:var(--ink-faint); padding:18px">Nenhuma admissão passa pelos filtros.</td></tr>`}
          </tbody>
        </table>`}
      </div>`;

    // binds — filtros por coluna (re-render preservando o foco/cursor)
    cont.querySelectorAll('[data-ext-fil]').forEach(inp => {
      let tmr = null;
      inp.addEventListener('input', () => {
        clearTimeout(tmr);
        tmr = setTimeout(() => {
          const chave = inp.dataset.extFil;
          const pos = inp.selectionStart;
          st[chave] = inp.value;
          App.telas['externos']();
          const novo = document.querySelector(`[data-ext-fil="${chave}"]`);
          if (novo) { novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (_) {} }
        }, 250);
      });
    });
    cont.querySelectorAll('[data-ext-fil-x]').forEach(b => b.addEventListener('click', () => {
      st[b.dataset.extFilX] = '';
      App.telas['externos']();
    }));
    const selSt = cont.querySelector('#ext-status');
    if (selSt) selSt.addEventListener('change', () => { st.status = selSt.value; App.telas['externos'](); });
    const irImp = cont.querySelector('#ext-ir-importar');
    if (irImp) irImp.addEventListener('click', () => App.navegarPara('externos-importar'));

    cont.querySelectorAll('[data-ext-pagar]').forEach(b => b.addEventListener('click', () => abrirPagar(b.dataset.extPagar)));
    cont.querySelectorAll('[data-ext-ajustes]').forEach(b => b.addEventListener('click', () => abrirAjustes(b.dataset.extAjustes)));
    // V840: marcação da LIO (ATLAS × PARCERIA) — fica gravada NA admissão
    cont.querySelectorAll('[data-ext-lio]').forEach(b => b.addEventListener('click', () => {
      Banco.executar(`UPDATE externos_admissoes SET lio_tipo = ? WHERE cod_admissao = ?`,
        [b.dataset.tipo, b.dataset.extLio]);
      Banco.salvarDebounced();
      App.telas['externos']();
    }));
    // V828: seletor de médico da clínica + cadastro de médico novo na Matriz
    cont.querySelectorAll('[data-ext-escolher]').forEach(b => b.addEventListener('click', () => abrirEscolherMedico(b.dataset.extEscolher)));
    cont.querySelectorAll('[data-ext-cadastrar]').forEach(b => b.addEventListener('click', () => cadastrarMedicoNovo(b.dataset.extCadastrar, b.dataset.nome)));
    cont.querySelectorAll('[data-ext-remover]').forEach(b => b.addEventListener('click', () => {
      const cod = b.dataset.extRemover;
      if (!confirm(`Remover a admissão ${cod} da matriz de externos?\n(A PRODUÇÃO não é alterada — só a lista de repasse.)`)) return;
      Banco.executar(`DELETE FROM externos_admissoes WHERE cod_admissao = ?`, [cod]);
      App.telas['externos']();
      Banco.salvarDebounced();
    }));
  };

  function renderAdmissao(d) {
    const status = d.adm.status || 'AGUARDANDO';
    const chipStatus = status === 'PAGO'
      ? `<span class="ext-chip ext-chip-pago" title="${d.adm.mes_repasse ? 'Mês do repasse: ' + escapar(d.adm.mes_repasse) : ''}">PAGO${d.adm.mes_repasse ? ' · ' + escapar(d.adm.mes_repasse) : ''}</span>`
      : '<span class="ext-chip ext-chip-aguard">AGUARDANDO</span>';
    // V960: tag padrão de vínculo (Externo / Híbrido) — antes chips EXT/HÍB próprios
    const chipTipo = (d.tipo === 'EXTERNO' || d.tipo === 'HIBRIDO') ? ' ' + Utilidades.badgeVinculo(d.tipo)
                   : ' <span class="ext-chip ext-chip-aviso" title="Defina o tipo de vínculo em Médicos & Clínicas">?</span>';

    /**
     * V828: célula do MÉDICO —
     *  resolvido (cadastro/de-para, escolha ou clínica de médico único): nome
     *  OFICIAL do cadastro, com a origem no title;
     *  clínica com vários médicos: botão que abre o seletor (a escolha vale
     *  só para esta admissão);
     *  desconhecido: o nome que veio + botão para cadastrar o médico novo
     *  (mesmo formulário de edição do módulo MÉDICOS).
     */
    const tituloMed = d.medico
      ? [d.medicoViaEscolha ? 'Escolhido no seletor da clínica (vale só para esta admissão)' : '',
         d.medicoViaClinica ? `Único médico da clínica "${d.clinica ? d.clinica.clinica.nome : ''}"` : '',
         d.medico.clinica_nome ? d.medico.clinica_nome + (d.medico.clinica_cnpj ? ' · CNPJ ' + d.medico.clinica_cnpj : '') : '',
        ].filter(Boolean).join(' · ')
      : '';
    const celMedico = d.medico
      ? `<td title="${escapar(tituloMed)}">${escapar(d.medico.nome_oficial || d.medicoNome)}${chipTipo}${
          d.medicoViaEscolha ? ` <button class="ext-acao" data-ext-escolher="${escapar(d.cod)}" title="Trocar o médico desta admissão">↺</button>` : ''}</td>`
      : d.clinica && d.clinica.medicos.length > 1
      ? `<td><span title="Clínica ${escapar(d.clinica.clinica.nome)}">🏥 ${escapar(d.clinica.clinica.nome)}</span>
           <button class="ext-acao" data-ext-escolher="${escapar(d.cod)}" title="Escolher qual médico desta clínica é o desta admissão">Escolher médico</button></td>`
      : d.medicoDesconhecido
      ? `<td>${escapar(d.medicoNome)} <button class="ext-acao" data-ext-cadastrar="${escapar(d.cod)}"
           data-nome="${escapar(d.medicoNome)}" title="Cadastrar este médico (abre o mesmo formulário do módulo MÉDICOS)">＋ Cadastrar</button></td>`
      : `<td>${escapar(d.medicoNome || '—')}${chipTipo}</td>`;

    const linhas = d.linhas.map((l, iL) => {
      const ehLio = d.lio && d.lio.linhaId === l.id;
      const ehOpme = d.opmeLinhas.includes(l.id);
      const marca = ehLio ? ` <span class="ext-chip ext-chip-hib" title="Linha identificada como a LIO (${d.lio.por === 'valor' ? 'bateu pelo valor' : 'nome mais próximo'}: ${escapar(d.lio.nome)})">LIO</span>`
                  : ehOpme ? ' <span class="ext-chip ext-chip-aguard" title="Linha de OPME — deduzida do custo da produção">OPME</span>' : '';
      return `<tr class="${ehLio ? 'ext-linha-lio' : ehOpme ? 'ext-linha-opme' : ''}">
        <td>${escapar(d.cod)}</td>
        <td>${dataBR(l.data_admissao)}</td>
        <td>${escapar(l.cod_paciente || '—')}</td>
        <td>${escapar(l.paciente || '—')}</td>
        ${celMedico}
        <td>${escapar(l.categoria || '—')}${marca}</td>
        <td>${escapar(l.subcategoria || l.produto || '—')}</td>
        <td>${iL === 0 ? escapar(d.adm.proc_planilha || '—') : ''}</td>
        <td>${escapar(l.produto || l.procedimento_principal || '—')}</td>
        <td class="num">${fm(Number(l.valor) || 0)}</td>
        <td class="num"></td>
      </tr>`;
    }).join('');

    const semLinhas = !d.linhas.length ? `<tr>
        <td>${escapar(d.cod)}</td><td>—</td><td>—</td><td>—</td>
        ${celMedico}
        <td colspan="5" style="color:var(--danger)">Sem linhas na PRODUÇÃO para esta admissão.</td>
        <td class="num"></td>
      </tr>` : '';

    // V840: marcação manual da LIO — ATLAS × PARCERIA (a marcação sugerida fica
    // tracejada até ser confirmada com um clique)
    const cfgB = window.AtlasExternos.base().cfg;
    const chipsLio = d.lio ? `
      <span class="parcela" title="PARCERIA: deduz o custo da lente e paga ${cfgB.indicacao}% · ATLAS: lente sem dedução e paga ${cfgB.lioAtlas}%. A escolha fica gravada nesta admissão.">
        lente:
        <button class="ext-lio-btn${d.lioEfetivo === 'PARCERIA' ? (d.lioTipo ? ' on' : ' sugerida') : ''}"
          data-ext-lio="${escapar(d.cod)}" data-tipo="PARCERIA">PARCERIA</button>
        <button class="ext-lio-btn${d.lioEfetivo === 'ATLAS' ? (d.lioTipo ? ' on' : ' sugerida') : ''}"
          data-ext-lio="${escapar(d.cod)}" data-tipo="ATLAS">ATLAS</button>
        ${d.lioTipo ? '' : '<span class="small muted" title="A ferramenta sugeriu — confirme clicando">(sugestão)</span>'}
      </span>` : '';
    const contas = d.linhas.length ? `
      <span class="parcela">FAT <b>${fm(d.fat)}</b></span>
      ${d.opme ? `<span class="parcela">− OPME <b>${fm(d.opme)}</b></span>` : ''}
      ${d.lio ? `<span class="parcela" title="${d.lio.por === 'valor' ? 'identificada pelo valor' : 'identificada pelo nome mais próximo'}">${
          d.lioDeduzido ? `− LIO ${escapar(d.lio.nome)} <b>${fm(d.lioDeduzido)}</b>` : `LIO ${escapar(d.lio.nome)} <b>sem dedução (ATLAS · ${d.pct}%)</b>`}</span>` : ''}
      ${chipsLio}
      <span class="parcela">− imposto ${cfgB.imposto}% <b>${fm(d.imposto)}</b></span>
      <span class="parcela">− MAT/MED${d.proc ? ' (' + escapar(d.proc.nome) + (d.ao ? ' · AO' : '') + ')' : ''} <b>${fm(d.matmed)}</b></span>
      ${d.hmDeduzido ? `<span class="parcela" title="Médico HÍBRIDO recebe o HM na folha interna — aqui ele entra nas deduções (V828)">− HM (híbrido) <b>${fm(d.hmDeduzido)}</b></span>` : ''}
      <span class="parcela">= líquido <b>${fm(d.liquido)}</b></span>
      <span class="parcela">× ${d.pct}% <b>${fm(d.indicacao)}</b></span>
      ${d.tipo === 'HIBRIDO' && !d.hmDeduzido ? '' : `<span class="parcela" title="${
          d.operou === false ? 'O cirurgião da produção não é este médico — sem HM (V840)'
        : d.operou === true ? 'O próprio médico é o cirurgião da produção — HM devido (V840)'
        : 'Produção sem cirurgião informado — HM mantido'}">+ HM <b>${fm(d.hm)}</b>${
          d.adm.sem_hm ? ' (sem HM: só encaminhou)' : d.operou === false ? ' (não operou)' : ''}</span>`}` : '';

    const avisos = d.avisos.length
      ? `<ul class="ext-avisos">${d.avisos.map(a => `<li>⚠ ${escapar(a)}</li>`).join('')}</ul>` : '';

    return `${linhas}${semLinhas}
      <tr class="ext-resumo">
        <td colspan="10">
          <div class="contas">
            ${chipStatus}
            ${contas}
            <span style="margin-left:auto; display:inline-flex; gap:6px">
              <button class="ext-acao" data-ext-ajustes="${escapar(d.cod)}" title="Percentual de indicação, HM e observação">Ajustes</button>
              ${status !== 'PAGO'
                ? `<button class="ext-acao" data-ext-pagar="${escapar(d.cod)}">Marcar pago</button>`
                : `<button class="ext-acao" data-ext-pagar="${escapar(d.cod)}">Reabrir</button>`}
              <button class="ext-rem" data-ext-remover="${escapar(d.cod)}" title="Remover da matriz"><i class="ti ti-trash"></i></button>
            </span>
          </div>
          ${d.adm.observacao ? `<div style="font-size:11px; color:var(--ink-faint); margin-top:4px">Obs.: ${escapar(d.adm.observacao)}</div>` : ''}
          ${avisos}
        </td>
        <td class="num"><span class="repasse-final">${fm(d.repasse)}</span></td>
      </tr>`;
  }

  /**
   * V828: seletor do MÉDICO da clínica — a coluna "médico" da produção trouxe
   * a CLÍNICA; aqui escolhe-se qual dos médicos vinculados a ela é o desta
   * admissão. A escolha vale SÓ para esta admissão (fica gravada nela).
   */
  function abrirEscolherMedico(cod) {
    const adm = Banco.queryUnica(`SELECT * FROM externos_admissoes WHERE cod_admissao = ?`, [cod]);
    if (!adm) return;
    const d = window.AtlasExternos.analisar(adm);
    const clin = clinicaDoNome(d.medicoNome);
    if (!clin || !clin.medicos.length) { U().toast('Nenhum médico vinculado a essa clínica — vincule em Médicos & Clínicas.', 'warning', 4200); return; }
    modal(`Médico da admissão ${cod} — clínica ${escapar(clin.clinica.nome)}`, `
      <p class="small muted" style="margin:0 0 10px">A escolha vale <strong>só para esta admissão</strong> — as próximas da mesma clínica continuam pedindo escolha.</p>
      ${clin.medicos.map(m => `
        <label style="display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid var(--border); border-radius:8px; margin-bottom:6px; cursor:pointer">
          <input type="radio" name="ext-esc-med" value="${m.id}" ${adm.medico_escolhido_id === m.id ? 'checked' : ''}>
          <span>${escapar(m.nome_oficial)}${m.tipo_vinculo ? ' ' + Utilidades.badgeVinculo(m.tipo_vinculo) : ''}</span><!-- V960 -->
        </label>`).join('')}
      ${adm.medico_escolhido_id ? `
        <label style="display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px dashed var(--border); border-radius:8px; cursor:pointer">
          <input type="radio" name="ext-esc-med" value="">
          <span class="small muted">— limpar a escolha (volta a pedir) —</span>
        </label>` : ''}`,
      (f) => {
        const sel = f.querySelector('input[name="ext-esc-med"]:checked');
        if (!sel) { U().toast('Escolha um médico', 'error'); return false; }
        Banco.executar(`UPDATE externos_admissoes SET medico_escolhido_id = ? WHERE cod_admissao = ?`,
          [sel.value ? Number(sel.value) : null, cod]);
        Banco.salvarDebounced();
        App.telas['externos']();
        U().toast(sel.value ? 'Médico definido para esta admissão' : 'Escolha removida', 'success', 2200);
      });
  }

  /**
   * V828: médico que não existe no cadastro — cria o registro-base com o nome
   * vindo da produção e abre o MESMO formulário de edição do módulo MÉDICOS
   * para completar (CRM, vínculo, clínica, especialidades…).
   */
  function cadastrarMedicoNovo(cod, nome) {
    const nomeLimpo = String(nome || '').trim();
    if (!nomeLimpo) return;
    const norm = U().normalizar(nomeLimpo);
    const ja = Banco.queryUnica(`SELECT id FROM medicos WHERE nome_normalizado = ?`, [norm]);
    const id = ja ? ja.id : Banco.executar(
      `INSERT INTO medicos (nome_oficial, nome_normalizado, tipo_vinculo, ativo)
       VALUES (?, ?, 'EXTERNO', 1)`, [nomeLimpo, norm]).lastInsertRowId;
    window.AtlasExternos._limparCache();
    Banco.salvarDebounced();
    if (typeof abrirEdicaoMedico === 'function') abrirEdicaoMedico(id);
    else { App.telas['externos'](); U().toast('Médico cadastrado — complete os dados no módulo MÉDICOS.', 'success', 3600); }
  }

  // ════════════════════════════════════════════════════════════════════════
  // TELA 2 — IMPORTAR (V706: mesma lógica do IMPORTAR QVIS — o arquivo entra
  // numa PRÉVIA com os números do que vai acontecer, só grava depois do
  // "Confirmar importação"; abaixo, o STATUS DA BASE com cards por arquivo
  // e a opção de apagar o que veio de cada um)
  // ════════════════════════════════════════════════════════════════════════

  const stImp = { staged: null };   // { nomeArquivo, encontrados, novos, jaExistem, desconhecidos }

  App.telas['externos-importar'] = function () {
    U().garantirEstilos('ext-css', CSS);
    const cont = document.getElementById('conteudo');

    const origens = Banco.query(`SELECT origem, COUNT(*) AS n, MAX(importado_em) AS quando,
                                        SUM(CASE WHEN status = 'PAGO' THEN 1 ELSE 0 END) AS pagas
                                   FROM externos_admissoes GROUP BY origem ORDER BY MAX(id) DESC`);
    const totalBase = origens.reduce((s, o) => s + o.n, 0);
    const s = stImp.staged;

    cont.innerHTML = `
      <div class="page-content">
        <header class="page-header">
          <h2>Importar</h2>
          <p class="subtitle">A planilha de admissões pode vir em QUALQUER estrutura — a leitura procura os números de admissão e confirma cada um contra a PRODUÇÃO antes de entrar.</p>
        </header>

        <div class="card" style="padding:18px">
          <div class="ext-drop" id="ext-drop">
            <i class="ti ti-file-import"></i>
            <p style="margin:10px 0 2px; font-weight:600; color:var(--ink)">Clique ou arraste a planilha aqui</p>
            <p style="margin:0; font-size:12px">.xlsx, .xls ou .csv — nada entra no banco antes de você confirmar a prévia</p>
          </div>
          <input type="file" id="ext-arquivo" accept=".xlsx,.xls,.csv" style="display:none">
          <div id="ext-imp-resultado">
          ${s ? `
            <div class="ext-preview">
              <h3 style="margin:14px 0 10px; font-size:14px">Prévia — ${escapar(s.nomeArquivo)}</h3>
              <div class="ext-preview-grid">
                <div class="ext-preview-item"><span class="vlr">${s.novos.length}</span><span class="rot">admissões novas (vão entrar)</span></div>
                <div class="ext-preview-item"><span class="vlr">${s.jaExistem.length}</span><span class="rot">já estão na matriz (ignoradas)</span></div>
                <div class="ext-preview-item ${s.desconhecidos.length ? 'atencao' : ''}"><span class="vlr">${s.desconhecidos.length}</span><span class="rot">números fora da PRODUÇÃO (descartados)</span></div>
              </div>
              ${s.novos.length ? `<p class="small muted" style="margin:8px 0 0">Vão entrar: ${s.novos.slice(0, 12).map(escapar).join(', ')}${s.novos.length > 12 ? ` … (+${s.novos.length - 12})` : ''}</p>` : `
                <p style="margin:8px 0 0; color:var(--danger); font-size:13px">Nenhuma admissão nova neste arquivo.</p>`}
              ${s.desconhecidos.length && !s.novos.length && !s.jaExistem.length ? `
                <p class="small muted" style="margin:6px 0 0">Se a produção do mês ainda não foi importada, importe-a primeiro (modo normal → Importar → Produção) e repita.</p>` : ''}
              <div style="display:flex; gap:8px; margin-top:14px">
                <button class="btn btn-primary" id="ext-imp-confirmar" ${s.novos.length ? '' : 'disabled'}>Confirmar importação</button>
                <button class="btn btn-secondary" id="ext-imp-cancelar">Cancelar</button>
              </div>
            </div>` : ''}
          </div>
        </div>

        <div class="card" style="padding:16px; margin-top:16px">
          <h3 style="margin:0 0 4px; font-size:14px">Status da base</h3>
          <p class="small muted" style="margin:0 0 12px">${totalBase ? `${totalBase} admissã${totalBase === 1 ? 'o' : 'ões'} na matriz, vinda${totalBase === 1 ? '' : 's'} de ${origens.length} arquivo${origens.length === 1 ? '' : 's'}.` : 'Nenhuma admissão importada ainda.'}</p>
          ${origens.length ? `
          <div class="ext-origens">
            ${origens.map(o => `
              <div class="ext-origem-card">
                <div class="ext-origem-info">
                  <div class="nome"><i class="ti ti-file-spreadsheet"></i> ${escapar(o.origem || '(sem nome)')}</div>
                  <div class="meta">${o.n} admissã${o.n === 1 ? 'o' : 'ões'} · ${o.pagas} paga${o.pagas === 1 ? '' : 's'} · importado em ${escapar((o.quando || '').slice(0, 16).replace('T', ' '))}</div>
                </div>
                <button class="ext-acao" data-ext-apagar-origem="${escapar(o.origem || '')}" title="Apagar da matriz TODAS as admissões vindas deste arquivo">🗑 Apagar</button>
              </div>`).join('')}
          </div>` : ''}
        </div>
      </div>`;

    const drop = cont.querySelector('#ext-drop');
    const inp = cont.querySelector('#ext-arquivo');
    drop.addEventListener('click', () => inp.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('arrastando'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('arrastando'));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('arrastando');
      if (e.dataTransfer.files.length) analisarArquivo(e.dataTransfer.files[0]);
    });
    inp.addEventListener('change', () => { if (inp.files.length) analisarArquivo(inp.files[0]); inp.value = ''; });

    const btnOk = cont.querySelector('#ext-imp-confirmar');
    if (btnOk) btnOk.addEventListener('click', confirmarImportacao);
    const btnNo = cont.querySelector('#ext-imp-cancelar');
    if (btnNo) btnNo.addEventListener('click', () => { stImp.staged = null; App.telas['externos-importar'](); });

    cont.querySelectorAll('[data-ext-apagar-origem]').forEach(b => b.addEventListener('click', () => {
      const origem = b.dataset.extApagarOrigem;
      const n = Banco.queryUnica(`SELECT COUNT(*) AS n FROM externos_admissoes WHERE COALESCE(origem,'') = ?`, [origem]).n;
      if (!confirm(`Apagar as ${n} admissões vindas de "${origem || '(sem nome)'}" da matriz de externos?\n(A PRODUÇÃO não é alterada.)`)) return;
      Banco.executar(`DELETE FROM externos_admissoes WHERE COALESCE(origem,'') = ?`, [origem]);
      Banco.salvarDebounced();
      App.telas['externos-importar']();
      U().toast(`${n} admissões apagadas`, 'success');
    }));
  };

  /**
   * FASE 1 (prévia, sem gravar): varre TODAS as células de TODAS as abas
   * atrás de números com cara de admissão (6–10 dígitos) e valida contra a
   * PRODUÇÃO — igual à pré-análise do Importar QVIS.
   */
  async function analisarArquivo(arquivo) {
    const alvo = document.getElementById('ext-imp-resultado');
    alvo.innerHTML = `<p style="margin:14px 0 0; font-size:13px">Lendo <strong>${escapar(arquivo.name)}</strong>…</p>`;
    try {
      const buffer = await arquivo.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });

      const candidatos = new Set();
      // V828: além dos números, captura a NOMENCLATURA DO PROCEDIMENTO que a
      // planilha traz — acha a coluna pelo cabeçalho (PROCEDIMENTO/CIRURGIA/
      // DESCRIÇÃO/EXAME/PRODUTO) e guarda o texto da linha de cada admissão.
      const procPorAdm = {};
      const RE_CAB_PROC = /PROCED|CIRURG|DESCRI|EXAME|PRODUTO/i;
      for (const nomeAba of wb.SheetNames) {
        const matriz = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, defval: null, raw: true });
        let colProc = -1;
        for (let li = 0; li < Math.min(matriz.length, 12) && colProc < 0; li++) {
          for (let ci = 0; ci < (matriz[li] || []).length; ci++) {
            if (typeof matriz[li][ci] === 'string' && RE_CAB_PROC.test(matriz[li][ci])) { colProc = ci; break; }
          }
        }
        for (const linha of matriz) {
          const daLinha = [];
          for (const cel of (linha || [])) {
            if (cel == null) continue;
            if (typeof cel === 'number' && Number.isFinite(cel)) {
              const s = String(Math.round(cel));
              if (s.length >= 6 && s.length <= 10) { candidatos.add(s); daLinha.push(s); }
            } else if (typeof cel === 'string') {
              for (const m of cel.matchAll(/\d{6,10}/g)) { candidatos.add(m[0]); daLinha.push(m[0]); }
            }
          }
          if (colProc >= 0 && daLinha.length) {
            const proc = linha && linha[colProc] != null ? String(linha[colProc]).trim() : '';
            if (proc && !RE_CAB_PROC.test(proc)) {
              for (const cod of daLinha) if (!procPorAdm[cod]) procPorAdm[cod] = proc;
            }
          }
        }
      }
      if (!candidatos.size) {
        alvo.innerHTML = `<p style="margin:14px 0 0; color:var(--danger); font-size:13px">
          Nenhum número com cara de admissão (6–10 dígitos) encontrado na planilha.</p>`;
        return;
      }

      const lista = [...candidatos];
      const naProducao = new Set();
      for (let i = 0; i < lista.length; i += 500) {
        const fatia = lista.slice(i, i + 500);
        Banco.query(
          `SELECT DISTINCT cod_admissao FROM linhas_producao WHERE cod_admissao IN (${fatia.map(() => '?').join(',')})`,
          fatia
        ).forEach(r => naProducao.add(String(r.cod_admissao)));
      }
      const jaNaMatriz = new Set(Banco.query(`SELECT cod_admissao FROM externos_admissoes`).map(r => String(r.cod_admissao)));

      const encontrados = lista.filter(c => naProducao.has(c));
      stImp.staged = {
        nomeArquivo: arquivo.name,
        encontrados,
        novos: encontrados.filter(c => !jaNaMatriz.has(c)),
        jaExistem: encontrados.filter(c => jaNaMatriz.has(c)),
        desconhecidos: lista.filter(c => !naProducao.has(c)),
        procPorAdm,   // V828: nomenclatura do procedimento por admissão
      };
      App.telas['externos-importar']();
    } catch (e) {
      console.error('[EXTERNOS] leitura', e);
      alvo.innerHTML = `<p style="margin:14px 0 0; color:var(--danger); font-size:13px">Falha ao ler a planilha: ${escapar(e.message)}</p>`;
    }
  }

  /** FASE 2: grava a prévia confirmada (igual ao gatilho do Importar QVIS). */
  function confirmarImportacao() {
    const s = stImp.staged;
    if (!s || !s.novos.length) return;
    garantirColunas();
    Banco.db.exec('BEGIN');
    try {
      const procDe = (cod) => (s.procPorAdm && s.procPorAdm[cod]) || null;
      for (const cod of s.novos) {
        Banco.executar(`INSERT OR IGNORE INTO externos_admissoes (cod_admissao, origem, proc_planilha) VALUES (?, ?, ?)`,
          [cod, s.nomeArquivo, procDe(cod)]);
      }
      // V828: admissão que já estava na matriz sem a nomenclatura ganha a da
      // planilha nova (não sobrescreve a que já existe)
      for (const cod of s.jaExistem) {
        const p = procDe(cod);
        if (p) Banco.executar(`UPDATE externos_admissoes SET proc_planilha = COALESCE(proc_planilha, ?) WHERE cod_admissao = ?`, [p, cod]);
      }
      Banco.db.exec('COMMIT');
    } catch (e) { Banco.db.exec('ROLLBACK'); throw e; }
    const n = s.novos.length;
    stImp.staged = null;
    Banco.salvarDebounced();
    App.telas['externos-importar']();
    U().toast(`${n} admissã${n === 1 ? 'o importada' : 'ões importadas'}`, 'success');
  }

  // ════════════════════════════════════════════════════════════════════════
  // TELA 3 — BASE DE CÁLCULO (+ clínicas dos médicos externos)
  // ════════════════════════════════════════════════════════════════════════

  App.telas['externos-base'] = function () {
    U().garantirEstilos('ext-css', CSS);
    const cont = document.getElementById('conteudo');

    // V702: cada cadastro rola dentro do próprio card (cabeçalho da tabela
    // fixo), com alturas que dividem a tela em quadrantes equilibrados.
    const tabelaEditavel = (titulo, tabela, linhas, colunas, notas, alturaPx) => `
      <div class="card" style="padding:16px">
        <h3 style="margin:0 0 4px; font-size:14px">${titulo} <span class="small muted" style="font-weight:400">· ${linhas.length}</span></h3>
        ${notas ? `<p class="small muted" style="margin:0 0 10px">${notas}</p>` : '<div style="height:6px"></div>'}
        <div class="ext-base-scroll" style="max-height:${alturaPx || 360}px">
        <table class="ext-base-tab" data-ext-tabela="${tabela}">
          <thead><tr>${colunas.map(c => `<th>${c.rotulo}</th>`).join('')}<th></th></tr></thead>
          <tbody>
            ${linhas.map(l => `<tr data-id="${l.id}">
              ${colunas.map(c => `<td><input class="${c.num ? 'num' : ''}" data-campo="${c.campo}"
                 value="${c.num ? (l[c.campo] == null ? '' : String(l[c.campo]).replace('.', ',')) : escapar(l[c.campo] || '')}"></td>`).join('')}
              <td><button class="ext-rem" data-ext-rem-linha title="Remover"><i class="ti ti-trash"></i></button></td>
            </tr>`).join('')}
            <tr data-id="novo">
              ${colunas.map((c, i) => `<td><input class="${c.num ? 'num' : ''}" data-campo="${c.campo}"
                 placeholder="${i === 0 ? '+ adicionar…' : ''}"></td>`).join('')}
              <td></td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>`;

    cont.innerHTML = `
      <div class="page-content">
        <header class="page-header" style="display:flex; align-items:flex-start; justify-content:space-between; gap:14px">
          <div>
            <h2>Base de Cálculo — Externos</h2>
            <p class="subtitle">Valores que alimentam a Matriz Externa. Atualizar a cada 6 meses (regra do processo). Clique numa célula para editar — salva sozinho.</p>
          </div>
          <button class="btn btn-secondary" id="ext-base-ajustes" style="flex:0 0 auto"
                  title="Ajustes — parâmetros do cálculo (imposto · indicação · LIO valor ATLAS)"><i class="ti ti-settings"></i> Ajustes</button>
        </header>

        <div class="ext-base-grid">
          ${tabelaEditavel('Procedimentos (MAT/MED + HM)', 'externos_base_proc',
            Banco.query(`SELECT * FROM externos_base_proc WHERE ativo = 1 ORDER BY nome`),
            [{ rotulo: 'Procedimento', campo: 'nome' }, { rotulo: 'MAT/MED', campo: 'mat_med', num: 1 },
             { rotulo: 'HM', campo: 'hm', num: 1 }, { rotulo: 'MAT/MED AO', campo: 'mat_med_ao', num: 1 },
             { rotulo: 'HM AO', campo: 'hm_ao', num: 1 }],
            'AO = ambos os olhos. Vazio em AO ⇒ a matriz usa 2× o valor unilateral. HM só é pago ao médico EXTERNO.', 380)}

          ${tabelaEditavel('LIOs (custo da lente)', 'externos_base_lio',
            Banco.query(`SELECT * FROM externos_base_lio WHERE ativo = 1 ORDER BY nome`),
            [{ rotulo: 'Lente', campo: 'nome' }, { rotulo: 'Custo', campo: 'custo', num: 1 }],
            'A matriz identifica a LIO primeiro pelo VALOR (linha da produção que bate com um custo daqui) e depois pelo nome mais próximo.', 380)}

          ${tabelaEditavel('Clínicas dos médicos externos', 'externos_clinicas',
            Banco.query(`SELECT * FROM externos_clinicas WHERE ativo = 1 ORDER BY nome`),
            [{ rotulo: 'Clínica', campo: 'nome' }, { rotulo: 'CNPJ', campo: 'cnpj' },
             { rotulo: 'Telefone', campo: 'telefone' }, { rotulo: 'E-mail', campo: 'email' }],
            'O vínculo médico ↔ clínica é feito no cadastro do médico (módulo MÉDICOS).', 300)}

          ${tabelaEditavel('OPMEs (custo)', 'externos_base_opme',
            Banco.query(`SELECT * FROM externos_base_opme WHERE ativo = 1 ORDER BY nome`),
            [{ rotulo: 'OPME', campo: 'nome' }, { rotulo: 'Custo', campo: 'custo', num: 1 }], '', 300)}
        </div>
      </div>`;

    // V702: parâmetros moram no botão "Ajustes" do cabeçalho
    cont.querySelector('#ext-base-ajustes').addEventListener('click', () => {
      const b = window.AtlasExternos.base();
      modal('Ajustes — parâmetros do cálculo', `
        <div class="field"><label>Imposto (% sobre o FAT TOTAL)</label>
          <input type="number" step="0.5" class="input" id="ext-cfg-imposto" value="${b.cfg.imposto}"></div>
        <div class="field"><label>Indicação (% sobre a produção líquida)</label>
          <input type="number" step="0.5" class="input" id="ext-cfg-indicacao" value="${b.cfg.indicacao}"></div>
        <div class="field"><label>Indicação LIO valor ATLAS (%)</label>
          <input type="number" step="0.5" class="input" id="ext-cfg-lioatlas" value="${b.cfg.lioAtlas}"></div>`,
        (f) => {
          const pares = [['IMPOSTO_PCT', '#ext-cfg-imposto'], ['INDICACAO_PCT', '#ext-cfg-indicacao'], ['INDICACAO_LIO_ATLAS_PCT', '#ext-cfg-lioatlas']];
          for (const [chave, sel] of pares) {
            const v = parseFloat(f.querySelector(sel).value);
            if (!isFinite(v)) { U().toast('Percentual inválido', 'error'); return false; }
            Banco.executar(`INSERT INTO externos_config (chave, valor) VALUES (?, ?)
                            ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`, [chave, String(v)]);
          }
          window.AtlasExternos._limparCache();
          Banco.salvarDebounced();
          U().toast('Parâmetros salvos', 'success', 1800);
        });
    });

    // tabelas editáveis
    cont.querySelectorAll('[data-ext-tabela]').forEach(tab => {
      const tabela = tab.dataset.extTabela;
      tab.addEventListener('change', (e) => {
        const inp = e.target.closest('input[data-campo]');
        if (!inp) return;
        const tr = inp.closest('tr');
        const id = tr.dataset.id;
        const num = inp.classList.contains('num');
        const bruto = inp.value.trim();
        const valor = num ? (bruto === '' ? null : U().parseNumBR(bruto)) : (bruto || null);
        if (num && bruto !== '' && valor == null) { U().toast('Número inválido', 'error'); return; }

        if (id === 'novo') {
          // só cria quando o campo-chave (primeiro) estiver preenchido
          const campos = [...tr.querySelectorAll('input[data-campo]')];
          const nome = campos[0].value.trim();
          if (!nome) return;
          const pares = campos.map(c => {
            const n2 = c.classList.contains('num');
            const v2 = c.value.trim();
            return [c.dataset.campo, n2 ? (v2 === '' ? null : U().parseNumBR(v2)) : (v2 || null)];
          });
          try {
            Banco.executar(
              `INSERT INTO ${tabela} (${pares.map(p => p[0]).join(', ')}) VALUES (${pares.map(() => '?').join(', ')})`,
              pares.map(p => p[1]));
          } catch (err) { U().toast('Já existe um registro com esse nome', 'error'); return; }
          window.AtlasExternos._limparCache();
          Banco.salvarDebounced();
          App.telas['externos-base']();
          return;
        }

        Banco.executar(`UPDATE ${tabela} SET ${inp.dataset.campo} = ? WHERE id = ?`, [valor, id]);
        window.AtlasExternos._limparCache();
        Banco.salvarDebounced();
      });
      tab.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-ext-rem-linha]');
        if (!btn) return;
        const tr = btn.closest('tr');
        const nome = tr.querySelector('input[data-campo]').value || '(sem nome)';
        if (!confirm(`Remover "${nome}" da base de cálculo?`)) return;
        Banco.executar(`DELETE FROM ${tabela} WHERE id = ?`, [tr.dataset.id]);
        window.AtlasExternos._limparCache();
        Banco.salvarDebounced();
        App.telas['externos-base']();
      });
    });
  };

  // ════════════════════════════════════════════════════════════════════════
  // TELA 4 — VISÃO GERAL DO MODO EXTERNO (V702)
  // ════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════
  // TELA 4 — VISÃO GERAL DO MODO EXTERNO
  // V705: a pedido, a tela ficou VAZIA por enquanto — a estrutura anterior
  // não era a desejada e o desenho será refeito junto com o usuário.
  // ════════════════════════════════════════════════════════════════════════

  App.telas['externos-visao'] = function () {
    U().garantirEstilos('ext-css', CSS);
    document.getElementById('conteudo').innerHTML = `
      <div class="page-content">
        <header class="page-header">
          <h2>Visão Geral</h2>
          <p class="subtitle">Dashboard executivo · Externos</p>
        </header>
        <div class="card ext-vazio">
          <i class="ti ti-layout-dashboard"></i>
          <h3 style="margin:10px 0 6px">Em construção</h3>
          <p style="margin:0">Esta visão geral ainda vai ser estruturada — por enquanto use a <strong>Matriz Externa</strong> e o <strong>Importar Admissões</strong> no menu.</p>
        </div>
      </div>`;
  };
  // ════════════════════════════════════════════════════════════════════════
  // TELA 5 — MÉDICOS & CLÍNICAS (V706): NÃO replica o cadastro do módulo
  // MÉDICOS — usa os nomes JÁ cadastrados nesta mesma base, só para definir
  // o vínculo (EXTERNO/HÍBRIDO) e a CLÍNICA de cada médico.
  // ════════════════════════════════════════════════════════════════════════

  const stMed = { busca: '', soExternos: true };

  App.telas['externos-medicos'] = function () {
    U().garantirEstilos('ext-css', CSS);
    const cont = document.getElementById('conteudo');

    const clinicas = Banco.query(`SELECT * FROM externos_clinicas WHERE ativo = 1 ORDER BY nome`);
    // médicos que aparecem na matriz (pra ordenar os relevantes primeiro)
    const naMatriz = new Set(window.AtlasExternos.analisarTodas().map(d => d.medico && d.medico.id).filter(Boolean));

    let medicos = Banco.query(`SELECT m.*, c.nome AS clinica_nome FROM medicos m
                                 LEFT JOIN externos_clinicas c ON c.id = m.clinica_externa_id
                                WHERE m.ativo = 1 ORDER BY m.nome_oficial`);
    if (stMed.soExternos) medicos = medicos.filter(m => m.tipo_vinculo === 'EXTERNO' || m.tipo_vinculo === 'HIBRIDO' || naMatriz.has(m.id));
    const busca = U().normalizar(stMed.busca);
    if (busca) medicos = medicos.filter(m => U().normalizar(m.nome_oficial).includes(busca));
    medicos.sort((a, b) => (naMatriz.has(b.id) ? 1 : 0) - (naMatriz.has(a.id) ? 1 : 0) || a.nome_oficial.localeCompare(b.nome_oficial, 'pt-BR'));

    cont.innerHTML = `
      <div class="page-content">
        <header class="page-header">
          <h2>Médicos & Clínicas</h2>
          <p class="subtitle">Os médicos vêm do cadastro único da ferramenta (módulo MÉDICOS) — aqui você só define o vínculo e a clínica de cada um. Nada é recadastrado.</p>
        </header>

        <div class="ext-filtros">
          <input type="text" class="input" id="ext-med-busca" placeholder="Buscar médico pelo nome…" value="${escapar(stMed.busca)}">
          <label style="display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--ink-soft); cursor:pointer">
            <input type="checkbox" id="ext-med-so" ${stMed.soExternos ? 'checked' : ''}>
            Só externos, híbridos e quem aparece na matriz
          </label>
        </div>

        <div class="card" style="padding:0; overflow:hidden">
          <table class="ext-tab" style="border:none">
            <thead><tr><th>Médico</th><th>Vínculo</th><th>Clínica</th><th>CNPJ da clínica</th></tr></thead>
            <tbody>
              ${!medicos.length ? `<tr><td colspan="4" style="text-align:center; color:var(--ink-faint); padding:20px">
                  ${stMed.busca ? 'Nenhum médico com esse nome.' : 'Nenhum médico externo/híbrido ainda — desmarque o filtro acima para ver o cadastro completo.'}
                </td></tr>` : ''}
              ${medicos.map(m => `<tr data-med-id="${m.id}">
                <td>${escapar(m.nome_oficial)}${naMatriz.has(m.id) ? ' <span class="ext-chip ext-chip-hib" title="Tem admissões na Matriz Externa">NA MATRIZ</span>' : ''}</td>
                <td>
                  <select class="select ext-fil-select" data-ext-med-tipo style="min-width:130px">
                    <option value="" ${!m.tipo_vinculo ? 'selected' : ''}>— sem tipo —</option>
                    <option value="INTERNO" ${m.tipo_vinculo === 'INTERNO' ? 'selected' : ''}>Interno</option>
                    <option value="HIBRIDO" ${m.tipo_vinculo === 'HIBRIDO' ? 'selected' : ''}>Híbrido</option>
                    <option value="EXTERNO" ${m.tipo_vinculo === 'EXTERNO' ? 'selected' : ''}>Externo</option>
                  </select>
                </td>
                <td>
                  <select class="select ext-fil-select" data-ext-med-clinica style="min-width:190px">
                    <option value="" ${!m.clinica_externa_id ? 'selected' : ''}>— sem clínica —</option>
                    ${clinicas.map(c => `<option value="${c.id}" ${m.clinica_externa_id === c.id ? 'selected' : ''}>${escapar(c.nome)}</option>`).join('')}
                    <option value="__nova__">＋ Cadastrar nova clínica…</option>
                  </select>
                </td>
                <td style="font-family:var(--font-mono); font-size:12px; color:var(--ink-faint)">${escapar((clinicas.find(c => c.id === m.clinica_externa_id) || {}).cnpj || '—')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p class="small muted" style="margin-top:10px">Cadastro completo (CRM, e-mail, especialidades…) continua no módulo <strong>MÉDICOS</strong> do modo normal. As clínicas também podem ser editadas na <strong>Base de Cálculo</strong>.</p>
      </div>`;

    // binds
    const inB = cont.querySelector('#ext-med-busca');
    let tmr = null;
    inB.addEventListener('input', () => {
      clearTimeout(tmr);
      tmr = setTimeout(() => {
        const pos = inB.selectionStart;
        stMed.busca = inB.value;
        App.telas['externos-medicos']();
        const novo = document.getElementById('ext-med-busca');
        if (novo) { novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (_) {} }
      }, 250);
    });
    cont.querySelector('#ext-med-so').addEventListener('change', (e) => {
      stMed.soExternos = e.target.checked;
      App.telas['externos-medicos']();
    });

    cont.querySelectorAll('[data-ext-med-tipo]').forEach(sel => sel.addEventListener('change', () => {
      const id = sel.closest('tr').dataset.medId;
      Banco.executar(`UPDATE medicos SET tipo_vinculo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`, [sel.value || null, id]);
      window.AtlasExternos._limparCache();
      Banco.salvarDebounced();
      U().toast('Vínculo salvo', 'success', 1400);
    }));

    cont.querySelectorAll('[data-ext-med-clinica]').forEach(sel => sel.addEventListener('change', () => {
      const id = sel.closest('tr').dataset.medId;
      if (sel.value === '__nova__') {
        modal('Nova clínica', `
          <div class="field"><label>Nome da clínica</label><input type="text" class="input" id="ext-nc-nome"></div>
          <div class="field"><label>CNPJ (opcional)</label><input type="text" class="input" id="ext-nc-cnpj"></div>`,
          (f) => {
            const nome = f.querySelector('#ext-nc-nome').value.trim();
            if (!nome) { U().toast('Dê um nome à clínica', 'error'); return false; }
            const cnpj = f.querySelector('#ext-nc-cnpj').value.trim() || null;
            const jaTem = Banco.queryUnica(`SELECT id FROM externos_clinicas WHERE nome = ?`, [nome]);
            const clinId = jaTem ? jaTem.id
              : Banco.executar(`INSERT INTO externos_clinicas (nome, cnpj) VALUES (?, ?)`, [nome, cnpj]).lastInsertRowId;
            Banco.executar(`UPDATE medicos SET clinica_externa_id = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`, [clinId, id]);
            window.AtlasExternos._limparCache();
            Banco.salvarDebounced();
            App.telas['externos-medicos']();
          });
        return;
      }
      Banco.executar(`UPDATE medicos SET clinica_externa_id = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`, [sel.value ? Number(sel.value) : null, id]);
      window.AtlasExternos._limparCache();
      Banco.salvarDebounced();
      App.telas['externos-medicos']();
    }));
  };

  // ════════════════════════════════════════════════════════════════════════
  // TELA 6 — RELATÓRIOS EXTERNOS (V828): o FIM da esteira do Externo, no
  // espírito do RELATÓRIOS do ATLAS. Chega um relatório com admissão + nome do
  // paciente; o módulo o lê, cruza cada admissão com a PRODUÇÃO (mesmo motor
  // da Matriz) e monta a extração final por MÉDICO — o arquivo que vai para
  // cada um, com os produtos do repasse e as contas.
  // ════════════════════════════════════════════════════════════════════════

  const REL_KEY = 'extrel_lista_v1';
  const lerRelLista = () => { try { return JSON.parse(localStorage.getItem(REL_KEY) || 'null') || null; } catch (_) { return null; } };
  const salvarRelLista = (l) => { try { l ? localStorage.setItem(REL_KEY, JSON.stringify(l)) : localStorage.removeItem(REL_KEY); } catch (_) {} };
  const stRel = { fMedico: '' };

  function dossiesDaLista(lista) {
    garantirColunas();
    return (lista ? lista.admissoes : []).map(cod => {
      // admissão fora da matriz também é analisada — o cruzamento é com a
      // PRODUÇÃO, e as regras (ajustes, escolha de médico) valem quando existem
      const adm = Banco.queryUnica(`SELECT * FROM externos_admissoes WHERE cod_admissao = ?`, [String(cod)])
        || { cod_admissao: String(cod) };
      return window.AtlasExternos.analisar(adm);
    });
  }
  function gruposPorMedico(dossies) {
    const grupos = new Map();
    for (const d of dossies) {
      const chave = d.medico ? d.medico.nome_oficial : (d.medicoNome || '— sem médico identificado —');
      if (!grupos.has(chave)) grupos.set(chave, { nome: chave, medico: d.medico, itens: [] });
      grupos.get(chave).itens.push(d);
    }
    return [...grupos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  /**
   * V831: a lista de produtos do relatório do médico usa a NOMENCLATURA DE
   * REPASSE, não o inventário inteiro da produção — MAT/MED (aventais, campos,
   * seringas…) não entra no repasse. O que aparece:
   *  · o(s) procedimento(s) principal(is) da admissão;
   *  · a LIO identificada (ela é deduzida — precisa aparecer nomeada);
   *  · os OPMEs deduzidos (ISTENT etc.).
   */
  const produtosDe = (d) => {
    const principais = [...new Set(d.linhas.map(l =>
      String(l.procedimento_principal || '').trim()).filter(Boolean))];
    const comuns = principais.length ? principais
      : [...new Set(d.linhas
          .filter(l => !(d.lio && d.lio.linhaId === l.id) && !d.opmeLinhas.includes(l.id))
          .map(l => String(l.produto || '').trim()).filter(Boolean))];
    const extras = [];
    if (d.lio) extras.push(`LIO: ${d.lio.nome}`);
    for (const id of d.opmeLinhas) {
      const l = d.linhas.find(x => x.id === id);
      const nome = l ? String(l.produto || l.procedimento_principal || '').trim() : '';
      if (nome) extras.push(`OPME: ${nome}`);
    }
    return comuns.concat(extras);
  };

  App.telas['externos-relatorios'] = function () {
    U().garantirEstilos('ext-css', CSS);
    const cont = document.getElementById('conteudo');
    const lista = lerRelLista();
    const dossies = lista ? dossiesDaLista(lista) : [];
    const fMed = U().normalizar(stRel.fMedico || '');
    const grupos = gruposPorMedico(dossies).filter(g => !fMed || U().normalizar(g.nome).includes(fMed));
    const totalGeral = grupos.reduce((s, g) => s + g.itens.reduce((t, d) => t + d.repasse, 0), 0);
    const semProducao = dossies.filter(d => !d.linhas.length).length;

    cont.innerHTML = `
      <div class="page-content">
        <header class="page-header">
          <h2>Relatórios Externos</h2>
          <p class="subtitle">Fim do processo — o relatório recebido (admissão + paciente) é cruzado com a PRODUÇÃO e vira a extração final por médico.</p>
        </header>

        <div class="card" style="padding:16px; margin-bottom:14px">
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap">
            <button class="btn btn-primary" id="extrel-abrir-arquivo"><i class="ti ti-file-import"></i> Importar relatório</button>
            <input type="file" id="extrel-arquivo" accept=".xlsx,.xls,.csv" style="display:none">
            ${lista ? `
              <span class="small muted">${escapar(lista.nomeArquivo || '(arquivo)')} · ${lista.admissoes.length} admissã${lista.admissoes.length === 1 ? 'o' : 'ões'}${lista.desconhecidas ? ` · <span style="color:var(--danger)">${lista.desconhecidas} fora da PRODUÇÃO (descartadas)</span>` : ''}</span>
              <button class="btn btn-secondary" id="extrel-extrair"><i class="ti ti-download"></i> Extrair Excel (por médico)</button>
              <button class="ext-acao" id="extrel-limpar">Limpar lista</button>` : `
              <span class="small muted">Importe o relatório enviado (com a admissão e o nome do paciente) — .xlsx, .xls ou .csv.</span>`}
          </div>
          <div id="extrel-msg"></div>
        </div>

        ${lista ? `
        <div class="ext-kpis">
          ${U().cardKPI('Admissões do relatório', String(dossies.length), '', '', 'ext-kpi')}
          ${U().cardKPI('Médicos', String(gruposPorMedico(dossies).length), '', '', 'ext-kpi')}
          ${U().cardKPI('Repasse total', fm(dossies.reduce((s, d) => s + d.repasse, 0)), '', '', 'ext-kpi')}
        </div>
        ${semProducao ? `<div class="card" style="border-color:#D8B25A; background:var(--warning-soft); padding:10px 14px; margin-bottom:14px; font-size:12.5px">
          <strong>${semProducao}</strong> admissã${semProducao > 1 ? 'ões' : 'o'} sem linhas na PRODUÇÃO — importe a produção do mês (modo normal → Importar → Produção).
        </div>` : ''}
        <div class="ext-filtros">
          <input type="text" class="input" id="extrel-fmed" placeholder="Filtrar por médico…" value="${escapar(stRel.fMedico)}">
          <span class="small muted" style="margin-left:auto">Total no filtro: <strong style="font-family:var(--font-mono)">${fm(totalGeral)}</strong></span>
        </div>
        ${grupos.map(g => {
          const totalG = g.itens.reduce((s, d) => s + d.repasse, 0);
          return `
          <div class="ext-medico">
            <div class="ext-medico-cab">
              <span class="nome">${escapar(g.nome)}</span>
              ${g.medico && g.medico.clinica_nome ? `<span class="clinica">${escapar(g.medico.clinica_nome)}</span>` : ''}
              ${g.medico && g.medico.tipo_vinculo ? Utilidades.badgeVinculo(g.medico.tipo_vinculo) : ''}<!-- V960 -->
              <span class="total">${fm(totalG)}</span>
            </div>
            <table class="ext-tab">
              <thead><tr><th>Admissão</th><th>Data</th><th>Paciente</th>
                <th title="Padrão do procedimento (a DESCRIÇÃO das planilhas de repasse) + produtos da produção">Descrição (padrão)</th>
                <th class="num">FAT</th><th class="num">Deduções</th><th class="num">Repasse</th></tr></thead>
              <tbody>
                ${g.itens.map(d => {
                  const l0 = d.linhas[0] || {};
                  const deducoes = d.opme + d.lioDeduzido + d.imposto + d.matmed + d.hmDeduzido;
                  return `<tr>
                    <td>${escapar(d.cod)}</td>
                    <td>${l0.data_admissao ? dataBR(l0.data_admissao) : '—'}</td>
                    <td>${escapar(l0.paciente || '—')}</td>
                    <td>${d.linhas.length
                      ? `<strong>${escapar(d.padrao || '—')}</strong>${d.pct !== window.AtlasExternos.base().cfg.indicacao ? ` <span class="small muted">(${d.pct}%)</span>` : ''}
                         <div class="small muted">${escapar(produtosDe(d).join(' · ') || '—')}</div>`
                      : '<span style="color:var(--danger)">sem linhas na PRODUÇÃO</span>'}</td>
                    <td class="num">${fm(d.fat)}</td>
                    <td class="num">${fm(deducoes)}</td>
                    <td class="num atlas-rep"><strong>${fm(d.repasse)}</strong></td><!-- V962 -->
                  </tr>`;
                }).join('')}
                <tr class="ext-total"><td colspan="6">TOTAL — ${escapar(g.nome)}</td>
                  <td class="num atlas-rep"><strong>${fm(totalG)}</strong></td></tr><!-- V963 -->
              </tbody>
            </table>
          </div>`;
        }).join('')}` : `
        <div class="card ext-vazio">
          <i class="ti ti-report"></i>
          <h3 style="margin:10px 0 6px">Nenhum relatório importado</h3>
          <p style="margin:0">Importe o relatório recebido — a ferramenta cruza as admissões com a PRODUÇÃO e monta a extração por médico.</p>
        </div>`}
      </div>`;

    // binds
    const inpArq = cont.querySelector('#extrel-arquivo');
    cont.querySelector('#extrel-abrir-arquivo').addEventListener('click', () => inpArq.click());
    inpArq.addEventListener('change', () => { if (inpArq.files.length) lerRelatorioExterno(inpArq.files[0]); inpArq.value = ''; });
    const bLimpar = cont.querySelector('#extrel-limpar');
    if (bLimpar) bLimpar.addEventListener('click', () => { salvarRelLista(null); App.telas['externos-relatorios'](); });
    const bExt = cont.querySelector('#extrel-extrair');
    if (bExt) bExt.addEventListener('click', extrairRelatoriosExternos);
    const fMedEl = cont.querySelector('#extrel-fmed');
    if (fMedEl) {
      let tmr = null;
      fMedEl.addEventListener('input', () => {
        clearTimeout(tmr);
        tmr = setTimeout(() => {
          const pos = fMedEl.selectionStart;
          stRel.fMedico = fMedEl.value;
          App.telas['externos-relatorios']();
          const novo = document.getElementById('extrel-fmed');
          if (novo) { novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (_) {} }
        }, 250);
      });
    }
  };

  /** lê o relatório recebido: números de admissão validados contra a PRODUÇÃO */
  async function lerRelatorioExterno(arquivo) {
    const msg = document.getElementById('extrel-msg');
    if (typeof XLSX === 'undefined') { U().toast('Biblioteca de planilha ainda carregando — tente de novo.', 'warning'); return; }
    if (msg) msg.innerHTML = `<p class="small muted" style="margin:10px 0 0">Lendo ${escapar(arquivo.name)}…</p>`;
    try {
      const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
      const candidatos = new Set();
      for (const aba of wb.SheetNames) {
        for (const linha of XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, defval: null, raw: true })) {
          for (const cel of (linha || [])) {
            if (cel == null) continue;
            if (typeof cel === 'number' && Number.isFinite(cel)) {
              const s = String(Math.round(cel));
              if (s.length >= 6 && s.length <= 10) candidatos.add(s);
            } else if (typeof cel === 'string') {
              for (const m of cel.matchAll(/\d{6,10}/g)) candidatos.add(m[0]);
            }
          }
        }
      }
      const listaC = [...candidatos];
      const naProducao = new Set();
      for (let i = 0; i < listaC.length; i += 500) {
        const fatia = listaC.slice(i, i + 500);
        Banco.query(`SELECT DISTINCT cod_admissao FROM linhas_producao WHERE cod_admissao IN (${fatia.map(() => '?').join(',')})`, fatia)
          .forEach(r => naProducao.add(String(r.cod_admissao)));
      }
      const admissoes = listaC.filter(c => naProducao.has(c));
      if (!admissoes.length) {
        if (msg) msg.innerHTML = `<p style="margin:10px 0 0; color:var(--danger); font-size:13px">Nenhuma admissão do arquivo está na PRODUÇÃO — confira se a produção do mês foi importada.</p>`;
        return;
      }
      salvarRelLista({ nomeArquivo: arquivo.name, admissoes, desconhecidas: listaC.length - admissoes.length });
      App.telas['externos-relatorios']();
      U().toast(`${admissoes.length} admissã${admissoes.length === 1 ? 'o' : 'ões'} no relatório`, 'success');
    } catch (e) {
      console.error('[EXTERNOS] relatório', e);
      if (msg) msg.innerHTML = `<p style="margin:10px 0 0; color:var(--danger); font-size:13px">Falha ao ler: ${escapar(e.message)}</p>`;
    }
  }

  /** extração final: aba-resumo + UMA ABA POR MÉDICO com produtos e contas */
  async function extrairRelatoriosExternos() {
    if (typeof ExcelJS === 'undefined') { U().toast('Biblioteca ExcelJS ainda carregando — tente de novo.', 'warning'); return; }
    const lista = lerRelLista();
    if (!lista) return;
    const grupos = gruposPorMedico(dossiesDaLista(lista));
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ATLAS — Repasse Médico';
    const AZUL = 'FF107DAC';
    const cab = (ws, cols) => {
      ws.columns = cols;
      const h = ws.getRow(1);
      h.height = 20;
      h.eachCell(c => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
        c.alignment = { vertical: 'middle', horizontal: 'center' };
      });
    };
    const moeda = Utilidades.FMT_EXPORT_MOEDA;

    const wr = wb.addWorksheet('Resumo', { views: [{ showGridLines: false }] });
    cab(wr, [
      { header: 'MÉDICO', key: 'med', width: 38 }, { header: 'CLÍNICA', key: 'cli', width: 28 },
      { header: 'VÍNCULO', key: 'tip', width: 12 }, { header: 'ADMISSÕES', key: 'n', width: 12 },
      { header: 'REPASSE TOTAL', key: 'tot', width: 18 },
    ]);
    const usados = new Set();
    for (const g of grupos) {
      const totalG = g.itens.reduce((s, d) => s + d.repasse, 0);
      const r = wr.addRow({ med: g.nome, cli: (g.medico && g.medico.clinica_nome) || '—',
        tip: (g.medico && g.medico.tipo_vinculo) || '—', n: g.itens.length, tot: totalG });
      r.getCell('tot').numFmt = moeda;
      r.getCell('n').alignment = { horizontal: 'center' };
      if (g.medico && g.medico.tipo_vinculo) Utilidades.pintarCelulaVinculo(r.getCell('tip'), g.medico.tipo_vinculo);   // V960: rótulo + cor da tag

      // aba do médico (nome de aba: até 31 chars, sem repetição/estranhos)
      let nomeAba = String(g.nome).replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || 'MÉDICO';
      while (usados.has(nomeAba)) nomeAba = nomeAba.slice(0, 29) + '·' + usados.size;
      usados.add(nomeAba);
      /**
       * V840: a aba do médico sai no FORMATO DO PROCESSO (as planilhas de
       * cálculo manuais): ADMISSÃO · PACIENTE · DATA · CONVENIO · DESCRIÇÃO
       * (padrão do procedimento) · FAT TOTAL · OPME · imposto · MAT/MED · HM ·
       * DEDUÇÕES (o líquido pós-deduções) · INDICAÇÃO · VALOR DE REPASSE.
       * O custo da LIO em parceria entra na coluna OPME (como no manual);
       * LIO valor ATLAS não deduz e o percentual muda — a DESCRIÇÃO mostra o %.
       */
      const cfgB = window.AtlasExternos.base().cfg;
      const ws = wb.addWorksheet(nomeAba, { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
      cab(ws, [
        { header: 'ADMISSÃO', key: 'adm', width: 13 },
        { header: 'PACIENTE', key: 'pac', width: 32 },
        { header: 'DATA', key: 'data', width: 12 },
        { header: 'CONVENIO', key: 'conv', width: 16 },
        { header: 'DESCRIÇÃO', key: 'desc', width: 34 },
        { header: 'FAT TOTAL', key: 'fat', width: 13 },
        { header: 'OPME', key: 'opme', width: 12 },
        { header: `${cfgB.imposto}% DE IMPOSTO`, key: 'imp', width: 15 },
        { header: 'MAT/MED', key: 'mat', width: 12 },
        { header: 'HM', key: 'hm', width: 11 },
        { header: 'DEDUÇÕES', key: 'ded', width: 13 },
        { header: 'INDICAÇÃO', key: 'ind', width: 13 },
        { header: 'VALOR DE REPASSE', key: 'rep', width: 17 },
      ]);
      for (const d of g.itens) {
        const l0 = d.linhas[0] || {};
        const r2 = ws.addRow({ adm: d.cod,
          pac: l0.paciente || '—',
          data: l0.data_admissao ? dataBR(l0.data_admissao) : '—',
          conv: l0.convenio || '—',
          desc: d.linhas.length
            ? (d.padrao || produtosDe(d).join(' · ') || '—') + (d.pct !== cfgB.indicacao ? ` (${d.pct}%)` : '')
            : 'SEM LINHAS NA PRODUÇÃO',
          fat: d.fat, opme: d.opme + d.lioDeduzido, imp: d.imposto, mat: d.matmed,
          hm: d.hm, ded: d.liquido, ind: d.indicacao, rep: d.repasse });
        ['fat', 'opme', 'imp', 'mat', 'hm', 'ded', 'ind', 'rep'].forEach(k => { r2.getCell(k).numFmt = moeda; });
        ['adm', 'data'].forEach(k => { r2.getCell(k).alignment = { horizontal: 'center' }; });
        r2.getCell('desc').alignment = { wrapText: true, vertical: 'middle' };
      }
      const rt = ws.addRow({ pac: `TOTAL — ${g.nome}`, rep: totalG });
      rt.font = { bold: true };
      rt.getCell('rep').numFmt = moeda;
    }

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `relatorios_externos_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    U().toast('Extração gerada — uma aba por médico', 'success', 2600);
  }

})();
