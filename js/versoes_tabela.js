/**
 * VERSÕES DA BASE TABELA (V563)
 * ============================================================================
 * A tabela de repasse passa a ter versões numeradas (1.0, 2.0, ...), cada uma
 * com DATA DE VIGÊNCIA = dia em que foi publicada. Regra de pagamento:
 *   • admissão ANTERIOR ao dia da publicação → versão vigente naquela data;
 *   • admissão NO DIA da publicação ou depois → versão nova (o dia conta).
 *
 * Modelo (decisões do usuário, V563):
 *   • Publicação MANUAL — botão "Publicar versão" na Base Tabela. As edições
 *     na tabela viva são RASCUNHO e não valem para o cálculo até publicar.
 *   • Congela TUDO que compõe a tabela: valores/percentuais das 3 fontes por
 *     papel, flag USAR (repassavel), nomenclatura e classificação.
 *   • Cada publicação entra automaticamente na LINHA DO TEMPO (Visão Geral).
 *
 * Compatibilidade: enquanto NENHUMA versão foi publicada, o motor usa a
 * tabela viva (comportamento original) — nada muda para bases novas/vazias.
 * Migração one-shot: base já populada e sem versão → Versão 1.0 automática
 * (snapshot fiel do estado atual; resultados idênticos aos de antes).
 *
 * Performance: publicar é 2 INSERT..SELECT (milissegundos, só no clique);
 * o motor carrega as regras de cada versão UMA vez por cálculo (mapa em
 * memória, lazy — só das versões que aparecem no período) e resolve a
 * versão de cada linha com busca em lista ordenada (custo desprezível).
 */
