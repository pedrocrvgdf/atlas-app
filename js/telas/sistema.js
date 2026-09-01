/**
 * ============================================================================
 * TELA: Sistema (⚙️)
 * Backup do banco (exportar/importar .db), parâmetros do motor e reset.
 * Regra de sobrevivência: o banco vive no navegador — SEM BACKUP REGULAR,
 * limpar dados do navegador = perder tudo.
 * ============================================================================
 */
App.telas['sistema'] = function () {
  'use strict';
  const el = document.getElementById('conteudo');
  const esc = Utilidades.esc;
  const v = window.ATLAS_VERSAO || {};

  const params = [
    ['tolerancia_centavos', 'Tolerância de diferença (R$)', 'Diferenças até este valor contam como PAGO OK.', 'num'],
    ['inferencia_min_amostras', 'Inferência — mínimo de amostras', 'Pagamentos mínimos de um procedimento×papel para aprender o padrão.', 'num'],
    ['inferencia_min_confianca', 'Inferência — confiança mínima (0 a 1)', 'Padrões abaixo disto não entram no cálculo automático.', 'num'],
    ['fuzzy_limiar', 'Similaridade mínima (0 a 1)', 'Limiar do casamento fuzzy de nomes/procedimentos entre relatórios.', 'num'],
    ['institucional_marca', 'Marca de profissional institucional', 'Palavra que identifica profissional da própria instituição no nome (ex.: a sigla do hospital) — papel dele nunca gera cobrança. Vazio = desligado.', 'texto'],
  ];

  el.innerHTML = `
    <div class="tela-cabecalho"><h1 class="tela-titulo">Sistema</h1></div>

    <div class="painel">
      <div class="painel-cabecalho"><span class="painel-titulo">💾 Backup</span></div>
      <div class="painel-corpo">
        <div class="aviso-caixa"><strong>Importante:</strong> os dados vivem no navegador desta
        máquina (IndexedDB). Faça backups regulares — se o navegador limpar os dados, o backup
        é o único caminho de volta.</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="botao botao-ouro" id="bk-exportar">⬇ Exportar banco (.db)</button>
          <label class="botao" style="cursor:pointer">⬆ Importar banco (.db)
            <input type="file" id="bk-importar" accept=".db,.sqlite,.sqlite3" style="display:none"></label>
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

  el.querySelector('#bk-exportar').addEventListener('click', () => {
    Banco.exportarArquivo();
    Utilidades.toast('Backup exportado — guarde o arquivo em lugar seguro.', 'ok');
  });

  el.querySelector('#bk-importar').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!confirm('Importar este banco SUBSTITUI todos os dados atuais. Continuar?')) { e.target.value = ''; return; }
    try {
      Utilidades.loading.mostrar('Importando banco…');
      await Banco.importarArquivo(await f.arrayBuffer());
      Utilidades.toast('Banco importado.', 'ok');
      App.renderShell();
      App.navegar('visao');
    } catch (err) {
      console.error(err);
      Utilidades.toast('Falhou: ' + (err.message || err), 'erro', 5000);
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
    if (!confirm('APAGAR TODOS OS DADOS de todos os clientes? Não há volta sem backup.')) return;
    if (!confirm('Última confirmação: apagar tudo mesmo?')) return;
    await Banco.resetar();
    Utilidades.toast('Banco zerado.', 'ok');
    App.renderShell();
    App.navegar('visao');
  });
};
