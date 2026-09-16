/**
 * ============================================================================
 * TELA: Médicos
 *
 * Funcionalidades:
 *   - Filtros por especialidade (botões em grid, multi-seleção)
 *   - Listagem: 1 linha por par (médico, especialidade)
 *   - Cadastro manual + importação de Excel
 *   - Edição inline de especialidades de um médico
 *   - Exclusão de médico (com confirmação)
 *
 * Lógica de filtro:
 *   - Nenhum filtro ativo → mostra TODOS os pares médico×especialidade
 *   - 1+ filtros ativos → mostra médicos que têm AO MENOS UMA das selecionadas (UNIÃO)
 *   - Médico com 3 especialidades aparece em 3 linhas (uma por especialidade)
 * ============================================================================
 */

App.telas['medicos'] = function () {
  // Estado da tela
  const especialidadesAtivas = new Set();  // ids selecionados
  let termoBusca = '';
  let filtroTipo = null;   // null | 'INTERNO' | 'HIBRIDO' | 'EXTERNO' | 'FELLOW' | 'SEM_TIPO'

  // Carregar dados base
  const especialidades = Banco.query(
    'SELECT id, nome FROM especialidades WHERE ativo = 1 ORDER BY ordem, nome'
  );
  const totalMedicos = Banco.contar('medicos', 'ativo = 1');
  const totalInternos = Banco.contar('medicos', "ativo = 1 AND tipo_vinculo = 'INTERNO'");
  const totalHibridos = Banco.contar('medicos', "ativo = 1 AND tipo_vinculo = 'HIBRIDO'");
  const totalExternos = Banco.contar('medicos', "ativo = 1 AND tipo_vinculo = 'EXTERNO'");
  const totalSemTipo = Banco.contar('medicos', "ativo = 1 AND (tipo_vinculo IS NULL OR tipo_vinculo = '')");

  // Total de médicos que também são Fellows (nome_normalizado bate em fellow_cadastro)
  let totalFellows = 0;
  try {
    const r = Banco.queryUnica(`
      SELECT COUNT(DISTINCT m.id) AS n
      FROM medicos m
      JOIN fellow_cadastro fc ON fc.nome_normalizado = m.nome_normalizado
      WHERE m.ativo = 1 AND fc.ativo = 1
    `);
    totalFellows = r?.n || 0;
  } catch (e) { /* tabela fellow_cadastro pode não existir em bancos antigos */ }

  const html = `
    <div class="page-content">
      <header class="page-header">
        <div>
          <h2>Médicos</h2>
          <div class="subtitle">Corpo clínico — clique nas especialidades para filtrar</div>
        </div>
        <div style="display: flex; gap: 8px">
          <input type="file" id="upload-medicos" accept=".xlsx,.xls" style="display: none">
          <button class="btn btn-primary" id="btn-upload-medicos">↑ Importar Excel</button>
          <button class="btn" id="btn-novo-medico">+ Novo Médico</button>
          <button class="btn" id="btn-gerenciar-especialidades" title="Adicionar, renomear ou desativar especialidades">⚙ Especialidades</button>
          ${totalMedicos > 0 ? `
            <button class="btn" id="btn-marcar-internos" title="Marcar todos os médicos sem tipo como INTERNO">⊕ Marcar Internos</button>
            <button class="btn btn-perigo" id="btn-limpar-medicos" title="Apagar todos os médicos cadastrados">🗑 Limpar médicos</button>
          ` : ''}
        </div>
      </header>

      ${totalMedicos > 0 ? `
        <div class="medicos-stats">
          <div class="medico-stat-card medico-stat-total${filtroTipo === null ? ' is-ativo' : ''}" data-tipo="">
            <div class="medico-stat-label">Total</div>
            <div class="medico-stat-valor mono">${totalMedicos}</div>
          </div>
          <div class="medico-stat-card medico-stat-interno${filtroTipo === 'INTERNO' ? ' is-ativo' : ''}" data-tipo="INTERNO">
            <div class="medico-stat-label">Internos</div>
            <div class="medico-stat-valor mono">${totalInternos}</div>
          </div>
          <div class="medico-stat-card medico-stat-hibrido${filtroTipo === 'HIBRIDO' ? ' is-ativo' : ''}" data-tipo="HIBRIDO">
            <div class="medico-stat-label">Híbridos</div>
            <div class="medico-stat-valor mono">${totalHibridos}</div>
          </div>
          <div class="medico-stat-card medico-stat-externo${filtroTipo === 'EXTERNO' ? ' is-ativo' : ''}" data-tipo="EXTERNO">
            <div class="medico-stat-label">Externos</div>
            <div class="medico-stat-valor mono">${totalExternos}</div>
          </div>
          ${totalFellows > 0 ? `
            <div class="medico-stat-card medico-stat-fellow${filtroTipo === 'FELLOW' ? ' is-ativo' : ''}" data-tipo="FELLOW">
              <div class="medico-stat-label">Fellows</div>
              <div class="medico-stat-valor mono">${totalFellows}</div>
            </div>
          ` : ''}
          ${totalSemTipo > 0 ? `
            <div class="medico-stat-card medico-stat-aviso${filtroTipo === 'SEM_TIPO' ? ' is-ativo' : ''}" data-tipo="SEM_TIPO">
              <div class="medico-stat-label">⚠ Sem tipo</div>
              <div class="medico-stat-valor mono">${totalSemTipo}</div>
            </div>
          ` : ''}
        </div>
        <style>
          .medicos-stats {
            display: grid;
            grid-template-columns: repeat(${4 + (totalFellows > 0 ? 1 : 0) + (totalSemTipo > 0 ? 1 : 0)}, 1fr);
            gap: 10px;
            margin-bottom: 18px;
          }
          .medico-stat-card {
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 12px 14px;
            position: relative;
            overflow: hidden;
            cursor: pointer;
            transition: border-color 0.12s, transform 0.12s, box-shadow 0.12s;
            user-select: none;
          }
          .medico-stat-card:hover {
            border-color: var(--ink-soft);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.06);
          }
          .medico-stat-card.is-ativo {
            border-color: var(--primary);
            background: #F1F7F7;
            box-shadow: inset 0 0 0 1px var(--primary);
          }
          .medico-stat-card::before {
            content: '';
            position: absolute;
            left: 0; top: 0; bottom: 0;
            width: 3px;
          }
          .medico-stat-card.is-ativo::before { width: 5px; }
          .medico-stat-total::before    { background: var(--primary); }
          .medico-stat-interno::before  { background: #005073; }
          .medico-stat-hibrido::before  { background: #005073; }
          .medico-stat-externo::before  { background: #8A4B1F; }
          .medico-stat-fellow::before   { background: #189AD3; }
          .medico-stat-aviso::before    { background: #9B3A3A; }
          .medico-stat-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            font-weight: 600;
            color: var(--ink-soft);
            margin-bottom: 4px;
          }
          .medico-stat-valor {
            font-size: 22px;
            font-weight: 700;
            color: var(--ink);
            line-height: 1;
          }
          /* Cor do número quando o card está ativo (filtro selecionado) */
          .medico-stat-card.is-ativo .medico-stat-valor { color: var(--primary); }
        </style>
      ` : ''}

      ${totalMedicos === 0 ? `
        <div class="card" style="margin-bottom: 24px; background: var(--accent-soft); border-color: var(--accent)">
          <div style="display: flex; gap: 16px; align-items: center">
            <div style="font-size: 32px">👨‍⚕️</div>
            <div>
              <h3 class="card-title" style="margin: 0">Comece cadastrando o corpo clínico</h3>
              <p style="margin: 4px 0 0; font-size: 13px; color: var(--ink-soft)">
                Importe uma planilha Excel com colunas <code class="mono">NOME</code> e
                <code class="mono">ESPECIALIDADE</code> (opcionais: <code class="mono">CRM</code>,
                <code class="mono">OBSERVACOES</code>), ou cadastre médicos manualmente.
              </p>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Filtros de especialidades -->
      <div class="card" style="margin-bottom: 16px">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
          <div style="font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft)">
            Filtrar por especialidade
          </div>
          <button class="btn btn-pequeno" id="btn-limpar-filtros"
                  style="display: none; padding: 4px 10px; font-size: 11px">
            × Limpar filtros
          </button>
        </div>

        <div id="grid-especialidades" class="esp-grid"></div>

        <div style="margin-top: 14px; display: flex; gap: 12px; align-items: center">
          <input type="text" id="busca-medico" class="input" style="flex: 1"
                 placeholder="Buscar médico (digite parte do nome)...">
          <div class="small muted" id="contador-medicos"></div>
        </div>
      </div>

      <div class="card" style="padding: 0; overflow: hidden">
        <div id="lista-medicos" style="max-height: 60vh; overflow-y: auto"></div>
      </div>
    </div>

    <style>
      .btn-perigo {
        background: var(--bg-elevated);
        color: var(--danger);
        border-color: var(--border);
      }
      .btn-perigo:hover {
        background: var(--danger-soft);
        border-color: var(--danger);
      }

      .esp-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 8px;
      }
      .esp-btn {
        padding: 10px 12px;
        border-radius: var(--radius-md);
        border: 1px solid var(--border);
        background: var(--bg-elevated);
        font-size: 13px;
        font-weight: 500;
        color: var(--ink);
        text-align: center;
        cursor: pointer;
        transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
        font-family: inherit;
        line-height: 1.2;
      }
      .esp-btn:hover {
        border-color: var(--primary);
        background: var(--primary-soft);
      }
      .esp-btn.ativo {
        background: var(--primary);
        color: #F1F7F7;
        border-color: var(--primary);
      }
      .esp-btn .qtd {
        display: block;
        font-size: 10px;
        opacity: 0.7;
        margin-top: 2px;
        font-weight: 400;
      }
      .esp-btn.ativo .qtd { opacity: 0.85; }

      .lista-medicos-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .lista-medicos-table thead {
        position: sticky;
        top: 0;
        background: var(--primary);
        z-index: 10;
      }
      .lista-medicos-table thead th {
        padding: 12px 14px;
        text-align: left;
        color: #F1F7F7;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-weight: 600;
      }
      .lista-medicos-table tbody tr {
        border-bottom: 1px solid var(--border);
        min-height: 44px;
      }
      .lista-medicos-table tbody tr:hover {
        background: var(--bg-sunken);
      }
      .lista-medicos-table td {
        padding: 10px 14px;
        color: #000;
        vertical-align: middle;
      }
      .lista-medicos-table td.col-nome {
        font-weight: 600;
      }
      .lista-medicos-table td.col-esp .esp-tags-wrap {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 6px;
      }
      .lista-medicos-table td.col-esp .esp-tag {
        display: inline-block;
        padding: 3px 10px;
        border-radius: 100px;
        font-size: 11px;
        font-weight: 600;
        background: var(--bg-tag, var(--accent-soft));
        color: var(--fg-tag, var(--accent));
        border: 1px solid var(--bd-tag, transparent);
        white-space: nowrap;
      }
      .lista-medicos-table td.col-esp .esp-tag-vazia {
        font-style: italic;
        font-size: 11px;
        color: var(--ink-faint);
      }
      .lista-medicos-table td.col-acoes {
        text-align: right;
      }
      .lista-medicos-table td.col-acoes .btn-acao {
        background: transparent;
        border: 1px solid var(--border);
        color: var(--ink-faint);
        width: 26px;
        height: 26px;
        border-radius: 4px;
        font-size: 13px;
        cursor: pointer;
        margin-left: 4px;
        opacity: 0;
        transition: opacity 120ms;
      }
      .lista-medicos-table tbody tr:hover .btn-acao {
        opacity: 1;
      }
      .lista-medicos-table td.col-acoes .btn-acao:hover {
        background: var(--danger-soft);
        border-color: var(--danger);
        color: var(--danger);
      }
      .lista-medicos-table td.col-acoes .btn-acao.btn-editar:hover {
        background: var(--primary-soft);
        border-color: var(--primary);
        color: var(--primary);
      }
    </style>
  `;

  document.getElementById('conteudo').innerHTML = html;

  // ========================================================================
  // RENDERIZAR GRID DE ESPECIALIDADES (filtros)
  // ========================================================================

  function renderizarEspecialidades() {
    const grid = document.getElementById('grid-especialidades');
    if (especialidades.length === 0) {
      grid.innerHTML = `<p class="muted small">Nenhuma especialidade cadastrada. Clique em "⚙ Especialidades".</p>`;
      return;
    }

    grid.innerHTML = especialidades.map(esp => {
      // Conta médicos nesta especialidade
      const qtd = Banco.queryUnica(`
        SELECT COUNT(DISTINCT me.medico_id) AS n
        FROM medico_especialidades me
        JOIN medicos m ON m.id = me.medico_id
        WHERE me.especialidade_id = ? AND m.ativo = 1
      `, [esp.id]).n;

      const ativo = especialidadesAtivas.has(esp.id);
      return `
        <button class="esp-btn ${ativo ? 'ativo' : ''}" data-esp-id="${esp.id}">
          ${escapeHTML(esp.nome)}
          <span class="qtd">${qtd} médico${qtd !== 1 ? 's' : ''}</span>
        </button>
      `;
    }).join('');

    grid.querySelectorAll('.esp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.espId);
        if (especialidadesAtivas.has(id)) {
          especialidadesAtivas.delete(id);
        } else {
          especialidadesAtivas.add(id);
        }
        renderizarEspecialidades();
        renderizarLista();
      });
    });

    // Botão "Limpar filtros" só aparece quando há filtros ativos
    const btnLimpar = document.getElementById('btn-limpar-filtros');
    btnLimpar.style.display = especialidadesAtivas.size > 0 ? 'inline-flex' : 'none';
  }

  // ========================================================================
  // CORES POR ESPECIALIDADE
  // ========================================================================
  // Cada especialidade ganha uma cor estável (a mesma toda vez que aparece).
  // Paleta de tons sóbrios que combinam com a identidade visual do app.
  //
  // O hash do nome determina qual cor da paleta usar. Como a paleta tem 10
  // cores e há ~13 especialidades, podem se repetir, mas a aparência fica
  // consistente entre sessões.

  const PALETA_ESPECIALIDADES = [
    { bg: '#E8EDE9', fg: '#005073', bd: '#C2D2C9' },  // verde profundo
    { bg: '#DBF0F9', fg: '#005073', bd: '#9FE6C9' },  // dourado/âmbar
    { bg: '#E0E8F0', fg: '#2A4A6E', bd: '#B5C5D8' },  // azul aço
    { bg: '#F0E0E0', fg: '#7A2C2C', bd: '#D8B5B5' },  // vermelho terra
    { bg: '#EAE3F0', fg: '#5A3A78', bd: '#C8B8D8' },  // roxo suave
    { bg: '#FBE8D6', fg: '#8A4B1F', bd: '#E8C5A0' },  // laranja queimado
    { bg: '#DBF0F9', fg: '#005073', bd: '#9FD9C7' },  // verde água
    { bg: '#F5E0E8', fg: '#7A2C58', bd: '#DDB5C8' },  // rosa antigo
    { bg: '#E6E0D4', fg: '#5A4A2C', bd: '#C8BCA5' },  // bege/oliva
    { bg: '#D8E3E8', fg: '#2C5462', bd: '#A8C0CA' },  // teal escuro
  ];

  // Cache: nome → cor (para não recalcular o tempo todo)
  const _coresEspCache = {};

  function corDaEspecialidade(nomeEsp) {
    if (_coresEspCache[nomeEsp]) return _coresEspCache[nomeEsp];

    // Hash simples e estável do nome
    let hash = 0;
    for (let i = 0; i < nomeEsp.length; i++) {
      hash = ((hash << 5) - hash) + nomeEsp.charCodeAt(i);
      hash = hash & hash;  // converte para int32
    }
    const idx = Math.abs(hash) % PALETA_ESPECIALIDADES.length;
    const cor = PALETA_ESPECIALIDADES[idx];
    _coresEspCache[nomeEsp] = cor;
    return cor;
  }

  // ========================================================================
  // CORES POR UNIDADE
  // ========================================================================
  // Paleta diferente da de especialidades para diferenciar visualmente.
  // Tons mais claros/discretos pois o badge fica ao lado do tipo (badge menor).

  const PALETA_UNIDADES = [
    { bg: '#EBE4F0', fg: '#5A3978', bd: '#CBB8DC' },  // lavanda
    { bg: '#E3EDD8', fg: '#456B28', bd: '#BCD2A8' },  // verde-folha
    { bg: '#F0E3D4', fg: '#7A5A2C', bd: '#D8C0A0' },  // areia
    { bg: '#D8E8E6', fg: '#2C5C58', bd: '#A8CBC5' },  // turquesa pálido
    { bg: '#F0DCDC', fg: '#7A3A3A', bd: '#D8B0B0' },  // rosa terra
    { bg: '#DCE0EC', fg: '#3A4A78', bd: '#B0BAD8' },  // azul fumaça
    { bg: '#EBE6D8', fg: '#5C5028', bd: '#C8C0A0' },  // mostarda suave
    { bg: '#E0DCE6', fg: '#4A4258', bd: '#B8B0C0' },  // cinza-violeta
  ];

  const _coresUnidCache = {};

  function corDaUnidade(nomeUnid) {
    if (_coresUnidCache[nomeUnid]) return _coresUnidCache[nomeUnid];
    let hash = 0;
    for (let i = 0; i < nomeUnid.length; i++) {
      hash = ((hash << 5) - hash) + nomeUnid.charCodeAt(i);
      hash = hash & hash;
    }
    const idx = Math.abs(hash) % PALETA_UNIDADES.length;
    const cor = PALETA_UNIDADES[idx];
    _coresUnidCache[nomeUnid] = cor;
    return cor;
  }

  // ========================================================================
  // RENDERIZAR LISTA DE MÉDICOS
  // ========================================================================

  function renderizarLista() {
    const div = document.getElementById('lista-medicos');
    const contador = document.getElementById('contador-medicos');

    const termoNorm = Utilidades.normalizar(termoBusca);
    const filtroBuscaSql = termoNorm ? 'AND m.nome_normalizado LIKE ?' : '';

    // Filtro: encontra os IDs dos médicos que têm pelo menos uma das especialidades
    // selecionadas, depois mostra TODAS as especialidades desses médicos
    // (assim, se Dr. Durval tem "Catarata" e "Retina" e você filtra por "Catarata",
    //  ele aparece em 2 linhas: Catarata E Retina)
    let filtroMedicosSql = '';
    const params = [];

    if (especialidadesAtivas.size > 0) {
      const placeholders = Array.from(especialidadesAtivas).map(() => '?').join(',');
      filtroMedicosSql = `AND m.id IN (
        SELECT DISTINCT medico_id
        FROM medico_especialidades
        WHERE especialidade_id IN (${placeholders})
      )`;
      for (const id of especialidadesAtivas) params.push(id);
    }

    // Filtro de tipo: aplicado via card clicável no header
    let filtroTipoSql = '';
    if (filtroTipo === 'INTERNO' || filtroTipo === 'HIBRIDO' || filtroTipo === 'EXTERNO') {
      filtroTipoSql = `AND m.tipo_vinculo = '${filtroTipo}'`;
    } else if (filtroTipo === 'SEM_TIPO') {
      filtroTipoSql = `AND (m.tipo_vinculo IS NULL OR m.tipo_vinculo = '')`;
    } else if (filtroTipo === 'FELLOW') {
      filtroTipoSql = `AND m.nome_normalizado IN (
        SELECT nome_normalizado FROM fellow_cadastro WHERE ativo = 1
      )`;
    }

    if (termoNorm) params.push('%' + termoNorm + '%');

    if (window.CodigoMedico) CodigoMedico.garantir();

    const linhasRaw = Banco.query(`
      SELECT
        m.id AS medico_id,
        m.nome_oficial AS nome_medico,
        m.nome_normalizado AS nome_norm,
        m.codigo_atlas AS codigo_atlas,
        m.crm,
        m.tipo_vinculo,
        m.situacional,
        e.id AS esp_id,
        e.nome AS especialidade,
        e.ordem AS ordem_esp
      FROM medicos m
      LEFT JOIN medico_especialidades me ON me.medico_id = m.id
      LEFT JOIN especialidades e ON e.id = me.especialidade_id AND e.ativo = 1
      WHERE m.ativo = 1
      ${filtroMedicosSql}
      ${filtroTipoSql}
      ${filtroBuscaSql}
      ORDER BY m.nome_oficial, e.ordem, e.nome
    `, params);

    // Carrega o conjunto de fellows cadastrados (nome_normalizado) — 1 query.
    // Médicos com nome_normalizado idêntico ao de um fellow ganham a badge "Fellow".
    const fellowsNorms = new Set();
    try {
      Banco.query(`SELECT nome_normalizado FROM fellow_cadastro WHERE ativo = 1`)
        .forEach(f => fellowsNorms.add(f.nome_normalizado));
    } catch (e) {
      // Tabela fellow_cadastro não existe ainda (banco anterior à V11) — ignora
    }

    // Carrega todas as unidades vinculadas (1 query só para todos os médicos)
    const todosVinculosUnidades = Banco.query(`
      SELECT mu.medico_id, u.id AS unidade_id, u.nome AS unidade_nome
      FROM medico_unidades mu
      JOIN unidades u ON u.id = mu.unidade_id
      WHERE u.ativo = 1
      ORDER BY u.ordem, u.nome
    `);
    const unidadesPorMedico = new Map();
    for (const v of todosVinculosUnidades) {
      if (!unidadesPorMedico.has(v.medico_id)) {
        unidadesPorMedico.set(v.medico_id, []);
      }
      unidadesPorMedico.get(v.medico_id).push({ id: v.unidade_id, nome: v.unidade_nome });
    }

    // Carrega todos os cargos administrativos (1 query só para todos os médicos)
    const todosCargos = Banco.query(`
      SELECT medico_id, cargo FROM medico_cargos
      ORDER BY
        CASE cargo
          WHEN 'DIRETORIA_TECNICA'   THEN 1
          WHEN 'DIRETORIA_CLINICA'   THEN 2
          WHEN 'COORDENADOR_MEDICO'  THEN 3
          WHEN 'RESPONSAVEL_TECNICO' THEN 4
          WHEN 'SOCIO'               THEN 5
          ELSE 99
        END
    `);
    const cargosPorMedico = new Map();
    for (const c of todosCargos) {
      if (!cargosPorMedico.has(c.medico_id)) {
        cargosPorMedico.set(c.medico_id, []);
      }
      cargosPorMedico.get(c.medico_id).push(c.cargo);
    }

    // Carrega exceções para marcar TAGs com asterisco
    // medico_id → { cargo_base, nome }
    const excecoesPorMedico = new Map();
    try {
      Banco.query(`
        SELECT medico_id, cargo_base, nome FROM excecoes_cargo WHERE ativo = 1
      `).forEach(e => {
        if (!excecoesPorMedico.has(e.medico_id)) {
          excecoesPorMedico.set(e.medico_id, new Map());
        }
        excecoesPorMedico.get(e.medico_id).set(e.cargo_base, e.nome);
      });
    } catch (err) {
      // Tabela ainda não existe (banco antigo) — ignora
    }

    // Agrupa por médico: 1 linha por médico, com todas as especialidades juntas.
    // Com LEFT JOIN, médicos sem nenhuma especialidade vêm com esp_id = NULL —
    // nesse caso o array `especialidades` fica vazio (e o render exibe "—").
    const porMedico = new Map();
    for (const l of linhasRaw) {
      if (!porMedico.has(l.medico_id)) {
        porMedico.set(l.medico_id, {
          medico_id:    l.medico_id,
          nome_medico:  l.nome_medico,
          nome_norm:    l.nome_norm,
          codigo_atlas: l.codigo_atlas,
          eh_fellow:    fellowsNorms.has(l.nome_norm),
          crm:          l.crm,
          tipo_vinculo: l.tipo_vinculo,
          situacional:  !!l.situacional,
          cargos:       cargosPorMedico.get(l.medico_id) || [],
          excecoes:     excecoesPorMedico.get(l.medico_id) || new Map(),
          unidades:     unidadesPorMedico.get(l.medico_id) || [],
          especialidades: [],
        });
      }
      if (l.esp_id != null) {
        porMedico.get(l.medico_id).especialidades.push({
          id: l.esp_id,
          nome: l.especialidade,
          ordem: l.ordem_esp,
        });
      }
    }
    const medicos = Array.from(porMedico.values());

    contador.textContent = `${medicos.length} médico${medicos.length !== 1 ? 's' : ''}`;

    if (medicos.length === 0) {
      div.innerHTML = `
        <div class="empty-state" style="padding: 60px 20px">
          <div class="icon">∅</div>
          <h3>Nenhum médico encontrado</h3>
          <p>${especialidadesAtivas.size > 0 || termoBusca || filtroTipo
              ? 'Tente outros filtros ou limpe-os'
              : 'Importe sua planilha de corpo clínico ou cadastre médicos manualmente'}</p>
        </div>
      `;
      return;
    }

    let html = `
      <table class="lista-medicos-table">
        <thead>
          <tr>
            <th>MÉDICO</th>
            <th>CÓD. ATLAS</th>
            <th>ESPECIALIDADES</th>
            <th>CRM</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const m of medicos) {
      // Monta as tags coloridas (uma por especialidade). Quando o médico não
      // tem nenhuma especialidade cadastrada, mostra um placeholder em itálico.
      const tagsHtml = m.especialidades.length === 0
        ? '<span class="esp-tag-vazia">— sem especialidade —</span>'
        : m.especialidades.map(esp => {
            const cor = corDaEspecialidade(esp.nome);
            const corStyle = `--bg-tag:${cor.bg};--fg-tag:${cor.fg};--bd-tag:${cor.bd}`;
            return `<span class="esp-tag" style="${corStyle}">${escapeHTML(esp.nome)}</span>`;
          }).join('');

      const badgeTipo = Utilidades.badgeTipoVinculo(m.tipo_vinculo);
      // Badge "Fellow" — aparece quando o nome do médico bate com algum
      // fellow cadastrado em fellow_cadastro (match por nome_normalizado).
      const badgeFellow = m.eh_fellow
        ? `<span class="badge-fellow" title="Este médico também atua como Fellow">Fellow</span>`
        : '';
      // Badge "Situacional" — externo que aparece só pontualmente
      // (marcação criada via De-Para → "Pendentes → Ext. Situacionais")
      const badgeSituacional = m.situacional
        ? `<span class="badge-situacional" title="Médico situacional — aparece apenas pontualmente na produção">Situacional</span>`
        : '';
      // Vários badges de cargo (um por cargo que o médico ocupa)
      // Cada badge pode ter um asterisco dourado * se houver exceção para aquela TAG
      const badgesCargos = m.cargos.map(c => {
        const nomeExc = m.excecoes.get(c);
        return Utilidades.badgeCargoAdmin(c, nomeExc);
      }).join('');

      // Badges de unidades (1 por unidade vinculada, ao lado do tipo)
      const badgesUnidades = m.unidades.map(u => {
        const c = corDaUnidade(u.nome);
        return `<span class="badge-unidade" style="background:${c.bg};color:${c.fg};border-color:${c.bd}">${escapeHTML(u.nome)}</span>`;
      }).join('');

      html += `
        <tr data-medico-id="${m.medico_id}">
          <td class="col-nome">
            <div>${escapeHTML(m.nome_medico)}${badgesCargos}</div>
            <div class="linha-badges">
              ${badgeTipo}
              ${badgeSituacional}
              ${badgeFellow}
              ${badgesUnidades}
            </div>
          </td>
          <td class="mono col-cod-atlas" title="Código de individualização (compliance)">${escapeHTML(m.codigo_atlas || '—')}</td>
          <td class="col-esp">
            <div class="esp-tags-wrap">${tagsHtml}</div>
          </td>
          <td class="mono">${m.crm || ''}</td>
          <td class="col-acoes">
            <button class="btn-acao btn-editar" data-medico-id="${m.medico_id}" title="Editar médico">✎</button>
            <button class="btn-acao btn-excluir" data-medico-id="${m.medico_id}" title="Excluir médico">×</button>
          </td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    div.innerHTML = html;

    // Bind eventos
    div.querySelectorAll('.btn-editar').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirEdicaoMedico(Number(btn.dataset.medicoId));
      });
    });
    div.querySelectorAll('.btn-excluir').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        excluirMedico(Number(btn.dataset.medicoId));
      });
    });
  }

  // ========================================================================
  // AÇÕES: novo, editar, excluir, importar, gerenciar especialidades
  // ========================================================================

  async function novoMedico() {
    const nome = prompt('Nome completo do médico:');
    if (!nome || !nome.trim()) return;

    const nomeNorm = Utilidades.normalizar(nome);
    const existente = Banco.queryUnica(
      'SELECT id, nome_oficial FROM medicos WHERE nome_normalizado = ?',
      [nomeNorm]
    );
    if (existente) {
      alert(`Já existe médico equivalente:\n"${existente.nome_oficial}"`);
      return;
    }

    const r = Banco.executar(
      `INSERT INTO medicos (nome_oficial, nome_normalizado, ativo) VALUES (?, ?, 1)`,
      [nome.trim(), nomeNorm]
    );

    await Banco.salvar();
    Utilidades.toast('Médico criado. Agora associe especialidades.', 'success', 4000);
    abrirEdicaoMedico(r.lastInsertRowId);
  }

  async function excluirMedico(medicoId) {
    const med = Banco.queryUnica('SELECT nome_oficial FROM medicos WHERE id = ?', [medicoId]);
    if (!med) return;

    const qtdEsp = Banco.queryUnica(
      'SELECT COUNT(*) AS n FROM medico_especialidades WHERE medico_id = ?',
      [medicoId]
    ).n;

    const ok = confirm(
      `Excluir o médico:\n   "${med.nome_oficial}"?\n\n` +
      `Também será apagado:\n` +
      `   • ${qtdEsp} vínculo(s) de especialidade\n\n` +
      `Esta ação não pode ser desfeita.`
    );
    if (!ok) return;

    Banco.executar('DELETE FROM medico_especialidades WHERE medico_id = ?', [medicoId]);
    Banco.executar('DELETE FROM medicos WHERE id = ?', [medicoId]);
    await Banco.salvar();
    Utilidades.toast('Médico excluído', 'success');

    // Re-renderiza tudo (contagens das especialidades mudaram)
    App.navegarPara('medicos');
  }

  async function gerenciarEspecialidades() {
    const esps = Banco.query('SELECT * FROM especialidades ORDER BY ordem, nome');

    abrirModal({
      titulo: 'Especialidades',
      conteudo: `
        <p class="small muted" style="margin-top: 0">
          Adicione, renomeie ou desative especialidades.
          Desativar não apaga vínculos antigos.
        </p>
        <div id="lista-esp" style="display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow-y: auto">
          ${esps.map(e => `
            <div data-esp-id="${e.id}" style="display: flex; gap: 8px; align-items: center">
              <input type="text" class="input esp-input" value="${escapeHTML(e.nome)}" style="flex: 1">
              <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--ink-faint); white-space: nowrap">
                <input type="checkbox" class="esp-ativo" ${e.ativo ? 'checked' : ''}> ativa
              </label>
              <button class="btn-acao btn-excluir-esp" data-esp-id="${e.id}" title="Excluir"
                      style="background: transparent; border: 1px solid var(--border); width: 28px; height: 28px; border-radius: 4px; cursor: pointer">×</button>
            </div>
          `).join('')}
        </div>
        <div style="display: flex; gap: 8px; margin-top: 12px">
          <input type="text" class="input" id="nova-esp" placeholder="Nova especialidade..." style="flex: 1">
          <button class="btn btn-primary" id="btn-add-esp">+ Adicionar</button>
        </div>
      `,
      acoes: [
        { label: 'Fechar', tipo: 'primary', acao: 'fechar' },
      ],
      onAcao: () => true,
      apos: () => {
        // Eventos dentro do modal
        document.getElementById('btn-add-esp').addEventListener('click', async () => {
          const input = document.getElementById('nova-esp');
          const nome = input.value.trim();
          if (!nome) return;

          const existe = Banco.queryUnica(
            'SELECT id FROM especialidades WHERE UPPER(nome) = UPPER(?)',
            [nome]
          );
          if (existe) { alert('Especialidade já existe'); return; }

          const prox = (Banco.queryUnica(
            'SELECT COALESCE(MAX(ordem),0)+1 AS n FROM especialidades'
          ) || { n: 1 }).n;
          Banco.executar(
            'INSERT INTO especialidades (nome, ordem, ativo) VALUES (?, ?, 1)',
            [nome, prox]
          );
          await Banco.salvar();
          fecharModal();
          gerenciarEspecialidades();  // reabrir com a nova
        });

        // Salva alterações em qualquer mudança de input/checkbox
        document.querySelectorAll('#lista-esp .esp-input').forEach(input => {
          input.addEventListener('change', async () => {
            const id = Number(input.closest('[data-esp-id]').dataset.espId);
            Banco.executar(
              'UPDATE especialidades SET nome = ? WHERE id = ?',
              [input.value.trim(), id]
            );
            await Banco.salvar();
            Utilidades.toast('Especialidade renomeada', 'success', 1500);
          });
        });
        document.querySelectorAll('#lista-esp .esp-ativo').forEach(cb => {
          cb.addEventListener('change', async () => {
            const id = Number(cb.closest('[data-esp-id]').dataset.espId);
            Banco.executar(
              'UPDATE especialidades SET ativo = ? WHERE id = ?',
              [cb.checked ? 1 : 0, id]
            );
            await Banco.salvar();
          });
        });
        document.querySelectorAll('#lista-esp .btn-excluir-esp').forEach(btn => {
          btn.addEventListener('click', async () => {
            const id = Number(btn.dataset.espId);
            const esp = Banco.queryUnica('SELECT nome FROM especialidades WHERE id = ?', [id]);
            const qtdVinc = Banco.queryUnica(
              'SELECT COUNT(*) AS n FROM medico_especialidades WHERE especialidade_id = ?',
              [id]
            ).n;

            if (qtdVinc > 0) {
              alert(
                `A especialidade "${esp.nome}" tem ${qtdVinc} médico(s) vinculado(s).\n` +
                `Desative em vez de excluir (basta desmarcar "ativa").`
              );
              return;
            }
            if (!confirm(`Excluir a especialidade "${esp.nome}"?`)) return;
            Banco.executar('DELETE FROM especialidades WHERE id = ?', [id]);
            await Banco.salvar();
            fecharModal();
            gerenciarEspecialidades();
          });
        });
      },
      aoFechar: () => App.navegarPara('medicos'),
    });
  }

  async function marcarInternos() {
    const semTipo = Banco.contar('medicos', `ativo = 1 AND (tipo_vinculo IS NULL OR tipo_vinculo = '')`);

    if (semTipo === 0) {
      Utilidades.toast('Todos os médicos já têm tipo definido', 'info');
      return;
    }

    const ok = confirm(
      `Marcar ${semTipo} médico(s) sem tipo como INTERNO?\n\n` +
      `Apenas os médicos sem tipo definido serão alterados.\n` +
      `Os que já estão como EXTERNO ou HÍBRIDO não serão afetados.`
    );
    if (!ok) return;

    Banco.executar(
      `UPDATE medicos
          SET tipo_vinculo = 'INTERNO', atualizado_em = CURRENT_TIMESTAMP
        WHERE ativo = 1 AND (tipo_vinculo IS NULL OR tipo_vinculo = '')`
    );
    await Banco.salvar();
    Utilidades.toast(`${semTipo} médico(s) marcados como INTERNO`, 'success');
    App.navegarPara('medicos');
  }

  async function limparMedicos() {
    const total = Banco.contar('medicos');
    if (total === 0) {
      Utilidades.toast('Não há médicos para apagar', 'info');
      return;
    }

    const totalVinc = Banco.contar('medico_especialidades');
    const totalSin = Banco.contar('sinonimos_medico');

    const mensagem =
      `Apagar TODOS os médicos cadastrados?\n\n` +
      `Serão removidos:\n` +
      `   • ${total} médico(s)\n` +
      `   • ${totalVinc} vínculo(s) com especialidades\n` +
      (totalSin > 0 ? `   • ${totalSin} sinônimo(s) de nome\n` : '') +
      `\nA lista de especialidades (Catarata, Retina, etc.) será mantida.\n\n` +
      `Esta ação não pode ser desfeita. Faça um backup antes se quiser garantir.`;

    if (!confirm(mensagem)) return;

    // Confirmação dupla
    const txt = prompt('Para confirmar, digite "APAGAR" (em maiúsculas):');
    if (txt !== 'APAGAR') {
      Utilidades.toast('Cancelado', 'info');
      return;
    }

    Utilidades.mostrarLoading('Apagando médicos...');
    try {
      // Ordem importa: primeiro tabelas que referenciam medicos
      Banco.executar('DELETE FROM medico_especialidades');
      Banco.executar('DELETE FROM medico_unidades');
      Banco.executar('DELETE FROM medico_cargos');
      Banco.executar('DELETE FROM sinonimos_medico');
      Banco.executar('DELETE FROM medicos');
      await Banco.salvar();
      Utilidades.esconderLoading();
      Utilidades.toast('Médicos apagados', 'success');
      App.navegarPara('medicos');
    } catch (e) {
      Utilidades.esconderLoading();
      console.error(e);
      alert('Erro ao apagar: ' + e.message);
    }
  }

  async function importarExcel(arquivo) {
    const totalAtual = Banco.contar('medicos');

    // Sempre mostra o diálogo de modo (mesmo sem dados, para oferecer modo externos)
    const opcao = await escolherEntrePerguntar(
      totalAtual > 0
        ? `Você já tem ${totalAtual} médico(s) cadastrado(s).\n\nO que deseja fazer?`
        : `Como deseja importar essa planilha?`,
      [
        { label: 'Adicionar/atualizar (planilha geral de médicos)', valor: 'merge' },
        { label: 'Substituir tudo (apagar antes de importar)',       valor: 'replace' },
        { label: 'Importar médicos externos/híbridos (planilha de tipos)', valor: 'externos' },
        { label: 'Cancelar', valor: 'cancel' },
      ]
    );

    if (opcao === 'cancel' || !opcao) return;

    // ──────────────────────────────────────────────────────────────
    // Modo: Importar externos/híbridos
    // ──────────────────────────────────────────────────────────────
    if (opcao === 'externos') {
      Utilidades.mostrarLoading('Importando médicos externos/híbridos...');
      try {
        const rel = await ImportadorMedicos.importarExternos(arquivo);
        Utilidades.esconderLoading();
        alert(
          `✓ Importação concluída!\n\n` +
          `Linhas lidas:                ${rel.linhas_lidas}\n` +
          `Médicos criados:             ${rel.medicos_criados}\n` +
          `Médicos atualizados:         ${rel.medicos_atualizados}\n` +
          `Externos processados:        ${rel.externos_processados}\n` +
          `Híbridos processados:        ${rel.hibridos_processados}\n` +
          `Vínculos "Informação Externa": ${rel.vinculos_externa_criados}\n` +
          `Linhas ignoradas:            ${rel.linhas_ignoradas}` +
          (rel.avisos.length ? `\n\n${rel.avisos.length} aviso(s)` : '')
        );

        // Pergunta se quer marcar os demais como INTERNO
        const semTipo = Banco.contar('medicos', `ativo = 1 AND (tipo_vinculo IS NULL OR tipo_vinculo = '')`);
        if (semTipo > 0) {
          const marcar = confirm(
            `Você ainda tem ${semTipo} médico(s) sem tipo definido.\n\n` +
            `Deseja marcar TODOS como INTERNO?\n\n` +
            `(Recomendado: como esta planilha lista os externos/híbridos, ` +
            `o resto do corpo clínico é interno por padrão.)`
          );
          if (marcar) {
            Banco.executar(
              `UPDATE medicos
                  SET tipo_vinculo = 'INTERNO', atualizado_em = CURRENT_TIMESTAMP
                WHERE ativo = 1 AND (tipo_vinculo IS NULL OR tipo_vinculo = '')`
            );
            await Banco.salvar();
            Utilidades.toast(`${semTipo} médico(s) marcados como INTERNO`, 'success');
          }
        }

        App.navegarPara('medicos');
      } catch (e) {
        Utilidades.esconderLoading();
        console.error(e);
        alert('Erro: ' + e.message);
      }
      return;
    }

    // ──────────────────────────────────────────────────────────────
    // Modos: merge / replace (planilha geral)
    // ──────────────────────────────────────────────────────────────
    const substituir = (opcao === 'replace');

    if (substituir && totalAtual > 0) {
      const confirma = confirm(
        'Confirma SUBSTITUIR todos os médicos?\n\n' +
        `Os ${totalAtual} médicos atuais serão apagados antes de importar a nova planilha.\n\n` +
        'Esta ação não pode ser desfeita.'
      );
      if (!confirma) return;
    }

    Utilidades.mostrarLoading(substituir ? 'Apagando antigos e importando...' : 'Importando médicos...');
    try {
      if (substituir) {
        Banco.executar('DELETE FROM medico_especialidades');
        Banco.executar('DELETE FROM medico_unidades');
        Banco.executar('DELETE FROM medico_cargos');
        Banco.executar('DELETE FROM sinonimos_medico');
        Banco.executar('DELETE FROM medicos');
      }

      const rel = await ImportadorMedicos.importar(arquivo);
      Utilidades.esconderLoading();
      alert(
        `✓ Importação concluída!\n\n` +
        (substituir ? `(banco anterior foi substituído)\n\n` : '') +
        `Linhas lidas:              ${rel.linhas_lidas}\n` +
        `Médicos criados:           ${rel.medicos_criados}\n` +
        `Médicos atualizados:       ${rel.medicos_atualizados}\n` +
        `Especialidades novas:      ${rel.especialidades_criadas}\n` +
        `Vínculos esp. criados:     ${rel.vinculos_criados}\n` +
        `Unidades novas:            ${rel.unidades_criadas}\n` +
        `Vínculos unid. criados:    ${rel.vinculos_unidade_criados}\n` +
        `Linhas ignoradas:          ${rel.linhas_ignoradas}` +
        (rel.avisos.length ? `\n\n${rel.avisos.length} aviso(s)` : '')
      );

      // Se a planilha tinha tipo_vinculo, pergunta se quer marcar o resto como INTERNO
      const semTipo = Banco.contar('medicos', `ativo = 1 AND (tipo_vinculo IS NULL OR tipo_vinculo = '')`);
      const comTipo = Banco.contar('medicos', `ativo = 1 AND tipo_vinculo IS NOT NULL AND tipo_vinculo != ''`);

      if (comTipo > 0 && semTipo > 0) {
        const marcar = confirm(
          `Você tem ${comTipo} médico(s) com tipo definido (Interno/Híbrido/Externo) ` +
          `e ${semTipo} médico(s) sem tipo.\n\n` +
          `Deseja marcar TODOS os ${semTipo} médicos sem tipo como INTERNO?\n\n` +
          `(Útil quando a planilha lista apenas externos e híbridos, e o restante ` +
          `do corpo clínico é interno por padrão.)`
        );

        if (marcar) {
          Banco.executar(
            `UPDATE medicos
                SET tipo_vinculo = 'INTERNO', atualizado_em = CURRENT_TIMESTAMP
              WHERE ativo = 1 AND (tipo_vinculo IS NULL OR tipo_vinculo = '')`
          );
          await Banco.salvar();
          Utilidades.toast(`${semTipo} médico(s) marcados como INTERNO`, 'success');
        }
      }

      App.navegarPara('medicos');
    } catch (e) {
      Utilidades.esconderLoading();
      console.error(e);
      alert('Erro: ' + e.message);
    }
  }

  /**
   * Helper: pergunta com lista de opções (usa prompt simples por enquanto).
   * Devolve o valor escolhido ou null se cancelar.
   */
  async function escolherEntrePerguntar(mensagem, opcoes) {
    const linhas = opcoes.map((o, i) => `${i + 1}. ${o.label}`).join('\n');
    const resp = prompt(mensagem + '\n\n' + linhas + '\n\nDigite o número da opção:');
    if (resp === null) return null;
    const n = parseInt(resp, 10);
    if (isNaN(n) || n < 1 || n > opcoes.length) return null;
    return opcoes[n - 1].valor;
  }

  // ========================================================================
  // EVENTOS GERAIS
  // ========================================================================

  const inputArquivo = document.getElementById('upload-medicos');
  document.getElementById('btn-upload-medicos').addEventListener('click', () => inputArquivo.click());
  inputArquivo.addEventListener('change', (e) => {
    const arq = e.target.files[0];
    if (arq) importarExcel(arq);
  });

  document.getElementById('btn-novo-medico').addEventListener('click', novoMedico);
  document.getElementById('btn-gerenciar-especialidades').addEventListener('click', gerenciarEspecialidades);

  const btnLimpar = document.getElementById('btn-limpar-medicos');
  if (btnLimpar) {
    btnLimpar.addEventListener('click', limparMedicos);
  }

  const btnMarcarInternos = document.getElementById('btn-marcar-internos');
  if (btnMarcarInternos) {
    btnMarcarInternos.addEventListener('click', marcarInternos);
  }

  document.getElementById('btn-limpar-filtros').addEventListener('click', () => {
    especialidadesAtivas.clear();
    renderizarEspecialidades();
    renderizarLista();
  });

  // V491: debounce de 250ms — antes cada tecla refazia query + lista completa
  let buscaMedTimer = null;
  document.getElementById('busca-medico').addEventListener('input', (e) => {
    termoBusca = e.target.value;
    clearTimeout(buscaMedTimer);
    buscaMedTimer = setTimeout(() => renderizarLista(), 250);
  });

  // Cards clicáveis: filtram a lista por tipo de vínculo (e Fellow / Sem tipo)
  // Click no mesmo card que já está ativo → limpa o filtro
  document.querySelectorAll('.medico-stat-card').forEach(card => {
    card.addEventListener('click', () => {
      const tipo = card.dataset.tipo || '';
      const novoFiltro = tipo === '' ? null : tipo;
      filtroTipo = (filtroTipo === novoFiltro) ? null : novoFiltro;

      // Atualiza visual (classe is-ativo) sem re-render dos cards
      document.querySelectorAll('.medico-stat-card').forEach(c => {
        const t = c.dataset.tipo || '';
        const ehAtivo = (filtroTipo === null && t === '') || (filtroTipo === t);
        c.classList.toggle('is-ativo', ehAtivo);
      });

      renderizarLista();
    });
  });

  // Render inicial
  renderizarEspecialidades();
  renderizarLista();
};

// ============================================================================
// MODAL GENÉRICO (usado pela tela de médicos)
// ============================================================================
// Coloco aqui pois é usado pela primeira vez nesta tela.
// Outras telas podem reaproveitar (já é função global).

function abrirModal({ titulo, conteudo, acoes, onAcao, apos, aoFechar }) {
  fecharModal();  // garante que só um modal aberto

  const overlay = document.createElement('div');
  overlay.id = 'app-modal-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(26, 36, 33, 0.5);
    display: flex; align-items: center; justify-content: center;
    z-index: 5000; padding: 20px; 
    animation: fade-in-up 200ms;
  `;
  overlay.innerHTML = `
    <div style="background: var(--bg-elevated); border-radius: var(--radius-lg); width: 100%; max-width: 540px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: var(--shadow-lg); overflow: hidden">
      <div style="padding: 18px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center">
        <h3 style="margin: 0; font-family: var(--font-display); font-size: 18px; font-weight: 500">${titulo}</h3>
        <button id="modal-close" class="btn" style="padding: 4px 10px; font-size: 16px">×</button>
      </div>
      <div style="padding: 20px 24px; overflow-y: auto; flex: 1">${conteudo}</div>
      <div style="padding: 14px 24px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px">
        ${acoes.map(a => `<button class="btn ${a.tipo === 'primary' ? 'btn-primary' : ''}" data-acao="${a.acao}">${a.label}</button>`).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelectorAll('[data-acao]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await onAcao(btn.dataset.acao);
      if (ok !== false) {
        fecharModal();
        if (aoFechar) aoFechar();
      }
    });
  });
  document.getElementById('modal-close').addEventListener('click', () => {
    fecharModal();
    if (aoFechar) aoFechar();
  });

  if (apos) requestAnimationFrame(apos);
}

function fecharModal() {
  const ex = document.getElementById('app-modal-overlay');
  if (ex) ex.remove();
}

// ════════════════════════════════════════════════════════════════════════
// V828: o formulário de edição do médico saiu do fechamento da tela para o
// nível do arquivo — a MATRIZ EXTERNA reutiliza exatamente o mesmo formulário
// ao cadastrar um médico novo (window.AtlasMedicos.abrirEdicaoMedico).
// ════════════════════════════════════════════════════════════════════════
async function abrirEdicaoMedico(medicoId) {
    const med = Banco.queryUnica('SELECT * FROM medicos WHERE id = ?', [medicoId]);
    if (!med) return;

    const todasEsp = Banco.query(
      'SELECT id, nome FROM especialidades WHERE ativo = 1 ORDER BY ordem, nome'
    );
    const vinculadas = new Set(
      Banco.query(
        'SELECT especialidade_id FROM medico_especialidades WHERE medico_id = ?',
        [medicoId]
      ).map(r => r.especialidade_id)
    );

    const todasUnidades = Banco.query(
      'SELECT id, nome FROM unidades WHERE ativo = 1 ORDER BY ordem, nome'
    );
    const unidadesVinculadas = new Set(
      Banco.query(
        'SELECT unidade_id FROM medico_unidades WHERE medico_id = ?',
        [medicoId]
      ).map(r => r.unidade_id)
    );

    // Cargos atualmente vinculados (até 3: DM, CM, RT)
    const cargosVinculados = new Set(
      Banco.query(
        'SELECT cargo FROM medico_cargos WHERE medico_id = ?',
        [medicoId]
      ).map(r => r.cargo)
    );

    abrirModal({
      titulo: 'Editar médico',
      conteudo: `
        <div class="field">
          <label>Nome completo</label>
          <input type="text" class="input" id="modal-nome" value="${escapeHTML(med.nome_oficial)}">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
          <div class="field">
            <label>CRM</label>
            <input type="text" class="input" id="modal-crm" value="${escapeHTML(med.crm || '')}">
          </div>
          <div class="field">
            <label>RQE</label>
            <input type="text" class="input" id="modal-rqe" value="${escapeHTML(med.rqe || '')}">
          </div>
        </div>
        <div class="field">
          <label>Tipo de vínculo</label>
          <select class="select" id="modal-tipo-vinculo">
            <option value="">— Não definido —</option>
            <option value="INTERNO" ${med.tipo_vinculo === 'INTERNO' ? 'selected' : ''}>Interno</option>
            <option value="HIBRIDO" ${med.tipo_vinculo === 'HIBRIDO' ? 'selected' : ''}>Híbrido</option>
            <option value="EXTERNO" ${med.tipo_vinculo === 'EXTERNO' ? 'selected' : ''}>Externo</option>
          </select>
        </div>
        <!-- V699: médico externo/híbrido pertence a uma clínica (módulo Externos) -->
        <div class="field" id="modal-clinica-wrap" style="${med.tipo_vinculo === 'EXTERNO' || med.tipo_vinculo === 'HIBRIDO' ? '' : 'display:none'}">
          <label>Clínica externa (módulo Externos)</label>
          <select class="select" id="modal-clinica">
            <option value="">— Sem clínica —</option>
            ${Banco.query('SELECT id, nome, cnpj FROM externos_clinicas WHERE ativo = 1 ORDER BY nome')
              .map(c => `<option value="${c.id}" ${med.clinica_externa_id === c.id ? 'selected' : ''}>${escapeHTML(c.nome)}${c.cnpj ? ' · ' + escapeHTML(c.cnpj) : ''}</option>`).join('')}
            <option value="__nova__">＋ Cadastrar nova clínica…</option>
          </select>
          <div id="modal-clinica-nova" style="display:none; margin-top:8px">
            <input type="text" class="input" id="modal-clinica-nome" placeholder="Nome da clínica" style="margin-bottom:6px">
            <input type="text" class="input" id="modal-clinica-cnpj" placeholder="CNPJ (opcional)">
          </div>
        </div>
        <div class="field">
          <label>Cargos administrativos (marque um ou mais)</label>
          <div id="modal-cargos-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-top: 8px">
            <label style="display: flex; align-items: center; gap: 6px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; background: var(--bg-elevated)">
              <input type="checkbox" data-cargo="DIRETORIA_TECNICA" ${cargosVinculados.has('DIRETORIA_TECNICA') ? 'checked' : ''} style="margin: 0">
              <span style="font-size: 13px">Diretoria Técnica <strong style="font-size: 10px; color: var(--ink-faint)">(DT)</strong></span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; background: var(--bg-elevated)">
              <input type="checkbox" data-cargo="DIRETORIA_CLINICA" ${cargosVinculados.has('DIRETORIA_CLINICA') ? 'checked' : ''} style="margin: 0">
              <span style="font-size: 13px">Diretoria Clínica <strong style="font-size: 10px; color: var(--ink-faint)">(DC)</strong></span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; background: var(--bg-elevated)">
              <input type="checkbox" data-cargo="COORDENADOR_MEDICO" ${cargosVinculados.has('COORDENADOR_MEDICO') ? 'checked' : ''} style="margin: 0">
              <span style="font-size: 13px">Coordenador Médico <strong style="font-size: 10px; color: var(--ink-faint)">(CM)</strong></span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; background: var(--bg-elevated)">
              <input type="checkbox" data-cargo="RESPONSAVEL_TECNICO" ${cargosVinculados.has('RESPONSAVEL_TECNICO') ? 'checked' : ''} style="margin: 0">
              <span style="font-size: 13px">Responsável Técnico <strong style="font-size: 10px; color: var(--ink-faint)">(RT)</strong></span>
            </label>
          </div>
          <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border)">
            <label style="display: flex; align-items: center; gap: 6px; padding: 8px 10px; border: 1px solid #0A7A5A; border-radius: var(--radius-md); cursor: pointer; background: #F0F7EE">
              <input type="checkbox" data-cargo="SOCIO" ${cargosVinculados.has('SOCIO') ? 'checked' : ''} style="margin: 0">
              <span style="font-size: 13px">
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; background: #D8EAD3; color: #0A7A5A; border: 1.5px solid #0A7A5A; border-radius: 50%; font-size: 8px; font-weight: 800; line-height: 1; vertical-align: middle; margin-right: 4px">S</span>
                Sócio <strong style="font-size: 10px; color: var(--ink-faint)">(informativo, não gera pagamento)</strong>
              </span>
            </label>
          </div>
        </div>
        <div class="field">
          <label>E-mail</label>
          <input type="email" class="input" id="modal-email" value="${escapeHTML(med.email || '')}">
        </div>
        <div class="field">
          <label>Telefone</label>
          <input type="text" class="input" id="modal-telefone" value="${escapeHTML(med.telefone || '')}">
        </div>
        <div class="field">
          <label>CNPJ</label>
          <input type="text" class="input" id="modal-cnpj" value="${escapeHTML(med.cnpj || '')}">
        </div>
        <div class="field">
          <label>Razão Social</label>
          <input type="text" class="input" id="modal-razao" value="${escapeHTML(med.razao_social || '')}">
        </div>
        <div class="field">
          <label>Especialidades (marque uma ou mais)</label>
          <div id="modal-esp-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-top: 8px">
            ${todasEsp.map(e => `
              <label style="display: flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; background: var(--bg-elevated)">
                <input type="checkbox" data-esp-id="${e.id}" ${vinculadas.has(e.id) ? 'checked' : ''} style="margin: 0">
                <span style="font-size: 13px">${escapeHTML(e.nome)}</span>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="field">
          <label>Unidades (marque uma ou mais)</label>
          ${todasUnidades.length === 0 ? `
            <p class="small muted" style="margin: 8px 0 0">
              Nenhuma unidade cadastrada. Vá em <strong>Unidades</strong> no menu para cadastrar.
            </p>
          ` : `
            <div id="modal-unid-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-top: 8px">
              ${todasUnidades.map(u => `
                <label style="display: flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; background: var(--bg-elevated)">
                  <input type="checkbox" data-unid-id="${u.id}" ${unidadesVinculadas.has(u.id) ? 'checked' : ''} style="margin: 0">
                  <span style="font-size: 13px">${escapeHTML(u.nome)}</span>
                </label>
              `).join('')}
            </div>
          `}
        </div>
        <div class="field">
          <label>Observações</label>
          <textarea class="textarea" id="modal-obs" rows="2">${escapeHTML(med.observacoes || '')}</textarea>
        </div>
      `,
      acoes: [
        { label: 'Cancelar', tipo: 'normal', acao: 'cancelar' },
        { label: 'Salvar',   tipo: 'primary', acao: 'salvar' },
      ],
      onAcao: async (acao) => {
        if (acao === 'cancelar') return true;
        if (acao === 'salvar') {
          const nome = document.getElementById('modal-nome').value.trim();
          if (!nome) { alert('Nome é obrigatório'); return false; }
          const nomeNorm = Utilidades.normalizar(nome);

          const valores = {
            crm:          document.getElementById('modal-crm').value.trim() || null,
            rqe:          document.getElementById('modal-rqe').value.trim() || null,
            email:        document.getElementById('modal-email').value.trim() || null,
            telefone:     document.getElementById('modal-telefone').value.trim() || null,
            cnpj:         document.getElementById('modal-cnpj').value.trim() || null,
            razao_social: document.getElementById('modal-razao').value.trim() || null,
            tipo_vinculo: document.getElementById('modal-tipo-vinculo').value || null,
            obs:          document.getElementById('modal-obs').value.trim() || null,
          };

          // V699: clínica externa (cria na hora se "nova clínica" foi preenchida)
          let clinicaId = null;
          const selClin = document.getElementById('modal-clinica');
          if (selClin && (valores.tipo_vinculo === 'EXTERNO' || valores.tipo_vinculo === 'HIBRIDO')) {
            if (selClin.value === '__nova__') {
              const nomeClin = (document.getElementById('modal-clinica-nome').value || '').trim();
              const cnpjClin = (document.getElementById('modal-clinica-cnpj').value || '').trim() || null;
              if (nomeClin) {
                const jaTem = Banco.queryUnica('SELECT id FROM externos_clinicas WHERE nome = ?', [nomeClin]);
                clinicaId = jaTem ? jaTem.id
                  : Banco.executar('INSERT INTO externos_clinicas (nome, cnpj) VALUES (?, ?)', [nomeClin, cnpjClin]).lastInsertRowId;
              }
            } else if (selClin.value) {
              clinicaId = Number(selClin.value) || null;
            }
          }

          const novasEsp = new Set();
          document.querySelectorAll('#modal-esp-grid input[type=checkbox]:checked').forEach(cb => {
            novasEsp.add(Number(cb.dataset.espId));
          });

          const novasUnid = new Set();
          document.querySelectorAll('#modal-unid-grid input[type=checkbox]:checked').forEach(cb => {
            novasUnid.add(Number(cb.dataset.unidId));
          });

          const novosCargos = new Set();
          // Pega TODOS os checkboxes com data-cargo no modal (DT/DC/CM/RT
          // estão dentro de #modal-cargos-grid e o Sócio está em outra div
          // logo abaixo, ambos dentro do mesmo field).
          document.querySelectorAll('input[type=checkbox][data-cargo]:checked').forEach(cb => {
            novosCargos.add(cb.dataset.cargo);
          });

          // Atualiza médico
          Banco.executar(
            `UPDATE medicos SET
               nome_oficial = ?, nome_normalizado = ?,
               crm = ?, rqe = ?, email = ?, telefone = ?,
               cnpj = ?, razao_social = ?, tipo_vinculo = ?, observacoes = ?,
               clinica_externa_id = ?,
               atualizado_em = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
              nome, nomeNorm,
              valores.crm, valores.rqe, valores.email, valores.telefone,
              valores.cnpj, valores.razao_social, valores.tipo_vinculo, valores.obs,
              clinicaId,
              medicoId
            ]
          );
          if (window.AtlasExternos) window.AtlasExternos._limparCache();

          // Sincroniza vínculos: apaga removidos, insere novos
          for (const espId of vinculadas) {
            if (!novasEsp.has(espId)) {
              Banco.executar(
                'DELETE FROM medico_especialidades WHERE medico_id = ? AND especialidade_id = ?',
                [medicoId, espId]
              );
            }
          }
          for (const espId of novasEsp) {
            if (!vinculadas.has(espId)) {
              Banco.executar(
                'INSERT INTO medico_especialidades (medico_id, especialidade_id) VALUES (?, ?)',
                [medicoId, espId]
              );
            }
          }

          // Mesma lógica para unidades
          for (const unidId of unidadesVinculadas) {
            if (!novasUnid.has(unidId)) {
              Banco.executar(
                'DELETE FROM medico_unidades WHERE medico_id = ? AND unidade_id = ?',
                [medicoId, unidId]
              );
            }
          }
          for (const unidId of novasUnid) {
            if (!unidadesVinculadas.has(unidId)) {
              Banco.executar(
                'INSERT INTO medico_unidades (medico_id, unidade_id) VALUES (?, ?)',
                [medicoId, unidId]
              );
            }
          }

          // Mesma lógica para cargos administrativos
          for (const cargo of cargosVinculados) {
            if (!novosCargos.has(cargo)) {
              Banco.executar(
                'DELETE FROM medico_cargos WHERE medico_id = ? AND cargo = ?',
                [medicoId, cargo]
              );
            }
          }
          for (const cargo of novosCargos) {
            if (!cargosVinculados.has(cargo)) {
              Banco.executar(
                'INSERT INTO medico_cargos (medico_id, cargo) VALUES (?, ?)',
                [medicoId, cargo]
              );
            }
          }

          await Banco.salvar();
          Utilidades.toast('Médico atualizado', 'success');
          // V828: o formulário também é aberto de fora (Matriz Externa) — ao
          // salvar, volta para a tela de onde veio, não para o MÉDICOS
          App.navegarPara(App.telaAtual && App.telas[App.telaAtual] ? App.telaAtual : 'medicos');
          return true;
        }
        return true;
      },
    });

    // V699: o campo de clínica só faz sentido pra EXTERNO/HÍBRIDO; e o select
    // ganha o mini-formulário de "nova clínica" quando pedido.
    const selTipoV = document.getElementById('modal-tipo-vinculo');
    const wrapClin = document.getElementById('modal-clinica-wrap');
    const selClinV = document.getElementById('modal-clinica');
    if (selTipoV && wrapClin) {
      selTipoV.addEventListener('change', () => {
        wrapClin.style.display = (selTipoV.value === 'EXTERNO' || selTipoV.value === 'HIBRIDO') ? '' : 'none';
      });
    }
    if (selClinV) {
      selClinV.addEventListener('change', () => {
        document.getElementById('modal-clinica-nova').style.display = selClinV.value === '__nova__' ? 'block' : 'none';
      });
    }
  }


window.AtlasMedicos = window.AtlasMedicos || {};
window.AtlasMedicos.abrirEdicaoMedico = abrirEdicaoMedico;