(function () {
  'use strict';

  let _ddlOk = false;

  function _hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function _fmtBR(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '');
  }

  // colunas de classificação podem ainda não existir (migração V554 roda na
  // tela Base Tabela) — garante antes do INSERT..SELECT do snapshot
  function _garantirColunasProc() {
    const cols = window.Banco.query(`PRAGMA table_info(procedimentos)`) || [];
    const tem = new Set(cols.map(c => c.name));
    const add = (nome, tipo) => { if (!tem.has(nome)) window.Banco.executar(`ALTER TABLE procedimentos ADD COLUMN ${nome} ${tipo}`); };
    add('prod_categoria', 'TEXT');
    add('prod_subcategoria', 'TEXT');
    add('prod_subespecialidade', 'TEXT');
    add('prod_class_origem', 'TEXT');
    add('prod_class_buscado', 'INTEGER DEFAULT 0');
  }

  function garantir() {
    if (_ddlOk) return true;
    if (!window.Banco || !window.Banco.db) return false;
    try {
      // db.exec (não Banco.executar) — múltiplas instruções num só bloco
      window.Banco.db.exec(`
        CREATE TABLE IF NOT EXISTS tabela_versoes (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          numero        TEXT NOT NULL,
          data_vigencia TEXT NOT NULL,
          criado_em     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS tabela_repasse_hist (
          versao_id       INTEGER NOT NULL,
          procedimento_id INTEGER NOT NULL,
          papel_id        INTEGER NOT NULL,
          fonte_pagadora  TEXT NOT NULL,
          valor           REAL,
          percentual      REAL,
          ativo           INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_trh_versao ON tabela_repasse_hist(versao_id, procedimento_id, papel_id);
        CREATE TABLE IF NOT EXISTS procedimentos_hist (
          versao_id             INTEGER NOT NULL,
          procedimento_id       INTEGER NOT NULL,
          nome_oficial          TEXT,
          nome_normalizado      TEXT,
          nomenclatura          TEXT,
          repassavel            INTEGER,
          prod_categoria        TEXT,
          prod_subcategoria     TEXT,
          prod_subespecialidade TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ph_versao ON procedimentos_hist(versao_id, procedimento_id);
      `);
      _ddlOk = true;
      // V565: SEM publicação automática — a Versão 1.0 é publicada pelo
      // usuário ("a ferramenta deve deixar eu publicar a primeira versão").
      // Migração modelo '2': desfaz a 1.0 automática que o modelo '1' (V563)
      // criou sozinho, se ela for a única versão (nenhuma publicação manual).
      try {
        const flag = window.Banco.queryUnica(`SELECT valor FROM config_sistema WHERE chave = 'TABELA_VERSOES_MODELO'`);
        const val = flag ? flag.valor : null;
        if (val !== '2') {
          if (val === '1') {
            const vs = window.Banco.query(`SELECT id, numero FROM tabela_versoes ORDER BY id`) || [];
            if (vs.length === 1 && vs[0].numero === '1.0') {
              window.Banco.executar(`DELETE FROM tabela_repasse_hist WHERE versao_id = ?`, [vs[0].id]);
              window.Banco.executar(`DELETE FROM procedimentos_hist WHERE versao_id = ?`, [vs[0].id]);
              window.Banco.executar(`DELETE FROM tabela_versoes WHERE id = ?`, [vs[0].id]);
              try { window.Banco.executar(`DELETE FROM timeline_eventos WHERE titulo = 'Base Tabela — Versão 1.0'`); } catch (_) {}
            }
          }
          window.Banco.executar(`INSERT OR REPLACE INTO config_sistema (chave, valor) VALUES ('TABELA_VERSOES_MODELO', '2')`);
          window.Banco.salvarDebounced && window.Banco.salvarDebounced();
        }
      } catch (e) { console.warn('[versoes-tabela] migração modelo 2:', e); }
      return true;
    } catch (e) { console.error('[versoes-tabela] DDL:', e); return false; }
  }

  function listar() {
    if (!garantir()) return [];
    try {
      return window.Banco.query(
        `SELECT id, numero, data_vigencia, criado_em FROM tabela_versoes ORDER BY data_vigencia, id`) || [];
    } catch (e) { return []; }
  }

  /** Versão vigente para uma data 'YYYY-MM-DD' (dia da publicação já conta
   *  para a versão nova). Antes da 1ª vigência → 1ª versão. Sem data → última.
   *  Sem versão publicada → null (o motor usa a tabela viva). */
  function resolver(dataISO, versoes) {
    const vs = versoes || listar();
    if (!vs.length) return null;
    const d = String(dataISO || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return vs[vs.length - 1];
    // V639: antes de TODAS as vigências → versão de MENOR NÚMERO (1.0, a
    // padrão) — mesma regra do motor (V636), não a de vigência mais antiga.
    let v = null;
    for (const c of vs) { if (c.data_vigencia <= d) v = c; else break; }
    if (!v) v = vs.reduce((a, b) =>
      (Number(String(b.numero).replace(',', '.')) || 0) < (Number(String(a.numero).replace(',', '.')) || 0) ? b : a, vs[0]);
    return v;
  }

  // ── V565: RASCUNHO (ciclo Criar nova versão → editar → Publicar) ─────────
  // Sem nenhuma versão publicada, a tabela é livre (está-se montando a base
  // da 1.0). Depois da 1ª publicação, a tabela fica travada até "Criar nova
  // versão" — que abre o rascunho da próxima (a tabela viva já É a cópia
  // fiel da versão publicada, pronta para alterar). Publicar fecha o ciclo.
  function temRascunho() {
    if (!garantir()) return true;
    try {
      const temVersao = window.Banco.queryUnica(`SELECT 1 AS um FROM tabela_versoes LIMIT 1`);
      if (!temVersao || !temVersao.um) return true;   // fase base da 1.0 — livre
      const f = window.Banco.queryUnica(`SELECT valor FROM config_sistema WHERE chave = 'BT_VERSAO_RASCUNHO'`);
      return !!(f && f.valor === '1');
    } catch (_) { return true; }
  }
  function criarRascunho() {
    garantir();
    window.Banco.executar(`INSERT OR REPLACE INTO config_sistema (chave, valor) VALUES ('BT_VERSAO_RASCUNHO', '1')`);
  }

  /** V568: próximo número — MAX+1 (não conta linhas: sobrevive a exclusões). */
  function proximoNumero() {
    if (!garantir()) return '1.0';
    try {
      const r = window.Banco.queryUnica(`SELECT MAX(CAST(numero AS REAL)) AS m FROM tabela_versoes`);
      return `${Math.floor(Number((r && r.m) || 0)) + 1}.0`;
    } catch (_) { return '1.0'; }
  }

  /** V568: restaura a tabela viva a partir do snapshot de uma versão —
   *  valores/regra por inteiro; nos procedimentos, os campos versionados
   *  (USAR, nomenclatura, classificação) voltam ao que a versão guardou;
   *  procedimentos criados depois da versão permanecem no cadastro (mas
   *  sem regra, como manda o snapshot). */
  function _restaurarVersaoNaViva(vid) {
    const B = window.Banco;
    _garantirColunasProc();
    B.executar(`DELETE FROM tabela_repasse`);
    B.executar(
      `INSERT INTO tabela_repasse (procedimento_id, papel_id, fonte_pagadora, valor, percentual, ativo)
        SELECT procedimento_id, papel_id, fonte_pagadora, valor, percentual, ativo
          FROM tabela_repasse_hist WHERE versao_id = ?`, [vid]);
    const col = (c) => `CASE WHEN EXISTS (SELECT 1 FROM procedimentos_hist ph WHERE ph.versao_id = ${Number(vid)} AND ph.procedimento_id = procedimentos.id)
      THEN (SELECT ph.${c} FROM procedimentos_hist ph WHERE ph.versao_id = ${Number(vid)} AND ph.procedimento_id = procedimentos.id)
      ELSE ${c} END`;
    B.executar(`UPDATE procedimentos SET
        repassavel            = ${col('repassavel')},
        nomenclatura          = ${col('nomenclatura')},
        prod_categoria        = ${col('prod_categoria')},
        prod_subcategoria     = ${col('prod_subcategoria')},
        prod_subespecialidade = ${col('prod_subespecialidade')}`);
  }

  /** V568: descarta o rascunho — desfaz as alterações não publicadas,
   *  restaurando a cópia exata da última versão publicada. */
  async function descartarRascunho() {
    if (!garantir()) throw new Error('banco indisponível');
    const vs = listar();
    if (!vs.length) throw new Error('não há versão publicada para restaurar');
    const ult = vs[vs.length - 1];
    _restaurarVersaoNaViva(ult.id);
    window.Banco.executar(`INSERT OR REPLACE INTO config_sistema (chave, valor) VALUES ('BT_VERSAO_RASCUNHO', '0')`);
    if (window.__atlasInvalidarAux) window.__atlasInvalidarAux();
    await window.Banco.salvar({ imediato: true });
    return ult;
  }

  /** V568: exclui a ÚLTIMA versão publicada (a única que pode sair sem furar
   *  o histórico). A tabela viva volta a espelhar a versão anterior — se não
   *  sobrar nenhuma, a base fica livre de novo (fase da 1.0). Remove também
   *  o evento correspondente da Linha do tempo. */
  async function excluirUltimaVersao() {
    if (!garantir()) throw new Error('banco indisponível');
    const vs = listar();
    if (!vs.length) throw new Error('não há versão publicada');
    const B = window.Banco;
    const ult = vs[vs.length - 1];
    const anterior = vs.length > 1 ? vs[vs.length - 2] : null;
    B.executar(`DELETE FROM tabela_repasse_hist WHERE versao_id = ?`, [ult.id]);
    B.executar(`DELETE FROM procedimentos_hist WHERE versao_id = ?`, [ult.id]);
    B.executar(`DELETE FROM tabela_versoes WHERE id = ?`, [ult.id]);
    try { B.executar(`DELETE FROM timeline_eventos WHERE titulo = ?`, [`Base Tabela — Versão ${ult.numero}`]); } catch (_) {}
    if (anterior) _restaurarVersaoNaViva(anterior.id);
    B.executar(`INSERT OR REPLACE INTO config_sistema (chave, valor) VALUES ('BT_VERSAO_RASCUNHO', '0')`);
    if (window.__atlasInvalidarAux) window.__atlasInvalidarAux();
    await B.salvar();
    return { excluida: ult, vigente: anterior };
  }

  /** V572: AJUSTE FINO na versão publicada — sem rascunho aberto, uma edição
   *  pontual na grade (célula, USAR, nomenclatura, classificação, excluir/novo
   *  procedimento) atualiza também o snapshot da ÚLTIMA versão, para o motor
   *  e a tabela viva continuarem espelhados. Com rascunho aberto não faz nada
   *  (o snapshot só muda no publicar). */
  function sincronizarProcNaUltimaVersao(procId) {
    if (!garantir() || procId == null) return false;
    const vs = listar();
    if (!vs.length) return false;
    try {
      const f = window.Banco.queryUnica(`SELECT valor FROM config_sistema WHERE chave = 'BT_VERSAO_RASCUNHO'`);
      if (f && f.valor === '1') return false;   // rascunho aberto → snapshot intacto
    } catch (_) {}
    const vid = vs[vs.length - 1].id;
    const B = window.Banco;
    _garantirColunasProc();
    B.executar(`DELETE FROM tabela_repasse_hist WHERE versao_id = ? AND procedimento_id = ?`, [vid, procId]);
    B.executar(
      `INSERT INTO tabela_repasse_hist (versao_id, procedimento_id, papel_id, fonte_pagadora, valor, percentual, ativo)
        SELECT ?, procedimento_id, papel_id, fonte_pagadora, valor, percentual, ativo
          FROM tabela_repasse WHERE procedimento_id = ?`, [vid, procId]);
    B.executar(`DELETE FROM procedimentos_hist WHERE versao_id = ? AND procedimento_id = ?`, [vid, procId]);
    B.executar(
      `INSERT INTO procedimentos_hist (versao_id, procedimento_id, nome_oficial, nome_normalizado, nomenclatura,
                                       repassavel, prod_categoria, prod_subcategoria, prod_subespecialidade)
        SELECT ?, id, nome_oficial, nome_normalizado, nomenclatura,
               repassavel, prod_categoria, prod_subcategoria, prod_subespecialidade
          FROM procedimentos WHERE id = ?`, [vid, procId]);
    if (window.__atlasInvalidarAux) window.__atlasInvalidarAux();
    return true;
  }

  /** Publica a versão nova (síncrono; caller decide o salvar).
   *  V587: aceita dataVigencia 'YYYY-MM-DD' — permite AGENDAR a publicação
   *  (vigência futura) ou datar retroativamente; sem data, vale hoje. */
  function publicarSync(dataVigencia) {
    if (!garantir()) throw new Error('banco indisponível');
    _garantirColunasProc();
    const B = window.Banco;
    const numero = proximoNumero();
    const data = /^\d{4}-\d{2}-\d{2}$/.test(String(dataVigencia || '')) ? String(dataVigencia) : _hojeISO();
    B.executar(`INSERT INTO tabela_versoes (numero, data_vigencia) VALUES (?, ?)`, [numero, data]);
    const vid = B.queryUnica(`SELECT last_insert_rowid() AS id`).id;
    B.executar(
      `INSERT INTO tabela_repasse_hist (versao_id, procedimento_id, papel_id, fonte_pagadora, valor, percentual, ativo)
        SELECT ?, procedimento_id, papel_id, fonte_pagadora, valor, percentual, ativo FROM tabela_repasse`, [vid]);
    B.executar(
      `INSERT INTO procedimentos_hist (versao_id, procedimento_id, nome_oficial, nome_normalizado, nomenclatura,
                                       repassavel, prod_categoria, prod_subcategoria, prod_subespecialidade)
        SELECT ?, id, nome_oficial, nome_normalizado, nomenclatura,
               repassavel, prod_categoria, prod_subcategoria, prod_subespecialidade FROM procedimentos`, [vid]);

    // evento automático na LINHA DO TEMPO (mesmas tabelas do linha_tempo.js)
    try {
      B.db.exec(`
        CREATE TABLE IF NOT EXISTS timeline_eventos (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          data        TEXT NOT NULL,
          categoria   TEXT NOT NULL DEFAULT 'regra',
          titulo      TEXT NOT NULL,
          descricao   TEXT,
          impacto     TEXT,
          sinal       TEXT NOT NULL DEFAULT 'neutro',
          responsavel TEXT,
          criado_em   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          editado_em  TEXT
        );
        CREATE TABLE IF NOT EXISTS timeline_docs (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          evento_id INTEGER NOT NULL,
          nome      TEXT NOT NULL,
          tamanho   INTEGER,
          tipo      TEXT,
          conteudo  TEXT,
          criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_tl_docs_ev ON timeline_docs(evento_id);
      `);
      B.executar(
        `INSERT INTO timeline_eventos (data, categoria, titulo, descricao, impacto, sinal)
         VALUES (?, 'regra', ?, ?, ?, 'neutro')`,
        [data, `Base Tabela — Versão ${numero}`,
         `Nova versão da Base Tabela publicada. Admissões a partir de ${_fmtBR(data)} (inclusive) ` +
         `são pagas por esta versão; admissões anteriores permanecem na versão vigente na data da admissão.`,
         'Tabela de repasse']);
    } catch (e) { console.warn('[versoes-tabela] evento linha do tempo:', e); }

    // V565: publicar fecha o rascunho — a tabela volta a ficar travada até
    // o próximo "Criar nova versão"
    B.executar(`INSERT OR REPLACE INTO config_sistema (chave, valor) VALUES ('BT_VERSAO_RASCUNHO', '0')`);

    // invalida os caches de cálculo (aux do motor + consolidados por Banco._versao)
    if (window.__atlasInvalidarAux) window.__atlasInvalidarAux();
    return { id: vid, numero, data_vigencia: data };
  }

  async function publicar(dataVigencia) {
    const v = publicarSync(dataVigencia);
    await window.Banco.salvar({ imediato: true });   // persiste + bumpa Banco._versao (invalida consolidados)
    return v;
  }

  /** V637: altera a DATA DE VIGÊNCIA de uma versão publicada. Recalculos e
   *  painéis passam a resolver as versões pela nova data imediatamente. */
  function alterarVigencia(vid, dataISO) {
    if (!garantir()) throw new Error('banco indisponível');
    const d = String(dataISO || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Data de vigência inválida.');
    const B = window.Banco;
    const v = B.queryUnica(`SELECT id, numero, data_vigencia FROM tabela_versoes WHERE id = ?`, [vid]);
    if (!v) throw new Error('Versão não encontrada.');
    B.executar(`UPDATE tabela_versoes SET data_vigencia = ? WHERE id = ?`, [d, vid]);
    B._versao = (B._versao || 0) + 1;
    try { window.__atlasInvalidarAux && window.__atlasInvalidarAux(); } catch (_) {}
    try { window.AtlasRelatorios && window.AtlasRelatorios.invalidarConsolidado && window.AtlasRelatorios.invalidarConsolidado(); } catch (_) {}
    try { B.salvar && B.salvar(); } catch (_) {}
    return { id: v.id, numero: v.numero, de: v.data_vigencia, para: d };
  }

  window.AtlasVersoesTabela = { garantir, listar, resolver, publicar, publicarSync, temRascunho, criarRascunho,
                                proximoNumero, descartarRascunho, excluirUltimaVersao, sincronizarProcNaUltimaVersao,
                                alterarVigencia };   // V637
})();
