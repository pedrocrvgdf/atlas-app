/**
 * ============================================================================
 * TELA: Base Tabela (📚)
 *
 * As REGRAS de repasse de cada hospital: procedimento × papel × fonte →
 * valor fixo (R$) ou percentual (%) sobre o produzido.
 *
 * Três abas:
 *   • Regras — o que vale no cálculo (importadas, manuais ou promovidas)
 *   • Casamento — grafia por grafia, por qual camada o procedimento do
 *     relatório achou a linha da Base (METODOLOGIA §4.2); o que não achou
 *     nada pode ser apontado à mão e vira sinônimo.
 *   • Padrões inferidos — o que o MOTOR aprendeu observando o histórico de
 *     repasses pagos do hospital. É o caminho quando o hospital NÃO fornece
 *     Base Tabela: confira o padrão e promova a regra com um clique.
 * ============================================================================
 */
App.telas['base'] = function () {
  'use strict';
  const el = document.getElementById('conteudo');
  const esc = Utilidades.esc;
  const cliente = App.clienteAtivo();
  if (!cliente) { App.avisoSemCliente(el); return; }

  if (!window.__base) window.__base = { hospitalId: 0, aba: 'regras', busca: '' };
  const st = window.__base;

  const FONTES = ['TODAS', 'CONVENIO', 'PARTICULAR', 'SUS'];

  function render() {
    const hospitais = App.listarHospitais(cliente.id);
    if (!hospitais.length) {
      el.innerHTML = `<div class="tela-cabecalho"><h1 class="tela-titulo">Base Tabela</h1></div>
        <div class="aviso-caixa">Cadastre um hospital em <strong>Clientes</strong> primeiro.</div>`;
      return;
    }
    if (!st.hospitalId || !hospitais.some(h => h.id === st.hospitalId)) st.hospitalId = hospitais[0].id;

    el.innerHTML = `
      <div class="tela-cabecalho">
        <h1 class="tela-titulo">Base Tabela</h1>
        <span class="tela-sub">hospital: <strong>${esc(cliente.nome)}</strong></span>
        <div class="tela-acoes">
          <select class="entrada" id="bt-hosp">${hospitais.map(h =>
            `<option value="${h.id}" ${h.id === st.hospitalId ? 'selected' : ''}>${esc(h.nome)}</option>`).join('')}
          </select>
          <button class="botao ${st.aba === 'regras' ? 'botao-marinho' : ''}" data-aba="regras">Regras</button>
          <button class="botao ${st.aba === 'casamento' ? 'botao-marinho' : ''}" data-aba="casamento">Casamento</button>
          <button class="botao ${st.aba === 'padroes' ? 'botao-marinho' : ''}" data-aba="padroes">Padrões inferidos</button>
        </div>
      </div>
      <div id="bt-corpo"></div>`;

    el.querySelector('#bt-hosp').addEventListener('change', e => { st.hospitalId = Number(e.target.value); render(); });
    el.querySelectorAll('[data-aba]').forEach(b =>
      b.addEventListener('click', () => { st.aba = b.dataset.aba; render(); }));

    if (st.aba === 'regras') renderRegras();
    else if (st.aba === 'casamento') renderCasamento();
    else renderPadroes();
  }

  // ────────────────────────────────────────────────────────────────────
  function renderRegras() {
    const corpo = el.querySelector('#bt-corpo');
    const buscaN = Utilidades.normalizar(st.busca);
    let regras = Banco.query(
      `SELECT * FROM base_tabela WHERE hospital_id = ? ORDER BY procedimento, papel, fonte`,
      [st.hospitalId]);
    if (buscaN) regras = regras.filter(r => r.procedimento_norm.includes(buscaN));

    corpo.innerHTML = `
      <div class="painel">
        <div class="painel-cabecalho">
          <span class="painel-titulo">Nova regra</span>
        </div>
        <div class="painel-corpo"><div class="linha-campos">
          <div class="campo" style="flex:2"><span class="campo-rotulo">Procedimento *</span>
            <input id="nr-proc" placeholder="ex.: FACOEMULSIFICACAO COM LIO"></div>
          <div class="campo" style="max-width:150px"><span class="campo-rotulo">Papel</span>
            <select id="nr-papel">${Utilidades.PAPEIS.map(p => `<option>${p}</option>`).join('')}</select></div>
          <div class="campo" style="max-width:150px"><span class="campo-rotulo">Fonte</span>
            <select id="nr-fonte">${FONTES.map(f => `<option>${f}</option>`).join('')}</select></div>
          <div class="campo" style="max-width:130px"><span class="campo-rotulo">Valor fixo (R$)</span>
            <input id="nr-valor" placeholder="ex.: 630,00"></div>
          <div class="campo" style="max-width:130px"><span class="campo-rotulo">OU percentual (%)</span>
            <input id="nr-pct" placeholder="ex.: 70"></div>
          <button class="botao botao-primario" id="nr-add">＋ Gravar</button>
        </div></div>
      </div>

      <div class="painel">
        <div class="painel-cabecalho">
          <span class="painel-titulo">Regras deste hospital</span>
          <span class="painel-conta">${regras.length} regra(s)</span>
          <div class="painel-acoes">
            <input class="entrada" id="bt-busca" placeholder="🔎 buscar procedimento" value="${esc(st.busca)}">
          </div>
        </div>
        ${regras.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
            <th>Procedimento</th><th>Papel</th><th>Fonte</th>
            <th class="num">Valor</th><th class="num">%</th><th>Origem</th><th></th>
          </tr></thead><tbody>
          ${regras.map(r => `<tr>
            <td>${esc(r.procedimento)}</td><td>${esc(r.papel)}</td><td>${esc(r.fonte)}</td>
            <td class="num">${r.valor != null && r.valor !== 0 ? Utilidades.moeda(r.valor) : '—'}</td>
            <td class="num">${r.percentual != null && r.percentual !== 0 ? Utilidades.formatarNumero(r.percentual, 1) + '%' : '—'}</td>
            <td><span class="badge badge-${r.origem === 'INFERIDA' ? 'INFERIDA' : 'BASE'}">${esc(r.origem || 'MANUAL')}</span>
              ${r.origem === 'INFERIDA' && r.confianca != null ? `<span class="regra-origem"> conf. ${Math.round(r.confianca * 100)}% · ${r.amostras} am.</span>` : ''}</td>
            <td style="text-align:right"><button class="botao botao-mini botao-perigo" data-del="${r.id}">excluir</button></td>
          </tr>`).join('')}
          </tbody></table></div>` :
        `<div class="tabela-vazia">Nenhuma regra ainda. Importe a Base Tabela do hospital em
          <strong>Importações</strong>, cadastre manualmente acima — ou use a aba
          <strong>Padrões inferidos</strong> para aprender as regras do histórico pago.</div>`}
      </div>`;

    corpo.querySelector('#bt-busca').addEventListener('input', (e) => {
      st.busca = e.target.value;
      clearTimeout(st._t); st._t = setTimeout(renderRegras, 250);
    });

    corpo.querySelector('#nr-add').addEventListener('click', () => {
      const proc = corpo.querySelector('#nr-proc').value.trim();
      const valor = Utilidades.paraNumero(corpo.querySelector('#nr-valor').value);
      const pct = Utilidades.paraNumero(corpo.querySelector('#nr-pct').value);
      if (!proc) { Utilidades.toast('Informe o procedimento.', 'aviso'); return; }
      if (!valor && !pct) { Utilidades.toast('Informe o valor fixo OU o percentual.', 'aviso'); return; }
      Banco.executar(
        `INSERT INTO base_tabela (hospital_id, procedimento, procedimento_norm, papel, fonte, valor, percentual, origem)
         VALUES (?,?,?,?,?,?,?, 'MANUAL')`,
        [st.hospitalId, proc, Utilidades.normalizar(proc),
          corpo.querySelector('#nr-papel').value, corpo.querySelector('#nr-fonte').value,
          valor || null, pct || null]);
      Banco.salvarDebounced();
      Utilidades.toast('Regra gravada.', 'ok');
      renderRegras();
    });

    corpo.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      Banco.executar('DELETE FROM base_tabela WHERE id = ?', [Number(b.dataset.del)]);
      Banco.salvarDebounced();
      renderRegras();
    }));
  }

  // ────────────────────────────────────────────────────────────────────
  function renderPadroes() {
    const corpo = el.querySelector('#bt-corpo');
    const padroes = Motor.inferirPadroes(st.hospitalId);
    const minConf = Number(Banco.configLer('inferencia_min_confianca', 0.6));

    // já coberto por regra da Base? (não precisa promover)
    const cobertas = new Set(Banco.query(
      `SELECT procedimento_norm || '|' || papel || '|' || fonte AS k FROM base_tabela WHERE hospital_id=?`,
      [st.hospitalId]).map(r => r.k));

    const linhas = [...padroes.entries()]
      .map(([k, p]) => {
        const [proc, papel, fonte] = k.split('|');
        return { k, proc, papel, fonte, p, coberta: cobertas.has(k) || cobertas.has(proc + '|' + papel + '|TODAS') };
      })
      .sort((a, b) => (b.p.confianca - a.p.confianca) || (b.p.amostras - a.p.amostras));

    corpo.innerHTML = `
      <div class="info-caixa">
        O motor observa o histórico de repasses <strong>pagos</strong> deste hospital e infere o
        padrão por procedimento × papel × fonte: <strong>valor fixo</strong> quando o mesmo valor
        domina as amostras, <strong>percentual</strong> quando a razão pago ÷ produzido é estável.
        <strong>Isto é sugestão, não regra</strong>: a auditoria só cobra pelo que está na Base
        Tabela. O padrão aprendido mostra o costume do sistema (que nem sempre segue a tabela) —
        confira e <strong>promova a regra</strong> para que ele passe a valer no cálculo.
        Confiança de referência: ${Math.round(minConf * 100)}%.
      </div>
      <div class="painel">
        <div class="painel-cabecalho">
          <span class="painel-titulo">Padrões aprendidos do histórico (sugestões)</span>
          <span class="painel-conta">${linhas.length} padrão(ões)</span>
        </div>
        ${linhas.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
            <th>Procedimento</th><th>Papel</th><th>Fonte</th><th>Padrão</th>
            <th class="num">Amostras</th><th class="num">Confiança</th><th></th>
          </tr></thead><tbody>
          ${linhas.map((l, i) => `<tr>
            <td>${esc(l.proc)}</td><td>${esc(l.papel)}</td><td>${esc(l.fonte)}</td>
            <td>${l.p.tipo === 'FIXO' ? '<strong>' + Utilidades.moeda(l.p.valor) + '</strong> fixo'
              : '<strong>' + Utilidades.formatarNumero(l.p.percentual, 1) + '%</strong> do produzido'}</td>
            <td class="num">${l.p.amostras}</td>
            <td class="num ${l.p.confianca >= minConf ? 'texto-ok' : 'texto-aviso'}">${Math.round(l.p.confianca * 100)}%</td>
            <td style="text-align:right">${l.coberta
              ? '<span class="texto-cinza">já coberto pela Base</span>'
              : `<button class="botao botao-mini" data-prom="${i}">⭐ promover a regra</button>`}</td>
          </tr>`).join('')}
          </tbody></table></div>` :
        `<div class="tabela-vazia">Ainda não há amostras suficientes — importe relatórios de
          <strong>repasse</strong> deste hospital (mínimo de ${esc(String(Banco.configLer('inferencia_min_amostras', 3)))} pagamentos por procedimento).</div>`}
      </div>`;

    corpo.querySelectorAll('[data-prom]').forEach(b => b.addEventListener('click', () => {
      const l = linhas[Number(b.dataset.prom)];
      if (!l) return;
      // grafia original do procedimento: pega a mais frequente no repasse
      const orig = Banco.escalar(
        `SELECT procedimento FROM linhas_repasse
          WHERE hospital_id=? AND procedimento_norm=? GROUP BY procedimento
          ORDER BY COUNT(*) DESC LIMIT 1`, [st.hospitalId, l.proc]) || l.proc;
      Banco.executar(
        `INSERT INTO base_tabela (hospital_id, procedimento, procedimento_norm, papel, fonte,
           valor, percentual, origem, amostras, confianca)
         VALUES (?,?,?,?,?,?,?, 'INFERIDA', ?, ?)`,
        [st.hospitalId, orig, l.proc, l.papel, l.fonte,
          l.p.valor, l.p.percentual, l.p.amostras, l.p.confianca]);
      Banco.salvarDebounced();
      Utilidades.toast('Padrão promovido a regra da Base Tabela.', 'ok');
      renderPadroes();
    }));
  }


  // ────────────────────────────────────────────────────────────────────
  // CASAMENTO — como as grafias dos relatórios acham (ou não) a Base
  //
  // A Base traz UMA grafia por procedimento e o sistema escreve a mesma
  // cirurgia de dezenas de formas. Aqui se vê, grafia por grafia, por qual
  // camada ela achou a regra (METODOLOGIA §4.2) — e o que não achou nada
  // pode ser apontado à mão para a linha certa da Base.
  // ────────────────────────────────────────────────────────────────────
  function renderCasamento() {
    const corpo = el.querySelector('#bt-corpo');
    const casador = Motor.casadorDoHospital(st.hospitalId);
    const busca = Utilidades.normalizar(st.busca);

    const grafias = Banco.query(
      `SELECT procedimento AS proc, COUNT(*) AS n FROM linhas_producao
        WHERE hospital_id = ? AND TRIM(COALESCE(procedimento, '')) <> ''
        GROUP BY procedimento_norm ORDER BY COUNT(*) DESC LIMIT 4000`, [st.hospitalId]);

    const ROTULO = { exato: 'exato', sinonimo: 'sinônimo', similar: 'parecido',
      tokens: 'palavras', nenhum: 'fora da Base' };
    const conta = { exato: 0, sinonimo: 0, similar: 0, tokens: 0, nenhum: 0 };
    const linhas = grafias.map(g => {
      const m = casador.casar(g.proc);
      const tipo = m ? m.tipo : 'nenhum';
      conta[tipo]++;
      return { proc: g.proc, n: g.n, tipo, base: m ? m.nome : '' };
    }).filter(l => !busca || Utilidades.normalizar(l.proc).includes(busca));

    // procedimentos da Base para apontar à mão
    const daBase = casador.procedimentos.slice()
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    const achou = conta.exato + conta.sinonimo + conta.similar + conta.tokens;
    corpo.innerHTML = `
      <div class="info-caixa">
        O nome do procedimento no relatório quase nunca é igual ao da Base. O casamento é em
        <strong>quatro camadas</strong> — exato, sinônimo/nomenclatura, parecido (erro de
        digitação) e palavras-chave — e a primeira que responder decide. Grafia que
        <strong>nenhuma</strong> camada acha fica <strong>sem regra</strong> e
        <strong>não é cobrada</strong>: aponte-a aqui para a linha certa da Base, ou cadastre a
        regra na aba Regras.
      </div>
      <div class="painel">
        <div class="painel-cabecalho">
          <span class="painel-titulo">Procedimentos dos relatórios × Base Tabela</span>
          <span class="painel-conta">${achou} de ${grafias.length} acharam a regra</span>
          <div class="painel-acoes">
            <input class="entrada" id="cas-busca" placeholder="filtrar procedimento…" value="${esc(st.busca)}">
          </div>
        </div>
        <div class="painel-corpo" style="display:flex;gap:8px;flex-wrap:wrap">
          ${Object.keys(ROTULO).map(t => `<span class="imp-chip ${t === 'nenhum' && conta[t] ? '' : 'imp-chip-TODAS'}"
            style="${t === 'nenhum' && conta[t] ? 'background:#fdecea;color:#8a1c12' : ''}">${ROTULO[t]} ${conta[t]}</span>`).join('')}
        </div>
        ${linhas.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
            <th>Grafia no relatório</th><th class="num">Linhas</th><th>Camada</th>
            <th>Linha da Base usada</th><th>Apontar à mão</th>
          </tr></thead><tbody>
          ${linhas.slice(0, 400).map((l, i) => `<tr>
            <td>${esc(l.proc)}</td>
            <td class="num">${l.n.toLocaleString('pt-BR')}</td>
            <td>${l.tipo === 'nenhum'
              ? '<span class="texto-erro">fora da Base</span>'
              : `<span class="texto-cinza">${esc(ROTULO[l.tipo])}</span>`}</td>
            <td>${esc(l.base || '—')}</td>
            <td><select class="entrada" data-apontar="${i}" style="min-width:220px">
              <option value="">— escolher —</option>
              ${daBase.map(p => `<option value="${esc(p.chave)}">${esc(p.nome)}</option>`).join('')}
            </select></td>
          </tr>`).join('')}
          </tbody></table></div>
          ${linhas.length > 400 ? `<div class="texto-cinza" style="padding:8px 12px;font-size:11.5px">
            Mostrando as 400 primeiras de ${linhas.length} — use o filtro.</div>` : ''}` :
        `<div class="tabela-vazia">Nenhum procedimento importado para este hospital ainda.</div>`}
      </div>`;

    const campo = corpo.querySelector('#cas-busca');
    if (campo) campo.addEventListener('change', () => { st.busca = campo.value; renderCasamento(); });

    corpo.querySelectorAll('[data-apontar]').forEach(sel => sel.addEventListener('change', () => {
      const l = linhas[Number(sel.dataset.apontar)];
      if (!l || !sel.value) return;
      const gn = Utilidades.normalizar(l.proc);
      Banco.executar(
        `INSERT OR REPLACE INTO sinonimos_proc (hospital_id, grafia, grafia_norm, procedimento_norm, origem)
         VALUES (?,?,?,?, 'HUMANO')`, [st.hospitalId, l.proc, gn, sel.value]);
      Banco.salvarDebounced();
      Utilidades.toast('Grafia apontada para a linha da Base — a regra passa a valer.', 'ok');
      renderCasamento();
    }));
  }

  render();
};
