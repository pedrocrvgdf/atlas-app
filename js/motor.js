/**
 * ============================================================================
 * ATLAS — MOTOR DE AUDITORIA (produção × repasse)
 *
 * A pergunta que este módulo responde, admissão por admissão:
 *   "Pelo que foi PRODUZIDO e pelas REGRAS conhecidas, quanto o médico
 *    deveria ter recebido — e foi pago A QUEM DEVIA?"
 *
 * As regras de negócio são a METODOLOGIA ATLAS — o detalhamento de cada
 * uma está em docs/METODOLOGIA.md:
 *
 *   · O RELATÓRIO DO SISTEMA tem duas colunas de peso MUITO diferente:
 *     RECEBIDO é o que o pagador pagou (0 em convênio/SUS = GLOSA, e glosa
 *     não é dívida da casa); REPASSADO é só o que o sistema DIZ que passou
 *     ao médico — nem toda regra está cadastrada lá e ele muitas vezes não
 *     segue a Base Tabela, então REPASSADO nunca define o esperado nem
 *     valida sozinho um pagamento (pago sem regra conhecida = SEM REGRA,
 *     não "OK").
 *   · "Pago a quem devia" é a pergunta certa, não "pago?" — valor pago a
 *     OUTRO médico não quita a dívida.
 *   · O AUXILIAR acompanha o EXECUTANTE: o valor do papel de auxiliar
 *     pertence ao cirurgião/executante do procedimento.
 *   · Profissional INSTITUCIONAL nunca tem repasse — papel dele é isento,
 *     cobrá-lo seria alerta falso (marcador configurável).
 *   · GLOSA: procedimento recusado pelo pagador não gera dívida — os papéis
 *     aparecem, valendo zero; papéis ausentes herdam a glosa.
 *   · Cobrança papel-a-papel só em produto REPASSÁVEL (consulta/exame/
 *     procedimento); material/medicamento/taxa/OPME/gás/diária ficam fora —
 *     cobrar papel deles é inventar dívida.
 *   · Regra com valor E percentual zerados NÃO remunera.
 *   · Admissões casam por normAdm — só dígitos, sem zeros à esquerda.
 *
 * SÓ HÁ CÁLCULO DE REPASSE COM BASE TABELA. O valor esperado de cada papel
 * sai da BASE TABELA do hospital (procedimento × papel × fonte) e de mais
 * lugar nenhum: sem tabela carregada não há como saber o que deveria ter
 * sido pago, então não se cobra. Os papéis avaliados são os que a Base
 * REMUNERA (valor ou percentual diferente de zero) — papel que a tabela não
 * remunera não é divergência, é o desenho dela (consulta com solicitante,
 * por exemplo). O PADRÃO INFERIDO do histórico continua sendo calculado,
 * mas só como SUGESTÃO na tela Base Tabela: entra no cálculo quando (e se) o
 * usuário promover o padrão a regra.
 *
 * O CAMINHO DA ADMISSÃO (por que nem tudo que falta é dívida): recepção
 * abre a admissão → faturista fatura → convênio audita → convênio paga (se
 * não glosar) → a CONCILIAÇÃO quita o pagamento no sistema → só então a
 * linha aparece no relatório do sistema. Isso leva meses: atendimento em
 * maio pode ser recebido em outubro. Logo, admissão produzida que ainda NÃO
 * apareceu em relatório nenhum do sistema não é dívida — está no caminho
 * (status AGUARDANDO). Dívida é o que o sistema já mostra recebido e não
 * repassou.
 *
 * Cada relatório mensal do sistema é o que será pago NAQUELE mês (o mês da
 * competência); um mês não sobrepõe o outro, porque a admissão que ainda não
 * foi quitada simplesmente não está no relatório.
 *
 * Semântica do filtro de competência: filtra a PRODUÇÃO (mês do
 * atendimento). O repasse é buscado POR ADMISSÃO em todo o histórico —
 * produção de abril paga em junho conta como paga.
 *
 * Status por item:
 *   OK            pago (a quem devia) dentro da tolerância
 *   A_MENOR       pago abaixo do esperado
 *   A_MAIOR       pago acima do esperado
 *   AGUARDANDO    a admissão ainda não apareceu em relatório nenhum do
 *                 sistema (faturamento/auditoria do convênio/conciliação) —
 *                 não é dívida, é caminho
 *   NAO_PAGO      esperado > 0 e nada pago (motivo: nao_pago | sem_medico)
 *   PAGO_A_OUTRO  o papel foi pago, mas a outro médico — dívida continua
 *   GLOSA         procedimento glosado (Recebido = 0) — visível, valendo zero
 *   SEM_REGRA     sem Base e sem padrão confiável — não dá para avaliar
 *                 (inclusive quando o sistema pagou: sem regra não se afirma
 *                  que o valor está certo)
 *   NAO_PAREADO   pagamento que não casou com nenhum item da produção
 *
 * Resultado memoizado por (filtros | Banco._versao) — qualquer gravação no
 * banco invalida o cache automaticamente (convenção da casa).
 * ============================================================================
 */
