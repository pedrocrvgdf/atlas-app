/**
 * ============================================================================
 * TELA: Médicos — De-Para de grafias (🩺)
 *
 * A lição central da metodologia: sem resolver as GRAFIAS de médico, nenhum
 * cruzamento fecha — "DR JOAO SILVA" na produção e "JOAO DA SILVA" no
 * repasse são a mesma pessoa, e sem o vínculo o motor enxerga "pago a
 * outro" onde houve pagamento certo.
 *
 * Três blocos:
 *   1. SUGESTÕES DE UNIFICAÇÃO — detector automático de duplicados: grafias
 *      com o mesmo sobrenome que casam por similaridade (typo) ou por
 *      abreviação ("J SILVA" ⊂ "JOAO SILVA"). Unificação em um clique.
 *   2. GRAFIAS SEM VÍNCULO — tudo o que apareceu nos relatórios e ainda não
 *      resolve para um médico oficial; vincular ou criar oficial dali.
 *   3. MÉDICOS OFICIAIS — o cadastro: nome oficial + grafias vinculadas, e a
 *      marca de CLIENTE (quem a ATLAS audita; é ela que alimenta o seletor
 *      do topo, porque os relatórios trazem o hospital inteiro).
 *
 * Todo vínculo vale na hora: o motor resolve nomes via medicos +
 * sinonimos_medico (Motor.auditar → mapaSinonimos) e os caches se
 * invalidam sozinhos pelo carimbo Banco._versao.
 * ============================================================================
 */
