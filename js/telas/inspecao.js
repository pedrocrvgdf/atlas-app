/**
 * ============================================================================
 * TELA: Inspeção da Admissão (🔎) — o módulo de rastreio
 *
 * Rastreia UMA admissão pelas bases, na ordem em que o dinheiro caminha,
 * e diz ONDE ELA PAROU (metodologia §1):
 *
 *   Painel 1 · SISTEMA          o relatório cru do sistema do hospital (linhas_repasse)
 *   Painel 2 · RESULTADO AUDITADO  o motor papel a papel: quem devia receber,
 *                               regra, esperado × pago, status e motivo
 *   Painel 3 · PRODUÇÃO ANALÍTICA  o que o hospital produziu (linhas_producao)
 *   Painel 4 · RECEBIDO PELO MÉDICO  o relatório que o médico de fato recebeu
 *                               (linhas_medico) — confronto SISTEMA × MÉDICO
 *
 * Diagnóstico em 4 tons:
 *   ok    há valor repassado — "Admissão paga no repasse" + competências,
 *         total, lista analítica, alertas e o "não pago"
 *   etapa está no sistema mas nada foi repassado (sem ser glosa total)
 *   aviso fora do repasse e dentro da produção — frase fixa de AGUARDANDO
 *   nada  "Admissão não encontrada"
 *
 * Lateral "Planilha do médico": importa a lista de admissões do cliente
 * (3 formatos), guarda a PAUTA no banco (viaja com o .db), aplica vigias
 * (produto × papel) e recortes (médicos, participação, produtos) e EXPORTA
 * a planilha Excel com a situação de cada admissão e o repasse faltante.
 *
 * Config por CLIENTE na tabela config (sufixo _c<id>): pauta, vigias,
 * produtos da coluna, produtos da situação, médicos, participação, flag.
 * Frases fixas da metodologia — NÃO alterar os textos.
 * ============================================================================
 */
App.telas['inspecao'] = function () {
  window.AtlasInspecao.montar();
};