(function () {
  'use strict';
  const U = () => window.Utilidades;

  const SEVERIDADE = {
    NAO_PAGO: 8, PAGO_A_OUTRO: 7, A_MENOR: 6, SEM_REGRA: 5,
    NAO_PAREADO: 4, A_MAIOR: 3, AGUARDANDO: 2.5, GLOSA: 2, OK: 0,
  };

  /** Classificações que NÃO passam pela cobrança papel-a-papel. */
  const CLASS_NAO_REPASSAVEL = new Set([
    'MATERIAL', 'MEDICAMENTO', 'MAT MED', 'MATMED', 'MAT/MED',
    'TAXA', 'OPME', 'GAS', 'DIARIA',
  ]);

  // cache de resultados com várias entradas: Visão, Auditoria, Relatórios e
  // Inspeção pedem recortes diferentes e não podem se expulsar do cache
  const _caches = new Map();
  const MAX_CACHES = 8;
  const cacheLer = (chave) => _caches.get(chave) || null;
  const cacheGravar = (chave, resultado) => {
    if (_caches.size >= MAX_CACHES) _caches.delete(_caches.keys().next().value);
    _caches.set(chave, resultado);
  };
  let _cacheSemProd = { chave: null, lista: null };
  let _cacheInfer = { chave: null, padroes: null };
  let _cacheSin = { chave: null, mapa: null };

  function cfgNum(chave, padrao) {
    const v = Number(Banco.configLer(chave, padrao));
    return isFinite(v) ? v : padrao;
  }

  /**
   * GLOSA de uma linha do SISTEMA — a regra da casa (docs/METODOLOGIA.md §5):
   * o pagador não pagou, então não há repasse devido e não há dívida.
   *
   *   RECEBIDO = 0  em convênio/SUS  → glosa (o sinal que MANDA)
   *   RECEBIDO null                  → o relatório não trouxe a coluna: cai no
   *                                    texto de status, como antes da v0.8.1
   *   PARTICULAR                     → não tem glosa (o paciente paga direto);
   *                                    zero ali não quer dizer recusa
   */
  function ehGlosa(lr) {
    if (!lr) return false;
    if (/glosa/i.test(String(lr.status || ''))) return true;
    if (lr.recebido == null) return false;
    return Number(lr.recebido) <= 0 && U().classificarFonte(lr.fonte) !== 'PARTICULAR';
  }

  /** O pagador pagou esta linha? (só quando o relatório trouxe a coluna RECEBIDO) */
  function foiRecebida(lr) {
    return !!lr && lr.recebido != null && Number(lr.recebido) > 0;
  }

  // linhas que NÃO servem para aprender padrão: glosadas (pagaram zero) puxariam
  // a moda para baixo e inventariam uma "regra" que o hospital nunca teve
  const SQL_SEM_GLOSA =
    ` AND (recebido IS NULL OR recebido > 0 OR UPPER(TRIM(COALESCE(fonte, ''))) = 'PARTICULAR')
      AND UPPER(COALESCE(status, '')) NOT LIKE '%GLOSA%'`;

  // ──────────────────────────────────────────────────────────────────────
  // DE-PARA DE MÉDICOS — grafia → nome oficial (quando cadastrado)
  // ──────────────────────────────────────────────────────────────────────
  function mapaSinonimos(clienteId) {
    const chave = clienteId + '|' + Banco._versao;
    if (_cacheSin.chave === chave) return _cacheSin.mapa;
    const mapa = new Map();
    const meds = Banco.query('SELECT id, nome_oficial, nome_norm FROM medicos WHERE cliente_id=?', [clienteId]);
    const porId = new Map();
    for (const m of meds) { porId.set(m.id, m); mapa.set(m.nome_norm, m.nome_oficial); }
    if (meds.length) {
      const sins = Banco.query(
        `SELECT s.grafia_norm, s.medico_id FROM sinonimos_medico s
         JOIN medicos m ON m.id = s.medico_id WHERE m.cliente_id=?`, [clienteId]);
      for (const s of sins) {
        const m = porId.get(s.medico_id);
        if (m) mapa.set(s.grafia_norm, m.nome_oficial);
      }
    }
    _cacheSin = { chave, mapa };
    return mapa;
  }

  /** Resolve um nome cru para o oficial (ou devolve o próprio, aparado). */
  function resolverMedico(nome, sinonimos) {
    const cru = String(nome || '').trim();
    if (!cru) return '';
    return sinonimos.get(U().normalizar(cru)) || cru;
  }

  /**
   * Profissional INSTITUCIONAL: nome que carrega a marca configurada
   * (ex.: a sigla do hospital) nunca tem repasse. Marca vazia = desligado.
   */
  function fnInstitucional() {
    const marca = U().normalizar(Banco.configLer('institucional_marca', ''));
    if (!marca) return () => false;
    return (nome) => {
      const n = U().normalizar(nome);
      return !!n && (' ' + n + ' ').includes(' ' + marca + ' ');
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // INFERÊNCIA DE PADRÃO — aprende as regras olhando o que JÁ FOI PAGO
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Varre TODO o histórico de repasses pagos do hospital e devolve
   * Map<`proc|papel|fonte`, padrão>, onde padrão =
   *   { tipo:'FIXO'|'PCT', valor, percentual, amostras, confianca }
   *
   * O que se aprende aqui é o COSTUME do sistema, não a regra do contrato: o
   * REPASSADO nem sempre segue a Base Tabela. Por isso o padrão inferido só
   * entra quando não há regra na Base, sempre com a origem 'INFERIDA' à
   * vista, e nunca aprende de linha GLOSADA (pagou zero por recusa do
   * pagador, não por regra).
   */
  function inferirPadroes(hospitalId) {
    const chave = hospitalId + '|' + Banco._versao;
    if (_cacheInfer.chave === chave) return _cacheInfer.padroes;

    const minAmostras = cfgNum('inferencia_min_amostras', 3);
    // O SQLite agrega (proc × papel × fonte × valor) — chega ao JS só o
    // histograma, não as centenas de milhares de linhas do histórico.
    const chaveDe = (r) => r.proc + '|' + (r.papel || 'EXECUTANTE') + '|' + (r.fonte || 'CONVENIO');
    const grupos = new Map();
    const grupo = (k) => { let g = grupos.get(k); if (!g) { g = { n: 0, valores: new Map(), razoes: [] }; grupos.set(k, g); } return g; };
    // valor unitário pago (linhas com quantidade > 1 normalizadas), com frequência
    for (const r of Banco.query(
      `SELECT procedimento_norm AS proc, papel_canon AS papel, fonte,
              ROUND(repassado / (CASE WHEN quantidade > 0 THEN quantidade ELSE 1 END), 2) AS unit, COUNT(*) AS f
         FROM linhas_repasse WHERE hospital_id = ? AND repassado > 0` + SQL_SEM_GLOSA + `
        GROUP BY 1, 2, 3, 4`, [hospitalId])) {
      const g = grupo(chaveDe(r));
      const v = Number(r.unit) || 0, f = Number(r.f) || 0;
      g.n += f; g.valores.set(v, (g.valores.get(v) || 0) + f);
    }
    // razão pago/produzido (4 casas), com frequência
    for (const r of Banco.query(
      `SELECT procedimento_norm AS proc, papel_canon AS papel, fonte,
              ROUND(repassado * 1.0 / produzido, 4) AS razao, COUNT(*) AS f
         FROM linhas_repasse WHERE hospital_id = ? AND repassado > 0 AND produzido > 0` + SQL_SEM_GLOSA + `
        GROUP BY 1, 2, 3, 4`, [hospitalId])) {
      grupo(chaveDe(r)).razoes.push([Number(r.razao) || 0, Number(r.f) || 0]);
    }

    const padroes = new Map();
    for (const [k, g] of grupos) {
      const n = g.n;
      if (n < minAmostras) continue;

      // hipótese VALOR FIXO: moda dos valores unitários
      let moda = 0, fModa = 0;
      for (const [v, f] of g.valores) if (f > fModa || (f === fModa && v > moda)) { moda = v; fModa = f; }
      const forcaFixo = fModa / n;

      // hipótese PERCENTUAL: mediana (ponderada) das razões pago/produzido + dispersão
      let forcaPct = 0, pctMediana = 0;
      const nRaz = g.razoes.reduce((s, [, f]) => s + f, 0);
      if (nRaz >= minAmostras) {
        const r = [...g.razoes].sort((a, b) => a[0] - b[0]);
        const medianaPonderada = (pares) => {   // pares [valor, freq] ordenados por valor
          const tot = pares.reduce((s, [, f]) => s + f, 0);
          let acc = 0;
          for (const [v, f] of pares) { acc += f; if (acc > tot / 2 || (acc === tot / 2 && f)) return v; }
          return pares.length ? pares[pares.length - 1][0] : 0;
        };
        pctMediana = medianaPonderada(r);
        if (pctMediana > 0 && pctMediana <= 1.5) {
          const desvios = r.map(([v, f]) => [Math.abs(v - pctMediana), f]).sort((a, b) => a[0] - b[0]);
          const mad = medianaPonderada(desvios);
          const dispersao = mad / pctMediana;             // 0 = perfeitamente estável
          const dentro = r.reduce((s, [v, f]) => s + (Math.abs(v - pctMediana) / pctMediana <= 0.02 ? f : 0), 0);
          forcaPct = (dispersao <= 0.05) ? dentro / nRaz : 0;
        }
      }

      // escolhe a hipótese mais forte; confiança pondera amostras (satura em 10)
      const pesoAmostras = Math.min(1, n / 10) * 0.3 + 0.7;
      if (forcaFixo >= 0.6 && forcaFixo >= forcaPct) {
        padroes.set(k, {
          tipo: 'FIXO', valor: moda, percentual: null,
          amostras: n, confianca: Math.round(forcaFixo * pesoAmostras * 100) / 100,
        });
      } else if (forcaPct >= 0.6) {
        padroes.set(k, {
          tipo: 'PCT', valor: null, percentual: Math.round(pctMediana * 10000) / 100,
          amostras: nRaz, confianca: Math.round(forcaPct * pesoAmostras * 100) / 100,
        });
      }
    }

    _cacheInfer = { chave, padroes };
    return padroes;
  }

  // ──────────────────────────────────────────────────────────────────────
  // REGRAS — Base Tabela primeiro, padrão inferido depois
  // ──────────────────────────────────────────────────────────────────────

  function carregarBase(hospitalId) {
    const regras = new Map();
    const rows = Banco.query(
      `SELECT procedimento_norm AS proc, papel, fonte, valor, percentual
         FROM base_tabela WHERE hospital_id = ?`, [hospitalId]);
    for (const r of rows) {
      regras.set(r.proc + '|' + r.papel + '|' + r.fonte, r);
    }
    return regras;
  }

  /**
   * Regra efetiva para (proc, papel, fonte): Base[fonte] → Base[TODAS] → null.
   * A Base é a ÚNICA fonte do esperado (o padrão inferido só vira regra
   * quando promovido na tela Base Tabela, e aí já está aqui dentro).
   */
  function acharRegra(base, proc, papel, fonte) {
    const r = base.get(proc + '|' + papel + '|' + fonte) || base.get(proc + '|' + papel + '|TODAS');
    return r ? { origem: 'BASE', valor: r.valor, percentual: r.percentual } : null;
  }

  /** A regra remunera de fato? (valor e percentual zerados = papel não remunerado) */
  function remunera(r) {
    return !!r && ((r.valor != null && Number(r.valor) !== 0) ||
                   (r.percentual != null && Number(r.percentual) !== 0));
  }

  /**
   * INDICANTE e SOLICITANTE são O MESMO PAPEL (regra da ferramenta de origem:
   * "só existe um dos dois; o padrão de exibição é sempre Indicante"). Um
   * pagamento de solicitante quita a exigência de indicante e vice-versa, e a
   * tabela nunca cobra os dois.
   */
  const ehIndSol = (p) => p === 'INDICANTE' || p === 'SOLICITANTE';

  /**
   * Papéis que a Base REMUNERA para (procedimento, fonte) — são eles, e só
   * eles, que a auditoria cobra. Vazio = a tabela não cobre este procedimento.
   * INDICANTE/SOLICITANTE entram UMA vez, sob o rótulo INDICANTE, com a regra
   * do indicante (ou a do solicitante, quando só ela existe).
   */
  function papeisDaBase(base, proc, fonte) {
    const out = [];
    let indSol = null;
    for (const papel of U().PAPEIS) {
      const r = acharRegra(base, proc, papel, fonte);
      if (!remunera(r)) continue;
      if (ehIndSol(papel)) {
        if (!indSol || papel === 'INDICANTE') indSol = { papel: 'INDICANTE', regra: r };
        continue;
      }
      out.push({ papel, regra: r });
    }
    if (indSol) out.push(indSol);
    return out;
  }

  function valorEsperado(regra, valorProducao, qtd) {
    if (!regra) return null;
    if (regra.valor != null && Number(regra.valor) !== 0) {
      return Math.round(Number(regra.valor) * (qtd || 1) * 100) / 100;
    }
    if (regra.percentual != null && Number(regra.percentual) !== 0) {
      return Math.round(Number(valorProducao) * Number(regra.percentual)) / 100;
    }
    return 0;   // regra existe mas zera o papel (papel não remunerado)
  }

  // ──────────────────────────────────────────────────────────────────────
  // AUDITORIA — o cruzamento
  // ──────────────────────────────────────────────────────────────────────

  // colunas da produção que o cruzamento usa (a íntegra tem 57 — não carregar tudo)
  const COLS_PROD = `id, hospital_id, competencia, admissao, admissao_norm, data, paciente, convenio, fonte,
    classificacao, procedimento, procedimento_norm, quantidade, valor, executante, auxiliar, indicante,
    solicitante, laudo, cirurgiao, medico`;

  /**
   * @param {object} f  { clienteId, hospitalId (0 = todos), competencia ('' = todas),
   *                      admissoes (opcional: só estas admissões — códigos em
   *                      qualquer grafia; é o caminho da Inspeção, que nunca
   *                      carrega a base inteira) }
   * @returns { kpis, admissoes[], porMedico Map, semProducao[], geradoEm }
   */
  function auditar(f) {
    const U_ = U();
    const admFiltro = Array.isArray(f.admissoes)
      ? [...new Set(f.admissoes.map(a => U_.normAdm(a)).filter(Boolean))] : null;
    const chave = [f.clienteId, f.hospitalId || 0, f.competencia || '', Banco._versao,
      admFiltro ? admFiltro.join(',') : '*'].join('|');
    const emCache = cacheLer(chave);
    if (emCache) return emCache;
    Banco.garantirNormalizados();

    // consulta por lotes de admissões (IN de até 800 por vez)
    const consultar = (sqlBase, params, ordem, adms) => {
      if (!adms) return Banco.query(sqlBase + ordem, params);
      const out = [];
      for (let i = 0; i < adms.length; i += 800) {
        const lote = adms.slice(i, i + 800);
        out.push(...Banco.query(sqlBase + ` AND admissao_norm IN (${lote.map(() => '?').join(',')})` + ordem,
          params.concat(lote)));
      }
      return out;
    };
    const tol = cfgNum('tolerancia_centavos', 0.05);
    const limiarFuzzy = cfgNum('fuzzy_limiar', 0.88);
    const sinonimos = mapaSinonimos(f.clienteId);
    const ehInst = fnInstitucional();

    // ── carrega produção (filtrada) e repasse (por admissão, sem filtro de mês)
    let sqlProd = `SELECT ${COLS_PROD} FROM linhas_producao WHERE cliente_id = ?`;
    const pProd = [f.clienteId];
    if (f.hospitalId) { sqlProd += ' AND hospital_id = ?'; pProd.push(f.hospitalId); }
    if (f.competencia) { sqlProd += ' AND competencia = ?'; pProd.push(f.competencia); }
    const prod = consultar(sqlProd, pProd, ' ORDER BY admissao, id', admFiltro);

    // o SISTEMA só das admissões em jogo: com filtro de competência, as da
    // produção do mês (o pagamento pode cair em qualquer mês, mas a admissão é
    // a mesma) — nunca a tabela inteira a cada tela
    let admsRep = admFiltro;
    if (!admsRep && f.competencia) {
      admsRep = [...new Set(prod.map(l => l.admissao_norm || U_.normAdm(l.admissao)).filter(Boolean))];
    }
    let sqlRep = 'SELECT * FROM linhas_repasse WHERE cliente_id = ?';
    const pRep = [f.clienteId];
    if (f.hospitalId) { sqlRep += ' AND hospital_id = ?'; pRep.push(f.hospitalId); }
    const rep = consultar(sqlRep, pRep, ' ORDER BY admissao, id', admsRep);

    // regras por hospital (pode haver mais de um no filtro "todos"). A
    // inferência NÃO entra aqui: ela é sugestão da tela Base Tabela, não regra.
    const hospitais = new Set(prod.map(l => l.hospital_id).concat(rep.map(l => l.hospital_id)));
    const basePorHosp = new Map();
    const semBase = [];
    for (const h of hospitais) {
      const b = carregarBase(h);
      basePorHosp.set(h, b);
      if (!b.size) semBase.push(h);
    }

    // repasse indexado por admissão NORMALIZADA (normAdm)
    const repPorAdm = new Map();
    for (const l of rep) {
      const adm = U_.normAdm(l.admissao);
      if (!repPorAdm.has(adm)) repPorAdm.set(adm, []);
      repPorAdm.get(adm).push(Object.assign({ _consumida: false }, l));
    }

    // produção agrupada por admissão normalizada
    const prodPorAdm = new Map();
    for (const l of prod) {
      const adm = U_.normAdm(l.admissao);
      if (!prodPorAdm.has(adm)) prodPorAdm.set(adm, []);
      prodPorAdm.get(adm).push(l);
    }

    const PAPEIS_PROD = [
      ['EXECUTANTE', 'executante'], ['AUXILIAR', 'auxiliar'], ['INDICANTE', 'indicante'],
      ['SOLICITANTE', 'solicitante'], ['LAUDO', 'laudo'],
    ];

    const admissoes = [];
    const porMedico = new Map();

    /** Sem regra não vira dívida, mas o que foi pago é do médico — entra no consolidado. */
    const registrarSemRegra = (item) => {
      const reg = registroMedico(item.medico);
      reg.pago += item.pago || 0;
      reg.nItens++;
      return item;
    };

    const registroMedico = (nome) => {
      if (!nome) nome = '(sem profissional)';
      const k = U_.normalizar(nome) || nome;
      let reg = porMedico.get(k);
      if (!reg) {
        reg = { medico: nome, esperado: 0, pago: 0, falta: 0, nItens: 0, nPendencias: 0, itensPendentes: [] };
        porMedico.set(k, reg);
      }
      return reg;
    };

    for (const [adm, itensProd] of prodPorAdm) {
      const repAdm = repPorAdm.get(adm) || [];
      const itens = [];

      // Glosa e recebimento são do PROCEDIMENTO, não da linha:
      //   glosaPorProc    procNorm → papéis com linha glosada (Recebido = 0)
      //   recebidoPorProc procedimentos que o pagador PAGOU — se o dinheiro
      //                   entrou e nada foi repassado, a dívida tem nome
      const glosaPorProc = new Map();
      const recebidoPorProc = new Set();
      for (const lr of repAdm) {
        const glosa = ehGlosa(lr), recebida = foiRecebida(lr);
        if (!glosa && !recebida) continue;
        for (const lp of itensProd) {
          if (lr.procedimento_norm === lp.procedimento_norm ||
              U_.similaridade(lr.procedimento_norm, lp.procedimento_norm) >= limiarFuzzy) {
            if (recebida) recebidoPorProc.add(lp.procedimento_norm);
            if (!glosa) continue;
            if (!glosaPorProc.has(lp.procedimento_norm)) glosaPorProc.set(lp.procedimento_norm, new Set());
            if (lr.papel_canon) glosaPorProc.get(lp.procedimento_norm).add(lr.papel_canon);
          }
        }
        // linha glosada não é pagamento nem "não pareado" — mas se o sistema
        // repassou alguma coisa nela, o dinheiro saiu e continua contando
        if (glosa && !(Number(lr.repassado) > 0)) lr._consumida = true;
      }

      // a admissão nunca apareceu em relatório nenhum do sistema: ainda está
      // no caminho (faturamento → convênio → conciliação), não é dívida
      const aguardandoConciliacao = repAdm.length === 0;

      for (const lp of itensProd) {
        const base = basePorHosp.get(lp.hospital_id) || new Map();
        const procN = lp.procedimento_norm;
        const procCasa = (lr) => lr.procedimento_norm === procN ||
          U_.similaridade(lr.procedimento_norm, procN) >= limiarFuzzy;

        /**
         * Produto NÃO REPASSÁVEL (material, taxa, OPME…) não passa pela
         * cobrança papel-a-papel. Pagamentos dele viram itens informativos
         * (o que foi pago aparece; nada é cobrado).
         */
        if (lp.classificacao && CLASS_NAO_REPASSAVEL.has(lp.classificacao)) {
          for (const lr of repAdm) {
            if (lr._consumida || !(Number(lr.repassado) > 0) || !procCasa(lr)) continue;
            lr._consumida = true;
            itens.push({
              admissao: adm, hospital_id: lp.hospital_id, competencia: lp.competencia,
              data: lp.data, paciente: lp.paciente, convenio: lp.convenio, fonte: lp.fonte,
              procedimento: lp.procedimento, quantidade: lp.quantidade,
              valorProducao: lp.valor, papel: lr.papel_canon || lr.papel || '—',
              medico: resolverMedico(lr.medico, sinonimos),
              regra: null, esperado: null, pago: Number(lr.repassado), pagoOutro: 0,
              diferenca: null, falta: 0, status: 'OK', motivo: 'fora_da_base', pagoA: '',
            });
          }
          continue;
        }

        const cru = (col) => String(lp[col] || '').trim();
        // EXECUTANTE da produção: a coluna do executante; se vazia, o cirurgião;
        // se vazia, o médico (a mesma cadeia da ferramenta de origem)
        const execDaLinha = resolverMedico(cru('executante') || cru('cirurgiao') || cru('medico'), sinonimos);

        /**
         * A QUEM PERTENCE O PAPEL — as regras do módulo Auditoria da ferramenta
         * de origem, na letra. O papel que a Base exige e o sistema não pagou
         * tem dono: a PRODUÇÃO diz quem é, pelas colunas de papel.
         *
         *   EXECUTANTE  executante → cirurgião → médico
         *   AUXILIAR    o EXECUTANTE do procedimento (o valor do auxiliar é
         *               sempre dele); sem executante, o nome da coluna auxiliar
         *   INDICANTE   indicante → solicitante → (nenhum dos dois: o valor vai
         *               para o EXECUTANTE, marcado como "indicante não informado")
         *   demais      a coluna do próprio papel (laudo, anestesista…)
         *
         * Devolve { nome, motivo } — o motivo só existe quando a atribuição
         * precisa aparecer escrita no relatório.
         */
        const donoDoPapel = (papel) => {
          if (papel === 'EXECUTANTE') return { nome: execDaLinha, motivo: null };
          if (papel === 'AUXILIAR') {
            return { nome: execDaLinha || resolverMedico(cru('auxiliar'), sinonimos), motivo: null };
          }
          if (ehIndSol(papel)) {
            const ind = cru('indicante') || cru('solicitante');
            if (ind) return { nome: resolverMedico(ind, sinonimos), motivo: null };
            // indicante não informado no sistema: o valor é repassado ao executante
            if (execDaLinha) return { nome: execDaLinha, motivo: 'indicante_ao_executante' };
            return { nome: '', motivo: null };
          }
          const par = PAPEIS_PROD.find(([p]) => p === papel);
          return { nome: par ? resolverMedico(cru(par[1]), sinonimos) : '', motivo: null };
        };

        /**
         * Item informativo de pagamento SEM REGRA — o sistema pagou e a Base
         * não diz quanto deveria. O valor aparece (o dinheiro saiu), mas a
         * ATLAS não afirma que está certo nem inventa dívida.
         */
        const itemSemRegra = (papel, medico, pago) => ({
          admissao: adm, hospital_id: lp.hospital_id, competencia: lp.competencia,
          data: lp.data, paciente: lp.paciente, convenio: lp.convenio, fonte: lp.fonte,
          procedimento: lp.procedimento, quantidade: lp.quantidade, valorProducao: lp.valor,
          papel, medico, regra: null, esperado: null, esperadoGlosa: 0,
          pago, pagoOutro: 0, diferenca: null, falta: 0,
          status: 'SEM_REGRA', motivo: pago > 0 ? 'pago_sem_regra' : null, pagoA: '',
        });

        /**
         * SÓ SE COBRA O QUE A BASE TABELA MANDA PAGAR. Os papéis avaliados são
         * os que ela remunera para este procedimento × fonte; papel que a
         * tabela não remunera não é divergência, é o desenho dela.
         */
        const candidatos = papeisDaBase(base, procN, lp.fonte)
          .map(({ papel }) => Object.assign({ papel }, donoDoPapel(papel)));

        // procedimento fora da Base: nada a cobrar. O que o sistema pagou
        // aparece como SEM REGRA (por papel); nada pago vira um item só.
        if (!candidatos.length) {
          let algum = false;
          for (const lr of repAdm) {
            if (lr._consumida || !(Number(lr.repassado) > 0) || !procCasa(lr)) continue;
            lr._consumida = true;
            algum = true;
            itens.push(registrarSemRegra(itemSemRegra(lr.papel_canon || lr.papel || '—',
              resolverMedico(lr.medico, sinonimos), Number(lr.repassado))));
          }
          // nada pago: fica o registro de que o procedimento está fora da Base
          // — a menos que o executante seja INSTITUCIONAL, que nunca tem
          // repasse (procedimento dele não precisa de regra)
          if (!algum && !(execDaLinha && ehInst(execDaLinha))) {
            itens.push(registrarSemRegra(itemSemRegra('EXECUTANTE', execDaLinha, 0)));
          }
          continue;
        }

        for (const cand of candidatos) {
          const regra = acharRegra(base, procN, cand.papel, lp.fonte);
          const esperadoBruto = valorEsperado(regra, lp.valor, lp.quantidade);
          if (esperadoBruto === 0 && regra) continue;   // papel não remunerado

          // o dono do papel já veio resolvido pela PRODUÇÃO (donoDoPapel)
          const nomeDono = cand.nome;

          // institucional é isento — e executante institucional
          // isenta o auxiliar junto
          if (nomeDono && ehInst(nomeDono)) continue;
          if (cand.papel === 'AUXILIAR' && execDaLinha && ehInst(execDaLinha)) continue;

          const nomeDonoN = U_.normalizar(nomeDono);
          const mesmoMedico = (outro) => {
            const o = U_.normalizar(resolverMedico(outro, sinonimos));
            return !!o && !!nomeDonoN &&
              (o === nomeDonoN || U_.similaridade(o, nomeDonoN) >= limiarFuzzy);
          };

          // ── pagamentos deste procedimento × papel ─────────────────────
          // "quita" = linha sem nome (não dá para afirmar pessoa errada),
          // dono desconhecido, ou nome que casa com o dono
          let pago = 0, pagoOutro = 0;
          const nomesOutros = new Set();
          const consumir = (predicado, quita) => {
            for (const lr of repAdm) {
              if (lr._consumida || !(Number(lr.repassado) > 0)) continue;
              if (!predicado(lr)) continue;
              lr._consumida = true;
              if (quita(lr)) pago += Number(lr.repassado);
              else {
                pagoOutro += Number(lr.repassado);
                const n = resolverMedico(lr.medico, sinonimos);
                if (n) nomesOutros.add(n);
              }
            }
          };
          // 1º: procedimento + papel canônico — quita se sem nome, sem dono ou nome certo
          // (INDICANTE e SOLICITANTE são o mesmo papel: um quita o outro)
          const papelCasa = (lr) => lr.papel_canon === cand.papel ||
            (ehIndSol(cand.papel) && ehIndSol(lr.papel_canon));
          consumir(
            lr => procCasa(lr) && lr.papel_canon && papelCasa(lr),
            lr => !String(lr.medico || '').trim() || !nomeDono || mesmoMedico(lr.medico));
          // 2º: procedimento + médico certo (repasse sem coluna de papel)
          if (!pago && !pagoOutro) {
            consumir(lr => procCasa(lr) && !lr.papel_canon && !!String(lr.medico || '').trim()
              && mesmoMedico(lr.medico), () => true);
          }
          // 3º: linha única anônima do procedimento — só para EXECUTANTE
          if (!pago && !pagoOutro && cand.papel === 'EXECUTANTE') {
            const soltas = repAdm.filter(lr => !lr._consumida && Number(lr.repassado) > 0 &&
              procCasa(lr) && !lr.papel_canon && !String(lr.medico || '').trim());
            if (soltas.length === 1) { soltas[0]._consumida = true; pago = Number(soltas[0].repassado); }
          }

          const temGlosa = glosaPorProc.has(procN);

          // ── status (a ordem é a da metodologia — docs/METODOLOGIA.md) ──
          let status, motivo = null, esperado = esperadoBruto, falta = 0, dif = null;
          let esperadoGlosa = 0, aguardando = 0;
          if (pago > 0) {
            dif = (esperado != null) ? Math.round((esperado - pago) * 100) / 100 : null;
            // sem regra conhecida, o valor repassado não prova nada: o sistema
            // do hospital nem sempre tem a regra cadastrada e nem sempre segue
            // a Base Tabela. O pagamento aparece; a conferência fica pendente.
            if (esperado == null) { status = 'SEM_REGRA'; motivo = 'pago_sem_regra'; }
            else if (Math.abs(dif) <= tol) status = 'OK';
            else if (dif > 0) { status = 'A_MENOR'; falta = dif; }
            else status = 'A_MAIOR';
          } else if (temGlosa && esperado != null) {
            // glosado não é dívida — visível, valendo zero
            status = 'GLOSA';
            const papeisGlosados = glosaPorProc.get(procN);
            const glosaDoPapel = papeisGlosados.has(cand.papel) ||
              (ehIndSol(cand.papel) && (papeisGlosados.has('INDICANTE') || papeisGlosados.has('SOLICITANTE')));
            motivo = glosaDoPapel ? 'glosa' : 'glosa_do_procedimento';
            esperadoGlosa = esperado;   // o que a regra pagaria se não fosse a recusa
            esperado = 0;
          } else if (pagoOutro > 0 && esperado != null) {
            // pago ao médico errado — a dívida continua
            status = 'PAGO_A_OUTRO';
            motivo = 'pago_a_outro';
            falta = esperado;
            dif = esperado;
          } else if (esperado == null) {
            status = 'SEM_REGRA';
          } else if (aguardandoConciliacao) {
            // produzido, mas a admissão ainda não entrou em relatório nenhum
            // do sistema — o convênio ainda não pagou ou a conciliação ainda
            // não quitou. Não é dívida: é o caminho normal da admissão.
            status = 'AGUARDANDO';
            motivo = 'nao_conciliado';
            aguardando = esperado;
            dif = esperado;
          } else {
            status = 'NAO_PAGO';
            // o pagador pagou o procedimento e o repasse não saiu: é a
            // dívida mais clara que existe — tem nome próprio no relatório
            motivo = !nomeDono ? 'sem_medico'
              : (recebidoPorProc.has(procN) ? 'recebido_sem_repasse' : 'nao_pago');
            falta = esperado;
            dif = esperado;
          }

          // "indicante não informado no sistema — o valor foi para o executante"
          // só precisa ser dito quando o valor está sendo cobrado
          if (cand.motivo && (falta > 0 || status === 'AGUARDANDO')) motivo = cand.motivo;

          const item = {
            admissao: adm, hospital_id: lp.hospital_id, competencia: lp.competencia,
            data: lp.data, paciente: lp.paciente, convenio: lp.convenio, fonte: lp.fonte,
            procedimento: lp.procedimento, quantidade: lp.quantidade,
            valorProducao: lp.valor,
            papel: cand.papel, medico: nomeDono,
            regra, esperado, esperadoGlosa, aguardando, pago, pagoOutro, diferenca: dif, falta, status, motivo,
            pagoA: [...nomesOutros].join(', '),
          };
          itens.push(item);

          const regM = registroMedico(nomeDono);
          regM.esperado += esperado || 0;
          regM.pago += pago;
          regM.falta += falta;
          regM.nItens++;
          if (falta > tol) {
            regM.nPendencias++;
            regM.itensPendentes.push(item);
          }
        }

        // o sistema pagou um papel que a Base NÃO remunera neste procedimento:
        // o dinheiro saiu e fica à vista, sem virar cobrança nem anomalia
        for (const lr of repAdm) {
          if (lr._consumida || !(Number(lr.repassado) > 0) || !procCasa(lr)) continue;
          lr._consumida = true;
          itens.push(registrarSemRegra(itemSemRegra(lr.papel_canon || lr.papel || '—',
            resolverMedico(lr.medico, sinonimos), Number(lr.repassado))));
        }
      }

      // linhas de repasse pagas da admissão que não casaram com nenhum item
      for (const lr of repAdm) {
        if (lr._consumida || !(Number(lr.repassado) > 0)) continue;
        lr._consumida = true;
        itens.push({
          admissao: adm, hospital_id: lr.hospital_id, competencia: itensProd[0].competencia,
          data: lr.data || itensProd[0].data, paciente: lr.paciente || itensProd[0].paciente,
          convenio: lr.convenio, fonte: lr.fonte,
          procedimento: lr.procedimento, quantidade: lr.quantidade,
          valorProducao: 0, papel: lr.papel_canon || lr.papel || '—',
          medico: resolverMedico(lr.medico, sinonimos),
          regra: null, esperado: null, pago: Number(lr.repassado), pagoOutro: 0,
          diferenca: null, falta: 0, status: 'NAO_PAREADO', motivo: null, pagoA: '',
        });
      }

      const lp0 = itensProd[0];
      const agg = {
        admissao: String(lp0.admissao || adm).trim(), admNorm: adm,
        hospital_id: lp0.hospital_id, competencia: lp0.competencia,
        data: lp0.data, paciente: lp0.paciente,
        convenios: [...new Set(itensProd.map(l => l.convenio).filter(Boolean))],
        medicos: [...new Set(itens.map(i => i.medico).filter(Boolean))],
        produzido: itensProd.reduce((s, l) => s + (Number(l.valor) || 0), 0),
        esperado: itens.reduce((s, i) => s + (i.esperado || 0), 0),
        // o que as regras pagariam nos itens glosados — não é dívida, é o
        // tamanho do que o pagador recusou
        glosado: itens.reduce((s, i) => s + (i.status === 'GLOSA' ? (i.esperadoGlosa || 0) : 0), 0),
        // o que ainda está no caminho (admissão fora do sistema) — vira dívida
        // só depois que o convênio pagar e a conciliação quitar
        aguardando: itens.reduce((s, i) => s + (i.aguardando || 0), 0),
        // "pago" da admissão = tudo que saiu, inclusive ao médico errado
        pago: itens.reduce((s, i) => s + (i.pago || 0) + (i.pagoOutro || 0), 0),
        falta: itens.reduce((s, i) => s + (i.falta || 0), 0),
        nItens: itens.length,
        itens,
      };
      agg.status = itens.reduce((pior, i) =>
        (SEVERIDADE[i.status] > SEVERIDADE[pior] ? i.status : pior), 'OK');
      admissoes.push(agg);
    }

    admissoes.sort((a, b) => (SEVERIDADE[b.status] - SEVERIDADE[a.status]) ||
      (b.falta - a.falta) || String(a.admissao).localeCompare(String(b.admissao)));

    // repasses pagos de admissões que NÃO EXISTEM na produção do cliente
    // (avaliado contra toda a produção, não só a filtrada). Com filtro de
    // admissões, só as pedidas; sem filtro, é PREGUIÇOSO (SQL, cache
    // próprio) — quem não abre a aba "sem lastro" não paga por ela.
    let semProducao = null;
    if (admFiltro) {
      semProducao = [];
      for (const [adm, linhas] of repPorAdm) {
        if (prodPorAdm.has(adm)) continue;
        const pagoTot = linhas.reduce((s, l) => s + (Number(l.repassado) || 0), 0);
        if (pagoTot > 0) {
          semProducao.push({ admissao: String(linhas[0].admissao || adm).trim(),
            pago: pagoTot, nLinhas: linhas.length });
        }
      }
    }

    const kpis = {
      produzido: admissoes.reduce((s, a) => s + a.produzido, 0),
      esperado: admissoes.reduce((s, a) => s + a.esperado, 0),
      pago: admissoes.reduce((s, a) => s + a.pago, 0),
      falta: admissoes.reduce((s, a) => s + a.falta, 0),
      // o que as regras pagariam nos itens GLOSADOS — não é dívida (o pagador
      // recusou), mas é o tamanho do que a glosa tirou do médico
      glosado: admissoes.reduce((s, a) => s + (a.glosado || 0), 0),
      aguardando: admissoes.reduce((s, a) => s + (a.aguardando || 0), 0),
      nAdmissoes: admissoes.length,
      nPendencias: admissoes.filter(a => a.falta > tol).length,
      nSemRegra: admissoes.filter(a => a.status === 'SEM_REGRA').length,
      nGlosa: admissoes.filter(a => a.itens.some(i => i.status === 'GLOSA')).length,
      nAguardando: admissoes.filter(a => a.status === 'AGUARDANDO').length,
    };

    const resultado = {
      kpis, admissoes, porMedico,
      // hospitais do recorte que não têm NENHUMA regra na Base: sem tabela não
      // há o que cobrar, e as telas avisam em vez de mostrar tudo "sem regra"
      hospitaisSemBase: semBase,
      filtros: { clienteId: f.clienteId, hospitalId: f.hospitalId || 0, competencia: f.competencia || '' },
      geradoEm: new Date().toISOString(),
    };
    if (semProducao) resultado.semProducao = semProducao;
    else Object.defineProperty(resultado, 'semProducao', { enumerable: true,
      get: () => semProducaoDe(f.clienteId, f.hospitalId || 0) });
    cacheGravar(chave, resultado);
    return resultado;
  }

  /**
   * Admissões pagas no sistema que não existem na produção do cliente (em
   * nenhum mês) — calculado no SQLite pelo índice de admissao_norm.
   */
  function semProducaoDe(clienteId, hospitalId) {
    const chave = [clienteId, hospitalId || 0, Banco._versao].join('|');
    if (_cacheSemProd.chave === chave) return _cacheSemProd.lista;
    Banco.garantirNormalizados();
    const params = [clienteId];
    let sql = `SELECT MIN(r.admissao) AS admissao, r.admissao_norm AS k, SUM(r.repassado) AS pago, COUNT(*) AS n
                 FROM linhas_repasse r WHERE r.cliente_id = ?`;
    if (hospitalId) { sql += ' AND r.hospital_id = ?'; params.push(hospitalId); }
    sql += ` AND NOT EXISTS (SELECT 1 FROM linhas_producao p WHERE p.cliente_id = r.cliente_id AND p.admissao_norm = r.admissao_norm)
             GROUP BY r.admissao_norm HAVING SUM(r.repassado) > 0`;
    const lista = Banco.query(sql, params).map(r => ({
      admissao: String(r.admissao || r.k || '').trim(), pago: Number(r.pago) || 0, nLinhas: Number(r.n) || 0 }));
    _cacheSemProd = { chave, lista };
    return lista;
  }

  /** Competências (YYYY-MM) disponíveis na produção do cliente, recentes primeiro. */
  function listarCompetencias(clienteId, hospitalId) {
    let sql = `SELECT DISTINCT competencia FROM linhas_producao
               WHERE cliente_id = ? AND competencia <> ''`;
    const p = [clienteId];
    if (hospitalId) { sql += ' AND hospital_id = ?'; p.push(hospitalId); }
    return Banco.query(sql + ' ORDER BY competencia DESC', p).map(r => r.competencia);
  }

  window.Motor = { auditar, inferirPadroes, listarCompetencias, mapaSinonimos, ehGlosa, foiRecebida, SEVERIDADE };
})();
