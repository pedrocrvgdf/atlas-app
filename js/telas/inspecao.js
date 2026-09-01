/**
 * ============================================================================
 * TELA: Inspeção (🔎) — o coração do produto
 *
 * Cruza PRODUÇÃO × REPASSE via Motor.auditar() e mostra, admissão por
 * admissão, o que era esperado, o que foi pago e O QUE FALTA RECEBER.
 *
 * Três abas:
 *   • Admissões — a matriz do cruzamento; clique abre o RAIO-X da admissão
 *     (item a item: regra aplicada, esperado, pago, diferença, status).
 *   • Pauta — admissões marcadas para acompanhamento/cobrança (o produto do
 *     serviço: o que a ATLAS está cobrando para o cliente).
 *   • Sem lastro — pagamentos de admissões que não existem na produção.
 *
 * Filtro de competência = mês da PRODUÇÃO; o pagamento é procurado em todo
 * o histórico (produção de abril paga em junho conta como paga).
 * ============================================================================
 */
App.telas['inspecao'] = function () {
  'use strict';
  const el = document.getElementById('conteudo');
  const esc = Utilidades.esc;
  const fmtR = Utilidades.moeda;
  const cliente = App.clienteAtivo();
  if (!cliente) { App.avisoSemCliente(el); return; }

  if (!window.__insp) {
    window.__insp = { hospitalId: 0, competencia: '', status: 'todos', busca: '', aba: 'admissoes' };
  }
  const st = window.__insp;

  const STATUS_ROTULO = {
    NAO_PAGO: 'NÃO PAGO', PAGO_A_OUTRO: 'PAGO A OUTRO', A_MENOR: 'PAGO A MENOR',
    SEM_REGRA: 'SEM REGRA', A_MAIOR: 'PAGO A MAIOR', NAO_PAREADO: 'SEM PAREAMENTO',
    GLOSA: 'GLOSA', OK: 'OK',
  };
  const MOTIVO_ROTULO = {
    pago_a_outro: 'pago ao médico errado — a dívida continua',
    sem_medico: 'papel remunerado sem profissional em base nenhuma',
    glosa: 'procedimento glosado pelo pagador',
    glosa_do_procedimento: 'herda a glosa do procedimento',
    fora_da_base: 'produto fora da cobrança papel-a-papel (informativo)',
  };
  const badge = (s) => `<span class="badge badge-${s}">${STATUS_ROTULO[s] || s}</span>`;

  const temDados = (Banco.escalar('SELECT COUNT(*) FROM linhas_producao WHERE cliente_id=?', [cliente.id]) || 0) > 0;

  function pautaSet() {
    return new Map(Banco.query(
      'SELECT admissao, situacao FROM pauta_inspecao WHERE cliente_id=?', [cliente.id])
      .map(r => [String(r.admissao), r.situacao]));
  }

  function render() {
    if (!temDados) {
      el.innerHTML = `
        <div class="tela-cabecalho"><h1 class="tela-titulo">Inspeção</h1>
          <span class="tela-sub">cliente: <strong>${esc(cliente.nome)}</strong></span></div>
        <div class="aviso-caixa">Ainda não há <strong>produção importada</strong> deste cliente.
          Importe os relatórios em <strong>Importações</strong> e volte aqui.</div>`;
      return;
    }

    const hospitais = App.listarHospitais(cliente.id);
    const comps = Motor.listarCompetencias(cliente.id, st.hospitalId);
    const r = Motor.auditar({ clienteId: cliente.id, hospitalId: st.hospitalId, competencia: st.competencia });

    el.innerHTML = `
      <div class="tela-cabecalho">
        <h1 class="tela-titulo">Inspeção</h1>
        <span class="tela-sub">cliente: <strong>${esc(cliente.nome)}</strong></span>
        <div class="tela-acoes">
          <button class="botao" id="insp-exportar">📤 Exportar pendências</button>
        </div>
      </div>

      <div class="filtros">
        <div class="campo"><span class="campo-rotulo">Hospital</span>
          <select class="entrada" id="f-hosp">
            <option value="0">— todos —</option>
            ${hospitais.map(h => `<option value="${h.id}" ${h.id === st.hospitalId ? 'selected' : ''}>${esc(h.nome)}</option>`).join('')}
          </select></div>
        <div class="campo"><span class="campo-rotulo">Competência (produção)</span>
          <select class="entrada" id="f-comp">
            <option value="">— todas —</option>
            ${comps.map(c => `<option value="${c}" ${c === st.competencia ? 'selected' : ''}>${Utilidades.compExibir(c)}</option>`).join('')}
          </select></div>
        <div class="campo"><span class="campo-rotulo">Status</span>
          <select class="entrada" id="f-status">
            <option value="todos">— todos —</option>
            ${Object.keys(STATUS_ROTULO).map(s =>
              `<option value="${s}" ${s === st.status ? 'selected' : ''}>${STATUS_ROTULO[s]}</option>`).join('')}
          </select></div>
        <div class="campo" style="flex:1"><span class="campo-rotulo">Busca</span>
          <input class="entrada" id="f-busca" placeholder="admissão, paciente, médico ou procedimento" value="${esc(st.busca)}"></div>
      </div>

      <div class="cards">
        <div class="card"><div class="card-rotulo">Produzido</div>
          <div class="card-valor mono">${fmtR(r.kpis.produzido)}</div></div>
        <div class="card"><div class="card-rotulo">Esperado (regras)</div>
          <div class="card-valor mono">${fmtR(r.kpis.esperado)}</div></div>
        <div class="card"><div class="card-rotulo">Pago ao médico</div>
          <div class="card-valor mono">${fmtR(r.kpis.pago)}</div></div>
        <div class="card card-destaque"><div class="card-rotulo">Falta receber</div>
          <div class="card-valor mono">${fmtR(r.kpis.falta)}</div>
          <div class="card-extra">${r.kpis.nPendencias} de ${r.kpis.nAdmissoes} admissões com pendência</div></div>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="botao ${st.aba === 'admissoes' ? 'botao-marinho' : ''}" data-aba="admissoes">Admissões</button>
        <button class="botao ${st.aba === 'pauta' ? 'botao-marinho' : ''}" data-aba="pauta">📌 Pauta</button>
        <button class="botao ${st.aba === 'semlastro' ? 'botao-marinho' : ''}" data-aba="semlastro">Sem lastro</button>
      </div>
      <div id="insp-corpo"></div>`;

    el.querySelector('#f-hosp').addEventListener('change', e => { st.hospitalId = Number(e.target.value); render(); });
    el.querySelector('#f-comp').addEventListener('change', e => { st.competencia = e.target.value; render(); });
    el.querySelector('#f-status').addEventListener('change', e => { st.status = e.target.value; renderCorpo(r); });
    el.querySelector('#f-busca').addEventListener('input', e => {
      st.busca = e.target.value;
      clearTimeout(st._t); st._t = setTimeout(() => renderCorpo(r), 250);
    });
    el.querySelectorAll('[data-aba]').forEach(b =>
      b.addEventListener('click', () => { st.aba = b.dataset.aba; render(); }));
    el.querySelector('#insp-exportar').addEventListener('click', () => exportarPendencias(r));

    renderCorpo(r);
  }

  // ────────────────────────────────────────────────────────────────────
  function filtrarAdmissoes(r) {
    const buscaN = Utilidades.normalizar(st.busca);
    return r.admissoes.filter(a => {
      if (st.status !== 'todos') {
        if (st.status === 'OK' ? a.status !== 'OK' : !a.itens.some(i => i.status === st.status)) return false;
      }
      if (buscaN) {
        const alvo = Utilidades.normalizar(
          a.admissao + ' ' + (a.paciente || '') + ' ' + a.medicos.join(' ') + ' ' +
          a.itens.map(i => i.procedimento).join(' '));
        if (!alvo.includes(buscaN)) return false;
      }
      return true;
    });
  }

  function renderCorpo(r) {
    const corpo = el.querySelector('#insp-corpo');
    if (st.aba === 'pauta') { renderPauta(corpo, r); return; }
    if (st.aba === 'semlastro') { renderSemLastro(corpo, r); return; }

    const lista = filtrarAdmissoes(r);
    const pauta = pautaSet();
    const LIMITE = 400;

    corpo.innerHTML = `
      <div class="painel">
        <div class="painel-cabecalho">
          <span class="painel-titulo">Admissões</span>
          <span class="painel-conta">${lista.length} admissão(ões)${lista.length > LIMITE ? ' — mostrando as ' + LIMITE + ' primeiras' : ''}</span>
        </div>
        ${lista.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
            <th>Admissão</th><th>Data</th><th>Paciente</th><th>Médico(s)</th>
            <th class="num">Produzido</th><th class="num">Esperado</th>
            <th class="num">Pago</th><th class="num">Falta</th><th>Status</th><th></th>
          </tr></thead><tbody>
          ${lista.slice(0, LIMITE).map((a, i) => `
            <tr class="clique" data-adm="${i}">
              <td class="mono"><strong>${esc(a.admissao)}</strong></td>
              <td>${Utilidades.dataExibir(a.data)}</td>
              <td>${esc(a.paciente || '—')}</td>
              <td>${esc(a.medicos.slice(0, 2).join(', ') || '—')}${a.medicos.length > 2 ? ' <span class="texto-cinza">+' + (a.medicos.length - 2) + '</span>' : ''}</td>
              <td class="num">${fmtR(a.produzido)}</td>
              <td class="num">${fmtR(a.esperado)}</td>
              <td class="num">${fmtR(a.pago)}</td>
              <td class="num ${a.falta > 0 ? 'texto-erro' : ''}">${a.falta > 0 ? fmtR(a.falta) : '—'}</td>
              <td>${badge(a.status)}</td>
              <td>${pauta.has(String(a.admissao)) ? `<span class="badge badge-${esc(pauta.get(String(a.admissao)))}">📌 ${esc(pauta.get(String(a.admissao)))}</span>` : ''}</td>
            </tr>`).join('')}
          </tbody></table></div>` :
        `<div class="tabela-vazia">Nada encontrado com os filtros atuais.</div>`}
      </div>`;

    corpo.querySelectorAll('[data-adm]').forEach(tr =>
      tr.addEventListener('click', () => abrirRaioX(lista[Number(tr.dataset.adm)], r)));
  }

  // ────────────────────────────────────────────────────────────────────
  // RAIO-X DA ADMISSÃO
  // ────────────────────────────────────────────────────────────────────
  function abrirRaioX(a, r) {
    if (!a) return;
    const pauta = pautaSet();
    const naPauta = pauta.has(String(a.admissao));

    const regraTxt = (i) => {
      if (!i.regra) return '<span class="texto-cinza">—</span>';
      const v = i.regra.valor != null && i.regra.valor !== 0 ? fmtR(i.regra.valor) + ' fixo'
        : Utilidades.formatarNumero(i.regra.percentual, 1) + '% do produzido';
      const orig = i.regra.origem === 'BASE'
        ? '<span class="badge badge-BASE">BASE</span>'
        : `<span class="badge badge-INFERIDA">PADRÃO</span> <span class="regra-origem">conf. ${Math.round((i.regra.confianca || 0) * 100)}% · ${i.regra.amostras || 0} am.</span>`;
      return `${v}<br>${orig}`;
    };

    const ov = document.createElement('div');
    ov.className = 'modal-fundo';
    ov.innerHTML = `
      <div class="modal modal-grande">
        <div class="modal-cabecalho">
          <span class="modal-titulo">🔎 Raio-x da admissão ${esc(a.admissao)}</span>
          <span class="texto-cinza" style="font-size:12px">${Utilidades.dataExibir(a.data)} · ${esc(a.paciente || '—')}
            · ${esc(a.convenios.join(', ') || '—')} · comp. ${Utilidades.compExibir(a.competencia)}</span>
          <button class="modal-fechar">✕</button>
        </div>
        <div class="modal-corpo">
          <div class="raiox-kpis">
            <div class="raiox-kpi">Produzido<strong class="mono">${fmtR(a.produzido)}</strong></div>
            <div class="raiox-kpi">Esperado<strong class="mono">${fmtR(a.esperado)}</strong></div>
            <div class="raiox-kpi">Pago<strong class="mono">${fmtR(a.pago)}</strong></div>
            <div class="raiox-kpi">Falta<strong class="mono ${a.falta > 0 ? 'texto-erro' : 'texto-ok'}">${fmtR(a.falta)}</strong></div>
            <div class="raiox-kpi">Status<strong>${badge(a.status)}</strong></div>
          </div>
          <div class="separador"></div>
          <div class="raiox-rotulo">Item a item (produção × regra × pagamento)</div>
          <div class="rolagem-x"><table class="tabela"><thead><tr>
            <th>Procedimento</th><th>Papel</th><th>Profissional</th><th>Fonte</th>
            <th class="num">Produzido</th><th>Regra</th>
            <th class="num">Esperado</th><th class="num">Pago</th><th class="num">Diferença</th><th>Status</th>
          </tr></thead><tbody>
            ${a.itens.map(i => `<tr>
              <td>${esc(i.procedimento)}${i.quantidade > 1 ? ' <span class="texto-cinza">×' + i.quantidade + '</span>' : ''}</td>
              <td>${esc(i.papel)}</td>
              <td>${esc(i.medico || '—')}${!i.medico && i.regra && i.status !== 'GLOSA' ? '<br><span class="texto-aviso" style="font-size:10px">papel exigido sem profissional na produção</span>' : ''}</td>
              <td>${esc(i.fonte)}</td>
              <td class="num">${i.valorProducao ? fmtR(i.valorProducao) : '—'}</td>
              <td>${regraTxt(i)}</td>
              <td class="num">${i.esperado != null ? fmtR(i.esperado) : '—'}</td>
              <td class="num">${i.pago ? fmtR(i.pago) : (i.pagoOutro ? '<span class="texto-aviso">' + fmtR(i.pagoOutro) + '*</span>' : '—')}</td>
              <td class="num ${i.diferenca > 0 ? 'texto-erro' : (i.diferenca < 0 ? 'texto-aviso' : '')}">${i.diferenca != null && Math.abs(i.diferenca) > 0.009 ? fmtR(i.diferenca) : '—'}</td>
              <td>${badge(i.status)}${i.motivo && MOTIVO_ROTULO[i.motivo]
                ? `<br><span class="texto-cinza" style="font-size:10px">${esc(MOTIVO_ROTULO[i.motivo])}${i.pagoA ? ' (' + esc(i.pagoA) + ')' : ''}</span>` : ''}</td>
            </tr>`).join('')}
          </tbody></table></div>
        </div>
        <div class="modal-rodape">
          ${naPauta
            ? `<span class="badge badge-${esc(pauta.get(String(a.admissao)))}" style="align-self:center">📌 já na pauta — ${esc(pauta.get(String(a.admissao)))}</span>`
            : `<button class="botao" id="rx-pauta">📌 Adicionar à pauta de cobrança</button>`}
          <button class="botao botao-marinho" id="rx-fechar">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const fechar = () => ov.remove();
    ov.querySelector('.modal-fechar').addEventListener('click', fechar);
    ov.querySelector('#rx-fechar').addEventListener('click', fechar);
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });

    const btnPauta = ov.querySelector('#rx-pauta');
    if (btnPauta) btnPauta.addEventListener('click', () => {
      Banco.executar(
        `INSERT INTO pauta_inspecao (cliente_id, hospital_id, admissao, situacao, valor_apurado, anotacao)
         VALUES (?, ?, ?, 'PENDENTE', ?, ?)
         ON CONFLICT(cliente_id, admissao) DO UPDATE SET
           valor_apurado = excluded.valor_apurado, atualizado_em = CURRENT_TIMESTAMP`,
        [cliente.id, a.hospital_id, String(a.admissao), a.falta,
          a.itens.filter(i => i.falta > 0).map(i => `${i.papel} · ${i.procedimento} · falta ${fmtR(i.falta)}`).join(' | ')]);
      Banco.salvarDebounced();
      Utilidades.toast('Admissão adicionada à pauta.', 'ok');
      fechar();
      void r;
      render();
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // PAUTA (vigias)
  // ────────────────────────────────────────────────────────────────────
  function renderPauta(corpo, r) {
    const itens = Banco.query(
      `SELECT p.*, h.nome AS hospital FROM pauta_inspecao p
       LEFT JOIN hospitais h ON h.id = p.hospital_id
       WHERE p.cliente_id = ?
       ORDER BY CASE p.situacao WHEN 'PENDENTE' THEN 0 WHEN 'COBRADO' THEN 1
                WHEN 'RESOLVIDO' THEN 2 ELSE 3 END, p.criado_em DESC`, [cliente.id]);
    const porAdm = new Map(r.admissoes.map(a => [String(a.admissao), a]));
    const SITUACOES = ['PENDENTE', 'COBRADO', 'RESOLVIDO', 'DESCARTADO'];

    corpo.innerHTML = `
      <div class="painel">
        <div class="painel-cabecalho">
          <span class="painel-titulo">📌 Pauta de cobrança</span>
          <span class="painel-conta">${itens.length} admissão(ões) em acompanhamento</span>
        </div>
        ${itens.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
            <th>Admissão</th><th>Hospital</th><th class="num">Falta apurada</th>
            <th class="num">Falta atual</th><th>Situação</th><th>Anotação</th><th></th>
          </tr></thead><tbody>
          ${itens.map(p => {
            const atual = porAdm.get(String(p.admissao));
            return `<tr>
              <td class="mono"><strong>${esc(p.admissao)}</strong></td>
              <td>${esc(p.hospital || '—')}</td>
              <td class="num">${fmtR(p.valor_apurado || 0)}</td>
              <td class="num ${atual && atual.falta > 0 ? 'texto-erro' : 'texto-ok'}">${atual ? fmtR(atual.falta) : '<span class="texto-cinza">fora do filtro</span>'}</td>
              <td><select class="entrada" data-sit="${p.id}">
                ${SITUACOES.map(s => `<option ${s === p.situacao ? 'selected' : ''}>${s}</option>`).join('')}
              </select></td>
              <td><input class="entrada" style="width:100%" data-nota="${p.id}" value="${esc(p.anotacao || '')}" placeholder="anotação"></td>
              <td style="text-align:right"><button class="botao botao-mini botao-perigo" data-rem="${p.id}">remover</button></td>
            </tr>`;
          }).join('')}
          </tbody></table></div>` :
        `<div class="tabela-vazia">Pauta vazia — abra o raio-x de uma admissão com pendência e
          use <strong>“Adicionar à pauta de cobrança”</strong>.</div>`}
      </div>`;

    corpo.querySelectorAll('[data-sit]').forEach(s => s.addEventListener('change', () => {
      Banco.executar('UPDATE pauta_inspecao SET situacao=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?',
        [s.value, Number(s.dataset.sit)]);
      Banco.salvarDebounced();
    }));
    corpo.querySelectorAll('[data-nota]').forEach(n => n.addEventListener('change', () => {
      Banco.executar('UPDATE pauta_inspecao SET anotacao=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?',
        [n.value, Number(n.dataset.nota)]);
      Banco.salvarDebounced();
    }));
    corpo.querySelectorAll('[data-rem]').forEach(b => b.addEventListener('click', () => {
      if (!confirm('Remover esta admissão da pauta?')) return;
      Banco.executar('DELETE FROM pauta_inspecao WHERE id=?', [Number(b.dataset.rem)]);
      Banco.salvarDebounced();
      renderPauta(corpo, r);
    }));
  }

  // ────────────────────────────────────────────────────────────────────
  function renderSemLastro(corpo, r) {
    corpo.innerHTML = `
      <div class="info-caixa">Pagamentos de admissões que <strong>não existem na produção
      importada</strong> do cliente. Ou a produção correspondente ainda não foi importada,
      ou o pagamento é de outro contexto — vale conferir.</div>
      <div class="painel">
        <div class="painel-cabecalho"><span class="painel-titulo">Repasses sem lastro na produção</span>
          <span class="painel-conta">${r.semProducao.length} admissão(ões)</span></div>
        ${r.semProducao.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
            <th>Admissão</th><th class="num">Linhas de repasse</th><th class="num">Total pago</th>
          </tr></thead><tbody>
          ${r.semProducao.map(sp => `<tr>
            <td class="mono"><strong>${esc(sp.admissao)}</strong></td>
            <td class="num">${sp.nLinhas}</td>
            <td class="num">${fmtR(sp.pago)}</td></tr>`).join('')}
          </tbody></table></div>` :
        `<div class="tabela-vazia">Nenhum — todo pagamento tem produção correspondente. ✓</div>`}
      </div>`;
  }

  // ────────────────────────────────────────────────────────────────────
  function exportarPendencias(r) {
    const lista = filtrarAdmissoes(r);
    const linhas = [[
      'ADMISSÃO', 'DATA', 'PACIENTE', 'HOSPITAL', 'COMPETÊNCIA', 'PROCEDIMENTO', 'PAPEL',
      'PROFISSIONAL', 'FONTE', 'VALOR PRODUÇÃO', 'REGRA', 'ESPERADO', 'PAGO', 'FALTA', 'STATUS',
    ]];
    const hospNome = new Map(App.listarHospitais(cliente.id).map(h => [h.id, h.nome]));
    for (const a of lista) {
      for (const i of a.itens) {
        if (!(i.status === 'NAO_PAGO' || i.status === 'PAGO_A_OUTRO' ||
              i.status === 'A_MENOR' || i.status === 'SEM_REGRA')) continue;
        linhas.push([
          String(a.admissao), Utilidades.dataExibir(i.data), i.paciente || '',
          hospNome.get(i.hospital_id) || '', Utilidades.compExibir(i.competencia),
          i.procedimento, i.papel, i.medico || '', i.fonte,
          i.valorProducao || 0,
          i.regra ? (i.regra.origem === 'BASE' ? 'BASE TABELA' : `PADRÃO INFERIDO (${Math.round((i.regra.confianca || 0) * 100)}%)`) : 'SEM REGRA',
          i.esperado != null ? i.esperado : '', i.pago || 0, i.falta || 0,
          (STATUS_ROTULO[i.status] || i.status) +
            (i.motivo === 'pago_a_outro' && i.pagoA ? ' — pago a ' + i.pagoA : ''),
        ]);
      }
    }
    if (linhas.length === 1) { Utilidades.toast('Nenhuma pendência nos filtros atuais.', 'info'); return; }
    linhas.push([]);
    linhas.push(['', '', '', '', '', '', '', '', '', '', 'TOTAL FALTA:',
      '', '', lista.reduce((s, a) => s + a.falta, 0), '']);
    Utilidades.exportarXLSX(
      `ATLAS_pendencias_${Utilidades.normalizar(cliente.nome).replace(/ /g, '_')}_${st.competencia || 'todas'}.xlsx`,
      [{
        nome: 'Pendências', linhas,
        formatos: { moeda: [9, 11, 12, 13] },
        larguras: [12, 11, 26, 20, 11, 38, 12, 26, 11, 13, 22, 12, 12, 12, 14],
      }]);
    Utilidades.toast('Planilha de pendências exportada.', 'ok');
  }

  render();
};