App.telas['medicos'] = function () {
  'use strict';
  const el = document.getElementById('conteudo');
  const esc = Utilidades.esc;
  const norm = Utilidades.normalizar;
  const cliente = App.clienteAtivo();
  if (!cliente) { App.avisoSemCliente(el); return; }

  if (!window.__med) window.__med = { busca: '', buscaOf: '', maisSugestoes: false };
  const st = window.__med;

  const RUIDO = new Set(['DR', 'DRA', 'DE', 'DA', 'DO', 'DOS', 'DAS', 'E']);
  const LIMIAR_SIM = 0.86;

  // ────────────────────────────────────────────────────────────────────
  // LEITURA (memoizada por Banco._versao)
  // ────────────────────────────────────────────────────────────────────
  let _memo = { versao: -1 };

  function dados() {
    if (_memo.versao === Banco._versao) return _memo;

    // todas as grafias que aparecem nos relatórios do cliente, com contagem
    const cont = new Map();   // norm → { grafia (a mais frequente), n }
    const juntar = (rows) => {
      for (const r of rows) {
        const g = String(r.nome || '').trim();
        const k = norm(g);
        if (!k) continue;
        const reg = cont.get(k);
        if (!reg) cont.set(k, { grafia: g, n: Number(r.n) || 0, _melhor: Number(r.n) || 0 });
        else {
          reg.n += Number(r.n) || 0;
          if ((Number(r.n) || 0) > reg._melhor) { reg._melhor = Number(r.n) || 0; reg.grafia = g; }
        }
      }
    };
    for (const col of ['executante', 'auxiliar', 'indicante', 'solicitante', 'laudo']) {
      juntar(Banco.query(
        `SELECT ${col} AS nome, COUNT(*) AS n FROM linhas_producao
          WHERE cliente_id = ? AND TRIM(COALESCE(${col}, '')) <> '' GROUP BY ${col}`, [cliente.id]));
    }
    juntar(Banco.query(
      `SELECT medico AS nome, COUNT(*) AS n FROM linhas_repasse
        WHERE cliente_id = ? AND TRIM(COALESCE(medico, '')) <> '' GROUP BY medico`, [cliente.id]));

    // cadastro oficial + vínculos
    const oficiais = Banco.query(
      'SELECT * FROM medicos WHERE cliente_id = ? ORDER BY nome_oficial', [cliente.id]);
    const sinonimos = oficiais.length ? Banco.query(
      `SELECT s.* FROM sinonimos_medico s JOIN medicos m ON m.id = s.medico_id
        WHERE m.cliente_id = ?`, [cliente.id]) : [];

    const vinculo = new Map();          // norm da grafia → medico_id
    for (const m of oficiais) vinculo.set(m.nome_norm, m.id);
    for (const s of sinonimos) vinculo.set(s.grafia_norm, s.medico_id);

    const grafias = [...cont.entries()]
      .map(([k, v]) => ({ norm: k, grafia: v.grafia, n: v.n, medicoId: vinculo.get(k) || null }))
      .sort((a, b) => b.n - a.n);

    const porOficial = new Map(oficiais.map(m => [m.id, { m, sinonimos: [], ocorrencias: 0 }]));
    for (const s of sinonimos) {
      const reg = porOficial.get(s.medico_id);
      if (reg) reg.sinonimos.push(s);
    }
    for (const g of grafias) {
      if (g.medicoId && porOficial.has(g.medicoId)) porOficial.get(g.medicoId).ocorrencias += g.n;
    }

    _memo = { versao: Banco._versao, grafias, oficiais, porOficial, vinculo,
      sugestoes: detectarDuplicados(grafias) };
    return _memo;
  }

  // ────────────────────────────────────────────────────────────────────
  // DETECTOR DE DUPLICADOS
  // ────────────────────────────────────────────────────────────────────
  const tokensUteis = (n) => n.split(' ').filter(t => t && !RUIDO.has(t));

  /** "J SILVA" ⊂ "JOAO SILVA": todo token do menor casa por prefixo, em ordem. */
  function ehAbreviacao(tokA, tokB) {
    const [menor, maior] = tokA.length <= tokB.length ? [tokA, tokB] : [tokB, tokA];
    if (!menor.length) return false;
    let j = 0;
    for (const t of menor) {
      let achou = false;
      while (j < maior.length) {
        const M = maior[j++];
        if (M === t || (t.length === 1 && M.startsWith(t)) || (t.length >= 3 && M.startsWith(t))) {
          achou = true; break;
        }
      }
      if (!achou) return false;
    }
    return true;
  }

  /**
   * Agrupa grafias que parecem a MESMA pessoa. Balde por último token
   * (sobrenome) — dentro do balde, par casa por similaridade (typo) ou por
   * abreviação. Grafias já vinculadas a médicos DIFERENTES não se agrupam
   * (decisão humana já tomada); cluster 100% resolvido não vira sugestão.
   */
  function detectarDuplicados(grafias) {
    const baldes = new Map();
    for (const g of grafias) {
      const toks = tokensUteis(g.norm);
      if (!toks.length) continue;
      const chave = toks[toks.length - 1];
      if (chave.length < 3) continue;
      if (!baldes.has(chave)) baldes.set(chave, []);
      baldes.get(chave).push(Object.assign({ _toks: toks }, g));
    }

    // union-find simples
    const pai = new Map();
    const achar = (k) => { while (pai.get(k) !== k) { pai.set(k, pai.get(pai.get(k))); k = pai.get(k); } return k; };
    const unir = (a, b) => { const ra = achar(a), rb = achar(b); if (ra !== rb) pai.set(ra, rb); };
    for (const g of grafias) pai.set(g.norm, g.norm);

    for (const lote of baldes.values()) {
      if (lote.length < 2 || lote.length > 400) continue;
      for (let i = 0; i < lote.length; i++) {
        for (let j = i + 1; j < lote.length; j++) {
          const A = lote[i], B = lote[j];
          if (A.medicoId && B.medicoId && A.medicoId !== B.medicoId) continue;
          if (Utilidades.similaridade(A.norm, B.norm) >= LIMIAR_SIM ||
              ehAbreviacao(A._toks, B._toks)) {
            unir(A.norm, B.norm);
          }
        }
      }
    }

    const clusters = new Map();
    for (const g of grafias) {
      const raiz = achar(g.norm);
      if (!clusters.has(raiz)) clusters.set(raiz, []);
      clusters.get(raiz).push(g);
    }

    const out = [];
    for (const grupo of clusters.values()) {
      if (grupo.length < 2) continue;
      const ids = new Set(grupo.map(g => g.medicoId).filter(Boolean));
      if (ids.size > 1) continue;                            // conflito humano — não sugerir
      const naoVinculadas = grupo.filter(g => !g.medicoId);
      if (!naoVinculadas.length) continue;                   // tudo resolvido
      grupo.sort((a, b) => b.n - a.n);
      // nome sugerido: a grafia mais frequente; empate → a mais completa
      const sugerido = grupo.slice().sort((a, b) =>
        (b.n - a.n) || (b.grafia.length - a.grafia.length))[0].grafia;
      out.push({
        grafias: grupo,
        medicoId: ids.size ? [...ids][0] : null,
        nomeSugerido: sugerido,
        ocorrencias: grupo.reduce((s, g) => s + g.n, 0),
      });
    }
    out.sort((a, b) => b.ocorrencias - a.ocorrencias);
    return out;
  }

  // ────────────────────────────────────────────────────────────────────
  // AÇÕES
  // ────────────────────────────────────────────────────────────────────
  function criarOficial(nome) {
    const n = norm(nome);
    const jaTem = Banco.query(
      'SELECT id FROM medicos WHERE cliente_id = ? AND nome_norm = ?', [cliente.id, n]);
    if (jaTem.length) return jaTem[0].id;
    Banco.executar('INSERT INTO medicos (cliente_id, nome_oficial, nome_norm) VALUES (?,?,?)',
      [cliente.id, String(nome).trim(), n]);
    return Banco.ultimoId();
  }

  function vincular(grafia, medicoId) {
    const gn = norm(grafia);
    const oficialNorm = Banco.escalar('SELECT nome_norm FROM medicos WHERE id = ?', [medicoId]);
    if (gn === oficialNorm) return;   // a própria grafia oficial não precisa de sinônimo
    const ja = Banco.escalar('SELECT id FROM sinonimos_medico WHERE medico_id = ? AND grafia_norm = ?',
      [medicoId, gn]);
    if (ja) return;
    Banco.executar('INSERT INTO sinonimos_medico (medico_id, grafia, grafia_norm) VALUES (?,?,?)',
      [medicoId, String(grafia).trim(), gn]);
  }

  function unificar(sug, nomeOficial) {
    const id = sug.medicoId || criarOficial(nomeOficial);
    if (sug.medicoId && norm(nomeOficial) !==
        Banco.escalar('SELECT nome_norm FROM medicos WHERE id=?', [id])) {
      // o usuário editou o nome — renomeia mantendo o antigo como sinônimo
      renomear(id, nomeOficial, { silencioso: true });
    }
    for (const g of sug.grafias) {
      if (!g.medicoId) vincular(g.grafia, id);
    }
    Banco.salvarDebounced();
    Utilidades.toast(`Unificado: ${sug.grafias.length} grafias → ${nomeOficial}`, 'ok');
    render();
  }

  function renomear(id, novoNome, opts) {
    const antigo = Banco.query('SELECT nome_oficial, nome_norm FROM medicos WHERE id=?', [id])[0];
    if (!antigo || !String(novoNome || '').trim()) return;
    Banco.executar('UPDATE medicos SET nome_oficial = ?, nome_norm = ? WHERE id = ?',
      [String(novoNome).trim(), norm(novoNome), id]);
    // o nome antigo continua resolvendo (vira sinônimo)
    vincular(antigo.nome_oficial, id);
    if (!opts || !opts.silencioso) {
      Banco.salvarDebounced();
      Utilidades.toast('Médico renomeado.', 'ok');
      render();
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────
  function render() {
    const d = dados();
    const semVinculo = d.grafias.filter(g => !g.medicoId);
    const buscaN = norm(st.busca);
    const listaSem = buscaN ? semVinculo.filter(g => g.norm.includes(buscaN)) : semVinculo;
    const LIM_SEM = 60;
    const LIM_SUG = st.maisSugestoes ? 200 : 12;

    const opcoesOficiais = (sel) => d.oficiais.map(m =>
      `<option value="${m.id}" ${sel === m.id ? 'selected' : ''}>${esc(m.nome_oficial)}</option>`).join('');

    el.innerHTML = `
      <div class="tela-cabecalho">
        <h1 class="tela-titulo">Médicos — De-Para</h1>
        <span class="tela-sub">hospital: <strong>${esc(cliente.nome)}</strong> · toda grafia resolve para um nome oficial</span>
      </div>

      <div class="cards">
        <div class="card"><div class="card-rotulo">Grafias nos relatórios</div>
          <div class="card-valor">${d.grafias.length.toLocaleString('pt-BR')}</div></div>
        <div class="card ${semVinculo.length ? 'card-erro' : 'card-ok'}"><div class="card-rotulo">Sem vínculo</div>
          <div class="card-valor">${semVinculo.length.toLocaleString('pt-BR')}</div></div>
        <div class="card"><div class="card-rotulo">Médicos oficiais</div>
          <div class="card-valor">${d.oficiais.length.toLocaleString('pt-BR')}</div></div>
        <div class="card ${d.sugestoes.length ? 'card-destaque' : ''}"><div class="card-rotulo">Sugestões de unificação</div>
          <div class="card-valor">${d.sugestoes.length.toLocaleString('pt-BR')}</div></div>
      </div>

      ${d.sugestoes.length ? `
      <div class="painel">
        <div class="painel-cabecalho">
          <span class="painel-titulo">⚡ Sugestões de unificação</span>
          <span class="painel-conta">grafias que parecem a MESMA pessoa (typo ou abreviação) — confira o nome e unifique</span>
        </div>
        <div class="painel-corpo">
          ${d.sugestoes.slice(0, LIM_SUG).map((s, i) => `
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;
                        padding:9px 0;border-bottom:1px solid var(--borda-suave)">
              <div style="flex:2;min-width:260px">
                ${s.grafias.map(g => `<span class="badge badge-${g.medicoId ? 'OK' : 'SEM_REGRA'}"
                  style="margin:2px 4px 2px 0">${esc(g.grafia)} <span style="opacity:.65">×${g.n.toLocaleString('pt-BR')}</span></span>`).join('')}
              </div>
              <input class="entrada" style="flex:1;min-width:200px" data-sug-nome="${i}"
                value="${esc(s.medicoId ? (d.porOficial.get(s.medicoId) || { m: { nome_oficial: s.nomeSugerido } }).m.nome_oficial : s.nomeSugerido)}">
              <button class="botao botao-primario botao-mini" data-sug="${i}">Unificar</button>
            </div>`).join('')}
          ${d.sugestoes.length > LIM_SUG ? `<button class="botao botao-mini" id="sug-mais" style="margin-top:10px">
            mostrar todas as ${d.sugestoes.length} sugestões</button>` : ''}
        </div>
      </div>` : ''}

      <div class="painel">
        <div class="painel-cabecalho">
          <span class="painel-titulo">Grafias sem vínculo</span>
          <span class="painel-conta">${listaSem.length.toLocaleString('pt-BR')} grafia(s)${listaSem.length > LIM_SEM ? ' — mostrando as ' + LIM_SEM + ' mais frequentes' : ''}</span>
          <div class="painel-acoes">
            <input class="entrada" id="med-busca" placeholder="🔎 buscar grafia" value="${esc(st.busca)}">
          </div>
        </div>
        ${listaSem.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
            <th>Grafia (como vem nos relatórios)</th><th class="num">Ocorrências</th>
            <th>Vincular a…</th><th></th>
          </tr></thead><tbody>
          ${listaSem.slice(0, LIM_SEM).map((g, i) => `<tr>
            <td><strong>${esc(g.grafia)}</strong></td>
            <td class="num">${g.n.toLocaleString('pt-BR')}</td>
            <td>${d.oficiais.length ? `<div style="display:flex;gap:6px">
              <select class="entrada" data-vinc-sel="${i}" style="min-width:220px">
                <option value="">— escolher médico —</option>${opcoesOficiais(null)}
              </select>
              <button class="botao botao-mini" data-vinc="${i}">vincular</button></div>`
              : '<span class="texto-cinza">nenhum oficial ainda</span>'}</td>
            <td style="text-align:right">
              <button class="botao botao-mini botao-marinho" data-novo="${i}">➕ novo oficial com este nome</button></td>
          </tr>`).join('')}
          </tbody></table></div>` :
        `<div class="tabela-vazia">${semVinculo.length ? 'Nada com essa busca.' :
          'Todas as grafias estão vinculadas. ✓'}</div>`}
      </div>

      <div class="painel">
        <div class="painel-cabecalho">
          <span class="painel-titulo">Médicos oficiais</span>
          <span class="painel-conta">${d.oficiais.length} cadastrado(s)</span>
          <div class="painel-acoes">
            <input class="entrada" id="of-nome" placeholder="nome oficial novo">
            <button class="botao botao-primario botao-mini" id="of-add">＋ Cadastrar</button>
          </div>
        </div>
        ${d.oficiais.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
            <th title="Cliente da ATLAS: é por ele que a auditoria responde">Cliente</th>
            <th>Nome oficial</th><th>Grafias vinculadas</th><th class="num">Ocorrências</th><th></th>
          </tr></thead><tbody>
          ${d.oficiais.map(m => {
            const reg = d.porOficial.get(m.id);
            return `<tr>
              <td style="text-align:center"><input type="checkbox" data-cli="${m.id}"
                ${Number(m.eh_cliente) ? 'checked' : ''}
                title="Marcar como cliente da ATLAS — só os marcados aparecem no seletor do topo"></td>
              <td><strong>${esc(m.nome_oficial)}</strong></td>
              <td>${reg.sinonimos.length ? reg.sinonimos.map(s =>
                `<span class="badge badge-OK" style="margin:2px 4px 2px 0">${esc(s.grafia)}
                 <a data-dessin="${s.id}" style="cursor:pointer;opacity:.7" title="desvincular">✕</a></span>`).join('')
                : '<span class="texto-cinza">só a grafia do próprio nome</span>'}</td>
              <td class="num">${(reg.ocorrencias || 0).toLocaleString('pt-BR')}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="botao botao-mini" data-ren="${m.id}">renomear</button>
                <button class="botao botao-mini botao-perigo" data-del="${m.id}">excluir</button></td>
            </tr>`;
          }).join('')}
          </tbody></table></div>` :
        `<div class="tabela-vazia">Nenhum médico oficial ainda — use as sugestões acima ou
          crie a partir de uma grafia.</div>`}
      </div>`;

    // ── handlers ──
    const d2 = d;
    // CLIENTE DA ATLAS — os relatórios trazem o hospital inteiro; cliente é
    // quem contratou a auditoria, e é essa lista curta que vai para o topo
    el.querySelectorAll('[data-cli]').forEach(c => c.addEventListener('change', () => {
      Banco.executar('UPDATE medicos SET eh_cliente = ? WHERE id = ?',
        [c.checked ? 1 : 0, Number(c.dataset.cli)]);
      if (!c.checked) {
        const of = d2.oficiais.find(m => m.id === Number(c.dataset.cli));
        if (of && App.medicoAtivo() === of.nome_norm) Banco.configGravar('medico_ativo_c' + cliente.id, '');
      }
      Banco.salvarDebounced();
      App.renderShell();
      App.navegar('medicos');
    }));
    el.querySelectorAll('[data-sug]').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.sug);
      const nome = el.querySelector(`[data-sug-nome="${i}"]`).value.trim();
      if (!nome) { Utilidades.toast('Informe o nome oficial.', 'aviso'); return; }
      unificar(d2.sugestoes[i], nome);
    }));
    const btnMais = el.querySelector('#sug-mais');
    if (btnMais) btnMais.addEventListener('click', () => { st.maisSugestoes = true; render(); });

    el.querySelector('#med-busca').addEventListener('input', (e) => {
      st.busca = e.target.value;
      clearTimeout(st._t); st._t = setTimeout(render, 250);
    });

    el.querySelectorAll('[data-vinc]').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.vinc);
      const sel = el.querySelector(`[data-vinc-sel="${i}"]`);
      const id = Number(sel.value);
      if (!id) { Utilidades.toast('Escolha o médico oficial.', 'aviso'); return; }
      vincular(listaSem[i].grafia, id);
      Banco.salvarDebounced();
      Utilidades.toast('Grafia vinculada.', 'ok');
      render();
    }));

    el.querySelectorAll('[data-novo]').forEach(b => b.addEventListener('click', () => {
      const g = listaSem[Number(b.dataset.novo)];
      criarOficial(g.grafia);
      Banco.salvarDebounced();
      Utilidades.toast(`"${g.grafia}" agora é médico oficial.`, 'ok');
      render();
    }));

    el.querySelector('#of-add').addEventListener('click', () => {
      const nome = el.querySelector('#of-nome').value.trim();
      if (!nome) { Utilidades.toast('Informe o nome.', 'aviso'); return; }
      criarOficial(nome);
      Banco.salvarDebounced();
      render();
    });

    el.querySelectorAll('[data-dessin]').forEach(a => a.addEventListener('click', () => {
      Banco.executar('DELETE FROM sinonimos_medico WHERE id = ?', [Number(a.dataset.dessin)]);
      Banco.salvarDebounced();
      render();
    }));

    el.querySelectorAll('[data-ren]').forEach(b => b.addEventListener('click', () => {
      const id = Number(b.dataset.ren);
      const atual = Banco.escalar('SELECT nome_oficial FROM medicos WHERE id=?', [id]);
      const novo = prompt('Novo nome oficial:', atual || '');
      if (novo && novo.trim() && novo.trim() !== atual) renomear(id, novo.trim());
    }));

    el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      const id = Number(b.dataset.del);
      if (!confirm('Excluir este médico oficial? As grafias voltam a "sem vínculo".')) return;
      Banco.executar('DELETE FROM sinonimos_medico WHERE medico_id = ?', [id]);
      Banco.executar('DELETE FROM medicos WHERE id = ?', [id]);
      Banco.salvarDebounced();
      render();
    }));
  }

  render();
};
