/**
 * ============================================================================
 * APLICAÇÃO PRINCIPAL — Roteamento de telas (ATLAS v1.0: sem login)
 * ============================================================================
 */

const App = {
  telaAtual: 'dashboard',

  // Mapeamento: id da tela → função que renderiza
  telas: {},

  async iniciar() {
    Utilidades.mostrarLoading('Carregando');

    try {
      // Auth só guarda a senha administrativa (ATLAS v1.0: sem tela de login)
      await Auth.inicializar();
      await Banco.inicializar();
      // V592: recarrega o vínculo do arquivo automático (cópia real em disco)
      try { if (window.AtlasArquivoBanco) await AtlasArquivoBanco.inicializar(); } catch (_) {}
      // V597: remove CÁLCULOS SALVOS órfãos — competência sem NENHUM dado-fonte
      // (QVIS, Produção, Laudos, Períodos, Fellow). Acontece quando um mês de
      // teste é importado, calculado e depois excluído: o snapshot ficava para
      // trás e a competência "voltava" nos seletores.
      try {
        const orfaos = (Banco.query(`
          SELECT s.competencia AS c FROM repasse_snapshot s
           WHERE NOT EXISTS (SELECT 1 FROM linhas_qvis      q WHERE q.mes_pagamento = s.competencia)
             AND NOT EXISTS (SELECT 1 FROM linhas_producao  p WHERE p.competencia   = s.competencia)
             AND NOT EXISTS (SELECT 1 FROM laudos           l WHERE l.competencia   = s.competencia)
             AND NOT EXISTS (SELECT 1 FROM periodos_linhas  pe WHERE pe.mes_ref     = s.competencia)
             AND NOT EXISTS (SELECT 1 FROM fellow_linhas    f WHERE f.mes_ref       = s.competencia)`) || []).map(r => r.c);
        if (orfaos.length) {
          for (const c of orfaos) {
            Banco.executar(`DELETE FROM repasse_snapshot WHERE competencia = ?`, [c]);
            Banco.executar(`DELETE FROM repasse_pagos WHERE competencia = ?`, [c]);
            try { Banco.executar(`DELETE FROM vg_calc_cache WHERE chave LIKE '%|' || ?`, [c]); } catch (_) {}
          }
          console.log('[app] cálculos órfãos removidos (sem dado-fonte):', orfaos.join(', '));
          Banco.salvarDebounced && Banco.salvarDebounced();
        }
      } catch (e) { console.warn('[app] limpeza de cálculos órfãos:', e); }

      // V647: a compressão dos snapshots legados SAIU do boot — rodava
      // síncrona (160 MB de gzip + export de 1 GB) em cima da tela de login e
      // congelava tudo; se a aba fosse fechada no meio, recomeçava a cada
      // abertura. Agora roda DEPOIS do login, em segundo plano e por fatias
      // (ver _migrarSnapshotsV644, agendada no _entrarNoApp).
      Utilidades.esconderLoading();

      // V589: libs de planilha fora do caminho crítico — carregam ~1,5s após
      // o boot (o usuário ainda está no login/dashboard; ao clicar num export
      // ou import elas já estão prontas). Cada tela mantém o guard existente
      // (typeof ExcelJS === 'undefined' → toast) como rede de segurança.
      setTimeout(() => {
        ['libs/xlsx.full.min.js', 'libs/exceljs.min.js', 'libs/jszip.min.js'].forEach(src => {
          const s = document.createElement('script');
          s.src = src;
          document.head.appendChild(s);
        });
      }, 1500);

      // ATLAS v1.0: sem tela de login — a ferramenta é local, entra direto.
      this._aposLogin();
    } catch (e) {
      Utilidades.esconderLoading();
      console.error(e);
      // V836: a tela de erro agora RESOLVE — dá para tentar de novo e, se o
      // banco no IndexedDB estiver mesmo inconsistente, restaurar direto da
      // cópia automática (.db) sem precisar abrir o app.
      // V839: memória PRIMEIRO — "Out of memory"/"allocation failed" não é
      // problema do banco nem de libs/; a dica antiga (conferir a pasta libs/)
      // mandava o usuário pro lugar errado.
      const ehMemoria = /mem[óo]ria|memory|alloc/i.test(String(e.message || ''));
      const ehBanco = !ehMemoria && /fatia|IndexedDB|banco/i.test(String(e.message || ''));
      document.body.innerHTML = `
        <div style="padding: 40px; max-width: 620px; margin: 80px auto; font-family: sans-serif">
          <h2 style="color: #9B3A3A">Erro ao inicializar</h2>
          <p>${e.message}</p>
          <div style="margin: 18px 0; display: flex; gap: 10px; flex-wrap: wrap">
            <button id="boot-tentar" style="padding: 9px 16px; border: 1px solid #107DAC; background: #107DAC; color: #fff; border-radius: 8px; cursor: pointer; font-size: 14px">↻ Tentar de novo</button>
            ${ehBanco && window.Banco && Banco.restaurarDeArquivo ? `
            <button id="boot-restaurar" style="padding: 9px 16px; border: 1px solid #107DAC; background: #fff; color: #107DAC; border-radius: 8px; cursor: pointer; font-size: 14px">Restaurar da cópia automática (.db)</button>
            <input type="file" id="boot-arquivo" accept=".db,.sqlite,.bin,application/octet-stream" style="display:none">` : ''}
          </div>
          <p id="boot-rest-msg" style="font-size: 13px; color: #666"></p>
          ${ehBanco ? `<p style="color: #666; font-size: 13px">
            A cópia automática é o arquivo <strong>.db</strong> que a ferramenta grava sozinha
            (Backup → Arquivo automático). Restaurar substitui o banco desta máquina pelo conteúdo do arquivo.
          </p>` : ehMemoria ? `<p style="color: #666; font-size: 13px">
            A abertura precisou de mais memória do que a máquina tinha livre neste momento.
            Feche outras abas e programas e clique em <strong>Tentar de novo</strong>.
            Se o erro insistir, reinicie o navegador; com a ferramenta aberta,
            Administração → <strong>Compactar</strong> reduz o tamanho do banco.
          </p>` : `<p style="color: #666; font-size: 13px">
            Verifique se a pasta <code>libs/</code> está junto do index.html
            (o app é 100% offline — as bibliotecas ficam nessa pasta).
          </p>`}
        </div>
      `;
      document.getElementById('boot-tentar')?.addEventListener('click', () => location.reload());
      const btnRest = document.getElementById('boot-restaurar');
      const inpRest = document.getElementById('boot-arquivo');
      if (btnRest && inpRest) {
        btnRest.addEventListener('click', async () => {
          // V837: primeiro tenta o VÍNCULO salvo (um clique, sem procurar
          // arquivo); só sem vínculo/permissão abre o seletor
          const msg = document.getElementById('boot-rest-msg');
          let bytes = null;
          try {
            bytes = window.AtlasArquivoBanco && AtlasArquivoBanco.lerBytesComPermissao
              ? await AtlasArquivoBanco.lerBytesComPermissao() : null;
          } catch (err) { console.warn('leitura do vínculo falhou:', err); bytes = null; }
          if (!bytes) { inpRest.click(); return; }   // sem vínculo/permissão → seletor
          btnRest.disabled = true;
          msg.textContent = 'Restaurando da cópia automática vinculada… não feche a janela.';
          try {
            await Banco.restaurarDeArquivo(bytes, { semReload: true });
            msg.textContent = '✓ Banco restaurado — recarregando…';
            setTimeout(() => location.reload(), 600);
          } catch (err) {
            // V839: a restauração em si FALHOU (ex.: .db truncado pela nuvem)
            // — o botão volta e a mensagem explica; abrir o seletor aqui
            // esconderia o motivo e deixava o botão preso em "Restaurando…"
            btnRest.disabled = false;
            msg.textContent = 'Falha na restauração: ' + ((err && err.message) || err);
          }
        });
        inpRest.addEventListener('change', async () => {
          if (!inpRest.files.length) return;
          const msg = document.getElementById('boot-rest-msg');
          btnRest.disabled = true;
          msg.textContent = 'Restaurando o banco a partir do arquivo… não feche a janela.';
          try {
            await Banco.restaurarDeArquivo(inpRest.files[0], { semReload: true });
            msg.textContent = '✓ Banco restaurado — recarregando…';
            setTimeout(() => location.reload(), 600);
          } catch (err) {
            btnRest.disabled = false;
            msg.textContent = 'Falha na restauração: ' + (err.message || err);
          }
        });
      }
    }
  },

  _aposLogin() {
    // Uma ferramenta por unidade (V696): entra direto no app após o login.
    this._entrarNoApp();
  },

  _entrarNoApp() {
    this._construirInterface();
    this._aplicarPermissoesMenu();
    this._iniciarFitaTitulos();
    this.pintarVersao();   // V858: o menu só existe agora — repinta o carimbo
    // V699: o MODO EXTERNO sobrevive ao reload — volta direto pra Matriz
    if (localStorage.getItem('atlas_modo_externo') === '1') {
      this.setModoExterno(true, { navegar: true });
    } else {
      // Navega para o primeiro módulo permitido
      const primeiraPermitida = this._primeiraTelaPermitida();
      this.navegarPara(primeiraPermitida);
    }
    // V647: compressão dos snapshots legados em SEGUNDO PLANO, bem depois do
    // login — nunca mais no caminho crítico do boot
    setTimeout(() => { this._migrarSnapshotsV644(); }, 15000);
  },

  // ── V647: migração dos snapshots legados (JSON puro → gzip, ~8-10× menor).
  // Assíncrona e fatiada: cada mês é comprimido com CompressionStream (nativo,
  // fora da thread principal) e há uma pausa entre um e outro — a tela nunca
  // congela. Interrompeu no meio? Sem problema: os já convertidos ficam,
  // os leitores aceitam os dois formatos e a rodada seguinte continua de onde
  // parou (só converte o que ainda é texto). O flag SNAP_GZ_V644 só é gravado
  // quando TUDO terminou.
  async _migrarSnapshotsV644() {
    try {
      if (!Banco || !Banco.db || !Banco.snapUnpack) return;
      const jaFeito = (Banco.query(`SELECT valor FROM config_sistema WHERE chave = 'SNAP_GZ_V644'`) || [])[0];
      if (jaFeito) return;
      let comps = [];
      try { comps = (Banco.query(`SELECT competencia FROM repasse_snapshot`) || []).map(r => r.competencia); }
      catch (_) { return; }   // tabela ainda não existe nesta base
      const gzipAsync = async (str) => {
        if (typeof CompressionStream !== 'undefined') {
          const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
          return new Uint8Array(await new Response(stream).arrayBuffer());
        }
        // fallback: gzip síncrono (fflate) — só se o navegador não tiver o nativo
        if (window.fflate) return window.fflate.gzipSync(window.fflate.strToU8(str), { level: 6 });
        return null;
      };
      let convertidos = 0, ganhoMB = 0;
      for (const c of comps) {
        let row = null;
        try { row = Banco.queryUnica(`SELECT resultado_json FROM repasse_snapshot WHERE competencia = ?`, [c]); } catch (_) {}
        if (!row || typeof row.resultado_json !== 'string' || row.resultado_json.length <= 4096) continue;
        const gz = await gzipAsync(row.resultado_json);
        if (!gz || !(gz instanceof Uint8Array)) continue;
        try {
          Banco.executar(`UPDATE repasse_snapshot SET resultado_json = ? WHERE competencia = ?`, [gz, c]);
          convertidos++; ganhoMB += (row.resultado_json.length - gz.length) / 1048576;
        } catch (e) { console.warn('[app] V647 snapshot', c, e); }
        await new Promise(r => setTimeout(r, 400));   // respira entre um mês e outro
      }
      Banco.executar(`INSERT OR REPLACE INTO config_sistema (chave, valor) VALUES ('SNAP_GZ_V644', '1')`);
      if (convertidos) {
        console.log(`[app] V647: ${convertidos} snapshots comprimidos (−${ganhoMB.toFixed(1)} MB)`);
        Banco.salvarDebounced && Banco.salvarDebounced(3000);
        Utilidades.toast?.(`📦 ${convertidos} cálculos salvos foram comprimidos em segundo plano (−${ganhoMB.toFixed(0)} MB). Pra recuperar o espaço no arquivo do banco, use Backup → Compactar banco.`, 'info', 10000);
      } else {
        // nada a converter — persiste só o flag junto do próximo salvamento real
        Banco.salvarDebounced && Banco.salvarDebounced(3000);
      }
    } catch (e) { console.warn('[app] V647 compressão de snapshots:', e); }
  },

  // ── V160: fita-título (banner dark green com seta + rolinho) em todas as telas ──
  _iniciarFitaTitulos() {
    const cont = document.getElementById('conteudo');
    if (!cont) return;
    // V166: o HUB absorve genericamente os botões de ação do header de cada módulo
    const ICONES = [
      [/excel|exportar/i, 'ti-file-spreadsheet'], [/importar/i, 'ti-download'],
      [/coluna/i, 'ti-columns'], [/visualiza/i, 'ti-eye'],
      [/classifica|ajust/i, 'ti-adjustments'], [/inspecionar|buscar/i, 'ti-search'],
      [/adicionar|novo|nova|criar/i, 'ti-plus'], [/recalcular|atualizar/i, 'ti-refresh'],
    ];
    const coletarAlvos = () => {
      const cands = cont.querySelectorAll('[class*="header"] button, .pm-head button');
      const brutos = [...cands].filter(b =>
        !b.closest('.fita-titulo') &&
        !b.closest('table') &&
        !b.closest('[class*="popover"], [class*="menu"], [class*="modal"], [class*="banner"], [class*="filtro"], [class*="combo"]') &&
        !b.matches('[data-combo-arrow], [class*="combo"], [class*="clear"], [class*="chip"], [class*="aba"]') &&
        !b.className.includes('pm-chip') &&
        !b.className.includes('pm-aba') &&
        !b.className.includes('btn-info') &&
        !b.className.includes('vg-lembrete-btn') &&
        !b.className.includes('vg-cod-switch') &&
        b.style.display !== 'none'
      );
      // dedupe: rótulos repetidos são controles de campo (ex.: setas de dropdown), não ações do módulo
      const rotuloDe = (b) => (b.textContent || '').replace(/[^\p{L}\p{N}\s]/gu, '').trim().toLowerCase();
      const contagem = {};
      brutos.forEach(b => { const r = rotuloDe(b); contagem[r] = (contagem[r] || 0) + 1; });
      return brutos.filter(b => contagem[rotuloDe(b)] === 1);
    };
    let _hubReabrir = false;   // V261: só reabre o globo quando o rebuild veio de um toggle de chip da ilha (não em navegação)
    let _hubSinteticoColuna = false;   // V434: marca o clique sintético do item do leque que abre o popover de Colunas (p/ o leque continuar aberto)
    const montarHub = () => {
      const hubEx = document.getElementById('atlas-hub');
      const estavaAberto = hubEx ? hubEx.classList.contains('aberto') : false;   // V261: preserva aberto entre re-renders
      if (hubEx && hubEx._alvos && hubEx._alvos.length && hubEx._alvos.every(b => b.isConnected && b.style.display === 'none')) return;
      hubEx?.remove();
      const alvos = coletarAlvos();
      const ilhasEl = [...cont.querySelectorAll('.atlas-hub-ilha')];   // V261: ilhas de módulo (grupos de chips → vão pro globo)
      if (!alvos.length && !ilhasEl.length) return;
      alvos.forEach(b => { b.style.display = 'none'; });
      const hub = document.createElement('div');
      hub.id = 'atlas-hub';
      const rot = (b) => (b.textContent || '').replace(/[^\p{L}\p{N}\s]/gu, '').trim().replace(/\s+/g, ' ')
        || (b.title || '').replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/).slice(0, 3).join(' ')
        || 'Ação';
      const ico = (t) => (ICONES.find(([re]) => re.test(t)) || [null, 'ti-bolt'])[1];
      // V261: ilhas (grupos de chips) → painel no globo; proxies espelham rótulo + estado 'on' e clicam o chip real
      const ilhasHtml = ilhasEl.map((ilha, gi) => {
        ilha.style.display = 'none';
        const titulo = ilha.dataset.ilha || 'Filtro';
        const btns = [...ilha.querySelectorAll('button')];
        return `<div class="hub-ilha"><div class="hub-ilha-tit">${titulo}</div><div class="hub-ilha-chips">`
          + btns.map((b, bi) => `<button class="hub-ilha-chip ${b.classList.contains('on') ? 'on' : ''}" data-gi="${gi}" data-bi="${bi}">${(b.textContent || '').trim()}</button>`).join('')
          + `</div></div>`;
      }).join('');
      hub.innerHTML = `
        <button class="hub-btn" title="Ações do módulo" aria-label="Ações do módulo"><svg class="hub-clip" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect class="clip-body" x="4.5" y="4" width="15" height="17.5" rx="2.5"/><rect class="clip-tab" x="9" y="2" width="6" height="3.6" rx="1.3"/><rect class="clip-mark" x="8" y="9.6" width="8" height="1.7" rx="0.85"/><rect class="clip-mark" x="8" y="13.2" width="8" height="1.7" rx="0.85"/><rect class="clip-mark" x="8" y="16.8" width="5" height="1.7" rx="0.85"/></svg></button>
        <div class="hub-itens">${alvos.map((b, i) => {
          const t = rot(b);
          return `<button class="hub-it" style="--i:${alvos.length - 1 - i}">
            <span class="hub-it-fita">${t}</span>
            <span class="hub-it-dot"><i class="ti ${ico(t)}"></i></span>
          </button>`;
        }).join('')}</div>
        ${ilhasHtml ? `<div class="hub-ilhas">${ilhasHtml}</div>` : ''}`;
      hub._alvos = alvos;
      hub._ilhas = ilhasEl;
      document.querySelector('.main').appendChild(hub);
      hub.querySelector('.hub-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        hub.classList.toggle('aberto');
      });
      hub.querySelectorAll('.hub-it').forEach((it, i) => it.addEventListener('click', (e) => {
        e.stopPropagation();
        // V434: NÃO fecha o leque aqui. Marca o clique sintético; quem decide fechar é o fechar-fora
        // (abaixo): fecha em ações normais (Importar/Excel), mas MANTÉM aberto se abriu um popover de Colunas.
        _hubSinteticoColuna = true;
        alvos[i].click();
        _hubSinteticoColuna = false;
      }));
      // V261: proxies das ilhas clicam o chip real (toggle → render → hub remontado já aberto)
      hub.querySelectorAll('.hub-ilha-chip').forEach(pc => pc.addEventListener('click', (e) => {
        e.stopPropagation();
        const gi = +pc.dataset.gi, bi = +pc.dataset.bi;
        const ilha = hub._ilhas[gi];
        const btns = ilha ? ilha.querySelectorAll('button') : [];
        if (btns[bi]) { _hubReabrir = true; btns[bi].click(); }
      }));
      // V492: listener registrado UMA vez (antes: um novo document.addEventListener
      // a cada remontagem do hub — acumulava a cada navegação/mutação e nunca era
      // removido). O handler resolve o hub ATUAL por id, então continua correto
      // após qualquer re-mount. Comportamento idêntico.
      if (!window.__hubFecharForaBound) {
        window.__hubFecharForaBound = true;
        document.addEventListener('click', (e) => {
          const hubAtual = document.getElementById('atlas-hub');
          if (!hubAtual) return;
          // V434: clique sintético do item do leque que ABRIU um popover de Colunas → mantém o leque aberto
          // (em ações normais não há popover de colunas → cai na regra abaixo e fecha como antes).
          if (_hubSinteticoColuna && document.querySelector('[id$="-pop-colunas"]')) return;
          // V264: ignora o clique sintético no chip de vínculo (ilha oculta fora do globo) — senão o globo fecha ao selecionar
          // V434: também ignora cliques DENTRO do popover de Colunas (montado no body) p/ o leque continuar aberto
          if (!e.target.closest('#atlas-hub') && !e.target.closest('.atlas-hub-ilha') && !e.target.closest('[id$="-pop-colunas"]')) hubAtual.classList.remove('aberto');
        });
      }
      // V264/V434: reabre pelo _hubReabrir (ilha-chip) OU enquanto houver um popover de Colunas montado (COLUNAS) — assim o leque continua aberto junto do popover.
      // V743b: [data-manter-leque] é o sinal GENÉRICO de "mantenha o leque
      // aberto" (o menu Visualização do RL usa). Já nasce com a classe, então
      // o leque não colapsa e reabre animando (era o "pulo" ao clicar).
      if (_hubReabrir || document.querySelector('[id$="-pop-colunas"], [data-manter-leque]')) hub.classList.add('aberto');
      _hubReabrir = false;
    };
    // ── V181: redimensionamento de colunas em TODAS as matrizes (mecanismo do LIO) ──
    const decorarResize = () => {
      cont.querySelectorAll('table').forEach((tabela, ti) => {
        if (tabela.dataset.resizeOn) return;
        if (tabela.querySelector('.lio-col-resize')) { tabela.dataset.resizeOn = '1'; return; } // LIO tem o próprio
        const ths = tabela.querySelectorAll('thead th');
        if (ths.length < 2) return;
        tabela.dataset.resizeOn = '1';
        const chave = `atlas_colw_${App.telaAtual}_${(tabela.className || 'tab').split(' ')[0]}_${ti}`;
        let salvas = {};
        try { salvas = JSON.parse(localStorage.getItem(chave) || '{}'); } catch (e) {}
        const congelar = () => {
          if (tabela.dataset.congelada) return;
          // V283: lê TODAS as larguras primeiro (1 reflow), depois escreve — sem thrash read/write
          const larguras = ths.map(th => th.offsetWidth);
          ths.forEach((th, i) => { th.style.width = larguras[i] + 'px'; });
          tabela.style.tableLayout = 'fixed';
          tabela.dataset.congelada = '1';
        };
        // aplica larguras salvas (congela o layout pra respeitá-las)
        if (Object.keys(salvas).length) {
          congelar();
          ths.forEach((th, i) => { if (salvas[i] >= 40) th.style.width = salvas[i] + 'px'; });
        }
        ths.forEach((th, i) => {
          if (getComputedStyle(th).position === 'static') th.style.position = 'relative';
          const alca = document.createElement('span');
          alca.className = 'atlas-col-resize';
          th.appendChild(alca);
          alca.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            congelar();
            const startX = e.pageX;
            const startW = th.offsetWidth;
            document.body.classList.add('atlas-redimensionando');
            alca.classList.add('ativa');
            const onMove = (ev) => {
              th.style.width = Math.max(40, startW + (ev.pageX - startX)) + 'px';
            };
            const onUp = () => {
              document.body.classList.remove('atlas-redimensionando');
              alca.classList.remove('ativa');
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
              try {
                const atu = JSON.parse(localStorage.getItem(chave) || '{}');
                atu[i] = th.offsetWidth;
                localStorage.setItem(chave, JSON.stringify(atu));
              } catch (err) {}
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          });
        });
      });
    };
    const alinharDock = () => {
      const fita = cont.querySelector('.titulo-banner');
      const wrap = document.querySelector('.import-dock-wrap');
      if (!fita || !wrap) return;
      const alvoX = fita.getBoundingClientRect().left;  // início do banner (círculo)
      const atualPad = parseFloat(getComputedStyle(wrap).paddingLeft) || 0;
      const delta = alvoX - (wrap.getBoundingClientRect().left + atualPad);
      if (Math.abs(delta) > 1) wrap.style.paddingLeft = (atualPad + delta) + 'px';
    };
    if (!window.__dockResizeBind) {
      window.__dockResizeBind = true;
      window.addEventListener('resize', () => requestAnimationFrame(alinharDock));
    }
    const aplicar = () => {
      const h = cont.querySelector('h1, h2');
      const jaFeito = !!(h && h.dataset.banner);
      // 1) DECORA O TÍTULO PRIMEIRO — assim, se montarHub()/alinharDock()
      //    estourarem em alguma tela de cabeçalho complexo (OPME, Fellow,
      //    Laudos, Fracionamento…), o banner já foi inserido mesmo assim.
      if (h && !jaFeito) {
        const titulo = (h.textContent || '').trim();
        if (titulo) {
          h.dataset.banner = '1';
          h.classList.add('titulo-banner');
          h.innerHTML =
            '<span class="tb-greencirc"></span>' +
            '<span class="tb-pill-green"><span class="tb-pill-light">' +
            '<span class="tb-pill-dark"></span></span></span>' +
            '<span class="tb-circ"></span>';
          h.querySelector('.tb-pill-dark').textContent = titulo;
          // botão informativo (ⓘ) some e clicar no banner abre o informativo
          const bloco = h.closest('.fic-titulo-wrap, .page-header, .fel-header, .per-header') || h.parentNode;
          // AUTO-MONTA o botão informativo novo (atlas-btn-info) se houver doc do
          // módulo atual em window.AtlasDocs — fica VISÍVEL logo após o título.
          let btnNovo = null;
          if (window.AtlasInfo && window.AtlasDocs && window.AtlasDocs[App.telaAtual]) {
            btnNovo = window.AtlasInfo.montar(h, App.telaAtual);
          }
          // esconde QUALQUER botão de info ANTIGO (fic-btn-info, lio-btn-info, estr-btn-info,
          // lc-btn-info…), menos o NOVO. Clicar no banner abre o que existir (novo tem prioridade).
          const antigos = bloco ? bloco.querySelectorAll('[class*="btn-info"]:not(.atlas-btn-info)') : [];
          antigos.forEach(b => { b.style.display = 'none'; });
          const btnAbrir = btnNovo || antigos[0] || null;
          if (btnAbrir) {
            h.style.cursor = 'pointer';
            h.title = 'Clique para ver as informações do módulo';
            h.addEventListener('click', () => btnAbrir.click());
          }
        }
      }
      // 2) Tela já decorada antes desta chamada: mutações seguintes (filtrar,
      //    ordenar, paginar) só re-processam tabelas novas — sem reflow do hub.
      if (jaFeito) { decorarResize(); return; }
      // 3) Primeira vez nesta tela: hub + dock + tabelas (protegidos).
      try { montarHub(); } catch (e) {}
      try { alinharDock(); } catch (e) {}
      decorarResize();
    };
    let agendado = false;
    const obs = new MutationObserver(() => {
      if (agendado) return;
      agendado = true;
      requestAnimationFrame(() => { agendado = false; aplicar(); });
    });
    obs.observe(cont, { childList: true, subtree: true });
    aplicar();
  },

  _primeiraTelaPermitida() {
    const ordem = ['dashboard', 'base-tabela', 'medicos', 'unidades', 'backup', 'administracao'];
    for (const t of ordem) {
      if (Auth.podeAcessar(t)) return t;
    }
    return 'administracao';
  },

  _construirInterface() {
    const usuario = Auth.usuarioAtual() || '';

    document.getElementById('app').innerHTML = `
      <div class="app-shell">
        <div class="atlas-marca-global" aria-hidden="true"></div>
        <aside class="sidebar">
          <!-- V494: cabeçalho no padrão do design handoff (marca + ATLAS / GESTÃO ESTRATÉGICA) -->
          <div class="sidebar-brand" id="sidebar-toggle" title="Abrir / recolher menu">
            <!-- V951: a marca do menu RECOLHIDO virou um <img> real (o mesmo
                 arquivo e o mesmo mecanismo do menu aberto) — antes era
                 background-image por CSS, que não aparecia na máquina do usuário. -->
            <span class="brand-mini" role="img" aria-label="ATLAS"><img src="assets/atlas-mark.png" alt="" draggable="false"></span>
            <!-- V700 (handoff 17C/18C): marca e alternador de base dividem UM
                 painel recuado, empilhados — nada disputa fileira com o wordmark -->
            <div class="brand-painel brand-full">
              <div class="bp-marca">
                <span class="bp-tile"><img src="assets/atlas-mark.png" alt="ATLAS"></span>
                <div class="bp-texto">
                  <h1 class="brand-nome">ATLAS</h1>
                  <p class="brand-sub">AUDITORIA DE CONTAS</p>
                  <p class="brand-sub brand-sub-ext">REPASSE EXTERNO</p>
                </div>
              </div>
              <div class="modo-seg" id="modo-externo-switch" role="tablist" aria-label="Base de trabalho">
                <button type="button" class="seg-btn seg-atlas ativo" data-modo="atlas" role="tab" aria-selected="true">Interno</button>
                <button type="button" class="seg-btn seg-ext" data-modo="ext" role="tab" aria-selected="false">Externo</button>
              </div>
            </div>
          </div>
          <nav class="sidebar-nav">
            <div class="nav-inner nav-normal">
            <div class="nav-section-title">Painel</div>
            <button class="nav-item" data-tela="dashboard">
              <span class="icon"><i class="ti ti-home"></i></span><span class="nav-label">Visão Geral</span>
            </button>

            <button class="nav-item nav-item-grupo" data-grupo="desempenho" id="grupo-desempenho">
              <span class="icon"><i class="ti ti-chart-bar"></i></span><span class="nav-label">Desempenho</span>
              <span class="seta" id="seta-desempenho">►</span>
            </button>
            <div class="nav-subgrupo" id="subitens-desempenho">
              <button class="nav-subitem" data-tela="desempenho-lio">LIO</button>
              <button class="nav-subitem" data-tela="desempenho-opme">OPME</button>
              <button class="nav-subitem" data-tela="desempenho-fellow">Fellow</button>
              <button class="nav-subitem" data-tela="desempenho-fracionamento">Fracionamento</button>
              <button class="nav-subitem" data-tela="desempenho-refractive-laser">Refractive Laser</button>
              <button class="nav-subitem" data-tela="desempenho-periodos">Períodos</button>
              <button class="nav-subitem" data-tela="desempenho-cargos">Cargos Administrativos</button>
              <button class="nav-subitem" data-tela="desempenho-lentes-contato">Lentes de Contato</button>
              <button class="nav-subitem" data-tela="desempenho-luz-pulsada">Luz Pulsada</button>
              <button class="nav-subitem" data-tela="desempenho-estrabismo">Estrabismo</button>
              <button class="nav-subitem" data-tela="desempenho-laudos">Laudos</button>
              <button class="nav-subitem" data-tela="desempenho-crosslink">Crosslink</button>
            </div>

            <div class="nav-section-title">Processamento</div>
            <button class="nav-item" data-tela="calcular">
              <span class="icon"><i class="ti ti-calculator"></i></span><span class="nav-label">Calcular Repasse</span>
            </button>
            <button class="nav-item" data-tela="auditoria">
              <span class="icon"><i class="ti ti-clipboard-check"></i></span><span class="nav-label">Auditoria</span>
            </button>
            <button class="nav-item" data-tela="gerenciais">
              <span class="icon"><i class="ti ti-adjustments"></i></span><span class="nav-label">Gerenciais</span>
            </button>

            <div class="nav-section-title">Saída</div>
            <button class="nav-item" data-tela="relatorios">
              <span class="icon"><i class="ti ti-report"></i></span><span class="nav-label">Relatórios</span>
            </button>
            <button class="nav-item" data-tela="producao-medica">
              <span class="icon"><i class="ti ti-layout-grid"></i></span><span class="nav-label">Produção Médica</span>
            </button>
            <!-- V906: ciclo relatório → nota → CAV, com conferência automática -->
            <button class="nav-item" data-tela="controle-notas">
              <span class="icon"><i class="ti ti-receipt"></i></span><span class="nav-label">Controle de Notas</span>
            </button>
            <!-- V614: Consolidação por último — é o módulo final do fluxo -->
            <button class="nav-item" data-tela="consolidacao">
              <span class="icon"><i class="ti ti-lock-check"></i></span><span class="nav-label">Consolidação</span>
            </button>
            </div>

            <!-- V699/V702: navegação do MODO EXTERNO (visível só com o switch
                 ligado). Importar Admissões é o PRIMEIRO módulo; a Base de
                 Cálculo mora nos Cadastros; a Visão Geral é própria do modo. -->
            <div class="nav-inner nav-externo">
              <!-- V703: a Visão Geral fica ACIMA de tudo (painel próprio do modo),
                   como no modo normal; Importar segue como 1º módulo do grupo -->
              <div class="nav-section-title">Painel</div>
              <button class="nav-item" data-tela="externos-visao">
                <span class="icon"><i class="ti ti-home"></i></span><span class="nav-label">Visão Geral</span>
              </button>
              <div class="nav-section-title">Módulo Externos</div>
              <button class="nav-item" data-tela="externos-importar">
                <span class="icon"><i class="ti ti-file-import"></i></span><span class="nav-label">Importar</span>
              </button>
              <button class="nav-item" data-tela="externos">
                <span class="icon"><i class="ti ti-arrows-diff"></i></span><span class="nav-label">Matriz Externa</span>
              </button>
              <!-- V828: fim da esteira do Externo — extração dos relatórios
                   que vão para cada médico (espelho do RELATÓRIOS do ATLAS) -->
              <button class="nav-item" data-tela="externos-relatorios">
                <span class="icon"><i class="ti ti-report"></i></span><span class="nav-label">Relatórios Externos</span>
              </button>
              <div class="nav-section-title">Cadastros</div>
              <button class="nav-item" data-tela="externos-base">
                <span class="icon"><i class="ti ti-adjustments-dollar"></i></span><span class="nav-label">Base de Cálculo</span>
              </button>
              <!-- V706: NÃO abre o cadastro completo — tela leve que só vincula
                   clínica/tipo aos médicos JÁ cadastrados nesta base -->
              <button class="nav-item" data-tela="externos-medicos">
                <span class="icon"><i class="ti ti-user-circle"></i></span><span class="nav-label">Médicos & Clínicas</span>
              </button>
            </div>
          </nav>

          <!-- V494: card de usuário no padrão do design handoff (avatar gradiente + nome/cargo + sair) -->
          <div class="sidebar-usuario">
            <div class="su-avatar" id="su-avatar">${(usuario[0] || '?').toUpperCase()}</div>
            <div class="su-info">
              <div class="su-nome">${usuario}</div>
              <div class="su-cargo">Administrador</div>
            </div>
          </div>
          <!-- V858: qual pacote está rodando — é por aqui que as duas máquinas
               conferem se estão na MESMA versão da ferramenta -->
          <div class="sidebar-versao" title="Versão do pacote em uso nesta máquina">${(window.ATLAS_VERSAO || {}).pacote || 'versão não identificada'}</div>
        </aside>

        <main class="main">
          <div class="import-dock-wrap" id="topbar-import">
            <div class="import-dock">
              <button class="idock-btn" data-tela="importar-qvis"><span class="idock-ico"><i class="ti ti-file-import"></i></span> QVIS</button>
              <button class="idock-btn" data-tela="importar-producao"><span class="idock-ico"><i class="ti ti-file-import"></i></span> PRODUÇÃO</button>
              <span class="idock-sep" aria-hidden="true"></span>
              <div class="idock-drop" id="idock-cadastros">
                <button class="idock-btn idock-drop-btn" id="idock-cadastros-btn" aria-haspopup="true" aria-expanded="false"><span class="idock-ico"><i class="ti ti-folder"></i></span> CADASTROS <span class="idock-caret"><i class="ti ti-chevron-down"></i></span></button>
                <div class="idock-menu" id="idock-cadastros-menu" role="menu">
                  <button class="idock-menu-item" data-tela="base-tabela" role="menuitem"><i class="ti ti-table"></i> Base Tabela</button>
                  <button class="idock-menu-item" data-tela="medicos" role="menuitem"><i class="ti ti-user-circle"></i> Médicos</button>
                  <button class="idock-menu-item" data-tela="unidades" role="menuitem"><i class="ti ti-building"></i> Unidades</button>
                  <button class="idock-menu-item" data-tela="de-para-nomes" role="menuitem"><i class="ti ti-arrows-exchange"></i> De-Para de Nomes</button>
                </div>
              </div>
            </div>
          </div>
          <div id="conteudo"></div>
        </main>
      </div>

      <style>
        .sidebar {
          display: flex;
          flex-direction: column;
        }
        .sidebar-nav {
          flex: 1;
          min-height: 0;
        }

        /* Item expansível (grupo) */
        .nav-item-grupo {
          position: relative;
        }
        .nav-item-grupo .seta {
          position: absolute;
          right: 14px;
          top: 50%;
          font-size: 10px;
          opacity: 0.5;
          display: inline-block;
          transform-origin: center center;
          transform: translateY(-50%) rotate(0deg);
          transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms;
        }
        .nav-item-grupo.aberto .seta {
          transform: translateY(-50%) rotate(90deg);
          opacity: 0.9;
        }
        .nav-item-grupo.aberto {
          color: #189AD3;
          background: rgba(24, 154, 211, 0.10);
        }

        /* Subitens (recolhidos por padrão) */
        .nav-subgrupo {
          max-height: 0;
          overflow: hidden;
          transition: max-height 280ms cubic-bezier(0.4, 0, 0.2, 1);
          margin-left: 22px;
          padding-left: 10px;
          border-left: 1px solid rgba(255, 255, 255, 0.08);
        }
        .nav-subgrupo.aberto {
          max-height: 600px;
        }

        .nav-subitem {
          display: block;
          width: 100%;
          padding: 6px 12px;
          margin: 1px 0;
          border-radius: 5px;
          color: rgba(232, 237, 233, 0.65);
          background: transparent;
          border: none;
          font-size: 12px;
          font-weight: 500;
          text-align: left;
          font-family: inherit;
          cursor: pointer;
          transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
        }
        .nav-subitem:hover {
          background: rgba(255, 255, 255, 0.06);
          color: #F1F7F7;
        }
        .nav-subitem.active {
          background: rgba(24, 154, 211, 0.15);
          color: #189AD3;
          font-weight: 600;
        }

        .sidebar-usuario {
          padding: 9px 14px;
          height: 40px; box-sizing: border-box;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(0, 0, 0, 0.1);
          flex: 0 0 auto;
        }
        .su-info { flex: 1; min-width: 0; }
        .su-acoes { display: flex; flex-direction: row; gap: 8px; flex: 0 0 auto; }
        .su-label {
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgba(232, 237, 233, 0.5);
          font-weight: 600;
          margin-bottom: 1px;
        }
        .su-nome {
          font-size: 12px;
          color: #F1F7F7;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .su-logout {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: rgba(232, 237, 233, 0.75);
          width: 22px;
          height: 22px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 11px;
          transition: background-color 120ms, color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms, opacity 120ms;
        }
        .su-logout:hover {
          background: rgba(24, 154, 211, 0.18);
          color: #189AD3;
          border-color: #189AD3;
        }
        .su-sistema {
          flex: 0 0 auto;
          background: transparent;
          border: 1px solid rgba(184, 150, 90, 0.45);
          color: #D9B981;
          width: 22px; height: 22px;
          border-radius: 6px; cursor: pointer; font-size: 11px;
          display: flex; align-items: center; justify-content: center;
          transition: background-color 120ms, color 120ms, border-color 120ms;
        }
        .su-sistema i { transition: transform 200ms ease; }
        .su-sistema:hover {
          background: rgba(184, 150, 90, 0.18);
          color: #E8C98A; border-color: #B8965A;
        }
        .su-sistema:hover i { transform: rotate(60deg); }

        /* ===== RAIL COLAPSÁVEL (abre/fecha clicando no logo) ===== */
        .sidebar {
          position: fixed;
          left: 12px; top: 8px;
          width: 44px;
          height: calc(100vh - 16px);
          z-index: 50;
          overflow: visible;            /* deixa o tooltip "flutuar" pra fora */
          border-radius: 999px;         /* V334: cápsula flutuante, pontas 100% redondas */
          background: var(--sb-bg, #00003D);   /* V700: fundo por token (ATLAS/Externo) */
          box-shadow: 0 20px 44px rgba(0, 0, 40, 0.42);
          border: 1px solid rgba(255, 255, 255, 0.05);
          transition: width 0.26s cubic-bezier(0.22, 1, 0.36, 1), border-radius 0.26s cubic-bezier(0.22, 1, 0.36, 1);
          will-change: width;
        }
        body.rail-aberto .sidebar {
          width: 220px;
          border-radius: 26px;          /* expandida: cantos arredondados (não cápsula) */
          overflow: hidden;
        }
        body.rail-aberto .sidebar-nav { overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.18) transparent; }
        body.rail-aberto .sidebar-nav::-webkit-scrollbar { width: 5px; }
        body.rail-aberto .sidebar-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 5px; }
        body.rail-aberto .sidebar-nav::-webkit-scrollbar-track { background: transparent; }
        /* V340/341: durante a animação o texto é CORTADO pelo overflow do item/brand
           (nunca quebra) e se revela/some deslizando conforme a barra alarga/estreita.
           overflow do item está no base .nav-item; aqui só o brand. */
        .sidebar-brand { overflow: hidden; }
        .nav-label { white-space: nowrap; flex: 0 0 auto; }
        .brand-full, .brand-sub { white-space: nowrap; }
        /* abertura do rail: o conteúdo desliza via TRANSFORM (GPU, sem
           reflow = suave). V495: restaurado o deslize — com a barra de 288px
           o conteúdo ficava COBERTO (título/filtros atrás da barra).
           122px = metade do crescimento (300-56), mantém o conteúdo
           equilibrado nos dois estados. */
        /* V701: o deslize do conteúdo virou FLIP em App._alternarRail — sem
           transform permanente (o translateX(122px) fixo desalinhava o layout
           aberto e cortava a borda direita). */

        /* V700 (17C): aberto = painel recuado empilhado (altura livre);
           colapsado = a faixa de 64px de sempre com o globo. */
        .sidebar-brand { text-align: center; cursor: pointer; user-select: none;
          padding: 0; box-sizing: border-box; display: block; }
        .sidebar-brand:hover .brand-mini { transform: scale(1.12); }
        /* V350: no menu colapsado, globo encostado mais no topo da cápsula */
        body:not(.rail-aberto) .sidebar-brand { height: 64px; padding: 4px 8px 0;
          display: flex; flex-direction: column; align-items: center; justify-content: flex-start; }
        .brand-mini {
          display: none; font-size: 26px; line-height: 1;
          width: 1.35em; height: 1.35em;
          /* V951: sem background-image — a marca é o <img> filho (mesmo
             arquivo do menu aberto, assets/atlas-mark.png) */
          filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.30));
          transition: transform 0.18s ease;
        }
        .brand-mini img { display: block; width: 100%; height: 100%; object-fit: contain; }
        .brand-mini svg { display: block; width: 1em; height: 1em; }

        .sidebar-nav { padding: 8px 10px; }
        .nav-item, .nav-item-grupo {
          white-space: nowrap; position: relative; overflow: hidden;
          transition: background 0.14s, transform 0.16s, box-shadow 0.16s;
        }
        .nav-item .icon { flex: 0 0 auto; font-size: 17px; }
        .nav-item:hover { transform: translateY(-1px); }

        .su-avatar {
          flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
          background: #1EBBD7;
          color: #003A54; font-weight: 800; font-size: 12px;
          display: flex; align-items: center; justify-content: center;
          transition: transform 0.16s ease, box-shadow 0.16s ease;
        }
        .su-avatar-acao { cursor: pointer; }
        .su-avatar-acao:hover { transform: scale(1.12); box-shadow: 0 0 10px rgba(30, 187, 215, 0.6); }
        /* colapsado: avatar 'A' centralizado no eixo horizontal e colado no fundo da cápsula */
        body:not(.rail-aberto) .sidebar-usuario { justify-content: center; align-items: flex-end; padding: 0 0 5px 0; }
        .nav-section-title { margin-top: 14px; white-space: nowrap; }

        /* ---- estado COLAPSADO (padrão: sem rail-aberto) ---- */
        body:not(.rail-aberto) .brand-full,
        body:not(.rail-aberto) .brand-sub,
        body:not(.rail-aberto) .su-info,
        body:not(.rail-aberto) .su-logout,
        body:not(.rail-aberto) .su-sistema,
        body:not(.rail-aberto) .su-acoes,
        body:not(.rail-aberto) .nav-subgrupo,
        body:not(.rail-aberto) .seta { display: none; }
        body:not(.rail-aberto) .brand-mini { display: block; }
        /* V338: SEM justify-content:center no colapsado. Agora ícone e avatar
           ficam no MESMO X (centro da cápsula = 27px) em ambos os estados, via
           flex-start + padding-left fixo (definidos no bloco MENU COMPACTO).
           Assim não pulam ao abrir/fechar e ficam de fato centralizados. */
        /* V339: nav colapsado usa o MESMO fluxo do aberto (block, de cima pra
           baixo) e o ícone NÃO muda de tamanho. Assim os ícones ficam na MESMA
           posição (vertical e horizontal) ao abrir/fechar — só os textos surgem. */
        body:not(.rail-aberto) .nav-section-title {
          color: transparent; overflow: hidden;
        }
        /* hover flutuante do ícone (colapsado) */
        body:not(.rail-aberto) .nav-item { border-radius: 12px; }
        body:not(.rail-aberto) .nav-item:hover {
          background: rgba(24, 154, 211, 0.16);
          transform: translateY(-2px) scale(1.06);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22);
        }
        body:not(.rail-aberto) .nav-item:hover .icon {
          color: #7BE8C8; text-shadow: 0 0 10px rgba(24, 154, 211, 0.5);
        }
        /* V341: no colapsado o label fica INLINE (cortado pelo overflow do item =
           invisível). A tooltip só aparece no HOVER: o item libera o overflow e o
           label vira pílula flutuante à direita. Assim, ao FECHAR, o label some
           deslizando (igual ao abrir) em vez de "pular pra fora" como pílula. */
        body:not(.rail-aberto) .nav-item:hover { overflow: visible; }
        body:not(.rail-aberto) .nav-item:hover .nav-label {
          position: absolute; left: calc(100% + 12px); top: 50%;
          transform: translateY(-50%);
          background: #2A2D2A; color: #F1F7F7;
          padding: 6px 11px; border-radius: 8px;
          font-size: 12.5px; font-weight: 600;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
          pointer-events: none; z-index: 60;
          animation: navTipIn 0.16s ease-out;
        }
        @keyframes navTipIn {
          from { opacity: 0; transform: translateY(-50%) translateX(-6px); }
          to   { opacity: 1; transform: translateY(-50%) translateX(0); }
        }

        /* ===== ativo: brilho teal suave + barrinha de contraste no fim ===== */
        .nav-subitem { position: relative; }
        .nav-item.active, .nav-subitem.active { background: #1EBBD7; color: #F1F7F7; }
        .nav-item.active { font-weight: 700; }
        /* brilho suave (teal padrão ATLAS) */
        .nav-item.active::after,
        .nav-subitem.active::after {
          content: ''; position: absolute; z-index: -1; pointer-events: none;
          right: 0; top: 50%; transform: translateY(-50%);
          width: 48%; height: 106%; border-radius: 14px;
          background: radial-gradient(100% 82% at 100% 50%,
                      rgba(24, 154, 211, 0.30) 0%,
                      rgba(24, 154, 211, 0.10) 38%,
                      transparent 66%);
          animation: navGlowIn 0.4s ease-out;
        }
        /* barrinha de contraste no final (dourado ATLAS) */
        .nav-item.active::before,
        .nav-subitem.active::before {
          content: ''; position: absolute; right: 0; top: 50%;
          transform: translateY(-50%);
          width: 3px; height: 58%; border-radius: 3px;
          background: #F5F2EC; z-index: 1; pointer-events: none;
          box-shadow: 0 0 8px rgba(255, 255, 255, 0.75), 0 0 3px rgba(255, 255, 255, 0.9);
          animation: navBarIn 0.4s ease-out;
        }
        /* V335: no COLAPSADO o ativo é um quadradinho verde CENTRALIZADO e luminoso —
           sem a barrinha/glow lateral (que ficavam deslocados no formato cápsula). */
        body:not(.rail-aberto) .nav-item.active::before,
        body:not(.rail-aberto) .nav-item.active::after,
        body:not(.rail-aberto) .nav-subitem.active::before,
        body:not(.rail-aberto) .nav-subitem.active::after { display: none; }
        body:not(.rail-aberto) .nav-item.active {
          box-shadow: 0 0 16px rgba(30, 187, 215, 0.55), 0 6px 14px rgba(0, 0, 0, 0.20);
        }
        @keyframes navGlowIn {
          0%   { opacity: 0; transform: translateY(-50%) translateX(12px); }
          100% { opacity: 1; transform: translateY(-50%) translateX(0); }
        }
        @keyframes navBarIn {
          0%   { opacity: 0; transform: translateY(-50%) scaleY(0.3); }
          100% { opacity: 1; transform: translateY(-50%) scaleY(1); }
        }

        /* ===== MENU COMPACTO (~75% — só o menu; conteúdo fica 100%) ===== */
        .sidebar { width: 44px; padding-top: 16px; }
        body.rail-aberto .sidebar { width: 220px; }
        .sidebar-brand h1 { font-size: 27px; margin-bottom: 6px; }
        .sidebar-brand p { font-size: 8px; }
        .brand-mini { font-size: 24px; }
        .sidebar-nav { padding: 6px 8px; }
        /* V348: método à prova de bala — o .nav-inner tem min-height:100% e
           centraliza (justify-content:center) quando o conteúdo CABE; quando a
           lista passa da altura (Desempenho aberto), o inner cresce e o menu ROLA
           a partir do TOPO dentro da barra, sem nunca cortar. */
        .nav-inner {
          min-height: 100%;
          display: flex; flex-direction: column; justify-content: center;
          box-sizing: border-box;
        }
        .nav-section-title { font-size: 8px; padding: 9px 9px 5px; }
        .nav-item { font-size: 11px; gap: 9px; padding: 8px 6.5px; justify-content: flex-start; }
        .nav-item .icon { font-size: 15px; width: 15px; height: 15px; }
        .nav-subitem { font-size: 9.5px; padding: 5px 9px; }
        .su-avatar { width: 30px; height: 30px; font-size: 13px; }
        .sidebar-usuario { padding: 10px 12px 0px 7px; justify-content: flex-start; }
        .nav-item-grupo .seta { right: 10px; font-size: 8px; }

        /* ================================================================
           V494 — BARRA DE MENU (design handoff Claude Design "Sidebar ATLAS")
           Camada final da cascata: só VISUAL. Comportamentos (recolher,
           permissões, tooltips, grupos) permanecem os das regras acima.
           Paleta: fundo #0a1120 · texto #9fb4cd/#eaf4ff · acento #38bdf8
           · indicador #22d3ee · seções #48607e · tipografia Manrope.
           ================================================================ */
        .sidebar {
          background: #0a1120;
          border: 1px solid rgba(120, 160, 220, .08);
          box-shadow: 0 24px 60px -20px rgba(10, 20, 40, .55);
          font-family: 'Manrope', 'Poppins', 'Inter Tight', sans-serif;
        }
        body.rail-aberto .sidebar { width: 288px; border-radius: 24px; }

        /* V700 (17C): cabeçalho = painel recuado empilhado (marca + segmentado);
           a altura é livre — o painel dita o tamanho. */
        .sidebar-brand {
          display: block; text-align: left; padding: 0;
          border-bottom: none; height: auto;
        }
        .brand-mark { width: 44px; height: 44px; object-fit: contain; display: block; flex: 0 0 auto; }
        .brand-texto { min-width: 0; }
        .sidebar-brand .brand-nome {
          font: 800 20px 'Manrope', sans-serif; letter-spacing: .14em;
          color: #eaf4ff; margin: 0; line-height: 1.2;
        }
        .sidebar-brand .brand-sub {
          font: 700 8px 'Manrope', sans-serif; letter-spacing: .24em;
          color: #38bdf8; margin: 0; text-transform: uppercase;
          display: block; white-space: nowrap;
        }
        .sidebar-brand:hover .brand-mark { transform: scale(1.08); transition: transform .18s ease; }
        /* colapsado: a marca vira o logo pequeno centralizado (V951: <img>
           dentro do .brand-mini — a regra de background-image saiu) */
        body:not(.rail-aberto) .sidebar-brand { justify-content: center; padding: 4px 0 0; }
        body:not(.rail-aberto) .brand-mark, body:not(.rail-aberto) .brand-texto { display: none; }

        /* Seções */
        .nav-section-title {
          font: 800 10px 'Manrope', sans-serif; letter-spacing: .18em;
          color: #48607e; text-transform: uppercase;
        }
        body.rail-aberto .sidebar-nav { padding: 8px 16px; }

        /* Itens principais */
        .nav-item, .nav-item-grupo {
          gap: 13px; padding: 11px 12px; border-radius: 10px;
          color: #9fb4cd; font: 600 15px 'Manrope', sans-serif;
        }
        .nav-item .icon { font-size: 19px; width: 19px; height: 19px; color: inherit; }
        body.rail-aberto .nav-item:hover {
          background: transparent; color: #eaf4ff; transform: none; box-shadow: none;
        }
        .nav-item.active {
          background: rgba(56, 189, 248, .08); color: #eaf4ff; font-weight: 700;
        }
        .nav-item.active .icon { color: #38bdf8; }
        /* indicador: barrinha ciano à ESQUERDA (substitui barrinha dourada + glow à direita) */
        .nav-item.active::after, .nav-subitem.active::after { display: none; }
        .nav-item.active::before, .nav-subitem.active::before {
          content: ''; position: absolute; left: 2px; right: auto; top: 50%;
          transform: translateY(-50%);
          width: 3px; height: 55%; border-radius: 99px;
          background: #22d3ee; box-shadow: none; z-index: 1; pointer-events: none;
          animation: navBarIn 0.3s ease-out;
        }

        /* Grupo Desempenho aberto */
        .nav-item-grupo.aberto { color: #eaf4ff; background: rgba(56, 189, 248, .08); }
        .nav-item-grupo.aberto .icon { color: #38bdf8; }
        .nav-item-grupo .seta { color: #48607e; opacity: 1; }

        /* Subitens */
        .nav-subgrupo { margin-left: 22px; padding-left: 10px; border-left: none; }
        .nav-subitem {
          padding: 8px 12px; border-radius: 8px;
          font: 600 13.5px 'Manrope', sans-serif; color: #7c93af;
        }
        .nav-subitem:hover { background: transparent; color: #dbe8f5; }
        .nav-subitem.active {
          background: transparent; color: #22d3ee; font-weight: 700;
        }
        .nav-subitem.active::before { left: -10px; }

        /* Card do usuário (rodapé) */
        body.rail-aberto .sidebar-usuario {
          margin: 0 12px 12px; padding: 14px 14px; height: auto;
          border-radius: 14px; border-top: none;
          background: rgba(255, 255, 255, .04);
        }
        .su-avatar {
          width: 38px; height: 38px; border-radius: 11px;
          background: linear-gradient(135deg, #22d3ee, #3b82f6);
          color: #04121f; font: 800 15px 'Manrope', sans-serif;
        }
        .su-nome { font: 700 14px 'Manrope', sans-serif; color: #eaf4ff; }
        .su-cargo { font: 600 11px 'Manrope', sans-serif; color: #5b7a9c; }
        .su-sair {
          flex: 0 0 auto; background: transparent; border: none; cursor: pointer;
          color: #5b7a9c; font-size: 17px; padding: 4px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          transition: color 140ms;
        }
        .su-sair:hover { color: #eaf4ff; }
        body:not(.rail-aberto) .su-sair { display: none; }
        /* V495: na cápsula recolhida o avatar volta a ser REDONDO — o quadrado
           arredondado colado na ponta 100% redonda destoava do formato. */
        body:not(.rail-aberto) .su-avatar { border-radius: 50%; }

        /* V497: recolhido — ícone perfeitamente CENTRALIZADO e rótulo 100%
           oculto. Antes o padding/gap do estado expandido (V494) vazava pro
           recolhido: o ícone saía do centro e a 1ª letra do rótulo aparecia
           ao lado, parecendo um ícone "quebrado". O centro do ícone fica em
           ~22px nos DOIS estados, então ele não "pula" ao abrir/fechar. */
        body:not(.rail-aberto) .nav-item,
        body:not(.rail-aberto) .nav-item-grupo {
          justify-content: center; padding: 9px 0; gap: 0;
        }
        body:not(.rail-aberto) .nav-label { display: none; }
        body:not(.rail-aberto) .nav-item:hover .nav-label { display: block; }
        /* V498: recolhido — ícones e avatar menores (mais "slim" na cápsula) */
        body:not(.rail-aberto) .nav-item .icon {
          font-size: 15px; width: 15px; height: 15px;
        }
        body:not(.rail-aberto) .su-avatar {
          width: 28px; height: 28px; font-size: 12px;
        }
        /* V951: 34px (cabe na cápsula de 44px) — mais perto dos 40px do menu aberto */
        body:not(.rail-aberto) .brand-mini { font-size: 22px; width: 34px; height: 34px; }

        /* V496: recolhido — ícones distribuídos UNIFORMEMENTE pela cápsula.
           Antes, os títulos de seção ficavam transparentes mas OCUPANDO espaço
           e o conteúdo era centralizado — resultado: um buraco grande abaixo
           do logo e vãos irregulares entre os grupos de ícones. */
        body:not(.rail-aberto) .nav-section-title { display: none; }
        body:not(.rail-aberto) .nav-inner { justify-content: space-evenly; }
        body:not(.rail-aberto) .nav-item { margin: 0; }

        /* V495: no recolhido, o grupo "aberto" NÃO acende — só o item ATIVO
           brilha (nos prints, home + gráfico acesos pareciam dupla seleção). */
        body:not(.rail-aberto) .nav-item-grupo.aberto:not(.active) {
          background: transparent;
        }
        body:not(.rail-aberto) .nav-item-grupo.aberto:not(.active) .icon { color: inherit; }

        /* Colapsado: ativo e hover na paleta nova */
        body:not(.rail-aberto) .nav-item.active {
          background: rgba(56, 189, 248, .16);
          box-shadow: 0 0 16px rgba(34, 211, 238, .45), 0 6px 14px rgba(0, 0, 0, .20);
        }
        body:not(.rail-aberto) .nav-item:hover {
          background: rgba(56, 189, 248, .14);
        }
        body:not(.rail-aberto) .nav-item:hover .icon {
          color: #7dd3fc; text-shadow: 0 0 10px rgba(56, 189, 248, .5);
        }
        /* ================================================================
           V499 — Barra EXPANDIDA mais SLIM como um todo: largura 240px
           (era 288), tipografia/ícones menores, espaçamentos mais justos.
           ================================================================ */
        body.rail-aberto .sidebar { width: 240px; border-radius: 20px; }
        /* V700 (17C): o cabeçalho é o painel recuado — altura LIVRE (nada de
           height fixo aqui; o corte do segmentado vinha desta regra V499). */
        .sidebar-brand { height: auto; padding: 0; }
        .brand-mark { width: 34px; height: 34px; }
        .sidebar-brand .brand-nome { font-size: 16px; }
        .sidebar-brand .brand-sub { font-size: 8px; letter-spacing: .18em; }
        body.rail-aberto .sidebar-nav { padding: 4px 12px; }
        .nav-section-title { font-size: 9px; padding: 8px 8px 4px; margin-top: 10px; }
        .nav-item, .nav-item-grupo {
          gap: 10px; padding: 8px 10px; border-radius: 9px; font-size: 13px;
        }
        .nav-item .icon { font-size: 16px; width: 16px; height: 16px; }
        .nav-subgrupo { margin-left: 18px; padding-left: 8px; }
        .nav-subitem { padding: 6px 10px; font-size: 12px; }
        body.rail-aberto .sidebar-usuario { margin: 0 10px 10px; padding: 10px 12px; gap: 9px; }
        .su-avatar { width: 30px; height: 30px; border-radius: 9px; font-size: 12px; }
        .su-nome { font-size: 12.5px; }
        .su-cargo { font-size: 10px; }
        .su-sair { font-size: 15px; }
        /* V701: o translateX(98px) permanente saiu — ele deslocava o layout
           aberto pra fora da tela (cortava a borda direita). O deslize agora é
           FLIP em App._alternarRail; o estado final é só layout (padding). */

        /* V495: scrollbar do menu mais discreta na paleta nova */
        body.rail-aberto .sidebar-nav { scrollbar-color: rgba(120, 160, 220, .22) transparent; }
        body.rail-aberto .sidebar-nav::-webkit-scrollbar { width: 4px; }
        body.rail-aberto .sidebar-nav::-webkit-scrollbar-thumb { background: rgba(120, 160, 220, .22); }

        /* pílula do tooltip (hover colapsado) */
        body:not(.rail-aberto) .nav-item:hover .nav-label {
          background: #0f1a2e; color: #eaf4ff;
          border: 1px solid rgba(120, 160, 220, .14);
          font-family: 'Manrope', sans-serif;
        }
      </style>
    `;

    // Eventos de navegação - apenas para nav-item que tem data-tela
    document.querySelectorAll('.nav-item[data-tela]').forEach(btn => {
      btn.addEventListener('click', () => this.navegarPara(btn.dataset.tela));
    });

    // V700: segmentado ATLAS | Externo (handoff 17C) — o clique num lado troca a
    // base; não pode abrir/recolher o rail. Setas ←→ alternam com foco nele.
    const segExt = document.getElementById('modo-externo-switch');
    if (segExt) {
      segExt.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.target.closest('.seg-btn');
        if (!btn) return;
        this.setModoExterno(btn.dataset.modo === 'ext', { navegar: true });
      });
      segExt.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault(); e.stopPropagation();
        this.setModoExterno(e.key === 'ArrowRight', { navegar: true });
      });
    }

    // Eventos dos subitens
    document.querySelectorAll('.nav-subitem').forEach(btn => {
      btn.addEventListener('click', () => this.navegarPara(btn.dataset.tela));
    });

    // Botões da barra fixa de importação (topo)
    document.querySelectorAll('.idock-btn[data-tela]').forEach(btn => {
      btn.addEventListener('click', () => this.navegarPara(btn.dataset.tela));
    });

    // Dropdown "Cadastros" do dock (abre em cascata pra baixo)
    const cadDrop = document.getElementById('idock-cadastros');
    const cadDropBtn = document.getElementById('idock-cadastros-btn');
    if (cadDrop && cadDropBtn) {
      cadDropBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const abrir = !cadDrop.classList.contains('aberto');
        cadDrop.classList.toggle('aberto', abrir);
        cadDropBtn.setAttribute('aria-expanded', abrir ? 'true' : 'false');
      });
      cadDrop.querySelectorAll('.idock-menu-item[data-tela]').forEach(it => {
        it.addEventListener('click', (e) => {
          e.stopPropagation();
          cadDrop.classList.remove('aberto');
          cadDropBtn.setAttribute('aria-expanded', 'false');
          this.navegarPara(it.dataset.tela);
        });
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#idock-cadastros')) {
          cadDrop.classList.remove('aberto');
          cadDropBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Grupo "Desempenho" — expande/recolhe ao clicar (não navega, é só container)
    const grupoDesemp = document.getElementById('grupo-desempenho');
    if (grupoDesemp) {
      grupoDesemp.addEventListener('click', () => {
        // Desempenho tem submenu → garante o rail aberto pra mostrar os itens
        const railFechado = !document.body.classList.contains('rail-aberto');
        if (railFechado) {
          document.body.classList.add('rail-aberto');
          localStorage.setItem('rail_aberto', '1');
        }
        // se acabou de abrir o rail, abre o submenu; senão alterna normalmente
        const aberto = railFechado ? true : grupoDesemp.classList.toggle('aberto');
        grupoDesemp.classList.toggle('aberto', aberto);
        document.getElementById('subitens-desempenho').classList.toggle('aberto', aberto);
      });

      // V966: por regra o grupo SEMPRE nasce ABERTO (inverte a V948, que o
      // trazia fechado). Nada é persistido: o clique alterna só na sessão e a
      // próxima abertura volta aberto (chave antiga do localStorage descartada).
      try { localStorage.removeItem('grupo_desempenho_aberto'); } catch (_) {}
      grupoDesemp.classList.add('aberto');
      const subDesemp = document.getElementById('subitens-desempenho');
      if (subDesemp) subDesemp.classList.add('aberto');
    }

    // V287: engrenagem → módulo SISTEMA (master-only)
    const btnSis = document.getElementById('btn-sidebar-sistema');
    if (btnSis) btnSis.addEventListener('click', () => App.navegarPara('sistema'));
    // V343: clicar no círculo 'A' abre as Configurações/Sistema (os botões de
    // engrenagem/sair foram removidos do rodapé). Gate pela permissão real.
    const avSis = document.getElementById('su-avatar');
    if (avSis && Auth.podeAcessar('sistema')) {
      avSis.classList.add('su-avatar-acao');
      avSis.title = 'Configurações do sistema';
      avSis.addEventListener('click', () => App.navegarPara('sistema'));
    }

    // Abrir/recolher o rail (só por clique)
    const railToggle = document.getElementById('sidebar-toggle');
    if (railToggle) {
      railToggle.addEventListener('click', () => this._alternarRail());
    }
    if (localStorage.getItem('rail_aberto') === '1') document.body.classList.add('rail-aberto');

    // Clicar no conteúdo (fora do menu) recolhe o rail
    document.addEventListener('click', (e) => {
      if (!document.body.classList.contains('rail-aberto')) return;
      if (e.target.closest('.sidebar')) return;   // cliques dentro do menu não fecham
      this._alternarRail(false);
    });
  },

  /**
   * V858: pinta o carimbo de versão do rodapé do menu. Quando o banco aberto já
   * rodou num pacote MAIS NOVO (o caso do Matheus abrindo o .db do Pedro), o
   * aviso fica FIXO na tela — o toast que existia antes nascia atrás da tela de
   * login e expirava enquanto o usuário digitava a senha, justamente no momento
   * em que ele mais precisava do aviso.
   */
  pintarVersao() {
    const el = document.querySelector('.sidebar-versao');
    if (!el) return;
    const pacote = (window.ATLAS_VERSAO || {}).pacote || 'versão não identificada';
    const atrasada = Number(window.Banco && window.Banco._versaoAtrasada) || 0;
    if (!atrasada) {
      el.classList.remove('atrasada');
      el.textContent = pacote;
      el.title = 'Versão do pacote em uso nesta máquina';
      return;
    }
    el.classList.add('atrasada');
    el.textContent = `⚠ ${pacote} · desatualizado (banco já rodou no v202_${atrasada})`;
    el.title = `Este banco já foi usado na versão v202_${atrasada} da ferramenta, e esta `
      + `máquina está no ${pacote}. Peça o pacote atualizado antes de trabalhar: `
      + `no pacote antigo as regras novas não existem, e o cálculo pode sair diferente.`;
  },

  /**
   * V701: abre/recolhe o rail com FLIP — o padding do shell muda de uma vez
   * (UM relayout) e o conteúdo desliza por TRANSFORM puro (GPU). Antes, o
   * padding-left era animado (relayout da página inteira a cada frame — a
   * "travada" nas telas pesadas) e o .main ainda carregava um translateX(122px)
   * permanente que desalinhava o layout aberto (cortava a borda direita).
   */
  _alternarRail(forcar) {
    const abrir = (forcar !== undefined) ? !!forcar : !document.body.classList.contains('rail-aberto');
    if (abrir === document.body.classList.contains('rail-aberto')) return;
    const main = document.querySelector('.main');
    const antes = main ? main.getBoundingClientRect().left : 0;
    document.body.classList.toggle('rail-aberto', abrir);
    localStorage.setItem('rail_aberto', abrir ? '1' : '0');
    if (!main) return;
    const delta = antes - main.getBoundingClientRect().left;
    if (!delta) return;
    clearTimeout(this._railFlipTmr);
    main.style.transition = 'none';
    main.style.transform = `translateX(${delta}px)`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      main.style.transition = 'transform 0.26s cubic-bezier(0.22, 1, 0.36, 1)';
      main.style.transform = '';
      this._railFlipTmr = setTimeout(() => { main.style.transition = ''; }, 300);
    }));
  },

  /**
   * Aplica as permissões: esconde itens do menu não permitidos.
   * Chamado depois do login e também quando o admin altera permissões.
   */
  _aplicarPermissoesMenu() {
    document.querySelectorAll('.nav-item[data-tela]').forEach(btn => {
      const modulo = btn.dataset.tela;
      // Administração é sempre visível para quem está logado
      if (modulo === 'administracao') {
        btn.style.display = '';
        return;
      }
      btn.style.display = Auth.podeAcessar(modulo) ? '' : 'none';
    });

    // Aplica permissões também aos subitens
    document.querySelectorAll('.nav-subitem').forEach(btn => {
      const modulo = btn.dataset.tela;
      btn.style.display = Auth.podeAcessar(modulo) ? '' : 'none';
    });

    // Barra de importação: esconde botão sem acesso; some a barra se nenhum visível
    document.querySelectorAll('.idock-btn[data-tela]').forEach(btn => {
      btn.style.display = Auth.podeAcessar(btn.dataset.tela) ? '' : 'none';
    });
    const topbar = document.getElementById('topbar-import');
    if (topbar) {
      // Itens do menu "Cadastros": esconde os sem acesso
      const itensCad = [...topbar.querySelectorAll('.idock-menu-item[data-tela]')];
      itensCad.forEach(it => { it.style.display = Auth.podeAcessar(it.dataset.tela) ? '' : 'none'; });
      const temCadastro = itensCad.some(it => it.style.display !== 'none');
      const drop = topbar.querySelector('.idock-drop');
      if (drop) drop.style.display = temCadastro ? '' : 'none';
      // Importações soltas (QVIS / PRODUÇÃO)
      const IMPORT_TELAS = ['importar-qvis', 'importar-producao'];
      const temImport = [...topbar.querySelectorAll('.idock-btn[data-tela]')]
        .some(b => IMPORT_TELAS.includes(b.dataset.tela) && b.style.display !== 'none');
      // Separador some se um dos grupos ficar sem nada visível
      const sep = topbar.querySelector('.idock-sep');
      if (sep) sep.style.display = (temImport && temCadastro) ? '' : 'none';
      topbar.style.display = (temImport || temCadastro) ? '' : 'none';
    }

    // Se TODOS os subitens de Desempenho estão escondidos, esconde o grupo todo
    const grupo = document.getElementById('grupo-desempenho');
    if (grupo) {
      const subs = document.querySelectorAll('.nav-subitem');
      let temSubVisivel = false;
      subs.forEach(s => {
        if (s.dataset.tela.startsWith('desempenho-') && s.style.display !== 'none') {
          temSubVisivel = true;
        }
      });
      grupo.style.display = temSubVisivel ? '' : 'none';
      document.getElementById('subitens-desempenho').style.display = temSubVisivel ? '' : 'none';
    }

    // Esconde seções inteiras se todos seus itens estão escondidos
    document.querySelectorAll('.sidebar-nav .nav-section-title').forEach(titulo => {
      let proximo = titulo.nextElementSibling;
      let temVisivel = false;
      while (proximo && (proximo.classList.contains('nav-item') || proximo.classList.contains('nav-subgrupo'))) {
        if (proximo.style.display !== 'none') {
          temVisivel = true;
          break;
        }
        proximo = proximo.nextElementSibling;
      }
      titulo.style.display = temVisivel ? '' : 'none';
    });
  },

  // V287: alvo de render. Dentro do módulo SISTEMA, as telas Backup/Administração
  // renderizam no painel interno (abas); fora dele, no #conteudo normal.
  alvoConteudo() {
    if (this._alvoSistemaAtivo) {
      const p = document.getElementById('sistema-painel');
      if (p) return p;
    }
    return document.getElementById('conteudo');
  },

  /**
   * V699: MODO EXTERNO — o switch ao lado da marca ATLAS troca a ferramenta de
   * "modo normal" para o layout do módulo Externos (analogia do botão sport de
   * um carro: mesma máquina, outra pele e outro painel).
   */
  setModoExterno(ligar, opts = {}) {
    const mudou = document.body.classList.contains('modo-externo') !== !!ligar;
    document.body.classList.toggle('modo-externo', !!ligar);
    try { localStorage.setItem('atlas_modo_externo', ligar ? '1' : '0'); } catch (_) {}
    // V700: o lado ativo do segmentado é preenchido (aria acompanha)
    document.querySelectorAll('#modo-externo-switch .seg-btn').forEach(b => {
      const ativo = (b.dataset.modo === 'ext') === !!ligar;
      b.classList.toggle('ativo', ativo);
      b.setAttribute('aria-selected', ativo ? 'true' : 'false');
    });
    if (opts.navegar) {
      // V705: a Visão Geral externa está em construção — o modo aterrissa no
      // 1º módulo (Importar Admissões) até ela ser estruturada.
      this.navegarPara(ligar ? 'externos-importar' : 'dashboard');
    } else if (mudou && !ligar && String(this.telaAtual).startsWith('externos')) {
      this.navegarPara('dashboard');
    }
  },

  navegarPara(tela) {
    this._alvoSistemaAtivo = false;
    // V699: cair numa tela do módulo Externos liga o modo (e vice-versa não —
    // no modo externo os cadastros normais continuam acessíveis).
    if (String(tela).startsWith('externos') && !document.body.classList.contains('modo-externo')) {
      this.setModoExterno(true);
    }
    // Bloqueia acesso a módulos não permitidos
    if (!Auth.podeAcessar(tela)) {
      Utilidades.toast('Acesso não permitido a este módulo', 'error');
      tela = this._primeiraTelaPermitida();
    }

    // Limpa estados visuais residuais de outras telas
    document.body.classList.remove('lc-maximizado');
    // V490: FABs da Base Tabela (cadeado/histórico/versões) vivem em .main — somem ao sair da tela
    document.querySelectorAll('#bt-fab-cadeado, #bt-fab-historico, #bt-fab-versoes').forEach(el => el.remove());

    this.telaAtual = tela;
    // V935: a tela ativa vai pro <body> (CSS por tela, ex.: filtro congelado da Visão Geral)
    document.body.dataset.tela = tela;
    // V980: modais que moram no <body> (Controle de Notas) não sobrevivem à troca de tela
    document.querySelectorAll('body > .cn-modal-ov').forEach(e => e.remove());
    // V935: o .app-shell tem overflow-x:hidden, o que o torna "contêiner de rolagem"
    // e mata qualquer position:sticky da página. Na Visão Geral o CSS troca por
    // overflow-x:clip (recorta sem criar rolagem); em navegador sem suporte a
    // clip, libera o overflow só enquanto a Visão Geral está aberta.
    try {
      const shell = document.querySelector('.app-shell');
      if (shell && !(window.CSS && CSS.supports && CSS.supports('overflow-x', 'clip'))) {
        shell.style.overflowX = tela === 'dashboard' ? 'visible' : '';
      }
    } catch (_) {}

    // Atualiza estado visual da sidebar (itens principais)
    document.querySelectorAll('.nav-item[data-tela]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tela === tela);
    });

    // Atualiza estado visual dos sub-itens
    document.querySelectorAll('.nav-subitem').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tela === tela);
    });

    // Atualiza estado visual da barra de importação
    document.querySelectorAll('.idock-btn[data-tela]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tela === tela);
    });
    // Botão "Cadastros" acende se a tela atual for um dos cadastros; itens do menu idem
    const CAD_TELAS = ['base-tabela', 'medicos', 'unidades', 'de-para-nomes'];
    const cadBtnAtivo = document.getElementById('idock-cadastros-btn');
    if (cadBtnAtivo) cadBtnAtivo.classList.toggle('active', CAD_TELAS.includes(tela));
    document.querySelectorAll('.idock-menu-item[data-tela]').forEach(it => {
      it.classList.toggle('active', it.dataset.tela === tela);
    });

    // Se a tela é de desempenho, garante que o grupo está aberto (V966: por
    // regra o grupo já nasce aberto; isto só cobre o caso de o usuário tê-lo
    // recolhido e depois navegado para uma tela de desempenho)
    if (tela.startsWith('desempenho-')) {
      const grupo = document.getElementById('grupo-desempenho');
      const sub = document.getElementById('subitens-desempenho');
      if (grupo && sub) {
        grupo.classList.add('aberto');
        sub.classList.add('aberto');
      }
    }

    // Renderiza a tela — com a tela de loading nas telas pesadas (suaviza a travada)
    const renderizador = this.telas[tela];
    const exec = () => {
      if (renderizador) {
        renderizador();
      } else {
        this._renderizarTelaNaoImplementada(tela);
      }
    };
    const TELAS_PESADAS = new Set([
      'desempenho-opme', 'desempenho-lio', 'desempenho-lentes-contato',
      'desempenho-fracionamento', 'desempenho-laudos', 'desempenho-periodos',
      'desempenho-fellow', 'desempenho-refractive-laser',
      'desempenho-estrabismo',   // V734: entrava sem o visual de loading
      'calcular', 'base-tabela', 'producao-medica', 'de-para-nomes',
      'importar-qvis', 'importar-producao'
    ]);
    // O dashboard monta a si próprio de forma assíncrona (casca→spinner→cálculo).
    // Cedemos a thread ANTES de chamá-lo pra a barra lateral e os ícones
    // (webfont) pintarem primeiro — assim eles não somem enquanto ele carrega.
    if (tela === 'dashboard') {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(exec, 0)));
    } else if (TELAS_PESADAS.has(tela)) {
      Utilidades.comLoading(exec, 'Carregando', { semFundo: true });
    } else {
      exec();
    }
  },

  _renderizarTelaNaoImplementada(tela) {
    const titulos = {
      'importar-qvis':        'Importar QVIS',
      'calcular':             'Calcular Repasse',
      'pagamentos-externos':  'Pagamentos Externos',
      'auditoria':            'Auditoria',
      'gerenciais':           'Gerenciais',
      'relatorios':           'Relatórios',
      'controle-notas':       'Controle de Notas',
      'consolidacao':         'Consolidação',
      'desempenho-lio':              'LIO',
      'desempenho-opme':             'OPME',
      'desempenho-fellow':           'Fellow',
      'desempenho-fracionamento':    'Fracionamento',
      'desempenho-refractive-laser': 'Refractive Laser',
      'desempenho-periodos':         'Períodos',
      'desempenho-cargos':           'Cargos Administrativos',
      'desempenho-lentes-contato':   'Lentes de Contato',
      'desempenho-luz-pulsada':      'Luz Pulsada',
      'desempenho-estrabismo':       'Estrabismo',
      'desempenho-laudos':           'Laudos',
      'desempenho-crosslink':        'Crosslink',
    };

    const fases = {
      'importar-qvis':        'Fase 2',
      'calcular':             'Fase 2',
      'pagamentos-externos':  'Fase 3',
      'relatorios':           'Fase 5',
    };

    const ehDesempenho = tela.startsWith('desempenho-');

    // Telas que JÁ deveriam estar implementadas. Se cair aqui, é um sinal de
    // que o script da tela falhou ao carregar (erro de sintaxe ou exceção).
    const TELAS_QUE_DEVERIAM_EXISTIR = [
      'desempenho-cargos', 'desempenho-lentes-contato', 'importar-producao',
      'de-para-nomes', 'desempenho-opme',
    ];
    if (TELAS_QUE_DEVERIAM_EXISTIR.includes(tela)) {
      document.getElementById('conteudo').innerHTML = `
        <div class="page-content">
          <header class="page-header">
            <h2>${titulos[tela] || tela}</h2>
          </header>
          <div class="card" style="background: #FEE; border-color: #D88; padding: 20px">
            <h3 style="margin: 0 0 10px; color: #9B3A3A">⚠ Script da tela não carregou</h3>
            <p style="font-size: 13px; color: #4A1F1F; margin: 0 0 12px">
              O arquivo JavaScript desta tela <strong>foi carregado pelo navegador mas falhou silenciosamente</strong>
              antes de registrar a tela no app — provavelmente por um erro de sintaxe ou variável indefinida.
            </p>
            <div style="background: white; padding: 12px; border-radius: 8px; font-size: 12px; color: #4A1F1F">
              <strong>Como diagnosticar:</strong>
              <ol style="margin: 8px 0 0; padding-left: 20px; line-height: 1.6">
                <li>Pressione <strong>F12</strong> para abrir o console do navegador</li>
                <li>Clique na aba <strong>Console</strong></li>
                <li>Procure por mensagens em vermelho (erros)</li>
                <li>Recarregue a página com Ctrl+F5 e veja as mensagens iniciais</li>
                <li>Tire um <strong>print do console</strong> e me envie</li>
              </ol>
            </div>
            <div style="font-size: 11px; color: var(--ink-soft); margin-top: 10px">
              Tela esperada: <code>${tela}</code> · App.telas[tela] = <code>${typeof App.telas[tela]}</code>
            </div>
          </div>
        </div>
      `;
      return;
    }

    const fase = fases[tela] || (ehDesempenho ? 'a definir' : 'próxima fase');
    const subtitulo = ehDesempenho
      ? 'Módulo de desempenho — layout interno em construção'
      : 'Em construção';

    document.getElementById('conteudo').innerHTML = `
      <div class="page-content">
        <header class="page-header">
          <div>
            <h2>${titulos[tela] || tela}</h2>
            <div class="subtitle">${subtitulo}</div>
          </div>
        </header>
        <div class="card">
          <div class="empty-state">
            <div class="icon">⌛</div>
            <h3>Esta tela ainda não foi construída</h3>
            <p>Programada para <strong>${fase}</strong>. Vamos definir o layout interno deste módulo individualmente.</p>
          </div>
        </div>
      </div>
    `;
  },
};

// Bootstrap quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => App.iniciar());

window.App = App;

/* V734: o botão flutuante de tema claro/escuro (V356) foi REMOVIDO a pedido
   do usuário — a ferramenta opera só no tema claro. Higiene defensiva: se
   alguém ficou com a preferência 'escuro' salva de versões antigas, limpa. */
try { localStorage.removeItem('atlas_tema'); } catch (e) {}
document.body && document.body.classList.remove('tema-escuro');
