/**
 * ============================================================================
 * TELA: Sistema (⚙️)
 * Backup por cliente (exportar/restaurar .db), espaço usado, parâmetros do
 * motor e reset. Regra de sobrevivência: os cofres vivem no navegador —
 * SEM BACKUP REGULAR, limpar dados do navegador = perder tudo.
 * ============================================================================
 */
App.telas['sistema'] = function () {
  'use strict';
  const el = document.getElementById('conteudo');
  const esc = Utilidades.esc;
  const v = window.ATLAS_VERSAO || {};
  const n = (x) => (Number(x) || 0).toLocaleString('pt-BR');
  const tamanho = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : (b || 0) + ' B';
  const quando = (iso) => iso ? String(iso).slice(0, 16).replace('T', ' ') : '—';

  const params = [
    ['tolerancia_centavos', 'Tolerância de diferença (R$)', 'Diferenças até este valor contam como PAGO OK.', 'num'],
    ['inferencia_min_amostras', 'Inferência — mínimo de amostras', 'Pagamentos mínimos de um procedimento×papel para aprender o padrão.', 'num'],
    ['inferencia_min_confianca', 'Inferência — confiança mínima (0 a 1)', 'Padrões abaixo disto não entram no cálculo automático.', 'num'],
    ['fuzzy_limiar', 'Similaridade mínima (0 a 1)', 'Limiar do casamento fuzzy de nomes/procedimentos entre relatórios.', 'num'],
    ['institucional_marca', 'Marca de profissional institucional', 'Palavra que identifica profissional da própria instituição no nome (ex.: a sigla do hospital) — papel dele nunca gera cobrança. Vazio = desligado.', 'texto'],
  ];

  const clientes = Banco.clientes().concat(Banco.clientes({ arquivados: true }));
  const aberto = App.clienteAtivo();

  el.innerHTML = `
    <div class="tela-cabecalho"><h1 class="tela-titulo">Sistema</h1></div>

    <div class="painel">
      <div class="painel-cabecalho"><span class="painel-titulo">💾 Backup por cliente</span>
        <span class="painel-conta" id="bk-espaco">calculando o espaço…</span></div>
      <div class="painel-corpo">
        <div class="aviso-caixa"><strong>Importante:</strong> os dados vivem no navegador desta
        máquina (IndexedDB), num cofre por cliente. Faça backups regulares de cada cliente — se o
        navegador limpar os dados, o backup é o único caminho de volta.</div>
        ${clientes.length ? `<div class="rolagem-x"><table class="tabela"><thead><tr>
            <th>Cliente</th><th>Hospitais</th><th class="num">Produção</th><th class="num">Sistema</th>
            <th class="num">Cofre</th><th>Gravado em</th><th></th>
          </tr></thead><tbody>
          ${clientes.map(c => `<tr>
            <td><strong>${esc(c.nome)}</strong>${aberto && aberto.id === c.id ? ' <span class="badge badge-OK">ATIVO</span>' : ''}${!c.ativo ? ' <span class="texto-cinza">(arquivado)</span>' : ''}</td>
            <td class="texto-cinza">${esc((c.hospitais || []).map(h => h.nome).join(', ') || '—')}</td>
            <td class="num mono">${n(c.producao)}</td><td class="num mono">${n(c.sistema)}</td>
            <td class="num mono">${tamanho(c.bytes)}</td><td class="texto-cinza">${esc(quando(c.atualizado_em))}</td>
            <td style="text-align:right"><button class="botao botao-mini botao-primario" data-exportar="${c.id}">⬇ Exportar (.db)</button></td>
          </tr>`).join('')}
          </tbody></table></div>` :
          `<div class="texto-cinza" style="margin-bottom:10px">Nenhum cliente cadastrado ainda.</div>`}
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;align-items:center">
          <label class="botao" style="cursor:pointer">⬆ Restaurar backup (.db)
            <input type="file" id="bk-importar" accept=".db,.sqlite,.sqlite3" style="display:none"></label>
          <span class="texto-cinza" style="font-size:11.5px">aceita o backup de um cliente ou o banco único de versões antigas —
            cada cliente do arquivo substitui o cliente de mesmo documento/nome, ou entra como novo.</span>
        </div>
      </div>
    </div>

    <div class="painel">
      <div class="painel-cabecalho"><span class="painel-titulo">🎚 Parâmetros do motor</span></div>
      <div class="painel-corpo">
        <div class="rolagem-x"><table class="tabela"><tbody>
          ${params.map(([chave, rotulo, ajuda, tipo]) => `<tr>
            <td style="width:280px"><strong>${rotulo}</strong><br>
              <span class="texto-cinza" style="font-size:11px">${ajuda}</span></td>
            <td><input class="entrada" style="max-width:${tipo === 'texto' ? '220px' : '140px'}"
              data-param="${chave}" data-tipo="${tipo}"
              value="${esc(String(Banco.configLer(chave, '')))}"></td>
          </tr>`).join('')}
        </tbody></table></div>
        <button class="botao botao-marinho" id="par-salvar" style="margin-top:10px">Salvar parâmetros</button>
      </div>
    </div>

    <div class="painel">
      <div class="painel-cabecalho"><span class="painel-titulo">🧨 Zona de perigo</span></div>
      <div class="painel-corpo">
        <button class="botao botao-perigo" id="sis-reset">Apagar TUDO e começar do zero</button>
      </div>
    </div>

    <div class="painel"><div class="painel-corpo texto-cinza" style="font-size:12px">
      <strong>${esc(v.produto || 'ATLAS')}</strong> · pacote ${esc(v.pacote || '?')} ·
      gerado em ${esc(v.gerado || '?')} · ATLAS COMPANY LTDA — Pedro & Matheus.
    </div></div>`;

  // espaço usado no navegador (assíncrono, não segura a tela)
  Banco.espaco().then(e => {
    const alvo = el.querySelector('#bk-espaco');
    if (!alvo) return;
    alvo.textContent = e
      ? `espaço no navegador: ${tamanho(e.usado)} usados de ${tamanho(e.cota)}${e.persistente === true ? ' · armazenamento persistente' : ''}`
      : '';
  });

  el.querySelectorAll('[data-exportar]').forEach(b => b.addEventListener('click', async () => {
    try {
      Utilidades.loading.mostrar('Exportando o cofre…');
      await new Promise(r => setTimeout(r, 30));
      await Banco.exportarArquivo(Number(b.dataset.exportar));
      Utilidades.toast('Backup exportado — guarde o arquivo em lugar seguro.', 'ok');
    } catch (err) {
      console.error(err);
      Utilidades.toast('Falhou: ' + (err.message || err), 'erro', 5000);
    } finally { Utilidades.loading.esconder(); }
  }));

  el.querySelector('#bk-importar').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    e.target.value = '';
    try {
      Utilidades.loading.mostrar('Lendo o arquivo…');
      const buf = await f.arrayBuffer();
      const conteudo = await Banco.inspecionarArquivo(buf);
      Utilidades.loading.esconder();
      const linhas = conteudo.map(c => `• ${c.nome} (${n(c.producao)} linhas de produção, ${n(c.sistema)} do sistema) → ` +
        (c.alvo ? `SUBSTITUI o cliente "${c.alvo.nome}"` : 'entra como cliente NOVO'));
      if (!confirm(`O arquivo "${f.name}" contém:\n\n${linhas.join('\n')}\n\nRestaurar? O que for substituído não volta sem backup.`)) return;
      Utilidades.loading.mostrar('Restaurando…');
      const r = await Banco.restaurarArquivo(buf, (m) => Utilidades.loading.mostrar(m));
      Utilidades.toast(`Restaurado: ${r.substituidos.length} substituído(s), ${r.novos.length} novo(s).`, 'ok', 6000);
      App.renderShell();
      App.navegar('clientes');
    } catch (err) {
      console.error(err);
      Utilidades.toast('Falhou: ' + (err.message || err), 'erro', 6000);
    } finally {
      Utilidades.loading.esconder();
    }
  });

  el.querySelector('#par-salvar').addEventListener('click', () => {
    el.querySelectorAll('[data-param]').forEach(inp => {
      const valor = inp.dataset.tipo === 'texto'
        ? inp.value.trim()
        : String(Utilidades.paraNumero(inp.value));
      Banco.configGravar(inp.dataset.param, valor);
    });
    Banco.salvarDebounced();
    Utilidades.toast('Parâmetros salvos.', 'ok');
  });

  el.querySelector('#sis-reset').addEventListener('click', async () => {
    if (!confirm('APAGAR TODOS OS DADOS de todos os clientes deste navegador? Não há volta sem backup.')) return;
    if (!confirm('Última confirmação: apagar tudo mesmo?')) return;
    await Banco.resetar();
    Utilidades.toast('Banco zerado.', 'ok');
    App.renderShell();
    App.navegar('visao');
  });
};