window.AtlasInspecao = (function () {
  'use strict';
  const U = () => window.Utilidades;
  const esc = (s) => Utilidades.esc(s);
  const fmtR = (n) => Utilidades.moeda(n);

  // frases fixas (metodologia / spec — não alterar)
  const FRASE_AGUARDANDO = 'Aguardando pagamento do convênio ou aguardando conciliação para efetuar o repasse';
  const FRASE_PARTICULAR = 'Particular — sem repasse lançado nesta competência';
  const FRASE_SEM_REGRA = 'Sem regra de repasse';
  const FRASE_SEM_EXECUCAO = 'procedimento recebido do convênio sem repasse executado';
  const FRASE_PAGA = 'Admissão paga no repasse';
  const FRASE_NADA = 'Admissão não encontrada';
  const DICA_PENDENTE = 'O convênio ainda não pagou esta admissão';
  // confronto SISTEMA × MÉDICO (a terceira base do triângulo)
  const FRASE_NAO_CHEGOU = 'Consta pago no sistema e NÃO consta no relatório do médico';
  const FRASE_CONFORME = 'Recebido pelo médico conforme o sistema';
  const FRASE_DIVERGENTE = 'Divergência entre o sistema e o relatório do médico';
  const FRASE_SEM_LASTRO = 'Recebido pelo médico sem lastro no sistema';

  const PAPEL_ROTULO = {
    EXECUTANTE: 'Executante', AUXILIAR: 'Auxiliar', INDICANTE: 'Indicante',
    SOLICITANTE: 'Solicitante', LAUDO: 'Médico Laudo', ANESTESISTA: 'Anestesista', TODOS: 'Todos',
  };
  const QUEM_DO_PAPEL = {
    EXECUTANTE: 'médico executante', AUXILIAR: 'auxiliar', INDICANTE: 'médico indicante',
    SOLICITANTE: 'médico solicitante', LAUDO: 'médico laudista', ANESTESISTA: 'anestesista',
  };
  const AZUL_SPEC = '107DAC';   // azul das frases/estados herdado da spec

  // ── estado de tela (sobrevive à navegação; não viaja no banco) ─────────
  const st = {
    modo: 'admissao',            // 'admissao' | 'paciente'
    qAdm: '', qNome: '', qData: '',
    admAtual: null,              // normAdm inspecionada
    admAtualRotulo: '',          // como o usuário digitou/escolheu
    candidatas: null,
    ocultar: false,
    diagAberto: true,
    latAberta: true,
    buscas: {},                  // busca "contém" de cada bloco da lateral
    exportando: false,
  };

  let el = null;
  let clienteId = 0;

  // ────────────────────────────────────────────────────────────────────
  // CONFIG POR CLIENTE (viaja com o banco; metodologia §9)
  // ────────────────────────────────────────────────────────────────────
  const CFG = {
    pauta: 'insp_pauta_v1', vigias: 'insp_vigias_v1',
    prodSel: 'insp_prod_sel_v1', prodSit: 'insp_prod_sit_v1',
    medSel: 'insp_med_sel_v1', papelSel: 'insp_papel_sel_v1',
    flagFaltante: 'insp_rep_faltante_v1',
  };
  const VIGIAS_PADRAO = [{ produto: 'TOMOGRAFIA DE COERENCIA OPTICA OCT', papel: 'LAUDO' }];

  function cfgLer(chave, padrao) {
    const v = Banco.configLer(chave + '_c' + clienteId, null);
    return v == null ? padrao : v;
  }
  function cfgGravar(chave, valor) {
    Banco.configGravar(chave + '_c' + clienteId, valor);
    Banco.salvarDebounced();
  }
  const lerPauta = () => cfgLer(CFG.pauta, []);
  const lerVigias = () => {
    const v = Banco.configLer(CFG.vigias + '_c' + clienteId, null);
    return v == null ? VIGIAS_PADRAO.slice() : v;   // 1ª vez: OCT + Médico Laudo
  };
  const lerSet = (chave) => new Set(cfgLer(chave, []));
  const gravarSet = (chave, set) => cfgGravar(chave, [...set]);
  const flagFaltante = () => String(cfgLer(CFG.flagFaltante, '1')) === '1';

  // ────────────────────────────────────────────────────────────────────
  // DADOS (memoizados por Banco._versao — convenção da casa)
  // ────────────────────────────────────────────────────────────────────
  let _memo = { versao: -1, cliente: 0 };

  /** Mapas por admissão NORMALIZADA das bases (produção, sistema, médico) + resultado do motor. */
  function dados() {
    // robustez: quem chamar o módulo por fora da tela ainda resolve o cliente
    const ativo = App.clienteAtivo && App.clienteAtivo();
    if (ativo) clienteId = ativo.id;
    if (_memo.versao === Banco._versao && _memo.cliente === clienteId) return _memo;
    const norm = U().normAdm;
    const agrupar = (rows) => {
      const m = new Map();
      for (const r of rows) {
        const k = norm(r.admissao);
        if (!k) continue;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r);
      }
      return m;
    };
    const prodPor = agrupar(Banco.query(
      'SELECT * FROM linhas_producao WHERE cliente_id = ? ORDER BY id', [clienteId]));
    const repPor = agrupar(Banco.query(
      'SELECT * FROM linhas_repasse WHERE cliente_id = ? ORDER BY id', [clienteId]));
    const r = Motor.auditar({ clienteId, hospitalId: 0, competencia: '' });
    const motorPor = new Map(r.admissoes.map(a => [U().normAdm(a.admissao), a]));
    // relatório do MÉDICO (o que ele de fato recebeu) — só linhas com admissão
    const medRows = Banco.query('SELECT * FROM linhas_medico WHERE cliente_id = ? ORDER BY id', [clienteId]);
    const medPor = agrupar(medRows.filter(l => String(l.admissao || '').trim()));
    const medNaoResolvidas = medRows.filter(l => !String(l.admissao || '').trim()).length;
    _memo = { versao: Banco._versao, cliente: clienteId, prodPor, repPor, motorPor, resultado: r,
      medPor, temBaseMedico: medRows.length > 0, medTotal: medRows.length, medNaoResolvidas };
    return _memo;
  }

  /**
   * Gen 1 do relatório do médico não traz admissão: casa PACIENTE + DATA
   * (e, em empate, o procedimento) contra a produção e o sistema. Grava a
   * admissão resolvida (admissao_origem = RESOLVIDA). Devolve quantas casou.
   */
  function resolverAdmissoesMedico() {
    const cli = (App.clienteAtivo() || {}).id || clienteId;
    const pend = Banco.query(
      `SELECT id, paciente_norm, data, procedimento_norm FROM linhas_medico
        WHERE cliente_id = ? AND TRIM(COALESCE(admissao, '')) = '' AND paciente_norm <> '' AND data <> ''`, [cli]);
    if (!pend.length) return 0;
    const chave = (pn, d) => pn + '|' + d;
    const cand = new Map();   // paciente|data → Map<normAdm, {adm, procs:Set}>
    const juntar = (rows) => {
      for (const r of rows) {
        const k = chave(U().normalizar(r.paciente), r.data);
        if (!cand.has(k)) cand.set(k, new Map());
        const m = cand.get(k);
        const a = U().normAdm(r.admissao);
        if (!m.has(a)) m.set(a, { adm: String(r.admissao).trim(), procs: new Set() });
        m.get(a).procs.add(r.procedimento_norm);
      }
    };
    const datas = [...new Set(pend.map(x => x.data))];
    for (let i = 0; i < datas.length; i += 400) {
      const lote = datas.slice(i, i + 400);
      const marcas = lote.map(() => '?').join(',');
      juntar(Banco.query(`SELECT admissao, paciente, data, procedimento_norm FROM linhas_producao
        WHERE cliente_id = ? AND data IN (${marcas})`, [cli, ...lote]));
      juntar(Banco.query(`SELECT admissao, paciente, data, procedimento_norm FROM linhas_repasse
        WHERE cliente_id = ? AND data IN (${marcas})`, [cli, ...lote]));
    }
    let n = 0;
    Banco.transacao(() => {
      for (const x of pend) {
        const m = cand.get(chave(x.paciente_norm, x.data));
        if (!m || !m.size) continue;
        let escolhida = null;
        if (m.size === 1) escolhida = [...m.values()][0];
        else {
          // paciente com 2+ admissões no mesmo dia: desempata pelo procedimento
          const comProc = [...m.values()].filter(c => [...c.procs].some(pr =>
            pr === x.procedimento_norm || U().similaridade(pr, x.procedimento_norm) >= 0.88));
          if (comProc.length === 1) escolhida = comProc[0];
        }
        if (!escolhida) continue;
        Banco.executar(`UPDATE linhas_medico SET admissao = ?, admissao_origem = 'RESOLVIDA' WHERE id = ?`,
          [escolhida.adm, x.id]);
        n++;
      }
    });
    return n;
  }

  /** Tudo de UMA admissão + o diagnóstico pronto. */
  function inspecionar(admInput) {
    const d = dados();
    const adm = U().normAdm(admInput);
    const prod = d.prodPor.get(adm) || [];
    const rep = d.repPor.get(adm) || [];
    const mAdm = d.motorPor.get(adm) || null;
    const med = d.medPor.get(adm) || [];

    const totalRepassado = rep.reduce((s, l) =>
      s + (/glosa/i.test(String(l.status || '')) ? 0 : (Number(l.repassado) || 0)), 0);
    const compsPagas = [...new Set(rep.filter(l => Number(l.repassado) > 0)
      .map(l => l.competencia).filter(Boolean))].sort();
    const porComp = new Map();
    for (const l of rep) {
      if (!(Number(l.repassado) > 0)) continue;
      const c = l.competencia || '?';
      porComp.set(c, (porComp.get(c) || 0) + Number(l.repassado));
    }

    let tom, titulo;
    if (rep.length && totalRepassado > 0) { tom = 'ok'; titulo = FRASE_PAGA; }
    else if (rep.length) { tom = 'etapa'; titulo = 'Admissão no sistema sem valor repassado'; }
    else if (prod.length) { tom = 'aviso'; titulo = FRASE_AGUARDANDO; }
    else { tom = 'nada'; titulo = FRASE_NADA; }

    // ── confronto SISTEMA × MÉDICO (só quando o cliente tem relatório do médico) ──
    const ehGlosaMed = (l) => /glosa/i.test(String(l.sistema || ''));
    const totalRecebido = Math.round(med.reduce((s, l) =>
      s + (ehGlosaMed(l) ? 0 : (Number(l.valor) || 0)), 0) * 100) / 100;
    const compsRecebidas = [...new Set(med.filter(l => !ehGlosaMed(l) && Number(l.valor) !== 0)
      .map(l => l.competencia).filter(Boolean))].sort();
    const TOL = Number(Banco.configLer('tolerancia_centavos', 0.05)) || 0.05;
    let confronto = { estado: 'sem_base', sistema: totalRepassado, medico: totalRecebido, dif: 0, itens: [] };
    if (d.temBaseMedico) {
      const dif = Math.round((totalRepassado - totalRecebido) * 100) / 100;
      let estado;
      if (totalRepassado > 0 && totalRecebido <= 0) estado = 'nao_chegou';
      else if (totalRepassado <= 0 && totalRecebido > 0) estado = 'sem_lastro';
      else if (totalRepassado <= 0 && totalRecebido <= 0) estado = 'nada';
      else if (Math.abs(dif) <= TOL) estado = 'conforme';
      else estado = 'divergente';
      // item a item: linha paga no sistema sem par (procedimento + papel) no médico
      const itens = [];
      if (estado !== 'nada' && estado !== 'sem_lastro') {
        const usadas = new Set();
        const equiv = (a, b) => a === b ||
          (['INDICANTE', 'SOLICITANTE'].includes(a) && ['INDICANTE', 'SOLICITANTE'].includes(b));
        for (const lr of rep) {
          if (!(Number(lr.repassado) > 0) || /glosa/i.test(String(lr.status || ''))) continue;
          const par = med.find((lm, i) => !usadas.has(i) && !ehGlosaMed(lm) &&
            equiv(lm.papel_canon || '', lr.papel_canon || '') &&
            (lm.procedimento_norm === lr.procedimento_norm ||
             U().similaridade(lm.procedimento_norm, lr.procedimento_norm) >= 0.8));
          if (par) { usadas.add(med.indexOf(par)); continue; }
          itens.push({ procedimento: lr.procedimento, papel: lr.papel_canon || lr.papel || '—',
            valor: Number(lr.repassado) || 0 });
        }
      }
      confronto = { estado, sistema: totalRepassado, medico: totalRecebido, dif, itens };
    }

    return { adm, prod, rep, med, mAdm, tom, titulo, totalRepassado, compsPagas, porComp,
      totalRecebido, compsRecebidas, confronto };
  }

  // ────────────────────────────────────────────────────────────────────
  // ALERTAS — o motor decide; as vigias individualizam (metodologia §9)
  // itens faltantes = NAO_PAGO / PAGO_A_OUTRO / SEM_REGRA do resultado
  // ────────────────────────────────────────────────────────────────────
  function alertasDe(insp, opts) {
    if (!insp.mAdm) return [];
    const o = opts || {};
    const vigias = lerVigias();
    const norm = (s) => U().normalizar(s);
    const casaVigia = (item) => vigias.some(v =>
      (norm(item.procedimento).includes(norm(v.produto)) ||
       U().similaridade(norm(item.procedimento), norm(v.produto)) >= 0.88) &&
      (v.papel === 'TODOS' || v.papel === item.papel));

    const medSel = lerSet(CFG.medSel), papelSel = lerSet(CFG.papelSel), prodSit = lerSet(CFG.prodSit);
    const out = [];
    for (const i of insp.mAdm.itens) {
      if (!['NAO_PAGO', 'PAGO_A_OUTRO', 'SEM_REGRA'].includes(i.status)) continue;
      if (o.fonte && i.fonte !== o.fonte) continue;
      // recortes ativos (metodologia: o escopo segue o recorte)
      if (medSel.size && i.medico && !medSel.has(norm(i.medico))) continue;
      if (papelSel.size && !papelSel.has(i.papel)) continue;
      if (prodSit.size && ![...prodSit].some(p => norm(i.procedimento).includes(p))) continue;
      // com vigia marcada, o motor geral fica individualizado nos vigiados
      if (vigias.length && !casaVigia(i)) continue;

      const rotProc = i.procedimento;
      if (i.status === 'SEM_REGRA') {
        out.push({ item: i, grave: false, texto: `${rotProc} - ${FRASE_SEM_REGRA}` });
      } else if (insp.totalRepassado <= 0) {
        out.push({ item: i, grave: true, texto: `${rotProc} - ${FRASE_SEM_EXECUCAO}` });
      } else {
        const quem = QUEM_DO_PAPEL[i.papel] || i.papel.toLowerCase();
        out.push({
          item: i, grave: true,
          texto: `${rotProc} - ${PAPEL_ROTULO[i.papel] || i.papel} não encontrado para pagamento` +
            ` / sem informação de ${quem} no sistema` +
            (i.motivo === 'pago_a_outro' && i.pagoA ? ` (pago a ${i.pagoA})` : ''),
        });
      }
    }
    return out;
  }

  /** Faltante da admissão no recorte ativo (para stats/extração). */
  function faltanteDe(insp, fonte) {
    if (!insp.mAdm) return 0;
    const norm = (s) => U().normalizar(s);
    const medSel = lerSet(CFG.medSel), papelSel = lerSet(CFG.papelSel), prodSit = lerSet(CFG.prodSit);
    let total = 0;
    for (const i of insp.mAdm.itens) {
      if (!(i.falta > 0)) continue;
      if (fonte && i.fonte !== fonte) continue;
      if (medSel.size && i.medico && !medSel.has(norm(i.medico))) continue;
      if (papelSel.size && !papelSel.has(i.papel)) continue;
      if (prodSit.size && ![...prodSit].some(p => norm(i.procedimento).includes(p))) continue;
      total += i.falta;
    }
    return Math.round(total * 100) / 100;
  }

  // ────────────────────────────────────────────────────────────────────
  // OCULTAR NOMES (só na tela — a extração sempre sai com nomes reais)
  // ────────────────────────────────────────────────────────────────────
  const _codigos = new Map();
  function medEx(nome) {
    const n = String(nome || '').trim();
    if (!n || !st.ocultar) return n;
    const k = U().normalizar(n);
    if (!_codigos.has(k)) _codigos.set(k, 'MÉDICO ' + String(_codigos.size + 1).padStart(2, '0'));
    return _codigos.get(k);
  }
  function pacEx(nome) {
    const n = String(nome || '').trim();
    if (!n || !st.ocultar) return n;
    return n.split(/\s+/).map(p => p[0] ? p[0].toUpperCase() + '.' : '').join(' ');
  }

  // ────────────────────────────────────────────────────────────────────
  // BUSCA
  // ────────────────────────────────────────────────────────────────────
  function buscarPorNome(nome, dataISO) {
    const palavras = U().normalizar(nome).split(' ').filter(Boolean);
    if (!palavras.length) return [];
    // LIKE largo pela 1ª palavra (barato) + refino JS com TODAS as palavras
    const rows = Banco.query(
      `SELECT admissao, data, paciente, procedimento, classificacao FROM linhas_producao
        WHERE cliente_id = ? AND paciente LIKE ? LIMIT 8000`,
      [clienteId, '%' + palavras[0] + '%']);
    const porAdm = new Map();
    for (const r of rows) {
      const pn = U().normalizar(r.paciente);
      if (!palavras.every(p => pn.includes(p))) continue;
      if (dataISO && r.data !== dataISO) continue;
      const k = U().normAdm(r.admissao);
      if (!porAdm.has(k)) {
        porAdm.set(k, { adm: k, admRotulo: String(r.admissao).trim(), data: r.data,
          paciente: r.paciente, proc: '' });
      }
      const reg = porAdm.get(k);
      if (!reg.proc && U().normalizar(r.classificacao) === 'PROCEDIMENTO') reg.proc = r.procedimento;
      if (!reg.proc) reg.proc = reg.proc || r.procedimento;
    }
    return [...porAdm.values()].sort((a, b) => String(b.data).localeCompare(String(a.data)));
  }

  // ────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────
  function montar() {
    el = document.getElementById('conteudo');
    const cliente = App.clienteAtivo();
    if (!cliente) { App.avisoSemCliente(el); return; }
    clienteId = cliente.id;
    render();
  }

  function render() {
    const cliente = App.clienteAtivo();
    const pauta = lerPauta();
    const d = dados();

    // stats da pauta (referência visual: fileira de cards, o último escuro)
    let stPagas = 0, stAguard = 0, stFalta = 0, stNaoChegou = 0, stNaoChegouN = 0;
    for (const p of pauta) {
      const i = inspecionar(p.admissao);
      if (i.tom === 'ok') stPagas++;
      else if (i.tom === 'aviso') stAguard++;
      stFalta += faltanteDe(i, null);
      if (i.confronto.estado === 'nao_chegou' || i.confronto.estado === 'divergente') {
        stNaoChegou += Math.max(0, i.confronto.dif); stNaoChegouN++;
      }
    }

    el.innerHTML = `
      <div class="insp-hero">
        <div class="insp-hero-acoes">
          <button class="botao botao-mini" id="insp-ocultar">${st.ocultar ? '👁 mostrar nomes' : '🕶 ocultar nomes'}</button>
          ${st.latAberta ? '' : '<button class="botao botao-mini" id="insp-abrir-lat">🗂 planilha do médico</button>'}
        </div>
        <h1>Inspeção da Admissão</h1>
        <p>Rastreie a admissão pelas bases, na ordem em que o dinheiro caminha —
        sistema (relatório cru), resultado auditado, produção e o que o médico de fato
        recebeu — e veja onde ela parou.
        Cliente: <strong>${esc(cliente.nome)}</strong></p>
      </div>

      <div class="insp-busca">
        <div class="insp-busca-abas">
          <button class="insp-busca-aba ${st.modo === 'admissao' ? 'ativa' : ''}" data-modo="admissao">Admissão</button>
          <button class="insp-busca-aba ${st.modo === 'paciente' ? 'ativa' : ''}" data-modo="paciente">Paciente</button>
        </div>
        <div class="insp-busca-campos">
          ${st.modo === 'admissao' ? `
            <div class="insp-busca-campo" style="max-width:280px">
              <span class="insp-busca-rotulo">Código da admissão</span>
              <input id="q-adm" placeholder="ex.: 39476901" value="${esc(st.qAdm)}">
            </div>` : `
            <div class="insp-busca-campo">
              <span class="insp-busca-rotulo">Nome do paciente</span>
              <input id="q-nome" placeholder="todas as palavras contam" value="${esc(st.qNome)}">
            </div>
            <div class="insp-busca-campo" style="max-width:190px">
              <span class="insp-busca-rotulo">Data da admissão</span>
              <input id="q-data" type="date" value="${esc(st.qData)}">
            </div>`}
          <div class="insp-busca-botoes">
            <button class="insp-btn-buscar" id="insp-buscar">🔎 Buscar</button>
            <button class="insp-btn-limpar" id="insp-limpar">Limpar</button>
          </div>
        </div>
      </div>

      <div class="insp-stats">
        <div class="insp-stat"><div class="insp-stat-valor">${pauta.length.toLocaleString('pt-BR')}</div>
          <div class="insp-stat-rotulo">admissões na planilha do médico</div></div>
        <div class="insp-stat"><div class="insp-stat-valor texto-ok">${stPagas.toLocaleString('pt-BR')}</div>
          <div class="insp-stat-rotulo">pagas no repasse</div></div>
        <div class="insp-stat suave"><div class="insp-stat-valor texto-aviso">${stAguard.toLocaleString('pt-BR')}</div>
          <div class="insp-stat-rotulo">aguardando convênio / conciliação</div></div>
        <div class="insp-stat escuro"><div class="insp-stat-valor mono">${fmtR(stFalta)}</div>
          <div class="insp-stat-rotulo">repasse faltante na pauta</div></div>
        ${d.temBaseMedico ? `<div class="insp-stat"><div class="insp-stat-valor mono texto-erro">${fmtR(stNaoChegou)}</div>
          <div class="insp-stat-rotulo">no sistema e não no médico (${stNaoChegouN} adm.)</div></div>` : ''}
      </div>

      <div class="insp-corpo">
        <div class="insp-principal" id="insp-principal"></div>
        <aside class="insp-lateral ${st.latAberta ? '' : 'fechada'}" id="insp-lateral"></aside>
      </div>`;

    // handlers do topo
    el.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => {
      st.modo = b.dataset.modo; st.candidatas = null; render();
    }));
    el.querySelector('#insp-buscar').addEventListener('click', buscar);
    el.querySelector('#insp-limpar').addEventListener('click', () => {
      st.qAdm = st.qNome = st.qData = ''; st.admAtual = null; st.candidatas = null; render();
    });
    const qa = el.querySelector('#q-adm');
    if (qa) { qa.addEventListener('input', e => st.qAdm = e.target.value);
      qa.addEventListener('keydown', e => { if (e.key === 'Enter') buscar(); }); }
    const qn = el.querySelector('#q-nome');
    if (qn) { qn.addEventListener('input', e => st.qNome = e.target.value);
      qn.addEventListener('keydown', e => { if (e.key === 'Enter') buscar(); }); }
    const qd = el.querySelector('#q-data');
    if (qd) qd.addEventListener('change', e => st.qData = e.target.value);
    el.querySelector('#insp-ocultar').addEventListener('click', () => { st.ocultar = !st.ocultar; render(); });
    const abrirLat = el.querySelector('#insp-abrir-lat');
    if (abrirLat) abrirLat.addEventListener('click', () => { st.latAberta = true; render(); });

    renderPrincipal(d);
    renderLateral();
  }

  function buscar() {
    st.candidatas = null;
    if (st.modo === 'admissao') {
      if (!st.qAdm.trim()) { Utilidades.toast('Informe o código da admissão.', 'aviso'); return; }
      st.admAtual = U().normAdm(st.qAdm);
      st.admAtualRotulo = st.qAdm.trim();
    } else {
      if (!st.qNome.trim()) { Utilidades.toast('Informe o nome do paciente.', 'aviso'); return; }
      const cand = buscarPorNome(st.qNome, st.qData);
      if (!cand.length) { st.admAtual = 'SEM_RESULTADO'; st.admAtualRotulo = st.qNome; }
      else if (cand.length === 1) { st.admAtual = cand[0].adm; st.admAtualRotulo = cand[0].admRotulo; }
      else { st.candidatas = cand; st.admAtual = null; }
    }
    render();
  }

  // ────────────────────────────────────────────────────────────────────
  function renderPrincipal(d) {
    const box = el.querySelector('#insp-principal');

    if (st.candidatas) {
      box.innerHTML = `
        <div class="insp-candidatas">
          <div class="diag-secao-titulo" style="padding:6px 10px 2px">
            ${st.candidatas.length} admissões encontradas — escolha qual inspecionar</div>
          ${st.candidatas.slice(0, 30).map((c, i) => `
            <button class="insp-candidata" data-cand="${i}">
              <span class="cod mono">${esc(c.admRotulo)}</span>
              <span class="quando">${Utilidades.dataExibir(c.data)}</span>
              <span>${esc(pacEx(c.paciente))}</span>
              <span class="proc">${esc(c.proc || '')}</span>
            </button>`).join('')}
        </div>`;
      box.querySelectorAll('[data-cand]').forEach(b => b.addEventListener('click', () => {
        const c = st.candidatas[Number(b.dataset.cand)];
        st.admAtual = c.adm; st.admAtualRotulo = c.admRotulo; st.candidatas = null; render();
      }));
      return;
    }

    if (!st.admAtual) {
      const temDados = d.prodPor.size || d.repPor.size;
      box.innerHTML = `<div class="painel"><div class="insp-painel-vazio">
        ${temDados
          ? 'Busque uma admissão pelo código ou pelo paciente — ou clique numa admissão da <strong>planilha do médico</strong> ao lado.'
          : 'Importe a produção e o repasse deste cliente em <strong>Importações</strong> para começar a inspecionar.'}
      </div></div>`;
      return;
    }

    const insp = inspecionar(st.admAtual === 'SEM_RESULTADO' ? '≡nada≡' : st.admAtual);
    renderDiagnostico(box, insp);
    renderPaineis(box, insp);
  }

  // ── card de diagnóstico ─────────────────────────────────────────────
  function renderDiagnostico(box, insp) {
    const alertas = alertasDe(insp, {});
    const faltantes = insp.mAdm ? insp.mAdm.itens.filter(i => i.falta > 0) : [];
    const pac = insp.prod[0] ? insp.prod[0].paciente : (insp.rep[0] ? insp.rep[0].paciente : '');
    const convs = [...new Set(insp.prod.map(l => l.convenio).concat(insp.rep.map(l => l.convenio)).filter(Boolean))];
    const fontes = [...new Set(insp.prod.map(l => l.fonte).concat(insp.rep.map(l => l.fonte)).filter(Boolean))];

    let sub = '';
    if (insp.tom === 'ok') {
      const comps = insp.compsPagas.map(c => Utilidades.compExibir(c) +
        (insp.porComp.size > 1 ? ` (${fmtR(insp.porComp.get(c) || 0)})` : '')).join(', ');
      sub = `Encontrada no repasse de ${comps || '—'} · ${fontes.join('/') || '—'} · ${esc(convs.join(', ') || '—')},
        com <strong>${fmtR(insp.totalRepassado)}</strong> repassado.`;
    } else if (insp.tom === 'etapa') {
      const soGlosa = insp.rep.length && insp.rep.every(l => /glosa/i.test(String(l.status || '')) || !(Number(l.repassado) > 0));
      sub = soGlosa && insp.rep.some(l => /glosa/i.test(String(l.status || '')))
        ? 'As linhas desta admissão constam como <span class="glosa">GLOSA</span> — não há repasse a executar.'
        : 'A admissão chegou no sistema, mas nenhum valor foi repassado — confira o processamento.';
    } else if (insp.tom === 'aviso') {
      sub = 'A admissão existe na produção e ainda não apareceu no repasse.';
    } else {
      sub = 'Nenhuma das bases contém esta admissão — confira o código ou as importações.';
    }

    // lista analítica do CRU: procedimento → médico → papéis e valores (×N; glosa em vermelho)
    let analitica = '';
    if (insp.rep.length) {
      const grupos = new Map();
      for (const l of insp.rep) {
        const k = l.procedimento_norm;
        if (!grupos.has(k)) grupos.set(k, { nome: l.procedimento, linhas: [] });
        grupos.get(k).linhas.push(l);
      }
      analitica = [...grupos.values()].map(g => {
        const porPapel = new Map();
        for (const l of g.linhas) {
          const glosa = /glosa/i.test(String(l.status || ''));
          const k = (l.papel_canon || l.papel || '—') + '|' + U().normalizar(l.medico) + '|' +
            (glosa ? 'G' : Number(l.repassado) || 0);
          if (!porPapel.has(k)) porPapel.set(k, { papel: l.papel_canon || l.papel || '—',
            medico: l.medico, valor: Number(l.repassado) || 0, glosa, n: 0 });
          porPapel.get(k).n++;
        }
        const partes = [...porPapel.values()].map(p =>
          `${PAPEL_ROTULO[p.papel] || esc(p.papel)} ${p.glosa
            ? '<span class="glosa">glosa</span>'
            : fmtR(p.valor)}${p.n > 1 ? ' ×' + p.n : ''}${p.medico ? ' · ' + esc(medEx(p.medico)) : ''}`);
        return `<div>• <strong>${esc(g.nome)}</strong> — ${partes.join(' · ')}</div>`;
      }).join('');
    }

    // ── bloco SISTEMA × MÉDICO ──
    const c = insp.confronto;
    let confrontoHTML = '';
    if (c.estado !== 'sem_base') {
      const linha = (cls, txt) => `<div class="${cls}">${txt}</div>`;
      let corpo = '';
      if (c.estado === 'conforme') corpo = linha('diag-neutro', `✔ ${FRASE_CONFORME} — ${fmtR(c.medico)}.`);
      else if (c.estado === 'nao_chegou') corpo = linha('diag-alerta', `⚠ ${FRASE_NAO_CHEGOU} — sistema ${fmtR(c.sistema)}, médico R$ 0,00.`);
      else if (c.estado === 'divergente') corpo = linha('diag-alerta', `⚠ ${FRASE_DIVERGENTE}: sistema ${fmtR(c.sistema)} · médico ${fmtR(c.medico)} · diferença ${fmtR(c.dif)}.`);
      else if (c.estado === 'sem_lastro') corpo = linha('diag-neutro', `${FRASE_SEM_LASTRO} — ${fmtR(c.medico)} (conferir).`);
      else corpo = linha('diag-neutro', 'Nada no sistema nem no relatório do médico para esta admissão.');
      if (c.itens.length) {
        corpo += c.itens.map(i => linha('diag-alerta',
          `• ${esc(i.procedimento)} · ${PAPEL_ROTULO[i.papel] || esc(i.papel)} · ${fmtR(i.valor)} — pago no sistema e não recebido pelo médico`)).join('');
      }
      confrontoHTML = `<div class="diag-secao"><div class="diag-secao-titulo">Sistema × relatório do médico</div>${corpo}</div>`;
    }
    const chipConfronto = c.estado === 'sem_base' ? '' :
      `<span class="badge badge-${c.estado === 'conforme' ? 'OK' : (c.estado === 'nao_chegou' || c.estado === 'divergente') ? 'NAO_PAGO' : 'SEM_REGRA'}"
        style="margin-left:8px">${c.estado === 'conforme' ? 'conferido com o médico' : c.estado === 'nao_chegou' ? 'não chegou ao médico'
        : c.estado === 'divergente' ? 'divergente' : c.estado === 'sem_lastro' ? 'sem lastro no sistema' : 'sem recebimento'}</span>`;

    box.innerHTML = `
      <div class="diag-card diag-${insp.tom}">
        <div class="diag-cab" id="diag-cab">
          <span class="diag-farol"></span>
          <div>
            <div class="diag-titulo">${esc(insp.titulo)}${chipConfronto}</div>
            <div class="diag-sub">admissão <strong class="mono">${esc(st.admAtualRotulo || insp.adm)}</strong>
              ${pac ? ' · ' + esc(pacEx(pac)) : ''}</div>
          </div>
          <span class="diag-seta">${st.diagAberto ? '▲ recolher' : '▼ expandir'}</span>
        </div>
        ${st.diagAberto ? `<div class="diag-corpo">
          <div class="diag-lista" style="margin-top:10px">${sub}</div>
          ${analitica ? `<div class="diag-secao"><div class="diag-secao-titulo">O que foi pago (sistema)</div>
            <div class="diag-lista">${analitica}</div></div>` : ''}
          ${confrontoHTML}
          ${alertas.length ? `<div class="diag-secao"><div class="diag-secao-titulo">Alertas</div>
            ${alertas.map(a => `<div class="${a.grave ? 'diag-alerta' : 'diag-neutro'}">${a.grave ? '⚠ ' : ''}${esc(a.texto)}</div>`).join('')}
          </div>` : ''}
          ${faltantes.length ? `<div class="diag-secao">
            <div class="diag-secao-titulo">⚠ Com regra de repasse e NÃO pago nesta admissão</div>
            ${faltantes.map(i => `<div class="diag-alerta">• ${esc(i.procedimento)} · ${PAPEL_ROTULO[i.papel] || esc(i.papel)}
              · ${fmtR(i.falta)}${i.medico ? ' · ' + esc(medEx(i.medico)) : ' · Médico não informado'}${i.motivo === 'pago_a_outro' && i.pagoA ? ' · pago a ' + esc(medEx(i.pagoA)) : ''}</div>`).join('')}
          </div>` : ''}
        </div>` : ''}
      </div>`;

    box.querySelector('#diag-cab').addEventListener('click', () => {
      st.diagAberto = !st.diagAberto; render();
    });
  }

  // ── os três painéis ─────────────────────────────────────────────────
  function renderPaineis(box, insp) {
    const painel = (titulo, sub, corpo) => `
      <div class="painel">
        <div class="painel-cabecalho"><span class="painel-titulo">${titulo}</span>
          <span class="painel-conta">${sub}</span></div>
        ${corpo}
      </div>`;
    const vazio = (msg) => `<div class="insp-painel-vazio">${msg}</div>`;
    const tagF = (f) => `<span class="tag-fonte tag-${esc(f || 'CONVENIO')}">${esc(f || '—')}</span>`;

    // 1 · repasse cru
    const p1 = insp.rep.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
        <th>Competência</th><th>Data</th><th>Paciente</th><th>Profissional</th><th>Papel</th>
        <th>Procedimento</th><th>Fonte</th><th>Convênio</th><th class="num">Qtd</th>
        <th class="num">Produzido</th><th class="num">Repassado</th><th>Status</th>
      </tr></thead><tbody>
      ${insp.rep.map(l => `<tr>
        <td>${Utilidades.compExibir(l.competencia)}</td>
        <td>${Utilidades.dataExibir(l.data)}</td>
        <td>${esc(pacEx(l.paciente))}</td>
        <td>${esc(medEx(l.medico))}</td>
        <td>${esc(l.papel || '—')}</td>
        <td>${esc(l.procedimento)}</td>
        <td>${tagF(l.fonte)}</td>
        <td>${esc(l.convenio || '—')}</td>
        <td class="num">${l.quantidade || 1}</td>
        <td class="num">${fmtR(l.produzido)}</td>
        <td class="num">${fmtR(l.repassado)}</td>
        <td>${/glosa/i.test(String(l.status || '')) ? '<span class="badge badge-NAO_PAGO">GLOSA</span>' : esc(l.status || '—')}</td>
      </tr>`).join('')}</tbody></table></div>`
      : vazio('Nada no sistema — ' + (insp.prod.length ? 'o pagador ainda não pagou esta admissão.' : 'admissão fora desta base.'));

    // 2 · resultado auditado
    const m = insp.mAdm;
    const p2 = m ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
        <th>Procedimento</th><th>Papel</th><th>Profissional</th><th>Fonte</th>
        <th>Regra</th><th class="num">Esperado</th><th class="num">Pago</th>
        <th class="num">Falta</th><th>Status</th>
      </tr></thead><tbody>
      ${m.itens.map(i => `<tr>
        <td>${esc(i.procedimento)}</td>
        <td>${PAPEL_ROTULO[i.papel] || esc(i.papel)}</td>
        <td>${esc(medEx(i.medico)) || '—'}</td>
        <td>${tagF(i.fonte)}</td>
        <td>${i.regra ? (i.regra.origem === 'BASE' ? '<span class="badge badge-BASE">BASE</span>' : '<span class="badge badge-INFERIDA">PADRÃO</span>') : '—'}</td>
        <td class="num">${i.esperado != null ? fmtR(i.esperado) : '—'}</td>
        <td class="num">${i.pago ? fmtR(i.pago) : '—'}</td>
        <td class="num ${i.falta > 0 ? 'texto-erro' : ''}">${i.falta > 0 ? fmtR(i.falta) : '—'}</td>
        <td><span class="badge badge-${i.status}">${esc(i.status.replace(/_/g, ' '))}</span></td>
      </tr>`).join('')}</tbody></table></div>`
      : vazio('Sem produção desta admissão, o motor não tem o que auditar.');

    // 3 · produção analítica
    const p3 = insp.prod.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
        <th>Admissão</th><th>Data</th><th>Paciente</th><th>Convênio</th><th>Fonte</th>
        <th>Classificação</th><th>Procedimento</th><th class="num">Qtd</th><th class="num">Valor</th>
        <th>Executante</th><th>Auxiliar</th><th>Indicante</th><th>Solicitante</th><th>Laudo</th>
      </tr></thead><tbody>
      ${insp.prod.map(l => `<tr>
        <td class="mono">${esc(l.admissao)}</td>
        <td>${Utilidades.dataExibir(l.data)}</td>
        <td>${esc(pacEx(l.paciente))}</td>
        <td>${esc(l.convenio || '—')}</td>
        <td>${tagF(l.fonte)}</td>
        <td>${esc(l.classificacao || '—')}</td>
        <td>${esc(l.procedimento)}</td>
        <td class="num">${l.quantidade || 1}</td>
        <td class="num">${fmtR(l.valor)}</td>
        <td>${esc(medEx(l.executante))}</td><td>${esc(medEx(l.auxiliar))}</td>
        <td>${esc(medEx(l.indicante))}</td><td>${esc(medEx(l.solicitante))}</td>
        <td>${esc(medEx(l.laudo))}</td>
      </tr>`).join('')}</tbody></table></div>`
      : vazio('Admissão fora da produção importada.');

    // 4 · o que o MÉDICO recebeu (só quando há relatório do médico importado)
    const d = dados();
    let p4 = '';
    if (d.temBaseMedico) {
      p4 = insp.med.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
          <th>Relatório</th><th>Sistema/Status</th><th>Módulo</th><th>Data</th><th>Paciente</th>
          <th>Papel</th><th>Procedimento</th><th>Fonte</th><th>Convênio</th><th class="num">Recebido</th>
        </tr></thead><tbody>
        ${insp.med.map(l => `<tr>
          <td>${Utilidades.compExibir(l.competencia)}</td>
          <td>${/glosa/i.test(String(l.sistema || '')) ? '<span class="badge badge-NAO_PAGO">GLOSA</span>' : esc(l.sistema || '—')}</td>
          <td>${esc(l.modulo || '—')}</td>
          <td>${Utilidades.dataExibir(l.data)}</td>
          <td>${esc(pacEx(l.paciente))}</td>
          <td>${esc(l.papel || '—')}</td>
          <td>${esc(l.procedimento)}</td>
          <td>${tagF(l.fonte)}</td>
          <td>${esc(l.convenio || '—')}</td>
          <td class="num ${Number(l.valor) < 0 ? 'texto-erro' : ''}">${fmtR(l.valor)}</td>
        </tr>`).join('')}</tbody></table></div>`
        : vazio('Nada no relatório do médico para esta admissão' +
            (insp.rep.length && insp.totalRepassado > 0 ? ' — o sistema consta pago e o médico não recebeu.' : '.'));
    }

    box.insertAdjacentHTML('beforeend',
      painel('1 · Sistema (relatório cru)', `${insp.rep.length} linha(s) — o que o sistema do hospital diz que pagou`, p1) +
      painel('2 · Resultado auditado', m ? `${m.itens.length} item(ns) — quem decide o que foi pago a quem devia` : '—', p2) +
      painel('3 · Produção analítica', `${insp.prod.length} linha(s) — o que o hospital produziu`, p3) +
      (d.temBaseMedico ? painel('4 · Recebido pelo médico', `${insp.med.length} linha(s) — o relatório que o médico de fato recebeu (${fmtR(insp.totalRecebido)})`, p4) : ''));
  }

  // ────────────────────────────────────────────────────────────────────
  // LATERAL — planilha do médico, vigias e recortes
  // ────────────────────────────────────────────────────────────────────
  function renderLateral() {
    const lat = el.querySelector('#insp-lateral');
    if (!st.latAberta) { lat.innerHTML = ''; return; }
    const d = dados();
    const pauta = lerPauta();
    const vigias = lerVigias();
    const medSel = lerSet(CFG.medSel), papelSel = lerSet(CFG.papelSel);
    const prodSel = lerSet(CFG.prodSel), prodSit = lerSet(CFG.prodSit);

    // produtos repassáveis do cliente (para vigias/coluna/situação)
    const produtos = produtosDoCliente();
    const medicos = [...d.resultado.porMedico.entries()]
      .filter(([k]) => k !== 'SEM PROFISSIONAL')
      .map(([k, r]) => ({ k, nome: r.medico })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    const busca = (id) => st.buscas[id] || '';
    const filtra = (lista, id, campo) => {
      const b = U().normalizar(busca(id));
      return b ? lista.filter(x => U().normalizar(x[campo]).includes(b)) : lista;
    };

    const blocoCheck = (id, titulo, itens, campo, chaveCfg, selecionados, chaveDoItem) => `
      <div class="lat-bloco">
        <div class="lat-bloco-titulo">${titulo}<span class="n">${selecionados.size ? selecionados.size + ' filtrado(s)' : 'todos'}</span></div>
        <input class="lat-busca" data-busca="${id}" placeholder="buscar…" value="${esc(busca(id))}">
        <div class="lat-lista">
          ${filtra(itens, id, campo).slice(0, 80).map(x => {
            const chave = chaveDoItem(x);
            return `<label class="lat-item"><input type="checkbox" data-cfg="${chaveCfg}" value="${esc(chave)}"
              ${selecionados.has(chave) ? 'checked' : ''}> <span>${esc(x[campo])}</span>
              ${x.n ? `<span class="conta">×${x.n}</span>` : ''}</label>`;
          }).join('') || '<div class="texto-cinza" style="font-size:11px">nada encontrado</div>'}
        </div>
      </div>`;

    lat.innerHTML = `
      <div class="lat-titulo">🗂 Planilha do médico
        <button class="fechar" id="lat-fechar" title="recolher">✕</button></div>
      <div class="lat-acoes">
        <label class="botao botao-mini" style="cursor:pointer" title="Relatório que o médico recebeu (3 gerações) ou lista de admissões">📥 Importar
          <input type="file" id="lat-importar" accept=".xlsx,.xls,.csv" style="display:none"></label>
        <button class="botao botao-mini botao-ouro" id="lat-exportar" ${st.exportando ? 'disabled' : ''}>📤 Exportar</button>
        <button class="botao botao-mini botao-perigo" id="lat-limpar">Limpar</button>
      </div>
      ${d.temBaseMedico ? `<div class="info-caixa" style="margin-bottom:10px;padding:8px 10px;font-size:11.5px">
        🧾 Relatório do médico: <strong>${d.medTotal.toLocaleString('pt-BR')}</strong> linha(s)
        ${d.medNaoResolvidas ? ` · <span class="texto-aviso">${d.medNaoResolvidas} sem admissão</span>
          <button class="botao botao-mini" id="lat-casar" style="margin-left:6px">🔗 casar por paciente+data</button>` : ''}
      </div>` : ''}
      <label class="lat-item" style="margin-bottom:10px">
        <input type="checkbox" id="lat-flag" ${flagFaltante() ? 'checked' : ''}>
        <span>Adicionar <strong>Repasse faltante</strong> na extração</span></label>

      <div class="lat-bloco">
        <div class="lat-bloco-titulo">⚡ Alertas de papel (vigias)<span class="n">${vigias.length}</span></div>
        ${vigias.map((v, i) => `<div class="lat-vigia">👁 <strong>${esc(v.produto)}</strong>
          · ${PAPEL_ROTULO[v.papel] || esc(v.papel)}
          <button class="x" data-vigia-rem="${i}" title="remover">✕</button></div>`).join('')}
        <div style="display:flex;gap:5px;margin-top:6px">
          <input class="lat-busca" id="vigia-prod" list="lista-produtos" placeholder="produto…" style="margin:0;flex:1">
          <select class="entrada" id="vigia-papel" style="font-size:11px;padding:4px">
            ${['TODOS', ...U().PAPEIS].map(p => `<option value="${p}">${PAPEL_ROTULO[p] || p}</option>`).join('')}
          </select>
          <button class="botao botao-mini" id="vigia-add">＋</button>
        </div>
        <datalist id="lista-produtos">${produtos.slice(0, 400).map(p => `<option value="${esc(p.produto)}">`).join('')}</datalist>
      </div>

      ${blocoCheck('med', '🩺 Médicos (recorte)', medicos, 'nome', CFG.medSel, medSel, x => x.k)}
      ${blocoCheck('papel', '🎭 Participação (recorte)',
        U().PAPEIS.map(p => ({ papel: p, nome: PAPEL_ROTULO[p] || p })), 'nome', CFG.papelSel, papelSel, x => x.papel)}
      ${blocoCheck('psit', '📌 Produtos na Situação', produtos, 'produto', CFG.prodSit, prodSit, x => U().normalizar(x.produto))}
      ${blocoCheck('pcol', '🧾 Coluna de produtos (extração)', produtos, 'produto', CFG.prodSel, prodSel, x => U().normalizar(x.produto))}

      <div class="lat-bloco">
        <div class="lat-bloco-titulo">Admissões da pauta<span class="n">${pauta.length}</span></div>
        <div class="lat-lista" style="max-height:320px">
          ${pauta.length ? pauta.map((p, i) => {
            const pend = !d.repPor.has(U().normAdm(p.admissao));
            return `<button class="lat-pauta-item ${pend ? 'pendente' : ''} ${st.admAtual === U().normAdm(p.admissao) ? 'ativa' : ''}"
              data-pauta="${i}" ${pend ? `title="${DICA_PENDENTE}"` : ''}>
              <span class="cod mono">${esc(p.admissao)}</span>
              <span class="quem">${esc(pacEx(p.paciente || ''))}</span>
              <span class="quando">${p.data ? Utilidades.dataExibir(p.data) : ''}</span>
            </button>`;
          }).join('') : '<div class="texto-cinza" style="font-size:11px">Importe a planilha do médico — a lista de admissões aparece aqui e viaja no banco.</div>'}
        </div>
      </div>`;

    // handlers
    lat.querySelector('#lat-fechar').addEventListener('click', () => { st.latAberta = false; render(); });
    lat.querySelector('#lat-importar').addEventListener('change', importarPlanilhaLateral);
    const btnCasar = lat.querySelector('#lat-casar');
    if (btnCasar) btnCasar.addEventListener('click', () => {
      const n = resolverAdmissoesMedico();
      Banco.salvarDebounced();
      Utilidades.toast(n ? `${n} linha(s) casaram com admissões da produção/sistema.` : 'Nenhuma linha casou — confira paciente e data.', n ? 'ok' : 'aviso');
      render();
    });
    lat.querySelector('#lat-exportar').addEventListener('click', exportarExtracao);
    lat.querySelector('#lat-limpar').addEventListener('click', () => {
      const temMed = dados().temBaseMedico;
      if (!lerPauta().length && !temMed) return;
      if (!confirm(temMed ? 'Limpar a pauta E o relatório do médico importado?' : 'Limpar a pauta importada?')) return;
      cfgGravar(CFG.pauta, []);
      if (temMed) {
        Banco.transacao(() => {
          Banco.executar('DELETE FROM linhas_medico WHERE cliente_id = ?', [clienteId]);
          Banco.executar(`DELETE FROM importacoes WHERE cliente_id = ? AND tipo = 'MEDICO'`, [clienteId]);
        });
        Banco.salvarDebounced();
      }
      render();
    });
    lat.querySelector('#lat-flag').addEventListener('change', (e) => {
      cfgGravar(CFG.flagFaltante, e.target.checked ? '1' : '0');
    });
    lat.querySelectorAll('[data-busca]').forEach(inp => inp.addEventListener('input', (e) => {
      st.buscas[inp.dataset.busca] = e.target.value;
      clearTimeout(st._tl); st._tl = setTimeout(renderLateral, 250);
    }));
    lat.querySelectorAll('[data-cfg]').forEach(cb => cb.addEventListener('change', () => {
      const chave = cb.dataset.cfg;
      const set = lerSet(chave);
      if (cb.checked) set.add(cb.value); else set.delete(cb.value);
      gravarSet(chave, set);
      render();   // recortes mudam stats/diagnóstico
    }));
    lat.querySelectorAll('[data-vigia-rem]').forEach(b => b.addEventListener('click', () => {
      const v = lerVigias(); v.splice(Number(b.dataset.vigiaRem), 1);
      cfgGravar(CFG.vigias, v); render();
    }));
    lat.querySelector('#vigia-add').addEventListener('click', () => {
      const prod = lat.querySelector('#vigia-prod').value.trim();
      const papel = lat.querySelector('#vigia-papel').value;
      if (!prod) { Utilidades.toast('Informe o produto a vigiar.', 'aviso'); return; }
      const v = lerVigias(); v.push({ produto: prod, papel });
      cfgGravar(CFG.vigias, v); render();
    });
    lat.querySelectorAll('[data-pauta]').forEach(b => b.addEventListener('click', () => {
      const p = lerPauta()[Number(b.dataset.pauta)];
      if (!p) return;
      st.admAtual = U().normAdm(p.admissao); st.admAtualRotulo = String(p.admissao);
      st.candidatas = null; render();
    }));
  }

  let _prodMemo = { versao: -1, lista: null };
  function produtosDoCliente() {
    if (_prodMemo.versao === Banco._versao && _prodMemo.lista) return _prodMemo.lista;
    const NAO = new Set(['MATERIAL', 'MEDICAMENTO', 'MAT MED', 'MATMED', 'MAT/MED', 'TAXA', 'OPME', 'GAS', 'DIARIA']);
    const rows = Banco.query(
      `SELECT procedimento AS produto, classificacao, COUNT(*) AS n FROM linhas_producao
        WHERE cliente_id = ? GROUP BY procedimento_norm ORDER BY n DESC LIMIT 2000`, [clienteId]);
    _prodMemo = { versao: Banco._versao, lista: rows
      .filter(r => !NAO.has(U().normalizar(r.classificacao)))
      .map(r => ({ produto: String(r.produto).trim(), n: r.n })) };
    return _prodMemo.lista;
  }

  // ────────────────────────────────────────────────────────────────────
  // IMPORTAÇÃO DA PLANILHA DO MÉDICO — 3 formatos (spec §6)
  // ────────────────────────────────────────────────────────────────────
  async function importarPlanilhaLateral(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    e.target.value = '';
    let matriz;
    try {
      Utilidades.loading.mostrar('Lendo a planilha do médico…');
      matriz = Importador.lerPlanilha(await f.arrayBuffer()).matriz;
    } catch (err) {
      Utilidades.loading.esconder();
      Utilidades.toast('Não consegui ler o arquivo: ' + (err.message || err), 'erro', 5000);
      return;
    }
    Utilidades.loading.esconder();
    const det = Importador.pareceRelatorioMedico(matriz);
    if (det.ok) { confirmarRelatorioMedico(matriz, det, f.name); return; }
    importarPauta(matriz);
  }

  /** Modal curto: hospital do relatório + competência (lida do cabeçalho). */
  function confirmarRelatorioMedico(matriz, det, nomeArquivo) {
    const hospitais = App.listarHospitais(clienteId);
    if (!hospitais.length) { Utilidades.toast('Cadastre um hospital para este cliente antes.', 'aviso'); return; }
    const compDet = Importador.detectarCompetenciaRelatorio(matriz);
    const nLinhas = Math.max(0, matriz.length - det.linhaCab - 1);
    const campos = Importador.CAMPOS.MEDICO.filter(c => det.map[c.campo] != null)
      .map(c => c.rotulo.split(' (')[0]).join(' · ');
    const ov = document.createElement('div');
    ov.className = 'modal-fundo';
    ov.innerHTML = `
      <div class="modal">
        <div class="modal-cabecalho"><span class="modal-titulo">🧾 Relatório do médico reconhecido</span>
          <button class="modal-fechar">✕</button></div>
        <div class="modal-corpo">
          <div class="info-caixa">Arquivo <strong>${esc(nomeArquivo)}</strong> · cabeçalho na linha ${det.linhaCab + 1}
            · ~${nLinhas.toLocaleString('pt-BR')} linhas.<br>Colunas reconhecidas: ${esc(campos)}.
            ${det.map.admissao == null ? '<br><strong>Sem coluna de admissão</strong> — as linhas serão casadas por paciente + data contra a produção/sistema.' : ''}</div>
          <div class="linha-campos">
            <div class="campo"><span class="campo-rotulo">Hospital do relatório</span>
              <select id="rm-hosp">${hospitais.map(h => `<option value="${h.id}">${esc(h.nome)}</option>`).join('')}</select></div>
            <div class="campo" style="max-width:180px"><span class="campo-rotulo">Mês do pagamento</span>
              <input type="month" id="rm-comp" value="${esc(compDet)}"></div>
          </div>
          <label class="lat-item" style="margin-top:12px"><input type="checkbox" id="rm-subst" checked>
            <span>Substituir o que já foi importado deste hospital para esta competência</span></label>
          <label class="lat-item"><input type="checkbox" id="rm-pauta" checked>
            <span>Montar a pauta com as admissões deste relatório</span></label>
        </div>
        <div class="modal-rodape">
          <button class="botao" id="rm-cancelar">Cancelar</button>
          <button class="botao botao-ouro" id="rm-ok">📥 Importar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const fechar = () => ov.remove();
    ov.querySelector('.modal-fechar').addEventListener('click', fechar);
    ov.querySelector('#rm-cancelar').addEventListener('click', fechar);
    ov.querySelector('#rm-ok').addEventListener('click', () => {
      const comp = ov.querySelector('#rm-comp').value;
      if (!comp) { Utilidades.toast('Informe o mês do pagamento.', 'aviso'); return; }
      const opts = { hospitalId: Number(ov.querySelector('#rm-hosp').value), competencia: comp,
        arquivo: nomeArquivo, substituir: ov.querySelector('#rm-subst').checked,
        montarPauta: ov.querySelector('#rm-pauta').checked };
      fechar();
      try {
        Utilidades.loading.mostrar('Importando o relatório do médico…');
        const r = importarRelatorioMedico(matriz, opts);
        Utilidades.toast(`${r.inseridas.toLocaleString('pt-BR')} linha(s) do relatório do médico` +
          (r.casadas ? ` · ${r.casadas} admissões casadas por paciente+data` : '') +
          (r.semAdmissao ? ` · ${r.semAdmissao} sem admissão` : ''), 'ok', 6000);
        render();
      } catch (err) {
        console.error(err);
        Utilidades.toast('Importação falhou: ' + (err.message || err), 'erro', 6000);
      } finally { Utilidades.loading.esconder(); }
    });
  }

  /**
   * Importa o relatório do médico (qualquer geração) a partir da matriz.
   * opts: { hospitalId, competencia, arquivo, substituir, montarPauta }
   */
  function importarRelatorioMedico(matriz, opts) {
    const det = Importador.pareceRelatorioMedico(matriz);
    if (!det.ok) throw new Error('A planilha não tem papel + valor + procedimento — não parece um relatório do médico.');
    const cli = (App.clienteAtivo() || {}).id || clienteId;
    const r = Importador.aplicar({
      tipo: 'MEDICO', matriz, linhaCab: det.linhaCab, map: det.map,
      clienteId: cli, hospitalId: opts.hospitalId, arquivo: opts.arquivo || '',
      competencia: opts.competencia, substituir: opts.substituir !== false,
    });
    const casadas = resolverAdmissoesMedico();
    const semAdmissao = Banco.escalar(
      `SELECT COUNT(*) FROM linhas_medico WHERE cliente_id = ? AND TRIM(COALESCE(admissao,'')) = ''`, [cli]) || 0;
    if (opts.montarPauta !== false) {
      const rows = Banco.query(
        `SELECT admissao, MIN(paciente) AS paciente, MIN(data) AS data FROM linhas_medico
          WHERE cliente_id = ? AND TRIM(COALESCE(admissao,'')) <> '' GROUP BY admissao ORDER BY MIN(data)`, [cli]);
      cfgGravar(CFG.pauta, rows.map(x => ({ admissao: String(x.admissao).trim(), paciente: x.paciente || '', data: x.data || '' })));
    }
    Banco.salvarDebounced();
    return { inseridas: r.inseridas, casadas, semAdmissao };
  }

  function importarPauta(matriz) {
    try {
      const pauta = detectarPauta(matriz);
      if (!pauta.length) throw new Error('Nenhuma admissão reconhecida na planilha.');
      cfgGravar(CFG.pauta, pauta);
      Utilidades.toast(`${pauta.length} admissão(ões) na pauta.`, 'ok');
      render();
    } catch (err) {
      console.error(err);
      Utilidades.toast('Importação falhou: ' + (err.message || err), 'erro', 5000);
    }
  }

  function detectarPauta(matriz) {
    const norm = (s) => U().normalizar(s);
    const ATE = Math.min(matriz.length, 15);

    // formato 1: colunas NOME + DATA · formato 2: coluna ADMISSÃO
    for (let i = 0; i < ATE; i++) {
      const linha = (matriz[i] || []).map(c => norm(c));
      const colNome = linha.findIndex(c => /\b(PACIENTE|NOME)\b/.test(c));
      const colData = linha.findIndex(c => /\b(DATA|ATENDIMENTO)\b/.test(c) && !/NASC/.test(c));
      if (colNome >= 0 && colData >= 0) return pautaPorNomeData(matriz, i, colNome, colData);
      const colAdm = linha.findIndex(c => (/ADMISS/.test(c) || /^COD/.test(c) || /^N /.test(c)) && !/DATA/.test(c));
      if (colAdm >= 0) return pautaPorAdmissao(matriz, i, colAdm);
    }
    // formato 3: sem cabeçalho — toda célula com 5+ dígitos é admissão
    const achadas = new Set();
    for (const linha of matriz) {
      for (const cel of (linha || [])) {
        const dig = String(cel == null ? '' : cel).replace(/\.0+$/, '').replace(/\D/g, '');
        if (dig.length >= 5) achadas.add(dig.replace(/^0+/, '') || dig);
      }
    }
    return resolverPelaProducao([...achadas].map(a => ({ admissao: a })));
  }

  function pautaPorNomeData(matriz, linhaCab, colNome, colData) {
    const alvo = [];
    for (let i = linhaCab + 1; i < matriz.length; i++) {
      const nome = String((matriz[i] || [])[colNome] || '').trim();
      const data = U().paraDataISO((matriz[i] || [])[colData]);
      if (nome) alvo.push({ nomeN: U().normalizar(nome), nome, data });
    }
    if (!alvo.length) return [];
    const datas = [...new Set(alvo.map(a => a.data).filter(Boolean))];
    const marcas = datas.map(() => '?').join(',');
    const rows = datas.length ? Banco.query(
      `SELECT admissao, paciente, data FROM linhas_producao
        WHERE cliente_id = ? AND data IN (${marcas}) GROUP BY admissao, paciente, data`,
      [clienteId, ...datas]) : [];
    const pauta = [];
    const vistos = new Set();
    for (const a of alvo) {
      const hit = rows.find(r => r.data === a.data && (() => {
        const pn = U().normalizar(r.paciente);
        return pn.includes(a.nomeN) || a.nomeN.includes(pn);
      })());
      const item = hit
        ? { admissao: String(hit.admissao).trim(), paciente: hit.paciente, data: hit.data }
        : { admissao: '', paciente: a.nome, data: a.data, naoEncontrada: true };
      const k = item.admissao || (a.nomeN + '|' + a.data);
      if (item.admissao && !vistos.has(k)) { vistos.add(k); pauta.push(item); }
    }
    return pauta;
  }

  function pautaPorAdmissao(matriz, linhaCab, colAdm) {
    const adms = [];
    const vistos = new Set();
    for (let i = linhaCab + 1; i < matriz.length; i++) {
      const bruto = String((matriz[i] || [])[colAdm] || '').trim();
      const k = U().normAdm(bruto);
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      adms.push({ admissao: bruto });
    }
    return resolverPelaProducao(adms);
  }

  /** paciente/data resolvidos pela produção (ou repasse). */
  function resolverPelaProducao(adms) {
    const d = dados();
    return adms.map(a => {
      const k = U().normAdm(a.admissao);
      const p = (d.prodPor.get(k) || [])[0] || (d.repPor.get(k) || [])[0] || {};
      return { admissao: String(a.admissao).trim(), paciente: p.paciente || '', data: p.data || '' };
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // EXTRAÇÃO — Inspecao_planilha_medico.xlsx (ExcelJS, spec §5)
  // ────────────────────────────────────────────────────────────────────
  async function exportarExtracao() {
    if (st.exportando) return;
    const pauta = lerPauta();
    if (!pauta.length) { Utilidades.toast('Importe a planilha do médico primeiro — a pauta está vazia.', 'aviso'); return; }
    if (typeof ExcelJS === 'undefined') { Utilidades.toast('Gerador de planilha ainda carregando — tente em 2s.', 'aviso'); return; }
    st.exportando = true;
    try {
      const wb = await gerarExtracao(pauta, (feitas, total) =>
        Utilidades.loading.mostrar(`Analisando… ${feitas}/${total}`));
      Utilidades.loading.mostrar('Montando planilha…');
      const buf = await wb.xlsx.writeBuffer();
      Utilidades.baixarArquivo('Inspecao_planilha_medico.xlsx', buf,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      Utilidades.toast('Extração gerada.', 'ok');
    } catch (err) {
      console.error(err);
      Utilidades.toast('Extração falhou: ' + (err.message || err), 'erro', 6000);
    } finally {
      st.exportando = false;
      Utilidades.loading.esconder();
      renderLateral();
    }
  }

  /** Monta o Workbook (separado do download para os testes conferirem). */
  async function gerarExtracao(pauta, progresso) {
    const comFaltante = flagFaltante();
    const vigias = lerVigias();
    const prodSel = [...lerSet(CFG.prodSel)];
    const AZUL = 'FF' + AZUL_SPEC, BRANCO = 'FFFFFFFF', ZEBRA = 'FFF2F0EA', VERM = 'FFA33C3C';

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Inspeção', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
    const cols = [
      { header: 'ADMISSÃO', key: 'adm', width: 14 },
      { header: 'NOME DO PACIENTE', key: 'pac', width: 30 },
      { header: 'DATA', key: 'data', width: 12 },
      { header: 'TIPO DE RECEBIMENTO', key: 'fonte', width: 16 },
      { header: 'CONVÊNIO', key: 'conv', width: 20 },
      { header: 'SITUAÇÃO', key: 'sit', width: 90 },
    ];
    for (const p of prodSel) cols.push({ header: ('PRODUTO · ' + p).slice(0, 60).toUpperCase(), key: 'p_' + p, width: 26 });
    if (vigias.length) cols.push({ header: 'PRODUÇÃO', key: 'temProd', width: 11 });
    if (comFaltante) cols.push({ header: 'REPASSE FALTANTE', key: 'falt', width: 18 });
    const comMedico = dados().temBaseMedico;
    if (comMedico) {
      cols.push({ header: 'PAGO NO SISTEMA', key: 'sis', width: 16 });
      cols.push({ header: 'RECEBIDO PELO MÉDICO', key: 'med', width: 20 });
      cols.push({ header: 'SISTEMA × MÉDICO', key: 'conf', width: 26 });
    }
    ws.columns = cols;
    estilizarCabecalho(ws, AZUL, BRANCO);

    const confirmacoes = [];   // aba Resumo: uma linha por admissão × alerta
    const valorRepassar = []; // aba Valor a Repassar
    let nPagas = 0, nAguard = 0, nComAlerta = 0, nNaoChegou = 0, zebra = false;
    const ROTULO_CONF = { conforme: 'conforme', nao_chegou: 'NÃO CHEGOU AO MÉDICO', divergente: 'DIVERGENTE',
      sem_lastro: 'sem lastro no sistema', nada: '—' };

    const LOTE = 40;
    for (let i = 0; i < pauta.length; i += LOTE) {
      for (const p of pauta.slice(i, i + LOTE)) {
        const insp = inspecionar(p.admissao);
        if (insp.tom === 'ok') nPagas++;
        if (insp.tom === 'aviso') nAguard++;

        const fontes = [...new Set(insp.prod.map(l => l.fonte).filter(Boolean))];
        if (!fontes.length) fontes.push(...new Set(insp.rep.map(l => l.fonte).filter(Boolean)));
        if (!fontes.length) fontes.push('CONVENIO');

        let admTemAlerta = false;
        for (const fonte of fontes) {
          const alertas = alertasDe(insp, { fonte });
          if (alertas.some(a => a.grave)) admTemAlerta = true;
          const falt = faltanteDe(insp, fonte);
          const linha = {
            adm: String(p.admissao),
            pac: p.paciente || (insp.prod[0] ? insp.prod[0].paciente : ''),
            data: p.data ? Utilidades.dataExibir(p.data) : (insp.prod[0] ? Utilidades.dataExibir(insp.prod[0].data) : ''),
            fonte,
            conv: [...new Set(insp.prod.filter(l => l.fonte === fonte).map(l => l.convenio).filter(Boolean))].join(', '),
            sit: { richText: situacaoRich(insp, fonte, alertas) },
          };
          for (const ps of prodSel) linha['p_' + ps] = papeisDoProduto(insp, ps, fonte);
          if (vigias.length) {
            linha.temProd = vigias.some(v => insp.prod.some(l => l.fonte === fonte &&
              U().normalizar(l.procedimento).includes(U().normalizar(v.produto)))) ? 'Sim' : 'Não';
          }
          if (comFaltante) linha.falt = falt;
          if (comMedico) {
            linha.sis = insp.totalRepassado; linha.med = insp.totalRecebido;
            linha.conf = ROTULO_CONF[insp.confronto.estado] || '';
          }
          const row = ws.addRow(linha);
          if (comMedico) {
            row.getCell('sis').numFmt = '"R$" #,##0.00'; row.getCell('med').numFmt = '"R$" #,##0.00';
            if (insp.confronto.estado === 'nao_chegou' || insp.confronto.estado === 'divergente') {
              row.getCell('conf').font = { bold: true, color: { argb: VERM } };
            }
          }
          row.alignment = { vertical: 'middle' };
          row.getCell('sit').alignment = { vertical: 'top', wrapText: true };
          const nLinhasTxt = linha.sit.richText.reduce((s, seg) => s + (String(seg.text).match(/\n/g) || []).length, 1);
          row.height = Math.min(180, Math.max(20, nLinhasTxt * 13));
          if (comFaltante) {
            const c = row.getCell('falt');
            c.numFmt = '"R$" #,##0.00';
            if (falt > 0) c.font = { bold: true, color: { argb: VERM } };
            else c.font = { color: { argb: 'FF8A8A8A' } };
          }
          if (zebra) row.eachCell({ includeEmpty: true }, (c) =>
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } });
          zebra = !zebra;

          for (const a of alertas.filter(x => x.grave)) {
            confirmacoes.push([String(p.admissao), linha.pac, linha.data,
              a.item.procedimento, PAPEL_ROTULO[a.item.papel] || a.item.papel, a.texto]);
          }
          if (comFaltante && insp.mAdm) {
            const grupos = new Map();
            for (const it of insp.mAdm.itens) {
              if (!(it.falta > 0) || it.fonte !== fonte) continue;
              if (!grupos.has(it.procedimento)) grupos.set(it.procedimento, []);
              grupos.get(it.procedimento).push(it);
            }
            for (const [proc, itens] of grupos) {
              valorRepassar.push([String(p.admissao), linha.pac, linha.data, proc,
                itens.map(it => `${PAPEL_ROTULO[it.papel] || it.papel} ${fmtR(it.falta)}` +
                  ` · ${it.medico || 'Médico não informado'}` +
                  (it.motivo === 'pago_a_outro' && it.pagoA ? ` · pago a ${it.pagoA}` : '')).join('  |  '),
                itens[0].regra && itens[0].regra.origem === 'INFERIDA' ? 'padrão inferido' : 'tabela atual',
                itens.reduce((s, it) => s + it.falta, 0)]);
            }
          }
        }
        if (admTemAlerta) nComAlerta++;
        if (insp.confronto.estado === 'nao_chegou' || insp.confronto.estado === 'divergente') nNaoChegou++;
      }
      if (progresso) progresso(Math.min(i + LOTE, pauta.length), pauta.length);
      await new Promise(r => setTimeout(r, 0));   // cede a thread entre lotes
    }

    // ── aba Resumo ──
    const wr = wb.addWorksheet('Resumo');
    wr.columns = [{ width: 16 }, { width: 34 }, { width: 12 }, { width: 40 }, { width: 18 }, { width: 70 }];
    const tit = (txt) => { const r = wr.addRow([txt]); r.font = { bold: true, size: 12, color: { argb: AZUL } }; };
    tit('PANORAMA DA LISTA');
    wr.addRow(['Admissões analisadas', pauta.length]);
    wr.addRow(['Pagas no repasse', nPagas]);
    wr.addRow(['Aguardando pagamento do convênio ou conciliação', nAguard]);
    wr.addRow(['Admissões com algum papel não pago', nComAlerta]);
    if (comMedico) wr.addRow(['Constam pagas no sistema e não chegaram ao médico (ou divergentes)', nNaoChegou]);
    wr.addRow([]);
    tit('COMO LER O PANORAMA');
    wr.addRow(['As linhas medem conjuntos diferentes — elas não se somam para fechar o total.']);
    wr.addRow([]);
    tit('CONFIRMAÇÕES SOBRE PAPÉIS NÃO PAGOS');
    const cab = wr.addRow(['ADMISSÃO', 'NOME DO PACIENTE', 'DATA', 'PROCEDIMENTO', 'PAPEL EXIGIDO', 'DIAGNÓSTICO']);
    cab.font = { bold: true, color: { argb: BRANCO } };
    cab.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } });
    for (const c of confirmacoes) wr.addRow(c);

    // ── aba Valor a Repassar (só com a flag) ──
    if (comFaltante) {
      const wv = wb.addWorksheet('Valor a Repassar', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
      wv.columns = [
        { header: 'ADMISSÃO', width: 14 }, { header: 'NOME DO PACIENTE', width: 32 },
        { header: 'DATA', width: 12 }, { header: 'PROCEDIMENTO', width: 40 },
        { header: 'PAPÉIS FALTANTES', width: 60 }, { header: 'VERSÃO DA TABELA', width: 18 },
        { header: 'VALOR A REPASSAR', width: 18 },
      ];
      estilizarCabecalho(wv, AZUL, BRANCO);
      let total = 0;
      for (const v of valorRepassar) {
        const r = wv.addRow(v);
        r.getCell(7).numFmt = '"R$" #,##0.00';
        total += Number(v[6]) || 0;
      }
      const rt = wv.addRow(['', '', '', '', '', 'TOTAL A REPASSAR', total]);
      rt.font = { bold: true };
      rt.getCell(7).numFmt = '"R$" #,##0.00';
      rt.getCell(7).font = { bold: true, color: { argb: VERM } };
    }
    return wb;
  }

  function estilizarCabecalho(ws, azul, branco) {
    const h = ws.getRow(1);
    h.height = 22;
    h.eachCell((c) => {
      c.font = { bold: true, color: { argb: branco } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: azul } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
    });
  }

  /** SITUAÇÃO em rich text — título azul negrito + corpo (frases fixas). */
  function situacaoRich(insp, fonte, alertas) {
    const seg = [];
    const azul = { bold: true, color: { argb: 'FF' + AZUL_SPEC } };
    if (insp.tom === 'ok') {
      const comps = insp.compsPagas.map(Utilidades.compExibir).join(', ');
      seg.push({ font: azul, text: `Paga no repasse de ${comps || '—'} — ${fmtR(insp.totalRepassado)}.` });
    } else if (fonte === 'PARTICULAR' && insp.tom !== 'nada') {
      seg.push({ font: azul, text: FRASE_PARTICULAR + '.' });
    } else if (insp.tom === 'aviso' || insp.tom === 'etapa') {
      seg.push({ font: azul, text: FRASE_AGUARDANDO + '.' });
    } else {
      seg.push({ font: azul, text: FRASE_NADA + '.' });
    }
    const c = insp.confronto;
    if (c.estado === 'nao_chegou') seg.push({ font: { bold: true, color: { argb: 'FFA33C3C' } }, text: `\n⚠ ${FRASE_NAO_CHEGOU} — sistema ${fmtR(c.sistema)}.` });
    else if (c.estado === 'divergente') seg.push({ font: { bold: true, color: { argb: 'FFA33C3C' } }, text: `\n⚠ ${FRASE_DIVERGENTE}: sistema ${fmtR(c.sistema)} · médico ${fmtR(c.medico)}.` });
    else if (c.estado === 'conforme') seg.push({ font: { color: { argb: 'FF2E7D5B' } }, text: `\n✔ ${FRASE_CONFORME} (${fmtR(c.medico)}).` });
    else if (c.estado === 'sem_lastro') seg.push({ font: {}, text: `\n${FRASE_SEM_LASTRO} (${fmtR(c.medico)}).` });
    for (const a of alertas) {
      seg.push({ font: a.grave ? { bold: true, color: { argb: 'FFA33C3C' } } : {},
        text: '\n' + (a.grave ? '⚠ ' : '') + a.texto });
    }
    // lista analítica compacta do que foi pago nesta fonte
    const pagos = insp.rep.filter(l => l.fonte === fonte && Number(l.repassado) > 0);
    if (pagos.length) {
      const partes = pagos.slice(0, 12).map(l =>
        `${l.procedimento} — ${l.papel_canon || l.papel || '—'} ${fmtR(l.repassado)}${l.medico ? ' (' + l.medico + ')' : ''}`);
      seg.push({ font: { color: { argb: 'FF5D6B7E' } }, text: '\n' + partes.join('\n') });
    }
    // sem nada no repasse: a descrição da admissão pela produção
    if (!insp.rep.length && insp.prod.length) {
      const classes = [...new Set(insp.prod.filter(l => l.fonte === fonte)
        .map(l => U().normalizar(l.classificacao)).filter(Boolean))];
      if (classes.length) seg.push({ font: { color: { argb: 'FF5D6B7E' } },
        text: '\nProdução da admissão: ' + classes.join(', ') + '.' });
    }
    return seg;
  }

  /** Coluna extra [PRODUTO · PAPÉIS]: os papéis que a regra remunera. */
  function papeisDoProduto(insp, produtoNorm, fonte) {
    if (!insp.mAdm) return '—';
    const papeis = [...new Set(insp.mAdm.itens
      .filter(i => i.fonte === fonte && U().normalizar(i.procedimento).includes(produtoNorm) && i.esperado != null)
      .map(i => PAPEL_ROTULO[i.papel] || i.papel))];
    return papeis.length ? papeis.join(' · ') : '—';
  }

  return { montar, inspecionar, gerarExtracao, detectarPauta, importarRelatorioMedico,
    resolverAdmissoesMedico, _st: st };
})();
