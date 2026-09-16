/**
 * ATLAS — Visão Geral Executiva · CAMADA DE DADOS
 * ------------------------------------------------------------------
 * Fontes (confirmadas com a controladoria):
 *  • PRODUÇÃO  = SUM(linhas_producao.valor), filtrada por DATA DE ADMISSÃO.
 *  • REPASSE   = consolidado do módulo Relatórios (AtlasAuditoria.matrizDaCompetencia
 *                + fichários Laudos/Períodos/Fellow), filtrado por DATA DE PAGAMENTO.
 *  • GLOSA     = linhas de CONVÊNIO/SUS com recebido<=0, SÓ papel executante
 *                (MEDICO/CIRURGIAO). Perda estimada = regra da Base Tabela
 *                sobre o produzido (mesmo motor de cálculo já existente).
 * Comparativos: LY = mesmo mês do ano anterior · LM = mês imediatamente anterior.
 * Escopo: a unidade desta instalação (uma ferramenta por unidade).
 */
window.VGExec = (function () {
  const Banco = window.Banco;

  // ── helpers de competência ────────────────────────────────────────────
  function somaMes(comp, n) {
    if (!comp) return null;
    const [a, m] = comp.split('-').map(Number);
    const d = new Date(Date.UTC(a, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const mesAnterior = (c) => somaMes(c, -1);
  const anoAnterior = (c) => somaMes(c, -12);

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  }

  // V922: filtros multi \u2014 string OU array viram Set (null = sem filtro).
  // 'TODOS' e vazio n\u00e3o contam como sele\u00e7\u00e3o (sentinelas do "sem filtro").
  function _fmSet(v, comNorm) {
    const FM = window.Utilidades && Utilidades.filtroMulti;
    const arr = (FM ? FM.sel(v) : (v ? [String(v)] : []))
      .filter(x => x !== '' && x !== 'TODOS');
    if (!arr.length) return null;
    return new Set(arr.map(x => (comNorm ? norm(x) : String(x))));
  }
  function _fmChave(set) { return set ? [...set].sort().join('\u00a7') : ''; }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // V589: CACHE PERSISTENTE dos pain\u00e9is ("foto dos c\u00e1lculos")
  // Os resultados pesados (consolidado do m\u00eas, perda de glosa via motor,
  // desempenho por m\u00e9dico) s\u00e3o gravados no PR\u00d3PRIO banco com um fingerprint
  // barato dos dados de origem. Ao reabrir a ferramenta, se nada mudou, os
  // pain\u00e9is pintam direto da foto \u2014 sem rodar auditoria nem motor. Qualquer
  // importa\u00e7\u00e3o/edi\u00e7\u00e3o muda o fingerprint e a foto se refaz sozinha.
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  let _pcOk = false;
  function _pcGarantir() {
    if (_pcOk) return true;
    if (!Banco || !Banco.db) return false;
    try {
      Banco.db.exec(`CREATE TABLE IF NOT EXISTS vg_calc_cache (
        chave TEXT PRIMARY KEY, fingerprint TEXT, payload TEXT,
        atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);
      _pcOk = true; return true;
    } catch (e) { console.warn('[VGExec] cache persistente:', e); return false; }
  }
  const _pcFpMem = {};   // `${comp}|${Banco._versao}` \u2192 fingerprint (memo da sess\u00e3o)
  // V591: a parte GLOBAL (regras/cadastros) \u00e9 a mesma para qualquer m\u00eas \u2014
  // memoizada por vers\u00e3o do banco, n\u00e3o recalcula a cada compet\u00eancia olhada
  // (o comparativo/evolu\u00e7\u00e3o fotografam ~12-18 meses por abertura).
  let _pcFpGlobal = { v: -1, s: '' };
  function _pcFingerprint(comp) {
    const v = (Banco._versao || 0);
    const memoK = comp + '|' + v;
    if (_pcFpMem[memoK]) return _pcFpMem[memoK];
    const partes = [];
    const q1 = (sql, params) => {
      try { const r = Banco.queryUnica(sql, params || []); return r ? Object.values(r).join(',') : ''; }
      catch (_) { return ''; }
    };
    // fontes do m\u00eas
    partes.push(q1(`SELECT COUNT(*), COALESCE(SUM(produzido),0), COALESCE(SUM(recebido),0) FROM linhas_qvis WHERE mes_pagamento = ?`, [comp]));
    partes.push(q1(`SELECT COUNT(*), COALESCE(SUM(valor),0) FROM linhas_producao WHERE competencia = ?`, [comp]));
    partes.push(q1(`SELECT COALESCE(MAX(atualizado_em),''), COUNT(*) FROM repasse_snapshot WHERE competencia = ?`, [comp]));
    partes.push(q1(`SELECT COUNT(*), COALESCE(SUM(valor_repasse),0) FROM laudos WHERE competencia = ?`, [comp]));
    partes.push(q1(`SELECT COUNT(*), COALESCE(SUM(total_valor),0) FROM periodos_linhas WHERE mes_ref = ?`, [comp]));
    // V623: recálculo do fracionamento muda valor_repasse sem mexer em mais nada — precisa invalidar a foto
    partes.push(q1(`SELECT COUNT(*), COALESCE(SUM(valor_repasse),0), COALESCE(SUM(valor_repasse_manual),0) FROM fracionamento_aplicacoes WHERE mes_ref = ?`, [comp]));
    partes.push(q1(`SELECT COUNT(*), COALESCE(SUM(total_repassar),0) FROM fellow_linhas WHERE mes_ref = ?`, [comp]));
    partes.push(q1(`SELECT COUNT(*) FROM marcacoes_estrabismo WHERE competencia = ?`, [comp]));
    partes.push(q1(`SELECT COUNT(*), COALESCE(SUM(valor_total),0) FROM lancamentos_externos WHERE competencia_id IN (SELECT id FROM competencias WHERE printf('%04d-%02d', ano, mes) = ?)`, [comp]));
    partes.push(q1(`SELECT COALESCE(MAX(congelado_em),''), COUNT(*) FROM pm_contabil_snap WHERE competencia = ?`, [comp]));   // V591: congelamento da Prod. M\u00e9dica
    partes.push(q1(`SELECT COUNT(*) FROM repasse_pagos WHERE competencia < ?`, [comp]));
    // regras e cadastros que afetam o motor/consolidado (globais, memo por vers\u00e3o)
    if (_pcFpGlobal.v !== v) {
      const g = [];
      g.push(q1(`SELECT COUNT(*), COALESCE(MAX(atualizado_em),'') FROM tabela_repasse`));
      g.push(q1(`SELECT COUNT(*), COALESCE(MAX(data_vigencia),''), COALESCE(MAX(id),0) FROM tabela_versoes`));
      g.push(q1(`SELECT COUNT(*) FROM tabela_repasse_hist`));
      g.push(q1(`SELECT COUNT(*), COALESCE(MAX(atualizado_em),'') FROM tabela_repasse_excecao`));
      g.push(q1(`SELECT COUNT(*), COALESCE(MAX(atualizado_em),'') FROM medicos`));
      g.push(q1(`SELECT COUNT(*) FROM sinonimos_medico`));
      g.push(q1(`SELECT COUNT(*) FROM sinonimos_proc`));
      g.push(q1(`SELECT COUNT(*), COALESCE(MAX(atualizado_em),'') FROM procedimentos`));
      g.push(q1(`SELECT COUNT(*) FROM mapeamento_papeis`));
      g.push(q1(`SELECT COUNT(*) FROM pacote_convenio`) + '/' + q1(`SELECT COUNT(*) FROM pacote_procedimento`) + '/' + q1(`SELECT COUNT(*) FROM pacote_alias`));
      g.push(q1(`SELECT COUNT(*) FROM perfil_regra`) + '/' + q1(`SELECT COUNT(*) FROM perfil_regra_proc`));
      g.push(q1(`SELECT COALESCE(valor,'') FROM config_calcular WHERE chave = 'TIPOS_HABILITADOS'`));
      g.push(q1(`SELECT COUNT(*), COALESCE(SUM(incluir),0) FROM calcular_medico_override`));
      g.push(q1(`SELECT COUNT(*), COALESCE(SUM(valor_mensal),0) FROM valores_cargos`));
      g.push(q1(`SELECT COUNT(*) FROM excecoes_cargo`));
      g.push(q1(`SELECT COALESCE(MAX(atualizado_em),'') FROM config_lentes_contato`));
      g.push(q1(`SELECT COALESCE(MAX(atualizado_em),'') FROM config_estrabismo`) + '/' + q1(`SELECT COALESCE(MAX(atualizado_em),'') FROM config_luz_pulsada`) + '/' + q1(`SELECT COALESCE(MAX(atualizado_em),'') FROM config_crosslink`) + '/' + q1(`SELECT COALESCE(MAX(atualizado_em),'') FROM config_refractive_laser`));
      _pcFpGlobal = { v, s: g.join(';') };
    }
    partes.push(_pcFpGlobal.s);
    // V633: SALT de versão do MOTOR — correções de cálculo (ex.: V627-V631)
    // mudam o resultado SEM mudar dado nenhum; sem o salt, as fotos antigas
    // continuavam "válidas" e a Visão Geral divergia dos Relatórios.
    // V651: a paridade da Produção Médica (versões/exceções/pacotes/perfis/
    // duplicidade no Contábil) muda os números com os MESMOS dados — o salt
    // invalida as fotos antigas dos painéis (meses consolidados ficam como estão)
    partes.push('motor=V713');   // V682: SUS pago pela tabela SUS; V685: SUS na consolidação contábil
    const fp = partes.join(';');
    _pcFpMem[memoK] = fp;
    return fp;
  }
  function _pcLer(nome, comp) {
    if (!_pcGarantir()) return null;
    try {
      const row = Banco.queryUnica(`SELECT fingerprint, payload, atualizado_em FROM vg_calc_cache WHERE chave = ?`, [`${nome}|${comp}`]);
      if (!row || !row.payload) return null;
      if (row.fingerprint !== _pcFingerprint(comp)) {
        // V619: m\u00eas CONSOLIDADO \u00e9 congelado \u2014 a foto continua valendo mesmo
        // com regras/cadastros alterados depois (n\u00e3o recalcula o passado)
        const AC = window.AtlasConsolidacao;
        if (!(AC && AC.estaConsolidado && AC.estaConsolidado(comp))) return null;   // dados mudaram \u2192 foto velha
        // V633: mas a foto do PAINEL n\u00e3o pode ser mais antiga que a FOTO OFICIAL
        // da consolida\u00e7\u00e3o \u2014 sen\u00e3o a Vis\u00e3o Geral mostra um total defasado ante os
        // Relat\u00f3rios. Foto anterior ao congelamento \u2192 refaz (a partir da oficial).
        if (AC.fotoCongeladaEm) {
          const tCons = AC.fotoCongeladaEm(comp);
          if (tCons && String(row.atualizado_em || '') < String(tCons)) return null;
        }
      }
      return JSON.parse(row.payload);
    } catch (_) { return null; }
  }
  function _pcGravar(nome, comp, obj) {
    if (!_pcGarantir()) return;
    try {
      // V619: mês CONSOLIDADO já tem foto congelada → não sobrescreve
      // V633: exceto se a foto existente for ANTERIOR ao congelamento oficial
      // (defasada) — aí a regravação alinha o painel à foto da consolidação
      const AC = window.AtlasConsolidacao;
      if (AC && AC.estaConsolidado && AC.estaConsolidado(comp)) {
        const ja = Banco.queryUnica(`SELECT atualizado_em FROM vg_calc_cache WHERE chave = ?`, [`${nome}|${comp}`]);
        if (ja) {
          const tCons = AC.fotoCongeladaEm ? AC.fotoCongeladaEm(comp) : null;
          if (!tCons || String(ja.atualizado_em || '') >= String(tCons)) return;
        }
      }
      Banco.executar(`INSERT OR REPLACE INTO vg_calc_cache (chave, fingerprint, payload, atualizado_em)
                      VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [`${nome}|${comp}`, _pcFingerprint(comp), JSON.stringify(obj)]);
      // V591: persiste SEM carimbar nova versão do banco. O salvarDebounced()
      // usado na V589 incrementava Banco._versao a cada foto e invalidava os
      // memos do motor (matriz/consolidado) no meio do carregamento — o
      // dashboard re-rodava o cálculo pesado várias vezes (minutos de espera).
      if (Banco.persistirCacheDebounced) Banco.persistirCacheDebounced();
      else if (Banco.salvarDebounced) Banco.salvarDebounced();
    } catch (e) { console.warn('[VGExec] gravar foto:', e); }
  }

  // ── médicos elegíveis: SÓ os que aparecem no CONSOLIDADO do Relatórios ──
  // (universo real de quem teve movimento; reusa AtlasRelatorios.nomesConsolidado,
  //  que já aplica interno/híbrido + taxas + consulta-produção + avulsos + de-para)
  const _cacheElegiveis = {};   // comp → { set: Set<norm>, nomes: Map<norm, original> }
  function garantirRelatorios() {
    // a função é registrada na carga do relatorios.js (IIFE), então já existe —
    // NÃO precisa renderizar a tela inteira (isso causava a tela branca).
    return !!(window.AtlasRelatorios && typeof window.AtlasRelatorios.linhasConsolidadoComp === 'function');
  }
  function elegiveisDe(comp) {
    if (_cacheElegiveis[comp]) return _cacheElegiveis[comp];
    // V589: foto persistente — evita rodar o consolidado só pra listar médicos
    const foto = _pcLer('elegiveis', comp);
    if (foto) {
      _cacheElegiveis[comp] = { set: new Set(foto.map(par => par[0])), nomes: new Map(foto) };
      return _cacheElegiveis[comp];
    }
    const set = new Set(); const nomes = new Map();
    // deriva direto das linhas do consolidado (mesma fonte do repasse — sem recoletar)
    try {
      consolidadoLinhas(comp).forEach(l => {
        const nome = (l && l.profissional) ? String(l.profissional).trim() : '';
        if (nome && nome !== '—') { const n = norm(nome); set.add(n); if (!nomes.has(n)) nomes.set(n, nome); }
      });
    } catch (e) { console.error('[VGExec] elegiveisDe:', e); }
    _cacheElegiveis[comp] = { set, nomes };
    _pcGravar('elegiveis', comp, [...nomes.entries()]);   // V589
    return _cacheElegiveis[comp];
  }
  function setElegiveis(comp) { return elegiveisDe(comp).set; }
  // elegibilidade depende da competência em foco (universo do mês)
  let _compElegivel = null;
  function medicoElegivel(nome) {
    if (!_compElegivel) return true;            // sem competência em foco → não filtra
    return setElegiveis(_compElegivel).has(norm(nome));
  }

  // ── de-para de nomes: qualquer grafia → nome oficial (medicos + sinonimos) ──
  let _deParaMap = null;   // Map<norm(grafia), nome_oficial>
  function carregarDePara() {
    if (_deParaMap) return _deParaMap;
    const m = new Map();
    const porId = new Map();
    try {
      (Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM medicos`) || []).forEach(x => {
        const no = x.nome_oficial || '';
        if (!no) return;
        m.set(norm(no), no);
        if (x.nome_normalizado) m.set(norm(x.nome_normalizado), no);
        porId.set(x.id, no);
      });
      (Banco.query(`SELECT grafia, grafia_normalizada, medico_id FROM sinonimos_medico`) || []).forEach(s => {
        const no = porId.get(s.medico_id);
        if (!no) return;
        if (s.grafia) m.set(norm(s.grafia), no);
        if (s.grafia_normalizada) m.set(norm(s.grafia_normalizada), no);
      });
    } catch (e) { console.error('[VGExec] de-para:', e); }
    _deParaMap = m;
    return m;
  }
  // resolve uma grafia para o nome oficial (ou devolve a própria se não houver)
  function resolverNome(nome) {
    if (!nome) return '';
    return carregarDePara().get(norm(nome)) || nome;
  }

  // ── competências disponíveis (QVIS mês de pagamento + fichários de Desempenho) ──
  // V281: o dashboard é por MÊS DE PAGAMENTO. Removidas a Produção histórica
  // (linhas_producao) e a competência de ADMISSÃO do QVIS — a lista de períodos
  // passa a refletir só o QVIS pago + os fichários de Desempenho.
  function competenciasDisponiveis() {
    const set = new Set();
    const puxa = (sql, col) => {
      try { (Banco.query(sql) || []).forEach(r => { if (r[col]) set.add(r[col]); }); } catch (_) {}
    };
    puxa(`SELECT DISTINCT mes_pagamento AS c FROM linhas_qvis WHERE mes_pagamento IS NOT NULL`, 'c');
    puxa(`SELECT DISTINCT competencia AS c FROM laudos`, 'c');
    puxa(`SELECT DISTINCT mes_ref AS c FROM periodos_linhas`, 'c');
    puxa(`SELECT DISTINCT mes_ref AS c FROM fellow_linhas`, 'c');
    return [...set].filter(Boolean).sort().reverse();
  }

  // V521: lista de convênios do mês (QVIS + Produção) — filtro global do dashboard
  function conveniosLista(comp) {
    const set = new Set();
    try { (Banco.query(`SELECT DISTINCT convenio AS c FROM linhas_qvis WHERE mes_pagamento = ? AND convenio IS NOT NULL AND TRIM(convenio) <> ''`, [comp]) || []).forEach(r => set.add(String(r.c).trim())); } catch (_) {}
    try { (Banco.query(`SELECT DISTINCT convenio AS c FROM linhas_producao WHERE competencia = ? AND convenio IS NOT NULL AND TRIM(convenio) <> ''`, [comp]) || []).forEach(r => set.add(String(r.c).trim())); } catch (_) {}
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  function competenciaAtual() {
    const cs = competenciasDisponiveis();
    return cs.length ? cs[0] : null;
  }

  // ── lista de médicos (pro filtro) ─────────────────────────────────────
  function medicosLista(comp) {
    const alvo = comp || competenciaAtual();
    if (!alvo) return [];
    const { nomes } = elegiveisDe(alvo);
    return [...nomes.values()].sort().map((nome, i) => ({ id: i, nome }));
  }

  // ════════════════════════════════════════════════════════════════════
  // PRODUÇÃO — por data de admissão
  // ════════════════════════════════════════════════════════════════════
  // PRODUÇÃO: total exato do relatório de produção do mês. Só médico + mês a
  // afetam (ignora módulo). Filtro de médico resolve o de-para de nomes sobre
  // as colunas médico/cirurgião da base de produção.
  function producaoTotal(comp, filtros) {
    if (!comp) return 0;
    const alvoMed = _fmSet(filtros && filtros.medicoNome, true);   // V922: multi
    try {
      const rows = Banco.query(`SELECT valor, medico, cirurgiao, convenio FROM linhas_producao WHERE competencia = ?`, [comp]) || [];
      const alvoConv = _fmSet(filtros && filtros.convenio, true);   // V521/V922
      let total = 0;
      for (const r of rows) {
        if (alvoConv && !alvoConv.has(norm(r.convenio))) continue;   // V521
        if (alvoMed) {
          const med = norm(resolverNome(r.medico)), cir = norm(resolverNome(r.cirurgiao));
          if (!alvoMed.has(med) && !alvoMed.has(cir)) continue;
        }
        total += Number(r.valor) || 0;
      }
      return total;
    } catch (_) { return 0; }
  }

  // quebra por tipo de recebimento (Conv/Part/SUS) — drill-down do médico
  function producaoPorTipo(comp, filtros) {
    const out = { CONVENIO: 0, PARTICULAR: 0, SUS: 0 };
    if (!comp) return out;
    const alvoMed = _fmSet(filtros && filtros.medicoNome, true);   // V922: multi
    try {
      const rows = Banco.query(`SELECT UPPER(COALESCE(tipo_recebimento,'')) AS t, valor, medico, cirurgiao
                                  FROM linhas_producao WHERE competencia = ?`, [comp]) || [];
      for (const r of rows) {
        if (alvoMed) {
          const med = norm(resolverNome(r.medico)), cir = norm(resolverNome(r.cirurgiao));
          if (!alvoMed.has(med) && !alvoMed.has(cir)) continue;
        }
        const v = Number(r.valor) || 0;
        const t = String(r.t || '');
        if (t.indexOf('PARTIC') >= 0) out.PARTICULAR += v;
        else if (t === 'SUS') out.SUS += v;
        else out.CONVENIO += v;
      }
    } catch (_) {}
    return out;
  }

  // ════════════════════════════════════════════════════════════════════
  // PRODUÇÃO QVIS — soma do PRODUZIDO dos relatórios QVIS (Conv + Part),
  // por MÊS DE PAGAMENTO (mesma base do Calcular Repasse), DESCARTANDO as
  // duplicadas por papel: o QVIS repete a mesma (admissão+procedimento) uma
  // vez por papel com o MESMO produzido. Aqui contamos o produzido UMA vez
  // por procedimento (origem+admissão+procedimento).
  // Filtro de médico (quando houver) atribui a produção ao EXECUTANTE.
  // V534: PERF — o agrupamento/dedup do QVIS (parte cara) NÃO depende do filtro
  // médico/convênio; só a soma final depende. Cacheia os grupos por comp|versão
  // (invalida sozinho a cada importação/gravação) e aplica o filtro por cima —
  // barato. Antes, cada troca de filtro re-escaneava e re-deduplicava 25k+ linhas
  // (× 3 no renderCards: comp/LM/LY).
  const _cacheQvisGrupos = {};   // comp|versao → [{origem, produzido, convenio, execNomeNorm}]
  function qvisGrupos(comp) {
    const chave = comp + '|' + (Banco._versao || 0);
    if (_cacheQvisGrupos[chave]) return _cacheQvisGrupos[chave];
    if (Object.keys(_cacheQvisGrupos).length > 24) {
      for (const k in _cacheQvisGrupos) delete _cacheQvisGrupos[k];   // higiene
    }
    let arr = [];
    try {
      const rows = Banco.query(
        `SELECT UPPER(TRIM(COALESCE(origem,''))) AS origem, admissao,
                procedimento_normalizado AS proc, papel, produzido,
                nome_profissional AS nome, convenio
           FROM linhas_qvis WHERE mes_pagamento = ?`, [comp]) || [];
      // dedup: 1 produção por (origem + admissão + procedimento)
      const grupos = new Map();
      for (const r of rows) {
        const key = `${r.origem}|${r.admissao}|${r.proc}`;
        let g = grupos.get(key);
        if (!g) { g = { origem: r.origem, produzido: 0, execNome: null, convenio: r.convenio }; grupos.set(key, g); }
        const v = Number(r.produzido) || 0;
        if (v > g.produzido) g.produzido = v;   // papel-duplicadas têm o mesmo valor → conta 1×
        if (!g.execNome && ehExecutante(r.papel)) g.execNome = r.nome;
      }
      arr = [];
      for (const g of grupos.values()) {
        const execResolvido = g.execNome ? resolverNome(g.execNome) : null;   // V546
        arr.push({
          origem: g.origem, produzido: g.produzido, convenio: g.convenio,
          convNorm: norm(g.convenio),
          execNome: execResolvido,                                   // V546: nome exibível
          execNomeNorm: execResolvido ? norm(execResolvido) : null,
        });
      }
      _cacheQvisGrupos[chave] = arr;
    } catch (e) { console.error('[VGExec] qvisGrupos:', e); }
    return arr;
  }
  function qvisProducao(comp, filtros) {
    const out = { CONVENIO: 0, PARTICULAR: 0, SUS: 0, total: 0 };
    if (!comp) return out;
    const alvoMed = _fmSet(filtros && filtros.medicoNome, true);   // V922: multi
    const alvoConv = _fmSet(filtros && filtros.convenio, true);   // V521/V922
    for (const g of qvisGrupos(comp)) {
      if (alvoConv && !alvoConv.has(g.convNorm)) continue;   // V521
      if (alvoMed && !alvoMed.has(g.execNomeNorm)) continue;
      const v = g.produzido;
      if (g.origem === 'PARTICULAR')   out.PARTICULAR += v;
      else if (g.origem === 'SUS')     out.SUS += v;
      else                             out.CONVENIO += v;  // CONVENIO (e qualquer outra origem)
    }
    out.total = out.CONVENIO + out.PARTICULAR + out.SUS;
    return out;
  }

  // V545/V546: as 3 medidas POR MÉDICO da ilha "Performance médica":
  //   • produzido — MESMA regra do card PRODUÇÃO TOTAL (qvisGrupos: dedup por
  //     origem+admissão+procedimento, atribuído ao EXECUTANTE; Conv+Part+SUS)
  //   • glosa     — MESMA regra do card de GLOSA (executante, recebido<=0, ≠ PARTICULAR)
  //   • repasse   — só do módulo "Calcular Repasse" (consolidado SEM Desempenho)
  // Retorna Map<nomeResolvido, {nome, produzido, glosa, repasse}>.
  function desempenhoMedicos(comp, filtros) {
    const out = new Map();
    if (!comp) return out;
    const filtroConv = _fmSet(filtros && filtros.convenio, true);   // V922: multi
    if (!filtroConv) {   // V589: foto persistente
      const foto = _pcLer('desempMed', comp);
      if (foto) { for (const o of foto) out.set(o.nome, o); return out; }
    }
    const pega = (nome) => {
      let o = out.get(nome);
      if (!o) { o = { nome, produzido: 0, glosa: 0, repasse: 0 }; out.set(nome, o); }
      return o;
    };

    // 1) PRODUZIDO — igual ao card PRODUÇÃO TOTAL (grupos deduplicados)
    for (const g of qvisGrupos(comp)) {
      if (filtroConv && !filtroConv.has(g.convNorm)) continue;
      if (!g.execNome) continue;                 // sem executante identificado
      pega(g.execNome).produzido += g.produzido;
    }

    // 2) GLOSA — igual ao card de glosa (linhas executante com recebido<=0)
    try {
      const rows = Banco.query(
        `SELECT produzido, nome_profissional AS nome, convenio
           FROM linhas_qvis
          WHERE mes_pagamento = ?
            AND COALESCE(recebido,0) <= 0
            AND UPPER(TRIM(COALESCE(origem,''))) <> 'PARTICULAR'
            AND UPPER(TRIM(COALESCE(papel,''))) IN (
                  SELECT UPPER(TRIM(papel_qvis)) FROM mapeamento_papeis
                   WHERE papel_id = (SELECT id FROM papeis WHERE nome = 'Executante'))`, [comp]) || [];
      for (const r of rows) {
        if (filtroConv && !filtroConv.has(norm(r.convenio))) continue;
        pega(resolverNome(r.nome)).glosa += Number(r.produzido) || 0;
      }
    } catch (e) { console.error('[VGExec] desempenhoMedicos glosa:', e); }

    // 3) REPASSE — consolidado SEM as linhas de Desempenho (só Calcular Repasse)
    try {
      for (const l of consolidadoLinhas(comp)) {
        const v = Number(l.valor) || 0;
        if (!v) continue;   // V634: negativos (descontos) entram
        if (norm(l.status) === 'DESEMPENHO') continue;   // exclui fichários de desempenho
        if (filtroConv && !filtroConv.has(norm(l.convenio))) continue;
        pega(resolverNome(l.profissional || '—')).repasse += v;
      }
    } catch (e) { console.error('[VGExec] desempenhoMedicos repasse:', e); }

    if (!filtroConv) _pcGravar('desempMed', comp, [...out.values()]);   // V589
    return out;
  }

  // V574: DESEMPENHO × REPASSE por médico — gráfico abaixo dos Top 10.
  // Mesma fonte do consolidado; a fatia de cada linha segue a regra existente:
  // status DESEMPENHO = fichários; o resto = Calcular Repasse.
  // Retorna Map<nomeResolvido, {nome, desempenho, repasse}> (só valores > 0).
  function desempRepasseMedicos(comp, filtros) {
    const out = new Map();
    if (!comp) return out;
    const filtroConv = _fmSet(filtros && filtros.convenio, true);   // V922: multi
    if (!filtroConv) {   // V589: foto persistente
      const foto = _pcLer('desempRep', comp);
      if (foto) { for (const o of foto) out.set(o.nome, o); return out; }
    }
    try {
      for (const l of consolidadoLinhas(comp)) {
        const v = Number(l.valor) || 0;
        if (!v) continue;   // V634: negativos (descontos) entram
        if (filtroConv && !filtroConv.has(norm(l.convenio))) continue;
        const nome = resolverNome(l.profissional || '—');
        let o = out.get(nome);
        if (!o) { o = { nome, desempenho: 0, repasse: 0 }; out.set(nome, o); }
        if (norm(l.status) === 'DESEMPENHO') o.desempenho += v; else o.repasse += v;
      }
    } catch (e) { console.error('[VGExec] desempRepasseMedicos:', e); }
    if (!filtroConv) _pcGravar('desempRep', comp, [...out.values()]);   // V589
    return out;
  }

  /**
   * ══ V931: TABELA POR CATEGORIA — a partir do QVIS do mês ═════════════════
   *
   * Desenho do usuário: "identificar a admissão no relatório QVIS, buscar na
   * produção a categoria que ela pertence e construir uma pequena tabela:
   * Categoria | Produzido (QVIS) | Recebido (QVIS) | Glosa | Repasse".
   * (V931b: é a CATEGORIA da produção — Cirurgias/Exames/Consultas/Laser… —
   * não a subespecialidade.)
   *
   *  · base = QVIS do MÊS DE PAGAMENTO (o que o convênio pagou), deduplicado
   *    por origem+admissão+procedimento (as linhas por papel repetem os valores);
   *  · categoria = coluna CATEGORIA das linhas de PRODUÇÃO da admissão. Com
   *    mais de uma categoria na admissão, vale a linha cujo PRODUTO (ou
   *    procedimento principal) casa com o procedimento do QVIS; sem match, a
   *    mais frequente. Admissão sem produção → "Sem categoria na produção";
   *  · glosa = o MESMO número do card GLOSAS, distribuído por categoria (V953):
   *    executante, sem Particular, régua 100% ou FATO conforme a chave do card
   *    (filtros.glosaVisao; padrão FATO). O total da coluna bate com o card;
   *  · repasse = Consolidado do mês, só das admissões que estão no QVIS;
   *  · respeita os filtros globais (médico = executante da linha; convênio).
   */
  // V933: a MESMA chave de admissão dos dois lados — só os dígitos, sem zeros
  // à esquerda e sem o ".0" que o Excel costuma pendurar (QVIS "12345678" e
  // produção "12345678.0"/"012345678" são a mesma admissão)
  const _admChave = (x) => {
    const s = String(x == null ? '' : x).trim().replace(/\.0+$/, '');
    const d = s.replace(/\D/g, '').replace(/^0+/, '');
    return d || s.toUpperCase().replace(/\s/g, '');
  };
  let _catProdCache = { v: -1, mapa: null };
  function _mapaCategorias() {
    const v = Banco._versao || 0;
    if (_catProdCache.v === v && _catProdCache.mapa) return _catProdCache.mapa;
    const m = new Map();
    try {
      for (const r of Banco.query(
        `SELECT cod_admissao, produto, procedimento_principal, categoria, subcategoria FROM linhas_producao
          WHERE categoria IS NOT NULL AND TRIM(categoria) <> ''`) || []) {
        const k = _admChave(r.cod_admissao);
        if (!k) continue;
        let ent = m.get(k);
        if (!ent) { ent = { cats: new Set(), itens: [] }; m.set(k, ent); }
        const cat = String(r.categoria).trim();
        const sub = String(r.subcategoria == null ? '' : r.subcategoria).trim() || SEM_SUBCATEGORIA;   // V934
        ent.cats.add(cat);
        ent.itens.push({ prod: norm(r.produto), procPrinc: norm(r.procedimento_principal), cat, sub });
      }
    } catch (e) { console.error('[VGExec] _mapaCategorias:', e); }
    _catProdCache = { v, mapa: m };
    return m;
  }
  const SEM_CATEGORIA = 'Sem categoria na produção';
  const SEM_SUBCATEGORIA = 'Sem subcategoria';   // V934
  // V934: devolve { cat, sub } — a subcategoria é a da MESMA linha de produção
  // que decidiu a categoria (produto casado com o procedimento do QVIS; senão,
  // a combinação categoria+subcategoria mais frequente na admissão).
  function classificacaoDaAdmissao(admissao, procedimento) {
    const ent = _mapaCategorias().get(_admChave(admissao));
    if (!ent) return { cat: SEM_CATEGORIA, sub: '' };
    const alvo = norm(procedimento);
    if (alvo) {
      const exato = ent.itens.find(i => i.prod === alvo || i.procPrinc === alvo);
      if (exato) return { cat: exato.cat, sub: exato.sub };
      const contem = ent.itens.find(i => (i.prod && (alvo.includes(i.prod) || i.prod.includes(alvo)))
        || (i.procPrinc && (alvo.includes(i.procPrinc) || i.procPrinc.includes(alvo))));
      if (contem) return { cat: contem.cat, sub: contem.sub };
    }
    // categoria mais frequente; dentro dela, a subcategoria mais frequente
    const cont = new Map();
    for (const i of ent.itens) cont.set(i.cat, (cont.get(i.cat) || 0) + 1);
    const cat = ent.cats.size === 1 ? [...ent.cats][0] : [...cont.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const contSub = new Map();
    for (const i of ent.itens) if (i.cat === cat) contSub.set(i.sub, (contSub.get(i.sub) || 0) + 1);
    const sub = contSub.size ? [...contSub.entries()].sort((a, b) => b[1] - a[1])[0][0] : SEM_SUBCATEGORIA;
    return { cat, sub };
  }
  function categoriaDaAdmissao(admissao, procedimento) {
    return classificacaoDaAdmissao(admissao, procedimento).cat;
  }
  // V955: linhas do motor da perda por competência (cache por comp|versão — a
  // passagem do motor custa ~400ms e a matriz por categoria a reaproveita)
  const _cachePerdaLinhas = {};
  function _perdaLinhas(comp) {
    if (!garantirMotorGlosa() || typeof window.__atlasCalcularPerdaGlosa !== 'function') return null;
    const chave = comp + '|' + (Banco._versao || 0);
    if (!_cachePerdaLinhas[chave]) {
      for (const k of Object.keys(_cachePerdaLinhas)) delete _cachePerdaLinhas[k];   // só a versão atual
      _cachePerdaLinhas[chave] = window.__atlasCalcularPerdaGlosa(comp) || [];
    }
    return _cachePerdaLinhas[chave];
  }
  function categoriasQvis(comp, filtros) {
    const out = { linhas: [], total: { produzido: 0, recebido: 0, glosa: 0, repasse: 0, perdido: 0, nAdm: 0 } };
    if (!comp) return out;
    const alvoMed = _fmSet(filtros && filtros.medicoNome, true);
    const alvoConv = _fmSet(filtros && filtros.convenio, true);
    const api = window.AtlasRelatorios || {};
    // 1) QVIS deduplicado (mesma chave do qvisGrupos), com recebido
    const grupos = new Map();
    try {
      const rows = Banco.query(
        `SELECT UPPER(TRIM(COALESCE(origem,''))) AS origem, admissao, procedimento,
                procedimento_normalizado AS proc, papel, produzido, recebido,
                nome_profissional AS nome, convenio
           FROM linhas_qvis WHERE mes_pagamento = ?`, [comp]) || [];
      for (const r of rows) {
        const key = `${r.origem}|${r.admissao}|${r.proc}`;
        let g = grupos.get(key);
        if (!g) { g = { admissao: r.admissao, procedimento: r.procedimento, produzido: 0, recebido: 0, execNome: null, convNorm: norm(r.convenio) }; grupos.set(key, g); }
        const p = Number(r.produzido) || 0, rc = Number(r.recebido) || 0;
        if (p > g.produzido) g.produzido = p;
        if (rc > g.recebido) g.recebido = rc;
        if (!g.execNome && ehExecutante(r.papel)) g.execNome = r.nome;
      }
    } catch (e) { console.error('[VGExec] categoriasQvis:', e); return out; }
    const porCat = new Map();
    const novo = (nome) => ({ categoria: nome, produzido: 0, recebido: 0, glosa: 0, repasse: 0, adms: new Set() });
    // V934: cada categoria guarda as suas subcategorias (drilldown na tela)
    const pega = (cat, sub) => {
      let o = porCat.get(cat);
      if (!o) { o = novo(cat); o.subs = new Map(); porCat.set(cat, o); }
      if (sub == null) return o;
      let s = o.subs.get(sub);
      if (!s) { s = novo(sub); o.subs.set(sub, s); }
      return s;
    };
    // V953: a GLOSA não sai mais destes grupos (ver o passo 1b abaixo) — ela
    // usa o MESMO universo e a MESMA régua do card GLOSAS, para o total da
    // matriz bater com o card. (V952 somava produzido − recebido de TODO o
    // QVIS deduplicado, e as linhas Particular — recebido zerado no QVIS —
    // viravam uma glosa que o card não enxerga.)
    const soma = (o, produzido, recebido, k) => {
      o.produzido += produzido;
      o.recebido += recebido;
      o.adms.add(k);
    };
    const admsNoQvis = new Set();
    const catPorAdm = new Map();   // admissão → { cat, sub } (pra ligar o repasse)
    for (const g of grupos.values()) {
      if (alvoConv && !alvoConv.has(g.convNorm)) continue;
      if (alvoMed) {
        const execN = g.execNome ? norm(resolverNome(g.execNome)) : null;
        if (!execN || !alvoMed.has(execN)) continue;
      }
      const cls = classificacaoDaAdmissao(g.admissao, g.procedimento);
      const k = _admChave(g.admissao);
      soma(pega(cls.cat), g.produzido, g.recebido, k);
      if (cls.sub) soma(pega(cls.cat, cls.sub), g.produzido, g.recebido, k);
      admsNoQvis.add(k);
      if (!catPorAdm.has(k)) catPorAdm.set(k, cls);
    }
    // 1b) V953: GLOSA — exatamente como o card GLOSAS (glosaResumo): linhas do
    //     papel EXECUTANTE (de-para de papéis), origem ≠ PARTICULAR, mesmo mês
    //     de pagamento e mesmos filtros; régua conforme a chave do card:
    //       · 100%  → produzido das linhas com recebido zerado;
    //       · FATO  → produzido − recebido linha a linha (crédito abate).
    //     Cada valor cai na categoria/subcategoria da admissão (mesma
    //     classificação usada acima). Assim o TOTAL da coluna = o card.
    const regua = (filtros && filtros.glosaVisao === '100') ? '100' : 'FATO';
    out.regua = regua;
    try {
      const rowsG = Banco.query(
        `SELECT admissao, procedimento, produzido, recebido, nome_profissional AS nome, convenio
           FROM linhas_qvis
          WHERE mes_pagamento = ?
            AND UPPER(TRIM(COALESCE(origem,''))) <> 'PARTICULAR'
            AND UPPER(TRIM(COALESCE(papel,''))) IN (
                  SELECT UPPER(TRIM(papel_qvis)) FROM mapeamento_papeis
                   WHERE papel_id = (SELECT id FROM papeis WHERE nome = 'Executante'))`, [comp]) || [];
      for (const r of rowsG) {
        if (alvoConv && !alvoConv.has(norm(r.convenio))) continue;
        if (alvoMed && !alvoMed.has(norm(resolverNome(r.nome)))) continue;
        const produzido = Number(r.produzido) || 0, recebido = Number(r.recebido) || 0;
        let g = 0;
        if (regua === '100') { if (recebido <= 0) g = produzido; }
        else g = produzido - recebido;
        if (!g) continue;
        const cls = classificacaoDaAdmissao(r.admissao, r.procedimento);
        pega(cls.cat).glosa += g;
        if (cls.sub) pega(cls.cat, cls.sub).glosa += g;
      }
    } catch (e) { console.error('[VGExec] categoriasQvis glosa:', e); }
    // 2) repasse do Consolidado, só das admissões do QVIS (mesmo recorte)
    try {
      const linhas = (typeof api.linhasConsolidadoComp === 'function') ? (api.linhasConsolidadoComp(comp) || []) : [];
      for (const l of linhas) {
        const v = Number(l.valor) || 0;
        if (!v) continue;
        const k = _admChave(l.admissao);
        if (!k || !admsNoQvis.has(k)) continue;
        if (alvoMed && !alvoMed.has(norm(resolverNome(l.profissional || '')))) continue;
        if (alvoConv && !alvoConv.has(norm(l.convenio))) continue;
        const cls = catPorAdm.get(k) || classificacaoDaAdmissao(l.admissao, l.descricao);
        pega(cls.cat).repasse += v;
        if (cls.sub) pega(cls.cat, cls.sub).repasse += v;
      }
    } catch (e) { console.error('[VGExec] categoriasQvis repasse:', e); }
    // 2b) V955: REPASSE GLOSADO por categoria — só quando a tela pede
    //     (filtros.perda). MESMA lógica do "REPASSE TOTAL GLOSADO" do card: as
    //     linhas com recebido zerado (Convênio/SUS) passam pelo motor completo
    //     do Calcular e soma-se o repasse que cada papel teria (só 'casou',
    //     só valores > 0), com os mesmos filtros; cada valor cai na
    //     categoria/subcategoria da admissão. O total = o card.
    out.perdaCalculada = false;
    if (filtros && filtros.perda) {
      try {
        const linhasPerda = _perdaLinhas(comp);
        if (linhasPerda) {
          for (const l of linhasPerda) {
            const v = Number(l.repassePerdido) || 0;
            if (v <= 0) continue;
            if (alvoConv && !alvoConv.has(norm(l.convenio))) continue;
            if (alvoMed && !alvoMed.has(norm(resolverNome(l.nome)))) continue;
            const cls = classificacaoDaAdmissao(l.admissao, l.procedimento);
            pega(cls.cat).perdido = (pega(cls.cat).perdido || 0) + v;
            if (cls.sub) pega(cls.cat, cls.sub).perdido = (pega(cls.cat, cls.sub).perdido || 0) + v;
          }
          out.perdaCalculada = true;
        }
      } catch (e) { console.error('[VGExec] categoriasQvis perda:', e); }
    }
    const r2 = (x) => Math.round(x * 100) / 100;
    const ordena = (a, b) => b.produzido - a.produzido || a.categoria.localeCompare(b.categoria, 'pt-BR');
    const plana = (o) => ({ categoria: o.categoria, produzido: r2(o.produzido), recebido: r2(o.recebido),
                            glosa: r2(o.glosa), repasse: r2(o.repasse), perdido: r2(o.perdido || 0), nAdm: o.adms.size });
    out.linhas = [...porCat.values()]
      .map(o => Object.assign(plana(o), {
        // V934: subcategorias da categoria (drilldown), mesmas colunas
        subs: [...(o.subs || new Map()).values()].map(plana).sort(ordena)
          .map(s => ({ subcategoria: s.categoria, produzido: s.produzido, recebido: s.recebido, glosa: s.glosa, repasse: s.repasse, perdido: s.perdido, nAdm: s.nAdm })),
      }))
      .sort(ordena);
    out.total.perdido = 0;
    for (const l of out.linhas) {
      out.total.produzido += l.produzido; out.total.recebido += l.recebido;
      out.total.glosa += l.glosa; out.total.repasse += l.repasse; out.total.perdido += l.perdido;
    }
    out.total.nAdm = admsNoQvis.size;
    const semCat = porCat.get(SEM_CATEGORIA);
    out.semCategoria = semCat ? semCat.adms.size : 0;   // V933: diagnóstico na tela
    return out;
  }

  // categorias presentes na produção (pro filtro "Módulo Atlas")
  function categoriasProducao() {
    try {
      return (Banco.query(`SELECT DISTINCT categoria AS c FROM linhas_producao WHERE categoria IS NOT NULL AND categoria <> '' ORDER BY categoria`) || [])
        .map(r => r.c);
    } catch (_) { return []; }
  }

  // ════════════════════════════════════════════════════════════════════
  // REPASSE — fonte ÚNICA: as linhas do CONSOLIDADO do Relatórios (já trazem
  // módulo + profissional com nome completo + valor, e já passaram por todas as
  // regras). Filtra por médico e por MÓDULO (fichário) aqui mesmo.
  const _cacheRepasse = {};     // `${comp}|${med}|${mod}` → resultado

  // todas as linhas consolidadas da competência (cacheadas no Relatórios)
  function consolidadoLinhas(comp) {
    if (!comp) return [];
    try {
      if (garantirRelatorios() && typeof window.AtlasRelatorios.linhasConsolidadoComp === 'function') {
        return window.AtlasRelatorios.linhasConsolidadoComp(comp) || [];
      }
    } catch (e) { console.error('[VGExec] consolidadoLinhas:', e); }
    return [];
  }

  // módulos (fichários) presentes no consolidado de uma competência
  function modulosConsolidado(comp) {
    const foto = _pcLer('modulos', comp);   // V589
    if (foto) return foto;
    const set = new Set();
    consolidadoLinhas(comp).forEach(l => { if (l.modulo) set.add(l.modulo); });
    const out = [...set].sort();
    _pcGravar('modulos', comp, out);        // V589
    return out;
  }

  function repasseConsolidado(comp, filtros) {
    const res = {
      total: 0, porMedico: new Map(), porModulo: new Map(),
      // 4 fatias do repasse: Repasse direto do QVIS por origem + Desempenho (fichários)
      fatias: { CONVENIO: 0, PARTICULAR: 0, SUS: 0, DESEMPENHO: 0 },
    };
    if (!comp) return res;
    const filtroMed = _fmSet(filtros && filtros.medicoNome, true);   // V922: multi
    const filtroMod = _fmSet(filtros && filtros.modulo, false);
    const filtroConv = _fmSet(filtros && filtros.convenio, true);   // V521
    const chave = `${comp}|${_fmChave(filtroMed)}|${_fmChave(filtroMod)}|${_fmChave(filtroConv)}`;
    if (_cacheRepasse[chave]) return _cacheRepasse[chave];
    // V589: sem filtros, tenta a foto persistente (não roda o consolidado)
    const semFiltroRep = !filtroMed && !filtroMod && !filtroConv;
    if (semFiltroRep) {
      const foto = _pcLer('repasseMes', comp);
      if (foto) {
        const hidr = { total: foto.total, fatias: foto.fatias,
                       porMedico: new Map(foto.porMedico), porModulo: new Map(foto.porModulo) };
        _cacheRepasse[chave] = hidr;
        return hidr;
      }
    }

    for (const l of consolidadoLinhas(comp)) {
      const v = Number(l.valor) || 0;
      // V634: NEGATIVOS ENTRAM — descontos/ajustes gerenciais de débito fazem
      // parte do repasse. Pular v<=0 fazia a Visão Geral ficar sempre MAIOR
      // que os Relatórios (que somam tudo). Só zero é ignorado (não altera).
      if (!v) continue;
      const nome = l.profissional || '—';
      if (filtroMed && !filtroMed.has(norm(nome))) continue;
      if (filtroMod && !filtroMod.has(l.modulo)) continue;
      if (filtroConv && !filtroConv.has(norm(l.convenio))) continue;   // V521
      res.total += v;
      res.porMedico.set(nome, (res.porMedico.get(nome) || 0) + v);
      const mod = l.modulo || '—';
      res.porModulo.set(mod, (res.porModulo.get(mod) || 0) + v);

      // fatias alinhadas ao módulo Relatórios: status 'Desempenho' = fichários
      // (LIO, Fellow, Estrabismo, Lentes, Laudos, Períodos, etc.); o restante
      // (QVIS/Ajustes/Cargos) entra por ORIGEM (Convênio/Particular/SUS).
      const ehDesempenho = norm(l.status) === 'DESEMPENHO';
      if (ehDesempenho) {
        res.fatias.DESEMPENHO += v;
      } else {
        const o = norm(l.origem);
        if (o.indexOf('PART') >= 0) res.fatias.PARTICULAR += v;
        else if (o === 'SUS') res.fatias.SUS += v;
        else res.fatias.CONVENIO += v;   // CONVÊNIO, Ajustes, ou vazio
      }
    }
    _cacheRepasse[chave] = res;
    if (semFiltroRep) _pcGravar('repasseMes', comp, {   // V589
      total: res.total, fatias: res.fatias,
      porMedico: [...res.porMedico], porModulo: [...res.porModulo] });
    return res;
  }

  // total de repasse RÁPIDO (snapshot + fichários) — para comparativos LM/LY
  // sem auditar. Sem filtro de médico/módulo (comparativo é do total geral).
  function repasseTotalRapido(comp) {
    if (!comp) return 0;
    let total = 0;
    try {
      const snap = Banco.query(`SELECT total_repasse AS s FROM repasse_snapshot WHERE competencia = ? LIMIT 1`, [comp]);
      if (snap && snap[0]) total += Number(snap[0].s) || 0;
    } catch (_) {}
    const add = (sql) => { try { const q = Banco.query(sql, [comp]); if (q && q[0]) total += Number(q[0].s) || 0; } catch (_) {} };
    add(`SELECT COALESCE(SUM(valor_repasse),0) AS s FROM laudos WHERE competencia = ? AND COALESCE(pendente,0)=0`);
    add(`SELECT COALESCE(SUM(total_valor),0) AS s FROM periodos_linhas WHERE mes_ref = ?`);
    add(`SELECT COALESCE(SUM(total_repassar),0) AS s FROM fellow_linhas WHERE mes_ref = ?`);
    return total;
  }

  // série mensal de repasse. SEM filtro de médico/módulo → caminho RÁPIDO
  // (total do snapshot + fichários por query, sem auditar 12 meses). COM filtro
  // → consolidado por mês (mais lento, porém é uso pontual).
  function serieRepasse(compFim, nMeses, filtros) {
    const comps = [];
    let c = compFim;
    for (let i = 0; i < nMeses; i++) { comps.unshift(c); c = mesAnterior(c); }
    const filtroMed = _fmSet(filtros && filtros.medicoNome, true);   // V922: multi
    const filtroMod = _fmSet(filtros && filtros.modulo, false);
    const filtroConv = _fmSet(filtros && filtros.convenio, true);   // V521

    if (filtroMed || filtroMod || filtroConv) {
      return comps.map(comp => ({ comp, total: repasseConsolidado(comp, filtros).total }));
    }

    // caminho rápido: total de fechamento do snapshot + fichários próprios
    return comps.map(comp => {
      let total = 0;
      try {
        const snap = Banco.query(`SELECT total_repasse AS s FROM repasse_snapshot WHERE competencia = ? LIMIT 1`, [comp]);
        if (snap && snap[0]) total += Number(snap[0].s) || 0;
      } catch (_) {}
      const add = (sql) => { try { const q = Banco.query(sql, [comp]); if (q && q[0]) total += Number(q[0].s) || 0; } catch (_) {} };
      add(`SELECT COALESCE(SUM(valor_repasse),0) AS s FROM laudos WHERE competencia = ? AND COALESCE(pendente,0)=0`);
      add(`SELECT COALESCE(SUM(total_valor),0) AS s FROM periodos_linhas WHERE mes_ref = ?`);
      add(`SELECT COALESCE(SUM(total_repassar),0) AS s FROM fellow_linhas WHERE mes_ref = ?`);
      return { comp, total };
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // GLOSA
  // ════════════════════════════════════════════════════════════════════
  // Dois números distintos (a coluna PRODUZIDO do QVIS duplica o valor por papel):
  //  • PRODUÇÃO GLOSADA  = produzido contado 1× por procedimento glosado. O papel
  //    EXECUTANTE (Médico/Cirurgião) ancora esse valor único, evitando a dupla
  //    contagem dos demais papéis da mesma admissão+procedimento.
  //  • PERDA ESTIMADA    = soma do repasse que CADA papel da linha glosada teria
  //    recebido — calculada pelo MOTOR COMPLETO de Cálculo de Repasse (todas as
  //    regras: match, exceção, pacote, fracionamento, duplicidade, regra geral),
  //    rodando só sobre as linhas com recebido<=0 (window.__atlasCalcularPerdaGlosa).
  //    No ranking, a perda de cada papel é atribuída ao próprio médico daquele papel.

  // Garante o motor de cálculo registrado (a função pública só existe após a tela
  // Cálculo ter sido instanciada). Bootstrap silencioso preservando o dashboard.
  function garantirMotorGlosa() {
    if (typeof window.__atlasCalcularPerdaGlosa === 'function') return true;
    try {
      if (!window.App || !App.telas || typeof App.telas['calcular'] !== 'function') return false;
      const cont = document.getElementById('conteudo');
      // V522: preserva os NÓS VIVOS do dashboard (mover ≠ destruir) — o antigo
      // salvar/restaurar via innerHTML recriava tudo como HTML morto e APAGAVA
      // os listeners (barra de filtros, cliques dos cards, chips…).
      const guarda = document.createDocumentFragment();
      if (cont) { while (cont.firstChild) guarda.appendChild(cont.firstChild); }
      // V863: a devolução dos nós vai num finally. Se o render do Calcular
      // falhar (base incompleta, por exemplo), o catch abaixo já engolia o erro
      // — mas o #conteudo tinha acabado de ser esvaziado e NUNCA era restaurado:
      // a Visão Geral ficava em branco, sem mensagem nenhuma.
      try {
        App.telas['calcular']();               // registra o closure (escreve no #conteudo)
      } finally {
        if (cont) {
          cont.innerHTML = '';                 // descarta o DOM do Calcular
          while (guarda.firstChild) cont.appendChild(guarda.firstChild);   // devolve os nós vivos
        }
      }
      return typeof window.__atlasCalcularPerdaGlosa === 'function';
    } catch (e) { console.error('[VGExec] bootstrap motor glosa:', e); return false; }
  }

  let _papelPorQvis = null;   // Map<norm(papel_qvis), papelId>
  let _papeisExec = null;     // Set(papelId) executante/cirurgião
  function carregarPapeis() {
    if (_papeisExec) return;
    _papelPorQvis = new Map(); _papeisExec = new Set();
    try {
      (Banco.query(`SELECT papel_qvis, papel_id FROM mapeamento_papeis`) || []).forEach(m => {
        _papelPorQvis.set(norm(m.papel_qvis), m.papel_id);
      });
    } catch (_) {}
    try {
      (Banco.query(`SELECT id, nome FROM papeis`) || []).forEach(p => {
        const n = norm(p.nome);
        if (n.indexOf('EXECUT') >= 0 || n.indexOf('CIRURG') >= 0 || n === 'MEDICO') _papeisExec.add(p.id);
      });
    } catch (_) {}
  }
  function ehExecutante(papelQvis, papelId) {
    carregarPapeis();
    if (papelId != null && _papeisExec.has(papelId)) return true;
    const id = _papelPorQvis.get(norm(papelQvis));
    if (id != null) return _papeisExec.has(id);
    const n = norm(papelQvis);
    return n === 'MEDICO' || n.indexOf('CIRURG') >= 0;   // fallback textual
  }

  // cache por competência (a passagem do motor é cara)
  const _cacheGlosa = {};

  // V200.1: VERSÃO LEVE — só contagem de procedimentos com recebido zerado no
  // QVIS (query direta, instantânea). O cálculo da perda por papel (motor) está
  // suspenso até definirmos uma forma mais rápida. Mantém a assinatura pra UI.
  // V534: opcoes.pularPerda = calcula só a parte BARATA (contagens + produção
  // glosada, query direta) e NÃO roda o motor da perda — a UI pinta na hora e
  // busca a perda depois em 2º plano. Se a perda já estiver em cache, usa mesmo
  // assim (é instantâneo).
  function glosaResumo(comp, filtros, opcoes) {
    const pularPerda = !!(opcoes && opcoes.pularPerda);
    const out = {
      qtdProcedimentos: 0,    // procedimentos (admissão+proc) com recebido zerado
      qtdItens: 0,            // linhas com recebido zerado
      producaoGlosada: 0,     // produzido das linhas zeradas (informativo)
      valorGlosado: 0,
      // V868: GLOSA FATO — a glosa medida linha a linha por PRODUZIDO − RECEBIDO,
      // que captura também o que foi pago PELA METADE (o card só enxergava o
      // recebido zerado). Contém a glosa 100%: com recebido 0 a diferença é o
      // próprio produzido.
      glosaFato: 0,
      qtdItensFato: 0,          // linhas com diferença > 0
      qtdProcedimentosFato: 0,  // procedimentos (admissão+proc) com diferença > 0
      creditoFato: 0,           // quanto de recebido A MAIOR entrou como crédito
      perdaEstimada: null,    // null = não calculado (UI mostra "—")
      porMedico: new Map(),
      semCalculoPerda: true,  // flag: perda não calculada nesta versão
      perdaCalculando: false, // V534: perda adiada (motor roda em 2º plano)
    };
    if (!comp) return out;
    // glosa é inerente ao repasse; filtro de fichário não-repasse → sem glosa
    const filtroMod = _fmSet(filtros && filtros.modulo, false);   // V922: multi
    if (filtroMod) {
      const ehRepasse = [...filtroMod].some(x => {
        const m = norm(x);
        return m === 'REPASSE' || m === 'QVIS' || m.indexOf('QVIS') >= 0 || m.indexOf('REPASSE') >= 0;
      });
      if (!ehRepasse) return out;
    }
    const filtroMed = _fmSet(filtros && filtros.medicoNome, true);   // V922: multi
    try {
      // V516: conta SOMENTE linhas do papel EXECUTANTE (via mapeamento_papeis,
      // o mesmo de-para do Calcular). Antes entravam todos os papéis (indicante,
      // solicitante, laudo, auxiliar), inflando itens e somando o produzido
      // repetido de cada papel do mesmo procedimento.
      // V868: a consulta deixou de filtrar `recebido <= 0`. Ela traz TODAS as
      // linhas do executante no mês, porque a glosa parcial mora justamente nas
      // que receberam alguma coisa. O recorte de papéis é o mesmo de sempre —
      // o de-para mapeia MEDICO e CIRURGIAO em Executante.
      let sql = `SELECT admissao, procedimento, produzido, recebido, nome_profissional AS nome, convenio
                   FROM linhas_qvis
                  WHERE mes_pagamento = ?
                    AND UPPER(TRIM(COALESCE(origem,''))) <> 'PARTICULAR'
                    AND UPPER(TRIM(COALESCE(papel,''))) IN (
                          SELECT UPPER(TRIM(papel_qvis)) FROM mapeamento_papeis
                           WHERE papel_id = (SELECT id FROM papeis WHERE nome = 'Executante'))`;
      const p = [comp];
      const rows = Banco.query(sql, p) || [];
      const procs = new Set();
      const procsFato = new Set();
      const filtroConv = _fmSet(filtros && filtros.convenio, true);   // V521/V922
      for (const r of rows) {
        if (filtroConv && !filtroConv.has(norm(r.convenio))) continue;   // V521
        if (filtroMed && !filtroMed.has(norm(resolverNome(r.nome)))) continue;
        const produzido = Number(r.produzido) || 0;
        const recebido = Number(r.recebido) || 0;
        // GLOSA 100% — a régua de sempre: não recebeu nada
        if (recebido <= 0) {
          out.qtdItens += 1;
          out.producaoGlosada += produzido;
          if (r.admissao) procs.add(`${r.admissao}|${norm(r.procedimento)}`);
        }
        // GLOSA FATO — soma algébrica de PRODUZIDO − RECEBIDO. Diferença zero
        // não é glosa; positiva é glosa (cheia ou parcial); negativa entra como
        // CRÉDITO e abate do total (recebeu mais do que produziu).
        const dif = produzido - recebido;
        if (dif > 0) {
          out.glosaFato += dif;
          out.qtdItensFato += 1;
          if (r.admissao) procsFato.add(`${r.admissao}|${norm(r.procedimento)}`);
        } else if (dif < 0) {
          out.glosaFato += dif;
          out.creditoFato += -dif;
        }
      }
      out.qtdProcedimentos = procs.size;
      out.qtdProcedimentosFato = procsFato.size;
      out.valorGlosado = out.producaoGlosada;
    } catch (e) { console.error('[VGExec] glosa (contagem):', e); }

    // V517: PERDA REAL (pedido do usuário) — as linhas com PRODUZIDO e sem
    // RECEBIDO passam pelo MOTOR COMPLETO de regras do Calcular (match, perfil,
    // pacote, exceção, duplicidade) e o card mostra o REPASSE que o(s)
    // médico(s) deixam de receber. Cache por competência + versão do banco
    // (invalida sozinho a cada importação/gravação).
    try {
      const filtroConvP = _fmSet(filtros && filtros.convenio, true);   // V521/V922
      const chavePerda = comp + '|' + (Banco._versao || 0) + '|' + _fmChave(filtroMed) + '|' + _fmChave(filtroConvP);
      // V589: sem filtros, hidrata o cache da sessão com a foto persistente —
      // reabrir a ferramenta não roda mais o motor se nada mudou
      if (!_cacheGlosa[chavePerda] && !filtroMed && !filtroConvP) {
        const foto = _pcLer('perdaGlosa', comp);
        if (foto) _cacheGlosa[chavePerda] = { perda: foto.perda, porMedico: new Map(foto.porMedico) };
      }
      if (_cacheGlosa[chavePerda]) {
        out.perdaEstimada = _cacheGlosa[chavePerda].perda;
        out.porMedico = _cacheGlosa[chavePerda].porMedico;
        out.semCalculoPerda = false;
      } else if (pularPerda) {
        // V534: adia o motor — a UI mostra "calculando…" e chama de novo em 2º plano
        out.perdaCalculando = true;
      } else if (garantirMotorGlosa()) {
        const linhasPerda = window.__atlasCalcularPerdaGlosa(comp) || [];
        let perda = 0;
        const porMedico = new Map();
        for (const l of linhasPerda) {
          if (filtroConvP && !filtroConvP.has(norm(l.convenio))) continue;   // V521
          const nomeR = resolverNome(l.nome);
          if (filtroMed && !filtroMed.has(norm(nomeR))) continue;
          const v = Number(l.repassePerdido) || 0;
          if (v <= 0) continue;
          perda += v;
          porMedico.set(nomeR, (porMedico.get(nomeR) || 0) + v);
        }
        out.perdaEstimada = perda;
        out.porMedico = porMedico;
        out.semCalculoPerda = false;
        _cacheGlosa[chavePerda] = { perda, porMedico };
        if (!filtroMed && !filtroConvP) _pcGravar('perdaGlosa', comp, { perda, porMedico: [...porMedico] });   // V589
        // higiene: versões antigas nunca mais são lidas
        const vAtual = String(Banco._versao || 0);
        for (const k of Object.keys(_cacheGlosa)) {
          if (k.split('|')[1] !== vAtual) delete _cacheGlosa[k];
        }
      }
    } catch (e) { console.error('[VGExec] glosa (perda motor):', e); }
    return out;
  }

  // V531/V533: linhas de glosa em NATURALIDADE (todos os papéis, sem remoção de
  // duplicidade) p/ o export Excel do card. As LINHAS e o PRODUZIDO vêm do QVIS
  // cru — a MESMA base do card (mesmos filtros: recebido<=0, ≠ PARTICULAR, papel
  // executante p/ o produzido) — então a soma do PRODUZIDO bate exatamente com o
  // card. A REGRA DE REPASSE por papel vem do motor do Calcular (join por id).
  // Respeita os filtros ativos do card (convênio + médico + módulo repasse).
  function glosaNatural(comp, filtros) {
    if (!comp) return [];
    const filtroMod = _fmSet(filtros && filtros.modulo, false);   // V922: multi
    if (filtroMod) {
      const ehRepasse = [...filtroMod].some(x => {
        const m = norm(x);
        return m === 'REPASSE' || m === 'QVIS' || m.indexOf('QVIS') >= 0 || m.indexOf('REPASSE') >= 0;
      });
      if (!ehRepasse) return [];
    }
    if (!garantirMotorGlosa() || typeof window.__atlasCalcularPerdaGlosa !== 'function') return [];

    // 1) REPASSE PERDIDO por linha (id → valor) — MESMA fonte/valor que o card
    //    soma no "REPASSE TOTAL GLOSADO" (motor: só linhas 'casou' contam).
    //    V536: ACUMULA por id — nos pacotes de consulta o motor emite 2 linhas
    //    com o MESMO id (mãe 'casou' + filha 'pacoteDetalhe'); somar (como o card)
    //    evita que a filha zere/sobrescreva a mãe. Só valores positivos, igual ao card.
    const perdaPorId = new Map();
    (window.__atlasCalcularPerdaGlosa(comp) || []).forEach(l => {
      if (l.id == null) return;
      const v = Number(l.repassePerdido) || 0;
      if (v <= 0) return;
      perdaPorId.set(l.id, (perdaPorId.get(l.id) || 0) + v);
    });

    // 2) LINHAS naturais direto do QVIS (mesma base do card — todas as linhas
    //    glosadas: recebido<=0, ≠ PARTICULAR, TODOS os papéis, sem restrição).
    let rows = [];
    try {
      rows = Banco.query(
        `SELECT id, admissao, procedimento, papel,
                nome_profissional AS nome, convenio, origem, produzido, recebido
           FROM linhas_qvis
          WHERE mes_pagamento = ?
            AND COALESCE(recebido,0) <= 0
            AND UPPER(TRIM(COALESCE(origem,''))) <> 'PARTICULAR'`, [comp]) || [];
    } catch (e) { console.error('[VGExec] glosaNatural QVIS:', e); return []; }

    // executante = mesma definição do card (mapeamento_papeis → 'Executante')
    const execQvis = new Set();
    try {
      (Banco.query(`SELECT UPPER(TRIM(papel_qvis)) AS p FROM mapeamento_papeis
                     WHERE papel_id = (SELECT id FROM papeis WHERE nome = 'Executante')`) || [])
        .forEach(r => { if (r.p) execQvis.add(r.p); });
    } catch (_) {}
    const ehExec = (papel) => execQvis.has(String(papel || '').trim().toUpperCase());

    const filtroConv = _fmSet(filtros && filtros.convenio, true);   // V922: multi
    const filtroMed = _fmSet(filtros && filtros.medicoNome, true);

    // 3) filtro POR LINHA (cada linha pelo seu próprio convênio/nome), idêntico
    //    ao que o card faz nas somas de PRODUÇÃO GLOSADA e REPASSE PERDIDO.
    const out = [];
    for (const r of rows) {
      if (filtroConv && !filtroConv.has(norm(r.convenio))) continue;
      if (filtroMed && !filtroMed.has(norm(resolverNome(r.nome)))) continue;
      const executante = ehExec(r.papel);
      out.push({
        admissao: r.admissao || '',
        procedimento: r.procedimento || '',
        papel: r.papel || '',
        nome: resolverNome(r.nome),
        convenio: r.convenio || '',
        origem: r.origem || '',
        ehExecutante: executante,
        // PRODUZIDO só no executante (demais = 0) → soma = PROD. TOTAL GLOSADA do card
        produzido: executante ? (Number(r.produzido) || 0) : 0,
        recebido: Number(r.recebido) || 0,
        // REGRA REPASSE = repasse PERDIDO da linha (mesmo valor do card) → soma bate
        regraRepasse: perdaPorId.has(r.id) ? perdaPorId.get(r.id) : 0,
      });
    }
    return out;
  }

  // ── variação % helper ─────────────────────────────────────────────────
  function variacao(atual, base) {
    if (!base || base === 0) return null;
    return { pct: ((atual - base) / base) * 100, abs: atual - base };
  }

  return {
    competenciasDisponiveis, competenciaAtual, medicosLista, categoriasProducao, conveniosLista,   // V521
    modulosConsolidado,
    mesAnterior, anoAnterior,
    producaoTotal, producaoPorTipo, qvisProducao,
    repasseConsolidado, repasseTotalRapido, serieRepasse,
    glosaResumo, glosaNatural, desempenhoMedicos, desempRepasseMedicos, variacao,   // V531/V545/V574
    categoriasQvis, categoriaDaAdmissao,   // V931
    classificacaoDaAdmissao,               // V934 ({ cat, sub })
    _fotoLer: _pcLer, _fotoGravar: _pcGravar,   // V591: foto persistente p/ o comparativo mês a mês
    _limparCache: () => {
      for (const k in _cacheRepasse) delete _cacheRepasse[k];
      for (const k in _cacheGlosa) delete _cacheGlosa[k];
      for (const k in _cacheElegiveis) delete _cacheElegiveis[k];
      for (const k in _cacheQvisGrupos) delete _cacheQvisGrupos[k];   // V534
    },
  };
})();
