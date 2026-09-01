/**
 * ============================================================================
 * TELA: Importações (📥)
 *
 * Fluxo em 2 etapas:
 *   1. Escolher hospital + tipo de relatório + arquivo (.xlsx/.xls/.csv)
 *   2. Conferir o MAPEAMENTO DE COLUNAS sugerido (a ATLAS casa os cabeçalhos
 *      com os campos por apelidos; perfis salvos do hospital são reaplicados)
 *      e gravar — com opção de SUBSTITUIR as competências do arquivo.
 *
 * O mapeamento confirmado fica salvo por hospital × tipo (perfis_importacao):
 * na próxima planilha igual, cai direto certo.
 * ============================================================================
 */
App.telas['importar'] = function () {
  'use strict';
  const el = document.getElementById('conteudo');
  const esc = Utilidades.esc;
  const cliente = App.clienteAtivo();
  if (!cliente) { App.avisoSemCliente(el); return; }

  if (!window.__imp) window.__imp = { etapa: 1, hospitalId: 0, tipo: 'PRODUCAO', competencia: '', arq: null };
  const st = window.__imp;

  const TIPOS = [
    ['PRODUCAO', 'Produção — o que foi feito'],
    ['REPASSE', 'Repasse — o que foi pago'],
    ['BASE_TABELA', 'Base Tabela — regras de repasse'],
  ];

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
      <div id="imp-lista"></div>`;

    if (st.etapa === 2 && st.arq) renderMapeamento(hospitais);
    else renderEscolha(hospitais);
    renderLista();
  }

  // ────────────────────────────────────────────────────────────────────
  // ETAPA 1 — escolher hospital, tipo e arquivo
  // ────────────────────────────────────────────────────────────────────
  function renderEscolha(hospitais) {
    const area = el.querySelector('#imp-area');
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
            <div class="campo" id="imp-comp-box" style="max-width:170px; ${st.tipo === 'REPASSE' ? '' : 'display:none'}">
              <span class="campo-rotulo">Mês do pagamento</span>
              <input type="month" id="imp-comp" value="${esc(st.competencia)}"></div>
            <div class="campo"><span class="campo-rotulo">Arquivo (.xlsx / .xls / .csv)</span>
              <input type="file" id="imp-arquivo" accept=".xlsx,.xls,.csv"></div>
          </div>
          <div class="info-caixa" style="margin-top:12px">
            <strong>Produção</strong> = relatório do que foi realizado (admissão, procedimento, valores,
            profissionais). <strong>Repasse</strong> = relatório do que foi pago ao médico.
            <strong>Base Tabela</strong> = tabela de regras de repasse do hospital (quando ele fornece).
          </div>
        </div>
      </div>`;

    area.querySelector('#imp-hosp').addEventListener('change', e => { st.hospitalId = Number(e.target.value); });
    area.querySelector('#imp-tipo').addEventListener('change', e => {
      st.tipo = e.target.value;
      area.querySelector('#imp-comp-box').style.display = st.tipo === 'REPASSE' ? '' : 'none';
    });
    area.querySelector('#imp-comp').addEventListener('change', e => { st.competencia = e.target.value; });

    area.querySelector('#imp-arquivo').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      if (st.tipo === 'REPASSE' && !area.querySelector('#imp-comp').value) {
        Utilidades.toast('Informe o MÊS DO PAGAMENTO antes de escolher o arquivo do repasse.', 'aviso', 4200);
        e.target.value = '';
        return;
      }
      st.competencia = area.querySelector('#imp-comp').value || '';
      try {
        Utilidades.loading.mostrar('Lendo a planilha…');
        const buf = await f.arrayBuffer();
        const { matriz, nomeAba } = Importador.lerPlanilha(buf);
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

  // ────────────────────────────────────────────────────────────────────
  // ETAPA 2 — conferir mapeamento e importar
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
        if (v != null && String(v).trim() !== '') return String(v).slice(0, 28);
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
          <span class="painel-conta">${esc(hosp ? hosp.nome : '')} · ${esc(st.tipo)}
            ${st.tipo === 'REPASSE' ? '· pagamento ' + esc(Utilidades.compExibir(st.competencia)) : ''}
            · aba "${esc(a.nomeAba)}" · ${a.matriz.length} linhas</span>
          <div class="painel-acoes">
            <button class="botao" id="map-voltar">← Trocar arquivo</button>
          </div>
        </div>
        <div class="painel-corpo">
          ${a.usouPerfil ? `<div class="info-caixa">Mapeamento salvo deste hospital reaplicado — confira e ajuste se algo mudou.</div>` : ''}
          <div class="linha-campos" style="margin-bottom:12px">
            <div class="campo" style="max-width:220px"><span class="campo-rotulo">Linha do cabeçalho</span>
              <select id="map-linha-cab">${a.matriz.slice(0, Math.min(30, a.matriz.length)).map((l, i) =>
                `<option value="${i}" ${i === a.linhaCab ? 'selected' : ''}>linha ${i + 1}: ${esc((l || []).slice(0, 4).join(' | ').slice(0, 40))}…</option>`).join('')}
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
              i === 0 ? `<th>${esc(String(c).slice(0, 20))}</th>` : `<td>${esc(String(c).slice(0, 20))}</td>`).join('')}</tr>`).join('')}
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

    area.querySelector('#map-voltar').addEventListener('click', () => { st.arq = null; st.etapa = 1; render(); });

    area.querySelector('#map-linha-cab').addEventListener('change', (e) => {
      a.linhaCab = Number(e.target.value);
      const novoCab = (a.matriz[a.linhaCab] || []).map(c => String(c));
      a.map = Importador.sugerirMapeamento(novoCab, st.tipo);
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
      // valida obrigatórios
      for (const c of campos) {
        if (c.obrig && (a.map[c.campo] == null || a.map[c.campo] < 0)) {
          Utilidades.toast(`Aponte a coluna de "${c.rotulo}" — é obrigatória.`, 'aviso', 4200);
          return;
        }
      }
      try {
        Utilidades.loading.mostrar('Importando linhas…');
        const r = Importador.aplicar({
          tipo: st.tipo, matriz: a.matriz, linhaCab: a.linhaCab, map: a.map,
          clienteId: cliente.id, hospitalId: st.hospitalId, arquivo: a.nome,
          competencia: st.competencia,
          substituir: area.querySelector('#map-substituir').checked,
        });
        // salva o perfil com NOMES de coluna (sobrevive a reordenação)
        const porNome = {};
        for (const [campo, idx] of Object.entries(a.map)) {
          if (idx != null && idx >= 0 && cab[idx]) porNome[campo] = cab[idx];
        }
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
            <td>${esc((i.importada_em || '').slice(0, 16).replace('T', ' '))}</td>
            <td>${esc(i.hospital)}</td><td>${esc(i.tipo)}</td><td>${esc(i.arquivo || '—')}</td>
            <td>${esc(i.competencia ? Utilidades.compExibir(i.competencia) : '—')}</td>
            <td class="num">${(i.n_linhas || 0).toLocaleString('pt-BR')}</td>
            <td style="text-align:right"><button class="botao botao-mini botao-perigo" data-del="${i.id}" data-tipo="${esc(i.tipo)}">excluir</button></td>
          </tr>`).join('')}
          </tbody></table></div>` :
        `<div class="tabela-vazia">Nenhuma importação ainda.</div>`}
      </div>`;

    box.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.del);
        if (!confirm('Excluir esta importação e TODAS as linhas que ela trouxe?')) return;
        Banco.transacao(() => {
          Banco.executar('DELETE FROM linhas_producao WHERE importacao_id = ?', [id]);
          Banco.executar('DELETE FROM linhas_repasse WHERE importacao_id = ?', [id]);
          Banco.executar('DELETE FROM importacoes WHERE id = ?', [id]);
        });
        Banco.salvarDebounced();
        Utilidades.toast('Importação excluída.', 'ok');
        renderLista();
      });
    });
  }

  render();
};
