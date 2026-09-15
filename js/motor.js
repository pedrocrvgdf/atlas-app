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
 * O VALOR ESPERADO de cada papel sai de duas origens, nesta ordem:
 *   1. BASE TABELA do hospital (procedimento × papel × fonte);
 *   2. PADRÃO INFERIDO do histórico pago do próprio hospital (valor fixo
 *      pela moda / percentual pela estabilidade de pago÷produzido), com
 *      confiança mínima configurável.
 *
 * Semântica do filtro de competência: filtra a PRODUÇÃO (mês do
 * atendimento). O repasse é buscado POR ADMISSÃO em todo o histórico —
 * produção de abril paga em junho conta como paga.
 *
 * Status por item:
 *   OK            pago (a quem devia) dentro da tolerância
 *   A_MENOR       pago abaixo do esperado
 *   A_MAIOR       pago acima do esperado
 *   NAO_PAGO      esperado > 0 e nada pago (motivo: nao_pago | sem_medico)
 *   PAGO_A_OUTRO  o papel foi pago, mas a outro médico — dívida continua
 *   GLOSA         procedimento glosado — visível, valendo zero
 *   SEM_REGRA     sem Base e sem padrão confiável — não dá para avaliar
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
    NAO_PAREADO: 4, A_MAIOR: 3, GLOSA: 2, OK: 0,
  };

  /** Classificações que NÃO passam pela cobrança papel-a-papel. */
  const CLASS_NAO_REPASSAVEL = new Set([
    'MATERIAL', 'MEDICAMENTO', 'MAT MED', 'MATMED', 'MAT/MED',
    'TAXA', 'OPME', 'GAS', 'DIARIA',
  ]);

  let _cache = { chave: null, resultado: null };
  let _cacheInfer = { chave: null, padroes: null };
  let _cacheSin = { chave: null, mapa: null };

  function cfgNum(chave, padrao) {
    const v = Number(Banco.configLer(chave, padrao));
    return isFinite(v) ? v : padrao;
  }

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
         FROM linhas_repasse WHERE hospital_id = ? AND repassado > 0
        GROUP BY 1, 2, 3, 4`, [hospitalId])) {
      const g = grupo(chaveDe(r));
      const v = Number(r.unit) || 0, f = Number(r.f) || 0;
      g.n += f; g.valores.set(v, (g.valores.get(v) || 0) + f);
    }
    // razão pago/produzido (4 casas), com frequência
    for (const r of Banco.query(
      `SELECT procedimento_norm AS proc, papel_canon AS papel, fonte,
              ROUND(repassado * 1.0 / produzido, 4) AS razao, COUNT(*) AS f
         FROM linhas_repasse WHERE hospital_id = ? AND repassado > 0 AND produzido > 0
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
   * Regra efetiva para (proc, papel, fonte):
   *   Base[fonte] → Base[TODAS] → Inferida[fonte] (confiança ≥ mínima) → null
   */
  function acharRegra(base, padroes, minConf, proc, papel, fonte) {
    let r = base.get(proc + '|' + papel + '|' + fonte);
    if (r) return { origem: 'BASE', valor: r.valor, percentual: r.percentual };
    r = base.get(proc + '|' + papel + '|TODAS');
    if (r) return { origem: 'BASE', valor: r.valor, percentual: r.percentual };
    const p = padroes.get(proc + '|' + papel + '|' + fonte);
    if (p && p.confianca >= minConf) {
      return { origem: 'INFERIDA', valor: p.valor, percentual: p.percentual,
               confianca: p.confianca, amostras: p.amostras };
    }
    return null;
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
    solicitante, laudo`;

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
    if (_cache.chave === chave) return _cache.resultado;
    Banco.garantirNormalizados();

    // consulta por lotes de admissões quando há filtro (IN de até 800 por vez)
    const consultar = (sqlBase, params, ordem) => {
      if (!admFiltro) return Banco.query(sqlBase + ordem, params);
      const out = [];
      for (let i = 0; i < admFiltro.length; i += 800) {
        const lote = admFiltro.slice(i, i + 800);
        out.push(...Banco.query(sqlBase + ` AND admissao_norm IN (${lote.map(() => '?').join(',')})` + ordem,
          params.concat(lote)));
      }
      return out;
    };
    const tol = cfgNum('tolerancia_centavos', 0.05);
    const minConf = cfgNum('inferencia_min_confianca', 0.6);
    const limiarFuzzy = cfgNum('fuzzy_limiar', 0.88);
    const sinonimos = mapaSinonimos(f.clienteId);
    const ehInst = fnInstitucional();

    // ── carrega produção (filtrada) e repasse (por admissão, sem filtro de mês)
    let sqlProd = `SELECT ${COLS_PROD} FROM linhas_producao WHERE cliente_id = ?`;
    const pProd = [f.clienteId];
    if (f.hospitalId) { sqlProd += ' AND hospital_id = ?'; pProd.push(f.hospitalId); }
    if (f.competencia) { sqlProd += ' AND competencia = ?'; pProd.push(f.competencia); }
    const prod = consultar(sqlProd, pProd, ' ORDER BY admissao, id');

    let sqlRep = 'SELECT * FROM linhas_repasse WHERE cliente_id = ?';
    const pRep = [f.clienteId];
    if (f.hospitalId) { sqlRep += ' AND hospital_id = ?'; pRep.push(f.hospitalId); }
    const rep = consultar(sqlRep, pRep, ' ORDER BY admissao, id');

    // regras e padrões por hospital (pode haver mais de um no filtro "todos")
    const hospitais = new Set(prod.map(l => l.hospital_id).concat(rep.map(l => l.hospital_id)));
    const basePorHosp = new Map(), padroesPorHosp = new Map();
    for (const h of hospitais) {
      basePorHosp.set(h, carregarBase(h));
      padroesPorHosp.set(h, inferirPadroes(h));
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

      // glosa é do PROCEDIMENTO: mapa procNorm → papéis com linha de glosa
      const glosaPorProc = new Map();
      for (const lr of repAdm) {
        if (!/glosa/i.test(String(lr.status || ''))) continue;
        for (const lp of itensProd) {
          if (lr.procedimento_norm === lp.procedimento_norm ||
              U_.similaridade(lr.procedimento_norm, lp.procedimento_norm) >= limiarFuzzy) {
            if (!glosaPorProc.has(lp.procedimento_norm)) glosaPorProc.set(lp.procedimento_norm, new Set());
            if (lr.papel_canon) glosaPorProc.get(lp.procedimento_norm).add(lr.papel_canon);
          }
        }
        lr._consumida = true;   // linha de glosa não é pagamento nem "não pareado"
      }

      for (const lp of itensProd) {
        const base = basePorHosp.get(lp.hospital_id) || new Map();
        const padroes = padroesPorHosp.get(lp.hospital_id) || new Map();
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

        // papéis candidatos: os preenchidos na produção + os que a Base exige
        const candidatos = [];
        for (const [papel, col] of PAPEIS_PROD) {
          const nome = String(lp[col] || '').trim();
          if (nome) candidatos.push({ papel, nome });
        }
        for (const papel of U_.PAPEIS) {
          if (candidatos.some(c => c.papel === papel)) continue;
          const r = base.get(procN + '|' + papel + '|' + lp.fonte) ||
                    base.get(procN + '|' + papel + '|TODAS');
          if (r && ((r.valor != null && r.valor !== 0) || (r.percentual != null && r.percentual !== 0))) {
            candidatos.push({ papel, nome: '' });   // exigido pela Base, sem nome na produção
          }
        }
        if (!candidatos.length) candidatos.push({ papel: 'EXECUTANTE', nome: '' });

        const execDaLinha = resolverMedico(lp.executante, sinonimos);

        for (const cand of candidatos) {
          const regra = acharRegra(base, padroes, minConf, procN, cand.papel, lp.fonte);
          const esperadoBruto = valorEsperado(regra, lp.valor, lp.quantidade);
          if (esperadoBruto === 0 && regra) continue;   // papel não remunerado

          /**
           * O AUXILIAR acompanha o EXECUTANTE — o destinatário do valor
           * de auxiliar é o executante do procedimento, não o nome da coluna.
           */
          const nomeDono = cand.papel === 'AUXILIAR'
            ? (execDaLinha || resolverMedico(cand.nome, sinonimos))
            : resolverMedico(cand.nome, sinonimos);

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
          consumir(
            lr => procCasa(lr) && lr.papel_canon && lr.papel_canon === cand.papel,
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
          if (pago > 0) {
            dif = (esperado != null) ? Math.round((esperado - pago) * 100) / 100 : null;
            if (esperado == null) status = 'OK';
            else if (Math.abs(dif) <= tol) status = 'OK';
            else if (dif > 0) { status = 'A_MENOR'; falta = dif; }
            else status = 'A_MAIOR';
          } else if (temGlosa && esperado != null) {
            // glosado não é dívida — visível, valendo zero
            status = 'GLOSA';
            motivo = glosaPorProc.get(procN).has(cand.papel) ? 'glosa' : 'glosa_do_procedimento';
            esperado = 0;
          } else if (pagoOutro > 0 && esperado != null) {
            // pago ao médico errado — a dívida continua
            status = 'PAGO_A_OUTRO';
            motivo = 'pago_a_outro';
            falta = esperado;
            dif = esperado;
          } else if (esperado == null) {
            status = 'SEM_REGRA';
          } else {
            status = 'NAO_PAGO';
            motivo = nomeDono ? 'nao_pago' : 'sem_medico';   // dívida sem dono
            falta = esperado;
            dif = esperado;
          }

          const item = {
            admissao: adm, hospital_id: lp.hospital_id, competencia: lp.competencia,
            data: lp.data, paciente: lp.paciente, convenio: lp.convenio, fonte: lp.fonte,
            procedimento: lp.procedimento, quantidade: lp.quantidade,
            valorProducao: lp.valor,
            papel: cand.papel, medico: nomeDono,
            regra, esperado, pago, pagoOutro, diferenca: dif, falta, status, motivo,
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
    // (avaliado contra toda a produção, não só a filtrada; com filtro de
    // admissões, só as pedidas)
    const todasAdmProd = admFiltro
      ? new Set(prodPorAdm.keys())
      : new Set(Banco.query('SELECT DISTINCT admissao_norm FROM linhas_producao WHERE cliente_id = ?',
          [f.clienteId]).map(r => r.admissao_norm));
    const semProducao = [];
    for (const [adm, linhas] of repPorAdm) {
      if (todasAdmProd.has(adm)) continue;
      const pagoTot = linhas.reduce((s, l) => s + (Number(l.repassado) || 0), 0);
      if (pagoTot > 0) {
        semProducao.push({ admissao: String(linhas[0].admissao || adm).trim(),
          pago: pagoTot, nLinhas: linhas.length });
      }
    }

    const kpis = {
      produzido: admissoes.reduce((s, a) => s + a.produzido, 0),
      esperado: admissoes.reduce((s, a) => s + a.esperado, 0),
      pago: admissoes.reduce((s, a) => s + a.pago, 0),
      falta: admissoes.reduce((s, a) => s + a.falta, 0),
      nAdmissoes: admissoes.length,
      nPendencias: admissoes.filter(a => a.falta > tol).length,
      nSemRegra: admissoes.filter(a => a.status === 'SEM_REGRA').length,
    };

    const resultado = {
      kpis, admissoes, porMedico,
      semProducao,
      padroesPorHosp,
      filtros: { clienteId: f.clienteId, hospitalId: f.hospitalId || 0, competencia: f.competencia || '' },
      geradoEm: new Date().toISOString(),
    };
    _cache = { chave, resultado };
    return resultado;
  }

  /** Competências (YYYY-MM) disponíveis na produção do cliente, recentes primeiro. */
  function listarCompetencias(clienteId, hospitalId) {
    let sql = `SELECT DISTINCT competencia FROM linhas_producao
               WHERE cliente_id = ? AND competencia <> ''`;
    const p = [clienteId];
    if (hospitalId) { sql += ' AND hospital_id = ?'; p.push(hospitalId); }
    return Banco.query(sql + ' ORDER BY competencia DESC', p).map(r => r.competencia);
  }

  window.Motor = { auditar, inferirPadroes, listarCompetencias, mapaSinonimos, SEVERIDADE };
})();
