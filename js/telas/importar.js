/**
 * ============================================================================
 * TELA: Importações (📥)
 *
 * PRODUÇÃO — importação AUTOMÁTICA (a forma da ferramenta de origem):
 *   um pop-up pergunta se o arquivo é do ANO INTEIRO ou de UM MÊS (e qual);
 *   escolheu o arquivo, importou. A ATLAS acha o cabeçalho ("Cód. Admissão"),
 *   reconhece as colunas pelo layout do relatório analítico, deriva a
 *   competência de cada linha pela data, sobrescreve os meses presentes e
 *   mostra o resumo. O mapeamento manual só aparece se ela NÃO reconhecer
 *   admissão/data (layout desconhecido) — e o que o usuário apontar fica
 *   salvo por hospital para as próximas.
 *   Abaixo, a PRODUÇÃO IMPORTADA por competência (agrupada por ano) com
 *   quantidade, admissões, valor, "importada em", Atualizar (relançar o mês)
 *   e Excluir — e um filtro "contém" por admissão / paciente / data / produto.
 *
 * SISTEMA, MÉDICO e BASE TABELA — fluxo em 2 etapas:
 *   1. Escolher hospital + tipo + arquivo
 *   2. Conferir o MAPEAMENTO DE COLUNAS sugerido (aliases; perfis salvos do
 *      hospital são reaplicados) e gravar, com opção de SUBSTITUIR.
 * ============================================================================
 */
