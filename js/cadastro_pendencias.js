/**
 * ============================================================================
 * V814 · PENDÊNCIAS DE CADASTRO
 *
 * Quando as bases importadas trazem informação que ainda não existe nos
 * cadastros — médico novo no QVIS, procedimento novo para a Base Tabela —
 * a ferramenta:
 *   1. acende um ⚠ ao lado da aba CADASTROS (some sozinho ao cadastrar);
 *   2. lista as pendências no aviso da EXTRAÇÃO FINAL do relatório, com a
 *      advertência de risco e um clique que leva ao módulo certo mostrando
 *      só o que falta cadastrar.
 *
 * ANISTIA: as pendências que já existiam quando esta versão rodou pela
 * primeira vez (médicos E procedimentos) são fotografadas em config_sistema
 * e não alertam — só o que aparecer em importação futura dispara.
 *
 * A verificação é sempre sobre o ESTADO ATUAL do banco: cadastrou, resolveu
 * — nada precisa ser marcado. Cache por Banco._versao para não varrer o
 * QVIS a cada navegação.
 * ============================================================================
 */
(function () {
  const K_MED = 'cadpend_baseline_medicos';
  const K_PROC = 'cadpend_baseline_procedimentos';
  let _cache = { versao: null, dados: null };

  const norm = (s) => (window.Utilidades && Utilidades.normalizar)
    ? Utilidades.normalizar(s) : String(s == null ? '' : s).toUpperCase().trim();
  const ehCasa = (nome) => Utilidades.ehProfissionalInstitucional(nome);   // marca institucional configurável (ATLAS v1.0)

  function lerConfig(chave) {
    try {
      const r = Banco.queryUnica(`SELECT valor FROM config_sistema WHERE chave = ?`, [chave]);
      return r ? JSON.parse(r.valor) : null;
    } catch (e) { return null; }
  }
  function gravarConfig(chave, valor) {
    try {
      Banco.executar(`CREATE TABLE IF NOT EXISTS config_sistema (chave TEXT PRIMARY KEY, valor TEXT)`);
      Banco.executar(`INSERT INTO config_sistema (chave, valor) VALUES (?, ?)
        ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`, [chave, JSON.stringify(valor)]);
      Banco.salvar && Banco.salvar();
    } catch (e) { console.warn('[cadpend] config:', e); }
  }

  /** médicos do QVIS sem cadastro (nem sinônimo) — nome de exibição por norm */
  function _medicosSemCadastro() {
    const conhecidos = new Set();
    try {
      for (const m of Banco.query(`SELECT nome_oficial, nome_normalizado FROM medicos`) || []) {
        if (m.nome_oficial) conhecidos.add(norm(m.nome_oficial));
        if (m.nome_normalizado) conhecidos.add(norm(m.nome_normalizado));
      }
      for (const s of Banco.query(`SELECT grafia, grafia_normalizada FROM sinonimos_medico`) || []) {
        if (s.grafia) conhecidos.add(norm(s.grafia));
        if (s.grafia_normalizada) conhecidos.add(norm(s.grafia_normalizada));
      }
    } catch (e) {}
    const out = new Map();
    try {
      for (const r of Banco.query(
        `SELECT DISTINCT nome_profissional AS n FROM linhas_qvis
          WHERE TRIM(COALESCE(nome_profissional,'')) <> ''`) || []) {
        const k = norm(r.n);
        if (!k || conhecidos.has(k) || ehCasa(r.n)) continue;
        if (!out.has(k)) out.set(k, String(r.n).trim());
      }
    } catch (e) {}
    return out;
  }

  /** procedimentos do QVIS sem cadastro na Base Tabela (nem sinônimo) */
  function _procedimentosSemCadastro() {
    const conhecidos = new Set();
    try {
      for (const p of Banco.query(`SELECT nome_oficial, nome_normalizado FROM procedimentos`) || []) {
        if (p.nome_oficial) conhecidos.add(norm(p.nome_oficial));
        if (p.nome_normalizado) conhecidos.add(norm(p.nome_normalizado));
      }
      for (const s of Banco.query(`SELECT grafia, grafia_normalizada FROM sinonimos_proc`) || []) {
        if (s.grafia) conhecidos.add(norm(s.grafia));
        if (s.grafia_normalizada) conhecidos.add(norm(s.grafia_normalizada));
      }
    } catch (e) {}
    const out = new Map();
    try {
      for (const r of Banco.query(
        `SELECT DISTINCT COALESCE(NULLIF(TRIM(procedimento_normalizado),''), procedimento) AS n,
                procedimento AS bruto
           FROM linhas_qvis WHERE TRIM(COALESCE(procedimento,'')) <> ''`) || []) {
        const k = norm(r.n);
        if (!k || conhecidos.has(k)) continue;
        if (!out.has(k)) out.set(k, String(r.bruto || r.n).trim());
      }
    } catch (e) {}
    return out;
  }

  /** foto de anistia: roda UMA vez — o estoque atual não alerta */
  function garantirBaseline() {
    if (!window.Banco || !Banco.db) return;
    if (lerConfig(K_MED) === null) gravarConfig(K_MED, [..._medicosSemCadastro().keys()]);
    if (lerConfig(K_PROC) === null) gravarConfig(K_PROC, [..._procedimentosSemCadastro().keys()]);
  }

  /** { medicos: [nomes], procedimentos: [nomes] } — só o que NÃO está anistiado */
  function listar() {
    if (!window.Banco || !Banco.db) return { medicos: [], procedimentos: [] };
    if (_cache.versao === Banco._versao && _cache.dados) return _cache.dados;
    garantirBaseline();
    const bMed = new Set(lerConfig(K_MED) || []);
    const bProc = new Set(lerConfig(K_PROC) || []);
    const medicos = [..._medicosSemCadastro()].filter(([k]) => !bMed.has(k)).map(([, v]) => v)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const procedimentos = [..._procedimentosSemCadastro()].filter(([k]) => !bProc.has(k)).map(([, v]) => v)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    _cache = { versao: Banco._versao, dados: { medicos, procedimentos } };
    return _cache.dados;
  }
  function contar() {
    const p = listar();
    return p.medicos.length + p.procedimentos.length;
  }

  // ── ⚠ na aba CADASTROS ────────────────────────────────────────────────────
  function atualizarIcone() {
    const btn = document.getElementById('idock-cadastros-btn');
    if (!btn) return;
    let ico = document.getElementById('cadpend-ico');
    const n = contar();
    if (!n) { if (ico) ico.remove(); return; }
    if (!ico) {
      ico = document.createElement('span');
      ico.id = 'cadpend-ico';
      ico.style.cssText = 'margin-left:6px;font-size:13px;line-height:1;filter:drop-shadow(0 0 2px rgba(0,0,0,.35));';
      btn.appendChild(ico);
    }
    ico.textContent = '⚠️';
    ico.title = `${n} pendência${n === 1 ? '' : 's'} de cadastro — clique para ver o que é e onde resolver`;
    ico.style.cursor = 'pointer';
    /**
     * V898: o ⚠ vira PORTA, não só aviso. O clique abre um painel que diz o
     * QUE é o alerta (nomes que as importações trouxeram e ainda não existem
     * nos cadastros) e PARA ONDE ir — cada grupo leva ao módulo certo, já com
     * o banner listando exatamente o que falta cadastrar (abrirModulo, V814).
     */
    if (!ico.dataset.cadpendBind) {
      ico.dataset.cadpendBind = '1';
      ico.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();   // não abre o menu CADASTROS
        togglePainel(ico);
      });
    }
  }

  // ── V898: o painel do alerta — o que é e para onde ir ─────────────────────
  const escQ = (x) => String(x == null ? '' : x)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function fecharPainel() {
    document.getElementById('cadpend-painel')?.remove();
    document.removeEventListener('click', _cliqueFora, true);
    document.removeEventListener('keydown', _escFecha, true);
  }
  function _cliqueFora(e) {
    if (!e.target.closest('#cadpend-painel') && e.target.id !== 'cadpend-ico') fecharPainel();
  }
  function _escFecha(e) { if (e.key === 'Escape') fecharPainel(); }
  function togglePainel(ancora) {
    if (document.getElementById('cadpend-painel')) { fecharPainel(); return; }
    const p = listar();
    const grupo = (tipo, rotulo, destino, nomes) => {
      if (!nomes.length) return '';
      const amostra = nomes.slice(0, 6);
      return `
        <div class="cadpend-grupo" data-cadpend-ir="${tipo}" role="button" tabindex="0"
             style="margin-top:8px;padding:9px 11px;border:1px solid #E8C670;border-radius:9px;
                    background:#FFF8E6;cursor:pointer">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
            <strong style="font-size:12.5px;color:#1d1f20">${escQ(rotulo)} (${nomes.length})</strong>
            <span style="font-size:11.5px;font-weight:700;color:#46688c;white-space:nowrap">abrir ${escQ(destino)} →</span>
          </div>
          <div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:4px">
            ${amostra.map(n => `<span style="background:#fff;border:1px solid #E8C670;border-radius:6px;
              padding:1px 7px;font-size:11px">${escQ(n)}</span>`).join('')}
            ${nomes.length > amostra.length ? `<span style="font-size:11px;color:#585d62;padding:1px 3px">+ ${nomes.length - amostra.length}</span>` : ''}
          </div>
        </div>`;
    };
    const div = document.createElement('div');
    div.id = 'cadpend-painel';
    const r = ancora.getBoundingClientRect();
    div.style.cssText = `position:fixed;top:${Math.round(r.bottom + 8)}px;`
      + `left:${Math.max(10, Math.round(r.right - 340))}px;width:340px;z-index:9999;`
      + 'background:#fff;border:1px solid #eef0f2;border-radius:12px;'
      + 'box-shadow:0 12px 32px rgba(29, 31, 32,.18);padding:12px 14px;font-size:12px;color:#1d1f20;';
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
        <strong style="font-size:13px">⚠️ Pendências de cadastro</strong>
        <button id="cadpend-painel-x" style="border:none;background:none;cursor:pointer;font-size:15px;color:#585d62">✕</button>
      </div>
      <div style="margin-top:5px;color:#585d62;line-height:1.45">
        As importações trouxeram nomes que ainda não existem nos cadastros.
        Clique num grupo para ir ao módulo certo — ele abre já listando o que falta;
        o alerta some sozinho quando tudo estiver cadastrado.
      </div>
      ${grupo('medicos', 'Médicos sem cadastro', 'Médicos', p.medicos)}
      ${grupo('procedimentos', 'Procedimentos sem regra na Base Tabela', 'Base Tabela', p.procedimentos)}`;
    document.body.appendChild(div);
    div.querySelector('#cadpend-painel-x').addEventListener('click', fecharPainel);
    div.querySelectorAll('[data-cadpend-ir]').forEach(g => g.addEventListener('click', () => {
      const tipo = g.dataset.cadpendIr;
      fecharPainel();
      abrirModulo(tipo);
    }));
    document.addEventListener('click', _cliqueFora, true);
    document.addEventListener('keydown', _escFecha, true);
  }

  // ── clique na pendência → módulo certo, mostrando SÓ o que falta ─────────
  function abrirModulo(tipo) {
    const tela = tipo === 'medicos' ? 'medicos' : 'base-tabela';
    try { window.App.navegarPara(tela); } catch (e) { return; }
    // o banner entra por cima da tela renderizada — os itens pendentes não
    // existem dentro do cadastro (é justamente o que falta cadastrar)
    const tentar = (resta) => {
      const cont = document.getElementById('conteudo');
      if (!cont || !cont.firstChild) {
        if (resta > 0) setTimeout(() => tentar(resta - 1), 150);
        return;
      }
      document.getElementById('cadpend-banner')?.remove();
      const p = listar();
      const nomes = tipo === 'medicos' ? p.medicos : p.procedimentos;
      if (!nomes.length) return;
      const rot = tipo === 'medicos' ? 'Médicos sem cadastro' : 'Procedimentos sem cadastro na Base Tabela';
      const div = document.createElement('div');
      div.id = 'cadpend-banner';
      div.style.cssText = 'margin:10px 14px 0;padding:10px 14px;border:1px solid #E8C670;'
        + 'background:#FFF8E6;border-radius:10px;font-size:12.5px;color:#1d1f20;';
      div.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <strong>⚠️ ${rot} (${nomes.length})</strong>
          <button id="cadpend-banner-x" style="border:none;background:none;cursor:pointer;font-size:15px;color:#585d62">✕</button>
        </div>
        <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">
          ${nomes.map(n => `<span style="background:#fff;border:1px solid #E8C670;border-radius:6px;padding:2px 8px">${n
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`).join('')}
        </div>
        <div style="margin-top:6px;color:#585d62">Cadastre estes itens — o alerta some sozinho quando o cadastro estiver completo.</div>`;
      cont.prepend(div);
      div.querySelector('#cadpend-banner-x').addEventListener('click', () => div.remove());
    };
    tentar(20);
  }

  window.CadastroPendencias = { listar, contar, atualizarIcone, abrirModulo, garantirBaseline };

  // ícone acompanha a navegação (o cache por Banco._versao torna isso barato)
  document.addEventListener('DOMContentLoaded', () => {
    const aplicar = () => { try { atualizarIcone(); } catch (e) {} };
    setInterval(aplicar, 4000);
    setTimeout(aplicar, 1500);
  });
})();
