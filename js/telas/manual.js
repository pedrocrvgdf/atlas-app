/**
 * ATLAS — Manual da ferramenta (V596)
 * Pop-up com o manual completo (índice + capítulos) e exportação em Word.
 *
 * Conteúdo: capítulos ESTÁTICOS (introdução, fluxo mensal, Base Tabela,
 * importações, cadastros, backup) + os capítulos da documentação central
 * window.AtlasDocs (docs_modulos.js — mesma fonte dos botões ℹ das telas).
 * Uma fonte só: o que aparece no pop-up é o que sai no Word.
 *
 * Export Word: documento HTML servido como .doc (abre no Microsoft Word,
 * 100% offline, sem biblioteca extra).
 *
 * API (window.AtlasManual): abrir()
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  // **texto** → negrito (mesma convenção do docs_modulos.js)
  function rico(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); }

  // ── capítulos estáticos (o que não está no AtlasDocs) ─────────────────
  const CAP_ESTATICOS_INICIO = [
    {
      id: 'introducao', titulo: 'Introdução',
      secoes: [
        { titulo: 'O que é a ferramenta', tipo: 'paragrafo', conteudo: [
          'O **Repasse Médico (ATLAS)** automatiza o cálculo do repasse dos médicos do ATLAS COMPANY: importa os relatórios (QVIS, Produção e fichários), aplica as regras da **Base Tabela** e produz o valor a repassar por médico, com auditoria, relatórios e comparativos.',
          'A ferramenta roda **100% no seu computador** (abre pelo arquivo index.html, sem internet e sem servidor). Os dados ficam gravados no navegador e, se você vincular o **arquivo automático** (Sistema › Backup), também num arquivo .db de verdade no disco/OneDrive.',
        ]},
        { titulo: 'Princípios', tipo: 'lista', conteudo: [
          '**Nada sai da máquina** — os dados de pacientes e valores nunca são enviados a lugar nenhum (LGPD).',
          '**Cálculo auditável** — cada linha do repasse pode ser inspecionada (regra aplicada, versão da tabela, papel, exceções).',
          '**Fechamento mensal** — o mês é calculado, salvo (snapshot) e vira a fonte dos relatórios e comparativos.',
          '**Fotos de cálculo** — os painéis pesados guardam o resultado com uma "impressão digital" dos dados: nada é recalculado à toa; qualquer importação/edição refaz só o que mudou.',
        ]},
      ],
    },
    {
      id: 'fluxo', titulo: 'Fluxo mensal recomendado',
      secoes: [
        { titulo: 'Passo a passo do fechamento', tipo: 'lista-ordenada', conteudo: [
          '**Importar** os relatórios do mês: QVIS (pagamento), Produção, e os fichários usados (Períodos, Fellow, Fracionamento, Laudos).',
          'Conferir a **Base Tabela** (valores por procedimento/papel/fonte) — se houve mudança de regra, criar/publicar uma **nova versão** com a data de vigência correta.',
          'Rodar o **Calcular Repasse** da competência e revisar os indicadores (casou / glosa / sem regra). O cálculo é salvo automaticamente (snapshot).',
          'Passar pela **Auditoria** para tratar divergências (Indicante/Solicitante, duplicidades, papéis exigidos).',
          'Conferir os fichários de **Desempenho** (LIO, OPME, Refractive, Períodos, Fellow, Laudos, etc.).',
          'Fechar em **Relatórios**: aba Consolidado (tudo junto), aba Mês a mês (comparativo por médico) e exportações (por médico ou consolidado).',
          'Registrar eventos relevantes na **Linha do tempo** (mudança de regra, entrada/saída de médico, contrato, auditoria).',
          'Confirmar o **backup**: arquivo automático em dia (Sistema › Backup) e, se desejar, exportar um .db manual.',
        ]},
      ],
    },
    {
      id: 'base-tabela', titulo: 'Base Tabela e Versões',
      secoes: [
        { titulo: 'O que é', tipo: 'paragrafo', conteudo: [
          'A **Base Tabela** é o coração das regras: para cada **procedimento**, define o valor de repasse por **papel** (Executante, Indicante, Solicitante, Auxiliar, Médico Laudo) e por **fonte pagadora** (Convênio, Particular, SUS).',
          'No **Convênio e SUS** os valores são sempre em **R$ fixo**. No **Particular**, cada célula pode ser **% do produzido** ou **R$ fixo** — se o R$ estiver preenchido, ele prevalece.',
        ]},
        { titulo: 'Recursos da grade', tipo: 'lista', conteudo: [
          '**Busca e filtros** — por nome, Categoria, Subespecialidade (inclui a opção **Vazio** para achar o que falta classificar) e "somente com valor".',
          '**USAR** — desmarca procedimentos que não entram no repasse (não repassáveis).',
          '**Classificação automática** — Categoria/Subespecialidade são preenchidas a partir da coluna PRODUTO da Produção importada; edições manuais nunca são sobrescritas.',
          '**Grafias/sinônimos** — nomes alternativos do mesmo procedimento (importados ou cadastrados) casam automaticamente no cálculo.',
          '**Cadeado** — edições de valor exigem destravar com senha e motivo; tudo fica registrado no histórico de alterações.',
          '**Reajuste %** — menu de reajuste GERAL (toda a tabela Convênio) ou POR ESPECIALIDADE (Convênio/Particular por subespecialidade; no Particular também dá para ajustar as % dos papéis em geral).',
        ]},
        { titulo: 'Versões da tabela', tipo: 'lista', conteudo: [
          'A tabela trabalha com **versões publicadas**: a versão vigente vale para as admissões a partir da sua **data de vigência** (inclusive); admissões anteriores seguem a versão da época — o motor escolhe a versão pela **data de admissão** de cada linha.',
          '**Criar nova versão** abre um rascunho (cópia da atual) onde as alterações em massa são feitas; **Publicar** congela e passa a valer. A publicação pode ser **agendada** para uma data futura.',
          'Ajustes finos (célula a célula) podem ser feitos direto na versão vigente — ficam sincronizados no histórico dela.',
          'No painel de versões (ícone flutuante) dá para **ver** qualquer versão publicada (somente leitura), **exportar** cada versão em Excel, **descartar rascunho** e **excluir a última versão**.',
          'Cada publicação entra automaticamente na **Linha do tempo** do repasse.',
        ]},
      ],
    },
    {
      id: 'importacoes', titulo: 'Importações',
      secoes: [
        { titulo: 'Relatórios que alimentam a ferramenta', tipo: 'glossario', conteudo: [
          ['QVIS (Relatório de pagamento)', 'Base do repasse: admissões, procedimentos, papéis, produzido/recebido, convênio. É o que o motor percorre para calcular.'],
          ['Produção', 'Base de realização (produto, categoria, subespecialidade, médico/cirurgião). Alimenta a produção total, a classificação da Base Tabela e cruzamentos da Auditoria.'],
          ['Períodos', 'Fichário de plantões/períodos por médico (valor por mês de referência).'],
          ['Fellow', 'Fichário de repasse dos fellows.'],
          ['Fracionamento', 'Fichário de fracionamentos.'],
          ['Laudos', 'Laudos com valor de repasse por competência.'],
        ]},
        { titulo: 'Boas práticas', tipo: 'lista', conteudo: [
          'Importar sempre o **mês completo** e conferir o resumo pós-importação (linhas lidas / ignoradas).',
          'Reimportar o mesmo mês substitui os dados daquele mês — os cálculos e painéis percebem a mudança sozinhos (fotos de cálculo invalidam).',
          'Nomes de médicos que vierem diferentes do cadastro são resolvidos no **De-Para de nomes**.',
        ]},
      ],
    },
  ];

  const CAP_ESTATICOS_FIM = [
    {
      id: 'cadastros', titulo: 'Cadastros e apoio',
      secoes: [
        { titulo: 'Telas de cadastro', tipo: 'glossario', conteudo: [
          ['Médicos', 'Cadastro com vínculo (INTERNO, HÍBRIDO, EXTERNO…), cargos administrativos e sinônimos de nome. O consolidado considera médicos INTERNO/HÍBRIDO.'],
          ['Unidades', 'Unidades de atendimento usadas nos cruzamentos.'],
          ['De-Para de nomes', 'Liga as grafias dos relatórios ao médico oficial; também marca nomes a ignorar.'],
        ]},
      ],
    },
    {
      id: 'linha-tempo', titulo: 'Linha do tempo e Lembretes',
      secoes: [
        { titulo: 'Linha do tempo do repasse', tipo: 'paragrafo', conteudo: [
          'Faixa no topo da Visão Geral com os **eventos que mudam o repasse**: mudança de regra, entrada/saída de médico, contrato/convênio, auditoria. Clique no alfinete para ver/editar a descrição e **anexar documentos** (ficam guardados dentro da ferramenta); o lápis abre a edição completa (título, data, categoria, ícone do marco, impacto, responsável).',
          'Publicações de versão da Base Tabela entram automaticamente como eventos.',
        ]},
        { titulo: 'Lembretes', tipo: 'paragrafo', conteudo: [
          'Cada tela pode ter **lembretes/alertas** (ícone no topo). Antes de exportar relatórios, a ferramenta avisa se há lembretes não concluídos.',
        ]},
      ],
    },
    {
      id: 'backup', titulo: 'Backup, Arquivo automático e Diagnóstico',
      secoes: [
        { titulo: 'Onde os dados vivem', tipo: 'paragrafo', conteudo: [
          'Os dados ficam no armazenamento do **navegador** (IndexedDB) — invisíveis no disco e presos ao perfil do Chrome/Edge daquela máquina. Aba anônima e outros navegadores **não** enxergam os dados.',
        ]},
        { titulo: 'Proteções disponíveis (Sistema › Backup)', tipo: 'lista', conteudo: [
          '**Arquivo automático (recomendado)** — vincule uma vez um arquivo .db numa pasta segura (OneDrive/rede): a ferramenta grava nele sozinha após cada alteração. Se a máquina pifar, use "Vincular arquivo existente (restaurar)" em qualquer computador.',
          '**Exportar/Importar .db** — backup manual completo.',
          '**Diagnóstico de desempenho** — cronômetros das funções pesadas (sem dados de pacientes) para enviar ao suporte quando algo estiver lento.',
          'O navegador pode pedir para **reautorizar** o acesso ao arquivo a cada sessão — a ferramenta tenta no primeiro clique e o botão Reautorizar resolve manualmente.',
        ]},
      ],
    },
  ];

  // ordem dos capítulos vindos do AtlasDocs (docs_modulos.js)
  const ORDEM_DOCS = [
    'dashboard', 'calcular', 'auditoria', 'relatorios', 'producao-medica',
    'gerenciais', 'consolidacao',
    'desempenho-lio', 'desempenho-opme', 'desempenho-refractive-laser',
    'desempenho-periodos', 'desempenho-fellow', 'desempenho-fracionamento',
    'desempenho-laudos', 'desempenho-cargos', 'desempenho-estrabismo',
    'desempenho-lentes-contato', 'desempenho-luz-pulsada', 'desempenho-crosslink',
    'sistema',
  ];
  // complementos por capítulo (novidades ainda não descritas no AtlasDocs)
  const COMPLEMENTOS = {
    relatorios: [{
      titulo: 'Aba Mês a mês (por médico)', tipo: 'paragrafo', conteudo: [
        'Comparativo do repasse consolidado **por médico e por competência** (formato do arquivo CONSOLIDADO): linha **CORPO CLÍNICO** com o total de cada mês, uma linha por médico e a coluna **TOTAL** com a soma do período. Tem seletor de período (De/Até) e **Exportar Excel** com duas abas (Repasse detalhado + TOTAIS).',
      ],
    }],
    dashboard: [{
      titulo: 'Desempenho × Repasse e Performance médica', tipo: 'paragrafo', conteudo: [
        'Além dos cards, a Visão Geral traz o gráfico **Desempenho × Repasse por médico** (com filtro de um médico), o ranking **Top 10** e a lista **Performance médica** com todos os médicos elegíveis.',
      ],
    }],
  };

  function capitulos() {
    const docs = window.AtlasDocs || {};
    const doDocs = ORDEM_DOCS
      .filter(id => docs[id])
      .map(id => ({
        id,
        titulo: docs[id].titulo || id,
        secoes: [...(docs[id].secoes || []), ...(COMPLEMENTOS[id] || [])],
      }));
    return [...CAP_ESTATICOS_INICIO, ...doDocs, ...CAP_ESTATICOS_FIM];
  }

  // ── render de seções (mesmos tipos do docs_modulos.js) ────────────────
  function htmlSecao(s) {
    const t = s.tipo || 'paragrafo';
    let corpo = '';
    if (t === 'paragrafo') {
      corpo = (s.conteudo || []).map(p => `<p class="mn-p">${rico(p)}</p>`).join('');
    } else if (t === 'lista' || t === 'lista-ordenada') {
      const tag = t === 'lista' ? 'ul' : 'ol';
      corpo = `<${tag} class="mn-lista">${(s.conteudo || []).map(i => `<li>${rico(i)}</li>`).join('')}</${tag}>`;
    } else if (t === 'glossario') {
      corpo = `<table class="mn-glos"><tbody>${(s.conteudo || []).map(([k, v]) =>
        `<tr><td class="mn-glos-k">${rico(k)}</td><td>${rico(v)}</td></tr>`).join('')}</tbody></table>`;
    } else {
      corpo = (s.conteudo || []).map(p => `<p class="mn-p">${rico(p)}</p>`).join('');
    }
    return `<div class="mn-secao"><h4 class="mn-h4">${esc(s.titulo || '')}</h4>${corpo}</div>`;
  }

  function abrir() {
    injetarEstilos();
    const caps = capitulos();
    const ov = document.createElement('div');
    ov.className = 'mn-ov';
    ov.innerHTML = `
      <div class="mn-modal" role="dialog" aria-modal="true">
        <div class="mn-head">
          <div class="mn-head-l">
            <div class="mn-titulo">📖 Manual da ferramenta</div>
            <div class="mn-sub">Repasse Médico · ATLAS — ATLAS COMPANY</div>
          </div>
          <div class="mn-head-r">
            <button type="button" class="mn-btn-word" id="mn-pdf">↓ Exportar PDF</button>
            <button type="button" class="mn-x" id="mn-fechar" title="Fechar">×</button>
          </div>
        </div>
        <div class="mn-corpo">
          <nav class="mn-indice">
            <div class="mn-indice-t">Índice</div>
            ${caps.map(c => `<button type="button" class="mn-ind-item" data-mn-ir="${c.id}">${esc(c.titulo)}</button>`).join('')}
          </nav>
          <div class="mn-conteudo" id="mn-conteudo">
            ${caps.map(c => `
              <section class="mn-cap" id="mn-cap-${c.id}">
                <h3 class="mn-h3">${esc(c.titulo)}</h3>
                ${(c.secoes || []).map(htmlSecao).join('')}
              </section>`).join('')}
            <div class="mn-fim">— fim do manual —</div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const fechar = () => { document.removeEventListener('keydown', onKey); ov.remove(); };
    function onKey(e) { if (e.key === 'Escape') fechar(); }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    ov.querySelector('#mn-fechar').addEventListener('click', fechar);
    ov.querySelector('#mn-pdf').addEventListener('click', exportarPdf);

    // índice → rola até o capítulo e marca o ativo
    const cont = ov.querySelector('#mn-conteudo');
    ov.querySelectorAll('[data-mn-ir]').forEach(b => {
      b.addEventListener('click', () => {
        const alvo = ov.querySelector(`#mn-cap-${b.dataset.mnIr}`);
        if (alvo) cont.scrollTo({ top: alvo.offsetTop - cont.offsetTop - 6, behavior: 'smooth' });
      });
    });
    // destaca no índice o capítulo visível
    cont.addEventListener('scroll', () => {
      let atual = null;
      ov.querySelectorAll('.mn-cap').forEach(sec => {
        if (sec.offsetTop - cont.offsetTop <= cont.scrollTop + 40) atual = sec.id.replace('mn-cap-', '');
      });
      ov.querySelectorAll('.mn-ind-item').forEach(b =>
        b.classList.toggle('on', b.dataset.mnIr === atual));
    }, { passive: true });
  }

  // ── exportação PDF (V598) ─────────────────────────────────────────────
  // Abre o manual numa janela de impressão já formatada (A4, quebra de página
  // por capítulo) e chama a impressão — no destino, escolha "Salvar como PDF".
  // 100% offline, sem biblioteca externa.
  function exportarPdf() {
    const caps = capitulos();
    const secWord = (s) => {
      const t = s.tipo || 'paragrafo';
      let corpo = '';
      if (t === 'lista' || t === 'lista-ordenada') {
        const tag = t === 'lista' ? 'ul' : 'ol';
        corpo = `<${tag}>${(s.conteudo || []).map(i => `<li>${rico(i)}</li>`).join('')}</${tag}>`;
      } else if (t === 'glossario') {
        corpo = `<table>${(s.conteudo || []).map(([k, v]) =>
          `<tr><td style="width:220px"><b>${rico(k)}</b></td><td>${rico(v)}</td></tr>`).join('')}</table>`;
      } else {
        corpo = (s.conteudo || []).map(p => `<p>${rico(p)}</p>`).join('');
      }
      return `<h3>${esc(s.titulo || '')}</h3>${corpo}`;
    };
    const hoje = new Date().toLocaleDateString('pt-BR');
    const corpo = `
      <h1>Manual da ferramenta — Repasse Médico (ATLAS)</h1>
      <p><b>ATLAS COMPANY</b> · manual gerado pela própria ferramenta em ${hoje}.</p>
      <h2>Índice</h2>
      <ol>${caps.map(c => `<li>${esc(c.titulo)}</li>`).join('')}</ol>
      ${caps.map(c => `<h2>${esc(c.titulo)}</h2>${(c.secoes || []).map(secWord).join('')}`).join('')}
    `;
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Manual — Repasse Médico</title>
      <style>
        @page { size: A4; margin: 18mm 16mm; }
        body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1b2a3a; margin: 0; }
        h1 { font-size: 20pt; color: #06283A; }
        h2 { font-size: 15pt; color: #0b3a55; border-bottom: 1pt solid #b9c8d4; padding-bottom: 3pt;
             margin-top: 22pt; break-before: page; page-break-before: always; }
        h1 + p + h2 { break-before: auto; page-break-before: auto; }  /* o Índice segue a capa */
        h3 { font-size: 12pt; color: #14547f; margin-top: 12pt; }
        p, li { line-height: 1.45; }
        table { border-collapse: collapse; width: 100%; }
        td { border: 1pt solid #b9c8d4; padding: 4pt 8pt; font-size: 10.5pt; vertical-align: top; }
        tr, li { page-break-inside: avoid; }
      </style></head><body>${corpo}</body></html>`;
    const w = window.open('', '_blank');
    if (!w) {
      try { Utilidades.toast?.('O navegador bloqueou a janela — permita pop-ups para exportar o PDF.', 'error', 5000); } catch (_) {}
      return;
    }
    w.document.write(html);
    w.document.close();
    try { Utilidades.toast?.('Na janela de impressão, escolha "Salvar como PDF".', 'info', 5200); } catch (_) {}
    setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 450);
  }

  // ── estilos (linguagem visual da ferramenta) ──────────────────────────
  function injetarEstilos() {
    if (document.getElementById('mn-estilos')) return;
    const st = document.createElement('style');
    st.id = 'mn-estilos';
    st.textContent = `
      .mn-ov { position: fixed; inset: 0; z-index: 100000; background: rgba(15,37,68,.5);
        display: flex; align-items: center; justify-content: center; padding: 30px 22px;
        animation: mnFade .16s ease-out; }
      @keyframes mnFade { from { opacity: 0 } to { opacity: 1 } }
      .mn-modal { background: var(--bg-elevated, #fff); border-radius: 16px; width: 100%; max-width: 1020px;
        height: calc(100vh - 70px); max-height: 860px; display: flex; flex-direction: column;
        box-shadow: 0 24px 60px -20px rgba(15,37,68,.45); overflow: hidden; }
      .mn-head { display: flex; align-items: center; justify-content: space-between; gap: 14px;
        padding: 16px 22px; border-bottom: 1px solid var(--border, #DEE3E1);
        background: linear-gradient(90deg, #06283A 0%, #0b4a66 60%, #107dac 100%); }
      .mn-titulo { font: 700 17px/1.2 'Inter Tight', -apple-system, sans-serif; color: #fff; }
      .mn-sub { font-size: 11.5px; color: rgba(255,255,255,.75); margin-top: 2px; }
      .mn-head-r { display: flex; align-items: center; gap: 8px; }
      .mn-btn-word { font: 700 12.5px/1 'Inter Tight', -apple-system, sans-serif; color: #06283A;
        background: #fff; border: none; border-radius: 9px; padding: 10px 14px; cursor: pointer;
        box-shadow: 0 2px 6px rgba(10,40,66,.25); transition: background-color .12s ease; }
      .mn-btn-word:hover { background: #eaf7fc; }
      .mn-x { width: 32px; height: 32px; border-radius: 8px; border: none;
        background: rgba(255,255,255,.16); color: #fff; font-size: 18px; line-height: 1;
        cursor: pointer; padding: 0; transition: background-color .12s ease; }
      .mn-x:hover { background: rgba(255,255,255,.3); }
      .mn-corpo { flex: 1; min-height: 0; display: grid; grid-template-columns: 250px 1fr; }
      .mn-indice { border-right: 1px solid var(--border, #DEE3E1); background: var(--bg-sunken, #F7F9F8);
        overflow-y: auto; padding: 14px 10px; display: flex; flex-direction: column; gap: 2px; }
      .mn-indice-t { font: 700 10px/1 'Inter Tight', -apple-system, sans-serif; letter-spacing: .1em;
        text-transform: uppercase; color: var(--ink-faint, #9aa09c); padding: 2px 10px 8px; }
      .mn-ind-item { text-align: left; font-size: 12.5px; font-weight: 600; color: var(--ink-soft, #4b5a55);
        background: none; border: none; border-radius: 8px; padding: 7px 10px; cursor: pointer;
        transition: background-color .12s ease, color .12s ease; }
      .mn-ind-item:hover { background: rgba(16,125,172,.08); color: #107DAC; }
      .mn-ind-item.on { background: #107DAC; color: #fff; }
      .mn-conteudo { overflow-y: auto; padding: 20px 26px 30px; scroll-behavior: smooth; position: relative; }
      .mn-cap { margin-bottom: 26px; }
      .mn-h3 { margin: 0 0 10px; font: 700 18px/1.25 'Inter Tight', -apple-system, sans-serif;
        color: var(--ink, #06283A); padding-bottom: 7px; border-bottom: 2px solid #107DAC; }
      .mn-h4 { margin: 14px 0 6px; font: 700 13px/1.3 'Inter Tight', -apple-system, sans-serif;
        color: #14547f; text-transform: uppercase; letter-spacing: .04em; }
      .mn-p { margin: 0 0 8px; font-size: 13.5px; line-height: 1.6; color: var(--ink-soft, #37423e); }
      .mn-lista { margin: 0 0 8px; padding-left: 20px; }
      .mn-lista li { font-size: 13.5px; line-height: 1.6; color: var(--ink-soft, #37423e); margin-bottom: 5px; }
      .mn-glos { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
      .mn-glos td { border: 1px solid var(--border, #DEE3E1); padding: 7px 10px; font-size: 13px;
        line-height: 1.5; color: var(--ink-soft, #37423e); vertical-align: top; }
      .mn-glos-k { width: 200px; font-weight: 700; color: var(--ink, #06283A);
        background: var(--bg-sunken, #F7F9F8); }
      .mn-fim { text-align: center; font-size: 11.5px; color: var(--ink-faint, #9aa09c); padding: 8px 0 4px; }
      @media (max-width: 760px) { .mn-corpo { grid-template-columns: 1fr; } .mn-indice { display: none; } }
    `;
    document.head.appendChild(st);
  }

  window.AtlasManual = { abrir };
})();