App.telas['importar'] = function () {
  'use strict';
  const el = document.getElementById('conteudo');
  const esc = Utilidades.esc;
  const fmtR = Utilidades.moeda;
  const n = (x) => (Number(x) || 0).toLocaleString('pt-BR');
  const cliente = App.clienteAtivo();
  if (!cliente) { App.avisoSemCliente(el); return; }

  if (!window.__imp) {
    window.__imp = { etapa: 1, hospitalId: 0, tipo: 'PRODUCAO', competencia: '', arq: null,
      alvo: '', escopo: null, filtro: { aberto: false, adm: '', pac: '', data: '', prod: '' }, anosAbertos: null };
  }
  const st = window.__imp;
  if (!st.filtro) st.filtro = { aberto: false, adm: '', pac: '', data: '', prod: '' };
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto',
    'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  // Os ids internos ficam (perfis e histórico já gravados); os NOMES são os
  // do produto: SISTEMA (relatório cru do sistema do hospital), PRODUÇÃO
  // (tudo que foi produzido) e MÉDICO (o que ele de fato recebeu).
  const TIPOS = [
    ['REPASSE', 'Sistema — relatório cru do sistema do hospital'],
    ['PRODUCAO', 'Produção — tudo que foi produzido na competência'],
    ['MEDICO', 'Médico — o relatório que o médico de fato recebeu'],
    ['BASE_TABELA', 'Base Tabela — regras de repasse'],
  ];
  const TIPO_ROTULO = { REPASSE: 'SISTEMA', PRODUCAO: 'PRODUÇÃO', MEDICO: 'MÉDICO', BASE_TABELA: 'BASE TABELA' };

  // célula legível na prévia (Date do SheetJS vira dd/mm/aaaa, não "Tue Jan 06 2026…")
  const celTxt = (c) => c instanceof Date ? Utilidades.dataExibir(Utilidades.paraDataISO(c)) : String(c == null ? '' : c);
  const compsTxt = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean)
    .map(Utilidades.compExibir).join(', ') || '—';
  const quando = (iso) => (iso || '').slice(0, 16).replace('T', ' ') || '—';
  const respirar = () => new Promise(r => setTimeout(r, 30));

  function render() {
    const hospitais = App.listarHospitais(cliente.id);
    if (!hospitais.length) {
      el.innerHTML = `
        <div class="tela-cabecalho"><h1 class="tela-titulo">Importações</h1></div>
        <div class="aviso-caixa">O cliente <strong>${esc(cliente.nome)}</strong> ainda não tem
        hospital cadastrado. Cadastre em <strong>Clientes</strong> para importar os relatórios.</div>`;
      return;
    }
    if (!st.hospitalId || !hospitais.some(h => h.id === st.hospitalId)) st.hospitalId = hospitais[0].id;

    el.innerHTML = `
      <div class="tela-cabecalho">
        <h1 class="tela-titulo">Importações</h1>
        <span class="tela-sub">cliente: <strong>${esc(cliente.nome)}</strong></span>
      </div>
      <div id="imp-area"></div>
      <div id="imp-prod"></div>
      <div id="imp-lista"></div>`;

    if (st.etapa === 2 && st.arq) renderMapeamento(hospitais);
    else renderEscolha(hospitais);
    renderProducao(hospitais);
    renderLista();
  }

  // ────────────────────────────────────────────────────────────────────
  // ETAPA 1 — escolher hospital, tipo e arquivo
  // ────────────────────────────────────────────────────────────────────
  function renderEscolha(hospitais) {
    const area = el.querySelector('#imp-area');
    const comComp = st.tipo === 'REPASSE' || st.tipo === 'MEDICO';
    area.innerHTML = `
      <div class="painel">
        <div class="painel-cabecalho"><span class="painel-titulo">Nova importação</span></div>
        <div class="painel-corpo">
          <div class="linha-campos">
            <div class="campo"><span class="campo-rotulo">Hospital / clínica</span>
              <select id="imp-hosp">${hospitais.map(h =>
                `<option value="${h.id}" ${h.id === st.hospitalId ? 'selected' : ''}>${esc(h.nome)}</option>`).join('')}
              </select></div>
            <div class="campo"><span class="campo-rotulo">Tipo de relatório</span>
              <select id="imp-tipo">${TIPOS.map(([v, r]) =>
                `<option value="${v}" ${v === st.tipo ? 'selected' : ''}>${r}</option>`).join('')}
              </select></div>
            <div class="campo" id="imp-comp-box" style="max-width:170px; ${comComp ? '' : 'display:none'}">
              <span class="campo-rotulo">Mês do pagamento</span>
              <input type="month" id="imp-comp" value="${esc(st.competencia)}"></div>
            ${st.tipo === 'PRODUCAO'
              ? `<div class="campo"><span class="campo-rotulo">Arquivo (.xlsx / .xls / .csv)</span>
                  <button class="botao botao-ouro" id="imp-prod-abrir">📥 Importar produção…</button></div>`
              : `<div class="campo"><span class="campo-rotulo">Arquivo (.xlsx / .xls / .csv)</span>
                  <input type="file" id="imp-arquivo" accept=".xlsx,.xls,.csv"></div>`}
          </div>
          <div class="info-caixa" id="imp-ajuda" style="margin-top:12px">${ajudaTipo(st.tipo)}</div>
        </div>
      </div>`;

    area.querySelector('#imp-hosp').addEventListener('change', e => { st.hospitalId = Number(e.target.value); });
    area.querySelector('#imp-tipo').addEventListener('change', e => {
      st.tipo = e.target.value;
      renderEscolha(hospitais);   // o controle de arquivo muda conforme o tipo
    });
    area.querySelector('#imp-comp').addEventListener('change', e => { st.competencia = e.target.value; });

    const abrir = area.querySelector('#imp-prod-abrir');
    if (abrir) abrir.addEventListener('click', () => abrirEscopoProducao({ hospitalId: st.hospitalId, alvo: '' }));

    const inpArquivo = area.querySelector('#imp-arquivo');
    if (inpArquivo) inpArquivo.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      if (st.tipo === 'REPASSE' && !area.querySelector('#imp-comp').value) {
        Utilidades.toast('Informe o MÊS DO PAGAMENTO antes de escolher o arquivo do sistema.', 'aviso', 4200);
        e.target.value = '';
        return;
      }
      st.competencia = area.querySelector('#imp-comp').value || '';
      try {
        Utilidades.loading.mostrar('Lendo a planilha…');
        const buf = await f.arrayBuffer();
        const { matriz, nomeAba } = Importador.lerPlanilha(buf);
        if (st.tipo === 'MEDICO' && !st.competencia) {
          st.competencia = Importador.detectarCompetenciaRelatorio(matriz);
          if (!st.competencia) {
            Utilidades.toast('Não achei a competência no cabeçalho — informe o MÊS DO PAGAMENTO e escolha o arquivo de novo.', 'aviso', 5000);
            e.target.value = '';
            return;
          }
        }
        const linhaCab = Importador.detectarCabecalho(matriz, st.tipo);
        const cab = (matriz[linhaCab] || []).map(c => String(c));

        // perfil salvo do hospital × tipo tem prioridade sobre a sugestão
        const perfil = Importador.perfilLer(st.hospitalId, st.tipo);
        let map = perfil ? Importador.aplicarPerfil(perfil, cab) : {};
        if (!Object.keys(map).length) map = Importador.sugerirMapeamento(cab, st.tipo);

        st.arq = { nome: f.name, matriz, nomeAba, linhaCab, map, usouPerfil: !!perfil && Object.keys(map).length > 0 };
        st.etapa = 2;
        render();
      } catch (err) {
        console.error(err);
        Utilidades.toast('Não consegui ler o arquivo: ' + (err.message || err), 'erro', 5000);
      } finally {
        Utilidades.loading.esconder();
      }
    });
  }

  function ajudaTipo(tipo) {
    if (tipo === 'PRODUCAO') {
      return `<strong>Produção</strong> = tudo que foi produzido (admissão, procedimentos, profissionais
        por papel, valores). Clique em importar, diga se o arquivo é do <strong>ano inteiro</strong> ou
        de <strong>um mês</strong> e escolha o arquivo: a ATLAS acha o cabeçalho (<em>Cód. Admissão</em>),
        reconhece as colunas, deriva a competência pela data de cada linha e importa o relatório
        <strong>na íntegra</strong>. Reimportar um mês já existente <strong>sobrescreve</strong> os dados
        daquela competência (não duplica).`;
    }
    if (tipo === 'REPASSE') {
      return `<strong>Sistema</strong> = o relatório cru que sai do sistema do hospital (o que ele diz
        que processou/pagou — não necessariamente o que chegou ao médico). Informe o mês do
        pagamento; a ATLAS sugere o mapeamento das colunas e guarda o perfil do hospital.`;
    }
    if (tipo === 'MEDICO') {
      return `<strong>Médico</strong> = o demonstrativo que o médico de fato recebeu para emitir a
        nota (também importável direto na Inspeção, que já monta a pauta). A competência é lida
        do cabeçalho do relatório quando existe.`;
    }
    return `<strong>Base Tabela</strong> = regras de repasse do hospital (procedimento × papel × fonte
      → valor fixo ou %), quando ele fornece. Sem ela, o motor infere o padrão pelo histórico.`;
  }

  // ────────────────────────────────────────────────────────────────────
  // PRODUÇÃO — automático
  // ────────────────────────────────────────────────────────────────────

  /**
   * Pop-up antes do arquivo: o relatório é do ANO INTEIRO ou de UM MÊS, e
   * de qual ano (e mês). É o período que o arquivo cobre — só as linhas
   * dele entram e só os meses que vierem nele são sobrescritos.
   * opts: { hospitalId, alvo } (alvo = competência do botão Atualizar)
   */
  function abrirEscopoProducao(opts) {
    const hospitais = App.listarHospitais(cliente.id);
    const hospitalId = opts.hospitalId || st.hospitalId;
    const hosp = hospitais.find(h => h.id === hospitalId);
    const hoje = new Date();
    const anoAtual = hoje.getFullYear();
    const anosBase = Banco.query(
      `SELECT DISTINCT substr(competencia, 1, 4) AS ano FROM linhas_producao WHERE cliente_id = ?`, [cliente.id])
      .map(r => String(r.ano || '')).filter(a => /^\d{4}$/.test(a));
    const anos = [...new Set([String(anoAtual + 1), ...Array.from({ length: 8 }, (_, i) => String(anoAtual - i)), ...anosBase])]
      .sort().reverse();
    const pre = st.escopo || {};
    const sel = {
      tipo: opts.alvo ? 'MES' : (pre.tipo === 'MES' ? 'MES' : 'ANO'),
      ano: opts.alvo ? opts.alvo.slice(0, 4) : (pre.ano || String(anoAtual)),
      mes: opts.alvo ? opts.alvo.slice(5, 7) : (pre.mes || String(hoje.getMonth() + 1).padStart(2, '0')),
    };
    const ov = document.createElement('div');
    ov.className = 'modal-fundo';
    ov.innerHTML = `
      <div class="modal" style="width:560px;max-width:95vw">
        <div class="modal-cabecalho">
          <span class="modal-titulo">📥 Importar produção</span>
          <button class="modal-fechar">✕</button>
        </div>
        <div class="modal-corpo">
          <div class="info-caixa">Hospital: <strong>${esc(hosp ? hosp.nome : '')}</strong>. Diga o que o arquivo cobre —
            a ATLAS só aceita as linhas desse período e sobrescreve os meses que vierem nele.</div>
          <div class="raiox-rotulo" style="margin-top:14px">Esta importação é de</div>
          <div class="imp-escopo">
            <label class="imp-opcao ${sel.tipo === 'ANO' ? 'ativa' : ''}" data-escopo="ANO">
              <input type="radio" name="imp-escopo" value="ANO" ${sel.tipo === 'ANO' ? 'checked' : ''}>
              <div><strong>Ano inteiro</strong><span>o relatório traz todos os meses do ano (ou o ano até aqui)</span></div>
            </label>
            <label class="imp-opcao ${sel.tipo === 'MES' ? 'ativa' : ''}" data-escopo="MES">
              <input type="radio" name="imp-escopo" value="MES" ${sel.tipo === 'MES' ? 'checked' : ''}>
              <div><strong>Um mês</strong><span>o relatório traz só a competência escolhida</span></div>
            </label>
          </div>
          <div class="linha-campos" style="margin-top:14px">
            <div class="campo" style="max-width:150px"><span class="campo-rotulo">Ano</span>
              <select id="imp-esc-ano">${anos.map(a => `<option value="${a}" ${a === sel.ano ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
            <div class="campo" id="imp-esc-mes-box" style="max-width:190px;${sel.tipo === 'MES' ? '' : 'display:none'}">
              <span class="campo-rotulo">Mês</span>
              <select id="imp-esc-mes">${MESES.map((nome, i) => { const v = String(i + 1).padStart(2, '0');
                return `<option value="${v}" ${v === sel.mes ? 'selected' : ''}>${nome}</option>`; }).join('')}</select></div>
          </div>
          ${opts.alvo ? `<div class="aviso-caixa" style="margin-top:12px">Atualizando <strong>${esc(Utilidades.compExibir(opts.alvo))}</strong>:
            o arquivo novo sobrescreve a produção desse mês.</div>` : ''}
        </div>
        <div class="modal-rodape">
          <button class="botao" id="imp-esc-cancelar">Cancelar</button>
          <button class="botao botao-ouro" id="imp-esc-escolher">Escolher o arquivo…</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const fechar = () => ov.remove();
    ov.querySelector('.modal-fechar').addEventListener('click', fechar);
    ov.querySelector('#imp-esc-cancelar').addEventListener('click', fechar);
    ov.querySelectorAll('input[name="imp-escopo"]').forEach(r => r.addEventListener('change', () => {
      sel.tipo = r.value;
      ov.querySelectorAll('.imp-opcao').forEach(l => l.classList.toggle('ativa', l.dataset.escopo === sel.tipo));
      ov.querySelector('#imp-esc-mes-box').style.display = sel.tipo === 'MES' ? '' : 'none';
    }));
    ov.querySelector('#imp-esc-escolher').addEventListener('click', () => {
      sel.ano = ov.querySelector('#imp-esc-ano').value;
      sel.mes = ov.querySelector('#imp-esc-mes').value;
      st.escopo = { tipo: sel.tipo, ano: sel.ano, mes: sel.tipo === 'MES' ? sel.mes : '' };
      st.hospitalId = hospitalId; st.tipo = 'PRODUCAO'; st.alvo = opts.alvo || '';
      fechar();
      const inp = el.querySelector('#imp-arquivo-prod');
      if (inp) inp.click();
    });
  }

  async function importarProducaoArquivo(f) {
    const alvo = st.alvo || '';
    let lido = null;
    try {
      Utilidades.loading.mostrar('Lendo a planilha…');
      await respirar();
      lido = Importador.lerPlanilha(await f.arrayBuffer());
      Utilidades.loading.mostrar('Importando a produção…');
      await respirar();
      const r = Importador.importarProducao({
        matriz: lido.matriz, clienteId: cliente.id, hospitalId: st.hospitalId, arquivo: f.name,
        substituir: true, perfil: Importador.perfilLer(st.hospitalId, 'PRODUCAO'), escopo: st.escopo,
      });
      Banco.salvarDebounced();
      st.alvo = ''; st.arq = null; st.etapa = 1;
      render();
      resumoProducao(r, f.name, alvo);
    } catch (err) {
      if (err && err.precisaMapear && lido) {
        // layout desconhecido: cai no mapeamento manual já com o que foi reconhecido
        st.arq = { nome: f.name, matriz: lido.matriz, nomeAba: lido.nomeAba, linhaCab: err.linhaCab,
          map: Importador.nucleoDoMapa(err.map), usouPerfil: false, aviso: err.message };
        st.etapa = 2;
        render();
        Utilidades.toast(err.message, 'aviso', 5200);
        return;
      }
      console.error(err);
      Utilidades.toast('Importação falhou: ' + (err.message || err), 'erro', 6000);
    } finally {
      Utilidades.loading.esconder();
    }
  }

  /** Resumo da importação (o que a ferramenta de origem mostra num alert). */
  function resumoProducao(r, nome, alvo) {
    const comps = r.competencias.map(Utilidades.compExibir).join(', ');
    const ignoradas = r.vazias + r.semData + r.semAdmissao;
    const ov = document.createElement('div');
    ov.className = 'modal-fundo';
    ov.innerHTML = `
      <div class="modal" style="width:680px;max-width:95vw">
        <div class="modal-cabecalho">
          <span class="modal-titulo">✓ Produção importada</span>
          <button class="modal-fechar">✕</button>
        </div>
        <div class="modal-corpo">
          <div class="info-caixa"><strong>${esc(nome)}</strong> · cabeçalho na linha ${r.linhaCab + 1}
            ${r.escopo ? `· período declarado: <strong>${esc(r.rotuloEscopo)}</strong>` : ''}
            · competência(s) importada(s): <strong>${esc(comps || '—')}</strong></div>
          <div class="cards" style="margin:12px 0">
            <div class="card"><div class="card-rotulo">Linhas lidas</div><div class="card-valor">${n(r.linhasLidas)}</div></div>
            <div class="card card-ok"><div class="card-rotulo">Importadas</div><div class="card-valor">${n(r.inseridas)}</div></div>
            <div class="card"><div class="card-rotulo">Ignoradas</div><div class="card-valor">${n(ignoradas)}</div>
              <div class="card-extra">${n(r.vazias)} vazias · ${n(r.semData)} sem data · ${n(r.semAdmissao)} sem admissão${r.escopo ? ` · ${n(r.foraDoEscopo)} fora do período` : ''}</div></div>
            <div class="card"><div class="card-rotulo">Admissões únicas</div><div class="card-valor">${n(r.admissoes)}</div></div>
            <div class="card"><div class="card-rotulo">Quantidade (soma)</div><div class="card-valor">${n(r.totalQuantidade)}</div></div>
            <div class="card card-destaque"><div class="card-rotulo">Valor produzido</div><div class="card-valor">${fmtR(r.totalValor)}</div></div>
          </div>
          ${r.truncado ? `<div class="aviso-caixa" style="margin-bottom:12px;border-color:#e5c4c4;background:#fdf3f3">
            <strong>⚠ Arquivo cortado no limite de exportação.</strong> ${r.truncado.motivo === 'nota'
              ? `O próprio arquivo avisa: <em>${esc(r.truncado.nota)}</em>.`
              : `Ele tem exatamente ${n(r.truncado.limite)} linhas de dados — é o teto de exportação do Power BI.`}
            O relatório tinha mais linhas do que isso e elas <strong>não vieram</strong>: o total deste período não vai fechar
            com o sistema. Exporte em períodos menores (mês a mês) e importe cada um como <strong>"Um mês"</strong>.</div>` : ''}
          ${r.porCompetencia && r.porCompetencia.length ? `<div class="rolagem-x" style="margin-bottom:12px"><table class="tabela"><thead><tr>
              <th>Competência</th><th class="num">Linhas</th><th class="num">Quantidade</th><th class="num">Valor produzido</th>
            </tr></thead><tbody>
            ${r.porCompetencia.map(c => `<tr><td class="mono">${esc(Utilidades.compExibir(c.competencia))}</td>
              <td class="num mono">${n(c.linhas)}</td><td class="num mono">${n(c.quantidade)}</td><td class="num mono">${fmtR(c.valor)}</td></tr>`).join('')}
            </tbody></table></div>
            <div class="texto-cinza" style="font-size:11.5px;margin-bottom:10px">Para conferir no Excel, some a coluna <em>Valor R$</em> só nas
              linhas de dados (uma linha de totais colada no fim do arquivo não entra e pode vir do relatório completo, não do exportado).</div>` : ''}
          <div style="font-size:12px">Colunas reconhecidas: <strong>${r.reconhecidas}</strong>${r.naoReconhecidas.length
            ? ` · fora do layout (ficaram de fora): ${esc(r.naoReconhecidas.join(', '))}`
            : ' · todas as colunas do arquivo foram guardadas'}.</div>
          ${r.escopo && r.foraDoEscopo ? `<div class="aviso-caixa" style="margin-top:10px">⚠ ${n(r.foraDoEscopo)} linha(s) com data fora de
            ${esc(r.rotuloEscopo)} ficaram de fora — se o arquivo era de outro período, importe de novo com o período certo.</div>` : ''}
          ${r.mantidas && r.mantidas.length ? `<div class="info-caixa" style="margin-top:10px">Meses de ${esc(r.escopo.ano)} que já estavam na base e
            não vieram no arquivo foram mantidos: ${esc(r.mantidas.map(Utilidades.compExibir).join(', '))}.</div>` : ''}
          ${r.competencias.length > 1 ? `<div class="aviso-caixa" style="margin-top:10px">⚠ O arquivo trazia
            ${r.competencias.length} meses — todos foram importados (cada um sobrescreveu o que já existia).</div>` : ''}
          ${alvo && !r.competencias.includes(alvo) ? `<div class="aviso-caixa" style="margin-top:10px">⚠ Você pediu
            para atualizar ${esc(Utilidades.compExibir(alvo))}, mas o arquivo é de ${esc(comps)}.</div>` : ''}
        </div>
        <div class="modal-rodape">
          ${r.importacaoId ? `<button class="botao botao-perigo" id="rp-excluir" style="margin-right:auto"
            title="Desfaz: as linhas que esta importação trouxe saem da base">🗑 Excluir esta importação</button>` : ''}
          <button class="botao botao-marinho" id="rp-ok">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const fechar = () => ov.remove();
    ov.querySelector('.modal-fechar').addEventListener('click', fechar);
    ov.querySelector('#rp-ok').addEventListener('click', fechar);
    const desfazer = ov.querySelector('#rp-excluir');
    if (desfazer) desfazer.addEventListener('click', () => {
      if (!confirm(`Excluir a importação de "${nome}"?\n\nAs ${n(r.inseridas)} linhas que ela trouxe saem da base` +
        ` (${comps || '—'}). O que existia antes nessas competências já foi sobrescrito e não volta.`)) return;
      excluirImportacao(r.importacaoId);
      fechar();
      Utilidades.toast('Importação excluída.', 'ok');
      render();
    });
  }

  /** Apaga uma importação e TODAS as linhas que ela trouxe (qualquer tipo). */
  function excluirImportacao(id) {
    Banco.transacao(() => {
      Banco.executar('DELETE FROM linhas_producao WHERE importacao_id = ?', [id]);
      Banco.executar('DELETE FROM linhas_repasse WHERE importacao_id = ?', [id]);
      Banco.executar('DELETE FROM linhas_medico WHERE importacao_id = ?', [id]);
      Banco.executar('DELETE FROM importacoes WHERE id = ?', [id]);
    });
    Banco.salvarDebounced();
  }

  /** Painel "Produção importada": competências por ano + filtro "contém". */
  function renderProducao(hospitais) {
    const box = el.querySelector('#imp-prod');
    const rows = Banco.query(
      `SELECT lp.hospital_id, h.nome AS hospital, lp.competencia,
              SUM(COALESCE(lp.quantidade, 0)) AS qtd, COUNT(DISTINCT lp.admissao) AS adms,
              SUM(COALESCE(lp.valor, 0)) AS valor, MAX(i.importada_em) AS importada_em
         FROM linhas_producao lp
         JOIN hospitais h ON h.id = lp.hospital_id
         LEFT JOIN importacoes i ON i.id = lp.importacao_id
        WHERE lp.cliente_id = ?
        GROUP BY lp.hospital_id, lp.competencia
        ORDER BY lp.competencia DESC, h.nome`, [cliente.id]);
    const multiHosp = hospitais.length > 1;

    const grupos = [];
    for (const r of rows) {
      const ano = String(r.competencia || '').slice(0, 4) || '—';
      let g = grupos.find(x => x.ano === ano);
      if (!g) grupos.push(g = { ano, comps: [], qtd: 0, adms: 0, valor: 0 });
      g.comps.push(r);
      g.qtd += Number(r.qtd) || 0; g.adms += Number(r.adms) || 0; g.valor += Number(r.valor) || 0;
    }
    const nMeses = (g) => new Set(g.comps.map(c => c.competencia)).size;
    if (!(st.anosAbertos instanceof Set)) st.anosAbertos = new Set(grupos.length ? [grupos[0].ano] : []);
    const abertos = st.anosAbertos;
    const totalValor = rows.reduce((a, r) => a + (Number(r.valor) || 0), 0);

    // filtro "contém"
    const flt = st.filtro;
    const temFiltro = !!(flt.adm || flt.pac || flt.data || flt.prod);
    let resultados = [], totalRes = 0;
    if (temFiltro) {
      const where = ['lp.cliente_id = ?'], params = [cliente.id];
      const like = (col, v) => { where.push(`${col} LIKE ?`); params.push('%' + v.trim() + '%'); };
      if (flt.adm) like('lp.admissao', flt.adm);
      if (flt.pac) like('lp.paciente', flt.pac);
      if (flt.prod) { where.push('(lp.procedimento LIKE ? OR lp.procedimento_principal LIKE ?)');
        params.push('%' + flt.prod.trim() + '%', '%' + flt.prod.trim() + '%'); }
      if (flt.data) {
        // aceita 14/07/2026, 14/07 ou o ISO do banco
        const m = flt.data.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
        like('lp.data', m ? `${m[3] || ''}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : flt.data.trim());
      }
      const sql = where.join(' AND ');
      totalRes = Banco.escalar(`SELECT COUNT(*) FROM linhas_producao lp WHERE ${sql}`, params) || 0;
      resultados = Banco.query(
        `SELECT lp.competencia, lp.admissao, lp.data, lp.paciente, lp.procedimento, lp.valor, h.nome AS hospital
           FROM linhas_producao lp JOIN hospitais h ON h.id = lp.hospital_id
          WHERE ${sql} ORDER BY lp.competencia DESC, lp.admissao LIMIT 300`, params);
    }

    const campoFiltro = (k, rot, ph) => `
      <div class="campo"><span class="campo-rotulo">${rot}</span>
        <input type="text" data-fprod="${k}" value="${esc(flt[k] || '')}" placeholder="${ph}"></div>`;

    box.innerHTML = `
      <div class="painel">
        <div class="painel-cabecalho">
          <span class="painel-titulo">Produção importada</span>
          <span class="painel-conta">${rows.length} competência(s) · ${fmtR(totalValor)} produzidos</span>
          <div class="painel-acoes">
            <button class="botao botao-mini ${flt.aberto || temFiltro ? 'botao-marinho' : ''}" id="prod-filtro">⛛ Filtro${temFiltro ? ' ●' : ''}</button>
            <input type="file" id="imp-arquivo-prod" accept=".xlsx,.xls,.csv" style="display:none">
          </div>
        </div>
        ${flt.aberto ? `<div class="painel-corpo" style="border-bottom:1px solid var(--borda-suave)">
          <div class="linha-campos">
            ${campoFiltro('adm', 'Admissão', 'contém…')}${campoFiltro('pac', 'Nome do paciente', 'contém…')}
            ${campoFiltro('data', 'Data', '14/07/2026 ou 2026-07-14')}${campoFiltro('prod', 'Produto', 'contém…')}
          </div>
          ${temFiltro ? `<div style="margin-top:8px;display:flex;gap:10px;align-items:center;font-size:12px">
            <span><strong>${n(totalRes)}</strong> linha(s) encontrada(s)${totalRes > 300 ? ' · mostrando as 300 primeiras' : ''}</span>
            <button class="botao botao-mini" id="prod-filtro-limpar">✕ Limpar filtro</button></div>` : ''}
        </div>` : ''}
        ${temFiltro ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
            <th>Competência</th>${multiHosp ? '<th>Hospital</th>' : ''}<th>Admissão</th><th>Data</th><th>Paciente</th><th>Produto</th><th class="num">Valor</th>
          </tr></thead><tbody>
          ${resultados.length ? resultados.map(r => `<tr>
            <td class="mono">${esc(Utilidades.compExibir(r.competencia))}</td>${multiHosp ? `<td>${esc(r.hospital)}</td>` : ''}
            <td class="mono">${esc(r.admissao || '—')}</td><td>${esc(Utilidades.dataExibir(r.data))}</td>
            <td>${esc(r.paciente || '—')}</td><td>${esc(r.procedimento || '—')}</td>
            <td class="num mono">${fmtR(r.valor)}</td></tr>`).join('')
          : `<tr><td colspan="7" class="tabela-vazia">Nenhuma linha da produção casa com o filtro.</td></tr>`}
          </tbody></table></div>` : ''}
        ${rows.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
            <th>Competência</th>${multiHosp ? '<th>Hospital</th>' : ''}
            <th class="num" title="soma da coluna Quantidade">Quantidade</th><th class="num">Admissões</th>
            <th class="num">Valor produzido</th><th>Importada em</th><th></th>
          </tr></thead><tbody>
          ${grupos.map(g => `
            <tr class="imp-ano clique" data-ano="${esc(g.ano)}" title="${abertos.has(g.ano) ? 'Recolher' : 'Expandir'} os meses de ${esc(g.ano)}">
              <td colspan="${multiHosp ? 2 : 1}"><strong>${abertos.has(g.ano) ? '▾' : '▸'} ${esc(g.ano)}</strong>
                <span class="texto-cinza">(${nMeses(g)} ${nMeses(g) === 1 ? 'mês' : 'meses'})</span></td>
              <td class="num mono">${n(g.qtd)}</td><td class="num mono">${n(g.adms)}</td>
              <td class="num mono"><strong>${fmtR(g.valor)}</strong></td><td></td>
              <td style="text-align:right;white-space:nowrap"><button class="botao botao-mini botao-perigo" data-excluir-ano="${esc(g.ano)}"
                title="Excluir toda a produção de ${esc(g.ano)}${multiHosp ? ' (todos os hospitais do cliente)' : ''}">Excluir ano</button></td>
            </tr>
            ${abertos.has(g.ano) ? g.comps.map(c => `<tr class="imp-mes">
              <td class="mono" style="padding-left:28px">${esc(Utilidades.compExibir(c.competencia))}</td>
              ${multiHosp ? `<td>${esc(c.hospital)}</td>` : ''}
              <td class="num mono">${n(c.qtd)}</td><td class="num mono">${n(c.adms)}</td>
              <td class="num mono"><strong>${fmtR(c.valor)}</strong></td>
              <td class="texto-cinza" style="font-size:11px">${esc(quando(c.importada_em))}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="botao botao-mini" data-atualizar="${esc(c.competencia)}" data-hosp="${c.hospital_id}"
                  title="Lançar um relatório ATUALIZADO deste mês (sobrescreve a produção da competência)">↻ Atualizar</button>
                <button class="botao botao-mini botao-perigo" data-excluir="${esc(c.competencia)}" data-hosp="${c.hospital_id}">Excluir</button>
              </td>
            </tr>`).join('') : ''}`).join('')}
          </tbody></table></div>`
        : `<div class="tabela-vazia">Nenhuma produção importada ainda — escolha o tipo <strong>Produção</strong> acima e o arquivo.</div>`}
      </div>`;

    // handlers
    box.querySelectorAll('.imp-ano').forEach(tr => tr.addEventListener('click', () => {
      const ano = tr.dataset.ano;
      if (abertos.has(ano)) abertos.delete(ano); else abertos.add(ano);
      renderProducao(hospitais);
    }));
    box.querySelector('#prod-filtro').addEventListener('click', () => { flt.aberto = !flt.aberto; renderProducao(hospitais); });
    const limpar = box.querySelector('#prod-filtro-limpar');
    if (limpar) limpar.addEventListener('click', () => {
      Object.assign(flt, { adm: '', pac: '', data: '', prod: '' }); renderProducao(hospitais);
    });
    let tmr = null;
    box.querySelectorAll('[data-fprod]').forEach(inp => inp.addEventListener('input', () => {
      clearTimeout(tmr);
      tmr = setTimeout(() => {
        const k = inp.dataset.fprod, pos = inp.selectionStart;
        flt[k] = inp.value;
        renderProducao(hospitais);
        const novo = box.querySelector(`[data-fprod="${k}"]`);
        if (novo) { novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (_) { /* campo sem seleção */ } }
      }, 300);
    }));
    const upload = box.querySelector('#imp-arquivo-prod');
    box.querySelectorAll('[data-atualizar]').forEach(b => b.addEventListener('click', () => {
      abrirEscopoProducao({ hospitalId: Number(b.dataset.hosp), alvo: b.dataset.atualizar });
    }));
    upload.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      await importarProducaoArquivo(f);
      e.target.value = '';
    });
    box.querySelectorAll('[data-excluir]').forEach(b => b.addEventListener('click', () => {
      excluirProducao(Number(b.dataset.hosp), b.dataset.excluir);
    }));
    box.querySelectorAll('[data-excluir-ano]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();   // a linha do ano também recolhe/expande no clique
      excluirAno(b.dataset.excluirAno, multiHosp);
    }));
  }

  function excluirAno(ano, multiHosp) {
    const s = Banco.query(
      `SELECT COUNT(*) AS qtd, COALESCE(SUM(valor), 0) AS total, COUNT(DISTINCT competencia) AS meses
         FROM linhas_producao WHERE cliente_id = ? AND competencia LIKE ?`, [cliente.id, ano + '-%'])[0] || { qtd: 0, total: 0, meses: 0 };
    if (!confirm(`Excluir TODA a produção de ${ano}${multiHosp ? ' (todos os hospitais do cliente)' : ''}?\n\n` +
      `Serão removidas ${n(s.qtd)} linhas de ${n(s.meses)} competência(s) (${fmtR(s.total)} produzidos).\n\n` +
      `Não dá para desfazer — para recuperar, reimporte os relatórios.`)) return;
    Banco.transacao(() => {
      Banco.executar('DELETE FROM linhas_producao WHERE cliente_id = ? AND competencia LIKE ?', [cliente.id, ano + '-%']);
      Banco.executar(
        `DELETE FROM importacoes WHERE tipo = 'PRODUCAO' AND cliente_id = ?
           AND NOT EXISTS (SELECT 1 FROM linhas_producao lp WHERE lp.importacao_id = importacoes.id)`, [cliente.id]);
    });
    Banco.salvarDebounced();
    Utilidades.toast(`Produção de ${ano} excluída.`, 'ok');
    render();
  }

  function excluirProducao(hospitalId, comp) {
    const s = Banco.query(
      `SELECT COUNT(*) AS qtd, COALESCE(SUM(valor), 0) AS total FROM linhas_producao WHERE hospital_id = ? AND competencia = ?`,
      [hospitalId, comp])[0] || { qtd: 0, total: 0 };
    if (!confirm(`Excluir TODA a produção de ${Utilidades.compExibir(comp)} deste hospital?\n\n` +
      `Serão removidas ${n(s.qtd)} linhas (${fmtR(s.total)} produzidos).\n\n` +
      `Não dá para desfazer — para recuperar, reimporte o relatório.`)) return;
    Banco.transacao(() => {
      Banco.executar('DELETE FROM linhas_producao WHERE hospital_id = ? AND competencia = ?', [hospitalId, comp]);
      Banco.executar(
        `DELETE FROM importacoes WHERE tipo = 'PRODUCAO' AND hospital_id = ?
           AND NOT EXISTS (SELECT 1 FROM linhas_producao lp WHERE lp.importacao_id = importacoes.id)`, [hospitalId]);
    });
    Banco.salvarDebounced();
    Utilidades.toast(`Produção de ${Utilidades.compExibir(comp)} excluída.`, 'ok');
    render();
  }

  // ────────────────────────────────────────────────────────────────────
  // ETAPA 2 — conferir mapeamento e importar (Sistema, Médico, Base
  // Tabela — e a Produção só quando o layout não foi reconhecido)
  // ────────────────────────────────────────────────────────────────────
  function renderMapeamento(hospitais) {
    const area = el.querySelector('#imp-area');
    const a = st.arq;
    const campos = Importador.CAMPOS[st.tipo];
    const cab = (a.matriz[a.linhaCab] || []).map(c => String(c));
    const hosp = hospitais.find(h => h.id === st.hospitalId);

    // exemplo de valor: primeira célula não vazia abaixo do cabeçalho
    const exemplo = (idx) => {
      for (let i = a.linhaCab + 1; i < Math.min(a.matriz.length, a.linhaCab + 12); i++) {
        const v = (a.matriz[i] || [])[idx];
        if (v != null && String(v).trim() !== '') return celTxt(v).slice(0, 28);
      }
      return '';
    };

    const opcoesColunas = (sel) => ['<option value="">— não tem —</option>']
      .concat(cab.map((nome, i) =>
        `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(nome || ('coluna ' + (i + 1)))}</option>`))
      .join('');

    const linhasPrev = [];
    for (let i = a.linhaCab; i < Math.min(a.matriz.length, a.linhaCab + 5); i++) {
      linhasPrev.push(a.matriz[i] || []);
    }

    area.innerHTML = `
      <div class="painel">
        <div class="painel-cabecalho">
          <span class="painel-titulo">Mapeamento de colunas — ${esc(a.nome)}</span>
          <span class="painel-conta">${esc(hosp ? hosp.nome : '')} · ${esc(TIPO_ROTULO[st.tipo] || st.tipo)}
            ${(st.tipo === 'REPASSE' || st.tipo === 'MEDICO') ? '· pagamento ' + esc(Utilidades.compExibir(st.competencia)) : ''}
            · aba "${esc(a.nomeAba)}" · ${a.matriz.length} linhas</span>
          <div class="painel-acoes">
            <button class="botao" id="map-voltar">← Trocar arquivo</button>
          </div>
        </div>
        <div class="painel-corpo">
          ${a.aviso ? `<div class="aviso-caixa" style="margin-bottom:12px">⚠ ${esc(a.aviso)} O que você apontar aqui fica salvo para este hospital.</div>` : ''}
          ${a.usouPerfil ? `<div class="info-caixa">Mapeamento salvo deste hospital reaplicado — confira e ajuste se algo mudou.</div>` : ''}
          <div class="linha-campos" style="margin-bottom:12px">
            <div class="campo" style="max-width:220px"><span class="campo-rotulo">Linha do cabeçalho</span>
              <select id="map-linha-cab">${a.matriz.slice(0, Math.min(30, a.matriz.length)).map((l, i) =>
                `<option value="${i}" ${i === a.linhaCab ? 'selected' : ''}>linha ${i + 1}: ${esc((l || []).slice(0, 4).map(celTxt).join(' | ').slice(0, 40))}…</option>`).join('')}
              </select></div>
          </div>

          <div class="rolagem-x"><table class="tabela"><thead><tr>
            <th>Campo da ATLAS</th><th>Coluna na planilha</th><th>Exemplo</th>
          </tr></thead><tbody>
            ${campos.map(c => {
              const sel = a.map[c.campo];
              return `<tr>
                <td>${esc(c.rotulo)} ${c.obrig ? '<span class="texto-erro">*</span>' : ''}</td>
                <td><select class="entrada" data-campo="${c.campo}">${opcoesColunas(sel)}</select></td>
                <td class="texto-cinza" data-exemplo="${c.campo}">${esc(sel != null ? exemplo(sel) : '')}</td>
              </tr>`;
            }).join('')}
          </tbody></table></div>

          <div class="separador"></div>
          <div class="raiox-rotulo">Prévia (cabeçalho + primeiras linhas)</div>
          <div class="rolagem-x"><table class="tabela"><tbody>
            ${linhasPrev.map((l, i) => `<tr>${l.slice(0, 14).map(c =>
              i === 0 ? `<th>${esc(celTxt(c).slice(0, 20))}</th>` : `<td>${esc(celTxt(c).slice(0, 20))}</td>`).join('')}</tr>`).join('')}
          </tbody></table></div>

          <div class="separador"></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;margin-bottom:12px">
            <input type="checkbox" id="map-substituir" checked>
            ${st.tipo === 'BASE_TABELA'
              ? 'Substituir a Base Tabela atual deste hospital'
              : 'Substituir dados já importados deste hospital para as competências presentes no arquivo (reimportação segura, sem duplicar)'}
          </label>
          <button class="botao botao-ouro" id="map-importar">📥 Importar agora</button>
        </div>
      </div>`;

    area.querySelector('#map-voltar').addEventListener('click', () => { st.arq = null; st.etapa = 1; st.alvo = ''; render(); });

    area.querySelector('#map-linha-cab').addEventListener('change', (e) => {
      a.linhaCab = Number(e.target.value);
      const novoCab = (a.matriz[a.linhaCab] || []).map(c => String(c));
      a.map = st.tipo === 'PRODUCAO'
        ? Importador.nucleoDoMapa(Importador.mapearProducao(novoCab, null, null))
        : Importador.sugerirMapeamento(novoCab, st.tipo);
      a.usouPerfil = false;
      render();
    });

    area.querySelectorAll('select[data-campo]').forEach(sel => {
      sel.addEventListener('change', () => {
        const campo = sel.dataset.campo;
        a.map[campo] = sel.value === '' ? null : Number(sel.value);
        const cel = area.querySelector(`[data-exemplo="${campo}"]`);
        if (cel) cel.textContent = a.map[campo] != null ? exemplo(a.map[campo]) : '';
      });
    });

    area.querySelector('#map-importar').addEventListener('click', () => {
      // valida obrigatórios (na produção automática só admissão e data importam)
      const obrig = st.tipo === 'PRODUCAO' ? campos.filter(c => c.campo === 'admissao' || c.campo === 'data') : campos.filter(c => c.obrig);
      for (const c of obrig) {
        if (a.map[c.campo] == null || a.map[c.campo] < 0) {
          Utilidades.toast(`Aponte a coluna de "${c.rotulo}" — é obrigatória.`, 'aviso', 4200);
          return;
        }
      }
      // perfil com NOMES de coluna (sobrevive a reordenação)
      const porNome = {};
      for (const [campo, idx] of Object.entries(a.map)) {
        if (idx != null && idx >= 0 && cab[idx]) porNome[campo] = cab[idx];
      }
      try {
        Utilidades.loading.mostrar('Importando linhas…');
        if (st.tipo === 'PRODUCAO') {
          const r = Importador.importarProducao({
            matriz: a.matriz, clienteId: cliente.id, hospitalId: st.hospitalId, arquivo: a.nome,
            substituir: area.querySelector('#map-substituir').checked, linhaCab: a.linhaCab, nucleo: a.map,
            escopo: st.escopo,
          });
          Importador.perfilGravar(st.hospitalId, 'PRODUCAO', porNome, a.linhaCab);
          Banco.salvarDebounced();
          const alvo = st.alvo || '';
          st.arq = null; st.etapa = 1; st.alvo = '';
          render();
          resumoProducao(r, a.nome, alvo);
          return;
        }
        const r = Importador.aplicar({
          tipo: st.tipo, matriz: a.matriz, linhaCab: a.linhaCab, map: a.map,
          clienteId: cliente.id, hospitalId: st.hospitalId, arquivo: a.nome,
          competencia: st.competencia,
          substituir: area.querySelector('#map-substituir').checked,
        });
        Importador.perfilGravar(st.hospitalId, st.tipo, porNome, a.linhaCab);
        Banco.salvarDebounced();

        st.arq = null; st.etapa = 1;
        render();
        const comps = r.competencias.length ? ' Competências: ' + r.competencias.map(Utilidades.compExibir).join(', ') + '.' : '';
        Utilidades.toast(`${r.inseridas.toLocaleString('pt-BR')} linhas importadas.${comps}` +
          (r.avisos.length ? ` (${r.avisos.length} avisos)` : ''), 'ok', 5200);
        if (r.avisos.length) console.warn('[importar] avisos:', r.avisos);
      } catch (err) {
        console.error(err);
        Utilidades.toast('Importação falhou: ' + (err.message || err), 'erro', 6000);
      } finally {
        Utilidades.loading.esconder();
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // HISTÓRICO DE IMPORTAÇÕES
  // ────────────────────────────────────────────────────────────────────
  function renderLista() {
    const box = el.querySelector('#imp-lista');
    const imps = Banco.query(
      `SELECT i.*, h.nome AS hospital FROM importacoes i
       JOIN hospitais h ON h.id = i.hospital_id
       WHERE i.cliente_id = ? ORDER BY i.id DESC LIMIT 40`, [cliente.id]);

    box.innerHTML = `
      <div class="painel">
        <div class="painel-cabecalho"><span class="painel-titulo">Histórico de importações</span></div>
        ${imps.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
            <th>Quando</th><th>Hospital</th><th>Tipo</th><th>Arquivo</th>
            <th>Competência</th><th class="num">Linhas</th><th></th>
          </tr></thead><tbody>
          ${imps.map(i => `<tr>
            <td>${esc(quando(i.importada_em))}</td>
            <td>${esc(i.hospital)}</td><td>${esc(TIPO_ROTULO[i.tipo] || i.tipo)}</td><td>${esc(i.arquivo || '—')}</td>
            <td>${esc(compsTxt(i.competencia))}</td>
            <td class="num">${(i.n_linhas || 0).toLocaleString('pt-BR')}</td>
            <td style="text-align:right"><button class="botao botao-mini botao-perigo" data-del="${i.id}" data-tipo="${esc(i.tipo)}"
              title="Apaga esta importação e todas as linhas que ela trouxe">Excluir importação</button></td>
          </tr>`).join('')}
          </tbody></table></div>` :
        `<div class="tabela-vazia">Nenhuma importação ainda.</div>`}
      </div>`;

    box.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.del);
        if (!confirm('Excluir esta importação e TODAS as linhas que ela trouxe?')) return;
        excluirImportacao(id);
        Utilidades.toast('Importação excluída.', 'ok');
        render();
      });
    });
  }

  render();
};
