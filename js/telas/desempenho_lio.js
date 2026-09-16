/**
 * ============================================================================
 * TELA: Desempenho · LIO (Lentes Intra-Oculares)
 *
 * FASE 1.1 — base + correções da V1:
 *   ① Coluna "Repasse" com cálculo 18% (executante) — toggle ocultar/mostrar
 *   ② Drilldown clicável quando indicante ≠ executante (mostra 2,5% indic.)
 *   ③ Painel ⚙ Ajustes com:
 *      - Mostrar/Ocultar R$ Repasse
 *      - Lista de produtos elegíveis (chips) com checkbox individual
 *   ④ Cor de aviso (laranja) em linhas com Valor R$ = 0,00
 *   ⑤ Scroll interno na tabela (altura fixa, não rola a tela inteira)
 *
 * AINDA PENDENTE (próximas fases):
 *   - Cálculo do 2,5% indicante consolidado por médico (matriz)
 *   - Filtros COM/SEM SERVICO - DE IMPLANTE no header
 *   - Matriz por médico (drilldown executante vs indicante consolidado)
 *   - Marcar como pago + EV + troca de médico
 * ============================================================================
 */

App.telas['desempenho-lio'] = function () {
  console.log('%c[LIO v80]%c Filtros em GRID com gap 24px forçado',
    'background:#C24A1F;color:white;padding:3px 8px;border-radius:3px;font-weight:bold;font-size:13px',
    'color:#143352;font-weight:bold');

  const MESES_EXTENSO = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                         'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // ───────────────────────────────────────────────────────────────────────
  // Termos que caracterizam a "regra geral" do fichário LIO (uso futuro em
  // validações de matching). Match por "contém", case-insensitive.
  // ───────────────────────────────────────────────────────────────────────
  const TERMOS_REGRA_LIO = ['LIO', 'SERVICO DE IMPLANTE', 'LENTE INTRA OCULAR'];


  // ───────────────────────────────────────────────────────────────────────
  // PERSONALIZAÇÃO DE RÓTULOS (V128)
  // Mesmo padrão usado em Laudos: cada chave editável gravada em
  // config_lio com prefixo "ROT_". Editado em Ajustes > Personalização.
  // ───────────────────────────────────────────────────────────────────────
  const LABELS_PADRAO_LIO = {
    sub_aba_particular: 'Particular',
    col_repasse:        'Repasse',
    col_executante:     'Executante',
    col_indicante:      'Indicante',
    titulo_ajustes:     'Ajustes',
    titulo_produtos:    'Produtos elegíveis',
    label_pct_exec:     '% Executante',
    label_pct_ind:      '% Indicante',
  };

  let __rotulosCacheLio = null;
  function getRotLio(chave) {
    if (!__rotulosCacheLio) {
      __rotulosCacheLio = {};
      try {
        const rows = Banco.query(`SELECT chave, valor FROM config_lio WHERE chave LIKE 'ROT_%'`);
        const cfg = {};
        for (const r of rows) cfg[r.chave] = r.valor;
        for (const k of Object.keys(LABELS_PADRAO_LIO)) {
          const custom = cfg['ROT_' + k];
          __rotulosCacheLio[k] = (custom != null && custom !== '') ? custom : LABELS_PADRAO_LIO[k];
        }
      } catch (_) {
        Object.assign(__rotulosCacheLio, LABELS_PADRAO_LIO);
      }
    }
    return __rotulosCacheLio[chave] || LABELS_PADRAO_LIO[chave] || chave;
  }
  function invalidarRotulosLio() { __rotulosCacheLio = null; }

  // ───────────────────────────────────────────────────────────────────────
  // V129.4: HELPERS DE CONVÊNIOS ELEGÍVEIS
  // ───────────────────────────────────────────────────────────────────────

  /** Retorna todos os convênios distintos da tabela linhas_qvis,
   *  com contagem de linhas e a competência mais recente. */
  function listarConveniosDoQvis() {
    try {
      const rows = Banco.query(`
        SELECT
          convenio,
          COUNT(*)            AS n_linhas,
          MAX(competencia)    AS ult_comp
        FROM linhas_qvis
        WHERE convenio IS NOT NULL AND TRIM(convenio) <> ''
        GROUP BY convenio
        ORDER BY n_linhas DESC, convenio ASC
      `);
      return rows;
    } catch (e) {
      console.warn('[LIO V129.4] listarConveniosDoQvis falhou:', e);
      return [];
    }
  }

  /** Retorna o set de convênios flagados (em lio_convenios_flagados). */
  function listarConveniosFlagados() {
    try {
      const rows = Banco.query(`SELECT convenio, flagado_em FROM lio_convenios_flagados ORDER BY convenio`);
      return rows || [];
    } catch (e) {
      console.warn('[LIO V129.4] listarConveniosFlagados falhou:', e);
      return [];
    }
  }

  /** Conta OPMEs cadastrados em lio_opme_tabela pra um convênio. */
  function contarOpmesDoConvenio(convenio) {
    try {
      const r = Banco.query(
        `SELECT COUNT(*) AS n, MAX(importado_em) AS ult FROM lio_opme_tabela WHERE convenio = ?`,
        [convenio]
      );
      return r[0] || { n: 0, ult: null };
    } catch (e) {
      return { n: 0, ult: null };
    }
  }

  function flagarConvenio(convenio) {
    try {
      Banco.executar(
        `INSERT OR IGNORE INTO lio_convenios_flagados (convenio) VALUES (?)`,
        [convenio]
      );
      Banco.salvar();
      return true;
    } catch (e) {
      console.error('[LIO V129.4] flagarConvenio falhou:', e);
      return false;
    }
  }

  function desflagarConvenio(convenio) {
    try {
      Banco.executar(`DELETE FROM lio_convenios_flagados WHERE convenio = ?`, [convenio]);
      // V129.15: ao desflagar, remove aliases associados
      Banco.executar(`DELETE FROM lio_convenios_aliases WHERE convenio_flagado = ?`, [convenio]);
      Banco.salvar();
      return true;
    } catch (e) {
      console.error('[LIO V129.4] desflagarConvenio falhou:', e);
      return false;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // V129.15: HELPERS de aliases (mapeamento flagado ↔ nome real no QVIS LIO)
  // ───────────────────────────────────────────────────────────────────────
  function listarAliasesDoFlagado(flagado) {
    try {
      const r = Banco.query(
        `SELECT convenio_qvis FROM lio_convenios_aliases WHERE convenio_flagado = ? ORDER BY convenio_qvis`,
        [flagado]
      );
      return (r || []).map(x => x.convenio_qvis);
    } catch (_) { return []; }
  }

  function listarTodosAliases() {
    try {
      const r = Banco.query(`SELECT convenio_flagado, convenio_qvis FROM lio_convenios_aliases`);
      return r || [];
    } catch (_) { return []; }
  }

  function salvarAliasesDoFlagado(flagado, listaQvis) {
    try {
      try { Banco.db.exec('BEGIN'); } catch (_) {}
      Banco.executar(`DELETE FROM lio_convenios_aliases WHERE convenio_flagado = ?`, [flagado]);
      for (const cq of (listaQvis || [])) {
        if (!cq) continue;
        Banco.executar(
          `INSERT OR IGNORE INTO lio_convenios_aliases (convenio_flagado, convenio_qvis) VALUES (?, ?)`,
          [flagado, cq]
        );
      }
      try { Banco.db.exec('COMMIT'); } catch (_) {}
      Banco.salvar();
      return true;
    } catch (e) {
      try { Banco.db.exec('ROLLBACK'); } catch (_) {}
      console.error('[LIO V129.15] salvarAliasesDoFlagado:', e);
      return false;
    }
  }

  /** Retorna convênios distintos do QVIS que TÊM linhas LIO válidas (filtros aplicados). */
  function listarConveniosQvisComLio() {
    try {
      const r = Banco.query(`
        SELECT DISTINCT convenio, COUNT(*) AS n
        FROM linhas_qvis
        WHERE UPPER(COALESCE(procedimento,'')) LIKE '%LIO%'
          AND UPPER(COALESCE(procedimento,'')) NOT LIKE '%TAXA DE MEDICO EXTERNO%'
          AND convenio IS NOT NULL AND convenio <> ''
        GROUP BY convenio
        ORDER BY n DESC, convenio ASC
      `);
      return r || [];
    } catch (_) { return []; }
  }

  // ───────────────────────────────────────────────────────────────────────
  // V129.20: Linhas de teste manuais (laboratório de validação de regra)
  // ───────────────────────────────────────────────────────────────────────
  function listarLinhasTeste() {
    try {
      const r = Banco.query(`SELECT * FROM lio_linhas_teste ORDER BY id DESC`);
      return (r || []).map(row => ({
        ...row,
        admissao: row.admissao || '',
        valor: Number(row.produzido) || 0,   // alias pra compat com cálculos
        produzido: Number(row.produzido) || 0,
        recebido: Number(row.recebido) || 0,
        cirurgiao: row.executante || '',      // a matriz usa cirurgiao como executante
        medico: row.executante || '',
        tipo_recebimento: 'CONVÊNIO',
        _teste: true,
        _testeId: row.id
      }));
    } catch (_) { return []; }
  }

  function salvarLinhaTeste(dados, id = null) {
    try {
      if (id) {
        Banco.executar(
          `UPDATE lio_linhas_teste SET
             data_admissao=?, admissao=?, paciente=?, tipo_produto=?, produto=?,
             convenio=?, indicante=?, executante=?, produzido=?, recebido=?
           WHERE id=?`,
          [dados.data_admissao, dados.admissao, dados.paciente, dados.tipo_produto,
           dados.produto, dados.convenio, dados.indicante, dados.executante,
           dados.produzido, dados.recebido, id]
        );
      } else {
        Banco.executar(
          `INSERT INTO lio_linhas_teste
             (data_admissao, admissao, paciente, tipo_produto, produto,
              convenio, indicante, executante, produzido, recebido)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [dados.data_admissao, dados.admissao, dados.paciente, dados.tipo_produto,
           dados.produto, dados.convenio, dados.indicante, dados.executante,
           dados.produzido, dados.recebido]
        );
      }
      Banco.salvar();
      return true;
    } catch (e) {
      console.error('[LIO V129.20] salvarLinhaTeste:', e);
      return false;
    }
  }

  function removerLinhaTeste(id) {
    try {
      Banco.executar(`DELETE FROM lio_linhas_teste WHERE id = ?`, [id]);
      Banco.salvar();
      return true;
    } catch (e) {
      console.error('[LIO V129.20] removerLinhaTeste:', e);
      return false;
    }
  }

  function lerLinhaTeste(id) {
    try {
      const r = Banco.query(`SELECT * FROM lio_linhas_teste WHERE id = ?`, [id]);
      return (r && r[0]) ? r[0] : null;
    } catch (_) { return null; }
  }

  // ───────────────────────────────────────────────────────────────────────
  // V129.26: Duplicidade Convênio × Particular (automática)
  //   Critério: a mesma admissão tem OPME valorado nos DOIS lados.
  //   (não checa termos — basta haver OPME PARTICULAR com valor > 0)
  // ───────────────────────────────────────────────────────────────────────
  function detectarDuplicidadesConvParticular(admissoesConvenio) {
    const resultado = new Map();
    if (!admissoesConvenio || admissoesConvenio.length === 0) return resultado;
    const escAdm = (s) => String(s).replace(/'/g, "''");
    const lote = admissoesConvenio.slice(0, 5000);
    const inList = lote.map(a => `'${escAdm(a)}'`).join(',');
    if (!inList) return resultado;
    try {
      const rows = Banco.query(`
        SELECT cod_admissao AS admissao,
               SUM(valor) AS valor_particular,
               MAX(produto) AS produto_particular
        FROM linhas_producao
        WHERE classificacao_produto = 'OPME'
          AND tipo_recebimento = 'PARTICULAR'
          AND cod_admissao IN (${inList})
          AND COALESCE(valor,0) > 0
        GROUP BY cod_admissao
        HAVING SUM(valor) > 0
      `);
      for (const r of (rows || [])) {
        resultado.set(String(r.admissao), {
          valorParticular: Number(r.valor_particular) || 0,
          produtoParticular: r.produto_particular || ''
        });
      }
    } catch (e) { console.error('[LIO V129.26] detectarDuplicidades:', e); }
    return resultado;
  }

  // V492: memoização de registrarDuplicidades — evita INSERT/UPDATE + salvar()
  // a CADA re-render da aba CONVÊNIO (inclusive a cada tecla nos filtros).
  // Chave = competência ativa + Banco._versao; guarda também o conjunto de
  // admissões já processadas nessa chave, pra não pular admissões novas que
  // apareçam na mesma competência/versão (ex.: filtro relaxado). O efeito
  // final no banco é idêntico ao anterior.
  let _dupMemoChaveV492 = null;
  let _dupMemoAdmsV492 = null;

  function registrarDuplicidades(mapaDup) {
    if (!mapaDup || mapaDup.size === 0) return;
    // V492: (a) memoização — se já rodou pra essa chave e essas admissões, sai
    const compAtual = (state.ano || '') + '-' + (state.mes || '');
    const chaveMemo = compAtual + '|' + (Banco._versao || 0);
    if (_dupMemoChaveV492 === chaveMemo && _dupMemoAdmsV492) {
      let todasProcessadas = true;
      for (const adm of mapaDup.keys()) {
        if (!_dupMemoAdmsV492.has(adm)) { todasProcessadas = false; break; }
      }
      if (todasProcessadas) return;
    }
    try {
      try { Banco.db.exec('BEGIN'); } catch (_) {}
      let houveMudanca = false;  // V492: (b) só salva se algo mudou de fato
      for (const [adm, info] of mapaDup.entries()) {
        const r1 = Banco.executar(
          `INSERT OR IGNORE INTO lio_admissoes_desabilitadas
             (admissao, habilitada, valor_particular, produto_particular)
           VALUES (?, 0, ?, ?)`,
          [adm, info.valorParticular, info.produtoParticular]
        );
        const r2 = Banco.executar(
          `UPDATE lio_admissoes_desabilitadas
             SET valor_particular = ?, produto_particular = ?
           WHERE admissao = ?`,
          [info.valorParticular, info.produtoParticular, adm]
        );
        if ((r1 && r1.changes > 0) || (r2 && r2.changes > 0)) houveMudanca = true;
      }
      try { Banco.db.exec('COMMIT'); } catch (_) {}
      if (houveMudanca) Banco.salvar();  // V492: antes salvava incondicionalmente
      // V492: registra o memo com a versão PÓS-gravação (salvar() incrementa
      // Banco._versao) — assim o próximo render com o banco inalterado pula.
      const chavePos = compAtual + '|' + (Banco._versao || 0);
      if (_dupMemoChaveV492 === chavePos && _dupMemoAdmsV492) {
        for (const adm of mapaDup.keys()) _dupMemoAdmsV492.add(adm);
      } else {
        _dupMemoChaveV492 = chavePos;
        _dupMemoAdmsV492 = new Set(mapaDup.keys());
      }
    } catch (e) {
      try { Banco.db.exec('ROLLBACK'); } catch (_) {}
      console.error('[LIO V129.26] registrarDuplicidades:', e);
    }
  }

  function lerEstadoDuplicidade(admissao) {
    try {
      const r = Banco.query(
        `SELECT habilitada, valor_particular, produto_particular
         FROM lio_admissoes_desabilitadas WHERE admissao = ?`,
        [admissao]
      );
      if (r && r[0]) return {
        habilitada: !!r[0].habilitada,
        valorParticular: Number(r[0].valor_particular) || 0,
        produtoParticular: r[0].produto_particular || ''
      };
    } catch (_) {}
    return null;
  }

  function alternarHabilitacaoAdmissao(admissao) {
    try {
      const atual = lerEstadoDuplicidade(admissao);
      const novo = atual && atual.habilitada ? 0 : 1;
      Banco.executar(
        `UPDATE lio_admissoes_desabilitadas SET habilitada = ? WHERE admissao = ?`,
        [novo, admissao]
      );
      Banco.salvar();
      return novo === 1;
    } catch (e) {
      console.error('[LIO V129.26] alternarHabilitacao:', e);
      return false;
    }
  }


  //
  // Cada coluna pode ter sua fonte alternada pelo usuário (Produção ↔ QVIS),
  // desde que ambas as bases tenham o dado equivalente. A escolha é
  // persistida em config_lio (chave: MATRIZ_CONV_COL_<id>) e aplicada
  // dinamicamente na query da matriz.
  // ───────────────────────────────────────────────────────────────────────
  const COLUNAS_MATRIZ_CONV = {
    data: {
      titulo: 'Data',
      default: 'PRODUCAO',
      fontes: [
        { id: 'PRODUCAO', label: 'Produção', sql: 'lp.data_admissao' },
        { id: 'QVIS',     label: 'QVIS',     sql: 'qvis.data_admissao' }
      ]
    },
    admissao: {
      titulo: 'Admissão',
      default: 'PRODUCAO',
      fontes: [
        { id: 'PRODUCAO', label: 'Produção', sql: 'lp.cod_admissao' },
        { id: 'QVIS',     label: 'QVIS',     sql: 'qvis.admissao' }
      ]
    },
    paciente: {
      titulo: 'Paciente',
      default: 'PRODUCAO',
      fontes: [
        { id: 'PRODUCAO', label: 'Produção',     sql: 'lp.paciente' },
        { id: 'QVIS',     label: 'QVIS',         sql: 'qvis.paciente' }
      ]
    },
    tipo: {
      titulo: 'Tipo',
      default: 'QVIS',
      fontes: [
        { id: 'QVIS',     label: 'QVIS · procedimento',      sql: 'qvis.procedimento' },
        { id: 'PRODUCAO', label: 'Produção · tipo_produto',  sql: 'lp.tipo_produto' }
      ]
    },
    convenio: {
      titulo: 'Convênio',
      default: 'QVIS',
      fontes: [
        { id: 'QVIS',     label: 'QVIS',     sql: 'qvis.convenio' },
        { id: 'PRODUCAO', label: 'Produção', sql: 'lp.convenio' }
      ]
    },
    produzido: {
      titulo: 'Produzido',
      default: 'QVIS',
      fontes: [
        { id: 'QVIS',     label: 'QVIS · SUM(produzido)',    sql: 'qvis.produzido' },
        { id: 'PRODUCAO', label: 'Produção · valor',         sql: 'lp.valor' }
      ]
    },
    // Colunas SEM troca (só uma fonte): produto, indicante, executante, recebido
  };

  /** Lê a fonte ativa de uma coluna (do config_lio ou retorna default). */
  function lerOrigemColuna(colId) {
    try {
      const r = Banco.query(
        `SELECT valor FROM config_lio WHERE chave = ?`,
        [`MATRIZ_CONV_COL_${colId.toUpperCase()}`]
      );
      if (r && r[0] && r[0].valor) return r[0].valor;
    } catch (_) {}
    return COLUNAS_MATRIZ_CONV[colId] ? COLUNAS_MATRIZ_CONV[colId].default : null;
  }

  /** Salva a fonte escolhida pra uma coluna. */
  async function salvarOrigemColuna(colId, fonteId) {
    try {
      await gravarConfigLio(`MATRIZ_CONV_COL_${colId.toUpperCase()}`, fonteId);
      return true;
    } catch (e) {
      console.error('[LIO V129.17] salvarOrigemColuna:', e);
      return false;
    }
  }

  /** Retorna o objeto { id, label, sql } da fonte ATIVA pra uma coluna. */
  function obterFonteAtiva(colId) {
    const col = COLUNAS_MATRIZ_CONV[colId];
    if (!col) return null;
    const ativo = lerOrigemColuna(colId);
    return col.fontes.find(f => f.id === ativo) || col.fontes[0];
  }

  // ───────────────────────────────────────────────────────────────────────
  // V129.12: MODAL DE CONFIRMAÇÃO customizado (substitui o confirm() feio do navegador)
  //
  // Uso:
  //   const ok = await confirmarLio({
  //     titulo: '...',
  //     mensagem: '...',         // suporta <strong> e \n
  //     textoOk: 'Confirmar',    // opcional
  //     textoCancelar: 'Cancelar', // opcional
  //     perigo: true             // botão OK vira vermelho + ícone ⚠
  //   });
  // ───────────────────────────────────────────────────────────────────────
  function confirmarLio(opts) {
    const { titulo, mensagem, textoOk = 'Confirmar', textoCancelar = 'Cancelar', perigo = false } = opts || {};
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'lio-confirm-wrap';
      wrap.innerHTML = `
        <div class="lio-confirm-overlay"></div>
        <div class="lio-confirm-modal" role="dialog" aria-modal="true">
          <div class="lio-confirm-icon ${perigo ? 'lio-confirm-icon-perigo' : ''}">
            ${perigo ? '⚠' : '❓'}
          </div>
          <div class="lio-confirm-titulo">${escapeHTML(titulo || 'Confirmar ação')}</div>
          <div class="lio-confirm-mensagem">${String(mensagem || '').replace(/\n/g, '<br>')}</div>
          <div class="lio-confirm-acoes">
            <button class="lio-confirm-btn lio-confirm-btn-cancelar" data-conf-cancelar>${escapeHTML(textoCancelar)}</button>
            <button class="lio-confirm-btn lio-confirm-btn-ok ${perigo ? 'lio-confirm-btn-perigo' : ''}" data-conf-ok>${escapeHTML(textoOk)}</button>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);

      let resolvido = false;
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); fechar(false); }
        if (e.key === 'Enter')  { e.preventDefault(); fechar(true); }
      };
      const fechar = (resultado) => {
        if (resolvido) return;
        resolvido = true;
        document.removeEventListener('keydown', onKey);
        wrap.remove();
        resolve(!!resultado);
      };

      wrap.querySelector('[data-conf-ok]').addEventListener('click', () => fechar(true));
      wrap.querySelector('[data-conf-cancelar]').addEventListener('click', () => fechar(false));
      wrap.querySelector('.lio-confirm-overlay').addEventListener('click', () => fechar(false));
      document.addEventListener('keydown', onKey);

      // Foca em Cancelar quando perigo, OK senão
      setTimeout(() => {
        const btn = wrap.querySelector(perigo ? '[data-conf-cancelar]' : '[data-conf-ok]');
        if (btn) btn.focus();
      }, 30);
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // V129.10: HELPERS de TERMOS do padrão de busca
  //
  // Modelo:
  //   • padrao_busca       (TEXT)  → string inferida pelo algoritmo (ex: "GP HOYA VIVINEX GEMETRIC PLUS")
  //   • padrao_customizado (TEXT)  → quando NULL, usa o inferido separado por espaço.
  //                                 Quando NOT NULL, é a lista de termos atuais separada por "|".
  //
  // Toda edição/remoção/adição grava em padrao_customizado a lista completa
  // atualizada — o padrao_busca original nunca é alterado (referência).
  // ───────────────────────────────────────────────────────────────────────
  function lerTermosDoOpme(opme) {
    // V130: delega ao módulo compartilhado (1 fonte da verdade)
    return App.repasseLIO.lerTermosDoOpme(opme);
  }

  function _setTermosDoOpme(idOpme, termos) {
    const valor = termos.length > 0 ? termos.join('|') : null;
    Banco.executar(
      `UPDATE lio_opme_tabela SET padrao_customizado = ? WHERE id = ?`,
      [valor, idOpme]
    );
    Banco.salvar();
  }

  function _getTermosAtuais(idOpme) {
    const row = Banco.query(
      `SELECT padrao_busca, padrao_customizado FROM lio_opme_tabela WHERE id = ?`,
      [idOpme]
    )[0];
    if (!row) return null;
    return lerTermosDoOpme(row);
  }

  function adicionarTermo(idOpme, novoTermo) {
    try {
      const termos = _getTermosAtuais(idOpme);
      if (termos == null) return false;
      const v = String(novoTermo || '').trim().toUpperCase();
      if (!v) return false;
      if (termos.includes(v)) {
        Utilidades.toast?.(`"${v}" já está na lista`, 'info', 2000);
        return false;
      }
      termos.push(v);
      _setTermosDoOpme(idOpme, termos);
      return true;
    } catch (e) {
      console.error('[LIO V129.10] adicionarTermo:', e);
      return false;
    }
  }

  function removerTermo(idOpme, indice) {
    try {
      const termos = _getTermosAtuais(idOpme);
      if (termos == null) return false;
      if (indice < 0 || indice >= termos.length) return false;
      termos.splice(indice, 1);
      _setTermosDoOpme(idOpme, termos);
      return true;
    } catch (e) {
      console.error('[LIO V129.10] removerTermo:', e);
      return false;
    }
  }

  function editarTermo(idOpme, indice, novoValor) {
    try {
      const termos = _getTermosAtuais(idOpme);
      if (termos == null) return false;
      if (indice < 0 || indice >= termos.length) return false;
      const v = String(novoValor || '').trim().toUpperCase();
      if (!v) {
        // Vazio: remove o termo
        termos.splice(indice, 1);
      } else {
        // Detecta duplicata em outras posições
        const dupIdx = termos.findIndex((t, i) => i !== indice && t === v);
        if (dupIdx >= 0) {
          Utilidades.toast?.(`"${v}" já existe nessa linha`, 'info', 2000);
          return false;
        }
        termos[indice] = v;
      }
      _setTermosDoOpme(idOpme, termos);
      return true;
    } catch (e) {
      console.error('[LIO V129.10] editarTermo:', e);
      return false;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // V129.11: CONSOLIDADO DE TERMOS por convênio
  //
  // Agrega todos os termos únicos usados em todas as linhas de OPME de um
  // convênio, com contagem de quantas linhas usam cada termo.
  // Permite remover um termo de TODAS as linhas onde ele aparece.
  // ───────────────────────────────────────────────────────────────────────
  function consolidarTermosDoConvenio(convenio) {
    try {
      const rows = Banco.query(
        `SELECT padrao_busca, padrao_customizado FROM lio_opme_tabela WHERE convenio = ?`,
        [convenio]
      );
      const contagem = new Map();
      for (const r of rows) {
        const termos = lerTermosDoOpme(r);
        const vistos = new Set(); // evita contar duplicatas dentro da mesma linha
        for (const t of termos) {
          if (vistos.has(t)) continue;
          vistos.add(t);
          contagem.set(t, (contagem.get(t) || 0) + 1);
        }
      }
      return Array.from(contagem.entries())
        .map(([termo, n]) => ({ termo, n }))
        .sort((a, b) => b.n - a.n || a.termo.localeCompare(b.termo));
    } catch (e) {
      console.error('[LIO V129.11] consolidarTermosDoConvenio:', e);
      return [];
    }
  }

  function removerTermoDeTodasLinhas(convenio, termoRemover) {
    try {
      const rows = Banco.query(
        `SELECT id, padrao_busca, padrao_customizado
           FROM lio_opme_tabela
          WHERE convenio = ?`,
        [convenio]
      );
      let afetadas = 0;
      try { Banco.db.exec('BEGIN'); } catch (_) {}
      try {
        for (const r of rows) {
          const termos = lerTermosDoOpme(r);
          const filtrado = termos.filter(t => t !== termoRemover);
          if (filtrado.length === termos.length) continue; // não tinha o termo
          const valor = filtrado.length > 0 ? filtrado.join('|') : null;
          Banco.executar(
            `UPDATE lio_opme_tabela SET padrao_customizado = ? WHERE id = ?`,
            [valor, r.id]
          );
          afetadas++;
        }
        try { Banco.db.exec('COMMIT'); } catch (_) {}
      } catch (e) {
        try { Banco.db.exec('ROLLBACK'); } catch (_) {}
        throw e;
      }
      Banco.salvar();
      return afetadas;
    } catch (e) {
      console.error('[LIO V129.11] removerTermoDeTodasLinhas:', e);
      return 0;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // V129.7: IMPORTAÇÃO de planilha de OPMEs de um convênio
  //
  // Planilha esperada (.xlsx):
  //   - 1 aba
  //   - Colunas: Convênio | Produto | LIO | FACO
  //   - O nome do convênio sai da PRIMEIRA LINHA (coluna Convênio)
  //
  // Comportamento (decisões V129):
  //   - INSERT-ONLY: linhas existentes (conv + produto) são IGNORADAS
  //   - Roda inferirPadraoBusca() em cada novo produto
  //   - Auto-detecta convênio pela coluna; se não bater com o esperado,
  //     pede confirmação
  // ───────────────────────────────────────────────────────────────────────
  async function importarPlanilhaConvenio(file, convenioEsperado) {
    if (typeof XLSX === 'undefined') {
      Utilidades.toast?.('SheetJS não está disponível', 'error', 3000);
      return false;
    }
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const wsName = wb.SheetNames[0];
      if (!wsName) {
        Utilidades.toast?.('Planilha vazia (sem abas)', 'error', 3000);
        return false;
      }
      const ws = wb.Sheets[wsName];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: null });

      if (!rows || rows.length === 0) {
        Utilidades.toast?.('Planilha sem dados', 'error', 3000);
        return false;
      }

      // Detecta convênio da primeira linha — tenta Convênio, Convenio, CONVENIO
      const findKey = (obj, candidates) => {
        for (const k of Object.keys(obj)) {
          const u = String(k).toUpperCase().trim();
          for (const c of candidates) {
            if (u === c || u === c.replace(/[ÊE]/g, 'E')) return k;
          }
        }
        return null;
      };

      const firstRow = rows[0];
      const keyConv = findKey(firstRow, ['CONVÊNIO', 'CONVENIO']);
      const keyProd = findKey(firstRow, ['PRODUTO']);
      const keyLio  = findKey(firstRow, ['LIO']);
      const keyFaco = findKey(firstRow, ['FACO']);

      if (!keyConv || !keyProd || !keyLio) {
        Utilidades.toast?.('Colunas obrigatórias não encontradas (Convênio, Produto, LIO)', 'error', 4000);
        return false;
      }

      const convenioDetectado = String(firstRow[keyConv] || '').trim();
      if (!convenioDetectado) {
        Utilidades.toast?.('Convênio vazio na 1ª linha', 'error', 3000);
        return false;
      }

      // Confere com o convênio esperado
      if (convenioDetectado.toUpperCase() !== convenioEsperado.toUpperCase()) {
        const ok = await confirmarLio({
          titulo: 'Convênios divergentes',
          mensagem:
            `A planilha contém o convênio <strong>"${escapeHTML(convenioDetectado)}"</strong> mas você está importando para <strong>"${escapeHTML(convenioEsperado)}"</strong>.\n\n` +
            `Continuar mesmo assim? A tabela será vinculada a <strong>"${escapeHTML(convenioEsperado)}"</strong>.`,
          textoOk: 'Continuar',
          textoCancelar: 'Cancelar',
          perigo: true
        });
        if (!ok) return false;
      }

      // INSERT-ONLY: se UNIQUE(convenio, produto) bater, INSERT lança erro → ignoramos
      let inseridas = 0;
      let ignoradas = 0;
      let descartadas = 0;

      try { Banco.db.exec('BEGIN'); } catch (_) {}
      try {
        for (const row of rows) {
          const produto = String(row[keyProd] || '').trim();
          if (!produto) { descartadas++; continue; }

          // V491: parse BR-aware — parseFloat puro fazia "1.234,56" (texto) virar 1.234
          const valorLio = Utilidades.parseNumBR(row[keyLio], 0) || 0;
          const valorFaco = keyFaco ? (Utilidades.parseNumBR(row[keyFaco], 0) || 0) : 0;
          const padrao = inferirPadraoBusca(produto);

          try {
            Banco.executar(
              `INSERT INTO lio_opme_tabela
                 (convenio, produto, valor_lio, valor_faco, padrao_busca, ativo)
               VALUES (?, ?, ?, ?, ?, 1)`,
              [convenioEsperado, produto, valorLio, valorFaco, padrao]
            );
            inseridas++;
          } catch (e) {
            // UNIQUE constraint = já existe → ignora
            ignoradas++;
          }
        }
        try { Banco.db.exec('COMMIT'); } catch (_) {}
      } catch (e) {
        try { Banco.db.exec('ROLLBACK'); } catch (_) {}
        throw e;
      }

      Banco.salvar();

      const msg = `✓ ${inseridas} OPMEs importados`
        + (ignoradas > 0 ? ` · ${ignoradas} já existiam (ignorados)` : '')
        + (descartadas > 0 ? ` · ${descartadas} linhas sem produto` : '');
      Utilidades.toast?.(msg, 'success', 4500);

      return true;
    } catch (e) {
      console.error('[LIO V129.7] Erro na importação:', e);
      Utilidades.toast?.(`Erro na importação: ${e.message}`, 'error', 4500);
      return false;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // INFERÊNCIA DE PADRÃO DE BUSCA (V129)
  // Extrai palavras-chave identificadoras de um nome de OPME, removendo
  // prefixos, sufixos técnicos, dioptrias e códigos.
  //
  // Exemplos:
  //   "LIO - TECNIS PURESEE TORICA DET 100 N.20,5"   → "TECNIS PURESEE"
  //   "LIO CNATT2 - CLAREON PANOPTIX TORIC N.22,5"   → "CLAREON PANOPTIX"
  //   "LIO MONOFOCAL ALCON SN60WF N.21,0"            → "ALCON SN60WF"
  //   "LIO DIU - 375 EYHANCE TORICA II N.21,5"       → "EYHANCE II"
  //
  // Função pura — pode ser chamada antes mesmo do Banco estar pronto.
  // ───────────────────────────────────────────────────────────────────────
  function inferirPadraoBusca(nome) {
    if (!nome) return '';
    let s = String(nome).toUpperCase().trim();

    // 1) Remove prefixo "LIO" e variantes ("LIO -", "LIO CNATT2 -", "LIO ")
    s = s.replace(/^LIO\s+[A-Z0-9]+\s*-\s*/, '');  // "LIO CNATT2 - "
    s = s.replace(/^LIO\s*-\s*/, '');              // "LIO - "
    s = s.replace(/^LIO\s+/, '');                  // "LIO "

    // 2) Sufixos de tipo óptico
    s = s.replace(/\b(MONOFOCAL|MULTIFOCAL|BIFOCAL|TRIFOCAL|EDOF|ESFERICA|ASFERICA)\b/g, '');

    // 3) Sufixos de lateralidade
    s = s.replace(/\b(TORICA|TORICO|TORIC)\b/g, '');

    // 4) Sufixo DIU
    s = s.replace(/\bDIU\b/g, '');

    // 5) Dioptria / numeração
    s = s.replace(/\bN\s*\.?\s*\d+[.,]?\d*/g, '');  // "N.20,5", "N 21,0", "N.21.0"
    s = s.replace(/\bDET\s*\d+/g, '');             // "DET 100", "DET 150"
    s = s.replace(/\bD\s+\d+/g, '');               // "D 20"
    s = s.replace(/\bT\d+\b/g, '');                // "T4", "T2" (sufixo de panoptix TORIC T4)

    // 6) Números soltos no início e fim
    s = s.replace(/^\s*\d+(?:[.,]\d+)?\s+/, '');   // "375 EYHANCE..."
    s = s.replace(/\s+\d+(?:[.,]\d+)?\s*$/, '');

    // 7) Pontuação como separador
    s = s.replace(/[,\/\-]/g, ' ');

    // 8) Normalização final
    s = s.replace(/\s+/g, ' ').trim();

    return s;
  }

  // ───────────────────────────────────────────────────────────────────────
  // ESTADO (volatil + persistido em config_lio)
  // ───────────────────────────────────────────────────────────────────────
  if (!window.__lio) {
    window.__lio = {
      mes: '', ano: '', aba: 'CONVENIO',
      ajustesAberto: false,
      regrasAberto: false,            // popover info ⓘ
      dropdownAberto: null,           // 'admissao' | 'paciente' | 'medico' | 'cod_paciente' | null
      ajustesPaiAba: 'PARTICULAR',    // V129: aba PAI do painel: 'PARTICULAR' | 'CONVENIO'
      ajustesAba: 'CONVENIO',         // aba dentro do painel Ajustes (mantida pra compat)
      matrizFiltro: 'COM_REGRA',      // 'COM_REGRA' | 'SEM_REGRA' | 'TODAS' — filtro de visualização da matriz
      ocultarRepasse: false,
      linhasExpandidas: new Set(),
      macrosAbertas: new Set(),       // macros expandidas no painel Ajustes
      tiposAbertos: new Set(),        // tipos expandidos dentro de macros
      convExpandidos: new Set(),      // V129: convênios expandidos no drilldown
      convBusca: '',                  // V129.4: texto digitado na busca de convênios
      convDropdownAberto: false,      // V129.4: dropdown de resultados aberto
      adicionandoPadrao: null,        // V129.9: id do OPME com input ativo pra adicionar padrão extra
      editandoChip: null,             // V129.10: { idOpme, indice } do chip em edição
      consolidadoAberto: new Set(),   // V129.11: convênios com consolidado de termos expandido
      mapeamentoAberto: false,        // V129.15: modal de mapeamento de siglas aberto
      mapeamentoBusca: '',            // V129.15: filtro de busca no modal de mapeamento
      menuOrigemCol: null,            // V129.17: id da coluna com menu de origem aberto
      testeModalAberto: false,        // V129.20: modal de inserção de linha de teste
      testeEditando: null,            // V129.20: id da linha de teste em edição (ou null = nova)
      // Filtros separados
      filtros: {
        admissao: '',
        paciente: '',
        medico: '',
        cod_paciente: '',
        tipos: new Set(),             // tipos PRODUTO selecionados (vazio = todos)
        produtos: new Set(),          // produtos selecionados (vazio = todos)
      },
      // Estado dos popovers de filtro de coluna
      popoverColuna: null,            // 'tipo' | 'produto' | null
    };
  }
  const state = window.__lio;

  // Reset da flag de animação: sempre anima na primeira renderização após
  // entrar no fichário (mas não em re-renderizações por filtro/aba)
  state._jaAnimou = false;

  // ───────────────────────────────────────────────────────────────────────
  // CONFIG: lê/grava na tabela config_lio + lio_produtos_excluidos
  // ───────────────────────────────────────────────────────────────────────
  // V492: DDLs (CREATE TABLE/ALTER TABLE) extraídos de lerConfigLio — antes
  // rodavam 6 blocos a CADA chamada (e lerConfigLio roda em todo render).
  // Agora rodam UMA vez por sessão (por instância do banco: se o Banco.db for
  // recarregado/importado, a flag invalida sozinha e o schema é re-garantido).
  function garantirSchemaLioV492() {
    if (window.__lioSchemaOkV492 === Banco.db) return;
    try {
      // Garante tabela com chave composta (produto, tipo_recebimento).
      // Migração defensiva: se a tabela antiga existe sem essa coluna,
      // ela é mantida (chaves antigas serão tratadas como CONVENIO).
      Banco.db.exec(`
        CREATE TABLE IF NOT EXISTS lio_produtos_excluidos (
          produto          TEXT NOT NULL,
          tipo_recebimento TEXT NOT NULL DEFAULT 'CONVENIO',
          excluido_em      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (produto, tipo_recebimento)
        );
      `);
      try {
        // Tenta migrar adicionando coluna se a tabela antiga não tinha
        Banco.db.exec(`ALTER TABLE lio_produtos_excluidos ADD COLUMN tipo_recebimento TEXT NOT NULL DEFAULT 'CONVENIO'`);
      } catch (e) { /* coluna já existe */ }
    } catch (e) { console.warn(e); }

    // ─────────────────────────────────────────────────────────────────
    // V129: 3 tabelas novas pra fluxo de Convênio
    // ─────────────────────────────────────────────────────────────────
    try {
      // Convênios fixados pelo usuário (persistidos entre meses)
      Banco.db.exec(`
        CREATE TABLE IF NOT EXISTS lio_convenios_flagados (
          convenio   TEXT PRIMARY KEY,
          flagado_em TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Catálogo de OPMEs importado das planilhas
      Banco.db.exec(`
        CREATE TABLE IF NOT EXISTS lio_opme_tabela (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          convenio           TEXT NOT NULL,
          produto            TEXT NOT NULL,
          valor_lio          REAL NOT NULL DEFAULT 0,
          valor_faco         REAL NOT NULL DEFAULT 0,
          padrao_busca       TEXT,
          padrao_customizado TEXT,
          ativo              INTEGER NOT NULL DEFAULT 1,
          importado_em       TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(convenio, produto)
        );
      `);

      // Validações (glosa manual) por linha × competência
      Banco.db.exec(`
        CREATE TABLE IF NOT EXISTS lio_opme_validacoes (
          convenio    TEXT NOT NULL,
          produto     TEXT NOT NULL,
          competencia TEXT NOT NULL,
          validado    INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (convenio, produto, competencia)
        );
      `);

      // V129.15: mapeamento de aliases — nome do flagado (QVIS amigável) ↔ nome(s) reais no QVIS LIO
      // Quando "BOMBEIROS (DF)" flagado não casa no QVIS LIO mas "CBMDF" casa, usuário cria o alias.
      Banco.db.exec(`
        CREATE TABLE IF NOT EXISTS lio_convenios_aliases (
          convenio_flagado TEXT NOT NULL,
          convenio_qvis    TEXT NOT NULL,
          criado_em        TEXT DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (convenio_flagado, convenio_qvis)
        );
      `);

      // V129.20: linhas de teste manuais inseridas na matriz de Convênio.
      // Servem pra validar se a regra está sendo aplicada corretamente.
      // Persistem no banco até o usuário apagar.
      Banco.db.exec(`
        CREATE TABLE IF NOT EXISTS lio_linhas_teste (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          data_admissao  TEXT,
          admissao       TEXT,
          paciente       TEXT,
          tipo_produto   TEXT,
          produto        TEXT,
          convenio       TEXT,
          indicante      TEXT,
          executante     TEXT,
          produzido      REAL DEFAULT 0,
          recebido       REAL DEFAULT 0,
          criado_em      TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // V129.26: admissões com duplicidade Convênio × Particular (mesma admissão
      // com OPME valorado nos dois lados). Detecção automática; desabilitadas por
      // padrão (habilitada=0), o usuário pode reabilitar (toggle por linha).
      Banco.db.exec(`
        CREATE TABLE IF NOT EXISTS lio_admissoes_desabilitadas (
          admissao        TEXT PRIMARY KEY,
          habilitada      INTEGER NOT NULL DEFAULT 0,
          valor_particular REAL,
          produto_particular TEXT,
          detectado_em    TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (e) { console.warn('[LIO V129] Erro criando tabelas:', e); }

    window.__lioSchemaOkV492 = Banco.db;
  }

  function lerConfigLio() {
    garantirSchemaLioV492();  // V492: DDL 1x por sessão (antes: a cada chamada)
    const cfg = {
      pctExecutante: 18,
      pctIndicante: 2.5,
      pctConvenio: 18,                // V129: % repasse de Convênio (default 18)
      ocultarRepasse: false,
      pagarIndicante: true,           // V129.21: pagar 2,5% ao indicante quando ≠ executante
      // Mapas separados: produtos excluídos por fonte pagadora
      produtosExcluidosConv: new Set(),
      produtosExcluidosPart: new Set(),
    };
    try {
      const rows = Banco.query(`SELECT chave, valor FROM config_lio`);
      const map = new Map();
      for (const r of rows) map.set(r.chave, r.valor);
      const pctExec = parseFloat(map.get('PCT_EXECUTANTE_GERAL'));
      const pctInd = parseFloat(map.get('PCT_INDICANTE_GERAL'));
      const pctConv = parseFloat(map.get('PCT_CONVENIO_GERAL'));
      const ocult = map.get('OCULTAR_REPASSE');
      if (!isNaN(pctExec)) cfg.pctExecutante = pctExec;
      if (!isNaN(pctInd))  cfg.pctIndicante = pctInd;
      if (!isNaN(pctConv)) cfg.pctConvenio = pctConv;
      if (ocult === 'true') cfg.ocultarRepasse = true;
      if (map.get('PAGAR_INDICANTE_25') === 'false') cfg.pagarIndicante = false;
    } catch (e) { console.warn(e); }
    try {
      // V492: DDL/migração desta tabela movidos pra garantirSchemaLioV492()
      const exc = Banco.query(`SELECT produto, tipo_recebimento FROM lio_produtos_excluidos`);
      for (const r of exc) {
        const tp = String(r.tipo_recebimento || 'CONVENIO').toUpperCase();
        if (tp === 'PARTICULAR') cfg.produtosExcluidosPart.add(r.produto);
        else                     cfg.produtosExcluidosConv.add(r.produto);
      }
    } catch (e) { console.warn(e); }

    // V492: os 6 blocos de CREATE TABLE (V129/V129.15/V129.20/V129.26) que
    // rodavam aqui a cada chamada foram movidos pra garantirSchemaLioV492().

    return cfg;
  }

  async function gravarConfigLio(chave, valor) {
    const stmt = Banco.db.prepare(`
      INSERT INTO config_lio (chave, valor) VALUES (?, ?)
      ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor
    `);
    try { stmt.run([chave, String(valor)]); } finally { stmt.free(); }
    await Banco.salvar();
  }

  async function toggleProdutoExcluido(produto, fonte, excluir) {
    return definirProdutosExcluidos([produto], fonte, excluir);
  }

  /**
   * Versão batch com fonte pagadora. fonte = 'CONVENIO' | 'PARTICULAR'.
   */
  async function definirProdutosExcluidos(produtos, fonte, excluir) {
    if (!produtos || produtos.length === 0) return;
    const fonteSafe = String(fonte || 'CONVENIO').toUpperCase();
    try {
      Banco.db.exec('BEGIN');
      if (excluir) {
        const stmt = Banco.db.prepare(`
          INSERT OR IGNORE INTO lio_produtos_excluidos (produto, tipo_recebimento)
          VALUES (?, ?)
        `);
        try { for (const p of produtos) stmt.run([p, fonteSafe]); }
        finally { stmt.free(); }
      } else {
        const stmt = Banco.db.prepare(`
          DELETE FROM lio_produtos_excluidos
           WHERE produto = ? AND tipo_recebimento = ?
        `);
        try { for (const p of produtos) stmt.run([p, fonteSafe]); }
        finally { stmt.free(); }
      }
      Banco.db.exec('COMMIT');
    } catch (e) {
      try { Banco.db.exec('ROLLBACK'); } catch (ee) {}
      console.error('[LIO] erro batch produtos:', e);
      throw e;
    }
    await Banco.salvar();
  }

  // ───────────────────────────────────────────────────────────────────────
  // CARREGAMENTO DE DADOS
  // ───────────────────────────────────────────────────────────────────────
  function carregarLinhasLio(tipoRecebimento) {
    // ═════════════════════════════════════════════════════════════════════
    // V129.14: A aba CONVÊNIO agora usa fonte HÍBRIDA:
    //   • Admissões: linhas_qvis (filtro: procedimento contém LIO,
    //                              exclui "TAXA DE MEDICO EXTERNO")
    //   • Filtro de convênios flagados: aplicado no lq.convenio
    //   • Detalhes do OPME (produto, médicos, etc): linhas_producao via JOIN
    //   • Coluna TIPO: lq.procedimento (QVIS)
    //   • Colunas PRODUZIDO + RECEBIDO: agregados do QVIS por admissão
    //
    // Aba PARTICULAR: mantém comportamento antigo (só linhas_producao)
    // ═════════════════════════════════════════════════════════════════════
    if (tipoRecebimento === 'CONVENIO') {
      return carregarLinhasLioConvenio();
    }

    // ─── PARTICULAR — não mudou ───────────────────────────────────────────
    const wheres = [`classificacao_produto = 'OPME'`];
    wheres.push(`tipo_recebimento = 'PARTICULAR'`);
    wheres.push(`(
      UPPER(COALESCE(tipo_produto,'')) LIKE '%LIO%'
      OR UPPER(COALESCE(tipo_produto,'')) = 'LENTE INTRA OCULAR'
      OR UPPER(COALESCE(tipo_produto,'')) = 'SERVICO DE LIO'
    )`);
    if (state.ano) wheres.push(`substr(competencia,1,4) = '${state.ano}'`);
    if (state.mes) wheres.push(`substr(competencia,6,2) = '${state.mes}'`);

    const sql = `
      SELECT
        cod_admissao AS admissao, data_admissao, competencia,
        paciente, cod_paciente, tipo_produto, produto, convenio, plano,
        quantidade, valor, indicante, cirurgiao, medico, tipo_recebimento
      FROM linhas_producao
      WHERE ${wheres.join(' AND ')}
      ORDER BY valor DESC, cod_admissao
    `;
    try { return aplicarExcetoLio(Banco.query(sql)); }   // V645: EXCETO
    catch (e) { console.error('[LIO] erro Particular:', e); return []; }
  }

  // ───────────────────────────────────────────────────────────────────────
  // V645: EXCETO — termos que EXCLUEM produtos da classificação LIO.
  // Caso real: "SERVIÇO – DE IMPLANTE PRESERFLO" vem com TIPO PRODUTO
  // "SERVICO DE LIO" na Produção, mas PRESERFLO é implante de glaucoma, não
  // lente intraocular. O padrão "SERVIÇO – DE IMPLANTE" continua valendo;
  // produto cuja descrição contenha um termo cadastrado aqui é DESCONSIDERADO
  // da classificação LIO e sai da matriz do fichário (Particular e Convênio).
  // ───────────────────────────────────────────────────────────────────────
  let _excetoMemo = null;
  function excetoGarantirTabela() {
    try {
      Banco.executar(`CREATE TABLE IF NOT EXISTS lio_exceto_termos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, termo TEXT NOT NULL)`);
    } catch (_) {}
  }
  const _excetoNorm = (s) => String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
  function excetoListar() {
    excetoGarantirTabela();
    try { return Banco.query(`SELECT id, termo FROM lio_exceto_termos ORDER BY termo`) || []; }
    catch (_) { return []; }
  }
  function excetoTermosNorm() {
    if (_excetoMemo) return _excetoMemo;
    _excetoMemo = excetoListar().map(r => _excetoNorm(r.termo)).filter(Boolean);
    return _excetoMemo;
  }
  function aplicarExcetoLio(rows) {
    const termos = excetoTermosNorm();
    if (!termos.length || !rows || !rows.length) return rows || [];
    return rows.filter(l => {
      const prod = _excetoNorm(l.produto);
      if (!prod) return true;
      return !termos.some(t => prod.includes(t));
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // V129.14: Query da aba CONVÊNIO (fonte = QVIS + Produção via JOIN)
  // ───────────────────────────────────────────────────────────────────────
  function carregarLinhasLioConvenio() {
    // 1) Lê convênios flagados pra montar o filtro
    let flagados = [];
    try {
      const rows = Banco.query(`SELECT convenio FROM lio_convenios_flagados`);
      flagados = (rows || []).map(r => r.convenio).filter(Boolean);
    } catch (_) { /* tabela ainda não existe */ }

    if (flagados.length === 0) return [];  // sem flagados → matriz vazia

    // 2) Filtros mês/ano — V456: a aba CONVÊNIO passa a filtrar pelo MES_PAGAMENTO do QVIS (mês em que a
    //    admissão foi conciliada/importada no relatório), NÃO pela competência da Produção (que segue a
    //    data da admissão). Assim admissão feita em maio mas conciliada em junho conta em JUNHO.
    const wheresProd = [`lp.classificacao_produto = 'OPME'`];
    const wheresMesPgto = [];
    if (state.ano) wheresMesPgto.push(`substr(mes_pagamento,1,4) = '${state.ano}'`);
    if (state.mes) wheresMesPgto.push(`substr(mes_pagamento,6,2) = '${state.mes}'`);
    const filtroMesPgto = wheresMesPgto.length ? ' AND ' + wheresMesPgto.join(' AND ') : '';

    // 3) Filtros do QVIS dentro da sub-query agregada
    //    Aceita: prefix-match do nome flagado OR match-exato de qualquer alias salvo
    const escSql = (s) => String(s).replace(/'/g, "''");
    const condicoes = [];
    for (const f of flagados) {
      condicoes.push(`UPPER(COALESCE(convenio,'')) LIKE UPPER('${escSql(f)}') || '%'`);
    }
    // V129.15: adiciona aliases (match exato em UPPER)
    const todosAliases = listarTodosAliases();
    for (const al of todosAliases) {
      condicoes.push(`UPPER(COALESCE(convenio,'')) = UPPER('${escSql(al.convenio_qvis)}')`);
    }
    const likesFlag = condicoes.length > 0 ? condicoes.join(' OR ') : '1=0';

    // V129.17: Resolve as fontes ativas de cada coluna trocável
    const F = {
      data:      obterFonteAtiva('data'),
      admissao:  obterFonteAtiva('admissao'),
      paciente:  obterFonteAtiva('paciente'),
      tipo:      obterFonteAtiva('tipo'),
      convenio:  obterFonteAtiva('convenio'),
      produzido: obterFonteAtiva('produzido'),
    };

    const sql = `
      SELECT
        ${F.admissao.sql}          AS admissao,
        ${F.data.sql}              AS data_admissao,
        qvis.mes_pagamento         AS competencia,
        ${F.paciente.sql}          AS paciente,
        lp.cod_paciente            AS cod_paciente,
        ${F.tipo.sql}              AS tipo_produto,
        lp.produto                 AS produto,
        ${F.convenio.sql}          AS convenio,
        lp.plano                   AS plano,
        lp.quantidade              AS quantidade,
        ${F.produzido.sql}         AS produzido,
        qvis.recebido              AS recebido,
        ${F.produzido.sql}         AS valor,
        lp.indicante               AS indicante,
        lp.cirurgiao               AS cirurgiao,
        lp.medico                  AS medico,
        lp.tipo_recebimento        AS tipo_recebimento
      FROM linhas_producao lp
      INNER JOIN (
        SELECT
          admissao,
          MAX(data_admissao)  AS data_admissao,
          MAX(paciente)       AS paciente,
          MAX(procedimento)   AS procedimento,
          MAX(convenio)       AS convenio,
          MAX(mes_pagamento)  AS mes_pagamento,
          SUM(produzido)      AS produzido,
          SUM(recebido)       AS recebido
        FROM linhas_qvis
        WHERE UPPER(COALESCE(procedimento,'')) LIKE '%LIO%'
          AND UPPER(COALESCE(procedimento,'')) NOT LIKE '%TAXA DE MEDICO EXTERNO%'
          AND admissao IS NOT NULL AND admissao <> ''
          AND (${likesFlag})${filtroMesPgto}
        GROUP BY admissao
      ) qvis ON qvis.admissao = lp.cod_admissao
      WHERE ${wheresProd.join(' AND ')}
      ORDER BY ${F.produzido.sql} DESC, lp.cod_admissao
    `;
    try { return aplicarExcetoLio(Banco.query(sql)); }   // V645: EXCETO
    catch (e) { console.error('[LIO V129.14] erro Convênio:', e); return []; }
  }

  /**
   * Mapeia Tipo Produto → categoria macro (LIO MONOFOCAL, LIO TRIFOCAL, etc).
   * Usado pra agrupar produtos no painel Ajustes em hierarquia de 2 níveis:
   *   Macro (LIO MONOFOCAL) → Tipo (LIO MONOFOCAL ESFERICA) → Produtos.
   */
  function getMacroCategoria(tipoProduto) {
    const tp = String(tipoProduto || '').toUpperCase().trim();
    if (tp.startsWith('LIO MONOFOCAL')) return 'LIO MONOFOCAL';
    if (tp.startsWith('LIO TRIFOCAL'))  return 'LIO TRIFOCAL';
    if (tp.startsWith('LIO EDOF'))      return 'LIO EDOF';
    if (tp.startsWith('LIO BIFOCAL'))   return 'LIO BIFOCAL';
    if (tp.startsWith('LIO PREMIUM'))   return 'LIO PREMIUM';
    if (tp === 'LIO FACICA')            return 'LIO FACICA';
    if (tp === 'LENTE INTRA OCULAR')    return 'LENTE INTRA OCULAR';
    if (tp === 'SERVICO DE LIO')        return 'SERVICO DE LIO';
    return 'OUTROS';
  }

  /** Aplica os filtros separados (admissão, paciente, médico, cod_paciente, tipos, produtos). */
  function aplicarFiltros(linhas) {
    const f = state.filtros;
    const FM = Utilidades.filtroMulti;   // V922: marcar N itens = UNIÃO
    let r = linhas;
    if (FM.ativo(f.admissao)) r = r.filter(l => FM.casa(f.admissao, l.admissao));
    if (FM.ativo(f.paciente)) r = r.filter(l => FM.casa(f.paciente, l.paciente));
    if (FM.ativo(f.medico)) {
      const alvos = FM.sel(f.medico).map(t => String(t).trim().toLowerCase());
      r = r.filter(l => {
        const ind = String(l.indicante || '').toLowerCase();
        const exe = String(l.cirurgiao || '').toLowerCase();
        // V646: o combo exibe o nome do DE/PARA — casa também por ele
        const indDP = String(nomeCompletoMedicoLio(l.indicante) || '').toLowerCase();
        const exeDP = String(nomeCompletoMedicoLio(l.cirurgiao) || '').toLowerCase();
        return alvos.some(t => ind.includes(t) || exe.includes(t) || indDP.includes(t) || exeDP.includes(t));
      });
    }
    if (FM.ativo(f.cod_paciente)) r = r.filter(l => FM.casa(f.cod_paciente, l.cod_paciente));
    if (f.tipos && f.tipos.size > 0) {
      r = r.filter(l => f.tipos.has(l.tipo_produto || ''));
    }
    if (f.produtos && f.produtos.size > 0) {
      r = r.filter(l => f.produtos.has(l.produto || ''));
    }
    return r;
  }

  function filtrarProdutosExcluidos(linhas, cfg, fonte) {
    const conjunto = fonte === 'PARTICULAR' ? cfg.produtosExcluidosPart : cfg.produtosExcluidosConv;
    if (conjunto.size === 0) return linhas;
    return linhas.filter(l => !conjunto.has(l.produto || ''));
  }

  function listarCompetenciasDisponiveis() {
    const meses = new Set(), anos = new Set();
    try {
      const rows = Banco.query(`
        SELECT DISTINCT competencia
          FROM linhas_producao
         WHERE classificacao_produto = 'OPME'
           AND (
             UPPER(COALESCE(tipo_produto,'')) LIKE '%LIO%'
             OR UPPER(COALESCE(tipo_produto,'')) = 'LENTE INTRA OCULAR'
             OR UPPER(COALESCE(tipo_produto,'')) = 'SERVICO DE LIO'
           )
         ORDER BY competencia DESC
      `);
      for (const r of rows) {
        const c = String(r.competencia || '');
        if (c.length >= 7) { anos.add(c.substring(0,4)); meses.add(c.substring(5,7)); }
      }
    } catch (e) { console.warn(e); }
    return {
      meses: Array.from(meses).sort(),
      anos:  Array.from(anos).sort().reverse(),
    };
  }

  /** Lista todos os produtos LIO distintos (independente de filtros) — pra Ajustes */
  function listarTodosProdutosLio() {
    try {
      const rows = Banco.query(`
        SELECT DISTINCT produto, tipo_produto, COUNT(*) AS n, SUM(valor) AS total
          FROM linhas_producao
         WHERE classificacao_produto = 'OPME'
           AND produto IS NOT NULL AND produto <> ''
           AND (
             UPPER(COALESCE(tipo_produto,'')) LIKE '%LIO%'
             OR UPPER(COALESCE(tipo_produto,'')) = 'LENTE INTRA OCULAR'
             OR UPPER(COALESCE(tipo_produto,'')) = 'SERVICO DE LIO'
           )
         GROUP BY produto, tipo_produto
         ORDER BY tipo_produto, total DESC, produto
      `);
      return aplicarExcetoLio(rows);   // V645: EXCETO
    } catch (e) { console.warn(e); return []; }
  }

  // ───────────────────────────────────────────────────────────────────────
  // CÁLCULO DE REPASSE
  // ───────────────────────────────────────────────────────────────────────
  /**
   * Diz se uma linha tem a REGRA aplicada (ou seja, está "flegada" no painel
   * de Ajustes). Linhas com regra → vão pro relatório final.
   * Linhas sem regra → ficam na matriz pra visualização mas repasse = 0.
   */
  // ───────────────────────────────────────────────────────────────────────
  // V129.21: Identificação do OPME cadastrado a partir do nome do Produto
  //
  // Regra acordada:
  //   • Match: no mínimo 2 termos do padrão presentes no nome do Produto
  //     (em caso de múltiplos, vence o de MAIOR score = mais termos batendo)
  //   • Cadastro: só do MESMO convênio da linha (resolvendo alias → flagado)
  // ───────────────────────────────────────────────────────────────────────

  /** Resolve o convênio FLAGADO correspondente ao convênio de uma linha (via prefix ou alias). */
  function resolverConvenioFlagado(convenioLinha) {
    // V130: delega ao módulo compartilhado (1 fonte da verdade)
    return App.repasseLIO.resolverConvenioFlagado(convenioLinha);
  }

  /** Cache dos OPMEs cadastrados por convênio flagado (com seus termos). */
  function carregarOpmesCadastrados() {
    // V130: delega ao módulo compartilhado (1 fonte da verdade)
    return App.repasseLIO.carregarOpmesCadastrados();
  }

  /**
   * Identifica o OPME cadastrado que casa com o produto da linha.
   * Retorna { opme, valorLio, score, termosCasados } ou null.
   */
  function identificarOpmeCadastrado(produtoMatriz, convenioLinha) {
    // V130: delega ao módulo compartilhado (1 fonte da verdade)
    return App.repasseLIO.identificarOpmeCadastrado(produtoMatriz, convenioLinha);
  }

  /** Limpa os caches de identificação (chamar quando dados mudam). */
  function limparCachesIdentificacao() {
    App.repasseLIO.limparCaches();
  }

  function temRegraAplicada(l, cfg) {
    // V130: delega ao módulo compartilhado (1 fonte da verdade)
    return App.repasseLIO.temRegraAplicada(l, cfg);
  }

  /**
   * Cálculo por LINHA — delega ao módulo compartilhado (V130: 1 fonte da verdade).
   *   - CONVÊNIO: VALOR LIO cadastrado × 18% (+ 2,5% indicante quando ≠ e pagarIndicante)
   *   - PARTICULAR: cálculo sobre l.valor
   */
  function calcularRepasse(l, cfg) {
    // V492: memoização por render — a função é pura em (linha, cfg) e era
    // chamada ~6× por linha por render. O contador de geração é incrementado
    // no início de renderizar(); o resultado fica cacheado na própria linha.
    // A identidade do cfg também é checada: chamadas fora do render (ex.:
    // export, que lê um cfg novo) recalculam normalmente.
    const gen = window.__lioCalcGenV492 || 0;
    const c = l._calcV492;
    if (c && c.gen === gen && c.cfg === cfg) return c.valor;
    const valor = App.repasseLIO.calcularRepasseLinha(l, cfg);
    l._calcV492 = { gen, cfg, valor };
    return valor;
  }

  // ───────────────────────────────────────────────────────────────────────
  // HELPERS
  // ───────────────────────────────────────────────────────────────────────
  function fmt(v, casas = 2) {
    if (v == null || v === '' || isNaN(v)) return '0,00';
    return Number(v).toLocaleString('pt-BR', {
      minimumFractionDigits: casas, maximumFractionDigits: casas
    });
  }
  function formatarData(s) {
    if (!s) return '—';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s);
  }
  function escapeHTML(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function chaveLinha(l) {
    return `${l.admissao}|${l.produto}|${l.tipo_recebimento}`;
  }

  /**
   * Classifica uma linha LIO em duas categorias para os KPIs:
   *   - SERVICO_LIO: Tipo Produto = 'SERVICO DE LIO' (= serviço de implante
   *                  de LIO premium, sempre cobrado em PARTICULAR)
   *   - SEM_CLASSIFICACAO: demais — Tipo Produto LIO* ou LENTE INTRA OCULAR
   *
   * Uma admissão é classificada como "SERVICO DE LIO" se TIVER PELO MENOS UMA
   * linha com esse Tipo Produto, mesmo que tenha outras linhas de LIO/LENTE.
   * Categorias são mutuamente exclusivas por admissão.
   */
  function ehTipoServicoLio(tipoProduto) {
    return String(tipoProduto || '').toUpperCase().trim() === 'SERVICO DE LIO';
  }

  /** Formato compacto pra valores grandes (em pills): 1.36M, 478K */
  function fmtCompact(v) {
    v = Number(v) || 0;
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return (v / 1_000_000).toFixed(2).replace('.', ',') + 'M';
    if (abs >= 1_000)     return (v / 1_000).toFixed(1).replace('.', ',') + 'K';
    return v.toFixed(0);
  }

  // ───────────────────────────────────────────────────────────────────────
  // RENDER: HEADER
  // ───────────────────────────────────────────────────────────────────────
  // V493: coleta de valores únicos dos combos extraída de renderHeader pra ser
  // reutilizada pelo render incremental (atualizarHeaderFiltrosV493) sem duplicar lógica.
  // ───────────────────────────────────────────────────────────────────────
  // V646: DE/PARA DE NOMES do sistema (cadastro de médicos + sinônimos) —
  // o combo "Médico" dos filtros mostra o NOME COMPLETO e padronizado do
  // profissional; a busca continua casando também a grafia crua da Produção.
  // ───────────────────────────────────────────────────────────────────────
  let _deparaMedMemo = null, _deparaMedVersao = -1;
  const _normNomeLio = (s) => String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
  function deparaMedicoLio() {
    const v = (window.Banco && Banco._versao) || 0;
    if (_deparaMedMemo && _deparaMedVersao === v) return _deparaMedMemo;
    const m = new Map();
    try {
      const porId = new Map();
      (Banco.query(`SELECT id, nome_oficial, nome_normalizado FROM medicos`) || []).forEach(x => {
        if (!x.nome_oficial) return;
        m.set(_normNomeLio(x.nome_oficial), x.nome_oficial);
        if (x.nome_normalizado) m.set(_normNomeLio(x.nome_normalizado), x.nome_oficial);
        porId.set(x.id, x.nome_oficial);
      });
      (Banco.query(`SELECT grafia, grafia_normalizada, medico_id FROM sinonimos_medico`) || []).forEach(s => {
        const no = porId.get(s.medico_id);
        if (!no) return;
        if (s.grafia) m.set(_normNomeLio(s.grafia), no);
        if (s.grafia_normalizada) m.set(_normNomeLio(s.grafia_normalizada), no);
      });
    } catch (_) {}
    _deparaMedMemo = m; _deparaMedVersao = v;
    return m;
  }
  function nomeCompletoMedicoLio(nome) {
    if (!nome) return nome;
    return deparaMedicoLio().get(_normNomeLio(nome)) || nome;
  }

  function coletarValoresCombosV493(todasLinhasGlobais) {
    const setAdm = new Set(), setPac = new Set(), setMed = new Set(), setCodPac = new Set();
    for (const l of todasLinhasGlobais) {
      if (l.admissao) setAdm.add(l.admissao);
      if (l.paciente) setPac.add(l.paciente);
      // V646: nomes do combo Médico passam pelo de/para do sistema (nome completo)
      if (l.indicante) setMed.add(nomeCompletoMedicoLio(l.indicante));
      if (l.cirurgiao) setMed.add(nomeCompletoMedicoLio(l.cirurgiao));
      if (l.cod_paciente) setCodPac.add(l.cod_paciente);
    }
    return { admissao: setAdm, paciente: setPac, medico: setMed, cod_paciente: setCodPac };
  }

  // V493: há algum filtro ativo? (controla o botão "✕ Limpar" do header —
  // mesma condição no render completo e no incremental)
  function filtrosAtivosV493() {
    const FM = Utilidades.filtroMulti;   // V922
    return !!(FM.ativo(state.filtros.admissao) || FM.ativo(state.filtros.paciente)
      || FM.ativo(state.filtros.medico) || FM.ativo(state.filtros.cod_paciente)
      || state.filtros.tipos.size > 0 || state.filtros.produtos.size > 0);
  }

  // V493: templates mínimos compartilhados entre renderHeader (render completo)
  // e o caminho incremental — evita duplicação de markup.
  function renderBtnLimparFiltrosV493() {
    return `<button class="lio-btn-limpar-filtros" id="lio-btn-limpar-filtros" title="Limpar todos os filtros">✕ Limpar</button>`;
  }
  function renderBtnClearComboV493(campo) {
    return `<button class="lio-combo-clear" data-combo-clear="${campo}" tabindex="-1" title="Limpar">✕</button>`;
  }

  // ── V727: fileira de filtros 20C (mesmo padrão do OPME, com as
  // individualidades do LIO: Mês · Ano · Admissão · Paciente · Médico
  // (indicante ou executante) · Cód. Paciente). Painéis abrem/fecham LOCAL
  // (zero re-render); aplicar usa o caminho incremental (renderParcialFiltros).
  function _lioSbIc(nome) {
    return {
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      alignleft: '<line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/>',
      userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
      user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
      search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
      check: '<polyline points="20 6 9 17 4 12"/>',
      chev: '<polyline points="6 9 12 15 18 9"/>',
    }[nome] || '';
  }
  function _lioSbSvg(d, px, sw) {
    return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  function _lioSbSemAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function _lioSbIniciais(nome) {
    const p = String(nome || '').split(/\s+/).filter(w => w.length >= 3);
    return ((p[0] || ' ')[0] + ((p[1] || ' ')[0] || '')).toUpperCase().trim() || '–';
  }

  function renderBarraFiltrosLio20C(ctx) {
    // guarda as listas pro painel abrir LOCAL depois, sem recoletar
    state._sbOpcoes = {
      meses: ctx.meses, anos: ctx.anos,
      admissao: Array.from(ctx.sets.admissao).sort(),
      paciente: Array.from(ctx.sets.paciente).sort(),
      medico: Array.from(ctx.sets.medico).sort(),
      cod_paciente: Array.from(ctx.sets.cod_paciente).sort(),
    };
    const cel = (id, rotulo, valor, icone, flex, vazio = 'Todos') => {
      const ativo = !!valor;
      const estaAberta = state.sbAberto === id;
      return `
        <div class="lio-sb-celwrap" style="flex:${flex}">
          <button type="button" class="lio-sb-cel ${ativo ? 'ativo' : ''} ${estaAberta ? 'aberta' : ''}"
                  data-sb-cel="${id}" data-sb-vazio="${vazio}" role="combobox" aria-expanded="${estaAberta ? 'true' : 'false'}" aria-haspopup="listbox">
            <span class="lio-sb-tile">${_lioSbSvg(_lioSbIc(icone), 14, 2.1)}</span>
            <span class="lio-sb-tx">
              <span class="lio-sb-rot">${rotulo}</span>
              <span class="lio-sb-val">${escapeHTML(valor || vazio)}</span>
            </span>
            <span class="lio-sb-chev">${_lioSbSvg(_lioSbIc('chev'), 10, 2.8)}</span>
          </button>
          ${estaAberta ? painelLio20C(id) : ''}
        </div>`;
    };
    const mesLabel = state.mes ? (MESES_EXTENSO[parseInt(state.mes, 10) - 1] || state.mes) : '';
    // V922: rótulo dos filtros multi ("N selecionados")
    const FM = Utilidades.filtroMulti;
    const rotMulti = (f) => FM.ativo(f) ? FM.rotulo(f) : '';
    return `
      <div class="lio-sb" id="lio-sb">
        ${cel('mes', 'Mês', mesLabel, 'calendar', 0.8)}
        ${cel('ano', 'Ano', state.ano || '', 'clock', 0.75)}
        ${cel('admissao', 'Admissão', rotMulti(state.filtros.admissao), 'alignleft', 1.05, 'Todas')}
        ${cel('paciente', 'Paciente', rotMulti(state.filtros.paciente), 'user', 1.3)}
        ${cel('medico', 'Médico', rotMulti(state.filtros.medico), 'userplus', 1.35)}
        ${cel('cod_paciente', 'Cód. Paciente', rotMulti(state.filtros.cod_paciente), 'hash', 1.05)}
      </div>`;
  }

  function painelLio20C(id) {
    const opc = state._sbOpcoes || {};
    const item = (val, rotulo, sel, chip) => `
      <div class="lio-sb-it ${sel ? 'sel' : ''} ${val === '' ? 'lio-sb-it-todos' : ''}" data-sb-item data-val="${escapeHTML(val)}" data-busca="${escapeHTML(_lioSbSemAcento(rotulo))}" role="option" aria-selected="${sel ? 'true' : 'false'}">
        ${chip ? `<span class="lio-sb-chip">${escapeHTML(_lioSbIniciais(rotulo))}</span>` : ''}
        <span class="lio-sb-it-nome">${escapeHTML(rotulo)}</span>
        ${sel ? `<span class="lio-sb-ck">${_lioSbSvg(_lioSbIc('check'), 14, 2.5)}</span>` : ''}
      </div>`;
    const painelLista = (cel, opcoes, valAtual, { busca = false, chips = false, todosRotulo = 'Todos', hint = '' } = {}) => `
      <div class="lio-sb-painel" data-sb-painel="${cel}">
        ${busca ? `
          <div class="lio-sb-buscabox">
            <span class="lio-sb-busca-ic">${_lioSbSvg(_lioSbIc('search'), 15, 2.1)}</span>
            <input type="text" class="lio-sb-busca" data-sb-busca placeholder="${hint || 'Digite pra buscar'}" autocomplete="off">
          </div>` : ''}
        <div class="lio-sb-lista" role="listbox">
          ${item('', todosRotulo, !valAtual)}
          ${opcoes.slice(0, 400).map(o => item(o, o, valAtual === o, chips)).join('')}
        </div>
        ${busca ? `<div class="lio-sb-rodape" data-sb-contagem>${opcoes.length} opç${opcoes.length === 1 ? 'ão' : 'ões'}</div>` : ''}
      </div>`;
    if (id === 'mes') return painelLista('mes', (opc.meses || []).map(m => MESES_EXTENSO[parseInt(m, 10) - 1] || m), state.mes ? (MESES_EXTENSO[parseInt(state.mes, 10) - 1] || state.mes) : '');
    if (id === 'ano') return painelLista('ano', opc.anos || [], state.ano || '');
    // V922: combos MULTI — checkbox por item, marcados no topo, busca sempre
    const FM = Utilidades.filtroMulti;
    const painelMulti = (cel, opcoes, f, extra = {}) => {
      const sel = FM.sel(f);
      const marcadas = opcoes.filter(o => sel.includes(String(o)));
      const demais = opcoes.filter(o => !sel.includes(String(o)));
      return `
      <div class="lio-sb-painel" data-sb-painel="${cel}" data-sb-multi="1">
        <div class="lio-sb-buscabox">
          <span class="lio-sb-busca-ic">${_lioSbSvg(_lioSbIc('search'), 15, 2.1)}</span>
          <input type="text" class="lio-sb-busca" data-sb-busca placeholder="${extra.hint || 'Digite pra buscar'}" autocomplete="off">
        </div>
        <div class="lio-sb-lista" role="listbox">
          ${item('', extra.todosRotulo || 'Todos', sel.length === 0)}
          ${[...marcadas, ...demais].slice(0, 400).map(o => item(o, o, sel.includes(String(o)), extra.chips)).join('')}
        </div>
        <div class="lio-sb-rodape" data-sb-contagem>${sel.length ? `${sel.length} selecionado${sel.length === 1 ? '' : 's'} · ` : ''}${opcoes.length} opç${opcoes.length === 1 ? 'ão' : 'ões'}</div>
      </div>`;
    };
    if (id === 'admissao') return painelMulti('admissao', opc.admissao || [], state.filtros.admissao, { todosRotulo: 'Todas' });
    if (id === 'paciente') return painelMulti('paciente', opc.paciente || [], state.filtros.paciente);
    if (id === 'medico') return painelMulti('medico', opc.medico || [], state.filtros.medico, { chips: true, hint: 'Indicante ou executante...' });
    return painelMulti('cod_paciente', opc.cod_paciente || [], state.filtros.cod_paciente);
  }

  function bindBarraFiltrosLio20C() {
    const sb = document.getElementById('lio-sb');
    if (!sb) return;
    const fecharPainelLocal = () => {
      sb.querySelectorAll('.lio-sb-painel').forEach(p => p.remove());
      sb.querySelectorAll('.lio-sb-cel.aberta').forEach(c => { c.classList.remove('aberta'); c.setAttribute('aria-expanded', 'false'); });
      state.sbAberto = null;
    };
    const atualizarCels = () => {
      const FM = Utilidades.filtroMulti;   // V922
      const rot = (f) => FM.ativo(f) ? FM.rotulo(f) : '';
      const vals = {
        mes: state.mes ? (MESES_EXTENSO[parseInt(state.mes, 10) - 1] || state.mes) : '',
        ano: state.ano || '',
        admissao: rot(state.filtros.admissao),
        paciente: rot(state.filtros.paciente),
        medico: rot(state.filtros.medico),
        cod_paciente: rot(state.filtros.cod_paciente),
      };
      sb.querySelectorAll('[data-sb-cel]').forEach(btn => {
        const v = vals[btn.dataset.sbCel];
        btn.classList.toggle('ativo', !!v);
        btn.querySelector('.lio-sb-val').textContent = v || btn.dataset.sbVazio || 'Todos';
      });
    };
    const aplicar = (celId, val) => {
      if (celId === 'mes') {
        const idx = MESES_EXTENSO.findIndex(m => m === val);
        state.mes = (val && idx >= 0) ? String(idx + 1).padStart(2, '0') : null;
      } else if (celId === 'ano') state.ano = val || null;
      else {
        // V922: combos viraram MULTI — alterna e re-abre o painel marcado
        const FM = Utilidades.filtroMulti;
        const buscaEl = sb.querySelector('[data-sb-busca]');
        state._sbBusca = buscaEl ? buscaEl.value : '';
        state.filtros[celId] = val === '' ? [] : FM.toggle(state.filtros[celId], val);
        const aberto = state.sbAberto;
        fecharPainelLocal();
        atualizarCels();
        if (!renderParcialFiltros()) { state.sbAberto = aberto; renderizar(); return; }
        // reabre o painel local já com as marcações novas
        state.sbAberto = aberto;
        const btn = sb.querySelector(`[data-sb-cel="${aberto}"]`);
        if (btn) {
          btn.classList.add('aberta');
          btn.setAttribute('aria-expanded', 'true');
          btn.parentElement.insertAdjacentHTML('beforeend', painelLio20C(aberto));
          wireInputsPainel();
        }
        return;
      }
      state._sbBusca = '';
      fecharPainelLocal();
      atualizarCels();
      if (!renderParcialFiltros()) renderizar();
    };
    const wireInputsPainel = () => {
      const busca = sb.querySelector('[data-sb-busca]');
      if (!busca) return;
      setTimeout(() => busca.focus(), 0);
      const filtrar = () => {
        const q = _lioSbSemAcento(busca.value);
        const painel = busca.closest('.lio-sb-painel');
        let n = 0;
        painel.querySelectorAll('[data-sb-item]').forEach(el => {
          const mostra = el.classList.contains('lio-sb-it-todos') || el.classList.contains('sel') || !q || (el.dataset.busca || '').includes(q);
          el.style.display = mostra ? '' : 'none';
          if (mostra && !el.classList.contains('lio-sb-it-todos')) n++;
        });
        const cont = painel.querySelector('[data-sb-contagem]');
        if (cont) cont.textContent = `${n} opç${n === 1 ? 'ão' : 'ões'}`;
      };
      busca.addEventListener('input', filtrar);
      if (state._sbBusca) { busca.value = state._sbBusca; filtrar(); }   // V922
    };
    const abrirPainelLocal = (id) => {
      const jaAberto = state.sbAberto === id;
      fecharPainelLocal();
      state._sbBusca = '';   // V922: busca não vaza de um painel pro outro
      if (jaAberto) return;
      state.sbAberto = id;
      const btn = sb.querySelector(`[data-sb-cel="${id}"]`);
      btn.classList.add('aberta');
      btn.setAttribute('aria-expanded', 'true');
      btn.parentElement.insertAdjacentHTML('beforeend', painelLio20C(id));
      wireInputsPainel();
    };
    // V922: o painel pode vir aberto do template (re-render após marcar)
    if (state.sbAberto && sb.querySelector('.lio-sb-painel')) wireInputsPainel();
    sb.addEventListener('click', (e) => {
      const it = e.target.closest('[data-sb-item]');
      if (it) {
        e.stopPropagation();
        aplicar(it.closest('[data-sb-painel]').dataset.sbPainel, it.dataset.val);
        return;
      }
      const celBtn = e.target.closest('[data-sb-cel]');
      if (celBtn) { e.stopPropagation(); abrirPainelLocal(celBtn.dataset.sbCel); return; }
      e.stopPropagation();
    });
    sb.addEventListener('keydown', (e) => {
      if (!state.sbAberto) return;
      const painel = sb.querySelector('.lio-sb-painel');
      if (!painel) return;
      const its = [...painel.querySelectorAll('[data-sb-item]')].filter(el => el.style.display !== 'none');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        let i = its.findIndex(x => x.classList.contains('foco'));
        its.forEach(x => x.classList.remove('foco'));
        i = e.key === 'ArrowDown' ? Math.min(its.length - 1, i + 1) : Math.max(0, i - 1);
        if (its[i]) { its[i].classList.add('foco'); its[i].scrollIntoView({ block: 'nearest' }); }
      } else if (e.key === 'Enter') {
        const f = its.find(x => x.classList.contains('foco'));
        if (f) { e.preventDefault(); aplicar(painel.dataset.sbPainel, f.dataset.val); }
      }
    });
    if (window.__lioSbFechar) {
      document.removeEventListener('click', window.__lioSbFechar);
      document.removeEventListener('keydown', window.__lioSbEsc);
    }
    const fecharFora = (e) => {
      if (App.telaAtual !== 'desempenho-lio') return;
      if (state.sbAberto && !e.target.closest('#lio-sb')) fecharPainelLocal();
    };
    const escFecha = (e) => { if (e.key === 'Escape' && state.sbAberto) fecharPainelLocal(); };
    window.__lioSbFechar = fecharFora;
    window.__lioSbEsc = escFecha;
    document.addEventListener('click', fecharFora);
    document.addEventListener('keydown', escFecha);
    if (state.sbAberto) wireInputsPainel();
  }

  function renderHeader(cfg, todasLinhasGlobais) {
    const { meses, anos } = listarCompetenciasDisponiveis();

    // Coleta valores únicos pros datalists (autocomplete)
    // V493: coleta extraída pra coletarValoresCombosV493 (reuso no incremental)
    const setsCombos = coletarValoresCombosV493(todasLinhasGlobais);
    const setAdm = setsCombos.admissao, setPac = setsCombos.paciente,
          setMed = setsCombos.medico,   setCodPac = setsCombos.cod_paciente;

    const opcoesDatalist = (set, limite = 200) => {
      return Array.from(set).sort().slice(0, limite)
        .map(v => `<option value="${escapeHTML(v)}">`).join('');
    };

    // Helper: renderiza combobox customizado (input + dropdown estilizado)
    const renderCombo = (campo, label, valor, valoresSet, mono = false, placeholder = 'Buscar...') => {
      const id = `lio-filt-${campo}`;
      const valoresOrdenados = Array.from(valoresSet).sort();
      const aberto = state.dropdownAberto === campo;
      return `
        <div class="lio-filt-wrap lio-combo atlas-ff-combo" data-combo="${campo}">
          <span class="atlas-ff-pre">${label}</span><span class="atlas-ff-divr"></span>
          <input type="text" id="${id}"
                 class="lio-filt-input lio-combo-input ${mono ? 'mono' : ''}"
                 placeholder="${placeholder}"
                 value="${escapeHTML(valor)}"
                 data-campo="${campo}"
                 autocomplete="off">
          <button class="lio-combo-arrow ${aberto ? 'lio-combo-arrow-aberto' : ''}"
                  data-combo-arrow="${campo}" tabindex="-1" title="Ver opções"><i class="ti ti-chevron-down"></i></button>
          ${valor ? renderBtnClearComboV493(campo) : ''}
          ${aberto ? renderDropdown(campo, valoresOrdenados, valor) : ''}
        </div>
      `;
    };

    return `
      <header class="page-header lio-page-header">
        <div class="lio-page-header-esq">
          <div class="lio-titulo-wrap">
            <h2>LIO</h2>
            <button class="lio-btn-info ${state.regrasAberto ? 'lio-btn-info-ativo' : ''}"
                    id="lio-btn-info"
                    title="Regras de repasse e critério de elegibilidade">ⓘ</button>
          </div>
          ${state.regrasAberto ? `
            <div class="lio-popover-regras">
              <div class="lio-popover-regras-head">
                <strong>Regras LIO</strong>
                <button class="lio-popover-regras-close" id="lio-popover-regras-close">✕</button>
              </div>
              <div class="lio-popover-regras-body">
                <p>
                  <strong>Cruzamento da Produção</strong> · Filtra
                  <code>OPME</code> + tipo
                  <code>LIO</code> / <code>LENTE INTRA OCULAR</code> / <code>SERVICO DE LIO</code>.
                </p>
                <p>
                  <strong>Repasse</strong>:
                  <strong>${fmt(cfg.pctExecutante)}%</strong> executante
                  + <strong>${fmt(cfg.pctIndicante)}%</strong> indicante quando ≠ executante.
                </p>
              </div>
            </div>
          ` : ''}
        </div>
        <div class="lio-page-header-dir">
          ${state.aba === 'CONVENIO' ? `
            <button class="btn lio-btn-teste" id="lio-btn-inserir-teste"
                    title="Inserir uma linha de teste manual pra validar a regra">
              🧪 Inserir teste
            </button>
          ` : ''}
          <label class="lio-chk-header" title="Esconde a coluna 'Repasse' e os totais">
            <input type="checkbox" id="lio-chk-ocultar-repasse" ${cfg.ocultarRepasse ? 'checked' : ''}>
            <span>Ocultar R$ Repasse</span>
          </label>
          <button class="btn lio-btn-exportar" id="lio-btn-exportar" title="Exportar para Excel">
            ↓ Exportar Excel <span style="font-size: 9px; margin-left: 2px">▾</span>
          </button>
          <button class="btn ${state.ajustesAberto ? 'btn-primary' : ''}" id="lio-btn-ajustes">
            ⚙ ${escapeHTML(getRotLio('titulo_ajustes'))}
          </button>
        </div>
      </header>
      <!-- V730: a fileira 20C é IRMÃ do header (como no OPME) — estica de
           ponta a ponta, alinhada com o conteúdo -->
      <div class="lio-filtros-bar">
        ${renderBarraFiltrosLio20C({ meses, anos, sets: setsCombos })}
        ${filtrosAtivosV493() ? renderBtnLimparFiltrosV493() : ''}
      </div>
    `;
  }

  /** Render do dropdown customizado dentro de um combobox. */
  function renderDropdown(campo, valoresOrdenados, valorAtual) {
    const busca = (valorAtual || '').trim().toLowerCase();
    const filtrados = busca
      ? valoresOrdenados.filter(v => String(v).toLowerCase().includes(busca))
      : valoresOrdenados;

    if (filtrados.length === 0) {
      return `
        <div class="lio-combo-dropdown" data-dropdown="${campo}">
          <div class="lio-combo-vazio">Nenhuma opção encontrada.</div>
        </div>
      `;
    }
    const MAX = 200;
    const exibidos = filtrados.slice(0, MAX);
    const sobram = filtrados.length - exibidos.length;
    return `
      <div class="lio-combo-dropdown" data-dropdown="${campo}">
        ${exibidos.map(v => `
          <div class="lio-combo-opt ${v === valorAtual ? 'lio-combo-opt-selecionado' : ''}"
               data-combo-opt="${escapeHTML(v)}"
               data-combo-campo="${campo}">${escapeHTML(v)}</div>
        `).join('')}
        ${sobram > 0
          ? `<div class="lio-combo-vazio">+${sobram} resultado(s) — refine a busca</div>`
          : ''}
      </div>
    `;
  }

  // ───────────────────────────────────────────────────────────────────────
  // RENDER: PAINEL DE AJUSTES
  // ───────────────────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────
  // V129.7: RENDER do drilldown de OPMEs de um convênio
  // Tabela editável: checkbox ativo, Produto, Valor LIO, Valor FACO, Padrão de busca
  // ───────────────────────────────────────────────────────────────────────
  function renderDrilldownOpmes(convenio) {
    let opmes = [];
    try {
      opmes = Banco.query(
        `SELECT id, produto, valor_lio, valor_faco, padrao_busca, padrao_customizado, ativo
           FROM lio_opme_tabela
          WHERE convenio = ?
          ORDER BY ativo DESC, produto ASC`,
        [convenio]
      );
    } catch (e) {
      console.warn('[LIO V129.7] renderDrilldownOpmes erro:', e);
      return '';
    }

    if (opmes.length === 0) return '';

    const ativos = opmes.filter(o => o.ativo).length;
    const termosConsolidados = consolidarTermosDoConvenio(convenio);
    const consolidadoExpandido = state.consolidadoAberto && state.consolidadoAberto.has(convenio);

    return `
      <div class="lio-conv-drilldown">
        <div class="lio-conv-drilldown-head">
          <span class="lio-conv-drilldown-stat">
            <strong>${ativos}</strong> / ${opmes.length} OPMEs ativos
          </span>
          <button class="lio-conv-consolidado-btn ${consolidadoExpandido ? 'lio-conv-consolidado-btn-aberto' : ''}"
                  data-conv-consolidado="${escapeHTML(convenio)}"
                  title="Ver todos os termos únicos usados nesse convênio">
            🏷️ Termos consolidados <span class="lio-conv-consolidado-badge">${termosConsolidados.length}</span>
            <span class="lio-conv-consolidado-seta">${consolidadoExpandido ? '▴' : '▾'}</span>
          </button>
          <span class="lio-conv-drilldown-help">
            Desmarque pra inativar · Edite valor LIO/FACO clicando no campo
          </span>
        </div>

        ${consolidadoExpandido ? `
          <div class="lio-conv-consolidado-painel">
            <div class="lio-conv-consolidado-painel-head">
              <strong>🏷️ Consolidado de termos usados</strong>
              <small>${termosConsolidados.length} termos únicos · click no <strong>✕</strong> pra remover de <strong>TODAS</strong> as linhas onde aparece</small>
            </div>
            <div class="lio-conv-consolidado-chips">
              ${termosConsolidados.length === 0 ? `
                <span class="lio-conv-consolidado-vazio">Nenhum termo cadastrado</span>
              ` : termosConsolidados.map(({ termo, n }) => `
                <span class="lio-conv-consolidado-chip">
                  <span class="lio-conv-consolidado-chip-texto">${escapeHTML(termo)}</span>
                  <span class="lio-conv-consolidado-chip-count">×${n}</span>
                  <button class="lio-conv-consolidado-chip-remover"
                          data-conv-consolidado-remover="${escapeHTML(convenio)}"
                          data-termo="${escapeHTML(termo)}"
                          title="Remover '${escapeHTML(termo)}' de TODAS as ${n} linha(s)">✕</button>
                </span>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="lio-conv-tabela-wrap">
          <table class="lio-conv-tabela">
            <thead>
              <tr>
                <th class="lio-conv-th-check">Ativo</th>
                <th>Produto</th>
                <th class="lio-conv-th-valor">Valor LIO</th>
                <th class="lio-conv-th-valor">Valor FACO</th>
                <th>Padrão de busca</th>
              </tr>
            </thead>
            <tbody>
              ${opmes.map(o => {
                const padrao = o.padrao_customizado || o.padrao_busca || '';
                return `
                  <tr class="${o.ativo ? '' : 'lio-conv-tabela-row-inativo'}">
                    <td class="lio-conv-td-check">
                      <input type="checkbox"
                             class="lio-conv-opme-check"
                             data-opme-id="${o.id}"
                             ${o.ativo ? 'checked' : ''}>
                    </td>
                    <td class="lio-conv-tabela-produto" title="${escapeHTML(o.produto)}">${escapeHTML(o.produto)}</td>
                    <td class="lio-conv-td-valor">
                      <input type="number"
                             class="lio-conv-opme-valor mono"
                             data-opme-id="${o.id}"
                             data-campo="valor_lio"
                             value="${Number(o.valor_lio).toFixed(2)}"
                             step="0.01" min="0">
                    </td>
                    <td class="lio-conv-td-valor">
                      <input type="number"
                             class="lio-conv-opme-valor mono"
                             data-opme-id="${o.id}"
                             data-campo="valor_faco"
                             value="${Number(o.valor_faco).toFixed(2)}"
                             step="0.01" min="0">
                    </td>
                    <td class="lio-conv-td-padrao">
                      <div class="lio-conv-padrao-chips">
                        ${lerTermosDoOpme(o).map((termo, i) => {
                          const emEdicao = state.editandoChip
                                        && state.editandoChip.idOpme === o.id
                                        && state.editandoChip.indice === i;
                          if (emEdicao) {
                            return `
                              <input type="text"
                                     class="lio-conv-chip-edit-input"
                                     data-opme-id="${o.id}"
                                     data-indice="${i}"
                                     value="${escapeHTML(termo)}"
                                     maxlength="60">
                            `;
                          }
                          return `
                            <span class="lio-conv-chip-termo">
                              <span class="lio-conv-chip-texto"
                                    data-opme-id="${o.id}"
                                    data-indice="${i}"
                                    title="Click pra editar este termo">${escapeHTML(termo)}</span>
                              <button class="lio-conv-chip-remover"
                                      data-opme-id="${o.id}"
                                      data-indice="${i}"
                                      title="Remover este termo">✕</button>
                            </span>
                          `;
                        }).join('')}
                        ${state.adicionandoPadrao === o.id ? `
                          <input type="text"
                                 class="lio-conv-padrao-novo-input"
                                 data-opme-id="${o.id}"
                                 placeholder="Novo termo..."
                                 maxlength="60">
                        ` : `
                          <button class="lio-conv-chip-add"
                                  data-opme-id="${o.id}"
                                  title="Adicionar novo termo ao padrão (todos os termos valem como match)">
                            + Adicionar termo
                          </button>
                        `}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ───────────────────────────────────────────────────────────────────────
  // V129.4: RENDER da seção "Convênios Elegíveis" — busca + chips dos flagados
  // ───────────────────────────────────────────────────────────────────────
  function renderBuscaConvenios() {
    const conveniosQvis = listarConveniosDoQvis();
    const flagados = listarConveniosFlagados();
    const flagSet = new Set(flagados.map(f => f.convenio));

    // V492: 1 query agregada (GROUP BY) em vez de contarOpmesDoConvenio()
    // por convênio flagado dentro do loop de render abaixo. Resultado idêntico.
    const statsOpmePorConv = new Map();
    if (flagados.length > 0) {
      try {
        const rowsStat = Banco.query(
          `SELECT convenio, COUNT(*) AS n, MAX(importado_em) AS ult
           FROM lio_opme_tabela GROUP BY convenio`
        );
        for (const r of (rowsStat || [])) statsOpmePorConv.set(r.convenio, { n: r.n, ult: r.ult });
      } catch (_) { /* sem tabela → todos caem no fallback {n:0, ult:null} */ }
    }

    // Filtra resultado da busca pelo texto digitado (case-insensitive)
    const termo = String(state.convBusca || '').trim().toUpperCase();
    const resultados = termo
      ? conveniosQvis.filter(c => String(c.convenio).toUpperCase().includes(termo))
      : conveniosQvis;

    const visiveis = resultados.slice(0, 30);

    return `
      <div class="lio-conv-busca-wrap" data-conv-busca>
        <div class="lio-conv-busca-input-wrap">
          <span class="lio-conv-busca-icon">🔍</span>
          <input type="text"
                 class="lio-conv-busca-input"
                 id="lio-conv-busca"
                 value="${escapeHTML(state.convBusca || '')}"
                 placeholder="Buscar convênio no QVIS..."
                 autocomplete="off">
          ${state.convBusca ? `<button class="lio-conv-busca-clear" id="lio-conv-busca-clear" title="Limpar">✕</button>` : ''}
        </div>

        ${state.convDropdownAberto ? `
          <div class="lio-conv-busca-dropdown">
            ${visiveis.length === 0
              ? `<div class="lio-conv-busca-vazio">Nenhum convênio encontrado no QVIS${termo ? ` para "${escapeHTML(termo)}"` : ''}.</div>`
              : visiveis.map(c => {
                const jaFlagado = flagSet.has(c.convenio);
                return `
                  <label class="lio-conv-busca-item ${jaFlagado ? 'lio-conv-busca-item-flagado' : ''}"
                         data-conv-flagar="${escapeHTML(c.convenio)}">
                    <input type="checkbox"
                           class="lio-conv-busca-check"
                           ${jaFlagado ? 'checked' : ''}
                           data-conv-check="${escapeHTML(c.convenio)}">
                    <div class="lio-conv-busca-item-info">
                      <strong>${escapeHTML(c.convenio)}</strong>
                      <small>${c.n_linhas} linhas · última competência: ${escapeHTML(c.ult_comp || '—')}</small>
                    </div>
                  </label>
                `;
              }).join('')}
            ${resultados.length > 30
              ? `<div class="lio-conv-busca-mais">+ ${resultados.length - 30} resultados ocultos · refine a busca</div>`
              : ''}
          </div>
        ` : ''}
      </div>

      ${flagados.length > 0 ? `
        <div class="lio-conv-flagados-titulo">
          🏥 Convênios fixados <span class="lio-conv-flagados-contador">${flagados.length}</span>
        </div>
        <div class="lio-conv-flagados-lista">
          ${flagados.map(f => {
            const stat = statsOpmePorConv.get(f.convenio) || { n: 0, ult: null };  // V492: era 1 query por convênio
            const temTabela = stat.n > 0;
            const expandido = state.convExpandidos && state.convExpandidos.has(f.convenio);
            return `
              <div class="lio-conv-flagado-card ${temTabela ? '' : 'lio-conv-flagado-sem-tabela'}">
                <div class="lio-conv-flagado-head" ${temTabela ? `data-conv-toggle="${escapeHTML(f.convenio)}"` : ''}>
                  ${temTabela ? `<span class="lio-conv-flagado-seta">${expandido ? '▾' : '▸'}</span>` : '<span class="lio-conv-flagado-seta-vazio"></span>'}
                  <div class="lio-conv-flagado-info">
                    <strong>${escapeHTML(f.convenio)}</strong>
                    <small>${
                      temTabela
                        ? `✓ ${stat.n} OPMEs importados · último: ${escapeHTML(String(stat.ult || '').slice(0, 10))}`
                        : '⚠ Sem tabela importada'
                    }</small>
                  </div>
                  <div class="lio-conv-flagado-acoes">
                    ${temTabela ? `
                      <button class="lio-conv-flagado-excluir-tabela"
                              data-conv-excluir-tabela="${escapeHTML(f.convenio)}"
                              title="Excluir TODOS os OPMEs importados deste convênio (mantém o convênio flagado)">
                        Excluir importação
                      </button>
                    ` : ''}
                    <button class="lio-conv-flagado-importar"
                            data-conv-importar="${escapeHTML(f.convenio)}"
                            title="${temTabela ? 'Re-importar planilha (INSERT-ONLY: linhas existentes serão ignoradas)' : 'Importar planilha de OPMEs'}">
                      ${temTabela ? '↻ Re-importar' : '↑ Importar planilha'}
                    </button>
                    <button class="lio-conv-flagado-remover" data-conv-desflagar="${escapeHTML(f.convenio)}"
                            title="Remover dos flagados">✕</button>
                  </div>
                </div>
                ${expandido && temTabela ? renderDrilldownOpmes(f.convenio) : ''}
              </div>
            `;
          }).join('')}
        </div>
      ` : `
        <div class="lio-conv-flagados-vazio">
          Nenhum convênio fixado ainda. Use a busca acima pra adicionar.
        </div>
      `}
    `;
  }

  function renderPainelAjustes(cfg) {
    if (!state.ajustesAberto) return '';

    // Carrega todos os produtos LIO da Produção
    const produtos = listarTodosProdutosLio();

    // ── Lista de produtos por fonte pagadora (Convênio / Particular) ──
    // Pra cada produto, descobrimos se ele aparece em CONVÊNIO/PARTICULAR
    let prodPorFonte = { CONVENIO: [], PARTICULAR: [] };
    try {
      const rows = Banco.query(`
        SELECT
          produto, tipo_produto, tipo_recebimento,
          COUNT(*) AS n, SUM(valor) AS total
        FROM linhas_producao
        WHERE classificacao_produto = 'OPME'
          AND produto IS NOT NULL AND produto <> ''
          AND (
            UPPER(COALESCE(tipo_produto,'')) LIKE '%LIO%'
            OR UPPER(COALESCE(tipo_produto,'')) = 'LENTE INTRA OCULAR'
            OR UPPER(COALESCE(tipo_produto,'')) = 'SERVICO DE LIO'
          )
        GROUP BY produto, tipo_produto, tipo_recebimento
        ORDER BY tipo_produto, total DESC
      `);
      for (const r of aplicarExcetoLio(rows)) {   // V645: EXCETO
        const tp = String(r.tipo_recebimento || '').toUpperCase();
        if (tp === 'CONVÊNIO' || tp === 'CONVENIO') {
          prodPorFonte.CONVENIO.push(r);
        } else if (tp === 'PARTICULAR') {
          prodPorFonte.PARTICULAR.push(r);
        }
      }
    } catch (e) { console.warn(e); }

    // V129.2: Quando aba pai = PARTICULAR, força sub-aba dos produtos
    // pra PARTICULAR (Convênio agora é outra aba pai isolada)
    const _paiAbaPreCalc = state.ajustesPaiAba || 'PARTICULAR';
    if (_paiAbaPreCalc === 'PARTICULAR') {
      state.ajustesAba = 'PARTICULAR';
    }

    const fonteAtiva = state.ajustesAba || 'CONVENIO';
    const listaFonte = prodPorFonte[fonteAtiva] || [];
    const conjuntoExcluidos = fonteAtiva === 'PARTICULAR' ? cfg.produtosExcluidosPart : cfg.produtosExcluidosConv;

    // Agrupar por MACRO → TIPO → PRODUTOS
    const porMacro = new Map();
    for (const p of listaFonte) {
      const macro = getMacroCategoria(p.tipo_produto);
      if (!porMacro.has(macro)) porMacro.set(macro, new Map());
      const porTipo = porMacro.get(macro);
      const tipo = p.tipo_produto || '— sem tipo —';
      if (!porTipo.has(tipo)) porTipo.set(tipo, []);
      porTipo.get(tipo).push(p);
    }

    // Stats globais
    const totalProdutos = listaFonte.length;
    const totalExcluidos = listaFonte.filter(p => conjuntoExcluidos.has(p.produto)).length;
    const totalIncluidos = totalProdutos - totalExcluidos;

    // ── Render da árvore ──
    let listaHtml = '';
    for (const [macro, porTipo] of porMacro) {
      const macroAberta = state.macrosAbertas.has(`${fonteAtiva}|${macro}`);
      const produtosNaMacro = [];
      let totalMacro = 0;
      let incluidosMacro = 0;
      for (const [, prods] of porTipo) {
        for (const p of prods) {
          produtosNaMacro.push(p);
          totalMacro += Number(p.total) || 0;
          if (!conjuntoExcluidos.has(p.produto)) incluidosMacro++;
        }
      }

      listaHtml += `
        <div class="lio-aj-macro">
          <div class="lio-aj-macro-head">
            <button class="lio-aj-macro-toggle" data-macro="${escapeHTML(macro)}" data-fonte="${fonteAtiva}">
              <span class="lio-aj-macro-arrow">${macroAberta ? '▾' : '▸'}</span>
              <strong>${escapeHTML(macro)}</strong>
              <span class="lio-aj-macro-chips">
                <span class="lio-aj-chip lio-aj-chip-qtd" title="${incluidosMacro} produto(s) ativo(s) de ${produtosNaMacro.length} disponível(is)">
                  <strong>${incluidosMacro}</strong>/${produtosNaMacro.length} ativos
                </span>
                <span class="lio-aj-chip lio-aj-chip-valor mono" title="Soma total do valor produzido">
                  R$ ${fmt(totalMacro)}
                </span>
              </span>
            </button>
            <button class="lio-aj-todos" data-macro="${escapeHTML(macro)}" data-fonte="${fonteAtiva}" data-acao="todos">Marcar</button>
            <button class="lio-aj-todos" data-macro="${escapeHTML(macro)}" data-fonte="${fonteAtiva}" data-acao="nenhum">Desmarcar</button>
          </div>
          ${macroAberta ? renderTiposDaMacro(porTipo, conjuntoExcluidos, fonteAtiva, macro) : ''}
        </div>
      `;
    }

    // ──────────────────────────────────────────────────────────────────
    // V129: PAINEL Ajustes dividido em 2 abas pai: PARTICULAR e CONVÊNIO
    // A aba PARTICULAR preserva 100% da estrutura atual.
    // A aba CONVÊNIO traz a nova lógica (placeholders nas V130-V133).
    // ──────────────────────────────────────────────────────────────────
    const paiAba = state.ajustesPaiAba || 'PARTICULAR';

    const headerAbasPai = `
      <div class="lio-aj-pai-tabs">
        <button class="lio-aj-pai-tab ${paiAba === 'CONVENIO' ? 'lio-aj-pai-tab-ativa' : ''}"
                data-pai-aba="CONVENIO">
          🏥 Convênio
        </button>
        <button class="lio-aj-pai-tab ${paiAba === 'PARTICULAR' ? 'lio-aj-pai-tab-ativa' : ''}"
                data-pai-aba="PARTICULAR">
          💼 Particular
        </button>
        <button class="lio-aj-pai-tab ${paiAba === 'ADICIONAL' ? 'lio-aj-pai-tab-ativa' : ''}"
                data-pai-aba="ADICIONAL"
                title="Padrões de busca com valor de tabela + % do adicional sobre a diferença">
          ✦ Adicional
        </button>
        <button class="lio-aj-pai-tab ${paiAba === 'EXCETO' ? 'lio-aj-pai-tab-ativa' : ''}"
                data-pai-aba="EXCETO"
                title="Termos que tiram o produto da classificação LIO (ex.: PRESERFLO)">
          🚫 Exceto
        </button>
      </div>
    `;

    // ─── V645: Aba EXCETO — cadastro dos termos de exclusão ─────────────
    // ─── V708: aba ADICIONAL — o cadastro "Padrões de busca com valor de
    // tabela" (antes na própria aba Adicional da tela) agora mora aqui ───
    if (paiAba === 'ADICIONAL') {
      return `
        <div class="lio-ajustes-overlay" id="lio-ajustes-overlay"></div>
        <div class="lio-ajustes" role="dialog" aria-modal="true">
          <div class="lio-ajustes-modal-head">
            ${headerAbasPai}
            <button class="lio-ajustes-close-modal" id="lio-ajustes-close-modal" title="Fechar ajustes">✕</button>
          </div>
          <div class="lio-ajustes-body">
            <div class="lio-conv-card">
              <h4 class="lio-conv-secao-titulo">✦ Adicional — padrões de busca com valor de tabela</h4>
              <p class="lio-conv-help">
                Cada padrão pega <strong>todo produto que o contém</strong> (ex.: PANOPTIX) na matriz
                <strong>Particular</strong>. PRODUZIDO acima do valor de tabela → repasse extra de
                <strong>% da diferença</strong> ao executante com a especialidade <strong>Catarata</strong>.
                A matriz do resultado fica na aba <strong>Adicional</strong> da tela.
              </p>
              ${renderCadastroAdicional()}
            </div>
          </div>
        </div>
      `;
    }

    if (paiAba === 'EXCETO') {
      const termosEx = excetoListar();
      const chips = termosEx.map(t => `
        <span class="lio-conv-chip-termo">
          <span class="lio-conv-chip-texto" title="Produto que contenha este termo NÃO é classificado como LIO">${escapeHTML(t.termo)}</span>
          <button class="lio-conv-chip-remover" data-exceto-id="${t.id}" title="Remover este termo">✕</button>
        </span>`).join('');
      return `
        <div class="lio-ajustes-overlay" id="lio-ajustes-overlay"></div>
        <div class="lio-ajustes" role="dialog" aria-modal="true">
          <div class="lio-ajustes-modal-head">
            ${headerAbasPai}
            <button class="lio-ajustes-close-modal" id="lio-ajustes-close-modal" title="Fechar ajustes">✕</button>
          </div>
          <div class="lio-ajustes-body">
            <div class="lio-conv-card">
              <h4 class="lio-conv-secao-titulo">🚫 Exceto — termos fora da classificação LIO</h4>
              <p class="lio-conv-help">
                Padrões como <strong>"SERVIÇO – DE IMPLANTE"</strong> continuam valendo normalmente.
                Porém, se a descrição do produto contiver um dos termos abaixo, o registro é
                <strong>desconsiderado da classificação "SERVIÇO DE LIO"</strong> e sai da matriz do
                fichário — em <strong>Particular e Convênio</strong>. Maiúsculas e acentos não importam.
              </p>
              <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px">
                ${chips || '<em style="font-size:12px;color:var(--ink-faint)">Nenhum termo cadastrado — tudo que vem como "SERVIÇO DE LIO" entra na matriz.</em>'}
                ${state.excetoAdicionando ? `
                  <input type="text" id="lio-exceto-input" class="lio-conv-padrao-novo-input"
                         placeholder="Novo termo... (Enter salva · Esc cancela)" maxlength="60">
                ` : `
                  <button class="lio-conv-chip-add" id="lio-exceto-add" title="Adicionar termo de exclusão">+ Adicionar termo</button>
                `}
              </div>
              <p class="lio-conv-help" style="margin-top:14px">
                Exemplo: com <strong>PRESERFLO</strong> cadastrado, "SERVIÇO – DE IMPLANTE CNAET1
                (VIVITY TÓRICA)" continua entrando na matriz; "SERVIÇO – DE IMPLANTE PRESERFLO" não entra.
              </p>
            </div>
          </div>
        </div>
      `;
    }

    if (paiAba === 'CONVENIO') {
      // ─── Aba CONVÊNIO (nova) ────────────────────────────────────────
      return `
        <div class="lio-ajustes-overlay" id="lio-ajustes-overlay"></div>
        <div class="lio-ajustes" role="dialog" aria-modal="true">
          <div class="lio-ajustes-modal-head">
            ${headerAbasPai}
            <button class="lio-ajustes-close-modal" id="lio-ajustes-close-modal" title="Fechar ajustes">✕</button>
          </div>
          <div class="lio-ajustes-body">
            <div class="lio-conv-card">
              <h4 class="lio-conv-secao-titulo">⚙ Configurações gerais</h4>
              <p class="lio-conv-help">
                Percentuais aplicados a todas as linhas de OPME de convênio.
                Edite e tecle <kbd>Enter</kbd> ou clique fora pra salvar.
              </p>
              <div class="lio-aj-pcts">
                <div class="lio-aj-pct-box">
                  <label class="lio-aj-pct-label" for="lio-pct-exec">${escapeHTML(getRotLio('label_pct_exec'))}</label>
                  <div class="lio-aj-pct-input-wrap">
                    <input type="number" id="lio-pct-exec" class="lio-aj-pct-input mono"
                           value="${cfg.pctExecutante.toFixed(2)}"
                           min="0" max="100" step="0.01"
                           data-original="${cfg.pctExecutante.toFixed(2)}">
                    <span class="lio-aj-pct-suffix">%</span>
                  </div>
                </div>
                <div class="lio-aj-pct-box">
                  <label class="lio-aj-pct-label" for="lio-pct-ind">${escapeHTML(getRotLio('label_pct_ind'))} <small>(≠ exec)</small></label>
                  <div class="lio-aj-pct-input-wrap">
                    <input type="number" id="lio-pct-ind" class="lio-aj-pct-input mono"
                           value="${cfg.pctIndicante.toFixed(2)}"
                           min="0" max="100" step="0.01"
                           data-original="${cfg.pctIndicante.toFixed(2)}">
                    <span class="lio-aj-pct-suffix">%</span>
                  </div>
                </div>
              </div>
              <label class="lio-aj-toggle-indicante" title="Quando desligado, o repasse não inclui os ${fmt(cfg.pctIndicante)}% do indicante mesmo quando indicante ≠ executante">
                <input type="checkbox" id="lio-chk-pagar-indicante" ${cfg.pagarIndicante ? 'checked' : ''}>
                <span>Pagar ${fmt(cfg.pctIndicante)}% ao indicante quando diferente do executante</span>
              </label>
            </div>

            <div class="lio-conv-card">
              <h4 class="lio-conv-secao-titulo">📊 Convênios Elegíveis</h4>
              <p class="lio-conv-help">
                Busque pelo nome do convênio no relatório QVIS e marque pra fixar.
                Apenas convênios fixados aparecerão na matriz de convênio.
                Em cada convênio fixado, importe a tabela de OPMEs específica dele —
                ela aparece logo abaixo, expansível, com checkboxes pra ativar/desativar OPMEs
                e edição inline de Valor LIO/FACO.
              </p>
              ${renderBuscaConvenios()}
            </div>
          </div>
        </div>
      `;
    }

    // ─── Aba PARTICULAR (preserva integralmente o painel atual) ─────────
    return `
      <div class="lio-ajustes-overlay" id="lio-ajustes-overlay"></div>
      <div class="lio-ajustes" role="dialog" aria-modal="true">
        <div class="lio-ajustes-modal-head">
          ${headerAbasPai}
          <button class="lio-ajustes-close-modal" id="lio-ajustes-close-modal" title="Fechar ajustes">✕</button>
        </div>
        <div class="lio-ajustes-body">
          <div class="lio-aj-part-grid">
            <div class="lio-aj-secao lio-aj-secao-config">
              <h4>⚙ Configurações gerais</h4>
              <p class="lio-aj-help">
                Percentuais aplicados a todas as linhas. Edite e tecle <kbd>Enter</kbd> ou clique fora pra salvar.
              </p>
              <div class="lio-aj-pcts">
                <div class="lio-aj-pct-box">
                  <label class="lio-aj-pct-label" for="lio-pct-exec">${escapeHTML(getRotLio('label_pct_exec'))}</label>
                  <div class="lio-aj-pct-input-wrap">
                    <input type="number" id="lio-pct-exec" class="lio-aj-pct-input mono"
                           value="${cfg.pctExecutante.toFixed(2)}"
                           min="0" max="100" step="0.01"
                           data-original="${cfg.pctExecutante.toFixed(2)}">
                    <span class="lio-aj-pct-suffix">%</span>
                  </div>
                </div>
                <div class="lio-aj-pct-box">
                  <label class="lio-aj-pct-label" for="lio-pct-ind">${escapeHTML(getRotLio('label_pct_ind'))} <small>(≠ exec)</small></label>
                  <div class="lio-aj-pct-input-wrap">
                    <input type="number" id="lio-pct-ind" class="lio-aj-pct-input mono"
                           value="${cfg.pctIndicante.toFixed(2)}"
                           min="0" max="100" step="0.01"
                           data-original="${cfg.pctIndicante.toFixed(2)}">
                    <span class="lio-aj-pct-suffix">%</span>
                  </div>
                </div>
              </div>
              <p class="lio-aj-nota-toggle">
                ℹ A opção de <strong>retirar</strong> o pagamento do indicante fica na aba <strong>Convênio</strong> (é exclusiva dela). No Particular, o indicante sempre recebe quando ≠ executante.
              </p>
            </div>

            <div class="lio-aj-secao lio-aj-secao-larga">
              <div class="lio-aj-secao-larga-head">
                <h4>📦 ${escapeHTML(getRotLio('titulo_produtos'))} <small style="font-size:11px;font-weight:500;color:var(--ink-faint);text-transform:none;letter-spacing:0">· Particular (${prodPorFonte.PARTICULAR.length})</small></h4>

                <p class="lio-aj-help">
                  Produtos agrupados por <strong>Tipo Produto</strong> do relatório de Produção.
                  <strong>Marcado</strong> = regra de repasse aplicada (vai pro relatório final).
                  <strong>Desmarcado</strong> = produto fica visível na matriz mas sem regra.
                </p>

                <div class="lio-aj-acoes-globais">
                  <span class="lio-aj-acoes-stat">
                    <strong>${totalIncluidos}</strong> / ${totalProdutos} produtos ativos
                    em <em>${fonteAtiva === 'CONVENIO' ? 'Convênio' : 'Particular'}</em>
                  </span>
                  <button class="lio-aj-todos lio-aj-todos-global" data-fonte="${fonteAtiva}" data-acao-global="todos">✓ Marcar TODOS</button>
                  <button class="lio-aj-todos lio-aj-todos-global" data-fonte="${fonteAtiva}" data-acao-global="nenhum">✕ Desmarcar TODOS</button>
                </div>
              </div>
              <div class="lio-aj-lista">
                ${listaHtml || '<div class="lio-vazio-pequeno">Nenhum produto LIO encontrado nesta fonte.</div>'}
              </div>
            </div>
          </div><!-- /lio-aj-part-grid -->

          <!-- 🎨 PERSONALIZAÇÃO DE RÓTULOS (V128) -->
          <div class="lio-aj-secao lio-aj-secao-personalizar">
            <h4>🎨 Personalização de rótulos</h4>
            <p class="lio-aj-help">
              Renomeie os textos visíveis do fichário. Os valores em branco voltam ao padrão.
              Aplica imediatamente ao salvar (clique fora do campo ou tecle <kbd>Enter</kbd>).
            </p>
            <div class="lio-aj-rotulos-grid">
              ${Object.keys(LABELS_PADRAO_LIO).map(chave => `
                <div class="lio-aj-rotulo-item">
                  <label class="lio-aj-rotulo-label">
                    ${descreverRotuloLio(chave)}
                    <small class="lio-aj-rotulo-padrao">padrão: <em>${escapeHTML(LABELS_PADRAO_LIO[chave])}</em></small>
                  </label>
                  <input type="text"
                         class="lio-aj-rotulo-input"
                         data-rot-chave="${chave}"
                         value="${escapeHTML(getRotLio(chave))}"
                         placeholder="${escapeHTML(LABELS_PADRAO_LIO[chave])}"
                         maxlength="60">
                </div>
              `).join('')}
            </div>
            <div class="lio-aj-rotulos-acoes">
              <button class="btn" id="lio-rot-resetar" title="Restaura todos os rótulos ao padrão">
                ↺ Restaurar padrão
              </button>
            </div>
          </div>
        </div><!-- /lio-ajustes-body -->
      </div><!-- /lio-ajustes -->
    `;
  }

  /** Descrição amigável de cada chave de rótulo personalizável. */
  function descreverRotuloLio(chave) {
    const map = {
      sub_aba_particular: 'Sub-aba "Particular"',
      col_repasse:        'Coluna "Repasse"',
      col_executante:     'Termo "Executante"',
      col_indicante:      'Termo "Indicante"',
      titulo_ajustes:     'Botão/título "Ajustes"',
      titulo_produtos:    'Seção "Produtos elegíveis"',
      label_pct_exec:     'Label "% Executante"',
      label_pct_ind:      'Label "% Indicante"',
    };
    return map[chave] || chave;
  }

  /** Renderiza o nível 2 — tipos dentro de uma macro, e dentro dos tipos os produtos. */
  function renderTiposDaMacro(porTipo, conjuntoExcluidos, fonteAtiva, macro) {
    // ── Caso especial: macro tem 1 SÓ TIPO (ex: SERVICO DE LIO, LENTE INTRA OCULAR).
    // Pula o nível redundante e mostra os produtos direto sob a macro.
    if (porTipo.size === 1) {
      const prods = Array.from(porTipo.values())[0];
      return `
        <div class="lio-aj-macro-body lio-aj-macro-body-flat">
          <div class="lio-aj-produtos">
            ${prods.map(p => {
              const excluido = conjuntoExcluidos.has(p.produto);
              return `
                <label class="lio-aj-produto ${excluido ? 'lio-aj-produto-off' : ''}">
                  <input type="checkbox" class="lio-aj-chk-prod"
                         data-produto="${escapeHTML(p.produto)}"
                         data-fonte="${fonteAtiva}"
                         ${excluido ? '' : 'checked'}>
                  <span class="lio-aj-produto-nome" title="${escapeHTML(p.produto)}">${escapeHTML(p.produto)}</span>
                  <span class="lio-aj-produto-info" title="${p.n} ocorrência${p.n === 1 ? "" : "s"} na base · soma total R$ ${fmt(p.total)}">R$ ${fmt(p.total)}</span>
                </label>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // Múltiplos tipos — renderização normal com drilldown
    let html = '<div class="lio-aj-macro-body">';
    for (const [tipo, prods] of porTipo) {
      const chaveAberto = `${fonteAtiva}|${macro}|${tipo}`;
      const tipoAberto = state.tiposAbertos.has(chaveAberto);
      const totalTipo = prods.reduce((s, p) => s + (Number(p.total) || 0), 0);
      const incluidos = prods.filter(p => !conjuntoExcluidos.has(p.produto)).length;
      html += `
        <div class="lio-aj-tipo">
          <div class="lio-aj-tipo-head">
            <button class="lio-aj-tipo-toggle" data-tipo="${escapeHTML(tipo)}" data-macro="${escapeHTML(macro)}" data-fonte="${fonteAtiva}">
              <span class="lio-aj-tipo-arrow">${tipoAberto ? '▾' : '▸'}</span>
              <strong>${escapeHTML(tipo)}</strong>
            </button>
            <span class="lio-aj-tipo-meta mono">${incluidos}/${prods.length} · R$ ${fmt(totalTipo)}</span>
            <button class="lio-aj-todos" data-tipo-mini="${escapeHTML(tipo)}" data-fonte="${fonteAtiva}" data-acao="todos">Marcar</button>
            <button class="lio-aj-todos" data-tipo-mini="${escapeHTML(tipo)}" data-fonte="${fonteAtiva}" data-acao="nenhum">Desmarcar</button>
          </div>
          ${tipoAberto ? `
            <div class="lio-aj-produtos">
              ${prods.map(p => {
                const excluido = conjuntoExcluidos.has(p.produto);
                return `
                  <label class="lio-aj-produto ${excluido ? 'lio-aj-produto-off' : ''}">
                    <input type="checkbox" class="lio-aj-chk-prod"
                           data-produto="${escapeHTML(p.produto)}"
                           data-fonte="${fonteAtiva}"
                           ${excluido ? '' : 'checked'}>
                    <span class="lio-aj-produto-nome" title="${escapeHTML(p.produto)}">${escapeHTML(p.produto)}</span>
                    <span class="lio-aj-produto-info" title="${p.n} ocorrência${p.n === 1 ? "" : "s"} na base · soma total R$ ${fmt(p.total)}">R$ ${fmt(p.total)}</span>
                  </label>
                `;
              }).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }
    html += '</div>';
    return html;
  }

  // ───────────────────────────────────────────────────────────────────────
  // RENDER: CARDS TOTALIZADORES (KPIs)
  //
  // CRITÉRIO BASE (Classificação OPME):
  //   Tipo Produto = LIO ... | LENTE INTRA OCULAR | SERVICO DE LIO
  //
  // Card 1 — Admissões LIO:
  //   - Total: admissões únicas (Conv ∪ Part) com qualquer linha elegível.
  //     SEM duplicidade: mesma admissão em conv + part conta como 1.
  //   - Sub: quebra COM 'SERVICO DE LIO' / SEM CLASSIFICAÇÃO (= LIO + LENTE).
  //     Quando houver linha 'SERVICO DE LIO' na admissão, classifica como
  //     "serviço LIO" — mesmo que tenha outras linhas só com 'LIO'.
  //
  // Card 2 — Valor Produzido:
  //   - Total: soma do valor de TODAS as linhas LIO elegíveis.
  //   - Sub: quebra por valor — SERVICO DE LIO vs SEM CLASSIFICAÇÃO.
  //   - Linhas zeradas relevantes: somente LIO/LENTE zeradas que NÃO têm
  //     SERVICO DE LIO com valor > 0 na mesma admissão.
  //
  // Card 3 — Indicante:
  //   - Quantidade de ADMISSÕES (não linhas) com indicante ≠ executante.
  //
  // Card 4 — Repasse Total (mantido):
  //   - Soma de todos os repasses (executante + indicante).
  // ───────────────────────────────────────────────────────────────────────
  function renderKpis(linhasConv, linhasPart, cfg, repAdic) {
    const todasLinhas = [...linhasConv, ...linhasPart];

    // ─── Card 1: Admissões com breakdown ───
    const admsAll = new Set(todasLinhas.map(l => l.admissao));
    const admsServico = new Set();
    for (const l of todasLinhas) {
      if (ehTipoServicoLio(l.tipo_produto)) admsServico.add(l.admissao);
    }
    const admsSemServico = new Set([...admsAll].filter(a => !admsServico.has(a)));

    // ─── Card 2: Valor com breakdown ───
    let valorTotal = 0, valorServico = 0, valorSem = 0;
    for (const l of todasLinhas) {
      const v = Number(l.valor) || 0;
      valorTotal += v;
      if (ehTipoServicoLio(l.tipo_produto)) valorServico += v;
      else                              valorSem     += v;
    }

    // Linhas zeradas relevantes: LIO/LENTE com valor 0 cuja admissão
    // NÃO tem SERVICO DE IMPLANTE com valor > 0
    const admsServicoComValor = new Set();
    for (const l of todasLinhas) {
      if (ehTipoServicoLio(l.tipo_produto) && Number(l.valor) > 0) {
        admsServicoComValor.add(l.admissao);
      }
    }
    let zeradasRelevantes = 0;
    for (const l of todasLinhas) {
      if (Number(l.valor) > 0) continue;
      if (ehTipoServicoLio(l.tipo_produto)) continue;
      if (admsServicoComValor.has(l.admissao)) continue;
      zeradasRelevantes++;
    }

    // ─── Card 3: Indicante (admissões com indicante ≠ executante) ───
    const admsDiverg = new Set();
    for (const l of todasLinhas) {
      const c = calcularRepasse(l, cfg);
      if (c.indDiferente) admsDiverg.add(l.admissao);
    }

    // ─── Card 4: Repasse total ───
    // V708: o card abre o VALOR TOTAL e os SUBTOTAIS por fonte (CONV/PART/ADD)
    let repExec = 0, repInd = 0, repConv = 0, repPart = 0;
    for (const l of linhasConv) {
      const c = calcularRepasse(l, cfg);
      repExec += c.repExec; repInd += c.repInd; repConv += c.repTotal;
    }
    for (const l of linhasPart) {
      const c = calcularRepasse(l, cfg);
      repExec += c.repExec; repInd += c.repInd; repPart += c.repTotal;
    }
    const repAdicional = Number(repAdic) || 0;
    const repTotal = repConv + repPart + repAdicional;

    return `
      <div class="lio-kpis" id="lio-kpis-v493"><!-- V493: região dinâmica (render incremental) -->
        <div class="lio-kpi lio-kpi-verde">
          <div class="lio-kpi-faixa"></div>
          <div class="lio-kpi-label">Admissões LIO</div>
          <div class="lio-kpi-valor mono">${admsAll.size}</div>
          <div class="lio-kpi-destaque" title="Admissões com pelo menos uma linha de Tipo Produto = 'SERVICO DE LIO'">
            <span class="lio-kpi-destaque-num mono">${admsServico.size}</span>
            <span class="lio-kpi-destaque-tag">serviço LIO</span>
          </div>
        </div>

        <div class="lio-kpi lio-kpi-bege">
          <div class="lio-kpi-faixa"></div>
          <div class="lio-kpi-label">Valor Produzido</div>
          <div class="lio-kpi-valor mono">R$ ${fmt(valorTotal)}</div>
          <div class="lio-kpi-destaque" title="Soma das linhas Tipo Produto = SERVICO DE LIO">
            <span class="lio-kpi-destaque-num mono">R$ ${fmt(valorServico)}</span>
            <span class="lio-kpi-destaque-tag">serviço LIO</span>
          </div>
        </div>

        <div class="lio-kpi lio-kpi-roxo">
          <div class="lio-kpi-faixa"></div>
          <div class="lio-kpi-label">Indicante</div>
          <div class="lio-kpi-valor mono">${admsDiverg.size}</div>
          <div class="lio-kpi-sub">admissões com indic ≠ exec</div>
        </div>

        ${cfg.ocultarRepasse ? `
          <div class="lio-kpi lio-kpi-oculto">
            <div class="lio-kpi-faixa"></div>
            <div class="lio-kpi-label">Repasse Total</div>
            <div class="lio-kpi-valor mono">—</div>
            <div class="lio-kpi-sub">Repasse oculto</div>
          </div>
        ` : `
          <div class="lio-kpi lio-kpi-card-destaque">
            <div class="lio-kpi-label">Repasse Total</div>
            <div class="lio-kpi-valor mono">R$ ${fmt(repTotal)}</div>
            <div class="lio-kpi-subtotais"><!-- V708: subtotais por fonte -->
              <div class="lio-kpi-subtot"><span class="lio-kpi-subtot-rot">CONVÊNIO</span><span class="mono">R$ ${fmt(repConv)}</span></div>
              <div class="lio-kpi-subtot"><span class="lio-kpi-subtot-rot">PARTICULAR</span><span class="mono">R$ ${fmt(repPart)}</span></div>
              <div class="lio-kpi-subtot"><span class="lio-kpi-subtot-rot">ADICIONAL</span><span class="mono">R$ ${fmt(repAdicional)}</span></div>
            </div>
          </div>
        `}
      </div>
    `;
  }

  // ───────────────────────────────────────────────────────────────────────
  // RENDER: ABAS
  // ───────────────────────────────────────────────────────────────────────
  function renderAbas(qtdConv, qtdPart, qtdAdic) {
    return `
      <div class="lio-abas" id="lio-abas-v493"><!-- V493: região dinâmica (render incremental) -->
        <button class="lio-aba ${state.aba === 'CONVENIO' ? 'lio-aba-ativa' : ''}" data-aba="CONVENIO">
          <span class="lio-aba-bullet lio-aba-bullet-conv"></span>
          <span class="lio-aba-label">Convênio</span>
          <span class="lio-aba-badge">${qtdConv}</span>
        </button>
        <button class="lio-aba ${state.aba === 'PARTICULAR' ? 'lio-aba-ativa' : ''}" data-aba="PARTICULAR">
          <span class="lio-aba-bullet lio-aba-bullet-part"></span>
          <span class="lio-aba-label">Particular</span>
          <span class="lio-aba-badge">${qtdPart}</span>
        </button>
        <button class="lio-aba ${state.aba === 'ADICIONAL' ? 'lio-aba-ativa' : ''}" data-aba="ADICIONAL"
                title="LIOs particulares cobradas acima do valor de tabela — repasse extra sobre a diferença (executantes Catarata)">
          <span class="lio-aba-bullet lio-aba-bullet-adic"></span>
          <span class="lio-aba-label">Adicional</span>
          <span class="lio-aba-badge">${qtdAdic == null ? 0 : qtdAdic}</span>
        </button>
      </div>
    `;
  }

  // ───────────────────────────────────────────────────────────────────────
  // V667: ABA ADICIONAL — % (padrão 50, configurável) da DIFERENÇA entre o
  // valor COBRADO (produzido) e o VALOR DE TABELA cadastrado da lente, em
  // LIOs particulares cujo EXECUTANTE tem a especialidade Catarata (módulo
  // Médicos). Repasse EXTRA — soma-se ao repasse normal do LIO e entra no
  // consolidado dos Relatórios como "LIO · ADICIONAL".
  // ───────────────────────────────────────────────────────────────────────
  // V669: a matriz do ADICIONAL é composta pelos PRODUTOS — toda linha da
  // matriz Particular cujo produto casa com um padrão entra AQUI, já com o
  // PRODUZIDO comparado ao valor de tabela. O executante sem a especialidade
  // Catarata aparece marcado (não elegível) e sem repasse — a regra de quem
  // RECEBE continua só Catarata.
  // V708: total do ADICIONAL a pagar (alimenta o subtotal ADD do card Repasse Total)
  function totalRepasseAdicional(itensAdic) {
    return (itensAdic || []).filter(i => i.elegivel && i.calc.repasse > 0)
      .reduce((s2, i) => s2 + i.calc.repasse, 0);
  }

  function montarAdicionalTela(linhasPart) {
    const R = App.repasseLIO;
    if (!R || typeof R.calcularLinhaAdicional !== 'function') return [];
    if (!R.lentesAdicional().length) return [];
    const cat = R.medicosCatarata();
    const pct = R.lerPctAdicional();
    const out = [];
    for (const l of (linhasPart || [])) {
      const calc = R.calcularLinhaAdicional(l, pct);
      if (!calc) continue;                       // produto não casa com nenhum padrão
      const exec = String(l.cirurgiao || l.medico || '').trim();
      const elegivel = !!exec && cat.has(Utilidades.normalizar(exec));
      out.push({ l, calc, elegivel });
    }
    return out;
  }

  // V668: universo de PRODUTOS das LIOs particulares — alimenta o preview do
  // padrão de busca e o contador de cada cadastro. V668.1: memo carimbado por
  // COUNT+MAX(rowid) da Produção (padrão V663 do OPME) — só re-varre as ~900
  // mil linhas quando há REIMPORTAÇÃO, não a cada salvamento/render.
  let _adicProdsMemo = null, _adicProdsMemoCarimbo = null;
  function produtosParticularesLioMemo() {
    let carimbo = '';
    try {
      const r = Banco.queryUnica(`SELECT COUNT(*) AS n, COALESCE(MAX(rowid), 0) AS m FROM linhas_producao`);
      carimbo = r ? `${r.n}|${r.m}` : '';
    } catch (_) {}
    if (_adicProdsMemo && _adicProdsMemoCarimbo === carimbo) return _adicProdsMemo;
    let rows = [];
    try {
      rows = Banco.query(`
        SELECT DISTINCT produto FROM linhas_producao
         WHERE classificacao_produto = 'OPME' AND tipo_recebimento = 'PARTICULAR'
           AND (UPPER(COALESCE(tipo_produto,'')) LIKE '%LIO%'
             OR UPPER(COALESCE(tipo_produto,'')) = 'LENTE INTRA OCULAR'
             OR UPPER(COALESCE(tipo_produto,'')) = 'SERVICO DE LIO')`) || [];
    } catch (_) {}
    _adicProdsMemo = rows
      .filter(r => r.produto)
      .map(r => ({ p: r.produto, _n: Utilidades.normalizar(r.produto) }));
    _adicProdsMemoCarimbo = carimbo;
    return _adicProdsMemo;
  }

  // V708: o cadastro de PADRÕES DE BUSCA COM VALOR DE TABELA saiu da aba
  // ADICIONAL e virou uma aba do painel ⚙ AJUSTES (ao lado do Particular).
  // Os ids são os mesmos — os binds funcionam onde quer que ele renderize.
  function renderCadastroAdicional() {
    const R = App.repasseLIO;
    const pct = R.lerPctAdicional();
    let lentes = [];
    try { lentes = Banco.query(`SELECT id, nome, valor_tabela, ativo FROM lio_adicional_tabela ORDER BY nome`) || []; } catch (_) {}
    const qtdCatarata = R.medicosCatarata().size;
    // V668: quantos produtos da matriz PARTICULAR cada padrão pega
    const prods = produtosParticularesLioMemo();
    const casaN = (nome) => { const n = Utilidades.normalizar(nome); return n ? prods.filter(x => x._n.includes(n)).length : 0; };
    const moeda = (v) => Utilidades.formatarMoeda(Number(v) || 0);
    return `
      <div class="lio-adic-cadastro">
        <div class="lio-adic-cad-head">
          <h4 style="margin:0">⚙ Padrões de busca com valor de tabela <span class="lio-adic-cad-qtd">${lentes.length}</span></h4>
          <div class="lio-adic-pct">
            <label for="lio-adic-pct-inp">% do adicional sobre a diferença</label>
            <input type="number" id="lio-adic-pct-inp" min="0" max="100" step="0.5" value="${pct}">
          </div>
        </div>
        <div class="lio-adic-add">
          <div class="lio-adic-add-nome">
            <input type="text" id="lio-adic-novo-nome" placeholder="Padrão de busca (ex: PANOPTIX) — pega TODO produto que contém o padrão" autocomplete="off">
            <div class="lio-adic-sug" id="lio-adic-sug" style="display:none"></div>
          </div>
          <input type="text" id="lio-adic-novo-valor" inputmode="decimal" placeholder="Valor de tabela (ex: 26000,00)">
          <button class="btn btn-primary" id="lio-adic-btn-add">＋ Cadastrar</button>
        </div>
        ${lentes.length ? `
        <div class="lio-adic-lista">
          ${lentes.map(le => `
            <div class="lio-adic-item ${le.ativo ? '' : 'lio-adic-item-inativa'}">
              <span class="lio-adic-item-nome" title="${escapeHTML(le.nome)}">${escapeHTML(le.nome)}</span>
              <span class="lio-adic-item-casa" title="Produtos da matriz Particular que contêm este padrão">${casaN(le.nome)} produto${casaN(le.nome) === 1 ? '' : 's'}</span>
              <span class="lio-adic-item-valor mono">${moeda(le.valor_tabela)}</span>
              <button class="lio-adic-mini" data-adic-toggle="${le.id}" title="${le.ativo ? 'Desativar (some do cálculo)' : 'Reativar'}">${le.ativo ? '⏸' : '▶'}</button>
              <button class="lio-adic-mini lio-adic-mini-rm" data-adic-rm="${le.id}" title="Remover do cadastro">✕</button>
            </div>`).join('')}
        </div>` : `
        <p class="lio-adic-vazio">Nenhum padrão cadastrado — cadastre um padrão de busca (ex: PANOPTIX) e o valor de tabela para o adicional funcionar.</p>`}
        ${qtdCatarata === 0 ? `<p class="lio-adic-aviso">⚠ Nenhum médico com a especialidade <strong>Catarata</strong> cadastrada no módulo Médicos — sem executantes elegíveis, nada será pago.</p>` : ''}
      </div>`;
  }

  function renderAbaAdicional(itens) {
    const R = App.repasseLIO;
    const pct = R.lerPctAdicional();
    // V669: paga só elegível (Catarata); a matriz mostra TODOS os casados
    const comAdic = itens.filter(i => i.elegivel && i.calc.repasse > 0);
    const inelegiveis = itens.filter(i => !i.elegivel).length;
    const totDif = comAdic.reduce((s, i) => s + i.calc.diferenca, 0);
    const totRep = comAdic.reduce((s, i) => s + i.calc.repasse, 0);
    const moeda = (v) => Utilidades.formatarMoeda(Number(v) || 0);

    const linhasHtml = itens.map(({ l, calc, elegivel }) => `
      <tr class="${!elegivel ? 'lio-adic-linha-inelegivel' : (calc.repasse > 0 ? '' : 'lio-adic-linha-dentro')}">
        <td class="mono">${escapeHTML(String(l.admissao || ''))}</td>
        <td class="mono">${escapeHTML(String(l.data_admissao || '').slice(0, 10))}</td>
        <td>${escapeHTML(l.paciente || '')}</td>
        <td>${escapeHTML(l.cirurgiao || l.medico || '')}${elegivel ? '' : ` <span class="lio-adic-tag-inel" title="Executante sem a especialidade Catarata no módulo Médicos — não recebe o adicional">sem Catarata</span>`}</td>
        <td title="${escapeHTML(l.produto || '')}">${escapeHTML(String(l.produto || '').slice(0, 58))}</td>
        <td title="${(calc.lentes || [calc.lente]).length > 1 ? 'O cálculo usa o padrão mais específico: ' + escapeHTML(calc.lente.nome) : ''}">${(calc.lentes || [calc.lente]).map((x, i2) => `<span class="lio-termo-chip${i2 === 0 ? '' : ' lio-termo-chip-extra'}">${escapeHTML(x.nome)}</span>`).join(' ')}</td>
        <td class="mono lio-adic-num">${moeda(calc.cobrado)}</td>
        <td class="mono lio-adic-num">${moeda(calc.valorTabela)}</td>
        <td class="mono lio-adic-num">${calc.diferenca > 0 ? moeda(calc.diferenca) : '—'}</td>
        <td class="mono lio-adic-num ${elegivel && calc.repasse > 0 ? 'lio-adic-rep' : ''}">${elegivel && calc.repasse > 0 ? moeda(calc.repasse) : '—'}</td>
      </tr>`).join('');

    // V672: o ADICIONAL só entra no consolidado (Desempenho) com este switch
    // LIGADO. V714: ao ligar, o usuário informa o MÊS DE COMPETÊNCIA (a qual
    // mês do QVIS o adicional se refere) — ele aparece ao lado do botão
    // "Enviar". O "como funciona" mora no informativo (ℹ) do título do módulo.
    const consolOn = typeof R.adicionalNoConsolidado === 'function' && R.adicionalNoConsolidado();
    const dataPaga = lerDataPagaAdicional();
    return `
      <div class="lio-painel lio-adic-painel">
        <div class="lio-adic-expl-bar">
          <span><strong>ADICIONAL</strong> · padrões × PRODUZIDO acima da tabela → <strong>${pct}% da diferença</strong> (só <strong>Catarata</strong>)
            · <span class="lio-adic-aj-hint">padrões e % em <strong>⚙ Ajustes → Adicional</strong></span></span>
          <span class="lio-adic-expl-acoes">
            ${consolOn && dataPaga ? `<span class="lio-adic-data-paga" title="Mês de competência do QVIS a que o ADICIONAL se refere (informado ao enviar ao consolidado)">📅 competência ${escapeHTML(formatarDataBRLio(dataPaga))}</span>` : ''}
            <label class="lio-adic-consol-sw ${consolOn ? 'ligado' : ''}"
                   title="${consolOn ? 'ENVIADO: as linhas "LIO · ADICIONAL" entram no consolidado dos Relatórios. Clique pra retirar.' : 'Enviar ao consolidado dos Relatórios — o adicional entra no Desempenho na competência informada.'}">
              <input type="checkbox" id="lio-adic-chk-consol" ${consolOn ? 'checked' : ''}>
              <span>${consolOn ? '✓ Enviado' : 'Enviar'}</span>
            </label>
          </span>
        </div>
        <div class="lio-adic-resumo">
          <span><strong>${itens.length}</strong> linha${itens.length === 1 ? '' : 's'} casaram com os padrões</span>
          <span><strong>${comAdic.length}</strong> com adicional a pagar</span>
          ${inelegiveis ? `<span><strong>${inelegiveis}</strong> sem especialidade Catarata (não recebe${inelegiveis === 1 ? '' : 'm'})</span>` : ''}
          <span>Diferença total: <strong class="mono">${moeda(totDif)}</strong></span>
          <span>Repasse adicional (${pct}%): <strong class="mono lio-adic-rep">${moeda(totRep)}</strong></span>
        </div>
        ${itens.length ? `
        <div class="lio-adic-scroll">
          <table class="lio-adic-tabela">
            <thead><tr>
              ${['Admissão', 'Data', 'Paciente', 'Executante', 'Produto', 'Padrão (cadastro)',
                 'Produzido', 'V. Tabela', 'Diferença', `Repasse ${pct}%`].map((t, i) => `
                <th ${i >= 6 ? 'class="lio-adic-num"' : ''} data-col="${i}">${t}<span class="lio-col-resize" data-resize-col="${i}"></span></th>`).join('')}
            </tr></thead>
            <tbody>${linhasHtml}</tbody>
          </table>
        </div>` : `
        <div class="lio-adic-vazio-grande">Nenhum produto da matriz <strong>Particular</strong> casou com os padrões cadastrados${(state.mes || state.ano) ? ' na competência filtrada' : ''}.</div>`}
      </div>`;
  }

  // ── V708/V714: mês de competência (QVIS) informado ao enviar ao consolidado ──
  function lerDataPagaAdicional() {
    try {
      const r = Banco.query(`SELECT valor FROM config_lio WHERE chave = 'LIO_ADICIONAL_CONSOL_DATA'`);
      return (r && r[0] && r[0].valor) || '';
    } catch (_) { return ''; }
  }
  // V714: o valor guardado é a COMPETÊNCIA (YYYY-MM) → exibe MM/AAAA.
  // Valores antigos (YYYY-MM-DD, quando era "data paga") caem no mesmo formato.
  function formatarDataBRLio(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})/);
    return m ? `${m[2]}/${m[1]}` : String(iso || '');
  }

  function bindHandlersAdicional() {
    const R = App.repasseLIO;
    // V672: botão "Enviar" — sem enviar, o ADICIONAL fica só como conferência
    // na aba (o repasse está sendo lançado manualmente).
    // V714: ENVIAR pede o MÊS DE COMPETÊNCIA (a qual mês do QVIS se refere).
    const chkConsol = document.getElementById('lio-adic-chk-consol');
    const aplicarConsol = (ligar, dataPaga) => {
      try {
        Banco.executar(`INSERT OR REPLACE INTO config_lio (chave, valor) VALUES ('LIO_ADICIONAL_CONSOLIDADO', ?)`, [ligar ? '1' : '0']);
        Banco.executar(`INSERT OR REPLACE INTO config_lio (chave, valor) VALUES ('LIO_ADICIONAL_CONSOL_DATA', ?)`, [ligar ? (dataPaga || '') : '']);
      } catch (e) {
        Utilidades.toast?.('Erro: ' + (e.message || e), 'error', 4000);
        return;
      }
      try {
        Banco._tlAutoContar && Banco._tlAutoContar('LIO · ajustes', 1);
        Banco._tlAutoDetalhe && Banco._tlAutoDetalhe('LIO · ajustes', `${ligar ? `✓ ENVIOU o ADICIONAL ao consolidado (competência ${formatarDataBRLio(dataPaga)})` : '✗ retirou o ADICIONAL do consolidado'}`);
      } catch (_) {}
      try { window.AtlasRelatorios && AtlasRelatorios.invalidarConsolidado && AtlasRelatorios.invalidarConsolidado(); } catch (_) {}
      Utilidades.toast?.(ligar
        ? `✓ ADICIONAL no consolidado dos Relatórios ("LIO · ADICIONAL") — competência ${formatarDataBRLio(dataPaga)}`
        : 'ADICIONAL fora do consolidado — a aba fica só como conferência (lançamento manual)', 'success', 3800);
      salvarRecarregar();
    };
    if (chkConsol) chkConsol.addEventListener('change', () => {
      const ligar = !!chkConsol.checked;
      if (!ligar) { aplicarConsol(false, ''); return; }
      // V714: mini-diálogo pedindo o MÊS DE COMPETÊNCIA do QVIS. Padrão: a
      // competência filtrada na aba; sem filtro, o mês atual.
      document.getElementById('lio-adic-data-pop')?.remove();
      const hoje = new Date();
      const compAtualIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
      const iso = (state.ano && state.mes) ? `${state.ano}-${state.mes}` : compAtualIso;
      const pop = document.createElement('div');
      pop.id = 'lio-adic-data-pop';
      pop.className = 'lio-adic-data-fundo';
      pop.innerHTML = `
        <div class="lio-adic-data-box">
          <h4>Enviar o ADICIONAL ao consolidado</h4>
          <p>A qual <strong>mês de competência</strong> (QVIS) este adicional se refere? Ele fica registrado ao lado do botão.</p>
          <input type="month" id="lio-adic-data-inp" value="${iso}">
          <div class="lio-adic-data-acoes">
            <button class="btn btn-secondary" id="lio-adic-data-cancelar">Cancelar</button>
            <button class="btn btn-primary" id="lio-adic-data-ok">Confirmar</button>
          </div>
        </div>`;
      document.body.appendChild(pop);
      const fechar = () => { pop.remove(); chkConsol.checked = false; };
      pop.addEventListener('click', (e) => { if (e.target === pop) fechar(); });
      pop.querySelector('#lio-adic-data-cancelar').addEventListener('click', fechar);
      pop.querySelector('#lio-adic-data-ok').addEventListener('click', () => {
        const d = (pop.querySelector('#lio-adic-data-inp').value || iso).slice(0, 7);
        pop.remove();
        aplicarConsol(true, d);
      });
    });
    // V668.1: a tela re-renderiza NA HORA e o salvamento vai em 2º plano
    // (salvarDebounced) — antes o `await Banco.salvar()` segurava o render:
    // em base grande o export leva segundos e parecia que "não mudava nada".
    const salvarRecarregar = () => {
      R.limparCaches();
      renderizar();
      if (Banco.salvarDebounced) Banco.salvarDebounced(); else Banco.salvar();
    };

    const pctInp = document.getElementById('lio-adic-pct-inp');
    if (pctInp) pctInp.addEventListener('change', () => {
      const p = parseFloat(String(pctInp.value).replace(',', '.'));
      if (isNaN(p) || p < 0 || p > 100) { Utilidades.toast?.('Percentual inválido (0 a 100).', 'error', 3000); return; }
      try {
        Banco.executar(`INSERT OR REPLACE INTO config_lio (chave, valor) VALUES ('PCT_ADICIONAL', ?)`, [String(p)]);
      } catch (e) {
        console.error('[LIO adicional] % :', e);
        Utilidades.toast?.('Erro ao salvar o percentual: ' + (e.message || e), 'error', 4500);
        return;
      }
      // config_lio não é vigiada pelo hook automático → registra explicitamente
      try {
        Banco._tlAutoContar && Banco._tlAutoContar('LIO · ajustes', 1);
        Banco._tlAutoDetalhe && Banco._tlAutoDetalhe('LIO · ajustes', `✎ % do ADICIONAL sobre a diferença → ${p}%`);
      } catch (_) {}
      salvarRecarregar();
    });

    // V668: preview em tempo real do PADRÃO — mostra quantos e quais produtos
    // da matriz Particular o padrão digitado pega (não preenche nome único:
    // o que fica cadastrado é o PADRÃO, ex. PANOPTIX pega todos os PANOPTIX)
    const nomeInp = document.getElementById('lio-adic-novo-nome');
    const sugBox = document.getElementById('lio-adic-sug');
    if (nomeInp && sugBox) {
      const buscar = () => {
        const t = String(nomeInp.value || '').trim();
        if (t.length < 2) { sugBox.style.display = 'none'; sugBox.innerHTML = ''; return; }
        const tn = Utilidades.normalizar(t);
        const casam = produtosParticularesLioMemo().filter(x => x._n.includes(tn));
        if (!casam.length) {
          sugBox.innerHTML = `<div class="lio-adic-sug-head lio-adic-sug-zero">Nenhum produto da matriz Particular contém “${escapeHTML(t)}”</div>`;
          sugBox.style.display = 'block';
          return;
        }
        sugBox.innerHTML =
          `<div class="lio-adic-sug-head">✓ Este padrão pega <strong>${casam.length}</strong> produto${casam.length === 1 ? '' : 's'} da matriz Particular:</div>` +
          casam.slice(0, 12).map(x => `<div class="lio-adic-sug-item lio-adic-sug-preview">${escapeHTML(x.p)}</div>`).join('') +
          (casam.length > 12 ? `<div class="lio-adic-sug-head">… e mais ${casam.length - 12}</div>` : '');
        sugBox.style.display = 'block';
      };
      nomeInp.addEventListener('input', buscar);
      nomeInp.addEventListener('focus', buscar);
      nomeInp.addEventListener('blur', () => setTimeout(() => { sugBox.style.display = 'none'; }, 200));
    }

    const btnAdd = document.getElementById('lio-adic-btn-add');
    if (btnAdd) btnAdd.addEventListener('click', () => {
      const nome = String((document.getElementById('lio-adic-novo-nome') || {}).value || '').trim();
      let vTxt = String((document.getElementById('lio-adic-novo-valor') || {}).value || '').trim().replace(/\s/g, '');
      if (vTxt.includes(',')) vTxt = vTxt.replace(/\./g, '').replace(',', '.');
      const valor = Number(vTxt);
      if (!nome) { Utilidades.toast?.('Informe o padrão de busca (ex: PANOPTIX).', 'error', 3000); return; }
      if (!vTxt || isNaN(valor) || valor <= 0) { Utilidades.toast?.('Informe o valor de tabela (ex: 26000,00).', 'error', 3200); return; }
      try {
        Banco.executar(
          `INSERT OR REPLACE INTO lio_adicional_tabela (nome, nome_normalizado, valor_tabela, ativo) VALUES (?, ?, ?, 1)`,
          [nome, Utilidades.normalizar(nome), valor]);
      } catch (e) {
        console.error('[LIO adicional] cadastrar:', e);
        Utilidades.toast?.('Erro ao cadastrar o padrão: ' + (e.message || e), 'error', 4500);
        return;
      }
      const n = produtosParticularesLioMemo().filter(x => x._n.includes(Utilidades.normalizar(nome))).length;
      Utilidades.toast?.(`✓ Padrão "${nome}" — tabela ${Utilidades.formatarMoeda(valor)} (pega ${n} produto${n === 1 ? '' : 's'})`, 'success', 3400);
      state.adicCadRecolhido = null;   // V670: cadastrou → volta ao automático (recolhe e mostra a MATRIZ)
      salvarRecarregar();
    });

    document.querySelectorAll('[data-adic-toggle]').forEach(b => b.addEventListener('click', () => {
      try { Banco.executar(`UPDATE lio_adicional_tabela SET ativo = 1 - ativo WHERE id = ?`, [Number(b.dataset.adicToggle)]); }
      catch (e) { Utilidades.toast?.('Erro: ' + (e.message || e), 'error', 4000); return; }
      salvarRecarregar();
    }));
    document.querySelectorAll('[data-adic-rm]').forEach(b => b.addEventListener('click', () => {
      try { Banco.executar(`DELETE FROM lio_adicional_tabela WHERE id = ?`, [Number(b.dataset.adicRm)]); }
      catch (e) { Utilidades.toast?.('Erro: ' + (e.message || e), 'error', 4000); return; }
      salvarRecarregar();
    }));
  }

  // ───────────────────────────────────────────────────────────────────────
  // RENDER: TABELA + DRILLDOWN
  function renderLinha(l, cfg) {
    const calc = calcularRepasse(l, cfg);
    const valor = Number(l.valor) || 0;
    const valorZerado = valor === 0;
    const k = chaveLinha(l);
    const expandida = state.linhasExpandidas.has(k);

    // V129.20: linha de teste?  V129.26: duplicada?
    const ehTeste = !!l._teste;
    const duplicada = !!l._duplicada;
    const desabilitada = duplicada && !l._habilitada;

    const classes = [];
    if (calc.indDiferente) classes.push('lio-linha-divergente');
    if (valorZerado)       classes.push('lio-linha-zerada');
    if (expandida)         classes.push('lio-linha-aberta');
    if (calc.semRegra)     classes.push('lio-linha-sem-regra');
    if (ehTeste)           classes.push('lio-linha-teste');
    if (duplicada)         classes.push('lio-linha-duplicada');
    if (desabilitada)      classes.push('lio-linha-desabilitada');

    // Célula de admissão — combina marca TESTE e/ou DUPLICADO
    const celulaAdmissao = (ehTeste || duplicada) ? `
      <td class="mono lio-td-admissao-multi">
        <div class="lio-admissao-multi-wrap">
          ${(ehTeste || duplicada) ? `
            <div class="lio-admissao-badges">
              ${ehTeste ? `<span class="lio-teste-badge" title="Linha de teste inserida manualmente">🧪 TESTE</span>` : ''}
              ${duplicada ? `<span class="lio-dup-badge" title="OPME valorado em Convênio E Particular (duplicidade)">⚠ DUPLICADO</span>` : ''}
            </div>
          ` : ''}
          <span class="lio-admissao-cod">${escapeHTML(l.admissao || '—')}</span>
          ${duplicada ? `
            <div class="lio-dup-controles">
              <button class="lio-dup-toggle ${l._habilitada ? 'lio-dup-toggle-on' : 'lio-dup-toggle-off'}"
                      data-dup-toggle="${escapeHTML(l.admissao || '')}"
                      title="${l._habilitada
                        ? 'Incluída no cálculo (clique pra desabilitar)'
                        : 'Desabilitada — fora do cálculo (clique pra habilitar)'}">
                ${l._habilitada ? '✓ habilitada' : '✕ desabilitada'}
              </button>
              <span class="lio-dup-info" title="Valor do OPME no lado Particular">
                Part.: R$ ${fmt(Number(l._valorParticular) || 0)}
              </span>
            </div>
          ` : ''}
          ${ehTeste ? `
            <span class="lio-teste-acoes">
              <button class="lio-teste-editar" data-teste-editar="${l._testeId}" title="Editar linha de teste">✎</button>
              <button class="lio-teste-remover" data-teste-remover="${l._testeId}" title="Remover linha de teste">✕</button>
            </span>
          ` : ''}
        </div>
      </td>
    ` : `<td class="mono">${escapeHTML(l.admissao || '—')}</td>`;

    const linhaTr = `
      <tr class="${classes.join(' ')}" data-chave="${escapeHTML(k)}">
        <td class="mono">${formatarData(l.data_admissao)}</td>
        ${celulaAdmissao}
        <td title="${escapeHTML(l.paciente || '')}">${escapeHTML(l.paciente || '')}</td>
        <td class="lio-col-tipo" title="${escapeHTML(l.tipo_produto || '')}">${escapeHTML(l.tipo_produto || '')}</td>
        <td class="lio-col-produto" title="${escapeHTML(l.produto || '')}">
          <div class="lio-produto-nome">${escapeHTML(l.produto || '')}</div>
          ${(state.aba === 'CONVENIO' && calc.opmeIdentificado) ? `
            <div class="lio-produto-regra" title="LIO cadastrada identificada na regra">
              ↳ ${escapeHTML(calc.opmeIdentificado.produto || '')}
            </div>
            <div class="lio-produto-termos" title="Padrões que casaram (${calc.scoreMatch || 0} termo(s))">
              🔍 ${(calc.termosCasados || []).map(t => `<span class="lio-termo-chip">${escapeHTML(t)}</span>`).join('')}
            </div>
          ` : ''}
        </td>
        ${state.aba === 'CONVENIO' ? (() => {
          // V708: TODOS os padrões do cadastro (Ajustes → Adicional) que casam
          const pads = (App.repasseLIO.identificarLentesAdicional
            ? App.repasseLIO.identificarLentesAdicional(l.produto) : []);
          return `<td class="lio-col-padrao">${pads.length
            ? pads.map(x => `<span class="lio-termo-chip">${escapeHTML(x.nome)}</span>`).join(' ')
            : '<span class="lio-col-padrao-vazio">—</span>'}</td>`;
        })() : ''}
        <td class="lio-col-conv" title="${escapeHTML((l.convenio || '') + (l.plano ? ' · ' + l.plano : ''))}">${escapeHTML((l.convenio || '') + (l.plano ? ' · ' + l.plano : ''))}</td>
        <td title="${escapeHTML(CodigoMedico.exibir(l.indicante || ''))}">${escapeHTML(CodigoMedico.exibir(l.indicante || '—'))}${calc.indDiferente && !calc.semRegra
          ? ` <button class="lio-btn-expand-inline" data-chave="${escapeHTML(k)}" title="${expandida ? 'Recolher detalhes' : 'Ver detalhes da divergência (2,5%)'}">${expandida ? '▼' : '≠'}</button>`
          : calc.indDiferente ? ' <small class="lio-tag-div">≠</small>' : ''}</td>
        <td title="${escapeHTML(CodigoMedico.exibir(l.cirurgiao || ''))}">${escapeHTML(CodigoMedico.exibir(l.cirurgiao || '—'))}</td>
        ${state.aba === 'CONVENIO' ? `
          <td class="num mono ${(Number(l.produzido)||0) === 0 ? 'lio-valor-zerado' : ''}">
            R$ ${fmt(Number(l.produzido) || 0)}
          </td>
          <td class="num mono ${(Number(l.recebido)||0) === 0 ? 'lio-valor-zerado' : ''}">
            R$ ${fmt(Number(l.recebido) || 0)}
            ${(Number(l.recebido)||0) === 0 ? '<small class="lio-badge-zerado">GLOSA</small>' : ''}
          </td>
          <td class="num mono lio-col-valor-lio">
            ${calc.valorLio != null
              ? `R$ ${fmt(calc.valorLio)}`
              : '<small class="lio-badge-sem-opme" title="Nenhum OPME cadastrado casou com este produto (mín. 2 termos)">SEM CADASTRO</small>'}
          </td>
        ` : `
          <td class="num mono ${valorZerado ? 'lio-valor-zerado' : ''}">
            R$ ${fmt(valor)}
            ${valorZerado ? '<small class="lio-badge-zerado">ZERADO</small>' : ''}
          </td>
        `}
        ${cfg.ocultarRepasse ? '' : `
          <td class="num mono lio-col-repasse">
            ${desabilitada
              ? '<small class="lio-badge-sem-regra" title="Admissão desabilitada por duplicidade Convênio×Particular — fora do cálculo">DESABILITADA</small>'
              : calc.semOpme
              ? '<small class="lio-badge-sem-regra" title="Produto não casou com nenhum OPME cadastrado — sem base pra repasse">SEM OPME</small>'
              : calc.semRegra
              ? '<small class="lio-badge-sem-regra" title="Produto sem regra aplicada — não vai pro relatório final">SEM REGRA</small>'
              : `R$ ${fmt(calc.repTotal)}
                 <small class="lio-badge-pct">${fmt(calc.pctExec)}%${calc.indDiferente && cfg.pagarIndicante ? '+'+fmt(calc.pctInd)+'%' : ''}</small>`}
          </td>
        `}
      </tr>
    `;

    // Linha de drilldown (só se expandida e indicante ≠ executante)
    const drillTr = (expandida && calc.indDiferente) ? `
      <tr class="lio-linha-drilldown">
        <td colspan="${numColsTabelaV493(cfg).total}"><!-- V708: acompanha a coluna nova do Convênio -->
          <div class="lio-drilldown-conteudo">
            <div class="lio-drilldown-titulo">⊳ Detalhes da divergência indicante × executante</div>
            <div class="lio-drilldown-grid">
              <div class="lio-drill-card lio-drill-exec">
                <div class="lio-drill-label">Executante (recebe ${fmt(calc.pctExec)}%)</div>
                <div class="lio-drill-nome">${escapeHTML(CodigoMedico.exibir(l.cirurgiao || '—'))}</div>
                <div class="lio-drill-valor">R$ ${fmt(calc.repExec)}</div>
              </div>
              <div class="lio-drill-card lio-drill-indic">
                <div class="lio-drill-label">Indicante (recebe ${fmt(calc.pctInd)}%)</div>
                <div class="lio-drill-nome">${escapeHTML(CodigoMedico.exibir(l.indicante || '—'))}</div>
                <div class="lio-drill-valor">R$ ${fmt(calc.repInd)}</div>
              </div>
              <div class="lio-drill-card lio-drill-total">
                <div class="lio-drill-label">Repasse Total</div>
                <div class="lio-drill-nome">—</div>
                <div class="lio-drill-valor lio-drill-valor-total">R$ ${fmt(calc.repTotal)}</div>
              </div>
            </div>
            <div class="lio-drilldown-base">
              Valor produzido: <strong class="mono">R$ ${fmt(valor)}</strong>
              · Produto: <em>${escapeHTML(l.produto || '—')}</em>
            </div>
          </div>
        </td>
      </tr>
    ` : '';

    return linhaTr + drillTr;
  }

  // ───────────────────────────────────────────────────────────────────────
  // V129.20: Modal de inserção/edição de linha de teste
  // ───────────────────────────────────────────────────────────────────────
  function renderModalTeste() {
    if (!state.testeModalAberto) return '';

    const editando = state.testeEditando ? lerLinhaTeste(state.testeEditando) : null;
    const v = (campo) => editando ? escapeHTML(editando[campo] != null ? String(editando[campo]) : '') : '';

    const campos = [
      { id: 'data_admissao', label: 'Data', tipo: 'date',   col: 'Produção', colId: 'data' },
      { id: 'admissao',      label: 'Admissão', tipo: 'text', col: 'Produção', colId: 'admissao' },
      { id: 'paciente',      label: 'Paciente', tipo: 'text', col: 'Produção', colId: 'paciente' },
      { id: 'tipo_produto',  label: 'Tipo', tipo: 'text', col: 'QVIS · procedimento', colId: 'tipo', placeholder: 'ex: FACECTOMIA C/ IMPLANTE DE LIO' },
      { id: 'produto',       label: 'Produto (OPME)', tipo: 'text', col: 'Produção', placeholder: 'ex: LIO CLAREON PANOPTIX' },
      { id: 'convenio',      label: 'Convênio', tipo: 'text', col: 'QVIS', colId: 'convenio', placeholder: 'ex: BOMBEIROS (DF)' },
      { id: 'indicante',     label: 'Indicante', tipo: 'text', col: 'Produção' },
      { id: 'executante',    label: 'Executante', tipo: 'text', col: 'Produção' },
      { id: 'produzido',     label: 'Produzido (R$)', tipo: 'number', col: 'QVIS', colId: 'produzido' },
      { id: 'recebido',      label: 'Recebido (R$)', tipo: 'number', col: 'QVIS' },
    ];

    // V129.25: tag de origem editável (select) pras colunas trocáveis;
    // fixa pras demais. O select controla a MESMA config de origem da matriz.
    const renderTagOrigem = (c) => {
      if (c.colId && COLUNAS_MATRIZ_CONV[c.colId]) {
        const col = COLUNAS_MATRIZ_CONV[c.colId];
        const ativa = lerOrigemColuna(c.colId);
        return `
          <select class="lio-teste-origem-select" data-teste-origem="${c.colId}"
                  title="Origem de extração desta coluna na matriz (clique pra trocar)">
            ${col.fontes.map(f => `<option value="${f.id}" ${ativa === f.id ? 'selected' : ''}>${escapeHTML(f.label)}</option>`).join('')}
          </select>
        `;
      }
      return `<span class="lio-teste-campo-origem">${c.col}</span>`;
    };

    return `
      <div class="lio-teste-overlay" id="lio-teste-overlay"></div>
      <div class="lio-teste-modal" role="dialog" aria-modal="true">
        <div class="lio-teste-head">
          <div class="lio-teste-head-titulo">
            <span class="lio-teste-head-ico">🧪</span>
            <div>
              <strong>${editando ? 'Editar' : 'Inserir'} linha de teste</strong>
              <small>Preencha os valores do cenário pra validar se a regra é aplicada corretamente. A linha entra na matriz marcada como TESTE.</small>
            </div>
          </div>
          <button class="lio-teste-fechar" id="lio-teste-fechar" title="Fechar">✕</button>
        </div>

        <div class="lio-teste-body">
          <div class="lio-teste-grid">
            ${campos.map(c => `
              <div class="lio-teste-campo">
                <label for="lio-teste-${c.id}">
                  ${c.label}
                  ${renderTagOrigem(c)}
                </label>
                <input type="${c.tipo}" id="lio-teste-${c.id}"
                       class="lio-teste-input ${c.tipo === 'number' ? 'mono' : ''}"
                       value="${v(c.id)}"
                       ${c.tipo === 'number' ? 'step="0.01"' : ''}
                       placeholder="${c.placeholder || ''}"
                       autocomplete="off">
              </div>
            `).join('')}
          </div>
        </div>

        <div class="lio-teste-footer">
          <small class="lio-teste-footer-help">
            💡 O cálculo de repasse roda automaticamente sobre a linha de teste.
          </small>
          <div class="lio-teste-footer-btns">
            <button class="lio-teste-btn-cancelar" id="lio-teste-cancelar">Cancelar</button>
            <button class="lio-teste-btn-salvar" id="lio-teste-salvar">
              ${editando ? 'Salvar alterações' : 'Inserir na matriz'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function bindHandlersModalTeste() {
    if (!state.testeModalAberto) return;

    const fechar = () => {
      state.testeModalAberto = false;
      state.testeEditando = null;
      renderizar();
    };
    const btnFechar = document.getElementById('lio-teste-fechar');
    const btnCancelar = document.getElementById('lio-teste-cancelar');
    const overlay = document.getElementById('lio-teste-overlay');
    if (btnFechar) btnFechar.addEventListener('click', fechar);
    if (btnCancelar) btnCancelar.addEventListener('click', fechar);
    if (overlay) overlay.addEventListener('click', fechar);

    // Esc fecha
    if (!window.__lioTesteEscBound) {
      window.__lioTesteEscBound = true;
      document.addEventListener('keydown', (e) => {
        if (App.telaAtual !== 'desempenho-lio') return;  // V492: listener global nunca é removido — não age em outras telas
        if (e.key === 'Escape' && state.testeModalAberto) fechar();
      });
    }

    // V129.25: selects de origem (não re-renderiza — preserva o que já foi digitado)
    document.querySelectorAll('[data-teste-origem]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const colId = sel.dataset.testeOrigem;
        const fonteId = sel.value;
        if (!colId || !fonteId) return;
        await salvarOrigemColuna(colId, fonteId);
        const col = COLUNAS_MATRIZ_CONV[colId];
        const fonte = col ? col.fontes.find(f => f.id === fonteId) : null;
        Utilidades.toast?.(
          `✓ "${col?.titulo || colId}" agora vem de: ${fonte?.label || fonteId}`,
          'success', 2000
        );
      });
    });

    const btnSalvar = document.getElementById('lio-teste-salvar');
    if (btnSalvar) {
      btnSalvar.addEventListener('click', () => {
        const get = (id) => {
          const el = document.getElementById(`lio-teste-${id}`);
          return el ? el.value.trim() : '';
        };
        const dados = {
          data_admissao: get('data_admissao'),
          admissao:      get('admissao'),
          paciente:      get('paciente'),
          tipo_produto:  get('tipo_produto'),
          produto:       get('produto'),
          convenio:      get('convenio'),
          indicante:     get('indicante'),
          executante:    get('executante'),
          produzido:     Number(get('produzido')) || 0,
          recebido:      Number(get('recebido')) || 0,
        };
        // Validação mínima
        if (!dados.admissao && !dados.produto && !dados.convenio) {
          Utilidades.toast?.('Preencha ao menos Admissão, Produto ou Convênio', 'warning', 2500);
          return;
        }
        const ok = salvarLinhaTeste(dados, state.testeEditando);
        if (ok) {
          Utilidades.toast?.(
            state.testeEditando ? '✓ Linha de teste atualizada' : '✓ Linha de teste inserida na matriz',
            'success', 2000
          );
          state.testeModalAberto = false;
          state.testeEditando = null;
          renderizar();
        }
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // V129.15: Modal de mapeamento de siglas (alias do flagado ↔ QVIS LIO)
  // ───────────────────────────────────────────────────────────────────────
  function renderModalMapeamento() {
    if (!state.mapeamentoAberto) return '';

    // Pega todos os flagados (não só órfãos — usuário pode querer adicionar aliases mesmo
    // pra flagados que JÁ casam por prefix-match)
    let flagados = [];
    try {
      const rows = Banco.query(`SELECT convenio FROM lio_convenios_flagados ORDER BY convenio`);
      flagados = (rows || []).map(r => r.convenio).filter(Boolean);
    } catch (_) {}

    if (flagados.length === 0) {
      // Não deveria acontecer (botão só aparece quando tem órfãos), mas defensivo
      return '';
    }

    // Universo de candidatos: convênios distintos do QVIS COM linhas LIO
    const candidatos = listarConveniosQvisComLio();

    // Filtro de busca
    const termo = String(state.mapeamentoBusca || '').trim().toUpperCase();
    const candidatosFiltrados = termo
      ? candidatos.filter(c => String(c.convenio).toUpperCase().includes(termo))
      : candidatos;

    // Aliases já salvos por flagado (Map)
    // V492: 1 query (listarTodosAliases) em vez de listarAliasesDoFlagado()
    // por flagado no loop. Resultado idêntico (a ordem some dentro do Set).
    const aliasesPorFlagado = new Map();
    for (const f of flagados) aliasesPorFlagado.set(f, new Set());
    for (const a of listarTodosAliases()) {
      const s = aliasesPorFlagado.get(a.convenio_flagado);
      if (s) s.add(a.convenio_qvis);
    }

    return `
      <div class="lio-map-overlay" id="lio-map-overlay"></div>
      <div class="lio-map-modal" role="dialog" aria-modal="true">
        <div class="lio-map-head">
          <div class="lio-map-head-titulo">
            <span class="lio-map-head-ico">🔗</span>
            <div>
              <strong>Mapear nomes de convênio</strong>
              <small>Alguns convênios fixados aparecem com sigla/nome diferente no QVIS. Marque quais nomes do QVIS correspondem a eles.</small>
            </div>
          </div>
          <button class="lio-map-fechar" id="lio-map-fechar" title="Fechar">✕</button>
        </div>

        <div class="lio-map-busca-wrap">
          <span class="lio-map-busca-ico">🔍</span>
          <input type="text" id="lio-map-busca"
                 class="lio-map-busca-input"
                 value="${escapeHTML(state.mapeamentoBusca || '')}"
                 placeholder="Buscar nome no QVIS..."
                 autocomplete="off">
          ${state.mapeamentoBusca ? `<button class="lio-map-busca-clear" id="lio-map-busca-clear" title="Limpar">✕</button>` : ''}
        </div>

        <div class="lio-map-body">
          ${flagados.map(f => {
            const meusAliases = aliasesPorFlagado.get(f) || new Set();
            return `
              <div class="lio-map-flagado">
                <div class="lio-map-flagado-head">
                  <span class="lio-map-flagado-tag">${escapeHTML(f)}</span>
                  <small class="lio-map-flagado-stat">
                    ${meusAliases.size > 0
                      ? `${meusAliases.size} alias(es) configurado(s)`
                      : 'Nenhum alias — marque abaixo'}
                  </small>
                </div>
                <div class="lio-map-candidatos">
                  ${candidatosFiltrados.length === 0
                    ? `<div class="lio-map-vazio">Nenhum convênio do QVIS encontrado${termo ? ` para "${escapeHTML(termo)}"` : ''}.</div>`
                    : candidatosFiltrados.map(c => {
                      const marcado = meusAliases.has(c.convenio);
                      return `
                        <label class="lio-map-cand ${marcado ? 'lio-map-cand-marcado' : ''}">
                          <input type="checkbox"
                                 class="lio-map-cand-check"
                                 data-flagado="${escapeHTML(f)}"
                                 data-qvis="${escapeHTML(c.convenio)}"
                                 ${marcado ? 'checked' : ''}>
                          <div class="lio-map-cand-info">
                            <strong>${escapeHTML(c.convenio)}</strong>
                            <small>${c.n} linha(s) LIO no QVIS</small>
                          </div>
                        </label>
                      `;
                    }).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div class="lio-map-footer">
          <small class="lio-map-footer-help">
            ✓ As alterações são aplicadas imediatamente. Feche quando terminar.
          </small>
          <button class="lio-map-footer-fechar" id="lio-map-footer-fechar">Concluir</button>
        </div>
      </div>
    `;
  }


  //   - Se aba ≠ CONVENIO: nada
  //   - Se 0 flagados: aviso destacado "Configure em Ajustes"
  //   - Se há flagados mas algum sem match na Produção: aviso de mapeamento
  //   - Se tudo OK: nada (silencioso)
  // ───────────────────────────────────────────────────────────────────────
  function renderAvisoConvenioFlagados(linhasConvenioCarregadas) {
    if (state.aba !== 'CONVENIO') return '';

    let flagados = [];
    try {
      const rows = Banco.query(`SELECT convenio FROM lio_convenios_flagados`);
      flagados = (rows || []).map(r => r.convenio).filter(Boolean);
    } catch (_) { /* tabela ainda não existe */ }

    // CASO 1: nenhum flagado
    if (flagados.length === 0) {
      return `
        <div class="lio-aviso-flag lio-aviso-flag-vazio">
          <div class="lio-aviso-flag-icone">🏥</div>
          <div class="lio-aviso-flag-corpo">
            <strong>Nenhum convênio fixado em Ajustes</strong>
            <p>A matriz de Convênio mostra apenas linhas dos convênios fixados no painel Ajustes → aba Convênio → seção "Convênios Elegíveis".</p>
          </div>
          <button class="lio-aviso-flag-btn" id="lio-aviso-abrir-ajustes">⚙ Abrir Ajustes</button>
        </div>
      `;
    }

    // CASO 2: tem flagado mas algum não casa com nada no QVIS (após filtros LIO)
    // V129.14: agora a matriz vem do QVIS, então a detecção de órfãos olha
    // os convênios distintos do QVIS (com procedimento LIO, sem TAXA EXTERNO)
    // V129.15: considera ALIASES salvos — se o flagado tem alguma alias, não é órfão
    let conveniosDistintosQvis = [];
    try {
      const r = Banco.query(`
        SELECT DISTINCT convenio FROM linhas_qvis
        WHERE convenio IS NOT NULL AND convenio <> ''
          AND UPPER(COALESCE(procedimento,'')) LIKE '%LIO%'
          AND UPPER(COALESCE(procedimento,'')) NOT LIKE '%TAXA DE MEDICO EXTERNO%'
      `);
      conveniosDistintosQvis = (r || []).map(x => String(x.convenio).toUpperCase());
    } catch (_) {}

    // V492: 1 query (listarTodosAliases) em vez de listarAliasesDoFlagado()
    // por flagado dentro do filter abaixo. Resultado idêntico.
    const flagadosComAlias = new Set(listarTodosAliases().map(a => a.convenio_flagado));

    const orfaos = flagados.filter(f => {
      const fu = String(f).toUpperCase();
      // 1) prefix-match no QVIS
      if (conveniosDistintosQvis.some(cq => cq.startsWith(fu))) return false;
      // 2) tem alias salvo?
      if (flagadosComAlias.has(f)) return false;  // V492
      return true;
    });

    if (orfaos.length === 0) return ''; // tudo OK, sem aviso

    return `
      <div class="lio-aviso-flag lio-aviso-flag-orfao">
        <div class="lio-aviso-flag-icone">⚠</div>
        <div class="lio-aviso-flag-corpo">
          <strong>${orfaos.length} convênio(s) flagado(s) sem correspondência no QVIS</strong>
          <p>
            ${orfaos.map(o => `<code>${escapeHTML(o)}</code>`).join(', ')}
            — pode ser que esses convênios apareçam com outro nome ou sigla no QVIS (ex.: <code>CBMDF</code> em vez de <code>BOMBEIROS (DF)</code>).
          </p>
        </div>
        <button class="lio-aviso-flag-btn" id="lio-aviso-mapear-conv">🔗 Mapear nomes</button>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────
  // V493: helpers de template compartilhados entre renderTabela() (render
  // completo) e renderParcialFiltros() (render incremental). O incremental
  // usa EXATAMENTE estas funções — zero markup duplicado.
  // ─────────────────────────────────────────────────────────────────────

  // V493: nº de colunas (colspan) — extraído de renderTabela
  function numColsTabelaV493(cfg) {
    // V708: o CONVÊNIO ganhou a coluna "Padrão (cadastro)" depois do Produto
    const numColsDescritivas = state.aba === 'CONVENIO' ? 9 : 8;
    const numColsValor = state.aba === 'CONVENIO' ? 3 : 1;  // Produzido+Recebido+ValorLIO ou só Valor
    return {
      descritivas: numColsDescritivas,
      total: numColsDescritivas + numColsValor + (cfg.ocultarRepasse ? 0 : 1),
    };
  }


  // ───────────────────────────────────────────────────────────────────────
  // V895: A MATRIZ DE CONVÊNIO EXPLICA O VAZIO.
  // Caso do usuário: "não teve nenhum convênio aparecendo". A cadeia da aba
  // tem quatro elos — QVIS LIO no mês → convênios fixados → OPME na produção
  // → filtros/EXCETO — e qualquer um zerando deixava a matriz vazia e MUDA.
  // Este painel percorre a cadeia com os números do filtro ativo e aponta o
  // elo exato em que o zero aconteceu, com o que fazer.
  // ───────────────────────────────────────────────────────────────────────
  function renderDiagnosticoConvVazio() {
    let flagados = [];
    try {
      flagados = (Banco.query(`SELECT convenio FROM lio_convenios_flagados`) || [])
        .map(r => r.convenio).filter(Boolean);
    } catch (_) {}
    if (!flagados.length) return '';   // o aviso "nenhum fixado" já cobre esse caso

    const per = [];
    if (state.ano) per.push(`substr(mes_pagamento,1,4) = '${state.ano}'`);
    if (state.mes) per.push(`substr(mes_pagamento,6,2) = '${state.mes}'`);
    const fPer = per.length ? ' AND ' + per.join(' AND ') : '';
    const rotuloMes = state.mes || state.ano
      ? `${state.mes ? state.mes + '/' : ''}${state.ano || 'todos os anos'}` : 'todos os meses';
    const baseLio = `FROM linhas_qvis
      WHERE UPPER(COALESCE(procedimento,'')) LIKE '%LIO%'
        AND UPPER(COALESCE(procedimento,'')) NOT LIKE '%TAXA DE MEDICO EXTERNO%'
        AND admissao IS NOT NULL AND admissao <> ''`;
    const conta = (sql) => {
      try { return Number((Banco.query(sql)[0] || {}).n) || 0; } catch (_) { return 0; }
    };
    // a MESMA condição de convênio da matriz (prefixo dos fixados + aliases)
    const escSql = (x) => String(x).replace(/'/g, "''");
    const cond = [];
    for (const f of flagados) cond.push(`UPPER(COALESCE(convenio,'')) LIKE UPPER('${escSql(f)}') || '%'`);
    for (const al of listarTodosAliases()) cond.push(`UPPER(COALESCE(convenio,'')) = UPPER('${escSql(al.convenio_qvis)}')`);
    const likes = cond.length ? cond.join(' OR ') : '1=0';

    const nLioMes = conta(`SELECT COUNT(*) n ${baseLio}${fPer}`);
    const nAdmFix = conta(`SELECT COUNT(DISTINCT admissao) n ${baseLio} AND (${likes})${fPer}`);
    const nComProd = conta(`SELECT COUNT(DISTINCT lp.cod_admissao) n FROM linhas_producao lp
      WHERE lp.classificacao_produto = 'OPME'
        AND lp.cod_admissao IN (SELECT DISTINCT admissao ${baseLio} AND (${likes})${fPer})`);

    let causa;
    if (nLioMes === 0) {
      causa = `O QVIS não tem <strong>nenhuma linha LIO</strong> em <strong>${escapeHTML(rotuloMes)}</strong>.
        O filtro de mês usa o <strong>mês de pagamento</strong> do QVIS — experimente outro mês, limpe o filtro
        ou confira se o relatório do período foi importado.`;
    } else if (nAdmFix === 0) {
      let nomes = [];
      try {
        nomes = (Banco.query(`SELECT convenio, COUNT(*) n ${baseLio}${fPer}
          GROUP BY convenio ORDER BY n DESC LIMIT 5`) || []).map(r => r.convenio);
      } catch (_) {}
      causa = `Há <strong>${nLioMes}</strong> linha(s) LIO no QVIS em ${escapeHTML(rotuloMes)}, mas
        <strong>nenhuma é dos convênios fixados</strong>. No QVIS elas aparecem como:
        ${nomes.map(n => `<code>${escapeHTML(n)}</code>`).join(', ') || '—'} —
        se for o mesmo convênio com outro nome, use o <strong>🔗 Mapear nomes</strong> (aliases).`;
    } else if (nComProd === 0) {
      causa = `<strong>${nAdmFix}</strong> admissão(ões) dos convênios fixados casaram no QVIS, mas
        <strong>nenhuma tem OPME na PRODUÇÃO</strong> — a matriz nasce desse cruzamento.
        Importe a produção analítica do período correspondente.`;
    } else {
      causa = `A cadeia está de pé (${nLioMes} linhas LIO → ${nAdmFix} admissões dos fixados →
        ${nComProd} com OPME na produção), mas os <strong>filtros da matriz</strong> derrubaram tudo —
        revise a busca, o recorte "com/sem regra" e os termos <strong>EXCETO</strong> dos Ajustes.`;
    }
    return `
      <div class="lio-aviso-flag lio-diag-vazio">
        <div class="lio-aviso-flag-icone">🔎</div>
        <div class="lio-aviso-flag-corpo">
          <strong>Matriz vazia — onde o zero aconteceu</strong>
          <p>${causa}</p>
          <p class="lio-diag-cadeia">QVIS LIO no período: <strong>${nLioMes}</strong> ·
            dos convênios fixados: <strong>${nAdmFix}</strong> ·
            com OPME na produção: <strong>${nComProd}</strong></p>
        </div>
      </div>
    `;
  }

  // V493: conteúdo do contador de linhas (.lio-painel-info)
  function renderInfoTabelaV493(linhas, cfg) {
    if (linhas.length === 0) return 'Nenhuma linha LIO para os filtros atuais.';
    const linhasDivergentes = linhas.filter(l => {
      const c = calcularRepasse(l, cfg); return c.indDiferente;
    }).length;
    return `
            <strong>${linhas.length}</strong> linha${linhas.length === 1 ? '' : 's'}
            ${linhasDivergentes > 0 ? ` · <span class="lio-tag-div-info">${linhasDivergentes} com indicante ≠ executante</span>` : ''}
    `;
  }

  // V493: toggle Com regra / Sem regra / Todas (badges mudam com os filtros)
  function renderMatrizToggleV493(badges) {
    return `
      <div class="lio-matriz-toggle" id="lio-matriz-toggle-v493" role="tablist">
        <button class="lio-matriz-opt ${state.matrizFiltro === 'COM_REGRA' ? 'lio-matriz-opt-ativa' : ''}"
                data-matriz-filtro="COM_REGRA"
                title="Mostrar apenas produtos com regra aplicada (vão pro relatório final)">
          <span class="lio-matriz-opt-lbl">Com regra</span>
          <span class="lio-matriz-opt-badge">${badges.qtdComRegra}</span>
        </button>
        <button class="lio-matriz-opt ${state.matrizFiltro === 'SEM_REGRA' ? 'lio-matriz-opt-ativa lio-matriz-opt-sem' : ''}"
                data-matriz-filtro="SEM_REGRA"
                title="Mostrar apenas produtos SEM regra aplicada">
          <span class="lio-matriz-opt-lbl">Sem regra</span>
          <span class="lio-matriz-opt-badge">${badges.qtdSemRegra}</span>
        </button>
        <button class="lio-matriz-opt ${state.matrizFiltro === 'TODAS' ? 'lio-matriz-opt-ativa' : ''}"
                data-matriz-filtro="TODAS"
                title="Mostrar todas as linhas (com e sem regra)">
          <span class="lio-matriz-opt-lbl">Todas</span>
          <span class="lio-matriz-opt-badge">${badges.qtdTodas}</span>
        </button>
      </div>
    `;
  }

  // V493: corpo do tbody — linhas via renderLinha (mesma função do completo)
  // ou a linha de "vazio" quando não há dados
  function renderCorpoTabelaV493(linhas, cfg) {
    if (linhas.length === 0) {
      return `
                <tr class="lio-tabela-vazia">
                  <td colspan="${numColsTabelaV493(cfg).total}">
                    <div class="lio-tabela-vazia-msg">
                      <span class="lio-tabela-vazia-ico">∅</span>
                      Sem dados pra exibir
                    </div>
                  </td>
                </tr>
      `;
    }
    return linhas.map(l => renderLinha(l, cfg)).join('');
  }

  // V493: rodapé de totais (tr do tfoot) — extraído de renderTabela
  function renderRodapeTabelaV493(linhas, cfg) {
    const totalValor = linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);
    const totalRepasse = linhas.reduce((s, l) => s + calcularRepasse(l, cfg).repTotal, 0);

    // Rodapé do total (V129.26: exclui linhas desabilitadas por duplicidade)
    const desabFn = state._estaDesabilitada || (() => false);
    const linhasTotal = linhas.filter(l => !desabFn(l));
    const totalValorLio = state.aba === 'CONVENIO'
      ? linhasTotal.reduce((s,l) => { const c = calcularRepasse(l, cfg); return s + (c.valorLio || 0); }, 0)
      : 0;
    return `
      <tr>
        <td colspan="${numColsTabelaV493(cfg).descritivas}" class="lio-total-label">Total</td>
        ${state.aba === 'CONVENIO' ? `
          <td class="num mono"><strong>R$ ${fmt(linhasTotal.reduce((s,l) => s + (Number(l.produzido) || 0), 0))}</strong></td>
          <td class="num mono"><strong>R$ ${fmt(linhasTotal.reduce((s,l) => s + (Number(l.recebido) || 0), 0))}</strong></td>
          <td class="num mono"><strong>R$ ${fmt(totalValorLio)}</strong></td>
        ` : `
          <td class="num mono"><strong>R$ ${fmt(totalValor)}</strong></td>
        `}
        ${cfg.ocultarRepasse ? '' : `<td class="num mono atlas-rep"><strong>R$ ${fmt(totalRepasse)}</strong></td>`}<!-- V965: total de Repasse em #2a5a8c -->
      </tr>
    `;
  }

  function renderTabela(linhas, cfg, todasLinhasGlobais, ctxBadges) {
    // Valores únicos pros filtros de coluna (baseado em TODAS as linhas, não só filtradas)
    const tiposUnicos = new Set();
    const produtosUnicos = new Set();
    for (const l of (todasLinhasGlobais || linhas)) {
      if (l.tipo_produto) tiposUnicos.add(l.tipo_produto);
      if (l.produto) produtosUnicos.add(l.produto);
    }
    const tiposOrdenados = Array.from(tiposUnicos).sort();
    const produtosOrdenados = Array.from(produtosUnicos).sort();

    const filtroTipoAtivo = state.filtros.tipos.size > 0;
    const filtroProdutoAtivo = state.filtros.produtos.size > 0;

    // Toggle visual: COM_REGRA / SEM_REGRA / TODAS
    // V493: markup extraído pra renderMatrizToggleV493 (reuso no incremental)
    const badges = ctxBadges || { qtdComRegra: 0, qtdSemRegra: 0, qtdTodas: 0 };
    const toggleHtml = renderMatrizToggleV493(badges);

    // V129.16: Helper pra montar o cabeçalho da coluna com subtítulo da origem
    const thOrigem = (titulo, origem, col, extras = '') => `
      <th data-col="${col}" ${extras}>
        <div class="lio-th-titulo">${titulo}</div>
        <div class="lio-th-origem">${origem}</div>
        <span class="lio-col-resize" data-resize-col="${col}"></span>
      </th>
    `;

    // V129.17: Helper pra renderizar o subtítulo "Origem" como TROCÁVEL
    // (quando a coluna tem 2+ fontes possíveis) ou simples (1 fonte só)
    // V129.27: encurta o subtítulo de origem — só a 1ª descrição (antes de · ou ×)
    const origemCurta = (label) => String(label || '').split(/[·×]/)[0].trim();

    const renderOrigemTrocavel = (colId, origemAtualTexto) => {
      const col = COLUNAS_MATRIZ_CONV[colId];
      // Se aba=CONVENIO e a coluna existe no map, é trocável
      if (state.aba === 'CONVENIO' && col) {
        const fonte = obterFonteAtiva(colId);
        const aberto = state.menuOrigemCol === colId;
        return `
          <div class="lio-th-origem lio-th-origem-trocavel" data-trocar-col="${colId}"
               title="Click pra trocar a fonte desta coluna (${escapeHTML(fonte.label)})">
            <span>${origemCurta(fonte.label)}</span>
            <span class="lio-th-origem-chevron">${aberto ? '▴' : '▾'}</span>
            ${aberto ? `
              <div class="lio-th-origem-menu">
                <div class="lio-th-origem-menu-titulo">Fonte de "${col.titulo}"</div>
                ${col.fontes.map(f => `
                  <button class="lio-th-origem-menu-opt ${fonte.id === f.id ? 'lio-th-origem-menu-opt-ativa' : ''}"
                          data-trocar-fonte="${colId}|${f.id}">
                    ${fonte.id === f.id ? '✓ ' : ''}${f.label}
                  </button>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }
      // Fonte única → texto sem interação (encurtado)
      return `<div class="lio-th-origem">${origemCurta(origemAtualTexto)}</div>`;
    };

    // V129.19: Coluna "T" removida — virou botão de verificação no header
    const colunaT = '';

    // V493: colspans e rodapé extraídos pra numColsTabelaV493 / renderRodapeTabelaV493

    // Header da tabela (sempre presente, mesmo com 0 linhas)
    const theadHtml = `
      <thead>
        <tr>
          <th data-col="1">
            <div class="lio-th-titulo">Data</div>
            ${renderOrigemTrocavel('data', 'Produção')}
            <span class="lio-col-resize" data-resize-col="1"></span>
          </th>
          <th data-col="2">
            <div class="lio-th-titulo">Admissão</div>
            ${renderOrigemTrocavel('admissao', 'Produção')}
            <span class="lio-col-resize" data-resize-col="2"></span>
          </th>
          <th data-col="3">
            <div class="lio-th-titulo">Paciente</div>
            ${renderOrigemTrocavel('paciente', 'Produção')}
            <span class="lio-col-resize" data-resize-col="3"></span>
          </th>
          <th class="lio-th-filtravel" data-col="4">
            <div class="lio-th-titulo">
              Tipo
              <button class="lio-th-filter-btn ${filtroTipoAtivo ? 'lio-th-filter-btn-ativo' : ''}"
                      data-coluna="tipo"
                      title="${filtroTipoAtivo ? state.filtros.tipos.size + ' selecionado(s)' : 'Filtrar por tipo'}">▾</button>
            </div>
            ${renderOrigemTrocavel('tipo', 'Produção')}
            ${state.popoverColuna === 'tipo' ? renderPopoverFiltro('tipo', tiposOrdenados, state.filtros.tipos) : ''}
            <span class="lio-col-resize" data-resize-col="4"></span>
          </th>
          <th class="lio-th-filtravel" data-col="5">
            <div class="lio-th-titulo">
              Produto
              <button class="lio-th-filter-btn ${filtroProdutoAtivo ? 'lio-th-filter-btn-ativo' : ''}"
                      data-coluna="produto"
                      title="${filtroProdutoAtivo ? state.filtros.produtos.size + ' selecionado(s)' : 'Filtrar por produto'}">▾</button>
            </div>
            <div class="lio-th-origem">Produção</div>
            ${state.popoverColuna === 'produto' ? renderPopoverFiltro('produto', produtosOrdenados, state.filtros.produtos) : ''}
            <span class="lio-col-resize" data-resize-col="5"></span>
          </th>
          ${state.aba === 'CONVENIO' ? `
          <th data-col="5p"><!-- V708: TODOS os padrões do cadastro que casam com o produto -->
            <div class="lio-th-titulo">Padrão (cadastro)</div>
            <div class="lio-th-origem">Ajustes · Adicional</div>
            <span class="lio-col-resize" data-resize-col="5p"></span>
          </th>` : ''}
          <th data-col="6">
            <div class="lio-th-titulo">Convênio</div>
            ${renderOrigemTrocavel('convenio', 'Produção')}
            <span class="lio-col-resize" data-resize-col="6"></span>
          </th>
          <th data-col="7">
            <div class="lio-th-titulo">Indicante</div>
            <div class="lio-th-origem">Produção</div>
            <span class="lio-col-resize" data-resize-col="7"></span>
          </th>
          <th data-col="8">
            <div class="lio-th-titulo">Executante</div>
            <div class="lio-th-origem">Produção</div>
            <span class="lio-col-resize" data-resize-col="8"></span>
          </th>
          ${colunaT}
          ${state.aba === 'CONVENIO' ? `
            <th class="num" data-col="9a">
              <div class="lio-th-titulo">Produzido</div>
              ${renderOrigemTrocavel('produzido', 'QVIS · SUM(produzido)')}
              <span class="lio-col-resize" data-resize-col="9a"></span>
            </th>
            <th class="num" data-col="9b">
              <div class="lio-th-titulo">Recebido</div>
              <div class="lio-th-origem">QVIS</div>
              <span class="lio-col-resize" data-resize-col="9b"></span>
            </th>
            <th class="num" data-col="9c">
              <div class="lio-th-titulo">Valor LIO Cadastrado</div>
              <div class="lio-th-origem">Ajustes</div>
              <span class="lio-col-resize" data-resize-col="9c"></span>
            </th>
          ` : `
            <th class="num" data-col="9">
              <div class="lio-th-titulo">Valor</div>
              <div class="lio-th-origem">Produção</div>
              <span class="lio-col-resize" data-resize-col="9"></span>
            </th>
          `}
          ${cfg.ocultarRepasse ? '' : `
            <th class="num" data-col="10">
              <div class="lio-th-titulo">Repasse</div>
              <div class="lio-th-origem">Calculado</div>
              <span class="lio-col-resize" data-resize-col="10"></span>
            </th>
          `}
        </tr>
      </thead>
    `;

    // V493: caminhos "vazio" e "com linhas" unificados — o conteúdo variável
    // (contador, tbody, rodapé) vem dos helpers compartilhados com o render
    // incremental, dentro de regiões com ids estáveis. Um <tfoot> vazio não
    // renderiza nada, então o resultado visível é idêntico ao anterior.
    return `
      <div class="lio-painel">
        <div class="lio-painel-head">
          <div class="lio-painel-info" id="lio-painel-info-v493">${renderInfoTabelaV493(linhas, cfg)}</div>
          ${toggleHtml}
        </div>
        <div class="lio-tabela-scroll">
          <table class="lio-tabela">
            ${theadHtml}
            <tbody id="lio-tbody-v493">
              ${renderCorpoTabelaV493(linhas, cfg)}
            </tbody>
            <tfoot id="lio-tfoot-v493">
              ${linhas.length > 0 ? renderRodapeTabelaV493(linhas, cfg) : ''}
            </tfoot>
          </table>
        </div>
      </div>
    `;
  }

  /** Renderiza o popover de filtro de uma coluna (tipo ou produto). */
  function renderPopoverFiltro(coluna, valoresOrdenados, selecionados) {
    const todosMarcados = selecionados.size === 0; // vazio = mostra tudo
    return `
      <div class="lio-th-popover" data-popover="${coluna}">
        <div class="lio-th-popover-head">
          <strong>Filtrar por ${coluna === 'tipo' ? 'Tipo' : 'Produto'}</strong>
          <button class="lio-th-popover-close" data-popover-close>✕</button>
        </div>
        <div class="lio-th-popover-acoes">
          <button class="lio-th-popover-btn" data-popover-todos="${coluna}">Mostrar todos</button>
          ${selecionados.size > 0
            ? `<span class="lio-th-popover-count">${selecionados.size} selecionado(s)</span>`
            : `<span class="lio-th-popover-count">Mostrando todos</span>`}
        </div>
        <div class="lio-th-popover-lista">
          ${valoresOrdenados.map(v => {
            const marcado = selecionados.has(v);
            return `
              <label class="lio-th-popover-item">
                <input type="checkbox" data-popover-valor="${escapeHTML(v)}" data-popover-coluna="${coluna}"
                       ${marcado ? 'checked' : ''}>
                <span title="${escapeHTML(v)}">${escapeHTML(v)}</span>
              </label>
            `;
          }).join('')}
        </div>
        <div class="lio-th-popover-foot">
          <small>Marque os valores que quer mostrar. Sem nada marcado = mostra todos.</small>
        </div>
      </div>
    `;
  }

  // ───────────────────────────────────────────────────────────────────────
  // RENDER + BINDS
  // ───────────────────────────────────────────────────────────────────────
  // V493: pipeline de DADOS extraído de renderizar() — compartilhado entre o
  // render completo e o incremental (renderParcialFiltros). Nenhuma mudança de
  // lógica: é exatamente o trecho que abria renderizar().
  function prepararDadosRenderV493() {
    // V492: nova geração de render → invalida o cache por linha de calcularRepasse
    // V493: incrementa TAMBÉM no incremental (todo "render" é uma geração nova)
    window.__lioCalcGenV492 = (window.__lioCalcGenV492 || 0) + 1;

    limparCachesIdentificacao();  // V129.21: dados podem ter mudado desde o último render
    invalidarRotulosLio();  // recarrega rótulos custom antes de cada render
    const cfg = lerConfigLio();
    state.ocultarRepasse = cfg.ocultarRepasse;

    // Linhas COMPLETAS (todas, marcadas ou não). O conceito de "produto excluído"
    // agora é "produto sem regra aplicada" — a linha continua aparecendo mas
    // o repasse fica zero.
    const todasConv = carregarLinhasLio('CONVENIO');
    const todasPart = carregarLinhasLio('PARTICULAR');
    const todasLinhasGlobais = [...todasConv, ...todasPart];

    // V129.20: injeta linhas de teste na aba CONVÊNIO (misturadas na ordem normal)
    const linhasTeste = listarLinhasTeste();
    const todasConvComTeste = [...todasConv, ...linhasTeste];

    // Aplica filtros (busca + tipo + produto) — mantém todas as linhas
    const convFilt = aplicarFiltros(todasConvComTeste);
    const partFilt = aplicarFiltros(todasPart);

    // ─── V129.26: Detecção automática de duplicidade Convênio × Particular ──
    if (state.aba === 'CONVENIO') {
      const admissoesConv = [...new Set(convFilt.map(l => l.admissao).filter(Boolean).map(String))];
      const mapaDup = detectarDuplicidadesConvParticular(admissoesConv);
      registrarDuplicidades(mapaDup);

      // V492: 1 query com IN em vez de lerEstadoDuplicidade() por linha
      // duplicada dentro do loop. Só as admissões do mapaDup precisam de
      // estado (as demais nem consultavam). Resultado idêntico.
      const estadoDupPorAdm = new Map();
      if (mapaDup.size > 0) {
        try {
          const escAdmV492 = (s) => String(s).replace(/'/g, "''");
          const inListV492 = [...mapaDup.keys()].map(a => `'${escAdmV492(a)}'`).join(',');
          const rowsDup = Banco.query(`
            SELECT admissao, habilitada, valor_particular, produto_particular
            FROM lio_admissoes_desabilitadas
            WHERE admissao IN (${inListV492})
          `);
          for (const r of (rowsDup || [])) {
            estadoDupPorAdm.set(String(r.admissao), {
              habilitada: !!r.habilitada,
              valorParticular: Number(r.valor_particular) || 0,
              produtoParticular: r.produto_particular || ''
            });
          }
        } catch (_) { /* sem tabela → est = null, como antes */ }
      }

      for (const l of convFilt) {
        const dup = mapaDup.get(String(l.admissao));
        l._duplicada = !!dup;
        if (dup) {
          l._valorParticular = dup.valorParticular;
          l._produtoParticular = dup.produtoParticular;
          const est = estadoDupPorAdm.get(String(l.admissao)) || null;  // V492: era 1 query por linha
          l._habilitada = est ? est.habilitada : false;
        } else {
          l._habilitada = true;
        }
      }
    } else {
      for (const l of convFilt) { l._duplicada = false; l._habilitada = true; }
    }

    // Helper: linha desabilitada (duplicada + não reabilitada) → sai dos cálculos
    const estaDesabilitada = (l) => !!l._duplicada && !l._habilitada;
    state._estaDesabilitada = estaDesabilitada;

    // Filtro de regra (só pra matriz visível, NÃO pros KPIs)
    const aplicarFiltroRegra = (linhas) => {
      if (state.matrizFiltro === 'COM_REGRA') return linhas.filter(l => temRegraAplicada(l, cfg));
      if (state.matrizFiltro === 'SEM_REGRA') return linhas.filter(l => !temRegraAplicada(l, cfg));
      return linhas;  // TODAS
    };
    const linhasMatriz = state.aba === 'CONVENIO' ? convFilt : partFilt;
    const linhasMatrizFinal = aplicarFiltroRegra(linhasMatriz);

    // Pros KPIs: SOMENTE linhas com regra aplicada (= o que vai pro relatório final)
    // V129.26: e que não estejam desabilitadas por duplicidade
    const convComRegra = convFilt.filter(l => temRegraAplicada(l, cfg) && !estaDesabilitada(l));
    const partComRegra = partFilt.filter(l => temRegraAplicada(l, cfg));

    // Contadores pra mostrar nos botões de filtro
    const ctxBadges = {
      qtdComRegra: linhasMatriz.filter(l => temRegraAplicada(l, cfg)).length,
      qtdSemRegra: linhasMatriz.filter(l => !temRegraAplicada(l, cfg)).length,
      qtdTodas: linhasMatriz.length,
    };

    // V493: tudo que os renders (completo e incremental) precisam
    return {
      cfg, todasConv, todasPart, todasLinhasGlobais,
      convFilt, partFilt, linhasMatrizFinal,
      convComRegra, partComRegra, ctxBadges,
    };
  }

  function renderizar() {
    const conteudo = document.getElementById('conteudo');
    if (!conteudo) return;

    const d = prepararDadosRenderV493();  // V493: pipeline de dados extraído
    const cfg = d.cfg;

    // V492: CSS injetado/atualizado 1x no <head> (antes: <style> ~5.000 linhas
    // re-parseado dentro do innerHTML a cada render)
    Utilidades.garantirEstilos('css-tela-lio', cssLio());

    // V667: aba ADICIONAL — calculada a partir das particulares já filtradas
    const adicional = montarAdicionalTela(d.partFilt);
    const qtdAdic = adicional.filter(i => i.elegivel && i.calc.repasse > 0).length;

    conteudo.innerHTML = `
      <div class="lio-tela">
        ${renderHeader(cfg, d.todasLinhasGlobais)}
        ${renderPainelAjustes(cfg)}
        ${renderKpis(d.convComRegra, d.partComRegra, cfg, totalRepasseAdicional(adicional))}
        ${renderAbas(d.convFilt.length, d.partFilt.length, qtdAdic)}
        ${state.aba === 'ADICIONAL' ? renderAbaAdicional(adicional) : `
        ${renderAvisoConvenioFlagados(d.todasConv)}
        <div id="lio-diag-vazio-wrap">${
          state.aba === 'CONVENIO' && (!d.todasConv || d.todasConv.length === 0)
            ? renderDiagnosticoConvVazio() : ''}</div>
        ${renderTabela(d.linhasMatrizFinal, cfg, d.todasLinhasGlobais, d.ctxBadges)}`}
        ${renderModalMapeamento()}
        ${renderModalTeste()}
      </div>
    `;

    bindHandlers();
    // V708: o cadastro de padrões vive no ⚙ Ajustes → Adicional; os binds
    // valem na aba (switch do consolidado) E no painel de ajustes (cadastro)
    if (state.aba === 'ADICIONAL' || (state.ajustesAberto && state.ajustesPaiAba === 'ADICIONAL')) bindHandlersAdicional();
    if (!state._jaAnimou) {
      aplicarStagger();
      state._jaAnimou = true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // V493: RENDER INCREMENTAL dos filtros de texto (admissão/paciente/médico/
  // cód. paciente). Recalcula os MESMOS dados do render completo e atualiza
  // só as regiões que os filtros afetam — tbody, rodapé, contador, badges do
  // toggle, KPIs, badges das abas e o dropdown/✕ do combo ativo — usando as
  // MESMAS funções de template. Os inputs de filtro NÃO são recriados, então
  // foco e caret são preservados sem hack de re-focus.
  // Retorna false se a estrutura esperada não estiver no DOM (caller deve
  // cair no renderizar() completo).
  // ─────────────────────────────────────────────────────────────────────
  function renderParcialFiltros() {
    const telaRoot = document.querySelector('#conteudo .lio-tela');
    const tbodyEl  = document.getElementById('lio-tbody-v493');
    const tfootEl  = document.getElementById('lio-tfoot-v493');
    const kpisEl   = document.getElementById('lio-kpis-v493');
    const abasEl   = document.getElementById('lio-abas-v493');
    const infoEl   = document.getElementById('lio-painel-info-v493');
    const toggleEl = document.getElementById('lio-matriz-toggle-v493');
    if (!telaRoot || !tbodyEl || !tfootEl || !kpisEl || !abasEl || !infoEl || !toggleEl) {
      return false;  // estrutura inesperada → render completo
    }

    const d = prepararDadosRenderV493();  // incrementa __lioCalcGenV492 (memo) e refaz filtros/KPIs
    const cfg = d.cfg;
    const linhas = d.linhasMatrizFinal;

    // KPIs e badges das abas (as contagens mudam com o filtro)
    const adicParcial = montarAdicionalTela(d.partFilt);   // V708: subtotal ADD no card
    kpisEl.outerHTML = renderKpis(d.convComRegra, d.partComRegra, cfg, totalRepasseAdicional(adicParcial));
    abasEl.outerHTML = renderAbas(d.convFilt.length, d.partFilt.length,
      adicParcial.filter(i => i.elegivel && i.calc.repasse > 0).length);   // V667/V669

    // Painel da tabela: contador, badges do toggle, corpo e rodapé
    infoEl.innerHTML   = renderInfoTabelaV493(linhas, cfg);
    toggleEl.outerHTML = renderMatrizToggleV493(d.ctxBadges);
    tbodyEl.innerHTML  = renderCorpoTabelaV493(linhas, cfg);
    tfootEl.innerHTML  = linhas.length > 0 ? renderRodapeTabelaV493(linhas, cfg) : '';

    // V895: o diagnóstico do vazio acompanha o filtro — o render parcial
    // trocava a tabela e deixava o painel congelado no mês anterior
    const diagWrap = document.getElementById('lio-diag-vazio-wrap');
    if (diagWrap) {
      diagWrap.innerHTML = (state.aba === 'CONVENIO' && (!d.todasConv || d.todasConv.length === 0))
        ? renderDiagnosticoConvVazio() : '';
    }

    // Header: botão "✕ Limpar", ✕ dos combos e dropdown do combo aberto
    atualizarHeaderFiltrosV493(telaRoot, d);
    return true;
  }

  // V493: parte incremental do header — mantém os inputs intactos e atualiza
  // só os elementos que dependem do valor dos filtros, com os mesmos templates
  // do render completo (renderBtnLimparFiltrosV493 / renderBtnClearComboV493 /
  // renderDropdown).
  function atualizarHeaderFiltrosV493(telaRoot, d) {
    // 1) Botão "✕ Limpar" — aparece/some conforme filtros ativos
    const bar = telaRoot.querySelector('.lio-filtros-bar');
    const btnLimpar = document.getElementById('lio-btn-limpar-filtros');
    if (filtrosAtivosV493()) {
      if (!btnLimpar && bar) bar.insertAdjacentHTML('beforeend', renderBtnLimparFiltrosV493());
    } else if (btnLimpar) {
      btnLimpar.remove();
    }

    // 2) Combos: botão ✕ de cada campo + dropdown do campo aberto
    const sets = coletarValoresCombosV493(d.todasLinhasGlobais);
    for (const campo of ['admissao', 'paciente', 'medico', 'cod_paciente']) {
      const wrap = telaRoot.querySelector(`.lio-combo[data-combo="${campo}"]`);
      if (!wrap) continue;
      const valor = state.filtros[campo] || '';

      const btnClear = wrap.querySelector('[data-combo-clear]');
      const arrowBtn = wrap.querySelector('[data-combo-arrow]');
      if (valor && !btnClear && arrowBtn) {
        arrowBtn.insertAdjacentHTML('afterend', renderBtnClearComboV493(campo));
      } else if (!valor && btnClear) {
        btnClear.remove();
      }

      const ddAtual = wrap.querySelector('[data-dropdown]');
      if (state.dropdownAberto === campo) {
        const html = renderDropdown(campo, Array.from(sets[campo]).sort(), valor);
        if (ddAtual) ddAtual.outerHTML = html;
        else wrap.insertAdjacentHTML('beforeend', html);
        if (arrowBtn) arrowBtn.classList.add('lio-combo-arrow-aberto');
      } else {
        if (ddAtual) ddAtual.remove();
        if (arrowBtn) arrowBtn.classList.remove('lio-combo-arrow-aberto');
      }
    }
  }

  function aplicarStagger() {
    Utilidades.staggerEntrada(
      '.lio-page-header, .lio-kpi, .lio-aba, .lio-painel',
      { delay: 55, duracao: 380, deslocamento: 14 }
    );
  }

  function bindHandlers() {
    const $ = (id) => document.getElementById(id);

    // ─── Setup do redimensionamento de colunas (e aplica larguras salvas) ───
    setupResizeColunas();
    setupResizeColunasAdicional();   // V721: matriz da aba ADICIONAL

    // ═══════════════════════════════════════════════════════════════════
    // V493: DELEGAÇÃO no container estável .lio-tela
    // O render incremental (renderParcialFiltros) re-injeta tbody, rodapé,
    // abas, toggle da matriz, botão "✕ Limpar" e dropdown dos combos SEM
    // religar listeners. Tudo que vive nessas regiões é tratado aqui por
    // delegação: UM listener no root da tela (recriado a cada render
    // completo junto com o .lio-tela, então nunca duplica).
    // Os handlers por elemento correspondentes foram removidos abaixo.
    // ═══════════════════════════════════════════════════════════════════
    const telaRootV493 = document.querySelector('#conteudo .lio-tela');
    if (telaRootV493 && !telaRootV493.__lioDelegadoV493) {
      telaRootV493.__lioDelegadoV493 = true;

      telaRootV493.addEventListener('click', async (e) => {
        // ─── Drilldown (expandir/recolher linha divergente) ───
        const bExp = e.target.closest('.lio-btn-expand, .lio-btn-expand-inline');
        if (bExp) {
          e.stopPropagation();
          const k = bExp.dataset.chave;
          if (state.linhasExpandidas.has(k)) state.linhasExpandidas.delete(k);
          else state.linhasExpandidas.add(k);
          renderizar();
          return;
        }

        // V129.26: Toggle habilitar/desabilitar admissão duplicada (por linha)
        const bDup = e.target.closest('[data-dup-toggle]');
        if (bDup) {
          e.stopPropagation();
          const adm = bDup.dataset.dupToggle;
          if (!adm) return;
          const habilitou = alternarHabilitacaoAdmissao(adm);
          Utilidades.toast?.(
            habilitou
              ? `✓ Admissão ${adm} habilitada — voltou pro cálculo`
              : `✕ Admissão ${adm} desabilitada — fora do cálculo`,
            habilitou ? 'success' : 'info', 2200
          );
          renderizar();
          return;
        }

        // V129.20: Editar linha de teste
        const bEd = e.target.closest('[data-teste-editar]');
        if (bEd) {
          e.stopPropagation();
          const id = parseInt(bEd.dataset.testeEditar, 10);
          if (!id) return;
          state.testeModalAberto = true;
          state.testeEditando = id;
          renderizar();
          return;
        }

        // V129.20: Remover linha de teste
        const bRem = e.target.closest('[data-teste-remover]');
        if (bRem) {
          e.stopPropagation();
          const id = parseInt(bRem.dataset.testeRemover, 10);
          if (!id) return;
          const ok = await confirmarLio({
            titulo: 'Remover linha de teste',
            mensagem: 'Tem certeza que deseja remover esta linha de teste?',
            textoOk: 'Remover', textoCancelar: 'Cancelar', perigo: true
          });
          if (ok) {
            removerLinhaTeste(id);
            Utilidades.toast?.('Linha de teste removida', 'info', 1800);
            renderizar();
          }
          return;
        }

        // ─── Abas Convênio / Particular ───
        const bAba = e.target.closest('.lio-aba');
        if (bAba) {
          state.aba = bAba.dataset.aba;
          renderizar();
          return;
        }

        // ─── Toggle do filtro da matriz: Com regra / Sem regra / Todas ───
        const bMF = e.target.closest('[data-matriz-filtro]');
        if (bMF) {
          state.matrizFiltro = bMF.dataset.matrizFiltro;
          renderizar();
          return;
        }

        // ─── Limpar TODOS os filtros ───
        if (e.target.closest('#lio-btn-limpar-filtros')) {
          state.filtros = {
            admissao: '', paciente: '', medico: '', cod_paciente: '',
            tipos: new Set(), produtos: new Set(),
          };
          renderizar();
          return;
        }
      });

      telaRootV493.addEventListener('mousedown', (e) => {
        // Botão ✕ do combo — limpa o campo (pode ser re-injetado pelo incremental)
        const bClear = e.target.closest('[data-combo-clear]');
        if (bClear) {
          e.preventDefault();
          e.stopPropagation();
          state.filtros[bClear.dataset.comboClear] = '';
          state.dropdownAberto = null;
          renderizar();
          return;
        }
        // Clicar numa opção do dropdown — preenche e fecha (dropdown é re-injetado)
        const opt = e.target.closest('[data-combo-opt]');
        if (opt) {
          e.preventDefault();  // não tira foco do input antes de clicar
          state.filtros[opt.dataset.comboCampo] = opt.dataset.comboOpt;
          state.dropdownAberto = null;
          renderizar();
          return;
        }
      });
    }

    // ─── V727: fileira de filtros 20C (Mês/Ano/combos viraram células) ───
    bindBarraFiltrosLio20C();
    // (os binds antigos de lio-sel-mes/ano e dos combos abaixo ficam como
    // no-op — os elementos não existem mais no header)
    const selMes = $('lio-sel-mes');
    const selAno = $('lio-sel-ano');
    if (selMes) selMes.addEventListener('change', () => { state.mes = selMes.value; renderizar(); });
    if (selAno) selAno.addEventListener('change', () => { state.ano = selAno.value; renderizar(); });

    // ─── Filtros (combobox customizado: input + dropdown + clear) ───
    function bindFiltroCampo(id, chave) {
      const inp = $(id);
      if (!inp) return;
      // 1) Digitar no input: filtra a lista (e mantém o dropdown aberto)
      let t;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        const valor = inp.value;
        // Mantém o caret position
        const caret = inp.selectionStart;
        t = setTimeout(() => {
          state.filtros[chave] = valor;
          // Garante que o dropdown desse campo fique aberto enquanto digita
          state.dropdownAberto = chave;
          // V493: caminho incremental — atualiza tbody/rodapé/KPIs/contador/
          // dropdown sem recriar os inputs ⇒ foco e caret preservados
          // naturalmente (sem hack de re-focus neste caminho)
          if (renderParcialFiltros()) return;
          // V493: fallback — estrutura não encontrada → render completo
          // (hack de re-focus mantido APENAS aqui)
          renderizar();
          // Refoca o input após re-render
          const novoInp = $(id);
          if (novoInp) {
            novoInp.focus();
            try { novoInp.setSelectionRange(caret, caret); } catch (e) {}
          }
        }, 200);
      });
      // 2) Focus no input: abre dropdown
      inp.addEventListener('focus', () => {
        if (state.dropdownAberto !== chave) {
          state.dropdownAberto = chave;
          renderizar();
          // Reocaliza após re-render
          const novoInp = $(id);
          if (novoInp) novoInp.focus();
        }
      });
      // 3) Escape no input: fecha dropdown
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          state.dropdownAberto = null;
          inp.blur();
          renderizar();
        }
      });
    }
    bindFiltroCampo('lio-filt-admissao',     'admissao');
    bindFiltroCampo('lio-filt-paciente',     'paciente');
    bindFiltroCampo('lio-filt-medico',       'medico');
    bindFiltroCampo('lio-filt-cod_paciente', 'cod_paciente');

    // Botão ▾ — toggla dropdown
    document.querySelectorAll('[data-combo-arrow]').forEach(b => {
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const campo = b.dataset.comboArrow;
        state.dropdownAberto = state.dropdownAberto === campo ? null : campo;
        renderizar();
      });
    });

    // V493: "Botão ✕ limpa o campo" e "clicar numa opção do dropdown" migraram
    // pra delegação de mousedown no .lio-tela (o incremental re-injeta ambos)

    // Clicar fora de qualquer combobox fecha o dropdown aberto
    if (state.dropdownAberto && !window.__lioDropdownHandlerBound) {
      window.__lioDropdownHandlerBound = true;
      document.addEventListener('mousedown', (e) => {
        if (App.telaAtual !== 'desempenho-lio') return;  // V492: listener global nunca é removido — não age em outras telas
        if (!state.dropdownAberto) return;
        if (e.target.closest('.lio-combo')) return;
        state.dropdownAberto = null;
        renderizar();
      });
    }

    // V493: "Limpar TODOS os filtros" migrou pra delegação no .lio-tela
    // (o botão pode ser inserido/removido pelo render incremental)

    // ─── Ocultar repasse + Ajustes ───
    const chkOcultar = $('lio-chk-ocultar-repasse');
    if (chkOcultar) chkOcultar.addEventListener('change', async () => {
      await gravarConfigLio('OCULTAR_REPASSE', chkOcultar.checked ? 'true' : 'false');
      renderizar();
    });
    const btnAjustes = $('lio-btn-ajustes');
    if (btnAjustes) btnAjustes.addEventListener('click', () => {
      state.ajustesAberto = !state.ajustesAberto;
      state.regrasAberto = false;
      renderizar();
    });

    // ⓘ Botão de informações (regras LIO)
    const btnInfo = $('lio-btn-info');
    if (btnInfo) btnInfo.addEventListener('click', () => {
      state.regrasAberto = !state.regrasAberto;
      state.ajustesAberto = false;
      renderizar();
    });
    const btnInfoClose = $('lio-popover-regras-close');
    if (btnInfoClose) btnInfoClose.addEventListener('click', () => {
      state.regrasAberto = false;
      renderizar();
    });

    // ↓ Botão Exportar — abre menu com 5 opções
    const btnExportar = $('lio-btn-exportar');
    if (btnExportar) btnExportar.addEventListener('click', (e) => {
      e.stopPropagation();
      mostrarMenuExportarLio(btnExportar, lerConfigLio());
    });

    // V493: toggle da matriz (Com/Sem regra/Todas), abas Convênio/Particular e
    // drilldown de linha migraram pra delegação de click no .lio-tela — essas
    // regiões são re-injetadas pelo render incremental

    // ═══════════════════════════════════════════════════════════════════
    // PAINEL DE AJUSTES
    // ═══════════════════════════════════════════════════════════════════

    // ─── Sub-abas Convênio/Particular no painel Ajustes ───
    document.querySelectorAll('.lio-aj-sub-aba').forEach(b => {
      b.addEventListener('click', () => {
        state.ajustesAba = b.dataset.fonte;
        renderizar();
      });
    });

    // ─── Toggle MACRO (expandir/recolher) ───
    document.querySelectorAll('.lio-aj-macro-toggle').forEach(b => {
      b.addEventListener('click', () => {
        const chave = `${b.dataset.fonte}|${b.dataset.macro}`;
        if (state.macrosAbertas.has(chave)) state.macrosAbertas.delete(chave);
        else state.macrosAbertas.add(chave);
        renderizar();
      });
    });

    // ─── Toggle TIPO dentro de macro ───
    document.querySelectorAll('.lio-aj-tipo-toggle').forEach(b => {
      b.addEventListener('click', () => {
        const chave = `${b.dataset.fonte}|${b.dataset.macro}|${b.dataset.tipo}`;
        if (state.tiposAbertos.has(chave)) state.tiposAbertos.delete(chave);
        else state.tiposAbertos.add(chave);
        renderizar();
      });
    });

    // ─── Checkboxes individuais de produto (com fonte) ───
    document.querySelectorAll('.lio-aj-chk-prod').forEach(chk => {
      chk.addEventListener('change', async () => {
        await toggleProdutoExcluido(chk.dataset.produto, chk.dataset.fonte, !chk.checked);
        renderizar();
      });
    });

    // ─── Marcar/Desmarcar por MACRO ───
    document.querySelectorAll('.lio-aj-todos[data-macro]').forEach(b => {
      b.addEventListener('click', async () => {
        const macro = b.dataset.macro;
        const fonte = b.dataset.fonte;
        const acao = b.dataset.acao;

        // Pega produtos da fonte ativa que pertencem a essa macro
        const produtos = listarProdutosPorFonteEMacro(fonte, macro);
        await definirProdutosExcluidos(produtos, fonte, acao === 'nenhum');
        if (window.Utilidades && Utilidades.toast) {
          const v = acao === 'nenhum' ? 'desmarcados' : 'marcados';
          Utilidades.toast(`${produtos.length} de ${macro} ${v} em ${fonte}`, 'info', 1800);
        }
        renderizar();
      });
    });

    // ─── Marcar/Desmarcar por TIPO específico ───
    document.querySelectorAll('.lio-aj-todos[data-tipo-mini]').forEach(b => {
      b.addEventListener('click', async () => {
        const tipo = b.dataset.tipoMini;
        const fonte = b.dataset.fonte;
        const acao = b.dataset.acao;

        const produtos = listarProdutosPorFonteETipo(fonte, tipo);
        await definirProdutosExcluidos(produtos, fonte, acao === 'nenhum');
        if (window.Utilidades && Utilidades.toast) {
          const v = acao === 'nenhum' ? 'desmarcados' : 'marcados';
          Utilidades.toast(`${produtos.length} de ${tipo} ${v} em ${fonte}`, 'info', 1800);
        }
        renderizar();
      });
    });

    // ─── Marcar/Desmarcar GLOBAIS (toda a fonte ativa) ───
    document.querySelectorAll('.lio-aj-todos-global').forEach(b => {
      b.addEventListener('click', async () => {
        const acao = b.dataset.acaoGlobal;
        const fonte = b.dataset.fonte;
        const produtos = listarProdutosPorFonte(fonte);
        await definirProdutosExcluidos(produtos, fonte, acao === 'nenhum');
        if (window.Utilidades && Utilidades.toast) {
          const msg = acao === 'nenhum'
            ? `✕ ${produtos.length} produtos desmarcados em ${fonte}`
            : `✓ ${produtos.length} produtos marcados em ${fonte}`;
          Utilidades.toast(msg, 'success', 2200);
        }
        renderizar();
      });
    });

    // ─── Edição dos % executante / indicante ───
    function bindPctInput(idInput, chaveConfig, labelAmigavel) {
      const inp = $(idInput);
      if (!inp) return;
      const salvar = async () => {
        const v = parseFloat(inp.value);
        const original = parseFloat(inp.dataset.original);
        if (isNaN(v) || v < 0 || v > 100) {
          inp.value = original.toFixed(2);
          if (window.Utilidades && Utilidades.toast) {
            Utilidades.toast(`Valor inválido — deve ser entre 0 e 100`, 'error', 2400);
          }
          return;
        }
        if (Math.abs(v - original) < 0.001) return;
        await gravarConfigLio(chaveConfig, v.toFixed(2));
        if (window.Utilidades && Utilidades.toast) {
          Utilidades.toast(`✓ ${labelAmigavel} atualizado: ${v.toFixed(2)}%`, 'success', 2200);
        }
        renderizar();
      };
      inp.addEventListener('blur', salvar);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') { inp.value = inp.dataset.original; inp.blur(); }
      });
    }
    bindPctInput('lio-pct-exec', 'PCT_EXECUTANTE_GERAL', '% Executante');
    bindPctInput('lio-pct-ind',  'PCT_INDICANTE_GERAL',  '% Indicante');
    bindPctInput('lio-pct-conv', 'PCT_CONVENIO_GERAL',   '% Convênio');

    // V129.21: toggle pagar indicante 2,5%
    const chkPagarInd = document.getElementById('lio-chk-pagar-indicante');
    if (chkPagarInd) {
      chkPagarInd.addEventListener('change', async () => {
        await gravarConfigLio('PAGAR_INDICANTE_25', chkPagarInd.checked ? 'true' : 'false');
        Utilidades.toast?.(
          chkPagarInd.checked
            ? 'Repasse passa a incluir o 2,5% do indicante'
            : 'Repasse NÃO inclui mais o 2,5% do indicante',
          'info', 2200
        );
        renderizar();
      });
    }

    // V129.13: Handlers dos botões do banner de aviso da matriz CONVÊNIO
    const btnAbrirAj = document.getElementById('lio-aviso-abrir-ajustes');
    if (btnAbrirAj) {
      btnAbrirAj.addEventListener('click', () => {
        state.ajustesAberto = true;
        state.ajustesPaiAba = 'CONVENIO';
        renderizar();
      });
    }
    const btnMapear = document.getElementById('lio-aviso-mapear-conv');
    if (btnMapear) {
      btnMapear.addEventListener('click', () => {
        state.mapeamentoAberto = true;
        state.mapeamentoBusca = '';
        renderizar();
      });
    }

    // V129.15: Handlers do modal de mapeamento
    const btnFecharMap = document.getElementById('lio-map-fechar');
    const btnFooterMap = document.getElementById('lio-map-footer-fechar');
    const overlayMap = document.getElementById('lio-map-overlay');
    const fecharModalMap = () => {
      state.mapeamentoAberto = false;
      state.mapeamentoBusca = '';
      renderizar();
    };
    if (btnFecharMap) btnFecharMap.addEventListener('click', fecharModalMap);
    if (btnFooterMap) btnFooterMap.addEventListener('click', fecharModalMap);
    if (overlayMap)   overlayMap.addEventListener('click', fecharModalMap);
    // Esc fecha
    if (state.mapeamentoAberto && !window.__lioMapEscBound) {
      window.__lioMapEscBound = true;
      document.addEventListener('keydown', (e) => {
        if (App.telaAtual !== 'desempenho-lio') return;  // V492: listener global nunca é removido — não age em outras telas
        if (e.key === 'Escape' && state.mapeamentoAberto) {
          fecharModalMap();
        }
      });
    }

    // Busca no modal
    const inpMapBusca = document.getElementById('lio-map-busca');
    if (inpMapBusca) {
      let tmrMB;
      inpMapBusca.addEventListener('input', () => {
        clearTimeout(tmrMB);
        tmrMB = setTimeout(() => {
          state.mapeamentoBusca = inpMapBusca.value;
          renderizar();
        }, 180);
      });
    }
    const btnMapBuscaClear = document.getElementById('lio-map-busca-clear');
    if (btnMapBuscaClear) {
      btnMapBuscaClear.addEventListener('click', () => {
        state.mapeamentoBusca = '';
        renderizar();
      });
    }

    // Checkbox de cada candidato
    document.querySelectorAll('.lio-map-cand-check').forEach(chk => {
      chk.addEventListener('change', () => {
        const flagado = chk.dataset.flagado;
        const qvis = chk.dataset.qvis;
        if (!flagado || !qvis) return;
        // Lê aliases atuais, modifica, salva
        const atuais = new Set(listarAliasesDoFlagado(flagado));
        if (chk.checked) atuais.add(qvis);
        else atuais.delete(qvis);
        const ok = salvarAliasesDoFlagado(flagado, Array.from(atuais));
        if (ok) {
          Utilidades.toast?.(
            chk.checked
              ? `✓ "${qvis}" mapeado para "${flagado}"`
              : `↺ "${qvis}" removido de "${flagado}"`,
            'success', 1800
          );
          renderizar();
        }
      });
    });

    // V129.20: Botão "Inserir teste" no header → abre modal (nova linha)
    const btnInserirTeste = document.getElementById('lio-btn-inserir-teste');
    if (btnInserirTeste) {
      btnInserirTeste.addEventListener('click', () => {
        state.testeModalAberto = true;
        state.testeEditando = null;
        renderizar();
      });
    }

    // V493: toggle de admissão duplicada, editar e remover linha de teste
    // (botões DENTRO do tbody, que o incremental re-injeta) migraram pra
    // delegação de click no .lio-tela

    // V129.20: Handlers do modal de teste
    bindHandlersModalTeste();

    // V129.17: Click no subtítulo "Origem" → abre/fecha menu
    document.querySelectorAll('[data-trocar-col]').forEach(el => {
      el.addEventListener('click', (e) => {
        // Ignora clicks no menu interno
        if (e.target.closest('.lio-th-origem-menu')) return;
        e.stopPropagation();
        const col = el.dataset.trocarCol;
        if (!col) return;
        state.menuOrigemCol = (state.menuOrigemCol === col) ? null : col;
        renderizar();
      });
    });

    // V129.17: Click numa opção do menu → troca fonte e salva
    document.querySelectorAll('[data-trocar-fonte]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const [colId, fonteId] = (btn.dataset.trocarFonte || '').split('|');
        if (!colId || !fonteId) return;
        const ok = await salvarOrigemColuna(colId, fonteId);
        state.menuOrigemCol = null;
        if (ok) {
          const col = COLUNAS_MATRIZ_CONV[colId];
          const fonte = col ? col.fontes.find(f => f.id === fonteId) : null;
          Utilidades.toast?.(
            `✓ "${col?.titulo || colId}" agora vem de: ${fonte?.label || fonteId}`,
            'success', 2200
          );
        }
        renderizar();
      });
    });

    // V129.17: Click fora fecha o menu de origem
    if (state.menuOrigemCol && !window.__lioMenuOrigemBound) {
      window.__lioMenuOrigemBound = true;
      document.addEventListener('mousedown', (e) => {
        if (App.telaAtual !== 'desempenho-lio') return;  // V492: listener global nunca é removido — não age em outras telas
        if (!state.menuOrigemCol) return;
        const wrap = e.target.closest('[data-trocar-col]');
        if (!wrap) {
          state.menuOrigemCol = null;
          if (typeof renderizar === 'function') renderizar();
        }
      });
    }

    // V129.18: Posicionar o menu de origem (position: fixed)
    // Como o menu está dentro de containers com overflow: hidden,
    // calculamos as coordenadas absolutas via getBoundingClientRect
    if (state.menuOrigemCol) {
      requestAnimationFrame(() => {
        const trigger = document.querySelector(`[data-trocar-col="${state.menuOrigemCol}"]`);
        if (!trigger) return;
        const menu = trigger.querySelector('.lio-th-origem-menu');
        if (!menu) return;
        const rect = trigger.getBoundingClientRect();
        const menuW = menu.offsetWidth || 220;
        // Posiciona logo abaixo do trigger
        let left = rect.left;
        // Não deixa sair da tela à direita
        if (left + menuW > window.innerWidth - 10) {
          left = window.innerWidth - menuW - 10;
        }
        menu.style.top  = (rect.bottom + 4) + 'px';
        menu.style.left = left + 'px';
        menu.classList.add('lio-th-origem-menu-visivel');
      });
    }

    // V129: handler das abas PAI (Convênio | Particular)
    document.querySelectorAll('[data-pai-aba]').forEach(btn => {
      btn.addEventListener('click', () => {
        const novaAba = btn.dataset.paiAba;
        if (novaAba && novaAba !== state.ajustesPaiAba) {
          state.ajustesPaiAba = novaAba;
          // Quando entra em PARTICULAR, força a sub-aba dos produtos pra Particular
          if (novaAba === 'PARTICULAR') state.ajustesAba = 'PARTICULAR';
          renderizar();
        }
      });
    });

    // ── V645: EXCETO — adicionar/remover termos de exclusão da classificação LIO ──
    const btnExcetoAdd = document.getElementById('lio-exceto-add');
    if (btnExcetoAdd) btnExcetoAdd.addEventListener('click', () => {
      state.excetoAdicionando = true;
      renderizar();
      setTimeout(() => { const i = document.getElementById('lio-exceto-input'); if (i) i.focus(); }, 40);
    });
    const inpExceto = document.getElementById('lio-exceto-input');
    if (inpExceto) {
      setTimeout(() => inpExceto.focus(), 40);
      let exSalvo = false;   // Enter dispara blur após o re-render — evita salvar 2×
      const salvarExceto = () => {
        if (exSalvo) return;
        exSalvo = true;
        const v = String(inpExceto.value || '').trim();
        state.excetoAdicionando = false;
        if (v) {
          excetoGarantirTabela();
          const ja = excetoListar().some(t => _excetoNorm(t.termo) === _excetoNorm(v));
          if (!ja) {
            Banco.executar(`INSERT INTO lio_exceto_termos (termo) VALUES (?)`, [v.toUpperCase()]);
            _excetoMemo = null;
            Banco.salvarDebounced && Banco.salvarDebounced();
            Utilidades.toast?.(`✓ Termo "${v.toUpperCase()}" excluído da classificação LIO — a matriz já reflete.`, 'success', 4000);
          }
        }
        renderizar();
      };
      inpExceto.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { exSalvo = true; state.excetoAdicionando = false; renderizar(); return; }
        if (e.key === 'Enter') salvarExceto();
      });
      inpExceto.addEventListener('blur', salvarExceto);
    }
    document.querySelectorAll('[data-exceto-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        try {
          Banco.executar(`DELETE FROM lio_exceto_termos WHERE id = ?`, [Number(btn.dataset.excetoId)]);
          _excetoMemo = null;
          Banco.salvarDebounced && Banco.salvarDebounced();
        } catch (e) { console.warn('[LIO] exceto remover:', e); }
        renderizar();
      });
    });

    // V129.3: handlers do modal — botão ✕ e clique no overlay (backdrop)
    const btnCloseModal = document.getElementById('lio-ajustes-close-modal');
    if (btnCloseModal) {
      btnCloseModal.addEventListener('click', () => {
        state.ajustesAberto = false;
        renderizar();
      });
    }
    const overlayMod = document.getElementById('lio-ajustes-overlay');
    if (overlayMod) {
      overlayMod.addEventListener('click', () => {
        state.ajustesAberto = false;
        renderizar();
      });
    }
    // Esc também fecha
    if (state.ajustesAberto && !window.__lioEscBound) {
      window.__lioEscBound = true;
      document.addEventListener('keydown', (e) => {
        if (App.telaAtual !== 'desempenho-lio') return;  // V492: listener global nunca é removido — não age em outras telas
        if (e.key === 'Escape' && state && state.ajustesAberto) {
          state.ajustesAberto = false;
          if (typeof renderizar === 'function') renderizar();
        }
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // V129.4: BUSCA DE CONVÊNIOS ELEGÍVEIS
    // ═══════════════════════════════════════════════════════════════════
    const inpConvBusca = document.getElementById('lio-conv-busca');
    if (inpConvBusca) {
      let tmrCB;
      inpConvBusca.addEventListener('input', () => {
        clearTimeout(tmrCB);
        tmrCB = setTimeout(() => {
          state.convBusca = inpConvBusca.value;
          state.convDropdownAberto = true;
          renderizar();
        }, 180);
      });
      inpConvBusca.addEventListener('focus', () => {
        if (!state.convDropdownAberto) {
          state.convDropdownAberto = true;
          renderizar();
        }
      });
      inpConvBusca.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          state.convDropdownAberto = false;
          renderizar();
        }
      });
    }

    // Botão limpar busca (✕)
    const btnCBClear = document.getElementById('lio-conv-busca-clear');
    if (btnCBClear) {
      btnCBClear.addEventListener('mousedown', (e) => {
        e.preventDefault();
        state.convBusca = '';
        state.convDropdownAberto = false;
        renderizar();
      });
    }

    // Click num item do dropdown → flaga (ou desflaga se já flagado)
    document.querySelectorAll('[data-conv-flagar]').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        // Se o click foi diretamente no input checkbox, deixa o handler do checkbox lidar
        if (e.target.tagName === 'INPUT') return;
        e.preventDefault();
        const conv = item.dataset.convFlagar;
        if (!conv) return;
        const flagados = listarConveniosFlagados();
        const jaFlagado = flagados.some(f => f.convenio === conv);
        if (jaFlagado) {
          desflagarConvenio(conv);
        } else {
          flagarConvenio(conv);
        }
        renderizar();
      });
    });

    // V129.6: change no checkbox do item
    document.querySelectorAll('[data-conv-check]').forEach(chk => {
      chk.addEventListener('change', (e) => {
        e.stopPropagation();
        const conv = chk.dataset.convCheck;
        if (!conv) return;
        if (chk.checked) {
          flagarConvenio(conv);
        } else {
          desflagarConvenio(conv);
        }
        renderizar();
      });
    });

    // Click no ✕ de um convênio flagado → remove
    document.querySelectorAll('[data-conv-desflagar]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const conv = btn.dataset.convDesflagar;
        if (!conv) return;
        const stat = contarOpmesDoConvenio(conv);
        const temTabela = stat.n > 0;
        const ok = await confirmarLio({
          titulo: 'Remover convênio fixado?',
          mensagem:
            `Remover <strong>"${escapeHTML(conv)}"</strong> da lista de convênios fixados?` +
            (temTabela
              ? `\n\n<em>Atenção:</em> as <strong>${stat.n} linhas</strong> de OPMEs importados <strong>continuam no banco</strong>. Pra apagar a tabela use o botão "Excluir importação" antes.`
              : ''),
          textoOk: 'Remover',
          textoCancelar: 'Cancelar',
          perigo: temTabela
        });
        if (ok) {
          desflagarConvenio(conv);
          renderizar();
        }
      });
    });

    // V129.8: Botão "Excluir importação" — apaga TODOS os OPMEs do convênio
    document.querySelectorAll('[data-conv-excluir-tabela]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const conv = btn.dataset.convExcluirTabela;
        if (!conv) return;
        const stat = contarOpmesDoConvenio(conv);
        const ok = await confirmarLio({
          titulo: 'Excluir tabela importada?',
          mensagem:
            `Excluir TODOS os <strong>${stat.n || 0} OPMEs importados</strong> de <strong>"${escapeHTML(conv)}"</strong>?\n\n` +
            `O convênio continua flagado, mas a tabela será apagada. Esta ação <strong>não pode ser desfeita</strong>.`,
          textoOk: 'Excluir tabela',
          textoCancelar: 'Cancelar',
          perigo: true
        });
        if (!ok) return;
        try {
          Banco.executar(`DELETE FROM lio_opme_tabela WHERE convenio = ?`, [conv]);
          Banco.salvar();
          if (state.convExpandidos) state.convExpandidos.delete(conv);
          Utilidades.toast?.(`✓ Tabela de "${conv}" excluída`, 'success', 2800);
          renderizar();
        } catch (err) {
          console.error('[LIO V129.8] excluir importação:', err);
          Utilidades.toast?.('Erro ao excluir tabela', 'error', 2500);
        }
      });
    });

    // V129.7: Click no botão "↑ Importar planilha" / "↻ Re-importar"
    document.querySelectorAll('[data-conv-importar]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const conv = btn.dataset.convImportar;
        if (!conv) return;

        // Cria file input dinâmico (oculto), dispara e remove depois
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', async () => {
          const file = input.files && input.files[0];
          if (!file) {
            if (input.parentNode) input.parentNode.removeChild(input);
            return;
          }
          const ok = await importarPlanilhaConvenio(file, conv);
          if (input.parentNode) input.parentNode.removeChild(input);
          if (ok) {
            // Expande automaticamente após importar
            if (!state.convExpandidos) state.convExpandidos = new Set();
            state.convExpandidos.add(conv);
            renderizar();
          }
        });

        input.click();
      });
    });

    // V129.7: Toggle expandir/recolher convênio flagado
    document.querySelectorAll('[data-conv-toggle]').forEach(el => {
      el.addEventListener('click', (e) => {
        // Ignora clicks em botões/inputs dentro do header
        if (e.target.closest('button, input')) return;
        const conv = el.dataset.convToggle;
        if (!conv) return;
        if (!state.convExpandidos) state.convExpandidos = new Set();
        if (state.convExpandidos.has(conv)) {
          state.convExpandidos.delete(conv);
        } else {
          state.convExpandidos.add(conv);
        }
        renderizar();
      });
    });

    // V129.7: Checkbox de ativar/desativar OPME no drilldown
    document.querySelectorAll('.lio-conv-opme-check').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = parseInt(chk.dataset.opmeId, 10);
        if (!id) return;
        try {
          Banco.executar(`UPDATE lio_opme_tabela SET ativo = ? WHERE id = ?`, [chk.checked ? 1 : 0, id]);
          Banco.salvar();
          renderizar();
        } catch (e) {
          console.error('[LIO V129.7] toggle ativo falhou:', e);
        }
      });
    });

    // V129.7: Edição inline de Valor LIO / Valor FACO
    document.querySelectorAll('.lio-conv-opme-valor').forEach(inp => {
      const valorOriginal = inp.value;
      const salvar = () => {
        const id = parseInt(inp.dataset.opmeId, 10);
        const campo = inp.dataset.campo;
        if (!id || !campo) return;
        const v = parseFloat(inp.value);
        if (isNaN(v) || v < 0) {
          inp.value = valorOriginal;
          Utilidades.toast?.('Valor inválido', 'error', 2000);
          return;
        }
        if (Math.abs(v - parseFloat(valorOriginal)) < 0.001) return;
        try {
          // SQL identifier não pode ser parametrizado; whitelisting:
          const colsValidas = { valor_lio: 'valor_lio', valor_faco: 'valor_faco' };
          if (!colsValidas[campo]) return;
          Banco.executar(`UPDATE lio_opme_tabela SET ${colsValidas[campo]} = ? WHERE id = ?`, [v, id]);
          Banco.salvar();
          Utilidades.toast?.(`✓ ${campo === 'valor_lio' ? 'Valor LIO' : 'Valor FACO'} atualizado: R$ ${Utilidades.formatarNumero(v, 2)}`, 'success', 1800);   // V944
        } catch (e) {
          console.error('[LIO V129.7] edição inline falhou:', e);
          Utilidades.toast?.('Erro ao salvar', 'error', 2000);
        }
      };
      inp.addEventListener('blur', salvar);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') { inp.value = valorOriginal; inp.blur(); }
      });
    });

    // V129.11: Toggle do botão "🏷️ Termos consolidados"
    document.querySelectorAll('[data-conv-consolidado]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const conv = btn.dataset.convConsolidado;
        if (!conv) return;
        if (!state.consolidadoAberto) state.consolidadoAberto = new Set();
        if (state.consolidadoAberto.has(conv)) {
          state.consolidadoAberto.delete(conv);
        } else {
          state.consolidadoAberto.add(conv);
        }
        renderizar();
      });
    });

    // V129.11: Click no ✕ de um chip consolidado → remove de TODAS as linhas
    document.querySelectorAll('[data-conv-consolidado-remover]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const conv = btn.dataset.convConsolidadoRemover;
        const termo = btn.dataset.termo;
        if (!conv || !termo) return;

        // Conta quantas linhas serão afetadas (UI feedback)
        const termosConsolidados = consolidarTermosDoConvenio(conv);
        const entry = termosConsolidados.find(t => t.termo === termo);
        const n = entry ? entry.n : 0;

        const ok = await confirmarLio({
          titulo: 'Remover termo em massa?',
          mensagem:
            `Remover o termo <strong>"${escapeHTML(termo)}"</strong> de <strong>TODAS as ${n} linha(s)</strong> deste convênio?\n\n` +
            `Isso vai apagar essa palavra do padrão de busca em todos os OPMEs onde aparece.\n` +
            `Esta ação <strong>não pode ser desfeita</strong> (mas você pode re-adicioná-la manualmente).`,
          textoOk: 'Remover de todas',
          textoCancelar: 'Cancelar',
          perigo: true
        });
        if (!ok) return;

        const afetadas = removerTermoDeTodasLinhas(conv, termo);
        if (afetadas > 0) {
          Utilidades.toast?.(
            `✓ "${termo}" removido de ${afetadas} linha(s)`,
            'success', 2500
          );
          renderizar();
        } else {
          Utilidades.toast?.('Nenhuma linha afetada', 'info', 2000);
        }
      });
    });

    document.querySelectorAll('.lio-conv-chip-texto').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(el.dataset.opmeId, 10);
        const indice = parseInt(el.dataset.indice, 10);
        if (isNaN(id) || isNaN(indice)) return;
        state.editandoChip = { idOpme: id, indice };
        renderizar();
      });
    });

    // V129.10: Input de edição de chip → Enter salva, Esc cancela
    document.querySelectorAll('.lio-conv-chip-edit-input').forEach(inp => {
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
      const valorOriginal = inp.value;
      const cancelar = () => {
        state.editandoChip = null;
        renderizar();
      };
      const confirmar = () => {
        const id = parseInt(inp.dataset.opmeId, 10);
        const indice = parseInt(inp.dataset.indice, 10);
        const novoValor = inp.value.trim();
        if (isNaN(id) || isNaN(indice)) { cancelar(); return; }
        if (novoValor.toUpperCase() === valorOriginal.toUpperCase()) {
          cancelar();
          return;
        }
        const ok = editarTermo(id, indice, novoValor);
        state.editandoChip = null;
        if (ok) {
          Utilidades.toast?.(
            novoValor === '' ? '↺ Termo removido' : `✓ Termo atualizado: "${novoValor.toUpperCase()}"`,
            'success', 1800
          );
        }
        renderizar();
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
        if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
      });
      inp.addEventListener('blur', () => {
        setTimeout(() => {
          if (state.editandoChip
              && state.editandoChip.idOpme === parseInt(inp.dataset.opmeId, 10)
              && state.editandoChip.indice === parseInt(inp.dataset.indice, 10)) {
            confirmar();
          }
        }, 150);
      });
    });

    // V129.10: Click no ✕ de um chip → remove
    document.querySelectorAll('.lio-conv-chip-remover').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.opmeId, 10);
        const indice = parseInt(btn.dataset.indice, 10);
        if (isNaN(id) || isNaN(indice)) return;
        const ok = removerTermo(id, indice);
        if (ok) {
          Utilidades.toast?.('↺ Termo removido', 'success', 1500);
          renderizar();
        }
      });
    });

    // V129.10: Click no botão "+ Adicionar termo" → ativa input inline
    document.querySelectorAll('.lio-conv-chip-add').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.opmeId, 10);
        if (!id) return;
        state.adicionandoPadrao = id;
        renderizar();
      });
    });

    // V129.10: Input pra digitar o novo termo → Enter adiciona, Esc cancela
    document.querySelectorAll('.lio-conv-padrao-novo-input').forEach(inp => {
      setTimeout(() => inp.focus(), 0);
      const cancelar = () => {
        state.adicionandoPadrao = null;
        renderizar();
      };
      const confirmar = () => {
        const id = parseInt(inp.dataset.opmeId, 10);
        const valor = inp.value.trim();
        if (!id || !valor) { cancelar(); return; }
        const ok = adicionarTermo(id, valor);
        state.adicionandoPadrao = null;
        if (ok) {
          Utilidades.toast?.(`✓ Termo "${valor.toUpperCase()}" adicionado`, 'success', 1800);
        }
        renderizar();
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
        if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
      });
      inp.addEventListener('blur', () => {
        setTimeout(() => {
          if (state.adicionandoPadrao === parseInt(inp.dataset.opmeId, 10)) {
            confirmar();
          }
        }, 150);
      });
    });

    // Click fora fecha o dropdown
    if (!window.__lioConvBuscaHandlerBound) {
      window.__lioConvBuscaHandlerBound = true;
      document.addEventListener('mousedown', (e) => {
        if (!state || !state.convDropdownAberto) return;
        const wrap = e.target.closest('[data-conv-busca]');
        if (!wrap) {
          state.convDropdownAberto = false;
          if (typeof renderizar === 'function') renderizar();
        }
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // PERSONALIZAÇÃO DE RÓTULOS (V128)
    // ═══════════════════════════════════════════════════════════════════
    document.querySelectorAll('.lio-aj-rotulo-input').forEach(inp => {
      const salvar = () => {
        const chave = inp.dataset.rotChave;
        const val = inp.value.trim();
        try {
          if (val === '' || val === LABELS_PADRAO_LIO[chave]) {
            // Vazio ou igual ao padrão: remove personalização
            Banco.executar(`DELETE FROM config_lio WHERE chave = ?`, ['ROT_' + chave]);
          } else {
            Banco.executar(`
              INSERT OR REPLACE INTO config_lio (chave, valor)
              VALUES (?, ?)
            `, ['ROT_' + chave, val]);
          }
          Banco.salvar();
          invalidarRotulosLio();
          renderizar();
        } catch (e) {
          console.error('[LIO] Erro ao salvar rótulo', chave, e);
          Utilidades.toast?.('Erro ao salvar rótulo', 'error');
        }
      };
      inp.addEventListener('blur', salvar);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      });
    });

    // Botão "Restaurar padrão"
    const btnResetRot = document.getElementById('lio-rot-resetar');
    if (btnResetRot) {
      btnResetRot.addEventListener('click', async () => {
        const ok = await confirmarLio({
          titulo: 'Restaurar rótulos?',
          mensagem: 'Restaurar <strong>TODOS</strong> os rótulos personalizados ao padrão original?',
          textoOk: 'Restaurar',
          textoCancelar: 'Cancelar',
          perigo: false
        });
        if (!ok) return;
        try {
          Banco.executar(`DELETE FROM config_lio WHERE chave LIKE 'ROT_%'`);
          Banco.salvar();
          invalidarRotulosLio();
          renderizar();
          Utilidades.toast?.('Rótulos restaurados', 'success');
        } catch (e) {
          console.error('[LIO] Erro ao resetar rótulos', e);
        }
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // POPOVERS DE FILTRO DE COLUNA (Tipo / Produto)
    // ═══════════════════════════════════════════════════════════════════

    // Abrir/fechar popover ao clicar no botão ▾ do header
    document.querySelectorAll('.lio-th-filter-btn').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const col = b.dataset.coluna;
        state.popoverColuna = state.popoverColuna === col ? null : col;
        renderizar();
      });
    });
    // Fechar popover ao clicar no X
    document.querySelectorAll('[data-popover-close]').forEach(b => {
      b.addEventListener('click', () => { state.popoverColuna = null; renderizar(); });
    });
    // "Mostrar todos" do popover (limpa o set)
    document.querySelectorAll('[data-popover-todos]').forEach(b => {
      b.addEventListener('click', () => {
        const col = b.dataset.popoverTodos;
        if (col === 'tipo') state.filtros.tipos.clear();
        else if (col === 'produto') state.filtros.produtos.clear();
        renderizar();
      });
    });
    // Toggle valor individual do popover
    document.querySelectorAll('[data-popover-valor]').forEach(chk => {
      chk.addEventListener('change', () => {
        const col = chk.dataset.popoverColuna;
        const val = chk.dataset.popoverValor;
        const set = col === 'tipo' ? state.filtros.tipos : state.filtros.produtos;
        if (chk.checked) set.add(val); else set.delete(val);
        renderizar();
      });
    });
    // Fechar popover ao clicar fora dele
    if (state.popoverColuna && !window.__lioPopoverHandlerBound) {
      window.__lioPopoverHandlerBound = true;
      document.addEventListener('click', (e) => {
        if (!state.popoverColuna) return;
        if (e.target.closest('.lio-th-popover')) return;
        if (e.target.closest('.lio-th-filter-btn')) return;
        state.popoverColuna = null;
        renderizar();
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // HELPERS: listar produtos por fonte / fonte+macro / fonte+tipo
  // ───────────────────────────────────────────────────────────────────────
  function listarProdutosPorFonte(fonte) {
    const f = String(fonte).toUpperCase();
    const fonteSQL = f === 'PARTICULAR' ? 'PARTICULAR' : 'CONVÊNIO';
    try {
      const rows = Banco.query(`
        SELECT DISTINCT produto
          FROM linhas_producao
         WHERE classificacao_produto = 'OPME'
           AND produto IS NOT NULL AND produto <> ''
           AND UPPER(COALESCE(tipo_recebimento,'')) = UPPER(?)
           AND (
             UPPER(COALESCE(tipo_produto,'')) LIKE '%LIO%'
             OR UPPER(COALESCE(tipo_produto,'')) = 'LENTE INTRA OCULAR'
             OR UPPER(COALESCE(tipo_produto,'')) = 'SERVICO DE LIO'
           )
      `, [fonteSQL]);
      return rows.map(r => r.produto);
    } catch (e) { console.warn(e); return []; }
  }

  function listarProdutosPorFonteEMacro(fonte, macro) {
    return listarProdutosPorFonteCompleto(fonte).filter(p => getMacroCategoria(p.tipo_produto) === macro).map(p => p.produto);
  }

  function listarProdutosPorFonteETipo(fonte, tipo) {
    return listarProdutosPorFonteCompleto(fonte).filter(p => (p.tipo_produto || '— sem tipo —') === tipo).map(p => p.produto);
  }

  /** Versão com tipo_produto pra suportar filtragem por macro/tipo. */
  function listarProdutosPorFonteCompleto(fonte) {
    const f = String(fonte).toUpperCase();
    const fonteSQL = f === 'PARTICULAR' ? 'PARTICULAR' : 'CONVÊNIO';
    try {
      const rows = Banco.query(`
        SELECT DISTINCT produto, tipo_produto
          FROM linhas_producao
         WHERE classificacao_produto = 'OPME'
           AND produto IS NOT NULL AND produto <> ''
           AND UPPER(COALESCE(tipo_recebimento,'')) = UPPER(?)
           AND (
             UPPER(COALESCE(tipo_produto,'')) LIKE '%LIO%'
             OR UPPER(COALESCE(tipo_produto,'')) = 'LENTE INTRA OCULAR'
             OR UPPER(COALESCE(tipo_produto,'')) = 'SERVICO DE LIO'
           )
      `, [fonteSQL]);
      return rows;
    } catch (e) { console.warn(e); return []; }
  }

  // ───────────────────────────────────────────────────────────────────────
  // CSS
  // ───────────────────────────────────────────────────────────────────────
  function cssLio() {
    return `
      .lio-tela {
        position: relative;
        z-index: 1;
        padding: 14px 22px 22px;
        font-family: inherit;
        display: flex;
        flex-direction: column;
        /**
         * V864: a altura era calc(100vh - 60px) — um CHUTE de 60px para tudo
         * que existe acima da tela. O topo real é maior (medido: 81px), então a
         * tela inteira terminava ABAIXO do fim da janela: o painel da matriz,
         * que tem overflow hidden, cortava a última faixa de linhas, e o rodapé
         * do app subia por cima dela — a tarja escura no fim do cartão.
         *
         * Agora a altura é MÍNIMA, não fixa: em tela folgada ela preenche a
         * janela como antes; quando filtros + cards + abas + avisos apertam, a
         * página cresce e rola em vez de cortar. E a matriz tem um piso próprio,
         * para nunca ficar espremida em duas linhas.
         */
        min-height: calc(100vh - 60px);
        box-sizing: border-box;
        max-width: 1600px;       /* V129.27: limita largura em telas grandes */
        margin: 0 auto;          /* V129.27: centraliza o conteúdo */
        width: 100%;
      }
      /* ── Header alinhado ao OPME (usa .page-header global) ── */
      .lio-page-header {
        flex-shrink: 0;
        margin-bottom: 12px;
        align-items: flex-start;
      }
      .lio-page-header-esq {
        flex: 1;
        min-width: 0;
      }
      .lio-page-header-dir {
        flex-shrink: 0;
        margin-left: 16px;
      }
      /* Wrap do título + botão de info — igual LC */
      .lio-titulo-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 2px;
      }
      .lio-btn-info {
        width: 28px; height: 28px;
        border-radius: 50%;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        color: #2a5a8c;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        display: inline-flex;
        align-items: center; justify-content: center;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        line-height: 1;
        box-shadow: 0 1px 3px rgba(20, 51, 82,0.08);
      }
      .lio-btn-info:hover {
        background: #2a5a8c;
        color: white;
        border-color: #2a5a8c;
        transform: scale(1.08);
        box-shadow: 0 3px 8px rgba(42, 90, 140,0.30);
      }
      .lio-btn-info-ativo {
        background: #2a5a8c;
        color: white;
        border-color: #2a5a8c;
      }

      /* Popover das regras LIO */
      .lio-popover-regras {
        position: relative;
        margin: 8px 0 10px;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-left: 4px solid #2a5a8c;
        border-radius: 8px;
        padding: 14px 18px 12px;
        max-width: 720px;
        box-shadow: 0 4px 14px rgba(11, 35, 64,0.10);
        animation: lioPopIn 200ms ease-out;
      }
      @keyframes lioPopIn {
        from { opacity: 0; transform: translateY(-6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .lio-popover-regras-head {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 6px;
      }
      .lio-popover-regras-head strong {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #2a5a8c;
      }
      .lio-popover-regras-close {
        background: transparent;
        border: none;
        color: var(--ink-faint);
        cursor: pointer;
        font-size: 14px;
        padding: 2px 6px;
        border-radius: 3px;
      }
      .lio-popover-regras-close:hover { color: var(--ink); background: var(--bg-sunken); }
      .lio-popover-regras-body p {
        margin: 0 0 6px;
        font-size: 12px;
        color: var(--ink-soft);
        line-height: 1.55;
      }
      .lio-popover-regras-body p:last-child { margin-bottom: 0; }
      .lio-popover-regras-body code {
        background: var(--bg-sunken);
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 11px;
        color: var(--primary);
        border: 1px solid var(--border);
      }
      .lio-popover-regras-body strong { color: var(--primary); }
      /* ── V727: fileira de filtros 20C (padrão do OPME, prefixo do LIO) ── */
          .lio-sb {
        margin-bottom: 14px;   /* V731: respiro antes dos cards */
            position: relative; z-index: 30;
            display: flex; align-items: stretch;
            margin-top: 10px; padding: 6px;
            background: #fff;
            border: 1px solid #e4ecf4;
            border-radius: 12px;
            box-shadow: 0 1px 2px rgba(20, 51, 82,.04), 0 10px 26px -20px rgba(20, 51, 82,.26);
            flex-wrap: wrap;
          }
          .lio-sb-celwrap { position: relative; min-width: 150px; display: flex; }
          .lio-sb-celwrap:not(:last-child) .lio-sb-cel { border-right: 1px solid #f0f4f8; }
          .lio-sb-cel {
            flex: 1; min-width: 0;
            display: flex; align-items: center; gap: 9px;
            padding: 9px 12px; border: none; border-radius: 9px;
            background: transparent; cursor: pointer;
            font-family: inherit; text-align: left;
            transition: background-color 120ms;
          }
          .lio-sb-cel:hover, .lio-sb-cel.ativo, .lio-sb-cel.aberta { background: #f6f4ef; }
          .lio-sb-cel:focus-visible { outline: 2px solid #2a5a8c; outline-offset: 2px; }
          .lio-sb-tile {
            width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
            background: #f0f5f9; color: #5a6879;
          }
          .lio-sb-cel.ativo .lio-sb-tile, .lio-sb-cel.aberta .lio-sb-tile { background: #e4ecf4; color: #1d4470; }
          .lio-sb-tx { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
          .lio-sb-rot {
            font-size: 10px; font-weight: 700; text-transform: uppercase;
            letter-spacing: .09em; color: #5a6879; white-space: nowrap;
          }
          .lio-sb-val {
            font-size: 13px; font-weight: 500; color: #5a6879;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          }
          .lio-sb-cel.ativo .lio-sb-val { font-weight: 700; color: #12304f; }
          .lio-sb-chev { color: #96a2b1; flex-shrink: 0; display: flex; transition: transform 140ms; }
          .lio-sb-cel.aberta .lio-sb-chev { transform: rotate(180deg); }

          /* painel ancorado na célula, por cima dos cards */
          .lio-sb-painel {
            position: absolute; top: 100%; left: 0; margin-top: 6px; z-index: 40;
            min-width: 100%; width: max-content; max-width: 340px;
            background: #fff; border: 1px solid #dfe4ea; border-radius: 12px;
            box-shadow: 0 18px 44px -14px rgba(11, 35, 64,.42);
            overflow: hidden;
          }
          .lio-sb-buscabox {
            display: flex; align-items: center; gap: 8px;
            padding: 11px 12px 10px; border-bottom: 1px solid #f0f4f8;
          }
          .lio-sb-buscabox .lio-sb-busca-ic { color: #6b7d8e; display: flex; }
          .lio-sb-busca {
            flex: 1; height: 30px; border: 1px solid #dfe4ea; border-radius: 8px;
            background: #f6f4ef; padding: 0 10px; font-size: 13px;
            font-family: inherit; color: #12304f; outline: none;
          }
          .lio-sb-busca::placeholder { color: #96a2b1; }
          .lio-sb-busca:focus { border-color: #2a5a8c; }
          .lio-sb-lista { max-height: 262px; overflow-y: auto; padding: 6px; }
          .lio-sb-lista::-webkit-scrollbar { width: 8px; }
          .lio-sb-lista::-webkit-scrollbar-track { background: #f0f4f8; }
          .lio-sb-lista::-webkit-scrollbar-thumb { background: #c5d5e5; border-radius: 4px; }
          .lio-sb-it {
            display: flex; align-items: center; gap: 10px;
            height: 38px; padding: 0 8px; border-radius: 8px; cursor: pointer;
            font-size: 13px; color: #12304f;
          }
          .lio-sb-it:hover, .lio-sb-it.foco { background: #f0f4f8; }
          .lio-sb-it.sel { background: #f0f4f8; font-weight: 700; }
          .lio-sb-it-todos { font-weight: 700; }
          .lio-sb-it-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .lio-sb-ck { color: #1d4470; display: flex; }
          .lio-sb-chip {
            width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
            background: #f0f4f8; color: #1d4470; font-size: 9.5px; font-weight: 700;
          }
          .lio-sb-rodape {
            padding: 7px 12px; border-top: 1px solid #f0f4f8;
            font-size: 10.5px; font-weight: 600; color: #96a2b1;
          }
          @media (max-width: 1280px) { .lio-sb-celwrap { flex-basis: 32%; } }
          @media (max-width: 900px)  { .lio-sb-celwrap { flex-basis: 48%; } }

      .lio-filtros-bar {
        /* V727: virou o CONTÊINER da peça 20C (.lio-sb) + botão "✕ Limpar" —
           o grid de 6 colunas antigo saiu junto com os combos/selects */
        display: flex !important;
        flex-direction: column;
        gap: 6px !important;
        align-items: stretch;   /* V730: a peça 20C estica de ponta a ponta */
        /* V731: a animação global fade-in-up deixa transform residual nos
           irmãos → cada um vira stacking context; sem z-index os painéis
           abririam POR BAIXO dos cards (mesmo fix dos outros módulos). */
        position: relative;
        z-index: 30;
        margin-top: 10px;
        padding-top: 0;
        width: 100% !important;
        box-sizing: border-box !important;
      }
      /* TODOS os filhos diretos da barra: ocupam 100% da sua cell */
      .lio-filtros-bar > .lio-mes-wrap,
      .lio-filtros-bar > .lio-filt-wrap {
        display: inline-flex !important;
        flex-direction: row !important;
        align-items: center !important;
        gap: 0 !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      /* Inputs/selects internos: SEMPRE 100% da sua cell */
      .lio-filtros-bar .lio-combo-inner {
        display: flex !important;
        position: relative !important;
        width: 100% !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
      }
      .lio-filtros-bar .lio-filt-input,
      .lio-filtros-bar .lio-combo-input,
      .lio-filtros-bar .lio-mes-select {
        width: auto !important;
        min-width: 0 !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      /* Checkbox "Ocultar R$ Repasse" no header direito */
      .lio-chk-header {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 8px;
        cursor: pointer;
        font-size: 11.5px;
        color: var(--ink-soft);
        font-weight: 600;
        white-space: nowrap;
        margin-right: 8px;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .lio-chk-header:hover {
        background: var(--bg-sunken);
        border-color: var(--accent);
      }
      .lio-chk-header input {
        accent-color: var(--accent);
        cursor: pointer;
      }
      .lio-page-header-dir {
        display: flex;
        align-items: center;
      }
      .lio-mes-wrap {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 0;
        width: 100%;                    /* preenche a coluna do grid */
        min-width: 0;
      }
      .lio-mes-label {
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--ink-faint);
        text-align: center;
      }
      .lio-mes-select {
        padding: 0 26px 0 12px;
        height: 34px;
        font-size: 11.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-elevated);
        color: var(--primary);
        text-align-last: center;
        appearance: none;
        background-image:
          linear-gradient(45deg, transparent 50%, var(--accent) 50%),
          linear-gradient(135deg, var(--accent) 50%, transparent 50%);
        background-position:
          calc(100% - 12px) 50%,
          calc(100% - 7px) 50%;
        background-size: 5px 5px;
        background-repeat: no-repeat;
        box-shadow: 0 1px 3px rgba(11, 35, 64,0.10), inset 0 1px 0 rgba(255,255,255,0.4);
        cursor: pointer;
        box-sizing: border-box;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .lio-mes-select:hover { border-color: var(--accent); box-shadow: 0 2px 6px rgba(42, 90, 140,0.18); }
      .lio-mes-select:focus { outline: none; border-color: var(--primary); }
      .lio-busca-wrap {
        position: relative; display: flex; align-items: center;
        flex: 1; min-width: 240px; height: 34px;
      }
      .lio-busca-icon {
        position: absolute; left: 10px; font-size: 12px;
        color: var(--ink-faint); pointer-events: none;
      }
      .lio-busca-input {
        width: 100%;
        height: 34px;
        padding: 0 30px 0 30px;
        font-size: 12px; border: 1px solid var(--border);
        border-radius: 6px; background: var(--bg-elevated);
        color: var(--ink); outline: none;
        box-sizing: border-box;
      }
      .lio-busca-input:focus { border-color: var(--primary); }
      .lio-busca-limpar {
        position: absolute; right: 6px; border: none;
        background: transparent; color: var(--ink-faint);
        cursor: pointer; padding: 2px 6px; border-radius: 3px;
      }
      .lio-busca-limpar:hover { background: var(--bg-sunken); color: var(--ink); }
      .lio-chk-inline {
        display: flex; align-items: center; gap: 6px;
        font-size: 11px; color: var(--ink-soft); cursor: pointer;
        padding: 0 12px;
        height: 34px;                  /* altura igual aos selects + ajustes */
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-elevated);
        box-sizing: border-box;
      }
      .lio-chk-inline:hover { border-color: var(--accent); }
      /* Botão Ajustes — altura igual aos selects e ao chk-inline */
      #lio-btn-ajustes {
        height: 34px;
        padding: 0 14px;
        font-size: 12px;
        font-weight: 700;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      /* ── Painel de Ajustes ── */
      .lio-ajustes {
        position: fixed;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 92vw;
        max-width: 1180px;
        max-height: 88vh;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 0;
        margin: 0;
        z-index: 1001;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
        /* V129.6: animação removida — disparava a cada re-render */
      }
      .lio-ajustes-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        
        
        z-index: 1000;
        /* V129.6: animação removida — disparava a cada re-render */
      }

      /* V129.12: Modal de confirmação customizado (estética do app) */
      .lio-confirm-wrap {
        position: fixed;
        inset: 0;
        z-index: 2000;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .lio-confirm-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        
        
        animation: lioConfirmFade 180ms ease-out;
      }
      .lio-confirm-modal {
        position: relative;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 26px 28px 22px;
        max-width: 460px;
        width: 90vw;
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
        text-align: center;
        animation: lioConfirmPop 240ms cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes lioConfirmFade {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      @keyframes lioConfirmPop {
        0%   { opacity: 0; transform: scale(0.92) translateY(8px); }
        100% { opacity: 1; transform: scale(1) translateY(0); }
      }
      .lio-confirm-icon {
        font-size: 32px;
        line-height: 1;
        width: 64px;
        height: 64px;
        border-radius: 50%;
        background: rgba(42, 90, 140, 0.12);
        color: #2a5a8c;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 14px;
        font-weight: 700;
      }
      .lio-confirm-icon-perigo {
        background: rgba(42, 90, 140, 0.18);
        color: #2a5a8c;
      }
      .lio-confirm-titulo {
        font-size: 17px;
        font-weight: 700;
        color: var(--ink);
        margin-bottom: 10px;
        letter-spacing: -0.01em;
      }
      .lio-confirm-mensagem {
        font-size: 13px;
        color: var(--ink-soft);
        line-height: 1.6;
        margin-bottom: 22px;
        text-align: left;
        padding: 0 6px;
      }
      .lio-confirm-mensagem strong {
        color: var(--ink);
        font-weight: 700;
      }
      .lio-confirm-mensagem em {
        font-style: normal;
        color: #2a5a8c;
        font-weight: 600;
      }
      .lio-confirm-acoes {
        display: flex;
        gap: 10px;
        justify-content: center;
      }
      .lio-confirm-btn {
        padding: 9px 22px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        border: 1px solid;
        min-width: 110px;
        letter-spacing: 0.01em;
      }
      .lio-confirm-btn-cancelar {
        background: var(--bg);
        border-color: var(--border);
        color: var(--ink-soft);
      }
      .lio-confirm-btn-cancelar:hover {
        background: var(--bg-sunken);
        border-color: var(--ink-faint);
        color: var(--ink);
      }
      .lio-confirm-btn-ok {
        background: #2a5a8c;
        border-color: #2a5a8c;
        color: white;
      }
      .lio-confirm-btn-ok:hover {
        background: #2BA8A8;
        border-color: #2BA8A8;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(42, 90, 140, 0.35);
      }
      .lio-confirm-btn-ok:focus-visible,
      .lio-confirm-btn-cancelar:focus-visible {
        outline: 2px solid rgba(42, 90, 140, 0.5);
        outline-offset: 2px;
      }
      .lio-confirm-btn-perigo {
        background: #9B3A3A;
        border-color: #9B3A3A;
      }
      .lio-confirm-btn-perigo:hover {
        background: #823232;
        border-color: #823232;
        box-shadow: 0 4px 12px rgba(155, 58, 58, 0.35);
      }
      @keyframes lioFadeIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      .lio-ajustes-modal-head {
        flex-shrink: 0;
        padding: 16px 22px 0;
        background: var(--bg-elevated);
        position: relative;
      }
      .lio-ajustes-close-modal {
        position: absolute;
        top: 14px;
        right: 14px;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        color: var(--ink-soft);
        font-size: 16px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        z-index: 2;
      }
      .lio-ajustes-close-modal:hover {
        background: #2a5a8c;
        color: white;
        border-color: #2a5a8c;
      }
      .lio-ajustes-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px 22px 22px;
      }
      @media (max-width: 980px) {
        .lio-ajustes { width: 96vw; max-height: 92vh; }
      }

      /* V129: aba CONVÊNIO empilha as seções verticalmente (flex column) */
      .lio-ajustes-stack {
        /* mantém só pro caso de algum legacy referenciar */
      }

      /* V129.3: aba PARTICULAR — grid de 2 colunas pra Config + Produtos */
      .lio-aj-part-grid {
        display: grid;
        grid-template-columns: minmax(260px, 320px) 1fr;
        gap: 24px;
        margin-bottom: 18px;
      }
      /* V129.23: grid sem a coluna de config (config foi pro Convênio) */
      .lio-aj-part-grid-solo {
        grid-template-columns: 1fr;
      }
      /* V129.24: nota explicando que o toggle fica no Convênio */
      .lio-aj-nota-toggle {
        margin-top: 12px;
        padding: 9px 11px;
        background: rgba(42, 90, 140, 0.06);
        border: 1px solid rgba(42, 90, 140, 0.20);
        border-radius: 8px;
        font-size: 11px;
        line-height: 1.5;
        color: var(--ink-soft);
      }
      @media (max-width: 980px) {
        .lio-aj-part-grid { grid-template-columns: 1fr; }
      }

      /* V129: tabs PAI (Convênio | Particular) — ocupam largura total do grid */
      .lio-aj-pai-tabs {
        grid-column: 1 / -1;
        display: flex;
        gap: 6px;
        padding-bottom: 14px;
        border-bottom: 1px solid var(--border);
        margin-bottom: 4px;
      }
      .lio-aj-pai-tab {
        flex: 1;
        padding: 10px 18px;
        background: transparent;
        border: 1px solid transparent;
        border-bottom: 2px solid transparent;
        border-radius: 8px 8px 0 0;
        color: var(--ink-faint);
        font-size: 14px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        letter-spacing: 0.01em;
      }
      .lio-aj-pai-tab:hover {
        background: var(--bg-sunken);
        color: var(--ink-soft);
      }
      .lio-aj-pai-tab-ativa {
        color: #2a5a8c;
        background: rgba(42, 90, 140, 0.10);
        border-color: rgba(42, 90, 140, 0.30);
        border-bottom-color: #2a5a8c;
      }

      /* V129: placeholders das seções em construção (legacy, mantido por compat) */
      .lio-aj-secao-placeholder {}
      .lio-aj-placeholder-box {
        background: var(--bg-sunken);
        border: 2px dashed var(--border);
        border-radius: 8px;
        padding: 22px;
        text-align: center;
        color: var(--ink-faint);
      }

      /* ============================================================
         V129.1: ABA CONVÊNIO — classes próprias isoladas
         Sem conflito com .lio-aj-* da aba Particular.
         ============================================================ */
      .lio-conv-card {
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 16px 18px;
        margin-bottom: 12px;
      }
      .lio-conv-card:last-child { margin-bottom: 0; }

      .lio-conv-secao-titulo {
        margin: 0 0 6px;
        font-size: 13px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--primary);
      }
      .lio-conv-help {
        margin: 0 0 14px;
        font-size: 12px;
        color: var(--ink-faint);
        line-height: 1.5;
      }
      .lio-conv-help kbd {
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 1px 6px;
        font-size: 10px;
        font-family: var(--font-mono);
        color: var(--ink-soft);
      }
      .lio-conv-help code {
        background: var(--bg-sunken);
        padding: 1px 6px;
        border-radius: 3px;
        font-size: 11px;
        color: var(--primary);
        font-family: var(--font-mono);
      }

      /* % Repasse de Convênio — wrapper horizontal limpo */
      .lio-conv-pct-row {
        display: flex;
        align-items: center;
        gap: 16px;
        background: var(--bg-sunken);
        padding: 14px 18px;
        border-radius: 8px;
        border: 1px solid var(--border);
        max-width: 420px;
      }
      .lio-conv-pct-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ink-faint);
        flex: 1;
      }
      .lio-conv-pct-wrap {
        position: relative;
        width: 130px;
      }
      .lio-conv-pct-input {
        width: 100%;
        height: 40px;
        padding: 6px 30px 6px 12px;
        font-size: 18px;
        font-weight: 700;
        color: var(--primary);
        background: white;
        border: 1px solid var(--border);
        border-radius: 6px;
        outline: none;
        box-sizing: border-box;
        font-family: var(--font-mono);
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
        -moz-appearance: textfield;
        text-align: right;
      }
      .lio-conv-pct-input::-webkit-outer-spin-button,
      .lio-conv-pct-input::-webkit-inner-spin-button {
        -webkit-appearance: none; margin: 0;
      }
      .lio-conv-pct-input:focus {
        border-color: #2a5a8c;
        box-shadow: 0 0 0 3px rgba(42, 90, 140, 0.18);
      }
      .lio-conv-pct-suffix {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 14px;
        font-weight: 700;
        color: var(--ink-faint);
        pointer-events: none;
      }

      /* Placeholders "Em construção" */
      .lio-conv-placeholder {
        background: var(--bg-sunken);
        border: 2px dashed var(--border);
        border-radius: 8px;
        padding: 22px;
        text-align: center;
        color: var(--ink-faint);
      }
      .lio-conv-placeholder strong {
        color: #2a5a8c;
        display: block;
        margin: 6px 0 8px;
        font-size: 13px;
        letter-spacing: 0.03em;
      }
      .lio-conv-placeholder-ico {
        font-size: 28px;
        display: block;
      }
      .lio-conv-placeholder p {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
      }

      /* ============================================================
         V129.4: Busca de Convênios Elegíveis + Chips dos flagados
         ============================================================ */
      .lio-conv-busca-wrap {
        position: relative;
        margin-bottom: 16px;
      }
      .lio-conv-busca-input-wrap {
        position: relative;
        display: flex;
        align-items: center;
      }
      .lio-conv-busca-icon {
        position: absolute;
        left: 12px;
        font-size: 14px;
        pointer-events: none;
        color: var(--ink-faint);
      }
      .lio-conv-busca-input {
        width: 100%;
        padding: 11px 38px 11px 38px;
        font-size: 13px;
        font-family: inherit;
        background: white;
        border: 1px solid var(--border);
        border-radius: 8px;
        color: var(--ink);
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        box-sizing: border-box;
      }
      .lio-conv-busca-input:focus {
        outline: none;
        border-color: #2a5a8c;
        box-shadow: 0 0 0 3px rgba(42, 90, 140, 0.15);
      }
      .lio-conv-busca-clear {
        position: absolute;
        right: 8px;
        background: transparent;
        border: none;
        font-size: 12px;
        color: var(--ink-faint);
        cursor: pointer;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background 120ms;
      }
      .lio-conv-busca-clear:hover {
        background: var(--bg-sunken);
        color: var(--ink);
      }

      .lio-conv-busca-dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        margin-top: 4px;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
        max-height: 340px;
        overflow-y: auto;
        z-index: 10;
      }
      .lio-conv-busca-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        cursor: pointer;
        border-bottom: 1px solid var(--border);
        transition: background 120ms;
        user-select: none;
      }
      .lio-conv-busca-item:last-child { border-bottom: none; }
      .lio-conv-busca-item:hover {
        background: rgba(42, 90, 140, 0.06);
      }
      .lio-conv-busca-item-flagado {
        background: rgba(42, 90, 140, 0.04);
      }
      .lio-conv-busca-check {
        width: 16px;
        height: 16px;
        accent-color: #2a5a8c;
        cursor: pointer;
        flex-shrink: 0;
      }
      .lio-conv-busca-item-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
      }
      .lio-conv-busca-item-info strong {
        font-size: 13px;
        color: var(--ink);
        font-weight: 600;
      }
      .lio-conv-busca-item-info small {
        font-size: 11px;
        color: var(--ink-faint);
      }
      .lio-conv-busca-vazio,
      .lio-conv-busca-mais {
        padding: 14px;
        text-align: center;
        font-size: 12px;
        color: var(--ink-faint);
        font-style: italic;
      }
      .lio-conv-busca-mais {
        border-top: 1px solid var(--border);
        background: var(--bg-sunken);
      }

      /* Chips/Cards dos convênios flagados */
      .lio-conv-flagados-titulo {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ink-soft);
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .lio-conv-flagados-contador {
        background: #2a5a8c;
        color: white;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 700;
      }
      .lio-conv-flagados-lista {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .lio-conv-flagado-card {
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        border-left: 4px solid var(--success, #0A7A5A);
        border-radius: 6px;
        overflow: hidden;
      }
      .lio-conv-flagado-sem-tabela {
        border-left-color: var(--warning, #2a5a8c);
      }

      /* V129.7: head do card flagado (clicável quando tem tabela) */
      .lio-conv-flagado-head {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        background: var(--bg-sunken);
        transition: background 120ms;
      }
      .lio-conv-flagado-head[data-conv-toggle] {
        cursor: pointer;
      }
      .lio-conv-flagado-head[data-conv-toggle]:hover {
        background: rgba(42, 90, 140, 0.05);
      }
      .lio-conv-flagado-seta {
        font-size: 11px;
        color: #2a5a8c;
        width: 14px;
        text-align: center;
        flex-shrink: 0;
        font-weight: 700;
      }
      .lio-conv-flagado-seta-vazio {
        width: 14px;
        flex-shrink: 0;
      }
      .lio-conv-flagado-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
      }
      .lio-conv-flagado-info strong {
        font-size: 13px;
        color: var(--ink);
        font-weight: 600;
      }
      .lio-conv-flagado-info small {
        font-size: 11px;
        color: var(--ink-faint);
      }
      .lio-conv-flagado-acoes {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-shrink: 0;
      }
      .lio-conv-flagado-importar {
        background: #2a5a8c;
        color: white;
        border: none;
        padding: 7px 14px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        white-space: nowrap;
      }
      .lio-conv-flagado-importar:hover {
        background: #2BA8A8;
        transform: translateY(-1px);
        box-shadow: 0 2px 8px rgba(42, 90, 140, 0.30);
      }

      /* V129.8: Botão "Excluir importação" — visual de texto/link */
      .lio-conv-flagado-excluir-tabela {
        background: transparent;
        color: var(--ink-faint);
        border: none;
        padding: 7px 10px;
        font-size: 11px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        white-space: nowrap;
        border-radius: 4px;
      }
      .lio-conv-flagado-excluir-tabela:hover {
        color: var(--danger, #9B3A3A);
        background: rgba(155, 58, 58, 0.08);
      }
      .lio-conv-flagado-remover {
        background: transparent;
        border: 1px solid transparent;
        color: var(--ink-faint);
        font-size: 14px;
        cursor: pointer;
        width: 28px;
        height: 28px;
        border-radius: 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        flex-shrink: 0;
      }
      .lio-conv-flagado-remover:hover {
        background: #E6B5B5;
        color: var(--danger, #9B3A3A);
        border-color: #E6B5B5;
      }
      .lio-conv-flagados-vazio {
        background: var(--bg-sunken);
        border: 1px dashed var(--border);
        border-radius: 6px;
        padding: 14px;
        text-align: center;
        font-size: 12px;
        color: var(--ink-faint);
        font-style: italic;
      }

      /* V129.7: Drilldown de OPMEs dentro do card flagado */
      .lio-conv-drilldown {
        background: var(--bg-elevated);
        border-top: 1px solid var(--border);
      }
      .lio-conv-drilldown-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        background: var(--bg);
        border-bottom: 1px solid var(--border);
        font-size: 11px;
        color: var(--ink-faint);
        gap: 14px;
        flex-wrap: wrap;
      }
      .lio-conv-drilldown-stat strong {
        color: #2a5a8c;
        font-weight: 700;
      }
      .lio-conv-drilldown-help {
        font-style: italic;
        flex-shrink: 1;
        text-align: right;
      }

      /* V129.11: Botão "Termos consolidados" no header do drilldown */
      .lio-conv-consolidado-btn {
        background: transparent;
        border: 1px solid var(--border);
        color: var(--ink-soft);
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }
      .lio-conv-consolidado-btn:hover {
        border-color: #2a5a8c;
        color: #2a5a8c;
        background: rgba(42, 90, 140, 0.06);
      }
      .lio-conv-consolidado-btn-aberto {
        background: rgba(42, 90, 140, 0.12);
        border-color: #2a5a8c;
        color: #2a5a8c;
      }
      .lio-conv-consolidado-badge {
        background: #2a5a8c;
        color: white;
        padding: 1px 7px;
        border-radius: 10px;
        font-size: 10px;
        font-weight: 700;
      }
      .lio-conv-consolidado-seta {
        font-size: 9px;
      }

      /* V129.11: Painel expansível do consolidado */
      .lio-conv-consolidado-painel {
        background: linear-gradient(180deg, rgba(42, 90, 140, 0.04) 0%, var(--bg) 100%);
        border-bottom: 1px solid var(--border);
        padding: 14px 18px;
      }
      .lio-conv-consolidado-painel-head {
        display: flex;
        align-items: baseline;
        gap: 12px;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }
      .lio-conv-consolidado-painel-head strong {
        font-size: 12px;
        color: var(--ink);
        font-weight: 700;
      }
      .lio-conv-consolidado-painel-head small {
        font-size: 11px;
        color: var(--ink-faint);
        font-style: italic;
      }
      .lio-conv-consolidado-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .lio-conv-consolidado-vazio {
        font-size: 11px;
        color: var(--ink-faint);
        font-style: italic;
        padding: 8px 0;
      }
      .lio-conv-consolidado-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: white;
        border: 1px solid rgba(42, 90, 140, 0.30);
        color: var(--ink);
        padding: 4px 4px 4px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.02em;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .lio-conv-consolidado-chip:hover {
        border-color: #2a5a8c;
        background: rgba(42, 90, 140, 0.05);
      }
      .lio-conv-consolidado-chip-texto {
        color: var(--ink);
      }
      .lio-conv-consolidado-chip-count {
        background: var(--bg-sunken);
        color: var(--ink-soft);
        padding: 1px 7px;
        border-radius: 8px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0;
      }
      .lio-conv-consolidado-chip-remover {
        background: transparent;
        border: none;
        color: var(--ink-faint);
        cursor: pointer;
        padding: 0 5px;
        font-size: 11px;
        line-height: 1;
        border-radius: 3px;
        opacity: 0.6;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
        font-weight: 700;
      }
      .lio-conv-consolidado-chip-remover:hover {
        background: rgba(155, 58, 58, 0.15);
        color: var(--danger, #9B3A3A);
        opacity: 1;
      }
      .lio-conv-tabela-wrap {
        max-height: 480px;
        overflow-y: auto;
        overflow-x: auto;
      }
      .lio-conv-tabela {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        background: white;
      }
      .lio-conv-tabela thead {
        position: sticky;
        top: 0;
        background: var(--bg-sunken);
        z-index: 2;
      }
      .lio-conv-tabela th {
        padding: 8px 12px;
        text-align: left;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--ink-soft);
        font-weight: 700;
        border-bottom: 1px solid var(--border);
        white-space: nowrap;
      }
      .lio-conv-th-check { width: 60px; text-align: center !important; }
      .lio-conv-th-valor { width: 120px; text-align: right !important; }
      .lio-conv-tabela td {
        padding: 6px 12px;
        border-bottom: 1px solid rgba(0,0,0,0.04);
        color: var(--ink-soft);
        vertical-align: middle;
      }
      .lio-conv-tabela tbody tr:hover {
        background: rgba(42, 90, 140, 0.03);
      }
      .lio-conv-tabela-row-inativo {
        opacity: 0.45;
      }
      .lio-conv-tabela-row-inativo .lio-conv-tabela-produto {
        text-decoration: line-through;
      }
      .lio-conv-tabela-produto {
        font-weight: 500;
        color: var(--ink);
        max-width: 380px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .lio-conv-tabela-padrao {
        font-size: 11px;
        color: var(--ink-faint);
        font-style: italic;
      }
      .lio-conv-td-padrao {
        min-width: 280px;
      }

      /* V129.10: Chips uniformes — cada termo é editável/removível */
      .lio-conv-padrao-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
      }
      .lio-conv-chip-termo {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: rgba(42, 90, 140, 0.08);
        color: var(--primary);
        padding: 3px 3px 3px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.02em;
        border: 1px solid rgba(42, 90, 140, 0.25);
        white-space: nowrap;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .lio-conv-chip-termo:hover {
        background: rgba(42, 90, 140, 0.15);
        border-color: rgba(42, 90, 140, 0.45);
      }
      .lio-conv-chip-texto {
        cursor: text;
        padding: 0 2px;
      }
      .lio-conv-chip-texto:hover {
        text-decoration: underline;
        text-decoration-style: dotted;
      }
      .lio-conv-chip-remover {
        background: transparent;
        border: none;
        color: var(--primary);
        cursor: pointer;
        padding: 0 4px;
        font-size: 10px;
        line-height: 1;
        border-radius: 3px;
        opacity: 0.55;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
      }
      .lio-conv-chip-remover:hover {
        background: rgba(155, 58, 58, 0.15);
        color: var(--danger, #9B3A3A);
        opacity: 1;
      }
      .lio-conv-chip-edit-input {
        padding: 3px 8px;
        font-size: 11px;
        font-weight: 600;
        font-family: inherit;
        background: white;
        border: 1px solid #2a5a8c;
        border-radius: 4px;
        outline: none;
        color: var(--ink);
        text-transform: uppercase;
        letter-spacing: 0.02em;
        min-width: 100px;
        max-width: 180px;
        box-shadow: 0 0 0 2px rgba(42, 90, 140, 0.15);
      }
      .lio-conv-chip-add {
        background: transparent;
        border: 1px dashed var(--border);
        color: var(--ink-faint);
        padding: 3px 9px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        white-space: nowrap;
      }
      .lio-conv-chip-add:hover {
        border-color: #2a5a8c;
        border-style: solid;
        color: #2a5a8c;
        background: rgba(42, 90, 140, 0.06);
      }
      .lio-conv-padrao-novo-input {
        padding: 3px 9px;
        font-size: 11px;
        font-weight: 600;
        font-family: inherit;
        background: white;
        border: 1px solid #2a5a8c;
        border-radius: 4px;
        outline: none;
        color: var(--ink);
        text-transform: uppercase;
        letter-spacing: 0.02em;
        min-width: 140px;
        box-shadow: 0 0 0 2px rgba(42, 90, 140, 0.15);
      }
      .lio-conv-padrao-novo-input::placeholder {
        color: var(--ink-faint);
        font-weight: 400;
        text-transform: none;
      }
      .lio-conv-td-check {
        text-align: center;
      }
      .lio-conv-td-valor {
        text-align: right;
      }
      .lio-conv-opme-check {
        width: 16px;
        height: 16px;
        accent-color: #2a5a8c;
        cursor: pointer;
        vertical-align: middle;
      }
      .lio-conv-opme-valor {
        width: 100%;
        padding: 4px 8px;
        font-size: 12px;
        border: 1px solid var(--border);
        border-radius: 4px;
        font-family: var(--font-mono);
        background: white;
        text-align: right;
        box-sizing: border-box;
        -moz-appearance: textfield;
      }
      .lio-conv-opme-valor::-webkit-outer-spin-button,
      .lio-conv-opme-valor::-webkit-inner-spin-button {
        -webkit-appearance: none; margin: 0;
      }
      .lio-conv-opme-valor:focus {
        outline: none;
        border-color: #2a5a8c;
        box-shadow: 0 0 0 2px rgba(42, 90, 140, 0.15);
      }      .lio-aj-secao {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .lio-aj-secao h4 {
        margin: 0 0 4px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--primary);
        flex-shrink: 0;
      }
      .lio-aj-help {
        margin: 0 0 10px;
        font-size: 11px;
        color: var(--ink-faint);
        line-height: 1.45;
        flex-shrink: 0;
      }
      .lio-aj-help kbd {
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        padding: 1px 5px;
        border-radius: 3px;
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--primary);
      }

      /* ── ⑤ Cards % uniformes — TAMANHOS IDÊNTICOS forçados ── */
      .lio-aj-pcts {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .lio-aj-pct-box {
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        height: 96px;                /* altura FIXA pra ficarem iguais */
        box-sizing: border-box;
        overflow: hidden;
      }
      .lio-aj-pct-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ink-faint);
        line-height: 1.3;
        height: 30px;                /* altura FIXA — 2 linhas se precisar */
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .lio-aj-pct-label small {
        font-size: 9px;
        color: var(--ink-faint);
        opacity: 0.7;
        font-weight: 600;
        text-transform: none;
        letter-spacing: 0;
      }

      /* ── ② Input editável de % ── */
      .lio-aj-pct-input-wrap {
        position: relative;
        display: flex;
        align-items: center;
        flex: 1;
      }
      .lio-aj-pct-input {
        width: 100%;
        height: 38px;
        padding: 6px 32px 6px 12px;
        font-size: 20px;
        font-weight: 700;
        color: var(--primary);
        background: white;
        border: 1px solid var(--border);
        border-radius: 4px;
        outline: none;
        box-sizing: border-box;
        font-family: var(--font-mono);
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
        -moz-appearance: textfield;
      }
      .lio-aj-pct-input::-webkit-outer-spin-button,
      .lio-aj-pct-input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      .lio-aj-pct-input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px rgba(42, 90, 140, 0.18);
      }
      .lio-aj-pct-suffix {
        position: absolute;
        right: 12px;
        font-size: 15px;
        font-weight: 700;
        color: var(--ink-faint);
        pointer-events: none;
      }

      /* ── ① Seção produtos: header fixo + lista com scroll interno ── */
      .lio-aj-secao-larga {
        overflow: hidden;
      }

      /* === Personalização de Rótulos (V128) === */
      .lio-aj-secao-personalizar {
        margin-top: 4px;
        padding-top: 18px;
        border-top: 1px solid var(--border);
      }
      .lio-aj-rotulos-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 12px;
        margin-top: 12px;
      }
      .lio-aj-rotulo-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
        background: var(--bg-elevated);
        padding: 10px 12px;
        border-radius: 6px;
        border: 1px solid var(--border);
      }
      .lio-aj-rotulo-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--ink-soft);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .lio-aj-rotulo-padrao {
        font-size: 10px;
        font-weight: 400;
        color: var(--ink-faint);
        font-style: normal;
      }
      .lio-aj-rotulo-padrao em {
        color: var(--accent);
        font-style: italic;
      }
      .lio-aj-rotulo-input {
        font-family: inherit;
        font-size: 13px;
        padding: 6px 10px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--bg);
        color: var(--ink);
        transition: border-color 0.15s;
      }
      .lio-aj-rotulo-input:focus {
        outline: none;
        border-color: var(--primary);
        background: var(--bg-elevated);
      }
      .lio-aj-rotulos-acoes {
        margin-top: 14px;
        display: flex;
        justify-content: flex-end;
      }

      .lio-aj-secao-larga-head {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .lio-aj-acoes-globais {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        border-radius: 6px 6px 0 0;
        flex-wrap: wrap;
      }
      .lio-aj-acoes-stat {
        font-size: 11px;
        color: var(--ink-soft);
        margin-right: auto;
      }
      .lio-aj-acoes-stat strong {
        color: var(--primary);
        font-family: var(--font-mono);
      }
      .lio-aj-lista {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        border: 1px solid var(--border);
        border-top: none;
        border-radius: 0 0 6px 6px;
        background: var(--bg-elevated);
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .lio-aj-tipo {
        border-bottom: 1px solid var(--border);
      }
      .lio-aj-tipo:last-child { border-bottom: none; }
      /* ── ④ Header do tipo: grid uniforme — NÃO sticky pra não sobrepor texto ── */
      .lio-aj-tipo-head {
        display: grid;
        grid-template-columns: 1fr 220px 96px 96px;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        background: var(--bg-sunken);
        font-size: 11px;
      }
      .lio-aj-tipo-head strong {
        color: var(--primary);
        text-transform: uppercase;
        font-size: 10.5px;
        letter-spacing: 0.04em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .lio-aj-tipo-meta {
        font-size: 10px;
        color: var(--ink-faint);
        white-space: nowrap;
        font-family: var(--font-mono);
        text-align: right;
      }

      /* ── ④ Botões padronizados: TODOS com mesma altura e padding ── */
      .lio-aj-todos {
        width: 100%;                /* preenche a célula do grid */
        height: 28px;
        padding: 4px 12px;
        box-sizing: border-box;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 999px;
        color: var(--ink-soft);
        cursor: pointer;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
        font-family: inherit;
        line-height: 1;
        text-align: center;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .lio-aj-todos:hover {
        border-color: var(--accent);
        color: var(--accent);
        background: rgba(42, 90, 140, 0.06);
      }
      .lio-aj-todos-global {
        width: 160px;               /* largura FIXA — não preenche grid */
        height: 30px;
        font-size: 10.5px;
        padding: 4px 14px;
      }

      .lio-aj-produtos {
        padding: 6px 12px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      /* ── ④ Linha de produto uniformizada ── */
      .lio-aj-produto {
        display: grid;
        grid-template-columns: 22px 1fr 160px;
        align-items: center;
        gap: 12px;
        padding: 6px 8px;
        font-size: 10.5px;
        border-radius: 4px;
        cursor: pointer;
        transition: background 100ms;
        height: 30px;
        box-sizing: border-box;
      }
      .lio-aj-produto:hover { background: var(--bg-sunken); }
      .lio-aj-produto input[type="checkbox"] {
        width: 16px;
        height: 16px;
        margin: 0;
        accent-color: var(--accent);
      }
      .lio-aj-produto-nome {
        color: var(--ink);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .lio-aj-produto-off .lio-aj-produto-nome {
        text-decoration: line-through;
        opacity: 0.45;
      }
      .lio-aj-produto-info {
        font-family: var(--font-mono);
        font-size: 9.5px;
        color: var(--ink-faint);
        text-align: right;
        white-space: nowrap;
      }

      /* ═══════════════════════════════════════════════════════════════════
         CARDS TOTALIZADORES — estilo Lentes de Contato (gradient + faixa)
         ═══════════════════════════════════════════════════════════════════ */
      .lio-kpis {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 8px;
        flex-shrink: 0;
        width: 100%;
        box-sizing: border-box;
      }
      @media (max-width: 1100px) {
        .lio-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 600px) {
        .lio-kpis { grid-template-columns: minmax(0, 1fr); }
      }
      .lio-kpi {
        border-radius: 12px;
        padding: 12px 16px;
        position: relative;
        overflow: hidden;
        border: 1px solid transparent;
        height: 100px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
        box-sizing: border-box;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .lio-kpi:hover {
        box-shadow: 0 6px 16px rgba(11, 35, 64,0.14);
        transform: translateY(-2px);
      }
      .lio-kpi-faixa {
        position: absolute; top: 0; right: 0; bottom: 0; width: 5px;
      }
      .lio-kpi-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 4px;
        color: #0f1d2e; /* V849: título dos cards totalizadores (variante destaque mantém a própria) */
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .lio-kpi-valor {
        font-size: 24px;
        font-weight: 800;
        line-height: 1.1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
        letter-spacing: -0.01em;
      }
      .lio-kpi-sub {
        font-size: 10.5px;
        margin-top: auto;
        line-height: 1.25;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 600;
      }
      .lio-kpi-destaque {
        margin-top: auto;
        display: flex;
        align-items: baseline;
        gap: 6px;
        line-height: 1.1;
        overflow: hidden;
      }
      .lio-kpi-destaque-num {
        font-size: 15px;
        font-weight: 800;
        color: #2a5a8c;   /* V965: era #1d4470 (V646: era #C24A1F) */
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .lio-kpi-destaque-tag {
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--ink-faint);
        white-space: nowrap;
      }

      /* === Temas (cor de fundo + faixa + texto) === */
      .lio-kpi-verde    {
        background: linear-gradient(135deg, #E8F1EE 0%, #D4E4DF 100%);
        border-color: #A8C8C0;
      }
      /* V646: os RÓTULOS dos cards recebiam #0F6E56 de uma regra GLOBAL de
         padronização (style.css, com !important). No fichário LIO o pedido de
         layout é #071a30 — override escopado, injetado depois do style.css. */
      .main .lio-kpi :is([class*="-label"], [class*="-titulo"], [class*="-lbl"], .label) { color: #071a30 !important; }
      .lio-kpi-verde .lio-kpi-faixa  { background: #071a30; }   /* V646 (era #143352) */
      .lio-kpi-verde .lio-kpi-label  { color: #071a30; }
      .lio-kpi-verde .lio-kpi-valor  { color: #071a30; }
      .lio-kpi-verde .lio-kpi-sub    { color: #2C5953; }

      .lio-kpi-bege    {
        background: linear-gradient(135deg, #e9edf1 0%, #e4ecf4 100%);
        border-color: #9FE6C9;
      }
      .lio-kpi-bege .lio-kpi-faixa  { background: #071a30; }   /* V646 (era #143352) */
      .lio-kpi-bege .lio-kpi-label  { color: #071a30; }
      .lio-kpi-bege .lio-kpi-valor  { color: #071a30; }
      .lio-kpi-bege .lio-kpi-sub    { color: #7A5A1A; }

      .lio-kpi-roxo    {
        background: linear-gradient(135deg, #ECE5F2 0%, #DAC8E4 100%);
        border-color: #C0A8D0;
      }
      .lio-kpi-roxo .lio-kpi-faixa  { background: #6B4587; }
      .lio-kpi-roxo .lio-kpi-label  { color: #6B4587; }
      .lio-kpi-roxo .lio-kpi-valor  { color: #6B4587; }
      .lio-kpi-roxo .lio-kpi-sub    { color: #5A3675; }

      .lio-kpi-card-destaque {
        background: linear-gradient(135deg, #143352 0%, #0b2340 100%);
        border-color: #143352;
        box-shadow: 0 4px 12px rgba(20, 51, 82,.2);
      }
      .lio-kpi-card-destaque .lio-kpi-faixa { display: none; }
      .lio-kpi-card-destaque .lio-kpi-label { color: #5a6879; }
      .lio-kpi-card-destaque .lio-kpi-valor { color: #0f1d2e; }   /* V709 (era #071a30) */
      .lio-kpi-card-destaque .lio-kpi-subtot .mono { color: #2a5a8c; font-weight: 700; }   /* V709 · V965: era #1d4470 */
      /* V709: com os 3 subtotais o conteúdo passa dos 100px fixos — o flex
         esmagava rótulo e valor a ~1px. O destaque cresce; nada encolhe. */
      .lio-kpi-card-destaque { height: auto; min-height: 100px; }
      .lio-kpi-card-destaque .lio-kpi-label,
      .lio-kpi-card-destaque .lio-kpi-valor,
      .lio-kpi-card-destaque .lio-kpi-subtotais { flex: 0 0 auto; }
      /* V710: fontes reduzidas até o card fechar nos ~100px dos demais KPIs
         (o título REPASSE TOTAL ficou como estava) */
      .lio-kpi-card-destaque { padding-top: 9px; padding-bottom: 9px; }
      .lio-kpi-card-destaque .lio-kpi-valor { font-size: 16px; line-height: 1.1; min-height: 0; }
      /* V729: divisor padrão dos cards com subtópicos (mesma linha fina que a
         VG usa entre o valor principal e o detalhamento) */
      .lio-kpi-card-destaque .lio-kpi-subtotais {
        margin-top: 3px; gap: 1px;
        border-top: 1px solid var(--border, #dfe4ea);
        padding-top: 3px;
        width: 100%;
      }
      .lio-kpi-card-destaque .lio-kpi-subtot { font-size: 10px; line-height: 1.15; }
      .lio-kpi-card-destaque .lio-kpi-subtot-rot { font-size: 8.5px; }
      .lio-kpi-card-destaque .lio-kpi-sub   { color: #c5d5e5; }

      .lio-kpi-alert {
        box-shadow: 0 0 0 2px rgba(255, 213, 79, 0.4) !important;
      }

      .lio-kpi-oculto {
        background: var(--bg-elevated);
        border-color: var(--border);
        opacity: 0.55;
      }
      .lio-kpi-oculto .lio-kpi-faixa { background: var(--border); }
      .lio-kpi-oculto .lio-kpi-label { color: var(--ink-faint); }
      .lio-kpi-oculto .lio-kpi-valor { color: var(--ink-faint); }
      .lio-kpi-oculto .lio-kpi-sub   { color: var(--ink-faint); }

      /* ═══════════════════════════════════════════════════════════════════
         FILTROS SEPARADOS no header — TODOS em 1 LINHA, distribuídos igualmente
         ═══════════════════════════════════════════════════════════════════ */
      .lio-filt-wrap {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;                   /* permite shrink dentro do grid */
        width: 100%;                    /* preenche a coluna do grid */
      }
      .lio-filt-label {
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--ink-faint);
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .lio-filt-input {
        height: 36px;
        padding: 0 10px;
        font-size: 12px;
        border: 1px solid var(--border);
        border-radius: 7px;
        background: var(--bg-elevated);
        color: var(--ink);
        outline: none;
        box-sizing: border-box;
        font-family: inherit;
        box-shadow: 0 1px 3px rgba(11, 35, 64,0.08), inset 0 1px 0 rgba(255,255,255,0.5);
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .lio-filt-input:hover { border-color: var(--accent); }
      .lio-filt-input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px rgba(42, 90, 140,0.18), inset 0 1px 0 rgba(255,255,255,0.5);
      }

      /* ═══════════════════════════════════════════════════════════════════
         COMBOBOX CUSTOMIZADO (substitui o datalist preto nativo do navegador)
         ═══════════════════════════════════════════════════════════════════ */
      .lio-combo {
        position: relative;
      }
      .lio-combo-inner {
        position: relative;
        display: flex;
        align-items: center;
      }
      .lio-combo-input {
        padding-right: 50px !important;  /* espaço pros botões ▾ e ✕ */
      }
      .lio-combo-arrow {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        width: 22px;
        height: 22px;
        border: none;
        background: transparent;
        color: var(--accent);
        cursor: pointer;
        font-size: 11px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .lio-combo-arrow:hover {
        background: rgba(42, 90, 140,0.12);
      }
      .lio-combo-arrow-aberto {
        transform: translateY(-50%) rotate(180deg);
        color: var(--primary);
      }
      .lio-combo-clear {
        position: absolute;
        right: 30px;
        top: 50%;
        transform: translateY(-50%);
        width: 18px;
        height: 18px;
        border: none;
        background: var(--bg-sunken);
        color: var(--ink-faint);
        cursor: pointer;
        font-size: 10px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .lio-combo-clear:hover {
        background: #C24A1F;
        color: white;
      }

      /* Dropdown elegante — fundo BRANCO, sombra, paleta ATLAS */
      .lio-combo-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        /* V646: a caixa flutuante cresce até o NOME COMPLETO (antes ficava
           presa à largura do input e o nome saía cortado com "...") */
        right: auto;
        min-width: 100%;
        width: max-content;
        max-width: min(440px, 80vw);
        z-index: 120;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: 0 10px 28px rgba(11, 35, 64,0.18),
                    0 2px 6px rgba(11, 35, 64,0.08);
        max-height: 280px;
        overflow-y: auto;
        font-size: 12px;
        animation: lioPopIn 160ms ease-out;
        padding: 4px;
        min-width: 180px;
      }
      .lio-combo-opt {
        padding: 8px 12px;
        cursor: pointer;
        border-radius: 5px;
        transition: background 100ms;
        color: var(--ink);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 500;
      }
      .lio-combo-opt:hover {
        background: var(--bg-sunken);
        color: var(--primary);
      }
      .lio-combo-opt-selecionado {
        background: rgba(42, 90, 140, 0.14);
        color: var(--accent);
        font-weight: 700;
      }
      .lio-combo-opt-selecionado:hover {
        background: rgba(42, 90, 140, 0.22);
      }
      .lio-combo-vazio {
        padding: 12px 10px;
        text-align: center;
        font-size: 11px;
        color: var(--ink-faint);
        font-style: italic;
      }
      /* Scrollbar customizada do dropdown */
      .lio-combo-dropdown::-webkit-scrollbar {
        width: 8px;
      }
      .lio-combo-dropdown::-webkit-scrollbar-track {
        background: transparent;
      }
      .lio-combo-dropdown::-webkit-scrollbar-thumb {
        background: var(--border);
        border-radius: 4px;
      }
      .lio-combo-dropdown::-webkit-scrollbar-thumb:hover {
        background: var(--accent);
      }
      .lio-btn-limpar-filtros {
        align-self: flex-start;   /* V730: não estica junto com a peça 20C */
        height: 34px;
        padding: 0 12px;
        font-size: 11px;
        font-weight: 700;
        background: rgba(232, 122, 60, 0.08);
        border: 1px solid #E87A3C;
        color: #C24A1F;
        border-radius: 6px;
        cursor: pointer;
        align-self: flex-end;
      }
      .lio-btn-limpar-filtros:hover {
        background: rgba(232, 122, 60, 0.16);
      }

      /* ═══════════════════════════════════════════════════════════════════
         FILTRO DE COLUNA (popover em TIPO e PRODUTO)
         ═══════════════════════════════════════════════════════════════════ */
      .lio-th-filtravel {
        position: relative;
      }
      .lio-th-filter-btn {
        border: none;
        background: transparent;
        color: #e4ecf4;
        cursor: pointer;
        font-size: 11px;
        font-weight: 700;
        padding: 1px 5px;
        margin-left: 4px;
        border-radius: 3px;
        vertical-align: middle;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
      }
      .lio-th-filter-btn:hover {
        background: var(--bg-sunken);
        color: var(--accent);
      }
      .lio-th-filter-btn-ativo {
        background: var(--accent);
        color: white;
      }
      .lio-th-popover {
        position: absolute;
        top: 100%;
        left: 0;
        margin-top: 4px;
        width: 320px;
        max-height: 360px;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: 0 6px 20px rgba(11, 35, 64, 0.15);
        z-index: 100;
        display: flex;
        flex-direction: column;
        text-transform: none;
        letter-spacing: 0;
        font-weight: normal;
      }
      .lio-th-popover-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid var(--border);
        background: var(--bg-sunken);
        border-radius: 8px 8px 0 0;
      }
      .lio-th-popover-head strong {
        font-size: 11px;
        color: var(--primary);
        font-weight: 700;
      }
      .lio-th-popover-close {
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 13px;
        color: var(--ink-faint);
        padding: 2px 6px;
        border-radius: 3px;
      }
      .lio-th-popover-close:hover {
        background: var(--bg-elevated);
        color: var(--ink);
      }
      .lio-th-popover-acoes {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--border-soft);
        font-size: 11px;
      }
      .lio-th-popover-btn {
        padding: 3px 10px;
        font-size: 10.5px;
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        border-radius: 999px;
        color: var(--ink);
        cursor: pointer;
        font-family: inherit;
      }
      .lio-th-popover-btn:hover {
        border-color: var(--accent);
        color: var(--accent);
      }
      .lio-th-popover-count {
        font-size: 10px;
        color: var(--ink-faint);
        margin-left: auto;
      }
      .lio-th-popover-lista {
        flex: 1;
        overflow-y: auto;
        padding: 4px 0;
      }
      .lio-th-popover-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 12px;
        font-size: 10.5px;
        color: var(--ink);
        cursor: pointer;
        font-weight: normal;
      }
      .lio-th-popover-item:hover {
        background: var(--bg-sunken);
      }
      .lio-th-popover-item input[type="checkbox"] {
        margin: 0;
        accent-color: var(--accent);
      }
      .lio-th-popover-item span {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .lio-th-popover-foot {
        padding: 6px 12px;
        background: var(--bg-sunken);
        border-top: 1px solid var(--border);
        border-radius: 0 0 8px 8px;
        font-size: 10px;
        color: var(--ink-faint);
        text-align: center;
      }

      /* ═══════════════════════════════════════════════════════════════════
         AJUSTES: SUB-ABAS Conv/Part + DRILLDOWN MACRO
         ═══════════════════════════════════════════════════════════════════ */
      .lio-aj-sub-abas {
        display: flex;
        gap: 2px;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 2px;
        margin-bottom: 10px;
      }
      .lio-aj-sub-aba {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 6px 12px;
        border: none;
        background: transparent;
        cursor: pointer;
        font-family: inherit;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--ink-faint);
        border-radius: 4px;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
      }
      .lio-aj-sub-aba:hover {
        color: var(--ink);
      }
      .lio-aj-sub-aba-ativa {
        background: var(--bg-sunken);
        color: var(--primary);
        box-shadow: 0 1px 2px rgba(11, 35, 64,0.08);
      }
      .lio-aj-sub-aba-meta {
        font-size: 9.5px;
        opacity: 0.7;
      }

      /* === Nível 1: Macro === */
      .lio-aj-macro {
        border-bottom: 1px solid var(--border);
      }
      .lio-aj-macro:last-child { border-bottom: none; }
      .lio-aj-macro-head {
        display: grid;
        grid-template-columns: 1fr 100px 100px;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        background: var(--bg-elevated);                /* opaco, não translúcido */
        border-bottom: 1px solid var(--border);
        position: sticky;
        top: 0;
        z-index: 3;                                     /* fica acima do tipo-head */
        box-shadow: 0 1px 0 var(--border);
      }
      .lio-aj-macro-toggle {
        border: none;
        background: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        text-align: left;
        font-family: inherit;
        font-size: 11px;
        color: var(--ink);
        padding: 0;
      }
      .lio-aj-macro-toggle:hover { color: var(--accent); }
      .lio-aj-macro-arrow {
        font-size: 11px;
        color: var(--accent);
        width: 14px;
        display: inline-block;
      }
      .lio-aj-macro-toggle strong {
        color: var(--primary);
        text-transform: uppercase;
        font-size: 11px;
        letter-spacing: 0.05em;
      }
      .lio-aj-macro-meta {
        font-size: 10px;
        color: var(--ink-faint);
        font-family: var(--font-mono);
        white-space: nowrap;
        margin-left: auto;
      }
      /* Chips de informação no header do macro */
      .lio-aj-macro-chips {
        margin-left: auto;
        display: inline-flex;
        gap: 6px;
        align-items: center;
      }
      .lio-aj-chip {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        font-size: 10px;
        font-weight: 600;
        border-radius: 999px;
        border: 1px solid transparent;
        white-space: nowrap;
      }
      .lio-aj-chip-qtd {
        background: rgba(20, 51, 82, 0.06);
        color: var(--primary);
        border-color: rgba(20, 51, 82, 0.18);
      }
      .lio-aj-chip-qtd strong { font-weight: 800; }
      .lio-aj-chip-valor {
        background: rgba(42, 90, 140, 0.10);
        color: #143352;
        border-color: rgba(42, 90, 140, 0.28);
        font-weight: 700;
      }
      .lio-aj-macro-body {
        padding: 4px 0;
        background: var(--bg-elevated);
      }

      /* === Nível 2: Tipo === */
      .lio-aj-tipo {
        border-bottom: 1px solid var(--border-soft);
        margin: 0 8px;
      }
      .lio-aj-tipo:last-child { border-bottom: none; }
      .lio-aj-tipo-head {
        display: grid;
        grid-template-columns: 1fr 130px 80px 80px;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        font-size: 10.5px;
      }
      .lio-aj-tipo-toggle {
        border: none;
        background: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        text-align: left;
        font-family: inherit;
        color: var(--ink);
        padding: 0;
        font-size: 10.5px;
      }
      .lio-aj-tipo-toggle strong {
        color: var(--ink);
        text-transform: none;
        font-weight: 600;
        letter-spacing: 0;
      }
      .lio-aj-tipo-arrow {
        font-size: 10px;
        color: var(--ink-faint);
        width: 12px;
        display: inline-block;
      }
      .lio-aj-tipo-meta {
        font-size: 9.5px;
        color: var(--ink-faint);
        font-family: var(--font-mono);
        white-space: nowrap;
      }

      /* === Botões padronizados === */
      .lio-aj-todos {
        width: 100%;
        height: 26px;
        padding: 0 8px;
        box-sizing: border-box;
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 999px;
        color: var(--ink-soft);
        cursor: pointer;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
        font-family: inherit;
        line-height: 1;
        text-align: center;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .lio-aj-todos:hover {
        border-color: var(--accent);
        color: var(--accent);
        background: rgba(42, 90, 140, 0.06);
      }
      .lio-aj-todos-global {
        width: 160px;
        height: 30px;
        font-size: 10.5px;
        padding: 0 14px;
      }

      /* ═══════════════════════════════════════════════════════════════════
         Abas Convênio/Particular estilo ABAS DE NAVEGADOR (Chrome-like)
         - Cantos arredondados no topo
         - Aba ativa "conecta" visualmente ao painel (sem border-bottom)
         - Aba inativa fica "atrás" (mais escura, com border-bottom)
         ═══════════════════════════════════════════════════════════════════ */
      /* ═══════════════════════════════════════════════════════════════════
         Abas Convênio/Particular ESTILO BOTÃO SÓLIDO (não mais navegador)
         - ATIVA: verde primary com texto branco
         - INATIVA: bege claro neutro com texto cinza
         ═══════════════════════════════════════════════════════════════════ */
      .lio-abas {
        display: flex;
        gap: 8px;
        margin: 0 0 8px 0;
        padding: 0;
        flex-shrink: 0;
        position: relative;
        z-index: 2;
        align-items: center;
        background: transparent;
      }
      .lio-aba {
        position: relative;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 10px 22px;
        border: 1px solid var(--border) !important;
        background: var(--bg-elevated) !important;
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.05em;
        color: var(--ink-faint);
        transition: background-color 180ms cubic-bezier(0.4, 0, 0.2, 1), color 180ms cubic-bezier(0.4, 0, 0.2, 1), border-color 180ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 180ms cubic-bezier(0.4, 0, 0.2, 1), transform 180ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms cubic-bezier(0.4, 0, 0.2, 1);
        border-radius: 8px !important;
        min-height: 40px;
        max-width: 260px;
        overflow: hidden;
        box-shadow: 0 1px 2px rgba(11, 35, 64,0.04);
      }
      .lio-aba:hover:not(.lio-aba-ativa) {
        background: var(--bg-sunken) !important;
        color: var(--ink);
        border-color: var(--accent) !important;
        transform: translateY(-1px);
        box-shadow: 0 3px 8px rgba(11, 35, 64,0.08);
      }
      .lio-aba-ativa {
        background: var(--primary) !important;
        color: white !important;
        border-color: var(--primary) !important;
        box-shadow: 0 3px 10px rgba(20, 51, 82, 0.28), 0 1px 3px rgba(20, 51, 82, 0.20) !important;
      }
      /* Remove a faixa dourada do estilo Chrome */
      .lio-aba-ativa::before { display: none; }

      .lio-aba-bullet {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        display: inline-block;
        flex-shrink: 0;
        opacity: 0.7;
        transition: background-color 180ms, color 180ms, border-color 180ms, box-shadow 180ms, transform 180ms, opacity 180ms;
      }
      .lio-aba-bullet-conv { background: #143352; }
      .lio-aba-bullet-part { background: #2a5a8c; }
      .lio-aba-bullet-adic { background: #1FA67A; }
      .lio-aba-ativa .lio-aba-bullet {
        background: var(--accent) !important;
        opacity: 1;
        box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.20);
      }

      .lio-aba-label {
        text-transform: uppercase;
      }
      .lio-aba-badge {
        background: var(--bg-sunken);
        color: var(--ink-faint);
        font-size: 10.5px;
        padding: 2px 9px;
        border-radius: 999px;
        font-weight: 800;
        font-family: var(--font-mono);
        transition: background-color 180ms, color 180ms, border-color 180ms, box-shadow 180ms, transform 180ms, opacity 180ms;
        border: 1px solid var(--border);
      }
      .lio-aba-ativa .lio-aba-badge {
        background: rgba(255, 255, 255, 0.22) !important;
        color: white !important;
        border-color: rgba(255, 255, 255, 0.30) !important;
      }

      /* O painel volta ao layout normal sem "conectar" às abas */
      .lio-painel {
        border-top: 1px solid var(--border);
        border-radius: 10px;
        position: relative;
        z-index: 1;
      }

      /* ── V667: aba ADICIONAL ─────────────────────────────────────────── */
      /* V670: a tela do LIO tem altura FIXA (calc(100vh - 60px)) — o painel
         precisa flexionar e rolar por dentro, senão resumo e matriz "descem"
         para fora da área visível (bug relatado). */
      .lio-adic-painel { background: var(--bg-raised, #fff); border: 1px solid var(--border); padding: 14px 18px; display: flex; flex-direction: column; gap: 12px; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
      .lio-adic-expl { margin: 0; font-size: 12.5px; color: var(--ink-soft); line-height: 1.55; flex-shrink: 0; }
      .lio-adic-expl-ex { display: block; margin-top: 4px; color: var(--ink-faint); font-size: 11.5px; }
      .lio-adic-expl-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; color: var(--ink-soft); flex-shrink: 0; }
      .lio-adic-expl-acoes { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
      /* V714: botão "Enviar" no padrão shadcn (primary sólido, rounded-md,
         hover a 90%, focus ring) — o checkbox segue escondido dentro do label
         pra manter o comportamento de liga/desliga. */
      .lio-adic-consol-sw { position: relative; display: inline-flex; align-items: center; justify-content: center;
        white-space: nowrap; height: 34px; padding: 0 16px; border-radius: 6px;
        font-size: 13px; font-weight: 600; letter-spacing: .01em;
        background: #0f1d2e; color: #fff; border: none; cursor: pointer; user-select: none;
        transition: background-color .15s ease, box-shadow .15s ease; }
      .lio-adic-consol-sw:hover { background: rgba(15, 29, 46, .9); }
      .lio-adic-consol-sw:focus-within { box-shadow: 0 0 0 2px var(--bg-elevated, #fff), 0 0 0 4px var(--accent-vivid, #4f7fb0); }
      .lio-adic-consol-sw.ligado { background: #0E7A57; }
      .lio-adic-consol-sw.ligado:hover { background: rgba(14, 122, 87, .9); }
      .lio-adic-consol-sw input { position: absolute; opacity: 0; pointer-events: none; margin: 0; }
      .lio-adic-cadastro { flex-shrink: 0; }
      .lio-adic-resumo { flex-shrink: 0; }
      .lio-adic-cadastro { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; background: var(--bg-sunken, #f7f8f8); }
      .lio-adic-cad-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .lio-adic-cad-head h4 { margin: 0; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); }
      .lio-adic-cad-qtd { background: var(--bg-raised, #fff); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; font-size: 10.5px; font-family: var(--font-mono); }
      .lio-adic-pct { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--ink-soft); }
      .lio-adic-pct input { width: 74px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 7px; font-family: var(--font-mono); font-size: 12.5px; }
      .lio-adic-add { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; }
      .lio-adic-add-nome { position: relative; flex: 1 1 320px; }
      .lio-adic-add-nome > input, .lio-adic-add > input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 12.5px; }
      .lio-adic-add > input { flex: 0 1 200px; width: auto; }
      .lio-adic-sug { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 40; background: var(--bg-raised, #fff); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 22px rgba(11, 35, 64,0.14); max-height: 240px; overflow-y: auto; }
      .lio-adic-sug-item { padding: 7px 10px; font-size: 12px; cursor: pointer; border-bottom: 1px solid var(--border); }
      .lio-adic-sug-item:last-child { border-bottom: none; }
      .lio-adic-sug-item:hover { background: var(--bg-sunken, #eef2f1); }
      .lio-adic-sug-preview { cursor: default; }
      .lio-adic-sug-head { padding: 7px 10px; font-size: 11px; color: var(--ink-soft); background: var(--bg-sunken, #f2f6f5); border-bottom: 1px solid var(--border); }
      .lio-adic-sug-head strong { color: #0E7A57; }
      .lio-adic-sug-zero { color: #8a5a00; background: #fff6e3; }
      .lio-adic-item-casa { flex-shrink: 0; font-size: 10.5px; color: var(--ink-faint); background: var(--bg-sunken, #eef2f1); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; font-family: var(--font-mono); }
      .lio-adic-lista { display: flex; flex-direction: column; gap: 4px; max-height: 150px; overflow-y: auto; }
      .lio-adic-item { display: flex; align-items: center; gap: 10px; padding: 6px 10px; background: var(--bg-raised, #fff); border: 1px solid var(--border); border-radius: 8px; font-size: 12.5px; }
      .lio-adic-item-nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lio-adic-item-valor { font-weight: 700; }
      .lio-adic-item-inativa { opacity: 0.5; }
      .lio-adic-item-inativa .lio-adic-item-nome { text-decoration: line-through; }
      .lio-adic-mini { border: 1px solid var(--border); background: var(--bg-raised, #fff); border-radius: 7px; padding: 2px 8px; cursor: pointer; font-size: 11.5px; }
      .lio-adic-mini:hover { background: var(--bg-sunken, #eef2f1); }
      .lio-adic-mini-rm { color: var(--danger, #9B3A3A); }
      .lio-adic-vazio { margin: 0; font-size: 12px; color: var(--ink-faint); }
      .lio-adic-aviso { margin: 0; font-size: 12px; color: #8a5a00; background: #fff6e3; border: 1px solid #ecd9a8; border-radius: 8px; padding: 8px 10px; }
      .lio-adic-resumo { display: flex; gap: 22px; flex-wrap: wrap; font-size: 12.5px; color: var(--ink-soft); padding: 4px 2px; }
      .lio-adic-rep { color: #0E7A57; }
      /* V671: a matriz ocupa TODO o espaço restante (sem teto de 62vh) e o
         cabeçalho sticky fica POR CIMA das linhas (z-index) — antes as letras
         "passavam por cima" dos títulos ao rolar e o hover apagava o header. */
      /* V866: mesmo teto da matriz principal — sem ele a área cresce com o
         conteúdo, quem rola vira a página e o cabeçalho fixo não gruda */
      .lio-adic-scroll {
        overflow-x: auto; overflow-y: auto;
        border: 1px solid var(--border); border-radius: 10px;
        flex: 0 1 auto; min-height: 0;   /* V867: acompanha o conteúdo, não estica */
        --lio-linhas-visiveis: 20;
        --lio-altura-linha: 33px;   /* medida: esta matriz é mais compacta */
        max-height: calc(38px + var(--lio-linhas-visiveis) * var(--lio-altura-linha));
        scroll-behavior: smooth;
        overscroll-behavior: contain;
      }
      .lio-adic-cad-toggle { cursor: pointer; user-select: none; }
      .lio-adic-cad-toggle .lio-adic-cad-seta { display: inline-block; margin-right: 4px; font-size: 10px; transition: transform 160ms; }

      /* ── V708 ─────────────────────────────────────────────────────── */
      .lio-adic-aj-hint { font-weight: 400; opacity: .78; }
      .lio-adic-data-paga { background: #DFF2EA; color: #0A7A5A; border-radius: 99px;
        padding: 3px 10px; font-size: 11px; font-weight: 700; white-space: nowrap; }
      .lio-adic-data-fundo { position: fixed; inset: 0; background: rgba(15, 29, 46, .45);
        z-index: 320; display: flex; align-items: center; justify-content: center; }
      .lio-adic-data-box { background: var(--bg-elevated); border-radius: 12px; padding: 20px;
        width: min(420px, 92vw); box-shadow: var(--shadow-lg); }
      .lio-adic-data-box h4 { margin: 0 0 8px; font-size: 15px; }
      .lio-adic-data-box p { margin: 0 0 12px; font-size: 12.5px; color: var(--ink-soft); }
      .lio-adic-data-box input[type="date"],
      .lio-adic-data-box input[type="month"] { width: 100%; box-sizing: border-box; padding: 8px 10px;
        border: 1px solid var(--border); border-radius: 8px; font: inherit; }
      .lio-adic-data-acoes { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
      .lio-kpi-subtotais { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; }
      .lio-kpi-subtot { display: flex; justify-content: space-between; gap: 12px;
        font-size: 12px; line-height: 1.35; }
      .lio-kpi-subtot-rot { font-size: 10px; font-weight: 800; letter-spacing: .08em; opacity: .75; }
      .lio-col-padrao { max-width: 180px; }
      .lio-col-padrao .lio-termo-chip { margin: 1px 2px 1px 0; display: inline-block; }
      .lio-col-padrao-vazio { color: var(--ink-faint); }
      .lio-termo-chip-extra { opacity: .72; }
      .lio-menu-item-adic .lio-menu-item-ico { color: #B8965A; }
      .lio-adic-cadastro.lio-adic-cad-fechado { gap: 0; }
      /* border-collapse: separate — com collapse, o sticky th perde a borda ao
         rolar; o sublinhado do header vira box-shadow, que acompanha o sticky */
      .lio-adic-tabela { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
      .lio-adic-tabela th { position: sticky; top: 0; z-index: 5; background: var(--primary, #143352); color: #fff; text-align: left; padding: 9px 10px; font-size: 10.5px; letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap; box-shadow: inset 0 -2px 0 rgba(0,0,0,0.22); }
      .lio-adic-tabela td { padding: 6px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; background: var(--bg-raised, #fff); }
      .lio-adic-tabela tbody tr:nth-child(even) td { background: var(--bg-sunken, #f6f9f8); }
      .lio-adic-tabela tbody tr:hover td { background: var(--accent-soft, #e3efeb); }
      .lio-adic-tabela tbody tr:last-child td { border-bottom: none; }
      /* (V674 usa CSS próprio pmm-* injetado pela Produção Médica) */
      .lio-adic-num { text-align: right; white-space: nowrap; }
      .lio-adic-linha-dentro { opacity: 0.55; }
      .lio-adic-linha-inelegivel { opacity: 0.6; }
      .lio-adic-tag-inel { display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 700; color: #8a5a00; background: #fff6e3; border: 1px solid #ecd9a8; border-radius: 999px; padding: 1px 7px; white-space: nowrap; }
      .lio-adic-vazio-grande { padding: 34px 16px; text-align: center; font-size: 13px; color: var(--ink-faint); border: 1px dashed var(--border); border-radius: 10px; }
      /* Faixa colorida fininha no topo da aba ativa — destaca como "selecionada" */
      .lio-aba-ativa::before {
        content: '';
        position: absolute;
        top: 0;
        left: 6px;
        right: 6px;
        height: 3px;
        background: var(--accent);
        border-radius: 3px 3px 0 0;
      }

      .lio-aba-bullet {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        display: inline-block;
        flex-shrink: 0;
        opacity: 0.55;
        transition: background-color 220ms cubic-bezier(0.4, 0, 0.2, 1), color 220ms cubic-bezier(0.4, 0, 0.2, 1), border-color 220ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 220ms cubic-bezier(0.4, 0, 0.2, 1), transform 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 220ms cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        z-index: 1;
      }
      .lio-aba-bullet-conv { background: #143352; }
      .lio-aba-bullet-part { background: #2a5a8c; }
      .lio-aba-bullet-adic { background: #1FA67A; }
      .lio-aba-ativa .lio-aba-bullet {
        opacity: 1;
        transform: scale(1.15);
        box-shadow: 0 0 0 3px rgba(42, 90, 140, 0.20);
      }

      .lio-aba-label {
        text-transform: uppercase;
        position: relative;
        z-index: 1;
      }
      .lio-aba-badge {
        background: var(--bg-sunken);
        color: var(--ink-faint);
        font-size: 10.5px;
        padding: 2px 9px;
        border-radius: 999px;
        font-weight: 800;
        position: relative;
        z-index: 1;
        font-family: var(--font-mono);
        transition: background-color 220ms, color 220ms, border-color 220ms, box-shadow 220ms, transform 220ms, opacity 220ms;
        border: 1px solid var(--border);
      }
      .lio-aba-ativa .lio-aba-badge {
        background: var(--accent);
        color: white;
        border-color: var(--accent);
        box-shadow: 0 1px 3px rgba(42, 90, 140, 0.40);
      }

      /* O painel da tabela "conecta" às abas — sem border-top no canto */
      .lio-painel {
        border-top: none;
        border-radius: 0 10px 10px 10px;   /* canto esquerdo cima sem radius pra colar nas abas */
        position: relative;
        z-index: 1;
      }

      /* ── Painel + Tabela com scroll interno (#5) ── */
      .lio-painel {
        /* V867: o painel tem a altura do que ele mostra.
           A V864 pôs um piso de 420px aqui para a matriz não ser espremida
           entre os cards e o banner de aviso — mas o piso vale nos DOIS
           sentidos: com poucas linhas ele reservava o mesmo espaço e sobrava um
           vão branco embaixo. O aperto de antes vinha da tela ter altura FIXA
           (também corrigido na V864); com a altura livre, o painel pode
           simplesmente acompanhar o conteúdo. */
        flex: 0 0 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-top: none;
        border-radius: 0 0 10px 10px;
        overflow: hidden;
        box-shadow: 0 4px 14px rgba(11, 35, 64,0.08);
      }
      .lio-painel-head {
        padding: 10px 14px;
        background: var(--bg-sunken);
        border-bottom: 1px solid var(--border);
        font-size: 12px;
        color: var(--ink-soft);
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 14px;
        flex-wrap: wrap;
      }
      .lio-painel-info { flex: 1; min-width: 0; }
      .lio-painel-info strong { color: var(--primary); }

      /* ── Botão Exportar e menu dropdown ── */
      #lio-btn-exportar {
        height: 34px;
        padding: 0 14px;
        font-size: 12px;
        font-weight: 700;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-right: 8px;
      }
      .lio-page-header-dir {
        display: flex;
        align-items: center;
      }

      /* ═══════════════════════════════════════════════════════════════════
         V129.20: Linhas de teste manuais
         ═══════════════════════════════════════════════════════════════════ */
      .lio-btn-teste {
        height: 34px;
        padding: 0 14px;
        font-size: 12px;
        font-weight: 700;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-right: 8px;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        color: var(--ink-soft);
        cursor: pointer;
        border-radius: 8px;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .lio-btn-teste:hover {
        border-color: #7C5CBF;
        color: #7C5CBF;
        background: rgba(124, 92, 191, 0.06);
      }

      /* V129.21: Badge "SEM CADASTRO" + toggle do 2,5% indicante */
      .lio-badge-sem-opme {
        display: inline-block;
        background: rgba(155, 58, 58, 0.10);
        color: var(--danger, #9B3A3A);
        border: 1px solid rgba(155, 58, 58, 0.25);
        font-size: 9px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        letter-spacing: 0.03em;
      }
      .lio-col-valor-lio { font-weight: 600; }

      /* V129.30: nome da LIO cadastrada + termos casados embaixo do Produto */
      .lio-produto-nome {
        line-height: 1.3;
      }
      .lio-produto-regra {
        margin-top: 3px;
        font-size: 10px;
        font-weight: 600;
        color: #1d4470;
        line-height: 1.25;
        white-space: normal;
      }
      .lio-produto-termos {
        margin-top: 3px;
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        align-items: center;
        font-size: 9px;
      }
      .lio-termo-chip {
        display: inline-block;
        background: rgba(42, 90, 140, 0.10);
        color: #1d4470;
        border: 1px solid rgba(42, 90, 140, 0.25);
        border-radius: 3px;
        padding: 1px 5px;
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.02em;
      }
      .lio-aj-toggle-indicante {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
        padding: 10px 12px;
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        border-radius: 8px;
        cursor: pointer;
        font-size: 12px;
        color: var(--ink-soft);
        font-weight: 500;
      }
      .lio-aj-toggle-indicante input {
        width: 16px; height: 16px;
        accent-color: #2a5a8c;
        flex-shrink: 0;
        cursor: pointer;
      }
      .lio-aj-toggle-indicante:hover {
        border-color: #2a5a8c;
      }

      /* Linha de teste — destaque lilás/roxo pra diferenciar dos dados reais */
      .lio-tabela tbody tr.lio-linha-teste > td {
        background: rgba(124, 92, 191, 0.07) !important;
        border-top: 1px dashed rgba(124, 92, 191, 0.35);
        border-bottom: 1px dashed rgba(124, 92, 191, 0.35);
      }
      .lio-td-admissao-teste { vertical-align: middle; }
      .lio-admissao-teste-wrap {
        display: flex;
        flex-direction: column;
        gap: 3px;
        align-items: flex-start;
      }
      .lio-teste-badge {
        display: inline-block;
        background: #7C5CBF;
        color: white;
        font-size: 9px;
        font-weight: 800;
        padding: 2px 7px;
        border-radius: 4px;
        letter-spacing: 0.05em;
      }
      .lio-admissao-teste-wrap .lio-admissao-cod { font-weight: 600; }
      .lio-teste-acoes { display: inline-flex; gap: 4px; }
      .lio-teste-editar, .lio-teste-remover {
        width: 20px; height: 20px;
        border-radius: 4px;
        border: 1px solid var(--border);
        background: var(--bg-elevated);
        cursor: pointer;
        font-size: 11px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
        padding: 0;
        color: var(--ink-soft);
      }
      .lio-teste-editar:hover { background: #7C5CBF; color: white; border-color: #7C5CBF; }
      .lio-teste-remover:hover { background: #9B3A3A; color: white; border-color: #9B3A3A; }

      /* V129.26: Duplicidade Convênio × Particular */
      .lio-tabela tbody tr.lio-linha-duplicada > td {
        background: rgba(42, 90, 140, 0.07) !important;
      }
      .lio-tabela tbody tr.lio-linha-desabilitada > td {
        opacity: 0.55;
        background: rgba(155, 58, 58, 0.06) !important;
      }
      .lio-tabela tbody tr.lio-linha-desabilitada .lio-dup-toggle,
      .lio-tabela tbody tr.lio-linha-desabilitada .lio-dup-badge,
      .lio-tabela tbody tr.lio-linha-desabilitada .lio-teste-badge,
      .lio-tabela tbody tr.lio-linha-desabilitada .lio-teste-acoes {
        opacity: 1;  /* controles permanecem legíveis */
      }
      .lio-td-admissao-multi { vertical-align: middle; }
      .lio-admissao-multi-wrap {
        display: flex;
        flex-direction: column;
        gap: 4px;
        align-items: flex-start;
      }
      .lio-admissao-badges { display: flex; gap: 4px; flex-wrap: wrap; }
      .lio-dup-badge {
        display: inline-block;
        background: rgba(42, 90, 140, 0.18);
        color: #143352;
        border: 1px solid rgba(42, 90, 140, 0.40);
        font-size: 9px;
        font-weight: 800;
        padding: 2px 6px;
        border-radius: 4px;
        letter-spacing: 0.04em;
      }
      .lio-dup-controles {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .lio-dup-toggle {
        font-size: 9px;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 4px;
        border: 1px solid;
        cursor: pointer;
        font-family: inherit;
        letter-spacing: 0.03em;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
        text-transform: uppercase;
      }
      .lio-dup-toggle-on {
        background: rgba(10, 122, 90, 0.12);
        color: var(--success, #0A7A5A);
        border-color: rgba(10, 122, 90, 0.30);
      }
      .lio-dup-toggle-on:hover { background: rgba(10, 122, 90, 0.20); }
      .lio-dup-toggle-off {
        background: rgba(155, 58, 58, 0.10);
        color: var(--danger, #9B3A3A);
        border-color: rgba(155, 58, 58, 0.30);
      }
      .lio-dup-toggle-off:hover { background: rgba(155, 58, 58, 0.18); }
      .lio-dup-info {
        font-size: 9px;
        color: var(--ink-faint);
        font-family: var(--font-mono);
      }

      /* Modal de teste */
      .lio-teste-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.55);
         
        z-index: 1600;
      }
      .lio-teste-modal {
        position: fixed;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 92vw; max-width: 720px; max-height: 88vh;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 14px;
        z-index: 1601;
        display: flex; flex-direction: column;
        overflow: hidden;
        box-shadow: 0 30px 80px rgba(0,0,0,0.40);
      }
      .lio-teste-head {
        flex-shrink: 0;
        padding: 18px 20px 14px;
        border-bottom: 1px solid var(--border);
        display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
        background: linear-gradient(180deg, rgba(124,92,191,0.06) 0%, var(--bg-elevated) 100%);
      }
      .lio-teste-head-titulo { display: flex; gap: 12px; flex: 1; }
      .lio-teste-head-ico {
        font-size: 22px; line-height: 1;
        width: 40px; height: 40px; border-radius: 50%;
        background: rgba(124,92,191,0.15); color: #7C5CBF;
        display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
      }
      .lio-teste-head-titulo strong { display: block; font-size: 15px; color: var(--ink); font-weight: 700; margin-bottom: 2px; }
      .lio-teste-head-titulo small { font-size: 12px; color: var(--ink-soft); line-height: 1.5; }
      .lio-teste-fechar {
        width: 32px; height: 32px; border-radius: 50%;
        background: var(--bg-sunken); border: 1px solid var(--border);
        color: var(--ink-soft); font-size: 14px; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms; flex-shrink: 0;
      }
      .lio-teste-fechar:hover { background: #7C5CBF; color: white; border-color: #7C5CBF; }
      .lio-teste-body { flex: 1; overflow-y: auto; padding: 18px 20px; }
      .lio-teste-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
      }
      .lio-teste-campo { display: flex; flex-direction: column; gap: 5px; }
      .lio-teste-campo label {
        font-size: 11px; font-weight: 700; color: var(--ink-soft);
        text-transform: uppercase; letter-spacing: 0.04em;
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
      }
      .lio-teste-campo-origem {
        font-size: 9px; font-weight: 500; color: var(--ink-faint);
        text-transform: none; letter-spacing: 0;
        background: var(--bg-sunken); padding: 1px 6px; border-radius: 3px;
      }
      /* V129.25: select de origem editável (colunas trocáveis) */
      .lio-teste-origem-select {
        font-size: 9px;
        font-weight: 600;
        color: #7C5CBF;
        background: rgba(124, 92, 191, 0.08);
        border: 1px solid rgba(124, 92, 191, 0.30);
        border-radius: 4px;
        padding: 1px 4px;
        cursor: pointer;
        font-family: inherit;
        text-transform: none;
        letter-spacing: 0;
        max-width: 150px;
      }
      .lio-teste-origem-select:hover {
        border-color: #7C5CBF;
        background: rgba(124, 92, 191, 0.14);
      }
      .lio-teste-origem-select:focus {
        outline: none;
        box-shadow: 0 0 0 2px rgba(124, 92, 191, 0.20);
      }
      .lio-teste-input {
        padding: 9px 11px; font-size: 13px; font-family: inherit;
        background: white; border: 1px solid var(--border);
        border-radius: 8px; color: var(--ink);
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms; box-sizing: border-box; width: 100%;
      }
      .lio-teste-input:focus {
        outline: none; border-color: #7C5CBF;
        box-shadow: 0 0 0 3px rgba(124,92,191,0.15);
      }
      .lio-teste-footer {
        flex-shrink: 0; padding: 14px 20px;
        border-top: 1px solid var(--border);
        display: flex; justify-content: space-between; align-items: center; gap: 12px;
      }
      .lio-teste-footer-help { font-size: 11px; color: var(--ink-faint); }
      .lio-teste-footer-btns { display: flex; gap: 8px; }
      .lio-teste-btn-cancelar {
        background: var(--bg-sunken); border: 1px solid var(--border);
        color: var(--ink-soft); padding: 9px 18px; border-radius: 8px;
        font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .lio-teste-btn-cancelar:hover { background: var(--border-soft); }
      .lio-teste-btn-salvar {
        background: #7C5CBF; color: white; border: none;
        padding: 9px 22px; border-radius: 8px;
        font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .lio-teste-btn-salvar:hover {
        background: #6A4DA8; transform: translateY(-1px);
        box-shadow: 0 3px 10px rgba(124,92,191,0.30);
      }
      /* V649: a regra .lio-menu-exp tinha sido CORROMPIDA (sobrou só o
         fragmento da animação, sem o seletor) — sem posicionamento, o menu
         de exportação abria estático no FIM da página, invisível: o clique
         em "Exportar Excel" parecia não fazer nada. */
      .lio-menu-exp {
        position: absolute;
        z-index: 9999;
        min-width: 300px;
        max-width: 360px;
        background: var(--bg-elevated, #FFF);
        border: 1px solid var(--border, #dfe4ea);
        border-radius: 12px;
        box-shadow: 0 14px 36px rgba(16, 45, 75, 0.22), 0 3px 8px rgba(16, 45, 75, 0.10);
        padding: 6px;
        animation: lioPopIn 180ms ease-out;
      }
      .lio-menu-exp-titulo {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--ink-faint);
        padding: 6px 12px 4px;
      }
      .lio-menu-item {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 10px 12px;
        background: transparent;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-family: inherit;
        color: var(--ink);
        text-align: left;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
      }
      .lio-menu-item:hover {
        background: var(--bg-sunken);
      }
      .lio-menu-item-ico {
        width: 30px; height: 30px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(42, 90, 140,0.10);
        color: var(--accent);
        border-radius: 6px;
        font-size: 14px;
        font-weight: 800;
        flex-shrink: 0;
      }
      .lio-menu-item strong {
        display: block;
        font-size: 12px;
        font-weight: 700;
        color: var(--ink);
        line-height: 1.2;
      }
      .lio-menu-item small {
        display: block;
        font-size: 10.5px;
        color: var(--ink-faint);
        margin-top: 1px;
        line-height: 1.2;
      }
      .lio-menu-item-aviso strong { color: var(--ink-faint); }
      .lio-menu-item-aviso small { color: #C24A1F; font-weight: 700; }
      .lio-menu-item-verde .lio-menu-item-ico {
        background: rgba(20, 51, 82, 0.12);
        color: #143352;
      }
      .lio-menu-item-vermelho .lio-menu-item-ico {
        background: rgba(194, 74, 31, 0.10);
        color: #C24A1F;
      }
      .lio-menu-item-conv .lio-menu-item-ico {
        background: rgba(20, 51, 82, 0.12);
        color: #143352;
      }
      .lio-menu-item-part .lio-menu-item-ico {
        background: rgba(42, 90, 140, 0.14);
        color: #143352;
      }
      .lio-menu-sep {
        height: 1px;
        background: var(--border);
        margin: 6px 8px;
      }

      /* ── Toggle Com regra / Sem regra / Todas ── */
      .lio-matriz-toggle {
        display: inline-flex;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 3px;
        gap: 2px;
        box-shadow: inset 0 1px 2px rgba(11, 35, 64,0.06);
      }
      .lio-matriz-opt {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
        background: transparent;
        border: none;
        border-radius: 5px;
        font-family: inherit;
        font-size: 11px;
        font-weight: 700;
        color: var(--ink-soft);
        cursor: pointer;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .lio-matriz-opt:hover { color: var(--ink); background: var(--bg-sunken); }
      .lio-matriz-opt-ativa {
        background: var(--primary);
        color: white;
        box-shadow: 0 1px 3px rgba(11, 35, 64,0.20);
      }
      .lio-matriz-opt-ativa:hover { background: var(--primary); color: white; }
      .lio-matriz-opt-ativa.lio-matriz-opt-sem {
        background: #C24A1F;
        color: white;
      }
      .lio-matriz-opt-badge {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 800;
        background: rgba(0,0,0,0.10);
        padding: 1px 6px;
        border-radius: 999px;
        min-width: 18px;
        text-align: center;
      }
      .lio-matriz-opt-ativa .lio-matriz-opt-badge {
        background: rgba(255,255,255,0.25);
      }

      /* ── Linha SEM regra aplicada — visualmente atenuada ── */
      .lio-linha-sem-regra td {
        opacity: 0.55;
        background: repeating-linear-gradient(
          45deg,
          transparent, transparent 6px,
          rgba(0,0,0,0.025) 6px, rgba(0,0,0,0.025) 7px
        );
      }
      .lio-linha-sem-regra:hover td {
        opacity: 0.8;
        background: rgba(42, 90, 140,0.04);
      }
      .lio-badge-sem-regra {
        display: inline-block;
        font-size: 9px;
        font-weight: 800;
        padding: 2px 7px;
        border-radius: 999px;
        background: rgba(194, 74, 31, 0.10);
        color: #C24A1F;
        border: 1px solid rgba(194, 74, 31, 0.35);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .lio-tag-div-info {
        background: rgba(255, 213, 79, 0.25);
        color: #8A5500;
        padding: 1px 7px;
        border-radius: 3px;
        font-weight: 700;
        font-size: 10px;
      }
      .lio-tabela-scroll {
        overflow: auto;
        flex: 1;
        min-height: 0;
      }
      /**
       * V866: a matriz mostra ~20 LINHAS e rola por dentro, nos dois eixos.
       *
       * A V864 trocou a altura fixa da tela por uma altura mínima — o que
       * resolveu o corte, mas tirou o teto da área de rolagem: sem teto, ela
       * cresce com o conteúdo, a tabela nunca transborda e quem rola passa a
       * ser a PÁGINA. Aí o cabeçalho fixo não tem a que grudar (a fixação só
       * funciona dentro de quem realmente rola) e parecia não estar aplicada.
       *
       * O teto devolve a rolagem para dentro do painel e, de quebra, atende o
       * pedido de limitar o que aparece de uma vez.
       */
      .lio-tabela-scroll {
        overflow-y: auto;
        overflow-x: auto;            /* V129.27: scroll horizontal habilitado */
        /* V867: NÃO estica. Com flex 1 a área absorvia toda a sobra do
           painel: com 5 linhas na tela, as outras 15 viravam um vão branco
           embaixo da tabela. Agora ela tem a altura do conteúdo — e o teto
           abaixo segura em 20 linhas quando há mais que isso. */
        flex: 0 1 auto;
        min-height: 0;
        /* cabeçalho de 2 linhas + 20 linhas. A altura da linha foi MEDIDA na
           tela (41px com o padding e a fonte desta matriz), não estimada. */
        --lio-linhas-visiveis: 20;
        --lio-altura-linha: 41px;
        max-height: calc(46px + var(--lio-linhas-visiveis) * var(--lio-altura-linha));
        scroll-behavior: smooth;
        overscroll-behavior: contain;   /* rolar até o fim não arrasta a página */
      }
      .lio-tabela {
        width: 100%;
        min-width: 1700px;            /* V129.29: força scroll + mais espaço p/ as 12 colunas */
        table-layout: fixed;            /* respeita as larguras das colunas */
        border-collapse: collapse;
        font-size: 12px;
      }
      .lio-tabela thead th {
        background: #071a30;
        /* V709: mesma ALTURA do cabeçalho da aba ADICIONAL — só o
           dimensionamento mudou (título+origem+filtros+resize continuam) */
        padding: 4px 8px 5px;
        font-weight: 700;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #FFFFFF;
        border-bottom: 2px solid #0b2340;
        position: sticky;
        top: 0;
        z-index: 5;                       /* V709: esteira — linhas passam POR BAIXO */
        box-shadow: inset 0 -2px 0 rgba(0,0,0,0.22);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: middle;
      }

      /* V129.16: Título principal + subtítulo de origem da coluna */
      .lio-th-titulo {
        display: flex;
        align-items: center;
        justify-content: center;   /* V129.28: centraliza junto com o subtítulo */
        gap: 6px;
        font-size: 10.5px;         /* V709: compactado à altura do ADICIONAL */
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #FFFFFF;
        line-height: 1.15;
      }
      .lio-th-origem {
        margin-top: 1px;           /* V709: compactado */
        font-size: 9px;
        font-weight: 500;
        color: #e4ecf4;
        text-transform: none;
        letter-spacing: 0.02em;
        opacity: 1;
        line-height: 1.25;
        font-style: normal;
        text-align: center;        /* V129.28: subtítulo centralizado */
      }

      /* V129.17: Subtítulo trocável + menu de origem */
      .lio-th-origem-trocavel {
        position: relative;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 2px 6px;
        margin: 0 auto;            /* V129.28: centraliza o subtítulo trocável */
        border-radius: 4px;
        border: 1px dashed transparent;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        user-select: none;
      }
      .lio-th-origem-trocavel:hover {
        background: rgba(79, 127, 176, 0.12);
        border-color: rgba(255, 255, 255, 0.55);
        color: #FFFFFF;
        font-style: normal;
        opacity: 1;
      }
      .lio-th-origem-chevron {
        font-size: 9px;
        font-style: normal;
        opacity: 0.7;
        margin-left: 2px;
      }
      .lio-th-origem-trocavel:hover .lio-th-origem-chevron {
        opacity: 1;
        color: #2a5a8c;
      }
      .lio-th-origem-menu {
        position: fixed;
        top: 0;
        left: 0;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        min-width: 200px;
        max-width: 280px;
        padding: 6px;
        z-index: 9999;
        text-transform: none;
        letter-spacing: 0;
        font-style: normal;
        /* Inicialmente oculto — JS calcula a posição e exibe */
        visibility: hidden;
      }
      .lio-th-origem-menu.lio-th-origem-menu-visivel {
        visibility: visible;
      }
      .lio-th-origem-menu-titulo {
        font-size: 10px;
        font-weight: 700;
        color: var(--ink-faint);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 6px 10px 4px;
        border-bottom: 1px solid var(--border);
        margin-bottom: 4px;
      }
      .lio-th-origem-menu-opt {
        display: block;
        width: 100%;
        text-align: left;
        background: transparent;
        border: none;
        padding: 7px 10px;
        font-size: 11px;
        font-family: inherit;
        color: var(--ink-soft);
        cursor: pointer;
        border-radius: 4px;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
        font-weight: 500;
      }
      .lio-th-origem-menu-opt:hover {
        background: rgba(42, 90, 140, 0.10);
        color: #2a5a8c;
      }
      .lio-th-origem-menu-opt-ativa {
        background: rgba(42, 90, 140, 0.08);
        color: #1d4470;
        font-weight: 700;
      }

      /* V129.16: Coluna T (teste) — fundo diferenciado */
      .lio-th-teste {
        background: rgba(42, 90, 140, 0.06) !important;
        text-align: center;
      }
      .lio-th-teste .lio-th-titulo {
        justify-content: center;
        color: #2a5a8c;
        font-size: 14px;
        font-weight: 800;
      }
      .lio-th-teste .lio-th-origem {
        text-align: center;
        color: #2a5a8c;
        opacity: 0.7;
      }
      .lio-col-teste {
        text-align: center;
        background: rgba(42, 90, 140, 0.03);
      }
      .lio-t-badge {
        display: inline-block;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.04em;
        font-family: var(--font-mono);
      }
      .lio-t-ok {
        background: rgba(10, 122, 90, 0.12);
        color: var(--success, #0A7A5A);
        border: 1px solid rgba(10, 122, 90, 0.25);
      }
      .lio-t-alias {
        background: rgba(42, 90, 140, 0.12);
        color: #1d4470;
        border: 1px solid rgba(42, 90, 140, 0.30);
      }
      .lio-t-fail {
        background: rgba(155, 58, 58, 0.10);
        color: var(--danger, #9B3A3A);
        border: 1px solid rgba(155, 58, 58, 0.25);
      }
      .lio-t-neutro {
        background: var(--bg-sunken);
        color: var(--ink-faint);
        border: 1px solid var(--border);
      }

      /* V129.16: Tabela vazia (cabeçalhos visíveis mas sem dados) */
      .lio-tabela-vazia td {
        padding: 50px 20px !important;
        text-align: center;
        background: var(--bg) !important;
      }
      .lio-tabela-vazia-msg {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        color: var(--ink-faint);
        font-size: 13px;
        font-style: italic;
      }
      .lio-tabela-vazia-ico {
        font-size: 28px;
        opacity: 0.4;
        font-style: normal;
      }
      .lio-tabela tbody td {
        padding: 11px 10px;
        border-bottom: 1px solid var(--border-soft);
        vertical-align: middle;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* Zebra — V717: mesmas cores da aba ADICIONAL (branco + azul
         var(--bg-sunken)); antes era um bege rgba(246, 244, 239,.45) e as abas
         ficavam com cores diferentes entre si. Hover idem (accent-soft). */
      .lio-tabela tbody tr:nth-child(even) td {
        background: var(--bg-sunken, #f6f9f8);
      }
      .lio-tabela tbody tr:hover td {
        background: var(--accent-soft, #e3efeb) !important;
      }

      /* ── ALINHAMENTO ── Headers CENTRO, células à ESQUERDA, valores numéricos à DIREITA */
      .lio-tela .lio-tabela thead th,
      .lio-tela .lio-tabela thead th.num {
        text-align: center !important;
        padding-left: 14px;
        padding-right: 14px;
      }
      .lio-tela .lio-tabela tbody td {
        text-align: left !important;
      }
      /* Valor (col 9) e Repasse (col 10) à DIREITA — coluna do expand não existe mais */
      .lio-tela .lio-tabela tbody td.num,
      .lio-tela .lio-tabela tbody td:nth-child(9),
      .lio-tela .lio-tabela tbody td:nth-child(10) {
        text-align: right !important;
      }
      /* V994: O RODAPÉ FICAVA DESALINHADO. A regra acima só pegava o tbody, e
         o .num do tfoot caía no alinhamento padrão (à esquerda): os totais
         encostavam na borda ESQUERDA da célula enquanto os valores da coluna
         encostavam na DIREITA. Com números de tamanhos diferentes (12.000,00
         em cima, 602.130,79 embaixo) a diferença saltava aos olhos. */
      .lio-tela .lio-tabela tfoot td.num { text-align: right !important; }
      .lio-tabela .mono { font-family: var(--font-mono); font-size: 11.5px; }

      /* ── Alça de redimensionamento de colunas ── */
      /* V709: era position:relative — SOBRESCREVIA o sticky da regra principal
         e o cabeçalho rolava junto. Sticky também ancora os absolutes
         (alça/popover), então o congelamento e a alça convivem. */
      /* V865: a fixação já estava aqui — faltava o OFFSET. Sem declarar o
         topo, o valor é auto e a célula nunca chega a grudar em nada: o
         cabeçalho subia junto com as linhas. O rodapé (tfoot) já declarava
         bottom 0 e por isso funcionava. */
      .lio-tabela thead th {
        position: sticky;
        top: 0;
        z-index: 3;
      }
      .lio-col-resize {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: 6px;
        cursor: col-resize;
        z-index: 5;
        background: transparent;
        transition: background 150ms;
        user-select: none;
      }
      .lio-col-resize:hover,
      .lio-col-resize.lio-col-resize-ativa {
        background: linear-gradient(to right, transparent, var(--accent) 50%, transparent);
      }
      .lio-col-resize::after {
        content: '';
        position: absolute;
        right: 2px;
        top: 30%;
        bottom: 30%;
        width: 2px;
        background: rgba(42, 90, 140, 0.35);
        border-radius: 2px;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .lio-col-resize:hover::after,
      .lio-col-resize.lio-col-resize-ativa::after {
        background: var(--accent);
        top: 15%;
        bottom: 15%;
      }
      body.lio-redimensionando,
      body.lio-redimensionando * {
        cursor: col-resize !important;
        user-select: none !important;
      }
      body.lio-redimensionando .lio-tabela tbody tr:hover { background: inherit; }

      /* ── Larguras explícitas pra cada coluna (sem coluna expand) ── */
      .lio-tabela thead th:nth-child(1)  { width: 80px; }    /* data */
      .lio-tabela thead th:nth-child(2)  { width: 88px; }    /* admissão */
      .lio-tabela thead th:nth-child(3)  { width: 16%; }     /* paciente */
      .lio-tabela thead th:nth-child(4)  { width: 130px; }   /* tipo */
      .lio-tabela thead th:nth-child(5)  { width: 19%; }     /* produto */
      .lio-tabela thead th:nth-child(6)  { width: 13%; }     /* convênio */
      .lio-tabela thead th:nth-child(7)  { width: 12%; }     /* indicante */
      .lio-tabela thead th:nth-child(8)  { width: 11%; }     /* executante */
      .lio-tabela thead th:nth-child(9)  { width: 100px; }   /* valor */
      .lio-tabela thead th:nth-child(10) { width: 120px; }   /* repasse */

      .lio-col-expand { display: none !important; }          /* não usado mais */

      .lio-col-expand { width: 32px; padding: 4px 4px !important; text-align: center; }
      .lio-btn-expand {
        border: none; background: transparent;
        color: var(--accent); cursor: pointer;
        font-size: 12px; font-weight: 700;
        padding: 2px 6px; border-radius: 3px;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
      }
      .lio-btn-expand:hover {
        background: rgba(42, 90, 140, 0.18);
        transform: scale(1.2);
      }
      /* Botão ≠ inline na célula de indicante — clicável pra abrir drilldown */
      .lio-btn-expand-inline {
        border: none;
        background: rgba(42, 90, 140, 0.18);
        color: #143352;
        cursor: pointer;
        font-size: 10.5px;
        font-weight: 800;
        padding: 1px 6px;
        border-radius: 999px;
        margin-left: 4px;
        font-family: inherit;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
      }
      .lio-btn-expand-inline:hover {
        background: var(--accent);
        color: white;
        transform: scale(1.1);
      }

      .lio-col-tipo {
        font-size: 10.5px; color: var(--ink-soft); font-weight: 600;
      }
      .lio-col-produto {
        font-size: 11px;
        color: var(--ink-soft);
        white-space: normal;      /* V129.30: permite nome cadastrado + termos em várias linhas */
        overflow: visible;
        vertical-align: top;
      }
      .lio-col-conv { font-size: 11px; color: var(--ink-soft); }
      .lio-col-repasse { color: var(--primary); font-weight: 700; }

      /* Linha com indicante ≠ executante */
      /* V719: SAIU o fundo amarelado das linhas 18% + 2,5% (admissão com
         executante + indicante) — a matriz fica só no zebrado bicolor
         branco/azul. O badge "18%+2,5%" e o marcador ≠ continuam. */
      .lio-linha-divergente { background: transparent; }
      .lio-tag-div {
        display: inline-block;
        background: #FFD54F;
        color: #5C3D00;
        font-size: 9px;
        font-weight: 900;
        padding: 1px 5px;
        border-radius: 3px;
        margin-left: 4px;
        vertical-align: middle;
      }

      /* ── Linha com valor zerado (#4) ── */
      .lio-linha-zerada {
        background: rgba(232, 122, 60, 0.07);
      }
      .lio-linha-zerada:hover {
        background: rgba(232, 122, 60, 0.16);
      }
      .lio-valor-zerado {
        color: #C24A1F;
        font-weight: 700;
      }
      .lio-badge-zerado {
        display: inline-block;
        background: #FCE4D8;
        color: #C24A1F;
        font-size: 8.5px;
        font-weight: 900;
        letter-spacing: 0.04em;
        padding: 2px 6px;
        border-radius: 3px;
        margin-left: 6px;
        vertical-align: middle;
        border: 1px solid #F0B89E;
      }

      .lio-badge-pct {
        display: inline-block;
        background: rgba(42, 90, 140, 0.10);   /* V965: era rgba(20, 51, 82,.08) */
        color: #2a5a8c;                          /* V965: era var(--primary) */
        font-size: 8.5px;
        font-weight: 700;
        letter-spacing: 0.04em;
        padding: 1px 5px;
        border-radius: 3px;
        margin-left: 6px;
      }
      /* V994: dentro das colunas de valor, o selo (% do repasse, GLOSA/ZERADO)
         vai pra ESQUERDA da célula. Colado depois do número, ele empurrava o
         valor pra dentro e só ELE encostava na borda direita — o total do
         rodapé, sem selo, parava numa linha vertical diferente da coluna. */
      .lio-tela .lio-tabela tbody td.num .lio-badge-pct,
      .lio-tela .lio-tabela tbody td.num .lio-badge-zerado {
        display: block;
        width: fit-content;
        margin: 2px 0 0 auto;   /* desce uma linha e encosta na direita, junto do valor */
      }

      /* ── Drilldown (#2) ── */
      .lio-linha-aberta { background: rgba(42, 90, 140, 0.08) !important; }
      .lio-linha-drilldown td {
        padding: 0 !important;
        background: var(--bg-sunken);
        border-bottom: 2px solid var(--accent) !important;
      }
      .lio-drilldown-conteudo {
        padding: 16px 24px;
      }
      .lio-drilldown-titulo {
        font-size: 11px;
        font-weight: 700;
        color: var(--primary);
        margin-bottom: 12px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .lio-drilldown-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
        margin-bottom: 10px;
      }
      .lio-drill-card {
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 12px 14px;
      }
      .lio-drill-exec { border-left: 3px solid #143352; }
      .lio-drill-indic { border-left: 3px solid #FFD54F; }
      .lio-drill-total { border-left: 3px solid var(--accent); }
      .lio-drill-label {
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ink-faint);
        margin-bottom: 4px;
      }
      .lio-drill-nome {
        font-size: 12px;
        color: var(--ink);
        font-weight: 600;
        margin-bottom: 6px;
        min-height: 16px;
      }
      .lio-drill-valor {
        font-size: 15px;
        font-weight: 700;
        font-family: var(--font-mono);
        color: var(--primary);
      }
      .lio-drill-valor-total {
        color: var(--accent);
        font-size: 17px;
      }
      .lio-drilldown-base {
        font-size: 10.5px;
        color: var(--ink-faint);
        padding-top: 6px;
        border-top: 1px dashed var(--border);
      }

      /**
       * V866: a TARJA PRETA era esta linha — o rodapé de totais.
       *
       * O style.css pinta o tfoot td de #071a30 com !important
       * (V181, linha de totais escura em toda a ferramenta), o que anulava o
       * fundo claro que o LIO já pedia aqui. Como esta matriz rola na
       * horizontal e os totais moram nas ÚLTIMAS colunas, com a rolagem à
       * esquerda a faixa aparecia sem texto nenhum: uma tarja preta atravessada
       * embaixo da tabela.
       *
       * Aqui ela volta ao claro — só no LIO; o resto da ferramenta segue com a
       * linha de totais escura da V181.
       */
      .lio-tela .lio-tabela tfoot td,
      .lio-tela .lio-tabela tfoot tr:hover td {
        background: var(--bg-sunken) !important;
        color: var(--ink) !important;
        border-color: var(--border) !important;
      }
      .lio-tela .lio-tabela tfoot td * { color: inherit !important; }
      /* V994: o rodapé precisa do MESMO recuo lateral das células do corpo
         (era 12px contra 10px), senão o total não para na mesma linha
         vertical do valor da coluna. */
      .lio-tabela tfoot td {
        padding: 10px 10px;
        background: var(--bg-sunken);
        border-top: 2px solid var(--border);
        font-size: 11px;
        position: sticky;
        bottom: 0;
        z-index: 1;
        white-space: nowrap !important;       /* NUNCA quebra R$ do valor */
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .lio-total-label {
        text-align: right;
        color: var(--ink-soft);
        text-transform: uppercase;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.05em;
      }
      /* V895: diagnóstico do vazio da aba Convênio */
      .lio-diag-vazio { border-left: 4px solid #1d4470; }
      .lio-diag-cadeia { margin-top: 6px; font-size: 11px; color: var(--ink-faint, #5a6879); }
      .lio-vazio {
        padding: 60px 30px;
        text-align: center;
        color: var(--ink-faint);
        font-size: 12px;
        flex: 1;
      }
      .lio-vazio-pequeno {
        padding: 20px;
        text-align: center;
        color: var(--ink-faint);
        font-size: 11px;
        font-style: italic;
      }

      /* V129.13: Banner de aviso da matriz CONVÊNIO */
      .lio-aviso-flag {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 18px;
        border-radius: 10px;
        margin: 8px 0 12px;
        border: 1px solid;
      }
      .lio-aviso-flag-vazio {
        background: linear-gradient(180deg, rgba(42, 90, 140, 0.06) 0%, var(--bg-elevated) 100%);
        border-color: rgba(42, 90, 140, 0.30);
      }
      .lio-aviso-flag-orfao {
        background: linear-gradient(180deg, rgba(42, 90, 140, 0.08) 0%, var(--bg-elevated) 100%);
        border-color: rgba(42, 90, 140, 0.30);
      }
      .lio-aviso-flag-icone {
        font-size: 26px;
        line-height: 1;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: rgba(42, 90, 140, 0.10);
        color: #2a5a8c;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .lio-aviso-flag-orfao .lio-aviso-flag-icone {
        background: rgba(42, 90, 140, 0.15);
        color: #2a5a8c;
      }
      .lio-aviso-flag-corpo {
        flex: 1;
        min-width: 0;
      }
      .lio-aviso-flag-corpo strong {
        display: block;
        color: var(--ink);
        font-size: 13px;
        font-weight: 700;
        margin-bottom: 3px;
      }
      .lio-aviso-flag-corpo p {
        margin: 0;
        color: var(--ink-soft);
        font-size: 12px;
        line-height: 1.5;
      }
      .lio-aviso-flag-corpo code {
        background: var(--bg-sunken);
        color: var(--primary);
        padding: 1px 6px;
        border-radius: 3px;
        font-size: 11px;
        font-family: var(--font-mono);
        border: 1px solid var(--border);
      }
      .lio-aviso-flag-btn {
        background: #2a5a8c;
        color: white;
        border: none;
        padding: 9px 16px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        white-space: nowrap;
        flex-shrink: 0;
      }
      /* V730: hover SEM troca de cor (pedido do usuário — "Mapear nomes"
         mantinha #2a5a8c e virava outro tom no mouse) — fica só o leve
         levantar + sombra. */
      .lio-aviso-flag-btn:hover {
        background: #2a5a8c;
        transform: translateY(-1px);
        box-shadow: 0 3px 10px rgba(42, 90, 140, 0.30);
      }
      .lio-aviso-flag-orfao .lio-aviso-flag-btn {
        background: #2a5a8c;
      }
      .lio-aviso-flag-orfao .lio-aviso-flag-btn:hover {
        background: #2a5a8c;
        box-shadow: 0 3px 10px rgba(42, 90, 140, 0.35);
      }

      /* ═══════════════════════════════════════════════════════════════════
         V129.15: Modal de Mapeamento de Siglas
         ═══════════════════════════════════════════════════════════════════ */
      .lio-map-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        
        
        z-index: 1500;
      }
      .lio-map-modal {
        position: fixed;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 92vw;
        max-width: 780px;
        max-height: 86vh;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 14px;
        z-index: 1501;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.40);
      }
      .lio-map-head {
        flex-shrink: 0;
        padding: 18px 20px 14px;
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        background: linear-gradient(180deg, rgba(42, 90, 140, 0.06) 0%, var(--bg-elevated) 100%);
      }
      .lio-map-head-titulo {
        display: flex;
        gap: 12px;
        flex: 1;
      }
      .lio-map-head-ico {
        font-size: 22px;
        line-height: 1;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: rgba(42, 90, 140, 0.18);
        color: #2a5a8c;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .lio-map-head-titulo strong {
        display: block;
        font-size: 15px;
        color: var(--ink);
        font-weight: 700;
        margin-bottom: 2px;
      }
      .lio-map-head-titulo small {
        font-size: 12px;
        color: var(--ink-soft);
        line-height: 1.5;
      }
      .lio-map-fechar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        color: var(--ink-soft);
        font-size: 14px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        flex-shrink: 0;
      }
      .lio-map-fechar:hover {
        background: #2a5a8c;
        color: white;
        border-color: #2a5a8c;
      }

      .lio-map-busca-wrap {
        flex-shrink: 0;
        position: relative;
        padding: 14px 20px 8px;
      }
      .lio-map-busca-ico {
        position: absolute;
        left: 32px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 13px;
        pointer-events: none;
        color: var(--ink-faint);
      }
      .lio-map-busca-input {
        width: 100%;
        padding: 9px 38px 9px 36px;
        font-size: 13px;
        font-family: inherit;
        background: white;
        border: 1px solid var(--border);
        border-radius: 8px;
        color: var(--ink);
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
        box-sizing: border-box;
      }
      .lio-map-busca-input:focus {
        outline: none;
        border-color: #2a5a8c;
        box-shadow: 0 0 0 3px rgba(42, 90, 140, 0.15);
      }
      .lio-map-busca-clear {
        position: absolute;
        right: 28px;
        top: 50%;
        transform: translateY(-50%);
        background: transparent;
        border: none;
        font-size: 11px;
        color: var(--ink-faint);
        cursor: pointer;
        width: 22px; height: 22px;
        border-radius: 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .lio-map-busca-clear:hover {
        background: var(--bg-sunken);
        color: var(--ink);
      }

      .lio-map-body {
        flex: 1;
        overflow-y: auto;
        padding: 8px 20px 12px;
      }
      .lio-map-flagado {
        margin-bottom: 18px;
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: hidden;
      }
      .lio-map-flagado:last-child { margin-bottom: 0; }
      .lio-map-flagado-head {
        background: var(--bg-sunken);
        padding: 10px 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        border-bottom: 1px solid var(--border);
      }
      .lio-map-flagado-tag {
        background: rgba(42, 90, 140, 0.15);
        color: #2a5a8c;
        border: 1px solid rgba(42, 90, 140, 0.35);
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      .lio-map-flagado-stat {
        font-size: 11px;
        color: var(--ink-faint);
        font-style: italic;
      }
      .lio-map-candidatos {
        max-height: 280px;
        overflow-y: auto;
        background: white;
      }
      .lio-map-cand {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 9px 14px;
        cursor: pointer;
        border-bottom: 1px solid rgba(0, 0, 0, 0.04);
        transition: background 120ms;
      }
      .lio-map-cand:last-child { border-bottom: none; }
      .lio-map-cand:hover {
        background: rgba(42, 90, 140, 0.05);
      }
      .lio-map-cand-marcado {
        background: rgba(42, 90, 140, 0.06);
      }
      .lio-map-cand-check {
        width: 16px;
        height: 16px;
        accent-color: #2a5a8c;
        flex-shrink: 0;
      }
      .lio-map-cand-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
      }
      .lio-map-cand-info strong {
        font-size: 13px;
        color: var(--ink);
        font-weight: 600;
      }
      .lio-map-cand-info small {
        font-size: 11px;
        color: var(--ink-faint);
      }
      .lio-map-vazio {
        padding: 18px;
        text-align: center;
        color: var(--ink-faint);
        font-size: 12px;
        font-style: italic;
      }

      .lio-map-footer {
        flex-shrink: 0;
        padding: 12px 20px;
        border-top: 1px solid var(--border);
        background: var(--bg-elevated);
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .lio-map-footer-help {
        font-size: 11px;
        color: var(--ink-faint);
        font-style: italic;
      }
      .lio-map-footer-fechar {
        background: #2a5a8c;
        color: white;
        border: none;
        padding: 9px 22px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background-color 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms, opacity 150ms;
      }
      .lio-map-footer-fechar:hover {
        background: #2BA8A8;
        transform: translateY(-1px);
        box-shadow: 0 3px 10px rgba(42, 90, 140, 0.30);
      }
    `;
  }

  // ───────────────────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────
  // EXPORTAÇÃO PRA EXCEL — Total / Mês / Médico / Com regra / Sem regra
  // ───────────────────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────
  // REDIMENSIONAMENTO DE COLUNAS — alça arrastável + persistência localStorage
  // ───────────────────────────────────────────────────────────────────────
  const LIO_COLS_KEY = 'lio_larguras_colunas_v1';

  function lerLargurasSalvas() {
    try {
      const raw = localStorage.getItem(LIO_COLS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function salvarLargurasColunas(larguras) {
    try {
      localStorage.setItem(LIO_COLS_KEY, JSON.stringify(larguras));
    } catch (_) { /* localStorage cheio? ignora */ }
  }

  // V721: a matriz da aba ADICIONAL também é redimensionável — mesmo
  // mecanismo das matrizes Conv/Part, com chave própria no localStorage.
  function setupResizeColunasAdicional() {
    _setupResizeEm(document.querySelector('.lio-adic-tabela'), LIO_COLS_KEY + '_adic');
  }

  function _setupResizeEm(tabela, chave) {
    if (!tabela) return;
    const ler = () => {
      try { return JSON.parse(localStorage.getItem(chave) || '{}'); } catch (_) { return {}; }
    };
    const salvar = (l) => { try { localStorage.setItem(chave, JSON.stringify(l)); } catch (_) {} };
    const larguras = ler();
    Object.keys(larguras).forEach(idx => {
      const th = tabela.querySelector(`thead th[data-col="${idx}"]`);
      if (th && larguras[idx] >= 40) th.style.width = larguras[idx] + 'px';
    });
    tabela.querySelectorAll('.lio-col-resize').forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const idx = handle.dataset.resizeCol;
        const th = handle.parentElement;
        const startX = e.pageX;
        const startWidth = th.offsetWidth;
        document.body.classList.add('lio-redimensionando');
        handle.classList.add('lio-col-resize-ativa');
        const onMove = (ev) => { th.style.width = Math.max(40, startWidth + (ev.pageX - startX)) + 'px'; };
        const onUp = () => {
          document.body.classList.remove('lio-redimensionando');
          handle.classList.remove('lio-col-resize-ativa');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          const l = ler(); l[idx] = th.offsetWidth; salvar(l);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  function setupResizeColunas() {
    const tabela = document.querySelector('.lio-tabela');
    if (!tabela) return;

    // 1) Aplica larguras salvas (se houver) aos <th>
    const larguras = lerLargurasSalvas();
    Object.keys(larguras).forEach(idx => {
      const th = tabela.querySelector(`thead th[data-col="${idx}"]`);
      if (th && larguras[idx] >= 40) {
        th.style.width = larguras[idx] + 'px';
      }
    });

    // 2) Bind dos handles de arraste
    const handles = tabela.querySelectorAll('.lio-col-resize');
    handles.forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const idx = handle.dataset.resizeCol;
        const th = handle.parentElement;
        const startX = e.pageX;
        const startWidth = th.offsetWidth;

        document.body.classList.add('lio-redimensionando');
        handle.classList.add('lio-col-resize-ativa');

        const onMove = (ev) => {
          const delta = ev.pageX - startX;
          const novaLargura = Math.max(40, startWidth + delta);
          th.style.width = novaLargura + 'px';
        };

        const onUp = () => {
          document.body.classList.remove('lio-redimensionando');
          handle.classList.remove('lio-col-resize-ativa');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);

          // Salva a largura final no localStorage
          const larguras = lerLargurasSalvas();
          larguras[idx] = th.offsetWidth;
          salvarLargurasColunas(larguras);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // EXPORTAÇÃO PRA EXCEL — Total / Mês / Médico / Com regra / Sem regra
  // ───────────────────────────────────────────────────────────────────────
  function mostrarMenuExportarLio(btn, cfg) {
    document.querySelectorAll('.lio-menu-exp').forEach(el => el.remove());

    const mesLabel = state.mes && state.ano
      ? `${MESES_EXTENSO[parseInt(state.mes, 10) - 1] || state.mes} / ${state.ano}`
      : 'Selecione mês/ano no header';
    const medLabel = state.filtros.medico
      ? `"${state.filtros.medico}"`
      : 'Selecione médico no header';

    const menu = document.createElement('div');
    menu.className = 'lio-menu-exp';
    menu.innerHTML = `
      <div class="lio-menu-exp-titulo">Exportar Excel</div>
      <button class="lio-menu-item" data-modo="total">
        <span class="lio-menu-item-ico">⊞</span>
        <div>
          <strong>Todos (Conv + Part + Adicional)</strong>
          <small>As três fontes, com aba Resumo somando tudo</small>
        </div>
      </button>
      <button class="lio-menu-item lio-menu-item-conv" data-modo="convenio">
        <span class="lio-menu-item-ico">●</span>
        <div>
          <strong>Apenas Convênio</strong>
          <small>Só linhas com Tipo Recebimento = Convênio</small>
        </div>
      </button>
      <button class="lio-menu-item lio-menu-item-part" data-modo="particular">
        <span class="lio-menu-item-ico">●</span>
        <div>
          <strong>Apenas Particular</strong>
          <small>Só linhas com Tipo Recebimento = Particular</small>
        </div>
      </button>
      <button class="lio-menu-item lio-menu-item-adic" data-modo="adicional"><!-- V708 -->
        <span class="lio-menu-item-ico">✦</span>
        <div>
          <strong>Apenas ADICIONAL</strong>
          <small>Padrões × produzido acima da tabela (${'%'} da diferença)</small>
        </div>
      </button>
      <div class="lio-menu-sep"></div>
      <button class="lio-menu-item ${(!state.mes || !state.ano) ? 'lio-menu-item-aviso' : ''}" data-modo="mes">
        <span class="lio-menu-item-ico">⌖</span>
        <div>
          <strong>Por Mês</strong>
          <small>${mesLabel}</small>
        </div>
      </button>
      <button class="lio-menu-item ${!state.filtros.medico ? 'lio-menu-item-aviso' : ''}" data-modo="medico">
        <span class="lio-menu-item-ico">⚕</span>
        <div>
          <strong>Por Médico</strong>
          <small>${medLabel}</small>
        </div>
      </button>
      <div class="lio-menu-sep"></div>
      <button class="lio-menu-item lio-menu-item-verde" data-modo="com_regra">
        <span class="lio-menu-item-ico">✓</span>
        <div>
          <strong>Com regra aplicada</strong>
          <small>O que vai pro relatório final</small>
        </div>
      </button>
      <button class="lio-menu-item lio-menu-item-vermelho" data-modo="sem_regra">
        <span class="lio-menu-item-ico">✕</span>
        <div>
          <strong>Sem regra aplicada</strong>
          <small>Produtos desmarcados (excluídos)</small>
        </div>
      </button>
    `;
    document.body.appendChild(menu);

    // V649: quando o botão original está OCULTO (absorvido pelo leque de
    // ações #atlas-hub), o rect vem zerado e o menu abria FORA da tela —
    // clique "sem nenhuma ação". Âncora: botão visível → ele; senão o leque;
    // senão canto superior direito. E sempre clampa pra dentro da viewport.
    let r = btn.getBoundingClientRect();
    if (!r.width && !r.height) {
      const hub = document.querySelector('#atlas-hub .hub-btn');
      if (hub) r = hub.getBoundingClientRect();
    }
    let topo = (r.bottom || 70) + window.scrollY + 6;
    let esq  = (r.right || window.innerWidth - 20) - menu.offsetWidth + window.scrollX;
    esq  = Math.max(8, Math.min(esq, window.innerWidth - menu.offsetWidth - 8));
    topo = Math.max(8, Math.min(topo, window.scrollY + window.innerHeight - menu.offsetHeight - 8));
    menu.style.top = `${topo}px`;
    menu.style.left = `${esq}px`;

    const fechar = (ev) => {
      if (ev && menu.contains(ev.target)) return;
      menu.remove();
      document.removeEventListener('click', fechar);
    };
    setTimeout(() => document.addEventListener('click', fechar), 0);

    menu.querySelectorAll('.lio-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const modo = item.dataset.modo;
        menu.remove();
        document.removeEventListener('click', fechar);
        exportarLioExcel(modo, cfg);
      });
    });
  }

  function exportarLioExcel(modo, cfg) {
    try {
      if (window.Utilidades && Utilidades.mostrarLoading) Utilidades.mostrarLoading('Gerando Excel...');

      // Carrega TUDO (sem filtros do header) e depois aplica o filtro do modo
      let linhas = [...carregarLinhasLio('CONVENIO'), ...carregarLinhasLio('PARTICULAR')];
      let titulo = 'LIO_Export';

      if (modo === 'total') {
        titulo = 'LIO_Todos_Conv_Part_Adicional';
      } else if (modo === 'adicional') {
        titulo = 'LIO_Apenas_Adicional';
      } else if (modo === 'convenio') {
        linhas = linhas.filter(l => String(l.tipo_recebimento || '').toUpperCase().startsWith('CONV'));
        titulo = 'LIO_Apenas_Convenio';
      } else if (modo === 'particular') {
        linhas = linhas.filter(l => String(l.tipo_recebimento || '').toUpperCase() === 'PARTICULAR');
        titulo = 'LIO_Apenas_Particular';
      } else if (modo === 'mes') {
        if (!state.mes || !state.ano) {
          if (window.Utilidades && Utilidades.esconderLoading) Utilidades.esconderLoading();
          alert('Selecione um mês E um ano no header antes de usar essa exportação.');
          return;
        }
        const compFiltro = `${state.ano}-${state.mes}`;
        linhas = linhas.filter(l => String(l.competencia || '').startsWith(compFiltro));
        titulo = `LIO_${state.ano}-${state.mes}`;
      } else if (modo === 'medico') {
        const med = (state.filtros.medico || '').trim();
        if (!med) {
          if (window.Utilidades && Utilidades.esconderLoading) Utilidades.esconderLoading();
          alert('Filtre por um médico no header antes de usar essa exportação.');
          return;
        }
        const t = med.toLowerCase();
        // V648: o filtro do header agora guarda o NOME COMPLETO do de/para
        // (V646) — o export precisa casar tanto pela grafia crua da Produção
        // quanto pelo nome resolvido, senão "Por Médico" não acha nada.
        linhas = linhas.filter(l => {
          const ind = String(l.indicante || '').toLowerCase();
          const exe = String(l.cirurgiao || '').toLowerCase();
          if (ind.includes(t) || exe.includes(t)) return true;
          const indDP = String(nomeCompletoMedicoLio(l.indicante) || '').toLowerCase();
          const exeDP = String(nomeCompletoMedicoLio(l.cirurgiao) || '').toLowerCase();
          return indDP.includes(t) || exeDP.includes(t);
        });
        titulo = `LIO_Medico_${med.replace(/[^A-Za-z0-9]/g, '_').slice(0, 30)}`;
      } else if (modo === 'com_regra') {
        linhas = linhas.filter(l => temRegraAplicada(l, cfg));
        titulo = 'LIO_ComRegraAplicada';
      } else if (modo === 'sem_regra') {
        linhas = linhas.filter(l => !temRegraAplicada(l, cfg));
        titulo = 'LIO_SemRegraAplicada';
      }

      // V708: linhas do ADICIONAL (padrões × produzido acima da tabela) —
      // mesmas contas da aba, sobre TODAS as particulares (sem filtro do header)
      const itensAdic = (modo === 'total' || modo === 'adicional')
        ? montarAdicionalTela(carregarLinhasLio('PARTICULAR'))
        : [];

      if (linhas.length === 0 && modo !== 'adicional') {
        if (window.Utilidades && Utilidades.esconderLoading) Utilidades.esconderLoading();
        alert('Nenhuma linha pra exportar com esse filtro.');
        return;
      }
      if (modo === 'adicional' && itensAdic.length === 0) {
        if (window.Utilidades && Utilidades.esconderLoading) Utilidades.esconderLoading();
        alert('Nenhuma linha de ADICIONAL — cadastre padrões em ⚙ Ajustes → Adicional.');
        return;
      }

      const cabecalho = [
        'Data', 'Admissão', 'Cód. Paciente', 'Paciente', 'Tipo Produto', 'Produto',
        'Convênio', 'Plano', 'Indicante', 'Executante', 'Tipo Recebimento',
        'Valor Produzido', 'Regra Aplicada',
        '% Executante', 'Repasse Executante',
        '% Indicante', 'Repasse Indicante',
        'Repasse Total'
      ];
      // V649: a extração sai num ÚNICO Excel com DUAS ABAS — Convênio e
      // Particular (cada uma com o próprio total). Modos que filtram uma
      // fonte só geram a aba daquela fonte.
      const montarAba = (subset) => {
        const dados = [cabecalho];
        for (const l of subset) {
          const c = calcularRepasse(l, cfg);
          dados.push([
            l.data_admissao || '',
            l.admissao || '',
            l.cod_paciente || '',
            l.paciente || '',
            l.tipo_produto || '',
            l.produto || '',
            l.convenio || '',
            l.plano || '',
            // V648: colunas de médico saem com o nome COMPLETO do de/para
            nomeCompletoMedicoLio(l.indicante) || l.indicante || '',
            nomeCompletoMedicoLio(l.cirurgiao) || l.cirurgiao || '',
            Utilidades.rotuloFonte(l.tipo_recebimento),   // V947
            Number(l.valor) || 0,
            c.semRegra ? 'NÃO' : 'SIM',
            c.semRegra ? '' : Number(c.pctExec) || 0,
            c.repExec || 0,
            c.semRegra || !c.indDiferente ? '' : Number(c.pctInd) || 0,
            c.repInd || 0,
            c.repTotal || 0,
          ]);
        }
        dados.push([]);
        const tValor = subset.reduce((s, l) => s + (Number(l.valor) || 0), 0);
        const tRepExec = subset.reduce((s, l) => s + calcularRepasse(l, cfg).repExec, 0);
        const tRepInd = subset.reduce((s, l) => s + calcularRepasse(l, cfg).repInd, 0);
        dados.push(['', '', '', '', '', '', '', '', '', '', 'TOTAL:', tValor, '', '', tRepExec, '', tRepInd, tRepExec + tRepInd]);
        const ws = XLSX.utils.aoa_to_sheet(dados);
        ws['!cols'] = [
          { wch: 11 },{ wch: 11 },{ wch: 11 },{ wch: 30 },{ wch: 28 },{ wch: 45 },
          { wch: 22 },{ wch: 14 },{ wch: 28 },{ wch: 28 },{ wch: 14 },
          { wch: 15 },{ wch: 13 },{ wch: 12 },{ wch: 16 },{ wch: 12 },{ wch: 16 },{ wch: 16 },
        ];
        // V708: REGRA de exportação — dinheiro "R$ …" (Contábil) e % "2,5%"
        Utilidades.aplicarFormatosExport(ws, { moeda: [11, 14, 16, 17], pct: [13, 15] }, 1);
        return ws;
      };

      // V708: aba do ADICIONAL — espelha a matriz da aba (com TODOS os padrões)
      const montarAbaAdicional = (itens) => {
        const pctAd = App.repasseLIO.lerPctAdicional();
        const dados = [[
          'Admissão', 'Data', 'Paciente', 'Executante', 'Produto', 'Padrões (cadastro)',
          'Elegível (Catarata)', 'Produzido', 'V. Tabela', 'Diferença', '% Adicional', 'Repasse Adicional'
        ]];
        for (const { l, calc, elegivel } of itens) {
          dados.push([
            l.admissao || '', String(l.data_admissao || '').slice(0, 10), l.paciente || '',
            nomeCompletoMedicoLio(l.cirurgiao || l.medico) || l.cirurgiao || l.medico || '',
            l.produto || '',
            (calc.lentes || [calc.lente]).map(x => x.nome).join(' · '),
            elegivel ? 'SIM' : 'NÃO',
            calc.cobrado || 0, calc.valorTabela || 0, calc.diferenca || 0,
            Number(calc.pct) || pctAd,
            (elegivel && calc.repasse > 0) ? calc.repasse : 0,
          ]);
        }
        dados.push([]);
        const pagaveis = itens.filter(i => i.elegivel && i.calc.repasse > 0);
        dados.push(['', '', '', '', '', '', 'TOTAL:',
          itens.reduce((s, i) => s + (i.calc.cobrado || 0), 0), '',
          pagaveis.reduce((s, i) => s + i.calc.diferenca, 0), '',
          pagaveis.reduce((s, i) => s + i.calc.repasse, 0)]);
        const ws = XLSX.utils.aoa_to_sheet(dados);
        ws['!cols'] = [
          { wch: 11 },{ wch: 11 },{ wch: 30 },{ wch: 28 },{ wch: 45 },{ wch: 30 },
          { wch: 16 },{ wch: 14 },{ wch: 14 },{ wch: 14 },{ wch: 11 },{ wch: 16 },
        ];
        Utilidades.aplicarFormatosExport(ws, { moeda: [7, 8, 9, 11], pct: [10] }, 1);
        return ws;
      };

      const ehConv = (l) => String(l.tipo_recebimento || '').toUpperCase().startsWith('CONV');
      const wb = XLSX.utils.book_new();
      if (modo === 'convenio') {
        XLSX.utils.book_append_sheet(wb, montarAba(linhas), 'Convênio');
      } else if (modo === 'particular') {
        XLSX.utils.book_append_sheet(wb, montarAba(linhas), 'Particular');
      } else if (modo === 'adicional') {
        XLSX.utils.book_append_sheet(wb, montarAbaAdicional(itensAdic), 'Adicional');
      } else if (modo === 'total') {
        // V708: "Todos" = CONV + PART + ADICIONAL, com Resumo somando as três
        const lConv = linhas.filter(ehConv), lPart = linhas.filter(l => !ehConv(l));
        const repDe = (ls) => ls.reduce((s, l) => s + calcularRepasse(l, cfg).repTotal, 0);
        const repC = repDe(lConv), repP = repDe(lPart);
        const repA = itensAdic.filter(i => i.elegivel && i.calc.repasse > 0).reduce((s, i) => s + i.calc.repasse, 0);
        const wsResumo = XLSX.utils.aoa_to_sheet([
          ['RESUMO DO REPASSE LIO'], [],
          ['Fonte', 'Linhas', 'Repasse'],
          ['Convênio', lConv.length, repC],
          ['Particular', lPart.length, repP],
          ['Adicional', itensAdic.length, repA],
          [],
          ['TOTAL GERAL', '', repC + repP + repA],
        ]);
        wsResumo['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 18 }];
        Utilidades.aplicarFormatosExport(wsResumo, { moeda: [2] }, 2);
        XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');
        XLSX.utils.book_append_sheet(wb, montarAba(lConv), 'Convênio');
        XLSX.utils.book_append_sheet(wb, montarAba(lPart), 'Particular');
        XLSX.utils.book_append_sheet(wb, montarAbaAdicional(itensAdic), 'Adicional');
      } else {
        XLSX.utils.book_append_sheet(wb, montarAba(linhas.filter(ehConv)), 'Convênio');
        XLSX.utils.book_append_sheet(wb, montarAba(linhas.filter(l => !ehConv(l))), 'Particular');
      }

      const data = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      XLSX.writeFile(wb, `${titulo}_${data}.xlsx`);

      if (window.Utilidades && Utilidades.toast) {
        const nExp = modo === 'adicional' ? itensAdic.length
                   : modo === 'total' ? linhas.length + itensAdic.length : linhas.length;
        Utilidades.toast(`✓ Excel gerado: ${nExp} linha${nExp === 1 ? '' : 's'}`, 'success', 2500);
      }
    } catch (e) {
      console.error('Erro ao exportar LIO:', e);
      alert('Erro ao gerar Excel: ' + (e.message || e));
    } finally {
      if (window.Utilidades && Utilidades.esconderLoading) Utilidades.esconderLoading();
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // BOOTSTRAP
  // ───────────────────────────────────────────────────────────────────────
  // V646: o módulo abre SEMPRE no mês de repasse mais RECENTE disponível —
  // independentemente do último mês acessado. Mês novo importado vira o
  // padrão na próxima abertura automaticamente.
  try {
    const r = Banco.queryUnica(`
      SELECT MAX(c) AS ult FROM (
        SELECT MAX(competencia) AS c FROM linhas_producao
         WHERE classificacao_produto = 'OPME'
           AND (
             UPPER(COALESCE(tipo_produto,'')) LIKE '%LIO%'
             OR UPPER(COALESCE(tipo_produto,'')) = 'LENTE INTRA OCULAR'
             OR UPPER(COALESCE(tipo_produto,'')) = 'SERVICO DE LIO'
           )
        UNION ALL
        SELECT MAX(mes_pagamento) AS c FROM linhas_qvis
         WHERE UPPER(COALESCE(procedimento,'')) LIKE '%LIO%'
      )`);
    const ult = String((r && r.ult) || '');
    if (/^\d{4}-\d{2}/.test(ult)) {
      state.ano = ult.substring(0, 4);
      state.mes = ult.substring(5, 7);
    } else if (!state.mes && !state.ano) {
      const { meses, anos } = listarCompetenciasDisponiveis();
      if (anos.length > 0)  state.ano = anos[0];
      if (meses.length > 0) state.mes = meses[meses.length - 1];
    }
  } catch (_) {}

  renderizar();
};
