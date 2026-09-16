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
  // DE-PARA AUTOMÁTICO — o mesmo médico escrito de N formas
  //
  // Sem isso nenhum cruzamento fecha: "DURVAL JUNIOR" no sistema e "DURVAL
  // MORAES DE CARVALHO JUNIOR" na produção são a mesma pessoa, e o motor
  // precisa saber disso ANTES de dizer que um papel não foi pago a ele.
  // Roda sozinho ao fim de toda importação. Decisão humana manda: grafias já
  // vinculadas a médicos DIFERENTES nunca se juntam.
  // ──────────────────────────────────────────────────────────────────────

  /** Todas as grafias de profissional que aparecem nos relatórios do cliente. */
  function grafiasDoCliente(clienteId) {
    const cont = new Map();   // norm → { grafia (a mais frequente), n }
    const juntar = (rows) => {
      for (const r of rows) {
        const g = String(r.nome || '').trim();
        const k = U().normalizar(g);
        if (!k) continue;
        const n = Number(r.n) || 0;
        const reg = cont.get(k);
        if (!reg) cont.set(k, { norm: k, grafia: g, n, _melhor: n });
        else { reg.n += n; if (n > reg._melhor) { reg._melhor = n; reg.grafia = g; } }
      }
    };
    for (const col of ['executante', 'auxiliar', 'indicante', 'solicitante', 'laudo', 'cirurgiao', 'medico']) {
      juntar(Banco.query(
        `SELECT ${col} AS nome, COUNT(*) AS n FROM linhas_producao
          WHERE cliente_id = ? AND TRIM(COALESCE(${col}, '')) <> '' GROUP BY ${col}`, [clienteId]));
    }
    juntar(Banco.query(
      `SELECT medico AS nome, COUNT(*) AS n FROM linhas_repasse
        WHERE cliente_id = ? AND TRIM(COALESCE(medico, '')) <> '' GROUP BY medico`, [clienteId]));
    juntar(Banco.query(
      `SELECT medico AS nome, COUNT(*) AS n FROM linhas_medico
        WHERE cliente_id = ? AND TRIM(COALESCE(medico, '')) <> '' GROUP BY medico`, [clienteId]));
    return [...cont.values()].sort((a, b) => b.n - a.n);
  }

  /**
   * Unifica as grafias pelo `Utilidades.nomesBatem` e grava o de-para.
   * Devolve { grafias, medicos, vinculadas, gruposNovos }.
   */
  function unificarMedicos(clienteId) {
    const U_ = U();
    const grafias = grafiasDoCliente(clienteId);
    if (!grafias.length) return { grafias: 0, medicos: 0, vinculadas: 0, gruposNovos: 0 };

    // vínculos já existentes (decisão humana ou de uma rodada anterior)
    const jaVinculada = new Map();   // grafia_norm → medico_id
    for (const m of Banco.query('SELECT id, nome_norm FROM medicos WHERE cliente_id = ?', [clienteId])) {
      jaVinculada.set(m.nome_norm, m.id);
    }
    for (const s of Banco.query(
      `SELECT s.grafia_norm, s.medico_id FROM sinonimos_medico s
         JOIN medicos m ON m.id = s.medico_id WHERE m.cliente_id = ?`, [clienteId])) {
      jaVinculada.set(s.grafia_norm, s.medico_id);
    }

    // baldes pelo PRIMEIRO e pelo ÚLTIMO nome significativo: duas grafias da
    // mesma pessoa compartilham pelo menos um dos dois (evita o N² da base toda)
    const baldes = new Map();
    for (const g of grafias) {
      g._toks = U_.tokensNome(g.grafia);
      const chaves = new Set();
      if (g._toks.length) { chaves.add('P' + g._toks[0]); chaves.add('U' + g._toks[g._toks.length - 1]); }
      else chaves.add('X' + g.norm);
      for (const k of chaves) {
        if (!baldes.has(k)) baldes.set(k, []);
        baldes.get(k).push(g);
      }
    }

    const pai = new Map();
    const achar = (k) => { while (pai.get(k) !== k) { pai.set(k, pai.get(pai.get(k))); k = pai.get(k); } return k; };
    const unir = (a, b) => { const ra = achar(a), rb = achar(b); if (ra !== rb) pai.set(ra, rb); };
    for (const g of grafias) pai.set(g.norm, g.norm);

    for (const lote of baldes.values()) {
      if (lote.length < 2 || lote.length > 400) continue;
      for (let i = 0; i < lote.length; i++) {
        for (let j = i + 1; j < lote.length; j++) {
          const A = lote[i], B = lote[j];
          const ma = jaVinculada.get(A.norm), mb = jaVinculada.get(B.norm);
          if (ma && mb && ma !== mb) continue;         // já separadas por decisão humana
          if (U_.nomesBatem(A.grafia, B.grafia)) unir(A.norm, B.norm);
        }
      }
    }

    const clusters = new Map();
    for (const g of grafias) {
      const raiz = achar(g.norm);
      if (!clusters.has(raiz)) clusters.set(raiz, []);
      clusters.get(raiz).push(g);
    }

    // PLANEJA antes de gravar: rodar a unificação num cofre já unificado não
    // pode sujar o banco (ela roda no boot e a cada importação; abrir uma
    // transação à toa marcaria dados sujos e forçaria gravação sem motivo).
    const planos = [];
    {
      for (const grupo of clusters.values()) {
        // nome oficial: a grafia MAIS COMPLETA do grupo (mais nomes significativos),
        // desempate pela mais frequente — "DURVAL MORAES DE CARVALHO JUNIOR"
        const ordenado = grupo.slice().sort((a, b) =>
          (b._toks.length - a._toks.length) || (b.n - a.n) || (b.grafia.length - a.grafia.length));
        const ids = [...new Set(grupo.map(g => jaVinculada.get(g.norm)).filter(Boolean))];
        if (ids.length > 1) continue;                  // conflito humano: não mexe
        let medicoId = ids[0] || null;
        const faltando = grupo.filter(g => !jaVinculada.get(g.norm));
        if (!faltando.length) continue;                // grupo já resolvido
        if (grupo.length < 2 && !medicoId) continue;   // grafia única não precisa de de-para
        const plano = { medicoId, oficial: medicoId ? null : ordenado[0].grafia, grafias: [] };
        for (const g of grupo) {
          if (jaVinculada.get(g.norm)) continue;
          if (!medicoId && U_.normalizar(plano.oficial) === g.norm) continue;   // é o próprio oficial
          plano.grafias.push(g);
        }
        if (!plano.oficial && !plano.grafias.length) continue;
        planos.push(plano);
      }
    }

    let vinculadas = 0, gruposNovos = 0;
    if (planos.length) {
      Banco.transacao(() => {
        for (const plano of planos) {
          let medicoId = plano.medicoId;
          if (!medicoId) {
            Banco.executar('INSERT INTO medicos (cliente_id, nome_oficial, nome_norm) VALUES (?,?,?)',
              [clienteId, plano.oficial, U_.normalizar(plano.oficial)]);
            medicoId = Banco.ultimoId();
            gruposNovos++;
          }
          for (const g of plano.grafias) {
            Banco.executar('INSERT INTO sinonimos_medico (medico_id, grafia, grafia_norm) VALUES (?,?,?)',
              [medicoId, g.grafia, g.norm]);
            vinculadas++;
          }
        }
      });
    }

    return {
      grafias: grafias.length,
      medicos: Banco.escalar('SELECT COUNT(*) FROM medicos WHERE cliente_id = ?', [clienteId]) || 0,
      vinculadas, gruposNovos,
    };
  }

  /**
   * Profissionais do cliente, já unificados, com quanto cada um produziu —
   * é desta lista que sai o MÉDICO AUDITADO escolhido na barra do topo.
   */
  function medicosDoCliente(clienteId) {
    const U_ = U();
    const sin = mapaSinonimos(clienteId);
    const oficial = (nome) => sin.get(U_.normalizar(nome)) || String(nome || '').trim();
    const porMedico = new Map();
    const juntar = (rows, campo) => {
      for (const r of rows) {
        const nome = oficial(r.nome);
        if (!nome) continue;
        const k = U_.normalizar(nome);
        let reg = porMedico.get(k);
        if (!reg) porMedico.set(k, reg = { nome, chave: k, producao: 0, sistema: 0, medico: 0, grafias: new Set() });
        reg[campo] += Number(r.n) || 0;
        reg.grafias.add(String(r.nome || '').trim());
      }
    };
    for (const col of ['executante', 'auxiliar', 'indicante', 'solicitante', 'laudo']) {
      juntar(Banco.query(
        `SELECT ${col} AS nome, COUNT(*) AS n FROM linhas_producao
          WHERE cliente_id = ? AND TRIM(COALESCE(${col}, '')) <> '' GROUP BY ${col}`, [clienteId]), 'producao');
    }
    juntar(Banco.query(
      `SELECT medico AS nome, COUNT(*) AS n FROM linhas_repasse
        WHERE cliente_id = ? AND TRIM(COALESCE(medico, '')) <> '' GROUP BY medico`, [clienteId]), 'sistema');
    juntar(Banco.query(
      `SELECT medico AS nome, COUNT(*) AS n FROM linhas_medico
        WHERE cliente_id = ? AND TRIM(COALESCE(medico, '')) <> '' GROUP BY medico`, [clienteId]), 'medico');
    return [...porMedico.values()]
      .map(m => ({ ...m, grafias: [...m.grafias], total: m.producao + m.sistema + m.medico }))
      .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
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

  // ──────────────────────────────────────────────────────────────────────
  // CASAMENTO DE PROCEDIMENTO — as quatro camadas da ferramenta de origem
  //
  // A Base Tabela guarda UMA grafia por procedimento; o relatório do sistema
  // escreve a mesma cirurgia de dezenas de formas ("(70%) - CAMPIMETRIA
  // COMPUTADORIZADA - MONOCULAR" onde a Base diz "CAMPIMETRIA"). Procurar a
  // regra pelo nome exato faz a maioria dos procedimentos cair em SEM_REGRA,
  // e SEM_REGRA não cobra nada: é assim que dois anos de auditoria viram
  // uma dívida ridícula. As camadas são as mesmas da ferramenta
  // (js/telas/calcular.js → matcharProcedimento), da mais segura à mais
  // permissiva, e a primeira que responder decide:
  //
  //   1) EXATO        nome normalizado igual ao da Base
  //   2) SINÔNIMO     grafia já resolvida (tabela sinonimos_proc) ou a
  //                   NOMENCLATURA da Base, quando ela aponta para um só
  //                   procedimento
  //   3) SIMILARIDADE Levenshtein ≥ limiar (tolera erro de digitação), com
  //                   pré-filtro de tamanho — quem tem tamanho muito
  //                   diferente não passaria do limiar de jeito nenhum
  //   4) TOKENS       palavras-chave: 75% das da Base dentro do texto do
  //                   sistema e 40% das do sistema dentro da Base, ambos os
  //                   lados com pelo menos 2 palavras significativas
  //
  // Nada disto inventa regra: só descobre QUAL linha da Base fala daquele
  // procedimento. O que ela manda pagar continua saindo dela.
  // ──────────────────────────────────────────────────────────────────────

  // "C" e "S" entram porque "C/" e "S/" (com/sem) são epidemia nos nomes
  const STOPWORDS_PROC = new Set(['DE', 'DO', 'DA', 'DOS', 'DAS', 'PARA', 'COM', 'SEM', 'POR',
    'A', 'O', 'AS', 'OS', 'E', 'OU', 'NO', 'NA', 'NOS', 'NAS', 'EM', 'ATE', 'C', 'S']);

  /** Palavras significativas de um nome de procedimento (sem acento, sem ruído). */
  function tokenizarProc(s) {
    if (!s) return [];
    return U().normalizar(s).split(/\s+/)
      .filter(t => t.length >= 2 && !STOPWORDS_PROC.has(t));
  }

  /** covA = % dos tokens de A presentes em B; covB = o inverso. */
  function coberturas(tokensA, tokensB) {
    if (!tokensA.length || !tokensB.length) return { covA: 0, covB: 0 };
    const setA = new Set(tokensA), setB = new Set(tokensB);
    let inter = 0;
    for (const t of setA) if (setB.has(t)) inter++;
    return { covA: inter / setA.size, covB: inter / setB.size };
  }

  const _casadores = new Map();   // hospitalId|versão → casador (o cache de grafias mora dentro)

  /**
   * Casador de procedimentos do hospital: recebe a grafia do relatório e
   * devolve { chave, nome, tipo, score } da Base — ou null quando nem as
   * quatro camadas acharam nada (aí sim o procedimento está fora da Base).
   * `chave` é o procedimento_norm que indexa base_tabela.
   */
  function casadorDoHospital(hospitalId) {
    const chaveCache = hospitalId + '|' + Banco._versao;
    const pronto = _casadores.get(chaveCache);
    if (pronto) return pronto;
    if (_casadores.size >= MAX_CACHES) _casadores.delete(_casadores.keys().next().value);

    const U_ = U();
    const limiar = cfgNum('fuzzy_limiar', 0.88);
    const procs = [];
    const exato = new Map();
    const apelidos = new Map();

    const rows = Banco.query(
      `SELECT procedimento_norm AS chave, MIN(procedimento) AS nome, MIN(nomenclatura) AS nomenclatura
         FROM base_tabela WHERE hospital_id = ? GROUP BY procedimento_norm`, [hospitalId]);
    for (const r of rows) {
      const p = { chave: r.chave, nome: r.nome || r.chave, tokens: tokenizarProc(r.nome || r.chave) };
      procs.push(p);
      exato.set(r.chave, p);
    }

    // NOMENCLATURA como apelido — o nome canônico do exame na Base. Só entra
    // quando é inequívoca: se a mesma nomenclatura agrupa várias grafias com
    // regras diferentes, não dá para escolher uma, e as camadas 3 e 4 decidem.
    const porNomenclatura = new Map();
    for (const r of rows) {
      const n = U_.normalizar(r.nomenclatura);
      if (!n || exato.has(n)) continue;
      if (!porNomenclatura.has(n)) porNomenclatura.set(n, []);
      porNomenclatura.get(n).push(exato.get(r.chave));
    }
    for (const [n, lista] of porNomenclatura) if (lista.length === 1) apelidos.set(n, lista[0]);

    // sinônimos gravados (o casamento aceito antes, ou corrigido na mão)
    // vêm por último: decisão humana ganha da nomenclatura
    let sins = [];
    try {
      sins = Banco.query(
        'SELECT grafia_norm, procedimento_norm FROM sinonimos_proc WHERE hospital_id = ?', [hospitalId]);
    } catch (e) { /* banco antigo, sem a tabela ainda */ }
    for (const s of sins) {
      const p = exato.get(s.procedimento_norm);
      if (p) apelidos.set(s.grafia_norm, p);
    }

    const cache = new Map();
    const contagem = { exato: 0, sinonimo: 0, similar: 0, tokens: 0, nenhum: 0 };

    function casar(texto) {
      const norm = U_.normalizar(texto);
      if (!norm) return null;
      if (cache.has(norm)) return cache.get(norm);

      let r = null;

      // 1) exato
      const p1 = exato.get(norm);
      if (p1) r = { chave: p1.chave, nome: p1.nome, tipo: 'exato', score: 1 };

      // 2) sinônimo / nomenclatura
      if (!r) {
        const p2 = apelidos.get(norm);
        if (p2) r = { chave: p2.chave, nome: p2.nome, tipo: 'sinonimo', score: 1 };
      }

      // 3) similaridade, com o pré-filtro de tamanho da ferramenta
      if (!r) {
        let melhor = null, melhorScore = limiar;
        const len = norm.length;
        for (const p of procs) {
          const cand = p.chave;
          if (!cand) continue;
          if (Math.abs(cand.length - len) / Math.max(cand.length, len) > 1 - limiar) continue;
          const s = U_.similaridadeCrua(norm, cand);
          if (s > melhorScore) { melhorScore = s; melhor = p; }
        }
        if (melhor) r = { chave: melhor.chave, nome: melhor.nome, tipo: 'similar', score: melhorScore };
      }

      // 4) tokens — cobre o texto do sistema com palavras a mais ou a menos
      if (!r) {
        const tks = tokenizarProc(texto);
        if (tks.length >= 2) {
          let melhor = null, melhorScore = 0;
          for (const p of procs) {
            if (p.tokens.length < 2) continue;
            const { covA: covBase, covB: covSis } = coberturas(p.tokens, tks);
            if (covBase >= 0.75 && covSis >= 0.40) {
              const s = (covBase * 0.6) + (covSis * 0.4);   // peso maior em "Base coberta"
              if (s > melhorScore) { melhorScore = s; melhor = p; }
            }
          }
          if (melhor) r = { chave: melhor.chave, nome: melhor.nome, tipo: 'tokens', score: melhorScore };
        }
      }

      contagem[r ? r.tipo : 'nenhum']++;
      cache.set(norm, r);
      return r;
    }

    const casador = { hospitalId, vazio: !procs.length, procedimentos: procs, casar, contagem };
    _casadores.set(chaveCache, casador);
    return casador;
  }

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

    /**
     * O RELATÓRIO DO MÉDICO É A RÉGUA DO QUE FOI PAGO (docs/METODOLOGIA.md §5.3).
     *
     * O relatório do SISTEMA é o CRU: ninguém mexeu nele. Ele passava pela mão
     * do analista, que aplicava as regras e montava o demonstrativo que o
     * médico recebeu — esse é o relatório FIM, e o cru NÃO é fiel ao que o
     * médico tem que receber: o processo erra e o relatório sai errado junto.
     * O que o médico de fato recebeu é o que está NELE.
     *
     * Por isso a palavra final é dele, inclusive no silêncio: **papel que não
     * consta no demonstrativo não foi pago**, mesmo que o sistema diga que
     * repassou. As linhas são somadas por admissão × procedimento × papel ×
     * médico para que um estorno (valor negativo) desfaça o que estornou.
     *
     * A armadilha é o mês que ainda não foi importado: sem guarda, tudo dele
     * viraria dívida falsa. Então a régua vale pelos MESES QUE EXISTEM
     * (`mesesMedico`) — fora deles o sistema segue sendo o único dado, e o
     * resultado diz quais meses de pagamento estão sem demonstrativo.
     */
    let sqlMed = `SELECT hospital_id, admissao, competencia, data, paciente, convenio, fonte,
        procedimento, procedimento_norm, papel, papel_canon, medico, 1 AS quantidade,
        SUM(COALESCE(valor, 0)) AS repassado
      FROM linhas_medico WHERE cliente_id = ?`;
    const pMed = [f.clienteId];
    if (f.hospitalId) { sqlMed += ' AND hospital_id = ?'; pMed.push(f.hospitalId); }
    const med = consultar(sqlMed, pMed,
      ` GROUP BY admissao_norm, procedimento_norm, COALESCE(papel_canon, papel), medico_norm
        ORDER BY admissao`, admsRep);

    // O QUE O DEMONSTRATIVO COBRE — lido do cliente INTEIRO (não do recorte):
    // com filtro por admissão o recorte pode não ter nenhuma linha do médico, e
    // é justamente esse silêncio que precisa valer como "não foi pago".
    const ondeMed = f.hospitalId ? ' AND hospital_id = ?' : '';
    const pMedCli = f.hospitalId ? [f.clienteId, f.hospitalId] : [f.clienteId];
    const mesesMedico = new Set(Banco.query(
      `SELECT DISTINCT competencia FROM linhas_medico
        WHERE cliente_id = ?${ondeMed} AND COALESCE(competencia, '') <> ''`, pMedCli)
      .map(r => r.competencia));
    const medicosDoRelatorio = new Set();
    for (const r of Banco.query(
      `SELECT DISTINCT medico FROM linhas_medico
        WHERE cliente_id = ?${ondeMed} AND TRIM(COALESCE(medico, '')) <> ''`, pMedCli)) {
      const n = U_.normalizar(resolverMedico(r.medico, sinonimos));
      if (n) medicosDoRelatorio.add(n);
    }
    const temRelatorioMedico = mesesMedico.size > 0 || medicosDoRelatorio.size > 0;
    const mesesSemMedico = new Set();   // meses de pagamento do sistema sem demonstrativo

    // regras por hospital (pode haver mais de um no filtro "todos"). A
    // inferência NÃO entra aqui: ela é sugestão da tela Base Tabela, não regra.
    const hospitais = new Set(prod.map(l => l.hospital_id).concat(rep.map(l => l.hospital_id)));
    const basePorHosp = new Map();
    const casadorPorHosp = new Map();
    // grafia da produção → como ela achou (ou não) a linha da Base. É o que a
    // tela mostra quando o total parece pequeno demais: procedimento que não
    // casa não tem regra, e sem regra não se cobra nada.
    const casamentoProc = new Map();
    const semBase = [];
    for (const h of hospitais) {
      const b = carregarBase(h);
      basePorHosp.set(h, b);
      casadorPorHosp.set(h, casadorDoHospital(h));
      if (!b.size) semBase.push(h);
    }

    // relatório do médico indexado por admissão NORMALIZADA
    const medPorAdm = new Map();
    for (const l of med) {
      if (!(Number(l.repassado) > 0)) continue;   // estorno já abatido na soma
      const adm = U_.normAdm(l.admissao);
      if (!medPorAdm.has(adm)) medPorAdm.set(adm, []);
      medPorAdm.get(adm).push(Object.assign({ _consumida: false, _doMedico: true }, l));
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
      // o que o médico DE FATO recebeu (§5.3): para quem TEM demonstrativo, a
      // régua do pagamento é ele; as linhas do sistema desse médico ficam
      // superadas — o relatório tratado é a versão final delas.
      const medAdm = medPorAdm.get(adm) || [];

      // O MÊS DESTA ADMISSÃO TEM DEMONSTRATIVO? O mês é o do PAGAMENTO (a
      // competência da linha do sistema). Tendo, o demonstrativo manda mesmo
      // calado: papel que não está nele não foi pago. Não tendo, não dá para
      // afirmar nada — o mês entra no aviso de "sem relatório do médico".
      let admCoberta = false;
      for (const lr of repAdm) {
        const c = String(lr.competencia || '');
        if (!c) continue;
        if (mesesMedico.has(c)) admCoberta = true;
        else if (Number(lr.repassado) > 0 || foiRecebida(lr)) mesesSemMedico.add(c);
      }
      if (medAdm.length) admCoberta = true;

      // linhas do sistema dos médicos que TÊM demonstrativo ficam superadas:
      // o relatório tratado é a versão final delas (inclusive quando ele não
      // traz nada daquela admissão — aí a versão final é "não recebeu")
      if (admCoberta) {
        for (const lr of repAdm) {
          const n = U_.normalizar(resolverMedico(lr.medico, sinonimos));
          if (n && medicosDoRelatorio.has(n)) lr._consumida = true;
        }
      }
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
      // …a menos que o relatório do médico já traga a admissão: se ele recebeu,
      // ela passou pela conciliação, por mais que o sistema não a mostre aqui
      const aguardandoConciliacao = repAdm.length === 0 && medAdm.length === 0;

      for (const lp of itensProd) {
        const base = basePorHosp.get(lp.hospital_id) || new Map();
        const procN = lp.procedimento_norm;
        // QUAL linha da Base fala deste procedimento (as quatro camadas).
        // procN continua sendo a grafia da produção — é por ela que a glosa e
        // o pareamento com o sistema andam; procBase é a chave da REGRA.
        const casador = casadorPorHosp.get(lp.hospital_id);
        const casou = casador ? casador.casar(lp.procedimento) : null;
        const procBase = casou ? casou.chave : procN;
        if (procN && !casamentoProc.has(procN)) {
          casamentoProc.set(procN, { procedimento: lp.procedimento,
            tipo: casou ? casou.tipo : 'nenhum', base: casou ? casou.nome : '' });
        }
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
        /** Quem o SISTEMA nomeia neste papel deste procedimento ('' se ninguém). */
        const doSistema = (papel) => {
          for (const lr of repAdm) {
            if (!procCasa(lr)) continue;
            const pc = lr.papel_canon;
            const casa = pc === papel || (ehIndSol(papel) && ehIndSol(pc));
            if (!casa) continue;
            const nome = String(lr.medico || '').trim();
            if (nome) return resolverMedico(nome, sinonimos);
          }
          return '';
        };
        /**
         * A PRODUÇÃO decide de quem é o papel; o SISTEMA só COMPLETA o que ela
         * não diz. A ordem importa e é diferente da ferramenta de origem: lá o
         * QVIS vem primeiro porque ela GERA o pagamento e o relatório é o
         * registro de quem ocupou o papel. Aqui a ATLAS AUDITA o pagamento — se
         * o dono saísse do próprio sistema, o nome dele sempre bateria com o
         * pagamento dele e "pago ao médico errado" nunca seria detectado. A
         * produção é a fonte independente; o sistema entra quando ela cala.
         */
        const donoDoPapel = (papel) => {
          if (papel === 'EXECUTANTE') return { nome: execDaLinha || doSistema(papel), motivo: null };
          if (papel === 'AUXILIAR') {
            // o valor do auxiliar é do EXECUTANTE — o nome na linha do auxiliar não manda
            return { nome: execDaLinha || resolverMedico(cru('auxiliar'), sinonimos) || doSistema(papel), motivo: null };
          }
          if (ehIndSol(papel)) {
            const ind = cru('indicante') || cru('solicitante') || doSistema(papel);
            if (ind) return { nome: resolverMedico(ind, sinonimos), motivo: null };
            // indicante não informado em lugar nenhum: o valor é repassado ao executante
            if (execDaLinha) return { nome: execDaLinha, motivo: 'indicante_ao_executante' };
            return { nome: '', motivo: null };
          }
          const par = PAPEIS_PROD.find(([p]) => p === papel);
          return { nome: (par ? resolverMedico(cru(par[1]), sinonimos) : '') || doSistema(papel), motivo: null };
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
        const candidatos = papeisDaBase(base, procBase, lp.fonte)
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
          const regra = acharRegra(base, procBase, cand.papel, lp.fonte);
          const esperadoBruto = valorEsperado(regra, lp.valor, lp.quantidade);
          if (esperadoBruto === 0 && regra) continue;   // papel não remunerado

          // o dono do papel já veio resolvido pela PRODUÇÃO (donoDoPapel)
          const nomeDono = cand.nome;

          // institucional é isento — e executante institucional
          // isenta o auxiliar junto
          if (nomeDono && ehInst(nomeDono)) continue;
          if (cand.papel === 'AUXILIAR' && execDaLinha && ehInst(execDaLinha)) continue;

          const nomeDonoN = U_.normalizar(nomeDono);

          /**
           * DE ONDE SAI O "PAGO" DESTE PAPEL. O relatório do SISTEMA é o cru;
           * o do MÉDICO é o mesmo relatório depois de tratado pelo analista —
           * é ele que o médico recebeu e é por ele que se mede o pagamento.
           *
           * Duas condições, e as duas importam: o demonstrativo é de UM médico
           * (só vale para os papéis de quem ele cobre) e de UM mês (só vale
           * onde aquele mês foi importado). Dentro disso ele manda até no
           * silêncio — papel ausente é papel não pago. Fora disso, o sistema
           * segue sendo o único dado que existe.
           */
          const reguaMedico = !!nomeDonoN && admCoberta && medicosDoRelatorio.has(nomeDonoN);
          const fonteDoPago = reguaMedico ? medAdm : repAdm;
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
            for (const lr of fonteDoPago) {
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

          /**
           * AUXILIAR COM NOME DIVERGENTE — regra da ferramenta de origem
           * (js/telas/auditoria.js: "auxiliar presente mas divergente do
           * cirurgião → renomeia"). Por anos o auxiliar ou não saía no
           * relatório do sistema, ou saía com um nome que não era o do
           * executante; o valor do auxiliar, porém, sempre foi do cirurgião
           * do procedimento. Então o pagamento QUITA a exigência, e a linha
           * fica marcada com o nome que veio no sistema — sem isso a mesma
           * verba é cobrada de novo como PAGO A OUTRO.
           */
          let auxRenomeado = false, auxNomeOriginal = '';
          const quitaPapel = (lr) => {
            if (!String(lr.medico || '').trim() || !nomeDono) return true;
            if (mesmoMedico(lr.medico)) return true;
            if (cand.papel === 'AUXILIAR' && lr.papel_canon === 'AUXILIAR') {
              auxRenomeado = true;
              auxNomeOriginal = resolverMedico(lr.medico, sinonimos) || String(lr.medico || '').trim();
              return true;
            }
            return false;
          };
          consumir(lr => procCasa(lr) && lr.papel_canon && papelCasa(lr), quitaPapel);
          // 2º: procedimento + médico certo (repasse sem coluna de papel)
          if (!pago && !pagoOutro) {
            consumir(lr => procCasa(lr) && !lr.papel_canon && !!String(lr.medico || '').trim()
              && mesmoMedico(lr.medico), () => true);
          }
          // 3º: linha única anônima do procedimento — só para EXECUTANTE
          if (!pago && !pagoOutro && cand.papel === 'EXECUTANTE') {
            const soltas = fonteDoPago.filter(lr => !lr._consumida && Number(lr.repassado) > 0 &&
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
            // dívida mais clara que existe — tem nome próprio no relatório.
            // Com o demonstrativo do médico no mês, o silêncio dele é a prova:
            // o papel não consta, logo não foi pago (METODOLOGIA §5.3).
            motivo = !nomeDono ? 'sem_medico'
              : (reguaMedico ? 'nao_consta_no_relatorio_medico'
              : (recebidoPorProc.has(procN) ? 'recebido_sem_repasse' : 'nao_pago'));
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
            procBase: casou ? casou.nome : null, matchProc: casou ? casou.tipo : null,
            auxRenomeado, auxNomeOriginal,
            pagoPor: reguaMedico ? 'MEDICO' : 'SISTEMA',
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
      nRenomeados: 0,
      // o relatório do médico é obrigatório (§5.3): sem ele o que se mede é o
      // cru do sistema, e o cru não é fiel ao que o médico tem que receber
      temRelatorioMedico,
      // meses de PAGAMENTO do sistema que ainda não têm demonstrativo do
      // médico importado — ali a régua não é a final, e a tela avisa
      mesesSemRelatorioMedico: [...mesesSemMedico].sort(),
    };

    // como as grafias da produção acharam a Base (exato/sinônimo/similar/
    // tokens/nenhum) — o termômetro do casamento
    const casamento = { exato: 0, sinonimo: 0, similar: 0, tokens: 0, nenhum: 0,
      distintos: casamentoProc.size, semBase: [] };
    for (const [, c] of casamentoProc) {
      casamento[c.tipo] = (casamento[c.tipo] || 0) + 1;
      if (c.tipo === 'nenhum' && casamento.semBase.length < 300) casamento.semBase.push(c.procedimento);
    }
    kpis.nRenomeados = admissoes.reduce((s, a) =>
      s + a.itens.filter(i => i.auxRenomeado).length, 0);

    const resultado = {
      kpis, admissoes, porMedico, casamento,
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

  // ──────────────────────────────────────────────────────────────────────
  // MÉDICOS CLIENTES — quem a ATLAS audita
  //
  // Os relatórios são do HOSPITAL: a produção do CBV traz os 655 profissionais
  // que passaram por lá. CLIENTE é quem contratou a auditoria — um punhado.
  // A marca fica em medicos.eh_cliente e é ela que alimenta o seletor do topo.
  // ──────────────────────────────────────────────────────────────────────

  /** Médicos marcados como clientes da ATLAS neste cofre. */
  function clientesMedicos(clienteId) {
    const U_ = U();
    const rows = Banco.query(
      `SELECT nome_oficial AS nome, nome_norm AS chave FROM medicos
        WHERE cliente_id = ? AND COALESCE(eh_cliente, 0) = 1
        ORDER BY nome_oficial`, [clienteId]);
    return rows.map(r => ({ nome: r.nome, chave: r.chave || U_.normalizar(r.nome) }));
  }

  /**
   * Marca (ou desmarca) um médico como cliente da ATLAS e devolve o OFICIAL
   * marcado ({ nome, chave }) — escolher alguém no topo é, por si só, dizer
   * que a auditoria responde por ele. A grafia passada é resolvida pelo
   * de-para antes: marcar "DR JOAO" marca "JOAO DA SILVA", que é a pessoa.
   */
  function marcarClienteMedico(clienteId, nome, marcado) {
    const U_ = U();
    const bruto = String(nome || '').trim();
    if (!bruto) return null;
    const oficial = resolverMedico(bruto, mapaSinonimos(clienteId)) || bruto;
    const chave = U_.normalizar(oficial);
    if (!chave) return null;
    const id = Banco.escalar(
      'SELECT id FROM medicos WHERE cliente_id = ? AND nome_norm = ?', [clienteId, chave]);
    if (id == null) {
      if (!marcado) return null;
      Banco.executar(
        'INSERT INTO medicos (cliente_id, nome_oficial, nome_norm, eh_cliente) VALUES (?, ?, ?, 1)',
        [clienteId, oficial, chave]);
    } else {
      Banco.executar('UPDATE medicos SET eh_cliente = ? WHERE id = ?', [marcado ? 1 : 0, id]);
    }
    return { nome: oficial, chave };
  }

  window.Motor = { auditar, inferirPadroes, listarCompetencias, mapaSinonimos,
    unificarMedicos, medicosDoCliente, grafiasDoCliente, clientesMedicos,
    marcarClienteMedico, casadorDoHospital, tokenizarProc,
    ehGlosa, foiRecebida, SEVERIDADE };
})();
