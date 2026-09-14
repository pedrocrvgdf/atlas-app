/**
 * ============================================================================
 * TELA: Relatórios (📄)
 *
 * O consolidado POR MÉDICO — o entregável do serviço: quanto cada médico
 * produziu de direito (esperado), quanto recebeu e quanto falta, com o
 * detalhamento das pendências. Exporta em Excel no formato Contábil da casa
 * (R$ visível, número real por baixo).
 * ============================================================================
 */
App.telas['relatorios'] = function () {
  'use strict';
  const el = document.getElementById('conteudo');
  const esc = Utilidades.esc;
  const fmtR = Utilidades.moeda;
  const cliente = App.clienteAtivo();
  if (!cliente) { App.avisoSemCliente(el); return; }

  if (!window.__rel) window.__rel = { hospitalId: 0, competencia: '', medicoAberto: null };
  const st = window.__rel;

  const temDados = (Banco.escalar('SELECT COUNT(*) FROM linhas_producao WHERE cliente_id=?', [cliente.id]) || 0) > 0;

  function render() {
    if (!temDados) {
      el.innerHTML = `
        <div class="tela-cabecalho"><h1 class="tela-titulo">Relatórios</h1>
          <span class="tela-sub">cliente: <strong>${esc(cliente.nome)}</strong></span></div>
        <div class="aviso-caixa">Importe a produção e o repasse em <strong>Importações</strong>
          para gerar o consolidado.</div>`;
      return;
    }

    const hospitais = App.listarHospitais(cliente.id);
    const comps = Motor.listarCompetencias(cliente.id, st.hospitalId);
    const r = Motor.auditar({ clienteId: cliente.id, hospitalId: st.hospitalId, competencia: st.competencia });

    const medicos = [...r.porMedico.values()].sort((a, b) => b.falta - a.falta || b.esperado - a.esperado);

    el.innerHTML = `
      <div class="tela-cabecalho">
        <h1 class="tela-titulo">Relatórios</h1>
        <span class="tela-sub">cliente: <strong>${esc(cliente.nome)}</strong></span>
        <div class="tela-acoes">
          <button class="botao botao-ouro" id="rel-exportar">📤 Exportar consolidado (Excel)</button>
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
      </div>

      <div class="cards">
        <div class="card"><div class="card-rotulo">Esperado (regras)</div>
          <div class="card-valor mono">${fmtR(r.kpis.esperado)}</div></div>
        <div class="card"><div class="card-rotulo">Pago (sistema)</div>
          <div class="card-valor mono">${fmtR(r.kpis.pago)}</div></div>
        <div class="card card-destaque"><div class="card-rotulo">Falta receber</div>
          <div class="card-valor mono">${fmtR(r.kpis.falta)}</div>
          <div class="card-extra">${medicos.filter(m => m.falta > 0.05).length} médico(s) com pendência</div></div>
      </div>

      <div class="painel">
        <div class="painel-cabecalho">
          <span class="painel-titulo">Consolidado por médico</span>
          <span class="painel-conta">${medicos.length} profissional(is) · clique para ver as pendências</span>
        </div>
        ${medicos.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
            <th>Médico</th><th class="num">Itens</th><th class="num">Esperado</th>
            <th class="num">Pago</th><th class="num">Falta receber</th><th class="num">Pendências</th>
          </tr></thead><tbody>
          ${medicos.map((m, i) => `
            <tr class="clique" data-med="${i}">
              <td><strong>${esc(m.medico)}</strong></td>
              <td class="num">${m.nItens}</td>
              <td class="num">${fmtR(m.esperado)}</td>
              <td class="num">${fmtR(m.pago)}</td>
              <td class="num ${m.falta > 0.05 ? 'texto-erro' : 'texto-ok'}">${fmtR(m.falta)}</td>
              <td class="num">${m.nPendencias || '—'}</td>
            </tr>
            ${st.medicoAberto === i ? `<tr><td colspan="6" style="background:#fbfaf6;padding:14px 18px">
              ${detalheMedico(m)}</td></tr>` : ''}`).join('')}
          </tbody></table></div>` :
        `<div class="tabela-vazia">Sem dados para os filtros atuais.</div>`}
      </div>`;

    el.querySelector('#f-hosp').addEventListener('change', e => { st.hospitalId = Number(e.target.value); st.medicoAberto = null; render(); });
    el.querySelector('#f-comp').addEventListener('change', e => { st.competencia = e.target.value; st.medicoAberto = null; render(); });
    el.querySelector('#rel-exportar').addEventListener('click', () => exportar(r, medicos));
    el.querySelectorAll('[data-med]').forEach(tr => tr.addEventListener('click', () => {
      const i = Number(tr.dataset.med);
      st.medicoAberto = st.medicoAberto === i ? null : i;
      render();
    }));
  }

  function detalheMedico(m) {
    if (!m.itensPendentes.length) {
      return '<span class="texto-ok">Sem pendências — tudo pago dentro da tolerância. ✓</span>';
    }
    return `<div class="raiox-rotulo">Pendências de ${esc(m.medico)}</div>
      <div class="rolagem-x"><table class="tabela"><thead><tr>
        <th>Admissão</th><th>Data</th><th>Procedimento</th><th>Papel</th><th>Fonte</th>
        <th class="num">Esperado</th><th class="num">Pago</th><th class="num">Falta</th>
      </tr></thead><tbody>
      ${m.itensPendentes.map(i => `<tr>
        <td class="mono">${esc(i.admissao)}</td>
        <td>${Utilidades.dataExibir(i.data)}</td>
        <td>${esc(i.procedimento)}</td><td>${esc(i.papel)}</td><td>${esc(i.fonte)}</td>
        <td class="num">${fmtR(i.esperado || 0)}</td>
        <td class="num">${fmtR(i.pago || 0)}</td>
        <td class="num texto-erro">${fmtR(i.falta || 0)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function exportar(r, medicos) {
    const compTxt = st.competencia ? Utilidades.compExibir(st.competencia) : 'todas as competências';

    const abaConsolidado = [
      ['ATLAS — AUDITORIA DE CONTAS'],
      ['Cliente: ' + cliente.nome, '', 'Competência: ' + compTxt, '', 'Gerado em: ' + new Date().toLocaleString('pt-BR')],
      [],
      ['MÉDICO', 'ITENS', 'ESPERADO', 'PAGO', 'FALTA RECEBER', 'PENDÊNCIAS'],
      ...medicos.map(m => [m.medico, m.nItens, m.esperado, m.pago, m.falta, m.nPendencias]),
      [],
      ['TOTAL', '', r.kpis.esperado, r.kpis.pago, r.kpis.falta, ''],
    ];

    const abaDetalhe = [[
      'MÉDICO', 'ADMISSÃO', 'DATA', 'PACIENTE', 'PROCEDIMENTO', 'PAPEL', 'FONTE',
      'ESPERADO', 'PAGO', 'FALTA', 'STATUS',
    ]];
    for (const m of medicos) {
      for (const i of m.itensPendentes) {
        abaDetalhe.push([m.medico, String(i.admissao), Utilidades.dataExibir(i.data),
          i.paciente || '', i.procedimento, i.papel, i.fonte,
          i.esperado || 0, i.pago || 0, i.falta || 0, i.status]);
      }
    }

    Utilidades.exportarXLSX(
      `ATLAS_consolidado_${Utilidades.normalizar(cliente.nome).replace(/ /g, '_')}_${st.competencia || 'todas'}.xlsx`,
      [
        { nome: 'Consolidado', linhas: abaConsolidado, formatos: { moeda: [2, 3, 4] }, linhaIni: 4,
          larguras: [34, 8, 14, 14, 14, 12] },
        { nome: 'Pendências', linhas: abaDetalhe, formatos: { moeda: [7, 8, 9] },
          larguras: [30, 12, 11, 26, 38, 12, 11, 12, 12, 12, 14] },
      ]);
    Utilidades.toast('Consolidado exportado.', 'ok');
  }

  render();
};
