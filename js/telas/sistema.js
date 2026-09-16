// ============================================================================
// MÓDULO SISTEMA (V287)
// Tela única com abas internas reusando as telas Backup e Administração.
// Acessível só pela engrenagem do rodapé (master 'adm.atlas').
// As sub-telas renderizam em #sistema-painel via App.alvoConteudo()
// (App._alvoSistemaAtivo fica ligado enquanto o usuário estiver no SISTEMA;
//  é desligado em App.navegarPara ao sair).
// ============================================================================
App.telas['sistema'] = function () {
  const cont = document.getElementById('conteudo');
  if (!cont) return;

  cont.innerHTML = `
    <div class="sistema-wrap">
      <div class="sistema-tabs" role="tablist">
        <button class="sistema-tab active" data-stab="backup" role="tab">
          <i class="ti ti-database-export"></i><span>Backup</span>
        </button>
        <button class="sistema-tab" data-stab="administracao" role="tab">
          <i class="ti ti-settings"></i><span>Administração</span>
        </button>
        <button class="sistema-tab" data-stab="balanco-retroativo" role="tab">
          <i class="ti ti-flask"></i><span>Balanço Retroativo</span>
        </button>
      </div>
      <div id="sistema-painel" class="sistema-painel"></div>
    </div>`;

  const tabs = Array.from(cont.querySelectorAll('.sistema-tab'));

  function abrir(qual) {
    tabs.forEach(b => b.classList.toggle('active', b.dataset.stab === qual));
    App._alvoSistemaAtivo = true;            // redireciona o render pro painel
    try {
      if (App.telas[qual]) App.telas[qual]();
    } catch (e) {
      console.error('[sistema] erro ao abrir aba', qual, e);
      const p = document.getElementById('sistema-painel');
      if (p) p.innerHTML = '<div class="card">Não foi possível carregar esta aba.</div>';
    }
    // mantém ligado: re-renders internos (ex.: Administração) caem no painel
    App._alvoSistemaAtivo = true;
  }

  tabs.forEach(b => b.addEventListener('click', () => abrir(b.dataset.stab)));
  abrir('backup');
};
