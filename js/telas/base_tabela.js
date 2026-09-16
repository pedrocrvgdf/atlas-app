/**
 * ============================================================================
 * TELA: Base Tabela
 *
 * Layout solicitado pelo usuário:
 *   Duas tabelas (CONVÊNIO e PARTICULAR) com colunas:
 *
 *   PROCEDIMENTO | EXECUTANTE | INDICANTE | SOLICITANTE | AUXILIAR | MED. LAUDO
 *
 *   - Edição inline: clica na célula, digita, sai → salva automaticamente
 *   - Permite mudar valores rapidamente sem entrar em formulários
 *   - Busca em tempo real
 *   - Upload do Excel para popular a tabela
 *   - Botão "Novo procedimento" para adicionar entradas manualmente
 * ============================================================================
 */

App.telas['base-tabela'] = function () {
  const r = Banco.resumo();
  const temDados = r.procedimentos > 0;

  // V565: ciclo de versões — o botão do cabeçalho alterna conforme o estado:
  //   • nenhuma versão publicada  → "Publicar versão" (publica a 1.0, a base)
  //   • versão publicada, sem rascunho → "Criar nova versão" (abre a cópia editável)
  //   • rascunho aberto → "Publicar versão" (fecha o ciclo como N.0)
  let vBtnLabel = '🏷 Publicar versão';
  try {
    if (window.AtlasVersoesTabela && AtlasVersoesTabela.garantir()) {
      const vs = AtlasVersoesTabela.listar();
      if (vs.length && !AtlasVersoesTabela.temRascunho()) vBtnLabel = '🏷 Criar nova versão';
    }
  } catch (_) {}

  const html = `
    <div class="page-content">
      <header class="page-header">
        <div>
          <h2>Base Tabela</h2>
          <div class="subtitle">Procedimentos e valores de repasse — clique nos valores para editar
            <span id="bt-sub-versao"></span><!-- V566: informativo da versão em exibição --></div>
        </div>
        <div style="display: flex; gap: 8px">
          <input type="file" id="upload-base-tabela" accept=".xlsx,.xls" style="display: none">
          <input type="file" id="upload-base-tabela-tipo" accept=".xlsx,.xls" style="display: none">
          <input type="file" id="upload-casar-sim" accept=".xlsx,.xls" style="display: none">
          <input type="file" id="upload-nomenclaturas" accept=".xlsx,.xls" style="display: none"><!-- V850 -->
          <button class="btn btn-primary" id="btn-upload-base">↑ Importar Excel</button>
          <button class="btn" id="btn-upload-tipo">↑ Importar por tipo</button>
          <button class="btn" id="btn-import-nom" title="Importa a coluna NOMENCLATURA de uma planilha exportada daqui (só a nomenclatura muda — nomes, valores e versões ficam intactos)">↑ Importar nomenclaturas</button><!-- V850 -->
          <button class="btn" id="btn-export-base">↓ Exportar Excel</button><!-- V556 -->
          <button class="btn btn-primary" id="btn-versao-base">${vBtnLabel}</button><!-- V563/V565 -->
          <button class="btn" id="btn-reajuste-convenio">% Reajuste Geral</button><!-- V567 -->
          <button class="btn" id="btn-reajuste-esp">% Reajuste Especialidade</button><!-- V570 -->
          <button class="btn" id="btn-casar-sim">🔗 Casar por similaridade</button>
          <button class="btn" id="btn-dedup">🧹 Remover duplicados</button>
          <button class="btn" id="btn-novo-proc">+ Novo Procedimento</button>
          <button class="btn" id="btn-limpar-base" style="color: var(--danger, #9B3A3A)">🗑 Limpar base</button>
        </div>
      </header>

      ${temDados ? '' : `
        <div class="card" style="margin-bottom: 24px; background: var(--accent-soft); border-color: var(--accent)">
          <div style="display: flex; gap: 16px; align-items: center">
            <div style="font-size: 32px">📋</div>
            <div>
              <h3 class="card-title" style="margin: 0">Comece importando sua base tabela</h3>
              <p style="margin: 4px 0 0; font-size: 13px; color: var(--ink-soft)">
                Envie o arquivo <code class="mono">BASE_TABELA.xlsx</code>. O sistema vai consolidar
                automaticamente as variações de grafia.
              </p>
            </div>
          </div>
        </div>
      `}

      ${temDados ? `
        <div class="card" style="margin-bottom: 16px">
          <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap">
            <input type="text" id="busca-procedimento" class="input" style="flex: 1; min-width: 220px"
                   placeholder="Buscar procedimento (digite parte do nome)...">

            <!-- V557: filtros de classificação -->
            <select id="filtro-categoria" class="input" style="width: 170px; flex: none" title="Filtrar por Categoria">
              <option value="">Categoria (todas)</option>
            </select>
            <select id="filtro-subesp" class="input" style="width: 190px; flex: none" title="Filtrar por Subespecialidade">
              <option value="">Subespecialidade (todas)</option>
            </select>
            <label class="small" style="display: flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap"
                   title="Oculta os zerados: mostra só procedimentos com USAR marcado e pelo menos um valor maior que zero nesta fonte">
              <input type="checkbox" id="filtro-com-valor">
              Zerados
            </label><!-- V559: rótulo renomeado (era "USAR com valor > 0") -->

            <!-- V565: o seletor de versão saiu da tela — versões e informativos
                 vivem no ícone flutuante de versões (bt-fab-versoes) -->
            <div style="display: flex; gap: 4px; background: var(--bg-sunken); padding: 3px; border-radius: var(--radius-md)">
              <button class="btn-toggle active" data-tipo="CONVENIO" id="tab-convenio">Convênio</button>
              <button class="btn-toggle" data-tipo="PARTICULAR" id="tab-particular">Particular</button>
              <button class="btn-toggle" data-tipo="SUS" id="tab-sus">SUS</button>
            </div>

            <div class="small muted" id="contador-resultados"></div>
          </div>
        </div>

        <div class="card" style="padding: 0; overflow: hidden">
          <div id="tabela-conteudo" style="max-height: 65vh; overflow-y: auto"></div>
        </div>
      ` : ''}
    </div>

    <style>
      .bt-tipo-overlay {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(0, 80, 115, 0.35);
        display: flex; align-items: center; justify-content: center;
      }
      .bt-tipo-modal {
        background: var(--bg-elevated, #FFF);
        border: 1px solid var(--border, #DDE7E3);
        border-radius: var(--radius-md, 10px);
        box-shadow: 0 12px 40px rgba(0,0,0,0.18);
        padding: 22px; width: 420px; max-width: 92vw;
      }
      .bt-sim-modal {
        background: var(--bg-elevated, #FFF);
        border: 1px solid var(--border, #DDE7E3);
        border-radius: var(--radius-md, 10px);
        box-shadow: 0 12px 40px rgba(0,0,0,0.18);
        width: 880px; max-width: 95vw; max-height: 90vh;
        display: flex; flex-direction: column; padding: 18px;
      }
      .bt-sim-top { display: flex; justify-content: space-between; align-items: center; }
      .bt-sim-sub { font-size: 13px; color: var(--ink-soft); margin: 8px 0 10px; }
      .bt-sim-ctrl { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; font-size: 13px; }
      .bt-sim-lista { overflow: auto; border: 1px solid var(--border, #DDE7E3); border-radius: 8px; padding: 6px; flex: 1; min-height: 0; }
      .bt-sim-bloco { padding: 8px; border-bottom: 1px solid var(--bg-sunken, #E8F1F7); }
      .bt-sim-head { display: flex; flex-direction: column; margin-bottom: 4px; }
      .bt-sim-vals { font-size: 11px; color: var(--accent, #189AD3); }
      .bt-sim-row { display: flex; align-items: center; gap: 8px; padding: 3px 0 3px 14px; font-size: 13px; cursor: pointer; }
      .bt-sim-row:hover { background: var(--bg-sunken, #E8F1F7); border-radius: 4px; }
      .bt-sim-score { font-weight: 700; font-size: 11px; width: 40px; text-align: right; flex-shrink: 0; }
      .bt-sim-score.alto { color: #0A7A5A; }
      .bt-sim-score.medio { color: #189AD3; }
      .bt-sim-score.baixo { color: #9B3A3A; }
      .bt-sim-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
      .col-usar { width: 48px; text-align: center; }
      .cel-usar { text-align: center; }
      .chk-usar { width: 16px; height: 16px; cursor: pointer; accent-color: var(--primary, #005073); }
      tr.proc-inativo { opacity: 0.45; }
      tr.proc-inativo .nome-proc { text-decoration: line-through; }
      .btn-toggle {
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 600;
        background: transparent;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        color: var(--ink-soft);
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
      }
      .btn-toggle:hover { color: var(--ink); }
      .btn-toggle.active {
        background: var(--bg-elevated);
        color: var(--primary);
        box-shadow: var(--shadow-sm);
      }

      .tabela-valores {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .tabela-valores thead {
        position: sticky;
        top: 0;
        background: var(--primary);
        z-index: 10;
      }
      .tabela-valores thead th {
        padding: 12px 14px;
        text-align: left;
        color: #F1F7F7;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-weight: 600;
        border-bottom: 1px solid var(--primary-hover);
      }
      .tabela-valores thead th.num { text-align: right; }
      .tabela-valores th.col-nomenclatura { width: 160px; }
      .tabela-valores td.nomenclatura-cel { padding: 4px 8px; }
      .nomenclatura-input {
        width: 100%; box-sizing: border-box;
        height: 28px; padding: 0 8px;
        border: 1px solid var(--border); border-radius: 6px;
        background: var(--bg-elevated); color: var(--ink);
        font-family: inherit; font-size: 12px; outline: none;
        transition: border-color 150ms, box-shadow 150ms;
      }
      .nomenclatura-input:focus { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(30, 187, 215,.14); }
      .nomenclatura-input::placeholder { color: var(--ink-faint); }
      /* V554: colunas de classificação vindas da PRODUÇÃO (editáveis) */
      .tabela-valores th.col-classif { width: 118px; }
      .tabela-valores td.classif-cel { padding: 4px 6px; }
      .classif-input {
        width: 100%; box-sizing: border-box;
        height: 28px; padding: 0 8px;
        border: 1px solid var(--border); border-radius: 6px;
        background: var(--bg-elevated); color: var(--ink);
        font-family: inherit; font-size: 12px; outline: none;
        transition: border-color 150ms, box-shadow 150ms;
      }
      .classif-input:focus { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(30, 187, 215,.14); }
      .classif-input::placeholder { color: var(--ink-faint); }
      .tabela-valores tbody tr {
        border-bottom: 1px solid var(--border);
        transition: background 100ms;
        height: 42px;
      }
      .tabela-valores tbody tr:hover {
        background: var(--bg-sunken);
      }
      .tabela-valores td {
        padding: 6px 14px;
        color: #000000;
        vertical-align: middle;
      }
      .tabela-valores td.nome-proc {
        font-weight: 600;
        max-width: 360px;
        line-height: 1.3;
        color: #000000;
        position: relative;
        vertical-align: middle;
      }
      .tabela-valores td.nome-proc .acoes {
        display: inline-flex;
        gap: 4px;
        margin-left: 10px;
        opacity: 0;
        transition: opacity 120ms;
        vertical-align: middle;
      }
      .tabela-valores tbody tr:hover .nome-proc .acoes {
        opacity: 1;
      }
      .tabela-valores td.nome-proc .btn-acao {
        background: transparent;
        border: 1px solid var(--border);
        color: var(--ink-faint);
        width: 22px;
        height: 22px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
      }
      .tabela-valores td.nome-proc .btn-acao:hover {
        background: var(--danger-soft);
        border-color: var(--danger);
        color: var(--danger);
      }
      .tabela-valores td.nome-proc .qtd-grafias {
        display: inline-block;
        font-size: 10px;
        color: var(--ink-faint);
        margin-left: 8px;
        background: var(--bg-sunken);
        padding: 1px 6px;
        border-radius: 4px;
      }
      .tabela-valores td.valor-cel {
        text-align: right;
        font-variant-numeric: tabular-nums;
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 600;
        color: #000000;
        cursor: pointer;
        position: relative;
      }
      .tabela-valores td.valor-cel:hover {
        background: var(--primary-soft);
      }
      .tabela-valores td.valor-cel.vazio {
        color: var(--ink-faint);
        font-style: italic;
      }
      .tabela-valores td.valor-cel.editando {
        padding: 0;
      }
      .tabela-valores td.valor-cel.editando input {
        width: 100%;
        padding: 8px 14px;
        border: 2px solid var(--accent);
        background: var(--accent-soft);
        font-family: var(--font-mono);
        font-size: 12px;
        text-align: right;
        outline: none;
      }
      /* Particular: toggle R$ ⇄ % grudado à esquerda do input */
      .tabela-valores td.valor-cel.editando .cel-edit-wrap {
        display: flex;
        align-items: stretch;
        width: 100%;
      }
      .tabela-valores td.valor-cel.editando .cel-edit-wrap input {
        flex: 1 1 auto;
        min-width: 0;
        border-left: none;
      }
      .cel-modo-toggle {
        flex: 0 0 auto;
        min-width: 34px;
        padding: 0 6px;
        border: 2px solid var(--accent);
        border-right: none;
        background: var(--primary);
        color: #FFF;
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        line-height: 1;
        transition: background-color 120ms;
      }
      .cel-modo-toggle:hover { background: var(--primary-hover); }
      .tabela-valores td.valor-cel.alterado::after {
        content: '●';
        position: absolute;
        top: 4px;
        right: 4px;
        font-size: 8px;
        color: var(--success);
      }

      /* Coluna TOTAL: destacada, não editável */
      .tabela-valores thead th.col-total {
        background: var(--primary-hover);
        border-left: 1px solid var(--primary-hover);
      }
      .tabela-valores td.total-cel {
        text-align: right;
        font-variant-numeric: tabular-nums;
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 700;
        color: #000000;
        background: var(--primary-soft);
        border-left: 2px solid var(--primary);
      }
      .tabela-valores td.total-cel.zero {
        color: var(--ink-faint);
        font-weight: 400;
        font-style: italic;
      }
      /* ===== V489/V490: TRAVA DA BASE TABELA (FABs ficam no style.css) ===== */
      .bt-trava-overlay {
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(0, 0, 61, 0.42);
        display: flex; align-items: center; justify-content: center;
      }
      .bt-trava-modal {
        background: var(--bg-elevated, #FFF);
        border: 1px solid var(--border, #DDE7E3);
        border-radius: var(--radius-md, 10px);
        box-shadow: 0 18px 50px rgba(0,0,0,0.22);
        width: 480px; max-width: 94vw;
        display: flex; flex-direction: column;
        overflow: hidden;
      }
      .bt-trava-head {
        background: var(--primary, #00003D);
        color: #FFF; padding: 14px 18px;
        display: flex; align-items: center; gap: 10px;
      }
      .bt-trava-head h3 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: .02em; }
      .bt-trava-head .bt-trava-close {
        margin-left: auto; background: transparent; border: none;
        color: #FFF; font-size: 16px; cursor: pointer; opacity: .8;
      }
      .bt-trava-close:hover { opacity: 1; }
      .bt-trava-body { padding: 18px; }
      .bt-trava-passos { display: flex; gap: 8px; margin-bottom: 14px; }
      .bt-trava-passo {
        flex: 1; font-size: 11px; text-transform: uppercase; letter-spacing: .07em;
        color: var(--ink-faint, #9AA); text-align: center;
        padding-bottom: 6px; border-bottom: 2px solid var(--border, #DDE7E3);
      }
      .bt-trava-passo.ativo { color: var(--primary, #00003D); border-bottom-color: var(--primary, #00003D); font-weight: 700; }
      .bt-trava-lbl { display: block; font-size: 12px; font-weight: 600; color: var(--ink-soft); margin-bottom: 6px; }
      .bt-trava-input {
        width: 100%; box-sizing: border-box; height: 38px; padding: 0 12px;
        border: 1px solid var(--border, #DDE7E3); border-radius: 8px;
        background: var(--bg-elevated, #FFF); color: var(--ink);
        font-family: inherit; font-size: 14px; outline: none;
        transition: border-color 150ms, box-shadow 150ms;
      }
      .bt-trava-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(0,0,178,.12); }
      .bt-trava-erro { color: var(--danger, #9B3A3A); font-size: 12px; margin-top: 8px; min-height: 16px; }
      .bt-motivos { display: flex; flex-direction: column; gap: 8px; }
      .bt-motivo-op {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 12px; border: 1px solid var(--border, #DDE7E3);
        border-radius: 8px; cursor: pointer; font-size: 13px;
        transition: border-color 140ms, background-color 140ms;
      }
      .bt-motivo-op:hover { background: var(--bg-sunken, #F3F6FA); }
      .bt-motivo-op.sel { border-color: var(--primary); background: var(--primary-soft, #EEF1FF); font-weight: 600; }
      .bt-motivo-op input { accent-color: var(--primary, #00003D); }
      .bt-trava-foot {
        display: flex; justify-content: flex-end; gap: 10px;
        padding: 14px 18px; border-top: 1px solid var(--border, #DDE7E3);
        background: var(--bg-sunken, #F7F9FC);
      }
      .bt-trava-aviso {
        font-size: 12px; color: var(--ink-soft); line-height: 1.5;
        background: var(--bg-sunken, #F3F6FA); border-radius: 8px;
        padding: 10px 12px; margin-bottom: 14px;
      }

      /* ===== V489: HISTÓRICO / SNAPSHOTS ===== */
      .bt-hist-modal {
        background: var(--bg-elevated, #FFF);
        border: 1px solid var(--border, #DDE7E3);
        border-radius: var(--radius-md, 10px);
        box-shadow: 0 18px 50px rgba(0,0,0,0.22);
        width: 860px; max-width: 95vw; max-height: 88vh;
        display: flex; flex-direction: column; overflow: hidden;
      }
      .bt-hist-body { padding: 0; overflow: auto; flex: 1; min-height: 0; }
      .bt-snap-item {
        display: flex; align-items: center; gap: 14px;
        padding: 12px 18px; border-bottom: 1px solid var(--border, #DDE7E3);
        cursor: pointer; transition: background-color 120ms;
      }
      .bt-snap-item:hover { background: var(--bg-sunken, #F3F6FA); }
      .bt-snap-data { font-family: var(--font-mono); font-size: 12px; color: var(--primary); font-weight: 700; width: 130px; flex-shrink: 0; }
      .bt-snap-motivo { flex: 1; font-size: 13px; color: var(--ink); }
      .bt-snap-sub { font-size: 11px; color: var(--ink-soft); margin-top: 2px; }
      .bt-snap-badge {
        font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 20px;
        background: var(--primary-soft, #EEF1FF); color: var(--primary); flex-shrink: 0;
      }
      .bt-diff-tab { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      .bt-diff-tab thead th {
        position: sticky; top: 0; background: var(--primary, #00003D); color: #F1F7F7;
        font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase;
        padding: 9px 12px; text-align: left;
      }
      .bt-diff-tab thead th.num { text-align: right; }
      .bt-diff-tab tbody td { padding: 8px 12px; border-bottom: 1px solid var(--border, #DDE7E3); }
      .bt-diff-tab tbody td.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
      .bt-diff-antes { color: var(--danger, #9B3A3A); text-decoration: line-through; }
      .bt-diff-depois { color: #0A7A5A; font-weight: 700; }
      .bt-diff-seta { color: var(--ink-faint); text-align: center; }
      .bt-vazio { padding: 40px 18px; text-align: center; color: var(--ink-soft); font-size: 13px; }
      /* V566: badge da versão em exibição, no subtítulo */
      .bt-sub-versao {
        display: inline-block; margin-left: 10px; padding: 2px 10px;
        border-radius: 999px; font-size: 11px; font-weight: 700;
        letter-spacing: 0.03em; vertical-align: 1px;
      }
      .bt-sub-versao:empty { display: none; }
      .bt-sub-versao.vig  { background: rgba(16, 125, 172, 0.12); color: #107DAC; border: 1px solid rgba(16, 125, 172, 0.35); }
      .bt-sub-versao.rasc { background: rgba(176, 122, 10, 0.12); color: #8A5E00; border: 1px solid rgba(176, 122, 10, 0.35); }
      .bt-sub-versao.hist { background: rgba(2, 26, 28, 0.08); color: #032C2E; border: 1px solid rgba(2, 26, 28, 0.25); }
      /* V565: painel de versões (ícone flutuante) */
      .bt-ver-linha {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--bg-sunken, #E8F1F7);
        font-size: 13px;
      }
      .bt-ver-linha:last-child { border-bottom: none; }
    </style>
  `;

  document.getElementById('conteudo').innerHTML = html;

  // ==========================================================================
  // V489: TRAVA DA BASE TABELA (cadeado + motivo) e SNAPSHOTS
  //
  // Regras (confirmadas com o usuário):
  //   • Senha = a mesma do login (Auth.verificarSenha)
  //   • Destrava até SAIR da tela Base Tabela (ao reentrar, trava de novo)
  //   • Protege: edição de célula, novo/excluir procedimento, importações,
  //     casar por similaridade, remover duplicados e limpar base
  //   • Motivo é pedido UMA VEZ, no desbloqueio, e vale para a sessão toda
  //   • Um snapshot por sessão de desbloqueio, agrupando as alterações
  // ==========================================================================

  const BT_MOTIVOS = [
    'Correção de erro de cadastro',
    'Reajuste de valores / nova tabela',
    'Renegociação com convênio',
    'Solicitação da diretoria',
    'Outro',
  ];

  let btDestravado   = false;   // sessão de desbloqueio ativa?
  let btMotivo       = null;    // motivo escolhido na lista
  let btMotivoOutro  = null;    // texto livre quando motivo = 'Outro'
  let btSnapshotId   = null;    // criado só na 1ª alteração da sessão
  let btOrigens      = new Set();

  // ── V490: botões flutuantes (FAB) abaixo do fichário (#atlas-hub) ────────
  // Ficam fora do #conteudo (em .main) para não serem coletados pelo leque do
  // fichário — antes o cadeado virava a fita "TRAVADO" ao lado do globo.
  (function montarFabsBaseTabela() {
    document.querySelectorAll('#bt-fab-cadeado, #bt-fab-historico, #bt-fab-versoes, #bt-fab-check').forEach(el => el.remove());
    const main = document.querySelector('.main');
    if (!main) return;

    const fabCad = document.createElement('button');
    fabCad.id = 'bt-fab-cadeado';
    fabCad.className = 'bt-fab travado';
    fabCad.innerHTML = '<i class="ti ti-lock"></i>';
    main.appendChild(fabCad);

    const fabHist = document.createElement('button');
    fabHist.id = 'bt-fab-historico';
    fabHist.className = 'bt-fab';
    fabHist.title = 'Histórico de alterações da Base Tabela';
    fabHist.innerHTML = '<i class="ti ti-history"></i>';
    main.appendChild(fabHist);

    // V565: ícone de VERSÕES — todos os informativos e a consulta às versões
    // publicadas moram aqui (nada aparece solto na tela)
    const fabVer = document.createElement('button');
    fabVer.id = 'bt-fab-versoes';
    fabVer.className = 'bt-fab';
    fabVer.title = 'Versões da Base Tabela';
    fabVer.innerHTML = '<i class="ti ti-versions"></i>';
    main.appendChild(fabVer);

    // V641: CHECK DE REGRA — simula uma linha (estrutura da matriz de
    // Relatórios) no motor real e mostra qual VERSÃO da tabela se aplica
    const fabCheck = document.createElement('button');
    fabCheck.id = 'bt-fab-check';
    fabCheck.className = 'bt-fab';
    fabCheck.title = 'Check de regra — preencha uma linha e veja qual versão da tabela se aplica';
    fabCheck.innerHTML = '<i class="ti ti-flask"></i>';
    main.appendChild(fabCheck);

    // V783: o "Deseja salvar?" deixou de ser o confirm() cru do navegador —
    // é um diálogo na paleta do ATLAS (mesma família do modal do cadeado).
    function btConfirmarSalvarMudancas() {
      return new Promise((resolve) => {
        const ov = document.createElement('div');
        ov.className = 'bt-trava-overlay';
        ov.id = 'bt-salvar-dialog';
        ov.innerHTML = `
          <div class="bt-trava-modal" role="dialog" aria-modal="true" style="width:420px">
            <div class="bt-trava-head">
              <span style="font-size:16px">💾</span>
              <h3>Salvar mudanças</h3>
              <button class="bt-trava-close" id="bt-salvar-x" title="Fechar">✕</button>
            </div>
            <div class="bt-trava-body">
              <div class="bt-trava-aviso">
                Deseja <strong>salvar as mudanças aplicadas</strong> na Base Tabela?
                O banco é gravado agora — os novos valores valem já na próxima abertura da ferramenta.
              </div>
            </div>
            <div class="bt-trava-foot">
              <button class="btn" id="bt-salvar-nao">Agora não</button>
              <button class="btn btn-primary" id="bt-salvar-sim">💾 Salvar mudanças</button>
            </div>
          </div>`;
        const fim = (v) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
        function onKey(e) { if (e.key === 'Escape') fim(false); }
        document.addEventListener('keydown', onKey);
        ov.addEventListener('click', (e) => { if (e.target === ov) fim(false); });
        ov.querySelector('#bt-salvar-x').onclick = () => fim(false);
        ov.querySelector('#bt-salvar-nao').onclick = () => fim(false);
        ov.querySelector('#bt-salvar-sim').onclick = () => fim(true);
        document.body.appendChild(ov);
        ov.querySelector('#bt-salvar-sim').focus();
      });
    }

    fabCad.addEventListener('click', async () => {
      if (btDestravado) {
        btDestravado = false;
        btMotivo = null; btMotivoOutro = null; btSnapshotId = null; btOrigens = new Set();
        btAtualizarCadeado();
        // V782: TRAVAR é o momento de PERSISTIR. O executar() não salva
        // sozinho (o debounce podia se perder ao fechar o app) — edições
        // feitas com o cadeado aberto sumiam ao abrir a ferramenta de novo.
        // Agora o clique de travar pergunta e grava o banco na hora.
        if (await btConfirmarSalvarMudancas()) {
          try {
            await Banco.salvar({ imediato: true });
            Utilidades.toast('🔒 Base Tabela travada · mudanças salvas', 'success', 2600);
          } catch (e) {
            console.error('[base-tabela] salvar ao travar:', e);
            Utilidades.toast('Base travada, mas o salvamento falhou: ' + (e.message || e), 'error', 5000);
          }
        } else {
          Utilidades.toast('Base Tabela travada (sem salvamento imediato)', 'info', 2600);
        }
      } else {
        btAbrirModalTrava(null);
      }
    });
    fabHist.addEventListener('click', () => btAbrirHistorico());
    fabVer.addEventListener('click', () => abrirPainelVersoes());
    fabCheck.addEventListener('click', () => btAbrirCheckRegra());
  })();

  // ── V641: CHECK DE REGRA (simulador de linha da matriz de Relatórios) ────
  // Preenche-se uma linha com as MESMAS colunas do Consolidado dos Relatórios;
  // a cada tecla o MOTOR REAL do Calcular (AtlasSimulador) aplica a regra e
  // mostra Status, Valor e V.TAB — o check preventivo de qual versão paga.
  function btAbrirCheckRegra() {
    // V642: o Check de regra virou módulo GLOBAL (js/check_regra.js) — também
    // acessível no leque dos Relatórios. Aqui só delega.
    if (window.AtlasCheckRegra) window.AtlasCheckRegra.abrir();
    else Utilidades.toast?.('Check de regra não carregado. Recarregue a página.', 'error', 4000);
  }
  function btAtualizarCadeado() {
    const b = document.getElementById('bt-fab-cadeado');
    if (!b) return;
    b.classList.toggle('travado', !btDestravado);
    b.classList.toggle('destravado', btDestravado);
    b.innerHTML = btDestravado
      ? '<i class="ti ti-lock-open"></i>'
      : '<i class="ti ti-lock"></i>';
    b.title = btDestravado
      ? 'Base Tabela liberada — clique para travar novamente'
      : 'Base Tabela protegida — clique para destravar';
  }

  // ── Snapshot: criado sob demanda, na primeira alteração da sessão ─────────
  function btGarantirSnapshot(origem) {
    btOrigens.add(origem);
    if (btSnapshotId) {
      Banco.executar('UPDATE bt_snapshots SET origem = ? WHERE id = ?',
        [btOrigens.size > 1 ? 'MISTO' : origem, btSnapshotId]);
      return btSnapshotId;
    }
    const agora = new Date();
    const iso = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 19).replace('T', ' ');
    const res = Banco.executar(
      `INSERT INTO bt_snapshots (criado_em, usuario, motivo, motivo_outro, origem)
       VALUES (?, ?, ?, ?, ?)`,
      [iso, (Auth.usuarioAtual && Auth.usuarioAtual()) || '—', btMotivo, btMotivoOutro, origem]
    );
    btSnapshotId = res.lastInsertRowId;
    return btSnapshotId;
  }

  function btRegistrar(origem, item, tlArea) {
    const snapId = btGarantirSnapshot(origem);
    const agora = new Date();
    const iso = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 19).replace('T', ' ');
    Banco.executar(
      `INSERT INTO bt_snapshot_itens
         (snapshot_id, quando, procedimento, papel, fonte_pagadora, acao,
          valor_antes, perc_antes, valor_depois, perc_depois)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [snapId, iso, item.procedimento || '—', item.papel || '—',
       item.fonte || '—', item.acao,
       item.valorAntes ?? null, item.percAntes ?? null,
       item.valorDepois ?? null, item.percDepois ?? null]
    );
    // V664: espelho AUTOMÁTICO na Linha do Tempo com o antes → depois legível
    // (o evento agregado do dia é criado/atualizado pelo Banco._tlAutoFlush)
    try {
      const fmtV = (v, p) => v != null ? ('R$ ' + v) : (p != null ? (p + '%') : '—');
      if (Banco._tlAutoDetalhe) Banco._tlAutoDetalhe(tlArea || 'Base Tabela · valores de repasse',
        `${item.acao === 'INCLUSAO' ? '＋' : item.acao === 'EXCLUSAO' ? '✕' : '✎'} ${item.procedimento || '—'} · ${item.papel || '—'} · ${Utilidades.rotuloFonte(item.fonte) || '—'}: ${fmtV(item.valorAntes, item.percAntes)} → ${fmtV(item.valorDepois, item.percDepois)}`);
    } catch (_) {}
  }

  // Fotografa a base inteira (procedimento+papel+fonte → valor/percentual)
  function btCapturarEstado() {
    const linhas = Banco.query(
      `SELECT p.nome_oficial AS proc, pa.nome AS papel, t.fonte_pagadora AS fonte,
              t.valor AS valor, t.percentual AS perc
         FROM tabela_repasse t
         JOIN procedimentos p ON p.id = t.procedimento_id
         JOIN papeis       pa ON pa.id = t.papel_id`
    );
    const m = new Map();
    for (const l of linhas) {
      m.set(`${l.proc}\u0001${l.papel}\u0001${l.fonte}`, { valor: l.valor, perc: l.perc });
    }
    return m;
  }

  // Compara duas fotos e grava um item por diferença encontrada
  function btDiffEstados(antes, depois, origem) {
    let n = 0;
    const chaves = new Set([...antes.keys(), ...depois.keys()]);
    for (const k of chaves) {
      const a = antes.get(k) || null;
      const d = depois.get(k) || null;
      const igual = a && d
        && Number(a.valor ?? -1) === Number(d.valor ?? -1)
        && Number(a.perc  ?? -1) === Number(d.perc  ?? -1);
      if (igual) continue;
      const [proc, papel, fonte] = k.split('\u0001');
      btRegistrar(origem, {
        procedimento: proc, papel, fonte,
        acao: !a ? 'INCLUSAO' : (!d ? 'EXCLUSAO' : 'ALTERACAO'),
        valorAntes:  a ? a.valor : null,
        percAntes:   a ? a.perc  : null,
        valorDepois: d ? d.valor : null,
        percDepois:  d ? d.perc  : null,
      });
      n++;
    }
    return n;
  }

  // ── Pop-up de destrave: passo 1 senha → passo 2 motivo ───────────────────
  // V565: com versão publicada e sem rascunho, alterações EM MASSA pedem
  // "Criar nova versão". V572: AJUSTES FINOS (célula, USAR, nomenclatura,
  // classificação, excluir/novo procedimento) são permitidos direto — entram
  // no histórico e sincronizam o snapshot da versão vigente.
  function versaoEditavel() {
    try {
      if (!window.AtlasVersoesTabela) return true;
      const vs = AtlasVersoesTabela.listar();
      return !vs.length || AtlasVersoesTabela.temRascunho();
    } catch (_) { return true; }
  }
  // sincroniza a edição pontual no snapshot da versão vigente (V572)
  function sincVer(procId) {
    try { if (window.AtlasVersoesTabela) AtlasVersoesTabela.sincronizarProcNaUltimaVersao(procId); } catch (_) {}
  }

  // ── V666: EDIÇÃO DE QUALQUER VERSÃO PUBLICADA ────────────────────────────
  // A versão exibida na grade deixa de ser somente leitura: as edições gravam
  // DIRETO no snapshot congelado (tabela_repasse_hist / procedimentos_hist)
  // daquela versão. Exceção: se a versão exibida é a ÚLTIMA e não há rascunho
  // aberto, a tabela viva é espelho fiel dela (V572) — a edição cai no caminho
  // normal (viva + sincVer), que mantém viva e snapshot idênticos.
  const BT_TL_AREA_VERSOES = 'Base Tabela · versões publicadas';
  function versaoEspelhoDaViva(vid) {
    try {
      const vs = AtlasVersoesTabela.listar();
      return !!vs.length && vs[vs.length - 1].id === Number(vid) && !AtlasVersoesTabela.temRascunho();
    } catch (_) { return false; }
  }
  function numeroDaVersao(vid) {
    try { return (Banco.queryUnica(`SELECT numero FROM tabela_versoes WHERE id = ?`, [vid]) || {}).numero || '?'; }
    catch (_) { return '?'; }
  }
  function nomeProcNaVersao(vid, procId) {
    try {
      const r = Banco.queryUnica(`SELECT nome_oficial FROM procedimentos_hist WHERE versao_id = ? AND procedimento_id = ?`, [vid, procId])
             || Banco.queryUnica(`SELECT nome_oficial FROM procedimentos WHERE id = ?`, [procId]);
      return (r && r.nome_oficial) || '—';
    } catch (_) { return '—'; }
  }
  // depois de mexer num snapshot: invalida os caches do motor (aux do Calcular,
  // regrasDaVersao) e os consolidados não congelados — mesmo trio do V637
  function invalidarPosEdicaoVersao() {
    Banco._versao = (Banco._versao || 0) + 1;
    try { window.__atlasInvalidarAux && window.__atlasInvalidarAux(); } catch (_) {}
    try { window.AtlasRelatorios && AtlasRelatorios.invalidarConsolidado && AtlasRelatorios.invalidarConsolidado(); } catch (_) {}
  }
  // conta + detalha a mudança na Linha do Tempo (área própria das versões;
  // as tabelas *_hist não são vigiadas pelo hook automático de propósito —
  // o publicar faz INSERT em massa e poluiria o registro)
  function tlEdicaoVersao(numero, texto) {
    try {
      if (Banco._tlAutoContar) Banco._tlAutoContar(BT_TL_AREA_VERSOES, 1);
      if (Banco._tlAutoDetalhe) Banco._tlAutoDetalhe(BT_TL_AREA_VERSOES, `Versão ${numero} · ${texto}`);
    } catch (_) {}
  }
  // guard das operações EM MASSA (importações, dedup, casar, limpar, reajustes)
  function bulkBloqueado() {
    if (versaoEditavel()) return false;
    const ult = (AtlasVersoesTabela.listar().slice(-1)[0] || {}).numero || '';
    Utilidades.toast(`A Versão ${ult} está publicada. Alterações em massa pedem "Criar nova versão" — ajustes finos podem ser feitos direto na grade.`, 'info', 4600);
    return true;
  }

  function btAbrirModalTrava(aoDestravar) {
    const ov = document.createElement('div');
    ov.className = 'bt-trava-overlay';
    let passo = 1;
    let motivoSel = null;

    function render() {
      ov.innerHTML = `
        <div class="bt-trava-modal" role="dialog" aria-modal="true">
          <div class="bt-trava-head">
            <span style="font-size:16px">${passo === 1 ? '🔒' : '📝'}</span>
            <h3>Desbloquear Base Tabela</h3>
            <button class="bt-trava-close" id="bt-trava-x" title="Cancelar">✕</button>
          </div>
          <div class="bt-trava-body">
            <div class="bt-trava-passos">
              <div class="bt-trava-passo ${passo === 1 ? 'ativo' : ''}">1 · Senha</div>
              <div class="bt-trava-passo ${passo === 2 ? 'ativo' : ''}">2 · Motivo da mudança</div>
            </div>
            ${passo === 1 ? `
              <div class="bt-trava-aviso">
                Alterações na Base Tabela afetam o cálculo do repasse. Informe a senha de
                acesso para liberar a edição — tudo o que for alterado ficará registrado.
              </div>
              <label class="bt-trava-lbl" for="bt-trava-senha">Senha de acesso</label>
              <input type="password" class="bt-trava-input" id="bt-trava-senha"
                     placeholder="Digite sua senha" autocomplete="current-password">
              <div class="bt-trava-erro" id="bt-trava-erro"></div>
            ` : `
              <div class="bt-trava-aviso">
                Este motivo será gravado no histórico junto com o antes × depois de cada
                valor alterado nesta sessão.
              </div>
              <label class="bt-trava-lbl">Motivo da mudança</label>
              <div class="bt-motivos">
                ${BT_MOTIVOS.map((m, i) => `
                  <label class="bt-motivo-op ${motivoSel === m ? 'sel' : ''}" data-motivo="${escapeHTML(m)}">
                    <input type="radio" name="bt-motivo" value="${escapeHTML(m)}"
                           ${motivoSel === m ? 'checked' : ''}>
                    <span>${escapeHTML(m)}</span>
                  </label>
                `).join('')}
              </div>
              <div id="bt-outro-wrap" style="margin-top:12px; display:${motivoSel === 'Outro' ? 'block' : 'none'}">
                <label class="bt-trava-lbl" for="bt-trava-outro">Descreva o motivo</label>
                <input type="text" class="bt-trava-input" id="bt-trava-outro"
                       placeholder="Ex.: ajuste solicitado pelo setor de faturamento" maxlength="200">
              </div>
              <div class="bt-trava-erro" id="bt-trava-erro"></div>
            `}
          </div>
          <div class="bt-trava-foot">
            <button class="btn" id="bt-trava-cancelar">Cancelar</button>
            <button class="btn btn-primary" id="bt-trava-ok">
              ${passo === 1 ? 'Continuar →' : '🔓 Destravar'}
            </button>
          </div>
        </div>`;
      bind();
    }

    function fechar() { ov.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') fechar(); }

    function bind() {
      ov.querySelector('#bt-trava-x').onclick = fechar;
      ov.querySelector('#bt-trava-cancelar').onclick = fechar;

      if (passo === 1) {
        const inp = ov.querySelector('#bt-trava-senha');
        inp.focus();
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmar(); });
      } else {
        ov.querySelectorAll('.bt-motivo-op').forEach(op => {
          op.addEventListener('click', () => {
            motivoSel = op.dataset.motivo;
            ov.querySelectorAll('.bt-motivo-op').forEach(o => o.classList.toggle('sel', o === op));
            ov.querySelector('input[value="' + CSS.escape(motivoSel) + '"]').checked = true;
            const wrap = ov.querySelector('#bt-outro-wrap');
            wrap.style.display = motivoSel === 'Outro' ? 'block' : 'none';
            if (motivoSel === 'Outro') ov.querySelector('#bt-trava-outro').focus();
          });
        });
      }
      ov.querySelector('#bt-trava-ok').onclick = confirmar;
    }

    async function confirmar() {
      const erro = ov.querySelector('#bt-trava-erro');
      if (passo === 1) {
        const senha = ov.querySelector('#bt-trava-senha').value;
        if (!senha) { erro.textContent = 'Informe a senha.'; return; }
        const ok = await Auth.verificarSenha(senha);
        if (!ok) {
          erro.textContent = 'Senha incorreta.';
          ov.querySelector('#bt-trava-senha').select();
          return;
        }
        passo = 2;
        render();
        return;
      }
      // passo 2 — motivo
      if (!motivoSel) { erro.textContent = 'Escolha o motivo da mudança.'; return; }
      let outro = null;
      if (motivoSel === 'Outro') {
        outro = ov.querySelector('#bt-trava-outro').value.trim();
        if (!outro) { erro.textContent = 'Descreva o motivo.'; return; }
      }
      btDestravado  = true;
      btMotivo      = motivoSel;
      btMotivoOutro = outro;
      btSnapshotId  = null;
      btOrigens     = new Set();
      fechar();
      btAtualizarCadeado();
      Utilidades.toast('Base Tabela destravada — alterações serão registradas', 'success', 3000);
      if (typeof aoDestravar === 'function') aoDestravar();
    }

    document.body.appendChild(ov);   // fora de .main (que tem transform)
    document.addEventListener('keydown', onKey);
    render();
  }

  // Guarda: executa a ação só se estiver destravado; senão pede o desbloqueio
  function btExigirDestrave(acao) {
    if (btDestravado) { acao(); return true; }
    btAbrirModalTrava(null);
    return false;
  }

  btAtualizarCadeado();

  // ── Histórico de snapshots ───────────────────────────────────────────────
  function btFmt(valor, perc) {
    if (perc != null) return Utilidades.formatarPercentual(Number(perc));
    if (valor != null) return Utilidades.formatarMoeda(Number(valor));
    return '—';
  }

  function btDataBonita(iso) {
    if (!iso) return { data: '—', hora: '' };
    const [d, h] = String(iso).split(' ');
    const [a, m, dia] = (d || '').split('-');
    return { data: `${dia}/${m}/${a}`, hora: (h || '').slice(0, 5) };
  }

  function btAbrirHistorico() {
    const snaps = Banco.query(
      `SELECT s.*, (SELECT COUNT(*) FROM bt_snapshot_itens i WHERE i.snapshot_id = s.id) AS qtd
         FROM bt_snapshots s
        ORDER BY s.id DESC`
    );

    const ov = document.createElement('div');
    ov.className = 'bt-trava-overlay';
    ov.innerHTML = `
      <div class="bt-hist-modal" role="dialog" aria-modal="true">
        <div class="bt-trava-head">
          <span style="font-size:16px">🕓</span>
          <h3>Histórico de alterações — Base Tabela</h3>
          <button class="bt-trava-close" id="bt-hist-x" title="Fechar">✕</button>
        </div>
        <div class="bt-hist-body" id="bt-hist-body">
          ${snaps.length ? snaps.map(s => {
            const dt = btDataBonita(s.criado_em);
            const motivo = s.motivo === 'Outro' && s.motivo_outro
              ? `Outro — ${escapeHTML(s.motivo_outro)}`
              : escapeHTML(s.motivo || '—');
            return `
              <div class="bt-snap-item" data-snap="${s.id}">
                <div class="bt-snap-data">${dt.data}<br><span style="color:var(--ink-soft)">${dt.hora}</span></div>
                <div class="bt-snap-motivo">
                  ${motivo}
                  <div class="bt-snap-sub">${escapeHTML(s.usuario || '—')} · ${escapeHTML(s.origem || '—')}</div>
                </div>
                <div class="bt-snap-badge">${s.qtd} alteraç${s.qtd === 1 ? 'ão' : 'ões'}</div>
                <div style="color:var(--ink-faint)">›</div>
              </div>`;
          }).join('') : `<div class="bt-vazio">Nenhuma alteração registrada ainda.</div>`}
        </div>
        <div class="bt-trava-foot">
          <button class="btn" id="bt-hist-fechar">Fechar</button>
        </div>
      </div>`;

    function fechar() { ov.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') fechar(); }

    ov.querySelector('#bt-hist-x').onclick = fechar;
    ov.querySelector('#bt-hist-fechar').onclick = fechar;
    ov.querySelectorAll('.bt-snap-item').forEach(it => {
      it.addEventListener('click', () => btAbrirDetalheSnapshot(Number(it.dataset.snap)));
    });

    document.body.appendChild(ov);
    document.addEventListener('keydown', onKey);
  }

  function btAbrirDetalheSnapshot(snapId) {
    const s = Banco.queryUnica('SELECT * FROM bt_snapshots WHERE id = ?', [snapId]);
    if (!s) return;
    const itens = Banco.query(
      'SELECT * FROM bt_snapshot_itens WHERE snapshot_id = ? ORDER BY id', [snapId]
    );
    const dt = btDataBonita(s.criado_em);
    const motivo = s.motivo === 'Outro' && s.motivo_outro
      ? `Outro — ${escapeHTML(s.motivo_outro)}`
      : escapeHTML(s.motivo || '—');

    const ov = document.createElement('div');
    ov.className = 'bt-trava-overlay';
    ov.innerHTML = `
      <div class="bt-hist-modal" role="dialog" aria-modal="true">
        <div class="bt-trava-head">
          <span style="font-size:16px">📄</span>
          <h3>Snapshot #${snapId}</h3>
          <button class="bt-trava-close" id="bt-det-x" title="Fechar">✕</button>
        </div>
        <div style="padding:14px 18px; border-bottom:1px solid var(--border,#DDE7E3); background:var(--bg-sunken,#F7F9FC)">
          <div style="display:flex; gap:26px; flex-wrap:wrap; font-size:12.5px">
            <div><span style="color:var(--ink-soft)">Data</span><br><strong>${dt.data}</strong></div>
            <div><span style="color:var(--ink-soft)">Horário</span><br><strong>${dt.hora}</strong></div>
            <div><span style="color:var(--ink-soft)">Usuário</span><br><strong>${escapeHTML(s.usuario || '—')}</strong></div>
            <div><span style="color:var(--ink-soft)">Origem</span><br><strong>${escapeHTML(s.origem || '—')}</strong></div>
            <div style="flex:1; min-width:200px"><span style="color:var(--ink-soft)">Motivo da mudança</span><br><strong>${motivo}</strong></div>
          </div>
        </div>
        <div class="bt-hist-body">
          ${itens.length ? `
            <table class="bt-diff-tab">
              <thead>
                <tr>
                  <th>Procedimento</th><th>Papel</th><th>Fonte</th><th>Ação</th>
                  <th class="num">Antes</th><th></th><th class="num">Depois</th>
                </tr>
              </thead>
              <tbody>
                ${itens.map(i => `
                  <tr>
                    <td>${escapeHTML(i.procedimento || '—')}</td>
                    <td>${escapeHTML(i.papel || '—')}</td>
                    <td>${i.fonte_pagadora ? Utilidades.badgeFonte(i.fonte_pagadora) : '—'}</td><!-- V947 -->
                    <td>${escapeHTML(i.acao || '—')}</td>
                    <td class="num"><span class="bt-diff-antes">${btFmt(i.valor_antes, i.perc_antes)}</span></td>
                    <td class="bt-diff-seta">→</td>
                    <td class="num"><span class="bt-diff-depois">${btFmt(i.valor_depois, i.perc_depois)}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : `<div class="bt-vazio">Sessão sem alterações registradas.</div>`}
        </div>
        <div class="bt-trava-foot">
          <button class="btn" id="bt-det-fechar">Fechar</button>
        </div>
      </div>`;

    function fechar() { ov.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') fechar(); }
    ov.querySelector('#bt-det-x').onclick = fechar;
    ov.querySelector('#bt-det-fechar').onclick = fechar;

    document.body.appendChild(ov);
    document.addEventListener('keydown', onKey);
  }

  // V490: o Histórico agora é o FAB #bt-fab-historico (abaixo do cadeado)

  // ==========================================================================
  // EVENTOS GERAIS (upload + novo procedimento)
  // ==========================================================================

  const inputArquivo = document.getElementById('upload-base-tabela');
  const btnUpload = document.getElementById('btn-upload-base');
  const btnNovo = document.getElementById('btn-novo-proc');

  btnUpload.addEventListener('click', () => {
    if (bulkBloqueado()) return;                              // V572
    if (!btDestravado) { btAbrirModalTrava(null); return; }   // V489
    inputArquivo.click();
  });

  // V556: exporta a Base Tabela completa em Excel — uma linha por
  // procedimento × fonte (Convênio/Particular/SUS), com Categoria e
  // Subespecialidade da Produção, nomenclatura, flag USAR e os valores por
  // papel (R$ fixo ou % conforme cadastrado).
  // ── V563/V565: CICLO DE VERSÕES da Base Tabela ───────────────────────────
  // Um único botão no cabeçalho, que alterna:
  //   sem versão publicada      → "Publicar versão"  (publica a 1.0, a base)
  //   publicada + sem rascunho  → "Criar nova versão" (abre a cópia editável)
  //   rascunho aberto           → "Publicar versão"  (congela como N.0)
  const fmtHojeBR = () => {
    const h = new Date();
    return `${String(h.getDate()).padStart(2, '0')}/${String(h.getMonth() + 1).padStart(2, '0')}/${h.getFullYear()}`;
  };
  const fmtISOBR = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || ''); };

  function abrirModalPublicarVersao(versoes) {
    const temRegra = Banco.queryUnica(`SELECT 1 AS um FROM tabela_repasse LIMIT 1`);
    if (!temRegra || !temRegra.um) { Utilidades.toast?.('Base tabela vazia — nada para publicar.', 'error', 3500); return; }
    const proxima = AtlasVersoesTabela.proximoNumero();   // V568: MAX+1 (sobrevive a exclusões)
    const hoje = new Date();
    const hojeISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    const ehPrimeira = versoes.length === 0;
    const ov = document.createElement('div');
    ov.className = 'bt-tipo-overlay';
    ov.innerHTML = `
      <div class="bt-tipo-modal">
        <h3 style="margin: 0 0 10px">🏷 Publicar Versão ${proxima}</h3>
        <p style="font-size: 13px; color: var(--ink-soft); margin: 0 0 10px">
          ${ehPrimeira
            ? `A tabela atual será publicada como <strong>Versão 1.0</strong> — a base de todos os cálculos.
               Depois de publicada, a tabela fica travada — para alterar, use "Criar nova versão".`
            : `O rascunho será congelado como <strong>Versão ${proxima}</strong>. Admissões anteriores à
               vigência continuam pagas pela versão da época; admissões <strong>da data escolhida em
               diante</strong> (o dia já conta) usam a Versão ${proxima}.`}
          A publicação entra automaticamente na Linha do tempo.
        </p>
        <!-- V587: agendamento — a vigência pode ser hoje, futura ou retroativa -->
        <label class="small" style="display: block; margin-bottom: 6px">Data de vigência da publicação</label>
        <input type="date" id="bt-pub-data" class="input" style="width: 190px" value="${hojeISO}">
        <div id="bt-pub-nota" class="small" style="margin: 8px 0 14px; color: var(--ink-soft)"></div>
        <div style="display: flex; justify-content: flex-end; gap: 10px">
          <button class="btn" id="bt-pub-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="bt-pub-confirmar">Publicar Versão ${proxima}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const inpData = ov.querySelector('#bt-pub-data');
    const nota = ov.querySelector('#bt-pub-nota');
    const btnOk = ov.querySelector('#bt-pub-confirmar');
    const atualizarNota = () => {
      const d = inpData.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { nota.innerHTML = '<span style="color: var(--danger, #9B3A3A)">Escolha uma data válida.</span>'; btnOk.disabled = true; return; }
      btnOk.disabled = false;
      const br = fmtISOBR(d);
      if (d === hojeISO) nota.textContent = `Vigente a partir de hoje (${br}).`;
      else if (d > hojeISO) nota.innerHTML = `📅 <strong>Publicação agendada:</strong> a Versão ${proxima} passa a valer para admissões a partir de ${br}; até lá, segue valendo a versão atual.`;
      else nota.innerHTML = `<span style="color: var(--danger, #9B3A3A)">⚠ Data no passado: admissões desde ${br} passam a ser pagas pela Versão ${proxima} (efeito retroativo nos recálculos).</span>`;
    };
    inpData.addEventListener('input', atualizarNota);
    atualizarNota();
    ov.querySelector('#bt-pub-cancelar').addEventListener('click', () => ov.remove());
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    btnOk.addEventListener('click', async () => {
      const dataEsc = inpData.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataEsc)) return;
      btnOk.disabled = true; btnOk.textContent = 'Publicando…';
      try {
        const v = await AtlasVersoesTabela.publicar(dataEsc);
        ov.remove();
        Utilidades.toast?.(`✓ Versão ${v.numero} publicada — vigência a partir de ${fmtISOBR(v.data_vigencia)}${v.data_vigencia > hojeISO ? ' (agendada)' : ''}. Evento adicionado à Linha do tempo.`, 'success', 4600);
        App.navegarPara('base-tabela');   // atualiza rótulo do botão + estado travado
      } catch (e) {
        console.error('[base-tabela] publicar versão:', e);
        ov.remove();
        Utilidades.toast?.('Erro ao publicar versão: ' + (e.message || e), 'error', 5000);
      }
    });
  }

  function abrirModalCriarVersao(versoes) {
    const ult = versoes[versoes.length - 1];
    const proxima = AtlasVersoesTabela.proximoNumero();   // V568
    const ov = document.createElement('div');
    ov.className = 'bt-tipo-overlay';
    ov.innerHTML = `
      <div class="bt-tipo-modal">
        <h3 style="margin: 0 0 10px">📄 Criar nova versão (${proxima})</h3>
        <p style="font-size: 13px; color: var(--ink-soft); margin: 0 0 8px">
          Será aberto um rascunho que <strong>repete tudo</strong> da Versão ${ult.numero}
          (valores, USAR, nomenclatura e classificação) e permite alterar o que precisar.
        </p>
        <p style="font-size: 13px; color: var(--ink-soft); margin: 0 0 14px">
          As alterações só valem para o cálculo quando você <strong>publicar</strong> a
          Versão ${proxima} — até lá, tudo continua sendo pago pela Versão ${ult.numero}.
        </p>
        <div style="display: flex; justify-content: flex-end; gap: 10px">
          <button class="btn" id="bt-cri-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="bt-cri-confirmar">Criar nova versão</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#bt-cri-cancelar').addEventListener('click', () => ov.remove());
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    ov.querySelector('#bt-cri-confirmar').addEventListener('click', async () => {
      try {
        AtlasVersoesTabela.criarRascunho();
        await Banco.salvar();
        ov.remove();
        Utilidades.toast?.(`✓ Rascunho da Versão ${proxima} aberto — cópia fiel da Versão ${ult.numero}. Altere o que precisar e clique em "Publicar versão".`, 'success', 4600);
        App.navegarPara('base-tabela');
      } catch (e) {
        console.error('[base-tabela] criar versão:', e);
        ov.remove();
        Utilidades.toast?.('Erro ao criar versão: ' + (e.message || e), 'error', 5000);
      }
    });
  }

  const btnVersao = document.getElementById('btn-versao-base');
  if (btnVersao) btnVersao.addEventListener('click', () => {
    if (!window.AtlasVersoesTabela) { Utilidades.toast?.('Módulo de versões não carregado.', 'error', 3500); return; }
    const versoes = AtlasVersoesTabela.listar();
    if (versoes.length && !AtlasVersoesTabela.temRascunho()) abrirModalCriarVersao(versoes);
    else abrirModalPublicarVersao(versoes);
  });

  // ── V567: REAJUSTE % DA TABELA CONVÊNIO (impostos e afins) ───────────────
  // Memória de cálculo: valor novo = (valor atual × %) + valor atual, com
  // arredondamento em 2 casas. Incide nas linhas de valor da tabela CONVÊNIO
  // (todos os papéis); Particular e SUS ficam intocados. Só aumento (% > 0).
  // Exige rascunho aberto (ciclo de versões) e cadeado destravado — cada valor
  // alterado entra no histórico (antes × depois).
  // V570: dois modos — REAJUSTE GERAL (toda a tabela Convênio) e REAJUSTE POR
  // ESPECIALIDADE (mesma lógica, restrito a uma Subespecialidade escolhida).
  // V571: o pop-up do Reajuste Especialidade tem DUAS visualizações — abas
  // CONVÊNIO e PARTICULAR — cada uma com seu reajuste próprio:
  //   • Convênio: % de aumento sobre os R$ da subespecialidade (memória de
  //     cálculo do reajuste geral);
  //   • Particular: define as % dos papéis DE MODO GERAL — o valor digitado
  //     em cada papel passa a ser a % de todos os procedimentos da
  //     subespecialidade naquele papel (só linhas em modo %, os R$ fixos do
  //     Particular não são tocados; papel deixado em branco não muda).
  function abrirModalReajuste(porEspecialidade) {
    const PAPEIS_RJ = ['Executante', 'Indicante', 'Solicitante', 'Auxiliar', 'Médico Laudo'];
    const carregarLinhas = (subesp) => Banco.query(`
      SELECT t.id, t.valor, p.nome_oficial AS proc, pap.nome AS papel
        FROM tabela_repasse t
        JOIN procedimentos p ON p.id = t.procedimento_id
        JOIN papeis pap ON pap.id = t.papel_id
       WHERE t.fonte_pagadora = 'CONVENIO' AND COALESCE(t.valor, 0) > 0
         ${subesp ? `AND TRIM(COALESCE(p.prod_subespecialidade, '')) = ?` : ''}
       ORDER BY p.nome_oficial, pap.nome`, subesp ? [subesp] : []) || [];
    // Particular em modo % (valor IS NULL): são essas linhas que a aba
    // Particular altera; R$ fixo do Particular fica de fora
    const carregarLinhasPart = (subesp) => Banco.query(`
      SELECT t.id, t.percentual, p.nome_oficial AS proc, pap.nome AS papel
        FROM tabela_repasse t
        JOIN procedimentos p ON p.id = t.procedimento_id
        JOIN papeis pap ON pap.id = t.papel_id
       WHERE t.fonte_pagadora = 'PARTICULAR' AND t.valor IS NULL AND t.percentual IS NOT NULL
         AND TRIM(COALESCE(p.prod_subespecialidade, '')) = ?
       ORDER BY p.nome_oficial, pap.nome`, [subesp]) || [];

    let subs = [];
    if (porEspecialidade) {
      garantirColunasClass();
      subs = (Banco.query(`SELECT DISTINCT TRIM(prod_subespecialidade) AS v FROM procedimentos
                            WHERE prod_subespecialidade IS NOT NULL AND TRIM(prod_subespecialidade) <> '' ORDER BY 1`) || []).map(r => r.v);
      if (!subs.length) { Utilidades.toast?.('Nenhum procedimento com Subespecialidade preenchida.', 'error', 3800); return; }
    } else if (!carregarLinhas(null).length) {
      Utilidades.toast?.('Nenhum valor de Convênio para reajustar.', 'error', 3500); return;
    }

    const calcNovo = (v, p) => Math.round(v * (1 + p / 100) * 100) / 100;
    const fmtPct = (frac) => Utilidades.formatarPercentual(Number(frac));
    const titulo = porEspecialidade ? '% Reajuste por Especialidade' : '% Reajuste Geral da Tabela Convênio';
    const ov = document.createElement('div');
    ov.className = 'bt-tipo-overlay';
    ov.innerHTML = `
      <div class="bt-tipo-modal" style="width: 520px">
        <h3 style="margin: 0 0 10px">${titulo}</h3>
        ${porEspecialidade ? `
        <label class="small" style="display: block; margin-bottom: 6px">Subespecialidade</label>
        <select id="rj-esp" class="input" style="width: 100%; margin-bottom: 12px">
          <option value="">— escolha a subespecialidade —</option>
          ${subs.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('')}
        </select>
        <div style="display: flex; gap: 4px; background: var(--bg-sunken); padding: 3px; border-radius: var(--radius-md); width: max-content; margin-bottom: 12px">
          <button class="btn-toggle active" id="rj-tab-conv">Convênio</button>
          <button class="btn-toggle" id="rj-tab-part">Particular</button>
        </div>` : ''}
        <div id="rj-pane-conv">
          <p class="small" style="color: var(--ink-soft); margin: 0 0 10px">
            Memória de cálculo: <strong>valor novo = (valor atual × %) + valor atual</strong>, arredondado em
            2 casas — ${porEspecialidade ? 'só nos R$ de <strong>Convênio</strong> da subespecialidade escolhida' : 'em toda a tabela Convênio'} (todos os papéis).
          </p>
          <label class="small" style="display: block; margin-bottom: 6px">Percentual do reajuste (somente aumento)</label>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px">
            <input type="text" id="rj-pct" class="input" style="width: 120px" placeholder="ex.: 8,5" autocomplete="off">
            <span style="font-weight: 700">%</span>
          </div>
        </div>
        ${porEspecialidade ? `
        <div id="rj-pane-part" style="display: none">
          <p class="small" style="color: var(--ink-soft); margin: 0 0 10px">
            Define a <strong>% de repasse de cada papel</strong> de modo geral, para todos os procedimentos
            da subespecialidade no <strong>Particular</strong>. Papel em branco não muda; linhas do Particular
            com R$ fixo não são tocadas.
          </p>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; margin-bottom: 12px">
            ${PAPEIS_RJ.map(pp => `
              <label class="small" style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
                <span>${pp}</span>
                <span style="display: flex; align-items: center; gap: 4px">
                  <input type="text" class="input rj-pct-papel" data-papel="${pp}" style="width: 78px" placeholder="—" autocomplete="off">
                  <strong>%</strong>
                </span>
              </label>`).join('')}
          </div>
        </div>` : ''}
        <div id="rj-previa" class="small" style="background: var(--bg-sunken, #E8F1F7); border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; min-height: 64px; color: var(--ink-soft)"></div>
        <div style="display: flex; justify-content: flex-end; gap: 10px">
          <button class="btn" id="rj-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="rj-aplicar" disabled>Aplicar reajuste</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const inp = ov.querySelector('#rj-pct');
    const selEsp = ov.querySelector('#rj-esp');
    const previa = ov.querySelector('#rj-previa');
    const btnAplicar = ov.querySelector('#rj-aplicar');
    const inputsPapel = [...ov.querySelectorAll('.rj-pct-papel')];
    let modo = 'CONV';                       // aba ativa: CONV | PART
    let linhas = porEspecialidade ? [] : carregarLinhas(null);
    let linhasPart = [];
    const lerPct = () => {
      const p = Utilidades.parseNumBR(inp.value, null);
      return (p != null && isFinite(p) && p > 0) ? p : null;
    };
    // papéis preenchidos na aba Particular → { papel: fração } (35 → 0.35)
    const lerPapeis = () => {
      const out = {};
      let invalido = false;
      for (const el of inputsPapel) {
        const txt = el.value.trim();
        if (!txt) continue;
        const p = Utilidades.parseNumBR(txt, null);
        if (p == null || !isFinite(p) || p <= 0 || p > 100) { invalido = true; continue; }
        out[el.dataset.papel] = Math.round(p * 10000) / 1000000;
      }
      return { valores: out, invalido, algum: Object.keys(out).length > 0 };
    };
    const atualizarPrevia = () => {
      if (porEspecialidade && !selEsp.value) {
        btnAplicar.disabled = true;
        previa.innerHTML = 'Escolha a subespecialidade para ver a prévia.';
        return;
      }
      if (modo === 'CONV') {
        linhas = porEspecialidade ? carregarLinhas(selEsp.value) : carregarLinhas(null);
        if (porEspecialidade && !linhas.length) {
          btnAplicar.disabled = true;
          previa.innerHTML = `<span style="color: var(--danger, #9B3A3A)">A subespecialidade "${escapeHTML(selEsp.value)}" não tem valores de Convênio para reajustar.</span>`;
          return;
        }
        const p = lerPct();
        if (p == null) {
          btnAplicar.disabled = true;
          previa.innerHTML = inp.value.trim()
            ? '<span style="color: var(--danger, #9B3A3A)">Percentual inválido — informe um número maior que zero (só aumento).</span>'
            : 'Digite o percentual para ver a prévia.';
          return;
        }
        btnAplicar.disabled = false;
        const fmt = (v) => Utilidades.formatarMoeda(v);
        const exemplos = linhas.slice(0, 3).map(l =>
          `<div>${escapeHTML(l.proc)} · ${escapeHTML(l.papel)}: <strong>${fmt(l.valor)}</strong> → <strong>${fmt(calcNovo(l.valor, p))}</strong></div>`).join('');
        previa.innerHTML = `
          <div style="margin-bottom: 6px"><strong>${linhas.length} valores</strong>${porEspecialidade ? ` de Convênio da subespecialidade <strong>${escapeHTML(selEsp.value)}</strong>` : ''} serão reajustados em <strong>${String(p).replace('.', ',')}%</strong>. Exemplos:</div>
          ${exemplos}`;
        return;
      }
      // aba PARTICULAR
      linhasPart = carregarLinhasPart(selEsp.value);
      if (!linhasPart.length) {
        btnAplicar.disabled = true;
        previa.innerHTML = `<span style="color: var(--danger, #9B3A3A)">A subespecialidade "${escapeHTML(selEsp.value)}" não tem percentuais de Particular para alterar (só linhas em modo % entram).</span>`;
        return;
      }
      const { valores, invalido, algum } = lerPapeis();
      if (invalido) {
        btnAplicar.disabled = true;
        previa.innerHTML = '<span style="color: var(--danger, #9B3A3A)">Percentual inválido em algum papel — use números entre 0 e 100.</span>';
        return;
      }
      if (!algum) {
        btnAplicar.disabled = true;
        previa.innerHTML = `Digite a nova % dos papéis que quer alterar (os demais ficam como estão). A subespecialidade tem <strong>${linhasPart.length} percentuais</strong> de Particular cadastrados.`;
        return;
      }
      const blocos = Object.entries(valores).map(([papel, frac]) => {
        const doPapel = linhasPart.filter(l => l.papel === papel);
        const ex = doPapel[0];
        return `<div><strong>${papel}</strong>: ${doPapel.length} procedimento${doPapel.length !== 1 ? 's' : ''} → <strong>${fmtPct(frac)}</strong>${ex ? ` <span class="muted">(ex.: ${escapeHTML(ex.proc)} ${fmtPct(ex.percentual)} → ${fmtPct(frac)})</span>` : ''}</div>`;
      }).join('');
      const total = Object.entries(valores).reduce((s, [papel]) => s + linhasPart.filter(l => l.papel === papel).length, 0);
      btnAplicar.disabled = total === 0;
      previa.innerHTML = `
        <div style="margin-bottom: 6px">Particular · subespecialidade <strong>${escapeHTML(selEsp.value)}</strong> — ${total} percentua${total === 1 ? 'l' : 'is'} ser${total === 1 ? 'á' : 'ão'} definido${total === 1 ? '' : 's'}:</div>
        ${blocos}
        ${total === 0 ? '<div style="color: var(--danger, #9B3A3A)">Nenhum procedimento da subespecialidade tem % cadastrada nos papéis preenchidos.</div>' : ''}`;
    };
    const trocarAba = (novo) => {
      modo = novo;
      ov.querySelector('#rj-tab-conv')?.classList.toggle('active', modo === 'CONV');
      ov.querySelector('#rj-tab-part')?.classList.toggle('active', modo === 'PART');
      const pc = ov.querySelector('#rj-pane-conv'), pp = ov.querySelector('#rj-pane-part');
      if (pc) pc.style.display = modo === 'CONV' ? '' : 'none';
      if (pp) pp.style.display = modo === 'PART' ? '' : 'none';
      atualizarPrevia();
    };
    inp.addEventListener('input', atualizarPrevia);
    inputsPapel.forEach(el => el.addEventListener('input', atualizarPrevia));
    if (selEsp) selEsp.addEventListener('change', atualizarPrevia);
    ov.querySelector('#rj-tab-conv')?.addEventListener('click', () => trocarAba('CONV'));
    ov.querySelector('#rj-tab-part')?.addEventListener('click', () => trocarAba('PART'));
    atualizarPrevia();
    setTimeout(() => (porEspecialidade ? selEsp : inp).focus(), 60);
    ov.querySelector('#rj-cancelar').addEventListener('click', () => ov.remove());
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    btnAplicar.addEventListener('click', async () => {
      btnAplicar.disabled = true; btnAplicar.textContent = 'Aplicando…';
      try {
        let n = 0, msg = '';
        Banco.executar('BEGIN');
        if (modo === 'CONV') {
          const p = lerPct();
          if (p == null || !linhas.length) { Banco.executar('ROLLBACK'); ov.remove(); return; }
          for (const l of linhas) {
            const novo = calcNovo(l.valor, p);
            Banco.executar(`UPDATE tabela_repasse SET valor = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`, [novo, l.id]);
            btRegistrar('EDICAO', { procedimento: l.proc, papel: l.papel, fonte: 'CONVENIO', acao: 'ALTERACAO',
                                    valorAntes: l.valor, valorDepois: novo });
            n++;
          }
          msg = `✓ Reajuste de ${String(p).replace('.', ',')}% aplicado em ${n} valores${porEspecialidade ? ` de Convênio da subespecialidade ${selEsp.value}` : ' da tabela Convênio'}.`;
        } else {
          const { valores } = lerPapeis();
          for (const l of linhasPart) {
            const frac = valores[l.papel];
            if (frac == null) continue;
            Banco.executar(`UPDATE tabela_repasse SET percentual = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`, [frac, l.id]);
            btRegistrar('EDICAO', { procedimento: l.proc, papel: l.papel, fonte: 'PARTICULAR', acao: 'ALTERACAO',
                                    percAntes: l.percentual, percDepois: frac });
            n++;
          }
          msg = `✓ Percentuais do Particular definidos em ${n} linha${n !== 1 ? 's' : ''} da subespecialidade ${selEsp.value}.`;
        }
        Banco.executar('COMMIT');
        await Banco.salvar();
        if (window.__atlasInvalidarAux) window.__atlasInvalidarAux();
        ov.remove();
        Utilidades.toast?.(`${msg} Confira e publique a versão para valer no cálculo.`, 'success', 5000);
        renderizarTabela();
      } catch (e) {
        try { Banco.executar('ROLLBACK'); } catch (_) {}
        console.error('[base-tabela] reajuste:', e);
        ov.remove();
        Utilidades.toast?.('Erro ao aplicar reajuste: ' + (e.message || e), 'error', 5000);
      }
    });
  }

  const guardaReajuste = (fn) => {
    if (!versaoEditavel()) {
      const ult = (AtlasVersoesTabela.listar().slice(-1)[0] || {}).numero || '';
      Utilidades.toast?.(`A Versão ${ult} está publicada. Clique em "Criar nova versão" para aplicar o reajuste no rascunho.`, 'info', 4200);
      return;
    }
    btExigirDestrave(fn);
  };
  const btnReajuste = document.getElementById('btn-reajuste-convenio');
  if (btnReajuste) btnReajuste.addEventListener('click', () => guardaReajuste(() => abrirModalReajuste(false)));
  const btnReajusteEsp = document.getElementById('btn-reajuste-esp');
  if (btnReajusteEsp) btnReajusteEsp.addEventListener('click', () => guardaReajuste(() => abrirModalReajuste(true)));

  // ── V565: PAINEL DE VERSÕES (ícone flutuante) — status + consulta ────────
  function abrirPainelVersoes() {
    if (!window.AtlasVersoesTabela) return;
    const versoes = AtlasVersoesTabela.listar();
    const rascunho = versoes.length && AtlasVersoesTabela.temRascunho();
    const ult = versoes[versoes.length - 1] || null;
    const status = !versoes.length
      ? 'Nenhuma versão publicada — a tabela atual será a base da <strong>Versão 1.0</strong>.'
      : rascunho
        ? `Rascunho da <strong>Versão ${AtlasVersoesTabela.proximoNumero()}</strong> aberto (cópia da Versão ${ult.numero}). As alterações só valem após publicar.`
        : (() => {
            const hj = new Date();
            const hjISO = `${hj.getFullYear()}-${String(hj.getMonth() + 1).padStart(2, '0')}-${String(hj.getDate()).padStart(2, '0')}`;
            if (ult.data_vigencia > hjISO) {
              const anterior = versoes.length > 1 ? versoes[versoes.length - 2] : null;
              return `<strong>Versão ${ult.numero}</strong> — 📅 agendada para ${fmtISOBR(ult.data_vigencia)}${anterior ? `; até lá vale a Versão ${anterior.numero}` : ''}. Ajustes finos podem ser feitos direto na grade; alterações em massa pedem "Criar nova versão".`;
            }
            return `<strong>Versão ${ult.numero}</strong> — vigência atual (desde ${fmtISOBR(ult.data_vigencia)}): vale para toda admissão daqui em diante, até publicar outra versão. Ajustes finos podem ser feitos direto na grade (entram no histórico e na versão); alterações em massa pedem "Criar nova versão".`;
          })();
    // V568: cada versão tem Ver + Exportar; a ÚLTIMA (sem rascunho aberto)
    // também pode ser excluída. Rascunho aberto pode ser descartado.
    const btnMini = (attrs, rotulo, vermelho) =>
      `<button class="btn" ${attrs} style="padding: 4px 12px; font-size: 12px${vermelho ? '; color: var(--danger, #9B3A3A)' : ''}">${rotulo}</button>`;
    const linhaVersao = (v) => {
      const ehUltima = ult && v.id === ult.id;
      return `
      <div class="bt-ver-linha">
        <div>
          <strong>Versão ${escapeHTML(v.numero)}</strong>
          <span class="small muted" style="margin-left: 8px">${(() => {
            const hj = new Date();
            const hjISO = `${hj.getFullYear()}-${String(hj.getMonth() + 1).padStart(2, '0')}-${String(hj.getDate()).padStart(2, '0')}`;
            if (ehUltima && v.data_vigencia > hjISO) return `📅 agendada para ${fmtISOBR(v.data_vigencia)}`;
            return ehUltima ? `vigência atual (desde ${fmtISOBR(v.data_vigencia)})` : `vigente desde ${fmtISOBR(v.data_vigencia)}`;
          })()}</span>
        </div>
        <div style="display: flex; gap: 6px">
          ${btnMini(`data-ver="${v.id}"`, 'Ver')}
          ${btnMini(`data-exp="${v.id}"`, 'Exportar')}
          ${btnMini(`data-vig="${v.id}"`, '📅 Vigência')}
          ${ehUltima && !rascunho ? btnMini(`data-del="${v.id}"`, 'Excluir', true) : ''}
        </div>
      </div>`;
    };
    const ov = document.createElement('div');
    ov.className = 'bt-tipo-overlay';
    ov.innerHTML = `
      <div class="bt-tipo-modal" style="width: 560px">
        <h3 style="margin: 0 0 10px">🗂 Versões da Base Tabela</h3>
        <p style="font-size: 13px; color: var(--ink-soft); margin: 0 0 14px">${status}</p>
        <div style="max-height: 300px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px">
          <div class="bt-ver-linha">
            <div><strong>Tabela atual</strong><span class="small muted" style="margin-left: 8px">${rascunho ? 'rascunho em edição' : versoes.length ? 'igual à última versão publicada' : 'base em preparação'}</span></div>
            <div style="display: flex; gap: 6px">
              ${btnMini(`data-ver=""`, 'Ver')}
              ${btnMini(`data-exp=""`, 'Exportar')}
              ${rascunho ? btnMini(`id="bt-ver-descartar"`, 'Descartar rascunho', true) : ''}
            </div>
          </div>
          ${versoes.slice().reverse().map(linhaVersao).join('')}
        </div>
        <div style="display: flex; justify-content: flex-end; margin-top: 14px">
          <button class="btn" id="bt-ver-fechar">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#bt-ver-fechar').addEventListener('click', () => ov.remove());
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    ov.querySelectorAll('button[data-ver]').forEach(b => b.addEventListener('click', () => {
      versaoVisao = b.dataset.ver ? Number(b.dataset.ver) : null;
      ov.remove();
      renderizarTabela();
    }));
    // V568: exportar por versão (vazio = tabela atual)
    ov.querySelectorAll('button[data-exp]').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.exp ? versoes.find(x => x.id === Number(b.dataset.exp)) : null;
      exportarBaseExcel(v || null);
    }));
    // V637: editar a DATA DE VIGÊNCIA de qualquer versão publicada
    ov.querySelectorAll('button[data-vig]').forEach(b => b.addEventListener('click', () => {
      const v = versoes.find(x => x.id === Number(b.dataset.vig));
      if (!v) return;
      const ov2 = document.createElement('div');
      ov2.className = 'bt-tipo-overlay';
      ov2.innerHTML = `
        <div class="bt-tipo-modal" style="width: 420px">
          <h3 style="margin: 0 0 10px">📅 Vigência da Versão ${escapeHTML(v.numero)}</h3>
          <p style="font-size: 13px; color: var(--ink-soft); margin: 0 0 12px">
            Admissões <strong>a partir desta data</strong> passam a ser pagas pela Versão ${escapeHTML(v.numero)}
            (até a vigência da versão seguinte). Alterar a vigência reorganiza qual versão vale
            em cada período — os cálculos e o Balanço Retroativo respeitam na hora.
          </p>
          <label class="small" style="display: block; margin-bottom: 6px">Nova data de vigência</label>
          <input type="date" id="bt-vig-data" class="bt-input" value="${escapeHTML(v.data_vigencia)}"
                 style="width: 100%; box-sizing: border-box; padding: 8px 10px; margin-bottom: 14px">
          <div style="display: flex; justify-content: flex-end; gap: 10px">
            <button class="btn" id="bt-vig-cancelar">Cancelar</button>
            <button class="btn btn-primary" id="bt-vig-salvar">✓ Salvar vigência</button>
          </div>
        </div>`;
      document.body.appendChild(ov2);
      ov2.querySelector('#bt-vig-cancelar').addEventListener('click', () => ov2.remove());
      ov2.addEventListener('click', (e) => { if (e.target === ov2) ov2.remove(); });
      ov2.querySelector('#bt-vig-salvar').addEventListener('click', () => {
        const d = ov2.querySelector('#bt-vig-data').value;
        try {
          const r = AtlasVersoesTabela.alterarVigencia(v.id, d);
          ov2.remove(); ov.remove();
          Utilidades.toast?.(`✓ Vigência da Versão ${r.numero}: ${fmtISOBR(r.de)} → ${fmtISOBR(r.para)}. Cálculos passam a respeitar a nova data.`, 'success', 5000);
          App.navegarPara('base-tabela');
        } catch (e) {
          Utilidades.toast?.('Erro ao alterar vigência: ' + (e.message || e), 'error', 5000);
        }
      });
    }));

    // V568: excluir a ÚLTIMA versão publicada
    const bDel = ov.querySelector('button[data-del]');
    if (bDel) bDel.addEventListener('click', () => {
      const anterior = versoes.length > 1 ? versoes[versoes.length - 2] : null;
      const ov2 = document.createElement('div');
      ov2.className = 'bt-tipo-overlay';
      ov2.innerHTML = `
        <div class="bt-tipo-modal">
          <h3 style="margin: 0 0 10px">🗑 Excluir a Versão ${escapeHTML(ult.numero)}?</h3>
          <p style="font-size: 13px; color: var(--ink-soft); margin: 0 0 8px">
            Ela sai do histórico (e da Linha do tempo) e a tabela volta a espelhar
            ${anterior ? `a <strong>Versão ${anterior.numero}</strong>` : 'a fase de preparação da <strong>Versão 1.0</strong> (tabela livre)'}.
          </p>
          <p style="font-size: 13px; color: var(--danger, #9B3A3A); margin: 0 0 14px">
            Atenção: admissões que eram pagas pela Versão ${escapeHTML(ult.numero)} passam a usar
            ${anterior ? `a Versão ${anterior.numero}` : 'a tabela atual'}. Esta ação não pode ser desfeita.
          </p>
          <div style="display: flex; justify-content: flex-end; gap: 10px">
            <button class="btn" id="bt-del-cancelar">Cancelar</button>
            <button class="btn" id="bt-del-confirmar" style="color: var(--danger, #9B3A3A); font-weight: 700">Excluir Versão ${escapeHTML(ult.numero)}</button>
          </div>
        </div>`;
      document.body.appendChild(ov2);
      ov2.querySelector('#bt-del-cancelar').addEventListener('click', () => ov2.remove());
      ov2.addEventListener('click', (e) => { if (e.target === ov2) ov2.remove(); });
      ov2.querySelector('#bt-del-confirmar').addEventListener('click', async () => {
        try {
          const r = await AtlasVersoesTabela.excluirUltimaVersao();
          ov2.remove(); ov.remove();
          versaoVisao = null;
          Utilidades.toast?.(`✓ Versão ${r.excluida.numero} excluída. ${r.vigente ? `Vigente agora: Versão ${r.vigente.numero}.` : 'A tabela voltou à fase de preparação da 1.0.'}`, 'success', 4600);
          App.navegarPara('base-tabela');
        } catch (e) {
          console.error('[base-tabela] excluir versão:', e);
          ov2.remove();
          Utilidades.toast?.('Erro ao excluir versão: ' + (e.message || e), 'error', 5000);
        }
      });
    });
    // V568: descartar o rascunho (desfaz alterações não publicadas)
    const bDesc = ov.querySelector('#bt-ver-descartar');
    if (bDesc) bDesc.addEventListener('click', () => {
      const ov2 = document.createElement('div');
      ov2.className = 'bt-tipo-overlay';
      ov2.innerHTML = `
        <div class="bt-tipo-modal">
          <h3 style="margin: 0 0 10px">🗑 Descartar o rascunho?</h3>
          <p style="font-size: 13px; color: var(--ink-soft); margin: 0 0 14px">
            Todas as alterações <strong>não publicadas</strong> serão desfeitas e a tabela volta à
            cópia exata da <strong>Versão ${escapeHTML(ult.numero)}</strong>. Esta ação não pode ser desfeita.
          </p>
          <div style="display: flex; justify-content: flex-end; gap: 10px">
            <button class="btn" id="bt-desc-cancelar">Cancelar</button>
            <button class="btn" id="bt-desc-confirmar" style="color: var(--danger, #9B3A3A); font-weight: 700">Descartar rascunho</button>
          </div>
        </div>`;
      document.body.appendChild(ov2);
      ov2.querySelector('#bt-desc-cancelar').addEventListener('click', () => ov2.remove());
      ov2.addEventListener('click', (e) => { if (e.target === ov2) ov2.remove(); });
      ov2.querySelector('#bt-desc-confirmar').addEventListener('click', async () => {
        try {
          const v = await AtlasVersoesTabela.descartarRascunho();
          ov2.remove(); ov.remove();
          versaoVisao = null;
          Utilidades.toast?.(`✓ Rascunho descartado — a tabela voltou à cópia exata da Versão ${v.numero}.`, 'success', 4600);
          App.navegarPara('base-tabela');
        } catch (e) {
          console.error('[base-tabela] descartar rascunho:', e);
          ov2.remove();
          Utilidades.toast?.('Erro ao descartar rascunho: ' + (e.message || e), 'error', 5000);
        }
      });
    });
  }

  // V568: export unificado — `versao` null exporta a tabela atual; um objeto
  // {id, numero} exporta o snapshot congelado daquela versão publicada.
  async function exportarBaseExcel(versao) {
    if (typeof ExcelJS === 'undefined') {
      Utilidades.toast?.('Biblioteca ExcelJS não carregada. Recarregue a página (Ctrl+Shift+R).', 'error', 4500);
      return;
    }
    try {
      garantirColunasClass();
      const vid = versao ? Number(versao.id) : null;
      const procs = Banco.query(vid ? `
        SELECT procedimento_id AS id, nome_oficial, repassavel, nomenclatura, prod_categoria, prod_subespecialidade
          FROM procedimentos_hist WHERE versao_id = ${vid} ORDER BY nome_oficial` : `
        SELECT id, nome_oficial, repassavel, nomenclatura, prod_categoria, prod_subespecialidade
          FROM procedimentos ORDER BY nome_oficial`) || [];
      if (!procs.length) { Utilidades.toast?.('Base tabela vazia — nada para exportar.', 'error', 3500); return; }
      const regras = Banco.query(vid ? `
        SELECT t.procedimento_id, t.fonte_pagadora, pap.nome AS papel, t.valor, t.percentual
          FROM tabela_repasse_hist t JOIN papeis pap ON pap.id = t.papel_id
         WHERE t.versao_id = ${vid}` : `
        SELECT t.procedimento_id, t.fonte_pagadora, pap.nome AS papel, t.valor, t.percentual
          FROM tabela_repasse t JOIN papeis pap ON pap.id = t.papel_id`) || [];
      // procId|fonte → { papel → {valor, percentual} }
      const porChave = new Map();
      const fontesPorProc = new Map();
      for (const r of regras) {
        const fonte = String(r.fonte_pagadora || '').toUpperCase();
        const k = `${r.procedimento_id}|${fonte}`;
        if (!porChave.has(k)) porChave.set(k, {});
        porChave.get(k)[r.papel] = { valor: r.valor, percentual: r.percentual };
        if (!fontesPorProc.has(r.procedimento_id)) fontesPorProc.set(r.procedimento_id, new Set());
        fontesPorProc.get(r.procedimento_id).add(fonte);
      }

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(versao ? `Base Tabela v${versao.numero}` : 'Base Tabela', { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = [
        { header: 'Procedimento', key: 'proc', width: 46 },
        { header: 'Categoria', key: 'cat', width: 18 },
        { header: 'Subespecialidade', key: 'esp', width: 20 },
        { header: 'Nomenclatura', key: 'nom', width: 20 },
        { header: 'Usar', key: 'usar', width: 8 },
        { header: 'Fonte', key: 'fonte', width: 13 },
        { header: 'Executante', key: 'Executante', width: 13 },
        { header: 'Indicante', key: 'Indicante', width: 13 },
        { header: 'Solicitante', key: 'Solicitante', width: 13 },
        { header: 'Auxiliar', key: 'Auxiliar', width: 13 },
        { header: 'Médico Laudo', key: 'Médico Laudo', width: 13 },
      ];
      const head = ws.getRow(1);
      for (let c = 1; c <= ws.columns.length; c++) {
        const cell = head.getCell(c);
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A34' } };
        cell.alignment = { vertical: 'middle' };
      }
      const PAPEIS = ['Executante', 'Indicante', 'Solicitante', 'Auxiliar', 'Médico Laudo'];
      const FONTES = ['CONVENIO', 'PARTICULAR', 'SUS'];
      for (const p of procs) {
        const fontes = FONTES.filter(f => (fontesPorProc.get(p.id) || new Set()).has(f));
        const linhasFonte = fontes.length ? fontes : [''];   // sem regra: 1 linha "inventário"
        for (const fonte of linhasFonte) {
          const row = ws.addRow({
            proc: p.nome_oficial,
            cat: p.prod_categoria || '',
            esp: p.prod_subespecialidade || '',
            nom: p.nomenclatura || '',
            usar: p.repassavel ? 'Sim' : 'Não',
            fonte: Utilidades.rotuloFonte(fonte) || '—',
          });
          Utilidades.pintarCelulaFonte(row.getCell('fonte'), fonte);   // V947
          const regrasFonte = porChave.get(`${p.id}|${fonte}`) || {};
          for (const papel of PAPEIS) {
            const rg = regrasFonte[papel];
            if (!rg) continue;
            const cell = row.getCell(papel);
            if (rg.valor !== null && rg.valor !== undefined) {
              cell.value = Number(rg.valor); cell.numFmt = 'R$ #,##0.00';
            } else if (rg.percentual !== null && rg.percentual !== undefined) {
              cell.value = Number(rg.percentual); cell.numFmt = '0.0%';   // fração (0,35 → 35%)
            }
          }
        }
      }
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = versao ? `base_tabela_versao_${versao.numero.replace('.', '-')}_${ts}.xlsx` : `base_tabela_${ts}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      Utilidades.toast?.(`✓ ${versao ? `Versão ${versao.numero} exportada` : 'Base tabela exportada'} (${procs.length} procedimentos).`, 'success', 4000);
    } catch (e) {
      console.error('[base-tabela] exportar:', e);
      Utilidades.toast?.('Erro ao gerar Excel: ' + (e.message || e), 'error', 4500);
    }
  }

  const btnExportBase = document.getElementById('btn-export-base');
  if (btnExportBase) btnExportBase.addEventListener('click', () => exportarBaseExcel(null));

  /**
   * V850: IMPORTAR NOMENCLATURAS — o fluxo do usuário: exporta a Base Tabela
   * (↓ Exportar Excel), preenche a coluna NOMENCLATURA no Excel e importa de
   * volta por aqui. SÓ a nomenclatura muda — nomes, valores, papéis, USAR e
   * as versões publicadas ficam exatamente como estão. Regras:
   *  · as colunas "Procedimento" e "Nomenclatura" são achadas pelo cabeçalho
   *    (qualquer posição/aba única — o formato é o da própria exportação);
   *  · o procedimento casa pelo NOME OFICIAL (normalizado);
   *  · célula VAZIA não apaga a nomenclatura existente;
   *  · o mesmo procedimento em várias linhas (uma por fonte) vale a última
   *    nomenclatura preenchida;
   *  · PRÉVIA antes de gravar (quantos mudam, quantos já estão iguais e os
   *    nomes da planilha que não existem na base).
   */
  async function importarNomenclaturas(arquivo) {
    if (typeof XLSX === 'undefined') {
      Utilidades.toast?.('Biblioteca de planilha ainda carregando — tente de novo.', 'warning', 3600);
      return;
    }
    try {
      const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
      const aba = wb.Sheets[wb.SheetNames[0]];
      const linhas = XLSX.utils.sheet_to_json(aba, { header: 1, defval: null, raw: false });
      const norm = (s) => Utilidades.normalizar(String(s == null ? '' : s));
      let iCab = -1, iProc = -1, iNom = -1;
      for (let i = 0; i < Math.min(linhas.length, 12); i++) {
        const cab = (linhas[i] || []).map(norm);
        const p = cab.findIndex(c => c === 'PROCEDIMENTO');
        const n = cab.findIndex(c => c.indexOf('NOMENCLATURA') === 0);
        if (p >= 0 && n >= 0) { iCab = i; iProc = p; iNom = n; break; }
      }
      if (iCab < 0) {
        alert('Não achei as colunas "Procedimento" e "Nomenclatura" na planilha.\n\n' +
          'Use o arquivo gerado pelo "↓ Exportar Excel" desta tela (com a coluna ' +
          'NOMENCLATURA preenchida) — as colunas podem estar em qualquer posição, ' +
          'mas os títulos precisam existir.');
        return;
      }
      const procs = Banco.query(`SELECT id, nome_oficial, nomenclatura FROM procedimentos`) || [];
      const porNome = new Map(procs.map(p => [norm(p.nome_oficial), p]));
      const mudancas = new Map();
      const naoAchados = new Set();
      for (let i = iCab + 1; i < linhas.length; i++) {
        const l = linhas[i] || [];
        const nome = String(l[iProc] == null ? '' : l[iProc]).trim();
        const nom = String(l[iNom] == null ? '' : l[iNom]).trim();
        if (!nome || !nom) continue;   // célula vazia não apaga
        const p = porNome.get(norm(nome));
        if (!p) { naoAchados.add(nome); continue; }
        mudancas.set(p.id, { p, nom });
      }
      const aplicar = [...mudancas.values()].filter(m => String(m.p.nomenclatura || '').trim() !== m.nom);
      const iguais = mudancas.size - aplicar.length;
      const rodape = (naoAchados.size
        ? `\n⚠ ${naoAchados.size} nome(s) da planilha não estão na Base Tabela (ignorados):\n` +
          [...naoAchados].slice(0, 8).map(n => ` · ${n}`).join('\n') + (naoAchados.size > 8 ? '\n · …' : '')
        : '');
      if (!aplicar.length) {
        alert(`Nenhuma nomenclatura para atualizar.\n\n` +
          `${mudancas.size} procedimento(s) lidos com nomenclatura na planilha — ` +
          `${iguais ? 'todas já iguais às da base.' : 'nenhum casou com a base.'}` + rodape);
        return;
      }
      const amostra = aplicar.slice(0, 12)
        .map(m => ` · ${m.p.nome_oficial}: "${m.p.nomenclatura || '—'}" → "${m.nom}"`).join('\n');
      if (!confirm(
        `Importar NOMENCLATURAS da planilha?\n\n` +
        `${aplicar.length} procedimento(s) para atualizar` +
        (iguais ? `\n${iguais} já iguais (sem mudança)` : '') + rodape +
        `\n\nSó a NOMENCLATURA muda — nomes, valores, papéis e versões publicadas ficam como estão.` +
        `\nCélula vazia na planilha NÃO apaga a nomenclatura existente.\n\n` +
        `Primeiras mudanças:\n${amostra}${aplicar.length > 12 ? '\n · …' : ''}`)) return;
      for (const m of aplicar) {
        Banco.executar(`UPDATE procedimentos SET nomenclatura = ? WHERE id = ?`, [m.nom, m.p.id]);
      }
      if (Banco.salvarDebounced) Banco.salvarDebounced(); else Banco.salvar();
      Utilidades.toast?.(`✓ ${aplicar.length} nomenclatura(s) importada(s)`, 'success', 4200);
      App.telas['base-tabela']();
    } catch (e) {
      console.error('[base-tabela] importar nomenclaturas:', e);
      alert('Erro ao importar nomenclaturas:\n\n' + (e.message || e));
    }
  }
  const btnImpNom = document.getElementById('btn-import-nom');
  const inpImpNom = document.getElementById('upload-nomenclaturas');
  if (btnImpNom && inpImpNom) {
    btnImpNom.addEventListener('click', () => inpImpNom.click());
    inpImpNom.addEventListener('change', async (e) => {
      const arq = e.target.files && e.target.files[0];
      if (arq) await importarNomenclaturas(arq);
      e.target.value = '';
    });
  }

  inputArquivo.addEventListener('change', async (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;

    if (temDados) {
      const ok = confirm(
        'Você já tem uma base tabela importada. Importar novamente vai ADICIONAR ' +
        'procedimentos novos e atualizar valores existentes (não apaga nada). Continuar?'
      );
      if (!ok) { inputArquivo.value = ''; return; }
    }

    Utilidades.mostrarLoading('Importando base tabela...');
    try {
      const estadoAntes = btCapturarEstado();          // V489
      const rel = await ImportadorBaseTabela.importar(arquivo);
      const nDiff = btDiffEstados(estadoAntes, btCapturarEstado(), 'IMPORTACAO');  // V489
      await Banco.salvar();
      Utilidades.esconderLoading();
      alert(
        `✓ Importação concluída!\n\n` +
        `Linhas lidas:            ${rel.linhas_lidas}\n` +
        `Procedimentos criados:   ${rel.procedimentos_criados}\n` +
        `Sinônimos cadastrados:   ${rel.sinonimos_criados}\n` +
        `Valores de repasse:      ${rel.valores_criados}\n` +
        `Linhas ignoradas:        ${rel.linhas_ignoradas}\n` +
        `Alterações registradas:  ${nDiff}`
      );
      Utilidades.toast('Base tabela atualizada', 'success');
      App.navegarPara('base-tabela');
    } catch (err) {
      Utilidades.esconderLoading();
      console.error(err);
      alert('Erro ao importar: ' + err.message);
    }
  });

  btnNovo.addEventListener('click', () => abrirModalNovoProcedimento());

  // ──────────────────────────────────────────────────────────────────────
  // LIMPAR BASE TABELA (apaga procedimentos + valores + de-para)
  // ──────────────────────────────────────────────────────────────────────
  const btnLimpar = document.getElementById('btn-limpar-base');
  if (btnLimpar) btnLimpar.addEventListener('click', async () => {
    if (bulkBloqueado()) return;                              // V572
    if (!btDestravado) { btAbrirModalTrava(null); return; }   // V489
    const n = Banco.queryUnica('SELECT COUNT(*) AS n FROM procedimentos').n;
    if (!n) { alert('A base tabela já está vazia.'); return; }
    const ok1 = confirm(
      `⚠️ LIMPAR BASE TABELA\n\n` +
      `Isso vai APAGAR TUDO da base tabela:\n` +
      `• ${n} procedimento(s)\n` +
      `• todos os valores de repasse (Convênio, Particular e SUS)\n` +
      `• o de-para de grafias dos procedimentos\n\n` +
      `NÃO afeta médicos, produção, QVIS nem regras especiais.\n` +
      `Esta ação é IRREVERSÍVEL. Continuar?`
    );
    if (!ok1) return;
    const txt = prompt('Para confirmar, digite APAGAR (em maiúsculas):');
    if (txt !== 'APAGAR') { alert('Cancelado — nada foi apagado.'); return; }

    Utilidades.mostrarLoading('Limpando base tabela...');
    await new Promise(r => setTimeout(r, 30));
    try {
      const estadoAntes = btCapturarEstado();          // V489
      Banco.executar('DELETE FROM tabela_repasse');
      Banco.executar('DELETE FROM sinonimos_proc');
      Banco.executar('DELETE FROM procedimentos');
      btDiffEstados(estadoAntes, btCapturarEstado(), 'EDICAO');   // V489
      await Banco.salvar();
      Utilidades.esconderLoading();
      Utilidades.toast('Base tabela limpa', 'success');
      App.navegarPara('base-tabela');
    } catch (err) {
      Utilidades.esconderLoading();
      console.error(err);
      alert('Erro ao limpar: ' + err.message);
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // REMOVER DUPLICADOS (mesma grafia após normalizar) — com preview
  // ──────────────────────────────────────────────────────────────────────
  const btnDedup = document.getElementById('btn-dedup');
  if (btnDedup) btnDedup.addEventListener('click', () => {
    if (bulkBloqueado()) return;                              // V572
    if (!btDestravado) { btAbrirModalTrava(null); return; }   // V489
    const procs = Banco.query('SELECT id, nome_oficial, nome_normalizado FROM procedimentos');
    // agrupa por nome_normalizado
    const grupos = new Map();
    for (const p of procs) {
      const k = p.nome_normalizado;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(p);
    }
    const dups = [...grupos.values()].filter(g => g.length > 1);
    if (!dups.length) { alert('Nenhum procedimento duplicado encontrado. 🌿'); return; }

    // p/ cada grupo, escolhe quem fica: o que tem mais valores (empate → menor id)
    const planos = dups.map(grupo => {
      const comQtd = grupo.map(p => ({
        ...p,
        qtd: Banco.queryUnica('SELECT COUNT(*) AS n FROM tabela_repasse WHERE procedimento_id = ?', [p.id]).n,
      }));
      comQtd.sort((a, b) => (b.qtd - a.qtd) || (a.id - b.id));
      return { manter: comQtd[0], remover: comQtd.slice(1) };
    });
    const totalRemover = planos.reduce((s, p) => s + p.remover.length, 0);

    const lista = planos.map(p =>
      `• "${p.manter.nome_oficial}" (mantém, ${p.manter.qtd} valores)\n` +
      p.remover.map(r => `     ↳ remove "${r.nome_oficial}" (${r.qtd} valores)`).join('\n')
    ).join('\n');

    if (!confirm(
      `🧹 REMOVER DUPLICADOS\n\n` +
      `${dups.length} grupo(s) de procedimentos iguais (mesma grafia). Vou MANTER 1 de cada e ` +
      `remover ${totalRemover}, juntando no que fica os valores/grafias que faltarem.\n\n` +
      `${lista.length > 1400 ? lista.slice(0, 1400) + '\n...' : lista}\n\n` +
      `Continuar?`
    )) return;

    (async () => {
      Utilidades.mostrarLoading('Removendo duplicados...');
      await new Promise(r => setTimeout(r, 30));
      try {
        const estadoAntes = btCapturarEstado();          // V489
        let removidos = 0, valoresMovidos = 0;
        for (const plano of planos) {
          const manterId = plano.manter.id;
          for (const rem of plano.remover) {
            // move valores que faltam no que fica (não sobrescreve existentes)
            const vals = Banco.query(
              'SELECT papel_id, fonte_pagadora, valor, percentual FROM tabela_repasse WHERE procedimento_id = ?',
              [rem.id]
            );
            for (const v of vals) {
              const existe = Banco.queryUnica(
                'SELECT id FROM tabela_repasse WHERE procedimento_id = ? AND papel_id = ? AND fonte_pagadora = ?',
                [manterId, v.papel_id, v.fonte_pagadora]
              );
              if (!existe) {
                Banco.executar(
                  `INSERT INTO tabela_repasse (procedimento_id, papel_id, fonte_pagadora, valor, percentual)
                   VALUES (?, ?, ?, ?, ?)`,
                  [manterId, v.papel_id, v.fonte_pagadora, v.valor, v.percentual]
                );
                valoresMovidos++;
              }
            }
            // move grafias (de-para) pro que fica
            Banco.executar('UPDATE sinonimos_proc SET procedimento_id = ? WHERE procedimento_id = ?', [manterId, rem.id]);
            // apaga valores e o procedimento duplicado
            Banco.executar('DELETE FROM tabela_repasse WHERE procedimento_id = ?', [rem.id]);
            Banco.executar('DELETE FROM procedimentos WHERE id = ?', [rem.id]);
            removidos++;
          }
        }
        btDiffEstados(estadoAntes, btCapturarEstado(), 'EDICAO');   // V489
        await Banco.salvar();
        Utilidades.esconderLoading();
        alert(`✓ Concluído!\n\nDuplicados removidos: ${removidos}\nValores reaproveitados: ${valoresMovidos}`);
        Utilidades.toast('Duplicados removidos', 'success');
        App.navegarPara('base-tabela');
      } catch (err) {
        Utilidades.esconderLoading();
        console.error(err);
        alert('Erro ao remover duplicados: ' + err.message);
      }
    })();
  });

  // ──────────────────────────────────────────────────────────────────────
  // IMPORTAÇÃO POR TIPO ESPECÍFICO (arquivo sem a coluna TIPO)
  // ──────────────────────────────────────────────────────────────────────
  const inputArquivoTipo = document.getElementById('upload-base-tabela-tipo');
  const btnUploadTipo = document.getElementById('btn-upload-tipo');
  let tipoImportEscolhido = null;
  let versaoAlvoImport = null;   // V677: id da versão publicada que recebe a importação

  function abrirSeletorTipoImport(versaoAlvo) {
    versaoAlvoImport = versaoAlvo || null;
    const numeroVer = versaoAlvoImport ? numeroDaVersao(versaoAlvoImport) : null;
    // V678: sem versão-alvo mas com versão VIGENTE publicada (sem rascunho) →
    // a importação atualiza a viva e re-espelha a vigente; avisa no modal
    let vigenteInfo = null;
    if (!versaoAlvoImport) {
      try {
        const vsX = window.AtlasVersoesTabela ? AtlasVersoesTabela.listar() : [];
        if (vsX.length && !AtlasVersoesTabela.temRascunho()) vigenteInfo = vsX[vsX.length - 1].numero;
      } catch (_) {}
    }
    const ov = document.createElement('div');
    ov.className = 'bt-tipo-overlay';
    ov.innerHTML = `
      <div class="bt-tipo-modal">
        <h3 style="margin:0 0 6px; font-size:17px">Importar tabela por tipo${numeroVer ? ` — Versão ${escapeHTML(numeroVer)}` : ''}</h3>
        <p style="margin:0 0 ${numeroVer ? '8px' : '16px'}; font-size:13px; color:var(--ink-soft)">
          Escolha o tipo. <strong>Todas as linhas</strong> do arquivo serão importadas com esse tipo —
          o arquivo <strong>não precisa</strong> da coluna TIPO.
        </p>
        ${numeroVer ? `
        <p style="margin:0 0 16px; font-size:12.5px; color:#8a5a00; background:#fff6e3; border:1px solid #ecd9a8; border-radius:8px; padding:8px 10px">
          ⚠ Você está vendo a <strong>Versão ${escapeHTML(numeroVer)}</strong>: a importação grava
          <strong>direto no histórico dela</strong>. A tabela atual e as outras versões <strong>não mudam</strong>.
        </p>` : vigenteInfo ? `
        <p style="margin:0 0 16px; font-size:12.5px; color:var(--ink-soft); background:var(--bg-sunken,#f3f6f5); border:1px solid var(--border); border-radius:8px; padding:8px 10px">
          A importação atualiza a tabela atual e <strong>também a Versão ${escapeHTML(vigenteInfo)} (vigente)</strong> —
          as duas continuam espelhadas e o cálculo passa a usar os valores novos.
        </p>` : ''}
        <div style="display:flex; gap:8px; margin-bottom:16px">
          <button class="btn btn-primary" data-tp="CONVENIO" style="flex:1">Convênio</button>
          <button class="btn btn-primary" data-tp="PARTICULAR" style="flex:1">Particular</button>
          <button class="btn btn-primary" data-tp="SUS" style="flex:1">SUS</button>
        </div>
        <div style="text-align:right"><button class="btn" data-tp-cancel>Cancelar</button></div>
      </div>`;
    document.body.appendChild(ov);
    const fechar = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    ov.querySelector('[data-tp-cancel]').addEventListener('click', fechar);
    ov.querySelectorAll('[data-tp]').forEach(b => b.addEventListener('click', () => {
      tipoImportEscolhido = b.dataset.tp;
      fechar();
      inputArquivoTipo.value = '';
      inputArquivoTipo.click();
    }));
  }

  if (btnUploadTipo) btnUploadTipo.addEventListener('click', () => {
    // V677: visualizando uma versão publicada (não-espelho) → importa PARA ELA
    // (grava no snapshot; não é alteração em massa da tabela viva)
    if (versaoVisao && !versaoEspelhoDaViva(versaoVisao)) {
      if (!btDestravado) { btAbrirModalTrava(null); return; }
      abrirSeletorTipoImport(Number(versaoVisao));
      return;
    }
    // V678: importar por FONTE não fica mais embargado pela versão publicada —
    // entra na tabela atual E re-espelha o snapshot da versão VIGENTE (mesma
    // filosofia do ajuste fino V572, agora em massa e por fonte)
    if (!btDestravado) { btAbrirModalTrava(null); return; }   // V489
    abrirSeletorTipoImport(null);
  });

  inputArquivoTipo.addEventListener('change', async (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo || !tipoImportEscolhido) return;

    const rotuloTipo = tipoImportEscolhido === 'CONVENIO' ? 'Convênio'
      : tipoImportEscolhido === 'PARTICULAR' ? 'Particular' : 'SUS';

    // ── V677: importação DENTRO de uma versão publicada ────────────────────
    if (versaoAlvoImport) {
      const vidImp = Number(versaoAlvoImport);
      const numeroVer = numeroDaVersao(vidImp);
      const okV = confirm(
        `Importar (${rotuloTipo}) DIRETO na Versão ${numeroVer}?\n\n` +
        `Adiciona procedimentos e atualiza valores SÓ no histórico dessa versão — ` +
        `a tabela atual e as outras versões NÃO mudam.`
      );
      if (!okV) { inputArquivoTipo.value = ''; return; }
      Utilidades.mostrarLoading(`Importando (${rotuloTipo}) na Versão ${numeroVer}...`);
      try {
        const rel = await ImportadorBaseTabela.importar(arquivo, tipoImportEscolhido, { versaoId: vidImp });
        btRegistrar('EDICAO-VERSAO', {
          procedimento: `Importação ${rotuloTipo} (Versão ${numeroVer})`, papel: '—', fonte: tipoImportEscolhido,
          acao: 'IMPORTACAO', valorAntes: null, percAntes: null,
          valorDepois: null, percDepois: null,
        }, BT_TL_AREA_VERSOES);
        try {
          Banco._tlAutoContar && Banco._tlAutoContar(BT_TL_AREA_VERSOES, Math.max(1, (rel.valores_criados || 0) + (rel.procedimentos_criados || 0)));
          Banco._tlAutoDetalhe && Banco._tlAutoDetalhe(BT_TL_AREA_VERSOES,
            `⇪ Importação ${rotuloTipo} na Versão ${numeroVer}: ${rel.valores_criados} valores · ${rel.procedimentos_criados} procedimentos novos`);
        } catch (_) {}
        invalidarPosEdicaoVersao();
        await Banco.salvar();
        Utilidades.esconderLoading();
        alert(
          `✓ Importação (${rotuloTipo}) na Versão ${numeroVer} concluída!\n\n` +
          `Linhas lidas:            ${rel.linhas_lidas}\n` +
          `Procedimentos criados:   ${rel.procedimentos_criados}\n` +
          `Sinônimos cadastrados:   ${rel.sinonimos_criados}\n` +
          `Valores gravados:        ${rel.valores_criados}\n` +
          `Linhas ignoradas:        ${rel.linhas_ignoradas}\n\n` +
          `Vale nos próximos recálculos das admissões dessa vigência; ` +
          `meses consolidados seguem congelados.`
        );
        Utilidades.toast(`✓ Versão ${numeroVer} atualizada (${rotuloTipo})`, 'success', 4000);
        renderizarTabela();   // continua na visão da versão
      } catch (err) {
        Utilidades.esconderLoading();
        console.error(err);
        alert('Erro ao importar na versão: ' + err.message);
      } finally {
        inputArquivoTipo.value = '';
      }
      return;
    }

    if (temDados) {
      const ok = confirm(
        `Importar vai ADICIONAR procedimentos novos e atualizar valores do tipo ` +
        `${rotuloTipo} (não apaga nada). Continuar?`
      );
      if (!ok) { inputArquivoTipo.value = ''; return; }
    }

    Utilidades.mostrarLoading(`Importando tabela (${rotuloTipo})...`);
    try {
      const estadoAntes = btCapturarEstado();          // V489
      const rel = await ImportadorBaseTabela.importar(arquivo, tipoImportEscolhido);
      const nDiff = btDiffEstados(estadoAntes, btCapturarEstado(), 'IMPORTACAO');  // V489
      // ── V678: versão VIGENTE publicada (sem rascunho) → a viva é espelho
      // dela; re-espelha o snapshot da FONTE importada (e procedimentos novos)
      // pra tabela atual e versão continuarem idênticas no motor.
      let espelhoMsg = '';
      try {
        if (window.AtlasVersoesTabela) {
          const vs = AtlasVersoesTabela.listar();
          if (vs.length && !AtlasVersoesTabela.temRascunho()) {
            const ult = vs[vs.length - 1];
            Banco.executar(`DELETE FROM tabela_repasse_hist WHERE versao_id = ? AND fonte_pagadora = ?`, [ult.id, tipoImportEscolhido]);
            Banco.executar(
              `INSERT INTO tabela_repasse_hist (versao_id, procedimento_id, papel_id, fonte_pagadora, valor, percentual, ativo)
                SELECT ?, procedimento_id, papel_id, fonte_pagadora, valor, percentual, ativo
                  FROM tabela_repasse WHERE fonte_pagadora = ?`, [ult.id, tipoImportEscolhido]);
            try {
              Banco.executar(
                `INSERT INTO procedimentos_hist (versao_id, procedimento_id, nome_oficial, nome_normalizado, nomenclatura,
                                                 repassavel, prod_categoria, prod_subcategoria, prod_subespecialidade)
                  SELECT ?, p.id, p.nome_oficial, p.nome_normalizado, p.nomenclatura,
                         COALESCE(p.repassavel, 1), p.prod_categoria, p.prod_subcategoria, p.prod_subespecialidade
                    FROM procedimentos p
                   WHERE NOT EXISTS (SELECT 1 FROM procedimentos_hist ph WHERE ph.versao_id = ? AND ph.procedimento_id = p.id)`,
                [ult.id, ult.id]);
            } catch (_) {
              Banco.executar(
                `INSERT INTO procedimentos_hist (versao_id, procedimento_id, nome_oficial, nome_normalizado, nomenclatura, repassavel)
                  SELECT ?, p.id, p.nome_oficial, p.nome_normalizado, p.nomenclatura, COALESCE(p.repassavel, 1)
                    FROM procedimentos p
                   WHERE NOT EXISTS (SELECT 1 FROM procedimentos_hist ph WHERE ph.versao_id = ? AND ph.procedimento_id = p.id)`,
                [ult.id, ult.id]);
            }
            if (window.__atlasInvalidarAux) window.__atlasInvalidarAux();
            try { window.AtlasRelatorios && AtlasRelatorios.invalidarConsolidado && AtlasRelatorios.invalidarConsolidado(); } catch (_) {}
            espelhoMsg = `\nVersão ${ult.numero} (vigente) atualizada junto — o cálculo já usa os valores novos.`;
          }
        }
      } catch (eSinc) { console.warn('[base-tabela] espelho pós-importação:', eSinc); }
      await Banco.salvar();
      Utilidades.esconderLoading();
      alert(
        `✓ Importação (${rotuloTipo}) concluída!\n\n` +
        `Linhas lidas:            ${rel.linhas_lidas}\n` +
        `Procedimentos criados:   ${rel.procedimentos_criados}\n` +
        `Sinônimos cadastrados:   ${rel.sinonimos_criados}\n` +
        `Valores de repasse:      ${rel.valores_criados}\n` +
        `Linhas ignoradas:        ${rel.linhas_ignoradas}\n` +
        `Alterações registradas:  ${nDiff}` +
        espelhoMsg
      );
      Utilidades.toast(`Base tabela atualizada (${rotuloTipo})`, 'success');
      App.navegarPara('base-tabela');
    } catch (err) {
      Utilidades.esconderLoading();
      console.error(err);
      alert('Erro ao importar: ' + err.message);
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // CASAR POR SIMILARIDADE — aplica valores de Convênio em procedimentos parecidos
  // ──────────────────────────────────────────────────────────────────────
  const inputCasar = document.getElementById('upload-casar-sim');
  const btnCasar = document.getElementById('btn-casar-sim');
  const escSim = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  function normSim(s) {
    return String(s || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function jaccardSim(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0; for (const t of a) if (b.has(t)) inter++;
    return inter / (a.size + b.size - inter);
  }
  function levRatioSim(a, b) {
    const m = a.length, n = b.length;
    if (!m || !n) return 0;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i; const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      const t = prev; prev = cur; cur = t;
    }
    return 1 - prev[n] / Math.max(m, n);
  }
  function scoreSim(aNorm, aTok, bNorm, bTok) {
    if (aNorm === bNorm) return 100;
    const j = jaccardSim(aTok, bTok);
    const contains = aNorm.includes(bNorm) || bNorm.includes(aNorm);
    if (j === 0 && !contains) return 0;
    let s = 0.55 * j + 0.45 * levRatioSim(aNorm, bNorm);
    if (contains) {
      const ratio = Math.min(aNorm.length, bNorm.length) / Math.max(aNorm.length, bNorm.length);
      if (ratio >= 0.6) s = Math.max(s, 0.85);   // só reforça contenção "substancial"
    }
    return Math.round(s * 100);
  }

  let resultadosSim = null;
  const FLOOR_SIM = 55;

  btnCasar.addEventListener('click', () => {
    if (bulkBloqueado()) return;                              // V572
    if (!btDestravado) { btAbrirModalTrava(null); return; }   // V489
    const n = Banco.queryUnica('SELECT COUNT(*) AS n FROM procedimentos').n;
    if (!n) { alert('Você ainda não tem procedimentos no banco. Importe a base tabela primeiro.'); return; }
    inputCasar.value = ''; inputCasar.click();
  });

  inputCasar.addEventListener('change', async (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    Utilidades.mostrarLoading('Lendo planilha e casando por similaridade...');
    await new Promise(r => setTimeout(r, 30));   // deixa o loading pintar
    try {
      const { linhas } = await ImportadorBaseTabela.lerArquivoValores(arquivo);
      const dbProcs = Banco.query('SELECT id, nome_oficial FROM procedimentos').map(p => {
        const nn = normSim(p.nome_oficial);
        return { id: p.id, nome: p.nome_oficial, norm: nn, tok: new Set(nn.split(' ').filter(Boolean)) };
      });
      resultadosSim = [];
      for (const l of linhas) {
        const aNorm = normSim(l.procedimento);
        const aTok = new Set(aNorm.split(' ').filter(Boolean));
        const matches = [];
        for (const d of dbProcs) {
          const j = jaccardSim(aTok, d.tok);
          const contains = aNorm.includes(d.norm) || d.norm.includes(aNorm);
          if (j < 0.25 && !contains && aNorm !== d.norm) continue;
          const sc = scoreSim(aNorm, aTok, d.norm, d.tok);
          if (sc >= FLOOR_SIM) matches.push({ id: d.id, nome: d.nome, score: sc });
        }
        matches.sort((x, y) => y.score - x.score);
        resultadosSim.push({ procedimento: l.procedimento, valores: l.valores, matches });
      }
      Utilidades.esconderLoading();
      abrirPreviewSim();
    } catch (err) {
      Utilidades.esconderLoading();
      console.error(err);
      alert('Erro ao casar: ' + err.message);
    }
  });

  function abrirPreviewSim() {
    let limiar = 75;
    const papeisLocal = {};
    for (const p of Banco.query('SELECT id, nome FROM papeis')) papeisLocal[p.nome] = p.id;
    const fmtVal = (v) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const ov = document.createElement('div');
    ov.className = 'bt-tipo-overlay';
    ov.innerHTML = '<div class="bt-sim-modal"></div>';
    document.body.appendChild(ov);
    const modal = ov.querySelector('.bt-sim-modal');
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });

    function render() {
      const comMatch = resultadosSim.filter(r => r.matches.some(m => m.score >= limiar));
      const semMatch = resultadosSim.length - comMatch.length;
      let marcaveis = 0;
      const blocos = comMatch.map((r) => {
        const ri = resultadosSim.indexOf(r);
        const ms = r.matches.filter(m => m.score >= limiar);
        marcaveis += ms.length;
        const valsTxt = Object.entries(r.valores).filter(([, v]) => v).map(([k, v]) => `${k}: ${fmtVal(v)}`).join(' · ') || 'sem valores';
        const linhasM = ms.map(m => `
          <label class="bt-sim-row">
            <input type="checkbox" data-sim="${ri}:${m.id}" checked>
            <span class="bt-sim-score ${m.score >= 90 ? 'alto' : m.score >= 75 ? 'medio' : 'baixo'}">${m.score}%</span>
            <span class="bt-sim-nome">${escSim(m.nome)}</span>
          </label>`).join('');
        return `<div class="bt-sim-bloco">
          <div class="bt-sim-head"><strong>${escSim(r.procedimento)}</strong><span class="bt-sim-vals">${valsTxt}</span></div>
          ${linhasM}
        </div>`;
      }).join('');

      modal.innerHTML = `
        <div class="bt-sim-top">
          <h3 style="margin:0; font-size:17px">🔗 Casar por similaridade — Convênio</h3>
          <button class="btn" data-sim-fechar style="padding:4px 10px">✕</button>
        </div>
        <p class="bt-sim-sub">
          Confira antes de aplicar. Os valores de <strong>Convênio</strong> da planilha serão gravados nos
          procedimentos marcados (não apaga papéis em branco). <strong>${comMatch.length}</strong> com casamento ·
          <strong>${semMatch}</strong> sem casamento · <strong>${marcaveis}</strong> destinos marcados.
        </p>
        <div class="bt-sim-ctrl">
          <span>Similaridade mín.: <strong id="sim-lim-val">${limiar}%</strong></span>
          <input type="range" id="sim-lim" min="55" max="100" step="5" value="${limiar}" style="flex:1">
          <button class="btn" data-sim-todos style="padding:4px 10px">Marcar todos</button>
          <button class="btn" data-sim-nenhum style="padding:4px 10px">Desmarcar</button>
        </div>
        <div class="bt-sim-lista">${blocos || '<div style="padding:24px; text-align:center; color:var(--ink-soft)">Nenhum casamento acima de ' + limiar + '%.</div>'}</div>
        <div class="bt-sim-foot">
          <button class="btn" data-sim-fechar>Cancelar</button>
          <button class="btn btn-primary" data-sim-aplicar>Aplicar valores aos marcados</button>
        </div>`;

      modal.querySelectorAll('[data-sim-fechar]').forEach(b => b.addEventListener('click', () => ov.remove()));
      const range = modal.querySelector('#sim-lim');
      range.addEventListener('input', () => { limiar = Number(range.value); render(); });
      modal.querySelector('[data-sim-todos]').addEventListener('click', () => modal.querySelectorAll('[data-sim]').forEach(c => c.checked = true));
      modal.querySelector('[data-sim-nenhum]').addEventListener('click', () => modal.querySelectorAll('[data-sim]').forEach(c => c.checked = false));
      modal.querySelector('[data-sim-aplicar]').addEventListener('click', aplicar);
    }

    async function aplicar() {
      const checks = [...modal.querySelectorAll('[data-sim]:checked')];
      if (!checks.length) { alert('Marque ao menos um casamento.'); return; }
      if (!confirm(`Aplicar os valores de Convênio a ${checks.length} procedimento(s) marcado(s)?\n\nIsso atualiza os valores existentes (papéis em branco/0 na planilha NÃO são apagados).`)) return;
      Utilidades.mostrarLoading('Aplicando valores...');
      await new Promise(r => setTimeout(r, 30));
      try {
        const estadoAntes = btCapturarEstado();          // V489
        let aplicados = 0, gravados = 0;
        for (const c of checks) {
          const [riStr, idStr] = c.dataset.sim.split(':');
          const r = resultadosSim[Number(riStr)];
          const procId = Number(idStr);
          for (const [papel, valor] of Object.entries(r.valores)) {
            if (!valor || valor === 0) continue;
            const papelId = papeisLocal[papel];
            if (papelId == null) continue;
            ImportadorBaseTabela._upsertValorRepasse(procId, papelId, 'CONVENIO', Number(valor));
            gravados++;
          }
          aplicados++;
        }
        btDiffEstados(estadoAntes, btCapturarEstado(), 'EDICAO');   // V489
        await Banco.salvar();
        Utilidades.esconderLoading();
        ov.remove();
        alert(`✓ Concluído!\n\nProcedimentos atualizados: ${aplicados}\nValores gravados:          ${gravados}`);
        Utilidades.toast('Valores aplicados por similaridade', 'success');
        App.navegarPara('base-tabela');
      } catch (err) {
        Utilidades.esconderLoading();
        console.error(err);
        alert('Erro ao aplicar: ' + err.message);
      }
    }

    render();
  }

  if (!temDados) return;  // Sem dados, não tem o que renderizar

  // ==========================================================================
  // ESTADO DA TABELA
  // ==========================================================================

  let tipoAtual = 'CONVENIO';
  let termoBusca = '';
  // V557: filtros de classificação + "só USAR com valor > 0"
  let filtroCategoria = '';
  let filtroSubesp = '';
  const FILTRO_VAZIO = '__VAZIO__'; // V560: opção "Vazio" — campo de classificação em branco
  let versaoVisao = null;           // V563: null = tabela atual; id = versão publicada (V666: editável direto no snapshot)
  let filtroComValor = false;

  // Cache de papéis (nome → id) — usado no salvamento
  const papeisMap = {};
  for (const p of Banco.query('SELECT id, nome FROM papeis')) {
    papeisMap[p.nome] = p.id;
  }

  // ==========================================================================
  // V554: CLASSIFICAÇÃO DA PRODUÇÃO (categoria / subcategoria / subespecialidade)
  // Modelo aprovado pelo usuário:
  //   Base Tabela (nome + sinônimos) → linhas QVIS com esse procedimento →
  //   admissões (normalizadas, regra V500.1) → linhas da PRODUÇÃO dessas
  //   admissões (desempate pelo PRODUTO que casa com o nome, regra V503) →
  //   valor MAIS FREQUENTE de cada campo (regra V505).
  // A 1ª busca bem-sucedida é FIXA (prod_class_buscado=1, nunca re-busca);
  // campos sempre editáveis; edição manual (origem='manual') nunca é
  // sobrescrita. Procedimento NOVO (buscado=0) consulta na próxima abertura.
  // ==========================================================================

  function garantirColunasClass() {
    try {
      const cols = Banco.query(`PRAGMA table_info(procedimentos)`) || [];
      const tem = new Set(cols.map(c => c.name));
      const add = (nome, tipo) => { if (!tem.has(nome)) Banco.executar(`ALTER TABLE procedimentos ADD COLUMN ${nome} ${tipo}`); };
      add('prod_categoria', 'TEXT');
      add('prod_subcategoria', 'TEXT');
      add('prod_subespecialidade', 'TEXT');
      add('prod_class_origem', 'TEXT');            // 'auto' | 'manual'
      add('prod_class_buscado', 'INTEGER DEFAULT 0');
    } catch (e) { console.error('[base-tabela] migração classificação:', e); }
  }

  // normalização de admissão — MESMA regra V500.1 do Calcular/Relatórios
  function normAdmClass(x) {
    const s = String(x == null ? '' : x).trim().replace(/\.0+$/, '');
    const dig = s.replace(/\D/g, '').replace(/^0+/, '');
    return dig || s;
  }
  function maisFrequenteClass(cont) {
    let melhor = null, n = 0;
    for (const [v, q] of cont) if (q > n) { melhor = v; n = q; }
    return melhor;
  }

  // V555: palavras genéricas que NÃO identificam o procedimento (não servem
  // de núcleo no match por token)
  const STOP_CLASS = new Set(['PACOTE', 'PACOTES', 'EXAME', 'EXAMES', 'CIRURGIA', 'CIRURGICA',
    'CIRURGICO', 'CIRURGIAS', 'PROCEDIMENTO', 'PROCEDIMENTOS', 'CONSULTA', 'CONSULTAS',
    'BILATERAL', 'UNILATERAL', 'DIREITO', 'ESQUERDO', 'AMBOS', 'OLHOS', 'SESSAO', 'SESSOES']);

  let _buscaClassRodando = false;
  async function buscarClassificacaoProducao() {
    if (_buscaClassRodando) return;
    _buscaClassRodando = true;
    try {
      garantirColunasClass();
      // V555: MUDANÇA DE MODELO (pedido do usuário) — a subespecialidade é do
      // PROCEDIMENTO (match direto contra a coluna PRODUTO da Produção), não da
      // admissão (que contaminava: pacote de capsulotomia pegava "Pacote Exames"
      // por dividir a admissão com exames). Migração one-shot: re-busca tudo que
      // foi preenchido automaticamente pelo modelo antigo; manuais intactos.
      // V556: modelo 3 — CATEGORIA volta, com a MESMA cascata da subespecialidade
      // (produto exato → contém → palavra-núcleo). Migração one-shot re-busca
      // todo mundo; linhas com edição MANUAL só ganham campos ainda VAZIOS.
      try {
        Banco.executar(`CREATE TABLE IF NOT EXISTS config_sistema (chave TEXT PRIMARY KEY, valor TEXT)`);
        const mv = Banco.queryUnica(`SELECT valor FROM config_sistema WHERE chave='BASE_CLASS_MODELO'`);
        if (!mv || mv.valor !== '3') {
          Banco.executar(`UPDATE procedimentos SET prod_class_buscado = 0`);
          Banco.executar(`INSERT OR REPLACE INTO config_sistema (chave, valor) VALUES ('BASE_CLASS_MODELO','3')`);
        }
      } catch (e) { console.warn('[base-tabela] migração modelo classificação:', e); }

      // ── V596: FINGERPRINT — a varredura completa da Produção (centenas de
      // milhares de linhas) e o casamento por texto SÓ rodam quando os INSUMOS
      // mudaram (nova importação de Produção, procedimento/sinônimo novo).
      // Antes rodava a CADA abertura da Base Tabela: com a base real (~950 mil
      // linhas de Produção) o loop síncrono travava a tela por vários segundos.
      // Mesma filosofia das "fotos" da Visão Geral (V589/V591).
      const q1fp = (sql) => { try { const r = Banco.queryUnica(sql); return r ? Object.values(r).join(',') : ''; } catch (_) { return ''; } };
      const fpAtual = [
        q1fp(`SELECT COUNT(*) FROM linhas_producao`),
        q1fp(`SELECT COUNT(*) FROM sinonimos_proc`),
        q1fp(`SELECT COUNT(*) FROM procedimentos WHERE COALESCE(prod_class_buscado, 0) = 0`),
        'modelo3',
      ].join('|');
      try {
        const fpSalvo = Banco.queryUnica(`SELECT valor FROM config_sistema WHERE chave = 'BASE_CLASS_FP'`);
        if (fpSalvo && fpSalvo.valor === fpAtual) return;   // nada mudou → custo zero
      } catch (_) {}
      const gravarFp = () => {
        try {
          const fpFim = [
            q1fp(`SELECT COUNT(*) FROM linhas_producao`),
            q1fp(`SELECT COUNT(*) FROM sinonimos_proc`),
            q1fp(`SELECT COUNT(*) FROM procedimentos WHERE COALESCE(prod_class_buscado, 0) = 0`),
            'modelo3',
          ].join('|');
          Banco.executar(`INSERT OR REPLACE INTO config_sistema (chave, valor) VALUES ('BASE_CLASS_FP', ?)`, [fpFim]);
          // persiste SEM carimbar versão (não invalida memos do motor) — V591
          if (Banco.persistirCacheDebounced) Banco.persistirCacheDebounced();
        } catch (_) {}
      };
      // cede a thread entre lotes (a tela continua respondendo)
      const respirar = () => (Utilidades.aguardarPintura ? Utilidades.aguardarPintura() : new Promise(r => setTimeout(r, 0)));

      const pendentes = Banco.query(
        `SELECT id, nome_normalizado, prod_categoria, prod_subespecialidade, prod_class_origem
           FROM procedimentos WHERE COALESCE(prod_class_buscado, 0) = 0`) || [];
      if (!pendentes.length) { gravarFp(); return; }

      // sinônimos: procedimento_id → grafias normalizadas extras
      const sinPorProc = new Map();
      (Banco.query(`SELECT procedimento_id, grafia, grafia_normalizada FROM sinonimos_proc`) || []).forEach(s => {
        const g = Utilidades.normalizar(s.grafia_normalizada || s.grafia || '');
        if (!g) return;
        if (!sinPorProc.has(s.procedimento_id)) sinPorProc.set(s.procedimento_id, []);
        sinPorProc.get(s.procedimento_id).push(g);
      });

      // PRODUÇÃO agregada por PRODUTO distinto:
      //   espPorProduto: prodN → Map(subespecialidade → nº linhas)
      //   catPorProduto: prodN → Map(categoria → nº linhas)          (V556)
      // V596: varrida em LOTES por rowid, cedendo a thread entre eles — a base
      // real tem centenas de milhares de linhas e o SELECT único bloqueava tudo.
      const espPorProduto = new Map(), catPorProduto = new Map();
      const registra = (mapa, chave, v) => {
        if (!chave || !v) return;
        let m = mapa.get(chave);
        if (!m) { m = new Map(); mapa.set(chave, m); }
        m.set(v, (m.get(v) || 0) + 1);
      };
      const LOTE_PROD = 25000;
      let ultimoRid = 0;
      while (true) {
        const lote = Banco.query(
          `SELECT rowid AS rid, produto, procedimento_principal, subespecialidade, categoria
             FROM linhas_producao
            WHERE rowid > ?
              AND ((subespecialidade IS NOT NULL AND TRIM(subespecialidade) <> '')
                OR (categoria IS NOT NULL AND TRIM(categoria) <> ''))
            ORDER BY rowid LIMIT ${LOTE_PROD}`, [ultimoRid]) || [];
        if (!lote.length) break;
        for (const r of lote) {
          const esp = String(r.subespecialidade || '').trim();
          const cat = String(r.categoria || '').trim();
          const pr = Utilidades.normalizar(String(r.produto || ''));
          const pp = Utilidades.normalizar(String(r.procedimento_principal || ''));
          registra(espPorProduto, pr, esp); registra(catPorProduto, pr, cat);
          if (pp && pp !== pr) { registra(espPorProduto, pp, esp); registra(catPorProduto, pp, cat); }
        }
        ultimoRid = lote[lote.length - 1].rid;
        if (lote.length < LOTE_PROD) break;
        await respirar();
      }
      if (!espPorProduto.size && !catPorProduto.size) { gravarFp(); return; }   // Produção ainda não importada
      const produtos = [...new Set([...espPorProduto.keys(), ...catPorProduto.keys()])];

      // cascata V555: EXATO → CONTÉM → PALAVRA-NÚCLEO — devolve os PRODUTOS
      // casados; deles saem subespecialidade E categoria (mesma lógica p/ ambas)
      const produtosCasados = (nomes) => {
        let out = produtos.filter(pr => nomes.includes(pr));
        if (out.length) return out;
        out = produtos.filter(pr => nomes.some(nm => pr.indexOf(nm) >= 0 || nm.indexOf(pr) >= 0));
        if (out.length) return out;
        const tokens = [...new Set(nomes.join(' ').split(/[^A-Z0-9]+/)
          .filter(t => t.length >= 6 && !STOP_CLASS.has(t)))]
          .sort((a, b) => b.length - a.length);
        for (const tk of tokens) {
          out = produtos.filter(pr => pr.indexOf(tk) >= 0);
          if (out.length) return out;   // usa só o token mais específico que casou
        }
        return [];
      };
      const soma = (alvo, m) => { if (m) for (const [v, q] of m) alvo.set(v, (alvo.get(v) || 0) + q); };

      let preenchidos = 0;
      for (let ip = 0; ip < pendentes.length; ip++) {
        const p = pendentes[ip];
        if (ip % 40 === 39) await respirar();   // V596: cede a thread no casamento por texto
        const nomes = [Utilidades.normalizar(p.nome_normalizado || ''), ...(sinPorProc.get(p.id) || [])].filter(Boolean);
        if (!nomes.length) continue;
        const casados = produtosCasados(nomes);
        const cEsp = new Map(), cCat = new Map();
        for (const pr of casados) { soma(cEsp, espPorProduto.get(pr)); soma(cCat, catPorProduto.get(pr)); }
        const esp = maisFrequenteClass(cEsp), cat = maisFrequenteClass(cCat);
        const manual = p.prod_class_origem === 'manual';
        // manual: só preenche campos ainda VAZIOS (nunca sobrescreve edição)
        const novoEsp = manual ? (String(p.prod_subespecialidade || '').trim() ? null : esp) : esp;
        const novoCat = manual ? (String(p.prod_categoria || '').trim() ? null : cat) : cat;
        if (novoEsp || novoCat) {
          Banco.executar(
            `UPDATE procedimentos SET
                    prod_subespecialidade = COALESCE(?, prod_subespecialidade),
                    prod_categoria        = COALESCE(?, prod_categoria),
                    prod_class_origem     = ?,
                    prod_class_buscado    = 1,
                    atualizado_em = CURRENT_TIMESTAMP
              WHERE id = ?`, [novoEsp, novoCat, manual ? 'manual' : 'auto', p.id]);
          preenchidos++;
        } else if (manual && (esp || cat)) {
          // manual com tudo preenchido — nada a completar, só fixa como buscado
          Banco.executar(`UPDATE procedimentos SET prod_class_buscado = 1 WHERE id = ?`, [p.id]);
        }
        // sem correspondência → segue buscado=0 (tenta quando houver mais dados)
      }
      if (preenchidos > 0) {
        await Banco.salvar();
        Utilidades.toast?.(`✓ Categoria/Subespecialidade preenchidas em ${preenchidos} procedimento${preenchidos > 1 ? 's' : ''}.`, 'success', 3500);
        renderizarTabela();          // mostra os valores recém-buscados
        try { atualizarFiltrosClass(); } catch (_) {}   // V557: novas opções nos filtros
      }
      gravarFp();   // V596: registra os insumos usados — só re-roda quando mudarem
    } catch (e) { console.error('[base-tabela] busca classificação:', e); }
    finally { _buscaClassRodando = false; }
  }

  // ==========================================================================
  // RENDERIZAÇÃO DA TABELA
  // ==========================================================================

  function renderizarTabela() {
    const divConteudo = document.getElementById('tabela-conteudo');
    const contador = document.getElementById('contador-resultados');
    garantirColunasClass();   // V554: colunas de classificação existem antes da query

    const termoNorm = Utilidades.normalizar(termoBusca);

    // V563: visualizando uma versão PUBLICADA → a grade lê dos snapshots
    // congelados (procedimentos_hist / tabela_repasse_hist) em modo somente
    // leitura. Os subqueries mantêm os mesmos nomes de coluna da tabela viva,
    // então o resto da query não muda. vid é número (estado interno), seguro.
    const vid = versaoVisao ? Number(versaoVisao) : null;
    const SRC_PROC = vid
      ? `(SELECT procedimento_id AS id, nome_oficial, nome_normalizado, nomenclatura, repassavel,
                 prod_categoria, prod_subcategoria, prod_subespecialidade, NULL AS prod_class_origem
            FROM procedimentos_hist WHERE versao_id = ${vid})`
      : `procedimentos`;
    const SRC_REGRA = vid
      ? `(SELECT rowid AS id, procedimento_id, papel_id, fonte_pagadora, valor, percentual, ativo
            FROM tabela_repasse_hist WHERE versao_id = ${vid})`
      : `tabela_repasse`;

    // Constrói query dinamicamente
    let sql = `
      SELECT
        p.id AS proc_id,
        p.nome_oficial,
        p.repassavel,
        p.nomenclatura,
        p.prod_categoria, p.prod_subcategoria, p.prod_subespecialidade, p.prod_class_origem,
        (SELECT COUNT(*) FROM sinonimos_proc WHERE procedimento_id = p.id) AS qtd_grafias,
        MAX(CASE WHEN pap.nome = 'Executante'   THEN t.valor END) AS v_exec,
        MAX(CASE WHEN pap.nome = 'Executante'   THEN t.percentual END) AS p_exec,
        MAX(CASE WHEN pap.nome = 'Indicante'    THEN t.valor END) AS v_ind,
        MAX(CASE WHEN pap.nome = 'Indicante'    THEN t.percentual END) AS p_ind,
        MAX(CASE WHEN pap.nome = 'Solicitante'  THEN t.valor END) AS v_sol,
        MAX(CASE WHEN pap.nome = 'Solicitante'  THEN t.percentual END) AS p_sol,
        MAX(CASE WHEN pap.nome = 'Auxiliar'     THEN t.valor END) AS v_aux,
        MAX(CASE WHEN pap.nome = 'Auxiliar'     THEN t.percentual END) AS p_aux,
        MAX(CASE WHEN pap.nome = 'Médico Laudo' THEN t.valor END) AS v_lau,
        MAX(CASE WHEN pap.nome = 'Médico Laudo' THEN t.percentual END) AS p_lau,
        SUM(CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END) AS qtd_valores
      FROM ${SRC_PROC} p
      LEFT JOIN ${SRC_REGRA} t ON t.procedimento_id = p.id AND t.fonte_pagadora = ?
      LEFT JOIN papeis pap ON pap.id = t.papel_id
    `;
    const params = [tipoAtual];

    // V557: condições combináveis — busca, filtros de classificação e "com valor > 0"
    const conds = [];
    if (termoNorm) { conds.push(`p.nome_normalizado LIKE ?`); params.push('%' + termoNorm + '%'); }
    // V560: sentinela '__VAZIO__' = procedimentos sem nada preenchido no campo
    if (filtroCategoria === FILTRO_VAZIO) { conds.push(`TRIM(COALESCE(p.prod_categoria,'')) = ''`); }
    else if (filtroCategoria) { conds.push(`TRIM(COALESCE(p.prod_categoria,'')) = ?`); params.push(filtroCategoria); }
    if (filtroSubesp === FILTRO_VAZIO) { conds.push(`TRIM(COALESCE(p.prod_subespecialidade,'')) = ''`); }
    else if (filtroSubesp) { conds.push(`TRIM(COALESCE(p.prod_subespecialidade,'')) = ?`); params.push(filtroSubesp); }
    if (filtroComValor) {
      // só USAR marcado E com pelo menos um valor/percentual > 0 na fonte atual
      conds.push(`p.repassavel = 1 AND EXISTS (
        SELECT 1 FROM ${SRC_REGRA} tr
         WHERE tr.procedimento_id = p.id AND tr.fonte_pagadora = ?
           AND (COALESCE(tr.valor, 0) > 0 OR COALESCE(tr.percentual, 0) > 0))`);
      params.push(tipoAtual);
    }
    if (conds.length) sql += ` WHERE ` + conds.join(' AND ') + ` `;

    sql += `
      GROUP BY p.id
      ORDER BY p.nome_oficial
      LIMIT 500
    `;

    const linhas = Banco.query(sql, params);
    // V666: versão publicada agora é editável — se for a última (sem rascunho)
    // a viva é espelho e a edição segue o caminho normal; nas demais, grava-se
    // direto no snapshot congelado daquela versão.
    const espelhoViva = vid ? versaoEspelhoDaViva(vid) : false;
    const rotuloVersao = vid ? (() => {
      try {
        const v = Banco.queryUnica(`SELECT numero, data_vigencia FROM tabela_versoes WHERE id = ?`, [vid]);
        return v ? ` — Versão ${v.numero}${espelhoViva ? ' (igual à tabela atual)' : ' (editando o histórico da versão)'}` : '';
      } catch (_) { return ''; }
    })() : '';
    contador.textContent = `${linhas.length} procedimento${linhas.length !== 1 ? 's' : ''}${rotuloVersao}`;

    // V566: informativo da versão em exibição no SUBTÍTULO da tela
    const subVer = document.getElementById('bt-sub-versao');
    if (subVer && window.AtlasVersoesTabela) {
      const fmtV = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || ''); };
      let txt = '', cls = '';
      try {
        const vs = AtlasVersoesTabela.listar();
        if (vid) {
          const v = vs.find(x => x.id === vid);
          if (v) { txt = `Vendo: Versão ${v.numero} — editável (vigente desde ${fmtV(v.data_vigencia)})`; cls = 'hist'; }
        } else if (!vs.length) {
          txt = 'Versão 1.0 em preparação (ainda não publicada)'; cls = 'rasc';
        } else if (AtlasVersoesTabela.temRascunho()) {
          txt = `Rascunho da Versão ${AtlasVersoesTabela.proximoNumero()} — em edição (só vale após publicar)`; cls = 'rasc';
        } else {
          // V569: a última versão publicada é a que vale para TODA admissão
          // daqui em diante (até publicar outra) → "vigência atual"
          // V587: publicação AGENDADA (vigência futura) → selo âmbar
          const u = vs[vs.length - 1];
          const hj = new Date();
          const hjISO = `${hj.getFullYear()}-${String(hj.getMonth() + 1).padStart(2, '0')}-${String(hj.getDate()).padStart(2, '0')}`;
          if (u.data_vigencia > hjISO) { txt = `Versão ${u.numero} — agendada para ${fmtV(u.data_vigencia)}`; cls = 'rasc'; }
          else { txt = `Versão ${u.numero} — vigência atual`; cls = 'vig'; }
        }
      } catch (_) {}
      subVer.className = 'bt-sub-versao ' + cls;
      subVer.textContent = txt;
    }

    if (linhas.length === 0) {
      divConteudo.innerHTML = `
        <div class="empty-state" style="padding: 60px 20px">
          <div class="icon">∅</div>
          <h3>Nenhum procedimento encontrado</h3>
          <p>${termoBusca ? 'Tente outra busca' : 'Importe sua base tabela para começar'}</p>
        </div>
      `;
      return;
    }

    const isParticular = tipoAtual === 'PARTICULAR';
    const tituloTipo = isParticular
      ? 'TABELA PARTICULAR (% ou R$ fixo)'
      : tipoAtual === 'SUS'
        ? 'TABELA SUS (R$)'
        : 'TABELA CONVÊNIO (R$)';

    // No Particular cada célula é % OU R$ fixo: se 'valor' (R$) estiver preenchido,
    // é FIXO; senão, se 'percentual' estiver, é PCT. Conv/SUS são sempre FIXO (R$).
    function celula(valor, perc, papelNome, procId) {
      let modo, v;
      if (isParticular) {
        if (valor !== null && valor !== undefined)      { modo = 'FIXO'; v = valor; }
        else if (perc !== null && perc !== undefined)   { modo = 'PCT';  v = perc;  }
        else                                            { modo = 'PCT';  v = null;  }
      } else {
        modo = 'FIXO'; v = valor;
      }
      const display = (v === null || v === undefined)
        ? '—'
        : (modo === 'PCT' ? Utilidades.formatarPercentual(v) : Utilidades.formatarMoeda(v));
      const vazio = (v === null || v === undefined) ? 'vazio' : '';
      return `<td class="valor-cel ${vazio}"
                  data-proc-id="${procId}"
                  data-papel="${papelNome}"
                  data-modo="${modo}"
                  data-valor-bruto="${v ?? ''}"
                  title="Clique para editar">${display}</td>`;
    }

    /**
     * Soma os papéis de UMA trilha (todos da mesma unidade).
     * Regra: Executante + (Indicante OU Solicitante) + Auxiliar + Médico Laudo
     *  - Indicante e Solicitante com MESMO valor → soma só um (evita duplicação)
     *  - valores diferentes → soma ambos
     */
    function somarTrilha(vals) {
      const vExec = vals['Executante'], vInd = vals['Indicante'], vSol = vals['Solicitante'],
            vAux  = vals['Auxiliar'],   vLau = vals['Médico Laudo'];
      let total = 0;
      if (vExec) total += Number(vExec);
      if (vAux)  total += Number(vAux);
      if (vLau)  total += Number(vLau);
      if (vInd && vSol) total += (Number(vInd) === Number(vSol)) ? Number(vInd) : (Number(vInd) + Number(vSol));
      else if (vInd)    total += Number(vInd);
      else if (vSol)    total += Number(vSol);
      return total;
    }

    // A partir de uma linha do SQL, retorna {fixo, pct}.
    // Conv/SUS → tudo em fixo. Particular → cada papel cai na trilha do seu modo.
    function totaisDaLinha(linha) {
      if (!isParticular) {
        return {
          fixo: somarTrilha({
            'Executante': linha.v_exec, 'Indicante': linha.v_ind, 'Solicitante': linha.v_sol,
            'Auxiliar': linha.v_aux, 'Médico Laudo': linha.v_lau,
          }),
          pct: 0,
        };
      }
      const F = {}, P = {};
      const map = [
        ['Executante', 'v_exec', 'p_exec'], ['Indicante', 'v_ind', 'p_ind'],
        ['Solicitante', 'v_sol', 'p_sol'], ['Auxiliar', 'v_aux', 'p_aux'],
        ['Médico Laudo', 'v_lau', 'p_lau'],
      ];
      for (const [papel, vk, pk] of map) {
        if (linha[vk] !== null && linha[vk] !== undefined)      F[papel] = linha[vk];
        else if (linha[pk] !== null && linha[pk] !== undefined) P[papel] = linha[pk];
      }
      return { fixo: somarTrilha(F), pct: somarTrilha(P) };
    }

    function celulaTotal(linha) {
      const { fixo, pct } = totaisDaLinha(linha);
      const partes = [];
      if (fixo > 0) partes.push(Utilidades.formatarMoeda(fixo));
      if (pct > 0)  partes.push(Utilidades.formatarPercentual(pct));
      const ehZero = partes.length === 0;
      const display = ehZero ? '—' : partes.join(' + ');
      return `<td class="total-cel ${ehZero ? 'zero' : ''}"
                  title="Soma: Executante + Indicante (ou Solicitante) + Auxiliar + Médico Laudo. No Particular, R$ fixo e % aparecem separados.">${display}</td>`;
    }

    let html = `
      <table class="tabela-valores">
        <thead>
          <tr>
            <th class="col-usar" title="Marque os procedimentos que entram na regra de repasse">USAR</th>
            <th class="col-classif" title="Categoria da PRODUÇÃO (match pelo PRODUTO; editável)">CATEGORIA</th>
            <th class="col-classif" title="Subespecialidade da PRODUÇÃO (match pelo PRODUTO; editável)">SUBESPECIALIDADE</th>
            <th>${tituloTipo}</th>
            <th class="col-nomenclatura">NOMENCLATURA</th>
            <th class="num">EXECUTANTE</th>
            <th class="num">INDICANTE</th>
            <th class="num">SOLICITANTE</th>
            <th class="num">AUXILIAR</th>
            <th class="num">MÉDICO LAUDO</th>
            <th class="num col-total">TOTAL</th>
          </tr>
        </thead>
        <tbody>
    `;

    // V554: célula editável de classificação (categoria/subcategoria/subespecialidade)
    const celClassif = (linha, campo) => {
      const origem = linha.prod_class_origem === 'manual' ? 'editado à mão'
                   : linha.prod_class_origem === 'auto' ? 'preenchido da Produção'
                   : 'ainda não encontrado na Produção';
      return `
          <td class="classif-cel">
            <input type="text" class="classif-input" data-proc-id="${linha.proc_id}" data-campo="${campo}"
                   value="${escapeHTML(linha[campo] || '')}" placeholder="—" title="${origem}">
          </td>`;
    };

    for (const linha of linhas) {
      html += `
        <tr data-proc-id="${linha.proc_id}" class="${linha.repassavel ? '' : 'proc-inativo'}">
          <td class="cel-usar">
            <input type="checkbox" class="chk-usar" data-proc-id="${linha.proc_id}" ${linha.repassavel ? 'checked' : ''}
                   title="${linha.repassavel ? 'Procedimento ativo (entra na regra)' : 'Desativado — zera no cálculo'}">
          </td>
          ${celClassif(linha, 'prod_categoria')}
          ${celClassif(linha, 'prod_subespecialidade')}
          <td class="nome-proc">
            ${escapeHTML(linha.nome_oficial)}
            ${linha.qtd_grafias > 1 ? `<span class="qtd-grafias" title="Tem ${linha.qtd_grafias} grafias diferentes">${linha.qtd_grafias} grafias</span>` : ''}
            <span class="acoes">
              <button class="btn-acao btn-excluir" data-proc-id="${linha.proc_id}"
                      title="Excluir este procedimento">×</button>
            </span>
          </td>
          <td class="nomenclatura-cel">
            <input type="text" class="nomenclatura-input" data-proc-id="${linha.proc_id}"
                   value="${escapeHTML(linha.nomenclatura || '')}" placeholder="—"
                   title="Nomenclatura (para o módulo de indicadores)">
          </td>
          ${celula(linha.v_exec, linha.p_exec, 'Executante',   linha.proc_id)}
          ${celula(linha.v_ind,  linha.p_ind,  'Indicante',    linha.proc_id)}
          ${celula(linha.v_sol,  linha.p_sol,  'Solicitante',  linha.proc_id)}
          ${celula(linha.v_aux,  linha.p_aux,  'Auxiliar',     linha.proc_id)}
          ${celula(linha.v_lau,  linha.p_lau,  'Médico Laudo', linha.proc_id)}
          ${celulaTotal(linha)}
        </tr>
      `;
    }

    html += '</tbody></table>';
    divConteudo.innerHTML = html;

    // V666: versão publicada → grade EDITÁVEL gravando no snapshot congelado
    // daquela versão (tabela_repasse_hist / procedimentos_hist). A trava por
    // senha e o histórico (antes × depois) valem igual. Se a versão é a última
    // e não há rascunho, cai no caminho normal logo abaixo (viva + sincVer).
    if (vid && !espelhoViva) {
      const numeroVer = numeroDaVersao(vid);
      divConteudo.querySelectorAll('.valor-cel').forEach(td => {
        td.title = `Clique para editar (grava na Versão ${numeroVer})`;
        td.addEventListener('click', () => iniciarEdicao(td, vid));
      });
      const updHist = (campo, valor, procId) => {
        Banco.executar(`UPDATE procedimentos_hist SET ${campo} = ? WHERE versao_id = ? AND procedimento_id = ?`,
          [valor, vid, procId]);
        invalidarPosEdicaoVersao();
      };
      divConteudo.querySelectorAll('.chk-usar').forEach(chk => {
        chk.addEventListener('click', (e) => e.stopPropagation());
        chk.addEventListener('change', async () => {
          const pid = Number(chk.dataset.procId);
          updHist('repassavel', chk.checked ? 1 : 0, pid);
          tlEdicaoVersao(numeroVer, `${chk.checked ? '✓ ligou' : '✗ desligou'} USAR · ${nomeProcNaVersao(vid, pid)}`);
          if (Banco.salvarDebounced) Banco.salvarDebounced(); else Banco.salvar();   // V683: UI na hora; persiste em 2º plano
          const tr = chk.closest('tr');
          if (tr) tr.classList.toggle('proc-inativo', !chk.checked);
          chk.title = chk.checked ? 'Procedimento ativo (entra na regra)' : 'Desativado — zera no cálculo';
        });
      });
      divConteudo.querySelectorAll('.nomenclatura-input').forEach(inp => {
        inp.addEventListener('click', (e) => e.stopPropagation());
        inp.addEventListener('change', async () => {
          const pid = Number(inp.dataset.procId);
          updHist('nomenclatura', inp.value.trim() || null, pid);
          tlEdicaoVersao(numeroVer, `✎ nomenclatura · ${nomeProcNaVersao(vid, pid)}`);
          if (Banco.salvarDebounced) Banco.salvarDebounced(); else Banco.salvar();   // V683: UI na hora; persiste em 2º plano
        });
      });
      const CAMPOS_CLASS_VER = { prod_categoria: 'categoria', prod_subcategoria: 'subcategoria', prod_subespecialidade: 'subespecialidade' };
      divConteudo.querySelectorAll('.classif-input').forEach(inp => {
        inp.addEventListener('click', (e) => e.stopPropagation());
        inp.addEventListener('change', async () => {
          const pid = Number(inp.dataset.procId);
          const campo = inp.dataset.campo;
          if (!CAMPOS_CLASS_VER[campo]) return;   // whitelist — nome de coluna nunca vem do usuário
          updHist(campo, inp.value.trim() || null, pid);
          tlEdicaoVersao(numeroVer, `✎ ${CAMPOS_CLASS_VER[campo]} · ${nomeProcNaVersao(vid, pid)}`);
          if (Banco.salvarDebounced) Banco.salvarDebounced(); else Banco.salvar();   // V683: UI na hora; persiste em 2º plano
        });
      });
      // V677: excluir procedimento DA VERSÃO — sai só do snapshot dela (regras
      // + procedimento); a tabela atual, as outras versões e o cadastro ficam
      divConteudo.querySelectorAll('.btn-excluir').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!btDestravado) { btAbrirModalTrava(null); return; }
          const pid = Number(btn.dataset.procId);
          const nomeP = nomeProcNaVersao(vid, pid);
          const okX = confirm(
            `Excluir "${nomeP}" da Versão ${numeroVer}?\n\n` +
            `Sai SÓ do histórico desta versão (procedimento + valores). ` +
            `A tabela atual, as outras versões e o cadastro continuam intactos.\n\n` +
            `Esta ação não pode ser desfeita.`
          );
          if (!okX) return;
          const regs = Banco.query(
            `SELECT pap.nome AS papel, t.fonte_pagadora AS fonte, t.valor, t.percentual
               FROM tabela_repasse_hist t JOIN papeis pap ON pap.id = t.papel_id
              WHERE t.versao_id = ? AND t.procedimento_id = ?`, [vid, pid]) || [];
          for (const v of regs) {
            btRegistrar('EDICAO-VERSAO', {
              procedimento: `${nomeP} (Versão ${numeroVer})`, papel: v.papel, fonte: v.fonte,
              acao: 'EXCLUSAO', valorAntes: v.valor, percAntes: v.percentual,
              valorDepois: null, percDepois: null,
            }, BT_TL_AREA_VERSOES);
          }
          Banco.executar(`DELETE FROM tabela_repasse_hist WHERE versao_id = ? AND procedimento_id = ?`, [vid, pid]);
          Banco.executar(`DELETE FROM procedimentos_hist WHERE versao_id = ? AND procedimento_id = ?`, [vid, pid]);
          try { Banco._tlAutoContar && Banco._tlAutoContar(BT_TL_AREA_VERSOES, Math.max(1, regs.length)); } catch (_) {}
          invalidarPosEdicaoVersao();
          if (Banco.salvarDebounced) Banco.salvarDebounced(); else Banco.salvar();
          Utilidades.toast?.(`✓ "${nomeP}" removido da Versão ${numeroVer}`, 'success', 3400);
          renderizarTabela();
        });
      });
      return;
    }

    // Bind: clique em qualquer célula de valor inicia a edição
    divConteudo.querySelectorAll('.valor-cel').forEach(td => {
      td.addEventListener('click', () => iniciarEdicao(td));
    });

    // Bind: nomenclatura (texto livre por procedimento, p/ módulo de indicadores)
    divConteudo.querySelectorAll('.nomenclatura-input').forEach(inp => {
      inp.addEventListener('click', (e) => e.stopPropagation());
      inp.addEventListener('change', async () => {
        const pid = Number(inp.dataset.procId);
        const val = inp.value.trim();
        Banco.executar(
          'UPDATE procedimentos SET nomenclatura = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?',
          [val || null, pid]
        );
        sincVer(pid);   // V572
        if (Banco.salvarDebounced) Banco.salvarDebounced(); else Banco.salvar();   // V683: UI na hora; persiste em 2º plano
      });
    });

    // V554: edição das colunas de classificação — grava como MANUAL (a busca
    // automática nunca sobrescreve) e fixa a linha como já buscada.
    const CAMPOS_CLASS = { prod_categoria: 1, prod_subcategoria: 1, prod_subespecialidade: 1 };
    divConteudo.querySelectorAll('.classif-input').forEach(inp => {
      inp.addEventListener('click', (e) => e.stopPropagation());
      inp.addEventListener('change', async () => {
        const pid = Number(inp.dataset.procId);
        const campo = inp.dataset.campo;
        if (!CAMPOS_CLASS[campo]) return;   // whitelist — nome de coluna nunca vem do usuário
        const val = inp.value.trim();
        Banco.executar(
          `UPDATE procedimentos SET ${campo} = ?, prod_class_origem = 'manual',
                  prod_class_buscado = 1, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
          [val || null, pid]
        );
        sincVer(pid);   // V572
        if (Banco.salvarDebounced) Banco.salvarDebounced(); else Banco.salvar();   // V683: UI na hora; persiste em 2º plano
        inp.title = 'editado à mão';
        // V562: repõe as opções dos filtros na hora — preencher o último campo
        // em branco faz a opção "Vazio" sumir (e um valor que deixou de existir
        // também some). Se a seleção atual ficou sem conteúdo, ela é limpa e a
        // grade recarregada para refletir o filtro novo.
        const antes = filtroCategoria + '|' + filtroSubesp;
        try { atualizarFiltrosClass(); } catch (_) {}
        if (antes !== filtroCategoria + '|' + filtroSubesp) renderizarTabela();
      });
    });

    // Bind: flag USAR (liga/desliga o procedimento na regra de repasse)
    divConteudo.querySelectorAll('.chk-usar').forEach(chk => {
      chk.addEventListener('click', (e) => e.stopPropagation());
      chk.addEventListener('change', async () => {
        const pid = Number(chk.dataset.procId);
        Banco.executar(
          'UPDATE procedimentos SET repassavel = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?',
          [chk.checked ? 1 : 0, pid]
        );
        sincVer(pid);   // V572: ajuste fino entra também na versão vigente
        if (Banco.salvarDebounced) Banco.salvarDebounced(); else Banco.salvar();   // V683: UI na hora; persiste em 2º plano
        const tr = chk.closest('tr');
        if (tr) tr.classList.toggle('proc-inativo', !chk.checked);
        chk.title = chk.checked ? 'Procedimento ativo (entra na regra)' : 'Desativado — zera no cálculo';
      });
    });

    // Bind: botão de excluir procedimento
    divConteudo.querySelectorAll('.btn-excluir').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();  // não dispara clique na célula
        excluirProcedimento(Number(btn.dataset.procId));
      });
    });
  }

  // ==========================================================================
  // EDIÇÃO INLINE
  // ==========================================================================

  // Repinta UMA célula de valor in-place (sem reconstruir a tabela inteira).
  // `armazenado` = valor canônico já no formato do banco (R$ p/ FIXO, fração 0.18 p/ PCT).
  // `modo` = 'PCT' | 'FIXO' (Conv/SUS sempre 'FIXO').
  function pintarCelula(td, armazenado, modo) {
    const temValor = armazenado !== null && armazenado !== undefined && armazenado !== '';
    td.dataset.valorBruto = temValor ? String(armazenado) : '';
    td.dataset.modo = modo;
    td.classList.remove('editando');
    td.classList.toggle('vazio', !temValor);
    td.textContent = temValor
      ? (modo === 'PCT'
          ? Utilidades.formatarPercentual(Number(armazenado))
          : Utilidades.formatarMoeda(Number(armazenado)))
      : '—';
    td.title = 'Clique para editar';
  }

  // Recalcula a célula TOTAL de uma linha lendo data-modo + data-valor-bruto das células.
  // No Particular separa as trilhas R$ (FIXO) e % (PCT) e mostra "R$ x + y%".
  function recalcularTotalLinha(tr) {
    if (!tr) return;
    const isPart = tipoAtual === 'PARTICULAR';
    const F = {}, P = {};
    tr.querySelectorAll('.valor-cel').forEach(c => {
      const raw = c.dataset.valorBruto;
      const v = (raw === '' || raw == null) ? null : Number(raw);
      if (v === null) return;
      const modo = c.dataset.modo || 'FIXO';
      if (modo === 'PCT') P[c.dataset.papel] = v; else F[c.dataset.papel] = v;
    });

    const somar = (vals) => {
      const vExec = vals['Executante'], vInd = vals['Indicante'], vSol = vals['Solicitante'],
            vAux  = vals['Auxiliar'],   vLau = vals['Médico Laudo'];
      let t = 0;
      if (vExec) t += vExec;
      if (vAux)  t += vAux;
      if (vLau)  t += vLau;
      if (vInd && vSol) t += (Number(vInd) === Number(vSol)) ? vInd : (vInd + vSol);
      else if (vInd)    t += vInd;
      else if (vSol)    t += vSol;
      return t;
    };

    const tdTotal = tr.querySelector('.total-cel');
    if (!tdTotal) return;

    const tFixo = somar(F);
    const tPct  = isPart ? somar(P) : 0;
    const partes = [];
    if (tFixo > 0) partes.push(Utilidades.formatarMoeda(tFixo));
    if (tPct > 0)  partes.push(Utilidades.formatarPercentual(tPct));
    const ehZero = partes.length === 0;
    tdTotal.classList.toggle('zero', ehZero);
    tdTotal.textContent = ehZero ? '—' : partes.join(' + ');
  }

  // V666: `vidAlvo` opcional — editando uma versão publicada, a gravação vai
  // para o snapshot daquela versão (tabela_repasse_hist) em vez da tabela viva
  function iniciarEdicao(td, vidAlvo) {
    if (td.classList.contains('editando')) return;

    // V489: só edita com a Base Tabela destravada
    if (!btDestravado) { btAbrirModalTrava(null); return; }

    const procId = Number(td.dataset.procId);
    const papelNome = td.dataset.papel;
    const valorBruto = td.dataset.valorBruto;
    const isParticular = tipoAtual === 'PARTICULAR';

    // Modo atual da célula: PCT (%) ou FIXO (R$). Conv/SUS são sempre FIXO.
    const modoOriginal = isParticular ? (td.dataset.modo || 'PCT') : 'FIXO';
    let modoEd = modoOriginal;

    // Converte o valor armazenado p/ o texto visível conforme o modo
    function visualDoValor(raw, modo) {
      if (raw === '' || raw == null) return '';
      if (modo === 'PCT') {
        // fração (0.18) → "18" (toFixed evita 18.000000000000004)
        return String(parseFloat((Number(raw) * 100).toFixed(6))).replace('.', ',');
      }
      return String(Number(raw)).replace('.', ',');
    }

    td.classList.add('editando');
    if (isParticular) {
      td.innerHTML = `
        <div class="cel-edit-wrap">
          <button type="button" class="cel-modo-toggle" title="Alternar entre % e R$ fixo">${modoEd === 'PCT' ? '%' : 'R$'}</button>
          <input type="text" inputmode="decimal" value="${visualDoValor(valorBruto, modoEd)}"
                 placeholder="${modoEd === 'PCT' ? 'ex: 18' : 'ex: 350,00'}">
        </div>`;
    } else {
      td.innerHTML = `<input type="text" inputmode="decimal" value="${visualDoValor(valorBruto, 'FIXO')}"
                            placeholder="ex: 350,00">`;
    }

    const input = td.querySelector('input');
    const toggle = td.querySelector('.cel-modo-toggle');
    input.focus();
    input.select();

    // Alterna %/R$ sem perder o foco do input (mousedown + preventDefault evita o blur).
    // Não converte o número: só muda como ele será interpretado ao salvar.
    if (toggle) {
      toggle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        modoEd = (modoEd === 'PCT') ? 'FIXO' : 'PCT';
        toggle.textContent = modoEd === 'PCT' ? '%' : 'R$';
        input.placeholder = modoEd === 'PCT' ? 'ex: 18' : 'ex: 350,00';
        input.focus();
      });
    }

    let finalizado = false;

    async function finalizar(salvar) {
      if (finalizado) return;
      finalizado = true;

      const valorOriginal = (valorBruto === '' || valorBruto == null) ? null : valorBruto;

      if (!salvar) {
        // Cancelou (Esc): restaura a célula com o valor/modo que já estava
        pintarCelula(td, valorOriginal, modoOriginal);
        return;
      }

      // Parsing robusto pt-BR: se houver vírgula, ela é o decimal e o ponto é milhar
      let txt = input.value.trim().replace(/\s/g, '');
      if (txt.includes(',')) txt = txt.replace(/\./g, '').replace(',', '.');
      const novoValor = txt === '' ? null : Number(txt);

      if (txt !== '' && (isNaN(novoValor) || novoValor < 0)) {
        Utilidades.toast('Valor inválido. Use números (ex: 18 ou 350,00)', 'error');
        pintarCelula(td, valorOriginal, modoOriginal);  // mantém o que estava
        return;
      }

      const armazenado = await salvarValor(procId, papelNome, novoValor, modoEd, vidAlvo);
      pintarCelula(td, armazenado, modoEd);
      td.classList.add('alterado');
      recalcularTotalLinha(td.closest('tr'));
    }

    input.addEventListener('blur', () => finalizar(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }      // dispara finalizar(true) uma vez
      if (e.key === 'Escape') { e.preventDefault(); finalizar(false); }
    });
  }

  async function salvarValor(procId, papelNome, novoValor, modo, vidAlvo) {
    const papelId = papeisMap[papelNome];
    const fonte = tipoAtual;

    let valorFinal = null;
    let percentualFinal = null;

    if (novoValor !== null) {
      if (modo === 'PCT') {
        // Usuário digita 18 → salvamos 0.18 (campo percentual; valor fica null)
        percentualFinal = novoValor > 1 ? novoValor / 100 : novoValor;
      } else {
        // R$ fixo → campo valor; percentual fica null (o motor de cálculo paga cheio)
        valorFinal = novoValor;
      }
    }

    // ── V666: gravação direta no snapshot de uma versão publicada ──────────
    // A tabela viva NÃO muda — só o histórico congelado daquela versão. As
    // admissões resolvidas para essa versão passam a pagar o valor novo nos
    // próximos recálculos; meses consolidados seguem congelados no snapshot.
    if (vidAlvo) {
      const exHist = Banco.queryUnica(
        `SELECT rowid AS rid, valor, percentual FROM tabela_repasse_hist
          WHERE versao_id = ? AND procedimento_id = ? AND papel_id = ? AND fonte_pagadora = ?`,
        [vidAlvo, procId, papelId, fonte]);
      const nomeProcV = nomeProcNaVersao(vidAlvo, procId);
      const antesValorV = exHist ? exHist.valor : null;
      const antesPercV  = exHist ? exHist.percentual : null;
      if (novoValor === null) {
        if (exHist) Banco.executar(`DELETE FROM tabela_repasse_hist WHERE rowid = ?`, [exHist.rid]);
      } else if (exHist) {
        Banco.executar(`UPDATE tabela_repasse_hist SET valor = ?, percentual = ? WHERE rowid = ?`,
          [valorFinal, percentualFinal, exHist.rid]);
      } else {
        Banco.executar(
          `INSERT INTO tabela_repasse_hist (versao_id, procedimento_id, papel_id, fonte_pagadora, valor, percentual, ativo)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [vidAlvo, procId, papelId, fonte, valorFinal, percentualFinal]);
      }
      const numeroVer = numeroDaVersao(vidAlvo);
      const mudouV = Number(antesValorV ?? -1) !== Number(valorFinal ?? -1)
                  || Number(antesPercV  ?? -1) !== Number(percentualFinal ?? -1);
      if (mudouV) {
        // histórico da Base Tabela (antes × depois) + Linha do Tempo na área
        // própria das versões — o hook automático não vigia as *_hist
        btRegistrar('EDICAO-VERSAO', {
          procedimento: `${nomeProcV} (Versão ${numeroVer})`, papel: papelNome, fonte,
          acao: !exHist ? 'INCLUSAO' : (novoValor === null ? 'EXCLUSAO' : 'ALTERACAO'),
          valorAntes: antesValorV, percAntes: antesPercV,
          valorDepois: valorFinal, percDepois: percentualFinal,
        }, BT_TL_AREA_VERSOES);
        if (Banco._tlAutoContar) { try { Banco._tlAutoContar(BT_TL_AREA_VERSOES, 1); } catch (_) {} }
      }
      invalidarPosEdicaoVersao();
      if (Banco.salvarDebounced) Banco.salvarDebounced(); else Banco.salvar();   // V683: UI na hora; persiste em 2º plano
      Utilidades.toast(`Valor salvo na Versão ${numeroVer} — vale nos próximos recálculos das admissões dessa vigência`, 'success', 3200);
      return novoValor === null ? null : (modo === 'PCT' ? percentualFinal : valorFinal);
    }

    const existente = Banco.queryUnica(
      `SELECT id, valor, percentual FROM tabela_repasse
        WHERE procedimento_id = ? AND papel_id = ? AND fonte_pagadora = ?`,
      [procId, papelId, fonte]
    );

    // V489: fotografa o valor anterior para o snapshot
    const nomeProc = (Banco.queryUnica(
      'SELECT nome_oficial FROM procedimentos WHERE id = ?', [procId]
    ) || {}).nome_oficial || '—';
    const antesValor = existente ? existente.valor : null;
    const antesPerc  = existente ? existente.percentual : null;

    if (novoValor === null) {
      // Campo vazio = apagar registro
      if (existente) {
        Banco.executar('DELETE FROM tabela_repasse WHERE id = ?', [existente.id]);
      }
    } else if (existente) {
      Banco.executar(
        `UPDATE tabela_repasse
            SET valor = ?, percentual = ?, atualizado_em = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [valorFinal, percentualFinal, existente.id]
      );
    } else {
      Banco.executar(
        `INSERT INTO tabela_repasse
           (procedimento_id, papel_id, fonte_pagadora, valor, percentual)
         VALUES (?, ?, ?, ?, ?)`,
        [procId, papelId, fonte, valorFinal, percentualFinal]
      );
    }

    sincVer(procId);   // V572: ajuste fino entra também na versão vigente

    // V489: registra a alteração no snapshot da sessão (só se mudou de fato)
    const mudou = Number(antesValor ?? -1) !== Number(valorFinal ?? -1)
               || Number(antesPerc  ?? -1) !== Number(percentualFinal ?? -1);
    if (mudou) {
      btRegistrar('EDICAO', {
        procedimento: nomeProc,
        papel: papelNome,
        fonte: fonte,
        acao: !existente ? 'INCLUSAO' : (novoValor === null ? 'EXCLUSAO' : 'ALTERACAO'),
        valorAntes: antesValor, percAntes: antesPerc,
        valorDepois: valorFinal, percDepois: percentualFinal,
      });
    }

    if (Banco.salvarDebounced) Banco.salvarDebounced(); else Banco.salvar();   // V683: UI na hora; persiste em 2º plano
    Utilidades.toast('Valor salvo', 'success', 1500);

    // Valor canônico (no formato do banco) p/ repintar a célula in-place
    return novoValor === null ? null : (modo === 'PCT' ? percentualFinal : valorFinal);
  }

  // ==========================================================================
  // EXCLUIR PROCEDIMENTO
  // ==========================================================================

  async function excluirProcedimento(procId) {
    // V489: exige destrave
    if (!btDestravado) { btAbrirModalTrava(null); return; }

    // Busca dados do procedimento para mostrar impacto
    const proc = Banco.queryUnica(
      'SELECT nome_oficial FROM procedimentos WHERE id = ?',
      [procId]
    );
    if (!proc) {
      Utilidades.toast('Procedimento não encontrado', 'error');
      return;
    }

    const qtdGrafias = Banco.queryUnica(
      'SELECT COUNT(*) AS n FROM sinonimos_proc WHERE procedimento_id = ?',
      [procId]
    ).n;

    const qtdValores = Banco.queryUnica(
      'SELECT COUNT(*) AS n FROM tabela_repasse WHERE procedimento_id = ?',
      [procId]
    ).n;

    // Confirmação dupla com informação clara
    const mensagem =
      `Excluir o procedimento abaixo?\n\n` +
      `   "${proc.nome_oficial}"\n\n` +
      `Será apagado:\n` +
      `   • ${qtdGrafias} grafia(s) cadastrada(s)\n` +
      `   • ${qtdValores} valor(es) de repasse (Convênio + Particular)\n\n` +
      `Esta ação NÃO pode ser desfeita.\n` +
      `(Faça um backup antes, se quiser garantir!)`;

    if (!confirm(mensagem)) return;

    // V489: registra no snapshot cada valor que será apagado
    const valoresAntes = Banco.query(
      `SELECT pa.nome AS papel, t.fonte_pagadora AS fonte, t.valor, t.percentual
         FROM tabela_repasse t JOIN papeis pa ON pa.id = t.papel_id
        WHERE t.procedimento_id = ?`, [procId]
    );
    for (const v of valoresAntes) {
      btRegistrar('EDICAO', {
        procedimento: proc.nome_oficial, papel: v.papel, fonte: v.fonte,
        acao: 'EXCLUSAO',
        valorAntes: v.valor, percAntes: v.percentual,
        valorDepois: null, percDepois: null,
      });
    }
    if (!valoresAntes.length) {
      btRegistrar('EDICAO', {
        procedimento: proc.nome_oficial, papel: '—', fonte: '—',
        acao: 'EXCLUSAO', valorAntes: null, percAntes: null,
        valorDepois: null, percDepois: null,
      });
    }

    // Apaga (ordem importa por causa das FK)
    Banco.executar('DELETE FROM tabela_repasse WHERE procedimento_id = ?', [procId]);
    Banco.executar('DELETE FROM sinonimos_proc WHERE procedimento_id = ?', [procId]);
    Banco.executar('DELETE FROM procedimentos WHERE id = ?', [procId]);
    sincVer(procId);   // V572: a exclusão sai também do snapshot da versão vigente

    if (Banco.salvarDebounced) Banco.salvarDebounced(); else Banco.salvar();   // V683: UI na hora; persiste em 2º plano
    Utilidades.toast(`Procedimento "${proc.nome_oficial}" excluído`, 'success');
    renderizarTabela();
  }

  // ==========================================================================
  // MODAL: Novo Procedimento
  // ==========================================================================

  // Guarda o ID do procedimento recém-criado para destacar visualmente
  let procRecemCriado = null;

  function abrirModalNovoProcedimento() {
    // V489: exige destrave
    if (!btDestravado) { btAbrirModalTrava(null); return; }

    // V677: visualizando uma versão publicada → o novo procedimento entra NA
    // VERSÃO (cadastro global + snapshot dela); a tabela atual não ganha regra
    const vidNovo = (versaoVisao && !versaoEspelhoDaViva(versaoVisao)) ? Number(versaoVisao) : null;
    if (vidNovo) {
      const numeroVer = numeroDaVersao(vidNovo);
      const nomeV = prompt(`Nome do novo procedimento (entra na Versão ${numeroVer}):`);
      if (!nomeV || !nomeV.trim()) return;
      const nomeOrigV = nomeV.trim();
      const nomeNormV = Utilidades.normalizar(nomeOrigV);
      let procIdV;
      const exCad = Banco.queryUnica(`SELECT id FROM procedimentos WHERE nome_normalizado = ?`, [nomeNormV]);
      if (exCad) {
        procIdV = exCad.id;
        const exVer = Banco.queryUnica(`SELECT 1 AS um FROM procedimentos_hist WHERE versao_id = ? AND procedimento_id = ?`, [vidNovo, procIdV]);
        if (exVer) { alert(`"${nomeOrigV}" já existe na Versão ${numeroVer}.`); return; }
      } else {
        const rNovo = Banco.executar(
          `INSERT INTO procedimentos (nome_oficial, nome_normalizado, repassavel) VALUES (?, ?, 1)`,
          [nomeOrigV, nomeNormV]);
        procIdV = rNovo.lastInsertRowId;
        Banco.executar(
          `INSERT INTO sinonimos_proc (procedimento_id, grafia, grafia_normalizada, fonte, aprovado_por)
           VALUES (?, ?, ?, 'MANUAL', 'USUARIO')`, [procIdV, nomeOrigV, nomeNormV]);
      }
      ImportadorBaseTabela._garantirProcNaVersao(vidNovo, procIdV);
      btRegistrar('EDICAO-VERSAO', {
        procedimento: `${nomeOrigV} (Versão ${numeroVer})`, papel: '—', fonte: '—',
        acao: 'INCLUSAO', valorAntes: null, percAntes: null, valorDepois: null, percDepois: null,
      }, BT_TL_AREA_VERSOES);
      try { Banco._tlAutoContar && Banco._tlAutoContar(BT_TL_AREA_VERSOES, 1); } catch (_) {}
      invalidarPosEdicaoVersao();
      if (Banco.salvarDebounced) Banco.salvarDebounced(); else Banco.salvar();
      Utilidades.toast?.(`✓ "${nomeOrigV}" criado na Versão ${numeroVer} — clique nas células para preencher os valores.`, 'success', 4200);
      termoBusca = '';
      const inpB = document.getElementById('busca-procedimento');
      if (inpB) inpB.value = '';
      renderizarTabela();
      return;
    }

    const nome = prompt('Nome do novo procedimento:');
    if (!nome || !nome.trim()) return;

    const nomeOriginal = nome.trim();
    const nomeNormalizado = Utilidades.normalizar(nomeOriginal);

    const existente = Banco.queryUnica(
      'SELECT id, nome_oficial FROM procedimentos WHERE nome_normalizado = ?',
      [nomeNormalizado]
    );
    if (existente) {
      alert(`Já existe procedimento equivalente:\n\n"${existente.nome_oficial}"\n\nUse o existente.`);
      return;
    }

    const r = Banco.executar(
      `INSERT INTO procedimentos (nome_oficial, nome_normalizado, repassavel)
       VALUES (?, ?, 1)`,
      [nomeOriginal, nomeNormalizado]
    );

    Banco.executar(
      `INSERT INTO sinonimos_proc
         (procedimento_id, grafia, grafia_normalizada, fonte, aprovado_por)
       VALUES (?, ?, ?, 'MANUAL', 'USUARIO')`,
      [r.lastInsertRowId, nomeOriginal, nomeNormalizado]
    );

    procRecemCriado = r.lastInsertRowId;
    sincVer(r.lastInsertRowId);   // V572: entra também na versão vigente

    // V489: registra a inclusão do procedimento no snapshot da sessão
    btRegistrar('EDICAO', {
      procedimento: nomeOriginal, papel: '—', fonte: '—',
      acao: 'INCLUSAO', valorAntes: null, percAntes: null,
      valorDepois: null, percDepois: null,
    });

    // V683: UI na hora; persiste em 2º plano
    if (Banco.salvarDebounced) Banco.salvarDebounced(); else Banco.salvar();
    {
      Utilidades.toast('Procedimento criado! Clique nas células para preencher os valores.', 'success', 4000);

      // Limpa a busca para garantir que o novo procedimento apareça
      termoBusca = '';
      const inputBusca = document.getElementById('busca-procedimento');
      if (inputBusca) inputBusca.value = '';

      renderizarTabela();

      // Faz scroll até a linha e destaca
      requestAnimationFrame(() => {
        const linha = document.querySelector(`tr[data-proc-id="${procRecemCriado}"]`);
        if (linha) {
          linha.scrollIntoView({ behavior: 'smooth', block: 'center' });
          linha.style.background = 'var(--accent-soft)';
          linha.style.transition = 'background 400ms';
          setTimeout(() => {
            linha.style.background = '';
          }, 3000);
        }
      });
    }
  }

  // ==========================================================================
  // EVENTOS: busca e troca de tipo
  // ==========================================================================

  const inputBusca = document.getElementById('busca-procedimento');
  // V491: debounce de 250ms — antes cada tecla rodava a query pesada
  // (GROUP BY + JOINs + subselects) e reconstruía até 500 linhas.
  let buscaTimer = null;
  inputBusca.addEventListener('input', (e) => {
    termoBusca = e.target.value;
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(() => renderizarTabela(), 250);
  });

  // V557: filtros de Categoria/Subespecialidade + "USAR com valor > 0"
  // V558: filtros ENCADEADOS — escolher a Categoria restringe as opções de
  // Subespecialidade às que existem naquela categoria, e vice-versa. Se a
  // seleção do outro filtro ficar incompatível, ela é limpa sozinha.
  // V560: opção "Vazio" em cada select — mostra só procedimentos com o campo
  // em branco. Ela também participa do encadeamento: só é oferecida (e só
  // continua válida) se existir linha em branco na combinação atual.
  function atualizarFiltrosClass() {
    garantirColunasClass();
    const monta = (selId, coluna, atual, rotuloTodas, colunaOutro, valorOutro) => {
      const sel = document.getElementById(selId);
      if (!sel) return true;
      let vals = [];
      let temVazio = false;
      try {
        let restr = ``;
        const paramsRestr = [];
        if (valorOutro === FILTRO_VAZIO) {
          restr = ` AND TRIM(COALESCE(${colunaOutro}, '')) = ''`;
        } else if (valorOutro) {
          restr = ` AND TRIM(COALESCE(${colunaOutro}, '')) = ?`;
          paramsRestr.push(valorOutro);
        }
        vals = (Banco.query(`SELECT DISTINCT TRIM(${coluna}) AS v FROM procedimentos
                    WHERE ${coluna} IS NOT NULL AND TRIM(${coluna}) <> ''${restr} ORDER BY 1`, paramsRestr) || []).map(r => r.v);
        const rv = Banco.queryUnica(`SELECT 1 AS um FROM procedimentos
                    WHERE TRIM(COALESCE(${coluna}, '')) = ''${restr} LIMIT 1`, paramsRestr);
        temVazio = !!(rv && rv.um);
      } catch (_) {}
      const atualValido = !atual || (atual === FILTRO_VAZIO ? temVazio : vals.includes(atual));
      sel.innerHTML = `<option value="">${rotuloTodas}</option>` +
        (temVazio ? `<option value="${FILTRO_VAZIO}" ${atual === FILTRO_VAZIO ? 'selected' : ''}>Vazio</option>` : '') +
        vals.map(v => `<option value="${escapeHTML(v)}" ${v === atual ? 'selected' : ''}>${escapeHTML(v)}</option>`).join('');
      return atualValido;
    };
    // cada select é restringido pela seleção do OUTRO
    const catOk = monta('filtro-categoria', 'prod_categoria', filtroCategoria, 'Categoria (todas)',
                        'prod_subespecialidade', filtroSubesp);
    const espOk = monta('filtro-subesp', 'prod_subespecialidade', filtroSubesp, 'Subespecialidade (todas)',
                        'prod_categoria', filtroCategoria);
    // seleção que ficou impossível na nova combinação → limpa e repopula
    if (!catOk) { filtroCategoria = ''; return atualizarFiltrosClass(); }
    if (!espOk) { filtroSubesp = ''; return atualizarFiltrosClass(); }
    return true;
  }
  atualizarFiltrosClass();
  const selCat = document.getElementById('filtro-categoria');
  if (selCat) selCat.addEventListener('change', () => { filtroCategoria = selCat.value; atualizarFiltrosClass(); renderizarTabela(); });
  const selEsp = document.getElementById('filtro-subesp');
  if (selEsp) selEsp.addEventListener('change', () => { filtroSubesp = selEsp.value; atualizarFiltrosClass(); renderizarTabela(); });
  const chkValor = document.getElementById('filtro-com-valor');
  if (chkValor) chkValor.addEventListener('change', () => { filtroComValor = chkValor.checked; renderizarTabela(); });

  // V565: o seletor de versão foi substituído pelo painel do ícone flutuante
  // (bt-fab-versoes → abrirPainelVersoes) — nada de versão solto na tela.

  // Helper para alternar entre os três tipos
  function alternarTipo(novoTipo) {
    tipoAtual = novoTipo;
    document.querySelectorAll('.btn-toggle').forEach(b => {
      b.classList.toggle('active', b.dataset.tipo === novoTipo);
    });
    renderizarTabela();
  }

  document.getElementById('tab-convenio').addEventListener('click', () => alternarTipo('CONVENIO'));
  document.getElementById('tab-particular').addEventListener('click', () => alternarTipo('PARTICULAR'));
  document.getElementById('tab-sus').addEventListener('click', () => alternarTipo('SUS'));

  // Render inicial
  renderizarTabela();

  // V554: consulta na PRODUÇÃO os procedimentos ainda não buscados (novos) —
  // roda em 2º plano após a pintura; a 1ª busca bem-sucedida fica fixa.
  setTimeout(() => { try { buscarClassificacaoProducao(); } catch (e) {} }, 60);
};

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
