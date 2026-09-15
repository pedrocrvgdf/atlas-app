/**
 * ============================================================================
 * TELA: Base Tabela (📚)
 *
 * As REGRAS de repasse de cada hospital: procedimento × papel × fonte →
 * valor fixo (R$) ou percentual (%) sobre o produzido.
 *
 * Duas abas:
 *   • Regras — o que vale no cálculo (importadas, manuais ou promovidas)
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
        <span class="tela-sub">cliente: <strong>${esc(cliente.nome)}</strong></span>
        <div class="tela-acoes">
          <select class="entrada" id="bt-hosp">${hospitais.map(h =>
            `<option value="${h.id}" ${h.id === st.hospitalId ? 'selected' : ''}>${esc(h.nome)}</option>`).join('')}
          </select>
          <button class="botao ${st.aba === 'regras' ? 'botao-marinho' : ''}" data-aba="regras">Regras</button>
          <button class="botao ${st.aba === 'padroes' ? 'botao-marinho' : ''}" data-aba="padroes">Padrões inferidos</button>
        </div>
      </div>
      <div id="bt-corpo"></div>`;

    el.querySelector('#bt-hosp').addEventListener('change', e => { st.hospitalId = Number(e.target.value); render(); });
    el.querySelectorAll('[data-aba]').forEach(b =>
      b.addEventListener('click', () => { st.aba = b.dataset.aba; render(); }));

    if (st.aba === 'regras') renderRegras();
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
        Padrões com confiança ≥ ${Math.round(minConf * 100)}% já entram automaticamente no cálculo
        quando não há regra na Base — promover a regra os torna definitivos (e editáveis).
      </div>
      <div class="painel">
        <div class="painel-cabecalho">
          <span class="painel-titulo">Padrões aprendidos do histórico</span>
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

  render();
};
