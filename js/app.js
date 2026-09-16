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
          <h2 style="color: #a15646">Erro ao inicializar</h2>
          <p>${e.message}</p>
          <div style="margin: 18px 0; display: flex; gap: 10px; flex-wrap: wrap">
            <button id="boot-tentar" style="padding: 9px 16px; border: 1px solid #46688c; background: #46688c; color: #fff; border-radius: 8px; cursor: pointer; font-size: 14px">↻ Tentar de novo</button>
            ${ehBanco && window.Banco && Banco.restaurarDeArquivo ? `
            <button id="boot-restaurar" style="padding: 9px 16px; border: 1px solid #46688c; background: #fff; color: #46688c; border-radius: 8px; cursor: pointer; font-size: 14px">Restaurar da cópia automática (.db)</button>
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
    // Navega para o primeiro módulo permitido
    try { localStorage.removeItem('atlas_modo_externo'); } catch (_) {}   // ATLAS v1.1: modo Externo não existe mais
    this.navegarPara(this._primeiraTelaPermitida());
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
          // ATLAS v1.2 (design 2A): marca do módulo — quadrado 34px arredondado na
          // cor de acento com o ícone do módulo — ao lado do título em Barlow
          // Condensed. O mesmo ícone do dock, para o olho ligar os dois.
          h.innerHTML = '<span class="tb-marca" aria-hidden="true"><i class="ti '
            + App._iconeDoModulo(App.telaAtual) + '"></i></span><span class="tb-texto"></span>';
          h.querySelector('.tb-texto').textContent = titulo;
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
        <!-- ATLAS v1.1: o menu lateral e a barra de importação saíram — a
             navegação é o FLOATING DOCK (embaixo, centralizado); aqui fica só
             a marca, com o carimbo de versão que o Banco confere. -->
        <header class="atlas-topo" id="atlas-topo">
          <img class="atlas-topo-marca" src="assets/atlas-mark.png" alt="ATLAS" draggable="false">
          <div class="atlas-topo-texto">
            <h1 class="brand-nome">ATLAS</h1>
            <p class="brand-sub">AUDITORIA DE CONTAS</p>
            <div class="atlas-versao" title="Versão do pacote em uso nesta máquina">${(window.ATLAS_VERSAO || {}).pacote || 'versão não identificada'}</div>
          </div>
        </header>

        <main class="main">
          <div id="conteudo"></div>
        </main>
      </div>

      ${this._dockMarkup()}
    `;

    try { localStorage.removeItem('rail_aberto'); } catch (_) {}   // chave do menu lateral antigo
    this._ligarDock();
  },

  // ──────────────────────────────────────────────────────────────────────
  // FLOATING DOCK (ATLAS v1.1) — réplica em JS/CSS puro do componente
  // "Floating Dock" (Aceternity): ícones redondos que CRESCEM conforme o
  // mouse se aproxima (±150px → 40..80px, ícone 20..40px), rótulo em cima ao
  // passar e, no celular, um botão que abre os itens em coluna. Sem React,
  // Tailwind ou motion — a ferramenta é offline e sem build; os ícones são
  // os mesmos Tabler, já vendorizados em libs/.
  //
  // O que aparece aqui é decisão do Pedro (16/09/2026): Visão Geral, Inspeção,
  // Auditoria, Relatórios · Importar Sistema (o QVIS) e Produção · Base
  // Tabela, Médicos, De-Para · Configurações. Gerenciais, Produção Médica,
  // Controle de Notas, Consolidação, Unidades e os 12 Desempenhos continuam
  // registrados em App.telas (a lógica fica), só não têm botão.
  // ATLAS v1.3: a ATLAS não faz repasse, audita — o CALCULAR saiu do dock e a
  // INSPEÇÃO (admissão + relatório final) entrou no lugar. O Calcular segue
  // registrado e suas regras rodam por baixo (AtlasCalcular.calcularESalvar).
  // ──────────────────────────────────────────────────────────────────────
  DOCK_ITENS: [
    { tela: 'dashboard',         titulo: 'Visão Geral',       icone: 'ti-home' },
    { tela: 'inspecao',          titulo: 'Inspeção',          icone: 'ti-zoom-check' },
    { tela: 'auditoria',         titulo: 'Auditoria',         icone: 'ti-clipboard-check' },
    { tela: 'relatorios',        titulo: 'Relatórios',        icone: 'ti-report' },
    { sep: true },
    { tela: 'importar-qvis',     titulo: 'Importar Sistema',  icone: 'ti-database-import' },
    { tela: 'importar-producao', titulo: 'Importar Produção', icone: 'ti-file-spreadsheet' },
    { sep: true },
    { tela: 'base-tabela',       titulo: 'Base Tabela',       icone: 'ti-table' },
    { tela: 'medicos',           titulo: 'Médicos',           icone: 'ti-stethoscope' },
    { tela: 'de-para-nomes',     titulo: 'De-Para de Nomes',  icone: 'ti-arrows-exchange' },
    { sep: true },
    { tela: 'sistema',           titulo: 'Configurações',     icone: 'ti-settings' },
  ],

  /** Ícone (Tabler) que identifica o módulo — no dock e na marca do título. */
  _iconeDoModulo(tela) {
    const d = (this.DOCK_ITENS || []).find(i => i.tela === tela);
    if (d) return d.icone;
    const extra = {
      calcular: 'ti-calculator',   // ATLAS v1.3: sem botão, mas com marca própria
      gerenciais: 'ti-adjustments', 'producao-medica': 'ti-layout-grid', 'controle-notas': 'ti-receipt',
      consolidacao: 'ti-lock-check', unidades: 'ti-building', backup: 'ti-database-export',
      administracao: 'ti-settings', 'balanco-retroativo': 'ti-flask',
    };
    if (extra[tela]) return extra[tela];
    if (String(tela || '').startsWith('desempenho-')) return 'ti-chart-bar';
    return 'ti-bolt';
  },

  _dockMarkup() {
    const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const itens = this.DOCK_ITENS.filter(i => !i.sep);
    const desktop = this.DOCK_ITENS.map(i => i.sep
      ? '<span class="dock-sep" aria-hidden="true"></span>'
      : `<button type="button" class="dock-item" data-tela="${esc(i.tela)}" aria-label="${esc(i.titulo)}">
           <span class="dock-tip" aria-hidden="true">${esc(i.titulo)}</span>
           <span class="dock-ico"><i class="ti ${esc(i.icone)}"></i></span>
         </button>`).join('');
    // no celular a coluna nasce de baixo para cima: o último item entra primeiro
    const mobile = itens.map((i, idx) =>
      `<button type="button" class="dock-mitem" data-tela="${esc(i.tela)}" title="${esc(i.titulo)}"
         aria-label="${esc(i.titulo)}" style="--i:${itens.length - 1 - idx}"><i class="ti ${esc(i.icone)}"></i></button>`).join('');
    return `
      <nav id="atlas-dock" class="atlas-dock" aria-label="Módulos da ATLAS">
        <div class="dock-desktop" id="dock-desktop">${desktop}</div>
        <div class="dock-mobile" id="dock-mobile">
          <div class="dock-mobile-itens" id="dock-mobile-itens" hidden>${mobile}</div>
          <button type="button" class="dock-mobile-toggle" id="dock-mobile-toggle" aria-label="Abrir os módulos" aria-expanded="false">
            <i class="ti ti-layout-navbar-collapse"></i>
          </button>
        </div>
      </nav>`;
  },

  _ligarDock() {
    const dock = document.getElementById('atlas-dock');
    if (!dock) return;
    dock.querySelectorAll('[data-tela]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._alternarDockMobile(false);
        this.navegarPara(btn.dataset.tela);
      });
    });

    // ── desktop: magnificação por distância do mouse (o efeito "dock do Mac") ──
    // Cada item mede a distância do centro dele ao mouse; a 0px vale 80px, a
    // 150px (ou mais) volta aos 40px, linear no meio — os mesmos números do
    // componente. A mola (spring) vira a transição com leve overshoot no CSS.
    const desk = document.getElementById('dock-desktop');
    const itens = [...desk.querySelectorAll('.dock-item')];
    const MIN = 40, MAX = 80, ALCANCE = 150;
    const aplicar = (mouseX) => {
      for (const it of itens) {
        let tam = MIN;
        if (mouseX !== Infinity) {
          const r = it.getBoundingClientRect();
          const d = Math.abs(mouseX - (r.left + r.width / 2));
          tam = Math.round(MIN + (MAX - MIN) * Math.max(0, 1 - Math.min(d, ALCANCE) / ALCANCE));
        }
        it.style.setProperty('--dock-tam', tam + 'px');
      }
    };
    let quadro = null;
    desk.addEventListener('mousemove', (e) => {
      const x = e.clientX;
      if (quadro !== null) return;
      quadro = requestAnimationFrame(() => { quadro = null; aplicar(x); });
    });
    desk.addEventListener('mouseleave', () => aplicar(Infinity));
    aplicar(Infinity);

    // ── celular: o botão abre/fecha a coluna; clicar fora fecha ──
    const tog = document.getElementById('dock-mobile-toggle');
    if (tog) tog.addEventListener('click', (e) => { e.stopPropagation(); this._alternarDockMobile(); });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#atlas-dock')) this._alternarDockMobile(false);
    });
  },

  _alternarDockMobile(forcar) {
    const lista = document.getElementById('dock-mobile-itens');
    const tog = document.getElementById('dock-mobile-toggle');
    if (!lista || !tog) return;
    const abrir = (forcar !== undefined) ? !!forcar : lista.hidden;
    if (abrir === !lista.hidden) return;
    lista.hidden = !abrir;
    tog.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    tog.classList.toggle('aberto', abrir);
  },

  /**
   * V858: pinta o carimbo de versão do rodapé do menu. Quando o banco aberto já
   * rodou num pacote MAIS NOVO (o caso do Matheus abrindo o .db do Pedro), o
   * aviso fica FIXO na tela — o toast que existia antes nascia atrás da tela de
   * login e expirava enquanto o usuário digitava a senha, justamente no momento
   * em que ele mais precisava do aviso.
   */
  pintarVersao() {
    const el = document.querySelector('.atlas-versao');
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
   * Aplica as permissões: esconde itens do menu não permitidos.
   * Chamado depois do login e também quando o admin altera permissões.
   */
  _aplicarPermissoesMenu() {
    // ATLAS v1.1: sem login está tudo liberado; fica o gancho para o dock.
    document.querySelectorAll('#atlas-dock [data-tela]').forEach(btn => {
      btn.style.display = Auth.podeAcessar(btn.dataset.tela) ? '' : 'none';
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

  /** ATLAS v1.1: o módulo Externos saiu da ferramenta. O stub fica para
   *  quem ainda chamar — e garante o modo desligado. */
  setModoExterno() {
    document.body.classList.remove('modo-externo');
    try { localStorage.removeItem('atlas_modo_externo'); } catch (_) {}
  },

  navegarPara(tela) {
    this._alvoSistemaAtivo = false;
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

    // ATLAS v1.1: o item ativo do dock (desktop e celular)
    document.querySelectorAll('#atlas-dock [data-tela]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tela === tela);
    });

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
      'importar-qvis':        'Importar Sistema',
      'inspecao':             'Inspeção',
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
            <h3 style="margin: 0 0 10px; color: #a15646">⚠ Script da tela não carregou</h3>
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
