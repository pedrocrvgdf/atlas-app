// ============================================================================
// CÓDIGO DE INDIVIDUALIZAÇÃO DO MÉDICO  (MDATLAS####)
// ----------------------------------------------------------------------------
// Cada médico do cadastro ganha um código único e PERMANENTE no formato
// MDATLAS0001. Regras:
//   • 1ª geração: em ORDEM ALFABÉTICA do nome oficial.
//   • Médico novo: recebe o PRÓXIMO número livre (máx + 1). Os códigos já
//     atribuídos NUNCA mudam nem se repetem.
// O código serve para OCULTAR o nome do médico nas TELAS do ATLAS (compliance,
// pra apresentar sem expor quem recebe). NUNCA é usado para ocultar/sobrepor o
// nome nos relatórios de extração — exports sempre saem com o nome real.
//
// Estado do "ocultar" fica em config_sistema (chave OCULTAR_NOMES_MEDICOS).
// Padrão = mostrar NOMES (false).
// ============================================================================
window.CodigoMedico = (function () {
  const PREFIXO = 'MDATLAS';   // ATLAS v1.0 (MDCBV/MDSAR antigos migram em garantir())
  const LARGURA = 4;
  const CHAVE_OCULTAR = 'OCULTAR_NOMES_MEDICOS';

  let _ocultar = null;   // cache do toggle (null = ainda não lido)
  let _mapa = null;      // cache { nome_oficial -> codigo }
  let _mapaNorm = null;  // cache { nome_normalizado/grafia_normalizada -> codigo }

  function fmt(n) { return PREFIXO + String(n).padStart(LARGURA, '0'); }

  function numDe(cod) {
    if (!cod) return 0;
    const m = String(cod).match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // Garante que TODO médico tenha codigo_atlas. Não toca nos já preenchidos.
  // Retorna true se atribuiu algum código novo.
  function garantir() {
    if (!window.Banco || !Banco.db) return false;
    let mudou = false;
    try {
      // ATLAS v1.0: o prefixo volta a ser MDATLAS. Bancos vindos da ferramenta
      // de origem trazem MDCBV#### (ou MDSAR####, mais antigo): migram UMA vez,
      // preservando o número — o código do médico nunca muda de valor.
      try {
        const cbv = Banco.query(`SELECT COUNT(*) AS n FROM medicos WHERE codigo_atlas LIKE 'MDCBV%'`);
        if (cbv && cbv[0] && cbv[0].n > 0) {
          Banco.executar(`UPDATE medicos SET codigo_atlas = 'MDATLAS' || substr(codigo_atlas, 6) WHERE codigo_atlas LIKE 'MDCBV%'`);
          mudou = true;
        }
      } catch (e) {}
      try {
        const sar = Banco.query(`SELECT COUNT(*) AS n FROM medicos WHERE codigo_atlas LIKE 'MDSAR%'`);
        if (sar && sar[0] && sar[0].n > 0) {
          Banco.executar(`UPDATE medicos SET codigo_atlas = 'MDATLAS' || substr(codigo_atlas, 6) WHERE codigo_atlas LIKE 'MDSAR%'`);
          mudou = true;
        }
      } catch (e) {}

      // maior número já em uso (pra não repetir nunca)
      const usados = Banco.query(
        `SELECT codigo_atlas FROM medicos WHERE codigo_atlas IS NOT NULL AND codigo_atlas <> ''`
      ) || [];
      let prox = usados.reduce((mx, r) => Math.max(mx, numDe(r.codigo_atlas)), 0) + 1;

      // médicos ainda SEM código — em ordem alfabética
      const semCod = Banco.query(
        `SELECT id, nome_oficial FROM medicos
         WHERE codigo_atlas IS NULL OR codigo_atlas = ''
         ORDER BY nome_oficial COLLATE NOCASE ASC`
      ) || [];

      semCod.forEach(m => {
        Banco.executar(`UPDATE medicos SET codigo_atlas = ? WHERE id = ?`, [fmt(prox), m.id]);
        prox++;
        mudou = true;
      });

      if (mudou) { try { Banco.salvar(); } catch (e) {} _mapa = null; _mapaNorm = null; }
    } catch (e) {
      console.warn('[CodigoMedico] garantir:', e);
    }
    return mudou;
  }

  // Mapa { nome_oficial -> codigo } (garante os códigos antes). Cacheado.
  function mapa() {
    if (_mapa) return _mapa;
    construirMapas();
    return _mapa;
  }

  // Constrói os dois mapas: por nome_oficial e por forma NORMALIZADA (nome do
  // cadastro + grafias do De-Para). Assim resolvemos nomes crus do QVIS (cirurgião,
  // indicante, nome_profissional) que não batem 100% com o nome_oficial.
  function construirMapas() {
    garantir();
    _mapa = {};
    _mapaNorm = {};
    try {
      const porId = {};
      (Banco.query(`SELECT id, nome_oficial, nome_normalizado, codigo_atlas FROM medicos`) || []).forEach(m => {
        const cod = m.codigo_atlas || '';
        if (m.nome_oficial) _mapa[m.nome_oficial] = cod;
        if (m.nome_normalizado) _mapaNorm[m.nome_normalizado] = cod;
        porId[m.id] = cod;
      });
      // grafias (De-Para) → código do médico dono
      (Banco.query(`SELECT grafia_normalizada, medico_id FROM sinonimos_medico`) || []).forEach(s => {
        if (s.grafia_normalizada && porId[s.medico_id]) _mapaNorm[s.grafia_normalizada] = porId[s.medico_id];
      });
    } catch (e) { console.warn('[CodigoMedico] construirMapas:', e); }
  }

  function invalidar() { _mapa = null; _mapaNorm = null; }

  // Código de um médico por QUALQUER grafia (exato → normalizado/De-Para). Independe do toggle.
  function codigoDe(nome) {
    if (!nome) return '';
    if (!_mapa) construirMapas();
    if (_mapa[nome]) return _mapa[nome];
    const norm = window.Utilidades && Utilidades.normalizar ? Utilidades.normalizar(nome) : String(nome).toUpperCase().trim();
    return _mapaNorm[norm] || '';
  }

  // Está ocultando os nomes? (lê config_sistema; cacheado)
  function ocultando() {
    if (_ocultar === null) {
      try {
        const r = Banco.queryUnica(`SELECT valor FROM config_sistema WHERE chave = ?`, [CHAVE_OCULTAR]);
        _ocultar = !!(r && (r.valor === 'true' || r.valor === '1'));
      } catch (e) { _ocultar = false; }
    }
    return _ocultar;
  }

  // Liga/desliga o ocultar e persiste.
  function setOcultar(v) {
    _ocultar = !!v;
    try {
      Banco.executar(`CREATE TABLE IF NOT EXISTS config_sistema (chave TEXT PRIMARY KEY, valor TEXT)`);
      Banco.executar(
        `INSERT INTO config_sistema (chave, valor) VALUES (?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
        [CHAVE_OCULTAR, _ocultar ? 'true' : 'false']
      );
      Banco.salvar();
    } catch (e) { console.warn('[CodigoMedico] setOcultar:', e); }
    return _ocultar;
  }

  function alternar() { return setOcultar(!ocultando()); }

  // Texto pra exibir na TELA: código quando ocultando (e houver código), senão o nome.
  // Em EXPORTS nunca chame isto — exports usam sempre o nome real.
  function exibir(nomeOficial) {
    if (!nomeOficial) return nomeOficial || '';
    if (!ocultando()) return nomeOficial;
    const cod = codigoDe(nomeOficial);
    // Oculto: código se houver; senão '—' (não vaza o nome de quem não tem código).
    // Exceção: se o próprio texto já é um placeholder ('—', '?'), devolve como veio.
    if (cod) return cod;
    const t = String(nomeOficial).trim();
    if (t === '—' || t === '-' || t === '?' || t === '') return nomeOficial;
    return '—';
  }

  return { garantir, mapa, invalidar, codigoDe, ocultando, setOcultar, alternar, exibir, fmt, PREFIXO };
})();
